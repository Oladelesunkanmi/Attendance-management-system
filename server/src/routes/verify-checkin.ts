import { Router } from 'express';
import { jwtVerify } from 'jose';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { requireStudent } from '../middleware/auth.js';
import { distanceMeters, evaluateGpsFlags } from '../lib/haversine.js';
import { checkRateLimit, recordRateLimitHit } from '../lib/rate-limit.js';
import { getWebauthnConfig } from '../lib/webauthn.js';

export const verifyCheckinRouter = Router();

verifyCheckinRouter.post('/', requireStudent, async (req, res) => {
  const timings: Record<string, number> = {};
  const overallStart = performance.now();
  const mark = (name: string, startedAt: number) => {
    timings[name] = Math.round(performance.now() - startedAt);
  };

  try {
    const { profile, serviceClient } = req.auth!;

    // The rate-limit bucket does not depend on the QR token, so it is read
    // alongside the other lookups instead of in front of them.
    const rateLimitPromise = checkRateLimit(serviceClient, `checkin:${profile.id}`);

    const {
      qrToken,
      latitude,
      longitude,
      gpsAccuracy,
      assertionResponse,
    } = req.body;

    if (!qrToken || latitude == null || longitude == null) {
      await rateLimitPromise;
      res.status(400).json({ error: 'Missing required check-in fields' });
      return;
    }

    const secret = process.env.QR_JWT_SECRET;
    if (!secret) {
      await rateLimitPromise;
      res.status(500).json({ error: 'Server misconfigured' });
      return;
    }

    let sessionId: string;
    let jti: string;
    let tokenIsValid = true;

    try {
      const { payload } = await jwtVerify(
        qrToken,
        new TextEncoder().encode(secret),
      );
      sessionId = payload.session_id as string;
      jti = payload.jti as string;
      if (!sessionId || !jti) throw new Error('Invalid payload');
    } catch {
      tokenIsValid = false;
      sessionId = '';
      jti = '';
    }

    if (!tokenIsValid) {
      // A rate-limited request stays a rate-limited request, whatever the
      // token looks like.
      const rateLimit = await rateLimitPromise;
      if (!rateLimit.allowed) {
        res.status(429).json({ error: 'Rate limit exceeded' });
        return;
      }
      res.status(401).json({ error: 'Invalid or expired QR token' });
      return;
    }

    // ── Read phase: three independent lookups, issued together ──────────
    const readsStart = performance.now();
    const [rateLimit, nonceResult, sessionResult] = await Promise.all([
      rateLimitPromise,
      serviceClient
        .from('qr_token_nonces')
        .select('*')
        .eq('jti', jti)
        .eq('session_id', sessionId)
        .maybeSingle(),
      serviceClient
        .from('sessions')
        .select('*, venues(*), courses(id)')
        .eq('id', sessionId)
        .single(),
    ]);
    mark('readsMs', readsStart);

    if (!rateLimit.allowed) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    // Every allowed attempt counts towards the limit, including the ones that
    // are rejected further down, so the write is not tied to the outcome.
    void recordRateLimitHit(serviceClient, rateLimit).catch(() => undefined);

    const { data: nonce } = nonceResult;
    if (!nonce) {
      res.status(401).json({ error: 'QR token not recognized' });
      return;
    }
    if (nonce.consumed_at) {
      res.status(409).json({ error: 'QR token already used' });
      return;
    }

    const { data: session } = sessionResult;
    if (!session?.is_active) {
      res.status(400).json({ error: 'Session is not active' });
      return;
    }

    const mode = session.verification_mode as 'qr_only' | 'qr_geofence' | 'full';

    // ── Read phase 2: lookups that only depend on the session ───────────
    const reads2Start = performance.now();
    const enrollmentPromise = serviceClient
      .from('enrollments')
      .select('id')
      .eq('course_id', session.course_id)
      .eq('student_id', profile.id)
      .maybeSingle();

    const challengePromise =
      mode === 'full'
        ? serviceClient
            .from('webauthn_challenges')
            .select('*')
            .eq('user_id', profile.id)
            .eq('challenge_type', 'authentication')
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : null;

    const credentialPromise =
      mode === 'full' && assertionResponse
        ? serviceClient
            .from('webauthn_credentials')
            .select('*')
            .eq('student_id', profile.id)
            .eq('credential_id', assertionResponse.id)
            .is('revoked_at', null)
            .single()
        : null;

    const [enrollmentResult, challengeResult, credentialResult] = await Promise.all([
      enrollmentPromise,
      challengePromise,
      credentialPromise,
    ]);
    mark('reads2Ms', reads2Start);

    const { data: enrollment } = enrollmentResult;
    if (!enrollment) {
      const { error: enrolError } = await serviceClient
        .from('enrollments')
        .insert({
          course_id: session.course_id,
          student_id: profile.id,
        });

      if (enrolError) {
        res.status(500).json({ error: 'Failed to auto-enrol in the course' });
        return;
      }
    }

    const venue = session.venues as {
      latitude: number;
      longitude: number;
      radius_meters: number;
    };

    let distance = 0;
    let flaggedReason: string | null = evaluateGpsFlags(gpsAccuracy);
    let webauthnVerified = false;

    if (mode !== 'qr_only') {
      distance = distanceMeters(
        latitude,
        longitude,
        venue.latitude,
        venue.longitude,
      );
      if (distance > venue.radius_meters) {
        flaggedReason = flaggedReason ?? 'outside_geofence';
      }
    }

    let challengeRow: any = null;
    let credential: any = null;
    let newCounter: number | null = null;

    if (mode === 'full') {
      if (!assertionResponse) {
        res.status(400).json({ error: 'WebAuthn assertion required' });
        return;
      }

      const { rpID, origin } = getWebauthnConfig(req);
      challengeRow = challengeResult?.data ?? null;

      if (!challengeRow) {
        res.status(400).json({ error: 'Authentication challenge expired' });
        return;
      }

      // Only accept a credential that has not been revoked.
      credential = credentialResult?.data ?? null;

      if (!credential) {
        res.status(404).json({ error: 'Credential not found' });
        return;
      }

      const verification = await verifyAuthenticationResponse({
        response: assertionResponse,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: credential.credential_id,
          publicKey: new Uint8Array(credential.public_key),
          counter: Number(credential.counter),
        },
      });

      if (!verification.verified) {
        res.status(401).json({ error: 'WebAuthn verification failed' });
        return;
      }

      webauthnVerified = true;
      newCounter = verification.authenticationInfo.newCounter;
    }

    // ── Write phase: the counter update, the challenge cleanup and the
    //    nonce consumption do not depend on each other ───────────────────
    const writesStart = performance.now();
    const counterUpdate =
      mode === 'full' && credential
        ? serviceClient
            .from('webauthn_credentials')
            .update({ counter: newCounter })
            .eq('id', credential.id)
        : null;

    const challengeDelete =
      mode === 'full' && challengeRow
        ? serviceClient
            .from('webauthn_challenges')
            .delete()
            .eq('id', challengeRow.id)
        : null;

    const consumePromise = serviceClient
      .from('qr_token_nonces')
      .update({
        consumed_at: new Date().toISOString(),
        consumed_by: profile.id,
      })
      .eq('jti', jti)
      .is('consumed_at', null);

    const [, , consumeResult] = await Promise.all([
      counterUpdate,
      challengeDelete,
      consumePromise,
    ]);
    mark('writesMs', writesStart);

    const { error: consumeError } = consumeResult;
    if (consumeError) {
      res.status(409).json({ error: 'QR token already used' });
      return;
    }

    const insertStart = performance.now();
    const { data: record, error: insertError } = await serviceClient
      .from('attendance_records')
      .insert({
        session_id: sessionId,
        student_id: profile.id,
        latitude,
        longitude,
        distance_meters: distance,
        gps_accuracy_meters: gpsAccuracy ?? null,
        webauthn_verified: webauthnVerified,
        flagged_reason: flaggedReason,
      })
      .select('*')
      .single();
    mark('insertMs', insertStart);

    if (insertError) {
      if (insertError.code === '23505') {
        res.status(409).json({ error: 'Already checked in for this session' });
        return;
      }
      res.status(500).json({ error: 'Failed to record attendance' });
      return;
    }

    timings.totalMs = Math.round(performance.now() - overallStart);
    res.set(
      'Server-Timing',
      Object.entries(timings)
        .map(([name, duration]) => `${name};dur=${duration}`)
        .join(', '),
    );

    res.json({
      success: true,
      record,
      flagged: Boolean(flaggedReason),
      timings,
    });
  } catch (err) {
    console.error('[verify-checkin]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

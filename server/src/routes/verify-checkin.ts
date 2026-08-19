import { Router } from 'express';
import { jwtVerify } from 'jose';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { requireStudent } from '../middleware/auth.js';
import { distanceMeters, evaluateGpsFlags } from '../lib/haversine.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { getWebauthnConfig } from '../lib/webauthn.js';

export const verifyCheckinRouter = Router();

verifyCheckinRouter.post('/', requireStudent, async (req, res) => {
  try {
    const { profile, serviceClient } = req.auth!;
    const allowed = await checkRateLimit(serviceClient, `checkin:${profile.id}`);
    if (!allowed) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    const {
      qrToken,
      latitude,
      longitude,
      gpsAccuracy,
      assertionResponse,
    } = req.body;

    if (!qrToken || latitude == null || longitude == null) {
      res.status(400).json({ error: 'Missing required check-in fields' });
      return;
    }

    const secret = process.env.QR_JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'Server misconfigured' });
      return;
    }

    let sessionId: string;
    let jti: string;

    try {
      const { payload } = await jwtVerify(
        qrToken,
        new TextEncoder().encode(secret),
      );
      sessionId = payload.session_id as string;
      jti = payload.jti as string;
      if (!sessionId || !jti) throw new Error('Invalid payload');
    } catch {
      res.status(401).json({ error: 'Invalid or expired QR token' });
      return;
    }

    const { data: nonce } = await serviceClient
      .from('qr_token_nonces')
      .select('*')
      .eq('jti', jti)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (!nonce) {
      res.status(401).json({ error: 'QR token not recognized' });
      return;
    }
    if (nonce.consumed_at) {
      res.status(409).json({ error: 'QR token already used' });
      return;
    }

    const { data: session } = await serviceClient
      .from('sessions')
      .select('*, venues(*), courses(id)')
      .eq('id', sessionId)
      .single();

    if (!session?.is_active) {
      res.status(400).json({ error: 'Session is not active' });
      return;
    }

    const { data: enrollment } = await serviceClient
      .from('enrollments')
      .select('id')
      .eq('course_id', session.course_id)
      .eq('student_id', profile.id)
      .maybeSingle();

    if (!enrollment) {
      res.status(403).json({ error: 'Not enrolled in this course' });
      return;
    }

    const venue = session.venues as {
      latitude: number;
      longitude: number;
      radius_meters: number;
    };

    let distance = 0;
    let flaggedReason: string | null = evaluateGpsFlags(gpsAccuracy);
    let webauthnVerified = false;
    const mode = session.verification_mode as 'qr_only' | 'qr_geofence' | 'full';

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

    if (mode === 'full') {
      if (!assertionResponse) {
        res.status(400).json({ error: 'WebAuthn assertion required' });
        return;
      }

      const { rpID, origin } = getWebauthnConfig(req);
      const { data: challengeRow } = await serviceClient
        .from('webauthn_challenges')
        .select('*')
        .eq('user_id', profile.id)
        .eq('challenge_type', 'authentication')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!challengeRow) {
        res.status(400).json({ error: 'Authentication challenge expired' });
        return;
      }

      // Only accept a credential that has not been revoked.
      const { data: credential } = await serviceClient
        .from('webauthn_credentials')
        .select('*')
        .eq('student_id', profile.id)
        .eq('credential_id', assertionResponse.id)
        .is('revoked_at', null)
        .single();

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
      await serviceClient
        .from('webauthn_credentials')
        .update({ counter: verification.authenticationInfo.newCounter })
        .eq('id', credential.id);

      await serviceClient
        .from('webauthn_challenges')
        .delete()
        .eq('id', challengeRow.id);
    }

    const { error: consumeError } = await serviceClient
      .from('qr_token_nonces')
      .update({
        consumed_at: new Date().toISOString(),
        consumed_by: profile.id,
      })
      .eq('jti', jti)
      .is('consumed_at', null);

    if (consumeError) {
      res.status(409).json({ error: 'QR token already used' });
      return;
    }

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

    if (insertError) {
      if (insertError.code === '23505') {
        res.status(409).json({ error: 'Already checked in for this session' });
        return;
      }
      res.status(500).json({ error: 'Failed to record attendance' });
      return;
    }

    res.json({
      success: true,
      record,
      flagged: Boolean(flaggedReason),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

import { jwtVerify } from 'npm:jose@5';
import { verifyAuthenticationResponse } from 'npm:@simplewebauthn/server@11';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireStudent } from '../_shared/auth.ts';
import { distanceMeters, evaluateGpsFlags } from '../_shared/haversine.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

function webauthnConfig() {
  const rpID = Deno.env.get('WEBAUTHN_RP_ID');
  const origin = Deno.env.get('WEBAUTHN_ORIGIN');
  if (!rpID || !origin) throw new Error('WebAuthn env vars missing');
  return { rpID, origin };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { profile, serviceClient } = await requireStudent(req);
    const allowed = await checkRateLimit(serviceClient, `checkin:${profile.id}`);
    if (!allowed) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429);
    }

    const body = await req.json();
    const {
      qrToken,
      latitude,
      longitude,
      gpsAccuracy,
      assertionResponse,
    } = body;

    if (!qrToken || latitude == null || longitude == null) {
      return jsonResponse({ error: 'Missing required check-in fields' }, 400);
    }

    const secret = Deno.env.get('QR_JWT_SECRET');
    if (!secret) return jsonResponse({ error: 'Server misconfigured' }, 500);

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
      return jsonResponse({ error: 'Invalid or expired QR token' }, 401);
    }

    const { data: nonce } = await serviceClient
      .from('qr_token_nonces')
      .select('*')
      .eq('jti', jti)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (!nonce) return jsonResponse({ error: 'QR token not recognized' }, 401);
    if (nonce.consumed_at) return jsonResponse({ error: 'QR token already used' }, 409);

    const { data: session } = await serviceClient
      .from('sessions')
      .select('*, venues(*), courses(id)')
      .eq('id', sessionId)
      .single();

    if (!session?.is_active) {
      return jsonResponse({ error: 'Session is not active' }, 400);
    }

    const { data: enrollment } = await serviceClient
      .from('enrollments')
      .select('id')
      .eq('course_id', session.course_id)
      .eq('student_id', profile.id)
      .maybeSingle();

    if (!enrollment) {
      return jsonResponse({ error: 'Not enrolled in this course' }, 403);
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
        return jsonResponse({ error: 'WebAuthn assertion required' }, 400);
      }

      const { rpID, origin } = webauthnConfig();
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
        return jsonResponse({ error: 'Authentication challenge expired' }, 400);
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
        return jsonResponse({ error: 'Credential not found' }, 404);
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
        return jsonResponse({ error: 'WebAuthn verification failed' }, 401);
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
      return jsonResponse({ error: 'QR token already used' }, 409);
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
        return jsonResponse({ error: 'Already checked in for this session' }, 409);
      }
      return jsonResponse({ error: 'Failed to record attendance' }, 500);
    }

    return jsonResponse({
      success: true,
      record,
      flagged: Boolean(flaggedReason),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
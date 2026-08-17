import { jwtVerify } from 'npm:jose@5';
import { verifyAuthenticationResponse } from 'npm:@simplewebauthn/server@11';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireStudent } from '../_shared/auth.ts';
import { distanceMeters, evaluateGpsFlags } from '../_shared/haversine.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { getWebauthnConfig, parseBytea } from '../_shared/webauthn.ts';

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

    // Only qrToken is required up-front. mode-specific fields are validated after
    // we fetch the session and know the session.verification_mode.
    if (!qrToken) {
      return jsonResponse({ error: 'Missing required check-in fields: qrToken' }, 400);
    }

    const secret = Deno.env.get('QR_JWT_SECRET');
    if (!secret) return jsonResponse({ error: 'Server misconfigured: QR_JWT_SECRET secret is missing on Supabase' }, 500);

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

    let { data: enrollment } = await serviceClient
      .from('enrollments')
      .select('id')
      .eq('course_id', session.course_id)
      .eq('student_id', profile.id)
      .maybeSingle();

    if (!enrollment) {
      // Automatically enroll student into the course upon scanning a valid session QR code
      const { data: newEnrollment } = await serviceClient
        .from('enrollments')
        .insert({
          course_id: session.course_id,
          student_id: profile.id,
        })
        .select('id')
        .single();
      enrollment = newEnrollment;
    }

    const venue = session.venues as {
      latitude: number;
      longitude: number;
      radius_meters: number;
    };

    let distance = 0;
    let flaggedReason: string | null = null; // Evaluate only when GPS is collected
    let webauthnVerified = false;
    const mode = session.verification_mode as 'qr_only' | 'qr_geofence' | 'full';

    // Mode-based validation & evaluation
    if (mode !== 'qr_only') {
      // Require latitude/longitude for geofence or full modes
      if (latitude == null || longitude == null) {
        return jsonResponse({ error: 'latitude and longitude are required for this session verification mode' }, 400);
      }

      // Evaluate GPS accuracy flags (only when GPS was provided)
      flaggedReason = evaluateGpsFlags(gpsAccuracy);

      // Compute distance and apply geofence logic
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
        return jsonResponse({ error: 'WebAuthn biometric assertion required' }, 400);
      }

      const { rpID, origin } = getWebauthnConfig(req, body.rpID, body.origin);
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
          publicKey: parseBytea(credential.public_key),
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
        // Only persist GPS when the mode required GPS; otherwise store NULL
        latitude: mode === 'qr_only' ? null : latitude,
        longitude: mode === 'qr_only' ? null : longitude,
        distance_meters: distance,
        gps_accuracy_meters: mode === 'qr_only' ? null : (gpsAccuracy ?? null),
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

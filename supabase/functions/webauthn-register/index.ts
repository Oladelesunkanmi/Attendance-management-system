import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@11';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireStudent } from '../_shared/auth.ts';
import { getWebauthnConfig, encodeBytea } from '../_shared/webauthn.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const step = body.step as 'options' | 'verify';

    // ── Step 1: Generate registration options ─────────────────────────────────
    if (step === 'options') {
      const { profile, serviceClient } = await requireStudent(req);
      const { rpID, rpName } = getWebauthnConfig(req, body.rpID, body.origin);

      // Only exclude credentials that are currently active (not revoked).
      // This allows re-registering a device after a credential is revoked.
      const { data: existing } = await serviceClient
        .from('webauthn_credentials')
        .select('credential_id')
        .eq('student_id', profile.id)
        .is('revoked_at', null);

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        // `userID` must be a Uint8Array in @simplewebauthn/server v11+
        userID: new TextEncoder().encode(profile.id),
        userName: profile.matric_number ?? profile.id,
        userDisplayName: profile.full_name,
        attestationType: 'none',
        // Prefer the device's built-in platform authenticator so mobile
        // devices will use fingerprint/Face ID / device PIN instead of
        // suggesting a roaming USB security key.
        authenticatorSelection: {
          userVerification: 'preferred',
          residentKey: 'preferred',
        },
        excludeCredentials: [],
      });

      await serviceClient.from('webauthn_challenges').insert({
        user_id: profile.id,
        challenge: options.challenge,
        challenge_type: 'registration',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      return jsonResponse({ options });
    }

    // ── Step 2: Verify attestation + PIN + credential cap ────────────────────
    if (step === 'verify') {
      const { profile, serviceClient } = await requireStudent(req);
      const { rpID, origin } = getWebauthnConfig(req, body.rpID, body.origin);
      const { attestationResponse, enrolmentPin } = body;

      // ── Server-side PIN verification (Optional for testing) ───────────────
      // If a PIN is provided, verify it against enrolment_pins and mark it used.
      // If omitted, allow self-enrolment for testing (enrolled_by = null).
      let enrolledBy: string | null = null;

      if (enrolmentPin && String(enrolmentPin).trim().length > 0) {
        const { data: pinRow } = await serviceClient
          .from('enrolment_pins')
          .select('id, lecturer_id')
          .eq('pin', String(enrolmentPin).trim())
          .is('used_at', null)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();

        if (!pinRow) {
          return jsonResponse(
            { error: 'Invalid or expired supervisor PIN. Ask your lecturer to generate a new one.' },
            400,
          );
        }

        // PIN is valid — mark it as used immediately so it cannot be reused.
        await serviceClient
          .from('enrolment_pins')
          .update({ used_at: new Date().toISOString() })
          .eq('id', pinRow.id);

        enrolledBy = pinRow.lecturer_id;
      }
      // ─────────────────────────────────────────────────────────────────────

      const { data: challengeRow } = await serviceClient
        .from('webauthn_challenges')
        .select('*')
        .eq('user_id', profile.id)
        .eq('challenge_type', 'registration')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!challengeRow) {
        return jsonResponse({ error: 'Registration challenge expired' }, 400);
      }

      const verification = await verifyRegistrationResponse({
        response: attestationResponse,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return jsonResponse({ error: 'Registration verification failed' }, 400);
      }

      const { credential, credentialDeviceType } = verification.registrationInfo;
      const aaguid = verification.registrationInfo.aaguid ?? null;

      // ── Cross-student device reuse check (existing protection) ───────────
      const { data: crossStudentDup } = await serviceClient
        .from('webauthn_credentials')
        .select('student_id')
        .eq('credential_id', credential.id)
        .neq('student_id', profile.id)
        .maybeSingle();

      if (crossStudentDup) {
        await serviceClient.from('device_reuse_flags').insert({
          device_attestation_id: credential.id,
          student_a: crossStudentDup.student_id,
          student_b: profile.id,
        });
        return jsonResponse({ error: 'Credential already registered to another student' }, 409);
      }

      // ── [FIX #2] One active credential per student ────────────────────────
      // Check whether this student already has an ACTIVE credential for a
      // DIFFERENT device. Re-enrolling the same device (e.g. after revocation)
      // is allowed and handled by the upsert below.
      const { data: otherActive } = await serviceClient
        .from('webauthn_credentials')
        .select('id')
        .eq('student_id', profile.id)
        .is('revoked_at', null)
        .neq('credential_id', credential.id)
        .maybeSingle();

      if (otherActive) {
        return jsonResponse(
          {
            error:
              'You already have an active biometric credential enrolled. ' +
              'Ask your lecturer to revoke your existing credential before enrolling a new device.',
          },
          409,
        );
      }
      // ─────────────────────────────────────────────────────────────────────

      // Upsert on credential_id:
      //   - New device → inserts a new row.
      //   - Re-registering a previously revoked device → clears revoked_at.
      await serviceClient.from('webauthn_credentials').upsert(
        {
          student_id: profile.id,
          credential_id: credential.id,
          public_key: encodeBytea(credential.publicKey),
          counter: credential.counter,
          aaguid,
          device_attestation_id: credentialDeviceType,
          enrolled_by: enrolledBy,
          enrolled_at: new Date().toISOString(),
          revoked_at: null,   // clears revocation if re-enrolling same device
          revoked_by: null,
        },
        { onConflict: 'credential_id' },
      );

      await serviceClient
        .from('webauthn_challenges')
        .delete()
        .eq('id', challengeRow.id);

      return jsonResponse({ verified: true });
    }

    return jsonResponse({ error: 'Invalid step' }, 400);
  } catch (err) {
    if (err instanceof Response) return err;
    try {
      console.error('webauthn-register error', {
        message: err?.message ?? String(err),
        stack: err?.stack ?? null,
        // Do not log full request body to avoid sensitive data exposure;
        // only log a small summary helpful for debugging.
        bodySummary: {
          step: typeof body !== 'undefined' ? (body as any)?.step : undefined,
          rpID: typeof body !== 'undefined' ? (body as any)?.rpID : undefined,
          origin: typeof body !== 'undefined' ? (body as any)?.origin : undefined,
        },
      });
    } catch (logErr) {
      console.error('webauthn-register logging failure', logErr);
    }
    const errorDetails = (err as any)?.message || String(err);
    return jsonResponse({ error: errorDetails || 'Internal server error' }, 500);
  }
});

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireStudent } from '../_shared/auth.ts';
import { getWebauthnConfig } from '../_shared/webauthn.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const step = body.step as 'options' | 'verify';

    // ── Step 1: Generate registration options ──
    if (step === 'options') {
      const { profile, serviceClient } = await requireStudent(req);
      const { rpID, rpName } = getWebauthnConfig(req);

      // Fetch active credentials to prevent duplicate registration
      const { data: existing } = await serviceClient
        .from('webauthn_credentials')
        .select('credential_id')
        .eq('student_id', profile.id)
        .is('revoked_at', null);

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: profile.matric_number ?? profile.id,
        userDisplayName: profile.full_name,
        attestationType: 'none',
        excludeCredentials: (existing ?? []).map((cred: { credential_id: string }) => ({
          id: cred.credential_id,
          type: 'public-key' as const,
        })),
      });

      // Save challenge in DB (expires in 5 minutes)
      await serviceClient.from('webauthn_challenges').insert({
        user_id: profile.id,
        challenge: options.challenge,
        challenge_type: 'registration',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      return jsonResponse({ options });
    }

    // ── Step 2: Verify registration response ──
    if (step === 'verify') {
      const { profile, serviceClient } = await requireStudent(req);
      const { rpID, origin } = getWebauthnConfig(req);
      const { attestationResponse } = body;

      if (!attestationResponse) {
        return jsonResponse({ error: 'Missing attestation response' }, 400);
      }

      // Retrieve valid non-expired challenge from DB
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
        return jsonResponse({ error: 'Registration challenge expired or not found' }, 400);
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

      // Save credential in DB
      await serviceClient.from('webauthn_credentials').upsert(
        {
          student_id: profile.id,
          credential_id: credential.id,
          public_key: credential.publicKey,
          counter: credential.counter,
          aaguid,
          device_attestation_id: credentialDeviceType,
          enrolled_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: 'credential_id' },
      );

      // Clean up challenge
      await serviceClient
        .from('webauthn_challenges')
        .delete()
        .eq('id', challengeRow.id);

      return jsonResponse({ verified: true });
    }

    return jsonResponse({ error: 'Invalid step' }, 400);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

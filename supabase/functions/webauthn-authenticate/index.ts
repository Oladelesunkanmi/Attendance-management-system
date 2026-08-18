import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
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

    // ── Step 1: Generate authentication options ──
    if (step === 'options') {
      const { profile, serviceClient } = await requireStudent(req);
      const { rpID } = getWebauthnConfig(req);

      const { data: credentials } = await serviceClient
        .from('webauthn_credentials')
        .select('credential_id')
        .eq('student_id', profile.id)
        .is('revoked_at', null);

      if (!credentials?.length) {
        return jsonResponse({ error: 'No active WebAuthn credential found' }, 400);
      }

      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: credentials.map((cred: { credential_id: string }) => ({
          id: cred.credential_id,
          type: 'public-key' as const,
        })),
      });

      await serviceClient.from('webauthn_challenges').insert({
        user_id: profile.id,
        challenge: options.challenge,
        challenge_type: 'authentication',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      return jsonResponse({ options });
    }

    // ── Step 2: Verify assertion response ──
    if (step === 'verify') {
      const { profile, serviceClient } = await requireStudent(req);
      const { rpID, origin } = getWebauthnConfig(req);
      const { assertionResponse } = body;

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
        return jsonResponse({ error: 'Authentication challenge expired or not found' }, 400);
      }

      const { data: credential } = await serviceClient
        .from('webauthn_credentials')
        .select('*')
        .eq('student_id', profile.id)
        .eq('credential_id', assertionResponse.id)
        .is('revoked_at', null)
        .single();

      if (!credential) {
        return jsonResponse({ error: 'Credential not found or revoked' }, 404);
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
        return jsonResponse({ error: 'Authentication verification failed' }, 400);
      }

      // Update counter (replay attack protection)
      await serviceClient
        .from('webauthn_credentials')
        .update({ counter: verification.authenticationInfo.newCounter })
        .eq('id', credential.id);

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

import { Router } from 'express';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { requireStudent } from '../middleware/auth.js';
import { getWebauthnConfig } from '../lib/webauthn.js';

export const webauthnAuthenticateRouter = Router();

webauthnAuthenticateRouter.post('/', requireStudent, async (req, res) => {
  try {
    const { profile, serviceClient } = req.auth!;
    const step = req.body.step as 'options' | 'verify';

    // ── Step 1: Generate authentication options ──
    if (step === 'options') {
      const { rpID } = getWebauthnConfig(req);

      const { data: credentials } = await serviceClient
        .from('webauthn_credentials')
        .select('credential_id')
        .eq('student_id', profile.id)
        .is('revoked_at', null);

      if (!credentials?.length) {
        res.status(400).json({ error: 'No active WebAuthn credential found' });
        return;
      }

      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: credentials.map((cred: { credential_id: string }) => ({
          id: cred.credential_id,
          type: 'public-key' as const,
        })),
        userVerification: 'required', // Force biometric prompt
      });

      await serviceClient.from('webauthn_challenges').insert({
        user_id: profile.id,
        challenge: options.challenge,
        challenge_type: 'authentication',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      res.json({ options });
      return;
    }

    // ── Step 2: Verify assertion response ──
    if (step === 'verify') {
      const { rpID, origin } = getWebauthnConfig(req);
      const { assertionResponse } = req.body;

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
        res.status(400).json({ error: 'Authentication challenge expired or not found' });
        return;
      }

      const { data: credential } = await serviceClient
        .from('webauthn_credentials')
        .select('*')
        .eq('student_id', profile.id)
        .eq('credential_id', assertionResponse.id)
        .is('revoked_at', null)
        .single();

      if (!credential) {
        res.status(404).json({ error: 'Credential not found or revoked' });
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
        res.status(400).json({ error: 'Authentication verification failed' });
        return;
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

      res.json({ verified: true });
      return;
    }

    res.status(400).json({ error: 'Invalid step' });
  } catch (err) {
    console.error('[webauthn-authenticate]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

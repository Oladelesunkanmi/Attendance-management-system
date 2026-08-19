import { Router } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { requireStudent } from '../middleware/auth.js';
import { getWebauthnConfig } from '../lib/webauthn.js';

export const webauthnRegisterRouter = Router();

webauthnRegisterRouter.post('/', requireStudent, async (req, res) => {
  try {
    const { profile, serviceClient } = req.auth!;
    const step = req.body.step as 'options' | 'verify';

    // ── Step 1: Generate registration options ──
    if (step === 'options') {
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
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // Strictly require FaceID/Fingerprint built into the device
          userVerification: 'required',        // Strictly require biometric verification
          residentKey: 'required',             // Store credential on device
        },
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

      res.json({ options });
      return;
    }

    // ── Step 2: Verify registration response ──
    if (step === 'verify') {
      const { rpID, origin } = getWebauthnConfig(req);
      const { attestationResponse, enrolmentPin } = req.body;

      if (!attestationResponse) {
        res.status(400).json({ error: 'Missing attestation response' });
        return;
      }

      if (!enrolmentPin) {
        res.status(400).json({ error: 'Missing enrolment PIN' });
        return;
      }

      // Verify and consume the PIN
      const { data: pinRecord, error: pinError } = await serviceClient
        .from('enrolment_pins')
        .select('id, lecturer_id')
        .eq('pin', enrolmentPin)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (pinError || !pinRecord) {
        res.status(403).json({ error: 'Invalid or expired enrolment PIN. Please ask your lecturer for a new one.' });
        return;
      }

      // Mark PIN as used
      await serviceClient
        .from('enrolment_pins')
        .update({ used_at: new Date().toISOString() })
        .eq('id', pinRecord.id);

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
        res.status(400).json({ error: 'Registration challenge expired or not found' });
        return;
      }

      const verification = await verifyRegistrationResponse({
        response: attestationResponse,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        res.status(400).json({ error: 'Registration verification failed' });
        return;
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
          enrolled_by: pinRecord.lecturer_id,
          enrolled_at: new Date().toISOString(),
          revoked_at: null,
          revoked_by: null,
        },
        { onConflict: 'credential_id' },
      );

      // Clean up challenge
      await serviceClient
        .from('webauthn_challenges')
        .delete()
        .eq('id', challengeRow.id);

      res.json({ verified: true });
      return;
    }

    res.status(400).json({ error: 'Invalid step' });
  } catch (err) {
    console.error('[webauthn-register]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@11';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireStudent } from '../_shared/auth.ts';

function webauthnConfig() {
  const rpID = Deno.env.get('WEBAUTHN_RP_ID');
  const origin = Deno.env.get('WEBAUTHN_ORIGIN');
  const rpName = Deno.env.get('WEBAUTHN_RP_NAME') ?? 'Attendance System';
  if (!rpID || !origin) throw new Error('WebAuthn env vars missing');
  return { rpID, origin, rpName };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const step = body.step as 'options' | 'verify';

    if (step === 'options') {
      const { profile, serviceClient } = await requireStudent(req);
      const { rpID, rpName } = webauthnConfig();

      const { data: existing } = await serviceClient
        .from('webauthn_credentials')
        .select('credential_id')
        .eq('student_id', profile.id);

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: profile.matric_number ?? profile.id,
        userDisplayName: profile.full_name,
        attestationType: 'none',
        excludeCredentials: (existing ?? []).map((cred) => ({
          id: cred.credential_id,
          type: 'public-key' as const,
        })),
      });

      await serviceClient.from('webauthn_challenges').insert({
        user_id: profile.id,
        challenge: options.challenge,
        challenge_type: 'registration',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      return jsonResponse({ options });
    }

    if (step === 'verify') {
      const { profile, serviceClient } = await requireStudent(req);
      const { rpID, origin } = webauthnConfig();
      const { attestationResponse, enrolledByLecturerId } = body;

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

      const { data: duplicateCred } = await serviceClient
        .from('webauthn_credentials')
        .select('student_id')
        .eq('credential_id', credential.id)
        .maybeSingle();

      if (duplicateCred && duplicateCred.student_id !== profile.id) {
        await serviceClient.from('device_reuse_flags').insert({
          device_attestation_id: credential.id,
          student_a: duplicateCred.student_id,
          student_b: profile.id,
        });
        return jsonResponse({ error: 'Credential already registered to another student' }, 409);
      }

      let enrolledBy = enrolledByLecturerId ?? null;
      if (enrolledBy) {
        const { data: lecturer } = await serviceClient
          .from('profiles')
          .select('id, role')
          .eq('id', enrolledBy)
          .single();
        if (!lecturer || lecturer.role !== 'lecturer') enrolledBy = null;
      }

      await serviceClient.from('webauthn_credentials').upsert({
        student_id: profile.id,
        credential_id: credential.id,
        public_key: credential.publicKey,
        counter: credential.counter,
        aaguid,
        device_attestation_id: credentialDeviceType,
        enrolled_by: enrolledBy,
      });

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

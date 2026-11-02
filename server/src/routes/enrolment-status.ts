import { Router } from 'express';
import { requireStudent } from '../middleware/auth.js';

/**
 * Reports whether the signed-in student already holds an active WebAuthn
 * credential.
 *
 * The browser cannot answer this itself: `webauthn_credentials` is locked to
 * `using (false)` in RLS so no client can read key material. The service
 * client here bypasses that policy and returns only the fact of enrolment —
 * never the credential id, public key or attestation data.
 */
export const enrolmentStatusRouter = Router();

enrolmentStatusRouter.post('/', requireStudent, async (req, res) => {
  try {
    const { profile, serviceClient } = req.auth!;

    // "Active" is the same definition the enrolment and check-in flows use:
    // a row that exists and has not been revoked.
    const { data, error } = await serviceClient
      .from('webauthn_credentials')
      .select('id, enrolled_at')
      .eq('student_id', profile.id)
      .is('revoked_at', null)
      .order('enrolled_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      // A failed read must not be reported as "not enrolled" — that would
      // re-open enrolment for a student who already has a passkey.
      console.error('[enrolment-status]', error);
      res.status(500).json({ error: 'Could not read enrolment status' });
      return;
    }

    res.json({
      hasActiveCredential: !!data,
      enrolledAt: data?.enrolled_at ?? null,
    });
  } catch (err) {
    console.error('[enrolment-status]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

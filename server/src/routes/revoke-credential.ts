import { Router } from 'express';
import { requireLecturer } from '../middleware/auth.js';

/**
 * Lecturer-only endpoint for managing student WebAuthn credentials.
 *
 * Actions:
 *   'lookup' — find a student by matric number and return their active
 *              credential status (does not expose key material).
 *   'revoke' — soft-delete a student's active credential so they can
 *              re-enrol on a new device. The old credential row is
 *              retained for audit purposes with revoked_at set.
 */
export const revokeCredentialRouter = Router();

revokeCredentialRouter.post('/', requireLecturer, async (req, res) => {
  try {
    const { profile, serviceClient } = req.auth!;
    const { action, matricNumber, studentId } = req.body as {
      action: 'lookup' | 'revoke';
      matricNumber?: string;
      studentId?: string;
    };

    // ── lookup ───────────────────────────────────────────────────────────────
    if (action === 'lookup') {
      if (!matricNumber) {
        res.status(400).json({ error: 'matricNumber is required' });
        return;
      }

      const { data: student } = await serviceClient
        .from('profiles')
        .select('id, full_name')
        .eq('matric_number', matricNumber.trim())
        .eq('role', 'student')
        .maybeSingle();

      if (!student) {
        res.status(404).json({ error: 'Student not found' });
        return;
      }

      const { data: credential } = await serviceClient
        .from('webauthn_credentials')
        .select('id, enrolled_at, aaguid, enrolled_by')
        .eq('student_id', student.id)
        .is('revoked_at', null)
        .maybeSingle();

      res.json({
        studentId: student.id,
        studentName: student.full_name,
        hasActiveCredential: !!credential,
        enrolledAt: credential?.enrolled_at ?? null,
        credentialId: credential?.id ?? null,
      });
      return;
    }

    // ── revoke ───────────────────────────────────────────────────────────────
    if (action === 'revoke') {
      if (!studentId) {
        res.status(400).json({ error: 'studentId is required' });
        return;
      }

      const { data: updated, error: revokeError } = await serviceClient
        .from('webauthn_credentials')
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: profile.id,      // record which lecturer revoked it
        })
        .eq('student_id', studentId)
        .is('revoked_at', null)        // only revoke the currently active one
        .select('id')
        .maybeSingle();

      if (revokeError) {
        console.error('Revocation error:', revokeError);
        res.status(500).json({ error: 'Failed to revoke credential' });
        return;
      }

      if (!updated) {
        res.status(404).json({ error: 'No active credential found for this student' });
        return;
      }

      res.json({ revoked: true });
      return;
    }

    res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error('[revoke-credential]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireLecturer } from '../_shared/auth.ts';

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
Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { profile, serviceClient } = await requireLecturer(req);
    const body = await req.json();
    const { action, matricNumber, studentId } = body as {
      action: 'lookup' | 'revoke';
      matricNumber?: string;
      studentId?: string;
    };

    // ── lookup ───────────────────────────────────────────────────────────────
    if (action === 'lookup') {
      if (!matricNumber) {
        return jsonResponse({ error: 'matricNumber is required' }, 400);
      }

      const { data: student } = await serviceClient
        .from('profiles')
        .select('id, full_name')
        .eq('matric_number', matricNumber.trim())
        .eq('role', 'student')
        .maybeSingle();

      if (!student) {
        return jsonResponse({ error: 'Student not found' }, 404);
      }

      const { data: credential } = await serviceClient
        .from('webauthn_credentials')
        .select('id, enrolled_at, aaguid, enrolled_by')
        .eq('student_id', student.id)
        .is('revoked_at', null)
        .maybeSingle();

      return jsonResponse({
        studentId: student.id,
        studentName: student.full_name,
        hasActiveCredential: !!credential,
        enrolledAt: credential?.enrolled_at ?? null,
        credentialId: credential?.id ?? null,
      });
    }

    // ── revoke ───────────────────────────────────────────────────────────────
    if (action === 'revoke') {
      if (!studentId) {
        return jsonResponse({ error: 'studentId is required' }, 400);
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
        return jsonResponse({ error: 'Failed to revoke credential' }, 500);
      }

      if (!updated) {
        return jsonResponse({ error: 'No active credential found for this student' }, 404);
      }

      return jsonResponse({ revoked: true });
    }

    return jsonResponse({ error: 'Invalid action' }, 400);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

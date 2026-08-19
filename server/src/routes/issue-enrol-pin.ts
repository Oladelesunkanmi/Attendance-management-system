import { Router } from 'express';
import { webcrypto } from 'node:crypto';
import { requireLecturer } from '../middleware/auth.js';

/** PIN is valid for 5 minutes — enough for one supervised enrolment. */
const PIN_TTL_SECONDS = 300;

/**
 * Generates a cryptographically random 6-digit PIN using the Web Crypto API.
 * Math.random() is NOT used here — it is not cryptographically secure.
 */
function generatePin(): string {
  const bytes = new Uint8Array(4);
  webcrypto.getRandomValues(bytes);
  const num = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return num.toString().padStart(6, '0');
}

export const issueEnrolPinRouter = Router();

issueEnrolPinRouter.post('/', requireLecturer, async (req, res) => {
  try {
    // requireLecturer validates the Supabase Bearer token and confirms
    // the caller's role is 'lecturer' — no additional auth invented.
    const { profile, serviceClient } = req.auth!;

    console.log(`[Enrol PIN] Request received from lecturer: ${profile.full_name} (${profile.id})`);

    // Invalidate any previous unused PINs from this lecturer so there is
    // never more than one live PIN per lecturer at a time.
    const { count } = await serviceClient
      .from('enrolment_pins')
      .update({ used_at: new Date().toISOString() })
      .eq('lecturer_id', profile.id)
      .is('used_at', null)
      .select('*', { count: 'exact' });
      
    if (count && count > 0) {
      console.log(`[Enrol PIN] Invalidated ${count} previous unused PIN(s) for this lecturer`);
    }

    const pin = generatePin();
    const expiresAt = new Date(Date.now() + PIN_TTL_SECONDS * 1000);

    const { error } = await serviceClient.from('enrolment_pins').insert({
      pin,
      lecturer_id: profile.id,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      console.error('[Enrol PIN] Failed to store PIN:', error);
      res.status(500).json({ error: 'Failed to generate PIN' });
      return;
    }

    console.log(`[Enrol PIN] Successfully generated new PIN: ${pin} (expires at ${expiresAt.toISOString()})`);

    // Return the PIN to the lecturer's screen only.
    // The student never receives it directly — they enter it manually.
    res.json({ pin, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

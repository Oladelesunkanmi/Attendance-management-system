import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireLecturer } from '../_shared/auth.ts';

/** PIN is valid for 5 minutes — enough for one supervised enrolment. */
const PIN_TTL_SECONDS = 300;

/**
 * Generates a cryptographically random 6-digit PIN using the Web Crypto API.
 * Math.random() is NOT used here — it is not cryptographically secure.
 */
function generatePin(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const num = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return num.toString().padStart(6, '0');
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    // requireLecturer validates the Supabase Bearer token and confirms
    // the caller's role is 'lecturer' — no additional auth invented.
    const { profile, serviceClient } = await requireLecturer(req);

    // Invalidate any previous unused PINs from this lecturer so there is
    // never more than one live PIN per lecturer at a time.
    await serviceClient
      .from('enrolment_pins')
      .update({ used_at: new Date().toISOString() })
      .eq('lecturer_id', profile.id)
      .is('used_at', null);

    const pin = generatePin();
    const expiresAt = new Date(Date.now() + PIN_TTL_SECONDS * 1000);

    const { error } = await serviceClient.from('enrolment_pins').insert({
      pin,
      lecturer_id: profile.id,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      console.error('Failed to store PIN:', error);
      return jsonResponse({ error: 'Failed to generate PIN' }, 500);
    }

    // Return the PIN to the lecturer's screen only.
    // The student never receives it directly — they enter it manually.
    return jsonResponse({ pin, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

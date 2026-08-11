import { SignJWT } from 'npm:jose@5';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { requireLecturer } from '../_shared/auth.ts';

const TOKEN_TTL_SECONDS = 30;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { profile, serviceClient } = await requireLecturer(req);
    const { sessionId } = await req.json();

    if (!sessionId) {
      return jsonResponse({ error: 'sessionId is required' }, 400);
    }

    const { data: session, error: sessionError } = await serviceClient
      .from('sessions')
      .select('id, is_active, course_id, courses!inner(lecturer_id)')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return jsonResponse({ error: 'Session not found' }, 404);
    }

    const course = session.courses as { lecturer_id: string };
    if (course.lecturer_id !== profile.id) {
      return jsonResponse({ error: 'Not authorized for this session' }, 403);
    }

    if (!session.is_active) {
      return jsonResponse({ error: 'Session is not active' }, 400);
    }

    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

    const { error: nonceError } = await serviceClient.from('qr_token_nonces').insert({
      jti,
      session_id: sessionId,
    });

    if (nonceError) {
      return jsonResponse({ error: 'Failed to issue token' }, 500);
    }

    const secret = Deno.env.get('QR_JWT_SECRET');
    if (!secret) {
      return jsonResponse({ error: 'Server misconfigured' }, 500);
    }

    const token = await new SignJWT({ session_id: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
      .sign(new TextEncoder().encode(secret));

    return jsonResponse({ token, jti, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

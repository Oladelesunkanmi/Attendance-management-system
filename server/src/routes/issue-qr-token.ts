import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { requireLecturer } from '../middleware/auth.js';

const TOKEN_TTL_SECONDS = 180;

export const issueQrTokenRouter = Router();

issueQrTokenRouter.post('/', requireLecturer, async (req, res) => {
  try {
    const { profile, serviceClient } = req.auth!;
    const { sessionId } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const { data: session, error: sessionError } = await serviceClient
      .from('sessions')
      .select('id, is_active, course_id, courses!inner(lecturer_id)')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const course = session.courses as unknown as { lecturer_id: string };
    if (course.lecturer_id !== profile.id) {
      res.status(403).json({ error: 'Not authorized for this session' });
      return;
    }

    if (!session.is_active) {
      res.status(400).json({ error: 'Session is not active' });
      return;
    }

    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

    const { error: nonceError } = await serviceClient.from('qr_token_nonces').insert({
      jti,
      session_id: sessionId,
    });

    if (nonceError) {
      res.status(500).json({ error: 'Failed to issue token' });
      return;
    }

    const secret = process.env.QR_JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'Server misconfigured' });
      return;
    }

    const token = await new SignJWT({ session_id: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
      .sign(new TextEncoder().encode(secret));

    res.json({ token, jti, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error('[issue-qr-token]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

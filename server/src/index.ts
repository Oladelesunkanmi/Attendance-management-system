import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { webauthnRegisterRouter } from './routes/webauthn-register.js';
import { webauthnAuthenticateRouter } from './routes/webauthn-authenticate.js';
import { verifyCheckinRouter } from './routes/verify-checkin.js';
import { issueQrTokenRouter } from './routes/issue-qr-token.js';
import { issueEnrolPinRouter } from './routes/issue-enrol-pin.js';
import { revokeCredentialRouter } from './routes/revoke-credential.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-client-info', 'apikey'],
}));
app.use(express.json());

// ── Request Logger ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/webauthn-register', webauthnRegisterRouter);
app.use('/api/webauthn-authenticate', webauthnAuthenticateRouter);
app.use('/api/verify-checkin', verifyCheckinRouter);
app.use('/api/issue-qr-token', issueQrTokenRouter);
app.use('/api/issue-enrol-pin', issueEnrolPinRouter);
app.use('/api/revoke-credential', revokeCredentialRouter);

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Global Error]', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Attendance API server running on http://localhost:${PORT}`);
});

export default app;

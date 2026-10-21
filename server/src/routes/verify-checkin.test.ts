import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { SignJWT } from 'jose';
import type { AddressInfo } from 'node:net';

const h = vi.hoisted(() => ({
  profile: null as any,
  serviceClient: null as any,
}));

vi.mock('../middleware/auth.js', () => ({
  requireStudent: (req: any, res: any, next: any) => {
    if (!h.profile) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    req.auth = {
      user: { id: h.profile.id },
      profile: h.profile,
      supabase: {},
      serviceClient: h.serviceClient,
    };
    next();
  },
  requireAuth: vi.fn(),
  requireLecturer: vi.fn(),
}));

vi.mock('../lib/webauthn.js', () => ({
  getWebauthnConfig: () => ({
    rpID: 'localhost',
    origin: 'http://localhost:5173',
    rpName: 'Attendance System',
  }),
}));

vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 7 },
  })),
}));

const { verifyCheckinRouter } = await import('./verify-checkin.js');

// ── A minimal Supabase client double that records when each query runs ────
interface QueryRecord {
  table: string;
  op: string;
  start: number;
  end: number;
}

class FakeBuilder {
  op = 'select';
  payload: any = undefined;
  filters: Array<[string, string, any]> = [];

  constructor(
    readonly client: FakeSupabase,
    readonly table: string,
  ) {}

  select() { return this; }
  eq(column: string, value: any) { this.filters.push(['eq', column, value]); return this; }
  is(column: string, value: any) { this.filters.push(['is', column, value]); return this; }
  gt(column: string, value: any) { this.filters.push(['gt', column, value]); return this; }
  order() { return this; }
  limit() { return this; }
  insert(payload: any) { this.op = 'insert'; this.payload = payload; return this; }
  update(payload: any) { this.op = 'update'; this.payload = payload; return this; }
  delete() { this.op = 'delete'; return this; }
  maybeSingle() { return this.client.execute(this); }
  single() { return this.client.execute(this); }
  then(onOk: any, onErr: any) { return this.client.execute(this).then(onOk, onErr); }
}

type Handler = (builder: FakeBuilder) => { data: any; error: any };

class FakeSupabase {
  queries: QueryRecord[] = [];
  handlers: Record<string, Handler> = {};
  /** Payloads of every write, keyed by table. */
  writes: Record<string, any[]> = {};
  /** Artificial per-query latency, in milliseconds. */
  latency = 0;
  private base = Date.now();

  from(table: string) {
    return new FakeBuilder(this, table);
  }

  async execute(builder: FakeBuilder) {
    const record: QueryRecord = {
      table: builder.table,
      op: builder.op,
      start: Date.now() - this.base,
      end: Date.now() - this.base,
    };
    this.queries.push(record);
    if (builder.payload !== undefined) {
      (this.writes[builder.table] ??= []).push(builder.payload);
    }
    if (this.latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latency));
    }
    record.end = Date.now() - this.base;
    const handler = this.handlers[builder.table];
    return handler ? handler(builder) : { data: null, error: null };
  }

  /** Queries against a table, in completion order. */
  callsTo(table: string) {
    return this.queries.filter((q) => q.table === table);
  }
}

// ── Test harness ──────────────────────────────────────────────────────────
const QR_SECRET = 'test-secret-value-that-is-long-enough-for-hs256';
const SESSION_ID = 'session-1';
const COURSE_ID = 'course-1';
const STUDENT_ID = 'student-1';
const JTI = 'jti-1';

const VENUE = { latitude: 6.5244, longitude: 3.3792, radius_meters: 100 };

let supabase: FakeSupabase;
let server: any;
let baseUrl: string;

async function issueToken(overrides: Record<string, any> = {}, expiresIn = '300s') {
  return new SignJWT({ session_id: SESSION_ID, verification_mode: 'full', ...overrides })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(overrides.jti ?? JTI)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(Uint8Array.from(new TextEncoder().encode(QR_SECRET)));
}

function defaultHandlers() {
  return {
    qr_token_nonces: (b: FakeBuilder) =>
      b.op === 'update'
        ? { data: null, error: null }
        : { data: { id: 'nonce-1', jti: JTI, session_id: SESSION_ID, consumed_at: null }, error: null },
    sessions: () => ({
      data: {
        id: SESSION_ID,
        course_id: COURSE_ID,
        is_active: true,
        verification_mode: 'full',
        venues: VENUE,
      },
      error: null,
    }),
    enrollments: (b: FakeBuilder) =>
      b.op === 'insert'
        ? { data: null, error: null }
        : { data: { id: 'enrolment-1' }, error: null },
    webauthn_challenges: (b: FakeBuilder) =>
      b.op === 'delete'
        ? { data: null, error: null }
        : { data: { id: 'challenge-1', challenge: 'expected-challenge' }, error: null },
    webauthn_credentials: (b: FakeBuilder) =>
      b.op === 'update'
        ? { data: null, error: null }
        : {
            data: { id: 'cred-1', credential_id: 'credential-1', public_key: 'key', counter: 3 },
            error: null,
          },
    rate_limit_buckets: (b: FakeBuilder) =>
      b.op === 'insert' || b.op === 'update'
        ? { data: null, error: null }
        : { data: null, error: null },
    attendance_records: (b: FakeBuilder) =>
      b.op === 'insert'
        ? { data: { id: 'record-1' }, error: null }
        : { data: null, error: null },
  } as Record<string, Handler>;
}

function post(body: any) {
  return fetch(`${baseUrl}/api/verify-checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_ASSERTION = {
  id: 'credential-1',
  rawId: 'credential-1',
  response: { clientDataJSON: 'x', authenticatorData: 'y', signature: 'z', userHandle: 'u' },
  type: 'public-key',
  clientExtensionResults: {},
  authenticatorAttachment: 'platform',
};

beforeEach(async () => {
  process.env.QR_JWT_SECRET = QR_SECRET;
  supabase = new FakeSupabase();
  supabase.handlers = defaultHandlers();
  h.profile = { id: STUDENT_ID, role: 'student', full_name: 'Test Student', matric_number: 'M1' };
  h.serviceClient = supabase;

  const app = express();
  app.use(express.json());
  app.use('/api/verify-checkin', verifyCheckinRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ── Tests ────────────────────────────────────────────────────────────────
describe('verify-checkin', () => {
  it('records attendance for a valid QR code', async () => {
    const token = await issueToken();
    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.flagged).toBe(false);

    const inserted = supabase.callsTo('attendance_records')[0];
    expect(inserted.op).toBe('insert');
    expect(inserted).toBeDefined();
  });

  it('stores the position, the accuracy and the WebAuthn result on the record', async () => {
    const token = await issueToken();
    await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });

    expect(supabase.writes.attendance_records).toHaveLength(1);
    expect(supabase.writes.attendance_records[0]).toMatchObject({
      session_id: SESSION_ID,
      student_id: STUDENT_ID,
      latitude: 6.5244,
      longitude: 3.3792,
      gps_accuracy_meters: 12,
      webauthn_verified: true,
    });
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = await new SignJWT({ session_id: SESSION_ID, verification_mode: 'full' })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(JTI)
      .setIssuedAt()
      .setExpirationTime('300s')
      .sign(Uint8Array.from(new TextEncoder().encode('a-completely-different-secret-value-here')));

    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Invalid or expired QR token');
  });

  it('rejects an expired token', async () => {
    const token = await issueToken({}, '1s');
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Invalid or expired QR token');
  });

  it('rejects a malformed token', async () => {
    const res = await post({
      qrToken: 'not-a-jwt',
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Invalid or expired QR token');
  });

  it('rejects a token whose nonce is unknown', async () => {
    supabase.handlers.qr_token_nonces = () => ({ data: null, error: null });
    const token = await issueToken();

    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('QR token not recognized');
  });

  it('rejects a token whose nonce was already consumed', async () => {
    supabase.handlers.qr_token_nonces = (b: FakeBuilder) =>
      b.op === 'update'
        ? { data: null, error: null }
        : { data: { id: 'nonce-1', jti: JTI, session_id: SESSION_ID, consumed_at: '2026-01-01T00:00:00Z' }, error: null };
    const token = await issueToken();

    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('QR token already used');
  });

  it('rejects a check-in for a session that is not active', async () => {
    supabase.handlers.sessions = () => ({
      data: { id: SESSION_ID, course_id: COURSE_ID, is_active: false, verification_mode: 'full', venues: VENUE },
      error: null,
    });
    const token = await issueToken();

    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Session is not active');
  });

  it('rejects a duplicate attendance record', async () => {
    supabase.handlers.attendance_records = () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    const token = await issueToken();

    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Already checked in for this session');
  });

  it('flags a student who is outside the geofence', async () => {
    const token = await issueToken();
    const res = await post({
      qrToken: token,
      latitude: 6.6,
      longitude: 3.4,
      gpsAccuracy: 10,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.flagged).toBe(true);
  });

  it('flags a position with poor accuracy', async () => {
    const token = await issueToken();
    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 250,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.flagged).toBe(true);
  });

  it('requires a WebAuthn assertion when the session is in full mode', async () => {
    const token = await issueToken();
    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 10,
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('WebAuthn assertion required');
  });

  it('rejects an unknown credential', async () => {
    supabase.handlers.webauthn_credentials = (b: FakeBuilder) =>
      b.op === 'update'
        ? { data: null, error: null }
        : { data: null, error: { code: 'PGRST116' } };
    const token = await issueToken();

    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 10,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Credential not found');
  });

  it('rejects an expired authentication challenge', async () => {
    supabase.handlers.webauthn_challenges = (b: FakeBuilder) =>
      b.op === 'delete'
        ? { data: null, error: null }
        : { data: null, error: null };
    const token = await issueToken();

    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 10,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Authentication challenge expired');
  });

  it('rate limits a student who exceeds the window allowance', async () => {
    supabase.handlers.rate_limit_buckets = (b: FakeBuilder) =>
      b.op === 'select'
        ? {
            data: {
              key: `checkin:${STUDENT_ID}`,
              count: 10,
              window_start: new Date().toISOString(),
            },
            error: null,
          }
        : { data: null, error: null };
    const token = await issueToken();

    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 10,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBe('Rate limit exceeded');
  });

  it('records the rate-limit hit even when the check-in is rejected later', async () => {
    supabase.handlers.qr_token_nonces = () => ({ data: null, error: null });
    const token = await issueToken();

    await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 10,
      assertionResponse: VALID_ASSERTION,
    });

    const writes = supabase.callsTo('rate_limit_buckets').filter((q) => q.op !== 'select');
    expect(writes.length).toBe(1);
  });

  it('runs the independent lookups concurrently instead of one after another', async () => {
    supabase.latency = 40;
    const token = await issueToken();

    await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });

    // The rate-limit bucket, the nonce lookup and the session lookup do not
    // depend on one another, so all three have to be in flight at the same time.
    const phaseOne = ['rate_limit_buckets', 'qr_token_nonces', 'sessions']
      .flatMap((table) => supabase.callsTo(table).filter((q) => q.op === 'select'))
      .sort((a, b) => a.start - b.start);

    expect(phaseOne).toHaveLength(3);
    const latestStart = Math.max(...phaseOne.map((q) => q.start));
    const earliestEnd = Math.min(...phaseOne.map((q) => q.end));
    expect(earliestEnd).toBeGreaterThan(latestStart);
  });

  it('consumes the nonce before inserting the attendance record', async () => {
    const token = await issueToken();
    await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });

    const consume = supabase.callsTo('qr_token_nonces').find((q) => q.op === 'update');
    const insert = supabase.callsTo('attendance_records').find((q) => q.op === 'insert');
    expect(consume).toBeDefined();
    expect(insert).toBeDefined();
    expect(insert!.start).toBeGreaterThanOrEqual(consume!.end);
  });

  it('reports the stage timings of the request', async () => {
    const token = await issueToken();
    const res = await post({
      qrToken: token,
      latitude: 6.5244,
      longitude: 3.3792,
      gpsAccuracy: 12,
      assertionResponse: VALID_ASSERTION,
    });
    const body = await res.json();

    expect(body.timings).toBeDefined();
    expect(typeof body.timings.readsMs).toBe('number');
    expect(typeof body.timings.totalMs).toBe('number');
    expect(res.headers.get('server-timing')).toContain('totalMs');
  });

  it('rejects a request that carries no fields', async () => {
    const res = await post({});
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Missing required check-in fields');
  });
});

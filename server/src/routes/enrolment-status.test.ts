import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
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

const { enrolmentStatusRouter } = await import('./enrolment-status.js');

// ── A Supabase double that records the filters the route applies ──────────
interface Filter {
  op: string;
  column: string;
  value: any;
}

class FakeBuilder {
  filters: Filter[] = [];

  constructor(readonly db: FakeSupabase) {}

  select() { return this; }
  eq(column: string, value: any) { this.filters.push({ op: 'eq', column, value }); return this; }
  is(column: string, value: any) { this.filters.push({ op: 'is', column, value }); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return this.db.execute(this); }
}

class FakeSupabase {
  /** Rows the credential lookup will return, newest first. */
  rows: any[] = [];
  error: any = null;
  queries: FakeBuilder[] = [];

  from(_table: string) {
    const builder = new FakeBuilder(this);
    this.queries.push(builder);
    return builder;
  }

  async execute(_builder: FakeBuilder) {
    return { data: this.rows[0] ?? null, error: this.error };
  }
}

// ── Test harness ─────────────────────────────────────────────────────────
const STUDENT_ID = 'student-1';
const ENROLLED_AT = '2026-10-01T10:00:00.000Z';

let supabase: FakeSupabase;
let server: any;
let baseUrl: string;

function post(body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/enrolment-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  supabase = new FakeSupabase();
  h.profile = { id: STUDENT_ID, role: 'student', full_name: 'Test Student', matric_number: 'M1' };
  h.serviceClient = supabase;

  const app = express();
  app.use(express.json());
  app.use('/api/enrolment-status', enrolmentStatusRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('enrolment-status', () => {
  it('reports an active credential and when it was enrolled', async () => {
    supabase.rows = [{ id: 'cred-1', enrolled_at: ENROLLED_AT }];

    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ hasActiveCredential: true, enrolledAt: ENROLLED_AT });
  });

  it('scopes the lookup to the caller and ignores revoked credentials', async () => {
    await post();

    expect(supabase.queries[0].filters).toEqual([
      { op: 'eq', column: 'student_id', value: STUDENT_ID },
      { op: 'is', column: 'revoked_at', value: null },
    ]);
  });

  it('reports no credential for a student who has never enrolled', async () => {
    supabase.rows = [];

    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ hasActiveCredential: false, enrolledAt: null });
  });

  it('never returns key material', async () => {
    supabase.rows = [{ id: 'cred-1', enrolled_at: ENROLLED_AT }];

    const body = await (await post()).json();

    expect(Object.keys(body).sort()).toEqual(['enrolledAt', 'hasActiveCredential']);
  });

  it('fails loudly instead of reporting "not enrolled" when the read errors', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    supabase.error = { message: 'boom' };

    const res = await post();

    expect(res.status).toBe(500);
    quiet.mockRestore();
  });

  it('requires an authenticated student', async () => {
    h.profile = null;

    const res = await post();

    expect(res.status).toBe(401);
  });
});

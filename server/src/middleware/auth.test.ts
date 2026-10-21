import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignJWT } from 'jose';

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  serviceClient: null as any,
  profileQueryStart: 0,
  getUserEnd: 0,
}));

vi.mock('../lib/supabase.js', () => ({
  createServiceClient: () => h.serviceClient,
  createUserClient: () => ({ auth: { getUser: h.getUser } }),
}));

const { requireAuth, requireStudent, requireLecturer } = await import('./auth.js');

const SECRET = 'middleware-test-secret-value-long-enough-for-hs256';

function makeRes() {
  const state: any = { statusCode: 0, body: undefined, finished: false };
  const res: any = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: any) {
      state.body = body;
      state.finished = true;
      return res;
    },
  };
  return { res, state };
}

function fakeServiceClient(profile: any, delayMs = 0) {
  const base = Date.now();
  const queries: Array<{ start: number; end: number }> = [];
  return {
    queries,
    from(_table: string) {
      const builder: any = {
        op: 'select',
        payload: undefined,
        select() { return builder; },
        eq() { return builder; },
        is() { return builder; },
        insert(p: any) { builder.op = 'insert'; builder.payload = p; return builder; },
        update(p: any) { builder.op = 'update'; builder.payload = p; return builder; },
        delete() { builder.op = 'delete'; return builder; },
        async maybeSingle() {
          const rec = { start: Date.now() - base, end: 0 };
          queries.push(rec);
          h.profileQueryStart = rec.start;
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          rec.end = Date.now() - base;
          return { data: profile, error: null };
        },
        async single() {
          const rec = { start: Date.now() - base, end: 0 };
          queries.push(rec);
          h.profileQueryStart = rec.start;
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          rec.end = Date.now() - base;
          return { data: profile, error: null };
        },
        then(onOk: any, onErr: any) {
          return builder.maybeSingle().then(onOk, onErr);
        },
      };
      return builder;
    },
  };
}

async function makeToken(role: string, id = 'user-1') {
  return new SignJWT({ role, sub: id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('300s')
    .sign(Uint8Array.from(new TextEncoder().encode(SECRET)));
}

beforeEach(() => {
  h.getUser.mockReset();
  h.profileQueryStart = 0;
  h.getUserEnd = 0;
});

describe('requireAuth', () => {
  it('rejects a request without an authorization header', async () => {
    const { res, state } = makeRes();
    const next = vi.fn();

    await requireAuth({ headers: {} } as any, res, next);

    expect(state.statusCode).toBe(401);
    expect(state.body.error).toBe('Missing authorization header');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid token', async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad token' } });
    h.serviceClient = fakeServiceClient({ id: 'user-1', role: 'student' });

    const { res, state } = makeRes();
    const next = vi.fn();

    await requireAuth({ headers: { authorization: 'Bearer whatever' } } as any, res, next);

    expect(state.statusCode).toBe(401);
    expect(state.body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token whose profile is missing', async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    h.serviceClient = fakeServiceClient(null);

    const { res, state } = makeRes();
    const next = vi.fn();

    await requireAuth({ headers: { authorization: 'Bearer whatever' } } as any, res, next);

    expect(state.statusCode).toBe(403);
    expect(state.body.error).toBe('Profile not found');
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches the profile and continues for a valid token', async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    h.serviceClient = fakeServiceClient({
      id: 'user-1',
      role: 'student',
      full_name: 'Test Student',
      matric_number: 'M1',
    });

    const { res, state } = makeRes();
    const next = vi.fn();
    const req: any = { headers: { authorization: 'Bearer whatever' } };

    await requireAuth(req, res, next);

    expect(state.finished).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth.profile.id).toBe('user-1');
    expect(req.auth.profile.role).toBe('student');
  });

  it('looks the profile up while the token is still being validated', async () => {
    h.getUser.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
      h.getUserEnd = Date.now();
      return { data: { user: { id: 'user-1' } }, error: null };
    });
    h.serviceClient = fakeServiceClient(
      { id: 'user-1', role: 'student', full_name: 'Test Student', matric_number: 'M1' },
      40,
    );

    const { res } = makeRes();
    const next = vi.fn();

    const startedAt = Date.now();
    await requireAuth({ headers: { authorization: `Bearer ${await makeToken('student')}` } } as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // The profile query has to have been in flight before the token
    // validation finished, otherwise the two are still serialised.
    expect(h.profileQueryStart).toBeLessThan(h.getUserEnd - startedAt);
  });
});

describe('requireStudent', () => {
  it('lets a student through', async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    h.serviceClient = fakeServiceClient({
      id: 'user-1',
      role: 'student',
      full_name: 'Test Student',
      matric_number: 'M1',
    });

    const { res } = makeRes();
    const next = vi.fn();

    await requireStudent({ headers: { authorization: 'Bearer whatever' } } as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a lecturer', async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null });
    h.serviceClient = fakeServiceClient({
      id: 'user-2',
      role: 'lecturer',
      full_name: 'Test Lecturer',
      matric_number: null,
    });

    const { res, state } = makeRes();
    const next = vi.fn();

    await requireStudent({ headers: { authorization: 'Bearer whatever' } } as any, res, next);

    expect(state.statusCode).toBe(403);
    expect(state.body.error).toBe('Student access required');
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireLecturer', () => {
  it('rejects a student', async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    h.serviceClient = fakeServiceClient({
      id: 'user-1',
      role: 'student',
      full_name: 'Test Student',
      matric_number: 'M1',
    });

    const { res, state } = makeRes();
    const next = vi.fn();

    await requireLecturer({ headers: { authorization: 'Bearer whatever' } } as any, res, next);

    expect(state.statusCode).toBe(403);
    expect(state.body.error).toBe('Lecturer access required');
    expect(next).not.toHaveBeenCalled();
  });
});

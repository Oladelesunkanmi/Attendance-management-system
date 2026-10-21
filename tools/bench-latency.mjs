/**
 * Read-only latency benchmark for the attendance check-in path.
 *
 * Measures the Supabase PostgREST round-trip cost that dominates the
 * server-side portion of `POST /api/verify-checkin`, and compares the
 * current fully-sequential query order against a parallelised one.
 *
 * Run:  node tools/bench-latency.mjs
 * Env:  reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...loadEnv(path.join(root, '.env')), ...loadEnv(path.join(root, '.env.local')) };
const URL_BASE = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;

if (!URL_BASE || !KEY) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const REST = `${URL_BASE}/rest/v1`;

/** One PostgREST round trip. Returns { ms, status, rows }. */
async function rest(pathname, { method = 'GET', body, preferCount } = {}) {
  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (preferCount) headers.Prefer = 'count=exact';

  const t0 = performance.now();
  const res = await fetch(`${REST}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    rows = text.slice(0, 120);
  }
  return { ms, status: res.status, rows };
}

function stats(label, samples) {
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  console.log(
    `${label.padEnd(46)} n=${String(s.length).padStart(3)}  ` +
    `mean=${(sum / s.length).toFixed(1).padStart(7)}ms  ` +
    `p50=${pct(50).toFixed(1).padStart(7)}ms  ` +
    `p95=${pct(95).toFixed(1).padStart(7)}ms  ` +
    `min=${s[0].toFixed(1).padStart(6)}ms  max=${s[s.length - 1].toFixed(1).padStart(6)}ms`,
  );
  return { mean: sum / s.length, p50: pct(50) };
}

async function main() {
  console.log(`Target: ${URL_BASE}\n`);

  // ── 1. Baseline: cost of a single trivial PostgREST round trip ───────────
  const single = [];
  for (let i = 0; i < 20; i++) {
    const r = await rest('/sessions?select=id&limit=1');
    if (i === 0) console.log(`  (probe status ${r.status})`);
    single.push(r.ms);
  }
  stats('1 round trip (sessions?select=id&limit=1)', single);

  // ── 2. Cost of a JOIN query (the expensive one in verify-checkin) ───────
  const joined = [];
  for (let i = 0; i < 10; i++) {
    const r = await rest('/sessions?select=*,venues(*),courses(id)&limit=1');
    joined.push(r.ms);
  }
  stats('1 round trip (sessions + venues + courses join)', joined);

  // ── 3. Session id for session-scoped query shapes ──────────────────────
  // The anon key is RLS-filtered to zero rows, so we cannot read a live
  // session. The *round-trip cost* of a query does not depend on whether it
  // matches rows, so we use a synthetic id and measure the transport cost.
  const sessionId = '00000000-0000-0000-0000-000000000000';
  console.log('\n  (anon key is RLS-filtered; using synthetic ids to measure transport cost)');

  // The 9 read queries verify-checkin performs, in the order it performs them.
  const reads = [
    ['profiles (requireAuth)', '/profiles?select=id,role,full_name,matric_number&limit=1'],
    ['rate_limit_buckets (rate limit read)', '/rate_limit_buckets?select=*&limit=1'],
    ['qr_token_nonces (nonce check)', '/qr_token_nonces?select=*&eq=session_id,eq.${sessionId}&limit=1'],
    ['sessions (+venues,+courses)', `/sessions?select=*,venues(*),courses(id)&eq=id,eq.${sessionId}&limit=1`],
    ['enrollments (auto-enrol check)', '/enrollments?select=id&limit=1'],
    ['webauthn_challenges (challenge lookup)', '/webauthn_challenges?select=*&limit=1'],
    ['webauthn_credentials (credential lookup)', '/webauthn_credentials?select=*&limit=1'],
    ['qr_token_nonces (consume update)', '/qr_token_nonces?select=*&eq=session_id,eq.${sessionId}&limit=1'],
    ['attendance_records (history read)', '/attendance_records?select=*&limit=8'],
  ];

  // ── 4. Sequential: exactly how the route does it today ─────────────────
  const seqTotal = [];
  for (let run = 0; run < 8; run++) {
    const t0 = performance.now();
    for (const [, p] of reads) await rest(p);
    seqTotal.push(performance.now() - t0);
  }
  const seq = stats('SEQUENTIAL (current order, 9 queries)', seqTotal);

  // ── 5. Parallel: the same 9 queries fired concurrently ─────────────────
  const parTotal = [];
  for (let run = 0; run < 8; run++) {
    const t0 = performance.now();
    await Promise.all(reads.map(([, p]) => rest(p)));
    parTotal.push(performance.now() - t0);
  }
  const par = stats('PARALLEL (same 9 queries)', parTotal);

  console.log(
    `\n  => parallelising the independent read phase saves ` +
    `${(seq.mean - par.mean).toFixed(1)}ms on average ` +
    `(${((1 - par.mean / seq.mean) * 100).toFixed(0)}% of the DB stage).`,
  );

  // ── 6. Auth server round trip (requireAuth does supabase.auth.getUser) ─
  const authSamples = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await fetch(`${URL_BASE}/auth/v1/settings`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    authSamples.push(performance.now() - t0);
  }
  stats('GoTrue auth-server round trip (settings)', authSamples);

  // ── 6b. Raw network floor: TLS handshake + a bare HTTPS round trip ────
  const tlsSamples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await fetch(`${URL_BASE}/rest/v1/`, {
      headers: { apikey: KEY },
      // force a fresh connection each time to expose handshake cost
      ...(i % 2 === 0 ? {} : { keepalive: false }),
    });
    tlsSamples.push(performance.now() - t0);
  }
  stats('Bare HTTPS GET /rest/v1/ (handshake + root)', tlsSamples);

  // ── 7. Critical-path model: old (serial) vs new (phased) ───────────────
  // Writes are modelled as round trips of the same cost as the measured
  // reads; no production write is issued by this script.
  const roundTrip = single.reduce((a, b) => a + b, 0) / single.length;

  const OLD_ROUND_TRIPS = 14; // auth(2) + rate limit(2) + nonce + session +
                              // enrollment + challenge + credential +
                              // counter update + challenge delete +
                              // nonce consume + attendance insert
  const NEW_PHASES = [
    ['auth (getUser + profile in parallel)', 1],
    ['phase 1 (rate limit + nonce + session)', 1],
    ['phase 2 (enrolment + challenge + credential)', 1],
    ['phase 3 (counter + challenge delete + nonce consume)', 1],
    ['phase 4 (attendance insert)', 1],
  ];

  console.log('\n  Critical path of one FULL-mode check-in (DB round trips only):');
  console.log(`    mean round trip cost: ${roundTrip.toFixed(1)}ms`);

  // Measure the old shape for real: N round trips back to back.
  const oldStart = performance.now();
  for (let i = 0; i < OLD_ROUND_TRIPS; i++) {
    await rest('/sessions?select=id&limit=1');
  }
  const oldMs = performance.now() - oldStart;

  // Measure the new shape for real: each phase issues its queries at once.
  const phaseQueries = [
    ['/sessions?select=id&limit=1'],
    ['/rate_limit_buckets?select=*&limit=1'],
    ['/qr_token_nonces?select=*&limit=1'],
    ['/enrollments?select=id&limit=1'],
    ['/webauthn_challenges?select=*&limit=1'],
    ['/webauthn_credentials?select=*&limit=1'],
    ['/sessions?select=*,venues(*),courses(id)&limit=1'],
  ];
  const newStart = performance.now();
  await Promise.all(phaseQueries[0].map((p) => rest(p)));   // auth
  await Promise.all(phaseQueries.slice(1, 4).map((p) => rest(p)));
  await Promise.all(phaseQueries.slice(4).map((p) => rest(p)));
  await Promise.all([rest('/sessions?select=id&limit=1')]);
  await Promise.all([rest('/sessions?select=id&limit=1')]);
  const newMs = performance.now() - newStart;

  console.log(`    OLD (${OLD_ROUND_TRIPS} sequential round trips): ${oldMs.toFixed(0)}ms`);
  console.log(`    NEW (${NEW_PHASES.length} phases, issued in parallel): ${newMs.toFixed(0)}ms`);
  console.log(
    `    => the DB stage of one check-in is about ` +
    `${(oldMs - newMs).toFixed(0)}ms faster ` +
    `(${((1 - newMs / oldMs) * 100).toFixed(0)}% less waiting).`,
  );
  console.log('\n  Phase breakdown of the new shape:');
  for (const [name, trips] of NEW_PHASES) {
    console.log(`    ${trips} round trip(s)  ${name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

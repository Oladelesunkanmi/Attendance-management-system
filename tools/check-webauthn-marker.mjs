/**
 * Checks that profiles.webauthn_credential_id agrees with the newest active
 * row in webauthn_credentials, for every student.
 *
 * This is the backfill check for 20261102000000_profiles_webauthn_marker.sql:
 * a mismatch means the profile marker and the credential table disagree, which
 * is what the marker's trigger exists to prevent.
 *
 * Needs a service-role key, because webauthn_credentials is locked to
 * `using (false)` in RLS and the anon key would read it as empty.
 *
 * Usage:  node tools/check-webauthn-marker.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const PAGE = 1000;

function loadEnv() {
  const env = { ...process.env };
  for (const file of ['server/.env', '.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.trimStart().startsWith('#')) continue;
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (env[key]) continue; // a real environment variable wins
      env[key] = raw.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Set both in server/.env — the key must be the service role one.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

const [profiles, credentials] = await Promise.all([
  fetchAll('profiles', 'id, full_name, matric_number, webauthn_credential_id'),
  fetchAll('webauthn_credentials', 'student_id, credential_id, enrolled_at, revoked_at'),
]);

// What the marker *should* be: the newest non-revoked credential per student.
const newestActive = new Map();
for (const credential of credentials) {
  if (!credential.student_id || credential.revoked_at) continue;
  const current = newestActive.get(credential.student_id);
  const isNewer =
    !current ||
    new Date(credential.enrolled_at ?? 0) >= new Date(current.enrolled_at ?? 0);
  if (isNewer) newestActive.set(credential.student_id, credential);
}

const mismatches = [];
for (const profile of profiles) {
  const expected = newestActive.get(profile.id)?.credential_id ?? null;
  const actual = profile.webauthn_credential_id ?? null;
  if (expected !== actual) mismatches.push({ profile, expected, actual });
}

const profileIds = new Set(profiles.map((p) => p.id));
const orphans = [...newestActive.keys()].filter((id) => !profileIds.has(id));

console.log(`profiles:                  ${profiles.length}`);
console.log(`with an active credential: ${newestActive.size}`);
console.log(`carrying a profile marker: ${profiles.filter((p) => p.webauthn_credential_id).length}`);
console.log(`mismatches:                ${mismatches.length}`);

if (orphans.length) {
  console.log(`\n${orphans.length} credential(s) point at a student with no profile row:`);
  for (const id of orphans.slice(0, 10)) console.log(`  ${id}`);
}

if (mismatches.length) {
  console.log('\nFirst 10 mismatches (profile marker vs newest active credential):');
  for (const { profile, expected, actual } of mismatches.slice(0, 10)) {
    console.log(`  ${profile.matric_number ?? profile.id}  ${profile.full_name ?? ''}`);
    console.log(`    marker:    ${actual ?? '(none)'}`);
    console.log(`    should be: ${expected ?? '(none)'}`);
  }
  process.exit(1);
}

console.log('\nMarker and credential table agree for every student.');

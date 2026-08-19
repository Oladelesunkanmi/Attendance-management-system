import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

/**
 * Service-role client — bypasses RLS.
 * Use for server-side operations on tables blocked from anon/authenticated access.
 */
export function createServiceClient(): SupabaseClient {
  return createClient(
    getEnv('SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );
}

/**
 * User-scoped client — respects RLS for the given user's JWT.
 */
export function createUserClient(token: string): SupabaseClient {
  return createClient(
    getEnv('SUPABASE_URL'),
    getEnv('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

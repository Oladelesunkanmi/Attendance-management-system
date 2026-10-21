import type { SupabaseClient } from '@supabase/supabase-js';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

export interface RateLimitCheck {
  key: string;
  /** False when the caller has exhausted the window. */
  allowed: boolean;
  /** The count to store, or null when the bucket has to be created. */
  count: number | null;
  /** True when the stored window has expired and has to be restarted. */
  resetWindow: boolean;
}

/**
 * Reads the caller's current rate-limit bucket and decides whether the
 * request may proceed. The bucket is not written here so that this lookup can
 * run alongside the other independent reads of a check-in.
 */
export async function checkRateLimit(
  serviceClient: SupabaseClient,
  key: string,
): Promise<RateLimitCheck> {
  const now = new Date();
  const { data: bucket } = await serviceClient
    .from('rate_limit_buckets')
    .select('*')
    .eq('key', key)
    .maybeSingle();

  if (!bucket) {
    return { key, allowed: true, count: null, resetWindow: false };
  }

  const windowStart = new Date(bucket.window_start);
  if (now.getTime() - windowStart.getTime() > WINDOW_MS) {
    return { key, allowed: true, count: null, resetWindow: true };
  }

  if (bucket.count >= MAX_REQUESTS) {
    return { key, allowed: false, count: null, resetWindow: false };
  }

  return { key, allowed: true, count: bucket.count + 1, resetWindow: false };
}

/**
 * Stores the hit counted by `checkRateLimit`. Every allowed attempt is
 * recorded, including attempts that are rejected later on, so that the limit
 * keeps protecting the endpoint.
 */
export async function recordRateLimitHit(
  serviceClient: SupabaseClient,
  check: RateLimitCheck,
): Promise<void> {
  if (!check.allowed) return;
  const now = new Date().toISOString();

  if (check.count === null) {
    if (check.resetWindow) {
      await serviceClient
        .from('rate_limit_buckets')
        .update({ count: 1, window_start: now })
        .eq('key', check.key);
    } else {
      await serviceClient.from('rate_limit_buckets').insert({
        key: check.key,
        count: 1,
        window_start: now,
      });
    }
    return;
  }

  await serviceClient
    .from('rate_limit_buckets')
    .update({ count: check.count })
    .eq('key', check.key);
}

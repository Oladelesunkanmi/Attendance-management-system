const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

export async function checkRateLimit(
  serviceClient: ReturnType<typeof import('./auth.ts').createServiceClient>,
  key: string,
): Promise<boolean> {
  const now = new Date();
  const { data: bucket } = await serviceClient
    .from('rate_limit_buckets')
    .select('*')
    .eq('key', key)
    .maybeSingle();

  if (!bucket) {
    await serviceClient.from('rate_limit_buckets').insert({
      key,
      count: 1,
      window_start: now.toISOString(),
    });
    return true;
  }

  const windowStart = new Date(bucket.window_start);
  if (now.getTime() - windowStart.getTime() > WINDOW_MS) {
    await serviceClient
      .from('rate_limit_buckets')
      .update({ count: 1, window_start: now.toISOString() })
      .eq('key', key);
    return true;
  }

  if (bucket.count >= MAX_REQUESTS) return false;

  await serviceClient
    .from('rate_limit_buckets')
    .update({ count: bucket.count + 1 })
    .eq('key', key);

  return true;
}

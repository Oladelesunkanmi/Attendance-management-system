import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient<Database>(
  supabaseUrl ?? 'http://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder',
);

// VITE_API_URL is configured per environment and may carry a trailing slash.
// Without this trim, `${API_URL}/api/x` becomes `//api/x` and the Express
// router answers 404 for a path that plainly exists.
const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/**
 * Call the Express API backend (replaces Supabase Edge Function invocation).
 */
export async function callApi<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${API_URL}/api/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  // A wrong host or path answers with HTML, so parse defensively: letting
  // JSON.parse throw on "<!DOCTYPE" hides the status code that explains it.
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      res.ok
        ? `API "${name}" returned a non-JSON response`
        : `API "${name}" failed (${res.status}) at ${API_URL}/api/${name}`,
    );
  }

  if (!res.ok) {
    const message = (json as { error?: string } | null)?.error;
    throw new Error(message || `API "${name}" failed (${res.status})`);
  }

  return json as T;
}

/** @deprecated Use callApi instead — kept as alias for migration convenience */
export const callEdgeFunction = callApi;

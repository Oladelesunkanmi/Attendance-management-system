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

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

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

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error || `API "${name}" failed (${res.status})`);
  }

  return json as T;
}

/** @deprecated Use callApi instead — kept as alias for migration convenience */
export const callEdgeFunction = callApi;

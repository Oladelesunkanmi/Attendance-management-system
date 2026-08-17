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

export async function callEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    let errorMsg = error.message;
    // Extract custom JSON error if returned from Edge Function Response
    const contextResponse = (error as any).context;
    if (contextResponse) {
      try {
        const resObj = typeof contextResponse.clone === 'function' ? contextResponse.clone() : contextResponse;
        if (typeof resObj.json === 'function') {
          const errJson = await resObj.json();
          if (errJson?.error) errorMsg = errJson.error;
          else if (errJson?.message) errorMsg = errJson.message;
        }
      } catch {
        // ignore fallback to error.message
      }
    }
    throw new Error(errorMsg || `Edge Function "${name}" failed. Make sure it is deployed to Supabase.`);
  }

  return data as T;
}

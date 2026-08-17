import { createClient, SupabaseClient, User } from 'npm:@supabase/supabase-js@2';
import { jsonResponse } from './cors.ts';

export type AuthContext = {
  user: User;
  profile: {
    id: string;
    role: 'student' | 'lecturer';
    full_name: string;
    matric_number: string | null;
  };
  supabase: SupabaseClient;
  serviceClient: SupabaseClient;
};

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function createServiceClient() {
  return createClient(
    getEnv('SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw jsonResponse({ error: 'Missing authorization header' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(
    getEnv('SUPABASE_URL'),
    getEnv('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw jsonResponse({ error: 'Invalid or expired token' }, 401);
  }

  const serviceClient = createServiceClient();
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('id, role, full_name, matric_number')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw jsonResponse({ error: 'Profile not found' }, 403);
  }

  return { user, profile, supabase, serviceClient };
}

export async function requireLecturer(req: Request): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  if (ctx.profile.role !== 'lecturer') {
    throw jsonResponse({ error: 'Lecturer access required' }, 403);
  }
  return ctx;
}

export async function requireStudent(req: Request): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  if (ctx.profile.role !== 'student') {
    throw jsonResponse({ error: 'Student access required' }, 403);
  }
  return ctx;
}

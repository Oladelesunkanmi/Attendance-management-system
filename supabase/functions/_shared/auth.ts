import { createClient, SupabaseClient, User } from 'npm:@supabase/supabase-js@2';

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
    throw new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(
    getEnv('SUPABASE_URL'),
    getEnv('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createServiceClient();
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('id, role, full_name, matric_number')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Response(JSON.stringify({ error: 'Profile not found' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { user, profile, supabase, serviceClient };
}

export async function requireLecturer(req: Request): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  if (ctx.profile.role !== 'lecturer') {
    throw new Response(JSON.stringify({ error: 'Lecturer access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return ctx;
}

export async function requireStudent(req: Request): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  if (ctx.profile.role !== 'student') {
    throw new Response(JSON.stringify({ error: 'Student access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return ctx;
}

import type { Request, Response, NextFunction } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { decodeJwt } from 'jose';
import { createServiceClient, createUserClient } from '../lib/supabase.js';

export interface AuthContext {
  user: User;
  profile: {
    id: string;
    role: 'student' | 'lecturer';
    full_name: string;
    matric_number: string | null;
  };
  supabase: SupabaseClient;
  serviceClient: SupabaseClient;
}

// Augment Express Request to include our auth context
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const PROFILE_COLUMNS = 'id, role, full_name, matric_number';

/**
 * Base auth middleware — validates Supabase JWT and loads profile.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createUserClient(token);

  const serviceClient = createServiceClient();

  // The subject is read from the token without verifying it, which lets the
  // profile lookup run while the token is being validated. The row is only
  // used once the authoritative user id returned by getUser() matches it, so
  // an unverified token can never grant access to another account.
  let subject: string | undefined;
  try {
    subject = decodeJwt(token).sub;
  } catch {
    subject = undefined;
  }

  const profilePromise = subject
    ? serviceClient
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', subject)
        .maybeSingle()
    : null;

  // Start fetching user and profile concurrently
  const getUserPromise = supabase.auth.getUser();
  const profilePromise = subject
    ? serviceClient
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', subject)
        .maybeSingle()
    : null;

  const [{ data: { user }, error }] = await Promise.all([getUserPromise]);
  if (error || !user) {
    // Ensure any pending profile fetch does not cause unhandled rejections
    if (profilePromise) await Promise.resolve(profilePromise).catch(() => undefined);
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  let profile: AuthContext['profile'] | null = null;

  if (profilePromise && subject === user.id) {
    const { data } = await profilePromise;
    profile = data as AuthContext['profile'] | null;
  } else {
    const { data } = await serviceClient
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', user.id)
      .single();
    profile = data as AuthContext['profile'] | null;
  }

  if (!profile) {
    res.status(403).json({ error: 'Profile not found' });
    return;
  }

  req.auth = { user, profile, supabase, serviceClient };
  next();
}

/**
 * Requires the authenticated user to be a lecturer.
 */
export async function requireLecturer(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (!req.auth) return; // requireAuth already sent a response
    if (req.auth.profile.role !== 'lecturer') {
      res.status(403).json({ error: 'Lecturer access required' });
      return;
    }
    next();
  });
}

/**
 * Requires the authenticated user to be a student.
 */
export async function requireStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (!req.auth) return; // requireAuth already sent a response
    if (req.auth.profile.role !== 'student') {
      res.status(403).json({ error: 'Student access required' });
      return;
    }
    next();
  });
}

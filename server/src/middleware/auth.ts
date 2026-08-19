import type { Request, Response, NextFunction } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
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

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const serviceClient = createServiceClient();
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('id, role, full_name, matric_number')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
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

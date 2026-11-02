import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { callApi } from '../lib/supabase';

/**
 * Fired after a credential is created or revoked so that every mounted view
 * (the layout's navigation in particular) re-reads the student's status.
 */
const CREDENTIAL_CHANGED_EVENT = 'webauthn-credential-changed';

type EnrolmentStatus = {
  hasActiveCredential: boolean;
  enrolledAt: string | null;
};

export function notifyCredentialChanged() {
  window.dispatchEvent(new Event(CREDENTIAL_CHANGED_EVENT));
}

/**
 * Whether the signed-in student currently holds an active WebAuthn credential.
 * `null` until the first lookup finishes, so callers can avoid flashing a
 * "not enrolled" state before the answer is known.
 *
 * The answer comes from the API rather than the database: `webauthn_credentials`
 * is locked to `using (false)` in RLS, so a direct client select always reads
 * as "not enrolled" even for a student who has already registered.
 */
export function useHasCredential() {
  const { profile } = useAuth();
  const [hasCredential, setHasCredential] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!profile) {
      setHasCredential(null);
      return;
    }

    try {
      const status = await callApi<EnrolmentStatus>('enrolment-status', {});
      setHasCredential(status.hasActiveCredential);
    } catch (err) {
      // Fail open: an unreachable API must not hide the enrolment entry point
      // from a student who still needs it.
      console.warn('Could not read enrolment status:', err);
    }
  }, [profile]);

  useEffect(() => {
    refresh();
    window.addEventListener(CREDENTIAL_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CREDENTIAL_CHANGED_EVENT, refresh);
  }, [refresh]);

  return { hasCredential, refresh };
}

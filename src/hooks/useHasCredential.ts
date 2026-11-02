import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

/**
 * Fired after a credential is created or revoked so that every mounted view
 * (the layout's navigation in particular) re-reads the student's status.
 */
const CREDENTIAL_CHANGED_EVENT = 'webauthn-credential-changed';

export function notifyCredentialChanged() {
  window.dispatchEvent(new Event(CREDENTIAL_CHANGED_EVENT));
}

/**
 * Whether the signed-in student currently holds an active WebAuthn credential.
 * `null` until the first lookup finishes, so callers can avoid flashing a
 * "not enrolled" state before the answer is known.
 */
export function useHasCredential() {
  const { profile } = useAuth();
  const [hasCredential, setHasCredential] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!profile) {
      setHasCredential(null);
      return;
    }

    const { data } = await supabase
      .from('webauthn_credentials')
      .select('id')
      .eq('student_id', profile.id)
      .is('revoked_at', null)
      .limit(1);

    setHasCredential((data?.length ?? 0) > 0);
  }, [profile]);

  useEffect(() => {
    refresh();
    window.addEventListener(CREDENTIAL_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CREDENTIAL_CHANGED_EVENT, refresh);
  }, [refresh]);

  return { hasCredential, refresh };
}

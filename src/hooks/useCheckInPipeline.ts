import { useState } from 'react';
import {
  startAuthentication,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { callEdgeFunction } from '../lib/supabase';
import { getStablePosition } from '../lib/geo';
import { queueCheckIn } from '../lib/queue';
import type { CheckInStep } from '../types/checkin';

interface UseCheckInPipelineProps {
  onSuccess: () => Promise<void>;
}

export function useCheckInPipeline({ onSuccess }: UseCheckInPipelineProps) {
  const [step, setStep] = useState<CheckInStep>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ flagged: boolean; message: string } | null>(null);

  async function executeCheckIn(qrToken: string) {
    setError(null);
    setLastResult(null);

    try {
      // 1. GPS Position Stage
      setStep('gps');
      setStatus('Acquiring high-accuracy GPS fix…');
      const position = await getStablePosition(2);

      // 2. WebAuthn Biometric Stage
      setStep('biometric');
      setStatus('Authenticating device passkey (Touch ID / Face ID)…');

      let options: PublicKeyCredentialRequestOptionsJSON | undefined;
      try {
        const res = await callEdgeFunction<{ options: PublicKeyCredentialRequestOptionsJSON }>(
          'webauthn-authenticate',
          { step: 'options' },
        );
        options = res.options;
      } catch (err) {
        if (!navigator.onLine) {
          console.warn('Offline during webauthn options request');
        } else {
          throw err;
        }
      }

      let assertionResponse: AuthenticationResponseJSON | undefined;
      if (options) {
        try {
          assertionResponse = await startAuthentication({ optionsJSON: options });
        } catch (biometricErr) {
          console.warn('Biometric auth cancelled or failed:', biometricErr);
          assertionResponse = undefined;
        }
      }

      const checkInPayload = {
        qrToken,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        gpsAccuracy: position.coords.accuracy,
        assertionResponse,
      };

      // 3. Submitting to server (or queueing if offline)
      setStep('submitting');
      setStatus('Submitting attendance record…');

      if (!navigator.onLine) {
        await queueCheckIn(checkInPayload);
        setStep('queued');
        setStatus('Offline mode. Check-in queued in local storage and will sync upon reconnect.');

        if ('serviceWorker' in navigator && 'SyncManager' in window) {
          const reg = await navigator.serviceWorker.ready;
          await (reg as any).sync.register('sync-checkins');
        }
        return;
      }

      try {
        const result = await callEdgeFunction<{
          success: boolean;
          flagged: boolean;
        }>('verify-checkin', checkInPayload);

        setStep('success');
        setLastResult({
          flagged: result.flagged,
          message: result.flagged
            ? 'Checked in with flags (e.g. outside geofence boundary) for lecturer review.'
            : 'Attendance recorded & verified successfully!',
        });
        setStatus(null);
        await onSuccess();
      } catch (err) {
        const isNetworkError = !navigator.onLine || (err instanceof TypeError && err.message.includes('fetch'));
        if (isNetworkError) {
          await queueCheckIn(checkInPayload);
          setStep('queued');
          setStatus('Connection dropped. Check-in queued locally and will retry automatically.');

          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            const reg = await navigator.serviceWorker.ready;
            await (reg as any).sync.register('sync-checkins');
          }
        } else {
          throw err;
        }
      }
    } catch (err) {
      setStep('idle');
      setError(err instanceof Error ? err.message : 'Check-in failed. Please try again.');
    }
  }

  return {
    step,
    setStep,
    status,
    setStatus,
    error,
    setError,
    lastResult,
    setLastResult,
    executeCheckIn,
  };
}

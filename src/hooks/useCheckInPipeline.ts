import { useCallback, useRef, useState } from 'react';
import {
  startAuthentication,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { callEdgeFunction } from '../lib/supabase';
import {
  getStablePosition,
  isLocationPermissionGranted,
  isRetryablePositionError,
} from '../lib/geo';
import { queueCheckIn } from '../lib/queue';
import type { CheckInStep } from '../types/checkin';

type VerificationMode = 'qr_only' | 'qr_geofence' | 'full';

export interface CheckInTimings {
  /** Time from the QR being captured to the check-in being submitted. */
  prepareMs?: number;
  gpsMs?: number;
  optionsMs?: number;
  webauthnMs?: number;
  submitMs?: number;
  totalMs?: number;
}

interface UseCheckInPipelineProps {
  onSuccess: () => Promise<void>;
}

interface QrPayload {
  session_id?: string;
  verification_mode?: VerificationMode;
  exp?: number;
}

interface PreparedCheckIn {
  qrToken: string;
  startedAt: number;
  gps?: Promise<GeolocationPosition>;
  options?: Promise<PublicKeyCredentialRequestOptionsJSON>;
  optionsFetchedAt?: number;
}

/**
 * A WebAuthn challenge is only valid for a few minutes, so a challenge that
 * was prepared long before the student confirms the check-in is refreshed.
 */
const OPTIONS_MAX_AGE_MS = 90_000;

/**
 * Decodes the payload of a session QR token. The result is unverified — it is
 * only used to decide which verification stages have to run. The server
 * validates the token signature independently.
 */
export function decodeQrPayload(qrToken: string): QrPayload | null {
  try {
    const parts = qrToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Not a valid session QR token.');
    }
    const base64Url = parts[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) {
      base64 += '='.repeat(4 - pad);
    }
    const jsonPayload = decodeURIComponent(
      window.atob(base64)
        .split('')
        .map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(''),
    );
    const payload = JSON.parse(jsonPayload);
    return payload && typeof payload === 'object' ? (payload as QrPayload) : null;
  } catch {
    return null;
  }
}

export function useCheckInPipeline({ onSuccess }: UseCheckInPipelineProps) {
  const [step, setStep] = useState<CheckInStep>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    flagged: boolean;
    message: string;
    durationMs?: number;
  } | null>(null);
  const [gpsComplete, setGpsComplete] = useState(true);

  // Guards against a second submission being started while one is in flight.
  const inFlightRef = useRef(false);
  const preparedRef = useRef<PreparedCheckIn | null>(null);
  const gpsRef = useRef<{ promise: Promise<GeolocationPosition>; startedAt: number } | null>(null);

  const fetchWebauthnOptions = useCallback(async () => {
    const res = await callEdgeFunction<{ options: PublicKeyCredentialRequestOptionsJSON }>(
      'webauthn-authenticate',
      { step: 'options' },
    );
    return res.options;
  }, []);

  /**
   * Starts the position fix, if one has not been started already. Sharing a
   * single promise between the early preparation and the actual check-in means
   * the device never runs two acquisitions for the same check-in.
   */
  const ensureGps = useCallback((): Promise<GeolocationPosition> => {
    if (!gpsRef.current) {
      const attempt = getStablePosition(2);
      // Mark the promise as handled so a failure that happens before anybody
      // awaits it does not surface as an unhandled rejection.
      attempt.catch(() => undefined);
      gpsRef.current = { promise: attempt, startedAt: performance.now() };
    }
    return gpsRef.current.promise;
  }, []);

  /**
   * Called as soon as the QR code has been captured. Everything that does not
   * need the student to do anything is started here, so that by the time the
   * student confirms the check-in the position fix and the WebAuthn challenge
   * are already on their way.
   */
  const prepare = useCallback(
    (qrToken: string) => {
      const payload = decodeQrPayload(qrToken);
      if (!payload) {
        preparedRef.current = null;
        return;
      }

      const mode: VerificationMode = payload.verification_mode ?? 'full';
      const prepared: PreparedCheckIn = {
        qrToken,
        startedAt: performance.now(),
      };
      preparedRef.current = prepared;

      // The challenge is a plain network round trip — no user interaction — so
      // it can run entirely in the background. The age is recorded when the
      // request goes out, so that a student who confirms while it is still in
      // flight reuses it instead of asking for a second one.
      if (mode === 'full') {
        prepared.optionsFetchedAt = Date.now();
        const options = fetchWebauthnOptions();
        options.catch(() => undefined);
        prepared.options = options;
      }

      // Only start the position fix this early when the student has already
      // granted location access, so that a permission prompt is never shown
      // before they ask for it.
      if (mode !== 'qr_only') {
        void isLocationPermissionGranted().then((granted) => {
          if (granted && preparedRef.current === prepared) {
            void ensureGps().then(
              () => undefined,
              () => undefined,
            );
          }
        });
      }
    },
    [ensureGps, fetchWebauthnOptions],
  );

  const executeCheckIn = useCallback(
    async (qrToken: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const totalStart = performance.now();
      const timings: CheckInTimings = {};

      try {
        setError(null);
        setLastResult(null);

        const payload = decodeQrPayload(qrToken);
        if (!payload) {
          throw new Error(
            'Invalid QR code format: Not a valid session QR token. Please make sure you are scanning a valid session QR code.',
          );
        }

        const mode: VerificationMode = payload.verification_mode ?? 'full';
        const requiresBiometrics = mode === 'full';
        const requiresGps = mode !== 'qr_only';

        const prepared =
          preparedRef.current?.qrToken === qrToken ? preparedRef.current : null;
        timings.prepareMs = Math.round(performance.now() - (prepared?.startedAt ?? totalStart));

        // ── Stage 1: position fix and WebAuthn challenge run concurrently ──
        const gpsPromise = requiresGps ? ensureGps() : null;
        const optionsPromise =
          requiresBiometrics &&
          prepared?.options &&
          Date.now() - (prepared.optionsFetchedAt ?? 0) < OPTIONS_MAX_AGE_MS
            ? prepared.options
            : requiresBiometrics
              ? fetchWebauthnOptions()
              : null;

        if (requiresGps) {
          setStep('gps');
          setStatus('Acquiring high-accuracy GPS fix…');
        }

        let assertionResponse: AuthenticationResponseJSON | undefined;

        if (requiresBiometrics) {
          setStep('biometric');
          setStatus('Authenticating device passkey (Touch ID / Face ID)…');

          const optionsStart = performance.now();
          let options: PublicKeyCredentialRequestOptionsJSON | undefined;
          try {
            options = await optionsPromise!;
          } catch (err) {
            if (!navigator.onLine) {
              console.warn('Offline during webauthn options request');
            } else {
              throw err;
            }
          }
          timings.optionsMs = Math.round(performance.now() - optionsStart);

          if (options) {
            const webauthnStart = performance.now();
            try {
              assertionResponse = await startAuthentication({ optionsJSON: options });
            } catch (biometricErr) {
              console.warn('Biometric auth cancelled or failed:', biometricErr);
              assertionResponse = undefined;
            }
            timings.webauthnMs = Math.round(performance.now() - webauthnStart);
          }
        }

        // ── Stage 2: the position fix has been running alongside the above ──
        let position: GeolocationPosition | null = null;
        if (requiresGps) {
          setGpsComplete(false);
          const gpsStartedAt = gpsRef.current?.startedAt ?? totalStart;
          try {
            position = await gpsPromise!;
          } catch (gpsError) {
            if (!isRetryablePositionError(gpsError)) throw gpsError;
            // The early attempt never locked onto a satellite — try once more.
            gpsRef.current = null;
            position = await ensureGps();
          }
          timings.gpsMs = Math.round(performance.now() - gpsStartedAt);
          setGpsComplete(true);
        }

        const checkInPayload = {
          qrToken,
          latitude: position?.coords.latitude ?? 0,
          longitude: position?.coords.longitude ?? 0,
          gpsAccuracy: position?.coords.accuracy ?? 0,
          assertionResponse,
        };

        // ── Stage 3: submitting to server (or queueing if offline) ──
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

        const submitStart = performance.now();
        try {
          const result = await callEdgeFunction<{
            success: boolean;
            flagged: boolean;
          }>('verify-checkin', checkInPayload);
          timings.submitMs = Math.round(performance.now() - submitStart);

          const durationMs = Math.round(performance.now() - totalStart);
          timings.totalMs = durationMs;

          setStep('success');
          setLastResult({
            flagged: result.flagged,
            message: result.flagged
              ? 'Checked in with flags (e.g. outside geofence boundary) for lecturer review.'
              : 'Attendance recorded & verified successfully!',
            durationMs,
          });
          setStatus(null);
          console.info('[checkin] timings', timings);
          await onSuccess();
        } catch (err) {
          const isNetworkError =
            !navigator.onLine || (err instanceof TypeError && err.message.includes('fetch'));
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
        setGpsComplete(false);
        setError(err instanceof Error ? err.message : 'Check-in failed. Please try again.');
      } finally {
        // Releases the lock so a legitimate retry after a failure still works.
        inFlightRef.current = false;
        preparedRef.current = null;
        gpsRef.current = null;
      }
    },
    [ensureGps, fetchWebauthnOptions, onSuccess],
  );

  return {
    step,
    setStep,
    status,
    setStatus,
    error,
    setError,
    lastResult,
    setLastResult,
    gpsComplete,
    prepare,
    executeCheckIn,
  };
}

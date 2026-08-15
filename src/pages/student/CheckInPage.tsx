import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import { useAuth } from '../../contexts/AuthContext';
import { callEdgeFunction, supabase } from '../../lib/supabase';
import { getStablePosition } from '../../lib/geo';
import { queueCheckIn } from '../../lib/queue';
import { ErrorText } from '../../components/ui';
import StudentLayout from '../../components/StudentLayout';

type AttendanceItem = {
  id: string;
  checked_in_at: string;
  distance_meters: number;
  gps_accuracy_meters: number | null;
  webauthn_verified: boolean;
  flagged_reason: string | null;
  sessions?: {
    started_at: string;
    courses?: { code: string; title: string } | null;
    venues?: { name: string } | null;
  } | null;
};

type CheckInStep = 'idle' | 'scanning' | 'gps' | 'biometric' | 'submitting' | 'success' | 'queued';

export default function CheckInPage() {
  const { profile } = useAuth();
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // ── Scanner state ──────────────────────────────────────────────────────────
  const [isScanning, setIsScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [tokenTimeLeft, setTokenTimeLeft] = useState<number>(30);

  // ── Check-in workflow state ────────────────────────────────────────────────
  const [step, setStep] = useState<CheckInStep>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ flagged: boolean; message: string } | null>(null);

  // ── Student Stats & Records ────────────────────────────────────────────────
  const [hasCredential, setHasCredential] = useState<boolean | null>(null);
  const [history, setHistory] = useState<AttendanceItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ── Inline biometric enrolment state ─────────────────────────────────────
  const [enrolLoading, setEnrolLoading] = useState(false);
  const [enrolStatus, setEnrolStatus] = useState<string | null>(null);
  const [enrolError, setEnrolError] = useState<string | null>(null);

  async function handleInlineEnrol() {
    if (!profile) return;
    setEnrolLoading(true);
    setEnrolError(null);
    setEnrolStatus(null);
    try {
      // ── Check device supports fingerprint / Face ID ──────────────────────
      const supported = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!supported) {
        setEnrolError(
          'Your device or browser does not support fingerprint / Face ID authentication. ' +
          'Make sure you have a fingerprint or screen lock set up in your device settings, ' +
          'then try again in Chrome or Safari.',
        );
        return;
      }

      const currentRpId = window.location.hostname;
      const currentOrigin = window.location.origin;
      const { options } = await callEdgeFunction<{ options: PublicKeyCredentialCreationOptionsJSON }>(
        'webauthn-register',
        { step: 'options', rpID: currentRpId, origin: currentOrigin },
      );

      // Force platform authenticator only (fingerprint / Face ID on the device).
      // Cross-device (USB keys, phones via Bluetooth) are explicitly excluded.
      options.authenticatorSelection = {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      };

      // Ensure rp.id matches the current domain
      if (options.rp && currentRpId !== 'localhost') options.rp.id = currentRpId;

      const attestationResponse = await startRegistration({ optionsJSON: options });
      await callEdgeFunction('webauthn-register', {
        step: 'verify',
        attestationResponse,
        rpID: currentRpId,
        origin: currentOrigin,
      });
      setEnrolStatus('Biometric enrolled! You can now check in with Face ID / Fingerprint.');
      setHasCredential(true);
    } catch (err: any) {
      console.error('Enrolment error:', err?.name, err?.message, err);
      // Give actionable messages for common WebAuthn errors
      if (err?.name === 'NotAllowedError') {
        setEnrolError('Biometric prompt was cancelled or timed out. Please try again.');
      } else if (err?.name === 'InvalidStateError') {
        setEnrolError('This device is already registered. You only need to enrol once.');
      } else if (err?.name === 'SecurityError') {
        setEnrolError('Security error: the app domain does not match the expected origin. Contact support.');
      } else {
        setEnrolError(`[${err?.name ?? 'Error'}] ${err?.message ?? String(err)}`);
      }
    } finally {
      setEnrolLoading(false);
    }
  }

  // ── Load student credential status and recent attendance ───────────────────
  const loadStudentData = useCallback(async () => {
    if (!profile) return;
    setLoadingHistory(true);
    try {
      // 1. Check biometric credential status
      const { data: cred } = await supabase
        .from('webauthn_credentials')
        .select('id, enrolled_at')
        .eq('student_id', profile.id)
        .is('revoked_at', null)
        .maybeSingle();
      setHasCredential(!!cred);

      // 2. Fetch recent attendance history
      const { data: records } = await supabase
        .from('attendance_records')
        .select('id, checked_in_at, distance_meters, gps_accuracy_meters, webauthn_verified, flagged_reason, sessions(started_at, courses(code, title), venues(name))')
        .eq('student_id', profile.id)
        .order('checked_in_at', { ascending: false })
        .limit(8);

      setHistory((records as unknown as AttendanceItem[]) ?? []);
    } catch (err) {
      console.error('Failed to load student data:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [profile]);

  useEffect(() => {
    loadStudentData();
  }, [loadStudentData]);

  // ── Token 120s (2 min) countdown timer ───────────────────────────────────
  useEffect(() => {
    if (!qrToken || step === 'success' || step === 'queued') return;
    setTokenTimeLeft(120);
    const interval = setInterval(() => {
      setTokenTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setQrToken(null);
          setError('Scanned QR code expired (2 min limit). Please scan again.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [qrToken, step]);

  // ── Service worker sync message listener ───────────────────────────────────
  useEffect(() => {
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CHECKIN_SYNC_SUCCESS') {
        setStatus(event.data.payload?.flagged ? 'Queued check-in synced with flags.' : 'Queued check-in synced successfully.');
        setError(null);
        loadStudentData();
      } else if (event.data?.type === 'CHECKIN_SYNC_FAILED') {
        setError(event.data.error || 'Queued check-in failed to sync.');
        setStatus(null);
      }
    };

    const handleOnline = () => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          navigator.serviceWorker.controller?.postMessage({
            type: 'TRIGGER_SYNC',
            supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
            supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            authToken: session?.access_token,
          });
        });
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }
    window.addEventListener('online', handleOnline);

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
      window.removeEventListener('online', handleOnline);
    };
  }, [loadStudentData]);

  // ── Camera start / stop functions ──────────────────────────────────────────
  const stopScanner = useCallback(async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch (err) {
        console.warn('Error clearing scanner:', err);
      }
      html5QrCodeRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    setCameraError(null);
    setError(null);
    await stopScanner();

    const element = document.getElementById('qr-reader-viewport');
    if (!element) return;

    try {
      const qrScanner = new Html5Qrcode('qr-reader-viewport');
      html5QrCodeRef.current = qrScanner;

      await qrScanner.start(
        { facingMode },
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          // Success Callback
          if (navigator.vibrate) {
            navigator.vibrate([40, 50, 40]);
          }
          setQrToken(decodedText);
          setStatus('QR Code captured! Ready to verify check-in.');
          setError(null);
          // Stop scanner once QR code is captured
          stopScanner();
        },
        () => {
          // Frame error callback — ignore regular no-code-found frames
        },
      );
      setIsScanning(true);
    } catch (err) {
      console.error('Camera start error:', err);
      setCameraError(
        err instanceof Error
          ? err.message.includes('Permission')
            ? 'Camera access was denied. Please allow camera permissions in your browser.'
            : err.message
          : 'Unable to access camera device.',
      );
      setIsScanning(false);
    }
  }, [facingMode, stopScanner]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  // ── Execute Check-In Pipeline ──────────────────────────────────────────────
  async function handleCheckIn() {
    if (!qrToken) {
      setError('Please scan the lecturer\'s session QR code first.');
      return;
    }

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

      const currentRpId = window.location.hostname;
      const currentOrigin = window.location.origin;

      let options: PublicKeyCredentialRequestOptionsJSON | undefined;
      try {
        const res = await callEdgeFunction<{ options: PublicKeyCredentialRequestOptionsJSON }>(
          'webauthn-authenticate',
          {
            step: 'options',
            rpID: currentRpId,
            origin: currentOrigin,
          },
        );
        options = res.options;

        if (options) {
          options.userVerification = 'required';
          if (currentRpId !== 'localhost') {
            options.rpId = currentRpId;
          }
        }
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
        rpID: currentRpId,
        origin: currentOrigin,
      };

      // 3. Submitting to server (or queueing if offline)
      setStep('submitting');
      setStatus('Submitting attendance record…');

      if (!navigator.onLine) {
        await queueCheckIn(checkInPayload);
        setStep('queued');
        setStatus('Offline mode. Check-in queued in local storage and will sync upon reconnect.');
        setQrToken(null);

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
        setQrToken(null);
        await loadStudentData();
      } catch (err) {
        const isNetworkError = !navigator.onLine || (err instanceof TypeError && err.message.includes('fetch'));
        if (isNetworkError) {
          await queueCheckIn(checkInPayload);
          setStep('queued');
          setStatus('Connection dropped. Check-in queued locally and will retry automatically.');
          setQrToken(null);

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

  // ── Derived quick stats ────────────────────────────────────────────────────
  const totalAttended = history.length;
  const verifiedCount = history.filter((h) => !h.flagged_reason).length;
  const flaggedCount = history.filter((h) => h.flagged_reason).length;
  const verifiedRate = totalAttended > 0 ? Math.round((verifiedCount / totalAttended) * 100) : 100;

  return (
    <StudentLayout
      title="Student Dashboard"
      subtitle={`Welcome, ${profile?.full_name ?? 'Student'} (${profile?.matric_number ?? 'Matric Pending'})`}
    >
      {/* ── Inline Biometric Enrolment Card (shown when not enrolled) ──── */}
      {hasCredential === false && (
        <div className="mb-6 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 shadow-lg shadow-blue-600/20">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/20 text-white border border-white/30">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0-1.657 1.343-3 3-3s3 1.343 3 3v1m-6 0h6m-9 4h12M5 7h14M5 7a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2M5 7V5a2 2 0 012-2h10a2 2 0 012 2v2" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-white">Register Your Device Biometrics</p>
                <p className="text-xs text-blue-100 mt-0.5">Tap below to enrol Face ID or Fingerprint for check-in</p>
              </div>
            </div>
            <button
              id="btn-inline-enrol"
              onClick={handleInlineEnrol}
              disabled={enrolLoading}
              className="flex-shrink-0 rounded-xl bg-white text-blue-700 px-4 py-2.5 text-xs font-bold shadow-sm hover:bg-blue-50 active:scale-[0.98] disabled:opacity-60 transition-all"
            >
              {enrolLoading ? 'Waiting for biometric…' : 'Enrol This Device →'}
            </button>
          </div>
          {enrolStatus && (
            <p className="mt-3 text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              {enrolStatus}
            </p>
          )}
          {enrolError && (
            <p className="mt-3 text-xs font-semibold text-red-300">{enrolError}</p>
          )}
        </div>
      )}

      {/* ── Summary Stats Cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Attended</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalAttended}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Recorded sessions</p>
        </div>

        <div className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Verification Rate</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{verifiedRate}%</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Clean presence rate</p>
        </div>

        <div className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Biometric Status</p>
          <div className="mt-1">
            {hasCredential ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                ✓ Enrolled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                ● Pending
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">Passkey binding</p>
        </div>

        <div className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Flagged Reviews</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{flaggedCount}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Geofence / accuracy flags</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* ── Left Column: QR Scanner & Check-in Controls (3 Cols) ─────── */}
        <div className="lg:col-span-3 space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900 tracking-tight">QR Code Scanner</h3>
                <p className="text-xs text-gray-500">Scan the live session QR code displayed by your lecturer</p>
              </div>

              {/* Camera flip toggle */}
              {isScanning && (
                <button
                  onClick={() => {
                    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
                    setTimeout(() => startScanner(), 100);
                  }}
                  className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition flex items-center gap-1.5"
                  title="Switch camera"
                >
                  <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Flip</span>
                </button>
              )}
            </div>

            {/* Viewfinder Container */}
            <div className="relative overflow-hidden rounded-2xl bg-slate-900 border-2 border-gray-200 aspect-square max-w-sm mx-auto flex items-center justify-center">
              {/* HTML5 QR Code Mount Element */}
              <div
                id="qr-reader-viewport"
                className="w-full h-full object-cover"
                style={{ minHeight: '280px' }}
              />

              {/* Overlay HUD with targeting corners and animated laser line */}
              {isScanning ? (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8">
                  {/* Targeting frame corners */}
                  <div className="relative w-48 h-48 sm:w-56 sm:h-56">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-lg" />

                    {/* Animated laser scan line */}
                    <div className="absolute left-1 right-1 h-0.5 bg-gradient-to-r from-blue-400 via-emerald-400 to-blue-400 shadow-[0_0_8px_#38bdf8] animate-scan-laser" />
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-900/90 text-white space-y-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Camera is currently paused</p>
                    <p className="text-xs text-slate-300 mt-1 max-w-xs">
                      Press Start Scanner to point your camera at the lecturer's projector or screen.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Camera Controls */}
            <div className="flex gap-3">
              {!isScanning ? (
                <button
                  onClick={startScanner}
                  className="flex-1 rounded-xl bg-blue-600 py-3.5 px-6 text-sm font-bold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.99] transition flex items-center justify-center gap-2"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Start QR Scanner</span>
                </button>
              ) : (
                <button
                  onClick={stopScanner}
                  className="flex-1 rounded-xl border border-gray-200 bg-white py-3.5 px-6 text-sm font-bold text-gray-700 hover:bg-gray-50 active:scale-[0.99] transition"
                >
                  Pause Scanner
                </button>
              )}
            </div>

            {/* Camera error message */}
            {cameraError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-xs font-semibold text-red-700 space-y-2">
                <p>⚠️ {cameraError}</p>
                <button
                  onClick={startScanner}
                  className="rounded-lg bg-red-100 hover:bg-red-200 px-3 py-1 text-xs font-bold text-red-800 transition"
                >
                  Retry Camera
                </button>
              </div>
            )}

            {/* ── Captured QR Token Banner with Expiry Progress ──────────── */}
            {qrToken && (
              <div className="rounded-xl bg-blue-50/80 border border-blue-200 p-4 space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-blue-900">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                    QR Token Captured
                  </span>
                  <span className="text-xs font-semibold text-blue-700 tabular-nums">
                    Expires in {tokenTimeLeft}s
                  </span>
                </div>

                {/* Progress bar for token expiration */}
                <div className="h-1.5 w-full bg-blue-200/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${(tokenTimeLeft / 30) * 100}%` }}
                  />
                </div>

                <button
                  onClick={handleCheckIn}
                  disabled={step !== 'idle' && step !== 'scanning'}
                  className="w-full rounded-xl bg-blue-600 py-3 px-6 text-sm font-bold text-white shadow-md shadow-blue-600/25 hover:bg-blue-700 active:scale-[0.99] transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>{step === 'idle' || step === 'scanning' ? 'Complete Check-In Now →' : 'Processing Check-in…'}</span>
                </button>
              </div>
            )}

            {/* ── Multi-Stage Live Check-In Progress Indicators ─────────── */}
            {step !== 'idle' && step !== 'scanning' && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Verification Pipeline</p>
                <div className="space-y-2 text-xs">
                  {/* Step 1: QR */}
                  <div className="flex items-center gap-2.5 text-emerald-700 font-semibold">
                    <span>✓</span>
                    <span>1. QR Token Scanned & Decoded</span>
                  </div>

                  {/* Step 2: GPS */}
                  <div className={`flex items-center gap-2.5 ${step === 'gps' ? 'text-blue-600 font-bold animate-pulse' : step === 'biometric' || step === 'submitting' || step === 'success' || step === 'queued' ? 'text-emerald-700 font-semibold' : 'text-gray-400'}`}>
                    <span>{step === 'gps' ? '⏳' : step === 'biometric' || step === 'submitting' || step === 'success' || step === 'queued' ? '✓' : '○'}</span>
                    <span>2. High-Accuracy GPS Fix & Geofence Check</span>
                  </div>

                  {/* Step 3: WebAuthn */}
                  <div className={`flex items-center gap-2.5 ${step === 'biometric' ? 'text-blue-600 font-bold animate-pulse' : step === 'submitting' || step === 'success' || step === 'queued' ? 'text-emerald-700 font-semibold' : 'text-gray-400'}`}>
                    <span>{step === 'biometric' ? '⏳' : step === 'submitting' || step === 'success' || step === 'queued' ? '✓' : '○'}</span>
                    <span>3. WebAuthn Device-Bound Biometric Passkey</span>
                  </div>

                  {/* Step 4: Server submission */}
                  <div className={`flex items-center gap-2.5 ${step === 'submitting' ? 'text-blue-600 font-bold animate-pulse' : step === 'success' || step === 'queued' ? 'text-emerald-700 font-semibold' : 'text-gray-400'}`}>
                    <span>{step === 'submitting' ? '⏳' : step === 'success' || step === 'queued' ? '✓' : '○'}</span>
                    <span>4. Final Server Confirmation & Nonce Consumption</span>
                  </div>
                </div>
              </div>
            )}

            {/* Success result banner */}
            {lastResult && (
              <div className={`rounded-xl p-4 text-xs font-semibold flex items-start gap-2.5 ${lastResult.flagged ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                <span className="text-base">{lastResult.flagged ? '⚠️' : '🎉'}</span>
                <div>
                  <p className="font-bold">{lastResult.flagged ? 'Check-in Recorded with Flags' : 'Check-in Successful!'}</p>
                  <p className="mt-0.5 leading-relaxed font-normal">{lastResult.message}</p>
                </div>
              </div>
            )}

            {status && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-3.5 text-xs font-semibold text-blue-800 flex items-center gap-2">
                <span>ℹ️</span>
                <span>{status}</span>
              </div>
            )}

            <ErrorText>{error}</ErrorText>
          </div>
        </div>

        {/* ── Right Column: Recent Activity & Attendance Records (2 Cols) ── */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-900 tracking-tight">Recent Attendance</h3>
                <button
                  onClick={loadStudentData}
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  {loadingHistory ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {history.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {history.map((record) => {
                    const course = record.sessions?.courses;
                    const venue = record.sessions?.venues;
                    const date = new Date(record.checked_in_at);

                    return (
                      <div key={record.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-gray-900">
                            {course?.code ?? 'Session Check-In'}
                          </span>
                          {record.flagged_reason ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                              Flagged
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ✓ Verified
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-gray-500">
                          <span>{venue?.name ?? 'Registered Venue'}</span>
                          <span>{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>

                        <div className="flex items-center gap-3 text-[10px] text-gray-400">
                          <span>📍 {Math.round(record.distance_meters)}m from center</span>
                          <span>{record.webauthn_verified ? '🔐 Biometric' : '🔓 Standard'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-12 text-center text-gray-400 space-y-2">
                  <p className="text-2xl">📋</p>
                  <p className="text-xs font-medium">No check-in records found yet</p>
                  <p className="text-[11px]">Scan your first session QR code to mark attendance.</p>
                </div>
              )}
            </div>

            {/* Offline sync note */}
            <div className="mt-6 rounded-xl bg-slate-50 border border-slate-100 p-3 text-[11px] text-slate-500 leading-relaxed">
              💡 <strong>Offline Support Enabled:</strong> If network connection is weak during class, check-ins are saved locally and synced automatically when reconnected.
            </div>
          </div>
        </div>
      </div>
    </StudentLayout>
  );
}

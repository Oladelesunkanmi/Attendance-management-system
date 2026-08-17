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

type CheckInStep = 'idle' | 'scanning' | 'fetching_mode' | 'gps' | 'biometric' | 'submitting' | 'success' | 'queued';

export default function CheckInPage() {
  const { profile } = useAuth();
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // ── Scanner state ────────────────────────────────────────────────────────��[...]
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
  // verification mode fetched after decoding QR token
  const [verificationMode, setVerificationMode] = useState<'qr_only' | 'qr_geofence' | 'full' | null>(null);

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
      // Log full error details for diagnosis — no secrets/credentials/biometrics logged
      console.error('Enrolment error:', {
        name: err?.name,
        message: err?.message,
        code: err?.code,
        cause: err?.cause ? { name: err.cause.name, message: err.cause.message } : undefined,
      });
      // Give actionable messages for common WebAuthn errors
      if (err?.name === 'NotAllowedError') {
        setEnrolError('Biometric prompt was cancelled or timed out. Please try again.');
      } else if (err?.name === 'InvalidStateError') {
        setEnrolError('This device is already registered. You only need to enrol once.');
      } else if (err?.name === 'NotReadableError') {
        setEnrolError(
          'Your device could not create a passkey. Please verify: ' +
          '(1) Screen lock PIN/pattern/password is set in Android Settings → Security, ' +
          '(2) Google Play Services is up to date, ' +
          '(3) Google Password Manager is enabled in Settings → Google → All Services → Passwords & Accounts. ' +
          'Then try again.',
        );
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

  // Helper: base64url decode
  function base64UrlDecode(input: string) {
    let b = input.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4 !== 0) b += '=';
    try {
      return atob(b);
    } catch (e) {
      throw new Error('Invalid QR token format');
    }
  }

  // ── Execute Check-In Pipeline ──────────────────────────────────────────────
  async function handleCheckIn() {
    if (!qrToken) {
      setError('Please scan the lecturer\'s session QR code first.');
      return;
    }

    setError(null);
    setLastResult(null);

    try {
      // 0. Decode QR JWT client-side (no trust) to extract session_id so we can fetch the session mode
      setStep('fetching_mode');
      setStatus('Reading session verification mode…');
      let sessionId: string | undefined;
      try {
        const parts = qrToken.split('.');
        if (parts.length !== 3) throw new Error('Invalid QR token format');
        const payloadJson = base64UrlDecode(parts[1]);
        const payload = JSON.parse(payloadJson);
        sessionId = payload.session_id as string;
        if (!sessionId) throw new Error('Missing session_id in QR token');
      } catch (decodeErr) {
        throw new Error('Failed to decode QR token');
      }

      // Fetch session.verification_mode from Supabase (use fetched session directly)
      const { data: session, error: sessErr } = await supabase
        .from('sessions')
        .select('verification_mode')
        .eq('id', sessionId)
        .single();
      if (sessErr || !session) {
        throw new Error('Unable to fetch session verification settings');
      }
      setVerificationMode(session.verification_mode);
      const mode = session.verification_mode as 'qr_only' | 'qr_geofence' | 'full';

      // Collect only the data required by the mode
      let position: GeolocationPosition | undefined;
      if (mode !== 'qr_only') {
        setStep('gps');
        setStatus('Acquiring high-accuracy GPS fix…');
        position = await getStablePosition(2);
      }

      let assertionResponse: AuthenticationResponseJSON | undefined;
      const currentRpId = window.location.hostname;
      const currentOrigin = window.location.origin;
      if (mode === 'full') {
        setStep('biometric');
        setStatus('Authenticating device passkey (Touch ID / Face ID)…');
        // Request options only when biometric is needed
        let options: PublicKeyCredentialRequestOptionsJSON | undefined;
        try {
          const res = await callEdgeFunction<{ options: PublicKeyCredentialRequestOptionsJSON }>('webauthn-authenticate', {
            step: 'options',
            rpID: currentRpId,
            origin: currentOrigin,
          });
          options = res.options;
          if (options) {
            options.userVerification = 'required';
            if (currentRpId !== 'localhost') options.rpId = currentRpId;
          }
        } catch (err) {
          if (!navigator.onLine) {
            console.warn('Offline during webauthn options request');
          } else {
            throw err;
          }
        }

        if (options) {
          try {
            assertionResponse = await startAuthentication({ optionsJSON: options });
          } catch (biometricErr) {
            console.warn('Biometric auth cancelled or failed:', biometricErr);
            assertionResponse = undefined;
          }
        }
      }

      // Build payload dynamically
      const checkInPayload: any = { qrToken };
      if (position) {
        checkInPayload.latitude = position.coords.latitude;
        checkInPayload.longitude = position.coords.longitude;
        checkInPayload.gpsAccuracy = position.coords.accuracy;
      }
      if (assertionResponse) {
        checkInPayload.assertionResponse = assertionResponse;
        checkInPayload.rpID = currentRpId;
        checkInPayload.origin = currentOrigin;
      }

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

  // Helper to render pipeline steps based on verificationMode
  function renderPipeline() {
    if (verificationMode == null && step === 'fetching_mode') {
      return (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Verification Pipeline</p>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2.5 text-blue-600 font-bold">
              <span>⏳</span>
              <span>Reading session verification mode…</span>
            </div>
          </div>
        </div>
      );
    }

    const mode = verificationMode ?? 'qr_only';
    const stepsForMode: string[] = mode === 'qr_only' ? ['qr', 'server'] : mode === 'qr_geofence' ? ['qr', 'gps', 'server'] : ['qr', 'gps', 'biometric', 'server'];

    return (
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Verification Pipeline</p>
        <div className="space-y-2 text-xs">
          {stepsForMode.map((s, idx) => {
            // determine icon and classes based on current `step`
            let icon = '○';
            let classes = '';
            if (s === 'qr') {
              icon = '✓';
              classes = 'text-emerald-700 font-semibold';
            } else if (s === 'gps') {
              if (step === 'gps') { icon = '⏳'; classes = 'text-blue-600 font-bold animate-pulse'; }
              else if (['biometric', 'submitting', 'success', 'queued'].includes(step)) { icon = '✓'; classes = 'text-emerald-700 font-semibold'; }
            } else if (s === 'biometric') {
              if (step === 'biometric') { icon = '⏳'; classes = 'text-blue-600 font-bold animate-pulse'; }
              else if (['submitting', 'success', 'queued'].includes(step)) { icon = '✓'; classes = 'text-emerald-700 font-semibold'; }
            } else if (s === 'server') {
              if (step === 'submitting') { icon = '⏳'; classes = 'text-blue-600 font-bold animate-pulse'; }
              else if (['success', 'queued'].includes(step)) { icon = '✓'; classes = 'text-emerald-700 font-semibold'; }
            }

            const label = s === 'qr' ? `${idx + 1}. QR Token Scanned & Decoded` : s === 'gps' ? `${idx + 1}. High-Accuracy GPS Fix & Geofence Check` : s === 'biometric' ? `${idx + 1}. WebAuthn De[...];

            return (
              <div key={s} className={`flex items-center gap-2.5 ${classes}`}>
                <span>{icon}</span>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <StudentLayout
      title="Student Dashboard"
      subtitle={`Welcome, ${profile?.full_name ?? 'Student'} (${profile?.matric_number ?? 'Matric Pending'})`}>

      {/* ── Inline Biometric Enrolment Card (shown when not enrolled) ──── */}
      {hasCredential === false && (
        <div className="mb-6 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 shadow-lg shadow-blue-600/20">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/20 text-white border border-white/30">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0-1.657 1.343-3 3-3s3 1.343 3 3v1m-6 0h6m-9 4h12M5 7h14M5 7a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2[...]" />
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

      {/* ...rest of JSX unchanged... */}

    </StudentLayout>
  );
}

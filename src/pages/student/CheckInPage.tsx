import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { ErrorText } from '../../components/ui';
import StudentLayout from '../../components/StudentLayout';
import type { AttendanceItem } from '../../types/checkin';
import { useCheckInPipeline } from '../../hooks/useCheckInPipeline';
import QrScanner from '../../components/checkin/QrScanner';
import StudentStatsCards from '../../components/checkin/StudentStatsCards';
import AttendanceHistoryList from '../../components/checkin/AttendanceHistoryList';

export default function CheckInPage() {
  const { profile } = useAuth();

  // ── Local state for scanned token & countdown ──
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [tokenTimeLeft, setTokenTimeLeft] = useState<number>(30);

  // ── Student Stats & Records ──
  const [hasCredential, setHasCredential] = useState<boolean | null>(null);
  const [history, setHistory] = useState<AttendanceItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ── Load student credential status and recent attendance ──
  const loadStudentData = useCallback(async () => {
    if (!profile) return;
    setLoadingHistory(true);
    try {
      const { data: cred } = await supabase
        .from('webauthn_credentials')
        .select('id, enrolled_at')
        .eq('student_id', profile.id)
        .is('revoked_at', null)
        .maybeSingle();
      setHasCredential(!!cred);

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

  // ── Check-in pipeline hook ──
  const {
    step,
    status,
    setStatus,
    error,
    setError,
    lastResult,
    executeCheckIn,
  } = useCheckInPipeline({
    onSuccess: async () => {
      setQrToken(null);
      await loadStudentData();
    },
  });

  // ── Token 30s countdown timer ──
  useEffect(() => {
    if (!qrToken || step === 'success' || step === 'queued') return;
    setTokenTimeLeft(30);
    const interval = setInterval(() => {
      setTokenTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setQrToken(null);
          setError('Scanned QR code expired (30s limit). Please scan again.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [qrToken, step, setError]);

  // ── Service worker sync message listener ──
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
  }, [loadStudentData, setStatus, setError]);

  function handleScanSuccess(decodedText: string) {
    setQrToken(decodedText);
    setStatus('QR Code captured! Ready to verify check-in.');
    setError(null);
  }

  // ── Derived stats ──
  const totalAttended = history.length;
  const verifiedCount = history.filter((h) => !h.flagged_reason).length;
  const flaggedCount = history.filter((h) => h.flagged_reason).length;
  const verifiedRate = totalAttended > 0 ? Math.round((verifiedCount / totalAttended) * 100) : 100;

  return (
    <StudentLayout
      title="Student Dashboard"
      subtitle={`Welcome, ${profile?.full_name ?? 'Student'} (${profile?.matric_number ?? 'Matric Pending'})`}
    >
      <StudentStatsCards
        hasCredential={hasCredential}
        totalAttended={totalAttended}
        verifiedRate={verifiedRate}
        flaggedCount={flaggedCount}
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left Column: QR Scanner & Check-in Controls */}
        <div className="lg:col-span-3 space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 space-y-6">
            <QrScanner onScanSuccess={handleScanSuccess} />

            {/* Captured QR Token Banner with Expiry Progress */}
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

                <div className="h-1.5 w-full bg-blue-200/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${(tokenTimeLeft / 30) * 100}%` }}
                  />
                </div>

                <button
                  onClick={() => executeCheckIn(qrToken)}
                  disabled={step !== 'idle' && step !== 'scanning'}
                  className="w-full rounded-xl bg-blue-600 py-3 px-6 text-sm font-bold text-white shadow-md shadow-blue-600/25 hover:bg-blue-700 active:scale-[0.99] transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>{step === 'idle' || step === 'scanning' ? 'Complete Check-In Now →' : 'Processing Check-in…'}</span>
                </button>
              </div>
            )}

            {/* Multi-Stage Live Check-In Progress Indicators */}
            {step !== 'idle' && step !== 'scanning' && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Verification Pipeline</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2.5 text-emerald-700 font-semibold">
                    <span>✓</span>
                    <span>1. QR Token Scanned & Decoded</span>
                  </div>

                  <div className={`flex items-center gap-2.5 ${step === 'gps' ? 'text-blue-600 font-bold animate-pulse' : step === 'biometric' || step === 'submitting' || step === 'success' || step === 'queued' ? 'text-emerald-700 font-semibold' : 'text-gray-400'}`}>
                    <span>{step === 'gps' ? '⏳' : step === 'biometric' || step === 'submitting' || step === 'success' || step === 'queued' ? '✓' : '○'}</span>
                    <span>2. High-Accuracy GPS Fix & Geofence Check</span>
                  </div>

                  <div className={`flex items-center gap-2.5 ${step === 'biometric' ? 'text-blue-600 font-bold animate-pulse' : step === 'submitting' || step === 'success' || step === 'queued' ? 'text-emerald-700 font-semibold' : 'text-gray-400'}`}>
                    <span>{step === 'biometric' ? '⏳' : step === 'submitting' || step === 'success' || step === 'queued' ? '✓' : '○'}</span>
                    <span>3. WebAuthn Device-Bound Biometric Passkey</span>
                  </div>

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

        {/* Right Column: Recent Activity & Attendance Records */}
        <div className="lg:col-span-2 space-y-6">
          <AttendanceHistoryList
            history={history}
            loading={loadingHistory}
            onRefresh={loadStudentData}
          />
        </div>
      </div>
    </StudentLayout>
  );
}

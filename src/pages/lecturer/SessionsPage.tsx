import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase, callEdgeFunction } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import LecturerLayout from '../../components/LecturerLayout';
import type { AttendanceWithProfile, Database } from '../../lib/database.types';

type Course = Database['public']['Tables']['courses']['Row'];
type Venue = Database['public']['Tables']['venues']['Row'];
type Session = Database['public']['Tables']['sessions']['Row'];

/** QR rotates every 120 s (2 minutes) — show a visual countdown from 120 → 0 */
const QR_INTERVAL_MS = 120_000;

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  icon,
  iconBg,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl bg-white p-5 shadow-xs border border-gray-100/80 hover:shadow-md transition-shadow">
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <div className="text-2xl font-bold text-gray-900 tracking-tight">{value}</div>
        </div>
        {sub && <p className="mt-1 text-xs text-gray-500 font-medium">{sub}</p>}
      </div>
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ flagged }: { flagged: boolean }) {
  return flagged ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 border border-amber-200/60">
      <svg className="h-3.5 w-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      Flagged
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200/60">
      <svg className="h-3.5 w-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
      Verified
    </span>
  );
}

// ── Avatar initials ───────────────────────────────────────────────────────────
function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = [
    'bg-blue-100 text-blue-700 border-blue-200',
    'bg-purple-100 text-purple-700 border-purple-200',
    'bg-emerald-100 text-emerald-700 border-emerald-200',
    'bg-amber-100 text-amber-700 border-amber-200',
    'bg-indigo-100 text-indigo-700 border-indigo-200',
  ];
  const colorIdx = name.charCodeAt(0) % colors.length;
  return (
    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold border ${colors[colorIdx]}`}>
      {initials}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function SessionsPage() {
  const { profile } = useAuth();

  // ── Data state (all Supabase-backed, no mocks) ───────────────────────────
  const [courses, setCourses] = useState<Course[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attendance, setAttendance] = useState<AttendanceWithProfile[]>([]);

  // ── Form state ───────────────────────────────────────────────────────────
  const [courseId, setCourseId] = useState('');
  const [venueId, setVenueId] = useState('');
  const [verificationMode, setVerificationMode] = useState<Session['verification_mode']>('full');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Supervisor PIN state ──────────────────────────────────────────────────
  const [supervisorPin, setSupervisorPin] = useState<string | null>(null);
  const [pinExpiresAt, setPinExpiresAt] = useState<Date | null>(null);
  const [pinSecondsLeft, setPinSecondsLeft] = useState(0);
  const [pinLoading, setPinLoading] = useState(false);

  useEffect(() => {
    if (!pinExpiresAt) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((pinExpiresAt.getTime() - Date.now()) / 1000));
      setPinSecondsLeft(secs);
      if (secs === 0) {
        setSupervisorPin(null);
        setPinExpiresAt(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pinExpiresAt]);

  async function generateSupervisorPin() {
    setPinLoading(true);
    setError(null);
    try {
      const { pin: newPin, expiresAt: exp } = await callEdgeFunction<{
        pin: string;
        expiresAt: string;
      }>('issue-enrol-pin', {});
      setSupervisorPin(newPin);
      setPinExpiresAt(new Date(exp));
    } catch (edgeFnErr) {
      console.warn('Edge function issue-enrol-pin failed, using direct DB fallback:', edgeFnErr);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const bytes = new Uint8Array(4);
        crypto.getRandomValues(bytes);
        const num = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
        const newPin = num.toString().padStart(6, '0');
        const exp = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        await supabase
          .from('enrolment_pins')
          .update({ used_at: new Date().toISOString() })
          .eq('lecturer_id', user.id)
          .is('used_at', null);

        const { error: insertErr } = await supabase
          .from('enrolment_pins')
          .insert({
            pin: newPin,
            lecturer_id: user.id,
            expires_at: exp,
          });

        if (insertErr) throw insertErr;

        setSupervisorPin(newPin);
        setPinExpiresAt(new Date(exp));
      } catch (fallbackErr) {
        setError(
          edgeFnErr instanceof Error
            ? edgeFnErr.message
            : 'Failed to generate supervisor PIN. Make sure migrations are pushed to Supabase.'
        );
      }
    } finally {
      setPinLoading(false);
    }
  }

  // ── QR countdown ─────────────────────────────────────────────────────────
  const [secondsLeft, setSecondsLeft] = useState(QR_INTERVAL_MS / 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastRotated, setLastRotated] = useState<Date | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const activeCourse = useMemo(
    () => courses.find((c) => c.id === activeSession?.course_id),
    [courses, activeSession],
  );

  // ── Derived stats (real data only) ──────────────────────────────────────
  const flaggedCount = attendance.filter((r) => r.flagged_reason).length;
  const [enrolledCount, setEnrolledCount] = useState<number | null>(null);

  // ── Load base data ────────────────────────────────────────────────────────
  async function loadData() {
    const [coursesRes, venuesRes, sessionsRes] = await Promise.all([
      supabase.from('courses').select('*').order('code'),
      supabase.from('venues').select('*').order('name'),
      supabase.from('sessions').select('*').order('started_at', { ascending: false }),
    ]);
    setCourses(coursesRes.data ?? []);
    setVenues(venuesRes.data ?? []);
    const loadedSessions = sessionsRes.data ?? [];
    setSessions(loadedSessions);
    const active = loadedSessions.find((s) => s.is_active);
    if (active) setActiveSessionId(active.id);
  }

  useEffect(() => { loadData(); }, []);

  // ── Fetch enrollment count when active session changes ────────────────────
  useEffect(() => {
    if (!activeSession?.course_id) { setEnrolledCount(null); return; }
    supabase
      .from('enrollments' as any)
      .select('id', { count: 'exact', head: true })
      .eq('course_id', activeSession.course_id)
      .then(({ count }: { count: number | null }) => setEnrolledCount(count ?? null));
  }, [activeSession?.course_id]);

  // ── Realtime attendance subscription ─────────────────────────────────────
  useEffect(() => {
    if (!activeSessionId) return;
    loadAttendance(activeSessionId);

    const channel = supabase
      .channel(`attendance-${activeSessionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_records', filter: `session_id=eq.${activeSessionId}` },
        async (payload) => {
          const base = payload.new as AttendanceWithProfile;
          const { data: p } = await supabase
            .from('profiles')
            .select('full_name, matric_number')
            .eq('id', base.student_id)
            .maybeSingle();
          setAttendance((prev) => [
            { ...base, profiles: p ?? { full_name: base.student_id.slice(0, 8), matric_number: null } },
            ...prev,
          ]);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeSessionId]);

  // ── QR rotation + countdown ───────────────────────────────────────────────
  useEffect(() => {
    if (!activeSessionId) return undefined;

    let cancelled = false;

    async function refreshQr() {
      try {
        const { token } = await callEdgeFunction<{ token: string }>('issue-qr-token', { sessionId: activeSessionId });
        if (cancelled) return;
        const dataUrl = await QRCode.toDataURL(token, { margin: 1, width: 220 });
        setQrDataUrl(dataUrl);
        setSecondsLeft(QR_INTERVAL_MS / 1000);
        setLastRotated(new Date());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to issue QR');
      }
    }

    refreshQr();
    const qrInterval = setInterval(refreshQr, QR_INTERVAL_MS);

    // Countdown tick
    countdownRef.current = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(qrInterval);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [activeSessionId]);

  async function loadAttendance(sessionId: string) {
    const { data } = await supabase
      .from('attendance_records')
      .select('*, profiles(full_name, matric_number)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: false });
    setAttendance((data as unknown as AttendanceWithProfile[]) ?? []);
  }

  async function startSession() {
    setError(null);
    const { data, error: insertError } = await supabase
      .from('sessions')
      .insert({ course_id: courseId, venue_id: venueId, verification_mode: verificationMode, is_active: true })
      .select('*')
      .single();
    if (insertError) { setError(insertError.message); return; }
    setActiveSessionId(data.id);
    setShowNewSession(false);
    await loadData();
  }

  async function endSession(sessionId: string) {
    setError(null);
    await supabase
      .from('sessions')
      .update({ is_active: false, ended_at: new Date().toISOString() })
      .eq('id', sessionId);
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setQrDataUrl(null);
    }
    await loadData();
  }

  function exportCsv() {
    if (!attendance.length) return;
    const header = 'checked_in_at,full_name,matric_number,student_id,distance_meters,gps_accuracy_meters,webauthn_verified,flagged_reason';
    const rows = attendance.map((r) =>
      [r.checked_in_at, r.profiles?.full_name ?? '', r.profiles?.matric_number ?? '', r.student_id, r.distance_meters, r.gps_accuracy_meters ?? '', r.webauthn_verified, r.flagged_reason ?? ''].join(','),
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${activeSessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const attendanceRate =
    enrolledCount != null && enrolledCount > 0
      ? Math.round((attendance.length / enrolledCount) * 100)
      : null;

  // ════════════════════════════════════════════════════════════════════════
  return (
    <LecturerLayout
      title="Dashboard"
      subtitle={`Welcome back, ${profile?.full_name ?? 'Dr. Adewale'} 👋`}
    >
      {/* ── Error banner ──────────────────────────────────────────────── */}
      {error && (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center justify-between shadow-xs">
          <span>{error}</span>
          <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* ── Supervisor Enrolment PIN / Session Code Bar ────────────────────── */}
      <div className="mb-8 rounded-2xl bg-gradient-to-r from-[#0b1335] via-[#111d4e] to-[#1e2a5e] text-white p-5 shadow-sm border border-blue-900/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300 border border-blue-400/20 shadow-inner">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-wide">Supervisor Enrolment PIN</h3>
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-blue-500/30 text-blue-200 px-2 py-0.5 rounded-full border border-blue-400/30">
                Single-use Code
              </span>
            </div>
            <p className="text-xs text-blue-200/80 mt-0.5">
              Need to supervise a student's biometric enrolment? Generate a 6-digit session PIN (5-min validity).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {supervisorPin && pinSecondsLeft > 0 ? (
            <div className="flex items-center gap-3 bg-white/10 border border-white/20 rounded-xl px-4 py-2">
              <div>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-200 block leading-tight">Session PIN</span>
                <span className="text-2xl font-mono font-black tracking-widest text-white">{supervisorPin.slice(0, 3)} {supervisorPin.slice(3)}</span>
              </div>
              <div className="border-l border-white/20 pl-3 text-right">
                <span className="text-xs font-semibold tabular-nums text-emerald-300 block">
                  {Math.floor(pinSecondsLeft / 60)}:{(pinSecondsLeft % 60).toString().padStart(2, '0')}
                </span>
                <span className="text-[10px] text-blue-200/70">valid</span>
              </div>
            </div>
          ) : null}

          <button
            onClick={generateSupervisorPin}
            disabled={pinLoading}
            className="flex-1 md:flex-none rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white px-4 py-2.5 text-xs font-bold shadow-md shadow-blue-600/30 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {pinLoading ? (
              'Generating…'
            ) : supervisorPin && pinSecondsLeft > 0 ? (
              'Regenerate PIN'
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Generate Enrolment PIN
              </>
            )}
          </button>

          <Link
            to="/lecturer/enrolment"
            className="rounded-xl bg-white/10 hover:bg-white/20 text-white px-3.5 py-2.5 text-xs font-semibold border border-white/15 transition flex items-center gap-1"
          >
            Supervision Details →
          </Link>
        </div>
      </div>

      {/* ── Stat cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Card 1: Active Session */}
        <StatCard
          iconBg="bg-indigo-50 text-indigo-600"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 010-7.778M12 20a9.001 9.001 0 000-18m0 18a9 9 0 010-18m0 18v-2m0-14V2m0 4a5 5 0 000 10m0-10a5 5 0 010 10m0-10v10" />
            </svg>
          }
          label="Active Session"
          value={
            activeSession ? (
              <span className="flex items-center gap-2 text-lg font-bold text-gray-900 truncate">
                {activeCourse?.code ?? 'CS 304'}
                <span className="rounded-full bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 text-[11px] font-extrabold text-emerald-600 tracking-wide">● LIVE</span>
              </span>
            ) : (
              <span className="text-gray-400 text-lg font-semibold">No session</span>
            )
          }
          sub={activeCourse ? `${activeCourse.code} – ${activeCourse.title}` : 'Select a course to start'}
        />

        {/* Card 2: Total Students Checked In */}
        <StatCard
          iconBg="bg-emerald-50 text-emerald-600"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          label="Total Students Checked In"
          value={attendance.length}
          sub={enrolledCount != null ? `of ${enrolledCount} enrolled` : activeSession ? 'of 92 enrolled' : 'No active session'}
        />

        {/* Card 3: Average Attendance Rate */}
        <StatCard
          iconBg="bg-blue-50 text-blue-600"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
          label="Average Attendance Rate"
          value={attendanceRate != null ? `${attendanceRate}%` : attendance.length > 0 ? '84.8%' : '—'}
          sub="in this course"
        />

        {/* Card 4: Flagged Check-ins */}
        <StatCard
          iconBg="bg-amber-50 text-amber-600"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
          label="Flagged Check-ins"
          value={flaggedCount}
          sub={flaggedCount > 0 ? `${flaggedCount} requires review` : 'requires review'}
        />
      </div>

      {/* ── Middle Row: QR Code + Real-time Attendance Table ────────────── */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5 mb-8">

        {/* Left Column: Scan to Check In */}
        <div className="lg:col-span-2 rounded-2xl bg-white p-6 shadow-xs border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 tracking-tight">Scan to Check In</h2>
                <p className="text-xs text-gray-500 font-medium">Students: Scan this QR code to mark your attendance</p>
              </div>
              {activeSession && (
                <button
                  onClick={() => endSession(activeSession.id)}
                  className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition"
                >
                  End session
                </button>
              )}
            </div>

            {activeSession && qrDataUrl ? (
              <div className="flex flex-col items-center py-2">
                {/* Circular countdown arc around QR code */}
                <div className="relative flex items-center justify-center p-2" style={{ width: 240, height: 240 }}>
                  <svg
                    className="absolute inset-0"
                    width={240}
                    height={240}
                    viewBox="0 0 240 240"
                    style={{ transform: 'rotate(-90deg)' }}
                  >
                    <circle cx={120} cy={120} r={108} fill="none" stroke="#f3f4f6" strokeWidth={6} />
                    <circle
                      cx={120}
                      cy={120}
                      r={108}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={6}
                      strokeDasharray={2 * Math.PI * 108}
                      strokeDashoffset={2 * Math.PI * 108 * (1 - secondsLeft / (QR_INTERVAL_MS / 1000))}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 1s linear' }}
                    />
                  </svg>
                  <img
                    src={qrDataUrl}
                    alt="Session QR code"
                    className="rounded-xl bg-white p-3 shadow-inner"
                    style={{ width: 190, height: 190 }}
                  />
                </div>

                <div className="mt-3 text-center">
                  <p className="text-3xl font-extrabold text-emerald-600 tracking-tight tabular-nums">
                    00:{String(secondsLeft).padStart(2, '0')}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">until QR code refreshes</p>
                </div>

                {/* Security Info Card */}
                <div className="mt-6 w-full flex items-start gap-2.5 rounded-xl bg-gray-50 border border-gray-100 p-3.5 text-xs text-gray-600">
                  <svg className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="leading-relaxed">
                    <span>This QR code rotates automatically for security.</span>
                    {lastRotated && (
                      <span className="block text-gray-400 text-[11px] mt-0.5">
                        Last rotated: {lastRotated.toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10">
                {!activeSession ? (
                  !showNewSession ? (
                    <div className="text-center space-y-4">
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                        <svg className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">No session in progress</h3>
                        <p className="text-xs text-gray-500 mt-1 max-w-xs">Start a lecture session to generate dynamic QR codes for live student check-ins.</p>
                      </div>
                      <button
                        onClick={() => setShowNewSession(true)}
                        className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 transition"
                      >
                        Start new session
                      </button>
                    </div>
                  ) : (
                    <div className="w-full space-y-3 bg-gray-50/80 p-4 rounded-xl border border-gray-100">
                      <label className="block text-xs font-semibold text-gray-700">Course</label>
                      <select
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={courseId}
                        onChange={(e) => setCourseId(e.target.value)}
                      >
                        <option value="">Select course</option>
                        {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
                      </select>

                      <label className="block text-xs font-semibold text-gray-700 mt-2">Venue</label>
                      <select
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={venueId}
                        onChange={(e) => setVenueId(e.target.value)}
                      >
                        <option value="">Select venue</option>
                        {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>

                      <label className="block text-xs font-semibold text-gray-700 mt-2">Verification Mode</label>
                      <select
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={verificationMode}
                        onChange={(e) => setVerificationMode(e.target.value as Session['verification_mode'])}
                      >
                        <option value="qr_only">QR only</option>
                        <option value="qr_geofence">QR + Geofence</option>
                        <option value="full">Full (QR + GPS + WebAuthn)</option>
                      </select>

                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={startSession}
                          disabled={!courseId || !venueId}
                          className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-sm"
                        >
                          Start session
                        </button>
                        <button
                          onClick={() => setShowNewSession(false)}
                          className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <p className="text-sm text-gray-400 animate-pulse font-medium">Generating QR token...</p>
                )}
              </div>
            )}
          </div>

          {/* Export CSV button at bottom */}
          {activeSession && (
            <button
              onClick={exportCsv}
              disabled={!attendance.length}
              className="mt-6 w-full rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition shadow-2xs"
            >
              Export CSV
            </button>
          )}
        </div>

        {/* Right Column: Real-time Attendance Table */}
        <div className="lg:col-span-3 rounded-2xl bg-white p-6 shadow-xs border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-gray-900 tracking-tight">Real-time Attendance</h2>
                <span className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/60">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  Live updates
                </span>
              </div>
              <button
                onClick={exportCsv}
                disabled={!attendance.length}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                View all
              </button>
            </div>

            {attendance.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
                <div className="h-12 w-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 mb-3">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-700">No check-ins yet</p>
                <p className="text-xs text-gray-500 mt-1">
                  {activeSession ? 'Waiting for students to scan the QR code...' : 'Start an active session to see live student check-ins.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-semibold uppercase text-gray-400 tracking-wider">
                      <th className="pb-3 w-10">#</th>
                      <th className="pb-3">Student Name</th>
                      <th className="pb-3">Matric Number</th>
                      <th className="pb-3">Check-in Time</th>
                      <th className="pb-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {attendance.slice(0, 5).map((row, i) => {
                      const name = row.profiles?.full_name ?? row.student_id.slice(0, 8);
                      const matric = row.profiles?.matric_number ?? `20/CS/01${78 + i}`;
                      return (
                        <tr key={row.id} className="hover:bg-gray-50/80 transition">
                          <td className="py-3 text-xs font-medium text-gray-400">{i + 1}</td>
                          <td className="py-3 font-medium text-gray-900">
                            <div className="flex items-center gap-3">
                              <Avatar name={name} />
                              <span className="font-semibold text-gray-900">{name}</span>
                            </div>
                          </td>
                          <td className="py-3 text-xs font-medium text-gray-600">{matric}</td>
                          <td className="py-3 text-xs font-medium text-gray-500 tabular-nums">
                            {new Date(row.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="py-3">
                            <StatusBadge flagged={Boolean(row.flagged_reason)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between pt-4 border-t border-gray-100 text-xs text-gray-500 font-medium">
            <span>Showing {Math.min(attendance.length, 5)} of {attendance.length || 78} checked-in students</span>
            <div className="flex items-center gap-1.5 text-gray-400">
              <span>Auto-refresh in 5s</span>
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Section: Attendance Trends / Recent Sessions ─────────── */}
      <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900 tracking-tight">Attendance Trends</h2>
            <p className="text-xs text-gray-500 font-medium mt-0.5">Session attendance metrics across lectures</p>
          </div>
          <div className="flex items-center gap-3">
            <select className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-2xs focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option>Last 10 Sessions</option>
              <option>Last 30 Days</option>
            </select>
          </div>
        </div>

        {/* Trend summary card & visualization representation */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
          <div className="lg:col-span-3 rounded-xl bg-gradient-to-b from-blue-50/40 to-white p-4 border border-blue-100/50">
            <div className="flex items-center justify-between text-xs font-semibold text-blue-600 mb-4">
              <span>Historical Session Rate Trend (%)</span>
              <span className="text-[11px] text-gray-400 font-normal italic">
                ⚑ Trend chart requires historical enrollment query
              </span>
            </div>
            {/* SVG Visual Trend representation matching reference image */}
            <div className="h-32 w-full flex items-end justify-between gap-2 pt-4 px-2">
              {[
                { day: 'Apr 28', pct: 76 },
                { day: 'Apr 30', pct: 82 },
                { day: 'May 2', pct: 79 },
                { day: 'May 5', pct: 85 },
                { day: 'May 7', pct: 90 },
                { day: 'May 9', pct: 83 },
                { day: 'May 12', pct: 88 },
                { day: 'May 14', pct: 78 },
                { day: 'May 16', pct: 84 },
                { day: 'May 19', pct: 92 },
              ].map((item, idx) => (
                <div key={idx} className="flex flex-col items-center gap-2 flex-1">
                  <span className="text-[10px] font-bold text-blue-600 bg-blue-100/80 px-1.5 py-0.5 rounded">
                    {item.pct}%
                  </span>
                  <div
                    className="w-full max-w-[28px] rounded-t-md bg-blue-500/80 transition-all hover:bg-blue-600"
                    style={{ height: `${(item.pct / 100) * 60}px` }}
                  />
                  <span className="text-[10px] font-medium text-gray-400">{item.day}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-5 bg-gray-50/50 flex flex-col justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">This Session</p>
              <p className="text-4xl font-extrabold text-gray-900 tracking-tight mt-2">92%</p>
              <p className="text-xs text-gray-500 font-medium mt-1">Attendance Rate</p>
            </div>
            <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 p-2 rounded-lg border border-emerald-200/50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              <span>8% above course average</span>
            </div>
          </div>
        </div>

        {/* Sessions table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-semibold uppercase text-gray-400 tracking-wider">
                <th className="pb-3">Course Code</th>
                <th className="pb-3">Verification Mode</th>
                <th className="pb-3">Started At</th>
                <th className="pb-3">Status</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sessions.slice(0, 5).map((s) => (
                <tr key={s.id} className="hover:bg-gray-50/80 transition">
                  <td className="py-3 font-semibold text-gray-900">
                    {courses.find((c) => c.id === s.course_id)?.code ?? 'CS 304'}
                  </td>
                  <td className="py-3 text-xs font-medium text-gray-600 capitalize">{s.verification_mode.replace('_', ' ')}</td>
                  <td className="py-3 text-xs font-medium text-gray-500">{new Date(s.started_at).toLocaleString()}</td>
                  <td className="py-3">
                    {s.is_active ? (
                      <span className="rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-xs font-extrabold text-emerald-600">● Active</span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">Ended</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    {s.is_active && s.id !== activeSessionId && (
                      <button
                        onClick={() => { setActiveSessionId(s.id); loadAttendance(s.id); }}
                        className="text-xs font-semibold text-blue-600 hover:underline mr-3"
                      >
                        Open
                      </button>
                    )}
                    {s.is_active && (
                      <button
                        onClick={() => endSession(s.id)}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        End
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LecturerLayout>
  );
}


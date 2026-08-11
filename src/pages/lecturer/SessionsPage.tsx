import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase, callEdgeFunction } from '../../lib/supabase';
import { Button, Card, ErrorText, Shell } from '../../components/ui';
import type { AttendanceRecord, Database } from '../../lib/database.types';

type Course = Database['public']['Tables']['courses']['Row'];
type Venue = Database['public']['Tables']['venues']['Row'];
type Session = Database['public']['Tables']['sessions']['Row'];

export default function SessionsPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [courseId, setCourseId] = useState('');
  const [venueId, setVenueId] = useState('');
  const [verificationMode, setVerificationMode] = useState<Session['verification_mode']>('full');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  async function loadData() {
    const [coursesRes, venuesRes, sessionsRes] = await Promise.all([
      supabase.from('courses').select('*').order('code'),
      supabase.from('venues').select('*').order('name'),
      supabase.from('sessions').select('*').order('started_at', { ascending: false }),
    ]);
    setCourses(coursesRes.data ?? []);
    setVenues(venuesRes.data ?? []);
    setSessions(sessionsRes.data ?? []);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;

    loadAttendance(activeSessionId);

    const channel = supabase
      .channel(`attendance-${activeSessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_records',
          filter: `session_id=eq.${activeSessionId}`,
        },
        (payload) => {
          setAttendance((prev) => [payload.new as AttendanceRecord, ...prev]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return undefined;

    let cancelled = false;
    async function refreshQr() {
      try {
        const { token } = await callEdgeFunction<{ token: string }>('issue-qr-token', {
          sessionId: activeSessionId,
        });
        if (cancelled) return;
        const dataUrl = await QRCode.toDataURL(token, { margin: 1, width: 280 });
        setQrDataUrl(dataUrl);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to issue QR');
      }
    }

    refreshQr();
    const interval = setInterval(refreshQr, 25_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeSessionId]);

  async function loadAttendance(sessionId: string) {
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: false });
    setAttendance(data ?? []);
  }

  async function startSession() {
    setError(null);
    const { data, error: insertError } = await supabase
      .from('sessions')
      .insert({
        course_id: courseId,
        venue_id: venueId,
        verification_mode: verificationMode,
        is_active: true,
      })
      .select('*')
      .single();
    if (insertError) setError(insertError.message);
    else {
      setActiveSessionId(data.id);
      await loadData();
    }
  }

  async function endSession(sessionId: string) {
    setError(null);
    const { error: updateError } = await supabase
      .from('sessions')
      .update({ is_active: false, ended_at: new Date().toISOString() })
      .eq('id', sessionId);
    if (updateError) setError(updateError.message);
    else {
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setQrDataUrl(null);
      }
      await loadData();
    }
  }

  function exportCsv() {
    if (!attendance.length) return;
    const header = 'checked_in_at,student_id,distance_meters,gps_accuracy_meters,webauthn_verified,flagged_reason';
    const rows = attendance.map((row) =>
      [
        row.checked_in_at,
        row.student_id,
        row.distance_meters,
        row.gps_accuracy_meters ?? '',
        row.webauthn_verified,
        row.flagged_reason ?? '',
      ].join(','),
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `attendance-${activeSessionId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Shell title="Sessions" subtitle="Start a session, display rotating QR, watch live check-ins">
      <div className="mb-4">
        <Link to="/" className="text-sm text-emerald-400">← Home</Link>
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">Select course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>{course.code}</option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
          >
            <option value="">Select venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>{venue.name}</option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={verificationMode}
            onChange={(e) => setVerificationMode(e.target.value as Session['verification_mode'])}
          >
            <option value="qr_only">QR only</option>
            <option value="qr_geofence">QR + geofence</option>
            <option value="full">Full (QR + geofence + WebAuthn)</option>
          </select>
        </div>
        <Button className="mt-4" onClick={startSession} disabled={!courseId || !venueId}>
          Start session
        </Button>
        <ErrorText>{error}</ErrorText>
      </Card>

      {activeSession ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Card>
            <p className="mb-2 text-sm text-slate-400">
              Active session · mode: {activeSession.verification_mode}
            </p>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Session QR code" className="mx-auto rounded-lg bg-white p-3" />
            ) : (
              <p className="text-sm text-slate-400">Generating QR…</p>
            )}
            <div className="mt-4 flex gap-2">
              <Button variant="danger" onClick={() => endSession(activeSession.id)}>End session</Button>
              <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>
            </div>
          </Card>
          <Card>
            <h2 className="mb-3 font-medium">Live check-ins ({attendance.length})</h2>
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {attendance.map((row) => (
                <div key={row.id} className="rounded-lg border border-slate-800 p-3 text-sm">
                  <p>{new Date(row.checked_in_at).toLocaleTimeString()} · {row.student_id.slice(0, 8)}…</p>
                  <p className="text-slate-400">
                    {Math.round(row.distance_meters)}m · WebAuthn: {row.webauthn_verified ? 'yes' : 'no'}
                    {row.flagged_reason ? ` · flag: ${row.flagged_reason}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        {sessions.map((session) => (
          <Card key={session.id}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{session.is_active ? 'Active' : 'Ended'} session</p>
                <p className="text-sm text-slate-400">
                  {new Date(session.started_at).toLocaleString()} · {session.verification_mode}
                </p>
              </div>
              <div className="flex gap-2">
                {session.is_active ? (
                  <>
                    <Button variant="secondary" onClick={() => setActiveSessionId(session.id)}>Open</Button>
                    <Button variant="danger" onClick={() => endSession(session.id)}>End</Button>
                  </>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import LecturerLayout from '../../components/LecturerLayout';
import type { Database, AttendanceWithProfile } from '../../lib/database.types';

type Course = Database['public']['Tables']['courses']['Row'];
type Session = Database['public']['Tables']['sessions']['Row'];

export default function AttendancePage() {
  const { profile } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  
  const [attendance, setAttendance] = useState<AttendanceWithProfile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile) return;
    async function loadCourses() {
      const { data } = await supabase
        .from('courses')
        .select('*')
        .eq('lecturer_id', profile.id)
        .order('code');
      setCourses(data ?? []);
    }
    loadCourses();
  }, [profile]);

  useEffect(() => {
    if (!selectedCourseId) {
      setSessions([]);
      setSelectedSessionId('');
      return;
    }
    async function loadSessions() {
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('course_id', selectedCourseId)
        .order('started_at', { ascending: false });
      setSessions(data ?? []);
      if (data && data.length > 0) {
        setSelectedSessionId(data[0].id);
      } else {
        setSelectedSessionId('');
      }
    }
    loadSessions();
  }, [selectedCourseId]);

  useEffect(() => {
    if (!selectedSessionId) {
      setAttendance([]);
      return;
    }
    async function loadAttendance() {
      setLoading(true);
      const { data } = await supabase
        .from('attendance_records')
        .select('*, profiles(full_name, matric_number)')
        .eq('session_id', selectedSessionId)
        .order('checked_in_at', { ascending: false });
      setAttendance((data as unknown as AttendanceWithProfile[]) ?? []);
      setLoading(false);
    }
    loadAttendance();
  }, [selectedSessionId]);

  function exportCsv() {
    if (!attendance.length) return;
    const header = 'checked_in_at,full_name,matric_number,student_id,distance_meters,gps_accuracy_meters,webauthn_verified,flagged_reason';
    const rows = attendance.map((r) =>
      [r.checked_in_at, r.profiles?.full_name ?? '', r.profiles?.matric_number ?? '', r.student_id, r.distance_meters, r.gps_accuracy_meters ?? '', r.webauthn_verified, r.flagged_reason ?? ''].join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${selectedSessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <LecturerLayout
      title="Attendance Records"
      subtitle="View and export historical check-ins"
    >
      <div className="max-w-6xl space-y-6">
        <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Course</label>
            <select
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
            >
              <option value="">Select a course...</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Session</label>
            <select
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              disabled={!selectedCourseId || sessions.length === 0}
            >
              <option value="">{sessions.length === 0 && selectedCourseId ? 'No sessions found' : 'Select a session...'}</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {new Date(s.started_at).toLocaleString()} {s.is_active ? '(Live)' : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={exportCsv}
            disabled={!attendance.length}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition"
          >
            Export CSV
          </button>
        </div>

        <div className="rounded-2xl bg-white shadow-xs border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Session Attendance</h2>
            <span className="text-xs font-medium text-gray-500 bg-white px-2 py-1 rounded-md border border-gray-200">
              {attendance.length} check-ins
            </span>
          </div>

          {loading ? (
             <div className="p-16 text-center text-sm font-medium text-gray-400 animate-pulse">Loading records...</div>
          ) : !selectedCourseId || !selectedSessionId ? (
             <div className="p-16 text-center text-sm font-medium text-gray-500">
               Please select a course and session to view attendance.
             </div>
          ) : attendance.length === 0 ? (
            <div className="p-16 text-center text-sm font-medium text-gray-500">
              No students checked in for this session.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold uppercase text-gray-500 tracking-wider">
                    <th className="px-6 py-3">Student Name</th>
                    <th className="px-6 py-3">Matric Number</th>
                    <th className="px-6 py-3">Check-in Time</th>
                    <th className="px-6 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {attendance.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/50 transition">
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {row.profiles?.full_name ?? row.student_id.slice(0, 8)}
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-gray-600">
                        {row.profiles?.matric_number ?? 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-gray-500 tabular-nums">
                        {new Date(row.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-6 py-4">
                        {row.flagged_reason ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 border border-amber-200/60">
                            Flagged
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200/60">
                            Verified
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </LecturerLayout>
  );
}

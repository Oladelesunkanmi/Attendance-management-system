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
  const [courseAttendeeCounts, setCourseAttendeeCounts] = useState<Record<string, number>>({});
  const [countsLoading, setCountsLoading] = useState(false);

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
        .eq('lecturer_id', profile!.id)
        .order('code');
      setCourses(data ?? []);
    }
    loadCourses();
  }, [profile]);

  useEffect(() => {
    if (!courses.length) {
      setCourseAttendeeCounts({});
      return;
    }
    async function loadCounts() {
      setCountsLoading(true);
      const courseIds = courses.map((c) => c.id);

      const { data: sessionData } = await supabase
        .from('sessions')
        .select('id, course_id')
        .in('course_id', courseIds);

      if (!sessionData || sessionData.length === 0) {
        const empty: Record<string, number> = {};
        for (const id of courseIds) empty[id] = 0;
        setCourseAttendeeCounts(empty);
        setCountsLoading(false);
        return;
      }

      const sessionIds = sessionData.map((s) => s.id);
      const sessionToCourse: Record<string, string> = {};
      for (const s of sessionData) sessionToCourse[s.id] = s.course_id;

      const { data: records } = await supabase
        .from('attendance_records')
        .select('student_id, session_id')
        .in('session_id', sessionIds);

      const sets: Record<string, Set<string>> = {};
      for (const id of courseIds) sets[id] = new Set();
      for (const rec of records ?? []) {
        const courseId = sessionToCourse[rec.session_id];
        if (courseId) sets[courseId].add(rec.student_id);
      }

      const result: Record<string, number> = {};
      for (const [courseId, set] of Object.entries(sets)) {
        result[courseId] = set.size;
      }
      setCourseAttendeeCounts(result);
      setCountsLoading(false);
    }
    loadCounts();
  }, [courses]);

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
    const header =
      'checked_in_at,full_name,matric_number,student_id,distance_meters,gps_accuracy_meters,webauthn_verified,flagged_reason';
    const rows = attendance.map((r) =>
      [
        r.checked_in_at,
        r.profiles?.full_name ?? '',
        r.profiles?.matric_number ?? '',
        r.student_id,
        r.distance_meters,
        r.gps_accuracy_meters ?? '',
        r.webauthn_verified,
        r.flagged_reason ?? '',
      ].join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${selectedSessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);

  return (
    <LecturerLayout title="Attendance Records" subtitle="View and export historical check-ins">
      <div className="max-w-6xl space-y-6">

        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Your Courses
          </h2>
          {courses.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-400 shadow-xs">
              No courses found. Add courses from the Courses page.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => {
                const count = courseAttendeeCounts[course.id] ?? 0;
                const isSelected = selectedCourseId === course.id;
                return (
                  <button
                    key={course.id}
                    id={`course-card-${course.id}`}
                    onClick={() => setSelectedCourseId(isSelected ? '' : course.id)}
                    className={`cursor-pointer rounded-2xl border p-5 text-left shadow-xs transition-all duration-200 ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600 shadow-md shadow-blue-100'
                        : 'border-gray-100 bg-white hover:border-blue-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {course.code.split(' ')[0]}
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {countsLoading ? '—' : `${count} attendee${count !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                    <div className="mt-3">
                      <p className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                        {course.code}
                      </p>
                      <p className={`mt-0.5 text-xs ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                        {course.title}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedCourseId && (
          <>
            <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-xs sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                  Session — <span className="text-blue-600">{selectedCourse?.code}</span>
                </label>
                <select
                  id="session-select"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  disabled={sessions.length === 0}
                >
                  <option value="">
                    {sessions.length === 0 ? 'No sessions found' : 'Select a session...'}
                  </option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.started_at).toLocaleString()} {s.is_active ? '(Live)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button
                id="export-csv-btn"
                onClick={exportCsv}
                disabled={!attendance.length}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                Export CSV
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xs">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-4">
                <h2 className="font-semibold text-gray-900">Session Attendance</h2>
                <span className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-500">
                  {attendance.length} check-in{attendance.length !== 1 ? 's' : ''}
                </span>
              </div>

              {loading ? (
                <div className="animate-pulse p-16 text-center text-sm font-medium text-gray-400">Loading records...</div>
              ) : !selectedSessionId ? (
                <div className="p-16 text-center text-sm font-medium text-gray-500">
                  Please select a session to view attendance.
                </div>
              ) : attendance.length === 0 ? (
                <div className="p-16 text-center text-sm font-medium text-gray-500">
                  No students checked in for this session.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                        <th className="px-6 py-3">Student Name</th>
                        <th className="px-6 py-3">Matric Number</th>
                        <th className="px-6 py-3">Check-in Time</th>
                        <th className="px-6 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {attendance.map((row) => (
                        <tr key={row.id} className="transition hover:bg-gray-50/50">
                          <td className="px-6 py-4 font-medium text-gray-900">
                            {row.profiles?.full_name ?? row.student_id.slice(0, 8)}
                          </td>
                          <td className="px-6 py-4 text-xs font-medium text-gray-600">
                            {row.profiles?.matric_number ?? 'N/A'}
                          </td>
                          <td className="px-6 py-4 tabular-nums text-xs font-medium text-gray-500">
                            {new Date(row.checked_in_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </td>
                          <td className="px-6 py-4">
                            {row.flagged_reason ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/60 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                Flagged
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
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
          </>
        )}
      </div>
    </LecturerLayout>
  );
}

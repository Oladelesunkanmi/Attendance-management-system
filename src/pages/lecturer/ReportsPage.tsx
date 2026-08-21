import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import LecturerLayout from '../../components/LecturerLayout';
import type { Database } from '../../lib/database.types';

type Course = Database['public']['Tables']['courses']['Row'];
type Session = Database['public']['Tables']['sessions']['Row'];

interface AttendanceRecord {
  id: string;
  session_id: string;
  student_id: string;
  flagged_reason: string | null;
  checked_in_at: string;
}

interface EnrollmentWithProfile {
  student_id: string;
  profiles: { full_name: string; matric_number: string | null } | null;
}

// ── Risk status helpers ────────────────────────────────────────────────────
function getStatus(pct: number, threshold: number): 'safe' | 'at-risk' | 'critical' {
  if (pct >= threshold) return 'safe';
  if (pct >= threshold - 15) return 'at-risk';
  return 'critical';
}

const STATUS_STYLES = {
  safe:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  'at-risk': 'bg-amber-50 text-amber-700 border-amber-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

const STATUS_LABEL = {
  safe:     'Safe',
  'at-risk': 'At Risk',
  critical: 'Critical',
};

// ── Small reusable badge ───────────────────────────────────────────────────
function StatusBadge({ pct, threshold }: { pct: number; threshold: number }) {
  const s = getStatus(pct, threshold);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${STATUS_STYLES[s]}`}>
      {STATUS_LABEL[s]}
    </span>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────
function ProgressBar({ pct, threshold }: { pct: number; threshold: number }) {
  const s = getStatus(pct, threshold);
  const colors = {
    safe: 'bg-emerald-500',
    'at-risk': 'bg-amber-500',
    critical: 'bg-red-500',
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${colors[s]}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-xs font-bold tabular-nums w-10 text-right text-gray-700">{pct}%</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function ReportsPage() {
  const { profile } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentWithProfile[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Load lecturer's courses ──────────────────────────────────────────────
  useEffect(() => {
    if (!profile) return;
    supabase.from('courses').select('*').eq('lecturer_id', profile.id).order('code')
      .then(({ data }) => setCourses(data ?? []));
  }, [profile]);

  // ── Load sessions + records + enrollments when course changes ────────────
  useEffect(() => {
    if (!selectedCourseId) return;
    setLoading(true);

    async function load() {
      // 1. All sessions for this course
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*')
        .eq('course_id', selectedCourseId)
        .order('started_at', { ascending: false });

      const loadedSessions = sessionData ?? [];
      setSessions(loadedSessions);

      if (loadedSessions.length === 0) {
        setRecords([]);
        setEnrollments([]);
        setLoading(false);
        return;
      }

      const sessionIds = loadedSessions.map((s) => s.id);

      // 2. All attendance records for those sessions
      const { data: recData } = await supabase
        .from('attendance_records')
        .select('id, session_id, student_id, flagged_reason, checked_in_at')
        .in('session_id', sessionIds);

      setRecords((recData ?? []) as AttendanceRecord[]);

      // 3. Enrollments with profile join
      const { data: enrData } = await supabase
        .from('enrollments')
        .select('student_id, profiles(full_name, matric_number)')
        .eq('course_id', selectedCourseId);

      setEnrollments((enrData ?? []) as unknown as EnrollmentWithProfile[]);
      setLoading(false);
    }

    load();
  }, [selectedCourseId]);

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);
  const threshold = selectedCourse?.min_attendance_pct ?? 75;
  const totalSessions = sessions.length;

  // ── Per-session frequency rows ───────────────────────────────────────────
  const sessionRows = useMemo(() => {
    return sessions.map((s) => {
      const sessionRecs = records.filter((r) => r.session_id === s.id);
      const checkedIn = sessionRecs.length;
      const flagged = sessionRecs.filter((r) => r.flagged_reason).length;
      const enrolled = enrollments.length;
      const pct = enrolled > 0 ? Math.round((checkedIn / enrolled) * 100) : 0;
      return { session: s, checkedIn, enrolled, pct, flagged };
    });
  }, [sessions, records, enrollments]);

  // ── Per-student breakdown rows ───────────────────────────────────────────
  const studentRows = useMemo(() => {
    return enrollments.map((enr) => {
      const attended = records.filter((r) => r.student_id === enr.student_id).length;
      const pct = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 100;
      return {
        student_id: enr.student_id,
        full_name: enr.profiles?.full_name ?? 'Unknown',
        matric_number: enr.profiles?.matric_number ?? '—',
        attended,
        total: totalSessions,
        pct,
      };
    }).sort((a, b) => a.pct - b.pct); // worst first
  }, [enrollments, records, totalSessions]);

  // ── Summary stats ────────────────────────────────────────────────────────
  const atRiskCount = studentRows.filter((r) => getStatus(r.pct, threshold) !== 'safe').length;
  const overallRate =
    studentRows.length > 0
      ? Math.round(studentRows.reduce((acc, r) => acc + r.pct, 0) / studentRows.length)
      : 0;

  // ── CSV export ───────────────────────────────────────────────────────────
  function exportCsv() {
    if (!studentRows.length) return;
    const header = 'full_name,matric_number,sessions_attended,total_sessions,attendance_pct,status';
    const rows = studentRows.map((r) =>
      [r.full_name, r.matric_number, r.attended, r.total, r.pct, STATUS_LABEL[getStatus(r.pct, threshold)]].join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${selectedCourse?.code ?? 'course'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <LecturerLayout title="Frequency Reports" subtitle="Per-course session and student attendance analytics">
      <div className="max-w-6xl space-y-8">

        {/* ── Course selector ─────────────────────────────────────────── */}
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Select a Course</h2>
          {courses.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-400 shadow-xs">
              No courses found. Add courses from the Courses page.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => {
                const isSelected = selectedCourseId === course.id;
                return (
                  <button
                    key={course.id}
                    id={`report-course-${course.id}`}
                    onClick={() => setSelectedCourseId(isSelected ? '' : course.id)}
                    className={`cursor-pointer rounded-2xl border p-5 text-left shadow-xs transition-all duration-200 ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600 shadow-md shadow-blue-100'
                        : 'border-gray-100 bg-white hover:border-blue-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-xs font-bold ${isSelected ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-700'}`}>
                        {course.code.split(' ')[0]}
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${isSelected ? 'bg-white/20 text-white border-white/20' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                        ≥ {course.min_attendance_pct}%
                      </span>
                    </div>
                    <div className="mt-3">
                      <p className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-900'}`}>{course.code}</p>
                      <p className={`mt-0.5 text-xs ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>{course.title}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Report body ─────────────────────────────────────────────── */}
        {selectedCourseId && (
          <>
            {loading ? (
              <div className="animate-pulse rounded-2xl bg-white p-16 text-center text-sm font-medium text-gray-400 shadow-xs border border-gray-100">
                Loading report data…
              </div>
            ) : (
              <>
                {/* ── Summary stats ──────────────────────────────────── */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'Sessions Held', value: totalSessions, sub: 'total classes' },
                    { label: 'Enrolled Students', value: enrollments.length, sub: 'in this course' },
                    { label: 'Avg Attendance Rate', value: `${overallRate}%`, sub: 'across all sessions' },
                    {
                      label: 'At-Risk Students',
                      value: atRiskCount,
                      sub: `below ${threshold}% threshold`,
                      highlight: atRiskCount > 0,
                    },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className={`rounded-2xl bg-white p-5 shadow-xs border ${stat.highlight ? 'border-amber-200 bg-amber-50/30' : 'border-gray-100'}`}
                    >
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{stat.label}</p>
                      <p className={`mt-1 text-3xl font-extrabold tracking-tight ${stat.highlight ? 'text-amber-700' : 'text-gray-900'}`}>{stat.value}</p>
                      <p className="mt-0.5 text-xs text-gray-400 font-medium">{stat.sub}</p>
                    </div>
                  ))}
                </div>

                {/* ── Per-session frequency table ─────────────────────── */}
                <div className="rounded-2xl bg-white shadow-xs border border-gray-100 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-4">
                    <h3 className="font-semibold text-gray-900">Session Frequency</h3>
                    <span className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-500">
                      {sessionRows.length} session{sessionRows.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {sessionRows.length === 0 ? (
                    <p className="px-6 py-10 text-sm text-center text-gray-400">No sessions recorded for this course yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                            <th className="px-6 py-3">Session Date</th>
                            <th className="px-6 py-3">Enrolled</th>
                            <th className="px-6 py-3">Checked In</th>
                            <th className="px-6 py-3 w-40">Attendance</th>
                            <th className="px-6 py-3">Flagged</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {sessionRows.map(({ session, checkedIn, enrolled, pct, flagged }) => (
                            <tr key={session.id} className="hover:bg-gray-50/50 transition">
                              <td className="px-6 py-4 text-xs font-medium text-gray-700 tabular-nums">
                                {new Date(session.started_at).toLocaleString()}
                                {session.is_active && (
                                  <span className="ml-2 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-600">● Live</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-xs font-medium text-gray-600">{enrolled}</td>
                              <td className="px-6 py-4 text-xs font-medium text-gray-900">{checkedIn}</td>
                              <td className="px-6 py-4 w-40">
                                <ProgressBar pct={pct} threshold={threshold} />
                              </td>
                              <td className="px-6 py-4">
                                {flagged > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                                    {flagged} flagged
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400 font-medium">None</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── Per-student breakdown ───────────────────────────── */}
                <div className="rounded-2xl bg-white shadow-xs border border-gray-100 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-6 py-4">
                    <div>
                      <h3 className="font-semibold text-gray-900">Student Breakdown</h3>
                      <p className="text-[11px] text-gray-500 mt-0.5">Sorted by lowest attendance first</p>
                    </div>
                    <button
                      id="reports-export-csv"
                      onClick={exportCsv}
                      disabled={!studentRows.length}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-sm"
                    >
                      Export CSV
                    </button>
                  </div>

                  {studentRows.length === 0 ? (
                    <p className="px-6 py-10 text-sm text-center text-gray-400">No enrolled students found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                            <th className="px-6 py-3">Student Name</th>
                            <th className="px-6 py-3">Matric No.</th>
                            <th className="px-6 py-3">Attended</th>
                            <th className="px-6 py-3 w-44">Attendance</th>
                            <th className="px-6 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {studentRows.map((row) => (
                            <tr key={row.student_id} className="hover:bg-gray-50/50 transition">
                              <td className="px-6 py-4 font-medium text-gray-900">{row.full_name}</td>
                              <td className="px-6 py-4 text-xs font-medium text-gray-500">{row.matric_number}</td>
                              <td className="px-6 py-4 text-xs font-medium text-gray-700 tabular-nums">
                                {row.attended} / {row.total}
                              </td>
                              <td className="px-6 py-4 w-44">
                                <ProgressBar pct={row.pct} threshold={threshold} />
                              </td>
                              <td className="px-6 py-4">
                                <StatusBadge pct={row.pct} threshold={threshold} />
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
          </>
        )}
      </div>
    </LecturerLayout>
  );
}

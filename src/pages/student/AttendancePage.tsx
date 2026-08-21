import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import StudentLayout from '../../components/StudentLayout';

interface EnrolledCourse {
  id: string;
  code: string;
  title: string;
  min_attendance_pct: number;
}

interface SessionMeta {
  id: string;
  course_id: string;
  started_at: string;
  courses?: { code: string; title: string } | null;
  venues?: { name: string } | null;
}

interface AttendanceItem {
  id: string;
  session_id: string;
  checked_in_at: string;
  flagged_reason: string | null;
  sessions?: SessionMeta | null;
}

function getStatus(pct: number, threshold: number): 'safe' | 'at-risk' | 'critical' {
  if (pct >= threshold) return 'safe';
  if (pct >= threshold - 15) return 'at-risk';
  return 'critical';
}

const STATUS_STYLES = {
  safe: { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Safe' },
  'at-risk': { bar: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'At Risk' },
  critical: { bar: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200', label: 'Critical' },
};

// ════════════════════════════════════════════════════════════════════════════
export default function StudentAttendancePage() {
  const { profile } = useAuth();
  const [courses, setCourses] = useState<EnrolledCourse[]>([]);
  const [allSessions, setAllSessions] = useState<{ id: string; course_id: string }[]>([]);
  const [history, setHistory] = useState<AttendanceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;

    async function load() {
      setLoading(true);

      // 1. Enrolled courses (with threshold)
      const { data: enrData } = await supabase
        .from('enrollments')
        .select('course_id, courses(id, code, title, min_attendance_pct)')
        .eq('student_id', profile!.id);

      const enrolledCourses: EnrolledCourse[] = (enrData ?? []).flatMap((e) => {
        const c = e.courses as unknown as EnrolledCourse | null;
        return c ? [c] : [];
      });
      setCourses(enrolledCourses);

      if (enrolledCourses.length === 0) { setLoading(false); return; }

      const courseIds = enrolledCourses.map((c) => c.id);

      // 2. All sessions for enrolled courses
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('id, course_id')
        .in('course_id', courseIds);

      setAllSessions(sessionData ?? []);

      // 3. All attendance records for this student
      const { data: recData } = await supabase
        .from('attendance_records')
        .select('id, session_id, checked_in_at, flagged_reason, sessions(id, course_id, started_at, courses(code, title), venues(name))')
        .eq('student_id', profile!.id)
        .order('checked_in_at', { ascending: false });

      setHistory((recData as unknown as AttendanceItem[]) ?? []);
      setLoading(false);
    }

    load();
  }, [profile]);

  // ── Per-subject summary ─────────────────────────────────────────────────
  const courseStats = useMemo(() => {
    return courses.map((course) => {
      const courseSessions = allSessions.filter((s) => s.course_id === course.id);
      const total = courseSessions.length;
      const attended = history.filter((r) => r.sessions?.course_id === course.id).length;
      const pct = total > 0 ? Math.round((attended / total) * 100) : 100;
      const status = getStatus(pct, course.min_attendance_pct);
      return { course, total, attended, pct, status };
    });
  }, [courses, allSessions, history]);

  const overallAttended = history.length;
  const overallVerified = history.filter((r) => !r.flagged_reason).length;

  return (
    <StudentLayout title="My Attendance" subtitle="Per-subject breakdown and full check-in history">
      <div className="max-w-5xl space-y-8">

        {loading ? (
          <div className="animate-pulse rounded-2xl bg-white p-16 text-center text-sm text-gray-400 shadow-xs border border-gray-100">
            Loading attendance data…
          </div>
        ) : (
          <>
            {/* ── Quick stats ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white p-5 shadow-xs border border-gray-100">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Courses Enrolled</p>
                <p className="text-3xl font-extrabold text-gray-900 mt-1">{courses.length}</p>
                <p className="text-xs text-gray-400 mt-0.5 font-medium">active subjects</p>
              </div>
              <div className="rounded-2xl bg-white p-5 shadow-xs border border-gray-100">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Total Check-ins</p>
                <p className="text-3xl font-extrabold text-gray-900 mt-1">{overallAttended}</p>
                <p className="text-xs text-gray-400 mt-0.5 font-medium">recorded sessions</p>
              </div>
              <div className="rounded-2xl bg-white p-5 shadow-xs border border-gray-100 col-span-2 sm:col-span-1">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Verified Rate</p>
                <p className="text-3xl font-extrabold text-emerald-600 mt-1">
                  {overallAttended > 0 ? Math.round((overallVerified / overallAttended) * 100) : 100}%
                </p>
                <p className="text-xs text-gray-400 mt-0.5 font-medium">clean check-ins</p>
              </div>
            </div>

            {/* ── Per-subject cards ─────────────────────────────────────── */}
            <div>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Subject Breakdown</h2>
              {courseStats.length === 0 ? (
                <div className="rounded-2xl bg-white p-10 text-center text-sm text-gray-400 shadow-xs border border-gray-100">
                  You are not enrolled in any courses yet. Visit the <strong>My Courses</strong> page to enrol.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {courseStats.map(({ course, total, attended, pct, status }) => {
                    const style = STATUS_STYLES[status];
                    return (
                      <div
                        key={course.id}
                        className="rounded-2xl bg-white p-5 shadow-xs border border-gray-100 hover:shadow-sm transition"
                      >
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xs font-bold text-blue-700">
                              {course.code.split(' ')[0]}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-gray-900">{course.code}</p>
                              <p className="text-xs text-gray-500 font-medium mt-0.5 line-clamp-1">{course.title}</p>
                            </div>
                          </div>
                          <span className={`flex-shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${style.badge}`}>
                            {style.label}
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
                            <span>{attended} / {total} sessions attended</span>
                            <span className="tabular-nums">{pct}%</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${style.bar}`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-gray-400 font-medium">
                            <span>Threshold: ≥ {course.min_attendance_pct}%</span>
                            {pct < course.min_attendance_pct && (
                              <span className="text-red-500 font-semibold">
                                Need {course.min_attendance_pct - pct}pp more
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Full history table ────────────────────────────────────── */}
            <div className="rounded-2xl bg-white shadow-xs border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-4">
                <h2 className="font-semibold text-gray-900">Full Check-In History</h2>
                <span className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-500">
                  {history.length} record{history.length !== 1 ? 's' : ''}
                </span>
              </div>

              {history.length === 0 ? (
                <div className="py-16 text-center text-gray-400">
                  <p className="text-2xl mb-2">📋</p>
                  <p className="text-sm font-medium">No check-in records yet</p>
                  <p className="text-xs mt-1">Scan your first session QR code to mark attendance.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                        <th className="px-6 py-3">Course</th>
                        <th className="px-6 py-3">Session Date</th>
                        <th className="px-6 py-3">Venue</th>
                        <th className="px-6 py-3">Check-In Time</th>
                        <th className="px-6 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {history.map((record) => {
                        const course = record.sessions?.courses;
                        const venue = record.sessions?.venues;
                        const sessionDate = record.sessions?.started_at
                          ? new Date(record.sessions.started_at).toLocaleDateString()
                          : '—';
                        const checkInTime = new Date(record.checked_in_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        });

                        return (
                          <tr key={record.id} className="hover:bg-gray-50/50 transition">
                            <td className="px-6 py-4">
                              <p className="font-semibold text-gray-900 text-xs">{course?.code ?? '—'}</p>
                              <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{course?.title}</p>
                            </td>
                            <td className="px-6 py-4 text-xs font-medium text-gray-600 tabular-nums">{sessionDate}</td>
                            <td className="px-6 py-4 text-xs font-medium text-gray-500">{venue?.name ?? '—'}</td>
                            <td className="px-6 py-4 text-xs font-medium text-gray-500 tabular-nums">{checkInTime}</td>
                            <td className="px-6 py-4">
                              {record.flagged_reason ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                                  ⚠ Flagged
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                                  ✓ Verified
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </StudentLayout>
  );
}

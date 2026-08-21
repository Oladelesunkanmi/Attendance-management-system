import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import LecturerLayout from '../../components/LecturerLayout';
import type { Database } from '../../lib/database.types';

type Course = Database['public']['Tables']['courses']['Row'];

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [minPct, setMinPct] = useState(75);
  const [error, setError] = useState<string | null>(null);

  // ── Inline edit state ───────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editMinPct, setEditMinPct] = useState(75);
  const [editLoading, setEditLoading] = useState(false);

  async function loadCourses() {
    const { data, error: loadError } = await supabase.from('courses').select('*').order('code');
    if (loadError) setError(loadError.message);
    else setCourses(data ?? []);
  }

  useEffect(() => { loadCourses(); }, []);

  async function createCourse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error: insertError } = await supabase.from('courses').insert({
      code,
      title,
      lecturer_id: user.id,
      min_attendance_pct: minPct,
    });
    if (insertError) setError(insertError.message);
    else { setCode(''); setTitle(''); setMinPct(75); await loadCourses(); }
  }

  function startEdit(course: Course) {
    setEditingId(course.id);
    setEditCode(course.code);
    setEditTitle(course.title);
    setEditMinPct(course.min_attendance_pct);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(courseId: string) {
    setEditLoading(true);
    setError(null);
    const { error: updateError } = await supabase.from('courses').update({
      code: editCode,
      title: editTitle,
      min_attendance_pct: editMinPct,
    }).eq('id', courseId);
    setEditLoading(false);
    if (updateError) { setError(updateError.message); return; }
    setEditingId(null);
    await loadCourses();
  }

  function pctColor(pct: number) {
    if (pct >= 80) return 'bg-red-50 text-red-700 border-red-200';
    if (pct >= 70) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }

  return (
    <LecturerLayout title="Courses" subtitle="Manage your courses and attendance thresholds">
      <div className="max-w-2xl space-y-6">
        {/* ── Add course form ───────────────────────────────────────────── */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="mb-4 font-semibold text-gray-900">Add a new course</h2>
          <form onSubmit={createCourse} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Course code</label>
                <input
                  id="new-course-code"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 focus:border-blue-500 transition"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. CSC 401"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Min Attendance %
                </label>
                <input
                  id="new-course-min-pct"
                  type="number"
                  min={1}
                  max={100}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 focus:border-blue-500 transition"
                  value={minPct}
                  onChange={(e) => setMinPct(Number(e.target.value))}
                  required
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Title</label>
              <input
                id="new-course-title"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 focus:border-blue-500 transition"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Computer Networks"
                required
              />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
            >
              Add course
            </button>
          </form>
        </div>

        {/* ── Course list ───────────────────────────────────────────────── */}
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Your courses ({courses.length})</h2>
          </div>
          {courses.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-400">No courses yet. Add one above.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {courses.map((course) => (
                <li key={course.id} className="px-6 py-4">
                  {editingId === course.id ? (
                    /* ── Inline edit form ──────────────────────────────── */
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600">Code</label>
                          <input
                            className="w-full rounded-lg border border-blue-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition"
                            value={editCode}
                            onChange={(e) => setEditCode(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600">Min %</label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            className="w-full rounded-lg border border-blue-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition"
                            value={editMinPct}
                            onChange={(e) => setEditMinPct(Number(e.target.value))}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Title</label>
                        <input
                          className="w-full rounded-lg border border-blue-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => saveEdit(course.id)}
                          disabled={editLoading}
                          className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                        >
                          {editLoading ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Display row ───────────────────────────────────── */
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xs font-bold text-blue-700">
                        {course.code.split(' ')[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">{course.code}</p>
                        <p className="text-sm text-gray-500 truncate">{course.title}</p>
                      </div>
                      <span
                        className={`flex-shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${pctColor(course.min_attendance_pct)}`}
                        title="Minimum attendance threshold"
                      >
                        ≥ {course.min_attendance_pct}%
                      </span>
                      <button
                        onClick={() => startEdit(course)}
                        className="flex-shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </LecturerLayout>
  );
}

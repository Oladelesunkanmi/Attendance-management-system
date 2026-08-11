import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import LecturerLayout from '../../components/LecturerLayout';
import type { Database } from '../../lib/database.types';

type Course = Database['public']['Tables']['courses']['Row'];

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    const { error: insertError } = await supabase.from('courses').insert({ code, title, lecturer_id: user.id });
    if (insertError) setError(insertError.message);
    else { setCode(''); setTitle(''); await loadCourses(); }
  }

  return (
    <LecturerLayout title="Courses" subtitle="Manage your courses and enrollments">
      <div className="max-w-2xl space-y-6">
        {/* Add course form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-semibold text-gray-900">Add a new course</h2>
          <form onSubmit={createCourse} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Course code</label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 focus:border-blue-500 transition"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. CSC 401"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Title</label>
              <input
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

        {/* Course list */}
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Your courses ({courses.length})</h2>
          </div>
          {courses.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-400">No courses yet. Add one above.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {courses.map((course) => (
                <li key={course.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xs font-bold text-blue-700">
                    {course.code.split(' ')[0]}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{course.code}</p>
                    <p className="text-sm text-gray-500">{course.title}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </LecturerLayout>
  );
}

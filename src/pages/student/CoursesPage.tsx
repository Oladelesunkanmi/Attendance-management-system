import { useEffect, useState } from "react";
import { supabase, callApi } from "../../lib/supabase";
import StudentLayout from "../../components/StudentLayout";
import { useAuth } from "../../contexts/AuthContext";
import { ErrorText } from "../../components/ui";

interface Course {
  id: string;
  code: string;
  title: string;
}

export default function StudentCoursesPage() {
  const { profile } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrolledCourseIds, setEnrolledCourseIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!profile) return;
      try {
        const { data: allCourses, error: coursesErr } = await supabase
          .from("courses")
          .select("id, code, title")
          .order("code");
        if (coursesErr) throw coursesErr;

        const { data: enrollments, error: enrollmentsErr } = await supabase
          .from("enrollments")
          .select("course_id")
          .eq("student_id", profile.id);
        if (enrollmentsErr) throw enrollmentsErr;

        setCourses(allCourses ?? []);
        setEnrolledCourseIds(new Set(enrollments?.map((e) => e.course_id) ?? []));
      } catch (err) {
        console.error(err);
        setError("Failed to load courses.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [profile]);

  async function handleEnrol(courseId: string) {
    if (!profile) return;
    setError(null);
    setActionLoading(courseId);
    try {
      const result = await callApi<{ success: boolean; message: string }>("enrol-course", { courseId });
      if (result.success) {
        setEnrolledCourseIds((prev) => new Set(prev).add(courseId));
      }
    } catch (err) {
      console.error(err);
      setError("Failed to enrol in course. " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <StudentLayout title="Course Registration" subtitle="Browse and enrol in your courses">
      <div className="max-w-3xl space-y-6">
        {error && <ErrorText>{error}</ErrorText>}

        <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
            <h2 className="font-semibold text-gray-900">Available Courses</h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm font-medium text-gray-400 animate-pulse">
              Loading courses...
            </div>
          ) : courses.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No courses available.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {courses.map((course) => {
                const isEnrolled = enrolledCourseIds.has(course.id);
                const isLoading = actionLoading === course.id;

                return (
                  <li
                    key={course.id}
                    className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-4 hover:bg-gray-50/50 transition"
                  >
                    {/* Course icon */}
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xs font-bold text-blue-700">
                      {course.code.split(" ")[0]}
                    </div>

                    {/* Title - takes remaining space, truncates if too long */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-gray-900">{course.code}</h3>
                      <p className="text-xs font-medium text-gray-500 mt-0.5 truncate">{course.title}</p>
                    </div>

                    {/* Action */}
                    <div className="flex-shrink-0">
                      {isEnrolled ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 border border-emerald-100">
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Enrolled
                        </span>
                      ) : (
                        <button
                          onClick={() => handleEnrol(course.id)}
                          disabled={isLoading}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition shadow-sm disabled:opacity-50 active:scale-[0.97]"
                        >
                          {isLoading ? "Enrolling..." : "Enrol Now"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </StudentLayout>
  );
}
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button, Card, ErrorText, Input, Label, Shell } from '../../components/ui';
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

  useEffect(() => {
    loadCourses();
  }, []);

  async function createCourse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error: insertError } = await supabase.from('courses').insert({
      code,
      title,
      lecturer_id: user.id,
    });
    if (insertError) setError(insertError.message);
    else {
      setCode('');
      setTitle('');
      await loadCourses();
    }
  }

  return (
    <Shell title="Courses">
      <div className="mb-4">
        <Link to="/" className="text-sm text-emerald-400">← Home</Link>
      </div>
      <Card>
        <form onSubmit={createCourse} className="space-y-3">
          <div>
            <Label>Course code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CSC 401" required />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <Button type="submit">Add course</Button>
          <ErrorText>{error}</ErrorText>
        </form>
      </Card>
      <div className="mt-6 space-y-3">
        {courses.map((course) => (
          <Card key={course.id}>
            <p className="font-medium">{course.code}</p>
            <p className="text-sm text-slate-400">{course.title}</p>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

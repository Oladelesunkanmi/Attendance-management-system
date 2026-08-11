import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button, Card, Shell } from '../components/ui';

export default function HomePage() {
  const { profile, signOut } = useAuth();

  if (!profile) return null;

  const isLecturer = profile.role === 'lecturer';

  return (
    <Shell
      title={`Welcome, ${profile.full_name}`}
      subtitle={isLecturer ? 'Lecturer dashboard' : 'Student check-in portal'}
    >
      <div className="space-y-4">
        <Card>
          <p className="text-sm text-slate-300">
            Signed in as <span className="font-medium text-white">{profile.role}</span>
            {profile.matric_number ? ` · ${profile.matric_number}` : ''}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {isLecturer ? (
              <>
                <Link to="/lecturer/courses"><Button>Courses</Button></Link>
                <Link to="/lecturer/venues"><Button variant="secondary">Venues</Button></Link>
                <Link to="/lecturer/sessions"><Button variant="secondary">Sessions</Button></Link>
                <Link to="/lecturer/enrolment"><Button variant="secondary">Supervise enrolment</Button></Link>
              </>
            ) : (
              <>
                <Link to="/student/check-in"><Button>Check in</Button></Link>
                <Link to="/student/enrol"><Button variant="secondary">Enrol biometrics</Button></Link>
              </>
            )}
            <Button variant="danger" onClick={() => signOut()}>Sign out</Button>
          </div>
        </Card>
      </div>
    </Shell>
  );
}

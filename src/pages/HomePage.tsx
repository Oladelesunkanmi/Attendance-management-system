import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button, Card, Shell } from '../components/ui';

export default function HomePage() {
  const { profile, loading, user, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f4f7fe] text-gray-500 text-sm font-medium">
        Loading dashboard…
      </div>
    );
  }

  if (!profile) {
    return (
      <Shell title="Profile Missing">
        <Card className="space-y-4">
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 text-amber-300 text-sm">
            <p className="font-semibold text-amber-200">No profile found for your account ({user?.email})</p>
            <p className="mt-1">
              Your authentication account exists, but your profile record in the database was not found or could not be loaded.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="danger" onClick={() => signOut()}>
              Sign out & try again
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }

  if (profile.role === 'lecturer') {
    return <Navigate to="/lecturer/sessions" replace />;
  }

  return <Navigate to="/student/check-in" replace />;
}


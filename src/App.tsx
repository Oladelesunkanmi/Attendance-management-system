import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import HomePage from './pages/HomePage';
import CoursesPage from './pages/lecturer/CoursesPage';
import VenuesPage from './pages/lecturer/VenuesPage';
import SessionsPage from './pages/lecturer/SessionsPage';
import SuperviseEnrolmentPage from './pages/lecturer/SuperviseEnrolmentPage';
import CheckInPage from './pages/student/CheckInPage';
import EnrolWebAuthnPage from './pages/student/EnrolWebAuthnPage';

function ProtectedRoute({
  children,
  allowedRole,
}: {
  children: React.ReactNode;
  allowedRole?: 'student' | 'lecturer';
}) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRole && profile && profile.role !== allowedRole) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/"
        element={(
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        )}
      />
      <Route path="/lecturer/courses" element={<ProtectedRoute allowedRole="lecturer"><CoursesPage /></ProtectedRoute>} />
      <Route path="/lecturer/venues" element={<ProtectedRoute allowedRole="lecturer"><VenuesPage /></ProtectedRoute>} />
      <Route path="/lecturer/sessions" element={<ProtectedRoute allowedRole="lecturer"><SessionsPage /></ProtectedRoute>} />
      <Route path="/lecturer/enrolment" element={<ProtectedRoute allowedRole="lecturer"><SuperviseEnrolmentPage /></ProtectedRoute>} />
      <Route path="/student/check-in" element={<ProtectedRoute allowedRole="student"><CheckInPage /></ProtectedRoute>} />
      <Route path="/student/enrol" element={<ProtectedRoute allowedRole="student"><EnrolWebAuthnPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

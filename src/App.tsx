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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
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
      <Route path="/lecturer/courses" element={<ProtectedRoute><CoursesPage /></ProtectedRoute>} />
      <Route path="/lecturer/venues" element={<ProtectedRoute><VenuesPage /></ProtectedRoute>} />
      <Route path="/lecturer/sessions" element={<ProtectedRoute><SessionsPage /></ProtectedRoute>} />
      <Route path="/lecturer/enrolment" element={<ProtectedRoute><SuperviseEnrolmentPage /></ProtectedRoute>} />
      <Route path="/student/check-in" element={<ProtectedRoute><CheckInPage /></ProtectedRoute>} />
      <Route path="/student/enrol" element={<ProtectedRoute><EnrolWebAuthnPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

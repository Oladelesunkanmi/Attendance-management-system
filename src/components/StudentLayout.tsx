import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function StudentLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'ST';

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-[#f4f7fe] flex flex-col">
      {/* ── Student Header ────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
          
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-600/30">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422A12.083 12.083 0 0121 13c0 5.523-4.477 10-10 10S1 18.523 1 13c0-.857.11-1.69.316-2.482L12 14z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 leading-tight">Attendance</h1>
              <p className="text-[11px] text-blue-600 font-semibold">Student Portal</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center gap-2">
            <NavLink
              to="/student/check-in"
              className={({ isActive }) =>
                `px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border border-blue-100 font-bold'
                    : 'text-gray-600 hover:bg-gray-50'
                }`
              }
            >
              Check In
            </NavLink>
            <NavLink
              to="/student/enrol"
              className={({ isActive }) =>
                `px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border border-blue-100 font-bold'
                    : 'text-gray-600 hover:bg-gray-50'
                }`
              }
            >
              Enrol Biometrics
            </NavLink>
          </nav>

          {/* User Profile & Sign Out Controls */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-gray-50 transition"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white shadow-xs ring-2 ring-emerald-100">
                  {initials}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-xs font-bold text-gray-900 leading-tight">{profile?.full_name ?? 'Student'}</p>
                  <p className="text-[10px] text-gray-500 font-medium">{profile?.matric_number ?? 'Student'}</p>
                </div>
                <svg className="h-4 w-4 text-gray-400 ml-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-xs font-bold text-gray-900">{profile?.full_name ?? 'Student'}</p>
                    <p className="text-[11px] text-gray-500">{profile?.matric_number ?? 'Student'}</p>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="w-full px-4 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 transition"
                  >
                    <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>

            {/* Direct Logout Button */}
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200/60 px-3 py-2 text-xs font-bold transition-all shadow-2xs"
              title="Sign out of account"
            >
              <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content Container ───────────────────────────────── */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs font-medium text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}

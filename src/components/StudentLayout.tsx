import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const navLinks = [
  { to: "/student/check-in", label: "Check In" },
  { to: "/student/courses",  label: "My Courses" },
  { to: "/student/enrol",    label: "Enrol Biometrics" },
];

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
    ? profile.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "ST";

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-[#f4f7fe] flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">

          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-600/30">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422A12.083 12.083 0 0121 13c0 5.523-4.477 10-10 10S1 18.523 1 13c0-.857.11-1.69.316-2.482L12 14z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 leading-tight">Attendance</h1>
              <p className="text-[11px] text-blue-600 font-semibold">Student Portal</p>
            </div>
          </div>

          {/* Desktop nav links */}
          <nav className="hidden sm:flex items-center gap-1 flex-1 justify-center">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-blue-50 text-blue-700 border border-blue-100 font-bold"
                      : "text-gray-600 hover:bg-gray-50"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          {/* Desktop: avatar + sign out */}
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <div className="text-right">
              <p className="text-xs font-bold text-gray-900 leading-tight">{profile?.full_name ?? "Student"}</p>
              <p className="text-[10px] text-gray-500">{profile?.matric_number ?? ""}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white shadow-xs ring-2 ring-emerald-100 flex-shrink-0">
              {initials}
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200/60 px-3 py-2 text-xs font-bold transition-all"
              title="Sign out"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Sign out</span>
            </button>
          </div>

          {/* Mobile: avatar + hamburger */}
          <div className="flex sm:hidden items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white ring-2 ring-emerald-100">
              {initials}
            </div>
            <button
              id="mobile-menu-btn"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-50 hover:bg-gray-100 transition text-gray-700 border border-gray-200"
              aria-label="Toggle menu"
            >
              {menuOpen ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        {menuOpen && (
          <div className="sm:hidden border-t border-gray-100 bg-white px-4 pb-4 pt-2 space-y-1">
            {/* User info */}
            <div className="flex items-center gap-3 px-3 py-3 mb-2 rounded-xl bg-gray-50 border border-gray-100">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white ring-2 ring-emerald-100 flex-shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{profile?.full_name ?? "Student"}</p>
                <p className="text-xs text-gray-500">{profile?.matric_number ?? ""}</p>
              </div>
            </div>

            {/* Nav links */}
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                    isActive
                      ? "bg-blue-50 text-blue-700 border border-blue-100"
                      : "text-gray-700 hover:bg-gray-50"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}

            {/* Sign out */}
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 transition mt-2 border border-red-100"
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign out
            </button>
          </div>
        )}
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <div className="mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs font-medium text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
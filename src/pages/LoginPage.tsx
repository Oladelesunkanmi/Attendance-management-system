import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { user, profile, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && profile) {
      const target = profile.role === 'lecturer' ? '/lecturer/sessions' : '/student/check-in';
      navigate(target, { replace: true });
    } else if (user) {
      navigate('/', { replace: true });
    }
  }, [user, profile, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full bg-[#f4f7fe]">
      {/* ── Left Hero Panel (Desktop & Tablet) ────────────────────── */}
      <div className="relative hidden lg:flex lg:w-1/2 flex-col justify-between bg-[#0a112c] p-12 text-white overflow-hidden">
        {/* Subtle background matrix dots */}
        <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />

        {/* Brand Header */}
        <div className="relative z-10 flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/30">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422A12.083 12.083 0 0121 13c0 5.523-4.477 10-10 10S1 18.523 1 13c0-.857.11-1.69.316-2.482L12 14z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-wide leading-snug">Attendance Management</h2>
            <p className="text-xs text-blue-200/70 font-medium">Lecturer Portal</p>
          </div>
        </div>

        {/* Hero Copy */}
        <div className="relative z-10 my-auto max-w-lg pt-8 space-y-8">
          <div>
            <h1 className="text-4xl font-extrabold text-white tracking-tight leading-tight">
              Smarter Attendance, <br />
              <span className="text-[#10b981]">Stronger Engagement.</span>
            </h1>
            <p className="mt-4 text-sm text-slate-300/80 leading-relaxed font-normal">
              Easily manage class attendance, track participation in real-time, and generate insightful reports.
            </p>
          </div>

          {/* Feature Badges */}
          <div className="space-y-4 pt-2">
            {/* Feature 1 */}
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-blue-300">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">QR Code Check-in</h3>
                <p className="text-xs text-slate-300/70">Students scan to mark attendance instantly.</p>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-300">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Real-time Tracking</h3>
                <p className="text-xs text-slate-300/70">Monitor attendance as it happens.</p>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-sky-300">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Insightful Reports</h3>
                <p className="text-xs text-slate-300/70">Get data-driven insights and export reports.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Laptop Mockup Artwork */}
        <div className="relative z-10 pt-4 flex justify-center">
          <div className="w-full max-w-sm rounded-xl bg-slate-900/90 p-2 shadow-2xl border border-white/10">
            <div className="h-32 w-full rounded-lg bg-[#f4f7fe] p-2 overflow-hidden flex flex-col justify-between text-[8px] text-gray-800">
              <div className="flex items-center justify-between border-b border-gray-200 pb-1">
                <div className="font-bold text-blue-900">Dashboard Preview</div>
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1 my-1">
                <div className="rounded bg-white p-1 shadow-2xs font-semibold">CS 304 - LIVE</div>
                <div className="rounded bg-white p-1 shadow-2xs text-emerald-600 font-bold">78 Checked In</div>
                <div className="rounded bg-white p-1 shadow-2xs text-blue-600 font-bold">84.8% Rate</div>
              </div>
              <div className="h-10 w-full rounded bg-white p-1 flex items-center justify-center text-gray-400">
                [ Live Attendance Data & Dynamic QR Code ]
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right Form Panel ──────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-12 overflow-y-auto">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 sm:p-10 shadow-xl border border-gray-100/80">

          {/* Top Lock Icon Badge */}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600 ring-4 ring-blue-50/50">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>

          {/* Heading */}
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">Welcome Back!</h2>
            <p className="mt-1 text-sm font-medium text-gray-500">Sign in to your lecturer portal</p>
          </div>

          {/* Error alert */}
          {error && (
            <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-700 leading-relaxed">
              {error}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Address */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-gray-400">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@university.edu.ng"
                  required
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-gray-400">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-10 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((o) => !o)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.016 10.016 0 012.122-.363c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m-6.165-4.567a3.001 3.001 0 004.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Remember me</span>
              </label>
              <button
                type="button"
                onClick={() => alert('Please contact your administrator to reset your password.')}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {/* Sign In Button */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-xl bg-[#1d2b86] py-3.5 px-6 text-sm font-bold text-white shadow-md shadow-blue-800/20 hover:bg-[#172370] active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              <span>{loading ? 'Signing In…' : 'Sign In'}</span>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </form>

          {/* Social Divider */}
          <div className="relative my-6 flex items-center justify-center">
            <div className="w-full border-t border-gray-200" />
            <span className="absolute bg-white px-3 text-xs font-medium text-gray-400">or continue with</span>
          </div>

          {/* Google Sign In Button */}
          <button
            type="button"
            onClick={() => alert('Google authentication is configured by your university administrator.')}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 active:bg-gray-100 shadow-2xs transition-all flex items-center justify-center gap-2.5"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.27v3.15C3.25 21.3 7.31 24 12 24z" />
              <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.27C.46 8.2.0 10.05.0 12s.46 3.8 1.27 5.42l4.01-3.15z" />
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.27 6.58l4.01 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
            </svg>
            <span>Sign in with Google</span>
          </button>

          {/* Account footer */}
          <div className="mt-8 text-center text-xs font-medium text-gray-500">
            Don't have an account?{' '}
            <Link to="/signup" className="font-bold text-blue-600 hover:underline">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

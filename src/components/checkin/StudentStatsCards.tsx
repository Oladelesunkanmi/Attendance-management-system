import { Link } from "react-router-dom";

interface StudentStatsCardsProps {
  hasCredential: boolean | null;
  totalAttended: number;
  verifiedRate: number;
  flaggedCount: number;
}

export default function StudentStatsCards({
  hasCredential,
  totalAttended,
  verifiedRate,
  flaggedCount,
}: StudentStatsCardsProps) {
  return (
    <>
      {/* Credential Alert Banner */}
      {hasCredential === false && (
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start sm:items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 border border-amber-500/30">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Biometrics Not Yet Enrolled</p>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                Ask your lecturer for a 6-digit Supervisor PIN to register this device.
              </p>
            </div>
          </div>
          <Link
            to="/student/enrol"
            className="w-full sm:w-auto text-center rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 text-xs font-bold shadow-sm transition"
          >
            Enrol Device Now
          </Link>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs border border-gray-100">
          <p className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Attended</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalAttended}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Recorded sessions</p>
        </div>

        <div className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs border border-gray-100">
          <p className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide">Verified Rate</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{verifiedRate}%</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Clean presence</p>
        </div>

        <div className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs border border-gray-100">
          <p className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide">Biometrics</p>
          <div className="mt-2">
            {hasCredential ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                Enrolled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                Pending
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Passkey binding</p>
        </div>

        <div className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs border border-gray-100">
          <p className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide">Flagged</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{flaggedCount}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Reviews pending</p>
        </div>
      </div>
    </>
  );
}
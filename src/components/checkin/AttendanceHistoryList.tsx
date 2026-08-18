import type { AttendanceItem } from '../../types/checkin';

interface AttendanceHistoryListProps {
  history: AttendanceItem[];
  loading: boolean;
  onRefresh: () => void;
}

export default function AttendanceHistoryList({
  history,
  loading,
  onRefresh,
}: AttendanceHistoryListProps) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900 tracking-tight">Recent Attendance</h3>
          <button
            onClick={onRefresh}
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {history.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {history.map((record) => {
              const course = record.sessions?.courses;
              const venue = record.sessions?.venues;
              const date = new Date(record.checked_in_at);

              return (
                <div key={record.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900">
                      {course?.code ?? 'Session Check-In'}
                    </span>
                    {record.flagged_reason ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        Flagged
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ✓ Verified
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>{venue?.name ?? 'Registered Venue'}</span>
                    <span>
                      {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[10px] text-gray-400">
                    <span>📍 {Math.round(record.distance_meters)}m from center</span>
                    <span>{record.webauthn_verified ? '🔐 Biometric' : '🔓 Standard'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-12 text-center text-gray-400 space-y-2">
            <p className="text-2xl">📋</p>
            <p className="text-xs font-medium">No check-in records found yet</p>
            <p className="text-[11px]">Scan your first session QR code to mark attendance.</p>
          </div>
        )}
      </div>

      {/* Offline sync note */}
      <div className="mt-6 rounded-xl bg-slate-50 border border-slate-100 p-3 text-[11px] text-slate-500 leading-relaxed">
        💡 <strong>Offline Support Enabled:</strong> If network connection is weak during class, check-ins are saved locally and synced automatically when reconnected.
      </div>
    </div>
  );
}

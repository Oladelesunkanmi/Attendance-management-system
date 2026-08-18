export type AttendanceItem = {
  id: string;
  checked_in_at: string;
  distance_meters: number;
  gps_accuracy_meters: number | null;
  webauthn_verified: boolean;
  flagged_reason: string | null;
  sessions?: {
    started_at: string;
    courses?: { code: string; title: string } | null;
    venues?: { name: string } | null;
  } | null;
};

export type CheckInStep = 'idle' | 'scanning' | 'gps' | 'biometric' | 'submitting' | 'success' | 'queued';

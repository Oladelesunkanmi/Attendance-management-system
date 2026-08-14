import { useState, useEffect, useCallback } from 'react';
import LecturerLayout from '../../components/LecturerLayout';
import { callEdgeFunction } from '../../lib/supabase';
import { ErrorText } from '../../components/ui';

// ── PIN Generator ─────────────────────────────────────────────────────────────
function EnrolmentPinSection() {
  const [pin, setPin] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(secs);
      if (secs === 0) { setPin(null); setExpiresAt(null); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  async function generatePin() {
    setLoading(true);
    setError(null);
    try {
      const { pin: newPin, expiresAt: exp } = await callEdgeFunction<{
        pin: string;
        expiresAt: string;
      }>('issue-enrol-pin', {});
      setPin(newPin);
      setExpiresAt(new Date(exp));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate PIN');
    } finally {
      setLoading(false);
    }
  }

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const pinActive = !!pin && secondsLeft > 0;
  // colour the countdown amber when < 60 s remain
  const countdownColour = secondsLeft > 60 ? 'text-blue-700' : 'text-amber-600';

  return (
    <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 space-y-5">
      <div>
        <h2 className="font-semibold text-gray-900">Step 1 — Generate Supervisor PIN</h2>
        <p className="mt-1 text-sm text-gray-500">
          One PIN per student. It is single-use and expires after 5 minutes.
        </p>
      </div>

      <ol className="space-y-2 pl-1">
        {[
          'Verify the student\'s physical ID card matches their matric number.',
          'Press Generate PIN — a 6-digit code will appear below.',
          'Show or read the PIN to the student (do not share it via chat/email).',
          'The student enters it on their enrolment screen. The PIN is consumed on use.',
        ].map((step, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white mt-0.5">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      {/* PIN display */}
      {pinActive ? (
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-6 text-center space-y-2">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-widest">Supervisor PIN</p>
          <p className="text-5xl font-mono font-bold tracking-[0.3em] text-blue-900 select-all">
            {pin!.slice(0, 3)}&thinsp;{pin!.slice(3)}
          </p>
          <p className={`text-sm font-semibold tabular-nums ${countdownColour}`}>
            Expires in {mins}:{secs.toString().padStart(2, '0')}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-gray-50 border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
          {pin === null && secondsLeft === 0 && expiresAt !== null
            ? '⏱ PIN expired — generate a new one.'
            : 'No PIN active. Press Generate PIN to start.'}
        </div>
      )}

      <button
        id="btn-generate-pin"
        onClick={generatePin}
        disabled={loading}
        className="w-full rounded-xl bg-blue-600 py-3 px-6 text-sm font-bold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 transition-all"
      >
        {loading ? 'Generating…' : pinActive ? 'Regenerate PIN' : 'Generate PIN'}
      </button>

      <ErrorText>{error}</ErrorText>
    </div>
  );
}

// ── Credential Revocation ─────────────────────────────────────────────────────
type LookupResult = {
  studentId: string;
  studentName: string;
  hasActiveCredential: boolean;
  enrolledAt: string | null;
};

function RevocationSection() {
  const [matricNumber, setMatricNumber] = useState('');
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const handleLookup = useCallback(async () => {
    if (!matricNumber.trim()) return;
    setLooking(true);
    setLookupError(null);
    setLookup(null);
    setRevoked(false);
    try {
      const result = await callEdgeFunction<LookupResult>('revoke-credential', {
        action: 'lookup',
        matricNumber: matricNumber.trim(),
      });
      setLookup(result);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLooking(false);
    }
  }, [matricNumber]);

  async function handleRevoke() {
    if (!lookup) return;
    setRevoking(true);
    setLookupError(null);
    try {
      await callEdgeFunction('revoke-credential', {
        action: 'revoke',
        studentId: lookup.studentId,
      });
      setRevoked(true);
      setLookup((prev) => prev ? { ...prev, hasActiveCredential: false } : null);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Revocation failed');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 space-y-5">
      <div>
        <h2 className="font-semibold text-gray-900">Revoke Student Credential</h2>
        <p className="mt-1 text-sm text-gray-500">
          Use this when a student needs to re-enrol (e.g. lost device). Revoking
          allows them to register a new device with a fresh PIN.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          id="input-matric-lookup"
          type="text"
          value={matricNumber}
          onChange={(e) => setMatricNumber(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
          placeholder="Student matric number"
          className="flex-1 rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all"
        />
        <button
          id="btn-lookup-student"
          onClick={handleLookup}
          disabled={looking || !matricNumber.trim()}
          className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-all"
        >
          {looking ? '…' : 'Look up'}
        </button>
      </div>

      <ErrorText>{lookupError}</ErrorText>

      {lookup && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm text-gray-900">{lookup.studentName}</p>
              <p className="text-xs text-gray-500">{matricNumber}</p>
            </div>
            {lookup.hasActiveCredential && !revoked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                Active credential
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">
                {revoked ? 'Revoked' : 'No credential'}
              </span>
            )}
          </div>

          {lookup.enrolledAt && (
            <p className="text-xs text-gray-500">
              Enrolled: {new Date(lookup.enrolledAt).toLocaleString()}
            </p>
          )}

          {lookup.hasActiveCredential && !revoked && (
            <button
              id="btn-revoke-credential"
              onClick={handleRevoke}
              disabled={revoking}
              className="w-full rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-all"
            >
              {revoking ? 'Revoking…' : 'Revoke credential'}
            </button>
          )}

          {revoked && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700">
              ✓ Credential revoked. The student can now re-enrol using a fresh supervisor PIN.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SuperviseEnrolmentPage() {
  return (
    <LecturerLayout
      title="Supervise Enrolment"
      subtitle="Generate a supervisor PIN for each student's biometric registration."
    >
      <div className="max-w-xl space-y-6">
        <EnrolmentPinSection />
        <RevocationSection />
      </div>
    </LecturerLayout>
  );
}

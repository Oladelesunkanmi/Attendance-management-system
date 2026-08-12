import { useState } from 'react';
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useAuth } from '../../contexts/AuthContext';
import { callEdgeFunction } from '../../lib/supabase';
import { ErrorText } from '../../components/ui';
import StudentLayout from '../../components/StudentLayout';

export default function EnrolWebAuthnPage() {
  const { profile } = useAuth();
  const [lecturerId, setLecturerId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEnrol() {
    if (!profile) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const { options } = await callEdgeFunction<{ options: PublicKeyCredentialCreationOptionsJSON }>(
        'webauthn-register',
        { step: 'options' },
      );

      const attestationResponse = await startRegistration({ optionsJSON: options });

      await callEdgeFunction('webauthn-register', {
        step: 'verify',
        attestationResponse,
        enrolledByLecturerId: lecturerId || null,
      });

      setStatus('Biometric enrolment complete!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrolment failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <StudentLayout
      title="Biometric Enrolment"
      subtitle="Supervised one-time WebAuthn passkey registration on this device."
    >
      <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 space-y-5">
        <p className="text-xs text-gray-600 leading-relaxed font-medium">
          Ask your lecturer to verify your ID card, then enter their user ID below (optional but recommended for supervised enrolment).
        </p>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
            Lecturer User ID (UUID)
          </label>
          <input
            type="text"
            value={lecturerId}
            onChange={(e) => setLecturerId(e.target.value)}
            placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000 (Optional)"
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all"
          />
        </div>

        <button
          onClick={handleEnrol}
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 py-3.5 px-6 text-sm font-bold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          <span>{loading ? 'Waiting for Biometrics…' : 'Start Biometric Enrolment'}</span>
        </button>

        {status && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200/60 p-3.5 text-xs font-semibold text-emerald-700 flex items-center gap-2">
            <svg className="h-4 w-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>{status}</span>
          </div>
        )}

        <ErrorText>{error}</ErrorText>
      </div>
    </StudentLayout>
  );
}


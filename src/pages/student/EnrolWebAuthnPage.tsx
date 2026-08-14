import { useState } from 'react';
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useAuth } from '../../contexts/AuthContext';
import { callEdgeFunction } from '../../lib/supabase';
import { ErrorText } from '../../components/ui';
import StudentLayout from '../../components/StudentLayout';

export default function EnrolWebAuthnPage() {
  const { profile } = useAuth();
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEnrol() {
    if (!profile) return;

    const trimmedPin = pin.trim();
    if (trimmedPin.length !== 6 || !/^\d{6}$/.test(trimmedPin)) {
      setError('Please enter the 6-digit PIN shown on your lecturer\'s screen.');
      return;
    }

    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      const currentRpId = window.location.hostname;
      const currentOrigin = window.location.origin;

      const { options } = await callEdgeFunction<{ options: PublicKeyCredentialCreationOptionsJSON }>(
        'webauthn-register',
        {
          step: 'options',
          rpID: currentRpId,
          origin: currentOrigin,
        },
      );

      // Force built-in phone biometric sensor (Fingerprint / Touch ID / Face ID)
      options.authenticatorSelection = {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      };

      // Client-side safeguard: Ensure options.rp.id matches the current browser domain
      if (options.rp && currentRpId !== 'localhost') {
        options.rp.id = currentRpId;
      }

      const attestationResponse = await startRegistration({ optionsJSON: options });

      await callEdgeFunction('webauthn-register', {
        step: 'verify',
        attestationResponse,
        enrolmentPin: trimmedPin,   // server resolves lecturer_id from this
        rpID: currentRpId,
        origin: currentOrigin,
      });

      setStatus('Biometric enrolment complete!');
      setPin('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrolment failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <StudentLayout
      title="Biometric Enrolment"
      subtitle="Your lecturer must generate a supervisor PIN before you can register."
    >
      <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 space-y-5">
        <p className="text-xs text-gray-600 leading-relaxed font-medium">
          Ask your lecturer to verify your ID card and generate a PIN from their{' '}
          <strong>Supervise Enrolment</strong> screen. Enter it below, then
          complete the biometric prompt on your device.
        </p>

        <div>
          <label
            htmlFor="input-enrol-pin"
            className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5"
          >
            Supervisor PIN
          </label>
          <input
            id="input-enrol-pin"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={pin}
            onChange={(e) => {
              // allow digits only
              const val = e.target.value.replace(/\D/g, '').slice(0, 6);
              setPin(val);
              setError(null);
            }}
            placeholder="6-digit PIN from your lecturer"
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all tracking-widest font-mono"
            disabled={loading}
          />
        </div>

        <button
          id="btn-start-enrolment"
          onClick={handleEnrol}
          disabled={loading || pin.length !== 6}
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

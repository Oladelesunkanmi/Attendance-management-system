import { useState } from 'react';
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useAuth } from '../../contexts/AuthContext';
import { callEdgeFunction } from '../../lib/supabase';
import { ErrorText } from '../../components/ui';
import StudentLayout from '../../components/StudentLayout';

// ┌──────────────────────────────────────────────────────────────────────────┐
// │  ⚠️  DEV DIAGNOSTIC — REMOVE BEFORE PRODUCTION                         │
// │  This component includes a temporary on-page debug panel that displays  │
// │  safe WebAuthn error details for mobile testing without DevTools.       │
// └──────────────────────────────────────────────────────────────────────────┘

interface DebugInfo {
  // Options received from server
  rpId?: string;
  authenticatorAttachment?: string;
  userVerification?: string;
  residentKey?: string;
  // Error details
  errorName?: string;
  errorMessage?: string;
  errorCode?: string;
  causeName?: string;
  causeMessage?: string;
  // Platform support check
  platformAuthAvailable?: string;
}

export default function EnrolWebAuthnPage() {
  const { profile } = useAuth();
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [copied, setCopied] = useState(false);

  function formatDebugText(info: DebugInfo): string {
    return [
      '=== WEBAUTHN DEBUG ===',
      `Error name: ${info.errorName ?? '(none)'}`,
      `Error message: ${info.errorMessage ?? '(none)'}`,
      `Error code: ${info.errorCode ?? '(none)'}`,
      `Cause name: ${info.causeName ?? '(none)'}`,
      `Cause message: ${info.causeMessage ?? '(none)'}`,
      '',
      `RP ID: ${info.rpId ?? '(none)'}`,
      `Authenticator: ${info.authenticatorAttachment ?? '(none)'}`,
      `User verification: ${info.userVerification ?? '(none)'}`,
      `Resident key: ${info.residentKey ?? '(none)'}`,
      '',
      `Platform auth available: ${info.platformAuthAvailable ?? '(unknown)'}`,
      '=== END DEBUG ===',
    ].join('\n');
  }

  async function handleCopyDebug() {
    if (!debugInfo) return;
    try {
      await navigator.clipboard.writeText(formatDebugText(debugInfo));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text for manual copy
      const el = document.getElementById('webauthn-debug-text');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  async function handleEnrol() {
    if (!profile) return;

    const trimmedPin = pin.trim();
    if (trimmedPin.length > 0 && (trimmedPin.length !== 6 || !/^\d{6}$/.test(trimmedPin))) {
      setError('If entering a Supervisor PIN, it must be 6 digits.');
      return;
    }

    setLoading(true);
    setError(null);
    setStatus(null);
    setDebugInfo(null);
    setCopied(false);

    // Collect diagnostic info progressively
    const diag: DebugInfo = {};

    try {
      // Check platform authenticator availability
      if (typeof PublicKeyCredential !== 'undefined' && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
        const supported = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        diag.platformAuthAvailable = String(supported);
        if (!supported) {
          diag.errorName = 'PlatformNotSupported';
          diag.errorMessage = 'isUserVerifyingPlatformAuthenticatorAvailable() returned false';
          setDebugInfo({ ...diag });
          setError(
            'Your device or browser does not support biometric passkeys. ' +
            'Ensure you have a fingerprint or screen lock enabled in settings.',
          );
          setLoading(false);
          return;
        }
      } else {
        diag.platformAuthAvailable = 'API unavailable';
      }

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

      // Capture non-sensitive options for diagnostics
      diag.rpId = options.rp?.id ?? '(missing)';
      diag.authenticatorAttachment = options.authenticatorSelection?.authenticatorAttachment ?? '(missing)';
      diag.userVerification = options.authenticatorSelection?.userVerification ?? '(missing)';
      diag.residentKey = options.authenticatorSelection?.residentKey ?? '(missing)';

      const attestationResponse = await startRegistration({ optionsJSON: options });

      await callEdgeFunction('webauthn-register', {
        step: 'verify',
        attestationResponse,
        enrolmentPin: trimmedPin || undefined,
        rpID: currentRpId,
        origin: currentOrigin,
      });

      setStatus('Biometric enrolment complete! Your device passkey is now registered.');
      setPin('');
    } catch (err: any) {
      // Capture error details for on-page diagnostics
      diag.errorName = err?.name ?? '(unknown)';
      diag.errorMessage = err?.message ?? '(unknown)';
      diag.errorCode = err?.code ?? '(none)';
      diag.causeName = err?.cause?.name ?? '(none)';
      diag.causeMessage = err?.cause?.message ?? '(none)';
      setDebugInfo({ ...diag });

      if (err?.name === 'NotAllowedError') {
        setError('Biometric prompt was cancelled or timed out. Please try again.');
      } else if (err?.name === 'InvalidStateError') {
        setError('This device is already enrolled. You only need to enrol once.');
      } else if (err?.name === 'NotReadableError') {
        setError(
          'Your device could not create a passkey. Please verify: ' +
          '(1) Screen lock PIN/pattern/password is set in Android Settings → Security, ' +
          '(2) Google Play Services is up to date, ' +
          '(3) Google Password Manager is enabled in Settings → Google → All Services → Passwords & Accounts. ' +
          'Then try again.',
        );
      } else if (err?.name === 'SecurityError') {
        setError('Security error: domain mismatch. Contact support.');
      } else {
        const msg = err?.message || String(err);
        setError(`[${err?.name ?? 'Error'}] ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <StudentLayout
      title="Biometric Enrolment"
      subtitle="Register your device's fingerprint or Face ID to enable attendance check-in."
    >
      <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 space-y-5">
        <p className="text-xs text-gray-600 leading-relaxed font-medium">
          Register your device's biometric key below. Supervisor PIN is optional for testing.
        </p>

        <div>
          <label
            htmlFor="input-enrol-pin"
            className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5"
          >
            Supervisor PIN (Optional)
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
            placeholder="Optional 6-digit PIN"
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all tracking-widest font-mono"
            disabled={loading}
          />
        </div>

        <button
          id="btn-start-enrolment"
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

      {/* ── DEV DIAGNOSTIC PANEL — REMOVE BEFORE PRODUCTION ─────────────── */}
      {debugInfo && (
        <div className="mt-4 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-amber-600 text-lg">⚠️</span>
            <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider">
              WebAuthn Debug — DEV ONLY
            </h3>
          </div>

          <pre
            id="webauthn-debug-text"
            className="text-[11px] leading-relaxed font-mono text-gray-800 bg-white rounded-lg p-3 border border-amber-200 whitespace-pre-wrap break-all select-all"
          >
{formatDebugText(debugInfo)}
          </pre>

          <button
            onClick={handleCopyDebug}
            className="w-full rounded-lg bg-amber-500 py-2.5 px-4 text-xs font-bold text-white hover:bg-amber-600 active:scale-[0.98] transition-all"
          >
            {copied ? '✓ Copied to clipboard' : '📋 Copy Debug Info'}
          </button>

          <p className="text-[10px] text-amber-700 font-medium text-center">
            ⚠️ This panel is for development only. Remove before production deployment.
          </p>
        </div>
      )}
    </StudentLayout>
  );
}

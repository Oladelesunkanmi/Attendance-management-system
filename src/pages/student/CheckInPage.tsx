import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { startAuthentication, type AuthenticationResponseJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { callEdgeFunction, supabase } from '../../lib/supabase';
import { getStablePosition } from '../../lib/geo';
import { ErrorText } from '../../components/ui';
import StudentLayout from '../../components/StudentLayout';
import { queueCheckIn } from '../../lib/queue';

export default function CheckInPage() {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function triggerSWProcessQueue() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const { data: { session } } = await supabase.auth.getSession();
      navigator.serviceWorker.controller.postMessage({
        type: 'TRIGGER_SYNC',
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        authToken: session?.access_token,
      });
    }
  }

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false,
    );
    scannerRef.current = scanner;

    scanner.render(
      (decoded) => {
        setQrToken(decoded);
        setStatus('QR code captured successfully! Ready to complete check-in.');
      },
      () => undefined,
    );

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CHECKIN_SYNC_SUCCESS') {
        setStatus(event.data.payload.flagged ? 'Queued check-in synced with flags.' : 'Queued check-in synced successfully.');
        setError(null);
      } else if (event.data?.type === 'CHECKIN_SYNC_FAILED') {
        setError(event.data.error || 'Queued check-in failed to sync.');
        setStatus(null);
      }
    };

    const handleOnline = () => {
      triggerSWProcessQueue();
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }
    window.addEventListener('online', handleOnline);

    return () => {
      scanner.clear().catch(() => undefined);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  async function handleCheckIn() {
    if (!qrToken) {
      setError('Scan the session QR code first.');
      return;
    }

    setLoading(true);
    setError(null);
    setStatus('Getting GPS fix…');

    try {
      const position = await getStablePosition(2);
      setStatus('Requesting biometric verification…');

      let options: PublicKeyCredentialRequestOptionsJSON | undefined;
      try {
        const res = await callEdgeFunction<{ options: PublicKeyCredentialRequestOptionsJSON }>(
          'webauthn-authenticate',
          { step: 'options' },
        );
        options = res.options;
      } catch (err) {
        if (!navigator.onLine) {
          console.warn('Offline during webauthn options request');
        } else {
          throw err;
        }
      }

      let assertionResponse: AuthenticationResponseJSON | undefined;
      if (options) {
        try {
          assertionResponse = await startAuthentication({ optionsJSON: options });
        } catch {
          assertionResponse = undefined;
        }
      }

      const checkInPayload = {
        qrToken,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        gpsAccuracy: position.coords.accuracy,
        assertionResponse,
      };

      if (!navigator.onLine) {
        await queueCheckIn(checkInPayload);
        setStatus('Offline. Check-in queued and will sync when reconnected.');
        setQrToken(null);

        if ('serviceWorker' in navigator && 'SyncManager' in window) {
          const reg = await navigator.serviceWorker.ready;
          await (reg as any).sync.register('sync-checkins');
        }
        return;
      }

      setStatus('Submitting check-in…');
      try {
        const result = await callEdgeFunction<{
          success: boolean;
          flagged: boolean;
        }>('verify-checkin', checkInPayload);

        setStatus(result.flagged ? 'Checked in with flags for review.' : 'Check-in successful!');
        setQrToken(null);
      } catch (err) {
        const isNetworkError = !navigator.onLine || (err instanceof TypeError && err.message.includes('fetch'));
        if (isNetworkError) {
          await queueCheckIn(checkInPayload);
          setStatus('Connectivity lost. Check-in queued and will retry when reconnected.');
          setQrToken(null);

          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            const reg = await navigator.serviceWorker.ready;
            await (reg as any).sync.register('sync-checkins');
          }
        } else {
          throw err;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <StudentLayout
      title="Scan QR Code to Check In"
      subtitle="Position the lecturer's session QR code within the camera frame below."
    >
      <div className="rounded-2xl bg-white p-6 shadow-xs border border-gray-100 space-y-6">
        <div id="qr-reader" className="overflow-hidden rounded-xl border border-gray-100" />

        <button
          onClick={handleCheckIn}
          disabled={loading || !qrToken}
          className="w-full rounded-xl bg-blue-600 py-3.5 px-6 text-sm font-bold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-40 transition-all flex items-center justify-center gap-2"
        >
          <span>{loading ? 'Processing Check-in…' : 'Complete Check-in'}</span>
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


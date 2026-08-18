import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface QrScannerProps {
  onScanSuccess: (decodedText: string) => void;
  disabled?: boolean;
}

export default function QrScanner({ onScanSuccess }: QrScannerProps) {
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopScanner = useCallback(async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch (err) {
        console.warn('Error clearing scanner:', err);
      }
      html5QrCodeRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    setCameraError(null);
    await stopScanner();

    const element = document.getElementById('qr-reader-viewport');
    if (!element) return;

    try {
      const qrScanner = new Html5Qrcode('qr-reader-viewport');
      html5QrCodeRef.current = qrScanner;

      await qrScanner.start(
        { facingMode },
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          if (navigator.vibrate) {
            navigator.vibrate([40, 50, 40]);
          }
          onScanSuccess(decodedText);
          stopScanner();
        },
        () => {
          // ignore regular frames without QR codes
        },
      );
      setIsScanning(true);
    } catch (err) {
      console.error('Camera start error:', err);
      setCameraError(
        err instanceof Error
          ? err.message.includes('Permission')
            ? 'Camera access was denied. Please allow camera permissions in your browser.'
            : err.message
          : 'Unable to access camera device.',
      );
      setIsScanning(false);
    }
  }, [facingMode, onScanSuccess, stopScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 tracking-tight">QR Code Scanner</h3>
          <p className="text-xs text-gray-500">Scan the live session QR code displayed by your lecturer</p>
        </div>

        {isScanning && (
          <button
            onClick={() => {
              setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
              setTimeout(() => startScanner(), 100);
            }}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition flex items-center gap-1.5"
            title="Switch camera"
          >
            <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Flip</span>
          </button>
        )}
      </div>

      {/* Viewfinder Container */}
      <div className="relative overflow-hidden rounded-2xl bg-slate-900 border-2 border-gray-200 aspect-square max-w-sm mx-auto flex items-center justify-center">
        <div
          id="qr-reader-viewport"
          className="w-full h-full object-cover"
          style={{ minHeight: '280px' }}
        />

        {isScanning ? (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8">
            <div className="relative w-48 h-48 sm:w-56 sm:h-56">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-lg" />
              <div className="absolute left-1 right-1 h-0.5 bg-gradient-to-r from-blue-400 via-emerald-400 to-blue-400 shadow-[0_0_8px_#38bdf8] animate-scan-laser" />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-900/90 text-white space-y-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-white">Camera is currently paused</p>
              <p className="text-xs text-slate-300 mt-1 max-w-xs">
                Press Start Scanner to point your camera at the lecturer's projector or screen.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {!isScanning ? (
          <button
            onClick={startScanner}
            className="flex-1 rounded-xl bg-blue-600 py-3.5 px-6 text-sm font-bold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.99] transition flex items-center justify-center gap-2"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Start QR Scanner</span>
          </button>
        ) : (
          <button
            onClick={stopScanner}
            className="flex-1 rounded-xl border border-gray-200 bg-white py-3.5 px-6 text-sm font-bold text-gray-700 hover:bg-gray-50 active:scale-[0.99] transition"
          >
            Pause Scanner
          </button>
        )}
      </div>

      {cameraError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-xs font-semibold text-red-700 space-y-2">
          <p>⚠️ {cameraError}</p>
          <button
            onClick={startScanner}
            className="rounded-lg bg-red-100 hover:bg-red-200 px-3 py-1 text-xs font-bold text-red-800 transition"
          >
            Retry Camera
          </button>
        </div>
      )}
    </div>
  );
}

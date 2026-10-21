import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  callApi: vi.fn(),
  getStablePosition: vi.fn(),
  isLocationPermissionGranted: vi.fn(),
  queueCheckIn: vi.fn(),
  startAuthentication: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  callEdgeFunction: mocks.callApi,
  callApi: mocks.callApi,
}));

vi.mock('../lib/geo', () => ({
  getStablePosition: mocks.getStablePosition,
  isLocationPermissionGranted: mocks.isLocationPermissionGranted,
  isRetryablePositionError: (error: any) => error?.code === 2 || error?.code === 3,
}));

vi.mock('../lib/queue', () => ({
  queueCheckIn: mocks.queueCheckIn,
}));

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: mocks.startAuthentication,
}));

const { useCheckInPipeline } = await import('./useCheckInPipeline');

type Pipeline = ReturnType<typeof useCheckInPipeline>;

/** Renders the hook and exposes the latest pipeline through a ref. */
function renderPipeline(onSuccess: () => Promise<void> = async () => {}) {
  const ref: { current: Pipeline | null } = { current: null };

  function Harness() {
    const pipeline = useCheckInPipeline({ onSuccess });
    ref.current = pipeline;
    return null;
  }

  render(<Harness />);
  return ref;
}

/** Lets pending microtasks and timers settle inside React's act scope. */
async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/**
 * Starts a check-in without blocking, then lets it settle.
 * The pending promise is returned inside an object: returning it directly
 * would make `await startCheckIn(...)` chain onto the still-running check-in.
 */
async function startCheckIn(ref: { current: Pipeline | null }, token: string) {
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = ref.current!.executeCheckIn(token);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await flush();
  return { pending: pending! };
}

function makeToken(verificationMode: string) {
  const payload = {
    session_id: 'session-1',
    verification_mode: verificationMode,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const base64url = btoa(JSON.stringify(payload))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${base64url}.signature`;
}

const GPS_FIX = {
  coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 12 },
} as unknown as GeolocationPosition;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function verifyCalls() {
  return mocks.callApi.mock.calls.filter(([name]) => name === 'verify-checkin');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStablePosition.mockResolvedValue(GPS_FIX);
  mocks.isLocationPermissionGranted.mockResolvedValue(true);
  mocks.startAuthentication.mockResolvedValue({ id: 'credential-1' });
  mocks.queueCheckIn.mockResolvedValue(undefined);
  mocks.callApi.mockImplementation(async (name: string) => {
    if (name === 'webauthn-authenticate') {
      return { options: { challenge: 'abc' } };
    }
    if (name === 'verify-checkin') {
      return { success: true, flagged: false };
    }
    throw new Error(`unexpected call ${name}`);
  });
});

describe('useCheckInPipeline', () => {
  it('records attendance and confirms only after the server has answered', async () => {
    const submit = deferred<any>();
    mocks.callApi.mockImplementation(async (name: string) => {
      if (name === 'webauthn-authenticate') return { options: { challenge: 'abc' } };
      if (name === 'verify-checkin') return submit.promise;
      throw new Error(name);
    });

    const ref = renderPipeline();
    const token = makeToken('full');

    const { pending } = await startCheckIn(ref, token);

    // The pipeline is still waiting for the server.
    expect(ref.current!.step).toBe('submitting');
    expect(ref.current!.lastResult).toBeNull();

    await act(async () => {
      submit.resolve({ success: true, flagged: false });
    });
    await pending;
    await flush();

    expect(ref.current!.step).toBe('success');
    expect(ref.current!.lastResult?.flagged).toBe(false);
    expect(ref.current!.lastResult?.message).toMatch(/recorded/i);
  });

  it('starts the position fix and the WebAuthn challenge at the same time', async () => {
    const gps = deferred<GeolocationPosition>();
    const options = deferred<any>();
    mocks.getStablePosition.mockReturnValue(gps.promise);
    mocks.callApi.mockImplementation(async (name: string) => {
      if (name === 'webauthn-authenticate') return options.promise;
      if (name === 'verify-checkin') return { success: true, flagged: false };
      throw new Error(name);
    });

    const ref = renderPipeline();
    const token = makeToken('full');

    await act(async () => {
      ref.current!.prepare(token);
    });
    await flush(2);

    // Both independent requests are already under way.
    expect(mocks.getStablePosition).toHaveBeenCalledTimes(1);
    expect(mocks.callApi).toHaveBeenCalledWith('webauthn-authenticate', { step: 'options' });

    await act(async () => {
      gps.resolve(GPS_FIX);
      options.resolve({ options: { challenge: 'abc' } });
    });
    await flush();

    // The prepared challenge is reused instead of being fetched a second time.
    const { pending } = await startCheckIn(ref, token);
    await pending;
    await flush();

    const challengeCalls = mocks.callApi.mock.calls.filter(
      ([name]) => name === 'webauthn-authenticate',
    );
    expect(challengeCalls).toHaveLength(1);
    expect(mocks.startAuthentication).toHaveBeenCalledTimes(1);
    expect(verifyCalls()).toHaveLength(1);
  });

  it('reuses the prepared challenge even when it is still in flight', async () => {
    const options = deferred<any>();
    mocks.callApi.mockImplementation(async (name: string) => {
      if (name === 'webauthn-authenticate') return options.promise;
      if (name === 'verify-checkin') return { success: true, flagged: false };
      throw new Error(name);
    });

    const ref = renderPipeline();
    const token = makeToken('full');

    await act(async () => {
      ref.current!.prepare(token);
    });
    await flush(2);

    // The student confirms while the challenge request is still running.
    const { pending } = await startCheckIn(ref, token);
    await flush(2);

    const challengeCalls = mocks.callApi.mock.calls.filter(
      ([name]) => name === 'webauthn-authenticate',
    );
    expect(challengeCalls).toHaveLength(1);

    await act(async () => {
      options.resolve({ options: { challenge: 'abc' } });
    });
    await pending;
    await flush();

    expect(mocks.startAuthentication).toHaveBeenCalledTimes(1);
    expect(verifyCalls()).toHaveLength(1);
  });

  it('does not start a second submission while one is in flight', async () => {
    const submit = deferred<any>();
    mocks.callApi.mockImplementation(async (name: string) => {
      if (name === 'webauthn-authenticate') return { options: { challenge: 'abc' } };
      if (name === 'verify-checkin') return submit.promise;
      throw new Error(name);
    });

    const ref = renderPipeline();
    const token = makeToken('full');

    const { pending } = await startCheckIn(ref, token);

    // A second tap while the first submission is still running.
    await act(async () => {
      void ref.current!.executeCheckIn(token);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush(2);

    await act(async () => {
      submit.resolve({ success: true, flagged: false });
    });
    await pending;
    await flush();

    expect(verifyCalls()).toHaveLength(1);
    expect(ref.current!.step).toBe('success');
  });

  it('rejects a QR code that is not a session token', async () => {
    const ref = renderPipeline();

    await startCheckIn(ref, 'not-a-session-token');

    expect(ref.current!.step).toBe('idle');
    expect(ref.current!.error).toMatch(/Invalid QR code format/i);
    expect(verifyCalls()).toHaveLength(0);
  });

  it('reports a server rejection and allows a retry', async () => {
    let attempt = 0;
    mocks.callApi.mockImplementation(async (name: string) => {
      if (name === 'webauthn-authenticate') return { options: { challenge: 'abc' } };
      if (name === 'verify-checkin') {
        attempt += 1;
        if (attempt === 1) throw new Error('Already checked in for this session');
        return { success: true, flagged: false };
      }
      throw new Error(name);
    });

    const ref = renderPipeline();
    const token = makeToken('full');

    await startCheckIn(ref, token);

    expect(ref.current!.error).toMatch(/Already checked in/);
    expect(ref.current!.step).toBe('idle');

    // The lock has to be released, so a legitimate retry still works.
    await startCheckIn(ref, token);

    expect(ref.current!.step).toBe('success');
    expect(ref.current!.error).toBeNull();
    expect(verifyCalls()).toHaveLength(2);
  });

  it('does not request a position when the session only needs the QR code', async () => {
    const ref = renderPipeline();
    const token = makeToken('qr_only');

    await startCheckIn(ref, token);

    expect(mocks.getStablePosition).not.toHaveBeenCalled();
    expect(mocks.startAuthentication).not.toHaveBeenCalled();
    expect(ref.current!.step).toBe('success');
  });

  it('does not request a biometric prompt when the session only needs the geofence', async () => {
    const ref = renderPipeline();
    const token = makeToken('qr_geofence');

    await startCheckIn(ref, token);

    expect(mocks.getStablePosition).toHaveBeenCalledTimes(1);
    expect(mocks.startAuthentication).not.toHaveBeenCalled();
    expect(ref.current!.step).toBe('success');
  });

  it('sends the position and the biometric assertion to the server', async () => {
    const ref = renderPipeline();
    const token = makeToken('full');

    await startCheckIn(ref, token);

    const verifyCall = verifyCalls()[0];
    expect(verifyCall).toBeDefined();
    const payload = verifyCall[1] as any;
    expect(payload.latitude).toBe(6.5244);
    expect(payload.longitude).toBe(3.3792);
    expect(payload.gpsAccuracy).toBe(12);
    expect(payload.assertionResponse).toEqual({ id: 'credential-1' });
  });

  it('queues the check-in instead of submitting it when the device is offline', async () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

    try {
      const ref = renderPipeline();
      const token = makeToken('full');

      await startCheckIn(ref, token);

      expect(mocks.queueCheckIn).toHaveBeenCalledTimes(1);
      expect(verifyCalls()).toHaveLength(0);
      expect(ref.current!.step).toBe('queued');
    } finally {
      // `onLine` lives on Navigator.prototype, so the own property has to be
      // removed again to keep the next test online.
      if (original) Object.defineProperty(window.navigator, 'onLine', original);
      else delete (window.navigator as any).onLine;
    }
  });

  it('waits for the position before it submits the check-in', async () => {
    const gps = deferred<GeolocationPosition>();
    mocks.getStablePosition.mockReturnValue(gps.promise);

    const ref = renderPipeline();
    const token = makeToken('qr_geofence');

    const { pending } = await startCheckIn(ref, token);
    expect(verifyCalls()).toHaveLength(0);

    await act(async () => {
      gps.resolve(GPS_FIX);
    });
    await pending;
    await flush();

    expect(verifyCalls()).toHaveLength(1);
  });
});

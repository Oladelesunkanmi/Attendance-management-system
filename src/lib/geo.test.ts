import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getStablePosition, getCurrentPosition, isLocationPermissionGranted } from './geo';

type SuccessListener = (position: GeolocationPosition) => void;
type ErrorListener = (error: GeolocationPositionError) => void;

interface PendingRequest {
  success: SuccessListener;
  error: ErrorListener;
  options: PositionOptions;
}

let pending: PendingRequest[] = [];

function makePosition(accuracy: number, ageMs = 0): GeolocationPosition {
  return {
    coords: { latitude: 6.5244, longitude: 3.3792, accuracy },
    timestamp: Date.now() - ageMs,
  } as GeolocationPosition;
}

function makeError(code: number, message = 'unavailable'): GeolocationPositionError {
  return Object.assign(new Error(message), {
    code,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  }) as unknown as GeolocationPositionError;
}

beforeEach(() => {
  pending = [];
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (
        success: SuccessListener,
        error: ErrorListener,
        options: PositionOptions,
      ) => {
        pending.push({ success, error, options });
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getCurrentPosition', () => {
  it('asks for a high-accuracy fix', async () => {
    const promise = getCurrentPosition();
    expect(pending).toHaveLength(1);
    expect(pending[0].options.enableHighAccuracy).toBe(true);
    expect(pending[0].options.timeout).toBe(15_000);

    pending[0].success(makePosition(10));
    await expect(promise).resolves.toBeDefined();
  });
});

describe('getStablePosition', () => {
  it('requests the samples at the same time instead of one after another', async () => {
    const promise = getStablePosition(2);

    // Both requests are in flight before the first one has come back.
    expect(pending).toHaveLength(2);

    pending[0].success(makePosition(20));
    pending[1].success(makePosition(8));

    const position = await promise;
    expect(position.coords.accuracy).toBe(8);
  });

  it('always asks for a fresh fix for the first sample and may reuse a recent one afterwards', async () => {
    const promise = getStablePosition(3);
    expect(pending).toHaveLength(3);
    expect(pending[0].options.maximumAge).toBe(0);
    expect(pending[1].options.maximumAge).toBeGreaterThan(0);
    expect(pending[2].options.maximumAge).toBeGreaterThan(0);

    pending.forEach((request) => request.success(makePosition(10)));
    await promise;
  });

  it('returns the most accurate reading', async () => {
    const promise = getStablePosition(3);
    pending[0].success(makePosition(45));
    pending[1].success(makePosition(6));
    pending[2].success(makePosition(25));

    const position = await promise;
    expect(position.coords.accuracy).toBe(6);
  });

  it('still succeeds when one of the samples fails', async () => {
    const promise = getStablePosition(2);
    pending[0].success(makePosition(15));
    pending[1].error(makeError(2));

    const position = await promise;
    expect(position.coords.accuracy).toBe(15);
  });

  it('fails when no sample could be read', async () => {
    const promise = getStablePosition(2);
    pending[0].error(makeError(3, 'timeout'));
    pending[1].error(makeError(2));

    await expect(promise).rejects.toThrow('timeout');
  });
});

describe('isLocationPermissionGranted', () => {
  it('reports false when the permissions API is unavailable', async () => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: undefined,
    });
    await expect(isLocationPermissionGranted()).resolves.toBe(false);
  });

  it('reports true when the permission has already been granted', async () => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'granted' }) },
    });
    await expect(isLocationPermissionGranted()).resolves.toBe(true);
  });

  it('reports false when the permission has not been granted yet', async () => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'prompt' }) },
    });
    await expect(isLocationPermissionGranted()).resolves.toBe(false);
  });
});

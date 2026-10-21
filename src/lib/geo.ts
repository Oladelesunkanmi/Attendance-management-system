export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const POSITION_TIMEOUT_MS = 15_000;

/**
 * Age a secondary sample is allowed to have. The primary sample is always a
 * fresh fix; the extra samples exist only to pick the most accurate reading,
 * and the device cannot have moved meaningfully in a couple of seconds.
 */
const SECONDARY_MAX_AGE_MS = 2_000;

export async function getCurrentPosition(
  options: PositionOptions = {},
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: POSITION_TIMEOUT_MS,
      maximumAge: 0,
      ...options,
    });
  });
}

/**
 * Collects `samples` readings and returns the most accurate one.
 *
 * The samples are requested concurrently instead of one after another. The
 * first request always asks for a brand new high-accuracy fix; the remaining
 * ones may be satisfied from the browser's recent-fix cache, which removes the
 * second cold GPS acquisition the previous sequential version paid on every
 * single check-in.
 */
export async function getStablePosition(samples = 3): Promise<GeolocationPosition> {
  const attempts = Array.from({ length: Math.max(1, samples) }, (_, index) =>
    getCurrentPosition(
      index === 0 ? { maximumAge: 0 } : { maximumAge: SECONDARY_MAX_AGE_MS },
    ),
  );

  const results = await Promise.allSettled(attempts);
  const readings = results
    .filter((result): result is PromiseFulfilledResult<GeolocationPosition> =>
      result.status === 'fulfilled',
    )
    .map((result) => result.value);

  if (readings.length === 0) {
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    throw failure?.reason ?? new Error('Could not acquire a GPS position');
  }

  return readings.sort((a, b) => a.coords.accuracy - b.coords.accuracy)[0];
}

/**
 * True when the student has already granted location access for this origin.
 * Used to decide whether a position can be acquired ahead of the explicit
 * check-in action without surprising the student with a permission prompt.
 */
export async function isLocationPermissionGranted(): Promise<boolean> {
  try {
    if (!navigator.permissions?.query) return false;
    const status = await navigator.permissions.query({
      name: 'geolocation' as PermissionName,
    });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

/**
 * A position failure that is worth retrying (satellite lock not established
 * yet). A denied permission is not retryable.
 */
export function isRetryablePositionError(error: unknown): boolean {
  const code = (error as GeolocationPositionError | undefined)?.code;
  return code === 2 || code === 3;
}

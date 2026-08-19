/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { getQueuedCheckIns, deleteQueuedCheckIn } from './lib/queue';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST || []);

function isTokenExpired(jwtToken: string): boolean {
  try {
    const parts = jwtToken.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return false;
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

async function notifyClients(message: { type: string; payload?: unknown; error?: string }) {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage(message);
  }
}

async function processQueue(apiUrl?: string, authToken?: string) {
  const queue = await getQueuedCheckIns();
  if (queue.length === 0) return;

  for (const item of queue) {
    if (!item.id) continue;

    if (isTokenExpired(item.qrToken)) {
      await deleteQueuedCheckIn(item.id);
      await notifyClients({
        type: 'CHECKIN_SYNC_FAILED',
        error: 'Queued check-in failed: QR token expired before reconnecting.',
      });
      continue;
    }

    if (apiUrl && authToken) {
      try {
        const response = await fetch(`${apiUrl}/api/verify-checkin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            qrToken: item.qrToken,
            latitude: item.latitude,
            longitude: item.longitude,
            gpsAccuracy: item.gpsAccuracy,
            assertionResponse: item.assertionResponse,
          }),
        });

        const result = await response.json();
        if (response.ok && result.success) {
          await deleteQueuedCheckIn(item.id);
          await notifyClients({
            type: 'CHECKIN_SYNC_SUCCESS',
            payload: result,
          });
        } else {
          // If server rejects with 401 or non-retryable error (e.g. expired or already checked in)
          if (response.status === 401 || response.status === 409 || response.status === 400) {
            await deleteQueuedCheckIn(item.id);
            await notifyClients({
              type: 'CHECKIN_SYNC_FAILED',
              error: result.error || 'Queued check-in rejected.',
            });
          }
        }
      } catch (err) {
        console.error('Failed to sync item offline', err);
      }
    }
  }
}

self.addEventListener('sync', (event: any) => {
  if (event.tag === 'sync-checkins') {
    event.waitUntil(processQueue());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TRIGGER_SYNC') {
    const { apiUrl, authToken } = event.data;
    event.waitUntil(processQueue(apiUrl, authToken));
  }
});

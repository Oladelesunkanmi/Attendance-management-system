import { openDB, type DBSchema } from 'idb';
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';

export interface QueuedCheckIn {
  id?: number;
  qrToken: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number | null;
  assertionResponse?: AuthenticationResponseJSON;
  timestamp: number;
}

interface AttendanceDB extends DBSchema {
  'checkin-queue': {
    key: number;
    value: QueuedCheckIn;
    indexes: { 'by-timestamp': number };
  };
}

const DB_NAME = 'attendance-system';
const DB_VERSION = 1;

export async function getDB() {
  return openDB<AttendanceDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('checkin-queue')) {
        const store = db.createObjectStore('checkin-queue', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('by-timestamp', 'timestamp');
      }
    },
  });
}

export async function queueCheckIn(payload: Omit<QueuedCheckIn, 'timestamp'>) {
  const db = await getDB();
  await db.add('checkin-queue', {
    ...payload,
    timestamp: Date.now(),
  });
}

export async function getQueuedCheckIns(): Promise<QueuedCheckIn[]> {
  const db = await getDB();
  return db.getAllFromIndex('checkin-queue', 'by-timestamp');
}

export async function deleteQueuedCheckIn(id: number) {
  const db = await getDB();
  await db.delete('checkin-queue', id);
}

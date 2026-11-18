import type {
  Customer,
  MobileConfig,
  Representative,
  SyncConflictRecord,
  SyncQueueItem,
  User,
} from '../types';
import type { DatabaseState } from './storage';

export interface LocalDbSnapshot {
  userId: string;
  scope: 'customer' | 'representative' | 'staff';
  serverOrigin: string;
  cachedAt: string;
  serverTime?: string;
  user: User;
  customerProfile?: Customer | null;
  representativeProfile?: Representative | null;
  mobileConfig?: MobileConfig;
  data: {
    dbState: DatabaseState;
    customerStatement: any | null;
  };
}

const DB_NAME = 'awlad_selim_offline_db_v1';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const STORE_MEDIA = 'media';

const LS_FALLBACK_PREFIX = 'awlad_selim_ldb_';

function getElectronOfflineBridge(): {
  get: (namespace: string, key: string) => Promise<{ ok: boolean; value: any }>;
  set: (namespace: string, key: string, value: any) => Promise<{ ok: boolean }>;
  remove: (namespace: string, key: string) => Promise<{ ok: boolean }>;
  writeMedia: (mediaKey: string, dataUrl: string) => Promise<{ ok: boolean }>;
  readMedia: (mediaKey: string) => Promise<{ ok: boolean; dataUrl: string | null }>;
} | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as any).awladDesktop?.offlineDb;
  return bridge && typeof bridge.get === 'function' ? bridge : null;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }
        if (!db.objectStoreNames.contains(STORE_MEDIA)) {
          db.createObjectStore(STORE_MEDIA);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function lsGet<T>(fullKey: string): T | null {
  try {
    const raw = localStorage.getItem(`${LS_FALLBACK_PREFIX}${fullKey}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function lsSet(fullKey: string, value: any): void {
  try {
    localStorage.setItem(`${LS_FALLBACK_PREFIX}${fullKey}`, JSON.stringify(value));
  } catch {
    // ignore storage quota errors
  }
}

function lsRemove(fullKey: string): void {
  try {
    localStorage.removeItem(`${LS_FALLBACK_PREFIX}${fullKey}`);
  } catch {
    // ignore
  }
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openIdb();
  if (!db) return lsGet<T>(`${storeName}:${key}`);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(lsGet<T>(`${storeName}:${key}`));
    } catch {
      resolve(lsGet<T>(`${storeName}:${key}`));
    }
  });
}

async function idbSet(storeName: string, key: string, value: any): Promise<void> {
  const db = await openIdb();
  if (!db) {
    lsSet(`${storeName}:${key}`, value);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        lsSet(`${storeName}:${key}`, value);
        resolve();
      };
    } catch {
      lsSet(`${storeName}:${key}`, value);
      resolve();
    }
  });
}

async function idbRemove(storeName: string, key: string): Promise<void> {
  const db = await openIdb();
  lsRemove(`${storeName}:${key}`);
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getKV<T = any>(namespace: string, key: string): Promise<T | null> {
  const electronDb = getElectronOfflineBridge();
  if (electronDb) {
    try {
      const res = await electronDb.get(namespace, key);
      if (res?.ok && res.value !== undefined && res.value !== null) {
        return res.value as T;
      }
    } catch {
      // fall through to IndexedDB
    }
  }
  return idbGet<T>(STORE_KV, `${namespace}::${key}`);
}

export async function setKV<T = any>(namespace: string, key: string, value: T): Promise<void> {
  const electronDb = getElectronOfflineBridge();
  if (electronDb) {
    await electronDb.set(namespace, key, value).catch(() => {});
  }
  await idbSet(STORE_KV, `${namespace}::${key}`, value);
}

export async function removeKV(namespace: string, key: string): Promise<void> {
  const electronDb = getElectronOfflineBridge();
  if (electronDb) {
    await electronDb.remove(namespace, key).catch(() => {});
  }
  await idbRemove(STORE_KV, `${namespace}::${key}`);
}

export async function getMeta<T = any>(key: string): Promise<T | null> {
  return getKV<T>('meta', key);
}

export async function setMeta<T = any>(key: string, value: T): Promise<void> {
  return setKV('meta', key, value);
}

export async function getSnapshot(userId: string): Promise<LocalDbSnapshot | null> {
  if (!userId) return null;
  return getKV<LocalDbSnapshot>('snapshots', userId);
}

export async function saveSnapshot(snapshot: LocalDbSnapshot): Promise<void> {
  if (!snapshot?.userId) return;
  await setKV('snapshots', snapshot.userId, snapshot);
}

export async function listSyncQueue(userId: string): Promise<SyncQueueItem[]> {
  if (!userId) return [];
  const items = await getKV<SyncQueueItem[]>('sync_queue', userId);
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function saveSyncQueue(userId: string, queue: SyncQueueItem[]): Promise<void> {
  if (!userId) return;
  // Retain non-synced operations plus at most 40 recent synced records for history visibility
  const nonSynced = queue.filter((q) => q.status !== 'synced');
  const recentSynced = queue.filter((q) => q.status === 'synced').slice(-40);
  await setKV('sync_queue', userId, [...nonSynced, ...recentSynced]);
}

export async function putSyncOperation(item: SyncQueueItem): Promise<void> {
  if (!item?.userId || !item?.operationId) return;
  const current = await listSyncQueue(item.userId);
  const idx = current.findIndex((q) => q.operationId === item.operationId);
  if (idx >= 0) {
    current[idx] = item;
  } else {
    current.push(item);
  }
  await saveSyncQueue(item.userId, current);
}

export async function deleteSyncOperation(userId: string, operationId: string): Promise<void> {
  if (!userId || !operationId) return;
  const current = await listSyncQueue(userId);
  await saveSyncQueue(
    userId,
    current.filter((q) => q.operationId !== operationId)
  );
}

export async function listConflicts(userId: string): Promise<SyncConflictRecord[]> {
  if (!userId) return [];
  const list = await getKV<SyncConflictRecord[]>('conflicts', userId);
  return Array.isArray(list) ? list : [];
}

export async function saveConflicts(userId: string, conflicts: SyncConflictRecord[]): Promise<void> {
  if (!userId) return;
  await setKV('conflicts', userId, Array.isArray(conflicts) ? conflicts : []);
}

export async function writeMedia(mediaKey: string, dataUrl: string): Promise<void> {
  if (!mediaKey || !dataUrl) return;
  const electronDb = getElectronOfflineBridge();
  if (electronDb) {
    await electronDb.writeMedia(mediaKey, dataUrl).catch(() => {});
  }
  await idbSet(STORE_MEDIA, mediaKey, dataUrl);
}

export async function readMedia(mediaKey: string): Promise<string | null> {
  if (!mediaKey) return null;
  const electronDb = getElectronOfflineBridge();
  if (electronDb) {
    try {
      const res = await electronDb.readMedia(mediaKey);
      if (res?.ok && res.dataUrl) return res.dataUrl;
    } catch {
      // fall through
    }
  }
  return idbGet<string>(STORE_MEDIA, mediaKey);
}

export const localDb = {
  getKV,
  setKV,
  removeKV,
  getMeta,
  setMeta,
  getSnapshot,
  saveSnapshot,
  listSyncQueue,
  saveSyncQueue,
  putSyncOperation,
  deleteSyncOperation,
  listConflicts,
  saveConflicts,
  writeMedia,
  readMedia,
};

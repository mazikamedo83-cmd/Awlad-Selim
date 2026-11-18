import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { getOrCreatePersistentDeviceId, isNativeCapacitor } from './native';
import { sealWithDeviceSecret, unsealWithDeviceSecret } from './offlineCrypto';
import type {
  Customer,
  MobileConfig,
  Representative,
  SyncConflictRecord,
  SyncQueueItem,
  User,
} from '../types';

const IDB_NAME = 'awlad_selim_offline_v1';
const IDB_VERSION = 1;

export type OfflineStoreName =
  | 'snapshots'
  | 'sync_queue'
  | 'conflicts'
  | 'auth_profiles'
  | 'media_cache'
  | 'meta';

export interface OfflineSnapshotRecord {
  userId: string;
  scope: 'staff' | 'representative' | 'customer';
  serverOrigin: string;
  cachedAt: string;
  serverTime?: string;
  user: User;
  customerProfile?: Customer | null;
  representativeProfile?: Representative | null;
  mobileConfig?: MobileConfig;
  data: any;
}

export interface OfflineAuthProfileRecord {
  profileKey: string;
  serverOrigin: string;
  username: string;
  userId: string;
  salt: string;
  iterations: number;
  verifierHash: string;
  user: User;
  customerProfile?: Customer | null;
  representativeProfile?: Representative | null;
  lastVerifiedAt: string;
  isActive: boolean;
}

export interface OfflineMediaRecord {
  mediaKey: string;
  productId?: string;
  sourceUrlHash: string;
  mimeType: string;
  dataUrl: string;
  cachedAt: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasElectronVault(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as any).awladDesktop?.offlineDb)
  );
}

function getSealSecret(): string {
  return `${getOrCreatePersistentDeviceId()}::AWLAD_OFFLINE_VAULT_V1`;
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'userId' });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          const sq = db.createObjectStore('sync_queue', { keyPath: 'operationId' });
          sq.createIndex('userId', 'userId', { unique: false });
          sq.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('conflicts')) {
          const cf = db.createObjectStore('conflicts', { keyPath: 'id' });
          cf.createIndex('userId', 'userId', { unique: false });
          cf.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('auth_profiles')) {
          db.createObjectStore('auth_profiles', { keyPath: 'profileKey' });
        }
        if (!db.objectStoreNames.contains('media_cache')) {
          db.createObjectStore('media_cache', { keyPath: 'mediaKey' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
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

function safeFileSegment(key: string): string {
  return String(key || 'item').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'item';
}

async function nativeMirrorWrite(store: OfflineStoreName, key: string, value: unknown): Promise<void> {
  if (store === 'media_cache') return; // handled separately if needed
  if (hasElectronVault()) {
    await (window as any).awladDesktop.offlineDb.set(store, key, value).catch(() => {});
    return;
  }
  if (isNativeCapacitor()) {
    try {
      const sealed = sealWithDeviceSecret(value, getSealSecret());
      await Filesystem.writeFile({
        path: `awlad_offline/${store}/${safeFileSegment(key)}.json`,
        data: JSON.stringify(sealed),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } catch {
      // ignore filesystem mirror failures on limited webviews
    }
  }
}

async function nativeMirrorRead<T = unknown>(store: OfflineStoreName, key: string): Promise<T | null> {
  if (store === 'media_cache') return null;
  if (hasElectronVault()) {
    try {
      const res = await (window as any).awladDesktop.offlineDb.get(store, key);
      return res?.ok && res.value ? (res.value as T) : null;
    } catch {
      return null;
    }
  }
  if (isNativeCapacitor()) {
    try {
      const res = await Filesystem.readFile({
        path: `awlad_offline/${store}/${safeFileSegment(key)}.json`,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      const parsed = JSON.parse(String(res.data || '{}'));
      return unsealWithDeviceSecret<T>(parsed, getSealSecret());
    } catch {
      return null;
    }
  }
  return null;
}

async function nativeMirrorDelete(store: OfflineStoreName, key: string): Promise<void> {
  if (hasElectronVault()) {
    await (window as any).awladDesktop.offlineDb.remove(store, key).catch(() => {});
    return;
  }
  if (isNativeCapacitor()) {
    try {
      await Filesystem.deleteFile({
        path: `awlad_offline/${store}/${safeFileSegment(key)}.json`,
        directory: Directory.Data,
      });
    } catch {
      // ignore missing file
    }
  }
}

// In-memory fallback map ONLY when IndexedDB is unavailable (e.g. restrictive private browsing / SSR test)
const memoryFallback = new Map<string, any>();

async function idbGet<T = any>(store: OfflineStoreName, key: string): Promise<T | null> {
  const db = await openIdb();
  if (!db) {
    const mir = await nativeMirrorRead<T>(store, key);
    if (mir !== null) return mir;
    return (memoryFallback.get(`${store}::${key}`) as T) ?? null;
  }
  const fromIdb = await new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  if (fromIdb !== null) return fromIdb;

  // Fallback recovery from Electron AES vault or Capacitor Filesystem if IndexedDB was cleared
  const mirrored = await nativeMirrorRead<T>(store, key);
  if (mirrored !== null) {
    await idbPut(store, key, mirrored, false);
    return mirrored;
  }
  return (memoryFallback.get(`${store}::${key}`) as T) ?? null;
}

async function idbGetAll<T = any>(store: OfflineStoreName): Promise<T[]> {
  const db = await openIdb();
  if (!db) {
    if (store === 'sync_queue' || store === 'auth_profiles' || store === 'conflicts') {
      const mirrored = await nativeMirrorRead<T[]>('meta', `index_${store}`);
      if (Array.isArray(mirrored)) return mirrored;
    }
    const prefix = `${store}::`;
    const list: T[] = [];
    for (const [k, v] of memoryFallback.entries()) {
      if (k.startsWith(prefix)) list.push(v);
    }
    return list;
  }

  const rows = await new Promise<T[]>((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

  if (rows.length === 0 && (store === 'sync_queue' || store === 'auth_profiles' || store === 'conflicts')) {
    const mirrored = await nativeMirrorRead<T[]>('meta', `index_${store}`);
    if (Array.isArray(mirrored) && mirrored.length > 0) {
      for (const item of mirrored) {
        await idbPut(store, getStoreKey(store, item), item, false);
      }
      return mirrored;
    }
  }
  return rows;
}

function getStoreKey(store: OfflineStoreName, val: any): string {
  switch (store) {
    case 'snapshots':
      return String(val.userId);
    case 'sync_queue':
      return String(val.operationId);
    case 'conflicts':
      return String(val.id);
    case 'auth_profiles':
      return String(val.profileKey);
    case 'media_cache':
      return String(val.mediaKey);
    case 'meta':
      return String(val.key);
  }
}

async function idbPut(store: OfflineStoreName, key: string, value: any, mirror = true): Promise<void> {
  memoryFallback.set(`${store}::${key}`, value);
  const db = await openIdb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  if (mirror) {
    await nativeMirrorWrite(store, key, value);
    if (store === 'sync_queue' || store === 'auth_profiles' || store === 'conflicts') {
      const all = await idbGetAll(store);
      await nativeMirrorWrite('meta', `index_${store}`, all);
    }
  }
}

async function idbDelete(store: OfflineStoreName, key: string): Promise<void> {
  memoryFallback.delete(`${store}::${key}`);
  const db = await openIdb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  await nativeMirrorDelete(store, key);
  if (store === 'sync_queue' || store === 'auth_profiles' || store === 'conflicts') {
    const all = await idbGetAll(store);
    await nativeMirrorWrite('meta', `index_${store}`, all);
  }
}

// ==============================================================================
// High-Level Typed LocalDB API
// ==============================================================================

export const localDb = {
  async saveSnapshot(snapshot: OfflineSnapshotRecord): Promise<void> {
    if (!snapshot?.userId) return;
    await idbPut('snapshots', snapshot.userId, snapshot, true);
  },

  async getSnapshot(userId: string): Promise<OfflineSnapshotRecord | null> {
    if (!userId) return null;
    return idbGet<OfflineSnapshotRecord>('snapshots', userId);
  },

  async listSyncQueue(userId?: string): Promise<SyncQueueItem[]> {
    const all = await idbGetAll<SyncQueueItem>('sync_queue');
    return all
      .filter((item) => (!userId ? true : item.userId === userId))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  },

  async upsertSyncQueueItem(item: SyncQueueItem): Promise<void> {
    await idbPut('sync_queue', item.operationId, item, true);
  },

  async deleteSyncQueueItem(operationId: string): Promise<void> {
    await idbDelete('sync_queue', operationId);
  },

  async pruneSyncedQueueItems(userId: string, maxKeep = 50): Promise<void> {
    const all = await this.listSyncQueue(userId);
    const synced = all.filter((i) => i.status === 'synced').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (synced.length <= maxKeep) return;
    for (const extra of synced.slice(maxKeep)) {
      await idbDelete('sync_queue', extra.operationId);
    }
  },

  async saveConflicts(conflicts: SyncConflictRecord[]): Promise<void> {
    for (const c of conflicts || []) {
      if (c?.id) {
        await idbPut('conflicts', c.id, c, true);
      }
    }
  },

  async replaceServerConflicts(serverConflicts: SyncConflictRecord[]): Promise<void> {
    const existing = await idbGetAll<SyncConflictRecord>('conflicts');
    const serverIds = new Set(serverConflicts.map((c) => c.id));
    for (const old of existing) {
      if (!serverIds.has(old.id)) {
        await idbDelete('conflicts', old.id);
      }
    }
    for (const c of serverConflicts) {
      await idbPut('conflicts', c.id, c, true);
    }
  },

  async listConflicts(userId?: string): Promise<SyncConflictRecord[]> {
    const all = await idbGetAll<SyncConflictRecord>('conflicts');
    return all
      .filter((c) => (!userId || !c.userId ? true : c.userId === userId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  async upsertAuthProfile(profile: OfflineAuthProfileRecord): Promise<void> {
    await idbPut('auth_profiles', profile.profileKey, profile, true);
  },

  async getAuthProfile(profileKey: string): Promise<OfflineAuthProfileRecord | null> {
    return idbGet<OfflineAuthProfileRecord>('auth_profiles', profileKey);
  },

  async listAuthProfiles(): Promise<OfflineAuthProfileRecord[]> {
    return idbGetAll<OfflineAuthProfileRecord>('auth_profiles');
  },

  async deleteAuthProfile(profileKey: string): Promise<void> {
    await idbDelete('auth_profiles', profileKey);
  },

  async getMedia(mediaKey: string): Promise<OfflineMediaRecord | null> {
    const rec = await idbGet<OfflineMediaRecord>('media_cache', mediaKey);
    if (rec?.dataUrl) return rec;
    if (hasElectronVault()) {
      const res = await (window as any).awladDesktop.offlineDb.readMedia(mediaKey).catch(() => null);
      if (res?.ok && res.dataUrl) {
        return {
          mediaKey,
          sourceUrlHash: mediaKey,
          mimeType: 'image/png',
          dataUrl: res.dataUrl,
          cachedAt: new Date().toISOString(),
        };
      }
    } else if (isNativeCapacitor()) {
      try {
        const res = await Filesystem.readFile({
          path: `awlad_offline/media/${safeFileSegment(mediaKey)}.txt`,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        const dataUrl = String(res.data || '');
        if (dataUrl.startsWith('data:')) {
          return {
            mediaKey,
            sourceUrlHash: mediaKey,
            mimeType: dataUrl.split(';')[0]?.replace('data:', '') || 'image/png',
            dataUrl,
            cachedAt: new Date().toISOString(),
          };
        }
      } catch {
        // ignore missing mobile media cache file
      }
    }
    return null;
  },

  async saveMedia(record: OfflineMediaRecord): Promise<void> {
    await idbPut('media_cache', record.mediaKey, record, false);
    if (hasElectronVault() && record.dataUrl) {
      await (window as any).awladDesktop.offlineDb
        .writeMedia(record.mediaKey, record.dataUrl)
        .catch(() => {});
    } else if (isNativeCapacitor() && record.dataUrl) {
      try {
        await Filesystem.writeFile({
          path: `awlad_offline/media/${safeFileSegment(record.mediaKey)}.txt`,
          data: record.dataUrl,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
          recursive: true,
        });
      } catch {
        // ignore quota errors on mobile media mirror
      }
    }
  },

  async setMeta(key: string, value: any): Promise<void> {
    await idbPut('meta', key, { key, value, updatedAt: new Date().toISOString() }, true);
  },

  async getMeta<T = any>(key: string): Promise<T | null> {
    const row = await idbGet<{ key: string; value: T }>('meta', key);
    return row?.value ?? null;
  },
};

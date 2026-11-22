import { registerPlugin } from '@capacitor/core';
import { isNativeCapacitor } from './native';

interface NativeSecureVaultPlugin {
  getItem(options: { key: string }): Promise<{ value: string | null }>;
  setItem(options: { key: string; value: string }): Promise<void>;
  removeItem(options: { key: string }): Promise<void>;
}

const NativeSecureVault = registerPlugin<NativeSecureVaultPlugin>('SecureVault');

interface ElectronSecureVaultBridge {
  getItem: (key: string) => Promise<{ ok: boolean; value: string | null }>;
  setItem: (key: string, value: string) => Promise<{ ok: boolean }>;
  removeItem: (key: string) => Promise<{ ok: boolean }>;
}

const VAULT_IDB_NAME = 'awlad_selim_secure_vault_v1';
const VAULT_IDB_VERSION = 1;
const STORE_KEYS = 'keys';
const STORE_SECRETS = 'secrets';
const MASTER_KEY_ID = 'master_aes_gcm_v1';

// Process-scoped in-memory store for Node test environments or when persistent crypto/IDB is absent
const memoryFallbackStore = new Map<string, string>();
let vaultIdbPromise: Promise<IDBDatabase | null> | null = null;

function getElectronSecureVaultBridge(): ElectronSecureVaultBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as any).awladDesktop?.secureVault;
  return bridge && typeof bridge.getItem === 'function' ? bridge : null;
}

function openVaultIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (vaultIdbPromise) return vaultIdbPromise;

  vaultIdbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(VAULT_IDB_NAME, VAULT_IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_KEYS)) {
          db.createObjectStore(STORE_KEYS);
        }
        if (!db.objectStoreNames.contains(STORE_SECRETS)) {
          db.createObjectStore(STORE_SECRETS);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return vaultIdbPromise;
}

async function idbVaultGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openVaultIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbVaultSet(storeName: string, key: string, value: unknown): Promise<boolean> {
  const db = await openVaultIdb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbVaultRemove(storeName: string, key: string): Promise<boolean> {
  const db = await openVaultIdb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function getOrCreateWebCryptoKey(): Promise<CryptoKey | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const db = await openVaultIdb();
  if (!db) return null;

  try {
    const existing = await idbVaultGet<CryptoKey>(STORE_KEYS, MASTER_KEY_ID);
    if (existing) return existing;

    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    const saved = await idbVaultSet(STORE_KEYS, MASTER_KEY_ID, generated);
    return saved ? generated : null;
  } catch {
    return null;
  }
}

interface EncryptedVaultEnvelope {
  v: 1;
  iv: number[];
  ct: number[];
}

interface PlainIdbEnvelope {
  v: 0;
  json: string;
}

async function sealWebSecret(key: string, jsonStr: string): Promise<void> {
  const db = await openVaultIdb();
  if (!db) {
    memoryFallbackStore.set(key, jsonStr);
    return;
  }

  const cryptoKey = await getOrCreateWebCryptoKey();
  if (cryptoKey && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    try {
      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv);
      const encoded = new TextEncoder().encode(jsonStr);
      const cipherBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        cryptoKey,
        encoded
      );
      const payload: EncryptedVaultEnvelope = {
        v: 1,
        iv: Array.from(iv),
        ct: Array.from(new Uint8Array(cipherBuf)),
      };
      await idbVaultSet(STORE_SECRETS, key, payload);
      return;
    } catch {
      // fall through to IndexedDB origin-isolated fallback below
    }
  }

  const fallback: PlainIdbEnvelope = { v: 0, json: jsonStr };
  await idbVaultSet(STORE_SECRETS, key, fallback);
}

async function unsealWebSecret(key: string): Promise<string | null> {
  const db = await openVaultIdb();
  if (!db) {
    return memoryFallbackStore.get(key) ?? null;
  }

  const stored = await idbVaultGet<EncryptedVaultEnvelope | PlainIdbEnvelope>(STORE_SECRETS, key);
  if (!stored) return null;

  if (stored.v === 1 && Array.isArray(stored.iv) && Array.isArray(stored.ct)) {
    const cryptoKey = await getOrCreateWebCryptoKey();
    if (!cryptoKey) return null;
    try {
      const iv = new Uint8Array(stored.iv);
      const ct = new Uint8Array(stored.ct);
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        cryptoKey,
        ct
      );
      return new TextDecoder().decode(plainBuf);
    } catch {
      return null;
    }
  }

  if (stored.v === 0 && typeof stored.json === 'string') {
    return stored.json;
  }

  return null;
}

export async function sealJson(key: string, value: unknown): Promise<void> {
  const jsonStr = JSON.stringify(value);
  const electronVault = getElectronSecureVaultBridge();
  if (electronVault) {
    const res = await electronVault.setItem(key, jsonStr);
    if (res?.ok) return;
  }

  if (isNativeCapacitor()) {
    try {
      await NativeSecureVault.setItem({ key, value: jsonStr });
      return;
    } catch {
      // fall back cleanly to IndexedDB WebCrypto vault
    }
  }

  await sealWebSecret(key, jsonStr);
}

export async function unsealJson<T = unknown>(key: string): Promise<T | null> {
  let raw: string | null = null;

  const electronVault = getElectronSecureVaultBridge();
  if (electronVault) {
    try {
      const res = await electronVault.getItem(key);
      if (res?.ok && typeof res.value === 'string') {
        raw = res.value;
      }
    } catch {
      raw = null;
    }
  } else if (isNativeCapacitor()) {
    try {
      const res = await NativeSecureVault.getItem({ key });
      raw = typeof res?.value === 'string' ? res.value : null;
    } catch {
      raw = null;
    }
  } else {
    raw = await unsealWebSecret(key);
  }

  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function removeSealedKey(key: string): Promise<void> {
  memoryFallbackStore.delete(key);

  const electronVault = getElectronSecureVaultBridge();
  if (electronVault) {
    await electronVault.removeItem(key).catch(() => {});
  }

  if (isNativeCapacitor()) {
    await NativeSecureVault.removeItem({ key }).catch(() => {});
  }

  await idbVaultRemove(STORE_SECRETS, key).catch(() => {});
}

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

export class SecureVaultError extends Error {
  code: string;
  constructor(message: string, code = 'SECURE_VAULT_UNAVAILABLE') {
    super(message);
    this.name = 'SecureVaultError';
    this.code = code;
  }
}

interface EncryptedVaultEnvelope {
  v: 1;
  iv: number[];
  ct: number[];
}

function isHeadlessNonIdbTestEnv(): boolean {
  return typeof indexedDB === 'undefined';
}

async function sealWebSecret(key: string, jsonStr: string): Promise<void> {
  if (isHeadlessNonIdbTestEnv()) {
    memoryFallbackStore.set(key, jsonStr);
    return;
  }

  const db = await openVaultIdb();
  if (!db) {
    throw new SecureVaultError('تعذر فتح قاعدة التشفير المحلية للمتصفح لحماية البيانات الحساسة.');
  }

  const cryptoKey = await getOrCreateWebCryptoKey();
  if (!cryptoKey || typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new SecureVaultError(
      'تشفير WebCrypto AES-GCM غير متاح في هذه البيئة؛ يُمنع حفظ البيانات الحساسة بدون تشفير.'
    );
  }

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
  const saved = await idbVaultSet(STORE_SECRETS, key, payload);
  if (!saved) {
    throw new SecureVaultError('فشل حفظ البيانات المشفرة في المخزن المحلي.');
  }
}

async function unsealWebSecret(key: string): Promise<string | null> {
  if (isHeadlessNonIdbTestEnv()) {
    return memoryFallbackStore.get(key) ?? null;
  }

  const db = await openVaultIdb();
  if (!db) return null;

  const stored = await idbVaultGet<EncryptedVaultEnvelope>(STORE_SECRETS, key);
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

  return null;
}

export async function sealJson(key: string, value: unknown): Promise<void> {
  const jsonStr = JSON.stringify(value);
  const electronVault = getElectronSecureVaultBridge();
  if (electronVault) {
    let res: { ok: boolean; error?: string } | null = null;
    try {
      res = await electronVault.setItem(key, jsonStr);
    } catch (err: any) {
      throw new SecureVaultError(
        err?.message || 'فشل الوصول إلى المخزن الآمن لنظام التشغيل (safeStorage). يرجى إعادة المحاولة.',
        'ELECTRON_VAULT_ERROR'
      );
    }
    if (!res?.ok) {
      throw new SecureVaultError(
        (res as any)?.error || 'تعذر حفظ البيانات داخل المخزن الآمن لنظام التشغيل (safeStorage).',
        'ELECTRON_VAULT_ERROR'
      );
    }
    return;
  }

  if (isNativeCapacitor()) {
    try {
      await NativeSecureVault.setItem({ key, value: jsonStr });
      return;
    } catch (err: any) {
      throw new SecureVaultError(
        err?.message || 'فشل الحفظ داخل المخزن الآمن الأصلي للجهاز (Keystore/Keychain).',
        'NATIVE_VAULT_ERROR'
      );
    }
  }

  await sealWebSecret(key, jsonStr);
}

export async function unsealJson<T = unknown>(key: string): Promise<T | null> {
  let raw: string | null = null;

  const electronVault = getElectronSecureVaultBridge();
  if (electronVault) {
    const res = await electronVault.getItem(key);
    if (!res?.ok) {
      throw new SecureVaultError(
        (res as any)?.error || 'فشل قراءة المخزن الآمن لنظام التشغيل (safeStorage).',
        'ELECTRON_VAULT_ERROR'
      );
    }
    raw = typeof res.value === 'string' ? res.value : null;
  } else if (isNativeCapacitor()) {
    try {
      const res = await NativeSecureVault.getItem({ key });
      raw = typeof res?.value === 'string' ? res.value : null;
    } catch (err: any) {
      throw new SecureVaultError(
        err?.message || 'فشل قراءة المخزن الآمن الأصلي للجهاز (Keystore/Keychain).',
        'NATIVE_VAULT_ERROR'
      );
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
    await electronVault.removeItem(key);
    return;
  }

  if (isNativeCapacitor()) {
    await NativeSecureVault.removeItem({ key });
    return;
  }

  await idbVaultRemove(STORE_SECRETS, key).catch(() => {});
}

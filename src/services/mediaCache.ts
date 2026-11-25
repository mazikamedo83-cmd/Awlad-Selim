import type { Product } from '../types';

const MEDIA_DB_NAME = 'awlad_selim_media_cache_v1';
const MEDIA_STORE_NAME = 'product_images';
const MAX_CACHEABLE_LENGTH = 512_000;

const memoryMediaCache = new Map<string, string>();
let mediaDbPromise: Promise<IDBDatabase | null> | null = null;

function openMediaDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (mediaDbPromise) return mediaDbPromise;
  mediaDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(MEDIA_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
          db.createObjectStore(MEDIA_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return mediaDbPromise;
}

async function readStoredMedia(key: string): Promise<string | null> {
  if (memoryMediaCache.has(key)) {
    return memoryMediaCache.get(key) || null;
  }
  const db = await openMediaDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MEDIA_STORE_NAME, 'readonly');
      const store = tx.objectStore(MEDIA_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const val = typeof req.result === 'string' ? req.result : null;
        if (val) memoryMediaCache.set(key, val);
        resolve(val);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeStoredMedia(key: string, dataUrl: string): Promise<void> {
  memoryMediaCache.set(key, dataUrl);
  const db = await openMediaDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
      tx.objectStore(MEDIA_STORE_NAME).put(dataUrl, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getCachedProductImageMap(
  products: Product[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!Array.isArray(products) || products.length === 0) return result;

  for (const prod of products) {
    if (!prod?.id || !prod.image) continue;
    const src = String(prod.image).trim();
    if (!src) continue;
    if (src.startsWith('data:image/')) {
      result[prod.id] = src;
      continue;
    }
    const cached = await readStoredMedia(prod.id);
    if (cached) {
      result[prod.id] = cached;
    }
  }
  return result;
}

export async function warmProductMediaCache(
  products: Product[],
  onLoaded?: (productId: string, dataUrl: string) => void
): Promise<void> {
  if (!Array.isArray(products) || products.length === 0) return;
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  for (const prod of products) {
    if (!prod?.id || !prod.image) continue;
    const src = String(prod.image).trim();
    if (!src) continue;

    if (src.startsWith('data:image/')) {
      if (src.length <= MAX_CACHEABLE_LENGTH) {
        await writeStoredMedia(prod.id, src);
      }
      continue;
    }

    const existing = await readStoredMedia(prod.id);
    if (existing) continue;

    try {
      if (!/^(https?:\/\/|\/)/i.test(src)) continue;
      const res = await fetch(src);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob || blob.size === 0 || blob.size > MAX_CACHEABLE_LENGTH) continue;
      if (typeof FileReader === 'undefined') continue;

      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
      if (dataUrl) {
        await writeStoredMedia(prod.id, dataUrl);
        if (onLoaded) {
          onLoaded(prod.id, dataUrl);
        }
      }
    } catch {
      // Ignore individual image pre-cache errors offline
    }
  }
}

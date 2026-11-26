import type { Product } from '../types';
import { getConfiguredApiBaseUrl } from './api';
import { localDb } from './localDb';

const MAX_CACHEABLE_BYTES = 2 * 1024 * 1024;

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function getProductImageSrc(product: Product): string {
  return String((product as Product & { image?: string; imageUrl?: string }).image || (product as Product & { imageUrl?: string }).imageUrl || '');
}

function getMediaCacheKey(product: Product): string {
  return `prod_${product.id}_${hashString(getProductImageSrc(product))}`;
}

function resolveMediaFetchUrl(rawUrl: string): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (/^(?:data:|blob:|https?:\/\/)/i.test(clean)) return clean;
  const base = getConfiguredApiBaseUrl().replace(/\/+$/, '');
  if (!base) return clean;
  return clean.startsWith('/') ? `${base}${clean}` : `${base}/${clean}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read media blob'));
    reader.readAsDataURL(blob);
  });
}

export async function getCachedProductImageMap(products: Product[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (!Array.isArray(products) || products.length === 0) return map;

  await Promise.all(
    products.map(async (prod) => {
      const img = prod?.id ? getProductImageSrc(prod) : '';
      if (!prod?.id || !img) return;
      if (img.startsWith('data:')) {
        map[prod.id] = img;
        return;
      }
      const cached = await localDb.readMedia(getMediaCacheKey(prod)).catch(() => null);
      if (cached) {
        map[prod.id] = cached;
      }
    })
  );

  return map;
}

export async function warmProductMediaCache(
  products: Product[],
  onItemCached?: (productId: string, dataUrl: string) => void
): Promise<void> {
  if (!Array.isArray(products) || products.length === 0) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  for (const prod of products) {
    const img = prod?.id ? getProductImageSrc(prod) : '';
    if (!prod?.id || !img) continue;
    if (img.startsWith('data:')) {
      await localDb.writeMedia(getMediaCacheKey(prod), img).catch(() => {});
      onItemCached?.(prod.id, img);
      continue;
    }

    const key = getMediaCacheKey(prod);
    const existing = await localDb.readMedia(key).catch(() => null);
    if (existing) continue;

    const url = resolveMediaFetchUrl(img);
    if (!url) continue;

    try {
      const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob || blob.size === 0 || blob.size > MAX_CACHEABLE_BYTES) continue;
      const dataUrl = await blobToDataUrl(blob);
      if (!dataUrl.startsWith('data:')) continue;
      await localDb.writeMedia(key, dataUrl);
      onItemCached?.(prod.id, dataUrl);
    } catch {
      // ignore unreachable remote media during warming
    }
  }
}

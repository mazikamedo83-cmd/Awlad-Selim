import { localDb } from './localDb';
import { sha256Hex } from './offlineCrypto';
import { getConfiguredApiBaseUrl } from './api';
import type { Product } from '../types';

function computeMediaKey(productId: string, sourceUrl: string): string {
  const hash = sha256Hex(sourceUrl).slice(0, 16);
  return `PRD-${productId}-${hash}`;
}

function resolveFetchUrl(rawUrl: string): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (clean.startsWith('data:') || /^https?:\/\//i.test(clean)) return clean;
  const base = getConfiguredApiBaseUrl();
  if (!base) return clean;
  return `${base}${clean.startsWith('/') ? clean : `/${clean}`}`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

let inFlightWarm = false;

export async function warmProductMediaCache(
  products: Product[],
  onCached?: (productId: string, dataUrl: string) => void
): Promise<void> {
  if (inFlightWarm || !Array.isArray(products) || products.length === 0) return;
  inFlightWarm = true;
  try {
    for (const prod of products) {
      if (!prod?.id || !prod?.image) continue;
      const src = String(prod.image).trim();
      if (!src) continue;

      const mediaKey = computeMediaKey(prod.id, src);
      const existing = await localDb.getMedia(mediaKey);
      if (existing?.dataUrl) {
        onCached?.(prod.id, existing.dataUrl);
        continue;
      }

      if (src.startsWith('data:')) {
        await localDb.saveMedia({
          mediaKey,
          productId: prod.id,
          sourceUrlHash: mediaKey,
          mimeType: src.split(';')[0]?.replace('data:', '') || 'image/png',
          dataUrl: src,
          cachedAt: new Date().toISOString(),
        });
        onCached?.(prod.id, src);
        continue;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        continue;
      }

      try {
        const targetUrl = resolveFetchUrl(src);
        if (!targetUrl) continue;
        const res = await fetch(targetUrl, { method: 'GET' });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size > 3 * 1024 * 1024) continue; // cap single asset cache at 3MB
        const dataUrl = await blobToDataUrl(blob);
        if (!dataUrl.startsWith('data:')) continue;
        await localDb.saveMedia({
          mediaKey,
          productId: prod.id,
          sourceUrlHash: mediaKey,
          mimeType: blob.type || 'image/png',
          dataUrl,
          cachedAt: new Date().toISOString(),
        });
        onCached?.(prod.id, dataUrl);
      } catch {
        // Ignore offline/network image failures silently so warm-up never breaks app flow
      }
    }
  } finally {
    inFlightWarm = false;
  }
}

export async function getCachedProductImageMap(products: Product[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const prod of products || []) {
    if (!prod?.id || !prod?.image) continue;
    const src = String(prod.image).trim();
    if (!src) continue;
    if (src.startsWith('data:')) {
      result[prod.id] = src;
      continue;
    }
    const mediaKey = computeMediaKey(prod.id, src);
    const cached = await localDb.getMedia(mediaKey);
    if (cached?.dataUrl) {
      result[prod.id] = cached.dataUrl;
    }
  }
  return result;
}

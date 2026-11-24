import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Geolocation } from '@capacitor/geolocation';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { App as CapacitorApp } from '@capacitor/app';

export function isNativeCapacitor(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getNativePlatform(): 'android' | 'ios' | 'web' {
  try {
    const p = Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') return p;
    return 'web';
  } catch {
    return 'web';
  }
}

export function isMobileAppPlatform(): boolean {
  const platform = getNativePlatform();
  return platform === 'android' || platform === 'ios';
}

export function isElectronDesktop(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean((window as any).awladDesktop?.secureVault);
  } catch {
    return false;
  }
}

export function syncNativeStatusBarStyle(appearance: 'light-header' | 'dark-header'): void {
  if (!isNativeCapacitor()) return;
  try {
    const plugins = (Capacitor as any).Plugins;
    const systemBars = plugins?.SystemBars;
    if (systemBars && typeof systemBars.setStyle === 'function') {
      systemBars
        .setStyle({
          bar: 'StatusBar',
          style: appearance === 'light-header' ? 'LIGHT' : 'DARK',
        })
        .catch(() => {});
    }
  } catch {
    // ignore on platforms without SystemBars
  }
}

export async function getPref(key: string): Promise<string | null> {
  if (!isNativeCapacitor()) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  try {
    const res = await Preferences.get({ key });
    return res.value ?? null;
  } catch {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

export async function setPref(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore localStorage errors
  }
  if (!isNativeCapacitor()) return;
  try {
    await Preferences.set({ key, value });
  } catch {
    // ignore preferences errors
  }
}

export async function removePref(key: string): Promise<void> {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  if (!isNativeCapacitor()) return;
  try {
    await Preferences.remove({ key });
  } catch {
    // ignore
  }
}

export async function hydrateNativePreferences(keys: string[]): Promise<void> {
  if (!isNativeCapacitor()) return;
  for (const key of keys) {
    try {
      const { value } = await Preferences.get({ key });
      if (value && !localStorage.getItem(key)) {
        localStorage.setItem(key, value);
      } else if (!value && localStorage.getItem(key)) {
        await Preferences.set({ key, value: localStorage.getItem(key) as string });
      }
    } catch {
      // ignore
    }
  }
}

export async function getCurrentLocationSafe(): Promise<{
  ok: boolean;
  coords?: string;
  latitude?: number;
  longitude?: number;
  error?: string;
}> {
  if (isNativeCapacitor()) {
    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted' && req.coarseLocation !== 'granted') {
          return { ok: false, error: 'تم رفض صلاحية تحديد الموقع الجغرافي (GPS).' };
        }
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 12000,
      });
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
        return { ok: false, error: 'تمت قراءة إحداثيات غير صالحة (0, 0). يرجى المحاولة في مكان مفتوح أو اختيار الموقع على الخريطة.' };
      }
      const coords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      return { ok: true, coords, latitude: lat, longitude: lng };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'تعذر الحصول على الإحداثيات الحالية من GPS الهاتف.',
      };
    }
  }

  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lng = Number(pos.coords.longitude.toFixed(6));
          if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
            resolve({
              ok: false,
              error: 'تمت قراءة إحداثيات غير صالحة (0, 0). يرجى اختيار الموقع يدوياً على الخريطة.',
            });
            return;
          }
          resolve({
            ok: true,
            coords: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            latitude: lat,
            longitude: lng,
          });
        },
        (err) => {
          resolve({
            ok: false,
            error: err?.message || 'يرجى السماح للمتصفح بالوصول إلى الموقع الجغرافي.',
          });
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  return { ok: false, error: 'خدمة تحديد الموقع غير مدعومة على هذا الجهاز.' };
}

export function parseLatLngCoords(raw: string): { lat: number; lng: number } | null {
  const m = String(raw || '')
    .trim()
    .match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return null;
  return { lat, lng };
}

export async function reverseGeocodeCoords(
  lat: number,
  lng: number,
  apiBaseUrl = ''
): Promise<
  | { ok: true; address: string; area?: string; city?: string; governorate?: string }
  | { ok: false; quotaExceeded?: boolean; error: string }
> {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
  ) {
    return { ok: false, error: 'إحداثيات الموقع غير صالحة أو تساوي (0, 0). يرجى اختيار موقع حقيقي.' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      ok: false,
      error: 'الجهاز غير متصل بالإنترنت؛ تم حفظ الإحداثيات فقط ويمكنك كتابة العنوان يدوياً.',
    };
  }

  const cleanBase = String(apiBaseUrl || '').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const proxyRes = await fetch(
      `${cleanBase}/api/maps/reverse-geocode?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    ).catch(() => null);

    if (proxyRes) {
      const proxyJson: any = await proxyRes.json().catch(() => null);
      if (proxyRes.ok && proxyJson?.ok && proxyJson.address) {
        return {
          ok: true,
          address: String(proxyJson.address),
          area: proxyJson.area ? String(proxyJson.area) : undefined,
          city: proxyJson.city ? String(proxyJson.city) : undefined,
          governorate: proxyJson.governorate ? String(proxyJson.governorate) : undefined,
        };
      }
      if (proxyJson?.quotaExceeded && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded', { detail: { reason: 'reverse-geocode-429' } }));
        return {
          ok: false,
          quotaExceeded: true,
          error: proxyJson.error || 'تم تجاوز حصة خدمة الخرائط المجانية.',
        };
      }
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      String(lat)
    )}&lon=${encodeURIComponent(String(lng))}&accept-language=ar`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: 'تعذر تحويل الإحداثيات لعنوان تلقائياً الآن؛ تم حفظ الإحداثيات ويمكنك كتابة العنوان يدوياً.',
      };
    }
    const json: any = await res.json().catch(() => null);
    const addrObj = json?.address && typeof json.address === 'object' ? json.address : {};
    const area =
      String(
        addrObj.suburb ||
          addrObj.neighbourhood ||
          addrObj.city_district ||
          addrObj.town ||
          addrObj.village ||
          addrObj.city ||
          ''
      ).trim() || undefined;
    const city =
      String(addrObj.city || addrObj.town || addrObj.county || addrObj.state_district || '').trim() || undefined;

    const parts = [
      addrObj.road,
      addrObj.neighbourhood || addrObj.suburb,
      addrObj.city || addrObj.town || addrObj.village,
      addrObj.state,
    ]
      .map((p) => String(p || '').trim())
      .filter(Boolean);

    const address =
      parts.length > 0
        ? Array.from(new Set(parts)).join('، ')
        : String(json?.display_name || '').trim();

    if (!address) {
      return {
        ok: false,
        error: 'لم تُرجع خدمة الخرائط عنواناً وصفياً لهذه الإحداثيات؛ يمكنك كتابة العنوان يدوياً.',
      };
    }
    const governorate =
      String(addrObj.state || addrObj.governorate || addrObj.province || addrObj.region || '').trim() || undefined;
    return { ok: true, address, area, city, governorate };
  } catch {
    return {
      ok: false,
      error: 'تعذر جلب العنوان من الخرائط (انتهت المهلة أو تعذر الاتصال)؛ تم الاحتفاظ بالإحداثيات فقط.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function saveAndShareDocument(params: {
  filename: string;
  content: string;
  mimeType: string;
  title: string;
  isBase64?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const safeName = params.filename.replace(/[^\w.\-\u0600-\u06FF]/g, '_');

  if (!isNativeCapacitor()) {
    try {
      const blob = params.isBase64
        ? new Blob([Uint8Array.from(atob(params.content), (c) => c.charCodeAt(0))], { type: params.mimeType })
        : new Blob([params.content], { type: params.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر حفظ الملف' };
    }
  }

  try {
    const written = await Filesystem.writeFile({
      path: safeName,
      data: params.content,
      directory: Directory.Cache,
      encoding: params.isBase64 ? undefined : Encoding.UTF8,
      recursive: true,
    });

    await Share.share({
      title: params.title,
      text: params.title,
      url: written.uri,
      dialogTitle: params.title,
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'تعذر مشاركة أو حفظ المستند على الهاتف' };
  }
}

let notificationPermissionAsked = false;

export async function notifyLocal(params: {
  id: number;
  title: string;
  body: string;
  extra?: Record<string, any>;
}): Promise<void> {
  if (!isNativeCapacitor()) return;
  try {
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted' && !notificationPermissionAsked) {
      notificationPermissionAsked = true;
      status = await LocalNotifications.requestPermissions();
    }
    if (status.display !== 'granted') return;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.abs(params.id) % 2147483000 || Math.floor(Date.now() % 2000000000),
          title: params.title,
          body: params.body,
          schedule: { at: new Date(Date.now() + 250) },
          extra: params.extra || {},
        },
      ],
    });
  } catch {
    // non-fatal on unsupported emulators
  }
}

export function subscribeNetworkStatus(
  onStatusChange: (connected: boolean) => void
): () => void {
  let active = true;
  let listenerHandle: { remove: () => Promise<void> } | null = null;

  const handleOnline = () => {
    if (active) onStatusChange(true);
  };
  const handleOffline = () => {
    if (active) onStatusChange(false);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  if (isNativeCapacitor()) {
    Network.getStatus()
      .then((status) => {
        if (active) onStatusChange(Boolean(status.connected));
      })
      .catch(() => {});

    Network.addListener('networkStatusChange', (status) => {
      if (active) onStatusChange(Boolean(status.connected));
    })
      .then((handle) => {
        if (!active) {
          handle.remove().catch(() => {});
        } else {
          listenerHandle = handle;
        }
      })
      .catch(() => {});
  }

  return () => {
    active = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
    if (listenerHandle) {
      listenerHandle.remove().catch(() => {});
    }
  };
}

export function subscribeAppForeground(onForeground: () => void): () => void {
  let active = true;
  let capHandle: { remove: () => Promise<void> } | null = null;

  const trigger = () => {
    if (active) onForeground();
  };

  const handleVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      trigger();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', trigger);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  if (isNativeCapacitor()) {
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (active && isActive) {
        trigger();
      }
    })
      .then((h) => {
        if (!active) {
          h.remove().catch(() => {});
        } else {
          capHandle = h;
        }
      })
      .catch(() => {});
  }

  return () => {
    active = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', trigger);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    if (capHandle) {
      capHandle.remove().catch(() => {});
    }
  };
}

export function registerAndroidBackButton(handler: () => boolean | void): () => void {
  if (!isNativeCapacitor() || getNativePlatform() !== 'android') {
    return () => {};
  }

  let active = true;
  let handle: { remove: () => Promise<void> } | null = null;

  CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    const handled = handler();
    if (handled === true) return;
    if (canGoBack && typeof window !== 'undefined') {
      window.history.back();
    } else {
      CapacitorApp.minimizeApp().catch(() => {});
    }
  })
    .then((h) => {
      if (!active) {
        h.remove().catch(() => {});
      } else {
        handle = h;
      }
    })
    .catch(() => {});

  return () => {
    active = false;
    if (handle) {
      handle.remove().catch(() => {});
    }
  };
}

export const DEVICE_ID_STORAGE_KEY = 'awlad_selim_device_id';

export function getOrCreatePersistentDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY)?.trim();
    if (existing && existing.length >= 8) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `DEV-${crypto.randomUUID()}`
        : `DEV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    if (isNativeCapacitor()) {
      Preferences.set({ key: DEVICE_ID_STORAGE_KEY, value: generated }).catch(() => {});
    }
    return generated;
  } catch {
    return `DEV-${Date.now().toString(36)}`;
  }
}

export function getClientDeviceDescriptor(): {
  deviceId: string;
  deviceType: 'windows' | 'android' | 'ios' | 'web';
  deviceName: string;
  osVersion: string;
  appVersion: string;
} {
  const deviceId = getOrCreatePersistentDeviceId();
  const capPlatform = getNativePlatform();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isElectronDesktop = typeof window !== 'undefined' && Boolean((window as any).awladDesktop?.isElectron);

  let deviceType: 'windows' | 'android' | 'ios' | 'web' = 'web';
  if (capPlatform === 'android' || /android/i.test(ua)) deviceType = 'android';
  else if (capPlatform === 'ios' || /iphone|ipad|ipod/i.test(ua)) deviceType = 'ios';
  else if (isElectronDesktop || /windows/i.test(ua)) deviceType = 'windows';

  let deviceName = 'متصفح الويب';
  if (deviceType === 'windows') {
    deviceName = isElectronDesktop ? 'كمبيوتر المحل (Windows Desktop)' : 'جهاز Windows';
  } else if (deviceType === 'android') {
    deviceName = isNativeCapacitor() ? 'تطبيق Android (AWLAD SELIM)' : 'هاتف Android';
  } else if (deviceType === 'ios') {
    deviceName = isNativeCapacitor() ? 'تطبيق iPhone (AWLAD SELIM)' : 'هاتف iPhone / iPad';
  }

  return {
    deviceId,
    deviceType,
    deviceName,
    osVersion: ua.slice(0, 75),
    appVersion: '3.0.0',
  };
}

export function hasCameraMediaSupport(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export async function requestCameraStreamForQr(): Promise<
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: 'unsupported' | 'permission_denied' | 'no_camera' | 'busy' | 'unknown'; error: string }
> {
  if (!hasCameraMediaSupport()) {
    return {
      ok: false,
      reason: 'unsupported',
      error: 'الكاميرا غير متاحة في هذا المتصفح/الجهاز. يمكنك رفع صورة QR أو لصق الرابط.',
    };
  }

  try {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (constraintErr: any) {
      const errName = String(constraintErr?.name || '');
      if (
        errName === 'OverconstrainedError' ||
        errName === 'ConstraintNotSatisfiedError' ||
        errName === 'NotFoundError'
      ) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      } else {
        throw constraintErr;
      }
    }
    return { ok: true, stream };
  } catch (err: any) {
    const errName = String(err?.name || '');
    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      return {
        ok: false,
        reason: 'permission_denied',
        error:
          'تم رفض إذن الكاميرا. اسمح للتطبيق باستخدام الكاميرا عند المطالبة (أو فعّل الإذن من إعدادات التطبيق في الهاتف إذا سبق الرفض نهائياً)، أو استخدم "رفع صورة QR" أو "لصق رابط الدعوة".',
      };
    }
    if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
      return {
        ok: false,
        reason: 'no_camera',
        error: 'لم يتم العثور على كاميرا متاحة على هذا الجهاز. يمكنك رفع صورة رمز QR أو لصق رابط الدعوة.',
      };
    }
    if (errName === 'NotReadableError' || errName === 'TrackStartError') {
      return {
        ok: false,
        reason: 'busy',
        error: 'الكاميرا مستخدمة حالياً بواسطة تطبيق آخر. أغلقه وأعد المحاولة أو الصق رابط الدعوة.',
      };
    }
    return {
      ok: false,
      reason: 'unknown',
      error: 'تعذر تشغيل الكاميرا على هذا الجهاز. يمكنك رفع صورة رمز QR أو لصق رابط الدعوة.',
    };
  }
}

export async function getLaunchDeepLinkUrl(): Promise<string | null> {
  if (!isNativeCapacitor()) return null;
  try {
    const launch = await CapacitorApp.getLaunchUrl();
    const url = launch?.url?.trim();
    return url || null;
  } catch {
    return null;
  }
}

const pendingDeepLinkUrls: string[] = [];
let earlyDeepLinkListenerStarted = false;
let activeDeepLinkDispatcher: ((url: string) => void) | null = null;

export function initDeepLinkCapture(): void {
  ensureEarlyNativeDeepLinkBuffer();
}

function ensureEarlyNativeDeepLinkBuffer(): void {
  if (earlyDeepLinkListenerStarted || !isNativeCapacitor()) return;
  earlyDeepLinkListenerStarted = true;
  try {
    CapacitorApp.addListener('appUrlOpen', (event) => {
      const clean = String(event?.url || '').trim();
      if (!clean) return;
      if (activeDeepLinkDispatcher) {
        activeDeepLinkDispatcher(clean);
      } else {
        pendingDeepLinkUrls.push(clean);
      }
    }).catch(() => {});
  } catch {
    // ignore in non-native environments
  }
}

export function subscribeDeepLinks(
  onUrl: (url: string) => void,
  options?: { skipInitialLaunchUrl?: boolean }
): () => void {
  if (!isNativeCapacitor()) {
    return () => {};
  }
  ensureEarlyNativeDeepLinkBuffer();

  let active = true;
  let lastUrl = '';
  let lastSeenAt = 0;

  const dispatchUrl = (rawUrl?: string | null) => {
    const clean = String(rawUrl || '').trim();
    if (!active || !clean) return;
    const now = Date.now();
    if (clean === lastUrl && now - lastSeenAt < 4000) return;
    lastUrl = clean;
    lastSeenAt = now;
    onUrl(clean);
  };

  activeDeepLinkDispatcher = dispatchUrl;

  while (pendingDeepLinkUrls.length > 0) {
    const queued = pendingDeepLinkUrls.shift();
    if (queued) dispatchUrl(queued);
  }

  if (!options?.skipInitialLaunchUrl) {
    getLaunchDeepLinkUrl()
      .then((url) => dispatchUrl(url))
      .catch(() => {});
  }

  return () => {
    active = false;
    if (activeDeepLinkDispatcher === dispatchUrl) {
      activeDeepLinkDispatcher = null;
    }
  };
}



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
      const coords = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
      return { ok: true, coords };
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
          resolve({
            ok: true,
            coords: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`,
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

const PERSISTENT_DEVICE_ID_KEY = 'awlad_selim_persistent_device_id';
let memoryFallbackDeviceId = '';

export function getOrCreatePersistentDeviceId(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(PERSISTENT_DEVICE_ID_KEY)?.trim();
      if (existing) return existing;
    }
  } catch {
    // ignore storage read error
  }
  if (memoryFallbackDeviceId) return memoryFallbackDeviceId;

  const rnd =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const platformPrefix = getNativePlatform() === 'android' ? 'AND' : getNativePlatform() === 'ios' ? 'IOS' : 'DEV';
  const generated = `${platformPrefix}-${rnd.toUpperCase()}`;
  memoryFallbackDeviceId = generated;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PERSISTENT_DEVICE_ID_KEY, generated);
    }
  } catch {
    // ignore
  }
  if (isNativeCapacitor()) {
    Preferences.set({ key: PERSISTENT_DEVICE_ID_KEY, value: generated }).catch(() => {});
  }
  return generated;
}

export function getClientDeviceDescriptor(): {
  deviceId: string;
  deviceName: string;
  deviceType: 'windows' | 'android' | 'ios' | 'web';
  osVersion: string;
  appVersion: string;
} {
  const deviceId = getOrCreatePersistentDeviceId();
  const nativePlat = getNativePlatform();
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const isElectron =
    typeof window !== 'undefined' && Boolean((window as any)?.awladDesktop?.isElectron);

  let deviceType: 'windows' | 'android' | 'ios' | 'web' = 'web';
  if (nativePlat === 'android') deviceType = 'android';
  else if (nativePlat === 'ios') deviceType = 'ios';
  else if (isElectron || /windows/i.test(ua)) deviceType = 'windows';
  else if (/android/i.test(ua)) deviceType = 'android';
  else if (/iphone|ipad|ipod/i.test(ua)) deviceType = 'ios';

  const deviceName =
    deviceType === 'windows'
      ? 'AWLAD SELIM Windows Desktop'
      : deviceType === 'android'
      ? 'AWLAD SELIM Android'
      : deviceType === 'ios'
      ? 'AWLAD SELIM iPhone / iPad'
      : 'AWLAD SELIM Web Browser';

  return {
    deviceId,
    deviceName,
    deviceType,
    osVersion: ua.slice(0, 80),
    appVersion: '3.0.0',
  };
}

export function hasCameraMediaSupport(): boolean {
  try {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  } catch {
    return false;
  }
}

export async function getInitialAppLaunchUrl(): Promise<string | null> {
  if (isNativeCapacitor()) {
    try {
      const launch = await CapacitorApp.getLaunchUrl();
      if (launch?.url) return launch.url;
    } catch {
      // ignore if unsupported
    }
  }
  if (typeof window !== 'undefined' && window.location?.href) {
    const href = window.location.href;
    if (
      /[?&](pair_token|token)=/i.test(href) ||
      /\/(?:pair|invite)\//i.test(window.location.pathname) ||
      /^awladselim:\/\//i.test(href)
    ) {
      return href;
    }
  }
  return null;
}

export function subscribeAppUrlOpen(onUrl: (url: string) => void): () => void {
  if (!isNativeCapacitor()) {
    return () => {};
  }
  let active = true;
  let handle: { remove: () => Promise<void> } | null = null;
  CapacitorApp.addListener('appUrlOpen', (event) => {
    if (active && event?.url) {
      onUrl(event.url);
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


import {
  DEVICE_ID_STORAGE_KEY,
  getOrCreatePersistentDeviceId,
  hydrateNativePreferences,
  isNativeCapacitor,
  removePref,
  setPref,
} from './native';
import type { ConnectionMode, ConnectionProfilesConfig } from '../types';

const TOKENS_KEY = 'awlad_selim_auth_tokens_v3';
const SERVER_URL_KEY = 'awlad_selim_server_base_url';
const CONNECTION_PROFILES_KEY = 'awlad_selim_connection_profiles_v1';
const FALLBACK_ENDPOINTS_KEY = 'awlad_selim_fallback_endpoints_v1';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export interface StoredFallbackEndpoint {
  mode: ConnectionMode;
  url: string;
  label: string;
}

type AuthExpiredCallback = (message?: string) => void;
let onAuthExpiredHandler: AuthExpiredCallback | null = null;

export function setAuthExpiredHandler(cb: AuthExpiredCallback | null): void {
  onAuthExpiredHandler = cb;
}

export function triggerAuthExpired(message?: string): void {
  saveStoredTokens(null);
  if (onAuthExpiredHandler) {
    onAuthExpiredHandler(message);
  }
}

export async function hydrateServerUrlFromNative(): Promise<void> {
  await hydrateNativePreferences([
    SERVER_URL_KEY,
    CONNECTION_PROFILES_KEY,
    FALLBACK_ENDPOINTS_KEY,
    TOKENS_KEY,
    DEVICE_ID_STORAGE_KEY,
  ]);
  getOrCreatePersistentDeviceId();
}

export function getFallbackEndpoints(): StoredFallbackEndpoint[] {
  try {
    const raw = localStorage.getItem(FALLBACK_ENDPOINTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveFallbackEndpointsAsync(list: StoredFallbackEndpoint[]): Promise<void> {
  try {
    await setPref(FALLBACK_ENDPOINTS_KEY, JSON.stringify(list || []));
  } catch {
    // ignore
  }
}

export function saveFallbackEndpoints(list: StoredFallbackEndpoint[]): void {
  saveFallbackEndpointsAsync(list).catch(() => {});
}

function isLocalOrIpHost(hostOrUrl: string): boolean {
  const cleanHost = hostOrUrl
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .trim()
    .toLowerCase();
  if (!cleanHost) return true;
  if (cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '10.0.2.2') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleanHost)) return true;
  return false;
}

export function normalizeServerUrl(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return isLocalOrIpHost(trimmed) ? `http://${trimmed}` : `https://${trimmed}`;
}

export function getDefaultConnectionProfiles(): ConnectionProfilesConfig {
  return {
    activeMode: 'local_network',
    localNetwork: {
      ip: '192.168.1.100',
      port: 3000,
      hostname: 'awlad-selim-server',
    },
    freeRemote: {
      tunnelUrl: '',
    },
    proRemote: {
      domainUrl: '',
    },
    cloudVps: {
      vpsUrl: '',
      notes: '',
    },
    enforceHttpsForRemote: true,
  };
}

export function getStoredConnectionProfiles(): ConnectionProfilesConfig {
  const defaults = getDefaultConnectionProfiles();
  try {
    const raw = localStorage.getItem(CONNECTION_PROFILES_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    return {
      ...defaults,
      ...parsed,
      localNetwork: {
        ...defaults.localNetwork,
        ...(parsed.localNetwork || {}),
        port: Number(parsed.localNetwork?.port || 3000) || 3000,
      },
      freeRemote: {
        ...defaults.freeRemote,
        ...(parsed.freeRemote || {}),
      },
      proRemote: {
        ...defaults.proRemote,
        ...(parsed.proRemote || {}),
      },
      cloudVps: {
        ...defaults.cloudVps,
        ...(parsed.cloudVps || {}),
      },
      enforceHttpsForRemote: parsed.enforceHttpsForRemote !== false,
    };
  } catch {
    return defaults;
  }
}

export async function saveStoredConnectionProfilesAsync(config: ConnectionProfilesConfig): Promise<void> {
  try {
    await setPref(CONNECTION_PROFILES_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

export function saveStoredConnectionProfiles(config: ConnectionProfilesConfig): void {
  saveStoredConnectionProfilesAsync(config).catch(() => {});
}

export function resolveModeEndpointUrl(
  mode: ConnectionMode,
  profiles: ConnectionProfilesConfig
): string {
  if (mode === 'local_network') {
    const rawIp = (profiles.localNetwork?.ip || '').trim();
    if (!rawIp) return '';
    if (/^https?:\/\//i.test(rawIp)) {
      return normalizeServerUrl(rawIp);
    }
    const cleanHost = rawIp.split('/')[0].split(':')[0];
    const port = Number(profiles.localNetwork?.port || 3000) || 3000;
    return `http://${cleanHost}:${port}`;
  }
  if (mode === 'free_remote') {
    return normalizeServerUrl(profiles.freeRemote?.tunnelUrl || '');
  }
  if (mode === 'pro_remote') {
    return normalizeServerUrl(profiles.proRemote?.domainUrl || '');
  }
  if (mode === 'cloud_vps') {
    return normalizeServerUrl(profiles.cloudVps?.vpsUrl || '');
  }
  return '';
}

function isInvalidPartialIpv4(hostname: string): boolean {
  if (!/^[\d.]+$/.test(hostname)) return false;
  const parts = hostname.split('.');
  if (parts.length !== 4) return true;
  return parts.some((part) => {
    if (!/^\d{1,3}$/.test(part)) return true;
    const num = Number(part);
    return !Number.isInteger(num) || num < 0 || num > 255;
  });
}

export function validateConnectionUrl(
  mode: ConnectionMode,
  rawUrl: string,
  enforceHttpsForRemote = true
): { valid: boolean; normalizedUrl: string; error?: string } {
  const trimmedRaw = String(rawUrl || '').trim();
  if (!trimmedRaw) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'يرجى إدخال عنوان السيرفر أولاً.',
    };
  }
  if (/\s/.test(trimmedRaw)) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'عنوان السيرفر يحتوي على مسافات غير صالحة.',
    };
  }
  const normalizedUrl = normalizeServerUrl(trimmedRaw);
  if (!normalizedUrl) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'يرجى إدخال عنوان السيرفر أولاً.',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return {
      valid: false,
      normalizedUrl,
      error: 'صيغة عنوان السيرفر غير صالحة. تأكد من كتابة الرابط بشكل صحيح.',
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      normalizedUrl,
      error: 'يجب أن يبدأ عنوان السيرفر ببروتوكول http:// أو https:// فقط.',
    };
  }
  const rawHostCandidate = normalizedUrl
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .trim();
  if (!parsed.hostname || isInvalidPartialIpv4(rawHostCandidate) || isInvalidPartialIpv4(parsed.hostname)) {
    return {
      valid: false,
      normalizedUrl,
      error: 'عنوان المضيف أو الـ IP غير مكتمل أو غير صالح.',
    };
  }
  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return {
        valid: false,
        normalizedUrl,
        error: 'رقم المنفذ (Port) يجب أن يكون بين 1 و 65535.',
      };
    }
  }
  if (mode !== 'local_network') {
    if (enforceHttpsForRemote && parsed.protocol !== 'https:') {
      return {
        valid: false,
        normalizedUrl,
        error: 'الاتصالات الخارجية تتطلب بروتوكول HTTPS المشفر لحماية البيانات والتوكنات.',
      };
    }
    const hostLower = parsed.hostname.toLowerCase();
    if (
      hostLower === 'localhost' ||
      hostLower === '127.0.0.1' ||
      hostLower === '10.0.2.2' ||
      !hostLower.includes('.') ||
      hostLower.startsWith('.') ||
      hostLower.endsWith('.') ||
      hostLower.includes('..')
    ) {
      return {
        valid: false,
        normalizedUrl,
        error: 'يجب إدخال دومين أو عنوان خارجي صالح لوضع الاتصال البعيد.',
      };
    }
  }
  return {
    valid: true,
    normalizedUrl: parsed.origin + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : ''),
  };
}

export function resolvePairingEndpointForMode(options: {
  selectedMode: 'auto' | ConnectionMode;
  activeMode: ConnectionMode;
  profiles?: ConnectionProfilesConfig;
  activeEndpoint?: string;
}): { effectiveMode: ConnectionMode; endpointUrl: string } {
  const effectiveMode: ConnectionMode =
    options.selectedMode === 'auto' ? options.activeMode : options.selectedMode;
  const profileUrl = options.profiles
    ? resolveModeEndpointUrl(effectiveMode, options.profiles)
    : '';
  const endpointUrl =
    profileUrl ||
    (options.selectedMode === 'auto' || effectiveMode === options.activeMode
      ? normalizeServerUrl(options.activeEndpoint || '')
      : '');
  return { effectiveMode, endpointUrl };
}

export function getConnectionModeLabel(mode?: string): string {
  switch (mode) {
    case 'local_network':
    case 'lan':
      return 'الشبكة المحلية (Local Network)';
    case 'free_remote':
      return 'الاتصال الخارجي المجاني (Quick Tunnel)';
    case 'pro_remote':
    case 'reverse_proxy':
    case 'vpn':
      return 'الاتصال الاحترافي (Named Tunnel + HTTPS)';
    case 'cloud_vps':
      return 'السيرفر السحابي الدائم (Cloud VPS)';
    case 'offline_local':
      return 'وضع عدم الاتصال (Offline Cache)';
    default:
      return 'الشبكة المحلية (Local Network)';
  }
}

export function detectModeFromUrl(
  url: string,
  profiles?: ConnectionProfilesConfig
): ConnectionMode {
  const normalized = normalizeServerUrl(url);
  if (!normalized) return profiles?.activeMode || 'local_network';
  if (profiles) {
    if (normalizeServerUrl(profiles.cloudVps?.vpsUrl || '') === normalized) return 'cloud_vps';
    if (normalizeServerUrl(profiles.proRemote?.domainUrl || '') === normalized) return 'pro_remote';
    if (normalizeServerUrl(profiles.freeRemote?.tunnelUrl || '') === normalized) return 'free_remote';
    if (resolveModeEndpointUrl('local_network', profiles) === normalized) return 'local_network';
  }
  if (/trycloudflare\.com/i.test(normalized)) return 'free_remote';
  if (isLocalOrIpHost(normalized)) return 'local_network';
  return 'pro_remote';
}

export function getStoredTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.accessToken && parsed?.refreshToken) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function saveStoredTokensAsync(tokens: StoredTokens | null): Promise<void> {
  try {
    if (!tokens) {
      await removePref(TOKENS_KEY);
    } else {
      await setPref(TOKENS_KEY, JSON.stringify(tokens));
    }
  } catch {
    // ignore storage quota errors
  }
}

export function saveStoredTokens(tokens: StoredTokens | null): void {
  saveStoredTokensAsync(tokens).catch(() => {});
}

export function getConfiguredApiBaseUrl(): string {
  try {
    const custom = localStorage.getItem(SERVER_URL_KEY)?.trim() || '';
    if (custom) {
      return normalizeServerUrl(custom);
    }
  } catch {
    // ignore
  }
  const envBase = (import.meta as any).env?.VITE_API_BASE_URL;
  if (typeof envBase === 'string' && envBase.trim()) {
    return normalizeServerUrl(envBase);
  }
  // Inside native Capacitor shell there is no same-origin Express backend on capacitor://localhost
  if (isNativeCapacitor()) {
    return '';
  }
  // Same-origin by default on web / Electron
  return '';
}

export function hasConfiguredServerUrl(): boolean {
  if (!isNativeCapacitor()) return true;
  return Boolean(getConfiguredApiBaseUrl());
}

export async function setConfiguredApiBaseUrlAsync(url: string): Promise<void> {
  const clean = normalizeServerUrl(url);
  if (!clean) {
    await removePref(SERVER_URL_KEY);
  } else {
    await setPref(SERVER_URL_KEY, clean);
  }
}

export function setConfiguredApiBaseUrl(url: string): void {
  setConfiguredApiBaseUrlAsync(url).catch(() => {});
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error('Request timeout');
      err.name = 'AbortError';
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function testServerHealth(baseUrl: string): Promise<{
  ok: boolean;
  latencyMs: number;
  mode?: string;
  version?: string;
  lanUrls?: string[];
  protocol?: string;
  httpsActive?: boolean;
  connectionModesSupported?: string[];
  error?: string;
}> {
  const clean = normalizeServerUrl(baseUrl);
  const effectiveBase = clean || (!isNativeCapacitor() ? '' : '');
  if (isNativeCapacitor() && !clean) {
    return {
      ok: false,
      latencyMs: 0,
      error: 'يرجى إدخال عنوان السيرفر المركزي أولاً (مثل http://192.168.1.100:3000 أو رابط HTTPS).',
    };
  }

  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const res = await fetchWithTimeout(`${effectiveBase}/api/health`, { method: 'GET' }, 7000);
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
    if (!res.ok) {
      return { ok: false, latencyMs, error: `السيرفر استجاب برمز خطأ (${res.status})` };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      latencyMs,
      mode: data?.mode || 'central-server',
      version: data?.version,
      lanUrls: Array.isArray(data?.lanUrls) ? data.lanUrls : [],
      protocol: data?.protocol,
      httpsActive: Boolean(data?.httpsActive || /^https:\/\//i.test(effectiveBase)),
      connectionModesSupported: Array.isArray(data?.connectionModesSupported)
        ? data.connectionModesSupported
        : undefined,
    };
  } catch (err: any) {
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
    return {
      ok: false,
      latencyMs,
      error:
        err?.name === 'AbortError'
          ? 'انتهت مهلة الاتصال بالسيرفر (7 ثوانٍ) — تأكد من عنوان السيرفر وتشغيل النفق أو الشبكة.'
          : 'تعذر الوصول إلى السيرفر المركزي. تأكد من تشغيل البرنامج على اللابتوب ومن رابط الاتصال.',
    };
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = 'API_ERROR', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshPromise: Promise<StoredTokens | null> | null = null;

async function refreshAccessToken(): Promise<StoredTokens | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const current = getStoredTokens();
    if (!current?.refreshToken) return null;
    try {
      const base = getConfiguredApiBaseUrl();
      if (isNativeCapacitor() && !base) return null;
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': getOrCreatePersistentDeviceId(),
        },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        saveStoredTokens(null);
        return null;
      }
      const data = await res.json();
      if (data?.ok && data.accessToken && data.refreshToken) {
        const nextTokens = { accessToken: data.accessToken, refreshToken: data.refreshToken };
        saveStoredTokens(nextTokens);
        return nextTokens;
      }
      saveStoredTokens(null);
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiRequest<T = any>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    idempotencyKey?: string;
    skipAuth?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const method = options.method || 'GET';
  const base = getConfiguredApiBaseUrl();

  if (isNativeCapacitor() && !base) {
    throw new ApiError(
      0,
      'لم يتم تحديد عنوان السيرفر المركزي (لابتوب المحل) بعد. يرجى ضبط عنوان السيرفر أولاً أو مسح رمز QR.',
      'SERVER_URL_NOT_CONFIGURED'
    );
  }

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  const buildHeaders = (accessToken?: string): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-Id': getOrCreatePersistentDeviceId(),
    };
    if (accessToken && !options.skipAuth) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    return headers;
  };

  const executeFetch = async (token?: string) => {
    try {
      return await fetchWithTimeout(
        url,
        {
          method,
          headers: buildHeaders(token),
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        },
        options.timeoutMs || 20000
      );
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new ApiError(0, 'انتهت مهلة الاتصال بالسيرفر، يرجى المحاولة مرة أخرى', 'TIMEOUT');
      }
      throw new ApiError(0, 'تعذر الاتصال بالسيرفر، تحقق من الشبكة أو تشغيل الخادم', 'NETWORK_ERROR');
    }
  };

  const tokens = getStoredTokens();
  let res = await executeFetch(tokens?.accessToken);

  if (res.status === 401 && !options.skipAuth) {
    if (tokens?.refreshToken) {
      const refreshed = await refreshAccessToken();
      if (refreshed?.accessToken) {
        res = await executeFetch(refreshed.accessToken);
      }
    }
    if (res.status === 401) {
      saveStoredTokens(null);
      if (onAuthExpiredHandler) {
        onAuthExpiredHandler('انتهت صلاحية جلسة الدخول، يرجى تسجيل الدخول مجدداً.');
      }
    }
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (res.status === 403 && json?.code === 'DEVICE_REVOKED' && !options.skipAuth) {
    saveStoredTokens(null);
    if (onAuthExpiredHandler) {
      onAuthExpiredHandler(json?.error || 'تم إلغاء ربط هذا الجهاز من قِبل الإدارة.');
    }
  }

  if (!res.ok || (json && json.ok === false)) {
    const message = json?.error || `خطأ في الاستجابة (${res.status})`;
    const code = json?.code || `HTTP_${res.status}`;
    throw new ApiError(res.status, message, code, json?.details);
  }

  return (json ?? {}) as T;
}

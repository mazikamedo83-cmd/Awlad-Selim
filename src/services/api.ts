import {
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

type AuthExpiredCallback = (message?: string) => void;
let onAuthExpiredHandler: AuthExpiredCallback | null = null;

export function setAuthExpiredHandler(cb: AuthExpiredCallback | null): void {
  onAuthExpiredHandler = cb;
}

export function triggerAuthExpired(message = 'انتهت صلاحية جلسة الدخول، يرجى تسجيل الدخول مجدداً.'): void {
  saveStoredTokens(null);
  if (onAuthExpiredHandler) {
    onAuthExpiredHandler(message);
  }
}

export async function hydrateServerUrlFromNative(): Promise<void> {
  await hydrateNativePreferences([SERVER_URL_KEY, TOKENS_KEY, CONNECTION_PROFILES_KEY, FALLBACK_ENDPOINTS_KEY]);
}

export function normalizeServerUrl(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
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

export function saveStoredTokens(tokens: StoredTokens | null): void {
  try {
    if (!tokens) {
      removePref(TOKENS_KEY).catch(() => {});
    } else {
      setPref(TOKENS_KEY, JSON.stringify(tokens)).catch(() => {});
    }
  } catch {
    // ignore storage quota errors
  }
}

export async function saveStoredTokensAsync(tokens: StoredTokens | null): Promise<void> {
  if (!tokens) {
    await removePref(TOKENS_KEY);
  } else {
    await setPref(TOKENS_KEY, JSON.stringify(tokens));
  }
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

export function setConfiguredApiBaseUrl(url: string): void {
  const clean = normalizeServerUrl(url);
  if (!clean) {
    removePref(SERVER_URL_KEY).catch(() => {});
  } else {
    setPref(SERVER_URL_KEY, clean).catch(() => {});
  }
}

export async function setConfiguredApiBaseUrlAsync(url: string): Promise<void> {
  const clean = normalizeServerUrl(url);
  if (!clean) {
    await removePref(SERVER_URL_KEY);
  } else {
    await setPref(SERVER_URL_KEY, clean);
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function getConnectionModeLabel(mode?: string): string {
  switch (mode) {
    case 'local_network':
      return 'الشبكة المحلية (LAN)';
    case 'free_remote':
      return 'نفق مجاني (Quick Tunnel)';
    case 'pro_remote':
      return 'دومين احترافي (HTTPS)';
    case 'cloud_vps':
      return 'سيرفر سحابي (Cloud VPS)';
    case 'auto':
      return 'الوضع التلقائي النشط';
    default:
      return mode || 'اتصال بالسيرفر';
  }
}

export function getStoredConnectionProfiles(): ConnectionProfilesConfig {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CONNECTION_PROFILES_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // ignore
  }
  return {
    activeMode: 'local_network',
    configVersion: 1,
    localNetwork: { ip: '192.168.1.100', port: 3000, hostname: 'awlad-selim-server' },
    freeRemote: { tunnelUrl: '', autoDetect: true },
    proRemote: { domainUrl: '', provider: 'cloudflare_named_tunnel' },
    cloudVps: { vpsUrl: '', notes: '' },
    enforceHttpsForRemote: true,
  };
}

export function saveStoredConnectionProfiles(profiles: ConnectionProfilesConfig): void {
  try {
    setPref(CONNECTION_PROFILES_KEY, JSON.stringify(profiles || {})).catch(() => {});
  } catch {
    // ignore
  }
}

export async function saveStoredConnectionProfilesAsync(profiles: ConnectionProfilesConfig): Promise<void> {
  await setPref(CONNECTION_PROFILES_KEY, JSON.stringify(profiles || {}));
}

export function getFallbackEndpoints(): Array<{ mode: ConnectionMode; url: string; label: string }> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(FALLBACK_ENDPOINTS_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveFallbackEndpoints(list: Array<{ mode: ConnectionMode; url: string; label: string }>): void {
  try {
    setPref(FALLBACK_ENDPOINTS_KEY, JSON.stringify(Array.isArray(list) ? list : [])).catch(() => {});
  } catch {
    // ignore
  }
}

export async function saveFallbackEndpointsAsync(
  list: Array<{ mode: ConnectionMode; url: string; label: string }>
): Promise<void> {
  await setPref(FALLBACK_ENDPOINTS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

export function resolveModeEndpointUrl(mode: ConnectionMode | string, profiles?: ConnectionProfilesConfig): string {
  if (!profiles) return '';
  if (mode === 'local_network') {
    const ip = String(profiles.localNetwork?.ip || '').trim();
    const port = Number(profiles.localNetwork?.port || 3000) || 3000;
    return ip ? `http://${ip}:${port}` : '';
  }
  if (mode === 'free_remote') return String(profiles.freeRemote?.tunnelUrl || '').trim().replace(/\/+$/, '');
  if (mode === 'pro_remote') return String(profiles.proRemote?.domainUrl || '').trim().replace(/\/+$/, '');
  if (mode === 'cloud_vps') return String(profiles.cloudVps?.vpsUrl || '').trim().replace(/\/+$/, '');
  return '';
}

export function resolvePairingEndpointForMode(params: {
  selectedMode: 'auto' | ConnectionMode;
  activeMode: ConnectionMode;
  profiles?: ConnectionProfilesConfig;
  activeEndpoint?: string;
}): { effectiveMode: ConnectionMode; endpointUrl: string } {
  const effectiveMode: ConnectionMode =
    params.selectedMode === 'auto' ? params.activeMode : params.selectedMode;
  const fromProfile = resolveModeEndpointUrl(effectiveMode, params.profiles);
  if (fromProfile) {
    return { effectiveMode, endpointUrl: fromProfile };
  }
  // Only fall back to activeEndpoint when 'auto' is selected or when selectedMode literally equals activeMode
  if (params.selectedMode === 'auto' && params.activeEndpoint) {
    return { effectiveMode, endpointUrl: String(params.activeEndpoint).trim().replace(/\/+$/, '') };
  }
  return { effectiveMode, endpointUrl: '' };
}

export function validateConnectionUrl(
  mode: ConnectionMode | string,
  rawUrl: string,
  enforceHttpsForRemote = true
): { valid: boolean; normalizedUrl?: string; error?: string } {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed || /\s/.test(trimmed)) {
    return { valid: false, error: 'عنوان السيرفر غير مكتمل أو يحتوي على مسافات.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'صيغة رابط السيرفر غير صالحة.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'يجب أن يبدأ الرابط بـ http:// أو https:// فقط.' };
  }
  if (!parsed.hostname) {
    return { valid: false, error: 'الرابط لا يحتوي على اسم مضيف أو IP صالح.' };
  }
  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return { valid: false, error: 'رقم المنفذ (Port) غير صالح.' };
    }
  }
  const rawHostCandidate = trimmed
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .trim();
  for (const hostToCheck of [rawHostCandidate, parsed.hostname]) {
    if (/^[\d.]+$/.test(hostToCheck)) {
      const octets = hostToCheck.split('.');
      if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255)) {
        return { valid: false, error: 'عنوان IP للسيرفر غير مكتمل أو خارج النطاق (0-255).' };
      }
    }
  }
  if (mode !== 'local_network') {
    if (enforceHttpsForRemote && parsed.protocol !== 'https:') {
      return { valid: false, error: 'أوضاع الاتصال البعيد تتطلب رابط HTTPS مشفر.' };
    }
    const hostLower = parsed.hostname.toLowerCase();
    if (
      hostLower === 'localhost' ||
      hostLower === '127.0.0.1' ||
      hostLower === '10.0.2.2' ||
      !hostLower.includes('.') ||
      hostLower.includes('..')
    ) {
      return { valid: false, error: 'يجب إدخال دومين خارجي صالح لوضع الاتصال البعيد.' };
    }
  }
  const normalizedUrl =
    parsed.origin + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '');
  return { valid: true, normalizedUrl };
}

export function detectModeFromUrl(url: string, profiles?: ConnectionProfilesConfig): ConnectionMode {
  const clean = normalizeServerUrl(url || '');
  if (!clean) return profiles?.activeMode || 'local_network';
  if (profiles?.cloudVps?.vpsUrl && normalizeServerUrl(profiles.cloudVps.vpsUrl) === clean) return 'cloud_vps';
  if (profiles?.proRemote?.domainUrl && normalizeServerUrl(profiles.proRemote.domainUrl) === clean) return 'pro_remote';
  if (profiles?.freeRemote?.tunnelUrl && normalizeServerUrl(profiles.freeRemote.tunnelUrl) === clean) return 'free_remote';
  if (/trycloudflare\.com/i.test(clean)) return 'free_remote';
  if (/^http:\/\/(\d{1,3}\.){3}\d{1,3}/i.test(clean) || /^http:\/\/(localhost|127\.0\.0\.1)/i.test(clean)) {
    return 'local_network';
  }
  return profiles?.activeMode || 'pro_remote';
}

export async function testServerHealth(baseUrl: string): Promise<{
  ok: boolean;
  latencyMs: number;
  mode?: string;
  activeMode?: ConnectionMode;
  companyName?: string;
  version?: string;
  lanUrls?: string[];
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${effectiveBase}/api/connection/discovery`, {
      method: 'GET',
      signal: controller.signal,
    });
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
    if (!res.ok) {
      return { ok: false, latencyMs, error: `السيرفر استجاب برمز خطأ (${res.status})` };
    }
    const data = await res.json().catch(() => null);
    if (!data?.ok || data?.service !== 'AWLAD SELIM Enterprise Server') {
      return {
        ok: false,
        latencyMs,
        error: 'الخادم الذي استجاب ليس خادم نظام AWLAD SELIM المركزي.',
      };
    }
    return {
      ok: true,
      latencyMs,
      mode: data?.activeMode || 'central-server',
      activeMode: data?.activeMode,
      companyName: data?.companyName,
      version: data?.version,
      lanUrls: Array.isArray(data?.lanUrls) ? data.lanUrls : [],
    };
  } catch (err: any) {
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
    return {
      ok: false,
      latencyMs,
      error:
        err?.name === 'AbortError'
          ? 'انتهت مهلة الاتصال بالسيرفر (6 ثوانٍ) — تأكد من عنوان السيرفر وشبكة الواي فاي.'
          : 'تعذر الوصول إلى السيرفر المركزي أو فشل التحقق من شهادة الأمان. تأكد من تشغيل البرنامج على اللابتوب.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function testEndpointViaServer(
  mode: ConnectionMode | string,
  url: string,
  enforceHttps = true
): Promise<{
  ok: boolean;
  valid: boolean;
  reachable: boolean;
  url: string;
  latencyMs: number;
  companyName?: string;
  activeMode?: ConnectionMode;
  version?: string;
  httpsVerified?: boolean;
}> {
  return apiRequest('/api/admin/connection/test-endpoint', {
    method: 'POST',
    body: { mode, url, enforceHttps },
    timeoutMs: 8000,
  });
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
      'لم يتم تحديد عنوان السيرفر المركزي (لابتوب المحل) بعد. يرجى ضبط عنوان السيرفر أولاً.',
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
    try {
      return await fetch(url, {
        method,
        headers: buildHeaders(token),
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new ApiError(0, 'انتهت مهلة الاتصال بالسيرفر، يرجى المحاولة مرة أخرى', 'TIMEOUT');
      }
      throw new ApiError(0, 'تعذر الاتصال بالسيرفر، تحقق من الشبكة أو تشغيل الخادم', 'NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
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

  if (!res.ok || (json && json.ok === false)) {
    const message = json?.error || `خطأ في الاستجابة (${res.status})`;
    const code = json?.code || `HTTP_${res.status}`;
    if (
      res.status === 403 &&
      !options.skipAuth &&
      ['DEVICE_REVOKED', 'DEVICE_REJECTED', 'DEVICE_DISCONNECTED', 'DEVICE_PENDING_APPROVAL'].includes(code)
    ) {
      triggerAuthExpired(message);
    }
    throw new ApiError(res.status, message, code, json?.details);
  }

  return (json ?? {}) as T;
}

import {
  DEVICE_ID_STORAGE_KEY,
  getOrCreatePersistentDeviceId,
  hydrateNativePreferences,
  isNativeCapacitor,
  removePref,
  setPref,
} from './native';
import type { ConnectionMode, ConnectionProfilesConfig } from '../types';
import { logDiagnostic } from './diagnostics';

const TOKENS_KEY = 'awlad_selim_auth_tokens_v3';
const SERVER_URL_KEY = 'awlad_selim_server_base_url';
const CONNECTION_PROFILES_KEY = 'awlad_selim_connection_profiles_v1';
const FALLBACK_ENDPOINTS_KEY = 'awlad_selim_fallback_endpoints_v1';
const INSTALLATION_ID_KEY = 'awlad_selim_server_installation_id_v1';

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

export const DEFAULT_DB_UNAVAILABLE_MESSAGE =
  'قاعدة البيانات المركزية (PostgreSQL) غير متاحة مؤقتًا. تم إيقاف العمليات لحماية البيانات ومنع انقسامها.';

export function isDatabaseUnavailableError(err: any): boolean {
  const code = String(err?.code || '');
  return err?.status === 503 || code === 'DATABASE_UNAVAILABLE';
}

type ServerDbStatusCallback = (available: boolean, message?: string) => void;
let onServerDbStatusHandler: ServerDbStatusCallback | null = null;
const serverDbStatusListeners = new Set<ServerDbStatusCallback>();

export function setServerDbStatusHandler(cb: ServerDbStatusCallback | null): void {
  onServerDbStatusHandler = cb;
}

export function subscribeServerDbStatus(cb: ServerDbStatusCallback): () => void {
  serverDbStatusListeners.add(cb);
  return () => {
    serverDbStatusListeners.delete(cb);
  };
}

function notifyServerDbStatus(available: boolean, message?: string): void {
  if (onServerDbStatusHandler) {
    onServerDbStatusHandler(available, message);
  }
  for (const listener of serverDbStatusListeners) {
    try {
      listener(available, message);
    } catch {
      // ignore listener errors
    }
  }
}

export async function hydrateServerUrlFromNative(): Promise<void> {
  await hydrateNativePreferences([
    SERVER_URL_KEY,
    CONNECTION_PROFILES_KEY,
    FALLBACK_ENDPOINTS_KEY,
    TOKENS_KEY,
    DEVICE_ID_STORAGE_KEY,
    INSTALLATION_ID_KEY,
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

function isPrivateOrLoopbackIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b, c, d] = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function isLocalOrIpHost(hostOrUrl: string): boolean {
  const cleanHost = hostOrUrl
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .trim()
    .toLowerCase();
  if (!cleanHost) return true;
  if (
    cleanHost === 'localhost' ||
    cleanHost === '127.0.0.1' ||
    cleanHost === '10.0.2.2' ||
    cleanHost === 'awlad-selim-server'
  ) {
    return true;
  }
  if (cleanHost.endsWith('.local')) return true;
  if (isPrivateOrLoopbackIpv4(cleanHost)) return true;
  return false;
}

function assertSafeHttpTransport(baseUrl: string): void {
  if (!baseUrl) return;
  if (/^http:\/\//i.test(baseUrl) && !isLocalOrIpHost(baseUrl)) {
    const profiles = getStoredConnectionProfiles();
    if (profiles.enforceHttpsForRemote !== false) {
      throw new ApiError(
        400,
        'يُمنع الاتصال غير المشفر (HTTP) خارج الشبكة المحلية. يرجى استخدام رابط HTTPS آمن.',
        'HTTPS_REQUIRED_FOR_REMOTE'
      );
    }
  }
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
  const enforceHttps = options.profiles?.enforceHttpsForRemote !== false;

  if (options.selectedMode !== 'auto') {
    const effectiveMode: ConnectionMode = options.selectedMode;
    const profileUrl = options.profiles
      ? resolveModeEndpointUrl(effectiveMode, options.profiles)
      : '';
    return {
      effectiveMode,
      endpointUrl: normalizeServerUrl(profileUrl),
    };
  }

  // Auto mode: prefer activeMode's configured URL (or activeEndpoint if valid for activeMode),
  // then fall back to any other valid configured profile in priority order.
  const activeProfileUrl = options.profiles
    ? resolveModeEndpointUrl(options.activeMode, options.profiles)
    : '';
  const activeFallbackUrl = normalizeServerUrl(options.activeEndpoint || '');

  if (activeProfileUrl) {
    const check = validateConnectionUrl(options.activeMode, activeProfileUrl, enforceHttps);
    if (check.valid) {
      return { effectiveMode: options.activeMode, endpointUrl: check.normalizedUrl };
    }
  }
  if (activeFallbackUrl) {
    const check = validateConnectionUrl(options.activeMode, activeFallbackUrl, enforceHttps);
    if (check.valid) {
      return { effectiveMode: options.activeMode, endpointUrl: check.normalizedUrl };
    }
  }

  if (options.profiles) {
    const priorityOrder: ConnectionMode[] = ['pro_remote', 'cloud_vps', 'free_remote', 'local_network'];
    for (const candidateMode of priorityOrder) {
      const candidateUrl = resolveModeEndpointUrl(candidateMode, options.profiles);
      if (!candidateUrl) continue;
      const check = validateConnectionUrl(candidateMode, candidateUrl, enforceHttps);
      if (check.valid) {
        return { effectiveMode: candidateMode, endpointUrl: check.normalizedUrl };
      }
    }
  }

  if (activeFallbackUrl) {
    const inferredMode = detectModeFromUrl(activeFallbackUrl, options.profiles);
    const check = validateConnectionUrl(inferredMode, activeFallbackUrl, enforceHttps);
    if (check.valid) {
      return { effectiveMode: inferredMode, endpointUrl: check.normalizedUrl };
    }
  }

  return {
    effectiveMode: options.activeMode,
    endpointUrl: activeProfileUrl || activeFallbackUrl || '',
  };
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

export function getStoredInstallationId(): string {
  try {
    return (localStorage.getItem(INSTALLATION_ID_KEY) || '').trim();
  } catch {
    return '';
  }
}

export async function setStoredInstallationIdAsync(installationId: string): Promise<void> {
  const clean = String(installationId || '').trim();
  try {
    if (!clean) {
      await removePref(INSTALLATION_ID_KEY);
    } else {
      await setPref(INSTALLATION_ID_KEY, clean);
    }
  } catch {
    // ignore storage errors
  }
}

export function setStoredInstallationId(installationId: string): void {
  setStoredInstallationIdAsync(installationId).catch(() => {});
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
  try {
    assertSafeHttpTransport(effectiveBase);
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: 0,
      error: err?.message || 'الاتصالات الخارجية تتطلب HTTPS.',
    };
  }

  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const res = await fetchWithTimeout(`${effectiveBase}/api/health`, { method: 'GET' }, 7000);
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      return {
        ok: false,
        latencyMs,
        mode: data?.mode,
        error: data?.error || data?.postgres?.message || `السيرفر استجاب برمز خطأ (${res.status})`,
      };
    }
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

interface RefreshAttemptResult {
  tokens: StoredTokens | null;
  dbUnavailableError?: ApiError;
  networkError?: ApiError;
  transientError?: ApiError;
  authErrorMessage?: string;
}

let refreshPromise: Promise<RefreshAttemptResult> | null = null;

async function refreshAccessToken(): Promise<RefreshAttemptResult> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const current = getStoredTokens();
    if (!current?.refreshToken) return { tokens: null };
    try {
      const base = getConfiguredApiBaseUrl();
      if (isNativeCapacitor() && !base) return { tokens: null };
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': getOrCreatePersistentDeviceId(),
        },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 503 || data?.code === 'DATABASE_UNAVAILABLE') {
        const message = data?.error || DEFAULT_DB_UNAVAILABLE_MESSAGE;
        notifyServerDbStatus(false, message);
        logDiagnostic({
          category: 'network_error',
          severity: 'error',
          source: 'api.refreshAccessToken',
          message,
          details: { status: 503, code: 'DATABASE_UNAVAILABLE' },
        });
        return {
          tokens: null,
          dbUnavailableError: new ApiError(503, message, 'DATABASE_UNAVAILABLE', data?.details),
        };
      }
      if (!res.ok) {
        if (res.status >= 500) {
          logDiagnostic({
            category: 'network_error',
            severity: 'error',
            source: 'api.refreshAccessToken',
            message: data?.error || `خطأ مؤقت في الخادم (${res.status})`,
            details: { status: res.status, code: data?.code },
          });
          return {
            tokens: null,
            transientError: new ApiError(
              res.status,
              data?.error || `خطأ مؤقت في الخادم (${res.status})`,
              data?.code || `HTTP_${res.status}`,
              data?.details
            ),
          };
        }
        saveStoredTokens(null);
        logDiagnostic({
          category: 'auth',
          severity: 'warning',
          source: 'api.refreshAccessToken',
          message: data?.error || 'تعذر تجديد جلسة المصادقة',
          details: { status: res.status, code: data?.code },
        });
        return { tokens: null, authErrorMessage: data?.error };
      }
      if (data?.ok && data.accessToken && data.refreshToken) {
        const nextTokens = { accessToken: data.accessToken, refreshToken: data.refreshToken };
        saveStoredTokens(nextTokens);
        return { tokens: nextTokens };
      }
      saveStoredTokens(null);
      return { tokens: null };
    } catch {
      return {
        tokens: null,
        networkError: new ApiError(0, 'تعذر الاتصال بالسيرفر، تحقق من الشبكة أو تشغيل الخادم', 'NETWORK_ERROR'),
      };
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
    const err = new ApiError(
      0,
      'لم يتم تحديد عنوان السيرفر المركزي (لابتوب المحل) بعد. يرجى ضبط عنوان السيرفر أولاً أو مسح رمز QR.',
      'SERVER_URL_NOT_CONFIGURED'
    );
    logDiagnostic({
      category: 'network_error',
      severity: 'warning',
      source: `api.${method}`,
      message: err.message,
      details: { path, code: err.code },
    });
    throw err;
  }
  assertSafeHttpTransport(base);

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
        logDiagnostic({
          category: 'network_error',
          severity: 'error',
          source: `api.${method}`,
          message: 'انتهت مهلة الاتصال بالسيرفر، يرجى المحاولة مرة أخرى',
          details: { path, code: 'TIMEOUT', timeoutMs: options.timeoutMs || 20000 },
        });
        throw new ApiError(0, 'انتهت مهلة الاتصال بالسيرفر، يرجى المحاولة مرة أخرى', 'TIMEOUT');
      }
      logDiagnostic({
        category: 'network_error',
        severity: 'error',
        source: `api.${method}`,
        message: 'تعذر الاتصال بالسيرفر، تحقق من الشبكة أو تشغيل الخادم',
        details: { path, code: 'NETWORK_ERROR' },
      });
      throw new ApiError(0, 'تعذر الاتصال بالسيرفر، تحقق من الشبكة أو تشغيل الخادم', 'NETWORK_ERROR');
    }
  };

  const tokens = getStoredTokens();
  let res = await executeFetch(tokens?.accessToken);

  let refreshAuthErrorMessage: string | undefined;
  if (res.status === 401 && !options.skipAuth) {
    if (tokens?.refreshToken) {
      const refreshOutcome = await refreshAccessToken();
      if (refreshOutcome.dbUnavailableError) {
        throw refreshOutcome.dbUnavailableError;
      }
      if (refreshOutcome.networkError) {
        throw refreshOutcome.networkError;
      }
      if (refreshOutcome.transientError) {
        throw refreshOutcome.transientError;
      }
      if (refreshOutcome.tokens?.accessToken) {
        res = await executeFetch(refreshOutcome.tokens.accessToken);
      } else {
        refreshAuthErrorMessage = refreshOutcome.authErrorMessage;
      }
    }
    if (res.status === 401) {
      saveStoredTokens(null);
      if (onAuthExpiredHandler) {
        onAuthExpiredHandler(
          refreshAuthErrorMessage || 'انتهت صلاحية جلسة الدخول، يرجى تسجيل الدخول مجدداً.'
        );
      }
    }
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (
    res.status === 403 &&
    (json?.code === 'DEVICE_REVOKED' ||
      json?.code === 'ACCOUNT_DEACTIVATED' ||
      json?.code === 'ACCOUNT_SUSPENDED') &&
    !options.skipAuth
  ) {
    saveStoredTokens(null);
    if (onAuthExpiredHandler) {
      onAuthExpiredHandler(json?.error || 'تم إلغاء ربط هذا الجهاز من قِبل الإدارة.');
    }
  }

  if (!res.ok || (json && json.ok === false)) {
    const isDb503 = res.status === 503 || json?.code === 'DATABASE_UNAVAILABLE';
    const message =
      json?.error || (isDb503 ? DEFAULT_DB_UNAVAILABLE_MESSAGE : `خطأ في الاستجابة (${res.status})`);
    const code = json?.code || (isDb503 ? 'DATABASE_UNAVAILABLE' : `HTTP_${res.status}`);
    if (isDb503) {
      notifyServerDbStatus(false, message);
    }
    logDiagnostic({
      category:
        code === 'DEVICE_REVOKED' ||
        code === 'ACCOUNT_DEACTIVATED' ||
        code === 'ACCOUNT_SUSPENDED' ||
        code === 'SESSION_REVOKED' ||
        res.status === 401
          ? 'auth'
          : 'network_error',
      severity: res.status >= 500 || isDb503 ? 'error' : 'warning',
      source: `api.${method}`,
      message,
      details: { path, status: res.status, code },
    });
    throw new ApiError(res.status, message, code, json?.details);
  }

  notifyServerDbStatus(true);

  return (json ?? {}) as T;
}

export async function fetchComprehensiveReport(params: Record<string, string | undefined>): Promise<import('../types').ComprehensiveReportResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== 'all') {
      qs.set(k, v);
    } else if (k === 'reportType' && v) {
      qs.set(k, v);
    }
  }
  const res = await apiRequest<{ ok: boolean; report: import('../types').ComprehensiveReportResponse }>(
    `/api/reports/comprehensive?${qs.toString()}`
  );
  return res.report;
}

export async function fetchReportSourceDocument(docType: string, docId: string): Promise<import('../types').ReportSourceDocumentResponse> {
  const qs = new URLSearchParams({ docType, docId });
  return apiRequest<import('../types').ReportSourceDocumentResponse>(`/api/reports/source-document?${qs.toString()}`);
}


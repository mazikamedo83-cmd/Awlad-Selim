import {
  hydrateNativePreferences,
  isNativeCapacitor,
  removePref,
  setPref,
} from './native';

const TOKENS_KEY = 'awlad_selim_auth_tokens_v3';
const SERVER_URL_KEY = 'awlad_selim_server_base_url';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

type AuthExpiredCallback = (message?: string) => void;
let onAuthExpiredHandler: AuthExpiredCallback | null = null;

export function setAuthExpiredHandler(cb: AuthExpiredCallback | null): void {
  onAuthExpiredHandler = cb;
}

export async function hydrateServerUrlFromNative(): Promise<void> {
  await hydrateNativePreferences([SERVER_URL_KEY, TOKENS_KEY]);
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

export async function testServerHealth(baseUrl: string): Promise<{
  ok: boolean;
  latencyMs: number;
  mode?: string;
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
    const res = await fetch(`${effectiveBase}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
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
    };
  } catch (err: any) {
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
    return {
      ok: false,
      latencyMs,
      error:
        err?.name === 'AbortError'
          ? 'انتهت مهلة الاتصال بالسيرفر (6 ثوانٍ) — تأكد من عنوان السيرفر وشبكة الواي فاي.'
          : 'تعذر الوصول إلى السيرفر المركزي. تأكد من تشغيل البرنامج على اللابتوب ومن فتح المنفذ 3000.',
    };
  } finally {
    clearTimeout(timer);
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
        headers: { 'Content-Type': 'application/json' },
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
    throw new ApiError(res.status, message, code, json?.details);
  }

  return (json ?? {}) as T;
}

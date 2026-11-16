const TOKENS_KEY = 'awlad_selim_auth_tokens_v3';
const SERVER_URL_KEY = 'awlad_selim_server_base_url';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
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
      localStorage.removeItem(TOKENS_KEY);
    } else {
      localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    }
  } catch {
    // ignore storage quota errors
  }
}

export function getConfiguredApiBaseUrl(): string {
  try {
    const custom = localStorage.getItem(SERVER_URL_KEY)?.trim() || '';
    if (custom) {
      return custom.replace(/\/+$/, '');
    }
  } catch {
    // ignore
  }
  const envBase = (import.meta as any).env?.VITE_API_BASE_URL;
  if (typeof envBase === 'string' && envBase.trim()) {
    return envBase.trim().replace(/\/+$/, '');
  }
  // Same-origin by default (works automatically with unified server.ts on port 3000 & reverse proxies)
  return '';
}

export function setConfiguredApiBaseUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  if (!clean) {
    localStorage.removeItem(SERVER_URL_KEY);
  } else {
    localStorage.setItem(SERVER_URL_KEY, clean);
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

  if (res.status === 401 && !options.skipAuth && tokens?.refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed?.accessToken) {
      res = await executeFetch(refreshed.accessToken);
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

export type DiagnosticCategory = 'app_event' | 'network_error' | 'sync_issue' | 'auth';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface DiagnosticLogEntry {
  id: string;
  timestamp: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  source: string;
  message: string;
  details?: Record<string, unknown>;
}

const DIAGNOSTICS_STORAGE_KEY = 'awlad_selim_diagnostic_logs_v1';
const MAX_DIAGNOSTIC_ENTRIES = 300;
const SENSITIVE_KEY_RE = /token|password|secret|authorization|cookie|refresh|pin|credential|apikey|api_key/i;
const BEARER_JWT_RE = /Bearer\s+[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+(?:\.[A-Za-z0-9\-_=]+)?/gi;
const RAW_JWT_RE = /\beyJ[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{4,}\b/g;
const QUERY_SECRET_RE = /([?&](?:pair_token|token|access_token|refresh_token|password|secret)=)([^&\s]+)/gi;

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener failures
    }
  }
}

export function redactDiagnosticString(value: string): string {
  return String(value ?? '')
    .replace(BEARER_JWT_RE, 'Bearer [REDACTED]')
    .replace(RAW_JWT_RE, '[REDACTED_JWT]')
    .replace(QUERY_SECRET_RE, '$1[REDACTED]');
}

export function redactDiagnosticData<T>(input: T, depth = 0): T {
  if (input === null || input === undefined) return input;
  if (depth > 5) return '[TRUNCATED]' as unknown as T;

  if (typeof input === 'string') {
    return redactDiagnosticString(input) as unknown as T;
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }
  if (input instanceof Error) {
    return {
      name: input.name,
      message: redactDiagnosticString(input.message || ''),
    } as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 30).map((item) => redactDiagnosticData(item, depth + 1)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactDiagnosticData(val, depth + 1);
      }
    }
    return out as T;
  }
  return String(input) as unknown as T;
}

function readStorageEntries(): DiagnosticLogEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStorageEntries(entries: DiagnosticLogEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_DIAGNOSTIC_ENTRIES)));
  } catch {
    // ignore storage quota errors
  }
}

export function logDiagnostic(params: {
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  source: string;
  message: string;
  details?: Record<string, unknown>;
}): DiagnosticLogEntry {
  const entry: DiagnosticLogEntry = {
    id: `DIAG-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    category: params.category,
    severity: params.severity,
    source: redactDiagnosticString(String(params.source || 'app').trim()),
    message: redactDiagnosticString(String(params.message || '').trim()),
    details: params.details ? redactDiagnosticData(params.details) : undefined,
  };

  const current = readStorageEntries();
  const next = [entry, ...current].slice(0, MAX_DIAGNOSTIC_ENTRIES);
  writeStorageEntries(next);
  notifyListeners();
  return entry;
}

export function getDiagnostics(): DiagnosticLogEntry[] {
  return readStorageEntries();
}

export function clearDiagnostics(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(DIAGNOSTICS_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  notifyListeners();
}

export function subscribeDiagnostics(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function formatDiagnosticsExport(): string {
  const entries = getDiagnostics();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: entries.length,
      entries,
    },
    null,
    2
  );
}

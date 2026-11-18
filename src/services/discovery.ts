import {
  detectModeFromUrl,
  getConfiguredApiBaseUrl,
  getFallbackEndpoints,
  getStoredConnectionProfiles,
  getStoredTokens,
  normalizeServerUrl,
  resolveModeEndpointUrl,
  saveFallbackEndpoints,
  saveStoredConnectionProfiles,
  saveStoredTokens,
  setConfiguredApiBaseUrl,
  testServerHealth,
  triggerAuthExpired,
} from './api';
import { getClientDeviceDescriptor, isNativeCapacitor } from './native';
import type { ConnectionDiscoveryResponse, ConnectionMode, ConnectionProfilesConfig } from '../types';

export interface DiscoveredServerCandidate {
  url: string;
  companyName?: string;
  activeMode?: ConnectionMode;
  latencyMs: number;
  lanUrls?: string[];
  profiles?: ConnectionProfilesConfig;
  fallbackEndpoints?: Array<{ mode: ConnectionMode; url: string; label: string }>;
}

export interface ParsedPairingInput {
  token: string;
  serverUrl?: string;
}

export function parsePairingInput(rawInput: string): ParsedPairingInput | null {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;

  // JSON format fallback if ever pasted
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      const token = String(parsed.token || parsed.rawToken || '').trim();
      const serverUrl = normalizeServerUrl(String(parsed.server || parsed.serverUrl || parsed.url || ''));
      if (token) return { token, serverUrl: serverUrl || undefined };
    } catch {
      // ignore invalid JSON
    }
  }

  // Custom scheme awladselim://pair?token=...&server=...
  if (/^awladselim:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const token = parsed.searchParams.get('token') || '';
      const server = parsed.searchParams.get('server') || '';
      if (token.trim()) {
        return {
          token: token.trim(),
          serverUrl: server.trim() ? normalizeServerUrl(server.trim()) : undefined,
        };
      }
    } catch {
      // ignore malformed scheme
    }
  }

  // HTTP / HTTPS invite URL: https://host/pair/TOKEN or https://host/?pair_token=TOKEN
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const queryToken = parsed.searchParams.get('pair_token') || parsed.searchParams.get('token');
      if (queryToken && queryToken.trim()) {
        const paramServer = parsed.searchParams.get('server');
        return {
          token: queryToken.trim(),
          serverUrl: paramServer ? normalizeServerUrl(paramServer) : parsed.origin,
        };
      }
      const match = parsed.pathname.match(/\/(?:pair|invite)\/([^/?#]+)/i);
      if (match && match[1]) {
        return {
          token: decodeURIComponent(match[1]).trim(),
          serverUrl: parsed.origin,
        };
      }
    } catch {
      // ignore malformed URL
    }
  }

  // Relative /pair/TOKEN or /?pair_token=TOKEN
  const relMatch = raw.match(/^\/?(?:pair|invite)\/([^/?#]+)/i);
  if (relMatch && relMatch[1]) {
    const origin = !isNativeCapacitor() && typeof window !== 'undefined' ? window.location.origin : '';
    return {
      token: decodeURIComponent(relMatch[1]).trim(),
      serverUrl: origin || undefined,
    };
  }

  // Raw token string fallback
  if (/^[A-Za-z0-9_-]{8,128}$/.test(raw)) {
    const fallbackBase =
      getConfiguredApiBaseUrl() ||
      (!isNativeCapacitor() && typeof window !== 'undefined' ? window.location.origin : '');
    return {
      token: raw,
      serverUrl: fallbackBase || undefined,
    };
  }

  return null;
}

async function probeDiscoveryEndpoint(baseUrl: string, timeoutMs = 1100): Promise<DiscoveredServerCandidate | null> {
  const clean = normalizeServerUrl(baseUrl);
  if (!clean) return null;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${clean}/api/connection/discovery`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: ConnectionDiscoveryResponse = await res.json();
    if (!data?.ok || data.service !== 'AWLAD SELIM Enterprise Server') return null;
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
    return {
      url: clean,
      companyName: data.companyName,
      activeMode: data.activeMode,
      latencyMs,
      lanUrls: data.lanUrls,
      profiles: data.profiles,
      fallbackEndpoints: data.fallbackEndpoints,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverServerCandidates(): Promise<DiscoveredServerCandidate[]> {
  const candidateUrls = new Set<string>();
  const addUrl = (u?: string) => {
    const clean = normalizeServerUrl(u || '');
    if (clean) candidateUrls.add(clean);
  };

  addUrl(getConfiguredApiBaseUrl());
  const profiles = getStoredConnectionProfiles();
  addUrl(profiles.cloudVps?.vpsUrl);
  addUrl(profiles.proRemote?.domainUrl);
  addUrl(profiles.freeRemote?.tunnelUrl);
  addUrl(resolveModeEndpointUrl('local_network', profiles));
  for (const fb of getFallbackEndpoints()) {
    addUrl(fb.url);
  }

  if (!isNativeCapacitor() && typeof window !== 'undefined' && /^https?:\/\//i.test(window.location.origin)) {
    addUrl(window.location.origin);
  }

  // Known local host / emulator / router default endpoints
  addUrl('http://127.0.0.1:3000');
  addUrl('http://localhost:3000');
  if (isNativeCapacitor()) {
    addUrl('http://10.0.2.2:3000');
  }

  // Targeted common LAN IPs around saved subnet or standard 192.168.1.x / 192.168.0.x
  const savedIp = String(profiles.localNetwork?.ip || '').trim();
  const savedPort = Number(profiles.localNetwork?.port || 3000) || 3000;
  const savedPrefixMatch = savedIp.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/);
  const prefixes = new Set<string>(['192.168.1', '192.168.0']);
  if (savedPrefixMatch) {
    prefixes.add(savedPrefixMatch[1]);
    const baseLast = Number(savedPrefixMatch[2]);
    for (let offset = -5; offset <= 10; offset += 1) {
      const n = baseLast + offset;
      if (n >= 2 && n <= 254) {
        addUrl(`http://${savedPrefixMatch[1]}.${n}:${savedPort}`);
      }
    }
  }
  const commonHosts = [2, 10, 20, 50, 100, 101, 102, 105, 110, 150, 200];
  for (const prefix of prefixes) {
    for (const h of commonHosts) {
      addUrl(`http://${prefix}.${h}:${savedPort}`);
    }
  }

  const allUrls = Array.from(candidateUrls);
  const found: DiscoveredServerCandidate[] = [];
  const seen = new Set<string>();
  const batchSize = 18;

  for (let i = 0; i < allUrls.length; i += batchSize) {
    const batch = allUrls.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((u) => probeDiscoveryEndpoint(u, 950)));
    for (const res of results) {
      if (res && !seen.has(res.url)) {
        seen.add(res.url);
        found.push(res);
      }
    }
    // If we already discovered valid server(s) in primary priority candidates, return fast
    if (i === 0 && found.length > 0 && !isNativeCapacitor()) {
      break;
    }
  }

  return found.sort((a, b) => a.latencyMs - b.latencyMs);
}

export async function claimPairingInvitation(
  rawUrlOrToken: string
): Promise<{
  ok: boolean;
  companyName?: string;
  activeMode?: ConnectionMode;
  endpointUrl?: string;
  requiresAdminApproval?: boolean;
  error?: string;
}> {
  const parsed = parsePairingInput(rawUrlOrToken);
  if (!parsed?.token) {
    return { ok: false, error: 'رابط أو رمز QR غير صالح. تأكد من مسح الرمز أو نسخ الرابط بالكامل.' };
  }

  const targetServer =
    parsed.serverUrl ||
    getConfiguredApiBaseUrl() ||
    (!isNativeCapacitor() && typeof window !== 'undefined' ? window.location.origin : '');

  if (!targetServer) {
    return {
      ok: false,
      error: 'لم يتضمن الرمز عنوان السيرفر. امسح رمز QR من الشاشة أو الصق رابط الدعوة الكامل.',
    };
  }

  const descriptor = getClientDeviceDescriptor();
  const prevUrl = getConfiguredApiBaseUrl();

  try {
    const res = await fetch(`${targetServer}/api/pairing/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': descriptor.deviceId,
      },
      body: JSON.stringify({
        token: parsed.token,
        deviceId: descriptor.deviceId,
        deviceName: descriptor.deviceName,
        deviceType: descriptor.deviceType,
        osVersion: descriptor.osVersion,
        appVersion: descriptor.appVersion,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `تعذر إتمام ربط الجهاز (${res.status})`,
      };
    }

    const chosenEndpoint = normalizeServerUrl(data.endpointUrl || targetServer);
    if (data.profiles) {
      saveStoredConnectionProfiles(data.profiles);
    }
    if (Array.isArray(data.fallbackEndpoints)) {
      saveFallbackEndpoints(data.fallbackEndpoints);
    }

    // Check whether the chosen endpoint is reachable from this device, else fall back to targetServer that succeeded
    let finalBaseUrl = chosenEndpoint;
    if (chosenEndpoint !== targetServer) {
      const check = await testServerHealth(chosenEndpoint);
      if (!check.ok) {
        finalBaseUrl = targetServer;
      }
    }

    // Never auto-login: if switching to a different server, clear previous server's tokens cleanly
    if (prevUrl && normalizeServerUrl(prevUrl) !== normalizeServerUrl(finalBaseUrl)) {
      saveStoredTokens(null);
    }

    setConfiguredApiBaseUrl(finalBaseUrl);

    return {
      ok: true,
      companyName: data.companyName,
      activeMode: data.activeMode,
      endpointUrl: finalBaseUrl,
      requiresAdminApproval: Boolean(data.requiresAdminApproval),
    };
  } catch {
    return {
      ok: false,
      error: 'تعذر الوصول إلى السيرفر لإتمام الربط. تأكد من الاتصال بالشبكة أو تشغيل النفق.',
    };
  }
}

export async function syncConnectionConfigFromServer(options?: {
  triggerHeartbeat?: boolean;
}): Promise<{ updated: boolean; switchedUrl?: string; revoked?: boolean }> {
  const currentBase = getConfiguredApiBaseUrl();
  const effectiveCurrent =
    currentBase || (!isNativeCapacitor() && typeof window !== 'undefined' ? window.location.origin : '');
  const fallbacks = getFallbackEndpoints().map((f) => f.url);
  const candidates = Array.from(
    new Set([effectiveCurrent, ...fallbacks].map((u) => normalizeServerUrl(u)).filter(Boolean))
  );

  if (candidates.length === 0) return { updated: false };

  const descriptor = getClientDeviceDescriptor();
  const tokens = getStoredTokens();
  const localProfiles = getStoredConnectionProfiles();
  const localVersion = Number(localProfiles.configVersion || 1);

  for (const candidateUrl of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const endpoint = options?.triggerHeartbeat
        ? `${candidateUrl}/api/connection/heartbeat`
        : `${candidateUrl}/api/connection/discovery`;
      const res = await fetch(endpoint, {
        method: options?.triggerHeartbeat ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': descriptor.deviceId,
          ...(tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
        },
        body: options?.triggerHeartbeat
          ? JSON.stringify({
              ...descriptor,
              connectionMode: detectModeFromUrl(candidateUrl, localProfiles),
              serverUrlUsed: candidateUrl,
            })
          : undefined,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      const data = await res.json().catch(() => null);
      if (res.status === 403 && data?.code === 'DEVICE_REVOKED') {
        triggerAuthExpired(data?.error || 'تم فصل هذا الجهاز من الإدارة.');
        return { updated: false, revoked: true };
      }
      if (!data) continue;

      if (data.profiles) {
        saveStoredConnectionProfiles(data.profiles);
      }
      if (Array.isArray(data.fallbackEndpoints)) {
        saveFallbackEndpoints(data.fallbackEndpoints);
      }

      const serverVersion = Number(data.configVersion || 1);
      const nextPreferred = normalizeServerUrl(data.activeEndpoint || '');

      // Auto-switch base URL if device was on a failing URL and fell back, or if server pushed a new active endpoint/tunnel URL
      if (candidateUrl !== effectiveCurrent && (isNativeCapacitor() || currentBase)) {
        setConfiguredApiBaseUrl(candidateUrl);
        return { updated: true, switchedUrl: candidateUrl };
      }

      if (
        serverVersion > localVersion &&
        nextPreferred &&
        nextPreferred !== normalizeServerUrl(effectiveCurrent) &&
        (isNativeCapacitor() || Boolean(currentBase))
      ) {
        const probeNew = await testServerHealth(nextPreferred);
        if (probeNew.ok) {
          setConfiguredApiBaseUrl(nextPreferred);
          return { updated: true, switchedUrl: nextPreferred };
        }
      }

      return { updated: serverVersion > localVersion };
    } catch {
      // try next fallback candidate
    }
  }

  return { updated: false };
}

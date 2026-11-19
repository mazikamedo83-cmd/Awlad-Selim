import {
  detectModeFromUrl,
  fetchWithTimeout,
  getConfiguredApiBaseUrl,
  getFallbackEndpoints,
  getStoredConnectionProfiles,
  getStoredTokens,
  normalizeServerUrl,
  resolveModeEndpointUrl,
  saveFallbackEndpoints,
  saveFallbackEndpointsAsync,
  saveStoredConnectionProfiles,
  saveStoredConnectionProfilesAsync,
  saveStoredTokensAsync,
  setConfiguredApiBaseUrl,
  setConfiguredApiBaseUrlAsync,
  setStoredInstallationIdAsync,
  testServerHealth,
  triggerAuthExpired,
  validateConnectionUrl,
} from './api';
import { getClientDeviceDescriptor, isNativeCapacitor } from './native';
import { clearLastVerifiedOfflineSession } from './offlineAuth';
import { clearReadCache } from './storage';
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

function sanitizeHttpServerUrl(raw: string): string | undefined {
  const normalized = normalizeServerUrl(raw || '');
  if (!normalized) return undefined;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (!parsed.hostname) return undefined;
    return parsed.origin + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '');
  } catch {
    return undefined;
  }
}

export function parsePairingInput(rawInput: string): ParsedPairingInput | null {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;

  // JSON format fallback if ever pasted
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      const token = String(parsed.token || parsed.rawToken || '').trim();
      const serverUrl = sanitizeHttpServerUrl(String(parsed.server || parsed.serverUrl || parsed.url || ''));
      if (token) return { token, serverUrl };
    } catch {
      // ignore invalid JSON
    }
  }

  // Custom scheme:
  // awladselim://pair?token=...&server=...
  // awladselim://invite?token=...&server=...
  // awladselim://pair/TOKEN?server=... or awladselim:///pair/TOKEN?server=...
  if (/^awladselim:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const queryToken = parsed.searchParams.get('token') || parsed.searchParams.get('pair_token') || '';
      const routePathMatch = parsed.pathname.match(/^\/(?:pair|invite)\/([^/?#]+)/i);
      const hostIsRoute = /^(?:pair|invite)$/i.test(parsed.hostname || '');
      const singleSegmentMatch = hostIsRoute ? parsed.pathname.match(/^\/([^/?#]+)/) : null;
      const pathToken = routePathMatch?.[1] || singleSegmentMatch?.[1] || '';
      const token = (queryToken || (pathToken ? decodeURIComponent(pathToken) : '')).trim();
      const server = parsed.searchParams.get('server') || '';
      if (token) {
        return {
          token,
          serverUrl: server.trim() ? sanitizeHttpServerUrl(server.trim()) : undefined,
        };
      }
    } catch {
      // ignore malformed scheme
    }
  }

  // HTTP / HTTPS invite URL: https://host/pair/TOKEN or https://host/invite/TOKEN or https://host/?pair_token=TOKEN
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const paramServer = parsed.searchParams.get('server');
      const safeServer = (paramServer ? sanitizeHttpServerUrl(paramServer) : undefined) || sanitizeHttpServerUrl(parsed.origin);
      const queryToken = parsed.searchParams.get('pair_token') || parsed.searchParams.get('token');
      if (queryToken && queryToken.trim()) {
        return {
          token: queryToken.trim(),
          serverUrl: safeServer,
        };
      }
      const match = parsed.pathname.match(/\/(?:pair|invite)\/([^/?#]+)/i);
      if (match && match[1]) {
        return {
          token: decodeURIComponent(match[1]).trim(),
          serverUrl: safeServer,
        };
      }
    } catch {
      // ignore malformed URL
    }
  }

  // Relative /pair/TOKEN or /invite/TOKEN
  const relMatch = raw.match(/^\/?(?:pair|invite)\/([^/?#]+)/i);
  if (relMatch && relMatch[1]) {
    const origin = !isNativeCapacitor() && typeof window !== 'undefined' ? sanitizeHttpServerUrl(window.location.origin) : undefined;
    return {
      token: decodeURIComponent(relMatch[1]).trim(),
      serverUrl: origin,
    };
  }

  // Raw token string fallback
  if (/^[A-Za-z0-9_-]{8,128}$/.test(raw)) {
    const fallbackBase =
      sanitizeHttpServerUrl(getConfiguredApiBaseUrl()) ||
      (!isNativeCapacitor() && typeof window !== 'undefined' ? sanitizeHttpServerUrl(window.location.origin) : undefined);
    return {
      token: raw,
      serverUrl: fallbackBase,
    };
  }

  return null;
}

async function probeDiscoveryEndpoint(baseUrl: string, timeoutMs = 1100): Promise<DiscoveredServerCandidate | null> {
  const clean = normalizeServerUrl(baseUrl);
  if (!clean) return null;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const res = await fetchWithTimeout(`${clean}/api/connection/discovery`, { method: 'GET' }, timeoutMs);
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

  // Known local host / emulator / hostname (.local) / router default endpoints
  if (!isNativeCapacitor()) {
    addUrl('http://127.0.0.1:3000');
    addUrl('http://localhost:3000');
  }
  const savedPort = Number(profiles.localNetwork?.port || 3000) || 3000;
  const savedHostname = String(profiles.localNetwork?.hostname || 'awlad-selim-server')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0];
  if (savedHostname) {
    addUrl(`http://${savedHostname}:${savedPort}`);
    if (!savedHostname.includes('.')) {
      addUrl(`http://${savedHostname}.local:${savedPort}`);
    }
  }
  if (isNativeCapacitor()) {
    addUrl(`http://10.0.2.2:${savedPort}`);
  }

  // Targeted common LAN IPs around saved subnet, hotspot subnets, and standard 192.168.1.x / 192.168.0.x
  const savedIp = String(profiles.localNetwork?.ip || '').trim();
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
  // Common mobile hotspot / USB tethering / second router subnets
  for (const hotspotPrefix of ['192.168.43', '172.20.10', '192.168.8', '10.0.0']) {
    for (const h of [1, 2, 3, 100]) {
      addUrl(`http://${hotspotPrefix}.${h}:${savedPort}`);
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
  rawUrlOrToken: string,
  options?: { clearExistingAuth?: boolean }
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
    sanitizeHttpServerUrl(parsed.serverUrl || '') ||
    sanitizeHttpServerUrl(getConfiguredApiBaseUrl()) ||
    (!isNativeCapacitor() && typeof window !== 'undefined' ? sanitizeHttpServerUrl(window.location.origin) : undefined);

  if (!targetServer) {
    return {
      ok: false,
      error: 'لم يتضمن الرمز عنوان السيرفر. امسح رمز QR من الشاشة أو الصق رابط الدعوة الكامل.',
    };
  }

  const storedProfiles = getStoredConnectionProfiles();
  const initialEnforceHttps = storedProfiles.enforceHttpsForRemote !== false;
  const initialMode = detectModeFromUrl(targetServer, storedProfiles);
  const targetServerCheck = validateConnectionUrl(initialMode, targetServer, initialEnforceHttps);
  if (!targetServerCheck.valid || !targetServerCheck.normalizedUrl) {
    return {
      ok: false,
      error: targetServerCheck.error || 'عنوان السيرفر في رابط الدعوة غير صالح.',
    };
  }
  const safeTargetServer = targetServerCheck.normalizedUrl;

  const descriptor = getClientDeviceDescriptor();
  const prevUrl = getConfiguredApiBaseUrl();

  try {
    // Strictly verify and claim the invitation token on the server BEFORE saving serverBaseUrl
    const res = await fetchWithTimeout(
      `${safeTargetServer}/api/pairing/claim`,
      {
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
      },
      10000
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || data?.requiresLogin !== true) {
      return {
        ok: false,
        error: data?.error || `تعذر إتمام ربط الجهاز (${res.status})`,
      };
    }

    const chosenEndpoint = sanitizeHttpServerUrl(data.endpointUrl || '') || safeTargetServer;
    const effectiveMode: ConnectionMode =
      data.activeMode || detectModeFromUrl(chosenEndpoint, data.profiles);
    const enforceHttps = data.profiles?.enforceHttpsForRemote !== false;

    // Check whether the chosen endpoint is valid for the claimed mode & reachable from this device, else keep safeTargetServer
    let finalBaseUrl = safeTargetServer;
    if (chosenEndpoint === safeTargetServer) {
      const sameCheck = validateConnectionUrl(effectiveMode, chosenEndpoint, enforceHttps);
      finalBaseUrl = sameCheck.valid ? sameCheck.normalizedUrl : safeTargetServer;
    } else {
      const urlCheck = validateConnectionUrl(effectiveMode, chosenEndpoint, enforceHttps);
      if (urlCheck.valid) {
        const check = await testServerHealth(urlCheck.normalizedUrl);
        if (check.ok) {
          finalBaseUrl = urlCheck.normalizedUrl;
        }
      }
    }

    const finalCheck = validateConnectionUrl(
      detectModeFromUrl(finalBaseUrl, data.profiles || storedProfiles),
      finalBaseUrl,
      enforceHttps
    );
    if (!finalCheck.valid || !sanitizeHttpServerUrl(finalCheck.normalizedUrl)) {
      return {
        ok: false,
        error: finalCheck.error || 'عنوان السيرفر المُرجع من الدعوة غير صالح.',
      };
    }
    finalBaseUrl = finalCheck.normalizedUrl;

    if (data.profiles) {
      await saveStoredConnectionProfilesAsync(data.profiles);
    }
    if (Array.isArray(data.fallbackEndpoints)) {
      await saveFallbackEndpointsAsync(data.fallbackEndpoints);
    }

    // Never auto-login or bypass auth: clear existing auth session, offline session & read cache when switching servers or requested (default true)
    if (
      options?.clearExistingAuth !== false ||
      (prevUrl && normalizeServerUrl(prevUrl) !== normalizeServerUrl(finalBaseUrl))
    ) {
      await saveStoredTokensAsync(null);
      await setStoredInstallationIdAsync('').catch(() => {});
      await clearLastVerifiedOfflineSession().catch(() => {});
      clearReadCache();
    }

    await setConfiguredApiBaseUrlAsync(finalBaseUrl);

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
  allowLanDiscoveryOnFailure?: boolean;
}): Promise<{ updated: boolean; switchedUrl?: string; revoked?: boolean }> {
  const currentBase = getConfiguredApiBaseUrl();
  const effectiveCurrent =
    currentBase || (!isNativeCapacitor() && typeof window !== 'undefined' ? window.location.origin : '');
  const localProfiles = getStoredConnectionProfiles();
  const profileUrls = [
    resolveModeEndpointUrl(localProfiles.activeMode, localProfiles),
    localProfiles.cloudVps?.vpsUrl,
    localProfiles.proRemote?.domainUrl,
    localProfiles.freeRemote?.tunnelUrl,
    resolveModeEndpointUrl('local_network', localProfiles),
  ];
  const fallbacks = getFallbackEndpoints().map((f) => f.url);
  const candidates = Array.from(
    new Set(
      [effectiveCurrent, ...fallbacks, ...profileUrls]
        .map((u) => normalizeServerUrl(u || ''))
        .filter(Boolean)
    )
  );

  const descriptor = getClientDeviceDescriptor();
  const tokens = getStoredTokens();
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

  // Last-resort automatic LAN rediscovery when all known URLs fail on reconnect
  if (options?.allowLanDiscoveryOnFailure && (isNativeCapacitor() || Boolean(currentBase))) {
    try {
      const discovered = await discoverServerCandidates();
      if (discovered.length > 0) {
        const best = discovered[0];
        if (best.profiles) saveStoredConnectionProfiles(best.profiles);
        if (Array.isArray(best.fallbackEndpoints)) saveFallbackEndpoints(best.fallbackEndpoints);
        setConfiguredApiBaseUrl(best.url);
        return { updated: true, switchedUrl: best.url };
      }
    } catch {
      // ignore rediscovery errors
    }
  }

  return { updated: false };
}

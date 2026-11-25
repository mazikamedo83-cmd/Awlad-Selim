import {
  detectModeFromUrl,
  fetchWithTimeout,
  getConfiguredApiBaseUrl,
  getFallbackEndpoints,
  getStoredConnectionProfiles,
  isLocalOrIpHost,
  normalizeServerUrl,
  resolveModeEndpointUrl,
  saveFallbackEndpoints,
  saveStoredConnectionProfiles,
  saveStoredTokens,
  setConfiguredApiBaseUrlAsync,
  setStoredInstallationIdAsync,
  validateConnectionUrl,
  type StoredFallbackEndpoint,
} from './api';
import {
  getClientDeviceDescriptor,
  getOrCreatePersistentDeviceId,
  isNativeCapacitor,
} from './native';
import type {
  ConnectionDiscoveryResponse,
  ConnectionMode,
  ConnectionProfilesConfig,
} from '../types';

export interface DiscoveredServerCandidate {
  url: string;
  companyName?: string;
  installationId?: string;
  latencyMs: number;
  mode?: ConnectionMode;
  activeMode?: ConnectionMode;
  profiles?: ConnectionProfilesConfig;
  fallbackEndpoints?: StoredFallbackEndpoint[];
}

export interface ParsedPairingInput {
  token: string;
  serverUrl?: string;
  mode?: string;
}

export interface ClaimPairingResult {
  ok: boolean;
  companyName?: string;
  installationId?: string;
  endpointUrl?: string;
  connectionMode?: ConnectionMode;
  requiresAdminApproval?: boolean;
  error?: string;
}

function isSafeEndpointForCurrentPolicy(url: string, profiles?: ConnectionProfilesConfig): boolean {
  const clean = normalizeServerUrl(url);
  if (!clean) return false;
  if (/^https:\/\//i.test(clean)) return true;
  if (/^http:\/\//i.test(clean)) {
    if (isLocalOrIpHost(clean)) return true;
    return profiles?.enforceHttpsForRemote === false;
  }
  return false;
}

export function parsePairingInput(rawInput: string): ParsedPairingInput | null {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;

  // 1. JSON QR payload
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      const token = String(obj?.token || obj?.rawToken || obj?.pairToken || '').trim();
      const serverRaw = String(obj?.serverUrl || obj?.serverBaseUrl || obj?.endpointUrl || '').trim();
      const mode = obj?.mode || obj?.connectionMode;
      if (token && token.length >= 10) {
        return {
          token,
          serverUrl: serverRaw ? normalizeServerUrl(serverRaw) : undefined,
          mode: mode ? String(mode) : undefined,
        };
      }
      const nestedUrl = String(obj?.directInviteUrl || obj?.deepLinkUrl || '').trim();
      if (nestedUrl) {
        return parsePairingInput(nestedUrl);
      }
    } catch {
      // fall through
    }
  }

  // 2. URL formats:
  //    awladselim://pair?token=...&server=...
  //    https://host/pair/:token
  //    https://host/invite/:token
  //    https://host/?pair_token=...
  try {
    const parsed = new URL(trimmed);
    const protocolLower = parsed.protocol.toLowerCase();
    if (protocolLower === 'awladselim:') {
      const qToken =
        parsed.searchParams.get('token') ||
        parsed.searchParams.get('pair_token') ||
        parsed.pathname.replace(/^\/+/, '').split('/')[1] ||
        '';
      const qServer =
        parsed.searchParams.get('server') ||
        parsed.searchParams.get('serverUrl') ||
        parsed.searchParams.get('endpoint') ||
        '';
      const qMode = parsed.searchParams.get('mode') || undefined;
      if (qToken.trim().length >= 10) {
        return {
          token: qToken.trim(),
          serverUrl: qServer.trim() ? normalizeServerUrl(qServer.trim()) : undefined,
          mode: qMode,
        };
      }
      return null;
    }

    if (protocolLower === 'http:' || protocolLower === 'https:') {
      const queryToken =
        parsed.searchParams.get('pair_token') ||
        parsed.searchParams.get('token') ||
        '';
      if (queryToken.trim().length >= 10) {
        return {
          token: queryToken.trim(),
          serverUrl: parsed.origin,
          mode: parsed.searchParams.get('mode') || undefined,
        };
      }

      const pathMatch = parsed.pathname.match(/^\/(?:pair|invite)\/([A-Za-z0-9._-]{10,})\/?$/i);
      if (pathMatch && pathMatch[1]) {
        return {
          token: pathMatch[1].trim(),
          serverUrl: parsed.origin,
          mode: parsed.searchParams.get('mode') || undefined,
        };
      }
      return null;
    }
  } catch {
    // not a URL; check raw token
  }

  // 3. Raw token string
  if (/^[A-Za-z0-9._-]{12,128}$/.test(trimmed)) {
    return { token: trimmed };
  }

  return null;
}

async function probeDiscoveryEndpoint(url: string, timeoutMs = 2000): Promise<DiscoveredServerCandidate | null> {
  const cleanUrl = normalizeServerUrl(url);
  if (!cleanUrl) return null;
  const profiles = getStoredConnectionProfiles();
  if (!isSafeEndpointForCurrentPolicy(cleanUrl, profiles)) return null;

  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const res = await fetchWithTimeout(`${cleanUrl}/api/connection/discovery`, { method: 'GET' }, timeoutMs);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as (ConnectionDiscoveryResponse & { installationId?: string }) | null;
    if (!data || !data.ok) return null;

    const latencyMs = Math.max(
      1,
      Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
    );

    return {
      url: normalizeServerUrl(data.currentHostUrl || cleanUrl) || cleanUrl,
      companyName: data.companyName || 'AWLAD SELIM Server',
      installationId: data.installationId,
      latencyMs,
      mode: detectModeFromUrl(cleanUrl, data.profiles),
      activeMode: data.activeMode,
      profiles: data.profiles,
      fallbackEndpoints: Array.isArray(data.fallbackEndpoints) ? data.fallbackEndpoints : [],
    };
  } catch {
    return null;
  }
}

export async function discoverServerCandidates(): Promise<DiscoveredServerCandidate[]> {
  const candidates = new Set<string>();
  const currentConfigured = getConfiguredApiBaseUrl();
  if (currentConfigured) candidates.add(currentConfigured);

  const storedProfiles = getStoredConnectionProfiles();
  const modeUrls: ConnectionMode[] = ['local_network', 'free_remote', 'pro_remote', 'cloud_vps'];
  for (const mode of modeUrls) {
    const resolved = resolveModeEndpointUrl(mode, storedProfiles);
    if (resolved) candidates.add(resolved);
  }

  for (const fb of getFallbackEndpoints()) {
    const normalized = normalizeServerUrl(fb?.url || '');
    if (normalized) candidates.add(normalized);
  }

  if (typeof window !== 'undefined' && window.location?.origin && /^https?:\/\//i.test(window.location.origin)) {
    candidates.add(normalizeServerUrl(window.location.origin));
  }

  // Standard local ports/hosts for Capacitor & Desktop
  candidates.add('http://192.168.1.100:3000');
  candidates.add('http://10.0.2.2:3000');
  candidates.add('http://127.0.0.1:3000');
  candidates.add('http://localhost:3000');

  const uniqueUrls = Array.from(candidates).filter(Boolean);
  const settled = await Promise.all(uniqueUrls.map((u) => probeDiscoveryEndpoint(u, 2000)));
  const foundMap = new Map<string, DiscoveredServerCandidate>();

  for (const item of settled) {
    if (!item) continue;
    const prev = foundMap.get(item.url);
    if (!prev || item.latencyMs < prev.latencyMs) {
      foundMap.set(item.url, item);
    }
  }

  return Array.from(foundMap.values()).sort((a, b) => a.latencyMs - b.latencyMs);
}

export async function claimPairingInvitation(
  rawInput: string,
  options: { clearExistingAuth?: boolean } = {}
): Promise<ClaimPairingResult> {
  const parsed = parsePairingInput(rawInput);
  if (!parsed?.token) {
    return {
      ok: false,
      error: 'رمز أو رابط الربط غير صالح. يرجى مسح رمز QR صحيح أو لصق رابط الدعوة كاملاً.',
    };
  }

  const storedProfiles = getStoredConnectionProfiles();
  let targetBase = parsed.serverUrl || getConfiguredApiBaseUrl();
  if (!targetBase && typeof window !== 'undefined' && /^https?:\/\//i.test(window.location?.origin || '')) {
    targetBase = normalizeServerUrl(window.location.origin);
  }

  if (!targetBase) {
    return {
      ok: false,
      error: 'لم يتم تحديد عنوان السيرفر داخل رابط الدعوة ولا يوجد سيرفر مضبوط مسبقاً.',
    };
  }

  const inferredMode = detectModeFromUrl(targetBase, storedProfiles);
  const urlCheck = validateConnectionUrl(
    inferredMode,
    targetBase,
    storedProfiles.enforceHttpsForRemote !== false
  );
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    return {
      ok: false,
      error: urlCheck.error || 'عنوان السيرفر في رابط الربط غير صالح.',
    };
  }

  const deviceMeta = getClientDeviceDescriptor();
  const deviceId = deviceMeta.deviceId || getOrCreatePersistentDeviceId();

  try {
    const res = await fetchWithTimeout(
      `${urlCheck.normalizedUrl}/api/pairing/claim`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
          'X-Requested-With': 'awlad-selim-spa',
        },
        body: JSON.stringify({
          token: parsed.token,
          deviceId,
          deviceName: deviceMeta.deviceName,
          deviceType: deviceMeta.deviceType,
          osVersion: deviceMeta.osVersion,
          appVersion: deviceMeta.appVersion,
          connectionMode: parsed.mode || inferredMode,
          serverUrlUsed: urlCheck.normalizedUrl,
        }),
      },
      10000
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      return {
        ok: false,
        error: data?.error || `تعذر إتمام ربط الجهاز (${res.status})`,
      };
    }

    const effectiveEndpoint = normalizeServerUrl(
      data.endpointUrl || data.serverBaseUrl || urlCheck.normalizedUrl
    );
    if (!effectiveEndpoint) {
      return { ok: false, error: 'لم يرجع الخادم عنوان اتصال صالحاً.' };
    }

    if (options.clearExistingAuth) {
      saveStoredTokens(null);
    }

    if (data.profiles) {
      saveStoredConnectionProfiles(data.profiles);
    }
    if (Array.isArray(data.fallbackEndpoints)) {
      saveFallbackEndpoints(data.fallbackEndpoints);
    }
    if (data.installationId) {
      await setStoredInstallationIdAsync(String(data.installationId));
    }
    await setConfiguredApiBaseUrlAsync(effectiveEndpoint);

    return {
      ok: true,
      companyName: data.companyName || 'AWLAD SELIM',
      installationId: data.installationId,
      endpointUrl: effectiveEndpoint,
      connectionMode: data.connectionMode || inferredMode,
      requiresAdminApproval: Boolean(data.requiresAdminApproval),
    };
  } catch (err: any) {
    return {
      ok: false,
      error:
        err?.name === 'AbortError'
          ? 'انتهت مهلة الاتصال بالسيرفر أثناء تفعيل رابط الربط.'
          : 'تعذر الوصول إلى السيرفر المركزي لتفعيل رابط الربط. تحقق من الشبكة.',
    };
  }
}

export async function syncConnectionConfigFromServer(options: {
  triggerHeartbeat?: boolean;
  allowLanDiscoveryOnFailure?: boolean;
} = {}): Promise<{ ok: boolean; switchedUrl?: boolean; activeUrl?: string }> {
  const currentConfigured = getConfiguredApiBaseUrl();
  const baseUrl =
    currentConfigured ||
    (!isNativeCapacitor() && typeof window !== 'undefined' && /^https?:\/\//i.test(window.location?.origin || '')
      ? normalizeServerUrl(window.location.origin)
      : '');

  if (baseUrl) {
    const probed = await probeDiscoveryEndpoint(baseUrl, 3500);
    if (probed) {
      const prevProfiles = getStoredConnectionProfiles();
      if (probed.profiles) {
        saveStoredConnectionProfiles(probed.profiles);
      }
      if (Array.isArray(probed.fallbackEndpoints)) {
        saveFallbackEndpoints(probed.fallbackEndpoints);
      }
      if (probed.installationId) {
        await setStoredInstallationIdAsync(probed.installationId);
      }

      const prevVersion = Number(prevProfiles.configVersion || 0);
      const nextVersion = Number(probed.profiles?.configVersion || 0);
      if (
        nextVersion > prevVersion &&
        probed.profiles?.activeMode &&
        isNativeCapacitor()
      ) {
        const nextEndpoint = resolveModeEndpointUrl(probed.profiles.activeMode, probed.profiles);
        if (nextEndpoint && nextEndpoint !== currentConfigured && isSafeEndpointForCurrentPolicy(nextEndpoint, probed.profiles)) {
          const healthy = await probeDiscoveryEndpoint(nextEndpoint, 2500);
          if (healthy) {
            await setConfiguredApiBaseUrlAsync(nextEndpoint);
            return { ok: true, switchedUrl: true, activeUrl: nextEndpoint };
          }
        }
      }

      if (options.triggerHeartbeat) {
        try {
          await fetchWithTimeout(
            `${baseUrl}/api/connection/heartbeat`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Device-Id': getOrCreatePersistentDeviceId(),
                'X-Requested-With': 'awlad-selim-spa',
              },
              body: JSON.stringify({
                deviceId: getOrCreatePersistentDeviceId(),
                serverUrlUsed: baseUrl,
              }),
            },
            3000
          );
        } catch {
          // heartbeat is best-effort
        }
      }

      return { ok: true, switchedUrl: false, activeUrl: baseUrl };
    }
  }

  if (options.allowLanDiscoveryOnFailure && isNativeCapacitor()) {
    const discovered = await discoverServerCandidates();
    if (discovered.length > 0) {
      const best = discovered[0];
      if (best.profiles) saveStoredConnectionProfiles(best.profiles);
      if (Array.isArray(best.fallbackEndpoints)) saveFallbackEndpoints(best.fallbackEndpoints);
      if (best.installationId) await setStoredInstallationIdAsync(best.installationId);
      if (best.url !== currentConfigured) {
        await setConfiguredApiBaseUrlAsync(best.url);
        return { ok: true, switchedUrl: true, activeUrl: best.url };
      }
      return { ok: true, switchedUrl: false, activeUrl: best.url };
    }
  }

  return { ok: false };
}

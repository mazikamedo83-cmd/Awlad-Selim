import crypto from 'node:crypto';
import os from 'node:os';
import { getPool, withTransaction } from '../postgres.js';
import { readJsonDatabase, withJsonTransaction } from '../jsonLedger.js';
import { generateServerId, sha256Hex } from '../../utils/crypto.js';
import { AppError, nowIso } from '../../utils/errors.js';
import { isPgMode, isoTimestamp } from './mode.js';
import { getSystemSettingsSafe } from './catalogStore.js';
import { recordAuditLog, revokeSessionsByDeviceId } from './authStore.js';
import { sanitizeConnectionConfig, updateSystemSettings } from './inventoryAdminStore.js';

const DEFAULT_CONNECTION_CONFIG = {
  activeMode: 'local_network',
  configVersion: 1,
  localNetwork: {
    ip: '192.168.1.100',
    port: 3000,
    hostname: 'awlad-selim-server',
  },
  freeRemote: {
    tunnelUrl: '',
    autoDetect: true,
  },
  proRemote: {
    domainUrl: '',
    provider: 'cloudflare_named_tunnel',
  },
  cloudVps: {
    vpsUrl: '',
    notes: '',
  },
  enforceHttpsForRemote: true,
  updatedAt: null,
};

let tunnelRuntimeState = {
  status: 'offline', // 'offline' | 'starting' | 'online' | 'error'
  provider: 'cloudflared_quick', // 'cloudflared_quick' | 'cloudflared_named' | 'custom'
  tunnelUrl: '',
  localPort: 3000,
  startedAt: null,
  updatedAt: null,
  lastError: null,
};

export function getTunnelRuntimeStatus() {
  return { ...tunnelRuntimeState };
}

export function getLanUrlsForDiscovery(portOverride = null) {
  const port = Number(portOverride || process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000);
  const nets = os.networkInterfaces();
  const entries = [];
  for (const list of Object.values(nets)) {
    if (!Array.isArray(list)) continue;
    for (const iface of list) {
      if (iface && iface.family === 'IPv4' && !iface.internal) {
        entries.push({ ip: iface.address, url: `http://${iface.address}:${port}` });
      }
    }
  }
  return { port, entries };
}

export function resolveSafeConnectionProfiles(settingsObj, lanEntries = [], activePort = 3000) {
  const raw = settingsObj?.extraSettings?.connectionConfig || {};
  const firstLanIp = lanEntries[0]?.ip || '192.168.1.100';
  const merged = {
    ...DEFAULT_CONNECTION_CONFIG,
    ...raw,
    configVersion: Math.max(1, Number(raw.configVersion || 1)),
    localNetwork: {
      ...DEFAULT_CONNECTION_CONFIG.localNetwork,
      ...(raw.localNetwork || {}),
      ip: raw.localNetwork?.ip || firstLanIp,
      port: Number(raw.localNetwork?.port || activePort || 3000) || 3000,
      hostname: raw.localNetwork?.hostname || os.hostname() || 'awlad-selim-server',
    },
    freeRemote: {
      ...DEFAULT_CONNECTION_CONFIG.freeRemote,
      ...(raw.freeRemote || {}),
      tunnelUrl: raw.freeRemote?.tunnelUrl || (tunnelRuntimeState.status === 'online' ? tunnelRuntimeState.tunnelUrl : ''),
    },
    proRemote: {
      ...DEFAULT_CONNECTION_CONFIG.proRemote,
      ...(raw.proRemote || {}),
    },
    cloudVps: {
      ...DEFAULT_CONNECTION_CONFIG.cloudVps,
      ...(raw.cloudVps || {}),
    },
    enforceHttpsForRemote: raw.enforceHttpsForRemote !== false,
  };
  return merged;
}

export function resolveEndpointForMode(mode, profiles) {
  if (!profiles) return '';
  if (mode === 'local_network') {
    const ip = String(profiles.localNetwork?.ip || '').trim();
    const port = Number(profiles.localNetwork?.port || 3000) || 3000;
    return ip ? `http://${ip}:${port}` : '';
  }
  if (mode === 'free_remote') return String(profiles.freeRemote?.tunnelUrl || '').trim();
  if (mode === 'pro_remote') return String(profiles.proRemote?.domainUrl || '').trim();
  if (mode === 'cloud_vps') return String(profiles.cloudVps?.vpsUrl || '').trim();
  return '';
}

export function buildFallbackEndpoints(profiles, lanEntries = []) {
  const seen = new Set();
  const list = [];
  const push = (mode, url, label) => {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    list.push({ mode, url: clean, label });
  };
  const activeUrl = resolveEndpointForMode(profiles.activeMode, profiles);
  push(profiles.activeMode, activeUrl, 'المسار النشط');
  push('cloud_vps', profiles.cloudVps?.vpsUrl, 'Cloud VPS');
  push('pro_remote', profiles.proRemote?.domainUrl, 'الدومين الاحترافي');
  push('free_remote', profiles.freeRemote?.tunnelUrl, 'Quick Tunnel');
  push('local_network', resolveEndpointForMode('local_network', profiles), 'الشبكة المحلية');
  for (const lan of lanEntries) {
    push('local_network', lan.url, `LAN ${lan.ip}`);
  }
  return list;
}

export function resolveRequestPublicBaseUrl(req, preferredUrl = '') {
  const cleanPref = String(preferredUrl || '').trim().replace(/\/+$/, '');
  if (cleanPref) return cleanPref;
  if (!req) return '';
  const forwardedProto = String(req.get('x-forwarded-proto') || req.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim();
  if (!host) return '';
  return `${forwardedProto}://${host}`;
}

export function parseValidAndroidSha256Fingerprints(rawValue = '') {
  return String(rawValue || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((fp) => {
      if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp)) return false;
      // Reject all-zero or obviously fake repeated single-byte placeholders
      if (fp === '00:'.repeat(31) + '00') return false;
      return true;
    });
}

function validatePairingServerUrl(rawUrl, mode, enforceHttps = true) {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed || /\s/.test(trimmed)) {
    throw new AppError(400, 'عنوان السيرفر لوضع الاتصال المختار غير صالح أو مفقود.', 'INVALID_PAIRING_SERVER_URL');
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError(400, 'صيغة عنوان السيرفر لرابط الربط غير صالحة.', 'INVALID_PAIRING_SERVER_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(400, 'يجب أن يبدأ عنوان السيرفر بـ http:// أو https:// فقط.', 'INVALID_PAIRING_SERVER_URL');
  }
  if (!parsed.hostname) {
    throw new AppError(400, 'عنوان السيرفر لا يحتوي على اسم مضيف صالح.', 'INVALID_PAIRING_SERVER_URL');
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
        throw new AppError(400, 'عنوان IP للسيرفر غير مكتمل أو غير صالح.', 'INVALID_PAIRING_SERVER_URL');
      }
    }
  }
  if (mode !== 'local_network') {
    if (enforceHttps && parsed.protocol !== 'https:') {
      throw new AppError(400, 'أوضاع الاتصال الخارجية تتطلب رابط HTTPS مشفر.', 'HTTPS_REQUIRED_FOR_REMOTE');
    }
    const hostLower = parsed.hostname.toLowerCase();
    if (
      hostLower === 'localhost' ||
      hostLower === '127.0.0.1' ||
      hostLower === '10.0.2.2' ||
      !hostLower.includes('.') ||
      hostLower.includes('..')
    ) {
      throw new AppError(400, 'يجب إدخال دومين خارجي صالح لوضع الاتصال البعيد.', 'INVALID_PAIRING_SERVER_URL');
    }
  }
  return parsed.origin + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '');
}

export async function updateTunnelRuntimeStatus(payload = {}, actor = null) {
  const now = nowIso();
  const allowedStatus = new Set(['offline', 'starting', 'online', 'error']);
  const nextStatus = allowedStatus.has(payload.status) ? payload.status : 'offline';
  const rawUrl = String(payload.tunnelUrl || '').trim().replace(/\/+$/, '');

  let validTunnelUrl = '';
  if (rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new AppError(400, 'رابط النفق غير صالح', 'INVALID_TUNNEL_URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new AppError(400, 'يجب أن يبدأ رابط النفق بـ https://', 'HTTPS_REQUIRED_FOR_REMOTE');
    }
    validTunnelUrl = parsed.origin;
  }

  tunnelRuntimeState = {
    status: nextStatus,
    provider: String(payload.provider || tunnelRuntimeState.provider || 'cloudflared_quick').slice(0, 64),
    tunnelUrl: validTunnelUrl || (nextStatus === 'offline' ? '' : tunnelRuntimeState.tunnelUrl),
    localPort: Number(payload.localPort || process.env.AWLAD_ACTIVE_PORT || 3000) || 3000,
    startedAt: nextStatus === 'online' ? (tunnelRuntimeState.startedAt || now) : nextStatus === 'offline' ? null : tunnelRuntimeState.startedAt,
    updatedAt: now,
    lastError: payload.error ? String(payload.error).slice(0, 300) : null,
  };

  let configUpdated = false;
  if (validTunnelUrl) {
    const sys = await getSystemSettingsSafe();
    const prevCfg = sys?.extraSettings?.connectionConfig || {};
    const prevUrl = String(prevCfg?.freeRemote?.tunnelUrl || '').trim();
    const shouldAutoUpdate = prevCfg?.freeRemote?.autoDetect !== false;
    if (shouldAutoUpdate && validTunnelUrl !== prevUrl) {
      const nextCfg = sanitizeConnectionConfig(
        {
          ...prevCfg,
          configVersion: Math.max(1, Number(prevCfg.configVersion || 1)) + 1,
          freeRemote: {
            ...(prevCfg.freeRemote || {}),
            tunnelUrl: validTunnelUrl,
            autoDetect: true,
          },
        },
        prevCfg
      );
      await updateSystemSettings(
        { extraSettings: { connectionConfig: nextCfg } },
        actor || { id: 'system', fullName: 'مراقب النفق التلقائي (Cloudflare Supervisor)' }
      );
      configUpdated = true;
    }
  }

  return {
    tunnelStatus: getTunnelRuntimeStatus(),
    configUpdated,
  };
}

export async function getPublicConnectionDiscovery(req) {
  const sys = await getSystemSettingsSafe();
  const { port, entries } = getLanUrlsForDiscovery();
  const profiles = resolveSafeConnectionProfiles(sys, entries, port);
  const currentHostUrl = resolveRequestPublicBaseUrl(req);
  const activeModeUrl = resolveEndpointForMode(profiles.activeMode, profiles);
  const forwardedProto = req
    ? String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim().toLowerCase()
    : 'http';

  return {
    ok: true,
    service: 'AWLAD SELIM Enterprise Server',
    version: '3.0.0',
    timestamp: nowIso(),
    companyName: sys?.companyName || 'أولاد سليم للتجارة والتوزيع',
    activeMode: profiles.activeMode,
    configVersion: Number(profiles.configVersion || 1),
    supportedModes: ['local_network', 'free_remote', 'pro_remote', 'cloud_vps'],
    port,
    httpsActive: forwardedProto === 'https' || Boolean(req?.secure),
    activeEndpoint: activeModeUrl || currentHostUrl || entries[0]?.url || `http://127.0.0.1:${port}`,
    currentHostUrl,
    lanUrls: entries.map((e) => e.url),
    profiles,
    fallbackEndpoints: buildFallbackEndpoints(profiles, entries),
    tunnelStatus: getTunnelRuntimeStatus(),
  };
}

function mapPgPairingTokenRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    tokenPreview: r.token_preview,
    createdByUserId: r.created_by_user_id || undefined,
    createdByName: r.created_by_name,
    targetUserId: r.target_user_id || undefined,
    targetUserName: r.target_user_name || '',
    targetRole: r.target_role || '',
    targetDeviceType: r.target_device_type || 'any',
    connectionMode: r.connection_mode || 'auto',
    expiresAt: isoTimestamp(r.expires_at),
    singleUse: Boolean(r.single_use),
    usedCount: Number(r.used_count || 0),
    lastUsedAt: r.last_used_at ? isoTimestamp(r.last_used_at) : undefined,
    requireAdminApproval: Boolean(r.require_admin_approval),
    revokedAt: r.revoked_at ? isoTimestamp(r.revoked_at) : undefined,
    notes: r.notes || '',
    createdAt: isoTimestamp(r.created_at),
  };
}

function mapPgPairedDeviceRow(r) {
  if (!r) return null;
  return {
    deviceId: r.device_id,
    deviceName: r.device_name,
    deviceType: r.device_type || 'android',
    osVersion: r.os_version || '',
    appVersion: r.app_version || '',
    linkedUserId: r.linked_user_id || undefined,
    linkedUserName: r.linked_user_name || '',
    connectionMode: r.connection_mode || 'local_network',
    serverUrlUsed: r.server_url_used || '',
    ipAddress: r.ip_address || '',
    status: r.status || 'active',
    pairingTokenId: r.pairing_token_id || undefined,
    configVersion: Number(r.config_version || 1),
    pairedAt: isoTimestamp(r.paired_at),
    lastSeenAt: isoTimestamp(r.last_seen_at),
    revokedAt: r.revoked_at ? isoTimestamp(r.revoked_at) : undefined,
    notes: r.notes || '',
  };
}

function computeTokenLifecycleStatus(tok) {
  if (!tok) return 'invalid';
  if (tok.revokedAt) return 'revoked';
  if (tok.singleUse && Number(tok.usedCount || 0) >= 1) return 'used';
  if (new Date(tok.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export async function listPairingTokens() {
  let rows = [];
  if (await isPgMode()) {
    const res = await getPool().query('SELECT * FROM pairing_tokens ORDER BY created_at DESC LIMIT 100');
    rows = res.rows.map(mapPgPairingTokenRow);
  } else {
    const db = readJsonDatabase();
    rows = (db.pairingTokens || [])
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100)
      .map(({ tokenHash: _omit, ...safe }) => safe);
  }
  return rows.map((t) => ({ ...t, status: computeTokenLifecycleStatus(t) }));
}

export async function createPairingToken(payload = {}, actor, req = null) {
  const allowedDeviceTypes = new Set(['any', 'windows', 'android', 'ios']);
  const allowedModes = new Set(['auto', 'local_network', 'free_remote', 'pro_remote', 'cloud_vps']);

  const targetDeviceType = allowedDeviceTypes.has(payload.targetDeviceType) ? payload.targetDeviceType : 'any';
  const connectionMode = allowedModes.has(payload.connectionMode) ? payload.connectionMode : 'auto';
  const ttlMinutes = Math.min(43200, Math.max(1, Number(payload.ttlMinutes || 60) || 60)); // 1m to 30 days
  const singleUse = payload.singleUse !== false;
  const requireAdminApproval = Boolean(payload.requireAdminApproval);
  const notes = String(payload.notes || '').trim().slice(0, 240);
  const targetUserId = payload.targetUserId ? String(payload.targetUserId).trim() : '';

  let targetUser = null;
  if (targetUserId) {
    if (await isPgMode()) {
      const uRes = await getPool().query('SELECT id, full_name, role, is_active FROM users WHERE id = $1 LIMIT 1', [targetUserId]);
      targetUser = uRes.rows[0]
        ? { id: uRes.rows[0].id, fullName: uRes.rows[0].full_name, role: uRes.rows[0].role, isActive: uRes.rows[0].is_active }
        : null;
    } else {
      const db = readJsonDatabase();
      const found = (db.users || []).find((u) => u.id === targetUserId);
      targetUser = found ? { id: found.id, fullName: found.fullName, role: found.role, isActive: found.isActive } : null;
    }
    if (!targetUser) {
      throw new AppError(404, 'المستخدم المحدد لرابط الربط غير موجود', 'USER_NOT_FOUND');
    }
  }

  const sys = await getSystemSettingsSafe();
  const { port, entries } = getLanUrlsForDiscovery();
  const profiles = resolveSafeConnectionProfiles(sys, entries, port);
  const effectiveMode = connectionMode === 'auto' ? profiles.activeMode : connectionMode;
  const explicitBaseUrl = String(payload.serverBaseUrl || '').trim();
  const modeEndpoint = resolveEndpointForMode(effectiveMode, profiles);
  const rawCandidateUrl =
    explicitBaseUrl ||
    modeEndpoint ||
    (effectiveMode === 'local_network'
      ? entries[0]?.url || resolveRequestPublicBaseUrl(req) || `http://127.0.0.1:${port}`
      : '');
  const serverBaseUrl = validatePairingServerUrl(
    rawCandidateUrl,
    effectiveMode,
    profiles.enforceHttpsForRemote !== false
  );

  const rawToken = crypto.randomBytes(18).toString('base64url');
  const tokenHash = sha256Hex(rawToken);
  const tokenPreview = `${rawToken.slice(0, 6)}...${rawToken.slice(-4)}`;
  const id = generateServerId('PAIR');
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const record = {
    id,
    tokenPreview,
    createdByUserId: actor.id,
    createdByName: actor.fullName,
    targetUserId: targetUser?.id || undefined,
    targetUserName: targetUser?.fullName || '',
    targetRole: targetUser?.role || '',
    targetDeviceType,
    connectionMode: effectiveMode,
    expiresAt,
    singleUse,
    usedCount: 0,
    lastUsedAt: undefined,
    requireAdminApproval,
    revokedAt: undefined,
    notes,
    createdAt: now,
  };

  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO pairing_tokens (id, token_hash, token_preview, created_by_user_id, created_by_name, target_user_id, target_user_name, target_role, target_device_type, connection_mode, expires_at, single_use, used_count, require_admin_approval, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,$14,$15)`,
      [
        record.id,
        tokenHash,
        record.tokenPreview,
        record.createdByUserId,
        record.createdByName,
        record.targetUserId || null,
        record.targetUserName,
        record.targetRole,
        record.targetDeviceType,
        record.connectionMode,
        record.expiresAt,
        record.singleUse,
        record.requireAdminApproval,
        record.notes,
        record.createdAt,
      ]
    );
  } else {
    await withJsonTransaction((db) => {
      db.pairingTokens.unshift({ ...record, serverBaseUrl, tokenHash });
      if (db.pairingTokens.length > 200) db.pairingTokens.length = 200;
    });
  }

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إنشاء رابط ربط ذكي / QR (${record.targetDeviceType}) ${record.targetUserName ? `للمستخدم ${record.targetUserName}` : ''}`.trim(),
    module: 'الأجهزة والاتصال',
    recordId: record.id,
  });

  const directInviteUrl = `${serverBaseUrl}/pair/${rawToken}`;
  const deepLinkUrl = `awladselim://pair?token=${encodeURIComponent(rawToken)}&server=${encodeURIComponent(serverBaseUrl)}`;

  return {
    tokenRecord: { ...record, status: 'active' },
    rawToken,
    serverBaseUrl,
    directInviteUrl,
    deepLinkUrl,
    qrPayload: directInviteUrl,
  };
}

export async function revokePairingToken(tokenId, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const res = await getPool().query(
      'UPDATE pairing_tokens SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL RETURNING *',
      [now, tokenId]
    );
    if (!res.rows[0]) {
      throw new AppError(404, 'رابط الربط غير موجود أو ملغي مسبقاً', 'TOKEN_NOT_FOUND');
    }
  } else {
    await withJsonTransaction((db) => {
      const tok = (db.pairingTokens || []).find((t) => t.id === tokenId);
      if (!tok || tok.revokedAt) {
        throw new AppError(404, 'رابط الربط غير موجود أو ملغي مسبقاً', 'TOKEN_NOT_FOUND');
      }
      tok.revokedAt = now;
    });
  }

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إلغاء رابط ربط جهاز (${tokenId})`,
    module: 'الأجهزة والاتصال',
    recordId: tokenId,
  });
  return { ok: true };
}

function validateTokenRecordState(tok) {
  if (!tok) {
    throw new AppError(404, 'رابط أو رمز الربط غير صالح أو غير موجود', 'PAIRING_TOKEN_INVALID');
  }
  if (tok.revokedAt) {
    throw new AppError(410, 'تم إلغاء رابط الربط هذا من قِبل الإدارة', 'PAIRING_TOKEN_REVOKED');
  }
  if (new Date(tok.expiresAt).getTime() <= Date.now()) {
    throw new AppError(410, 'انتهت صلاحية رابط الربط. اطلب رابطاً جديداً من الإدارة.', 'PAIRING_TOKEN_EXPIRED');
  }
  if (tok.singleUse && Number(tok.usedCount || 0) >= 1) {
    throw new AppError(409, 'تم استخدام رابط الربط هذا مسبقاً (صالح لمرة واحدة فقط).', 'PAIRING_TOKEN_USED');
  }
}

export async function resolvePairingToken(rawToken, req = null) {
  const clean = String(rawToken || '').trim();
  if (!clean) {
    throw new AppError(400, 'رمز الربط مفقود', 'MISSING_PAIRING_TOKEN');
  }
  const hash = sha256Hex(clean);
  let tok = null;
  if (await isPgMode()) {
    const res = await getPool().query('SELECT * FROM pairing_tokens WHERE token_hash = $1 LIMIT 1', [hash]);
    tok = mapPgPairingTokenRow(res.rows[0]);
  } else {
    const db = readJsonDatabase();
    const found = (db.pairingTokens || []).find((t) => t.tokenHash === hash);
    if (found) {
      const { tokenHash: _omit, ...safe } = found;
      tok = safe;
    }
  }
  validateTokenRecordState(tok);

  const sys = await getSystemSettingsSafe();
  const { port, entries } = getLanUrlsForDiscovery();
  const profiles = resolveSafeConnectionProfiles(sys, entries, port);
  const effectiveMode = tok.connectionMode === 'auto' ? profiles.activeMode : tok.connectionMode;
  const endpointUrl =
    resolveEndpointForMode(effectiveMode, profiles) ||
    tok.serverBaseUrl ||
    resolveRequestPublicBaseUrl(req) ||
    entries[0]?.url ||
    `http://127.0.0.1:${port}`;

  return {
    ok: true,
    valid: true,
    companyName: sys?.companyName || 'أولاد سليم للتجارة والتوزيع',
    activeMode: effectiveMode,
    endpointUrl,
    profiles: { ...profiles, activeMode: effectiveMode },
    lanUrls: entries.map((e) => e.url),
    targetDeviceType: tok.targetDeviceType,
    singleUse: tok.singleUse,
    requireAdminApproval: tok.requireAdminApproval,
    targetUserName: tok.targetUserName || null,
    expiresAt: tok.expiresAt,
    requiresLogin: true,
  };
}

function normalizeDeviceType(rawType, userAgent = '') {
  const clean = String(rawType || '').toLowerCase().trim();
  if (clean === 'windows' || clean === 'android' || clean === 'ios' || clean === 'web') return clean;
  const ua = String(userAgent || '').toLowerCase();
  if (/iphone|ipad|ipod|ios/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/windows|electron/.test(ua)) return 'windows';
  return 'web';
}

export async function claimPairingToken(payload = {}, req = null) {
  const rawToken = String(payload.token || payload.rawToken || '').trim();
  if (!rawToken) {
    throw new AppError(400, 'رمز الربط مفقود', 'MISSING_PAIRING_TOKEN');
  }
  const hash = sha256Hex(rawToken);
  const ua = req?.get?.('user-agent') || '';
  const ipAddress = payload.ipAddress || '';
  const deviceId = String(payload.deviceId || generateServerId('DEV')).trim().slice(0, 64);
  const deviceType = normalizeDeviceType(payload.deviceType, ua);
  const deviceName = String(payload.deviceName || `${deviceType.toUpperCase()} Device`).trim().slice(0, 120);
  const osVersion = String(payload.osVersion || '').trim().slice(0, 80);
  const appVersion = String(payload.appVersion || '3.0.0').trim().slice(0, 40);
  const now = nowIso();

  const sys = await getSystemSettingsSafe();
  const { port, entries } = getLanUrlsForDiscovery();
  const profiles = resolveSafeConnectionProfiles(sys, entries, port);

  let claimed;
  if (await isPgMode()) {
    claimed = await withTransaction(async (client) => {
      const tRes = await client.query('SELECT * FROM pairing_tokens WHERE token_hash = $1 LIMIT 1 FOR UPDATE', [hash]);
      const tok = mapPgPairingTokenRow(tRes.rows[0]);
      validateTokenRecordState(tok);

      if (tok.targetDeviceType !== 'any' && tok.targetDeviceType !== deviceType) {
        throw new AppError(
          403,
          `رابط الربط هذا مخصص لأجهزة (${tok.targetDeviceType}) فقط ولا يصلح لهذا الجهاز (${deviceType})`,
          'DEVICE_TYPE_MISMATCH'
        );
      }

      const effectiveMode = tok.connectionMode === 'auto' ? profiles.activeMode : tok.connectionMode;
      const endpointUrl =
        resolveEndpointForMode(effectiveMode, profiles) ||
        resolveRequestPublicBaseUrl(req) ||
        entries[0]?.url ||
        `http://127.0.0.1:${port}`;
      const deviceStatus = tok.requireAdminApproval ? 'pending_approval' : 'active';

      await client.query(
        'UPDATE pairing_tokens SET used_count = used_count + 1, last_used_at = $1 WHERE id = $2',
        [now, tok.id]
      );

      await client.query(
        `INSERT INTO paired_devices (device_id, device_name, device_type, os_version, app_version, linked_user_id, linked_user_name, connection_mode, server_url_used, ip_address, status, pairing_token_id, config_version, paired_at, last_seen_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,NULL)
         ON CONFLICT (device_id) DO UPDATE SET
           device_name = EXCLUDED.device_name,
           device_type = EXCLUDED.device_type,
           os_version = EXCLUDED.os_version,
           app_version = EXCLUDED.app_version,
           linked_user_id = COALESCE(EXCLUDED.linked_user_id, paired_devices.linked_user_id),
           linked_user_name = CASE WHEN EXCLUDED.linked_user_name <> '' THEN EXCLUDED.linked_user_name ELSE paired_devices.linked_user_name END,
           connection_mode = EXCLUDED.connection_mode,
           server_url_used = EXCLUDED.server_url_used,
           ip_address = EXCLUDED.ip_address,
           status = EXCLUDED.status,
           pairing_token_id = EXCLUDED.pairing_token_id,
           config_version = EXCLUDED.config_version,
           last_seen_at = EXCLUDED.last_seen_at,
           revoked_at = NULL`,
        [
          deviceId,
          deviceName,
          deviceType,
          osVersion,
          appVersion,
          tok.targetUserId || null,
          tok.targetUserName || '',
          effectiveMode,
          endpointUrl,
          ipAddress,
          deviceStatus,
          tok.id,
          Number(profiles.configVersion || 1),
          now,
        ]
      );

      return { tok, effectiveMode, endpointUrl, deviceStatus };
    });
  } else {
    claimed = await withJsonTransaction((db) => {
      const tok = (db.pairingTokens || []).find((t) => t.tokenHash === hash);
      validateTokenRecordState(tok);
      if (tok.targetDeviceType !== 'any' && tok.targetDeviceType !== deviceType) {
        throw new AppError(
          403,
          `رابط الربط هذا مخصص لأجهزة (${tok.targetDeviceType}) فقط ولا يصلح لهذا الجهاز (${deviceType})`,
          'DEVICE_TYPE_MISMATCH'
        );
      }

      const effectiveMode = tok.connectionMode === 'auto' ? profiles.activeMode : tok.connectionMode;
      const endpointUrl =
        resolveEndpointForMode(effectiveMode, profiles) ||
        tok.serverBaseUrl ||
        resolveRequestPublicBaseUrl(req) ||
        entries[0]?.url ||
        `http://127.0.0.1:${port}`;
      const deviceStatus = tok.requireAdminApproval ? 'pending_approval' : 'active';

      tok.usedCount = Number(tok.usedCount || 0) + 1;
      tok.lastUsedAt = now;

      const idx = (db.pairedDevices || []).findIndex((d) => d.deviceId === deviceId);
      const nextDevice = {
        deviceId,
        deviceName,
        deviceType,
        osVersion,
        appVersion,
        linkedUserId: tok.targetUserId || (idx !== -1 ? db.pairedDevices[idx].linkedUserId : undefined),
        linkedUserName: tok.targetUserName || (idx !== -1 ? db.pairedDevices[idx].linkedUserName : ''),
        connectionMode: effectiveMode,
        serverUrlUsed: endpointUrl,
        ipAddress,
        status: deviceStatus,
        pairingTokenId: tok.id,
        configVersion: Number(profiles.configVersion || 1),
        pairedAt: idx !== -1 ? db.pairedDevices[idx].pairedAt : now,
        lastSeenAt: now,
        revokedAt: undefined,
        notes: idx !== -1 ? db.pairedDevices[idx].notes || '' : '',
      };
      if (idx === -1) {
        db.pairedDevices.unshift(nextDevice);
      } else {
        db.pairedDevices[idx] = nextDevice;
      }

      return { tok, effectiveMode, endpointUrl, deviceStatus };
    });
  }

  await recordAuditLog({
    userId: claimed.tok.targetUserId || null,
    userName: claimed.tok.targetUserName || deviceName,
    action: `ربط جهاز جديد (${deviceName} - ${deviceType}) عبر ${claimed.effectiveMode}${claimed.deviceStatus === 'pending_approval' ? ' (بانتظار اعتماد الإدارة)' : ''}`,
    module: 'الأجهزة والاتصال',
    recordId: deviceId,
    ipAddress,
  });

  // Never issue JWT/access tokens here; strictly enforce manual user login
  return {
    ok: true,
    requiresLogin: true,
    deviceId,
    deviceStatus: claimed.deviceStatus,
    requiresAdminApproval: claimed.deviceStatus === 'pending_approval',
    companyName: sys?.companyName || 'أولاد سليم للتجارة والتوزيع',
    activeMode: claimed.effectiveMode,
    endpointUrl: claimed.endpointUrl,
    configVersion: Number(profiles.configVersion || 1),
    profiles: { ...profiles, activeMode: claimed.effectiveMode },
    lanUrls: entries.map((e) => e.url),
    fallbackEndpoints: buildFallbackEndpoints(profiles, entries),
  };
}

export async function getDeviceStatusForGuard(deviceId) {
  const cleanId = String(deviceId || '').trim();
  if (!cleanId) return { exists: false, blocked: false, device: null };

  let device = null;
  if (await isPgMode()) {
    const res = await getPool().query('SELECT * FROM paired_devices WHERE device_id = $1 LIMIT 1', [cleanId]);
    device = mapPgPairedDeviceRow(res.rows[0]);
  } else {
    const db = readJsonDatabase();
    device = (db.pairedDevices || []).find((d) => d.deviceId === cleanId) || null;
  }

  if (!device) return { exists: false, blocked: false, device: null };
  if (device.status === 'revoked') {
    return {
      exists: true,
      blocked: true,
      code: 'DEVICE_REVOKED',
      message: 'تم فصل أو إلغاء ربط هذا الجهاز من قِبل الإدارة. يرجى إعادة الربط عبر رابط جديد.',
      device,
    };
  }
  if (device.status === 'pending_approval') {
    return {
      exists: true,
      blocked: true,
      code: 'DEVICE_PENDING_APPROVAL',
      message: 'هذا الجهاز بانتظار موافقة مدير النظام في لوحة إدارة الأجهزة.',
      device,
    };
  }
  return { exists: true, blocked: false, device };
}

export async function touchDeviceActivity({
  deviceId,
  deviceName = '',
  deviceType = '',
  osVersion = '',
  appVersion = '',
  connectionMode = '',
  serverUrlUsed = '',
  ipAddress = '',
  user = null,
}) {
  const cleanId = String(deviceId || '').trim().slice(0, 64);
  if (!cleanId) return null;
  const now = nowIso();

  if (await isPgMode()) {
    const res = await getPool().query('SELECT * FROM paired_devices WHERE device_id = $1 LIMIT 1', [cleanId]);
    const existing = mapPgPairedDeviceRow(res.rows[0]);
    if (!existing) {
      if (!user) return null;
      const dType = normalizeDeviceType(deviceType, osVersion);
      const dName = String(deviceName || `${user.fullName} (${dType})`).slice(0, 120);
      await getPool().query(
        `INSERT INTO paired_devices (device_id, device_name, device_type, os_version, app_version, linked_user_id, linked_user_name, connection_mode, server_url_used, ip_address, status, paired_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$11)
         ON CONFLICT (device_id) DO NOTHING`,
        [
          cleanId,
          dName,
          dType,
          String(osVersion || '').slice(0, 80),
          String(appVersion || '3.0.0').slice(0, 40),
          user.id,
          user.fullName,
          String(connectionMode || 'local_network').slice(0, 32),
          String(serverUrlUsed || '').slice(0, 300),
          String(ipAddress || '').slice(0, 64),
          now,
        ]
      );
      return { deviceId: cleanId, status: 'active' };
    }
    if (existing.status === 'revoked' || existing.status === 'pending_approval') {
      return existing;
    }
    await getPool().query(
      `UPDATE paired_devices SET
         last_seen_at = $1,
         connection_mode = COALESCE(NULLIF($2, ''), connection_mode),
         server_url_used = COALESCE(NULLIF($3, ''), server_url_used),
         ip_address = COALESCE(NULLIF($4, ''), ip_address),
         linked_user_id = COALESCE($5, linked_user_id),
         linked_user_name = CASE WHEN COALESCE($6, '') <> '' THEN $6 ELSE linked_user_name END
       WHERE device_id = $7`,
      [
        now,
        String(connectionMode || '').slice(0, 32),
        String(serverUrlUsed || '').slice(0, 300),
        String(ipAddress || '').slice(0, 64),
        user?.id || null,
        user?.fullName || '',
        cleanId,
      ]
    );
    return { ...existing, lastSeenAt: now };
  }

  return withJsonTransaction((db) => {
    const idx = (db.pairedDevices || []).findIndex((d) => d.deviceId === cleanId);
    if (idx === -1) {
      if (!user) return null;
      const dType = normalizeDeviceType(deviceType, osVersion);
      const created = {
        deviceId: cleanId,
        deviceName: String(deviceName || `${user.fullName} (${dType})`).slice(0, 120),
        deviceType: dType,
        osVersion: String(osVersion || '').slice(0, 80),
        appVersion: String(appVersion || '3.0.0').slice(0, 40),
        linkedUserId: user.id,
        linkedUserName: user.fullName,
        connectionMode: String(connectionMode || 'local_network').slice(0, 32),
        serverUrlUsed: String(serverUrlUsed || '').slice(0, 300),
        ipAddress: String(ipAddress || '').slice(0, 64),
        status: 'active',
        configVersion: 1,
        pairedAt: now,
        lastSeenAt: now,
      };
      db.pairedDevices.unshift(created);
      return created;
    }
    const existing = db.pairedDevices[idx];
    if (existing.status === 'revoked' || existing.status === 'pending_approval') {
      return existing;
    }
    existing.lastSeenAt = now;
    if (connectionMode) existing.connectionMode = String(connectionMode).slice(0, 32);
    if (serverUrlUsed) existing.serverUrlUsed = String(serverUrlUsed).slice(0, 300);
    if (ipAddress) existing.ipAddress = String(ipAddress).slice(0, 64);
    if (user?.id) existing.linkedUserId = user.id;
    if (user?.fullName) existing.linkedUserName = user.fullName;
    return existing;
  });
}

export async function recordDeviceHeartbeat(payload = {}, req = null, authUser = null) {
  const deviceId = String(payload.deviceId || req?.get?.('x-device-id') || '').trim();
  const discovery = await getPublicConnectionDiscovery(req);
  if (!deviceId) {
    return {
      ...discovery,
      deviceStatus: 'unpaired',
      requiresRePair: false,
    };
  }

  const guard = await getDeviceStatusForGuard(deviceId);
  if (guard.blocked) {
    return {
      ok: false,
      code: guard.code,
      error: guard.message,
      deviceStatus: guard.device?.status,
      configVersion: discovery.configVersion,
      activeEndpoint: discovery.activeEndpoint,
      profiles: discovery.profiles,
    };
  }

  await touchDeviceActivity({
    deviceId,
    deviceName: payload.deviceName,
    deviceType: payload.deviceType,
    osVersion: payload.osVersion,
    appVersion: payload.appVersion,
    connectionMode: payload.connectionMode,
    serverUrlUsed: payload.serverUrlUsed,
    ipAddress: payload.ipAddress || '',
    user: authUser,
  });

  return {
    ...discovery,
    deviceStatus: guard.exists ? 'active' : 'unpaired',
  };
}

export async function listPairedDevices() {
  let devices = [];
  if (await isPgMode()) {
    const res = await getPool().query('SELECT * FROM paired_devices ORDER BY last_seen_at DESC');
    devices = res.rows.map(mapPgPairedDeviceRow);
  } else {
    const db = readJsonDatabase();
    devices = (db.pairedDevices || [])
      .slice()
      .sort((a, b) => String(b.lastSeenAt || b.pairedAt).localeCompare(String(a.lastSeenAt || a.pairedAt)));
  }

  const nowMs = Date.now();
  const enriched = devices.map((d) => {
    const lastMs = d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : 0;
    const isRecentlyOnline = d.status === 'active' && lastMs > 0 && nowMs - lastMs <= 5 * 60 * 1000;
    return { ...d, isRecentlyOnline };
  });

  const summary = {
    total: enriched.length,
    active: enriched.filter((d) => d.status === 'active').length,
    pendingApproval: enriched.filter((d) => d.status === 'pending_approval').length,
    revoked: enriched.filter((d) => d.status === 'revoked').length,
    onlineNow: enriched.filter((d) => d.isRecentlyOnline).length,
  };

  return { devices: enriched, summary };
}

export async function approvePairedDevice(deviceId, actor) {
  const now = nowIso();
  let updated;
  if (await isPgMode()) {
    const res = await getPool().query(
      `UPDATE paired_devices SET status = 'active', revoked_at = NULL, last_seen_at = COALESCE(last_seen_at, $1)
       WHERE device_id = $2 RETURNING *`,
      [now, deviceId]
    );
    if (!res.rows[0]) throw new AppError(404, 'الجهاز غير موجود', 'DEVICE_NOT_FOUND');
    updated = mapPgPairedDeviceRow(res.rows[0]);
  } else {
    updated = await withJsonTransaction((db) => {
      const dev = (db.pairedDevices || []).find((d) => d.deviceId === deviceId);
      if (!dev) throw new AppError(404, 'الجهاز غير موجود', 'DEVICE_NOT_FOUND');
      dev.status = 'active';
      dev.revokedAt = undefined;
      return dev;
    });
  }

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `اعتماد ربط الجهاز (${updated.deviceName} - ${updated.deviceType})`,
    module: 'الأجهزة والاتصال',
    recordId: deviceId,
  });
  return updated;
}

export async function revokePairedDevice(deviceId, actor) {
  const now = nowIso();
  let updated;
  if (await isPgMode()) {
    const res = await getPool().query(
      `UPDATE paired_devices SET status = 'revoked', revoked_at = $1 WHERE device_id = $2 RETURNING *`,
      [now, deviceId]
    );
    if (!res.rows[0]) throw new AppError(404, 'الجهاز غير موجود', 'DEVICE_NOT_FOUND');
    updated = mapPgPairedDeviceRow(res.rows[0]);
  } else {
    updated = await withJsonTransaction((db) => {
      const dev = (db.pairedDevices || []).find((d) => d.deviceId === deviceId);
      if (!dev) throw new AppError(404, 'الجهاز غير موجود', 'DEVICE_NOT_FOUND');
      dev.status = 'revoked';
      dev.revokedAt = now;
      return dev;
    });
  }

  await revokeSessionsByDeviceId(deviceId);
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `فصل وإلغاء ربط الجهاز (${updated.deviceName} - ${updated.deviceType})`,
    module: 'الأجهزة والاتصال',
    recordId: deviceId,
  });
  return updated;
}

export async function pushConnectionConfigUpdate(actor) {
  const sys = await getSystemSettingsSafe();
  const { port, entries } = getLanUrlsForDiscovery();
  const currentProfiles = resolveSafeConnectionProfiles(sys, entries, port);
  const nextConfig = sanitizeConnectionConfig(
    {
      ...currentProfiles,
      configVersion: Number(currentProfiles.configVersion || 1) + 1,
    },
    currentProfiles
  );
  await updateSystemSettings({ extraSettings: { connectionConfig: nextConfig } }, actor);
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تعميم تحديث عنوان وإعدادات الاتصال للأجهزة المرتبطة (الإصدار v${nextConfig.configVersion})`,
    module: 'الأجهزة والاتصال',
  });
  return nextConfig;
}

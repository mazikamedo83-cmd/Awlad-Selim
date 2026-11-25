import crypto from 'node:crypto';
import os from 'node:os';
import { getPool, withTransaction } from '../postgres.js';
import { readJsonDatabase, readJsonSessions, writeJsonSessions, withJsonTransaction } from '../jsonLedger.js';
import { generateServerId, sha256Hex } from '../../utils/crypto.js';
import { AppError, nowIso } from '../../utils/errors.js';
import { isPgMode, ensureStrictPgReady, isoTimestamp } from './mode.js';
import { getAuthStatus, recordAuditLog } from './authStore.js';
import { getSystemSettingsSafe } from './catalogStore.js';

const CONNECTION_MODES = new Set(['local_network', 'free_remote', 'pro_remote', 'cloud_vps']);

let tunnelRuntimeState = {
  status: 'offline',
  provider: 'cloudflare',
  tunnelUrl: '',
  localPort: Number(process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000),
  startedAt: null,
  updatedAt: null,
  lastError: null,
};

export function getTunnelRuntimeStatus() {
  return { ...tunnelRuntimeState };
}

export function resetTunnelRuntimeStatusForTests() {
  tunnelRuntimeState = {
    status: 'offline',
    provider: 'cloudflare',
    tunnelUrl: '',
    localPort: Number(process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000),
    startedAt: null,
    updatedAt: null,
    lastError: null,
  };
}

export function parseValidAndroidSha256Fingerprints(rawInput = '') {
  const tokens = String(rawInput || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const valid = [];
  const seen = new Set();
  for (const fp of tokens) {
    if (fp.includes('REPLACE') || fp.includes('EXAMPLE') || fp.includes('YOUR_')) continue;
    // Match 32-byte SHA-256 hex with colons: AA:BB:... (32 pairs) or 64 continuous hex
    let normalized = fp;
    if (/^[0-9A-F]{64}$/.test(fp)) {
      normalized = fp.match(/.{2}/g).join(':');
    }
    if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(normalized)) continue;
    if (/^(00:){31}00$/.test(normalized)) continue;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      valid.push(normalized);
    }
  }
  return valid;
}

function getLanUrlsList(portNum) {
  const port = Number(portNum || process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000) || 3000;
  const nets = os.networkInterfaces();
  const lanUrls = [];
  for (const list of Object.values(nets)) {
    if (!Array.isArray(list)) continue;
    for (const iface of list) {
      if (iface && iface.family === 'IPv4' && !iface.internal) {
        lanUrls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return lanUrls;
}

function normalizeServerUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  return parsed.origin + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '');
}

function isLocalOrIpHostname(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '10.0.2.2' || h === 'awlad-selim-server') return true;
  if (h.endsWith('.local')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function resolveSafeConnectionProfiles(sysSettings = {}, lanUrlsInput = null, portInput = null) {
  const port = Number(portInput || process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000) || 3000;
  const lanUrls = Array.isArray(lanUrlsInput) && lanUrlsInput.length > 0
    ? lanUrlsInput.map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean)
    : getLanUrlsList(port);
  const firstLanIp = lanUrls[0]
    ? lanUrls[0].replace(/^https?:\/\//i, '').split(':')[0]
    : '192.168.1.100';

  const stored = sysSettings?.extraSettings?.connectionConfig || {};
  const activeMode = CONNECTION_MODES.has(stored.activeMode) ? stored.activeMode : 'local_network';

  const tunnelRuntimeUrl =
    tunnelRuntimeState.status === 'online' && /^https:\/\//i.test(tunnelRuntimeState.tunnelUrl || '')
      ? normalizeServerUrl(tunnelRuntimeState.tunnelUrl)
      : '';

  const localIpRaw = String(stored.localNetwork?.ip || firstLanIp || '192.168.1.100').trim();
  const cleanLocalIp = localIpRaw.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0] || '192.168.1.100';
  const localPort = Math.min(65535, Math.max(1, Number(stored.localNetwork?.port || port) || port));

  return {
    activeMode,
    configVersion: Math.max(1, Number(stored.configVersion || 1) || 1),
    localNetwork: {
      ip: cleanLocalIp,
      port: localPort,
      hostname: String(stored.localNetwork?.hostname || os.hostname() || 'awlad-selim-server').slice(0, 120),
    },
    freeRemote: {
      tunnelUrl: normalizeServerUrl(stored.freeRemote?.tunnelUrl || '') || tunnelRuntimeUrl || '',
      autoDetect: stored.freeRemote?.autoDetect !== false,
    },
    proRemote: {
      domainUrl: normalizeServerUrl(stored.proRemote?.domainUrl || ''),
      provider: String(stored.proRemote?.provider || 'cloudflare_named_tunnel'),
    },
    cloudVps: {
      vpsUrl: normalizeServerUrl(stored.cloudVps?.vpsUrl || ''),
      notes: String(stored.cloudVps?.notes || '').slice(0, 400),
    },
    enforceHttpsForRemote: stored.enforceHttpsForRemote !== false,
    updatedAt: stored.updatedAt || nowIso(),
  };
}

function buildFallbackEndpoints(profiles) {
  const list = [];
  if (profiles.proRemote?.domainUrl) {
    list.push({
      mode: 'pro_remote',
      url: profiles.proRemote.domainUrl,
      label: 'الاتصال الاحترافي (Named Tunnel + HTTPS)',
    });
  }
  if (profiles.cloudVps?.vpsUrl) {
    list.push({
      mode: 'cloud_vps',
      url: profiles.cloudVps.vpsUrl,
      label: 'السيرفر السحابي الدائم (Cloud VPS)',
    });
  }
  if (profiles.freeRemote?.tunnelUrl) {
    list.push({
      mode: 'free_remote',
      url: profiles.freeRemote.tunnelUrl,
      label: 'الاتصال الخارجي المجاني (Quick Tunnel)',
    });
  }
  if (profiles.localNetwork?.ip) {
    list.push({
      mode: 'local_network',
      url: `http://${profiles.localNetwork.ip}:${profiles.localNetwork.port || 3000}`,
      label: 'الشبكة المحلية (Local Network)',
    });
  }
  return list;
}

function resolveActiveEndpointFromProfiles(profiles, fallbackOrigin = '') {
  switch (profiles.activeMode) {
    case 'pro_remote':
      return profiles.proRemote?.domainUrl || fallbackOrigin;
    case 'cloud_vps':
      return profiles.cloudVps?.vpsUrl || fallbackOrigin;
    case 'free_remote':
      return profiles.freeRemote?.tunnelUrl || fallbackOrigin;
    case 'local_network':
    default:
      return profiles.localNetwork?.ip
        ? `http://${profiles.localNetwork.ip}:${profiles.localNetwork.port || 3000}`
        : fallbackOrigin;
  }
}

function resolveRequestOrigin(req) {
  if (!req) return '';
  const xfProto = String(req.get?.('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  const proto = xfProto || (req.secure ? 'https' : req.protocol || 'http');
  const xfHost = req.app?.get?.('trust proxy') ? String(req.get?.('x-forwarded-host') || '').split(',')[0].trim() : '';
  const host = xfHost || String(req.get?.('host') || '').trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

function computeTokenStatus(row) {
  if (!row) return 'invalid';
  if (row.revokedAt || row.revoked_at) return 'revoked';
  const expiresAt = row.expiresAt || row.expires_at;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return 'expired';
  const singleUse = Boolean(row.singleUse ?? row.single_use);
  const usedCount = Number(row.usedCount ?? row.used_count ?? 0);
  if (singleUse && usedCount >= 1) return 'used';
  return 'active';
}

function mapPgPairingTokenRow(r) {
  if (!r) return null;
  const mapped = {
    id: r.id,
    tokenPreview: r.token_preview,
    createdByUserId: r.created_by_user_id || undefined,
    createdByName: r.created_by_name,
    targetUserId: r.target_user_id || undefined,
    targetUserName: r.target_user_name || undefined,
    targetRole: r.target_role || undefined,
    targetDeviceType: r.target_device_type || 'any',
    connectionMode: r.connection_mode || 'auto',
    serverBaseUrl: r.server_base_url || '',
    expiresAt: isoTimestamp(r.expires_at),
    singleUse: Boolean(r.single_use),
    usedCount: Number(r.used_count || 0),
    lastUsedAt: r.last_used_at ? isoTimestamp(r.last_used_at) : undefined,
    requireAdminApproval: Boolean(r.require_admin_approval),
    revokedAt: r.revoked_at ? isoTimestamp(r.revoked_at) : undefined,
    notes: r.notes || '',
    createdAt: isoTimestamp(r.created_at),
  };
  return { ...mapped, status: computeTokenStatus(mapped) };
}

function mapJsonPairingTokenRecord(t) {
  if (!t) return null;
  const { tokenHash, ...rest } = t;
  return {
    ...rest,
    status: computeTokenStatus(rest),
  };
}

function mapPairedDeviceRecord(r) {
  if (!r) return null;
  const lastSeenAt = isoTimestamp(r.last_seen_at ?? r.lastSeenAt);
  const lastSeenMs = new Date(lastSeenAt).getTime();
  const status = r.status || 'active';
  const isRecentlyOnline =
    status === 'active' && Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs <= 5 * 60 * 1000;
  return {
    deviceId: r.device_id ?? r.deviceId,
    deviceName: r.device_name ?? r.deviceName,
    deviceType: r.device_type ?? r.deviceType ?? 'web',
    osVersion: r.os_version ?? r.osVersion ?? '',
    appVersion: r.app_version ?? r.appVersion ?? '',
    linkedUserId: (r.linked_user_id ?? r.linkedUserId) || undefined,
    linkedUserName: (r.linked_user_name ?? r.linkedUserName) || undefined,
    connectionMode: r.connection_mode ?? r.connectionMode ?? 'local_network',
    serverUrlUsed: (r.server_url_used ?? r.serverUrlUsed) || undefined,
    ipAddress: (r.ip_address ?? r.ipAddress) || undefined,
    status,
    pairingTokenId: (r.pairing_token_id ?? r.pairingTokenId) || undefined,
    configVersion: Number(r.config_version ?? r.configVersion ?? 1),
    pairedAt: isoTimestamp(r.paired_at ?? r.pairedAt),
    lastSeenAt,
    revokedAt: r.revoked_at || r.revokedAt ? isoTimestamp(r.revoked_at ?? r.revokedAt) : undefined,
    isRecentlyOnline,
    notes: r.notes || '',
  };
}

export async function getConnectionDiscoveryPayload(req = null) {
  await ensureStrictPgReady();
  const port = Number(process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000) || 3000;
  const lanUrls = getLanUrlsList(port);
  const sys = await getSystemSettingsSafe();
  const authStatus = await getAuthStatus();
  const profiles = resolveSafeConnectionProfiles(sys, lanUrls, port);
  const currentHostUrl = normalizeServerUrl(resolveRequestOrigin(req)) || resolveActiveEndpointFromProfiles(profiles, lanUrls[0] || `http://127.0.0.1:${port}`);
  const httpsActive = Boolean(req?.secure || String(req?.get?.('x-forwarded-proto') || '').toLowerCase().includes('https') || /^https:\/\//i.test(currentHostUrl));
  const fallbackEndpoints = buildFallbackEndpoints(profiles);
  const activeEndpoint = resolveActiveEndpointFromProfiles(profiles, currentHostUrl);

  return {
    ok: true,
    service: 'AWLAD SELIM Enterprise Server',
    version: '3.0.0',
    timestamp: nowIso(),
    installationId: authStatus.installationId,
    companyName: sys?.companyName || 'مؤسسة أولاد سليم للتجارة والتوزيع',
    activeMode: profiles.activeMode,
    configVersion: profiles.configVersion || 1,
    supportedModes: ['local_network', 'free_remote', 'pro_remote', 'cloud_vps'],
    port,
    httpsActive,
    activeEndpoint,
    currentHostUrl,
    lanUrls,
    profiles,
    fallbackEndpoints,
    tunnelStatus: getTunnelRuntimeStatus(),
  };
}

export async function listPairingTokens() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM pairing_tokens ORDER BY created_at DESC LIMIT 200');
    return res.rows.map(mapPgPairingTokenRow);
  }
  const db = readJsonDatabase();
  const list = Array.isArray(db.pairingTokens) ? db.pairingTokens : [];
  return [...list]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 200)
    .map(mapJsonPairingTokenRecord);
}

export async function createPairingToken(input = {}, actor = null, req = null) {
  const sys = await getSystemSettingsSafe();
  const port = Number(process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000) || 3000;
  const lanUrls = getLanUrlsList(port);
  const profiles = resolveSafeConnectionProfiles(sys, lanUrls, port);

  const requestedModeRaw = String(input.connectionMode || 'auto').trim();
  const connectionMode =
    requestedModeRaw === 'auto' || CONNECTION_MODES.has(requestedModeRaw)
      ? requestedModeRaw
      : profiles.activeMode;

  const requestOrigin = normalizeServerUrl(resolveRequestOrigin(req));
  const candidateBaseUrl = normalizeServerUrl(
    input.serverBaseUrl ||
      (connectionMode !== 'auto'
        ? resolveActiveEndpointFromProfiles({ ...profiles, activeMode: connectionMode }, requestOrigin)
        : resolveActiveEndpointFromProfiles(profiles, requestOrigin)) ||
      lanUrls[0] ||
      `http://127.0.0.1:${port}`
  );

  if (!candidateBaseUrl) {
    throw new AppError(400, 'عنوان السيرفر المختار لإنشاء رابط الربط غير صالح.', 'INVALID_SERVER_URL');
  }

  let parsedBase;
  try {
    parsedBase = new URL(candidateBaseUrl);
  } catch {
    throw new AppError(400, 'صيغة عنوان السيرفر غير صالحة.', 'INVALID_SERVER_URL');
  }

  const effectiveMode = connectionMode === 'auto' ? profiles.activeMode : connectionMode;
  if (
    effectiveMode !== 'local_network' &&
    profiles.enforceHttpsForRemote !== false &&
    parsedBase.protocol !== 'https:'
  ) {
    throw new AppError(
      400,
      'الاتصالات الخارجية تتطلب بروتوكول HTTPS المشفر لحماية بيانات الربط.',
      'HTTPS_REQUIRED_FOR_REMOTE'
    );
  }
  if (parsedBase.protocol === 'http:' && !isLocalOrIpHostname(parsedBase.hostname) && profiles.enforceHttpsForRemote !== false) {
    throw new AppError(400, 'يُمنع إنشاء رابط HTTP لنطاق خارجي غير محلي.', 'HTTPS_REQUIRED_FOR_REMOTE');
  }

  const targetDeviceType = ['any', 'windows', 'android', 'ios'].includes(String(input.targetDeviceType || 'any'))
    ? String(input.targetDeviceType || 'any')
    : 'any';
  const ttlMinutes = Math.min(43200, Math.max(5, Number(input.ttlMinutes || 60) || 60));
  const singleUse = input.singleUse !== false;
  const requireAdminApproval = Boolean(input.requireAdminApproval);
  const notes = String(input.notes || '').trim().slice(0, 300);

  const rawToken = crypto.randomBytes(24).toString('base64url');
  const tokenHash = sha256Hex(rawToken);
  const tokenPreview = `${rawToken.slice(0, 6)}...${rawToken.slice(-4)}`;
  const id = generateServerId('PAIR');
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  let targetUser = null;
  const cleanTargetUserId = String(input.targetUserId || '').trim();

  if (await isPgMode()) {
    const tokenRecord = await withTransaction(async (client) => {
      if (cleanTargetUserId) {
        const uRes = await client.query(
          'SELECT id, full_name, role, is_active FROM users WHERE id = $1 LIMIT 1',
          [cleanTargetUserId]
        );
        if (!uRes.rows[0]) {
          throw new AppError(404, 'المستخدم المحدد لرابط الربط غير موجود', 'TARGET_USER_NOT_FOUND');
        }
        targetUser = {
          id: uRes.rows[0].id,
          fullName: uRes.rows[0].full_name,
          role: uRes.rows[0].role,
        };
      }

      const ins = await client.query(
        `INSERT INTO pairing_tokens (
          id, token_hash, token_preview, created_by_user_id, created_by_name,
          target_user_id, target_user_name, target_role, target_device_type,
          connection_mode, server_base_url, expires_at, single_use, used_count,
          require_admin_approval, notes, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16)
        RETURNING *`,
        [
          id,
          tokenHash,
          tokenPreview,
          actor?.id || null,
          actor?.fullName || 'النظام',
          targetUser?.id || null,
          targetUser?.fullName || '',
          targetUser?.role || '',
          targetDeviceType,
          effectiveMode,
          candidateBaseUrl,
          expiresAt,
          singleUse,
          requireAdminApproval,
          notes,
          now,
        ]
      );
      return mapPgPairingTokenRow(ins.rows[0]);
    });

    await recordAuditLog({
      userId: actor?.id,
      userName: actor?.fullName || 'النظام',
      action: 'إنشاء رابط ربط جهاز ورمز QR',
      module: 'إعدادات الاتصال والأجهزة',
      recordId: id,
    });

    const directInviteUrl = `${candidateBaseUrl}/pair/${rawToken}`;
    const deepLinkUrl = `awladselim://pair?token=${encodeURIComponent(rawToken)}&server=${encodeURIComponent(candidateBaseUrl)}&mode=${encodeURIComponent(effectiveMode)}`;
    return {
      ok: true,
      tokenRecord,
      rawToken,
      serverBaseUrl: candidateBaseUrl,
      directInviteUrl,
      deepLinkUrl,
      qrPayload: directInviteUrl,
    };
  }

  const tokenRecord = await withJsonTransaction((db) => {
    if (!Array.isArray(db.pairingTokens)) db.pairingTokens = [];
    if (cleanTargetUserId) {
      const u = (db.users || []).find((usr) => usr.id === cleanTargetUserId);
      if (!u) {
        throw new AppError(404, 'المستخدم المحدد لرابط الربط غير موجود', 'TARGET_USER_NOT_FOUND');
      }
      targetUser = { id: u.id, fullName: u.fullName, role: u.role };
    }
    const rec = {
      id,
      tokenHash,
      tokenPreview,
      createdByUserId: actor?.id || undefined,
      createdByName: actor?.fullName || 'النظام',
      targetUserId: targetUser?.id || undefined,
      targetUserName: targetUser?.fullName || undefined,
      targetRole: targetUser?.role || undefined,
      targetDeviceType,
      connectionMode: effectiveMode,
      serverBaseUrl: candidateBaseUrl,
      expiresAt,
      singleUse,
      usedCount: 0,
      requireAdminApproval,
      notes,
      createdAt: now,
    };
    db.pairingTokens.unshift(rec);
    return mapJsonPairingTokenRecord(rec);
  });

  await recordAuditLog({
    userId: actor?.id,
    userName: actor?.fullName || 'النظام',
    action: 'إنشاء رابط ربط جهاز ورمز QR',
    module: 'إعدادات الاتصال والأجهزة',
    recordId: id,
  });

  const directInviteUrl = `${candidateBaseUrl}/pair/${rawToken}`;
  const deepLinkUrl = `awladselim://pair?token=${encodeURIComponent(rawToken)}&server=${encodeURIComponent(candidateBaseUrl)}&mode=${encodeURIComponent(effectiveMode)}`;
  return {
    ok: true,
    tokenRecord,
    rawToken,
    serverBaseUrl: candidateBaseUrl,
    directInviteUrl,
    deepLinkUrl,
    qrPayload: directInviteUrl,
  };
}

export async function revokePairingToken(tokenId, actor = null) {
  const now = nowIso();
  if (await isPgMode()) {
    const res = await withTransaction(async (client) => {
      const upd = await client.query(
        'UPDATE pairing_tokens SET revoked_at = COALESCE(revoked_at, $1) WHERE id = $2 RETURNING *',
        [now, tokenId]
      );
      if (!upd.rows[0]) {
        throw new AppError(404, 'رابط الربط غير موجود', 'PAIRING_TOKEN_NOT_FOUND');
      }
      return mapPgPairingTokenRow(upd.rows[0]);
    });
    await recordAuditLog({
      userId: actor?.id,
      userName: actor?.fullName || 'النظام',
      action: 'إلغاء رابط ربط جهاز',
      module: 'إعدادات الاتصال والأجهزة',
      recordId: tokenId,
    });
    return { ok: true, tokenRecord: res };
  }

  const tokenRecord = await withJsonTransaction((db) => {
    const target = (db.pairingTokens || []).find((t) => t.id === tokenId);
    if (!target) {
      throw new AppError(404, 'رابط الربط غير موجود', 'PAIRING_TOKEN_NOT_FOUND');
    }
    target.revokedAt = target.revokedAt || now;
    return mapJsonPairingTokenRecord(target);
  });
  await recordAuditLog({
    userId: actor?.id,
    userName: actor?.fullName || 'النظام',
    action: 'إلغاء رابط ربط جهاز',
    module: 'إعدادات الاتصال والأجهزة',
    recordId: tokenId,
  });
  return { ok: true, tokenRecord };
}

export async function inspectPairingTokenPublic(rawToken) {
  await ensureStrictPgReady();
  const clean = String(rawToken || '').trim();
  if (!clean) {
    return { valid: false, status: 'invalid', tokenRecord: null };
  }
  const tokenHash = sha256Hex(clean);
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM pairing_tokens WHERE token_hash = $1 LIMIT 1', [tokenHash]);
    if (!res.rows[0]) return { valid: false, status: 'invalid', tokenRecord: null };
    const tokenRecord = mapPgPairingTokenRow(res.rows[0]);
    return {
      valid: tokenRecord.status === 'active',
      status: tokenRecord.status,
      tokenRecord,
    };
  }
  const db = readJsonDatabase();
  const found = (db.pairingTokens || []).find((t) => t.tokenHash === tokenHash);
  if (!found) return { valid: false, status: 'invalid', tokenRecord: null };
  const tokenRecord = mapJsonPairingTokenRecord(found);
  return {
    valid: tokenRecord.status === 'active',
    status: tokenRecord.status,
    tokenRecord,
  };
}

export async function claimPairingToken(input = {}, req = null) {
  const rawToken = String(input.token || input.rawToken || '').trim();
  if (!rawToken || rawToken.length < 10) {
    throw new AppError(400, 'رمز الربط مفقود أو غير صالح', 'INVALID_PAIRING_TOKEN');
  }
  const tokenHash = sha256Hex(rawToken);
  const now = nowIso();
  const cleanDeviceId = String(input.deviceId || req?.get?.('x-device-id') || generateServerId('DEV'))
    .trim()
    .slice(0, 64);
  const deviceTypeRaw = String(input.deviceType || 'android').trim().toLowerCase();
  const deviceType = ['windows', 'android', 'ios', 'web'].includes(deviceTypeRaw) ? deviceTypeRaw : 'android';
  const deviceName = String(input.deviceName || `${deviceType.toUpperCase()} Device`).trim().slice(0, 120);
  const osVersion = String(input.osVersion || '').trim().slice(0, 80);
  const appVersion = String(input.appVersion || '3.0.0').trim().slice(0, 40);
  const ipAddress = String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 64);

  const discovery = await getConnectionDiscoveryPayload(req);
  const profiles = discovery.profiles;

  const validateTokenState = (tok) => {
    if (!tok) {
      throw new AppError(404, 'رابط أو رمز الربط غير صحيح أو غير موجود.', 'PAIRING_TOKEN_NOT_FOUND');
    }
    const status = computeTokenStatus(tok);
    if (status === 'revoked') {
      throw new AppError(410, 'تم إلغاء رابط الربط هذا من قِبل الإدارة.', 'PAIRING_TOKEN_REVOKED');
    }
    if (status === 'expired') {
      throw new AppError(410, 'انتهت صلاحية رابط الربط. يرجى طلب رابط جديد من الإدارة.', 'PAIRING_TOKEN_EXPIRED');
    }
    if (status === 'used') {
      throw new AppError(409, 'تم استخدام رابط الربط هذا مسبقاً (مخصص لمرة واحدة فقط).', 'PAIRING_TOKEN_USED');
    }
    const targetType = tok.targetDeviceType || tok.target_device_type || 'any';
    if (targetType !== 'any' && targetType !== deviceType && deviceType !== 'web') {
      throw new AppError(
        403,
        `هذا الرابط مخصص لأجهزة (${targetType}) فقط ولا يمكن استخدامه على (${deviceType}).`,
        'PAIRING_DEVICE_TYPE_MISMATCH'
      );
    }
  };

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const tokRes = await client.query('SELECT * FROM pairing_tokens WHERE token_hash = $1 FOR UPDATE', [tokenHash]);
      const tokRow = tokRes.rows[0];
      validateTokenState(tokRow);

      await client.query(
        'UPDATE pairing_tokens SET used_count = used_count + 1, last_used_at = $1 WHERE id = $2',
        [now, tokRow.id]
      );

      const endpointUrl = normalizeServerUrl(
        tokRow.server_base_url || input.serverUrlUsed || discovery.activeEndpoint || discovery.currentHostUrl
      );
      const connectionMode =
        tokRow.connection_mode && tokRow.connection_mode !== 'auto'
          ? tokRow.connection_mode
          : profiles.activeMode;
      const deviceStatus = tokRow.require_admin_approval ? 'pending_approval' : 'active';

      const existingDev = await client.query('SELECT * FROM paired_devices WHERE device_id = $1 LIMIT 1', [cleanDeviceId]);
      let devRow;
      if (existingDev.rows[0]) {
        const upd = await client.query(
          `UPDATE paired_devices SET
             device_name = $1,
             device_type = $2,
             os_version = $3,
             app_version = $4,
             linked_user_id = COALESCE($5, linked_user_id),
             linked_user_name = COALESCE(NULLIF($6, ''), linked_user_name),
             connection_mode = $7,
             server_url_used = $8,
             ip_address = COALESCE(NULLIF($9, ''), ip_address),
             status = $10,
             pairing_token_id = $11,
             config_version = $12,
             last_seen_at = $13,
             revoked_at = NULL
           WHERE device_id = $14
           RETURNING *`,
          [
            deviceName,
            deviceType,
            osVersion,
            appVersion,
            tokRow.target_user_id || null,
            tokRow.target_user_name || '',
            connectionMode,
            endpointUrl,
            ipAddress,
            deviceStatus,
            tokRow.id,
            profiles.configVersion || 1,
            now,
            cleanDeviceId,
          ]
        );
        devRow = upd.rows[0];
      } else {
        const ins = await client.query(
          `INSERT INTO paired_devices (
             device_id, device_name, device_type, os_version, app_version,
             linked_user_id, linked_user_name, connection_mode, server_url_used,
             ip_address, status, pairing_token_id, config_version, paired_at, last_seen_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
           RETURNING *`,
          [
            cleanDeviceId,
            deviceName,
            deviceType,
            osVersion,
            appVersion,
            tokRow.target_user_id || null,
            tokRow.target_user_name || '',
            connectionMode,
            endpointUrl,
            ipAddress,
            deviceStatus,
            tokRow.id,
            profiles.configVersion || 1,
            now,
          ]
        );
        devRow = ins.rows[0];
      }

      return {
        tokenId: tokRow.id,
        requiresAdminApproval: Boolean(tokRow.require_admin_approval),
        connectionMode,
        endpointUrl,
        device: mapPairedDeviceRecord(devRow),
      };
    });

    await recordAuditLog({
      userName: deviceName,
      action: 'ربط جهاز عبر رابط دعوة / QR',
      module: 'إعدادات الاتصال والأجهزة',
      recordId: cleanDeviceId,
      ipAddress,
    });

    return {
      ok: true,
      companyName: discovery.companyName,
      installationId: discovery.installationId,
      endpointUrl: result.endpointUrl,
      serverBaseUrl: result.endpointUrl,
      connectionMode: result.connectionMode,
      requiresAdminApproval: result.requiresAdminApproval,
      configVersion: discovery.configVersion,
      profiles: discovery.profiles,
      fallbackEndpoints: discovery.fallbackEndpoints,
      device: result.device,
    };
  }

  const result = await withJsonTransaction((db) => {
    if (!Array.isArray(db.pairingTokens)) db.pairingTokens = [];
    if (!Array.isArray(db.pairedDevices)) db.pairedDevices = [];
    const tok = db.pairingTokens.find((t) => t.tokenHash === tokenHash);
    validateTokenState(tok);

    tok.usedCount = Number(tok.usedCount || 0) + 1;
    tok.lastUsedAt = now;

    const endpointUrl = normalizeServerUrl(
      tok.serverBaseUrl || input.serverUrlUsed || discovery.activeEndpoint || discovery.currentHostUrl
    );
    const connectionMode =
      tok.connectionMode && tok.connectionMode !== 'auto' ? tok.connectionMode : profiles.activeMode;
    const deviceStatus = tok.requireAdminApproval ? 'pending_approval' : 'active';

    let existingDev = db.pairedDevices.find((d) => d.deviceId === cleanDeviceId);
    if (existingDev) {
      existingDev.deviceName = deviceName;
      existingDev.deviceType = deviceType;
      existingDev.osVersion = osVersion;
      existingDev.appVersion = appVersion;
      if (tok.targetUserId) existingDev.linkedUserId = tok.targetUserId;
      if (tok.targetUserName) existingDev.linkedUserName = tok.targetUserName;
      existingDev.connectionMode = connectionMode;
      existingDev.serverUrlUsed = endpointUrl;
      if (ipAddress) existingDev.ipAddress = ipAddress;
      existingDev.status = deviceStatus;
      existingDev.pairingTokenId = tok.id;
      existingDev.configVersion = profiles.configVersion || 1;
      existingDev.lastSeenAt = now;
      delete existingDev.revokedAt;
    } else {
      existingDev = {
        deviceId: cleanDeviceId,
        deviceName,
        deviceType,
        osVersion,
        appVersion,
        linkedUserId: tok.targetUserId || undefined,
        linkedUserName: tok.targetUserName || undefined,
        connectionMode,
        serverUrlUsed: endpointUrl,
        ipAddress,
        status: deviceStatus,
        pairingTokenId: tok.id,
        configVersion: profiles.configVersion || 1,
        pairedAt: now,
        lastSeenAt: now,
        notes: tok.notes || '',
      };
      db.pairedDevices.unshift(existingDev);
    }

    return {
      requiresAdminApproval: Boolean(tok.requireAdminApproval),
      connectionMode,
      endpointUrl,
      device: mapPairedDeviceRecord(existingDev),
    };
  });

  await recordAuditLog({
    userName: deviceName,
    action: 'ربط جهاز عبر رابط دعوة / QR',
    module: 'إعدادات الاتصال والأجهزة',
    recordId: cleanDeviceId,
    ipAddress,
  });

  return {
    ok: true,
    companyName: discovery.companyName,
    installationId: discovery.installationId,
    endpointUrl: result.endpointUrl,
    serverBaseUrl: result.endpointUrl,
    connectionMode: result.connectionMode,
    requiresAdminApproval: result.requiresAdminApproval,
    configVersion: discovery.configVersion,
    profiles: discovery.profiles,
    fallbackEndpoints: discovery.fallbackEndpoints,
    device: result.device,
  };
}

export async function listPairedDevices() {
  let devices = [];
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM paired_devices ORDER BY last_seen_at DESC LIMIT 300');
    devices = res.rows.map(mapPairedDeviceRecord);
  } else {
    const db = readJsonDatabase();
    const raw = Array.isArray(db.pairedDevices) ? db.pairedDevices : [];
    devices = [...raw]
      .sort((a, b) => new Date(b.lastSeenAt || b.pairedAt).getTime() - new Date(a.lastSeenAt || a.pairedAt).getTime())
      .map(mapPairedDeviceRecord);
  }

  const summary = {
    total: devices.length,
    active: devices.filter((d) => d.status === 'active').length,
    pendingApproval: devices.filter((d) => d.status === 'pending_approval').length,
    revoked: devices.filter((d) => d.status === 'revoked').length,
    onlineNow: devices.filter((d) => d.isRecentlyOnline).length,
  };
  return { devices, summary };
}

export async function approvePairedDevice(deviceId, actor = null) {
  const now = nowIso();
  if (await isPgMode()) {
    const device = await withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE paired_devices SET status = 'active', revoked_at = NULL, last_seen_at = COALESCE(last_seen_at, $1)
         WHERE device_id = $2 RETURNING *`,
        [now, deviceId]
      );
      if (!upd.rows[0]) {
        throw new AppError(404, 'الجهاز المطلوب اعتماده غير موجود', 'DEVICE_NOT_FOUND');
      }
      return mapPairedDeviceRecord(upd.rows[0]);
    });
    await recordAuditLog({
      userId: actor?.id,
      userName: actor?.fullName || 'النظام',
      action: 'اعتماد جهاز مرتبط',
      module: 'إعدادات الاتصال والأجهزة',
      recordId: deviceId,
    });
    return device;
  }

  const device = await withJsonTransaction((db) => {
    const dev = (db.pairedDevices || []).find((d) => d.deviceId === deviceId);
    if (!dev) {
      throw new AppError(404, 'الجهاز المطلوب اعتماده غير موجود', 'DEVICE_NOT_FOUND');
    }
    dev.status = 'active';
    delete dev.revokedAt;
    return mapPairedDeviceRecord(dev);
  });
  await recordAuditLog({
    userId: actor?.id,
    userName: actor?.fullName || 'النظام',
    action: 'اعتماد جهاز مرتبط',
    module: 'إعدادات الاتصال والأجهزة',
    recordId: deviceId,
  });
  return device;
}

export async function revokePairedDevice(deviceId, actor = null) {
  const now = nowIso();
  if (await isPgMode()) {
    const device = await withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE paired_devices SET status = 'revoked', revoked_at = $1 WHERE device_id = $2 RETURNING *`,
        [now, deviceId]
      );
      if (!upd.rows[0]) {
        throw new AppError(404, 'الجهاز غير موجود في سجل الأجهزة', 'DEVICE_NOT_FOUND');
      }
      await client.query(
        `UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, $1) WHERE device_id = $2`,
        [now, deviceId]
      );
      return mapPairedDeviceRecord(upd.rows[0]);
    });
    await recordAuditLog({
      userId: actor?.id,
      userName: actor?.fullName || 'النظام',
      action: 'فصل وإلغاء ربط جهاز',
      module: 'إعدادات الاتصال والأجهزة',
      recordId: deviceId,
    });
    return device;
  }

  const device = await withJsonTransaction((db) => {
    const dev = (db.pairedDevices || []).find((d) => d.deviceId === deviceId);
    if (!dev) {
      throw new AppError(404, 'الجهاز غير موجود في سجل الأجهزة', 'DEVICE_NOT_FOUND');
    }
    dev.status = 'revoked';
    dev.revokedAt = now;
    return mapPairedDeviceRecord(dev);
  });

  const sessions = readJsonSessions();
  let changed = false;
  for (const s of sessions) {
    if (s.deviceId === deviceId && !s.revokedAt) {
      s.revokedAt = now;
      changed = true;
    }
  }
  if (changed) writeJsonSessions(sessions);

  await recordAuditLog({
    userId: actor?.id,
    userName: actor?.fullName || 'النظام',
    action: 'فصل وإلغاء ربط جهاز',
    module: 'إعدادات الاتصال والأجهزة',
    recordId: deviceId,
  });
  return device;
}

export async function pushConnectionConfigUpdate(actor = null) {
  const now = nowIso();
  const sys = await getSystemSettingsSafe();
  const currentProfiles = resolveSafeConnectionProfiles(sys);
  const nextConfig = {
    ...currentProfiles,
    configVersion: Number(currentProfiles.configVersion || 1) + 1,
    updatedAt: now,
  };

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const existing = await client.query('SELECT id, extra_settings FROM system_settings LIMIT 1');
      if (existing.rows[0]) {
        const cur = existing.rows[0];
        const mergedExtra = { ...(cur.extra_settings || {}), connectionConfig: nextConfig };
        await client.query('UPDATE system_settings SET extra_settings = $1, updated_at = $2 WHERE id = $3', [
          JSON.stringify(mergedExtra),
          now,
          cur.id,
        ]);
      } else {
        await client.query(
          `INSERT INTO system_settings (id, extra_settings, updated_at) VALUES ('default', $1, $2)`,
          [JSON.stringify({ connectionConfig: nextConfig }), now]
        );
      }
    });
  } else {
    await withJsonTransaction((db) => {
      db.settings = db.settings || {};
      db.settings.extraSettings = db.settings.extraSettings || {};
      db.settings.extraSettings.connectionConfig = nextConfig;
    });
  }

  await recordAuditLog({
    userId: actor?.id,
    userName: actor?.fullName || 'النظام',
    action: `تعميم تحديث إعدادات الاتصال (v${nextConfig.configVersion})`,
    module: 'إعدادات الاتصال والأجهزة',
  });
  return nextConfig;
}

export async function updateTunnelRuntimeStatus(input = {}, actor = null) {
  await ensureStrictPgReady();
  const now = nowIso();
  const allowedStatus = new Set(['offline', 'starting', 'online', 'error']);
  const nextStatus = allowedStatus.has(input.status) ? input.status : tunnelRuntimeState.status;
  const cleanTunnelUrl = input.tunnelUrl ? normalizeServerUrl(input.tunnelUrl) : '';

  if (cleanTunnelUrl && !/^https:\/\//i.test(cleanTunnelUrl)) {
    throw new AppError(400, 'رابط النفق الخارجي يجب أن يستخدم HTTPS', 'INVALID_TUNNEL_URL');
  }

  tunnelRuntimeState = {
    status: nextStatus,
    provider: String(input.provider || tunnelRuntimeState.provider || 'cloudflare').slice(0, 60),
    tunnelUrl: cleanTunnelUrl || (nextStatus === 'offline' ? '' : tunnelRuntimeState.tunnelUrl),
    localPort: Number(input.localPort || tunnelRuntimeState.localPort || 3000) || 3000,
    startedAt:
      nextStatus === 'online'
        ? tunnelRuntimeState.startedAt || now
        : nextStatus === 'offline'
        ? null
        : tunnelRuntimeState.startedAt,
    updatedAt: now,
    lastError: input.lastError !== undefined ? (input.lastError ? String(input.lastError).slice(0, 300) : null) : null,
  };

  let updatedConnectionConfig = null;
  if (nextStatus === 'online' && cleanTunnelUrl) {
    const sys = await getSystemSettingsSafe();
    const curProfiles = resolveSafeConnectionProfiles(sys);
    if (curProfiles.freeRemote?.autoDetect !== false && curProfiles.freeRemote?.tunnelUrl !== cleanTunnelUrl) {
      const nextCfg = {
        ...curProfiles,
        configVersion: Number(curProfiles.configVersion || 1) + 1,
        freeRemote: {
          ...curProfiles.freeRemote,
          tunnelUrl: cleanTunnelUrl,
          autoDetect: true,
        },
        updatedAt: now,
      };
      if (await isPgMode()) {
        await withTransaction(async (client) => {
          const existing = await client.query('SELECT id, extra_settings FROM system_settings LIMIT 1');
          if (existing.rows[0]) {
            const cur = existing.rows[0];
            const merged = { ...(cur.extra_settings || {}), connectionConfig: nextCfg };
            await client.query('UPDATE system_settings SET extra_settings = $1, updated_at = $2 WHERE id = $3', [
              JSON.stringify(merged),
              now,
              cur.id,
            ]);
          }
        });
      } else {
        await withJsonTransaction((db) => {
          db.settings = db.settings || {};
          db.settings.extraSettings = db.settings.extraSettings || {};
          db.settings.extraSettings.connectionConfig = nextCfg;
        });
      }
      updatedConnectionConfig = nextCfg;
      if (actor) {
        await recordAuditLog({
          userId: actor.id,
          userName: actor.fullName,
          action: 'تحديث رابط النفق السريع التلقائي',
          module: 'إعدادات الاتصال والأجهزة',
        });
      }
    }
  }

  return {
    tunnelStatus: getTunnelRuntimeStatus(),
    ...(updatedConnectionConfig ? { connectionConfig: updatedConnectionConfig } : {}),
  };
}

export async function recordDeviceHeartbeat(deviceId, input = {}, req = null) {
  await ensureStrictPgReady();
  const cleanId = String(deviceId || req?.get?.('x-device-id') || '').trim().slice(0, 64);
  const now = nowIso();
  const ipAddress = String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 64);

  if (cleanId) {
    if (await isPgMode()) {
      const pool = getPool();
      await pool.query(
        `UPDATE paired_devices SET
           last_seen_at = $1,
           server_url_used = COALESCE(NULLIF($2, ''), server_url_used),
           ip_address = COALESCE(NULLIF($3, ''), ip_address)
         WHERE device_id = $4`,
        [now, String(input.serverUrlUsed || '').slice(0, 300), ipAddress, cleanId]
      );
    } else {
      await withJsonTransaction((db) => {
        const dev = (db.pairedDevices || []).find((d) => d.deviceId === cleanId);
        if (dev) {
          dev.lastSeenAt = now;
          if (input.serverUrlUsed) dev.serverUrlUsed = String(input.serverUrlUsed).slice(0, 300);
          if (ipAddress) dev.ipAddress = ipAddress;
        }
      });
    }
  }

  return getConnectionDiscoveryPayload(req);
}

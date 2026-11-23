import fs from 'node:fs';
import path from 'node:path';
import { verifyJwt } from '../utils/crypto.js';
import { validateActiveSession, recordAuditLog, checkDeviceAuthGuard } from '../db/stores/authStore.js';
import { AppError } from '../utils/errors.js';
import { isPgConnectionError, isStrictPostgresMode, sanitizePgErrorMessage } from '../db/postgres.js';
import { getDataPaths } from '../db/jsonLedger.js';
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
  markPgUnavailable,
  ADMIN_ONLY_PERMISSION_KEYS,
  sanitizeEffectivePermissionsForRole,
} from '../db/stores/mode.js';

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const failedLoginMap = new Map();
const PAIRING_RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_PAIRING_REQUESTS = 90;
const pairingRateMap = new Map();
let rateLimitsHydrated = false;

function getRateLimitFilePath() {
  try {
    const { dataDir } = getDataPaths();
    return path.join(dataDir, 'login_rate_limits.json');
  } catch {
    return null;
  }
}

function hydrateRateLimitsFromDisk() {
  if (rateLimitsHydrated) return;
  rateLimitsHydrated = true;
  const filePath = getRateLimitFilePath();
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const now = Date.now();
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.count === 'number' && typeof v.firstAttemptAt === 'number' && now - v.firstAttemptAt < RATE_WINDOW_MS) {
          failedLoginMap.set(k, { count: v.count, firstAttemptAt: v.firstAttemptAt });
        }
      }
    }
  } catch {
    // Ignore corrupt or unavailable rate limit cache
  }
}

function persistRateLimitsToDisk() {
  const filePath = getRateLimitFilePath();
  if (!filePath) return;
  try {
    const now = Date.now();
    const obj = {};
    for (const [k, v] of failedLoginMap.entries()) {
      if (v && now - v.firstAttemptAt < RATE_WINDOW_MS) {
        obj[k] = v;
      }
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) return;
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch {
    // Non-fatal in read-only or ephemeral test environments
  }
}

export function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function checkLoginRateLimit(req, res, next) {
  hydrateRateLimitsFromDisk();
  const ip = getClientIp(req);
  const username = String(req.body?.username || '').trim().toLowerCase();
  const key = `${ip}::${username}`;
  const now = Date.now();
  const entry = failedLoginMap.get(key);

  if (entry && now - entry.firstAttemptAt < RATE_WINDOW_MS && entry.count >= MAX_FAILED_ATTEMPTS) {
    const waitMin = Math.ceil((RATE_WINDOW_MS - (now - entry.firstAttemptAt)) / 60000);
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      error: `تم تجاوز الحد الأقصى لمحاولات تسجيل الدخول الفاشلة. يرجى المحاولة بعد ${waitMin} دقيقة.`,
    });
  }
  if (entry && now - entry.firstAttemptAt >= RATE_WINDOW_MS) {
    failedLoginMap.delete(key);
    persistRateLimitsToDisk();
  }
  req._rateLimitKey = key;
  next();
}

export async function recordLoginFailure(req, username) {
  hydrateRateLimitsFromDisk();
  const key = req._rateLimitKey || `${getClientIp(req)}::${String(username || '').toLowerCase()}`;
  const now = Date.now();
  const entry = failedLoginMap.get(key);
  if (!entry || now - entry.firstAttemptAt >= RATE_WINDOW_MS) {
    failedLoginMap.set(key, { count: 1, firstAttemptAt: now });
  } else {
    entry.count += 1;
    failedLoginMap.set(key, entry);
  }
  persistRateLimitsToDisk();
  if (failedLoginMap.get(key).count >= MAX_FAILED_ATTEMPTS) {
    await recordAuditLog({
      userName: String(username || 'مجهول'),
      action: 'حظر مؤقت لمحاولات دخول متكررة فاشلة',
      module: 'الأمان والمصادقة',
      ipAddress: getClientIp(req),
      deviceInfo: req.get('user-agent') || '',
    });
  }
}

export function clearLoginFailure(req) {
  if (req._rateLimitKey && failedLoginMap.has(req._rateLimitKey)) {
    failedLoginMap.delete(req._rateLimitKey);
    persistRateLimitsToDisk();
  }
}

const REGISTER_RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_REGISTER_REQUESTS = 25;
const registerRateMap = new Map();
const BOOTSTRAP_RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_BOOTSTRAP_REQUESTS = 15;
const bootstrapRateMap = new Map();
const REFRESH_RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_REFRESH_REQUESTS = 90;
const refreshRateMap = new Map();

function checkWindowedIpLimit(map, windowMs, maxReq, code, errorMsg) {
  return (req, res, next) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const entry = map.get(ip);
    if (!entry || now - entry.windowStart >= windowMs) {
      map.set(ip, { count: 1, windowStart: now });
      return next();
    }
    entry.count += 1;
    map.set(ip, entry);
    if (entry.count > maxReq) {
      return res.status(429).json({
        ok: false,
        code,
        error: errorMsg,
      });
    }
    return next();
  };
}

export const checkRegisterRateLimit = checkWindowedIpLimit(
  registerRateMap,
  REGISTER_RATE_WINDOW_MS,
  MAX_REGISTER_REQUESTS,
  'REGISTER_RATE_LIMITED',
  'تم تجاوز الحد المسموح به لطلبات التسجيل من هذا العنوان. يرجى المحاولة لاحقًا.'
);

export const checkBootstrapRateLimit = checkWindowedIpLimit(
  bootstrapRateMap,
  BOOTSTRAP_RATE_WINDOW_MS,
  MAX_BOOTSTRAP_REQUESTS,
  'BOOTSTRAP_RATE_LIMITED',
  'تم تجاوز الحد المسموح به لمحاولات التهيئة من هذا العنوان. يرجى المحاولة لاحقًا.'
);

export const checkRefreshRateLimit = checkWindowedIpLimit(
  refreshRateMap,
  REFRESH_RATE_WINDOW_MS,
  MAX_REFRESH_REQUESTS,
  'REFRESH_RATE_LIMITED',
  'تم تجاوز الحد المسموح به لطلبات تجديد الجلسة. يرجى المحاولة لاحقًا.'
);

export function resetAllRateLimitsForTests() {
  failedLoginMap.clear();
  pairingRateMap.clear();
  registerRateMap.clear();
  bootstrapRateMap.clear();
  refreshRateMap.clear();
  rateLimitsHydrated = true;
  const filePath = getRateLimitFilePath();
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
}

export function checkPairingRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = pairingRateMap.get(ip);
  if (!entry || now - entry.windowStart >= PAIRING_RATE_WINDOW_MS) {
    pairingRateMap.set(ip, { count: 1, windowStart: now });
    return next();
  }
  entry.count += 1;
  pairingRateMap.set(ip, entry);
  if (entry.count > MAX_PAIRING_REQUESTS) {
    return res.status(429).json({
      ok: false,
      code: 'PAIRING_RATE_LIMITED',
      error: 'تم تجاوز الحد المسموح به لطلبات الربط من هذا العنوان. يرجى الانتظار بضع دقائق.',
    });
  }
  return next();
}

export function parseCookieHeader(cookieHeader) {
  const out = {};
  const raw = String(cookieHeader || '');
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(val);
    } catch {
      out[name] = val;
    }
  }
  return out;
}

export function verifyCookieCsrfRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }
  // Custom header required on cookie-authenticated browser state changes (CORS preflight protects cross-origin)
  const xRequestedWith = String(req.get('x-requested-with') || '').trim();
  if (!xRequestedWith) {
    return false;
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      const host = String(req.get('host') || '').trim().toLowerCase();
      const allowedRaw = String(process.env.ALLOWED_ORIGINS || '').trim();
      const allowedList = allowedRaw ? allowedRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const isCapacitor = origin === 'capacitor://localhost' || origin === 'ionic://localhost';
      const isAllowedList = allowedList.includes(origin);
      const isSameHost = Boolean(host) && originHost === host;
      if (!isSameHost && !isAllowedList && !isCapacitor) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.get('authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    let token = bearerToken;
    let usingCookieAuth = false;

    if (!token) {
      const cookies = parseCookieHeader(req.get('cookie'));
      if (cookies.awlad_access_token) {
        token = cookies.awlad_access_token;
        usingCookieAuth = true;
      }
    }

    if (!token) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'مطلوب تسجيل الدخول أولاً' });
    }

    if (usingCookieAuth && !verifyCookieCsrfRequest(req)) {
      return res.status(403).json({
        ok: false,
        code: 'CSRF_FORBIDDEN',
        error: 'تم رفض الطلب لعدم تحقق حماية CSRF للجلسة.',
      });
    }

    const payload = verifyJwt(token);
    if (!payload || !payload.sub || !payload.sid || !payload.iid) {
      return res.status(401).json({ ok: false, code: 'INVALID_TOKEN', error: 'انتهت صلاحية الجلسة أو رمز الدخول غير صالح' });
    }

    const sessionCtx = await validateActiveSession(payload.sid, payload.sub, payload.iid);
    if (!sessionCtx) {
      return res.status(401).json({ ok: false, code: 'SESSION_REVOKED', error: 'الجلسة غير نشطة أو تم تسجيل الخروج منها' });
    }

    const effectiveDeviceId = req.get('x-device-id') || sessionCtx.deviceId || payload.did || '';
    if (effectiveDeviceId) {
      await checkDeviceAuthGuard(effectiveDeviceId);
    }

    const sanitizedSessionUser = {
      ...sessionCtx.user,
      permissions: sanitizeEffectivePermissionsForRole(sessionCtx.user?.role, sessionCtx.user?.permissions || {}),
    };

    req.auth = {
      sessionId: payload.sid,
      deviceId: effectiveDeviceId,
      installationId: sessionCtx.installationId,
      user: sanitizedSessionUser,
      customerProfile: sessionCtx.customerProfile,
      representativeProfile: sessionCtx.representativeProfile,
      linkWarning: sessionCtx.linkWarning,
      viaCookie: usingCookieAuth,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireStaff(req, res, next) {
  if (!req.auth?.user) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'غير مصرح' });
  }
  if (req.auth.user.role === 'customer') {
    return res.status(403).json({
      ok: false,
      code: 'FORBIDDEN_STAFF_ONLY',
      error: 'هذه العملية مخصصة لموظفي وإدارة الشركة فقط',
    });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.auth?.user) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'غير مصرح' });
  }
  if (req.auth.user.role !== 'admin') {
    return res.status(403).json({
      ok: false,
      code: 'FORBIDDEN_ADMIN_ONLY',
      error: 'هذه الصلاحية مقصورة على المدير العام فقط',
    });
  }
  next();
}

function isPermissionAllowedForUser(user, permKey) {
  if (!user || user.role === 'customer') return false;
  if (user.role === 'admin') return true;
  if (user.role === 'representative' && ADMIN_ONLY_PERMISSION_KEYS.has(permKey)) {
    return false;
  }
  return user.permissions?.[permKey] === true;
}

export function requirePermission(permKey) {
  return (req, res, next) => {
    const user = req.auth?.user;
    if (!user) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'غير مصرح' });
    }
    if (user.role === 'customer') {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح للعملاء بهذه العملية' });
    }
    if (user.role === 'representative' && ADMIN_ONLY_PERMISSION_KEYS.has(permKey)) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_ROLE_PERMISSION',
        error: `هذه الصلاحية (${permKey}) مقصورة على الإدارة ولا يمكن تفعيلها لحسابات المناديب`,
      });
    }
    if (isPermissionAllowedForUser(user, permKey)) {
      return next();
    }
    return res.status(403).json({
      ok: false,
      code: 'FORBIDDEN_PERMISSION',
      error: `ليس لديك الصلاحية المطلوبة (${permKey}) لتنفيذ هذا الإجراء`,
    });
  };
}

export function requireAnyPermission(...permKeys) {
  return (req, res, next) => {
    const user = req.auth?.user;
    if (!user) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'غير مصرح' });
    }
    if (user.role === 'customer') {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح للعملاء بهذه العملية' });
    }
    if (user.role === 'admin' || permKeys.some((k) => isPermissionAllowedForUser(user, k))) {
      return next();
    }
    return res.status(403).json({
      ok: false,
      code: 'FORBIDDEN_PERMISSION',
      error: `ليس لديك الصلاحيات المطلوبة (${permKeys.join(' أو ')}) لتنفيذ هذا الإجراء`,
    });
  };
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorMiddleware(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      ok: false,
      code: err.code,
      error: err.message,
      details: err.details,
    });
  }
  if (isStrictPostgresMode() && isPgConnectionError(err)) {
    markPgUnavailable(err?.code || 'connection_error');
    const safeMsg = sanitizePgErrorMessage(err?.message);
    console.error('[PostgreSQL Unavailable - Strict Mode]:', safeMsg || err?.code || 'connection_error');
    return res.status(503).json({
      ok: false,
      code: DATABASE_UNAVAILABLE_CODE,
      error: DATABASE_UNAVAILABLE_MESSAGE,
    });
  }
  const safeMsg = sanitizePgErrorMessage(err?.message);
  console.error('[API Error]:', safeMsg || err?.name || 'INTERNAL_ERROR');
  return res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    error: safeMsg || 'حدث خطأ داخلي في الخادم',
  });
}

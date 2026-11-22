import { verifyJwt } from '../utils/crypto.js';
import { validateActiveSession, recordAuditLog, checkDeviceAuthGuard } from '../db/stores/authStore.js';
import { AppError } from '../utils/errors.js';
import { isPgConnectionError, isStrictPostgresMode, sanitizePgErrorMessage } from '../db/postgres.js';
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
  markPgUnavailable,
} from '../db/stores/mode.js';

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const failedLoginMap = new Map();
const PAIRING_RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_PAIRING_REQUESTS = 90;
const pairingRateMap = new Map();

export function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export function checkLoginRateLimit(req, res, next) {
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
  }
  req._rateLimitKey = key;
  next();
}

export async function recordLoginFailure(req, username) {
  const key = req._rateLimitKey || `${getClientIp(req)}::${String(username || '').toLowerCase()}`;
  const now = Date.now();
  const entry = failedLoginMap.get(key);
  if (!entry || now - entry.firstAttemptAt >= RATE_WINDOW_MS) {
    failedLoginMap.set(key, { count: 1, firstAttemptAt: now });
  } else {
    entry.count += 1;
    failedLoginMap.set(key, entry);
  }
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
  if (req._rateLimitKey) {
    failedLoginMap.delete(req._rateLimitKey);
  }
}

export function resetAllRateLimitsForTests() {
  failedLoginMap.clear();
  pairingRateMap.clear();
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

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'مطلوب تسجيل الدخول أولاً' });
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

    req.auth = {
      sessionId: payload.sid,
      deviceId: effectiveDeviceId,
      installationId: sessionCtx.installationId,
      user: sessionCtx.user,
      customerProfile: sessionCtx.customerProfile,
      representativeProfile: sessionCtx.representativeProfile,
      linkWarning: sessionCtx.linkWarning,
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

export function requirePermission(permKey) {
  return (req, res, next) => {
    const user = req.auth?.user;
    if (!user) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'غير مصرح' });
    }
    if (user.role === 'customer') {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح للعملاء بهذه العملية' });
    }
    if (user.role === 'admin' || user.permissions?.[permKey] === true) {
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
    if (user.role === 'admin' || permKeys.some((k) => user.permissions?.[k] === true)) {
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

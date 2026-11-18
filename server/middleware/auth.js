import { verifyJwt } from '../utils/crypto.js';
import { validateActiveSession, validateSyncPushSession, recordAuditLog } from '../db/stores/authStore.js';
import { getDeviceStatusForGuard } from '../db/stores/connectionPairingStore.js';
import { AppError } from '../utils/errors.js';

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const failedLoginMap = new Map();

const PAIRING_RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_PAIRING_REQUESTS = 120;
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

export function checkPairingRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const key = `pair::${ip}`;
  const now = Date.now();
  const entry = pairingRateMap.get(key);
  if (!entry || now - entry.firstAt >= PAIRING_RATE_WINDOW_MS) {
    pairingRateMap.set(key, { count: 1, firstAt: now });
    return next();
  }
  if (entry.count >= MAX_PAIRING_REQUESTS) {
    return res.status(429).json({
      ok: false,
      code: 'PAIRING_RATE_LIMITED',
      error: 'تم تجاوز الحد الأقصى لطلبات ربط الأجهزة. يرجى المحاولة بعد قليل.',
    });
  }
  entry.count += 1;
  pairingRateMap.set(key, entry);
  next();
}

export function resetAllRateLimitsForTests() {
  failedLoginMap.clear();
  pairingRateMap.clear();
}

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'مطلوب تسجيل الدخول أولاً' });
    }

    const payload = verifyJwt(token);
    if (!payload || !payload.sub || !payload.sid) {
      return res.status(401).json({ ok: false, code: 'INVALID_TOKEN', error: 'انتهت صلاحية الجلسة أو رمز الدخول غير صالح' });
    }

    const reqDeviceId = String(req.get('x-device-id') || '').trim();
    if (reqDeviceId) {
      const guard = await getDeviceStatusForGuard(reqDeviceId);
      if (guard.blocked) {
        return res.status(403).json({
          ok: false,
          code: guard.code,
          error: guard.message,
          deviceStatus: guard.device?.status,
        });
      }
    }

    const sessionCtx = await validateActiveSession(payload.sid, payload.sub);
    if (!sessionCtx) {
      return res.status(401).json({ ok: false, code: 'SESSION_REVOKED', error: 'الجلسة غير نشطة أو تم تسجيل الخروج منها' });
    }

    req.auth = {
      sessionId: payload.sid,
      user: sessionCtx.user,
      customerProfile: sessionCtx.customerProfile,
      representativeProfile: sessionCtx.representativeProfile,
      linkWarning: sessionCtx.linkWarning,
      deviceId: reqDeviceId || undefined,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireSyncPushAuth(req, res, next) {
  try {
    const authHeader = req.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'مطلوب تسجيل الدخول أولاً' });
    }

    const payload = verifyJwt(token);
    if (!payload || !payload.sub || !payload.sid) {
      return res.status(401).json({ ok: false, code: 'INVALID_TOKEN', error: 'انتهت صلاحية الجلسة أو رمز الدخول غير صالح' });
    }

    const reqDeviceId = String(req.get('x-device-id') || '').trim();
    if (reqDeviceId) {
      const guard = await getDeviceStatusForGuard(reqDeviceId);
      if (guard.blocked) {
        return res.status(403).json({
          ok: false,
          code: guard.code,
          error: guard.message,
          deviceStatus: guard.device?.status,
        });
      }
    }

    const sessionCtx = await validateSyncPushSession(payload.sid, payload.sub);
    if (!sessionCtx) {
      return res.status(401).json({ ok: false, code: 'SESSION_REVOKED', error: 'الجلسة غير نشطة أو تم تسجيل الخروج منها' });
    }

    req.auth = {
      sessionId: payload.sid,
      user: sessionCtx.user,
      customerProfile: sessionCtx.customerProfile,
      representativeProfile: sessionCtx.representativeProfile,
      linkWarning: sessionCtx.linkWarning,
      deviceId: reqDeviceId || undefined,
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
  console.error('[API Error]:', err);
  return res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    error: err?.message || 'حدث خطأ داخلي في الخادم',
  });
}

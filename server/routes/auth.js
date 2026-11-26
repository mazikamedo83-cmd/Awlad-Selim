import { Router } from 'express';
import {
  getAuthStatus,
  bootstrapAdmin,
  loginUser,
  registerMobileAccount,
  refreshUserSession,
  logoutSession,
  changeOwnPassword,
  getOwnShortcuts,
  updateOwnShortcuts,
} from '../db/stores/authStore.js';
import { getSystemSettingsSafe } from '../db/stores/catalogStore.js';
import {
  asyncHandler,
  checkLoginRateLimit,
  checkRegisterRateLimit,
  checkBootstrapRateLimit,
  checkRefreshRateLimit,
  parseCookieHeader,
  verifyCookieCsrfRequest,
  recordLoginFailure,
  clearLoginFailure,
  getClientIp,
  requireAuth,
} from '../middleware/auth.js';
import { verifyJwt } from '../utils/crypto.js';

const router = Router();

function isSecureTransport(req) {
  if (req.secure) return true;
  if (req.app?.get('trust proxy')) {
    const xfProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    return xfProto === 'https';
  }
  return false;
}

function setAuthCookies(req, res, accessToken, refreshToken) {
  if (!accessToken || !refreshToken) return;
  const secure = isSecureTransport(req);
  res.cookie('awlad_access_token', accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api',
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('awlad_refresh_token', refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(req, res) {
  const secure = isSecureTransport(req);
  res.clearCookie('awlad_access_token', { httpOnly: true, secure, sameSite: 'lax', path: '/api' });
  res.clearCookie('awlad_refresh_token', { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth' });
}

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const status = await getAuthStatus();
    res.json({ ok: true, ...status });
  })
);

router.post(
  '/bootstrap-admin',
  checkBootstrapRateLimit,
  asyncHandler(async (req, res) => {
    const user = await bootstrapAdmin(req.body || {}, {
      ipAddress: getClientIp(req),
      socketRemoteAddress: req.socket?.remoteAddress || '',
      hasForwardedFor: Boolean(req.get('x-forwarded-for') || req.get('forwarded')),
      deviceInfo: req.get('user-agent') || '',
      bootstrapSecret: req.get('x-bootstrap-secret') || req.body?.bootstrapSecret || '',
    });
    res.status(201).json({ ok: true, user });
  })
);

router.post(
  '/login',
  checkLoginRateLimit,
  asyncHandler(async (req, res) => {
    try {
      const result = await loginUser({
        username: req.body?.username,
        password: req.body?.password,
        deviceId: req.get('x-device-id') || req.body?.deviceId || '',
        deviceName: req.body?.deviceName || '',
        deviceType: req.body?.deviceType || '',
        osVersion: req.body?.osVersion || '',
        appVersion: req.body?.appVersion || '',
        connectionMode: req.body?.connectionMode || '',
        serverUrlUsed: req.body?.serverUrlUsed || '',
        ipAddress: getClientIp(req),
        deviceInfo: req.get('user-agent') || '',
      });
      clearLoginFailure(req);
      setAuthCookies(req, res, result.accessToken, result.refreshToken);
      const sysSettings = await getSystemSettingsSafe();
      res.json({ ok: true, ...result, mobileConfig: sysSettings.mobileConfig });
    } catch (err) {
      if (err?.status === 401) {
        await recordLoginFailure(req, req.body?.username);
      }
      throw err;
    }
  })
);

router.post(
  '/register',
  checkRegisterRateLimit,
  asyncHandler(async (req, res) => {
    const result = await registerMobileAccount(req.body || {}, {
      deviceId: req.get('x-device-id') || req.body?.deviceId || '',
      idempotencyKey: req.get('idempotency-key') || req.body?.idempotencyKey || req.body?.operationId || '',
      ipAddress: getClientIp(req),
      deviceInfo: req.get('user-agent') || '',
    });
    setAuthCookies(req, res, result.accessToken, result.refreshToken);
    const sysSettings = await getSystemSettingsSafe();
    res.status(201).json({ ok: true, ...result, mobileConfig: sysSettings.mobileConfig });
  })
);

router.post(
  '/refresh',
  checkRefreshRateLimit,
  asyncHandler(async (req, res) => {
    const cookies = parseCookieHeader(req.get('cookie'));
    const bodyRefresh = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
    const usingCookieRefresh = !bodyRefresh && Boolean(cookies.awlad_refresh_token);
    if (usingCookieRefresh && !verifyCookieCsrfRequest(req)) {
      return res.status(403).json({
        ok: false,
        code: 'CSRF_FORBIDDEN',
        error: 'تم رفض تجديد الجلسة لعدم تحقق حماية CSRF.',
      });
    }
    const result = await refreshUserSession({
      refreshToken: bodyRefresh || cookies.awlad_refresh_token || '',
      deviceId: req.get('x-device-id') || req.body?.deviceId || '',
      ipAddress: getClientIp(req),
      deviceInfo: req.get('user-agent') || '',
    });
    setAuthCookies(req, res, result.accessToken, result.refreshToken);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const cookies = parseCookieHeader(req.get('cookie'));
    const authHeader = req.get('authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const bodyRefresh = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
    const usingCookieOnly = !bearerToken && !bodyRefresh && Boolean(cookies.awlad_access_token || cookies.awlad_refresh_token);
    if (usingCookieOnly && !verifyCookieCsrfRequest(req)) {
      return res.status(403).json({
        ok: false,
        code: 'CSRF_FORBIDDEN',
        error: 'تم رفض تسجيل الخروج لعدم تحقق حماية CSRF.',
      });
    }
    let sessionId = req.auth?.sessionId || null;
    const accessToken = bearerToken || cookies.awlad_access_token || '';
    if (!sessionId && accessToken) {
      const payload = verifyJwt(accessToken);
      if (payload?.sid) sessionId = payload.sid;
    }
    await logoutSession({
      sessionId,
      refreshToken: bodyRefresh || cookies.awlad_refresh_token || null,
    });
    clearAuthCookies(req, res);
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sysSettings = await getSystemSettingsSafe();
    res.json({
      ok: true,
      installationId: req.auth.installationId || null,
      user: req.auth.user,
      customerProfile: req.auth.customerProfile,
      representativeProfile: req.auth.representativeProfile,
      linkWarning: req.auth.linkWarning,
      mobileConfig: sysSettings.mobileConfig,
    });
  })
);

router.put(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    await changeOwnPassword(
      {
        userId: req.auth.user.id,
        currentPassword: req.body?.currentPassword,
        newPassword: req.body?.newPassword,
      },
      { ipAddress: getClientIp(req), deviceInfo: req.get('user-agent') || '' }
    );
    res.json({ ok: true, message: 'تم تحديث كلمة المرور بنجاح' });
  })
);

router.get(
  '/shortcuts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const shortcuts = await getOwnShortcuts(req.auth.user.id);
    res.json({ ok: true, shortcuts });
  })
);

router.put(
  '/shortcuts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await updateOwnShortcuts(
      req.auth.user.id,
      req.body?.shortcuts ?? [],
      { ipAddress: getClientIp(req), deviceInfo: req.get('user-agent') || '' }
    );
    res.json({ ok: true, ...result });
  })
);

export default router;

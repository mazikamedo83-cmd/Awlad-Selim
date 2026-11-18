import { Router } from 'express';
import {
  getAuthStatus,
  bootstrapAdmin,
  loginUser,
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
  recordLoginFailure,
  clearLoginFailure,
  getClientIp,
  requireAuth,
} from '../middleware/auth.js';

const router = Router();

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const status = await getAuthStatus();
    res.json({ ok: true, ...status });
  })
);

router.post(
  '/bootstrap-admin',
  asyncHandler(async (req, res) => {
    const user = await bootstrapAdmin(req.body || {}, {
      ipAddress: getClientIp(req),
      deviceInfo: req.get('user-agent') || '',
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
        ipAddress: getClientIp(req),
        deviceInfo: req.get('user-agent') || '',
      });
      clearLoginFailure(req);
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
  '/refresh',
  asyncHandler(async (req, res) => {
    const result = await refreshUserSession({
      refreshToken: req.body?.refreshToken,
      ipAddress: getClientIp(req),
      deviceInfo: req.get('user-agent') || '',
    });
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    let sessionId = null;
    if (req.auth?.sessionId) sessionId = req.auth.sessionId;
    await logoutSession({ sessionId, refreshToken: req.body?.refreshToken || null });
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

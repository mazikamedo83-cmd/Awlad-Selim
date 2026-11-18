import { Router } from 'express';
import {
  getSyncPullPayload,
  pushSyncBatch,
  listSyncConflicts,
  resolveSyncConflict,
} from '../db/stores/syncStore.js';
import { requireAuth, requireStaff, asyncHandler } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/pull',
  asyncHandler(async (req, res) => {
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const payload = await getSyncPullPayload(req.auth, { since });
    res.json({ ok: true, ...payload });
  })
);

router.post(
  '/push',
  asyncHandler(async (req, res) => {
    const deviceId = req.get('x-device-id') || req.body?.deviceId || req.auth.deviceId || '';
    const result = await pushSyncBatch(
      {
        operations: req.body?.operations || [],
        deviceId,
      },
      req.auth
    );
    res.json({ ok: true, ...result });
  })
);

router.get(
  '/conflicts',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const conflicts = await listSyncConflicts(req.auth, { status });
    res.json({ ok: true, conflicts });
  })
);

router.post(
  '/conflicts/:id/resolve',
  requireStaff,
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'admin' && !u.permissions?.canManageSales && !u.permissions?.canManageAccounts) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_CONFLICT_RESOLUTION',
        error: 'ليس لديك صلاحية معالجة تعارضات المزامنة',
      });
    }
    const result = await resolveSyncConflict(req.params.id, req.body || {}, u);
    res.json({ ok: true, ...result });
  })
);

export default router;

import { Router } from 'express';
import {
  listStockCounts,
  createStockCount,
  updateStockCount,
  submitStockCount,
  approveStockCount,
  rejectStockCount,
} from '../db/stores/stockCountsStore.js';
import {
  requireAuth,
  requireStaff,
  requirePermission,
  asyncHandler,
} from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireStaff);

router.get(
  '/',
  requirePermission('canManageInventory'),
  asyncHandler(async (_req, res) => {
    const counts = await listStockCounts();
    res.json({ ok: true, counts });
  })
);

router.post(
  '/',
  requirePermission('canCreateStockCount'),
  asyncHandler(async (req, res) => {
    const count = await createStockCount(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, count });
  })
);

router.put(
  '/:id',
  requirePermission('canCreateStockCount'),
  asyncHandler(async (req, res) => {
    const count = await updateStockCount(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, count });
  })
);

router.post(
  '/:id/submit',
  requirePermission('canCreateStockCount'),
  asyncHandler(async (req, res) => {
    const count = await submitStockCount(req.params.id, req.auth.user);
    res.json({ ok: true, count });
  })
);

router.post(
  '/:id/approve',
  requirePermission('canApproveStockCount'),
  asyncHandler(async (req, res) => {
    const count = await approveStockCount(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, count });
  })
);

router.post(
  '/:id/reject',
  requirePermission('canApproveStockCount'),
  asyncHandler(async (req, res) => {
    const count = await rejectStockCount(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, count });
  })
);

export default router;

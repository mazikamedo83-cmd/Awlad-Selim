import { Router } from 'express';
import {
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  transferStock,
  adjustStock,
  recordDamagedStock,
  createRepTransfer,
  confirmRepTransfer,
  rejectRepTransfer,
  ensureRepVanWarehouse,
  createRepItemTransfer,
  updateRepItemTransferStatus,
  renameCategoryGlobal,
} from '../db/stores/inventoryAdminStore.js';
import {
  requireAuth,
  requireStaff,
  requirePermission,
  asyncHandler,
} from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireStaff);

router.post(
  '/warehouses',
  requirePermission('canManageWarehouses'),
  asyncHandler(async (req, res) => {
    const warehouse = await createWarehouse(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, warehouse });
  })
);

router.put(
  '/warehouses/:id',
  requirePermission('canManageWarehouses'),
  asyncHandler(async (req, res) => {
    const warehouse = await updateWarehouse(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, warehouse });
  })
);

router.delete(
  '/warehouses/:id',
  requirePermission('canManageWarehouses'),
  asyncHandler(async (req, res) => {
    await deleteWarehouse(req.params.id, req.auth.user);
    res.json({ ok: true });
  })
);

router.post(
  '/transfer',
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    await transferStock(req.body || {}, req.auth.user);
    res.json({ ok: true });
  })
);

router.post(
  '/adjust',
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    await adjustStock(req.body || {}, req.auth.user);
    res.json({ ok: true });
  })
);

router.post(
  '/damaged',
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    await recordDamagedStock(req.body || {}, req.auth.user);
    res.json({ ok: true });
  })
);

router.post(
  '/rep-van-warehouse',
  asyncHandler(async (req, res) => {
    if (req.auth.user.role !== 'representative' && req.auth.user.role !== 'admin' && !req.auth.user.permissions?.canManageReps) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح بهذه العملية' });
    }
    const repName = req.body?.repName || req.auth.user.fullName;
    const warehouse = await ensureRepVanWarehouse(repName, req.auth.user);
    res.json({ ok: true, warehouse });
  })
);

router.post(
  '/rep-transfers',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'representative' && u.role !== 'admin' && !u.permissions?.canManageTransfers && !u.permissions?.canManageReps) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية إنشاء تحويل مندوب' });
    }
    const transfer = await createRepTransfer(req.body || {}, u);
    res.status(201).json({ ok: true, transfer });
  })
);

router.post(
  '/rep-transfers/:id/confirm',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'representative' && u.role !== 'admin' && !u.permissions?.canManageTransfers && !u.permissions?.canManageCashboxes) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية اعتماد التحويل' });
    }
    await confirmRepTransfer(req.params.id, req.body || {}, u);
    res.json({ ok: true });
  })
);

router.post(
  '/rep-transfers/:id/reject',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'representative' && u.role !== 'admin' && !u.permissions?.canManageTransfers) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية رفض التحويل' });
    }
    await rejectRepTransfer(req.params.id, req.body || {}, u);
    res.json({ ok: true });
  })
);

router.post(
  '/rep-item-transfers',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'representative' && u.role !== 'admin' && !u.permissions?.canManageTransfers && !u.permissions?.canManageReps) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح بإنشاء طلب تحويل أصناف' });
    }
    const request = await createRepItemTransfer(req.body || {}, u);
    res.status(201).json({ ok: true, request });
  })
);

router.post(
  '/rep-item-transfers/:id/status',
  requirePermission('canManageTransfers'),
  asyncHandler(async (req, res) => {
    await updateRepItemTransferStatus(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true });
  })
);

router.post(
  '/categories/:id/rename',
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    const category = await renameCategoryGlobal(req.params.id, req.body?.name, req.auth.user);
    res.json({ ok: true, category });
  })
);

export default router;

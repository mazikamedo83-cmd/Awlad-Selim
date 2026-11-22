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
  recordRepCustodyDelivery,
  recordRepCustodyReturn,
  recordRepCustodyAdjustment,
  getRepCustodyStatement,
  getItemMovementReport,
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

router.post(
  '/rep-custody/deliver',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (
      u.role !== 'representative' &&
      u.role !== 'admin' &&
      !u.permissions?.canManageTransfers &&
      !u.permissions?.canManageReps &&
      !u.permissions?.canManageInventory
    ) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية تسجيل التسليم من العهدة' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
    const result = await recordRepCustodyDelivery(req.body || {}, u, idempotencyKey);
    res.status(result.deduplicated ? 200 : 201).json({ ok: true, ...result });
  })
);

router.post(
  '/rep-custody/return',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (
      u.role !== 'representative' &&
      u.role !== 'admin' &&
      !u.permissions?.canManageTransfers &&
      !u.permissions?.canManageReps &&
      !u.permissions?.canManageInventory
    ) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية إرجاع عهدة المندوب للمخزن' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
    const result = await recordRepCustodyReturn(req.body || {}, u, idempotencyKey);
    res.status(result.deduplicated ? 200 : 201).json({ ok: true, ...result });
  })
);

router.post(
  '/rep-custody/adjust',
  asyncHandler(async (req, res) => {
    const operation = await recordRepCustodyAdjustment(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, operation });
  })
);

router.get(
  '/rep-custody/statement',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (
      u.role !== 'representative' &&
      u.role !== 'admin' &&
      !u.permissions?.canManageReps &&
      !u.permissions?.canManageTransfers &&
      !u.permissions?.canManageInventory &&
      !u.permissions?.canViewReports
    ) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية عرض كشف عهدة المندوب' });
    }
    const statement = await getRepCustodyStatement(
      typeof req.query.repId === 'string' ? req.query.repId : undefined,
      {
        dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
        dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
      },
      u
    );
    res.json({ ok: true, statement });
  })
);

router.get(
  '/item-movement-report',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'admin' && !u.permissions?.canViewReports && !u.permissions?.canManageInventory) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية عرض تقرير حركة الصنف' });
    }
    const report = await getItemMovementReport(
      {
        productId: typeof req.query.productId === 'string' ? req.query.productId : undefined,
        warehouseId: typeof req.query.warehouseId === 'string' ? req.query.warehouseId : undefined,
        movementType: typeof req.query.movementType === 'string' ? req.query.movementType : undefined,
        representativeId: typeof req.query.representativeId === 'string' ? req.query.representativeId : undefined,
        dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
        dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
      },
      u
    );
    res.json({ ok: true, report });
  })
);

export default router;

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
  listRepCustodyReturnRequests,
  createRepCustodyReturnRequest,
  approveRepCustodyReturnRequest,
  rejectRepCustodyReturnRequest,
} from '../db/stores/inventoryAdminStore.js';
import { getSupplierProductPriceHistory } from '../db/stores/catalogStore.js';
import {
  requireAuth,
  requireStaff,
  requirePermission,
  requireAnyPermission,
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
    const idemKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
    const transfer = await createRepTransfer(req.body || {}, u, idemKey);
    res.status(transfer?.deduplicated ? 200 : 201).json({ ok: true, transfer });
  })
);

router.post(
  '/rep-transfers/:id/confirm',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'representative' && u.role !== 'admin' && !u.permissions?.canManageTransfers && !u.permissions?.canManageCashboxes) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية اعتماد التحويل' });
    }
    const idemKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
    const result = await confirmRepTransfer(req.params.id, req.body || {}, u, idemKey);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/rep-transfers/:id/reject',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'representative' && u.role !== 'admin' && !u.permissions?.canManageTransfers) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية رفض التحويل' });
    }
    const idemKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
    const result = await rejectRepTransfer(req.params.id, req.body || {}, u, idemKey);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/rep-item-transfers',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'representative' && u.role !== 'admin' && !u.permissions?.canManageTransfers && !u.permissions?.canManageReps) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'غير مصرح بإنشاء طلب تحويل أصناف' });
    }
    const idemKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
    const request = await createRepItemTransfer(req.body || {}, u, idemKey);
    res.status(request?.deduplicated ? 200 : 201).json({ ok: true, request });
  })
);

router.post(
  '/rep-item-transfers/:id/status',
  asyncHandler(async (req, res) => {
    const idemKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
    const result = await updateRepItemTransferStatus(req.params.id, req.body || {}, req.auth.user, idemKey);
    res.json({ ok: true, ...result });
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
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
    const result = await recordRepCustodyAdjustment(req.body || {}, req.auth.user, idempotencyKey);
    res.status(result.deduplicated ? 200 : 201).json({
      ok: true,
      operation: result.operation,
      deduplicated: Boolean(result.deduplicated),
    });
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
  '/rep-custody/return-requests',
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
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية عرض طلبات إرجاع البضاعة' });
    }
    const requests = await listRepCustodyReturnRequests(u, {
      representativeId: typeof req.query.representativeId === 'string' ? req.query.representativeId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
    });
    res.json({ ok: true, requests });
  })
);

router.post(
  '/rep-custody/return-requests',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (
      u.role !== 'representative' &&
      u.role !== 'admin' &&
      !u.permissions?.canManageReps &&
      !u.permissions?.canManageTransfers &&
      !u.permissions?.canManageInventory
    ) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية إنشاء طلب إرجاع بضاعة' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
    const result = await createRepCustodyReturnRequest(req.body || {}, u, idempotencyKey);
    res.status(result.deduplicated ? 200 : 201).json({ ok: true, ...result });
  })
);

router.post(
  '/rep-custody/return-requests/:id/approve',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role === 'representative' || u.role === 'customer') {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'اعتماد طلبات إرجاع العهدة متاح للإدارة فقط' });
    }
    if (u.role !== 'admin' && !u.permissions?.canManageReps && !u.permissions?.canManageTransfers && !u.permissions?.canManageInventory) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية اعتماد طلب إرجاع البضاعة' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
    const result = await approveRepCustodyReturnRequest(req.params.id, req.body || {}, u, idempotencyKey);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/rep-custody/return-requests/:id/reject',
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role === 'representative' || u.role === 'customer') {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'رفض طلبات إرجاع العهدة متاح للإدارة فقط' });
    }
    if (u.role !== 'admin' && !u.permissions?.canManageReps && !u.permissions?.canManageTransfers && !u.permissions?.canManageInventory) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية رفض طلب إرجاع البضاعة' });
    }
    const result = await rejectRepCustodyReturnRequest(req.params.id, req.body || {}, u);
    res.json({ ok: true, ...result });
  })
);

router.get(
  '/suppliers/:id/price-history',
  requireAnyPermission('canManageAccounts', 'canManagePurchases', 'canCreatePurchase', 'canViewReports'),
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role === 'representative' && !u.permissions?.canCreatePurchase && !u.permissions?.canManagePurchases) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN_REP_SUPPLIER_PRICES', error: 'غير مصرح بعرض أسعار الموردين' });
    }
    const productId = typeof req.query.productId === 'string' ? req.query.productId : '';
    const history = await getSupplierProductPriceHistory(req.params.id, productId);
    res.json({ ok: true, history, priceHistory: history });
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
        class1: typeof req.query.class1 === 'string' ? req.query.class1 : undefined,
        class2: typeof req.query.class2 === 'string' ? req.query.class2 : undefined,
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

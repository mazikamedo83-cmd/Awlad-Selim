import { Router } from 'express';
import {
  listOrders,
  getOrderById,
  createCustomerOrder,
  updateOwnPendingOrder,
  cancelOwnPendingOrder,
  reviewCustomerOrder,
  approveCustomerOrder,
  rejectCustomerOrder,
  assignOrderDeliveryRep,
  updateOrderDeliveryStatus,
  advanceOrderStage,
  recordOrderAdvancePayment,
  convertOrderToInvoice,
} from '../db/stores/ordersStore.js';
import {
  requireAuth,
  requireStaff,
  requirePermission,
  asyncHandler,
} from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const orders = await listOrders(req.auth, {
      customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      requesterType: typeof req.query.requesterType === 'string' ? req.query.requesterType : undefined,
      dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });
    res.json({ ok: true, orders });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.id, req.auth);
    res.json({ ok: true, order });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const role = req.auth.user.role;
    const isCustomer = role === 'customer';
    const isRep = role === 'representative';
    if (!isCustomer && !isRep && role !== 'admin' && !req.auth.user.permissions?.canManageSales && !req.auth.user.permissions?.canAdd) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية إنشاء طلبات عملاء أو مندوبين' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey;
    const { order, deduplicated } = await createCustomerOrder(
      { ...(req.body || {}), idempotencyKey },
      req.auth
    );
    res.status(deduplicated ? 200 : 201).json({ ok: true, order, deduplicated });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await updateOwnPendingOrder(req.params.id, req.body || {}, req.auth);
    res.json({ ok: true, order });
  })
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const order = await cancelOwnPendingOrder(req.params.id, req.body || {}, req.auth);
    res.json({ ok: true, order });
  })
);

router.post(
  '/:id/review',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const order = await reviewCustomerOrder(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, order });
  })
);

router.post(
  '/:id/approve',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const order = await approveCustomerOrder(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, order });
  })
);

router.post(
  '/:id/reject',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const order = await rejectCustomerOrder(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, order });
  })
);

router.post(
  '/:id/assign-rep',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const order = await assignOrderDeliveryRep(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, order });
  })
);

router.post(
  '/:id/delivery-status',
  requireStaff,
  asyncHandler(async (req, res) => {
    const user = req.auth.user;
    if (user.role !== 'admin' && user.role !== 'representative' && !user.permissions?.canManageSales) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية تحديث حالة التوصيل' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
    const result = await updateOrderDeliveryStatus(
      req.params.id,
      { ...(req.body || {}), idempotencyKey },
      req.auth
    );
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/:id/advance-payment',
  requireStaff,
  asyncHandler(async (req, res) => {
    const user = req.auth.user;
    if (
      user.role !== 'admin' &&
      user.role !== 'representative' &&
      !user.permissions?.canManageAccounts &&
      !user.permissions?.canManageSales
    ) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية تسجيل دفعات مقدمة' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
    const result = await recordOrderAdvancePayment(
      req.params.id,
      req.body || {},
      req.auth.user,
      idempotencyKey
    );
    res.status(result.deduplicated ? 200 : 201).json({ ok: true, ...result });
  })
);

router.post(
  '/:id/convert-to-invoice',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
    const result = await convertOrderToInvoice(req.params.id, req.body || {}, req.auth.user, idempotencyKey);
    res.status(result.deduplicated ? 200 : 201).json({ ok: true, ...result });
  })
);

router.post(
  '/:id/stage',
  requireStaff,
  asyncHandler(async (req, res) => {
    const user = req.auth.user;
    if (
      user.role !== 'admin' &&
      user.role !== 'representative' &&
      !user.permissions?.canManageSales &&
      !user.permissions?.canManageAccounts &&
      !user.permissions?.canApprove
    ) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية تحديث مرحلة الطلب' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
    const result = await advanceOrderStage(
      req.params.id,
      { ...(req.body || {}), idempotencyKey },
      req.auth
    );
    res.json({ ok: true, ...result });
  })
);

export default router;


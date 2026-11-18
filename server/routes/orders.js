import { Router } from 'express';
import {
  listOrders,
  getOrderById,
  createCustomerOrder,
  approveCustomerOrder,
  rejectCustomerOrder,
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
    const isCustomer = req.auth.user.role === 'customer';
    if (!isCustomer && req.auth.user.role !== 'admin' && !req.auth.user.permissions?.canManageSales && !req.auth.user.permissions?.canAdd) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'ليس لديك صلاحية إنشاء طلبات عملاء' });
    }
    const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey;
    const { order, deduplicated } = await createCustomerOrder(
      { ...(req.body || {}), idempotencyKey },
      req.auth
    );
    res.status(deduplicated ? 200 : 201).json({ ok: true, order, deduplicated });
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
  '/:id/convert-to-invoice',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const result = await convertOrderToInvoice(req.params.id, req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, ...result });
  })
);

export default router;

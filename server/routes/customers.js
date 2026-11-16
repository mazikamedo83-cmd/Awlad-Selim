import { Router } from 'express';
import {
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  linkCustomerToUser,
  recordCustomerPayment,
  detectCustomerUserConflicts,
} from '../db/stores/catalogStore.js';
import {
  requireAuth,
  requireStaff,
  requirePermission,
  asyncHandler,
} from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.use(requireAuth);

// Self profile for logged-in customer (NEVER allows reading other customers)
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (req.auth.user.role !== 'customer') {
      return res.json({ ok: true, customer: null, linkWarning: null });
    }
    res.json({
      ok: true,
      customer: req.auth.customerProfile || null,
      linkWarning: req.auth.linkWarning || null,
    });
  })
);

router.get(
  '/conflicts/check',
  requireStaff,
  requirePermission('canManageUsers'),
  asyncHandler(async (_req, res) => {
    const conflicts = await detectCustomerUserConflicts();
    res.json({ ok: true, ...conflicts });
  })
);

router.get(
  '/',
  requireStaff,
  requirePermission('canView'),
  asyncHandler(async (_req, res) => {
    const customers = await listCustomers();
    res.json({ ok: true, customers });
  })
);

router.get(
  '/:id',
  requireStaff,
  requirePermission('canView'),
  asyncHandler(async (req, res) => {
    const customer = await getCustomerById(req.params.id);
    if (!customer) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    res.json({ ok: true, customer });
  })
);

router.post(
  '/',
  requireStaff,
  requirePermission('canAdd'),
  asyncHandler(async (req, res) => {
    const customer = await createCustomer(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, customer });
  })
);

router.put(
  '/:id',
  requireStaff,
  requirePermission('canEdit'),
  asyncHandler(async (req, res) => {
    const customer = await updateCustomer(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, customer });
  })
);

router.delete(
  '/:id',
  requireStaff,
  requirePermission('canDelete'),
  asyncHandler(async (req, res) => {
    await deleteCustomer(req.params.id, req.auth.user);
    res.json({ ok: true });
  })
);

router.post(
  '/:id/link-user',
  requireStaff,
  requirePermission('canManageUsers'),
  asyncHandler(async (req, res) => {
    const result = await linkCustomerToUser(
      {
        customerId: req.params.id,
        existingUserId: req.body?.existingUserId,
        createUser: req.body?.createUser,
      },
      req.auth.user
    );
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/:id/payment',
  requireStaff,
  requirePermission('canManageAccounts'),
  asyncHandler(async (req, res) => {
    const result = await recordCustomerPayment(
      {
        customerId: req.params.id,
        amount: req.body?.amount,
        cashboxId: req.body?.cashboxId,
        notes: req.body?.notes,
        date: req.body?.date,
      },
      req.auth.user
    );
    res.json({ ok: true, ...result });
  })
);

export default router;

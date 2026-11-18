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
  repairUnlinkedCustomerUsers,
  getRepresentativeByUserId,
  isCustomerAllowedForRep,
  getCustomerProductPriceHistory,
  getCustomerStatementData,
  getSystemSettingsSafe,
  toggleCustomerLinkedUserStatus,
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
    const settings = await getSystemSettingsSafe();
    if (req.auth.user.role !== 'customer') {
      return res.json({ ok: true, customer: null, linkWarning: null, mobileConfig: settings.mobileConfig });
    }
    const cust = req.auth.customerProfile || null;
    const sanitizedCust = cust
      ? {
          ...cust,
          priceHistory: settings.mobileConfig?.allowCustomerPriceView ? cust.priceHistory : {},
        }
      : null;
    res.json({
      ok: true,
      customer: sanitizedCust,
      linkWarning: req.auth.linkWarning || null,
      mobileConfig: settings.mobileConfig,
    });
  })
);

// Strictly isolated financial statement for the authenticated customer
router.get(
  '/me/statement',
  asyncHandler(async (req, res) => {
    if (req.auth.user.role !== 'customer') {
      throw new AppError(403, 'هذه النقطة مخصصة لحسابات العملاء فقط', 'CUSTOMER_ONLY');
    }
    const settings = await getSystemSettingsSafe();
    if (settings.mobileConfig?.enableCustomerApp === false) {
      throw new AppError(403, 'تطبيق العملاء متوقف حاليًا من إعدادات الإدارة', 'CUSTOMER_APP_DISABLED');
    }
    const cust = req.auth.customerProfile;
    if (!cust) {
      throw new AppError(404, req.auth.linkWarning || 'حسابك غير مربوط بملف عميل', 'CUSTOMER_PROFILE_REQUIRED');
    }
    const statement = await getCustomerStatementData(cust.id, {
      allowPriceView: Boolean(settings.mobileConfig?.allowCustomerPriceView),
    });
    res.json({ ok: true, ...statement, mobileConfig: settings.mobileConfig });
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

router.post(
  '/conflicts/fix-unlinked',
  requireStaff,
  requirePermission('canManageUsers'),
  asyncHandler(async (req, res) => {
    const result = await repairUnlinkedCustomerUsers(req.auth.user);
    res.json({ ok: true, ...result });
  })
);

router.get(
  '/',
  requireStaff,
  requirePermission('canView'),
  asyncHandler(async (req, res) => {
    if (req.auth.user.role === 'representative') {
      const rep = req.auth.representativeProfile || (await getRepresentativeByUserId(req.auth.user.id));
      const customers = rep ? await listCustomers({ forRepId: rep.id }) : [];
      return res.json({ ok: true, customers });
    }
    const customers = await listCustomers();
    res.json({ ok: true, customers });
  })
);

router.get(
  '/:id/price-history',
  requireStaff,
  requirePermission('canView'),
  asyncHandler(async (req, res) => {
    const customer = await getCustomerById(req.params.id);
    if (!customer) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    if (req.auth.user.role === 'representative') {
      const rep = req.auth.representativeProfile || (await getRepresentativeByUserId(req.auth.user.id));
      if (!rep || !isCustomerAllowedForRep(customer, rep.id)) {
        throw new AppError(403, 'غير مصرح لك بالوصول لبيانات عميل غير معين ضمن قائمتك', 'CUSTOMER_NOT_ASSIGNED_TO_REP');
      }
    }
    const priceHistory = await getCustomerProductPriceHistory(customer.id);
    res.json({ ok: true, customerId: customer.id, priceHistory });
  })
);

router.get(
  '/:id',
  requireStaff,
  requirePermission('canView'),
  asyncHandler(async (req, res) => {
    const customer = await getCustomerById(req.params.id);
    if (!customer) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    if (req.auth.user.role === 'representative') {
      const rep = req.auth.representativeProfile || (await getRepresentativeByUserId(req.auth.user.id));
      if (!rep || !isCustomerAllowedForRep(customer, rep.id)) {
        throw new AppError(403, 'غير مصرح لك بالوصول لبيانات عميل غير معين ضمن قائمتك', 'CUSTOMER_NOT_ASSIGNED_TO_REP');
      }
    }
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
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const result = await recordCustomerPayment(
      {
        customerId: req.params.id,
        amount: req.body?.amount,
        cashboxId: req.body?.cashboxId,
        paymentMethod: req.body?.paymentMethod,
        notes: req.body?.notes,
        date: req.body?.date,
      },
      req.auth.user,
      idempotencyKey
    );
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/:id/toggle-user-status',
  requireStaff,
  requirePermission('canManageUsers'),
  asyncHandler(async (req, res) => {
    const result = await toggleCustomerLinkedUserStatus(
      req.params.id,
      Boolean(req.body?.isActive),
      req.auth.user
    );
    res.json({ ok: true, ...result });
  })
);

export default router;

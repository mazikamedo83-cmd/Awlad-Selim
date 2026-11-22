import { Router } from 'express';
import {
  listInvoices,
  createSalesInvoice,
  createPurchaseInvoice,
  confirmDraftInvoice,
  editSalesInvoice,
  cancelInvoice,
  addInvoicePayment,
  createInvoiceReturn,
} from '../db/stores/invoicesStore.js';
import { getCustomerStatementData, getSystemSettingsSafe } from '../db/stores/catalogStore.js';
import {
  requireAuth,
  requireStaff,
  requirePermission,
  asyncHandler,
} from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.use(requireAuth);

// Customer self-only invoices & returns endpoint
router.get(
  '/my',
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
      return res.json({ ok: true, invoices: [], returns: [], mobileConfig: settings.mobileConfig });
    }
    const statement = await getCustomerStatementData(cust.id, {
      allowPriceView: Boolean(settings.mobileConfig?.allowCustomerPriceView),
    });
    res.json({
      ok: true,
      invoices: statement.invoices,
      returns: statement.returns,
      summary: statement.summary,
      mobileConfig: settings.mobileConfig,
    });
  })
);

router.get(
  '/',
  requireStaff,
  requirePermission('canView'),
  asyncHandler(async (req, res) => {
    const invoices = await listInvoices(req.auth.user);
    res.json({ ok: true, invoices });
  })
);

router.post(
  '/sales',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const invoice = await createSalesInvoice(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, invoice });
  })
);

router.post(
  '/purchase',
  requireStaff,
  requirePermission('canManagePurchases'),
  asyncHandler(async (req, res) => {
    const invoice = await createPurchaseInvoice(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, invoice });
  })
);

router.post(
  '/:id/confirm',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const invoice = await confirmDraftInvoice(req.params.id, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.put(
  '/:id',
  requireStaff,
  requirePermission('canEdit'),
  asyncHandler(async (req, res) => {
    const invoice = await editSalesInvoice(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/:id/cancel',
  requireStaff,
  requirePermission('canDelete'),
  asyncHandler(async (req, res) => {
    const invoice = await cancelInvoice(req.params.id, req.body?.reason, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/:id/payments',
  requireStaff,
  requirePermission('canManageAccounts'),
  asyncHandler(async (req, res) => {
    const invoice = await addInvoicePayment(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/returns',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const ret = await createInvoiceReturn(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, invoiceReturn: ret });
  })
);

export default router;

import { Router } from 'express';
import {
  listInvoices,
  createSalesInvoice,
  createPurchaseInvoice,
  sendPurchaseInvoice,
  receivePurchaseInvoice,
  rejectPurchaseInvoice,
  createSalesQuote,
  convertQuoteToInvoice,
  confirmDraftInvoice,
  markInvoiceReviewed,
  editSalesInvoice,
  editPurchaseInvoice,
  deleteDraftPurchaseInvoice,
  editInvoice,
  cancelInvoice,
  addInvoicePayment,
  createInvoiceReturn,
  listPurchaseReturnRequests,
  createPurchaseReturnRequest,
  approvePurchaseReturnRequest,
  rejectPurchaseReturnRequest,
  listSalesReturnRequests,
  createSalesReturnRequest,
  approveSalesReturnRequest,
  rejectSalesReturnRequest,
} from '../db/stores/invoicesStore.js';
import { getCustomerStatementData, getSystemSettingsSafe } from '../db/stores/catalogStore.js';
import { listPurchaseReceivers } from '../db/stores/inventoryAdminStore.js';
import {
  requireAuth,
  requireStaff,
  requirePermission,
  requireAnyPermission,
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

router.get(
  '/purchase-receivers',
  requireStaff,
  requireAnyPermission('canCreatePurchase', 'canManagePurchases', 'canSend', 'canApprove'),
  asyncHandler(async (_req, res) => {
    const receivers = await listPurchaseReceivers();
    res.json({ ok: true, receivers });
  })
);

router.get(
  '/purchase-return-requests',
  requireStaff,
  requireAnyPermission('canCreatePurchase', 'canManagePurchases', 'canApprove'),
  asyncHandler(async (req, res) => {
    const requests = await listPurchaseReturnRequests(req.auth.user);
    res.json({ ok: true, requests });
  })
);

router.post(
  '/purchase-return-requests',
  requireStaff,
  requireAnyPermission('canCreatePurchase', 'canManagePurchases'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const request = await createPurchaseReturnRequest(req.body || {}, req.auth.user, idempotencyKey);
    res.status(201).json({ ok: true, request });
  })
);

router.post(
  '/purchase-return-requests/:id/approve',
  requireStaff,
  requireAnyPermission('canManagePurchases', 'canApprove'),
  asyncHandler(async (req, res) => {
    if (req.auth.user.role === 'representative') {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_APPROVE_RETURN_REQUEST',
        error: 'اعتماد طلبات مرتجع المشتريات مخصص للإدارة ومسؤولي المشتريات فقط',
      });
    }
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const result = await approvePurchaseReturnRequest(req.params.id, req.body || {}, req.auth.user, idempotencyKey);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/purchase-return-requests/:id/reject',
  requireStaff,
  requireAnyPermission('canManagePurchases', 'canApprove'),
  asyncHandler(async (req, res) => {
    if (req.auth.user.role === 'representative') {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_REJECT_RETURN_REQUEST',
        error: 'رفض طلبات مرتجع المشتريات مخصص للإدارة ومسؤولي المشتريات فقط',
      });
    }
    const result = await rejectPurchaseReturnRequest(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, ...result });
  })
);

router.get(
  '/sales-return-requests',
  requireStaff,
  requireAnyPermission('canManageSales', 'canApprove', 'canManageCashboxes', 'canManageAccounts'),
  asyncHandler(async (req, res) => {
    const requests = await listSalesReturnRequests(req.auth.user);
    res.json({ ok: true, requests });
  })
);

router.post(
  '/sales-return-requests',
  requireStaff,
  requireAnyPermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const request = await createSalesReturnRequest(req.body || {}, req.auth.user, idempotencyKey);
    res.status(201).json({ ok: true, request });
  })
);

router.post(
  '/sales-return-requests/:id/approve',
  requireStaff,
  requireAnyPermission('canManageSales', 'canApprove', 'canManageCashboxes', 'canManageAccounts'),
  asyncHandler(async (req, res) => {
    if (req.auth.user.role === 'representative') {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_APPROVE_RETURN_REQUEST',
        error: 'اعتماد طلبات مرتجع المبيعات مخصص للإدارة ومسؤولي المبيعات والخزينة فقط',
      });
    }
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const result = await approveSalesReturnRequest(req.params.id, req.body || {}, req.auth.user, idempotencyKey);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/sales-return-requests/:id/reject',
  requireStaff,
  requireAnyPermission('canManageSales', 'canApprove', 'canManageCashboxes', 'canManageAccounts'),
  asyncHandler(async (req, res) => {
    if (req.auth.user.role === 'representative') {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_REJECT_RETURN_REQUEST',
        error: 'رفض طلبات مرتجع المبيعات مخصص للإدارة ومسؤولي المبيعات والخزينة فقط',
      });
    }
    const result = await rejectSalesReturnRequest(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/sales',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const invoice = await createSalesInvoice(req.body || {}, req.auth.user, idempotencyKey);
    res.status(201).json({ ok: true, invoice });
  })
);

router.post(
  '/purchase',
  requireStaff,
  requireAnyPermission('canManagePurchases', 'canCreatePurchase'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const invoice = await createPurchaseInvoice(req.body || {}, req.auth.user, idempotencyKey);
    res.status(201).json({ ok: true, invoice });
  })
);

router.post(
  '/purchase/:id/send',
  requireStaff,
  requireAnyPermission('canCreatePurchase', 'canManagePurchases', 'canSend'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const invoice = await sendPurchaseInvoice(req.params.id, req.body || {}, req.auth.user, idempotencyKey);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/purchase/:id/receive',
  requireStaff,
  requireAnyPermission('canManagePurchases', 'canApprove', 'canReceive'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const invoice = await receivePurchaseInvoice(req.params.id, req.body || {}, req.auth.user, idempotencyKey);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/purchase/:id/reject',
  requireStaff,
  requireAnyPermission('canManagePurchases', 'canApprove', 'canReceive'),
  asyncHandler(async (req, res) => {
    const invoice = await rejectPurchaseInvoice(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/quotes',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const invoice = await createSalesQuote(req.body || {}, req.auth.user, idempotencyKey);
    res.status(201).json({ ok: true, invoice });
  })
);

router.post(
  '/quotes/:id/convert',
  requireStaff,
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const invoice = await convertQuoteToInvoice(req.params.id, req.body || {}, req.auth.user, idempotencyKey);
    res.status(201).json({ ok: true, invoice });
  })
);

router.post(
  '/:id/confirm',
  requireStaff,
  asyncHandler(async (req, res) => {
    const invoice = await confirmDraftInvoice(req.params.id, req.auth.user, req.body || {});
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/:id/mark-reviewed',
  requireStaff,
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    if (u.role !== 'admin' && !u.permissions?.canManageSales && !u.permissions?.canReviewRepInvoices && !u.permissions?.canApprove) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN_REVIEW', error: 'ليس لديك صلاحية تأكيد مراجعة فواتير المناديب' });
    }
    const invoice = await markInvoiceReviewed(req.params.id, req.body || {}, u);
    res.json({ ok: true, invoice });
  })
);

router.put(
  '/purchase/:id',
  requireStaff,
  requireAnyPermission('canManagePurchases', 'canCreatePurchase'),
  requirePermission('canEdit'),
  asyncHandler(async (req, res) => {
    const invoice = await editPurchaseInvoice(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.delete(
  '/purchase/:id',
  requireStaff,
  requireAnyPermission('canManagePurchases', 'canCreatePurchase'),
  asyncHandler(async (req, res) => {
    const result = await deleteDraftPurchaseInvoice(req.params.id, req.auth.user);
    res.json(result);
  })
);

router.put(
  '/:id',
  requireStaff,
  requirePermission('canEdit'),
  asyncHandler(async (req, res) => {
    const invoice = await editInvoice(req.params.id, req.body || {}, req.auth.user);
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
  requireAnyPermission('canManageAccounts', 'canManageSales', 'canManagePurchases', 'canCreatePurchase'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const invoice = await addInvoicePayment(req.params.id, req.body || {}, req.auth.user, idempotencyKey);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/returns',
  requireStaff,
  asyncHandler(async (req, res) => {
    const u = req.auth.user;
    const isPurchaseReturn = req.body?.type === 'purchase_return';
    const isCashRefund = req.body?.refundType === 'cash';
    const reqCashboxId = String(req.body?.cashboxId || '').trim();
    if (u.role === 'representative' && reqCashboxId) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_REP_CASHBOX_SELECTION',
        error: 'غير مصرح للمندوب باختيار خزينة الشركة أو تنفيذ عمليات نقدية مباشرة عليها',
      });
    }
    if (u.role === 'representative' && isPurchaseReturn) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_REP_DIRECT_PURCHASE_RETURN',
        error: 'لا يمكن للمندوب تنفيذ مرتجع مشتريات مباشر؛ يرجى رفع طلب مرتجع مشتريات لاعتماد الإدارة',
      });
    }
    if (u.role === 'representative' && !isPurchaseReturn && isCashRefund) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_REP_CASH_RETURN',
        error: 'لا يمكن للمندوب تنفيذ مرتجع مبيعات نقدي مباشرة من الخزينة؛ يرجى رفع طلب مرتجع مبيعات نقدي لاعتماد الخزينة/الإدارة',
      });
    }
    if (
      reqCashboxId &&
      u.role !== 'admin' &&
      !u.permissions?.canManageCashboxes &&
      !u.permissions?.canManageAccounts
    ) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_TREASURY_PERMISSION',
        error: 'ليس لديك صلاحية تحديد الخزينة أو تنفيذ صرف/إيداع نقدي على المرتجعات',
      });
    }
    const allowed =
      u.role === 'admin' ||
      (isPurchaseReturn ? Boolean(u.permissions?.canManagePurchases) : Boolean(u.permissions?.canManageSales));
    if (!allowed) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN_PERMISSION', error: 'ليس لديك صلاحية تنفيذ هذا المرتجع' });
    }
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const ret = await createInvoiceReturn(req.body || {}, u, idempotencyKey);
    res.status(201).json({ ok: true, invoiceReturn: ret });
  })
);

export default router;

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
  requirePermission('canView'),
  asyncHandler(async (_req, res) => {
    const invoices = await listInvoices();
    res.json({ ok: true, invoices });
  })
);

router.post(
  '/sales',
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const invoice = await createSalesInvoice(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, invoice });
  })
);

router.post(
  '/purchase',
  requirePermission('canManagePurchases'),
  asyncHandler(async (req, res) => {
    const invoice = await createPurchaseInvoice(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, invoice });
  })
);

router.post(
  '/:id/confirm',
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const invoice = await confirmDraftInvoice(req.params.id, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.put(
  '/:id',
  requirePermission('canEdit'),
  asyncHandler(async (req, res) => {
    const invoice = await editSalesInvoice(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/:id/cancel',
  requirePermission('canDelete'),
  asyncHandler(async (req, res) => {
    const invoice = await cancelInvoice(req.params.id, req.body?.reason, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/:id/payments',
  requirePermission('canManageAccounts'),
  asyncHandler(async (req, res) => {
    const invoice = await addInvoicePayment(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, invoice });
  })
);

router.post(
  '/returns',
  requirePermission('canManageSales'),
  asyncHandler(async (req, res) => {
    const ret = await createInvoiceReturn(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, invoiceReturn: ret });
  })
);

export default router;

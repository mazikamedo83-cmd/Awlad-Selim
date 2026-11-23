import { Router } from 'express';
import {
  getComprehensiveReport,
  getSourceDocumentForReport,
  getRepDetailedReport,
} from '../db/stores/reportsStore.js';
import {
  requireAuth,
  requireStaff,
  asyncHandler,
} from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireStaff);

function checkReportsAccess(req, res) {
  const u = req.auth.user;
  if (u.role !== 'admin' && u.permissions?.canViewReports !== true) {
    res.status(403).json({
      ok: false,
      code: 'FORBIDDEN',
      error: 'ليس لديك صلاحية عرض التقارير الشاملة',
    });
    return false;
  }
  return true;
}

router.get(
  '/rep-summary',
  asyncHandler(async (req, res) => {
    const q = req.query || {};
    const report = await getRepDetailedReport(
      {
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        customerId: typeof q.customerId === 'string' ? q.customerId : undefined,
        supplierId: typeof q.supplierId === 'string' ? q.supplierId : undefined,
        productId: typeof q.productId === 'string' ? q.productId : undefined,
        invoiceNumber: typeof q.invoiceNumber === 'string' ? q.invoiceNumber : undefined,
        opType: typeof q.opType === 'string' ? q.opType : undefined,
        paymentStatus: typeof q.paymentStatus === 'string' ? q.paymentStatus : undefined,
        invoiceStatus: typeof q.invoiceStatus === 'string' ? q.invoiceStatus : undefined,
        search: typeof q.search === 'string' ? q.search : undefined,
      },
      req.auth.user
    );
    res.json({ ok: true, report });
  })
);

router.get(
  '/comprehensive',
  asyncHandler(async (req, res) => {
    if (!checkReportsAccess(req, res)) return;
    const q = req.query || {};
    const report = await getComprehensiveReport(
      {
        reportType: typeof q.reportType === 'string' ? q.reportType : 'all',
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        branchId: typeof q.branchId === 'string' ? q.branchId : undefined,
        warehouseId: typeof q.warehouseId === 'string' ? q.warehouseId : undefined,
        cashboxId: typeof q.cashboxId === 'string' ? q.cashboxId : undefined,
        productId: typeof q.productId === 'string' ? q.productId : undefined,
        productSearch: typeof q.productSearch === 'string' ? q.productSearch : undefined,
        barcode: typeof q.barcode === 'string' ? q.barcode : undefined,
        customerId: typeof q.customerId === 'string' ? q.customerId : undefined,
        supplierId: typeof q.supplierId === 'string' ? q.supplierId : undefined,
        employeeId: typeof q.employeeId === 'string' ? q.employeeId : undefined,
        userId: typeof q.userId === 'string' ? q.userId : undefined,
        userName: typeof q.userName === 'string' ? q.userName : undefined,
        representativeId: typeof q.representativeId === 'string' ? q.representativeId : undefined,
        invoiceNumber: typeof q.invoiceNumber === 'string' ? q.invoiceNumber : undefined,
        recordId: typeof q.recordId === 'string' ? q.recordId : undefined,
        search: typeof q.search === 'string' ? q.search : undefined,
        page: q.page !== undefined ? Number(q.page) : undefined,
        pageSize: q.pageSize !== undefined ? Number(q.pageSize) : undefined,
      },
      req.auth.user
    );
    res.json({ ok: true, report });
  })
);

router.get(
  '/source-document',
  asyncHandler(async (req, res) => {
    if (!checkReportsAccess(req, res)) return;
    const docType = typeof req.query.docType === 'string' ? req.query.docType : '';
    const docId = typeof req.query.docId === 'string' ? req.query.docId : '';
    if (!docId) {
      return res.status(400).json({ ok: false, code: 'MISSING_DOC_ID', error: 'معرف المستند مطلوب' });
    }
    const result = await getSourceDocumentForReport(docType, docId, req.auth.user);
    if (!result) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'تعذر العثور على المستند الأصلي' });
    }
    res.json({ ok: true, ...result });
  })
);

export default router;

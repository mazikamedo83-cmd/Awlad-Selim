import { Router } from 'express';
import { getPool, isPgConnectionError } from '../db/postgres.js';
import { readJsonDatabase, withJsonTransaction } from '../db/jsonLedger.js';
import {
  isPgMode,
  isStrictPostgresMode,
  markPgUnavailable,
  createDatabaseUnavailableError,
  isoTimestamp,
} from '../db/stores/mode.js';
import { generateServerId } from '../utils/crypto.js';
import {
  AppError,
  nowIso,
  sanitizeUser,
  canManageSyncConflictsGlobally,
  sanitizeSyncPayload,
} from '../utils/errors.js';
import { requireAuth, asyncHandler } from '../middleware/auth.js';
import { recordAuditLog } from '../db/stores/authStore.js';
import {
  createCustomer,
  updateCustomer,
  getCustomerById,
  recordCustomerPayment,
  getRepresentativeByUserId,
  listCategories,
  listProducts,
  getCustomerStatementData,
  getSystemSettingsSafe,
} from '../db/stores/catalogStore.js';
import {
  createSalesInvoice,
  createPurchaseInvoice,
  sendPurchaseInvoice,
  createSalesQuote,
  editSalesInvoice,
  editPurchaseInvoice,
  deleteDraftPurchaseInvoice,
  addInvoicePayment,
  createInvoiceReturn,
  createPurchaseReturnRequest,
  listInvoices,
} from '../db/stores/invoicesStore.js';
import {
  listOrders,
  createCustomerOrder,
  updateOrderDeliveryStatus,
  recordOrderAdvancePayment,
} from '../db/stores/ordersStore.js';
import {
  getStaffBootstrapData,
  executeCashOperation,
  updateRepItemTransferStatus,
  recordRepCustodyDelivery,
  recordRepCustodyReturn,
  createSupplier,
} from '../db/stores/inventoryAdminStore.js';

const router = Router();
router.use(requireAuth);

function mapPgConflictRow(r, viewer = null) {
  const redactCosts = viewer?.role === 'representative';
  return {
    id: r.id,
    operationId: r.operation_id,
    operationType: r.operation_type,
    entityType: r.entity_type,
    entityId: r.entity_id || undefined,
    deviceId: r.device_id || undefined,
    userId: r.user_id || undefined,
    userName: r.user_name || '',
    conflictReason: r.conflict_reason,
    localPayload: sanitizeSyncPayload(r.local_payload || {}, { redactCosts }),
    serverSnapshot: sanitizeSyncPayload(r.server_snapshot || {}, { redactCosts }),
    status: r.status,
    resolutionNotes: r.resolution_notes || '',
    resolvedBy: r.resolved_by || undefined,
    resolvedAt: r.resolved_at ? isoTimestamp(r.resolved_at) : undefined,
    createdAt: isoTimestamp(r.created_at),
  };
}

async function listUserScopedConflicts(user) {
  const global = canManageSyncConflictsGlobally(user);
  const redactCosts = user?.role === 'representative';
  if (await isPgMode()) {
    const pool = getPool();
    const res = global
      ? await pool.query(`SELECT * FROM sync_conflicts ORDER BY created_at DESC LIMIT 300`)
      : await pool.query(
          `SELECT * FROM sync_conflicts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 150`,
          [user.id]
        );
    return res.rows.map((r) => mapPgConflictRow(r, user));
  }
  const db = readJsonDatabase();
  const list = db.syncConflicts || [];
  const scoped = global ? list : list.filter((c) => c.userId === user.id);
  return scoped.map((c) => ({
    ...c,
    localPayload: sanitizeSyncPayload(c.localPayload || {}, { redactCosts }),
    serverSnapshot: sanitizeSyncPayload(c.serverSnapshot || {}, { redactCosts }),
  }));
}

async function findSyncOpDeduplication(userId, operationId) {
  if (!userId || !operationId) return null;
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM sync_operation_logs WHERE user_id = $1 AND operation_id = $2 LIMIT 1`,
      [userId, operationId]
    );
    return res.rows[0] || null;
  }
  const db = readJsonDatabase();
  return (db.syncOperationLogs || []).find(
    (entry) => entry.userId === userId && entry.operationId === operationId
  ) || null;
}

async function recordSyncOpLog(entry) {
  const id = generateServerId('SYNL');
  const now = nowIso();
  if (await isPgMode()) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO sync_operation_logs (id, operation_id, user_id, device_id, operation_type, entity_type, entity_id, status, response_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id, operation_id) DO NOTHING`,
      [
        id,
        entry.operationId,
        entry.userId,
        entry.deviceId || null,
        entry.operationType,
        entry.entityType,
        entry.entityId || null,
        entry.status,
        JSON.stringify(entry.responseJson || {}),
        now,
      ]
    );
    return;
  }
  await withJsonTransaction((db) => {
    const exists = (db.syncOperationLogs || []).some(
      (l) => l.userId === entry.userId && l.operationId === entry.operationId
    );
    if (!exists) {
      db.syncOperationLogs.unshift({
        id,
        ...entry,
        createdAt: now,
      });
      if (db.syncOperationLogs.length > 5000) db.syncOperationLogs.length = 5000;
    }
  });
}

async function createConflictRecord({ op, user, conflictReason, serverSnapshot }) {
  const redactCosts = user?.role === 'representative';
  const safeLocalPayload = sanitizeSyncPayload(op.payload || {}, { redactCosts });
  const safeServerSnapshot = sanitizeSyncPayload(serverSnapshot || {}, { redactCosts });
  const conflict = {
    id: generateServerId('CONF'),
    operationId: op.operationId,
    operationType: op.operationType,
    entityType: op.entityType || 'unknown',
    entityId: op.entityId || undefined,
    deviceId: op.deviceId || undefined,
    userId: user.id,
    userName: user.fullName || user.username,
    conflictReason,
    localPayload: safeLocalPayload,
    serverSnapshot: safeServerSnapshot,
    status: 'needs_review',
    resolutionNotes: '',
    createdAt: nowIso(),
  };

  if (await isPgMode()) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO sync_conflicts (id, operation_id, operation_type, entity_type, entity_id, device_id, user_id, user_name, conflict_reason, local_payload, server_snapshot, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        conflict.id,
        conflict.operationId,
        conflict.operationType,
        conflict.entityType,
        conflict.entityId || null,
        conflict.deviceId || null,
        conflict.userId,
        conflict.userName,
        conflict.conflictReason,
        JSON.stringify(conflict.localPayload),
        JSON.stringify(conflict.serverSnapshot),
        conflict.status,
        conflict.createdAt,
      ]
    );
    return conflict;
  }

  await withJsonTransaction((db) => {
    db.syncConflicts.unshift(conflict);
  });
  return conflict;
}

function assertStaffPermission(user, permKey) {
  if (user.role === 'customer') {
    throw new AppError(403, 'هذه العملية مخصصة لموظفي وإدارة الشركة فقط', 'FORBIDDEN_STAFF_ONLY');
  }
  if (user.role !== 'admin' && permKey && user.permissions?.[permKey] !== true) {
    throw new AppError(403, `ليس لديك الصلاحية المطلوبة (${permKey})`, 'FORBIDDEN_PERMISSION');
  }
}

async function applySingleOperation(op, authContext, { ignoreVersionCheck = false } = {}) {
  const user = authContext.user;
  const rawPayload = op.payload && typeof op.payload === 'object' ? { ...op.payload } : {};
  delete rawPayload.createdBy;
  delete rawPayload.createdByUserId;
  delete rawPayload.sentBy;
  delete rawPayload.sentByUserId;
  const payload = rawPayload;
  const opId = op.operationId;
  const opType = op.operationType;

  if (opType === 'create_order') {
    const isCustomer = user.role === 'customer';
    const isRep = user.role === 'representative';
    if (
      !isCustomer &&
      !isRep &&
      user.role !== 'admin' &&
      !user.permissions?.canManageSales &&
      !user.permissions?.canAdd
    ) {
      throw new AppError(403, 'ليس لديك صلاحية إنشاء طلبات عملاء أو مندوبين', 'FORBIDDEN');
    }
    return createCustomerOrder(
      {
        ...payload,
        idempotencyKey: opId,
        originDeviceId: op.deviceId || authContext.deviceId,
      },
      authContext
    );
  }

  if (opType === 'create_sales_invoice') {
    assertStaffPermission(user, 'canManageSales');
    return createSalesInvoice(
      { ...payload, originDeviceId: op.deviceId || authContext.deviceId },
      user,
      opId
    );
  }

  if (opType === 'create_purchase_invoice') {
    if (user.role !== 'admin' && !user.permissions?.canManagePurchases && !user.permissions?.canCreatePurchase) {
      throw new AppError(403, 'ليس لديك صلاحية إنشاء فواتير الشراء (canManagePurchases / canCreatePurchase)', 'FORBIDDEN_PERMISSION');
    }
    return createPurchaseInvoice(
      { ...payload, originDeviceId: op.deviceId || authContext.deviceId },
      user,
      opId
    );
  }

  if (opType === 'send_purchase_invoice') {
    if (
      user.role !== 'admin' &&
      !user.permissions?.canCreatePurchase &&
      !user.permissions?.canManagePurchases &&
      !user.permissions?.canSend
    ) {
      throw new AppError(403, 'ليس لديك صلاحية إرسال فواتير الشراء', 'FORBIDDEN_PERMISSION');
    }
    const invoiceId = payload.invoiceId || op.entityId;
    return sendPurchaseInvoice(invoiceId, payload, user, opId);
  }

  if (opType === 'edit_sales_invoice') {
    assertStaffPermission(user, 'canManageSales');
    assertStaffPermission(user, 'canEdit');
    const invoiceId = payload.invoiceId || op.entityId;
    const invoices = await listInvoices(user);
    const serverInv = invoices.find((i) => i.id === invoiceId);
    if (!serverInv) {
      throw new AppError(404, 'الفاتورة غير موجودة على السيرفر', 'INVOICE_NOT_FOUND');
    }
    if (serverInv.status === 'cancelled') {
      throw new AppError(409, 'تم إلغاء الفاتورة على السيرفر قبل المزامنة', 'INVOICE_CANCELLED', {
        serverSnapshot: serverInv,
      });
    }
    if (
      !ignoreVersionCheck &&
      payload.baseVersion !== undefined &&
      Number(serverInv.version || 1) > Number(payload.baseVersion)
    ) {
      throw new AppError(
        409,
        `تم تعديل الفاتورة (${serverInv.invoiceNumber}) على السيرفر لإصدار أحدث (${serverInv.version}) قبل مزامنة هذا الجهاز.`,
        'VERSION_CONFLICT',
        { serverSnapshot: serverInv }
      );
    }
    return editSalesInvoice(invoiceId, { ...payload, ignoreVersionCheck }, user);
  }

  if (opType === 'edit_purchase_invoice') {
    if (
      user.role !== 'admin' &&
      !user.permissions?.canManagePurchases &&
      !user.permissions?.canCreatePurchase
    ) {
      throw new AppError(403, 'ليس لديك صلاحية تعديل فواتير المشتريات', 'FORBIDDEN_PERMISSION');
    }
    assertStaffPermission(user, 'canEdit');
    const invoiceId = payload.invoiceId || op.entityId;
    const invoices = await listInvoices(user);
    const serverInv = invoices.find((i) => i.id === invoiceId);
    if (!serverInv) {
      throw new AppError(404, 'فاتورة المشتريات غير موجودة على السيرفر', 'INVOICE_NOT_FOUND');
    }
    if (serverInv.type !== 'purchase') {
      throw new AppError(400, 'المستند المحدد ليس فاتورة مشتريات', 'NOT_PURCHASE_INVOICE');
    }
    if (serverInv.status === 'cancelled') {
      throw new AppError(409, 'تم إلغاء فاتورة المشتريات على السيرفر قبل المزامنة', 'INVOICE_CANCELLED', {
        serverSnapshot: serverInv,
      });
    }
    if (
      !ignoreVersionCheck &&
      payload.baseVersion !== undefined &&
      Number(serverInv.version || 1) > Number(payload.baseVersion)
    ) {
      throw new AppError(
        409,
        `تم تعديل فاتورة المشتريات (${serverInv.invoiceNumber}) على السيرفر لإصدار أحدث (${serverInv.version}) قبل مزامنة هذا الجهاز.`,
        'VERSION_CONFLICT',
        { serverSnapshot: serverInv }
      );
    }
    return editPurchaseInvoice(invoiceId, { ...payload, ignoreVersionCheck }, user);
  }

  if (opType === 'delete_purchase_draft') {
    if (
      user.role !== 'admin' &&
      !user.permissions?.canManagePurchases &&
      !user.permissions?.canCreatePurchase
    ) {
      throw new AppError(403, 'ليس لديك صلاحية حذف مسودة فاتورة الشراء', 'FORBIDDEN_PERMISSION');
    }
    const invoiceId = payload.invoiceId || op.entityId;
    return deleteDraftPurchaseInvoice(invoiceId, user);
  }

  if (opType === 'create_invoice_return') {
    const isPurchaseReturn = payload?.type === 'purchase_return';
    if (isPurchaseReturn) {
      if (user.role === 'representative') {
        throw new AppError(
          403,
          'لا يمكن للمندوب تنفيذ مرتجع مشتريات مباشر؛ يرجى رفع طلب مرتجع مشتريات لاعتماد الإدارة',
          'FORBIDDEN_REP_DIRECT_PURCHASE_RETURN'
        );
      }
      assertStaffPermission(user, 'canManagePurchases');
    } else {
      assertStaffPermission(user, 'canManageSales');
    }
    return createInvoiceReturn(payload, user, opId);
  }

  if (opType === 'create_purchase_return_request') {
    if (user.role === 'customer') {
      throw new AppError(403, 'غير مصرح للعملاء بإنشاء طلبات مرتجع مشتريات', 'FORBIDDEN');
    }
    if (user.role !== 'admin' && !user.permissions?.canCreatePurchase && !user.permissions?.canManagePurchases) {
      throw new AppError(403, 'ليس لديك صلاحية إنشاء طلب مرتجع مشتريات', 'FORBIDDEN_PERMISSION');
    }
    return createPurchaseReturnRequest(payload, user, opId);
  }

  if (opType === 'add_invoice_payment') {
    const canAttemptPayment =
      user.role === 'admin' ||
      Boolean(user.permissions?.canManageAccounts) ||
      Boolean(user.permissions?.canManageSales) ||
      Boolean(user.permissions?.canManagePurchases) ||
      Boolean(user.permissions?.canCreatePurchase);
    if (!canAttemptPayment) {
      throw new AppError(403, 'ليس لديك صلاحية تسجيل دفعات على الفواتير', 'FORBIDDEN_PERMISSION');
    }
    return addInvoicePayment(payload.invoiceId || op.entityId, payload, user, opId);
  }

  if (opType === 'record_customer_payment') {
    const canCollectPayment =
      user.role === 'admin' ||
      Boolean(user.permissions?.canManageAccounts) ||
      (user.role === 'representative' && Boolean(user.permissions?.canManageSales));
    if (!canCollectPayment) {
      throw new AppError(403, 'ليس لديك صلاحية تسجيل تحصيل دفعات العملاء', 'FORBIDDEN_PERMISSION');
    }
    const customerId = payload.customerId || op.entityId;
    const cust = await getCustomerById(customerId);
    if (!cust) {
      throw new AppError(404, 'العميل غير موجود على السيرفر', 'CUSTOMER_NOT_FOUND');
    }
    if (user.role === 'representative') {
      const rep = authContext.representativeProfile || (await getRepresentativeByUserId(user.id));
      if (!rep) {
        throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
      }
    }
    return recordCustomerPayment({ ...payload, customerId }, user, opId);
  }

  if (opType === 'record_order_advance') {
    if (
      user.role !== 'admin' &&
      user.role !== 'representative' &&
      !user.permissions?.canManageAccounts &&
      !user.permissions?.canManageSales
    ) {
      throw new AppError(403, 'ليس لديك صلاحية تسجيل دفعات مقدمة', 'FORBIDDEN');
    }
    return recordOrderAdvancePayment(payload.orderId || op.entityId, payload, user, opId);
  }

  if (opType === 'update_order_delivery') {
    if (user.role !== 'admin' && user.role !== 'representative' && !user.permissions?.canManageSales) {
      throw new AppError(403, 'ليس لديك صلاحية تحديث حالة التوصيل', 'FORBIDDEN');
    }
    return updateOrderDeliveryStatus(
      payload.orderId || op.entityId,
      { ...payload, idempotencyKey: opId },
      authContext
    );
  }

  if (opType === 'execute_cash_operation') {
    if (user.role === 'representative' || user.role === 'customer') {
      throw new AppError(403, 'العمليات الإدارية للخزائن والمصروفات والموردين غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
    }
    if (payload?.type === 'cashbox_transfer') {
      assertStaffPermission(user, 'canManageCashboxes');
    } else if (user.role !== 'admin' && !user.permissions?.canManageCashboxes && !user.permissions?.canManageAccounts) {
      throw new AppError(403, 'ليس لديك صلاحية تنفيذ العمليات النقدية', 'FORBIDDEN');
    }
    return executeCashOperation(payload, user, opId);
  }

  if (opType === 'create_customer') {
    assertStaffPermission(user, 'canAdd');
    return createCustomer(payload, user);
  }

  if (opType === 'create_supplier') {
    if (user.role !== 'admin' && !user.permissions?.canManagePurchases && !user.permissions?.canCreatePurchase) {
      throw new AppError(403, 'ليس لديك صلاحية إضافة موردين', 'FORBIDDEN_PERMISSION');
    }
    return createSupplier(payload, user);
  }

  if (opType === 'create_sales_quote') {
    assertStaffPermission(user, 'canManageSales');
    return createSalesQuote(
      { ...payload, originDeviceId: op.deviceId || authContext.deviceId },
      user,
      opId
    );
  }

  if (opType === 'create_purchase_return') {
    if (user.role === 'representative') {
      throw new AppError(
        403,
        'لا يمكن للمندوب تنفيذ مرتجع مشتريات مباشر؛ يرجى رفع طلب مرتجع مشتريات لاعتماد الإدارة',
        'FORBIDDEN_REP_DIRECT_PURCHASE_RETURN'
      );
    }
    assertStaffPermission(user, 'canManagePurchases');
    return createInvoiceReturn({ ...payload, type: 'purchase_return' }, user, opId);
  }

  if (opType === 'confirm_custody_receipt') {
    if (user.role !== 'representative' && user.role !== 'admin' && !user.permissions?.canManageTransfers) {
      throw new AppError(403, 'ليس لديك صلاحية تأكيد استلام العهدة', 'FORBIDDEN');
    }
    return updateRepItemTransferStatus(
      payload.requestId || op.entityId,
      { status: 'received', notes: payload.notes || '' },
      user
    );
  }

  if (opType === 'record_custody_delivery') {
    if (user.role !== 'representative' && user.role !== 'admin' && !user.permissions?.canManageTransfers) {
      throw new AppError(403, 'ليس لديك صلاحية تسجيل التسليم من العهدة', 'FORBIDDEN');
    }
    return recordRepCustodyDelivery(payload, user, opId);
  }

  if (opType === 'record_custody_return') {
    if (
      user.role !== 'representative' &&
      user.role !== 'admin' &&
      !user.permissions?.canManageTransfers &&
      !user.permissions?.canManageReps &&
      !user.permissions?.canManageInventory
    ) {
      throw new AppError(403, 'ليس لديك صلاحية إرجاع عهدة المندوب للمخزن', 'FORBIDDEN');
    }
    return recordRepCustodyReturn(payload, user, opId);
  }

  if (opType === 'update_customer') {
    assertStaffPermission(user, 'canEdit');
    const customerId = payload.customerId || op.entityId;
    const serverCust = await getCustomerById(customerId);
    if (!serverCust) {
      throw new AppError(404, 'العميل غير موجود على السيرفر', 'CUSTOMER_NOT_FOUND');
    }
    if (user.role === 'representative') {
      const rep = authContext.representativeProfile || (await getRepresentativeByUserId(user.id));
      if (!rep) {
        throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
      }
    }
    if (
      !ignoreVersionCheck &&
      payload.baseVersion !== undefined &&
      Number(serverCust.version || 1) > Number(payload.baseVersion)
    ) {
      throw new AppError(
        409,
        `تم تعديل بيانات العميل (${serverCust.name}) على السيرفر (إصدار ${serverCust.version}) قبل مزامنة هذا التعديل.`,
        'VERSION_CONFLICT',
        { serverSnapshot: serverCust }
      );
    }
    return updateCustomer(customerId, payload, user);
  }

  throw new AppError(400, `نوع عملية المزامنة غير مدعوم (${opType})`, 'UNSUPPORTED_SYNC_OPERATION');
}

function isConflictError(err) {
  const code = String(err?.code || '');
  return (
    err?.status === 409 ||
    code === 'VERSION_CONFLICT' ||
    code === 'INSUFFICIENT_STOCK' ||
    code === 'INVOICE_CANCELLED' ||
    code === 'ORDER_ALREADY_INVOICED'
  );
}

router.get(
  '/pull',
  asyncHandler(async (req, res) => {
    const user = req.auth.user;
    const settings = await getSystemSettingsSafe();
    const serverTime = nowIso();

    if (user.role === 'customer') {
      if (settings.mobileConfig?.enableCustomerApp === false) {
        throw new AppError(403, 'تطبيق العملاء متوقف حاليًا من إعدادات الإدارة', 'CUSTOMER_APP_DISABLED');
      }
      const allowPriceView = Boolean(settings.mobileConfig?.allowCustomerPriceView);
      const cust = req.auth.customerProfile || null;
      const sanitizedCustomer = cust
        ? {
            ...cust,
            priceHistory: allowPriceView ? cust.priceHistory : {},
          }
        : null;

      const [products, categories, customerItemOrders, statement, syncConflicts] = await Promise.all([
        listProducts({ forCustomer: true, allowCustomerPriceView: allowPriceView }),
        listCategories(),
        listOrders(req.auth),
        cust ? getCustomerStatementData(cust.id, { allowPriceView }) : Promise.resolve(null),
        listUserScopedConflicts(user),
      ]);

      return res.json({
        ok: true,
        scope: 'customer',
        serverTime,
        user: sanitizeUser(user),
        customerProfile: sanitizedCustomer,
        mobileConfig: settings.mobileConfig,
        products,
        categories,
        customerItemOrders,
        orderAdvancePayments: statement?.advancePayments || [],
        invoices: statement?.invoices || [],
        invoiceReturns: statement?.returns || [],
        statement,
        syncConflicts,
        settings: {
          companyName: settings.companyName,
          companySubtitle: settings.companySubtitle,
          phone1: settings.phone1,
          phone2: settings.phone2,
          address: settings.address,
          currency: settings.currency,
          defaultPrintMode: settings.defaultPrintMode,
          invoiceNotes: settings.invoiceNotes,
        },
      });
    }

    const [staffData, rawRepProfile] = await Promise.all([
      getStaffBootstrapData(user),
      user.role === 'representative'
        ? Promise.resolve(req.auth.representativeProfile || getRepresentativeByUserId(user.id))
        : Promise.resolve(null),
    ]);
    const safeRepProfile = rawRepProfile
      ? {
          id: rawRepProfile.id,
          userId: rawRepProfile.userId || undefined,
          name: rawRepProfile.name,
          phone: rawRepProfile.phone || '',
          vehicleNumber: rawRepProfile.vehicleNumber || '',
          warehouseId: rawRepProfile.warehouseId || undefined,
          currentBalance: Number(rawRepProfile.currentBalance || 0),
          status: rawRepProfile.status || 'active',
        }
      : null;

    res.json({
      ok: true,
      scope: user.role === 'representative' ? 'representative' : 'staff',
      serverTime,
      user: sanitizeUser(user),
      representativeProfile: safeRepProfile,
      mobileConfig: settings.mobileConfig,
      ...staffData,
    });
  })
);

router.post(
  '/push',
  asyncHandler(async (req, res) => {
    if (req.body?.operations !== undefined && !Array.isArray(req.body.operations)) {
      throw new AppError(400, 'تنسيق عمليات المزامنة غير صالح', 'INVALID_SYNC_OPERATIONS');
    }
    const operations = Array.isArray(req.body?.operations) ? req.body.operations.slice(0, 200) : [];
    const user = req.auth.user;
    const results = [];

    for (const op of operations) {
      if (!op || typeof op !== 'object' || Array.isArray(op) || !op.operationId || !op.operationType) {
        results.push({
          operationId: op?.operationId || 'unknown',
          status: 'failed',
          error: 'بيانات عملية المزامنة غير مكتملة',
        });
        continue;
      }
      if (op.payload !== undefined && (op.payload === null || typeof op.payload !== 'object' || Array.isArray(op.payload))) {
        results.push({
          operationId: String(op.operationId),
          status: 'failed',
          code: 'INVALID_SYNC_PAYLOAD',
          error: 'بيانات العملية (payload) غير صالحة',
        });
        continue;
      }

      const existing = await findSyncOpDeduplication(user.id, op.operationId);
      if (existing && (existing.status === 'synced' || existing.status === 'deduplicated')) {
        results.push({
          operationId: op.operationId,
          status: 'synced',
          deduplicated: true,
        });
        continue;
      }

      try {
        const result = await applySingleOperation(op, req.auth);
        await recordSyncOpLog({
          operationId: op.operationId,
          userId: user.id,
          deviceId: op.deviceId || req.auth.deviceId,
          operationType: op.operationType,
          entityType: op.entityType || 'unknown',
          entityId: op.entityId || result?.id || result?.order?.id || result?.invoice?.id,
          status: 'synced',
          responseJson: result || {},
        });
        results.push({
          operationId: op.operationId,
          status: 'synced',
          result,
        });
      } catch (err) {
        if (isStrictPostgresMode() && (isPgConnectionError(err) || err?.code === 'DATABASE_UNAVAILABLE')) {
          markPgUnavailable('sync_push_connection_error');
          throw createDatabaseUnavailableError('sync_push_connection_error');
        }
        if (isConflictError(err)) {
          const conflict = await createConflictRecord({
            op,
            user,
            conflictReason: err.message,
            serverSnapshot: err.details?.serverSnapshot || {},
          });
          results.push({
            operationId: op.operationId,
            status: 'needs_review',
            conflictId: conflict.id,
            conflict,
            error: err.message,
          });
        } else {
          results.push({
            operationId: op.operationId,
            status: 'failed',
            code: err?.code || 'SYNC_OP_FAILED',
            error: err?.message || 'تعذر تنفيذ العملية على السيرفر',
          });
        }
      }
    }

    res.json({ ok: true, results });
  })
);

router.get(
  '/conflicts',
  asyncHandler(async (req, res) => {
    const conflicts = await listUserScopedConflicts(req.auth.user);
    res.json({ ok: true, conflicts });
  })
);

router.post(
  '/conflicts/:conflictId/resolve',
  asyncHandler(async (req, res) => {
    const { conflictId } = req.params;
    const action = String(req.body?.action || '').trim();
    const resolutionNotes = String(req.body?.resolutionNotes || '').trim();
    const user = req.auth.user;

    if (!['keep_server', 'apply_local', 'dismiss'].includes(action)) {
      throw new AppError(400, 'إجراء معالجة التعارض غير صالح', 'INVALID_CONFLICT_ACTION');
    }

    let conflict = null;
    if (await isPgMode()) {
      const pool = getPool();
      const cRes = await pool.query(`SELECT * FROM sync_conflicts WHERE id = $1 LIMIT 1`, [conflictId]);
      if (cRes.rows[0]) conflict = mapPgConflictRow(cRes.rows[0], user);
    } else {
      const db = readJsonDatabase();
      const rawConf = (db.syncConflicts || []).find((c) => c.id === conflictId) || null;
      if (rawConf) {
        const redactCosts = user?.role === 'representative';
        conflict = {
          ...rawConf,
          localPayload: sanitizeSyncPayload(rawConf.localPayload || {}, { redactCosts }),
          serverSnapshot: sanitizeSyncPayload(rawConf.serverSnapshot || {}, { redactCosts }),
        };
      }
    }

    if (!conflict) {
      throw new AppError(404, 'سجل التعارض غير موجود', 'CONFLICT_NOT_FOUND');
    }

    if (!canManageSyncConflictsGlobally(user) && conflict.userId !== user.id) {
      throw new AppError(403, 'غير مصرح لك بمعالجة تعارض مستخدم آخر', 'FORBIDDEN_CONFLICT_ACCESS');
    }

    if (action === 'apply_local') {
      const safeLocalPayload = sanitizeSyncPayload(conflict.localPayload || {}, { redactCosts: false });
      await applySingleOperation(
        {
          operationId: conflict.operationId,
          operationType: conflict.operationType,
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          deviceId: conflict.deviceId,
          payload: safeLocalPayload,
        },
        req.auth,
        { ignoreVersionCheck: true }
      );
    }

    const nextStatus =
      action === 'apply_local'
        ? 'resolved_apply_local'
        : action === 'keep_server'
        ? 'resolved_keep_server'
        : 'dismissed';
    const resolvedAt = nowIso();

    if (await isPgMode()) {
      const pool = getPool();
      await pool.query(
        `UPDATE sync_conflicts SET status = $1, resolution_notes = $2, resolved_by = $3, resolved_at = $4 WHERE id = $5`,
        [nextStatus, resolutionNotes, user.fullName || user.username, resolvedAt, conflictId]
      );
    } else {
      await withJsonTransaction((db) => {
        const idx = (db.syncConflicts || []).findIndex((c) => c.id === conflictId);
        if (idx >= 0) {
          db.syncConflicts[idx] = {
            ...db.syncConflicts[idx],
            status: nextStatus,
            resolutionNotes,
            resolvedBy: user.fullName || user.username,
            resolvedAt,
          };
        }
      });
    }

    await recordAuditLog({
      userId: user.id,
      userName: user.fullName,
      action: `معالجة تعارض مزامنة (${action}) للعملية ${conflict.operationId}`,
      module: 'المزامنة',
      recordId: conflictId,
      notes: resolutionNotes,
    });

    res.json({ ok: true, status: nextStatus });
  })
);

export default router;

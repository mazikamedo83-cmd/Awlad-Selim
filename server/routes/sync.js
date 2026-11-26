import { Router } from 'express';
import { getPool, isPgConnectionError, withTransaction } from '../db/postgres.js';
import { readJsonDatabase, withJsonTransaction } from '../db/jsonLedger.js';
import {
  isPgMode,
  isStrictPostgresMode,
  markPgUnavailable,
  createDatabaseUnavailableError,
  isoTimestamp,
  ADMIN_ONLY_PERMISSION_KEYS,
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
  updateOwnCustomerProfile,
  getCustomerById,
  recordCustomerPayment,
  getRepresentativeByUserId,
  listProductGroups,
  listCategories,
  listProductUnits,
  listProducts,
  updateProduct,
  getCustomerStatementData,
  getSystemSettingsSafe,
} from '../db/stores/catalogStore.js';
import {
  getPublishedStorefront,
  getCustomerFavorites,
  setCustomerFavorites,
  toggleCustomerFavorite,
} from '../db/stores/storefrontStore.js';
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
  createSalesReturnRequest,
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
  createRepTransfer,
  confirmRepTransfer,
  rejectRepTransfer,
  createRepItemTransfer,
  updateRepItemTransferStatus,
  recordRepCustodyDelivery,
  recordRepCustodyReturn,
  recordDamagedStock,
  transferStock,
  createSupplier,
  updateSupplier,
} from '../db/stores/inventoryAdminStore.js';
import {
  listDispatchRecipients,
  listDispatchBatches,
  getDispatchBatchDetails,
  createAndSendDispatchBatch,
  markDispatchBatchReceiving,
  confirmDispatchBatchReceipt,
  failDispatchBatchReceipt,
  resolveChainedLocalIdsInOp,
  registerCreatedLocalIdMapping,
} from '../db/stores/syncDispatchStore.js';

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
  if (user.role === 'representative' && permKey && ADMIN_ONLY_PERMISSION_KEYS.has(permKey)) {
    throw new AppError(
      403,
      `هذه الصلاحية (${permKey}) غير متاحة لحسابات المناديب`,
      'FORBIDDEN_ROLE_PERMISSION'
    );
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
    const isCashRefund = payload?.refundType === 'cash';
    if (user.role === 'representative' && String(payload?.cashboxId || '').trim()) {
      throw new AppError(
        403,
        'غير مصرح للمندوب باختيار خزينة الشركة أو تنفيذ عمليات نقدية مباشرة عليها',
        'FORBIDDEN_REP_CASHBOX_SELECTION'
      );
    }
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
      if (user.role === 'representative' && isCashRefund) {
        throw new AppError(
          403,
          'لا يمكن للمندوب تنفيذ مرتجع مبيعات نقدي مباشرة من الخزينة؛ يرجى رفع طلب مرتجع مبيعات نقدي لاعتماد الخزينة/الإدارة',
          'FORBIDDEN_REP_CASH_RETURN'
        );
      }
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

  if (opType === 'create_sales_return_request') {
    if (user.role === 'customer') {
      throw new AppError(403, 'غير مصرح للعملاء بإنشاء طلبات مرتجع مبيعات', 'FORBIDDEN');
    }
    assertStaffPermission(user, 'canManageSales');
    return createSalesReturnRequest(payload, user, opId);
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

  if (opType === 'update_supplier') {
    if (user.role !== 'admin' && !user.permissions?.canManagePurchases && !user.permissions?.canCreatePurchase) {
      throw new AppError(403, 'ليس لديك صلاحية تعديل الموردين', 'FORBIDDEN_PERMISSION');
    }
    const supplierId = payload.supplierId || op.entityId;
    if (!supplierId) throw new AppError(400, 'معرّف المورد مطلوب', 'SUPPLIER_ID_REQUIRED');
    return updateSupplier(supplierId, payload, user);
  }

  if (opType === 'update_product') {
    assertStaffPermission(user, 'canManageInventory');
    const productId = payload.productId || op.entityId;
    if (!productId) throw new AppError(400, 'معرّف الصنف مطلوب', 'PRODUCT_ID_REQUIRED');
    return updateProduct(productId, payload, user);
  }

  if (opType === 'record_damaged_stock') {
    assertStaffPermission(user, 'canManageInventory');
    return recordDamagedStock(payload, user);
  }

  if (opType === 'transfer_stock') {
    assertStaffPermission(user, 'canManageInventory');
    return transferStock(payload, user);
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

  if (opType === 'create_rep_transfer') {
    if (user.role !== 'representative' && user.role !== 'admin' && !user.permissions?.canManageTransfers && !user.permissions?.canManageReps) {
      throw new AppError(403, 'ليس لديك صلاحية إنشاء تحويل مندوب', 'FORBIDDEN_PERMISSION');
    }
    return createRepTransfer(payload, user, opId);
  }

  if (opType === 'confirm_rep_transfer') {
    if (user.role !== 'representative' && user.role !== 'admin' && !user.permissions?.canManageTransfers && !user.permissions?.canManageCashboxes && !user.permissions?.canManageAccounts) {
      throw new AppError(403, 'ليس لديك صلاحية اعتماد التحويل', 'FORBIDDEN_PERMISSION');
    }
    return confirmRepTransfer(payload.transferId || op.entityId, payload, user, opId);
  }

  if (opType === 'reject_rep_transfer') {
    if (user.role !== 'representative' && user.role !== 'admin' && !user.permissions?.canManageTransfers) {
      throw new AppError(403, 'ليس لديك صلاحية رفض التحويل', 'FORBIDDEN_PERMISSION');
    }
    return rejectRepTransfer(payload.transferId || op.entityId, payload, user, opId);
  }

  if (opType === 'create_rep_item_transfer') {
    if (user.role !== 'representative' && user.role !== 'admin' && !user.permissions?.canManageTransfers && !user.permissions?.canManageReps) {
      throw new AppError(403, 'غير مصرح بإنشاء طلب تحويل أصناف', 'FORBIDDEN_PERMISSION');
    }
    return createRepItemTransfer(payload, user, opId);
  }

  if (opType === 'confirm_custody_receipt') {
    if (user.role !== 'representative' && user.role !== 'admin' && !user.permissions?.canManageTransfers) {
      throw new AppError(403, 'ليس لديك صلاحية تأكيد استلام العهدة', 'FORBIDDEN');
    }
    return updateRepItemTransferStatus(
      payload.requestId || op.entityId,
      { status: 'received', notes: payload.notes || '' },
      user,
      opId
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

  if (opType === 'update_own_profile') {
    if (user.role !== 'customer') {
      throw new AppError(403, 'تعديل الملف الشخصي عبر هذه العملية متاح للعملاء فقط', 'CUSTOMER_ONLY');
    }
    const cust = authContext.customerProfile;
    if (!cust) {
      throw new AppError(404, authContext.linkWarning || 'حسابك غير مربوط بملف عميل', 'CUSTOMER_PROFILE_REQUIRED');
    }
    return updateOwnCustomerProfile(user.id, cust.id, payload, user);
  }

  if (opType === 'update_customer_favorites') {
    if (user.role !== 'customer') {
      throw new AppError(403, 'تحديث المفضلة متاح للعملاء فقط', 'CUSTOMER_ONLY');
    }
    const cust = authContext.customerProfile;
    if (!cust) {
      throw new AppError(404, authContext.linkWarning || 'حسابك غير مربوط بملف عميل', 'CUSTOMER_PROFILE_REQUIRED');
    }
    if (payload.productId && payload.action === 'toggle') {
      return toggleCustomerFavorite(cust.id, payload.productId);
    }
    const favoriteProductIds = await setCustomerFavorites(
      cust.id,
      payload.favoriteProductIds || payload.productIds || []
    );
    return { favoriteProductIds };
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

      const [products, productGroups, categories, productUnits, customerItemOrders, statement, syncConflicts, publishedStorefront, customerFavorites] = await Promise.all([
        listProducts({ forCustomer: true, allowCustomerPriceView: allowPriceView }),
        listProductGroups(),
        listCategories(),
        listProductUnits(),
        listOrders(req.auth),
        cust ? getCustomerStatementData(cust.id, { allowPriceView }) : Promise.resolve(null),
        listUserScopedConflicts(user),
        getPublishedStorefront(),
        cust ? getCustomerFavorites(cust.id) : Promise.resolve([]),
      ]);

      return res.json({
        ok: true,
        scope: 'customer',
        serverTime,
        user: sanitizeUser(user),
        customerProfile: sanitizedCustomer,
        mobileConfig: settings.mobileConfig,
        publishedStorefront,
        customerFavorites,
        products,
        productGroups,
        categories,
        productUnits,
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

    const [staffData, rawRepProfile, syncState] = await Promise.all([
      getStaffBootstrapData(user),
      user.role === 'representative'
        ? Promise.resolve(req.auth.representativeProfile || getRepresentativeByUserId(user.id))
        : Promise.resolve(null),
      getUserSyncState(user.id),
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
      syncState,
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
    const localIdMap = new Map();

    for (const rawOp of operations) {
      if (!rawOp || typeof rawOp !== 'object' || Array.isArray(rawOp) || !rawOp.operationId || !rawOp.operationType) {
        results.push({
          operationId: rawOp?.operationId || 'unknown',
          status: 'failed',
          error: 'بيانات عملية المزامنة غير مكتملة',
        });
        continue;
      }
      if (rawOp.payload !== undefined && (rawOp.payload === null || typeof rawOp.payload !== 'object' || Array.isArray(rawOp.payload))) {
        results.push({
          operationId: String(rawOp.operationId),
          status: 'failed',
          code: 'INVALID_SYNC_PAYLOAD',
          error: 'بيانات العملية (payload) غير صالحة',
        });
        continue;
      }

      const op = resolveChainedLocalIdsInOp(rawOp, localIdMap);

      const existing = await findSyncOpDeduplication(user.id, op.operationId);
      if (existing && (existing.status === 'synced' || existing.status === 'deduplicated')) {
        const existingResult = existing.response_json || existing.responseJson || {};
        registerCreatedLocalIdMapping(op, existingResult, localIdMap);
        results.push({
          operationId: op.operationId,
          status: 'synced',
          deduplicated: true,
        });
        continue;
      }

      try {
        const result = await applySingleOperation(op, req.auth);
        registerCreatedLocalIdMapping(op, result, localIdMap);
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
  '/dispatches/recipients',
  asyncHandler(async (req, res) => {
    const recipients = await listDispatchRecipients(req.auth.user);
    res.json({ ok: true, recipients });
  })
);

router.get(
  '/dispatches',
  asyncHandler(async (req, res) => {
    const batches = await listDispatchBatches(req.auth.user, {
      receiptStatus: req.query?.receiptStatus ? String(req.query.receiptStatus) : undefined,
      sendStatus: req.query?.sendStatus ? String(req.query.sendStatus) : undefined,
      senderUserId: req.query?.senderUserId ? String(req.query.senderUserId) : undefined,
      recipientUserId: req.query?.recipientUserId ? String(req.query.recipientUserId) : undefined,
      search: req.query?.search ? String(req.query.search) : undefined,
    });
    res.json({ ok: true, batches });
  })
);

router.get(
  '/dispatches/:batchId',
  asyncHandler(async (req, res) => {
    const data = await getDispatchBatchDetails(req.params.batchId, req.auth.user);
    res.json({ ok: true, ...data });
  })
);

router.post(
  '/dispatches',
  asyncHandler(async (req, res) => {
    const result = await createAndSendDispatchBatch(req.body || {}, req.auth, {
      applySingleOperation,
      findSyncOpDeduplication,
      recordSyncOpLog,
      createConflictRecord,
      isConflictError,
    });
    res.status(result.deduplicated ? 200 : 201).json({ ok: true, ...result });
  })
);

router.post(
  '/dispatches/:batchId/mark-receiving',
  asyncHandler(async (req, res) => {
    const result = await markDispatchBatchReceiving(req.params.batchId, req.auth.user);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/dispatches/:batchId/confirm-receipt',
  asyncHandler(async (req, res) => {
    const result = await confirmDispatchBatchReceipt(req.params.batchId, req.body || {}, req.auth);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/dispatches/:batchId/fail-receipt',
  asyncHandler(async (req, res) => {
    const result = await failDispatchBatchReceipt(req.params.batchId, req.body || {}, req.auth);
    res.json({ ok: true, ...result });
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

// ============================================================================
// UNIFIED SEND & RECEIVE SYSTEM (الإرسال والاستلام الموحد لكل مستخدم)
// ============================================================================

const DEFAULT_USER_SYNC_STATE = {
  lastSendAt: null,
  lastSendStatus: 'never',
  lastSendCount: 0,
  lastSendSummary: {},
  lastReceiveAt: null,
  lastReceiveStatus: 'never',
  lastReceiveCount: 0,
  lastReceiveSummary: {},
};

let ensuredUserSyncTable = false;
async function ensurePgUserSyncTable(pool) {
  if (ensuredUserSyncTable) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sync_states (
        user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_send_at TIMESTAMPTZ,
        last_send_status VARCHAR(32) DEFAULT 'never',
        last_send_count INT NOT NULL DEFAULT 0,
        last_send_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_receive_at TIMESTAMPTZ,
        last_receive_status VARCHAR(32) DEFAULT 'never',
        last_receive_count INT NOT NULL DEFAULT 0,
        last_receive_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    ensuredUserSyncTable = true;
  } catch {
    // Table may already exist via schema.sql or user permissions
  }
}

export async function getUserSyncState(userId) {
  if (!userId) return { ...DEFAULT_USER_SYNC_STATE };
  if (await isPgMode()) {
    const pool = getPool();
    await ensurePgUserSyncTable(pool);
    const res = await pool.query('SELECT * FROM user_sync_states WHERE user_id = $1 LIMIT 1', [userId]);
    const row = res.rows[0];
    if (!row) return { ...DEFAULT_USER_SYNC_STATE };
    return {
      lastSendAt: row.last_send_at ? isoTimestamp(row.last_send_at) : null,
      lastSendStatus: row.last_send_status || 'never',
      lastSendCount: Number(row.last_send_count || 0),
      lastSendSummary: row.last_send_summary || {},
      lastReceiveAt: row.last_receive_at ? isoTimestamp(row.last_receive_at) : null,
      lastReceiveStatus: row.last_receive_status || 'never',
      lastReceiveCount: Number(row.last_receive_count || 0),
      lastReceiveSummary: row.last_receive_summary || {},
    };
  }
  const db = readJsonDatabase();
  const s = (db.userSyncStates || {})[userId];
  if (!s) return { ...DEFAULT_USER_SYNC_STATE };
  return { ...DEFAULT_USER_SYNC_STATE, ...s };
}

async function updateUserSyncState(userId, patch) {
  if (!userId) return { ...DEFAULT_USER_SYNC_STATE };
  const now = nowIso();
  if (await isPgMode()) {
    const pool = getPool();
    await ensurePgUserSyncTable(pool);
    const prev = await getUserSyncState(userId);
    const next = { ...prev, ...patch };
    await pool.query(
      `INSERT INTO user_sync_states (
         user_id, last_send_at, last_send_status, last_send_count, last_send_summary,
         last_receive_at, last_receive_status, last_receive_count, last_receive_summary, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id) DO UPDATE SET
         last_send_at = EXCLUDED.last_send_at,
         last_send_status = EXCLUDED.last_send_status,
         last_send_count = EXCLUDED.last_send_count,
         last_send_summary = EXCLUDED.last_send_summary,
         last_receive_at = EXCLUDED.last_receive_at,
         last_receive_status = EXCLUDED.last_receive_status,
         last_receive_count = EXCLUDED.last_receive_count,
         last_receive_summary = EXCLUDED.last_receive_summary,
         updated_at = EXCLUDED.updated_at`,
      [
        userId,
        next.lastSendAt || null,
        next.lastSendStatus || 'never',
        Number(next.lastSendCount || 0),
        JSON.stringify(next.lastSendSummary || {}),
        next.lastReceiveAt || null,
        next.lastReceiveStatus || 'never',
        Number(next.lastReceiveCount || 0),
        JSON.stringify(next.lastReceiveSummary || {}),
        now,
      ]
    );
    return next;
  }
  return withJsonTransaction((db) => {
    db.userSyncStates = db.userSyncStates || {};
    const prev = { ...DEFAULT_USER_SYNC_STATE, ...(db.userSyncStates[userId] || {}) };
    const next = { ...prev, ...patch, updatedAt: now };
    db.userSyncStates[userId] = next;
    return next;
  });
}

function summarizeSendOperations(operations, results) {
  const byCategory = {
    salesInvoices: 0,
    purchaseInvoices: 0,
    returns: 0,
    collections: 0,
    customers: 0,
    orders: 0,
    transfers: 0,
    other: 0,
  };
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const r = results[i];
    if (!r || r.status !== 'synced') continue;
    const t = String(op?.operationType || '');
    if (t.includes('sales_invoice') || t === 'create_sales_quote') byCategory.salesInvoices++;
    else if (t.includes('purchase_invoice')) byCategory.purchaseInvoices++;
    else if (t.includes('return')) byCategory.returns++;
    else if (t.includes('payment') || t.includes('advance') || t === 'execute_cash_operation') byCategory.collections++;
    else if (t.includes('customer') && !t.includes('order')) byCategory.customers++;
    else if (t.includes('order')) byCategory.orders++;
    else if (t.includes('transfer') || t.includes('custody')) byCategory.transfers++;
    else byCategory.other++;
  }
  return byCategory;
}

router.get(
  '/state',
  asyncHandler(async (req, res) => {
    const user = req.auth.user;
    const syncState = await getUserSyncState(user.id);
    res.json({ ok: true, state: syncState, serverTime: nowIso() });
  })
);

router.post(
  '/send',
  asyncHandler(async (req, res) => {
    if (req.body?.operations !== undefined && !Array.isArray(req.body.operations)) {
      throw new AppError(400, 'تنسيق عمليات الإرسال غير صالح', 'INVALID_SYNC_OPERATIONS');
    }
    const operations = Array.isArray(req.body?.operations) ? req.body.operations.slice(0, 200) : [];
    const user = req.auth.user;
    if (user.role === 'customer') {
      throw new AppError(403, 'شاشة الإرسال والاستلام مخصصة للمناديب والإدارة والموظفين فقط', 'FORBIDDEN_STAFF_ONLY');
    }

    const sentAt = nowIso();
    const results = [];
    const localIdMap = new Map();

    for (const rawOp of operations) {
      if (!rawOp || typeof rawOp !== 'object' || Array.isArray(rawOp) || !rawOp.operationId || !rawOp.operationType) {
        results.push({
          operationId: rawOp?.operationId || 'unknown',
          status: 'failed',
          error: 'بيانات العملية غير مكتملة',
        });
        continue;
      }
      if (rawOp.payload !== undefined && (rawOp.payload === null || typeof rawOp.payload !== 'object' || Array.isArray(rawOp.payload))) {
        results.push({
          operationId: String(rawOp.operationId),
          status: 'failed',
          code: 'INVALID_SYNC_PAYLOAD',
          error: 'بيانات العملية (payload) غير صالحة',
        });
        continue;
      }

      const op = resolveChainedLocalIdsInOp(rawOp, localIdMap);
      const existing = await findSyncOpDeduplication(user.id, op.operationId);
      if (existing && (existing.status === 'synced' || existing.status === 'deduplicated')) {
        const existingResult = existing.response_json || existing.responseJson || {};
        registerCreatedLocalIdMapping(op, existingResult, localIdMap);
        results.push({
          operationId: op.operationId,
          status: 'synced',
          deduplicated: true,
        });
        continue;
      }

      try {
        const result = await applySingleOperation(op, req.auth);
        registerCreatedLocalIdMapping(op, result, localIdMap);
        await recordSyncOpLog({
          operationId: op.operationId,
          userId: user.id,
          deviceId: op.deviceId || req.auth.deviceId,
          operationType: op.operationType,
          entityType: op.entityType || 'unknown',
          entityId: op.entityId || result?.id || result?.order?.id || result?.invoice?.id,
          status: 'synced',
          responseJson: { ...(result || {}), sentAt },
        });
        results.push({
          operationId: op.operationId,
          status: 'synced',
          result,
        });
      } catch (err) {
        if (isStrictPostgresMode() && (isPgConnectionError(err) || err?.code === 'DATABASE_UNAVAILABLE')) {
          markPgUnavailable('sync_send_connection_error');
          throw createDatabaseUnavailableError('sync_send_connection_error');
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

    const syncedResults = results.filter((r) => r.status === 'synced');
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const conflictCount = results.filter((r) => r.status === 'needs_review').length;
    const deduplicatedCount = syncedResults.filter((r) => r.deduplicated).length;
    const sentCount = syncedResults.length;
    const allSucceeded = failedCount === 0 && conflictCount === 0;
    const summary = summarizeSendOperations(operations, results);

    let syncState = await getUserSyncState(user.id);
    if (operations.length > 0 && allSucceeded && sentCount > 0) {
      syncState = await updateUserSyncState(user.id, {
        lastSendAt: sentAt,
        lastSendStatus: 'success',
        lastSendCount: sentCount,
        lastSendSummary: summary,
      });
      await recordAuditLog({
        userId: user.id,
        userName: user.fullName || user.username,
        action: `إرسال يدوي ناجح (${sentCount} عملية، مكرر: ${deduplicatedCount}) عبر شاشة الإرسال والاستلام`,
        module: 'الإرسال والاستلام',
        notes: JSON.stringify(summary),
      });
    }

    res.json({
      ok: true,
      allSucceeded,
      sentAt: allSucceeded && sentCount > 0 ? sentAt : null,
      sentCount,
      deduplicatedCount,
      failedCount,
      conflictCount,
      summary,
      results,
      syncState,
      serverTime: nowIso(),
    });
  })
);

async function computeReceivePreviewData(auth) {
  const user = auth.user;
  const isRep = user.role === 'representative';
  const repProfile = isRep ? (auth.representativeProfile || (await getRepresentativeByUserId(user.id))) : null;
  const syncState = await getUserSyncState(user.id);
  const lastReceiveAt = syncState.lastReceiveAt || null;

  let staffData = null;
  staffData = await getStaffBootstrapData(user);

  const incomingCustodyDispatches = [];
  const incomingCashTransfers = [];
  const incomingBatches = [];
  const updatedDocuments = [];

  if (isRep && repProfile) {
    for (const rit of staffData.repItemTransfers || []) {
      if (rit.representativeId === repProfile.id && rit.status === 'executed') {
        incomingCustodyDispatches.push({
          id: rit.id,
          requestNumber: rit.requestNumber,
          date: rit.date,
          sourceWarehouseName: rit.sourceWarehouseName,
          targetWarehouseName: rit.targetWarehouseName,
          itemsCount: (rit.items || []).length,
          totalQty: (rit.items || []).reduce((s, it) => s + Number(it.executedQty ?? it.approvedQty ?? it.requestedQty ?? 0), 0),
          notes: rit.notes || '',
          createdAt: rit.createdAt,
        });
      }
    }
    for (const rt of staffData.repTransfers || []) {
      if (
        rt.status === 'awaiting_receipt' &&
        ((rt.direction === 'owner_to_rep' && (rt.receiverId === repProfile.id || rt.representativeId === repProfile.id)) ||
          (rt.direction === 'rep_to_rep' && rt.receiverId === repProfile.id))
      ) {
        incomingCashTransfers.push({
          id: rt.id,
          transferNumber: rt.transferNumber,
          date: rt.date,
          direction: rt.direction,
          senderName: rt.senderName,
          amount: Number(rt.amount || 0),
          notes: rt.notes || '',
          sentAt: rt.sentAt,
        });
      }
    }
  } else {
    for (const rt of staffData.repTransfers || []) {
      if (rt.status === 'awaiting_receipt' && rt.direction === 'rep_to_owner') {
        incomingCashTransfers.push({
          id: rt.id,
          transferNumber: rt.transferNumber,
          date: rt.date,
          direction: rt.direction,
          senderName: rt.senderName,
          amount: Number(rt.amount || 0),
          notes: rt.notes || '',
          sentAt: rt.sentAt,
        });
      }
    }
  }

  const allBatches = await listDispatchBatches(user, {});
  for (const b of allBatches || []) {
    if (
      (b.receiptStatus === 'في انتظار الاستلام' || b.receiptStatus === 'قيد الاستلام') &&
      (b.recipientUserId === user.id || (!isRep && user.role === 'admin' && b.senderUserId !== user.id))
    ) {
      incomingBatches.push({
        id: b.id,
        batchNumber: b.batchNumber,
        senderName: b.senderName,
        representativeName: b.representativeName || '',
        salesCount: Number(b.salesCount || 0),
        collectionsCount: Number(b.collectionsCount || 0),
        returnsCount: Number(b.returnsCount || 0),
        totalAmount: Number(b.totalSalesAmount || 0) + Number(b.totalCashAmount || 0),
        sentAt: b.sentAt,
        receiptStatus: b.receiptStatus,
      });
    }
  }

  // Informational updated/approved records created after lastReceiveAt (or pending review)
  if (lastReceiveAt) {
    const cutoff = new Date(lastReceiveAt).getTime();
    if (Number.isFinite(cutoff)) {
      for (const sr of staffData.salesReturnRequests || []) {
        const ts = new Date(sr.reviewedAt || sr.createdAt || 0).getTime();
        if (ts > cutoff && sr.status !== 'pending') {
          updatedDocuments.push({ kind: 'sales_return_request', id: sr.id, number: sr.requestNumber, status: sr.status, date: sr.date });
        }
      }
      for (const pr of staffData.purchaseReturnRequests || []) {
        const ts = new Date(pr.reviewedAt || pr.createdAt || 0).getTime();
        if (ts > cutoff && pr.status !== 'pending') {
          updatedDocuments.push({ kind: 'purchase_return_request', id: pr.id, number: pr.requestNumber, status: pr.status, date: pr.date });
        }
      }
      for (const inv of staffData.invoices || []) {
        if (inv.type === 'purchase' && inv.createdByUserId === user.id && inv.status !== 'draft') {
          const ts = new Date(inv.receivedAt || inv.confirmedAt || inv.updatedAt || inv.createdAt || 0).getTime();
          if (ts > cutoff) {
            updatedDocuments.push({ kind: 'purchase_approval', id: inv.id, number: inv.invoiceNumber, status: inv.status, date: inv.date });
          }
        }
      }
    }
  }

  const actionableCount = incomingCustodyDispatches.length + incomingCashTransfers.length + incomingBatches.length;
  const totalItemsCount = actionableCount + updatedDocuments.length;

  return {
    syncState,
    hasUpdates: totalItemsCount > 0,
    hasActionableItems: actionableCount > 0,
    totalItemsCount,
    actionableCount,
    summary: {
      custodyDispatchesCount: incomingCustodyDispatches.length,
      cashTransfersCount: incomingCashTransfers.length,
      dispatchBatchesCount: incomingBatches.length,
      updatedDocumentsCount: updatedDocuments.length,
    },
    items: {
      custodyDispatches: incomingCustodyDispatches,
      cashTransfers: incomingCashTransfers,
      dispatchBatches: incomingBatches,
      updatedDocuments,
    },
  };
}

router.get(
  '/receive-preview',
  asyncHandler(async (req, res) => {
    const user = req.auth.user;
    if (user.role === 'customer') {
      throw new AppError(403, 'شاشة الإرسال والاستلام مخصصة للمناديب والإدارة والموظفين فقط', 'FORBIDDEN_STAFF_ONLY');
    }
    const preview = await computeReceivePreviewData(req.auth);
    res.json({
      ok: true,
      ...preview,
      serverTime: nowIso(),
    });
  })
);

router.post(
  '/receive-confirm',
  asyncHandler(async (req, res) => {
    const user = req.auth.user;
    if (user.role === 'customer') {
      throw new AppError(403, 'شاشة الإرسال والاستلام مخصصة للمناديب والإدارة والموظفين فقط', 'FORBIDDEN_STAFF_ONLY');
    }

    const baseIdemKey = String(req.body?.idempotencyKey || req.headers['x-idempotency-key'] || generateServerId('RCV')).trim();
    const previewBefore = await computeReceivePreviewData(req.auth);

    const requestedCustodyIds = Array.isArray(req.body?.confirmCustodyIds)
      ? req.body.confirmCustodyIds.map(String)
      : previewBefore.items.custodyDispatches.map((c) => c.id);
    const requestedCashTransferIds = Array.isArray(req.body?.confirmCashTransferIds)
      ? req.body.confirmCashTransferIds.map(String)
      : previewBefore.items.cashTransfers.map((c) => c.id);
    const requestedBatchIds = Array.isArray(req.body?.confirmBatchIds)
      ? req.body.confirmBatchIds.map(String)
      : previewBefore.items.dispatchBatches.map((b) => b.id);

    const receivedAt = nowIso();
    let confirmedCustodyCount = 0;
    let confirmedCashTransfersCount = 0;
    let confirmedBatchesCount = 0;
    const errors = [];

    for (const custodyId of requestedCustodyIds) {
      if (!previewBefore.items.custodyDispatches.some((c) => c.id === custodyId)) continue;
      try {
        await updateRepItemTransferStatus(
          custodyId,
          { status: 'received', notes: 'تم تأكيد استلام العهدة عبر شاشة الإرسال والاستلام' },
          user,
          `${baseIdemKey}:custody:${custodyId}`
        );
        confirmedCustodyCount++;
      } catch (err) {
        if (err?.code === 'ALREADY_RECEIVED' || err?.status === 409) {
          // Already received earlier, safe idempotent skip
        } else {
          errors.push({ type: 'custody', id: custodyId, error: err?.message || 'فشل تأكيد استلام العهدة' });
        }
      }
    }

    for (const transferId of requestedCashTransferIds) {
      if (!previewBefore.items.cashTransfers.some((c) => c.id === transferId)) continue;
      try {
        await confirmRepTransfer(
          transferId,
          { note: 'تم تأكيد استلام التحويل النقدي عبر شاشة الإرسال والاستلام' },
          user,
          `${baseIdemKey}:cash:${transferId}`
        );
        confirmedCashTransfersCount++;
      } catch (err) {
        if (err?.code === 'ALREADY_RECEIVED') {
          // Safe idempotent skip
        } else {
          errors.push({ type: 'cash_transfer', id: transferId, error: err?.message || 'فشل تأكيد استلام التحويل' });
        }
      }
    }

    for (const batchId of requestedBatchIds) {
      if (!previewBefore.items.dispatchBatches.some((b) => b.id === batchId)) continue;
      try {
        await confirmDispatchBatchReceipt(
          batchId,
          { notes: 'تم تأكيد الاستلام عبر شاشة الإرسال والاستلام', idempotencyKey: `${baseIdemKey}:batch:${batchId}` },
          req.auth
        );
        confirmedBatchesCount++;
      } catch (err) {
        errors.push({ type: 'dispatch_batch', id: batchId, error: err?.message || 'فشل تأكيد استلام الدفعة' });
      }
    }

    const totalConfirmed =
      confirmedCustodyCount +
      confirmedCashTransfersCount +
      confirmedBatchesCount +
      previewBefore.items.updatedDocuments.length;

    const allSucceeded = errors.length === 0;
    const summary = {
      custodyDispatchesCount: confirmedCustodyCount,
      cashTransfersCount: confirmedCashTransfersCount,
      dispatchBatchesCount: confirmedBatchesCount,
      updatedDocumentsCount: previewBefore.items.updatedDocuments.length,
    };

    let syncState = await getUserSyncState(user.id);
    if (allSucceeded) {
      syncState = await updateUserSyncState(user.id, {
        lastReceiveAt: receivedAt,
        lastReceiveStatus: 'success',
        lastReceiveCount: totalConfirmed,
        lastReceiveSummary: summary,
      });
      await recordAuditLog({
        userId: user.id,
        userName: user.fullName || user.username,
        action: `استلام يدوي مؤكد (${totalConfirmed} عنصر) عبر شاشة الإرسال والاستلام`,
        module: 'الإرسال والاستلام',
        notes: JSON.stringify(summary),
      });
    }

    const freshBootstrap = await getStaffBootstrapData(user);
    const rawRepProfile =
      user.role === 'representative'
        ? (req.auth.representativeProfile || (await getRepresentativeByUserId(user.id)))
        : null;
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
      ok: allSucceeded,
      allSucceeded,
      receivedAt: allSucceeded ? receivedAt : null,
      receivedCount: totalConfirmed,
      summary,
      errors,
      syncState,
      bootstrap: {
        scope: user.role === 'representative' ? 'representative' : 'staff',
        serverTime: nowIso(),
        user: sanitizeUser(user),
        representativeProfile: safeRepProfile,
        syncState,
        ...freshBootstrap,
      },
    });
  })
);

export default router;


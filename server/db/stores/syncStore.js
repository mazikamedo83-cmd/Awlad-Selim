import { getPool, withTransaction } from '../postgres.js';
import { withJsonTransaction, readJsonDatabase } from '../jsonLedger.js';
import { generateServerId } from '../../utils/crypto.js';
import { AppError, nowIso, sanitizeUser } from '../../utils/errors.js';
import {
  isPgMode,
  mapPgUserRow,
  mapPgCustomerRow,
  isoTimestamp,
} from './mode.js';
import { recordAuditLog } from './authStore.js';
import { getStaffBootstrapData, executeCashOperation } from './inventoryAdminStore.js';
import {
  listProducts,
  listCategories,
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  recordCustomerPayment,
  getCustomerStatementData,
  getRepresentativeByUserId,
  isCustomerAllowedForRep,
  getSystemSettingsSafe,
  normalizePhoneDigits,
} from './catalogStore.js';
import {
  createSalesInvoice,
  createPurchaseInvoice,
  editSalesInvoice,
  addInvoicePayment,
  createInvoiceReturn,
  listInvoices,
} from './invoicesStore.js';
import {
  listOrders,
  getOrderById,
  createCustomerOrder,
  recordOrderAdvancePayment,
  updateOrderDeliveryStatus,
} from './ordersStore.js';

function mapPgConflictRow(r) {
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
    localPayload: r.local_payload || {},
    serverSnapshot: r.server_snapshot || {},
    status: r.status,
    resolutionNotes: r.resolution_notes || '',
    resolvedBy: r.resolved_by || undefined,
    resolvedAt: r.resolved_at ? isoTimestamp(r.resolved_at) : undefined,
    createdAt: isoTimestamp(r.created_at),
  };
}

function buildMediaManifest(products = []) {
  const list = [];
  for (const p of products) {
    if (!p?.image) continue;
    const imgStr = String(p.image);
    list.push({
      productId: p.id,
      productName: p.name,
      image: imgStr,
      version: Number(p.version || 1),
      sizeHint: imgStr.length,
    });
  }
  return list;
}

async function loadFreshUserAuthState(userId) {
  if (await isPgMode()) {
    const pool = getPool();
    const uRes = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const row = uRes.rows[0];
    if (!row) return null;
    const user = sanitizeUser(mapPgUserRow(row));
    const custRes = user.role === 'customer'
      ? await pool.query(`SELECT * FROM customers WHERE user_id = $1 LIMIT 1`, [user.id])
      : { rows: [] };
    const rep = user.role === 'representative' ? await getRepresentativeByUserId(user.id) : null;
    return {
      user,
      isActive: Boolean(row.is_active),
      customerProfile: custRes.rows[0] ? mapPgCustomerRow(custRes.rows[0]) : null,
      representativeProfile: rep,
    };
  }

  const db = readJsonDatabase();
  const raw = (db.users || []).find((u) => u.id === userId);
  if (!raw) return null;
  const user = sanitizeUser(raw);
  const customerProfile = user.role === 'customer' ? (db.customers || []).find((c) => c.userId === user.id) || null : null;
  const representativeProfile = user.role === 'representative' ? (db.representatives || []).find((r) => r.userId === user.id) || null : null;
  return {
    user,
    isActive: Boolean(raw.isActive),
    customerProfile,
    representativeProfile,
  };
}

export async function listSyncConflicts(authContext, { status = null } = {}) {
  const actor = authContext.user;
  const canViewAll =
    actor.role === 'admin' ||
    Boolean(actor.permissions?.canManageSales) ||
    Boolean(actor.permissions?.canManageAccounts);

  if (await isPgMode()) {
    const pool = getPool();
    const params = [];
    const clauses = [];
    if (!canViewAll) {
      params.push(actor.id);
      clauses.push(`user_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const res = await pool.query(`SELECT * FROM sync_conflicts ${whereSql} ORDER BY created_at DESC LIMIT 300`, params);
    return res.rows.map(mapPgConflictRow);
  }

  const db = readJsonDatabase();
  return (db.syncConflicts || [])
    .filter((c) => (canViewAll ? true : c.userId === actor.id))
    .filter((c) => (status ? c.status === status : true))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getSyncPullPayload(authContext, { since = null } = {}) {
  const actor = authContext.user;
  const serverTime = nowIso();
  const settings = await getSystemSettingsSafe();

  if (actor.role === 'customer') {
    const allowPriceView = Boolean(settings.mobileConfig?.allowCustomerPriceView);
    if (settings.mobileConfig?.enableCustomerApp === false) {
      throw new AppError(403, 'تطبيق العملاء متوقف حاليًا من إعدادات الإدارة', 'CUSTOMER_APP_DISABLED');
    }
    const products = await listProducts({ forCustomer: true, allowCustomerPriceView });
    const categories = await listCategories();
    const orders = await listOrders(authContext);
    const statement = authContext.customerProfile
      ? await getCustomerStatementData(authContext.customerProfile.id, { allowPriceView })
      : null;
    const syncConflicts = await listSyncConflicts(authContext);

    return {
      serverTime,
      since: since || null,
      scope: 'customer',
      user: actor,
      customerProfile: statement?.customer || authContext.customerProfile || null,
      representativeProfile: null,
      mobileConfig: settings.mobileConfig,
      settings: {
        companyName: settings.companyName,
        companySubtitle: settings.companySubtitle,
        currency: settings.currency,
        phone1: settings.phone1,
        phone2: settings.phone2,
        address: settings.address,
      },
      categories,
      products,
      customerItemOrders: orders,
      invoices: statement?.invoices || [],
      invoiceReturns: statement?.returns || [],
      orderAdvancePayments: statement?.advancePayments || [],
      statement,
      syncConflicts,
      mediaManifest: buildMediaManifest(products),
    };
  }

  const bootstrap = await getStaffBootstrapData(actor);
  return {
    serverTime,
    since: since || null,
    scope: actor.role === 'representative' ? 'representative' : 'staff',
    user: actor,
    customerProfile: null,
    representativeProfile: authContext.representativeProfile || null,
    mobileConfig: settings.mobileConfig,
    ...bootstrap,
    mediaManifest: buildMediaManifest(bootstrap.products || []),
  };
}

async function findLoggedOperation(userId, operationId) {
  if (!operationId) return null;
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM sync_operation_logs WHERE operation_id = $1 AND user_id = $2 LIMIT 1`,
      [operationId, userId]
    );
    return res.rows[0]
      ? {
          id: res.rows[0].id,
          operationId: res.rows[0].operation_id,
          operationType: res.rows[0].operation_type,
          status: res.rows[0].status,
          entityId: res.rows[0].entity_id,
          result: res.rows[0].response_json || null,
        }
      : null;
  }
  const db = readJsonDatabase();
  return (
    (db.syncOperationLogs || []).find((l) => l.operationId === operationId && l.userId === userId) || null
  );
}

async function saveLoggedOperation({ operationId, operationType, userId, deviceId, status, entityId = null, responseJson = null }) {
  const now = nowIso();
  const id = generateServerId('SYL');
  if (await isPgMode()) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO sync_operation_logs (id, operation_id, operation_type, user_id, device_id, status, entity_id, response_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (operation_id) DO NOTHING`,
      [id, operationId, operationType, userId, deviceId || null, status, entityId, JSON.stringify(responseJson || {}), now]
    );
    return;
  }

  await withJsonTransaction((db) => {
    db.syncOperationLogs = db.syncOperationLogs || [];
    if (db.syncOperationLogs.some((l) => l.operationId === operationId && l.userId === userId)) return;
    db.syncOperationLogs.unshift({
      id,
      operationId,
      operationType,
      userId,
      deviceId: deviceId || undefined,
      status,
      entityId: entityId || undefined,
      result: responseJson || undefined,
      createdAt: now,
    });
    if (db.syncOperationLogs.length > 2000) {
      db.syncOperationLogs.length = 2000;
    }
  });
}

async function createConflictRecord({
  operationId,
  operationType,
  entityType,
  entityId = null,
  deviceId = null,
  actor,
  reason,
  localPayload,
  serverSnapshot,
}) {
  const now = nowIso();
  const id = generateServerId('SCF');
  const record = {
    id,
    operationId,
    operationType,
    entityType,
    entityId: entityId || undefined,
    deviceId: deviceId || undefined,
    userId: actor.id,
    userName: actor.fullName,
    conflictReason: reason,
    localPayload: localPayload || {},
    serverSnapshot: serverSnapshot || {},
    status: 'needs_review',
    resolutionNotes: '',
    createdAt: now,
  };

  if (await isPgMode()) {
    const pool = getPool();
    const existing = await pool.query(`SELECT * FROM sync_conflicts WHERE operation_id = $1 LIMIT 1`, [operationId]);
    if (existing.rows[0]) return mapPgConflictRow(existing.rows[0]);

    await pool.query(
      `INSERT INTO sync_conflicts (id, operation_id, operation_type, entity_type, entity_id, device_id, user_id, user_name, conflict_reason, local_payload, server_snapshot, status, resolution_notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'needs_review','',$12)`,
      [
        id,
        operationId,
        operationType,
        entityType,
        entityId,
        deviceId,
        actor.id,
        actor.fullName,
        reason,
        JSON.stringify(localPayload || {}),
        JSON.stringify(serverSnapshot || {}),
        now,
      ]
    );
    return record;
  }

  await withJsonTransaction((db) => {
    db.syncConflicts = db.syncConflicts || [];
    const existing = db.syncConflicts.find((c) => c.operationId === operationId);
    if (!existing) {
      db.syncConflicts.unshift(record);
    }
  });
  return record;
}

function getEntityTypeForOp(opType) {
  switch (opType) {
    case 'create_order':
    case 'update_order_delivery':
      return 'order';
    case 'record_order_advance':
      return 'order_advance';
    case 'create_sales_invoice':
    case 'edit_sales_invoice':
    case 'create_purchase_invoice':
      return 'invoice';
    case 'create_invoice_return':
      return 'invoice_return';
    case 'add_invoice_payment':
    case 'record_customer_payment':
      return 'payment';
    case 'execute_cash_operation':
      return 'cash_operation';
    case 'create_customer':
    case 'update_customer':
      return 'customer';
    default:
      return 'unknown';
  }
}

function assertOperationPermission(opType, freshAuth) {
  const u = freshAuth.user;
  if (!freshAuth.isActive) {
    throw new AppError(403, 'تم إيقاف هذا الحساب من الإدارة ولا يمكنه تنفيذ عمليات جديدة', 'ACCOUNT_DEACTIVATED');
  }
  const perms = u.permissions || {};
  const isAdmin = u.role === 'admin';
  const isRep = u.role === 'representative';
  const isCust = u.role === 'customer';

  switch (opType) {
    case 'create_order':
      if (isCust || isRep || isAdmin || perms.canManageSales || perms.canAdd) return;
      break;
    case 'create_sales_invoice':
      if (!isCust && (isAdmin || perms.canManageSales)) return;
      break;
    case 'edit_sales_invoice':
      if (!isCust && (isAdmin || (perms.canEdit && perms.canManageSales))) return;
      break;
    case 'create_purchase_invoice':
      if (!isCust && (isAdmin || perms.canManagePurchases)) return;
      break;
    case 'create_invoice_return':
      if (!isCust && (isAdmin || perms.canManageSales || perms.canManageReturns)) return;
      break;
    case 'add_invoice_payment':
      if (!isCust && (isAdmin || perms.canManageAccounts)) return;
      break;
    case 'record_customer_payment':
      if (!isCust && (isAdmin || perms.canManageAccounts)) return;
      break;
    case 'record_order_advance':
      if (!isCust && (isAdmin || isRep || perms.canManageAccounts || perms.canManageSales)) return;
      break;
    case 'update_order_delivery':
      if (!isCust && (isAdmin || isRep || perms.canManageSales)) return;
      break;
    case 'execute_cash_operation':
      if (!isCust && (isAdmin || perms.canManageCashboxes)) return;
      break;
    case 'create_customer':
      if (!isCust && (isAdmin || perms.canAdd)) return;
      break;
    case 'update_customer':
      if (!isCust && (isAdmin || perms.canEdit)) return;
      break;
    default:
      throw new AppError(400, `نوع العملية غير مدعوم للمزامنة (${opType})`, 'UNSUPPORTED_SYNC_OP');
  }
  throw new AppError(403, `تم سحب الصلاحية المطلوبة لتنفيذ (${opType}) مركزيًا`, 'PERMISSION_REVOKED');
}

function resolvePayloadAliases(payload, aliasMap) {
  const next = { ...(payload || {}) };
  if (next.customerId && aliasMap.has(next.customerId)) next.customerId = aliasMap.get(next.customerId);
  if (next.orderId && aliasMap.has(next.orderId)) next.orderId = aliasMap.get(next.orderId);
  if (next.invoiceId && aliasMap.has(next.invoiceId)) next.invoiceId = aliasMap.get(next.invoiceId);
  if (next.originalInvoiceId && aliasMap.has(next.originalInvoiceId)) next.originalInvoiceId = aliasMap.get(next.originalInvoiceId);
  return next;
}

async function buildConflictSnapshot(opType, payload, freshAuth) {
  try {
    if (opType === 'create_sales_invoice' || opType === 'edit_sales_invoice') {
      const products = await listProducts();
      const whId = payload.warehouseId;
      const relevantIds = new Set((payload.items || []).map((i) => i.productId));
      return {
        warehouseId: whId,
        stockSnapshot: products
          .filter((p) => relevantIds.has(p.id))
          .map((p) => ({
            id: p.id,
            name: p.name,
            stockInWarehouse: whId ? Number(p.stockPerWarehouse?.[whId] || 0) : p.stockPerWarehouse,
          })),
      };
    }
    if (opType === 'create_customer' || opType === 'update_customer') {
      const customers = await listCustomers();
      const normPhone = normalizePhoneDigits(payload.phone);
      const byId = payload.customerId ? customers.find((c) => c.id === payload.customerId) : null;
      const byPhone = normPhone ? customers.find((c) => normalizePhoneDigits(c.phone) === normPhone) : null;
      return { existingCustomer: byId || byPhone || null };
    }
    if (opType === 'update_order_delivery' || opType === 'record_order_advance') {
      if (payload.orderId) {
        const order = await getOrderById(payload.orderId, freshAuth);
        return { order };
      }
    }
    if (opType === 'add_invoice_payment' && payload.invoiceId) {
      const invs = await listInvoices(freshAuth.user);
      const inv = invs.find((i) => i.id === payload.invoiceId);
      return { invoice: inv || null };
    }
  } catch {
    // Best-effort snapshot
  }
  return {};
}

async function executeSingleSyncOperation(opType, rawPayload, operationId, deviceId, freshAuth, { ignoreVersionCheck = false } = {}) {
  const actor = freshAuth.user;
  const payload = { ...(rawPayload || {}), originDeviceId: rawPayload?.originDeviceId || deviceId || undefined };

  switch (opType) {
    case 'create_order': {
      const { order, deduplicated } = await createCustomerOrder(
        { ...payload, idempotencyKey: operationId },
        freshAuth
      );
      return { entityId: order.id, localAliasId: payload.localId, result: { order, deduplicated } };
    }

    case 'create_sales_invoice': {
      const invoice = await createSalesInvoice(payload, actor, operationId);
      return { entityId: invoice.id, localAliasId: payload.localId, result: { invoice } };
    }

    case 'edit_sales_invoice': {
      const targetId = payload.invoiceId || payload.id;
      if (!targetId) throw new AppError(400, 'معرف الفاتورة مطلوب للتعديل', 'INVOICE_ID_REQUIRED');
      if (!ignoreVersionCheck && payload.baseVersion !== undefined) {
        const allInvs = await listInvoices(actor);
        const current = allInvs.find((i) => i.id === targetId);
        if (current && Number(current.version || 1) > Number(payload.baseVersion)) {
          throw new AppError(
            409,
            `تم تعديل الفاتورة (${current.invoiceNumber}) على السيرفر إلى إصدار (${current.version}) بعد حفظ النسخة المحلية (${payload.baseVersion})`,
            'VERSION_CONFLICT',
            { serverInvoice: current }
          );
        }
      }
      const invoice = await editSalesInvoice(targetId, payload, actor);
      return { entityId: invoice.id, result: { invoice } };
    }

    case 'create_purchase_invoice': {
      const invoice = await createPurchaseInvoice(payload, actor, operationId);
      return { entityId: invoice.id, localAliasId: payload.localId, result: { invoice } };
    }

    case 'create_invoice_return': {
      const invoiceReturn = await createInvoiceReturn(payload, actor, operationId);
      return { entityId: invoiceReturn.id, localAliasId: payload.localId, result: { invoiceReturn } };
    }

    case 'add_invoice_payment': {
      const targetId = payload.invoiceId;
      if (!targetId) throw new AppError(400, 'معرف الفاتورة مطلوب لتسجيل الدفعة', 'INVOICE_ID_REQUIRED');
      const invoice = await addInvoicePayment(targetId, payload, actor, operationId);
      return { entityId: invoice.id, result: { invoice } };
    }

    case 'record_customer_payment': {
      if (!payload.customerId) throw new AppError(400, 'معرف العميل مطلوب للتحصيل', 'CUSTOMER_ID_REQUIRED');
      if (actor.role === 'representative') {
        const cust = await getCustomerById(payload.customerId);
        if (!cust || !freshAuth.representativeProfile || !isCustomerAllowedForRep(cust, freshAuth.representativeProfile.id)) {
          throw new AppError(403, 'غير مصرح لك بتحصيل مبالغ من عميل غير معين ضمن قائمتك', 'CUSTOMER_NOT_ASSIGNED_TO_REP');
        }
      }
      const paymentResult = await recordCustomerPayment(payload, actor, operationId);
      return { entityId: payload.customerId, result: paymentResult };
    }

    case 'record_order_advance': {
      if (!payload.orderId) throw new AppError(400, 'معرف الطلب مطلوب لتسجيل الدفعة المقدمة', 'ORDER_ID_REQUIRED');
      if (actor.role === 'representative') {
        const ord = await getOrderById(payload.orderId, freshAuth);
        if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      }
      const advOut = await recordOrderAdvancePayment(payload.orderId, payload, actor, operationId);
      return { entityId: payload.orderId, result: advOut };
    }

    case 'update_order_delivery': {
      if (!payload.orderId) throw new AppError(400, 'معرف الطلب مطلوب لتحديث التوصيل', 'ORDER_ID_REQUIRED');
      const deliveryOut = await updateOrderDeliveryStatus(
        payload.orderId,
        { ...payload, idempotencyKey: operationId },
        freshAuth
      );
      return { entityId: payload.orderId, result: deliveryOut };
    }

    case 'execute_cash_operation': {
      const cashOut = await executeCashOperation(payload, actor, operationId);
      return { entityId: cashOut.transaction?.id, result: cashOut };
    }

    case 'create_customer': {
      const existingList = await listCustomers();
      const normPhone = normalizePhoneDigits(payload.phone);
      const dupPhone = normPhone ? existingList.find((c) => normalizePhoneDigits(c.phone) === normPhone) : null;
      const dupCode = payload.code ? existingList.find((c) => c.code === String(payload.code).trim()) : null;
      if (dupPhone || dupCode) {
        const matched = dupPhone || dupCode;
        throw new AppError(
          409,
          `يوجد عميل مسجل مسبقًا بنفس ${dupPhone ? 'رقم الهاتف' : 'الكود'} (${matched.name} - ${matched.code}). يرجى المراجعة لتجنب التكرار.`,
          'DUPLICATE_CUSTOMER_CONFLICT',
          { existingCustomer: matched }
        );
      }
      const customer = await createCustomer(payload, actor);
      return { entityId: customer.id, localAliasId: payload.localId, result: { customer } };
    }

    case 'update_customer': {
      const targetId = payload.customerId || payload.id;
      if (!targetId) throw new AppError(400, 'معرف العميل مطلوب للتحديث', 'CUSTOMER_ID_REQUIRED');
      const current = await getCustomerById(targetId);
      if (!current) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      if (!ignoreVersionCheck && payload.baseVersion !== undefined && Number(current.version || 1) > Number(payload.baseVersion)) {
        throw new AppError(
          409,
          `تم تعديل بيانات العميل (${current.name}) على السيرفر إلى إصدار (${current.version}) بعد حفظ نسختك (${payload.baseVersion})`,
          'VERSION_CONFLICT',
          { existingCustomer: current }
        );
      }
      const customer = await updateCustomer(targetId, payload, actor);
      return { entityId: customer.id, result: { customer } };
    }

    default:
      throw new AppError(400, `نوع العملية غير مدعوم (${opType})`, 'UNSUPPORTED_SYNC_OP');
  }
}

export async function pushSyncBatch({ operations = [], deviceId = '' } = {}, authContext) {
  if (!Array.isArray(operations)) {
    throw new AppError(400, 'قائمة العمليات المطلوب مزامنتها يجب أن تكون مصفوفة', 'INVALID_SYNC_BATCH');
  }

  const results = [];
  const conflicts = [];
  const idAliasMap = new Map();
  let stoppedDueToAuthRevoke = false;

  for (const op of operations) {
    const operationId = String(op?.operationId || '').trim();
    const operationType = String(op?.operationType || '').trim();
    if (!operationId || !operationType) {
      results.push({
        operationId: operationId || 'missing',
        operationType: operationType || 'unknown',
        status: 'failed',
        error: 'معرف العملية ونوعها مطلوبان',
        code: 'INVALID_OPERATION',
      });
      continue;
    }

    // Load fresh DB permissions/status before EVERY operation
    const freshAuth = await loadFreshUserAuthState(authContext.user.id);
    if (!freshAuth || !freshAuth.isActive) {
      stoppedDueToAuthRevoke = true;
      const reason = !freshAuth ? 'الحساب غير موجود' : 'تم إيقاف الحساب من الإدارة';
      const conflict = await createConflictRecord({
        operationId,
        operationType,
        entityType: getEntityTypeForOp(operationType),
        entityId: op?.payload?.orderId || op?.payload?.invoiceId || op?.payload?.customerId || null,
        deviceId: deviceId || authContext.deviceId,
        actor: authContext.user,
        reason,
        localPayload: op?.payload || {},
        serverSnapshot: { accountActive: false },
      });
      conflicts.push(conflict);
      results.push({
        operationId,
        operationType,
        status: 'needs_review',
        error: reason,
        code: 'ACCOUNT_DEACTIVATED',
        conflict,
      });
      continue;
    }

    // Check deduplication log
    const existingLog = await findLoggedOperation(freshAuth.user.id, operationId);
    if (existingLog) {
      if (op?.payload?.localId && existingLog.entityId) {
        idAliasMap.set(op.payload.localId, existingLog.entityId);
      }
      results.push({
        operationId,
        operationType,
        status: existingLog.status,
        entityId: existingLog.entityId,
        result: existingLog.result,
        deduplicated: true,
      });
      continue;
    }

    const resolvedPayload = resolvePayloadAliases(op.payload || {}, idAliasMap);

    try {
      assertOperationPermission(operationType, freshAuth);
      const execOut = await executeSingleSyncOperation(
        operationType,
        resolvedPayload,
        operationId,
        deviceId || authContext.deviceId,
        freshAuth
      );
      if (execOut.localAliasId && execOut.entityId) {
        idAliasMap.set(execOut.localAliasId, execOut.entityId);
      }
      await saveLoggedOperation({
        operationId,
        operationType,
        userId: freshAuth.user.id,
        deviceId: deviceId || authContext.deviceId,
        status: 'synced',
        entityId: execOut.entityId,
        responseJson: execOut.result,
      });
      results.push({
        operationId,
        operationType,
        status: 'synced',
        entityId: execOut.entityId,
        result: execOut.result,
        deduplicated: false,
      });
    } catch (err) {
      const code = err?.code || 'SYNC_EXECUTION_ERROR';
      const isConflictCode =
        err?.status === 409 ||
        err?.status === 403 ||
        [
          'INSUFFICIENT_STOCK',
          'INSUFFICIENT_CASHBOX',
          'VERSION_CONFLICT',
          'DUPLICATE_CUSTOMER_CONFLICT',
          'EXCEEDS_REMAINING',
          'EXCEEDS_ORDER_TOTAL',
          'EXCEEDS_RETURNABLE',
          'ORDER_ALREADY_INVOICED',
          'INVALID_ORDER_TRANSITION',
          'PERMISSION_REVOKED',
          'ACCOUNT_DEACTIVATED',
          'CUSTOMER_BLOCKED',
          'CUSTOMER_NOT_ASSIGNED_TO_REP',
          'PRODUCT_UNAVAILABLE',
        ].includes(code);

      if (isConflictCode) {
        const snapshot = err?.details || (await buildConflictSnapshot(operationType, resolvedPayload, freshAuth));
        const conflict = await createConflictRecord({
          operationId,
          operationType,
          entityType: getEntityTypeForOp(operationType),
          entityId: resolvedPayload.orderId || resolvedPayload.invoiceId || resolvedPayload.customerId || null,
          deviceId: deviceId || authContext.deviceId,
          actor: freshAuth.user,
          reason: err.message,
          localPayload: resolvedPayload,
          serverSnapshot: snapshot,
        });
        await saveLoggedOperation({
          operationId,
          operationType,
          userId: freshAuth.user.id,
          deviceId: deviceId || authContext.deviceId,
          status: 'needs_review',
          entityId: conflict.id,
          responseJson: { conflict },
        });
        conflicts.push(conflict);
        results.push({
          operationId,
          operationType,
          status: 'needs_review',
          code,
          error: err.message,
          conflict,
        });
      } else {
        results.push({
          operationId,
          operationType,
          status: 'failed',
          code,
          error: err.message || 'فشل تنفيذ العملية أثناء المزامنة',
        });
      }
    }
  }

  return {
    serverTime: nowIso(),
    stoppedDueToAuthRevoke,
    results,
    conflicts,
  };
}

export async function resolveSyncConflict(conflictId, { action, resolutionNotes = '' } = {}, actor) {
  if (!['keep_server', 'dismiss', 'apply_local'].includes(action)) {
    throw new AppError(400, 'إجراء معالجة التعارض غير صالح', 'INVALID_CONFLICT_ACTION');
  }

  let conflict = null;
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM sync_conflicts WHERE id = $1 LIMIT 1`, [conflictId]);
    if (!res.rows[0]) throw new AppError(404, 'سجل التعارض غير موجود', 'CONFLICT_NOT_FOUND');
    conflict = mapPgConflictRow(res.rows[0]);
  } else {
    const db = readJsonDatabase();
    conflict = (db.syncConflicts || []).find((c) => c.id === conflictId) || null;
    if (!conflict) throw new AppError(404, 'سجل التعارض غير موجود', 'CONFLICT_NOT_FOUND');
  }

  if (conflict.status !== 'needs_review') {
    throw new AppError(409, 'تمت معالجة هذا التعارض مسبقًا', 'CONFLICT_ALREADY_RESOLVED');
  }

  let appliedResult = null;
  if (action === 'apply_local') {
    const managerAuth = {
      user: actor,
      customerProfile: null,
      representativeProfile: actor.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null,
    };
    const execOut = await executeSingleSyncOperation(
      conflict.operationType,
      conflict.localPayload || {},
      `${conflict.operationId}-RES`,
      conflict.deviceId || '',
      managerAuth,
      { ignoreVersionCheck: true }
    );
    appliedResult = execOut.result;
  }

  const nextStatus =
    action === 'keep_server'
      ? 'resolved_keep_server'
      : action === 'apply_local'
      ? 'resolved_apply_local'
      : 'dismissed';
  const now = nowIso();
  const cleanNotes = String(resolutionNotes || '').trim();

  if (await isPgMode()) {
    const pool = getPool();
    await pool.query(
      `UPDATE sync_conflicts SET status = $1, resolution_notes = $2, resolved_by = $3, resolved_at = $4 WHERE id = $5`,
      [nextStatus, cleanNotes, actor.fullName, now, conflictId]
    );
    const updatedRes = await pool.query(`SELECT * FROM sync_conflicts WHERE id = $1`, [conflictId]);
    conflict = mapPgConflictRow(updatedRes.rows[0]);
  } else {
    conflict = await withJsonTransaction((db) => {
      const target = (db.syncConflicts || []).find((c) => c.id === conflictId);
      if (!target) throw new AppError(404, 'سجل التعارض غير موجود', 'CONFLICT_NOT_FOUND');
      target.status = nextStatus;
      target.resolutionNotes = cleanNotes;
      target.resolvedBy = actor.fullName;
      target.resolvedAt = now;
      return target;
    });
  }

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `معالجة تعارض مزامنة (${conflict.operationType}) - ${nextStatus}`,
    module: 'المزامنة',
    recordId: conflictId,
    notes: cleanNotes || conflict.conflictReason,
  });

  return { conflict, appliedResult };
}

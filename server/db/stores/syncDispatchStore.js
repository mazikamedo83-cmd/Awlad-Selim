import { getPool, withTransaction, isPgConnectionError } from '../postgres.js';
import { readJsonDatabase, withJsonTransaction, nextJsonSequence } from '../jsonLedger.js';
import { isPgMode, isStrictPostgresMode, markPgUnavailable, createDatabaseUnavailableError, isoTimestamp, mapPgUserRow } from './mode.js';
import { generateServerId } from '../../utils/crypto.js';
import { AppError, nowIso, round2, sanitizeSyncPayload } from '../../utils/errors.js';
import { recordAuditLog } from './authStore.js';
import { getRepresentativeByUserId } from './catalogStore.js';

export const DISPATCH_BATCH_STATUSES = [
  'محفوظة محليًا',
  'جاهزة للإرسال',
  'جاري الإرسال',
  'تم الإرسال',
  'في انتظار الاستلام',
  'جاري الاستلام',
  'تم الاستلام',
  'فشل الإرسال',
  'تعذر الاستلام',
];

function formatDispatchNumber(seq) {
  const year = new Date().getFullYear();
  return `DSP-${year}-${String(seq).padStart(4, '0')}`;
}

async function allocateDispatchBatchNumber() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(`SELECT nextval('seq_sync_dispatch_no') AS seq`);
    const seq = Number(res.rows[0]?.seq || 1);
    return formatDispatchNumber(seq);
  }
  return withJsonTransaction((db) => {
    const seq = nextJsonSequence(
      db,
      'syncDispatchNo',
      db.syncDispatchBatches || [],
      'batchNumber',
      /^DSP-\d{4}-(\d+)$/
    );
    return formatDispatchNumber(seq);
  });
}

function mapPgBatchRow(r, viewer = null) {
  if (!r) return null;
  const redactCosts = viewer?.role === 'representative';
  const snapshot = Array.isArray(r.operations_snapshot) ? r.operations_snapshot : [];
  const docSummary = Array.isArray(r.doc_summary) ? r.doc_summary : [];
  return {
    id: r.id,
    batchNumber: r.batch_number,
    clientBatchUuid: r.client_batch_uuid,
    idempotencyKey: r.idempotency_key,
    deviceId: r.device_id || undefined,
    senderUserId: r.sender_user_id,
    senderName: r.sender_name,
    representativeId: r.representative_id || undefined,
    representativeName: r.representative_name || '',
    recipientUserId: r.recipient_user_id,
    recipientName: r.recipient_name,
    recipientRole: r.recipient_role || '',
    sendStatus: r.send_status,
    receiptStatus: r.receipt_status,
    salesCount: Number(r.sales_count || 0),
    purchasesCount: Number(r.purchases_count || 0),
    returnsCount: Number(r.returns_count || 0),
    collectionsCount: Number(r.collections_count || 0),
    ordersCount: Number(r.orders_count || 0),
    customersCount: Number(r.customers_count || 0),
    custodyOpsCount: Number(r.custody_ops_count || 0),
    totalSalesAmount: round2(r.total_sales_amount || 0),
    totalCashAmount: round2(r.total_cash_amount || 0),
    operationIds: Array.isArray(r.operation_ids) ? r.operation_ids : [],
    operationsSnapshot: snapshot.map((op) => ({
      ...op,
      payload: sanitizeSyncPayload(op?.payload || {}, { redactCosts }),
    })),
    docSummary: docSummary.map((d) => ({
      ...d,
      ...(redactCosts && d.operationType?.includes('purchase') ? { amount: 0, paidAmount: 0 } : {}),
    })),
    notes: r.notes || '',
    receiptNotes: r.receipt_notes || '',
    errorMessage: r.error_message || '',
    sentAt: r.sent_at ? isoTimestamp(r.sent_at) : undefined,
    receivedByUserId: r.received_by_user_id || undefined,
    receivedByName: r.received_by_name || '',
    receivedAt: r.received_at ? isoTimestamp(r.received_at) : undefined,
    createdAt: isoTimestamp(r.created_at),
    updatedAt: isoTimestamp(r.updated_at),
  };
}

function sanitizeJsonBatchForViewer(batch, viewer = null) {
  if (!batch) return null;
  const redactCosts = viewer?.role === 'representative';
  return {
    ...batch,
    operationsSnapshot: (batch.operationsSnapshot || []).map((op) => ({
      ...op,
      payload: sanitizeSyncPayload(op?.payload || {}, { redactCosts }),
    })),
    docSummary: (batch.docSummary || []).map((d) => ({
      ...d,
      ...(redactCosts && d.operationType?.includes('purchase') ? { amount: 0, paidAmount: 0 } : {}),
    })),
  };
}

export function canUserViewDispatchBatch(batch, user, repProfile = null) {
  if (!batch || !user) return false;
  if (user.role === 'customer') return false;
  if (user.role === 'representative') {
    if (batch.senderUserId === user.id) return true;
    if (repProfile && batch.representativeId === repProfile.id) return true;
    return false;
  }
  const p = user.permissions || {};
  if (
    user.role === 'admin' ||
    user.role === 'manager' ||
    p.canApprove ||
    p.canReceive ||
    p.canManageReps ||
    p.canManageTransfers ||
    p.canManageSales ||
    p.canManageAccounts
  ) {
    return true;
  }
  return batch.recipientUserId === user.id || batch.senderUserId === user.id;
}

export function canUserConfirmDispatchBatch(batch, user) {
  if (!batch || !user) return false;
  if (user.role === 'customer' || user.role === 'representative') return false;
  if (batch.senderUserId === user.id) return false; // لا يجوز لنفس المرسل استلام دفعته
  if (user.role === 'admin' || user.role === 'manager') return true;
  if (batch.recipientUserId === user.id) return true;
  const p = user.permissions || {};
  return Boolean(p.canApprove || p.canReceive || p.canManageReps || p.canManageTransfers);
}

export async function listDispatchRecipients(actor) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بالوصول لقائمة مستلمي المزامنة', 'FORBIDDEN');
  }
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, full_name, role, job_title, is_active, permissions
       FROM users
       WHERE is_active = TRUE AND role NOT IN ('customer', 'representative')
       ORDER BY full_name ASC`
    );
    return res.rows.map(mapPgUserRow).map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
      jobTitle: u.jobTitle || '',
    }));
  }
  const db = readJsonDatabase();
  return (db.users || [])
    .filter((u) => u && u.isActive !== false && u.role !== 'customer' && u.role !== 'representative')
    .sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'ar'))
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
      jobTitle: u.jobTitle || '',
    }));
}

async function resolveDispatchRecipientUser(recipientUserId) {
  const cleanId = String(recipientUserId || '').trim();
  if (!cleanId) return null;
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, full_name, role, job_title, is_active, permissions FROM users WHERE id = $1 LIMIT 1`,
      [cleanId]
    );
    return res.rows[0] ? mapPgUserRow(res.rows[0]) : null;
  }
  const db = readJsonDatabase();
  return (db.users || []).find((u) => u.id === cleanId) || null;
}

export function resolveChainedLocalIdsInOp(op, localIdMap) {
  if (!op || !op.payload || typeof op.payload !== 'object' || !(localIdMap instanceof Map) || localIdMap.size === 0) {
    return op;
  }
  const p = { ...op.payload };
  const mapVal = (val) => {
    const key = String(val || '').trim();
    return key && localIdMap.has(key) ? localIdMap.get(key) : val;
  };
  if (p.customerId) p.customerId = mapVal(p.customerId);
  if (p.partyId) p.partyId = mapVal(p.partyId);
  if (p.supplierId) p.supplierId = mapVal(p.supplierId);
  if (p.invoiceId) p.invoiceId = mapVal(p.invoiceId);
  if (p.originalInvoiceId) p.originalInvoiceId = mapVal(p.originalInvoiceId);
  if (p.orderId) p.orderId = mapVal(p.orderId);
  if (p.linkedCustomerOrderId) p.linkedCustomerOrderId = mapVal(p.linkedCustomerOrderId);
  const resolvedEntityId = op.entityId ? mapVal(op.entityId) : op.entityId;
  return {
    ...op,
    entityId: resolvedEntityId,
    payload: p,
  };
}

export function registerCreatedLocalIdMapping(op, result, localIdMap) {
  if (!(localIdMap instanceof Map) || !op || !result) return;
  const createdId =
    result?.id ||
    result?.customer?.id ||
    result?.supplier?.id ||
    result?.invoice?.id ||
    result?.order?.id ||
    result?.returnDoc?.id;
  if (!createdId) return;
  const candidates = [
    op.localId,
    op.entityId,
    op.payload?.localId,
    op.payload?.id,
  ];
  for (const rawKey of candidates) {
    const k = String(rawKey || '').trim();
    if (k && k !== createdId) {
      localIdMap.set(k, createdId);
    }
  }
}

export async function listDispatchBatches(actor, filters = {}) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بالوصول لدفعات الاستلام والإرسال', 'FORBIDDEN');
  }
  const repProfile = actor.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  let rows = [];
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM sync_dispatch_batches ORDER BY created_at DESC LIMIT 400`);
    rows = res.rows.map((r) => mapPgBatchRow(r, actor));
  } else {
    const db = readJsonDatabase();
    rows = [...(db.syncDispatchBatches || [])]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map((b) => sanitizeJsonBatchForViewer(b, actor));
  }

  return rows.filter((b) => {
    if (!canUserViewDispatchBatch(b, actor, repProfile)) return false;
    if (filters.receiptStatus && b.receiptStatus !== filters.receiptStatus) return false;
    if (filters.sendStatus && b.sendStatus !== filters.sendStatus) return false;
    if (filters.senderUserId && b.senderUserId !== filters.senderUserId) return false;
    if (filters.recipientUserId && b.recipientUserId !== filters.recipientUserId) return false;
    if (filters.search) {
      const q = String(filters.search).trim().toLowerCase();
      const hit =
        String(b.batchNumber || '').toLowerCase().includes(q) ||
        String(b.senderName || '').toLowerCase().includes(q) ||
        String(b.recipientName || '').toLowerCase().includes(q) ||
        String(b.representativeName || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });
}

async function getRawDispatchBatchById(batchId, actor = null) {
  if (!batchId) return null;
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM sync_dispatch_batches WHERE id = $1 LIMIT 1`, [batchId]);
    return res.rows[0] ? mapPgBatchRow(res.rows[0], actor) : null;
  }
  const db = readJsonDatabase();
  const found = (db.syncDispatchBatches || []).find((b) => b.id === batchId) || null;
  return found ? sanitizeJsonBatchForViewer(found, actor) : null;
}

async function findBatchByIdempotency(clientBatchUuid, idempotencyKey, actor = null) {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM sync_dispatch_batches WHERE client_batch_uuid = $1 OR idempotency_key = $2 LIMIT 1`,
      [clientBatchUuid || '__none__', idempotencyKey || '__none__']
    );
    return res.rows[0] ? mapPgBatchRow(res.rows[0], actor) : null;
  }
  const db = readJsonDatabase();
  const found = (db.syncDispatchBatches || []).find(
    (b) =>
      (clientBatchUuid && b.clientBatchUuid === clientBatchUuid) ||
      (idempotencyKey && b.idempotencyKey === idempotencyKey)
  );
  return found ? sanitizeJsonBatchForViewer(found, actor) : null;
}

export async function getDispatchBatchDetails(batchId, actor) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بالوصول لدفعات الاستلام والإرسال', 'FORBIDDEN');
  }
  const batch = await getRawDispatchBatchById(batchId, actor);
  if (!batch) {
    throw new AppError(404, 'دفعة الإرسال غير موجودة', 'DISPATCH_BATCH_NOT_FOUND');
  }
  const repProfile = actor.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (!canUserViewDispatchBatch(batch, actor, repProfile)) {
    throw new AppError(403, 'ليس لديك صلاحية الاطلاع على دفعة الإرسال المحددة', 'FORBIDDEN_DISPATCH_ACCESS');
  }

  let auditTrail = [];
  if (await isPgMode()) {
    const pool = getPool();
    const aRes = await pool.query(
      `SELECT id, timestamp, user_id, user_name, action, module, record_id, notes
       FROM audit_logs WHERE record_id = $1 ORDER BY timestamp ASC LIMIT 50`,
      [batch.id]
    );
    auditTrail = aRes.rows.map((r) => ({
      id: r.id,
      timestamp: isoTimestamp(r.timestamp),
      userId: r.user_id || undefined,
      userName: r.user_name || '',
      action: r.action,
      module: r.module,
      recordId: r.record_id || undefined,
      details: r.notes || '',
    }));
  }

  return { batch, auditTrail };
}

function summarizeOperationOutcome(op, result, deduplicated = false) {
  const p = op.payload || {};
  let docNumber =
    result?.invoiceNumber ||
    result?.returnNumber ||
    result?.transactionNumber ||
    result?.requestNumber ||
    result?.operationNumber ||
    result?.order?.requestNumber ||
    result?.invoice?.invoiceNumber ||
    p.invoiceNumber ||
    p.returnNumber ||
    p.localId ||
    op.localId ||
    undefined;

  let customerName =
    result?.customerName ||
    result?.partyName ||
    result?.name ||
    result?.customer?.name ||
    p.customerName ||
    p.partyName ||
    p.supplierName ||
    p.name ||
    undefined;

  let amount = 0;
  let paidAmount = 0;
  if (op.operationType === 'create_sales_invoice' || op.operationType === 'create_purchase_invoice') {
    amount = round2(result?.grandTotal ?? p.grandTotal ?? 0);
    paidAmount = round2(result?.paidAmount ?? p.paidAmount ?? 0);
  } else if (op.operationType === 'record_customer_payment' || op.operationType === 'add_invoice_payment' || op.operationType === 'record_order_advance') {
    amount = round2(result?.amount ?? p.amount ?? 0);
    paidAmount = amount;
  } else if (op.operationType?.includes('return')) {
    amount = round2(result?.grandTotal ?? p.grandTotal ?? 0);
  }

  return {
    operationId: op.operationId,
    operationType: op.operationType,
    entityType: op.entityType || 'unknown',
    entityId: op.entityId || result?.id || result?.invoice?.id || result?.order?.id || undefined,
    docNumber,
    customerName,
    amount,
    paidAmount,
    summaryAr: op.summaryAr || op.operationType,
    deduplicated: Boolean(deduplicated),
    status: 'synced',
    createdAt: op.createdAt || nowIso(),
  };
}

export async function createAndSendDispatchBatch(body, authContext, deps) {
  const user = authContext.user;
  if (!user || user.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بإنشاء دفعات إرسال المزامنة', 'FORBIDDEN');
  }
  const clientBatchUuid = String(body?.clientBatchUuid || body?.batchUuid || generateServerId('CBU')).trim();
  const idempotencyKey = String(body?.idempotencyKey || clientBatchUuid).trim();
  const recipientUserId = String(body?.recipientUserId || '').trim();
  const notes = String(body?.notes || '').trim();
  const deviceId = String(body?.deviceId || authContext.deviceId || '').trim();
  const rawOps = Array.isArray(body?.operations) ? body.operations.slice(0, 300) : [];

  if (!recipientUserId) {
    throw new AppError(400, 'يجب تحديد الموظف المستلم في الإدارة قبل إرسال الدفعة', 'DISPATCH_RECIPIENT_REQUIRED');
  }
  if (rawOps.length === 0) {
    throw new AppError(400, 'لا توجد عمليات محددة داخل دفعة الإرسال', 'EMPTY_DISPATCH_BATCH');
  }

  const existing = await findBatchByIdempotency(clientBatchUuid, idempotencyKey, user);
  if (existing) {
    return {
      deduplicated: true,
      batch: existing,
      opResults: existing.operationIds.map((opId) => ({
        operationId: opId,
        status: 'synced',
        deduplicated: true,
      })),
    };
  }

  const recipientUser = await resolveDispatchRecipientUser(recipientUserId);
  if (!recipientUser || recipientUser.isActive === false) {
    throw new AppError(404, 'حساب الموظف المستلم المحدد غير موجود أو معطل', 'DISPATCH_RECIPIENT_NOT_FOUND');
  }
  if (recipientUser.role === 'customer' || recipientUser.role === 'representative') {
    throw new AppError(400, 'يجب اختيار موظف أو مسؤول إدارة لاستلام الدفعة وليس عميلًا أو مندوبًا', 'INVALID_DISPATCH_RECIPIENT');
  }
  if (recipientUser.id === user.id) {
    throw new AppError(403, 'لا يجوز إرسال دفعة المزامنة واستلامها لنفس المستخدم', 'SELF_DISPATCH_FORBIDDEN');
  }

  const repProfile = authContext.representativeProfile || (user.role === 'representative' ? await getRepresentativeByUserId(user.id) : null);

  // Execute underlying operations idempotently with FIFO local-to-server ID mapping
  const localIdMap = new Map();
  const opResults = [];
  const succeededOps = [];
  const docSummary = [];

  for (const rawOp of rawOps) {
    if (!rawOp || typeof rawOp !== 'object' || !rawOp.operationId || !rawOp.operationType) {
      opResults.push({
        operationId: rawOp?.operationId || 'unknown',
        status: 'failed',
        error: 'بيانات العملية غير مكتملة داخل الدفعة',
      });
      continue;
    }
    const op = resolveChainedLocalIdsInOp(rawOp, localIdMap);
    const prevLog = await deps.findSyncOpDeduplication(user.id, op.operationId);
    if (prevLog && (prevLog.status === 'synced' || prevLog.status === 'deduplicated')) {
      const prevRes = prevLog.response_json || prevLog.responseJson || {};
      registerCreatedLocalIdMapping(op, prevRes, localIdMap);
      succeededOps.push(op);
      docSummary.push(summarizeOperationOutcome(op, prevRes, true));
      opResults.push({
        operationId: op.operationId,
        status: 'synced',
        deduplicated: true,
        result: prevRes,
      });
      continue;
    }

    try {
      const result = await deps.applySingleOperation(op, authContext);
      registerCreatedLocalIdMapping(op, result, localIdMap);
      await deps.recordSyncOpLog({
        operationId: op.operationId,
        userId: user.id,
        deviceId: op.deviceId || deviceId || null,
        operationType: op.operationType,
        entityType: op.entityType || 'unknown',
        entityId: op.entityId || result?.id || result?.order?.id || result?.invoice?.id,
        status: 'synced',
        responseJson: result || {},
      });
      succeededOps.push(op);
      docSummary.push(summarizeOperationOutcome(op, result, false));
      opResults.push({
        operationId: op.operationId,
        status: 'synced',
        deduplicated: false,
        result,
      });
    } catch (err) {
      if (isStrictPostgresMode() && (isPgConnectionError(err) || err?.code === 'DATABASE_UNAVAILABLE')) {
        markPgUnavailable('dispatch_batch_op_connection_error');
        throw createDatabaseUnavailableError('dispatch_batch_op_connection_error');
      }
      if (deps.isConflictError(err)) {
        const conflict = await deps.createConflictRecord({
          op,
          user,
          conflictReason: err.message,
          serverSnapshot: err.details?.serverSnapshot || {},
        });
        opResults.push({
          operationId: op.operationId,
          status: 'needs_review',
          conflictId: conflict.id,
          conflict,
          error: err.message,
        });
      } else {
        opResults.push({
          operationId: op.operationId,
          status: 'failed',
          code: err?.code || 'DISPATCH_OP_FAILED',
          error: err?.message || 'تعذر تنفيذ العملية على السيرفر',
        });
      }
    }
  }

  if (succeededOps.length === 0) {
    const firstErr = opResults.find((r) => r.error)?.error || 'تعذر تسجيل أي عملية من الدفعة المحددة على السيرفر';
    throw new AppError(400, firstErr, 'DISPATCH_BATCH_ALL_FAILED', { opResults });
  }

  let salesCount = 0;
  let purchasesCount = 0;
  let returnsCount = 0;
  let collectionsCount = 0;
  let ordersCount = 0;
  let customersCount = 0;
  let custodyOpsCount = 0;
  let totalSalesAmount = 0;
  let totalCashAmount = 0;

  for (const item of docSummary) {
    const t = item.operationType;
    if (t === 'create_sales_invoice') {
      salesCount++;
      totalSalesAmount = round2(totalSalesAmount + Number(item.amount || 0));
      totalCashAmount = round2(totalCashAmount + Number(item.paidAmount || 0));
    } else if (t === 'create_purchase_invoice' || t === 'send_purchase_invoice') {
      purchasesCount++;
    } else if (t === 'record_customer_payment' || t === 'add_invoice_payment' || t === 'record_order_advance') {
      collectionsCount++;
      totalCashAmount = round2(totalCashAmount + Number(item.amount || 0));
    } else if (t === 'create_invoice_return' || t === 'create_sales_return_request' || t === 'create_purchase_return_request' || t === 'create_purchase_return') {
      returnsCount++;
    } else if (t === 'create_order') {
      ordersCount++;
    } else if (t === 'create_customer' || t === 'update_customer') {
      customersCount++;
    } else if (t === 'record_custody_delivery' || t === 'record_custody_return' || t === 'confirm_custody_receipt') {
      custodyOpsCount++;
    }
  }

  const batchId = generateServerId('DSP');
  const batchNumber = await allocateDispatchBatchNumber();
  const now = nowIso();
  const operationIds = succeededOps.map((o) => o.operationId);
  const storedSnapshot = succeededOps.map((o) => ({
    ...o,
    status: 'synced',
    dispatchBatchId: batchId,
    dispatchStage: 'تم الإرسال',
  }));

  const batchRecord = {
    id: batchId,
    batchNumber,
    clientBatchUuid,
    idempotencyKey,
    deviceId: deviceId || undefined,
    senderUserId: user.id,
    senderName: user.fullName || user.username,
    representativeId: repProfile?.id || undefined,
    representativeName: repProfile?.name || '',
    recipientUserId: recipientUser.id,
    recipientName: recipientUser.fullName,
    recipientRole: recipientUser.role,
    sendStatus: 'تم الإرسال',
    receiptStatus: 'في انتظار الاستلام',
    salesCount,
    purchasesCount,
    returnsCount,
    collectionsCount,
    ordersCount,
    customersCount,
    custodyOpsCount,
    totalSalesAmount,
    totalCashAmount,
    operationIds,
    operationsSnapshot: storedSnapshot,
    docSummary,
    notes,
    receiptNotes: '',
    errorMessage: '',
    sentAt: now,
    receivedByUserId: undefined,
    receivedByName: '',
    receivedAt: undefined,
    createdAt: now,
    updatedAt: now,
  };

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO sync_dispatch_batches (
          id, batch_number, client_batch_uuid, idempotency_key, device_id,
          sender_user_id, sender_name, representative_id, representative_name,
          recipient_user_id, recipient_name, recipient_role,
          send_status, receipt_status,
          sales_count, purchases_count, returns_count, collections_count, orders_count, customers_count, custody_ops_count,
          total_sales_amount, total_cash_amount,
          operation_ids, operations_snapshot, doc_summary,
          notes, receipt_notes, error_message, sent_at, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
        )`,
        [
          batchRecord.id,
          batchRecord.batchNumber,
          batchRecord.clientBatchUuid,
          batchRecord.idempotencyKey,
          batchRecord.deviceId || null,
          batchRecord.senderUserId,
          batchRecord.senderName,
          batchRecord.representativeId || null,
          batchRecord.representativeName,
          batchRecord.recipientUserId,
          batchRecord.recipientName,
          batchRecord.recipientRole,
          batchRecord.sendStatus,
          batchRecord.receiptStatus,
          salesCount,
          purchasesCount,
          returnsCount,
          collectionsCount,
          ordersCount,
          customersCount,
          custodyOpsCount,
          totalSalesAmount,
          totalCashAmount,
          JSON.stringify(operationIds),
          JSON.stringify(storedSnapshot),
          JSON.stringify(docSummary),
          notes,
          '',
          '',
          now,
          now,
          now,
        ]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      if (!Array.isArray(db.syncDispatchBatches)) db.syncDispatchBatches = [];
      db.syncDispatchBatches.unshift(batchRecord);
    });
  }

  await recordAuditLog({
    userId: user.id,
    userName: user.fullName || user.username,
    action: `إرسال دفعة مزامنة المندوب رقم ${batchNumber} إلى ${recipientUser.fullName} (${succeededOps.length} عملية)`,
    module: 'إرسال واستلام المندوبين',
    recordId: batchId,
    notes: notes || `فواتير: ${salesCount} · تحصيلات: ${collectionsCount} · مرتجعات: ${returnsCount}`,
  });

  const safeBatch = (await getRawDispatchBatchById(batchId, user)) || batchRecord;
  return {
    deduplicated: false,
    batch: safeBatch,
    opResults,
  };
}

export async function markDispatchBatchReceiving(batchId, actor) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح', 'FORBIDDEN');
  }
  const batch = await getRawDispatchBatchById(batchId, actor);
  if (!batch) throw new AppError(404, 'دفعة الإرسال غير موجودة', 'DISPATCH_BATCH_NOT_FOUND');
  if (!canUserConfirmDispatchBatch(batch, actor)) {
    throw new AppError(403, 'غير مصرح لك باستلام أو معاينة استلام هذه الدفعة', 'FORBIDDEN_DISPATCH_RECEIVE');
  }
  if (batch.receiptStatus === 'تم الاستلام') {
    return { batch, alreadyConfirmed: true };
  }
  const now = nowIso();
  if (await isPgMode()) {
    const pool = getPool();
    await pool.query(
      `UPDATE sync_dispatch_batches SET receipt_status = 'جاري الاستلام', updated_at = $1 WHERE id = $2 AND receipt_status <> 'تم الاستلام'`,
      [now, batchId]
    );
  } else {
    await withJsonTransaction((db) => {
      const target = (db.syncDispatchBatches || []).find((b) => b.id === batchId);
      if (target && target.receiptStatus !== 'تم الاستلام') {
        target.receiptStatus = 'جاري الاستلام';
        target.updatedAt = now;
      }
    });
  }
  return { batch: await getRawDispatchBatchById(batchId, actor), alreadyConfirmed: false };
}

export async function confirmDispatchBatchReceipt(batchId, body, actor) {
  if (!actor || actor.role === 'customer' || actor.role === 'representative') {
    throw new AppError(403, 'تأكيد استلام الدفعات متاح لموظفي الإدارة والمستلم المخول فقط', 'FORBIDDEN_DISPATCH_CONFIRM');
  }
  const batch = await getRawDispatchBatchById(batchId, actor);
  if (!batch) {
    throw new AppError(404, 'دفعة الإرسال غير موجودة', 'DISPATCH_BATCH_NOT_FOUND');
  }
  if (!canUserConfirmDispatchBatch(batch, actor)) {
    throw new AppError(403, 'ليس لديك صلاحية تأكيد استلام هذه الدفعة', 'FORBIDDEN_DISPATCH_CONFIRM');
  }
  if (batch.receiptStatus === 'تم الاستلام') {
    // Idempotent confirmation: zero duplicate execution or state mutation
    return { deduplicated: true, batch };
  }

  const receiptNotes = String(body?.receiptNotes || '').trim();
  const now = nowIso();

  // IMPORTANT: Confirmation updates ONLY the dispatch batch receipt status & audit log.
  // Accounting, customer balances, cashbox balances, custody, and stock were already
  // committed idempotently when the operations were accepted by the server!
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE sync_dispatch_batches
         SET receipt_status = 'تم الاستلام',
             received_by_user_id = $1,
             received_by_name = $2,
             received_at = $3,
             receipt_notes = CASE WHEN $4 <> '' THEN $4 ELSE receipt_notes END,
             error_message = '',
             updated_at = $5
         WHERE id = $6`,
        [actor.id, actor.fullName || actor.username, now, receiptNotes, now, batchId]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      const target = (db.syncDispatchBatches || []).find((b) => b.id === batchId);
      if (target) {
        target.receiptStatus = 'تم الاستلام';
        target.receivedByUserId = actor.id;
        target.receivedByName = actor.fullName || actor.username;
        target.receivedAt = now;
        if (receiptNotes) target.receiptNotes = receiptNotes;
        target.errorMessage = '';
        target.updatedAt = now;
      }
    });
  }

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName || actor.username,
    action: `استلام وتأكيد دفعة المندوب رقم ${batch.batchNumber} (${batch.senderName}) دون إعادة ترحيل`,
    module: 'إرسال واستلام المندوبين',
    recordId: batchId,
    notes: receiptNotes || `المستلم الفعلي: ${actor.fullName}`,
  });

  return {
    deduplicated: false,
    batch: await getRawDispatchBatchById(batchId, actor),
  };
}

export async function failDispatchBatchReceipt(batchId, body, actor) {
  if (!actor || actor.role === 'customer' || actor.role === 'representative') {
    throw new AppError(403, 'هذا الإجراء متاح لموظفي الإدارة فقط', 'FORBIDDEN_DISPATCH_FAIL');
  }
  const batch = await getRawDispatchBatchById(batchId, actor);
  if (!batch) {
    throw new AppError(404, 'دفعة الإرسال غير موجودة', 'DISPATCH_BATCH_NOT_FOUND');
  }
  if (!canUserConfirmDispatchBatch(batch, actor)) {
    throw new AppError(403, 'ليس لديك صلاحية تحديث حالة هذه الدفعة', 'FORBIDDEN_DISPATCH_FAIL');
  }
  if (batch.receiptStatus === 'تم الاستلام') {
    throw new AppError(409, 'تم تأكيد استلام الدفعة بالفعل ولا يمكن تحويلها إلى تعذر الاستلام', 'ALREADY_CONFIRMED');
  }

  const reason = String(body?.reason || body?.errorMessage || 'تعذر التحقق من الاستلام — يرجى المراجعة').trim();
  const now = nowIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE sync_dispatch_batches
         SET receipt_status = 'تعذر الاستلام',
             error_message = $1,
             updated_at = $2
         WHERE id = $3`,
        [reason, now, batchId]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      const target = (db.syncDispatchBatches || []).find((b) => b.id === batchId);
      if (target) {
        target.receiptStatus = 'تعذر الاستلام';
        target.errorMessage = reason;
        target.updatedAt = now;
      }
    });
  }

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName || actor.username,
    action: `تسجيل تعذر الاستلام للدفعة رقم ${batch.batchNumber}`,
    module: 'إرسال واستلام المندوبين',
    recordId: batchId,
    notes: reason,
  });

  return {
    batch: await getRawDispatchBatchById(batchId, actor),
  };
}

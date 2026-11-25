import { getPool, withTransaction } from '../postgres.js';
import {
  withJsonTransaction,
  readJsonDatabase,
  nextJsonSequence,
} from '../jsonLedger.js';
import { generateServerId } from '../../utils/crypto.js';
import { AppError, nowIso, todayIso, round3 } from '../../utils/errors.js';
import { isPgMode, isoDateOnly, isoTimestamp } from './mode.js';
import { recordAuditLog } from './authStore.js';
import { resolveActorIdentityPgTx, resolveActorIdentityJsonTx } from '../identityManager.js';

function mapPgTransferRequest(row, itemRows = []) {
  return {
    id: row.id,
    transferNumber: row.transfer_number,
    date: isoDateOnly(row.date),
    sourceWarehouseId: row.source_warehouse_id,
    sourceWarehouseName: row.source_warehouse_name,
    targetWarehouseId: row.target_warehouse_id,
    targetWarehouseName: row.target_warehouse_name,
    transferType: row.transfer_type || 'warehouse_transfer',
    status: row.status,
    reason: row.reason || '',
    notes: row.notes || '',
    rejectionReason: row.rejection_reason || undefined,
    createdByUserId: row.created_by_user_id || undefined,
    createdBy: row.created_by,
    submittedAt: row.submitted_at ? isoTimestamp(row.submitted_at) : undefined,
    approvedByUserId: row.approved_by_user_id || undefined,
    approvedBy: row.approved_by || undefined,
    approvedAt: row.approved_at ? isoTimestamp(row.approved_at) : undefined,
    executedByUserId: row.executed_by_user_id || undefined,
    executedBy: row.executed_by || undefined,
    executedAt: row.executed_at ? isoTimestamp(row.executed_at) : undefined,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    items: itemRows.map((it) => ({
      id: it.id,
      productId: it.product_id,
      productCode: it.product_code || '',
      productBarcode: it.product_barcode || '',
      productName: it.product_name,
      unit: it.unit,
      unitFactor: Number(it.unit_factor || 1),
      requestedQty: Number(it.requested_qty || 0),
      availableQtySnapshot: Number(it.available_qty_snapshot || 0),
      executedQty: it.executed_qty !== null && it.executed_qty !== undefined ? Number(it.executed_qty) : undefined,
      notes: it.notes || '',
    })),
  };
}

export async function listStockTransferRequests() {
  if (await isPgMode()) {
    const pool = getPool();
    const [tRes, itRes] = await Promise.all([
      pool.query('SELECT * FROM stock_transfer_requests ORDER BY created_at DESC LIMIT 500'),
      pool.query('SELECT * FROM stock_transfer_request_items'),
    ]);
    const itemsMap = new Map();
    for (const it of itRes.rows) {
      const list = itemsMap.get(it.transfer_id) || [];
      list.push(it);
      itemsMap.set(it.transfer_id, list);
    }
    return tRes.rows.map((r) => mapPgTransferRequest(r, itemsMap.get(r.id) || []));
  }
  const db = readJsonDatabase();
  return [...(db.stockTransferRequests || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createStockTransferRequest(payload, actor) {
  let sourceWarehouseId = String(payload.sourceWarehouseId || '').trim();
  let targetWarehouseId = String(payload.targetWarehouseId || '').trim();

  if (!sourceWarehouseId && payload.sourceRepId) {
    const { ensureRepVanWarehouse } = await import('./inventoryAdminStore.js');
    let repName = payload.sourceRepName || '';
    if (!repName) {
      if (await isPgMode()) {
        const r = await getPool().query('SELECT name, warehouse_id FROM representatives WHERE id = $1 LIMIT 1', [payload.sourceRepId]);
        if (r.rows[0]?.warehouse_id) sourceWarehouseId = r.rows[0].warehouse_id;
        repName = r.rows[0]?.name || '';
      } else {
        const rep = (readJsonDatabase().representatives || []).find((x) => x.id === payload.sourceRepId);
        if (rep?.warehouseId) sourceWarehouseId = rep.warehouseId;
        repName = rep?.name || '';
      }
    }
    if (!sourceWarehouseId && repName) {
      const wh = await ensureRepVanWarehouse(repName, actor, payload.sourceRepId);
      sourceWarehouseId = wh.id;
    }
  }

  if (!targetWarehouseId && payload.targetRepId) {
    const { ensureRepVanWarehouse } = await import('./inventoryAdminStore.js');
    let repName = payload.targetRepName || '';
    if (!repName) {
      if (await isPgMode()) {
        const r = await getPool().query('SELECT name, warehouse_id FROM representatives WHERE id = $1 LIMIT 1', [payload.targetRepId]);
        if (r.rows[0]?.warehouse_id) targetWarehouseId = r.rows[0].warehouse_id;
        repName = r.rows[0]?.name || '';
      } else {
        const rep = (readJsonDatabase().representatives || []).find((x) => x.id === payload.targetRepId);
        if (rep?.warehouseId) targetWarehouseId = rep.warehouseId;
        repName = rep?.name || '';
      }
    }
    if (!targetWarehouseId && repName) {
      const wh = await ensureRepVanWarehouse(repName, actor, payload.targetRepId);
      targetWarehouseId = wh.id;
    }
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  if (!sourceWarehouseId || !targetWarehouseId || sourceWarehouseId === targetWarehouseId) {
    throw new AppError(400, 'يجب اختيار مصدر ووجهة مختلفين للتحويل', 'INVALID_WAREHOUSES');
  }
  if (!rawItems.length) {
    throw new AppError(400, 'يجب إضافة صنف واحد على الأقل لطلب التحويل', 'EMPTY_ITEMS');
  }

  const dateStr = payload.date || todayIso();
  const reason = String(payload.reason || '').trim();
  const notes = String(payload.notes || '').trim();
  const transferType = String(
    payload.transferType || (payload.sourceRepId || payload.targetRepId ? 'rep_van_transfer' : 'warehouse_transfer')
  );
  const id = generateServerId('STR');
  const now = nowIso();

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      const srcWh = (await client.query('SELECT * FROM warehouses WHERE id = $1 LIMIT 1', [sourceWarehouseId])).rows[0];
      const dstWh = (await client.query('SELECT * FROM warehouses WHERE id = $1 LIMIT 1', [targetWarehouseId])).rows[0];
      if (!srcWh || !dstWh) throw new AppError(404, 'المستودع المصدر أو الوجهة غير موجود', 'WAREHOUSE_NOT_FOUND');

      const seqRes = await client.query(`SELECT nextval('seq_stock_transfer_no') AS n`);
      const transferNumber = `STR-${String(seqRes.rows[0].n).padStart(5, '0')}`;

      await client.query(
        `INSERT INTO stock_transfer_requests (id, transfer_number, date, source_warehouse_id, source_warehouse_name, target_warehouse_id, target_warehouse_name, transfer_type, status, reason, notes, created_by_user_id, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,$12,$13,$13)`,
        [id, transferNumber, dateStr, srcWh.id, srcWh.name, dstWh.id, dstWh.name, transferType, reason, notes, actor.id, actor.fullName, now]
      );

      for (const item of rawItems) {
        const prod = (await client.query('SELECT * FROM products WHERE id = $1 LIMIT 1', [item.productId])).rows[0];
        if (!prod) throw new AppError(404, `الصنف غير موجود (${item.productId})`, 'PRODUCT_NOT_FOUND');
        const requestedQty = round3(Number(item.requestedQty || 0));
        if (requestedQty <= 0) throw new AppError(400, `الكمية المطلوبة غير صالحة للصنف ${prod.name}`, 'INVALID_QTY');
        const unitFactor = Number(item.unitFactor || 1);
        const availableSnapshot = round3(Number(prod.stock_per_warehouse?.[srcWh.id] || 0));

        await client.query(
          `INSERT INTO stock_transfer_request_items (id, transfer_id, product_id, product_code, product_barcode, product_name, unit, unit_factor, requested_qty, available_qty_snapshot, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            generateServerId('STI'), id, prod.id, prod.code || '', prod.barcode || '',
            prod.name, item.unit || prod.base_unit || 'قطعة', unitFactor,
            requestedQty, availableSnapshot, String(item.notes || '').trim(),
          ]
        );
      }

      const row = (await client.query('SELECT * FROM stock_transfer_requests WHERE id = $1', [id])).rows[0];
      const itRows = (await client.query('SELECT * FROM stock_transfer_request_items WHERE transfer_id = $1', [id])).rows;
      return mapPgTransferRequest(row, itRows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إنشاء مسودة طلب تحويل مخزني (${created.transferNumber})`,
      module: 'تحويل الأصناف',
      recordId: id,
    });
    return created;
  }

  const created = await withJsonTransaction((db) => {
    const srcWh = db.warehouses.find((w) => w.id === sourceWarehouseId);
    const dstWh = db.warehouses.find((w) => w.id === targetWarehouseId);
    if (!srcWh || !dstWh) throw new AppError(404, 'المستودع المصدر أو الوجهة غير موجود', 'WAREHOUSE_NOT_FOUND');

    const seq = nextJsonSequence(db, 'stockTransferNo', db.stockTransferRequests, 'transferNumber', /^STR-(\d+)$/i);
    const transferNumber = `STR-${String(seq).padStart(5, '0')}`;

    const items = rawItems.map((item) => {
      const prod = db.products.find((p) => p.id === item.productId);
      if (!prod) throw new AppError(404, `الصنف غير موجود (${item.productId})`, 'PRODUCT_NOT_FOUND');
      const requestedQty = round3(Number(item.requestedQty || 0));
      if (requestedQty <= 0) throw new AppError(400, `الكمية المطلوبة غير صالحة للصنف ${prod.name}`, 'INVALID_QTY');
      return {
        id: generateServerId('STI'),
        productId: prod.id,
        productCode: prod.code || '',
        productBarcode: prod.barcode || '',
        productName: prod.name,
        unit: item.unit || prod.baseUnit || 'قطعة',
        unitFactor: Number(item.unitFactor || 1),
        requestedQty,
        availableQtySnapshot: round3(Number(prod.stockPerWarehouse?.[srcWh.id] || 0)),
        notes: String(item.notes || '').trim(),
      };
    });

    const record = {
      id,
      transferNumber,
      date: dateStr,
      sourceWarehouseId: srcWh.id,
      sourceWarehouseName: srcWh.name,
      targetWarehouseId: dstWh.id,
      targetWarehouseName: dstWh.name,
      transferType,
      status: 'draft',
      reason,
      notes,
      createdByUserId: actor.id,
      createdBy: actor.fullName,
      items,
      createdAt: now,
      updatedAt: now,
    };
    db.stockTransferRequests.unshift(record);
    return record;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إنشاء مسودة طلب تحويل مخزني (${created.transferNumber})`,
    module: 'تحويل الأصناف',
    recordId: id,
  });
  return created;
}

export async function submitStockTransferRequest(id, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const row = (await client.query('SELECT * FROM stock_transfer_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
      if (row.status !== 'draft') throw new AppError(409, 'الطلب مُرسل أو تم البت فيه مسبقاً', 'INVALID_STATE');
      await client.query(`UPDATE stock_transfer_requests SET status = 'submitted', submitted_at = $1, updated_at = $1 WHERE id = $2`, [now, id]);
      const next = (await client.query('SELECT * FROM stock_transfer_requests WHERE id = $1', [id])).rows[0];
      const itRows = (await client.query('SELECT * FROM stock_transfer_request_items WHERE transfer_id = $1', [id])).rows;
      return mapPgTransferRequest(next, itRows);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إرسال طلب تحويل للاعتماد (${out.transferNumber})`, module: 'تحويل الأصناف', recordId: id });
    return out;
  }

  const out = await withJsonTransaction((db) => {
    const cur = db.stockTransferRequests.find((t) => t.id === id);
    if (!cur) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
    if (cur.status !== 'draft') throw new AppError(409, 'الطلب مُرسل أو تم البت فيه مسبقاً', 'INVALID_STATE');
    cur.status = 'submitted';
    cur.submittedAt = now;
    cur.updatedAt = now;
    return cur;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إرسال طلب تحويل للاعتماد (${out.transferNumber})`, module: 'تحويل الأصناف', recordId: id });
  return out;
}

export async function approveStockTransferRequest(id, { notes = '' } = {}, actor) {
  if (!actor || actor.role === 'representative' || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للمندوبين أو العملاء باعتماد طلبات التحويل المخزني', 'FORBIDDEN_TRANSFER_APPROVE');
  }
  const now = nowIso();
  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const row = (await client.query('SELECT * FROM stock_transfer_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
      if (row.status !== 'draft' && row.status !== 'submitted') {
        throw new AppError(409, 'تم اعتماد أو تنفيذ أو رفض طلب التحويل مسبقاً', 'ALREADY_DECIDED');
      }
      const nextNotes = notes ? `${row.notes ? `${row.notes} | ` : ''}${notes}` : row.notes;
      await client.query(
        `UPDATE stock_transfer_requests SET status = 'approved', notes = $1, approved_by_user_id = $2, approved_by = $3, approved_at = $4, updated_at = $4 WHERE id = $5`,
        [nextNotes, actor.id, actor.fullName, now, id]
      );
      const next = (await client.query('SELECT * FROM stock_transfer_requests WHERE id = $1', [id])).rows[0];
      const itRows = (await client.query('SELECT * FROM stock_transfer_request_items WHERE transfer_id = $1', [id])).rows;
      return mapPgTransferRequest(next, itRows);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `اعتماد طلب التحويل (${out.transferNumber})`, module: 'تحويل الأصناف', recordId: id });
    return out;
  }

  const out = await withJsonTransaction((db) => {
    const cur = db.stockTransferRequests.find((t) => t.id === id);
    if (!cur) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
    if (cur.status !== 'draft' && cur.status !== 'submitted') {
      throw new AppError(409, 'تم اعتماد أو تنفيذ أو رفض طلب التحويل مسبقاً', 'ALREADY_DECIDED');
    }
    if (notes) cur.notes = `${cur.notes ? `${cur.notes} | ` : ''}${notes}`;
    cur.status = 'approved';
    cur.approvedByUserId = actor.id;
    cur.approvedBy = actor.fullName;
    cur.approvedAt = now;
    cur.updatedAt = now;
    return cur;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `اعتماد طلب التحويل (${out.transferNumber})`, module: 'تحويل الأصناف', recordId: id });
  return out;
}

export async function rejectStockTransferRequest(id, { reason }, actor) {
  if (!actor || actor.role === 'representative' || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للمندوبين أو العملاء برفض طلبات التحويل المخزني', 'FORBIDDEN_TRANSFER_REJECT');
  }
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new AppError(400, 'يرجى كتابة سبب رفض التحويل', 'REASON_REQUIRED');
  const now = nowIso();

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const row = (await client.query('SELECT * FROM stock_transfer_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
      if (row.status === 'executed' || row.status === 'rejected') {
        throw new AppError(409, 'لا يمكن رفض طلب تم تنفيذه أو رفضه مسبقاً', 'ALREADY_DECIDED');
      }
      await client.query(
        `UPDATE stock_transfer_requests SET status = 'rejected', rejection_reason = $1, approved_by_user_id = $2, approved_by = $3, approved_at = $4, updated_at = $4 WHERE id = $5`,
        [cleanReason, actor.id, actor.fullName, now, id]
      );
      const next = (await client.query('SELECT * FROM stock_transfer_requests WHERE id = $1', [id])).rows[0];
      const itRows = (await client.query('SELECT * FROM stock_transfer_request_items WHERE transfer_id = $1', [id])).rows;
      return mapPgTransferRequest(next, itRows);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `رفض طلب التحويل (${out.transferNumber})`, module: 'تحويل الأصناف', recordId: id, notes: cleanReason });
    return out;
  }

  const out = await withJsonTransaction((db) => {
    const cur = db.stockTransferRequests.find((t) => t.id === id);
    if (!cur) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
    if (cur.status === 'executed' || cur.status === 'rejected') {
      throw new AppError(409, 'لا يمكن رفض طلب تم تنفيذه أو رفضه مسبقاً', 'ALREADY_DECIDED');
    }
    cur.status = 'rejected';
    cur.rejectionReason = cleanReason;
    cur.approvedByUserId = actor.id;
    cur.approvedBy = actor.fullName;
    cur.approvedAt = now;
    cur.updatedAt = now;
    return cur;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `رفض طلب التحويل (${out.transferNumber})`, module: 'تحويل الأصناف', recordId: id, notes: cleanReason });
  return out;
}

export async function executeStockTransferRequest(id, actor) {
  if (!actor || actor.role === 'representative' || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للمندوبين أو العملاء بتنفيذ التحويلات المخزنية', 'FORBIDDEN_TRANSFER_EXECUTE');
  }
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    const executed = await withTransaction(async (client) => {
      const row = (await client.query('SELECT * FROM stock_transfer_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
      if (row.status === 'executed') {
        throw new AppError(409, 'تم تنفيذ هذا التحويل مسبقاً ولا يمكن تكرار التنفيذ', 'ALREADY_EXECUTED');
      }
      if (row.status !== 'approved') {
        throw new AppError(409, 'يجب اعتماد طلب التحويل أولاً قبل التنفيذ المخزني', 'NOT_APPROVED');
      }

      const items = (await client.query('SELECT * FROM stock_transfer_request_items WHERE transfer_id = $1', [id])).rows;
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      for (const it of items) {
        const prod = (await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [it.product_id])).rows[0];
        if (!prod) throw new AppError(404, `الصنف غير موجود (${it.product_name})`, 'PRODUCT_NOT_FOUND');
        const stockMap = { ...(prod.stock_per_warehouse || {}) };
        const baseQty = round3(Number(it.requested_qty || 0) * Number(it.unit_factor || 1));
        const liveSourceQty = round3(Number(stockMap[row.source_warehouse_id] || 0));
        if (liveSourceQty < baseQty) {
          throw new AppError(
            409,
            `الرصيد المتاح حالياً في ${row.source_warehouse_name} للصنف (${prod.name}) هو ${liveSourceQty} ولا يكفي لتحويل ${baseQty}`,
            'INSUFFICIENT_STOCK'
          );
        }
        const nextSourceQty = round3(liveSourceQty - baseQty);
        const nextTargetQty = round3(Number(stockMap[row.target_warehouse_id] || 0) + baseQty);
        stockMap[row.source_warehouse_id] = nextSourceQty;
        stockMap[row.target_warehouse_id] = nextTargetQty;

        await client.query(`UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3`, [JSON.stringify(stockMap), now, prod.id]);
        await client.query(`UPDATE stock_transfer_request_items SET executed_qty = $1 WHERE id = $2`, [Number(it.requested_qty), it.id]);

        const mvOutId = generateServerId('SM');
        const mvInId = generateServerId('SM');
        await client.query(
          `INSERT INTO stock_movements (id, movement_number, date, movement_type, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_id, related_doc_number, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1,$2,$3,'transfer_out',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [
            mvOutId, mvOutId, dateStr, prod.id, prod.name,
            row.source_warehouse_id, row.source_warehouse_name,
            row.target_warehouse_id, row.target_warehouse_name,
            baseQty, it.unit || prod.base_unit || 'قطعة', Number(it.unit_factor || 1),
            Number(prod.purchase_price || 0), nextSourceQty, row.id, row.transfer_number,
            `صرف تحويل مخزني (${row.transfer_number}) إلى ${row.target_warehouse_name}`,
            actor.id, actor.fullName,
            actorCtx.actorIdentityId || null,
            actorCtx.actorEmployeeId || null,
            actorCtx.actingRole || actor.role || null,
            now,
          ]
        );
        await client.query(
          `INSERT INTO stock_movements (id, movement_number, date, movement_type, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_id, related_doc_number, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1,$2,$3,'transfer_in',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [
            mvInId, mvInId, dateStr, prod.id, prod.name,
            row.target_warehouse_id, row.target_warehouse_name,
            row.source_warehouse_id, row.source_warehouse_name,
            baseQty, it.unit || prod.base_unit || 'قطعة', Number(it.unit_factor || 1),
            Number(prod.purchase_price || 0), nextTargetQty, row.id, row.transfer_number,
            `استلام تحويل مخزني (${row.transfer_number}) من ${row.source_warehouse_name}`,
            actor.id, actor.fullName,
            actorCtx.actorIdentityId || null,
            actorCtx.actorEmployeeId || null,
            actorCtx.actingRole || actor.role || null,
            now,
          ]
        );
      }

      await client.query(
        `UPDATE stock_transfer_requests SET status = 'executed', executed_by_user_id = $1, executed_by = $2, executed_at = $3, updated_at = $3 WHERE id = $4`,
        [actor.id, actor.fullName, now, id]
      );
      const next = (await client.query('SELECT * FROM stock_transfer_requests WHERE id = $1', [id])).rows[0];
      const itRows = (await client.query('SELECT * FROM stock_transfer_request_items WHERE transfer_id = $1', [id])).rows;
      return mapPgTransferRequest(next, itRows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تنفيذ تحويل الأصناف (${executed.transferNumber}) من ${executed.sourceWarehouseName} إلى ${executed.targetWarehouseName}`,
      module: 'تحويل الأصناف',
      recordId: id,
    });
    return executed;
  }

  // JSON Ledger mode
  const executed = await withJsonTransaction((db) => {
    const cur = db.stockTransferRequests.find((t) => t.id === id);
    if (!cur) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
    if (cur.status === 'executed') {
      throw new AppError(409, 'تم تنفيذ هذا التحويل مسبقاً ولا يمكن تكرار التنفيذ', 'ALREADY_EXECUTED');
    }
    if (cur.status !== 'approved') {
      throw new AppError(409, 'يجب اعتماد طلب التحويل أولاً قبل التنفيذ المخزني', 'NOT_APPROVED');
    }

    // Pre-validate all items before modifying any balances
    const planned = cur.items.map((it) => {
      const prod = db.products.find((p) => p.id === it.productId);
      if (!prod) throw new AppError(404, `الصنف غير موجود (${it.productName})`, 'PRODUCT_NOT_FOUND');
      const baseQty = round3(Number(it.requestedQty || 0) * Number(it.unitFactor || 1));
      const liveSourceQty = round3(Number(prod.stockPerWarehouse?.[cur.sourceWarehouseId] || 0));
      if (liveSourceQty < baseQty) {
        throw new AppError(
          409,
          `الرصيد المتاح حالياً في ${cur.sourceWarehouseName} للصنف (${prod.name}) هو ${liveSourceQty} ولا يكفي لتحويل ${baseQty}`,
          'INSUFFICIENT_STOCK'
        );
      }
      return { it, prod, baseQty };
    });

    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    for (const { it, prod, baseQty } of planned) {
      const srcBal = round3(Number(prod.stockPerWarehouse?.[cur.sourceWarehouseId] || 0));
      const dstBal = round3(Number(prod.stockPerWarehouse?.[cur.targetWarehouseId] || 0));
      const nextSrcBal = round3(srcBal - baseQty);
      const nextDstBal = round3(dstBal + baseQty);
      prod.stockPerWarehouse = {
        ...(prod.stockPerWarehouse || {}),
        [cur.sourceWarehouseId]: nextSrcBal,
        [cur.targetWarehouseId]: nextDstBal,
      };
      it.executedQty = Number(it.requestedQty);
      db.stockMovements.unshift(
        {
          id: generateServerId('SM'),
          date: dateStr,
          type: 'transfer_out',
          productId: prod.id,
          productName: prod.name,
          warehouseId: cur.sourceWarehouseId,
          warehouseName: cur.sourceWarehouseName,
          targetWarehouseId: cur.targetWarehouseId,
          targetWarehouseName: cur.targetWarehouseName,
          quantity: baseQty,
          unit: it.unit || prod.baseUnit || 'قطعة',
          unitFactor: Number(it.unitFactor || 1),
          balanceAfter: nextSrcBal,
          unitCost: Number(prod.purchasePrice || 0),
          referenceId: cur.id,
          referenceNumber: cur.transferNumber,
          notes: `صرف تحويل مخزني (${cur.transferNumber}) إلى ${cur.targetWarehouseName}`,
          createdByUserId: actor.id,
          createdBy: actor.fullName,
          actorIdentityId: actorCtxJson.actorIdentityId,
          actorEmployeeId: actorCtxJson.actorEmployeeId,
          actingRole: actorCtxJson.actingRole,
          createdAt: now,
        },
        {
          id: generateServerId('SM'),
          date: dateStr,
          type: 'transfer_in',
          productId: prod.id,
          productName: prod.name,
          warehouseId: cur.targetWarehouseId,
          warehouseName: cur.targetWarehouseName,
          targetWarehouseId: cur.sourceWarehouseId,
          targetWarehouseName: cur.sourceWarehouseName,
          quantity: baseQty,
          unit: it.unit || prod.baseUnit || 'قطعة',
          unitFactor: Number(it.unitFactor || 1),
          balanceAfter: nextDstBal,
          unitCost: Number(prod.purchasePrice || 0),
          referenceId: cur.id,
          referenceNumber: cur.transferNumber,
          notes: `استلام تحويل مخزني (${cur.transferNumber}) من ${cur.sourceWarehouseName}`,
          createdByUserId: actor.id,
          createdBy: actor.fullName,
          actorIdentityId: actorCtxJson.actorIdentityId,
          actorEmployeeId: actorCtxJson.actorEmployeeId,
          actingRole: actorCtxJson.actingRole,
          createdAt: now,
        }
      );
    }

    cur.status = 'executed';
    cur.executedByUserId = actor.id;
    cur.executedBy = actor.fullName;
    cur.executedAt = now;
    cur.updatedAt = now;
    return cur;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تنفيذ تحويل الأصناف (${executed.transferNumber}) من ${executed.sourceWarehouseName} إلى ${executed.targetWarehouseName}`,
    module: 'تحويل الأصناف',
    recordId: id,
  });
  return executed;
}

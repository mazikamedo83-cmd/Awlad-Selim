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

function classifyVariance(varianceQty) {
  if (Math.abs(varianceQty) < 0.0001) return 'matched';
  return varianceQty < 0 ? 'shortage' : 'surplus';
}

function mapPgStockCount(row, itemRows = []) {
  return {
    id: row.id,
    countNumber: row.count_number,
    date: isoDateOnly(row.date),
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    status: row.status,
    notes: row.notes || '',
    rejectionReason: row.rejection_reason || undefined,
    counterUserId: row.counter_user_id || undefined,
    counterName: row.counter_name,
    submittedAt: row.submitted_at ? isoTimestamp(row.submitted_at) : undefined,
    approvedByUserId: row.approved_by_user_id || undefined,
    approvedByName: row.approved_by_name || undefined,
    approvedAt: row.approved_at ? isoTimestamp(row.approved_at) : undefined,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    items: itemRows.map((it) => ({
      id: it.id,
      productId: it.product_id,
      productCode: it.product_code || '',
      productBarcode: it.product_barcode || '',
      productName: it.product_name,
      unit: it.unit,
      systemQty: Number(it.system_qty || 0),
      actualQty: Number(it.actual_qty || 0),
      varianceQty: Number(it.variance_qty || 0),
      varianceType: it.variance_type,
      liveQtyAtApproval: it.live_qty_at_approval !== null && it.live_qty_at_approval !== undefined ? Number(it.live_qty_at_approval) : undefined,
      reason: it.reason || '',
    })),
  };
}

export async function listStockCounts() {
  if (await isPgMode()) {
    const pool = getPool();
    const [cRes, itRes] = await Promise.all([
      pool.query('SELECT * FROM stock_counts ORDER BY created_at DESC LIMIT 500'),
      pool.query('SELECT * FROM stock_count_items'),
    ]);
    const itemsMap = new Map();
    for (const it of itRes.rows) {
      const list = itemsMap.get(it.count_id) || [];
      list.push(it);
      itemsMap.set(it.count_id, list);
    }
    return cRes.rows.map((r) => mapPgStockCount(r, itemsMap.get(r.id) || []));
  }
  const db = readJsonDatabase();
  return [...(db.stockCounts || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createStockCount(payload, actor) {
  const warehouseId = String(payload.warehouseId || '').trim();
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!warehouseId) throw new AppError(400, 'يرجى تحديد المستودع المطلوب جرده', 'WAREHOUSE_REQUIRED');
  if (!rawItems.length) throw new AppError(400, 'يجب اختيار صنف واحد على الأقل في جلسة الجرد', 'EMPTY_ITEMS');

  const dateStr = payload.date || todayIso();
  const notes = String(payload.notes || '').trim();
  const id = generateServerId('CNT');
  const now = nowIso();

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      const whRes = await client.query('SELECT * FROM warehouses WHERE id = $1 LIMIT 1', [warehouseId]);
      const wh = whRes.rows[0];
      if (!wh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

      const seqRes = await client.query(`SELECT nextval('seq_stock_count_no') AS n`);
      const countNumber = `CNT-${String(seqRes.rows[0].n).padStart(5, '0')}`;

      await client.query(
        `INSERT INTO stock_counts (id, count_number, date, warehouse_id, warehouse_name, status, notes, counter_user_id, counter_name, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$9)`,
        [id, countNumber, dateStr, wh.id, wh.name, notes, actor.id, actor.fullName, now]
      );

      for (const item of rawItems) {
        const pRes = await client.query('SELECT * FROM products WHERE id = $1 LIMIT 1', [item.productId]);
        const prod = pRes.rows[0];
        if (!prod) throw new AppError(404, `الصنف غير موجود (${item.productId})`, 'PRODUCT_NOT_FOUND');

        const systemQty = round3(Number(prod.stock_per_warehouse?.[wh.id] || 0));
        const actualQty = round3(Number(item.actualQty ?? systemQty));
        if (actualQty < 0) throw new AppError(400, `الكمية الفعلية لا يمكن أن تكون سالبة للصنف ${prod.name}`, 'INVALID_QTY');
        const varianceQty = round3(actualQty - systemQty);
        const varianceType = classifyVariance(varianceQty);

        await client.query(
          `INSERT INTO stock_count_items (id, count_id, product_id, product_code, product_barcode, product_name, unit, system_qty, actual_qty, variance_qty, variance_type, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            generateServerId('SCI'), id, prod.id, prod.code || '', prod.barcode || '',
            prod.name, prod.base_unit || 'قطعة', systemQty, actualQty, varianceQty, varianceType,
            String(item.reason || '').trim(),
          ]
        );
      }

      const cRow = (await client.query('SELECT * FROM stock_counts WHERE id = $1', [id])).rows[0];
      const iRows = (await client.query('SELECT * FROM stock_count_items WHERE count_id = $1', [id])).rows;
      return mapPgStockCount(cRow, iRows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إنشاء مسودة جرد مخزن (${created.countNumber}) - ${created.warehouseName}`,
      module: 'جرد المخزن',
      recordId: id,
    });
    return created;
  }

  const created = await withJsonTransaction((db) => {
    const wh = db.warehouses.find((w) => w.id === warehouseId);
    if (!wh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

    const seq = nextJsonSequence(db, 'stockCountNo', db.stockCounts, 'countNumber', /^CNT-(\d+)$/i);
    const countNumber = `CNT-${String(seq).padStart(5, '0')}`;

    const countItems = rawItems.map((item) => {
      const prod = db.products.find((p) => p.id === item.productId);
      if (!prod) throw new AppError(404, `الصنف غير موجود (${item.productId})`, 'PRODUCT_NOT_FOUND');
      const systemQty = round3(Number(prod.stockPerWarehouse?.[wh.id] || 0));
      const actualQty = round3(Number(item.actualQty ?? systemQty));
      if (actualQty < 0) throw new AppError(400, `الكمية الفعلية لا يمكن أن تكون سالبة للصنف ${prod.name}`, 'INVALID_QTY');
      const varianceQty = round3(actualQty - systemQty);
      return {
        id: generateServerId('SCI'),
        productId: prod.id,
        productCode: prod.code || '',
        productBarcode: prod.barcode || '',
        productName: prod.name,
        unit: prod.baseUnit || 'قطعة',
        systemQty,
        actualQty,
        varianceQty,
        varianceType: classifyVariance(varianceQty),
        reason: String(item.reason || '').trim(),
      };
    });

    const record = {
      id,
      countNumber,
      date: dateStr,
      warehouseId: wh.id,
      warehouseName: wh.name,
      status: 'draft',
      notes,
      counterUserId: actor.id,
      counterName: actor.fullName,
      items: countItems,
      createdAt: now,
      updatedAt: now,
    };
    db.stockCounts.unshift(record);
    return record;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إنشاء مسودة جرد مخزن (${created.countNumber}) - ${created.warehouseName}`,
    module: 'جرد المخزن',
    recordId: id,
  });
  return created;
}

export async function updateStockCount(id, payload, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const cRes = await client.query('SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE', [id]);
      const cur = cRes.rows[0];
      if (!cur) throw new AppError(404, 'سجل الجرد غير موجود', 'NOT_FOUND');
      if (cur.status !== 'draft') {
        throw new AppError(409, 'لا يمكن تعديل جرد بعد إرساله أو اعتماده', 'INVALID_STATE');
      }

      if (Array.isArray(payload.items) && payload.items.length > 0) {
        await client.query('DELETE FROM stock_count_items WHERE count_id = $1', [id]);
        for (const item of payload.items) {
          const pRes = await client.query('SELECT * FROM products WHERE id = $1 LIMIT 1', [item.productId]);
          const prod = pRes.rows[0];
          if (!prod) throw new AppError(404, `الصنف غير موجود (${item.productId})`, 'PRODUCT_NOT_FOUND');
          const systemQty = round3(Number(item.systemQty ?? prod.stock_per_warehouse?.[cur.warehouse_id] ?? 0));
          const actualQty = round3(Number(item.actualQty ?? systemQty));
          if (actualQty < 0) throw new AppError(400, `الكمية الفعلية لا يمكن أن تكون سالبة`, 'INVALID_QTY');
          const varianceQty = round3(actualQty - systemQty);
          await client.query(
            `INSERT INTO stock_count_items (id, count_id, product_id, product_code, product_barcode, product_name, unit, system_qty, actual_qty, variance_qty, variance_type, reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              generateServerId('SCI'), id, prod.id, prod.code || '', prod.barcode || '',
              prod.name, prod.base_unit || 'قطعة', systemQty, actualQty, varianceQty, classifyVariance(varianceQty),
              String(item.reason || '').trim(),
            ]
          );
        }
      }

      await client.query(
        `UPDATE stock_counts SET date = COALESCE($1, date), notes = COALESCE($2, notes), updated_at = $3 WHERE id = $4`,
        [payload.date || null, payload.notes ?? null, now, id]
      );
      const cRow = (await client.query('SELECT * FROM stock_counts WHERE id = $1', [id])).rows[0];
      const iRows = (await client.query('SELECT * FROM stock_count_items WHERE count_id = $1', [id])).rows;
      return mapPgStockCount(cRow, iRows);
    });
    return updated;
  }

  return withJsonTransaction((db) => {
    const idx = db.stockCounts.findIndex((c) => c.id === id);
    if (idx === -1) throw new AppError(404, 'سجل الجرد غير موجود', 'NOT_FOUND');
    const cur = db.stockCounts[idx];
    if (cur.status !== 'draft') throw new AppError(409, 'لا يمكن تعديل جرد بعد إرساله أو اعتماده', 'INVALID_STATE');

    let nextItems = cur.items;
    if (Array.isArray(payload.items) && payload.items.length > 0) {
      nextItems = payload.items.map((item) => {
        const prod = db.products.find((p) => p.id === item.productId);
        if (!prod) throw new AppError(404, `الصنف غير موجود`, 'PRODUCT_NOT_FOUND');
        const systemQty = round3(Number(item.systemQty ?? prod.stockPerWarehouse?.[cur.warehouseId] ?? 0));
        const actualQty = round3(Number(item.actualQty ?? systemQty));
        if (actualQty < 0) throw new AppError(400, `الكمية الفعلية لا يمكن أن تكون سالبة`, 'INVALID_QTY');
        const varianceQty = round3(actualQty - systemQty);
        return {
          id: item.id || generateServerId('SCI'),
          productId: prod.id,
          productCode: prod.code || '',
          productBarcode: prod.barcode || '',
          productName: prod.name,
          unit: prod.baseUnit || 'قطعة',
          systemQty,
          actualQty,
          varianceQty,
          varianceType: classifyVariance(varianceQty),
          reason: String(item.reason || '').trim(),
        };
      });
    }

    db.stockCounts[idx] = {
      ...cur,
      date: payload.date || cur.date,
      notes: payload.notes ?? cur.notes,
      items: nextItems,
      updatedAt: now,
    };
    return db.stockCounts[idx];
  });
}

export async function submitStockCount(id, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const cRes = await client.query('SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE', [id]);
      const cur = cRes.rows[0];
      if (!cur) throw new AppError(404, 'سجل الجرد غير موجود', 'NOT_FOUND');
      if (cur.status !== 'draft') throw new AppError(409, 'الجرد مُرسل أو مُعتمد بالفعل', 'INVALID_STATE');
      await client.query(`UPDATE stock_counts SET status = 'submitted', submitted_at = $1, updated_at = $1 WHERE id = $2`, [now, id]);
      const cRow = (await client.query('SELECT * FROM stock_counts WHERE id = $1', [id])).rows[0];
      const iRows = (await client.query('SELECT * FROM stock_count_items WHERE count_id = $1', [id])).rows;
      return mapPgStockCount(cRow, iRows);
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إرسال جرد المخزن للاعتماد (${updated.countNumber})`,
      module: 'جرد المخزن',
      recordId: id,
    });
    return updated;
  }

  const updated = await withJsonTransaction((db) => {
    const cur = db.stockCounts.find((c) => c.id === id);
    if (!cur) throw new AppError(404, 'سجل الجرد غير موجود', 'NOT_FOUND');
    if (cur.status !== 'draft') throw new AppError(409, 'الجرد مُرسل أو مُعتمد بالفعل', 'INVALID_STATE');
    cur.status = 'submitted';
    cur.submittedAt = now;
    cur.updatedAt = now;
    return cur;
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إرسال جرد المخزن للاعتماد (${updated.countNumber})`,
    module: 'جرد المخزن',
    recordId: id,
  });
  return updated;
}

export async function approveStockCount(id, { reconcileMode = null, notes = '' } = {}, actor) {
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    const approved = await withTransaction(async (client) => {
      const cRes = await client.query('SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE', [id]);
      const cur = cRes.rows[0];
      if (!cur) throw new AppError(404, 'سجل الجرد غير موجود', 'NOT_FOUND');
      if (cur.status === 'approved' || cur.status === 'rejected') {
        throw new AppError(409, 'تم البت في هذا الجرد مسبقاً ولا يمكن إعادة اعتماده', 'ALREADY_DECIDED');
      }

      const itemsRes = await client.query('SELECT * FROM stock_count_items WHERE count_id = $1', [id]);
      const items = itemsRes.rows;
      const stRes = await client.query('SELECT allow_negative_stock FROM system_settings LIMIT 1');
      const allowNeg = Boolean(stRes.rows[0]?.allow_negative_stock);

      const diverged = [];
      const productSnapshots = new Map();
      for (const it of items) {
        const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [it.product_id]);
        const prod = pRes.rows[0];
        if (!prod) throw new AppError(404, `الصنف ${it.product_name} غير موجود`, 'PRODUCT_NOT_FOUND');
        const stockMap = { ...(prod.stock_per_warehouse || {}) };
        const liveQty = round3(Number(stockMap[cur.warehouse_id] || 0));
        productSnapshots.set(it.product_id, { prod, stockMap, liveQty });
        if (Math.abs(liveQty - Number(it.system_qty || 0)) > 0.0001) {
          diverged.push({
            productId: it.product_id,
            productName: it.product_name,
            snapshotQty: Number(it.system_qty || 0),
            liveQty,
            actualQty: Number(it.actual_qty || 0),
          });
        }
      }

      if (diverged.length > 0 && !reconcileMode) {
        throw new AppError(
          409,
          `تغير الرصيد الفعلي لبعض الأصناف أثناء فترة الجرد (${diverged.map((d) => `${d.productName}: الدفتري ${d.snapshotQty} ← الحالي ${d.liveQty}`).join('، ')}). اختر طريقة التسوية الآمنة قبل الاعتماد.`,
          'COUNT_STOCK_CHANGED_DURING_COUNT',
          { diverged }
        );
      }

      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      for (const it of items) {
        const { prod, stockMap, liveQty } = productSnapshots.get(it.product_id);
        const varianceQty = round3(Number(it.variance_qty || 0));
        const targetQty =
          reconcileMode === 'apply_delta'
            ? round3(liveQty + varianceQty)
            : round3(Number(it.actual_qty || 0));
        const appliedDelta = round3(targetQty - liveQty);

        if (targetQty < 0 && !allowNeg) {
          throw new AppError(409, `اعتماد الجرد يؤدي إلى رصيد سالب للصنف ${it.product_name}`, 'NEGATIVE_STOCK_NOT_ALLOWED');
        }

        await client.query(`UPDATE stock_count_items SET live_qty_at_approval = $1 WHERE id = $2`, [liveQty, it.id]);

        if (Math.abs(appliedDelta) > 0.0001) {
          stockMap[cur.warehouse_id] = targetQty;
          await client.query(`UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3`, [
            JSON.stringify(stockMap),
            now,
            prod.id,
          ]);
          await client.query(
            `INSERT INTO stock_movements (id, date, movement_type, product_id, product_name, warehouse_id, warehouse_name, quantity, unit_cost, related_doc_id, related_doc_number, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
             VALUES ($1,$2,'adjustment',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [
              generateServerId('SM'),
              dateStr,
              prod.id,
              prod.name,
              cur.warehouse_id,
              cur.warehouse_name,
              appliedDelta,
              Number(prod.purchase_price || 0),
              cur.id,
              cur.count_number,
              `تسوية جرد مخزن (${cur.count_number}): الرصيد ${liveQty} ← ${targetQty} ${it.reason ? `| ${it.reason}` : ''}`,
              actor.id,
              actor.fullName,
              actorCtx.actorIdentityId || null,
              actorCtx.actorEmployeeId || null,
              actorCtx.actingRole || actor.role || null,
              now,
            ]
          );
        }
      }

      const finalNotes = notes ? `${cur.notes ? `${cur.notes} | ` : ''}${notes}` : cur.notes;
      await client.query(
        `UPDATE stock_counts SET status = 'approved', notes = $1, approved_by_user_id = $2, approved_by_name = $3, approved_at = $4, updated_at = $4 WHERE id = $5`,
        [finalNotes, actor.id, actor.fullName, now, id]
      );

      const cRow = (await client.query('SELECT * FROM stock_counts WHERE id = $1', [id])).rows[0];
      const iRows = (await client.query('SELECT * FROM stock_count_items WHERE count_id = $1', [id])).rows;
      return mapPgStockCount(cRow, iRows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `اعتماد جرد المخزن (${approved.countNumber}) وتحديث الأرصدة`,
      module: 'جرد المخزن',
      recordId: id,
      newValues: { reconcileMode: reconcileMode || 'exact', itemsCount: approved.items.length },
    });
    return approved;
  }

  // JSON Ledger mode
  const approved = await withJsonTransaction((db) => {
    const cur = db.stockCounts.find((c) => c.id === id);
    if (!cur) throw new AppError(404, 'سجل الجرد غير موجود', 'NOT_FOUND');
    if (cur.status === 'approved' || cur.status === 'rejected') {
      throw new AppError(409, 'تم البت في هذا الجرد مسبقاً ولا يمكن إعادة اعتماده', 'ALREADY_DECIDED');
    }

    const allowNeg = Boolean(db.settings?.allowNegativeStock);
    const diverged = [];
    const liveMap = new Map();

    for (const it of cur.items) {
      const prod = db.products.find((p) => p.id === it.productId);
      if (!prod) throw new AppError(404, `الصنف ${it.productName} غير موجود`, 'PRODUCT_NOT_FOUND');
      const liveQty = round3(Number(prod.stockPerWarehouse?.[cur.warehouseId] || 0));
      liveMap.set(it.productId, { prod, liveQty });
      if (Math.abs(liveQty - Number(it.systemQty || 0)) > 0.0001) {
        diverged.push({
          productId: it.productId,
          productName: it.productName,
          snapshotQty: Number(it.systemQty || 0),
          liveQty,
          actualQty: Number(it.actualQty || 0),
        });
      }
    }

    if (diverged.length > 0 && !reconcileMode) {
      throw new AppError(
        409,
        `تغير الرصيد الفعلي لبعض الأصناف أثناء فترة الجرد (${diverged.map((d) => `${d.productName}: الدفتري ${d.snapshotQty} ← الحالي ${d.liveQty}`).join('، ')}). اختر طريقة التسوية الآمنة قبل الاعتماد.`,
        'COUNT_STOCK_CHANGED_DURING_COUNT',
        { diverged }
      );
    }

    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    for (const it of cur.items) {
      const { prod, liveQty } = liveMap.get(it.productId);
      const targetQty =
        reconcileMode === 'apply_delta'
          ? round3(liveQty + Number(it.varianceQty || 0))
          : round3(Number(it.actualQty || 0));
      const appliedDelta = round3(targetQty - liveQty);
      if (targetQty < 0 && !allowNeg) {
        throw new AppError(409, `اعتماد الجرد يؤدي إلى رصيد سالب للصنف ${it.productName}`, 'NEGATIVE_STOCK_NOT_ALLOWED');
      }
      it.liveQtyAtApproval = liveQty;

      if (Math.abs(appliedDelta) > 0.0001) {
        prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [cur.warehouseId]: targetQty };
        db.stockMovements.unshift({
          id: generateServerId('SM'),
          date: dateStr,
          type: 'adjustment',
          productId: prod.id,
          productName: prod.name,
          warehouseId: cur.warehouseId,
          warehouseName: cur.warehouseName,
          quantity: appliedDelta,
          unitCost: Number(prod.purchasePrice || 0),
          referenceId: cur.id,
          referenceNumber: cur.countNumber,
          notes: `تسوية جرد مخزن (${cur.countNumber}): الرصيد ${liveQty} ← ${targetQty} ${it.reason ? `| ${it.reason}` : ''}`,
          createdByUserId: actor.id,
          createdBy: actor.fullName,
          actorIdentityId: actorCtxJson.actorIdentityId,
          actorEmployeeId: actorCtxJson.actorEmployeeId,
          actingRole: actorCtxJson.actingRole,
          createdAt: now,
        });
      }
    }

    if (notes) cur.notes = `${cur.notes ? `${cur.notes} | ` : ''}${notes}`;
    cur.status = 'approved';
    cur.approvedByUserId = actor.id;
    cur.approvedByName = actor.fullName;
    cur.approvedAt = now;
    cur.updatedAt = now;
    return cur;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `اعتماد جرد المخزن (${approved.countNumber}) وتحديث الأرصدة`,
    module: 'جرد المخزن',
    recordId: id,
    newValues: { reconcileMode: reconcileMode || 'exact', itemsCount: approved.items.length },
  });
  return approved;
}

export async function rejectStockCount(id, { reason }, actor) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new AppError(400, 'يرجى توضيح سبب رفض الجرد', 'REASON_REQUIRED');
  const now = nowIso();

  if (await isPgMode()) {
    const rejected = await withTransaction(async (client) => {
      const cRes = await client.query('SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE', [id]);
      const cur = cRes.rows[0];
      if (!cur) throw new AppError(404, 'سجل الجرد غير موجود', 'NOT_FOUND');
      if (cur.status === 'approved' || cur.status === 'rejected') {
        throw new AppError(409, 'تم البت في هذا الجرد مسبقاً', 'ALREADY_DECIDED');
      }
      await client.query(
        `UPDATE stock_counts SET status = 'rejected', rejection_reason = $1, approved_by_user_id = $2, approved_by_name = $3, approved_at = $4, updated_at = $4 WHERE id = $5`,
        [cleanReason, actor.id, actor.fullName, now, id]
      );
      const cRow = (await client.query('SELECT * FROM stock_counts WHERE id = $1', [id])).rows[0];
      const iRows = (await client.query('SELECT * FROM stock_count_items WHERE count_id = $1', [id])).rows;
      return mapPgStockCount(cRow, iRows);
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `رفض جرد المخزن (${rejected.countNumber})`,
      module: 'جرد المخزن',
      recordId: id,
      notes: cleanReason,
    });
    return rejected;
  }

  const rejected = await withJsonTransaction((db) => {
    const cur = db.stockCounts.find((c) => c.id === id);
    if (!cur) throw new AppError(404, 'سجل الجرد غير موجود', 'NOT_FOUND');
    if (cur.status === 'approved' || cur.status === 'rejected') {
      throw new AppError(409, 'تم البت في هذا الجرد مسبقاً', 'ALREADY_DECIDED');
    }
    cur.status = 'rejected';
    cur.rejectionReason = cleanReason;
    cur.approvedByUserId = actor.id;
    cur.approvedByName = actor.fullName;
    cur.approvedAt = now;
    cur.updatedAt = now;
    return cur;
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `رفض جرد المخزن (${rejected.countNumber})`,
    module: 'جرد المخزن',
    recordId: id,
    notes: cleanReason,
  });
  return rejected;
}

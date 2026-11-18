import { getPool, withTransaction } from '../postgres.js';
import {
  withJsonTransaction,
  nextJsonSequence,
  readJsonDatabase,
} from '../jsonLedger.js';
import { generateServerId } from '../../utils/crypto.js';
import {
  AppError,
  nowIso,
  todayIso,
  round2,
  round3,
  getUnitSellingPrice,
  getUnitFactor,
} from '../../utils/errors.js';
import {
  buildScopedIdemKey,
  findPgIdempotency,
  savePgIdempotency,
  findJsonIdempotency,
  saveJsonIdempotency,
} from '../../utils/idempotency.js';
import { isPgMode, mapPgOrderRow, isoTimestamp, isoDateOnly } from './mode.js';
import { recordAuditLog } from './authStore.js';
import { createInvoiceInsidePgTx, createInvoiceInsideJsonTx } from './invoicesStore.js';
import {
  getRepresentativeByUserId,
  listCustomers,
  isCustomerAllowedForRep,
  getSystemSettingsSafe,
} from './catalogStore.js';

function mapPgOrderAdvanceRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    paymentNumber: r.advance_number,
    advanceNumber: r.advance_number,
    orderId: r.order_id,
    requestNumber: r.request_number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    amount: Number(r.amount || 0),
    date: isoDateOnly(r.date),
    paymentMethod: r.payment_method || 'cash',
    cashboxId: r.cashbox_id,
    cashboxName: r.cashbox_name,
    status: r.status || 'available',
    appliedInvoiceId: r.applied_invoice_id || undefined,
    appliedInvoiceNumber: r.applied_invoice_number || undefined,
    appliedAt: r.applied_at ? isoTimestamp(r.applied_at) : undefined,
    notes: r.notes || '',
    originDeviceId: r.origin_device_id || undefined,
    createdBy: r.created_by,
    createdAt: isoTimestamp(r.created_at),
  };
}

export async function listOrders(authContext, filters = {}) {
  const isCustomer = authContext.user.role === 'customer';
  const isRep = authContext.user.role === 'representative';
  const targetCustomerId = isCustomer ? authContext.customerProfile?.id || null : filters.customerId || null;

  if (isCustomer && !targetCustomerId) {
    return [];
  }

  let repProfile = null;
  let allowedCustomerIds = null;
  if (isRep) {
    repProfile = authContext.representativeProfile || (await getRepresentativeByUserId(authContext.user.id));
    if (!repProfile) return [];
    const allowedCusts = await listCustomers({ forRepId: repProfile.id });
    allowedCustomerIds = new Set(allowedCusts.map((c) => c.id));
  }

  if (await isPgMode()) {
    const pool = getPool();
    const params = [];
    const clauses = [];
    if (targetCustomerId) {
      params.push(targetCustomerId);
      clauses.push(`customer_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`status = $${params.length}`);
    }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const ordRes = await pool.query(`SELECT * FROM customer_item_orders ${whereSql} ORDER BY created_at DESC`, params);
    if (ordRes.rows.length === 0) return [];

    const ordIds = ordRes.rows.map((r) => r.id);
    const itemsRes = await pool.query(`SELECT * FROM customer_item_order_items WHERE order_id = ANY($1::varchar[])`, [ordIds]);
    const histRes = await pool.query(
      `SELECT * FROM order_status_history WHERE order_id = ANY($1::varchar[]) ORDER BY changed_at ASC`,
      [ordIds]
    );

    const itemsMap = new Map();
    for (const it of itemsRes.rows) {
      const list = itemsMap.get(it.order_id) || [];
      list.push(it);
      itemsMap.set(it.order_id, list);
    }
    const histMap = new Map();
    for (const h of histRes.rows) {
      const list = histMap.get(h.order_id) || [];
      list.push(h);
      histMap.set(h.order_id, list);
    }

    const list = ordRes.rows.map((r) => mapPgOrderRow(r, itemsMap.get(r.id) || [], histMap.get(r.id) || []));
    return isRep
      ? list.filter(
          (o) =>
            (allowedCustomerIds && allowedCustomerIds.has(o.customerId)) ||
            (repProfile && (o.deliveryRepId === repProfile.id || o.representativeId === repProfile.id))
        )
      : list;
  }

  const db = readJsonDatabase();
  return db.customerItemOrders
    .filter((o) => {
      if (targetCustomerId && o.customerId !== targetCustomerId) return false;
      if (
        isRep &&
        !(
          (allowedCustomerIds && allowedCustomerIds.has(o.customerId)) ||
          (repProfile && (o.deliveryRepId === repProfile.id || o.representativeId === repProfile.id))
        )
      ) {
        return false;
      }
      if (filters.status && o.status !== filters.status) return false;
      return true;
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getOrderById(orderId, authContext) {
  if (await isPgMode()) {
    const pool = getPool();
    const ordRes = await pool.query(`SELECT * FROM customer_item_orders WHERE id = $1 LIMIT 1`, [orderId]);
    const row = ordRes.rows[0];
    if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');

    if (authContext.user.role === 'customer' && row.customer_id !== authContext.customerProfile?.id) {
      throw new AppError(403, 'غير مصرح لك بعرض طلبات عميل آخر', 'FORBIDDEN_ORDER_ACCESS');
    }
    if (authContext.user.role === 'representative') {
      const rep = authContext.representativeProfile || (await getRepresentativeByUserId(authContext.user.id));
      const allowedCusts = rep ? await listCustomers({ forRepId: rep.id }) : [];
      const assignedToRep = rep && (row.delivery_rep_id === rep.id || row.representative_id === rep.id);
      if (!assignedToRep && !allowedCusts.some((c) => c.id === row.customer_id)) {
        throw new AppError(403, 'غير مصرح لك بعرض طلبات عميل غير معين لك', 'FORBIDDEN_ORDER_ACCESS');
      }
    }

    const itemsRes = await pool.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
    const histRes = await pool.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
    return mapPgOrderRow(row, itemsRes.rows, histRes.rows);
  }

  const db = readJsonDatabase();
  const order = db.customerItemOrders.find((o) => o.id === orderId);
  if (!order) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
  if (authContext.user.role === 'customer' && order.customerId !== authContext.customerProfile?.id) {
    throw new AppError(403, 'غير مصرح لك بعرض طلبات عميل آخر', 'FORBIDDEN_ORDER_ACCESS');
  }
  if (authContext.user.role === 'representative') {
    const rep = authContext.representativeProfile || (await getRepresentativeByUserId(authContext.user.id));
    const cust = db.customers.find((c) => c.id === order.customerId);
    const assignedToRep = rep && (order.deliveryRepId === rep.id || order.representativeId === rep.id);
    if (!rep || (!assignedToRep && !isCustomerAllowedForRep(cust, rep.id))) {
      throw new AppError(403, 'غير مصرح لك بعرض طلبات عميل غير معين لك', 'FORBIDDEN_ORDER_ACCESS');
    }
  }
  return order;
}

export async function createCustomerOrder(payload, authContext) {
  const actor = authContext.user;
  const isCustomer = actor.role === 'customer';
  const isRep = actor.role === 'representative';
  const settings = await getSystemSettingsSafe();
  if (isCustomer && settings.mobileConfig?.enableCustomerApp === false) {
    throw new AppError(403, 'استقبال طلبات العملاء من تطبيق الموبايل متوقف حاليًا من إعدادات الإدارة', 'CUSTOMER_APP_DISABLED');
  }

  // Strictly determine authoritative customerId — NEVER trust client customerId for customer accounts
  const targetCustomerId = isCustomer ? authContext.customerProfile?.id : payload.customerId;
  if (!targetCustomerId) {
    throw new AppError(
      400,
      isCustomer
        ? 'حساب العميل غير مربوط بملف عميل في الدليل. يرجى التواصل مع الإدارة لإتمام الربط.'
        : 'يرجى تحديد العميل المطلوب إنشاء الطلب له',
      'CUSTOMER_PROFILE_REQUIRED'
    );
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0) {
    throw new AppError(400, 'يجب إضافة صنف واحد على الأقل إلى السلة', 'EMPTY_ORDER_ITEMS');
  }

  const idempotencyKey = payload.idempotencyKey ? String(payload.idempotencyKey).trim().slice(0, 128) : null;
  const requesterType = isRep ? 'representative' : 'customer';
  const originDeviceId = payload.originDeviceId ? String(payload.originDeviceId).slice(0, 128) : null;
  const now = nowIso();
  const orderId = generateServerId('ORD');

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      if (idempotencyKey) {
        const dup = await client.query(`SELECT * FROM customer_item_orders WHERE idempotency_key = $1 LIMIT 1`, [idempotencyKey]);
        if (dup.rows[0]) {
          const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [dup.rows[0].id]);
          const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [dup.rows[0].id]);
          return { order: mapPgOrderRow(dup.rows[0], itemsRes.rows, histRes.rows), deduplicated: true };
        }
      }

      const custRes = await client.query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [targetCustomerId]);
      const cust = custRes.rows[0];
      if (!cust) throw new AppError(404, 'ملف العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      if (cust.status === 'blocked') throw new AppError(403, 'حساب العميل موقوف حاليًا ولا يمكنه إرسال طلبات', 'CUSTOMER_BLOCKED');

      let repInfo = null;
      if (isRep) {
        repInfo = authContext.representativeProfile || (await getRepresentativeByUserId(actor.id));
        const { mapPgCustomerRow } = await import('./mode.js');
        if (!repInfo || !isCustomerAllowedForRep(mapPgCustomerRow(cust), repInfo.id)) {
          throw new AppError(403, 'غير مصرح لك بإنشاء طلب لعميل غير معين في قائمتك', 'CUSTOMER_NOT_ASSIGNED_TO_REP');
        }
      }

      const resolvedItems = [];
      let totalAmount = 0;
      for (const item of rawItems) {
        const qty = round3(item.quantity);
        if (!item.productId || qty <= 0) {
          throw new AppError(400, 'بيانات الأصناف أو الكميات غير صالحة (الكمية يجب أن تكون أكبر من صفر)', 'INVALID_ORDER_ITEM');
        }
        const pRes = await client.query(`SELECT * FROM products WHERE id = $1 LIMIT 1`, [item.productId]);
        const prod = pRes.rows[0];
        if (!prod || prod.status !== 'active') {
          throw new AppError(404, `الصنف غير متاح أو غير نشط (${item.productName || item.productId})`, 'PRODUCT_UNAVAILABLE');
        }
        const uRes = await client.query(`SELECT * FROM product_units WHERE product_id = $1`, [prod.id]);
        const prodObj = {
          baseUnit: prod.base_unit,
          sellingPrice: Number(prod.selling_price || 0),
          units: uRes.rows.map((u) => ({
            name: u.name,
            conversionFactor: Number(u.conversion_factor || 1),
            sellingPrice: Number(u.selling_price || 0),
          })),
        };
        const unitName = String(item.unit || prod.base_unit);
        const unitFactor = getUnitFactor(prodObj, unitName);
        const referenceUnitPrice = round2(item.unitPrice ?? getUnitSellingPrice(prodObj, unitName));
        totalAmount = round2(totalAmount + qty * referenceUnitPrice);

        resolvedItems.push({
          id: generateServerId('OITM'),
          productId: prod.id,
          productCode: prod.code,
          productName: prod.name,
          unit: unitName,
          unitFactor,
          quantity: qty,
          unitPrice: referenceUnitPrice,
        });
      }

      const seqRes = await client.query(`SELECT nextval('seq_customer_order_no') AS n`);
      const seqNum = Number(seqRes.rows[0]?.n || 1);
      const requestNumber = `COR-${String(seqNum).padStart(5, '0')}`;

      const customerPhone = String(payload.customerPhone || cust.phone || '').trim();
      const shopName = String(payload.shopName || cust.shop_name || '').trim();
      const deliveryAddress = String(payload.deliveryAddress || cust.address || cust.shop_address || '').trim();
      const geoCoordinates = String(payload.geoCoordinates || cust.geo_coordinates || cust.map_location || '').trim();
      const submittedByName = isRep ? repInfo?.name || actor.fullName : cust.name;

      await client.query(
        `INSERT INTO customer_item_orders (id, request_number, customer_id, user_id, requester_type, representative_id, representative_name, submitted_by_name, customer_name, customer_phone, shop_name, delivery_address, geo_coordinates, status, total_amount, advance_paid_amount, notes, idempotency_key, origin_device_id, version, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,0,$15,$16,$17,1,$18,$18)`,
        [
          orderId,
          requestNumber,
          cust.id,
          actor.id,
          requesterType,
          repInfo?.id || null,
          repInfo?.name || '',
          submittedByName,
          cust.name,
          customerPhone,
          shopName,
          deliveryAddress,
          geoCoordinates,
          totalAmount,
          String(payload.notes || '').trim(),
          idempotencyKey,
          originDeviceId,
          now,
        ]
      );

      for (const it of resolvedItems) {
        await client.query(
          `INSERT INTO customer_item_order_items (id, order_id, product_id, product_code, product_name, unit, unit_factor, quantity, reference_unit_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [it.id, orderId, it.productId, it.productCode, it.productName, it.unit, it.unitFactor, it.quantity, it.unitPrice]
        );
      }

      const histId = generateServerId('OSH');
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,NULL,'pending',$3,$4,$5,$6)`,
        [histId, orderId, actor.id, actor.fullName, isRep ? 'إنشاء طلب عبر المندوب' : 'إنشاء طلب جديد من العميل', now]
      );

      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return { order: mapPgOrderRow(ordRes.rows[0], itemsRes.rows, histRes.rows), deduplicated: false };
    });

    if (!result.deduplicated) {
      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `إرسال طلب جديد (${result.order.requestNumber})`,
        module: 'طلبات العملاء',
        recordId: result.order.id,
      });
    }
    return result;
  }

  // JSON Ledger fallback
  const result = await withJsonTransaction(async (db) => {
    if (idempotencyKey) {
      const existing = db.customerItemOrders.find((o) => o.idempotencyKey === idempotencyKey);
      if (existing) {
        return { order: existing, deduplicated: true };
      }
    }

    const cust = db.customers.find((c) => c.id === targetCustomerId);
    if (!cust) throw new AppError(404, 'ملف العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    if (cust.status === 'blocked') throw new AppError(403, 'حساب العميل موقوف حاليًا ولا يمكنه إرسال طلبات', 'CUSTOMER_BLOCKED');

    let repInfo = null;
    if (isRep) {
      repInfo = authContext.representativeProfile || (db.representatives || []).find((r) => r.userId === actor.id);
      if (!repInfo || !isCustomerAllowedForRep(cust, repInfo.id)) {
        throw new AppError(403, 'غير مصرح لك بإنشاء طلب لعميل غير معين في قائمتك', 'CUSTOMER_NOT_ASSIGNED_TO_REP');
      }
    }

    const resolvedItems = [];
    let totalAmount = 0;
    for (const item of rawItems) {
      const qty = round3(item.quantity);
      if (!item.productId || qty <= 0) {
        throw new AppError(400, 'بيانات الأصناف أو الكميات غير صالحة', 'INVALID_ORDER_ITEM');
      }
      const prod = db.products.find((p) => p.id === item.productId && p.status === 'active');
      if (!prod) {
        throw new AppError(404, `الصنف غير متاح أو غير نشط (${item.productName || item.productId})`, 'PRODUCT_UNAVAILABLE');
      }
      const unitName = String(item.unit || prod.baseUnit);
      const unitPrice = round2(item.unitPrice ?? getUnitSellingPrice(prod, unitName));
      totalAmount = round2(totalAmount + qty * unitPrice);
      resolvedItems.push({
        productId: prod.id,
        productCode: prod.code,
        productName: prod.name,
        unit: unitName,
        unitFactor: getUnitFactor(prod, unitName),
        quantity: qty,
        unitPrice,
      });
    }

    const seqNum = nextJsonSequence(db, 'customerOrderNo', db.customerItemOrders, 'requestNumber', /(\d+)$/);
    const requestNumber = `COR-${String(seqNum).padStart(5, '0')}`;

    const newOrder = {
      id: orderId,
      requestNumber,
      customerId: cust.id,
      userId: actor.id,
      requesterType,
      representativeId: repInfo?.id || undefined,
      representativeName: repInfo?.name || undefined,
      submittedByName: isRep ? repInfo?.name || actor.fullName : cust.name,
      customerName: cust.name,
      customerPhone: String(payload.customerPhone || cust.phone || '').trim(),
      shopName: String(payload.shopName || cust.shopName || '').trim(),
      deliveryAddress: String(payload.deliveryAddress || cust.address || '').trim(),
      geoCoordinates: String(payload.geoCoordinates || cust.geoCoordinates || '').trim(),
      items: resolvedItems,
      totalAmount,
      advancePaidAmount: 0,
      remainingAmount: totalAmount,
      status: 'pending',
      notes: String(payload.notes || '').trim(),
      idempotencyKey: idempotencyKey || undefined,
      originDeviceId: originDeviceId || undefined,
      version: 1,
      statusHistory: [
        {
          id: generateServerId('OSH'),
          fromStatus: null,
          toStatus: 'pending',
          changedByName: actor.fullName,
          reason: isRep ? 'إنشاء طلب عبر المندوب' : 'إنشاء طلب جديد من العميل',
          changedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    db.customerItemOrders.unshift(newOrder);
    return { order: newOrder, deduplicated: false };
  });

  if (!result.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إرسال طلب جديد (${result.order.requestNumber})`,
      module: 'طلبات العملاء',
      recordId: result.order.id,
    });
  }
  return result;
}

export async function reviewCustomerOrder(orderId, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      if (row.status === 'under_review') {
        const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
        const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
        return mapPgOrderRow(row, itemsRes.rows, histRes.rows);
      }
      if (row.status !== 'pending') {
        throw new AppError(409, `لا يمكن وضع طلب بحالة (${row.status}) قيد المراجعة`, 'INVALID_ORDER_TRANSITION');
      }

      await client.query(
        `UPDATE customer_item_orders SET status = 'under_review', reviewed_by = $1, reviewed_by_user_id = $2, reviewed_at = $3, version = COALESCE(version, 1) + 1, updated_at = $3 WHERE id = $4`,
        [actor.fullName, actor.id, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,$3,'under_review',$4,$5,$6,$7)`,
        [generateServerId('OSH'), orderId, row.status, actor.id, actor.fullName, 'بدء مراجعة الطلب من الإدارة', now]
      );
      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return mapPgOrderRow(updated.rows[0], itemsRes.rows, histRes.rows);
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `بدء مراجعة الطلب (${order.requestNumber})`,
      module: 'طلبات العملاء',
      recordId: orderId,
    });
    return order;
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    if (ord.status === 'under_review') return ord;
    if (ord.status !== 'pending') {
      throw new AppError(409, `لا يمكن وضع طلب بحالة (${ord.status}) قيد المراجعة`, 'INVALID_ORDER_TRANSITION');
    }
    const prevStatus = ord.status;
    ord.status = 'under_review';
    ord.reviewedBy = actor.fullName;
    ord.reviewedAt = now;
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: 'under_review',
      changedByName: actor.fullName,
      reason: 'بدء مراجعة الطلب من الإدارة',
      changedAt: now,
    });
    return ord;
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `بدء مراجعة الطلب (${order.requestNumber})`,
    module: 'طلبات العملاء',
    recordId: orderId,
  });
  return order;
}

export async function approveCustomerOrder(orderId, { notes = '' } = {}, actor) {
  const now = nowIso();
  const approvable = new Set(['pending', 'under_review', 'needs_review']);
  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      if (row.status === 'approved') {
        throw new AppError(409, 'تمت الموافقة على هذا الطلب مسبقًا (منع الاعتماد المكرر)', 'ORDER_ALREADY_APPROVED');
      }
      if (!approvable.has(row.status)) {
        throw new AppError(409, `لا يمكن قبول طلب بحالة (${row.status})`, 'INVALID_ORDER_TRANSITION');
      }

      const prevStatus = row.status;
      await client.query(
        `UPDATE customer_item_orders SET status = 'approved', reviewed_by = $1, reviewed_by_user_id = $2, reviewed_at = $3, version = COALESCE(version, 1) + 1, updated_at = $3 WHERE id = $4`,
        [actor.fullName, actor.id, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,$3,'approved',$4,$5,$6,$7)`,
        [generateServerId('OSH'), orderId, prevStatus, actor.id, actor.fullName, notes || 'اعتماد الطلب من الإدارة (بدون إنشاء فاتورة أو خصم مخزون)', now]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return mapPgOrderRow(updated.rows[0], itemsRes.rows, histRes.rows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `الموافقة على طلب العميل (${order.requestNumber})`,
      module: 'طلبات العملاء',
      recordId: orderId,
    });
    return order;
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    if (ord.status === 'approved') throw new AppError(409, 'تمت الموافقة على هذا الطلب مسبقًا', 'ORDER_ALREADY_APPROVED');
    if (!approvable.has(ord.status)) throw new AppError(409, `لا يمكن قبول طلب بحالة (${ord.status})`, 'INVALID_ORDER_TRANSITION');

    const prevStatus = ord.status;
    ord.status = 'approved';
    ord.reviewedBy = actor.fullName;
    ord.reviewedAt = now;
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: 'approved',
      changedByName: actor.fullName,
      reason: notes || 'اعتماد الطلب من الإدارة (بدون إنشاء فاتورة أو خصم مخزون)',
      changedAt: now,
    });
    return ord;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `الموافقة على طلب العميل (${order.requestNumber})`,
    module: 'طلبات العملاء',
    recordId: orderId,
  });
  return order;
}

export async function rejectCustomerOrder(orderId, { reason }, actor) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    throw new AppError(400, 'يجب إدخال سبب واضح لرفض طلب العميل', 'REJECTION_REASON_REQUIRED');
  }
  const now = nowIso();

  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      if (row.status === 'invoiced') throw new AppError(409, 'لا يمكن رفض طلب تم تحويله لفاتورة مبيعات بالفعل', 'ORDER_ALREADY_INVOICED');
      if (row.status === 'rejected') throw new AppError(409, 'الطلب مرفوض بالفعل', 'ORDER_ALREADY_REJECTED');

      const prevStatus = row.status;
      await client.query(
        `UPDATE customer_item_orders SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_by_user_id = $3, reviewed_at = $4, version = COALESCE(version, 1) + 1, updated_at = $4 WHERE id = $5`,
        [cleanReason, actor.fullName, actor.id, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,$3,'rejected',$4,$5,$6,$7)`,
        [generateServerId('OSH'), orderId, prevStatus, actor.id, actor.fullName, cleanReason, now]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return mapPgOrderRow(updated.rows[0], itemsRes.rows, histRes.rows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `رفض طلب العميل (${order.requestNumber})`,
      module: 'طلبات العملاء',
      recordId: orderId,
      notes: cleanReason,
    });
    return order;
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    if (ord.status === 'invoiced') throw new AppError(409, 'لا يمكن رفض طلب تم تحويله لفاتورة بالفعل', 'ORDER_ALREADY_INVOICED');
    if (ord.status === 'rejected') throw new AppError(409, 'الطلب مرفوض بالفعل', 'ORDER_ALREADY_REJECTED');

    const prevStatus = ord.status;
    ord.status = 'rejected';
    ord.rejectionReason = cleanReason;
    ord.reviewedBy = actor.fullName;
    ord.reviewedAt = now;
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: 'rejected',
      changedByName: actor.fullName,
      reason: cleanReason,
      changedAt: now,
    });
    return ord;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `رفض طلب العميل (${order.requestNumber})`,
    module: 'طلبات العملاء',
    recordId: orderId,
    notes: cleanReason,
  });
  return order;
}

export async function assignOrderDeliveryRep(orderId, payload = {}, actor) {
  const repId = String(payload.representativeId || payload.repId || '').trim();
  const notes = String(payload.notes || '').trim();
  if (!repId) throw new AppError(400, 'يرجى تحديد المندوب المكلف بالتوصيل', 'REP_REQUIRED');
  const now = nowIso();
  const blockedStatuses = new Set(['rejected', 'cancelled', 'invoiced']);

  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      if (blockedStatuses.has(row.status)) {
        throw new AppError(409, `لا يمكن تعيين مندوب توصيل لطلب بحالة (${row.status})`, 'INVALID_ORDER_TRANSITION');
      }

      const repRes = await client.query(`SELECT id, name FROM representatives WHERE id = $1 LIMIT 1`, [repId]);
      const rep = repRes.rows[0];
      if (!rep) throw new AppError(404, 'المندوب المختار غير موجود', 'REP_NOT_FOUND');

      const prevStatus = row.status;
      await client.query(
        `UPDATE customer_item_orders SET status = 'rep_assigned', delivery_rep_id = $1, delivery_rep_name = $2, assigned_at = $3, delivery_notes = COALESCE(NULLIF($4, ''), delivery_notes), reviewed_by = COALESCE(reviewed_by, $5), reviewed_by_user_id = COALESCE(reviewed_by_user_id, $6), reviewed_at = COALESCE(reviewed_at, $3), version = COALESCE(version, 1) + 1, updated_at = $3 WHERE id = $7`,
        [rep.id, rep.name, now, String(notes || '').trim(), actor.fullName, actor.id, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,$3,'rep_assigned',$4,$5,$6,$7)`,
        [
          generateServerId('OSH'),
          orderId,
          prevStatus,
          actor.id,
          actor.fullName,
          `تعيين مندوب التوصيل: ${rep.name}${notes ? ` (${notes})` : ''}`,
          now,
        ]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return mapPgOrderRow(updated.rows[0], itemsRes.rows, histRes.rows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تعيين المندوب (${order.deliveryRepName}) لتوصيل الطلب (${order.requestNumber})`,
      module: 'طلبات العملاء',
      recordId: orderId,
    });
    return order;
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    if (blockedStatuses.has(ord.status)) {
      throw new AppError(409, `لا يمكن تعيين مندوب توصيل لطلب بحالة (${ord.status})`, 'INVALID_ORDER_TRANSITION');
    }
    const rep = (db.representatives || []).find((r) => r.id === repId);
    if (!rep) throw new AppError(404, 'المندوب المختار غير موجود', 'REP_NOT_FOUND');

    const prevStatus = ord.status;
    ord.status = 'rep_assigned';
    ord.deliveryRepId = rep.id;
    ord.deliveryRepName = rep.name;
    ord.assignedAt = now;
    if (notes && String(notes).trim()) ord.deliveryNotes = String(notes).trim();
    ord.reviewedBy = ord.reviewedBy || actor.fullName;
    ord.reviewedAt = ord.reviewedAt || now;
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: 'rep_assigned',
      changedByName: actor.fullName,
      reason: `تعيين مندوب التوصيل: ${rep.name}${notes ? ` (${notes})` : ''}`,
      changedAt: now,
    });
    return ord;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تعيين المندوب (${order.deliveryRepName}) لتوصيل الطلب (${order.requestNumber})`,
    module: 'طلبات العملاء',
    recordId: orderId,
  });
  return order;
}

export async function updateOrderDeliveryStatus(orderId, payload = {}, actorOrAuth) {
  const actor = actorOrAuth?.user ? actorOrAuth.user : actorOrAuth;
  const targetStatus = String(payload.status || '').trim();
  const allowedTargets = new Set(['out_for_delivery', 'delivered', 'needs_review']);
  if (!allowedTargets.has(targetStatus)) {
    throw new AppError(400, 'حالة التوصيل المطلوبة غير صالحة', 'INVALID_DELIVERY_STATUS');
  }
  const deliveryNotes = String(payload.deliveryNotes || '').trim();
  const deliveryProof = String(payload.deliveryProof || '').trim();
  const hasCollected = payload.collectedAmount !== undefined && payload.collectedAmount !== null && payload.collectedAmount !== '';
  const collectedAmount = hasCollected ? round2(Number(payload.collectedAmount || 0)) : null;
  const now = nowIso();

  const isRep = actor.role === 'representative';
  const repProfile = actorOrAuth?.representativeProfile || (isRep ? await getRepresentativeByUserId(actor.id) : null);
  const canManageSales = actor.role === 'admin' || Boolean(actor.permissions?.canManageSales);

  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');

      if (isRep) {
        if (!repProfile || (row.delivery_rep_id !== repProfile.id && row.representative_id !== repProfile.id)) {
          throw new AppError(403, 'غير مصرح لك بتحديث حالة طلب غير مكلف به', 'FORBIDDEN_ORDER_ACCESS');
        }
      } else if (!canManageSales) {
        throw new AppError(403, 'ليس لديك صلاحية تحديث حالة توصيل الطلب', 'FORBIDDEN');
      }

      if (['rejected', 'cancelled', 'invoiced'].includes(row.status)) {
        throw new AppError(409, `لا يمكن تغيير حالة التوصيل لطلب بحالة (${row.status})`, 'INVALID_ORDER_TRANSITION');
      }

      const prevStatus = row.status;
      const deliveredAt = targetStatus === 'delivered' ? now : row.delivered_at;
      const nextCollected = collectedAmount !== null ? collectedAmount : Number(row.collected_amount || 0);

      await client.query(
        `UPDATE customer_item_orders SET status = $1, delivered_at = $2, collected_amount = $3, delivery_notes = COALESCE(NULLIF($4, ''), delivery_notes), delivery_proof = COALESCE(NULLIF($5, ''), delivery_proof), version = COALESCE(version, 1) + 1, updated_at = $6 WHERE id = $7`,
        [targetStatus, deliveredAt, nextCollected, deliveryNotes, deliveryProof, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          generateServerId('OSH'),
          orderId,
          prevStatus,
          targetStatus,
          actor.id,
          actor.fullName,
          deliveryNotes || (targetStatus === 'delivered' ? 'تأكيد تسليم الطلب ميدانياً' : targetStatus === 'out_for_delivery' ? 'خروج المندوب للتوصيل' : 'تحويل الطلب للمراجعة'),
          now,
        ]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return mapPgOrderRow(updated.rows[0], itemsRes.rows, histRes.rows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث حالة التوصيل للطلب (${order.requestNumber}) -> ${targetStatus}`,
      module: 'طلبات العملاء',
      recordId: orderId,
    });
    return order;
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');

    if (isRep) {
      if (!repProfile || (ord.deliveryRepId !== repProfile.id && ord.representativeId !== repProfile.id)) {
        throw new AppError(403, 'غير مصرح لك بتحديث حالة طلب غير مكلف به', 'FORBIDDEN_ORDER_ACCESS');
      }
    } else if (!canManageSales) {
      throw new AppError(403, 'ليس لديك صلاحية تحديث حالة توصيل الطلب', 'FORBIDDEN');
    }

    if (['rejected', 'cancelled', 'invoiced'].includes(ord.status)) {
      throw new AppError(409, `لا يمكن تغيير حالة التوصيل لطلب بحالة (${ord.status})`, 'INVALID_ORDER_TRANSITION');
    }

    const prevStatus = ord.status;
    ord.status = targetStatus;
    if (targetStatus === 'delivered') ord.deliveredAt = now;
    if (collectedAmount !== null) ord.collectedAmount = collectedAmount;
    if (deliveryNotes) ord.deliveryNotes = deliveryNotes;
    if (deliveryProof) ord.deliveryProof = deliveryProof;
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: targetStatus,
      changedByName: actor.fullName,
      reason:
        deliveryNotes ||
        (targetStatus === 'delivered'
          ? 'تأكيد تسليم الطلب ميدانياً'
          : targetStatus === 'out_for_delivery'
          ? 'خروج المندوب للتوصيل'
          : 'تحويل الطلب للمراجعة'),
      changedAt: now,
    });
    return ord;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحديث حالة التوصيل للطلب (${order.requestNumber}) -> ${targetStatus}`,
    module: 'طلبات العملاء',
    recordId: orderId,
  });
  return order;
}

export async function recordOrderAdvancePayment(orderId, payload = {}, actor, idempotencyKey = '') {
  const amount = round2(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(400, 'مبلغ الدفعة المقدمة يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  }
  const cleanMethod = ['cash', 'bank', 'cheque'].includes(String(payload.paymentMethod || ''))
    ? String(payload.paymentMethod)
    : 'cash';
  const methodLabel = cleanMethod === 'bank' ? 'تحويل بنكي' : cleanMethod === 'cheque' ? 'شيك' : 'نقدي';
  const notes = String(payload.notes || '').trim();
  const payDate = payload.date || todayIso();
  const originDeviceId = payload.originDeviceId ? String(payload.originDeviceId).slice(0, 128) : null;
  const now = nowIso();
  const endpoint = `POST /api/orders/${orderId}/advance-payment`;
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  const isRep = actor.role === 'representative';
  const canStaffFinance =
    actor.role === 'admin' || Boolean(actor.permissions?.canManageSales) || Boolean(actor.permissions?.canManageAccounts);

  if (!isRep && !canStaffFinance) {
    throw new AppError(403, 'ليس لديك صلاحية تسجيل دفعة مقدمة على الطلب', 'FORBIDDEN');
  }

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const dup = await findPgIdempotency(client, scopedIdem);
      if (dup?.advancePayment) return { deduplicated: true, ...dup };

      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');

      if (isRep) {
        const repProfile = await getRepresentativeByUserId(actor.id);
        const custCheck = await client.query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [row.customer_id]);
        const { mapPgCustomerRow } = await import('./mode.js');
        const custObj = custCheck.rows[0] ? mapPgCustomerRow(custCheck.rows[0]) : null;
        const assigned = repProfile && (row.delivery_rep_id === repProfile.id || row.representative_id === repProfile.id || (custObj && isCustomerAllowedForRep(custObj, repProfile.id)));
        if (!assigned) {
          throw new AppError(403, 'غير مصرح لك بتسجيل دفعة مقدمة لطلب عميل غير معين لك', 'FORBIDDEN_ORDER_ACCESS');
        }
      }

      if (['rejected', 'cancelled', 'invoiced'].includes(row.status)) {
        throw new AppError(409, `لا يمكن تسجيل دفعة مقدمة على طلب بحالة (${row.status})`, 'INVALID_ORDER_TRANSITION');
      }

      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const itemsTotal = itemsRes.rows.reduce(
        (s, it) => s + Number(it.quantity || 0) * Number(it.reference_unit_price || 0),
        0
      );
      const orderTotal = round2(Number(row.total_amount || itemsTotal || 0));
      const curAdvance = round2(Number(row.advance_paid_amount || 0));
      if (orderTotal > 0 && round2(curAdvance + amount) > round2(orderTotal + 0.01)) {
        throw new AppError(
          409,
          `إجمالي الدفعات المقدمة (${round2(curAdvance + amount)}) يتجاوز إجمالي قيمة الطلب (${orderTotal})`,
          'EXCEEDS_ORDER_TOTAL'
        );
      }

      let cbRow = null;
      if (payload.cashboxId) {
        const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [payload.cashboxId]);
        cbRow = cbRes.rows[0];
      } else {
        const cbDef = await client.query(`SELECT * FROM cashboxes WHERE is_default = TRUE LIMIT 1 FOR UPDATE`);
        cbRow = cbDef.rows[0] || (await client.query(`SELECT * FROM cashboxes LIMIT 1 FOR UPDATE`)).rows[0];
      }
      if (!cbRow) throw new AppError(404, 'الخزينة المحددة غير موجودة', 'CASHBOX_NOT_FOUND');

      const custRes = await client.query(`SELECT * FROM customers WHERE id = $1 FOR UPDATE`, [row.customer_id]);
      const cust = custRes.rows[0];
      if (!cust) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');

      const seqRes = await client.query(`SELECT nextval('seq_order_advance_no') AS n`);
      const advNum = `ADV-${String(Number(seqRes.rows[0]?.n || 1)).padStart(5, '0')}`;
      const advId = generateServerId('ADV');

      await client.query(
        `INSERT INTO order_advance_payments (id, advance_number, order_id, request_number, customer_id, customer_name, amount, date, payment_method, cashbox_id, cashbox_name, status, notes, origin_device_id, idempotency_key, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'available',$12,$13,$14,$15,$16)`,
        [advId, advNum, orderId, row.request_number, cust.id, cust.name, amount, payDate, cleanMethod, cbRow.id, cbRow.name, notes, originDeviceId, idempotencyKey || null, actor.fullName, now]
      );

      const nextCbBalance = round2(Number(cbRow.current_balance || 0) + amount);
      await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCbBalance, cbRow.id]);

      const nextCustBalance = round2(Number(cust.current_balance || 0) - amount);
      await client.query(`UPDATE customers SET current_balance = $1, version = COALESCE(version, 1) + 1, updated_at = $2 WHERE id = $3`, [
        nextCustBalance,
        now,
        cust.id,
      ]);

      const nextOrdAdvance = round2(curAdvance + amount);
      await client.query(
        `UPDATE customer_item_orders SET advance_paid_amount = $1, version = COALESCE(version, 1) + 1, updated_at = $2 WHERE id = $3`,
        [nextOrdAdvance, now, orderId]
      );

      const ftId = generateServerId('FT');
      const ftNum = `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
      const desc = `دفعة مقدمة (${methodLabel}) على طلب رقم ${row.request_number} (رصيد دائن قبل الفوترة)`;
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_type, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, notes, created_by, created_at)
         VALUES ($1,$2,$3,'customer_payment',$4,$5,$6,$7,$8,'customer',$9,$10,'order_advance',$11,$12,$13,$14,$15,$16)`,
        [ftId, ftNum, payDate, amount, cbRow.id, cbRow.name, nextCbBalance, `دفعة مقدمة على طلب (${methodLabel})`, cust.id, cust.name, orderId, row.request_number, desc, notes, actor.fullName, now]
      );

      const advRes = await client.query(`SELECT * FROM order_advance_payments WHERE id = $1`, [advId]);
      const ordUpd = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      const payloadOut = {
        advancePayment: mapPgOrderAdvanceRow(advRes.rows[0]),
        order: mapPgOrderRow(ordUpd.rows[0], itemsRes.rows, histRes.rows),
        cashboxBalance: nextCbBalance,
        customerBalance: nextCustBalance,
        transactionId: ftId,
      };
      await savePgIdempotency(client, scopedIdem, actor, endpoint, payloadOut);
      return { deduplicated: false, ...payloadOut };
    });

    if (!out.deduplicated) {
      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `تسجيل دفعة مقدمة (${amount}) على الطلب (${out.order.requestNumber})`,
        module: 'طلبات العملاء',
        recordId: orderId,
      });
    }
    return out;
  }

  // JSON Ledger fallback
  const out = await withJsonTransaction(async (db) => {
    const dup = findJsonIdempotency(scopedIdem);
    if (dup?.advancePayment) return { deduplicated: true, ...dup };

    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');

    const cust = db.customers.find((c) => c.id === ord.customerId);
    if (!cust) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');

    if (isRep) {
      const repProfile = (db.representatives || []).find((r) => r.userId === actor.id);
      const assigned =
        repProfile &&
        (ord.deliveryRepId === repProfile.id || ord.representativeId === repProfile.id || isCustomerAllowedForRep(cust, repProfile.id));
      if (!assigned) {
        throw new AppError(403, 'غير مصرح لك بتسجيل دفعة مقدمة لطلب عميل غير معين لك', 'FORBIDDEN_ORDER_ACCESS');
      }
    }

    if (['rejected', 'cancelled', 'invoiced'].includes(ord.status)) {
      throw new AppError(409, `لا يمكن تسجيل دفعة مقدمة على طلب بحالة (${ord.status})`, 'INVALID_ORDER_TRANSITION');
    }

    const itemsTotal = (ord.items || []).reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
    const orderTotal = round2(Number(ord.totalAmount || itemsTotal || 0));
    const curAdvance = round2(Number(ord.advancePaidAmount || 0));
    if (orderTotal > 0 && round2(curAdvance + amount) > round2(orderTotal + 0.01)) {
      throw new AppError(
        409,
        `إجمالي الدفعات المقدمة (${round2(curAdvance + amount)}) يتجاوز إجمالي قيمة الطلب (${orderTotal})`,
        'EXCEEDS_ORDER_TOTAL'
      );
    }

    const cb = (payload.cashboxId ? db.cashboxes.find((c) => c.id === payload.cashboxId) : null) || db.cashboxes.find((c) => c.isDefault) || db.cashboxes[0];
    if (!cb) throw new AppError(404, 'الخزينة المحددة غير موجودة', 'CASHBOX_NOT_FOUND');

    db.orderAdvancePayments = db.orderAdvancePayments || [];
    const seqNum = nextJsonSequence(db, 'orderAdvanceNo', db.orderAdvancePayments, 'advanceNumber', /(\d+)$/);
    const advNum = `ADV-${String(seqNum).padStart(5, '0')}`;
    const advId = generateServerId('ADV');

    const advRecord = {
      id: advId,
      paymentNumber: advNum,
      advanceNumber: advNum,
      orderId,
      requestNumber: ord.requestNumber,
      customerId: cust.id,
      customerName: cust.name,
      amount,
      date: payDate,
      paymentMethod: cleanMethod,
      cashboxId: cb.id,
      cashboxName: cb.name,
      status: 'available',
      notes,
      originDeviceId: originDeviceId || undefined,
      createdBy: actor.fullName,
      createdAt: now,
    };
    db.orderAdvancePayments.unshift(advRecord);

    cb.currentBalance = round2(Number(cb.currentBalance || 0) + amount);
    cust.currentBalance = round2(Number(cust.currentBalance || 0) - amount);
    cust.version = Number(cust.version || 1) + 1;
    ord.advancePaidAmount = round2(curAdvance + amount);
    ord.remainingAmount = round2(Math.max(0, orderTotal - ord.advancePaidAmount));
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;

    const ftId = generateServerId('FT');
    const ftNum = `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
    const desc = `دفعة مقدمة (${methodLabel}) على طلب رقم ${ord.requestNumber} (رصيد دائن قبل الفوترة)`;
    db.financialTransactions.unshift({
      id: ftId,
      transactionNumber: ftNum,
      date: payDate,
      type: 'customer_payment',
      cashboxId: cb.id,
      cashboxName: cb.name,
      balanceAfter: cb.currentBalance,
      amount,
      paymentMethod: cleanMethod,
      category: `دفعة مقدمة على طلب (${methodLabel})`,
      relatedDocType: 'order_advance',
      relatedDocId: orderId,
      relatedDocNumber: ord.requestNumber,
      relatedEntityId: cust.id,
      partyId: cust.id,
      partyName: cust.name,
      description: desc,
      notes,
      createdBy: actor.fullName,
      createdAt: now,
    });

    const payloadOut = {
      advancePayment: advRecord,
      order: ord,
      cashboxBalance: cb.currentBalance,
      customerBalance: cust.currentBalance,
      transactionId: ftId,
    };
    saveJsonIdempotency(scopedIdem, payloadOut);
    return { deduplicated: false, ...payloadOut };
  });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تسجيل دفعة مقدمة (${amount}) على الطلب (${out.order.requestNumber})`,
      module: 'طلبات العملاء',
      recordId: orderId,
    });
  }
  return out;
}

const CONVERTIBLE_ORDER_STATUSES = new Set(['approved', 'rep_assigned', 'out_for_delivery', 'delivered', 'needs_review']);

export async function convertOrderToInvoice(orderId, invoicePayload, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const ord = ordRes.rows[0];
      if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      if (ord.status === 'invoiced' || ord.invoice_id) {
        throw new AppError(409, `تم تحويل هذا الطلب إلى فاتورة مسبقًا (${ord.invoice_number || ord.invoice_id})`, 'ORDER_ALREADY_INVOICED');
      }
      if (!CONVERTIBLE_ORDER_STATUSES.has(ord.status)) {
        throw new AppError(409, 'يجب الموافقة على الطلب أولاً قبل تحويله إلى فاتورة مبيعات', 'ORDER_NOT_APPROVED');
      }

      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const orderItems = itemsRes.rows;

      const itemsForInvoice =
        Array.isArray(invoicePayload.items) && invoicePayload.items.length > 0
          ? invoicePayload.items
          : orderItems.map((it) => ({
              productId: it.product_id,
              productName: it.product_name,
              unit: it.unit,
              unitFactor: Number(it.unit_factor || 1),
              quantity: Number(it.quantity),
              unitPrice: Number(it.reference_unit_price || 0),
              discount: 0,
            }));

      // Sum available advance payments recorded on this order
      const advRes = await client.query(
        `SELECT id, amount FROM order_advance_payments WHERE order_id = $1 AND status = 'available' FOR UPDATE`,
        [orderId]
      );
      const availableAdvance = round2(advRes.rows.reduce((s, r) => s + Number(r.amount || 0), 0));

      const itemSub = itemsForInvoice.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
      const prelimGrand = round2(Math.max(0, itemSub - Number(invoicePayload.discountTotal || 0) + Number(invoicePayload.taxTotal || 0)));
      const appliedAdvanceAmount = round2(Math.min(prelimGrand, availableAdvance));

      let totalPaidInput;
      const explicitNewCash =
        invoicePayload.newCashPaid !== undefined
          ? invoicePayload.newCashPaid
          : invoicePayload.paidAtInvoice;
      if (explicitNewCash !== undefined) {
        totalPaidInput = round2(appliedAdvanceAmount + Math.max(0, Number(explicitNewCash || 0)));
      } else if (invoicePayload.paidAmount !== undefined && invoicePayload._includesAppliedAdvance) {
        totalPaidInput = round2(Math.max(appliedAdvanceAmount, Number(invoicePayload.paidAmount || 0)));
      } else {
        const cashOnTop =
          invoicePayload.paymentType === 'cash'
            ? Math.max(0, prelimGrand - appliedAdvanceAmount)
            : round2(Math.max(0, Number(invoicePayload.paidAmount || 0)));
        totalPaidInput = round2(appliedAdvanceAmount + cashOnTop);
      }

      const invoice = await createInvoiceInsidePgTx(
        client,
        'sales',
        {
          ...invoicePayload,
          customerId: ord.customer_id,
          items: itemsForInvoice,
          appliedAdvanceAmount,
          paidAmount: totalPaidInput,
          linkedCustomerOrderId: ord.id,
          notes: invoicePayload.notes || `فاتورة محولة من طلب العميل رقم ${ord.request_number}`,
        },
        actor
      );

      if (appliedAdvanceAmount > 0 && advRes.rows.length > 0 && invoice.status === 'confirmed') {
        await client.query(
          `UPDATE order_advance_payments SET status = 'applied', applied_invoice_id = $1, applied_invoice_number = $2, applied_at = $3 WHERE order_id = $4 AND status = 'available'`,
          [invoice.id, invoice.invoiceNumber, now, orderId]
        );
      }

      const prevStatus = ord.status;
      await client.query(
        `UPDATE customer_item_orders SET status = 'invoiced', invoice_id = $1, invoice_number = $2, reviewed_by = COALESCE(reviewed_by, $3), reviewed_by_user_id = COALESCE(reviewed_by_user_id, $4), reviewed_at = COALESCE(reviewed_at, $5), version = COALESCE(version, 1) + 1, updated_at = $5 WHERE id = $6`,
        [invoice.id, invoice.invoiceNumber, actor.fullName, actor.id, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,$3,'invoiced',$4,$5,$6,$7)`,
        [
          generateServerId('OSH'),
          orderId,
          prevStatus,
          actor.id,
          actor.fullName,
          `تحويل الطلب إلى فاتورة مبيعات رقم ${invoice.invoiceNumber} (${invoice.status === 'draft' ? 'مسودة' : 'معتمدة'})${appliedAdvanceAmount > 0 ? ` مع تطبيق دفعة مقدمة بقيمة ${appliedAdvanceAmount}` : ''}`,
          now,
        ]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return { order: mapPgOrderRow(updated.rows[0], orderItems, histRes.rows), invoice };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحويل طلب العميل (${result.order.requestNumber}) إلى فاتورة (${result.invoice.invoiceNumber})`,
      module: 'طلبات العملاء',
      recordId: orderId,
    });
    return result;
  }

  // JSON Ledger fallback
  const result = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    if (ord.status === 'invoiced' || ord.invoiceId) {
      throw new AppError(409, `تم تحويل هذا الطلب إلى فاتورة مسبقًا (${ord.invoiceNumber || ord.invoiceId})`, 'ORDER_ALREADY_INVOICED');
    }
    if (!CONVERTIBLE_ORDER_STATUSES.has(ord.status)) {
      throw new AppError(409, 'يجب الموافقة على الطلب أولاً قبل تحويله إلى فاتورة مبيعات', 'ORDER_NOT_APPROVED');
    }

    const itemsForInvoice =
      Array.isArray(invoicePayload.items) && invoicePayload.items.length > 0
        ? invoicePayload.items
        : ord.items.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            unit: it.unit,
            unitFactor: Number(it.unitFactor || 1),
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice || 0),
            discount: 0,
          }));

    const availableAdvances = (db.orderAdvancePayments || []).filter(
      (a) => a.orderId === orderId && a.status === 'available'
    );
    const availableAdvance = round2(availableAdvances.reduce((s, a) => s + Number(a.amount || 0), 0));
    const itemSub = itemsForInvoice.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
    const prelimGrand = round2(Math.max(0, itemSub - Number(invoicePayload.discountTotal || 0) + Number(invoicePayload.taxTotal || 0)));
    const appliedAdvanceAmount = round2(Math.min(prelimGrand, availableAdvance));

    let totalPaidInput;
    const explicitNewCash =
      invoicePayload.newCashPaid !== undefined
        ? invoicePayload.newCashPaid
        : invoicePayload.paidAtInvoice;
    if (explicitNewCash !== undefined) {
      totalPaidInput = round2(appliedAdvanceAmount + Math.max(0, Number(explicitNewCash || 0)));
    } else if (invoicePayload.paidAmount !== undefined && invoicePayload._includesAppliedAdvance) {
      totalPaidInput = round2(Math.max(appliedAdvanceAmount, Number(invoicePayload.paidAmount || 0)));
    } else {
      const cashOnTop =
        invoicePayload.paymentType === 'cash'
          ? Math.max(0, prelimGrand - appliedAdvanceAmount)
          : round2(Math.max(0, Number(invoicePayload.paidAmount || 0)));
      totalPaidInput = round2(appliedAdvanceAmount + cashOnTop);
    }

    const invoice = createInvoiceInsideJsonTx(
      db,
      'sales',
      {
        ...invoicePayload,
        customerId: ord.customerId,
        items: itemsForInvoice,
        appliedAdvanceAmount,
        paidAmount: totalPaidInput,
        linkedCustomerOrderId: ord.id,
        notes: invoicePayload.notes || `فاتورة محولة من طلب العميل رقم ${ord.requestNumber}`,
      },
      actor
    );

    if (appliedAdvanceAmount > 0 && invoice.status === 'confirmed') {
      for (const adv of availableAdvances) {
        adv.status = 'applied';
        adv.appliedInvoiceId = invoice.id;
        adv.appliedInvoiceNumber = invoice.invoiceNumber;
        adv.appliedAt = now;
      }
    }

    const prevStatus = ord.status;
    ord.status = 'invoiced';
    ord.invoiceId = invoice.id;
    ord.invoiceNumber = invoice.invoiceNumber;
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: 'invoiced',
      changedByName: actor.fullName,
      reason: `تحويل الطلب إلى فاتورة مبيعات رقم ${invoice.invoiceNumber} (${invoice.status === 'draft' ? 'مسودة' : 'معتمدة'})${appliedAdvanceAmount > 0 ? ` مع تطبيق دفعة مقدمة بقيمة ${appliedAdvanceAmount}` : ''}`,
      changedAt: now,
    });
    return { order: ord, invoice };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحويل طلب العميل (${result.order.requestNumber}) إلى فاتورة (${result.invoice.invoiceNumber})`,
    module: 'طلبات العملاء',
    recordId: orderId,
  });
  return result;
}

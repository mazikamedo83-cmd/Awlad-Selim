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
  round2,
  round3,
  getUnitSellingPrice,
  getUnitFactor,
} from '../../utils/errors.js';
import { isPgMode, mapPgOrderRow } from './mode.js';
import { recordAuditLog } from './authStore.js';
import { createInvoiceInsidePgTx, createInvoiceInsideJsonTx } from './invoicesStore.js';

export async function listOrders(authContext, filters = {}) {
  const isCustomer = authContext.user.role === 'customer';
  const targetCustomerId = isCustomer ? authContext.customerProfile?.id || null : filters.customerId || null;

  if (isCustomer && !targetCustomerId) {
    return [];
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

    return ordRes.rows.map((r) => mapPgOrderRow(r, itemsMap.get(r.id) || [], histMap.get(r.id) || []));
  }

  const db = readJsonDatabase();
  return db.customerItemOrders
    .filter((o) => {
      if (targetCustomerId && o.customerId !== targetCustomerId) return false;
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
  return order;
}

export async function createCustomerOrder(payload, authContext) {
  const actor = authContext.user;
  const isCustomer = actor.role === 'customer';

  // Strictly determine authoritative customerId — NEVER trust client customerId for customer accounts
  let targetCustomerId = isCustomer ? authContext.customerProfile?.id : payload.customerId;
  if (!targetCustomerId) {
    throw new AppError(
      400,
      isCustomer
        ? 'حسابك غير مربوط بملف عميل في الدليل بعد. يرجى التواصل مع الإدارة لإتمام الربط.'
        : 'يرجى تحديد العميل المطلوب إنشاء الطلب له',
      'CUSTOMER_PROFILE_REQUIRED'
    );
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0) {
    throw new AppError(400, 'يجب إضافة صنف واحد على الأقل إلى السلة', 'EMPTY_ORDER_ITEMS');
  }

  const idempotencyKey = payload.idempotencyKey ? String(payload.idempotencyKey).trim().slice(0, 128) : null;
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

      const resolvedItems = [];
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
        const referenceUnitPrice = round2(getUnitSellingPrice(prodObj, unitName));

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

      await client.query(
        `INSERT INTO customer_item_orders (id, request_number, customer_id, user_id, customer_name, customer_phone, shop_name, delivery_address, geo_coordinates, status, notes, idempotency_key, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$12)`,
        [
          orderId,
          requestNumber,
          cust.id,
          actor.id,
          cust.name,
          customerPhone,
          shopName,
          deliveryAddress,
          geoCoordinates,
          String(payload.notes || '').trim(),
          idempotencyKey,
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
        [histId, orderId, actor.id, actor.fullName, 'إنشاء طلب جديد من العميل', now]
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
        action: `إرسال طلب عميل جديد (${result.order.requestNumber})`,
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

    const resolvedItems = [];
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
      resolvedItems.push({
        productId: prod.id,
        productCode: prod.code,
        productName: prod.name,
        unit: unitName,
        unitFactor: getUnitFactor(prod, unitName),
        quantity: qty,
        unitPrice: round2(getUnitSellingPrice(prod, unitName)),
      });
    }

    const seqNum = nextJsonSequence(db, 'customerOrderNo', db.customerItemOrders, 'requestNumber', /(\d+)$/);
    const requestNumber = `COR-${String(seqNum).padStart(5, '0')}`;

    const newOrder = {
      id: orderId,
      requestNumber,
      customerId: cust.id,
      userId: actor.id,
      customerName: cust.name,
      customerPhone: String(payload.customerPhone || cust.phone || '').trim(),
      shopName: String(payload.shopName || cust.shopName || '').trim(),
      deliveryAddress: String(payload.deliveryAddress || cust.address || '').trim(),
      geoCoordinates: String(payload.geoCoordinates || cust.geoCoordinates || '').trim(),
      items: resolvedItems,
      status: 'pending',
      notes: String(payload.notes || '').trim(),
      idempotencyKey: idempotencyKey || undefined,
      statusHistory: [
        {
          id: generateServerId('OSH'),
          fromStatus: null,
          toStatus: 'pending',
          changedByName: actor.fullName,
          reason: 'إنشاء طلب جديد من العميل',
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
      action: `إرسال طلب عميل جديد (${result.order.requestNumber})`,
      module: 'طلبات العملاء',
      recordId: result.order.id,
    });
  }
  return result;
}

export async function approveCustomerOrder(orderId, { notes = '' } = {}, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      if (row.status === 'approved') {
        throw new AppError(409, 'تمت الموافقة على هذا الطلب مسبقًا (منع الاعتماد المكرر)', 'ORDER_ALREADY_APPROVED');
      }
      if (row.status !== 'pending') {
        throw new AppError(409, `لا يمكن قبول طلب بحالة (${row.status})`, 'INVALID_ORDER_TRANSITION');
      }

      await client.query(
        `UPDATE customer_item_orders SET status = 'approved', reviewed_by = $1, reviewed_by_user_id = $2, reviewed_at = $3, updated_at = $3 WHERE id = $4`,
        [actor.fullName, actor.id, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,'pending','approved',$3,$4,$5,$6)`,
        [generateServerId('OSH'), orderId, actor.id, actor.fullName, notes || 'اعتماد الطلب من الإدارة (بدون خصم مخزون)', now]
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
    if (ord.status !== 'pending') throw new AppError(409, `لا يمكن قبول طلب بحالة (${ord.status})`, 'INVALID_ORDER_TRANSITION');

    ord.status = 'approved';
    ord.reviewedBy = actor.fullName;
    ord.reviewedAt = now;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: 'pending',
      toStatus: 'approved',
      changedByName: actor.fullName,
      reason: notes || 'اعتماد الطلب من الإدارة (بدون خصم مخزون)',
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
        `UPDATE customer_item_orders SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_by_user_id = $3, reviewed_at = $4, updated_at = $4 WHERE id = $5`,
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
      if (ord.status !== 'approved') {
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

      const invoice = await createInvoiceInsidePgTx(
        client,
        'sales',
        {
          ...invoicePayload,
          customerId: ord.customer_id,
          items: itemsForInvoice,
          linkedCustomerOrderId: ord.id,
          notes: invoicePayload.notes || `فاتورة محولة من طلب العميل رقم ${ord.request_number}`,
        },
        actor
      );

      await client.query(
        `UPDATE customer_item_orders SET status = 'invoiced', invoice_id = $1, invoice_number = $2, reviewed_by = COALESCE(reviewed_by, $3), reviewed_by_user_id = COALESCE(reviewed_by_user_id, $4), reviewed_at = COALESCE(reviewed_at, $5), updated_at = $5 WHERE id = $6`,
        [invoice.id, invoice.invoiceNumber, actor.fullName, actor.id, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,'approved','invoiced',$3,$4,$5,$6)`,
        [generateServerId('OSH'), orderId, actor.id, actor.fullName, `تحويل الطلب إلى فاتورة مبيعات رقم ${invoice.invoiceNumber} (${invoice.status === 'draft' ? 'مسودة' : 'معتمدة'})`, now]
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
    if (ord.status !== 'approved') {
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

    const invoice = createInvoiceInsideJsonTx(
      db,
      'sales',
      {
        ...invoicePayload,
        customerId: ord.customerId,
        items: itemsForInvoice,
        linkedCustomerOrderId: ord.id,
        notes: invoicePayload.notes || `فاتورة محولة من طلب العميل رقم ${ord.requestNumber}`,
      },
      actor
    );

    ord.status = 'invoiced';
    ord.invoiceId = invoice.id;
    ord.invoiceNumber = invoice.invoiceNumber;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: 'approved',
      toStatus: 'invoiced',
      changedByName: actor.fullName,
      reason: `تحويل الطلب إلى فاتورة مبيعات رقم ${invoice.invoiceNumber} (${invoice.status === 'draft' ? 'مسودة' : 'معتمدة'})`,
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

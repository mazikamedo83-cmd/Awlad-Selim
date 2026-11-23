import { getPool, withTransaction } from '../postgres.js';
import {
  withJsonTransaction,
  nextJsonSequence,
  readJsonDatabase,
} from '../jsonLedger.js';
import { generateServerId } from '../../utils/crypto.js';
import { AppError, nowIso, todayIso, round2, round3, getUnitSellingPrice, getUnitFactor, canViewCashboxBalances, sanitizeInvoiceForRepresentative, buildPgInPredicate } from '../../utils/errors.js';
import {
  buildScopedIdemKey,
  findPgIdempotency,
  savePgIdempotency,
  findJsonIdempotency,
  saveJsonIdempotency,
} from '../../utils/idempotency.js';
import { isPgMode, mapPgOrderRow, mapPgCustomerRow, isoDateOnly, isoTimestamp } from './mode.js';
import { recordAuditLog } from './authStore.js';
import {
  createInvoiceInsidePgTx,
  createInvoiceInsideJsonTx,
  addInvoicePaymentPgTx,
  addInvoicePaymentJsonTx,
} from './invoicesStore.js';
import {
  getRepresentativeByUserId,
  getSystemSettingsSafe,
} from './catalogStore.js';

function normalizeStatusFilter(rawStatus) {
  const s = String(rawStatus || '').trim().toLowerCase();
  if (!s || s === 'all') return '';
  if (s === 'new') return 'pending';
  return s;
}

function enrichOrderCollection(orders, productImageMap, invoiceMap = new Map(), advPaymentsMap = new Map()) {
  return (orders || []).map((ord) => {
    const items = (ord.items || []).map((it) => ({
      ...it,
      productImage: it.productImage || productImageMap.get(it.productId) || undefined,
    }));
    const computedTotal = items.reduce(
      (sum, it) => sum + Number(it.unitPrice || 0) * Number(it.quantity || 0),
      0
    );
    const totalAmount =
      Number(ord.totalAmount || 0) > 0 ? round2(ord.totalAmount) : round2(computedTotal);
    const advancePaidAmount = round2(ord.advancePaidAmount || 0);
    const linkedInv = ord.invoiceId ? invoiceMap.get(ord.invoiceId) : null;
    const advList = advPaymentsMap.get(ord.id) || [];

    const invoiceTotal = linkedInv ? round2(linkedInv.grandTotal || totalAmount) : totalAmount;
    const invoicePaidAmount = linkedInv
      ? round2(linkedInv.paidAmount || 0)
      : round2(Math.max(advancePaidAmount, Number(ord.collectedAmount || 0)));
    const invoiceRemainingAmount = linkedInv
      ? round2(linkedInv.remainingAmount ?? Math.max(0, invoiceTotal - invoicePaidAmount))
      : Math.max(0, round2(invoiceTotal - invoicePaidAmount));
    const paymentStatus =
      invoiceTotal > 0 && invoiceRemainingAmount <= 0.009
        ? 'paid'
        : invoicePaidAmount > 0.009
        ? 'partial'
        : 'unpaid';

    const paymentsHistory = [
      ...advList.map((a) => ({
        id: a.id,
        type: 'advance',
        paymentNumber: a.paymentNumber || a.payment_number,
        amount: round2(a.amount || 0),
        date: String(a.date || '').split('T')[0],
        paymentMethod: a.paymentMethod || a.payment_method || 'cash',
        cashboxName: a.cashboxName || a.cashbox_name || '',
        notes: a.notes || 'دفعة مقدمة على الطلب',
        createdBy: a.createdBy || a.created_by || '',
        createdAt: a.createdAt || a.created_at || '',
      })),
      ...((linkedInv?.payments || []).map((p) => ({
        id: p.id,
        type: 'invoice_payment',
        paymentNumber: p.invoiceNumber || linkedInv.invoiceNumber,
        amount: round2(p.amount || 0),
        date: String(p.date || '').split('T')[0],
        paymentMethod: p.paymentMethod || 'cash',
        cashboxName: p.cashboxName || '',
        notes: p.notes || 'دفعة مسجلة على الفاتورة',
        createdBy: p.createdBy || '',
        createdAt: p.createdAt || '',
      }))),
    ].sort((a, b) => String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || '')));

    const remainingAmount = linkedInv
      ? invoiceRemainingAmount
      : Math.max(0, round2(totalAmount - advancePaidAmount));
    const requesterType =
      ord.requesterType || (ord.representativeId ? 'representative' : 'customer');
    const submittedByName =
      ord.submittedByName || ord.representativeName || ord.customerName || '';
    return {
      ...ord,
      requesterType,
      submittedByName,
      totalAmount,
      advancePaidAmount,
      remainingAmount,
      invoiceTotal,
      invoicePaidAmount,
      invoiceRemainingAmount,
      paymentStatus,
      paymentsHistory,
      items,
    };
  });
}

function matchesOrderFilters(ord, filters = {}) {
  const cleanStatus = normalizeStatusFilter(filters.status);
  if (cleanStatus && ord.status !== cleanStatus) return false;

  if (filters.requesterType && filters.requesterType !== 'all') {
    const type = ord.requesterType || (ord.representativeId ? 'representative' : 'customer');
    if (type !== filters.requesterType) return false;
  }

  const createdDay = String(ord.createdAt || '').slice(0, 10);
  if (filters.dateFrom && createdDay && createdDay < filters.dateFrom) return false;
  if (filters.dateTo && createdDay && createdDay > filters.dateTo) return false;

  if (filters.search && String(filters.search).trim()) {
    const q = String(filters.search).trim().toLowerCase();
    const haystack = [
      ord.requestNumber,
      ord.customerName,
      ord.shopName,
      ord.submittedByName,
      ord.representativeName,
      ord.customerPhone,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

export async function listOrders(authContext, filters = {}) {
  const actor = authContext.user;
  const isCustomer = actor.role === 'customer';
  const isRep = actor.role === 'representative';
  const isSalesManager = actor.role === 'admin' || Boolean(actor.permissions?.canManageSales);

  if (!isCustomer && !isRep && !isSalesManager) {
    return [];
  }

  const targetCustomerId = isCustomer ? authContext.customerProfile?.id || null : filters.customerId || null;
  if (isCustomer && !targetCustomerId) {
    return [];
  }

  let rep = null;
  if (isRep) {
    rep = authContext.representativeProfile || (await getRepresentativeByUserId(actor.id));
    if (!rep) return [];
  }

  const cleanStatus = normalizeStatusFilter(filters.status);

  if (await isPgMode()) {
    const pool = getPool();
    const params = [];
    const clauses = [];
    if (targetCustomerId) {
      params.push(targetCustomerId);
      clauses.push(`customer_id = $${params.length}`);
    }
    if (isRep) {
      params.push(actor.id);
      const userParam = `$${params.length}`;
      params.push(rep.id);
      const repParam = `$${params.length}`;
      clauses.push(`(user_id = ${userParam} OR representative_id = ${repParam} OR delivery_rep_id = ${repParam})`);
    }
    if (cleanStatus) {
      params.push(cleanStatus);
      clauses.push(`status = $${params.length}`);
    }
    if (filters.requesterType && filters.requesterType !== 'all') {
      params.push(filters.requesterType);
      clauses.push(`requester_type = $${params.length}`);
    }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const ordRes = await pool.query(`SELECT * FROM customer_item_orders ${whereSql} ORDER BY created_at DESC`, params);
    if (ordRes.rows.length === 0) return [];

    const ordIds = ordRes.rows.map((r) => r.id);
    const invIds = Array.from(new Set(ordRes.rows.map((r) => r.invoice_id).filter(Boolean)));
    const ordItemsParams = [];
    const ordItemsPred = buildPgInPredicate('order_id', ordIds, ordItemsParams);
    const ordHistParams = [];
    const ordHistPred = buildPgInPredicate('order_id', ordIds, ordHistParams);
    const ordAdvParams = [];
    const ordAdvPred = buildPgInPredicate('order_id', ordIds, ordAdvParams);
    const invParams = [];
    const invPred = invIds.length ? buildPgInPredicate('id', invIds, invParams) : '';
    const invPayParams = [];
    const invPayPred = invIds.length ? buildPgInPredicate('invoice_id', invIds, invPayParams) : '';

    const [itemsRes, histRes, prodImgRes, advPayRes, invRes, invPayRes] = await Promise.all([
      pool.query(`SELECT * FROM customer_item_order_items WHERE ${ordItemsPred}`, ordItemsParams),
      pool.query(
        `SELECT * FROM order_status_history WHERE ${ordHistPred} ORDER BY changed_at ASC`,
        ordHistParams
      ),
      pool.query(`SELECT id, image FROM products WHERE image IS NOT NULL AND image <> ''`),
      pool.query(`SELECT * FROM order_advance_payments WHERE ${ordAdvPred} ORDER BY created_at ASC`, ordAdvParams),
      invIds.length
        ? pool.query(`SELECT id, invoice_number, grand_total, paid_amount, remaining_amount FROM invoices WHERE ${invPred}`, invParams)
        : Promise.resolve({ rows: [] }),
      invIds.length
        ? pool.query(`SELECT * FROM invoice_payments WHERE ${invPayPred} ORDER BY created_at ASC`, invPayParams)
        : Promise.resolve({ rows: [] }),
    ]);

    const productImageMap = new Map();
    for (const p of prodImgRes.rows) {
      if (p.image) productImageMap.set(p.id, p.image);
    }

    const invPaymentsMap = new Map();
    for (const p of invPayRes.rows) {
      const l = invPaymentsMap.get(p.invoice_id) || [];
      l.push({
        id: p.id,
        invoiceNumber: p.invoice_number,
        amount: Number(p.amount || 0),
        date: isoDateOnly(p.date),
        paymentMethod: p.payment_method,
        cashboxName: p.cashbox_name,
        notes: p.notes || '',
        createdBy: p.created_by,
        createdAt: isoTimestamp(p.created_at),
      });
      invPaymentsMap.set(p.invoice_id, l);
    }

    const invoiceMap = new Map();
    for (const inv of invRes.rows) {
      invoiceMap.set(inv.id, {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        grandTotal: Number(inv.grand_total || 0),
        paidAmount: Number(inv.paid_amount || 0),
        remainingAmount: Number(inv.remaining_amount || 0),
        payments: invPaymentsMap.get(inv.id) || [],
      });
    }

    const advPaymentsMap = new Map();
    for (const a of advPayRes.rows) {
      const l = advPaymentsMap.get(a.order_id) || [];
      l.push({
        ...a,
        date: isoDateOnly(a.date),
        createdAt: isoTimestamp(a.created_at),
      });
      advPaymentsMap.set(a.order_id, l);
    }

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

    const list = enrichOrderCollection(
      ordRes.rows.map((r) => mapPgOrderRow(r, itemsMap.get(r.id) || [], histMap.get(r.id) || [])),
      productImageMap,
      invoiceMap,
      advPaymentsMap
    );
    return list.filter((o) => matchesOrderFilters(o, filters));
  }

  const db = readJsonDatabase();
  const productImageMap = new Map();
  for (const p of db.products || []) {
    if (p.image) productImageMap.set(p.id, p.image);
  }
  const invoiceMap = new Map((db.invoices || []).map((inv) => [inv.id, inv]));
  const advPaymentsMap = new Map();
  for (const a of db.orderAdvancePayments || []) {
    const l = advPaymentsMap.get(a.orderId) || [];
    l.push(a);
    advPaymentsMap.set(a.orderId, l);
  }

  const scoped = (db.customerItemOrders || [])
    .filter((o) => {
      if (targetCustomerId && o.customerId !== targetCustomerId) return false;
      if (isRep) {
        const ownedByRepUser =
          o.userId === actor.id ||
          (rep && (o.representativeId === rep.id || o.deliveryRepId === rep.id));
        if (!ownedByRepUser) return false;
      }
      return true;
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return enrichOrderCollection(scoped, productImageMap, invoiceMap, advPaymentsMap).filter((o) =>
    matchesOrderFilters(o, filters)
  );
}

export async function getOrderById(orderId, authContext) {
  const actor = authContext.user;
  const isCustomer = actor.role === 'customer';
  const isRep = actor.role === 'representative';
  const isSalesManager = actor.role === 'admin' || Boolean(actor.permissions?.canManageSales);

  if (!isCustomer && !isRep && !isSalesManager) {
    throw new AppError(403, 'غير مصرح لك بالوصول إلى طلبات العملاء والمندوبين', 'FORBIDDEN_ORDER_ACCESS');
  }

  if (await isPgMode()) {
    const pool = getPool();
    const ordRes = await pool.query(`SELECT * FROM customer_item_orders WHERE id = $1 LIMIT 1`, [orderId]);
    const row = ordRes.rows[0];
    if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');

    if (isCustomer && row.customer_id !== authContext.customerProfile?.id) {
      throw new AppError(403, 'غير مصرح لك بعرض طلبات عميل آخر', 'FORBIDDEN_ORDER_ACCESS');
    }
    if (isRep) {
      const rep = authContext.representativeProfile || (await getRepresentativeByUserId(actor.id));
      const ownedByRep =
        row.user_id === actor.id ||
        (rep && (row.representative_id === rep.id || row.delivery_rep_id === rep.id));
      if (!ownedByRep) {
        throw new AppError(403, 'غير مصرح لك بعرض طلبات غير مخصصة لك', 'FORBIDDEN_ORDER_ACCESS');
      }
    }

    const [itemsRes, histRes, prodImgRes, advPayRes, invRes, invPayRes] = await Promise.all([
      pool.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]),
      pool.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]),
      pool.query(`SELECT id, image FROM products WHERE image IS NOT NULL AND image <> ''`),
      pool.query(`SELECT * FROM order_advance_payments WHERE order_id = $1 ORDER BY created_at ASC`, [orderId]),
      row.invoice_id
        ? pool.query(`SELECT id, invoice_number, grand_total, paid_amount, remaining_amount FROM invoices WHERE id = $1`, [row.invoice_id])
        : Promise.resolve({ rows: [] }),
      row.invoice_id
        ? pool.query(`SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY created_at ASC`, [row.invoice_id])
        : Promise.resolve({ rows: [] }),
    ]);
    const productImageMap = new Map(prodImgRes.rows.map((p) => [p.id, p.image]));
    const invoiceMap = new Map();
    if (invRes.rows[0]) {
      const inv = invRes.rows[0];
      invoiceMap.set(inv.id, {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        grandTotal: Number(inv.grand_total || 0),
        paidAmount: Number(inv.paid_amount || 0),
        remainingAmount: Number(inv.remaining_amount || 0),
        payments: invPayRes.rows.map((p) => ({
          id: p.id,
          invoiceNumber: p.invoice_number,
          amount: Number(p.amount || 0),
          date: isoDateOnly(p.date),
          paymentMethod: p.payment_method,
          cashboxName: p.cashbox_name,
          notes: p.notes || '',
          createdBy: p.created_by,
          createdAt: isoTimestamp(p.created_at),
        })),
      });
    }
    const advPaymentsMap = new Map();
    advPaymentsMap.set(
      orderId,
      advPayRes.rows.map((a) => ({ ...a, date: isoDateOnly(a.date), createdAt: isoTimestamp(a.created_at) }))
    );
    return enrichOrderCollection(
      [mapPgOrderRow(row, itemsRes.rows, histRes.rows)],
      productImageMap,
      invoiceMap,
      advPaymentsMap
    )[0];
  }

  const db = readJsonDatabase();
  const order = db.customerItemOrders.find((o) => o.id === orderId);
  if (!order) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
  if (isCustomer && order.customerId !== authContext.customerProfile?.id) {
    throw new AppError(403, 'غير مصرح لك بعرض طلبات عميل آخر', 'FORBIDDEN_ORDER_ACCESS');
  }
  if (isRep) {
    const rep = authContext.representativeProfile || (await getRepresentativeByUserId(actor.id));
    const ownedByRep =
      order.userId === actor.id ||
      (rep && (order.representativeId === rep.id || order.deliveryRepId === rep.id));
    if (!ownedByRep) {
      throw new AppError(403, 'غير مصرح لك بعرض طلبات غير مخصصة لك', 'FORBIDDEN_ORDER_ACCESS');
    }
  }
  const productImageMap = new Map(
    (db.products || []).filter((p) => p.image).map((p) => [p.id, p.image])
  );
  const invoiceMap = new Map((db.invoices || []).map((inv) => [inv.id, inv]));
  const advPaymentsMap = new Map([
    [orderId, (db.orderAdvancePayments || []).filter((a) => a.orderId === orderId)],
  ]);
  return enrichOrderCollection([order], productImageMap, invoiceMap, advPaymentsMap)[0];
}

export async function createCustomerOrder(payload, authContext) {
  const actor = authContext.user;
  const isCustomer = actor.role === 'customer';
  const isRep = actor.role === 'representative';
  const settings = await getSystemSettingsSafe();

  if (isCustomer && settings.mobileConfig?.enableCustomerApp === false) {
    throw new AppError(403, 'استقبال طلبات العملاء من تطبيق الموبايل متوقف حاليًا من إعدادات الإدارة', 'CUSTOMER_APP_DISABLED');
  }
  if (isRep && settings.mobileConfig?.enableRepApp === false) {
    throw new AppError(403, 'بوابة المندوبين من تطبيق الموبايل متوقفة حاليًا من إعدادات الإدارة', 'REP_APP_DISABLED');
  }

  const requesterType = isCustomer ? 'customer' : isRep ? 'representative' : 'staff';

  // Strictly determine authoritative customerId — NEVER trust client customerId for customer accounts
  const targetCustomerId = isCustomer ? authContext.customerProfile?.id : payload.customerId;
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

      let repProfile = null;
      if (isRep) {
        repProfile = authContext.representativeProfile || (await getRepresentativeByUserId(actor.id));
        if (!repProfile) {
          throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
        }
      }

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
          productImage: prod.image || undefined,
          unit: unitName,
          unitFactor,
          quantity: qty,
          unitPrice: referenceUnitPrice,
        });
      }

      const totalAmount = round2(
        resolvedItems.reduce((sum, it) => sum + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0)
      );

      const seqRes = await client.query(`SELECT nextval('seq_customer_order_no') AS n`);
      const seqNum = Number(seqRes.rows[0]?.n || 1);
      const requestNumber = `COR-${String(seqNum).padStart(5, '0')}`;

      const customerPhone = String(payload.customerPhone || cust.phone || '').trim();
      const shopName = String(payload.shopName || cust.shop_name || '').trim();
      const deliveryAddress = String(payload.deliveryAddress || cust.address || cust.shop_address || '').trim();
      const geoCoordinates = String(payload.geoCoordinates || cust.geo_coordinates || cust.map_location || '').trim();
      const sourcePlatform = String(payload.sourcePlatform || 'web').slice(0, 24);
      const originDeviceId = payload.originDeviceId ? String(payload.originDeviceId).slice(0, 64) : null;

      await client.query(
        `INSERT INTO customer_item_orders (id, request_number, customer_id, user_id, requester_type, submitted_by_name, representative_id, representative_name, customer_name, customer_phone, shop_name, delivery_address, geo_coordinates, total_amount, advance_paid_amount, remaining_amount, status, source_platform, origin_device_id, sync_status, notes, idempotency_key, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,$14,'pending',$15,$16,'synced',$17,$18,$19,$19)`,
        [
          orderId,
          requestNumber,
          cust.id,
          actor.id,
          requesterType,
          actor.fullName,
          repProfile?.id || null,
          repProfile?.name || '',
          cust.name,
          customerPhone,
          shopName,
          deliveryAddress,
          geoCoordinates,
          totalAmount,
          sourcePlatform,
          originDeviceId,
          String(payload.notes || '').trim(),
          idempotencyKey,
          now,
        ]
      );

      for (const it of resolvedItems) {
        await client.query(
          `INSERT INTO customer_item_order_items (id, order_id, product_id, product_code, product_name, product_image, unit, unit_factor, quantity, reference_unit_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            it.id,
            orderId,
            it.productId,
            it.productCode,
            it.productName,
            it.productImage || null,
            it.unit,
            it.unitFactor,
            it.quantity,
            it.unitPrice,
          ]
        );
      }

      const histId = generateServerId('OSH');
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,NULL,'pending',$3,$4,$5,$6)`,
        [
          histId,
          orderId,
          actor.id,
          actor.fullName,
          isRep ? `إنشاء طلب جديد من المندوب (${repProfile?.name || actor.fullName})` : 'إنشاء طلب جديد من العميل',
          now,
        ]
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
        action: `إرسال طلب ${isRep ? 'مندوب' : 'عميل'} جديد (${result.order.requestNumber})`,
        module: 'طلبات العملاء والمندوبين',
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

    let repProfile = null;
    if (isRep) {
      repProfile = authContext.representativeProfile || (db.representatives || []).find((r) => r.userId === actor.id);
      if (!repProfile) {
        throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
      }
    }

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
        productImage: prod.image || undefined,
        unit: unitName,
        unitFactor: getUnitFactor(prod, unitName),
        quantity: qty,
        unitPrice: round2(getUnitSellingPrice(prod, unitName)),
      });
    }

    const totalAmount = round2(
      resolvedItems.reduce((sum, it) => sum + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0)
    );

    const seqNum = nextJsonSequence(db, 'customerOrderNo', db.customerItemOrders, 'requestNumber', /(\d+)$/);
    const requestNumber = `COR-${String(seqNum).padStart(5, '0')}`;

    const newOrder = {
      id: orderId,
      requestNumber,
      customerId: cust.id,
      userId: actor.id,
      requesterType,
      submittedByName: actor.fullName,
      representativeId: repProfile?.id || undefined,
      representativeName: repProfile?.name || undefined,
      customerName: cust.name,
      customerPhone: String(payload.customerPhone || cust.phone || '').trim(),
      shopName: String(payload.shopName || cust.shopName || '').trim(),
      deliveryAddress: String(payload.deliveryAddress || cust.address || '').trim(),
      geoCoordinates: String(payload.geoCoordinates || cust.geoCoordinates || '').trim(),
      totalAmount,
      advancePaidAmount: 0,
      remainingAmount: totalAmount,
      collectedAmount: 0,
      items: resolvedItems,
      status: 'pending',
      sourcePlatform: String(payload.sourcePlatform || 'web').slice(0, 24),
      originDeviceId: payload.originDeviceId || undefined,
      syncStatus: 'synced',
      version: 1,
      notes: String(payload.notes || '').trim(),
      idempotencyKey: idempotencyKey || undefined,
      statusHistory: [
        {
          id: generateServerId('OSH'),
          fromStatus: null,
          toStatus: 'pending',
          changedByName: actor.fullName,
          reason: isRep ? `إنشاء طلب جديد من المندوب (${repProfile?.name || actor.fullName})` : 'إنشاء طلب جديد من العميل',
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
      action: `إرسال طلب ${isRep ? 'مندوب' : 'عميل'} جديد (${result.order.requestNumber})`,
      module: 'طلبات العملاء والمندوبين',
      recordId: result.order.id,
    });
  }
  return result;
}

function assertPendingOrderOwnership(ord, authContext) {
  const actor = authContext.user;
  if (actor.role === 'customer') {
    const custId = authContext.customerProfile?.id;
    if (!custId || ord.customerId !== custId) {
      throw new AppError(403, 'غير مصرح لك بالوصول إلى طلب لا يخص حسابك', 'FORBIDDEN_ORDER_ACCESS');
    }
  } else if (actor.role === 'representative') {
    const repId = authContext.representativeProfile?.id;
    const isOwner = ord.userId === actor.id || (repId && ord.representativeId === repId);
    if (!isOwner) {
      throw new AppError(403, 'غير مصرح لك بتعديل أو إلغاء طلب لا يخصك', 'FORBIDDEN_ORDER_ACCESS');
    }
  } else if (actor.role !== 'admin' && !actor.permissions?.canManageSales) {
    throw new AppError(403, 'ليس لديك صلاحية تعديل هذا الطلب', 'FORBIDDEN');
  }
  if (ord.status !== 'pending') {
    throw new AppError(
      409,
      'لا يمكن تعديل أو إلغاء الطلب بعد بدء مراجعته أو اعتماده من الإدارة',
      'ORDER_ALREADY_PROCESSED'
    );
  }
}

export async function updateOwnPendingOrder(orderId, payload = {}, authContext) {
  const actor = authContext.user;
  const now = nowIso();
  const hasItems = payload.items !== undefined;
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (hasItems && rawItems.length === 0) {
    throw new AppError(400, 'يجب إضافة صنف واحد على الأقل إلى الطلب', 'EMPTY_ORDER_ITEMS');
  }

  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      assertPendingOrderOwnership(mapPgOrderRow(row, [], []), authContext);

      let nextTotalAmount = Number(row.total_amount || 0);
      let resolvedItems = null;
      if (hasItems) {
        resolvedItems = [];
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
            productImage: prod.image || undefined,
            unit: unitName,
            unitFactor,
            quantity: qty,
            unitPrice: referenceUnitPrice,
          });
        }
        nextTotalAmount = round2(
          resolvedItems.reduce((sum, it) => sum + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0)
        );
        await client.query(`DELETE FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
        for (const it of resolvedItems) {
          await client.query(
            `INSERT INTO customer_item_order_items (id, order_id, product_id, product_code, product_name, product_image, unit, unit_factor, quantity, reference_unit_price)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [it.id, orderId, it.productId, it.productCode, it.productName, it.productImage || null, it.unit, it.unitFactor, it.quantity, it.unitPrice]
          );
        }
      }

      const advancePaid = round2(row.advance_paid_amount || 0);
      const nextRemaining = Math.max(0, round2(nextTotalAmount - advancePaid));
      await client.query(
        `UPDATE customer_item_orders SET
          customer_phone = $1, shop_name = $2, delivery_address = $3, geo_coordinates = $4,
          notes = $5, total_amount = $6, remaining_amount = $7,
          version = COALESCE(version, 1) + 1, updated_at = $8
         WHERE id = $9`,
        [
          payload.customerPhone !== undefined ? String(payload.customerPhone || '').trim() : (row.customer_phone || ''),
          payload.shopName !== undefined ? String(payload.shopName || '').trim() : (row.shop_name || ''),
          payload.deliveryAddress !== undefined ? String(payload.deliveryAddress || '').trim() : (row.delivery_address || ''),
          payload.geoCoordinates !== undefined ? String(payload.geoCoordinates || '').trim() : (row.geo_coordinates || ''),
          payload.notes !== undefined ? String(payload.notes || '').trim() : (row.notes || ''),
          nextTotalAmount,
          nextRemaining,
          now,
          orderId,
        ]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,'pending','pending',$3,$4,$5,$6)`,
        [generateServerId('OSH'), orderId, actor.id, actor.fullName, 'تعديل تفاصيل الطلب قبل المراجعة', now]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return mapPgOrderRow(updated.rows[0], itemsRes.rows, histRes.rows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تعديل تفاصيل الطلب المعلق (${order.requestNumber})`,
      module: 'طلبات العملاء والمندوبين',
      recordId: orderId,
    });
    return getOrderById(orderId, authContext);
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    assertPendingOrderOwnership(ord, authContext);

    if (hasItems) {
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
          productImage: prod.image || undefined,
          unit: unitName,
          unitFactor: getUnitFactor(prod, unitName),
          quantity: qty,
          unitPrice: round2(getUnitSellingPrice(prod, unitName)),
        });
      }
      ord.items = resolvedItems;
      ord.totalAmount = round2(
        resolvedItems.reduce((sum, it) => sum + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0)
      );
      ord.remainingAmount = Math.max(0, round2(ord.totalAmount - Number(ord.advancePaidAmount || 0)));
    }

    if (payload.customerPhone !== undefined) ord.customerPhone = String(payload.customerPhone || '').trim();
    if (payload.shopName !== undefined) ord.shopName = String(payload.shopName || '').trim();
    if (payload.deliveryAddress !== undefined) ord.deliveryAddress = String(payload.deliveryAddress || '').trim();
    if (payload.geoCoordinates !== undefined) ord.geoCoordinates = String(payload.geoCoordinates || '').trim();
    if (payload.notes !== undefined) ord.notes = String(payload.notes || '').trim();
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: 'pending',
      toStatus: 'pending',
      changedByName: actor.fullName,
      reason: 'تعديل تفاصيل الطلب قبل المراجعة',
      changedAt: now,
    });
    return ord;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تعديل تفاصيل الطلب المعلق (${order.requestNumber})`,
    module: 'طلبات العملاء والمندوبين',
    recordId: orderId,
  });
  return getOrderById(orderId, authContext);
}

export async function cancelOwnPendingOrder(orderId, { reason = '' } = {}, authContext) {
  const actor = authContext.user;
  const now = nowIso();
  const cleanReason = String(reason || '').trim() || 'إلغاء الطلب بواسطة العميل قبل المراجعة';

  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      assertPendingOrderOwnership(mapPgOrderRow(row, [], []), authContext);

      await client.query(
        `UPDATE customer_item_orders SET status = 'cancelled', rejection_reason = $1, version = COALESCE(version, 1) + 1, updated_at = $2 WHERE id = $3`,
        [cleanReason, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,'pending','cancelled',$3,$4,$5,$6)`,
        [generateServerId('OSH'), orderId, actor.id, actor.fullName, cleanReason, now]
      );
      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      return mapPgOrderRow(updated.rows[0], [], []);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إلغاء الطلب المعلق (${order.requestNumber})`,
      module: 'طلبات العملاء والمندوبين',
      recordId: orderId,
      notes: cleanReason,
    });
    return getOrderById(orderId, authContext);
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    assertPendingOrderOwnership(ord, authContext);

    ord.status = 'cancelled';
    ord.rejectionReason = cleanReason;
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: 'pending',
      toStatus: 'cancelled',
      changedByName: actor.fullName,
      reason: cleanReason,
      changedAt: now,
    });
    return ord;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إلغاء الطلب المعلق (${order.requestNumber})`,
    module: 'طلبات العملاء والمندوبين',
    recordId: orderId,
    notes: cleanReason,
  });
  return getOrderById(orderId, authContext);
}

export async function reviewCustomerOrder(orderId, { notes = '' } = {}, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      if (row.status === 'under_review') {
        throw new AppError(409, 'الطلب قيد المراجعة بالفعل (منع التكرار)', 'ORDER_ALREADY_UNDER_REVIEW');
      }
      if (row.status !== 'pending') {
        throw new AppError(409, `لا يمكن تحويل طلب بحالة (${row.status}) إلى قيد المراجعة`, 'INVALID_ORDER_TRANSITION');
      }

      await client.query(
        `UPDATE customer_item_orders SET status = 'under_review', reviewed_by = $1, reviewed_by_user_id = $2, reviewed_at = $3, updated_at = $3 WHERE id = $4`,
        [actor.fullName, actor.id, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,'pending','under_review',$3,$4,$5,$6)`,
        [generateServerId('OSH'), orderId, actor.id, actor.fullName, notes || 'بدء مراجعة الطلب من الإدارة', now]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return mapPgOrderRow(updated.rows[0], itemsRes.rows, histRes.rows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحويل الطلب (${order.requestNumber}) إلى قيد المراجعة`,
      module: 'طلبات العملاء والمندوبين',
      recordId: orderId,
    });
    return order;
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    if (ord.status === 'under_review') throw new AppError(409, 'الطلب قيد المراجعة بالفعل', 'ORDER_ALREADY_UNDER_REVIEW');
    if (ord.status !== 'pending') throw new AppError(409, `لا يمكن تحويل طلب بحالة (${ord.status}) إلى قيد المراجعة`, 'INVALID_ORDER_TRANSITION');

    ord.status = 'under_review';
    ord.reviewedBy = actor.fullName;
    ord.reviewedAt = now;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: 'pending',
      toStatus: 'under_review',
      changedByName: actor.fullName,
      reason: notes || 'بدء مراجعة الطلب من الإدارة',
      changedAt: now,
    });
    return ord;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحويل الطلب (${order.requestNumber}) إلى قيد المراجعة`,
    module: 'طلبات العملاء والمندوبين',
    recordId: orderId,
  });
  return order;
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
      if (row.status !== 'pending' && row.status !== 'under_review') {
        throw new AppError(409, `لا يمكن قبول طلب بحالة (${row.status})`, 'INVALID_ORDER_TRANSITION');
      }

      const prevStatus = row.status;
      await client.query(
        `UPDATE customer_item_orders SET status = 'approved', reviewed_by = $1, reviewed_by_user_id = $2, reviewed_at = $3, updated_at = $3 WHERE id = $4`,
        [actor.fullName, actor.id, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,$3,'approved',$4,$5,$6,$7)`,
        [generateServerId('OSH'), orderId, prevStatus, actor.id, actor.fullName, notes || 'قبول الطلب من الإدارة (متاح لاستكمال إجراءات الفوترة)', now]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return mapPgOrderRow(updated.rows[0], itemsRes.rows, histRes.rows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `قبول الطلب (${order.requestNumber})`,
      module: 'طلبات العملاء والمندوبين',
      recordId: orderId,
    });
    return order;
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    if (ord.status === 'approved') throw new AppError(409, 'تمت الموافقة على هذا الطلب مسبقًا (منع الاعتماد المكرر)', 'ORDER_ALREADY_APPROVED');
    if (ord.status !== 'pending' && ord.status !== 'under_review') {
      throw new AppError(409, `لا يمكن قبول طلب بحالة (${ord.status})`, 'INVALID_ORDER_TRANSITION');
    }

    const prevStatus = ord.status;
    ord.status = 'approved';
    ord.reviewedBy = actor.fullName;
    ord.reviewedAt = now;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: 'approved',
      changedByName: actor.fullName,
      reason: notes || 'قبول الطلب من الإدارة (متاح لاستكمال إجراءات الفوترة)',
      changedAt: now,
    });
    return ord;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `قبول الطلب (${order.requestNumber})`,
    module: 'طلبات العملاء والمندوبين',
    recordId: orderId,
  });
  return order;
}

export async function rejectCustomerOrder(orderId, { reason }, actor) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    throw new AppError(400, 'يجب إدخال سبب واضح لرفض الطلب', 'REJECTION_REASON_REQUIRED');
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
      action: `رفض الطلب (${order.requestNumber})`,
      module: 'طلبات العملاء والمندوبين',
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
    action: `رفض الطلب (${order.requestNumber})`,
    module: 'طلبات العملاء والمندوبين',
    recordId: orderId,
    notes: cleanReason,
  });
  return order;
}

export async function assignOrderDeliveryRep(orderId, { repId, notes = '' } = {}, actor) {
  if (!repId) throw new AppError(400, 'يرجى تحديد المندوب المسؤول عن تسليم الطلب', 'REP_REQUIRED');
  const now = nowIso();

  if (await isPgMode()) {
    const order = await withTransaction(async (client) => {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      if (['invoiced', 'rejected', 'cancelled'].includes(row.status)) {
        throw new AppError(409, `لا يمكن تعيين مندوب لطلب بحالة (${row.status})`, 'INVALID_ORDER_TRANSITION');
      }

      const repRes = await client.query(`SELECT id, name, status FROM representatives WHERE id = $1 LIMIT 1`, [repId]);
      const rep = repRes.rows[0];
      if (!rep) throw new AppError(404, 'المندوب المحدد غير موجود', 'REP_NOT_FOUND');
      if (rep.status && rep.status !== 'active') throw new AppError(409, 'حساب المندوب غير نشط حالياً', 'REP_INACTIVE');

      const prevStatus = row.status;
      const nextStatus = ['out_for_delivery', 'delivered'].includes(prevStatus) ? prevStatus : 'rep_assigned';
      await client.query(
        `UPDATE customer_item_orders
         SET delivery_rep_id = $1, delivery_rep_name = $2, status = $3, version = COALESCE(version, 1) + 1, updated_at = $4
         WHERE id = $5`,
        [rep.id, rep.name, nextStatus, now, orderId]
      );
      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [generateServerId('OSH'), orderId, prevStatus, nextStatus, actor.id, actor.fullName, notes || `تعيين المندوب (${rep.name}) لتنفيذ التسليم`, now]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      return mapPgOrderRow(updated.rows[0], itemsRes.rows, histRes.rows);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تعيين المندوب (${order.deliveryRepName}) للطلب (${order.requestNumber})`,
      module: 'طلبات العملاء والمندوبين',
      recordId: orderId,
    });
    return order;
  }

  const order = await withJsonTransaction(async (db) => {
    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    if (['invoiced', 'rejected', 'cancelled'].includes(ord.status)) {
      throw new AppError(409, `لا يمكن تعيين مندوب لطلب بحالة (${ord.status})`, 'INVALID_ORDER_TRANSITION');
    }
    const rep = (db.representatives || []).find((r) => r.id === repId);
    if (!rep) throw new AppError(404, 'المندوب المحدد غير موجود', 'REP_NOT_FOUND');
    if (rep.status && rep.status !== 'active') throw new AppError(409, 'حساب المندوب غير نشط حالياً', 'REP_INACTIVE');

    const prevStatus = ord.status;
    const nextStatus = ['out_for_delivery', 'delivered'].includes(prevStatus) ? prevStatus : 'rep_assigned';
    ord.deliveryRepId = rep.id;
    ord.deliveryRepName = rep.name;
    ord.status = nextStatus;
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: nextStatus,
      changedByName: actor.fullName,
      reason: notes || `تعيين المندوب (${rep.name}) لتنفيذ التسليم`,
      changedAt: now,
    });
    return ord;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تعيين المندوب (${order.deliveryRepName}) للطلب (${order.requestNumber})`,
    module: 'طلبات العملاء والمندوبين',
    recordId: orderId,
  });
  return order;
}

export async function recordOrderAdvancePaymentPgTx(client, orderId, payload, actor, idempotencyKey = '') {
  const amount = round2(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(400, 'مبلغ الدفعة المقدمة يجب أن يكون أكبر من الصفر', 'INVALID_AMOUNT');
  }
  const cleanIdem = idempotencyKey ? String(idempotencyKey).trim().slice(0, 128) : null;
  if (cleanIdem) {
    const dupAdv = await client.query(`SELECT * FROM order_advance_payments WHERE idempotency_key = $1 LIMIT 1`, [cleanIdem]);
    if (dupAdv.rows[0]) {
      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [dupAdv.rows[0].order_id]);
      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [dupAdv.rows[0].order_id]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [dupAdv.rows[0].order_id]);
      return { deduplicated: true, advancePayment: dupAdv.rows[0], order: mapPgOrderRow(ordRes.rows[0], itemsRes.rows, histRes.rows) };
    }
  }

  const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
  const ord = ordRes.rows[0];
  if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
  if (['rejected', 'cancelled', 'invoiced'].includes(ord.status)) {
    throw new AppError(409, `لا يمكن تسجيل دفعة مقدمة على طلب بحالة (${ord.status})`, 'INVALID_ORDER_STATUS_FOR_ADVANCE');
  }
  if (actor?.role === 'representative') {
    const repRes = await client.query(`SELECT id, name FROM representatives WHERE user_id = $1 LIMIT 1`, [actor.id]);
    const repProfile = repRes.rows[0];
    if (!repProfile) {
      throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    }
    const isOwner =
      ord.delivery_rep_id === repProfile.id ||
      ord.representative_id === repProfile.id ||
      ord.user_id === actor.id;
    if (!isOwner) {
      throw new AppError(403, 'غير مصرح لك بتسجيل دفعة مقدمة على طلب لا يخصك', 'FORBIDDEN_ORDER_ACCESS');
    }
  }

  const custRes = await client.query(`SELECT * FROM customers WHERE id = $1 FOR UPDATE`, [ord.customer_id]);
  if (!custRes.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
  const cust = custRes.rows[0];

  let cashboxId = actor?.role === 'representative' ? undefined : payload.cashboxId;
  if (!cashboxId) {
    const defCb = await client.query(`SELECT id FROM cashboxes WHERE is_default = TRUE LIMIT 1`);
    const anyCb = defCb.rows[0] || (await client.query(`SELECT id FROM cashboxes LIMIT 1`)).rows[0];
    if (!anyCb) throw new AppError(400, 'لا توجد خزينة متاحة', 'CASHBOX_REQUIRED');
    cashboxId = anyCb.id;
  }
  const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [cashboxId]);
  if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة المحددة غير موجودة', 'CASHBOX_NOT_FOUND');
  const cb = cbRes.rows[0];

  const ordTotal = round2(ord.total_amount || 0);
  const prevAdvance = round2(ord.advance_paid_amount || 0);
  const nextAdvance = round2(prevAdvance + amount);
  if (ordTotal > 0 && nextAdvance > ordTotal + 0.01) {
    throw new AppError(400, `مجموع الدفعات المقدمة (${nextAdvance}) يتجاوز إجمالي الطلب (${ordTotal})`, 'EXCEEDS_ORDER_TOTAL');
  }

  const now = nowIso();
  const payDate = payload.date || todayIso();
  const cleanMethod = ['cash', 'bank', 'cheque'].includes(payload.paymentMethod) ? payload.paymentMethod : 'cash';
  const seqRes = await client.query(`SELECT nextval('seq_order_advance_no') AS n`);
  const paymentNumber = `ADV-${String(Number(seqRes.rows[0]?.n || 1)).padStart(5, '0')}`;
  const advId = generateServerId('OAD');

  const nextCbBalance = round2(Number(cb.current_balance || 0) + amount);
  const nextCustBalance = round2(Number(cust.current_balance || 0) - amount);
  const nextOrdRemaining = Math.max(0, round2(ordTotal - nextAdvance));

  await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCbBalance, cb.id]);
  await client.query(`UPDATE customers SET current_balance = $1, updated_at = $2 WHERE id = $3`, [nextCustBalance, now, cust.id]);
  await client.query(
    `UPDATE customer_item_orders SET advance_paid_amount = $1, remaining_amount = $2, version = COALESCE(version, 1) + 1, updated_at = $3 WHERE id = $4`,
    [nextAdvance, nextOrdRemaining, now, orderId]
  );

  await client.query(
    `INSERT INTO order_advance_payments (id, payment_number, order_id, customer_id, cashbox_id, cashbox_name, payment_method, amount, date, notes, status, idempotency_key, origin_device_id, created_by_user_id, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12,$13,$14,$15)`,
    [
      advId,
      paymentNumber,
      orderId,
      cust.id,
      cb.id,
      cb.name,
      cleanMethod,
      amount,
      payDate,
      payload.notes || `دفعة مقدمة على الطلب رقم ${ord.request_number}`,
      cleanIdem,
      payload.originDeviceId || null,
      actor.id,
      actor.fullName,
      now,
    ]
  );

  const ftId = generateServerId('FT');
  const ftNum = `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
  await client.query(
    `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_type, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, notes, created_by_user_id, created_by, created_at)
     VALUES ($1,$2,$3,'customer_payment',$4,$5,$6,$7,'دفعة مقدمة على طلب','customer',$8,$9,'order_advance',$10,$11,$12,$13,$14,$15,$16)`,
    [
      ftId,
      ftNum,
      payDate,
      amount,
      cb.id,
      cb.name,
      nextCbBalance,
      cust.id,
      cust.name,
      orderId,
      ord.request_number,
      `دفعة مقدمة على الطلب رقم ${ord.request_number} (رصيد دائن قبل الفوترة)`,
      payload.notes || '',
      actor.id,
      actor.fullName,
      now,
    ]
  );

  const [updatedOrd, itemsRes, histRes] = await Promise.all([
    client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]),
    client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]),
    client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]),
  ]);
  return {
    deduplicated: false,
    advancePayment: {
      id: advId,
      paymentNumber,
      orderId,
      customerId: cust.id,
      cashboxId: cb.id,
      cashboxName: cb.name,
      paymentMethod: cleanMethod,
      amount,
      date: payDate,
      notes: payload.notes || '',
      status: 'active',
      createdByUserId: actor.id,
      createdBy: actor.fullName,
      createdAt: now,
    },
    order: mapPgOrderRow(updatedOrd.rows[0], itemsRes.rows, histRes.rows),
    customerBalance: nextCustBalance,
    cashboxBalance: nextCbBalance,
  };
}

export function recordOrderAdvancePaymentJsonTx(db, orderId, payload, actor, idempotencyKey = '') {
  const amount = round2(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(400, 'مبلغ الدفعة المقدمة يجب أن يكون أكبر من الصفر', 'INVALID_AMOUNT');
  }
  const cleanIdem = idempotencyKey ? String(idempotencyKey).trim().slice(0, 128) : null;
  db.orderAdvancePayments = db.orderAdvancePayments || [];
  if (cleanIdem) {
    const dupAdv = db.orderAdvancePayments.find((a) => a.idempotencyKey === cleanIdem);
    if (dupAdv) {
      const existingOrd = db.customerItemOrders.find((o) => o.id === dupAdv.orderId);
      return { deduplicated: true, advancePayment: dupAdv, order: existingOrd };
    }
  }

  const ord = db.customerItemOrders.find((o) => o.id === orderId);
  if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
  if (['rejected', 'cancelled', 'invoiced'].includes(ord.status)) {
    throw new AppError(409, `لا يمكن تسجيل دفعة مقدمة على طلب بحالة (${ord.status})`, 'INVALID_ORDER_STATUS_FOR_ADVANCE');
  }
  if (actor?.role === 'representative') {
    const repProfile = (db.representatives || []).find((r) => r.userId === actor.id);
    if (!repProfile) {
      throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    }
    const isOwner =
      ord.deliveryRepId === repProfile.id ||
      ord.representativeId === repProfile.id ||
      ord.userId === actor.id;
    if (!isOwner) {
      throw new AppError(403, 'غير مصرح لك بتسجيل دفعة مقدمة على طلب لا يخصك', 'FORBIDDEN_ORDER_ACCESS');
    }
  }
  const cust = db.customers.find((c) => c.id === ord.customerId);
  if (!cust) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
  const requestedCashboxId = actor?.role === 'representative' ? undefined : payload.cashboxId;
  const cb = requestedCashboxId
    ? db.cashboxes.find((c) => c.id === requestedCashboxId)
    : db.cashboxes.find((c) => c.isDefault) || db.cashboxes[0];
  if (!cb) throw new AppError(404, 'الخزينة المحددة غير موجودة', 'CASHBOX_NOT_FOUND');

  const ordTotal = round2(ord.totalAmount || 0);
  const prevAdvance = round2(ord.advancePaidAmount || 0);
  const nextAdvance = round2(prevAdvance + amount);
  if (ordTotal > 0 && nextAdvance > ordTotal + 0.01) {
    throw new AppError(400, `مجموع الدفعات المقدمة (${nextAdvance}) يتجاوز إجمالي الطلب (${ordTotal})`, 'EXCEEDS_ORDER_TOTAL');
  }

  const now = nowIso();
  const payDate = payload.date || todayIso();
  const cleanMethod = ['cash', 'bank', 'cheque'].includes(payload.paymentMethod) ? payload.paymentMethod : 'cash';
  const seqNum = nextJsonSequence(db, 'orderAdvanceNo', db.orderAdvancePayments, 'paymentNumber', /(\d+)$/);
  const paymentNumber = `ADV-${String(seqNum).padStart(5, '0')}`;
  const advId = generateServerId('OAD');

  cb.currentBalance = round2(Number(cb.currentBalance || 0) + amount);
  cust.currentBalance = round2(Number(cust.currentBalance || 0) - amount);
  cust.updatedAt = now;
  ord.advancePaidAmount = nextAdvance;
  ord.remainingAmount = Math.max(0, round2(ordTotal - nextAdvance));
  ord.version = Number(ord.version || 1) + 1;
  ord.updatedAt = now;

  const advObj = {
    id: advId,
    paymentNumber,
    orderId: ord.id,
    customerId: cust.id,
    cashboxId: cb.id,
    cashboxName: cb.name,
    paymentMethod: cleanMethod,
    amount,
    date: payDate,
    notes: payload.notes || `دفعة مقدمة على الطلب رقم ${ord.requestNumber}`,
    status: 'active',
    idempotencyKey: cleanIdem || undefined,
    originDeviceId: payload.originDeviceId || undefined,
    createdByUserId: actor.id,
    createdBy: actor.fullName,
    createdAt: now,
  };
  db.orderAdvancePayments.unshift(advObj);

  db.financialTransactions.unshift({
    id: generateServerId('FT'),
    transactionNumber: `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
    date: payDate,
    type: 'customer_payment',
    cashboxId: cb.id,
    cashboxName: cb.name,
    balanceAfter: cb.currentBalance,
    amount,
    category: 'دفعة مقدمة على طلب',
    relatedDocType: 'order_advance',
    relatedDocId: ord.id,
    relatedDocNumber: ord.requestNumber,
    relatedEntityId: cust.id,
    partyId: cust.id,
    partyName: cust.name,
    description: `دفعة مقدمة على الطلب رقم ${ord.requestNumber} (رصيد دائن قبل الفوترة)`,
    notes: payload.notes || '',
    createdByUserId: actor.id,
    createdBy: actor.fullName,
    createdAt: now,
  });

  return {
    deduplicated: false,
    advancePayment: advObj,
    order: ord,
    customerBalance: cust.currentBalance,
    cashboxBalance: cb.currentBalance,
  };
}

export async function recordOrderAdvancePayment(orderId, payload, actor, idempotencyKey = '') {
  const endpoint = `POST /api/orders/${orderId}/advance-payment`;
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  const out = (await isPgMode())
    ? await withTransaction(async (client) => {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup) return { ...dup, deduplicated: true };
        const res = await recordOrderAdvancePaymentPgTx(client, orderId, payload, actor, idempotencyKey);
        await savePgIdempotency(client, scopedIdem, actor, endpoint, res);
        return res;
      })
    : await withJsonTransaction(async (db) => {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup) return { ...dup, deduplicated: true };
        const res = recordOrderAdvancePaymentJsonTx(db, orderId, payload, actor, idempotencyKey);
        saveJsonIdempotency(scopedIdem, res);
        return res;
      });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تسجيل دفعة مقدمة (${payload.amount}) على الطلب (${out.order?.requestNumber || orderId})`,
      module: 'المالية',
      recordId: orderId,
    });
  }
  if (!canViewCashboxBalances(actor)) {
    const sanitized = { ...out };
    delete sanitized.cashboxBalance;
    return sanitized;
  }
  return out;
}

const orderMutationQueues = new Map();
async function withOrderLock(orderId, fn) {
  const key = String(orderId || '__default__');
  const prev = orderMutationQueues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const chained = prev.then(() => gate);
  orderMutationQueues.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (orderMutationQueues.get(key) === chained) {
      orderMutationQueues.delete(key);
    }
  }
}

export async function updateOrderDeliveryStatus(orderId, payload, authContext) {
  return withOrderLock(orderId, async () => {
  const actor = authContext.user;
  const targetStatus = String(payload.status || '').trim();
  if (!['out_for_delivery', 'delivered'].includes(targetStatus)) {
    throw new AppError(400, 'حالة التوصيل غير صالحة (يجب أن تكون جاري التوصيل أو تم التسليم)', 'INVALID_DELIVERY_STATUS');
  }
  const isRep = actor.role === 'representative';
  const rep = isRep ? authContext.representativeProfile || (await getRepresentativeByUserId(actor.id)) : null;
  if (isRep && !rep) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }
  const now = nowIso();
  const collectedAmount = round2(Math.max(0, Number(payload.collectedAmount || 0)));
  const rawProof = payload.deliveryProof ? String(payload.deliveryProof).trim() : '';
  let deliveryProof = undefined;
  let deliveryNotes = String(payload.deliveryNotes || '').trim();
  if (rawProof) {
    const isValidImageRef =
      /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(rawProof) ||
      /^https?:\/\/\S+$/i.test(rawProof) ||
      rawProof.startsWith('/product-images/');
    if (isValidImageRef && rawProof.length <= 2_500_000) {
      deliveryProof = rawProof;
    } else {
      const proofWarn = '[تم استبعاد مرفق صورة التسليم لتلف الصيغة أو تجاوز الحجم المسموح مع حفظ التسليم والتحصيل بأمان]';
      deliveryNotes = deliveryNotes ? `${deliveryNotes} ${proofWarn}` : proofWarn;
    }
  }
  const endpoint = `POST /api/orders/${orderId}/delivery-status`;
  const idempotencyKey = payload.idempotencyKey ? String(payload.idempotencyKey).trim() : '';
  const scopedIdem = idempotencyKey ? buildScopedIdemKey(endpoint, actor, idempotencyKey) : '';

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      if (scopedIdem) {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.order) return { ...dup, deduplicated: true };
      }

      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
const DELIVERY_ALLOWED_SOURCE_STATUSES = new Set([
        'approved',
        'rep_assigned',
        'preparing',
        'out_for_delivery',
        'invoiced',
        'delivered',
      ]);
      if (!DELIVERY_ALLOWED_SOURCE_STATUSES.has(row.status)) {
        throw new AppError(409, `لا يمكن تحديث التوصيل لطلب بحالة (${row.status})`, 'INVALID_ORDER_TRANSITION');
      }
      if (isRep) {
        const allowed = row.delivery_rep_id === rep.id || row.representative_id === rep.id || row.user_id === actor.id;
        if (!allowed) throw new AppError(403, 'غير مصرح لك بتحديث حالة تسليم طلب لم يتم تعيينك له', 'FORBIDDEN_ORDER_ACCESS');
      }

      let advanceResult = null;
      let invoiceResult = null;
      if (collectedAmount > 0) {
        if (row.invoice_id) {
          invoiceResult = await addInvoicePaymentPgTx(
            client,
            row.invoice_id,
            {
              amount: collectedAmount,
              cashboxId: payload.cashboxId,
              paymentMethod: payload.paymentMethod || 'cash',
              date: payload.date || todayIso(),
              notes: deliveryNotes || `تحصيل مندوب عند تسليم الطلب رقم ${row.request_number}`,
            },
            actor,
            idempotencyKey ? `${idempotencyKey}-invpay` : '',
            { skipAuditLog: true }
          );
        } else {
          advanceResult = await recordOrderAdvancePaymentPgTx(
            client,
            orderId,
            {
              amount: collectedAmount,
              cashboxId: payload.cashboxId,
              paymentMethod: payload.paymentMethod || 'cash',
              date: payload.date || todayIso(),
              notes: deliveryNotes || `تحصيل مندوب عند تسليم الطلب رقم ${row.request_number}`,
              originDeviceId: payload.originDeviceId,
            },
            actor,
            idempotencyKey ? `${idempotencyKey}-adv` : ''
          );
        }
      }

      const freshOrd = (await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId])).rows[0];
      const prevStatus = row.status;
      const nextCollected = invoiceResult
        ? round2(invoiceResult.invoice.paidAmount)
        : round2(Number(freshOrd.collected_amount || 0) + collectedAmount);
      const nextRemaining = invoiceResult
        ? round2(invoiceResult.invoice.remainingAmount)
        : Math.max(0, round2(Number(freshOrd.total_amount || 0) - Number(freshOrd.advance_paid_amount || 0)));

      await client.query(
        `UPDATE customer_item_orders
         SET status = $1,
             delivery_rep_id = COALESCE(delivery_rep_id, $2),
             delivery_rep_name = CASE WHEN COALESCE(delivery_rep_name, '') = '' THEN $3 ELSE delivery_rep_name END,
             delivered_at = CASE WHEN $1 = 'delivered' THEN COALESCE(delivered_at, $4) ELSE delivered_at END,
             delivery_notes = CASE WHEN $5 <> '' THEN $5 ELSE delivery_notes END,
             delivery_proof = COALESCE($6, delivery_proof),
             collected_amount = $7,
             remaining_amount = $8,
             version = COALESCE(version, 1) + 1,
             updated_at = $4
         WHERE id = $9`,
        [
          targetStatus,
          rep?.id || null,
          rep?.name || '',
          now,
          deliveryNotes,
          deliveryProof || null,
          nextCollected,
          nextRemaining,
          orderId,
        ]
      );

      const reasonText =
        deliveryNotes ||
        (targetStatus === 'delivered'
          ? `تم تسليم الطلب للعميل${collectedAmount > 0 ? ` مع تحصيل ${collectedAmount}` : ''}`
          : 'بدء توصيل الطلب للعميل');

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
          reasonText,
          now,
        ]
      );

      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `تحديث حالة توصيل الطلب (${row.request_number}) إلى ${targetStatus}`,
        module: 'طلبات العملاء والمندوبين',
        recordId: orderId,
        notes: reasonText,
        client,
      });

      const [updatedOrd, itemsRes, histRes] = await Promise.all([
        client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]),
        client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]),
        client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]),
      ]);
      const payloadOut = {
        order: mapPgOrderRow(updatedOrd.rows[0], itemsRes.rows, histRes.rows),
        invoice: invoiceResult?.invoice || null,
        advancePayment: advanceResult?.advancePayment || null,
      };
      if (scopedIdem) {
        await savePgIdempotency(client, scopedIdem, actor, endpoint, payloadOut);
      }
      return { deduplicated: false, ...payloadOut };
    });
    return { order: out.order, invoice: out.invoice || null, advancePayment: out.advancePayment || null };
  }

  const out = await withJsonTransaction(async (db) => {
    if (scopedIdem) {
      const dup = findJsonIdempotency(scopedIdem);
      if (dup?.order) return { ...dup, deduplicated: true };
    }

    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    const DELIVERY_ALLOWED_SOURCE_STATUSES_JSON = new Set([
      'approved',
      'rep_assigned',
      'preparing',
      'out_for_delivery',
      'invoiced',
      'delivered',
    ]);
    if (!DELIVERY_ALLOWED_SOURCE_STATUSES_JSON.has(ord.status)) {
      throw new AppError(409, `لا يمكن تحديث التوصيل لطلب بحالة (${ord.status})`, 'INVALID_ORDER_TRANSITION');
    }
    if (isRep) {
      const allowed = ord.deliveryRepId === rep.id || ord.representativeId === rep.id || ord.userId === actor.id;
      if (!allowed) throw new AppError(403, 'غير مصرح لك بتحديث حالة تسليم طلب لم يتم تعيينك له', 'FORBIDDEN_ORDER_ACCESS');
    }

    let advanceResult = null;
    let invoiceResult = null;
    if (collectedAmount > 0) {
      if (ord.invoiceId) {
        invoiceResult = addInvoicePaymentJsonTx(
          db,
          ord.invoiceId,
          {
            amount: collectedAmount,
            cashboxId: payload.cashboxId,
            paymentMethod: payload.paymentMethod || 'cash',
            date: payload.date || todayIso(),
            notes: deliveryNotes || `تحصيل مندوب عند تسليم الطلب رقم ${ord.requestNumber}`,
          },
          actor,
          idempotencyKey ? `${idempotencyKey}-invpay` : ''
        );
      } else {
        advanceResult = recordOrderAdvancePaymentJsonTx(
          db,
          orderId,
          {
            amount: collectedAmount,
            cashboxId: payload.cashboxId,
            paymentMethod: payload.paymentMethod || 'cash',
            date: payload.date || todayIso(),
            notes: deliveryNotes || `تحصيل مندوب عند تسليم الطلب رقم ${ord.requestNumber}`,
            originDeviceId: payload.originDeviceId,
          },
          actor,
          idempotencyKey ? `${idempotencyKey}-adv` : ''
        );
      }
    }

    const prevStatus = ord.status;
    ord.status = targetStatus;
    if (!ord.deliveryRepId && rep) {
      ord.deliveryRepId = rep.id;
      ord.deliveryRepName = rep.name;
    }
    if (targetStatus === 'delivered' && !ord.deliveredAt) {
      ord.deliveredAt = now;
    }
    if (deliveryNotes) ord.deliveryNotes = deliveryNotes;
    if (deliveryProof) ord.deliveryProof = deliveryProof;
    if (invoiceResult) {
      ord.collectedAmount = round2(invoiceResult.invoice.paidAmount);
      ord.remainingAmount = round2(invoiceResult.invoice.remainingAmount);
    } else {
      ord.collectedAmount = round2(Number(ord.collectedAmount || 0) + collectedAmount);
      ord.remainingAmount = Math.max(0, round2(Number(ord.totalAmount || 0) - Number(ord.advancePaidAmount || 0)));
    }
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: targetStatus,
      changedByName: actor.fullName,
      reason: deliveryNotes || (targetStatus === 'delivered' ? `تم تسليم الطلب للعميل${collectedAmount > 0 ? ` مع تحصيل ${collectedAmount}` : ''}` : 'بدء توصيل الطلب للعميل'),
      changedAt: now,
    });

    const payloadOut = {
      order: ord,
      invoice: invoiceResult?.invoice || null,
      advancePayment: advanceResult?.advancePayment || null,
    };
    if (scopedIdem) {
      saveJsonIdempotency(scopedIdem, payloadOut);
    }
    return { deduplicated: false, ...payloadOut };
  });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث حالة توصيل الطلب (${out.order.requestNumber}) إلى ${targetStatus}`,
      module: 'طلبات العملاء والمندوبين',
      recordId: orderId,
    });
  }
  return { deduplicated: Boolean(out.deduplicated), order: out.order, invoice: out.invoice || null, advancePayment: out.advancePayment || null };
  });
}

const CONVERTIBLE_ORDER_STATUSES = new Set(['approved', 'rep_assigned', 'out_for_delivery', 'delivered']);

export async function convertOrderToInvoice(orderId, invoicePayload = {}, actor, idempotencyKey = '') {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بتحويل الطلبات إلى فواتير', 'FORBIDDEN');
  }
  if (actor.role !== 'admin' && !actor.permissions?.canManageSales) {
    throw new AppError(403, 'ليس لديك صلاحية تحويل الطلبات إلى فواتير مبيعات', 'FORBIDDEN_PERMISSION');
  }
  const safePayload = invoicePayload && typeof invoicePayload === 'object' ? { ...invoicePayload } : {};
  delete safePayload.createdBy;
  delete safePayload.createdByUserId;
  delete safePayload.sentBy;
  delete safePayload.sentByUserId;
  delete safePayload.approvedBy;
  delete safePayload.approvedByUserId;
  delete safePayload.reviewStatus;
  delete safePayload.dispatchStatus;
  delete safePayload.linkedCustomerOrderId;

  const repActor = actor?.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor?.role === 'representative' && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }
  const hasTreasuryPriv =
    actor.role === 'admin' ||
    Boolean(actor.permissions?.canManageCashboxes || actor.permissions?.canManageAccounts);

  const now = nowIso();
  const endpoint = `POST /api/orders/${orderId}/convert-to-invoice`;
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const dup = await findPgIdempotency(client, scopedIdem);
      if (dup?.invoice && dup?.order) return { ...dup, deduplicated: true };

      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const ord = ordRes.rows[0];
      if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
      if (repActor) {
        const isOwner =
          ord.delivery_rep_id === repActor.id ||
          ord.representative_id === repActor.id ||
          ord.user_id === actor.id;
        if (!isOwner) {
          throw new AppError(403, 'غير مصرح للمندوب بتحويل طلب لا يخصه إلى فاتورة', 'FORBIDDEN_ORDER_ACCESS');
        }
      }
      if (ord.status === 'invoiced' || ord.invoice_id) {
        throw new AppError(409, `تم تحويل هذا الطلب إلى فاتورة مسبقًا (${ord.invoice_number || ord.invoice_id})`, 'ORDER_ALREADY_INVOICED');
      }
      if (!CONVERTIBLE_ORDER_STATUSES.has(ord.status)) {
        throw new AppError(409, 'يجب الموافقة على الطلب أولاً قبل تحويله إلى فاتورة مبيعات', 'ORDER_NOT_APPROVED');
      }

      const reqCustId =
        safePayload.customerId !== undefined && safePayload.customerId !== null && String(safePayload.customerId).trim() !== ''
          ? String(safePayload.customerId).trim()
          : null;
      const reqCustName =
        safePayload.customerName !== undefined && safePayload.customerName !== null && String(safePayload.customerName).trim() !== ''
          ? String(safePayload.customerName).trim()
          : null;
      const isCustomerOverride =
        (reqCustId && reqCustId !== String(ord.customer_id || '').trim()) ||
        (!reqCustId && reqCustName && reqCustName !== String(ord.customer_name || '').trim());
      if (isCustomerOverride && actor?.role !== 'admin') {
        throw new AppError(
          403,
          'لا يمكن تغيير العميل المرتبط بالطلب عند تحويله إلى فاتورة؛ الصلاحية للإدارة فقط',
          'FORBIDDEN_ORDER_CUSTOMER_OVERRIDE'
        );
      }

      const advRes = await client.query(
        `SELECT * FROM order_advance_payments WHERE order_id = $1 AND status = 'active' FOR UPDATE`,
        [orderId]
      );
      const activeAdvanceSum = round2(advRes.rows.reduce((s, r) => s + Number(r.amount || 0), 0));

      const itemsRes = await client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]);
      const orderItems = itemsRes.rows;

      const mappedOrderItems = orderItems.map((it) => ({
        productId: it.product_id,
        productName: it.product_name,
        unit: it.unit,
        unitFactor: Number(it.unit_factor || 1),
        quantity: Number(it.quantity),
        unitPrice: Number(it.reference_unit_price || 0),
        discount: 0,
      }));
      const itemsForInvoice =
        !repActor && Array.isArray(safePayload.items) && safePayload.items.length > 0
          ? safePayload.items
          : mappedOrderItems;

      const paidAtInvoice =
        activeAdvanceSum > 0
          ? round2(Math.max(0, Number(safePayload.paidAtInvoice ?? safePayload.paidAmount ?? 0)))
          : undefined;

      const invoice = await createInvoiceInsidePgTx(
        client,
        'sales',
        {
          ...safePayload,
          customerId: ord.customer_id,
          customerName: ord.customer_name,
          representativeId: repActor ? repActor.id : (safePayload.representativeId || ord.delivery_rep_id || ord.representative_id || undefined),
          representativeName: repActor ? repActor.name : (safePayload.representativeName || ord.delivery_rep_name || ord.representative_name || undefined),
          cashboxId: repActor || !hasTreasuryPriv ? undefined : safePayload.cashboxId,
          discountTotal: repActor ? 0 : safePayload.discountTotal,
          taxTotal: repActor ? 0 : safePayload.taxTotal,
          items: itemsForInvoice,
          appliedAdvanceAmount: activeAdvanceSum,
          paidAtInvoice,
          linkedCustomerOrderId: ord.id,
          notes: safePayload.notes || `فاتورة محولة من الطلب رقم ${ord.request_number}`,
        },
        actor
      );

      if (activeAdvanceSum > 0 && invoice.status === 'confirmed') {
        await client.query(
          `UPDATE order_advance_payments SET status = 'applied', applied_invoice_id = $1 WHERE order_id = $2 AND status = 'active'`,
          [invoice.id, orderId]
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
        [generateServerId('OSH'), orderId, prevStatus, actor.id, actor.fullName, `تحويل الطلب إلى فاتورة مبيعات رقم ${invoice.invoiceNumber} (${invoice.status === 'draft' ? 'مسودة' : 'معتمدة'})`, now]
      );

      const updated = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]);
      const histRes = await client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]);
      const payloadOut = { order: mapPgOrderRow(updated.rows[0], orderItems, histRes.rows), invoice };
      await savePgIdempotency(client, scopedIdem, actor, endpoint, payloadOut);
      return { deduplicated: false, ...payloadOut };
    });

    if (!result.deduplicated) {
      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `تحويل الطلب (${result.order.requestNumber}) إلى فاتورة (${result.invoice.invoiceNumber})`,
        module: 'طلبات العملاء والمندوبين',
        recordId: orderId,
      });
    }
    return actor?.role === 'representative'
      ? { ...result, invoice: sanitizeInvoiceForRepresentative(result.invoice) }
      : result;
  }

  // JSON Ledger fallback
  const result = await withJsonTransaction(async (db) => {
    const dup = findJsonIdempotency(scopedIdem);
    if (dup?.invoice && dup?.order) return { ...dup, deduplicated: true };

    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');
    if (repActor) {
      const isOwner =
        ord.deliveryRepId === repActor.id ||
        ord.representativeId === repActor.id ||
        ord.userId === actor.id;
      if (!isOwner) {
        throw new AppError(403, 'غير مصرح للمندوب بتحويل طلب لا يخصه إلى فاتورة', 'FORBIDDEN_ORDER_ACCESS');
      }
    }
    if (ord.status === 'invoiced' || ord.invoiceId) {
      throw new AppError(409, `تم تحويل هذا الطلب إلى فاتورة مسبقًا (${ord.invoiceNumber || ord.invoiceId})`, 'ORDER_ALREADY_INVOICED');
    }
    if (!CONVERTIBLE_ORDER_STATUSES.has(ord.status)) {
      throw new AppError(409, 'يجب الموافقة على الطلب أولاً قبل تحويله إلى فاتورة مبيعات', 'ORDER_NOT_APPROVED');
    }

    const reqCustId =
      safePayload.customerId !== undefined && safePayload.customerId !== null && String(safePayload.customerId).trim() !== ''
        ? String(safePayload.customerId).trim()
        : null;
    const reqCustName =
      safePayload.customerName !== undefined && safePayload.customerName !== null && String(safePayload.customerName).trim() !== ''
        ? String(safePayload.customerName).trim()
        : null;
    const isCustomerOverride =
      (reqCustId && reqCustId !== String(ord.customerId || '').trim()) ||
      (!reqCustId && reqCustName && reqCustName !== String(ord.customerName || '').trim());
    if (isCustomerOverride && actor?.role !== 'admin') {
      throw new AppError(
        403,
        'لا يمكن تغيير العميل المرتبط بالطلب عند تحويله إلى فاتورة؛ الصلاحية للإدارة فقط',
        'FORBIDDEN_ORDER_CUSTOMER_OVERRIDE'
      );
    }

    const activeAdvances = (db.orderAdvancePayments || []).filter((a) => a.orderId === orderId && a.status === 'active');
    const activeAdvanceSum = round2(activeAdvances.reduce((s, a) => s + Number(a.amount || 0), 0));

    const mappedOrderItems = (ord.items || []).map((it) => ({
      productId: it.productId,
      productName: it.productName,
      unit: it.unit,
      unitFactor: Number(it.unitFactor || 1),
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice || 0),
      discount: 0,
    }));
    const itemsForInvoice =
      !repActor && Array.isArray(safePayload.items) && safePayload.items.length > 0
        ? safePayload.items
        : mappedOrderItems;

    const paidAtInvoice =
      activeAdvanceSum > 0
        ? round2(Math.max(0, Number(safePayload.paidAtInvoice ?? safePayload.paidAmount ?? 0)))
        : undefined;

    const invoice = createInvoiceInsideJsonTx(
      db,
      'sales',
      {
        ...safePayload,
        customerId: ord.customerId,
        customerName: ord.customerName,
        representativeId: repActor ? repActor.id : (safePayload.representativeId || ord.deliveryRepId || ord.representativeId || undefined),
        representativeName: repActor ? repActor.name : (safePayload.representativeName || ord.deliveryRepName || ord.representativeName || undefined),
        cashboxId: repActor || !hasTreasuryPriv ? undefined : safePayload.cashboxId,
        discountTotal: repActor ? 0 : safePayload.discountTotal,
        taxTotal: repActor ? 0 : safePayload.taxTotal,
        items: itemsForInvoice,
        appliedAdvanceAmount: activeAdvanceSum,
        paidAtInvoice,
        linkedCustomerOrderId: ord.id,
        notes: safePayload.notes || `فاتورة محولة من الطلب رقم ${ord.requestNumber}`,
      },
      actor
    );

    if (activeAdvanceSum > 0 && invoice.status === 'confirmed') {
      for (const adv of activeAdvances) {
        adv.status = 'applied';
        adv.appliedInvoiceId = invoice.id;
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
      reason: `تحويل الطلب إلى فاتورة مبيعات رقم ${invoice.invoiceNumber} (${invoice.status === 'draft' ? 'مسودة' : 'معتمدة'})`,
      changedAt: now,
    });
    const payloadOut = { order: ord, invoice };
    saveJsonIdempotency(scopedIdem, payloadOut);
    return { deduplicated: false, ...payloadOut };
  });

  if (!result.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحويل الطلب (${result.order.requestNumber}) إلى فاتورة (${result.invoice.invoiceNumber})`,
      module: 'طلبات العملاء والمندوبين',
      recordId: orderId,
    });
  }
  return actor?.role === 'representative'
    ? { ...result, invoice: sanitizeInvoiceForRepresentative(result.invoice) }
    : result;
}

const VALID_LIFECYCLE_STAGES = new Set([
  'preparing',
  'out_for_delivery',
  'delivered',
  'collected',
  'closed',
]);

const ORDER_STAGE_TRANSITIONS = {
  pending: new Set(['preparing']),
  reviewed: new Set(['preparing']),
  approved: new Set(['preparing', 'out_for_delivery', 'delivered']),
  rep_assigned: new Set(['preparing', 'out_for_delivery', 'delivered']),
  invoiced: new Set(['preparing', 'out_for_delivery', 'delivered', 'collected']),
  preparing: new Set(['out_for_delivery', 'delivered', 'collected']),
  out_for_delivery: new Set(['delivered', 'collected']),
  delivered: new Set(['collected', 'closed']),
  collected: new Set(['collected', 'closed']),
};

export async function advanceOrderStage(orderId, payload, authContext) {
  return withOrderLock(orderId, async () => {
  const actor = authContext.user;
  const targetStage = String(payload.stage || payload.status || '').trim();
  if (!VALID_LIFECYCLE_STAGES.has(targetStage)) {
    throw new AppError(400, 'المرحلة المحددة لدورة حياة الطلب غير صالحة', 'INVALID_ORDER_STAGE');
  }

  const isRep = actor.role === 'representative';
  const rep = isRep ? authContext.representativeProfile || (await getRepresentativeByUserId(actor.id)) : null;
  if (isRep) {
    if (!rep) {
      throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    }
    if (!['out_for_delivery', 'delivered', 'collected'].includes(targetStage)) {
      throw new AppError(403, 'صلاحية المندوب تقتصر على التوصيل والتسليم والتحصيل فقط', 'FORBIDDEN_STAGE_BY_REP');
    }
  } else if (actor.role !== 'admin' && !actor.permissions?.canManageSales && !actor.permissions?.canManageAccounts && !actor.permissions?.canApprove) {
    throw new AppError(403, 'غير مصرح لك بتحديث مراحل الطلب', 'FORBIDDEN_ORDER_ACCESS');
  }

  const collectedAmount = round2(Math.max(0, Number(payload.collectedAmount || 0)));
  const notes = String(payload.notes || payload.deliveryNotes || '').trim();
  const idempotencyKey = payload.idempotencyKey ? String(payload.idempotencyKey).trim() : '';
  const endpoint = `POST /api/orders/${orderId}/stage`;
  const scopedIdem = idempotencyKey ? buildScopedIdemKey(endpoint, actor, idempotencyKey) : '';
  const now = nowIso();

  const stageLabelMap = {
    preparing: 'بدء تجهيز الطلب',
    out_for_delivery: 'الطلب خرج للتوصيل',
    delivered: 'تم تسليم الطلب للعميل',
    collected: collectedAmount > 0 ? `تم تسجيل تحصيل بمبلغ ${collectedAmount}` : 'تم تأكيد مرحلة التحصيل',
    closed: 'تم إغلاق الطلب واستكمال كافة المراحل',
  };
  const reasonText = notes || stageLabelMap[targetStage] || `تحديث مرحلة الطلب إلى ${targetStage}`;

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      if (scopedIdem) {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.order) return { ...dup, deduplicated: true };
      }

      const ordRes = await client.query(`SELECT * FROM customer_item_orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const row = ordRes.rows[0];
      if (!row) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');

      if (['rejected', 'cancelled', 'closed'].includes(row.status)) {
        throw new AppError(409, `لا يمكن تعديل مرحلة طلب بحالة (${row.status})`, 'INVALID_ORDER_TRANSITION');
      }
      const allowedNext = ORDER_STAGE_TRANSITIONS[row.status];
      if (!allowedNext || !allowedNext.has(targetStage)) {
        throw new AppError(
          409,
          `لا يمكن الانتقال مباشرة من مرحلة (${row.status}) إلى (${targetStage})`,
          'INVALID_ORDER_TRANSITION'
        );
      }

      if (isRep) {
        const allowed =
          row.delivery_rep_id === rep.id ||
          row.representative_id === rep.id ||
          row.user_id === actor.id;
        if (!allowed) {
          throw new AppError(403, 'غير مصرح لك بتحديث حالة أو تحصيل طلب غير مخصص لك', 'FORBIDDEN_ORDER_ACCESS');
        }
      }

      let updatedInvoice = null;
      let advancePayment = null;

      if (collectedAmount > 0) {
        if (row.invoice_id) {
          const payRes = await addInvoicePaymentPgTx(
            client,
            row.invoice_id,
            {
              amount: collectedAmount,
              cashboxId: payload.cashboxId,
              paymentMethod: payload.paymentMethod || 'cash',
              date: payload.date || todayIso(),
              notes: notes || `تحصيل على الطلب رقم ${row.request_number}`,
            },
            actor,
            idempotencyKey ? `${idempotencyKey}-invpay` : '',
            { skipAuditLog: true }
          );
          updatedInvoice = payRes.invoice;
        } else {
          const advRes = await recordOrderAdvancePaymentPgTx(
            client,
            orderId,
            {
              amount: collectedAmount,
              cashboxId: payload.cashboxId,
              paymentMethod: payload.paymentMethod || 'cash',
              date: payload.date || todayIso(),
              notes: reasonText,
              originDeviceId: payload.originDeviceId,
            },
            actor,
            idempotencyKey ? `${idempotencyKey}-adv` : ''
          );
          advancePayment = advRes?.advancePayment || null;
        }
      }

      const freshOrd = (await client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId])).rows[0];
      const nextCollected = updatedInvoice
        ? round2(updatedInvoice.paidAmount)
        : round2(Number(freshOrd.collected_amount || 0) + (row.invoice_id ? 0 : collectedAmount));
      const nextRemaining = updatedInvoice
        ? round2(updatedInvoice.remainingAmount)
        : Math.max(0, round2(Number(freshOrd.total_amount || 0) - Number(freshOrd.advance_paid_amount || 0)));

      await client.query(
        `UPDATE customer_item_orders
         SET status = $1,
             delivered_at = CASE WHEN $1 = 'delivered' THEN COALESCE(delivered_at, $2) ELSE delivered_at END,
             delivery_rep_id = COALESCE(delivery_rep_id, $3),
             delivery_rep_name = CASE WHEN COALESCE(delivery_rep_name, '') = '' THEN $4 ELSE delivery_rep_name END,
             delivery_notes = CASE WHEN $5 <> '' THEN $5 ELSE delivery_notes END,
             collected_amount = $6,
             remaining_amount = $7,
             version = COALESCE(version, 1) + 1,
             updated_at = $2
         WHERE id = $8`,
        [
          targetStage,
          now,
          rep?.id || payload.deliveryRepId || null,
          rep?.name || payload.deliveryRepName || '',
          notes,
          nextCollected,
          nextRemaining,
          orderId,
        ]
      );

      await client.query(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by_user_id, changed_by_name, reason, changed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [generateServerId('OSH'), orderId, freshOrd.status, targetStage, actor.id, actor.fullName, reasonText, now]
      );

      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `تحديث مرحلة الطلب (${row.request_number}) إلى ${targetStage}`,
        module: 'طلبات العملاء والمندوبين',
        recordId: orderId,
        notes: reasonText,
        client,
      });

      const [updatedOrd, itemsRes, histRes, prodImgRes, advPayRes, invRes, invPayRes] = await Promise.all([
        client.query(`SELECT * FROM customer_item_orders WHERE id = $1`, [orderId]),
        client.query(`SELECT * FROM customer_item_order_items WHERE order_id = $1`, [orderId]),
        client.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC`, [orderId]),
        client.query(`SELECT id, image FROM products WHERE image IS NOT NULL AND image <> ''`),
        client.query(`SELECT * FROM order_advance_payments WHERE order_id = $1 ORDER BY created_at ASC`, [orderId]),
        row.invoice_id
          ? client.query(`SELECT id, invoice_number, grand_total, paid_amount, remaining_amount FROM invoices WHERE id = $1`, [row.invoice_id])
          : Promise.resolve({ rows: [] }),
        row.invoice_id
          ? client.query(`SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY created_at ASC`, [row.invoice_id])
          : Promise.resolve({ rows: [] }),
      ]);
      const productImageMap = new Map(prodImgRes.rows.map((p) => [p.id, p.image]));
      const invoiceMap = new Map();
      if (invRes.rows[0]) {
        const invRow = invRes.rows[0];
        invoiceMap.set(invRow.id, {
          id: invRow.id,
          invoiceNumber: invRow.invoice_number,
          grandTotal: Number(invRow.grand_total || 0),
          paidAmount: Number(invRow.paid_amount || 0),
          remainingAmount: Number(invRow.remaining_amount || 0),
          payments: invPayRes.rows.map((p) => ({
            id: p.id,
            invoiceNumber: p.invoice_number,
            amount: Number(p.amount || 0),
            date: isoDateOnly(p.date),
            paymentMethod: p.payment_method,
            cashboxName: p.cashbox_name,
            notes: p.notes || '',
            createdBy: p.created_by,
            createdAt: isoTimestamp(p.created_at),
          })),
        });
      }
      const advPaymentsMap = new Map();
      advPaymentsMap.set(
        orderId,
        advPayRes.rows.map((a) => ({ ...a, date: isoDateOnly(a.date), createdAt: isoTimestamp(a.created_at) }))
      );
      const enrichedOrder = enrichOrderCollection(
        [mapPgOrderRow(updatedOrd.rows[0], itemsRes.rows, histRes.rows)],
        productImageMap,
        invoiceMap,
        advPaymentsMap
      )[0];

      const payloadOut = { order: enrichedOrder, invoice: updatedInvoice, advancePayment };
      if (scopedIdem) {
        await savePgIdempotency(client, scopedIdem, actor, endpoint, payloadOut);
      }
      return { deduplicated: false, ...payloadOut };
    });

    return {
      deduplicated: Boolean(out.deduplicated),
      order: out.order,
      invoice: out.invoice,
      advancePayment: out.advancePayment,
    };
  }

  // JSON Ledger mode
  const out = await withJsonTransaction(async (db) => {
    if (scopedIdem) {
      const dup = findJsonIdempotency(scopedIdem);
      if (dup?.order) return { ...dup, deduplicated: true };
    }

    const ord = db.customerItemOrders.find((o) => o.id === orderId);
    if (!ord) throw new AppError(404, 'الطلب غير موجود', 'ORDER_NOT_FOUND');

    if (['rejected', 'cancelled', 'closed'].includes(ord.status)) {
      throw new AppError(409, `لا يمكن تعديل مرحلة طلب بحالة (${ord.status})`, 'INVALID_ORDER_TRANSITION');
    }
    const allowedNext = ORDER_STAGE_TRANSITIONS[ord.status];
    if (!allowedNext || !allowedNext.has(targetStage)) {
      throw new AppError(
        409,
        `لا يمكن الانتقال مباشرة من مرحلة (${ord.status}) إلى (${targetStage})`,
        'INVALID_ORDER_TRANSITION'
      );
    }

    if (isRep) {
      const allowed =
        ord.deliveryRepId === rep.id ||
        ord.representativeId === rep.id ||
        ord.userId === actor.id;
      if (!allowed) {
        throw new AppError(403, 'غير مصرح لك بتحديث حالة أو تحصيل طلب غير مخصص لك', 'FORBIDDEN_ORDER_ACCESS');
      }
    }

    let updatedInvoice = null;
    let advancePayment = null;

    if (collectedAmount > 0) {
      if (ord.invoiceId) {
        const payRes = addInvoicePaymentJsonTx(
          db,
          ord.invoiceId,
          {
            amount: collectedAmount,
            cashboxId: payload.cashboxId,
            paymentMethod: payload.paymentMethod || 'cash',
            date: payload.date || todayIso(),
            notes: notes || `تحصيل على الطلب رقم ${ord.requestNumber}`,
          },
          actor,
          idempotencyKey ? `${idempotencyKey}-invpay` : ''
        );
        updatedInvoice = payRes.invoice;
      } else {
        const advRes = recordOrderAdvancePaymentJsonTx(
          db,
          orderId,
          {
            amount: collectedAmount,
            cashboxId: payload.cashboxId,
            paymentMethod: payload.paymentMethod || 'cash',
            date: payload.date || todayIso(),
            notes: reasonText,
            originDeviceId: payload.originDeviceId,
          },
          actor,
          idempotencyKey ? `${idempotencyKey}-adv` : ''
        );
        advancePayment = advRes?.advancePayment || null;
      }
    }

    const prevStatus = ord.status;
    ord.status = targetStage;
    if (targetStage === 'delivered' && !ord.deliveredAt) ord.deliveredAt = now;
    if (!ord.deliveryRepId && (rep || payload.deliveryRepId)) {
      ord.deliveryRepId = rep?.id || payload.deliveryRepId;
      ord.deliveryRepName = rep?.name || payload.deliveryRepName || '';
    }
    if (notes) ord.deliveryNotes = notes;
    if (updatedInvoice) {
      ord.collectedAmount = round2(updatedInvoice.paidAmount);
      ord.remainingAmount = round2(updatedInvoice.remainingAmount);
    } else {
      ord.collectedAmount = round2(Number(ord.collectedAmount || 0) + collectedAmount);
      ord.remainingAmount = Math.max(0, round2(Number(ord.totalAmount || 0) - Number(ord.advancePaidAmount || 0)));
    }
    ord.version = Number(ord.version || 1) + 1;
    ord.updatedAt = now;
    ord.statusHistory = ord.statusHistory || [];
    ord.statusHistory.push({
      id: generateServerId('OSH'),
      fromStatus: prevStatus,
      toStatus: targetStage,
      changedByName: actor.fullName,
      reason: reasonText,
      changedAt: now,
    });

    const productImageMap = new Map((db.products || []).filter((p) => p.image).map((p) => [p.id, p.image]));
    const invoiceMap = new Map((db.invoices || []).map((inv) => [inv.id, inv]));
    const advPaymentsMap = new Map();
    advPaymentsMap.set(
      orderId,
      (db.orderAdvancePayments || []).filter((a) => a.orderId === orderId)
    );
    const enrichedOrder = enrichOrderCollection([ord], productImageMap, invoiceMap, advPaymentsMap)[0];

    const payloadOut = { order: enrichedOrder, invoice: updatedInvoice, advancePayment };
    if (scopedIdem) {
      saveJsonIdempotency(scopedIdem, payloadOut);
    }
    return { deduplicated: false, ...payloadOut };
  });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث مرحلة الطلب (${out.order.requestNumber}) إلى ${targetStage}`,
      module: 'طلبات العملاء والمندوبين',
      recordId: orderId,
      notes: reasonText,
    });
  }

  return {
    deduplicated: Boolean(out.deduplicated),
    order: out.order,
    invoice: out.invoice,
    advancePayment: out.advancePayment,
  };
  });
}


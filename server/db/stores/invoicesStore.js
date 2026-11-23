import { getPool, withTransaction } from '../postgres.js';
import { withJsonTransaction, nextJsonSequence, readJsonDatabase } from '../jsonLedger.js';
import { generateServerId } from '../../utils/crypto.js';
import { AppError, nowIso, todayIso, round2, round3, sanitizeInvoiceForRepresentative } from '../../utils/errors.js';
import { isPgMode, mapPgInvoiceRow, mapPgCustomerRow, mapPgProductRow, mapPgPurchaseReturnRequestRow } from './mode.js';
import { recordAuditLog } from './authStore.js';
import {
  buildScopedIdemKey,
  findPgIdempotency,
  savePgIdempotency,
  findJsonIdempotency,
  saveJsonIdempotency,
} from '../../utils/idempotency.js';
import {
  getRepresentativeByUserId,
  getCustomerById,
  getSystemSettingsSafe,
  findProductDuplicateMatchInList,
} from './catalogStore.js';

export function isRepOwnerOfInvoice(inv, actor, repProfile = null) {
  if (!inv || !actor) return false;
  if (repProfile?.id && inv.representativeId === repProfile.id) return true;
  if (actor.id && inv.createdByUserId === actor.id) return true;
  if (actor.id && inv.sentByUserId === actor.id) return true;
  if (!inv.createdByUserId && !inv.representativeId && !inv.sentByUserId) {
    return inv.createdBy === actor.id || (Boolean(actor.fullName) && inv.createdBy === actor.fullName);
  }
  return false;
}

function recomputeInvoiceTotals(payload, existingItems = []) {
  const items = Array.isArray(payload.items) ? payload.items : existingItems;
  if (!items || items.length === 0) {
    throw new AppError(400, 'الفاتورة يجب أن تحتوي على صنف واحد على الأقل', 'EMPTY_INVOICE_ITEMS');
  }
  let subtotal = 0;
  const normalizedItems = items.map((it) => {
    const qty = round3(it.quantity);
    if (qty <= 0) throw new AppError(400, `كمية الصنف (${it.productName || it.productId}) يجب أن تكون أكبر من صفر`, 'INVALID_QUANTITY');
    const unitPrice = round2(it.unitPrice);
    const discount = round2(it.discount || 0);
    const unitFactor = Math.max(0.001, Number(it.unitFactor || 1));
    const lineTotal = round2(Math.max(0, qty * unitPrice - discount));
    subtotal = round2(subtotal + qty * unitPrice);
    return {
      productId: it.productId,
      productName: it.productName || '',
      barcode: it.barcode || '',
      unit: it.unit || 'قطعة',
      unitFactor,
      quantity: qty,
      unitPrice,
      purchasePriceAtTime: round2(it.purchasePriceAtTime || 0),
      discount,
      total: lineTotal,
    };
  });

  const itemDiscounts = normalizedItems.reduce((s, i) => s + i.discount, 0);
  const discountTotal = round2(payload.discountTotal ?? itemDiscounts);
  const taxTotal = round2(payload.taxTotal ?? 0);
  const grandTotal = round2(Math.max(0, subtotal - discountTotal + taxTotal));
  const rawAppliedAdvance = round2(Math.max(0, Number(payload.appliedAdvanceAmount || 0)));

  let paidAmount;
  let appliedAdvanceAmount;
  if (rawAppliedAdvance > 0) {
    if (payload.paidAtInvoice !== undefined) {
      const cashAtInvoice = round2(Math.max(0, Number(payload.paidAtInvoice || 0)));
      appliedAdvanceAmount = round2(Math.min(Math.max(0, grandTotal - cashAtInvoice), rawAppliedAdvance));
      paidAmount = round2(Math.min(grandTotal, cashAtInvoice + appliedAdvanceAmount));
    } else {
      const rawPaid = round2(payload.paidAmount ?? 0);
      paidAmount = Math.min(grandTotal, Math.max(0, rawPaid));
      appliedAdvanceAmount = round2(Math.min(paidAmount, rawAppliedAdvance));
    }
  } else {
    appliedAdvanceAmount = 0;
    const rawPaid = round2(payload.paidAmount ?? (payload.paymentType === 'cash' ? grandTotal : 0));
    paidAmount = Math.min(grandTotal, Math.max(0, rawPaid));
  }

  const remainingAmount = round2(Math.max(0, grandTotal - paidAmount));
  const paymentType = remainingAmount <= 0 ? 'cash' : paidAmount > 0 ? 'partial' : 'credit';

  return {
    items: normalizedItems,
    subtotal,
    discountTotal,
    taxTotal,
    grandTotal,
    paidAmount,
    appliedAdvanceAmount,
    remainingAmount,
    paymentType,
  };
}

// Shared transactional helper inside PostgreSQL transaction when an invoice transitions to 'confirmed'
export async function applyConfirmedEffectsPgTx(client, invoice, actor, options = {}) {
  const now = nowIso();
  const stRes = await client.query(`SELECT allow_negative_stock FROM system_settings LIMIT 1`);
  const allowNegative = Boolean(stRes.rows[0]?.allow_negative_stock) && Boolean(actor?.permissions?.canAllowNegativeInventory);

  const whRes = await client.query(`SELECT id, name FROM warehouses WHERE id = $1 LIMIT 1`, [invoice.warehouseId]);
  if (!whRes.rows[0]) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
  const warehouseName = whRes.rows[0].name;

  if (invoice.type === 'quote') {
    return;
  }

  if (invoice.type === 'sales') {
    for (const item of invoice.items) {
      const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [item.productId]);
      const prod = pRes.rows[0];
      if (!prod) throw new AppError(404, `الصنف غير موجود (${item.productName})`, 'PRODUCT_NOT_FOUND');

      const stockMap = { ...(prod.stock_per_warehouse || {}) };
      const currentQty = Number(stockMap[invoice.warehouseId] || 0);
      const baseQty = round3(item.quantity * (item.unitFactor || 1));
      if (currentQty < baseQty && !allowNegative) {
        throw new AppError(
          409,
          `الرصيد المتاح من (${prod.name}) في ${warehouseName} هو ${currentQty}، وهو أقل من المطلوب (${baseQty})`,
          'INSUFFICIENT_STOCK'
        );
      }
      const nextQty = round3(currentQty - baseQty);
      stockMap[invoice.warehouseId] = nextQty;
      await client.query(`UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3`, [
        JSON.stringify(stockMap),
        now,
        prod.id,
      ]);

      const mvId = generateServerId('SM');
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_before, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'sale', $8, $9, $10, $11, $12, $13, 'sales', $14, $15, $16, $17, $18, $19)`,
        [
          mvId,
          mvId,
          invoice.date,
          prod.id,
          prod.name,
          invoice.warehouseId,
          warehouseName,
          baseQty,
          item.unit,
          item.unitFactor || 1,
          item.purchasePriceAtTime || Number(prod.purchase_price || 0),
          currentQty,
          nextQty,
          invoice.id,
          invoice.invoiceNumber,
          `فاتورة مبيعات رقم ${invoice.invoiceNumber}`,
          actor.fullName,
          actor.id || null,
          now,
        ]
      );
    }

    const appliedAdv = round2(Math.max(0, Number(invoice.appliedAdvanceAmount || 0)));
    const cashAtInvoice = round2(Math.max(0, Number(invoice.paidAmount || 0) - appliedAdv));
    const customerBalanceDelta = round2(Number(invoice.remainingAmount || 0) + appliedAdv);

    if (invoice.customerId) {
      const cRes = await client.query(`SELECT * FROM customers WHERE id = $1 FOR UPDATE`, [invoice.customerId]);
      if (cRes.rows[0]) {
        const cust = cRes.rows[0];
        const nextBalance = round2(Number(cust.current_balance || 0) + customerBalanceDelta);
        const priceHistory = { ...(cust.price_history || {}) };
        for (const item of invoice.items) {
          const hist = Array.isArray(priceHistory[item.productId]) ? [...priceHistory[item.productId]] : [];
          hist.push({
            price: Number(item.unitPrice || 0),
            quantity: Number(item.quantity || 0),
            date: invoice.date || todayIso(),
            invoiceNumber: invoice.invoiceNumber || '',
            unit: item.unit || '',
            unitFactor: Number(item.unitFactor || 1),
          });
          if (hist.length > 3) hist.shift();
          priceHistory[item.productId] = hist;
        }
        await client.query(`UPDATE customers SET current_balance = $1, price_history = $2, updated_at = $3 WHERE id = $4`, [
          nextBalance,
          JSON.stringify(priceHistory),
          now,
          cust.id,
        ]);
      }
    }

    if (cashAtInvoice > 0) {
      const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [invoice.cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) + cashAtInvoice);
      await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCb, invoice.cashboxId]);

      const txId = generateServerId('FT');
      const txNo = `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, created_by, created_by_user_id, created_at)
         VALUES ($1, $2, $3, 'customer_payment', $4, $5, $6, $7, 'مبيعات نقدية', $8, $9, 'sales', $10, $11, $12, $13, $14, $15)`,
        [
          txId,
          txNo,
          invoice.date,
          cashAtInvoice,
          cbRes.rows[0].id,
          cbRes.rows[0].name,
          nextCb,
          invoice.customerId || null,
          invoice.customerName || '',
          invoice.id,
          invoice.invoiceNumber,
          `تحصيل دفعة مبيعات فاتورة رقم ${invoice.invoiceNumber}`,
          actor.fullName,
          actor.id || null,
          now,
        ]
      );
    }

    if (invoice.representativeId && cashAtInvoice > 0) {
      const repRes = await client.query(`SELECT * FROM representatives WHERE id = $1 FOR UPDATE`, [invoice.representativeId]);
      if (repRes.rows[0]) {
        const nextRep = round2(Number(repRes.rows[0].current_balance || 0) + cashAtInvoice);
        await client.query(`UPDATE representatives SET current_balance = $1 WHERE id = $2`, [nextRep, invoice.representativeId]);
      }
    }

    if (invoice.linkedRepTransferId) {
      await client.query(
        `UPDATE rep_item_transfers SET invoice_id = $1, invoice_number = $2 WHERE id = $3`,
        [invoice.id, invoice.invoiceNumber, invoice.linkedRepTransferId]
      );
    }
  } else if (invoice.type === 'purchase') {
    for (const item of invoice.items) {
      const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [item.productId]);
      const prod = pRes.rows[0];
      if (!prod) throw new AppError(404, `الصنف غير موجود (${item.productName})`, 'PRODUCT_NOT_FOUND');

      const stockMap = { ...(prod.stock_per_warehouse || {}) };
      const currentQty = Number(stockMap[invoice.warehouseId] || 0);
      const baseQty = round3(item.quantity * (item.unitFactor || 1));
      const nextQty = round3(currentQty + baseQty);
      stockMap[invoice.warehouseId] = nextQty;
      const baseItemCost = round2(item.unitPrice / Math.max(0.001, item.unitFactor || 1)) || Number(prod.purchase_price || 0);

      await client.query(
        `UPDATE products SET stock_per_warehouse = $1, purchase_price = $2, updated_at = $3 WHERE id = $4`,
        [JSON.stringify(stockMap), baseItemCost, now, prod.id]
      );

      const mvId = generateServerId('SM');
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_before, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'purchase', $8, $9, $10, $11, $12, $13, 'purchase', $14, $15, $16, $17, $18, $19)`,
        [
          mvId,
          mvId,
          invoice.date,
          prod.id,
          prod.name,
          invoice.warehouseId,
          warehouseName,
          baseQty,
          item.unit,
          item.unitFactor || 1,
          baseItemCost,
          currentQty,
          nextQty,
          invoice.id,
          invoice.invoiceNumber,
          `فاتورة مشتريات رقم ${invoice.invoiceNumber}`,
          actor.fullName,
          actor.id || null,
          now,
        ]
      );
    }

    if (invoice.supplierId) {
      const sRes = await client.query(`SELECT * FROM suppliers WHERE id = $1 FOR UPDATE`, [invoice.supplierId]);
      if (sRes.rows[0]) {
        const nextSupp = round2(Number(sRes.rows[0].current_balance || 0) + Number(invoice.remainingAmount || 0));
        await client.query(`UPDATE suppliers SET current_balance = $1 WHERE id = $2`, [nextSupp, invoice.supplierId]);
      }
    }

    if (invoice.paidAmount > 0) {
      const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [invoice.cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) - Number(invoice.paidAmount || 0));
      await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCb, invoice.cashboxId]);

      const txId = generateServerId('FT');
      const txNo = `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, created_by, created_by_user_id, created_at)
         VALUES ($1, $2, $3, 'supplier_payment', $4, $5, $6, $7, 'مشتريات نقدية', $8, $9, 'purchase', $10, $11, $12, $13, $14, $15)`,
        [
          txId,
          txNo,
          invoice.date,
          invoice.paidAmount,
          cbRes.rows[0].id,
          cbRes.rows[0].name,
          nextCb,
          invoice.supplierId || null,
          invoice.supplierName || '',
          invoice.id,
          invoice.invoiceNumber,
          `سداد دفعة مشتريات فاتورة رقم ${invoice.invoiceNumber}`,
          actor.fullName,
          actor.id || null,
          now,
        ]
      );
    }
  }
}

export function applyConfirmedEffectsJsonTx(db, invoice, actor) {
  const now = nowIso();
  const allowNegative = Boolean(db.settings?.allowNegativeStock) && Boolean(actor?.permissions?.canAllowNegativeInventory);
  const wh = db.warehouses.find((w) => w.id === invoice.warehouseId);
  if (!wh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

  if (invoice.type === 'quote') {
    return;
  }

  if (invoice.type === 'sales') {
    if (!allowNegative) {
      for (const item of invoice.items) {
        const prod = db.products.find((p) => p.id === item.productId);
        if (!prod) throw new AppError(404, `الصنف غير موجود (${item.productName})`, 'PRODUCT_NOT_FOUND');
        const avail = Number(prod.stockPerWarehouse?.[invoice.warehouseId] || 0);
        const req = round3(item.quantity * (item.unitFactor || 1));
        if (avail < req) {
          throw new AppError(
            409,
            `الرصيد المتاح من (${prod.name}) في ${wh.name} هو ${avail}، وهو أقل من المطلوب (${req})`,
            'INSUFFICIENT_STOCK'
          );
        }
      }
    }

    for (const item of invoice.items) {
      const prod = db.products.find((p) => p.id === item.productId);
      const baseQty = round3(item.quantity * (item.unitFactor || 1));
      const curQty = Number(prod.stockPerWarehouse?.[invoice.warehouseId] || 0);
      const nextQty = round3(curQty - baseQty);
      prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [invoice.warehouseId]: nextQty };

      const mvId = generateServerId('SM');
      db.stockMovements.unshift({
        id: mvId,
        movementNumber: mvId,
        date: invoice.date,
        type: 'sale',
        productId: prod.id,
        productName: prod.name,
        warehouseId: invoice.warehouseId,
        warehouseName: wh.name,
        quantity: baseQty,
        unit: item.unit || prod.baseUnit,
        unitFactor: Number(item.unitFactor || 1),
        unitCost: item.purchasePriceAtTime || prod.purchasePrice || 0,
        balanceBefore: curQty,
        balanceAfter: nextQty,
        relatedDocType: 'sales',
        referenceId: invoice.id,
        referenceNumber: invoice.invoiceNumber,
        notes: `فاتورة مبيعات رقم ${invoice.invoiceNumber}`,
        createdBy: actor.fullName,
        createdByUserId: actor.id,
        createdAt: now,
      });
    }

    const appliedAdv = round2(Math.max(0, Number(invoice.appliedAdvanceAmount || 0)));
    const cashAtInvoice = round2(Math.max(0, Number(invoice.paidAmount || 0) - appliedAdv));
    const customerBalanceDelta = round2(Number(invoice.remainingAmount || 0) + appliedAdv);

    if (invoice.customerId) {
      const cust = db.customers.find((c) => c.id === invoice.customerId);
      if (cust) {
        cust.currentBalance = round2(Number(cust.currentBalance || 0) + customerBalanceDelta);
        const priceHistory = { ...(cust.priceHistory || {}) };
        for (const item of invoice.items) {
          const prev = Array.isArray(priceHistory[item.productId]) ? [...priceHistory[item.productId]] : [];
          prev.push({
            price: Number(item.unitPrice || 0),
            quantity: Number(item.quantity || 0),
            date: invoice.date || todayIso(),
            invoiceNumber: invoice.invoiceNumber || '',
            unit: item.unit || '',
            unitFactor: Number(item.unitFactor || 1),
          });
          if (prev.length > 3) prev.shift();
          priceHistory[item.productId] = prev;
        }
        cust.priceHistory = priceHistory;
      }
    }

    if (cashAtInvoice > 0) {
      const cb = db.cashboxes.find((c) => c.id === invoice.cashboxId);
      if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      cb.currentBalance = round2(Number(cb.currentBalance || 0) + cashAtInvoice);
      db.financialTransactions.unshift({
        id: generateServerId('FT'),
        transactionNumber: `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
        date: invoice.date,
        type: 'customer_payment',
        cashboxId: cb.id,
        cashboxName: cb.name,
        amount: cashAtInvoice,
        category: 'مبيعات نقدية',
        relatedDocType: 'sales',
        relatedDocId: invoice.id,
        relatedDocNumber: invoice.invoiceNumber,
        relatedEntityId: invoice.customerId,
        partyId: invoice.customerId,
        partyName: invoice.customerName,
        description: `تحصيل دفعة مبيعات فاتورة رقم ${invoice.invoiceNumber}`,
        createdBy: actor.fullName,
        createdByUserId: actor.id,
        createdAt: now,
      });
    }

    if (invoice.representativeId && cashAtInvoice > 0) {
      const rep = db.representatives.find((r) => r.id === invoice.representativeId);
      if (rep) rep.currentBalance = round2(Number(rep.currentBalance || 0) + cashAtInvoice);
    }

    if (invoice.linkedRepTransferId) {
      const rit = db.repItemTransfers.find((x) => x.id === invoice.linkedRepTransferId);
      if (rit) {
        rit.invoiceId = invoice.id;
        rit.invoiceNumber = invoice.invoiceNumber;
      }
    }
  } else if (invoice.type === 'purchase') {
    for (const item of invoice.items) {
      const prod = db.products.find((p) => p.id === item.productId);
      if (!prod) throw new AppError(404, `الصنف غير موجود (${item.productName})`, 'PRODUCT_NOT_FOUND');
      const baseQty = round3(item.quantity * (item.unitFactor || 1));
      const curQty = Number(prod.stockPerWarehouse?.[invoice.warehouseId] || 0);
      const nextQty = round3(curQty + baseQty);
      prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [invoice.warehouseId]: nextQty };
      const baseItemCost = round2(item.unitPrice / Math.max(0.001, item.unitFactor || 1)) || prod.purchasePrice;
      prod.purchasePrice = baseItemCost;

      const mvId = generateServerId('SM');
      db.stockMovements.unshift({
        id: mvId,
        movementNumber: mvId,
        date: invoice.date,
        type: 'purchase',
        productId: prod.id,
        productName: prod.name,
        warehouseId: invoice.warehouseId,
        warehouseName: wh.name,
        quantity: baseQty,
        unit: item.unit || prod.baseUnit,
        unitFactor: Number(item.unitFactor || 1),
        unitCost: baseItemCost,
        balanceBefore: curQty,
        balanceAfter: nextQty,
        relatedDocType: 'purchase',
        referenceId: invoice.id,
        referenceNumber: invoice.invoiceNumber,
        notes: `فاتورة مشتريات رقم ${invoice.invoiceNumber}`,
        createdBy: actor.fullName,
        createdByUserId: actor.id,
        createdAt: now,
      });
    }

    if (invoice.supplierId) {
      const supp = db.suppliers.find((s) => s.id === invoice.supplierId);
      if (supp) supp.currentBalance = round2(Number(supp.currentBalance || 0) + Number(invoice.remainingAmount || 0));
    }

    if (invoice.paidAmount > 0) {
      const cb = db.cashboxes.find((c) => c.id === invoice.cashboxId);
      if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      cb.currentBalance = round2(Number(cb.currentBalance || 0) - Number(invoice.paidAmount || 0));
      db.financialTransactions.unshift({
        id: generateServerId('FT'),
        transactionNumber: `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
        date: invoice.date,
        type: 'supplier_payment',
        cashboxId: cb.id,
        cashboxName: cb.name,
        amount: invoice.paidAmount,
        category: 'مشتريات نقدية',
        relatedDocType: 'purchase',
        relatedDocId: invoice.id,
        relatedDocNumber: invoice.invoiceNumber,
        partyId: invoice.supplierId,
        partyName: invoice.supplierName,
        description: `سداد دفعة مشتريات فاتورة رقم ${invoice.invoiceNumber}`,
        createdBy: actor.fullName,
        createdByUserId: actor.id,
        createdAt: now,
      });
    }
  }
}

async function resolvePurchaseItemsWithInlineProductsPgTx(client, rawItems = [], now) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return rawItems;
  const needsInline = rawItems.some((it) => it && !it.productId && it.newProduct);
  if (!needsInline) return rawItems;

  const pRes = await client.query(`SELECT * FROM products`);
  const uRes = await client.query(`SELECT * FROM product_units`);
  const unitsByProd = new Map();
  for (const u of uRes.rows) {
    const list = unitsByProd.get(u.product_id) || [];
    list.push(u);
    unitsByProd.set(u.product_id, list);
  }
  const catalogList = pRes.rows.map((p) => mapPgProductRow(p, unitsByProd.get(p.id) || []));

  const resolved = [];
  for (const item of rawItems) {
    if (item.productId || !item.newProduct) {
      resolved.push(item);
      continue;
    }
    const np = item.newProduct || {};
    const name = String(np.name || item.productName || '').trim();
    if (!name) {
      throw new AppError(400, 'اسم الصنف الجديد مطلوب عند إضافته داخل الفاتورة', 'INVALID_PRODUCT_NAME');
    }
    const candidate = {
      name,
      barcode: String(np.barcode || item.barcode || '').trim(),
      code: String(np.code || '').trim(),
      category: String(np.category || 'عام').trim() || 'عام',
      baseUnit: String(np.baseUnit || item.unit || 'قطعة').trim() || 'قطعة',
    };
    const dupCheck = findProductDuplicateMatchInList(catalogList, candidate);
    if (dupCheck.exactMatch) {
      const ex = dupCheck.exactMatch;
      resolved.push({
        ...item,
        productId: ex.id,
        productName: ex.name,
        barcode: ex.barcode || candidate.barcode || '',
        unit: item.unit || ex.baseUnit || candidate.baseUnit,
        unitFactor: Number(item.unitFactor || 1),
        purchasePriceAtTime: round2(item.unitPrice ?? ex.purchasePrice ?? 0),
        newProduct: undefined,
      });
      continue;
    }

    const newProdId = generateServerId('PRD');
    const finalCode = candidate.code || `P-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
    const purchasePrice = round2(np.purchasePrice ?? (Number(item.unitPrice || 0) / Math.max(0.001, Number(item.unitFactor || 1))));
    const sellingPrice = round2(np.sellingPrice ?? 0);

    await client.query(
      `INSERT INTO products (id, code, barcode, name, category, base_unit, purchase_price, selling_price, min_stock_level, stock_per_warehouse, notes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10, 'active', $11)`,
      [
        newProdId,
        finalCode,
        candidate.barcode,
        name,
        candidate.category,
        candidate.baseUnit,
        purchasePrice,
        sellingPrice,
        round2(np.minStockLevel || 0),
        String(np.notes || '').trim(),
        now,
      ]
    );

    const createdObj = {
      id: newProdId,
      code: finalCode,
      barcode: candidate.barcode,
      name,
      category: candidate.category,
      baseUnit: candidate.baseUnit,
      units: [],
      purchasePrice,
      sellingPrice,
      stockPerWarehouse: {},
      status: 'active',
    };
    catalogList.push(createdObj);

    resolved.push({
      ...item,
      productId: newProdId,
      productName: name,
      barcode: candidate.barcode,
      unit: item.unit || candidate.baseUnit,
      unitFactor: Number(item.unitFactor || 1),
      purchasePriceAtTime: round2(item.unitPrice ?? purchasePrice),
      newProduct: undefined,
    });
  }
  return resolved;
}

function resolvePurchaseItemsWithInlineProductsJsonTx(db, rawItems = [], now) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return rawItems;
  const needsInline = rawItems.some((it) => it && !it.productId && it.newProduct);
  if (!needsInline) return rawItems;

  const resolved = [];
  for (const item of rawItems) {
    if (item.productId || !item.newProduct) {
      resolved.push(item);
      continue;
    }
    const np = item.newProduct || {};
    const name = String(np.name || item.productName || '').trim();
    if (!name) {
      throw new AppError(400, 'اسم الصنف الجديد مطلوب عند إضافته داخل الفاتورة', 'INVALID_PRODUCT_NAME');
    }
    const candidate = {
      name,
      barcode: String(np.barcode || item.barcode || '').trim(),
      code: String(np.code || '').trim(),
      category: String(np.category || 'عام').trim() || 'عام',
      baseUnit: String(np.baseUnit || item.unit || 'قطعة').trim() || 'قطعة',
    };
    const dupCheck = findProductDuplicateMatchInList(db.products, candidate);
    if (dupCheck.exactMatch) {
      const ex = dupCheck.exactMatch;
      resolved.push({
        ...item,
        productId: ex.id,
        productName: ex.name,
        barcode: ex.barcode || candidate.barcode || '',
        unit: item.unit || ex.baseUnit || candidate.baseUnit,
        unitFactor: Number(item.unitFactor || 1),
        purchasePriceAtTime: round2(item.unitPrice ?? ex.purchasePrice ?? 0),
        newProduct: undefined,
      });
      continue;
    }

    const newProdId = generateServerId('PRD');
    const finalCode = candidate.code || `P-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
    const purchasePrice = round2(np.purchasePrice ?? (Number(item.unitPrice || 0) / Math.max(0.001, Number(item.unitFactor || 1))));
    const sellingPrice = round2(np.sellingPrice ?? 0);

    const newProd = {
      id: newProdId,
      code: finalCode,
      barcode: candidate.barcode,
      name,
      category: candidate.category,
      baseUnit: candidate.baseUnit,
      units: [],
      purchasePrice,
      sellingPrice,
      minStockLevel: round2(np.minStockLevel || 0),
      stockPerWarehouse: {},
      notes: String(np.notes || '').trim(),
      status: 'active',
      createdAt: now,
    };
    db.products.unshift(newProd);

    resolved.push({
      ...item,
      productId: newProdId,
      productName: name,
      barcode: candidate.barcode,
      unit: item.unit || candidate.baseUnit,
      unitFactor: Number(item.unitFactor || 1),
      purchasePriceAtTime: round2(item.unitPrice ?? purchasePrice),
      newProduct: undefined,
    });
  }
  return resolved;
}

export async function createInvoiceInsidePgTx(client, type, payload, actor) {
  const now = nowIso();
  const status = payload.status === 'draft' ? 'draft' : 'confirmed';
  const resolvedItems =
    type === 'purchase'
      ? await resolvePurchaseItemsWithInlineProductsPgTx(client, payload.items, now)
      : payload.items;
  const totals = recomputeInvoiceTotals({ ...payload, items: resolvedItems });
  const seqName =
    type === 'sales'
      ? 'seq_sales_invoice_no'
      : type === 'quote'
      ? 'seq_quote_no'
      : 'seq_purchase_invoice_no';
  const seqRes = await client.query(`SELECT nextval('${seqName}') AS n`);
  const num = Number(seqRes.rows[0]?.n || 1);
  const year = new Date().getFullYear();
  const prefix = type === 'sales' ? 'INV' : type === 'quote' ? 'QT' : 'PUR';
  const invoiceNumber = `${prefix}-${year}-${String(num).padStart(4, '0')}`;
  const invoiceId = generateServerId(prefix);
  const reviewStatus =
    payload.reviewStatus ||
    (type === 'sales' && status === 'confirmed' && actor?.role === 'representative'
      ? 'needs_review'
      : 'not_required');

  let warehouseId = payload.warehouseId;
  if (!warehouseId) {
    const defWh = await client.query(`SELECT id, name FROM warehouses WHERE is_default = TRUE LIMIT 1`);
    const anyWh = defWh.rows[0] || (await client.query(`SELECT id, name FROM warehouses LIMIT 1`)).rows[0];
    if (!anyWh) throw new AppError(400, 'لا يوجد مستودع متاح', 'WAREHOUSE_REQUIRED');
    warehouseId = anyWh.id;
  }
  const whRow = (await client.query(`SELECT id, name FROM warehouses WHERE id = $1 LIMIT 1`, [warehouseId])).rows[0];
  if (!whRow) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

  let cashboxId = payload.cashboxId;
  if (!cashboxId) {
    const defCb = await client.query(`SELECT id FROM cashboxes WHERE is_default = TRUE LIMIT 1`);
    const anyCb = defCb.rows[0] || (await client.query(`SELECT id FROM cashboxes LIMIT 1`)).rows[0];
    if (!anyCb) throw new AppError(400, 'لا توجد خزينة متاحة', 'CASHBOX_REQUIRED');
    cashboxId = anyCb.id;
  }

  let customerName = payload.customerName || '';
  if (type === 'sales' && payload.customerId) {
    const cRow = (await client.query(`SELECT name FROM customers WHERE id = $1 LIMIT 1`, [payload.customerId])).rows[0];
    if (!cRow) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    customerName = cRow.name;
  }
  let supplierName = payload.supplierName || '';
  if (type === 'purchase' && payload.supplierId) {
    const sRow = (await client.query(`SELECT name FROM suppliers WHERE id = $1 LIMIT 1`, [payload.supplierId])).rows[0];
    if (!sRow) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');
    supplierName = sRow.name;
  }

  const invDate = payload.date || todayIso();
  const isPurchaseDispatch = type === 'purchase';
  const sendNow = isPurchaseDispatch && status === 'draft' && Boolean(payload.sendNow);
  const dispatchStatus = isPurchaseDispatch
    ? status === 'confirmed'
      ? 'confirmed'
      : sendNow
      ? 'sent'
      : 'draft'
    : status === 'confirmed'
    ? 'confirmed'
    : 'draft';
  const sentBy = sendNow ? actor.fullName : null;
  const sentByUserId = sendNow ? actor.id : null;
  const sentAt = sendNow ? now : null;
  const recipientUserId = sendNow ? (payload.recipientUserId || null) : null;
  const recipientName = sendNow ? (String(payload.recipientName || '').trim() || 'الإدارة / المشتريات') : null;
  const dispatchHistory = [];
  if (isPurchaseDispatch) {
    dispatchHistory.push({
      id: generateServerId('DSP'),
      action: 'created',
      at: now,
      by: actor.fullName,
      byUserId: actor.id,
      notes: payload.notes ? String(payload.notes).trim() : '',
    });
    if (sendNow) {
      dispatchHistory.push({
        id: generateServerId('DSP'),
        action: 'sent',
        at: now,
        by: actor.fullName,
        byUserId: actor.id,
        recipientUserId: recipientUserId || undefined,
        recipientName: recipientName || undefined,
        notes: payload.dispatchNotes ? String(payload.dispatchNotes).trim() : '',
      });
    } else if (status === 'confirmed') {
      dispatchHistory.push({
        id: generateServerId('DSP'),
        action: 'confirmed',
        at: now,
        by: actor.fullName,
        byUserId: actor.id,
        notes: 'إنشاء واعتماد مباشر',
      });
    }
  }

  await client.query(
    `INSERT INTO invoices (id, invoice_number, type, date, customer_id, customer_name, supplier_id, supplier_name, representative_id, representative_name, warehouse_id, warehouse_name, subtotal, discount_total, tax_total, grand_total, paid_amount, applied_advance_amount, remaining_amount, payment_type, payment_method, cashbox_id, status, notes, linked_rep_transfer_id, linked_rep_transfer_number, linked_customer_order_id, returned_quantity_by_item, idempotency_key, origin_device_id, sync_status, review_status, dispatch_status, sent_by, sent_by_user_id, sent_at, recipient_user_id, recipient_name, dispatch_history, version, created_by, created_by_user_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'{}'::jsonb,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,1,$39,$40,$41)`,
    [
      invoiceId,
      invoiceNumber,
      type,
      invDate,
      payload.customerId || null,
      customerName || null,
      payload.supplierId || null,
      supplierName || null,
      payload.representativeId || null,
      payload.representativeName || null,
      whRow.id,
      whRow.name,
      totals.subtotal,
      totals.discountTotal,
      totals.taxTotal,
      totals.grandTotal,
      totals.paidAmount,
      totals.appliedAdvanceAmount,
      totals.remainingAmount,
      totals.paymentType,
      payload.paymentMethod || 'cash',
      cashboxId,
      status,
      payload.notes || '',
      payload.linkedRepTransferId || null,
      payload.linkedRepTransferNumber || null,
      payload.linkedCustomerOrderId || null,
      payload.idempotencyKey || null,
      payload.originDeviceId || null,
      payload.syncStatus || 'synced',
      reviewStatus,
      dispatchStatus,
      sentBy,
      sentByUserId,
      sentAt,
      recipientUserId,
      recipientName,
      JSON.stringify(dispatchHistory),
      actor.fullName,
      actor.id || null,
      now,
    ]
  );

  for (let i = 0; i < totals.items.length; i++) {
    const it = totals.items[i];
    const pRow = (await client.query(`SELECT name, barcode, purchase_price FROM products WHERE id = $1 LIMIT 1`, [it.productId])).rows[0];
    if (!pRow) throw new AppError(404, `الصنف غير موجود (${it.productName || it.productId})`, 'PRODUCT_NOT_FOUND');
    it.productName = it.productName || pRow.name;
    it.barcode = it.barcode || pRow.barcode || '';
    const dbCost = Number(pRow.purchase_price || 0);
    it.purchasePriceAtTime = (actor?.role === 'representative' && type !== 'purchase')
      ? dbCost
      : (it.purchasePriceAtTime || dbCost);

    await client.query(
      `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, barcode, unit, unit_factor, quantity, unit_price, purchase_price_at_time, discount, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        `${invoiceId}-ITM-${i + 1}`,
        invoiceId,
        it.productId,
        it.productName,
        it.barcode,
        it.unit,
        it.unitFactor,
        it.quantity,
        it.unitPrice,
        it.purchasePriceAtTime,
        it.discount,
        it.total,
      ]
    );
  }

  const invoiceObj = {
    id: invoiceId,
    invoiceNumber,
    type,
    date: invDate,
    customerId: payload.customerId || undefined,
    customerName: customerName || undefined,
    supplierId: payload.supplierId || undefined,
    supplierName: supplierName || undefined,
    representativeId: payload.representativeId || undefined,
    representativeName: payload.representativeName || undefined,
    isRepPurchase: type === 'purchase' && Boolean(payload.isRepPurchase || actor?.role === 'representative' || payload.representativeId),
    warehouseId: whRow.id,
    warehouseName: whRow.name,
    items: totals.items,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
    paidAmount: totals.paidAmount,
    appliedAdvanceAmount: totals.appliedAdvanceAmount,
    remainingAmount: totals.remainingAmount,
    paymentType: totals.paymentType,
    paymentMethod: payload.paymentMethod || 'cash',
    cashboxId,
    status,
    notes: payload.notes || '',
    payments: [],
    linkedRepTransferId: payload.linkedRepTransferId || undefined,
    linkedRepTransferNumber: payload.linkedRepTransferNumber || undefined,
    linkedCustomerOrderId: payload.linkedCustomerOrderId || undefined,
    returnedQuantityByItem: {},
    originDeviceId: payload.originDeviceId || undefined,
    syncStatus: payload.syncStatus || 'synced',
    reviewStatus,
    dispatchStatus,
    sentBy: sentBy || undefined,
    sentByUserId: sentByUserId || undefined,
    sentAt: sentAt || undefined,
    recipientUserId: recipientUserId || undefined,
    recipientName: recipientName || undefined,
    dispatchHistory,
    editHistory: [],
    version: 1,
    createdBy: actor.fullName,
    createdByUserId: actor.id,
    createdAt: now,
  };

  if (status === 'confirmed') {
    await applyConfirmedEffectsPgTx(client, invoiceObj, actor);
  }

  return invoiceObj;
}

export function createInvoiceInsideJsonTx(db, type, payload, actor) {
  const now = nowIso();
  const status = payload.status === 'draft' ? 'draft' : 'confirmed';
  const resolvedItems =
    type === 'purchase'
      ? resolvePurchaseItemsWithInlineProductsJsonTx(db, payload.items, now)
      : payload.items;
  const totals = recomputeInvoiceTotals({ ...payload, items: resolvedItems });
  const seqKey = type === 'sales' ? 'salesInvoiceNo' : type === 'quote' ? 'quoteNo' : 'purchaseInvoiceNo';
  const prefix = type === 'sales' ? 'INV' : type === 'quote' ? 'QT' : 'PUR';
  const num = nextJsonSequence(db, seqKey, db.invoices.filter((i) => i.type === type), 'invoiceNumber', /(\d+)$/);
  const year = new Date().getFullYear();
  const invoiceNumber = `${prefix}-${year}-${String(num).padStart(4, '0')}`;
  const invoiceId = generateServerId(prefix);
  const reviewStatus =
    payload.reviewStatus ||
    (type === 'sales' && status === 'confirmed' && actor?.role === 'representative'
      ? 'needs_review'
      : 'not_required');

  const wh = (payload.warehouseId ? db.warehouses.find((w) => w.id === payload.warehouseId) : null) || db.warehouses.find((w) => w.isDefault) || db.warehouses[0];
  if (!wh) throw new AppError(400, 'لا يوجد مستودع متاح', 'WAREHOUSE_REQUIRED');
  const cb = (payload.cashboxId ? db.cashboxes.find((c) => c.id === payload.cashboxId) : null) || db.cashboxes.find((c) => c.isDefault) || db.cashboxes[0];
  if (!cb) throw new AppError(400, 'لا توجد خزينة متاحة', 'CASHBOX_REQUIRED');

  let customerName = payload.customerName || '';
  if (type === 'sales' && payload.customerId) {
    const cust = db.customers.find((c) => c.id === payload.customerId);
    if (!cust) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    customerName = cust.name;
  }
  let supplierName = payload.supplierName || '';
  if (type === 'purchase' && payload.supplierId) {
    const supp = db.suppliers.find((s) => s.id === payload.supplierId);
    if (!supp) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');
    supplierName = supp.name;
  }

  const enrichedItems = totals.items.map((it) => {
    const prod = db.products.find((p) => p.id === it.productId);
    if (!prod) throw new AppError(404, `الصنف غير موجود (${it.productName || it.productId})`, 'PRODUCT_NOT_FOUND');
    const dbCost = Number(prod.purchasePrice || 0);
    return {
      ...it,
      productName: it.productName || prod.name,
      barcode: it.barcode || prod.barcode || '',
      purchasePriceAtTime: (actor?.role === 'representative' && type !== 'purchase')
        ? dbCost
        : (it.purchasePriceAtTime || dbCost),
    };
  });

  const isPurchaseDispatch = type === 'purchase';
  const sendNow = isPurchaseDispatch && status === 'draft' && Boolean(payload.sendNow);
  const dispatchStatus = isPurchaseDispatch
    ? status === 'confirmed'
      ? 'confirmed'
      : sendNow
      ? 'sent'
      : 'draft'
    : status === 'confirmed'
    ? 'confirmed'
    : 'draft';
  const sentBy = sendNow ? actor.fullName : undefined;
  const sentByUserId = sendNow ? actor.id : undefined;
  const sentAt = sendNow ? now : undefined;
  const recipientUserId = sendNow ? (payload.recipientUserId || undefined) : undefined;
  const recipientName = sendNow ? (String(payload.recipientName || '').trim() || 'الإدارة / المشتريات') : undefined;
  const dispatchHistory = [];
  if (isPurchaseDispatch) {
    dispatchHistory.push({
      id: generateServerId('DSP'),
      action: 'created',
      at: now,
      by: actor.fullName,
      byUserId: actor.id,
      notes: payload.notes ? String(payload.notes).trim() : '',
    });
    if (sendNow) {
      dispatchHistory.push({
        id: generateServerId('DSP'),
        action: 'sent',
        at: now,
        by: actor.fullName,
        byUserId: actor.id,
        recipientUserId,
        recipientName,
        notes: payload.dispatchNotes ? String(payload.dispatchNotes).trim() : '',
      });
    } else if (status === 'confirmed') {
      dispatchHistory.push({
        id: generateServerId('DSP'),
        action: 'confirmed',
        at: now,
        by: actor.fullName,
        byUserId: actor.id,
        notes: 'إنشاء واعتماد مباشر',
      });
    }
  }

  const newInvoice = {
    id: invoiceId,
    invoiceNumber,
    type,
    date: payload.date || todayIso(),
    customerId: payload.customerId || undefined,
    customerName: customerName || undefined,
    supplierId: payload.supplierId || undefined,
    supplierName: supplierName || undefined,
    representativeId: payload.representativeId || undefined,
    representativeName: payload.representativeName || undefined,
    isRepPurchase: type === 'purchase' && Boolean(payload.isRepPurchase || actor?.role === 'representative' || payload.representativeId),
    warehouseId: wh.id,
    warehouseName: wh.name,
    items: enrichedItems,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
    paidAmount: totals.paidAmount,
    appliedAdvanceAmount: totals.appliedAdvanceAmount,
    remainingAmount: totals.remainingAmount,
    paymentType: totals.paymentType,
    paymentMethod: payload.paymentMethod || 'cash',
    cashboxId: cb.id,
    status,
    notes: payload.notes || '',
    payments: [],
    linkedRepTransferId: payload.linkedRepTransferId || undefined,
    linkedRepTransferNumber: payload.linkedRepTransferNumber || undefined,
    linkedCustomerOrderId: payload.linkedCustomerOrderId || undefined,
    returnedQuantityByItem: {},
    originDeviceId: payload.originDeviceId || undefined,
    syncStatus: payload.syncStatus || 'synced',
    reviewStatus,
    dispatchStatus,
    sentBy,
    sentByUserId,
    sentAt,
    recipientUserId,
    recipientName,
    dispatchHistory,
    editHistory: [],
    version: 1,
    createdBy: actor.fullName,
    createdByUserId: actor.id,
    createdAt: now,
  };

  if (status === 'confirmed') {
    applyConfirmedEffectsJsonTx(db, newInvoice, actor);
  }

  db.invoices.unshift(newInvoice);
  return newInvoice;
}

export async function createSalesInvoice(payload, actor, idempotencyKey = '') {
  let enrichedPayload = { ...(payload || {}) };
  if (actor?.role === 'representative') {
    const settings = await getSystemSettingsSafe();
    if (settings.mobileConfig?.enableRepApp === false) {
      throw new AppError(403, 'بوابة المناديب متوقفة حاليًا من إعدادات الإدارة', 'REP_APP_DISABLED');
    }
    const rep = await getRepresentativeByUserId(actor.id);
    if (!rep) {
      throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    }
    if (!enrichedPayload.customerId) {
      throw new AppError(400, 'يجب تحديد عميل معين لإصدار الفاتورة', 'CUSTOMER_REQUIRED');
    }
    const customer = await getCustomerById(enrichedPayload.customerId);
    if (!customer) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    enrichedPayload.representativeId = rep.id;
    enrichedPayload.representativeName = rep.name;
    if (!enrichedPayload.warehouseId && rep.warehouseId) {
      enrichedPayload.warehouseId = rep.warehouseId;
    }
  }

  const endpoint = 'POST /api/invoices/sales';
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  const out = (await isPgMode())
    ? await withTransaction(async (client) => {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice };
        const invoice = await createInvoiceInsidePgTx(client, 'sales', enrichedPayload, actor);
        await savePgIdempotency(client, scopedIdem, actor, endpoint, { invoice });
        return { deduplicated: false, invoice };
      })
    : await withJsonTransaction((db) => {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice };
        const invoice = createInvoiceInsideJsonTx(db, 'sales', enrichedPayload, actor);
        saveJsonIdempotency(scopedIdem, { invoice });
        return { deduplicated: false, invoice };
      });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: out.invoice.status === 'draft' ? `إنشاء مسودة فاتورة مبيعات (${out.invoice.invoiceNumber})` : `إصدار فاتورة مبيعات (${out.invoice.invoiceNumber})`,
      module: 'المبيعات',
      recordId: out.invoice.id,
    });
  }
  return actor?.role === 'representative' ? sanitizeInvoiceForRepresentative(out.invoice) : out.invoice;
}

export async function createPurchaseInvoice(payload, actor, idempotencyKey = '') {
  let enrichedPayload = { ...(payload || {}) };
  const isRep = actor?.role === 'representative';
  const canFullPurchaseConfirm = actor?.role === 'admin' || Boolean(actor?.permissions?.canManagePurchases);

  if (!canFullPurchaseConfirm) {
    if (!isRep && !actor?.permissions?.canCreatePurchase) {
      throw new AppError(403, 'ليس لديك صلاحية إنشاء فواتير الشراء', 'FORBIDDEN_PERMISSION');
    }
    if (enrichedPayload.status === 'confirmed') {
      throw new AppError(
        403,
        'غير مصرح لك باعتماد فاتورة الشراء أو ترحيل المخزون مباشرة؛ يتم حفظها كمسودة أو إرسالها للإدارة للاستلام والاعتماد.',
        'FORBIDDEN_PURCHASE_CONFIRM'
      );
    }
    enrichedPayload.status = 'draft';
  }

  if (isRep) {
    const settings = await getSystemSettingsSafe();
    if (settings.mobileConfig?.enableRepApp === false) {
      throw new AppError(403, 'بوابة المناديب متوقفة حاليًا من إعدادات الإدارة', 'REP_APP_DISABLED');
    }
    const rep = await getRepresentativeByUserId(actor.id);
    if (!rep) {
      throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    }
    enrichedPayload.representativeId = rep.id;
    enrichedPayload.representativeName = rep.name;
    if (!enrichedPayload.warehouseId && rep.warehouseId) {
      enrichedPayload.warehouseId = rep.warehouseId;
    }
  }

  const endpoint = 'POST /api/invoices/purchase';
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  const out = (await isPgMode())
    ? await withTransaction(async (client) => {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice };
        const invoice = await createInvoiceInsidePgTx(client, 'purchase', enrichedPayload, actor);
        await savePgIdempotency(client, scopedIdem, actor, endpoint, { invoice });
        return { deduplicated: false, invoice };
      })
    : await withJsonTransaction((db) => {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice };
        const invoice = createInvoiceInsideJsonTx(db, 'purchase', enrichedPayload, actor);
        saveJsonIdempotency(scopedIdem, { invoice });
        return { deduplicated: false, invoice };
      });

  if (!out.deduplicated) {
    const actionLabel =
      out.invoice.status === 'draft'
        ? out.invoice.dispatchStatus === 'sent'
          ? `إنشاء وإرسال فاتورة شراء (${out.invoice.invoiceNumber}) للإدارة للاستلام`
          : `إنشاء مسودة فاتورة مشتريات (${out.invoice.invoiceNumber})`
        : `إصدار فاتورة مشتريات (${out.invoice.invoiceNumber})`;
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: actionLabel,
      module: 'المشتريات',
      recordId: out.invoice.id,
    });
  }
  return out.invoice;
}

export async function sendPurchaseInvoice(invoiceId, payload = {}, actor, idempotencyKey = '') {
  const perms = actor?.permissions || {};
  const isRep = actor?.role === 'representative';
  const canSendPurchase =
    actor?.role === 'admin' ||
    Boolean(perms.canManagePurchases || perms.canCreatePurchase || perms.canSend);
  if (!canSendPurchase || actor?.role === 'customer') {
    throw new AppError(403, 'ليس لديك صلاحية إرسال فواتير الشراء', 'FORBIDDEN_PERMISSION');
  }
  const repActor = isRep ? await getRepresentativeByUserId(actor.id) : null;
  if (isRep && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }

  const now = nowIso();
  const recipientUserId = payload.recipientUserId ? String(payload.recipientUserId).trim() : null;
  const recipientName = String(payload.recipientName || '').trim() || 'الإدارة / المشتريات';
  const sendNotes = String(payload.notes || '').trim();
  const endpoint = `POST /api/invoices/purchase/${invoiceId}/send`;
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  const out = (await isPgMode())
    ? await withTransaction(async (client) => {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice };

        const inv = await fetchFullInvoicePg(client, invoiceId);
        if (!inv) throw new AppError(404, 'فاتورة الشراء غير موجودة', 'INVOICE_NOT_FOUND');
        if (inv.type !== 'purchase') throw new AppError(400, 'المستند المحدد ليس فاتورة شراء', 'NOT_PURCHASE_INVOICE');
        if (isRep && !isRepOwnerOfInvoice(inv, actor, repActor)) {
          throw new AppError(403, 'غير مصرح لك بإرسال فاتورة شراء تخص مندوبًا آخر', 'FORBIDDEN_INVOICE_ACCESS');
        }
        if (inv.status !== 'draft') {
          throw new AppError(409, 'لا يمكن إرسال فاتورة شراء معتمدة أو ملغاة', 'INVALID_INVOICE_STATUS');
        }
        if (inv.dispatchStatus === 'sent') {
          throw new AppError(409, 'تم إرسال هذه الفاتورة بالفعل وهي بانتظار الاستلام من الإدارة', 'ALREADY_SENT');
        }
        if (inv.dispatchStatus === 'received') {
          throw new AppError(409, 'تم استلام الفاتورة بالفعل من الإدارة ولا يمكن إعادة إرسالها', 'ALREADY_RECEIVED');
        }

        const isResend = inv.dispatchStatus === 'rejected';
        const nextHistory = [
          ...(Array.isArray(inv.dispatchHistory) ? inv.dispatchHistory : []),
          {
            id: generateServerId('DSP'),
            action: isResend ? 'resent' : 'sent',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            recipientUserId: recipientUserId || undefined,
            recipientName,
            notes: sendNotes || undefined,
          },
        ];

        await client.query(
          `UPDATE invoices SET
            dispatch_status = 'sent',
            sent_by = $1,
            sent_by_user_id = $2,
            sent_at = $3,
            recipient_user_id = $4,
            recipient_name = $5,
            rejected_by = NULL,
            rejected_by_user_id = NULL,
            rejected_at = NULL,
            rejection_reason = '',
            dispatch_history = $6,
            version = COALESCE(version, 1) + 1,
            updated_at = $3
           WHERE id = $7`,
          [actor.fullName, actor.id, now, recipientUserId, recipientName, JSON.stringify(nextHistory), invoiceId]
        );

        const updatedInv = await fetchFullInvoicePg(client, invoiceId);
        await savePgIdempotency(client, scopedIdem, actor, endpoint, { invoice: updatedInv });
        return { deduplicated: false, invoice: updatedInv, isResend };
      })
    : await withJsonTransaction((db) => {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice };

        const inv = db.invoices.find((i) => i.id === invoiceId);
        if (!inv) throw new AppError(404, 'فاتورة الشراء غير موجودة', 'INVOICE_NOT_FOUND');
        if (inv.type !== 'purchase') throw new AppError(400, 'المستند المحدد ليس فاتورة شراء', 'NOT_PURCHASE_INVOICE');
        if (isRep && !isRepOwnerOfInvoice(inv, actor, repActor)) {
          throw new AppError(403, 'غير مصرح لك بإرسال فاتورة شراء تخص مندوبًا آخر', 'FORBIDDEN_INVOICE_ACCESS');
        }
        if (inv.status !== 'draft') {
          throw new AppError(409, 'لا يمكن إرسال فاتورة شراء معتمدة أو ملغاة', 'INVALID_INVOICE_STATUS');
        }
        if (inv.dispatchStatus === 'sent') {
          throw new AppError(409, 'تم إرسال هذه الفاتورة بالفعل وهي بانتظار الاستلام من الإدارة', 'ALREADY_SENT');
        }
        if (inv.dispatchStatus === 'received') {
          throw new AppError(409, 'تم استلام الفاتورة بالفعل من الإدارة ولا يمكن إعادة إرسالها', 'ALREADY_RECEIVED');
        }

        const isResend = inv.dispatchStatus === 'rejected';
        inv.dispatchStatus = 'sent';
        inv.sentBy = actor.fullName;
        inv.sentByUserId = actor.id;
        inv.sentAt = now;
        inv.recipientUserId = recipientUserId || undefined;
        inv.recipientName = recipientName;
        inv.rejectedBy = undefined;
        inv.rejectedByUserId = undefined;
        inv.rejectedAt = undefined;
        inv.rejectionReason = undefined;
        inv.dispatchHistory = [
          ...(Array.isArray(inv.dispatchHistory) ? inv.dispatchHistory : []),
          {
            id: generateServerId('DSP'),
            action: isResend ? 'resent' : 'sent',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            recipientUserId: recipientUserId || undefined,
            recipientName,
            notes: sendNotes || undefined,
          },
        ];
        inv.version = Number(inv.version || 1) + 1;
        inv.updatedAt = now;

        saveJsonIdempotency(scopedIdem, { invoice: inv });
        return { deduplicated: false, invoice: inv, isResend };
      });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `${out.isResend ? 'إعادة إرسال' : 'إرسال'} فاتورة شراء (${out.invoice.invoiceNumber}) إلى (${recipientName})`,
      module: 'المشتريات',
      recordId: invoiceId,
      notes: sendNotes,
    });
  }
  return out.invoice;
}

export async function receivePurchaseInvoice(invoiceId, payload = {}, actor, idempotencyKey = '') {
  const perms = actor?.permissions || {};
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'غير مصرح للمندوب أو العميل باستلام فواتير الشراء الواردة', 'FORBIDDEN_RECEIVE_PURCHASE');
  }
  const confirmNow = Boolean(payload?.confirmNow);
  if (confirmNow) {
    if (actor?.role !== 'admin' && !perms.canManagePurchases && !perms.canApprove) {
      throw new AppError(403, 'ليس لديك صلاحية اعتماد وترحيل فواتير الشراء', 'FORBIDDEN_PERMISSION');
    }
  } else if (actor?.role !== 'admin' && !perms.canManagePurchases && !perms.canApprove && !perms.canReceive) {
    throw new AppError(403, 'ليس لديك صلاحية استلام فواتير الشراء', 'FORBIDDEN_PERMISSION');
  }

  const now = nowIso();
  const receiveNotes = String(payload?.notes || '').trim();
  const overrideWarehouseId = payload?.warehouseId ? String(payload.warehouseId).trim() : '';
  const overrideCashboxId = payload?.cashboxId ? String(payload.cashboxId).trim() : '';
  const endpoint = `POST /api/invoices/purchase/${invoiceId}/receive`;
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  const out = (await isPgMode())
    ? await withTransaction(async (client) => {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice, confirmedNow: Boolean(dup.confirmedNow) };

        const inv = await fetchFullInvoicePg(client, invoiceId);
        if (!inv) throw new AppError(404, 'فاتورة الشراء غير موجودة', 'INVOICE_NOT_FOUND');
        if (inv.type !== 'purchase') throw new AppError(400, 'المستند المحدد ليس فاتورة شراء', 'NOT_PURCHASE_INVOICE');
        if (inv.status === 'confirmed') throw new AppError(409, 'تم اعتماد وترحيل الفاتورة مسبقًا', 'ALREADY_CONFIRMED');
        if (inv.status !== 'draft') throw new AppError(409, 'لا يمكن استلام فاتورة شراء ملغاة', 'INVALID_INVOICE_STATUS');
        if (inv.dispatchStatus === 'received' && !confirmNow) {
          throw new AppError(409, 'تم استلام هذه الفاتورة مسبقًا', 'ALREADY_RECEIVED');
        }
        if (inv.dispatchStatus !== 'sent' && !(confirmNow && inv.dispatchStatus === 'received')) {
          throw new AppError(409, 'لا يمكن استلام الفاتورة إلا بعد إرسالها من المندوب', 'PURCHASE_NOT_SENT');
        }

        let targetWarehouseId = inv.warehouseId;
        let targetWarehouseName = inv.warehouseName;
        if (overrideWarehouseId) {
          const whRow = (await client.query(`SELECT id, name FROM warehouses WHERE id = $1 LIMIT 1`, [overrideWarehouseId])).rows[0];
          if (!whRow) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
          targetWarehouseId = whRow.id;
          targetWarehouseName = whRow.name;
        }

        let targetCashboxId = inv.cashboxId;
        if (overrideCashboxId) {
          const cbRow = (await client.query(`SELECT id FROM cashboxes WHERE id = $1 LIMIT 1`, [overrideCashboxId])).rows[0];
          if (!cbRow) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
          targetCashboxId = cbRow.id;
        }

        const nextHistory = [...(Array.isArray(inv.dispatchHistory) ? inv.dispatchHistory : [])];
        if (inv.dispatchStatus !== 'received') {
          nextHistory.push({
            id: generateServerId('DSP'),
            action: 'received',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            notes: receiveNotes || (confirmNow ? 'تم الاستلام والاعتماد المباشر' : 'تم الاستلام وبانتظار المراجعة والاعتماد'),
          });
        }

        if (confirmNow) {
          const invToConfirm = {
            ...inv,
            warehouseId: targetWarehouseId,
            warehouseName: targetWarehouseName,
            cashboxId: targetCashboxId,
          };
          await applyConfirmedEffectsPgTx(client, invToConfirm, actor);
          nextHistory.push({
            id: generateServerId('DSP'),
            action: 'confirmed',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            notes: receiveNotes || 'استلام واعتماد وترحيل للمخزون والحسابات',
          });
          await client.query(
            `UPDATE invoices SET
              status = 'confirmed',
              dispatch_status = 'confirmed',
              warehouse_id = $1,
              warehouse_name = $2,
              cashbox_id = $3,
              received_by = COALESCE(received_by, $4),
              received_by_user_id = COALESCE(received_by_user_id, $5),
              received_at = COALESCE(received_at, $6),
              dispatch_history = $7,
              version = COALESCE(version, 1) + 1,
              updated_at = $6
             WHERE id = $8`,
            [
              targetWarehouseId,
              targetWarehouseName,
              targetCashboxId,
              actor.fullName,
              actor.id,
              now,
              JSON.stringify(nextHistory),
              invoiceId,
            ]
          );
        } else {
          await client.query(
            `UPDATE invoices SET
              dispatch_status = 'received',
              warehouse_id = $1,
              warehouse_name = $2,
              cashbox_id = $3,
              received_by = $4,
              received_by_user_id = $5,
              received_at = $6,
              dispatch_history = $7,
              version = COALESCE(version, 1) + 1,
              updated_at = $6
             WHERE id = $8`,
            [
              targetWarehouseId,
              targetWarehouseName,
              targetCashboxId,
              actor.fullName,
              actor.id,
              now,
              JSON.stringify(nextHistory),
              invoiceId,
            ]
          );
        }

        const updatedInv = await fetchFullInvoicePg(client, invoiceId);
        await savePgIdempotency(client, scopedIdem, actor, endpoint, { invoice: updatedInv, confirmedNow: confirmNow });
        return { deduplicated: false, invoice: updatedInv, confirmedNow: confirmNow };
      })
    : await withJsonTransaction((db) => {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice, confirmedNow: Boolean(dup.confirmedNow) };

        const inv = db.invoices.find((i) => i.id === invoiceId);
        if (!inv) throw new AppError(404, 'فاتورة الشراء غير موجودة', 'INVOICE_NOT_FOUND');
        if (inv.type !== 'purchase') throw new AppError(400, 'المستند المحدد ليس فاتورة شراء', 'NOT_PURCHASE_INVOICE');
        if (inv.status === 'confirmed') throw new AppError(409, 'تم اعتماد وترحيل الفاتورة مسبقًا', 'ALREADY_CONFIRMED');
        if (inv.status !== 'draft') throw new AppError(409, 'لا يمكن استلام فاتورة شراء ملغاة', 'INVALID_INVOICE_STATUS');
        if (inv.dispatchStatus === 'received' && !confirmNow) {
          throw new AppError(409, 'تم استلام هذه الفاتورة مسبقًا', 'ALREADY_RECEIVED');
        }
        if (inv.dispatchStatus !== 'sent' && !(confirmNow && inv.dispatchStatus === 'received')) {
          throw new AppError(409, 'لا يمكن استلام الفاتورة إلا بعد إرسالها من المندوب', 'PURCHASE_NOT_SENT');
        }

        if (overrideWarehouseId) {
          const wh = (db.warehouses || []).find((w) => w.id === overrideWarehouseId);
          if (!wh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
          inv.warehouseId = wh.id;
          inv.warehouseName = wh.name;
        }
        if (overrideCashboxId) {
          const cb = (db.cashboxes || []).find((c) => c.id === overrideCashboxId);
          if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
          inv.cashboxId = cb.id;
        }

        const wasReceived = inv.dispatchStatus === 'received';
        const nextHistory = [...(Array.isArray(inv.dispatchHistory) ? inv.dispatchHistory : [])];
        if (!wasReceived) {
          nextHistory.push({
            id: generateServerId('DSP'),
            action: 'received',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            notes: receiveNotes || (confirmNow ? 'تم الاستلام والاعتماد المباشر' : 'تم الاستلام وبانتظار المراجعة والاعتماد'),
          });
        }
        if (!inv.receivedBy) inv.receivedBy = actor.fullName;
        if (!inv.receivedByUserId) inv.receivedByUserId = actor.id;
        if (!inv.receivedAt) inv.receivedAt = now;

        if (confirmNow) {
          applyConfirmedEffectsJsonTx(db, inv, actor);
          inv.status = 'confirmed';
          inv.dispatchStatus = 'confirmed';
          nextHistory.push({
            id: generateServerId('DSP'),
            action: 'confirmed',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            notes: receiveNotes || 'استلام واعتماد وترحيل للمخزون والحسابات',
          });
        } else {
          inv.dispatchStatus = 'received';
        }

        inv.dispatchHistory = nextHistory;
        inv.version = Number(inv.version || 1) + 1;
        inv.updatedAt = now;

        saveJsonIdempotency(scopedIdem, { invoice: inv, confirmedNow: confirmNow });
        return { deduplicated: false, invoice: inv, confirmedNow: confirmNow };
      });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: out.confirmedNow
        ? `استلام واعتماد فاتورة شراء من المندوب (${out.invoice.invoiceNumber}) وترحيل المخزون`
        : `استلام فاتورة شراء من المندوب (${out.invoice.invoiceNumber}) دون ترحيل مخزني`,
      module: 'المشتريات',
      recordId: invoiceId,
      notes: receiveNotes,
    });
  }
  return out.invoice;
}

export async function rejectPurchaseInvoice(invoiceId, payload = {}, actor) {
  const perms = actor?.permissions || {};
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'غير مصرح للمندوب أو العميل برفض فواتير الشراء', 'FORBIDDEN_REJECT_PURCHASE');
  }
  if (actor?.role !== 'admin' && !perms.canManagePurchases && !perms.canApprove && !perms.canReceive) {
    throw new AppError(403, 'ليس لديك صلاحية رفض فواتير الشراء', 'FORBIDDEN_PERMISSION');
  }

  const cleanReason = String(payload.reason || '').trim();
  if (!cleanReason) {
    throw new AppError(400, 'يرجى إدخال سبب رفض فاتورة الشراء', 'REJECTION_REASON_REQUIRED');
  }
  const now = nowIso();

  const updated = (await isPgMode())
    ? await withTransaction(async (client) => {
        const inv = await fetchFullInvoicePg(client, invoiceId);
        if (!inv) throw new AppError(404, 'فاتورة الشراء غير موجودة', 'INVOICE_NOT_FOUND');
        if (inv.type !== 'purchase') throw new AppError(400, 'المستند المحدد ليس فاتورة شراء', 'NOT_PURCHASE_INVOICE');
        if (inv.status === 'confirmed') {
          throw new AppError(409, 'لا يمكن رفض فاتورة شراء تم اعتمادها وترحيلها بالفعل', 'ALREADY_CONFIRMED');
        }
        if (inv.status !== 'draft') {
          throw new AppError(409, 'لا يمكن رفض فاتورة ملغاة', 'INVALID_INVOICE_STATUS');
        }
        if (!['sent', 'received'].includes(inv.dispatchStatus)) {
          throw new AppError(409, 'لا يمكن رفض الفاتورة في حالتها الحالية', 'INVALID_DISPATCH_STATUS');
        }

        const nextHistory = [
          ...(Array.isArray(inv.dispatchHistory) ? inv.dispatchHistory : []),
          {
            id: generateServerId('DSP'),
            action: 'rejected',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            reason: cleanReason,
          },
        ];

        await client.query(
          `UPDATE invoices SET
            dispatch_status = 'rejected',
            rejected_by = $1,
            rejected_by_user_id = $2,
            rejected_at = $3,
            rejection_reason = $4,
            dispatch_history = $5,
            version = COALESCE(version, 1) + 1,
            updated_at = $3
           WHERE id = $6`,
          [actor.fullName, actor.id, now, cleanReason, JSON.stringify(nextHistory), invoiceId]
        );
        return fetchFullInvoicePg(client, invoiceId);
      })
    : await withJsonTransaction((db) => {
        const inv = db.invoices.find((i) => i.id === invoiceId);
        if (!inv) throw new AppError(404, 'فاتورة الشراء غير موجودة', 'INVOICE_NOT_FOUND');
        if (inv.type !== 'purchase') throw new AppError(400, 'المستند المحدد ليس فاتورة شراء', 'NOT_PURCHASE_INVOICE');
        if (inv.status === 'confirmed') {
          throw new AppError(409, 'لا يمكن رفض فاتورة شراء تم اعتمادها وترحيلها بالفعل', 'ALREADY_CONFIRMED');
        }
        if (inv.status !== 'draft') {
          throw new AppError(409, 'لا يمكن رفض فاتورة ملغاة', 'INVALID_INVOICE_STATUS');
        }
        if (!['sent', 'received'].includes(inv.dispatchStatus)) {
          throw new AppError(409, 'لا يمكن رفض الفاتورة في حالتها الحالية', 'INVALID_DISPATCH_STATUS');
        }

        inv.dispatchStatus = 'rejected';
        inv.rejectedBy = actor.fullName;
        inv.rejectedByUserId = actor.id;
        inv.rejectedAt = now;
        inv.rejectionReason = cleanReason;
        inv.dispatchHistory = [
          ...(Array.isArray(inv.dispatchHistory) ? inv.dispatchHistory : []),
          {
            id: generateServerId('DSP'),
            action: 'rejected',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            reason: cleanReason,
          },
        ];
        inv.version = Number(inv.version || 1) + 1;
        inv.updatedAt = now;
        return inv;
      });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `رفض فاتورة شراء (${updated.invoiceNumber}) — السبب: ${cleanReason}`,
    module: 'المشتريات',
    recordId: invoiceId,
    notes: cleanReason,
  });
  return updated;
}

export async function createSalesQuote(payload, actor, idempotencyKey = '') {
  let enrichedPayload = { ...(payload || {}), status: 'confirmed', paymentType: 'credit', paidAmount: 0 };
  if (actor?.role === 'representative') {
    const rep = await getRepresentativeByUserId(actor.id);
    if (!rep) throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    if (enrichedPayload.customerId) {
      const cust = await getCustomerById(enrichedPayload.customerId);
      if (!cust) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    }
    enrichedPayload.representativeId = rep.id;
    enrichedPayload.representativeName = rep.name;
    if (!enrichedPayload.warehouseId && rep.warehouseId) enrichedPayload.warehouseId = rep.warehouseId;
  }

  const endpoint = 'POST /api/invoices/quotes';
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  const out = (await isPgMode())
    ? await withTransaction(async (client) => {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice };
        const quote = await createInvoiceInsidePgTx(client, 'quote', enrichedPayload, actor);
        await savePgIdempotency(client, scopedIdem, actor, endpoint, { invoice: quote });
        return { deduplicated: false, invoice: quote };
      })
    : await withJsonTransaction((db) => {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.invoice) return { deduplicated: true, invoice: dup.invoice };
        const quote = createInvoiceInsideJsonTx(db, 'quote', enrichedPayload, actor);
        saveJsonIdempotency(scopedIdem, { invoice: quote });
        return { deduplicated: false, invoice: quote };
      });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إصدار عرض سعر (${out.invoice.invoiceNumber}) بدون تأثير على المخزون أو الحسابات`,
      module: 'المبيعات',
      recordId: out.invoice.id,
    });
  }
  return actor?.role === 'representative' ? sanitizeInvoiceForRepresentative(out.invoice) : out.invoice;
}

export async function convertQuoteToInvoice(quoteId, overrides = {}, actor, idempotencyKey = '') {
  const endpoint = `POST /api/invoices/quotes/${quoteId}/convert`;
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);
  const now = nowIso();

  const out = (await isPgMode())
    ? await withTransaction(async (client) => {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.invoice) return { deduplicated: true, ...dup };
        const quote = await fetchFullInvoicePg(client, quoteId);
        if (!quote) throw new AppError(404, 'عرض السعر غير موجود', 'QUOTE_NOT_FOUND');
        if (quote.type !== 'quote') throw new AppError(400, 'المستند المحدد ليس عرض سعر', 'NOT_A_QUOTE');
        if (quote.status === 'cancelled') throw new AppError(409, 'عرض السعر ملغى', 'QUOTE_CANCELLED');

        const invoicePayload = {
          customerId: overrides.customerId || quote.customerId,
          customerName: overrides.customerName || quote.customerName,
          representativeId: overrides.representativeId || quote.representativeId,
          representativeName: overrides.representativeName || quote.representativeName,
          warehouseId: overrides.warehouseId || quote.warehouseId,
          cashboxId: overrides.cashboxId || quote.cashboxId,
          paymentType: overrides.paymentType || 'credit',
          paymentMethod: overrides.paymentMethod || 'cash',
          paidAmount: overrides.paidAmount ?? 0,
          discountTotal: overrides.discountTotal ?? quote.discountTotal,
          taxTotal: overrides.taxTotal ?? quote.taxTotal,
          date: overrides.date || todayIso(),
          status: overrides.status === 'draft' ? 'draft' : 'confirmed',
          items: overrides.items || quote.items,
          notes: overrides.notes || `فاتورة محولة من عرض السعر رقم ${quote.invoiceNumber}`,
        };
        const invoice = await createInvoiceInsidePgTx(client, 'sales', invoicePayload, actor);
        await client.query(
          `UPDATE invoices SET notes = $1, updated_at = $2 WHERE id = $3`,
          [`${quote.notes ? quote.notes + ' ' : ''}[تم التحويل للفاتورة ${invoice.invoiceNumber}]`.trim(), now, quoteId]
        );
        const resultPayload = { invoice, quoteId };
        await savePgIdempotency(client, scopedIdem, actor, endpoint, resultPayload);
        return { deduplicated: false, ...resultPayload };
      })
    : await withJsonTransaction((db) => {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.invoice) return { deduplicated: true, ...dup };
        const quote = db.invoices.find((i) => i.id === quoteId);
        if (!quote) throw new AppError(404, 'عرض السعر غير موجود', 'QUOTE_NOT_FOUND');
        if (quote.type !== 'quote') throw new AppError(400, 'المستند المحدد ليس عرض سعر', 'NOT_A_QUOTE');
        if (quote.status === 'cancelled') throw new AppError(409, 'عرض السعر ملغى', 'QUOTE_CANCELLED');

        const invoicePayload = {
          customerId: overrides.customerId || quote.customerId,
          customerName: overrides.customerName || quote.customerName,
          representativeId: overrides.representativeId || quote.representativeId,
          representativeName: overrides.representativeName || quote.representativeName,
          warehouseId: overrides.warehouseId || quote.warehouseId,
          cashboxId: overrides.cashboxId || quote.cashboxId,
          paymentType: overrides.paymentType || 'credit',
          paymentMethod: overrides.paymentMethod || 'cash',
          paidAmount: overrides.paidAmount ?? 0,
          discountTotal: overrides.discountTotal ?? quote.discountTotal,
          taxTotal: overrides.taxTotal ?? quote.taxTotal,
          date: overrides.date || todayIso(),
          status: overrides.status === 'draft' ? 'draft' : 'confirmed',
          items: overrides.items || quote.items,
          notes: overrides.notes || `فاتورة محولة من عرض السعر رقم ${quote.invoiceNumber}`,
        };
        const invoice = createInvoiceInsideJsonTx(db, 'sales', invoicePayload, actor);
        quote.notes = `${quote.notes ? quote.notes + ' ' : ''}[تم التحويل للفاتورة ${invoice.invoiceNumber}]`.trim();
        quote.updatedAt = now;
        const resultPayload = { invoice, quoteId };
        saveJsonIdempotency(scopedIdem, resultPayload);
        return { deduplicated: false, ...resultPayload };
      });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحويل عرض السعر إلى فاتورة مبيعات (${out.invoice.invoiceNumber})`,
      module: 'المبيعات',
      recordId: out.invoice.id,
    });
  }
  return actor?.role === 'representative' ? sanitizeInvoiceForRepresentative(out.invoice) : out.invoice;
}

async function fetchFullInvoicePg(client, invoiceId) {
  const invRes = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
  if (!invRes.rows[0]) return null;
  const itemsRes = await client.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
  const paysRes = await client.query(`SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY created_at ASC`, [invoiceId]);
  return mapPgInvoiceRow(invRes.rows[0], itemsRes.rows, paysRes.rows);
}

export async function confirmDraftInvoice(invoiceId, actor) {
  const now = nowIso();
  const repActor = actor?.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor?.role === 'representative' && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }

  let confirmedInvoice;
  if (await isPgMode()) {
    confirmedInvoice = await withTransaction(async (client) => {
      const inv = await fetchFullInvoicePg(client, invoiceId);
      if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
      if (inv.status === 'confirmed') throw new AppError(409, 'تم اعتماد هذه الفاتورة مسبقًا (ممنوع تكرار خصم المخزون)', 'ALREADY_CONFIRMED');
      if (inv.status !== 'draft') throw new AppError(409, 'لا يمكن اعتماد فاتورة ملغاة', 'INVALID_INVOICE_STATUS');

      if (inv.type === 'purchase') {
        if (actor?.role === 'representative' || actor?.role === 'customer') {
          throw new AppError(
            403,
            'غير مصرح للمندوب باعتماد فاتورة الشراء أو ترحيل المخزون؛ يتم الاعتماد من الإدارة أو قسم المشتريات فقط.',
            'FORBIDDEN_PURCHASE_CONFIRM'
          );
        }
        if (actor?.role !== 'admin' && !actor?.permissions?.canManagePurchases && !actor?.permissions?.canApprove) {
          throw new AppError(403, 'ليس لديك صلاحية اعتماد وترحيل فواتير الشراء', 'FORBIDDEN_PERMISSION');
        }
        if (inv.dispatchStatus === 'rejected') {
          throw new AppError(409, 'لا يمكن اعتماد فاتورة شراء مرفوضة؛ يجب تعديلها وإعادة إرسالها أولاً', 'INVOICE_REJECTED');
        }
      } else if (inv.type === 'sales') {
        if (actor?.role !== 'admin' && !actor?.permissions?.canManageSales) {
          throw new AppError(403, 'ليس لديك صلاحية اعتماد فواتير المبيعات', 'FORBIDDEN_PERMISSION');
        }
      }

      if (repActor) {
        if (inv.representativeId && inv.representativeId !== repActor.id) {
          throw new AppError(403, 'غير مصرح لك باعتماد فاتورة مندوب آخر', 'FORBIDDEN_INVOICE_ACCESS');
        }
      }

      if (inv.linkedRepTransferId) {
        const ritRes = await client.query('SELECT status FROM rep_item_transfers WHERE id = $1 LIMIT 1', [inv.linkedRepTransferId]);
        const rit = ritRes.rows[0];
        if (rit && !['executed', 'received'].includes(rit.status)) {
          throw new AppError(
            409,
            'لا يمكن اعتماد المسودة قبل تنفيذ طلب تحويل الأصناف المرتبط بها من الإدارة أولاً.',
            'LINKED_TRANSFER_NOT_EXECUTED'
          );
        }
      }

      await applyConfirmedEffectsPgTx(client, inv, actor);
      const nextReviewStatus =
        inv.type === 'sales' && actor?.role === 'representative'
          ? 'needs_review'
          : inv.reviewStatus || 'not_required';
      if (inv.type === 'purchase') {
        const nextHistory = [
          ...(Array.isArray(inv.dispatchHistory) ? inv.dispatchHistory : []),
          {
            id: generateServerId('DSP'),
            action: 'confirmed',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            notes: 'اعتماد وترحيل للمخزون والحسابات',
          },
        ];
        await client.query(
          `UPDATE invoices SET
            status = 'confirmed',
            dispatch_status = 'confirmed',
            received_by = COALESCE(received_by, $1),
            received_by_user_id = COALESCE(received_by_user_id, $2),
            received_at = COALESCE(received_at, $3),
            dispatch_history = $4,
            review_status = $5,
            version = COALESCE(version, 1) + 1,
            updated_at = $3
           WHERE id = $6`,
          [actor.fullName, actor.id, now, JSON.stringify(nextHistory), nextReviewStatus, invoiceId]
        );
      } else {
        await client.query(`UPDATE invoices SET status = 'confirmed', review_status = $1, updated_at = $2 WHERE id = $3`, [nextReviewStatus, now, invoiceId]);
      }
      if (inv.linkedCustomerOrderId && Number(inv.appliedAdvanceAmount || 0) > 0) {
        await client.query(
          `UPDATE order_advance_payments SET status = 'applied', applied_invoice_id = $1 WHERE order_id = $2 AND status = 'active'`,
          [invoiceId, inv.linkedCustomerOrderId]
        );
      }
      return fetchFullInvoicePg(client, invoiceId);
    });
  } else {
    confirmedInvoice = await withJsonTransaction(async (db) => {
      const inv = db.invoices.find((i) => i.id === invoiceId);
      if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
      if (inv.status === 'confirmed') throw new AppError(409, 'تم اعتماد هذه الفاتورة مسبقًا (ممنوع تكرار خصم المخزون)', 'ALREADY_CONFIRMED');
      if (inv.status !== 'draft') throw new AppError(409, 'لا يمكن اعتماد فاتورة ملغاة', 'INVALID_INVOICE_STATUS');

      if (inv.type === 'purchase') {
        if (actor?.role === 'representative' || actor?.role === 'customer') {
          throw new AppError(
            403,
            'غير مصرح للمندوب باعتماد فاتورة الشراء أو ترحيل المخزون؛ يتم الاعتماد من الإدارة أو قسم المشتريات فقط.',
            'FORBIDDEN_PURCHASE_CONFIRM'
          );
        }
        if (actor?.role !== 'admin' && !actor?.permissions?.canManagePurchases && !actor?.permissions?.canApprove) {
          throw new AppError(403, 'ليس لديك صلاحية اعتماد وترحيل فواتير الشراء', 'FORBIDDEN_PERMISSION');
        }
        if (inv.dispatchStatus === 'rejected') {
          throw new AppError(409, 'لا يمكن اعتماد فاتورة شراء مرفوضة؛ يجب تعديلها وإعادة إرسالها أولاً', 'INVOICE_REJECTED');
        }
      } else if (inv.type === 'sales') {
        if (actor?.role !== 'admin' && !actor?.permissions?.canManageSales) {
          throw new AppError(403, 'ليس لديك صلاحية اعتماد فواتير المبيعات', 'FORBIDDEN_PERMISSION');
        }
      }

      if (repActor) {
        if (inv.representativeId && inv.representativeId !== repActor.id) {
          throw new AppError(403, 'غير مصرح لك باعتماد فاتورة مندوب آخر', 'FORBIDDEN_INVOICE_ACCESS');
        }
      }

      if (inv.linkedRepTransferId) {
        const rit = (db.repItemTransfers || []).find((x) => x.id === inv.linkedRepTransferId);
        if (rit && !['executed', 'received'].includes(rit.status)) {
          throw new AppError(
            409,
            'لا يمكن اعتماد المسودة قبل تنفيذ طلب تحويل الأصناف المرتبط بها من الإدارة أولاً.',
            'LINKED_TRANSFER_NOT_EXECUTED'
          );
        }
      }

      applyConfirmedEffectsJsonTx(db, inv, actor);
      inv.status = 'confirmed';
      if (inv.type === 'purchase') {
        inv.dispatchStatus = 'confirmed';
        if (!inv.receivedBy) inv.receivedBy = actor.fullName;
        if (!inv.receivedByUserId) inv.receivedByUserId = actor.id;
        if (!inv.receivedAt) inv.receivedAt = now;
        inv.dispatchHistory = [
          ...(Array.isArray(inv.dispatchHistory) ? inv.dispatchHistory : []),
          {
            id: generateServerId('DSP'),
            action: 'confirmed',
            at: now,
            by: actor.fullName,
            byUserId: actor.id,
            notes: 'اعتماد وترحيل للمخزون والحسابات',
          },
        ];
        inv.version = Number(inv.version || 1) + 1;
      }
      if (inv.type === 'sales' && actor?.role === 'representative') {
        inv.reviewStatus = 'needs_review';
      }
      inv.updatedAt = now;
      if (inv.linkedCustomerOrderId && Number(inv.appliedAdvanceAmount || 0) > 0) {
        for (const adv of db.orderAdvancePayments || []) {
          if (adv.orderId === inv.linkedCustomerOrderId && adv.status === 'active') {
            adv.status = 'applied';
            adv.appliedInvoiceId = inv.id;
          }
        }
      }
      return inv;
    });
  }

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `اعتماد فاتورة وخصم/تحديث المخزون (${confirmedInvoice.invoiceNumber})`,
    module: confirmedInvoice.type === 'sales' ? 'المبيعات' : 'المشتريات',
    recordId: confirmedInvoice.id,
  });
  return actor?.role === 'representative' ? sanitizeInvoiceForRepresentative(confirmedInvoice) : confirmedInvoice;
}

export async function editSalesInvoice(invoiceId, updates, actor) {
  if (actor?.role !== 'admin' && (!actor?.permissions?.canManageSales || !actor?.permissions?.canEdit)) {
    throw new AppError(403, 'ليس لديك صلاحية تعديل فواتير المبيعات', 'FORBIDDEN_PERMISSION');
  }
  const now = nowIso();
  const cleanReason = String(updates?.reason || '').trim();
  const repActor = actor?.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor?.role === 'representative' && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const inv = await fetchFullInvoicePg(client, invoiceId);
      if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
      if (inv.type === 'purchase') {
        throw new AppError(400, 'يرجى استخدام مسار تعديل فواتير المشتريات', 'WRONG_INVOICE_TYPE');
      }
      if (inv.status === 'cancelled') throw new AppError(409, 'لا يمكن تعديل فاتورة ملغاة', 'INVOICE_CANCELLED');
      if (
        !updates?.ignoreVersionCheck &&
        updates?.baseVersion !== undefined &&
        Number(inv.version || 1) !== Number(updates.baseVersion)
      ) {
        throw new AppError(
          409,
          `تم تعديل الفاتورة (${inv.invoiceNumber}) لإصدار أحدث (${inv.version}) على الخادم.`,
          'VERSION_CONFLICT',
          { serverSnapshot: inv }
        );
      }

      if (repActor && !isRepOwnerOfInvoice(inv, actor, repActor)) {
        throw new AppError(403, 'غير مصرح لك بتعديل فاتورة لمندوب آخر', 'FORBIDDEN_INVOICE_ACCESS');
      }

      const stRes = await client.query(`SELECT allow_negative_stock FROM system_settings LIMIT 1`);
      const allowNeg = Boolean(stRes.rows[0]?.allow_negative_stock) && Boolean(actor?.permissions?.canAllowNegativeInventory);

      const newItemsRaw = updates.items || inv.items;
      const totals = recomputeInvoiceTotals(
        {
          items: newItemsRaw,
          discountTotal: updates.discountTotal ?? inv.discountTotal,
          paidAmount: inv.paidAmount,
          appliedAdvanceAmount: inv.appliedAdvanceAmount || 0,
        },
        inv.items
      );

      if (totals.grandTotal < round2(Number(inv.paidAmount || 0)) - 0.01) {
        throw new AppError(
          400,
          `إجمالي الفاتورة المعدّل (${totals.grandTotal}) لا يمكن أن يكون أقل من المبلغ المدفوع مسبقاً (${inv.paidAmount})`,
          'GRAND_TOTAL_BELOW_PAID'
        );
      }

      // Enforce returnedQuantityByItem lower bound
      const newQtyByProduct = new Map();
      for (const it of totals.items) {
        newQtyByProduct.set(it.productId, round3((newQtyByProduct.get(it.productId) || 0) + Number(it.quantity || 0)));
      }
      for (const [pid, retQtyRaw] of Object.entries(inv.returnedQuantityByItem || {})) {
        const retQty = round3(retQtyRaw);
        if (retQty <= 0) continue;
        const newQty = Number(newQtyByProduct.get(pid) || 0);
        if (newQty + 0.0001 < retQty) {
          throw new AppError(
            400,
            `لا يمكن تقليل كمية الصنف عن الكمية المرتجعة مسبقاً (${retQty})`,
            'BELOW_RETURNED_QUANTITY'
          );
        }
      }

      const beforeSnapshot = {
        date: inv.date,
        items: inv.items,
        subtotal: inv.subtotal,
        discountTotal: inv.discountTotal,
        grandTotal: inv.grandTotal,
        paidAmount: inv.paidAmount,
        remainingAmount: inv.remainingAmount,
        paymentType: inv.paymentType,
        notes: inv.notes || '',
      };

      if (inv.status === 'confirmed' && inv.type !== 'quote') {
        const oldBaseByProd = new Map();
        const newBaseByProd = new Map();
        const metaByProd = new Map();

        for (const oldItem of inv.items) {
          const baseQty = round3(oldItem.quantity * (oldItem.unitFactor || 1));
          oldBaseByProd.set(oldItem.productId, round3((oldBaseByProd.get(oldItem.productId) || 0) + baseQty));
          metaByProd.set(oldItem.productId, oldItem);
        }
        for (const newItem of totals.items) {
          const baseQty = round3(newItem.quantity * (newItem.unitFactor || 1));
          newBaseByProd.set(newItem.productId, round3((newBaseByProd.get(newItem.productId) || 0) + baseQty));
          metaByProd.set(newItem.productId, newItem);
        }

        const whRes = await client.query(`SELECT name FROM warehouses WHERE id = $1 LIMIT 1`, [inv.warehouseId]);
        const warehouseName = whRes.rows[0]?.name || inv.warehouseName || '';
        const allPids = new Set([...oldBaseByProd.keys(), ...newBaseByProd.keys()]);

        for (const pid of allPids) {
          const oldBase = Number(oldBaseByProd.get(pid) || 0);
          const newBase = Number(newBaseByProd.get(pid) || 0);
          const deltaOut = round3(newBase - oldBase);
          const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [pid]);
          const prod = pRes.rows[0];
          if (!prod) {
            if (newBase > 0) throw new AppError(404, `الصنف غير موجود (${metaByProd.get(pid)?.productName || pid})`, 'PRODUCT_NOT_FOUND');
            continue;
          }
          if (deltaOut === 0) continue;

          const stockMap = { ...(prod.stock_per_warehouse || {}) };
          const curQty = Number(stockMap[inv.warehouseId] || 0);
          const nextQty = round3(curQty - deltaOut);
          if (deltaOut > 0 && nextQty < 0 && !allowNeg) {
            throw new AppError(409, `الرصيد المتاح من (${prod.name}) لا يكفي للتعديل (المتاح: ${curQty}، المطلوب زيادة: ${deltaOut})`, 'INSUFFICIENT_STOCK');
          }
          stockMap[inv.warehouseId] = nextQty;
          await client.query(`UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3`, [JSON.stringify(stockMap), now, prod.id]);

          const mvId = generateServerId('SM');
          const refItem = metaByProd.get(pid);
          await client.query(
            `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_before, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_by_user_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'sale_edit',$8,$9,1,$10,$11,$12,'sales',$13,$14,$15,$16,$17,$18)`,
            [
              mvId,
              mvId,
              updates.date || inv.date,
              prod.id,
              prod.name,
              inv.warehouseId,
              warehouseName,
              Math.abs(deltaOut),
              prod.base_unit || refItem?.unit || 'قطعة',
              Number(refItem?.purchasePriceAtTime || prod.purchase_price || 0),
              curQty,
              nextQty,
              inv.id,
              inv.invoiceNumber,
              `تعديل فاتورة مبيعات رقم ${inv.invoiceNumber} (${deltaOut > 0 ? 'خصم فرق ' : 'رد فرق '}${Math.abs(deltaOut)})${cleanReason ? ` - السبب: ${cleanReason}` : ''}`,
              actor.fullName,
              actor.id || null,
              now,
            ]
          );
        }

        const diff = round2(totals.grandTotal - inv.grandTotal);
        if (inv.customerId && diff !== 0) {
          const cRes = await client.query(`SELECT current_balance FROM customers WHERE id = $1 FOR UPDATE`, [inv.customerId]);
          if (cRes.rows[0]) {
            await client.query(`UPDATE customers SET current_balance = $1, updated_at = $2 WHERE id = $3`, [
              round2(Number(cRes.rows[0].current_balance || 0) + diff),
              now,
              inv.customerId,
            ]);
          }
        }
      }

      const afterSnapshot = {
        date: updates.date || inv.date,
        items: totals.items,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        grandTotal: totals.grandTotal,
        paidAmount: inv.paidAmount,
        remainingAmount: totals.remainingAmount,
        paymentType: totals.paymentType,
        notes: updates.notes !== undefined ? updates.notes : (inv.notes || ''),
      };
      const editEntry = {
        id: generateServerId('EDT'),
        editedAt: now,
        editedBy: actor.fullName,
        editedByUserId: actor.id,
        reason: cleanReason || undefined,
        before: beforeSnapshot,
        after: afterSnapshot,
      };
      const nextEditHistory = [...(Array.isArray(inv.editHistory) ? inv.editHistory : []), editEntry];

      await client.query(
        `UPDATE invoices SET date = $1, subtotal = $2, discount_total = $3, grand_total = $4, remaining_amount = $5, payment_type = $6, notes = $7, edited_by = $8, edited_at = $9, edit_history = $10, version = COALESCE(version, 1) + 1, updated_at = $9 WHERE id = $11`,
        [
          afterSnapshot.date,
          totals.subtotal,
          totals.discountTotal,
          totals.grandTotal,
          totals.remainingAmount,
          totals.paymentType,
          afterSnapshot.notes,
          actor.fullName,
          now,
          JSON.stringify(nextEditHistory),
          invoiceId,
        ]
      );
      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
      const oldCostByProduct = new Map((inv.items || []).map((o) => [o.productId, Number(o.purchasePriceAtTime || 0)]));
      for (let idx = 0; idx < totals.items.length; idx++) {
        const it = totals.items[idx];
        let resolvedCost = Number(it.purchasePriceAtTime || 0);
        if (repActor || resolvedCost <= 0) {
          const priorCost = oldCostByProduct.get(it.productId) || 0;
          if (priorCost > 0) {
            resolvedCost = priorCost;
          } else {
            const cRow = (await client.query(`SELECT purchase_price FROM products WHERE id = $1 LIMIT 1`, [it.productId])).rows[0];
            resolvedCost = Number(cRow?.purchase_price || 0);
          }
          it.purchasePriceAtTime = resolvedCost;
        }
        await client.query(
          `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, barcode, unit, unit_factor, quantity, unit_price, purchase_price_at_time, discount, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [`${invoiceId}-ITM-${idx + 1}`, invoiceId, it.productId, it.productName, it.barcode, it.unit, it.unitFactor, it.quantity, it.unitPrice, it.purchasePriceAtTime, it.discount, it.total]
        );
      }

      const updatedInv = await fetchFullInvoicePg(client, invoiceId);
      return { updatedInv, beforeSnapshot, afterSnapshot };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تعديل فاتورة مبيعات (${out.updatedInv.invoiceNumber})`,
      module: 'المبيعات',
      recordId: invoiceId,
      oldValues: out.beforeSnapshot,
      newValues: out.afterSnapshot,
      notes: cleanReason || 'تعديل فاتورة مبيعات',
    });
    return repActor ? sanitizeInvoiceForRepresentative(out.updatedInv) : out.updatedInv;
  }

  const out = await withJsonTransaction(async (db) => {
    const inv = db.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
    if (inv.type === 'purchase') {
      throw new AppError(400, 'يرجى استخدام مسار تعديل فواتير المشتريات', 'WRONG_INVOICE_TYPE');
    }
    if (inv.status === 'cancelled') throw new AppError(409, 'لا يمكن تعديل فاتورة ملغاة', 'INVOICE_CANCELLED');
    if (
      !updates?.ignoreVersionCheck &&
      updates?.baseVersion !== undefined &&
      Number(inv.version || 1) !== Number(updates.baseVersion)
    ) {
      throw new AppError(
        409,
        `تم تعديل الفاتورة (${inv.invoiceNumber}) لإصدار أحدث (${inv.version}) على الخادم.`,
        'VERSION_CONFLICT',
        { serverSnapshot: inv }
      );
    }

    if (repActor && !isRepOwnerOfInvoice(inv, actor, repActor)) {
      throw new AppError(403, 'غير مصرح لك بتعديل فاتورة لمندوب آخر', 'FORBIDDEN_INVOICE_ACCESS');
    }

    const allowNeg = Boolean(db.settings?.allowNegativeStock) && Boolean(actor?.permissions?.canAllowNegativeInventory);
    const totals = recomputeInvoiceTotals(
      {
        items: updates.items || inv.items,
        discountTotal: updates.discountTotal ?? inv.discountTotal,
        paidAmount: inv.paidAmount,
        appliedAdvanceAmount: inv.appliedAdvanceAmount || 0,
      },
      inv.items
    );
    const oldCostByProd = new Map((inv.items || []).map((o) => [o.productId, Number(o.purchasePriceAtTime || 0)]));
    for (const it of totals.items) {
      if (repActor || Number(it.purchasePriceAtTime || 0) <= 0) {
        const prior = oldCostByProd.get(it.productId) || 0;
        if (prior > 0) {
          it.purchasePriceAtTime = prior;
        } else {
          const prod = (db.products || []).find((p) => p.id === it.productId);
          it.purchasePriceAtTime = Number(prod?.purchasePrice || 0);
        }
      }
    }

    if (totals.grandTotal < round2(Number(inv.paidAmount || 0)) - 0.01) {
      throw new AppError(
        400,
        `إجمالي الفاتورة المعدّل (${totals.grandTotal}) لا يمكن أن يكون أقل من المبلغ المدفوع مسبقاً (${inv.paidAmount})`,
        'GRAND_TOTAL_BELOW_PAID'
      );
    }

    const newQtyByProduct = new Map();
    for (const it of totals.items) {
      newQtyByProduct.set(it.productId, round3((newQtyByProduct.get(it.productId) || 0) + Number(it.quantity || 0)));
    }
    for (const [pid, retQtyRaw] of Object.entries(inv.returnedQuantityByItem || {})) {
      const retQty = round3(retQtyRaw);
      if (retQty <= 0) continue;
      const newQty = Number(newQtyByProduct.get(pid) || 0);
      if (newQty + 0.0001 < retQty) {
        throw new AppError(
          400,
          `لا يمكن تقليل كمية الصنف عن الكمية المرتجعة مسبقاً (${retQty})`,
          'BELOW_RETURNED_QUANTITY'
        );
      }
    }

    const beforeSnapshot = {
      date: inv.date,
      items: inv.items,
      subtotal: inv.subtotal,
      discountTotal: inv.discountTotal,
      grandTotal: inv.grandTotal,
      paidAmount: inv.paidAmount,
      remainingAmount: inv.remainingAmount,
      paymentType: inv.paymentType,
      notes: inv.notes || '',
    };

    if (inv.status === 'confirmed' && inv.type !== 'quote') {
      const oldBaseByProd = new Map();
      const newBaseByProd = new Map();
      const metaByProd = new Map();

      for (const oldItem of inv.items) {
        const baseQty = round3(oldItem.quantity * (oldItem.unitFactor || 1));
        oldBaseByProd.set(oldItem.productId, round3((oldBaseByProd.get(oldItem.productId) || 0) + baseQty));
        metaByProd.set(oldItem.productId, oldItem);
      }
      for (const newItem of totals.items) {
        const baseQty = round3(newItem.quantity * (newItem.unitFactor || 1));
        newBaseByProd.set(newItem.productId, round3((newBaseByProd.get(newItem.productId) || 0) + baseQty));
        metaByProd.set(newItem.productId, newItem);
      }

      const whName = db.warehouses.find((w) => w.id === inv.warehouseId)?.name || inv.warehouseName || '';
      const allPids = new Set([...oldBaseByProd.keys(), ...newBaseByProd.keys()]);

      for (const pid of allPids) {
        const oldBase = Number(oldBaseByProd.get(pid) || 0);
        const newBase = Number(newBaseByProd.get(pid) || 0);
        const deltaOut = round3(newBase - oldBase);
        const prod = db.products.find((p) => p.id === pid);
        if (!prod) {
          if (newBase > 0) throw new AppError(404, `الصنف غير موجود (${metaByProd.get(pid)?.productName || pid})`, 'PRODUCT_NOT_FOUND');
          continue;
        }
        if (deltaOut === 0) continue;

        const curQty = Number(prod.stockPerWarehouse?.[inv.warehouseId] || 0);
        const nextQty = round3(curQty - deltaOut);
        if (deltaOut > 0 && nextQty < 0 && !allowNeg) {
          throw new AppError(409, `الرصيد المتاح من (${prod.name}) لا يكفي للتعديل (المتاح: ${curQty}، المطلوب زيادة: ${deltaOut})`, 'INSUFFICIENT_STOCK');
        }
        prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [inv.warehouseId]: nextQty };

        const mvId = generateServerId('SM');
        const refItem = metaByProd.get(pid);
        db.stockMovements.unshift({
          id: mvId,
          movementNumber: mvId,
          date: updates.date || inv.date,
          type: 'sale_edit',
          productId: prod.id,
          productName: prod.name,
          warehouseId: inv.warehouseId,
          warehouseName: whName,
          quantity: Math.abs(deltaOut),
          unit: prod.baseUnit || refItem?.unit || 'قطعة',
          unitFactor: 1,
          unitCost: Number(refItem?.purchasePriceAtTime || prod.purchasePrice || 0),
          balanceBefore: curQty,
          balanceAfter: nextQty,
          relatedDocType: 'sales',
          referenceId: inv.id,
          referenceNumber: inv.invoiceNumber,
          notes: `تعديل فاتورة مبيعات رقم ${inv.invoiceNumber} (${deltaOut > 0 ? 'خصم فرق ' : 'رد فرق '}${Math.abs(deltaOut)})${cleanReason ? ` - السبب: ${cleanReason}` : ''}`,
          createdBy: actor.fullName,
          createdByUserId: actor.id,
          createdAt: now,
        });
      }

      const diff = round2(totals.grandTotal - inv.grandTotal);
      if (inv.customerId && diff !== 0) {
        const cust = db.customers.find((c) => c.id === inv.customerId);
        if (cust) cust.currentBalance = round2(Number(cust.currentBalance || 0) + diff);
      }
    }

    const afterSnapshot = {
      date: updates.date || inv.date,
      items: totals.items,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      grandTotal: totals.grandTotal,
      paidAmount: inv.paidAmount,
      remainingAmount: totals.remainingAmount,
      paymentType: totals.paymentType,
      notes: updates.notes !== undefined ? updates.notes : (inv.notes || ''),
    };
    const editEntry = {
      id: generateServerId('EDT'),
      editedAt: now,
      editedBy: actor.fullName,
      editedByUserId: actor.id,
      reason: cleanReason || undefined,
      before: beforeSnapshot,
      after: afterSnapshot,
    };

    inv.date = afterSnapshot.date;
    inv.items = totals.items;
    inv.subtotal = totals.subtotal;
    inv.discountTotal = totals.discountTotal;
    inv.grandTotal = totals.grandTotal;
    inv.remainingAmount = totals.remainingAmount;
    inv.paymentType = totals.paymentType;
    inv.editedBy = actor.fullName;
    inv.editedAt = now;
    inv.editHistory = [...(Array.isArray(inv.editHistory) ? inv.editHistory : []), editEntry];
    inv.version = Number(inv.version || 1) + 1;
    inv.updatedAt = now;
    inv.notes = afterSnapshot.notes;
    return { updatedInv: inv, beforeSnapshot, afterSnapshot };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تعديل فاتورة مبيعات (${out.updatedInv.invoiceNumber})`,
    module: 'المبيعات',
    recordId: invoiceId,
    oldValues: out.beforeSnapshot,
    newValues: out.afterSnapshot,
    notes: cleanReason || 'تعديل فاتورة مبيعات',
  });
  return repActor ? sanitizeInvoiceForRepresentative(out.updatedInv) : out.updatedInv;
}

export async function editPurchaseInvoice(invoiceId, updates, actor) {
  const canFullPurchaseEdit =
    actor?.role === 'admin' || (Boolean(actor?.permissions?.canManagePurchases) && Boolean(actor?.permissions?.canEdit));
  const canRepDraftEdit =
    (actor?.role === 'representative' || Boolean(actor?.permissions?.canCreatePurchase)) &&
    Boolean(actor?.permissions?.canEdit);
  if (!canFullPurchaseEdit && !canRepDraftEdit) {
    throw new AppError(403, 'ليس لديك صلاحية تعديل فواتير المشتريات', 'FORBIDDEN_PERMISSION');
  }
  const repActor = actor?.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor?.role === 'representative' && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }
  const now = nowIso();
  const cleanReason = String(updates?.reason || '').trim();

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const inv = await fetchFullInvoicePg(client, invoiceId);
      if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
      if (inv.type !== 'purchase') {
        throw new AppError(400, 'هذه الفاتورة ليست فاتورة مشتريات', 'NOT_PURCHASE_INVOICE');
      }
      if (!canFullPurchaseEdit) {
        if (repActor && !isRepOwnerOfInvoice(inv, actor, repActor)) {
          throw new AppError(403, 'غير مصرح لك بتعديل فاتورة شراء لا تخصك', 'FORBIDDEN_INVOICE_ACCESS');
        }
        if (inv.status !== 'draft' || !['draft', 'rejected'].includes(inv.dispatchStatus)) {
          throw new AppError(
            409,
            'لا يمكن تعديل فاتورة الشراء بعد استلامها أو اعتمادها من الإدارة',
            'CANNOT_EDIT_AFTER_RECEIPT'
          );
        }
      }
      if (inv.status === 'cancelled') throw new AppError(409, 'لا يمكن تعديل فاتورة مشتريات ملغاة', 'INVOICE_CANCELLED');
      if (
        !updates?.ignoreVersionCheck &&
        updates?.baseVersion !== undefined &&
        Number(inv.version || 1) !== Number(updates.baseVersion)
      ) {
        throw new AppError(
          409,
          `تم تعديل فاتورة المشتريات (${inv.invoiceNumber}) لإصدار أحدث (${inv.version}) على الخادم.`,
          'VERSION_CONFLICT',
          { serverSnapshot: inv }
        );
      }

      const nextWarehouseId = updates.warehouseId !== undefined ? (updates.warehouseId || inv.warehouseId) : inv.warehouseId;
      const nextSupplierId = updates.supplierId !== undefined ? (updates.supplierId || null) : inv.supplierId;
      const hasReturns = Object.values(inv.returnedQuantityByItem || {}).some((q) => round3(q) > 0);
      if (hasReturns && (nextWarehouseId !== inv.warehouseId || (nextSupplierId || null) !== (inv.supplierId || null))) {
        throw new AppError(
          409,
          'لا يمكن تغيير المورد أو المستودع لفاتورة مشتريات مسجل عليها مرتجعات سابقة',
          'CANNOT_CHANGE_PARTY_OR_WAREHOUSE_AFTER_RETURN'
        );
      }

      const whNewRes = await client.query(`SELECT id, name FROM warehouses WHERE id = $1 LIMIT 1`, [nextWarehouseId]);
      if (!whNewRes.rows[0]) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
      const nextWarehouseName = whNewRes.rows[0].name;

      let nextSupplierName = inv.supplierName || '';
      if (nextSupplierId) {
        const sNewRes = await client.query(`SELECT id, name FROM suppliers WHERE id = $1 FOR UPDATE`, [nextSupplierId]);
        if (!sNewRes.rows[0]) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');
        nextSupplierName = sNewRes.rows[0].name;
      } else {
        nextSupplierName = 'مورد نقدي';
      }

      const stRes = await client.query(`SELECT allow_negative_stock FROM system_settings LIMIT 1`);
      const allowNeg = Boolean(stRes.rows[0]?.allow_negative_stock) && Boolean(actor?.permissions?.canAllowNegativeInventory);

      const resolvedItemsRaw = updates.items
        ? await resolvePurchaseItemsWithInlineProductsPgTx(client, updates.items, now)
        : inv.items;

      const nextDraftPaidAmount = inv.status === 'draft' && updates.paidAmount !== undefined
        ? round2(Math.max(0, Number(updates.paidAmount || 0)))
        : round2(Number(inv.paidAmount || 0));

      const totals = recomputeInvoiceTotals(
        {
          items: resolvedItemsRaw,
          discountTotal: updates.discountTotal ?? inv.discountTotal,
          paidAmount: nextDraftPaidAmount,
          appliedAdvanceAmount: 0,
        },
        inv.items
      );

      if (totals.grandTotal < nextDraftPaidAmount - 0.01) {
        throw new AppError(
          400,
          `إجمالي فاتورة المشتريات المعدّل (${totals.grandTotal}) لا يمكن أن يكون أقل من المبلغ المدفوع (${nextDraftPaidAmount})`,
          'GRAND_TOTAL_BELOW_PAID'
        );
      }

      const origFactorByProduct = new Map();
      for (const origIt of inv.items || []) {
        if (!origFactorByProduct.has(origIt.productId)) {
          origFactorByProduct.set(origIt.productId, Math.max(0.001, Number(origIt.unitFactor || 1)));
        }
      }
      const newBaseByProduct = new Map();
      const newFactorByProduct = new Map();
      for (const it of totals.items) {
        const uf = Math.max(0.001, Number(it.unitFactor || 1));
        newBaseByProduct.set(it.productId, round3((newBaseByProduct.get(it.productId) || 0) + Number(it.quantity || 0) * uf));
        if (!newFactorByProduct.has(it.productId)) newFactorByProduct.set(it.productId, uf);
      }
      const nextReturnedMap = { ...(inv.returnedQuantityByItem || {}) };
      for (const [pid, retQtyRaw] of Object.entries(inv.returnedQuantityByItem || {})) {
        const retQty = round3(retQtyRaw);
        if (retQty <= 0) continue;
        const origFactor = origFactorByProduct.get(pid) || 1;
        const retBase = round3(retQty * origFactor);
        const newBase = Number(newBaseByProduct.get(pid) || 0);
        if (newBase + 0.0001 < retBase) {
          throw new AppError(
            400,
            `لا يمكن تقليل كمية الصنف عن الكمية المرتجعة مسبقاً (${retQty})`,
            'BELOW_RETURNED_QUANTITY'
          );
        }
        const newFactor = newFactorByProduct.get(pid) || origFactor;
        if (Math.abs(newFactor - origFactor) > 0.0001) {
          nextReturnedMap[pid] = round3(retBase / newFactor);
        }
      }

      const beforeSnapshot = {
        date: inv.date,
        supplierId: inv.supplierId,
        supplierName: inv.supplierName,
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouseName,
        items: inv.items,
        subtotal: inv.subtotal,
        discountTotal: inv.discountTotal,
        grandTotal: inv.grandTotal,
        paidAmount: inv.paidAmount,
        remainingAmount: inv.remainingAmount,
        paymentType: inv.paymentType,
        notes: inv.notes || '',
      };

      if (inv.status === 'confirmed') {
        const oldBaseByProd = new Map();
        const newBaseByProd = new Map();
        const metaByProd = new Map();

        for (const oldItem of inv.items) {
          const baseQty = round3(oldItem.quantity * (oldItem.unitFactor || 1));
          oldBaseByProd.set(oldItem.productId, round3((oldBaseByProd.get(oldItem.productId) || 0) + baseQty));
          metaByProd.set(oldItem.productId, oldItem);
        }
        for (const newItem of totals.items) {
          const baseQty = round3(newItem.quantity * (newItem.unitFactor || 1));
          newBaseByProd.set(newItem.productId, round3((newBaseByProd.get(newItem.productId) || 0) + baseQty));
          metaByProd.set(newItem.productId, newItem);
        }

        const whOldRes = await client.query(`SELECT name FROM warehouses WHERE id = $1 LIMIT 1`, [inv.warehouseId]);
        const oldWarehouseName = whOldRes.rows[0]?.name || inv.warehouseName || '';
        const allPids = new Set([...oldBaseByProd.keys(), ...newBaseByProd.keys()]);
        const sameWarehouse = nextWarehouseId === inv.warehouseId;

        for (const pid of allPids) {
          const oldBase = Number(oldBaseByProd.get(pid) || 0);
          const newBase = Number(newBaseByProd.get(pid) || 0);
          const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [pid]);
          const prod = pRes.rows[0];
          if (!prod) {
            if (newBase > 0) throw new AppError(404, `الصنف غير موجود (${metaByProd.get(pid)?.productName || pid})`, 'PRODUCT_NOT_FOUND');
            continue;
          }

          const stockMap = { ...(prod.stock_per_warehouse || {}) };
          const refItem = metaByProd.get(pid);
          const newCostPrice = newBase > 0 && Number(refItem?.unitPrice || 0) > 0
            ? round2(Number(refItem.unitPrice) / Math.max(0.001, Number(refItem.unitFactor || 1)))
            : Number(prod.purchase_price || 0);

          if (sameWarehouse) {
            const deltaIn = round3(newBase - oldBase);
            if (deltaIn !== 0) {
              const curQty = Number(stockMap[inv.warehouseId] || 0);
              const nextQty = round3(curQty + deltaIn);
              if (nextQty < 0 && !allowNeg) {
                throw new AppError(
                  409,
                  `لا يمكن تخفيض كمية (${prod.name}) لأن الرصيد المتاح بالمخزن (${curQty}) لا يكفي لصرف الفرق (${Math.abs(deltaIn)})`,
                  'INSUFFICIENT_STOCK'
                );
              }
              stockMap[inv.warehouseId] = nextQty;
              await client.query(`UPDATE products SET stock_per_warehouse = $1, purchase_price = $2, updated_at = $3 WHERE id = $4`, [
                JSON.stringify(stockMap),
                newCostPrice,
                now,
                prod.id,
              ]);

              const mvId = generateServerId('SM');
              await client.query(
                `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_before, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_by_user_id, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'purchase_edit',$8,$9,1,$10,$11,$12,'purchase',$13,$14,$15,$16,$17,$18)`,
                [
                  mvId,
                  mvId,
                  updates.date || inv.date,
                  prod.id,
                  prod.name,
                  inv.warehouseId,
                  oldWarehouseName,
                  Math.abs(deltaIn),
                  prod.base_unit || refItem?.unit || 'قطعة',
                  newCostPrice,
                  curQty,
                  nextQty,
                  inv.id,
                  inv.invoiceNumber,
                  `تعديل فاتورة مشتريات رقم ${inv.invoiceNumber} (${deltaIn > 0 ? 'إضافة فرق ' : 'خصم فرق '}${Math.abs(deltaIn)})${cleanReason ? ` - السبب: ${cleanReason}` : ''}`,
                  actor.fullName,
                  actor.id || null,
                  now,
                ]
              );
            } else if (newCostPrice !== Number(prod.purchase_price || 0)) {
              await client.query(`UPDATE products SET purchase_price = $1, updated_at = $2 WHERE id = $3`, [newCostPrice, now, prod.id]);
            }
          } else {
            if (oldBase > 0) {
              const curOldQty = Number(stockMap[inv.warehouseId] || 0);
              const nextOldQty = round3(curOldQty - oldBase);
              if (nextOldQty < 0 && !allowNeg) {
                throw new AppError(
                  409,
                  `لا يمكن نقل فاتورة المشتريات من (${oldWarehouseName}) لأن رصيد (${prod.name}) المتاح (${curOldQty}) أقل من كمية الفاتورة (${oldBase})`,
                  'INSUFFICIENT_STOCK'
                );
              }
              stockMap[inv.warehouseId] = nextOldQty;
              const mvOutId = generateServerId('SM');
              await client.query(
                `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_before, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_by_user_id, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'purchase_edit',$8,$9,1,$10,$11,$12,'purchase',$13,$14,$15,$16,$17,$18)`,
                [
                  mvOutId,
                  mvOutId,
                  updates.date || inv.date,
                  prod.id,
                  prod.name,
                  inv.warehouseId,
                  oldWarehouseName,
                  oldBase,
                  prod.base_unit || refItem?.unit || 'قطعة',
                  newCostPrice,
                  curOldQty,
                  nextOldQty,
                  inv.id,
                  inv.invoiceNumber,
                  `نقل مخزون فاتورة مشتريات رقم ${inv.invoiceNumber} من (${oldWarehouseName}) إلى (${nextWarehouseName})${cleanReason ? ` - السبب: ${cleanReason}` : ''}`,
                  actor.fullName,
                  actor.id || null,
                  now,
                ]
              );
            }
            if (newBase > 0) {
              const curNewQty = Number(stockMap[nextWarehouseId] || 0);
              const nextNewQty = round3(curNewQty + newBase);
              stockMap[nextWarehouseId] = nextNewQty;
              const mvInId = generateServerId('SM');
              await client.query(
                `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_before, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_by_user_id, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'purchase_edit',$8,$9,1,$10,$11,$12,'purchase',$13,$14,$15,$16,$17,$18)`,
                [
                  mvInId,
                  mvInId,
                  updates.date || inv.date,
                  prod.id,
                  prod.name,
                  nextWarehouseId,
                  nextWarehouseName,
                  newBase,
                  prod.base_unit || refItem?.unit || 'قطعة',
                  newCostPrice,
                  curNewQty,
                  nextNewQty,
                  inv.id,
                  inv.invoiceNumber,
                  `إضافة مخزون فاتورة مشتريات معدلة رقم ${inv.invoiceNumber} إلى (${nextWarehouseName})${cleanReason ? ` - السبب: ${cleanReason}` : ''}`,
                  actor.fullName,
                  actor.id || null,
                  now,
                ]
              );
            }
            await client.query(`UPDATE products SET stock_per_warehouse = $1, purchase_price = $2, updated_at = $3 WHERE id = $4`, [
              JSON.stringify(stockMap),
              newCostPrice,
              now,
              prod.id,
            ]);
          }
        }

        const oldRem = round2(Number(inv.remainingAmount || 0));
        const newRem = round2(Number(totals.remainingAmount || 0));
        if ((inv.supplierId || null) === (nextSupplierId || null)) {
          const diffRem = round2(newRem - oldRem);
          if (nextSupplierId && diffRem !== 0) {
            const sRes = await client.query(`SELECT current_balance FROM suppliers WHERE id = $1 FOR UPDATE`, [nextSupplierId]);
            if (sRes.rows[0]) {
              await client.query(`UPDATE suppliers SET current_balance = $1 WHERE id = $2`, [
                round2(Number(sRes.rows[0].current_balance || 0) + diffRem),
                nextSupplierId,
              ]);
            }
          }
        } else {
          if (inv.supplierId && oldRem !== 0) {
            const oldSRes = await client.query(`SELECT current_balance FROM suppliers WHERE id = $1 FOR UPDATE`, [inv.supplierId]);
            if (oldSRes.rows[0]) {
              await client.query(`UPDATE suppliers SET current_balance = $1 WHERE id = $2`, [
                round2(Number(oldSRes.rows[0].current_balance || 0) - oldRem),
                inv.supplierId,
              ]);
            }
          }
          if (nextSupplierId && newRem !== 0) {
            const newSRes = await client.query(`SELECT current_balance FROM suppliers WHERE id = $1 FOR UPDATE`, [nextSupplierId]);
            if (newSRes.rows[0]) {
              await client.query(`UPDATE suppliers SET current_balance = $1 WHERE id = $2`, [
                round2(Number(newSRes.rows[0].current_balance || 0) + newRem),
                nextSupplierId,
              ]);
            }
          }
        }
      }

      const itemsWithCost = totals.items.map((it) => ({
        ...it,
        purchasePriceAtTime: round2(Number(it.unitPrice || 0) / Math.max(0.001, Number(it.unitFactor || 1))),
      }));

      const afterSnapshot = {
        date: updates.date || inv.date,
        supplierId: nextSupplierId,
        supplierName: nextSupplierName,
        warehouseId: nextWarehouseId,
        warehouseName: nextWarehouseName,
        items: itemsWithCost,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        grandTotal: totals.grandTotal,
        paidAmount: totals.paidAmount,
        remainingAmount: totals.remainingAmount,
        paymentType: totals.paymentType,
        notes: updates.notes !== undefined ? updates.notes : (inv.notes || ''),
      };
      const editEntry = {
        id: generateServerId('EDT'),
        editedAt: now,
        editedBy: actor.fullName,
        editedByUserId: actor.id,
        reason: cleanReason || undefined,
        before: beforeSnapshot,
        after: afterSnapshot,
      };
      const nextEditHistory = [...(Array.isArray(inv.editHistory) ? inv.editHistory : []), editEntry];

      await client.query(
        `UPDATE invoices SET date = $1, supplier_id = $2, supplier_name = $3, warehouse_id = $4, warehouse_name = $5, subtotal = $6, discount_total = $7, grand_total = $8, paid_amount = $9, remaining_amount = $10, payment_type = $11, notes = $12, edited_by = $13, edited_at = $14, edit_history = $15, returned_quantity_by_item = $16, version = COALESCE(version, 1) + 1, updated_at = $14 WHERE id = $17`,
        [
          afterSnapshot.date,
          nextSupplierId,
          nextSupplierName,
          nextWarehouseId,
          nextWarehouseName,
          totals.subtotal,
          totals.discountTotal,
          totals.grandTotal,
          totals.paidAmount,
          totals.remainingAmount,
          totals.paymentType,
          afterSnapshot.notes,
          actor.fullName,
          now,
          JSON.stringify(nextEditHistory),
          JSON.stringify(nextReturnedMap),
          invoiceId,
        ]
      );
      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
      for (let idx = 0; idx < itemsWithCost.length; idx++) {
        const it = itemsWithCost[idx];
        await client.query(
          `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, barcode, unit, unit_factor, quantity, unit_price, purchase_price_at_time, discount, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [`${invoiceId}-ITM-${idx + 1}`, invoiceId, it.productId, it.productName, it.barcode, it.unit, it.unitFactor, it.quantity, it.unitPrice, it.purchasePriceAtTime, it.discount, it.total]
        );
      }

      const updatedInv = await fetchFullInvoicePg(client, invoiceId);
      return { updatedInv, beforeSnapshot, afterSnapshot };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تعديل فاتورة مشتريات (${out.updatedInv.invoiceNumber})`,
      module: 'المشتريات',
      recordId: invoiceId,
      oldValues: out.beforeSnapshot,
      newValues: out.afterSnapshot,
      notes: cleanReason || 'تعديل فاتورة مشتريات',
    });
    return out.updatedInv;
  }

  const out = await withJsonTransaction(async (db) => {
    const inv = db.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
    if (inv.type !== 'purchase') {
      throw new AppError(400, 'هذه الفاتورة ليست فاتورة مشتريات', 'NOT_PURCHASE_INVOICE');
    }
    if (!canFullPurchaseEdit) {
      if (repActor && !isRepOwnerOfInvoice(inv, actor, repActor)) {
        throw new AppError(403, 'غير مصرح لك بتعديل فاتورة شراء لا تخصك', 'FORBIDDEN_INVOICE_ACCESS');
      }
      if (inv.status !== 'draft' || !['draft', 'rejected'].includes(inv.dispatchStatus)) {
        throw new AppError(
          409,
          'لا يمكن تعديل فاتورة الشراء بعد استلامها أو اعتمادها من الإدارة',
          'CANNOT_EDIT_AFTER_RECEIPT'
        );
      }
    }
    if (inv.status === 'cancelled') throw new AppError(409, 'لا يمكن تعديل فاتورة مشتريات ملغاة', 'INVOICE_CANCELLED');
    if (
      !updates?.ignoreVersionCheck &&
      updates?.baseVersion !== undefined &&
      Number(inv.version || 1) !== Number(updates.baseVersion)
    ) {
      throw new AppError(
        409,
        `تم تعديل فاتورة المشتريات (${inv.invoiceNumber}) لإصدار أحدث (${inv.version}) على الخادم.`,
        'VERSION_CONFLICT',
        { serverSnapshot: inv }
      );
    }

    const nextWarehouseId = updates.warehouseId !== undefined ? (updates.warehouseId || inv.warehouseId) : inv.warehouseId;
    const nextSupplierId = updates.supplierId !== undefined ? (updates.supplierId || undefined) : inv.supplierId;
    const hasReturns = Object.values(inv.returnedQuantityByItem || {}).some((q) => round3(q) > 0);
    if (hasReturns && (nextWarehouseId !== inv.warehouseId || (nextSupplierId || null) !== (inv.supplierId || null))) {
      throw new AppError(
        409,
        'لا يمكن تغيير المورد أو المستودع لفاتورة مشتريات مسجل عليها مرتجعات سابقة',
        'CANNOT_CHANGE_PARTY_OR_WAREHOUSE_AFTER_RETURN'
      );
    }

    const whNew = db.warehouses.find((w) => w.id === nextWarehouseId);
    if (!whNew) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
    const nextWarehouseName = whNew.name;

    let nextSupplierName = inv.supplierName || '';
    if (nextSupplierId) {
      const sNew = db.suppliers.find((s) => s.id === nextSupplierId);
      if (!sNew) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');
      nextSupplierName = sNew.name;
    } else {
      nextSupplierName = 'مورد نقدي';
    }

    const allowNeg = Boolean(db.settings?.allowNegativeStock) && Boolean(actor?.permissions?.canAllowNegativeInventory);
    const resolvedItemsRaw = updates.items
      ? resolvePurchaseItemsWithInlineProductsJsonTx(db, updates.items, now)
      : inv.items;

    const nextDraftPaidAmount = inv.status === 'draft' && updates.paidAmount !== undefined
      ? round2(Math.max(0, Number(updates.paidAmount || 0)))
      : round2(Number(inv.paidAmount || 0));

    const totals = recomputeInvoiceTotals(
      {
        items: resolvedItemsRaw,
        discountTotal: updates.discountTotal ?? inv.discountTotal,
        paidAmount: nextDraftPaidAmount,
        appliedAdvanceAmount: 0,
      },
      inv.items
    );

    if (totals.grandTotal < nextDraftPaidAmount - 0.01) {
      throw new AppError(
        400,
        `إجمالي فاتورة المشتريات المعدّل (${totals.grandTotal}) لا يمكن أن يكون أقل من المبلغ المدفوع (${nextDraftPaidAmount})`,
        'GRAND_TOTAL_BELOW_PAID'
      );
    }

    const origFactorByProduct = new Map();
    for (const origIt of inv.items || []) {
      if (!origFactorByProduct.has(origIt.productId)) {
        origFactorByProduct.set(origIt.productId, Math.max(0.001, Number(origIt.unitFactor || 1)));
      }
    }
    const newBaseByProduct = new Map();
    const newFactorByProduct = new Map();
    for (const it of totals.items) {
      const uf = Math.max(0.001, Number(it.unitFactor || 1));
      newBaseByProduct.set(it.productId, round3((newBaseByProduct.get(it.productId) || 0) + Number(it.quantity || 0) * uf));
      if (!newFactorByProduct.has(it.productId)) newFactorByProduct.set(it.productId, uf);
    }
    const nextReturnedMap = { ...(inv.returnedQuantityByItem || {}) };
    for (const [pid, retQtyRaw] of Object.entries(inv.returnedQuantityByItem || {})) {
      const retQty = round3(retQtyRaw);
      if (retQty <= 0) continue;
      const origFactor = origFactorByProduct.get(pid) || 1;
      const retBase = round3(retQty * origFactor);
      const newBase = Number(newBaseByProduct.get(pid) || 0);
      if (newBase + 0.0001 < retBase) {
        throw new AppError(
          400,
          `لا يمكن تقليل كمية الصنف عن الكمية المرتجعة مسبقاً (${retQty})`,
          'BELOW_RETURNED_QUANTITY'
        );
      }
      const newFactor = newFactorByProduct.get(pid) || origFactor;
      if (Math.abs(newFactor - origFactor) > 0.0001) {
        nextReturnedMap[pid] = round3(retBase / newFactor);
      }
    }

    const beforeSnapshot = {
      date: inv.date,
      supplierId: inv.supplierId,
      supplierName: inv.supplierName,
      warehouseId: inv.warehouseId,
      warehouseName: inv.warehouseName,
      items: inv.items,
      subtotal: inv.subtotal,
      discountTotal: inv.discountTotal,
      grandTotal: inv.grandTotal,
      paidAmount: inv.paidAmount,
      remainingAmount: inv.remainingAmount,
      paymentType: inv.paymentType,
      notes: inv.notes || '',
    };

    if (inv.status === 'confirmed') {
      const oldBaseByProd = new Map();
      const newBaseByProd = new Map();
      const metaByProd = new Map();

      for (const oldItem of inv.items) {
        const baseQty = round3(oldItem.quantity * (oldItem.unitFactor || 1));
        oldBaseByProd.set(oldItem.productId, round3((oldBaseByProd.get(oldItem.productId) || 0) + baseQty));
        metaByProd.set(oldItem.productId, oldItem);
      }
      for (const newItem of totals.items) {
        const baseQty = round3(newItem.quantity * (newItem.unitFactor || 1));
        newBaseByProd.set(newItem.productId, round3((newBaseByProd.get(newItem.productId) || 0) + baseQty));
        metaByProd.set(newItem.productId, newItem);
      }

      const oldWarehouseName = db.warehouses.find((w) => w.id === inv.warehouseId)?.name || inv.warehouseName || '';
      const allPids = new Set([...oldBaseByProd.keys(), ...newBaseByProd.keys()]);
      const sameWarehouse = nextWarehouseId === inv.warehouseId;

      for (const pid of allPids) {
        const oldBase = Number(oldBaseByProd.get(pid) || 0);
        const newBase = Number(newBaseByProd.get(pid) || 0);
        const prod = db.products.find((p) => p.id === pid);
        if (!prod) {
          if (newBase > 0) throw new AppError(404, `الصنف غير موجود (${metaByProd.get(pid)?.productName || pid})`, 'PRODUCT_NOT_FOUND');
          continue;
        }

        const refItem = metaByProd.get(pid);
        const newCostPrice = newBase > 0 && Number(refItem?.unitPrice || 0) > 0
          ? round2(Number(refItem.unitPrice) / Math.max(0.001, Number(refItem.unitFactor || 1)))
          : Number(prod.purchasePrice || 0);

        if (sameWarehouse) {
          const deltaIn = round3(newBase - oldBase);
          if (deltaIn !== 0) {
            const curQty = Number(prod.stockPerWarehouse?.[inv.warehouseId] || 0);
            const nextQty = round3(curQty + deltaIn);
            if (nextQty < 0 && !allowNeg) {
              throw new AppError(
                409,
                `لا يمكن تخفيض كمية (${prod.name}) لأن الرصيد المتاح بالمخزن (${curQty}) لا يكفي لصرف الفرق (${Math.abs(deltaIn)})`,
                'INSUFFICIENT_STOCK'
              );
            }
            prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [inv.warehouseId]: nextQty };
            prod.purchasePrice = newCostPrice;
            const mvId = generateServerId('SM');
            db.stockMovements.unshift({
              id: mvId,
              movementNumber: mvId,
              date: updates.date || inv.date,
              type: 'purchase_edit',
              productId: prod.id,
              productName: prod.name,
              warehouseId: inv.warehouseId,
              warehouseName: oldWarehouseName,
              quantity: Math.abs(deltaIn),
              unit: prod.baseUnit || refItem?.unit || 'قطعة',
              unitFactor: 1,
              unitCost: newCostPrice,
              balanceBefore: curQty,
              balanceAfter: nextQty,
              relatedDocType: 'purchase',
              referenceId: inv.id,
              referenceNumber: inv.invoiceNumber,
              notes: `تعديل فاتورة مشتريات رقم ${inv.invoiceNumber} (${deltaIn > 0 ? 'إضافة فرق ' : 'خصم فرق '}${Math.abs(deltaIn)})${cleanReason ? ` - السبب: ${cleanReason}` : ''}`,
              createdBy: actor.fullName,
              createdByUserId: actor.id,
              createdAt: now,
            });
          } else {
            prod.purchasePrice = newCostPrice;
          }
        } else {
          if (oldBase > 0) {
            const curOldQty = Number(prod.stockPerWarehouse?.[inv.warehouseId] || 0);
            const nextOldQty = round3(curOldQty - oldBase);
            if (nextOldQty < 0 && !allowNeg) {
              throw new AppError(
                409,
                `لا يمكن نقل فاتورة المشتريات من (${oldWarehouseName}) لأن رصيد (${prod.name}) المتاح (${curOldQty}) أقل من كمية الفاتورة (${oldBase})`,
                'INSUFFICIENT_STOCK'
              );
            }
            prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [inv.warehouseId]: nextOldQty };
            const mvOutId = generateServerId('SM');
            db.stockMovements.unshift({
              id: mvOutId,
              movementNumber: mvOutId,
              date: updates.date || inv.date,
              type: 'purchase_edit',
              productId: prod.id,
              productName: prod.name,
              warehouseId: inv.warehouseId,
              warehouseName: oldWarehouseName,
              quantity: oldBase,
              unit: prod.baseUnit || refItem?.unit || 'قطعة',
              unitFactor: 1,
              unitCost: newCostPrice,
              balanceBefore: curOldQty,
              balanceAfter: nextOldQty,
              relatedDocType: 'purchase',
              referenceId: inv.id,
              referenceNumber: inv.invoiceNumber,
              notes: `نقل مخزون فاتورة مشتريات رقم ${inv.invoiceNumber} من (${oldWarehouseName}) إلى (${nextWarehouseName})${cleanReason ? ` - السبب: ${cleanReason}` : ''}`,
              createdBy: actor.fullName,
              createdByUserId: actor.id,
              createdAt: now,
            });
          }
          if (newBase > 0) {
            const curNewQty = Number(prod.stockPerWarehouse?.[nextWarehouseId] || 0);
            const nextNewQty = round3(curNewQty + newBase);
            prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [nextWarehouseId]: nextNewQty };
            const mvInId = generateServerId('SM');
            db.stockMovements.unshift({
              id: mvInId,
              movementNumber: mvInId,
              date: updates.date || inv.date,
              type: 'purchase_edit',
              productId: prod.id,
              productName: prod.name,
              warehouseId: nextWarehouseId,
              warehouseName: nextWarehouseName,
              quantity: newBase,
              unit: prod.baseUnit || refItem?.unit || 'قطعة',
              unitFactor: 1,
              unitCost: newCostPrice,
              balanceBefore: curNewQty,
              balanceAfter: nextNewQty,
              relatedDocType: 'purchase',
              referenceId: inv.id,
              referenceNumber: inv.invoiceNumber,
              notes: `إضافة مخزون فاتورة مشتريات معدلة رقم ${inv.invoiceNumber} إلى (${nextWarehouseName})${cleanReason ? ` - السبب: ${cleanReason}` : ''}`,
              createdBy: actor.fullName,
              createdByUserId: actor.id,
              createdAt: now,
            });
          }
          prod.purchasePrice = newCostPrice;
        }
      }

      const oldRem = round2(Number(inv.remainingAmount || 0));
      const newRem = round2(Number(totals.remainingAmount || 0));
      if ((inv.supplierId || null) === (nextSupplierId || null)) {
        const diffRem = round2(newRem - oldRem);
        if (nextSupplierId && diffRem !== 0) {
          const supp = db.suppliers.find((s) => s.id === nextSupplierId);
          if (supp) supp.currentBalance = round2(Number(supp.currentBalance || 0) + diffRem);
        }
      } else {
        if (inv.supplierId && oldRem !== 0) {
          const oldSupp = db.suppliers.find((s) => s.id === inv.supplierId);
          if (oldSupp) oldSupp.currentBalance = round2(Number(oldSupp.currentBalance || 0) - oldRem);
        }
        if (nextSupplierId && newRem !== 0) {
          const newSupp = db.suppliers.find((s) => s.id === nextSupplierId);
          if (newSupp) newSupp.currentBalance = round2(Number(newSupp.currentBalance || 0) + newRem);
        }
      }
    }

    const itemsWithCost = totals.items.map((it) => ({
      ...it,
      purchasePriceAtTime: round2(Number(it.unitPrice || 0) / Math.max(0.001, Number(it.unitFactor || 1))),
    }));

    const afterSnapshot = {
      date: updates.date || inv.date,
      supplierId: nextSupplierId,
      supplierName: nextSupplierName,
      warehouseId: nextWarehouseId,
      warehouseName: nextWarehouseName,
      items: itemsWithCost,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      grandTotal: totals.grandTotal,
      paidAmount: totals.paidAmount,
      remainingAmount: totals.remainingAmount,
      paymentType: totals.paymentType,
      notes: updates.notes !== undefined ? updates.notes : (inv.notes || ''),
    };
    const editEntry = {
      id: generateServerId('EDT'),
      editedAt: now,
      editedBy: actor.fullName,
      editedByUserId: actor.id,
      reason: cleanReason || undefined,
      before: beforeSnapshot,
      after: afterSnapshot,
    };

    inv.date = afterSnapshot.date;
    inv.supplierId = nextSupplierId;
    inv.supplierName = nextSupplierName;
    inv.warehouseId = nextWarehouseId;
    inv.warehouseName = nextWarehouseName;
    inv.items = itemsWithCost;
    inv.subtotal = totals.subtotal;
    inv.discountTotal = totals.discountTotal;
    inv.grandTotal = totals.grandTotal;
    inv.paidAmount = totals.paidAmount;
    inv.remainingAmount = totals.remainingAmount;
    inv.paymentType = totals.paymentType;
    inv.editedBy = actor.fullName;
    inv.editedAt = now;
    inv.editHistory = [...(Array.isArray(inv.editHistory) ? inv.editHistory : []), editEntry];
    inv.returnedQuantityByItem = nextReturnedMap;
    inv.version = Number(inv.version || 1) + 1;
    inv.updatedAt = now;
    inv.notes = afterSnapshot.notes;
    return { updatedInv: inv, beforeSnapshot, afterSnapshot };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تعديل فاتورة مشتريات (${out.updatedInv.invoiceNumber})`,
    module: 'المشتريات',
    recordId: invoiceId,
    oldValues: out.beforeSnapshot,
    newValues: out.afterSnapshot,
    notes: cleanReason || 'تعديل فاتورة مشتريات',
  });
  return out.updatedInv;
}

export async function editInvoice(invoiceId, updates, actor) {
  let invType = null;
  if (await isPgMode()) {
    const res = await getPool().query(`SELECT type FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
    if (!res.rows[0]) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
    invType = res.rows[0].type;
  } else {
    const db = readJsonDatabase();
    const inv = db.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
    invType = inv.type;
  }
  if (invType === 'purchase') {
    return editPurchaseInvoice(invoiceId, updates, actor);
  }
  return editSalesInvoice(invoiceId, updates, actor);
}

export async function deleteDraftPurchaseInvoice(invoiceId, actor) {
  const canFullPurchaseManage =
    actor?.role === 'admin' || Boolean(actor?.permissions?.canManagePurchases);
  const canRepDraftDelete =
    actor?.role === 'representative' || Boolean(actor?.permissions?.canCreatePurchase);
  if (!canFullPurchaseManage && !canRepDraftDelete) {
    throw new AppError(403, 'ليس لديك صلاحية حذف مسودة فاتورة الشراء', 'FORBIDDEN_PERMISSION');
  }
  const repActor = actor?.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor?.role === 'representative' && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }

  if (await isPgMode()) {
    const deleted = await withTransaction(async (client) => {
      const inv = await fetchFullInvoicePg(client, invoiceId);
      if (!inv) throw new AppError(404, 'فاتورة الشراء غير موجودة', 'INVOICE_NOT_FOUND');
      if (inv.type !== 'purchase') {
        throw new AppError(400, 'هذا المستند ليس فاتورة مشتريات', 'NOT_PURCHASE_INVOICE');
      }
      const dispatchSt = inv.dispatchStatus || 'draft';
      if (inv.status !== 'draft' || !['draft', 'rejected'].includes(dispatchSt)) {
        throw new AppError(
          409,
          'لا يمكن حذف فاتورة الشراء بعد إرسالها أو استلامها أو اعتمادها',
          'CANNOT_DELETE_AFTER_DISPATCH'
        );
      }
      if (!canFullPurchaseManage) {
        if (!isRepOwnerOfInvoice(inv, actor, repActor)) {
          throw new AppError(403, 'غير مصرح لك بحذف مسودة فاتورة شراء لا تخصك', 'FORBIDDEN_INVOICE_ACCESS');
        }
      }

      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
      await client.query(`DELETE FROM invoice_payments WHERE invoice_id = $1`, [invoiceId]);
      await client.query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);
      return inv;
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `حذف مسودة فاتورة مشتريات (${deleted.invoiceNumber})`,
      module: 'المشتريات',
      recordId: invoiceId,
      oldValues: { invoiceNumber: deleted.invoiceNumber, grandTotal: deleted.grandTotal, dispatchStatus: deleted.dispatchStatus },
    });
    return { ok: true, id: invoiceId, invoiceNumber: deleted.invoiceNumber };
  }

  const deleted = await withJsonTransaction(async (db) => {
    const inv = db.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new AppError(404, 'فاتورة الشراء غير موجودة', 'INVOICE_NOT_FOUND');
    if (inv.type !== 'purchase') {
      throw new AppError(400, 'هذا المستند ليس فاتورة مشتريات', 'NOT_PURCHASE_INVOICE');
    }
    const dispatchSt = inv.dispatchStatus || 'draft';
    if (inv.status !== 'draft' || !['draft', 'rejected'].includes(dispatchSt)) {
      throw new AppError(
        409,
        'لا يمكن حذف فاتورة الشراء بعد إرسالها أو استلامها أو اعتمادها',
        'CANNOT_DELETE_AFTER_DISPATCH'
      );
    }
    if (!canFullPurchaseManage) {
      if (!isRepOwnerOfInvoice(inv, actor, repActor)) {
        throw new AppError(403, 'غير مصرح لك بحذف مسودة فاتورة شراء لا تخصك', 'FORBIDDEN_INVOICE_ACCESS');
      }
    }
    db.invoices = db.invoices.filter((i) => i.id !== invoiceId);
    return inv;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `حذف مسودة فاتورة مشتريات (${deleted.invoiceNumber})`,
    module: 'المشتريات',
    recordId: invoiceId,
    oldValues: { invoiceNumber: deleted.invoiceNumber, grandTotal: deleted.grandTotal, dispatchStatus: deleted.dispatchStatus },
  });
  return { ok: true, id: invoiceId, invoiceNumber: deleted.invoiceNumber };
}

export async function cancelInvoice(invoiceId, reason = '', actor) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بإلغاء الفواتير', 'FORBIDDEN');
  }
  const now = nowIso();
  const cleanReason = String(reason || 'إلغاء الفاتورة').trim();
  const repActor = actor?.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor?.role === 'representative' && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const cur = await fetchFullInvoicePg(client, invoiceId);
      if (!cur) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
      if (repActor) {
        if (!isRepOwnerOfInvoice(cur, actor, repActor)) {
          throw new AppError(403, 'غير مصرح للمندوب بإلغاء فاتورة لا تخصه', 'FORBIDDEN_INVOICE_ACCESS');
        }
        if (cur.type === 'purchase' && cur.status === 'confirmed') {
          throw new AppError(403, 'لا يمكن للمندوب إلغاء فاتورة شراء معتمدة؛ يرجى مراجعة الإدارة', 'FORBIDDEN_REP_CANCEL_PURCHASE');
        }
      }
      if (cur.status === 'cancelled') throw new AppError(409, 'الفاتورة ملغاة بالفعل', 'ALREADY_CANCELLED');

      const retRes = await client.query(
        `SELECT grand_total, refund_type FROM invoice_returns WHERE original_invoice_id = $1`,
        [invoiceId]
      );
      let totalBalanceReturns = 0;
      let totalCashReturns = 0;
      for (const r of retRes.rows || []) {
        const gt = round2(Number(r.grand_total || 0));
        if ((r.refund_type || 'balance') === 'cash') totalCashReturns = round2(totalCashReturns + gt);
        else totalBalanceReturns = round2(totalBalanceReturns + gt);
      }

      const beforeSnapshot = {
        status: cur.status,
        grandTotal: cur.grandTotal,
        paidAmount: cur.paidAmount,
        remainingAmount: cur.remainingAmount,
        appliedAdvanceAmount: cur.appliedAdvanceAmount || 0,
        returnedQuantityByItem: cur.returnedQuantityByItem || {},
      };

      if (cur.status === 'confirmed' && cur.type !== 'quote') {
        const whRes = await client.query(`SELECT name FROM warehouses WHERE id = $1 LIMIT 1`, [cur.warehouseId]);
        const warehouseName = whRes.rows[0]?.name || cur.warehouseName || '';
        const retLeft = { ...(cur.returnedQuantityByItem || {}) };
        const movementType = cur.type === 'sales' ? 'sale_cancel' : 'purchase_cancel';

        for (const item of cur.items) {
          const prevRet = Number(retLeft[item.productId] || 0);
          const usedRet = Math.min(Number(item.quantity || 0), Math.max(0, prevRet));
          retLeft[item.productId] = round3(prevRet - usedRet);
          const unreturnedQty = round3(Number(item.quantity || 0) - usedRet);
          const baseQty = round3(unreturnedQty * Number(item.unitFactor || 1));
          if (baseQty <= 0) continue;

          const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [item.productId]);
          const prod = pRes.rows[0];
          if (prod) {
            const stockMap = { ...(prod.stock_per_warehouse || {}) };
            const curQty = Number(stockMap[cur.warehouseId] || 0);
            const nextQty = cur.type === 'sales' ? round3(curQty + baseQty) : round3(curQty - baseQty);
            stockMap[cur.warehouseId] = nextQty;
            await client.query(`UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3`, [JSON.stringify(stockMap), now, item.productId]);

            const mvId = generateServerId('SM');
            await client.query(
              `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_before, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_by_user_id, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
              [
                mvId,
                mvId,
                todayIso(),
                prod.id,
                prod.name,
                cur.warehouseId,
                warehouseName,
                movementType,
                baseQty,
                item.unit || prod.base_unit || 'قطعة',
                Number(item.unitFactor || 1),
                Number(item.purchasePriceAtTime || prod.purchase_price || 0),
                curQty,
                nextQty,
                cur.type,
                cur.id,
                cur.invoiceNumber,
                `عكس مخزون إلغاء فاتورة رقم ${cur.invoiceNumber} - ${cleanReason}`,
                actor.fullName,
                actor.id || null,
                now,
              ]
            );
          }
        }

        const appliedAdv = cur.type === 'sales' ? round2(Number(cur.appliedAdvanceAmount || 0)) : 0;
        const remainingToReverse = round2(Number(cur.remainingAmount || 0) - totalBalanceReturns);
        const cashToReverse = round2(Number(cur.paidAmount || 0) - appliedAdv - totalCashReturns);

        if (cur.customerId) {
          const cRes = await client.query(`SELECT current_balance FROM customers WHERE id = $1 FOR UPDATE`, [cur.customerId]);
          if (cRes.rows[0]) {
            await client.query(`UPDATE customers SET current_balance = $1, updated_at = $2 WHERE id = $3`, [
              round2(Number(cRes.rows[0].current_balance || 0) - remainingToReverse - appliedAdv),
              now,
              cur.customerId,
            ]);
          }
        }
        if (cur.supplierId) {
          const sRes = await client.query(`SELECT current_balance FROM suppliers WHERE id = $1 FOR UPDATE`, [cur.supplierId]);
          if (sRes.rows[0]) {
            await client.query(`UPDATE suppliers SET current_balance = $1 WHERE id = $2`, [
              round2(Number(sRes.rows[0].current_balance || 0) - remainingToReverse),
              cur.supplierId,
            ]);
          }
        }

        if (cashToReverse !== 0 && cur.cashboxId) {
          const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [cur.cashboxId]);
          if (cbRes.rows[0]) {
            const deltaCb = cur.type === 'sales' ? -cashToReverse : cashToReverse;
            const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) + deltaCb);
            await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCb, cur.cashboxId]);

            const txId = generateServerId('FT');
            const txNo = `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
            await client.query(
              `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_type, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, notes, created_by, created_by_user_id, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
              [
                txId,
                txNo,
                todayIso(),
                deltaCb < 0 ? 'withdrawal' : 'deposit',
                round2(Math.abs(deltaCb)),
                cbRes.rows[0].id,
                cbRes.rows[0].name,
                nextCb,
                cur.type === 'sales' ? 'إلغاء فاتورة مبيعات' : 'إلغاء فاتورة مشتريات',
                cur.type === 'sales' ? 'customer' : 'supplier',
                cur.customerId || cur.supplierId || null,
                cur.customerName || cur.supplierName || '',
                cur.type,
                cur.id,
                cur.invoiceNumber,
                `تسوية خزينة لإلغاء فاتورة رقم ${cur.invoiceNumber}`,
                cleanReason,
                actor.fullName,
                actor.id || null,
                now,
              ]
            );
          }
        }

        if (cur.type === 'sales' && cur.representativeId && cashToReverse !== 0) {
          const repRes = await client.query(`SELECT current_balance FROM representatives WHERE id = $1 FOR UPDATE`, [cur.representativeId]);
          if (repRes.rows[0]) {
            await client.query(`UPDATE representatives SET current_balance = $1 WHERE id = $2`, [
              round2(Number(repRes.rows[0].current_balance || 0) - cashToReverse),
              cur.representativeId,
            ]);
          }
        }

        if (appliedAdv > 0) {
          await client.query(
            `UPDATE order_advance_payments SET status = 'active', applied_invoice_id = NULL WHERE applied_invoice_id = $1`,
            [invoiceId]
          );
        }
      }

      const nextNotes = `${cur.notes || ''} [تم الإلغاء: ${cleanReason}]`.trim();
      await client.query(
        `UPDATE invoices SET status = 'cancelled', notes = $1, cancelled_by = $2, cancelled_at = $3, cancel_reason = $4, version = COALESCE(version, 1) + 1, updated_at = $3 WHERE id = $5`,
        [nextNotes, actor.fullName, now, cleanReason, invoiceId]
      );
      const updatedInv = await fetchFullInvoicePg(client, invoiceId);
      return {
        updatedInv,
        beforeSnapshot,
        newValues: {
          status: 'cancelled',
          cancelReason: cleanReason,
          cancelledBy: actor.fullName,
          cancelledAt: now,
          totalBalanceReturns,
          totalCashReturns,
        },
      };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إلغاء فاتورة (${out.updatedInv.invoiceNumber})`,
      module: out.updatedInv.type === 'sales' ? 'المبيعات' : out.updatedInv.type === 'quote' ? 'عروض الأسعار' : 'المشتريات',
      recordId: invoiceId,
      oldValues: out.beforeSnapshot,
      newValues: out.newValues,
      notes: cleanReason,
    });
    return out.updatedInv;
  }

  const out = await withJsonTransaction(async (db) => {
    const cur = db.invoices.find((i) => i.id === invoiceId);
    if (!cur) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
    if (repActor) {
      if (!isRepOwnerOfInvoice(cur, actor, repActor)) {
        throw new AppError(403, 'غير مصرح للمندوب بإلغاء فاتورة لا تخصه', 'FORBIDDEN_INVOICE_ACCESS');
      }
      if (cur.type === 'purchase' && cur.status === 'confirmed') {
        throw new AppError(403, 'لا يمكن للمندوب إلغاء فاتورة شراء معتمدة؛ يرجى مراجعة الإدارة', 'FORBIDDEN_REP_CANCEL_PURCHASE');
      }
    }
    if (cur.status === 'cancelled') throw new AppError(409, 'الفاتورة ملغاة بالفعل', 'ALREADY_CANCELLED');

    const priorReturns = (db.invoiceReturns || []).filter((r) => r.originalInvoiceId === invoiceId);
    let totalBalanceReturns = 0;
    let totalCashReturns = 0;
    for (const r of priorReturns) {
      const gt = round2(Number(r.grandTotal || 0));
      if ((r.refundType || 'balance') === 'cash') totalCashReturns = round2(totalCashReturns + gt);
      else totalBalanceReturns = round2(totalBalanceReturns + gt);
    }

    const beforeSnapshot = {
      status: cur.status,
      grandTotal: cur.grandTotal,
      paidAmount: cur.paidAmount,
      remainingAmount: cur.remainingAmount,
      appliedAdvanceAmount: cur.appliedAdvanceAmount || 0,
      returnedQuantityByItem: cur.returnedQuantityByItem || {},
    };

    if (cur.status === 'confirmed' && cur.type !== 'quote') {
      const whName = db.warehouses.find((w) => w.id === cur.warehouseId)?.name || cur.warehouseName || '';
      const retLeft = { ...(cur.returnedQuantityByItem || {}) };
      const movementType = cur.type === 'sales' ? 'sale_cancel' : 'purchase_cancel';

      for (const item of cur.items) {
        const prevRet = Number(retLeft[item.productId] || 0);
        const usedRet = Math.min(Number(item.quantity || 0), Math.max(0, prevRet));
        retLeft[item.productId] = round3(prevRet - usedRet);
        const unreturnedQty = round3(Number(item.quantity || 0) - usedRet);
        const baseQty = round3(unreturnedQty * Number(item.unitFactor || 1));
        if (baseQty <= 0) continue;

        const prod = db.products.find((p) => p.id === item.productId);
        if (prod) {
          const curQty = Number(prod.stockPerWarehouse?.[cur.warehouseId] || 0);
          const nextQty = cur.type === 'sales' ? round3(curQty + baseQty) : round3(curQty - baseQty);
          prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [cur.warehouseId]: nextQty };

          const mvId = generateServerId('SM');
          db.stockMovements.unshift({
            id: mvId,
            movementNumber: mvId,
            date: todayIso(),
            type: movementType,
            productId: prod.id,
            productName: prod.name,
            warehouseId: cur.warehouseId,
            warehouseName: whName,
            quantity: baseQty,
            unit: item.unit || prod.baseUnit || 'قطعة',
            unitFactor: Number(item.unitFactor || 1),
            unitCost: Number(item.purchasePriceAtTime || prod.purchasePrice || 0),
            balanceBefore: curQty,
            balanceAfter: nextQty,
            relatedDocType: cur.type,
            referenceId: cur.id,
            referenceNumber: cur.invoiceNumber,
            notes: `عكس مخزون إلغاء فاتورة رقم ${cur.invoiceNumber} - ${cleanReason}`,
            createdBy: actor.fullName,
            createdByUserId: actor.id,
            createdAt: now,
          });
        }
      }

      const appliedAdv = cur.type === 'sales' ? round2(Number(cur.appliedAdvanceAmount || 0)) : 0;
      const remainingToReverse = round2(Number(cur.remainingAmount || 0) - totalBalanceReturns);
      const cashToReverse = round2(Number(cur.paidAmount || 0) - appliedAdv - totalCashReturns);

      if (cur.customerId) {
        const cust = db.customers.find((c) => c.id === cur.customerId);
        if (cust) cust.currentBalance = round2(Number(cust.currentBalance || 0) - remainingToReverse - appliedAdv);
      }
      if (cur.supplierId) {
        const supp = db.suppliers.find((s) => s.id === cur.supplierId);
        if (supp) supp.currentBalance = round2(Number(supp.currentBalance || 0) - remainingToReverse);
      }
      if (cashToReverse !== 0 && cur.cashboxId) {
        const cb = db.cashboxes.find((c) => c.id === cur.cashboxId);
        if (cb) {
          const deltaCb = cur.type === 'sales' ? -cashToReverse : cashToReverse;
          const nextCb = round2(Number(cb.currentBalance || 0) + deltaCb);
          cb.currentBalance = nextCb;

          db.financialTransactions.unshift({
            id: generateServerId('FT'),
            transactionNumber: `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
            date: todayIso(),
            type: deltaCb < 0 ? 'withdrawal' : 'deposit',
            cashboxId: cb.id,
            cashboxName: cb.name,
            balanceAfter: nextCb,
            amount: round2(Math.abs(deltaCb)),
            category: cur.type === 'sales' ? 'إلغاء فاتورة مبيعات' : 'إلغاء فاتورة مشتريات',
            relatedEntityType: cur.type === 'sales' ? 'customer' : 'supplier',
            relatedEntityId: cur.customerId || cur.supplierId || undefined,
            relatedEntityName: cur.customerName || cur.supplierName || '',
            relatedDocType: cur.type,
            relatedDocId: cur.id,
            relatedDocNumber: cur.invoiceNumber,
            partyId: cur.customerId || cur.supplierId,
            partyName: cur.customerName || cur.supplierName,
            description: `تسوية خزينة لإلغاء فاتورة رقم ${cur.invoiceNumber}`,
            notes: cleanReason,
            createdBy: actor.fullName,
            createdByUserId: actor.id,
            createdAt: now,
          });
        }
      }
      if (cur.type === 'sales' && cur.representativeId && cashToReverse !== 0) {
        const rep = db.representatives.find((r) => r.id === cur.representativeId);
        if (rep) rep.currentBalance = round2(Number(rep.currentBalance || 0) - cashToReverse);
      }
      if (appliedAdv > 0) {
        for (const oap of db.orderAdvancePayments || []) {
          if (oap.appliedInvoiceId === invoiceId) {
            oap.status = 'active';
            oap.appliedInvoiceId = undefined;
          }
        }
      }
    }

    cur.status = 'cancelled';
    cur.cancelledBy = actor.fullName;
    cur.cancelledAt = now;
    cur.cancelReason = cleanReason;
    cur.version = Number(cur.version || 1) + 1;
    cur.updatedAt = now;
    cur.notes = `${cur.notes || ''} [تم الإلغاء: ${cleanReason}]`.trim();
    return {
      updatedInv: cur,
      beforeSnapshot,
      newValues: {
        status: 'cancelled',
        cancelReason: cleanReason,
        cancelledBy: actor.fullName,
        cancelledAt: now,
        totalBalanceReturns,
        totalCashReturns,
      },
    };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إلغاء فاتورة (${out.updatedInv.invoiceNumber})`,
    module: out.updatedInv.type === 'sales' ? 'المبيعات' : out.updatedInv.type === 'quote' ? 'عروض الأسعار' : 'المشتريات',
    recordId: invoiceId,
    oldValues: out.beforeSnapshot,
    newValues: out.newValues,
    notes: cleanReason,
  });
  return actor?.role === 'representative' ? sanitizeInvoiceForRepresentative(out.updatedInv) : out.updatedInv;
}

export async function markInvoiceReviewed(invoiceId, { notes = '' } = {}, actor) {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'غير مصرح للمندوب أو العميل بتأكيد مراجعة الفاتورة', 'FORBIDDEN_REVIEW');
  }
  const now = nowIso();
  const cleanNotes = String(notes || '').trim();

  const updated = (await isPgMode())
    ? await withTransaction(async (client) => {
        const cur = await fetchFullInvoicePg(client, invoiceId);
        if (!cur) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
        if (cur.reviewStatus === 'reviewed') {
          return cur;
        }
        await client.query(
          `UPDATE invoices SET review_status = 'reviewed', reviewed_by = $1, reviewed_at = $2, review_notes = $3, updated_at = $2 WHERE id = $4`,
          [actor.fullName, now, cleanNotes, invoiceId]
        );
        return fetchFullInvoicePg(client, invoiceId);
      })
    : await withJsonTransaction((db) => {
        const cur = db.invoices.find((i) => i.id === invoiceId);
        if (!cur) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
        if (cur.reviewStatus === 'reviewed') {
          return cur;
        }
        cur.reviewStatus = 'reviewed';
        cur.reviewedBy = actor.fullName;
        cur.reviewedAt = now;
        cur.reviewNotes = cleanNotes;
        cur.updatedAt = now;
        return cur;
      });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تأكيد مراجعة فاتورة المندوب (${updated.invoiceNumber}) دون إعادة تسجيل المبيعات`,
    module: 'المبيعات',
    recordId: invoiceId,
    notes: cleanNotes,
  });
  return updated;
}

function assertInvoicePaymentAuthorized({ invType, invRepId, invSentByUserId, invCreatedBy, invCreatedByUserId }, actor, repProfile) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بتسجيل دفعات على الفواتير', 'FORBIDDEN');
  }
  const perms = actor.permissions || {};
  if (actor.role === 'representative') {
    const isOwn = isRepOwnerOfInvoice(
      {
        representativeId: invRepId,
        sentByUserId: invSentByUserId,
        createdBy: invCreatedBy,
        createdByUserId: invCreatedByUserId,
      },
      actor,
      repProfile
    );
    if (invType === 'sales') {
      if (!perms.canManageSales) {
        throw new AppError(403, 'ليس لديك صلاحية تحصيل دفعات فواتير المبيعات', 'FORBIDDEN_PERMISSION');
      }
      if (!isOwn) {
        throw new AppError(403, 'غير مصرح للمندوب بتسجيل دفعة على فاتورة مبيعات لمندوب آخر', 'FORBIDDEN_REP_INVOICE_ACCESS');
      }
      return;
    }
    if (invType === 'purchase') {
      if (!perms.canCreatePurchase && !perms.canManagePurchases) {
        throw new AppError(403, 'ليس لديك صلاحية إدارة أو سداد فواتير المشتريات', 'FORBIDDEN_PERMISSION');
      }
      if (!isOwn) {
        throw new AppError(403, 'غير مصرح للمندوب بسداد فاتورة مشتريات لا تخصه', 'FORBIDDEN_REP_INVOICE_ACCESS');
      }
      return;
    }
    throw new AppError(403, 'نوع الفاتورة غير مصرح به لتسجيل الدفع', 'FORBIDDEN_PERMISSION');
  }
  if (actor.role === 'admin' || perms.canManageAccounts) return;
  if (invType === 'sales' && perms.canManageSales) return;
  if (invType === 'purchase' && perms.canManagePurchases) return;
  throw new AppError(403, 'ليس لديك صلاحية تسجيل دفعات على هذه الفاتورة', 'FORBIDDEN_PERMISSION');
}

export async function addInvoicePaymentPgTx(client, invoiceId, paymentData, actor, idempotencyKey = '', options = {}) {
  const amount = round2(paymentData.amount);
  if (amount <= 0) throw new AppError(400, 'مبلغ الدفعة يجب أن يكون أكبر من الصفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const payDate = paymentData.date || todayIso();
  const payId = generateServerId('PAY');
  const endpoint = `POST /api/invoices/${invoiceId}/payments`;
  const scopedIdem = idempotencyKey ? buildScopedIdemKey(endpoint, actor, idempotencyKey) : '';

  if (scopedIdem) {
    const dup = await findPgIdempotency(client, scopedIdem);
    if (dup?.invoice) {
      return {
        deduplicated: true,
        invoice: actor?.role === 'representative' ? sanitizeInvoiceForRepresentative(dup.invoice) : dup.invoice,
      };
    }
  }

  const invRes = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
  const inv = invRes.rows[0];
  if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');

  let repProfile = null;
  if (actor?.role === 'representative') {
    const repRow = (await client.query(`SELECT id FROM representatives WHERE user_id = $1 LIMIT 1`, [actor.id])).rows[0];
    repProfile = repRow ? { id: repRow.id } : null;
  }
  assertInvoicePaymentAuthorized(
    {
      invType: inv.type,
      invRepId: inv.representative_id,
      invSentByUserId: inv.sent_by_user_id,
      invCreatedBy: inv.created_by,
      invCreatedByUserId: inv.created_by_user_id,
    },
    actor,
    repProfile
  );

  if (inv.status !== 'confirmed') throw new AppError(409, 'لا يمكن تسجيل دفعة إلا على فاتورة معتمدة', 'INVOICE_NOT_CONFIRMED');
  if (amount > round2(inv.remaining_amount) + 0.01) {
    throw new AppError(400, `قيمة الدفعة (${amount}) تتجاوز المتبقي (${inv.remaining_amount})`, 'EXCEEDS_REMAINING');
  }

  let cashboxId = actor?.role === 'representative' ? undefined : paymentData.cashboxId;
  if (!cashboxId) {
    const defCb = await client.query(`SELECT id FROM cashboxes ORDER BY is_default DESC LIMIT 1`);
    cashboxId = defCb.rows[0]?.id;
  }
  if (!cashboxId) throw new AppError(400, 'لا توجد خزينة متاحة لتسجيل الدفعة', 'CASHBOX_REQUIRED');
  const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [cashboxId]);
  if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة المحددة غير موجودة', 'CASHBOX_NOT_FOUND');

  const newPaid = round2(Number(inv.paid_amount || 0) + amount);
  const newRem = round2(Math.max(0, Number(inv.grand_total || 0) - newPaid));
  const newPayType = newRem <= 0 ? 'cash' : 'partial';

  await client.query(
    `UPDATE invoices SET paid_amount = $1, remaining_amount = $2, payment_type = $3, updated_at = $4 WHERE id = $5`,
    [newPaid, newRem, newPayType, now, invoiceId]
  );
  await client.query(
    `INSERT INTO invoice_payments (id, invoice_id, invoice_number, amount, date, payment_method, cashbox_id, cashbox_name, notes, created_by, created_by_user_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      payId,
      invoiceId,
      inv.invoice_number,
      amount,
      payDate,
      paymentData.paymentMethod || 'cash',
      cbRes.rows[0].id,
      cbRes.rows[0].name,
      paymentData.notes || 'سداد دفعة على الفاتورة',
      actor.fullName,
      actor.id || null,
      now,
    ]
  );

  const isSales = inv.type === 'sales';
  if (isSales && inv.customer_id) {
    const cRes = await client.query(`SELECT current_balance FROM customers WHERE id = $1 FOR UPDATE`, [inv.customer_id]);
    if (cRes.rows[0]) {
      await client.query(`UPDATE customers SET current_balance = $1 WHERE id = $2`, [
        round2(Number(cRes.rows[0].current_balance || 0) - amount),
        inv.customer_id,
      ]);
    }
  } else if (!isSales && inv.supplier_id) {
    const sRes = await client.query(`SELECT current_balance FROM suppliers WHERE id = $1 FOR UPDATE`, [inv.supplier_id]);
    if (sRes.rows[0]) {
      await client.query(`UPDATE suppliers SET current_balance = $1 WHERE id = $2`, [
        round2(Number(sRes.rows[0].current_balance || 0) - amount),
        inv.supplier_id,
      ]);
    }
  }

  const nextCb = isSales
    ? round2(Number(cbRes.rows[0].current_balance || 0) + amount)
    : round2(Number(cbRes.rows[0].current_balance || 0) - amount);
  await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCb, cbRes.rows[0].id]);

  const txId = generateServerId('FT');
  await client.query(
    `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, notes, created_by, created_by_user_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      txId,
      `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
      payDate,
      isSales ? 'customer_payment' : 'supplier_payment',
      amount,
      cbRes.rows[0].id,
      cbRes.rows[0].name,
      nextCb,
      isSales ? 'تحصيل دفعة مبيعات' : 'سداد دفعة مشتريات',
      isSales ? inv.customer_id : inv.supplier_id,
      isSales ? inv.customer_name : inv.supplier_name,
      inv.type,
      inv.id,
      inv.invoice_number,
      `دفعة مسجلة على الفاتورة رقم ${inv.invoice_number} (${cbRes.rows[0].name})`,
      paymentData.notes || '',
      actor.fullName,
      actor.id || null,
      now,
    ]
  );

  const updatedInv = await fetchFullInvoicePg(client, invoiceId);
  if (!options.skipAuditLog) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تسجيل دفعة (${amount}) على فاتورة ${updatedInv.invoiceNumber}`,
      module: 'المالية',
      recordId: invoiceId,
      client,
    });
  }
  if (scopedIdem) {
    await savePgIdempotency(client, scopedIdem, actor, endpoint, { invoice: updatedInv });
  }
  return { deduplicated: false, invoice: updatedInv };
}

export function addInvoicePaymentJsonTx(db, invoiceId, paymentData, actor, idempotencyKey = '') {
  const amount = round2(paymentData.amount);
  if (amount <= 0) throw new AppError(400, 'مبلغ الدفعة يجب أن يكون أكبر من الصفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const payDate = paymentData.date || todayIso();
  const payId = generateServerId('PAY');
  const endpoint = `POST /api/invoices/${invoiceId}/payments`;
  const scopedIdem = idempotencyKey ? buildScopedIdemKey(endpoint, actor, idempotencyKey) : '';

  if (scopedIdem) {
    const dup = findJsonIdempotency(scopedIdem);
    if (dup?.invoice) {
      return {
        deduplicated: true,
        invoice: actor?.role === 'representative' ? sanitizeInvoiceForRepresentative(dup.invoice) : dup.invoice,
      };
    }
  }

  const inv = db.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
  const repProfile =
    actor?.role === 'representative'
      ? (db.representatives || []).find((r) => r.userId === actor.id) || null
      : null;
  assertInvoicePaymentAuthorized(
    {
      invType: inv.type,
      invRepId: inv.representativeId,
      invSentByUserId: inv.sentByUserId,
      invCreatedBy: inv.createdBy,
      invCreatedByUserId: inv.createdByUserId,
    },
    actor,
    repProfile
  );
  if (inv.status !== 'confirmed') throw new AppError(409, 'لا يمكن تسجيل دفعة إلا على فاتورة معتمدة', 'INVOICE_NOT_CONFIRMED');
  if (amount > round2(inv.remainingAmount) + 0.01) {
    throw new AppError(400, `قيمة الدفعة (${amount}) تتجاوز المتبقي (${inv.remainingAmount})`, 'EXCEEDS_REMAINING');
  }
  const cb =
    actor?.role !== 'representative' && paymentData.cashboxId
      ? db.cashboxes.find((c) => c.id === paymentData.cashboxId)
      : db.cashboxes.find((c) => c.isDefault) || db.cashboxes[0];
  if (!cb) throw new AppError(404, 'الخزينة المحددة غير موجودة', 'CASHBOX_NOT_FOUND');

  const newPayment = {
    id: payId,
    invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber,
    amount,
    date: payDate,
    paymentMethod: paymentData.paymentMethod || 'cash',
    cashboxId: cb.id,
    cashboxName: cb.name,
    notes: paymentData.notes || 'سداد دفعة على الفاتورة',
    createdBy: actor.fullName,
    createdByUserId: actor.id,
    createdAt: now,
  };

  inv.paidAmount = round2(Number(inv.paidAmount || 0) + amount);
  inv.remainingAmount = round2(Math.max(0, Number(inv.grandTotal || 0) - inv.paidAmount));
  inv.paymentType = inv.remainingAmount <= 0 ? 'cash' : 'partial';
  inv.payments = [...(inv.payments || []), newPayment];

  const isSales = inv.type === 'sales';
  if (isSales && inv.customerId) {
    const cust = db.customers.find((c) => c.id === inv.customerId);
    if (cust) cust.currentBalance = round2(Number(cust.currentBalance || 0) - amount);
  } else if (!isSales && inv.supplierId) {
    const supp = db.suppliers.find((s) => s.id === inv.supplierId);
    if (supp) supp.currentBalance = round2(Number(supp.currentBalance || 0) - amount);
  }

  cb.currentBalance = isSales ? round2(Number(cb.currentBalance || 0) + amount) : round2(Number(cb.currentBalance || 0) - amount);

  db.financialTransactions.unshift({
    id: generateServerId('FT'),
    transactionNumber: `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
    date: payDate,
    type: isSales ? 'customer_payment' : 'supplier_payment',
    cashboxId: cb.id,
    cashboxName: cb.name,
    amount,
    category: isSales ? 'تحصيل دفعة مبيعات' : 'سداد دفعة مشتريات',
    relatedDocType: inv.type,
    relatedDocId: inv.id,
    relatedDocNumber: inv.invoiceNumber,
    partyId: isSales ? inv.customerId : inv.supplierId,
    partyName: isSales ? inv.customerName : inv.supplierName,
    description: `دفعة مسجلة على الفاتورة رقم ${inv.invoiceNumber} (${cb.name})`,
    notes: paymentData.notes || '',
    createdBy: actor.fullName,
    createdByUserId: actor.id,
    createdAt: now,
  });
  if (scopedIdem) {
    saveJsonIdempotency(scopedIdem, { invoice: inv });
  }
  return { deduplicated: false, invoice: inv };
}

export async function addInvoicePayment(invoiceId, paymentData, actor, idempotencyKey = '') {
  const amount = round2(paymentData.amount);
  if (amount <= 0) throw new AppError(400, 'مبلغ الدفعة يجب أن يكون أكبر من الصفر', 'INVALID_AMOUNT');

  if (await isPgMode()) {
    const out = await withTransaction((client) =>
      addInvoicePaymentPgTx(client, invoiceId, paymentData, actor, idempotencyKey)
    );
    return actor?.role === 'representative' ? sanitizeInvoiceForRepresentative(out.invoice) : out.invoice;
  }

  const out = await withJsonTransaction((db) =>
    addInvoicePaymentJsonTx(db, invoiceId, paymentData, actor, idempotencyKey)
  );

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تسجيل دفعة (${amount}) على فاتورة ${out.invoice.invoiceNumber}`,
      module: 'المالية',
      recordId: invoiceId,
    });
  }
  return actor?.role === 'representative' ? sanitizeInvoiceForRepresentative(out.invoice) : out.invoice;
}

export async function createInvoiceReturn(returnData, actor, idempotencyKey = '') {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بتنفيذ المرتجعات', 'FORBIDDEN');
  }
  if (!Array.isArray(returnData.items) || returnData.items.length === 0) {
    throw new AppError(400, 'يجب تحديد صنف واحد على الأقل للمرتجع', 'EMPTY_RETURN');
  }
  const now = nowIso();
  const retDate = returnData.date || todayIso();
  const isSalesReturn = returnData.type === 'sales_return';
  if (actor.role === 'representative' && !isSalesReturn) {
    throw new AppError(
      403,
      'لا يمكن للمندوب تنفيذ مرتجع مشتريات مباشر؛ يرجى رفع طلب مرتجع مشتريات لاعتماد الإدارة',
      'FORBIDDEN_REP_DIRECT_PURCHASE_RETURN'
    );
  }
  const repActor = actor.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor.role === 'representative' && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }

  const retId = generateServerId('RET');
  const endpoint = 'POST /api/invoices/returns';
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const dup = await findPgIdempotency(client, scopedIdem);
      if (dup?.invoiceReturn) return { deduplicated: true, invoiceReturn: dup.invoiceReturn };

      const orig = await fetchFullInvoicePg(client, returnData.originalInvoiceId);
      if (!orig) throw new AppError(404, 'الفاتورة الأصلية غير موجودة', 'INVOICE_NOT_FOUND');
      if (isSalesReturn && orig.type !== 'sales') {
        throw new AppError(400, 'المستند الأصلي ليس فاتورة مبيعات', 'INVALID_ORIGINAL_INVOICE_TYPE');
      }
      if (!isSalesReturn && orig.type !== 'purchase') {
        throw new AppError(400, 'المستند الأصلي ليس فاتورة مشتريات', 'INVALID_ORIGINAL_INVOICE_TYPE');
      }
      if (repActor && !isRepOwnerOfInvoice(orig, actor, repActor)) {
        throw new AppError(403, 'غير مصرح للمندوب بإنشاء مرتجع لفاتورة لا تخصه', 'FORBIDDEN_REP_INVOICE_ACCESS');
      }
      if (orig.status !== 'confirmed') throw new AppError(409, 'لا يمكن عمل مرتجع لفاتورة مسودة أو ملغاة', 'INVALID_INVOICE_STATUS');

      const returnedMap = { ...(orig.returnedQuantityByItem || {}) };
      const normalizedItems = [];
      let grandTotal = 0;

      for (const item of returnData.items) {
        const origItem = orig.items.find((it) => it.productId === item.productId);
        if (!origItem) throw new AppError(400, `الصنف ${item.productName} غير موجود بالفاتورة الأصلية`, 'ITEM_NOT_IN_INVOICE');
        const qty = round3(item.quantity);
        if (qty <= 0) throw new AppError(400, 'كمية المرتجع يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');
        const prevRet = Number(returnedMap[item.productId] || 0);
        if (prevRet + qty > origItem.quantity + 0.0001) {
          throw new AppError(400, `الكمية المرتجعة للصنف (${origItem.productName}) تتجاوز المتبقي (${origItem.quantity - prevRet})`, 'EXCEEDS_RETURNABLE');
        }
        returnedMap[item.productId] = round3(prevRet + qty);
        const unitPrice = round2(item.unitPrice ?? origItem.unitPrice);
        const lineTotal = round2(qty * unitPrice);
        grandTotal = round2(grandTotal + lineTotal);
        normalizedItems.push({
          productId: item.productId,
          productName: item.productName || origItem.productName,
          unit: item.unit || origItem.unit,
          unitFactor: Number(item.unitFactor || origItem.unitFactor || 1),
          quantity: qty,
          unitPrice,
          total: lineTotal,
        });
      }

      const seqName = isSalesReturn ? 'seq_sales_return_no' : 'seq_purchase_return_no';
      const seqNum = Number((await client.query(`SELECT nextval('${seqName}') AS n`)).rows[0]?.n || 1);
      const returnNumber = `${isSalesReturn ? 'RET-SAL' : 'RET-PUR'}-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;
      const whId = returnData.warehouseId || orig.warehouseId;
      const whRow = (await client.query(`SELECT id, name FROM warehouses WHERE id = $1 LIMIT 1`, [whId])).rows[0];
      const whName = whRow?.name || orig.warehouseName;

      await client.query(
        `INSERT INTO invoice_returns (id, return_number, type, original_invoice_id, original_invoice_number, date, party_id, party_name, warehouse_id, warehouse_name, grand_total, refund_type, cashbox_id, reason, notes, created_by, created_by_user_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          retId,
          returnNumber,
          returnData.type,
          orig.id,
          orig.invoiceNumber,
          retDate,
          returnData.partyId || (isSalesReturn ? orig.customerId : orig.supplierId) || 'general',
          returnData.partyName || (isSalesReturn ? orig.customerName : orig.supplierName) || '',
          whId,
          whName,
          grandTotal,
          returnData.refundType || 'balance',
          returnData.cashboxId || null,
          returnData.reason || 'مرتجع فاتورة',
          returnData.notes || '',
          actor.fullName,
          actor.id || null,
          now,
        ]
      );

      for (let i = 0; i < normalizedItems.length; i++) {
        const it = normalizedItems[i];
        await client.query(
          `INSERT INTO invoice_return_items (id, return_id, product_id, product_name, unit, unit_factor, quantity, unit_price, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [`${retId}-RITM-${i + 1}`, retId, it.productId, it.productName, it.unit, it.unitFactor, it.quantity, it.unitPrice, it.total]
        );

        const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [it.productId]);
        if (pRes.rows[0]) {
          const stockMap = { ...(pRes.rows[0].stock_per_warehouse || {}) };
          const curQty = Number(stockMap[whId] || 0);
          const baseQty = round3(it.quantity * it.unitFactor);
          const nextQty = isSalesReturn ? round3(curQty + baseQty) : round3(curQty - baseQty);
          stockMap[whId] = nextQty;
          await client.query(`UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3`, [JSON.stringify(stockMap), now, it.productId]);

          const mvId = generateServerId('SM');
          await client.query(
            `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_before, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_by_user_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
            [
              mvId,
              mvId,
              retDate,
              it.productId,
              it.productName,
              whId,
              whName,
              isSalesReturn ? 'sale_return' : 'purchase_return',
              baseQty,
              it.unit,
              it.unitFactor,
              it.unitPrice,
              curQty,
              nextQty,
              returnData.type,
              retId,
              returnNumber,
              `سند مرتجع رقم ${returnNumber} - السبب: ${returnData.reason || ''}`,
              actor.fullName,
              actor.id || null,
              now,
            ]
          );
        }
      }

      if ((returnData.refundType || 'balance') === 'balance') {
        if (isSalesReturn && orig.customerId) {
          const cRes = await client.query(`SELECT current_balance FROM customers WHERE id = $1 FOR UPDATE`, [orig.customerId]);
          if (cRes.rows[0]) {
            await client.query(`UPDATE customers SET current_balance = $1 WHERE id = $2`, [
              round2(Number(cRes.rows[0].current_balance || 0) - grandTotal),
              orig.customerId,
            ]);
          }
        } else if (!isSalesReturn && orig.supplierId) {
          const sRes = await client.query(`SELECT current_balance FROM suppliers WHERE id = $1 FOR UPDATE`, [orig.supplierId]);
          if (sRes.rows[0]) {
            await client.query(`UPDATE suppliers SET current_balance = $1 WHERE id = $2`, [
              round2(Number(sRes.rows[0].current_balance || 0) - grandTotal),
              orig.supplierId,
            ]);
          }
        }
      } else if (returnData.refundType === 'cash' && returnData.cashboxId) {
        const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [returnData.cashboxId]);
        if (cbRes.rows[0]) {
          const nextCb = isSalesReturn
            ? round2(Number(cbRes.rows[0].current_balance || 0) - grandTotal)
            : round2(Number(cbRes.rows[0].current_balance || 0) + grandTotal);
          await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCb, returnData.cashboxId]);
          const txId = generateServerId('FT');
          await client.query(
            `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, created_by, created_by_user_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [
              txId,
              `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
              retDate,
              isSalesReturn ? 'expense' : 'income',
              grandTotal,
              cbRes.rows[0].id,
              cbRes.rows[0].name,
              nextCb,
              isSalesReturn ? 'رد قيمة مرتجع مبيعات نقدي' : 'استرداد قيمة مرتجع مشتريات نقدي',
              isSalesReturn ? orig.customerId : orig.supplierId,
              isSalesReturn ? orig.customerName : orig.supplierName,
              returnData.type,
              retId,
              returnNumber,
              `تسوية نقدية لمرتجع رقم ${returnNumber}`,
              actor.fullName,
              actor.id || null,
              now,
            ]
          );
        }
      }

      await client.query(`UPDATE invoices SET returned_quantity_by_item = $1, updated_at = $2 WHERE id = $3`, [
        JSON.stringify(returnedMap),
        now,
        orig.id,
      ]);

      const createdReturn = {
        id: retId,
        returnNumber,
        type: returnData.type,
        originalInvoiceId: orig.id,
        originalInvoiceNumber: orig.invoiceNumber,
        date: retDate,
        partyId: returnData.partyId || orig.customerId || orig.supplierId || 'general',
        partyName: returnData.partyName || orig.customerName || orig.supplierName || '',
        warehouseId: whId,
        warehouseName: whName,
        items: normalizedItems,
        grandTotal,
        refundType: returnData.refundType || 'balance',
        cashboxId: returnData.cashboxId,
        reason: returnData.reason || '',
        notes: returnData.notes || '',
        createdBy: actor.fullName,
        createdByUserId: actor.id,
        createdAt: now,
      };
      await savePgIdempotency(client, scopedIdem, actor, endpoint, { invoiceReturn: createdReturn });
      return { deduplicated: false, invoiceReturn: createdReturn };
    });

    if (!out.deduplicated) {
      await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء سند مرتجع (${out.invoiceReturn.returnNumber})`, module: 'المرتجعات', recordId: out.invoiceReturn.id });
    }
    return out.invoiceReturn;
  }

  const out = await withJsonTransaction(async (db) => {
    const dup = findJsonIdempotency(scopedIdem);
    if (dup?.invoiceReturn) return { deduplicated: true, invoiceReturn: dup.invoiceReturn };

    const orig = db.invoices.find((i) => i.id === returnData.originalInvoiceId);
    if (!orig) throw new AppError(404, 'الفاتورة الأصلية غير موجودة', 'INVOICE_NOT_FOUND');
    if (isSalesReturn && orig.type !== 'sales') {
      throw new AppError(400, 'المستند الأصلي ليس فاتورة مبيعات', 'INVALID_ORIGINAL_INVOICE_TYPE');
    }
    if (!isSalesReturn && orig.type !== 'purchase') {
      throw new AppError(400, 'المستند الأصلي ليس فاتورة مشتريات', 'INVALID_ORIGINAL_INVOICE_TYPE');
    }
    if (repActor && !isRepOwnerOfInvoice(orig, actor, repActor)) {
      throw new AppError(403, 'غير مصرح للمندوب بإنشاء مرتجع لفاتورة لا تخصه', 'FORBIDDEN_REP_INVOICE_ACCESS');
    }
    if (orig.status !== 'confirmed') throw new AppError(409, 'لا يمكن عمل مرتجع لفاتورة مسودة أو ملغاة', 'INVALID_INVOICE_STATUS');

    const returnedMap = { ...(orig.returnedQuantityByItem || {}) };
    const normalizedItems = [];
    let grandTotal = 0;

    for (const item of returnData.items) {
      const origItem = orig.items.find((it) => it.productId === item.productId);
      if (!origItem) throw new AppError(400, `الصنف ${item.productName} غير موجود بالفاتورة الأصلية`, 'ITEM_NOT_IN_INVOICE');
      const qty = round3(item.quantity);
      if (qty <= 0) throw new AppError(400, 'كمية المرتجع يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');
      const prevRet = Number(returnedMap[item.productId] || 0);
      if (prevRet + qty > origItem.quantity + 0.0001) {
        throw new AppError(400, `الكمية المرتجعة للصنف (${origItem.productName}) تتجاوز المتبقي (${origItem.quantity - prevRet})`, 'EXCEEDS_RETURNABLE');
      }
      returnedMap[item.productId] = round3(prevRet + qty);
      const unitPrice = round2(item.unitPrice ?? origItem.unitPrice);
      const lineTotal = round2(qty * unitPrice);
      grandTotal = round2(grandTotal + lineTotal);
      normalizedItems.push({
        productId: item.productId,
        productName: item.productName || origItem.productName,
        unit: item.unit || origItem.unit,
        unitFactor: Number(item.unitFactor || origItem.unitFactor || 1),
        quantity: qty,
        unitPrice,
        total: lineTotal,
      });
    }

    const seqKey = isSalesReturn ? 'salesReturnNo' : 'purchaseReturnNo';
    const seqNum = nextJsonSequence(db, seqKey, db.invoiceReturns.filter((r) => r.type === returnData.type), 'returnNumber', /(\d+)$/);
    const returnNumber = `${isSalesReturn ? 'RET-SAL' : 'RET-PUR'}-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;
    const whId = returnData.warehouseId || orig.warehouseId;
    const whName = db.warehouses.find((w) => w.id === whId)?.name || orig.warehouseName;

    for (const it of normalizedItems) {
      const prod = db.products.find((p) => p.id === it.productId);
      if (prod) {
        const curQty = Number(prod.stockPerWarehouse?.[whId] || 0);
        const baseQty = round3(it.quantity * it.unitFactor);
        const nextQty = isSalesReturn ? round3(curQty + baseQty) : round3(curQty - baseQty);
        prod.stockPerWarehouse[whId] = nextQty;
        const mvId = generateServerId('SM');
        db.stockMovements.unshift({
          id: mvId,
          movementNumber: mvId,
          date: retDate,
          type: isSalesReturn ? 'sale_return' : 'purchase_return',
          productId: prod.id,
          productName: prod.name,
          warehouseId: whId,
          warehouseName: whName,
          quantity: baseQty,
          unit: it.unit || prod.baseUnit,
          unitFactor: Number(it.unitFactor || 1),
          unitCost: it.unitPrice,
          balanceBefore: curQty,
          balanceAfter: nextQty,
          relatedDocType: isSalesReturn ? 'sales_return' : 'purchase_return',
          referenceId: retId,
          referenceNumber: returnNumber,
          notes: `سند مرتجع رقم ${returnNumber} - السبب: ${returnData.reason || ''}`,
          createdBy: actor.fullName,
          createdByUserId: actor.id,
          createdAt: now,
        });
      }
    }

    if ((returnData.refundType || 'balance') === 'balance') {
      if (isSalesReturn && orig.customerId) {
        const cust = db.customers.find((c) => c.id === orig.customerId);
        if (cust) cust.currentBalance = round2(Number(cust.currentBalance || 0) - grandTotal);
      } else if (!isSalesReturn && orig.supplierId) {
        const supp = db.suppliers.find((s) => s.id === orig.supplierId);
        if (supp) supp.currentBalance = round2(Number(supp.currentBalance || 0) - grandTotal);
      }
    } else if (returnData.refundType === 'cash' && returnData.cashboxId) {
      const cb = db.cashboxes.find((c) => c.id === returnData.cashboxId);
      if (cb) {
        cb.currentBalance = isSalesReturn
          ? round2(Number(cb.currentBalance || 0) - grandTotal)
          : round2(Number(cb.currentBalance || 0) + grandTotal);
        db.financialTransactions.unshift({
          id: generateServerId('FT'),
          transactionNumber: `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
          date: retDate,
          type: isSalesReturn ? 'expense' : 'income',
          cashboxId: cb.id,
          cashboxName: cb.name,
          amount: grandTotal,
          category: isSalesReturn ? 'رد قيمة مرتجع مبيعات نقدي' : 'استرداد قيمة مرتجع مشتريات نقدي',
          relatedDocType: returnData.type,
          relatedDocId: retId,
          relatedDocNumber: returnNumber,
          partyId: orig.customerId || orig.supplierId,
          partyName: orig.customerName || orig.supplierName,
          description: `تسوية نقدية لمرتجع رقم ${returnNumber}`,
          createdBy: actor.fullName,
          createdByUserId: actor.id,
          createdAt: now,
        });
      }
    }

    orig.returnedQuantityByItem = returnedMap;
    const newRet = {
      id: retId,
      returnNumber,
      type: returnData.type,
      originalInvoiceId: orig.id,
      originalInvoiceNumber: orig.invoiceNumber,
      date: retDate,
      partyId: returnData.partyId || orig.customerId || orig.supplierId || 'general',
      partyName: returnData.partyName || orig.customerName || orig.supplierName || '',
      warehouseId: whId,
      warehouseName: whName,
      items: normalizedItems,
      grandTotal,
      refundType: returnData.refundType || 'balance',
      cashboxId: returnData.cashboxId,
      reason: returnData.reason || '',
      notes: returnData.notes || '',
      createdBy: actor.fullName,
      createdByUserId: actor.id,
      createdAt: now,
    };
    db.invoiceReturns.unshift(newRet);
    saveJsonIdempotency(scopedIdem, { invoiceReturn: newRet });
    return { deduplicated: false, invoiceReturn: newRet };
  });

  if (!out.deduplicated) {
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء سند مرتجع (${out.invoiceReturn.returnNumber})`, module: 'المرتجعات', recordId: out.invoiceReturn.id });
  }
  return out.invoiceReturn;
}

export async function listPurchaseReturnRequests(actor = null) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بعرض طلبات مرتجع المشتريات', 'FORBIDDEN');
  }
  const isRep = actor.role === 'representative';
  const canPurchasePerm = Boolean(actor.permissions?.canCreatePurchase || actor.permissions?.canManagePurchases || actor.permissions?.canApprove);
  if (actor.role !== 'admin' && !canPurchasePerm) {
    return [];
  }
  const repActor = isRep ? await getRepresentativeByUserId(actor.id) : null;

  if (await isPgMode()) {
    const pool = getPool();
    let reqRes;
    if (isRep) {
      const clauses = ['requested_by_user_id = $1'];
      const params = [actor.id];
      if (repActor?.id) {
        params.push(repActor.id);
        clauses.push(`representative_id = $${params.length}`);
      }
      reqRes = await pool.query(
        `SELECT * FROM purchase_return_requests WHERE (${clauses.join(' OR ')}) ORDER BY created_at DESC`,
        params
      );
    } else {
      reqRes = await pool.query(`SELECT * FROM purchase_return_requests ORDER BY created_at DESC`);
    }
    if (reqRes.rows.length === 0) return [];
    const reqIds = reqRes.rows.map((r) => r.id);
    const itemsRes = await pool.query(
      `SELECT * FROM purchase_return_request_items WHERE request_id = ANY($1::varchar[])`,
      [reqIds]
    );
    const itemsMap = new Map();
    for (const it of itemsRes.rows) {
      const list = itemsMap.get(it.request_id) || [];
      list.push(it);
      itemsMap.set(it.request_id, list);
    }
    return reqRes.rows.map((r) => mapPgPurchaseReturnRequestRow(r, itemsMap.get(r.id) || []));
  }

  const db = readJsonDatabase();
  const all = Array.isArray(db.purchaseReturnRequests) ? db.purchaseReturnRequests : [];
  if (isRep) {
    return all.filter(
      (r) =>
        r.requestedByUserId === actor.id ||
        (repActor?.id && r.representativeId === repActor.id)
    );
  }
  return all;
}

export async function createPurchaseReturnRequest(payload, actor, idempotencyKey = '') {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بإنشاء طلبات مرتجع مشتريات', 'FORBIDDEN');
  }
  const isRep = actor.role === 'representative';
  if (actor.role !== 'admin' && !actor.permissions?.canCreatePurchase && !actor.permissions?.canManagePurchases) {
    throw new AppError(403, 'ليس لديك صلاحية إنشاء طلب مرتجع مشتريات', 'FORBIDDEN_PERMISSION');
  }
  const repActor = isRep ? await getRepresentativeByUserId(actor.id) : null;
  if (isRep && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }

  const originalInvoiceId = String(payload?.originalInvoiceId || '').trim();
  if (!originalInvoiceId) {
    throw new AppError(400, 'يجب تحديد فاتورة الشراء الأصلية', 'ORIGINAL_INVOICE_REQUIRED');
  }
  if (!Array.isArray(payload?.items) || payload.items.length === 0) {
    throw new AppError(400, 'يجب تحديد صنف واحد على الأقل في طلب المرتجع', 'EMPTY_RETURN_REQUEST');
  }
  const cleanReason = String(payload?.reason || '').trim();
  if (!cleanReason) {
    throw new AppError(400, 'يرجى كتابة سبب طلب مرتجع المشتريات', 'REASON_REQUIRED');
  }
  const refundType = payload?.refundType === 'cash' ? 'cash' : 'balance';
  const reqDate = payload?.date || todayIso();
  const cleanNotes = String(payload?.notes || '').trim();
  const now = nowIso();
  const reqId = generateServerId('PRR');
  const endpoint = 'POST /api/invoices/purchase-return-requests';
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  const out = (await isPgMode())
    ? await withTransaction(async (client) => {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.request) return { deduplicated: true, request: dup.request };

        const orig = await fetchFullInvoicePg(client, originalInvoiceId);
        if (!orig) throw new AppError(404, 'فاتورة الشراء الأصلية غير موجودة', 'INVOICE_NOT_FOUND');
        if (orig.type !== 'purchase') {
          throw new AppError(400, 'المستند المحدد ليس فاتورة مشتريات', 'INVALID_ORIGINAL_INVOICE_TYPE');
        }
        if (orig.status !== 'confirmed') {
          throw new AppError(409, 'لا يمكن تقديم طلب مرتجع إلا لفاتورة شراء معتمدة', 'INVALID_INVOICE_STATUS');
        }
        if (isRep && !isRepOwnerOfInvoice(orig, actor, repActor)) {
          throw new AppError(403, 'غير مصرح للمندوب بتقديم طلب مرتجع لفاتورة شراء لا تخصه', 'FORBIDDEN_INVOICE_ACCESS');
        }

        const pendingItemsRes = await client.query(
          `SELECT pri.product_id, pri.quantity
           FROM purchase_return_request_items pri
           JOIN purchase_return_requests pr ON pr.id = pri.request_id
           WHERE pr.original_invoice_id = $1 AND pr.status = 'pending'`,
          [orig.id]
        );
        const pendingByProd = new Map();
        for (const row of pendingItemsRes.rows) {
          pendingByProd.set(row.product_id, round3((pendingByProd.get(row.product_id) || 0) + Number(row.quantity || 0)));
        }

        const returnedMap = orig.returnedQuantityByItem || {};
        const requestedByProd = new Map();
        const normalizedItems = [];
        let grandTotal = 0;

        for (const item of payload.items) {
          const origItem = orig.items.find((it) => it.productId === item.productId);
          if (!origItem) {
            throw new AppError(400, `الصنف ${item.productName || item.productId} غير موجود بفاتورة الشراء الأصلية`, 'ITEM_NOT_IN_INVOICE');
          }
          const qty = round3(item.quantity);
          if (qty <= 0) throw new AppError(400, 'كمية المرتجع المطلوبة يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');

          const alreadyCommitted = round3(Number(returnedMap[item.productId] || 0));
          const pendingQty = round3(Number(pendingByProd.get(item.productId) || 0));
          const batchQty = round3((requestedByProd.get(item.productId) || 0) + qty);
          if (alreadyCommitted + pendingQty + batchQty > origItem.quantity + 0.0001) {
            const avail = round3(Math.max(0, origItem.quantity - alreadyCommitted - pendingQty));
            throw new AppError(
              400,
              `الكمية المطلوبة للصنف (${origItem.productName}) تتجاوز المتاح للإرجاع (${avail}) بعد احتساب المرتجعات والطلبات المعلقة`,
              'EXCEEDS_RETURNABLE'
            );
          }
          requestedByProd.set(item.productId, batchQty);
          const unitPrice = round2(item.unitPrice ?? origItem.unitPrice);
          const lineTotal = round2(qty * unitPrice);
          grandTotal = round2(grandTotal + lineTotal);
          normalizedItems.push({
            productId: item.productId,
            productName: item.productName || origItem.productName,
            unit: item.unit || origItem.unit,
            unitFactor: Number(item.unitFactor || origItem.unitFactor || 1),
            quantity: qty,
            unitPrice,
            total: lineTotal,
          });
        }

        const seqNum = Number((await client.query(`SELECT nextval('seq_purchase_return_req_no') AS n`)).rows[0]?.n || 1);
        const requestNumber = `PRR-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;

        await client.query(
          `INSERT INTO purchase_return_requests (id, request_number, date, original_invoice_id, original_invoice_number, supplier_id, supplier_name, warehouse_id, warehouse_name, representative_id, representative_name, requested_by_user_id, requested_by_name, grand_total, refund_type, cashbox_id, reason, notes, status, idempotency_key, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending',$19,$20,$20)`,
          [
            reqId,
            requestNumber,
            reqDate,
            orig.id,
            orig.invoiceNumber,
            orig.supplierId || 'general',
            orig.supplierName || 'مورد نقدي',
            orig.warehouseId,
            orig.warehouseName,
            repActor?.id || orig.representativeId || null,
            repActor?.name || orig.representativeName || '',
            actor.id,
            actor.fullName,
            grandTotal,
            refundType,
            refundType === 'cash' ? (payload?.cashboxId || null) : null,
            cleanReason,
            cleanNotes,
            scopedIdem || null,
            now,
          ]
        );

        for (let i = 0; i < normalizedItems.length; i++) {
          const it = normalizedItems[i];
          await client.query(
            `INSERT INTO purchase_return_request_items (id, request_id, product_id, product_name, unit, unit_factor, quantity, unit_price, total)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [`${reqId}-ITM-${i + 1}`, reqId, it.productId, it.productName, it.unit, it.unitFactor, it.quantity, it.unitPrice, it.total]
          );
        }

        const created = {
          id: reqId,
          requestNumber,
          date: reqDate,
          originalInvoiceId: orig.id,
          originalInvoiceNumber: orig.invoiceNumber,
          supplierId: orig.supplierId || 'general',
          supplierName: orig.supplierName || 'مورد نقدي',
          warehouseId: orig.warehouseId,
          warehouseName: orig.warehouseName,
          representativeId: repActor?.id || orig.representativeId || undefined,
          representativeName: repActor?.name || orig.representativeName || undefined,
          requestedByUserId: actor.id,
          requestedByName: actor.fullName,
          items: normalizedItems,
          grandTotal,
          refundType,
          cashboxId: refundType === 'cash' ? (payload?.cashboxId || undefined) : undefined,
          reason: cleanReason,
          notes: cleanNotes,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        await savePgIdempotency(client, scopedIdem, actor, endpoint, { request: created });
        return { deduplicated: false, request: created };
      })
    : await withJsonTransaction((db) => {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.request) return { deduplicated: true, request: dup.request };

        const orig = db.invoices.find((i) => i.id === originalInvoiceId);
        if (!orig) throw new AppError(404, 'فاتورة الشراء الأصلية غير موجودة', 'INVOICE_NOT_FOUND');
        if (orig.type !== 'purchase') {
          throw new AppError(400, 'المستند المحدد ليس فاتورة مشتريات', 'INVALID_ORIGINAL_INVOICE_TYPE');
        }
        if (orig.status !== 'confirmed') {
          throw new AppError(409, 'لا يمكن تقديم طلب مرتجع إلا لفاتورة شراء معتمدة', 'INVALID_INVOICE_STATUS');
        }
        if (isRep && !isRepOwnerOfInvoice(orig, actor, repActor)) {
          throw new AppError(403, 'غير مصرح للمندوب بتقديم طلب مرتجع لفاتورة شراء لا تخصه', 'FORBIDDEN_INVOICE_ACCESS');
        }

        if (!Array.isArray(db.purchaseReturnRequests)) db.purchaseReturnRequests = [];
        const pendingByProd = new Map();
        for (const r of db.purchaseReturnRequests) {
          if (r.originalInvoiceId === orig.id && r.status === 'pending') {
            for (const it of r.items || []) {
              pendingByProd.set(it.productId, round3((pendingByProd.get(it.productId) || 0) + Number(it.quantity || 0)));
            }
          }
        }

        const returnedMap = orig.returnedQuantityByItem || {};
        const requestedByProd = new Map();
        const normalizedItems = [];
        let grandTotal = 0;

        for (const item of payload.items) {
          const origItem = orig.items.find((it) => it.productId === item.productId);
          if (!origItem) {
            throw new AppError(400, `الصنف ${item.productName || item.productId} غير موجود بفاتورة الشراء الأصلية`, 'ITEM_NOT_IN_INVOICE');
          }
          const qty = round3(item.quantity);
          if (qty <= 0) throw new AppError(400, 'كمية المرتجع المطلوبة يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');

          const alreadyCommitted = round3(Number(returnedMap[item.productId] || 0));
          const pendingQty = round3(Number(pendingByProd.get(item.productId) || 0));
          const batchQty = round3((requestedByProd.get(item.productId) || 0) + qty);
          if (alreadyCommitted + pendingQty + batchQty > origItem.quantity + 0.0001) {
            const avail = round3(Math.max(0, origItem.quantity - alreadyCommitted - pendingQty));
            throw new AppError(
              400,
              `الكمية المطلوبة للصنف (${origItem.productName}) تتجاوز المتاح للإرجاع (${avail}) بعد احتساب المرتجعات والطلبات المعلقة`,
              'EXCEEDS_RETURNABLE'
            );
          }
          requestedByProd.set(item.productId, batchQty);
          const unitPrice = round2(item.unitPrice ?? origItem.unitPrice);
          const lineTotal = round2(qty * unitPrice);
          grandTotal = round2(grandTotal + lineTotal);
          normalizedItems.push({
            productId: item.productId,
            productName: item.productName || origItem.productName,
            unit: item.unit || origItem.unit,
            unitFactor: Number(item.unitFactor || origItem.unitFactor || 1),
            quantity: qty,
            unitPrice,
            total: lineTotal,
          });
        }

        const seqNum = nextJsonSequence(db, 'purchaseReturnReqNo', db.purchaseReturnRequests, 'requestNumber', /(\d+)$/);
        const requestNumber = `PRR-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;
        const created = {
          id: reqId,
          requestNumber,
          date: reqDate,
          originalInvoiceId: orig.id,
          originalInvoiceNumber: orig.invoiceNumber,
          supplierId: orig.supplierId || 'general',
          supplierName: orig.supplierName || 'مورد نقدي',
          warehouseId: orig.warehouseId,
          warehouseName: orig.warehouseName,
          representativeId: repActor?.id || orig.representativeId || undefined,
          representativeName: repActor?.name || orig.representativeName || undefined,
          requestedByUserId: actor.id,
          requestedByName: actor.fullName,
          items: normalizedItems,
          grandTotal,
          refundType,
          cashboxId: refundType === 'cash' ? (payload?.cashboxId || undefined) : undefined,
          reason: cleanReason,
          notes: cleanNotes,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        db.purchaseReturnRequests.unshift(created);
        saveJsonIdempotency(scopedIdem, { request: created });
        return { deduplicated: false, request: created };
      });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تقديم طلب مرتجع مشتريات (${out.request.requestNumber}) للفاتورة ${out.request.originalInvoiceNumber}`,
      module: 'المشتريات',
      recordId: out.request.id,
      notes: cleanReason,
    });
  }
  return out.request;
}

export async function approvePurchaseReturnRequest(requestId, payload = {}, actor, idempotencyKey = '') {
  if (!actor || actor.role === 'representative' || actor.role === 'customer') {
    throw new AppError(403, 'اعتماد طلبات مرتجع المشتريات مخصص للإدارة ومسؤولي المشتريات فقط', 'FORBIDDEN_APPROVE_RETURN_REQUEST');
  }
  if (actor.role !== 'admin' && !actor.permissions?.canManagePurchases && !actor.permissions?.canApprove) {
    throw new AppError(403, 'ليس لديك صلاحية اعتماد طلبات مرتجع المشتريات', 'FORBIDDEN_PERMISSION');
  }
  const now = nowIso();
  const retDate = payload?.date || todayIso();
  const approveNotes = String(payload?.notes || '').trim();
  const endpoint = `POST /api/invoices/purchase-return-requests/${requestId}/approve`;
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  const out = (await isPgMode())
    ? await withTransaction(async (client) => {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.request) return { deduplicated: true, ...dup };

        const reqRow = (await client.query(`SELECT * FROM purchase_return_requests WHERE id = $1 FOR UPDATE`, [requestId])).rows[0];
        if (!reqRow) throw new AppError(404, 'طلب مرتجع المشتريات غير موجود', 'RETURN_REQUEST_NOT_FOUND');
        if (reqRow.status !== 'pending') {
          throw new AppError(409, `تمت معالجة هذا الطلب مسبقًا (${reqRow.status})`, 'REQUEST_ALREADY_PROCESSED');
        }
        const reqItemRows = (
          await client.query(`SELECT * FROM purchase_return_request_items WHERE request_id = $1`, [requestId])
        ).rows;
        const reqObj = mapPgPurchaseReturnRequestRow(reqRow, reqItemRows);

        const orig = await fetchFullInvoicePg(client, reqObj.originalInvoiceId);
        if (!orig) throw new AppError(404, 'فاتورة الشراء الأصلية غير موجودة', 'INVOICE_NOT_FOUND');
        if (orig.type !== 'purchase' || orig.status !== 'confirmed') {
          throw new AppError(409, 'فاتورة الشراء الأصلية غير صالحة لترحيل المرتجع', 'INVALID_INVOICE_STATUS');
        }

        const returnedMap = { ...(orig.returnedQuantityByItem || {}) };
        let grandTotal = 0;
        const normalizedItems = [];
        for (const it of reqObj.items) {
          const origItem = orig.items.find((o) => o.productId === it.productId);
          if (!origItem) throw new AppError(400, `الصنف ${it.productName} غير موجود بالفاتورة الأصلية`, 'ITEM_NOT_IN_INVOICE');
          const prevRet = Number(returnedMap[it.productId] || 0);
          if (prevRet + it.quantity > origItem.quantity + 0.0001) {
            throw new AppError(
              409,
              `الكمية المطلوبة للصنف (${origItem.productName}) تتجاوز المتاح للإرجاع (${round3(origItem.quantity - prevRet)})`,
              'EXCEEDS_RETURNABLE'
            );
          }
          returnedMap[it.productId] = round3(prevRet + it.quantity);
          const lineTotal = round2(it.quantity * it.unitPrice);
          grandTotal = round2(grandTotal + lineTotal);
          normalizedItems.push({ ...it, total: lineTotal });
        }

        const stRes = await client.query(`SELECT allow_negative_stock FROM system_settings LIMIT 1`);
        const allowNeg = Boolean(stRes.rows[0]?.allow_negative_stock) && Boolean(actor?.permissions?.canAllowNegativeInventory);
        const refundType = (payload?.refundType || reqObj.refundType) === 'cash' ? 'cash' : 'balance';
        let cashboxId = refundType === 'cash' ? (payload?.cashboxId || reqObj.cashboxId || orig.cashboxId || null) : null;
        if (refundType === 'cash' && !cashboxId) {
          const defCb = (await client.query(`SELECT id FROM cashboxes ORDER BY is_default DESC LIMIT 1`)).rows[0];
          cashboxId = defCb?.id || null;
        }

        const retId = generateServerId('RET');
        const seqNum = Number((await client.query(`SELECT nextval('seq_purchase_return_no') AS n`)).rows[0]?.n || 1);
        const returnNumber = `RET-PUR-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;
        const whId = reqObj.warehouseId || orig.warehouseId;
        const whRow = (await client.query(`SELECT id, name FROM warehouses WHERE id = $1 LIMIT 1`, [whId])).rows[0];
        const whName = whRow?.name || orig.warehouseName;

        await client.query(
          `INSERT INTO invoice_returns (id, return_number, type, original_invoice_id, original_invoice_number, date, party_id, party_name, warehouse_id, warehouse_name, grand_total, refund_type, cashbox_id, reason, notes, created_by, created_by_user_id, created_at)
           VALUES ($1,$2,'purchase_return',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            retId,
            returnNumber,
            orig.id,
            orig.invoiceNumber,
            retDate,
            orig.supplierId || reqObj.supplierId || 'general',
            orig.supplierName || reqObj.supplierName || '',
            whId,
            whName,
            grandTotal,
            refundType,
            cashboxId,
            reqObj.reason,
            approveNotes ? `${reqObj.notes ? reqObj.notes + ' | ' : ''}اعتماد: ${approveNotes}` : (reqObj.notes || `معتمد من طلب ${reqObj.requestNumber}`),
            actor.fullName,
            actor.id || null,
            now,
          ]
        );

        for (let i = 0; i < normalizedItems.length; i++) {
          const it = normalizedItems[i];
          await client.query(
            `INSERT INTO invoice_return_items (id, return_id, product_id, product_name, unit, unit_factor, quantity, unit_price, total)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [`${retId}-RITM-${i + 1}`, retId, it.productId, it.productName, it.unit, it.unitFactor, it.quantity, it.unitPrice, it.total]
          );

          const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [it.productId]);
          if (pRes.rows[0]) {
            const stockMap = { ...(pRes.rows[0].stock_per_warehouse || {}) };
            const curQty = Number(stockMap[whId] || 0);
            const baseQty = round3(it.quantity * it.unitFactor);
            const nextQty = round3(curQty - baseQty);
            if (nextQty < 0 && !allowNeg) {
              throw new AppError(
                409,
                `لا يمكن خصم مرتجع المشتريات من (${pRes.rows[0].name}): الرصيد المتاح (${curQty}) أقل من المطلوب (${baseQty})`,
                'INSUFFICIENT_STOCK'
              );
            }
            stockMap[whId] = nextQty;
            await client.query(`UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3`, [JSON.stringify(stockMap), now, it.productId]);

            const mvId = generateServerId('SM');
            await client.query(
              `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_before, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_by_user_id, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'purchase_return',$8,$9,$10,$11,$12,$13,'purchase_return',$14,$15,$16,$17,$18,$19)`,
              [
                mvId,
                mvId,
                retDate,
                it.productId,
                it.productName,
                whId,
                whName,
                baseQty,
                it.unit,
                it.unitFactor,
                it.unitPrice,
                curQty,
                nextQty,
                retId,
                returnNumber,
                `اعتماد طلب مرتجع مشتريات ${reqObj.requestNumber} (${returnNumber}) - السبب: ${reqObj.reason}`,
                actor.fullName,
                actor.id || null,
                now,
              ]
            );
          }
        }

        if (refundType === 'balance') {
          if (orig.supplierId) {
            const sRes = await client.query(`SELECT current_balance FROM suppliers WHERE id = $1 FOR UPDATE`, [orig.supplierId]);
            if (sRes.rows[0]) {
              await client.query(`UPDATE suppliers SET current_balance = $1 WHERE id = $2`, [
                round2(Number(sRes.rows[0].current_balance || 0) - grandTotal),
                orig.supplierId,
              ]);
            }
          }
        } else if (refundType === 'cash' && cashboxId) {
          const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [cashboxId]);
          if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
          const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) + grandTotal);
          await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCb, cashboxId]);
          const txId = generateServerId('FT');
          await client.query(
            `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, created_by, created_by_user_id, created_at)
             VALUES ($1,$2,$3,'income',$4,$5,$6,$7,'استرداد قيمة مرتجع مشتريات نقدي',$8,$9,'purchase_return',$10,$11,$12,$13,$14,$15)`,
            [
              txId,
              `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
              retDate,
              grandTotal,
              cbRes.rows[0].id,
              cbRes.rows[0].name,
              nextCb,
              orig.supplierId || null,
              orig.supplierName || '',
              retId,
              returnNumber,
              `تسوية نقدية لاعتماد طلب مرتجع مشتريات ${reqObj.requestNumber} (${returnNumber})`,
              actor.fullName,
              actor.id || null,
              now,
            ]
          );
        }

        await client.query(`UPDATE invoices SET returned_quantity_by_item = $1, updated_at = $2 WHERE id = $3`, [
          JSON.stringify(returnedMap),
          now,
          orig.id,
        ]);

        await client.query(
          `UPDATE purchase_return_requests SET
            status = 'approved',
            refund_type = $1,
            cashbox_id = $2,
            reviewed_by_user_id = $3,
            reviewed_by_name = $4,
            reviewed_at = $5,
            approved_return_id = $6,
            approved_return_number = $7,
            notes = CASE WHEN $8 <> '' THEN $8 ELSE notes END,
            updated_at = $5
           WHERE id = $9`,
          [refundType, cashboxId, actor.id, actor.fullName, now, retId, returnNumber, approveNotes, requestId]
        );

        const updatedReqRow = (await client.query(`SELECT * FROM purchase_return_requests WHERE id = $1`, [requestId])).rows[0];
        const updatedReq = mapPgPurchaseReturnRequestRow(updatedReqRow, reqItemRows);
        const createdReturn = {
          id: retId,
          returnNumber,
          type: 'purchase_return',
          originalInvoiceId: orig.id,
          originalInvoiceNumber: orig.invoiceNumber,
          date: retDate,
          partyId: orig.supplierId || reqObj.supplierId || 'general',
          partyName: orig.supplierName || reqObj.supplierName || '',
          warehouseId: whId,
          warehouseName: whName,
          items: normalizedItems,
          grandTotal,
          refundType,
          cashboxId: cashboxId || undefined,
          reason: reqObj.reason,
          notes: approveNotes || reqObj.notes || '',
          createdBy: actor.fullName,
          createdByUserId: actor.id,
          createdAt: now,
        };
        const resultPayload = { request: updatedReq, invoiceReturn: createdReturn };
        await savePgIdempotency(client, scopedIdem, actor, endpoint, resultPayload);
        return { deduplicated: false, ...resultPayload };
      })
    : await withJsonTransaction((db) => {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.request) return { deduplicated: true, ...dup };

        if (!Array.isArray(db.purchaseReturnRequests)) db.purchaseReturnRequests = [];
        const reqObj = db.purchaseReturnRequests.find((r) => r.id === requestId);
        if (!reqObj) throw new AppError(404, 'طلب مرتجع المشتريات غير موجود', 'RETURN_REQUEST_NOT_FOUND');
        if (reqObj.status !== 'pending') {
          throw new AppError(409, `تمت معالجة هذا الطلب مسبقًا (${reqObj.status})`, 'REQUEST_ALREADY_PROCESSED');
        }

        const orig = db.invoices.find((i) => i.id === reqObj.originalInvoiceId);
        if (!orig) throw new AppError(404, 'فاتورة الشراء الأصلية غير موجودة', 'INVOICE_NOT_FOUND');
        if (orig.type !== 'purchase' || orig.status !== 'confirmed') {
          throw new AppError(409, 'فاتورة الشراء الأصلية غير صالحة لترحيل المرتجع', 'INVALID_INVOICE_STATUS');
        }

        const returnedMap = { ...(orig.returnedQuantityByItem || {}) };
        let grandTotal = 0;
        const normalizedItems = [];
        for (const it of reqObj.items) {
          const origItem = orig.items.find((o) => o.productId === it.productId);
          if (!origItem) throw new AppError(400, `الصنف ${it.productName} غير موجود بالفاتورة الأصلية`, 'ITEM_NOT_IN_INVOICE');
          const prevRet = Number(returnedMap[it.productId] || 0);
          if (prevRet + it.quantity > origItem.quantity + 0.0001) {
            throw new AppError(
              409,
              `الكمية المطلوبة للصنف (${origItem.productName}) تتجاوز المتاح للإرجاع (${round3(origItem.quantity - prevRet)})`,
              'EXCEEDS_RETURNABLE'
            );
          }
          returnedMap[it.productId] = round3(prevRet + it.quantity);
          const lineTotal = round2(it.quantity * it.unitPrice);
          grandTotal = round2(grandTotal + lineTotal);
          normalizedItems.push({ ...it, total: lineTotal });
        }

        const allowNeg = Boolean(db.settings?.allowNegativeStock) && Boolean(actor?.permissions?.canAllowNegativeInventory);
        const refundType = (payload?.refundType || reqObj.refundType) === 'cash' ? 'cash' : 'balance';
        const cb =
          refundType === 'cash'
            ? (payload?.cashboxId || reqObj.cashboxId || orig.cashboxId
                ? db.cashboxes.find((c) => c.id === (payload?.cashboxId || reqObj.cashboxId || orig.cashboxId))
                : null) || db.cashboxes.find((c) => c.isDefault) || db.cashboxes[0]
            : null;
        if (refundType === 'cash' && !cb) {
          throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
        }

        const whId = reqObj.warehouseId || orig.warehouseId;
        const whName = db.warehouses.find((w) => w.id === whId)?.name || orig.warehouseName;
        const retId = generateServerId('RET');
        const seqNum = nextJsonSequence(db, 'purchaseReturnNo', db.invoiceReturns.filter((r) => r.type === 'purchase_return'), 'returnNumber', /(\d+)$/);
        const returnNumber = `RET-PUR-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;

        for (const it of normalizedItems) {
          const prod = db.products.find((p) => p.id === it.productId);
          if (prod) {
            const curQty = Number(prod.stockPerWarehouse?.[whId] || 0);
            const baseQty = round3(it.quantity * it.unitFactor);
            const nextQty = round3(curQty - baseQty);
            if (nextQty < 0 && !allowNeg) {
              throw new AppError(
                409,
                `لا يمكن خصم مرتجع المشتريات من (${prod.name}): الرصيد المتاح (${curQty}) أقل من المطلوب (${baseQty})`,
                'INSUFFICIENT_STOCK'
              );
            }
            prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [whId]: nextQty };
            const mvId = generateServerId('SM');
            db.stockMovements.unshift({
              id: mvId,
              movementNumber: mvId,
              date: retDate,
              type: 'purchase_return',
              productId: prod.id,
              productName: prod.name,
              warehouseId: whId,
              warehouseName: whName,
              quantity: baseQty,
              unit: it.unit || prod.baseUnit,
              unitFactor: Number(it.unitFactor || 1),
              unitCost: it.unitPrice,
              balanceBefore: curQty,
              balanceAfter: nextQty,
              relatedDocType: 'purchase_return',
              referenceId: retId,
              referenceNumber: returnNumber,
              notes: `اعتماد طلب مرتجع مشتريات ${reqObj.requestNumber} (${returnNumber}) - السبب: ${reqObj.reason}`,
              createdBy: actor.fullName,
              createdByUserId: actor.id,
              createdAt: now,
            });
          }
        }

        if (refundType === 'balance') {
          if (orig.supplierId) {
            const supp = db.suppliers.find((s) => s.id === orig.supplierId);
            if (supp) supp.currentBalance = round2(Number(supp.currentBalance || 0) - grandTotal);
          }
        } else if (refundType === 'cash' && cb) {
          cb.currentBalance = round2(Number(cb.currentBalance || 0) + grandTotal);
          db.financialTransactions.unshift({
            id: generateServerId('FT'),
            transactionNumber: `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
            date: retDate,
            type: 'income',
            cashboxId: cb.id,
            cashboxName: cb.name,
            amount: grandTotal,
            category: 'استرداد قيمة مرتجع مشتريات نقدي',
            relatedDocType: 'purchase_return',
            relatedDocId: retId,
            relatedDocNumber: returnNumber,
            partyId: orig.supplierId,
            partyName: orig.supplierName,
            description: `تسوية نقدية لاعتماد طلب مرتجع مشتريات ${reqObj.requestNumber} (${returnNumber})`,
            createdBy: actor.fullName,
            createdByUserId: actor.id,
            createdAt: now,
          });
        }

        orig.returnedQuantityByItem = returnedMap;
        const createdReturn = {
          id: retId,
          returnNumber,
          type: 'purchase_return',
          originalInvoiceId: orig.id,
          originalInvoiceNumber: orig.invoiceNumber,
          date: retDate,
          partyId: orig.supplierId || reqObj.supplierId || 'general',
          partyName: orig.supplierName || reqObj.supplierName || '',
          warehouseId: whId,
          warehouseName: whName,
          items: normalizedItems,
          grandTotal,
          refundType,
          cashboxId: cb?.id || undefined,
          reason: reqObj.reason,
          notes: approveNotes || reqObj.notes || '',
          createdBy: actor.fullName,
          createdByUserId: actor.id,
          createdAt: now,
        };
        db.invoiceReturns.unshift(createdReturn);

        reqObj.status = 'approved';
        reqObj.refundType = refundType;
        reqObj.cashboxId = cb?.id || undefined;
        reqObj.reviewedByUserId = actor.id;
        reqObj.reviewedByName = actor.fullName;
        reqObj.reviewedAt = now;
        reqObj.approvedReturnId = retId;
        reqObj.approvedReturnNumber = returnNumber;
        if (approveNotes) reqObj.notes = approveNotes;
        reqObj.updatedAt = now;

        const resultPayload = { request: reqObj, invoiceReturn: createdReturn };
        saveJsonIdempotency(scopedIdem, resultPayload);
        return { deduplicated: false, ...resultPayload };
      });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `اعتماد طلب مرتجع مشتريات (${out.request.requestNumber}) وإنشاء المرتجع (${out.invoiceReturn.returnNumber})`,
      module: 'المشتريات',
      recordId: out.request.id,
      notes: approveNotes || out.request.reason,
    });
  }
  return out;
}

export async function rejectPurchaseReturnRequest(requestId, payload = {}, actor) {
  if (!actor || actor.role === 'representative' || actor.role === 'customer') {
    throw new AppError(403, 'رفض طلبات مرتجع المشتريات مخصص للإدارة ومسؤولي المشتريات فقط', 'FORBIDDEN_REJECT_RETURN_REQUEST');
  }
  if (actor.role !== 'admin' && !actor.permissions?.canManagePurchases && !actor.permissions?.canApprove) {
    throw new AppError(403, 'ليس لديك صلاحية رفض طلبات مرتجع المشتريات', 'FORBIDDEN_PERMISSION');
  }
  const cleanReason = String(payload?.reason || payload?.rejectionReason || '').trim();
  if (!cleanReason) {
    throw new AppError(400, 'يرجى كتابة سبب رفض طلب مرتجع المشتريات', 'REJECTION_REASON_REQUIRED');
  }
  const now = nowIso();

  const updated = (await isPgMode())
    ? await withTransaction(async (client) => {
        const reqRow = (await client.query(`SELECT * FROM purchase_return_requests WHERE id = $1 FOR UPDATE`, [requestId])).rows[0];
        if (!reqRow) throw new AppError(404, 'طلب مرتجع المشتريات غير موجود', 'RETURN_REQUEST_NOT_FOUND');
        if (reqRow.status !== 'pending') {
          throw new AppError(409, `تمت معالجة هذا الطلب مسبقًا (${reqRow.status})`, 'REQUEST_ALREADY_PROCESSED');
        }
        await client.query(
          `UPDATE purchase_return_requests SET
            status = 'rejected',
            rejection_reason = $1,
            reviewed_by_user_id = $2,
            reviewed_by_name = $3,
            reviewed_at = $4,
            updated_at = $4
           WHERE id = $5`,
          [cleanReason, actor.id, actor.fullName, now, requestId]
        );
        const updatedRow = (await client.query(`SELECT * FROM purchase_return_requests WHERE id = $1`, [requestId])).rows[0];
        const itemsRows = (await client.query(`SELECT * FROM purchase_return_request_items WHERE request_id = $1`, [requestId])).rows;
        return mapPgPurchaseReturnRequestRow(updatedRow, itemsRows);
      })
    : await withJsonTransaction((db) => {
        const reqObj = (db.purchaseReturnRequests || []).find((r) => r.id === requestId);
        if (!reqObj) throw new AppError(404, 'طلب مرتجع المشتريات غير موجود', 'RETURN_REQUEST_NOT_FOUND');
        if (reqObj.status !== 'pending') {
          throw new AppError(409, `تمت معالجة هذا الطلب مسبقًا (${reqObj.status})`, 'REQUEST_ALREADY_PROCESSED');
        }
        reqObj.status = 'rejected';
        reqObj.rejectionReason = cleanReason;
        reqObj.reviewedByUserId = actor.id;
        reqObj.reviewedByName = actor.fullName;
        reqObj.reviewedAt = now;
        reqObj.updatedAt = now;
        return reqObj;
      });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `رفض طلب مرتجع مشتريات (${updated.requestNumber}) — السبب: ${cleanReason}`,
    module: 'المشتريات',
    recordId: updated.id,
    notes: cleanReason,
  });
  return { request: updated };
}

export async function listInvoices(actor = null, filters = {}) {
  let allInvoices = [];
  if (await isPgMode()) {
    const pool = getPool();
    const invRes = await pool.query(`SELECT * FROM invoices ORDER BY created_at DESC`);
    const itemRes = await pool.query(`SELECT * FROM invoice_items`);
    const payRes = await pool.query(`SELECT * FROM invoice_payments ORDER BY created_at ASC`);
    const itemsMap = new Map();
    for (const it of itemRes.rows) {
      const list = itemsMap.get(it.invoice_id) || [];
      list.push(it);
      itemsMap.set(it.invoice_id, list);
    }
    const paysMap = new Map();
    for (const p of payRes.rows) {
      const list = paysMap.get(p.invoice_id) || [];
      list.push(p);
      paysMap.set(p.invoice_id, list);
    }
    allInvoices = invRes.rows.map((r) => mapPgInvoiceRow(r, itemsMap.get(r.id) || [], paysMap.get(r.id) || []));
  } else {
    allInvoices = readJsonDatabase().invoices;
  }

  if (actor?.role === 'customer') {
    if (!filters.customerId) return [];
    return allInvoices.filter(
      (inv) => inv.customerId === filters.customerId && inv.type === 'sales' && inv.status !== 'draft'
    );
  }

  if (actor?.role === 'representative') {
    const rep = await getRepresentativeByUserId(actor.id);
    const canPurchase = Boolean(actor.permissions?.canCreatePurchase || actor.permissions?.canManagePurchases);
    const visible = allInvoices.filter((inv) => {
      if (inv.type === 'sales' || inv.type === 'quote') {
        return isRepOwnerOfInvoice(inv, actor, rep);
      }
      if (inv.type === 'purchase') {
        if (!canPurchase) return false;
        return isRepOwnerOfInvoice(inv, actor, rep);
      }
      return false;
    });
    return visible.map(sanitizeInvoiceForRepresentative);
  }

  return allInvoices;
}

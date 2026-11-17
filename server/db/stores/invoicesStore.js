import { getPool, withTransaction } from '../postgres.js';
import { withJsonTransaction, nextJsonSequence, readJsonDatabase } from '../jsonLedger.js';
import { generateServerId } from '../../utils/crypto.js';
import { AppError, nowIso, todayIso, round2, round3 } from '../../utils/errors.js';
import { isPgMode, mapPgInvoiceRow, mapPgCustomerRow } from './mode.js';
import { recordAuditLog } from './authStore.js';
import {
  getRepresentativeByUserId,
  getCustomerById,
  isCustomerAllowedForRep,
  listCustomers,
  getSystemSettingsSafe,
} from './catalogStore.js';

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
  const rawPaid = round2(payload.paidAmount ?? (payload.paymentType === 'cash' ? grandTotal : 0));
  const paidAmount = Math.min(grandTotal, Math.max(0, rawPaid));
  const remainingAmount = round2(Math.max(0, grandTotal - paidAmount));
  const paymentType = remainingAmount <= 0 ? 'cash' : paidAmount > 0 ? 'partial' : 'credit';

  return {
    items: normalizedItems,
    subtotal,
    discountTotal,
    taxTotal,
    grandTotal,
    paidAmount,
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
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'sale', $8, $9, $10, $11, $12, 'sales', $13, $14, $15, $16, $17)`,
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
          nextQty,
          invoice.id,
          invoice.invoiceNumber,
          `فاتورة مبيعات رقم ${invoice.invoiceNumber}`,
          actor.fullName,
          now,
        ]
      );
    }

    if (invoice.customerId) {
      const cRes = await client.query(`SELECT * FROM customers WHERE id = $1 FOR UPDATE`, [invoice.customerId]);
      if (cRes.rows[0]) {
        const cust = cRes.rows[0];
        const nextBalance = round2(Number(cust.current_balance || 0) + Number(invoice.remainingAmount || 0));
        const priceHistory = { ...(cust.price_history || {}) };
        for (const item of invoice.items) {
          const hist = Array.isArray(priceHistory[item.productId]) ? [...priceHistory[item.productId]] : [];
          hist.push(Number(item.unitPrice || 0));
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

    if (invoice.paidAmount > 0) {
      const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [invoice.cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) + Number(invoice.paidAmount || 0));
      await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCb, invoice.cashboxId]);

      const txId = generateServerId('FT');
      const txNo = `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, created_by, created_at)
         VALUES ($1, $2, $3, 'customer_payment', $4, $5, $6, $7, 'مبيعات نقدية', $8, $9, 'sales', $10, $11, $12, $13, $14)`,
        [
          txId,
          txNo,
          invoice.date,
          invoice.paidAmount,
          cbRes.rows[0].id,
          cbRes.rows[0].name,
          nextCb,
          invoice.customerId || null,
          invoice.customerName || '',
          invoice.id,
          invoice.invoiceNumber,
          `تحصيل دفعة مبيعات فاتورة رقم ${invoice.invoiceNumber}`,
          actor.fullName,
          now,
        ]
      );
    }

    if (invoice.representativeId && invoice.paidAmount > 0) {
      const repRes = await client.query(`SELECT * FROM representatives WHERE id = $1 FOR UPDATE`, [invoice.representativeId]);
      if (repRes.rows[0]) {
        const nextRep = round2(Number(repRes.rows[0].current_balance || 0) + Number(invoice.paidAmount || 0));
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
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'purchase', $8, $9, $10, $11, $12, 'purchase', $13, $14, $15, $16, $17)`,
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
          nextQty,
          invoice.id,
          invoice.invoiceNumber,
          `فاتورة مشتريات رقم ${invoice.invoiceNumber}`,
          actor.fullName,
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
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, created_by, created_at)
         VALUES ($1, $2, $3, 'supplier_payment', $4, $5, $6, $7, 'مشتريات نقدية', $8, $9, 'purchase', $10, $11, $12, $13, $14)`,
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

      db.stockMovements.unshift({
        id: generateServerId('SM'),
        date: invoice.date,
        type: 'sale',
        productId: prod.id,
        productName: prod.name,
        warehouseId: invoice.warehouseId,
        warehouseName: wh.name,
        quantity: baseQty,
        unitCost: item.purchasePriceAtTime || prod.purchasePrice || 0,
        referenceId: invoice.id,
        referenceNumber: invoice.invoiceNumber,
        notes: `فاتورة مبيعات رقم ${invoice.invoiceNumber}`,
        createdBy: actor.fullName,
        createdAt: now,
      });
    }

    if (invoice.customerId) {
      const cust = db.customers.find((c) => c.id === invoice.customerId);
      if (cust) {
        cust.currentBalance = round2(Number(cust.currentBalance || 0) + Number(invoice.remainingAmount || 0));
        const priceHistory = { ...(cust.priceHistory || {}) };
        for (const item of invoice.items) {
          const prev = Array.isArray(priceHistory[item.productId]) ? [...priceHistory[item.productId]] : [];
          prev.push(Number(item.unitPrice || 0));
          if (prev.length > 3) prev.shift();
          priceHistory[item.productId] = prev;
        }
        cust.priceHistory = priceHistory;
      }
    }

    if (invoice.paidAmount > 0) {
      const cb = db.cashboxes.find((c) => c.id === invoice.cashboxId);
      if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      cb.currentBalance = round2(Number(cb.currentBalance || 0) + Number(invoice.paidAmount || 0));
      db.financialTransactions.unshift({
        id: generateServerId('FT'),
        transactionNumber: `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`,
        date: invoice.date,
        type: 'customer_payment',
        cashboxId: cb.id,
        cashboxName: cb.name,
        amount: invoice.paidAmount,
        category: 'مبيعات نقدية',
        relatedDocType: 'sales',
        relatedDocId: invoice.id,
        relatedDocNumber: invoice.invoiceNumber,
        partyId: invoice.customerId,
        partyName: invoice.customerName,
        description: `تحصيل دفعة مبيعات فاتورة رقم ${invoice.invoiceNumber}`,
        createdBy: actor.fullName,
        createdAt: now,
      });
    }

    if (invoice.representativeId && invoice.paidAmount > 0) {
      const rep = db.representatives.find((r) => r.id === invoice.representativeId);
      if (rep) rep.currentBalance = round2(Number(rep.currentBalance || 0) + Number(invoice.paidAmount || 0));
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
      prod.stockPerWarehouse = { ...(prod.stockPerWarehouse || {}), [invoice.warehouseId]: round3(curQty + baseQty) };
      const baseItemCost = round2(item.unitPrice / Math.max(0.001, item.unitFactor || 1)) || prod.purchasePrice;
      prod.purchasePrice = baseItemCost;

      db.stockMovements.unshift({
        id: generateServerId('SM'),
        date: invoice.date,
        type: 'purchase',
        productId: prod.id,
        productName: prod.name,
        warehouseId: invoice.warehouseId,
        warehouseName: wh.name,
        quantity: baseQty,
        unitCost: baseItemCost,
        referenceId: invoice.id,
        referenceNumber: invoice.invoiceNumber,
        notes: `فاتورة مشتريات رقم ${invoice.invoiceNumber}`,
        createdBy: actor.fullName,
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
        createdAt: now,
      });
    }
  }
}

export async function createInvoiceInsidePgTx(client, type, payload, actor) {
  const now = nowIso();
  const status = payload.status === 'draft' ? 'draft' : 'confirmed';
  const totals = recomputeInvoiceTotals(payload);
  const seqName = type === 'sales' ? 'seq_sales_invoice_no' : 'seq_purchase_invoice_no';
  const seqRes = await client.query(`SELECT nextval('${seqName}') AS n`);
  const num = Number(seqRes.rows[0]?.n || 1);
  const year = new Date().getFullYear();
  const invoiceNumber = `${type === 'sales' ? 'INV' : 'PUR'}-${year}-${String(num).padStart(4, '0')}`;
  const invoiceId = generateServerId(type === 'sales' ? 'INV' : 'PUR');

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

  await client.query(
    `INSERT INTO invoices (id, invoice_number, type, date, customer_id, customer_name, supplier_id, supplier_name, representative_id, representative_name, warehouse_id, warehouse_name, subtotal, discount_total, tax_total, grand_total, paid_amount, remaining_amount, payment_type, payment_method, cashbox_id, status, notes, linked_rep_transfer_id, linked_rep_transfer_number, linked_customer_order_id, returned_quantity_by_item, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'{}'::jsonb,$27,$28)`,
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
      totals.remainingAmount,
      totals.paymentType,
      payload.paymentMethod || 'cash',
      cashboxId,
      status,
      payload.notes || '',
      payload.linkedRepTransferId || null,
      payload.linkedRepTransferNumber || null,
      payload.linkedCustomerOrderId || null,
      actor.fullName,
      now,
    ]
  );

  for (let i = 0; i < totals.items.length; i++) {
    const it = totals.items[i];
    const pRow = (await client.query(`SELECT name, barcode, purchase_price FROM products WHERE id = $1 LIMIT 1`, [it.productId])).rows[0];
    if (!pRow) throw new AppError(404, `الصنف غير موجود (${it.productName || it.productId})`, 'PRODUCT_NOT_FOUND');
    it.productName = it.productName || pRow.name;
    it.barcode = it.barcode || pRow.barcode || '';
    it.purchasePriceAtTime = it.purchasePriceAtTime || Number(pRow.purchase_price || 0);

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
    warehouseId: whRow.id,
    warehouseName: whRow.name,
    items: totals.items,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
    paidAmount: totals.paidAmount,
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
    createdBy: actor.fullName,
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
  const totals = recomputeInvoiceTotals(payload);
  const seqKey = type === 'sales' ? 'salesInvoiceNo' : 'purchaseInvoiceNo';
  const prefix = type === 'sales' ? 'INV' : 'PUR';
  const num = nextJsonSequence(db, seqKey, db.invoices.filter((i) => i.type === type), 'invoiceNumber', /(\d+)$/);
  const year = new Date().getFullYear();
  const invoiceNumber = `${prefix}-${year}-${String(num).padStart(4, '0')}`;
  const invoiceId = generateServerId(prefix);

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
    return {
      ...it,
      productName: it.productName || prod.name,
      barcode: it.barcode || prod.barcode || '',
      purchasePriceAtTime: it.purchasePriceAtTime || prod.purchasePrice || 0,
    };
  });

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
    warehouseId: wh.id,
    warehouseName: wh.name,
    items: enrichedItems,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
    paidAmount: totals.paidAmount,
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
    createdBy: actor.fullName,
    createdAt: now,
  };

  if (status === 'confirmed') {
    applyConfirmedEffectsJsonTx(db, newInvoice, actor);
  }

  db.invoices.unshift(newInvoice);
  return newInvoice;
}

export async function createSalesInvoice(payload, actor) {
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
    if (!isCustomerAllowedForRep(customer, rep.id)) {
      throw new AppError(403, 'غير مصرح لك بإصدار فاتورة لهذا العميل لأنه غير معين ضمن قائمتك', 'CUSTOMER_NOT_ASSIGNED_TO_REP');
    }
    enrichedPayload.representativeId = rep.id;
    enrichedPayload.representativeName = rep.name;
    if (!enrichedPayload.warehouseId && rep.warehouseId) {
      enrichedPayload.warehouseId = rep.warehouseId;
    }
  }

  const invoice = (await isPgMode())
    ? await withTransaction((client) => createInvoiceInsidePgTx(client, 'sales', enrichedPayload, actor))
    : await withJsonTransaction((db) => createInvoiceInsideJsonTx(db, 'sales', enrichedPayload, actor));

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: invoice.status === 'draft' ? `إنشاء مسودة فاتورة مبيعات (${invoice.invoiceNumber})` : `إصدار فاتورة مبيعات (${invoice.invoiceNumber})`,
    module: 'المبيعات',
    recordId: invoice.id,
  });
  return invoice;
}

export async function createPurchaseInvoice(payload, actor) {
  const invoice = (await isPgMode())
    ? await withTransaction((client) => createInvoiceInsidePgTx(client, 'purchase', payload, actor))
    : await withJsonTransaction((db) => createInvoiceInsideJsonTx(db, 'purchase', payload, actor));

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: invoice.status === 'draft' ? `إنشاء مسودة فاتورة مشتريات (${invoice.invoiceNumber})` : `إصدار فاتورة مشتريات (${invoice.invoiceNumber})`,
    module: 'المشتريات',
    recordId: invoice.id,
  });
  return invoice;
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

      if (repActor) {
        if (inv.representativeId && inv.representativeId !== repActor.id) {
          throw new AppError(403, 'غير مصرح لك باعتماد فاتورة مندوب آخر', 'FORBIDDEN_INVOICE_ACCESS');
        }
        if (inv.customerId) {
          const cRes = await client.query('SELECT * FROM customers WHERE id = $1 LIMIT 1', [inv.customerId]);
          const cust = mapPgCustomerRow(cRes.rows[0]);
          if (cust && !isCustomerAllowedForRep(cust, repActor.id)) {
            throw new AppError(403, 'غير مصرح لك باعتماد فاتورة لعميل غير معين في قائمتك', 'CUSTOMER_NOT_ASSIGNED_TO_REP');
          }
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
      await client.query(`UPDATE invoices SET status = 'confirmed', updated_at = $1 WHERE id = $2`, [now, invoiceId]);
      return fetchFullInvoicePg(client, invoiceId);
    });
  } else {
    confirmedInvoice = await withJsonTransaction(async (db) => {
      const inv = db.invoices.find((i) => i.id === invoiceId);
      if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
      if (inv.status === 'confirmed') throw new AppError(409, 'تم اعتماد هذه الفاتورة مسبقًا (ممنوع تكرار خصم المخزون)', 'ALREADY_CONFIRMED');
      if (inv.status !== 'draft') throw new AppError(409, 'لا يمكن اعتماد فاتورة ملغاة', 'INVALID_INVOICE_STATUS');

      if (repActor) {
        if (inv.representativeId && inv.representativeId !== repActor.id) {
          throw new AppError(403, 'غير مصرح لك باعتماد فاتورة مندوب آخر', 'FORBIDDEN_INVOICE_ACCESS');
        }
        if (inv.customerId) {
          const cust = db.customers.find((c) => c.id === inv.customerId);
          if (cust && !isCustomerAllowedForRep(cust, repActor.id)) {
            throw new AppError(403, 'غير مصرح لك باعتماد فاتورة لعميل غير معين في قائمتك', 'CUSTOMER_NOT_ASSIGNED_TO_REP');
          }
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
  return confirmedInvoice;
}

export async function editSalesInvoice(invoiceId, updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const inv = await fetchFullInvoicePg(client, invoiceId);
      if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
      if (inv.status === 'cancelled') throw new AppError(409, 'لا يمكن تعديل فاتورة ملغاة', 'INVOICE_CANCELLED');

      const stRes = await client.query(`SELECT allow_negative_stock FROM system_settings LIMIT 1`);
      const allowNeg = Boolean(stRes.rows[0]?.allow_negative_stock) && Boolean(actor?.permissions?.canAllowNegativeInventory);

      const newItemsRaw = updates.items || inv.items;
      const totals = recomputeInvoiceTotals({ items: newItemsRaw, discountTotal: updates.discountTotal ?? inv.discountTotal, paidAmount: inv.paidAmount }, inv.items);

      if (inv.status === 'confirmed') {
        // 1. Revert old stock
        for (const oldItem of inv.items) {
          const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [oldItem.productId]);
          if (pRes.rows[0]) {
            const stockMap = { ...(pRes.rows[0].stock_per_warehouse || {}) };
            const baseQty = round3(oldItem.quantity * (oldItem.unitFactor || 1));
            stockMap[inv.warehouseId] = round3(Number(stockMap[inv.warehouseId] || 0) + baseQty);
            await client.query(`UPDATE products SET stock_per_warehouse = $1 WHERE id = $2`, [JSON.stringify(stockMap), oldItem.productId]);
          }
        }
        // 2. Deduct new stock
        for (const newItem of totals.items) {
          const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [newItem.productId]);
          const prod = pRes.rows[0];
          if (!prod) throw new AppError(404, `الصنف غير موجود (${newItem.productName})`, 'PRODUCT_NOT_FOUND');
          const stockMap = { ...(prod.stock_per_warehouse || {}) };
          const curQty = Number(stockMap[inv.warehouseId] || 0);
          const baseQty = round3(newItem.quantity * (newItem.unitFactor || 1));
          if (curQty < baseQty && !allowNeg) {
            throw new AppError(409, `الرصيد المتاح من (${prod.name}) لا يكفي للتعديل (المتاح: ${curQty}، المطلوب: ${baseQty})`, 'INSUFFICIENT_STOCK');
          }
          stockMap[inv.warehouseId] = round3(curQty - baseQty);
          await client.query(`UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3`, [JSON.stringify(stockMap), now, prod.id]);
        }
        // 3. Adjust customer balance diff
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

      await client.query(
        `UPDATE invoices SET date = $1, subtotal = $2, discount_total = $3, grand_total = $4, remaining_amount = $5, payment_type = $6, notes = $7, updated_at = $8 WHERE id = $9`,
        [
          updates.date || inv.date,
          totals.subtotal,
          totals.discountTotal,
          totals.grandTotal,
          totals.remainingAmount,
          totals.paymentType,
          updates.notes !== undefined ? updates.notes : inv.notes,
          now,
          invoiceId,
        ]
      );
      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
      for (let idx = 0; idx < totals.items.length; idx++) {
        const it = totals.items[idx];
        await client.query(
          `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, barcode, unit, unit_factor, quantity, unit_price, purchase_price_at_time, discount, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [`${invoiceId}-ITM-${idx + 1}`, invoiceId, it.productId, it.productName, it.barcode, it.unit, it.unitFactor, it.quantity, it.unitPrice, it.purchasePriceAtTime, it.discount, it.total]
        );
      }

      return fetchFullInvoicePg(client, invoiceId);
    });

    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تعديل فاتورة مبيعات (${updated.invoiceNumber})`, module: 'المبيعات', recordId: invoiceId });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    const inv = db.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
    if (inv.status === 'cancelled') throw new AppError(409, 'لا يمكن تعديل فاتورة ملغاة', 'INVOICE_CANCELLED');

    const allowNeg = Boolean(db.settings?.allowNegativeStock) && Boolean(actor?.permissions?.canAllowNegativeInventory);
    const totals = recomputeInvoiceTotals(
      { items: updates.items || inv.items, discountTotal: updates.discountTotal ?? inv.discountTotal, paidAmount: inv.paidAmount },
      inv.items
    );

    if (inv.status === 'confirmed') {
      for (const oldItem of inv.items) {
        const prod = db.products.find((p) => p.id === oldItem.productId);
        if (prod) {
          const baseQty = round3(oldItem.quantity * (oldItem.unitFactor || 1));
          prod.stockPerWarehouse[inv.warehouseId] = round3(Number(prod.stockPerWarehouse[inv.warehouseId] || 0) + baseQty);
        }
      }
      for (const newItem of totals.items) {
        const prod = db.products.find((p) => p.id === newItem.productId);
        if (!prod) throw new AppError(404, `الصنف غير موجود (${newItem.productName})`, 'PRODUCT_NOT_FOUND');
        const curQty = Number(prod.stockPerWarehouse[inv.warehouseId] || 0);
        const baseQty = round3(newItem.quantity * (newItem.unitFactor || 1));
        if (curQty < baseQty && !allowNeg) {
          throw new AppError(409, `الرصيد المتاح من (${prod.name}) لا يكفي للتعديل (المتاح: ${curQty}، المطلوب: ${baseQty})`, 'INSUFFICIENT_STOCK');
        }
        prod.stockPerWarehouse[inv.warehouseId] = round3(curQty - baseQty);
      }
      const diff = round2(totals.grandTotal - inv.grandTotal);
      if (inv.customerId && diff !== 0) {
        const cust = db.customers.find((c) => c.id === inv.customerId);
        if (cust) cust.currentBalance = round2(Number(cust.currentBalance || 0) + diff);
      }
    }

    inv.date = updates.date || inv.date;
    inv.items = totals.items;
    inv.subtotal = totals.subtotal;
    inv.discountTotal = totals.discountTotal;
    inv.grandTotal = totals.grandTotal;
    inv.remainingAmount = totals.remainingAmount;
    inv.paymentType = totals.paymentType;
    if (updates.notes !== undefined) inv.notes = updates.notes;
    return inv;
  });

  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تعديل فاتورة مبيعات (${updated.invoiceNumber})`, module: 'المبيعات', recordId: invoiceId });
  return updated;
}

export async function cancelInvoice(invoiceId, reason = '', actor) {
  const now = nowIso();
  const cleanReason = String(reason || 'إلغاء الفاتورة').trim();

  if (await isPgMode()) {
    const inv = await withTransaction(async (client) => {
      const cur = await fetchFullInvoicePg(client, invoiceId);
      if (!cur) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
      if (cur.status === 'cancelled') throw new AppError(409, 'الفاتورة ملغاة بالفعل', 'ALREADY_CANCELLED');

      if (cur.status === 'confirmed') {
        for (const item of cur.items) {
          const pRes = await client.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [item.productId]);
          if (pRes.rows[0]) {
            const stockMap = { ...(pRes.rows[0].stock_per_warehouse || {}) };
            const curQty = Number(stockMap[cur.warehouseId] || 0);
            const baseQty = round3(item.quantity * (item.unitFactor || 1));
            stockMap[cur.warehouseId] = cur.type === 'sales' ? round3(curQty + baseQty) : round3(curQty - baseQty);
            await client.query(`UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3`, [JSON.stringify(stockMap), now, item.productId]);
          }
        }
        if (cur.customerId) {
          const cRes = await client.query(`SELECT current_balance FROM customers WHERE id = $1 FOR UPDATE`, [cur.customerId]);
          if (cRes.rows[0]) {
            await client.query(`UPDATE customers SET current_balance = $1 WHERE id = $2`, [
              round2(Number(cRes.rows[0].current_balance || 0) - Number(cur.remainingAmount || 0)),
              cur.customerId,
            ]);
          }
        }
        if (cur.supplierId) {
          const sRes = await client.query(`SELECT current_balance FROM suppliers WHERE id = $1 FOR UPDATE`, [cur.supplierId]);
          if (sRes.rows[0]) {
            await client.query(`UPDATE suppliers SET current_balance = $1 WHERE id = $2`, [
              round2(Number(sRes.rows[0].current_balance || 0) - Number(cur.remainingAmount || 0)),
              cur.supplierId,
            ]);
          }
        }
        if (cur.paidAmount > 0 && cur.cashboxId) {
          const cbRes = await client.query(`SELECT current_balance FROM cashboxes WHERE id = $1 FOR UPDATE`, [cur.cashboxId]);
          if (cbRes.rows[0]) {
            const nextCb =
              cur.type === 'sales'
                ? round2(Number(cbRes.rows[0].current_balance || 0) - Number(cur.paidAmount || 0))
                : round2(Number(cbRes.rows[0].current_balance || 0) + Number(cur.paidAmount || 0));
            await client.query(`UPDATE cashboxes SET current_balance = $1 WHERE id = $2`, [nextCb, cur.cashboxId]);
          }
        }
      }

      const nextNotes = `${cur.notes || ''} [تم الإلغاء: ${cleanReason}]`.trim();
      await client.query(`UPDATE invoices SET status = 'cancelled', notes = $1, updated_at = $2 WHERE id = $3`, [nextNotes, now, invoiceId]);
      return fetchFullInvoicePg(client, invoiceId);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إلغاء فاتورة (${inv.invoiceNumber})`,
      module: inv.type === 'sales' ? 'المبيعات' : 'المشتريات',
      recordId: invoiceId,
      notes: cleanReason,
    });
    return inv;
  }

  const inv = await withJsonTransaction(async (db) => {
    const cur = db.invoices.find((i) => i.id === invoiceId);
    if (!cur) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
    if (cur.status === 'cancelled') throw new AppError(409, 'الفاتورة ملغاة بالفعل', 'ALREADY_CANCELLED');

    if (cur.status === 'confirmed') {
      for (const item of cur.items) {
        const prod = db.products.find((p) => p.id === item.productId);
        if (prod) {
          const baseQty = round3(item.quantity * (item.unitFactor || 1));
          const curQty = Number(prod.stockPerWarehouse?.[cur.warehouseId] || 0);
          prod.stockPerWarehouse[cur.warehouseId] = cur.type === 'sales' ? round3(curQty + baseQty) : round3(curQty - baseQty);
        }
      }
      if (cur.customerId) {
        const cust = db.customers.find((c) => c.id === cur.customerId);
        if (cust) cust.currentBalance = round2(Number(cust.currentBalance || 0) - Number(cur.remainingAmount || 0));
      }
      if (cur.supplierId) {
        const supp = db.suppliers.find((s) => s.id === cur.supplierId);
        if (supp) supp.currentBalance = round2(Number(supp.currentBalance || 0) - Number(cur.remainingAmount || 0));
      }
      if (cur.paidAmount > 0 && cur.cashboxId) {
        const cb = db.cashboxes.find((c) => c.id === cur.cashboxId);
        if (cb) {
          cb.currentBalance =
            cur.type === 'sales'
              ? round2(Number(cb.currentBalance || 0) - Number(cur.paidAmount || 0))
              : round2(Number(cb.currentBalance || 0) + Number(cur.paidAmount || 0));
        }
      }
    }
    cur.status = 'cancelled';
    cur.notes = `${cur.notes || ''} [تم الإلغاء: ${cleanReason}]`.trim();
    return cur;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إلغاء فاتورة (${inv.invoiceNumber})`,
    module: inv.type === 'sales' ? 'المبيعات' : 'المشتريات',
    recordId: invoiceId,
    notes: cleanReason,
  });
  return inv;
}

export async function addInvoicePayment(invoiceId, paymentData, actor) {
  const amount = round2(paymentData.amount);
  if (amount <= 0) throw new AppError(400, 'مبلغ الدفعة يجب أن يكون أكبر من الصفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const payDate = paymentData.date || todayIso();
  const payId = generateServerId('PAY');

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const invRes = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
      const inv = invRes.rows[0];
      if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
      if (inv.status !== 'confirmed') throw new AppError(409, 'لا يمكن تسجيل دفعة إلا على فاتورة معتمدة', 'INVOICE_NOT_CONFIRMED');
      if (amount > round2(inv.remaining_amount) + 0.01) {
        throw new AppError(400, `قيمة الدفعة (${amount}) تتجاوز المتبقي (${inv.remaining_amount})`, 'EXCEEDS_REMAINING');
      }
      const cbRes = await client.query(`SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE`, [paymentData.cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة المحددة غير موجودة', 'CASHBOX_NOT_FOUND');

      const newPaid = round2(Number(inv.paid_amount || 0) + amount);
      const newRem = round2(Math.max(0, Number(inv.grand_total || 0) - newPaid));
      const newPayType = newRem <= 0 ? 'cash' : 'partial';

      await client.query(
        `UPDATE invoices SET paid_amount = $1, remaining_amount = $2, payment_type = $3, updated_at = $4 WHERE id = $5`,
        [newPaid, newRem, newPayType, now, invoiceId]
      );
      await client.query(
        `INSERT INTO invoice_payments (id, invoice_id, invoice_number, amount, date, payment_method, cashbox_id, cashbox_name, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          txId,
          `TRX-${Date.now().toString().slice(-6)}`,
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
          now,
        ]
      );

      return fetchFullInvoicePg(client, invoiceId);
    });

    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تسجيل دفعة (${amount}) على فاتورة ${result.invoiceNumber}`, module: 'المالية', recordId: invoiceId });
    return result;
  }

  const result = await withJsonTransaction(async (db) => {
    const inv = db.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new AppError(404, 'الفاتورة غير موجودة', 'INVOICE_NOT_FOUND');
    if (inv.status !== 'confirmed') throw new AppError(409, 'لا يمكن تسجيل دفعة إلا على فاتورة معتمدة', 'INVOICE_NOT_CONFIRMED');
    if (amount > round2(inv.remainingAmount) + 0.01) {
      throw new AppError(400, `قيمة الدفعة (${amount}) تتجاوز المتبقي (${inv.remainingAmount})`, 'EXCEEDS_REMAINING');
    }
    const cb = db.cashboxes.find((c) => c.id === paymentData.cashboxId);
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
      transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
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
      createdAt: now,
    });
    return inv;
  });

  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تسجيل دفعة (${amount}) على فاتورة ${result.invoiceNumber}`, module: 'المالية', recordId: invoiceId });
  return result;
}

export async function createInvoiceReturn(returnData, actor) {
  if (!Array.isArray(returnData.items) || returnData.items.length === 0) {
    throw new AppError(400, 'يجب تحديد صنف واحد على الأقل للمرتجع', 'EMPTY_RETURN');
  }
  const now = nowIso();
  const retDate = returnData.date || todayIso();
  const isSalesReturn = returnData.type === 'sales_return';
  const retId = generateServerId('RET');

  if (await isPgMode()) {
    const createdReturn = await withTransaction(async (client) => {
      const orig = await fetchFullInvoicePg(client, returnData.originalInvoiceId);
      if (!orig) throw new AppError(404, 'الفاتورة الأصلية غير موجودة', 'INVOICE_NOT_FOUND');
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
        `INSERT INTO invoice_returns (id, return_number, type, original_invoice_id, original_invoice_number, date, party_id, party_name, warehouse_id, warehouse_name, grand_total, refund_type, cashbox_id, reason, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
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
            `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
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
              nextQty,
              returnData.type,
              retId,
              returnNumber,
              `سند مرتجع رقم ${returnNumber} - السبب: ${returnData.reason || ''}`,
              actor.fullName,
              now,
            ]
          );
        }
      }

      if (returnData.refundType === 'balance') {
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
            `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, created_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [
              txId,
              `TRX-${Date.now().toString().slice(-6)}`,
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

      return {
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
        createdAt: now,
      };
    });

    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء سند مرتجع (${createdReturn.returnNumber})`, module: 'المرتجعات', recordId: createdReturn.id });
    return createdReturn;
  }

  const createdReturn = await withJsonTransaction(async (db) => {
    const orig = db.invoices.find((i) => i.id === returnData.originalInvoiceId);
    if (!orig) throw new AppError(404, 'الفاتورة الأصلية غير موجودة', 'INVOICE_NOT_FOUND');
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
        prod.stockPerWarehouse[whId] = isSalesReturn ? round3(curQty + baseQty) : round3(curQty - baseQty);
        db.stockMovements.unshift({
          id: generateServerId('SM'),
          date: retDate,
          type: isSalesReturn ? 'sale_return' : 'purchase_return',
          productId: prod.id,
          productName: prod.name,
          warehouseId: whId,
          warehouseName: whName,
          quantity: baseQty,
          unitCost: it.unitPrice,
          referenceId: retId,
          referenceNumber: returnNumber,
          notes: `سند مرتجع رقم ${returnNumber} - السبب: ${returnData.reason || ''}`,
          createdBy: actor.fullName,
          createdAt: now,
        });
      }
    }

    if (returnData.refundType === 'balance') {
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
          transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
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
      createdAt: now,
    };
    db.invoiceReturns.unshift(newRet);
    return newRet;
  });

  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء سند مرتجع (${createdReturn.returnNumber})`, module: 'المرتجعات', recordId: createdReturn.id });
  return createdReturn;
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
    if (!rep) return [];
    const allowedCusts = await listCustomers({ forRepId: rep.id });
    const allowedCustIds = new Set(allowedCusts.map((c) => c.id));
    return allInvoices.filter(
      (inv) => inv.representativeId === rep.id || (inv.customerId && allowedCustIds.has(inv.customerId))
    );
  }

  return allInvoices;
}

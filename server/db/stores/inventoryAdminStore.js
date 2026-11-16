import fs from 'node:fs';
import path from 'node:path';
import { getPool, withTransaction } from '../postgres.js';
import {
  withJsonTransaction,
  readJsonDatabase,
  writeJsonDatabase,
  getDataPaths,
  createEmptyDatabaseState,
  readJsonIdempotency,
  writeJsonIdempotency,
  nextJsonSequence,
} from '../jsonLedger.js';
import { hashPasswordBcrypt, generateServerId } from '../../utils/crypto.js';
import { AppError, nowIso, todayIso, round2, round3, sanitizeUser } from '../../utils/errors.js';
import {
  isPgMode,
  mapPgUserRow,
  mapPgCustomerRow,
  mapPgProductRow,
  mapPgOrderRow,
  mapPgInvoiceRow,
  isoDateOnly,
  isoTimestamp,
} from './mode.js';
import { recordAuditLog, listAuditLogs } from './authStore.js';
import { listCustomers, listCategories, listProducts } from './catalogStore.js';
import { listInvoices } from './invoicesStore.js';
import { listOrders } from './ordersStore.js';
import { listPersonalAccountsData } from './personalAccountsStore.js';
import { listStockCounts } from './stockCountsStore.js';
import { listStockTransferRequests } from './stockTransfersStore.js';

// ==============================================================================
// Staff / Admin Bootstrap Snapshot (Strictly NO password hashes, RBAC-scoped)
// ==============================================================================

export async function getStaffBootstrapData(actor) {
  const isAdminOrUserMgr = actor.role === 'admin' || Boolean(actor.permissions?.canManageUsers);
  const canViewPersonal = actor.role === 'admin' || Boolean(actor.permissions?.canViewPersonalAccounts);
  const isRep = actor.role === 'representative';

  if (await isPgMode()) {
    const pool = getPool();
    const [
      usersRes,
      whRes,
      cats,
      prods,
      custs,
      suppRes,
      invs,
      retRes,
      retItemRes,
      cbRes,
      ftRes,
      chRes,
      instRes,
      repRes,
      rtRes,
      ritRes,
      ritItemRes,
      empRes,
      advRes,
      attRes,
      payRes,
      expRes,
      smRes,
      stRes,
      orders,
      audits,
    ] = await Promise.all([
      isAdminOrUserMgr ? pool.query('SELECT * FROM users ORDER BY created_at DESC') : Promise.resolve({ rows: [] }),
      pool.query('SELECT * FROM warehouses ORDER BY created_at ASC'),
      listCategories(),
      listProducts({ forCustomer: false }),
      listCustomers(),
      pool.query('SELECT * FROM suppliers ORDER BY created_at DESC'),
      listInvoices(),
      pool.query('SELECT * FROM invoice_returns ORDER BY created_at DESC'),
      pool.query('SELECT * FROM invoice_return_items'),
      pool.query('SELECT * FROM cashboxes ORDER BY created_at ASC'),
      pool.query('SELECT * FROM financial_transactions ORDER BY created_at DESC LIMIT 1000'),
      pool.query('SELECT * FROM cheques ORDER BY created_at DESC'),
      pool.query('SELECT * FROM installments ORDER BY created_at DESC'),
      pool.query('SELECT * FROM representatives ORDER BY created_at ASC'),
      pool.query('SELECT * FROM rep_transfers ORDER BY created_at DESC'),
      pool.query('SELECT * FROM rep_item_transfers ORDER BY created_at DESC'),
      pool.query('SELECT * FROM rep_item_transfer_items'),
      pool.query('SELECT * FROM employees ORDER BY created_at DESC'),
      pool.query('SELECT * FROM advances_deductions ORDER BY created_at DESC'),
      pool.query('SELECT * FROM attendance ORDER BY date DESC LIMIT 1000'),
      pool.query('SELECT * FROM payrolls ORDER BY created_at DESC'),
      pool.query('SELECT * FROM expenses_incomes ORDER BY created_at DESC'),
      pool.query('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 1500'),
      pool.query('SELECT * FROM system_settings LIMIT 1'),
      listOrders({ user: actor }),
      isAdminOrUserMgr ? listAuditLogs(300) : Promise.resolve([]),
    ]);

    const retItemsMap = new Map();
    for (const it of retItemRes.rows) {
      const list = retItemsMap.get(it.return_id) || [];
      list.push({
        productId: it.product_id,
        productName: it.product_name,
        unit: it.unit,
        unitFactor: Number(it.unit_factor || 1),
        quantity: Number(it.quantity || 0),
        unitPrice: Number(it.unit_price || 0),
        total: Number(it.total || 0),
      });
      retItemsMap.set(it.return_id, list);
    }

    const ritItemsMap = new Map();
    for (const it of ritItemRes.rows) {
      const list = ritItemsMap.get(it.transfer_id) || [];
      list.push({
        productId: it.product_id,
        productName: it.product_name,
        barcode: it.barcode || '',
        unit: it.unit,
        requestedQty: Number(it.requested_qty || 0),
        availableInVanQty: Number(it.available_in_van_qty || 0),
        shortageQty: Number(it.shortage_qty || 0),
        approvedQty: it.approved_qty ?? undefined,
        executedQty: it.executed_qty ?? undefined,
      });
      ritItemsMap.set(it.transfer_id, list);
    }

    const sRow = stRes.rows[0];
    const settings = sRow
      ? {
          companyName: sRow.company_name,
          companySubtitle: sRow.company_subtitle || '',
          phone1: sRow.phone1 || '',
          phone2: sRow.phone2 || '',
          address: sRow.address || '',
          commercialRegistration: sRow.commercial_registration || '',
          taxNumber: sRow.tax_number || '',
          currency: sRow.currency || 'ج.م',
          defaultPrintMode: sRow.default_print_mode || 'a4',
          invoiceNotes: sRow.invoice_notes || '',
          allowNegativeStock: Boolean(sRow.allow_negative_stock),
          extraSettings: sRow.extra_settings || {},
        }
      : createEmptyDatabaseState().settings;

    const [personalData, stockCountsList, stockTransferRequestsList] = await Promise.all([
      canViewPersonal ? listPersonalAccountsData() : Promise.resolve({ accounts: [], transactions: [] }),
      isRep ? Promise.resolve([]) : listStockCounts(),
      isRep ? Promise.resolve([]) : listStockTransferRequests(),
    ]);

    return {
      mode: 'postgresql-enterprise',
      users: usersRes.rows.map((r) => sanitizeUser(mapPgUserRow(r))),
      warehouses: whRes.rows.map((w) => ({
        id: w.id,
        name: w.name,
        code: w.code,
        location: w.location || '',
        managerName: w.manager_name || undefined,
        phone: w.phone || undefined,
        isDefault: Boolean(w.is_default),
        status: w.status || 'active',
      })),
      categories: cats,
      products: prods,
      customers: custs,
      suppliers: isRep
        ? []
        : suppRes.rows.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            phone: s.phone || '',
            address: s.address || '',
            openingBalance: Number(s.opening_balance || 0),
            currentBalance: Number(s.current_balance || 0),
            notes: s.notes || '',
            status: s.status || 'active',
            createdAt: isoTimestamp(s.created_at),
          })),
      invoices: invs,
      invoiceReturns: retRes.rows.map((r) => ({
        id: r.id,
        returnNumber: r.return_number,
        type: r.type,
        originalInvoiceId: r.original_invoice_id,
        originalInvoiceNumber: r.original_invoice_number,
        date: isoDateOnly(r.date),
        partyId: r.party_id,
        partyName: r.party_name,
        warehouseId: r.warehouse_id,
        warehouseName: r.warehouse_name,
        items: retItemsMap.get(r.id) || [],
        grandTotal: Number(r.grand_total || 0),
        refundType: r.refund_type,
        cashboxId: r.cashbox_id || undefined,
        reason: r.reason,
        notes: r.notes || '',
        createdBy: r.created_by,
        createdAt: isoTimestamp(r.created_at),
      })),
      cashboxes: cbRes.rows.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        openingBalance: Number(c.opening_balance || 0),
        currentBalance: Number(c.current_balance || 0),
        isDefault: Boolean(c.is_default),
      })),
      financialTransactions: isRep
        ? []
        : ftRes.rows.map((ft) => ({
            id: ft.id,
            transactionNumber: ft.transaction_number,
            date: isoDateOnly(ft.date),
            type: ft.type,
            cashboxId: ft.cashbox_id,
            cashboxName: ft.cashbox_name,
            amount: Number(ft.amount || 0),
            category: ft.category || '',
            relatedDocType: ft.related_doc_type || undefined,
            relatedDocId: ft.related_doc_id || undefined,
            relatedDocNumber: ft.related_doc_number || undefined,
            partyId: ft.related_entity_id || undefined,
            partyName: ft.related_entity_name || undefined,
            description: ft.description || '',
            notes: ft.notes || '',
            createdBy: ft.created_by,
            createdAt: isoTimestamp(ft.created_at),
          })),
      cheques: isRep
        ? []
        : chRes.rows.map((ch) => ({
            id: ch.id,
            chequeNumber: ch.cheque_number,
            type: ch.type,
            bankName: ch.bank_name,
            amount: Number(ch.amount || 0),
            issueDate: isoDateOnly(ch.issue_date),
            dueDate: isoDateOnly(ch.due_date),
            partyId: ch.party_id,
            partyName: ch.party_name,
            status: ch.status,
            cashboxId: ch.cashbox_id || undefined,
            notes: ch.notes || '',
            createdAt: isoTimestamp(ch.created_at),
          })),
      installments: isRep
        ? []
        : instRes.rows.map((i) => ({
            id: i.id,
            scheduleNumber: i.schedule_number,
            customerId: i.customer_id,
            customerName: i.customer_name,
            invoiceId: i.invoice_id || undefined,
            invoiceNumber: i.invoice_number || undefined,
            totalAmount: Number(i.total_amount || 0),
            paidAmount: Number(i.paid_amount || 0),
            remainingAmount: Number(i.remaining_amount || 0),
            items: i.installments_data || [],
            notes: i.notes || '',
            createdAt: isoTimestamp(i.created_at),
          })),
      representatives: repRes.rows.map((r) => ({
        id: r.id,
        userId: r.user_id || undefined,
        name: r.name,
        phone: r.phone || '',
        vehicleNumber: r.vehicle_number || '',
        warehouseId: r.warehouse_id || undefined,
        openingBalance: Number(r.opening_balance || 0),
        currentBalance: Number(r.current_balance || 0),
        commissionRate: Number(r.commission_rate || 0),
        notes: r.notes || '',
        status: r.status || 'active',
      })),
      repTransfers: rtRes.rows.map((rt) => ({
        id: rt.id,
        transferNumber: rt.transfer_number,
        date: isoDateOnly(rt.date),
        timestamp: isoTimestamp(rt.created_at),
        direction: rt.direction,
        senderId: rt.sender_id,
        senderName: rt.sender_name,
        receiverId: rt.receiver_id,
        receiverName: rt.receiver_name,
        amount: Number(rt.amount || 0),
        cashboxId: rt.cashbox_id,
        cashboxName: rt.cashbox_name,
        notes: rt.notes || '',
        status: rt.status,
        sentAt: rt.sent_at ? isoTimestamp(rt.sent_at) : isoTimestamp(rt.created_at),
        confirmedAt: rt.confirmed_at ? isoTimestamp(rt.confirmed_at) : undefined,
        rejectedAt: rt.rejected_at ? isoTimestamp(rt.rejected_at) : undefined,
        rejectionReason: rt.rejection_reason || undefined,
        confirmedBy: rt.confirmed_by || undefined,
        auditTrail: rt.audit_trail || [],
      })),
      repItemTransfers: ritRes.rows.map((rit) => ({
        id: rit.id,
        requestNumber: rit.request_number,
        date: isoDateOnly(rit.date),
        representativeId: rit.representative_id,
        representativeName: rit.representative_name,
        invoiceId: rit.invoice_id || undefined,
        invoiceNumber: rit.invoice_number || undefined,
        sourceWarehouseId: rit.source_warehouse_id,
        sourceWarehouseName: rit.source_warehouse_name,
        targetWarehouseId: rit.target_warehouse_id,
        targetWarehouseName: rit.target_warehouse_name,
        items: ritItemsMap.get(rit.id) || [],
        status: rit.status,
        rejectionReason: rit.rejection_reason || undefined,
        notes: rit.notes || '',
        createdBy: rit.created_by,
        createdAt: isoTimestamp(rit.created_at),
        reviewedBy: rit.reviewed_by || undefined,
        reviewedAt: rit.reviewed_at ? isoTimestamp(rit.reviewed_at) : undefined,
        executedAt: rit.executed_at ? isoTimestamp(rit.executed_at) : undefined,
      })),
      customerItemOrders: orders,
      employees: isRep
        ? []
        : empRes.rows.map((e) => ({
            id: e.id,
            code: e.code,
            name: e.full_name,
            phone: e.phone || '',
            jobTitle: e.job_title,
            department: e.department || '',
            nationalId: e.national_id || '',
            basicSalary: Number(e.basic_salary || 0),
            hireDate: isoDateOnly(e.hire_date),
            status: e.status || 'active',
            notes: e.notes || '',
          })),
      advancesDeductions: isRep
        ? []
        : advRes.rows.map((a) => ({
            id: a.id,
            employeeId: a.employee_id,
            employeeName: a.employee_name,
            type: a.type,
            amount: Number(a.amount || 0),
            date: isoDateOnly(a.date),
            reason: a.reason || '',
            cashboxId: a.cashbox_id || undefined,
            isSettled: Boolean(a.is_settled),
            createdAt: isoTimestamp(a.created_at),
          })),
      attendance: isRep
        ? []
        : attRes.rows.map((a) => ({
            id: a.id,
            employeeId: a.employee_id,
            employeeName: a.employee_name,
            date: isoDateOnly(a.date),
            status: a.status,
            checkIn: a.check_in_time || undefined,
            checkOut: a.check_out_time || undefined,
            notes: a.notes || '',
          })),
      payrolls: isRep
        ? []
        : payRes.rows.map((p) => ({
            id: p.id,
            payrollNumber: p.payroll_number,
            month: Number(p.month),
            year: Number(p.year || new Date().getFullYear()),
            employeeId: p.employee_id,
            employeeName: p.employee_name,
            basicSalary: Number(p.basic_salary || 0),
            advancesTotal: Number(p.advances || 0),
            deductionsTotal: Number(p.deductions || 0),
            bonusesTotal: Number(p.allowances || 0),
            netSalary: Number(p.net_salary || 0),
            status: p.payment_status || 'paid',
            paidDate: p.payment_date ? isoDateOnly(p.payment_date) : undefined,
            cashboxId: p.cashbox_id || undefined,
            notes: p.notes || '',
          })),
      expenseIncomes: isRep
        ? []
        : expRes.rows.map((ex) => ({
            id: ex.id,
            recordNumber: ex.voucher_number,
            type: ex.type,
            category: ex.category,
            amount: Number(ex.amount || 0),
            date: isoDateOnly(ex.date),
            cashboxId: ex.cashbox_id,
            cashboxName: ex.cashbox_name,
            paymentMethod: ex.payment_method || 'cash',
            recipientOrPayer: ex.recipient_or_payer || '',
            attachmentName: ex.attachment_name || undefined,
            notes: ex.notes || '',
            createdBy: ex.created_by,
            createdAt: isoTimestamp(ex.created_at),
          })),
      stockMovements: smRes.rows.map((sm) => ({
        id: sm.id,
        date: isoDateOnly(sm.date),
        type: sm.movement_type,
        productId: sm.product_id,
        productName: sm.product_name,
        warehouseId: sm.warehouse_id,
        warehouseName: sm.warehouse_name,
        targetWarehouseId: sm.target_warehouse_id || undefined,
        targetWarehouseName: sm.target_warehouse_name || undefined,
        quantity: Number(sm.quantity || 0),
        unitCost: Number(sm.unit_cost || 0),
        referenceId: sm.related_doc_id || undefined,
        referenceNumber: sm.related_doc_number || undefined,
        notes: sm.notes || '',
        createdBy: sm.created_by,
        createdAt: isoTimestamp(sm.created_at),
      })),
      ownerAccounts: personalData.accounts,
      ownerTransactions: personalData.transactions,
      stockCounts: stockCountsList,
      stockTransferRequests: stockTransferRequestsList,
      settings,
      auditLogs: audits,
    };
  }

  // JSON Ledger fallback
  const db = readJsonDatabase();
  const audits = isAdminOrUserMgr ? await listAuditLogs(300) : [];
  return {
    mode: 'local-json-ledger',
    users: isAdminOrUserMgr ? db.users.map(sanitizeUser) : [],
    warehouses: db.warehouses,
    categories: db.categories,
    products: db.products,
    customers: db.customers,
    suppliers: isRep ? [] : db.suppliers,
    invoices: db.invoices,
    invoiceReturns: db.invoiceReturns,
    cashboxes: db.cashboxes,
    financialTransactions: isRep ? [] : db.financialTransactions,
    cheques: isRep ? [] : db.cheques,
    installments: isRep ? [] : db.installments,
    representatives: db.representatives,
    repTransfers: db.repTransfers,
    repItemTransfers: db.repItemTransfers,
    customerItemOrders: db.customerItemOrders,
    employees: isRep ? [] : db.employees,
    advancesDeductions: isRep ? [] : db.advancesDeductions,
    attendance: isRep ? [] : db.attendance,
    payrolls: isRep ? [] : db.payrolls,
    expenseIncomes: isRep ? [] : db.expenseIncomes,
    stockMovements: db.stockMovements,
    ownerAccounts: canViewPersonal ? (db.ownerAccounts || []) : [],
    ownerTransactions: canViewPersonal ? (db.ownerTransactions || []) : [],
    stockCounts: isRep ? [] : (db.stockCounts || []),
    stockTransferRequests: isRep ? [] : (db.stockTransferRequests || []),
    settings: db.settings,
    auditLogs: audits,
  };
}

// ==============================================================================
// Warehouses & Stock Operations
// ==============================================================================

export async function createWarehouse(payload, actor) {
  const id = payload.id || generateServerId('WH');
  const code = String(payload.code || `WH-${Date.now().toString().slice(-4)}`).trim();
  const name = String(payload.name || '').trim();
  if (!name) throw new AppError(400, 'اسم المستودع مطلوب', 'INVALID_WAREHOUSE_NAME');
  const now = nowIso();

  if (await isPgMode()) {
    const wh = await withTransaction(async (client) => {
      if (payload.isDefault) await client.query('UPDATE warehouses SET is_default = FALSE');
      await client.query(
        `INSERT INTO warehouses (id, name, code, location, manager_name, phone, is_default, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, name, code, payload.location || '', payload.managerName || null, payload.phone || null, Boolean(payload.isDefault), payload.status || 'active', now]
      );
      return { id, name, code, location: payload.location || '', managerName: payload.managerName, phone: payload.phone, isDefault: Boolean(payload.isDefault), status: payload.status || 'active' };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة مستودع (${name})`, module: 'المخزون والمستودعات', recordId: id });
    return wh;
  }

  const wh = await withJsonTransaction(async (db) => {
    if (payload.isDefault) db.warehouses.forEach((w) => { w.isDefault = false; });
    const item = { id, name, code, location: payload.location || '', managerName: payload.managerName, phone: payload.phone, isDefault: Boolean(payload.isDefault), status: payload.status || 'active' };
    db.warehouses.push(item);
    return item;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة مستودع (${name})`, module: 'المخزون والمستودعات', recordId: id });
  return wh;
}

export async function updateWarehouse(warehouseId, updates, actor) {
  if (await isPgMode()) {
    const wh = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM warehouses WHERE id = $1 FOR UPDATE', [warehouseId]);
      if (!r.rows[0]) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
      const cur = r.rows[0];
      if (updates.isDefault) await client.query('UPDATE warehouses SET is_default = FALSE');
      await client.query(
        `UPDATE warehouses SET name = $1, location = $2, manager_name = $3, phone = $4, is_default = $5, status = $6 WHERE id = $7`,
        [updates.name ?? cur.name, updates.location ?? cur.location, updates.managerName ?? cur.manager_name, updates.phone ?? cur.phone, updates.isDefault ?? cur.is_default, updates.status ?? cur.status, warehouseId]
      );
      const next = (await client.query('SELECT * FROM warehouses WHERE id = $1', [warehouseId])).rows[0];
      return { id: next.id, name: next.name, code: next.code, location: next.location || '', managerName: next.manager_name || undefined, phone: next.phone || undefined, isDefault: Boolean(next.is_default), status: next.status };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث مستودع (${wh.name})`, module: 'المخزون والمستودعات', recordId: warehouseId });
    return wh;
  }

  const wh = await withJsonTransaction(async (db) => {
    const idx = db.warehouses.findIndex((w) => w.id === warehouseId);
    if (idx === -1) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
    if (updates.isDefault) db.warehouses.forEach((w) => { w.isDefault = false; });
    db.warehouses[idx] = { ...db.warehouses[idx], ...updates, id: warehouseId };
    return db.warehouses[idx];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث مستودع (${wh.name})`, module: 'المخزون والمستودعات', recordId: warehouseId });
  return wh;
}

export async function deleteWarehouse(warehouseId, actor) {
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM warehouses WHERE id = $1 FOR UPDATE', [warehouseId]);
      if (!r.rows[0]) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
      const used = await client.query('SELECT id FROM invoices WHERE warehouse_id = $1 LIMIT 1', [warehouseId]);
      if (used.rows[0]) throw new AppError(409, 'لا يمكن حذف مستودع مرتبط بفواتير. يمكنك إيقافه بدلاً من الحذف.', 'WAREHOUSE_IN_USE');
      await client.query('DELETE FROM warehouses WHERE id = $1', [warehouseId]);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مستودع`, module: 'المخزون والمستودعات', recordId: warehouseId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    if (!db.warehouses.some((w) => w.id === warehouseId)) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
    if (db.invoices.some((i) => i.warehouseId === warehouseId)) {
      throw new AppError(409, 'لا يمكن حذف مستودع مرتبط بفواتير. يمكنك إيقافه بدلاً من الحذف.', 'WAREHOUSE_IN_USE');
    }
    db.warehouses = db.warehouses.filter((w) => w.id !== warehouseId);
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مستودع`, module: 'المخزون والمستودعات', recordId: warehouseId });
  return { ok: true };
}

export async function transferStock({ productId, fromWarehouseId, toWarehouseId, quantity, notes = '' }, actor) {
  const qty = round3(quantity);
  if (qty <= 0) throw new AppError(400, 'الكمية يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');
  if (fromWarehouseId === toWarehouseId) throw new AppError(400, 'لا يمكن التحويل إلى نفس المستودع', 'SAME_WAREHOUSE');
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const prod = pRes.rows[0];
      if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const fromWh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [fromWarehouseId])).rows[0];
      const toWh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [toWarehouseId])).rows[0];
      if (!fromWh || !toWh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

      const stockMap = { ...(prod.stock_per_warehouse || {}) };
      const curFrom = Number(stockMap[fromWarehouseId] || 0);
      if (curFrom < qty) throw new AppError(409, `الرصيد المتاح (${curFrom}) أقل من المطلوب للتحويل (${qty})`, 'INSUFFICIENT_STOCK');
      stockMap[fromWarehouseId] = round3(curFrom - qty);
      stockMap[toWarehouseId] = round3(Number(stockMap[toWarehouseId] || 0) + qty);
      await client.query('UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(stockMap), now, productId]);

      const mOutId = generateServerId('SM');
      const mInId = generateServerId('SM');
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'transfer_out',$10,$11,1,$12,$13,$14,$15,$16)`,
        [mOutId, mOutId, dateStr, prod.id, prod.name, fromWh.id, fromWh.name, toWh.id, toWh.name, qty, prod.base_unit, prod.purchase_price, stockMap[fromWarehouseId], `تحويل صادر إلى ${toWh.name}: ${notes}`, actor.fullName, now]
      );
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'transfer_in',$10,$11,1,$12,$13,$14,$15,$16)`,
        [mInId, mInId, dateStr, prod.id, prod.name, toWh.id, toWh.name, fromWh.id, fromWh.name, qty, prod.base_unit, prod.purchase_price, stockMap[toWarehouseId], `تحويل وارد من ${fromWh.name}: ${notes}`, actor.fullName, now]
      );
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحويل مخزني بين المستودعات`, module: 'المخزون والمستودعات', recordId: productId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const prod = db.products.find((p) => p.id === productId);
    if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
    const fromWh = db.warehouses.find((w) => w.id === fromWarehouseId);
    const toWh = db.warehouses.find((w) => w.id === toWarehouseId);
    if (!fromWh || !toWh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

    const curFrom = Number(prod.stockPerWarehouse?.[fromWarehouseId] || 0);
    if (curFrom < qty) throw new AppError(409, `الرصيد المتاح (${curFrom}) أقل من المطلوب للتحويل (${qty})`, 'INSUFFICIENT_STOCK');
    prod.stockPerWarehouse[fromWarehouseId] = round3(curFrom - qty);
    prod.stockPerWarehouse[toWarehouseId] = round3(Number(prod.stockPerWarehouse?.[toWarehouseId] || 0) + qty);

    db.stockMovements.unshift(
      {
        id: generateServerId('SM'),
        date: dateStr,
        type: 'transfer_in',
        productId: prod.id,
        productName: prod.name,
        warehouseId: toWh.id,
        warehouseName: toWh.name,
        targetWarehouseId: fromWh.id,
        targetWarehouseName: fromWh.name,
        quantity: qty,
        unitCost: prod.purchasePrice,
        notes: `تحويل وارد من ${fromWh.name}: ${notes}`,
        createdBy: actor.fullName,
        createdAt: now,
      },
      {
        id: generateServerId('SM'),
        date: dateStr,
        type: 'transfer_out',
        productId: prod.id,
        productName: prod.name,
        warehouseId: fromWh.id,
        warehouseName: fromWh.name,
        targetWarehouseId: toWh.id,
        targetWarehouseName: toWh.name,
        quantity: qty,
        unitCost: prod.purchasePrice,
        notes: `تحويل صادر إلى ${toWh.name}: ${notes}`,
        createdBy: actor.fullName,
        createdAt: now,
      }
    );
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحويل مخزني بين المستودعات`, module: 'المخزون والمستودعات', recordId: productId });
  return { ok: true };
}

export async function adjustStock({ productId, warehouseId, newQuantity, reason = '' }, actor) {
  const nextQty = round3(newQuantity);
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const prod = pRes.rows[0];
      if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const wh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [warehouseId])).rows[0];
      if (!wh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

      const stockMap = { ...(prod.stock_per_warehouse || {}) };
      const oldQty = Number(stockMap[warehouseId] || 0);
      const diff = round3(nextQty - oldQty);
      stockMap[warehouseId] = nextQty;
      await client.query('UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(stockMap), now, productId]);

      const mvId = generateServerId('SM');
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'adjustment',$8,$9,1,$10,$11,$12,$13,$14)`,
        [mvId, mvId, dateStr, prod.id, prod.name, wh.id, wh.name, Math.abs(diff), prod.base_unit, prod.purchase_price, nextQty, `تسوية جردية: الفرق (${diff > 0 ? '+' : ''}${diff}) - ${reason}`, actor.fullName, now]
      );
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تسوية جردية (${reason})`, module: 'المخزون والمستودعات', recordId: productId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const prod = db.products.find((p) => p.id === productId);
    const wh = db.warehouses.find((w) => w.id === warehouseId);
    if (!prod || !wh) throw new AppError(404, 'الصنف أو المستودع غير موجود', 'NOT_FOUND');
    const oldQty = Number(prod.stockPerWarehouse?.[warehouseId] || 0);
    const diff = round3(nextQty - oldQty);
    prod.stockPerWarehouse[warehouseId] = nextQty;
    db.stockMovements.unshift({
      id: generateServerId('SM'),
      date: dateStr,
      type: 'adjustment',
      productId: prod.id,
      productName: prod.name,
      warehouseId: wh.id,
      warehouseName: wh.name,
      quantity: Math.abs(diff),
      unitCost: prod.purchasePrice,
      notes: `تسوية جردية: الفرق (${diff > 0 ? '+' : ''}${diff}) - ${reason}`,
      createdBy: actor.fullName,
      createdAt: now,
    });
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تسوية جردية (${reason})`, module: 'المخزون والمستودعات', recordId: productId });
  return { ok: true };
}

export async function recordDamagedStock({ productId, warehouseId, quantity, reason = '' }, actor) {
  const qty = round3(quantity);
  if (qty <= 0) throw new AppError(400, 'الكمية التالفة يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const prod = pRes.rows[0];
      if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const wh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [warehouseId])).rows[0];
      if (!wh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

      const stockMap = { ...(prod.stock_per_warehouse || {}) };
      const curQty = Number(stockMap[warehouseId] || 0);
      const nextQty = round3(Math.max(0, curQty - qty));
      stockMap[warehouseId] = nextQty;
      await client.query('UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(stockMap), now, productId]);

      const mvId = generateServerId('SM');
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'damaged',$8,$9,1,$10,$11,$12,$13,$14)`,
        [mvId, mvId, dateStr, prod.id, prod.name, wh.id, wh.name, qty, prod.base_unit, prod.purchase_price, nextQty, `توالف ومنتهي الصلاحية: ${reason}`, actor.fullName, now]
      );
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إثبات توالف (${qty})`, module: 'المخزون والمستودعات', recordId: productId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const prod = db.products.find((p) => p.id === productId);
    const wh = db.warehouses.find((w) => w.id === warehouseId);
    if (!prod || !wh) throw new AppError(404, 'الصنف أو المستودع غير موجود', 'NOT_FOUND');
    const curQty = Number(prod.stockPerWarehouse?.[warehouseId] || 0);
    prod.stockPerWarehouse[warehouseId] = round3(Math.max(0, curQty - qty));
    db.stockMovements.unshift({
      id: generateServerId('SM'),
      date: dateStr,
      type: 'damaged',
      productId: prod.id,
      productName: prod.name,
      warehouseId: wh.id,
      warehouseName: wh.name,
      quantity: qty,
      unitCost: prod.purchasePrice,
      notes: `توالف ومنتهي الصلاحية: ${reason}`,
      createdBy: actor.fullName,
      createdAt: now,
    });
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إثبات توالف (${qty})`, module: 'المخزون والمستودعات', recordId: productId });
  return { ok: true };
}

// ==============================================================================
// Rep Financial Transfers ("تحويل بالنصف") & Rep Item Transfers
// ==============================================================================

export async function createRepTransfer(payload, actor) {
  const amount = round2(payload.amount);
  if (amount <= 0) throw new AppError(400, 'مبلغ التحويل يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const dateStr = todayIso();
  const id = generateServerId('TRN');
  const transferNumber = `TRN-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
  const auditEntry = { timestamp: now, action: 'إنشاء طلب التحويل بالنصف وإرساله للطرف الآخر', user: actor.fullName, note: payload.notes || '' };

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      const cb = (await client.query('SELECT id, name FROM cashboxes WHERE id = $1 LIMIT 1', [payload.cashboxId])).rows[0];
      if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const repId = payload.direction === 'rep_to_owner' ? payload.senderId : payload.receiverId;
      await client.query(
        `INSERT INTO rep_transfers (id, transfer_number, representative_id, representative_name, direction, sender_id, sender_name, receiver_id, receiver_name, type, amount, cashbox_id, cashbox_name, date, status, notes, sent_at, audit_trail, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$5,$10,$11,$12,$13,'awaiting_receipt',$14,$15,$16,$17,$15)`,
        [
          id,
          transferNumber,
          repId || null,
          payload.direction === 'rep_to_owner' ? payload.senderName : payload.receiverName,
          payload.direction,
          payload.senderId,
          payload.senderName,
          payload.receiverId,
          payload.receiverName,
          amount,
          cb.id,
          cb.name,
          dateStr,
          payload.notes || '',
          now,
          JSON.stringify([auditEntry]),
          actor.fullName,
        ]
      );
      return {
        id,
        transferNumber,
        date: dateStr,
        timestamp: now,
        direction: payload.direction,
        senderId: payload.senderId,
        senderName: payload.senderName,
        receiverId: payload.receiverId,
        receiverName: payload.receiverName,
        amount,
        cashboxId: cb.id,
        cashboxName: cb.name,
        notes: payload.notes || '',
        status: 'awaiting_receipt',
        sentAt: now,
        auditTrail: [auditEntry],
      };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء طلب تحويل بالنصف (${transferNumber})`, module: 'المندوبون', recordId: id });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    const cb = db.cashboxes.find((c) => c.id === payload.cashboxId);
    if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
    const item = {
      id,
      transferNumber,
      date: dateStr,
      timestamp: now,
      direction: payload.direction,
      senderId: payload.senderId,
      senderName: payload.senderName,
      receiverId: payload.receiverId,
      receiverName: payload.receiverName,
      amount,
      cashboxId: cb.id,
      cashboxName: cb.name,
      notes: payload.notes || '',
      status: 'awaiting_receipt',
      sentAt: now,
      auditTrail: [auditEntry],
    };
    db.repTransfers.unshift(item);
    return item;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء طلب تحويل بالنصف (${transferNumber})`, module: 'المندوبون', recordId: id });
  return created;
}

export async function confirmRepTransfer(transferId, { note = '' } = {}, actor) {
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const trRes = await client.query('SELECT * FROM rep_transfers WHERE id = $1 FOR UPDATE', [transferId]);
      const tr = trRes.rows[0];
      if (!tr) throw new AppError(404, 'طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND');
      if (tr.status === 'received') throw new AppError(409, 'تم تأكيد استلام التحويل مسبقًا', 'ALREADY_RECEIVED');
      if (tr.status === 'rejected' || tr.status === 'cancelled') throw new AppError(409, 'لا يمكن تأكيد تحويل مرفوض أو ملغى', 'INVALID_STATUS');

      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [tr.cashbox_id]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const cb = cbRes.rows[0];
      const amount = Number(tr.amount || 0);
      const repId = tr.direction === 'rep_to_owner' ? tr.sender_id : tr.receiver_id;

      if (repId) {
        const repRes = await client.query('SELECT * FROM representatives WHERE id = $1 FOR UPDATE', [repId]);
        if (repRes.rows[0]) {
          const curRepBal = Number(repRes.rows[0].current_balance || 0);
          const nextRepBal = tr.direction === 'rep_to_owner' ? round2(curRepBal - amount) : round2(curRepBal + amount);
          await client.query('UPDATE representatives SET current_balance = $1 WHERE id = $2', [nextRepBal, repId]);
        }
      }

      const nextCb = tr.direction === 'rep_to_owner' ? round2(Number(cb.current_balance || 0) + amount) : round2(Number(cb.current_balance || 0) - amount);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, cb.id]);

      const txId = generateServerId('FT');
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, notes, created_by, created_at)
         VALUES ($1,$2,$3,'rep_transfer',$4,$5,$6,$7,$8,$9,'rep_transfer',$10,$11,$12,$13,$14,$15)`,
        [
          txId,
          `TRX-${Date.now().toString().slice(-6)}`,
          dateStr,
          amount,
          cb.id,
          cb.name,
          nextCb,
          tr.direction === 'rep_to_owner' ? 'توريد تحصيلات مندوب' : 'صرف عهدة ونقدية لمندوب',
          tr.direction === 'rep_to_owner' ? tr.sender_name : tr.receiver_name,
          tr.id,
          tr.transfer_number,
          `اعتماد طلب تحويل بالنصف رقم ${tr.transfer_number}`,
          note || tr.notes || '',
          actor.fullName,
          now,
        ]
      );

      const nextAudit = [...(tr.audit_trail || []), { timestamp: now, action: 'تأكيد الاستلام الفعلي واعتماد القيود', user: actor.fullName, note }];
      await client.query(
        `UPDATE rep_transfers SET status = 'received', confirmed_at = $1, confirmed_by = $2, audit_trail = $3 WHERE id = $4`,
        [now, actor.fullName, JSON.stringify(nextAudit), transferId]
      );
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تأكيد استلام تحويل مندوب`, module: 'المندوبون', recordId: transferId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const tr = db.repTransfers.find((t) => t.id === transferId);
    if (!tr) throw new AppError(404, 'طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND');
    if (tr.status === 'received') throw new AppError(409, 'تم تأكيد استلام التحويل مسبقًا', 'ALREADY_RECEIVED');
    if (tr.status === 'rejected' || tr.status === 'cancelled') throw new AppError(409, 'لا يمكن تأكيد تحويل مرفوض أو ملغى', 'INVALID_STATUS');

    const cb = db.cashboxes.find((c) => c.id === tr.cashboxId);
    if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
    const repId = tr.direction === 'rep_to_owner' ? tr.senderId : tr.receiverId;
    const rep = db.representatives.find((r) => r.id === repId);
    if (rep) {
      rep.currentBalance = tr.direction === 'rep_to_owner' ? round2(rep.currentBalance - tr.amount) : round2(rep.currentBalance + tr.amount);
    }
    cb.currentBalance = tr.direction === 'rep_to_owner' ? round2(cb.currentBalance + tr.amount) : round2(cb.currentBalance - tr.amount);
    db.financialTransactions.unshift({
      id: generateServerId('FT'),
      transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
      date: dateStr,
      type: 'rep_transfer',
      cashboxId: cb.id,
      cashboxName: cb.name,
      amount: tr.amount,
      category: tr.direction === 'rep_to_owner' ? 'توريد تحصيلات مندوب' : 'صرف عهدة ونقدية لمندوب',
      relatedDocType: 'rep_transfer',
      relatedDocId: tr.id,
      relatedDocNumber: tr.transferNumber,
      partyName: tr.direction === 'rep_to_owner' ? tr.senderName : tr.receiverName,
      description: `اعتماد طلب تحويل بالنصف رقم ${tr.transferNumber}`,
      notes: note || tr.notes || '',
      createdBy: actor.fullName,
      createdAt: now,
    });
    tr.status = 'received';
    tr.confirmedAt = now;
    tr.confirmedBy = actor.fullName;
    tr.auditTrail = [...(tr.auditTrail || []), { timestamp: now, action: 'تأكيد الاستلام الفعلي واعتماد القيود', user: actor.fullName, note }];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تأكيد استلام تحويل مندوب`, module: 'المندوبون', recordId: transferId });
  return { ok: true };
}

export async function rejectRepTransfer(transferId, { reason = '' } = {}, actor) {
  const now = nowIso();
  const cleanReason = String(reason || 'مرفوض').trim();
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const trRes = await client.query('SELECT * FROM rep_transfers WHERE id = $1 FOR UPDATE', [transferId]);
      const tr = trRes.rows[0];
      if (!tr) throw new AppError(404, 'طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND');
      if (tr.status === 'received') throw new AppError(409, 'تم تأكيد استلام التحويل مسبقًا ولا يمكن رفضه', 'ALREADY_RECEIVED');
      const nextAudit = [...(tr.audit_trail || []), { timestamp: now, action: 'رفض طلب التحويل', user: actor.fullName, note: cleanReason }];
      await client.query(`UPDATE rep_transfers SET status = 'rejected', rejected_at = $1, rejection_reason = $2, audit_trail = $3 WHERE id = $4`, [
        now,
        cleanReason,
        JSON.stringify(nextAudit),
        transferId,
      ]);
    });
    return { ok: true };
  }
  await withJsonTransaction(async (db) => {
    const tr = db.repTransfers.find((t) => t.id === transferId);
    if (!tr) throw new AppError(404, 'طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND');
    if (tr.status === 'received') throw new AppError(409, 'تم تأكيد استلام التحويل مسبقًا ولا يمكن رفضه', 'ALREADY_RECEIVED');
    tr.status = 'rejected';
    tr.rejectedAt = now;
    tr.rejectionReason = cleanReason;
    tr.auditTrail = [...(tr.auditTrail || []), { timestamp: now, action: 'رفض طلب التحويل', user: actor.fullName, note: cleanReason }];
  });
  return { ok: true };
}

export async function ensureRepVanWarehouse(repName, actor) {
  const name = `سيارة المندوب - ${repName}`;
  if (await isPgMode()) {
    const existing = await getPool().query('SELECT * FROM warehouses WHERE name = $1 LIMIT 1', [name]);
    if (existing.rows[0]) {
      const w = existing.rows[0];
      return { id: w.id, name: w.name, code: w.code, location: w.location || '', isDefault: false, status: w.status };
    }
    return createWarehouse({ name, code: `VAN-${Date.now().toString().slice(-4)}`, location: 'مخزون سيارة مندوب', managerName: repName, isDefault: false }, actor);
  }
  const db = readJsonDatabase();
  const found = db.warehouses.find((w) => w.name === name);
  if (found) return found;
  return createWarehouse({ name, code: `VAN-${Date.now().toString().slice(-4)}`, location: 'مخزون سيارة مندوب', managerName: repName, isDefault: false }, actor);
}

export async function createRepItemTransfer(payload, actor) {
  const id = generateServerId('RTR');
  const requestNumber = `RTR-${Date.now().toString().slice(-5)}`;
  const now = nowIso();
  const dateStr = payload.date || todayIso();
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new AppError(400, 'يجب تحديد صنف واحد على الأقل للتحويل', 'EMPTY_ITEMS');

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO rep_item_transfers (id, request_number, date, representative_id, representative_name, invoice_id, invoice_number, source_warehouse_id, source_warehouse_name, target_warehouse_id, target_warehouse_name, status, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14)`,
        [
          id,
          requestNumber,
          dateStr,
          payload.representativeId,
          payload.representativeName,
          payload.invoiceId || null,
          payload.invoiceNumber || null,
          payload.sourceWarehouseId,
          payload.sourceWarehouseName,
          payload.targetWarehouseId,
          payload.targetWarehouseName,
          payload.notes || '',
          actor.fullName,
          now,
        ]
      );
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          `INSERT INTO rep_item_transfer_items (id, transfer_id, product_id, product_name, barcode, unit, requested_qty, available_in_van_qty, shortage_qty, approved_qty, executed_qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            `${id}-RITI-${i + 1}`,
            id,
            it.productId,
            it.productName,
            it.barcode || '',
            it.unit || 'قطعة',
            Number(it.requestedQty || 0),
            Number(it.availableInVanQty || 0),
            Number(it.shortageQty || 0),
            it.approvedQty ?? null,
            it.executedQty ?? null,
          ]
        );
      }
    });
    return { ...payload, id, requestNumber, date: dateStr, status: 'pending', createdBy: actor.fullName, createdAt: now };
  }

  return withJsonTransaction(async (db) => {
    const reqObj = { ...payload, id, requestNumber, date: dateStr, status: 'pending', createdBy: actor.fullName, createdAt: now };
    db.repItemTransfers.unshift(reqObj);
    return reqObj;
  });
}

export async function updateRepItemTransferStatus(requestId, { status, approvedItems, notes }, actor) {
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const rRes = await client.query('SELECT * FROM rep_item_transfers WHERE id = $1 FOR UPDATE', [requestId]);
      const req = rRes.rows[0];
      if (!req) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
      const itemsRes = await client.query('SELECT * FROM rep_item_transfer_items WHERE transfer_id = $1', [requestId]);

      if (status === 'executed' && req.status !== 'executed') {
        const stRes = await client.query('SELECT allow_negative_stock FROM system_settings LIMIT 1');
        const allowNeg = Boolean(stRes.rows[0]?.allow_negative_stock);
        const itemsToMove = approvedItems || itemsRes.rows.map((r) => ({ productId: r.product_id, productName: r.product_name, approvedQty: r.approved_qty, requestedQty: r.requested_qty }));

        for (const it of itemsToMove) {
          const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [it.productId]);
          const prod = pRes.rows[0];
          if (!prod) continue;
          const qty = Number(it.approvedQty || it.requestedQty || 0);
          const stockMap = { ...(prod.stock_per_warehouse || {}) };
          const srcQty = Number(stockMap[req.source_warehouse_id] || 0);
          const dstQty = Number(stockMap[req.target_warehouse_id] || 0);
          if (srcQty < qty && !allowNeg) {
            throw new AppError(409, `الرصيد المتاح من (${prod.name}) بالمصدر (${srcQty}) أقل من (${qty})`, 'INSUFFICIENT_STOCK');
          }
          stockMap[req.source_warehouse_id] = round3(srcQty - qty);
          stockMap[req.target_warehouse_id] = round3(dstQty + qty);
          await client.query('UPDATE products SET stock_per_warehouse = $1 WHERE id = $2', [JSON.stringify(stockMap), prod.id]);

          const mvId = generateServerId('SM');
          await client.query(
            `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, movement_type, quantity, unit_cost, related_doc_id, related_doc_number, notes, created_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'transfer_out',$10,$11,$12,$13,$14,$15,$16)`,
            [mvId, mvId, dateStr, prod.id, prod.name, req.source_warehouse_id, req.source_warehouse_name, req.target_warehouse_id, req.target_warehouse_name, qty, prod.purchase_price, req.id, req.request_number, `تحويل عهدة بضاعة للمندوب ${req.representative_name}`, actor.fullName, now]
          );
        }
      }

      await client.query(
        `UPDATE rep_item_transfers SET status = $1, notes = COALESCE(NULLIF($2, ''), notes), reviewed_by = $3, reviewed_at = $4, executed_at = CASE WHEN $1 = 'executed' THEN $4 ELSE executed_at END WHERE id = $5`,
        [status, notes || '', actor.fullName, now, requestId]
      );
    });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const req = db.repItemTransfers.find((r) => r.id === requestId);
    if (!req) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
    if (status === 'executed' && req.status !== 'executed') {
      const itemsToMove = approvedItems || req.items;
      for (const it of itemsToMove) {
        const prod = db.products.find((p) => p.id === it.productId);
        if (!prod) continue;
        const qty = Number(it.approvedQty || it.requestedQty || 0);
        const src = Number(prod.stockPerWarehouse[req.sourceWarehouseId] || 0);
        const dst = Number(prod.stockPerWarehouse[req.targetWarehouseId] || 0);
        if (src < qty && !db.settings?.allowNegativeStock) {
          throw new AppError(409, `الرصيد المتاح من (${prod.name}) بالمصدر (${src}) أقل من (${qty})`, 'INSUFFICIENT_STOCK');
        }
        prod.stockPerWarehouse[req.sourceWarehouseId] = round3(src - qty);
        prod.stockPerWarehouse[req.targetWarehouseId] = round3(dst + qty);
        db.stockMovements.unshift({
          id: generateServerId('SM'),
          date: dateStr,
          type: 'transfer_out',
          productId: prod.id,
          productName: prod.name,
          warehouseId: req.sourceWarehouseId,
          warehouseName: req.sourceWarehouseName,
          targetWarehouseId: req.targetWarehouseId,
          targetWarehouseName: req.targetWarehouseName,
          quantity: qty,
          unitCost: prod.purchasePrice,
          referenceId: req.id,
          referenceNumber: req.requestNumber,
          notes: `تحويل عهدة بضاعة للمندوب ${req.representativeName}`,
          createdBy: actor.fullName,
          createdAt: now,
        });
      }
    }
    req.status = status;
    if (notes) req.notes = notes;
    req.reviewedBy = actor.fullName;
    req.reviewedAt = now;
    if (status === 'executed') req.executedAt = now;
    if (approvedItems) req.items = approvedItems;
  });
  return { ok: true };
}

// ==============================================================================
// Users CRUD (bcrypt enforced, passwordHash NEVER returned)
// ==============================================================================

export async function createAdminUser(payload, actor) {
  const username = String(payload.username || '').trim();
  const fullName = String(payload.fullName || '').trim();
  const password = String(payload.password || '');
  if (!username || username.length < 3) throw new AppError(400, 'اسم المستخدم يجب أن لا يقل عن 3 أحرف', 'INVALID_USERNAME');
  if (!fullName) throw new AppError(400, 'الاسم الكامل مطلوب', 'INVALID_NAME');
  if (!password || password.length < 6) throw new AppError(400, 'كلمة المرور يجب أن لا تقل عن 6 أحرف', 'WEAK_PASSWORD');

  const passwordHash = await hashPasswordBcrypt(password);
  const id = generateServerId('USR');
  const now = nowIso();

  if (await isPgMode()) {
    const user = await withTransaction(async (client) => {
      const dup = await client.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
      if (dup.rows[0]) throw new AppError(409, 'اسم المستخدم مسجل مسبقًا', 'DUPLICATE_USERNAME');
      await client.query(
        `INSERT INTO users (id, full_name, username, password_hash, password_algo, phone, address, notes, role, job_title, department, is_active, must_change_password, permissions, created_at)
         VALUES ($1,$2,$3,$4,'bcrypt',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          fullName,
          username,
          passwordHash,
          payload.phone || '',
          payload.address || '',
          payload.notes || '',
          payload.role || 'sales',
          payload.jobTitle || '',
          payload.department || '',
          payload.isActive ?? true,
          Boolean(payload.mustChangePassword),
          JSON.stringify(payload.permissions || {}),
          now,
        ]
      );
      if (payload.linkedCustomerId && payload.role === 'customer') {
        const dupLink = await client.query('SELECT id FROM customers WHERE user_id = $1 LIMIT 1', [id]);
        if (!dupLink.rows[0]) {
          await client.query('UPDATE customers SET user_id = $1 WHERE id = $2', [id, payload.linkedCustomerId]);
        }
      }
      const r = await client.query('SELECT * FROM users WHERE id = $1', [id]);
      return sanitizeUser(mapPgUserRow(r.rows[0]));
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء حساب مستخدم (${username})`, module: 'المستخدمون', recordId: id });
    return user;
  }

  const user = await withJsonTransaction(async (db) => {
    if (db.users.some((u) => String(u.username || '').toLowerCase() === username.toLowerCase())) {
      throw new AppError(409, 'اسم المستخدم مسجل مسبقًا', 'DUPLICATE_USERNAME');
    }
    const newUser = {
      id,
      fullName,
      username,
      passwordHash,
      passwordAlgo: 'bcrypt',
      phone: payload.phone || '',
      address: payload.address || '',
      notes: payload.notes || '',
      role: payload.role || 'sales',
      jobTitle: payload.jobTitle || '',
      department: payload.department || '',
      isActive: payload.isActive ?? true,
      mustChangePassword: Boolean(payload.mustChangePassword),
      permissions: payload.permissions || {},
      createdAt: now,
    };
    db.users.push(newUser);
    if (payload.linkedCustomerId && payload.role === 'customer') {
      const cust = db.customers.find((c) => c.id === payload.linkedCustomerId);
      if (cust) cust.userId = id;
    }
    return sanitizeUser(newUser);
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء حساب مستخدم (${username})`, module: 'المستخدمون', recordId: id });
  return user;
}

export async function updateAdminUser(userId, updates, actor) {
  const now = nowIso();
  const nextPasswordHash = updates.newPassword && String(updates.newPassword).length >= 6 ? await hashPasswordBcrypt(updates.newPassword) : null;

  if (await isPgMode()) {
    const user = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!r.rows[0]) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
      const cur = r.rows[0];
      await client.query(
        `UPDATE users SET full_name = $1, phone = $2, address = $3, notes = $4, role = $5, job_title = $6, department = $7, is_active = $8, must_change_password = $9, permissions = $10, updated_at = $11 WHERE id = $12`,
        [
          updates.fullName ?? cur.full_name,
          updates.phone ?? cur.phone,
          updates.address ?? cur.address,
          updates.notes ?? cur.notes,
          updates.role ?? cur.role,
          updates.jobTitle ?? cur.job_title,
          updates.department ?? cur.department,
          updates.isActive ?? cur.is_active,
          updates.mustChangePassword ?? cur.must_change_password,
          JSON.stringify(updates.permissions ?? cur.permissions ?? {}),
          now,
          userId,
        ]
      );
      if (nextPasswordHash) {
        await client.query(`UPDATE users SET password_hash = $1, password_algo = 'bcrypt' WHERE id = $2`, [nextPasswordHash, userId]);
      }
      if (updates.isActive === false) {
        await client.query(`UPDATE user_sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`, [now, userId]);
      }
      const next = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
      return sanitizeUser(mapPgUserRow(next.rows[0]));
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث حساب مستخدم (${user.username})`, module: 'المستخدمون', recordId: userId });
    return user;
  }

  const user = await withJsonTransaction(async (db) => {
    const idx = db.users.findIndex((u) => u.id === userId);
    if (idx === -1) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
    const cur = db.users[idx];
    const { newPassword, passwordHash: _ignoredHash, ...rest } = updates;
    db.users[idx] = {
      ...cur,
      ...rest,
      id: cur.id,
      passwordHash: nextPasswordHash || cur.passwordHash,
      passwordAlgo: nextPasswordHash ? 'bcrypt' : cur.passwordAlgo,
    };
    return sanitizeUser(db.users[idx]);
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث حساب مستخدم (${user.username})`, module: 'المستخدمون', recordId: userId });
  return user;
}

export async function deleteAdminUser(userId, actor) {
  if (userId === actor.id) throw new AppError(400, 'لا يمكنك حذف حسابك النشط حاليًا', 'CANNOT_DELETE_SELF');

  if (await isPgMode()) {
    const uname = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!r.rows[0]) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
      if (r.rows[0].role === 'admin') {
        const cntRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role = 'admin' AND is_active = TRUE`);
        if (Number(cntRes.rows[0]?.cnt || 0) <= 1) {
          throw new AppError(409, 'لا يمكن حذف آخر حساب مدير عام نشط في النظام', 'LAST_ADMIN');
        }
      }
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      return r.rows[0].username;
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مستخدم (${uname})`, module: 'المستخدمون', recordId: userId });
    return { ok: true };
  }

  const uname = await withJsonTransaction(async (db) => {
    const target = db.users.find((u) => u.id === userId);
    if (!target) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
    if (target.role === 'admin' && db.users.filter((u) => u.role === 'admin' && u.isActive).length <= 1) {
      throw new AppError(409, 'لا يمكن حذف آخر حساب مدير عام نشط في النظام', 'LAST_ADMIN');
    }
    db.customers = db.customers.map((c) => (c.userId === userId ? { ...c, userId: undefined } : c));
    db.users = db.users.filter((u) => u.id !== userId);
    return target.username;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مستخدم (${uname})`, module: 'المستخدمون', recordId: userId });
  return { ok: true };
}

// ==============================================================================
// Suppliers, Cashboxes, Expenses, Cheques, Installments, HR, Reps, Settings
// ==============================================================================

export async function createSupplier(payload, actor) {
  const id = generateServerId('SUPP');
  const code = String(payload.code || `S-${Date.now().toString().slice(-5)}`).trim();
  const opening = round2(payload.openingBalance || 0);
  const now = nowIso();
  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO suppliers (id, code, name, phone, address, opening_balance, current_balance, notes, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
      [id, code, payload.name, payload.phone || '', payload.address || '', opening, payload.notes || '', payload.status || 'active', now]
    );
  } else {
    await withJsonTransaction((db) => {
      db.suppliers.unshift({ ...payload, id, code, openingBalance: opening, currentBalance: opening, createdAt: now });
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة مورد (${payload.name})`, module: 'الموردون', recordId: id });
  return { ...payload, id, code, openingBalance: opening, currentBalance: opening, createdAt: now };
}

export async function updateSupplier(id, updates, actor) {
  if (await isPgMode()) {
    await getPool().query(
      `UPDATE suppliers SET name = COALESCE($1, name), phone = COALESCE($2, phone), address = COALESCE($3, address), notes = COALESCE($4, notes), status = COALESCE($5, status) WHERE id = $6`,
      [updates.name ?? null, updates.phone ?? null, updates.address ?? null, updates.notes ?? null, updates.status ?? null, id]
    );
  } else {
    await withJsonTransaction((db) => {
      db.suppliers = db.suppliers.map((s) => (s.id === id ? { ...s, ...updates, id } : s));
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث مورد`, module: 'الموردون', recordId: id });
  return { ok: true };
}

export async function deleteSupplier(id, actor) {
  if (await isPgMode()) {
    const used = await getPool().query('SELECT id FROM invoices WHERE supplier_id = $1 LIMIT 1', [id]);
    if (used.rows[0]) throw new AppError(409, 'لا يمكن حذف مورد مرتبط بفواتير مشتريات', 'SUPPLIER_IN_USE');
    await getPool().query('DELETE FROM suppliers WHERE id = $1', [id]);
  } else {
    await withJsonTransaction((db) => {
      if (db.invoices.some((i) => i.supplierId === id)) throw new AppError(409, 'لا يمكن حذف مورد مرتبط بفواتير', 'SUPPLIER_IN_USE');
      db.suppliers = db.suppliers.filter((s) => s.id !== id);
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مورد`, module: 'الموردون', recordId: id });
  return { ok: true };
}

export async function recordSupplierPayment({ supplierId, amount, cashboxId, notes = '', date }, actor) {
  const payAmount = round2(amount);
  if (payAmount <= 0) throw new AppError(400, 'المبلغ يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const txDate = date || todayIso();
  const txId = generateServerId('FT');
  const txNo = `TRX-${Date.now().toString().slice(-6)}`;

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const sRes = await client.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
      if (!sRes.rows[0]) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');
      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const nextSupp = round2(Number(sRes.rows[0].current_balance || 0) - payAmount);
      const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) - payAmount);
      await client.query('UPDATE suppliers SET current_balance = $1 WHERE id = $2', [nextSupp, supplierId]);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, cashboxId]);
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, description, notes, created_by, created_at)
         VALUES ($1,$2,$3,'supplier_payment',$4,$5,$6,$7,'سداد لمورد',$8,$9,$10,$11,$12,$13)`,
        [txId, txNo, txDate, payAmount, cbRes.rows[0].id, cbRes.rows[0].name, nextCb, supplierId, sRes.rows[0].name, `سداد للمورد ${sRes.rows[0].name}`, notes, actor.fullName, now]
      );
    });
    return { ok: true };
  }

  await withJsonTransaction((db) => {
    const supp = db.suppliers.find((s) => s.id === supplierId);
    const cb = db.cashboxes.find((c) => c.id === cashboxId);
    if (!supp || !cb) throw new AppError(404, 'المورد أو الخزينة غير موجودة', 'NOT_FOUND');
    supp.currentBalance = round2(supp.currentBalance - payAmount);
    cb.currentBalance = round2(cb.currentBalance - payAmount);
    db.financialTransactions.unshift({
      id: txId,
      transactionNumber: txNo,
      date: txDate,
      type: 'supplier_payment',
      cashboxId: cb.id,
      cashboxName: cb.name,
      amount: payAmount,
      category: 'سداد لمورد',
      partyId: supp.id,
      partyName: supp.name,
      description: `سداد للمورد ${supp.name}`,
      notes,
      createdBy: actor.fullName,
      createdAt: now,
    });
  });
  return { ok: true };
}

export async function createCashbox(payload, actor) {
  const id = generateServerId(payload.type === 'bank' ? 'BANK' : 'CASH');
  const opening = round2(payload.openingBalance || 0);
  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO cashboxes (id, name, type, opening_balance, current_balance, is_default) VALUES ($1,$2,$3,$4,$4,$5)`,
      [id, payload.name, payload.type || 'cashbox', opening, Boolean(payload.isDefault)]
    );
  } else {
    await withJsonTransaction((db) => {
      db.cashboxes.push({ ...payload, id, openingBalance: opening, currentBalance: opening });
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة خزينة/حساب (${payload.name})`, module: 'المالية', recordId: id });
  return { ...payload, id, openingBalance: opening, currentBalance: opening };
}

export async function updateCashbox(id, updates, actor) {
  if (await isPgMode()) {
    await getPool().query(
      `UPDATE cashboxes SET name = COALESCE($1, name), type = COALESCE($2, type), is_default = COALESCE($3, is_default) WHERE id = $4`,
      [updates.name ?? null, updates.type ?? null, updates.isDefault ?? null, id]
    );
  } else {
    await withJsonTransaction((db) => {
      db.cashboxes = db.cashboxes.map((c) => (c.id === id ? { ...c, ...updates, id, currentBalance: c.currentBalance } : c));
    });
  }
  return { ok: true };
}

export async function transferCashbox({ fromId, toId, amount, notes = '' }, actor) {
  const amt = round2(amount);
  if (amt <= 0 || fromId === toId) throw new AppError(400, 'بيانات التحويل غير صالحة', 'INVALID_TRANSFER');
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const fRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [fromId]);
      const tRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [toId]);
      if (!fRes.rows[0] || !tRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const nextF = round2(Number(fRes.rows[0].current_balance || 0) - amt);
      const nextT = round2(Number(tRes.rows[0].current_balance || 0) + amt);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextF, fromId]);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextT, toId]);
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, description, notes, created_by, created_at)
         VALUES ($1,$2,$3,'transfer',$4,$5,$6,$7,'تحويل داخلي',$8,$9,$10,$11)`,
        [generateServerId('FT'), `TRN-${Date.now().toString().slice(-6)}`, dateStr, amt, fromId, fRes.rows[0].name, nextF, `تحويل من ${fRes.rows[0].name} إلى ${tRes.rows[0].name}`, notes, actor.fullName, now]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      const f = db.cashboxes.find((c) => c.id === fromId);
      const t = db.cashboxes.find((c) => c.id === toId);
      if (!f || !t) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      f.currentBalance = round2(f.currentBalance - amt);
      t.currentBalance = round2(t.currentBalance + amt);
      db.financialTransactions.unshift({
        id: generateServerId('FT'),
        transactionNumber: `TRN-${Date.now().toString().slice(-6)}`,
        date: dateStr,
        type: 'transfer',
        cashboxId: f.id,
        cashboxName: f.name,
        targetCashboxId: t.id,
        targetCashboxName: t.name,
        amount: amt,
        category: 'تحويل داخلي',
        description: `تحويل من ${f.name} إلى ${t.name}`,
        notes,
        createdBy: actor.fullName,
        createdAt: now,
      });
    });
  }
  return { ok: true };
}

export async function addExpenseOrIncome(payload, actor) {
  const amt = round2(payload.amount);
  if (amt <= 0) throw new AppError(400, 'المبلغ يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const id = generateServerId('EXP');
  const recordNumber = `${payload.type === 'expense' ? 'EXP' : 'INC'}-${Date.now().toString().slice(-6)}`;
  const dateStr = payload.date || todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [payload.cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const nextCb = payload.type === 'expense' ? round2(Number(cbRes.rows[0].current_balance || 0) - amt) : round2(Number(cbRes.rows[0].current_balance || 0) + amt);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, cbRes.rows[0].id]);
      await client.query(
        `INSERT INTO expenses_incomes (id, voucher_number, type, category, amount, date, cashbox_id, cashbox_name, payment_method, recipient_or_payer, attachment_name, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, recordNumber, payload.type, payload.category, amt, dateStr, cbRes.rows[0].id, cbRes.rows[0].name, payload.paymentMethod || 'cash', payload.recipientOrPayer || '', payload.attachmentName || null, payload.notes || '', actor.fullName, now]
      );
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_doc_id, related_doc_number, description, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [generateServerId('FT'), `TRX-${Date.now().toString().slice(-6)}`, dateStr, payload.type, amt, cbRes.rows[0].id, cbRes.rows[0].name, nextCb, payload.category, id, recordNumber, `${payload.type === 'expense' ? 'سند صرف' : 'سند قبض'}: ${payload.category}`, payload.notes || '', actor.fullName, now]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      const cb = db.cashboxes.find((c) => c.id === payload.cashboxId);
      if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      cb.currentBalance = payload.type === 'expense' ? round2(cb.currentBalance - amt) : round2(cb.currentBalance + amt);
      db.expenseIncomes.unshift({ ...payload, id, recordNumber, date: dateStr, cashboxName: cb.name, amount: amt, createdBy: actor.fullName, createdAt: now });
      db.financialTransactions.unshift({
        id: generateServerId('FT'),
        transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
        date: dateStr,
        type: payload.type,
        cashboxId: cb.id,
        cashboxName: cb.name,
        amount: amt,
        category: payload.category,
        relatedDocId: id,
        relatedDocNumber: recordNumber,
        description: `${payload.type === 'expense' ? 'سند صرف' : 'سند قبض'}: ${payload.category}`,
        notes: payload.notes || '',
        createdBy: actor.fullName,
        createdAt: now,
      });
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `${payload.type === 'expense' ? 'سند صرف' : 'سند قبض'} (${amt})`, module: 'المالية', recordId: id });
  return { ...payload, id, recordNumber, date: dateStr, amount: amt, createdBy: actor.fullName, createdAt: now };
}

export async function addCheque(payload, actor) {
  const id = generateServerId('CHQ');
  const now = nowIso();
  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO cheques (id, cheque_number, type, bank_name, amount, issue_date, due_date, party_type, party_id, party_name, status, cashbox_id, notes, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, payload.chequeNumber, payload.type, payload.bankName, round2(payload.amount), payload.issueDate, payload.dueDate, payload.type === 'incoming' ? 'customer' : 'supplier', payload.partyId || '', payload.partyName, payload.status || 'new', payload.cashboxId || null, payload.notes || '', actor.fullName, now]
    );
  } else {
    await withJsonTransaction((db) => {
      db.cheques.unshift({ ...payload, id, createdAt: now });
    });
  }
  return { ...payload, id, createdAt: now };
}

export async function updateChequeStatus(id, { status, cashboxId }, actor) {
  const now = nowIso();
  const dateStr = todayIso();
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const chRes = await client.query('SELECT * FROM cheques WHERE id = $1 FOR UPDATE', [id]);
      const ch = chRes.rows[0];
      if (!ch) throw new AppError(404, 'الشيك غير موجود', 'NOT_FOUND');
      const targetCb = cashboxId || ch.cashbox_id;
      if (status === 'collected' && ch.status !== 'collected' && targetCb) {
        const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [targetCb]);
        if (cbRes.rows[0]) {
          const amt = Number(ch.amount || 0);
          const nextCb = ch.type === 'incoming' ? round2(Number(cbRes.rows[0].current_balance) + amt) : round2(Number(cbRes.rows[0].current_balance) - amt);
          await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, targetCb]);
          await client.query(
            `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_name, description, created_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'تحصيل/صرف شيك',$9,$10,$11,$12)`,
            [generateServerId('FT'), `CHQ-${Date.now().toString().slice(-6)}`, dateStr, ch.type === 'incoming' ? 'customer_payment' : 'supplier_payment', amt, targetCb, cbRes.rows[0].name, nextCb, ch.party_name, `تحصيل/صرف شيك رقم ${ch.cheque_number}`, actor.fullName, now]
          );
        }
      }
      await client.query('UPDATE cheques SET status = $1, cashbox_id = COALESCE($2, cashbox_id) WHERE id = $3', [status, targetCb, id]);
    });
  } else {
    await withJsonTransaction((db) => {
      const ch = db.cheques.find((c) => c.id === id);
      if (!ch) throw new AppError(404, 'الشيك غير موجود', 'NOT_FOUND');
      const targetCb = cashboxId || ch.cashboxId;
      if (status === 'collected' && ch.status !== 'collected' && targetCb) {
        const cb = db.cashboxes.find((c) => c.id === targetCb);
        if (cb) {
          cb.currentBalance = ch.type === 'incoming' ? round2(cb.currentBalance + ch.amount) : round2(cb.currentBalance - ch.amount);
          db.financialTransactions.unshift({
            id: generateServerId('FT'),
            transactionNumber: `CHQ-${Date.now().toString().slice(-6)}`,
            date: dateStr,
            type: ch.type === 'incoming' ? 'customer_payment' : 'supplier_payment',
            cashboxId: cb.id,
            cashboxName: cb.name,
            amount: ch.amount,
            category: 'تحصيل/صرف شيك',
            partyName: ch.partyName,
            description: `تحصيل/صرف شيك رقم ${ch.chequeNumber}`,
            createdBy: actor.fullName,
            createdAt: now,
          });
        }
      }
      ch.status = status;
      if (targetCb) ch.cashboxId = targetCb;
    });
  }
  return { ok: true };
}

export async function addInstallmentSchedule(payload, actor) {
  const id = generateServerId('INST');
  const scheduleNumber = `INS-${Date.now().toString().slice(-6)}`;
  const now = nowIso();
  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO installments (id, schedule_number, customer_id, customer_name, invoice_id, invoice_number, total_amount, paid_amount, remaining_amount, number_of_installments, installments_data, notes, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, scheduleNumber, payload.customerId, payload.customerName, payload.invoiceId || null, payload.invoiceNumber || '', round2(payload.totalAmount), round2(payload.paidAmount || 0), round2(payload.remainingAmount), (payload.items || []).length || 1, JSON.stringify(payload.items || []), payload.notes || '', actor.fullName, now]
    );
  } else {
    await withJsonTransaction((db) => {
      db.installments.unshift({ ...payload, id, scheduleNumber, createdAt: now });
    });
  }
  return { ...payload, id, scheduleNumber, createdAt: now };
}

export async function payInstallment({ scheduleId, installmentItemId, amount, cashboxId, notes = '' }, actor) {
  const amt = round2(amount);
  if (amt <= 0) throw new AppError(400, 'المبلغ يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const sRes = await client.query('SELECT * FROM installments WHERE id = $1 FOR UPDATE', [scheduleId]);
      const sched = sRes.rows[0];
      if (!sched) throw new AppError(404, 'جدول الأقساط غير موجود', 'NOT_FOUND');
      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');

      const items = (sched.installments_data || []).map((item) => {
        if (item.id === installmentItemId) {
          const newPaid = round2(Number(item.paidAmount || 0) + amt);
          const isPaid = newPaid >= Number(item.amount || 0);
          return { ...item, paidAmount: newPaid, status: isPaid ? 'paid' : 'pending', paidDate: isPaid ? dateStr : item.paidDate };
        }
        return item;
      });
      const newPaidTotal = round2(Number(sched.paid_amount || 0) + amt);
      const newRem = round2(Math.max(0, Number(sched.total_amount || 0) - newPaidTotal));
      await client.query(`UPDATE installments SET paid_amount = $1, remaining_amount = $2, installments_data = $3 WHERE id = $4`, [
        newPaidTotal,
        newRem,
        JSON.stringify(items),
        scheduleId,
      ]);

      const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) + amt);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, cashboxId]);
      await client.query('UPDATE customers SET current_balance = current_balance - $1 WHERE id = $2', [amt, sched.customer_id]);
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, description, notes, created_by, created_at)
         VALUES ($1,$2,$3,'customer_payment',$4,$5,$6,$7,'سداد قسط',$8,$9,$10,$11,$12,$13)`,
        [generateServerId('FT'), `TRX-${Date.now().toString().slice(-6)}`, dateStr, amt, cashboxId, cbRes.rows[0].name, nextCb, sched.customer_id, sched.customer_name, `سداد قسط ${sched.schedule_number}`, notes, actor.fullName, now]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      const sched = db.installments.find((s) => s.id === scheduleId);
      const cb = db.cashboxes.find((c) => c.id === cashboxId);
      if (!sched || !cb) throw new AppError(404, 'البيانات غير موجودة', 'NOT_FOUND');
      sched.items = sched.items.map((item) => {
        if (item.id === installmentItemId) {
          const newPaid = round2(item.paidAmount + amt);
          const isPaid = newPaid >= item.amount;
          return { ...item, paidAmount: newPaid, status: isPaid ? 'paid' : 'pending', paidDate: isPaid ? dateStr : item.paidDate };
        }
        return item;
      });
      sched.paidAmount = round2(sched.paidAmount + amt);
      sched.remainingAmount = round2(Math.max(0, sched.totalAmount - sched.paidAmount));
      cb.currentBalance = round2(cb.currentBalance + amt);
      const cust = db.customers.find((c) => c.id === sched.customerId);
      if (cust) cust.currentBalance = round2(cust.currentBalance - amt);
      db.financialTransactions.unshift({
        id: generateServerId('FT'),
        transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
        date: dateStr,
        type: 'customer_payment',
        cashboxId: cb.id,
        cashboxName: cb.name,
        amount: amt,
        category: 'سداد قسط',
        partyId: sched.customerId,
        partyName: sched.customerName,
        description: `سداد قسط ${sched.scheduleNumber}`,
        notes,
        createdBy: actor.fullName,
        createdAt: now,
      });
    });
  }
  return { ok: true };
}

export async function addRepresentative(payload, actor) {
  const id = generateServerId('REP');
  const opening = round2(payload.openingBalance || 0);
  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO representatives (id, user_id, name, phone, vehicle_number, opening_balance, current_balance, commission_rate, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
      [id, payload.userId || null, payload.name, payload.phone || '', payload.vehicleNumber || '', opening, Number(payload.commissionRate || 0), payload.notes || '', payload.status || 'active']
    );
  } else {
    await withJsonTransaction((db) => {
      db.representatives.push({ ...payload, id, openingBalance: opening, currentBalance: opening });
    });
  }
  return { ...payload, id, openingBalance: opening, currentBalance: opening };
}

export async function updateRepresentative(id, updates) {
  if (await isPgMode()) {
    await getPool().query(
      `UPDATE representatives SET name = COALESCE($1, name), phone = COALESCE($2, phone), vehicle_number = COALESCE($3, vehicle_number), commission_rate = COALESCE($4, commission_rate), status = COALESCE($5, status), user_id = COALESCE($6, user_id) WHERE id = $7`,
      [updates.name ?? null, updates.phone ?? null, updates.vehicleNumber ?? null, updates.commissionRate ?? null, updates.status ?? null, updates.userId ?? null, id]
    );
  } else {
    await withJsonTransaction((db) => {
      db.representatives = db.representatives.map((r) => (r.id === id ? { ...r, ...updates, id } : r));
    });
  }
  return { ok: true };
}

// HR: Employees, Advances, Attendance, Payrolls
export async function addEmployee(payload) {
  const id = generateServerId('EMP');
  const code = String(payload.code || `E-${Date.now().toString().slice(-4)}`).trim();
  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO employees (id, code, full_name, job_title, department, phone, national_id, hire_date, basic_salary, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, code, payload.name, payload.jobTitle, payload.department || '', payload.phone || '', payload.nationalId || '', payload.hireDate || todayIso(), round2(payload.basicSalary), payload.status || 'active', payload.notes || '']
    );
  } else {
    await withJsonTransaction((db) => {
      db.employees.unshift({ ...payload, id, code });
    });
  }
  return { ...payload, id, code };
}

export async function updateEmployee(id, updates) {
  if (await isPgMode()) {
    await getPool().query(
      `UPDATE employees SET full_name = COALESCE($1, full_name), job_title = COALESCE($2, job_title), department = COALESCE($3, department), phone = COALESCE($4, phone), basic_salary = COALESCE($5, basic_salary), status = COALESCE($6, status) WHERE id = $7`,
      [updates.name ?? null, updates.jobTitle ?? null, updates.department ?? null, updates.phone ?? null, updates.basicSalary ?? null, updates.status ?? null, id]
    );
  } else {
    await withJsonTransaction((db) => {
      db.employees = db.employees.map((e) => (e.id === id ? { ...e, ...updates, id } : e));
    });
  }
  return { ok: true };
}

export async function addAdvanceDeduction(payload, actor) {
  const id = generateServerId('ADV');
  const amt = round2(payload.amount);
  const now = nowIso();
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO advances_deductions (id, employee_id, employee_name, type, amount, date, reason, cashbox_id, is_settled, status, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11)`,
        [id, payload.employeeId, payload.employeeName, payload.type, amt, payload.date || todayIso(), payload.reason || '', payload.cashboxId || null, Boolean(payload.isSettled), actor.fullName, now]
      );
      if (payload.type === 'advance' && payload.cashboxId) {
        await client.query('UPDATE cashboxes SET current_balance = current_balance - $1 WHERE id = $2', [amt, payload.cashboxId]);
      }
    });
  } else {
    await withJsonTransaction((db) => {
      db.advancesDeductions.unshift({ ...payload, id, amount: amt, createdAt: now });
      if (payload.type === 'advance' && payload.cashboxId) {
        const cb = db.cashboxes.find((c) => c.id === payload.cashboxId);
        if (cb) cb.currentBalance = round2(cb.currentBalance - amt);
      }
    });
  }
  return { ...payload, id, amount: amt, createdAt: now };
}

export async function recordAttendance(payload, actor) {
  const id = generateServerId('ATT');
  const dateStr = payload.date || todayIso();
  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO attendance (id, employee_id, employee_name, date, status, check_in_time, check_out_time, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, payload.employeeId, payload.employeeName, dateStr, payload.status, payload.checkIn || null, payload.checkOut || null, payload.notes || '', actor.fullName]
    );
  } else {
    await withJsonTransaction((db) => {
      db.attendance.unshift({ ...payload, id, date: dateStr });
    });
  }
  return { ...payload, id, date: dateStr };
}

export async function issuePayroll(payload, actor) {
  const id = generateServerId('PAYR');
  const payrollNumber = `SAL-${payload.year}-${String(payload.month).padStart(2, '0')}-${Date.now().toString().slice(-4)}`;
  const net = round2(payload.netSalary);
  const now = nowIso();
  const dateStr = payload.paidDate || todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO payrolls (id, payroll_number, month, year, employee_id, employee_name, basic_salary, allowances, deductions, advances, net_salary, payment_status, payment_date, cashbox_id, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'paid',$12,$13,$14,$15,$16)`,
        [id, payrollNumber, String(payload.month), Number(payload.year), payload.employeeId, payload.employeeName, round2(payload.basicSalary), round2(payload.bonusesTotal || 0), round2(payload.deductionsTotal || 0), round2(payload.advancesTotal || 0), net, dateStr, payload.cashboxId || null, payload.notes || '', actor.fullName, now]
      );
      if (payload.cashboxId) {
        const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [payload.cashboxId]);
        if (cbRes.rows[0]) {
          const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) - net);
          await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, payload.cashboxId]);
          await client.query(
            `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, created_by, created_at)
             VALUES ($1,$2,$3,'salary_payout',$4,$5,$6,$7,'صرف رواتب',$8,'salary',$9,$10,$11,$12,$13)`,
            [generateServerId('FT'), `PAY-${Date.now().toString().slice(-6)}`, dateStr, net, cbRes.rows[0].id, cbRes.rows[0].name, nextCb, payload.employeeName, id, payrollNumber, `صرف راتب الموظف ${payload.employeeName}`, actor.fullName, now]
          );
        }
      }
      await client.query(`UPDATE advances_deductions SET is_settled = TRUE WHERE employee_id = $1 AND is_settled = FALSE`, [payload.employeeId]);
    });
  } else {
    await withJsonTransaction((db) => {
      db.payrolls.unshift({ ...payload, id, payrollNumber, status: 'paid', paidDate: dateStr });
      if (payload.cashboxId) {
        const cb = db.cashboxes.find((c) => c.id === payload.cashboxId);
        if (cb) {
          cb.currentBalance = round2(cb.currentBalance - net);
          db.financialTransactions.unshift({
            id: generateServerId('FT'),
            transactionNumber: `PAY-${Date.now().toString().slice(-6)}`,
            date: dateStr,
            type: 'salary_payout',
            cashboxId: cb.id,
            cashboxName: cb.name,
            amount: net,
            category: 'صرف رواتب',
            relatedDocType: 'salary',
            relatedDocId: id,
            relatedDocNumber: payrollNumber,
            partyName: payload.employeeName,
            description: `صرف راتب الموظف ${payload.employeeName}`,
            createdBy: actor.fullName,
            createdAt: now,
          });
        }
      }
      db.advancesDeductions.forEach((a) => {
        if (a.employeeId === payload.employeeId && !a.isSettled) a.isSettled = true;
      });
    });
  }
  return { ...payload, id, payrollNumber, status: 'paid', paidDate: dateStr };
}

export async function executeCashOperation(payload, actor, idempotencyKey = '') {
  const opType = String(payload.type || '').trim();
  const validTypes = ['cash_withdrawal', 'cash_deposit', 'cashbox_transfer', 'expense', 'profit_deposit'];
  if (!validTypes.includes(opType)) {
    throw new AppError(400, 'نوع العملية النقدية غير صالح', 'INVALID_CASH_OP');
  }

  const amt = round2(payload.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError(400, 'المبلغ يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  }

  const cashboxId = String(payload.cashboxId || '').trim();
  const targetCashboxId = String(payload.targetCashboxId || '').trim();
  if (!cashboxId) throw new AppError(400, 'يرجى تحديد الخزينة أو الحساب', 'CASHBOX_REQUIRED');
  if (opType === 'cashbox_transfer' && (!targetCashboxId || targetCashboxId === cashboxId)) {
    throw new AppError(400, 'يرجى تحديد خزينة وجهة مختلفة للترحيل', 'INVALID_TARGET_CASHBOX');
  }

  const dateStr = payload.date || todayIso();
  const notes = String(payload.notes || '').trim();
  const category = String(
    payload.category ||
      (opType === 'cash_withdrawal'
        ? 'سحب نقدي'
        : opType === 'cash_deposit'
        ? 'إيداع نقدي'
        : opType === 'cashbox_transfer'
        ? 'ترحيل بين الخزائن'
        : opType === 'profit_deposit'
        ? 'إيداع ربحي'
        : 'مصروفات تشغيل')
  ).trim();
  const recipientOrPayer = String(payload.recipientOrPayer || '').trim();
  const cleanIdem = idempotencyKey ? String(idempotencyKey).trim() : null;
  const now = nowIso();
  const ftId = generateServerId('FT');

  const txTypeMap = {
    cash_withdrawal: 'withdrawal',
    cash_deposit: 'deposit',
    cashbox_transfer: 'transfer',
    expense: 'expense',
    profit_deposit: 'income',
  };
  const finType = txTypeMap[opType];
  const isOutflow = opType === 'cash_withdrawal' || opType === 'cashbox_transfer' || opType === 'expense';

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      if (cleanIdem) {
        const dup = await client.query('SELECT response_json FROM idempotency_keys WHERE key_id = $1 LIMIT 1', [cleanIdem]);
        if (dup.rows[0]) {
          return { deduplicated: true, ...dup.rows[0].response_json };
        }
      }

      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [cashboxId]);
      const cb = cbRes.rows[0];
      if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');

      const curBal = Number(cb.current_balance || 0);
      if (isOutflow && curBal < amt) {
        throw new AppError(409, `الرصيد المتاح في (${cb.name}) هو ${curBal} ولا يكفي لتنفيذ عملية بقيمة ${amt}`, 'INSUFFICIENT_CASHBOX');
      }

      let targetCb = null;
      if (opType === 'cashbox_transfer') {
        const tRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [targetCashboxId]);
        targetCb = tRes.rows[0];
        if (!targetCb) throw new AppError(404, 'الخزينة الوجهة غير موجودة', 'CASHBOX_NOT_FOUND');
        const nextTargetBal = round2(Number(targetCb.current_balance || 0) + amt);
        await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextTargetBal, targetCashboxId]);
      }

      const nextBal = isOutflow ? round2(curBal - amt) : round2(curBal + amt);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextBal, cashboxId]);

      const seqRes = await client.query(`SELECT nextval('seq_cash_op_no') AS n`);
      const txNumber = `COP-${String(seqRes.rows[0].n).padStart(5, '0')}`;

      let expenseIncomeRecord = null;
      if (opType === 'expense' || opType === 'profit_deposit') {
        const expId = generateServerId('EXP');
        const voucherNo = `${opType === 'expense' ? 'EXP' : 'INC'}-${String(seqRes.rows[0].n).padStart(5, '0')}`;
        const expType = opType === 'expense' ? 'expense' : 'income';
        await client.query(
          `INSERT INTO expenses_incomes (id, voucher_number, type, category, amount, date, cashbox_id, cashbox_name, payment_method, recipient_or_payer, notes, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cash',$9,$10,$11,$12)`,
          [expId, voucherNo, expType, category, amt, dateStr, cb.id, cb.name, recipientOrPayer, notes, actor.fullName, now]
        );
        expenseIncomeRecord = {
          id: expId,
          recordNumber: voucherNo,
          type: expType,
          category,
          amount: amt,
          date: dateStr,
          cashboxId: cb.id,
          cashboxName: cb.name,
          paymentMethod: 'cash',
          recipientOrPayer,
          notes,
          createdBy: actor.fullName,
          createdAt: now,
        };
      }

      const desc =
        opType === 'cashbox_transfer'
          ? `ترحيل نقدي من ${cb.name} إلى ${targetCb.name}`
          : `${category}${recipientOrPayer ? ` - ${recipientOrPayer}` : ''}`;

      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_name, related_doc_id, related_doc_number, description, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          ftId, txNumber, dateStr, finType, amt, cb.id, cb.name, nextBal, category,
          recipientOrPayer || (targetCb ? targetCb.name : ''),
          expenseIncomeRecord?.id || null,
          expenseIncomeRecord?.recordNumber || txNumber,
          desc, notes, actor.fullName, now,
        ]
      );

      const transaction = {
        id: ftId,
        transactionNumber: txNumber,
        date: dateStr,
        type: finType,
        cashboxId: cb.id,
        cashboxName: cb.name,
        targetCashboxId: targetCb?.id,
        targetCashboxName: targetCb?.name,
        amount: amt,
        category,
        partyName: recipientOrPayer || undefined,
        description: desc,
        notes,
        createdBy: actor.fullName,
        createdAt: now,
      };
      const payloadOut = { deduplicated: false, transaction, expenseIncomeRecord };

      if (cleanIdem) {
        await client.query(
          `INSERT INTO idempotency_keys (key_id, user_id, endpoint, response_json) VALUES ($1,$2,'POST /api/admin/cash-operations',$3) ON CONFLICT (key_id) DO NOTHING`,
          [cleanIdem, actor.id, JSON.stringify({ transaction, expenseIncomeRecord })]
        );
      }
      return payloadOut;
    });

    if (!out.deduplicated) {
      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `${category} (${amt})`,
        module: 'التعاملات النقدية',
        recordId: out.transaction.id,
        notes: out.transaction.description,
      });
    }
    return out;
  }

  // JSON Ledger mode
  const out = await withJsonTransaction((db) => {
    if (cleanIdem) {
      const idemMap = readJsonIdempotency();
      if (idemMap[cleanIdem]) {
        return { deduplicated: true, ...idemMap[cleanIdem] };
      }
    }

    const cb = db.cashboxes.find((c) => c.id === cashboxId);
    if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
    const curBal = Number(cb.currentBalance || 0);
    if (isOutflow && curBal < amt) {
      throw new AppError(409, `الرصيد المتاح في (${cb.name}) هو ${curBal} ولا يكفي لتنفيذ عملية بقيمة ${amt}`, 'INSUFFICIENT_CASHBOX');
    }

    let targetCb = null;
    if (opType === 'cashbox_transfer') {
      targetCb = db.cashboxes.find((c) => c.id === targetCashboxId);
      if (!targetCb) throw new AppError(404, 'الخزينة الوجهة غير موجودة', 'CASHBOX_NOT_FOUND');
      targetCb.currentBalance = round2(Number(targetCb.currentBalance || 0) + amt);
    }
    cb.currentBalance = isOutflow ? round2(curBal - amt) : round2(curBal + amt);

    const seq = nextJsonSequence(db, 'cashOpNo', db.financialTransactions, 'transactionNumber', /^COP-(\d+)$/i);
    const txNumber = `COP-${String(seq).padStart(5, '0')}`;

    let expenseIncomeRecord = null;
    if (opType === 'expense' || opType === 'profit_deposit') {
      const expId = generateServerId('EXP');
      const voucherNo = `${opType === 'expense' ? 'EXP' : 'INC'}-${String(seq).padStart(5, '0')}`;
      expenseIncomeRecord = {
        id: expId,
        recordNumber: voucherNo,
        type: opType === 'expense' ? 'expense' : 'income',
        category,
        amount: amt,
        date: dateStr,
        cashboxId: cb.id,
        cashboxName: cb.name,
        paymentMethod: 'cash',
        recipientOrPayer,
        notes,
        createdBy: actor.fullName,
        createdAt: now,
      };
      db.expenseIncomes.unshift(expenseIncomeRecord);
    }

    const desc =
      opType === 'cashbox_transfer'
        ? `ترحيل نقدي من ${cb.name} إلى ${targetCb.name}`
        : `${category}${recipientOrPayer ? ` - ${recipientOrPayer}` : ''}`;

    const transaction = {
      id: ftId,
      transactionNumber: txNumber,
      date: dateStr,
      type: finType,
      cashboxId: cb.id,
      cashboxName: cb.name,
      targetCashboxId: targetCb?.id,
      targetCashboxName: targetCb?.name,
      amount: amt,
      category,
      relatedDocType: 'manual',
      relatedDocId: expenseIncomeRecord?.id,
      relatedDocNumber: expenseIncomeRecord?.recordNumber || txNumber,
      partyName: recipientOrPayer || undefined,
      description: desc,
      notes,
      createdBy: actor.fullName,
      createdAt: now,
    };
    db.financialTransactions.unshift(transaction);

    if (cleanIdem) {
      const idemMap = readJsonIdempotency();
      idemMap[cleanIdem] = { transaction, expenseIncomeRecord };
      writeJsonIdempotency(idemMap);
    }
    return { deduplicated: false, transaction, expenseIncomeRecord };
  });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `${category} (${amt})`,
      module: 'التعاملات النقدية',
      recordId: out.transaction.id,
      notes: out.transaction.description,
    });
  }
  return out;
}

export async function renameCategoryGlobal(categoryId, newName, actor) {
  const cleanName = String(newName || '').trim();
  if (!cleanName) throw new AppError(400, 'يرجى كتابة الاسم الجديد للتصنيف', 'INVALID_CATEGORY_NAME');

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const cRes = await client.query('SELECT * FROM product_categories WHERE id = $1 FOR UPDATE', [categoryId]);
      const cur = cRes.rows[0];
      if (!cur) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
      const oldName = cur.name;
      await client.query('UPDATE product_categories SET name = $1 WHERE id = $2', [cleanName, categoryId]);
      await client.query('UPDATE products SET category = $1 WHERE category_id = $2 OR category = $3', [cleanName, categoryId, oldName]);
      return { id: categoryId, oldName, newName: cleanName };
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تغيير اسم التصنيف (${out.oldName} ← ${out.newName})`,
      module: 'تصنيفات السلع',
      recordId: categoryId,
    });
    return out;
  }

  const out = await withJsonTransaction((db) => {
    const cat = db.categories.find((c) => c.id === categoryId);
    if (!cat) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
    const oldName = cat.name;
    cat.name = cleanName;
    db.products.forEach((p) => {
      if (p.categoryId === categoryId || p.category === oldName) {
        p.category = cleanName;
      }
    });
    return { id: categoryId, oldName, newName: cleanName };
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تغيير اسم التصنيف (${out.oldName} ← ${out.newName})`,
    module: 'تصنيفات السلع',
    recordId: categoryId,
  });
  return out;
}

export async function updateSystemSettings(updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM system_settings LIMIT 1');
      if (existing.rows[0]) {
        const cur = existing.rows[0];
        const mergedExtra = updates.extraSettings !== undefined
          ? { ...(cur.extra_settings || {}), ...(updates.extraSettings || {}) }
          : (cur.extra_settings || {});
        await client.query(
          `UPDATE system_settings SET company_name=$1, company_subtitle=$2, phone1=$3, phone2=$4, address=$5, commercial_registration=$6, tax_number=$7, currency=$8, default_print_mode=$9, invoice_notes=$10, allow_negative_stock=$11, extra_settings=$12, updated_at=$13 WHERE id=$14`,
          [
            updates.companyName ?? cur.company_name,
            updates.companySubtitle ?? cur.company_subtitle,
            updates.phone1 ?? cur.phone1,
            updates.phone2 ?? cur.phone2,
            updates.address ?? cur.address,
            updates.commercialRegistration ?? cur.commercial_registration,
            updates.taxNumber ?? cur.tax_number,
            updates.currency ?? cur.currency,
            updates.defaultPrintMode ?? cur.default_print_mode,
            updates.invoiceNotes ?? cur.invoice_notes,
            updates.allowNegativeStock ?? cur.allow_negative_stock,
            JSON.stringify(mergedExtra),
            now,
            cur.id,
          ]
        );
        return { ...updates, extraSettings: mergedExtra };
      } else {
        const extraSettings = updates.extraSettings || {};
        await client.query(
          `INSERT INTO system_settings (id, company_name, company_subtitle, phone1, phone2, address, commercial_registration, tax_number, currency, default_print_mode, invoice_notes, allow_negative_stock, extra_settings, updated_at)
           VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            updates.companyName || 'أولاد سليم',
            updates.companySubtitle || '',
            updates.phone1 || '',
            updates.phone2 || '',
            updates.address || '',
            updates.commercialRegistration || '',
            updates.taxNumber || '',
            updates.currency || 'ج.م',
            updates.defaultPrintMode || 'a4',
            updates.invoiceNotes || '',
            Boolean(updates.allowNegativeStock),
            JSON.stringify(extraSettings),
            now,
          ]
        );
        return { ...updates, extraSettings };
      }
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'تحديث إعدادات المؤسسة', module: 'الإعدادات' });
    return updated;
  }

  const updated = await withJsonTransaction((db) => {
    const mergedExtra = updates.extraSettings !== undefined
      ? { ...(db.settings.extraSettings || {}), ...(updates.extraSettings || {}) }
      : (db.settings.extraSettings || {});
    db.settings = { ...db.settings, ...updates, extraSettings: mergedExtra };
    return db.settings;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'تحديث إعدادات المؤسسة', module: 'الإعدادات' });
  return updated;
}

// ==============================================================================
// Backup Export & Safe Restore (Never loses pre-restore state)
// ==============================================================================

export async function exportFullBackup(actor) {
  if (await isPgMode()) {
    const pool = getPool();
    const full = await getStaffBootstrapData(actor);
    const uRes = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
    full.users = uRes.rows.map(mapPgUserRow);
    full.exportedAt = nowIso();
    full.version = '3.0.0';
    return full;
  }
  const db = readJsonDatabase();
  return {
    ...db,
    auditLogs: await listAuditLogs(2000),
    exportedAt: nowIso(),
    version: '3.0.0',
  };
}

export async function restoreFullBackup(backupData, actor) {
  if (!backupData || typeof backupData !== 'object' || !Array.isArray(backupData.users) || !Array.isArray(backupData.products)) {
    throw new AppError(400, 'ملف النسخة الاحتياطية غير صالح أو تالف', 'INVALID_BACKUP');
  }

  const { dataDir } = getDataPaths();
  const safetyFile = path.join(dataDir, `database.pre_restore.${Date.now()}.readonly.bak.json`);
  const currentSnapshot = await exportFullBackup(actor);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(safetyFile, JSON.stringify(currentSnapshot, null, 2), 'utf8');
  try { fs.chmodSync(safetyFile, 0o444); } catch {}

  if (await isPgMode()) {
    // Delegate structured transactional upsert/restore through migrator
    const { runDataMigration } = await import('../migrator.js');
    const res = await runDataMigration(backupData, actor.fullName, { skipBackupFile: true });
    if (!res.success) {
      throw new AppError(500, `فشل استعادة النسخة الاحتياطية: ${res.error}`, 'RESTORE_FAILED');
    }
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'استعادة نسخة احتياطية كاملة في PostgreSQL', module: 'النسخ الاحتياطي' });
    return { ok: true, safetyBackup: safetyFile, log: res.log };
  }

  await withJsonTransaction(() => {
    writeJsonDatabase(backupData);
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'استعادة نسخة احتياطية كاملة', module: 'النسخ الاحتياطي' });
  return { ok: true, safetyBackup: safetyFile };
}

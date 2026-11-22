import { getPool } from '../postgres.js';
import { readJsonDatabase } from '../jsonLedger.js';
import { round2, round3 } from '../../utils/errors.js';
import {
  isPgMode,
  isoDateOnly,
  isoTimestamp,
  mapPgProductRow,
  mapPgInvoiceRow,
} from './mode.js';
import { getRepresentativeByUserId, getSystemSettingsSafe } from './catalogStore.js';

export const REPORT_TYPES_LIST = [
  { key: 'all', label: 'الكل', group: 1 },
  { key: 'sales_items', label: 'اصناف البيع', group: 1 },
  { key: 'sales_invoices', label: 'فواتير بيع', group: 1 },
  { key: 'sales_items_by_unit', label: 'اصناف بيع/ بالوحدة', group: 1 },
  { key: 'sales_items_grouped', label: 'اصناف بيع/مَجمع', group: 1 },
  { key: 'sales_items_grouped_by_customer', label: 'اصناف بيع/مَجمع حسب العميل', group: 1 },
  { key: 'sales_items_grouped_by_category', label: 'اصناف بيع/مَجمع حسب المجموعة', group: 1 },
  { key: 'sales_items_grouped_by_category_class1', label: 'اصناف بيع/مَجمع حسب المجموعة وتصنيف 1', group: 1 },

  { key: 'sales_return_items', label: 'اصناف مرتجع بيع', group: 2 },
  { key: 'sales_return_invoices', label: 'فواتير مرتجع بيع', group: 2 },

  { key: 'purchase_items', label: 'اصناف شراء', group: 3 },
  { key: 'purchase_invoices', label: 'فواتير شراء', group: 3 },

  { key: 'purchase_return_items', label: 'اصناف مرتجع شراء', group: 4 },
  { key: 'purchase_return_invoices', label: 'فواتير مرتجع شراء', group: 4 },

  { key: 'damaged_items', label: 'اصناف تالف', group: 5 },
  { key: 'damaged_invoices', label: 'فواتير تالف', group: 5 },

  { key: 'cash_payment', label: 'سداد نقدى', group: 6 },
  { key: 'cash_payment_customer', label: 'سداد نقدى/عميل', group: 6 },
  { key: 'cash_payment_supplier', label: 'سداد نقدى/مورد', group: 6 },
  { key: 'cash_payment_employee', label: 'سداد نقدى/موظف', group: 6 },

  { key: 'cash_withdrawal', label: 'سحب نقدى', group: 7 },
  { key: 'cash_withdrawal_customer', label: 'سحب نقدى/عميل', group: 7 },
  { key: 'cash_withdrawal_supplier', label: 'سحب نقدى/مورد', group: 7 },
];

const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function formatActualDateTimeAr(rawIso, fallbackDate = '') {
  const source = rawIso || (fallbackDate ? `${fallbackDate}T00:00:00` : '');
  if (!source) return '-';
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) {
    return fallbackDate ? String(fallbackDate).replace(/-/g, '/') : String(rawIso);
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dayName = ARABIC_DAYS[d.getDay()];
  const hours24 = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const suffix = hours24 >= 12 ? 'م' : 'ص';
  const hours12 = hours24 % 12 || 12;
  return `${yyyy}/${mm}/${dd} - ${dayName} - ${String(hours12).padStart(2, '0')}:${mins} ${suffix}`;
}

export function formatBusinessDateSlash(dateStr) {
  if (!dateStr) return '-';
  return String(dateStr).split('T')[0].replace(/-/g, '/');
}

function normalizeClassification1(prod) {
  if (!prod) return 'بدون تصنيف 1';
  const parts = [prod.size, prod.color].map((v) => String(v || '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' - ') : 'بدون تصنيف 1';
}

function resolveUnitFactor(prod, unitName) {
  if (!prod || !unitName || unitName === prod.baseUnit) return 1;
  const u = (prod.units || []).find((x) => x.name === unitName);
  return u ? Number(u.conversionFactor || 1) : 1;
}

function calcProfitPctOnCost(profit, cost) {
  const p = Number(profit || 0);
  const c = Number(cost || 0);
  if (c > 0) return round2((p / c) * 100);
  if (p > 0) return 100;
  if (p < 0) return -100;
  return 0;
}

function calcMarginOnSales(profit, netSales) {
  const p = Number(profit || 0);
  const s = Number(netSales || 0);
  if (s > 0) return round2((p / s) * 100);
  return 0;
}

async function loadFullReportDataset(actor, filterHints = {}) {
  const settings = await getSystemSettingsSafe();
  const isRep = actor?.role === 'representative';
  const repProfile = isRep ? await getRepresentativeByUserId(actor.id) : null;

  if (await isPgMode()) {
    const pool = getPool();
    const hintDateFrom = filterHints.dateFrom ? String(filterHints.dateFrom).split('T')[0] : null;
    const hintDateTo = filterHints.dateTo ? String(filterHints.dateTo).split('T')[0] : null;
    const hintWh = filterHints.warehouseId && filterHints.warehouseId !== 'all' ? String(filterHints.warehouseId) : null;
    const hintProd = filterHints.productId && filterHints.productId !== 'all' ? String(filterHints.productId) : null;

    // Preserve full cross-history ONLY when product lifecycle history is requested (productId set).
    // Even then, push product_id predicate to PostgreSQL!
    const buildRangeWhere = (extraClauses = [], includeDateTo = true) => {
      const clauses = [...extraClauses];
      const params = [];
      if (!hintProd && hintDateFrom) {
        params.push(hintDateFrom);
        clauses.push(`date >= $${params.length}`);
      }
      if (!hintProd && includeDateTo && hintDateTo) {
        params.push(hintDateTo);
        clauses.push(`date <= $${params.length}`);
      }
      return {
        whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
        params,
      };
    };

    // financial_transactions keeps date >= dateFrom (no upper dateTo cap) so summary.drawerBalance & deltaAfterDateTo stay exact
    const ftFilter = buildRangeWhere([], false);

    // invoice_returns filter
    const retClauses = [];
    const retParams = [];
    if (!hintProd && hintDateFrom) {
      retParams.push(hintDateFrom);
      retClauses.push(`date >= $${retParams.length}`);
    }
    if (!hintProd && hintDateTo) {
      retParams.push(hintDateTo);
      retClauses.push(`date <= $${retParams.length}`);
    }
    if (hintWh) {
      retParams.push(hintWh);
      retClauses.push(`warehouse_id = $${retParams.length}`);
    }
    if (hintProd) {
      retParams.push(hintProd);
      retClauses.push(`id IN (SELECT return_id FROM invoice_return_items WHERE product_id = $${retParams.length})`);
    }
    const retWhereSql = retClauses.length > 0 ? `WHERE ${retClauses.join(' AND ')}` : '';

    // invoices filter (keep original invoices referenced by in-period returns so return cost & customer match 100%)
    const invClauses = [];
    const invParams = [];
    if (!hintProd && (hintDateFrom || hintDateTo)) {
      const dParts = [];
      const subParts = [];
      if (hintDateFrom) {
        invParams.push(hintDateFrom);
        const pIdx = `$${invParams.length}`;
        dParts.push(`date >= ${pIdx}`);
        subParts.push(`r.date >= ${pIdx}`);
      }
      if (hintDateTo) {
        invParams.push(hintDateTo);
        const pIdx = `$${invParams.length}`;
        dParts.push(`date <= ${pIdx}`);
        subParts.push(`r.date <= ${pIdx}`);
      }
      const subCond = subParts.length > 0 ? `WHERE ${subParts.join(' AND ')}` : '';
      invClauses.push(`((${dParts.join(' AND ')}) OR id IN (SELECT r.original_invoice_id FROM invoice_returns r ${subCond}))`);
    }
    if (hintWh) {
      invParams.push(hintWh);
      invClauses.push(`warehouse_id = $${invParams.length}`);
    }
    if (hintProd) {
      invParams.push(hintProd);
      invClauses.push(`id IN (SELECT ii.invoice_id FROM invoice_items ii WHERE ii.product_id = $${invParams.length})`);
    }
    const invWhereSql = invClauses.length > 0 ? `WHERE ${invClauses.join(' AND ')}` : '';
    const invItemWhereSql = invClauses.length > 0 ? `WHERE invoice_id IN (SELECT id FROM invoices ${invWhereSql})` : '';
    const invPayWhereSql = invItemWhereSql;

    // stock_movements filter
    const smClauses = [];
    const smParams = [];
    if (!hintProd && hintDateFrom) {
      smParams.push(hintDateFrom);
      smClauses.push(`date >= $${smParams.length}`);
    }
    if (!hintProd && hintDateTo) {
      smParams.push(hintDateTo);
      smClauses.push(`date <= $${smParams.length}`);
    }
    if (hintWh) {
      smParams.push(hintWh);
      smClauses.push(`(warehouse_id = $${smParams.length} OR target_warehouse_id = $${smParams.length})`);
    }
    if (hintProd) {
      smParams.push(hintProd);
      smClauses.push(`product_id = $${smParams.length}`);
    }
    const smWhereSql = smClauses.length > 0 ? `WHERE ${smClauses.join(' AND ')}` : '';

    // rep_custody_operations filter
    const rcoClauses = [];
    const rcoParams = [];
    if (!hintProd && hintDateFrom) {
      rcoParams.push(hintDateFrom);
      rcoClauses.push(`date >= $${rcoParams.length}`);
    }
    if (!hintProd && hintDateTo) {
      rcoParams.push(hintDateTo);
      rcoClauses.push(`date <= $${rcoParams.length}`);
    }
    if (hintProd) {
      rcoParams.push(hintProd);
      rcoClauses.push(`product_id = $${rcoParams.length}`);
    }
    const rcoWhereSql = rcoClauses.length > 0 ? `WHERE ${rcoClauses.join(' AND ')}` : '';

    const expFilter = buildRangeWhere([], true);
    const advFilter = buildRangeWhere([], true);
    const needsLinkedDocMeta = Boolean(hintWh || (!hintProd && (hintDateFrom || hintDateTo)));
    const ftLinkedSubWhere = ftFilter.whereSql
      ? `${ftFilter.whereSql} AND related_doc_id IS NOT NULL`
      : 'WHERE related_doc_id IS NOT NULL';

    const [
      whRes,
      cbRes,
      catRes,
      prodRes,
      unitRes,
      custRes,
      suppRes,
      repRes,
      empRes,
      userRes,
      invRes,
      invItemRes,
      invPayRes,
      retRes,
      retItemRes,
      ftRes,
      smRes,
      scRes,
      scItemRes,
      strRes,
      strItemRes,
      ritRes,
      ritItemRes,
      rcoRes,
      expIncRes,
      advRes,
      payRes,
      auditRes,
      linkedInvMetaRes,
      linkedRetMetaRes,
    ] = await Promise.all([
      pool.query('SELECT * FROM warehouses ORDER BY created_at ASC'),
      pool.query('SELECT * FROM cashboxes ORDER BY created_at ASC'),
      pool.query('SELECT * FROM product_categories ORDER BY name ASC'),
      pool.query('SELECT * FROM products ORDER BY created_at DESC'),
      pool.query('SELECT * FROM product_units'),
      pool.query('SELECT * FROM customers ORDER BY created_at DESC'),
      pool.query('SELECT * FROM suppliers ORDER BY created_at DESC'),
      pool.query('SELECT * FROM representatives ORDER BY created_at ASC'),
      pool.query('SELECT * FROM employees ORDER BY created_at ASC'),
      pool.query('SELECT id, full_name, username, role, job_title FROM users ORDER BY full_name ASC'),
      pool.query(`SELECT * FROM invoices ${invWhereSql} ORDER BY date DESC, created_at DESC`, invParams),
      pool.query(`SELECT * FROM invoice_items ${invItemWhereSql}`, invParams),
      pool.query(`SELECT * FROM invoice_payments ${invPayWhereSql} ORDER BY created_at ASC`, invParams),
      pool.query(`SELECT * FROM invoice_returns ${retWhereSql} ORDER BY date DESC, created_at DESC`, retParams),
      pool.query(
        retClauses.length > 0
          ? `SELECT * FROM invoice_return_items WHERE return_id IN (SELECT id FROM invoice_returns ${retWhereSql})`
          : 'SELECT * FROM invoice_return_items',
        retParams
      ),
      pool.query(`SELECT * FROM financial_transactions ${ftFilter.whereSql} ORDER BY date DESC, created_at DESC`, ftFilter.params),
      pool.query(`SELECT * FROM stock_movements ${smWhereSql} ORDER BY date DESC, created_at DESC`, smParams),
      pool.query('SELECT * FROM stock_counts ORDER BY date DESC, created_at DESC'),
      pool.query('SELECT * FROM stock_count_items'),
      pool.query('SELECT * FROM stock_transfer_requests ORDER BY date DESC, created_at DESC'),
      pool.query('SELECT * FROM stock_transfer_request_items'),
      pool.query('SELECT * FROM rep_item_transfers ORDER BY date DESC, created_at DESC'),
      pool.query('SELECT * FROM rep_item_transfer_items'),
      pool.query(`SELECT * FROM rep_custody_operations ${rcoWhereSql} ORDER BY date DESC, created_at DESC`, rcoParams),
      pool.query(`SELECT * FROM expenses_incomes ${expFilter.whereSql} ORDER BY date DESC, created_at DESC`, expFilter.params),
      pool.query(`SELECT * FROM advances_deductions ${advFilter.whereSql} ORDER BY date DESC, created_at DESC`, advFilter.params),
      pool.query('SELECT * FROM payrolls ORDER BY created_at DESC'),
      pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 2000'),
      needsLinkedDocMeta
        ? pool.query(
            `SELECT id, warehouse_id, representative_id, representative_name, cashbox_id, customer_id, supplier_id FROM invoices WHERE id IN (SELECT related_doc_id FROM financial_transactions ${ftLinkedSubWhere})`,
            ftFilter.params
          )
        : Promise.resolve({ rows: [] }),
      needsLinkedDocMeta
        ? pool.query(
            `SELECT id, warehouse_id FROM invoice_returns WHERE id IN (SELECT related_doc_id FROM financial_transactions ${ftLinkedSubWhere})`,
            ftFilter.params
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const unitsByProd = new Map();
    for (const u of unitRes.rows) {
      const list = unitsByProd.get(u.product_id) || [];
      list.push(u);
      unitsByProd.set(u.product_id, list);
    }
    const products = prodRes.rows.map((p) => mapPgProductRow(p, unitsByProd.get(p.id) || []));

    const invItemsMap = new Map();
    for (const it of invItemRes.rows) {
      const arr = invItemsMap.get(it.invoice_id) || [];
      arr.push(it);
      invItemsMap.set(it.invoice_id, arr);
    }
    const invPaysMap = new Map();
    for (const py of invPayRes.rows) {
      const arr = invPaysMap.get(py.invoice_id) || [];
      arr.push(py);
      invPaysMap.set(py.invoice_id, arr);
    }
    const invoices = invRes.rows
      .map((r) => mapPgInvoiceRow(r, invItemsMap.get(r.id) || [], invPaysMap.get(r.id) || []))
      .filter((inv) => {
        if (!isRep) return true;
        if (repProfile && inv.representativeId === repProfile.id) return true;
        return inv.createdBy === actor.fullName;
      });

    const retItemsMap = new Map();
    for (const it of retItemRes.rows) {
      const arr = retItemsMap.get(it.return_id) || [];
      arr.push({
        productId: it.product_id,
        productName: it.product_name,
        unit: it.unit,
        unitFactor: Number(it.unit_factor || 1),
        quantity: Number(it.quantity || 0),
        unitPrice: Number(it.unit_price || 0),
        total: Number(it.total || 0),
      });
      retItemsMap.set(it.return_id, arr);
    }
    const invoiceReturns = retRes.rows
      .map((r) => ({
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
        refundType: r.refund_type || 'balance',
        cashboxId: r.cashbox_id || undefined,
        reason: r.reason || '',
        notes: r.notes || '',
        createdBy: r.created_by,
        createdAt: isoTimestamp(r.created_at),
      }))
      .filter((r) => !isRep || r.createdBy === actor.fullName);

    const scItemsMap = new Map();
    for (const it of scItemRes.rows) {
      const arr = scItemsMap.get(it.count_id) || [];
      arr.push({
        id: it.id,
        productId: it.product_id,
        productName: it.product_name,
        unit: it.unit,
        systemQty: Number(it.system_qty || 0),
        actualQty: Number(it.actual_qty || 0),
        varianceQty: Number(it.variance_qty || 0),
        varianceType: it.variance_type,
        reason: it.reason || '',
      });
      scItemsMap.set(it.count_id, arr);
    }
    const stockCounts = scRes.rows.map((r) => ({
      id: r.id,
      countNumber: r.count_number,
      date: isoDateOnly(r.date),
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      status: r.status,
      notes: r.notes || '',
      counterName: r.counter_name,
      approvedByName: r.approved_by_name || undefined,
      approvedAt: r.approved_at ? isoTimestamp(r.approved_at) : undefined,
      createdAt: isoTimestamp(r.created_at),
      items: scItemsMap.get(r.id) || [],
    }));

    const strItemsMap = new Map();
    for (const it of strItemRes.rows) {
      const arr = strItemsMap.get(it.transfer_id) || [];
      arr.push({
        id: it.id,
        productId: it.product_id,
        productName: it.product_name,
        unit: it.unit,
        unitFactor: Number(it.unit_factor || 1),
        requestedQty: Number(it.requested_qty || 0),
        executedQty: it.executed_qty !== null ? Number(it.executed_qty) : undefined,
      });
      strItemsMap.set(it.transfer_id, arr);
    }
    const stockTransferRequests = strRes.rows.map((r) => ({
      id: r.id,
      transferNumber: r.transfer_number,
      date: isoDateOnly(r.date),
      sourceWarehouseId: r.source_warehouse_id,
      sourceWarehouseName: r.source_warehouse_name,
      targetWarehouseId: r.target_warehouse_id,
      targetWarehouseName: r.target_warehouse_name,
      status: r.status,
      notes: r.notes || '',
      createdBy: r.created_by,
      executedBy: r.executed_by || undefined,
      executedAt: r.executed_at ? isoTimestamp(r.executed_at) : undefined,
      createdAt: isoTimestamp(r.created_at),
      items: strItemsMap.get(r.id) || [],
    }));

    const ritItemsMap = new Map();
    for (const it of ritItemRes.rows) {
      const arr = ritItemsMap.get(it.transfer_id) || [];
      arr.push({
        productId: it.product_id,
        productName: it.product_name,
        unit: it.unit,
        requestedQty: Number(it.requested_qty || 0),
        approvedQty: it.approved_qty !== null ? Number(it.approved_qty) : undefined,
        executedQty: it.executed_qty !== null ? Number(it.executed_qty) : undefined,
      });
      ritItemsMap.set(it.transfer_id, arr);
    }
    const repItemTransfers = ritRes.rows.map((r) => ({
      id: r.id,
      requestNumber: r.request_number,
      date: isoDateOnly(r.date),
      representativeId: r.representative_id,
      representativeName: r.representative_name,
      invoiceId: r.invoice_id || undefined,
      invoiceNumber: r.invoice_number || undefined,
      sourceWarehouseId: r.source_warehouse_id,
      sourceWarehouseName: r.source_warehouse_name,
      targetWarehouseId: r.target_warehouse_id,
      targetWarehouseName: r.target_warehouse_name,
      status: r.status,
      notes: r.notes || '',
      createdBy: r.created_by,
      dispatchedBy: r.dispatched_by || undefined,
      dispatchedAt: r.dispatched_at ? isoTimestamp(r.dispatched_at) : undefined,
      reviewedBy: r.reviewed_by || undefined,
      executedAt: r.executed_at ? isoTimestamp(r.executed_at) : undefined,
      receivedBy: r.received_by || undefined,
      receivedAt: r.received_at ? isoTimestamp(r.received_at) : undefined,
      createdAt: isoTimestamp(r.created_at),
      items: ritItemsMap.get(r.id) || [],
    }));

    return {
      settings,
      warehouses: whRes.rows.map((w) => ({ id: w.id, name: w.name, code: w.code, isDefault: Boolean(w.is_default), status: w.status || 'active' })),
      cashboxes: cbRes.rows.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type || 'cashbox',
        openingBalance: Number(c.opening_balance || 0),
        currentBalance: Number(c.current_balance || 0),
        isDefault: Boolean(c.is_default),
      })),
      categories: catRes.rows.map((c) => ({ id: c.id, name: c.name })),
      products,
      customers: custRes.rows.map((c) => ({ id: c.id, code: c.code, name: c.name, phone: c.phone || '', assignedRepId: c.assigned_rep_id || undefined, currentBalance: Number(c.current_balance || 0) })),
      suppliers: suppRes.rows.map((s) => ({ id: s.id, code: s.code, name: s.name, phone: s.phone || '', currentBalance: Number(s.current_balance || 0) })),
      representatives: repRes.rows.map((r) => ({ id: r.id, code: r.code || '', name: r.name, phone: r.phone || '', warehouseId: r.warehouse_id || undefined })),
      employees: empRes.rows.map((e) => ({ id: e.id, code: e.code, name: e.full_name, jobTitle: e.job_title || '', department: e.department || '' })),
      users: userRes.rows.map((u) => ({ id: u.id, fullName: u.full_name, username: u.username, role: u.role })),
      invoices,
      invoiceReturns,
      financialTransactions: ftRes.rows
        .filter((f) => !isRep || f.created_by === actor.fullName)
        .map((f) => ({
          id: f.id,
          transactionNumber: f.transaction_number,
          date: isoDateOnly(f.date),
          type: f.type,
          amount: Number(f.amount || 0),
          cashboxId: f.cashbox_id,
          cashboxName: f.cashbox_name,
          balanceAfter: Number(f.balance_after || 0),
          category: f.category || '',
          relatedEntityType: f.related_entity_type || undefined,
          relatedEntityId: f.related_entity_id || undefined,
          relatedEntityName: f.related_entity_name || undefined,
          partyId: f.related_entity_id || undefined,
          partyName: f.related_entity_name || undefined,
          relatedDocType: f.related_doc_type || undefined,
          relatedDocId: f.related_doc_id || undefined,
          relatedDocNumber: f.related_doc_number || undefined,
          description: f.description || '',
          notes: f.notes || '',
          createdBy: f.created_by,
          createdAt: isoTimestamp(f.created_at),
        })),
      stockMovements: smRes.rows
        .filter((sm) => !isRep || (repProfile?.warehouseId && (sm.warehouse_id === repProfile.warehouseId || sm.target_warehouse_id === repProfile.warehouseId)))
        .map((sm) => ({
          id: sm.id,
          movementNumber: sm.movement_number || sm.id,
          date: isoDateOnly(sm.date),
          type: sm.movement_type,
          productId: sm.product_id,
          productName: sm.product_name,
          warehouseId: sm.warehouse_id,
          warehouseName: sm.warehouse_name,
          targetWarehouseId: sm.target_warehouse_id || undefined,
          targetWarehouseName: sm.target_warehouse_name || undefined,
          quantity: Number(sm.quantity || 0),
          unit: sm.unit || '',
          unitFactor: Number(sm.unit_factor || 1),
          unitCost: Number(sm.unit_cost || 0),
          balanceBefore: sm.balance_before !== null && sm.balance_before !== undefined ? Number(sm.balance_before) : undefined,
          balanceAfter: sm.balance_after !== null && sm.balance_after !== undefined ? Number(sm.balance_after) : undefined,
          relatedDocType: sm.related_doc_type || undefined,
          referenceId: sm.related_doc_id || undefined,
          referenceNumber: sm.related_doc_number || undefined,
          notes: sm.notes || '',
          createdBy: sm.created_by,
          createdAt: isoTimestamp(sm.created_at),
        })),
      stockCounts,
      stockTransferRequests,
      repItemTransfers,
      repCustodyOperations: rcoRes.rows.map((op) => ({
        id: op.id,
        operationNumber: op.operation_number,
        date: isoDateOnly(op.date),
        representativeId: op.representative_id,
        representativeName: op.representative_name,
        operationType: op.operation_type,
        productId: op.product_id,
        productName: op.product_name,
        unit: op.unit,
        unitFactor: Number(op.unit_factor || 1),
        quantity: Number(op.quantity || 0),
        baseQuantity: Number(op.base_quantity || 0),
        warehouseId: op.warehouse_id || undefined,
        warehouseName: op.warehouse_name || '',
        customerId: op.customer_id || undefined,
        customerName: op.customer_name || '',
        invoiceId: op.invoice_id || undefined,
        invoiceNumber: op.invoice_number || undefined,
        notes: op.notes || '',
        status: op.status || 'approved',
        createdBy: op.created_by,
        createdAt: isoTimestamp(op.created_at),
      })),
      expenseIncomes: expIncRes.rows.map((e) => ({
        id: e.id,
        recordNumber: e.voucher_number,
        type: e.type,
        category: e.category,
        amount: Number(e.amount || 0),
        date: isoDateOnly(e.date),
        cashboxId: e.cashbox_id,
        cashboxName: e.cashbox_name,
        paymentMethod: e.payment_method || 'cash',
        recipientOrPayer: e.recipient_or_payer || '',
        notes: e.notes || '',
        createdBy: e.created_by,
        createdAt: isoTimestamp(e.created_at),
      })),
      advancesDeductions: advRes.rows.map((a) => ({
        id: a.id,
        employeeId: a.employee_id,
        employeeName: a.employee_name,
        type: a.type,
        amount: Number(a.amount || 0),
        date: isoDateOnly(a.date),
        reason: a.reason || '',
        cashboxId: a.cashbox_id || undefined,
        createdBy: a.created_by,
        createdAt: isoTimestamp(a.created_at),
      })),
      payrolls: payRes.rows.map((p) => ({
        id: p.id,
        payrollNumber: p.payroll_number,
        month: Number(p.month),
        year: Number(p.year || 0),
        employeeId: p.employee_id,
        employeeName: p.employee_name,
        netSalary: Number(p.net_salary || 0),
        paidDate: p.payment_date ? isoDateOnly(p.payment_date) : isoDateOnly(p.created_at),
        cashboxId: p.cashbox_id || undefined,
        notes: p.notes || '',
        createdBy: p.created_by,
        createdAt: isoTimestamp(p.created_at),
      })),
      auditLogs: auditRes.rows.map((a) => ({
        id: a.id,
        timestamp: isoTimestamp(a.timestamp),
        userId: a.user_id || '',
        userName: a.user_name || '',
        action: a.action,
        module: a.module,
        recordId: a.record_id || '',
        oldValues: a.old_values || null,
        newValues: a.new_values || null,
        notes: a.notes || '',
      })),
      linkedInvMetaMap: new Map(
        (linkedInvMetaRes?.rows || []).map((r) => [
          r.id,
          {
            id: r.id,
            warehouseId: r.warehouse_id,
            representativeId: r.representative_id || undefined,
            representativeName: r.representative_name || undefined,
            cashboxId: r.cashbox_id || undefined,
            customerId: r.customer_id || undefined,
            supplierId: r.supplier_id || undefined,
          },
        ])
      ),
      linkedRetMetaMap: new Map(
        (linkedRetMetaRes?.rows || []).map((r) => [
          r.id,
          {
            id: r.id,
            warehouseId: r.warehouse_id,
          },
        ])
      ),
    };
  }

  // JSON Ledger Mode (100% untruncated)
  const db = readJsonDatabase();
  const invoices = (db.invoices || []).filter((inv) => {
    if (!isRep) return true;
    if (repProfile && inv.representativeId === repProfile.id) return true;
    return inv.createdBy === actor.fullName;
  });
  const invoiceReturns = (db.invoiceReturns || []).filter((r) => !isRep || r.createdBy === actor.fullName);
  const financialTransactions = (db.financialTransactions || []).filter((f) => !isRep || f.createdBy === actor.fullName);
  const stockMovements = (db.stockMovements || []).filter(
    (sm) => !isRep || (repProfile?.warehouseId && (sm.warehouseId === repProfile.warehouseId || sm.targetWarehouseId === repProfile.warehouseId))
  );

  return {
    settings,
    warehouses: db.warehouses || [],
    cashboxes: db.cashboxes || [],
    categories: db.categories || [],
    products: db.products || [],
    customers: db.customers || [],
    suppliers: db.suppliers || [],
    representatives: db.representatives || [],
    employees: db.employees || [],
    users: (db.users || []).map((u) => ({ id: u.id, fullName: u.fullName, username: u.username, role: u.role })),
    invoices,
    invoiceReturns,
    financialTransactions,
    stockMovements,
    stockCounts: db.stockCounts || [],
    stockTransferRequests: db.stockTransferRequests || [],
    repItemTransfers: db.repItemTransfers || [],
    repCustodyOperations: db.repCustodyOperations || [],
    expenseIncomes: db.expenseIncomes || [],
    advancesDeductions: db.advancesDeductions || [],
    payrolls: db.payrolls || [],
    auditLogs: (db.auditLogs || []).slice(0, 2000),
  };
}

function buildBranchResolvers(data) {
  const branches = Array.isArray(data.settings?.extraSettings?.branches)
    ? data.settings.extraSettings.branches
    : [];
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const branchByWh = new Map();
  const branchByCb = new Map();
  for (const b of branches) {
    if (b.warehouseId && !branchByWh.has(b.warehouseId)) branchByWh.set(b.warehouseId, b);
    if (b.cashboxId && !branchByCb.has(b.cashboxId)) branchByCb.set(b.cashboxId, b);
  }
  const warehouseMap = new Map((data.warehouses || []).map((w) => [w.id, w]));
  const cashboxMap = new Map((data.cashboxes || []).map((c) => [c.id, c]));

  const resolveBranchName = (warehouseId, cashboxId) => {
    const b = (warehouseId && branchByWh.get(warehouseId)) || (cashboxId && branchByCb.get(cashboxId));
    if (b?.name) return b.name;
    if (branches[0]?.name && branches.length === 1) return branches[0].name;
    const wh = warehouseId ? warehouseMap.get(warehouseId) : null;
    if (wh?.name) return wh.name;
    return 'المركز الرئيسي';
  };

  const resolveCashboxName = (cashboxId, fallbackName = '') => {
    if (!cashboxId) return fallbackName || '-';
    return cashboxMap.get(cashboxId)?.name || fallbackName || '-';
  };

  return { branches, branchById, branchByWh, branchByCb, warehouseMap, cashboxMap, resolveBranchName, resolveCashboxName };
}

function resolveUserMatchKey(userFilterValue, users) {
  if (!userFilterValue || userFilterValue === 'all') return null;
  const val = String(userFilterValue).trim();
  const matchedUser = (users || []).find((u) => u.id === val || u.fullName === val || u.username === val);
  if (!matchedUser) return new Set([val.toLowerCase()]);
  return new Set([matchedUser.id, matchedUser.fullName, matchedUser.username].filter(Boolean).map((s) => String(s).toLowerCase()));
}

function resolveEmployeeMatchKey(empFilterValue, employees, reps, users) {
  if (!empFilterValue || empFilterValue === 'all') return null;
  const val = String(empFilterValue).trim();
  const keys = new Set([val.toLowerCase()]);
  const emp = (employees || []).find((e) => e.id === val || e.name === val);
  if (emp) {
    if (emp.id) keys.add(emp.id.toLowerCase());
    if (emp.name) keys.add(emp.name.toLowerCase());
  }
  const rep = (reps || []).find((r) => r.id === val || r.name === val);
  if (rep) {
    if (rep.id) keys.add(rep.id.toLowerCase());
    if (rep.name) keys.add(rep.name.toLowerCase());
  }
  const usr = (users || []).find((u) => u.id === val || u.fullName === val);
  if (usr) {
    if (usr.id) keys.add(usr.id.toLowerCase());
    if (usr.fullName) keys.add(usr.fullName.toLowerCase());
  }
  return keys;
}

function classifyCashTransaction(tx, customerMap, supplierMap, employeeMap) {
  const relType = String(tx.relatedEntityType || '').toLowerCase();
  const docType = String(tx.relatedDocType || '').toLowerCase();
  const relId = tx.relatedEntityId || tx.partyId || '';
  const relName = String(tx.relatedEntityName || tx.partyName || '').trim();
  const cat = String(tx.category || '').toLowerCase();
  const desc = String(tx.description || '').toLowerCase();

  const isKnownCust = (relId && customerMap.has(relId)) || relType === 'customer' || docType === 'sales' || docType === 'order_advance' || docType === 'sales_return';
  const isKnownSupp = (relId && supplierMap.has(relId)) || relType === 'supplier' || docType === 'purchase' || docType === 'purchase_return';
  const isKnownEmp = (relId && employeeMap.has(relId)) || relType === 'employee' || docType === 'salary';

  // Cash payments (سداد نقدى)
  if (tx.type === 'customer_payment') return { bucket: 'cash_payment', sub: 'customer' };
  if (tx.type === 'supplier_payment') return { bucket: 'cash_payment', sub: 'supplier' };
  if (tx.type === 'advance_payout' || tx.type === 'salary_payout') return { bucket: 'cash_payment', sub: 'employee' };
  if (tx.type === 'deposit' || tx.type === 'income') {
    if (isKnownCust) return { bucket: 'cash_payment', sub: 'customer' };
    if (isKnownSupp) return { bucket: 'cash_payment', sub: 'supplier' };
    return { bucket: 'cash_payment', sub: 'general' };
  }

  // Rep transfer inward = cash receipt from rep; outward = cash withdrawal to rep
  if (tx.type === 'rep_transfer') {
    if (cat.includes('توريد') || desc.includes('توريد')) return { bucket: 'cash_payment', sub: 'employee' };
    return { bucket: 'cash_withdrawal', sub: 'general' };
  }

  // Cash withdrawals (سحب نقدى)
  if (tx.type === 'withdrawal' || tx.type === 'expense' || tx.type === 'transfer') {
    if (docType === 'sales_return' || isKnownCust || cat.includes('عميل') || desc.includes('مرتجع مبيعات')) {
      return { bucket: 'cash_withdrawal', sub: 'customer' };
    }
    if (isKnownSupp || cat.includes('مورد')) {
      return { bucket: 'cash_withdrawal', sub: 'supplier' };
    }
    if (relName && customerMap.size > 0) {
      for (const c of customerMap.values()) {
        if (c.name && relName === c.name) return { bucket: 'cash_withdrawal', sub: 'customer' };
      }
    }
    if (relName && supplierMap.size > 0) {
      for (const s of supplierMap.values()) {
        if (s.name && relName === s.name) return { bucket: 'cash_withdrawal', sub: 'supplier' };
      }
    }
    return { bucket: 'cash_withdrawal', sub: 'general' };
  }

  return { bucket: 'cash_payment', sub: 'general' };
}

function computeSignedCashDelta(tx, targetCashboxSet, cashboxNameToId) {
  const amt = Number(tx.amount || 0);
  if (!amt) return 0;
  let delta = 0;

  if (targetCashboxSet.has(tx.cashboxId)) {
    if (tx.type === 'income' || tx.type === 'deposit' || tx.type === 'customer_payment') {
      delta += amt;
    } else if (
      tx.type === 'expense' ||
      tx.type === 'withdrawal' ||
      tx.type === 'supplier_payment' ||
      tx.type === 'advance_payout' ||
      tx.type === 'salary_payout' ||
      tx.type === 'transfer'
    ) {
      delta -= amt;
    } else if (tx.type === 'rep_transfer') {
      const cat = String(tx.category || '');
      const desc = String(tx.description || '');
      if (cat.includes('توريد') || desc.includes('توريد')) delta += amt;
      else delta -= amt;
    }
  }

  // For inter-cashbox transfers, add inflow if destination cashbox is in targetCashboxSet
  if (tx.type === 'transfer') {
    let destId = tx.targetCashboxId || null;
    if (!destId && tx.description) {
      const m = String(tx.description).match(/إلى\s+(.+?)$/);
      if (m && m[1]) {
        destId = cashboxNameToId.get(m[1].trim()) || null;
      }
    }
    if (!destId && tx.relatedEntityName) {
      destId = cashboxNameToId.get(String(tx.relatedEntityName).trim()) || null;
    }
    if (destId && targetCashboxSet.has(destId)) {
      delta += amt;
    }
  }

  return round2(delta);
}

export async function getComprehensiveReport(filters = {}, actor) {
  const data = await loadFullReportDataset(actor, filters);
  const resolvers = buildBranchResolvers(data);
  const { branchById, branchByWh, branchByCb, cashboxMap, resolveBranchName, resolveCashboxName } = resolvers;

  const reportType = REPORT_TYPES_LIST.some((t) => t.key === filters.reportType)
    ? String(filters.reportType)
    : 'all';

  const dateFrom = filters.dateFrom ? String(filters.dateFrom).split('T')[0] : null;
  const dateTo = filters.dateTo ? String(filters.dateTo).split('T')[0] : null;
  const branchId = filters.branchId && filters.branchId !== 'all' ? String(filters.branchId) : null;
  const branchObj = branchId ? branchById.get(branchId) || null : null;
  const warehouseId = filters.warehouseId && filters.warehouseId !== 'all' ? String(filters.warehouseId) : null;
  const cashboxId = filters.cashboxId && filters.cashboxId !== 'all' ? String(filters.cashboxId) : null;
  const productId = filters.productId && filters.productId !== 'all' ? String(filters.productId) : null;
  const productSearch = filters.productSearch ? String(filters.productSearch).trim().toLowerCase() : '';
  const barcode = filters.barcode ? String(filters.barcode).trim().toLowerCase() : '';
  const customerId = filters.customerId && filters.customerId !== 'all' ? String(filters.customerId) : null;
  const supplierId = filters.supplierId && filters.supplierId !== 'all' ? String(filters.supplierId) : null;
  const representativeId = filters.representativeId && filters.representativeId !== 'all' ? String(filters.representativeId) : null;
  const invoiceNumber = filters.invoiceNumber ? String(filters.invoiceNumber).trim().toLowerCase() : '';
  const recordId = filters.recordId ? String(filters.recordId).trim().toLowerCase() : '';
  const search = filters.search ? String(filters.search).trim().toLowerCase() : '';

  const userMatchKeys = resolveUserMatchKey(filters.userId || filters.userName, data.users);
  const employeeMatchKeys = resolveEmployeeMatchKey(
    filters.employeeId,
    data.employees,
    data.representatives,
    data.users
  );

  const productMap = new Map((data.products || []).map((p) => [p.id, p]));
  const customerMap = new Map((data.customers || []).map((c) => [c.id, c]));
  const supplierMap = new Map((data.suppliers || []).map((s) => [s.id, s]));
  const employeeMap = new Map((data.employees || []).map((e) => [e.id, e]));
  const repMap = new Map((data.representatives || []).map((r) => [r.id, r]));
  const invoiceMap = new Map((data.invoices || []).map((i) => [i.id, i]));

  const branchWarehouseId = branchObj?.warehouseId || null;
  const branchCashboxId = branchObj?.cashboxId || null;

  const matchesDateRange = (dateStr) => {
    const clean = dateStr ? String(dateStr).split('T')[0] : '';
    if (dateFrom && clean && clean < dateFrom) return false;
    if (dateTo && clean && clean > dateTo) return false;
    return true;
  };

  const matchesCommonFilters = (ctx) => {
    if (!matchesDateRange(ctx.date)) return false;

    if (branchId) {
      const whMatch = branchWarehouseId && ctx.warehouseId === branchWarehouseId;
      const cbMatch = branchCashboxId && ctx.cashboxId === branchCashboxId;
      const namedMatch = branchObj?.name && ctx.branchName === branchObj.name;
      if (branchWarehouseId || branchCashboxId) {
        if (!whMatch && !cbMatch && !namedMatch) return false;
      } else if (branchObj?.name && ctx.branchName !== branchObj.name) {
        return false;
      }
    }

    if (warehouseId && ctx.warehouseId && ctx.warehouseId !== warehouseId) return false;
    if (warehouseId && !ctx.warehouseId && ctx.scopeType !== 'cash') return false;

    if (cashboxId && ctx.cashboxId !== cashboxId) return false;

    if (productId && ctx.productId !== productId) return false;
    if (productSearch) {
      const pName = String(ctx.productName || ctx.operationLabel || '').toLowerCase();
      if (!pName.includes(productSearch)) return false;
    }
    if (barcode) {
      const bc = String(ctx.barcode || '').toLowerCase();
      if (!bc.includes(barcode)) return false;
    }

    if (customerId && ctx.customerId !== customerId) return false;
    if (supplierId && ctx.supplierId !== supplierId) return false;
    if (representativeId && ctx.representativeId !== representativeId) return false;

    if (invoiceNumber) {
      const docNo = String(ctx.invoiceNumber || '').toLowerCase();
      if (!docNo.includes(invoiceNumber)) return false;
    }
    if (recordId) {
      const ids = [ctx.displayId, ctx.docId, ctx.productId, ctx.rowId]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      if (!ids.some((v) => v.includes(recordId))) return false;
    }

    if (userMatchKeys) {
      const uVal = String(ctx.userName || '').trim().toLowerCase();
      if (!userMatchKeys.has(uVal)) return false;
    }
    if (employeeMatchKeys) {
      const eCandidates = [ctx.employeeId, ctx.employeeName, ctx.representativeId, ctx.representativeName, ctx.userName]
        .filter(Boolean)
        .map((v) => String(v).trim().toLowerCase());
      if (!eCandidates.some((v) => employeeMatchKeys.has(v))) return false;
    }

    if (search) {
      const hay = [
        ctx.operationLabel,
        ctx.movementLabel,
        ctx.employeeName,
        ctx.userName,
        ctx.barcode,
        ctx.displayId,
        ctx.invoiceNumber,
        ctx.branchName,
        ctx.cashboxName,
        ctx.notes,
        ctx.productName,
        ctx.partyName,
        ctx.categoryName,
        ctx.class1,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }

    return true;
  };

  // ============================================================================
  // Build atomic row collectors
  // ============================================================================
  const salesItemRows = [];
  const salesInvoiceRows = [];
  const purchaseItemRows = [];
  const purchaseInvoiceRows = [];

  for (const inv of data.invoices || []) {
    if (inv.status !== 'confirmed') continue;
    if (inv.type !== 'sales' && inv.type !== 'purchase') continue;

    const isSales = inv.type === 'sales';
    const partyId = isSales ? inv.customerId : inv.supplierId;
    const cust = isSales && partyId ? customerMap.get(partyId) : null;
    const supp = !isSales && partyId ? supplierMap.get(partyId) : null;
    const partyName = isSales ? (inv.customerName || cust?.name || 'عميل نقدي') : (inv.supplierName || supp?.name || 'مورد نقدي');
    const partyPhone = cust?.phone || supp?.phone || '';
    const partyWithPhone = partyPhone ? `${partyName} (${partyPhone})` : partyName;

    const branchName = resolveBranchName(inv.warehouseId, inv.cashboxId);
    const cashboxName = resolveCashboxName(inv.cashboxId);
    const empName = inv.representativeName || inv.createdBy || '-';
    const actualDt = formatActualDateTimeAr(inv.createdAt, inv.date);
    const bizDate = formatBusinessDateSlash(inv.date);

    // Distribute any invoice-level extra discount proportionally across items so sum(item net) === invoice grandTotal
    const itemsList = inv.items || [];
    const itemsGrossSum = itemsList.reduce(
      (s, it) => s + Number(it.total ?? Number(it.unitPrice || 0) * Number(it.quantity || 0) - Number(it.discount || 0)),
      0
    );
    const extraInvDiscount = Math.max(0, round2(itemsGrossSum - Number(inv.grandTotal || 0)));

    let invQtySum = 0;
    let invCostSum = 0;
    let invLineDiscountSum = 0;

    for (let idx = 0; idx < itemsList.length; idx++) {
      const it = itemsList[idx];
      const prod = productMap.get(it.productId);
      const unitFactor = Number(it.unitFactor || resolveUnitFactor(prod, it.unit) || 1);
      const qty = Number(it.quantity || 0);
      const baseQty = round3(qty * unitFactor);
      const unitPrice = round2(it.unitPrice || 0);
      const lineBeforeExtraInvDisc = round2(it.total ?? (unitPrice * qty - Number(it.discount || 0)));
      const shareExtraDisc = itemsGrossSum > 0 && extraInvDiscount > 0
        ? round2((lineBeforeExtraInvDisc / itemsGrossSum) * extraInvDiscount)
        : 0;
      const netLineValue = round2(lineBeforeExtraInvDisc - shareExtraDisc);
      const lineDiscount = round2(Number(it.discount || 0) + shareExtraDisc);
      const costPerBase = Number(it.purchasePriceAtTime || 0) > 0
        ? Number(it.purchasePriceAtTime)
        : Number(prod?.purchasePrice || 0);
      const lineCost = round2(costPerBase * baseQty);
      const lineProfit = isSales ? round2(netLineValue - lineCost) : 0;
      const profitPct = isSales ? calcProfitPctOnCost(lineProfit, lineCost) : 0;

      invQtySum = round3(invQtySum + qty);
      invCostSum = round2(invCostSum + lineCost);
      invLineDiscountSum = round2(invLineDiscountSum + Number(it.discount || 0));

      const itemRow = {
        rowId: `${inv.id}-IT-${idx}`,
        docType: isSales ? 'sales_invoice' : 'purchase_invoice',
        docId: inv.id,
        productId: it.productId,
        productName: it.productName || prod?.name || '',
        categoryName: prod?.category || 'عام',
        class1: normalizeClassification1(prod),
        operationLabel: it.productName || prod?.name || '',
        quantity: qty,
        baseQuantity: baseQty,
        unit: it.unit || prod?.baseUnit || 'قطعة',
        baseUnit: prod?.baseUnit || it.unit || 'قطعة',
        unitFactor,
        priceOrTotal: unitPrice,
        valueOrPaid: netLineValue,
        movementOrRemaining: isSales ? `${partyWithPhone} - فاتورة بيع` : `${partyWithPhone} - فاتورة شراء`,
        employeeId: inv.representativeId || undefined,
        employeeName: empName,
        userName: inv.createdBy,
        businessDate: bizDate,
        rawDate: inv.date,
        actualDateTime: actualDt,
        rawCreatedAt: inv.createdAt || inv.date,
        profit: lineProfit,
        costValue: lineCost,
        barcode: it.barcode || prod?.barcode || prod?.code || '',
        displayId: prod?.code || it.productId,
        invoiceNumber: inv.invoiceNumber,
        branchName,
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouseName,
        cashboxId: inv.cashboxId,
        cashboxName,
        notes: inv.notes || '',
        discount: lineDiscount,
        profitPercent: profitPct,
        customerId: isSales ? partyId : undefined,
        supplierId: !isSales ? partyId : undefined,
        partyName,
        representativeId: inv.representativeId || undefined,
        representativeName: inv.representativeName || undefined,
        rowTone: 'default',
        scopeType: 'inventory',
      };

      if (matchesCommonFilters(itemRow)) {
        if (isSales) salesItemRows.push(itemRow);
        else purchaseItemRows.push(itemRow);
      }
    }

    const invTotalDiscount = round2(Math.max(Number(inv.discountTotal || 0), invLineDiscountSum + Number(inv.discountTotal || 0)));
    const invProfit = isSales ? round2(Number(inv.grandTotal || 0) - invCostSum) : 0;
    const invProfitPct = isSales ? calcProfitPctOnCost(invProfit, invCostSum) : 0;

    // For invoice-level filter, check whether any item matches product/barcode filters if product/barcode filter is active
    const matchesProductLevelFilters = (!productId && !productSearch && !barcode)
      ? true
      : itemsList.some((it) => {
          const prod = productMap.get(it.productId);
          if (productId && it.productId !== productId) return false;
          if (productSearch && !String(it.productName || prod?.name || '').toLowerCase().includes(productSearch)) return false;
          if (barcode && !String(it.barcode || prod?.barcode || prod?.code || '').toLowerCase().includes(barcode)) return false;
          return true;
        });

    if (matchesProductLevelFilters) {
      const invRow = {
        rowId: `${inv.id}-INV`,
        docType: isSales ? 'sales_invoice' : 'purchase_invoice',
        docId: inv.id,
        operationLabel: partyWithPhone,
        quantity: invQtySum,
        unit: `${itemsList.length} صنف`,
        priceOrTotal: round2(inv.grandTotal || 0),
        valueOrPaid: round2(inv.paidAmount || 0),
        movementOrRemaining: round2(inv.remainingAmount || 0),
        employeeId: inv.representativeId || undefined,
        employeeName: empName,
        userName: inv.createdBy,
        businessDate: bizDate,
        rawDate: inv.date,
        actualDateTime: actualDt,
        rawCreatedAt: inv.createdAt || inv.date,
        profit: invProfit,
        costValue: invCostSum,
        barcode: '',
        displayId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        branchName,
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouseName,
        cashboxId: inv.cashboxId,
        cashboxName,
        notes: `${inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'partial' ? 'سداد جزئي' : 'آجل'}${inv.notes ? ` - ${inv.notes}` : ''}`,
        discount: round2(inv.discountTotal || 0),
        profitPercent: invProfitPct,
        customerId: isSales ? partyId : undefined,
        supplierId: !isSales ? partyId : undefined,
        partyName,
        representativeId: inv.representativeId || undefined,
        representativeName: inv.representativeName || undefined,
        rowTone: 'invoice_blue',
        scopeType: 'inventory',
      };
      if (matchesCommonFilters(invRow)) {
        if (isSales) salesInvoiceRows.push(invRow);
        else purchaseInvoiceRows.push(invRow);
      }
    }
  }

  // Returns (Sales Returns & Purchase Returns)
  const salesReturnItemRows = [];
  const salesReturnInvoiceRows = [];
  const purchaseReturnItemRows = [];
  const purchaseReturnInvoiceRows = [];

  for (const ret of data.invoiceReturns || []) {
    const isSalesRet = ret.type === 'sales_return';
    const origInv = ret.originalInvoiceId ? invoiceMap.get(ret.originalInvoiceId) : null;
    const cbId = ret.cashboxId || origInv?.cashboxId || '';
    const branchName = resolveBranchName(ret.warehouseId, cbId);
    const cashboxName = resolveCashboxName(cbId, ret.refundType === 'balance' ? 'رصيد الحساب' : '-');
    const actualDt = formatActualDateTimeAr(ret.createdAt, ret.date);
    const bizDate = formatBusinessDateSlash(ret.date);

    let retQtySum = 0;
    let retCostSum = 0;

    for (let idx = 0; idx < (ret.items || []).length; idx++) {
      const it = ret.items[idx];
      const prod = productMap.get(it.productId);
      const unitFactor = Number(it.unitFactor || resolveUnitFactor(prod, it.unit) || 1);
      const qty = Number(it.quantity || 0);
      const baseQty = round3(qty * unitFactor);
      const unitPrice = round2(it.unitPrice || 0);
      const lineTotal = round2(it.total ?? unitPrice * qty);
      const origItem = (origInv?.items || []).find((x) => x.productId === it.productId);
      const costPerBase = Number(origItem?.purchasePriceAtTime || prod?.purchasePrice || 0);
      const lineCost = round2(costPerBase * baseQty);
      const lineProfitImpact = isSalesRet ? round2(-(lineTotal - lineCost)) : 0;

      retQtySum = round3(retQtySum + qty);
      retCostSum = round2(retCostSum + lineCost);

      const retItemRow = {
        rowId: `${ret.id}-RIT-${idx}`,
        docType: ret.type,
        docId: ret.id,
        productId: it.productId,
        productName: it.productName || prod?.name || '',
        operationLabel: it.productName || prod?.name || '',
        quantity: qty,
        baseQuantity: baseQty,
        unit: it.unit || prod?.baseUnit || 'قطعة',
        priceOrTotal: unitPrice,
        valueOrPaid: lineTotal,
        movementOrRemaining: `${ret.partyName || ''} (${isSalesRet ? 'مرتجع بيع' : 'مرتجع شراء'})`,
        employeeName: ret.createdBy || '-',
        userName: ret.createdBy || '-',
        businessDate: bizDate,
        rawDate: ret.date,
        actualDateTime: actualDt,
        rawCreatedAt: ret.createdAt || ret.date,
        profit: lineProfitImpact,
        costValue: lineCost,
        barcode: prod?.barcode || prod?.code || '',
        displayId: prod?.code || it.productId,
        invoiceNumber: ret.returnNumber,
        branchName,
        warehouseId: ret.warehouseId,
        warehouseName: ret.warehouseName,
        cashboxId: cbId,
        cashboxName,
        notes: `${ret.reason || ''}${ret.notes ? ` — ${ret.notes}` : ''}`.trim(),
        discount: 0,
        profitPercent: isSalesRet ? calcProfitPctOnCost(lineProfitImpact, lineCost) : 0,
        customerId: isSalesRet ? ret.partyId : undefined,
        supplierId: !isSalesRet ? ret.partyId : undefined,
        partyName: ret.partyName,
        rowTone: 'warning_rose',
        scopeType: 'inventory',
      };
      if (matchesCommonFilters(retItemRow)) {
        if (isSalesRet) salesReturnItemRows.push(retItemRow);
        else purchaseReturnItemRows.push(retItemRow);
      }
    }

    const matchesProductLevelFilters = (!productId && !productSearch && !barcode)
      ? true
      : (ret.items || []).some((it) => {
          const prod = productMap.get(it.productId);
          if (productId && it.productId !== productId) return false;
          if (productSearch && !String(it.productName || prod?.name || '').toLowerCase().includes(productSearch)) return false;
          if (barcode && !String(prod?.barcode || prod?.code || '').toLowerCase().includes(barcode)) return false;
          return true;
        });

    if (matchesProductLevelFilters) {
      const retProfit = isSalesRet ? round2(-(Number(ret.grandTotal || 0) - retCostSum)) : 0;
      const retRow = {
        rowId: `${ret.id}-RET`,
        docType: ret.type,
        docId: ret.id,
        operationLabel: ret.partyName || '-',
        quantity: retQtySum,
        unit: `${(ret.items || []).length} صنف`,
        priceOrTotal: round2(ret.grandTotal || 0),
        valueOrPaid: ret.refundType === 'cash' ? round2(ret.grandTotal || 0) : 0,
        movementOrRemaining: ret.refundType === 'balance' ? round2(ret.grandTotal || 0) : 0,
        employeeName: ret.createdBy || '-',
        userName: ret.createdBy || '-',
        businessDate: bizDate,
        rawDate: ret.date,
        actualDateTime: actualDt,
        rawCreatedAt: ret.createdAt || ret.date,
        profit: retProfit,
        costValue: retCostSum,
        barcode: '',
        displayId: ret.id,
        invoiceNumber: ret.returnNumber,
        branchName,
        warehouseId: ret.warehouseId,
        warehouseName: ret.warehouseName,
        cashboxId: cbId,
        cashboxName,
        notes: `${ret.reason || ''}${ret.originalInvoiceNumber ? ` (أصل: ${ret.originalInvoiceNumber})` : ''}`.trim(),
        discount: 0,
        profitPercent: isSalesRet ? calcProfitPctOnCost(retProfit, retCostSum) : 0,
        customerId: isSalesRet ? ret.partyId : undefined,
        supplierId: !isSalesRet ? ret.partyId : undefined,
        partyName: ret.partyName,
        rowTone: 'warning_rose',
        scopeType: 'inventory',
      };
      if (matchesCommonFilters(retRow)) {
        if (isSalesRet) salesReturnInvoiceRows.push(retRow);
        else purchaseReturnInvoiceRows.push(retRow);
      }
    }
  }

  // Damaged items & Damaged vouchers (اصناف تالف & فواتير تالف)
  const damagedItemRows = [];
  const damagedVoucherBuckets = new Map();
  const seenCustodyDmgIds = new Set();

  for (const op of data.repCustodyOperations || []) {
    if (op.operationType !== 'custody_damaged' || op.status === 'rejected') continue;
    seenCustodyDmgIds.add(op.id);
    const prod = productMap.get(op.productId);
    const qty = Number(op.quantity || 0);
    const baseQty = Number(op.baseQuantity || qty);
    const costPerBase = Number(prod?.purchasePrice || 0);
    const lossVal = round2(baseQty * costPerBase);
    const branchName = resolveBranchName(op.warehouseId, null);
    const docNo = op.operationNumber || op.id;

    const dmgRow = {
      rowId: `DMG-OP-${op.id}`,
      docType: 'damaged_voucher',
      docId: op.id,
      productId: op.productId,
      productName: op.productName || prod?.name || '',
      operationLabel: op.productName || prod?.name || '',
      quantity: qty,
      baseQuantity: baseQty,
      unit: op.unit || prod?.baseUnit || 'قطعة',
      priceOrTotal: round2(costPerBase),
      valueOrPaid: lossVal,
      movementOrRemaining: `تالف عهدة (${op.representativeName})`,
      employeeId: op.representativeId,
      employeeName: op.representativeName || op.createdBy,
      userName: op.createdBy,
      businessDate: formatBusinessDateSlash(op.date),
      rawDate: op.date,
      actualDateTime: formatActualDateTimeAr(op.createdAt, op.date),
      rawCreatedAt: op.createdAt || op.date,
      profit: round2(-lossVal),
      costValue: lossVal,
      barcode: prod?.barcode || prod?.code || '',
      displayId: prod?.code || op.productId,
      invoiceNumber: docNo,
      branchName,
      warehouseId: op.warehouseId,
      warehouseName: op.warehouseName,
      cashboxName: '-',
      notes: op.notes || 'توالف عهدة مندوب',
      discount: 0,
      profitPercent: -100,
      representativeId: op.representativeId,
      representativeName: op.representativeName,
      rowTone: 'warning_rose',
      scopeType: 'inventory',
    };
    if (matchesCommonFilters(dmgRow)) {
      damagedItemRows.push(dmgRow);
      if (!damagedVoucherBuckets.has(docNo)) {
        damagedVoucherBuckets.set(docNo, {
          docId: op.id,
          docNumber: docNo,
          date: op.date,
          createdAt: op.createdAt,
          warehouseId: op.warehouseId,
          warehouseName: op.warehouseName,
          branchName,
          employeeId: op.representativeId,
          employeeName: op.representativeName || op.createdBy,
          userName: op.createdBy,
          notes: op.notes || 'توالف عهدة مندوب',
          items: [],
          totalQty: 0,
          totalLoss: 0,
        });
      }
      const b = damagedVoucherBuckets.get(docNo);
      b.items.push(dmgRow);
      b.totalQty = round3(b.totalQty + qty);
      b.totalLoss = round2(b.totalLoss + lossVal);
    }
  }

  for (const sm of data.stockMovements || []) {
    if (sm.type !== 'damaged') continue;
    if (sm.referenceId && seenCustodyDmgIds.has(sm.referenceId)) continue;
    const prod = productMap.get(sm.productId);
    const qty = Number(sm.quantity || 0);
    const costPerBase = Number(sm.unitCost || prod?.purchasePrice || 0);
    const lossVal = round2(qty * costPerBase);
    const branchName = resolveBranchName(sm.warehouseId, null);
    const voucherKey = sm.referenceId || sm.referenceNumber || `DMG-${String(sm.date).replace(/-/g, '')}-${sm.warehouseId}-${String(sm.createdAt || '').slice(0, 16)}`;
    const docNo = sm.referenceNumber || `DMG-${String(sm.date).replace(/-/g, '')}-${sm.id.slice(-4)}`;

    const dmgRow = {
      rowId: `DMG-SM-${sm.id}`,
      docType: 'damaged_voucher',
      docId: voucherKey,
      productId: sm.productId,
      productName: sm.productName || prod?.name || '',
      operationLabel: sm.productName || prod?.name || '',
      quantity: qty,
      baseQuantity: qty,
      unit: sm.unit || prod?.baseUnit || 'قطعة',
      priceOrTotal: round2(costPerBase),
      valueOrPaid: lossVal,
      movementOrRemaining: `تالف (${sm.warehouseName})`,
      employeeName: sm.createdBy,
      userName: sm.createdBy,
      businessDate: formatBusinessDateSlash(sm.date),
      rawDate: sm.date,
      actualDateTime: formatActualDateTimeAr(sm.createdAt, sm.date),
      rawCreatedAt: sm.createdAt || sm.date,
      profit: round2(-lossVal),
      costValue: lossVal,
      barcode: prod?.barcode || prod?.code || '',
      displayId: prod?.code || sm.productId,
      invoiceNumber: docNo,
      branchName,
      warehouseId: sm.warehouseId,
      warehouseName: sm.warehouseName,
      cashboxName: '-',
      notes: sm.notes || 'إثبات توالف',
      discount: 0,
      profitPercent: -100,
      rowTone: 'warning_rose',
      scopeType: 'inventory',
    };
    if (matchesCommonFilters(dmgRow)) {
      damagedItemRows.push(dmgRow);
      if (!damagedVoucherBuckets.has(voucherKey)) {
        damagedVoucherBuckets.set(voucherKey, {
          docId: voucherKey,
          docNumber: docNo,
          date: sm.date,
          createdAt: sm.createdAt,
          warehouseId: sm.warehouseId,
          warehouseName: sm.warehouseName,
          branchName,
          employeeName: sm.createdBy,
          userName: sm.createdBy,
          notes: sm.notes || 'مستند توالف',
          items: [],
          totalQty: 0,
          totalLoss: 0,
        });
      }
      const b = damagedVoucherBuckets.get(voucherKey);
      b.items.push(dmgRow);
      b.totalQty = round3(b.totalQty + qty);
      b.totalLoss = round2(b.totalLoss + lossVal);
    }
  }

  const damagedInvoiceRows = Array.from(damagedVoucherBuckets.values()).map((b) => ({
    rowId: `DMG-DOC-${b.docId}`,
    docType: 'damaged_voucher',
    docId: b.docId,
    operationLabel: `سند توالف (${b.warehouseName})`,
    quantity: b.totalQty,
    unit: `${b.items.length} صنف`,
    priceOrTotal: round2(b.totalLoss),
    valueOrPaid: round2(b.totalLoss),
    movementOrRemaining: 0,
    employeeId: b.employeeId,
    employeeName: b.employeeName,
    userName: b.userName,
    businessDate: formatBusinessDateSlash(b.date),
    rawDate: b.date,
    actualDateTime: formatActualDateTimeAr(b.createdAt, b.date),
    rawCreatedAt: b.createdAt || b.date,
    profit: round2(-b.totalLoss),
    costValue: round2(b.totalLoss),
    barcode: '',
    displayId: b.docNumber,
    invoiceNumber: b.docNumber,
    branchName: b.branchName,
    warehouseId: b.warehouseId,
    warehouseName: b.warehouseName,
    cashboxName: '-',
    notes: b.notes,
    discount: 0,
    profitPercent: -100,
    rowTone: 'warning_rose',
    scopeType: 'inventory',
  }));

  // Financial transactions -> سداد نقدى / سحب نقدى buckets
  const cashPaymentCustomerRows = [];
  const cashPaymentSupplierRows = [];
  const cashPaymentEmployeeRows = [];
  const cashPaymentGeneralRows = [];
  const cashWithdrawalCustomerRows = [];
  const cashWithdrawalSupplierRows = [];
  const cashWithdrawalGeneralRows = [];

  for (const tx of data.financialTransactions || []) {
    const classified = classifyCashTransaction(tx, customerMap, supplierMap, employeeMap);
    const branchName = resolveBranchName(null, tx.cashboxId);
    const cashboxName = resolveCashboxName(tx.cashboxId, tx.cashboxName);
    const custId = classified.sub === 'customer' ? (tx.relatedEntityId || tx.partyId) : undefined;
    const suppId = classified.sub === 'supplier' ? (tx.relatedEntityId || tx.partyId) : undefined;
    const empId = classified.sub === 'employee' ? (tx.relatedEntityId || tx.partyId) : undefined;
    const partyObj = (custId && customerMap.get(custId)) || (suppId && supplierMap.get(suppId)) || (empId && employeeMap.get(empId)) || null;
    const partyName = tx.relatedEntityName || tx.partyName || partyObj?.name || tx.description || tx.category || '-';
    const partyLabel = partyObj?.phone ? `${partyName} (${partyObj.phone})` : partyName;

    const linkedInv = tx.relatedDocId && ['sales', 'purchase'].includes(tx.relatedDocType)
      ? (invoiceMap.get(tx.relatedDocId) || data.linkedInvMetaMap?.get(tx.relatedDocId) || null)
      : null;
    const linkedRet = tx.relatedDocId && ['sales_return', 'purchase_return'].includes(tx.relatedDocType)
      ? ((data.invoiceReturns || []).find((r) => r.id === tx.relatedDocId) || data.linkedRetMetaMap?.get(tx.relatedDocId) || null)
      : null;
    const linkedWarehouseId = linkedInv?.warehouseId || linkedRet?.warehouseId || undefined;
    const empName = linkedInv?.representativeName || tx.createdBy || '-';
    const invNo = tx.relatedDocNumber || tx.transactionNumber || '-';

    const row = {
      rowId: `FT-${tx.id}`,
      docType: tx.relatedDocType && tx.relatedDocId ? tx.relatedDocType : 'cash_tx',
      docId: tx.relatedDocId || tx.id,
      txId: tx.id,
      operationLabel: partyLabel,
      quantity: 1,
      unit: '-',
      priceOrTotal: round2(tx.amount || 0),
      valueOrPaid: round2(tx.amount || 0),
      movementOrRemaining: tx.category || tx.description || (classified.bucket === 'cash_payment' ? 'سداد نقدي' : 'سحب نقدي'),
      employeeId: empId || linkedInv?.representativeId,
      employeeName: empName,
      userName: tx.createdBy,
      businessDate: formatBusinessDateSlash(tx.date),
      rawDate: tx.date,
      actualDateTime: formatActualDateTimeAr(tx.createdAt, tx.date),
      rawCreatedAt: tx.createdAt || tx.date,
      profit: 0,
      costValue: 0,
      barcode: '',
      displayId: tx.transactionNumber || tx.id,
      invoiceNumber: invNo,
      branchName,
      warehouseId: linkedWarehouseId,
      cashboxId: tx.cashboxId,
      cashboxName,
      notes: tx.notes || tx.description || '',
      discount: 0,
      profitPercent: 0,
      customerId: custId,
      supplierId: suppId,
      representativeId: linkedInv?.representativeId,
      partyName,
      rowTone: classified.bucket === 'cash_payment' ? 'cash_green' : 'warning_rose',
      scopeType: 'cash',
    };

    if (!matchesCommonFilters(row)) continue;

    if (classified.bucket === 'cash_payment') {
      if (classified.sub === 'customer') cashPaymentCustomerRows.push(row);
      else if (classified.sub === 'supplier') cashPaymentSupplierRows.push(row);
      else if (classified.sub === 'employee') cashPaymentEmployeeRows.push(row);
      else cashPaymentGeneralRows.push(row);
    } else {
      if (classified.sub === 'customer') cashWithdrawalCustomerRows.push(row);
      else if (classified.sub === 'supplier') cashWithdrawalSupplierRows.push(row);
      else cashWithdrawalGeneralRows.push(row);
    }
  }

  // ============================================================================
  // Grouping Builders for Grouped Sales Reports
  // ============================================================================
  const buildAggregatedSection = (sectionKey, title, rows, groupKeyFn, groupTitleFn, { byUnit = false, multiSection = false } = {}) => {
    const groupsMap = new Map();
    for (const r of rows) {
      const gKey = groupKeyFn(r);
      if (!groupsMap.has(gKey)) {
        groupsMap.set(gKey, { key: gKey, label: groupTitleFn(r), rowsMap: new Map() });
      }
      const g = groupsMap.get(gKey);
      const itemKey = byUnit ? `${r.productId}::${r.unit}` : `${r.productId}`;
      if (!g.rowsMap.has(itemKey)) {
        g.rowsMap.set(itemKey, {
          ...r,
          rowId: `AGG-${sectionKey}-${gKey}-${itemKey}`,
          docType: 'product_aggregate',
          docId: r.productId,
          unit: byUnit ? r.unit : (r.baseUnit || r.unit),
          quantity: 0,
          valueOrPaid: 0,
          costValue: 0,
          profit: 0,
          discount: 0,
          countDocs: 0,
          invoiceNumbers: new Set(),
        });
      }
      const agg = g.rowsMap.get(itemKey);
      const qtyToAdd = byUnit ? Number(r.quantity || 0) : Number(r.baseQuantity || r.quantity || 0);
      agg.quantity = round3(agg.quantity + qtyToAdd);
      agg.valueOrPaid = round2(agg.valueOrPaid + Number(r.valueOrPaid || 0));
      agg.costValue = round2(agg.costValue + Number(r.costValue || 0));
      agg.profit = round2(agg.profit + Number(r.profit || 0));
      agg.discount = round2(agg.discount + Number(r.discount || 0));
      agg.countDocs += 1;
      if (r.invoiceNumber) agg.invoiceNumbers.add(r.invoiceNumber);
    }

    const sectionsOut = [];
    for (const g of groupsMap.values()) {
      const finalizedRows = Array.from(g.rowsMap.values()).map((agg) => {
        const avgPrice = agg.quantity > 0 ? round2(agg.valueOrPaid / agg.quantity) : 0;
        const pct = calcProfitPctOnCost(agg.profit, agg.costValue);
        const invArr = Array.from(agg.invoiceNumbers);
        return {
          ...agg,
          priceOrTotal: avgPrice,
          profitPercent: pct,
          movementOrRemaining: `${agg.countDocs} حركة (${invArr.length} فاتورة)`,
          invoiceNumber: invArr.length === 1 ? invArr[0] : `${invArr.length} فاتورة`,
          invoiceNumbers: undefined,
        };
      });
      sectionsOut.push(makeSection(multiSection ? `${sectionKey}_${g.key}` : sectionKey, multiSection ? g.label : title, 'sage', false, finalizedRows));
    }
    if (sectionsOut.length === 0 && !multiSection) {
      sectionsOut.push(makeSection(sectionKey, title, 'sage', false, []));
    }
    return sectionsOut;
  };

  function makeSection(key, title, theme, isInvoiceLayout, rows, options = {}) {
    const qtySum = round3(rows.reduce((s, r) => s + Number(r.quantity || 0), 0));
    const priceSum = isInvoiceLayout ? round2(rows.reduce((s, r) => s + Number(r.priceOrTotal || 0), 0)) : null;
    const valueSum = round2(rows.reduce((s, r) => s + Number(r.valueOrPaid || 0), 0));
    const remainingSum = isInvoiceLayout ? round2(rows.reduce((s, r) => s + Number(r.movementOrRemaining || 0), 0)) : null;
    const profitSum = round2(rows.reduce((s, r) => s + Number(r.profit || 0), 0));
    const costSum = round2(rows.reduce((s, r) => s + Number(r.costValue || 0), 0));
    const discountSum = round2(rows.reduce((s, r) => s + Number(r.discount || 0), 0));
    const profitPct = calcProfitPctOnCost(profitSum, costSum);

    return {
      key,
      title,
      theme, // 'sage' | 'slate'
      isInvoiceLayout,
      cashHighlightCol: Boolean(options.cashHighlightCol),
      rows,
      totals: {
        count: rows.length,
        quantity: qtySum,
        priceOrTotal: priceSum,
        valueOrPaid: valueSum,
        remaining: remainingSum,
        profit: profitSum,
        costValue: costSum,
        discount: discountSum,
        profitPercent: profitPct,
      },
    };
  }

  // ============================================================================
  // Assemble sections according to selected «نوع التقرير»
  // ============================================================================
  let sections = [];
  switch (reportType) {
    case 'sales_items':
      sections = [makeSection('sales_items', 'اصناف بيع', 'sage', false, salesItemRows)];
      break;
    case 'sales_invoices':
      sections = [makeSection('sales_invoices', 'فواتير بيع', 'sage', true, salesInvoiceRows)];
      break;
    case 'sales_items_by_unit':
      sections = buildAggregatedSection('sales_items_by_unit', 'اصناف بيع/ بالوحدة', salesItemRows, () => 'all', () => 'اصناف بيع/ بالوحدة', { byUnit: true });
      break;
    case 'sales_items_grouped':
      sections = buildAggregatedSection('sales_items_grouped', 'اصناف بيع/مَجمع', salesItemRows, () => 'all', () => 'اصناف بيع/مَجمع', { byUnit: false });
      break;
    case 'sales_items_grouped_by_customer':
      sections = buildAggregatedSection(
        'sales_cust',
        'اصناف بيع/مَجمع حسب العميل',
        salesItemRows,
        (r) => r.customerId || r.partyName || 'cash_customer',
        (r) => `اصناف بيع مَجمعة — العميل: ${r.partyName || 'عميل نقدي'}`,
        { byUnit: false, multiSection: true }
      );
      break;
    case 'sales_items_grouped_by_category':
      sections = buildAggregatedSection(
        'sales_cat',
        'اصناف بيع/مَجمع حسب المجموعة',
        salesItemRows,
        (r) => r.categoryName || 'عام',
        (r) => `اصناف بيع مَجمعة — المجموعة: ${r.categoryName || 'عام'}`,
        { byUnit: false, multiSection: true }
      );
      break;
    case 'sales_items_grouped_by_category_class1':
      sections = buildAggregatedSection(
        'sales_cat_c1',
        'اصناف بيع/مَجمع حسب المجموعة وتصنيف 1',
        salesItemRows,
        (r) => `${r.categoryName || 'عام'} || ${r.class1 || 'بدون تصنيف 1'}`,
        (r) => `المجموعة: ${r.categoryName || 'عام'} — تصنيف 1: ${r.class1 || 'بدون تصنيف 1'}`,
        { byUnit: false, multiSection: true }
      );
      break;

    case 'sales_return_items':
      sections = [makeSection('sales_return_items', 'اصناف مرتجع بيع', 'sage', false, salesReturnItemRows)];
      break;
    case 'sales_return_invoices':
      sections = [makeSection('sales_return_invoices', 'فواتير مرتجع بيع', 'sage', true, salesReturnInvoiceRows)];
      break;

    case 'purchase_items':
      sections = [makeSection('purchase_items', 'اصناف شراء', 'sage', false, purchaseItemRows)];
      break;
    case 'purchase_invoices':
      sections = [makeSection('purchase_invoices', 'فواتير شراء', 'sage', true, purchaseInvoiceRows)];
      break;

    case 'purchase_return_items':
      sections = [makeSection('purchase_return_items', 'اصناف مرتجع شراء', 'sage', false, purchaseReturnItemRows)];
      break;
    case 'purchase_return_invoices':
      sections = [makeSection('purchase_return_invoices', 'فواتير مرتجع شراء', 'sage', true, purchaseReturnInvoiceRows)];
      break;

    case 'damaged_items':
      sections = [makeSection('damaged_items', 'اصناف تالف', 'sage', false, damagedItemRows)];
      break;
    case 'damaged_invoices':
      sections = [makeSection('damaged_invoices', 'فواتير تالف', 'sage', true, damagedInvoiceRows)];
      break;

    case 'cash_payment':
      sections = [
        ...(cashPaymentCustomerRows.length > 0 ? [makeSection('cash_payment_customer', 'سداد نقدى | عميل', 'slate', false, cashPaymentCustomerRows, { cashHighlightCol: true })] : []),
        ...(cashPaymentSupplierRows.length > 0 ? [makeSection('cash_payment_supplier', 'سداد نقدى | مورد', 'slate', false, cashPaymentSupplierRows, { cashHighlightCol: true })] : []),
        ...(cashPaymentEmployeeRows.length > 0 ? [makeSection('cash_payment_employee', 'سداد نقدى | موظف', 'slate', false, cashPaymentEmployeeRows, { cashHighlightCol: true })] : []),
        ...(cashPaymentGeneralRows.length > 0 ? [makeSection('cash_payment_general', 'سداد نقدى | عام وإيداعات', 'slate', false, cashPaymentGeneralRows, { cashHighlightCol: true })] : []),
      ];
      if (sections.length === 0) {
        sections = [makeSection('cash_payment', 'سداد نقدى', 'slate', false, [], { cashHighlightCol: true })];
      }
      break;
    case 'cash_payment_customer':
      sections = [makeSection('cash_payment_customer', 'سداد نقدى | عميل', 'slate', false, cashPaymentCustomerRows, { cashHighlightCol: true })];
      break;
    case 'cash_payment_supplier':
      sections = [makeSection('cash_payment_supplier', 'سداد نقدى | مورد', 'slate', false, cashPaymentSupplierRows, { cashHighlightCol: true })];
      break;
    case 'cash_payment_employee':
      sections = [makeSection('cash_payment_employee', 'سداد نقدى | موظف', 'slate', false, cashPaymentEmployeeRows, { cashHighlightCol: true })];
      break;

    case 'cash_withdrawal':
      sections = [
        ...(cashWithdrawalCustomerRows.length > 0 ? [makeSection('cash_withdrawal_customer', 'سحب نقدى | عميل', 'slate', false, cashWithdrawalCustomerRows)] : []),
        ...(cashWithdrawalSupplierRows.length > 0 ? [makeSection('cash_withdrawal_supplier', 'سحب نقدى | مورد', 'slate', false, cashWithdrawalSupplierRows)] : []),
        ...(cashWithdrawalGeneralRows.length > 0 ? [makeSection('cash_withdrawal_general', 'سحب نقدى | عام ومصروفات', 'slate', false, cashWithdrawalGeneralRows)] : []),
      ];
      if (sections.length === 0) {
        sections = [makeSection('cash_withdrawal', 'سحب نقدى', 'slate', false, [])];
      }
      break;
    case 'cash_withdrawal_customer':
      sections = [makeSection('cash_withdrawal_customer', 'سحب نقدى | عميل', 'slate', false, cashWithdrawalCustomerRows)];
      break;
    case 'cash_withdrawal_supplier':
      sections = [makeSection('cash_withdrawal_supplier', 'سحب نقدى | مورد', 'slate', false, cashWithdrawalSupplierRows)];
      break;

    case 'all':
    default: {
      const candidateSections = [
        makeSection('sales_items', 'اصناف بيع', 'sage', false, salesItemRows),
        makeSection('sales_invoices', 'فواتير بيع', 'sage', true, salesInvoiceRows),
        makeSection('sales_return_items', 'اصناف مرتجع بيع', 'sage', false, salesReturnItemRows),
        makeSection('sales_return_invoices', 'فواتير مرتجع بيع', 'sage', true, salesReturnInvoiceRows),
        makeSection('purchase_items', 'اصناف شراء', 'sage', false, purchaseItemRows),
        makeSection('purchase_invoices', 'فواتير شراء', 'sage', true, purchaseInvoiceRows),
        makeSection('purchase_return_items', 'اصناف مرتجع شراء', 'sage', false, purchaseReturnItemRows),
        makeSection('purchase_return_invoices', 'فواتير مرتجع شراء', 'sage', true, purchaseReturnInvoiceRows),
        makeSection('damaged_items', 'اصناف تالف', 'sage', false, damagedItemRows),
        makeSection('damaged_invoices', 'فواتير تالف', 'sage', true, damagedInvoiceRows),
        makeSection('cash_payment_customer', 'سداد نقدى | عميل', 'slate', false, cashPaymentCustomerRows, { cashHighlightCol: true }),
        makeSection('cash_payment_supplier', 'سداد نقدى | مورد', 'slate', false, cashPaymentSupplierRows, { cashHighlightCol: true }),
        makeSection('cash_payment_employee', 'سداد نقدى | موظف', 'slate', false, cashPaymentEmployeeRows, { cashHighlightCol: true }),
        makeSection('cash_payment_general', 'سداد نقدى | عام وإيداعات', 'slate', false, cashPaymentGeneralRows, { cashHighlightCol: true }),
        makeSection('cash_withdrawal_customer', 'سحب نقدى | عميل', 'slate', false, cashWithdrawalCustomerRows),
        makeSection('cash_withdrawal_supplier', 'سحب نقدى | مورد', 'slate', false, cashWithdrawalSupplierRows),
        makeSection('cash_withdrawal_general', 'سحب نقدى | عام ومصروفات', 'slate', false, cashWithdrawalGeneralRows),
      ];
      sections = candidateSections.filter((s) => s.rows.length > 0);
      break;
    }
  }

  // ============================================================================
  // Bottom Bar Exact Reconciliation:
  //   carriedFromYesterday (مرحل من الأمس)
  // + reportCashNet        (رصيد التقرير)
  // = drawerBalance        (رصيد الدرج)
  // + reportProfit         (ربح التقرير)
  // ============================================================================
  let targetCashboxes = data.cashboxes || [];
  if (cashboxId) {
    targetCashboxes = targetCashboxes.filter((c) => c.id === cashboxId);
  } else if (branchCashboxId) {
    targetCashboxes = targetCashboxes.filter((c) => c.id === branchCashboxId);
  }
  const targetCashboxSet = new Set(targetCashboxes.map((c) => c.id));
  const cashboxNameToId = new Map((data.cashboxes || []).map((c) => [String(c.name || '').trim(), c.id]));

  const liveCashBalance = round2(targetCashboxes.reduce((s, c) => s + Number(c.currentBalance || 0), 0));
  let deltaAfterDateTo = 0;
  let periodCashNet = 0;

  for (const tx of data.financialTransactions || []) {
    const txDate = String(tx.date || '').split('T')[0];
    const delta = computeSignedCashDelta(tx, targetCashboxSet, cashboxNameToId);
    if (!delta) continue;
    if (dateTo && txDate && txDate > dateTo) {
      deltaAfterDateTo = round2(deltaAfterDateTo + delta);
    } else if ((!dateFrom || !txDate || txDate >= dateFrom) && (!dateTo || !txDate || txDate <= dateTo)) {
      periodCashNet = round2(periodCashNet + delta);
    }
  }

  const drawerBalance = round2(liveCashBalance - deltaAfterDateTo);
  const reportBalance = round2(periodCashNet);
  const carriedFromYesterday = round2(drawerBalance - reportBalance);

  // Net Report Profit (do NOT double-count invoice rows + item rows in 'all'!)
  let reportProfit = 0;
  let reportCost = 0;
  if (
    reportType === 'all' ||
    reportType === 'sales_items' ||
    reportType === 'sales_items_by_unit' ||
    reportType === 'sales_items_grouped' ||
    reportType === 'sales_items_grouped_by_customer' ||
    reportType === 'sales_items_grouped_by_category' ||
    reportType === 'sales_items_grouped_by_category_class1'
  ) {
    const salesProfit = salesItemRows.reduce((s, r) => s + Number(r.profit || 0), 0);
    const salesCost = salesItemRows.reduce((s, r) => s + Number(r.costValue || 0), 0);
    const retProfit = reportType === 'all' ? salesReturnItemRows.reduce((s, r) => s + Number(r.profit || 0), 0) : 0;
    const dmgLoss = reportType === 'all' ? damagedItemRows.reduce((s, r) => s + Number(r.profit || 0), 0) : 0;
    reportProfit = round2(salesProfit + retProfit + dmgLoss);
    reportCost = round2(salesCost);
  } else if (reportType === 'sales_invoices') {
    reportProfit = round2(salesInvoiceRows.reduce((s, r) => s + Number(r.profit || 0), 0));
    reportCost = round2(salesInvoiceRows.reduce((s, r) => s + Number(r.costValue || 0), 0));
  } else if (reportType === 'sales_return_items' || reportType === 'sales_return_invoices') {
    const targetRows = reportType === 'sales_return_items' ? salesReturnItemRows : salesReturnInvoiceRows;
    reportProfit = round2(targetRows.reduce((s, r) => s + Number(r.profit || 0), 0));
    reportCost = round2(targetRows.reduce((s, r) => s + Number(r.costValue || 0), 0));
  } else if (reportType === 'damaged_items' || reportType === 'damaged_invoices') {
    const targetRows = reportType === 'damaged_items' ? damagedItemRows : damagedInvoiceRows;
    reportProfit = round2(targetRows.reduce((s, r) => s + Number(r.profit || 0), 0));
    reportCost = round2(targetRows.reduce((s, r) => s + Number(r.costValue || 0), 0));
  }

  // Filter totals across visible sections (for informational sub-metrics)
  const filteredSalesNet = round2(
    salesItemRows.reduce((s, r) => s + Number(r.valueOrPaid || 0), 0) -
    salesReturnItemRows.reduce((s, r) => s + Number(r.valueOrPaid || 0), 0)
  );
  const filteredPurchasesNet = round2(
    purchaseItemRows.reduce((s, r) => s + Number(r.valueOrPaid || 0), 0) -
    purchaseReturnItemRows.reduce((s, r) => s + Number(r.valueOrPaid || 0), 0)
  );
  const filteredCashIn = round2(
    [...cashPaymentCustomerRows, ...cashPaymentGeneralRows].reduce((s, r) => s + Number(r.valueOrPaid || 0), 0)
  );
  const filteredCashOut = round2(
    [...cashPaymentSupplierRows, ...cashPaymentEmployeeRows, ...cashWithdrawalCustomerRows, ...cashWithdrawalSupplierRows, ...cashWithdrawalGeneralRows]
      .reduce((s, r) => s + Number(r.valueOrPaid || 0), 0)
  );

  // ============================================================================
  // Optional Full Item Lifecycle + Per-Item P&L (when productId selected OR includeItemPnl=true)
  // ============================================================================
  const itemLifecycle = productId ? buildProductLifecycleHistory(productId, data, resolvers, { dateFrom, dateTo, warehouseId }) : null;
  const itemPnlList = buildProductsPnlAnalysis(data, { dateFrom, dateTo, warehouseId, branchWarehouseId, productId, customerId, supplierId, userMatchKeys });

  return {
    reportType,
    reportTypeLabel: REPORT_TYPES_LIST.find((t) => t.key === reportType)?.label || 'الكل',
    reportTypes: REPORT_TYPES_LIST,
    filters: {
      dateFrom,
      dateTo,
      branchId: branchId || 'all',
      warehouseId: warehouseId || 'all',
      cashboxId: cashboxId || 'all',
      productId: productId || 'all',
      productSearch,
      barcode,
      customerId: customerId || 'all',
      supplierId: supplierId || 'all',
      employeeId: filters.employeeId || 'all',
      userId: filters.userId || 'all',
      representativeId: representativeId || 'all',
      invoiceNumber,
      recordId,
      search,
    },
    filterOptions: {
      branches: resolvers.branches,
      warehouses: data.warehouses || [],
      cashboxes: data.cashboxes || [],
      products: (data.products || []).map((p) => ({
        id: p.id,
        code: p.code,
        barcode: p.barcode,
        name: p.name,
        category: p.category,
        baseUnit: p.baseUnit,
        size: p.size,
        color: p.color,
      })),
      customers: (data.customers || []).map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
      suppliers: (data.suppliers || []).map((s) => ({ id: s.id, name: s.name, phone: s.phone })),
      employees: (data.employees || []).map((e) => ({ id: e.id, name: e.name, jobTitle: e.jobTitle })),
      representatives: (data.representatives || []).map((r) => ({ id: r.id, name: r.name, warehouseId: r.warehouseId })),
      users: (data.users || []).map((u) => ({ id: u.id, fullName: u.fullName, username: u.username, role: u.role })),
    },
    sections,
    summary: {
      drawerBalance,
      reportBalance,
      carriedFromYesterday,
      reportProfit,
      reportProfitPercent: calcProfitPctOnCost(reportProfit, reportCost),
      filteredSalesNet,
      filteredPurchasesNet,
      filteredCashIn,
      filteredCashOut,
      totalRows: sections.reduce((s, sec) => s + sec.rows.length, 0),
    },
    itemLifecycle,
    itemPnl: {
      selectedItem: productId ? (itemPnlList[0] || null) : null,
      items: itemPnlList,
      portfolioTotals: itemPnlList.reduce(
        (acc, it) => ({
          totalPurchaseValue: round2(acc.totalPurchaseValue + it.totalPurchaseValue),
          totalSalesValue: round2(acc.totalSalesValue + it.totalSalesValue),
          netSalesValue: round2(acc.netSalesValue + it.netSalesValue),
          cogs: round2(acc.cogs + it.cogs),
          totalDiscounts: round2(acc.totalDiscounts + it.totalDiscounts),
          salesReturnsValue: round2(acc.salesReturnsValue + it.salesReturnsValue),
          purchaseReturnsValue: round2(acc.purchaseReturnsValue + it.purchaseReturnsValue),
          allocatedExpenses: round2(acc.allocatedExpenses + it.allocatedExpenses),
          grossProfit: round2(acc.grossProfit + it.grossProfit),
          netProfit: round2(acc.netProfit + it.netProfit),
          totalLoss: round2(acc.totalLoss + it.totalLoss),
          stockValuation: round2(acc.stockValuation + it.currentStockValue),
        }),
        {
          totalPurchaseValue: 0,
          totalSalesValue: 0,
          netSalesValue: 0,
          cogs: 0,
          totalDiscounts: 0,
          salesReturnsValue: 0,
          purchaseReturnsValue: 0,
          allocatedExpenses: 0,
          grossProfit: 0,
          netProfit: 0,
          totalLoss: 0,
          stockValuation: 0,
        }
      ),
    },
  };
}

function buildProductLifecycleHistory(productId, data, resolvers, filterOpts = {}) {
  const prod = (data.products || []).find((p) => p.id === productId);
  if (!prod) return null;

  const events = [];
  const invoiceMap = new Map((data.invoices || []).map((i) => [i.id, i]));
  const filterWh = filterOpts.warehouseId || null;

  // 1. Creation Event
  events.push({
    id: `LC-CREATE-${prod.id}`,
    sortTime: prod.createdAt || '1970-01-01T00:00:00.000Z',
    date: isoDateOnly(prod.createdAt),
    actualDateTime: formatActualDateTimeAr(prod.createdAt),
    eventType: 'product_created',
    eventLabel: 'تأسيس وإضافة الصنف بالنظام',
    docType: 'product',
    docId: prod.id,
    docNumber: prod.code || prod.id,
    warehouseName: 'بطاقة الصنف',
    partyName: prod.category || '-',
    unit: prod.baseUnit,
    qty: 0,
    qtyIn: 0,
    qtyOut: 0,
    unitPrice: Number(prod.sellingPrice || 0),
    unitCost: Number(prod.purchasePrice || 0),
    totalValue: 0,
    userName: '-',
    notes: `سعر الشراء الافتتاحي: ${prod.purchasePrice} | سعر البيع: ${prod.sellingPrice}`,
  });

  // Track documented reference IDs to prevent double counting stockMovements with invoices/returns/transfers/counts
  const handledDocRefs = new Set();

  // 2. Confirmed Sales & Purchase Invoices (untouched confirmed invoices use invoice rows; edited/cancelled invoices with stock movements use chronological movements below so edits & cancellations never distort running balance)
  let lastPurchasePriceSeen = null;
  let lastSalePriceSeen = null;
  const stockMovementsByRef = new Map();
  for (const sm of data.stockMovements || []) {
    if (sm.productId !== productId || !sm.referenceId) continue;
    const list = stockMovementsByRef.get(sm.referenceId) || [];
    list.push(sm);
    stockMovementsByRef.set(sm.referenceId, list);
  }

  const movementDrivenInvoiceIds = new Set();
  const chronoInvoices = [...(data.invoices || [])]
    .filter((i) => (i.status === 'confirmed' || i.status === 'cancelled') && (i.type === 'sales' || i.type === 'purchase'))
    .sort((a, b) => String(a.createdAt || a.date).localeCompare(String(b.createdAt || b.date)));

  for (const inv of chronoInvoices) {
    const invMvs = stockMovementsByRef.get(inv.id) || [];
    const hasEditsOrCancel = inv.status === 'cancelled' || (Array.isArray(inv.editHistory) && inv.editHistory.length > 0);
    if (hasEditsOrCancel && invMvs.length > 0) {
      movementDrivenInvoiceIds.add(inv.id);
      if (inv.status === 'confirmed' && Array.isArray(inv.editHistory)) {
        for (const ed of inv.editHistory) {
          const matchingMv = invMvs.find(
            (m) => (m.type === 'sale_edit' || m.type === 'purchase_edit') && m.createdAt === ed.editedAt
          );
          if (!matchingMv && (!filterWh || inv.warehouseId === filterWh)) {
            const isSales = inv.type === 'sales';
            const edIt = (ed.after?.items || []).find((x) => x.productId === productId) || (ed.before?.items || []).find((x) => x.productId === productId);
            events.push({
              id: `LC-IEDT-${inv.id}-${ed.id}`,
              sortTime: ed.editedAt || inv.updatedAt || inv.createdAt,
              date: isoDateOnly(ed.editedAt || inv.date),
              actualDateTime: formatActualDateTimeAr(ed.editedAt, inv.date),
              eventType: isSales ? 'sale_edit' : 'purchase_edit',
              eventLabel: isSales ? 'تعديل فاتورة مبيعات' : 'تعديل فاتورة مشتريات',
              docType: isSales ? 'sales_invoice' : 'purchase_invoice',
              docId: inv.id,
              docNumber: inv.invoiceNumber,
              warehouseName: ed.after?.warehouseName || inv.warehouseName,
              partyName: isSales ? (inv.customerName || 'عميل نقدي') : (ed.after?.supplierName || inv.supplierName || 'مورد نقدي'),
              unit: edIt?.unit || prod.baseUnit,
              qty: Number(edIt?.quantity || 0),
              qtyIn: 0,
              qtyOut: 0,
              unitPrice: round2(edIt?.unitPrice || 0),
              unitCost: round2(edIt?.purchasePriceAtTime || prod.purchasePrice || 0),
              totalValue: round2(edIt?.total || 0),
              userName: ed.editedBy || inv.editedBy || inv.createdBy,
              notes: ed.reason ? `تعديل الفاتورة - ${ed.reason}` : 'تعديل أسعار/بيانات الفاتورة',
            });
          }
        }
      }
      continue;
    }
    if (inv.status !== 'confirmed') continue;
    if (filterWh && inv.warehouseId !== filterWh) continue;
    for (let idx = 0; idx < (inv.items || []).length; idx++) {
      const it = inv.items[idx];
      if (it.productId !== productId) continue;
      handledDocRefs.add(inv.id);
      const isSales = inv.type === 'sales';
      const uf = Number(it.unitFactor || resolveUnitFactor(prod, it.unit) || 1);
      const qty = Number(it.quantity || 0);
      const baseQty = round3(qty * uf);
      const baseUnitPrice = round2(Number(it.unitPrice || 0) / uf);
      const lineTotal = round2(it.total ?? Number(it.unitPrice || 0) * qty - Number(it.discount || 0));

      if (!isSales && lastPurchasePriceSeen !== null && Math.abs(lastPurchasePriceSeen - baseUnitPrice) > 0.01) {
        events.push({
          id: `LC-PCHG-${inv.id}-${idx}`,
          sortTime: inv.createdAt || `${inv.date}T00:00:00.000Z`,
          date: inv.date,
          actualDateTime: formatActualDateTimeAr(inv.createdAt, inv.date),
          eventType: 'price_change',
          eventLabel: 'تغير سعر الشراء',
          docType: 'purchase_invoice',
          docId: inv.id,
          docNumber: inv.invoiceNumber,
          warehouseName: inv.warehouseName,
          partyName: inv.supplierName || '-',
          unit: prod.baseUnit,
          qty: 0,
          qtyIn: 0,
          qtyOut: 0,
          unitPrice: baseUnitPrice,
          unitCost: lastPurchasePriceSeen,
          totalValue: 0,
          userName: inv.createdBy,
          notes: `تغير سعر شراء الوحدة الأساسية من ${lastPurchasePriceSeen} إلى ${baseUnitPrice}`,
        });
      }
      if (!isSales) lastPurchasePriceSeen = baseUnitPrice;

      if (isSales && lastSalePriceSeen !== null && Math.abs(lastSalePriceSeen - baseUnitPrice) > 0.01) {
        events.push({
          id: `LC-SCHG-${inv.id}-${idx}`,
          sortTime: inv.createdAt || `${inv.date}T00:00:00.000Z`,
          date: inv.date,
          actualDateTime: formatActualDateTimeAr(inv.createdAt, inv.date),
          eventType: 'price_change',
          eventLabel: 'تغير سعر البيع',
          docType: 'sales_invoice',
          docId: inv.id,
          docNumber: inv.invoiceNumber,
          warehouseName: inv.warehouseName,
          partyName: inv.customerName || 'عميل نقدي',
          unit: prod.baseUnit,
          qty: 0,
          qtyIn: 0,
          qtyOut: 0,
          unitPrice: baseUnitPrice,
          unitCost: lastSalePriceSeen,
          totalValue: 0,
          userName: inv.createdBy,
          notes: `تغير سعر بيع الوحدة الأساسية من ${lastSalePriceSeen} إلى ${baseUnitPrice}`,
        });
      }
      if (isSales) lastSalePriceSeen = baseUnitPrice;

      events.push({
        id: `LC-INV-${inv.id}-${idx}`,
        sortTime: inv.createdAt || `${inv.date}T00:00:01.000Z`,
        date: inv.date,
        actualDateTime: formatActualDateTimeAr(inv.createdAt, inv.date),
        eventType: isSales ? 'sale' : 'purchase',
        eventLabel: isSales ? 'فاتورة مبيعات' : 'فاتورة مشتريات',
        docType: isSales ? 'sales_invoice' : 'purchase_invoice',
        docId: inv.id,
        docNumber: inv.invoiceNumber,
        warehouseName: inv.warehouseName,
        partyName: isSales ? (inv.customerName || 'عميل نقدي') : (inv.supplierName || 'مورد نقدي'),
        unit: it.unit,
        qty,
        qtyIn: isSales ? 0 : baseQty,
        qtyOut: isSales ? baseQty : 0,
        unitPrice: round2(it.unitPrice || 0),
        unitCost: round2(it.purchasePriceAtTime || prod.purchasePrice || 0),
        totalValue: lineTotal,
        userName: inv.createdBy,
        notes: inv.notes || '',
      });
    }
  }

  // 3. Returns
  for (const ret of data.invoiceReturns || []) {
    if (filterWh && ret.warehouseId !== filterWh) continue;
    for (let idx = 0; idx < (ret.items || []).length; idx++) {
      const it = ret.items[idx];
      if (it.productId !== productId) continue;
      handledDocRefs.add(ret.id);
      const isSalesRet = ret.type === 'sales_return';
      const uf = Number(it.unitFactor || resolveUnitFactor(prod, it.unit) || 1);
      const qty = Number(it.quantity || 0);
      const baseQty = round3(qty * uf);
      events.push({
        id: `LC-RET-${ret.id}-${idx}`,
        sortTime: ret.createdAt || `${ret.date}T00:00:00.000Z`,
        date: ret.date,
        actualDateTime: formatActualDateTimeAr(ret.createdAt, ret.date),
        eventType: ret.type,
        eventLabel: isSalesRet ? 'مرتجع مبيعات' : 'مرتجع مشتريات',
        docType: ret.type,
        docId: ret.id,
        docNumber: ret.returnNumber,
        warehouseName: ret.warehouseName,
        partyName: ret.partyName || '-',
        unit: it.unit,
        qty,
        qtyIn: isSalesRet ? baseQty : 0,
        qtyOut: isSalesRet ? 0 : baseQty,
        unitPrice: round2(it.unitPrice || 0),
        unitCost: round2(prod.purchasePrice || 0),
        totalValue: round2(it.total || 0),
        userName: ret.createdBy,
        notes: ret.reason || ret.notes || '',
      });
    }
  }

  // 4. Rep Custody Operations
  for (const op of data.repCustodyOperations || []) {
    if (op.productId !== productId || op.status === 'rejected') continue;
    if (op.operationType === 'delivered_to_customer' && op.invoiceId && invoiceMap.has(op.invoiceId)) {
      continue;
    }
    handledDocRefs.add(op.id);
    const bQty = Number(op.baseQuantity || op.quantity || 0);
    const isReturn = op.operationType === 'returned_to_warehouse';
    const affectsFilterWh = !filterWh || op.warehouseId === filterWh || op.targetWarehouseId === filterWh;
    if (!affectsFilterWh) continue;
    events.push({
      id: `LC-RCO-${op.id}`,
      sortTime: op.createdAt || `${op.date}T00:00:00.000Z`,
      date: op.date,
      actualDateTime: formatActualDateTimeAr(op.createdAt, op.date),
      eventType: op.operationType,
      eventLabel:
        op.operationType === 'custody_damaged'
          ? 'تالف عهدة مندوب'
          : op.operationType === 'returned_to_warehouse'
          ? 'رد عهدة للمستودع'
          : op.operationType === 'delivered_to_customer'
          ? 'تسليم عهدة لعميل'
          : 'تسوية عهدة مندوب',
      docType: 'rep_custody',
      docId: op.id,
      docNumber: op.operationNumber,
      warehouseName: op.warehouseName || op.representativeName,
      partyName: op.customerName || op.representativeName,
      unit: op.unit,
      qty: Number(op.quantity || 0),
      qtyIn: isReturn ? (filterWh && op.warehouseId === filterWh ? bQty : 0) : 0,
      qtyOut: isReturn ? 0 : bQty,
      unitPrice: Number(prod.purchasePrice || 0),
      unitCost: Number(prod.purchasePrice || 0),
      totalValue: round2(bQty * Number(prod.purchasePrice || 0)),
      userName: op.createdBy,
      notes: op.notes || '',
    });
  }

  // 5. Stock Movements (opening, transfer_in/out, adjustment, damaged, stock_count, and movement-driven invoice create/edit/cancel events)
  for (const sm of data.stockMovements || []) {
    if (sm.productId !== productId) continue;
    if (sm.referenceId && handledDocRefs.has(sm.referenceId)) continue;
    const isInvAuditMovement = ['sale', 'purchase', 'sale_edit', 'purchase_edit', 'sale_cancel', 'purchase_cancel'].includes(sm.type);
    if (isInvAuditMovement) {
      if (!sm.referenceId || !movementDrivenInvoiceIds.has(sm.referenceId)) continue;
    } else if (['sales_return', 'purchase_return', 'custody_delivery', 'custody_return'].includes(sm.type)) {
      continue;
    }
    if (filterWh && sm.warehouseId !== filterWh) continue;

    const bQty = Number(sm.quantity || 0);
    let qtyIn = 0;
    let qtyOut = 0;
    if (isInvAuditMovement) {
      let signedDelta;
      if (sm.balanceBefore !== undefined && sm.balanceBefore !== null && sm.balanceAfter !== undefined && sm.balanceAfter !== null) {
        signedDelta = round3(Number(sm.balanceAfter) - Number(sm.balanceBefore));
      } else {
        signedDelta = sm.type === 'purchase' || sm.type === 'sale_cancel' ? bQty : -bQty;
      }
      qtyIn = signedDelta > 0 ? signedDelta : 0;
      qtyOut = signedDelta < 0 ? Math.abs(signedDelta) : 0;
    } else {
      const isIn = ['opening', 'opening_balance', 'transfer_in', 'custody_in'].includes(sm.type) ||
        (sm.type === 'adjustment' && String(sm.notes || '').includes('+'));
      const isOut = ['transfer_out', 'damaged', 'custody_out'].includes(sm.type) ||
        (sm.type === 'adjustment' && !String(sm.notes || '').includes('+'));
      qtyIn = isIn ? bQty : 0;
      qtyOut = isOut ? bQty : 0;
    }

    const labelMap = {
      opening: 'رصيد افتتاحي',
      opening_balance: 'رصيد افتتاحي',
      transfer_in: 'تحويل وارد للمخزن',
      transfer_out: 'تحويل صادر من المخزن',
      adjustment: 'تسوية / جرد مخزني',
      damaged: 'تالف ومنتهي الصلاحية',
      custody_in: 'استلام عهدة مندوب',
      custody_out: 'صرف عهدة مندوب',
      sale: 'فاتورة مبيعات',
      purchase: 'فاتورة مشتريات',
      sale_edit: 'تعديل فاتورة مبيعات',
      purchase_edit: 'تعديل فاتورة مشتريات',
      sale_cancel: 'إلغاء فاتورة مبيعات',
      purchase_cancel: 'إلغاء فاتورة مشتريات',
    };

    const linkedInv = sm.referenceId ? invoiceMap.get(sm.referenceId) : null;
    const invPartyName = linkedInv
      ? (linkedInv.type === 'sales' ? (linkedInv.customerName || 'عميل نقدي') : (linkedInv.supplierName || 'مورد نقدي'))
      : null;

    events.push({
      id: `LC-SM-${sm.id}`,
      sortTime: sm.createdAt || `${sm.date}T00:00:00.000Z`,
      date: sm.date,
      actualDateTime: formatActualDateTimeAr(sm.createdAt, sm.date),
      eventType: sm.type,
      eventLabel: labelMap[sm.type] || sm.type,
      docType: linkedInv ? (linkedInv.type === 'sales' ? 'sales_invoice' : 'purchase_invoice') : (sm.type === 'damaged' ? 'damaged_voucher' : 'stock_movement'),
      docId: sm.referenceId || sm.id,
      docNumber: sm.referenceNumber || sm.movementNumber || sm.id,
      warehouseName: sm.targetWarehouseName ? `${sm.warehouseName} ← ${sm.targetWarehouseName}` : sm.warehouseName,
      partyName: invPartyName || sm.targetWarehouseName || '-',
      unit: sm.unit || prod.baseUnit,
      qty: bQty,
      qtyIn,
      qtyOut,
      unitPrice: round2(sm.unitCost || prod.purchasePrice || 0),
      unitCost: round2(sm.unitCost || prod.purchasePrice || 0),
      totalValue: round2(bQty * Number(sm.unitCost || prod.purchasePrice || 0)),
      userName: sm.createdBy,
      notes: sm.notes || '',
    });
  }

  // 6. Audit logs for product updates (e.g. manual price edits)
  for (const log of data.auditLogs || []) {
    if (log.recordId !== productId || !String(log.action || '').includes('تحديث بيانات صنف')) continue;
    events.push({
      id: `LC-AUD-${log.id}`,
      sortTime: log.timestamp,
      date: isoDateOnly(log.timestamp),
      actualDateTime: formatActualDateTimeAr(log.timestamp),
      eventType: 'product_updated',
      eventLabel: 'تعديل بيانات / أسعار الصنف',
      docType: 'audit',
      docId: log.id,
      docNumber: prod.code,
      warehouseName: 'بطاقة الصنف',
      partyName: '-',
      unit: prod.baseUnit,
      qty: 0,
      qtyIn: 0,
      qtyOut: 0,
      unitPrice: Number(prod.sellingPrice || 0),
      unitCost: Number(prod.purchasePrice || 0),
      totalValue: 0,
      userName: log.userName,
      notes: log.notes || log.action,
    });
  }

  // Chronological ASC sort from day 1 to latest movement
  events.sort((a, b) => String(a.sortTime).localeCompare(String(b.sortTime)));

  let running = 0;
  let lastPurchasePrice = Number(prod.purchasePrice || 0);
  let lastPurchaseDate = null;
  let lastSalePrice = Number(prod.sellingPrice || 0);
  let lastSaleDate = null;

  const timeline = events.map((ev) => {
    running = round3(running + Number(ev.qtyIn || 0) - Number(ev.qtyOut || 0));
    if (ev.eventType === 'purchase') {
      lastPurchasePrice = ev.unitPrice;
      lastPurchaseDate = ev.date;
    } else if (ev.eventType === 'sale') {
      lastSalePrice = ev.unitPrice;
      lastSaleDate = ev.date;
    }
    return {
      ...ev,
      runningBalance: running,
    };
  });

  // Warehouse Breakdown
  const warehouseBalances = (data.warehouses || []).map((wh) => {
    const qty = Number(prod.stockPerWarehouse?.[wh.id] || 0);
    return {
      warehouseId: wh.id,
      warehouseName: wh.name,
      branchName: resolvers.resolveBranchName(wh.id, null),
      quantity: qty,
      costValue: round2(Math.max(0, qty) * Number(prod.purchasePrice || 0)),
      sellingValue: round2(Math.max(0, qty) * Number(prod.sellingPrice || 0)),
    };
  });

  const currentStockTotal = round3(
    filterWh
      ? Number(prod.stockPerWarehouse?.[filterWh] || 0)
      : Object.values(prod.stockPerWarehouse || {}).reduce((s, q) => s + Number(q || 0), 0)
  );

  // Filter visible timeline by optional date range while keeping true running balance!
  const filteredTimeline = timeline.filter((ev) => {
    if (filterOpts.dateFrom && ev.date && ev.date < filterOpts.dateFrom) return false;
    if (filterOpts.dateTo && ev.date && ev.date > filterOpts.dateTo) return false;
    return true;
  });

  return {
    product: {
      ...prod,
      class1: normalizeClassification1(prod),
      createdAtFormatted: formatActualDateTimeAr(prod.createdAt),
    },
    lastPurchasePrice,
    lastPurchaseDate,
    lastSalePrice,
    lastSaleDate,
    currentStockTotal,
    currentStockValueAtCost: round2(Math.max(0, currentStockTotal) * Number(prod.purchasePrice || 0)),
    warehouseBalances,
    timeline: filteredTimeline,
    fullCount: timeline.length,
  };
}

function buildProductsPnlAnalysis(data, filterOpts = {}) {
  const { dateFrom, dateTo, warehouseId, branchWarehouseId, productId, customerId, supplierId, userMatchKeys } = filterOpts;
  const effectiveWh = warehouseId || branchWarehouseId || null;

  const statsMap = new Map();
  const ensureStat = (prod) => {
    if (!statsMap.has(prod.id)) {
      const currentQty = round3(
        effectiveWh
          ? Number(prod.stockPerWarehouse?.[effectiveWh] || 0)
          : Object.values(prod.stockPerWarehouse || {}).reduce((s, q) => s + Number(q || 0), 0)
      );
      statsMap.set(prod.id, {
        productId: prod.id,
        code: prod.code,
        barcode: prod.barcode || '',
        productName: prod.name,
        category: prod.category,
        class1: normalizeClassification1(prod),
        baseUnit: prod.baseUnit,
        purchasePrices: [],
        salePrices: [],
        lastPurchasePrice: Number(prod.purchasePrice || 0),
        lastPurchaseDate: null,
        lastSalePrice: Number(prod.sellingPrice || 0),
        lastSaleDate: null,
        totalPurchaseQty: 0,
        totalPurchaseValue: 0,
        totalSalesQty: 0,
        totalSalesValue: 0,
        salesReturnsQty: 0,
        salesReturnsValue: 0,
        salesReturnsCost: 0,
        purchaseReturnsQty: 0,
        purchaseReturnsValue: 0,
        grossCogs: 0,
        totalDiscounts: 0,
        damagedQty: 0,
        damagedLossValue: 0,
        shortageQty: 0,
        shortageLossValue: 0,
        allocatedExpenses: 0,
        currentStockQty: currentQty,
        currentStockValue: round2(Math.max(0, currentQty) * Number(prod.purchasePrice || 0)),
        lossTransactions: [],
      });
    }
    return statsMap.get(prod.id);
  };

  const productMap = new Map((data.products || []).map((p) => [p.id, p]));
  if (productId && productMap.has(productId)) {
    ensureStat(productMap.get(productId));
  }

  const inPeriod = (dateStr) => {
    const d = String(dateStr || '').split('T')[0];
    if (dateFrom && d && d < dateFrom) return false;
    if (dateTo && d && d > dateTo) return false;
    return true;
  };

  const invoiceMap = new Map((data.invoices || []).map((i) => [i.id, i]));

  // 1. Confirmed Invoices
  const sortedInvoices = [...(data.invoices || [])]
    .filter((i) => i.status === 'confirmed' && (i.type === 'sales' || i.type === 'purchase'))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  for (const inv of sortedInvoices) {
    if (!inPeriod(inv.date)) continue;
    if (effectiveWh && inv.warehouseId !== effectiveWh) continue;
    if (userMatchKeys && !userMatchKeys.has(String(inv.createdBy || '').toLowerCase())) continue;
    if (inv.type === 'sales' && customerId && inv.customerId !== customerId) continue;
    if (inv.type === 'purchase' && supplierId && inv.supplierId !== supplierId) continue;

    const itemsList = inv.items || [];
    const itemsGrossSum = itemsList.reduce(
      (s, it) => s + Number(it.total ?? Number(it.unitPrice || 0) * Number(it.quantity || 0) - Number(it.discount || 0)),
      0
    );
    const extraInvDiscount = Math.max(0, round2(itemsGrossSum - Number(inv.grandTotal || 0)));

    for (const it of itemsList) {
      if (productId && it.productId !== productId) continue;
      const prod = productMap.get(it.productId);
      if (!prod) continue;
      const st = ensureStat(prod);
      const uf = Number(it.unitFactor || resolveUnitFactor(prod, it.unit) || 1);
      const baseQty = round3(Number(it.quantity || 0) * uf);
      const lineBeforeExtra = round2(it.total ?? Number(it.unitPrice || 0) * Number(it.quantity || 0) - Number(it.discount || 0));
      const shareExtraDisc = itemsGrossSum > 0 && extraInvDiscount > 0 ? round2((lineBeforeExtra / itemsGrossSum) * extraInvDiscount) : 0;
      const netLineVal = round2(lineBeforeExtra - shareExtraDisc);
      const lineDisc = round2(Number(it.discount || 0) + shareExtraDisc);
      const effectiveBasePrice = baseQty > 0 ? round2(netLineVal / baseQty) : 0;
      const grossBaseUnitPrice = uf > 0 ? round2(Number(it.unitPrice || 0) / uf) : Number(it.unitPrice || 0);

      if (inv.type === 'purchase') {
        st.totalPurchaseQty = round3(st.totalPurchaseQty + baseQty);
        st.totalPurchaseValue = round2(st.totalPurchaseValue + netLineVal);
        if (grossBaseUnitPrice > 0) {
          st.purchasePrices.push(grossBaseUnitPrice);
          st.lastPurchasePrice = grossBaseUnitPrice;
          st.lastPurchaseDate = inv.date;
        }
      } else {
        const costPerBase = Number(it.purchasePriceAtTime || 0) > 0 ? Number(it.purchasePriceAtTime) : Number(prod.purchasePrice || 0);
        const lineCost = round2(costPerBase * baseQty);
        st.totalSalesQty = round3(st.totalSalesQty + baseQty);
        st.totalSalesValue = round2(st.totalSalesValue + netLineVal);
        st.grossCogs = round2(st.grossCogs + lineCost);
        st.totalDiscounts = round2(st.totalDiscounts + lineDisc);
        if (grossBaseUnitPrice > 0) {
          st.salePrices.push(grossBaseUnitPrice);
          st.lastSalePrice = effectiveBasePrice || grossBaseUnitPrice;
          st.lastSaleDate = inv.date;
        }
        // Check loss-making sale (net revenue < COGS)
        const lineProfit = round2(netLineVal - lineCost);
        if (lineProfit < -0.01) {
          const lossAmt = round2(Math.abs(lineProfit));
          const reason = lineDisc > 0 && lineBeforeExtra + lineDisc >= lineCost
            ? `خصم مرتفع (${lineDisc}) أدى لبيع بسعر أقل من التكلفة`
            : `سعر البيع (${effectiveBasePrice}) أقل من التكلفة (${round2(costPerBase)})`;
          st.lossTransactions.push({
            id: `LOSS-${inv.id}-${it.productId}`,
            date: inv.date,
            actualDateTime: formatActualDateTimeAr(inv.createdAt, inv.date),
            docType: 'sales_invoice',
            docId: inv.id,
            docNumber: inv.invoiceNumber,
            partyName: inv.customerName || 'عميل نقدي',
            quantity: Number(it.quantity || 0),
            unit: it.unit,
            sellingPrice: effectiveBasePrice,
            costPrice: round2(costPerBase),
            discount: lineDisc,
            lossAmount: lossAmt,
            reason,
          });
        }
      }
    }
  }

  // 2. Returns
  for (const ret of data.invoiceReturns || []) {
    if (!inPeriod(ret.date)) continue;
    if (effectiveWh && ret.warehouseId !== effectiveWh) continue;
    if (userMatchKeys && !userMatchKeys.has(String(ret.createdBy || '').toLowerCase())) continue;
    const origInv = ret.originalInvoiceId ? invoiceMap.get(ret.originalInvoiceId) : null;
    if (ret.type === 'sales_return' && customerId) {
      const retCustomerId = origInv?.customerId || ret.partyId;
      if (retCustomerId !== customerId) continue;
    }
    if (ret.type === 'purchase_return' && supplierId) {
      const retSupplierId = origInv?.supplierId || ret.partyId;
      if (retSupplierId !== supplierId) continue;
    }
    for (const it of ret.items || []) {
      if (productId && it.productId !== productId) continue;
      const prod = productMap.get(it.productId);
      if (!prod) continue;
      const st = ensureStat(prod);
      const uf = Number(it.unitFactor || resolveUnitFactor(prod, it.unit) || 1);
      const baseQty = round3(Number(it.quantity || 0) * uf);
      const val = round2(it.total ?? Number(it.unitPrice || 0) * Number(it.quantity || 0));
      if (ret.type === 'sales_return') {
        const origIt = (origInv?.items || []).find((x) => x.productId === it.productId);
        const costPerBase = Number(origIt?.purchasePriceAtTime || prod.purchasePrice || 0);
        st.salesReturnsQty = round3(st.salesReturnsQty + baseQty);
        st.salesReturnsValue = round2(st.salesReturnsValue + val);
        st.salesReturnsCost = round2(st.salesReturnsCost + costPerBase * baseQty);
      } else {
        st.purchaseReturnsQty = round3(st.purchaseReturnsQty + baseQty);
        st.purchaseReturnsValue = round2(st.purchaseReturnsValue + val);
      }
    }
  }

  // 3. Damaged Stock & Inventory Shortage Losses
  for (const sm of data.stockMovements || []) {
    if (customerId || supplierId) continue;
    if (!inPeriod(sm.date)) continue;
    if (effectiveWh && sm.warehouseId !== effectiveWh) continue;
    if (productId && sm.productId !== productId) continue;
    if (sm.type !== 'damaged' && !(sm.type === 'adjustment' && String(sm.notes || '').includes('-'))) continue;
    const prod = productMap.get(sm.productId);
    if (!prod) continue;
    const st = ensureStat(prod);
    const bQty = Number(sm.quantity || 0);
    const cost = Number(sm.unitCost || prod.purchasePrice || 0);
    const lossAmt = round2(bQty * cost);
    if (sm.type === 'damaged') {
      st.damagedQty = round3(st.damagedQty + bQty);
      st.damagedLossValue = round2(st.damagedLossValue + lossAmt);
    } else {
      st.shortageQty = round3(st.shortageQty + bQty);
      st.shortageLossValue = round2(st.shortageLossValue + lossAmt);
    }
    if (lossAmt > 0) {
      st.lossTransactions.push({
        id: `LOSS-SM-${sm.id}`,
        date: sm.date,
        actualDateTime: formatActualDateTimeAr(sm.createdAt, sm.date),
        docType: sm.type === 'damaged' ? 'damaged_voucher' : 'stock_movement',
        docId: sm.referenceId || sm.id,
        docNumber: sm.referenceNumber || sm.movementNumber || sm.id,
        partyName: sm.warehouseName,
        quantity: bQty,
        unit: prod.baseUnit,
        sellingPrice: 0,
        costPrice: round2(cost),
        discount: 0,
        lossAmount: lossAmt,
        reason: sm.type === 'damaged' ? `توالف مخزنية: ${sm.notes || ''}` : `عجز جرد: ${sm.notes || ''}`,
      });
    }
  }

  // 4. Direct Expenses explicitly tagged to a product code/name in notes or category (never double count unallocated general overhead)
  for (const exp of data.expenseIncomes || []) {
    if (exp.type !== 'expense' || !inPeriod(exp.date)) continue;
    if (exp.productId && statsMap.has(exp.productId)) {
      const st = statsMap.get(exp.productId);
      st.allocatedExpenses = round2(st.allocatedExpenses + Number(exp.amount || 0));
    }
  }

  // Finalize Exact Formulas
  const results = [];
  for (const st of statsMap.values()) {
    const netSalesQty = round3(Math.max(0, st.totalSalesQty - st.salesReturnsQty));
    const netSalesValue = round2(st.totalSalesValue - st.salesReturnsValue);
    const netPurchaseQty = round3(Math.max(0, st.totalPurchaseQty - st.purchaseReturnsQty));
    const netPurchaseValue = round2(st.totalPurchaseValue - st.purchaseReturnsValue);
    const cogs = round2(Math.max(0, st.grossCogs - st.salesReturnsCost));
    const totalAllocatedExpenses = round2(st.allocatedExpenses + st.damagedLossValue + st.shortageLossValue);
    const grossProfit = round2(netSalesValue - cogs);
    // Prompt Formula: صافي الربح = صافي المبيعات - تكلفة البضاعة المباعة - المصروفات المحملة على الصنف
    const netProfit = round2(netSalesValue - cogs - totalAllocatedExpenses);
    const salesLossOnly = round2(
      st.lossTransactions
        .filter((l) => l.docType === 'sales_invoice')
        .reduce((s, l) => s + Number(l.lossAmount || 0), 0)
    );
    const totalLoss = round2(salesLossOnly + st.damagedLossValue + st.shortageLossValue);

    const avgPurchasePrice = st.totalPurchaseQty > 0
      ? round2(st.totalPurchaseValue / st.totalPurchaseQty)
      : Number(st.lastPurchasePrice || 0);
    const minPurchasePrice = st.purchasePrices.length > 0 ? round2(Math.min(...st.purchasePrices)) : avgPurchasePrice;
    const maxPurchasePrice = st.purchasePrices.length > 0 ? round2(Math.max(...st.purchasePrices)) : avgPurchasePrice;

    const avgSalePrice = st.totalSalesQty > 0
      ? round2(st.totalSalesValue / st.totalSalesQty)
      : Number(st.lastSalePrice || 0);
    const minSalePrice = st.salePrices.length > 0 ? round2(Math.min(...st.salePrices)) : avgSalePrice;
    const maxSalePrice = st.salePrices.length > 0 ? round2(Math.max(...st.salePrices)) : avgSalePrice;

    // Exact Prompt Ratios:
    // نسبة الربح على التكلفة = (صافي الربح ÷ تكلفة البضاعة المباعة) × 100
    const profitPercentOnCost = calcProfitPctOnCost(netProfit, cogs);
    // هامش الربح على المبيعات = (صافي الربح ÷ صافي المبيعات) × 100
    const profitMarginOnSales = calcMarginOnSales(netProfit, netSalesValue);

    results.push({
      productId: st.productId,
      code: st.code,
      barcode: st.barcode,
      productName: st.productName,
      category: st.category,
      class1: st.class1,
      baseUnit: st.baseUnit,
      totalPurchaseQty: st.totalPurchaseQty,
      totalPurchaseValue: st.totalPurchaseValue,
      purchaseReturnsQty: st.purchaseReturnsQty,
      purchaseReturnsValue: st.purchaseReturnsValue,
      netPurchaseQty,
      netPurchaseValue,
      totalSalesQty: st.totalSalesQty,
      totalSalesValue: st.totalSalesValue,
      salesReturnsQty: st.salesReturnsQty,
      salesReturnsValue: st.salesReturnsValue,
      netSalesQty,
      netSalesValue,
      cogs,
      avgPurchasePrice,
      minPurchasePrice,
      maxPurchasePrice,
      lastPurchasePrice: round2(st.lastPurchasePrice),
      lastPurchaseDate: st.lastPurchaseDate,
      avgSalePrice,
      minSalePrice,
      maxSalePrice,
      lastSalePrice: round2(st.lastSalePrice),
      lastSaleDate: st.lastSaleDate,
      totalDiscounts: st.totalDiscounts,
      damagedQty: st.damagedQty,
      damagedLossValue: st.damagedLossValue,
      shortageQty: st.shortageQty,
      shortageLossValue: st.shortageLossValue,
      allocatedExpenses: totalAllocatedExpenses,
      grossProfit,
      netProfit,
      totalLoss,
      profitPercentOnCost,
      profitMarginOnSales,
      currentStockQty: st.currentStockQty,
      currentStockValue: st.currentStockValue,
      lossTransactionsCount: st.lossTransactions.length,
      lossTransactions: st.lossTransactions,
    });
  }

  results.sort((a, b) => Math.abs(b.netSalesValue) - Math.abs(a.netSalesValue));
  return results;
}

export async function getSourceDocumentForReport(docType, docId, actor) {
  const data = await loadFullReportDataset(actor);
  const { resolveBranchName, resolveCashboxName } = buildBranchResolvers(data);
  const cleanType = String(docType || '').trim();
  const cleanId = String(docId || '').trim();

  if (
    ['sales_invoice', 'purchase_invoice', 'sales', 'purchase', 'sale_edit', 'purchase_edit', 'sale_cancel', 'purchase_cancel'].includes(cleanType)
  ) {
    let inv = (data.invoices || []).find((i) => i.id === cleanId || i.invoiceNumber === cleanId);
    if (!inv) {
      const smMatch = (data.stockMovements || []).find((m) => m.id === cleanId || m.referenceId === cleanId);
      if (smMatch?.referenceId) {
        inv = (data.invoices || []).find((i) => i.id === smMatch.referenceId) || null;
      }
    }
    if (!inv) return null;
    const relatedAudits = (data.auditLogs || []).filter((a) => a.recordId === inv.id);
    return {
      docType: inv.type === 'sales' ? 'sales_invoice' : 'purchase_invoice',
      title: inv.type === 'sales' ? `فاتورة مبيعات رقم ${inv.invoiceNumber}` : `فاتورة مشتريات رقم ${inv.invoiceNumber}`,
      document: {
        ...inv,
        branchName: resolveBranchName(inv.warehouseId, inv.cashboxId),
        cashboxName: resolveCashboxName(inv.cashboxId),
        actualDateTime: formatActualDateTimeAr(inv.createdAt, inv.date),
      },
      auditTrail: relatedAudits,
    };
  }

  if (cleanType === 'sales_return' || cleanType === 'purchase_return') {
    const ret = (data.invoiceReturns || []).find((r) => r.id === cleanId || r.returnNumber === cleanId);
    if (!ret) return null;
    return {
      docType: ret.type,
      title: ret.type === 'sales_return' ? `إشعار مرتجع مبيعات ${ret.returnNumber}` : `إشعار مرتجع مشتريات ${ret.returnNumber}`,
      document: {
        ...ret,
        branchName: resolveBranchName(ret.warehouseId, ret.cashboxId),
        cashboxName: resolveCashboxName(ret.cashboxId, 'رصيد الحساب'),
        actualDateTime: formatActualDateTimeAr(ret.createdAt, ret.date),
      },
      auditTrail: (data.auditLogs || []).filter((a) => a.recordId === ret.id),
    };
  }

  if (cleanType === 'damaged_voucher') {
    const op = (data.repCustodyOperations || []).find((o) => o.id === cleanId || o.operationNumber === cleanId);
    if (op) {
      return {
        docType: 'damaged_voucher',
        title: `سند توالف عهدة رقم ${op.operationNumber}`,
        document: {
          docNumber: op.operationNumber,
          date: op.date,
          actualDateTime: formatActualDateTimeAr(op.createdAt, op.date),
          warehouseName: op.warehouseName,
          branchName: resolveBranchName(op.warehouseId, null),
          createdBy: op.createdBy,
          notes: op.notes || 'إثبات توالف عهدة',
          items: [
            {
              productId: op.productId,
              productName: op.productName,
              unit: op.unit,
              quantity: op.quantity,
            },
          ],
        },
        auditTrail: [],
      };
    }

    const dmgMovements = (data.stockMovements || []).filter(
      (sm) =>
        sm.type === 'damaged' &&
        (sm.id === cleanId ||
          sm.referenceId === cleanId ||
          sm.referenceNumber === cleanId ||
          `DMG-${String(sm.date).replace(/-/g, '')}-${sm.warehouseId}-${String(sm.createdAt || '').slice(0, 16)}` === cleanId)
    );
    if (dmgMovements.length === 0) return null;
    const first = dmgMovements[0];
    return {
      docType: 'damaged_voucher',
      title: `سند توالف مخزنية ${first.referenceNumber || first.date}`,
      document: {
        docNumber: first.referenceNumber || `DMG-${first.date.replace(/-/g, '')}`,
        date: first.date,
        actualDateTime: formatActualDateTimeAr(first.createdAt, first.date),
        warehouseName: first.warehouseName,
        branchName: resolveBranchName(first.warehouseId, null),
        createdBy: first.createdBy,
        notes: first.notes || '',
        items: dmgMovements.map((m) => ({
          productId: m.productId,
          productName: m.productName,
          unit: m.unit || 'قطعة',
          quantity: m.quantity,
          unitCost: m.unitCost,
          totalLoss: round2(Number(m.quantity || 0) * Number(m.unitCost || 0)),
        })),
      },
      auditTrail: [],
    };
  }

  if (['rep_custody', 'custody_delivery', 'custody_return', 'custody_adjustment', 'custody_shortage'].includes(cleanType)) {
    const op = (data.repCustodyOperations || []).find(
      (o) => o.id === cleanId || o.operationNumber === cleanId || o.invoiceId === cleanId
    );
    if (op) {
      const opTitleMap = {
        delivered_to_customer: 'تسليم من عهدة المندوب للعميل',
        returned_to_warehouse: 'مرتجع عهدة مندوب إلى المخزن',
        custody_damaged: 'إثبات تالف عهدة مندوب',
        custody_shortage: 'عجز عهدة مندوب',
        custody_adjustment: 'تسوية عهدة مندوب',
      };
      return {
        docType: 'rep_custody',
        title: `${opTitleMap[op.operationType] || 'حركة عهدة مندوب'} رقم ${op.operationNumber || op.id}`,
        document: {
          ...op,
          docNumber: op.operationNumber || op.id,
          warehouseName: op.warehouseName,
          branchName: resolveBranchName(op.warehouseId, null),
          actualDateTime: formatActualDateTimeAr(op.createdAt, op.date),
          items: [
            {
              productId: op.productId,
              productName: op.productName,
              unit: op.unit,
              unitFactor: op.unitFactor || 1,
              quantity: op.quantity,
              baseQuantity: op.baseQuantity,
            },
          ],
        },
        auditTrail: (data.auditLogs || []).filter((a) => a.recordId === op.id || a.recordId === op.representativeId),
      };
    }
  }

  // Cash transaction / Expense / Payroll / Custody / Stock Movement fallback
  const ft = (data.financialTransactions || []).find((f) => f.id === cleanId || f.relatedDocId === cleanId);
  if (ft) {
    return {
      docType: 'cash_tx',
      title: `سند مالي رقم ${ft.transactionNumber}`,
      document: {
        ...ft,
        branchName: resolveBranchName(null, ft.cashboxId),
        cashboxName: resolveCashboxName(ft.cashboxId, ft.cashboxName),
        actualDateTime: formatActualDateTimeAr(ft.createdAt, ft.date),
      },
      auditTrail: (data.auditLogs || []).filter((a) => a.recordId === ft.id || a.recordId === ft.relatedDocId),
    };
  }

  const sm = (data.stockMovements || []).find((m) => m.id === cleanId || m.referenceId === cleanId);
  if (sm) {
    const linkedInv = sm.referenceId ? (data.invoices || []).find((i) => i.id === sm.referenceId) : null;
    if (linkedInv) {
      return {
        docType: linkedInv.type === 'sales' ? 'sales_invoice' : 'purchase_invoice',
        title: linkedInv.type === 'sales' ? `فاتورة مبيعات رقم ${linkedInv.invoiceNumber}` : `فاتورة مشتريات رقم ${linkedInv.invoiceNumber}`,
        document: {
          ...linkedInv,
          branchName: resolveBranchName(linkedInv.warehouseId, linkedInv.cashboxId),
          cashboxName: resolveCashboxName(linkedInv.cashboxId),
          actualDateTime: formatActualDateTimeAr(linkedInv.createdAt, linkedInv.date),
        },
        auditTrail: (data.auditLogs || []).filter((a) => a.recordId === linkedInv.id),
      };
    }
    return {
      docType: 'stock_movement',
      title: `حركة مخزون ${sm.movementNumber || sm.id}`,
      document: {
        ...sm,
        branchName: resolveBranchName(sm.warehouseId, null),
        actualDateTime: formatActualDateTimeAr(sm.createdAt, sm.date),
      },
      auditTrail: [],
    };
  }

  return null;
}

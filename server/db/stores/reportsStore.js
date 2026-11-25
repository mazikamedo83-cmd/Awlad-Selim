import { getPool } from '../postgres.js';
import { readJsonDatabase } from '../jsonLedger.js';
import {
  round2,
  round3,
  canViewCashboxBalances,
  sanitizeCashboxForViewer,
  sanitizeProductForRepresentative,
  sanitizeInvoiceForRepresentative,
  buildPgInPredicate,
} from '../../utils/errors.js';
import {
  isPgMode,
  isoDateOnly,
  isoTimestamp,
  mapPgProductRow,
  mapPgInvoiceRow,
  mapPgPurchaseReturnRequestRow,
  mapPgSalesReturnRequestRow,
} from './mode.js';
import { getRepresentativeByUserId, getSystemSettingsSafe } from './catalogStore.js';
import { isRepOwnerOfInvoice } from './invoicesStore.js';

export const REPORT_TYPES_LIST = [
  { key: 'all', label: 'الكل', group: 1 },
  { key: 'sales_items', label: 'أصناف البيع', group: 1 },
  { key: 'sales_invoices', label: 'فواتير بيع', group: 1 },
  { key: 'sales_items_by_unit', label: 'أصناف بيع/ بالوحدة', group: 1 },
  { key: 'sales_items_grouped', label: 'أصناف بيع/مَجمع', group: 1 },
  { key: 'sales_items_grouped_by_customer', label: 'أصناف بيع/مَجمع حسب العميل', group: 1 },
  { key: 'sales_items_grouped_by_category', label: 'أصناف بيع/مَجمع حسب المجموعة', group: 1 },
  { key: 'sales_items_grouped_by_category_class1', label: 'أصناف بيع/مَجمع حسب المجموعة وتصنيف 1', group: 1 },

  { key: 'sales_return_items', label: 'أصناف مرتجع بيع', group: 2 },
  { key: 'sales_return_invoices', label: 'فواتير مرتجع بيع', group: 2 },

  { key: 'purchase_items', label: 'أصناف شراء', group: 3 },
  { key: 'purchase_invoices', label: 'فواتير شراء', group: 3 },

  { key: 'purchase_return_items', label: 'أصناف مرتجع شراء', group: 4 },
  { key: 'purchase_return_invoices', label: 'فواتير مرتجع شراء', group: 4 },

  { key: 'damaged_items', label: 'أصناف تالف', group: 5 },
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

function buildPgRepOwnInvPred(alias, actor, repProfile, params) {
  const pfx = alias ? `${alias}.` : '';
  const parts = [];
  if (repProfile?.id) {
    params.push(repProfile.id);
    parts.push(`${pfx}representative_id = $${params.length}`);
  }
  if (actor?.id) {
    params.push(actor.id);
    const idRef = `$${params.length}`;
    parts.push(`${pfx}created_by_user_id = ${idRef}`);
    parts.push(`${pfx}sent_by_user_id = ${idRef}`);
    parts.push(
      `(${pfx}created_by_user_id IS NULL AND ${pfx}representative_id IS NULL AND ${pfx}sent_by_user_id IS NULL AND ${pfx}created_by = ${idRef})`
    );
  }
  return parts.length > 0 ? `(${parts.join(' OR ')})` : '1 = 0';
}

export async function loadFullReportDataset(actor, filterHints = {}) {
  const settings = await getSystemSettingsSafe();
  const isRep = actor?.role === 'representative';
  const isRepCanPurchase = isRep && Boolean(actor?.permissions?.canCreatePurchase || actor?.permissions?.canManagePurchases);
  const repProfile = isRep ? await getRepresentativeByUserId(actor.id) : null;

  if (await isPgMode()) {
    const pool = getPool();
    const parsedHintParty = parseUnifiedPartyFilter(filterHints);
    const hintDateFrom = filterHints.dateFrom ? String(filterHints.dateFrom).split('T')[0] : null;
    const hintDateTo = filterHints.dateTo ? String(filterHints.dateTo).split('T')[0] : null;
    const hintWh = filterHints.warehouseId && filterHints.warehouseId !== 'all' ? String(filterHints.warehouseId) : null;
    const hintProd = filterHints.productId && filterHints.productId !== 'all' ? String(filterHints.productId) : null;
    const hintCustomerId = parsedHintParty.customerId;
    const hintSupplierId = isRep && !isRepCanPurchase ? null : parsedHintParty.supplierId;
    const hintRepId = !isRep && filterHints.representativeId && filterHints.representativeId !== 'all' ? String(filterHints.representativeId) : null;
    const hintCashboxId = filterHints.cashboxId && filterHints.cashboxId !== 'all' ? String(filterHints.cashboxId) : null;
    const hintInvoiceNumber = filterHints.invoiceNumber ? String(filterHints.invoiceNumber).trim() : '';
    const includeAuditLogs = !isRep && Boolean(hintProd || filterHints.includeAuditLogs);

    let repAllInvIdSet = null;
    let repAllRetIdSet = null;
    if (isRep) {
      const ownParams = [];
      const ownPred = buildPgRepOwnInvPred('', actor, repProfile, ownParams);
      const ownInvWhere = isRepCanPurchase ? ownPred : `${ownPred} AND type <> 'purchase'`;
      const ownInvRes = await pool.query(`SELECT id FROM invoices WHERE ${ownInvWhere}`, ownParams);
      repAllInvIdSet = new Set(ownInvRes.rows.map((r) => r.id));
      const ownRetParams = [];
      const ownRetInvPred = buildPgRepOwnInvPred('', actor, repProfile, ownRetParams);
      const ownRetInvWhere = isRepCanPurchase ? ownRetInvPred : `${ownRetInvPred} AND type <> 'purchase'`;
      let ownRetSql = `SELECT id FROM invoice_returns WHERE original_invoice_id IN (SELECT id FROM invoices WHERE ${ownRetInvWhere})`;
      if (actor?.id) {
        ownRetParams.push(actor.id);
        ownRetSql += ` OR (original_invoice_id IS NULL AND created_by_user_id = $${ownRetParams.length})`;
      }
      if (!isRepCanPurchase) {
        ownRetSql = `SELECT id FROM (${ownRetSql}) r WHERE 1 = 1`;
      }
      const ownRetRes = await pool.query(ownRetSql, ownRetParams);
      repAllRetIdSet = new Set(ownRetRes.rows.map((r) => r.id));
    }

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
    const ftClauses = [];
    const ftParams = [];
    if (!hintProd && hintDateFrom) {
      ftParams.push(hintDateFrom);
      ftClauses.push(`date >= $${ftParams.length}`);
    }
    if (isRep) {
      const repOwnFtParts = [];
      if (repAllInvIdSet && repAllInvIdSet.size > 0) {
        repOwnFtParts.push(buildPgInPredicate('related_doc_id', Array.from(repAllInvIdSet), ftParams));
      }
      if (repAllRetIdSet && repAllRetIdSet.size > 0) {
        repOwnFtParts.push(buildPgInPredicate('related_doc_id', Array.from(repAllRetIdSet), ftParams));
      }
      if (actor?.id) {
        ftParams.push(actor.id);
        const idRef = `$${ftParams.length}`;
        repOwnFtParts.push(`created_by_user_id = ${idRef}`);
        repOwnFtParts.push(`(created_by_user_id IS NULL AND related_doc_id IS NULL AND created_by = ${idRef})`);
      }
      ftClauses.push(repOwnFtParts.length > 0 ? `(${repOwnFtParts.join(' OR ')})` : `1 = 0`);
      if (isRepCanPurchase) {
        ftClauses.push(`(type NOT IN ('transfer', 'deposit', 'withdrawal', 'advance_payout', 'salary_payout', 'expense', 'income', 'rep_transfer') AND (type <> 'supplier_payment' OR related_doc_type = 'purchase'))`);
      } else {
        ftClauses.push(`type NOT IN ('transfer', 'deposit', 'withdrawal', 'supplier_payment', 'advance_payout', 'salary_payout', 'expense', 'income', 'rep_transfer')`);
      }
    } else if (hintCashboxId) {
      ftParams.push(hintCashboxId);
      ftClauses.push(`(cashbox_id = $${ftParams.length} OR type = 'transfer')`);
    }
    const ftFilter = {
      whereSql: ftClauses.length > 0 ? `WHERE ${ftClauses.join(' AND ')}` : '',
      params: ftParams,
    };

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
    if (hintCustomerId) {
      retParams.push(hintCustomerId);
      retClauses.push(`(party_id = $${retParams.length} OR original_invoice_id IN (SELECT id FROM invoices WHERE customer_id = $${retParams.length}))`);
    }
    if (hintSupplierId) {
      retParams.push(hintSupplierId);
      retClauses.push(`(party_id = $${retParams.length} OR original_invoice_id IN (SELECT id FROM invoices WHERE supplier_id = $${retParams.length}))`);
    }
    if (hintRepId) {
      retParams.push(hintRepId);
      retClauses.push(`original_invoice_id IN (SELECT id FROM invoices WHERE representative_id = $${retParams.length})`);
    }
    if (hintCashboxId && !isRep) {
      retParams.push(hintCashboxId);
      retClauses.push(`cashbox_id = $${retParams.length}`);
    }
    if (hintInvoiceNumber) {
      retParams.push(`%${hintInvoiceNumber}%`);
      retClauses.push(`(LOWER(return_number) LIKE LOWER($${retParams.length}) OR LOWER(original_invoice_number) LIKE LOWER($${retParams.length}))`);
    }
    if (isRep) {
      if (!isRepCanPurchase) {
        retClauses.push(`type <> 'purchase_return'`);
      }
      const ownRetParts = [];
      if (repAllInvIdSet && repAllInvIdSet.size > 0) {
        ownRetParts.push(buildPgInPredicate('original_invoice_id', Array.from(repAllInvIdSet), retParams));
      }
      if (actor?.id) {
        retParams.push(actor.id);
        const idRef = `$${retParams.length}`;
        ownRetParts.push(`(original_invoice_id IS NULL AND created_by_user_id = ${idRef})`);
        ownRetParts.push(`(original_invoice_id IS NULL AND created_by_user_id IS NULL AND created_by = ${idRef})`);
      }
      retClauses.push(ownRetParts.length > 0 ? `(${ownRetParts.join(' OR ')})` : `1 = 0`);
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
    if (hintCustomerId) {
      invParams.push(hintCustomerId);
      invClauses.push(`customer_id = $${invParams.length}`);
    }
    if (hintSupplierId) {
      invParams.push(hintSupplierId);
      invClauses.push(`supplier_id = $${invParams.length}`);
    }
    if (hintRepId) {
      invParams.push(hintRepId);
      invClauses.push(`representative_id = $${invParams.length}`);
    }
    if (hintCashboxId && !isRep) {
      invParams.push(hintCashboxId);
      invClauses.push(`cashbox_id = $${invParams.length}`);
    }
    if (hintInvoiceNumber) {
      invParams.push(`%${hintInvoiceNumber}%`);
      invClauses.push(`LOWER(invoice_number) LIKE LOWER($${invParams.length})`);
    }
    if (isRep) {
      invClauses.push(buildPgRepOwnInvPred('', actor, repProfile, invParams));
      if (!isRepCanPurchase) {
        invClauses.push(`type <> 'purchase'`);
      }
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
    if (isRep) {
      if (repProfile?.warehouseId) {
        smParams.push(repProfile.warehouseId);
        smClauses.push(`(warehouse_id = $${smParams.length} OR target_warehouse_id = $${smParams.length})`);
      } else {
        smClauses.push(`1 = 0`);
      }
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
    if (isRep) {
      if (repProfile?.id) {
        rcoParams.push(repProfile.id);
        rcoClauses.push(`representative_id = $${rcoParams.length}`);
      } else {
        rcoClauses.push(`1 = 0`);
      }
    } else if (hintRepId) {
      rcoParams.push(hintRepId);
      rcoClauses.push(`representative_id = $${rcoParams.length}`);
    }
    const rcoWhereSql = rcoClauses.length > 0 ? `WHERE ${rcoClauses.join(' AND ')}` : '';

    const expFilter = buildRangeWhere([], true);
    const advFilter = buildRangeWhere([], true);
    const needsLinkedDocMeta = Boolean(!isRep && (hintWh || (!hintProd && (hintDateFrom || hintDateTo))));
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
      _advUnusedRes,
      _payUnusedRes,
      auditRes,
      linkedInvMetaRes,
      linkedRetMetaRes,
      prrRes,
      prrItemRes,
      srrRes,
      srrItemRes,
    ] = await Promise.all([
      pool.query('SELECT * FROM warehouses ORDER BY created_at ASC'),
      isRep
        ? pool.query('SELECT id, name, type, is_default FROM cashboxes ORDER BY created_at ASC')
        : pool.query('SELECT * FROM cashboxes ORDER BY created_at ASC'),
      pool.query('SELECT * FROM product_categories ORDER BY name ASC'),
      pool.query('SELECT * FROM products ORDER BY created_at DESC'),
      pool.query('SELECT * FROM product_units'),
      pool.query('SELECT * FROM customers ORDER BY created_at DESC'),
      isRep && !isRepCanPurchase ? Promise.resolve({ rows: [] }) : pool.query('SELECT * FROM suppliers ORDER BY created_at DESC'),
      isRep
        ? pool.query('SELECT id, code, name, warehouse_id, user_id FROM representatives WHERE user_id = $1 ORDER BY created_at ASC', [actor.id])
        : pool.query('SELECT * FROM representatives ORDER BY created_at ASC'),
      isRep ? Promise.resolve({ rows: [] }) : pool.query('SELECT * FROM employees ORDER BY created_at ASC'),
      isRep ? Promise.resolve({ rows: [] }) : pool.query('SELECT id, full_name, username, role, job_title, identity_id, employee_id FROM users ORDER BY full_name ASC'),
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
      Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] }),
      pool.query(`SELECT * FROM rep_custody_operations ${rcoWhereSql} ORDER BY date DESC, created_at DESC`, rcoParams),
      isRep ? Promise.resolve({ rows: [] }) : pool.query(`SELECT * FROM expenses_incomes ${expFilter.whereSql} ORDER BY date DESC, created_at DESC`, expFilter.params),
      Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] }),
      includeAuditLogs ? pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 2000') : Promise.resolve({ rows: [] }),
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
      isRep && !isRepCanPurchase
        ? Promise.resolve({ rows: [] })
        : isRep
        ? (() => {
            const prrParams = [actor.id];
            const invIds = repAllInvIdSet && repAllInvIdSet.size > 0 ? Array.from(repAllInvIdSet) : [];
            const extraClause = invIds.length > 0 ? ` OR ${buildPgInPredicate('original_invoice_id', invIds, prrParams)}` : '';
            return pool.query(
              `SELECT * FROM purchase_return_requests WHERE requested_by_user_id = $1${extraClause} ORDER BY date DESC, created_at DESC`,
              prrParams
            );
          })()
        : pool.query('SELECT * FROM purchase_return_requests ORDER BY date DESC, created_at DESC'),
      isRep && !isRepCanPurchase
        ? Promise.resolve({ rows: [] })
        : pool.query('SELECT * FROM purchase_return_request_items'),
      isRep
        ? (() => {
            const srrParams = [actor.id];
            const invIds = repAllInvIdSet && repAllInvIdSet.size > 0 ? Array.from(repAllInvIdSet) : [];
            const extraClause = invIds.length > 0 ? ` OR ${buildPgInPredicate('original_invoice_id', invIds, srrParams)}` : '';
            return pool.query(
              `SELECT * FROM sales_return_requests WHERE requested_by_user_id = $1${extraClause} ORDER BY date DESC, created_at DESC`,
              srrParams
            );
          })()
        : pool.query('SELECT * FROM sales_return_requests ORDER BY date DESC, created_at DESC'),
      pool.query('SELECT * FROM sales_return_request_items'),
    ]);

    const unitsByProd = new Map();
    for (const u of unitRes.rows) {
      const list = unitsByProd.get(u.product_id) || [];
      list.push(u);
      unitsByProd.set(u.product_id, list);
    }
    const products = prodRes.rows.map((p) => {
      const mapped = mapPgProductRow(p, unitsByProd.get(p.id) || []);
      return isRep ? sanitizeProductForRepresentative(mapped) : mapped;
    });

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
    const isRepOwnInvoice = (inv) => isRepOwnerOfInvoice(inv, actor, repProfile);
    const invoices = invRes.rows
      .map((r) => mapPgInvoiceRow(r, invItemsMap.get(r.id) || [], invPaysMap.get(r.id) || []))
      .filter((inv) => {
        if (!isRep) return true;
        if (inv.type === 'purchase') return isRepCanPurchase && isRepOwnInvoice(inv);
        return isRepOwnInvoice(inv);
      })
      .map((inv) => (isRep ? sanitizeInvoiceForRepresentative(inv) : inv));
    const visibleInvIdSet = new Set(invoices.map((i) => i.id));
    const effectiveRepInvSet = repAllInvIdSet || visibleInvIdSet;

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
    const canSeeCashboxes = canViewCashboxBalances(actor);
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
        cashboxId: canSeeCashboxes ? (r.cashbox_id || undefined) : undefined,
        reason: r.reason || '',
        notes: r.notes || '',
        createdBy: r.created_by,
        createdByUserId: r.created_by_user_id || undefined,
        actorIdentityId: r.actor_identity_id || undefined,
        actorEmployeeId: r.actor_employee_id || undefined,
        actingRole: r.acting_role || undefined,
        createdAt: isoTimestamp(r.created_at),
      }))
      .filter((r) => {
        if (!isRep) return true;
        if (r.type === 'purchase_return' && !isRepCanPurchase) return false;
        if (r.originalInvoiceId) {
          return effectiveRepInvSet.has(r.originalInvoiceId) || visibleInvIdSet.has(r.originalInvoiceId);
        }
        return r.createdByUserId === actor.id || (!r.createdByUserId && r.createdBy === actor.id);
      });
    const effectiveRepRetSet = repAllRetIdSet || new Set(invoiceReturns.map((r) => r.id));

    const prrItemsById = new Map();
    for (const it of (prrItemRes?.rows || [])) {
      const arr = prrItemsById.get(it.request_id) || [];
      arr.push(it);
      prrItemsById.set(it.request_id, arr);
    }
    const purchaseReturnRequests = (prrRes?.rows || []).map((r) => {
      const mapped = mapPgPurchaseReturnRequestRow(r, prrItemsById.get(r.id) || []);
      if (!canSeeCashboxes) delete mapped.cashboxId;
      return mapped;
    });

    const srrItemsById = new Map();
    for (const it of (srrItemRes?.rows || [])) {
      const arr = srrItemsById.get(it.request_id) || [];
      arr.push(it);
      srrItemsById.set(it.request_id, arr);
    }
    const salesReturnRequests = (srrRes?.rows || []).map((r) => {
      const mapped = mapPgSalesReturnRequestRow(r, srrItemsById.get(r.id) || []);
      if (!canSeeCashboxes) delete mapped.cashboxId;
      return mapped;
    });

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
      cashboxes: cbRes.rows.map((c) =>
        sanitizeCashboxForViewer(
          {
            id: c.id,
            name: c.name,
            type: c.type || 'cashbox',
            openingBalance: c.opening_balance !== undefined ? Number(c.opening_balance || 0) : undefined,
            currentBalance: c.current_balance !== undefined ? Number(c.current_balance || 0) : undefined,
            isDefault: Boolean(c.is_default),
          },
          actor
        )
      ),
      categories: catRes.rows.map((c) => ({ id: c.id, name: c.name })),
      products,
      customers: custRes.rows.map((c) => ({ id: c.id, code: c.code, name: c.name, shopName: c.shop_name || undefined, phone: c.phone || '', assignedRepId: c.assigned_rep_id || undefined, identityId: c.identity_id || undefined, currentBalance: Number(c.current_balance || 0) })),
      suppliers: isRep && !isRepCanPurchase ? [] : suppRes.rows.map((s) => ({ id: s.id, code: s.code, name: s.name, companyName: s.company_name || undefined, phone: s.phone || '', identityId: s.identity_id || undefined, currentBalance: Number(s.current_balance || 0) })),
      representatives: repRes.rows.map((r) => ({ id: r.id, userId: r.user_id || undefined, identityId: r.identity_id || undefined, code: r.code || '', name: r.name, phone: isRep ? '' : (r.phone || ''), warehouseId: r.warehouse_id || undefined })),
      employees: isRep ? [] : empRes.rows.map((e) => ({ id: e.id, code: e.code, name: e.full_name, jobTitle: e.job_title || '', department: e.department || '', identityId: e.identity_id || undefined, userId: e.user_id || undefined })),
      users: isRep ? [] : userRes.rows.map((u) => ({ id: u.id, fullName: u.full_name, username: u.username, role: u.role, identityId: u.identity_id || undefined, employeeId: u.employee_id || undefined })),
      invoices,
      invoiceReturns,
      purchaseReturnRequests,
      salesReturnRequests,
      financialTransactions: ftRes.rows
        .filter((f) => {
          if (!isRep) return true;
          if (['transfer', 'deposit', 'withdrawal', 'advance_payout', 'salary_payout', 'expense', 'income', 'rep_transfer'].includes(f.type)) {
            return false;
          }
          if (f.type === 'supplier_payment') {
            return (
              isRepCanPurchase &&
              f.related_doc_type === 'purchase' &&
              Boolean(f.related_doc_id && (effectiveRepInvSet.has(f.related_doc_id) || visibleInvIdSet.has(f.related_doc_id)))
            );
          }
          const linkedToOwnDoc = Boolean(
            f.related_doc_id &&
              (effectiveRepInvSet.has(f.related_doc_id) ||
                visibleInvIdSet.has(f.related_doc_id) ||
                effectiveRepRetSet.has(f.related_doc_id))
          );
          if (linkedToOwnDoc) return true;
          if (f.created_by_user_id) return f.created_by_user_id === actor.id;
          return !f.related_doc_id && f.created_by === actor.id;
        })
        .map((f) => ({
          id: f.id,
          transactionNumber: f.transaction_number,
          date: isoDateOnly(f.date),
          type: f.type,
          amount: Number(f.amount || 0),
          cashboxId: f.cashbox_id,
          cashboxName: f.cashbox_name,
          ...(isRep ? {} : { balanceAfter: Number(f.balance_after || 0) }),
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
          createdByUserId: f.created_by_user_id || undefined,
          actorIdentityId: f.actor_identity_id || undefined,
          actorEmployeeId: f.actor_employee_id || undefined,
          actingRole: f.acting_role || undefined,
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
          unitCost: isRep ? 0 : Number(sm.unit_cost || 0),
          balanceBefore: sm.balance_before !== null && sm.balance_before !== undefined ? Number(sm.balance_before) : undefined,
          balanceAfter: sm.balance_after !== null && sm.balance_after !== undefined ? Number(sm.balance_after) : undefined,
          relatedDocType: sm.related_doc_type || undefined,
          referenceId: sm.related_doc_id || undefined,
          referenceNumber: sm.related_doc_number || undefined,
          notes: sm.notes || '',
          createdBy: sm.created_by,
          createdByUserId: sm.created_by_user_id || undefined,
          actorIdentityId: sm.actor_identity_id || undefined,
          actorEmployeeId: sm.actor_employee_id || undefined,
          actingRole: sm.acting_role || undefined,
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
        createdByUserId: op.created_by_user_id || undefined,
        actorIdentityId: op.actor_identity_id || undefined,
        actorEmployeeId: op.actor_employee_id || undefined,
        actingRole: op.acting_role || undefined,
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
  const isRepOwnJsonInvoice = (inv) => isRepOwnerOfInvoice(inv, actor, repProfile);
  const invoices = (db.invoices || [])
    .filter((inv) => {
      if (!isRep) return true;
      if (inv.type === 'purchase') return isRepCanPurchase && isRepOwnJsonInvoice(inv);
      return isRepOwnJsonInvoice(inv);
    })
    .map((inv) => (isRep ? sanitizeInvoiceForRepresentative(inv) : inv));
  const canSeeCashboxesJson = canViewCashboxBalances(actor);
  const redactRetCbJson = (obj) => {
    if (canSeeCashboxesJson) return obj;
    const copy = { ...obj };
    delete copy.cashboxId;
    return copy;
  };
  const visibleJsonInvIdSet = new Set(invoices.map((i) => i.id));
  const invoiceReturns = (db.invoiceReturns || [])
    .filter((r) => {
      if (!isRep) return true;
      if (r.type === 'purchase_return' && !isRepCanPurchase) return false;
      if (r.originalInvoiceId) return visibleJsonInvIdSet.has(r.originalInvoiceId);
      if (r.createdByUserId) return r.createdByUserId === actor.id;
      return r.createdBy === actor.id;
    })
    .map(redactRetCbJson);
  const visibleJsonRetIdSet = new Set(invoiceReturns.map((r) => r.id));
  const purchaseReturnRequests = (isRep && !isRepCanPurchase
    ? []
    : (db.purchaseReturnRequests || []).filter((req) => {
        if (!isRep) return true;
        return visibleJsonInvIdSet.has(req.originalInvoiceId) || req.requestedByUserId === actor.id;
      })
  ).map(redactRetCbJson);
  const salesReturnRequests = (db.salesReturnRequests || [])
    .filter((req) => {
      if (!isRep) return true;
      return visibleJsonInvIdSet.has(req.originalInvoiceId) || req.requestedByUserId === actor.id;
    })
    .map(redactRetCbJson);
  const financialTransactions = (db.financialTransactions || [])
    .filter((f) => {
      if (!isRep) return true;
      if (['transfer', 'deposit', 'withdrawal', 'advance_payout', 'salary_payout', 'expense', 'income', 'rep_transfer'].includes(f.type)) {
        return false;
      }
      if (f.type === 'supplier_payment') {
        return isRepCanPurchase && f.relatedDocType === 'purchase' && Boolean(f.relatedDocId && visibleJsonInvIdSet.has(f.relatedDocId));
      }
      const linkedToOwnDoc = Boolean(
        f.relatedDocId && (visibleJsonInvIdSet.has(f.relatedDocId) || visibleJsonRetIdSet.has(f.relatedDocId))
      );
      if (linkedToOwnDoc) return true;
      if (f.createdByUserId) return f.createdByUserId === actor.id;
      return !f.relatedDocId && f.createdBy === actor.id;
    })
    .map((f) => {
      if (!isRep) return f;
      const { balanceAfter, ...rest } = f;
      return rest;
    });
  const stockMovements = (db.stockMovements || [])
    .filter((sm) => !isRep || (repProfile?.warehouseId && (sm.warehouseId === repProfile.warehouseId || sm.targetWarehouseId === repProfile.warehouseId)))
    .map((sm) => (isRep ? { ...sm, unitCost: 0 } : sm));

  return {
    settings,
    warehouses: db.warehouses || [],
    cashboxes: (db.cashboxes || []).map((c) => sanitizeCashboxForViewer(c, actor)),
    categories: db.categories || [],
    products: isRep ? (db.products || []).map(sanitizeProductForRepresentative) : (db.products || []),
    customers: db.customers || [],
    suppliers: isRep && !isRepCanPurchase ? [] : (db.suppliers || []),
    representatives: isRep
      ? (db.representatives || [])
          .filter((r) => r.userId === actor.id || (repProfile && r.id === repProfile.id))
          .map((r) => ({ id: r.id, userId: r.userId || undefined, code: r.code || '', name: r.name, phone: '', warehouseId: r.warehouseId || undefined }))
      : (db.representatives || []),
    employees: isRep ? [] : (db.employees || []),
    users: isRep ? [] : (db.users || []).map((u) => ({ id: u.id, fullName: u.fullName, username: u.username, role: u.role, identityId: u.identityId || undefined, employeeId: u.employeeId || undefined })),
    invoices,
    invoiceReturns,
    purchaseReturnRequests,
    salesReturnRequests,
    financialTransactions,
    stockMovements,
    stockCounts: [],
    stockTransferRequests: [],
    repItemTransfers: [],
    repCustodyOperations: isRep
      ? (db.repCustodyOperations || []).filter((op) => repProfile && op.representativeId === repProfile.id)
      : (db.repCustodyOperations || []),
    expenseIncomes: isRep ? [] : (db.expenseIncomes || []),
    auditLogs: !isRep && (filterHints.productId || filterHints.includeAuditLogs) ? (db.auditLogs || []).slice(0, 2000) : [],
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

function parseUnifiedPartyFilter(filters = {}) {
  const rawParty = String(filters.partyKey || filters.partyFilter || '').trim();
  let customerId = filters.customerId && filters.customerId !== 'all' ? String(filters.customerId).trim() : null;
  let supplierId = filters.supplierId && filters.supplierId !== 'all' ? String(filters.supplierId).trim() : null;
  if (rawParty && rawParty !== 'all') {
    if (rawParty.startsWith('customer:')) {
      customerId = rawParty.slice('customer:'.length).trim() || null;
      supplierId = null;
    } else if (rawParty.startsWith('supplier:')) {
      supplierId = rawParty.slice('supplier:'.length).trim() || null;
      customerId = null;
    }
  }
  const partyKey = customerId ? `customer:${customerId}` : supplierId ? `supplier:${supplierId}` : 'all';
  return { customerId, supplierId, partyKey };
}

function normalizeMovementTypeFilter(rawMovement) {
  const clean = String(rawMovement || 'all').trim();
  const allowed = new Set(['all', 'sales', 'sales_return', 'purchase', 'purchase_return', 'damaged', 'cash_in', 'cash_out']);
  return allowed.has(clean) ? clean : 'all';
}

function resolveUserFilterSpec(userFilterValue, users) {
  if (!userFilterValue || userFilterValue === 'all') return null;
  const val = String(userFilterValue).trim();
  const matchedUser = (users || []).find((u) => u.id === val || u.username === val || u.fullName === val);
  if (!matchedUser) {
    return {
      userId: null,
      legacyNames: new Set([val.toLowerCase()]),
    };
  }
  return {
    userId: matchedUser.id,
    legacyNames: new Set([matchedUser.fullName, matchedUser.username].filter(Boolean).map((s) => String(s).trim().toLowerCase())),
  };
}

function resolveEmployeeFilterSpec(empFilterValue, employees, users, reps) {
  if (!empFilterValue || empFilterValue === 'all') return null;
  const val = String(empFilterValue).trim();
  const matchedEmp = (employees || []).find((e) => e.id === val || e.name === val);
  if (!matchedEmp) {
    return {
      employeeId: val,
      identityId: null,
      linkedUserIds: new Set(),
      linkedRepIds: new Set(),
    };
  }
  const linkedUserIds = new Set();
  if (matchedEmp.userId) linkedUserIds.add(matchedEmp.userId);
  for (const u of users || []) {
    if (u.employeeId === matchedEmp.id) linkedUserIds.add(u.id);
    if (matchedEmp.identityId && u.identityId === matchedEmp.identityId) linkedUserIds.add(u.id);
  }
  const linkedRepIds = new Set();
  for (const r of reps || []) {
    if (matchedEmp.identityId && r.identityId === matchedEmp.identityId) linkedRepIds.add(r.id);
    if (r.userId && linkedUserIds.has(r.userId)) linkedRepIds.add(r.id);
  }
  return {
    employeeId: matchedEmp.id,
    identityId: matchedEmp.identityId || null,
    linkedUserIds,
    linkedRepIds,
  };
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

const SQL_PAGINATABLE_TYPES = new Set([
  'sales_invoices',
  'purchase_invoices',
  'sales_items',
  'purchase_items',
  'sales_return_invoices',
  'purchase_return_invoices',
  'sales_return_items',
  'purchase_return_items',
]);

async function tryGetSqlPaginatedReportPg(filters, actor, reportType, page, pageSize) {
  if (!SQL_PAGINATABLE_TYPES.has(reportType)) return null;
  const normalizedMovement = normalizeMovementTypeFilter(filters.movementType);
  if (
    (normalizedMovement && normalizedMovement !== 'all') ||
    filters.productSearch ||
    filters.barcode ||
    (filters.employeeId && filters.employeeId !== 'all') ||
    (filters.userId && filters.userId !== 'all') ||
    filters.userName ||
    filters.recordId ||
    filters.search
  ) {
    return null;
  }
  const pool = getPool();
  const settings = await getSystemSettingsSafe();
  const isRep = actor?.role === 'representative';
  const isRepCanPurchase = isRep && Boolean(actor?.permissions?.canCreatePurchase || actor?.permissions?.canManagePurchases);
  const repProfile = isRep ? await getRepresentativeByUserId(actor.id) : null;
  const isReturnReport =
    reportType === 'sales_return_invoices' ||
    reportType === 'purchase_return_invoices' ||
    reportType === 'sales_return_items' ||
    reportType === 'purchase_return_items';
  const isSales =
    reportType === 'sales_invoices' ||
    reportType === 'sales_items' ||
    reportType === 'sales_return_invoices' ||
    reportType === 'sales_return_items';
  const isInvoiceLayout =
    reportType === 'sales_invoices' ||
    reportType === 'purchase_invoices' ||
    reportType === 'sales_return_invoices' ||
    reportType === 'purchase_return_invoices';
  const invType = isSales ? 'sales' : 'purchase';
  const retType = isSales ? 'sales_return' : 'purchase_return';

  const [whRes, cbRes, custRes, suppRes, repRes, prodRes, unitRes, empRes, userRes] = await Promise.all([
    pool.query('SELECT * FROM warehouses ORDER BY created_at ASC'),
    isRep
      ? pool.query('SELECT id, name, type, is_default FROM cashboxes ORDER BY created_at ASC')
      : pool.query('SELECT * FROM cashboxes ORDER BY created_at ASC'),
    pool.query('SELECT * FROM customers ORDER BY created_at DESC'),
    isRep && !isRepCanPurchase ? Promise.resolve({ rows: [] }) : pool.query('SELECT * FROM suppliers ORDER BY created_at DESC'),
    isRep
      ? pool.query('SELECT id, code, name, warehouse_id, user_id, identity_id FROM representatives WHERE user_id = $1 ORDER BY created_at ASC', [actor.id])
      : pool.query('SELECT * FROM representatives ORDER BY created_at ASC'),
    pool.query('SELECT * FROM products ORDER BY created_at DESC'),
    pool.query('SELECT * FROM product_units'),
    isRep ? Promise.resolve({ rows: [] }) : pool.query('SELECT id, code, full_name, job_title, identity_id, user_id FROM employees ORDER BY created_at ASC'),
    isRep ? Promise.resolve({ rows: [] }) : pool.query('SELECT id, full_name, username, role, identity_id, employee_id FROM users ORDER BY full_name ASC'),
  ]);

  const unitsByProd = new Map();
  for (const u of unitRes.rows) {
    const list = unitsByProd.get(u.product_id) || [];
    list.push(u);
    unitsByProd.set(u.product_id, list);
  }
  const products = prodRes.rows.map((p) => {
    const mapped = mapPgProductRow(p, unitsByProd.get(p.id) || []);
    return isRep ? sanitizeProductForRepresentative(mapped) : mapped;
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  const customers = custRes.rows.map((c) => ({ id: c.id, code: c.code, name: c.name, phone: c.phone || '', assignedRepId: c.assigned_rep_id || undefined, currentBalance: Number(c.current_balance || 0) }));
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const suppliers = (suppRes.rows || []).map((s) => ({ id: s.id, code: s.code, name: s.name, phone: s.phone || '', currentBalance: Number(s.current_balance || 0) }));
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  const warehouses = whRes.rows.map((w) => ({ id: w.id, name: w.name, code: w.code, isDefault: Boolean(w.is_default), status: w.status || 'active' }));
  const cashboxes = cbRes.rows.map((c) =>
    sanitizeCashboxForViewer(
      {
        id: c.id,
        name: c.name,
        type: c.type || 'cashbox',
        openingBalance: c.opening_balance !== undefined ? Number(c.opening_balance || 0) : undefined,
        currentBalance: c.current_balance !== undefined ? Number(c.current_balance || 0) : undefined,
        isDefault: Boolean(c.is_default),
      },
      actor
    )
  );
  const representatives = repRes.rows.map((r) => ({ id: r.id, userId: r.user_id || undefined, identityId: r.identity_id || undefined, code: r.code || '', name: r.name, phone: isRep ? '' : (r.phone || ''), warehouseId: r.warehouse_id || undefined }));
  const employeesList = isRep ? [] : empRes.rows.map((e) => ({ id: e.id, code: e.code, name: e.full_name, jobTitle: e.job_title || '', identityId: e.identity_id || undefined, userId: e.user_id || undefined }));
  const usersList = isRep ? [] : userRes.rows.map((u) => ({ id: u.id, fullName: u.full_name, username: u.username, role: u.role, identityId: u.identity_id || undefined, employeeId: u.employee_id || undefined }));

  const metaData = { settings, warehouses, cashboxes, products, customers, suppliers, representatives };
  const resolvers = buildBranchResolvers(metaData);
  const { branchById, resolveBranchName, resolveCashboxName } = resolvers;

  const parsedParty = parseUnifiedPartyFilter(filters);
  const dateFrom = filters.dateFrom ? String(filters.dateFrom).split('T')[0] : null;
  const dateTo = filters.dateTo ? String(filters.dateTo).split('T')[0] : null;
  const branchId = filters.branchId && filters.branchId !== 'all' ? String(filters.branchId) : null;
  const branchObj = branchId ? branchById.get(branchId) || null : null;
  const warehouseId = filters.warehouseId && filters.warehouseId !== 'all' ? String(filters.warehouseId) : (branchObj?.warehouseId || null);
  const cashboxId = filters.cashboxId && filters.cashboxId !== 'all' ? String(filters.cashboxId) : (branchObj?.cashboxId || null);
  const productId = filters.productId && filters.productId !== 'all' ? String(filters.productId) : null;
  const customerId = parsedParty.customerId;
  const supplierId = isRep && !isRepCanPurchase && parsedParty.supplierId ? '__FORBIDDEN_SUPPLIER__' : parsedParty.supplierId;
  const representativeId = !isRep && filters.representativeId && filters.representativeId !== 'all' ? String(filters.representativeId) : null;
  const invoiceNumber = filters.invoiceNumber ? String(filters.invoiceNumber).trim() : '';

  let rows = [];
  let totalUnpaginatedRows = 0;
  let totalsObj = { count: 0, quantity: 0, priceOrTotal: null, valueOrPaid: 0, remaining: null, profit: 0, costValue: 0, discount: 0, profitPercent: 0 };

  if (isReturnReport) {
    const retClauses = [`r.type = $1`];
    const retParams = [retType];
    if (isRep) {
      if (!isSales && !isRepCanPurchase) {
        retClauses.push(`1 = 0`);
      } else {
        const ownInvPred = buildPgRepOwnInvPred('oi', actor, repProfile, retParams);
        const ownRetParts = [
          `EXISTS (SELECT 1 FROM invoices oi WHERE oi.id = r.original_invoice_id AND ${ownInvPred}${isSales ? '' : " AND oi.type = 'purchase'"})`,
        ];
        if (actor?.id) {
          retParams.push(actor.id);
          const idRef = `$${retParams.length}`;
          ownRetParts.push(`(r.original_invoice_id IS NULL AND r.created_by_user_id = ${idRef})`);
          ownRetParts.push(`(r.original_invoice_id IS NULL AND r.created_by_user_id IS NULL AND r.created_by = ${idRef})`);
        }
        retClauses.push(`(${ownRetParts.join(' OR ')})`);
      }
    }
    if (dateFrom) {
      retParams.push(dateFrom);
      retClauses.push(`r.date >= $${retParams.length}`);
    }
    if (dateTo) {
      retParams.push(dateTo);
      retClauses.push(`r.date <= $${retParams.length}`);
    }
    if (warehouseId) {
      retParams.push(warehouseId);
      retClauses.push(`r.warehouse_id = $${retParams.length}`);
    }
    if (cashboxId && !isRep) {
      retParams.push(cashboxId);
      retClauses.push(`r.cashbox_id = $${retParams.length}`);
    }
    if (isSales && customerId) {
      retParams.push(customerId);
      retClauses.push(`r.party_id = $${retParams.length}`);
    } else if (!isSales && customerId) {
      retClauses.push(`1 = 0`);
    }
    if (!isSales && supplierId) {
      retParams.push(supplierId);
      retClauses.push(`r.party_id = $${retParams.length}`);
    } else if (isSales && supplierId) {
      retClauses.push(`1 = 0`);
    }
    if (representativeId) {
      retParams.push(representativeId);
      retClauses.push(`r.original_invoice_id IN (SELECT id FROM invoices WHERE representative_id = $${retParams.length})`);
    }
    if (invoiceNumber) {
      retParams.push(`%${invoiceNumber}%`);
      retClauses.push(`(LOWER(r.return_number) LIKE LOWER($${retParams.length}) OR LOWER(COALESCE(r.original_invoice_number, '')) LIKE LOWER($${retParams.length}))`);
    }

    if (isInvoiceLayout) {
      if (productId) {
        retParams.push(productId);
        retClauses.push(`EXISTS (SELECT 1 FROM invoice_return_items iri WHERE iri.return_id = r.id AND iri.product_id = $${retParams.length})`);
      }
      const whereSql = `WHERE ${retClauses.join(' AND ')}`;
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(r.grand_total),0) AS sum_total,
                COALESCE(SUM(CASE WHEN r.refund_type = 'cash' THEN r.grand_total ELSE 0 END),0) AS sum_cash,
                COALESCE(SUM(CASE WHEN COALESCE(r.refund_type,'balance') = 'balance' THEN r.grand_total ELSE 0 END),0) AS sum_bal
         FROM invoice_returns r ${whereSql}`,
        retParams
      );
      totalUnpaginatedRows = Number(countRes.rows[0]?.cnt || 0);
      const totalPages = Math.max(1, Math.ceil(totalUnpaginatedRows / pageSize));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * pageSize;

      const pageParams = [...retParams, pageSize, offset];
      const [pageRetRes, aggQtyRes] = await Promise.all([
        pool.query(
          `SELECT r.* FROM invoice_returns r ${whereSql} ORDER BY r.date DESC, r.created_at DESC, r.id DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
          pageParams
        ),
        pool.query(
          `SELECT COALESCE(SUM(iri.quantity), 0) AS sum_qty
           FROM invoice_return_items iri
           JOIN invoice_returns r ON r.id = iri.return_id
           ${whereSql}`,
          retParams
        ),
      ]);
      const pageRetIds = pageRetRes.rows.map((x) => x.id);
      const pageOrigInvIds = [...new Set(pageRetRes.rows.map((x) => x.original_invoice_id).filter(Boolean))];
      const [retItemsRes, origInvItemsRes, fullRetCostItemsRes] = await Promise.all([
        pageRetIds.length > 0
          ? (() => {
              const p = [];
              const pred = buildPgInPredicate('return_id', pageRetIds, p);
              return pool.query(`SELECT * FROM invoice_return_items WHERE ${pred}`, p);
            })()
          : Promise.resolve({ rows: [] }),
        pageOrigInvIds.length > 0 && !isRep && isSales
          ? (() => {
              const p = [];
              const pred = buildPgInPredicate('invoice_id', pageOrigInvIds, p);
              return pool.query(`SELECT invoice_id, product_id, purchase_price_at_time FROM invoice_items WHERE ${pred}`, p);
            })()
          : Promise.resolve({ rows: [] }),
        !isRep
          ? pool.query(
              `SELECT iri.product_id, iri.unit, iri.unit_factor, iri.quantity, r.original_invoice_id
               FROM invoice_return_items iri
               JOIN invoice_returns r ON r.id = iri.return_id
               ${whereSql}`,
              retParams
            )
          : Promise.resolve({ rows: [] }),
      ]);
      const retItemsById = new Map();
      for (const it of retItemsRes.rows) {
        const list = retItemsById.get(it.return_id) || [];
        list.push(it);
        retItemsById.set(it.return_id, list);
      }
      const origCostByInvProd = new Map();
      for (const it of origInvItemsRes.rows) {
        origCostByInvProd.set(`${it.invoice_id}::${it.product_id}`, Number(it.purchase_price_at_time || 0));
      }
      if (!isRep && isSales && fullRetCostItemsRes.rows.length > 0) {
        const missingOrigIds = [...new Set(fullRetCostItemsRes.rows.map((x) => x.original_invoice_id).filter((id) => id && !pageOrigInvIds.includes(id)))];
        if (missingOrigIds.length > 0) {
          const p = [];
          const pred = buildPgInPredicate('invoice_id', missingOrigIds, p);
          const extraOrigRes = await pool.query(
            `SELECT invoice_id, product_id, purchase_price_at_time FROM invoice_items WHERE ${pred}`,
            p
          );
          for (const it of extraOrigRes.rows) {
            origCostByInvProd.set(`${it.invoice_id}::${it.product_id}`, Number(it.purchase_price_at_time || 0));
          }
        }
      }

      rows = pageRetRes.rows.map((r) => {
        const itemsList = retItemsById.get(r.id) || [];
        const retQtySum = round3(itemsList.reduce((s, it) => s + Number(it.quantity || 0), 0));
        const retCostSum = isRep
          ? 0
          : round2(
              itemsList.reduce((s, it) => {
                const prod = productMap.get(it.product_id);
                const uf = Number(it.unit_factor || resolveUnitFactor(prod, it.unit) || 1);
                const bQty = round3(Number(it.quantity || 0) * uf);
                const origCost = origCostByInvProd.get(`${r.original_invoice_id}::${it.product_id}`) || 0;
                const costPerBase = origCost > 0 ? origCost : Number(prod?.purchasePrice || 0);
                return s + costPerBase * bQty;
              }, 0)
            );
        const retProfit = isRep || !isSales ? 0 : round2(-(Number(r.grand_total || 0) - retCostSum));
        const retDate = isoDateOnly(r.date);
        const cbId = r.cashbox_id || '';
        return {
          rowId: `${r.id}-RET`,
          docType: r.type,
          docId: r.id,
          operationLabel: r.party_name || '-',
          quantity: retQtySum,
          unit: `${itemsList.length} صنف`,
          priceOrTotal: round2(r.grand_total || 0),
          valueOrPaid: r.refund_type === 'cash' ? round2(r.grand_total || 0) : 0,
          movementOrRemaining: (r.refund_type || 'balance') === 'balance' ? round2(r.grand_total || 0) : 0,
          employeeName: r.created_by || '-',
          userName: r.created_by || '-',
          businessDate: formatBusinessDateSlash(retDate),
          rawDate: retDate,
          actualDateTime: formatActualDateTimeAr(isoTimestamp(r.created_at), retDate),
          rawCreatedAt: isoTimestamp(r.created_at) || retDate,
          profit: retProfit,
          costValue: retCostSum,
          barcode: '',
          displayId: r.id,
          invoiceNumber: r.return_number,
          branchName: resolveBranchName(r.warehouse_id, cbId),
          warehouseId: r.warehouse_id,
          warehouseName: r.warehouse_name,
          cashboxId: isRep ? '' : cbId,
          cashboxName: isRep ? '-' : resolveCashboxName(cbId, (r.refund_type || 'balance') === 'balance' ? 'رصيد الحساب' : '-'),
          notes: `${r.reason || ''}${r.original_invoice_number ? ` (أصل: ${r.original_invoice_number})` : ''}`.trim(),
          discount: 0,
          profitPercent: isRep || !isSales ? 0 : calcProfitPctOnCost(retProfit, retCostSum),
          customerId: isSales ? r.party_id : undefined,
          supplierId: !isSales ? r.party_id : undefined,
          partyName: r.party_name,
          rowTone: 'warning_rose',
          scopeType: 'inventory',
        };
      });
      const fullRetTotalVal = round2(countRes.rows[0]?.sum_total || 0);
      const fullRetCost = isRep
        ? 0
        : round2(
            fullRetCostItemsRes.rows.reduce((s, it) => {
              const prod = productMap.get(it.product_id);
              const uf = Number(it.unit_factor || resolveUnitFactor(prod, it.unit) || 1);
              const bQty = round3(Number(it.quantity || 0) * uf);
              const origCost = isSales ? origCostByInvProd.get(`${it.original_invoice_id}::${it.product_id}`) || 0 : 0;
              const costPerBase = origCost > 0 ? origCost : Number(prod?.purchasePrice || 0);
              return s + costPerBase * bQty;
            }, 0)
          );
      const fullRetProfit = isRep || !isSales ? 0 : round2(-(fullRetTotalVal - fullRetCost));
      totalsObj = {
        count: totalUnpaginatedRows,
        quantity: round3(aggQtyRes.rows[0]?.sum_qty || 0),
        priceOrTotal: fullRetTotalVal,
        valueOrPaid: round2(countRes.rows[0]?.sum_cash || 0),
        remaining: round2(countRes.rows[0]?.sum_bal || 0),
        profit: fullRetProfit,
        costValue: fullRetCost,
        discount: 0,
        profitPercent: isRep || !isSales ? 0 : calcProfitPctOnCost(fullRetProfit, fullRetCost),
      };
    } else {
      if (productId) {
        retParams.push(productId);
        retClauses.push(`iri.product_id = $${retParams.length}`);
      }
      const whereSql = `WHERE ${retClauses.join(' AND ')}`;
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(iri.quantity),0) AS sum_qty, COALESCE(SUM(iri.total),0) AS sum_val
         FROM invoice_return_items iri
         JOIN invoice_returns r ON r.id = iri.return_id
         ${whereSql}`,
        retParams
      );
      totalUnpaginatedRows = Number(countRes.rows[0]?.cnt || 0);
      const totalPages = Math.max(1, Math.ceil(totalUnpaginatedRows / pageSize));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * pageSize;

      const pageParams = [...retParams, pageSize, offset];
      const [pageRetItemRes, fullRetCostItemsRes] = await Promise.all([
        pool.query(
          `SELECT iri.*, r.return_number, r.type AS ret_type, r.original_invoice_id, r.original_invoice_number,
                  r.date, r.created_at, r.created_by, r.party_id, r.party_name, r.warehouse_id, r.warehouse_name, r.cashbox_id, r.refund_type, r.reason, r.notes AS ret_notes
           FROM invoice_return_items iri
           JOIN invoice_returns r ON r.id = iri.return_id
           ${whereSql}
           ORDER BY r.date DESC, r.created_at DESC, r.id DESC, iri.id DESC
           LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
          pageParams
        ),
        !isRep
          ? pool.query(
              `SELECT iri.product_id, iri.unit, iri.unit_factor, iri.quantity, iri.total, r.original_invoice_id
               FROM invoice_return_items iri
               JOIN invoice_returns r ON r.id = iri.return_id
               ${whereSql}`,
              retParams
            )
          : Promise.resolve({ rows: [] }),
      ]);
      const origInvIdsForCost = [
        ...new Set(
          (fullRetCostItemsRes.rows.length > 0 ? fullRetCostItemsRes.rows : pageRetItemRes.rows)
            .map((x) => x.original_invoice_id)
            .filter(Boolean)
        ),
      ];
      const origInvItemsRes = origInvIdsForCost.length > 0 && !isRep && isSales
        ? await (() => {
            const p = [];
            const pred = buildPgInPredicate('invoice_id', origInvIdsForCost, p);
            return pool.query(`SELECT invoice_id, product_id, purchase_price_at_time FROM invoice_items WHERE ${pred}`, p);
          })()
        : { rows: [] };
      const origCostByInvProd = new Map();
      for (const it of origInvItemsRes.rows) {
        origCostByInvProd.set(`${it.invoice_id}::${it.product_id}`, Number(it.purchase_price_at_time || 0));
      }

      rows = pageRetItemRes.rows.map((r, idx) => {
        const prod = productMap.get(r.product_id);
        const qty = Number(r.quantity || 0);
        const uf = Number(r.unit_factor || resolveUnitFactor(prod, r.unit) || 1);
        const baseQty = round3(qty * uf);
        const unitPrice = round2(r.unit_price || 0);
        const lineTotal = round2(r.total ?? unitPrice * qty);
        const origCost = origCostByInvProd.get(`${r.original_invoice_id}::${r.product_id}`) || 0;
        const costPerBase = isRep ? 0 : (origCost > 0 ? origCost : Number(prod?.purchasePrice || 0));
        const lineCost = isRep ? 0 : round2(costPerBase * baseQty);
        const lineProfitImpact = isRep || !isSales ? 0 : round2(-(lineTotal - lineCost));
        const retDate = isoDateOnly(r.date);
        const cbId = r.cashbox_id || '';
        return {
          rowId: `${r.return_id}-RIT-SQL-${offset + idx}`,
          docType: r.ret_type,
          docId: r.return_id,
          productId: r.product_id,
          productName: r.product_name || prod?.name || '',
          operationLabel: r.product_name || prod?.name || '',
          quantity: qty,
          baseQuantity: baseQty,
          unit: r.unit || prod?.baseUnit || 'قطعة',
          priceOrTotal: unitPrice,
          valueOrPaid: lineTotal,
          movementOrRemaining: `${r.party_name || ''} (${isSales ? 'مرتجع بيع' : 'مرتجع شراء'})`,
          employeeName: r.created_by || '-',
          userName: r.created_by || '-',
          businessDate: formatBusinessDateSlash(retDate),
          rawDate: retDate,
          actualDateTime: formatActualDateTimeAr(isoTimestamp(r.created_at), retDate),
          rawCreatedAt: isoTimestamp(r.created_at) || retDate,
          profit: lineProfitImpact,
          costValue: lineCost,
          barcode: prod?.barcode || prod?.code || '',
          displayId: prod?.code || r.product_id,
          invoiceNumber: r.return_number,
          branchName: resolveBranchName(r.warehouse_id, cbId),
          warehouseId: r.warehouse_id,
          warehouseName: r.warehouse_name,
          cashboxId: isRep ? '' : cbId,
          cashboxName: isRep ? '-' : resolveCashboxName(cbId, (r.refund_type || 'balance') === 'balance' ? 'رصيد الحساب' : '-'),
          notes: `${r.reason || ''}${r.ret_notes ? ` — ${r.ret_notes}` : ''}`.trim(),
          discount: 0,
          profitPercent: isRep || !isSales ? 0 : calcProfitPctOnCost(lineProfitImpact, lineCost),
          customerId: isSales ? r.party_id : undefined,
          supplierId: !isSales ? r.party_id : undefined,
          partyName: r.party_name,
          rowTone: 'warning_rose',
          scopeType: 'inventory',
        };
      });
      const fullRetItemVal = round2(countRes.rows[0]?.sum_val || 0);
      const fullRetItemCost = isRep
        ? 0
        : round2(
            fullRetCostItemsRes.rows.reduce((s, it) => {
              const prod = productMap.get(it.product_id);
              const uf = Number(it.unit_factor || resolveUnitFactor(prod, it.unit) || 1);
              const bQty = round3(Number(it.quantity || 0) * uf);
              const origCost = isSales ? origCostByInvProd.get(`${it.original_invoice_id}::${it.product_id}`) || 0 : 0;
              const costPerBase = origCost > 0 ? origCost : Number(prod?.purchasePrice || 0);
              return s + costPerBase * bQty;
            }, 0)
          );
      const fullRetItemProfit = isRep || !isSales ? 0 : round2(-(fullRetItemVal - fullRetItemCost));
      totalsObj = {
        count: totalUnpaginatedRows,
        quantity: round3(countRes.rows[0]?.sum_qty || 0),
        priceOrTotal: null,
        valueOrPaid: fullRetItemVal,
        remaining: null,
        profit: fullRetItemProfit,
        costValue: fullRetItemCost,
        discount: 0,
        profitPercent: isRep || !isSales ? 0 : calcProfitPctOnCost(fullRetItemProfit, fullRetItemCost),
      };
    }
  } else {
    const clauses = [`i.status = 'confirmed'`, `i.type = $1`];
    const params = [invType];
    if (isRep) {
      if (!isSales && !isRepCanPurchase) {
        clauses.push(`1 = 0`);
      } else {
        clauses.push(buildPgRepOwnInvPred('i', actor, repProfile, params));
      }
    }
    if (dateFrom) {
      params.push(dateFrom);
      clauses.push(`i.date >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      clauses.push(`i.date <= $${params.length}`);
    }
    if (warehouseId) {
      params.push(warehouseId);
      clauses.push(`i.warehouse_id = $${params.length}`);
    }
    if (cashboxId && !isRep) {
      params.push(cashboxId);
      clauses.push(`i.cashbox_id = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      clauses.push(`i.customer_id = $${params.length}`);
    }
    if (supplierId) {
      params.push(supplierId);
      clauses.push(`i.supplier_id = $${params.length}`);
    }
    if (representativeId) {
      params.push(representativeId);
      clauses.push(`i.representative_id = $${params.length}`);
    }
    if (invoiceNumber) {
      params.push(`%${invoiceNumber}%`);
      clauses.push(`LOWER(i.invoice_number) LIKE LOWER($${params.length})`);
    }

    if (isInvoiceLayout) {
      if (productId) {
        params.push(productId);
        clauses.push(`EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = i.id AND ii.product_id = $${params.length})`);
      }
      const whereSql = `WHERE ${clauses.join(' AND ')}`;
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(i.grand_total),0) AS sum_total, COALESCE(SUM(i.paid_amount),0) AS sum_paid, COALESCE(SUM(i.remaining_amount),0) AS sum_rem, COALESCE(SUM(i.discount_total),0) AS sum_disc FROM invoices i ${whereSql}`,
        params
      );
      totalUnpaginatedRows = Number(countRes.rows[0]?.cnt || 0);
      const totalPages = Math.max(1, Math.ceil(totalUnpaginatedRows / pageSize));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * pageSize;

      const pageParams = [...params, pageSize, offset];
      const [pageInvRes, fullInvAggRes] = await Promise.all([
        pool.query(
          `SELECT i.* FROM invoices i ${whereSql} ORDER BY i.date DESC, i.created_at DESC, i.id DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
          pageParams
        ),
        pool.query(
          `SELECT COALESCE(SUM(it.quantity), 0) AS sum_qty,
                  COALESCE(SUM(CASE WHEN COALESCE(it.purchase_price_at_time, 0) > 0 THEN it.purchase_price_at_time ELSE COALESCE(p.purchase_price, 0) END * (it.quantity * COALESCE(it.unit_factor, 1))), 0) AS sum_cost
           FROM invoice_items it
           JOIN invoices i ON i.id = it.invoice_id
           LEFT JOIN products p ON p.id = it.product_id
           ${whereSql}`,
          params
        ),
      ]);
      const pageInvIds = pageInvRes.rows.map((r) => r.id);
      const itemsByInv = new Map();
      if (pageInvIds.length > 0) {
        const p = [];
        const pred = buildPgInPredicate('invoice_id', pageInvIds, p);
        const itRes = await pool.query(`SELECT * FROM invoice_items WHERE ${pred}`, p);
        for (const it of itRes.rows) {
          const list = itemsByInv.get(it.invoice_id) || [];
          list.push(it);
          itemsByInv.set(it.invoice_id, list);
        }
      }

      rows = pageInvRes.rows.map((r) => {
        const inv = mapPgInvoiceRow(r, itemsByInv.get(r.id) || [], []);
        const cust = isSales && inv.customerId ? customerMap.get(inv.customerId) : null;
        const supp = !isSales && inv.supplierId ? supplierMap.get(inv.supplierId) : null;
        const partyName = isSales ? (inv.customerName || cust?.name || 'عميل نقدي') : (inv.supplierName || supp?.name || 'مورد نقدي');
        const partyPhone = cust?.phone || supp?.phone || '';
        const invQtySum = round3((inv.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0));
        const invCostSum = isRep
          ? 0
          : round2((inv.items || []).reduce((s, it) => {
              const p = productMap.get(it.productId);
              const c = Number(it.purchasePriceAtTime || 0) > 0 ? Number(it.purchasePriceAtTime) : Number(p?.purchasePrice || 0);
              return s + c * round3(Number(it.quantity || 0) * Number(it.unitFactor || 1));
            }, 0));
        const invProfit = isRep || !isSales ? 0 : round2(Number(inv.grandTotal || 0) - invCostSum);
        return {
          rowId: `${inv.id}-INV`,
          docType: isSales ? 'sales_invoice' : 'purchase_invoice',
          docId: inv.id,
          operationLabel: partyPhone ? `${partyName} (${partyPhone})` : partyName,
          quantity: invQtySum,
          unit: `${(inv.items || []).length} صنف`,
          priceOrTotal: round2(inv.grandTotal || 0),
          valueOrPaid: round2(inv.paidAmount || 0),
          movementOrRemaining: round2(inv.remainingAmount || 0),
          paidAmount: round2(inv.paidAmount || 0),
          remainingAmount: round2(inv.remainingAmount || 0),
          paymentStatus: Number(inv.remainingAmount || 0) <= 0.01 ? 'paid' : Number(inv.paidAmount || 0) > 0 ? 'partial' : 'unpaid',
          invoiceStatus: inv.status,
          employeeId: inv.representativeId || undefined,
          employeeName: inv.representativeName || inv.createdBy || '-',
          userName: inv.createdBy,
          businessDate: formatBusinessDateSlash(inv.date),
          rawDate: inv.date,
          actualDateTime: formatActualDateTimeAr(inv.createdAt, inv.date),
          rawCreatedAt: inv.createdAt || inv.date,
          profit: invProfit,
          costValue: invCostSum,
          barcode: '',
          displayId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          branchName: resolveBranchName(inv.warehouseId, inv.cashboxId),
          warehouseId: inv.warehouseId,
          warehouseName: inv.warehouseName,
          cashboxId: isRep ? '' : inv.cashboxId,
          cashboxName: isRep ? '-' : resolveCashboxName(inv.cashboxId),
          notes: `${inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'partial' ? 'سداد جزئي' : 'آجل'}${inv.notes ? ` - ${inv.notes}` : ''}`,
          discount: round2(inv.discountTotal || 0),
          profitPercent: isRep || !isSales ? 0 : calcProfitPctOnCost(invProfit, invCostSum),
          customerId: isSales ? inv.customerId : undefined,
          supplierId: !isSales ? inv.supplierId : undefined,
          partyName,
          representativeId: inv.representativeId || undefined,
          representativeName: inv.representativeName || undefined,
          rowTone: 'invoice_blue',
          scopeType: 'inventory',
        };
      });

      const fullInvTotal = round2(countRes.rows[0]?.sum_total || 0);
      const fullInvCost = isRep ? 0 : round2(fullInvAggRes.rows[0]?.sum_cost || 0);
      const fullInvProfit = isRep || !isSales ? 0 : round2(fullInvTotal - fullInvCost);
      totalsObj = {
        count: totalUnpaginatedRows,
        quantity: round3(fullInvAggRes.rows[0]?.sum_qty || 0),
        priceOrTotal: fullInvTotal,
        valueOrPaid: round2(countRes.rows[0]?.sum_paid || 0),
        remaining: round2(countRes.rows[0]?.sum_rem || 0),
        profit: fullInvProfit,
        costValue: fullInvCost,
        discount: round2(countRes.rows[0]?.sum_disc || 0),
        profitPercent: isRep || !isSales ? 0 : calcProfitPctOnCost(fullInvProfit, fullInvCost),
      };
    } else {
      if (productId) {
        params.push(productId);
        clauses.push(`it.product_id = $${params.length}`);
      }
      const whereSql = `WHERE ${clauses.join(' AND ')}`;
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt,
                COALESCE(SUM(it.quantity), 0) AS sum_qty,
                COALESCE(SUM(it.total), 0) AS sum_val,
                COALESCE(SUM(it.discount), 0) AS sum_disc,
                COALESCE(SUM(CASE WHEN COALESCE(it.purchase_price_at_time, 0) > 0 THEN it.purchase_price_at_time ELSE COALESCE(p.purchase_price, 0) END * (it.quantity * COALESCE(it.unit_factor, 1))), 0) AS sum_cost
         FROM invoice_items it
         JOIN invoices i ON i.id = it.invoice_id
         LEFT JOIN products p ON p.id = it.product_id
         ${whereSql}`,
        params
      );
      totalUnpaginatedRows = Number(countRes.rows[0]?.cnt || 0);
      const totalPages = Math.max(1, Math.ceil(totalUnpaginatedRows / pageSize));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * pageSize;

      const pageParams = [...params, pageSize, offset];
      const pageItemRes = await pool.query(
        `SELECT it.*, i.invoice_number, i.date, i.created_at, i.created_by, i.warehouse_id, i.warehouse_name, i.cashbox_id, i.customer_id, i.customer_name, i.supplier_id, i.supplier_name, i.representative_id, i.representative_name, i.notes, i.status AS inv_status, i.paid_amount AS inv_paid, i.remaining_amount AS inv_rem
         FROM invoice_items it
         JOIN invoices i ON i.id = it.invoice_id
         ${whereSql}
         ORDER BY i.date DESC, i.created_at DESC, i.id DESC, it.id DESC
         LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
        pageParams
      );

      rows = pageItemRes.rows.map((r, idx) => {
        const prod = productMap.get(r.product_id);
        const cust = isSales && r.customer_id ? customerMap.get(r.customer_id) : null;
        const supp = !isSales && r.supplier_id ? supplierMap.get(r.supplier_id) : null;
        const partyName = isSales ? (r.customer_name || cust?.name || 'عميل نقدي') : (r.supplier_name || supp?.name || 'مورد نقدي');
        const partyPhone = cust?.phone || supp?.phone || '';
        const partyWithPhone = partyPhone ? `${partyName} (${partyPhone})` : partyName;
        const qty = Number(r.quantity || 0);
        const unitFactor = Number(r.unit_factor || resolveUnitFactor(prod, r.unit) || 1);
        const baseQty = round3(qty * unitFactor);
        const netLineVal = round2(r.total ?? Number(r.unit_price || 0) * qty - Number(r.discount || 0));
        const costPerBase = isRep ? 0 : (Number(r.purchase_price_at_time || 0) > 0 ? Number(r.purchase_price_at_time) : Number(prod?.purchasePrice || 0));
        const lineCost = isRep ? 0 : round2(costPerBase * baseQty);
        const lineProfit = isRep || !isSales ? 0 : round2(netLineVal - lineCost);
        const invDate = isoDateOnly(r.date);
        return {
          rowId: `${r.invoice_id}-IT-SQL-${offset + idx}`,
          docType: isSales ? 'sales_invoice' : 'purchase_invoice',
          docId: r.invoice_id,
          productId: r.product_id,
          productCode: prod?.code || '',
          productName: r.product_name || prod?.name || '',
          categoryName: prod?.category || 'عام',
          class1: normalizeClassification1(prod),
          operationLabel: r.product_name || prod?.name || '',
          quantity: qty,
          baseQuantity: baseQty,
          unit: r.unit || prod?.baseUnit || 'قطعة',
          baseUnit: prod?.baseUnit || r.unit || 'قطعة',
          unitFactor,
          priceOrTotal: round2(r.unit_price || 0),
          valueOrPaid: netLineVal,
          movementOrRemaining: isSales ? `${partyWithPhone} - فاتورة بيع` : `${partyWithPhone} - فاتورة شراء`,
          paidAmount: round2(r.inv_paid || 0),
          remainingAmount: round2(r.inv_rem || 0),
          paymentStatus: Number(r.inv_rem || 0) <= 0.01 ? 'paid' : Number(r.inv_paid || 0) > 0 ? 'partial' : 'unpaid',
          invoiceStatus: r.inv_status || 'confirmed',
          employeeId: r.representative_id || undefined,
          employeeName: r.representative_name || r.created_by || '-',
          userName: r.created_by,
          businessDate: formatBusinessDateSlash(invDate),
          rawDate: invDate,
          actualDateTime: formatActualDateTimeAr(isoTimestamp(r.created_at), invDate),
          rawCreatedAt: isoTimestamp(r.created_at),
          profit: lineProfit,
          costValue: lineCost,
          barcode: r.barcode || prod?.barcode || prod?.code || '',
          displayId: prod?.code || r.product_id,
          invoiceNumber: r.invoice_number,
          branchName: resolveBranchName(r.warehouse_id, r.cashbox_id),
          warehouseId: r.warehouse_id,
          warehouseName: r.warehouse_name,
          cashboxId: isRep ? '' : r.cashbox_id,
          cashboxName: isRep ? '-' : resolveCashboxName(r.cashbox_id),
          notes: r.notes || '',
          discount: round2(r.discount || 0),
          profitPercent: isRep || !isSales ? 0 : calcProfitPctOnCost(lineProfit, lineCost),
          customerId: isSales ? r.customer_id : undefined,
          supplierId: !isSales ? r.supplier_id : undefined,
          partyName,
          representativeId: r.representative_id || undefined,
          representativeName: r.representative_name || undefined,
          rowTone: 'default',
          scopeType: 'inventory',
        };
      });

      const fullItemVal = round2(countRes.rows[0]?.sum_val || 0);
      const fullItemCost = isRep ? 0 : round2(countRes.rows[0]?.sum_cost || 0);
      const fullItemProfit = isRep || !isSales ? 0 : round2(fullItemVal - fullItemCost);
      totalsObj = {
        count: totalUnpaginatedRows,
        quantity: round3(countRes.rows[0]?.sum_qty || 0),
        priceOrTotal: null,
        valueOrPaid: fullItemVal,
        remaining: null,
        profit: fullItemProfit,
        costValue: fullItemCost,
        discount: round2(countRes.rows[0]?.sum_disc || 0),
        profitPercent: isRep || !isSales ? 0 : calcProfitPctOnCost(fullItemProfit, fullItemCost),
      };
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalUnpaginatedRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const titleMap = {
    sales_invoices: 'فواتير بيع',
    purchase_invoices: 'فواتير شراء',
    sales_items: 'أصناف البيع',
    purchase_items: 'أصناف شراء',
    sales_return_invoices: 'فواتير مرتجع بيع',
    purchase_return_invoices: 'فواتير مرتجع شراء',
    sales_return_items: 'أصناف مرتجع بيع',
    purchase_return_items: 'أصناف مرتجع شراء',
  };

  let drawerBalance = 0;
  let reportBalance = 0;
  let carriedFromYesterday = 0;
  if (!isRep) {
    let targetCashboxes = cashboxes;
    if (cashboxId) targetCashboxes = targetCashboxes.filter((c) => c.id === cashboxId);
    const targetCbSet = new Set(targetCashboxes.map((c) => c.id));
    const cbNameToId = new Map(cashboxes.map((c) => [String(c.name || '').trim(), c.id]));
    const liveCashBalance = round2(targetCashboxes.reduce((s, c) => s + Number(c.currentBalance || 0), 0));
    const ftRows = dateFrom
      ? (await pool.query(`SELECT date, type, amount, cashbox_id, description, related_entity_name FROM financial_transactions WHERE date >= $1`, [dateFrom])).rows
      : (await pool.query(`SELECT date, type, amount, cashbox_id, description, related_entity_name FROM financial_transactions`)).rows;
    let deltaAfter = 0;
    let periodNet = 0;
    for (const f of ftRows) {
      const txObj = { date: isoDateOnly(f.date), type: f.type, amount: Number(f.amount || 0), cashboxId: f.cashbox_id, description: f.description, relatedEntityName: f.related_entity_name };
      const d = computeSignedCashDelta(txObj, targetCbSet, cbNameToId);
      if (!d) continue;
      if (dateTo && txObj.date > dateTo) deltaAfter = round2(deltaAfter + d);
      else if ((!dateFrom || txObj.date >= dateFrom) && (!dateTo || txObj.date <= dateTo)) periodNet = round2(periodNet + d);
    }
    drawerBalance = round2(liveCashBalance - deltaAfter);
    reportBalance = round2(periodNet);
    carriedFromYesterday = round2(drawerBalance - reportBalance);
  }

  let returnsDeduction = 0;
  let exactFilteredSalesNet = 0;
  let exactFilteredPurchasesNet = 0;
  if (!isReturnReport && !invoiceNumber) {
    const retClauses = [`r.type = $1`];
    const retParams = [retType];
    if (isRep) {
      const ownInvPred = buildPgRepOwnInvPred('oi', actor, repProfile, retParams);
      const ownRetParts = [
        `EXISTS (SELECT 1 FROM invoices oi WHERE oi.id = r.original_invoice_id AND ${ownInvPred})`,
      ];
      if (actor?.id) {
        retParams.push(actor.id);
        const idRef = `$${retParams.length}`;
        ownRetParts.push(`(r.original_invoice_id IS NULL AND r.created_by_user_id = ${idRef})`);
        ownRetParts.push(`(r.original_invoice_id IS NULL AND r.created_by_user_id IS NULL AND r.created_by = ${idRef})`);
      }
      retClauses.push(`(${ownRetParts.join(' OR ')})`);
    }
    if (dateFrom) {
      retParams.push(dateFrom);
      retClauses.push(`r.date >= $${retParams.length}`);
    }
    if (dateTo) {
      retParams.push(dateTo);
      retClauses.push(`r.date <= $${retParams.length}`);
    }
    if (warehouseId) {
      retParams.push(warehouseId);
      retClauses.push(`r.warehouse_id = $${retParams.length}`);
    }
    if (isSales && customerId) {
      retParams.push(customerId);
      retClauses.push(`r.party_id = $${retParams.length}`);
    }
    if (!isSales && supplierId) {
      retParams.push(supplierId);
      retClauses.push(`r.party_id = $${retParams.length}`);
    }
    if (productId) {
      retParams.push(productId);
      const rRetRes = await pool.query(
        `SELECT COALESCE(SUM(iri.total), 0) AS sum_ret
         FROM invoice_return_items iri
         JOIN invoice_returns r ON r.id = iri.return_id
         WHERE ${retClauses.join(' AND ')} AND iri.product_id = $${retParams.length}`,
        retParams
      );
      returnsDeduction = round2(rRetRes.rows[0]?.sum_ret || 0);
    } else {
      const rRetRes = await pool.query(
        `SELECT COALESCE(SUM(r.grand_total), 0) AS sum_ret FROM invoice_returns r WHERE ${retClauses.join(' AND ')}`,
        retParams
      );
      returnsDeduction = round2(rRetRes.rows[0]?.sum_ret || 0);
    }
    const baseNetSalesOrPurch = isInvoiceLayout ? Number(totalsObj.priceOrTotal || 0) : Number(totalsObj.valueOrPaid || 0);
    const exactFilteredNet = round2(baseNetSalesOrPurch - returnsDeduction);
    if (isSales) exactFilteredSalesNet = exactFilteredNet;
    else exactFilteredPurchasesNet = exactFilteredNet;
  } else if (isReturnReport) {
    const retValSum = isInvoiceLayout ? Number(totalsObj.priceOrTotal || 0) : Number(totalsObj.valueOrPaid || 0);
    if (isSales) exactFilteredSalesNet = round2(-retValSum);
    else exactFilteredPurchasesNet = round2(-retValSum);
  }

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
      productSearch: '',
      barcode: '',
      partyKey: parsedParty.partyKey,
      movementType: 'all',
      customerId: customerId || 'all',
      supplierId: supplierId || 'all',
      employeeId: 'all',
      userId: 'all',
      representativeId: representativeId || 'all',
      invoiceNumber: invoiceNumber.toLowerCase(),
      recordId: '',
      search: '',
    },
    filterOptions: {
      branches: isRep ? [] : resolvers.branches,
      warehouses: isRep ? warehouses.filter((w) => repProfile?.warehouseId && w.id === repProfile.warehouseId) : warehouses,
      cashboxes: isRep ? [] : cashboxes,
      products: products.map((p) => ({ id: p.id, code: p.code, barcode: p.barcode, name: p.name, category: p.category, baseUnit: p.baseUnit, size: p.size, color: p.color })),
      customers: customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
      suppliers: isRep && !isRepCanPurchase ? [] : suppliers.map((s) => ({ id: s.id, name: s.name, phone: s.phone })),
      employees: employeesList,
      representatives: isRep ? representatives.filter((r) => r.userId === actor?.id || r.id === repProfile?.id) : representatives,
      users: usersList,
    },
    sections: [
      {
        key: reportType,
        title: titleMap[reportType] || reportType,
        theme: 'sage',
        isInvoiceLayout,
        cashHighlightCol: false,
        totalSectionRows: totalUnpaginatedRows,
        rows,
        totals: totalsObj,
      },
    ],
    pagination: {
      enabled: true,
      sqlPaginated: true,
      page: safePage,
      pageSize,
      totalRows: totalUnpaginatedRows,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
    },
    summary: {
      drawerBalance,
      reportBalance,
      carriedFromYesterday,
      reportProfit: isRep || !isSales ? 0 : round2(totalsObj.profit || 0),
      reportProfitPercent: isRep || !isSales ? 0 : calcProfitPctOnCost(totalsObj.profit || 0, totalsObj.costValue || 0),
      filteredSalesNet: exactFilteredSalesNet,
      filteredPurchasesNet: exactFilteredPurchasesNet,
      filteredCashIn: 0,
      filteredCashOut: 0,
      totalRows: totalUnpaginatedRows,
    },
    itemLifecycle: null,
    itemPnl: {
      selectedItem: null,
      items: [],
      portfolioTotals: {
        totalPurchaseValue: 0, totalSalesValue: 0, netSalesValue: 0, cogs: 0, totalDiscounts: 0,
        salesReturnsValue: 0, purchaseReturnsValue: 0, allocatedExpenses: 0, grossProfit: 0, netProfit: 0, totalLoss: 0, stockValuation: 0,
      },
    },
  };
}

export async function getComprehensiveReport(filters = {}, actor) {
  const reportType = REPORT_TYPES_LIST.some((t) => t.key === filters.reportType)
    ? String(filters.reportType)
    : 'all';
  const rawPagePre = Number(filters.page);
  const rawPageSizePre = Number(filters.pageSize);
  const hasPagPre =
    (Number.isFinite(rawPagePre) && rawPagePre >= 1) || (Number.isFinite(rawPageSizePre) && rawPageSizePre >= 1);
  if (hasPagPre && (await isPgMode())) {
    const p = Number.isFinite(rawPagePre) && rawPagePre >= 1 ? Math.floor(rawPagePre) : 1;
    const ps = Math.min(500, Math.max(1, Number.isFinite(rawPageSizePre) && rawPageSizePre >= 1 ? Math.floor(rawPageSizePre) : 50));
    const sqlFast = await tryGetSqlPaginatedReportPg(filters, actor, reportType, p, ps);
    if (sqlFast) return sqlFast;
  }

  const data = await loadFullReportDataset(actor, filters);
  const resolvers = buildBranchResolvers(data);
  const { branchById, branchByWh, branchByCb, cashboxMap, resolveBranchName, resolveCashboxName } = resolvers;

  const parsedParty = parseUnifiedPartyFilter(filters);
  const movementType = normalizeMovementTypeFilter(filters.movementType);
  const isRepActorTop = actor?.role === 'representative';
  const isRepCanPurchaseTop = isRepActorTop && Boolean(actor?.permissions?.canCreatePurchase || actor?.permissions?.canManagePurchases);
  const dateFrom = filters.dateFrom ? String(filters.dateFrom).split('T')[0] : null;
  const dateTo = filters.dateTo ? String(filters.dateTo).split('T')[0] : null;
  const branchId = filters.branchId && filters.branchId !== 'all' ? String(filters.branchId) : null;
  const branchObj = branchId ? branchById.get(branchId) || null : null;
  const warehouseId = filters.warehouseId && filters.warehouseId !== 'all' ? String(filters.warehouseId) : null;
  const cashboxId = filters.cashboxId && filters.cashboxId !== 'all' ? String(filters.cashboxId) : null;
  const productId = filters.productId && filters.productId !== 'all' ? String(filters.productId) : null;
  const productSearch = filters.productSearch ? String(filters.productSearch).trim().toLowerCase() : '';
  const barcode = filters.barcode ? String(filters.barcode).trim().toLowerCase() : '';
  const customerId = parsedParty.customerId;
  const supplierId = isRepActorTop && !isRepCanPurchaseTop && parsedParty.supplierId ? '__FORBIDDEN_SUPPLIER__' : parsedParty.supplierId;
  const representativeId = filters.representativeId && filters.representativeId !== 'all' ? String(filters.representativeId) : null;
  const invoiceNumber = filters.invoiceNumber ? String(filters.invoiceNumber).trim().toLowerCase() : '';
  const recordId = filters.recordId ? String(filters.recordId).trim().toLowerCase() : '';
  const search = filters.search ? String(filters.search).trim().toLowerCase() : '';

  const userFilterSpec = resolveUserFilterSpec(filters.userId || filters.userName, data.users);
  const employeeFilterSpec = resolveEmployeeFilterSpec(
    filters.employeeId,
    data.employees,
    data.users,
    data.representatives
  );

  const productMap = new Map((data.products || []).map((p) => [p.id, p]));
  const customerMap = new Map((data.customers || []).map((c) => [c.id, c]));
  const supplierMap = new Map((data.suppliers || []).map((s) => [s.id, s]));
  const employeeMap = new Map((data.employees || []).map((e) => [e.id, e]));
  const repMap = new Map((data.representatives || []).map((r) => [r.id, r]));
  const invoiceMap = new Map((data.invoices || []).map((i) => [i.id, i]));
  const userByIdMap = new Map((data.users || []).map((u) => [u.id, u]));
  const userByNameMap = new Map();
  for (const u of data.users || []) {
    if (u.username) userByNameMap.set(String(u.username).trim().toLowerCase(), u);
    if (u.fullName) userByNameMap.set(String(u.fullName).trim().toLowerCase(), u);
  }
  const employeeByIdentityId = new Map();
  const employeeByUserId = new Map();
  for (const e of data.employees || []) {
    if (e.identityId && !employeeByIdentityId.has(e.identityId)) employeeByIdentityId.set(e.identityId, e);
    if (e.userId && !employeeByUserId.has(e.userId)) employeeByUserId.set(e.userId, e);
  }
  for (const u of data.users || []) {
    if (u.employeeId && employeeMap.has(u.employeeId) && !employeeByUserId.has(u.id)) {
      employeeByUserId.set(u.id, employeeMap.get(u.employeeId));
    }
  }

  const resolveRowActorInfo = (rawDoc, explicitEmpId = null, explicitRepId = null, explicitRepName = '') => {
    const fallbackUser = !rawDoc?.createdByUserId && rawDoc?.createdBy
      ? userByNameMap.get(String(rawDoc.createdBy).trim().toLowerCase()) || null
      : null;
    const resolvedUserId = rawDoc?.createdByUserId || fallbackUser?.id || undefined;
    const userObj = (resolvedUserId ? userByIdMap.get(resolvedUserId) : null) || fallbackUser || null;
    const resolvedUserName = userObj?.fullName || rawDoc?.createdBy || '-';

    const repId = explicitRepId || rawDoc?.representativeId || undefined;
    const repObj = repId ? repMap.get(repId) || null : null;
    const empCandidate =
      (explicitEmpId ? employeeMap.get(explicitEmpId) : null) ||
      (rawDoc?.actorEmployeeId ? employeeMap.get(rawDoc.actorEmployeeId) : null) ||
      (userObj?.employeeId ? employeeMap.get(userObj.employeeId) : null) ||
      (resolvedUserId ? employeeByUserId.get(resolvedUserId) : null) ||
      (rawDoc?.actorIdentityId ? employeeByIdentityId.get(rawDoc.actorIdentityId) : null) ||
      (userObj?.identityId ? employeeByIdentityId.get(userObj.identityId) : null) ||
      (repObj?.identityId ? employeeByIdentityId.get(repObj.identityId) : null) ||
      (repObj?.userId ? employeeByUserId.get(repObj.userId) : null) ||
      null;
    const resolvedEmployeeId = empCandidate?.id || explicitEmpId || rawDoc?.actorEmployeeId || undefined;
    const resolvedEmployeeName = empCandidate?.name || explicitRepName || repObj?.name || rawDoc?.representativeName || '-';
    const resolvedActorIdentityId = rawDoc?.actorIdentityId || userObj?.identityId || empCandidate?.identityId || repObj?.identityId || undefined;
    const resolvedActorEmployeeId = rawDoc?.actorEmployeeId || empCandidate?.id || undefined;

    return {
      userId: resolvedUserId,
      userName: resolvedUserName,
      employeeId: resolvedEmployeeId,
      employeeName: resolvedEmployeeName,
      actorEmployeeId: resolvedActorEmployeeId,
      actorIdentityId: resolvedActorIdentityId,
    };
  };

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
    if (movementType !== 'all' && ctx.movementCategory !== movementType) return false;

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

    if (userFilterSpec) {
      if (userFilterSpec.userId && ctx.userId) {
        if (ctx.userId !== userFilterSpec.userId) return false;
      } else {
        const uVal = String(ctx.userName || '').trim().toLowerCase();
        if (!userFilterSpec.legacyNames.has(uVal)) return false;
      }
    }
    if (employeeFilterSpec) {
      const empMatched =
        ctx.employeeId === employeeFilterSpec.employeeId ||
        ctx.actorEmployeeId === employeeFilterSpec.employeeId ||
        (employeeFilterSpec.identityId && ctx.actorIdentityId === employeeFilterSpec.identityId) ||
        (ctx.userId && employeeFilterSpec.linkedUserIds.has(ctx.userId)) ||
        (ctx.representativeId && employeeFilterSpec.linkedRepIds.has(ctx.representativeId));
      if (!empMatched) return false;
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
    const invActorInfo = resolveRowActorInfo(inv, null, inv.representativeId, inv.representativeName || '');
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
        movementCategory: isSales ? 'sales' : 'purchase',
        docId: inv.id,
        productId: it.productId,
        productCode: prod?.code || '',
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
        paidAmount: round2(inv.paidAmount || 0),
        remainingAmount: round2(inv.remainingAmount || 0),
        paymentStatus: Number(inv.remainingAmount || 0) <= 0.01 ? 'paid' : Number(inv.paidAmount || 0) > 0 ? 'partial' : 'unpaid',
        invoiceStatus: inv.status,
        employeeId: invActorInfo.employeeId,
        employeeName: invActorInfo.employeeName,
        actorEmployeeId: invActorInfo.actorEmployeeId,
        actorIdentityId: invActorInfo.actorIdentityId,
        userId: invActorInfo.userId,
        userName: invActorInfo.userName,
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
        movementCategory: isSales ? 'sales' : 'purchase',
        docId: inv.id,
        operationLabel: partyWithPhone,
        quantity: invQtySum,
        unit: `${itemsList.length} صنف`,
        priceOrTotal: round2(inv.grandTotal || 0),
        valueOrPaid: round2(inv.paidAmount || 0),
        movementOrRemaining: round2(inv.remainingAmount || 0),
        paidAmount: round2(inv.paidAmount || 0),
        remainingAmount: round2(inv.remainingAmount || 0),
        paymentStatus: Number(inv.remainingAmount || 0) <= 0.01 ? 'paid' : Number(inv.paidAmount || 0) > 0 ? 'partial' : 'unpaid',
        invoiceStatus: inv.status,
        employeeId: invActorInfo.employeeId,
        employeeName: invActorInfo.employeeName,
        actorEmployeeId: invActorInfo.actorEmployeeId,
        actorIdentityId: invActorInfo.actorIdentityId,
        userId: invActorInfo.userId,
        userName: invActorInfo.userName,
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
    const retActorInfo = resolveRowActorInfo(ret, null, origInv?.representativeId || ret.representativeId, origInv?.representativeName || ret.representativeName || '');
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
        movementCategory: isSalesRet ? 'sales_return' : 'purchase_return',
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
        employeeId: retActorInfo.employeeId,
        employeeName: retActorInfo.employeeName,
        actorEmployeeId: retActorInfo.actorEmployeeId,
        actorIdentityId: retActorInfo.actorIdentityId,
        userId: retActorInfo.userId,
        userName: retActorInfo.userName,
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
        representativeId: origInv?.representativeId || ret.representativeId || undefined,
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
        movementCategory: isSalesRet ? 'sales_return' : 'purchase_return',
        docId: ret.id,
        operationLabel: ret.partyName || '-',
        quantity: retQtySum,
        unit: `${(ret.items || []).length} صنف`,
        priceOrTotal: round2(ret.grandTotal || 0),
        valueOrPaid: ret.refundType === 'cash' ? round2(ret.grandTotal || 0) : 0,
        movementOrRemaining: ret.refundType === 'balance' ? round2(ret.grandTotal || 0) : 0,
        employeeId: retActorInfo.employeeId,
        employeeName: retActorInfo.employeeName,
        actorEmployeeId: retActorInfo.actorEmployeeId,
        actorIdentityId: retActorInfo.actorIdentityId,
        userId: retActorInfo.userId,
        userName: retActorInfo.userName,
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
        representativeId: origInv?.representativeId || ret.representativeId || undefined,
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
    const opActorInfo = resolveRowActorInfo(op, null, op.representativeId, op.representativeName || '');

    const dmgRow = {
      rowId: `DMG-OP-${op.id}`,
      docType: 'damaged_voucher',
      movementCategory: 'damaged',
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
      employeeId: opActorInfo.employeeId,
      employeeName: opActorInfo.employeeName,
      actorEmployeeId: opActorInfo.actorEmployeeId,
      actorIdentityId: opActorInfo.actorIdentityId,
      userId: opActorInfo.userId,
      userName: opActorInfo.userName,
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
          employeeId: opActorInfo.employeeId,
          employeeName: opActorInfo.employeeName,
          actorEmployeeId: opActorInfo.actorEmployeeId,
          actorIdentityId: opActorInfo.actorIdentityId,
          userId: opActorInfo.userId,
          userName: opActorInfo.userName,
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
    const smActorInfo = resolveRowActorInfo(sm);

    const dmgRow = {
      rowId: `DMG-SM-${sm.id}`,
      docType: 'damaged_voucher',
      movementCategory: 'damaged',
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
      employeeId: smActorInfo.employeeId,
      employeeName: smActorInfo.employeeName,
      actorEmployeeId: smActorInfo.actorEmployeeId,
      actorIdentityId: smActorInfo.actorIdentityId,
      userId: smActorInfo.userId,
      userName: smActorInfo.userName,
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
          employeeId: smActorInfo.employeeId,
          employeeName: smActorInfo.employeeName,
          actorEmployeeId: smActorInfo.actorEmployeeId,
          actorIdentityId: smActorInfo.actorIdentityId,
          userId: smActorInfo.userId,
          userName: smActorInfo.userName,
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
    movementCategory: 'damaged',
    docId: b.docId,
    operationLabel: `سند توالف (${b.warehouseName})`,
    quantity: b.totalQty,
    unit: `${b.items.length} صنف`,
    priceOrTotal: round2(b.totalLoss),
    valueOrPaid: round2(b.totalLoss),
    movementOrRemaining: 0,
    employeeId: b.employeeId,
    employeeName: b.employeeName,
    actorEmployeeId: b.actorEmployeeId,
    actorIdentityId: b.actorIdentityId,
    userId: b.userId,
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
    const txActorInfo = resolveRowActorInfo(tx, empId || null, linkedInv?.representativeId, linkedInv?.representativeName || '');
    const invNo = tx.relatedDocNumber || tx.transactionNumber || '-';

    const row = {
      rowId: `FT-${tx.id}`,
      docType: tx.relatedDocType && tx.relatedDocId ? tx.relatedDocType : 'cash_tx',
      movementCategory: classified.bucket === 'cash_payment' ? 'cash_in' : 'cash_out',
      docId: tx.relatedDocId || tx.id,
      txId: tx.id,
      operationLabel: partyLabel,
      quantity: 1,
      unit: '-',
      priceOrTotal: round2(tx.amount || 0),
      valueOrPaid: round2(tx.amount || 0),
      movementOrRemaining: tx.category || tx.description || (classified.bucket === 'cash_payment' ? 'سداد نقدي' : 'سحب نقدي'),
      employeeId: txActorInfo.employeeId,
      employeeName: txActorInfo.employeeName,
      actorEmployeeId: txActorInfo.actorEmployeeId,
      actorIdentityId: txActorInfo.actorIdentityId,
      userId: txActorInfo.userId,
      userName: txActorInfo.userName,
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
      sections = [makeSection('sales_items', 'أصناف البيع', 'sage', false, salesItemRows)];
      break;
    case 'sales_invoices':
      sections = [makeSection('sales_invoices', 'فواتير بيع', 'sage', true, salesInvoiceRows)];
      break;
    case 'sales_items_by_unit':
      sections = buildAggregatedSection('sales_items_by_unit', 'أصناف بيع/ بالوحدة', salesItemRows, () => 'all', () => 'أصناف بيع/ بالوحدة', { byUnit: true });
      break;
    case 'sales_items_grouped':
      sections = buildAggregatedSection('sales_items_grouped', 'أصناف بيع/مَجمع', salesItemRows, () => 'all', () => 'أصناف بيع/مَجمع', { byUnit: false });
      break;
    case 'sales_items_grouped_by_customer':
      sections = buildAggregatedSection(
        'sales_cust',
        'أصناف بيع/مَجمع حسب العميل',
        salesItemRows,
        (r) => r.customerId || r.partyName || 'cash_customer',
        (r) => `أصناف بيع مَجمعة — العميل: ${r.partyName || 'عميل نقدي'}`,
        { byUnit: false, multiSection: true }
      );
      break;
    case 'sales_items_grouped_by_category':
      sections = buildAggregatedSection(
        'sales_cat',
        'أصناف بيع/مَجمع حسب المجموعة',
        salesItemRows,
        (r) => r.categoryName || 'عام',
        (r) => `أصناف بيع مَجمعة — المجموعة: ${r.categoryName || 'عام'}`,
        { byUnit: false, multiSection: true }
      );
      break;
    case 'sales_items_grouped_by_category_class1':
      sections = buildAggregatedSection(
        'sales_cat_c1',
        'أصناف بيع/مَجمع حسب المجموعة وتصنيف 1',
        salesItemRows,
        (r) => `${r.categoryName || 'عام'} || ${r.class1 || 'بدون تصنيف 1'}`,
        (r) => `المجموعة: ${r.categoryName || 'عام'} — تصنيف 1: ${r.class1 || 'بدون تصنيف 1'}`,
        { byUnit: false, multiSection: true }
      );
      break;

    case 'sales_return_items':
      sections = [makeSection('sales_return_items', 'أصناف مرتجع بيع', 'sage', false, salesReturnItemRows)];
      break;
    case 'sales_return_invoices':
      sections = [makeSection('sales_return_invoices', 'فواتير مرتجع بيع', 'sage', true, salesReturnInvoiceRows)];
      break;

    case 'purchase_items':
      sections = [makeSection('purchase_items', 'أصناف شراء', 'sage', false, purchaseItemRows)];
      break;
    case 'purchase_invoices':
      sections = [makeSection('purchase_invoices', 'فواتير شراء', 'sage', true, purchaseInvoiceRows)];
      break;

    case 'purchase_return_items':
      sections = [makeSection('purchase_return_items', 'أصناف مرتجع شراء', 'sage', false, purchaseReturnItemRows)];
      break;
    case 'purchase_return_invoices':
      sections = [makeSection('purchase_return_invoices', 'فواتير مرتجع شراء', 'sage', true, purchaseReturnInvoiceRows)];
      break;

    case 'damaged_items':
      sections = [makeSection('damaged_items', 'أصناف تالف', 'sage', false, damagedItemRows)];
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
        makeSection('sales_items', 'أصناف البيع', 'sage', false, salesItemRows),
        makeSection('sales_invoices', 'فواتير بيع', 'sage', true, salesInvoiceRows),
        makeSection('sales_return_items', 'أصناف مرتجع بيع', 'sage', false, salesReturnItemRows),
        makeSection('sales_return_invoices', 'فواتير مرتجع بيع', 'sage', true, salesReturnInvoiceRows),
        makeSection('purchase_items', 'أصناف شراء', 'sage', false, purchaseItemRows),
        makeSection('purchase_invoices', 'فواتير شراء', 'sage', true, purchaseInvoiceRows),
        makeSection('purchase_return_items', 'أصناف مرتجع شراء', 'sage', false, purchaseReturnItemRows),
        makeSection('purchase_return_invoices', 'فواتير مرتجع شراء', 'sage', true, purchaseReturnInvoiceRows),
        makeSection('damaged_items', 'أصناف تالف', 'sage', false, damagedItemRows),
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

  const isRepActor = actor?.role === 'representative';
  const repProfile = isRepActor
    ? ((data.representatives || []).find((r) => r.userId === actor?.id || r.id === actor?.representativeId) ||
        (await getRepresentativeByUserId(actor?.id)))
    : null;
  const canViewPayrollRows = actor?.role === 'admin' || actor?.permissions?.canManageEmployees === true;
  if (!canViewPayrollRows) {
    sections = sections
      .map((sec) => {
        if (sec.key !== 'cash_payment_employee') return sec;
        return makeSection(sec.key, sec.title, sec.theme, sec.isInvoiceLayout, [], { cashHighlightCol: sec.cashHighlightCol });
      })
      .filter((sec) => reportType === 'cash_payment_employee' || sec.rows.length > 0);
  }
  if (isRepActor) {
    sections = sections.map((sec) => {
      const redactedRows = (sec.rows || []).map((r) => ({
        ...r,
        profit: 0,
        costValue: 0,
        profitPercent: 0,
      }));
      return {
        ...sec,
        rows: redactedRows,
        totals: {
          ...sec.totals,
          profit: 0,
          costValue: 0,
          profitPercent: 0,
        },
      };
    });
  }

  // ============================================================================
  // Bottom Bar Exact Reconciliation:
  //   carriedFromYesterday (مرحل من الأمس)
  // + reportCashNet        (رصيد التقرير)
  // = drawerBalance        (رصيد الدرج)
  // + reportProfit         (ربح التقرير)
  // ============================================================================
  let targetCashboxes = isRepActor ? [] : (data.cashboxes || []);
  if (!isRepActor) {
    if (cashboxId) {
      targetCashboxes = targetCashboxes.filter((c) => c.id === cashboxId);
    } else if (branchCashboxId) {
      targetCashboxes = targetCashboxes.filter((c) => c.id === branchCashboxId);
    }
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

  if (isRepActor) {
    reportProfit = 0;
    reportCost = 0;
  }

  // ============================================================================
  // Optional Full Item Lifecycle + Per-Item P&L (when productId selected OR includeItemPnl=true)
  // ============================================================================
  const itemLifecycle = productId
    ? buildProductLifecycleHistory(productId, data, resolvers, { dateFrom, dateTo, warehouseId, isRep: isRepActor })
    : null;
  const rawItemPnlList = buildProductsPnlAnalysis(data, { dateFrom, dateTo, warehouseId, branchWarehouseId, productId, customerId, supplierId, userFilterSpec });
  const itemPnlList = isRepActor
    ? rawItemPnlList.map((it) => ({
        ...it,
        cogs: 0,
        grossProfit: 0,
        netProfit: 0,
        profitPercentOnCost: 0,
        profitMarginOnSales: 0,
        avgPurchasePrice: 0,
        minPurchasePrice: 0,
        maxPurchasePrice: 0,
        lastPurchasePrice: 0,
        currentStockValue: 0,
      }))
    : rawItemPnlList;

  // Optional Pagination across all flattened report rows (default returns full unpaginated sections for 100% compatibility)
  const totalUnpaginatedRows = sections.reduce((s, sec) => s + (sec.rows?.length || 0), 0);
  const rawPage = Number(filters.page);
  const rawPageSize = Number(filters.pageSize);
  const hasPagination =
    (Number.isFinite(rawPage) && rawPage >= 1) || (Number.isFinite(rawPageSize) && rawPageSize >= 1);
  const page = hasPagination && Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = hasPagination
    ? Math.min(500, Math.max(1, Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.floor(rawPageSize) : 50))
    : totalUnpaginatedRows;
  const totalPages = hasPagination ? Math.max(1, Math.ceil(totalUnpaginatedRows / pageSize)) : 1;
  const safePage = hasPagination ? Math.min(page, totalPages) : 1;

  let pagedSections = sections;
  if (hasPagination) {
    const startIdx = (safePage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    let cursor = 0;
    const sliced = [];
    for (const sec of sections) {
      const secRows = sec.rows || [];
      const secStart = cursor;
      const secEnd = cursor + secRows.length;
      cursor = secEnd;
      if (secEnd <= startIdx || secStart >= endIdx) continue;
      const localFrom = Math.max(0, startIdx - secStart);
      const localTo = Math.min(secRows.length, endIdx - secStart);
      const pageRows = secRows.slice(localFrom, localTo);
      if (pageRows.length > 0) {
        sliced.push({
          ...sec,
          totalSectionRows: secRows.length,
          rows: pageRows,
        });
      }
    }
    pagedSections = sliced;
  }

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
      partyKey: parsedParty.partyKey,
      movementType,
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
      branches: isRepActor ? [] : resolvers.branches,
      warehouses: isRepActor
        ? (data.warehouses || []).filter((w) => Boolean(repProfile?.warehouseId) && w.id === repProfile.warehouseId)
        : (data.warehouses || []),
      cashboxes: isRepActor ? [] : (data.cashboxes || []),
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
      suppliers: (isRepActor && !(actor?.permissions?.canCreatePurchase || actor?.permissions?.canManagePurchases))
        ? []
        : (data.suppliers || []).map((s) => ({ id: s.id, name: s.name, phone: s.phone })),
      employees: canViewPayrollRows && !isRepActor ? (data.employees || []).map((e) => ({ id: e.id, name: e.name, jobTitle: e.jobTitle, identityId: e.identityId, userId: e.userId })) : [],
      representatives: isRepActor
        ? (data.representatives || [])
            .filter((r) => r.userId === actor?.id || r.id === repProfile?.id)
            .map((r) => ({ id: r.id, name: r.name, warehouseId: r.warehouseId, identityId: r.identityId }))
        : (data.representatives || []).map((r) => ({ id: r.id, name: r.name, warehouseId: r.warehouseId, identityId: r.identityId })),
      users: isRepActor ? [] : (data.users || []).map((u) => ({ id: u.id, fullName: u.fullName, username: u.username, role: u.role, identityId: u.identityId, employeeId: u.employeeId })),
    },
    sections: pagedSections,
    pagination: {
      enabled: hasPagination,
      page: safePage,
      pageSize,
      totalRows: totalUnpaginatedRows,
      totalPages,
      hasNextPage: hasPagination && safePage < totalPages,
      hasPrevPage: hasPagination && safePage > 1,
    },
    summary: {
      drawerBalance: isRepActor ? 0 : drawerBalance,
      reportBalance: isRepActor ? 0 : reportBalance,
      carriedFromYesterday: isRepActor ? 0 : carriedFromYesterday,
      reportProfit,
      reportProfitPercent: calcProfitPctOnCost(reportProfit, reportCost),
      filteredSalesNet,
      filteredPurchasesNet,
      filteredCashIn,
      filteredCashOut,
      totalRows: totalUnpaginatedRows,
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
    unitCost: filterOpts.isRep ? 0 : Number(prod.purchasePrice || 0),
    totalValue: 0,
    userName: '-',
    notes: filterOpts.isRep
      ? `سعر البيع: ${prod.sellingPrice}`
      : `سعر الشراء الافتتاحي: ${prod.purchasePrice} | سعر البيع: ${prod.sellingPrice}`,
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
              unitCost: filterOpts.isRep ? 0 : round2(edIt?.purchasePriceAtTime || prod.purchasePrice || 0),
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
          unitCost: filterOpts.isRep ? 0 : lastSalePriceSeen,
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
        unitCost: filterOpts.isRep ? 0 : round2(it.purchasePriceAtTime || prod.purchasePrice || 0),
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
        unitCost: filterOpts.isRep ? 0 : round2(prod.purchasePrice || 0),
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
      unitPrice: filterOpts.isRep ? 0 : Number(prod.purchasePrice || 0),
      unitCost: filterOpts.isRep ? 0 : Number(prod.purchasePrice || 0),
      totalValue: filterOpts.isRep ? 0 : round2(bQty * Number(prod.purchasePrice || 0)),
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
      unitPrice: filterOpts.isRep ? 0 : round2(sm.unitCost || prod.purchasePrice || 0),
      unitCost: filterOpts.isRep ? 0 : round2(sm.unitCost || prod.purchasePrice || 0),
      totalValue: filterOpts.isRep ? 0 : round2(bQty * Number(sm.unitCost || prod.purchasePrice || 0)),
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
      unitCost: filterOpts.isRep ? 0 : Number(prod.purchasePrice || 0),
      totalValue: 0,
      userName: log.userName,
      notes: log.notes || log.action,
    });
  }

  // Chronological ASC sort from day 1 to latest movement
  events.sort((a, b) => String(a.sortTime).localeCompare(String(b.sortTime)));

  let running = 0;
  let lastPurchasePrice = filterOpts.isRep ? 0 : Number(prod.purchasePrice || 0);
  let lastPurchaseDate = null;
  let lastSalePrice = Number(prod.sellingPrice || 0);
  let lastSaleDate = null;

  const timeline = events.map((ev) => {
    running = round3(running + Number(ev.qtyIn || 0) - Number(ev.qtyOut || 0));
    if (ev.eventType === 'purchase' && !filterOpts.isRep) {
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
      costValue: filterOpts.isRep ? 0 : round2(Math.max(0, qty) * Number(prod.purchasePrice || 0)),
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
    currentStockValueAtCost: filterOpts.isRep ? 0 : round2(Math.max(0, currentStockTotal) * Number(prod.purchasePrice || 0)),
    warehouseBalances,
    timeline: filteredTimeline,
    fullCount: timeline.length,
  };
}

function buildProductsPnlAnalysis(data, filterOpts = {}) {
  const { dateFrom, dateTo, warehouseId, branchWarehouseId, productId, customerId, supplierId, userFilterSpec } = filterOpts;
  const matchesPnlUser = (doc) => {
    if (!userFilterSpec) return true;
    if (userFilterSpec.userId && doc.createdByUserId) return doc.createdByUserId === userFilterSpec.userId;
    return userFilterSpec.legacyNames.has(String(doc.createdBy || '').trim().toLowerCase());
  };
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
    if (!matchesPnlUser(inv)) continue;
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
    if (!matchesPnlUser(ret)) continue;
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
  const isRep = actor?.role === 'representative';
  const data = await loadFullReportDataset(actor, { includeAuditLogs: true });
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
    const isRepCanPurchaseDoc = Boolean(actor?.permissions?.canCreatePurchase || actor?.permissions?.canManagePurchases);
    if (!inv || (isRep && inv.type === 'purchase' && !isRepCanPurchaseDoc)) return null;
    const safeInv = isRep ? sanitizeInvoiceForRepresentative(inv) : inv;
    const relatedAudits = isRep ? [] : (data.auditLogs || []).filter((a) => a.recordId === safeInv.id);
    return {
      docType: safeInv.type === 'sales' ? 'sales_invoice' : 'purchase_invoice',
      title: safeInv.type === 'sales' ? `فاتورة مبيعات رقم ${safeInv.invoiceNumber}` : `فاتورة مشتريات رقم ${safeInv.invoiceNumber}`,
      document: {
        ...safeInv,
        branchName: resolveBranchName(safeInv.warehouseId, safeInv.cashboxId),
        cashboxName: isRep ? '-' : resolveCashboxName(safeInv.cashboxId),
        actualDateTime: formatActualDateTimeAr(safeInv.createdAt, safeInv.date),
      },
      auditTrail: relatedAudits,
    };
  }

  if (cleanType === 'sales_return' || cleanType === 'purchase_return') {
    const ret = (data.invoiceReturns || []).find((r) => r.id === cleanId || r.returnNumber === cleanId);
    const isRepCanPurchaseDoc = Boolean(actor?.permissions?.canCreatePurchase || actor?.permissions?.canManagePurchases);
    if (!ret || (isRep && ret.type === 'purchase_return' && !isRepCanPurchaseDoc)) return null;
    return {
      docType: ret.type,
      title: ret.type === 'sales_return' ? `إشعار مرتجع مبيعات ${ret.returnNumber}` : `إشعار مرتجع مشتريات ${ret.returnNumber}`,
      document: {
        ...ret,
        branchName: resolveBranchName(ret.warehouseId, ret.cashboxId),
        cashboxName: isRep ? '-' : resolveCashboxName(ret.cashboxId, 'رصيد الحساب'),
        actualDateTime: formatActualDateTimeAr(ret.createdAt, ret.date),
      },
      auditTrail: isRep ? [] : (data.auditLogs || []).filter((a) => a.recordId === ret.id),
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
          unitCost: isRep ? 0 : m.unitCost,
          totalLoss: isRep ? 0 : round2(Number(m.quantity || 0) * Number(m.unitCost || 0)),
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
        auditTrail: isRep ? [] : (data.auditLogs || []).filter((a) => a.recordId === op.id || a.recordId === op.representativeId),
      };
    }
  }

  // Cash transaction / Expense / Payroll / Custody / Stock Movement fallback
  const ft = (data.financialTransactions || []).find((f) => f.id === cleanId || f.relatedDocId === cleanId);
  if (ft) {
    const { balanceAfter, ...ftWithoutBalance } = ft;
    return {
      docType: 'cash_tx',
      title: `سند مالي رقم ${ft.transactionNumber}`,
      document: {
        ...(isRep ? ftWithoutBalance : ft),
        branchName: resolveBranchName(null, ft.cashboxId),
        cashboxName: resolveCashboxName(ft.cashboxId, ft.cashboxName),
        actualDateTime: formatActualDateTimeAr(ft.createdAt, ft.date),
      },
      auditTrail: isRep ? [] : (data.auditLogs || []).filter((a) => a.recordId === ft.id || a.recordId === ft.relatedDocId),
    };
  }

  const sm = (data.stockMovements || []).find((m) => m.id === cleanId || m.referenceId === cleanId);
  if (sm) {
    const linkedInv = sm.referenceId ? (data.invoices || []).find((i) => i.id === sm.referenceId) : null;
    if (linkedInv) {
      const isRepCanPurchaseDoc = Boolean(actor?.permissions?.canCreatePurchase || actor?.permissions?.canManagePurchases);
      if (isRep && linkedInv.type === 'purchase' && !isRepCanPurchaseDoc) return null;
      const safeLinkedInv = isRep ? sanitizeInvoiceForRepresentative(linkedInv) : linkedInv;
      return {
        docType: safeLinkedInv.type === 'sales' ? 'sales_invoice' : 'purchase_invoice',
        title: safeLinkedInv.type === 'sales' ? `فاتورة مبيعات رقم ${safeLinkedInv.invoiceNumber}` : `فاتورة مشتريات رقم ${safeLinkedInv.invoiceNumber}`,
        document: {
          ...safeLinkedInv,
          branchName: resolveBranchName(safeLinkedInv.warehouseId, safeLinkedInv.cashboxId),
          cashboxName: isRep ? '-' : resolveCashboxName(safeLinkedInv.cashboxId),
          actualDateTime: formatActualDateTimeAr(safeLinkedInv.createdAt, safeLinkedInv.date),
        },
        auditTrail: isRep ? [] : (data.auditLogs || []).filter((a) => a.recordId === safeLinkedInv.id),
      };
    }
    return {
      docType: 'stock_movement',
      title: `حركة مخزون ${sm.movementNumber || sm.id}`,
      document: {
        ...sm,
        unitCost: isRep ? 0 : sm.unitCost,
        branchName: resolveBranchName(sm.warehouseId, null),
        actualDateTime: formatActualDateTimeAr(sm.createdAt, sm.date),
      },
      auditTrail: [],
    };
  }

  return null;
}

export async function getRepDetailedReport(filters = {}, actor) {
  const isRepActor = actor?.role === 'representative';
  const ownProfile = isRepActor ? await getRepresentativeByUserId(actor.id) : null;
  const canPurchase = isRepActor
    ? Boolean(actor?.permissions?.canCreatePurchase || actor?.permissions?.canManagePurchases)
    : true;

  // For rep actor, ignore filters.representativeId (enforce self-only from session).
  // For admin / report viewer, pass filters without forcing representativeId into loadFullReportDataset
  // so customersSummary / suppliersSummary retain full company balances, then filter operations below.
  const requestedRepId = !isRepActor && filters.representativeId && filters.representativeId !== 'all'
    ? String(filters.representativeId)
    : null;
  const datasetFilters = { ...filters };
  delete datasetFilters.representativeId;
  const data = await loadFullReportDataset(actor, datasetFilters);

  const selectedRepProfile = isRepActor
    ? ownProfile
    : requestedRepId
    ? ((data.representatives || []).find((r) => r.id === requestedRepId || r.userId === requestedRepId) || null)
    : null;

  const belongsToSelectedRep = (inv) => {
    if (isRepActor) return isRepOwnerOfInvoice(inv, actor, ownProfile);
    if (!requestedRepId) return true;
    if (inv.representativeId === requestedRepId) return true;
    if (selectedRepProfile?.id && inv.representativeId === selectedRepProfile.id) return true;
    if (selectedRepProfile?.userId && (inv.createdByUserId === selectedRepProfile.userId || inv.sentByUserId === selectedRepProfile.userId)) return true;
    return false;
  };

  const selectedRepInvIdSet = requestedRepId
    ? new Set((data.invoices || []).filter(belongsToSelectedRep).map((i) => i.id))
    : null;

  const parsedRepParty = parseUnifiedPartyFilter(filters);
  const dateFrom = filters.dateFrom ? String(filters.dateFrom).split('T')[0] : null;
  const dateTo = filters.dateTo ? String(filters.dateTo).split('T')[0] : null;
  const customerId = parsedRepParty.customerId;
  const supplierId = !canPurchase && parsedRepParty.supplierId ? '__FORBIDDEN_SUPPLIER__' : parsedRepParty.supplierId;
  const productId = filters.productId && filters.productId !== 'all' ? String(filters.productId) : null;
  const invoiceNumber = filters.invoiceNumber ? String(filters.invoiceNumber).trim().toLowerCase() : '';
  const opType = filters.opType && filters.opType !== 'all' ? String(filters.opType) : 'all';
  const paymentStatusFilterRaw = filters.paymentStatus && filters.paymentStatus !== 'all' ? String(filters.paymentStatus) : 'all';
  const paymentStatusFilter = paymentStatusFilterRaw === 'unpaid' ? 'credit' : paymentStatusFilterRaw;
  const invoiceStatusFilter = filters.invoiceStatus && filters.invoiceStatus !== 'all' ? String(filters.invoiceStatus) : 'all';
  const search = filters.search ? String(filters.search).trim().toLowerCase() : '';

  const productMap = new Map((data.products || []).map((p) => [p.id, p]));
  const customerMap = new Map((data.customers || []).map((c) => [c.id, c]));
  const invoiceMapAll = new Map((data.invoices || []).map((i) => [i.id, i]));

  const inDateRange = (d) => {
    const clean = d ? String(d).split('T')[0] : '';
    if (dateFrom && clean && clean < dateFrom) return false;
    if (dateTo && clean && clean > dateTo) return false;
    return true;
  };
  const resolvePayStatus = (inv) => {
    const rem = Number(inv.remainingAmount || 0);
    const paid = Number(inv.paidAmount || 0);
    if (rem <= 0.01) return 'paid';
    if (paid > 0.01) return 'partial';
    return 'credit';
  };
  const matchesInvFilters = (inv) => {
    if (!belongsToSelectedRep(inv)) return false;
    if (opType === 'sales' && inv.type !== 'sales') return false;
    if (opType === 'purchase' && inv.type !== 'purchase') return false;
    if (opType === 'sales_return' || opType === 'purchase_return' || opType === 'collection' || opType === 'purchase_payment' || opType === 'purchase_return_request') {
      return false;
    }
    if (!inDateRange(inv.date)) return false;
    if (invoiceStatusFilter !== 'all' && inv.status !== invoiceStatusFilter) return false;
    const paySt = resolvePayStatus(inv);
    if (paymentStatusFilter !== 'all' && paySt !== paymentStatusFilter) return false;
    if (invoiceNumber && !String(inv.invoiceNumber || '').toLowerCase().includes(invoiceNumber)) return false;
    if (customerId && (inv.type !== 'sales' || inv.customerId !== customerId)) return false;
    if (supplierId && (inv.type !== 'purchase' || inv.supplierId !== supplierId)) return false;
    if (productId && !(inv.items || []).some((it) => it.productId === productId)) return false;
    if (search) {
      const hay = [
        inv.invoiceNumber,
        inv.customerName,
        inv.supplierName,
        inv.notes,
        ...(inv.items || []).map((it) => it.productName),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  };

  // Precompute returned quantities & values per (invoiceId, productId)
  const returnedByInvProd = new Map();
  for (const ret of data.invoiceReturns || []) {
    if (!ret.originalInvoiceId) continue;
    for (const rit of ret.items || []) {
      const k = `${ret.originalInvoiceId}::${rit.productId}`;
      const prev = returnedByInvProd.get(k) || { qty: 0, value: 0 };
      returnedByInvProd.set(k, {
        qty: round3(prev.qty + Number(rit.quantity || 0)),
        value: round2(prev.value + Number(rit.total || Number(rit.unitPrice || 0) * Number(rit.quantity || 0))),
      });
    }
  }

  const invoices = [];
  const itemRows = [];
  const purchasePayments = [];

  for (const inv of data.invoices || []) {
    if (inv.type !== 'sales' && inv.type !== 'purchase') continue;
    if (inv.type === 'purchase' && !canPurchase) continue;
    if (!matchesInvFilters(inv)) continue;
    const payStatus = resolvePayStatus(inv);
    const partyId = inv.type === 'sales' ? (inv.customerId || '') : (inv.supplierId || '');
    const partyName =
      inv.type === 'sales'
        ? (inv.customerName || 'عميل نقدي')
        : (inv.supplierName || 'مورد نقدي');

    const safeItems = (inv.items || [])
      .filter((it) => !productId || it.productId === productId)
      .map((it) => {
        const prod = productMap.get(it.productId);
        return {
          productId: it.productId,
          productName: it.productName || prod?.name || '',
          productCode: prod?.code || '',
          barcode: it.barcode || prod?.barcode || '',
          categoryName: prod?.category || 'عام',
          class1: normalizeClassification1(prod),
          unit: it.unit,
          unitFactor: Number(it.unitFactor || 1),
          quantity: Number(it.quantity || 0),
          unitPrice: round2(it.unitPrice || 0),
          discount: round2(it.discount || 0),
          total: round2(it.total ?? (Number(it.unitPrice || 0) * Number(it.quantity || 0) - Number(it.discount || 0))),
        };
      });

    invoices.push({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      date: inv.date,
      type: inv.type,
      status: inv.status,
      ...(inv.dispatchStatus ? { dispatchStatus: inv.dispatchStatus } : {}),
      partyId,
      partyName,
      warehouseId: inv.warehouseId || '',
      warehouseName: inv.warehouseName || '',
      ...(inv.representativeId ? { representativeId: inv.representativeId } : {}),
      ...(inv.representativeName ? { representativeName: inv.representativeName } : {}),
      createdBy: inv.createdBy || '',
      grandTotal: round2(inv.grandTotal || 0),
      paidAmount: round2(inv.paidAmount || 0),
      remainingAmount: Math.max(0, round2(inv.remainingAmount || 0)),
      paymentStatus: payStatus,
      itemsCount: (inv.items || []).length,
      items: safeItems,
      payments: (inv.payments || []).map((py) => {
        const pyLoc =
          py.collectionLocation ||
          (py.actingRole === 'representative' || (py.createdByUserId && (data.representatives || []).some((r) => r.userId === py.createdByUserId))
            ? 'rep'
            : 'branch');
        return {
          id: py.id,
          date: py.date || inv.date,
          amount: round2(py.amount || 0),
          paymentMethod: py.paymentMethod || 'cash',
          collectionLocation: pyLoc,
          collectedByRep: pyLoc === 'rep',
          collectedByBranch: pyLoc === 'branch',
          actingRole: py.actingRole || undefined,
          notes: py.notes || '',
          createdBy: py.createdBy || inv.createdBy || '',
        };
      }),
      notes: inv.notes || '',
    });

    safeItems.forEach((it, idx) => {
      const retStats = returnedByInvProd.get(`${inv.id}::${it.productId}`) || { qty: 0, value: 0 };
      const returnedQty = round3(Math.min(it.quantity, retStats.qty));
      const returnedValue = round2(Math.min(it.total, retStats.value));
      const netQty = round3(Math.max(0, it.quantity - returnedQty));
      const netValue = round2(Math.max(0, it.total - returnedValue));
      itemRows.push({
        rowId: `${inv.id}-${idx}`,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.date,
        opType: inv.type === 'purchase' ? 'purchase' : 'sales',
        status: inv.status,
        invoiceStatus: inv.status,
        paymentStatus: payStatus,
        partyId,
        partyName,
        representativeName: inv.representativeName || inv.createdBy || '',
        createdByName: inv.createdBy || inv.representativeName || '',
        productId: it.productId,
        productName: it.productName,
        productCode: it.productCode,
        barcode: it.barcode,
        categoryName: it.categoryName,
        class1: it.class1,
        unit: it.unit,
        quantity: it.quantity,
        unitFactor: it.unitFactor,
        unitPrice: it.unitPrice,
        grossTotal: round2(it.quantity * it.unitPrice),
        discount: it.discount,
        total: it.total,
        returnedQty,
        returnedValue,
        netQty,
        netValue,
        paidAmount: round2(inv.paidAmount || 0),
        remainingAmount: Math.max(0, round2(inv.remainingAmount || 0)),
      });
    });

    if (inv.type === 'purchase') {
      for (const py of inv.payments || []) {
        purchasePayments.push({
          id: py.id,
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          supplierId: inv.supplierId,
          supplierName: inv.supplierName || '',
          date: py.date || inv.date,
          amount: round2(py.amount || 0),
          paymentMethod: py.paymentMethod || 'cash',
          notes: py.notes || '',
          createdBy: py.createdBy || inv.createdBy || '',
          remainingAfter: Math.max(0, round2(inv.remainingAmount || 0)),
          isInvoiceLinked: true,
        });
      }
    }
  }

  const scopedReturns = [];
  for (const ret of data.invoiceReturns || []) {
    if (selectedRepInvIdSet && ret.originalInvoiceId && !selectedRepInvIdSet.has(ret.originalInvoiceId)) {
      continue;
    }
    if (selectedRepInvIdSet && !ret.originalInvoiceId) {
      if (!selectedRepProfile?.userId || ret.createdByUserId !== selectedRepProfile.userId) continue;
    }
    const isSalesRet = ret.type === 'sales_return';
    if (!isSalesRet && !canPurchase) continue;
    if (opType === 'sales' || opType === 'purchase' || opType === 'collection' || opType === 'purchase_payment' || opType === 'purchase_return_request') continue;
    if (opType === 'sales_return' && !isSalesRet) continue;
    if (opType === 'purchase_return' && isSalesRet) continue;
    if (!inDateRange(ret.date)) continue;
    if (customerId && (!isSalesRet || ret.partyId !== customerId)) continue;
    if (supplierId && (isSalesRet || ret.partyId !== supplierId)) continue;
    if (productId && !(ret.items || []).some((it) => it.productId === productId)) continue;
    if (
      invoiceNumber &&
      !String(ret.returnNumber || '').toLowerCase().includes(invoiceNumber) &&
      !String(ret.originalInvoiceNumber || '').toLowerCase().includes(invoiceNumber)
    ) {
      continue;
    }
    const origInv = ret.originalInvoiceId ? invoiceMapAll.get(ret.originalInvoiceId) : null;
    const safeRetItems = (ret.items || [])
      .filter((it) => !productId || it.productId === productId)
      .map((it) => {
        const prod = productMap.get(it.productId);
        return {
          productId: it.productId,
          productName: it.productName || prod?.name || '',
          productCode: prod?.code || '',
          barcode: prod?.barcode || '',
          categoryName: prod?.category || 'عام',
          class1: normalizeClassification1(prod),
          unit: it.unit,
          unitFactor: Number(it.unitFactor || 1),
          quantity: Number(it.quantity || 0),
          unitPrice: round2(it.unitPrice || 0),
          total: round2(it.total || 0),
        };
      });

    scopedReturns.push({
      id: ret.id,
      returnNumber: ret.returnNumber,
      type: ret.type,
      originalInvoiceId: ret.originalInvoiceId,
      originalInvoiceNumber: ret.originalInvoiceNumber,
      date: ret.date,
      partyId: ret.partyId,
      partyName: ret.partyName,
      warehouseId: ret.warehouseId,
      warehouseName: ret.warehouseName || '',
      grandTotal: round2(ret.grandTotal || 0),
      refundType: ret.refundType || 'balance',
      reason: ret.reason || '',
      notes: ret.notes || '',
      createdBy: ret.createdBy || '',
      items: safeRetItems,
    });

    safeRetItems.forEach((it, idx) => {
      itemRows.push({
        rowId: `${ret.id}-${idx}`,
        invoiceId: ret.id,
        invoiceNumber: ret.returnNumber,
        date: ret.date,
        opType: isSalesRet ? 'sales_return' : 'purchase_return',
        status: 'confirmed',
        invoiceStatus: 'confirmed',
        paymentStatus: ret.refundType === 'cash' ? 'paid' : 'credit',
        partyId: ret.partyId,
        partyName: ret.partyName,
        representativeName: origInv?.representativeName || ret.createdBy || '',
        createdByName: ret.createdBy || '',
        productId: it.productId,
        productName: it.productName,
        productCode: it.productCode,
        barcode: it.barcode,
        categoryName: it.categoryName,
        class1: it.class1,
        unit: it.unit,
        quantity: it.quantity,
        unitFactor: it.unitFactor,
        unitPrice: it.unitPrice,
        grossTotal: it.total,
        discount: 0,
        total: it.total,
        returnedQty: it.quantity,
        returnedValue: it.total,
        netQty: 0,
        netValue: round2(-it.total),
        paidAmount: ret.refundType === 'cash' ? round2(ret.grandTotal || 0) : 0,
        remainingAmount: 0,
      });
    });
  }

  const scopedPurchaseReturnRequests = canPurchase
    ? (data.purchaseReturnRequests || [])
        .filter((req) => {
          if (selectedRepInvIdSet) {
            const matchInv = req.originalInvoiceId && selectedRepInvIdSet.has(req.originalInvoiceId);
            const matchUser = selectedRepProfile?.userId && req.requestedByUserId === selectedRepProfile.userId;
            if (!matchInv && !matchUser) return false;
          }
          if (opType !== 'all' && opType !== 'purchase_return_request' && opType !== 'purchase_return' && opType !== 'purchase') {
            return false;
          }
          if (!inDateRange(req.date)) return false;
          if (supplierId && req.supplierId !== supplierId) return false;
          if (productId && !(req.items || []).some((it) => it.productId === productId)) return false;
          if (
            invoiceNumber &&
            !String(req.requestNumber || '').toLowerCase().includes(invoiceNumber) &&
            !String(req.originalInvoiceNumber || '').toLowerCase().includes(invoiceNumber)
          ) {
            return false;
          }
          if (search) {
            const hay = [req.requestNumber, req.originalInvoiceNumber, req.supplierName, req.reason, req.notes]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            if (!hay.includes(search)) return false;
          }
          return true;
        })
    : [];

  const scopedSalesReturnRequests = (data.salesReturnRequests || []).filter((req) => {
    if (selectedRepInvIdSet) {
      const matchInv = req.originalInvoiceId && selectedRepInvIdSet.has(req.originalInvoiceId);
      const matchUser = selectedRepProfile?.userId && req.requestedByUserId === selectedRepProfile.userId;
      if (!matchInv && !matchUser) return false;
    }
    if (opType !== 'all' && opType !== 'sales_return_request' && opType !== 'sales_return' && opType !== 'sales') {
      return false;
    }
    if (!inDateRange(req.date)) return false;
    if (customerId && req.customerId !== customerId) return false;
    if (productId && !(req.items || []).some((it) => it.productId === productId)) return false;
    if (
      invoiceNumber &&
      !String(req.requestNumber || '').toLowerCase().includes(invoiceNumber) &&
      !String(req.originalInvoiceNumber || '').toLowerCase().includes(invoiceNumber)
    ) {
      return false;
    }
    if (search) {
      const hay = [req.requestNumber, req.originalInvoiceNumber, req.customerName, req.reason, req.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const repUserIds = new Set((data.representatives || []).map((r) => r.userId).filter(Boolean));
  const collections = [];
  if (opType === 'all' || opType === 'collection' || opType === 'sales') {
    for (const tx of data.financialTransactions || []) {
      if (tx.type !== 'customer_payment') continue;
      if (selectedRepInvIdSet) {
        const linkedOwn = tx.relatedDocId && selectedRepInvIdSet.has(tx.relatedDocId);
        const createdOwn = selectedRepProfile?.userId && tx.createdByUserId === selectedRepProfile.userId;
        if (!linkedOwn && !createdOwn) continue;
      }
      if (!inDateRange(tx.date)) continue;
      const cid = tx.relatedEntityId || tx.partyId;
      if (customerId && cid !== customerId) continue;
      if (supplierId || productId) continue;
      if (
        invoiceNumber &&
        !String(tx.relatedDocNumber || tx.transactionNumber || '').toLowerCase().includes(invoiceNumber)
      ) {
        continue;
      }
      if (search) {
        const hay = [tx.transactionNumber, tx.relatedDocNumber, tx.relatedEntityName, tx.partyName, tx.description, tx.notes]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(search)) continue;
      }
      const linkedInv = tx.relatedDocId ? invoiceMapAll.get(tx.relatedDocId) : null;
      const isRepCollector =
        tx.actingRole === 'representative' ||
        (tx.createdByUserId && repUserIds.has(tx.createdByUserId)) ||
        Boolean(selectedRepProfile?.userId && tx.createdByUserId === selectedRepProfile.userId);
      const collectionLocation = isRepCollector ? 'rep' : 'branch';
      collections.push({
        id: tx.id,
        transactionNumber: tx.transactionNumber || undefined,
        date: tx.date,
        amount: round2(tx.amount || 0),
        partyId: cid || undefined,
        partyName: tx.relatedEntityName || tx.partyName || customerMap.get(cid)?.name || 'عميل',
        paymentMethod: tx.paymentMethod || 'cash',
        relatedDocId: tx.relatedDocId || undefined,
        relatedDocNumber: tx.relatedDocNumber || linkedInv?.invoiceNumber || undefined,
        remainingAfter: linkedInv ? Math.max(0, round2(linkedInv.remainingAmount || 0)) : undefined,
        isInvoiceLinked: Boolean(tx.relatedDocId && linkedInv),
        collectionLocation,
        collectedByRep: collectionLocation === 'rep',
        collectedByBranch: collectionLocation === 'branch',
        collectorName: tx.createdBy || '',
        collectorRole: tx.actingRole || (isRepCollector ? 'representative' : 'staff'),
        createdBy: tx.createdBy || '',
        notes: tx.notes || '',
      });
    }
  }

  const confirmedSales = invoices.filter((i) => i.type === 'sales' && i.status === 'confirmed');
  const confirmedPurchases = canPurchase ? invoices.filter((i) => i.type === 'purchase' && i.status === 'confirmed') : [];
  const salesReturns = scopedReturns.filter((r) => r.type === 'sales_return');
  const purchaseReturns = canPurchase ? scopedReturns.filter((r) => r.type === 'purchase_return') : [];

  const salesTotal = round2(confirmedSales.reduce((s, i) => s + Number(i.grandTotal || 0), 0));
  const salesReturnsTotal = round2(salesReturns.reduce((s, r) => s + Number(r.grandTotal || 0), 0));
  const purchasesTotal = round2(confirmedPurchases.reduce((s, i) => s + Number(i.grandTotal || 0), 0));
  const purchaseReturnsTotal = round2(purchaseReturns.reduce((s, r) => s + Number(r.grandTotal || 0), 0));

  const customersSummary = (data.customers || [])
    .filter((c) => !customerId || c.id === customerId)
    .filter((c) => !search || [c.name, c.shopName, c.phone, c.code].filter(Boolean).join(' ').toLowerCase().includes(search))
    .map((c) => {
      const cSales = confirmedSales.filter((i) => i.partyId === c.id);
      const cCol = collections.filter((x) => x.partyId === c.id);
      const cColRep = cCol.filter((x) => x.collectionLocation === 'rep');
      const cColBranch = cCol.filter((x) => x.collectionLocation === 'branch');
      return {
        id: c.id,
        name: c.name,
        ...(c.shopName ? { shopName: c.shopName } : {}),
        phone: c.phone || '',
        companyBalance: round2(c.currentBalance || 0),
        repSalesCount: cSales.length,
        repSalesTotal: round2(cSales.reduce((s, i) => s + i.grandTotal, 0)),
        repPaidTotal: round2(cSales.reduce((s, i) => s + i.paidAmount, 0)),
        repCollectionsTotal: round2(cCol.reduce((s, x) => s + x.amount, 0)),
        repDirectCollectionsTotal: round2(cColRep.reduce((s, x) => s + x.amount, 0)),
        branchCollectionsTotal: round2(cColBranch.reduce((s, x) => s + x.amount, 0)),
      };
    });

  const suppliersSummary = canPurchase
    ? (data.suppliers || [])
        .filter((s) => !supplierId || s.id === supplierId)
        .filter((s) => !search || [s.name, s.companyName, s.phone, s.code].filter(Boolean).join(' ').toLowerCase().includes(search))
        .map((s) => {
          const sPurchases = confirmedPurchases.filter((i) => i.partyId === s.id);
          return {
            id: s.id,
            name: s.name,
            ...(s.companyName ? { companyName: s.companyName } : {}),
            phone: s.phone || '',
            companyBalance: round2(s.currentBalance || 0),
            repPurchasesCount: sPurchases.length,
            repPurchasesTotal: round2(sPurchases.reduce((acc, i) => acc + i.grandTotal, 0)),
            repPaidTotal: round2(sPurchases.reduce((acc, i) => acc + i.paidAmount, 0)),
          };
        })
    : [];

  // Pagination (apply when page or pageSize specified; keep full totals in summary)
  const rawPage = Number(filters.page);
  const rawPageSize = Number(filters.pageSize);
  const hasPagination =
    (Number.isFinite(rawPage) && rawPage >= 1) || (Number.isFinite(rawPageSize) && rawPageSize >= 1);
  const pageSize = hasPagination
    ? Math.min(500, Math.max(1, Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.floor(rawPageSize) : 50))
    : Math.max(1, itemRows.length, invoices.length);
  const page = hasPagination && Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const maxListLen = Math.max(itemRows.length, invoices.length, scopedReturns.length, collections.length, scopedPurchaseReturnRequests.length);
  const totalPages = hasPagination ? Math.max(1, Math.ceil(maxListLen / pageSize)) : 1;
  const safePage = hasPagination ? Math.min(page, totalPages) : 1;
  const sliceIfPaged = (arr) => (hasPagination ? arr.slice((safePage - 1) * pageSize, safePage * pageSize) : arr);

  const summaryOut = {
    salesCount: confirmedSales.length,
    salesTotal,
    salesPaid: round2(confirmedSales.reduce((s, i) => s + Number(i.paidAmount || 0), 0)),
    salesRemaining: round2(confirmedSales.reduce((s, i) => s + Math.max(0, Number(i.remainingAmount || 0)), 0)),
    salesReturnsCount: salesReturns.length,
    salesReturnsTotal,
    netSalesTotal: round2(Math.max(0, salesTotal - salesReturnsTotal)),
    purchasesCount: canPurchase ? confirmedPurchases.length : 0,
    purchasesTotal: canPurchase ? purchasesTotal : 0,
    purchasesPaid: canPurchase ? round2(confirmedPurchases.reduce((s, i) => s + Number(i.paidAmount || 0), 0)) : 0,
    purchasesRemaining: canPurchase
      ? round2(confirmedPurchases.reduce((s, i) => s + Math.max(0, Number(i.remainingAmount || 0)), 0))
      : 0,
    purchaseReturnsCount: canPurchase ? purchaseReturns.length : 0,
    purchaseReturnsTotal: canPurchase ? purchaseReturnsTotal : 0,
    purchaseReturnRequestsCount: canPurchase ? scopedPurchaseReturnRequests.length : 0,
    pendingPurchaseReturnRequestsCount: canPurchase ? scopedPurchaseReturnRequests.filter((r) => r.status === 'pending').length : 0,
    salesReturnRequestsCount: scopedSalesReturnRequests.length,
    pendingSalesReturnRequestsCount: scopedSalesReturnRequests.filter((r) => r.status === 'pending').length,
    collectionsCount: collections.length,
    collectionsTotal: round2(collections.reduce((s, c) => s + Number(c.amount || 0), 0)),
    collectedByRepCount: collections.filter((c) => c.collectionLocation === 'rep').length,
    collectedByRepTotal: round2(collections.filter((c) => c.collectionLocation === 'rep').reduce((s, c) => s + Number(c.amount || 0), 0)),
    collectedByBranchCount: collections.filter((c) => c.collectionLocation === 'branch').length,
    collectedByBranchTotal: round2(collections.filter((c) => c.collectionLocation === 'branch').reduce((s, c) => s + Number(c.amount || 0), 0)),
    purchasePaymentsTotal: canPurchase
      ? round2(
          purchasePayments.length > 0
            ? purchasePayments.reduce((s, p) => s + Number(p.amount || 0), 0)
            : confirmedPurchases.reduce((s, i) => s + Number(i.paidAmount || 0), 0)
        )
      : 0,
  };
  if (!isRepActor) {
    summaryOut.totalCustomerReceivables = round2((data.customers || []).reduce((s, c) => s + Number(c.currentBalance || 0), 0));
    summaryOut.totalSupplierPayables = canPurchase
      ? round2((data.suppliers || []).reduce((s, sup) => s + Number(sup.currentBalance || 0), 0))
      : 0;
  }

  return {
    scope: {
      isRepScoped: isRepActor || Boolean(requestedRepId),
      representativeId: isRepActor
        ? (ownProfile?.id || actor?.id)
        : (selectedRepProfile?.id || requestedRepId || 'all'),
      representativeName: isRepActor
        ? (ownProfile?.name || actor?.fullName || '')
        : (selectedRepProfile?.name || 'جميع المناديب'),
      canViewSuppliers: canPurchase,
      availableRepresentatives: isRepActor
        ? []
        : (data.representatives || []).map((r) => ({ id: r.id, name: r.name, code: r.code || '', warehouseId: r.warehouseId })),
      accountBalanceNote:
        'الأرصدة الظاهرة للعملاء والموردين تمثل الرصيد المالي العام على مستوى الشركة بالكامل، بينما إحصائيات وفواتير وتحصيلات التقرير تمثل عمليات هذا المندوب فقط.',
    },
    summary: summaryOut,
    pagination: {
      enabled: hasPagination,
      page: safePage,
      pageSize,
      totalRows: maxListLen,
      totalInvoices: invoices.length,
      totalItemRows: itemRows.length,
      totalReturns: scopedReturns.length,
      totalCollections: collections.length,
      totalPurchaseReturnRequests: scopedPurchaseReturnRequests.length,
      totalSalesReturnRequests: scopedSalesReturnRequests.length,
      totalPurchasePayments: purchasePayments.length,
      totalPages,
      hasNextPage: hasPagination && safePage < totalPages,
      hasPrevPage: hasPagination && safePage > 1,
    },
    customersSummary,
    suppliersSummary,
    invoices: sliceIfPaged(invoices),
    itemRows: sliceIfPaged(itemRows),
    returns: sliceIfPaged(scopedReturns),
    purchaseReturnRequests: sliceIfPaged(scopedPurchaseReturnRequests),
    salesReturnRequests: sliceIfPaged(scopedSalesReturnRequests),
    collections: sliceIfPaged(collections),
    purchasePayments: sliceIfPaged(purchasePayments),
  };
}

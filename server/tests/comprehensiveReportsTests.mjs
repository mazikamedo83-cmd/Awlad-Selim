import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_rpt_test_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_reports_suite_2026_secure';

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { REPORT_TYPES_LIST } = await import('../db/stores/reportsStore.js');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(err);
    throw err;
  }
}

async function req(baseUrl, method, urlPath, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function createPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();
  return {
    async query(sql, params) {
      return memPool.query(sql, params);
    },
    async connect() {
      const client = await memPool.connect();
      return {
        query(sql, params) {
          return client.query(sql, params);
        },
        release() {
          client.release();
        },
      };
    },
  };
}

const EXPECTED_REPORT_LABELS = [
  'الكل',
  'أصناف البيع',
  'فواتير بيع',
  'أصناف بيع/ بالوحدة',
  'أصناف بيع/مَجمع',
  'أصناف بيع/مَجمع حسب العميل',
  'أصناف بيع/مَجمع حسب المجموعة',
  'أصناف بيع/مَجمع حسب المجموعة وتصنيف 1',
  'أصناف مرتجع بيع',
  'فواتير مرتجع بيع',
  'أصناف شراء',
  'فواتير شراء',
  'أصناف مرتجع شراء',
  'فواتير مرتجع شراء',
  'أصناف تالف',
  'فواتير تالف',
  'سداد نقدى',
  'سداد نقدى/عميل',
  'سداد نقدى/مورد',
  'سداد نقدى/موظف',
  'سحب نقدى',
  'سحب نقدى/عميل',
  'سحب نقدى/مورد',
];

async function runComprehensiveScenario(modeLabel) {
  console.log(`\n=== Comprehensive Reports Verification Suite (${modeLabel}) ===`);
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Bootstrap admin & login
    const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
      body: { fullName: 'مدير التقارير', username: 'rpt_admin', password: 'Password123!' },
    });
    assert.equal(bootAdmin.status, 201);
    const loginRes = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { username: 'rpt_admin', password: 'Password123!' },
    });
    assert.equal(loginRes.status, 200);
    const adminToken = loginRes.json.accessToken;
    assert.ok(adminToken);

    // 2. Verify 401 when unauthenticated
    await test(`[${modeLabel}] Unauthenticated requests to /api/reports/* return 401`, async () => {
      const r1 = await req(baseUrl, 'GET', '/api/reports/comprehensive');
      assert.equal(r1.status, 401);
      const r2 = await req(baseUrl, 'GET', '/api/reports/source-document?docId=123');
      assert.equal(r2.status, 401);
    });

    // 3. Verify exact 23 report options and labels
    await test(`[${modeLabel}] Exact 23 report options and order match specification`, async () => {
      assert.deepEqual(
        REPORT_TYPES_LIST.map((o) => o.label),
        EXPECTED_REPORT_LABELS
      );
      const r = await req(baseUrl, 'GET', '/api/reports/comprehensive?reportType=all', { token: adminToken });
      assert.equal(r.status, 200);
      assert.equal(r.json.ok, true);
      assert.deepEqual(
        r.json.report.reportTypes.map((o) => o.label),
        EXPECTED_REPORT_LABELS
      );
    });

    // Seed entities via existing APIs
    const whRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
      token: adminToken,
      body: { name: 'مخزن السلام', code: 'WH-SALAM', location: 'القاهرة', isDefault: true },
    });
    assert.equal(whRes.status, 201);
    const whId = whRes.json.warehouse.id;

    const cbRes = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
      token: adminToken,
      body: { name: 'خزينة السلام', type: 'cashbox', openingBalance: 10000, isDefault: true },
    });
    assert.equal(cbRes.status, 201);
    const cbId = cbRes.json.cashbox.id;

    // Create 2 products (one with units & size/color classification 1)
    const p1Res = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        name: 'أرز بسمتي ذهبي',
        code: 'P-101',
        barcode: '622101',
        category: 'بقوليات وأرز',
        baseUnit: 'كيلو',
        size: 'شيكارة 5 كجم',
        purchasePrice: 40,
        sellingPrice: 55,
        stockPerWarehouse: { [whId]: 20 },
        units: [
          { name: 'شيكارة', conversionFactor: 5, purchasePrice: 200, sellingPrice: 275, barcode: '622101-B' },
        ],
      },
    });
    assert.equal(p1Res.status, 201);
    const p1Id = p1Res.json.product.id;

    const p2Res = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        name: 'زيت ذرة نقي',
        code: 'P-102',
        barcode: '622102',
        category: 'زيوت وسمن',
        baseUnit: 'زجاجة',
        size: '1 لتر',
        purchasePrice: 70,
        sellingPrice: 90,
        stockPerWarehouse: { [whId]: 10 },
      },
    });
    assert.equal(p2Res.status, 201);
    const p2Id = p2Res.json.product.id;

    const custRes = await req(baseUrl, 'POST', '/api/customers', {
      token: adminToken,
      body: { name: 'سوبر ماركت النور', phone: '01001112223', openingBalance: 0 },
    });
    assert.equal(custRes.status, 201);
    const custId = custRes.json.customer.id;

    const suppRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
      token: adminToken,
      body: { name: 'شركة الدلتا للاستيراد', phone: '01119998887', openingBalance: 0 },
    });
    assert.equal(suppRes.status, 201);
    const suppId = suppRes.json.supplier.id;

    const empRes = await req(baseUrl, 'POST', '/api/admin/employees', {
      token: adminToken,
      body: { name: 'أحمد محسن', jobTitle: 'محاسب', department: 'المبيعات', basicSalary: 5000, hireDate: '2026-01-01' },
    });
    assert.equal(empRes.status, 201);
    const empId = empRes.json.employee.id;

    // Yesterday Purchase (2026-11-19): 10kg rice @ 42 -> cash paid 420
    const purRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
      token: adminToken,
      body: {
        date: '2026-11-19',
        supplierId: suppId,
        supplierName: 'شركة الدلتا للاستيراد',
        warehouseId: whId,
        warehouseName: 'مخزن السلام',
        cashboxId: cbId,
        paymentType: 'cash',
        paidAmount: 420,
        items: [
          { productId: p1Id, productName: 'أرز بسمتي ذهبي', unit: 'كيلو', unitFactor: 1, quantity: 10, unitPrice: 42, purchasePriceAtTime: 42, discount: 0, total: 420 },
        ],
      },
    });
    assert.equal(purRes.status, 201);

    // Today Sales Invoice 1 (2026-11-20): 2 shkara (= 10kg) rice @ 280 -> 560, paid 500, credit 60 (cost = 10 * 42 = 420 -> profit = 140)
    const sale1Res = await req(baseUrl, 'POST', '/api/invoices/sales', {
      token: adminToken,
      body: {
        date: '2026-11-20',
        customerId: custId,
        customerName: 'سوبر ماركت النور',
        warehouseId: whId,
        warehouseName: 'مخزن السلام',
        cashboxId: cbId,
        paymentType: 'partial',
        paidAmount: 500,
        items: [
          { productId: p1Id, productName: 'أرز بسمتي ذهبي', unit: 'شيكارة', unitFactor: 5, quantity: 2, unitPrice: 280, purchasePriceAtTime: 42, discount: 0, total: 560 },
        ],
      },
    });
    assert.equal(sale1Res.status, 201);
    const sale1Id = sale1Res.json.invoice.id;
    const sale1No = sale1Res.json.invoice.invoiceNumber;

    // Today Sales Invoice 2 (2026-11-20): deliberate LOSS sale on oil (cost 70 * 2 = 140, sold for 100 after discount 40 -> loss = 40!)
    const sale2Res = await req(baseUrl, 'POST', '/api/invoices/sales', {
      token: adminToken,
      body: {
        date: '2026-11-20',
        customerId: custId,
        customerName: 'سوبر ماركت النور',
        warehouseId: whId,
        warehouseName: 'مخزن السلام',
        cashboxId: cbId,
        paymentType: 'cash',
        paidAmount: 100,
        items: [
          { productId: p2Id, productName: 'زيت ذرة نقي', unit: 'زجاجة', unitFactor: 1, quantity: 2, unitPrice: 70, purchasePriceAtTime: 70, discount: 40, total: 100 },
        ],
      },
    });
    assert.equal(sale2Res.status, 201);

    // Today Sales Return (cash refund 50 on 1 bottle of oil)
    const retRes = await req(baseUrl, 'POST', '/api/invoices/returns', {
      token: adminToken,
      body: {
        type: 'sales_return',
        originalInvoiceId: sale2Res.json.invoice.id,
        date: '2026-11-20',
        warehouseId: whId,
        warehouseName: 'مخزن السلام',
        refundType: 'cash',
        cashboxId: cbId,
        reason: 'تعبئة تالفة',
        items: [{ productId: p2Id, productName: 'زيت ذرة نقي', unit: 'زجاجة', unitFactor: 1, quantity: 1, unitPrice: 50, total: 50 }],
      },
    });
    assert.equal(retRes.status, 201);

    // Damaged stock (2 kg rice)
    const dmgRes = await req(baseUrl, 'POST', '/api/inventory/damaged', {
      token: adminToken,
      body: { productId: p1Id, warehouseId: whId, quantity: 2, reason: 'رطوبة مخزن' },
    });
    assert.equal(dmgRes.status, 200);

    // Rep cash handover (توريد تحصيلات مندوب) + Cash withdrawal + Customer payment
    const cashRepRes = await req(baseUrl, 'POST', '/api/admin/representatives', {
      token: adminToken,
      body: { name: 'مندوب التحصيل اليومي', phone: '01088776655' },
    });
    assert.equal(cashRepRes.status, 201);
    const cashRepId = cashRepRes.json.representative.id;

    const trCreateRes = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
      token: adminToken,
      body: { direction: 'rep_to_owner', senderId: cashRepId, amount: 300, cashboxId: cbId, notes: 'توريد تحصيلات' },
    });
    assert.equal(trCreateRes.status, 201);
    const trConfirmRes = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${trCreateRes.json.transfer.id}/confirm`, {
      token: adminToken,
      body: { note: 'استلام توريد المندوب' },
    });
    assert.equal(trConfirmRes.status, 200);

    const custPayRes = await req(baseUrl, 'POST', `/api/customers/${custId}/payment`, {
      token: adminToken,
      body: { amount: 60, cashboxId: cbId, date: '2026-11-20', notes: 'سداد آجل' },
    });
    assert.equal(custPayRes.status, 200);

    const cashWdRes = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
      token: adminToken,
      body: { type: 'cash_withdrawal', cashboxId: cbId, amount: 120, date: '2026-11-20', recipientOrPayer: 'نثريات', notes: 'سحب مصروف نثري' },
    });
    assert.equal(cashWdRes.status, 201);

    // 4. Verify EVERY single one of the 23 report types returns 200 & expected sections
    await test(`[${modeLabel}] All 23 report modes execute cleanly and reconcile cashbox balance identity`, async () => {
      for (const opt of REPORT_TYPES_LIST) {
        const res = await req(
          baseUrl,
          'GET',
          `/api/reports/comprehensive?reportType=${opt.key}&dateFrom=2026-11-20&dateTo=2026-11-20`,
          { token: adminToken }
        );
        assert.equal(res.status, 200, `Failed for reportType=${opt.key}`);
        assert.equal(res.json.ok, true);
        const rpt = res.json.report;
        // Mathematical cashbox reconciliation: carried + reportBalance === drawerBalance
        const sumCheck = Math.round((rpt.summary.carriedFromYesterday + rpt.summary.reportBalance) * 100) / 100;
        assert.equal(sumCheck, rpt.summary.drawerBalance, `Reconciliation mismatch on ${opt.key}`);
      }
    });

    // 5. Verify specific sections, grouping, invoice sub-totals, and filters
    await test(`[${modeLabel}] Grouped sales reports, damaged vouchers, and simultaneous filters work accurately`, async () => {
      const grpCat1 = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=sales_items_grouped_by_category_class1&dateFrom=2026-11-19&dateTo=2026-11-21',
        { token: adminToken }
      );
      assert.equal(grpCat1.status, 200);
      assert.ok(grpCat1.json.report.sections.length >= 2, 'Expected separate sections for categories + class 1');

      const dmgInv = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=damaged_invoices&productId=${p1Id}`,
        { token: adminToken }
      );
      assert.equal(dmgInv.status, 200);
      assert.equal(dmgInv.json.report.sections[0].rows.length, 1);

      const invFilter = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=sales_invoices&invoiceNumber=${encodeURIComponent(sale1No)}&customerId=${custId}`,
        { token: adminToken }
      );
      assert.equal(invFilter.status, 200);
      assert.equal(invFilter.json.report.sections[0].rows.length, 1);
      assert.equal(invFilter.json.report.sections[0].rows[0].priceOrTotal, 560);
      assert.equal(invFilter.json.report.sections[0].rows[0].valueOrPaid, 560);
      assert.equal(invFilter.json.report.sections[0].rows[0].movementOrRemaining, 0);

      const cashEmp = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=cash_payment_employee',
        { token: adminToken }
      );
      assert.equal(cashEmp.status, 200);
      assert.equal(cashEmp.json.report.sections[0].rows.length, 1);
      assert.equal(cashEmp.json.report.sections[0].rows[0].valueOrPaid, 300);

      const cashWdCust = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=cash_withdrawal_customer&dateFrom=2026-11-20&dateTo=2026-11-20',
        { token: adminToken }
      );
      assert.equal(cashWdCust.status, 200);
      assert.equal(cashWdCust.json.report.sections[0].rows.length, 1);
      assert.equal(cashWdCust.json.report.sections[0].rows[0].valueOrPaid, 50);
    });

    // 6. Verify Item Lifecycle History & Running Balance + Per-Item P&L & Loss Detection
    await test(`[${modeLabel}] Item Lifecycle running balance & Per-Item P&L formulas + loss detection are exact`, async () => {
      // Rice (p1Id): Opening 20 + Purchase 10 - Sale 10 - Damaged 2 = 18kg!
      const p1Rpt = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&productId=${p1Id}`,
        { token: adminToken }
      );
      assert.equal(p1Rpt.status, 200);
      const lc1 = p1Rpt.json.report.itemLifecycle;
      assert.ok(lc1);
      assert.equal(lc1.currentStockTotal, 18);
      assert.equal(lc1.timeline[lc1.timeline.length - 1].runningBalance, 18);
      assert.equal(lc1.lastPurchasePrice, 42);

      // Oil (p2Id): Loss-making sale detected! (sold 2 @ 70 - 40 discount = 100 vs cost 140 => loss 40)
      const p2Rpt = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&productId=${p2Id}`,
        { token: adminToken }
      );
      assert.equal(p2Rpt.status, 200);
      const pnl2 = p2Rpt.json.report.itemPnl.selectedItem;
      assert.ok(pnl2);
      assert.equal(pnl2.netSalesValue, 50); // 100 sale - 50 return
      assert.equal(pnl2.cogs, 70); // 140 sale cost - 70 return cost
      assert.equal(pnl2.netProfit, -20); // 50 - 70
      assert.ok(pnl2.lossTransactions.length >= 1, 'Loss-making sale must be flagged');
      assert.equal(pnl2.lossTransactions[0].lossAmount, 40);
    });

    // 7. Verify Source Document Inspection
    await test(`[${modeLabel}] Source document inspection loads invoice details accurately`, async () => {
      const docRes = await req(
        baseUrl,
        'GET',
        `/api/reports/source-document?docType=sales_invoice&docId=${encodeURIComponent(sale1Id)}`,
        { token: adminToken }
      );
      assert.equal(docRes.status, 200);
      assert.equal(docRes.json.document.invoiceNumber, sale1No);
      assert.equal(docRes.json.document.items.length, 1);
    });

    // 8. Verify warehouseId filter on cash_payment excludes cash transactions linked to other warehouses
    await test(`[${modeLabel}] Warehouse filter on cash reports excludes cash linked to invoices in other warehouses`, async () => {
      const wh2Res = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
        token: adminToken,
        body: { name: 'مخزن الإسكندرية', code: 'WH-ALEX' },
      });
      assert.equal(wh2Res.status, 201);
      const wh2Id = wh2Res.json.warehouse.id;

      // Filter cash_payment_customer by wh2Id -> sale1Id (paid 500) belongs to whId, so it MUST NOT show up under wh2Id!
      const cashWh2 = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=cash_payment&dateFrom=2026-11-20&dateTo=2026-11-20&warehouseId=${encodeURIComponent(wh2Id)}`,
        { token: adminToken }
      );
      assert.equal(cashWh2.status, 200);
      const rows = cashWh2.json.report.sections[0].rows || [];
      assert.equal(rows.some((r) => r.docId === sale1Id || String(r.docNumber || '') === sale1No), false);
    });

    // 9. Verify Source Document Inspection supports rep_custody operations
    await test(`[${modeLabel}] Source document inspection loads rep_custody operations accurately`, async () => {
      const repRes = await req(baseUrl, 'POST', '/api/admin/representatives', {
        token: adminToken,
        body: { name: 'مندوب العهدة للاختبار', phone: '01099887766' },
      });
      assert.equal(repRes.status, 201);
      const repId = repRes.json.representative.id;

      const vanRes = await req(baseUrl, 'POST', '/api/inventory/rep-van-warehouse', {
        token: adminToken,
        body: { repName: 'مندوب العهدة للاختبار' },
      });
      assert.equal(vanRes.status, 200);
      const vanWhId = vanRes.json.warehouse.id;

      const trRes = await req(baseUrl, 'POST', '/api/inventory/transfer', {
        token: adminToken,
        body: { productId: p1Id, fromWarehouseId: whId, toWarehouseId: vanWhId, quantity: 5, notes: 'تحويل عهدة' },
      });
      assert.equal(trRes.status, 200);

      const adjRes = await req(baseUrl, 'POST', '/api/inventory/rep-custody/adjust', {
        token: adminToken,
        body: {
          representativeId: repId,
          productId: p1Id,
          operationType: 'custody_adjustment',
          quantity: 1,
          notes: 'تسوية عهدة لفحص المستند المصدري',
        },
      });
      assert.equal(adjRes.status, 201);
      const opId = adjRes.json.operation.id;

      const docRes = await req(
        baseUrl,
        'GET',
        `/api/reports/source-document?docType=rep_custody&docId=${encodeURIComponent(opId)}`,
        { token: adminToken }
      );
      assert.equal(docRes.status, 200);
      assert.equal(docRes.json.document.id, opId);
      assert.equal(docRes.json.document.productId, p1Id);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  // Run in JSON Ledger mode
  setInjectedPool(null);
  resetPgModeCache();
  await runComprehensiveScenario('JSON Ledger');

  // Run in PostgreSQL (pg-mem) mode
  const memPool = createPgMemPool();
  setInjectedPool(memPool);
  resetPgModeCache();
  await initializeSchema();
  await runComprehensiveScenario('PostgreSQL pg-mem');

  console.log(`\nALL REPORT TESTS PASSED (${passed} assertions groups)!`);
} finally {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}

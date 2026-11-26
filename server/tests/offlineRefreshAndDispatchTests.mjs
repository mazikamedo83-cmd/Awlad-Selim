import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_offline_dispatch_tests_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'offline_refresh_dispatch_jwt_secret_key_awlad_selim_2026_secure';

for (const pgEnvKey of [
  'DATABASE_URL',
  'PG_CONNECTION_STRING',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
]) {
  delete process.env[pgEnvKey];
}

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { resetAllRateLimitsForTests } = await import('../middleware/auth.js');
const { DISPATCH_BATCH_STATUSES } = await import('../db/stores/syncDispatchStore.js');

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

async function req(baseUrl, method, urlPath, { token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function createPgMemPool({ failOnBatchInsertRef } = {}) {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();

  const wrapQuery = (target) => async (sql, params) => {
    if (
      failOnBatchInsertRef?.shouldFail &&
      String(sql).includes('INSERT INTO sync_dispatch_batches')
    ) {
      throw Object.assign(new Error('Simulated PG error mid-transaction during dispatch insert'), {
        code: '23514',
      });
    }
    return target.query(sql, params);
  };

  return {
    query: wrapQuery(memPool),
    async connect() {
      const client = await memPool.connect();
      return {
        query: wrapQuery(client),
        release() {
          client.release();
        },
      };
    },
  };
}

function snapshotAccountingTotals(bootData) {
  return {
    productStocks: (bootData.products || []).map((p) => ({
      id: p.id,
      stockPerWarehouse: { ...(p.stockPerWarehouse || {}) },
    })),
    customerBalances: (bootData.customers || []).map((c) => ({
      id: c.id,
      currentBalance: Number(c.currentBalance || 0),
    })),
    supplierBalances: (bootData.suppliers || []).map((s) => ({
      id: s.id,
      currentBalance: Number(s.currentBalance || 0),
    })),
    cashboxBalances: (bootData.cashboxes || []).map((cb) => ({
      id: cb.id,
      currentBalance: Number(cb.currentBalance || 0),
    })),
    representativeBalances: (bootData.representatives || []).map((r) => ({
      id: r.id,
      currentBalance: Number(r.currentBalance || 0),
    })),
    invoicesCount: (bootData.invoices || []).length,
    financialTxCount: (bootData.financialTransactions || []).length,
  };
}

console.log('\n=== AWLAD SELIM Offline-First, Refresh Dispatch & Table Unification Test Suite (17 Scenarios) ===');

// -----------------------------------------------------------------------------
// Part A: Client Offline-First TS Verification (Scenarios 1, 2, 3, 4, 5, 7-client)
// -----------------------------------------------------------------------------
console.log('\n--- Part A: Client Offline-First & LocalDB Scenarios (Scenarios 1–5 & 7-Client) ---');
await test('Scenarios 1–5 & 7-Client: Offline Auth, LocalDB persistence, Immediate Overlay, Electron/Capacitor restore & Dispatch retry', async () => {
  const tsxBin = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  const helperPath = path.join(__dirname, 'offlineClientFlowChecks.mts');
  const output = execFileSync(tsxBin, [helperPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const line of output.trim().split('\n')) {
    if (line.trim()) console.log(`    ${line}`);
  }
  assert.match(output, /Client offline sub-suite finished: 7 passed/);
});

// -----------------------------------------------------------------------------
// Part B: Static & Contract Specifications (Scenarios 15, 16, 17)
// -----------------------------------------------------------------------------
console.log('\n--- Part B: Official Dispatch Statuses, 12 REFRESH Headers & Table Unification (Scenarios 15–17) ---');
await test('Scenario 15: Exact 9 Arabic dispatch batch statuses match across server & client types', async () => {
  const expected9 = [
    'محفوظة محليًا',
    'جاهزة للإرسال',
    'جاري الإرسال',
    'تم الإرسال',
    'في انتظار الاستلام',
    'جاري الاستلام',
    'تم الاستلام',
    'فشل الإرسال',
    'تعذر الاستلام',
  ];
  assert.deepEqual(DISPATCH_BATCH_STATUSES, expected9);

  const typesSrc = fs.readFileSync(path.join(projectRoot, 'src', 'types', 'index.ts'), 'utf8');
  for (const statusLabel of expected9) {
    assert.ok(
      typesSrc.includes(`'${statusLabel}'`),
      `src/types/index.ts must contain dispatch status '${statusLabel}'`
    );
  }
});

await test('Scenario 16: Exact 12 official REFRESH table headers appear in RefreshSyncScreen.tsx in order', async () => {
  const expected12Headers = [
    'رقم العملية',
    'المرسل',
    'المستلم',
    'تاريخ الإرسال',
    'عدد فواتير البيع',
    'عدد التحصيلات',
    'عدد المرتجعات',
    'إجمالي التحصيلات',
    'حالة الإرسال',
    'حالة الاستلام',
    'تاريخ الاستلام',
    'الإجراءات',
  ];

  const refreshSrc = fs.readFileSync(
    path.join(projectRoot, 'src', 'components', 'modules', 'mobile', 'RefreshSyncScreen.tsx'),
    'utf8'
  );
  const idxStart = refreshSrc.indexOf('const dispatchColumns');
  assert.ok(idxStart > 0, 'dispatchColumns must exist in RefreshSyncScreen.tsx');
  const slice = refreshSrc.slice(idxStart, idxStart + 6500);

  let lastPos = -1;
  for (const hdr of expected12Headers) {
    const marker = `header: '${hdr}'`;
    const pos = slice.indexOf(marker);
    assert.ok(pos > lastPos, `Header '${hdr}' missing or out of order in RefreshSyncScreen dispatchColumns`);
    lastPos = pos;
  }
});

await test('Scenario 17: Key modules use UnifiedDataTable consistently', async () => {
  const unifiedTargets = [
    'src/components/modules/mobile/RefreshSyncScreen.tsx',
    'src/components/modules/mobile/RepPortal.tsx',
    'src/components/modules/customers/CustomersView.tsx',
    'src/components/modules/settings/SettingsView.tsx',
    'src/components/modules/settings/StorefrontManagerView.tsx',
    'src/components/modules/reports/ItemMovementReport.tsx',
    'src/components/modules/representatives/RepTransferView.tsx',
    'src/components/modules/inventory/StockTransfersView.tsx',
  ];
  for (const rel of unifiedTargets) {
    const content = fs.readFileSync(path.join(projectRoot, rel), 'utf8');
    assert.ok(content.includes('UnifiedDataTable'), `${rel} must use UnifiedDataTable`);
  }
});

await test('Scenario 18: Static UI integrity — no RTL/LTR text, always-visible filters, manual refresh dispatch, Hamburger menu & Rep settings', async () => {
  const custMore = fs.readFileSync(path.join(projectRoot, 'src/components/modules/mobile/CustomerMoreScreen.tsx'), 'utf8');
  assert.ok(!custMore.includes('(RTL)') && !custMore.includes('(LTR)'), 'CustomerMoreScreen must not expose (RTL) or (LTR) labels');

  const mobilePortal = fs.readFileSync(path.join(projectRoot, 'src/components/modules/mobile/MobilePortal.tsx'), 'utf8');
  assert.ok(mobilePortal.includes('setLanguage('), 'MobilePortal settings must expose language toggle');
  assert.ok(mobilePortal.includes('notifPrefs'), 'MobilePortal settings must expose notification toggles');
  assert.ok(!mobilePortal.includes('<LayoutGrid'), 'MobilePortal drawer button must use 3-line Menu icon instead of LayoutGrid');

  const headerSrc = fs.readFileSync(path.join(projectRoot, 'src/components/layout/Header.tsx'), 'utf8');
  assert.ok(headerSrc.includes('<Menu className="w-4 h-4" />') && headerSrc.includes('onToggleSidebar'), 'Header must render Hamburger Menu sidebar toggle');

  const unifiedSrc = fs.readFileSync(path.join(projectRoot, 'src/components/common/UnifiedDataTable.tsx'), 'utf8');
  assert.ok(!unifiedSrc.includes('showMobileFilters'), 'UnifiedDataTable must keep filters always visible without mobile collapse toggle');
  assert.ok(!unifiedSrc.includes('hidden sm:flex'), 'UnifiedDataTable toolbarFilters must never use hidden sm:flex');
  assert.ok(unifiedSrc.includes('onDoubleClick') && unifiedSrc.includes('isInteractiveTarget'), 'UnifiedDataTable must gate desktop activation via onDoubleClick and ignore interactive children');

  const repPortalSrc = fs.readFileSync(path.join(projectRoot, 'src/components/modules/mobile/RepPortal.tsx'), 'utf8');
  assert.ok(!repPortalSrc.includes('showReportFilters'), 'RepPortal report filters must stay always visible');

  const reportsSrc = fs.readFileSync(path.join(projectRoot, 'src/components/modules/reports/ReportsView.tsx'), 'utf8');
  assert.ok(!reportsSrc.includes('showMoreFilters'), 'ReportsView detailed filters must stay always visible');

  const refreshSrc = fs.readFileSync(path.join(projectRoot, 'src/components/modules/mobile/RefreshSyncScreen.tsx'), 'utf8');
  assert.ok(refreshSrc.includes('pendingSendConfirm'), 'RefreshSyncScreen must enforce Pre-Send Summary Confirmation modal');
  assert.ok(refreshSrc.includes('hasDiscrepancyInput'), 'RefreshSyncScreen must support discrepancy objection notes on manual receive');
  const inspectStart = refreshSrc.indexOf('const handleOpenInspectBatch');
  const inspectSlice = refreshSrc.slice(inspectStart, inspectStart + 450);
  assert.ok(!inspectSlice.includes('markDispatchReceiving'), 'Inspecting a dispatch batch must NEVER auto-mutate receipt status');
});

// -----------------------------------------------------------------------------
// Part C: Dual Backend HTTP Verification (JSON Ledger & PostgreSQL pg-mem)
// Covers Scenarios 6, 7-server, 8, 9, 10, 11, 12, 13, 14
// -----------------------------------------------------------------------------
async function runDualBackendSuite(label, isPg) {
  console.log(`\n--- Part C (${label}): Dispatch Batch API, Idempotency, Non-Double-Posting, Chained IDs, RBAC & Notifications ---`);
  resetAllRateLimitsForTests();
  let failToggle = { shouldFail: false };
  let pool = null;

  if (isPg) {
    pool = createPgMemPool({ failOnBatchInsertRef: failToggle });
    setInjectedPool(pool);
    resetPgModeCache();
    await initializeSchema();
  } else {
    setInjectedPool(null);
    resetPgModeCache();
  }

  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  let adminToken = '';
  let adminUserId = '';
  let repToken = '';
  let repUserId = '';
  let repId = '';
  let repVanWhId = '';
  let customerToken = '';
  let whMainId = '';
  let cbMainId = '';
  let prodId = '';
  let custExistingId = '';
  let firstBatchId = '';
  let secondBatchId = '';

  try {
    await test(`${label} | Seed Admin, Representative, Customer, Warehouse, Cashbox & Van Stock`, async () => {
      const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'طارق سليم المدير',
          username: 'admin_dispatch',
          password: 'AdminDispatch!2026',
          phone: '01000000011',
        },
      });
      assert.equal(bootAdmin.status, 201);
      adminUserId = bootAdmin.json.user.id;
      adminToken = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'admin_dispatch', password: 'AdminDispatch!2026' },
        })
      ).json.accessToken;

      const regRep = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'كريم المندوب الميداني',
          username: 'rep_dispatch',
          password: 'RepDispatch!2026',
          phone: '01000000022',
          area: 'المعادي',
        },
      });
      assert.equal(regRep.status, 201);
      repToken = regRep.json.accessToken;
      repUserId = regRep.json.user.id;
      repId = regRep.json.representativeProfile.id;
      repVanWhId = regRep.json.representativeProfile.warehouseId;

      const regCust = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'سعيد عميل التطبيق',
          username: 'cust_dispatch',
          password: 'CustDispatch!2026',
          phone: '01000000033',
          shopName: 'سوبر ماركت الفجر',
        },
      });
      assert.equal(regCust.status, 201);
      customerToken = regCust.json.accessToken;

      whMainId = (
        await req(baseUrl, 'POST', '/api/inventory/warehouses', {
          token: adminToken,
          body: { name: 'المخزن الرئيسي', code: 'MAIN', isDefault: true },
        })
      ).json.warehouse.id;

      cbMainId = (
        await req(baseUrl, 'POST', '/api/admin/cashboxes', {
          token: adminToken,
          body: { name: 'الخزينة الرئيسية', type: 'cash', openingBalance: 5000 },
        })
      ).json.cashbox.id;

      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: 'زيت ذرة 1 لتر',
          code: 'PRD-OIL-1L',
          category: 'زيوت',
          baseUnit: 'زجاجة',
          purchasePrice: 60,
          sellingPrice: 80,
          stockPerWarehouse: { [whMainId]: 200, [repVanWhId]: 50 },
        },
      });
      assert.equal(prodRes.status, 201);
      prodId = prodRes.json.product.id;

      const custRes = await req(baseUrl, 'POST', '/api/customers', {
        token: repToken,
        body: {
          name: 'عميل قائم 1',
          shopName: 'محل الأمانة',
          phone: '01234560001',
          openingBalance: 100,
        },
      });
      assert.equal(custRes.status, 201);
      custExistingId = custRes.json.customer.id;
    });

    await test(`${label} | Scenarios 6, 7 & 8: Dispatch batch DSP-YYYY-XXXX, counts & double-click idempotency`, async () => {
      const recipientsRes = await req(baseUrl, 'GET', '/api/sync/dispatches/recipients', { token: repToken });
      assert.equal(recipientsRes.status, 200);
      assert.ok(recipientsRes.json.recipients.some((r) => r.id === adminUserId));

      const clientBatchUuid = `CBU-${Date.now()}-TEST1`;
      const ops = [
        {
          operationId: `OP-INV-${Date.now()}-1`,
          operationType: 'create_sales_invoice',
          entityType: 'invoice',
          summaryAr: 'فاتورة بيع 1 (400 ج.م)',
          payload: {
            customerId: custExistingId,
            warehouseId: repVanWhId,
            representativeId: repId,
            date: '2026-06-01',
            paymentType: 'partial',
            paidAmount: 250,
            discountTotal: 0,
            items: [
              { productId: prodId, unit: 'زجاجة', unitFactor: 1, quantity: 5, unitPrice: 80, discount: 0 },
            ],
          },
        },
        {
          operationId: `OP-PAY-${Date.now()}-2`,
          operationType: 'record_customer_payment',
          entityType: 'financial',
          summaryAr: 'تحصيل 100 ج.م',
          payload: {
            customerId: custExistingId,
            amount: 100,
            paymentMethod: 'cash',
            date: '2026-06-01',
            notes: 'دفعة مع الدفعة',
          },
        },
      ];

      // Pass 1: HTTP 201
      const send1 = await req(baseUrl, 'POST', '/api/sync/dispatches', {
        token: repToken,
        body: {
          clientBatchUuid,
          idempotencyKey: clientBatchUuid,
          recipientUserId: adminUserId,
          notes: 'دفعة إغلاق الفترة',
          operations: ops,
        },
      });
      assert.equal(send1.status, 201);
      assert.equal(send1.json.deduplicated, false);
      const b1 = send1.json.batch;
      firstBatchId = b1.id;
      assert.match(b1.batchNumber, /^DSP-\d{4}-\d{4}$/);
      assert.equal(b1.sendStatus, 'تم الإرسال');
      assert.equal(b1.receiptStatus, 'في انتظار الاستلام');
      assert.equal(b1.salesCount, 1);
      assert.equal(b1.collectionsCount, 1);
      assert.equal(Number(b1.totalSalesAmount), 400);
      assert.equal(Number(b1.totalCashAmount), 350); // 250 paid on invoice + 100 collection
      assert.ok(Array.isArray(b1.docSummary) && b1.docSummary.length === 2);

      // Pass 2 (double-click / retry with same clientBatchUuid): HTTP 200 deduplicated: true
      const send2 = await req(baseUrl, 'POST', '/api/sync/dispatches', {
        token: repToken,
        body: {
          clientBatchUuid,
          idempotencyKey: clientBatchUuid,
          recipientUserId: adminUserId,
          notes: 'دفعة إغلاق الفترة',
          operations: ops,
        },
      });
      assert.equal(send2.status, 200);
      assert.equal(send2.json.deduplicated, true);
      assert.equal(send2.json.batch.id, firstBatchId);
      assert.equal(send2.json.batch.batchNumber, b1.batchNumber);

      // Verify customer balance: 100 opening + 400 invoice - 250 paid - 100 collection = 150
      const custBoot = (await req(baseUrl, 'GET', `/api/customers/${custExistingId}`, { token: adminToken })).json.customer;
      assert.equal(Number(custBoot.currentBalance), 150);
    });

    await test(`${label} | Scenario 13 (pre-confirm): Notifications targetTab = 'refresh-sync' for incoming dispatch`, async () => {
      const adminNotifs = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: adminToken });
      assert.equal(adminNotifs.status, 200);
      const incoming = adminNotifs.json.notifications.find(
        (n) => n.type === 'sync_dispatch_incoming' && n.relatedId === firstBatchId
      );
      assert.ok(incoming, 'Admin must receive sync_dispatch_incoming notification');
      assert.equal(incoming.targetTab, 'refresh-sync');
    });

    await test(`${label} | Scenario 12: RBAC (403 checks) + Self-Dispatch Block + Cost Redaction`, async () => {
      // Customer blocked from recipients & dispatches & confirm
      assert.equal((await req(baseUrl, 'GET', '/api/sync/dispatches/recipients', { token: customerToken })).status, 403);
      assert.equal((await req(baseUrl, 'GET', '/api/sync/dispatches', { token: customerToken })).status, 403);
      assert.equal(
        (await req(baseUrl, 'POST', `/api/sync/dispatches/${firstBatchId}/confirm-receipt`, { token: customerToken })).status,
        403
      );

      // Rep CANNOT confirm or fail-receipt or mark-receiving on own or any batch
      assert.equal(
        (await req(baseUrl, 'POST', `/api/sync/dispatches/${firstBatchId}/mark-receiving`, { token: repToken })).status,
        403
      );
      assert.equal(
        (await req(baseUrl, 'POST', `/api/sync/dispatches/${firstBatchId}/confirm-receipt`, { token: repToken })).status,
        403
      );
      assert.equal(
        (await req(baseUrl, 'POST', `/api/sync/dispatches/${firstBatchId}/fail-receipt`, { token: repToken, body: { reason: 'x' } })).status,
        403
      );

      // Self-dispatch blocked (admin sending to adminUserId)
      const selfRes = await req(baseUrl, 'POST', '/api/sync/dispatches', {
        token: adminToken,
        body: {
          clientBatchUuid: `CBU-SELF-${Date.now()}`,
          recipientUserId: adminUserId,
          operations: [
            {
              operationId: `OP-SELF-${Date.now()}`,
              operationType: 'create_customer',
              entityType: 'customer',
              payload: { name: 'Self', phone: '01088887777' },
            },
          ],
        },
      });
      assert.equal(selfRes.status, 403);
      assert.equal(selfRes.json.code, 'SELF_DISPATCH_FORBIDDEN');

      // Rep views batch details -> costs like purchasePrice must be redacted from operationsSnapshot payload
      const repDetail = await req(baseUrl, 'GET', `/api/sync/dispatches/${firstBatchId}`, { token: repToken });
      assert.equal(repDetail.status, 200);
      const snapStr = JSON.stringify(repDetail.json.batch.operationsSnapshot || []);
      assert.ok(!snapStr.includes('"purchasePrice"'), 'purchasePrice must be redacted for representative');
    });

    await test(`${label} | Scenario 9: Mark-receiving & Confirm Receipt -> STRICT ZERO double-posting across all accounting entities`, async () => {
      const beforeBoot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const snapBefore = snapshotAccountingTotals(beforeBoot);

      const markRes = await req(baseUrl, 'POST', `/api/sync/dispatches/${firstBatchId}/mark-receiving`, {
        token: adminToken,
      });
      assert.equal(markRes.status, 200);
      assert.equal(markRes.json.batch.receiptStatus, 'جاري الاستلام');

      const confirm1 = await req(baseUrl, 'POST', `/api/sync/dispatches/${firstBatchId}/confirm-receipt`, {
        token: adminToken,
        body: { receiptNotes: 'تمت المطابقة بالكامل' },
      });
      assert.equal(confirm1.status, 200);
      assert.equal(confirm1.json.deduplicated, false);
      assert.equal(confirm1.json.batch.receiptStatus, 'تم الاستلام');
      assert.equal(confirm1.json.batch.receivedByUserId, adminUserId);
      assert.ok(confirm1.json.batch.receivedByName);
      assert.ok(confirm1.json.batch.receivedAt);

      // Re-confirming again must be idempotent without mutations
      const confirm2 = await req(baseUrl, 'POST', `/api/sync/dispatches/${firstBatchId}/confirm-receipt`, {
        token: adminToken,
      });
      assert.equal(confirm2.status, 200);
      assert.equal(confirm2.json.deduplicated, true);

      const afterBoot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const snapAfter = snapshotAccountingTotals(afterBoot);

      assert.deepEqual(snapAfter, snapBefore, 'Confirm receipt MUST have ZERO double-posting impact on balances, stock, invoices, or cashboxes');

      const detailRes = await req(baseUrl, 'GET', `/api/sync/dispatches/${firstBatchId}`, { token: adminToken });
      assert.equal(detailRes.status, 200);
      assert.ok(
        Array.isArray(detailRes.json.auditTrail) &&
          detailRes.json.auditTrail.length >= 2 &&
          detailRes.json.auditTrail.some((a) => String(a.action).includes('استلام وتأكيد')),
        `${isPg ? 'PG' : 'JSON Ledger'} auditTrail must log dispatch receipt confirmation`
      );

      // Scenario 13 (post-confirm): Rep receives notification with targetTab: 'refresh'
      const repNotifs = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: repToken });
      const confNotif = repNotifs.json.notifications.find(
        (n) => n.type === 'sync_dispatch_confirmed' && n.relatedId === firstBatchId
      );
      assert.ok(confNotif, 'Rep must receive sync_dispatch_confirmed notification');
      assert.equal(confNotif.targetTab, 'refresh');
    });

    await test(`${label} | Scenario 11: Chained Local ID Resolution inside single batch (CUS-LOC -> Invoice -> Payment -> Order)`, async () => {
      const ts = Date.now();
      const chainedOps = [
        {
          operationId: `OP-CHAIN-CUS-${ts}`,
          operationType: 'create_customer',
          entityType: 'customer',
          localId: 'CUS-LOC-CHAIN-1',
          summaryAr: 'عميل جديد بسلسلة محلية',
          payload: {
            localId: 'CUS-LOC-CHAIN-1',
            name: 'محل النجاح المتسلسل',
            shopName: 'سوبر ماركت النجاح',
            phone: '01199998877',
            openingBalance: 0,
          },
        },
        {
          operationId: `OP-CHAIN-INV-${ts}`,
          operationType: 'create_sales_invoice',
          entityType: 'invoice',
          localId: 'INV-LOC-CHAIN-1',
          summaryAr: 'فاتورة للعميل المحلي الجديد',
          payload: {
            localId: 'INV-LOC-CHAIN-1',
            customerId: 'CUS-LOC-CHAIN-1',
            warehouseId: repVanWhId,
            representativeId: repId,
            date: '2026-06-02',
            paymentType: 'partial',
            paidAmount: 100,
            discountTotal: 0,
            items: [
              { productId: prodId, unit: 'زجاجة', unitFactor: 1, quantity: 4, unitPrice: 80, discount: 0 },
            ],
          },
        },
        {
          operationId: `OP-CHAIN-PAY-${ts}`,
          operationType: 'record_customer_payment',
          entityType: 'financial',
          summaryAr: 'تحصيل مرتبط بالفاتورة المحلية',
          payload: {
            customerId: 'CUS-LOC-CHAIN-1',
            invoiceId: 'INV-LOC-CHAIN-1',
            amount: 50,
            paymentMethod: 'cash',
            date: '2026-06-02',
          },
        },
        {
          operationId: `OP-CHAIN-ORD-${ts}`,
          operationType: 'create_order',
          entityType: 'order',
          summaryAr: 'طلب بضاعة للعميل المحلي',
          payload: {
            customerId: 'CUS-LOC-CHAIN-1',
            requesterType: 'representative',
            items: [{ productId: prodId, quantity: 2, unitPrice: 80 }],
          },
        },
      ];

      const chainRes = await req(baseUrl, 'POST', '/api/sync/dispatches', {
        token: repToken,
        body: {
          clientBatchUuid: `CBU-CHAIN-${ts}`,
          recipientUserId: adminUserId,
          operations: chainedOps,
        },
      });
      assert.equal(chainRes.status, 201);
      secondBatchId = chainRes.json.batch.id;
      assert.equal(chainRes.json.batch.customersCount, 1);
      assert.equal(chainRes.json.batch.salesCount, 1);
      assert.equal(chainRes.json.batch.collectionsCount, 1);
      assert.equal(chainRes.json.batch.ordersCount, 1);

      const createdCustId = chainRes.json.opResults[0].result.customer?.id || chainRes.json.opResults[0].result.id;
      const createdInv = chainRes.json.opResults[1].result.invoice || chainRes.json.opResults[1].result;
      const createdOrd = chainRes.json.opResults[3].result.order || chainRes.json.opResults[3].result;
      assert.ok(createdCustId && !createdCustId.startsWith('CUS-LOC-'));
      assert.equal(createdInv.customerId, createdCustId);
      assert.equal(createdOrd.customerId, createdCustId);

      // Invoice total 320 - paid 100 - extra collection 50 = 170
      const custRes = await req(baseUrl, 'GET', `/api/customers/${createdCustId}`, { token: adminToken });
      assert.equal(Number(custRes.json.customer.currentBalance), 170);
    });

    await test(`${label} | Scenario 10 & 13-fail: Admin fail-receipt -> 'تعذر الاستلام' + rep notification + 409 guard after confirm`, async () => {
      const failRes = await req(baseUrl, 'POST', `/api/sync/dispatches/${secondBatchId}/fail-receipt`, {
        token: adminToken,
        body: { reason: 'فرق في إيصال النقدية المرفق' },
      });
      assert.equal(failRes.status, 200);
      assert.equal(failRes.json.batch.receiptStatus, 'تعذر الاستلام');
      assert.equal(failRes.json.batch.errorMessage, 'فرق في إيصال النقدية المرفق');

      const repNotifs = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: repToken });
      const failNotif = repNotifs.json.notifications.find(
        (n) => n.type === 'sync_dispatch_failed' && n.relatedId === secondBatchId
      );
      assert.ok(failNotif, 'Rep must receive sync_dispatch_failed notification');
      assert.equal(failNotif.targetTab, 'refresh');

      // Now confirm after resolving, then verify fail-receipt is blocked with 409
      const confAfter = await req(baseUrl, 'POST', `/api/sync/dispatches/${secondBatchId}/confirm-receipt`, {
        token: adminToken,
      });
      assert.equal(confAfter.status, 200);
      assert.equal(confAfter.json.batch.receiptStatus, 'تم الاستلام');

      const blockedFail = await req(baseUrl, 'POST', `/api/sync/dispatches/${secondBatchId}/fail-receipt`, {
        token: adminToken,
        body: { reason: 'محاولة متأخرة' },
      });
      assert.equal(blockedFail.status, 409);
      assert.equal(blockedFail.json.code, 'ALREADY_CONFIRMED');
    });

    await test(`${label} | Scenario 10B: Targeted Rep recipient confirms dispatch with deviceId & discrepancyDetails while unrelated rep & self-confirm stay blocked (403)`, async () => {
      const regRep2 = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب ثاني غير مستهدف',
          username: `rep_other_${Date.now()}`,
          password: 'RepOther!2026',
          phone: `01099${Math.floor(100000 + Math.random() * 899999)}`,
          area: 'مدينة نصر',
        },
      });
      assert.equal(regRep2.status, 201);
      const otherRepToken = regRep2.json.accessToken;

      const adminToRep = await req(baseUrl, 'POST', '/api/sync/dispatches', {
        token: adminToken,
        headers: { 'X-Device-Id': 'DEV-ADMIN-PC-01' },
        body: {
          clientBatchUuid: `CBU-ADMIN-REP-${Date.now()}`,
          recipientUserId: repUserId,
          notes: 'ترحيلة موجهة للمندوب الأول',
          operations: [
            {
              operationId: `OP-ADMIN-TO-REP-${Date.now()}`,
              operationType: 'create_customer',
              entityType: 'customer',
              payload: { name: 'عميل مضاف من الإدارة للمندوب', phone: `01122${Math.floor(100000 + Math.random() * 899999)}` },
            },
          ],
        },
      });
      assert.equal(adminToRep.status, 201);
      const targetedBatchId = adminToRep.json.batch.id;

      // Unrelated rep MUST get 403
      const otherAttempt = await req(baseUrl, 'POST', `/api/sync/dispatches/${targetedBatchId}/confirm-receipt`, {
        token: otherRepToken,
      });
      assert.equal(otherAttempt.status, 403);

      // Sender admin MUST get 403 on self-receipt
      const selfAttempt = await req(baseUrl, 'POST', `/api/sync/dispatches/${targetedBatchId}/confirm-receipt`, {
        token: adminToken,
      });
      assert.equal(selfAttempt.status, 403);

      // Targeted rep confirms with discrepancy objection & explicit X-Device-Id
      const targetConfirm = await req(baseUrl, 'POST', `/api/sync/dispatches/${targetedBatchId}/confirm-receipt`, {
        token: repToken,
        headers: { 'X-Device-Id': 'DEV-REP-PHONE-99' },
        body: {
          hasDiscrepancy: true,
          discrepancyNote: 'نقص كرتونة واحدة عند التسليم',
          receiptNotes: 'تم الاستلام مع إثبات الملاحظة',
        },
      });
      assert.equal(targetConfirm.status, 200);
      assert.equal(targetConfirm.json.batch.receiptStatus, 'تم الاستلام');
      assert.equal(targetConfirm.json.batch.receivedByUserId, repUserId);
      assert.equal(targetConfirm.json.batch.receivedDeviceId, 'DEV-REP-PHONE-99');
      assert.equal(targetConfirm.json.batch.discrepancyDetails?.hasDiscrepancy, true);
      assert.equal(targetConfirm.json.batch.discrepancyDetails?.note, 'نقص كرتونة واحدة عند التسليم');
    });

    await test(`${label} | Scenario 12B: Store-level RBAC blocks representative from stock adjustment, damaged stock & stock transfer approvals (403)`, async () => {
      const { adjustStock, recordDamagedStock } = await import('../db/stores/inventoryAdminStore.js');
      const { approveStockTransferRequest, rejectStockTransferRequest, executeStockTransferRequest } = await import('../db/stores/stockTransfersStore.js');

      const fakeRepActor = { id: repUserId, fullName: 'كريم المندوب', role: 'representative' };
      await assert.rejects(
        () => adjustStock({ productId: prodId, warehouseId: repVanWhId, newQuantity: 999, reason: 'محاولة تلاعب' }, fakeRepActor),
        (err) => err?.status === 403
      );
      await assert.rejects(
        () => recordDamagedStock({ productId: prodId, warehouseId: repVanWhId, quantity: 1, type: 'damaged', reason: 'محاولة' }, fakeRepActor),
        (err) => err?.status === 403
      );
      await assert.rejects(
        () => approveStockTransferRequest('TR-ANY', {}, fakeRepActor),
        (err) => err?.status === 403
      );
      await assert.rejects(
        () => rejectStockTransferRequest('TR-ANY', { reason: 'رفض' }, fakeRepActor),
        (err) => err?.status === 403
      );
      await assert.rejects(
        () => executeStockTransferRequest('TR-ANY', fakeRepActor),
        (err) => err?.status === 403
      );
    });

    if (isPg) {
      await test(`${label} | Scenario 14: PostgreSQL transaction rollback leaves zero orphaned dispatch batches on error`, async () => {
        const countBefore = Number(
          (await pool.query(`SELECT COUNT(*)::int AS cnt FROM sync_dispatch_batches`)).rows[0].cnt
        );

        failToggle.shouldFail = true;
        try {
          const errRes = await req(baseUrl, 'POST', '/api/sync/dispatches', {
            token: repToken,
            body: {
              clientBatchUuid: `CBU-ROLLBACK-${Date.now()}`,
              recipientUserId: adminUserId,
              operations: [
                {
                  operationId: `OP-RB-${Date.now()}`,
                  operationType: 'create_customer',
                  entityType: 'customer',
                  payload: { name: 'عميل قبل الانهيار', phone: '01100009999' },
                },
              ],
            },
          });
          assert.ok(errRes.status >= 400, 'Simulated PG transaction error must reject request');
        } finally {
          failToggle.shouldFail = false;
        }

        const countAfter = Number(
          (await pool.query(`SELECT COUNT(*)::int AS cnt FROM sync_dispatch_batches`)).rows[0].cnt
        );
        assert.equal(countAfter, countBefore, 'Failed PG transaction must rollback cleanly without partial batch rows');
      });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

await runDualBackendSuite('JSON Ledger', false);

// Isolate a fresh JSON temp dir before PG suite
const pgTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_offline_dispatch_pg_'));
process.env.AWLAD_DATA_DIR = pgTempDir;
await runDualBackendSuite('PostgreSQL (pg-mem)', true);

setInjectedPool(null);
resetPgModeCache();
fs.rmSync(tempDataDir, { recursive: true, force: true });
fs.rmSync(pgTempDir, { recursive: true, force: true });

console.log(`\nALL OFFLINE REFRESH & DISPATCH TESTS PASSED: ${passed} checks succeeded.`);

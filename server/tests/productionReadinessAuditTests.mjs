import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

const tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_prod_readiness_'));
process.env.AWLAD_DATA_DIR = tempRootDir;
process.env.JWT_SECRET = 'prod_readiness_audit_jwt_secret_key_for_erp_tests_2026';

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { REPORT_TYPES_LIST } = await import('../db/stores/reportsStore.js');
const { createEmptyDatabaseState, readJsonDatabase } = await import('../db/jsonLedger.js');
const { resetAllRateLimitsForTests } = await import('../middleware/auth.js');

const REPO_ROOT = path.resolve(process.cwd());

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

function createPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();

  const wrapQuery = (target) => async (sql, params) => target.query(sql, params);

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
  let text = '';
  try {
    text = await res.text();
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

console.log('\n=== AWLAD SELIM Production Readiness Complete Audit Suite (JSON + PG) ===');

// ---------------------------------------------------------------------------
// PART 1: Static Hygiene — Exact 23 Report Titles/Groups & Egyptian-Only Catalog
// ---------------------------------------------------------------------------
await test('1. Exact 23 report titles, order, groups, and role="separator" dividers match between ReportsView.tsx and reportsStore.js', async () => {
  const reportsViewPath = path.join(REPO_ROOT, 'src/components/modules/reports/ReportsView.tsx');
  const src = fs.readFileSync(reportsViewPath, 'utf8');
  const match = src.match(/export const REPORT_TYPE_OPTIONS:\s*ComprehensiveReportOption\[\]\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(match, 'REPORT_TYPE_OPTIONS must exist in ReportsView.tsx');

  const optionMatches = [...match[1].matchAll(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)',\s*group:\s*(\d+)\s*\}/g)].map((m) => ({
    key: m[1],
    label: m[2],
    group: Number(m[3]),
  }));

  assert.equal(optionMatches.length, 23, 'Must preserve exactly 23 comprehensive report options');
  assert.equal(REPORT_TYPES_LIST.length, 23, 'Backend REPORT_TYPES_LIST must have exactly 23 entries');
  assert.deepEqual(optionMatches, REPORT_TYPES_LIST, 'Frontend & backend 23 report keys, exact diacritics/spelling, order, and groups must match 1:1');

  const expectedTitles = [
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
  assert.deepEqual(optionMatches.map((o) => o.label), expectedTitles);
  assert.ok(src.includes('role="separator"'), 'ReportsView.tsx must render role="separator" group dividers');
});

await test('2. Product catalog & clean empty schema contain Egyptian products only (0 imported items, 0 noodle cups)', async () => {
  const catalogPath = path.join(REPO_ROOT, 'product-import-source/products-catalog.json');
  assert.equal(fs.existsSync(catalogPath), true, 'Tracked catalog source product-import-source/products-catalog.json must exist');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const catalogItems = Array.isArray(catalog) ? catalog : (catalog.products || catalog.items || []);
  assert.ok(catalogItems.length > 0, 'Catalog must contain products');

  const cleanInitialState = createEmptyDatabaseState();
  assert.ok(Array.isArray(cleanInitialState.products), 'Initial schema must include products array');
  assert.equal(cleanInitialState.products.length, 0, 'Fresh default database schema must start with 0 products');
  assert.equal(cleanInitialState.users.length, 0, 'Fresh default database schema must start with 0 users');

  const dbPath = path.join(REPO_ROOT, 'server/data/database.json');
  const optionalLocalDbProducts = fs.existsSync(dbPath)
    ? (JSON.parse(fs.readFileSync(dbPath, 'utf8')).products || [])
    : [];

  const forbiddenCupRe = /(?:^|\s|\(|-)(?:cup|كاب|كوباية|كوب(?:\s+نودلز|\s+إندومي|\s+اندومي)?|علبة\s+نودلز)(?:\s|$|\)|-)/i;
  const importedRe = /مستورد|imported|\bimport\b|إندونيسي|كوري|تركي|ياباني|صيني|تايلاندي/i;

  for (const item of catalogItems) {
    const label = `${item.name || ''} ${item.category || ''} ${item.notes || ''}`;
    assert.equal(forbiddenCupRe.test(label), false, `Catalog product violates no-cups rule: ${item.name}`);
    assert.equal(importedRe.test(label), false, `Catalog product violates Egyptian-only rule: ${item.name}`);
    assert.equal(Boolean(item.isImported), false, `Catalog product marked imported: ${item.name}`);
  }
  for (const item of optionalLocalDbProducts) {
    const label = `${item.name || ''} ${item.category || ''} ${item.notes || ''}`;
    assert.equal(forbiddenCupRe.test(label), false, `Local DB product violates no-cups rule: ${item.name}`);
    assert.equal(importedRe.test(label), false, `Local DB product violates Egyptian-only rule: ${item.name}`);
    assert.equal(Boolean(item.isImported), false, `Local DB product marked imported: ${item.name}`);
  }
});

// ---------------------------------------------------------------------------
// PART 2: End-to-End Dual-Mode Suite (JSON Ledger + PostgreSQL via pg-mem)
// ---------------------------------------------------------------------------
async function runDualModeSuite(modeName) {
  const modeDir = fs.mkdtempSync(path.join(os.tmpdir(), `awlad_pr_${modeName}_`));
  process.env.AWLAD_DATA_DIR = modeDir;
  resetAllRateLimitsForTests();

  let pgPool = null;
  if (modeName === 'pg') {
    pgPool = createPgMemPool();
    setInjectedPool(pgPool);
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
  let purchReceiverToken = '';
  let salesNoPrivToken = '';
  let managerToken = '';
  let repAToken = '';
  let repBToken = '';

  let repAId = '';
  let repBId = '';
  let mainWhId = '';
  let cb1Id = '';
  let cb2Id = '';
  let supplierId = '';
  let customerId = '';
  let productId = '';

  try {
    await test(`[${modeName}] 3. Seed isolated workspace fixtures, staff roles & two representatives`, async () => {
      process.env.BOOTSTRAP_ADMIN_SECRET = 'ProdAuditSecret#2026';
      try {
        const boot = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
          body: {
            fullName: 'مدير الاعتماد النهائي',
            username: 'prod_admin',
            password: 'AdminPassword!2026',
            phone: '01010009999',
            bootstrapSecret: 'ProdAuditSecret#2026',
          },
        });
        assert.equal(boot.status, 201);
      } finally {
        delete process.env.BOOTSTRAP_ADMIN_SECRET;
      }

      const adminLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'prod_admin', password: 'AdminPassword!2026' },
      });
      assert.equal(adminLogin.status, 200);
      adminToken = adminLogin.json.accessToken;

      const whRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
        token: adminToken,
        body: { name: 'مخزن المصنع الرئيسي', code: 'MAIN-WH', isDefault: true },
      });
      assert.equal(whRes.status, 201);
      mainWhId = whRes.json.warehouse.id;

      const cb1Res = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: adminToken,
        body: { name: 'الخزينة الرئيسية', type: 'cash', openingBalance: 10000, isDefault: true },
      });
      assert.equal(cb1Res.status, 201);
      cb1Id = cb1Res.json.cashbox.id;

      const cb2Res = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: adminToken,
        body: { name: 'خزينة فرعية', type: 'bank', openingBalance: 5000, isDefault: false },
      });
      assert.equal(cb2Res.status, 201);
      cb2Id = cb2Res.json.cashbox.id;

      const supRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: { name: 'مورد مكرونة مصرية', phone: '01112223334', openingBalance: 0 },
      });
      assert.equal(supRes.status, 201);
      supplierId = supRes.json.supplier.id;

      const custRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: 'عميل السوبر ماركت المصري', phone: '01223334445', openingBalance: 0 },
      });
      assert.equal(custRes.status, 201);
      customerId = custRes.json.customer.id;

      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: 'شعرية محمصة مصري 350 جم',
          code: 'EGY-SH-350',
          category: 'مكرونات مصرية',
          baseUnit: 'كيس',
          purchasePrice: 12,
          sellingPrice: 18,
          stockPerWarehouse: { [mainWhId]: 100 },
        },
      });
      assert.equal(prodRes.status, 201);
      productId = prodRes.json.product.id;

      // Register two representatives
      const rAReg = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب أ',
          username: 'prod_rep_a',
          phone: '01055550001',
          password: 'RepPassword!A',
        },
      });
      assert.equal(rAReg.status, 201);
      repAId = rAReg.json.representativeProfile?.id;
      assert.ok(repAId);
      await req(baseUrl, 'PUT', `/api/admin/users/${rAReg.json.user.id}`, {
        token: adminToken,
        body: { permissions: { canView: true, canAdd: true, canManageSales: true } },
      });
      repAToken = (await req(baseUrl, 'POST', '/api/auth/login', { body: { username: 'prod_rep_a', password: 'RepPassword!A' } })).json.accessToken;

      const rBReg = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب ب',
          username: 'prod_rep_b',
          phone: '01055550002',
          password: 'RepPassword!B',
        },
      });
      assert.equal(rBReg.status, 201);
      repBId = rBReg.json.representativeProfile?.id;
      assert.ok(repBId);
      await req(baseUrl, 'PUT', `/api/admin/users/${rBReg.json.user.id}`, {
        token: adminToken,
        body: { permissions: { canView: true, canAdd: true, canManageSales: true } },
      });
      repBToken = (await req(baseUrl, 'POST', '/api/auth/login', { body: { username: 'prod_rep_b', password: 'RepPassword!B' } })).json.accessToken;

      // Staff user 1: Warehouse/Purchase receiver WITHOUT treasury rights
      const prRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'أمين مخزن استلام',
          username: 'purch_receiver',
          password: 'StaffPassword!1',
          role: 'warehouse',
          permissions: {
            canView: true,
            canAdd: true,
            canManagePurchases: true,
            canReceive: true,
            canManageCashboxes: false,
            canManageAccounts: false,
          },
        },
      });
      assert.equal(prRes.status, 201);
      purchReceiverToken = (await req(baseUrl, 'POST', '/api/auth/login', { body: { username: 'purch_receiver', password: 'StaffPassword!1' } })).json.accessToken;

      // Staff user 2: Sales staff WITHOUT treasury and WITHOUT canManageReps
      const spRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'موظف مبيعات محدود',
          username: 'sales_limited',
          password: 'StaffPassword!2',
          role: 'sales',
          permissions: {
            canView: true,
            canAdd: true,
            canManageSales: true,
            canManageReps: false,
            canManageCashboxes: false,
            canManageAccounts: false,
          },
        },
      });
      assert.equal(spRes.status, 201);
      salesNoPrivToken = (await req(baseUrl, 'POST', '/api/auth/login', { body: { username: 'sales_limited', password: 'StaffPassword!2' } })).json.accessToken;

      // Staff user 3: Manager WITH canManageSales + canManageReps + treasury + personal accounts
      const mgRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مدير عمليات شامل',
          username: 'ops_manager',
          password: 'StaffPassword!3',
          role: 'manager',
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: true,
            canApprove: true,
            canReceive: true,
            canManageSales: true,
            canManagePurchases: true,
            canManageReps: true,
            canManageCashboxes: true,
            canManageAccounts: true,
            canManageTransfers: true,
            canViewPersonalAccounts: true,
            canCreatePersonalTx: true,
            canViewReports: true,
          },
        },
      });
      assert.equal(mgRes.status, 201);
      managerToken = (await req(baseUrl, 'POST', '/api/auth/login', { body: { username: 'ops_manager', password: 'StaffPassword!3' } })).json.accessToken;
    });

    await test(`[${modeName}] 4. receivePurchaseInvoice blocks cashbox override without treasury privilege and preserves same-cashbox receipt`, async () => {
      const pInvRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: adminToken,
        body: {
          supplierId,
          supplierName: 'مورد مكرونة مصرية',
          warehouseId: mainWhId,
          cashboxId: cb1Id,
          paymentType: 'cash',
          paidAmount: 240,
          status: 'draft',
          items: [{ productId, productName: 'شعرية محمصة مصري 350 جم', unit: 'كيس', quantity: 20, unitPrice: 12 }],
        },
      });
      assert.equal(pInvRes.status, 201);
      const purId = pInvRes.json.invoice.id;

      const sendRes = await req(baseUrl, 'POST', `/api/invoices/purchase/${purId}/send`, {
        token: adminToken,
        body: {},
      });
      assert.equal(sendRes.status, 200);

      // Receiver WITHOUT treasury authority tries overriding cashbox to cb2 -> 403 FORBIDDEN_CASHBOX_OVERRIDE
      const blockedOverride = await req(baseUrl, 'POST', `/api/invoices/purchase/${purId}/receive`, {
        token: purchReceiverToken,
        body: { warehouseId: mainWhId, cashboxId: cb2Id },
      });
      assert.equal(blockedOverride.status, 403);
      assert.equal(blockedOverride.json?.code, 'FORBIDDEN_CASHBOX_OVERRIDE');

      // Receiver receives using invoice's own cashbox (omitted or same cb1Id) with confirmNow -> 200
      const recvOk = await req(baseUrl, 'POST', `/api/invoices/purchase/${purId}/receive`, {
        token: purchReceiverToken,
        body: { warehouseId: mainWhId, cashboxId: cb1Id, confirmNow: true },
      });
      assert.equal(recvOk.status, 200);
      assert.equal(recvOk.json.invoice.status, 'confirmed');
      assert.equal(recvOk.json.invoice.dispatchStatus, 'confirmed');
      assert.equal(recvOk.json.invoice.cashboxId, cb1Id);
    });

    await test(`[${modeName}] 5. convertQuoteToInvoice & convertOrderToInvoice + advanceOrderStage enforce treasury, rep-override & audit rules`, async () => {
      // A) Quote conversion
      const qRes = await req(baseUrl, 'POST', '/api/invoices/quotes', {
        token: adminToken,
        body: {
          customerId,
          customerName: 'عميل السوبر ماركت المصري',
          warehouseId: mainWhId,
          representativeId: repAId,
          items: [{ productId, productName: 'شعرية محمصة مصري 350 جم', unit: 'كيس', quantity: 5, unitPrice: 18 }],
        },
      });
      assert.equal(qRes.status, 201);
      const quoteId = qRes.json.invoice.id;

      const quoteCashBlocked = await req(baseUrl, 'POST', `/api/invoices/quotes/${quoteId}/convert`, {
        token: salesNoPrivToken,
        body: { paymentType: 'cash', paidAmount: 90, cashboxId: cb1Id },
      });
      assert.equal(quoteCashBlocked.status, 403);
      assert.equal(quoteCashBlocked.json?.code, 'FORBIDDEN_TREASURY_PERMISSION');

      const quoteRepBlocked = await req(baseUrl, 'POST', `/api/invoices/quotes/${quoteId}/convert`, {
        token: salesNoPrivToken,
        body: { representativeId: repBId },
      });
      assert.equal(quoteRepBlocked.status, 403);
      assert.equal(quoteRepBlocked.json?.code, 'FORBIDDEN_QUOTE_REP_OVERRIDE');

      const quoteFakeRep = await req(baseUrl, 'POST', `/api/invoices/quotes/${quoteId}/convert`, {
        token: managerToken,
        body: { representativeId: 'REP-DOES-NOT-EXIST' },
      });
      assert.equal(quoteFakeRep.status, 404);
      assert.equal(quoteFakeRep.json?.code, 'REPRESENTATIVE_NOT_FOUND');

      const quoteOk = await req(baseUrl, 'POST', `/api/invoices/quotes/${quoteId}/convert`, {
        token: managerToken,
        body: { representativeId: repBId, paymentType: 'credit', paidAmount: 0 },
      });
      assert.equal(quoteOk.status, 201);
      assert.equal(quoteOk.json.invoice.representativeId, repBId);

      // Rep self quote conversion forces repAId even if repBId passed
      const qRepRes = await req(baseUrl, 'POST', '/api/invoices/quotes', {
        token: repAToken,
        body: {
          customerId,
          warehouseId: mainWhId,
          items: [{ productId, unit: 'كيس', quantity: 2, unitPrice: 18 }],
        },
      });
      assert.equal(qRepRes.status, 201);
      const qRepConv = await req(baseUrl, 'POST', `/api/invoices/quotes/${qRepRes.json.invoice.id}/convert`, {
        token: repAToken,
        body: { representativeId: repBId, warehouseId: mainWhId },
      });
      assert.equal(qRepConv.status, 201);
      assert.equal(qRepConv.json.invoice.representativeId, repAId);

      // B) Order stage & conversion
      const ordRes = await req(baseUrl, 'POST', '/api/orders', {
        token: adminToken,
        body: {
          customerId,
          representativeId: repAId,
          deliveryRepId: repAId,
          items: [{ productId, unit: 'كيس', quantity: 4, unitPrice: 18 }],
        },
      });
      assert.equal(ordRes.status, 201);
      const orderId = ordRes.json.order.id;

      const appRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/approve`, {
        token: adminToken,
        body: { deliveryRepId: repAId },
      });
      assert.equal(appRes.status, 200);

      // salesNoPriv tries overriding deliveryRepId via stage advance -> 403 FORBIDDEN_ORDER_REP_OVERRIDE
      const stageRepBlocked = await req(baseUrl, 'POST', `/api/orders/${orderId}/stage`, {
        token: salesNoPrivToken,
        body: { stage: 'out_for_delivery', deliveryRepId: repBId },
      });
      assert.equal(stageRepBlocked.status, 403);
      assert.equal(stageRepBlocked.json?.code, 'FORBIDDEN_ORDER_REP_OVERRIDE');

      // manager tries fake deliveryRepId on stage advance -> 404 REPRESENTATIVE_NOT_FOUND
      const stageFakeRep = await req(baseUrl, 'POST', `/api/orders/${orderId}/stage`, {
        token: managerToken,
        body: { stage: 'out_for_delivery', deliveryRepId: 'REP-UNKNOWN' },
      });
      assert.equal(stageFakeRep.status, 404);
      assert.equal(stageFakeRep.json?.code, 'REPRESENTATIVE_NOT_FOUND');

      // salesNoPriv tries convert-to-invoice with cash payment -> 403 FORBIDDEN_TREASURY_PERMISSION
      const ordCashBlocked = await req(baseUrl, 'POST', `/api/orders/${orderId}/convert-to-invoice`, {
        token: salesNoPrivToken,
        body: { warehouseId: mainWhId, paymentType: 'cash', paidAmount: 72, cashboxId: cb1Id },
      });
      assert.equal(ordCashBlocked.status, 403);
      assert.equal(ordCashBlocked.json?.code, 'FORBIDDEN_TREASURY_PERMISSION');

      // salesNoPriv tries convert-to-invoice overriding representative -> 403 FORBIDDEN_ORDER_REP_OVERRIDE
      const ordRepBlocked = await req(baseUrl, 'POST', `/api/orders/${orderId}/convert-to-invoice`, {
        token: salesNoPrivToken,
        body: { warehouseId: mainWhId, representativeId: repBId },
      });
      assert.equal(ordRepBlocked.status, 403);
      assert.equal(ordRepBlocked.json?.code, 'FORBIDDEN_ORDER_REP_OVERRIDE');

      // Manager with canManageReps converts order to repBId -> 201 and audit log records rep change
      const ordConvOk = await req(baseUrl, 'POST', `/api/orders/${orderId}/convert-to-invoice`, {
        token: managerToken,
        body: { warehouseId: mainWhId, representativeId: repBId, paymentType: 'credit' },
      });
      assert.equal(ordConvOk.status, 201);
      assert.equal(ordConvOk.json.invoice.representativeId, repBId);

      const logsRes = await req(baseUrl, 'GET', '/api/admin/audit-logs?limit=30', { token: adminToken });
      assert.equal(logsRes.status, 200);
      assert.ok((logsRes.json.logs || []).some((l) => String(l.action || '').includes('تعديل المندوب')), 'Rep override on quote/order conversion must appear in audit logs');
    });

    await test(`[${modeName}] 6. Rep financial transfers enforce direction, sender attribution, default cashbox fallback & self/cross-rep isolation`, async () => {
      // Rep A cannot create owner_to_rep transfer
      const badDir = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
        token: repAToken,
        body: {
          direction: 'owner_to_rep',
          senderId: 'OWNER',
          receiverId: repAId,
          amount: 100,
          cashboxId: cb1Id,
        },
      });
      assert.equal(badDir.status, 403);
      assert.equal(badDir.json?.code, 'FORBIDDEN_REP_TRANSFER_DIRECTION');

      // Rep A creates rep_to_owner with spoofed senderId & fallback fake cashboxId -> server forces repAId & default cashbox cb1Id
      const trRepToOwner = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
        token: repAToken,
        body: {
          direction: 'rep_to_owner',
          senderId: repBId,
          senderName: 'مندوب مزور',
          receiverId: repBId,
          amount: 150,
          cashboxId: 'CASH-SPOOFED',
          notes: 'توريد نقدية فعلي',
        },
      });
      assert.equal(trRepToOwner.status, 201);
      const tr1 = trRepToOwner.json.transfer;
      assert.equal(tr1.senderId, repAId);
      assert.equal(tr1.receiverId, 'OWNER');
      assert.equal(tr1.cashboxId, cb1Id);

      // Rep A cannot self-confirm own rep_to_owner
      const selfConfirm = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${tr1.id}/confirm`, {
        token: repAToken,
        body: { note: 'محاولة اعتماد ذاتي' },
      });
      assert.equal(selfConfirm.status, 403);
      assert.equal(selfConfirm.json?.code, 'FORBIDDEN_SELF_CONFIRM_TRANSFER');

      // Rep B cannot reject Rep A's transfer
      const crossReject = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${tr1.id}/reject`, {
        token: repBToken,
        body: { reason: 'محاولة رفض غير مصرح بها' },
      });
      assert.equal(crossReject.status, 403);
      assert.equal(crossReject.json?.code, 'FORBIDDEN_REP_TRANSFER_ACCESS');

      // Admin confirms rep_to_owner transfer
      const confirm1 = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${tr1.id}/confirm`, {
        token: adminToken,
        body: { note: 'تم الاستلام في الخزينة' },
      });
      assert.equal(confirm1.status, 200);

      // Admin sends owner_to_rep custody to Rep A; Rep B cannot confirm, Rep A confirms
      const trOwnerToRep = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
        token: adminToken,
        body: {
          direction: 'owner_to_rep',
          receiverId: repAId,
          amount: 100,
          cashboxId: cb1Id,
          notes: 'صرف عهدة للمندوب أ',
        },
      });
      assert.equal(trOwnerToRep.status, 201);
      const tr2 = trOwnerToRep.json.transfer;

      const repBConfirm = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${tr2.id}/confirm`, {
        token: repBToken,
        body: {},
      });
      assert.equal(repBConfirm.status, 403);
      assert.equal(repBConfirm.json?.code, 'FORBIDDEN_REP_TRANSFER_ACCESS');

      const repAConfirm = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${tr2.id}/confirm`, {
        token: repAToken,
        body: { note: 'تم استلام العهدة' },
      });
      assert.equal(repAConfirm.status, 200);
    });

    await test(`[${modeName}] 7. Sales, payments, returns, expenses, cheques, installments, cash ops & personal accounts maintain exact balanceAfter & JSON/PG parity`, async () => {
      // Cash sales invoice
      const saleRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: managerToken,
        body: {
          customerId,
          customerName: 'عميل السوبر ماركت المصري',
          warehouseId: mainWhId,
          cashboxId: cb1Id,
          paymentType: 'partial',
          paidAmount: 90,
          status: 'confirmed',
          items: [{ productId, productName: 'شعرية محمصة مصري 350 جم', unit: 'كيس', quantity: 10, unitPrice: 18 }],
        },
      });
      assert.equal(saleRes.status, 201);
      const saleInv = saleRes.json.invoice;

      // Invoice payment
      const payRes = await req(baseUrl, 'POST', `/api/invoices/${saleInv.id}/payments`, {
        token: managerToken,
        body: { amount: 45, cashboxId: cb1Id, paymentMethod: 'cash', date: '2026-11-23' },
      });
      assert.equal(payRes.status, 200);

      // Direct cash return
      const retRes = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: managerToken,
        body: {
          originalInvoiceId: saleInv.id,
          type: 'sales_return',
          refundType: 'cash',
          cashboxId: cb1Id,
          warehouseId: mainWhId,
          items: [{ productId, productName: 'شعرية محمصة مصري 350 جم', unit: 'كيس', quantity: 1, unitPrice: 18 }],
        },
      });
      assert.equal(retRes.status, 201);

      // Sales return request + cash approval
      const srrCreate = await req(baseUrl, 'POST', '/api/invoices/sales-return-requests', {
        token: managerToken,
        body: {
          originalInvoiceId: saleInv.id,
          warehouseId: mainWhId,
          refundType: 'cash',
          cashboxId: cb1Id,
          reason: 'مرتجع اختبار مطابقة الخزينة',
          items: [{ productId, unit: 'كيس', quantity: 1, unitPrice: 18 }],
        },
      });
      assert.equal(srrCreate.status, 201);
      const srrApprove = await req(baseUrl, 'POST', `/api/invoices/sales-return-requests/${srrCreate.json.request.id}/approve`, {
        token: managerToken,
        body: { cashboxId: cb1Id, warehouseId: mainWhId },
      });
      assert.equal(srrApprove.status, 200);

      // Expense
      const expRes = await req(baseUrl, 'POST', '/api/admin/expenses', {
        token: adminToken,
        body: { type: 'expense', category: 'نقل ومشال', amount: 30, cashboxId: cb1Id, date: '2026-11-23' },
      });
      assert.equal(expRes.status, 201);

      // Cheque + collect
      const chqRes = await req(baseUrl, 'POST', '/api/admin/cheques', {
        token: adminToken,
        body: {
          chequeNumber: 'CHQ-1001',
          type: 'incoming',
          bankName: 'البنك الأهلي المصري',
          amount: 200,
          issueDate: '2026-11-20',
          dueDate: '2026-11-23',
          partyId: customerId,
          partyName: 'عميل السوبر ماركت المصري',
          cashboxId: cb1Id,
        },
      });
      assert.equal(chqRes.status, 201);
      const chqCol = await req(baseUrl, 'POST', `/api/admin/cheques/${chqRes.json.cheque.id}/status`, {
        token: adminToken,
        body: { status: 'collected', cashboxId: cb1Id },
      });
      assert.equal(chqCol.status, 200);

      // Installment + pay
      const instRes = await req(baseUrl, 'POST', '/api/admin/installments', {
        token: adminToken,
        body: {
          customerId,
          customerName: 'عميل السوبر ماركت المصري',
          totalAmount: 100,
          paidAmount: 0,
          remainingAmount: 100,
          items: [{ id: 'ITM-1', dueDate: '2026-11-23', amount: 100, paidAmount: 0, status: 'pending' }],
        },
      });
      assert.equal(instRes.status, 201);
      const instPay = await req(baseUrl, 'POST', `/api/admin/installments/${instRes.json.schedule.id}/pay`, {
        token: adminToken,
        body: { scheduleId: instRes.json.schedule.id, installmentItemId: 'ITM-1', amount: 100, cashboxId: cb1Id },
      });
      assert.equal(instPay.status, 200);

      // Cash operation deposit
      const cashOpRes = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        body: { type: 'cash_deposit', amount: 500, cashboxId: cb1Id, date: '2026-11-23', notes: 'إيداع رأسمال' },
      });
      assert.equal(cashOpRes.status, 201);

      // Personal account + transaction (withdrawal affecting cashbox)
      const paCreate = await req(baseUrl, 'POST', '/api/personal-accounts', {
        token: managerToken,
        body: { ownerName: 'شريك مصري', accountName: 'حساب شخصي شريك', openingBalance: 0, notes: 'اختبار التطابق' },
      });
      assert.equal(paCreate.status, 201);
      const paTx = await req(baseUrl, 'POST', `/api/personal-accounts/${paCreate.json.account.id}/transactions`, {
        token: managerToken,
        body: { type: 'personal_withdrawal', amount: 60, cashboxId: cb1Id, date: '2026-11-23', notes: 'سحب شخصي' },
      });
      assert.equal(paTx.status, 201);

      // Check bootstrap cashbox balance & financialTransactions balanceAfter parity
      const boot = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(boot.status, 200);
      const cb1 = (boot.json.data.cashboxes || []).find((c) => c.id === cb1Id);
      assert.ok(cb1);

      // Expected cb1 balance:
      // 10000 (open) - 240 (purchase) + 150 (rep->owner) - 100 (owner->rep) + 90 (sale cash)
      // + 45 (invoice payment) - 18 (direct return) - 18 (sales return req) - 30 (expense)
      // + 200 (cheque) + 100 (installment) + 500 (cash deposit) - 60 (personal withdrawal)
      // = 10619
      assert.equal(Number(cb1.currentBalance), 10619, `Expected cb1 currentBalance 10619, got ${cb1.currentBalance}`);

      const cb1Txs = (boot.json.data.financialTransactions || []).filter((t) => t.cashboxId === cb1Id);
      assert.ok(cb1Txs.length >= 12, 'All cashbox operations must emit financialTransactions rows');
      for (const tx of cb1Txs) {
        assert.equal(typeof tx.balanceAfter, 'number', `Transaction ${tx.id} (${tx.type}) must record numeric balanceAfter in ${modeName}`);
        assert.equal(Number.isFinite(tx.balanceAfter), true);
      }

      if (modeName === 'json') {
        const jsonDb = readJsonDatabase();
        for (const tx of jsonDb.financialTransactions || []) {
          assert.equal(typeof tx.balanceAfter, 'number', `JSON ledger transaction ${tx.id} (${tx.type}) missing numeric balanceAfter`);
        }
      }

      // Report check across comprehensive types
      const repAll = await req(baseUrl, 'GET', '/api/reports/comprehensive?reportType=all&dateFrom=2026-01-01&dateTo=2026-12-31', { token: adminToken });
      assert.equal(repAll.status, 200);
      const totalReportRows = (repAll.json.report?.sections || []).reduce((sum, s) => sum + ((s.rows || []).length), 0);
      assert.ok(totalReportRows > 0, 'Comprehensive report sections must contain rows');
    });

    await test(`[${modeName}] 8. Backup export & restore preserves full dataset integrity`, async () => {
      const expRes = await req(baseUrl, 'GET', '/api/admin/backup/export', { token: adminToken });
      assert.equal(expRes.status, 200);
      const backup = expRes.json.backup;
      assert.ok(backup && Array.isArray(backup.cashboxes) && Array.isArray(backup.invoices));
      const origInvCount = backup.invoices.length;

      // Mutate state with another expense, then restore from snapshot
      const extraExp = await req(baseUrl, 'POST', '/api/admin/expenses', {
        token: adminToken,
        body: { type: 'expense', category: 'مصروف مؤقت قبل الاستعادة', amount: 111, cashboxId: cb1Id, date: '2026-11-23' },
      });
      assert.equal(extraExp.status, 201);

      const restoreRes = await req(baseUrl, 'POST', '/api/admin/backup/restore', {
        token: adminToken,
        body: { backup },
      });
      assert.equal(restoreRes.status, 200);

      const bootAfter = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(bootAfter.status, 200);
      const cb1After = (bootAfter.json.data.cashboxes || []).find((c) => c.id === cb1Id);
      assert.equal(Number(cb1After.currentBalance), 10619, 'Backup restore must revert cashbox balance accurately');
      assert.equal((bootAfter.json.data.invoices || []).length, origInvCount, 'Backup restore must preserve invoice count');
    });

    await test(`[${modeName}] 9. Order advance payments & stage transitions strip cashbox/cost data for reps and block unauthorized cashbox overrides`, async () => {
      const ordCreate = await req(baseUrl, 'POST', '/api/orders', {
        token: repAToken,
        body: {
          customerId,
          items: [{ productId, unit: 'كيس', quantity: 5, unitPrice: 18 }],
          notes: 'طلب اختبار عزل الخزينة والدفعة المقدمة',
        },
      });
      assert.equal(ordCreate.status, 201);
      const ordId = ordCreate.json.order.id;

      const ordApprove = await req(baseUrl, 'POST', `/api/orders/${ordId}/approve`, {
        token: managerToken,
        body: {},
      });
      assert.equal(ordApprove.status, 200);

      // Non-treasury staff cannot divert advance payment to a non-default cashbox
      const nonTreasAdv = await req(baseUrl, 'POST', `/api/orders/${ordId}/advance-payment`, {
        token: salesNoPrivToken,
        body: { amount: 20, cashboxId: cb2Id },
      });
      assert.equal(nonTreasAdv.status, 403);
      assert.equal(nonTreasAdv.json?.code, 'FORBIDDEN_TREASURY_PERMISSION');

      // Owning rep records advance payment -> response & GET /api/orders must omit cashbox metadata & cashboxBalance
      const repAdv = await req(baseUrl, 'POST', `/api/orders/${ordId}/advance-payment`, {
        token: repAToken,
        headers: { 'Idempotency-Key': `PROD-ADV-${modeName}` },
        body: { amount: 20, cashboxId: cb2Id, notes: 'دفعة مقدمة من المندوب' },
      });
      assert.equal(repAdv.status, 201);
      assert.equal('cashboxBalance' in repAdv.json, false);
      assert.equal(repAdv.json.advancePayment?.cashboxId, undefined);
      assert.equal(repAdv.json.advancePayment?.cashboxName, undefined);

      const repOrderDetail = await req(baseUrl, 'GET', `/api/orders/${ordId}`, { token: repAToken });
      assert.equal(repOrderDetail.status, 200);
      for (const ph of repOrderDetail.json.order.paymentsHistory || []) {
        assert.equal(ph.cashboxName || '', '', 'Representative order paymentsHistory must hide internal cashboxName');
      }

      // Convert order to credit invoice applying advance (total 90, advance 20 -> remaining 70)
      const convRes = await req(baseUrl, 'POST', `/api/orders/${ordId}/convert-to-invoice`, {
        token: managerToken,
        body: { warehouseId: mainWhId, paymentType: 'credit', paidAtInvoice: 0 },
      });
      assert.equal(convRes.status, 201);
      assert.equal(Number(convRes.json.invoice.appliedAdvanceAmount), 20);
      assert.equal(Number(convRes.json.invoice.remainingAmount), 70);

      // Rep collects remaining via stage transition -> must sanitize invoice cost & order paymentsHistory cashboxName
      const stOut = await req(baseUrl, 'POST', `/api/orders/${ordId}/stage`, {
        token: repAToken,
        body: { stage: 'out_for_delivery' },
      });
      assert.equal(stOut.status, 200);

      const stCollected = await req(baseUrl, 'POST', `/api/orders/${ordId}/stage`, {
        token: repAToken,
        body: { stage: 'collected', collectedAmount: 30, cashboxId: cb2Id },
      });
      assert.equal(stCollected.status, 200);
      assert.ok(stCollected.json.invoice);
      for (const it of stCollected.json.invoice.items || []) {
        assert.equal(Number(it.purchasePriceAtTime || 0), 0, 'Stage collection invoice must zero purchasePriceAtTime for rep');
      }
      for (const ph of stCollected.json.order?.paymentsHistory || []) {
        assert.equal(ph.cashboxName || '', '', 'Stage order paymentsHistory must hide cashboxName for rep');
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    setInjectedPool(null);
    resetPgModeCache();
    fs.rmSync(modeDir, { recursive: true, force: true });
  }
}

try {
  await runDualModeSuite('json');
  await runDualModeSuite('pg');
  console.log(`\n[SUCCESS] Production readiness audit suite passed (${passed} test groups).\n`);
} finally {
  fs.rmSync(tempRootDir, { recursive: true, force: true });
}

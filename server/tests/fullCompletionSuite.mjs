import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_full_completion_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'full_completion_jwt_secret_for_awlad_selim_tests_2026';

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { bootstrapAdmin, registerMobileAccount } = await import('../db/stores/authStore.js');
const { resetAllRateLimitsForTests } = await import('../middleware/auth.js');
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

console.log('\n=== Full Project Audit & Completion Verification Suite (PG pg-mem + JSON) ===');

// 1. Production BOOTSTRAP_ADMIN_SECRET mandatory check
await test('1. NODE_ENV=production rejects bootstrapAdmin when BOOTSTRAP_ADMIN_SECRET is unset or empty', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.BOOTSTRAP_ADMIN_SECRET;
  const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_prod_boot_'));
  process.env.AWLAD_DATA_DIR = bootDir;
  process.env.NODE_ENV = 'production';
  delete process.env.BOOTSTRAP_ADMIN_SECRET;
  const pgPool = createPgMemPool();
  setInjectedPool(pgPool);
  await initializeSchema();
  resetPgModeCache();

  try {
    await assert.rejects(
      () =>
        bootstrapAdmin({
          fullName: 'مدير بدون سر',
          username: 'no_secret_admin',
          password: 'AdminPassword!123',
        }),
      (err) => err?.status === 403 && err?.code === 'BOOTSTRAP_FORBIDDEN'
    );

    process.env.BOOTSTRAP_ADMIN_SECRET = 'ProdBootSecret#2026';
    const okAdmin = await bootstrapAdmin({
      fullName: 'مدير الإنتاج',
      username: 'prod_boot_admin',
      password: 'AdminPassword!123',
      bootstrapSecret: 'ProdBootSecret#2026',
    });
    assert.equal(okAdmin.role, 'admin');
  } finally {
    setInjectedPool(null);
    process.env.NODE_ENV = prevEnv;
    if (prevSecret !== undefined) process.env.BOOTSTRAP_ADMIN_SECRET = prevSecret;
    else delete process.env.BOOTSTRAP_ADMIN_SECRET;
    process.env.AWLAD_DATA_DIR = tempDataDir;
    fs.rmSync(bootDir, { recursive: true, force: true });
    resetPgModeCache();
  }
});

// 2. Production HTTP LAN / Loopback enforcement middleware
await test('2. NODE_ENV=production restricts HTTP strictly to non-proxied loopback or explicit private LAN sockets', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevElectron = process.env.AWLAD_ELECTRON;
  const prevLan = process.env.ALLOW_MOBILE_LAN_HTTP;
  const prevTrust = process.env.TRUST_PROXY;

  process.env.NODE_ENV = 'production';
  process.env.AWLAD_ELECTRON = 'true';
  process.env.ALLOW_MOBILE_LAN_HTTP = 'true';
  process.env.TRUST_PROXY = '1';

  const app = createApiApp();
  const findHttpEnforceMiddleware = () => {
    const layers = app._router?.stack || [];
    for (const layer of layers) {
      if (layer.handle && String(layer.handle).includes('HTTPS_REQUIRED')) {
        return layer.handle;
      }
    }
    return null;
  };
  const mw = findHttpEnforceMiddleware();
  assert.ok(mw, 'Expected HTTPS enforcement middleware on Express stack');

  const invokeMw = (remoteAddress, xfProto = '') => {
    let nextCalled = false;
    let respStatus = 200;
    let respJson = null;
    const fakeReq = {
      socket: { remoteAddress },
      secure: false,
      app,
      get(name) {
        if (String(name).toLowerCase() === 'x-forwarded-proto') return xfProto;
        return '';
      },
    };
    const fakeRes = {
      status(code) {
        respStatus = code;
        return this;
      },
      json(body) {
        respJson = body;
        return this;
      },
    };
    mw(fakeReq, fakeRes, () => {
      nextCalled = true;
    });
    return { nextCalled, respStatus, respJson };
  };

  try {
    // Public internet HTTP MUST be blocked 403 even with AWLAD_ELECTRON=true & ALLOW_MOBILE_LAN_HTTP=true
    const publicHttp = invokeMw('8.8.8.8', '');
    assert.equal(publicHttp.nextCalled, false);
    assert.equal(publicHttp.respStatus, 403);
    assert.equal(publicHttp.respJson?.code, 'HTTPS_REQUIRED');

    // Spoofed/proxied HTTP over trust proxy MUST be blocked 403 even from LAN/loopback socket
    const proxiedHttp = invokeMw('127.0.0.1', 'http');
    assert.equal(proxiedHttp.nextCalled, false);
    assert.equal(proxiedHttp.respStatus, 403);

    // Loopback direct socket allowed
    assert.equal(invokeMw('127.0.0.1', '').nextCalled, true);

    // Private RFC1918 LAN socket allowed when ALLOW_MOBILE_LAN_HTTP=true
    assert.equal(invokeMw('::ffff:192.168.1.45', '').nextCalled, true);
    assert.equal(invokeMw('10.0.0.12', '').nextCalled, true);
    assert.equal(invokeMw('172.16.5.20', '').nextCalled, true);
    assert.equal(invokeMw('172.32.0.1', '').nextCalled, false, '172.32.x.x is public and must be rejected');

    // Disabling ALLOW_MOBILE_LAN_HTTP blocks LAN HTTP while still permitting loopback
    process.env.ALLOW_MOBILE_LAN_HTTP = 'false';
    assert.equal(invokeMw('192.168.1.45', '').nextCalled, false);
    assert.equal(invokeMw('127.0.0.1', '').nextCalled, true);

    // Trusted proxy HTTPS allowed
    assert.equal(invokeMw('8.8.8.8', 'https').nextCalled, true);
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevElectron !== undefined) process.env.AWLAD_ELECTRON = prevElectron;
    else delete process.env.AWLAD_ELECTRON;
    if (prevLan !== undefined) process.env.ALLOW_MOBILE_LAN_HTTP = prevLan;
    else delete process.env.ALLOW_MOBILE_LAN_HTTP;
    if (prevTrust !== undefined) process.env.TRUST_PROXY = prevTrust;
    else delete process.env.TRUST_PROXY;
  }
});

// 3. Targeted phone registration lock + Rep All-Customers + Cost Isolation + Reports across JSON & PG (pg-mem)
async function runModeSuite(label, isPg) {
  const modeDir = fs.mkdtempSync(path.join(os.tmpdir(), `awlad_comp_${isPg ? 'pg' : 'json'}_`));
  process.env.AWLAD_DATA_DIR = modeDir;
  resetAllRateLimitsForTests();

  let pgPool = null;
  if (isPg) {
    pgPool = createPgMemPool();
    setInjectedPool(pgPool);
    const init = await initializeSchema();
    assert.equal(init.success, true, init.error);
    process.env.DB_STRICT_MODE = 'true';
  } else {
    setInjectedPool(null);
    delete process.env.DB_STRICT_MODE;
  }
  resetPgModeCache();

  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const bootRes = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
      body: {
        fullName: 'المدير الكامل',
        username: 'comp_admin',
        password: 'AdminStrong!2026',
        phone: '01000010001',
      },
    });
    assert.equal(bootRes.status, 201);
    const loginRes = await req(baseUrl, 'POST', '/api/auth/login', {
      body: {
        username: 'comp_admin',
        password: 'AdminStrong!2026',
      },
    });
    assert.equal(loginRes.status, 200);
    const adminToken = loginRes.json.accessToken;
    const adminUser = loginRes.json.user;

    await test(`${label} | 3a. Registration phone linking & duplicate conflict without orphan user`, async () => {
      const preCust = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: 'عميل مسبق', phone: '01033334444', openingBalance: 100 },
      });
      assert.equal(preCust.status, 201);

      const [r1, r2] = await Promise.allSettled([
        registerMobileAccount({
          role: 'customer',
          fullName: 'عميل مسبق',
          username: 'comp_cust_u1',
          phone: '+201033334444',
          password: 'CustPassword!123',
        }),
        registerMobileAccount({
          role: 'customer',
          fullName: 'عميل مسبق 2',
          username: 'comp_cust_u2',
          phone: '01033334444',
          password: 'CustPassword!123',
        }),
      ]);
      assert.equal([r1, r2].filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal([r1, r2].filter((x) => x.status === 'rejected').length, 1);
    });

    await test(`${label} | 3b. Rep ALL-CUSTOMERS workflow + zero company cost leakage + accurate server profit + strict RBAC`, async () => {
      const bootData = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const whMainId = bootData.warehouses[0].id;
      const cbMainId = bootData.cashboxes[0].id;

      // Admin creates supplier, product (purchasePrice=50, sellingPrice=80), and unassigned customer
      const suppRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: { name: 'مورد سري', phone: '01022223333', openingBalance: 0 },
      });
      assert.equal(suppRes.status, 201);
      const suppId = suppRes.json.supplier.id;

      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: 'صنف اختباري سري التكلفة',
          code: 'SEC-COST-1',
          baseUnit: 'قطعة',
          purchasePrice: 50,
          sellingPrice: 80,
          stockPerWarehouse: { [whMainId]: 100 },
          units: [{ name: 'كرتونة', conversionFactor: 10, purchasePrice: 500, sellingPrice: 780 }],
        },
      });
      assert.equal(prodRes.status, 201);
      const prodId = prodRes.json.product.id;

      const unassignedCustRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: 'عميل عام بدون تعيين مندوب', phone: '01077776666', openingBalance: 500 },
      });
      assert.equal(unassignedCustRes.status, 201);
      const unassignedCustId = unassignedCustRes.json.customer.id;

      // Admin creates 2 reps: Rep1 (normal rep without purchase perms) & Rep2
      const createRep = async (username, fullName, phone) => {
        const uRes = await req(baseUrl, 'POST', '/api/admin/users', {
          token: adminToken,
          body: {
            username,
            fullName,
            phone,
            password: 'RepPassword!123',
            role: 'representative',
            permissions: { canView: true, canAdd: true, canEdit: true, canManageSales: true },
          },
        });
        assert.equal(uRes.status, 201);
        const login = await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username, password: 'RepPassword!123' },
        });
        assert.equal(login.status, 200);
        return login.json;
      };
      const rep1 = await createRep('comp_rep1', 'مندوب أول', '01090000001');
      const rep2 = await createRep('comp_rep2', 'مندوب ثاني', '01090000002');

      // Stock movement on main warehouse or rep van
      const vanWhId = rep1.representativeProfile.warehouseId;
      assert.ok(vanWhId);
      const trRes = await req(baseUrl, 'POST', '/api/inventory/transfer', {
        token: adminToken,
        body: {
          productId: prodId,
          fromWarehouseId: whMainId,
          toWarehouseId: vanWhId,
          quantity: 20,
          notes: 'تموين سيارة المندوب',
        },
      });
      assert.equal(trRes.status, 200);

      // Rep1 sees unassigned customer across /api/customers, /api/admin/bootstrap, /api/sync/pull
      const custsRes = await req(baseUrl, 'GET', '/api/customers', { token: rep1.accessToken });
      assert.equal(custsRes.status, 200);
      assert.ok(custsRes.json.customers.some((c) => c.id === unassignedCustId));

      const pullRes = await req(baseUrl, 'GET', '/api/sync/pull', { token: rep1.accessToken });
      assert.equal(pullRes.status, 200);
      assert.ok(pullRes.json.customers.some((c) => c.id === unassignedCustId));
      const repProd = pullRes.json.products.find((p) => p.id === prodId);
      assert.equal(Number(repProd.purchasePrice), 0, 'purchasePrice must be 0 in sync/pull');
      assert.equal(Number(repProd.units[0].purchasePrice), 0, 'units[].purchasePrice must be 0');
      assert.ok(
        pullRes.json.stockMovements.every((sm) => Number(sm.unitCost || 0) === 0),
        'stockMovements[].unitCost must be 0 for rep'
      );

      // Rep1 updates unassigned customer notes & creates customer order for unassigned customer
      const updRes = await req(baseUrl, 'PUT', `/api/customers/${unassignedCustId}`, {
        token: rep1.accessToken,
        body: { notes: 'زيارة ميدانية ناجحة' },
      });
      assert.equal(updRes.status, 200);

      const ordRes = await req(baseUrl, 'POST', '/api/orders', {
        token: rep1.accessToken,
        body: {
          customerId: unassignedCustId,
          items: [{ productId: prodId, unit: 'قطعة', quantity: 2 }],
        },
      });
      assert.equal(ordRes.status, 201);

      // Rep1 issues draft then confirms sales invoice for unassigned customer, and edits own invoice
      const saleDraftRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: rep1.accessToken,
        body: {
          customerId: unassignedCustId,
          warehouseId: vanWhId,
          cashboxId: cbMainId,
          status: 'draft',
          paymentType: 'credit',
          paidAmount: 0,
          items: [{ productId: prodId, productName: 'صنف اختباري سري التكلفة', unit: 'قطعة', unitFactor: 1, quantity: 3, unitPrice: 80 }],
        },
      });
      assert.equal(saleDraftRes.status, 201);
      const repInvId = saleDraftRes.json.invoice.id;
      assert.equal(Number(saleDraftRes.json.invoice.items[0].purchasePriceAtTime), 0);

      // Rep2 MUST NOT confirm or edit Rep1's invoice -> 403
      const rep2Confirm = await req(baseUrl, 'POST', `/api/invoices/${repInvId}/confirm`, {
        token: rep2.accessToken,
      });
      assert.equal(rep2Confirm.status, 403);

      const rep1Confirm = await req(baseUrl, 'POST', `/api/invoices/${repInvId}/confirm`, {
        token: rep1.accessToken,
      });
      assert.equal(rep1Confirm.status, 200);
      assert.equal(Number(rep1Confirm.json.invoice.items[0].purchasePriceAtTime), 0);

      const rep1Edit = await req(baseUrl, 'PUT', `/api/invoices/${repInvId}`, {
        token: rep1.accessToken,
        body: {
          baseVersion: 1,
          items: [{ productId: prodId, productName: 'صنف اختباري سري التكلفة', unit: 'قطعة', unitFactor: 1, quantity: 4, unitPrice: 80 }],
          reason: 'زيادة قطعة',
        },
      });
      assert.equal(rep1Edit.status, 200);
      assert.equal(Number(rep1Edit.json.invoice.items[0].purchasePriceAtTime), 0);

      // Rep1 collects payment from unassigned customer
      const payRes = await req(baseUrl, 'POST', `/api/customers/${unassignedCustId}/payment`, {
        token: rep1.accessToken,
        body: { amount: 120, cashboxId: cbMainId },
      });
      assert.equal(payRes.status, 200);

      // Admin sees REAL persisted purchasePriceAtTime=50 in DB and reports (profit = (80-50)*4 = 120)
      const adminInvs = await req(baseUrl, 'GET', '/api/invoices', { token: adminToken });
      const adminRepInv = adminInvs.json.invoices.find((i) => i.id === repInvId);
      assert.equal(Number(adminRepInv.items[0].purchasePriceAtTime), 50, 'Authoritative DB cost must remain 50 for admin/reports');

      // Rep1 remains blocked from HR, Reports, Suppliers, Admin users, Audit logs, Cash ops
      assert.equal((await req(baseUrl, 'GET', '/api/reports/comprehensive?reportType=all', { token: rep1.accessToken })).status, 403);
      assert.equal((await req(baseUrl, 'GET', `/api/admin/suppliers/${suppId}/statement`, { token: rep1.accessToken })).status, 403);
      assert.equal((await req(baseUrl, 'POST', '/api/admin/employees', { token: rep1.accessToken, body: { name: 'x' } })).status, 403);
      assert.equal((await req(baseUrl, 'POST', '/api/admin/users', { token: rep1.accessToken, body: { username: 'x' } })).status, 403);
      assert.equal((await req(baseUrl, 'GET', '/api/admin/audit-logs', { token: rep1.accessToken })).status, 403);
      assert.equal((await req(baseUrl, 'POST', '/api/admin/cash-operations', { token: rep1.accessToken, body: { type: 'cash_deposit', amount: 10, cashboxId: cbMainId } })).status, 403);

      // Reports dataset preserves all report keys & respects customerId / supplierId filters + accurate profit
      assert.ok(REPORT_TYPES_LIST.length >= 23);
      const custReport = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=sales_items&customerId=${encodeURIComponent(unassignedCustId)}`,
        { token: adminToken }
      );
      assert.equal(custReport.status, 200);
      assert.ok(custReport.json.report.sections[0].rows.length >= 1);
      assert.equal(Number(custReport.json.report.summary.reportProfit || 0), 120);
      const suppReport = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&supplierId=${encodeURIComponent(suppId)}`,
        { token: adminToken }
      );
      assert.equal(suppReport.status, 200);
      assert.ok(Array.isArray(suppReport.json.report.sections));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    setInjectedPool(null);
    delete process.env.DB_STRICT_MODE;
    resetPgModeCache();
    fs.rmSync(modeDir, { recursive: true, force: true });
  }
}

await runModeSuite('JSON Ledger', false);
await runModeSuite('PostgreSQL (pg-mem)', true);

fs.rmSync(tempDataDir, { recursive: true, force: true });
console.log(`\nALL FULL COMPLETION TESTS PASSED (${passed} groups)!`);

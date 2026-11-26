import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { newDb } from 'pg-mem';

// Isolate data directory & database mode BEFORE importing server modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_test_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_awlad_selim_erp_verification_2026_secure';
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
const { readJsonDatabase, writeJsonDatabase, createEmptyDatabaseState } = await import('../db/jsonLedger.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { runDataMigration, rollbackMigration } = await import('../db/migrator.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');

const LEGACY_SALT = 'awlad_selim_secure_salt_2026';

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
      'Content-Type': 'application/json',
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

function assertNoSensitiveFields(obj, contextLabel) {
  const s = JSON.stringify(obj || {});
  assert.ok(!s.includes('"passwordHash"'), `${contextLabel}: passwordHash leaked!`);
  assert.ok(!s.includes('"password_hash"'), `${contextLabel}: password_hash leaked!`);
}

function createPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();

  // pg-mem expects Pool-compatible .query() and .connect()
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

async function runSuiteA_JsonLedgerHttp() {
  console.log('\n=== Suite A: Security, Auth, RBAC, Lifecycle & Accounting (JSON Ledger HTTP API) ===');
  setInjectedPool(null);
  resetPgModeCache();
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await test('1. Health check & initial setup detection without auth', async () => {
      const h = await req(baseUrl, 'GET', '/api/health');
      assert.equal(h.status, 200);
      assert.equal(h.json.ok, true);
      assert.equal(h.json.needsAdminSetup, true);

      const st = await req(baseUrl, 'GET', '/api/auth/status');
      assert.equal(st.status, 200);
      assert.equal(st.json.needsAdminSetup, true);
    });

    await test('2. Unauthenticated requests rejected with 401 across all protected endpoints', async () => {
      const endpoints = [
        ['GET', '/api/database'],
        ['PUT', '/api/database'],
        ['GET', '/api/customers'],
        ['GET', '/api/customers/me'],
        ['GET', '/api/products'],
        ['GET', '/api/orders'],
        ['POST', '/api/orders'],
        ['GET', '/api/invoices'],
        ['POST', '/api/invoices/sales'],
        ['GET', '/api/admin/bootstrap'],
        ['GET', '/api/inventory/warehouses'],
      ];
      for (const [m, p] of endpoints) {
        const r = await req(baseUrl, m, p);
        assert.equal(r.status, 401, `Expected 401 on ${m} ${p}, got ${r.status}`);
      }
    });

    let adminToken = '';
    let adminRefresh = '';

    await test('3. Bootstrap initial owner admin once & block repeated bootstrap (403)', async () => {
      const r1 = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'طارق سليم',
          username: 'owner_tarek',
          password: 'OwnerStrongPassword!99',
          phone: '01000000001',
        },
      });
      assert.equal(r1.status, 201);
      assertNoSensitiveFields(r1.json, 'bootstrap-admin');

      const r2 = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'Hacker Admin',
          username: 'hacker',
          password: 'Password!123',
        },
      });
      assert.equal(r2.status, 403);
    });

    await test('4. Admin login returns JWT & never exposes passwordHash; logout revokes refresh token', async () => {
      const loginRes = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
      });
      assert.equal(loginRes.status, 200);
      assert.ok(loginRes.json.accessToken);
      assert.ok(loginRes.json.refreshToken);
      assertNoSensitiveFields(loginRes.json, 'admin login');

      adminToken = loginRes.json.accessToken;
      adminRefresh = loginRes.json.refreshToken;

      const refreshRes = await req(baseUrl, 'POST', '/api/auth/refresh', {
        body: { refreshToken: adminRefresh },
      });
      assert.equal(refreshRes.status, 200);
      assert.ok(refreshRes.json.accessToken);

      const logoutRes = await req(baseUrl, 'POST', '/api/auth/logout', {
        token: refreshRes.json.accessToken,
        body: { refreshToken: refreshRes.json.refreshToken },
      });
      assert.equal(logoutRes.status, 200);

      // Refresh with revoked token must fail
      const postLogoutRefresh = await req(baseUrl, 'POST', '/api/auth/refresh', {
        body: { refreshToken: refreshRes.json.refreshToken },
      });
      assert.equal(postLogoutRefresh.status, 401);

      // Log admin back in cleanly
      const loginAgain = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
      });
      assert.equal(loginAgain.status, 200);
      adminToken = loginAgain.json.accessToken;
    });

    await test('5. Rate limiter locks brute force after 10 failures (429) & legacy SHA-256 upgrades transparently to bcrypt', async () => {
      // Brute-force dummy username
      for (let i = 0; i < 10; i++) {
        const fail = await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'brute_target_user', password: 'wrong' },
        });
        assert.equal(fail.status, 401);
      }
      const locked = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'brute_target_user', password: 'wrong' },
      });
      assert.equal(locked.status, 429);

      // Seed a legacy SHA-256 user in database and verify auto-upgrade to bcrypt on login
      const legacyPw = 'LegacyPass!2026';
      const legacySha = crypto.createHash('sha256').update(legacyPw + LEGACY_SALT).digest('hex');
      const dbSnap = readJsonDatabase();
      dbSnap.users.push({
        id: 'USR-LEGACY-1',
        fullName: 'موظف قديم',
        username: 'legacy_staff',
        passwordHash: legacySha,
        phone: '01000000055',
        role: 'sales',
        jobTitle: 'مبيعات',
        department: 'المبيعات',
        isActive: true,
        permissions: { canView: true, canAdd: true, canManageSales: true },
        createdAt: new Date().toISOString(),
      });
      writeJsonDatabase(dbSnap);

      const legLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'legacy_staff', password: legacyPw },
      });
      assert.equal(legLogin.status, 200);
      assertNoSensitiveFields(legLogin.json, 'legacy login');

      const dbAfter = readJsonDatabase();
      const upgradedUser = dbAfter.users.find((u) => u.id === 'USR-LEGACY-1');
      assert.ok(upgradedUser.passwordHash.startsWith('$2'), 'Legacy hash should upgrade to bcrypt!');
    });

    let prod1, custA, custB, tokenCustA, tokenCustB, tokenStaffRestricted;
    let whMainId, cashboxMainId;

    await test('6. Setup products, stock, customers with 1:1 user links, and restricted staff', async () => {
      const boot = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(boot.status, 200);
      assertNoSensitiveFields(boot.json, 'admin bootstrap');
      whMainId = boot.json.data.warehouses[0].id;
      cashboxMainId = boot.json.data.cashboxes[0].id;

      // Create Product with baseUnit 'قطعة' and additional unit 'كرتونة' (factor 12) + initial stock 100
      const pRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'P-100',
          barcode: '622000100',
          name: 'شيبسي عائلي ملح',
          category: 'شيبسيات ومقرمشات',
          baseUnit: 'قطعة',
          units: [{ id: 'u1', name: 'كرتونة', conversionFactor: 12, sellingPrice: 120, purchasePrice: 80 }],
          purchasePrice: 7,
          sellingPrice: 11,
          minStockLevel: 10,
          stockPerWarehouse: { [whMainId]: 100 },
          status: 'active',
        },
      });
      assert.equal(pRes.status, 201);
      prod1 = pRes.json.product;

      // Create Customer A & Customer B (shared phone intentionally to ensure phone never cross-links!)
      const cARes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: {
          code: 'C-001',
          name: 'الحاج أحمد',
          shopName: 'سوبرماركت البركة',
          phone: '01234567890',
          address: 'شارع النصر - طنطا',
          geoCoordinates: '30.7865, 31.0004',
        },
      });
      assert.equal(cARes.status, 201);
      custA = cARes.json.customer;

      const cBRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: {
          code: 'C-002',
          name: 'سعيد التجاري',
          shopName: 'أسواق السلام',
          phone: '01234567890',
          address: 'شارع الجيش - المنصورة',
        },
      });
      assert.equal(cBRes.status, 201);
      custB = cBRes.json.customer;

      // Link Customer A & B 1:1
      const linkA = await req(baseUrl, 'POST', `/api/customers/${custA.id}/link-user`, {
        token: adminToken,
        body: { createUser: { username: 'cust_baraka', password: 'CustomerPassword!1', phone: custA.phone } },
      });
      assert.equal(linkA.status, 200);
      assert.equal(linkA.json.customer.userId, linkA.json.user.id);

      const linkB = await req(baseUrl, 'POST', `/api/customers/${custB.id}/link-user`, {
        token: adminToken,
        body: { createUser: { username: 'cust_salam', password: 'CustomerPassword!2', phone: custB.phone } },
      });
      assert.equal(linkB.status, 200);

      // Login A, B, and Legacy Restricted Staff
      tokenCustA = (await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'cust_baraka', password: 'CustomerPassword!1' },
      })).json.accessToken;
      tokenCustB = (await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'cust_salam', password: 'CustomerPassword!2' },
      })).json.accessToken;
      tokenStaffRestricted = (await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'legacy_staff', password: 'LegacyPass!2026' },
      })).json.accessToken;
    });

    await test('7. RBAC, isolation & stripped sensitive catalog fields enforced on server', async () => {
      // Customer blocked from admin/staff endpoints
      for (const pathCheck of ['/api/database', '/api/customers', '/api/invoices', '/api/admin/bootstrap']) {
        const r = await req(baseUrl, 'GET', pathCheck, { token: tokenCustA });
        assert.equal(r.status, 403, `Customer should get 403 on ${pathCheck}, got ${r.status}`);
      }

      // Restricted staff blocked from /api/database and /api/admin/users
      const staffDb = await req(baseUrl, 'GET', '/api/database', { token: tokenStaffRestricted });
      assert.equal(staffDb.status, 403);
      const staffUsers = await req(baseUrl, 'POST', '/api/admin/users', {
        token: tokenStaffRestricted,
        body: { username: 'u_x', fullName: 'X', password: 'Password!123', role: 'sales' },
      });
      assert.equal(staffUsers.status, 403);

      // Customer catalog strips purchasePrice, stockPerWarehouse, minStockLevel
      const cat = await req(baseUrl, 'GET', '/api/products', { token: tokenCustA });
      assert.equal(cat.status, 200);
      assert.equal(cat.json.products.length, 1);
      assert.equal(cat.json.products[0].purchasePrice, undefined);
      assert.equal(cat.json.products[0].stockPerWarehouse, undefined);
      assert.equal(cat.json.products[0].minStockLevel, undefined);
      assert.equal(cat.json.products[0].units[0].purchasePrice, undefined);
    });

    let orderA, orderB_rejected;

    await test('8. Customer order spoofing defense + cross-customer isolation + zero stock/balance side effects', async () => {
      const beforeProd = (await req(baseUrl, 'GET', '/api/products', { token: adminToken })).json.products[0];
      const beforeCust = (await req(baseUrl, 'GET', `/api/customers/${custA.id}`, { token: adminToken })).json.customer;
      assert.equal(beforeProd.stockPerWarehouse[whMainId], 100);
      assert.equal(beforeCust.currentBalance, 0);

      // Customer A sends order trying to spoof customerId: custB.id & unitPrice: 1
      const ordRes = await req(baseUrl, 'POST', '/api/orders', {
        token: tokenCustA,
        headers: { 'Idempotency-Key': 'idem-key-order-A-1' },
        body: {
          customerId: custB.id, // SPOOF ATTEMPT
          customerPhone: '01234567890',
          shopName: 'سوبرماركت البركة',
          deliveryAddress: 'شارع النصر - طنطا',
          geoCoordinates: '30.7865, 31.0004',
          items: [{ productId: prod1.id, unit: 'كرتونة', quantity: 2, unitPrice: 1 }],
          notes: 'تسليم صباحاً',
        },
      });
      assert.equal(ordRes.status, 201);
      orderA = ordRes.json.order;
      assert.equal(orderA.customerId, custA.id, 'Server MUST bind order strictly to Cust A profile!');
      assert.equal(orderA.items[0].unitPrice, 120, 'Server MUST use authoritative reference unit price!');
      assert.ok(orderA.requestNumber.startsWith('COR-'));
      assert.equal(orderA.status, 'pending');
      assert.equal(orderA.statusHistory.length, 1);

      // Repeat with same Idempotency-Key -> deduplicated 200 returning same order
      const dupRes = await req(baseUrl, 'POST', '/api/orders', {
        token: tokenCustA,
        headers: { 'Idempotency-Key': 'idem-key-order-A-1' },
        body: {
          items: [{ productId: prod1.id, unit: 'كرتونة', quantity: 2 }],
        },
      });
      assert.equal(dupRes.status, 200);
      assert.equal(dupRes.json.deduplicated, true);
      assert.equal(dupRes.json.order.id, orderA.id);

      // Customer B cannot read Customer A's order!
      const bReadA = await req(baseUrl, 'GET', `/api/orders/${orderA.id}`, { token: tokenCustB });
      assert.equal(bReadA.status, 403);
      const bList = await req(baseUrl, 'GET', '/api/orders', { token: tokenCustB });
      assert.equal(bList.status, 200);
      assert.equal(bList.json.orders.length, 0);

      // Stock and customer balance remain untouched while pending
      const afterProd = (await req(baseUrl, 'GET', '/api/products', { token: adminToken })).json.products[0];
      assert.equal(afterProd.stockPerWarehouse[whMainId], 100);
    });

    await test('9. Order reject requires mandatory reason & blocks re-approval; approve keeps stock unchanged until invoice confirmed', async () => {
      // Create order to reject
      const ord2 = await req(baseUrl, 'POST', '/api/orders', {
        token: tokenCustA,
        body: { items: [{ productId: prod1.id, unit: 'قطعة', quantity: 5 }] },
      });
      orderB_rejected = ord2.json.order;

      const badReject = await req(baseUrl, 'POST', `/api/orders/${orderB_rejected.id}/reject`, {
        token: adminToken,
        body: { reason: '   ' },
      });
      assert.equal(badReject.status, 400);

      const goodReject = await req(baseUrl, 'POST', `/api/orders/${orderB_rejected.id}/reject`, {
        token: adminToken,
        body: { reason: 'الكمية غير متوفرة حالياً' },
      });
      assert.equal(goodReject.status, 200);
      assert.equal(goodReject.json.order.status, 'rejected');

      const reApproveRejected = await req(baseUrl, 'POST', `/api/orders/${orderB_rejected.id}/approve`, {
        token: adminToken,
        body: {},
      });
      assert.equal(reApproveRejected.status, 409);

      // Approve order A
      const appRes = await req(baseUrl, 'POST', `/api/orders/${orderA.id}/approve`, {
        token: adminToken,
        body: { notes: 'معتمد للتحويل' },
      });
      assert.equal(appRes.status, 200);
      assert.equal(appRes.json.order.status, 'approved');

      // Repeated approve -> 409
      const reApprove = await req(baseUrl, 'POST', `/api/orders/${orderA.id}/approve`, {
        token: adminToken,
        body: {},
      });
      assert.equal(reApprove.status, 409);

      // Stock still 100 when order is approved!
      const pCheck = (await req(baseUrl, 'GET', '/api/products', { token: adminToken })).json.products[0];
      assert.equal(pCheck.stockPerWarehouse[whMainId], 100);
    });

    let draftInv;

    await test('10. Convert approved order to DRAFT invoice (0 stock/balance impact), block 2nd conversion (409), then CONFIRM once', async () => {
      // Convert order A (2 cartons * 12 = 24 pieces) to a DRAFT credit invoice
      const convRes = await req(baseUrl, 'POST', `/api/orders/${orderA.id}/convert-to-invoice`, {
        token: adminToken,
        body: {
          warehouseId: whMainId,
          warehouseName: 'المستودع الرئيسي',
          cashboxId: cashboxMainId,
          status: 'draft',
          paymentType: 'credit',
          paidAmount: 0,
          discountTotal: 0,
          items: [
            {
              productId: prod1.id,
              productName: prod1.name,
              unit: 'كرتونة',
              unitFactor: 12,
              quantity: 2,
              unitPrice: 125,
            },
          ],
        },
      });
      assert.equal(convRes.status, 201);
      draftInv = convRes.json.invoice;
      assert.equal(draftInv.status, 'draft');
      assert.equal(draftInv.grandTotal, 250);
      assert.equal(convRes.json.order.status, 'invoiced');

      // Repeated conversion -> 409
      const doubleConv = await req(baseUrl, 'POST', `/api/orders/${orderA.id}/convert-to-invoice`, {
        token: adminToken,
        body: { warehouseId: whMainId },
      });
      assert.equal(doubleConv.status, 409);

      // DRAFT invoice MUST NOT touch stock or customer balance!
      const bootDraft = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootDraft.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId], 100);
      assert.equal(bootDraft.customers.find((c) => c.id === custA.id).currentBalance, 0);

      // Confirm draft invoice -> deducts 24 pieces (100 -> 76) and adds 250 to custA balance
      const confRes = await req(baseUrl, 'POST', `/api/invoices/${draftInv.id}/confirm`, {
        token: adminToken,
      });
      assert.equal(confRes.status, 200);
      assert.equal(confRes.json.invoice.status, 'confirmed');

      // Double confirm blocked -> 409
      const doubleConf = await req(baseUrl, 'POST', `/api/invoices/${draftInv.id}/confirm`, {
        token: adminToken,
      });
      assert.equal(doubleConf.status, 409);

      const bootConfirmed = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const updatedProd = bootConfirmed.products.find((p) => p.id === prod1.id);
      const updatedCust = bootConfirmed.customers.find((c) => c.id === custA.id);
      assert.equal(updatedProd.stockPerWarehouse[whMainId], 76, 'Stock should decrease by 2*12=24 once');
      assert.equal(updatedCust.currentBalance, 250, 'Customer balance should increase by 250 once');
      assert.ok(
        (updatedCust.priceHistory[prod1.id] || []).some((entry) => (typeof entry === 'number' ? entry : entry.price) === 125)
      );
    });

    await test('11. Insufficient stock rollback + Return respects unitFactor + Cancel reverses confirmed invoice', async () => {
      // Insufficient stock must fail cleanly without partial updates
      const badInv = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId: custB.id,
          warehouseId: whMainId,
          cashboxId: cashboxMainId,
          status: 'confirmed',
          paymentType: 'cash',
          paidAmount: 9900,
          items: [
            { productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 900, unitPrice: 11 },
          ],
        },
      });
      assert.ok(badInv.status === 409 || badInv.status === 400);

      // Stock still 76 and cashbox still 0
      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId], 76);
      assert.equal(boot.cashboxes.find((c) => c.id === cashboxMainId).currentBalance, 0);

      // Partial Return of 1 carton (unitFactor 12 -> restores 12 pieces: 76 -> 88; balance 250 -> 125)
      const retRes = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: adminToken,
        body: {
          type: 'sales_return',
          originalInvoiceId: draftInv.id,
          originalInvoiceNumber: draftInv.invoiceNumber,
          partyId: custA.id,
          partyName: custA.name,
          warehouseId: whMainId,
          warehouseName: 'المستودع الرئيسي',
          refundType: 'balance',
          reason: 'زيادة عن حاجة المحل',
          items: [
            { productId: prod1.id, productName: prod1.name, unit: 'كرتونة', unitFactor: 12, quantity: 1, unitPrice: 125, total: 125 },
          ],
          grandTotal: 125,
        },
      });
      assert.equal(retRes.status, 201);
      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId], 88);
      assert.equal(boot.customers.find((c) => c.id === custA.id).currentBalance, 125);

      // Direct cash invoice + cancellation reverses stock and cashbox cleanly
      const cashInvRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId: custB.id,
          warehouseId: whMainId,
          cashboxId: cashboxMainId,
          status: 'confirmed',
          paymentType: 'cash',
          paidAmount: 55,
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 5, unitPrice: 11 }],
        },
      });
      assert.equal(cashInvRes.status, 201);
      const cashInv = cashInvRes.json.invoice;
      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId], 83);
      assert.equal(boot.cashboxes.find((c) => c.id === cashboxMainId).currentBalance, 55);

      const cancelRes = await req(baseUrl, 'POST', `/api/invoices/${cashInv.id}/cancel`, {
        token: adminToken,
        body: { reason: 'خطأ في الكمية' },
      });
      assert.equal(cancelRes.status, 200);
      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId], 88);
      assert.equal(boot.cashboxes.find((c) => c.id === cashboxMainId).currentBalance, 0);
    });

    await test('12. Concurrency safety: 10 simultaneous customer orders create 10 distinct sequential orders', async () => {
      const promises = Array.from({ length: 10 }, (_, idx) =>
        req(baseUrl, 'POST', '/api/orders', {
          token: tokenCustA,
          body: {
            items: [{ productId: prod1.id, unit: 'قطعة', quantity: idx + 1 }],
            notes: `طلب متزامن #${idx + 1}`,
          },
        })
      );
      const responses = await Promise.all(promises);
      for (const r of responses) {
        assert.equal(r.status, 201);
      }
      const numbers = new Set(responses.map((r) => r.json.order.requestNumber));
      assert.equal(numbers.size, 10, 'All 10 concurrent orders must have unique sequential request numbers!');

      const allCustAOrders = (await req(baseUrl, 'GET', '/api/orders', { token: tokenCustA })).json.orders;
      assert.equal(allCustAOrders.length, 12); // 1 initial + 1 rejected + 10 concurrent
    });

    await test('13. Backup export & restore roundtrip works securely', async () => {
      const exp = await req(baseUrl, 'GET', '/api/admin/backup/export', { token: adminToken });
      assert.equal(exp.status, 200);
      assert.ok(Array.isArray(exp.json.backup.products));

      const rest = await req(baseUrl, 'POST', '/api/admin/backup/restore', {
        token: adminToken,
        body: { backup: exp.json.backup },
      });
      assert.equal(rest.status, 200);
      assert.equal(rest.json.ok, true);

      // Verify live migration refuses safely when PostgreSQL is not configured yet
      const migBlocked = await req(baseUrl, 'POST', '/api/admin/migration/run', {
        token: adminToken,
        body: {},
      });
      assert.equal(migBlocked.status, 400);
      assert.equal(migBlocked.json.code, 'POSTGRES_NOT_READY');
    });

    let whSecondId, cashboxSecondId, personalAccId;

    await test('17. Cash operations, idempotency, insufficient cashbox guard, extraSettings & category global rename', async () => {
      // Create 2nd cashbox for transfer test
      const cb2Res = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: adminToken,
        body: { name: 'حساب بنكي تجريبي', type: 'bank', openingBalance: 0 },
      });
      assert.equal(cb2Res.status, 201);
      cashboxSecondId = cb2Res.json.cashbox.id;

      // Deposit 1000 into main cashbox with Idempotency-Key
      const dep1 = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        headers: { 'Idempotency-Key': 'cashop-dep-1' },
        body: { type: 'cash_deposit', cashboxId: cashboxMainId, amount: 1000, category: 'توريد رأس مال', notes: 'دفعة أولى' },
      });
      assert.equal(dep1.status, 201);
      assert.equal(dep1.json.deduplicated, false);

      // Duplicate key returns 200 deduplicated without changing balance again
      const depDup = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        headers: { 'Idempotency-Key': 'cashop-dep-1' },
        body: { type: 'cash_deposit', cashboxId: cashboxMainId, amount: 1000 },
      });
      assert.equal(depDup.status, 200);
      assert.equal(depDup.json.deduplicated, true);

      // Transfer 300 from main cashbox to second cashbox
      const trRes = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        body: { type: 'cashbox_transfer', cashboxId: cashboxMainId, targetCashboxId: cashboxSecondId, amount: 300, notes: 'ترحيل للبنك' },
      });
      assert.equal(trRes.status, 201);

      // Expense 200 from main cashbox
      const expRes = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        body: { type: 'expense', cashboxId: cashboxMainId, amount: 200, category: 'كهرباء ومياه', recipientOrPayer: 'شركة الكهرباء' },
      });
      assert.equal(expRes.status, 201);
      assert.ok(expRes.json.expenseIncomeRecord);

      // Profit deposit 150 into main cashbox
      const profRes = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        body: { type: 'profit_deposit', cashboxId: cashboxMainId, amount: 150, category: 'أرباح توزيع', recipientOrPayer: 'شريك' },
      });
      assert.equal(profRes.status, 201);

      // Withdrawal 50 from main cashbox
      const wRes = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        body: { type: 'cash_withdrawal', cashboxId: cashboxMainId, amount: 50, notes: 'مصروف نثري' },
      });
      assert.equal(wRes.status, 201);

      // Insufficient balance guard -> 409 (main cashbox has 1000 - 300 - 200 + 150 - 50 = 600)
      const overDraw = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        body: { type: 'cash_withdrawal', cashboxId: cashboxMainId, amount: 5000 },
      });
      assert.equal(overDraw.status, 409);

      const bootCheck = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootCheck.cashboxes.find((c) => c.id === cashboxMainId).currentBalance, 600);
      assert.equal(bootCheck.cashboxes.find((c) => c.id === cashboxSecondId).currentBalance, 300);

      // Update extraSettings via /api/admin/settings
      const setRes = await req(baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: { extraSettings: { barcodePrefix: 'AS-2026', unitsCatalog: ['قطعة', 'كرتونة', 'طرد'] } },
      });
      assert.equal(setRes.status, 200);
      assert.equal(setRes.json.settings.extraSettings.barcodePrefix, 'AS-2026');

      // Seed category in JSON & rename globally
      const dbBeforeCat = readJsonDatabase();
      const catId = dbBeforeCat.categories[0]?.id || 'CAT-1';
      if (!dbBeforeCat.categories.length) {
        dbBeforeCat.categories.push({ id: catId, name: 'شيبسيات ومقرمشات' });
        writeJsonDatabase(dbBeforeCat);
      } else {
        dbBeforeCat.categories[0].name = 'شيبسيات ومقرمشات';
        writeJsonDatabase(dbBeforeCat);
      }
      const renRes = await req(baseUrl, 'POST', `/api/inventory/categories/${catId}/rename`, {
        token: adminToken,
        body: { name: 'سناكس ومقرمشات' },
      });
      assert.equal(renRes.status, 200);
      assert.equal(renRes.json.category.newName, 'سناكس ومقرمشات');
      const prodAfterRen = (await req(baseUrl, 'GET', '/api/products', { token: adminToken })).json.products[0];
      assert.equal(prodAfterRen.category, 'سناكس ومقرمشات');
    });

    await test('18. Owner personal accounts isolated ledger, optional cashbox link, adjustment RBAC & audited edit', async () => {
      // Create owner personal account
      const accRes = await req(baseUrl, 'POST', '/api/personal-accounts', {
        token: adminToken,
        body: { ownerName: 'طارق سليم', accountName: 'جاري المالك الرئيسي', openingBalance: 500 },
      });
      assert.equal(accRes.status, 201);
      personalAccId = accRes.json.account.id;
      assert.equal(accRes.json.account.currentBalance, 500);

      // Verify operational cashbox unchanged by personal opening balance
      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.cashboxes.find((c) => c.id === cashboxMainId).currentBalance, 600);

      // Unlinked personal deposit (does NOT affect operational cashbox)
      const unlinkedDep = await req(baseUrl, 'POST', `/api/personal-accounts/${personalAccId}/transactions`, {
        token: adminToken,
        body: { type: 'personal_deposit', amount: 250, notes: 'إيداع شخصي منفصل' },
      });
      assert.equal(unlinkedDep.status, 201);
      assert.equal(unlinkedDep.json.account.currentBalance, 750);
      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.cashboxes.find((c) => c.id === cashboxMainId).currentBalance, 600);

      // Cashbox-linked personal withdrawal with Idempotency-Key (reduces BOTH personal & cashbox ONCE)
      const linkedW = await req(baseUrl, 'POST', `/api/personal-accounts/${personalAccId}/transactions`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'pers-tx-1' },
        body: { type: 'personal_withdrawal', amount: 100, cashboxId: cashboxMainId, notes: 'مسحوبات من الخزينة' },
      });
      assert.equal(linkedW.status, 201);
      assert.equal(linkedW.json.account.currentBalance, 650);

      const linkedDup = await req(baseUrl, 'POST', `/api/personal-accounts/${personalAccId}/transactions`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'pers-tx-1' },
        body: { type: 'personal_withdrawal', amount: 100, cashboxId: cashboxMainId },
      });
      assert.equal(linkedDup.status, 200);
      assert.equal(linkedDup.json.deduplicated, true);

      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.cashboxes.find((c) => c.id === cashboxMainId).currentBalance, 500);

      // Editing personal tx requires mandatory reason
      const txId = linkedW.json.transaction.id;
      const badEdit = await req(baseUrl, 'PUT', `/api/personal-accounts/transactions/${txId}`, {
        token: adminToken,
        body: { amount: 120, reason: '  ' },
      });
      assert.equal(badEdit.status, 400);

      const goodEdit = await req(baseUrl, 'PUT', `/api/personal-accounts/transactions/${txId}`, {
        token: adminToken,
        body: { amount: 150, reason: 'تصحيح قيمة المسحوبات الشخصية' },
      });
      assert.equal(goodEdit.status, 200);
      assert.equal(goodEdit.json.account.currentBalance, 600);
      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.cashboxes.find((c) => c.id === cashboxMainId).currentBalance, 450);

      // Staff with create/edit personal tx but WITHOUT canApprovePersonalAdjustment gets 403 on 'adjustment'
      const staffPersonalRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          username: 'personal_clerk',
          fullName: 'محاسب شخصي',
          password: 'Password!123',
          role: 'accountant',
          permissions: {
            canView: true,
            canViewPersonalAccounts: true,
            canCreatePersonalTx: true,
            canEditPersonalTx: true,
            canApprovePersonalAdjustment: false,
          },
        },
      });
      assert.equal(staffPersonalRes.status, 201);
      const tokenPersonalClerk = (await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'personal_clerk', password: 'Password!123' },
      })).json.accessToken;

      const forbiddenAdj = await req(baseUrl, 'POST', `/api/personal-accounts/${personalAccId}/transactions`, {
        token: tokenPersonalClerk,
        body: { type: 'adjustment', amount: -50, reason: 'تسوية غير مصرحة' },
      });
      assert.equal(forbiddenAdj.status, 403);
    });

    await test('19. Stock count draft -> mid-count divergence 409 guard -> apply_delta approval & double-approve block', async () => {
      // Current stock for prod1 in whMainId is 88
      const cntRes = await req(baseUrl, 'POST', '/api/stock-counts', {
        token: adminToken,
        body: {
          warehouseId: whMainId,
          items: [{ productId: prod1.id, actualQty: 85, reason: 'عجز 3 قطع أثناء الجرد' }],
          notes: 'جرد دوري',
        },
      });
      assert.equal(cntRes.status, 201);
      const countId = cntRes.json.count.id;
      assert.equal(cntRes.json.count.status, 'draft');
      assert.equal(cntRes.json.count.items[0].varianceQty, -3);

      // Draft count must NOT change stock
      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId], 88);

      // Submit count
      const subRes = await req(baseUrl, 'POST', `/api/stock-counts/${countId}/submit`, { token: adminToken });
      assert.equal(subRes.status, 200);
      assert.equal(subRes.json.count.status, 'submitted');

      // Sell 2 pieces externally while count is awaiting approval (88 -> 86)
      const midSale = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId: custB.id,
          warehouseId: whMainId,
          cashboxId: cashboxMainId,
          status: 'confirmed',
          paymentType: 'cash',
          paidAmount: 22,
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 2, unitPrice: 11 }],
        },
      });
      assert.equal(midSale.status, 201);

      // Approve without reconcileMode -> 409 COUNT_STOCK_CHANGED_DURING_COUNT!
      const conflictApp = await req(baseUrl, 'POST', `/api/stock-counts/${countId}/approve`, {
        token: adminToken,
        body: {},
      });
      assert.equal(conflictApp.status, 409);
      assert.equal(conflictApp.json.code, 'COUNT_STOCK_CHANGED_DURING_COUNT');

      // Approve with reconcileMode: 'apply_delta' -> applies variance (-3) to live stock (86 -> 83)
      const okApp = await req(baseUrl, 'POST', `/api/stock-counts/${countId}/approve`, {
        token: adminToken,
        body: { reconcileMode: 'apply_delta', notes: 'اعتماد بفارق الجرد الفعلي' },
      });
      assert.equal(okApp.status, 200);
      assert.equal(okApp.json.count.status, 'approved');

      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId], 83);

      // Double-approve -> 409
      const doubleApp = await req(baseUrl, 'POST', `/api/stock-counts/${countId}/approve`, {
        token: adminToken,
        body: { reconcileMode: 'apply_delta' },
      });
      assert.equal(doubleApp.status, 409);
    });

    await test('20. Multi-item stock transfer workflow (draft -> submit -> approve -> execute) & guards', async () => {
      // Create 2nd warehouse
      const wh2Res = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
        token: adminToken,
        body: { name: 'مخزن الفرع الثاني', location: 'طنطا', managerName: 'مسؤول الفرع' },
      });
      assert.equal(wh2Res.status, 201);
      whSecondId = wh2Res.json.warehouse.id;

      // Request transfer of 1 carton (12 pieces) from whMainId (83) to whSecondId (0)
      const trReq = await req(baseUrl, 'POST', '/api/stock-transfers', {
        token: adminToken,
        body: {
          sourceWarehouseId: whMainId,
          targetWarehouseId: whSecondId,
          reason: 'تغذية الفرع الثاني',
          items: [{ productId: prod1.id, unit: 'كرتونة', unitFactor: 12, requestedQty: 1 }],
        },
      });
      assert.equal(trReq.status, 201);
      const transferId = trReq.json.transfer.id;

      // Executing before approval -> 409
      const prematureExec = await req(baseUrl, 'POST', `/api/stock-transfers/${transferId}/execute`, { token: adminToken });
      assert.equal(prematureExec.status, 409);

      const subRes = await req(baseUrl, 'POST', `/api/stock-transfers/${transferId}/submit`, { token: adminToken });
      assert.equal(subRes.status, 200);
      assert.equal(subRes.json.transfer.status, 'submitted');

      const appRes = await req(baseUrl, 'POST', `/api/stock-transfers/${transferId}/approve`, { token: adminToken, body: {} });
      assert.equal(appRes.status, 200);
      assert.equal(appRes.json.transfer.status, 'approved');

      const execRes = await req(baseUrl, 'POST', `/api/stock-transfers/${transferId}/execute`, { token: adminToken });
      assert.equal(execRes.status, 200);
      assert.equal(execRes.json.transfer.status, 'executed');

      // Double execute -> 409
      const dupExec = await req(baseUrl, 'POST', `/api/stock-transfers/${transferId}/execute`, { token: adminToken });
      assert.equal(dupExec.status, 409);

      const boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const p = boot.products.find((x) => x.id === prod1.id);
      assert.equal(p.stockPerWarehouse[whMainId], 71); // 83 - 12
      assert.equal(p.stockPerWarehouse[whSecondId], 12);

      // Insufficient stock execution -> 409
      const bigTr = await req(baseUrl, 'POST', '/api/stock-transfers', {
        token: adminToken,
        body: {
          sourceWarehouseId: whMainId,
          targetWarehouseId: whSecondId,
          items: [{ productId: prod1.id, unit: 'قطعة', unitFactor: 1, requestedQty: 999 }],
        },
      });
      await req(baseUrl, 'POST', `/api/stock-transfers/${bigTr.json.transfer.id}/approve`, { token: adminToken, body: {} });
      const bigExec = await req(baseUrl, 'POST', `/api/stock-transfers/${bigTr.json.transfer.id}/execute`, { token: adminToken });
      assert.equal(bigExec.status, 409);
    });

    await test('21. Granular RBAC blocks restricted staff from new personal accounts, stock counts & stock transfers APIs', async () => {
      const checks = [
        ['GET', '/api/personal-accounts'],
        ['POST', '/api/personal-accounts'],
        ['POST', '/api/stock-counts'],
        ['POST', '/api/stock-transfers'],
        ['POST', '/api/admin/cash-operations'],
      ];
      for (const [m, p] of checks) {
        const r = await req(baseUrl, m, p, {
          token: tokenStaffRestricted,
          body: m === 'GET' ? undefined : {},
        });
        assert.equal(r.status, 403, `Restricted staff should get 403 on ${m} ${p}, got ${r.status}`);
      }
    });

    let repProfileId, repUserId, tokenRep, repVanWhId;

    await test('23. Capacitor CORS preflight headers allow Android/iOS origins cleanly', async () => {
      for (const origin of ['capacitor://localhost', 'https://localhost', 'http://localhost']) {
        const optRes = await fetch(`${baseUrl}/api/health`, {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'Authorization, Content-Type',
          },
        });
        assert.ok(optRes.status >= 200 && optRes.status < 300, `CORS preflight failed for ${origin}`);
        assert.equal(optRes.headers.get('access-control-allow-origin'), origin);
      }
    });

    await test('24. Representative accesses ALL customers (including unassigned) while company purchase costs and HR/admin data remain stripped/blocked', async () => {
      // Create representative user account
      const repUserRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          username: 'rep_karim',
          fullName: 'كريم المندوب',
          password: 'RepPassword!123',
          phone: '01099998888',
          role: 'representative',
          jobTitle: 'مندوب مبيعات',
          department: 'المناديب',
          permissions: {
            canView: true,
            canAdd: true,
            canManageSales: true,
            canManageReps: false,
            canManageTransfers: false,
          },
        },
      });
      assert.equal(repUserRes.status, 201);
      repUserId = repUserRes.json.user.id;

      // Create representative profile linked 1:1 to userId
      const repProfRes = await req(baseUrl, 'POST', '/api/admin/representatives', {
        token: adminToken,
        body: {
          name: 'كريم المندوب',
          phone: '01099998888',
          userId: repUserId,
          openingBalance: 0,
        },
      });
      assert.equal(repProfRes.status, 201);
      repProfileId = repProfRes.json.representative.id;

      // Assign custA as preferred rep metadata while custB remains completely unassigned
      const updCustARes = await req(baseUrl, 'PUT', `/api/customers/${custA.id}`, {
        token: adminToken,
        body: { allowedRepIds: [repProfileId], assignedRepId: repProfileId },
      });
      assert.equal(updCustARes.status, 200);

      const repLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'rep_karim', password: 'RepPassword!123' },
      });
      assert.equal(repLogin.status, 200);
      tokenRep = repLogin.json.accessToken;

      // /api/customers & /api/admin/bootstrap return ALL customers (both custA & unassigned custB)
      const repCustList = await req(baseUrl, 'GET', '/api/customers', { token: tokenRep });
      assert.equal(repCustList.status, 200);
      const repCustIds = repCustList.json.customers.map((c) => c.id);
      assert.ok(repCustIds.includes(custA.id) && repCustIds.includes(custB.id), 'Rep must see all customers');

      const repBoot = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: tokenRep });
      assert.equal(repBoot.status, 200);
      const repBootCustIds = repBoot.json.data.customers.map((c) => c.id);
      assert.ok(repBootCustIds.includes(custA.id) && repBootCustIds.includes(custB.id), 'Bootstrap must include all customers for rep');
      assert.ok(
        repBoot.json.data.products.every((p) => Number(p.purchasePrice || 0) === 0),
        'Company purchasePrice must be stripped (0) for representatives'
      );

      // Unassigned custB is accessible for viewing, price history, and draft sales invoice
      assert.equal((await req(baseUrl, 'GET', `/api/customers/${custB.id}`, { token: tokenRep })).status, 200);
      assert.equal((await req(baseUrl, 'GET', `/api/customers/${custB.id}/price-history`, { token: tokenRep })).status, 200);
      const allowedDraftForCustB = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: tokenRep,
        body: {
          customerId: custB.id,
          warehouseId: whMainId,
          cashboxId: cashboxMainId,
          status: 'draft',
          paymentType: 'credit',
          paidAmount: 0,
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 1, unitPrice: 11 }],
        },
      });
      assert.equal(allowedDraftForCustB.status, 201);
      assert.equal(
        Number(allowedDraftForCustB.json.invoice.items[0].purchasePriceAtTime || 0),
        0,
        'Rep sales invoice response must strip company purchasePriceAtTime'
      );

      // Allowed custA price history returns structured dates & prices
      const phRes = await req(baseUrl, 'GET', `/api/customers/${custA.id}/price-history`, { token: tokenRep });
      assert.equal(phRes.status, 200);
      const prod1History = phRes.json.priceHistory[prod1.id] || [];
      assert.ok(prod1History.length >= 1, 'Expected last selling prices for custA');
      assert.equal(Number(prod1History[0].price), 125);
      assert.ok(Boolean(prod1History[0].date), 'Price history entry should include invoice date');
    });

    await test('25. Rep shortage draft + linked transfer: blocks rep approve/execute (403), confirms draft once after admin executes', async () => {
      // Create or fetch rep van warehouse (initially 0 stock of prod1)
      const vanRes = await req(baseUrl, 'POST', '/api/inventory/rep-van-warehouse', {
        token: tokenRep,
        body: { repName: 'كريم المندوب' },
      });
      assert.equal(vanRes.status, 200);
      repVanWhId = vanRes.json.warehouse.id;

      // Save shortage invoice as draft against repVanWhId (0 in van, requested 4 pieces)
      const bootBefore = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const mainBefore = bootBefore.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId];
      const custABefore = bootBefore.customers.find((c) => c.id === custA.id).currentBalance;

      const repDraftRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: tokenRep,
        body: {
          customerId: custA.id,
          warehouseId: repVanWhId,
          cashboxId: cashboxMainId,
          status: 'draft',
          paymentType: 'credit',
          paidAmount: 0,
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 4, unitPrice: 12 }],
        },
      });
      assert.equal(repDraftRes.status, 201);
      const repDraftInv = repDraftRes.json.invoice;
      assert.equal(repDraftInv.status, 'draft');

      // Rep creates linked item transfer request from whMainId -> repVanWhId
      const trCreate = await req(baseUrl, 'POST', '/api/inventory/rep-item-transfers', {
        token: tokenRep,
        body: {
          invoiceId: repDraftInv.id,
          invoiceNumber: repDraftInv.invoiceNumber,
          sourceWarehouseId: whMainId,
          sourceWarehouseName: 'المستودع الرئيسي',
          targetWarehouseId: repVanWhId,
          targetWarehouseName: vanRes.json.warehouse.name,
          items: [
            {
              productId: prod1.id,
              productName: prod1.name,
              unit: 'قطعة',
              requestedQty: 4,
              availableInVanQty: 0,
              shortageQty: 4,
            },
          ],
        },
      });
      assert.equal(trCreate.status, 201);
      const trId = trCreate.json.request.id;

      // Cannot confirm draft invoice while linked transfer is pending
      const blockedConfirmPending = await req(baseUrl, 'POST', `/api/invoices/${repDraftInv.id}/confirm`, {
        token: tokenRep,
      });
      assert.equal(blockedConfirmPending.status, 409);

      // Rep CANNOT approve or execute transfer themselves -> 403!
      for (const badStatus of ['approved', 'executed', 'rejected']) {
        const repBadStatus = await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${trId}/status`, {
          token: tokenRep,
          body: { status: badStatus },
        });
        assert.equal(repBadStatus.status, 403, `Rep MUST get 403 attempting ${badStatus}`);
      }

      // Admin approves then executes transfer (moves 4 pieces whMainId -> repVanWhId)
      assert.equal(
        (await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${trId}/status`, {
          token: adminToken,
          body: { status: 'approved' },
        })).status,
        200
      );
      assert.equal(
        (await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${trId}/status`, {
          token: adminToken,
          body: { status: 'executed' },
        })).status,
        200
      );

      // Rep confirms actual receipt ('received')
      const repReceipt = await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${trId}/status`, {
        token: tokenRep,
        body: { status: 'received', notes: 'تم استلام البضاعة في السيارة' },
      });
      assert.equal(repReceipt.status, 200);

      // Now rep confirms draft invoice ONCE
      const repConfirmInv = await req(baseUrl, 'POST', `/api/invoices/${repDraftInv.id}/confirm`, {
        token: tokenRep,
      });
      assert.equal(repConfirmInv.status, 200);
      assert.equal(repConfirmInv.json.invoice.status, 'confirmed');

      const bootAfter = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const pAfter = bootAfter.products.find((p) => p.id === prod1.id);
      assert.equal(pAfter.stockPerWarehouse[whMainId], mainBefore - 4);
      assert.equal(pAfter.stockPerWarehouse[repVanWhId], 0); // +4 transferred then -4 sold cleanly!
      assert.equal(bootAfter.customers.find((c) => c.id === custA.id).currentBalance, custABefore + 48);
    });

    await test('26. Customer /api/invoices/my, /api/customers/me/statement & mobileConfig price/app flags', async () => {
      // Customer A gets own invoices & statement
      const myInvRes = await req(baseUrl, 'GET', '/api/invoices/my', { token: tokenCustA });
      assert.equal(myInvRes.status, 200);
      assert.ok(myInvRes.json.invoices.length >= 2);
      assert.ok(myInvRes.json.invoices.every((inv) => inv.customerId === custA.id));

      const stmtRes = await req(baseUrl, 'GET', '/api/customers/me/statement', { token: tokenCustA });
      assert.equal(stmtRes.status, 200);
      assert.equal(stmtRes.json.customer.id, custA.id);
      assert.ok(stmtRes.json.entries.length >= 2);

      // Customer B must NEVER see any invoices belonging to Customer A
      const bStmtRes = await req(baseUrl, 'GET', '/api/customers/me/statement', { token: tokenCustB });
      assert.equal(bStmtRes.status, 200);
      assert.equal(bStmtRes.json.customer.id, custB.id);
      assert.ok(bStmtRes.json.invoices.every((inv) => inv.customerId === custB.id));
      assert.equal(bStmtRes.json.invoices.some((inv) => inv.customerId === custA.id), false);

      // Disable allowCustomerPriceView -> prices hidden on /api/products & statements
      await req(baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: { mobileConfig: { allowCustomerPriceView: false, enableCustomerApp: true } },
      });
      const hiddenPriceProd = await req(baseUrl, 'GET', '/api/products', { token: tokenCustA });
      assert.equal(hiddenPriceProd.status, 200);
      assert.equal(hiddenPriceProd.json.products[0].sellingPrice, 0);
      assert.equal(hiddenPriceProd.json.products[0].hidePrices, true);

      const hiddenStmt = await req(baseUrl, 'GET', '/api/customers/me/statement', { token: tokenCustA });
      assert.equal(hiddenStmt.status, 200);
      assert.equal(hiddenStmt.json.allowPriceView, false);

      // Disable enableCustomerApp -> blocks customer endpoints cleanly (403)
      await req(baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: { mobileConfig: { allowCustomerPriceView: true, enableCustomerApp: false } },
      });
      assert.equal((await req(baseUrl, 'GET', '/api/products', { token: tokenCustA })).status, 403);
      assert.equal((await req(baseUrl, 'GET', '/api/customers/me/statement', { token: tokenCustA })).status, 403);

      // Restore defaults
      await req(baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: { mobileConfig: { allowCustomerPriceView: true, enableCustomerApp: true, enableRepApp: true } },
      });
    });

    await test('27. Mobile role-scoped notifications endpoint returns real alerts without leaking cross-user events', async () => {
      const custNotifs = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: tokenCustA });
      assert.equal(custNotifs.status, 200);
      assert.ok(Array.isArray(custNotifs.json.notifications));
      assert.ok(custNotifs.json.notifications.length >= 1, 'Expected customer notifications from invoiced/rejected orders');

      const custBNotifs = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: tokenCustB });
      assert.equal(custBNotifs.status, 200);
      const custARelatedIds = new Set(custNotifs.json.notifications.map((n) => n.relatedId).filter(Boolean));
      const leakedToB = custBNotifs.json.notifications.filter((n) => custARelatedIds.has(n.relatedId));
      assert.equal(leakedToB.length, 0, 'Customer B must never receive any Customer A notifications');

      const repNotifs = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: tokenRep });
      assert.equal(repNotifs.status, 200);
      assert.ok(Array.isArray(repNotifs.json.notifications));
    });

    await test('28. Per-user keyboard shortcuts CRUD, 409 conflict detection, isolation & persistence across login', async () => {
      const adminScPayload = [
        { id: 'SC-1', actionId: 'nav:sales', label: 'المبيعات', category: 'التنقل', keyCombo: 'Alt+Shift+S', enabled: true },
        { id: 'SC-2', actionId: 'action:print_document', label: 'طباعة', category: 'عام', keyCombo: 'Ctrl+P', enabled: true },
      ];
      const saveAdminSc = await req(baseUrl, 'PUT', '/api/auth/shortcuts', {
        token: adminToken,
        body: { shortcuts: adminScPayload },
      });
      assert.equal(saveAdminSc.status, 200);
      assert.equal(saveAdminSc.json.shortcuts.length, 2);

      // Duplicate active keyCombo must return 409 SHORTCUT_CONFLICT
      const dupCombo = await req(baseUrl, 'PUT', '/api/auth/shortcuts', {
        token: adminToken,
        body: {
          shortcuts: [
            { actionId: 'nav:sales', label: 'المبيعات', category: 'التنقل', keyCombo: 'Ctrl+P', enabled: true },
            { actionId: 'action:print_document', label: 'طباعة', category: 'عام', keyCombo: 'ctrl+p', enabled: true },
          ],
        },
      });
      assert.equal(dupCombo.status, 409);

      // Rep sets completely separate personal shortcuts (does NOT overwrite admin)
      const saveRepSc = await req(baseUrl, 'PUT', '/api/auth/shortcuts', {
        token: tokenRep,
        body: {
          shortcuts: [
            { actionId: 'nav:sales', label: 'المبيعات', category: 'التنقل', keyCombo: 'F8', enabled: true },
          ],
        },
      });
      assert.equal(saveRepSc.status, 200);

      // Re-login as admin and verify persistence & isolation
      const reloginAdmin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
      });
      assert.equal(reloginAdmin.status, 200);
      const fetchedAdminSc = await req(baseUrl, 'GET', '/api/auth/shortcuts', { token: reloginAdmin.json.accessToken });
      assert.equal(fetchedAdminSc.status, 200);
      assert.equal(fetchedAdminSc.json.shortcuts.find((s) => s.actionId === 'nav:sales').keyCombo, 'Alt+Shift+S');

      const fetchedRepSc = await req(baseUrl, 'GET', '/api/auth/shortcuts', { token: tokenRep });
      assert.equal(fetchedRepSc.status, 200);
      assert.equal(fetchedRepSc.json.shortcuts[0].keyCombo, 'F8');
    });

    await test('29. Customer collection methods (cash/bank/cheque), advance credit balance & linked-user suspend/reactivate toggle', async () => {
      const custABefore = (await req(baseUrl, 'GET', `/api/customers/${custA.id}`, { token: adminToken })).json.customer;
      const startBal = Number(custABefore.currentBalance);
      const overPay = startBal + 75;

      // Bank transfer overpayment creates negative (advance credit) balance
      const payRes = await req(baseUrl, 'POST', `/api/customers/${custA.id}/payment`, {
        token: adminToken,
        body: { amount: overPay, cashboxId: cashboxMainId, paymentMethod: 'bank', notes: 'دفعة مقدمة بنك' },
      });
      assert.equal(payRes.status, 200);
      assert.equal(payRes.json.paymentMethod, 'bank');
      assert.equal(Number(payRes.json.customer.currentBalance), -75);
      assertNoSensitiveFields(payRes.json, 'customer payment');

      // Suspend CustA's portal login -> 403 on next login and tokenCustA revoked immediately
      const suspRes = await req(baseUrl, 'POST', `/api/customers/${custA.id}/toggle-user-status`, {
        token: adminToken,
        body: { isActive: false },
      });
      assert.equal(suspRes.status, 200);
      assert.equal(suspRes.json.isActive, false);

      const suspendedLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'cust_baraka', password: 'CustomerPassword!1' },
      });
      assert.equal(suspendedLogin.status, 403);

      // Reactivate CustA portal login -> 200
      const reactRes = await req(baseUrl, 'POST', `/api/customers/${custA.id}/toggle-user-status`, {
        token: adminToken,
        body: { isActive: true },
      });
      assert.equal(reactRes.status, 200);
      assert.equal(reactRes.json.isActive, true);

      const okLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'cust_baraka', password: 'CustomerPassword!1' },
      });
      assert.equal(okLogin.status, 200);
      tokenCustA = okLogin.json.accessToken;
    });

    await test('30. Employees CRUD, status toggle & removed attendance/advances/payrolls routes return 404 while cashbox overdraft blocks', async () => {
      // Restricted staff gets 403 on HR endpoints
      const hrForbidden = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: tokenStaffRestricted,
        body: { name: 'موظف', jobTitle: 'عامل' },
      });
      assert.equal(hrForbidden.status, 403);

      // Create employee
      const empRes = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: { code: 'EMP-900', name: 'مصطفى محمود', jobTitle: 'أمين مخزن', department: 'المخازن' },
      });
      assert.equal(empRes.status, 201);
      const empId = empRes.json.employee.id;

      // Suspend & reactivate employee cleanly
      const suspEmp = await req(baseUrl, 'PUT', `/api/admin/employees/${empId}`, {
        token: adminToken,
        body: { status: 'suspended' },
      });
      assert.equal(suspEmp.status, 200);
      assert.equal(
        (await req(baseUrl, 'PUT', `/api/admin/employees/${empId}`, {
          token: adminToken,
          body: { status: 'active', jobTitle: 'أمين مخزن أول' },
        })).status,
        200
      );

      // Removed attendance, advances & payroll routes MUST return 404
      const adv404 = await req(baseUrl, 'POST', '/api/admin/advances', {
        token: adminToken,
        body: { employeeId: empId, type: 'advance', amount: 100, cashboxId: cashboxMainId },
      });
      assert.equal(adv404.status, 404);
      const att404 = await req(baseUrl, 'POST', '/api/admin/attendance', {
        token: adminToken,
        body: { employeeId: empId, status: 'present', date: '2026-11-20' },
      });
      assert.equal(att404.status, 404);
      const pay404 = await req(baseUrl, 'POST', '/api/admin/payrolls', {
        token: adminToken,
        body: { employeeId: empId, month: 11, year: 2026, netSalary: 100, cashboxId: cashboxMainId },
      });
      assert.equal(pay404.status, 404);

      // Cashbox overdraft block on cash withdrawal -> 409
      const hugeWd = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        body: { type: 'cash_withdrawal', cashboxId: cashboxMainId, amount: 9999999, recipientOrPayer: 'تجاوز' },
      });
      assert.equal(hugeWd.status, 409);

      const bootHr = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.ok(bootHr.employees.some((e) => e.id === empId && e.jobTitle === 'أمين مخزن أول'));
      assert.equal(bootHr.attendance, undefined);
      assert.equal(bootHr.advancesDeductions, undefined);
      assert.equal(bootHr.payrolls, undefined);
    });

    await test('31. Confirmed Purchase Invoice updates stock (+qty), purchase price, supplier balance & cashbox accurately', async () => {
      const suppRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: { code: 'SUP-88', name: 'شركة النور للتوريدات', phone: '01111112222', openingBalance: 0 },
      });
      assert.equal(suppRes.status, 201);
      const suppId = suppRes.json.supplier.id;

      const bootBefore = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const stockBefore = Number(bootBefore.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId] || 0);
      const cbBefore = Number(bootBefore.cashboxes.find((c) => c.id === cashboxMainId).currentBalance || 0);

      // Purchase 10 pieces @ 8 = 80 total, paid 30 cashbox, remaining 50 credit on supplier
      const purRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: adminToken,
        body: {
          supplierId: suppId,
          supplierName: 'شركة النور للتوريدات',
          warehouseId: whMainId,
          warehouseName: bootBefore.warehouses[0].name,
          cashboxId: cashboxMainId,
          paymentType: 'partial',
          paidAmount: 30,
          remainingAmount: 50,
          subtotal: 80,
          grandTotal: 80,
          status: 'confirmed',
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 10, unitPrice: 8, total: 80 }],
        },
      });
      assert.equal(purRes.status, 201);
      assert.equal(purRes.json.invoice.status, 'confirmed');

      const bootAfter = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootAfter.products.find((p) => p.id === prod1.id).stockPerWarehouse[whMainId], stockBefore + 10);
      assert.equal(bootAfter.cashboxes.find((c) => c.id === cashboxMainId).currentBalance, cbBefore - 30);
      assert.equal(bootAfter.suppliers.find((s) => s.id === suppId).currentBalance, 50);
    });

    await test('32. File-import safe batch deletion protects manual items, invoiced items & non-opening stock_movements', async () => {
      const impUsedRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'IMP-USED-1',
          barcode: '622999001',
          name: 'صنف مستورد مستخدم بحركة',
          category: 'عام',
          baseUnit: 'قطعة',
          purchasePrice: 5,
          sellingPrice: 9,
          stockPerWarehouse: { [whMainId]: 20 },
          importedFromFile: true,
          importBatchId: 'BATCH-DEL-1',
          sourceFileName: 'chipcy.txt',
        },
      });
      assert.equal(impUsedRes.status, 201);
      const impUsedId = impUsedRes.json.product.id;

      // Record non-opening stock movement (damagedStock) on impUsedId
      const dmgRes = await req(baseUrl, 'POST', '/api/inventory/damaged', {
        token: adminToken,
        body: { productId: impUsedId, warehouseId: whMainId, quantity: 2, reason: 'تالف اختبار حماية الحذف' },
      });
      assert.equal(dmgRes.status, 200);

      const impFreeRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'IMP-FREE-1',
          barcode: '622999002',
          name: 'صنف مستورد قابل للحذف',
          category: 'عام',
          baseUnit: 'قطعة',
          purchasePrice: 0,
          sellingPrice: 0,
          stockPerWarehouse: { [whMainId]: 0 },
          importedFromFile: true,
          importBatchId: 'BATCH-DEL-1',
          sourceFileName: 'chipcy.txt',
        },
      });
      assert.equal(impFreeRes.status, 201);
      const impFreeId = impFreeRes.json.product.id;

      // Add another batch item to prove targeted batchId deletion does NOT touch other batches
      const otherBatchRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'IMP-OTHER-2',
          barcode: '622999003',
          name: 'صنف دفعة أخرى',
          category: 'عام',
          baseUnit: 'قطعة',
          purchasePrice: 0,
          sellingPrice: 0,
          stockPerWarehouse: { [whMainId]: 0 },
          importedFromFile: true,
          importBatchId: 'BATCH-KEEP-2',
          sourceFileName: 'drinks.txt',
        },
      });
      assert.equal(otherBatchRes.status, 201);
      const otherBatchId = otherBatchRes.json.product.id;

      const delBatchRes = await req(baseUrl, 'POST', '/api/products/delete-imported', {
        token: adminToken,
        body: { batchId: 'BATCH-DEL-1', deleteAllImported: false },
      });
      assert.equal(delBatchRes.status, 200);
      assert.equal(delBatchRes.json.deletedCount, 1);
      assert.equal(delBatchRes.json.skippedCount, 1);
      assert.equal(delBatchRes.json.skippedItems[0].id, impUsedId);

      const allProds = (await req(baseUrl, 'GET', '/api/products', { token: adminToken })).json.products;
      assert.ok(allProds.some((p) => p.id === prod1.id), 'Manual prod1 MUST be preserved');
      assert.ok(allProds.some((p) => p.id === impUsedId), 'Imported item with stock movement MUST be preserved');
      assert.ok(allProds.some((p) => p.id === otherBatchId), 'Other batch item MUST be preserved');
      assert.equal(allProds.some((p) => p.id === impFreeId), false, 'Unused item in target batch MUST be deleted');
    });

    await test('33. Flexible Stock Transfers (wh <-> rep & reject) + Cashbox Transfer overdraft 409 block', async () => {
      // Cashbox transfer overdraft -> 409 INSUFFICIENT_CASHBOX
      const cbOverdraft = await req(baseUrl, 'POST', '/api/admin/cashboxes/transfer', {
        token: adminToken,
        body: { fromId: cashboxSecondId, toId: cashboxMainId, amount: 999999, notes: 'اختبار تجاوز رصيد' },
      });
      assert.equal(cbOverdraft.status, 409);

      // Stock transfer using targetRepId (warehouse -> rep van)
      const whToRep = await req(baseUrl, 'POST', '/api/stock-transfers', {
        token: adminToken,
        body: {
          sourceWarehouseId: whMainId,
          targetRepId: repProfileId,
          reason: 'تحويل عهدة مرن لمندوب',
          items: [{ productId: prod1.id, unit: 'قطعة', unitFactor: 1, requestedQty: 5 }],
        },
      });
      assert.equal(whToRep.status, 201);
      assert.equal(whToRep.json.transfer.targetWarehouseId, repVanWhId);

      assert.equal((await req(baseUrl, 'POST', `/api/stock-transfers/${whToRep.json.transfer.id}/submit`, { token: adminToken })).status, 200);
      assert.equal((await req(baseUrl, 'POST', `/api/stock-transfers/${whToRep.json.transfer.id}/approve`, { token: adminToken, body: {} })).status, 200);
      assert.equal((await req(baseUrl, 'POST', `/api/stock-transfers/${whToRep.json.transfer.id}/execute`, { token: adminToken })).status, 200);

      // Verify rep van now has 5 pieces, then test rejection leaves stock untouched
      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.products.find((p) => p.id === prod1.id).stockPerWarehouse[repVanWhId], 5);

      const repToWh = await req(baseUrl, 'POST', '/api/stock-transfers', {
        token: adminToken,
        body: {
          sourceRepId: repProfileId,
          targetWarehouseId: whMainId,
          reason: 'مرتجع عهدة للمستودع',
          items: [{ productId: prod1.id, unit: 'قطعة', unitFactor: 1, requestedQty: 3 }],
        },
      });
      assert.equal(repToWh.status, 201);
      const rejRes = await req(baseUrl, 'POST', `/api/stock-transfers/${repToWh.json.transfer.id}/reject`, {
        token: adminToken,
        body: { reason: 'رفض لأغراض اختبار الحالة' },
      });
      assert.equal(rejRes.status, 200);
      assert.equal(rejRes.json.transfer.status, 'rejected');

      // Executing a rejected transfer -> 409
      const execRej = await req(baseUrl, 'POST', `/api/stock-transfers/${repToWh.json.transfer.id}/execute`, { token: adminToken });
      assert.equal(execRej.status, 409);

      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.products.find((p) => p.id === prod1.id).stockPerWarehouse[repVanWhId], 5);
    });

    await test('35. Unified Mobile Login, Permission Escalation Guard, Idempotency, Supplier Advance Settlement, Dated Price History & Scoped Notifications', async () => {
      // 1. Create a restricted manager (has canManageUsers + canView, lacks canManageSettings / canManageCashboxes)
      const mgrCreate = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مدير فرع اختبار',
          username: 'mgr_scope_test',
          password: 'MgrPassword!99',
          phone: '01055551234',
          role: 'manager',
          permissions: { canView: true, canAdd: true, canManageUsers: true, canManageSales: true },
        },
      });
      assert.equal(mgrCreate.status, 201);

      // Login using PHONE number without specifying role
      const phoneLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: '01055551234', password: 'MgrPassword!99' },
      });
      assert.equal(phoneLogin.status, 200);
      assert.equal(phoneLogin.json.user.role, 'manager');
      const mgrToken = phoneLogin.json.accessToken;

      // Manager cannot escalate permissions they do not possess
      const escRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: mgrToken,
        body: {
          fullName: 'حساب متجاوز',
          username: 'esc_user_1',
          password: 'EscPassword!99',
          role: 'sales',
          permissions: { canView: true, canManageCashboxes: true },
        },
      });
      assert.equal(escRes.status, 403);
      assert.equal(escRes.json.code, 'FORBIDDEN_PERMISSION_ESCALATION');

      // Manager cannot create admin account
      const admEsc = await req(baseUrl, 'POST', '/api/admin/users', {
        token: mgrToken,
        body: {
          fullName: 'ادمن مزيف',
          username: 'fake_adm_1',
          password: 'FakePassword!99',
          role: 'admin',
        },
      });
      assert.equal(admEsc.status, 403);

      // Scoped notifications: Admin vs restricted Manager
      const admNotifs = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: adminToken });
      assert.equal(admNotifs.status, 200);
      assert.ok(Array.isArray(admNotifs.json.notifications));
      const mgrNotifs = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: mgrToken });
      assert.equal(mgrNotifs.status, 200);
      assert.ok(Array.isArray(mgrNotifs.json.notifications));

      // 2. Idempotency on customer payment + supplier payment + sales invoice + invoice payment
      const boot0 = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const cust0 = boot0.customers[0];
      const supp0 = boot0.suppliers[0];
      const cb0 = boot0.cashboxes[0];
      const wh0 = boot0.warehouses[0];

      const custBalBefore = Number(cust0.currentBalance || 0);
      const cbBalBefore = Number(cb0.currentBalance || 0);
      const cp1 = await req(baseUrl, 'POST', `/api/customers/${cust0.id}/payment`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-cust-pay-35' },
        body: { amount: 25, cashboxId: cb0.id, paymentMethod: 'cash', notes: 'تحصيل مع منع التكرار' },
      });
      assert.equal(cp1.status, 200);
      const cp2 = await req(baseUrl, 'POST', `/api/customers/${cust0.id}/payment`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-cust-pay-35' },
        body: { amount: 25, cashboxId: cb0.id, paymentMethod: 'cash', notes: 'تحصيل مع منع التكرار' },
      });
      assert.equal(cp2.status, 200);
      assert.equal(cp2.json.deduplicated, true);

      let boot1 = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot1.customers.find((c) => c.id === cust0.id).currentBalance, custBalBefore - 25);
      assert.equal(boot1.cashboxes.find((c) => c.id === cb0.id).currentBalance, cbBalBefore + 25);

      // Sales invoice stores dated priceHistory object and respects Idempotency-Key
      const invDate = new Date().toISOString().split('T')[0];
      const si1 = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-sale-35' },
        body: {
          date: invDate,
          customerId: cust0.id,
          warehouseId: wh0.id,
          cashboxId: cb0.id,
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 1, unitPrice: 77 }],
        },
      });
      assert.equal(si1.status, 201);
      const si2 = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-sale-35' },
        body: {
          date: invDate,
          customerId: cust0.id,
          warehouseId: wh0.id,
          cashboxId: cb0.id,
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 1, unitPrice: 77 }],
        },
      });
      assert.equal(si2.status, 201);
      assert.equal(si2.json.invoice.id, si1.json.invoice.id);

      const phRes = await req(baseUrl, 'GET', `/api/customers/${cust0.id}/price-history`, { token: adminToken });
      assert.equal(phRes.status, 200);
      const phEntries = phRes.json.priceHistory[prod1.id] || [];
      const latestPh = phEntries[phEntries.length - 1];
      assert.equal(latestPh.price, 77);
      assert.equal(latestPh.date, invDate);
      assert.equal(latestPh.invoiceNumber, si1.json.invoice.invoiceNumber);

      // Invoice payment idempotency
      const ip1 = await req(baseUrl, 'POST', `/api/invoices/${si1.json.invoice.id}/payments`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-inv-pay-35' },
        body: { amount: 20, cashboxId: cb0.id, paymentMethod: 'cash', notes: 'دفعة فاتورة' },
      });
      assert.equal(ip1.status, 200);
      const ip2 = await req(baseUrl, 'POST', `/api/invoices/${si1.json.invoice.id}/payments`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-inv-pay-35' },
        body: { amount: 20, cashboxId: cb0.id, paymentMethod: 'cash', notes: 'دفعة فاتورة' },
      });
      assert.equal(ip2.status, 200);
      assert.equal(ip2.json.invoice.paidAmount, 20);

      // 3. Supplier advance payment + zero-cashbox advance settlement route
      const spAdv = await req(baseUrl, 'POST', '/api/admin/suppliers/payment', {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-supp-adv-35' },
        body: { supplierId: supp0.id, amount: 500, cashboxId: cb0.id, notes: 'دفعة مقدمة للمورد' },
      });
      assert.equal(spAdv.status, 200);
      const spAdvDup = await req(baseUrl, 'POST', '/api/admin/suppliers/payment', {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-supp-adv-35' },
        body: { supplierId: supp0.id, amount: 500, cashboxId: cb0.id, notes: 'دفعة مقدمة للمورد' },
      });
      assert.equal(spAdvDup.status, 200);
      assert.equal(spAdvDup.json.deduplicated, true);

      const purInvRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: adminToken,
        body: {
          supplierId: supp0.id,
          warehouseId: wh0.id,
          cashboxId: cb0.id,
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 2, unitPrice: 60 }],
        },
      });
      assert.equal(purInvRes.status, 201);
      const purInv = purInvRes.json.invoice;

      const cbBeforeSettle = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data.cashboxes.find((c) => c.id === cb0.id).currentBalance;
      const settle1 = await req(baseUrl, 'POST', `/api/admin/suppliers/${supp0.id}/settle-advance`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-supp-settle-35' },
        body: { invoiceId: purInv.id, amount: 120, notes: 'تسوية دفعة مقدمة' },
      });
      assert.equal(settle1.status, 200);
      assert.equal(settle1.json.invoice.paidAmount, 120);
      assert.equal(settle1.json.invoice.remainingAmount, 0);

      // Retrying with same Idempotency-Key returns deduplicated without re-settling
      const settle2 = await req(baseUrl, 'POST', `/api/admin/suppliers/${supp0.id}/settle-advance`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'idem-supp-settle-35' },
        body: { invoiceId: purInv.id, amount: 120, notes: 'تسوية دفعة مقدمة' },
      });
      assert.equal(settle2.status, 200);
      assert.equal(settle2.json.deduplicated, true);

      const cbAfterSettle = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data.cashboxes.find((c) => c.id === cb0.id).currentBalance;
      assert.equal(cbAfterSettle, cbBeforeSettle, 'Advance settlement must NEVER change cashbox balance');
    });

    await test('37. Dual/Multi-Connection System (JSON Ledger): 4 modes, HTTPS enforcement, dynamic CORS, zero secret leaks & RBAC guards', async () => {
      // 1. Public /api/health reports supported modes & X-Forwarded-Proto HTTPS detection without secrets
      const hPlain = await req(baseUrl, 'GET', '/api/health');
      assert.equal(hPlain.status, 200);
      assert.deepEqual(hPlain.json.connectionModesSupported, ['local_network', 'free_remote', 'pro_remote', 'cloud_vps']);
      assert.equal(hPlain.json.httpsActive, false);
      assert.ok(!JSON.stringify(hPlain.json).includes('JWT_SECRET'));
      assert.ok(!JSON.stringify(hPlain.json).includes('tunnelToken'));

      // Unverified X-Forwarded-Proto MUST be ignored when TRUST_PROXY is disabled (default)
      const hSpoofedProxy = await req(baseUrl, 'GET', '/api/health', {
        headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'erp.awladselim.example.com' },
      });
      assert.equal(hSpoofedProxy.status, 200);
      assert.equal(hSpoofedProxy.json.protocol, 'http');
      assert.equal(hSpoofedProxy.json.httpsActive, false);

      // When TRUST_PROXY=true, trusted reverse-proxy X-Forwarded-Proto=https is honored
      const prevTrustProxyEnv = process.env.TRUST_PROXY;
      process.env.TRUST_PROXY = 'true';
      const trustedProxyApp = await createApiApp({ disableFrontend: true });
      const trustedProxyServer = http.createServer(trustedProxyApp);
      await new Promise((resolve) => trustedProxyServer.listen(0, '127.0.0.1', resolve));
      const trustedProxyPort = trustedProxyServer.address().port;
      try {
        const hTrustedProxy = await req(`http://127.0.0.1:${trustedProxyPort}`, 'GET', '/api/health', {
          headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'erp.awladselim.example.com' },
        });
        assert.equal(hTrustedProxy.status, 200);
        assert.equal(hTrustedProxy.json.protocol, 'https');
        assert.equal(hTrustedProxy.json.httpsActive, true);
      } finally {
        await new Promise((resolve) => trustedProxyServer.close(resolve));
        if (prevTrustProxyEnv === undefined) delete process.env.TRUST_PROXY;
        else process.env.TRUST_PROXY = prevTrustProxyEnv;
      }

      // 2. Hardened Dynamic CORS: reject trycloudflare, LAN HTTP, and X-Forwarded-Host spoofs unless explicitly enabled
      const prevAllowedOrigins = process.env.ALLOWED_ORIGINS;
      const prevTunnelFlag = process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL;
      const prevLanFlag = process.env.ALLOW_MOBILE_LAN_HTTP;
      const prevNodeEnv = process.env.NODE_ENV;
      try {
        process.env.ALLOWED_ORIGINS = 'https://office.awladselim.com';
        process.env.NODE_ENV = 'production';
        delete process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL;
        delete process.env.ALLOW_MOBILE_LAN_HTTP;

        for (const origin of ['capacitor://localhost', 'https://localhost', 'https://office.awladselim.com']) {
          const corsRes = await fetch(`${baseUrl}/api/health`, {
            method: 'OPTIONS',
            headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
          });
          assert.equal(corsRes.status, 204);
          assert.equal(corsRes.headers.get('access-control-allow-origin'), origin);
        }

        for (const item of [
          { origin: 'https://shop-tunnel.trycloudflare.com', extraHeaders: {} },
          { origin: 'http://192.168.1.55:3000', extraHeaders: {} },
          { origin: 'https://erp.awladselim.com', extraHeaders: { 'X-Forwarded-Host': 'erp.awladselim.com' } },
          { origin: 'https://evil-attacker.example.net', extraHeaders: {} },
        ]) {
          const blockedRes = await fetch(`${baseUrl}/api/health`, {
            method: 'OPTIONS',
            headers: { Origin: item.origin, 'Access-Control-Request-Method': 'GET', ...item.extraHeaders },
          });
          assert.equal(blockedRes.status, 403, `Expected CORS block when unconfigured for ${item.origin}`);
        }

        // Explicit opt-in flags allow Quick Tunnel and LAN HTTP while attacker origin & X-Forwarded-Host spoof remain blocked
        process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL = 'true';
        process.env.ALLOW_MOBILE_LAN_HTTP = 'true';
        for (const origin of ['https://shop-tunnel.trycloudflare.com', 'http://192.168.1.55:3000']) {
          const optInRes = await fetch(`${baseUrl}/api/health`, {
            method: 'OPTIONS',
            headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
          });
          assert.equal(optInRes.status, 204);
          assert.equal(optInRes.headers.get('access-control-allow-origin'), origin);
        }
        const stillBlockedSpoof = await fetch(`${baseUrl}/api/health`, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://erp.awladselim.com',
            'Access-Control-Request-Method': 'GET',
            'X-Forwarded-Host': 'erp.awladselim.com',
          },
        });
        assert.equal(stillBlockedSpoof.status, 403);
      } finally {
        if (prevAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
        else process.env.ALLOWED_ORIGINS = prevAllowedOrigins;
        if (prevTunnelFlag === undefined) delete process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL;
        else process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL = prevTunnelFlag;
        if (prevLanFlag === undefined) delete process.env.ALLOW_MOBILE_LAN_HTTP;
        else process.env.ALLOW_MOBILE_LAN_HTTP = prevLanFlag;
        if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevNodeEnv;
      }

      // 3. Unauthorized roles blocked from server-info, settings, backup, and cash-operations
      const mgrNoSettingsLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'mgr_scope_test', password: 'MgrPassword!99' },
      });
      assert.equal(mgrNoSettingsLogin.status, 200);
      const repLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'rep_karim', password: 'RepPassword!123' },
      });
      assert.equal(repLogin.status, 200);

      for (const unauthorizedToken of [tokenCustA, repLogin.json.accessToken, mgrNoSettingsLogin.json.accessToken]) {
        const siForb = await req(baseUrl, 'GET', '/api/admin/server-info', { token: unauthorizedToken });
        assert.equal(siForb.status, 403, 'Unauthorized role must get 403 on /api/admin/server-info');
        const setForb = await req(baseUrl, 'PUT', '/api/admin/settings', {
          token: unauthorizedToken,
          body: { extraSettings: { connectionConfig: { activeMode: 'free_remote' } } },
        });
        assert.equal(setForb.status, 403, 'Unauthorized role must get 403 on PUT /api/admin/settings');
        const bakForb = await req(baseUrl, 'GET', '/api/admin/backup/export', { token: unauthorizedToken });
        assert.equal(bakForb.status, 403, 'Unauthorized role must get 403 on /api/admin/backup/export');
      }

      // 4. Admin /api/admin/server-info returns port, lanUrls, databaseMode, zero secrets
      const srvInfoRes = await req(baseUrl, 'GET', '/api/admin/server-info', {
        token: adminToken,
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(srvInfoRes.status, 200);
      assert.equal(srvInfoRes.json.ok, true);
      assert.ok(typeof srvInfoRes.json.port === 'number');
      assert.ok(Array.isArray(srvInfoRes.json.lanUrls));
      assert.equal(srvInfoRes.json.httpsActive, true);
      assert.equal(srvInfoRes.json.databaseMode, 'local-json-ledger');
      assertNoSensitiveFields(srvInfoRes.json, 'server-info');

      // 5. Capture DB snapshot metrics before mode switches (Single DB guarantee)
      const snapBefore = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const beforeInvoicesCount = snapBefore.invoices.length;
      const beforeCustomersCount = snapBefore.customers.length;
      const beforeCashboxSum = snapBefore.cashboxes.reduce((s, c) => s + Number(c.currentBalance || 0), 0);

      // Reject plain HTTP for remote modes
      const badHttpRemote = await req(baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: {
          extraSettings: {
            connectionConfig: {
              activeMode: 'free_remote',
              freeRemote: { tunnelUrl: 'http://insecure-demo.trycloudflare.com' },
            },
          },
        },
      });
      assert.equal(badHttpRemote.status, 400);
      assert.equal(badHttpRemote.json.code, 'HTTPS_REQUIRED_FOR_REMOTE');

      // Save all 4 profiles with extraneous secret keys -> secrets MUST be stripped
      const saveAll4 = await req(baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: {
          extraSettings: {
            connectionConfig: {
              activeMode: 'pro_remote',
              localNetwork: { ip: '192.168.1.120', port: 3000, hostname: 'awlad-main-pc', adminSecret: 'MUST_STRIP' },
              freeRemote: { tunnelUrl: 'https://awlad-test.trycloudflare.com', tunnelToken: 'SECRET_TOKEN' },
              proRemote: { domainUrl: 'https://erp.awladselim.com', cloudflareApiKey: 'CF_SECRET' },
              cloudVps: { vpsUrl: 'https://vps.awladselim.com', notes: 'مستقبلي', sshPassword: 'ROOT_PASSWORD' },
              enforceHttpsForRemote: true,
            },
          },
        },
      });
      assert.equal(saveAll4.status, 200);
      const savedCfg = saveAll4.json.settings.extraSettings.connectionConfig;
      assert.equal(savedCfg.activeMode, 'pro_remote');
      assert.equal(savedCfg.localNetwork.ip, '192.168.1.120');
      assert.equal(savedCfg.freeRemote.tunnelUrl, 'https://awlad-test.trycloudflare.com');
      assert.equal(savedCfg.proRemote.domainUrl, 'https://erp.awladselim.com');
      assert.equal(savedCfg.cloudVps.vpsUrl, 'https://vps.awladselim.com');
      const cfgSerialized = JSON.stringify(savedCfg);
      assert.ok(!cfgSerialized.includes('SECRET_TOKEN') && !cfgSerialized.includes('CF_SECRET') && !cfgSerialized.includes('ROOT_PASSWORD') && !cfgSerialized.includes('MUST_STRIP'));

      // Switch between all 4 modes + verify single DB & token continuity across proxy headers
      for (const nextMode of ['cloud_vps', 'free_remote', 'local_network']) {
        const sw = await req(baseUrl, 'PUT', '/api/admin/settings', {
          token: adminToken,
          headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'erp.awladselim.com' },
          body: { extraSettings: { connectionConfig: { activeMode: nextMode } } },
        });
        assert.equal(sw.status, 200);
        assert.equal(sw.json.settings.extraSettings.connectionConfig.activeMode, nextMode);
        assert.equal(sw.json.settings.extraSettings.connectionConfig.proRemote.domainUrl, 'https://erp.awladselim.com');
      }

      const snapAfter = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(snapAfter.invoices.length, beforeInvoicesCount);
      assert.equal(snapAfter.customers.length, beforeCustomersCount);
      assert.equal(
        snapAfter.cashboxes.reduce((s, c) => s + Number(c.currentBalance || 0), 0),
        beforeCashboxSum
      );
    });

    await test('39. Customer & Rep Orders section: rep orders, strict RBAC isolation, approve does NOT auto-invoice, reject reason & separate convert', async () => {
      const boot0 = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const wh0 = boot0.warehouses[0];
      const cb0 = boot0.cashboxes[0];
      const custABefore = boot0.customers.find((c) => c.id === custA.id);
      const prodBefore = boot0.products.find((p) => p.id === prod1.id);
      const invCountBefore = boot0.invoices.length;
      const stockBefore = Number(prodBefore.stockPerWarehouse[wh0.id] || 0);
      const balBefore = Number(custABefore.currentBalance || 0);

      // 1. Rep submits an order for assigned custA
      const repOrdRes = await req(baseUrl, 'POST', '/api/orders', {
        token: tokenRep,
        headers: { 'Idempotency-Key': 'rep-ord-39-1' },
        body: {
          customerId: custA.id,
          items: [{ productId: prod1.id, unit: 'قطعة', quantity: 2.5 }],
          notes: 'طلب مندوب تجريبي',
        },
      });
      assert.equal(repOrdRes.status, 201);
      const repOrd = repOrdRes.json.order;
      assert.equal(repOrd.requesterType, 'representative');
      assert.equal(repOrd.representativeId, repProfileId);
      assert.ok(Number(repOrd.totalAmount) > 0);
      assert.equal(repOrd.status, 'pending');

      // Rep CAN submit an order for ANY customer (including unassigned custB) under the ALL-CUSTOMERS rule
      const repOrdCustBRes = await req(baseUrl, 'POST', '/api/orders', {
        token: tokenRep,
        body: {
          customerId: custB.id,
          items: [{ productId: prod1.id, unit: 'قطعة', quantity: 1 }],
        },
      });
      assert.equal(repOrdCustBRes.status, 201);
      assert.equal(repOrdCustBRes.json.order.requesterType, 'representative');
      assert.equal(repOrdCustBRes.json.order.representativeId, repProfileId);

      // 2. Customer B creates a direct order; Rep must NOT see Customer B order in GET /api/orders and gets 403 on GET /api/orders/:id
      const custBOrdRes = await req(baseUrl, 'POST', '/api/orders', {
        token: tokenCustB,
        body: {
          items: [{ productId: prod1.id, unit: 'قطعة', quantity: 1 }],
          notes: 'طلب مباشر من العميل ب',
        },
      });
      assert.equal(custBOrdRes.status, 201);
      const custBOrd = custBOrdRes.json.order;
      assert.equal(custBOrd.requesterType, 'customer');

      const repListRes = await req(baseUrl, 'GET', '/api/orders', { token: tokenRep });
      assert.equal(repListRes.status, 200);
      assert.ok(repListRes.json.orders.some((o) => o.id === repOrd.id));
      assert.equal(repListRes.json.orders.some((o) => o.id === custBOrd.id), false, 'Rep MUST NOT see direct customer orders');
      assert.equal((await req(baseUrl, 'GET', `/api/orders/${custBOrd.id}`, { token: tokenRep })).status, 403);

      // Non-sales employee (e.g. warehouse staff without canManageSales) receives empty list / 403 on detail & review actions
      const nonSalesRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'أمين مخزن اختبار',
          username: 'wh_no_orders',
          password: 'WhPassword!123',
          role: 'warehouse',
          permissions: { canView: true, canManageInventory: true },
        },
      });
      assert.equal(nonSalesRes.status, 201);
      const nonSalesToken = (await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'wh_no_orders', password: 'WhPassword!123' },
      })).json.accessToken;

      const staffOrdList = await req(baseUrl, 'GET', '/api/orders', { token: nonSalesToken });
      assert.equal(staffOrdList.status, 200);
      assert.equal(staffOrdList.json.orders.length, 0);
      assert.equal((await req(baseUrl, 'GET', `/api/orders/${repOrd.id}`, { token: nonSalesToken })).status, 403);
      assert.equal((await req(baseUrl, 'POST', `/api/orders/${repOrd.id}/approve`, { token: nonSalesToken, body: {} })).status, 403);

      // 3. Review -> Approve lifecycle: must NOT auto-create invoice or touch stock/balances!
      const revRes = await req(baseUrl, 'POST', `/api/orders/${repOrd.id}/review`, {
        token: adminToken,
        body: { notes: 'جاري المراجعة' },
      });
      assert.equal(revRes.status, 200);
      assert.equal(revRes.json.order.status, 'under_review');

      const appRes = await req(baseUrl, 'POST', `/api/orders/${repOrd.id}/approve`, {
        token: adminToken,
        body: {},
      });
      assert.equal(appRes.status, 200);
      assert.equal(appRes.json.order.status, 'approved');
      assert.ok(appRes.json.order.reviewedBy);
      assert.ok(appRes.json.order.reviewedAt);

      // Duplicate approve blocked with 409
      const dupAppRes = await req(baseUrl, 'POST', `/api/orders/${repOrd.id}/approve`, {
        token: adminToken,
        body: {},
      });
      assert.equal(dupAppRes.status, 409);

      // Verify ZERO change to invoices, stock, or customer balance upon approval
      const bootAfterApprove = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootAfterApprove.invoices.length, invCountBefore, 'Approving order MUST NOT auto-create an invoice');
      assert.equal(Number(bootAfterApprove.products.find((p) => p.id === prod1.id).stockPerWarehouse[wh0.id] || 0), stockBefore);
      assert.equal(Number(bootAfterApprove.customers.find((c) => c.id === custA.id).currentBalance || 0), balBefore);

      // Separate convert-to-invoice works & transitions order -> invoiced
      const convRes = await req(baseUrl, 'POST', `/api/orders/${repOrd.id}/convert-to-invoice`, {
        token: adminToken,
        body: {
          warehouseId: wh0.id,
          warehouseName: wh0.name,
          cashboxId: cb0.id,
          status: 'confirmed',
          paymentType: 'credit',
          paidAmount: 0,
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 2.5, unitPrice: 20 }],
        },
      });
      assert.equal(convRes.status, 201);
      assert.equal(convRes.json.order.status, 'invoiced');

      // 4. Reject requires written reason & updates mobile state + notification
      const emptyRej = await req(baseUrl, 'POST', `/api/orders/${custBOrd.id}/reject`, {
        token: adminToken,
        body: { reason: '   ' },
      });
      assert.equal(emptyRej.status, 400);

      const okRej = await req(baseUrl, 'POST', `/api/orders/${custBOrd.id}/reject`, {
        token: adminToken,
        body: { reason: 'الكمية غير متوفرة مؤقتًا' },
      });
      assert.equal(okRej.status, 200);
      assert.equal(okRej.json.order.status, 'rejected');
      assert.equal(okRej.json.order.rejectionReason, 'الكمية غير متوفرة مؤقتًا');

      const custBOrdersAfter = await req(baseUrl, 'GET', '/api/orders', { token: tokenCustB });
      assert.equal(custBOrdersAfter.status, 200);
      const rejectedForB = custBOrdersAfter.json.orders.find((o) => o.id === custBOrd.id);
      assert.equal(rejectedForB.status, 'rejected');
      assert.equal(rejectedForB.rejectionReason, 'الكمية غير متوفرة مؤقتًا');
    });

    await test('40. Customer user creation auto-links 1:1 profile, prevents duplicate linking & repairs legacy unlinked users', async () => {
      // 1. Creating role='customer' user without linkedCustomerId auto-creates & links customer profile
      const autoUserRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'متجر الأمل الجديد',
          username: 'cust_amal_auto',
          password: 'AmalPassword!123',
          phone: '01077776666',
          address: 'المنصورة',
          role: 'customer',
        },
      });
      assert.equal(autoUserRes.status, 201);
      assert.ok(autoUserRes.json.user.linkedCustomerId, 'Expected auto-created linkedCustomerId');

      const amalLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'cust_amal_auto', password: 'AmalPassword!123' },
      });
      assert.equal(amalLogin.status, 200);
      const amalToken = amalLogin.json.accessToken;

      const amalMe = await req(baseUrl, 'GET', '/api/customers/me', { token: amalToken });
      assert.equal(amalMe.status, 200);
      assert.equal(amalMe.json.customer.id, autoUserRes.json.user.linkedCustomerId);
      assert.equal(amalMe.json.linkWarning, null);

      const bootAuto = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const prodAny = bootAuto.products[0];
      const amalOrd = await req(baseUrl, 'POST', '/api/orders', {
        token: amalToken,
        body: { items: [{ productId: prodAny.id, unit: prodAny.baseUnit, quantity: 1 }] },
      });
      assert.equal(amalOrd.status, 201);

      // Attempting to link another user to an already-linked customer -> 409
      const dupLinkRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'عميل متضارب',
          username: 'cust_conflict_try',
          password: 'Password!123',
          role: 'customer',
          linkedCustomerId: autoUserRes.json.user.linkedCustomerId,
        },
      });
      assert.equal(dupLinkRes.status, 409);

      // 2. Unlinked customer user created with autoCreateCustomerProfile: false gets repaired in one click
      const unlinkedRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'عميل قديم غير مربوط',
          username: 'cust_legacy_unlinked',
          password: 'LegacyPassword!123',
          phone: '01088887777',
          role: 'customer',
          autoCreateCustomerProfile: false,
        },
      });
      assert.equal(unlinkedRes.status, 201);
      assert.equal(unlinkedRes.json.user.linkedCustomerId, undefined);

      const fixRes = await req(baseUrl, 'POST', '/api/customers/conflicts/fix-unlinked', { token: adminToken });
      assert.equal(fixRes.status, 200);
      assert.ok(fixRes.json.repairedCount >= 1);
      assert.ok(fixRes.json.repaired.some((r) => r.userId === unlinkedRes.json.user.id));
    });

    await test('41. Packaging config excludes backup & server/data artifacts from Windows and Vite builds', async () => {
      const rootDir = process.cwd();
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
      assert.equal(pkg.build?.extraResources, undefined, 'package.json must not bundle server/data via extraResources');
      assert.ok(Array.isArray(pkg.build?.files) && pkg.build.files.includes('!server/data/**/*'));
      assert.ok(pkg.build.files.includes('!server/tests/**/*'));
      assert.ok(!pkg.build.files.some((entry) => String(entry).includes('AWLAD_SELIM_BACKUP')));
      const unpackedAppDir = path.join(rootDir, 'dist-electron', 'win-unpacked', 'resources', 'app');
      if (fs.existsSync(unpackedAppDir)) {
        assert.equal(fs.existsSync(path.join(unpackedAppDir, 'AWLAD_SELIM_BACKUP')), false, 'AWLAD_SELIM_BACKUP must never leak into packaged app');
        assert.equal(fs.existsSync(path.join(unpackedAppDir, 'server', 'data')), false, 'server/data must never leak into packaged app');
      }
    });

    let prodCustody;

    await test('43. Public registration (/api/auth/register), direct custody dispatch & partial delivery, and rep invoice mark-reviewed without duplicates', async () => {
      // 1. Public registration: customer & representative succeed, admin rejected 403
      const regAdminBlocked = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          fullName: 'محاولة أدمن',
          username: 'self_reg_admin_try',
          password: 'Password!123',
          phone: '01012340001',
          role: 'admin',
        },
      });
      assert.equal(regAdminBlocked.status, 403);

      const regCust = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          fullName: 'عميل تسجيل ذاتي',
          username: 'self_reg_cust_1',
          password: 'Password!123',
          phone: '01012340002',
          address: 'شارع الثورة - طنطا',
          shopName: 'ماركت النجاح',
          role: 'customer',
        },
      });
      assert.equal(regCust.status, 201);
      assert.equal(regCust.json.user.role, 'customer');
      assert.ok(regCust.json.customerProfile?.id);
      assert.ok(regCust.json.accessToken);
      assertNoSensitiveFields(regCust.json, 'register customer');

      const regRep = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          fullName: 'مندوب تسجيل ذاتي',
          username: 'self_reg_rep_1',
          password: 'Password!123',
          phone: '01012340003',
          vehicleNumber: 'ع س 4455',
          role: 'representative',
        },
      });
      assert.equal(regRep.status, 201);
      assert.equal(regRep.json.user.role, 'representative');
      assert.ok(regRep.json.representativeProfile?.id);
      assert.ok(regRep.json.representativeProfile?.warehouseId);
      assert.ok(regRep.json.accessToken);
      assertNoSensitiveFields(regRep.json, 'register rep');

      // 2. Fresh isolated product for custody dispatch, quotes, and item-movement profit tests
      const pCustRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'P-CUSTODY-1',
          barcode: '622000900',
          name: 'بسكويت عهدة وحركة',
          category: 'بسكويت',
          baseUnit: 'قطعة',
          purchasePrice: 10,
          sellingPrice: 18,
          minStockLevel: 5,
          stockPerWarehouse: { [whMainId]: 200 },
          status: 'active',
        },
      });
      assert.equal(pCustRes.status, 201);
      prodCustody = pCustRes.json.product;

      // 3. Direct custody dispatch (100 units): deducts main warehouse immediately, holds rep van until 'received'
      const vanBefore = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data
        .products.find((p) => p.id === prodCustody.id).stockPerWarehouse[repVanWhId] || 0;
      assert.equal(vanBefore, 0);

      const dispRes = await req(baseUrl, 'POST', '/api/inventory/rep-item-transfers', {
        token: adminToken,
        body: {
          representativeId: repProfileId,
          sourceWarehouseId: whMainId,
          targetWarehouseId: repVanWhId,
          transferMode: 'custody_dispatch',
          autoDispatch: true,
          notes: 'صرف عهدة أولية للمندوب',
          items: [
            {
              productId: prodCustody.id,
              productName: prodCustody.name,
              unit: 'قطعة',
              requestedQty: 100,
            },
          ],
        },
      });
      assert.equal(dispRes.status, 201);
      assert.equal(dispRes.json.request.transferMode, 'custody_dispatch');
      assert.equal(dispRes.json.request.status, 'executed');

      // Main warehouse deducted 200 -> 100 immediately, van STILL 0 until rep confirms receipt
      const bootInTransit = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const prodInTransit = bootInTransit.products.find((p) => p.id === prodCustody.id);
      assert.equal(prodInTransit.stockPerWarehouse[whMainId], 100);
      assert.equal(Number(prodInTransit.stockPerWarehouse[repVanWhId] || 0), 0);

      const stmtPending = (await req(baseUrl, 'GET', `/api/inventory/rep-custody/statement?repId=${repProfileId}`, { token: adminToken })).json.statement;
      const pendingItem = stmtPending.itemsSummary.find((i) => i.productId === prodCustody.id);
      assert.equal(pendingItem.pendingReceiveQty, 100);

      // Rep confirms receipt -> van credited +100 (0 -> 100)
      const recRes = await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${dispRes.json.request.id}/status`, {
        token: tokenRep,
        body: { status: 'received', notes: 'تم استلام العهدة بالكامل' },
      });
      assert.equal(recRes.status, 200);

      const bootAfterRec = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootAfterRec.products.find((p) => p.id === prodCustody.id).stockPerWarehouse[repVanWhId], 100);

      // Partial custody delivery: 30 of 100 -> leaves 70 remainingCustodyQty
      const delivRes = await req(baseUrl, 'POST', '/api/inventory/rep-custody/deliver', {
        token: tokenRep,
        headers: { 'Idempotency-Key': 'custody-deliv-43-1' },
        body: {
          representativeId: repProfileId,
          customerId: custA.id,
          items: [{ productId: prodCustody.id, unit: 'قطعة', quantity: 30 }],
          notes: 'تسليم جزئي أول للعميل',
        },
      });
      assert.equal(delivRes.status, 201);

      const stmtAfterDeliv = (await req(baseUrl, 'GET', `/api/inventory/rep-custody/statement?repId=${repProfileId}`, { token: adminToken })).json.statement;
      const custItemSum = stmtAfterDeliv.itemsSummary.find((i) => i.productId === prodCustody.id);
      assert.equal(custItemSum.receivedQty, 100);
      assert.equal(custItemSum.deliveredToCustomersQty, 30);
      assert.equal(custItemSum.remainingCustodyQty, 70);
      assert.equal(custItemSum.vanPhysicalStockQty, 70);

      // 4. Rep creates confirmed sales invoice -> needs_review -> mark-reviewed with ZERO duplicate stock/GL/balance effect
      const repSaleRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: tokenRep,
        body: {
          customerId: custA.id,
          warehouseId: repVanWhId,
          cashboxId: cashboxMainId,
          status: 'confirmed',
          paymentType: 'credit',
          paidAmount: 0,
          items: [{ productId: prod1.id, productName: prod1.name, unit: 'قطعة', unitFactor: 1, quantity: 2, unitPrice: 15 }],
        },
      });
      assert.equal(repSaleRes.status, 201);
      const repSaleInv = repSaleRes.json.invoice;
      assert.equal(repSaleInv.reviewStatus, 'needs_review');

      // Rep blocked from marking own invoice reviewed -> 403
      const repSelfRev = await req(baseUrl, 'POST', `/api/invoices/${repSaleInv.id}/mark-reviewed`, {
        token: tokenRep,
        body: { notes: 'محاولة مراجعة ذاتية' },
      });
      assert.equal(repSelfRev.status, 403);

      const bootPreReview = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const prod1StockPre = bootPreReview.products.find((p) => p.id === prod1.id).stockPerWarehouse[repVanWhId];
      const custABalPre = bootPreReview.customers.find((c) => c.id === custA.id).currentBalance;
      const txCountPre = bootPreReview.financialTransactions.length;

      const adminRevRes = await req(baseUrl, 'POST', `/api/invoices/${repSaleInv.id}/mark-reviewed`, {
        token: adminToken,
        body: { notes: 'تمت مراجعة الفاتورة ومطابقة الأسعار' },
      });
      assert.equal(adminRevRes.status, 200);
      assert.equal(adminRevRes.json.invoice.reviewStatus, 'reviewed');
      assert.ok(adminRevRes.json.invoice.reviewedBy);

      const bootPostReview = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootPostReview.products.find((p) => p.id === prod1.id).stockPerWarehouse[repVanWhId], prod1StockPre);
      assert.equal(bootPostReview.customers.find((c) => c.id === custA.id).currentBalance, custABalPre);
      assert.equal(bootPostReview.financialTransactions.length, txCountPre);
    });

    await test('44. Sales quote + 1:1 convert, cost-based Item Movement Report, 9-stage order lifecycle & purchases role RBAC', async () => {
      // 1. Create Quote -> zero stock/balance/GL impact; then convert 1:1 to confirmed sales invoice
      const bootPreQuote = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const stockPreQuote = bootPreQuote.products.find((p) => p.id === prodCustody.id).stockPerWarehouse[whMainId];
      const balPreQuote = bootPreQuote.customers.find((c) => c.id === custA.id).currentBalance;
      const ftPreQuote = bootPreQuote.financialTransactions.length;

      const quoteRes = await req(baseUrl, 'POST', '/api/invoices/quotes', {
        token: adminToken,
        body: {
          customerId: custA.id,
          warehouseId: whMainId,
          cashboxId: cashboxMainId,
          items: [{ productId: prodCustody.id, productName: prodCustody.name, unit: 'قطعة', unitFactor: 1, quantity: 5, unitPrice: 20 }],
          notes: 'عرض سعر ساري 7 أيام',
        },
      });
      assert.equal(quoteRes.status, 201);
      const quote = quoteRes.json.invoice;
      assert.equal(quote.type, 'quote');
      assert.equal(quote.grandTotal, 100);

      const bootPostQuote = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootPostQuote.products.find((p) => p.id === prodCustody.id).stockPerWarehouse[whMainId], stockPreQuote);
      assert.equal(bootPostQuote.customers.find((c) => c.id === custA.id).currentBalance, balPreQuote);
      assert.equal(bootPostQuote.financialTransactions.length, ftPreQuote);

      const convQuoteRes = await req(baseUrl, 'POST', `/api/invoices/quotes/${quote.id}/convert`, {
        token: adminToken,
        body: { status: 'confirmed', paymentType: 'credit', paidAmount: 0 },
      });
      assert.equal(convQuoteRes.status, 201);
      const convertedInv = convQuoteRes.json.invoice;
      assert.equal(convertedInv.type, 'sales');
      assert.equal(convertedInv.status, 'confirmed');
      assert.equal(convertedInv.grandTotal, 100);

      const bootPostConv = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootPostConv.products.find((p) => p.id === prodCustody.id).stockPerWarehouse[whMainId], stockPreQuote - 5);
      assert.equal(bootPostConv.customers.find((c) => c.id === custA.id).currentBalance, balPreQuote + 100);

      // 2. Direct warehouse transfer (10 units) + Item Movement Report cost-based profit verification
      const whTrRes = await req(baseUrl, 'POST', '/api/inventory/transfer', {
        token: adminToken,
        body: {
          productId: prodCustody.id,
          fromWarehouseId: whMainId,
          toWarehouseId: whSecondId,
          quantity: 10,
          notes: 'نقل تجريبي للفرع',
        },
      });
      assert.equal(whTrRes.status, 200);

      const movRepRes = await req(baseUrl, 'GET', `/api/inventory/item-movement-report?productId=${prodCustody.id}`, { token: adminToken });
      assert.equal(movRepRes.status, 200);
      const report = movRepRes.json.report;
      assert.ok(report.sections.sales.length === 1);
      assert.ok(report.sections.transfers.length >= 1);
      assert.ok(report.sections.custody_sent.length >= 1);
      assert.ok(report.sections.custody_received.length >= 1);
      assert.ok(report.sections.custody_deliveries.length >= 1);
      // 5 sold @ 20 = 100, cost = 5 * 10 = 50 -> profit = 50; warehouse transfers must NOT inflate sales totals!
      assert.equal(report.totals.totalSalesQty, 5);
      assert.equal(report.totals.totalSalesValue, 100);
      assert.equal(report.totals.totalCostOfGoodsSold, 50);
      assert.equal(report.totals.totalProfit, 50);

      // 3. 9-stage customer order lifecycle + linked invoice payment summary
      const ord9Res = await req(baseUrl, 'POST', '/api/orders', {
        token: tokenCustA,
        body: {
          items: [{ productId: prodCustody.id, unit: 'قطعة', quantity: 4 }],
          notes: 'طلب 9 مراحل',
        },
      });
      assert.equal(ord9Res.status, 201);
      const ord9Id = ord9Res.json.order.id;

      assert.equal((await req(baseUrl, 'POST', `/api/orders/${ord9Id}/review`, { token: adminToken, body: {} })).status, 200);
      assert.equal((await req(baseUrl, 'POST', `/api/orders/${ord9Id}/approve`, { token: adminToken, body: {} })).status, 200);

      const prepRes = await req(baseUrl, 'POST', `/api/orders/${ord9Id}/stage`, {
        token: adminToken,
        body: { stage: 'preparing', notes: 'جاري تجهيز الطلب' },
      });
      assert.equal(prepRes.status, 200);
      assert.equal(prepRes.json.order.status, 'preparing');

      const assignRes = await req(baseUrl, 'POST', `/api/orders/${ord9Id}/assign-rep`, {
        token: adminToken,
        body: { repId: repProfileId },
      });
      assert.equal(assignRes.status, 200);
      assert.equal(assignRes.json.order.status, 'rep_assigned');

      const invOrd9 = await req(baseUrl, 'POST', `/api/orders/${ord9Id}/convert-to-invoice`, {
        token: adminToken,
        body: {
          warehouseId: whMainId,
          cashboxId: cashboxMainId,
          status: 'confirmed',
          paymentType: 'credit',
          paidAmount: 0,
        },
      });
      assert.equal(invOrd9.status, 201);
      assert.equal(invOrd9.json.order.status, 'invoiced');

      assert.equal(
        (await req(baseUrl, 'POST', `/api/orders/${ord9Id}/stage`, { token: tokenRep, body: { stage: 'out_for_delivery' } })).status,
        200
      );
      assert.equal(
        (await req(baseUrl, 'POST', `/api/orders/${ord9Id}/stage`, { token: tokenRep, body: { stage: 'delivered' } })).status,
        200
      );
      const collectRes = await req(baseUrl, 'POST', `/api/orders/${ord9Id}/stage`, {
        token: tokenRep,
        body: { stage: 'collected', collectedAmount: 40, cashboxId: cashboxMainId, paymentMethod: 'cash', notes: 'تحصيل جزئي 40' },
      });
      assert.equal(collectRes.status, 200);
      assert.equal(collectRes.json.order.status, 'collected');

      const closeRes = await req(baseUrl, 'POST', `/api/orders/${ord9Id}/stage`, {
        token: adminToken,
        body: { stage: 'closed', notes: 'إغلاق نهائي للطلب' },
      });
      assert.equal(closeRes.status, 200);

      const finalOrd9 = (await req(baseUrl, 'GET', `/api/orders/${ord9Id}`, { token: adminToken })).json.order;
      assert.equal(finalOrd9.status, 'closed');
      assert.equal(finalOrd9.invoiceTotal, 72); // 4 * 18
      assert.equal(finalOrd9.invoicePaidAmount, 40);
      assert.equal(finalOrd9.invoiceRemainingAmount, 32);
      assert.equal(finalOrd9.paymentStatus, 'partial');
      assert.ok(Array.isArray(finalOrd9.paymentsHistory) && finalOrd9.paymentsHistory.length === 1);

      // 4. 'purchases' role RBAC enforcement
      const purUserRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'موظف مشتريات اختبار',
          username: 'pur_clerk_1',
          password: 'PurPassword!123',
          role: 'purchases',
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: true,
            canManagePurchases: true,
            canManageSuppliers: true,
            canManageInventory: true,
            canManageWarehouses: true,
            canViewReports: true,
          },
        },
      });
      assert.equal(purUserRes.status, 201);
      const tokenPurchases = (await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'pur_clerk_1', password: 'PurPassword!123' },
      })).json.accessToken;

      const bootPur = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: tokenPurchases })).json.data;
      const suppIdPur = bootPur.suppliers[0].id;

      // Allowed: Purchase invoice + Inventory transfer
      const okPurInv = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: tokenPurchases,
        body: {
          supplierId: suppIdPur,
          warehouseId: whMainId,
          cashboxId: cashboxMainId,
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prodCustody.id, productName: prodCustody.name, unit: 'قطعة', unitFactor: 1, quantity: 5, unitPrice: 10 }],
        },
      });
      assert.equal(okPurInv.status, 201);
      assert.equal(
        (await req(baseUrl, 'POST', '/api/inventory/transfer', {
          token: tokenPurchases,
          body: { productId: prodCustody.id, fromWarehouseId: whMainId, toWarehouseId: whSecondId, quantity: 1 },
        })).status,
        200
      );

      // Blocked 403: Sales invoice, Cashboxes / Cash operations, Users management
      assert.equal(
        (await req(baseUrl, 'POST', '/api/invoices/sales', {
          token: tokenPurchases,
          body: {
            customerId: custA.id,
            warehouseId: whMainId,
            cashboxId: cashboxMainId,
            status: 'draft',
            paymentType: 'credit',
            paidAmount: 0,
            items: [{ productId: prodCustody.id, productName: prodCustody.name, unit: 'قطعة', unitFactor: 1, quantity: 1, unitPrice: 18 }],
          },
        })).status,
        403
      );
      assert.equal(
        (await req(baseUrl, 'POST', '/api/admin/cashboxes', {
          token: tokenPurchases,
          body: { name: 'خزينة غير مصرحة', type: 'cashbox', openingBalance: 0 },
        })).status,
        403
      );
      assert.equal(
        (await req(baseUrl, 'POST', '/api/admin/cash-operations', {
          token: tokenPurchases,
          body: { type: 'cash_deposit', cashboxId: cashboxMainId, amount: 10 },
        })).status,
        403
      );
      assert.equal(
        (await req(baseUrl, 'POST', '/api/admin/users', {
          token: tokenPurchases,
          body: { fullName: 'X', username: 'pur_mk_usr', password: 'Password!123', role: 'sales' },
        })).status,
        403
      );
    });

    await test('47. Single Unit catalog (empty default, CRUD, search, rename isolated from history) & Cash/Partial/Credit Purchase & Sales accounting (JSON)', async () => {
      // 1. Fresh DB starts with zero hardcoded default units
      const emptyState = createEmptyDatabaseState();
      assert.equal(Array.isArray(emptyState.productUnits), true);
      assert.equal(emptyState.productUnits.length, 0);

      const initialUnitsRes = await req(baseUrl, 'GET', '/api/products/units', { token: adminToken });
      assert.equal(initialUnitsRes.status, 200);
      assert.ok(!initialUnitsRes.json.productUnits.some((u) => ['u-piece', 'u-carton12', 'u-sack25'].includes(u.id)));

      // 2. Group, Category & Unit CRUD + duplicate guard + partial search
      const grpRes = await req(baseUrl, 'POST', '/api/products/groups', {
        token: adminToken,
        body: { name: 'مجموعة وحدة اختبار' },
      });
      assert.equal(grpRes.status, 201);
      const grpId = grpRes.json.productGroup.id;

      const catRes = await req(baseUrl, 'POST', '/api/products/categories', {
        token: adminToken,
        body: { name: 'تصنيف وحدة اختبار', groupId: grpId },
      });
      assert.equal(catRes.status, 201);
      const catId = catRes.json.category.id;

      const uCreate = await req(baseUrl, 'POST', '/api/products/units', {
        token: adminToken,
        body: { name: 'بالتة قياس', shortCode: 'PLT' },
      });
      assert.equal(uCreate.status, 201);
      const unitId = uCreate.json.productUnit.id;

      // Normalized duplicate block
      const uDup = await req(baseUrl, 'POST', '/api/products/units', {
        token: adminToken,
        body: { name: 'بالـتة  قياس' },
      });
      assert.equal(uDup.status, 409);

      // Search by partial name
      const uSearch = await req(baseUrl, 'GET', '/api/products/units?search=' + encodeURIComponent('بالتة'), {
        token: adminToken,
      });
      assert.equal(uSearch.status, 200);
      assert.ok(uSearch.json.productUnits.some((u) => u.id === unitId));

      // 3. Create wholesale product linked to Group/Category/single Unit (units: [])
      const bootBase = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const whId = bootBase.warehouses[0].id;
      const cbId = bootBase.cashboxes[0].id;
      const custId = bootBase.customers[0].id;
      const suppId = bootBase.suppliers[0].id;

      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: 'منتج وحدة مفردة JSON',
          groupId: grpId,
          categoryId: catId,
          category: 'تصنيف وحدة اختبار',
          unitId,
          baseUnit: 'بالتة قياس',
          units: [],
          purchasePrice: 100,
          sellingPrice: 110,
          stockPerWarehouse: { [whId]: 30 },
          status: 'active',
        },
      });
      assert.equal(prodRes.status, 201);
      const pSingle = prodRes.json.product;
      assert.equal(pSingle.unitId, unitId);
      assert.equal(pSingle.baseUnit, 'بالتة قياس');
      assert.equal((pSingle.units || []).length, 0);

      // 4. Create historical sales invoice with old unit snapshot, then rename unit
      const histSale = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId: custId,
          warehouseId: whId,
          cashboxId: cbId,
          status: 'confirmed',
          paymentType: 'credit',
          paidAmount: 0,
          items: [{ productId: pSingle.id, productName: pSingle.name, unit: 'بالتة قياس', unitFactor: 1, quantity: 1, unitPrice: 110 }],
        },
      });
      assert.equal(histSale.status, 201);
      const histSaleId = histSale.json.invoice.id;

      // Rename unit -> updates current product ONLY, historical invoice snapshot remains untouched
      const uRename = await req(baseUrl, 'PUT', `/api/products/units/${unitId}`, {
        token: adminToken,
        body: { name: 'شرنك جملة' },
      });
      assert.equal(uRename.status, 200);

      const bootRenamed = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const updatedProd = bootRenamed.products.find((p) => p.id === pSingle.id);
      assert.equal(updatedProd.baseUnit, 'شرنك جملة');
      assert.equal(updatedProd.unitId, unitId);

      const histInvAfter = bootRenamed.invoices.find((i) => i.id === histSaleId);
      assert.equal(histInvAfter.items[0].unit, 'بالتة قياس');

      // Delete guard while used by product -> 409, then unlinked unit delete -> 200
      const uDelBlocked = await req(baseUrl, 'DELETE', `/api/products/units/${unitId}`, { token: adminToken });
      assert.equal(uDelBlocked.status, 409);

      const uUnused = await req(baseUrl, 'POST', '/api/products/units', {
        token: adminToken,
        body: { name: 'وحدة للحذف' },
      });
      assert.equal(uUnused.status, 201);
      const uDelOk = await req(baseUrl, 'DELETE', `/api/products/units/${uUnused.json.productUnit.id}`, { token: adminToken });
      assert.equal(uDelOk.status, 200);

      // 5. Purchase & Sales Cash / Partial / Credit balances check (and subsequent payment)
      const cbStart = bootRenamed.cashboxes.find((c) => c.id === cbId).currentBalance;
      const suppStart = bootRenamed.suppliers.find((s) => s.id === suppId).currentBalance;
      const custStart = bootRenamed.customers.find((c) => c.id === custId).currentBalance;

      // Cash purchase (100 total, 100 paid) -> cashbox -100, supplier +0
      assert.equal(
        (await req(baseUrl, 'POST', '/api/invoices/purchase', {
          token: adminToken,
          body: {
            supplierId: suppId, warehouseId: whId, cashboxId: cbId,
            status: 'confirmed', paymentType: 'cash', paymentMethod: 'cash', paidAmount: 100,
            items: [{ productId: pSingle.id, productName: pSingle.name, unit: 'شرنك جملة', unitFactor: 1, quantity: 1, unitPrice: 100 }],
          },
        })).status,
        201
      );
      // Partial purchase (100 total, 40 paid, 60 credit) -> cashbox -40, supplier +60
      assert.equal(
        (await req(baseUrl, 'POST', '/api/invoices/purchase', {
          token: adminToken,
          body: {
            supplierId: suppId, warehouseId: whId, cashboxId: cbId,
            status: 'confirmed', paymentType: 'partial', paymentMethod: 'cash', paidAmount: 40,
            items: [{ productId: pSingle.id, productName: pSingle.name, unit: 'شرنك جملة', unitFactor: 1, quantity: 1, unitPrice: 100 }],
          },
        })).status,
        201
      );
      // Credit purchase (100 total, 0 paid) -> cashbox +0, supplier +100
      assert.equal(
        (await req(baseUrl, 'POST', '/api/invoices/purchase', {
          token: adminToken,
          body: {
            supplierId: suppId, warehouseId: whId, cashboxId: cbId,
            status: 'confirmed', paymentType: 'credit', paymentMethod: 'cash', paidAmount: 0,
            items: [{ productId: pSingle.id, productName: pSingle.name, unit: 'شرنك جملة', unitFactor: 1, quantity: 1, unitPrice: 100 }],
          },
        })).status,
        201
      );

      // Cash sale (110 total, 110 paid) -> cashbox +110, customer +0
      assert.equal(
        (await req(baseUrl, 'POST', '/api/invoices/sales', {
          token: adminToken,
          body: {
            customerId: custId, warehouseId: whId, cashboxId: cbId,
            status: 'confirmed', paymentType: 'cash', paymentMethod: 'cash', paidAmount: 110,
            items: [{ productId: pSingle.id, productName: pSingle.name, unit: 'شرنك جملة', unitFactor: 1, quantity: 1, unitPrice: 110 }],
          },
        })).status,
        201
      );
      // Partial sale (110 total, 50 paid, 60 credit) -> cashbox +50, customer +60
      const pSaleRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId: custId, warehouseId: whId, cashboxId: cbId,
          status: 'confirmed', paymentType: 'partial', paymentMethod: 'cash', paidAmount: 50,
          items: [{ productId: pSingle.id, productName: pSingle.name, unit: 'شرنك جملة', unitFactor: 1, quantity: 1, unitPrice: 110 }],
        },
      });
      assert.equal(pSaleRes.status, 201);
      assert.equal(pSaleRes.json.invoice.remainingAmount, 60);

      // Settle remaining 60 on partial sale -> cashbox +60, customer -60
      const payRem = await req(baseUrl, 'POST', `/api/invoices/${pSaleRes.json.invoice.id}/payments`, {
        token: adminToken,
        body: { amount: 60, cashboxId: cbId, paymentMethod: 'cash', notes: 'سداد باقي الجزئي' },
      });
      assert.equal(payRem.status, 200);
      assert.equal(payRem.json.invoice.remainingAmount, 0);
      assert.equal(payRem.json.invoice.paymentType, 'cash');

      const bootAfterFin = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const cbAfter = bootAfterFin.cashboxes.find((c) => c.id === cbId).currentBalance;
      const suppAfter = bootAfterFin.suppliers.find((s) => s.id === suppId).currentBalance;
      const custAfter = bootAfterFin.customers.find((c) => c.id === custId).currentBalance;

      // Net cashbox: -100 -40 +110 +50 +60 = +80
      assert.equal(cbAfter, cbStart + 80);
      // Net supplier: +0 +60 +100 = +160
      assert.equal(suppAfter, suppStart + 160);
      // Net customer: +0 +60 -60 = 0
      assert.equal(custAfter, custStart);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runSuiteB_PostgresPgMem() {
  console.log('\n=== Suite B: PostgreSQL SQL Schema, Migrator Conflict Handling & Live PG HTTP API (pg-mem) ===');
  const pgPool = createPgMemPool();

  await test('14. Initialize PostgreSQL 33-table DDL schema cleanly', async () => {
    const res = await initializeSchema(pgPool);
    assert.equal(res.success, true, `PG schema init failed: ${res.error}`);
  });

  await test('15. Migrator migrates JSON dataset -> PG, preserves duplicate-phone safety, verifies sums, and tests rollback', async () => {
    const sourceData = readJsonDatabase();
    // Add an extra unlinked user & customer matching a unique phone + confirm CustA/B duplicate phone warning triggers
    const uniqCustId = 'CUST-UNIQ-PG';
    const uniqUserId = 'USR-UNIQ-PG';
    const shaPw = crypto.createHash('sha256').update('UniqPass!1' + LEGACY_SALT).digest('hex');

    sourceData.users.push({
      id: uniqUserId,
      fullName: 'عميل فريد للربط',
      username: 'uniq_cust_pg',
      passwordHash: shaPw,
      phone: '01555555555',
      role: 'customer',
      jobTitle: 'عميل',
      department: 'العملاء',
      isActive: true,
      permissions: { canView: true },
      createdAt: new Date().toISOString(),
    });
    sourceData.customers.push({
      id: uniqCustId,
      code: 'C-UNIQ',
      name: 'عميل الهاتف الفريد',
      shopName: 'متجر الفريد',
      phone: '01555555555',
      address: 'القاهرة',
      openingBalance: 100,
      currentBalance: 100,
      status: 'active',
      priceHistory: {},
      createdAt: new Date().toISOString(),
    });
    // Also add an unlinked duplicate phone customer + user pair to prove migrator does NOT auto-link duplicates!
    sourceData.users.push({
      id: 'USR-DUP-PHONE',
      fullName: 'مستخدم هاتف مكرر',
      username: 'dup_phone_user',
      passwordHash: shaPw,
      phone: '01234567890',
      role: 'customer',
      jobTitle: 'عميل',
      department: 'العملاء',
      isActive: true,
      permissions: { canView: true },
      createdAt: new Date().toISOString(),
    });
    sourceData.customers.push({
      id: 'CUST-DUP-PHONE',
      code: 'C-DUP',
      name: 'عميل هاتف مكرر غير مربوط',
      shopName: 'متجر مكرر',
      phone: '01234567890',
      address: 'الجيزة',
      openingBalance: 0,
      currentBalance: 0,
      status: 'active',
      priceHistory: {},
      createdAt: new Date().toISOString(),
    });

    const migRes = await runDataMigration(sourceData, 'اختبار الترحيل التلقائي', {
      targetPool: pgPool,
    });
    assert.equal(migRes.success, true, `Migration failed: ${migRes.error}`);
    assert.equal(migRes.log.details.verification.countsMatch, true, 'Row counts MUST match 100%!');
    assert.equal(migRes.log.details.verification.balancesMatch, true, 'Balance sums MUST match 100%!');

    // Verify unique phone customer linked cleanly while duplicate phone user produced warning
    const custUniqRow = (await pgPool.query('SELECT user_id FROM customers WHERE id = $1', [uniqCustId])).rows[0];
    assert.equal(custUniqRow.user_id, uniqUserId, 'Unambiguous unique-phone customer should be linked to user_id');
    assert.ok(migRes.log.details.warnings.length >= 1, 'Ambiguous duplicate phone should emit warning rather than cross-linking');
    assert.ok(migRes.log.details.backupFile && fs.existsSync(migRes.log.details.backupFile), 'Pre-migration immutable backup created');

    // Test rollback cleanly restores JSON snapshot & clears PG target, then re-migrate clean Suite A dataset for Test 16
    const rbRes = await rollbackMigration(migRes.log.id, 'اختبار التراجع', pgPool);
    assert.equal(rbRes.success, true);
    const afterRbCount = Number((await pgPool.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c);
    assert.equal(afterRbCount, 0);

    const cleanData = readJsonDatabase();
    const reMig = await runDataMigration(cleanData, 'إعادة الترحيل للاختبار الحي', { targetPool: pgPool });
    assert.equal(reMig.success, true, `Clean re-migration failed: ${reMig.error}`);
  });

  // Switch live runtime mode to PostgreSQL via injected pg-mem pool and run HTTP API checks!
  setInjectedPool(pgPool);
  resetPgModeCache();
  const appPg = createApiApp();
  const serverPg = http.createServer(appPg);
  await new Promise((resolve) => serverPg.listen(0, '127.0.0.1', resolve));
  const { port } = serverPg.address();
  const baseUrlPg = `http://127.0.0.1:${port}`;

  try {
    await test('16. Live Express HTTP API backed by PostgreSQL SQL queries passes auth, isolation & ACID invoice lifecycle', async () => {
      const h = await req(baseUrlPg, 'GET', '/api/health');
      assert.equal(h.status, 200);
      assert.equal(h.json.mode, 'postgresql-enterprise');

      const adminLogin = await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
      });
      assert.equal(adminLogin.status, 200);
      const pgAdminToken = adminLogin.json.accessToken;

      const custALogin = await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: 'cust_baraka', password: 'CustomerPassword!1' },
      });
      assert.equal(custALogin.status, 200);
      const pgCustAToken = custALogin.json.accessToken;

      const custBLogin = await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: 'cust_salam', password: 'CustomerPassword!2' },
      });
      assert.equal(custBLogin.status, 200);
      const pgCustBToken = custBLogin.json.accessToken;

      // Customer isolation on PG
      const custDbBlocked = await req(baseUrlPg, 'GET', '/api/database', { token: pgCustAToken });
      assert.equal(custDbBlocked.status, 403);

      const pgProdRes = await req(baseUrlPg, 'GET', '/api/products', { token: pgCustAToken });
      assert.equal(pgProdRes.status, 200);
      assert.equal(pgProdRes.json.products[0].purchasePrice, undefined);
      const prodId = (pgProdRes.json.products.find((p) => p.code === 'P-100') || pgProdRes.json.products[0]).id;

      // Create Order on PG + Idempotency + Isolation + Approve + Convert + Confirm
      const pgOrderRes = await req(baseUrlPg, 'POST', '/api/orders', {
        token: pgCustAToken,
        headers: { 'Idempotency-Key': 'pg-idem-1' },
        body: {
          items: [{ productId: prodId, unit: 'قطعة', quantity: 3 }],
          notes: 'طلب PostgreSQL',
        },
      });
      assert.equal(pgOrderRes.status, 201);
      const pgOrder = pgOrderRes.json.order;

      const pgCustBForbidden = await req(baseUrlPg, 'GET', `/api/orders/${pgOrder.id}`, { token: pgCustBToken });
      assert.equal(pgCustBForbidden.status, 403);

      const pgApp = await req(baseUrlPg, 'POST', `/api/orders/${pgOrder.id}/approve`, { token: pgAdminToken, body: {} });
      assert.equal(pgApp.status, 200);

      const pgBoot = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const whId = pgBoot.warehouses[0].id;
      const cbId = pgBoot.cashboxes[0].id;
      const stockBefore = pgBoot.products.find((p) => p.id === prodId).stockPerWarehouse[whId];

      const pgConv = await req(baseUrlPg, 'POST', `/api/orders/${pgOrder.id}/convert-to-invoice`, {
        token: pgAdminToken,
        body: {
          warehouseId: whId,
          warehouseName: pgBoot.warehouses[0].name,
          cashboxId: cbId,
          status: 'draft',
          paymentType: 'credit',
          paidAmount: 0,
          items: [{ productId: prodId, productName: 'شيبسي عائلي ملح', unit: 'قطعة', unitFactor: 1, quantity: 3, unitPrice: 15 }],
        },
      });
      assert.equal(pgConv.status, 201);

      const pgBootDraft = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      assert.equal(pgBootDraft.products.find((p) => p.id === prodId).stockPerWarehouse[whId], stockBefore);

      const pgConf = await req(baseUrlPg, 'POST', `/api/invoices/${pgConv.json.invoice.id}/confirm`, {
        token: pgAdminToken,
      });
      assert.equal(pgConf.status, 200);

      const pgBootAfter = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      assert.equal(pgBootAfter.products.find((p) => p.id === prodId).stockPerWarehouse[whId], stockBefore - 3);
    });

    await test('22. Live PostgreSQL HTTP API executes cash operations, personal accounts, stock counts & stock transfers cleanly', async () => {
      const adminLogin = await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
      });
      const pgAdminToken = adminLogin.json.accessToken;
      const boot = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const wh1 = boot.warehouses[0].id;
      const wh2 = boot.warehouses[1].id;
      const cb1 = boot.cashboxes[0].id;
      const prod = boot.products.find((p) => p.code === 'P-100') || boot.products[0];
      const stockWh1Before = Number(prod.stockPerWarehouse[wh1] || 0);
      const stockWh2Before = Number(prod.stockPerWarehouse[wh2] || 0);
      const cbBefore = Number(boot.cashboxes[0].currentBalance || 0);

      // 1. PG Cash Operation
      const pgCashOp = await req(baseUrlPg, 'POST', '/api/admin/cash-operations', {
        token: pgAdminToken,
        headers: { 'Idempotency-Key': 'pg-cashop-1' },
        body: { type: 'cash_deposit', cashboxId: cb1, amount: 200, category: 'إيداع PG' },
      });
      assert.equal(pgCashOp.status, 201);

      // 2. PG Owner Personal Account + Linked Withdrawal
      const pgOwner = await req(baseUrlPg, 'POST', '/api/personal-accounts', {
        token: pgAdminToken,
        body: { ownerName: 'طارق', accountName: 'حساب PG', openingBalance: 300 },
      });
      assert.equal(pgOwner.status, 201);
      const pgOwnerTx = await req(baseUrlPg, 'POST', `/api/personal-accounts/${pgOwner.json.account.id}/transactions`, {
        token: pgAdminToken,
        body: { type: 'personal_withdrawal', amount: 50, cashboxId: cb1, notes: 'سحب PG' },
      });
      assert.equal(pgOwnerTx.status, 201);
      assert.equal(pgOwnerTx.json.account.currentBalance, 250);

      // 3. PG Stock Count create -> submit -> approve (-1 unit)
      const pgCnt = await req(baseUrlPg, 'POST', '/api/stock-counts', {
        token: pgAdminToken,
        body: { warehouseId: wh1, items: [{ productId: prod.id, actualQty: stockWh1Before - 1, reason: 'جرد PG' }] },
      });
      assert.equal(pgCnt.status, 201);
      assert.equal((await req(baseUrlPg, 'POST', `/api/stock-counts/${pgCnt.json.count.id}/submit`, { token: pgAdminToken })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', `/api/stock-counts/${pgCnt.json.count.id}/approve`, { token: pgAdminToken, body: {} })).status, 200);

      // 4. PG Stock Transfer create -> submit -> approve -> execute (2 units wh1 -> wh2)
      const pgTr = await req(baseUrlPg, 'POST', '/api/stock-transfers', {
        token: pgAdminToken,
        body: {
          sourceWarehouseId: wh1,
          targetWarehouseId: wh2,
          items: [{ productId: prod.id, unit: 'قطعة', unitFactor: 1, requestedQty: 2 }],
        },
      });
      assert.equal(pgTr.status, 201);
      assert.equal((await req(baseUrlPg, 'POST', `/api/stock-transfers/${pgTr.json.transfer.id}/submit`, { token: pgAdminToken })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', `/api/stock-transfers/${pgTr.json.transfer.id}/approve`, { token: pgAdminToken, body: {} })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', `/api/stock-transfers/${pgTr.json.transfer.id}/execute`, { token: pgAdminToken })).status, 200);

      const bootFinal = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      assert.equal(bootFinal.cashboxes.find((c) => c.id === cb1).currentBalance, cbBefore + 200 - 50);
      assert.equal(bootFinal.products.find((p) => p.id === prod.id).stockPerWarehouse[wh1], stockWh1Before - 1 - 2);
      assert.equal(bootFinal.products.find((p) => p.id === prod.id).stockPerWarehouse[wh2], stockWh2Before + 2);
    });

    await test('34. Live PostgreSQL HTTP API validates shortcuts persistence, customer toggle, payroll guards, safe delete & overdraft blocks', async () => {
      const adminLogin = await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
      });
      const pgAdminToken = adminLogin.json.accessToken;
      const boot = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const cb1 = boot.cashboxes[0].id;
      const cb2 = boot.cashboxes[1]?.id || cb1;
      const wh1 = boot.warehouses[0].id;
      const prod = boot.products.find((p) => p.code === 'P-100') || boot.products[0];

      // 1. PG Shortcuts roundtrip + 409 conflict
      const pgScSave = await req(baseUrlPg, 'PUT', '/api/auth/shortcuts', {
        token: pgAdminToken,
        body: {
          shortcuts: [{ actionId: 'action:save_invoice', label: 'حفظ الفاتورة', category: 'الفواتير', keyCombo: 'Ctrl+Shift+S', enabled: true }],
        },
      });
      assert.equal(pgScSave.status, 200);
      const pgScGet = await req(baseUrlPg, 'GET', '/api/auth/shortcuts', { token: pgAdminToken });
      assert.equal(pgScGet.status, 200);
      assert.equal(pgScGet.json.shortcuts[0].keyCombo, 'Ctrl+Shift+S');

      const pgScDup = await req(baseUrlPg, 'PUT', '/api/auth/shortcuts', {
        token: pgAdminToken,
        body: {
          shortcuts: [
            { actionId: 'action:save_invoice', label: 'A', category: 'عام', keyCombo: 'Alt+X', enabled: true },
            { actionId: 'action:print_document', label: 'B', category: 'عام', keyCombo: 'alt+x', enabled: true },
          ],
        },
      });
      assert.equal(pgScDup.status, 409);

      // 2. PG Customer toggle status blocks/restores login
      const barakaUser = boot.users.find((u) => u.username === 'cust_baraka');
      const custTarget = boot.customers.find((c) => c.userId === barakaUser?.id);
      assert.ok(custTarget);
      assert.equal((await req(baseUrlPg, 'POST', `/api/customers/${custTarget.id}/toggle-user-status`, {
        token: pgAdminToken,
        body: { isActive: false },
      })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: 'cust_baraka', password: 'CustomerPassword!1' },
      })).status, 403);
      assert.equal((await req(baseUrlPg, 'POST', `/api/customers/${custTarget.id}/toggle-user-status`, {
        token: pgAdminToken,
        body: { isActive: true },
      })).status, 200);

      // 3. PG Safe import delete respects non-opening stock_movements
      const pgImpRes = await req(baseUrlPg, 'POST', '/api/products', {
        token: pgAdminToken,
        body: {
          code: 'PG-IMP-FREE',
          barcode: '622777001',
          name: 'صنف مستورد PG',
          category: 'عام',
          baseUnit: 'قطعة',
          purchasePrice: 0,
          sellingPrice: 0,
          stockPerWarehouse: { [wh1]: 0 },
          importedFromFile: true,
          importBatchId: 'PG-BATCH-1',
          sourceFileName: 'pg_import.csv',
        },
      });
      assert.equal(pgImpRes.status, 201);
      const pgDelRes = await req(baseUrlPg, 'POST', '/api/products/delete-imported', {
        token: pgAdminToken,
        body: { batchId: 'PG-BATCH-1', deleteAllImported: false },
      });
      assert.equal(pgDelRes.status, 200);
      assert.equal(pgDelRes.json.deletedCount, 1);

      // Verify IMP-USED-1 from Suite A (has stock movement) is STILL protected on PG even on deleteAllImported
      const pgDelAllRes = await req(baseUrlPg, 'POST', '/api/products/delete-imported', {
        token: pgAdminToken,
        body: { deleteAllImported: true },
      });
      assert.equal(pgDelAllRes.status, 200);
      assert.ok(pgDelAllRes.json.skippedItems.some((x) => x.code === 'IMP-USED-1'), 'PG MUST protect imported item with stock_movements');

      // 4. PG Cashbox transfer overdraft block -> 409
      if (cb1 !== cb2) {
        const pgCbOver = await req(baseUrlPg, 'POST', '/api/admin/cashboxes/transfer', {
          token: pgAdminToken,
          body: { fromId: cb2, toId: cb1, amount: 9999999, notes: 'تجاوز PG' },
        });
        assert.equal(pgCbOver.status, 409);
      }

      // 5. PG Employee preserved, removed HR endpoints return 404, cashbox overdraft blocked -> 409
      const empPg = boot.employees.find((e) => e.code === 'EMP-900');
      assert.ok(empPg);
      const pgRemovedPay = await req(baseUrlPg, 'POST', '/api/admin/payrolls', {
        token: pgAdminToken,
        body: { employeeId: empPg.id, month: 11, year: 2026, netSalary: 100, cashboxId: cb1 },
      });
      assert.equal(pgRemovedPay.status, 404);

      const pgRemovedAdv = await req(baseUrlPg, 'POST', '/api/admin/advances', {
        token: pgAdminToken,
        body: { employeeId: empPg.id, type: 'advance', amount: 100, cashboxId: cb1 },
      });
      assert.equal(pgRemovedAdv.status, 404);

      const pgCbOpOver = await req(baseUrlPg, 'POST', '/api/admin/cash-operations', {
        token: pgAdminToken,
        body: { type: 'cash_withdrawal', cashboxId: cb1, amount: 9999999, recipientOrPayer: 'تجاوز PG' },
      });
      assert.equal(pgCbOpOver.status, 409);

      // Verify PG stock_movements recorded unit/movement_number properly on stock transfers
      const mvRows = await pgPool.query(
        `SELECT movement_number, movement_type, unit, unit_factor, balance_after FROM stock_movements WHERE movement_type IN ('transfer_out', 'transfer_in') AND product_id = $1`,
        [prod.id]
      );
      assert.ok(mvRows.rows.some((r) => r.movement_type === 'transfer_out') && mvRows.rows.some((r) => r.movement_type === 'transfer_in'), 'Expected PG transfer stock_movements with out/in rows');
      assert.ok(mvRows.rows.every((r) => r.movement_number && r.unit && r.balance_after !== null));
    });

    await test('36. Live PostgreSQL HTTP API enforces permission escalation block, dated price history, payment idempotency & supplier advance settlement', async () => {
      const adminLogin = await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
      });
      const pgAdminToken = adminLogin.json.accessToken;
      const boot = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const cb1 = boot.cashboxes[0].id;
      const wh1 = boot.warehouses[0].id;
      const cust = boot.customers[0];
      const supp = boot.suppliers[0];
      const prod = boot.products.find((p) => p.code === 'P-100') || boot.products[0];

      // Phone login for manager + escalation block in PG
      const mgrUser = boot.users.find((u) => u.username === 'mgr_scope_test');
      assert.ok(mgrUser);
      const pgMgrLogin = await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: '01055551234', password: 'MgrPassword!99' },
      });
      assert.equal(pgMgrLogin.status, 200);
      assert.equal(pgMgrLogin.json.user.role, 'manager');
      const pgEsc = await req(baseUrlPg, 'POST', '/api/admin/users', {
        token: pgMgrLogin.json.accessToken,
        body: {
          fullName: 'تصعيد PG',
          username: 'pg_esc_u',
          password: 'Password!99',
          role: 'sales',
          permissions: { canManageSettings: true },
        },
      });
      assert.equal(pgEsc.status, 403);
      assert.equal(pgEsc.json.code, 'FORBIDDEN_PERMISSION_ESCALATION');

      // Dated priceHistory + idempotent customer payment on PG
      const cbBefore = Number(boot.cashboxes[0].currentBalance || 0);
      const cpPg1 = await req(baseUrlPg, 'POST', `/api/customers/${cust.id}/payment`, {
        token: pgAdminToken,
        headers: { 'Idempotency-Key': 'pg-idem-cp-36' },
        body: { amount: 15, cashboxId: cb1, paymentMethod: 'cash' },
      });
      assert.equal(cpPg1.status, 200);
      const cpPg2 = await req(baseUrlPg, 'POST', `/api/customers/${cust.id}/payment`, {
        token: pgAdminToken,
        headers: { 'Idempotency-Key': 'pg-idem-cp-36' },
        body: { amount: 15, cashboxId: cb1, paymentMethod: 'cash' },
      });
      assert.equal(cpPg2.status, 200);
      assert.equal(cpPg2.json.deduplicated, true);

      const pgInvDate = new Date().toISOString().split('T')[0];
      const salePg = await req(baseUrlPg, 'POST', '/api/invoices/sales', {
        token: pgAdminToken,
        headers: { 'Idempotency-Key': 'pg-idem-sale-36' },
        body: {
          date: pgInvDate,
          customerId: cust.id,
          warehouseId: wh1,
          cashboxId: cb1,
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prod.id, productName: prod.name, unit: 'قطعة', unitFactor: 1, quantity: 1, unitPrice: 88 }],
        },
      });
      assert.equal(salePg.status, 201);
      const salePgDup = await req(baseUrlPg, 'POST', '/api/invoices/sales', {
        token: pgAdminToken,
        headers: { 'Idempotency-Key': 'pg-idem-sale-36' },
        body: {
          date: pgInvDate,
          customerId: cust.id,
          warehouseId: wh1,
          cashboxId: cb1,
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prod.id, productName: prod.name, unit: 'قطعة', unitFactor: 1, quantity: 1, unitPrice: 88 }],
        },
      });
      assert.equal(salePgDup.status, 201);
      assert.equal(salePgDup.json.invoice.id, salePg.json.invoice.id);

      const pgPh = await req(baseUrlPg, 'GET', `/api/customers/${cust.id}/price-history`, { token: pgAdminToken });
      assert.equal(pgPh.status, 200);
      const pgLast = (pgPh.json.priceHistory[prod.id] || []).slice(-1)[0];
      assert.equal(pgLast.price, 88);
      assert.equal(pgLast.date, pgInvDate);

      // Supplier advance payment + zero-cashbox settle-advance in PG
      await req(baseUrlPg, 'POST', '/api/admin/suppliers/payment', {
        token: pgAdminToken,
        headers: { 'Idempotency-Key': 'pg-idem-sp-36' },
        body: { supplierId: supp.id, amount: 400, cashboxId: cb1, notes: 'مقدم PG' },
      });
      const purPg = await req(baseUrlPg, 'POST', '/api/invoices/purchase', {
        token: pgAdminToken,
        body: {
          supplierId: supp.id,
          warehouseId: wh1,
          cashboxId: cb1,
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prod.id, productName: prod.name, unit: 'قطعة', unitFactor: 1, quantity: 2, unitPrice: 55 }],
        },
      });
      assert.equal(purPg.status, 201);
      const settlePg = await req(baseUrlPg, 'POST', `/api/admin/suppliers/${supp.id}/settle-advance`, {
        token: pgAdminToken,
        headers: { 'Idempotency-Key': 'pg-idem-settle-36' },
        body: { invoiceId: purPg.json.invoice.id, amount: 110, notes: 'تسوية PG' },
      });
      assert.equal(settlePg.status, 200);
      assert.equal(settlePg.json.invoice.paidAmount, 110);
      assert.equal(settlePg.json.invoice.remainingAmount, 0);

      const bootEnd = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      assert.equal(bootEnd.cashboxes.find((c) => c.id === cb1).currentBalance, cbBefore + 15 - 400);
    });

    await test('38. Dual/Multi-Connection System (PostgreSQL pg-mem): preserves single DB, enforces HTTPS & strips secrets', async () => {
      const adminLogin = await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
      });
      const pgAdminToken = adminLogin.json.accessToken;

      const pgMgrLogin = await req(baseUrlPg, 'POST', '/api/auth/login', {
        body: { username: 'mgr_scope_test', password: 'MgrPassword!99' },
      });
      assert.equal(pgMgrLogin.status, 200);
      assert.equal((await req(baseUrlPg, 'GET', '/api/admin/server-info', { token: pgMgrLogin.json.accessToken })).status, 403);
      assert.equal(
        (
          await req(baseUrlPg, 'PUT', '/api/admin/settings', {
            token: pgMgrLogin.json.accessToken,
            body: { extraSettings: { connectionConfig: { activeMode: 'cloud_vps' } } },
          })
        ).status,
        403
      );

      const srvPg = await req(baseUrlPg, 'GET', '/api/admin/server-info', { token: pgAdminToken });
      assert.equal(srvPg.status, 200);
      assert.equal(srvPg.json.databaseMode, 'postgresql-enterprise');

      const bootBefore = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const beforeInvoices = bootBefore.invoices.length;

      // Enforce HTTPS on PG settings update
      const badPgRemote = await req(baseUrlPg, 'PUT', '/api/admin/settings', {
        token: pgAdminToken,
        body: {
          extraSettings: {
            connectionConfig: {
              activeMode: 'cloud_vps',
              cloudVps: { vpsUrl: 'http://unencrypted-vps.example.com' },
            },
          },
        },
      });
      assert.equal(badPgRemote.status, 400);
      assert.equal(badPgRemote.json.code, 'HTTPS_REQUIRED_FOR_REMOTE');

      const savePg = await req(baseUrlPg, 'PUT', '/api/admin/settings', {
        token: pgAdminToken,
        body: {
          extraSettings: {
            connectionConfig: {
              activeMode: 'free_remote',
              localNetwork: { ip: '192.168.1.200', port: 3000, hostname: 'pg-central' },
              freeRemote: { tunnelUrl: 'https://pg-shop.trycloudflare.com', tunnelToken: 'NO_LEAK' },
              proRemote: { domainUrl: 'https://pg-erp.awladselim.com' },
              cloudVps: { vpsUrl: 'https://pg-vps.awladselim.com', notes: 'PG Cloud' },
            },
          },
        },
      });
      assert.equal(savePg.status, 200);
      const pgCfg = savePg.json.settings.extraSettings.connectionConfig;
      assert.equal(pgCfg.activeMode, 'free_remote');
      assert.ok(!JSON.stringify(pgCfg).includes('NO_LEAK'));

      const bootAfter = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      assert.equal(bootAfter.invoices.length, beforeInvoices);
      assert.equal(bootAfter.settings.extraSettings.connectionConfig.proRemote.domainUrl, 'https://pg-erp.awladselim.com');
    });

    await test('42. Live PostgreSQL HTTP API verifies Rep Orders, Review->Approve isolation & Auto 1:1 Customer User Linking + Repair', async () => {
      const pgAdminToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
        })
      ).json.accessToken;
      const pgRepToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'rep_karim', password: 'RepPassword!123' },
        })
      ).json.accessToken;
      const pgCustBToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'cust_salam', password: 'CustomerPassword!2' },
        })
      ).json.accessToken;

      const boot0 = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const repCustomers = (await req(baseUrlPg, 'GET', '/api/customers', { token: pgRepToken })).json.customers;
      assert.ok(repCustomers.length >= 1);
      const assignedCust = repCustomers[0];
      const prod = boot0.products.find((p) => p.code === 'P-100') || boot0.products[0];
      const invBefore = boot0.invoices.length;

      // Rep submits order on PG
      const repOrd = await req(baseUrlPg, 'POST', '/api/orders', {
        token: pgRepToken,
        body: {
          customerId: assignedCust.id,
          items: [{ productId: prod.id, unit: prod.baseUnit, quantity: 1.5 }],
          notes: 'طلب مندوب PG',
        },
      });
      assert.equal(repOrd.status, 201);
      assert.equal(repOrd.json.order.requesterType, 'representative');
      assert.ok(Number(repOrd.json.order.totalAmount) > 0);

      // Customer B creates own order on PG -> hidden from Rep
      const custBOrd = await req(baseUrlPg, 'POST', '/api/orders', {
        token: pgCustBToken,
        body: { items: [{ productId: prod.id, unit: prod.baseUnit, quantity: 1 }] },
      });
      assert.equal(custBOrd.status, 201);
      const repOrdersPg = (await req(baseUrlPg, 'GET', '/api/orders', { token: pgRepToken })).json.orders;
      assert.ok(repOrdersPg.some((o) => o.id === repOrd.json.order.id));
      assert.equal(repOrdersPg.some((o) => o.id === custBOrd.json.order.id), false);

      // Review & Approve on PG do NOT create invoice; duplicate approve -> 409
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${repOrd.json.order.id}/review`, { token: pgAdminToken, body: {} })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${repOrd.json.order.id}/approve`, { token: pgAdminToken, body: {} })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${repOrd.json.order.id}/approve`, { token: pgAdminToken, body: {} })).status, 409);

      const bootAfterApp = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      assert.equal(bootAfterApp.invoices.length, invBefore);

      // Reject requires reason on PG
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${custBOrd.json.order.id}/reject`, { token: pgAdminToken, body: { reason: '' } })).status, 400);
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${custBOrd.json.order.id}/reject`, { token: pgAdminToken, body: { reason: 'غير متوفر' } })).status, 200);

      // Auto 1:1 customer link + duplicate 409 + fix-unlinked on PG
      const pgAutoUser = await req(baseUrlPg, 'POST', '/api/admin/users', {
        token: pgAdminToken,
        body: {
          fullName: 'عميل PG التلقائي',
          username: 'pg_cust_auto',
          password: 'PgPassword!123',
          phone: '01066665555',
          role: 'customer',
        },
      });
      assert.equal(pgAutoUser.status, 201);
      assert.ok(pgAutoUser.json.user.linkedCustomerId);

      const pgDupLink = await req(baseUrlPg, 'POST', '/api/admin/users', {
        token: pgAdminToken,
        body: {
          fullName: 'تضارب PG',
          username: 'pg_cust_conflict',
          password: 'PgPassword!123',
          role: 'customer',
          linkedCustomerId: pgAutoUser.json.user.linkedCustomerId,
        },
      });
      assert.equal(pgDupLink.status, 409);

      const pgUnlinked = await req(baseUrlPg, 'POST', '/api/admin/users', {
        token: pgAdminToken,
        body: {
          fullName: 'عميل PG بدون ربط',
          username: 'pg_cust_unlinked',
          password: 'PgPassword!123',
          role: 'customer',
          autoCreateCustomerProfile: false,
        },
      });
      assert.equal(pgUnlinked.status, 201);
      const pgFix = await req(baseUrlPg, 'POST', '/api/customers/conflicts/fix-unlinked', { token: pgAdminToken });
      assert.equal(pgFix.status, 200);
      assert.ok(pgFix.json.repaired.some((r) => r.userId === pgUnlinked.json.user.id));
    });

    let pgProdNew;

    await test('45. Live PostgreSQL HTTP API verifies public registration, direct custody dispatch + partial delivery & rep invoice review', async () => {
      const pgAdminToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
        })
      ).json.accessToken;
      const pgRepToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'rep_karim', password: 'RepPassword!123' },
        })
      ).json.accessToken;

      // 1. Public registration on PG
      const pgRegAdmin = await req(baseUrlPg, 'POST', '/api/auth/register', {
        body: { fullName: 'أدمن PG', username: 'pg_reg_adm', password: 'Password!123', phone: '01090000001', role: 'admin' },
      });
      assert.equal(pgRegAdmin.status, 403);

      const pgRegCust = await req(baseUrlPg, 'POST', '/api/auth/register', {
        body: {
          fullName: 'عميل تسجيل PG',
          username: 'pg_reg_cust_1',
          password: 'Password!123',
          phone: '01090000002',
          address: 'طنطا',
          role: 'customer',
        },
      });
      assert.equal(pgRegCust.status, 201);
      assert.equal(pgRegCust.json.user.role, 'customer');
      assert.ok(pgRegCust.json.customerProfile?.id);

      const pgRegRep = await req(baseUrlPg, 'POST', '/api/auth/register', {
        body: {
          fullName: 'مندوب تسجيل PG',
          username: 'pg_reg_rep_1',
          password: 'Password!123',
          phone: '01090000003',
          vehicleNumber: 'PG-900',
          role: 'representative',
        },
      });
      assert.equal(pgRegRep.status, 201);
      assert.equal(pgRegRep.json.user.role, 'representative');
      assert.ok(pgRegRep.json.representativeProfile?.warehouseId);

      // 2. Fresh PG product for custody & movement tests
      const boot0 = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const wh1 = boot0.warehouses[0].id;
      const cb1 = boot0.cashboxes[0].id;
      const rep0 = boot0.representatives.find((r) => r.name === 'كريم المندوب') || boot0.representatives[0];
      const cust0 = boot0.customers.find((c) => c.code === 'C-001') || boot0.customers.find((c) => c.assignedRepId === rep0.id || (c.allowedRepIds || []).includes(rep0.id)) || boot0.customers[0];

      const pNewRes = await req(baseUrlPg, 'POST', '/api/products', {
        token: pgAdminToken,
        body: {
          code: 'P-PG-45',
          barcode: '622888045',
          name: 'شاي عهدة PG',
          category: 'مشروبات',
          baseUnit: 'قطعة',
          purchasePrice: 15,
          sellingPrice: 25,
          minStockLevel: 5,
          stockPerWarehouse: { [wh1]: 200 },
          status: 'active',
        },
      });
      assert.equal(pNewRes.status, 201);
      pgProdNew = pNewRes.json.product;

      const vanBefore = Number(pgProdNew.stockPerWarehouse[rep0.warehouseId] || 0);
      assert.equal(vanBefore, 0);

      // Direct custody dispatch 100 units on PG
      const dispPg = await req(baseUrlPg, 'POST', '/api/inventory/rep-item-transfers', {
        token: pgAdminToken,
        body: {
          representativeId: rep0.id,
          sourceWarehouseId: wh1,
          targetWarehouseId: rep0.warehouseId,
          transferMode: 'custody_dispatch',
          autoDispatch: true,
          items: [{ productId: pgProdNew.id, productName: pgProdNew.name, unit: 'قطعة', requestedQty: 100 }],
        },
      });
      assert.equal(dispPg.status, 201);
      assert.equal(dispPg.json.request.status, 'executed');

      // Main deducted 200 -> 100 immediately, van STILL 0 until 'received'
      const bootMid = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const pMid = bootMid.products.find((p) => p.id === pgProdNew.id);
      assert.equal(pMid.stockPerWarehouse[wh1], 100);
      assert.equal(Number(pMid.stockPerWarehouse[rep0.warehouseId] || 0), 0);

      assert.equal(
        (await req(baseUrlPg, 'POST', `/api/inventory/rep-item-transfers/${dispPg.json.request.id}/status`, {
          token: pgRepToken,
          body: { status: 'received' },
        })).status,
        200
      );

      // Partial custody delivery 30 of 100 on PG
      const delivPg = await req(baseUrlPg, 'POST', '/api/inventory/rep-custody/deliver', {
        token: pgRepToken,
        headers: { 'Idempotency-Key': 'pg-cust-deliv-45' },
        body: {
          representativeId: rep0.id,
          customerId: cust0.id,
          items: [{ productId: pgProdNew.id, unit: 'قطعة', quantity: 30 }],
        },
      });
      assert.equal(delivPg.status, 201);

      const stmtPg = (await req(baseUrlPg, 'GET', `/api/inventory/rep-custody/statement?repId=${rep0.id}`, { token: pgAdminToken })).json.statement;
      const itemSumPg = stmtPg.itemsSummary.find((i) => i.productId === pgProdNew.id);
      assert.equal(itemSumPg.receivedQty, 100);
      assert.equal(itemSumPg.deliveredToCustomersQty, 30);
      assert.equal(itemSumPg.remainingCustodyQty, 70);
      assert.equal(itemSumPg.vanPhysicalStockQty, 70);

      // Rep confirmed sale invoice on PG -> mark-reviewed with zero duplicate stock/GL/balance effect
      const repSalePg = await req(baseUrlPg, 'POST', '/api/invoices/sales', {
        token: pgRepToken,
        body: {
          customerId: cust0.id,
          warehouseId: rep0.warehouseId,
          cashboxId: cb1,
          status: 'confirmed',
          paymentType: 'credit',
          paidAmount: 0,
          items: [{ productId: pgProdNew.id, productName: pgProdNew.name, unit: 'قطعة', unitFactor: 1, quantity: 2, unitPrice: 25 }],
        },
      });
      assert.equal(repSalePg.status, 201);
      assert.equal(repSalePg.json.invoice.reviewStatus, 'needs_review');

      const preRevBoot = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const stockPreRev = preRevBoot.products.find((p) => p.id === pgProdNew.id).stockPerWarehouse[rep0.warehouseId];
      const custBalPreRev = preRevBoot.customers.find((c) => c.id === cust0.id).currentBalance;
      const ftPreRev = preRevBoot.financialTransactions.length;

      const revOkPg = await req(baseUrlPg, 'POST', `/api/invoices/${repSalePg.json.invoice.id}/mark-reviewed`, {
        token: pgAdminToken,
        body: { notes: 'مراجعة PG' },
      });
      assert.equal(revOkPg.status, 200);
      assert.equal(revOkPg.json.invoice.reviewStatus, 'reviewed');

      const postRevBoot = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      assert.equal(postRevBoot.products.find((p) => p.id === pgProdNew.id).stockPerWarehouse[rep0.warehouseId], stockPreRev);
      assert.equal(postRevBoot.customers.find((c) => c.id === cust0.id).currentBalance, custBalPreRev);
      assert.equal(postRevBoot.financialTransactions.length, ftPreRev);
    });

    await test('46. Live PostgreSQL HTTP API verifies Quote + 1:1 Convert, Item Movement Report profit, 9-stage orders & purchases RBAC', async () => {
      const pgAdminToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
        })
      ).json.accessToken;
      const pgRepToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'rep_karim', password: 'RepPassword!123' },
        })
      ).json.accessToken;
      const pgCustAToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'cust_baraka', password: 'CustomerPassword!1' },
        })
      ).json.accessToken;

      const boot0 = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const wh1 = boot0.warehouses[0].id;
      const wh2 = boot0.warehouses[1].id;
      const cb1 = boot0.cashboxes[0].id;
      const custA0 = boot0.customers.find((c) => c.code === 'C-001') || boot0.customers[0];
      const supp0 = boot0.suppliers[0];
      const rep0 = boot0.representatives.find((r) => r.name === 'كريم المندوب') || boot0.representatives[0];

      // 1. Fresh product for clean item movement report profit assertion on PG
      const pRepRes = await req(baseUrlPg, 'POST', '/api/products', {
        token: pgAdminToken,
        body: {
          code: 'P-PG-MOV',
          barcode: '622888046',
          name: 'قهوة تقرير PG',
          category: 'مشروبات',
          baseUnit: 'قطعة',
          purchasePrice: 20,
          sellingPrice: 30,
          stockPerWarehouse: { [wh1]: 50 },
          status: 'active',
        },
      });
      assert.equal(pRepRes.status, 201);
      const pgProdMov = pRepRes.json.product;

      // Quote (0 stock/balance/GL impact) -> Convert 1:1
      const balPreQ = (await req(baseUrlPg, 'GET', `/api/customers/${custA0.id}`, { token: pgAdminToken })).json.customer.currentBalance;
      const ftPreQ = boot0.financialTransactions.length;

      const pgQuoteRes = await req(baseUrlPg, 'POST', '/api/invoices/quotes', {
        token: pgAdminToken,
        body: {
          customerId: custA0.id,
          warehouseId: wh1,
          cashboxId: cb1,
          items: [{ productId: pgProdMov.id, productName: pgProdMov.name, unit: 'قطعة', unitFactor: 1, quantity: 4, unitPrice: 30 }],
        },
      });
      assert.equal(pgQuoteRes.status, 201);
      assert.equal(pgQuoteRes.json.invoice.type, 'quote');

      const bootAfterQ = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      assert.equal(bootAfterQ.products.find((p) => p.id === pgProdMov.id).stockPerWarehouse[wh1], 50);
      assert.equal(bootAfterQ.customers.find((c) => c.id === custA0.id).currentBalance, balPreQ);
      assert.equal(bootAfterQ.financialTransactions.length, ftPreQ);

      const pgConvQ = await req(baseUrlPg, 'POST', `/api/invoices/quotes/${pgQuoteRes.json.invoice.id}/convert`, {
        token: pgAdminToken,
        body: { status: 'confirmed', paymentType: 'credit', paidAmount: 0 },
      });
      assert.equal(pgConvQ.status, 201);
      assert.equal(pgConvQ.json.invoice.type, 'sales');
      assert.equal(pgConvQ.json.invoice.grandTotal, 120);

      // Direct warehouse transfer 6 units (must NOT enter sales totals)
      assert.equal(
        (await req(baseUrlPg, 'POST', '/api/inventory/transfer', {
          token: pgAdminToken,
          body: { productId: pgProdMov.id, fromWarehouseId: wh1, toWarehouseId: wh2, quantity: 6 },
        })).status,
        200
      );

      const pgReportRes = await req(baseUrlPg, 'GET', `/api/inventory/item-movement-report?productId=${pgProdMov.id}`, { token: pgAdminToken });
      assert.equal(pgReportRes.status, 200);
      const pgRep = pgReportRes.json.report;
      assert.equal(pgRep.sections.sales.length, 1);
      assert.ok(pgRep.sections.transfers.length >= 1);
      // 4 * 30 = 120 sales; 4 * 20 = 80 COGS; profit = 40
      assert.equal(pgRep.totals.totalSalesQty, 4);
      assert.equal(pgRep.totals.totalSalesValue, 120);
      assert.equal(pgRep.totals.totalCostOfGoodsSold, 80);
      assert.equal(pgRep.totals.totalProfit, 40);

      // 2. 9-stage customer order lifecycle + linked invoice payment summary on PG
      const pgOrd9 = await req(baseUrlPg, 'POST', '/api/orders', {
        token: pgCustAToken,
        body: { items: [{ productId: pgProdMov.id, unit: 'قطعة', quantity: 2 }] },
      });
      assert.equal(pgOrd9.status, 201);
      const ordId = pgOrd9.json.order.id;

      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${ordId}/review`, { token: pgAdminToken, body: {} })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${ordId}/approve`, { token: pgAdminToken, body: {} })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${ordId}/stage`, { token: pgAdminToken, body: { stage: 'preparing' } })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${ordId}/assign-rep`, { token: pgAdminToken, body: { repId: rep0.id } })).status, 200);
      assert.equal(
        (await req(baseUrlPg, 'POST', `/api/orders/${ordId}/convert-to-invoice`, {
          token: pgAdminToken,
          body: { warehouseId: wh1, cashboxId: cb1, status: 'confirmed', paymentType: 'credit', paidAmount: 0 },
        })).status,
        201
      );
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${ordId}/stage`, { token: pgRepToken, body: { stage: 'out_for_delivery' } })).status, 200);
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${ordId}/stage`, { token: pgRepToken, body: { stage: 'delivered' } })).status, 200);
      assert.equal(
        (await req(baseUrlPg, 'POST', `/api/orders/${ordId}/stage`, {
          token: pgRepToken,
          body: { stage: 'collected', collectedAmount: 25, cashboxId: cb1, paymentMethod: 'cash' },
        })).status,
        200
      );
      assert.equal((await req(baseUrlPg, 'POST', `/api/orders/${ordId}/stage`, { token: pgAdminToken, body: { stage: 'closed' } })).status, 200);

      const finalPgOrd = (await req(baseUrlPg, 'GET', `/api/orders/${ordId}`, { token: pgAdminToken })).json.order;
      assert.equal(finalPgOrd.status, 'closed');
      assert.equal(finalPgOrd.invoiceTotal, 60); // 2 * 30
      assert.equal(finalPgOrd.invoicePaidAmount, 25);
      assert.equal(finalPgOrd.invoiceRemainingAmount, 35);
      assert.equal(finalPgOrd.paymentStatus, 'partial');
      assert.equal(finalPgOrd.paymentsHistory.length, 1);

      // 3. 'purchases' role RBAC enforcement on PG (user pur_clerk_1 migrated from Suite A)
      const pgPurToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'pur_clerk_1', password: 'PurPassword!123' },
        })
      ).json.accessToken;

      assert.equal(
        (await req(baseUrlPg, 'POST', '/api/invoices/purchase', {
          token: pgPurToken,
          body: {
            supplierId: supp0.id,
            warehouseId: wh1,
            cashboxId: cb1,
            paymentType: 'credit',
            paidAmount: 0,
            status: 'confirmed',
            items: [{ productId: pgProdMov.id, productName: pgProdMov.name, unit: 'قطعة', unitFactor: 1, quantity: 3, unitPrice: 20 }],
          },
        })).status,
        201
      );
      assert.equal(
        (await req(baseUrlPg, 'POST', '/api/invoices/sales', {
          token: pgPurToken,
          body: {
            customerId: custA0.id,
            warehouseId: wh1,
            cashboxId: cb1,
            status: 'draft',
            paymentType: 'credit',
            paidAmount: 0,
            items: [{ productId: pgProdMov.id, productName: pgProdMov.name, unit: 'قطعة', unitFactor: 1, quantity: 1, unitPrice: 30 }],
          },
        })).status,
        403
      );
      assert.equal(
        (await req(baseUrlPg, 'POST', '/api/admin/cash-operations', {
          token: pgPurToken,
          body: { type: 'cash_deposit', cashboxId: cb1, amount: 10 },
        })).status,
        403
      );
      assert.equal(
        (await req(baseUrlPg, 'POST', '/api/admin/users', {
          token: pgPurToken,
          body: { fullName: 'X', username: 'pg_pur_blk', password: 'Password!123', role: 'sales' },
        })).status,
        403
      );
    });

    await test('48. Live PostgreSQL HTTP API validates Single Unit CRUD, inline purchase unit link, rename snapshot isolation & Cash/Partial/Credit invoices', async () => {
      const pgAdminToken = (
        await req(baseUrlPg, 'POST', '/api/auth/login', {
          body: { username: 'owner_tarek', password: 'OwnerStrongPassword!99' },
        })
      ).json.accessToken;

      const boot0 = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const whId = boot0.warehouses[0].id;
      const cbId = boot0.cashboxes[0].id;
      const custId = boot0.customers[0].id;
      const suppId = boot0.suppliers[0].id;

      // 1. Unit CRUD + search + duplicate guard in PG
      const pgUnitRes = await req(baseUrlPg, 'POST', '/api/products/units', {
        token: pgAdminToken,
        body: { name: 'دستة PG' },
      });
      assert.equal(pgUnitRes.status, 201);
      const pgUnitId = pgUnitRes.json.productUnit.id;

      assert.equal(
        (await req(baseUrlPg, 'POST', '/api/products/units', {
          token: pgAdminToken,
          body: { name: 'دسته   PG' },
        })).status,
        409
      );

      const pgUnitList = await req(baseUrlPg, 'GET', '/api/products/units?search=PG', { token: pgAdminToken });
      assert.equal(pgUnitList.status, 200);
      assert.ok(pgUnitList.json.productUnits.some((u) => u.id === pgUnitId));

      // 2. Inline new product via Partial Purchase Invoice on PG
      const cbBefore = boot0.cashboxes.find((c) => c.id === cbId).currentBalance;
      const suppBefore = boot0.suppliers.find((s) => s.id === suppId).currentBalance;
      const custBefore = boot0.customers.find((c) => c.id === custId).currentBalance;

      const purInline = await req(baseUrlPg, 'POST', '/api/invoices/purchase', {
        token: pgAdminToken,
        body: {
          supplierId: suppId,
          warehouseId: whId,
          cashboxId: cbId,
          status: 'confirmed',
          paymentType: 'partial',
          paymentMethod: 'cash',
          paidAmount: 120,
          items: [
            {
              productId: '',
              productName: 'بضاعة جملة جديدة PG',
              unit: 'دستة PG',
              unitFactor: 1,
              quantity: 5,
              unitPrice: 40, // total 200 -> 120 paid, 80 supplier balance
              newProduct: {
                name: 'بضاعة جملة جديدة PG',
                category: 'عام',
                unitId: pgUnitId,
                baseUnit: 'دستة PG',
                purchasePrice: 40,
                sellingPrice: 60,
              },
            },
          ],
        },
      });
      assert.equal(purInline.status, 201);
      const createdProdId = purInline.json.invoice.items[0].productId;
      assert.ok(createdProdId);

      // 3. Sales partial + Cash purchase + unit rename isolation in PG
      const salePg = await req(baseUrlPg, 'POST', '/api/invoices/sales', {
        token: pgAdminToken,
        body: {
          customerId: custId,
          warehouseId: whId,
          cashboxId: cbId,
          status: 'confirmed',
          paymentType: 'partial',
          paymentMethod: 'cash',
          paidAmount: 50,
          items: [{ productId: createdProdId, productName: 'بضاعة جملة جديدة PG', unit: 'دستة PG', unitFactor: 1, quantity: 2, unitPrice: 60 }], // 120 total -> +50 cb, +70 cust
        },
      });
      assert.equal(salePg.status, 201);
      const salePgId = salePg.json.invoice.id;

      // Rename unit -> updates product only, historical PG purchase & sale snapshots stay 'دستة PG'
      assert.equal(
        (await req(baseUrlPg, 'PUT', `/api/products/units/${pgUnitId}`, {
          token: pgAdminToken,
          body: { name: 'باكو جملة PG' },
        })).status,
        200
      );

      // Block delete while product uses it
      assert.equal(
        (await req(baseUrlPg, 'DELETE', `/api/products/units/${pgUnitId}`, { token: pgAdminToken })).status,
        409
      );

      const boot1 = (await req(baseUrlPg, 'GET', '/api/admin/bootstrap', { token: pgAdminToken })).json.data;
      const pPg = boot1.products.find((p) => p.id === createdProdId);
      assert.equal(pPg.baseUnit, 'باكو جملة PG');
      assert.equal(pPg.unitId, pgUnitId);

      const histSalePg = boot1.invoices.find((i) => i.id === salePgId);
      assert.equal(histSalePg.items[0].unit, 'دستة PG');

      // Net balances on PG: cashbox -120 +50 = -70; supplier +80; customer +70
      assert.equal(boot1.cashboxes.find((c) => c.id === cbId).currentBalance, cbBefore - 70);
      assert.equal(boot1.suppliers.find((s) => s.id === suppId).currentBalance, suppBefore + 80);
      assert.equal(boot1.customers.find((c) => c.id === custId).currentBalance, custBefore + 70);
    });
  } finally {
    setInjectedPool(null);
    resetPgModeCache();
    await new Promise((resolve) => serverPg.close(resolve));
  }
}

const suiteArg = process.argv.find((a) => a.startsWith('--suite='))?.split('=')[1];
const requestedSuite = (suiteArg || process.env.AWLAD_TEST_SUITE || 'all').trim().toUpperCase();

try {
  if (requestedSuite === 'A') {
    await runSuiteA_JsonLedgerHttp();
  } else {
    await runSuiteA_JsonLedgerHttp();
    await runSuiteB_PostgresPgMem();
  }
  console.log(`\nALL TESTS PASSED (${passed}/${passed})`);
} finally {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
}

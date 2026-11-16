import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { newDb } from 'pg-mem';

// Isolate data directory BEFORE importing server modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_test_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_awlad_selim_erp_verification_2026_secure';

const { createApiApp } = await import('../app.js');
const { readJsonDatabase, writeJsonDatabase } = await import('../db/jsonLedger.js');
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
      assert.ok(updatedCust.priceHistory[prod1.id].includes(125));
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
      const prodId = pgProdRes.json.products[0].id;

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
      const prod = boot.products[0];
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
  } finally {
    setInjectedPool(null);
    resetPgModeCache();
    await new Promise((resolve) => serverPg.close(resolve));
  }
}

try {
  await runSuiteA_JsonLedgerHttp();
  await runSuiteB_PostgresPgMem();
  console.log(`\nALL TESTS PASSED (${passed}/${passed})`);
} finally {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
}

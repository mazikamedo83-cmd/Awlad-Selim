import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

// Isolate data directory BEFORE importing server modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_sec_completion_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'sec_completion_jwt_secret_for_awlad_selim_erp_tests_2026';

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { bootstrapAdmin, registerMobileAccount } = await import('../db/stores/authStore.js');
const { resetAllRateLimitsForTests } = await import('../middleware/auth.js');

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
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  return { status: res.status, json, text, headers: res.headers, setCookies };
}

function extractCookieHeader(setCookies) {
  return setCookies
    .map((c) => String(c).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

console.log('\n=== Backend Security, Concurrency, CORS, HTTPS, Cookie/CSRF, Orders & Reports RBAC Completion Tests ===');

// --- Suite A: PostgreSQL Concurrent Bootstrap & Registration (pg-mem) ---
await (async () => {
  const pool = createPgMemPool();
  setInjectedPool(pool);
  resetPgModeCache();
  await initializeSchema();

  await test('1. BOOTSTRAP_ADMIN_SECRET enforces constant-time generic denial without leaking secret or state', async () => {
    process.env.BOOTSTRAP_ADMIN_SECRET = 'SuperSecretBootstrapKey#2026';
    try {
      await assert.rejects(
        () =>
          bootstrapAdmin({
            fullName: 'مهاجم أول',
            username: 'attacker_1',
            password: 'StrongPassword123',
            bootstrapSecret: 'WrongSecretValue',
          }),
        (err) => {
          assert.equal(err.status, 403);
          assert.equal(err.code, 'BOOTSTRAP_FORBIDDEN');
          assert.equal(err.message.includes('SuperSecret'), false);
          assert.equal(err.message.includes('BOOTSTRAP_ADMIN_SECRET'), false);
          return true;
        }
      );

      await assert.rejects(
        () =>
          bootstrapAdmin({
            fullName: 'مهاجم بدون سر',
            username: 'attacker_2',
            password: 'StrongPassword123',
          }),
        (err) => err.status === 403 && err.code === 'BOOTSTRAP_FORBIDDEN'
      );
    } finally {
      delete process.env.BOOTSTRAP_ADMIN_SECRET;
    }
  });

  await test('2. Dual concurrent bootstrapAdmin calls allow only 1 admin and reject the second atomically', async () => {
    process.env.BOOTSTRAP_ADMIN_SECRET = 'AtomicRaceSecret#99';
    try {
      const results = await Promise.allSettled([
        bootstrapAdmin({
          fullName: 'المدير الأول',
          username: 'atomic_admin_1',
          password: 'AdminStrongPassword!1',
          phone: '01011110001',
          bootstrapSecret: 'AtomicRaceSecret#99',
        }),
        bootstrapAdmin({
          fullName: 'المدير الثاني',
          username: 'atomic_admin_2',
          password: 'AdminStrongPassword!2',
          phone: '01011110002',
          bootstrapSecret: 'AtomicRaceSecret#99',
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 1, 'Exactly one concurrent bootstrap must succeed');
      assert.equal(rejected.length, 1, 'Second concurrent bootstrap must fail');
      assert.equal(rejected[0].reason?.status, 403);

      const lockRows = await pool.query('SELECT id, admin_user_id FROM system_bootstrap_lock');
      assert.equal(lockRows.rowCount, 1);
      const userRows = await pool.query("SELECT id FROM users WHERE role = 'admin'");
      assert.equal(userRows.rowCount, 1);
    } finally {
      delete process.env.BOOTSTRAP_ADMIN_SECRET;
    }
  });

  await test('3. Dual concurrent registerMobileAccount calls prevent duplicate usernames & phones atomically', async () => {
    const [r1, r2] = await Promise.allSettled([
      registerMobileAccount({
        role: 'customer',
        fullName: 'عميل سباق 1',
        username: 'race_customer_user',
        phone: '01055551234',
        password: 'CustomerPassword!1',
        address: 'القاهرة',
      }),
      registerMobileAccount({
        role: 'customer',
        fullName: 'عميل سباق 2',
        username: 'race_customer_user',
        phone: '01055551234',
        password: 'CustomerPassword!2',
        address: 'الجيزة',
      }),
    ]);

    const okCount = [r1, r2].filter((r) => r.status === 'fulfilled').length;
    const failCount = [r1, r2].filter((r) => r.status === 'rejected').length;
    assert.equal(okCount, 1, 'Only one concurrent self-registration must succeed');
    assert.equal(failCount, 1, 'Duplicate concurrent self-registration must reject cleanly');

    const custUsers = await pool.query(
      "SELECT id FROM users WHERE LOWER(username) = LOWER('race_customer_user')"
    );
    assert.equal(custUsers.rowCount, 1, 'Must never create duplicate user rows');
  });

  setInjectedPool(null);
  resetPgModeCache();
})();

// --- Suite B: HTTP / Security Headers / CORS / Proxy / Cookies / CSRF / Rate Limits / Orders / Reports RBAC ---
await (async () => {
  const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_sec_http_'));
  process.env.AWLAD_DATA_DIR = jsonDir;
  resetPgModeCache();
  resetAllRateLimitsForTests();

  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  let adminToken = '';
  let adminCookieHeader = '';
  let mainWhId = '';
  let cashboxId = '';
  let productId = '';
  let customerId = '';
  let customerToken = '';
  let repUserId = '';
  let repToken = '';
  let invStaffToken = '';
  let noSalaryStaffToken = '';

  try {
    await test('4. Setup admin via HTTP bootstrap & verify HttpOnly + SameSite=Lax cookies + security headers', async () => {
      process.env.BOOTSTRAP_ADMIN_SECRET = 'HttpSecret#2026';
      try {
        const badSecret = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
          body: {
            fullName: 'مدير',
            username: 'sec_admin',
            password: 'AdminPassword!2026',
            bootstrapSecret: 'bad-secret',
          },
        });
        assert.equal(badSecret.status, 403);
        assert.equal(badSecret.json?.code, 'BOOTSTRAP_FORBIDDEN');
        assert.equal(badSecret.text.includes('HttpSecret'), false);

        const goodBoot = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
          body: {
            fullName: 'مدير النظام الأمني',
            username: 'sec_admin',
            password: 'AdminPassword!2026',
            phone: '01000009999',
            bootstrapSecret: 'HttpSecret#2026',
          },
        });
        assert.equal(goodBoot.status, 201);
        assert.equal(goodBoot.headers.get('x-frame-options'), 'DENY');
        assert.equal(goodBoot.headers.get('x-content-type-options'), 'nosniff');
      } finally {
        delete process.env.BOOTSTRAP_ADMIN_SECRET;
      }

      const loginRes = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'sec_admin', password: 'AdminPassword!2026' },
      });
      assert.equal(loginRes.status, 200);
      adminToken = loginRes.json.accessToken;
      assert.ok(loginRes.setCookies.length >= 2, 'Must issue HttpOnly access & refresh cookies');
      const cookieJoined = loginRes.setCookies.join('\n');
      assert.match(cookieJoined, /awlad_access_token=.*HttpOnly/i);
      assert.match(cookieJoined, /awlad_refresh_token=.*HttpOnly/i);
      assert.match(cookieJoined, /SameSite=Lax/i);
      adminCookieHeader = extractCookieHeader(loginRes.setCookies);
    });

    await test('5. Web cookie auth works on GET /api/auth/me, blocks mutating POST without CSRF header, and passes with CSRF header', async () => {
      const meRes = await req(baseUrl, 'GET', '/api/auth/me', {
        headers: { Cookie: adminCookieHeader },
      });
      assert.equal(meRes.status, 200);
      assert.equal(meRes.json.user.username, 'sec_admin');

      const blockedCsrf = await req(baseUrl, 'POST', '/api/customers', {
        headers: { Cookie: adminCookieHeader },
        body: { name: 'عميل بدون CSRF', phone: '01012345670' },
      });
      assert.equal(blockedCsrf.status, 403);
      assert.equal(blockedCsrf.json?.code, 'CSRF_FORBIDDEN');

      const allowedCsrf = await req(baseUrl, 'POST', '/api/customers', {
        headers: {
          Cookie: adminCookieHeader,
          'X-Requested-With': 'awlad-selim-spa',
        },
        body: { name: 'عميل مع CSRF سليم', phone: '01012345671' },
      });
      assert.equal(allowedCsrf.status, 201);

      // Cookie refresh rotates tokens
      const refCookieRes = await req(baseUrl, 'POST', '/api/auth/refresh', {
        headers: {
          Cookie: adminCookieHeader,
          'X-Requested-With': 'awlad-selim-spa',
        },
        body: {},
      });
      assert.equal(refCookieRes.status, 200);
      const freshCookies = extractCookieHeader(refCookieRes.setCookies);
      assert.ok(freshCookies.includes('awlad_access_token='));

      // Cookie logout revokes session and clears cookies
      const outRes = await req(baseUrl, 'POST', '/api/auth/logout', {
        headers: {
          Cookie: freshCookies,
          'X-Requested-With': 'awlad-selim-spa',
        },
        body: {},
      });
      assert.equal(outRes.status, 200);
      assert.ok(outRes.setCookies.some((c) => /awlad_access_token=;.*(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(c)));

      const postLogoutMe = await req(baseUrl, 'GET', '/api/auth/me', {
        headers: { Cookie: freshCookies },
      });
      assert.equal(postLogoutMe.status, 401);
    });

    await test('6. CORS rejects X-Forwarded-Host spoofing & unauthorized origins in production, enforces explicit flags', async () => {
      const prevProd = process.env.NODE_ENV;
      const prevAllowed = process.env.ALLOWED_ORIGINS;
      const prevLan = process.env.ALLOW_MOBILE_LAN_HTTP;
      const prevCf = process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL;
      const tempPgPool = createPgMemPool();
      setInjectedPool(tempPgPool);
      resetPgModeCache();
      await initializeSchema();
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOWED_ORIGINS;
      delete process.env.ALLOW_MOBILE_LAN_HTTP;
      delete process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL;

      try {
        // Attempt spoof via Origin matching spoofed X-Forwarded-Host without ALLOWED_ORIGINS
        const spoofRes = await req(baseUrl, 'GET', '/api/auth/status', {
          headers: {
            Origin: 'https://evil-attacker.example',
            'X-Forwarded-Host': 'evil-attacker.example',
            'X-Forwarded-Proto': 'https',
          },
        });
        assert.equal(spoofRes.status, 403);
        assert.equal(spoofRes.json?.code, 'CORS_FORBIDDEN');
        assert.equal(spoofRes.headers.get('access-control-allow-origin'), null);

        // LAN and Cloudflare Tunnel rejected when not explicitly enabled
        const lanDenied = await req(baseUrl, 'GET', '/api/auth/status', {
          headers: { Origin: 'http://192.168.1.50:3000' },
        });
        assert.equal(lanDenied.status, 403);

        const cfDenied = await req(baseUrl, 'GET', '/api/auth/status', {
          headers: { Origin: 'https://abc-test.trycloudflare.com' },
        });
        assert.equal(cfDenied.status, 403);

        // Explicit ALLOWED_ORIGINS succeeds ONLY for allowlisted origin
        process.env.ALLOWED_ORIGINS = 'https://erp.awladselim.com';
        const allowedRes = await req(baseUrl, 'GET', '/api/auth/status', {
          headers: { Origin: 'https://erp.awladselim.com' },
        });
        assert.equal(allowedRes.status, 200);
        assert.equal(allowedRes.headers.get('access-control-allow-origin'), 'https://erp.awladselim.com');

        const rogueWithAllowedSet = await req(baseUrl, 'GET', '/api/auth/status', {
          headers: { Origin: 'https://attacker.com', 'X-Forwarded-Host': 'attacker.com' },
        });
        assert.equal(rogueWithAllowedSet.status, 403);
      } finally {
        setInjectedPool(null);
        resetPgModeCache();
        if (prevProd === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevProd;
        if (prevAllowed === undefined) delete process.env.ALLOWED_ORIGINS;
        else process.env.ALLOWED_ORIGINS = prevAllowed;
        if (prevLan === undefined) delete process.env.ALLOW_MOBILE_LAN_HTTP;
        else process.env.ALLOW_MOBILE_LAN_HTTP = prevLan;
        if (prevCf === undefined) delete process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL;
        else process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL = prevCf;
      }
    });

    await test('7. TRUST_PROXY defaults false and HTTPS is enforced for proxied/external HTTP in production + HSTS on HTTPS', async () => {
      const reLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'sec_admin', password: 'AdminPassword!2026' },
      });
      assert.equal(reLogin.status, 200);
      adminToken = reLogin.json.accessToken;

      const serverInfo = await req(baseUrl, 'GET', '/api/admin/server-info', { token: adminToken });
      assert.equal(serverInfo.status, 200);
      assert.equal(serverInfo.json.trustProxy, false);

      // Stand up trusted-proxy production app instance to test HTTPS_REQUIRED vs HTTPS+HSTS
      const prevProd = process.env.NODE_ENV;
      const prevTrust = process.env.TRUST_PROXY;
      const prevElectron = process.env.AWLAD_ELECTRON;
      const prevLan = process.env.ALLOW_MOBILE_LAN_HTTP;
      const tempPgPool = createPgMemPool();
      setInjectedPool(tempPgPool);
      resetPgModeCache();
      await initializeSchema();
      process.env.NODE_ENV = 'production';
      process.env.TRUST_PROXY = 'true';
      delete process.env.AWLAD_ELECTRON;
      delete process.env.ALLOW_MOBILE_LAN_HTTP;

      const prodApp = createApiApp();
      const prodServer = http.createServer(prodApp);
      await new Promise((resolve) => prodServer.listen(0, '127.0.0.1', resolve));
      const prodPort = prodServer.address().port;
      const prodUrl = `http://127.0.0.1:${prodPort}`;

      try {
        // Proxied plain HTTP -> 403 HTTPS_REQUIRED
        const httpDenied = await req(prodUrl, 'GET', '/api/auth/status', {
          headers: { 'X-Forwarded-Proto': 'http' },
        });
        assert.equal(httpDenied.status, 403);
        assert.equal(httpDenied.json?.code, 'HTTPS_REQUIRED');

        // Proxied HTTPS -> 200 + HSTS
        const httpsAllowed = await req(prodUrl, 'GET', '/api/auth/status', {
          headers: { 'X-Forwarded-Proto': 'https' },
        });
        assert.equal(httpsAllowed.status, 200);
        assert.match(httpsAllowed.headers.get('strict-transport-security') || '', /max-age=31536000/);
      } finally {
        await new Promise((resolve) => prodServer.close(resolve));
        setInjectedPool(null);
        resetPgModeCache();
        if (prevProd === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevProd;
        if (prevTrust === undefined) delete process.env.TRUST_PROXY;
        else process.env.TRUST_PROXY = prevTrust;
        if (prevElectron === undefined) delete process.env.AWLAD_ELECTRON;
        else process.env.AWLAD_ELECTRON = prevElectron;
        if (prevLan === undefined) delete process.env.ALLOW_MOBILE_LAN_HTTP;
        else process.env.ALLOW_MOBILE_LAN_HTTP = prevLan;
      }
    });

    await test('8. Orders delivery status transition allowlist & collection sub-idempotency deduplication', async () => {
      // Seed warehouse, cashbox, product, customer user, rep user
      const whRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
        token: adminToken,
        body: { name: 'المخزن الرئيسي', code: 'MAIN', isDefault: true },
      });
      assert.equal(whRes.status, 201);
      mainWhId = whRes.json.warehouse.id;

      const cbRes = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: adminToken,
        body: { name: 'الخزينة الرئيسية', type: 'cash', openingBalance: 10000, isDefault: true },
      });
      assert.equal(cbRes.status, 201);
      cashboxId = cbRes.json.cashbox.id;

      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: 'سكر أبيض فاخر',
          code: 'SUG-01',
          category: 'مواد غذائية',
          baseUnit: 'كيلو',
          purchasePrice: 20,
          sellingPrice: 30,
          stockPerWarehouse: { [mainWhId]: 100 },
        },
      });
      assert.equal(prodRes.status, 201);
      productId = prodRes.json.product.id;

      // Register customer + rep and verify their sessions
      const regCust = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'عميل اختبارات التوصيل',
          username: 'ord_cust_1',
          phone: '01077770001',
          password: 'CustPassword!2026',
          address: 'المعادي',
        },
      });
      assert.equal(regCust.status, 201);
      customerToken = regCust.json.accessToken;
      customerId = regCust.json.customerProfile.id;

      const regRep = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب اختبارات',
          username: 'ord_rep_1',
          phone: '01077770002',
          password: 'RepPassword!2026',
        },
      });
      assert.equal(regRep.status, 201);
      repUserId = regRep.json.user.id;
      const repLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'ord_rep_1', password: 'RepPassword!2026' },
      });
      repToken = repLogin.json.accessToken;

      const ordCreate = await req(baseUrl, 'POST', '/api/orders', {
        token: customerToken,
        headers: { 'Idempotency-Key': 'ORD-CREATE-1' },
        body: {
          customerId,
          items: [{ productId, quantity: 5, unitPrice: 30 }],
          notes: 'اختبار انتقالات الحالة',
        },
      });
      assert.equal(ordCreate.status, 201);
      const orderId = ordCreate.json.order.id;
      assert.equal(ordCreate.json.order.status, 'pending');

      // Direct delivery update from pending MUST be rejected with 409 INVALID_ORDER_TRANSITION
      const invalidDelivery = await req(baseUrl, 'POST', `/api/orders/${orderId}/delivery-status`, {
        token: adminToken,
        body: { status: 'delivered', collectedAmount: 150, cashboxId },
      });
      assert.equal(invalidDelivery.status, 409);
      assert.equal(invalidDelivery.json?.code, 'INVALID_ORDER_TRANSITION');

      // Approve -> convert to invoice -> deliver with collection & idempotency key
      const approveRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/approve`, {
        token: adminToken,
        body: {},
      });
      assert.equal(approveRes.status, 200);

      const convertRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/convert-to-invoice`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'ORD-CONV-1' },
        body: { warehouseId: mainWhId, cashboxId, paidAmount: 0 },
      });
      assert.equal(convertRes.status, 201);
      const linkedInvId = convertRes.json.invoice.id;

      const delivKey = 'ORD-DELIV-IDEM-99';
      const deliv1 = await req(baseUrl, 'POST', `/api/orders/${orderId}/delivery-status`, {
        token: adminToken,
        headers: { 'Idempotency-Key': delivKey },
        body: { status: 'delivered', collectedAmount: 150, cashboxId },
      });
      assert.equal(deliv1.status, 200);
      assert.equal(deliv1.json.order.status, 'delivered');

      // Replay exact same delivery collection key -> must NOT double-pay invoice
      const delivReplay = await req(baseUrl, 'POST', `/api/orders/${orderId}/delivery-status`, {
        token: adminToken,
        headers: { 'Idempotency-Key': delivKey },
        body: { status: 'delivered', collectedAmount: 150, cashboxId },
      });
      assert.equal(delivReplay.status, 200);

      const bootCheck = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(bootCheck.status, 200);
      const linkedInv = (bootCheck.json.data.invoices || []).find((i) => i.id === linkedInvId);
      assert.ok(linkedInv, 'Converted invoice must exist');
      assert.equal(Number(linkedInv.paidAmount), 150, 'Collected amount must apply once without duplicate payment');
    });

    await test('9. Reports RBAC denies inventory-only & unpermitted rep, strips employee cash rows without employee permission, scopes permitted rep', async () => {
      // Seed an employee + a confirmed rep_transfer (توريد) cash_payment_employee row so redaction is actually exercised
      const empRes = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: { name: 'موظف سري', jobTitle: 'أمين مخزن', phone: '01099990001' },
      });
      assert.equal(empRes.status, 201);

      const repHandoverCreate = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
        token: repToken,
        body: { direction: 'rep_to_owner', amount: 2000, cashboxId, notes: 'توريد سري من المندوب' },
      });
      assert.equal(repHandoverCreate.status, 201);
      const repHandoverConfirm = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${repHandoverCreate.json.transfer.id}/confirm`, {
        token: adminToken,
        body: { note: 'تأكيد استلام التوريد' },
      });
      assert.equal(repHandoverConfirm.status, 200);

      const adminEmpRpt = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=cash_payment_employee',
        { token: adminToken }
      );
      assert.equal(adminEmpRpt.status, 200);
      const adminSalSec = (adminEmpRpt.json.report.sections || []).find((s) => s.key === 'cash_payment_employee');
      assert.equal((adminSalSec?.rows || []).length, 1, 'Admin must see the seeded employee/rep cash delivery row');

      // Inventory-only user (canManageInventory=true, canViewReports=false) -> 403
      const invStaffCreate = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'أمين مخزن فقط',
          username: 'inv_only_user',
          password: 'StaffPassword!2026',
          role: 'warehouse',
          permissions: { canManageInventory: true, canViewReports: false },
        },
      });
      assert.equal(invStaffCreate.status, 201);
      const invLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'inv_only_user', password: 'StaffPassword!2026' },
      });
      invStaffToken = invLogin.json.accessToken;

      const invDenied = await req(baseUrl, 'GET', '/api/reports/comprehensive', { token: invStaffToken });
      assert.equal(invDenied.status, 403);

      // Rep without canViewReports -> 403
      const repDenied = await req(baseUrl, 'GET', '/api/reports/comprehensive', { token: repToken });
      assert.equal(repDenied.status, 403);

      // Staff with canViewReports=true, WITHOUT canManageEmployees -> no employee cash rows/employees leaked
      const noSalCreate = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مراجع مبيعات فقط',
          username: 'no_salary_reports',
          password: 'StaffPassword!2026',
          role: 'sales',
          permissions: { canViewReports: true, canManageEmployees: false },
        },
      });
      assert.equal(noSalCreate.status, 201);
      const noSalLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'no_salary_reports', password: 'StaffPassword!2026' },
      });
      noSalaryStaffToken = noSalLogin.json.accessToken;

      const noSalReport = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=cash_payment_employee',
        { token: noSalaryStaffToken }
      );
      assert.equal(noSalReport.status, 200);
      assert.equal(noSalReport.json.report.filterOptions.employees.length, 0);
      const salarySec = (noSalReport.json.report.sections || []).find((s) => s.key === 'cash_payment_employee');
      assert.equal(
        (salarySec?.rows || []).length,
        0,
        'Employee cash rows must be redacted when user lacks canManageEmployees permission'
      );

      // Explicitly grant canViewReports=true to Rep -> company drawerBalance & profit must be zeroed
      const updRep = await req(baseUrl, 'PUT', `/api/admin/users/${repUserId}`, {
        token: adminToken,
        body: { permissions: { canViewReports: true } },
      });
      assert.equal(updRep.status, 200);
      const repReport = await req(baseUrl, 'GET', '/api/reports/comprehensive', { token: repToken });
      assert.equal(repReport.status, 200);
      assert.equal(repReport.json.report.summary.drawerBalance, 0);
      assert.equal(repReport.json.report.summary.reportProfit, 0);
      assert.equal(repReport.json.report.filterOptions.suppliers.length, 0);
    });

    await test('10. TRUST_PROXY=false ignores spoofed X-Forwarded-For and enforces rate limits on /register & /bootstrap-admin', async () => {
      resetAllRateLimitsForTests();
      let got429Register = false;
      for (let i = 0; i < 30; i++) {
        const res = await req(baseUrl, 'POST', '/api/auth/register', {
          headers: { 'X-Forwarded-For': `10.20.${i}.1` },
          body: { role: 'customer', fullName: 'X', username: 'x', password: '123', phone: '010' },
        });
        if (res.status === 429) {
          assert.equal(res.json?.code, 'REGISTER_RATE_LIMITED');
          got429Register = true;
          break;
        }
      }
      assert.equal(got429Register, true, 'Must rate limit /register by actual socket IP ignoring spoofed X-Forwarded-For');

      let got429Bootstrap = false;
      for (let i = 0; i < 20; i++) {
        const res = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
          headers: { 'X-Forwarded-For': `172.16.${i}.5` },
          body: { fullName: 'X', username: 'x', password: '123' },
        });
        if (res.status === 429) {
          assert.equal(res.json?.code, 'BOOTSTRAP_RATE_LIMITED');
          got429Bootstrap = true;
          break;
        }
      }
      assert.equal(got429Bootstrap, true, 'Must rate limit /bootstrap-admin by actual socket IP');

      let got429Refresh = false;
      for (let i = 0; i < 95; i++) {
        const res = await req(baseUrl, 'POST', '/api/auth/refresh', {
          headers: { 'X-Forwarded-For': `192.168.${i % 200}.9` },
          body: { refreshToken: 'invalid-ref' },
        });
        if (res.status === 429) {
          assert.equal(res.json?.code, 'REFRESH_RATE_LIMITED');
          got429Refresh = true;
          break;
        }
      }
      assert.equal(got429Refresh, true, 'Must rate limit /refresh by actual socket IP');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    resetAllRateLimitsForTests();
    fs.rmSync(jsonDir, { recursive: true, force: true });
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
})();

console.log(`\nALL SECURITY COMPLETION BACKEND TESTS PASSED (${passed} assertion groups)!`);

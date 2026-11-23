import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

// Isolate data directory BEFORE importing server modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_final_sec_audit_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'final_security_audit_jwt_secret_key_for_erp_tests_2026';

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const {
  bootstrapAdmin,
  registerMobileAccount,
  acquirePgTxAdvisoryLock,
} = await import('../db/stores/authStore.js');
const { createAdminUser, updateAdminUser } = await import('../db/stores/inventoryAdminStore.js');
const { getComprehensiveReport, loadFullReportDataset } = await import('../db/stores/reportsStore.js');
const { withJsonTransaction } = await import('../db/jsonLedger.js');
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

function createPgMemPool(queryLog = null) {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();

  const wrapQuery = (target) => async (sql, params) => {
    if (queryLog) queryLog.push({ sql: String(sql), params });
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

console.log('\n=== AWLAD SELIM Final Security Fixes & Audit Verification Suite (JSON + PG) ===');

// ---------------------------------------------------------------------------
// PART 1: Advisory Lock Unit Tests + Concurrent Bootstrap under PG (pg-mem)
// ---------------------------------------------------------------------------
await (async () => {
  const pool = createPgMemPool();
  setInjectedPool(pool);
  resetPgModeCache();
  await initializeSchema();

  try {
    await test('1. acquirePgTxAdvisoryLock rethrows real PostgreSQL SQLSTATE/connection errors and never swallows them', async () => {
      const makeFakeClient = (errToThrow) => ({
        queries: [],
        async query(sql) {
          this.queries.push(sql);
          if (String(sql).includes('pg_advisory_xact_lock')) {
            throw errToThrow;
          }
          return { rows: [], rowCount: 0 };
        },
      });

      // Case A: Real PostgreSQL permission/deadlock error with SQLSTATE even if message mentions pg_advisory_xact_lock
      const pgSqlStateErr = Object.assign(new Error('permission denied for function pg_advisory_xact_lock'), {
        code: '42501',
        severity: 'ERROR',
      });
      await assert.rejects(
        () => acquirePgTxAdvisoryLock(makeFakeClient(pgSqlStateErr), 849201, 1),
        (err) => err.code === '42501'
      );

      // Case B: Deadlock SQLSTATE 40P01
      const deadlockErr = Object.assign(new Error('deadlock detected on pg_advisory_xact_lock'), {
        code: '40P01',
      });
      await assert.rejects(
        () => acquirePgTxAdvisoryLock(makeFakeClient(deadlockErr), 849201, 1),
        (err) => err.code === '40P01'
      );

      // Case C: Real connection drop mentioning pg_advisory_xact_lock
      const connErr = Object.assign(new Error('connection terminated unexpectedly during pg_advisory_xact_lock'), {
        code: 'ECONNRESET',
      });
      await assert.rejects(
        () => acquirePgTxAdvisoryLock(makeFakeClient(connErr), 849201, 1),
        (err) => err.code === 'ECONNRESET'
      );

      // Case D: Benign pg-mem unsupported feature error while injected pool active
      const pgMemErr = new Error('Function pg_advisory_xact_lock does not exist (pg-mem)');
      await acquirePgTxAdvisoryLock(makeFakeClient(pgMemErr), 849201, 1);
    });

    await test('2. Two concurrent bootstrapAdmin calls in PG mode allow strictly 1 winner', async () => {
      process.env.BOOTSTRAP_ADMIN_SECRET = 'PgBootstrapAudit#2026';
      try {
        const results = await Promise.allSettled([
          bootstrapAdmin({
            fullName: 'مدير التزامن 1',
            username: 'race_admin_1',
            password: 'StrongPassword!1',
            phone: '01000001111',
            bootstrapSecret: 'PgBootstrapAudit#2026',
          }),
          bootstrapAdmin({
            fullName: 'مدير التزامن 2',
            username: 'race_admin_2',
            password: 'StrongPassword!2',
            phone: '01000002222',
            bootstrapSecret: 'PgBootstrapAudit#2026',
          }),
        ]);
        const ok = results.filter((r) => r.status === 'fulfilled');
        const fail = results.filter((r) => r.status === 'rejected');
        assert.equal(ok.length, 1, 'Strictly 1 concurrent bootstrapAdmin call must succeed');
        assert.equal(fail.length, 1, 'Second concurrent bootstrapAdmin call must be rejected');

        const adminRows = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
        assert.equal(adminRows.rowCount, 1);
      } finally {
        delete process.env.BOOTSTRAP_ADMIN_SECRET;
      }
    });

    await test('2b. initializeSchema surfaces genuine SQL/permission errors and reportsStore exports loadFullReportDataset', async () => {
      assert.equal(typeof loadFullReportDataset, 'function', 'loadFullReportDataset must be exported from reportsStore.js');
      const brokenPool = {
        async query() {
          throw Object.assign(new Error('permission denied for schema public'), { code: '42501' });
        },
        async connect() {
          return {
            async query() {
              throw Object.assign(new Error('permission denied for schema public'), { code: '42501' });
            },
            release() {},
          };
        },
      };
      setInjectedPool(brokenPool);
      resetPgModeCache();
      try {
        const res = await initializeSchema();
        assert.equal(res.success, false, 'initializeSchema must return success:false on real SQL permission failure');
        assert.ok(String(res.error || '').includes('permission denied'), 'initializeSchema error must not be swallowed silently');
      } finally {
        setInjectedPool(pool);
        resetPgModeCache();
      }
    });
  } finally {
    setInjectedPool(null);
    resetPgModeCache();
  }
})();

// ---------------------------------------------------------------------------
// PART 2: Full End-to-End Verification Runner for BOTH Modes (JSON & PG)
// ---------------------------------------------------------------------------
async function runFullModeAudit(modeName) {
  const modeDir = fs.mkdtempSync(path.join(os.tmpdir(), `awlad_audit_${modeName}_`));
  process.env.AWLAD_DATA_DIR = modeDir;
  resetAllRateLimitsForTests();

  const sqlQueries = [];
  let pgPool = null;
  if (modeName === 'pg') {
    pgPool = createPgMemPool(sqlQueries);
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
  let adminUser = null;
  let rep1Token = '';
  let rep1User = null;
  let rep1Id = '';
  let rep2User = null;
  let rep2Id = '';
  let mainWhId = '';
  let cashboxId = '';
  let cashbox2Id = '';
  let productId = '';
  let custUnassignedToRep1Id = '';
  let orderId = '';
  let seededInvNumber = '';
  let seededInvId = '';

  try {
    await test(`[${modeName}] 3. Seed admin, warehouse, cashboxes, product, two reps & customer assigned to rep2`, async () => {
      process.env.BOOTSTRAP_ADMIN_SECRET = 'ModeAuditSecret#2026';
      try {
        const boot = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
          body: {
            fullName: 'مدير التدقيق الشامل',
            username: 'audit_admin',
            password: 'AdminPassword!2026',
            phone: '01011119999',
            bootstrapSecret: 'ModeAuditSecret#2026',
          },
        });
        assert.equal(boot.status, 201);
        adminUser = boot.json.user;
      } finally {
        delete process.env.BOOTSTRAP_ADMIN_SECRET;
      }

      const adminLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'audit_admin', password: 'AdminPassword!2026' },
      });
      assert.equal(adminLogin.status, 200);
      adminToken = adminLogin.json.accessToken;
      assert.ok(adminToken);

      const whRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
        token: adminToken,
        body: { name: 'مخزن التدقيق', code: 'AUD-WH', isDefault: true },
      });
      assert.equal(whRes.status, 201);
      mainWhId = whRes.json.warehouse.id;

      const cb1Res = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: adminToken,
        body: { name: 'الخزينة الرئيسية', type: 'cash', openingBalance: 50000, isDefault: true },
      });
      assert.equal(cb1Res.status, 201);
      cashboxId = cb1Res.json.cashbox.id;

      const cb2Res = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: adminToken,
        body: { name: 'حساب البنك السري', type: 'bank', openingBalance: 125000 },
      });
      assert.equal(cb2Res.status, 201);
      cashbox2Id = cb2Res.json.cashbox.id;

      // Seed admin cashbox transfer & expense so admin financial data definitely exists
      const expRes = await req(baseUrl, 'POST', '/api/admin/expenses', {
        token: adminToken,
        body: {
          type: 'expense',
          category: 'إيجار ومرافق سرية',
          amount: 1500,
          cashboxId,
          date: '2026-11-20',
          description: 'مصروف إداري سري',
        },
      });
      assert.equal(expRes.status, 201);

      const trRes = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        body: {
          type: 'cashbox_transfer',
          amount: 2000,
          cashboxId,
          targetCashboxId: cashbox2Id,
          date: '2026-11-20',
          notes: 'تحويل إداري سري بين الخزائن',
        },
      });
      assert.equal(trRes.status, 201);

      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: 'زيت ذرة ممتاز',
          code: 'OIL-99',
          category: 'زيوت',
          baseUnit: 'زجاجة',
          purchasePrice: 40,
          sellingPrice: 60,
          stockPerWarehouse: { [mainWhId]: 200 },
        },
      });
      assert.equal(prodRes.status, 201);
      productId = prodRes.json.product.id;

      // Create Rep 1 (granted broad sales/accounts/reports/inventory permissions to verify RBAC still protects cashboxes/other-reps/global-conflicts)
      const r1Reg = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب أول',
          username: 'audit_rep_1',
          phone: '01022220001',
          password: 'RepPassword!1',
        },
      });
      assert.equal(r1Reg.status, 201);
      rep1User = r1Reg.json.user;
      rep1Id = r1Reg.json.representativeProfile?.id;
      assert.ok(rep1Id);

      // Update rep1 permissions (including canManageSales, canManageAccounts, canViewReports, canManageInventory)
      const updR1 = await req(baseUrl, 'PUT', `/api/admin/users/${rep1User.id}`, {
        token: adminToken,
        body: {
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: true,
            canManageSales: true,
            canCreatePurchase: false,
            canManageAccounts: true,
            canViewReports: true,
            canManageInventory: true,
          },
        },
      });
      assert.equal(updR1.status, 200);

      const r1Login = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'audit_rep_1', password: 'RepPassword!1' },
      });
      assert.equal(r1Login.status, 200);
      rep1Token = r1Login.json.accessToken;

      // Create Rep 2 with sensitive commissionRate, openingBalance, currentBalance, phone, vehicleNumber
      const r2Reg = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب ثاني سري',
          username: 'audit_rep_2',
          phone: '01022220002',
          password: 'RepPassword!2',
        },
      });
      assert.equal(r2Reg.status, 201);
      rep2User = r2Reg.json.user;
      rep2Id = r2Reg.json.representativeProfile?.id;
      assert.ok(rep2Id);

      const updRep2 = await req(baseUrl, 'PUT', `/api/admin/representatives/${rep2Id}`, {
        token: adminToken,
        body: {
          phone: '01088887777',
          vehicleNumber: 'ق هـ 9999',
          commissionRate: 7.5,
          openingBalance: 1000,
          currentBalance: 4300,
          notes: 'ملاحظة خاصة بالمندوب الثاني',
        },
      });
      assert.equal(updRep2.status, 200);

      // Create customer explicitly NOT assigned to rep1 (assigned to rep2)
      const custRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: {
          name: 'عميل شركة عام',
          phone: '01033334444',
          address: 'مدينة نصر',
          openingBalance: 1000,
          assignedRepId: rep2Id,
        },
      });
      assert.equal(custRes.status, 201);
      custUnassignedToRep1Id = custRes.json.customer.id;
    });

    await test(`[${modeName}] 4. Rep retains FULL customer access (all customers, edit, payment, order advance, sales invoice) while cashbox balances & admin cash ops are blocked`, async () => {
      // Bootstrap & Sync Pull for Rep 1
      const bootRep = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: rep1Token });
      assert.equal(bootRep.status, 200);
      const bootData = bootRep.json.data;

      // Customer assigned to rep2 IS still visible to rep1
      const foundCust = (bootData.customers || []).find((c) => c.id === custUnassignedToRep1Id);
      assert.ok(foundCust, 'Rep must still see ALL company customers regardless of assignedRepId');

      // Cashbox balances MUST be stripped & marked balanceHidden
      assert.ok((bootData.cashboxes || []).length >= 2);
      for (const cb of bootData.cashboxes) {
        assert.equal(cb.balanceHidden, true, `Cashbox ${cb.name} must set balanceHidden: true for rep`);
        assert.equal(cb.openingBalance, undefined, `Cashbox openingBalance must not be sent to rep`);
        assert.equal(cb.currentBalance, undefined, `Cashbox currentBalance must not be sent to rep`);
      }
      assert.equal((bootData.financialTransactions || []).length, 0, 'Rep must not receive company financialTransactions');
      assert.equal((bootData.expenseIncomes || []).length, 0, 'Rep must not receive company expenseIncomes');
      assert.equal((bootData.suppliers || []).length, 0, 'Rep must not receive suppliers');

      const pullRep = await req(baseUrl, 'GET', '/api/sync/pull', { token: rep1Token });
      assert.equal(pullRep.status, 200);
      for (const cb of pullRep.json.cashboxes || []) {
        assert.equal(cb.balanceHidden, true);
        assert.equal(cb.openingBalance, undefined);
        assert.equal(cb.currentBalance, undefined);
      }
      assert.equal((pullRep.json.financialTransactions || []).length, 0);
      assert.equal((pullRep.json.expenseIncomes || []).length, 0);

      // Rep CAN edit customer
      const editCustRes = await req(baseUrl, 'PUT', `/api/customers/${custUnassignedToRep1Id}`, {
        token: rep1Token,
        body: { notes: 'تم التحديث بواسطة المندوب الأول' },
      });
      assert.equal(editCustRes.status, 200);

      // Rep CAN record customer payment, response MUST NOT include cashboxBalance
      const payRes = await req(baseUrl, 'POST', `/api/customers/${custUnassignedToRep1Id}/payment`, {
        token: rep1Token,
        headers: { 'Idempotency-Key': `REP-PAY-${modeName}` },
        body: { amount: 250, cashboxId, paymentMethod: 'cash', date: '2026-11-20', notes: 'تحصيل مندوب' },
      });
      assert.equal(payRes.status, 200);
      assert.equal('cashboxBalance' in payRes.json, false, 'Rep payment response must not expose cashboxBalance');

      // Rep CAN create customer order + record advance payment without cashboxBalance leak
      const ordRes = await req(baseUrl, 'POST', '/api/orders', {
        token: rep1Token,
        headers: { 'Idempotency-Key': `REP-ORD-${modeName}` },
        body: {
          customerId: custUnassignedToRep1Id,
          items: [{ productId, quantity: 2, unitPrice: 60 }],
          notes: 'طلب عميل عبر المندوب',
        },
      });
      assert.equal(ordRes.status, 201);
      orderId = ordRes.json.order.id;

      const advRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/advance-payment`, {
        token: rep1Token,
        headers: { 'Idempotency-Key': `REP-ADV-${modeName}` },
        body: { amount: 50, cashboxId, notes: 'دفعة مقدمة' },
      });
      assert.equal(advRes.status, 201);
      assert.equal('cashboxBalance' in advRes.json, false, 'Rep advance payment response must not expose cashboxBalance');

      // Rep CAN create sales invoice for that customer
      const saleRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: rep1Token,
        headers: { 'Idempotency-Key': `REP-SALE-${modeName}` },
        body: {
          customerId: custUnassignedToRep1Id,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 100,
          items: [{ productId, quantity: 3, unit: 'زجاجة', unitPrice: 60 }],
        },
      });
      assert.equal(saleRes.status, 201);
      seededInvId = saleRes.json.invoice.id;
      seededInvNumber = saleRes.json.invoice.invoiceNumber;

      // Rep CANNOT execute administrative cash operations, cashbox creation/transfer, expenses, supplier payments, or cheques even with canManageAccounts
      const cashOpDenied = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: rep1Token,
        body: { type: 'cash_withdrawal', amount: 100, cashboxId, date: '2026-11-20' },
      });
      assert.equal(cashOpDenied.status, 403);
      assert.equal(cashOpDenied.json?.code, 'FORBIDDEN_REP_CASHBOX_OP');

      const createCbDenied = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: rep1Token,
        body: { name: 'خزينة غير مصرح بها', type: 'cash', openingBalance: 0 },
      });
      assert.equal(createCbDenied.status, 403);

      const expenseDenied = await req(baseUrl, 'POST', '/api/admin/expenses', {
        token: rep1Token,
        body: { type: 'expense', category: 'مصروف غير مصرح', amount: 50, cashboxId, date: '2026-11-20' },
      });
      assert.equal(expenseDenied.status, 403);
      assert.equal(expenseDenied.json?.code, 'FORBIDDEN_REP_CASHBOX_OP');

      const suppPayDenied = await req(baseUrl, 'POST', '/api/admin/suppliers/payment', {
        token: rep1Token,
        body: { supplierId: 'SUP-ANY', amount: 50, cashboxId },
      });
      assert.equal(suppPayDenied.status, 403);
      assert.equal(suppPayDenied.json?.code, 'FORBIDDEN_REP_CASHBOX_OP');

      const chequeDenied = await req(baseUrl, 'POST', '/api/admin/cheques', {
        token: rep1Token,
        body: { chequeNumber: '999', type: 'incoming', bankName: 'بنك', amount: 100, issueDate: '2026-11-20', dueDate: '2026-12-20', partyName: 'عميل' },
      });
      assert.equal(chequeDenied.status, 403);
      assert.equal(chequeDenied.json?.code, 'FORBIDDEN_REP_CASHBOX_OP');

      const syncCashOpDenied = await req(baseUrl, 'POST', '/api/sync/push', {
        token: rep1Token,
        body: {
          operations: [
            {
              operationId: `SYNC-CASH-OP-${modeName}`,
              operationType: 'execute_cash_operation',
              entityType: 'cashbox',
              payload: { type: 'cash_deposit', amount: 100, cashboxId },
            },
          ],
        },
      });
      assert.equal(syncCashOpDenied.status, 200);
      assert.equal(syncCashOpDenied.json.results[0].status, 'failed');
      assert.equal(syncCashOpDenied.json.results[0].code, 'FORBIDDEN_REP_CASHBOX_OP');
    });

    await test(`[${modeName}] 5. Rep receives ONLY self profile (no other reps, no commissionRate/openingBalance) while admin keeps full rep data`, async () => {
      const bootRep = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: rep1Token });
      assert.equal(bootRep.status, 200);
      const repList = bootRep.json.data.representatives || [];
      assert.equal(repList.length, 1, 'Rep must only receive own representative record');
      assert.equal(repList[0].id, rep1Id);
      assert.equal(repList.some((r) => r.id === rep2Id), false, 'Rep2 must never appear in Rep1 representatives list');
      assert.equal('commissionRate' in repList[0], false, 'commissionRate must not be exposed to rep');
      assert.equal('openingBalance' in repList[0], false, 'openingBalance must not be exposed to rep');

      const pullRep = await req(baseUrl, 'GET', '/api/sync/pull', { token: rep1Token });
      assert.equal(pullRep.status, 200);
      assert.equal((pullRep.json.representatives || []).length, 1);
      assert.equal(pullRep.json.representatives[0].id, rep1Id);
      assert.equal('commissionRate' in (pullRep.json.representativeProfile || {}), false);
      assert.equal('openingBalance' in (pullRep.json.representativeProfile || {}), false);
      assert.equal(pullRep.text.includes('01088887777'), false, 'Rep2 private phone must never leak in sync/pull');
      assert.equal(pullRep.text.includes('ق هـ 9999'), false, 'Rep2 vehicleNumber must never leak');
      assert.equal(pullRep.text.includes('ملاحظة خاصة بالمندوب الثاني'), false, 'Rep2 private notes must never leak');

      // Admin keeps full data
      const bootAdmin = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(bootAdmin.status, 200);
      const adminRep2 = (bootAdmin.json.data.representatives || []).find((r) => r.id === rep2Id);
      assert.ok(adminRep2);
      assert.equal(Number(adminRep2.commissionRate), 7.5);
      assert.equal(Number(adminRep2.openingBalance), 1000);
      assert.equal(adminRep2.phone, '01088887777');
    });

    await test(`[${modeName}] 6. Sync conflicts RBAC (canManageSales/canManageAccounts do NOT leak other users' conflicts) + payload sanitization`, async () => {
      const rep2ConfId = `CONF_REP2_${modeName}`;
      const rep1ConfId = `CONF_REP1_${modeName}`;
      const pollutedLocal = JSON.parse(
        '{"customerId":"C1","passwordHash":"$2a$10$SECRET","refreshToken":"TOP_SECRET_TOK","purchasePrice":40,"costPrice":39,"profit":20,"__proto__":{"polluted":true},"nested":{"apiKey":"LEAK_KEY","qty":2}}'
      );
      const pollutedSnap = JSON.parse(
        '{"invoiceId":"INV1","jwtSecret":"SECRET_JWT","costValue":80,"totalCost":80,"__proto__":{"evil":1},"safeField":"ok"}'
      );

      if (modeName === 'pg') {
        const now = new Date().toISOString();
        await pgPool.query(
          `INSERT INTO sync_conflicts (id, operation_id, operation_type, entity_type, entity_id, device_id, user_id, user_name, conflict_reason, local_payload, server_snapshot, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            rep2ConfId,
            `OP_R2_${modeName}`,
            'edit_sales_invoice',
            'invoice',
            'INV_R2',
            'DEV_R2',
            rep2User.id,
            rep2User.fullName,
            'تعارض رقم نسخة للمندوب الثاني',
            JSON.stringify(pollutedLocal),
            JSON.stringify(pollutedSnap),
            'needs_review',
            now,
          ]
        );
        await pgPool.query(
          `INSERT INTO sync_conflicts (id, operation_id, operation_type, entity_type, entity_id, device_id, user_id, user_name, conflict_reason, local_payload, server_snapshot, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            rep1ConfId,
            `OP_R1_${modeName}`,
            'edit_sales_invoice',
            'invoice',
            'INV_R1',
            'DEV_R1',
            rep1User.id,
            rep1User.fullName,
            'تعارض رقم نسخة للمندوب الأول',
            JSON.stringify(pollutedLocal),
            JSON.stringify(pollutedSnap),
            'needs_review',
            now,
          ]
        );
      } else {
        await withJsonTransaction((db) => {
          const now = new Date().toISOString();
          db.syncConflicts.unshift(
            {
              id: rep2ConfId,
              operationId: `OP_R2_${modeName}`,
              operationType: 'edit_sales_invoice',
              entityType: 'invoice',
              entityId: 'INV_R2',
              deviceId: 'DEV_R2',
              userId: rep2User.id,
              userName: rep2User.fullName,
              conflictReason: 'تعارض رقم نسخة للمندوب الثاني',
              localPayload: pollutedLocal,
              serverSnapshot: pollutedSnap,
              status: 'needs_review',
              createdAt: now,
            },
            {
              id: rep1ConfId,
              operationId: `OP_R1_${modeName}`,
              operationType: 'edit_sales_invoice',
              entityType: 'invoice',
              entityId: 'INV_R1',
              deviceId: 'DEV_R1',
              userId: rep1User.id,
              userName: rep1User.fullName,
              conflictReason: 'تعارض رقم نسخة للمندوب الأول',
              localPayload: pollutedLocal,
              serverSnapshot: pollutedSnap,
              status: 'needs_review',
              createdAt: now,
            }
          );
        });
      }

      // Rep1 has canManageSales=true & canManageAccounts=true, MUST still see ONLY rep1's conflict
      const confRes = await req(baseUrl, 'GET', '/api/sync/conflicts', { token: rep1Token });
      assert.equal(confRes.status, 200);
      assert.equal(confRes.json.conflicts.some((c) => c.id === rep2ConfId), false, 'Rep1 must NOT see Rep2 conflict');
      const ownConf = confRes.json.conflicts.find((c) => c.id === rep1ConfId);
      assert.ok(ownConf, 'Rep1 must see own conflict');

      // Verify secret & cost sanitization + no prototype pollution
      assert.equal('passwordHash' in ownConf.localPayload, false);
      assert.equal('refreshToken' in ownConf.localPayload, false);
      assert.equal('apiKey' in (ownConf.localPayload.nested || {}), false);
      assert.equal(ownConf.localPayload.nested?.qty, 2);
      assert.equal('purchasePrice' in ownConf.localPayload, false, 'purchasePrice redacted for rep');
      assert.equal('costPrice' in ownConf.localPayload, false, 'costPrice redacted for rep');
      assert.equal('profit' in ownConf.localPayload, false, 'profit redacted for rep');
      assert.equal('jwtSecret' in ownConf.serverSnapshot, false);
      assert.equal('costValue' in ownConf.serverSnapshot, false);
      assert.equal(Object.prototype.hasOwnProperty.call(ownConf.localPayload, '__proto__'), false);
      assert.equal(({}).polluted, undefined);

      // Also check bootstrap & pull do not leak rep2's conflict
      const bootRep = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: rep1Token });
      assert.equal((bootRep.json.data.syncConflicts || []).some((c) => c.id === rep2ConfId), false);
      const pullRep = await req(baseUrl, 'GET', '/api/sync/pull', { token: rep1Token });
      assert.equal((pullRep.json.syncConflicts || []).some((c) => c.id === rep2ConfId), false);

      // Resolving Rep2 conflict by Rep1 must return 403 FORBIDDEN_CONFLICT_ACCESS
      const resolveRep2Denied = await req(baseUrl, 'POST', `/api/sync/conflicts/${rep2ConfId}/resolve`, {
        token: rep1Token,
        body: { action: 'dismiss', resolutionNotes: 'محاولة غير مصرح بها' },
      });
      assert.equal(resolveRep2Denied.status, 403);
      assert.equal(resolveRep2Denied.json?.code, 'FORBIDDEN_CONFLICT_ACCESS');

      // Authorized admin sees BOTH conflicts and secrets are still stripped
      const adminConfRes = await req(baseUrl, 'GET', '/api/sync/conflicts', { token: adminToken });
      assert.equal(adminConfRes.status, 200);
      const adminSeesRep2 = adminConfRes.json.conflicts.find((c) => c.id === rep2ConfId);
      assert.ok(adminSeesRep2, 'Admin must see all sync conflicts');
      assert.equal('passwordHash' in adminSeesRep2.localPayload, false);
      assert.equal('jwtSecret' in adminSeesRep2.serverSnapshot, false);

      // Sales manager WITHOUT canManageSettings/canManageUsers/canManageSyncConflicts sees ONLY own conflicts
      const salesMgr = await createAdminUser(
        {
          fullName: 'مدير مبيعات غير مخول للتعارضات',
          username: `sales_mgr_${modeName}`,
          password: 'SalesPassword!2026',
          role: 'sales',
          permissions: { canManageSales: true, canView: true },
        },
        adminUser
      );
      const salesLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: salesMgr.username, password: 'SalesPassword!2026' },
      });
      assert.equal(salesLogin.status, 200);
      const salesConfRes = await req(baseUrl, 'GET', '/api/sync/conflicts', {
        token: salesLogin.json.accessToken,
      });
      assert.equal(salesConfRes.status, 200);
      assert.equal(salesConfRes.json.conflicts.length, 0, 'canManageSales alone must NOT expose other users sync conflicts');

      // Invalid /sync/push payloads rejected cleanly
      const badOpsRes = await req(baseUrl, 'POST', '/api/sync/push', {
        token: rep1Token,
        body: { operations: 'not-an-array' },
      });
      assert.equal(badOpsRes.status, 400);
      assert.equal(badOpsRes.json?.code, 'INVALID_SYNC_OPERATIONS');

      const badOpPayloadRes = await req(baseUrl, 'POST', '/api/sync/push', {
        token: rep1Token,
        body: {
          operations: [
            { operationId: `BAD_OP_${modeName}`, operationType: 'create_order', payload: ['invalid-array'] },
          ],
        },
      });
      assert.equal(badOpPayloadRes.status, 200);
      assert.equal(badOpPayloadRes.json.results[0].status, 'failed');
      assert.equal(badOpPayloadRes.json.results[0].code, 'INVALID_SYNC_PAYLOAD');
    });

    await test(`[${modeName}] 7. Phone lookup avoids full-table scans in PG & blocks duplicate normalized phones (CUSTOMER_PHONE_CONFLICT / REP_PHONE_CONFLICT)`, async () => {
      if (modeName === 'pg') {
        sqlQueries.length = 0;
      }

      // First registration with formatted +20 phone safely auto-links to existing unlinked customer via normalized_phone/variant lookup
      const firstCustReg = await registerMobileAccount({
        role: 'customer',
        fullName: 'عميل شركة عام',
        username: `linked_cust_${modeName}`,
        phone: '+20 103-333-4444',
        password: 'CustPassword!2026',
      });
      assert.equal(firstCustReg.customerProfile?.id, custUnassignedToRep1Id);

      // Duplicate formatted customer phone (010-3333-4444 vs already linked +20 103-333-4444) must reject with 409 CUSTOMER_PHONE_CONFLICT
      await assert.rejects(
        () =>
          registerMobileAccount({
            role: 'customer',
            fullName: 'عميل مكرر',
            username: `dup_cust_${modeName}`,
            phone: '010-3333-4444',
            password: 'CustPassword!2026',
          }),
        (err) => err.status === 409 && ['CUSTOMER_PHONE_CONFLICT', 'PHONE_EXISTS'].includes(err.code)
      );

      // Duplicate formatted representative phone must reject cleanly
      await assert.rejects(
        () =>
          registerMobileAccount({
            role: 'representative',
            fullName: 'مندوب مكرر',
            username: `dup_rep_${modeName}`,
            phone: '010-8888-7777',
            password: 'RepPassword!2026',
          }),
        (err) => err.status === 409 && ['REP_PHONE_CONFLICT', 'PHONE_EXISTS'].includes(err.code)
      );

      // Admin user creation + update linking
      const staffCreated = await createAdminUser(
        {
          fullName: 'موظف اختبار ربط الهاتف',
          username: `link_staff_${modeName}`,
          password: 'StaffPassword!2026',
          role: 'sales',
          phone: '01055556666',
        },
        adminUser
      );
      await updateAdminUser(
        staffCreated.id,
        { phone: '01055557777', fullName: 'موظف محدث' },
        adminUser
      );

      if (modeName === 'pg') {
        const hasFullCustScan = sqlQueries.some((q) =>
          /SELECT\s+id,\s*phone,\s*secondary_phone,\s*phones\s+FROM\s+customers/i.test(q.sql)
        );
        const hasFullRepScan = sqlQueries.some((q) =>
          /SELECT\s+id,\s*phone\s+FROM\s+representatives\s+WHERE\s+user_id\s+IS\s+NULL/i.test(q.sql)
        );
        assert.equal(hasFullCustScan, false, 'Must NOT run full-table customers phone scan in PG');
        assert.equal(hasFullRepScan, false, 'Must NOT run full-table representatives phone scan in PG');

        const usesNormPhoneIdxQuery = sqlQueries.some((q) =>
          /normalized_phone\s*=\s*\$\d+/i.test(q.sql)
        );
        assert.equal(usesNormPhoneIdxQuery, true, 'Must use targeted indexed normalized_phone = $N lookup');
      }
    });

    await test(`[${modeName}] 8. Reports optimization (SQL pushdown, dead-query pruning, pagination parity, & rep cost/cashbox redaction)`, async () => {
      if (modeName === 'pg') {
        sqlQueries.length = 0;
      }

      // Admin comprehensive report with SQL filters & pagination
      const unpagedRes = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?dateFrom=2026-11-20&dateTo=2026-11-20&customerId=${encodeURIComponent(custUnassignedToRep1Id)}&cashboxId=${encodeURIComponent(cashboxId)}&invoiceNumber=${encodeURIComponent(seededInvNumber)}`,
        { token: adminToken }
      );
      assert.equal(unpagedRes.status, 200);
      assert.equal(unpagedRes.json.report.pagination.enabled, false);
      const totalUnpaged = unpagedRes.json.report.pagination.totalRows;

      if (modeName === 'pg') {
        const deadTables = [
          'FROM stock_counts',
          'FROM stock_count_items',
          'FROM stock_transfer_requests',
          'FROM stock_transfer_request_items',
          'FROM rep_item_transfers',
          'FROM rep_item_transfer_items',
          'FROM payrolls',
          'FROM audit_logs',
        ];
        for (const dt of deadTables) {
          assert.equal(
            sqlQueries.some((q) => q.sql.includes(dt)),
            false,
            `Dead or unnecessary query "${dt}" should NOT execute on standard comprehensive report`
          );
        }
        assert.equal(
          sqlQueries.some((q) => /customer_id\s*=\s*\$/i.test(q.sql)),
          true,
          'customerId filter must be pushed down to PostgreSQL'
        );
        assert.equal(
          sqlQueries.some((q) => /LOWER\(invoice_number\)\s+LIKE\s+LOWER\(\$/i.test(q.sql)),
          true,
          'invoiceNumber filter must be pushed down to PostgreSQL'
        );
      }

      // Seed a couple more invoices so pagination slices cleanly (> 2 rows)
      for (let i = 1; i <= 3; i++) {
        await req(baseUrl, 'POST', '/api/invoices/sales', {
          token: adminToken,
          headers: { 'Idempotency-Key': `PG-INV-${modeName}-${i}` },
          body: {
            customerId: custUnassignedToRep1Id,
            warehouseId: mainWhId,
            cashboxId,
            date: '2026-11-20',
            paidAmount: 60,
            items: [{ productId, quantity: 1, unit: 'زجاجة', unitPrice: 60 }],
          },
        });
      }

      const fullAll = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=sales_invoices&dateFrom=2026-11-20&dateTo=2026-11-20',
        { token: adminToken }
      );
      assert.equal(fullAll.status, 200);
      const salesRowsAll = fullAll.json.report.sections.find((s) => s.key === 'sales_invoices')?.rows || [];
      assert.ok(salesRowsAll.length >= 4, 'Expected at least 4 sales invoices');

      const page1 = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=sales_invoices&dateFrom=2026-11-20&dateTo=2026-11-20&page=1&pageSize=2',
        { token: adminToken }
      );
      assert.equal(page1.status, 200);
      assert.equal(page1.json.report.pagination.enabled, true);
      assert.equal(page1.json.report.pagination.page, 1);
      assert.equal(page1.json.report.pagination.pageSize, 2);
      assert.equal(page1.json.report.pagination.totalRows, salesRowsAll.length);
      assert.equal(page1.json.report.pagination.hasNextPage, true);
      const p1Rows = page1.json.report.sections.find((s) => s.key === 'sales_invoices')?.rows || [];
      assert.equal(p1Rows.length, 2);
      assert.equal(
        page1.json.report.summary.filteredSalesNet,
        fullAll.json.report.summary.filteredSalesNet,
        'Pagination must keep exact full summary totals'
      );

      const page2 = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=sales_invoices&dateFrom=2026-11-20&dateTo=2026-11-20&page=2&pageSize=2',
        { token: adminToken }
      );
      assert.equal(page2.status, 200);
      const p2Rows = page2.json.report.sections.find((s) => s.key === 'sales_invoices')?.rows || [];
      assert.equal(p2Rows.length, 2);
      assert.ok(p1Rows[0].rowId);
      assert.ok(p2Rows[0].rowId);
      assert.notEqual(p1Rows[0].rowId, p2Rows[0].rowId);
      assert.notEqual(p1Rows[0].docId, p2Rows[0].docId);

      // Representative comprehensive report redaction + admin-table query pruning in PG
      if (modeName === 'pg') sqlQueries.length = 0;
      const repRpt = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?dateFrom=2026-11-20&dateTo=2026-11-20&productId=${encodeURIComponent(productId)}`,
        { token: rep1Token }
      );
      assert.equal(repRpt.status, 200);
      const rpt = repRpt.json.report;
      assert.equal(rpt.summary.drawerBalance, 0);
      assert.equal(rpt.summary.reportBalance, 0);
      assert.equal(rpt.summary.carriedFromYesterday, 0);
      assert.equal(rpt.summary.reportProfit, 0);
      assert.equal(rpt.filterOptions.cashboxes.length, 0);
      assert.equal(rpt.filterOptions.suppliers.length, 0);
      assert.equal(rpt.filterOptions.employees.length, 0);
      assert.equal(rpt.filterOptions.users.length, 0);
      assert.equal(rpt.itemPnl.portfolioTotals.cogs, 0);
      assert.equal(rpt.itemPnl.portfolioTotals.netProfit, 0);
      if (rpt.itemLifecycle?.events) {
        for (const ev of rpt.itemLifecycle.events) {
          assert.equal(Number(ev.unitCost || 0), 0, 'Rep lifecycle event unitCost must be 0');
          assert.equal(String(ev.notes || '').includes('سعر الشراء'), false, 'Rep lifecycle notes must not leak purchase price');
        }
      }
      for (const sec of rpt.sections) {
        for (const row of sec.rows || []) {
          assert.equal(Number(row.costValue || 0), 0, 'Rep report row costValue must be 0');
          assert.equal(Number(row.profit || 0), 0, 'Rep report row profit must be 0');
          assert.equal(row.balanceAfter ?? null, null, 'Rep report row balanceAfter must be redacted');
        }
      }
      if (modeName === 'pg') {
        assert.equal(sqlQueries.some((q) => /FROM\s+suppliers/i.test(q.sql)), false);
        assert.equal(sqlQueries.some((q) => /FROM\s+expenses_incomes/i.test(q.sql)), false);
      }

      // Representative source-document endpoint redacts purchasePriceAtTime
      const repSrcDoc = await req(
        baseUrl,
        'GET',
        `/api/reports/source-document?docType=sales_invoice&docId=${encodeURIComponent(seededInvId)}`,
        { token: rep1Token }
      );
      assert.equal(repSrcDoc.status, 200);
      for (const item of repSrcDoc.json.document?.items || []) {
        assert.equal(Number(item.purchasePriceAtTime || 0), 0, 'Rep source-document must redact purchasePriceAtTime');
      }

      // Representative item-movement-report redacts purchase cost & profit
      const repMovRes = await req(baseUrl, 'GET', '/api/inventory/item-movement-report', {
        token: rep1Token,
      });
      assert.equal(repMovRes.status, 200);
      assert.equal((repMovRes.json.report.sections.purchases || []).length, 0);
      assert.equal(repMovRes.json.report.totals.totalCostOfGoodsSold, 0);
      assert.equal(repMovRes.json.report.totals.totalProfit, 0);
      assert.equal(repMovRes.json.report.totals.inventoryValuation, 0);
      for (const secList of [
        repMovRes.json.report.sections.sales || [],
        repMovRes.json.report.sections.sales_returns || [],
        repMovRes.json.report.sections.transfers || [],
        repMovRes.json.report.sections.adjustments || [],
      ]) {
        for (const sRow of secList) {
          assert.equal(Number(sRow.costPrice || 0), 0);
          assert.equal(Number(sRow.costValue || 0), 0);
          assert.equal(Number(sRow.profitValue || 0), 0);
        }
      }

      // Verify pagination metadata doesn't change unpaged total check
      assert.ok(Number.isFinite(totalUnpaged));
    });

    await test(`[${modeName}] 9. Strict customer-role cross-customer & staff-route isolation (JSON & PG)`, async () => {
      // Customer 1 was auto-linked in step 7 (username: linked_cust_${modeName})
      const cust1Login = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `linked_cust_${modeName}`, password: 'CustPassword!2026' },
      });
      assert.equal(cust1Login.status, 200);
      const cust1Token = cust1Login.json.accessToken;

      // Seed Customer 2 + order + confirmed sales invoice exclusively for Customer 2
      const cust2Create = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: {
          name: 'عميل ثاني معزول',
          phone: '01077776666',
          address: 'المعادي',
          openingBalance: 450,
        },
      });
      assert.equal(cust2Create.status, 201);
      const cust2Id = cust2Create.json.customer.id;

      const cust2Reg = await registerMobileAccount({
        role: 'customer',
        fullName: 'عميل ثاني معزول',
        username: `cust2_${modeName}`,
        phone: '01077776666',
        password: 'Cust2Password!2026',
      });
      assert.equal(cust2Reg.customerProfile?.id, cust2Id);

      const cust2Login = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `cust2_${modeName}`, password: 'Cust2Password!2026' },
      });
      assert.equal(cust2Login.status, 200);
      const cust2Token = cust2Login.json.accessToken;

      const cust2OrderRes = await req(baseUrl, 'POST', '/api/orders', {
        token: cust2Token,
        headers: { 'Idempotency-Key': `CUST2-ORD-${modeName}` },
        body: {
          customerId: cust2Id,
          items: [{ productId, quantity: 1, unitPrice: 60 }],
          notes: 'طلب سري للعميل الثاني فقط',
        },
      });
      assert.equal(cust2OrderRes.status, 201);
      const cust2OrderId = cust2OrderRes.json.order.id;

      // Customer 1 MUST be blocked (403) from staff/admin/reports/other-customer routes
      for (const forbiddenReq of [
        { method: 'GET', url: '/api/customers' },
        { method: 'GET', url: `/api/customers/${cust2Id}` },
        { method: 'GET', url: `/api/customers/${cust2Id}/statement` },
        { method: 'GET', url: '/api/invoices' },
        { method: 'GET', url: '/api/admin/bootstrap' },
        { method: 'GET', url: '/api/reports/comprehensive' },
        { method: 'GET', url: '/api/inventory/item-movement-report' },
        { method: 'GET', url: `/api/orders/${cust2OrderId}` },
      ]) {
        const res = await req(baseUrl, forbiddenReq.method, forbiddenReq.url, { token: cust1Token });
        assert.equal(res.status, 403, `Customer must receive 403 on ${forbiddenReq.method} ${forbiddenReq.url}`);
      }

      // Customer 1 self endpoints & /api/sync/pull ONLY return own records, never Customer 2 data
      const myOrders = await req(baseUrl, 'GET', '/api/orders', { token: cust1Token });
      assert.equal(myOrders.status, 200);
      assert.equal((myOrders.json.orders || []).some((o) => o.id === cust2OrderId || o.customerId === cust2Id), false);

      const myPull = await req(baseUrl, 'GET', '/api/sync/pull', { token: cust1Token });
      assert.equal(myPull.status, 200);
      assert.equal(myPull.text.includes('عميل ثاني معزول'), false, 'Customer sync/pull must never leak other customer names');
      assert.equal(myPull.text.includes('01077776666'), false, 'Customer sync/pull must never leak other customer phones');
      assert.equal((myPull.json.representatives || []).length, 0, 'Customer sync/pull must not list representatives');
      assert.equal((myPull.json.cashboxes || []).length, 0, 'Customer sync/pull must not expose cashboxes');

      const myStmt = await req(baseUrl, 'GET', '/api/customers/me/statement', { token: cust1Token });
      assert.equal(myStmt.status, 200);
      assert.equal(myStmt.json.customer?.id, custUnassignedToRep1Id);
    });

    await test(`[${modeName}] 10. PG SQL LIMIT/OFFSET pushdown on reports & bootstrap stock_movements WHERE before LIMIT 1500`, async () => {
      if (modeName !== 'pg') return;
      sqlQueries.length = 0;
      const pagedRpt = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=sales_invoices&dateFrom=2026-11-20&dateTo=2026-11-20&page=1&pageSize=2',
        { token: adminToken }
      );
      assert.equal(pagedRpt.status, 200);
      assert.equal(
        sqlQueries.some((q) => /FROM\s+invoices/i.test(q.sql) && /LIMIT\s+\$\d+\s+OFFSET\s+\$\d+/i.test(q.sql)),
        true,
        'Paged comprehensive sales_invoices report in PG must execute SQL LIMIT $n OFFSET $m'
      );

      sqlQueries.length = 0;
      const repBoot = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: rep1Token });
      assert.equal(repBoot.status, 200);
      assert.equal(
        sqlQueries.some(
          (q) =>
            /FROM\s+stock_movements/i.test(q.sql) &&
            /WHERE\s+\(warehouse_id\s*=\s*\$1\s+OR\s+target_warehouse_id\s*=\s*\$1\)/i.test(q.sql) &&
            /LIMIT\s+1500/i.test(q.sql)
        ),
        true,
        'Rep PG bootstrap stock_movements must apply WHERE warehouse filter BEFORE LIMIT 1500'
      );
    });

    await test(`[${modeName}] 11. Last 3 actual selling prices per customer + product (oldest -> newest, qty, unit, unitFactor, confirmed only)`, async () => {
      const custRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: `عميل تاريخ الأسعار ${modeName}`, phone: '01066665555' },
      });
      assert.equal(custRes.status, 201);
      const custId = custRes.json.customer.id;

      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: `صنف تاريخ الأسعار ${modeName}`,
          code: `PH-${modeName.toUpperCase()}`,
          category: 'عام',
          baseUnit: 'قطعة',
          purchasePrice: 8,
          sellingPrice: 15,
          units: [{ name: 'كرتونة', conversionFactor: 12, purchasePrice: 90, sellingPrice: 160 }],
          stockPerWarehouse: { [mainWhId]: 500 },
        },
      });
      assert.equal(prodRes.status, 201);
      const pId = prodRes.json.product.id;

      // Draft & quote must be excluded from actual confirmed selling prices
      const draftInv = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        headers: { 'Idempotency-Key': `PH-DRAFT-${modeName}` },
        body: {
          customerId: custId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-05',
          status: 'draft',
          paidAmount: 0,
          items: [{ productId: pId, quantity: 99, unit: 'قطعة', unitFactor: 1, unitPrice: 999 }],
        },
      });
      assert.equal(draftInv.status, 201);

      const quoteInv = await req(baseUrl, 'POST', '/api/invoices/quotes', {
        token: adminToken,
        headers: { 'Idempotency-Key': `PH-QUOTE-${modeName}` },
        body: {
          customerId: custId,
          warehouseId: mainWhId,
          date: '2026-11-06',
          items: [{ productId: pId, quantity: 50, unit: 'قطعة', unitFactor: 1, unitPrice: 888 }],
        },
      });
      assert.equal(quoteInv.status, 201);

      // Seed 4 confirmed sales invoices chronologically
      const salesSpec = [
        { date: '2026-11-01', quantity: 2, unit: 'قطعة', unitFactor: 1, unitPrice: 11 },
        { date: '2026-11-02', quantity: 3, unit: 'قطعة', unitFactor: 1, unitPrice: 12 },
        { date: '2026-11-03', quantity: 1, unit: 'كرتونة', unitFactor: 12, unitPrice: 150 },
        { date: '2026-11-04', quantity: 5, unit: 'قطعة', unitFactor: 1, unitPrice: 14 },
      ];
      for (let idx = 0; idx < salesSpec.length; idx++) {
        const spec = salesSpec[idx];
        const res = await req(baseUrl, 'POST', '/api/invoices/sales', {
          token: adminToken,
          headers: { 'Idempotency-Key': `PH-SALE-${modeName}-${idx}` },
          body: {
            customerId: custId,
            warehouseId: mainWhId,
            cashboxId,
            date: spec.date,
            paidAmount: spec.quantity * spec.unitPrice,
            items: [{
              productId: pId,
              quantity: spec.quantity,
              unit: spec.unit,
              unitFactor: spec.unitFactor,
              unitPrice: spec.unitPrice,
            }],
          },
        });
        assert.equal(res.status, 201);
      }

      const histRes = await req(baseUrl, 'GET', `/api/customers/${custId}/price-history`, { token: rep1Token });
      assert.equal(histRes.status, 200);
      const list = histRes.json.priceHistory?.[pId] || [];
      assert.equal(list.length, 3, 'Must return strictly last 3 confirmed sales prices');
      assert.deepEqual(
        list.map((e) => ({ price: e.price, quantity: e.quantity, unit: e.unit, unitFactor: e.unitFactor, date: e.date })),
        [
          { price: 12, quantity: 3, unit: 'قطعة', unitFactor: 1, date: '2026-11-02' },
          { price: 150, quantity: 1, unit: 'كرتونة', unitFactor: 12, date: '2026-11-03' },
          { price: 14, quantity: 5, unit: 'قطعة', unitFactor: 1, date: '2026-11-04' },
        ],
        'Must be oldest -> newest with unit conversion factor and ignore draft/quote'
      );
    });

    let repPurToken = '';
    let repPurId = '';
    let supAuditId = '';

    await test(`[${modeName}] 12. Rep with canCreatePurchase: scoped supplier statement, own purchase payment & treasury blockade`, async () => {
      const supRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: { name: 'مورد تدقيق المندوب', companyName: 'شركة التوريد', phone: '01099887766', openingBalance: 1000 },
      });
      assert.equal(supRes.status, 201);
      supAuditId = supRes.json.supplier.id;

      // Admin-owned credit purchase (balance increases by 400 -> 1400)
      const adminPurRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: adminToken,
        headers: { 'Idempotency-Key': `ADM-PUR-${modeName}` },
        body: {
          supplierId: supAuditId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          status: 'confirmed',
          items: [{ productId, quantity: 10, unit: 'زجاجة', unitPrice: 40 }],
        },
      });
      assert.equal(adminPurRes.status, 201);
      const adminPurId = adminPurRes.json.invoice.id;

      // Register dedicated purchase-capable rep
      const rpReg = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب مشتريات مدقق',
          username: `pur_rep_${modeName}`,
          phone: '01099881122',
          password: 'RepPurPassword!2026',
        },
      });
      assert.equal(rpReg.status, 201);
      const rpUser = rpReg.json.user;
      repPurId = rpReg.json.representativeProfile?.id;

      const rpUpd = await req(baseUrl, 'PUT', `/api/admin/users/${rpUser.id}`, {
        token: adminToken,
        body: {
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: true,
            canManageSales: true,
            canCreatePurchase: true,
            canViewReports: true,
          },
        },
      });
      assert.equal(rpUpd.status, 200);

      const rpLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `pur_rep_${modeName}`, password: 'RepPurPassword!2026' },
      });
      assert.equal(rpLogin.status, 200);
      repPurToken = rpLogin.json.accessToken;

      // Rep creates own purchase invoice -> sends -> admin receives/confirms as credit
      const repPurRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: repPurToken,
        headers: { 'Idempotency-Key': `REP-PUR-${modeName}` },
        body: {
          supplierId: supAuditId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 5, unit: 'زجاجة', unitPrice: 40 }],
        },
      });
      assert.equal(repPurRes.status, 201);
      const repPurInvId = repPurRes.json.invoice.id;

      const sendRes = await req(baseUrl, 'POST', `/api/invoices/purchase/${repPurInvId}/send`, {
        token: repPurToken,
        body: {},
      });
      assert.equal(sendRes.status, 200);

      const recvRes = await req(baseUrl, 'POST', `/api/invoices/purchase/${repPurInvId}/receive`, {
        token: adminToken,
        body: { confirmNow: true, warehouseId: mainWhId, cashboxId },
      });
      assert.equal(recvRes.status, 200);
      assert.equal(recvRes.json.invoice.status, 'confirmed');

      // Non-purchase rep1 remains strictly blocked on supplier statement
      const forbiddenStmt = await req(baseUrl, 'GET', `/api/admin/suppliers/${supAuditId}/statement`, {
        token: rep1Token,
      });
      assert.equal(forbiddenStmt.status, 403);

      // Permitted rep sees full company supplier balance (1000 + 400 + 200 = 1600) AND only own purchase invoice in entries/invoices
      const repStmt = await req(baseUrl, 'GET', `/api/admin/suppliers/${supAuditId}/statement`, {
        token: repPurToken,
      });
      assert.equal(repStmt.status, 200);
      assert.equal(Number(repStmt.json.summary.currentBalance), 1600, 'Supplier statement must keep accurate company-wide balance');
      assert.equal(repStmt.json.scope?.accountBalanceScope, 'company_wide');
      assert.equal(repStmt.json.invoices.some((i) => i.id === adminPurId), false, 'Must NOT expose admin purchase invoice to rep');
      assert.equal(repStmt.json.invoices.some((i) => i.id === repPurInvId), true, 'Must include rep own purchase invoice');

      // Permitted rep can pay ONLY own confirmed purchase via HTTP and /api/sync
      const payOwnRes = await req(baseUrl, 'POST', `/api/invoices/${repPurInvId}/payments`, {
        token: repPurToken,
        headers: { 'Idempotency-Key': `PAY-OWN-${modeName}` },
        body: { amount: 50, paymentMethod: 'cash', date: '2026-11-20', notes: 'سداد جزء من المندوب' },
      });
      assert.equal(payOwnRes.status, 200);
      assert.equal(Number(payOwnRes.json.invoice.paidAmount), 50);
      assert.equal(Number(payOwnRes.json.invoice.remainingAmount), 150);

      const payOwnSync = await req(baseUrl, 'POST', '/api/sync/push', {
        token: repPurToken,
        body: {
          operations: [{
            operationId: `SYNC-PAY-OWN-${modeName}`,
            operationType: 'add_invoice_payment',
            payload: { invoiceId: repPurInvId, amount: 25, paymentMethod: 'cash', date: '2026-11-20' },
          }],
        },
      });
      assert.equal(payOwnSync.status, 200);
      assert.equal(payOwnSync.json.results[0].status, 'synced');

      // Permitted rep gets 403 trying to pay admin's purchase invoice
      const payOtherRes = await req(baseUrl, 'POST', `/api/invoices/${adminPurId}/payments`, {
        token: repPurToken,
        body: { amount: 50, paymentMethod: 'cash', date: '2026-11-20' },
      });
      assert.equal(payOtherRes.status, 403);

      // Permitted rep is still strictly blocked from treasury cash ops & standalone supplier payout
      const cashOpForbidden = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: repPurToken,
        body: { type: 'expense', cashboxId, amount: 100, category: 'اختبار' },
      });
      assert.equal(cashOpForbidden.status, 403);

      const supPayForbidden = await req(baseUrl, 'POST', '/api/admin/suppliers/payment', {
        token: repPurToken,
        body: { supplierId: supAuditId, cashboxId, amount: 100 },
      });
      assert.equal(supPayForbidden.status, 403);

      const syncCashOp = await req(baseUrl, 'POST', '/api/sync/push', {
        token: repPurToken,
        body: {
          operations: [{
            operationId: `SYNC-FORB-CASH-${modeName}`,
            operationType: 'execute_cash_operation',
            payload: { type: 'cash_deposit', cashboxId, amount: 100 },
          }],
        },
      });
      assert.equal(syncCashOp.status, 200);
      assert.equal(syncCashOp.json.results[0].status, 'failed');
      assert.equal(syncCashOp.json.results[0].code, 'FORBIDDEN_REP_CASHBOX_OP');
    });

    await test(`[${modeName}] 13. Dedicated Rep Summary Report (/api/reports/rep-summary) scope & zero cost/profit/cashbox leaks`, async () => {
      const r1Report = await req(baseUrl, 'GET', '/api/reports/rep-summary', { token: rep1Token });
      assert.equal(r1Report.status, 200);
      const r1 = r1Report.json.report;
      assert.equal(r1.scope.isRepScoped, true);
      assert.equal(r1.scope.representativeId, rep1Id);
      assert.equal(r1.scope.canViewSuppliers, false);
      assert.equal((r1.suppliersSummary || []).length, 0, 'Rep without purchase privilege must not see supplier summaries');
      assert.equal(r1.summary.purchasesCount, 0);
      assert.equal(r1.summary.purchasesTotal, 0);
      assert.equal(r1Report.text.includes('purchasePriceAtTime'), false, 'rep-summary must not leak item cost fields');
      assert.equal(r1Report.text.includes('reportProfit'), false, 'rep-summary must not expose profit fields');
      assert.equal(r1Report.text.includes('حساب البنك السري'), false, 'rep-summary must not leak secret bank cashboxes');

      const rpReport = await req(baseUrl, 'GET', '/api/reports/rep-summary', { token: repPurToken });
      assert.equal(rpReport.status, 200);
      const rp = rpReport.json.report;
      assert.equal(rp.scope.isRepScoped, true);
      assert.equal(rp.scope.representativeId, repPurId);
      assert.equal(rp.scope.canViewSuppliers, true);
      assert.equal(rp.summary.purchasesCount, 1, 'Rep with canCreatePurchase must see ONLY their own confirmed purchases (not admin purchase)');
      assert.equal(rp.summary.purchasesTotal, 200);
      assert.equal(rp.summary.purchasesPaid, 75);
      assert.equal(rp.summary.purchasesRemaining, 125);
      const auditSupRow = (rp.suppliersSummary || []).find((s) => s.id === supAuditId);
      assert.ok(auditSupRow, 'Permitted rep report must include supplier summary');
      assert.equal(Number(auditSupRow.companyBalance), 1525, 'Company balance must reflect opening + admin + rep purchases - rep payments (1000+400+200-75)');
      assert.equal(Number(auditSupRow.repPurchasesTotal), 200, 'Supplier repPurchasesTotal must count only rep own purchases');
    });

    await test(`[${modeName}] 14. Customer statement rep RBAC/sanitization, same-fullName rep collision guard, & notifications with purchase return requests`, async () => {
      // Same fullName collision guard on supplier & customer statements
      const dupNameReg = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          fullName: 'مندوب المشتريات المخول',
          username: `dup_rep_pur_${modeName}`,
          password: 'Password123!',
          phone: '01099887766',
          role: 'representative',
        },
      });
      assert.equal(dupNameReg.status, 201);
      await req(baseUrl, 'PUT', `/api/admin/users/${dupNameReg.json.user.id}`, {
        token: adminToken,
        body: { permissions: { canCreatePurchase: true, canManageSales: true, canView: true, canAdd: true } },
      });
      const dupLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `dup_rep_pur_${modeName}`, password: 'Password123!' },
      });
      assert.equal(dupLogin.status, 200);
      const dupRepToken = dupLogin.json.accessToken;

      const dupPur = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: dupRepToken,
        body: {
          supplierId: supAuditId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 2, unit: 'زجاجة', unitPrice: 40 }],
        },
      });
      assert.equal(dupPur.status, 201);
      await req(baseUrl, 'POST', `/api/invoices/purchase/${dupPur.json.invoice.id}/send`, { token: dupRepToken, body: {} });
      await req(baseUrl, 'POST', `/api/invoices/purchase/${dupPur.json.invoice.id}/receive`, {
        token: adminToken,
        body: { confirmNow: true, warehouseId: mainWhId, cashboxId },
      });

      // repPurToken has identical fullName 'مندوب المشتريات المخول' — MUST NOT see dupRep's invoice!
      const supStmtAfter = await req(baseUrl, 'GET', `/api/admin/suppliers/${supAuditId}/statement`, {
        token: repPurToken,
      });
      assert.equal(supStmtAfter.status, 200);
      assert.equal(supStmtAfter.json.invoices.some((i) => i.id === dupPur.json.invoice.id), false, 'Same fullName must NOT leak another rep purchase invoice');

      // Rep purchase return request -> GET /api/mobile/notifications must return 200 (never 500 created_by_user_id)
      const repPurList = supStmtAfter.json.invoices;
      assert.ok(repPurList.length >= 1);
      const prReqRes = await req(baseUrl, 'POST', '/api/invoices/purchase-return-requests', {
        token: repPurToken,
        body: {
          originalInvoiceId: repPurList[0].id,
          reason: 'تلف جزئي عند المراجعة',
          refundType: 'credit',
          items: [{ productId, unit: 'زجاجة', unitFactor: 1, quantity: 1 }],
        },
      });
      assert.equal(prReqRes.status, 201);
      const repNotifs = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: repPurToken });
      assert.equal(repNotifs.status, 200);
      assert.ok(Array.isArray(repNotifs.json.notifications));

      // Customer statement called by rep -> company-wide balance retained, only own invoices shown, zero cost/cashbox leaked
      const adminSaleForCust = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId: custUnassignedToRep1Id,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 2, unit: 'زجاجة', unitPrice: 60 }],
        },
      });
      assert.equal(adminSaleForCust.status, 201);
      const custStmtRep = await req(baseUrl, 'GET', `/api/customers/${custUnassignedToRep1Id}/statement`, {
        token: rep1Token,
      });
      assert.equal(custStmtRep.status, 200);
      const stmt = custStmtRep.json.statement;
      assert.equal(stmt.scope?.accountBalanceScope, 'company_wide');
      assert.equal(stmt.scope?.operationsScope, 'representative_own_only');
      assert.equal(
        stmt.invoices.some((i) => i.id === adminSaleForCust.json.invoice.id),
        false,
        'Customer statement for rep must NOT expose admin/other-rep invoice details'
      );
      for (const inv of stmt.invoices) {
        assert.equal(inv.cashboxId || '', '', 'Customer statement for rep must strip cashboxId');
        assert.equal(inv.cashboxName || '-', '-', 'Customer statement for rep must strip cashboxName');
        for (const it of inv.items || []) {
          assert.equal(Number(it.purchasePriceAtTime || 0), 0, 'Customer statement for rep must zero purchasePriceAtTime');
        }
      }
      assert.ok(Number(stmt.summary.currentBalance) > 0, 'Customer statement must preserve full company-wide customer balance');
    });

    await test(`[${modeName}] 15. Paginated sales reports preserve full-dataset totals, admin reportProfit, & exact 'أصناف البيع' title`, async () => {
      const fullRes = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=sales_items&dateFrom=2026-11-20&dateTo=2026-11-20',
        { token: adminToken }
      );
      assert.equal(fullRes.status, 200);
      const fullRpt = fullRes.json.report;
      assert.equal(fullRpt.sections[0].title, 'أصناف البيع');
      const fullTotals = fullRpt.sections[0].totals;
      assert.ok(fullTotals.count >= 2, 'Expected at least 2 sales item rows for pagination parity test');

      const page1Res = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=sales_items&dateFrom=2026-11-20&dateTo=2026-11-20&page=1&pageSize=1',
        { token: adminToken }
      );
      const page2Res = await req(
        baseUrl,
        'GET',
        '/api/reports/comprehensive?reportType=sales_items&dateFrom=2026-11-20&dateTo=2026-11-20&page=2&pageSize=1',
        { token: adminToken }
      );
      assert.equal(page1Res.status, 200);
      assert.equal(page2Res.status, 200);
      const p1 = page1Res.json.report;
      const p2 = page2Res.json.report;
      assert.equal(p1.sections[0].title, 'أصناف البيع');
      assert.equal(p1.sections[0].rows.length, 1);
      assert.equal(p2.sections[0].rows.length, 1);
      assert.notEqual(p1.sections[0].rows[0].docId + p1.sections[0].rows[0].productId + p1.sections[0].rows[0].rawCreatedAt, '');
      assert.equal(Number(p1.sections[0].totals.quantity), Number(fullTotals.quantity), 'Page 1 totals.quantity must equal full dataset');
      assert.equal(Number(p2.sections[0].totals.quantity), Number(fullTotals.quantity), 'Page 2 totals.quantity must equal full dataset');
      assert.equal(Number(p1.sections[0].totals.profit), Number(fullTotals.profit), 'Page 1 totals.profit must equal full dataset');
      assert.equal(Number(p1.sections[0].totals.costValue), Number(fullTotals.costValue), 'Page 1 totals.costValue must equal full dataset');
      assert.equal(Number(p1.summary.reportProfit), Number(fullRpt.summary.reportProfit), 'Paginated admin reportProfit must equal unpaged reportProfit');
      assert.equal(Number(p1.summary.reportProfitPercent), Number(fullRpt.summary.reportProfitPercent), 'Paginated admin reportProfitPercent must equal unpaged');
    });

    await test(`[${modeName}] 16. Rep cancelInvoice enforces canDelete & returns sanitized invoice (zero purchasePriceAtTime)`, async () => {
      const repDraftRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: rep1Token,
        body: {
          customerId: custUnassignedToRep1Id,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          status: 'draft',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitPrice: 60 }],
        },
      });
      assert.equal(repDraftRes.status, 201);

      // Without canDelete permission -> 403
      const deniedCancel = await req(baseUrl, 'POST', `/api/invoices/${repDraftRes.json.invoice.id}/cancel`, {
        token: rep1Token,
        body: { reason: 'اختبار رفض الإلغاء بدون صلاحية' },
      });
      assert.equal(deniedCancel.status, 403);

      // Grant canDelete to rep1 and retry -> 200 + sanitized zero purchasePriceAtTime
      const grantDel = await req(baseUrl, 'PUT', `/api/admin/users/${rep1User.id}`, {
        token: adminToken,
        body: { permissions: { canDelete: true } },
      });
      assert.equal(grantDel.status, 200);

      const cancelRes = await req(baseUrl, 'POST', `/api/invoices/${repDraftRes.json.invoice.id}/cancel`, {
        token: rep1Token,
        body: { reason: 'اختبار إلغاء مسودة المندوب' },
      });
      assert.equal(cancelRes.status, 200);
      assert.equal(cancelRes.json.invoice.status, 'cancelled');
      for (const it of cancelRes.json.invoice.items || []) {
        assert.equal(Number(it.purchasePriceAtTime || 0), 0, 'cancelInvoice must zero purchasePriceAtTime for rep');
      }
    });

    await test(`[${modeName}] 17. Duplicate-fullName isolation, legacy unattributed diagnostics, customer/supplier statement strict rep scoping, return/quote spoofing & price-history filtering`, async () => {
      const sharedFullName = 'محمد أحمد المتشابه';
      const repAReg = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: sharedFullName,
          username: `dup_a_${modeName}`,
          phone: '01077770001',
          password: 'Password!2026',
        },
      });
      assert.equal(repAReg.status, 201);
      const repAUser = repAReg.json.user;
      const repAId = repAReg.json.representativeProfile?.id;

      const repBReg = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: sharedFullName,
          username: `dup_b_${modeName}`,
          phone: '01077770002',
          password: 'Password!2026',
        },
      });
      assert.equal(repBReg.status, 201);
      const repBUser = repBReg.json.user;
      const repBId = repBReg.json.representativeProfile?.id;

      for (const uid of [repAUser.id, repBUser.id]) {
        const permRes = await req(baseUrl, 'PUT', `/api/admin/users/${uid}`, {
          token: adminToken,
          body: {
            permissions: {
              canView: true,
              canAdd: true,
              canEdit: true,
              canDelete: true,
              canManageSales: true,
              canCreatePurchase: true,
              canViewReports: true,
            },
          },
        });
        assert.equal(permRes.status, 200);
      }

      const repALogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `dup_a_${modeName}`, password: 'Password!2026' },
      });
      const repBLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `dup_b_${modeName}`, password: 'Password!2026' },
      });
      assert.equal(repALogin.status, 200);
      assert.equal(repBLogin.status, 200);
      const repAToken = repALogin.json.accessToken;
      const repBToken = repBLogin.json.accessToken;

      // Fresh customer & fresh supplier for clean math
      const custRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: 'عميل عزل المندوبين', phone: '01066661111', openingBalance: 500 },
      });
      assert.equal(custRes.status, 201);
      const scopedCustId = custRes.json.customer.id;

      const supRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: { name: 'مورد عزل المندوبين', phone: '01066662222', openingBalance: 1000 },
      });
      assert.equal(supRes.status, 201);
      const scopedSupId = supRes.json.supplier.id;

      // 17a. Legacy unattributed sales invoices (NULL user/rep IDs, createdBy = sharedFullName)
      const legacyConfirmedId = `INV-LEG-CONF-${modeName}`;
      const legacyDraftId = `INV-LEG-DRAFT-${modeName}`;
      if (modeName === 'pg') {
        await pgPool.query(
          `INSERT INTO invoices (id, invoice_number, type, status, date, customer_id, customer_name, warehouse_id, warehouse_name, cashbox_id, subtotal, discount_total, grand_total, paid_amount, remaining_amount, payment_type, created_by)
           VALUES
             ($1, 'INV-LEG-C1', 'sales', 'confirmed', '2026-11-20', $3, 'عميل عزل المندوبين', $4, 'مخزن التدقيق', $5, 120, 0, 120, 0, 120, 'credit', $6),
             ($2, 'INV-LEG-D1', 'sales', 'draft', '2026-11-20', $3, 'عميل عزل المندوبين', $4, 'مخزن التدقيق', $5, 60, 0, 60, 0, 60, 'credit', $6)`,
          [legacyConfirmedId, legacyDraftId, scopedCustId, mainWhId, cashboxId, sharedFullName]
        );
      } else {
        await withJsonTransaction(async (db) => {
          db.invoices.push(
            {
              id: legacyConfirmedId,
              invoiceNumber: 'INV-LEG-C1',
              type: 'sales',
              status: 'confirmed',
              date: '2026-11-20',
              customerId: scopedCustId,
              customerName: 'عميل عزل المندوبين',
              warehouseId: mainWhId,
              warehouseName: 'مخزن التدقيق',
              cashboxId,
              cashboxName: 'الخزينة الرئيسية',
              items: [],
              subtotal: 120,
              discountTotal: 0,
              grandTotal: 120,
              paidAmount: 0,
              remainingAmount: 120,
              paymentType: 'credit',
              createdBy: sharedFullName,
              createdAt: '2026-11-20T08:00:00.000Z',
            },
            {
              id: legacyDraftId,
              invoiceNumber: 'INV-LEG-D1',
              type: 'sales',
              status: 'draft',
              date: '2026-11-20',
              customerId: scopedCustId,
              customerName: 'عميل عزل المندوبين',
              warehouseId: mainWhId,
              warehouseName: 'مخزن التدقيق',
              cashboxId,
              cashboxName: 'الخزينة الرئيسية',
              items: [],
              subtotal: 60,
              discountTotal: 0,
              grandTotal: 60,
              paidAmount: 0,
              remainingAmount: 60,
              paymentType: 'credit',
              createdBy: sharedFullName,
              createdAt: '2026-11-20T08:05:00.000Z',
            }
          );
        });
      }

      // Neither repA nor repB sees legacy unattributed invoices; both get 403 trying to pay/confirm/return them
      for (const tk of [repAToken, repBToken]) {
        const listRes = await req(baseUrl, 'GET', '/api/invoices', { token: tk });
        assert.equal(listRes.status, 200);
        assert.equal(listRes.json.invoices.some((i) => i.id === legacyConfirmedId || i.id === legacyDraftId), false);
        const payLeg = await req(baseUrl, 'POST', `/api/invoices/${legacyConfirmedId}/payments`, {
          token: tk,
          body: { amount: 10, paymentMethod: 'cash', date: '2026-11-20' },
        });
        assert.equal(payLeg.status, 403);
        const confLeg = await req(baseUrl, 'POST', `/api/invoices/${legacyDraftId}/confirm`, {
          token: tk,
          body: {},
        });
        assert.equal(confLeg.status, 403);
      }

      // Admin sees legacy invoices + diagnostics endpoint reports them non-destructively (rep gets 403 on diagnostics)
      const diagDenied = await req(baseUrl, 'GET', '/api/admin/diagnostics/legacy-ownership', { token: repAToken });
      assert.equal(diagDenied.status, 403);
      const diagAdmin = await req(baseUrl, 'GET', '/api/admin/diagnostics/legacy-ownership', { token: adminToken });
      assert.equal(diagAdmin.status, 200);
      assert.equal(diagAdmin.json.diagnostics.nonDestructive, true);
      const diagEntry = (diagAdmin.json.diagnostics.unattributedInvoices || []).find((x) => x.id === legacyConfirmedId);
      assert.ok(diagEntry, 'Diagnostics must detect unattributed legacy invoice');
      assert.equal(diagEntry.ambiguousNameMatch, true);
      assert.ok(
        (diagAdmin.json.diagnostics.duplicateFullNameGroups || []).some((g) => g.fullName === sharedFullName && g.usersCount >= 2)
      );

      // 17b. Customer statement strict rep scoping + admin-recorded payment & return on repA's own invoice
      const repASale = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: repAToken,
        body: {
          customerId: scopedCustId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 2, unit: 'زجاجة', unitPrice: 50 }], // total = 100
        },
      });
      assert.equal(repASale.status, 201);
      const repASaleId = repASale.json.invoice.id;

      // Admin collects 40 on repA's invoice + creates 20 balance return on repA's invoice
      const adminPayOnRepA = await req(baseUrl, 'POST', `/api/invoices/${repASaleId}/payments`, {
        token: adminToken,
        body: { amount: 40, paymentMethod: 'cash', cashboxId, date: '2026-11-20', notes: 'تحصيل من الإدارة' },
      });
      assert.equal(adminPayOnRepA.status, 200);

      const adminRetOnRepA = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: adminToken,
        body: {
          type: 'sales_return',
          originalInvoiceId: repASaleId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          refundType: 'balance',
          reason: 'مرتجع معتمد على فاتورة المندوب أ',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 20 }],
        },
      });
      assert.equal(adminRetOnRepA.status, 201);

      // repB (same fullName) & admin create competing operations on the same customer
      const repBSale = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: repBToken,
        body: {
          customerId: scopedCustId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 5, unit: 'زجاجة', unitPrice: 60 }], // total = 300
        },
      });
      assert.equal(repBSale.status, 201);

      const admSale = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId: scopedCustId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 4, unit: 'زجاجة', unitPrice: 50 }], // total = 200
        },
      });
      assert.equal(admSale.status, 201);

      const admStandalonePay = await req(baseUrl, 'POST', `/api/customers/${scopedCustId}/payment`, {
        token: adminToken,
        body: { amount: 50, cashboxId, paymentMethod: 'cash', date: '2026-11-20', notes: 'دفعة إدارية عامة' },
      });
      assert.equal(admStandalonePay.status, 200);

      const repACustStmtRes = await req(baseUrl, 'GET', `/api/customers/${scopedCustId}/statement`, {
        token: repAToken,
      });
      assert.equal(repACustStmtRes.status, 200);
      const rcStmt = repACustStmtRes.json.statement;
      // Company balance = 500 (open) + 100 - 40 - 20 + 300 + 200 - 50 = 990
      assert.equal(Number(rcStmt.summary.currentBalance), 990, 'Company-wide customer balance must stay intact');
      assert.equal(rcStmt.summary.openingBalance, 0, 'Rep customer statement summary.openingBalance must be 0');
      assert.equal(rcStmt.summary.invoicesCount, 1, 'Rep customer statement must count ONLY own invoices');
      assert.equal(rcStmt.summary.returnsCount, 1, 'Rep customer statement must count ONLY returns tied to own invoices');
      assert.equal(Number(rcStmt.summary.totalSales), 100);
      assert.equal(Number(rcStmt.summary.totalDebit), 100);
      assert.equal(Number(rcStmt.summary.totalPaid), 40, 'Must reflect admin payment on repA invoice without admin standalone payout');
      assert.equal(Number(rcStmt.summary.totalCredit), 60, 'Must equal 40 payment + 20 balance return without double counting');
      assert.equal(rcStmt.invoices.length, 1);
      assert.equal(rcStmt.invoices[0].id, repASaleId);
      assert.equal(rcStmt.returns.length, 1);
      assert.equal(rcStmt.entries.some((e) => e.type === 'opening_balance'), false);
      assert.equal(rcStmt.entries.some((e) => e.docId === repBSale.json.invoice.id || e.docId === admSale.json.invoice.id), false);
      const repAEntry = rcStmt.entries.find((e) => e.docId === repASaleId);
      assert.ok(repAEntry && String(repAEntry.description || '').includes('تحصيل لاحق'));
      const repARetEntry = rcStmt.entries.find((e) => e.docType === 'sales_return');
      assert.ok(repARetEntry && repARetEntry.createdBy === 'مدير التدقيق الشامل');

      // 17c. Supplier statement strict rep scoping + cashbox sanitization + return party spoofing prevention
      const repAPurCreate = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: repAToken,
        body: {
          supplierId: scopedSupId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 3, unit: 'زجاجة', unitPrice: 50 }], // 150
        },
      });
      assert.equal(repAPurCreate.status, 201);
      const repAPurId = repAPurCreate.json.invoice.id;
      await req(baseUrl, 'POST', `/api/invoices/purchase/${repAPurId}/send`, { token: repAToken, body: {} });
      await req(baseUrl, 'POST', `/api/invoices/purchase/${repAPurId}/receive`, {
        token: adminToken,
        body: { confirmNow: true, warehouseId: mainWhId, cashboxId },
      });
      await req(baseUrl, 'POST', `/api/invoices/${repAPurId}/payments`, {
        token: adminToken,
        body: { amount: 50, paymentMethod: 'cash', cashboxId, date: '2026-11-20', notes: 'سداد إداري لمشتريات أ' },
      });

      // Return on repA's purchase attempting spoofed partyId/partyName must resolve back to scopedSupId
      const spoofedRetRes = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: adminToken,
        body: {
          type: 'purchase_return',
          originalInvoiceId: repAPurId,
          partyId: 'SUP-SPOOFED-999',
          partyName: 'مورد مزيف',
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          refundType: 'balance',
          reason: 'اختبار منع تزوير الطرف',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 30 }],
        },
      });
      assert.equal(spoofedRetRes.status, 201);
      assert.equal(spoofedRetRes.json.invoiceReturn.partyId, scopedSupId, 'Return must ignore spoofed partyId');
      assert.equal(spoofedRetRes.json.invoiceReturn.partyName, 'مورد عزل المندوبين', 'Return must ignore spoofed partyName');

      // Competing repB purchase (400) & admin purchase (200) + admin standalone supplier payout (100)
      const repBPur = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: repBToken,
        body: {
          supplierId: scopedSupId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 8, unit: 'زجاجة', unitPrice: 50 }],
        },
      });
      assert.equal(repBPur.status, 201);
      await req(baseUrl, 'POST', `/api/invoices/purchase/${repBPur.json.invoice.id}/send`, { token: repBToken, body: {} });
      await req(baseUrl, 'POST', `/api/invoices/purchase/${repBPur.json.invoice.id}/receive`, {
        token: adminToken,
        body: { confirmNow: true, warehouseId: mainWhId, cashboxId },
      });

      const admPur = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: adminToken,
        body: {
          supplierId: scopedSupId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          status: 'confirmed',
          items: [{ productId, quantity: 4, unit: 'زجاجة', unitPrice: 50 }],
        },
      });
      assert.equal(admPur.status, 201);
      await req(baseUrl, 'POST', '/api/admin/suppliers/payment', {
        token: adminToken,
        body: { supplierId: scopedSupId, cashboxId, amount: 100, date: '2026-11-20' },
      });

      const repASupStmt = await req(baseUrl, 'GET', `/api/admin/suppliers/${scopedSupId}/statement`, {
        token: repAToken,
      });
      assert.equal(repASupStmt.status, 200);
      // Company supplier balance: 1000 + 150 - 50 - 30 + 400 + 200 - 100 = 1570
      assert.equal(Number(repASupStmt.json.summary.currentBalance), 1570);
      assert.equal(repASupStmt.json.invoices.length, 1);
      assert.equal(repASupStmt.json.invoices[0].id, repAPurId);
      assert.equal(repASupStmt.json.invoices[0].cashboxId || '', '');
      assert.equal(repASupStmt.json.invoices[0].cashboxName || '-', '-');
      for (const p of repASupStmt.json.invoices[0].payments || []) {
        assert.equal(p.cashboxId || '', '', 'Supplier statement for rep must strip payment cashboxId');
        assert.equal(p.cashboxName || '-', '-', 'Supplier statement for rep must strip payment cashboxName');
      }
      assert.equal(repASupStmt.json.returns.length, 1);
      assert.equal(repASupStmt.json.returns[0].cashboxId, undefined);
      assert.equal(Number(repASupStmt.json.summary.totalPurchases), 150);
      assert.equal(Number(repASupStmt.json.summary.totalPaid), 50);
      assert.equal(Number(repASupStmt.json.summary.totalDebit), 80);

      // 17d. Quote conversion cross-rep block & representativeId/cashbox spoofing rejection
      const repAQuote = await req(baseUrl, 'POST', '/api/invoices/quotes', {
        token: repAToken,
        body: {
          customerId: scopedCustId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-20',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitPrice: 60 }],
        },
      });
      assert.equal(repAQuote.status, 201);
      const quoteId = repAQuote.json.invoice.id;

      const repBConvertQuote = await req(baseUrl, 'POST', `/api/invoices/quotes/${quoteId}/convert`, {
        token: repBToken,
        body: {},
      });
      assert.equal(repBConvertQuote.status, 403, 'Same-fullName repB must get 403 converting repA quote');

      const spoofConvertQuote = await req(baseUrl, 'POST', `/api/invoices/quotes/${quoteId}/convert`, {
        token: repAToken,
        body: { representativeId: repBId, representativeName: 'مندوب مزور', cashboxId: cashbox2Id },
      });
      assert.equal(spoofConvertQuote.status, 201);
      assert.equal(spoofConvertQuote.json.invoice.representativeId, repAId, 'Quote conversion must force actor repId');
      assert.notEqual(spoofConvertQuote.json.invoice.cashboxId, cashbox2Id, 'Quote conversion for rep must ignore spoofed cashboxId');

      const syncSpoofPush = await req(baseUrl, 'POST', '/api/sync/push', {
        token: repAToken,
        body: {
          operations: [{
            operationId: `SYNC-SPOOF-REP-${modeName}`,
            operationType: 'create_sales_invoice',
            payload: {
              customerId: scopedCustId,
              warehouseId: mainWhId,
              cashboxId: cashbox2Id,
              date: '2026-11-20',
              representativeId: repBId,
              representativeName: 'تزوير عبر المزامنة',
              paidAmount: 0,
              paymentType: 'credit',
              items: [{ productId, quantity: 1, unit: 'زجاجة', unitPrice: 62 }],
            },
          }],
        },
      });
      assert.equal(syncSpoofPush.status, 200);
      assert.equal(syncSpoofPush.json.results[0].status, 'synced');
      const syncedInvId = syncSpoofPush.json.results[0].result?.id || syncSpoofPush.json.results[0].result?.invoice?.id;
      assert.ok(syncedInvId, 'Expected created invoice ID from sync push result');
      const syncedInvListRes = await req(baseUrl, 'GET', '/api/invoices', { token: adminToken });
      assert.equal(syncedInvListRes.status, 200);
      const syncedInv = (syncedInvListRes.json.invoices || []).find((x) => x.id === syncedInvId);
      assert.ok(syncedInv, 'Synced invoice must exist in admin invoice list');
      assert.equal(syncedInv.representativeId, repAId, 'Sync push must override spoofed representativeId');

      // 17e. Cancelled invoice excluded from last 3 prices & productId filter respected
      const prod2Res = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: 'صنف سجل أسعار ثانوي',
          code: `PH-SEC-${modeName}`,
          baseUnit: 'قطعة',
          purchasePrice: 20,
          sellingPrice: 35,
          stockPerWarehouse: { [mainWhId]: 50 },
        },
      });
      assert.equal(prod2Res.status, 201);
      const secProdId = prod2Res.json.product.id;

      for (const [d, p] of [['2026-11-10', 31], ['2026-11-11', 33], ['2026-11-12', 36]]) {
        const sr = await req(baseUrl, 'POST', '/api/invoices/sales', {
          token: adminToken,
          body: {
            customerId: scopedCustId,
            warehouseId: mainWhId,
            cashboxId,
            date: d,
            paidAmount: 0,
            paymentType: 'credit',
            items: [{ productId: secProdId, quantity: 1, unit: 'قطعة', unitFactor: 1, unitPrice: p }],
          },
        });
        assert.equal(sr.status, 201);
      }
      const cancelledSale = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId: scopedCustId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-15',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId: secProdId, quantity: 1, unit: 'قطعة', unitFactor: 1, unitPrice: 999 }],
        },
      });
      assert.equal(cancelledSale.status, 201);
      const cancelSaleDone = await req(baseUrl, 'POST', `/api/invoices/${cancelledSale.json.invoice.id}/cancel`, {
        token: adminToken,
        body: { reason: 'ملغاة لا تظهر في آخر 3 أسعار' },
      });
      assert.equal(cancelSaleDone.status, 200);

      const filtHistRes = await req(
        baseUrl,
        'GET',
        `/api/customers/${scopedCustId}/price-history?productId=${encodeURIComponent(secProdId)}`,
        { token: repAToken }
      );
      assert.equal(filtHistRes.status, 200);
      assert.deepEqual(Object.keys(filtHistRes.json.priceHistory), [secProdId]);
      assert.deepEqual(
        filtHistRes.json.priceHistory[secProdId].map((x) => x.price),
        [31, 33, 36],
        'Cancelled invoice price (999) must be excluded from last 3 prices'
      );
    });

    let s18Ctx = {};
    await test(`[${modeName}] 18. Return cashbox/party hardening, sales return request approval workflow, sync hard-deny, quote override block & rep aggregate totals scoping`, async () => {
      // Create a self-contained representative, customer, supplier, non-treasury staff, and treasury staff
      const rep18Reg = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب اختبار المرتجعات',
          username: `rep18_${modeName}`,
          phone: '01077778801',
          password: 'RepPassword!2026',
        },
      });
      assert.equal(rep18Reg.status, 201);
      const rep18User = rep18Reg.json.user;
      const rep18Id = rep18Reg.json.representativeProfile?.id;
      assert.ok(rep18Id);

      const rep18Perms = await req(baseUrl, 'PUT', `/api/admin/users/${rep18User.id}`, {
        token: adminToken,
        body: {
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: true,
            canManageSales: true,
            canCreatePurchase: true,
            canViewReports: true,
          },
        },
      });
      assert.equal(rep18Perms.status, 200);

      const rep18Login = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `rep18_${modeName}`, password: 'RepPassword!2026' },
      });
      assert.equal(rep18Login.status, 200);
      const rep18Token = rep18Login.json.accessToken;

      const cust18Res = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: 'عميل اختبار 18', phone: '01077778802', openingBalance: 200 },
      });
      assert.equal(cust18Res.status, 201);
      const cust18Id = cust18Res.json.customer.id;

      const sup18Res = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: { name: 'مورد اختبار 18', phone: '01077778803', openingBalance: 300 },
      });
      assert.equal(sup18Res.status, 201);
      const sup18Id = sup18Res.json.supplier.id;

      const pur18Res = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: rep18Token,
        body: {
          supplierId: sup18Id,
          warehouseId: mainWhId,
          date: '2026-11-21',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 3, unit: 'زجاجة', unitPrice: 50 }],
        },
      });
      assert.equal(pur18Res.status, 201);
      const pur18Id = pur18Res.json.invoice.id;
      await req(baseUrl, 'POST', `/api/invoices/purchase/${pur18Id}/send`, { token: rep18Token, body: {} });
      await req(baseUrl, 'POST', `/api/invoices/purchase/${pur18Id}/receive`, {
        token: adminToken,
        body: { confirmNow: true, warehouseId: mainWhId, cashboxId },
      });

      const nonTreasuryStaff = await createAdminUser(
        {
          fullName: 'موظف مبيعات بدون خزينة',
          username: `sales_only_${modeName}`,
          password: 'StaffPassword!2026',
          role: 'sales',
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: true,
            canManageSales: true,
            canManageCashboxes: false,
            canManageAccounts: false,
            canApprove: false,
          },
        },
        adminUser
      );
      assert.ok(nonTreasuryStaff?.id);

      const treasuryStaff = await createAdminUser(
        {
          fullName: 'مسؤول خزينة ومبيعات',
          username: `treasury_staff_${modeName}`,
          password: 'StaffPassword!2026',
          role: 'accountant',
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: true,
            canManageSales: true,
            canManageCashboxes: true,
            canManageAccounts: true,
            canApprove: true,
          },
        },
        adminUser
      );
      assert.ok(treasuryStaff?.id);

      const nonTreasuryLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `sales_only_${modeName}`, password: 'StaffPassword!2026' },
      });
      const treasuryLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `treasury_staff_${modeName}`, password: 'StaffPassword!2026' },
      });
      assert.equal(nonTreasuryLogin.status, 200);
      assert.equal(treasuryLogin.status, 200);
      const nonTreasuryToken = nonTreasuryLogin.json.accessToken;
      const treasuryToken = treasuryLogin.json.accessToken;

      const getCashboxes = async () => {
        const bootRes = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
        assert.equal(bootRes.status, 200);
        return bootRes.json.data.cashboxes || [];
      };
      const getCbBal = (cbList, id) => Number((cbList || []).find((c) => c.id === id)?.currentBalance || 0);
      const cbBefore = await getCashboxes();
      const cb1Start = getCbBal(cbBefore, cashboxId);
      const cb2Start = getCbBal(cbBefore, cashbox2Id);

      // Rep18 creates a fresh confirmed sales invoice (5 * 60 = 300)
      const rep18Sale = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: rep18Token,
        body: {
          customerId: cust18Id,
          warehouseId: mainWhId,
          date: '2026-11-21',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 5, unit: 'زجاجة', unitPrice: 60 }],
        },
      });
      assert.equal(rep18Sale.status, 201);
      const rep18SaleId = rep18Sale.json.invoice.id;

      // 18a. Direct returns & sync push reject rep cashboxId and rep direct cash return, and non-treasury staff cashboxId
      const repDirCb = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: rep18Token,
        body: {
          type: 'sales_return',
          originalInvoiceId: rep18SaleId,
          warehouseId: mainWhId,
          cashboxId: cashbox2Id,
          date: '2026-11-21',
          refundType: 'balance',
          reason: 'محاولة تمرير خزينة من المندوب',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }],
        },
      });
      assert.equal(repDirCb.status, 403);
      assert.equal(repDirCb.json.code, 'FORBIDDEN_REP_CASHBOX_SELECTION');

      const repDirCash = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: rep18Token,
        body: {
          type: 'sales_return',
          originalInvoiceId: rep18SaleId,
          warehouseId: mainWhId,
          date: '2026-11-21',
          refundType: 'cash',
          reason: 'محاولة مرتجع نقدي مباشر من المندوب',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }],
        },
      });
      assert.equal(repDirCash.status, 403);
      assert.equal(repDirCash.json.code, 'FORBIDDEN_REP_CASH_RETURN');

      const syncRepRetCb = await req(baseUrl, 'POST', '/api/sync/push', {
        token: rep18Token,
        body: {
          operations: [
            {
              operationId: `SYNC-RET-CB-${modeName}`,
              operationType: 'create_invoice_return',
              payload: {
                type: 'sales_return',
                originalInvoiceId: rep18SaleId,
                warehouseId: mainWhId,
                cashboxId: cashbox2Id,
                date: '2026-11-21',
                refundType: 'balance',
                reason: 'مزامنة بخزينة مرفوضة',
                items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }],
              },
            },
            {
              operationId: `SYNC-RET-CASH-${modeName}`,
              operationType: 'create_invoice_return',
              payload: {
                type: 'sales_return',
                originalInvoiceId: rep18SaleId,
                warehouseId: mainWhId,
                date: '2026-11-21',
                refundType: 'cash',
                reason: 'مزامنة مرتجع نقدي مرفوض',
                items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }],
              },
            },
          ],
        },
      });
      assert.equal(syncRepRetCb.status, 200);
      assert.equal(syncRepRetCb.json.results[0].status, 'failed');
      assert.equal(syncRepRetCb.json.results[0].code, 'FORBIDDEN_REP_CASHBOX_SELECTION');
      assert.equal(syncRepRetCb.json.results[1].status, 'failed');
      assert.equal(syncRepRetCb.json.results[1].code, 'FORBIDDEN_REP_CASH_RETURN');

      const staffNoTreasuryCb = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: nonTreasuryToken,
        body: {
          type: 'sales_return',
          originalInvoiceId: rep18SaleId,
          warehouseId: mainWhId,
          cashboxId: cashbox2Id,
          date: '2026-11-21',
          refundType: 'cash',
          reason: 'موظف بدون صلاحية خزينة',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }],
        },
      });
      assert.equal(staffNoTreasuryCb.status, 403);
      assert.equal(staffNoTreasuryCb.json.code, 'FORBIDDEN_TREASURY_PERMISSION');

      // 18b. Sales Return Requests & Purchase Return Requests cashbox blocking + full approval workflow
      const repSrrWithCb = await req(baseUrl, 'POST', '/api/invoices/sales-return-requests', {
        token: rep18Token,
        body: {
          originalInvoiceId: rep18SaleId,
          cashboxId: cashbox2Id,
          refundType: 'cash',
          reason: 'طلب مع خزينة مرفوض',
          items: [{ productId, quantity: 2, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }],
        },
      });
      assert.equal(repSrrWithCb.status, 403);
      assert.equal(repSrrWithCb.json.code, 'FORBIDDEN_REP_CASHBOX_SELECTION');

      const repPrrWithCb = await req(baseUrl, 'POST', '/api/invoices/purchase-return-requests', {
        token: rep18Token,
        body: {
          originalInvoiceId: pur18Id,
          cashboxId: cashbox2Id,
          refundType: 'cash',
          reason: 'طلب مشتريات مع خزينة مرفوض',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 50 }],
        },
      });
      assert.equal(repPrrWithCb.status, 403);
      assert.equal(repPrrWithCb.json.code, 'FORBIDDEN_REP_CASHBOX_SELECTION');

      // Rep creates valid cash sales return request with spoofed party fields -> party resolved from orig invoice, pending leaves cashbox untouched
      const repSrrValid = await req(baseUrl, 'POST', '/api/invoices/sales-return-requests', {
        token: rep18Token,
        body: {
          originalInvoiceId: rep18SaleId,
          partyId: 'CUST-SPOOF-777',
          partyName: 'عميل مزور',
          refundType: 'cash',
          date: '2026-11-21',
          reason: 'طلب مرتجع مبيعات نقدي للمراجعة',
          items: [{ productId, quantity: 2, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }], // 120
        },
      });
      assert.equal(repSrrValid.status, 201);
      const srr1 = repSrrValid.json.request;
      assert.equal(srr1.status, 'pending');
      assert.equal(srr1.customerId, cust18Id, 'Sales return request must use authoritative original customerId');
      assert.equal(srr1.customerName, 'عميل اختبار 18');
      assert.equal(srr1.representativeId, rep18Id);

      // Sync push create_sales_return_request deduplication (idempotency)
      const srrSyncOp = {
        operationId: `SYNC-SRR-IDEM-${modeName}`,
        operationType: 'create_sales_return_request',
        payload: {
          originalInvoiceId: rep18SaleId,
          refundType: 'cash',
          date: '2026-11-21',
          reason: 'طلب عبر المزامنة لاختبار منع التكرار',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }],
        },
      };
      const syncSrr1 = await req(baseUrl, 'POST', '/api/sync/push', { token: rep18Token, body: { operations: [srrSyncOp] } });
      const syncSrr2 = await req(baseUrl, 'POST', '/api/sync/push', { token: rep18Token, body: { operations: [srrSyncOp] } });
      assert.equal(syncSrr1.status, 200);
      assert.equal(syncSrr2.status, 200);
      assert.equal(syncSrr1.json.results[0].status, 'synced');
      assert.equal(syncSrr2.json.results[0].status, 'synced');
      assert.equal(syncSrr2.json.results[0].deduplicated, true);
      const srr2Id = syncSrr1.json.results[0].result.id;

      // Verify cashbox untouched while requests are pending
      const cbPending = await getCashboxes();
      assert.equal(getCbBal(cbPending, cashboxId), cb1Start);
      assert.equal(getCbBal(cbPending, cashbox2Id), cb2Start);

      // Rep cannot approve or reject own/other sales return request
      const repApproveSrr = await req(baseUrl, 'POST', `/api/invoices/sales-return-requests/${srr1.id}/approve`, {
        token: rep18Token,
        body: { cashboxId },
      });
      assert.equal(repApproveSrr.status, 403);
      assert.equal(repApproveSrr.json.code, 'FORBIDDEN_APPROVE_RETURN_REQUEST');

      const repRejectSrr = await req(baseUrl, 'POST', `/api/invoices/sales-return-requests/${srr1.id}/reject`, {
        token: rep18Token,
        body: { reason: 'محاولة رفض' },
      });
      assert.equal(repRejectSrr.status, 403);
      assert.equal(repRejectSrr.json.code, 'FORBIDDEN_REJECT_RETURN_REQUEST');

      // Non-treasury staff cannot approve a cash sales return request
      const nonTreasApproveSrr = await req(baseUrl, 'POST', `/api/invoices/sales-return-requests/${srr1.id}/approve`, {
        token: nonTreasuryToken,
        body: { cashboxId: cashbox2Id },
      });
      assert.equal(nonTreasApproveSrr.status, 403);
      assert.equal(nonTreasApproveSrr.json.code, 'FORBIDDEN_TREASURY_PERMISSION');

      // Treasury staff approves srr1 selecting cashbox2Id -> cashbox2Id deducted once by 120
      const treasApprove1 = await req(baseUrl, 'POST', `/api/invoices/sales-return-requests/${srr1.id}/approve`, {
        token: treasuryToken,
        headers: { 'idempotency-key': `APR-SRR1-${modeName}` },
        body: { cashboxId: cashbox2Id, approvalNotes: 'اعتماد صرف نقدي من البنك' },
      });
      assert.equal(treasApprove1.status, 200);
      assert.equal(treasApprove1.json.request.status, 'approved');
      assert.equal(treasApprove1.json.request.requestedByUserId, rep18User.id);
      assert.equal(treasApprove1.json.request.reviewedByUserId, treasuryStaff.id);
      assert.equal(treasApprove1.json.invoiceReturn.requestedByUserId, rep18User.id);
      assert.equal(treasApprove1.json.invoiceReturn.approvedByUserId, treasuryStaff.id);
      assert.equal(treasApprove1.json.invoiceReturn.cashboxId, cashbox2Id);
      assert.equal(treasApprove1.json.invoiceReturn.partyId, cust18Id);

      // Same idempotency key deduplicates safely; new key returns 409 REQUEST_ALREADY_PROCESSED
      const treasApproveIdem = await req(baseUrl, 'POST', `/api/invoices/sales-return-requests/${srr1.id}/approve`, {
        token: treasuryToken,
        headers: { 'idempotency-key': `APR-SRR1-${modeName}` },
        body: { cashboxId: cashbox2Id },
      });
      assert.equal(treasApproveIdem.status, 200);

      const treasApproveDup = await req(baseUrl, 'POST', `/api/invoices/sales-return-requests/${srr1.id}/approve`, {
        token: treasuryToken,
        headers: { 'idempotency-key': `APR-SRR1-DUP-${modeName}` },
        body: { cashboxId: cashbox2Id },
      });
      assert.equal(treasApproveDup.status, 409);
      assert.equal(treasApproveDup.json.code, 'REQUEST_ALREADY_PROCESSED');

      // Reject second request srr2Id -> cashbox unchanged
      const treasReject2 = await req(baseUrl, 'POST', `/api/invoices/sales-return-requests/${srr2Id}/reject`, {
        token: treasuryToken,
        body: { reason: 'مرفوض لعدم مطابقة الصنف' },
      });
      assert.equal(treasReject2.status, 200);
      assert.equal(treasReject2.json.request.status, 'rejected');

      const cbAfter = await getCashboxes();
      assert.equal(getCbBal(cbAfter, cashboxId), cb1Start);
      assert.equal(getCbBal(cbAfter, cashbox2Id), cb2Start - 120, 'Approved cash sales return must deduct cashbox2Id exactly once by 120');

      // Rep listing sales return requests redacts cashbox metadata
      const repListSrr = await req(baseUrl, 'GET', '/api/invoices/sales-return-requests', { token: rep18Token });
      assert.equal(repListSrr.status, 200);
      const repSeenSrr1 = (repListSrr.json.requests || []).find((r) => r.id === srr1.id);
      assert.ok(repSeenSrr1);
      assert.equal(repSeenSrr1.cashboxId, undefined, 'Representative must not see approved cashboxId on sales return requests');

      // 18c. Direct return party override blocking & incomplete original invoice check
      const staffPartyOverride = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: treasuryToken,
        body: {
          type: 'sales_return',
          originalInvoiceId: rep18SaleId,
          partyId: 'OTHER-PARTY-SPOOF',
          warehouseId: mainWhId,
          date: '2026-11-21',
          refundType: 'balance',
          reason: 'محاولة تغيير طرف من غير الأدمن',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }],
        },
      });
      assert.equal(staffPartyOverride.status, 403);
      assert.equal(staffPartyOverride.json.code, 'FORBIDDEN_PARTY_OVERRIDE');

      const adminSpoofParty = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: adminToken,
        body: {
          type: 'sales_return',
          originalInvoiceId: rep18SaleId,
          partyId: 'ADMIN-SPOOF-PARTY',
          partyName: 'طرف مزور',
          warehouseId: mainWhId,
          date: '2026-11-21',
          refundType: 'balance',
          reason: 'مرتجع على الرصيد مع اختبار فرض الطرف الأصلي',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 60 }],
        },
      });
      assert.equal(adminSpoofParty.status, 201);
      assert.equal(adminSpoofParty.json.invoiceReturn.partyId, cust18Id);
      assert.equal(adminSpoofParty.json.invoiceReturn.partyName, 'عميل اختبار 18');

      // Incomplete original invoice must fail with 400 INVALID_ORIGINAL_INVOICE_DATA
      const incompleteInvId = `INV-INCOMPLETE-${modeName}`;
      if (modeName === 'pg') {
        await pgPool.query(
          `INSERT INTO invoices (id, invoice_number, type, status, date, customer_id, customer_name, warehouse_id, warehouse_name, cashbox_id, subtotal, discount_total, grand_total, paid_amount, remaining_amount, payment_type, created_by)
           VALUES ($1, 'INV-INC-1', 'sales', 'confirmed', '2026-11-21', $2, 'عميل اختبار 18', $3, 'مخزن التدقيق', $4, 50, 0, 50, 0, 50, 'credit', 'مدير التدقيق الشامل')`,
          [incompleteInvId, cust18Id, mainWhId, cashboxId]
        );
      } else {
        await withJsonTransaction((db) => {
          db.invoices.push({
            id: incompleteInvId,
            invoiceNumber: 'INV-INC-1',
            type: 'sales',
            status: 'confirmed',
            date: '2026-11-21',
            customerId: cust18Id,
            customerName: 'عميل اختبار 18',
            warehouseId: '',
            warehouseName: '',
            items: [],
            subtotal: 50,
            discountTotal: 0,
            grandTotal: 50,
            paidAmount: 0,
            remainingAmount: 50,
            paymentType: 'credit',
            createdAt: '2026-11-21T08:00:00.000Z',
          });
        });
      }
      const incRet = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: adminToken,
        body: {
          type: 'sales_return',
          originalInvoiceId: incompleteInvId,
          warehouseId: mainWhId,
          date: '2026-11-21',
          refundType: 'balance',
          reason: 'اختبار فاتورة غير مكتملة',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 50 }],
        },
      });
      assert.equal(incRet.status, 400);
      assert.equal(incRet.json.code, 'INVALID_ORIGINAL_INVOICE_DATA');

      // 18d. Role-level Hard Deny in /api/sync/push even if representative has elevated permission flags
      await updateAdminUser(
        rep18User.id,
        {
          permissions: {
            ...rep18User.permissions,
            canView: true,
            canAdd: true,
            canEdit: true,
            canManageSales: true,
            canCreatePurchase: true,
            canManagePurchases: true,
            canManageCashboxes: true,
            canManageAccounts: true,
            canViewReports: true,
          },
        },
        adminUser
      );
      const rep18ReLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: `rep18_${modeName}`, password: 'RepPassword!2026' },
      });
      assert.equal(rep18ReLogin.status, 200);
      const rep18ElevatedToken = rep18ReLogin.json.accessToken;

      const syncHardDenyRes = await req(baseUrl, 'POST', '/api/sync/push', {
        token: rep18ElevatedToken,
        body: {
          operations: [
            {
              operationId: `SYNC-HARDDENY-CASH-${modeName}`,
              operationType: 'execute_cash_operation',
              payload: { type: 'expense', amount: 10, cashboxId, date: '2026-11-21', category: 'تجربة' },
            },
            {
              operationId: `SYNC-HARDDENY-PRET-${modeName}`,
              operationType: 'create_purchase_return',
              payload: {
                originalInvoiceId: pur18Id,
                warehouseId: mainWhId,
                date: '2026-11-21',
                refundType: 'balance',
                items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 50 }],
              },
            },
          ],
        },
      });
      assert.equal(syncHardDenyRes.status, 200);
      assert.equal(syncHardDenyRes.json.results[0].status, 'failed');
      assert.equal(syncHardDenyRes.json.results[0].code, 'FORBIDDEN_REP_CASHBOX_OP');
      assert.equal(syncHardDenyRes.json.results[1].status, 'failed');
      assert.equal(syncHardDenyRes.json.results[1].code, 'FORBIDDEN_REP_DIRECT_PURCHASE_RETURN');

      // 18e. convertQuoteToInvoice empty customerName bypass block + duplicate conversion + rep-summary aggregate totals scoping
      const emptyCustQuoteId = `QUO-EMPTY-CUST-${modeName}`;
      if (modeName === 'pg') {
        await pgPool.query(
          `INSERT INTO invoices (id, invoice_number, type, status, date, customer_id, customer_name, representative_id, representative_name, warehouse_id, warehouse_name, cashbox_id, subtotal, discount_total, grand_total, paid_amount, remaining_amount, payment_type, created_by, created_by_user_id)
           VALUES ($1, 'QUO-EMP-1', 'quote', 'draft', '2026-11-21', NULL, '', $2, 'مندوب اختبار المرتجعات', $3, 'مخزن التدقيق', $4, 60, 0, 60, 0, 60, 'credit', 'مندوب اختبار المرتجعات', $5)`,
          [emptyCustQuoteId, rep18Id, mainWhId, cashboxId, rep18User.id]
        );
        await pgPool.query(
          `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, unit, unit_factor, quantity, unit_price, purchase_price_at_time, total)
           VALUES ($1, $2, $3, 'زيت ذرة ممتاز', 'زجاجة', 1, 1, 60, 40, 60)`,
          [`QI-${modeName}`, emptyCustQuoteId, productId]
        );
      } else {
        await withJsonTransaction((db) => {
          db.invoices.push({
            id: emptyCustQuoteId,
            invoiceNumber: 'QUO-EMP-1',
            type: 'quote',
            status: 'draft',
            date: '2026-11-21',
            customerId: undefined,
            customerName: '',
            representativeId: rep18Id,
            representativeName: 'مندوب اختبار المرتجعات',
            warehouseId: mainWhId,
            warehouseName: 'مخزن التدقيق',
            items: [{ productId, productName: 'زيت ذرة ممتاز', unit: 'زجاجة', unitFactor: 1, quantity: 1, unitPrice: 60, purchasePriceAtTime: 40, total: 60 }],
            subtotal: 60,
            discountTotal: 0,
            grandTotal: 60,
            paidAmount: 0,
            remainingAmount: 60,
            paymentType: 'credit',
            createdBy: 'مندوب اختبار المرتجعات',
            createdByUserId: rep18User.id,
            createdAt: '2026-11-21T08:10:00.000Z',
          });
        });
      }

      const emptyQuoteOverride = await req(baseUrl, 'POST', `/api/invoices/quotes/${emptyCustQuoteId}/convert`, {
        token: rep18ElevatedToken,
        body: { customerName: 'عميل بديل غير مصرح', paymentType: 'credit', paidAmount: 0 },
      });
      assert.equal(emptyQuoteOverride.status, 403);
      assert.equal(emptyQuoteOverride.json.code, 'FORBIDDEN_QUOTE_CUSTOMER_OVERRIDE');

      // Quote create -> convert once -> 409 QUOTE_ALREADY_CONVERTED on duplicate convert
      const normalQuote = await req(baseUrl, 'POST', '/api/invoices/quotes', {
        token: rep18ElevatedToken,
        body: {
          customerId: cust18Id,
          warehouseId: mainWhId,
          date: '2026-11-21',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitPrice: 60 }],
        },
      });
      assert.equal(normalQuote.status, 201);
      const quote18Id = normalQuote.json.invoice.id;

      const conv1 = await req(baseUrl, 'POST', `/api/invoices/quotes/${quote18Id}/convert`, {
        token: rep18ElevatedToken,
        body: {},
      });
      assert.equal(conv1.status, 201);

      const dupQuoteConv = await req(baseUrl, 'POST', `/api/invoices/quotes/${quote18Id}/convert`, {
        token: rep18ElevatedToken,
        body: {},
      });
      assert.equal(dupQuoteConv.status, 409);
      assert.equal(dupQuoteConv.json.code, 'QUOTE_ALREADY_CONVERTED');

      // rep-summary omits aggregate receivables/payables for representatives while keeping admin totals intact
      const repSummaryRes = await req(baseUrl, 'GET', '/api/reports/rep-summary', { token: rep18ElevatedToken });
      assert.equal(repSummaryRes.status, 200);
      assert.equal(repSummaryRes.json.report.summary.totalCustomerReceivables, undefined, 'Rep summary must NOT expose company-wide totalCustomerReceivables');
      assert.equal(repSummaryRes.json.report.summary.totalSupplierPayables, undefined, 'Rep summary must NOT expose company-wide totalSupplierPayables');
      assert.ok(Number(repSummaryRes.json.report.summary.salesReturnRequestsCount) >= 2);

      const adminSummaryRes = await req(baseUrl, 'GET', '/api/reports/rep-summary', { token: adminToken });
      assert.equal(adminSummaryRes.status, 200);
      assert.equal(typeof adminSummaryRes.json.report.summary.totalCustomerReceivables, 'number');
      assert.equal(typeof adminSummaryRes.json.report.summary.totalSupplierPayables, 'number');

      s18Ctx = {
        rep18User,
        rep18Id,
        rep18Token,
        rep18ElevatedToken,
        nonTreasuryToken,
        treasuryToken,
        cust18Id,
        sup18Id,
        pur18Id,
      };
    });

    await test(`[${modeName}] 19. Purchase return request approval, multi-customer aggregate debt isolation & order conversion/advance hardening`, async () => {
      const {
        rep18User,
        rep18Id,
        rep18ElevatedToken,
        nonTreasuryToken,
        treasuryToken,
        cust18Id,
        sup18Id,
        pur18Id,
      } = s18Ctx;

      const getStateSnap = async () => {
        const boot = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
        assert.equal(boot.status, 200);
        return {
          cb1: Number((boot.json.data.cashboxes || []).find((c) => c.id === cashboxId)?.currentBalance || 0),
          cb2: Number((boot.json.data.cashboxes || []).find((c) => c.id === cashbox2Id)?.currentBalance || 0),
          supBal: Number((boot.json.data.suppliers || []).find((s) => s.id === sup18Id)?.currentBalance || 0),
          stock: Number((boot.json.data.products || []).find((p) => p.id === productId)?.stockPerWarehouse?.[mainWhId] || 0),
        };
      };

      // 19a. Purchase Return Request full lifecycle (pending -> no mutation -> treasury approve -> exact cash/stock effect -> idempotency & 409)
      const snapBeforePrr = await getStateSnap();
      const prrCreate = await req(baseUrl, 'POST', '/api/invoices/purchase-return-requests', {
        token: rep18ElevatedToken,
        headers: { 'Idempotency-Key': `PRR-CREATE-${modeName}` },
        body: {
          originalInvoiceId: pur18Id,
          partyId: 'SUP-SPOOF-999',
          partyName: 'مورد مزور',
          refundType: 'cash',
          date: '2026-11-22',
          reason: 'طلب مرتجع شراء نقدي للاعتماد',
          items: [{ productId, quantity: 1, unit: 'زجاجة', unitFactor: 1, unitPrice: 50 }],
        },
      });
      assert.equal(prrCreate.status, 201);
      const prr = prrCreate.json.request;
      assert.equal(prr.status, 'pending');
      assert.equal(prr.supplierId, sup18Id, 'PRR must resolve supplier from authoritative original invoice');

      const snapPendingPrr = await getStateSnap();
      assert.equal(snapPendingPrr.cb1, snapBeforePrr.cb1);
      assert.equal(snapPendingPrr.cb2, snapBeforePrr.cb2);
      assert.equal(snapPendingPrr.supBal, snapBeforePrr.supBal);
      assert.equal(snapPendingPrr.stock, snapBeforePrr.stock, 'Pending PRR must not mutate inventory before approval');

      // Rep blocked from approving/rejecting own/other PRR even with elevated flags
      const repApprovePrr = await req(baseUrl, 'POST', `/api/invoices/purchase-return-requests/${prr.id}/approve`, {
        token: rep18ElevatedToken,
        body: { cashboxId: cashbox2Id },
      });
      assert.equal(repApprovePrr.status, 403);
      assert.ok(
        ['FORBIDDEN_APPROVE_RETURN_REQUEST', 'FORBIDDEN_PERMISSION'].includes(repApprovePrr.json.code),
        `Expected forbidden approval code, got ${repApprovePrr.json.code}`
      );

      const nonTreasApprovePrr = await req(baseUrl, 'POST', `/api/invoices/purchase-return-requests/${prr.id}/approve`, {
        token: nonTreasuryToken,
        body: { cashboxId: cashbox2Id },
      });
      assert.equal(nonTreasApprovePrr.status, 403);
      assert.ok(
        ['FORBIDDEN_TREASURY_PERMISSION', 'FORBIDDEN_PERMISSION'].includes(nonTreasApprovePrr.json.code),
        `Expected forbidden treasury/approval code, got ${nonTreasApprovePrr.json.code}`
      );

      const treasApprovePrr1 = await req(baseUrl, 'POST', `/api/invoices/purchase-return-requests/${prr.id}/approve`, {
        token: treasuryToken,
        headers: { 'Idempotency-Key': `APR-PRR-${modeName}` },
        body: { cashboxId: cashbox2Id, approvalNotes: 'اعتماد استرداد نقدي من المورد للبنك' },
      });
      assert.equal(treasApprovePrr1.status, 200);
      assert.equal(treasApprovePrr1.json.request.status, 'approved');
      assert.equal(treasApprovePrr1.json.invoiceReturn.cashboxId, cashbox2Id);
      assert.equal(treasApprovePrr1.json.invoiceReturn.partyId, sup18Id);

      // Replay same key -> 200 idempotent; new key -> 409 REQUEST_ALREADY_PROCESSED
      const treasApprovePrrReplay = await req(baseUrl, 'POST', `/api/invoices/purchase-return-requests/${prr.id}/approve`, {
        token: treasuryToken,
        headers: { 'Idempotency-Key': `APR-PRR-${modeName}` },
        body: { cashboxId: cashbox2Id },
      });
      assert.equal(treasApprovePrrReplay.status, 200);

      const treasApprovePrrDup = await req(baseUrl, 'POST', `/api/invoices/purchase-return-requests/${prr.id}/approve`, {
        token: treasuryToken,
        headers: { 'Idempotency-Key': `APR-PRR-DUP-${modeName}` },
        body: { cashboxId: cashbox2Id },
      });
      assert.equal(treasApprovePrrDup.status, 409);
      assert.equal(treasApprovePrrDup.json.code, 'REQUEST_ALREADY_PROCESSED');

      const snapApprovedPrr = await getStateSnap();
      assert.equal(snapApprovedPrr.cb2, snapBeforePrr.cb2 + 50, 'Approved cash PRR must add refund to cashbox2Id exactly once');
      assert.equal(snapApprovedPrr.stock, snapBeforePrr.stock - 1, 'Approved PRR must deduct inventory once');
      assert.equal(snapApprovedPrr.supBal, snapBeforePrr.supBal, 'Cash refund PRR must not change supplier balance');

      const repListPrr = await req(baseUrl, 'GET', '/api/invoices/purchase-return-requests', { token: rep18ElevatedToken });
      assert.equal(repListPrr.status, 200);
      const repSeenPrr = (repListPrr.json.requests || []).find((r) => r.id === prr.id);
      assert.ok(repSeenPrr);
      assert.equal(repSeenPrr.cashboxId, undefined, 'Representative must not see approved cashboxId on PRR');

      // 19b. Multi-customer + other-rep transactions: verify NO aggregate debt totals leak on bootstrap / sync-pull / rep-summary while individual customer balance & statement remain accessible
      const cust18BRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: 'عميل اختبار 18ب', phone: '01077778809', openingBalance: 750 },
      });
      assert.equal(cust18BRes.status, 201);
      const cust18BId = cust18BRes.json.customer.id;

      const admSaleB = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId: cust18BId,
          warehouseId: mainWhId,
          cashboxId,
          date: '2026-11-22',
          paidAmount: 0,
          paymentType: 'credit',
          items: [{ productId, quantity: 2, unit: 'زجاجة', unitPrice: 60 }],
        },
      });
      assert.equal(admSaleB.status, 201);

      const bootRep18 = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: rep18ElevatedToken });
      assert.equal(bootRep18.status, 200);
      assert.equal(bootRep18.json.data.summary, undefined, 'Bootstrap must not include company-wide summary');
      assert.equal(bootRep18.json.data.totalCustomerReceivables, undefined);
      const bootCustB = (bootRep18.json.data.customers || []).find((c) => c.id === cust18BId);
      assert.ok(bootCustB, 'Rep sees company customers individually');
      assert.equal(Number(bootCustB.currentBalance), 870);

      const syncPullRep18 = await req(baseUrl, 'GET', '/api/sync/pull', { token: rep18ElevatedToken });
      assert.equal(syncPullRep18.status, 200);
      assert.equal(syncPullRep18.json.totalCustomerReceivables, undefined);
      assert.equal(syncPullRep18.json.totalSupplierPayables, undefined);
      assert.ok((syncPullRep18.json.customers || []).some((c) => c.id === cust18BId && Number(c.currentBalance) === 870));

      const stmtBRes = await req(baseUrl, 'GET', `/api/customers/${cust18BId}/statement`, { token: rep18ElevatedToken });
      assert.equal(stmtBRes.status, 200);
      assert.equal(Number(stmtBRes.json.statement.summary.currentBalance), 870);

      const repSummaryMulti = await req(baseUrl, 'GET', '/api/reports/rep-summary', { token: rep18ElevatedToken });
      assert.equal(repSummaryMulti.status, 200);
      assert.equal(repSummaryMulti.json.report.summary.totalCustomerReceivables, undefined);
      assert.equal(repSummaryMulti.json.report.summary.totalSupplierPayables, undefined);

      // 19c. Customer Order advance payment & convert-to-invoice cross-rep block + spoofing lock
      const ord18Create = await req(baseUrl, 'POST', '/api/orders', {
        token: rep18ElevatedToken,
        body: {
          customerId: cust18Id,
          items: [{ productId, quantity: 2, unitPrice: 60 }],
          notes: 'طلب لاختبار تحويل الطلب لفاتورة بأمان',
        },
      });
      assert.equal(ord18Create.status, 201);
      const ord18Id = ord18Create.json.order.id;

      const ord18Approve = await req(baseUrl, 'POST', `/api/orders/${ord18Id}/approve`, {
        token: adminToken,
        body: {},
      });
      assert.equal(ord18Approve.status, 200);

      // Cross-rep cannot record advance payment or convert another rep's order
      const otherRepAdv = await req(baseUrl, 'POST', `/api/orders/${ord18Id}/advance-payment`, {
        token: rep1Token,
        body: { amount: 20, cashboxId: cashbox2Id },
      });
      assert.equal(otherRepAdv.status, 403);
      assert.equal(otherRepAdv.json.code, 'FORBIDDEN_ORDER_ACCESS');

      const otherRepConvertOrd = await req(baseUrl, 'POST', `/api/orders/${ord18Id}/convert-to-invoice`, {
        token: rep1Token,
        body: { warehouseId: mainWhId },
      });
      assert.equal(otherRepConvertOrd.status, 403);
      assert.equal(otherRepConvertOrd.json.code, 'FORBIDDEN_ORDER_ACCESS');

      // Non-admin customer override on order conversion blocked
      const ordCustOverride = await req(baseUrl, 'POST', `/api/orders/${ord18Id}/convert-to-invoice`, {
        token: rep18ElevatedToken,
        body: { customerId: cust18BId, warehouseId: mainWhId },
      });
      assert.equal(ordCustOverride.status, 403);
      assert.equal(ordCustOverride.json.code, 'FORBIDDEN_ORDER_CUSTOMER_OVERRIDE');

      // Owning rep converting order locks rep identity, order customer, order items/prices, and strips cost/cashbox
      const repOrdConvert = await req(baseUrl, 'POST', `/api/orders/${ord18Id}/convert-to-invoice`, {
        token: rep18ElevatedToken,
        headers: { 'Idempotency-Key': `ORD18-CONV-${modeName}` },
        body: {
          warehouseId: mainWhId,
          cashboxId: cashbox2Id,
          representativeId: rep1Id,
          representativeName: 'مندوب مزور',
          createdByUserId: 'ADMIN-SPOOF',
          createdBy: 'أدمن مزور',
          items: [{ productId, quantity: 2, unit: 'زجاجة', unitPrice: 1 }],
        },
      });
      assert.equal(repOrdConvert.status, 201);
      const convOrdInv = repOrdConvert.json.invoice;
      assert.equal(convOrdInv.customerId, cust18Id);
      assert.equal(convOrdInv.representativeId, rep18Id, 'Order conversion must force owning representativeId');
      assert.equal(convOrdInv.createdByUserId, rep18User.id, 'Order conversion must ignore spoofed createdByUserId');
      assert.notEqual(convOrdInv.cashboxId, cashbox2Id, 'Order conversion for rep must ignore spoofed cashboxId');
      assert.equal(Number(convOrdInv.items[0].purchasePriceAtTime || 0), 0, 'Order conversion for rep must zero purchasePriceAtTime');
      assert.equal(Number(convOrdInv.grandTotal), 120, 'Order conversion for rep must lock authoritative order item pricing');

      const dupOrdConvert = await req(baseUrl, 'POST', `/api/orders/${ord18Id}/convert-to-invoice`, {
        token: rep18ElevatedToken,
        headers: { 'Idempotency-Key': `ORD18-CONV-DUP-${modeName}` },
        body: { warehouseId: mainWhId },
      });
      assert.equal(dupOrdConvert.status, 409);
      assert.equal(dupOrdConvert.json.code, 'ORDER_ALREADY_INVOICED');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    setInjectedPool(null);
    resetPgModeCache();
    resetAllRateLimitsForTests();
    fs.rmSync(modeDir, { recursive: true, force: true });
  }
}

await runFullModeAudit('json');
await runFullModeAudit('pg');

fs.rmSync(tempDataDir, { recursive: true, force: true });
console.log(`\nALL FINAL SECURITY & OPTIMIZATION AUDIT TESTS PASSED (${passed} assertion groups across JSON & PG)!`);

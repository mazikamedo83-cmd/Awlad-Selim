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
const { getComprehensiveReport } = await import('../db/stores/reportsStore.js');
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

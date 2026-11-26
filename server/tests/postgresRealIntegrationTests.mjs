import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const hasPgEnv = Boolean(
  (process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING || process.env.PGHOST || process.env.DB_HOST || '').trim()
);
const isStrictPgRequired = process.env.AWLAD_REQUIRE_POSTGRES === 'true';

if (!hasPgEnv) {
  if (isStrictPgRequired) {
    console.error('[FAIL] AWLAD_REQUIRE_POSTGRES=true but DATABASE_URL / PGHOST is missing.');
    process.exit(1);
  }
  console.log('[SKIP] postgresRealIntegrationTests.mjs skipped (no local PostgreSQL connection env configured; enforced on CI with PostgreSQL 16).');
  process.exit(0);
}

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_real_pg16_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.AWLAD_REQUIRE_POSTGRES = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'real_pg16_integration_jwt_secret_key_awlad_selim_2026';
process.env.BOOTSTRAP_ADMIN_SECRET = process.env.BOOTSTRAP_ADMIN_SECRET || 'RealPg16BootstrapSecret!2026';

const {
  initializeSchema,
  getPool,
  closePostgresPool,
  isStrictPostgresMode,
  setInjectedPool,
} = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { createApiApp } = await import('../app.js');
const { loadFullReportDataset } = await import('../db/stores/reportsStore.js');
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

console.log('\n=== AWLAD SELIM Real PostgreSQL 16 Integration & Transactional Integrity Suite ===');

let server = null;
try {
  assert.equal(isStrictPostgresMode(), true, 'Strict PG mode must be active');
  setInjectedPool(null);
  resetPgModeCache();
  resetAllRateLimitsForTests();

  await test('1. Idempotent PostgreSQL 16 schema initialization & partial unique/composite index verification', async () => {
    const init1 = await initializeSchema();
    assert.equal(init1.success, true, init1.error || 'First initializeSchema failed');
    const init2 = await initializeSchema();
    assert.equal(init2.success, true, init2.error || 'Second initializeSchema failed (idempotency violation)');

    const pool = getPool();
    assert.ok(pool, 'Real PG pool must be initialized');

    const tablesRes = await pool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    const tableNames = new Set(tablesRes.rows.map((r) => r.tablename));
    for (const requiredTable of [
      'users',
      'warehouses',
      'products',
      'customers',
      'suppliers',
      'invoices',
      'invoice_returns',
      'cashboxes',
      'financial_transactions',
      'representatives',
      'customer_item_orders',
      'rep_custody_operations',
      'sync_dispatch_batches',
      'identities',
      'identity_roles',
      'audit_logs',
      'idempotency_keys',
    ]) {
      assert.ok(tableNames.has(requiredTable), `Missing PG table: ${requiredTable}`);
    }

    for (const retiredTable of ['advances_deductions', 'attendance', 'payrolls']) {
      assert.equal(tableNames.has(retiredTable), false, `Retired HR table must not exist on PG 16: ${retiredTable}`);
    }
    assert.ok(tableNames.has('employees'), 'employees table must be preserved');
    assert.ok(tableNames.has('order_advance_payments'), 'customer order_advance_payments must be preserved');

    const empColsRes = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees'`
    );
    const empCols = new Set(empColsRes.rows.map((r) => r.column_name));
    assert.equal(empCols.has('basic_salary'), false, 'employees.basic_salary must not exist on PG 16');
    assert.equal(empCols.has('user_id'), true, 'employees.user_id 1:1 link column must be preserved');

    const idxRes = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
    `);
    const idxNames = new Set(idxRes.rows.map((r) => r.indexname));
    for (const expectedIdx of [
      'idx_invoices_wh_date',
      'idx_invoices_date_type',
      'idx_invoices_cashbox_date',
      'idx_invoices_number',
      'idx_invoice_returns_party_date',
      'idx_fin_tx_cashbox_date',
      'idx_stock_movements_prod_date',
      'idx_rep_custody_ops_date_prod',
      'idx_users_role_norm_phone',
      'idx_users_role_norm_phone_unique',
      'idx_users_employee_id_unique',
      'idx_employees_user_id_unique',
      'idx_customers_norm_phone',
      'idx_reps_norm_phone',
      'idx_sync_dispatch_sender',
      'idx_sync_dispatch_status',
    ]) {
      assert.ok(idxNames.has(expectedIdx), `Missing expected PG index: ${expectedIdx}`);
    }

    const fkRes = await pool.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_type = 'FOREIGN KEY' AND constraint_schema = 'public'
    `);
    const fkNames = new Set(fkRes.rows.map((r) => r.constraint_name));
    assert.ok(fkNames.has('fk_users_employee_id'), 'Missing fk_users_employee_id');
    assert.ok(fkNames.has('fk_employees_user_id'), 'Missing fk_employees_user_id');
  });

  const app = createApiApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  let adminToken = '';
  let adminUserId = '';
  let adminUser = null;
  let repToken = '';
  let repId = '';
  let repVanWhId = '';
  let mainWhId = '';
  let cbMainId = '';
  let supplierId = '';
  let customerId = '';
  let productId = '';

  await test('2. Concurrent bootstrap-admin & concurrent duplicate registration enforce real PG uniqueness', async () => {
    const [b1, b2] = await Promise.all([
      req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'مدير PG الفعلي',
          username: 'pg_real_admin_1',
          password: 'PgAdminPassword!2026',
          phone: '01090000001',
          bootstrapSecret: process.env.BOOTSTRAP_ADMIN_SECRET,
        },
      }),
      req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'مدير PG الفعلي 2',
          username: 'pg_real_admin_2',
          password: 'PgAdminPassword!2026',
          phone: '01090000002',
          bootstrapSecret: process.env.BOOTSTRAP_ADMIN_SECRET,
        },
      }),
    ]);

    const winners = [b1, b2].filter((r) => r.status === 201);
    const losers = [b1, b2].filter((r) => r.status !== 201);
    assert.equal(winners.length, 1, 'Exactly 1 concurrent bootstrap-admin must succeed');
    assert.equal(losers.length, 1, 'Second concurrent bootstrap-admin must be blocked');
    adminUser = winners[0].json.user;
    adminUserId = adminUser.id;

    const loginAdmin = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { username: adminUser.username, password: 'PgAdminPassword!2026' },
    });
    assert.equal(loginAdmin.status, 200, 'Admin login after bootstrap must succeed');
    adminToken = loginAdmin.json.accessToken;
    assert.ok(adminToken, 'Admin accessToken must be present after login');

    // Concurrent customer registration with identical normalized phone -> max 1 succeeds
    const [reg1, reg2] = await Promise.all([
      req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'عميل سباق 1',
          username: 'pg_race_cust_1',
          phone: '+201055511122',
          password: 'PgCustPassword!2026',
        },
      }),
      req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'عميل سباق 2',
          username: 'pg_race_cust_2',
          phone: '01055511122',
          password: 'PgCustPassword!2026',
        },
      }),
    ]);
    assert.equal([reg1, reg2].filter((r) => r.status === 201).length, 1, 'Only 1 concurrent normalized-phone registration can succeed');
    assert.equal([reg1, reg2].filter((r) => r.status >= 400).length, 1);

    // Representative registration
    const repReg = await req(baseUrl, 'POST', '/api/auth/register', {
      body: {
        role: 'representative',
        fullName: 'مندوب PG الفعلي',
        username: 'pg_rep_1',
        phone: '01080000008',
        password: 'PgRepPassword!2026',
        area: 'مدينة نصر',
      },
    });
    assert.equal(repReg.status, 201);
    repToken = repReg.json.accessToken;
    repId = repReg.json.representativeProfile.id;
    repVanWhId = repReg.json.representativeProfile.warehouseId;
  });

  await test('3. Transactional purchase, sales, payment, return & custody operations preserve real PG ledger & balance_after', async () => {
    const whRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
      token: adminToken,
      body: { name: 'المخزن الرئيسي PG', code: 'PG-MAIN', isDefault: true },
    });
    assert.equal(whRes.status, 201);
    mainWhId = whRes.json.warehouse.id;

    const cbRes = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
      token: adminToken,
      body: { name: 'الخزينة الرئيسية PG', type: 'cash', openingBalance: 10000, isDefault: true },
    });
    assert.equal(cbRes.status, 201);
    cbMainId = cbRes.json.cashbox.id;

    const supRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
      token: adminToken,
      body: { name: 'مورد الدلتا المصري', phone: '01155556666', openingBalance: 0 },
    });
    assert.equal(supRes.status, 201);
    supplierId = supRes.json.supplier.id;

    const custRes = await req(baseUrl, 'POST', '/api/customers', {
      token: adminToken,
      body: { name: 'متجر السلام', phone: '01244445555', openingBalance: 100 },
    });
    assert.equal(custRes.status, 201);
    customerId = custRes.json.customer.id;

    const prodRes = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        name: 'مكرونة قلم مصري 400 جم',
        code: 'EGY-PENNE-400',
        category: 'مكرونات مصرية',
        baseUnit: 'كيس',
        purchasePrice: 10,
        sellingPrice: 15,
        stockPerWarehouse: { [mainWhId]: 100, [repVanWhId]: 40 },
      },
    });
    assert.equal(prodRes.status, 201);
    productId = prodRes.json.product.id;

    // Purchase send + receive
    const purRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
      token: adminToken,
      body: {
        supplierId,
        warehouseId: mainWhId,
        cashboxId: cbMainId,
        paymentType: 'cash',
        paidAmount: 200,
        status: 'draft',
        items: [{ productId, unit: 'كيس', quantity: 20, unitPrice: 10 }],
      },
    });
    assert.equal(purRes.status, 201);
    assert.equal(
      (await req(baseUrl, 'POST', `/api/invoices/purchase/${purRes.json.invoice.id}/send`, { token: adminToken, body: {} })).status,
      200
    );
    assert.equal(
      (await req(baseUrl, 'POST', `/api/invoices/purchase/${purRes.json.invoice.id}/receive`, {
        token: adminToken,
        body: { warehouseId: mainWhId, cashboxId: cbMainId, confirmNow: true },
      })).status,
      200
    );

    // Cashbox now 10000 - 200 = 9800; mainWh stock = 120
    const saleRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
      token: adminToken,
      body: {
        customerId,
        warehouseId: mainWhId,
        cashboxId: cbMainId,
        paymentType: 'partial',
        paidAmount: 150,
        status: 'confirmed',
        items: [{ productId, unit: 'كيس', quantity: 20, unitPrice: 15 }],
      },
    });
    assert.equal(saleRes.status, 201);
    const saleId = saleRes.json.invoice.id;

    // Customer payment +50
    const payRes = await req(baseUrl, 'POST', `/api/invoices/${saleId}/payments`, {
      token: adminToken,
      body: { amount: 50, cashboxId: cbMainId, paymentMethod: 'cash', date: '2026-11-24' },
    });
    assert.equal(payRes.status, 200);

    // Return 2 items to balance (30 refund)
    const retRes = await req(baseUrl, 'POST', '/api/invoices/returns', {
      token: adminToken,
      body: {
        originalInvoiceId: saleId,
        type: 'sales_return',
        refundType: 'balance',
        warehouseId: mainWhId,
        items: [{ productId, unit: 'كيس', quantity: 2, unitPrice: 15 }],
      },
    });
    assert.equal(retRes.status, 201);

    const boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    const cb = boot.cashboxes.find((c) => c.id === cbMainId);
    const cust = boot.customers.find((c) => c.id === customerId);
    const prod = boot.products.find((p) => p.id === productId);

    assert.equal(Number(cb.currentBalance), 10000); // 10000 - 200 + 150 + 50
    assert.equal(Number(cust.currentBalance), 170); // 100 + 300 - 150 - 50 - 30
    assert.equal(Number(prod.stockPerWarehouse[mainWhId]), 102); // 100 + 20 - 20 + 2

    for (const tx of boot.financialTransactions) {
      assert.equal(typeof tx.balanceAfter, 'number', `PG tx ${tx.id} must expose numeric balanceAfter`);
    }

    const ds = await loadFullReportDataset(adminUser, { dateFrom: '2026-01-01', dateTo: '2026-12-31' });
    assert.ok(ds.invoices.length >= 2);
  });

  await test('4. REFRESH sync_dispatch_batches works atomically on real PG 16 (chained local IDs, idempotency, zero double-posting)', async () => {
    const batchUuid = `PG-BATCH-${Date.now()}`;
    const sendRes = await req(baseUrl, 'POST', '/api/sync/dispatches', {
      token: repToken,
      body: {
        clientBatchUuid: batchUuid,
        idempotencyKey: batchUuid,
        recipientUserId: adminUserId,
        notes: 'دفعة PG16 الحقيقية',
        operations: [
          {
            operationId: `PG-OP-CUS-${Date.now()}`,
            operationType: 'create_customer',
            entityType: 'customer',
            localId: 'CUS-LOC-PG1',
            summaryAr: 'عميل جديد على PG',
            payload: { localId: 'CUS-LOC-PG1', name: 'متجر الوفاء', shopName: 'الوفاء ماركت', phone: '01177778888' },
          },
          {
            operationId: `PG-OP-INV-${Date.now()}`,
            operationType: 'create_sales_invoice',
            entityType: 'invoice',
            localId: 'INV-LOC-PG1',
            summaryAr: 'فاتورة بيع على PG',
            payload: {
              localId: 'INV-LOC-PG1',
              customerId: 'CUS-LOC-PG1',
              warehouseId: repVanWhId,
              representativeId: repId,
              date: '2026-11-24',
              paymentType: 'partial',
              paidAmount: 30,
              discountTotal: 0,
              items: [{ productId, unit: 'كيس', unitFactor: 1, quantity: 4, unitPrice: 15, discount: 0 }],
            },
          },
          {
            operationId: `PG-OP-PAY-${Date.now()}`,
            operationType: 'record_customer_payment',
            entityType: 'financial',
            summaryAr: 'تحصيل 15 ج.م',
            payload: {
              customerId: 'CUS-LOC-PG1',
              invoiceId: 'INV-LOC-PG1',
              amount: 15,
              paymentMethod: 'cash',
              date: '2026-11-24',
            },
          },
        ],
      },
    });
    assert.equal(sendRes.status, 201);
    const batchId = sendRes.json.batch.id;
    assert.match(sendRes.json.batch.batchNumber, /^DSP-\d{4}-\d{4}$/);

    // Duplicate submission must deduplicate cleanly
    const dupRes = await req(baseUrl, 'POST', '/api/sync/dispatches', {
      token: repToken,
      body: {
        clientBatchUuid: batchUuid,
        idempotencyKey: batchUuid,
        recipientUserId: adminUserId,
        operations: sendRes.json.batch.operationsSnapshot,
      },
    });
    assert.equal(dupRes.status, 200);
    assert.equal(dupRes.json.deduplicated, true);

    const beforeBoot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    const beforeCb = Number(beforeBoot.cashboxes.find((c) => c.id === cbMainId).currentBalance);

    const confRes = await req(baseUrl, 'POST', `/api/sync/dispatches/${batchId}/confirm-receipt`, {
      token: adminToken,
      body: { receiptNotes: 'تمت مراجعة الدفعة على PG16' },
    });
    assert.equal(confRes.status, 200);
    assert.equal(confRes.json.batch.receiptStatus, 'تم الاستلام');

    const afterBoot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    const afterCb = Number(afterBoot.cashboxes.find((c) => c.id === cbMainId).currentBalance);
    assert.equal(afterCb, beforeCb, 'confirm-receipt on PG16 must not double-post cashbox');

    const newCust = afterBoot.customers.find((c) => c.name === 'متجر الوفاء');
    assert.ok(newCust, 'Chained customer must persist on PG16');
    assert.equal(Number(newCust.currentBalance), 15); // 60 - 30 - 15
  });

  await test('5. Real PostgreSQL 16 enforces 1:1 Employee-User unique/FK constraints and clean null unlink/re-link', async () => {
    const e1 = await req(baseUrl, 'POST', '/api/admin/employees', {
      token: adminToken,
      body: { code: 'PG-EMP-1', name: 'موظف PG1', phone: '01066660001', jobTitle: 'محاسب' },
    });
    assert.equal(e1.status, 201);
    const e2 = await req(baseUrl, 'POST', '/api/admin/employees', {
      token: adminToken,
      body: { code: 'PG-EMP-2', name: 'موظف PG2', phone: '01066660002', jobTitle: 'بائع' },
    });
    assert.equal(e2.status, 201);

    const u1 = await req(baseUrl, 'POST', '/api/admin/users', {
      token: adminToken,
      body: {
        fullName: 'مستخدم PG1',
        username: 'pg_1to1_u1',
        password: 'PgUserPass!2026',
        role: 'sales',
        linkedEmployeeId: e1.json.employee.id,
      },
    });
    assert.equal(u1.status, 201);

    const dupU = await req(baseUrl, 'POST', '/api/admin/users', {
      token: adminToken,
      body: {
        fullName: 'مستخدم مكرر',
        username: 'pg_1to1_dup',
        password: 'PgUserPass!2026',
        role: 'sales',
        linkedEmployeeId: e1.json.employee.id,
      },
    });
    assert.equal(dupU.status, 409);

    const unlinkU = await req(baseUrl, 'PUT', `/api/admin/users/${u1.json.user.id}`, {
      token: adminToken,
      body: { linkedEmployeeId: null },
    });
    assert.equal(unlinkU.status, 200);
    assert.ok(!unlinkU.json.user.employeeId);

    const relinkU = await req(baseUrl, 'PUT', `/api/admin/users/${u1.json.user.id}`, {
      token: adminToken,
      body: { linkedEmployeeId: e2.json.employee.id },
    });
    assert.equal(relinkU.status, 200);
    assert.equal(relinkU.json.user.employeeId, e2.json.employee.id);
  });

  await test('6. Closed/unreachable PostgreSQL in strict mode returns 503 DATABASE_UNAVAILABLE without JSON fallback', async () => {
    await closePostgresPool();
    setInjectedPool({
      async query() {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
      },
      async connect() {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
      },
    });
    resetPgModeCache();
    const failRes = await req(baseUrl, 'GET', '/api/auth/status');
    assert.equal(failRes.status, 503);
    assert.equal(failRes.json?.code, 'DATABASE_UNAVAILABLE');
  });

  await test('7. Real PostgreSQL 16 v14 legacy Employee<->User migration preserves data, logs conflicts, backfills 1:1 pairs, and runs idempotently', async () => {
    setInjectedPool(null);
    resetPgModeCache();
    const { Pool } = (await import('pg')).default;
    const baseCfgUrl = new URL(process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING);
    const legacyDbName = `awlad_v14_legacy_${Date.now()}`;
    const adminPg = new Pool({ connectionString: baseCfgUrl.toString() });

    let legacyPool = null;
    try {
      await adminPg.query(`CREATE DATABASE "${legacyDbName}"`);
      const legacyUrl = new URL(baseCfgUrl.toString());
      legacyUrl.pathname = `/${legacyDbName}`;
      legacyPool = new Pool({ connectionString: legacyUrl.toString() });

      // Initialize full schema first, then drop v14 indexes/FKs to simulate pre-v14 legacy tables
      const preInit = await initializeSchema(legacyPool);
      assert.equal(preInit.success, true);

      await legacyPool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_employee_id`);
      await legacyPool.query(`ALTER TABLE employees DROP CONSTRAINT IF EXISTS fk_employees_user_id`);
      await legacyPool.query(`DROP INDEX IF EXISTS idx_users_employee_id_unique`);
      await legacyPool.query(`DROP INDEX IF EXISTS idx_employees_user_id_unique`);

      // Seed unambiguous 1:1 asymmetric legacy pairs + duplicate/orphan/empty-string legacy rows
      await legacyPool.query(
        `INSERT INTO employees (id, code, full_name, job_title, hire_date, user_id) VALUES
         ('EMP-LEG-A', 'E-A', 'موظف أ', 'مندوب', '2026-01-01', NULL),
         ('EMP-LEG-B', 'E-B', 'موظف ب', 'مندوب', '2026-01-01', 'USR-LEG-B'),
         ('EMP-LEG-C', 'E-C', 'موظف ج', 'مندوب', '2026-01-01', NULL),
         ('EMP-LEG-E', 'E-E', 'موظف هـ', 'مندوب', '2026-01-01', '')`
      );
      await legacyPool.query(
        `INSERT INTO users (id, full_name, username, password_hash, role, employee_id) VALUES
         ('USR-LEG-A', 'مستخدم أ', 'leg_u_a', 'hash', 'sales', 'EMP-LEG-A'),
         ('USR-LEG-B', 'مستخدم ب', 'leg_u_b', 'hash', 'sales', NULL),
         ('USR-LEG-C1', 'مستخدم ج1', 'leg_u_c1', 'hash', 'sales', 'EMP-LEG-C'),
         ('USR-LEG-C2', 'مستخدم ج2', 'leg_u_c2', 'hash', 'sales', 'EMP-LEG-C'),
         ('USR-LEG-ORP', 'مستخدم يتيم', 'leg_u_orp', 'hash', 'sales', 'EMP-MISSING-999'),
         ('USR-LEG-EMP', 'مستخدم فراغ', 'leg_u_emp', 'hash', 'sales', '')`
      );

      // Run v14 migration inside transaction on real PostgreSQL 16
      const mig1 = await initializeSchema(legacyPool);
      assert.equal(mig1.success, true, mig1.error || 'v14 legacy migration failed');

      // Verify empty strings cleaned, unambiguous 1:1 pairs backfilled, zero records deleted
      const empARes = await legacyPool.query(`SELECT user_id FROM employees WHERE id = 'EMP-LEG-A'`);
      assert.equal(empARes.rows[0].user_id, 'USR-LEG-A');
      const usrBRes = await legacyPool.query(`SELECT employee_id FROM users WHERE id = 'USR-LEG-B'`);
      assert.equal(usrBRes.rows[0].employee_id, 'EMP-LEG-B');
      const empERes = await legacyPool.query(`SELECT user_id FROM employees WHERE id = 'EMP-LEG-E'`);
      assert.equal(empERes.rows[0].user_id, null);
      const usrEmpRes = await legacyPool.query(`SELECT employee_id FROM users WHERE id = 'USR-LEG-EMP'`);
      assert.equal(usrEmpRes.rows[0].employee_id, null);

      const conflictsRes = await legacyPool.query(
        `SELECT identifier_key FROM identity_conflicts WHERE conflict_type = 'employee_user_link_conflict' AND status = 'pending_review'`
      );
      const conflictKeys = new Set(conflictsRes.rows.map((r) => r.identifier_key));
      assert.ok(conflictKeys.has('employee:EMP-LEG-C:multiple_users'));
      assert.ok(conflictKeys.has('user_orphan_employee:EMP-MISSING-999'));

      // Re-run migration idempotently -> zero errors and zero duplicate conflict rows
      const mig2 = await initializeSchema(legacyPool);
      assert.equal(mig2.success, true, mig2.error || 'Idempotent v14 re-run failed');
      const conflictsAfterRerun = await legacyPool.query(
        `SELECT COUNT(*) AS cnt FROM identity_conflicts WHERE identifier_key = 'employee:EMP-LEG-C:multiple_users'`
      );
      assert.equal(Number(conflictsAfterRerun.rows[0].cnt), 1);

      // Resolve legacy duplicate & orphan links non-destructively, then re-run to enforce unique index + FK
      await legacyPool.query(`UPDATE users SET employee_id = NULL WHERE id IN ('USR-LEG-C2', 'USR-LEG-ORP')`);
      const mig3 = await initializeSchema(legacyPool);
      assert.equal(mig3.success, true, mig3.error || 'Post-cleanup v14 migration failed');

      const idxRes = await legacyPool.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_users_employee_id_unique', 'idx_employees_user_id_unique')`
      );
      assert.equal(idxRes.rows.length, 2, 'Both 1:1 unique indexes must exist after resolving legacy conflicts');
      const fkRes = await legacyPool.query(
        `SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public' AND constraint_name IN ('fk_users_employee_id', 'fk_employees_user_id')`
      );
      assert.equal(fkRes.rows.length, 2, 'Both 1:1 foreign keys must exist after resolving legacy conflicts');
    } finally {
      if (legacyPool) await legacyPool.end().catch(() => {});
      await adminPg.query(`DROP DATABASE IF EXISTS "${legacyDbName}" WITH (FORCE)`).catch(() => {});
      await adminPg.end().catch(() => {});
    }
  });

  console.log(`\n[SUCCESS] Real PostgreSQL 16 integration suite passed (${passed} checks).\n`);
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  setInjectedPool(null);
  await closePostgresPool().catch(() => {});
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}

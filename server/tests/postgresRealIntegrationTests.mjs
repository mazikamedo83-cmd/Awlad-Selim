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
  closePool,
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
    adminToken = winners[0].json.accessToken;
    adminUser = winners[0].json.user;
    adminUserId = adminUser.id;

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
    await closePool();
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

  console.log(`\n[SUCCESS] Real PostgreSQL 16 integration suite passed (${passed} checks).\n`);
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  setInjectedPool(null);
  await closePool().catch(() => {});
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}

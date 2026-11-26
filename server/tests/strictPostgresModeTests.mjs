import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { newDb } from 'pg-mem';

const execFileAsync = promisify(execFile);

// Isolate data directory BEFORE importing server modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_strict_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'strict_mode_test_jwt_secret_2026_very_secure_key_12345';
process.env.AWLAD_QUIET_LOGS = 'true';
process.env.AWLAD_STRICT_HEALTH_TTL_MS = '0';

const { createApiApp, initializeServerRuntime } = await import('../app.js');
const {
  readJsonDatabase,
  writeJsonDatabase,
  readJsonSessions,
  readJsonAuditLogs,
  readJsonIdempotency,
} = await import('../db/jsonLedger.js');
const { setInjectedPool, isStrictPostgresMode, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache, DATABASE_UNAVAILABLE_CODE } = await import('../db/stores/mode.js');
const { rollbackMigration, runDataMigration } = await import('../db/migrator.js');
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { applyElectronRuntimeEnvironment } = require('../../electron/dataBootstrap.cjs');

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
  let text = '';
  try {
    text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function createToggleablePgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();

  let online = true;
  let disconnectErrorCode = 'ECONNREFUSED';
  let disconnectErrorMessage =
    'connect ECONNREFUSED 127.0.0.1:5432 postgresql://pgadmin:UltraSecret99@prod-db.internal:5432/awlad_selim';

  const makeDisconnectError = () => {
    const err = new Error(disconnectErrorMessage);
    err.code = disconnectErrorCode;
    return err;
  };

  return {
    setOnline(nextOnline, opts = {}) {
      online = nextOnline;
      if (opts.code) disconnectErrorCode = opts.code;
      if (opts.message) disconnectErrorMessage = opts.message;
    },
    async query(sql, params) {
      if (!online) throw makeDisconnectError();
      return memPool.query(sql, params);
    },
    async connect() {
      if (!online) throw makeDisconnectError();
      const client = await memPool.connect();
      return {
        async query(sql, params) {
          if (!online) throw makeDisconnectError();
          return client.query(sql, params);
        },
        release() {
          client.release();
        },
      };
    },
  };
}

function assertNoJsonLedgerFiles(contextLabel) {
  if (!fs.existsSync(tempDataDir)) return;
  const entries = fs.readdirSync(tempDataDir);
  assert.equal(
    entries.length,
    0,
    `${contextLabel}: Expected ZERO files/dirs in ${tempDataDir}, found: ${JSON.stringify(entries)}`
  );
}

function saveAndRestoreEnv(fn) {
  const snapshot = {
    NODE_ENV: process.env.NODE_ENV,
    AWLAD_REQUIRE_POSTGRES: process.env.AWLAD_REQUIRE_POSTGRES,
    AWLAD_ELECTRON: process.env.AWLAD_ELECTRON,
    DATABASE_URL: process.env.DATABASE_URL,
    PGHOST: process.env.PGHOST,
    BOOTSTRAP_ADMIN_SECRET: process.env.BOOTSTRAP_ADMIN_SECRET,
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(snapshot)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      setInjectedPool(null);
      resetPgModeCache();
    });
}

console.log('\n=== Production Strict Mode (PostgreSQL Exclusivity) Test Suite ===');

await saveAndRestoreEnv(async () => {
  await test('1. Strict mode flags: NODE_ENV=production enforces PG strictly even when AWLAD_ELECTRON=true', async () => {
    delete process.env.NODE_ENV;
    delete process.env.AWLAD_REQUIRE_POSTGRES;
    delete process.env.AWLAD_ELECTRON;
    assert.equal(isStrictPostgresMode(), false, 'dev default should not force strict mode');

    process.env.AWLAD_ELECTRON = 'true';
    assert.equal(isStrictPostgresMode(), false, 'Electron dev/local mode without NODE_ENV=production or packaged flag stays in local JSON mode');

    process.env.AWLAD_IS_PACKAGED = 'true';
    assert.equal(isStrictPostgresMode(), true, 'Packaged Electron automatically activates Strict PostgreSQL Mode even before NODE_ENV');
    delete process.env.AWLAD_IS_PACKAGED;

    process.env.NODE_ENV = 'production';
    assert.equal(isStrictPostgresMode(), true, 'NODE_ENV=production enforces strict mode even when AWLAD_ELECTRON=true');

    delete process.env.AWLAD_ELECTRON;
    assert.equal(isStrictPostgresMode(), true, 'NODE_ENV=production on server enables strict mode');

    process.env.AWLAD_REQUIRE_POSTGRES = 'true';
    assert.equal(isStrictPostgresMode(), true, 'Explicit AWLAD_REQUIRE_POSTGRES=true enforces strict mode');

    delete process.env.NODE_ENV;
    assert.equal(isStrictPostgresMode(), true, 'AWLAD_REQUIRE_POSTGRES=true works regardless of NODE_ENV');
  });

  await test('2. Startup refuses cleanly when Strict Mode is enabled without PostgreSQL config & creates ZERO JSON files', async () => {
    delete process.env.AWLAD_ELECTRON;
    delete process.env.DATABASE_URL;
    delete process.env.PGHOST;
    process.env.NODE_ENV = 'production';
    process.env.AWLAD_REQUIRE_POSTGRES = 'true';
    setInjectedPool(null);
    resetPgModeCache();

    await assert.rejects(
      () => initializeServerRuntime(),
      (err) => {
        assert.match(err.message, /Production Strict Mode/);
        assert.match(err.message, /PostgreSQL/);
        return true;
      }
    );
    assertNoJsonLedgerFiles('after unconfigured strict startup refusal');
  });

  await test('3. Startup refuses cleanly when PostgreSQL is unreachable, redacts credentials, and creates ZERO JSON files', async () => {
    delete process.env.AWLAD_ELECTRON;
    process.env.NODE_ENV = 'production';
    process.env.AWLAD_REQUIRE_POSTGRES = 'true';
    const deadPool = createToggleablePgMemPool();
    deadPool.setOnline(false);
    setInjectedPool(deadPool);
    resetPgModeCache();

    await assert.rejects(
      () => initializeServerRuntime(),
      (err) => {
        assert.match(err.message, /Production Strict Mode/);
        assert.ok(!err.message.includes('UltraSecret99'), 'DB password must NEVER appear in startup error');
        assert.ok(!err.message.includes('pgadmin:UltraSecret99'), 'DB credentials must NEVER appear in error');
        return true;
      }
    );
    assertNoJsonLedgerFiles('after unreachable PG strict startup refusal');
  });

  await test('4. Startup refuses cleanly when schema initialization fails in Strict Mode', async () => {
    delete process.env.AWLAD_ELECTRON;
    process.env.NODE_ENV = 'production';
    process.env.AWLAD_REQUIRE_POSTGRES = 'true';
    setInjectedPool({
      async connect() {
        return {
          async query() {
            return { rows: [{ server_time: new Date(), db_name: 'prod_db', pg_version: '16' }] };
          },
          release() {},
        };
      },
      async query() {
        throw new Error('permission denied for schema public postgresql://u:TopSecretPass@host/db');
      },
    });
    resetPgModeCache();

    await assert.rejects(
      () => initializeServerRuntime(),
      (err) => {
        assert.match(err.message, /Production Strict Mode/);
        assert.ok(!err.message.includes('TopSecretPass'), 'Password must be redacted on schema failure');
        return true;
      }
    );
    assertNoJsonLedgerFiles('after schema init failure');
  });

  await test('5. Production mode refuses Electron without PostgreSQL, while Electron local dev mode (no NODE_ENV=production) writes JSON Ledger cleanly', async () => {
    const strictElectronDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_electron_strict_'));
    const electronDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_electron_local_'));
    try {
      const strictProdChildScript = `
        import assert from 'node:assert/strict';
        import { initializeServerRuntime } from './server/app.js';
        import { isStrictPostgresMode } from './server/db/postgres.js';
        assert.equal(isStrictPostgresMode(), true);
        await assert.rejects(() => initializeServerRuntime(), /Production Strict Mode/);
      `;
      const strictProdEnv = {
        ...process.env,
        AWLAD_DATA_DIR: strictElectronDir,
        NODE_ENV: 'production',
        AWLAD_ELECTRON: 'true',
        AWLAD_QUIET_LOGS: 'true',
      };
      delete strictProdEnv.AWLAD_REQUIRE_POSTGRES;
      delete strictProdEnv.DATABASE_URL;
      delete strictProdEnv.PG_CONNECTION_STRING;
      delete strictProdEnv.PGHOST;
      delete strictProdEnv.DB_HOST;

      await execFileAsync(process.execPath, ['--input-type=module', '-e', strictProdChildScript], {
        cwd: process.cwd(),
        env: strictProdEnv,
      });
      assert.equal(fs.existsSync(path.join(strictElectronDir, 'database.json')), false, 'Production mode must NOT silently fall back to database.json even with AWLAD_ELECTRON=true');

      const childScript = `
        import assert from 'node:assert/strict';
        import http from 'node:http';
        import { createApiApp, initializeServerRuntime } from './server/app.js';
        import { isStrictPostgresMode } from './server/db/postgres.js';

        await initializeServerRuntime();
        assert.equal(isStrictPostgresMode(), false);

        const app = createApiApp();
        const srv = http.createServer(app);
        await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
        const { port } = srv.address();
        const url = 'http://127.0.0.1:' + port;

        const h = await fetch(url + '/api/health').then((r) => r.json());
        assert.equal(h.ok, true);
        assert.equal(h.strictMode, false);
        assert.equal(h.mode, 'local-json-ledger');

        const boot = await fetch(url + '/api/auth/bootstrap-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName: 'مدير إلكترون', username: 'electron_admin', password: 'ElectronPass!2026' }),
        });
        assert.equal(boot.status, 201);

        const login = await fetch(url + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'electron_admin', password: 'ElectronPass!2026' }),
        }).then((r) => r.json());
        assert.ok(login.accessToken);

        const cust = await fetch(url + '/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken },
          body: JSON.stringify({ code: 'EL-1', name: 'عميل محلي إلكترون', phone: '01033334444', address: 'محلي' }),
        });
        assert.equal(cust.status, 201);
        await new Promise((resolve) => srv.close(resolve));
      `;

      const childEnv = {
        ...process.env,
        AWLAD_DATA_DIR: electronDataDir,
        AWLAD_ELECTRON: 'true',
        AWLAD_QUIET_LOGS: 'true',
      };
      delete childEnv.NODE_ENV;
      delete childEnv.AWLAD_REQUIRE_POSTGRES;
      delete childEnv.DATABASE_URL;
      delete childEnv.PG_CONNECTION_STRING;
      delete childEnv.PGHOST;
      delete childEnv.DB_HOST;

      await execFileAsync(process.execPath, ['--input-type=module', '-e', childScript], {
        cwd: process.cwd(),
        env: childEnv,
      });

      assert.equal(fs.existsSync(path.join(electronDataDir, 'database.json')), true, 'Electron local mode without NODE_ENV=production writes database.json in its own dir');
      assertNoJsonLedgerFiles('strict tempDataDir remains untouched by Electron child test');
    } finally {
      fs.rmSync(strictElectronDir, { recursive: true, force: true });
      fs.rmSync(electronDataDir, { recursive: true, force: true });
    }
  });

  // Full Live Runtime Outage & Recovery Cycle in Strict Mode
  delete process.env.AWLAD_ELECTRON;
  delete process.env.AWLAD_REQUIRE_POSTGRES;
  process.env.NODE_ENV = 'production';
  process.env.BOOTSTRAP_ADMIN_SECRET = 'StrictPgBootstrapSecret#2026';

  const togglePool = createToggleablePgMemPool();
  setInjectedPool(togglePool);
  resetPgModeCache();

  await initializeServerRuntime();
  assertNoJsonLedgerFiles('after healthy PG strict runtime startup');

  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  let adminToken = '';
  let prodId = '';
  let custId = '';
  let whId = '';
  let cbId = '';
  let createdInvoiceId = '';
  let pairingTokenRaw = '';

  try {
    await test('6. Healthy Strict Mode server serves reads/writes strictly from PostgreSQL', async () => {
      const h = await req(baseUrl, 'GET', '/api/health');
      assert.equal(h.status, 200);
      assert.equal(h.json.ok, true);
      assert.equal(h.json.strictMode, true);
      assert.equal(h.json.databaseAvailable, true);
      assert.equal(h.json.mode, 'postgresql-enterprise');

      const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        headers: { 'x-bootstrap-secret': 'StrictPgBootstrapSecret#2026' },
        body: {
          fullName: 'مدير السيرفر السحابي',
          username: 'cloud_admin',
          password: 'CloudAdminPassword!2026',
        },
      });
      assert.equal(bootAdmin.status, 201);

      const loginAdmin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: {
          username: 'cloud_admin',
          password: 'CloudAdminPassword!2026',
        },
      });
      assert.equal(loginAdmin.status, 200);
      adminToken = loginAdmin.json.accessToken;
      assert.ok(adminToken);

      const bootData = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(bootData.status, 200);
      whId = bootData.json.data.warehouses[0].id;
      cbId = bootData.json.data.cashboxes[0].id;

      const pRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'SP-1',
          name: 'صنف اختبار سحابي',
          category: 'عام',
          baseUnit: 'قطعة',
          purchasePrice: 50,
          sellingPrice: 80,
          stockPerWarehouse: { [whId]: 50 },
          status: 'active',
        },
      });
      assert.equal(pRes.status, 201);
      prodId = pRes.json.product.id;

      const cRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: {
          code: 'SC-1',
          name: 'عميل السيرفر السحابي',
          phone: '01011223344',
          address: 'القاهرة',
        },
      });
      assert.equal(cRes.status, 201);
      custId = cRes.json.customer.id;

      const invRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        headers: { 'Idempotency-Key': 'strict-idem-invoice-001' },
        body: {
          customerId: custId,
          warehouseId: whId,
          cashboxId: cbId,
          paymentType: 'cash',
          paymentMethod: 'cash',
          paidAmount: 160,
          items: [
            {
              productId: prodId,
              unit: 'قطعة',
              unitFactor: 1,
              quantity: 2,
              unitPrice: 80,
              discount: 0,
            },
          ],
        },
      });
      assert.equal(invRes.status, 201);
      createdInvoiceId = invRes.json.invoice.id;

      const pairRes = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: {
          targetDeviceType: 'android',
          expiresInMinutes: 60,
          notes: 'Strict test token',
        },
      });
      assert.equal(pairRes.status, 201);
      pairingTokenRaw = pairRes.json.rawToken;
      assert.ok(pairingTokenRaw);

      assertNoJsonLedgerFiles('after active PG writes');
    });

    await test('7. Runtime PG disconnection -> /api/health & ALL DB routes + sync + pairing pages return 503 DATABASE_UNAVAILABLE with ZERO JSON fallback', async () => {
      togglePool.setOnline(false, { code: '57P01' });

      const healthDown = await req(baseUrl, 'GET', '/api/health');
      assert.equal(healthDown.status, 503);
      assert.equal(healthDown.json.ok, false);
      assert.equal(healthDown.json.code, DATABASE_UNAVAILABLE_CODE);
      assert.equal(healthDown.json.strictMode, true);
      assert.equal(healthDown.json.databaseAvailable, false);
      assert.equal(healthDown.json.mode, 'postgresql-strict-unavailable');
      assert.match(healthDown.json.error, /PostgreSQL/);
      assert.ok(!healthDown.text.includes('UltraSecret99'), 'Never leak PG credentials in 503 response');

      const protectedGetPaths = [
        '/api/customers',
        '/api/invoices',
        '/api/admin/bootstrap',
        '/api/admin/server-info',
        '/api/sync/pull',
      ];
      for (const p of protectedGetPaths) {
        const res = await req(baseUrl, 'GET', p, { token: adminToken });
        assert.equal(res.status, 503, `Expected 503 on GET ${p}, got ${res.status}`);
        assert.equal(res.json.code, DATABASE_UNAVAILABLE_CODE, `Expected DATABASE_UNAVAILABLE on GET ${p}`);
      }

      const publicGetPaths = [
        '/api/auth/status',
        '/api/connection/discovery',
        `/pair/${pairingTokenRaw}`,
        `/invite/${pairingTokenRaw}`,
      ];
      for (const p of publicGetPaths) {
        const res = await req(baseUrl, 'GET', p);
        assert.equal(res.status, 503, `Expected 503 on GET ${p}, got ${res.status}`);
        assert.equal(res.json.code, DATABASE_UNAVAILABLE_CODE, `Expected DATABASE_UNAVAILABLE on GET ${p}`);
      }

      const writeChecks = [
        ['POST', '/api/auth/login', { body: { username: 'cloud_admin', password: 'CloudAdminPassword!2026' } }],
        [
          'POST',
          '/api/invoices/sales',
          {
            token: adminToken,
            body: {
              customerId: custId,
              warehouseId: whId,
              cashboxId: cbId,
              paymentType: 'cash',
              paymentMethod: 'cash',
              paidAmount: 80,
              items: [{ productId: prodId, unit: 'قطعة', unitFactor: 1, quantity: 1, unitPrice: 80, discount: 0 }],
            },
          },
        ],
        [
          'POST',
          '/api/sync/push',
          {
            token: adminToken,
            body: {
              operations: [
                {
                  operationId: 'OP-OUTAGE-1',
                  operationType: 'create_customer',
                  entityType: 'customer',
                  payload: { code: 'SC-FAIL', name: 'عميل مرفوض أثناء الانقطاع', phone: '01099999999' },
                },
              ],
            },
          },
        ],
      ];
      for (const [m, p, opts] of writeChecks) {
        const res = await req(baseUrl, m, p, opts);
        assert.equal(res.status, 503, `Expected 503 on ${m} ${p}, got ${res.status}`);
        assert.equal(res.json.ok, false);
        assert.equal(res.json.code, DATABASE_UNAVAILABLE_CODE);
      }

      // Direct jsonLedger calls are also strictly blocked in Strict Mode
      assert.throws(() => readJsonDatabase(), { code: DATABASE_UNAVAILABLE_CODE });
      assert.throws(() => writeJsonDatabase({ customers: [] }), { code: DATABASE_UNAVAILABLE_CODE });
      assert.throws(() => readJsonSessions(), { code: DATABASE_UNAVAILABLE_CODE });
      assert.throws(() => readJsonAuditLogs(), { code: DATABASE_UNAVAILABLE_CODE });
      assert.throws(() => readJsonIdempotency(), { code: DATABASE_UNAVAILABLE_CODE });

      assertNoJsonLedgerFiles('during PostgreSQL outage');
    });

    await test('8. Automatic safe recovery when PostgreSQL returns + idempotent retry guarantees NO duplicates', async () => {
      togglePool.setOnline(true);

      const healthRecovered = await req(baseUrl, 'GET', '/api/health');
      assert.equal(healthRecovered.status, 200);
      assert.equal(healthRecovered.json.ok, true);
      assert.equal(healthRecovered.json.databaseAvailable, true);
      assert.equal(healthRecovered.json.mode, 'postgresql-enterprise');

      const custs = await req(baseUrl, 'GET', '/api/customers', { token: adminToken });
      assert.equal(custs.status, 200);
      assert.equal(custs.json.customers.length, 1);
      assert.equal(custs.json.customers[0].id, custId);

      const invsBefore = await req(baseUrl, 'GET', '/api/invoices', { token: adminToken });
      assert.equal(invsBefore.status, 200);
      assert.equal(invsBefore.json.invoices.length, 1);
      assert.equal(invsBefore.json.invoices[0].id, createdInvoiceId);

      // Idempotent invoice replay must NOT duplicate
      const invReplay = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        headers: { 'Idempotency-Key': 'strict-idem-invoice-001' },
        body: {
          customerId: custId,
          warehouseId: whId,
          cashboxId: cbId,
          paymentType: 'cash',
          paymentMethod: 'cash',
          paidAmount: 160,
          items: [
            {
              productId: prodId,
              unit: 'قطعة',
              unitFactor: 1,
              quantity: 2,
              unitPrice: 80,
              discount: 0,
            },
          ],
        },
      });
      assert.equal(invReplay.status, 201);
      assert.equal(invReplay.json.invoice.id, createdInvoiceId);

      const invsAfter = await req(baseUrl, 'GET', '/api/invoices', { token: adminToken });
      assert.equal(invsAfter.status, 200);
      assert.equal(invsAfter.json.invoices.length, 1, 'Idempotent replay must not duplicate invoice');

      // Retrying previously failed sync operation twice must execute exactly once
      const syncOp = {
        operationId: 'OP-OUTAGE-1',
        operationType: 'create_customer',
        entityType: 'customer',
        payload: { code: 'SC-RECOVERED', name: 'عميل بعد التعافي', phone: '01088887777' },
      };
      const push1 = await req(baseUrl, 'POST', '/api/sync/push', {
        token: adminToken,
        body: { operations: [syncOp] },
      });
      assert.equal(push1.status, 200);
      assert.equal(push1.json.results[0].status, 'synced');

      const push2 = await req(baseUrl, 'POST', '/api/sync/push', {
        token: adminToken,
        body: { operations: [syncOp] },
      });
      assert.equal(push2.status, 200);
      assert.equal(push2.json.results[0].status, 'synced');

      const custsAfter = await req(baseUrl, 'GET', '/api/customers', { token: adminToken });
      assert.equal(custsAfter.status, 200);
      assert.equal(custsAfter.json.customers.length, 2, 'Sync operation replay must not duplicate customer');

      assertNoJsonLedgerFiles('after PostgreSQL recovery');
    });

    await test('9. Destructive migration rollback (JSON restore / PG table wipe) is blocked in Strict Mode', async () => {
      const rbRoute = await req(baseUrl, 'POST', '/api/admin/migration/rollback', {
        token: adminToken,
        body: {},
      });
      assert.equal(rbRoute.status, 403);
      assert.equal(rbRoute.json.code, 'STRICT_MODE_DESTRUCTIVE_BLOCKED');

      const rbFn = await rollbackMigration(null, 'اختبار صارم', togglePool);
      assert.equal(rbFn.success, false);
      assert.equal(rbFn.code, 'STRICT_MODE_DESTRUCTIVE_BLOCKED');

      // Verify PG data untouched and ZERO JSON files created
      const custsStillThere = await req(baseUrl, 'GET', '/api/customers', { token: adminToken });
      assert.equal(custsStillThere.status, 200);
      assert.equal(custsStillThere.json.customers.length, 2);
      assertNoJsonLedgerFiles('after blocked migration rollback');
    });

    await test('10. Sudden PG drop within cached health TTL (>0ms) still returns 503 on API & HTML/JSON pairing pages & invalidates cache', async () => {
      const prevTtl = process.env.AWLAD_STRICT_HEALTH_TTL_MS;
      process.env.AWLAD_STRICT_HEALTH_TTL_MS = '5000';
      try {
        // Warm health cache while PG is online
        const warm = await req(baseUrl, 'GET', '/api/customers', { token: adminToken });
        assert.equal(warm.status, 200);

        // Suddenly drop PG BEFORE 5000ms cache expires
        togglePool.setOnline(false, { code: '57P01' });

        // API route hits PG query inside cached TTL -> errorMiddleware / withTransaction must return 503 DATABASE_UNAVAILABLE
        const suddenApi = await req(baseUrl, 'GET', '/api/customers', { token: adminToken });
        assert.equal(suddenApi.status, 503);
        assert.equal(suddenApi.json.code, DATABASE_UNAVAILABLE_CODE);

        // Create a fresh cache hit briefly then drop again to verify /pair/:token HTML + JSON
        togglePool.setOnline(true);
        const warm2 = await req(baseUrl, 'GET', '/api/customers', { token: adminToken });
        assert.equal(warm2.status, 200);

        togglePool.setOnline(false, { code: 'ECONNREFUSED' });
        const pairHtml = await req(baseUrl, 'GET', `/pair/${pairingTokenRaw}`, {
          headers: { Accept: 'text/html' },
        });
        assert.equal(pairHtml.status, 503);
        assert.match(pairHtml.text, /PostgreSQL/);

        const pairJson = await req(baseUrl, 'GET', `/invite/${pairingTokenRaw}?format=json`);
        assert.equal(pairJson.status, 503);
        assert.equal(pairJson.json.code, DATABASE_UNAVAILABLE_CODE);
      } finally {
        togglePool.setOnline(true);
        if (prevTtl === undefined) delete process.env.AWLAD_STRICT_HEALTH_TTL_MS;
        else process.env.AWLAD_STRICT_HEALTH_TTL_MS = prevTtl;
      }
    });

    await test('11. Idempotent customer payment fails cleanly on 503 outage without partial balance change and executes once on recovery', async () => {
      const bootBefore = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const cbBefore = Number(bootBefore.cashboxes.find((c) => c.id === cbId).currentBalance || 0);
      const custBefore = Number(bootBefore.customers.find((c) => c.id === custId).currentBalance || 0);

      togglePool.setOnline(false, { code: '57P01' });
      const failPay = await req(baseUrl, 'POST', `/api/customers/${custId}/payment`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'strict-cust-pay-1' },
        body: { amount: 50, cashboxId: cbId, paymentMethod: 'cash', notes: 'تحصيل أثناء الانقطاع' },
      });
      assert.equal(failPay.status, 503);
      assert.equal(failPay.json.code, DATABASE_UNAVAILABLE_CODE);

      togglePool.setOnline(true);
      const bootAfterFail = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(Number(bootAfterFail.cashboxes.find((c) => c.id === cbId).currentBalance || 0), cbBefore);
      assert.equal(Number(bootAfterFail.customers.find((c) => c.id === custId).currentBalance || 0), custBefore);

      // User retries with same Idempotency-Key twice after PG recovery -> executes exactly once
      const okPay1 = await req(baseUrl, 'POST', `/api/customers/${custId}/payment`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'strict-cust-pay-1' },
        body: { amount: 50, cashboxId: cbId, paymentMethod: 'cash', notes: 'تحصيل بعد التعافي' },
      });
      assert.equal(okPay1.status, 200);

      const okPay2 = await req(baseUrl, 'POST', `/api/customers/${custId}/payment`, {
        token: adminToken,
        headers: { 'Idempotency-Key': 'strict-cust-pay-1' },
        body: { amount: 50, cashboxId: cbId, paymentMethod: 'cash', notes: 'تحصيل بعد التعافي' },
      });
      assert.equal(okPay2.status, 200);
      assert.equal(okPay2.json.deduplicated, true);

      const bootFinal = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(Number(bootFinal.cashboxes.find((c) => c.id === cbId).currentBalance || 0), cbBefore + 50);
      assert.equal(Number(bootFinal.customers.find((c) => c.id === custId).currentBalance || 0), custBefore - 50);
      assertNoJsonLedgerFiles('after idempotent customer payment recovery');
    });

    await test('12. Purchases, invoice payments, supplier payments & cash operations reject with 503 on outage and recover idempotently with ZERO duplicates', async () => {
      // Prepare a supplier and a partial sales invoice while PG is online
      const suppRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: { code: 'SUP-STRICT-1', name: 'مورد الاختبار الصارم', phone: '01055556666', openingBalance: 0 },
      });
      assert.equal(suppRes.status, 201);
      const supplierId = suppRes.json.supplier.id;

      const partialSaleRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        headers: { 'Idempotency-Key': 'strict-partial-sale-1' },
        body: {
          customerId: custId,
          warehouseId: whId,
          cashboxId: cbId,
          paymentType: 'partial',
          paymentMethod: 'cash',
          paidAmount: 40,
          items: [{ productId: prodId, unit: 'قطعة', unitFactor: 1, quantity: 2, unitPrice: 80, discount: 0 }],
        },
      });
      assert.equal(partialSaleRes.status, 201);
      const partialInvId = partialSaleRes.json.invoice.id;

      const bootPre = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const invCountPre = bootPre.invoices.length;
      const cbPre = Number(bootPre.cashboxes.find((c) => c.id === cbId).currentBalance || 0);
      const custPre = Number(bootPre.customers.find((c) => c.id === custId).currentBalance || 0);
      const suppPre = Number(bootPre.suppliers.find((s) => s.id === supplierId).currentBalance || 0);

      // Simulate PostgreSQL outage
      togglePool.setOnline(false, { code: '57P01' });

      const outageOps = [
        [
          'POST',
          '/api/invoices/purchase',
          {
            token: adminToken,
            headers: { 'Idempotency-Key': 'strict-purch-outage-1' },
            body: {
              supplierId,
              warehouseId: whId,
              cashboxId: cbId,
              paymentType: 'credit',
              paymentMethod: 'cash',
              paidAmount: 0,
              items: [{ productId: prodId, unit: 'قطعة', unitFactor: 1, quantity: 3, unitPrice: 50, discount: 0 }],
            },
          },
        ],
        [
          'POST',
          `/api/invoices/${partialInvId}/payments`,
          {
            token: adminToken,
            headers: { 'Idempotency-Key': 'strict-invpay-outage-1' },
            body: { amount: 60, cashboxId: cbId, paymentMethod: 'cash', notes: 'سداد فاتورة أثناء الانقطاع' },
          },
        ],
        [
          'POST',
          '/api/admin/suppliers/payment',
          {
            token: adminToken,
            headers: { 'Idempotency-Key': 'strict-suppay-outage-1' },
            body: { supplierId, amount: 30, cashboxId: cbId, notes: 'سداد مورد أثناء الانقطاع' },
          },
        ],
        [
          'POST',
          '/api/admin/cash-operations',
          {
            token: adminToken,
            headers: { 'Idempotency-Key': 'strict-cashop-outage-1' },
            body: { type: 'cash_deposit', amount: 25, cashboxId: cbId, notes: 'إيداع أثناء الانقطاع' },
          },
        ],
      ];

      for (const [method, urlPath, opts] of outageOps) {
        const res = await req(baseUrl, method, urlPath, opts);
        assert.equal(res.status, 503, `Expected 503 on ${method} ${urlPath} during PG outage, got ${res.status}`);
        assert.equal(res.json.code, DATABASE_UNAVAILABLE_CODE);
      }
      assertNoJsonLedgerFiles('after financial write rejections during PG outage');

      // Recover PostgreSQL and verify state was NOT mutated during outage
      togglePool.setOnline(true);
      const bootMid = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootMid.invoices.length, invCountPre);
      assert.equal(Number(bootMid.cashboxes.find((c) => c.id === cbId).currentBalance || 0), cbPre);
      assert.equal(Number(bootMid.customers.find((c) => c.id === custId).currentBalance || 0), custPre);
      assert.equal(Number(bootMid.suppliers.find((s) => s.id === supplierId).currentBalance || 0), suppPre);

      // Execute each operation twice with same Idempotency-Key -> zero duplicates
      const p1 = await req(baseUrl, outageOps[0][0], outageOps[0][1], outageOps[0][2]);
      const p2 = await req(baseUrl, outageOps[0][0], outageOps[0][1], outageOps[0][2]);
      assert.equal(p1.status, 201);
      assert.equal(p2.status, 201);
      assert.equal(p2.json.invoice.id, p1.json.invoice.id);

      const ip1 = await req(baseUrl, outageOps[1][0], outageOps[1][1], outageOps[1][2]);
      const ip2 = await req(baseUrl, outageOps[1][0], outageOps[1][1], outageOps[1][2]);
      assert.equal(ip1.status, 200);
      assert.equal(ip2.status, 200);
      assert.equal(ip2.json.invoice.paidAmount, ip1.json.invoice.paidAmount);

      const sp1 = await req(baseUrl, outageOps[2][0], outageOps[2][1], outageOps[2][2]);
      const sp2 = await req(baseUrl, outageOps[2][0], outageOps[2][1], outageOps[2][2]);
      assert.equal(sp1.status, 200);
      assert.equal(sp2.status, 200);
      assert.equal(sp2.json.deduplicated, true);

      const co1 = await req(baseUrl, outageOps[3][0], outageOps[3][1], outageOps[3][2]);
      const co2 = await req(baseUrl, outageOps[3][0], outageOps[3][1], outageOps[3][2]);
      assert.equal(co1.status, 201);
      assert.equal(co2.status, 200);
      assert.equal(co2.json.deduplicated, true);

      const bootEnd = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootEnd.invoices.length, invCountPre + 1, 'Purchase replay must not create 2 invoices');
      // Cashbox delta: +60 (invoice payment) -30 (supplier payment) +25 (cash deposit) = +55
      assert.equal(Number(bootEnd.cashboxes.find((c) => c.id === cbId).currentBalance || 0), cbPre + 55);
      // Customer delta: -60 (invoice payment)
      assert.equal(Number(bootEnd.customers.find((c) => c.id === custId).currentBalance || 0), custPre - 60);
      // Supplier delta: +150 (credit purchase 3*50) -30 (supplier payment) = +120
      assert.equal(Number(bootEnd.suppliers.find((s) => s.id === supplierId).currentBalance || 0), suppPre + 120);
      assertNoJsonLedgerFiles('after Test 12 recovery');
    });

    await test('13. Packaged Electron strict helper enforces NODE_ENV=production & AWLAD_REQUIRE_POSTGRES=true automatically', async () => {
      const packagedEnv = applyElectronRuntimeEnvironment({
        isPackaged: true,
        targetDataDir: tempDataDir,
        envFilePath: path.join(tempDataDir, '.env'),
        env: {},
      });
      assert.equal(packagedEnv.AWLAD_ELECTRON, 'true');
      assert.equal(packagedEnv.AWLAD_IS_PACKAGED, 'true');
      assert.equal(packagedEnv.NODE_ENV, 'production');
      assert.equal(packagedEnv.AWLAD_REQUIRE_POSTGRES, 'true');
      assert.equal(packagedEnv.AWLAD_DATA_DIR, tempDataDir);
      assertNoJsonLedgerFiles('after Test 13 packaged env check');
    });

    await test('14. Schema init omits retired employee HR tables/column, safely archives pre-existing HR rows, and preserves financials & customer order advances', async () => {
      // 14a: Fresh PG database never creates retired HR tables or employees.basic_salary, while keeping order_advance_payments
      const tblRes = await togglePool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const freshTables = new Set(tblRes.rows.map((r) => r.table_name));
      assert.equal(freshTables.has('advances_deductions'), false, 'advances_deductions must not exist');
      assert.equal(freshTables.has('attendance'), false, 'attendance must not exist');
      assert.equal(freshTables.has('payrolls'), false, 'payrolls must not exist');
      assert.equal(freshTables.has('employees'), true, 'employees table must be preserved');
      assert.equal(freshTables.has('order_advance_payments'), true, 'customer order_advance_payments must be preserved');

      const empColsRes = await togglePool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees'`
      );
      const freshEmpCols = new Set(empColsRes.rows.map((r) => r.column_name));
      assert.equal(freshEmpCols.has('basic_salary'), false, 'employees.basic_salary must not exist');
      assert.equal(freshEmpCols.has('user_id'), true, 'employees.user_id 1:1 link column must be preserved');

      // 14b: Simulate pre-existing legacy PG DB that still had retired HR tables + employees.basic_salary + live financials & customer order_advance_payments
      const legacyDb = newDb({ autoCreateForeignKeyIndices: true });
      const legacyPool = new (legacyDb.adapters.createPg().Pool)();
      await initializeSchema(legacyPool);

      // Temporarily add retired HR tables/column as in older deployments + insert legacy rows alongside real financials
      await legacyPool.query(`ALTER TABLE employees ADD COLUMN basic_salary NUMERIC(14,2) NOT NULL DEFAULT 0`);
      await legacyPool.query(`
        CREATE TABLE advances_deductions (
          id VARCHAR(64) PRIMARY KEY, employee_id VARCHAR(64) NOT NULL, employee_name TEXT NOT NULL,
          type VARCHAR(16) NOT NULL, amount NUMERIC(14,2) NOT NULL, date DATE NOT NULL,
          reason TEXT, cashbox_id VARCHAR(64), is_settled BOOLEAN NOT NULL DEFAULT FALSE,
          status VARCHAR(16) NOT NULL DEFAULT 'active', created_by VARCHAR(64) NOT NULL DEFAULT 'النظام',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE attendance (
          id VARCHAR(64) PRIMARY KEY, employee_id VARCHAR(64) NOT NULL, employee_name TEXT NOT NULL,
          date DATE NOT NULL, status VARCHAR(16) NOT NULL, check_in_time VARCHAR(16),
          check_out_time VARCHAR(16), delay_minutes INT NOT NULL DEFAULT 0, notes TEXT,
          created_by VARCHAR(64) NOT NULL DEFAULT 'النظام', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE payrolls (
          id VARCHAR(64) PRIMARY KEY, payroll_number VARCHAR(64) UNIQUE NOT NULL, month VARCHAR(16) NOT NULL,
          year INT, employee_id VARCHAR(64) NOT NULL, employee_name TEXT NOT NULL,
          basic_salary NUMERIC(14,2) NOT NULL, allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
          deductions NUMERIC(14,2) NOT NULL DEFAULT 0, advances NUMERIC(14,2) NOT NULL DEFAULT 0,
          net_salary NUMERIC(14,2) NOT NULL, payment_status VARCHAR(16) NOT NULL DEFAULT 'paid',
          payment_date DATE, cashbox_id VARCHAR(64), notes TEXT,
          created_by VARCHAR(64) NOT NULL DEFAULT 'النظام', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await legacyPool.query(
        `INSERT INTO cashboxes (id, name, type, opening_balance, current_balance, is_default)
         VALUES ('cb-leg', 'خزينة رئيسية', 'cashbox', 1000, 1500, TRUE)`
      );
      await legacyPool.query(
        `INSERT INTO customers (id, code, name, current_balance) VALUES ('cust-leg', 'C-LEG', 'عميل دفعة', -200)`
      );
      await legacyPool.query(
        `INSERT INTO users (id, full_name, username, password_hash, role, permissions)
         VALUES ('usr-leg', 'أحمد موظف', 'ahmed_emp', 'hash', 'sales', '{}'::jsonb)`
      );
      await legacyPool.query(
        `INSERT INTO employees (id, code, full_name, job_title, department, hire_date, basic_salary, user_id)
         VALUES ('emp-leg', 'E-LEG', 'أحمد موظف', 'مبيعات', 'المبيعات', '2026-01-01', 4500, 'usr-leg')`
      );
      await legacyPool.query(
        `UPDATE users SET employee_id = 'emp-leg' WHERE id = 'usr-leg'`
      );
      await legacyPool.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, cashbox_id, cashbox_name, amount, balance_after, description, created_by)
         VALUES ('ft-leg', 'FT-LEG-1', '2026-05-01', 'expense', 'cb-leg', 'خزينة رئيسية', 500, 1500, 'قيد مالي تاريخي', 'admin')`
      );
      await legacyPool.query(
        `INSERT INTO customer_item_orders (id, request_number, customer_id, customer_name, total_amount, advance_paid_amount, remaining_amount, status)
         VALUES ('ord-1', 'ORD-LEG-1', 'cust-leg', 'عميل دفعة', 500, 200, 300, 'approved')`
      );
      await legacyPool.query(
        `INSERT INTO order_advance_payments (id, payment_number, order_id, customer_id, cashbox_id, cashbox_name, payment_method, amount, date, created_by)
         VALUES ('oap-leg', 'ADV-1', 'ord-1', 'cust-leg', 'cb-leg', 'خزينة رئيسية', 'cash', 200, '2026-05-01', 'admin')`
      );
      await legacyPool.query(
        `INSERT INTO payrolls (id, payroll_number, month, year, employee_id, employee_name, basic_salary, net_salary, cashbox_id)
         VALUES ('pay-1', 'PAY-001', '05', 2026, 'emp-leg', 'أحمد موظف', 4500, 4500, 'cb-leg')`
      );
      await legacyPool.query(
        `INSERT INTO advances_deductions (id, employee_id, employee_name, type, amount, date)
         VALUES ('adv-1', 'emp-leg', 'أحمد موظف', 'advance', 300, '2026-05-02')`
      );
      await legacyPool.query(
        `INSERT INTO attendance (id, employee_id, employee_name, date, status)
         VALUES ('att-1', 'emp-leg', 'أحمد موظف', '2026-05-03', 'present')`
      );

      // Run safe schema upgrade on pre-existing DB
      const upgradeRes = await initializeSchema(legacyPool);
      assert.equal(upgradeRes.success, true, upgradeRes.error);

      // Retired tables & column must be gone cleanly
      const postTbls = new Set(
        (await legacyPool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name)
      );
      assert.equal(postTbls.has('payrolls'), false);
      assert.equal(postTbls.has('attendance'), false);
      assert.equal(postTbls.has('advances_deductions'), false);
      const postEmpCols = new Set(
        (await legacyPool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees'`)).rows.map((r) => r.column_name)
      );
      assert.equal(postEmpCols.has('basic_salary'), false);

      // Historical data & 1:1 link & customer advances must be 100% preserved + legacy HR archived in audit_logs
      const empKept = await legacyPool.query(`SELECT id, user_id, full_name FROM employees WHERE id = 'emp-leg'`);
      assert.equal(empKept.rows.length, 1);
      assert.equal(empKept.rows[0].user_id, 'usr-leg');
      const ftKept = await legacyPool.query(`SELECT id, amount FROM financial_transactions WHERE id = 'ft-leg'`);
      assert.equal(Number(ftKept.rows[0].amount), 500);
      const oapKept = await legacyPool.query(`SELECT id, amount FROM order_advance_payments WHERE id = 'oap-leg'`);
      assert.equal(Number(oapKept.rows[0].amount), 200);
      const archiveAudit = await legacyPool.query(
        `SELECT record_id, old_values FROM audit_logs WHERE record_id = 'schema-v15-hr-cleanup'`
      );
      assert.equal(archiveAudit.rows.length, 1, 'Legacy HR rows must be archived into audit_logs before dropping tables');
      assert.equal(archiveAudit.rows[0].old_values.payrollsCount, 1);
      assert.equal(archiveAudit.rows[0].old_values.advancesDeductionsCount, 1);
      assert.equal(archiveAudit.rows[0].old_values.attendanceCount, 1);
      assert.equal(archiveAudit.rows[0].old_values.employeesWithBasicSalaryCount, 1);

      // 14c: Legacy JSON->PG migration via runDataMigration archives HR arrays without creating retired tables
      const migDb = newDb({ autoCreateForeignKeyIndices: true });
      const migPool = new (migDb.adapters.createPg().Pool)();
      await initializeSchema(migPool);
      const migRes = await runDataMigration(
        {
          warehouses: [{ id: 'wh-1', name: 'رئيسي', code: 'W1', isDefault: true, status: 'active' }],
          cashboxes: [{ id: 'cb-1', name: 'خزينة', type: 'cashbox', openingBalance: 0, currentBalance: 900, isDefault: true }],
          customers: [{ id: 'c-1', code: 'C1', name: 'عميل', currentBalance: 0 }],
          customerItemOrders: [{ id: 'ord-10', requestNumber: 'ORD-10', customerId: 'c-1', customerName: 'عميل', totalAmount: 500, advancePaidAmount: 250, remainingAmount: 250, status: 'approved' }],
          employees: [{ id: 'e-1', code: 'E1', name: 'موظف قديم', jobTitle: 'محاسب', hireDate: '2026-01-01', basicSalary: 3200 }],
          payrolls: [{ id: 'p-old', netSalary: 3200 }],
          attendance: [{ id: 'a-old', status: 'present' }],
          advancesDeductions: [{ id: 'adv-old', amount: 150 }],
          orderAdvancePayments: [{ id: 'oap-1', paymentNumber: 'ADV-10', orderId: 'ord-10', customerId: 'c-1', cashboxId: 'cb-1', amount: 250, date: '2026-05-01' }],
          financialTransactions: [{ id: 'ft-1', transactionNumber: 'FT-1', date: '2026-05-01', type: 'cash_deposit', cashboxId: 'cb-1', cashboxName: 'خزينة', amount: 900, balanceAfter: 900 }],
        },
        'tester',
        { targetPool: migPool, skipBackupFile: true, skipLogFile: true }
      );
      assert.equal(migRes.success, true, migRes.error);
      const migAudit = await migPool.query(`SELECT old_values FROM audit_logs WHERE module = 'الموظفون'`);
      assert.equal(migAudit.rows.length, 1);
      assert.equal(migAudit.rows[0].old_values.payrollsCount, 1);
      const migAdv = await migPool.query(`SELECT amount FROM order_advance_payments WHERE id = 'oap-1'`);
      assert.equal(Number(migAdv.rows[0].amount), 250);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

fs.rmSync(tempDataDir, { recursive: true, force: true });
console.log(`\nALL STRICT POSTGRES MODE TESTS PASSED (${passed} assertions groups)!`);

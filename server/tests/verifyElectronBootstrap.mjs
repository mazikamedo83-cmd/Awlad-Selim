import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { prepareElectronDataDirectory, inspectDatabaseFile, applyElectronRuntimeEnvironment } = require('../../electron/dataBootstrap.cjs');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_electron_verify_'));
const mockAppData = path.join(sandbox, 'AppData', 'Roaming');
const mockLegacyData = path.join(sandbox, 'legacy_app', 'server', 'data');
fs.mkdirSync(mockLegacyData, { recursive: true });

// Populate realistic legacy data (does NOT touch real server/data)
const sampleLegacyDb = {
  users: [
    {
      id: 'u-legacy-1',
      fullName: 'المدير الأصلي',
      username: 'owner_test',
      passwordHash: '$2b$10$dummyhashvaluepreserved12345678901234567890123456',
      role: 'admin',
      isActive: true,
      permissions: { canManageSettings: true },
    },
  ],
  products: [{ id: 'p-1', code: 'P01', name: 'سكر أبيض 1 كجم', sellingPrice: 35 }],
  customers: [{ id: 'c-1', code: 'C01', name: 'سوبر ماركت النور', currentBalance: 1500 }],
  suppliers: [],
  invoices: [{ id: 'inv-1', invoiceNumber: 'INV-1001', grandTotal: 1500 }],
  cashboxes: [{ id: 'cb-main', name: 'الخزينة الرئيسية', currentBalance: 5000 }],
};
fs.writeFileSync(path.join(mockLegacyData, 'database.json'), JSON.stringify(sampleLegacyDb, null, 2));
fs.writeFileSync(path.join(mockLegacyData, 'migration_logs.json'), JSON.stringify([{ id: 'MIG-1' }]));

console.log('=== Electron Bootstrap & Persistence Verification ===');

// 1. Test verified transfer to %APPDATA%/AWLAD SELIM/data + pre-transfer backup
const res1 = prepareElectronDataDirectory({
  appDataDir: mockAppData,
  legacySourceDirs: [mockLegacyData],
});
assert.equal(res1.ok, true);
assert.equal(res1.targetDataDir, path.join(mockAppData, 'AWLAD SELIM', 'data'));
assert.ok(fs.existsSync(res1.backupPath), 'Backup folder must be created before transfer');
assert.ok(fs.existsSync(path.join(res1.backupPath, 'MANIFEST.json')), 'Backup MANIFEST.json must exist');
assert.equal(res1.databaseState.counts.users, 1);
assert.equal(res1.databaseState.counts.products, 1);
assert.equal(res1.databaseState.counts.customers, 1);
assert.equal(res1.databaseState.counts.invoices, 1);
console.log('  [PASS] 1. Legacy data transferred with SHA-256 & record-count verification + pre-transfer backup');

// 2. Test protection against overwriting existing target database with another/empty DB
const newerTargetDb = structuredClone(sampleLegacyDb);
newerTargetDb.products.push({ id: 'p-2', code: 'P02', name: 'أرز مصري 1 كجم', sellingPrice: 40 });
fs.writeFileSync(path.join(res1.targetDataDir, 'database.json'), JSON.stringify(newerTargetDb, null, 2));

const emptyLegacyDir = path.join(sandbox, 'empty_legacy');
fs.mkdirSync(emptyLegacyDir, { recursive: true });
fs.writeFileSync(path.join(emptyLegacyDir, 'database.json'), JSON.stringify({ users: [], products: [] }));

const res2 = prepareElectronDataDirectory({
  appDataDir: mockAppData,
  legacySourceDirs: [emptyLegacyDir, mockLegacyData],
});
assert.equal(res2.existingTargetPreserved, true);
assert.equal(res2.databaseState.counts.products, 2, 'Existing target database must NEVER be overwritten');
console.log('  [PASS] 2. Existing non-empty database in %APPDATA% preserved untouched against empty/older source');

// 3. Test real embedded Express server startup, offline static dist serving, write persistence across restart & clean shutdown
const distIndexPath = path.join(process.cwd(), 'dist', 'index.html');
if (!fs.existsSync(distIndexPath)) {
  const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) {
    throw new Error(`Missing dist/index.html (${distIndexPath}) and Vite CLI (${viteBin}) to build it`);
  }
  console.log('  [INFO] dist/index.html not found; building production bundle via Vite before offline server check...');
  const viteBuild = spawnSync(process.execPath, [viteBin, 'build'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(
    viteBuild.status,
    0,
    `Vite production build failed before Electron bootstrap verification:\n${viteBuild.stderr}\n${viteBuild.stdout}`
  );
  assert.ok(fs.existsSync(distIndexPath), `Expected dist/index.html after Vite build at ${distIndexPath}`);
}

const appData2 = path.join(sandbox, 'AppData2', 'Roaming');
const prep2 = prepareElectronDataDirectory({ appDataDir: appData2, legacySourceDirs: [] });

// Run child process #1: startStandaloneServer, verify dist HTML + bootstrap admin + create product + shutdown cleanly
const childScript1 = `
  process.env.AWLAD_DATA_DIR = ${JSON.stringify(prep2.targetDataDir)};
  process.env.AWLAD_ELECTRON = 'true';
  import('./server/index.js').then(async ({ startStandaloneServer }) => {
    const srv = await startStandaloneServer({ port: 0, host: '0.0.0.0' });
    const htmlRes = await fetch(srv.localUrl + '/');
    if (htmlRes.status !== 200) throw new Error('Offline dist/index.html failed: ' + htmlRes.status);
    const cacheCtrl = htmlRes.headers.get('cache-control') || '';
    if (!cacheCtrl.includes('no-store')) {
      throw new Error('Expected Cache-Control no-store on index.html, got: ' + cacheCtrl);
    }
    const htmlText = await htmlRes.text();
    const scriptMatch = htmlText.match(new RegExp('src="(/assets/index-[^"]+\\\\.js)"'));
    if (!scriptMatch) throw new Error('Missing compiled JS entry in dist/index.html');
    const jsRes = await fetch(srv.localUrl + scriptMatch[1]);
    if (jsRes.status !== 200) throw new Error('Compiled JS bundle failed: ' + jsRes.status);
    const jsText = await jsRes.text();
    if (!jsText.includes('v3.0.0')) {
      throw new Error('Served JS bundle does not contain current version v3.0.0');
    }
    const bootRes = await fetch(srv.localUrl + '/api/auth/bootstrap-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'مدير الاختبار', username: 'admin_e2e', password: 'StrongPassword#2026' })
    });
    const bootJson = await bootRes.json();
    if (!bootJson.ok || !bootJson.user) throw new Error('Bootstrap failed: ' + JSON.stringify(bootJson));
    const loginRes = await fetch(srv.localUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin_e2e', password: 'StrongPassword#2026' })
    });
    const loginJson = await loginRes.json();
    if (!loginJson.ok || !loginJson.accessToken) throw new Error('Login failed: ' + JSON.stringify(loginJson));
    const infoRes = await fetch(srv.localUrl + '/api/admin/server-info', {
      headers: { Authorization: 'Bearer ' + loginJson.accessToken }
    });
    const infoJson = await infoRes.json();
    if (!infoJson.ok || infoJson.dataDir !== ${JSON.stringify(prep2.targetDataDir)}) {
      throw new Error('Unexpected server-info: ' + JSON.stringify(infoJson));
    }
    const prodRes = await fetch(srv.localUrl + '/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + loginJson.accessToken },
      body: JSON.stringify({ code: 'E2E-1', name: 'منتج اختبار الاستمرارية', baseUnit: 'كرتونة', purchasePrice: 100, sellingPrice: 120 })
    });
    const prodJson = await prodRes.json();
    if (!prodJson.ok) throw new Error('Create product failed: ' + JSON.stringify(prodJson));
    await srv.close();
    console.log('CHILD1_OK:' + JSON.stringify({ port: srv.port, lanCount: infoJson.lanUrls.length }));
  });
`;

const run1 = spawnSync(process.execPath, ['--input-type=module', '-e', childScript1], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
assert.equal(run1.status, 0, `Child 1 failed:\n${run1.stderr}\n${run1.stdout}`);
assert.ok(run1.stdout.includes('CHILD1_OK:'), `Missing CHILD1_OK: ${run1.stdout}`);
console.log('  [PASS] 3. Embedded server serves dist/ offline, exposes LAN info, writes data, and closes cleanly');

// Run child process #2 (simulating app restart): verify saved admin & data persist across restart
const dbInspection = inspectDatabaseFile(path.join(prep2.targetDataDir, 'database.json'));
assert.equal(dbInspection.valid, true);
assert.equal(dbInspection.counts.users, 1);

const childScript2 = `
  process.env.AWLAD_DATA_DIR = ${JSON.stringify(prep2.targetDataDir)};
  process.env.AWLAD_ELECTRON = 'true';
  import('./server/index.js').then(async ({ startStandaloneServer }) => {
    const srv = await startStandaloneServer({ port: 0, host: '0.0.0.0' });
    const statusRes = await fetch(srv.localUrl + '/api/auth/status');
    const statusJson = await statusRes.json();
    if (statusJson.needsAdminSetup !== false || statusJson.usersCount !== 1) {
      throw new Error('Data did not persist across restart: ' + JSON.stringify(statusJson));
    }
    const loginRes = await fetch(srv.localUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin_e2e', password: 'StrongPassword#2026' })
    });
    const loginJson = await loginRes.json();
    if (!loginJson.ok || !loginJson.accessToken) throw new Error('Restart login failed: ' + JSON.stringify(loginJson));
    const prodsRes = await fetch(srv.localUrl + '/api/products', {
      headers: { Authorization: 'Bearer ' + loginJson.accessToken }
    });
    const prodsJson = await prodsRes.json();
    if (!prodsJson.ok || !prodsJson.products?.some((p) => p.code === 'E2E-1')) {
      throw new Error('Product did not persist across restart: ' + JSON.stringify(prodsJson));
    }
    await srv.close();
    console.log('CHILD2_OK');
  });
`;

const run2 = spawnSync(process.execPath, ['--input-type=module', '-e', childScript2], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
assert.equal(run2.status, 0, `Child 2 failed:\n${run2.stderr}\n${run2.stdout}`);
assert.ok(run2.stdout.includes('CHILD2_OK'), `Missing CHILD2_OK: ${run2.stdout}`);
console.log('  [PASS] 4. Fresh restart loads persisted database from %APPDATA% path and authenticates saved user');

// 5. Packaged Windows Electron automatically enforces Strict PostgreSQL Mode, refuses JSON fallback when PG absent, and supports .env switching + clean PG customer install
const electronMainSource = fs.readFileSync(path.join(process.cwd(), 'electron/main.cjs'), 'utf8');
assert.ok(
  electronMainSource.includes('applyElectronRuntimeEnvironment({ isPackaged: app.isPackaged })'),
  'electron/main.cjs must enforce strict runtime environment BEFORE importing server/index.js'
);

const appDataPackagedStrict = path.join(sandbox, 'AppDataPackagedStrict', 'Roaming');
const strictEnvCandidate = path.join(sandbox, 'packaged_customer.env');
fs.writeFileSync(strictEnvCandidate, 'PGHOST=192.168.1.50\nPGPORT=5432\nPGDATABASE=awlad_selim\n', 'utf8');
const prepPackagedStrict = prepareElectronDataDirectory({
  appDataDir: appDataPackagedStrict,
  legacySourceDirs: [],
  envFileCandidates: [strictEnvCandidate],
});
assert.ok(prepPackagedStrict.envFilePath && fs.existsSync(prepPackagedStrict.envFilePath), 'Packaged Electron must copy/preserve .env for localhost/LAN/VPS switching');

const simulatedMainEnv = {};
applyElectronRuntimeEnvironment({
  isPackaged: true,
  targetDataDir: prepPackagedStrict.targetDataDir,
  envFilePath: prepPackagedStrict.envFilePath,
  env: simulatedMainEnv,
});
assert.equal(simulatedMainEnv.NODE_ENV, 'production');
assert.equal(simulatedMainEnv.AWLAD_REQUIRE_POSTGRES, 'true');
assert.equal(simulatedMainEnv.AWLAD_ELECTRON, 'true');
assert.equal(simulatedMainEnv.AWLAD_IS_PACKAGED, 'true');

// 5a: Packaged Electron WITHOUT reachable PostgreSQL (even when NODE_ENV & AWLAD_REQUIRE_POSTGRES are omitted) MUST fail and create ZERO database.json
const appDataStrictNoPg = path.join(sandbox, 'AppDataStrictNoPg', 'Roaming');
const prepStrictNoPg = prepareElectronDataDirectory({ appDataDir: appDataStrictNoPg, legacySourceDirs: [], envFileCandidates: [] });
const childPackagedNoPg = `
  import assert from 'node:assert/strict';
  process.env.AWLAD_DATA_DIR = ${JSON.stringify(prepStrictNoPg.targetDataDir)};
  process.env.AWLAD_ELECTRON = 'true';
  process.env.AWLAD_IS_PACKAGED = 'true';
  delete process.env.NODE_ENV;
  delete process.env.AWLAD_REQUIRE_POSTGRES;
  delete process.env.DATABASE_URL;
  delete process.env.PG_CONNECTION_STRING;
  delete process.env.PGHOST;
  delete process.env.DB_HOST;
  const { isStrictPostgresMode } = await import('./server/db/postgres.js');
  assert.equal(isStrictPostgresMode(), true, 'Packaged Electron must automatically enter Strict PostgreSQL Mode');
  const { startStandaloneServer } = await import('./server/index.js');
  await assert.rejects(
    () => startStandaloneServer({ port: 0, host: '127.0.0.1', envFiles: [] }),
    (err) => err?.code === 'DATABASE_UNAVAILABLE' && /Production Strict Mode/.test(err.message)
  );
  console.log('PACKAGED_NO_PG_REFUSED_OK');
`;
const runNoPg = spawnSync(process.execPath, ['--input-type=module', '-e', childPackagedNoPg], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
assert.equal(runNoPg.status, 0, `Packaged no-PG strict refusal failed:\n${runNoPg.stderr}\n${runNoPg.stdout}`);
assert.ok(runNoPg.stdout.includes('PACKAGED_NO_PG_REFUSED_OK'));
assert.equal(
  fs.existsSync(path.join(prepStrictNoPg.targetDataDir, 'database.json')),
  false,
  'Packaged Electron MUST NEVER create database.json when PostgreSQL is missing/unavailable'
);

// 5b: Packaged Windows clean customer install WITH PostgreSQL (pg-mem): zero auto-admin, 401 before setup, single bootstrap, 403 repeat bootstrap, zero database.json
const appDataClean = path.join(sandbox, 'AppDataClean', 'Roaming');
const prepClean = prepareElectronDataDirectory({ appDataDir: appDataClean, legacySourceDirs: [], envFileCandidates: [] });

const childClean = `
  import { newDb } from 'pg-mem';
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const MemPool = db.adapters.createPg().Pool;
  applyEnv: {
    process.env.NODE_ENV = 'production';
    process.env.AWLAD_REQUIRE_POSTGRES = 'true';
    process.env.AWLAD_ELECTRON = 'true';
    process.env.AWLAD_IS_PACKAGED = 'true';
    process.env.AWLAD_DATA_DIR = ${JSON.stringify(prepClean.targetDataDir)};
    process.env.JWT_SECRET = 'packaged_pg_customer_jwt_secret_key_2026_verified_12345';
    process.env.ADMIN_INITIAL_USERNAME = 'leaked_owner_env';
    process.env.ADMIN_INITIAL_PASSWORD = 'OwnerSecretEnvPassword#1';
  }
  const { setInjectedPool, isStrictPostgresMode } = await import('./server/db/postgres.js');
  setInjectedPool(new MemPool());
  if (!isStrictPostgresMode()) throw new Error('Expected strict mode active');
  const { startStandaloneServer } = await import('./server/index.js');
  const srv = await startStandaloneServer({ port: 0, host: '127.0.0.1', envFiles: [] });
  const statusRes = await fetch(srv.localUrl + '/api/auth/status');
  const statusJson = await statusRes.json();
  if (!statusJson.ok || statusJson.needsAdminSetup !== true || statusJson.usersCount !== 0 || !statusJson.installationId) {
    throw new Error('Clean packaged install must require admin setup and ignore env auto-admin: ' + JSON.stringify(statusJson));
  }
  const adminBlocked = await fetch(srv.localUrl + '/api/admin/bootstrap');
  if (adminBlocked.status !== 401) throw new Error('Expected 401 on /api/admin/bootstrap before login, got ' + adminBlocked.status);
  const dbBlocked = await fetch(srv.localUrl + '/api/database');
  if (dbBlocked.status !== 401) throw new Error('Expected 401 on /api/database before login, got ' + dbBlocked.status);

  const boot1 = await fetch(srv.localUrl + '/api/auth/bootstrap-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: 'شركة النور المستقلة',
      fullName: 'محمد محمود',
      username: 'customer_admin_1',
      password: 'CustomerStrong#2026',
    })
  });
  if (boot1.status !== 201) throw new Error('Expected 201 on initial customer bootstrap-admin, got ' + boot1.status);
  const boot2 = await fetch(srv.localUrl + '/api/auth/bootstrap-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Second Admin Attempt',
      username: 'attacker_admin',
      password: 'AttackerPassword#2026',
    })
  });
  if (boot2.status !== 403) throw new Error('Expected 403 on second bootstrap-admin, got ' + boot2.status);

  const envLogin = await fetch(srv.localUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'leaked_owner_env', password: 'OwnerSecretEnvPassword#1' })
  });
  if (envLogin.status !== 401) throw new Error('Env auto-admin must not exist in packaged customer mode, got ' + envLogin.status);

  const custLogin = await fetch(srv.localUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'customer_admin_1', password: 'CustomerStrong#2026' })
  });
  const custJson = await custLogin.json();
  if (!custJson.ok || !custJson.accessToken || custJson.installationId !== statusJson.installationId) {
    throw new Error('Customer admin login failed or installationId mismatch: ' + JSON.stringify(custJson));
  }
  const meRes = await fetch(srv.localUrl + '/api/auth/me', {
    headers: { Authorization: 'Bearer ' + custJson.accessToken }
  });
  const meJson = await meRes.json();
  if (!meJson.ok || meJson.installationId !== statusJson.installationId) {
    throw new Error('/api/auth/me did not verify installationId: ' + JSON.stringify(meJson));
  }
  await srv.close();
  console.log('CHILD_CLEAN_OK:' + JSON.stringify({ installationId: statusJson.installationId }));
`;

const runClean = spawnSync(process.execPath, ['--input-type=module', '-e', childClean], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
assert.equal(runClean.status, 0, `Clean packaged PG customer child failed:\n${runClean.stderr}\n${runClean.stdout}`);
const cleanMarker = runClean.stdout.split('\n').find((l) => l.startsWith('CHILD_CLEAN_OK:'));
assert.ok(cleanMarker, `Missing CHILD_CLEAN_OK: ${runClean.stdout}`);
assert.equal(fs.existsSync(path.join(prepClean.targetDataDir, 'database.json')), false, 'Packaged PG mode must create ZERO database.json');
console.log('  [PASS] 5. Packaged Windows Electron enters Strict PG Mode automatically, blocks JSON fallback, preserves .env switching & clean PG customer install');

// 6. Cross-company isolation: Token issued for Company A must be rejected (401) by Company B even if JWT_SECRET is shared
const appDataCompanyA = path.join(sandbox, 'AppDataCompanyA', 'Roaming');
const prepCompanyA = prepareElectronDataDirectory({ appDataDir: appDataCompanyA, legacySourceDirs: [], envFileCandidates: [] });
const appDataCompanyB = path.join(sandbox, 'AppDataCompanyB', 'Roaming');
const prepCompanyB = prepareElectronDataDirectory({ appDataDir: appDataCompanyB, legacySourceDirs: [], envFileCandidates: [] });
const sharedJwtSecret = 'shared_test_jwt_secret_for_cross_company_isolation_check_2026';

const childCompanyA = `
  process.env.AWLAD_DATA_DIR = ${JSON.stringify(prepCompanyA.targetDataDir)};
  process.env.JWT_SECRET = ${JSON.stringify(sharedJwtSecret)};
  delete process.env.AWLAD_IS_PACKAGED;
  import('./server/index.js').then(async ({ startStandaloneServer }) => {
    const srv = await startStandaloneServer({ port: 0, host: '127.0.0.1' });
    await fetch(srv.localUrl + '/api/auth/bootstrap-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: 'Company A', fullName: 'Admin A', username: 'customer_admin_1', password: 'CustomerStrong#2026' })
    });
    const loginRes = await fetch(srv.localUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'customer_admin_1', password: 'CustomerStrong#2026' })
    });
    const loginJson = await loginRes.json();
    await srv.close();
    console.log('COMP_A_TOKEN:' + JSON.stringify({ iid: loginJson.installationId, token: loginJson.accessToken, refresh: loginJson.refreshToken }));
  });
`;
const runA = spawnSync(process.execPath, ['--input-type=module', '-e', childCompanyA], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
assert.equal(runA.status, 0, `Company A child failed:\n${runA.stderr}\n${runA.stdout}`);
const compAMarker = runA.stdout.split('\n').find((l) => l.startsWith('COMP_A_TOKEN:'));
assert.ok(compAMarker, 'Missing COMP_A_TOKEN');
const compA = JSON.parse(compAMarker.slice('COMP_A_TOKEN:'.length));

const childCompanyB = `
  process.env.AWLAD_DATA_DIR = ${JSON.stringify(prepCompanyB.targetDataDir)};
  process.env.JWT_SECRET = ${JSON.stringify(sharedJwtSecret)};
  import('./server/index.js').then(async ({ startStandaloneServer }) => {
    const srv = await startStandaloneServer({ port: 0, host: '127.0.0.1' });
    const st = await (await fetch(srv.localUrl + '/api/auth/status')).json();
    if (!st.installationId || st.installationId === ${JSON.stringify(compA.iid)}) {
      throw new Error('Company B installationId collided with Company A');
    }
    const meCross = await fetch(srv.localUrl + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + ${JSON.stringify(compA.token)} }
    });
    if (meCross.status !== 401) {
      throw new Error('Expected 401 when using Company A token on Company B, got ' + meCross.status);
    }
    const dbCross = await fetch(srv.localUrl + '/api/database', {
      headers: { Authorization: 'Bearer ' + ${JSON.stringify(compA.token)} }
    });
    if (dbCross.status !== 401) {
      throw new Error('Expected 401 on /api/database across companies, got ' + dbCross.status);
    }
    const refCross = await fetch(srv.localUrl + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: ${JSON.stringify(compA.refresh)} })
    });
    if (refCross.status !== 401) {
      throw new Error('Expected 401 when refreshing Company A session on Company B, got ' + refCross.status);
    }
    await srv.close();
    console.log('COMP_B_ISOLATED_OK');
  });
`;
const runB = spawnSync(process.execPath, ['--input-type=module', '-e', childCompanyB], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
assert.equal(runB.status, 0, `Company B isolation child failed:\n${runB.stderr}\n${runB.stdout}`);
assert.ok(runB.stdout.includes('COMP_B_ISOLATED_OK'), `Missing COMP_B_ISOLATED_OK: ${runB.stdout}`);
console.log('  [PASS] 6. Cross-company JWT and refresh tokens rejected (401) across distinct installationIds');

// 7. Windows Customer Delivery ZIP CLI packaging, Setup-only exclusion of Portable/secrets, & archive integrity
const mockDistDir = path.join(sandbox, 'mock_dist_electron');
fs.mkdirSync(mockDistDir, { recursive: true });
fs.writeFileSync(path.join(mockDistDir, 'AWLAD-SELIM-Setup-3.0.0.exe'), Buffer.from('MZ-SETUP-INSTALLER-PAYLOAD-3.0.0'));
fs.writeFileSync(path.join(mockDistDir, 'AWLAD-SELIM-Portable-3.0.0.exe'), Buffer.from('MZ-PORTABLE-SHOULD-BE-EXCLUDED'));
fs.writeFileSync(path.join(mockDistDir, '.env'), 'JWT_SECRET=should_never_enter_zip');
fs.writeFileSync(path.join(mockDistDir, 'database.json'), '{"users":[{"username":"owner"}]}');

const cliPack = spawnSync(
  process.execPath,
  ['scripts/package-windows-customer-zip.mjs', `--dist-dir=${mockDistDir}`, '--version=3.0.0'],
  { cwd: process.cwd(), encoding: 'utf8' }
);
assert.equal(cliPack.status, 0, `Customer ZIP CLI failed:\n${cliPack.stderr}\n${cliPack.stdout}`);
const expectedZipPath = path.join(mockDistDir, 'AWLAD-SELIM-Windows-Customer-3.0.0.zip');
assert.ok(fs.existsSync(expectedZipPath) && fs.statSync(expectedZipPath).size > 0, 'Customer ZIP file must exist and be non-empty');

const cliVerify = spawnSync(
  process.execPath,
  ['scripts/package-windows-customer-zip.mjs', '--verify-only', `--dist-dir=${mockDistDir}`, '--version=3.0.0'],
  { cwd: process.cwd(), encoding: 'utf8' }
);
assert.equal(cliVerify.status, 0, `Customer ZIP --verify-only failed:\n${cliVerify.stderr}\n${cliVerify.stdout}`);
assert.ok(cliVerify.stdout.includes('01-Installer/AWLAD-SELIM-Setup-3.0.0.exe'));
assert.ok(cliVerify.stdout.includes('02-Instructions/'));
assert.ok(!cliVerify.stdout.includes('Portable'), 'Customer Setup ZIP must NOT include Portable EXE by default');

const { isExecutedAsCli, verifyCustomerZipArchive } = await import('../../scripts/package-windows-customer-zip.mjs');
const verifiedMeta = verifyCustomerZipArchive({
  zipPath: expectedZipPath,
  version: '3.0.0',
  expectedSetupPath: path.join(mockDistDir, 'AWLAD-SELIM-Setup-3.0.0.exe'),
  allowPortable: false,
});
assert.equal(verifiedMeta.entries.length, 4, 'Setup-only ZIP must contain exact 4 files: Setup EXE, 2 docs, SHA256SUMS.txt');
assert.equal(
  isExecutedAsCli(new URL('../../scripts/package-windows-customer-zip.mjs', import.meta.url).href, path.resolve('scripts/package-windows-customer-zip.mjs')),
  true,
  'isExecutedAsCli must return true across Windows/POSIX paths using fileURLToPath'
);

// Verify electron/main.cjs purges offline credentials & web storages on fresh customer install
const electronMainSrc = fs.readFileSync(path.join(process.cwd(), 'electron/main.cjs'), 'utf8');
assert.ok(electronMainSrc.includes('isFreshDatabase'));
assert.ok(electronMainSrc.includes("'offline_auth_session', 'offline_auth_creds'"));
assert.ok(electronMainSrc.includes("'localstorage', 'indexdb', 'cookies'"));
console.log('  [PASS] 7. Windows Customer ZIP CLI creates verified Setup-only archive (no Portable/secrets) & fresh-install auth purge verified');

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('ELECTRON VERIFICATION PASSED (7/7)');

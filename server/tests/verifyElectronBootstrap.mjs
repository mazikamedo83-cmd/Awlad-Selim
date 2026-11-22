import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { prepareElectronDataDirectory, inspectDatabaseFile } = require('../../electron/dataBootstrap.cjs');

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

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('ELECTRON VERIFICATION PASSED (4/4)');

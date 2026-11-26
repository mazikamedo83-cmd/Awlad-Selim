import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_mobile_send_receive_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'awlad_selim_mobile_send_receive_test_secret_2026_secure';

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

// Minimal browser globals for client-side syncEngine / api / localDb inside Node tsx
const memStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => (memStorage.has(k) ? memStorage.get(k)! : null),
  setItem: (k: string, v: string) => {
    memStorage.set(k, String(v));
  },
  removeItem: (k: string) => {
    memStorage.delete(k);
  },
  clear: () => {
    memStorage.clear();
  },
};

(globalThis as any).localStorage = localStorageMock;
(globalThis as any).window = {
  location: { origin: 'http://127.0.0.1', protocol: 'http:' },
  localStorage: localStorageMock,
  addEventListener() {},
  removeEventListener() {},
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, userAgent: 'AwladSelimMobileSendReceiveTest/3.0' },
  configurable: true,
});

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { resetAllRateLimitsForTests } = await import('../middleware/auth.js');

const { setConfiguredApiBaseUrl, saveStoredTokens } = await import('../../src/services/api.ts');
const { localDb } = await import('../../src/services/localDb.ts');
const {
  enqueueSyncOperation,
  getSyncRefreshStats,
  runSyncCycle,
  normalizeMandatorySendIntervalMinutes,
  formatCountdownMmSs,
  formatMobileSyncTimestamp,
  DEFAULT_MANDATORY_SEND_INTERVAL_MINUTES,
} = await import('../../src/services/syncEngine.ts');

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
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

async function req(baseUrl: string, method: string, urlPath: string, { token, body, headers = {} }: any = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function createPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();
  return {
    query: (sql: string, params?: any[]) => memPool.query(sql, params),
    async connect() {
      const client = await memPool.connect();
      return {
        query: (sql: string, params?: any[]) => client.query(sql, params),
        release: () => client.release(),
      };
    },
  };
}

console.log('\n=== AWLAD SELIM Mobile Send & Receive End-to-End Verification Suite ===');

resetAllRateLimitsForTests();
const pool = createPgMemPool();
setInjectedPool(pool);
resetPgModeCache();
await initializeSchema();

const app = createApiApp();
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as any).port;
const baseUrl = `http://127.0.0.1:${port}`;

let adminToken = '';
let repToken = '';
let repUserId = '';
let repId = '';
let repVanWhId = '';
let mainWhId = '';
let prodId = '';
let custId = '';
let firstSendAt = '';
let firstReceiveAt = '';

try {
  await test('0. Bootstrap Admin, Rep, Warehouse, Cashbox, Product & Customer on PostgreSQL (pg-mem)', async () => {
    const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
      body: {
        fullName: 'أحمد مدير أولاد سليم',
        username: 'admin_sr',
        password: 'AdminSR!2026',
        phone: '01000000101',
      },
    });
    assert.equal(bootAdmin.status, 201);
    adminToken = (
      await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin_sr', password: 'AdminSR!2026' },
      })
    ).json.accessToken;

    const regRep = await req(baseUrl, 'POST', '/api/auth/register', {
      body: {
        role: 'representative',
        fullName: 'سيد المندوب الميداني',
        username: 'rep_sr',
        password: 'RepSR!2026',
        phone: '01000000102',
        area: 'حلوان',
      },
    });
    assert.equal(regRep.status, 201);
    repToken = regRep.json.accessToken;
    repUserId = regRep.json.user.id;
    repId = regRep.json.representativeProfile.id;
    repVanWhId = regRep.json.representativeProfile.warehouseId;

    mainWhId = (
      await req(baseUrl, 'POST', '/api/inventory/warehouses', {
        token: adminToken,
        body: { name: 'المخزن الرئيسي', code: 'MAIN', isDefault: true },
      })
    ).json.warehouse.id;

    await req(baseUrl, 'POST', '/api/admin/cashboxes', {
      token: adminToken,
      body: { name: 'الخزينة الرئيسية', type: 'cash', openingBalance: 2000 },
    });

    prodId = (
      await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: 'شاي أولاد سليم 250 جم',
          code: 'PRD-TEA-250',
          category: 'مشروبات',
          baseUnit: 'علبة',
          purchasePrice: 40,
          sellingPrice: 60,
          stockPerWarehouse: { [mainWhId]: 150, [repVanWhId]: 40 },
        },
      })
    ).json.product.id;

    custId = (
      await req(baseUrl, 'POST', '/api/customers', {
        token: repToken,
        body: {
          name: 'محل الأصدقاء',
          shopName: 'سوبر ماركت الأصدقاء',
          phone: '01200001111',
          openingBalance: 100,
        },
      })
    ).json.customer.id;
  });

  await test('1 & 5. Mobile invoice + payment pending counter (0 -> 2 -> 0), progress 100%, synced to Windows PostgreSQL', async () => {
    setConfiguredApiBaseUrl(baseUrl);
    saveStoredTokens({ accessToken: repToken, refreshToken: 'rep-refresh-test' });
    await localDb.saveSyncQueue(repUserId, []);

    const beforeQueue = await localDb.listSyncQueue(repUserId);
    assert.equal(beforeQueue.length, 0);

    await enqueueSyncOperation({
      userId: repUserId,
      operationType: 'create_sales_invoice',
      entityType: 'invoice',
      localId: 'INV-MOB-001',
      summaryAr: 'فاتورة بيع موبايل 300 ج.م',
      holdForDispatchBatch: true,
      payload: {
        localId: 'INV-MOB-001',
        customerId: custId,
        warehouseId: repVanWhId,
        representativeId: repId,
        date: '2026-06-05',
        paymentType: 'partial',
        paidAmount: 120,
        discountTotal: 0,
        items: [
          { productId: prodId, unit: 'علبة', unitFactor: 1, quantity: 5, unitPrice: 60, discount: 0 },
        ],
      },
    });

    await enqueueSyncOperation({
      userId: repUserId,
      operationType: 'record_customer_payment',
      entityType: 'financial',
      localId: 'PAY-MOB-001',
      summaryAr: 'تحصيل نقدي 80 ج.م',
      holdForDispatchBatch: true,
      payload: {
        customerId: custId,
        invoiceId: 'INV-MOB-001',
        amount: 80,
        paymentMethod: 'cash',
        date: '2026-06-05',
      },
    });

    const pendingQueue = await localDb.listSyncQueue(repUserId);
    assert.equal(pendingQueue.filter((q) => q.status !== 'synced').length, 2);

    const progressPercentages: number[] = [];
    const sendOutcome = await runSyncCycle({
      userId: repUserId,
      forceAll: true,
      mode: 'send_only',
      includeHeldBatches: true,
      isMandatory: true,
      onProgress: (p) => progressPercentages.push(p.percent),
    });

    assert.equal(sendOutcome.ok, true);
    assert.equal(sendOutcome.syncedCount, 2);
    assert.equal(sendOutcome.failedCount, 0);
    assert.ok(progressPercentages.length >= 2 && progressPercentages[progressPercentages.length - 1] === 100);

    const afterQueue = await localDb.listSyncQueue(repUserId);
    assert.equal(afterQueue.filter((q) => q.status !== 'synced').length, 0);

    const stats = await getSyncRefreshStats(repUserId);
    assert.ok(stats.lastSendSummary?.ok && stats.lastSendSummary?.at);
    assert.equal(stats.lastSendSummary.count, 2);
    firstSendAt = stats.lastSendSummary.at;

    // Verify invoice & balance appear immediately on Windows PostgreSQL bootstrap
    const winBoot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    assert.equal(winBoot.invoices.length, 1);
    const syncedCust = winBoot.customers.find((c: any) => c.id === custId);
    // 100 opening + 300 invoice - 120 paid - 80 collection = 200
    assert.equal(Number(syncedCust.currentBalance), 200);
    const syncedProd = winBoot.products.find((p: any) => p.id === prodId);
    assert.equal(Number(syncedProd.stockPerWarehouse[repVanWhId]), 35);
  });

  await test('2 & 6. Windows product/setting update received on mobile updates local stats & count accurately', async () => {
    // Admin updates mandatory send interval on Windows + adds new product
    const setRes = await req(baseUrl, 'PUT', '/api/admin/settings', {
      token: adminToken,
      body: {
        extraSettings: {
          onlineSyncConfig: {
            autoSyncEnabled: true,
            syncIntervalSeconds: 30,
            mandatorySendEnabled: true,
            mandatorySendIntervalMinutes: 7,
          },
        },
      },
    });
    assert.equal(setRes.status, 200);

    const prod2 = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        name: 'سكر أبيض 1 كجم',
        code: 'PRD-SUGAR-1K',
        category: 'بقالة',
        baseUnit: 'كيس',
        purchasePrice: 28,
        sellingPrice: 35,
        stockPerWarehouse: { [mainWhId]: 100 },
      },
    });
    assert.equal(prod2.status, 201);

    const receiveProgress: number[] = [];
    const recvOutcome = await runSyncCycle({
      userId: repUserId,
      forceAll: true,
      mode: 'receive_only',
      onProgress: (p) => receiveProgress.push(p.percent),
    });

    assert.equal(recvOutcome.ok, true);
    assert.ok((recvOutcome.receivedCount || 0) >= 4, 'receivedCount must include products, customers, and invoices');
    assert.ok(receiveProgress.includes(100));
    assert.equal(
      recvOutcome.pullData?.settings?.extraSettings?.onlineSyncConfig?.mandatorySendIntervalMinutes,
      7
    );
    assert.ok(recvOutcome.pullData?.products?.some((p: any) => p.code === 'PRD-SUGAR-1K'));

    const stats = await getSyncRefreshStats(repUserId);
    assert.ok(stats.lastReceiveSummary?.ok && stats.lastReceiveSummary?.at);
    assert.equal(stats.lastReceiveSummary.count, recvOutcome.receivedCount);
    firstReceiveAt = stats.lastReceiveSummary.at;
  });

  await test('3 & 4. Disconnect preserves pending ops AND preserves previous successful Last Send/Receive timestamps; reconnect retries idempotently with zero duplicates', async () => {
    // Queue another mobile invoice while connection drops
    const opOffline = await enqueueSyncOperation({
      userId: repUserId,
      operationType: 'create_sales_invoice',
      entityType: 'invoice',
      localId: 'INV-MOB-002',
      summaryAr: 'فاتورة أثناء الانقطاع 180 ج.م',
      holdForDispatchBatch: true,
      payload: {
        localId: 'INV-MOB-002',
        customerId: custId,
        warehouseId: repVanWhId,
        representativeId: repId,
        date: '2026-06-05',
        paymentType: 'cash',
        paidAmount: 180,
        discountTotal: 0,
        items: [
          { productId: prodId, unit: 'علبة', unitFactor: 1, quantity: 3, unitPrice: 60, discount: 0 },
        ],
      },
    });

    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('Network disconnected during send');
    }) as any;

    try {
      const failedSend = await runSyncCycle({
        userId: repUserId,
        forceAll: true,
        mode: 'send_only',
        includeHeldBatches: true,
        isMandatory: true,
      });
      assert.equal(failedSend.ok, false);
      assert.equal(failedSend.serverReachable, false);

      const failedReceive = await runSyncCycle({
        userId: repUserId,
        forceAll: true,
        mode: 'receive_only',
      });
      assert.equal(failedReceive.ok, false);
      assert.equal(failedReceive.serverReachable, false);
    } finally {
      globalThis.fetch = prevFetch;
    }

    // Verify offline operation was NOT deleted and previous successful send/receive timestamps stayed intact!
    const qWhileOffline = await localDb.listSyncQueue(repUserId);
    const offlineItem = qWhileOffline.find((q) => q.operationId === opOffline.operationId);
    assert.equal(offlineItem?.status, 'pending');

    const statsAfterDrop = await getSyncRefreshStats(repUserId);
    assert.equal(statsAfterDrop.lastSendSummary?.at, firstSendAt, 'Last successful send timestamp must remain preserved when offline send fails');
    assert.equal(statsAfterDrop.lastSendSummary?.ok, false);
    assert.equal(statsAfterDrop.lastReceiveSummary?.at, firstReceiveAt, 'Last successful receive timestamp must remain preserved when offline receive fails');

    // Reconnect: verify retry succeeds and duplicate push is deduplicated
    const retryOutcome = await runSyncCycle({
      userId: repUserId,
      forceAll: true,
      mode: 'send_only',
      includeHeldBatches: true,
      isMandatory: true,
    });
    assert.equal(retryOutcome.ok, true);
    assert.equal(retryOutcome.syncedCount, 1);

    // Push exact same operation again directly to confirm zero duplicates in DB
    const dupPush = await req(baseUrl, 'POST', '/api/sync/push', {
      token: repToken,
      body: { operations: [opOffline] },
    });
    assert.equal(dupPush.status, 200);
    assert.equal(dupPush.json.results[0].status, 'synced');
    assert.equal(dupPush.json.results[0].deduplicated, true);

    const winBootAfter = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    assert.equal(winBootAfter.invoices.length, 2, 'Zero duplicate invoices allowed on retry');
    const finalProd = winBootAfter.products.find((p: any) => p.id === prodId);
    assert.equal(Number(finalProd.stockPerWarehouse[repVanWhId]), 32); // 35 - 3 = 32
  });

  await test('4B & 6B. Concurrency lock prevents overlapping syncs & countdown/interval helpers behave deterministically', async () => {
    const p1 = runSyncCycle({ userId: repUserId, forceAll: true, mode: 'send_only' });
    const p2 = runSyncCycle({ userId: repUserId, forceAll: true, mode: 'send_only' });
    assert.equal(p1, p2, 'Concurrent send_only cycles for same user must coalesce onto one lock promise');
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);

    assert.equal(DEFAULT_MANDATORY_SEND_INTERVAL_MINUTES, 15);
    assert.equal(normalizeMandatorySendIntervalMinutes(null), 15);
    assert.equal(normalizeMandatorySendIntervalMinutes(-5), 15);
    assert.equal(normalizeMandatorySendIntervalMinutes(7), 7);
    assert.equal(normalizeMandatorySendIntervalMinutes(5000), 1440);
    assert.equal(formatCountdownMmSs(425), '07:05');
    assert.equal(formatCountdownMmSs(3665), '01:01:05');

    const morningFmt = formatMobileSyncTimestamp('2026-11-15T02:12:00');
    assert.ok(morningFmt);
    assert.equal(morningFmt.fullText, '15-11-2026 الأحد 02:12 ص');

    const eveningFmt = formatMobileSyncTimestamp('2026-11-14T23:23:00');
    assert.ok(eveningFmt);
    assert.equal(eveningFmt.fullText, '14-11-2026 السبت 11:23 م');
  });

  await test('7. MobileSendReceiveScreen exact visual contract + Android/iOS routing + Windows Desktop untouched', () => {
    const mobileScreenSrc = fs.readFileSync(
      path.join(projectRoot, 'src/components/modules/mobile/MobileSendReceiveScreen.tsx'),
      'utf8'
    );
    for (const marker of [
      'mobile-send-receive-screen',
      'mobile-send-receive-back-btn',
      'bg-[#1e3a8a]',
      'bg-[#FFFFFF]',
      'bg-[#CCCCCC]',
      'bg-[#000080]',
      'bg-[#008000]',
      'no-dark-surface',
      'sync-last-send',
      'sync-pending-ops-count',
      'mobile-send-btn',
      'sync-last-receive',
      'mobile-receive-btn',
      'sync-mandatory-countdown',
      'includeHeldBatches: true',
      'آخر إرسال',
      'عدد العمليات المعلقة',
      'آخر استلام',
      'الإرسال الإجباري بعد',
    ]) {
      assert.ok(mobileScreenSrc.includes(marker), `MobileSendReceiveScreen.tsx missing '${marker}'`);
    }

    // Forbidden UI bloat checks on MobileSendReceiveScreen
    for (const forbidden of [
      'UnifiedDataTable',
      '<table',
      'إرسال إلى السيرفر',
      'استلام من السيرفر',
      'سجل العمليات',
      'dispatchBatch',
    ]) {
      assert.ok(!mobileScreenSrc.includes(forbidden), `MobileSendReceiveScreen.tsx must NOT contain '${forbidden}'`);
    }

    const repPortalSrc = fs.readFileSync(path.join(projectRoot, 'src/components/modules/mobile/RepPortal.tsx'), 'utf8');
    assert.ok(repPortalSrc.includes("<MobileSendReceiveScreen onBack={() => onTabChange('home')} />"));

    const staffShellSrc = fs.readFileSync(path.join(projectRoot, 'src/components/modules/mobile/StaffMobileShell.tsx'), 'utf8');
    assert.ok(staffShellSrc.includes("<MobileSendReceiveScreen onBack={() => onNavigate('dashboard')} />"));
    assert.ok(staffShellSrc.includes("key: 'refresh-sync'") && staffShellSrc.includes("label: 'إرسال واستلام'"));

    const dataCtxSrc = fs.readFileSync(path.join(projectRoot, 'src/context/DataContext.tsx'), 'utf8');
    assert.ok(dataCtxSrc.includes('includeHeldBatches: Boolean(options?.includeHeldBatches)'));

    const appSrc = fs.readFileSync(path.join(projectRoot, 'src/App.tsx'), 'utf8');
    assert.ok(appSrc.includes("case 'refresh-sync':\n        return <RefreshSyncScreen />;"));

    const refreshSrc = fs.readFileSync(path.join(projectRoot, 'src/components/modules/mobile/RefreshSyncScreen.tsx'), 'utf8');
    assert.ok(refreshSrc.includes('mobile-send-receive-panel'));

    const settingsSrc = fs.readFileSync(path.join(projectRoot, 'src/components/modules/settings/SettingsView.tsx'), 'utf8');
    assert.ok(settingsSrc.includes('mandatory-send-enabled-checkbox'));
    assert.ok(settingsSrc.includes('mandatory-send-interval-input'));

    const nativeSrc = fs.readFileSync(path.join(projectRoot, 'src/services/native.ts'), 'utf8');
    assert.ok(nativeSrc.includes("platform === 'android' || platform === 'ios'"));
  });
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  setInjectedPool(null);
  resetPgModeCache();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}

console.log(`\nALL MOBILE SEND & RECEIVE TESTS PASSED: ${passed} checks succeeded.`);

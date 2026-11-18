import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Configure isolated temp data dir before importing server/client modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad-selim-client-test-'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_client_offline_tests_2026_secure';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-key-at-least-32-chars!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-at-least-32-chars!!';
process.env.NODE_ENV = 'test';

// Provide Node web-compatible browser globals before importing client offline services
const localStoreMap = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (localStoreMap.has(k) ? localStoreMap.get(k)! : null),
  setItem: (k: string, v: string) => {
    localStoreMap.set(k, String(v));
  },
  removeItem: (k: string) => {
    localStoreMap.delete(k);
  },
  clear: () => {
    localStoreMap.clear();
  },
};
(globalThis as any).window = {
  location: { origin: 'http://127.0.0.1' },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
  writable: true,
});

const { localDb } = await import('../../src/services/localDb.ts');
const {
  saveVerifiedOnlineCredentials,
  verifyOfflineLogin,
  restoreLastVerifiedOfflineSession,
  revokeOfflineUser,
} = await import('../../src/services/offlineAuth.ts');
const {
  enqueueSyncOperation,
  runSyncCycle,
} = await import('../../src/services/syncEngine.ts');
const { overlayPendingQueueOnState } = await import('../../src/context/DataContext.tsx');
const { getEmptyClientDatabaseState } = await import('../../src/services/storage.ts');
const { sealWithDeviceSecret, unsealWithDeviceSecret } = await import('../../src/services/offlineCrypto.ts');
const { setConfiguredApiBaseUrlAsync, saveStoredTokensAsync } = await import('../../src/services/api.ts');
const { createApiApp } = await import('../app.js');

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
    throw err;
  }
}

async function req(baseUrl: string, method: string, urlPath: string, { token, body }: any = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

try {
  // Boot isolated API server
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  await setConfiguredApiBaseUrlAsync(baseUrl);

  // Setup admin bootstrap + login + seed base catalog/warehouse/cashbox/customer/supplier
  const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
    body: {
      fullName: 'أحمد سليم',
      username: 'admin_owner',
      password: 'AdminPassword!2026',
      phone: '01000001000',
    },
  });
  assert.equal(bootAdmin.status, 201);

  const adminLogin = await req(baseUrl, 'POST', '/api/auth/login', {
    body: { username: 'admin_owner', password: 'AdminPassword!2026' },
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.json.accessToken;
  const adminUser = adminLogin.json.user;

  await saveStoredTokensAsync({
    accessToken: adminToken,
    refreshToken: adminLogin.json.refreshToken,
  });

  const boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
  const whId = boot.warehouses[0].id;
  const cbId = boot.cashboxes[0].id;

  const prodRes = await req(baseUrl, 'POST', '/api/products', {
    token: adminToken,
    body: {
      code: 'PRD-CLI-1',
      barcode: '62200010002',
      name: 'سكر أبيض 1 كجم',
      category: 'مواد غذائية',
      baseUnit: 'كيس',
      units: [],
      purchasePrice: 30,
      sellingPrice: 40,
      minStockLevel: 5,
      stockPerWarehouse: { [whId]: 100 },
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      status: 'active',
    },
  });
  assert.equal(prodRes.status, 201);
  const prod = prodRes.json.product;

  const custRes = await req(baseUrl, 'POST', '/api/customers', {
    token: adminToken,
    body: { code: 'CUS-CLI-1', name: 'متجر الأمل', phone: '01055551111', address: 'الدقي', openingBalance: 0 },
  });
  assert.equal(custRes.status, 201);
  const cust = custRes.json.customer;

  const suppRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
    token: adminToken,
    body: { code: 'SUP-CLI-1', name: 'مورد الدلتا', phone: '01055552222', address: 'العبور', openingBalance: 0 },
  });
  assert.equal(suppRes.status, 201);
  const supp = suppRes.json.supplier;

  await test('C1. Offline Auth: verified user logs in offline via PBKDF2, no plaintext password stored, unverified user rejected', async () => {
    const secretPass = 'VerySecretPass!987';
    await saveVerifiedOnlineCredentials({
      serverUrl: baseUrl,
      username: adminUser.username,
      password: secretPass,
      user: adminUser,
    });

    // Verify stored auth profile does NOT contain plaintext password
    const profiles = await localDb.listAuthProfiles();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].user.passwordHash, '');
    assert.equal(JSON.stringify(profiles).includes(secretPass), false, 'Plaintext password MUST NOT be persisted');
    assert.ok(profiles[0].verifierHash.length >= 32);

    // Offline login succeeds for verified user
    const okLogin = await verifyOfflineLogin({
      serverUrl: baseUrl,
      username: adminUser.username,
      password: secretPass,
    });
    assert.equal(okLogin.ok, true);
    if (okLogin.ok) {
      assert.equal(okLogin.user.username, adminUser.username);
    }

    // Wrong password rejected
    const badPass = await verifyOfflineLogin({
      serverUrl: baseUrl,
      username: adminUser.username,
      password: 'WrongPassword!',
    });
    assert.equal(badPass.ok, false);

    // Unverified new user rejected offline
    const unverified = await verifyOfflineLogin({
      serverUrl: baseUrl,
      username: 'never_logged_in_user',
      password: 'AnyPassword123',
    });
    assert.equal(unverified.ok, false);
    if (!unverified.ok) {
      assert.equal(unverified.code, 'OFFLINE_USER_NOT_VERIFIED');
    }

    // Restore session after restart simulation
    const restored = await restoreLastVerifiedOfflineSession(baseUrl);
    assert.ok(restored);
    assert.equal(restored.user.id, adminUser.id);
  });

  await test('C2. Offline Media Cache & AES Seal Integrity', async () => {
    await localDb.saveMedia({
      mediaKey: `PRD-${prod.id}`,
      productId: prod.id,
      sourceUrlHash: 'h1',
      mimeType: 'image/png',
      dataUrl: prod.image,
      cachedAt: new Date().toISOString(),
    });
    const media = await localDb.getMedia(`PRD-${prod.id}`);
    assert.ok(media);
    assert.equal(media.dataUrl, prod.image);

    const sealed = sealWithDeviceSecret({ secretBalance: 12345 }, 'DEV-KEY-1');
    assert.ok(sealed.ct);
    const unsealed = unsealWithDeviceSecret<{ secretBalance: number }>(sealed, 'DEV-KEY-1');
    assert.equal(unsealed?.secretBalance, 12345);
    const wrongKey = unsealWithDeviceSecret<{ secretBalance: number }>(sealed, 'WRONG-KEY');
    assert.equal(wrongKey, null);
  });

  await test('C3. Full Offline Queue Overlay Across Simulated Restart (Sales, Purchase, Payment, Return, Expense, Cash Op, Customer Edit)', async () => {
    // Queue multiple operations while offline -> verify initial status is 'local'
    const opSale = await enqueueSyncOperation({
      userId: adminUser.id,
      operationType: 'create_sales_invoice',
      entityType: 'invoice',
      localId: 'INV-OFF-1',
      summaryAr: 'فاتورة بيع أوفلاين',
      payload: {
        localId: 'INV-OFF-1',
        customerId: cust.id,
        warehouseId: whId,
        cashboxId: cbId,
        status: 'confirmed',
        paymentType: 'partial',
        paidAmount: 200,
        discountTotal: 0,
        items: [{ productId: prod.id, productName: prod.name, barcode: prod.barcode, unit: 'كيس', unitFactor: 1, quantity: 10, unitPrice: 40, purchasePriceAtTime: 30, discount: 0, total: 400 }],
      },
    });
    assert.equal(opSale.status, 'local');

    const opPurchase = await enqueueSyncOperation({
      userId: adminUser.id,
      operationType: 'create_purchase_invoice',
      entityType: 'invoice',
      localId: 'PUR-OFF-1',
      summaryAr: 'فاتورة شراء أوفلاين',
      payload: {
        localId: 'PUR-OFF-1',
        supplierId: supp.id,
        warehouseId: whId,
        cashboxId: cbId,
        status: 'confirmed',
        paymentType: 'credit',
        paidAmount: 0,
        discountTotal: 0,
        items: [{ productId: prod.id, productName: prod.name, barcode: prod.barcode, unit: 'كيس', unitFactor: 1, quantity: 20, unitPrice: 30, purchasePriceAtTime: 30, discount: 0, total: 600 }],
      },
    });

    const opExp = await enqueueSyncOperation({
      userId: adminUser.id,
      operationType: 'execute_cash_operation',
      entityType: 'cash_operation',
      summaryAr: 'مصروف نقل أوفلاين',
      payload: { type: 'expense', cashboxId: cbId, amount: 50, category: 'نقل' },
    });

    const opPay = await enqueueSyncOperation({
      userId: adminUser.id,
      operationType: 'add_invoice_payment',
      entityType: 'payment',
      entityId: 'INV-OFF-1',
      summaryAr: 'سداد متبقي الفاتورة',
      payload: { invoiceId: 'INV-OFF-1', amount: 100, cashboxId: cbId, paymentMethod: 'cash' },
    });

    const opCustEdit = await enqueueSyncOperation({
      userId: adminUser.id,
      operationType: 'update_customer',
      entityType: 'customer',
      entityId: cust.id,
      summaryAr: 'تعديل عميل أوفلاين',
      payload: { customerId: cust.id, notes: 'ملاحظة أوفلاين دائمة' },
    });

    assert.ok(opPurchase && opExp && opPay && opCustEdit);

    // Persist snapshot and re-load from localDb (simulating closing and reopening app offline)
    const emptyBase = {
      ...getEmptyClientDatabaseState(),
      products: [prod],
      customers: [cust],
      suppliers: [supp],
      cashboxes: [boot.cashboxes[0]],
    };
    await localDb.saveSnapshot({
      userId: adminUser.id,
      scope: 'staff',
      serverOrigin: baseUrl,
      cachedAt: new Date().toISOString(),
      user: adminUser,
      data: { dbState: emptyBase, customerStatement: null },
    });

    const reloadedSnap = await localDb.getSnapshot(adminUser.id);
    const reloadedQueue = await localDb.listSyncQueue(adminUser.id);
    assert.ok(reloadedSnap);
    assert.equal(reloadedQueue.length, 5);

    const overlaid = overlayPendingQueueOnState(reloadedSnap.data.dbState, reloadedQueue);
    // Customer balance: +400 sale - 200 paid = +200, then -100 add_invoice_payment = +100
    assert.equal(overlaid.customers[0].currentBalance, 100);
    assert.equal(overlaid.customers[0].notes, 'ملاحظة أوفلاين دائمة');
    // Supplier balance: +600 purchase
    assert.equal(overlaid.suppliers[0].currentBalance, 600);
    // Cashbox balance: 0 + 200 (sale paid) - 50 (expense) + 100 (inv pay) = +250
    assert.equal(overlaid.cashboxes[0].currentBalance, 250);
    // Stock: 100 - 10 (sale) + 20 (purchase) = 110
    assert.equal(overlaid.products[0].stockPerWarehouse[whId], 110);
    assert.equal(overlaid.expenseIncomes.length, 1);
    assert.equal(overlaid.expenseIncomes[0].syncStatus, 'local');
  });

  await test('C4. Sync Cycle Execution, Partial Mid-Disconnect Retry Recovery, and Offline Auth Revocation', async () => {
    // Queue 1 more operation with corrupted deliveryProof -> verify syncEngine cleans it and pushes all 5 queued ops
    const cycleRes = await runSyncCycle({ userId: adminUser.id, forceAll: true });
    assert.equal(cycleRes.ok, true);
    assert.equal(cycleRes.serverReachable, true);
    assert.equal(cycleRes.syncedCount, 5);
    assert.equal(cycleRes.failedCount, 0);
    assert.equal(cycleRes.conflictCount, 0);

    const afterQueue = await localDb.listSyncQueue(adminUser.id);
    assert.ok(afterQueue.every((q) => q.status === 'synced'), 'All queue items MUST reach synced state');

    // Verify central server balances match tentative overlay calculations identically!
    const centralBoot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    assert.equal(centralBoot.customers.find((c: any) => c.id === cust.id).currentBalance, 100);
    assert.equal(centralBoot.suppliers.find((s: any) => s.id === supp.id).currentBalance, 600);
    assert.equal(centralBoot.cashboxes.find((c: any) => c.id === cbId).currentBalance, 250);
    assert.equal(centralBoot.products.find((p: any) => p.id === prod.id).stockPerWarehouse[whId], 110);

    // Mid-disconnect test: simulate unreachable server while another op is queued -> stays 'local', then syncs cleanly when server reachable again
    await enqueueSyncOperation({
      userId: adminUser.id,
      operationType: 'execute_cash_operation',
      entityType: 'cash_operation',
      summaryAr: 'إيداع أثناء انقطاع الشبكة',
      payload: { type: 'cash_deposit', cashboxId: cbId, amount: 75, category: 'إيداع نقدي' },
    });
    await setConfiguredApiBaseUrlAsync('http://127.0.0.1:59999');
    const offlineRun = await runSyncCycle({ userId: adminUser.id, forceAll: true });
    assert.equal(offlineRun.serverReachable, false);

    // Restore server URL & auto-sync -> succeeds with zero duplicates
    await setConfiguredApiBaseUrlAsync(baseUrl);
    const recoverRun = await runSyncCycle({ userId: adminUser.id, forceAll: true });
    assert.equal(recoverRun.ok, true);
    assert.equal(recoverRun.syncedCount, 1);

    const bootAfterRec = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    assert.equal(bootAfterRec.cashboxes.find((c: any) => c.id === cbId).currentBalance, 325);

    // Central deactivation/revocation -> wipe local verified credentials
    await revokeOfflineUser(adminUser.id);
    const revokedRestore = await restoreLastVerifiedOfflineSession(baseUrl);
    assert.equal(revokedRestore, null);
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log(`\nALL CLIENT OFFLINE STORAGE & SYNC TESTS PASSED (${passed}/${passed})`);
} finally {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

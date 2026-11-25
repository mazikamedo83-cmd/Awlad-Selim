import assert from 'node:assert/strict';

const memStorage = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return memStorage.has(key) ? memStorage.get(key)! : null;
  },
  setItem(key: string, val: string) {
    memStorage.set(key, String(val));
  },
  removeItem(key: string) {
    memStorage.delete(key);
  },
  clear() {
    memStorage.clear();
  },
};

(globalThis as any).localStorage = localStorageMock;
(globalThis as any).window = {
  location: { origin: 'https://erp.example.com', protocol: 'https:' },
  localStorage: localStorageMock,
  addEventListener() {},
  removeEventListener() {},
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, userAgent: 'AwladSelimOfflineSuite/3.0' },
  configurable: true,
});

const { saveStoredTokens } = await import('../../src/services/api.ts');
const { localDb } = await import('../../src/services/localDb.ts');
const {
  saveVerifiedOnlineCredentials,
  verifyOfflineLogin,
  restoreLastVerifiedOfflineSession,
  revokeOfflineUser,
} = await import('../../src/services/offlineAuth.ts');
const {
  enqueueSyncOperation,
  sendDispatchBatchToServer,
} = await import('../../src/services/syncEngine.ts');
const { executeAuthSessionCheck, DEFAULT_MOBILE_CONFIG } = await import('../../src/context/AuthContext.tsx');
const { overlayPendingQueueOnState } = await import('../../src/context/DataContext.tsx');

function createAuthHarness() {
  const state: any = {
    currentUser: null,
    customerProfile: null,
    representativeProfile: null,
    mobileConfig: DEFAULT_MOBILE_CONFIG,
    linkWarning: null,
    sessionExpiredMessage: null,
    isDatabaseUnavailable: false,
    databaseUnavailableMessage: null,
    needsAdminSetup: false,
    isOfflineSession: false,
    permissionsMayBeStale: false,
    lastVerifiedAt: null,
    isLoading: true,
  };
  const actions: any = {
    setCurrentUser: (u: any) => { state.currentUser = u; },
    setCustomerProfile: (c: any) => { state.customerProfile = c; },
    setRepresentativeProfile: (r: any) => { state.representativeProfile = r; },
    setMobileConfig: (cfg: any) => { state.mobileConfig = cfg; },
    setLinkWarning: (w: string | null) => { state.linkWarning = w; },
    setSessionExpiredMessage: (m: string | null) => { state.sessionExpiredMessage = m; },
    setIsDatabaseUnavailable: (v: boolean) => { state.isDatabaseUnavailable = v; },
    setDatabaseUnavailableMessage: (m: string | null) => { state.databaseUnavailableMessage = m; },
    setNeedsAdminSetup: (v: boolean) => { state.needsAdminSetup = v; },
    setIsOfflineSession: (v: boolean) => { state.isOfflineSession = v; },
    setPermissionsMayBeStale: (v: boolean) => { state.permissionsMayBeStale = v; },
    setLastVerifiedAt: (iso: string | null) => { state.lastVerifiedAt = iso; },
    setIsLoading: (v: boolean) => { state.isLoading = v; },
  };
  return { state, actions };
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] Client Offline | ${name}`);
  } catch (err) {
    console.error(`  [FAIL] Client Offline | ${name}`);
    console.error(err);
    throw err;
  }
}

const SERVER_URL = 'https://erp.example.com';
const INSTALL_ID = 'AWLAD-TEST-INST-01';

const sampleRepUser: any = {
  id: 'USR-REP-OFFLINE-1',
  fullName: 'محمود مندوب أوفلاين',
  username: 'rep_offline',
  role: 'representative',
  isActive: true,
  permissions: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canManageSales: true,
    canCreatePurchase: true,
  },
};

const sampleRepProfile: any = {
  id: 'REP-OFFLINE-1',
  userId: 'USR-REP-OFFLINE-1',
  name: 'محمود مندوب أوفلاين',
  phone: '01012345678',
  warehouseId: 'WH-VAN-1',
  currentBalance: 0,
  status: 'active',
};

function buildBaseDbState(): any {
  return {
    products: [
      {
        id: 'PRD-1',
        code: 'P001',
        name: 'شاي العروسة 250 جم',
        category: 'مشروبات',
        baseUnit: 'عبوة',
        sellingPrice: 50,
        purchasePrice: 35,
        stockPerWarehouse: { 'WH-MAIN': 100, 'WH-VAN-1': 30 },
        units: [{ name: 'عبوة', factor: 1, price: 50 }],
      },
    ],
    warehouses: [
      { id: 'WH-MAIN', name: 'المخزن الرئيسي', isDefault: true },
      { id: 'WH-VAN-1', name: 'سيارة محمود', isDefault: false },
    ],
    customers: [
      {
        id: 'CUS-EXISTING-1',
        code: 'C001',
        name: 'محل البركة',
        shopName: 'ماركت البركة',
        phone: '01099998888',
        currentBalance: 100,
        status: 'active',
      },
    ],
    suppliers: [
      { id: 'SUP-1', code: 'S001', name: 'شركة التوريدات الأولى', phone: '01511112222', currentBalance: 500, status: 'active' },
    ],
    cashboxes: [
      { id: 'CB-MAIN', name: 'الخزينة الرئيسية', type: 'cashbox', currentBalance: 1000, isDefault: true },
    ],
    representatives: [sampleRepProfile],
    invoices: [],
    salesQuotes: [],
    invoiceReturns: [],
    purchaseReturnRequests: [],
    salesReturnRequests: [],
    financialTransactions: [],
    expenseIncomes: [],
    customerItemOrders: [],
    orderAdvancePayments: [],
    repItemTransfers: [],
    repCustodyOperations: [],
    cheques: [],
    installments: [],
    settings: { currency: 'ج.م', companyName: 'أولاد سليم' },
  };
}

// Scenario 1: Offline login + cached verification + Electron/Capacitor offline session restore + revocation rejection
await test('1. Offline login, password check, Electron/Capacitor offline session restore, and revocation blocking', async () => {
  localStorageMock.clear();
  await saveVerifiedOnlineCredentials({
    serverUrl: SERVER_URL,
    installationId: INSTALL_ID,
    username: 'rep_offline',
    password: 'SecretPass!2026',
    user: sampleRepUser,
    customerProfile: null,
    representativeProfile: sampleRepProfile,
  });

  const okLogin = await verifyOfflineLogin({
    serverUrl: SERVER_URL,
    installationId: INSTALL_ID,
    username: 'rep_offline',
    password: 'SecretPass!2026',
  });
  assert.equal(okLogin.ok, true);
  if (okLogin.ok) {
    assert.equal(okLogin.user.id, sampleRepUser.id);
    assert.equal(okLogin.representativeProfile?.warehouseId, 'WH-VAN-1');
  }

  const badLogin = await verifyOfflineLogin({
    serverUrl: SERVER_URL,
    installationId: INSTALL_ID,
    username: 'rep_offline',
    password: 'WrongPassword!',
  });
  assert.equal(badLogin.ok, false);

  // Electron & Capacitor offline session restoration via executeAuthSessionCheck
  saveStoredTokens({ accessToken: 'tok-a', refreshToken: 'tok-r' });
  const { state, actions } = createAuthHarness();
  await executeAuthSessionCheck({
    getCurrentUser: () => state.currentUser,
    actions,
    deps: {
      getConfiguredApiBaseUrl: () => SERVER_URL,
      getStoredInstallationId: () => INSTALL_ID,
      apiRequest: async () => {
        throw Object.assign(new Error('Failed to fetch'), { status: 0 });
      },
      isNativeCapacitor: () => false,
      isElectronDesktop: () => true,
    },
  });
  assert.equal(state.currentUser?.id, sampleRepUser.id);
  assert.equal(state.isOfflineSession, true);
  assert.equal(state.isLoading, false);

  // Verify revocation blocks offline login & clears last verified session
  await revokeOfflineUser(sampleRepUser.id);
  const blockedRevoked = await verifyOfflineLogin({
    serverUrl: SERVER_URL,
    installationId: INSTALL_ID,
    username: 'rep_offline',
    password: 'SecretPass!2026',
  });
  assert.equal(blockedRevoked.ok, false);
  const noSession = await restoreLastVerifiedOfflineSession(SERVER_URL, INSTALL_ID);
  assert.equal(noSession, null);

  // Re-save valid credential for remaining scenarios
  await saveVerifiedOnlineCredentials({
    serverUrl: SERVER_URL,
    installationId: INSTALL_ID,
    username: 'rep_offline',
    password: 'SecretPass!2026',
    user: sampleRepUser,
    customerProfile: null,
    representativeProfile: sampleRepProfile,
  });
});

// Scenario 2, 3, 4: Offline customer, sales invoice (instant local van stock & balance update), collection, order, return requests, purchase draft
await test('2, 3 & 4. Offline operations queued (CUS-LOC, INV-LOC, PAY, ORD-LOC, SRR-LOC, PRR-LOC, PUR-LOC) & immediately reflected via overlayPendingQueueOnState', async () => {
  await localDb.saveSyncQueue(sampleRepUser.id, []);

  await enqueueSyncOperation({
    userId: sampleRepUser.id,
    operationType: 'create_customer',
    entityType: 'customer',
    localId: 'CUS-LOC-001',
    summaryAr: 'إضافة عميل محلي: سوبر ماركت الأمل',
    holdForDispatchBatch: true,
    payload: {
      localId: 'CUS-LOC-001',
      name: 'حسن علي',
      shopName: 'سوبر ماركت الأمل',
      phone: '01055556666',
      governorate: 'القاهرة',
      area: 'المعادي',
      address: 'شارع 9 المعادي',
      openingBalance: 0,
    },
  });

  await enqueueSyncOperation({
    userId: sampleRepUser.id,
    operationType: 'create_sales_invoice',
    entityType: 'invoice',
    localId: 'INV-LOC-001',
    summaryAr: 'فاتورة مبيعات محلية (500 ج.م)',
    holdForDispatchBatch: true,
    payload: {
      localId: 'INV-LOC-001',
      customerId: 'CUS-LOC-001',
      customerName: 'سوبر ماركت الأمل',
      warehouseId: 'WH-VAN-1',
      warehouseName: 'سيارة محمود',
      representativeId: 'REP-OFFLINE-1',
      representativeName: 'محمود مندوب أوفلاين',
      date: '2026-06-01',
      paymentType: 'partial',
      paidAmount: 200,
      discountTotal: 0,
      grandTotal: 500,
      items: [
        { productId: 'PRD-1', productName: 'شاي العروسة 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 10, unitPrice: 50, total: 500 },
      ],
    },
  });

  await enqueueSyncOperation({
    userId: sampleRepUser.id,
    operationType: 'record_customer_payment',
    entityType: 'financial',
    localId: 'PAY-LOC-001',
    summaryAr: 'تحصيل نقدي 150 ج.م',
    holdForDispatchBatch: true,
    payload: {
      customerId: 'CUS-LOC-001',
      customerName: 'سوبر ماركت الأمل',
      invoiceId: 'INV-LOC-001',
      amount: 150,
      paymentMethod: 'cash',
      date: '2026-06-01',
      notes: 'تحصيل إضافي محلي',
    },
  });

  await enqueueSyncOperation({
    userId: sampleRepUser.id,
    operationType: 'create_order',
    entityType: 'order',
    localId: 'ORD-LOC-001',
    summaryAr: 'طلب بضاعة محلي للعميل',
    holdForDispatchBatch: true,
    payload: {
      customerId: 'CUS-LOC-001',
      customerName: 'سوبر ماركت الأمل',
      requesterType: 'representative',
      items: [{ productId: 'PRD-1', productName: 'شاي العروسة 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 5, unitPrice: 50 }],
      notes: 'تسليم الغد',
    },
  });

  await enqueueSyncOperation({
    userId: sampleRepUser.id,
    operationType: 'create_sales_return_request',
    entityType: 'sales_return_request',
    localId: 'SRR-LOC-001',
    summaryAr: 'طلب مرتجع مبيعات محلي',
    holdForDispatchBatch: true,
    payload: {
      originalInvoiceId: 'INV-LOC-001',
      customerId: 'CUS-LOC-001',
      customerName: 'سوبر ماركت الأمل',
      warehouseId: 'WH-VAN-1',
      items: [{ productId: 'PRD-1', productName: 'شاي العروسة 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 1, unitPrice: 50, total: 50 }],
      grandTotal: 50,
      refundType: 'balance',
      reason: 'تلف عبوة',
    },
  });

  await enqueueSyncOperation({
    userId: sampleRepUser.id,
    operationType: 'create_purchase_return_request',
    entityType: 'purchase_return_request',
    localId: 'PRR-LOC-001',
    summaryAr: 'طلب مرتجع مشتريات محلي',
    holdForDispatchBatch: true,
    payload: {
      originalInvoiceId: 'PUR-SRV-1',
      supplierId: 'SUP-1',
      supplierName: 'شركة التوريدات الأولى',
      warehouseId: 'WH-MAIN',
      items: [{ productId: 'PRD-1', productName: 'شاي العروسة 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 2, unitPrice: 35, total: 70 }],
      grandTotal: 70,
      refundType: 'balance',
      reason: 'صنف غير مطابق',
    },
  });

  await enqueueSyncOperation({
    userId: sampleRepUser.id,
    operationType: 'create_purchase_invoice',
    entityType: 'invoice',
    localId: 'PUR-LOC-001',
    summaryAr: 'مسودة فاتورة شراء محلية',
    holdForDispatchBatch: true,
    payload: {
      supplierId: 'SUP-1',
      supplierName: 'شركة التوريدات الأولى',
      warehouseId: 'WH-MAIN',
      date: '2026-06-01',
      paymentType: 'credit',
      paidAmount: 0,
      grandTotal: 350,
      status: 'draft',
      items: [{ productId: 'PRD-1', productName: 'شاي العروسة 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 10, unitPrice: 35, total: 350 }],
    },
  });

  const queue = await localDb.listSyncQueue(sampleRepUser.id);
  assert.equal(queue.length, 7);
  assert.ok(queue.every((q) => q.holdForDispatchBatch === true && q.dispatchStage === 'محفوظة محليًا'));

  const base = buildBaseDbState();
  const projected = overlayPendingQueueOnState(base, queue);

  const localCust = projected.customers.find((c: any) => c.id === 'CUS-LOC-001');
  assert.ok(localCust, 'Local customer should appear immediately in projected state');
  // Grand total 500 - paid at invoice 200 - extra collection 150 = 150
  assert.equal(Number(localCust.currentBalance), 150);

  const vanProd = projected.products.find((p: any) => p.id === 'PRD-1');
  assert.ok(vanProd, 'Expected van product in projected state');
  // Initial van stock 30 - 10 sold = 20
  assert.equal(Number(vanProd.stockPerWarehouse['WH-VAN-1']), 20);

  const repProj = projected.representatives.find((r: any) => r.id === 'REP-OFFLINE-1');
  assert.ok(repProj, 'Expected rep in projected state');
  // Paid 200 + 150 = 350
  assert.equal(Number(repProj.currentBalance), 350);

  assert.equal(projected.invoices.length, 2); // sales + purchase draft
  assert.equal(projected.customerItemOrders?.length, 1);
  assert.equal(projected.salesReturnRequests?.length, 1);
  assert.equal(projected.purchaseReturnRequests?.length, 1);
  assert.equal(projected.financialTransactions.length, 2);
});

// Scenario 5: Snapshot + SyncQueue + DispatchBatch persistence across restart/reload without corruption
await test('5. LocalDB persistence survives simulated reload without data loss or duplication', async () => {
  const base = buildBaseDbState();
  await localDb.saveSnapshot({
    userId: sampleRepUser.id,
    scope: 'representative',
    serverOrigin: SERVER_URL,
    installationId: INSTALL_ID,
    cachedAt: new Date().toISOString(),
    user: sampleRepUser,
    representativeProfile: sampleRepProfile,
    data: { dbState: base, customerStatement: null },
  });

  const reloadedSnap = await localDb.getSnapshot(sampleRepUser.id);
  const reloadedQueue = await localDb.listSyncQueue(sampleRepUser.id);
  assert.ok(reloadedSnap);
  assert.equal(reloadedQueue.length, 7);

  const projected1 = overlayPendingQueueOnState(reloadedSnap!.data.dbState, reloadedQueue);
  const projected2 = overlayPendingQueueOnState(reloadedSnap!.data.dbState, reloadedQueue);
  assert.equal(projected1.invoices.length, projected2.invoices.length);
  assert.equal(
    projected1.customers.find((c: any) => c.id === 'CUS-LOC-001')?.currentBalance,
    projected2.customers.find((c: any) => c.id === 'CUS-LOC-001')?.currentBalance
  );
});

// Scenario 7 (client side): Offline confirmed send queues as جاهزة للإرسال -> Server 500 keeps ops safe as فشل الإرسال -> retry reuses exact clientBatchUuid & idempotencyKey
await test('7 (Client). Confirmed send queues as جاهزة للإرسال when network is unreachable, marks فشل الإرسال on HTTP 500, and retry reuses exact clientBatchUuid & idempotencyKey', async () => {
  saveStoredTokens({ accessToken: 'tok-rep', refreshToken: 'ref-rep' });
  const queueBefore = await localDb.listSyncQueue(sampleRepUser.id);
  const recipient = { id: 'USR-ADMIN-1', fullName: 'مدير النظام', role: 'admin' };

  const prevFetch = globalThis.fetch;
  // Pass 1: Network drops mid-dispatch -> explicitly confirmed send queues offline for auto-flush
  globalThis.fetch = (async () => {
    throw new TypeError('Network connection lost');
  }) as any;

  let queuedOutcome: any;
  try {
    queuedOutcome = await sendDispatchBatchToServer({
      userId: sampleRepUser.id,
      senderName: sampleRepUser.fullName,
      representativeId: sampleRepProfile.id,
      representativeName: sampleRepProfile.name,
      selectedOperations: queueBefore,
      recipient,
      notes: 'دفعة نهاية اليوم',
    });
  } finally {
    globalThis.fetch = prevFetch;
  }

  assert.equal(queuedOutcome.ok, false);
  assert.equal(queuedOutcome.queuedOfflineConfirmed, true);
  assert.equal(queuedOutcome.batch.sendStatus, 'جاهزة للإرسال');
  assert.equal(queuedOutcome.batch.isConfirmedSendQueued, true);
  assert.equal(queuedOutcome.batch.isLocalOnly, true);

  // Pass 2: Server returns 500 -> keeps ops safe as فشل الإرسال without discarding clientBatchUuid
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, error: 'Server busy 500' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  let failedOutcome: any;
  try {
    failedOutcome = await sendDispatchBatchToServer({
      userId: sampleRepUser.id,
      senderName: sampleRepUser.fullName,
      representativeId: sampleRepProfile.id,
      representativeName: sampleRepProfile.name,
      selectedOperations: queueBefore,
      recipient,
      notes: 'دفعة نهاية اليوم',
      existingDraftBatch: queuedOutcome.batch,
    });
  } finally {
    globalThis.fetch = prevFetch;
  }

  assert.equal(failedOutcome.ok, false);
  assert.equal(failedOutcome.batch.sendStatus, 'فشل الإرسال');
  assert.equal(failedOutcome.batch.isLocalOnly, true);
  assert.equal(failedOutcome.batch.clientBatchUuid, queuedOutcome.batch.clientBatchUuid);

  const queueAfterFail = await localDb.listSyncQueue(sampleRepUser.id);
  assert.equal(queueAfterFail.length, 7);
  assert.ok(queueAfterFail.every((q) => q.status === 'pending' && q.dispatchStage === 'فشل الإرسال'));

  // Pass 3: Network & server restored -> retry existingDraftBatch with exact same UUID/idempotencyKey
  let capturedBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    capturedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(
      JSON.stringify({
        ok: true,
        deduplicated: false,
        batch: {
          ...failedOutcome.batch,
          id: 'DSP-SRV-001',
          batchNumber: 'DSP-2026-0001',
          sendStatus: 'تم الإرسال',
          receiptStatus: 'في انتظار الاستلام',
        },
        opResults: queueAfterFail.map((q) => ({ operationId: q.operationId, status: 'synced' })),
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  let retryOutcome: any;
  try {
    retryOutcome = await sendDispatchBatchToServer({
      userId: sampleRepUser.id,
      senderName: sampleRepUser.fullName,
      representativeId: sampleRepProfile.id,
      representativeName: sampleRepProfile.name,
      selectedOperations: queueAfterFail,
      recipient,
      notes: 'دفعة نهاية اليوم',
      existingDraftBatch: failedOutcome.batch,
    });
  } finally {
    globalThis.fetch = prevFetch;
  }

  assert.equal(retryOutcome.ok, true);
  assert.equal(capturedBody.clientBatchUuid, failedOutcome.batch.clientBatchUuid);
  assert.equal(capturedBody.idempotencyKey, failedOutcome.batch.idempotencyKey);
  assert.equal(retryOutcome.batch.sendStatus, 'تم الإرسال');
  assert.equal(retryOutcome.batch.receiptStatus, 'في انتظار الاستلام');

  const batches = await localDb.listDispatchBatches(sampleRepUser.id);
  assert.equal(batches.length, 1, 'Draft must be replaced rather than duplicated');
  assert.equal(batches[0].batchNumber, 'DSP-2026-0001');

  const queueAfterRetry = await localDb.listSyncQueue(sampleRepUser.id);
  assert.ok(queueAfterRetry.every((q) => q.status === 'synced' && q.dispatchBatchId === 'DSP-SRV-001'));
});

await test('8 (Client). Strict Offline mode while navigator.onLine === false queues confirmed send and never clears unconfirmed operations', async () => {
  await localDb.saveSyncQueue(sampleRepUser.id, []);
  const unconfirmedOp = await enqueueSyncOperation({
    userId: sampleRepUser.id,
    operationType: 'create_customer',
    entityType: 'customer',
    localId: 'CUS-LOC-UNCONFIRMED',
    summaryAr: 'عميل غير مؤكد إرساله',
    holdForDispatchBatch: true,
    payload: { localId: 'CUS-LOC-UNCONFIRMED', name: 'عميل محلي', phone: '01077776666' },
  });

  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false, userAgent: 'AwladSelimOfflineSuite/3.0' },
    configurable: true,
  });

  try {
    const res = await sendDispatchBatchToServer({
      userId: sampleRepUser.id,
      senderName: sampleRepUser.fullName,
      selectedOperations: [unconfirmedOp],
      recipient: { id: 'USR-ADMIN-1', fullName: 'مدير النظام', role: 'admin' },
      notes: 'إرسال مؤكد أوفلاين',
    });
    assert.equal(res.ok, false);
    assert.equal(res.queuedOfflineConfirmed, true);
    assert.equal(res.batch.sendStatus, 'جاهزة للإرسال');
    assert.equal(res.batch.isConfirmedSendQueued, true);
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true, userAgent: 'AwladSelimOfflineSuite/3.0' },
      configurable: true,
    });
  }
});

console.log(`Client offline sub-suite finished: ${passed} passed.`);

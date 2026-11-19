import assert from 'node:assert/strict';

// Polyfill lightweight browser globals BEFORE importing client modules
const memStore = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return memStore.has(key) ? memStore.get(key)! : null;
  },
  setItem(key: string, val: string) {
    memStore.set(key, String(val));
  },
  removeItem(key: string) {
    memStore.delete(key);
  },
  clear() {
    memStore.clear();
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
  value: { onLine: true, userAgent: 'AwladSelimTestRunner/3.0' },
  configurable: true,
});

const {
  ApiError,
  apiRequest,
  saveStoredTokens,
  getStoredTokens,
  setAuthExpiredHandler,
  setServerDbStatusHandler,
  testServerHealth,
} = await import('../../src/services/api.ts');
const { enqueueSyncOperation, runSyncCycle } = await import('../../src/services/syncEngine.ts');
const { localDb } = await import('../../src/services/localDb.ts');

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
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

console.log('\n=== Frontend Client 503 Strict Mode Behavior Tests ===');

const DATABASE_UNAVAILABLE_BODY = {
  ok: false,
  code: 'DATABASE_UNAVAILABLE',
  error: 'قاعدة البيانات المركزية (PostgreSQL) غير متاحة مؤقتًا. تم إيقاف العمليات لحماية البيانات ومنع انقسامها.',
};

await test('1. testServerHealth surfaces 503 DATABASE_UNAVAILABLE message clearly', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(DATABASE_UNAVAILABLE_BODY), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    const res = await testServerHealth('https://erp.example.com');
    assert.equal(res.ok, false);
    assert.match(res.error || '', /PostgreSQL/);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

await test('2. apiRequest preserves auth tokens and throws 503 ApiError without triggering auth logout', async () => {
  saveStoredTokens({ accessToken: 'valid-access', refreshToken: 'valid-refresh' });
  let authExpiredCalled = false;
  setAuthExpiredHandler(() => {
    authExpiredCalled = true;
  });

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(DATABASE_UNAVAILABLE_BODY), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    await assert.rejects(
      () => apiRequest('/api/invoices/sales', { method: 'POST', body: { test: true } }),
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 503);
        assert.equal(err.code, 'DATABASE_UNAVAILABLE');
        assert.match(err.message, /PostgreSQL/);
        return true;
      }
    );
    assert.equal(authExpiredCalled, false, '503 must NEVER log user out');
    assert.equal(getStoredTokens()?.accessToken, 'valid-access', 'Tokens must remain intact during 503');
  } finally {
    globalThis.fetch = prevFetch;
    setAuthExpiredHandler(null);
  }
});

await test('3. syncEngine aborts cleanly on 503 push without false pull success and recovers cleanly', async () => {
  const userId = 'USR-CLIENT-TEST-1';
  const calls: string[] = [];
  let pgOnline = false;

  const op = await enqueueSyncOperation({
    userId,
    operationType: 'create_customer',
    entityType: 'customer',
    summaryAr: 'إنشاء عميل اختباري',
    payload: { name: 'عميل اختبار', phone: '01000001111' },
  });

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (!pgOnline) {
      return new Response(JSON.stringify(DATABASE_UNAVAILABLE_BODY), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/api/sync/push')) {
      return new Response(
        JSON.stringify({
          ok: true,
          results: [{ operationId: op.operationId, status: 'synced' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.endsWith('/api/sync/pull')) {
      return new Response(
        JSON.stringify({ ok: true, serverTime: '2026-11-18T20:00:00Z', syncConflicts: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as any;

  try {
    const downOutcome = await runSyncCycle({ userId });
    assert.equal(downOutcome.ok, false);
    assert.equal(downOutcome.serverReachable, true);
    assert.match(downOutcome.error || '', /PostgreSQL/);
    assert.equal(
      calls.some((u) => u.endsWith('/api/sync/pull')),
      false,
      'Must NOT fall through to /api/sync/pull when /api/sync/push returns 503'
    );

    const queueDuringOutage = await localDb.listSyncQueue(userId);
    assert.equal(queueDuringOutage.length, 1);
    assert.equal(queueDuringOutage[0].operationId, op.operationId);
    assert.equal(queueDuringOutage[0].status, 'pending');

    // Now PG recovers
    pgOnline = true;
    calls.length = 0;

    const upOutcome = await runSyncCycle({ userId });
    assert.equal(upOutcome.ok, true);
    assert.equal(upOutcome.pushedCount, 1);
    assert.equal(upOutcome.syncedCount, 1);

    const queueAfterRecovery = await localDb.listSyncQueue(userId);
    assert.equal(queueAfterRecovery[0].status, 'synced');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

await test('4. apiRequest notifies server DB status handler on 503 & recovery without auto-retrying financial POSTs', async () => {
  const statusEvents: Array<{ available: boolean; message?: string }> = [];
  setServerDbStatusHandler((available, message) => {
    statusEvents.push({ available, message });
  });

  let fetchCallCount = 0;
  let dbOnline = false;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCallCount++;
    if (!dbOnline) {
      return new Response(JSON.stringify(DATABASE_UNAVAILABLE_BODY), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, customer: { id: 'C-1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    await assert.rejects(
      () =>
        apiRequest('/api/customers/C-1/payment', {
          method: 'POST',
          idempotencyKey: 'PAY-1',
          body: { amount: 100 },
        }),
      (err: any) => err?.status === 503 && err?.code === 'DATABASE_UNAVAILABLE'
    );
    assert.equal(fetchCallCount, 1, 'Financial POST must NEVER auto-retry on 503');
    assert.equal(statusEvents.length, 1);
    assert.equal(statusEvents[0].available, false);
    assert.match(statusEvents[0].message || '', /PostgreSQL/);

    dbOnline = true;
    const okRes = await apiRequest('/api/customers/C-1/payment', {
      method: 'POST',
      idempotencyKey: 'PAY-1',
      body: { amount: 100 },
    });
    assert.equal(okRes.ok, true);
    assert.equal(statusEvents.length, 2);
    assert.equal(statusEvents[1].available, true);
  } finally {
    globalThis.fetch = prevFetch;
    setServerDbStatusHandler(null);
  }
});

await test('5. syncEngine never misclassifies 503 DATABASE_UNAVAILABLE as offline unreachable even if navigator.onLine is false', async () => {
  const userId = 'USR-CLIENT-TEST-2';
  await enqueueSyncOperation({
    userId,
    operationType: 'record_customer_payment',
    entityType: 'payment',
    summaryAr: 'تحصيل اختباري',
    payload: { customerId: 'C-1', amount: 50, cashboxId: 'CB-1' },
  });

  const prevNav = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false, userAgent: 'AwladSelimTestRunner/3.0' },
    configurable: true,
  });
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(DATABASE_UNAVAILABLE_BODY), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    const outcome = await runSyncCycle({ userId });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.serverReachable, true, '503 means server IS reachable (DB unavailable), NOT offline');
    assert.match(outcome.error || '', /PostgreSQL/);
  } finally {
    globalThis.fetch = prevFetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: prevNav,
      configurable: true,
    });
  }
});

console.log(`\nALL CLIENT 503 STRICT MODE TESTS PASSED (${passed} assertions groups)!`);

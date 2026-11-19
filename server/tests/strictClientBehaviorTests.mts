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
  subscribeServerDbStatus,
  testServerHealth,
} = await import('../../src/services/api.ts');
const { enqueueSyncOperation, runSyncCycle } = await import('../../src/services/syncEngine.ts');
const { localDb } = await import('../../src/services/localDb.ts');
const {
  saveVerifiedOnlineCredentials,
  restoreLastVerifiedOfflineSession,
} = await import('../../src/services/offlineAuth.ts');
const {
  executeAuthSessionCheck,
  createAuthExpiredCallback,
  DEFAULT_MOBILE_CONFIG,
} = await import('../../src/context/AuthContext.tsx');
const { isNetworkFailure } = await import('../../src/context/DataContext.tsx');

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

interface MockAuthState {
  currentUser: any;
  customerProfile: any;
  representativeProfile: any;
  mobileConfig: any;
  linkWarning: string | null;
  sessionExpiredMessage: string | null;
  isDatabaseUnavailable: boolean;
  databaseUnavailableMessage: string | null;
  needsAdminSetup: boolean;
  isOfflineSession: boolean;
  permissionsMayBeStale: boolean;
  lastVerifiedAt: string | null;
  isLoading: boolean;
}

function createAuthHarness(initial?: Partial<MockAuthState>) {
  const state: MockAuthState = {
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
    ...initial,
  };
  const actions = {
    setCurrentUser: (u: any) => {
      state.currentUser = u;
    },
    setCustomerProfile: (c: any) => {
      state.customerProfile = c;
    },
    setRepresentativeProfile: (r: any) => {
      state.representativeProfile = r;
    },
    setMobileConfig: (cfg: any) => {
      state.mobileConfig = cfg;
    },
    setLinkWarning: (w: string | null) => {
      state.linkWarning = w;
    },
    setSessionExpiredMessage: (m: string | null) => {
      state.sessionExpiredMessage = m;
    },
    setIsDatabaseUnavailable: (v: boolean) => {
      state.isDatabaseUnavailable = v;
    },
    setDatabaseUnavailableMessage: (m: string | null) => {
      state.databaseUnavailableMessage = m;
    },
    setNeedsAdminSetup: (v: boolean) => {
      state.needsAdminSetup = v;
    },
    setIsOfflineSession: (v: boolean) => {
      state.isOfflineSession = v;
    },
    setPermissionsMayBeStale: (v: boolean) => {
      state.permissionsMayBeStale = v;
    },
    setLastVerifiedAt: (iso: string | null) => {
      state.lastVerifiedAt = iso;
    },
    setIsLoading: (v: boolean) => {
      state.isLoading = v;
    },
  };
  return { state, actions };
}

const SAMPLE_REP_USER = {
  id: 'USR-REP-503',
  fullName: 'مندوب اختباري',
  username: 'rep_test_503',
  role: 'representative',
  isActive: true,
  permissions: { canManageSales: true },
};

const SAMPLE_CUSTOMER_PROFILE = {
  id: 'CUST-503',
  code: 'C503',
  name: 'عميل اختباري',
  phone: '0100000503',
  status: 'active',
  openingBalance: 0,
  currentBalance: 1250,
  priceHistory: {},
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SAMPLE_REP_PROFILE = {
  id: 'REP-503',
  name: 'مندوب اختباري',
  phone: '0100000503',
  currentBalance: 500,
  status: 'active',
};

await test('6. PostgreSQL stops while user is logged in (/api/auth/status returns 503): stays inside account without clearing user or tokens', async () => {
  saveStoredTokens({ accessToken: 'access-503-status', refreshToken: 'refresh-503-status' });
  const { state, actions } = createAuthHarness({
    currentUser: SAMPLE_REP_USER,
    customerProfile: SAMPLE_CUSTOMER_PROFILE,
    representativeProfile: SAMPLE_REP_PROFILE,
    lastVerifiedAt: '2026-11-18T10:00:00.000Z',
  });
  setAuthExpiredHandler(createAuthExpiredCallback(actions));

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/status')) {
      return new Response(JSON.stringify(DATABASE_UNAVAILABLE_BODY), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as any;

  try {
    await executeAuthSessionCheck({
      getCurrentUser: () => state.currentUser,
      actions,
    });
    assert.equal(state.currentUser?.id, 'USR-REP-503', 'Must NOT reset currentUser on /api/auth/status 503');
    assert.equal(state.customerProfile?.id, 'CUST-503', 'Must NOT clear customerProfile on 503');
    assert.equal(state.representativeProfile?.id, 'REP-503', 'Must NOT clear representativeProfile on 503');
    assert.equal(getStoredTokens()?.accessToken, 'access-503-status', 'Must preserve accessToken');
    assert.equal(getStoredTokens()?.refreshToken, 'refresh-503-status', 'Must preserve refreshToken');
    assert.equal(state.sessionExpiredMessage, null, 'Must NOT show session expired message');
    assert.equal(state.isDatabaseUnavailable, true);
    assert.match(state.databaseUnavailableMessage || '', /PostgreSQL/);
    assert.equal(state.isOfflineSession, false, 'Must NOT classify 503 as offline session');
    assert.equal(state.isLoading, false);
  } finally {
    globalThis.fetch = prevFetch;
    setAuthExpiredHandler(null);
  }
});

await test('7. PostgreSQL stops during /api/auth/me (including 401->refresh 503): account data and tokens stay intact', async () => {
  saveStoredTokens({ accessToken: 'access-503-me', refreshToken: 'refresh-503-me' });
  const { state, actions } = createAuthHarness({
    currentUser: SAMPLE_REP_USER,
    customerProfile: SAMPLE_CUSTOMER_PROFILE,
    representativeProfile: SAMPLE_REP_PROFILE,
    lastVerifiedAt: '2026-11-18T10:00:00.000Z',
  });
  setAuthExpiredHandler(createAuthExpiredCallback(actions));

  // Sub-case A: /api/auth/status -> 200, /api/auth/me -> 503
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/status')) {
      return new Response(JSON.stringify({ ok: true, needsAdminSetup: false, installationId: 'INST-503' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/auth/me')) {
      return new Response(JSON.stringify(DATABASE_UNAVAILABLE_BODY), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as any;

  try {
    await executeAuthSessionCheck({
      getCurrentUser: () => state.currentUser,
      actions,
    });
    assert.equal(state.currentUser?.id, 'USR-REP-503');
    assert.equal(state.customerProfile?.id, 'CUST-503');
    assert.equal(state.representativeProfile?.id, 'REP-503');
    assert.equal(getStoredTokens()?.accessToken, 'access-503-me');
    assert.equal(getStoredTokens()?.refreshToken, 'refresh-503-me');
    assert.equal(state.sessionExpiredMessage, null);
    assert.equal(state.isDatabaseUnavailable, true);
    assert.match(state.databaseUnavailableMessage || '', /PostgreSQL/);
    assert.equal(state.isOfflineSession, false);

    // Sub-case B: /api/auth/me -> 401 expired accessToken -> /api/auth/refresh -> 503 DATABASE_UNAVAILABLE
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ ok: true, needsAdminSetup: false, installationId: 'INST-503' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ ok: false, code: 'INVALID_TOKEN', error: 'expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/refresh')) {
        return new Response(JSON.stringify(DATABASE_UNAVAILABLE_BODY), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }) as any;

    await executeAuthSessionCheck({
      getCurrentUser: () => state.currentUser,
      actions,
    });
    assert.equal(state.currentUser?.id, 'USR-REP-503', 'Must NOT log out when refresh returns 503');
    assert.equal(getStoredTokens()?.accessToken, 'access-503-me', 'Must keep accessToken when refresh gets 503');
    assert.equal(getStoredTokens()?.refreshToken, 'refresh-503-me', 'Must keep refreshToken when refresh gets 503');
    assert.equal(state.sessionExpiredMessage, null);
    assert.equal(state.isDatabaseUnavailable, true);
    assert.equal(state.isOfflineSession, false);
  } finally {
    globalThis.fetch = prevFetch;
    setAuthExpiredHandler(null);
  }
});

await test('8. Cold reload during 503 outage preserves tokens and restores verified user without marking offline session', async () => {
  await saveVerifiedOnlineCredentials({
    serverUrl: 'https://erp.example.com',
    installationId: 'INST-503',
    username: SAMPLE_REP_USER.username,
    password: 'SecretPassword123',
    user: SAMPLE_REP_USER as any,
    customerProfile: SAMPLE_CUSTOMER_PROFILE as any,
    representativeProfile: SAMPLE_REP_PROFILE as any,
  });
  saveStoredTokens({ accessToken: 'cold-access', refreshToken: 'cold-refresh' });

  const { state, actions } = createAuthHarness();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(DATABASE_UNAVAILABLE_BODY), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    await executeAuthSessionCheck({
      getCurrentUser: () => state.currentUser,
      actions,
    });
    assert.equal(state.currentUser?.id, 'USR-REP-503');
    assert.equal(state.customerProfile?.id, 'CUST-503');
    assert.equal(state.representativeProfile?.id, 'REP-503');
    assert.equal(getStoredTokens()?.refreshToken, 'cold-refresh');
    assert.equal(state.sessionExpiredMessage, null);
    assert.equal(state.isDatabaseUnavailable, true);
    assert.equal(state.isOfflineSession, false, 'Cold reload on 503 must NOT enter offline internet mode');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

await test('9. PostgreSQL returns after 503 outage: session re-verifies and clears DB alert without logging out', async () => {
  saveStoredTokens({ accessToken: 'recover-access', refreshToken: 'recover-refresh' });
  const { state, actions } = createAuthHarness({
    currentUser: SAMPLE_REP_USER,
    customerProfile: SAMPLE_CUSTOMER_PROFILE,
    representativeProfile: SAMPLE_REP_PROFILE,
    isDatabaseUnavailable: true,
    databaseUnavailableMessage: DATABASE_UNAVAILABLE_BODY.error,
  });

  const dbEvents: boolean[] = [];
  const unsub = subscribeServerDbStatus((available) => {
    dbEvents.push(available);
  });

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/status')) {
      return new Response(JSON.stringify({ ok: true, needsAdminSetup: false, installationId: 'INST-503' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/auth/me')) {
      return new Response(
        JSON.stringify({
          ok: true,
          installationId: 'INST-503',
          user: { ...SAMPLE_REP_USER, fullName: 'مندوب محدث بعد الاسترجاع' },
          customerProfile: SAMPLE_CUSTOMER_PROFILE,
          representativeProfile: SAMPLE_REP_PROFILE,
          mobileConfig: DEFAULT_MOBILE_CONFIG,
          linkWarning: null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as any;

  try {
    await executeAuthSessionCheck({
      getCurrentUser: () => state.currentUser,
      actions,
    });
    assert.equal(state.currentUser?.id, 'USR-REP-503');
    assert.equal(state.currentUser?.fullName, 'مندوب محدث بعد الاسترجاع');
    assert.equal(state.isDatabaseUnavailable, false);
    assert.equal(state.databaseUnavailableMessage, null);
    assert.equal(state.sessionExpiredMessage, null);
    assert.equal(state.isOfflineSession, false);
    assert.ok(dbEvents.includes(true), 'Recovery must notify subscribeServerDbStatus(true)');
  } finally {
    unsub();
    globalThis.fetch = prevFetch;
  }
});

await test('10. Real 401 and SESSION_REVOKED still log user out and clear tokens & offline session', async () => {
  await saveVerifiedOnlineCredentials({
    serverUrl: 'https://erp.example.com',
    installationId: 'INST-503',
    username: SAMPLE_REP_USER.username,
    password: 'SecretPassword123',
    user: SAMPLE_REP_USER as any,
    customerProfile: SAMPLE_CUSTOMER_PROFILE as any,
    representativeProfile: SAMPLE_REP_PROFILE as any,
  });
  saveStoredTokens({ accessToken: 'expired-access', refreshToken: 'expired-refresh' });

  const { state, actions } = createAuthHarness({
    currentUser: SAMPLE_REP_USER,
    customerProfile: SAMPLE_CUSTOMER_PROFILE,
    representativeProfile: SAMPLE_REP_PROFILE,
  });
  setAuthExpiredHandler(createAuthExpiredCallback(actions));

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/status')) {
      return new Response(JSON.stringify({ ok: true, needsAdminSetup: false, installationId: 'INST-503' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/auth/me') || url.includes('/api/auth/refresh')) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'SESSION_REVOKED',
          error: 'الجلسة غير نشطة أو تم تسجيل الخروج منها',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as any;

  try {
    await executeAuthSessionCheck({
      getCurrentUser: () => state.currentUser,
      actions,
    });
    assert.equal(state.currentUser, null, 'Real 401/SESSION_REVOKED must log user out');
    assert.equal(state.customerProfile, null);
    assert.equal(state.representativeProfile, null);
    assert.equal(getStoredTokens(), null, 'Real 401/SESSION_REVOKED must wipe tokens');
    assert.ok(Boolean(state.sessionExpiredMessage), 'Must display session expiry/revocation message');
    assert.equal(state.isDatabaseUnavailable, false);
    const offlineAfter = await restoreLastVerifiedOfflineSession('https://erp.example.com', 'INST-503');
    assert.equal(offlineAfter, null, 'Offline session must be revoked/cleared on 401/SESSION_REVOKED');
  } finally {
    globalThis.fetch = prevFetch;
    setAuthExpiredHandler(null);
  }
});

await test('11. DEVICE_REVOKED revokes session, wipes tokens, and sets server revocation reason', async () => {
  await saveVerifiedOnlineCredentials({
    serverUrl: 'https://erp.example.com',
    installationId: 'INST-503',
    username: SAMPLE_REP_USER.username,
    password: 'SecretPassword123',
    user: SAMPLE_REP_USER as any,
    customerProfile: SAMPLE_CUSTOMER_PROFILE as any,
    representativeProfile: SAMPLE_REP_PROFILE as any,
  });
  saveStoredTokens({ accessToken: 'revoked-dev-access', refreshToken: 'revoked-dev-refresh' });

  const { state, actions } = createAuthHarness({
    currentUser: SAMPLE_REP_USER,
    customerProfile: SAMPLE_CUSTOMER_PROFILE,
    representativeProfile: SAMPLE_REP_PROFILE,
  });
  setAuthExpiredHandler(createAuthExpiredCallback(actions));

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/status')) {
      return new Response(JSON.stringify({ ok: true, needsAdminSetup: false, installationId: 'INST-503' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/auth/me')) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'DEVICE_REVOKED',
          error: 'تم فصل هذا الجهاز وإلغاء اعتماده من الإدارة.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as any;

  try {
    await executeAuthSessionCheck({
      getCurrentUser: () => state.currentUser,
      actions,
    });
    assert.equal(state.currentUser, null);
    assert.equal(state.customerProfile, null);
    assert.equal(state.representativeProfile, null);
    assert.equal(getStoredTokens(), null);
    assert.match(state.sessionExpiredMessage || '', /فصل هذا الجهاز/);
    assert.equal(state.isDatabaseUnavailable, false);
    const offlineAfter = await restoreLastVerifiedOfflineSession('https://erp.example.com', 'INST-503');
    assert.equal(offlineAfter, null, 'DEVICE_REVOKED must revoke offline user credentials');
  } finally {
    globalThis.fetch = prevFetch;
    setAuthExpiredHandler(null);
  }
});

await test('12. isNetworkFailure rejects 503 DATABASE_UNAVAILABLE even when navigator.onLine is false (blocks offline financial queuing)', async () => {
  const prevNav = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false, userAgent: 'AwladSelimTestRunner/3.0' },
    configurable: true,
  });
  try {
    const dbErr = new ApiError(503, DATABASE_UNAVAILABLE_BODY.error, 'DATABASE_UNAVAILABLE');
    assert.equal(isNetworkFailure(dbErr), false, '503 DATABASE_UNAVAILABLE must NEVER trigger offline queue');
    const netErr = new ApiError(0, 'Network unreachable', 'NETWORK_ERROR');
    assert.equal(isNetworkFailure(netErr), true, 'status 0 network failure should allow offline mode');
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: prevNav,
      configurable: true,
    });
  }
});

console.log(`\nALL CLIENT 503 STRICT MODE TESTS PASSED (${passed} assertions groups)!`);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ensureOfflineClientKey,
  writeEncryptedOfflineFile,
  readEncryptedOfflineFile,
} = require('../../electron/vaultCrypto.cjs');

// Polyfill lightweight browser globals BEFORE importing client modules
const localMem = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return localMem.has(key) ? localMem.get(key)! : null;
  },
  setItem(key: string, val: string) {
    localMem.set(key, String(val));
  },
  removeItem(key: string) {
    localMem.delete(key);
  },
  clear() {
    localMem.clear();
  },
};

const sessionMem = new Map<string, string>();
const sessionStorageMock = {
  getItem(key: string) {
    return sessionMem.has(key) ? sessionMem.get(key)! : null;
  },
  setItem(key: string, val: string) {
    sessionMem.set(key, String(val));
  },
  removeItem(key: string) {
    sessionMem.delete(key);
  },
  clear() {
    sessionMem.clear();
  },
};

(globalThis as any).localStorage = localStorageMock;
(globalThis as any).sessionStorage = sessionStorageMock;
(globalThis as any).window = {
  location: { origin: 'https://erp.example.com', protocol: 'https:' },
  localStorage: localStorageMock,
  sessionStorage: sessionStorageMock,
  addEventListener() {},
  removeEventListener() {},
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, userAgent: 'AwladSelimSecurityTestRunner/1.0' },
  configurable: true,
});

const {
  sealJson,
  unsealJson,
  removeSealedKey,
  SecureVaultError,
} = await import('../../src/services/secureVault.ts');
const {
  initSecureTokenCache,
  saveStoredTokensAsync,
  getStoredTokens,
  apiRequest,
} = await import('../../src/services/api.ts');
const {
  upsertSavedAccount,
  getSavedAccount,
  listSavedAccounts,
  removeSavedAccount,
} = await import('../../src/services/accountVault.ts');
const { executeAuthSessionCheck } = await import('../../src/context/AuthContext.tsx');
const {
  getDiagnostics,
  clearDiagnostics,
} = await import('../../src/services/diagnostics.ts');

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

console.log('\n=== Client Vault, Electron safeStorage, Migration, Web Cookies & Multi-Account Tests ===');

await test('1. Electron vaultCrypto fails closed when OS safeStorage unavailable and never creates plaintext .vault.key', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_vault_crypto_'));
  const targetFile = path.join(tmpDir, 'vault.bin');
  try {
    assert.throws(
      () =>
        writeEncryptedOfflineFile({
          offlineClientDir: tmpDir,
          safeStorage: {
            isEncryptionAvailable: () => false,
            encryptString: () => Buffer.from(''),
            decryptString: () => '',
          },
          filePath: targetFile,
          plainBuffer: Buffer.from('secret', 'utf8'),
        }),
      /safeStorage/
    );
    assert.equal(fs.existsSync(path.join(tmpDir, '.vault.key')), false, 'Must NEVER create plaintext .vault.key');
    assert.equal(fs.existsSync(path.join(tmpDir, '.vault.key.enc')), false);
    assert.equal(fs.existsSync(targetFile), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

await test('2. Electron vaultCrypto refuses to overwrite corrupt .vault.key.enc & preserves legacy .vault.key on failed migration', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_vault_mig_'));
  const targetFile = path.join(tmpDir, 'secrets', 'tokens.bin');
  try {
    const encKeyPath = path.join(tmpDir, '.vault.key.enc');
    const legacyKeyPath = path.join(tmpDir, '.vault.key');
    const badContent = Buffer.from('corrupted-blob');
    fs.writeFileSync(encKeyPath, badContent);

    assert.throws(
      () =>
        ensureOfflineClientKey({
          offlineClientDir: tmpDir,
          safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (s: string) => Buffer.from(`enc:${s}`),
            decryptString: () => {
              throw new Error('DPAPI_DECRYPT_FAILED');
            },
          },
        }),
      /DPAPI_DECRYPT_FAILED/
    );
    assert.deepEqual(fs.readFileSync(encKeyPath), badContent, 'Corrupt .vault.key.enc must never be overwritten');

    // Now test legacy key migration: keep legacy key when read-back verification fails, remove only after verification
    fs.unlinkSync(encKeyPath);
    const validRawKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
    fs.writeFileSync(legacyKeyPath, validRawKey);

    assert.throws(
      () =>
        ensureOfflineClientKey({
          offlineClientDir: tmpDir,
          safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (s: string) => Buffer.from(`enc:${s}`),
            decryptString: () => 'ff'.repeat(32),
          },
        }),
      /فشل التحقق/
    );
    assert.equal(fs.existsSync(legacyKeyPath), true, 'Legacy key MUST be kept intact when migration verification fails');
    if (fs.existsSync(encKeyPath)) fs.unlinkSync(encKeyPath);

    const goodSafeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(`enc:${s}`),
      decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, ''),
    };
    writeEncryptedOfflineFile({
      offlineClientDir: tmpDir,
      safeStorage: goodSafeStorage,
      filePath: targetFile,
      plainBuffer: Buffer.from('{"token":"top-secret-alpha"}', 'utf8'),
    });
    assert.equal(fs.existsSync(legacyKeyPath), false, 'Legacy key must be deleted after verified migration');
    assert.equal(fs.existsSync(encKeyPath), true);
    const decBuf = readEncryptedOfflineFile({
      offlineClientDir: tmpDir,
      safeStorage: goodSafeStorage,
      filePath: targetFile,
    });
    assert.equal(decBuf?.toString('utf8'), '{"token":"top-secret-alpha"}');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

await test('3. Plain Web never persists tokens in localStorage or IndexedDB vault, and sends credentials+CSRF headers', async () => {
  localMem.clear();
  sessionMem.clear();
  clearDiagnostics();

  await saveStoredTokensAsync({ accessToken: 'web-secret-acc-999', refreshToken: 'web-secret-ref-999' });
  assert.equal(localMem.get('awlad_selim_auth_tokens_v3') || null, null);
  assert.equal(await unsealJson('auth_tokens_v1'), null, 'Plain Web must NOT persist auth tokens into IndexedDB');
  assert.equal(getStoredTokens()?.accessToken, 'web-secret-acc-999', 'In-memory cache holds Web session token during runtime');

  await upsertSavedAccount({
    serverUrl: 'https://erp.example.com',
    installationId: 'INST-WEB',
    user: {
      id: 'U-WEB-1',
      username: 'webuser',
      fullName: 'مستخدم ويب',
      role: 'admin',
      isActive: true,
      permissions: {} as any,
    } as any,
    customerProfile: null,
    representativeProfile: null,
    accessToken: 'web-secret-acc-999',
    refreshToken: 'web-secret-ref-999',
    sessionStatus: 'active',
  });
  assert.equal(await unsealJson('account_vault_tokens_v1'), null, 'Plain Web must NOT persist account tokens into IndexedDB');
  const saved = await getSavedAccount('U-WEB-1');
  assert.equal(saved?.refreshToken, 'web-secret-ref-999', 'Same-runtime access still available from web in-memory map');
  await removeSavedAccount('U-WEB-1');

  let capturedInit: any = null;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;
  try {
    await apiRequest('/api/customers', { method: 'POST', body: { name: 'اختبار' } });
    assert.equal(capturedInit.credentials, 'include');
    const hdrs = new Headers(capturedInit.headers);
    assert.equal(hdrs.get('X-Requested-With'), 'awlad-selim-spa');
  } finally {
    globalThis.fetch = prevFetch;
    await saveStoredTokensAsync(null);
  }
});

await test('4. Native/Electron vault failure throws SecureVaultError without IDB fallback, preserves prior data & legacy tokens', async () => {
  localMem.clear();
  clearDiagnostics();
  const desktopStore = new Map<string, string>();
  desktopStore.set('existing_key', JSON.stringify({ intact: true }));

  let failVaultWrites = true;
  (globalThis as any).window.awladDesktop = {
    isElectron: true,
    secureVault: {
      async setItem(k: string, v: string) {
        if (failVaultWrites) {
          return { ok: false, error: 'OS safeStorage unavailable' };
        }
        desktopStore.set(k, v);
        return { ok: true };
      },
      async getItem(k: string) {
        return { ok: true, value: desktopStore.get(k) ?? null };
      },
      async removeItem(k: string) {
        desktopStore.delete(k);
        return { ok: true };
      },
    },
  };

  try {
    // Seed legacy plaintext tokens in localStorage
    localMem.set(
      'awlad_selim_auth_tokens_v3',
      JSON.stringify({ accessToken: 'legacy-acc-1', refreshToken: 'legacy-ref-1' })
    );

    // 4a. Failed legacy token migration MUST NOT delete legacy tokens!
    await initSecureTokenCache();
    assert.ok(localMem.get('awlad_selim_auth_tokens_v3')?.includes('legacy-ref-1'), 'Legacy token must be retained if vault write fails');

    // 4b. Explicit save fails with SecureVaultError without corrupting existing vault keys or spilling into localStorage
    await assert.rejects(
      () => saveStoredTokensAsync({ accessToken: 'new-acc-token', refreshToken: 'new-ref-token' }),
      (err: any) => err instanceof SecureVaultError || err?.name === 'SecureVaultError'
    );
    assert.equal(desktopStore.get('existing_key'), JSON.stringify({ intact: true }));
    assert.equal(localMem.get('awlad_selim_auth_tokens_v3')?.includes('new-ref-token'), false);

    // 4c. Ensure diagnostics do NOT leak raw token substrings
    const diagRaw = JSON.stringify(getDiagnostics());
    assert.equal(diagRaw.includes('legacy-ref-1'), false);
    assert.equal(diagRaw.includes('new-ref-token'), false);

    // 4d. When safeStorage recovers, migration saves to vault, verifies read-back, then purges legacy plaintext!
    failVaultWrites = false;
    await initSecureTokenCache();
    assert.equal(localMem.get('awlad_selim_auth_tokens_v3') || null, null, 'Legacy plaintext must be purged ONLY after verified migration');
    assert.equal(getStoredTokens()?.refreshToken, 'legacy-ref-1');
    assert.equal((await unsealJson<any>('auth_tokens_v1'))?.refreshToken, 'legacy-ref-1');
    await removeSealedKey('auth_tokens_v1');
  } finally {
    delete (globalThis as any).window.awladDesktop;
    localMem.clear();
  }
});

await test('5. Multi-account chooser triggers cleanly when >1 saved accounts exist without destroying tokens', async () => {
  sessionMem.clear();
  localMem.clear();
  await upsertSavedAccount({
    serverUrl: 'https://erp.example.com',
    installationId: 'INST-MULTI',
    user: { id: 'U-M1', username: 'multi1', fullName: 'حساب أول', role: 'admin', isActive: true, permissions: {} as any } as any,
    customerProfile: null,
    representativeProfile: null,
    accessToken: 'acc-m1',
    refreshToken: 'ref-m1',
    sessionStatus: 'active',
  });
  await upsertSavedAccount({
    serverUrl: 'https://erp.example.com',
    installationId: 'INST-MULTI',
    user: { id: 'U-M2', username: 'multi2', fullName: 'حساب ثاني', role: 'sales', isActive: true, permissions: {} as any } as any,
    customerProfile: null,
    representativeProfile: null,
    accessToken: 'acc-m2',
    refreshToken: 'ref-m2',
    sessionStatus: 'active',
  });
  await saveStoredTokensAsync({ accessToken: 'acc-m2', refreshToken: 'ref-m2' });

  let loadedSavedAccounts: any[] = [];
  let currentUser: any = null;
  let meFetchCount = 0;

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes('/api/auth/status')) {
      return new Response(JSON.stringify({ ok: true, needsAdminSetup: false, installationId: 'INST-MULTI' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/auth/me')) {
      meFetchCount++;
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as any;

  try {
    await executeAuthSessionCheck({
      getCurrentUser: () => currentUser,
      onSavedAccountsLoaded: (list) => {
        loadedSavedAccounts = list;
      },
      actions: {
        setCurrentUser: (u) => {
          currentUser = u;
        },
        setCustomerProfile: () => {},
        setRepresentativeProfile: () => {},
        setMobileConfig: () => {},
        setLinkWarning: () => {},
        setSessionExpiredMessage: () => {},
        setIsDatabaseUnavailable: () => {},
        setDatabaseUnavailableMessage: () => {},
        setNeedsAdminSetup: () => {},
        setIsOfflineSession: () => {},
        setPermissionsMayBeStale: () => {},
        setLastVerifiedAt: () => {},
        setIsLoading: () => {},
      },
    });
    assert.equal(currentUser, null, 'Multi-account boot must present account chooser instead of silently auto-picking one');
    assert.equal(meFetchCount, 0, 'Must pause on chooser before firing /api/auth/me');
    assert.equal(loadedSavedAccounts.length >= 2, true);
    assert.equal((await listSavedAccounts('https://erp.example.com')).length, 2);
  } finally {
    globalThis.fetch = prevFetch;
    await removeSavedAccount('U-M1');
    await removeSavedAccount('U-M2');
  }
});

await test('6. ReportsView and ItemLifecycleAndPnlPanel never display literal "COGS" label and use Arabic terminology', async () => {
  const reportsView = fs.readFileSync(path.resolve('src/components/modules/reports/ReportsView.tsx'), 'utf8');
  const itemPanel = fs.readFileSync(path.resolve('src/components/modules/reports/ItemLifecycleAndPnlPanel.tsx'), 'utf8');
  assert.equal(/\bCOGS\b/i.test(reportsView), false, 'ReportsView must never display raw COGS');
  assert.equal(/\bCOGS\b/.test(itemPanel), false, 'ItemLifecycleAndPnlPanel must never display uppercase COGS');
  assert.equal(itemPanel.includes('تكلفة البضاعة المباعة'), true);
});

console.log(`\nALL CLIENT SECURITY COMPLETION TESTS PASSED (${passed} assertion groups)!`);

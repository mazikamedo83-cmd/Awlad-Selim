import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { newDb } from 'pg-mem';

// 1) Isolate test database BEFORE importing any server or client modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_pairing_test_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_pairing_verification_2026_isolated';
delete process.env.ANDROID_APP_SHA256_FINGERPRINTS;
delete process.env.ANDROID_APP_ID;

// Minimal browser globals for testing TypeScript client modules in Node
const memStorage = new Map<string, string>();
(globalThis as any).localStorage = {
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
(globalThis as any).window = {
  location: { origin: 'http://127.0.0.1:3000', href: 'http://127.0.0.1:3000/', search: '', pathname: '/' },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const { createApiApp } = await import('../app.js');
const { writeJsonDatabase, readJsonDatabase } = await import('../db/jsonLedger.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { parseValidAndroidSha256Fingerprints } = await import('../db/stores/connectionPairingStore.js');

const apiMod = await import('../../src/services/api.ts');
const discoveryMod = await import('../../src/services/discovery.ts');

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

async function req(baseUrl: string, method: string, urlPath: string, opts: { token?: string; body?: any; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

function createPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();
  return {
    async query(sql: string, params?: any[]) {
      return memPool.query(sql, params);
    },
    async connect() {
      const client = await memPool.connect();
      return {
        query: (sql: string, params?: any[]) => client.query(sql, params),
        release: () => client.release(),
      };
    },
  };
}

async function runTests() {
  console.log(`\n[Isolation] Using temp AWLAD_DATA_DIR = ${tempDataDir}`);

  // Seed isolated temp JSON ledger only (never touches workspace /server/data)
  const initialDb = readJsonDatabase();
  initialDb.settings = {
    ...(initialDb.settings || {}),
    companyName: 'شركة أولاد سليم للاختبار المعزول',
    extraSettings: {
      ...(initialDb.settings?.extraSettings || {}),
      connectionConfig: {
        activeMode: 'local_network',
        configVersion: 3,
        localNetwork: { ip: '192.168.10.50', port: 3000, hostname: 'erp-lan' },
        freeRemote: { tunnelUrl: 'https://awlad-test-tunnel.trycloudflare.com', autoDetect: true },
        proRemote: { domainUrl: 'https://erp.awladselim.com', provider: 'cloudflare_named_tunnel' },
        cloudVps: { vpsUrl: 'https://vps.awladselim.cloud', notes: 'VPS' },
        enforceHttpsForRemote: true,
      },
    },
  };
  writeJsonDatabase(initialDb);

  resetPgModeCache();
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  let adminToken = '';
  let repToken = '';

  try {
    console.log('\n=== 1. Client URL Resolution & Validation (All 4 Modes + ActiveEndpoint Non-Override) ===');

    const profiles = {
      activeMode: 'local_network' as const,
      localNetwork: { ip: '192.168.10.50', port: 3000, hostname: 'erp-lan' },
      freeRemote: { tunnelUrl: 'https://awlad-test-tunnel.trycloudflare.com' },
      proRemote: { domainUrl: 'https://erp.awladselim.com' },
      cloudVps: { vpsUrl: 'https://vps.awladselim.cloud', notes: '' },
      enforceHttpsForRemote: true,
    };

    await test('resolvePairingEndpointForMode returns each selected mode URL and activeEndpoint does NOT override', () => {
      const bogusActiveEndpoint = 'http://10.99.99.99:3000';

      const rLocal = apiMod.resolvePairingEndpointForMode({
        selectedMode: 'local_network',
        activeMode: 'cloud_vps',
        profiles,
        activeEndpoint: bogusActiveEndpoint,
      });
      assert.equal(rLocal.effectiveMode, 'local_network');
      assert.equal(rLocal.endpointUrl, 'http://192.168.10.50:3000');

      const rFree = apiMod.resolvePairingEndpointForMode({
        selectedMode: 'free_remote',
        activeMode: 'local_network',
        profiles,
        activeEndpoint: bogusActiveEndpoint,
      });
      assert.equal(rFree.effectiveMode, 'free_remote');
      assert.equal(rFree.endpointUrl, 'https://awlad-test-tunnel.trycloudflare.com');

      const rPro = apiMod.resolvePairingEndpointForMode({
        selectedMode: 'pro_remote',
        activeMode: 'local_network',
        profiles,
        activeEndpoint: bogusActiveEndpoint,
      });
      assert.equal(rPro.effectiveMode, 'pro_remote');
      assert.equal(rPro.endpointUrl, 'https://erp.awladselim.com');

      const rVps = apiMod.resolvePairingEndpointForMode({
        selectedMode: 'cloud_vps',
        activeMode: 'local_network',
        profiles,
        activeEndpoint: bogusActiveEndpoint,
      });
      assert.equal(rVps.effectiveMode, 'cloud_vps');
      assert.equal(rVps.endpointUrl, 'https://vps.awladselim.cloud');

      // When selected remote mode is unconfigured, activeEndpoint must NOT leak into it!
      const unconfiguredProfiles = {
        ...profiles,
        proRemote: { domainUrl: '' },
      };
      const rUnconfigured = apiMod.resolvePairingEndpointForMode({
        selectedMode: 'pro_remote',
        activeMode: 'local_network',
        profiles: unconfiguredProfiles,
        activeEndpoint: 'http://192.168.10.50:3000',
      });
      assert.equal(rUnconfigured.effectiveMode, 'pro_remote');
      assert.equal(rUnconfigured.endpointUrl, '');
      assert.equal(apiMod.validateConnectionUrl('pro_remote', rUnconfigured.endpointUrl, true).valid, false);
    });

    await test('validateConnectionUrl rejects invalid IPs, spaces, invalid ports, localhost/HTTP on remote modes', () => {
      assert.equal(apiMod.validateConnectionUrl('local_network', 'http://192.168.1', true).valid, false);
      assert.equal(apiMod.validateConnectionUrl('local_network', 'http://192.168.1.999:3000', true).valid, false);
      assert.equal(apiMod.validateConnectionUrl('local_network', 'http://192.168.1.10:70000', true).valid, false);
      assert.equal(apiMod.validateConnectionUrl('local_network', 'http://192.168.1.10:3000 bad', true).valid, false);
      assert.equal(apiMod.validateConnectionUrl('free_remote', 'http://example.trycloudflare.com', true).valid, false);
      assert.equal(apiMod.validateConnectionUrl('pro_remote', 'https://localhost:3000', true).valid, false);
      assert.equal(apiMod.validateConnectionUrl('cloud_vps', 'https://intranet', true).valid, false);
      assert.equal(apiMod.validateConnectionUrl('local_network', 'http://192.168.1.10:3000', true).valid, true);
      assert.equal(apiMod.validateConnectionUrl('cloud_vps', 'https://vps.awladselim.cloud', true).valid, true);
    });

    await test('parsePairingInput parses custom scheme, App Links /pair/ & /invite/, query pair_token, JSON, and raw token', () => {
      const p1 = discoveryMod.parsePairingInput(
        'awladselim://pair?token=tok_abc12345&server=https%3A%2F%2Ferp.awladselim.com'
      );
      assert.equal(p1?.token, 'tok_abc12345');
      assert.equal(p1?.serverUrl, 'https://erp.awladselim.com');

      const p2 = discoveryMod.parsePairingInput('https://erp.awladselim.com/pair/tok_pair9876');
      assert.equal(p2?.token, 'tok_pair9876');
      assert.equal(p2?.serverUrl, 'https://erp.awladselim.com');

      const p3 = discoveryMod.parsePairingInput('https://erp.awladselim.com/invite/tok_inv5555');
      assert.equal(p3?.token, 'tok_inv5555');
      assert.equal(p3?.serverUrl, 'https://erp.awladselim.com');

      const p4 = discoveryMod.parsePairingInput('https://erp.awladselim.com/?pair_token=tok_q7777');
      assert.equal(p4?.token, 'tok_q7777');
      assert.equal(p4?.serverUrl, 'https://erp.awladselim.com');

      const p5 = discoveryMod.parsePairingInput(
        JSON.stringify({ token: 'tok_json8888', serverUrl: 'https://vps.awladselim.cloud' })
      );
      assert.equal(p5?.token, 'tok_json8888');
      assert.equal(p5?.serverUrl, 'https://vps.awladselim.cloud');

      // Rejects javascript: or ftp: injected server URLs
      const pBad = discoveryMod.parsePairingInput(
        'awladselim://pair?token=tok_abc12345&server=javascript%3Aalert(1)'
      );
      assert.equal(pBad?.token, 'tok_abc12345');
      assert.equal(pBad?.serverUrl, undefined);
    });

    console.log('\n=== 2. Auth, RBAC, 4-Mode Server Invite Creation, Links & QR ===');

    await test('Initial admin setup + creation of non-admin sales_rep user', async () => {
      const setup = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: { fullName: 'مدير الاختبار', username: 'admin_test', password: 'Password#123' },
      });
      assert.equal(setup.status, 201);

      const adminLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin_test', password: 'Password#123' },
      });
      assert.equal(adminLogin.status, 200);
      adminToken = adminLogin.json.accessToken;
      assert.ok(adminToken);

      const createRep = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مندوب مبيعات اختباري',
          username: 'rep_test',
          password: 'RepPassword#123',
          role: 'sales',
          permissions: { canView: true, canManageSettings: false },
        },
      });
      assert.equal(createRep.status, 201);

      const repLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'rep_test', password: 'RepPassword#123' },
      });
      assert.equal(repLogin.status, 200);
      repToken = repLogin.json.accessToken;
      assert.ok(repToken);
    });

    await test('Unauthenticated (401) and non-admin (403) cannot access admin pairing/device endpoints', async () => {
      const noAuth = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        body: { connectionMode: 'local_network' },
      });
      assert.equal(noAuth.status, 401);

      const repCreate = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: repToken,
        body: { connectionMode: 'local_network' },
      });
      assert.equal(repCreate.status, 403);

      const repDevices = await req(baseUrl, 'GET', '/api/admin/devices', { token: repToken });
      assert.equal(repDevices.status, 403);
    });

    await test('Backend pairing creation works distinctly for all 4 modes and rejects invalid URLs', async () => {
      const expectedByMode: Record<string, string> = {
        local_network: 'http://192.168.10.50:3000',
        free_remote: 'https://awlad-test-tunnel.trycloudflare.com',
        pro_remote: 'https://erp.awladselim.com',
        cloud_vps: 'https://vps.awladselim.cloud',
      };

      for (const [mode, expectedUrl] of Object.entries(expectedByMode)) {
        const res = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
          token: adminToken,
          body: {
            connectionMode: mode,
            targetDeviceType: 'android',
            ttlMinutes: 30,
          },
        });
        assert.equal(res.status, 201, `Mode ${mode} should succeed`);
        assert.equal(res.json.serverBaseUrl, expectedUrl);
        assert.equal(res.json.directInviteUrl, `${expectedUrl}/pair/${res.json.rawToken}`);
        assert.equal(res.json.qrPayload, res.json.directInviteUrl);
        assert.ok(
          res.json.deepLinkUrl.startsWith(
            `awladselim://pair?token=${encodeURIComponent(res.json.rawToken)}&server=${encodeURIComponent(expectedUrl)}`
          )
        );
      }

      // Reject HTTP or invalid hostname for remote mode
      const badRemote = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: {
          connectionMode: 'pro_remote',
          serverBaseUrl: 'http://192.168.10.50:3000',
        },
      });
      assert.equal(badRemote.status, 400);
      assert.equal(badRemote.json.code, 'HTTPS_REQUIRED_FOR_REMOTE');

      const badPartialIp = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: {
          connectionMode: 'local_network',
          serverBaseUrl: 'http://192.168.1',
        },
      });
      assert.equal(badPartialIp.status, 400);
      assert.equal(badPartialIp.json.code, 'INVALID_PAIRING_SERVER_URL');
    });

    await test('/pair/:token and /invite/:token landing pages serve custom scheme + metadata', async () => {
      const created = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: { connectionMode: 'local_network', serverBaseUrl: baseUrl, targetDeviceType: 'android' },
      });
      assert.equal(created.status, 201);
      const rawToken = created.json.rawToken;

      const pairHtml = await req(baseUrl, 'GET', `/pair/${rawToken}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' },
      });
      assert.equal(pairHtml.status, 200);
      assert.ok(pairHtml.text.includes('awladselim://pair?token='));

      const inviteHtml = await req(baseUrl, 'GET', `/invite/${rawToken}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' },
      });
      assert.equal(inviteHtml.status, 200);
      assert.ok(inviteHtml.text.includes('awladselim://pair?token='));
    });

    console.log('\n=== 3. Token Expiration, Revocation, Single-Use, Device Approval & Auth Preservation ===');

    await test('claimPairingInvitation verifies token BEFORE saving serverBaseUrl and clears existing auth tokens', async () => {
      memStorage.clear();
      apiMod.setConfiguredApiBaseUrl('http://old-server.local:3000');
      apiMod.saveStoredTokens({ accessToken: 'stale_access', refreshToken: 'stale_refresh' });

      // Invalid token must fail and preserve old URL without overwriting
      const badClaim = await discoveryMod.claimPairingInvitation(
        `awladselim://pair?token=invalid_token_999&server=${encodeURIComponent(baseUrl)}`
      );
      assert.equal(badClaim.ok, false);
      assert.equal(apiMod.getConfiguredApiBaseUrl(), 'http://old-server.local:3000');

      // Valid token directed at this local test server
      const created = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: {
          connectionMode: 'local_network',
          serverBaseUrl: baseUrl,
          targetDeviceType: 'any',
          singleUse: true,
        },
      });
      assert.equal(created.status, 201);

      const goodClaim = await discoveryMod.claimPairingInvitation(
        `awladselim://pair?token=${encodeURIComponent(created.json.rawToken)}&server=${encodeURIComponent(baseUrl)}`
      );
      assert.equal(goodClaim.ok, true);
      assert.equal(goodClaim.endpointUrl, baseUrl);
      // Auth tokens MUST be cleared so user is forced to log in normally (never bypasses login)
      assert.equal(apiMod.getStoredTokens(), null);
      assert.equal(apiMod.getConfiguredApiBaseUrl(), baseUrl);

      // Second use of single-use token must fail with 409 and NOT issue anything
      const replay = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: { token: created.json.rawToken, deviceId: 'DEV_REPLAY_CHECK', deviceType: 'android' },
      });
      assert.equal(replay.status, 409);
      assert.equal(replay.json.code, 'PAIRING_TOKEN_USED');
    });

    await test('Expired token (410) and Revoked token (410) are rejected and do NOT save URL', async () => {
      memStorage.clear();
      apiMod.setConfiguredApiBaseUrl('http://unchanged.local:3000');

      // Create & revoke token
      const c1 = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: { connectionMode: 'local_network', serverBaseUrl: baseUrl },
      });
      const rev = await req(baseUrl, 'POST', `/api/admin/pairing/tokens/${c1.json.tokenRecord.id}/revoke`, {
        token: adminToken,
      });
      assert.equal(rev.status, 200);

      const revClaim = await discoveryMod.claimPairingInvitation(`${baseUrl}/pair/${c1.json.rawToken}`);
      assert.equal(revClaim.ok, false);
      assert.equal(apiMod.getConfiguredApiBaseUrl(), 'http://unchanged.local:3000');

      // Create expired token by modifying expiresAt in isolated temp DB
      const c2 = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: { connectionMode: 'local_network', serverBaseUrl: baseUrl },
      });
      const db = readJsonDatabase();
      const targetTok = db.pairingTokens.find((t: any) => t.id === c2.json.tokenRecord.id);
      targetTok.expiresAt = new Date(Date.now() - 60_000).toISOString();
      writeJsonDatabase(db);

      const expClaim = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: { token: c2.json.rawToken, deviceId: 'DEV_EXPIRED', deviceType: 'android' },
      });
      assert.equal(expClaim.status, 410);
      assert.equal(expClaim.json.code, 'PAIRING_TOKEN_EXPIRED');
    });

    await test('Device type mismatch (403), Admin approval workflow, and Device revocation', async () => {
      const created = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: {
          connectionMode: 'local_network',
          serverBaseUrl: baseUrl,
          targetDeviceType: 'android',
          requireAdminApproval: true,
        },
      });
      assert.equal(created.status, 201);

      // Mismatch deviceType = windows
      const wrongType = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: { token: created.json.rawToken, deviceId: 'DEV_WIN', deviceType: 'windows' },
      });
      assert.equal(wrongType.status, 403);
      assert.equal(wrongType.json.code, 'DEVICE_TYPE_MISMATCH');

      // Correct deviceType = android
      const claimAndroid = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: {
          token: created.json.rawToken,
          deviceId: 'DEV_AND_01',
          deviceName: 'Samsung Galaxy Test',
          deviceType: 'android',
        },
      });
      assert.equal(claimAndroid.status, 200);
      assert.equal(claimAndroid.json.requiresLogin, true);
      assert.equal(claimAndroid.json.accessToken, undefined);
      assert.equal(claimAndroid.json.deviceStatus, 'pending_approval');

      // Admin approves device
      const approve = await req(baseUrl, 'POST', '/api/admin/devices/DEV_AND_01/approve', {
        token: adminToken,
      });
      assert.equal(approve.status, 200);
      assert.equal(approve.json.device.status, 'active');

      // Admin revokes device -> heartbeat returns 403 DEVICE_REVOKED
      const revokeDev = await req(baseUrl, 'POST', '/api/admin/devices/DEV_AND_01/revoke', {
        token: adminToken,
      });
      assert.equal(revokeDev.status, 200);
      assert.equal(revokeDev.json.device.status, 'revoked');

      const hb = await req(baseUrl, 'POST', '/api/connection/heartbeat', {
        body: { deviceId: 'DEV_AND_01', deviceType: 'android' },
      });
      assert.equal(hb.status, 403);
      assert.equal(hb.json.code, 'DEVICE_REVOKED');
    });

    console.log('\n=== 4. assetlinks.json Fingerprint Safety Verification ===');

    await test('assetlinks.json stays disabled ([]) without real fingerprint/host and rejects placeholders', async () => {
      delete process.env.ANDROID_APP_SHA256_FINGERPRINTS;
      delete process.env.ANDROID_APP_LINK_HOST;
      const emptyRes = await req(baseUrl, 'GET', '/.well-known/assetlinks.json');
      assert.equal(emptyRes.status, 200);
      assert.deepEqual(emptyRes.json, []);

      process.env.ANDROID_APP_SHA256_FINGERPRINTS = '00:'.repeat(31) + '00';
      const zeroRes = await req(baseUrl, 'GET', '/.well-known/assetlinks.json');
      assert.equal(zeroRes.status, 200);
      assert.deepEqual(zeroRes.json, []);

      const srvInfoOff = await req(baseUrl, 'GET', '/api/admin/server-info', { token: adminToken });
      assert.equal(srvInfoOff.status, 200);
      assert.equal(srvInfoOff.json.appLinksConfigured.android, false);

      // Valid fingerprint WITHOUT domain host still reports appLinksConfigured.android = false
      const sampleSha = Array.from({ length: 32 }, (_, i) => (i + 1).toString(16).padStart(2, '0').toUpperCase()).join(':');
      assert.deepEqual(parseValidAndroidSha256Fingerprints(sampleSha), [sampleSha]);
      process.env.ANDROID_APP_SHA256_FINGERPRINTS = sampleSha;
      process.env.ANDROID_APP_LINK_HOST = 'awladselim.app';

      const placeholderHostRes = await req(baseUrl, 'GET', '/.well-known/assetlinks.json');
      assert.equal(placeholderHostRes.status, 200);
      assert.deepEqual(placeholderHostRes.json, []);
      const srvInfoPlaceholder = await req(baseUrl, 'GET', '/api/admin/server-info', { token: adminToken });
      assert.equal(srvInfoPlaceholder.json.appLinksConfigured.android, false);

      // Real owned host + valid fingerprint enables both server-info and assetlinks.json for matching Host
      process.env.ANDROID_APP_LINK_HOST = 'erp.real-shop.com';
      const srvInfoOn = await req(baseUrl, 'GET', '/api/admin/server-info', { token: adminToken });
      assert.equal(srvInfoOn.json.appLinksConfigured.android, true);
      assert.equal(srvInfoOn.json.appLinksConfigured.androidDetails.appLinkHost, 'erp.real-shop.com');

      const mismatchHostRes = await req(baseUrl, 'GET', '/.well-known/assetlinks.json');
      assert.equal(mismatchHostRes.status, 200);
      assert.deepEqual(mismatchHostRes.json, []);

      const validRes = await req(baseUrl, 'GET', '/.well-known/assetlinks.json', {
        headers: { 'X-Forwarded-Host': 'erp.real-shop.com' },
      });
      assert.equal(validRes.status, 200);
      assert.equal(validRes.json.length, 1);
      assert.equal(validRes.json[0].target.package_name, 'com.awladselim.erp');
      assert.deepEqual(validRes.json[0].target.sha256_cert_fingerprints, [sampleSha]);

      delete process.env.ANDROID_APP_SHA256_FINGERPRINTS;
      delete process.env.ANDROID_APP_LINK_HOST;
    });

    console.log('\n=== 5. PostgreSQL (pg-mem) Pairing Mode Parity ===');

    await test('PG mode createPairingToken, resolvePairingToken, claimPairingToken, revokePairingToken', async () => {
      const memPool = createPgMemPool();
      setInjectedPool(memPool);
      await initializeSchema();
      resetPgModeCache();

      // Seed settings and admin user in PG
      await memPool.query(
        `INSERT INTO system_settings (id, company_name, extra_settings)
         VALUES (1, 'أولاد سليم PG', $1)
         ON CONFLICT (id) DO UPDATE SET extra_settings = EXCLUDED.extra_settings`,
        [
          JSON.stringify({
            connectionConfig: {
              activeMode: 'pro_remote',
              configVersion: 2,
              localNetwork: { ip: '192.168.1.50', port: 3000, hostname: 'erp' },
              freeRemote: { tunnelUrl: 'https://pg-tunnel.trycloudflare.com' },
              proRemote: { domainUrl: 'https://pg.awladselim.com' },
              cloudVps: { vpsUrl: 'https://pg-vps.awladselim.cloud' },
              enforceHttpsForRemote: true,
            },
          }),
        ]
      );

      const pgSetup = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: { fullName: 'مدير PG', username: 'pg_admin', password: 'PgPassword#123' },
      });
      assert.equal(pgSetup.status, 201);
      const pgLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'pg_admin', password: 'PgPassword#123' },
      });
      assert.equal(pgLogin.status, 200);
      const pgAdminToken = pgLogin.json.accessToken;

      // Explicitly choose cloud_vps while activeMode is pro_remote
      const pgCreate = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: pgAdminToken,
        body: { connectionMode: 'cloud_vps', targetDeviceType: 'android' },
      });
      assert.equal(pgCreate.status, 201);
      assert.equal(pgCreate.json.serverBaseUrl, 'https://pg-vps.awladselim.cloud');

      const pgResolve = await req(baseUrl, 'GET', `/api/pairing/resolve/${pgCreate.json.rawToken}`);
      assert.equal(pgResolve.status, 200);
      assert.equal(pgResolve.json.activeMode, 'cloud_vps');
      assert.equal(pgResolve.json.endpointUrl, 'https://pg-vps.awladselim.cloud');

      const pgClaim = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: { token: pgCreate.json.rawToken, deviceId: 'PG_DEV_01', deviceType: 'android' },
      });
      assert.equal(pgClaim.status, 200);
      assert.equal(pgClaim.json.requiresLogin, true);
      assert.equal(pgClaim.json.endpointUrl, 'https://pg-vps.awladselim.cloud');

      const pgReplay = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: { token: pgCreate.json.rawToken, deviceId: 'PG_DEV_02', deviceType: 'android' },
      });
      assert.equal(pgReplay.status, 409);

      setInjectedPool(null);
      resetPgModeCache();
    });

    console.log(`\nALL PAIRING VERIFICATION TESTS PASSED (${passed} assertions/suites).\n`);
  } finally {
    server.close();
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('Pairing verification tests failed:', err);
  process.exit(1);
});

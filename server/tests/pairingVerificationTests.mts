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

    console.log('\n=== 6. 5-Status Device Lifecycle, 403 Auth/API Guards & Revoke Permanence ===');

    await test('Device guards block pending_approval, rejected, disconnected, and revoked across login/refresh/API routes', async () => {
      // Seed sample customer + invoice balance to verify nothing is touched during settings/device ops
      const preDb = readJsonDatabase();
      preDb.customers = preDb.customers || [];
      preDb.customers.push({
        id: 'CUST_PRESERVE_01',
        name: 'عميل حافظ للرصيد',
        phone: '01000000001',
        address: 'القاهرة',
        balance: 4250.5,
      });
      writeJsonDatabase(preDb);

      const created = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: {
          connectionMode: 'local_network',
          serverBaseUrl: baseUrl,
          targetDeviceType: 'android',
          singleUse: false,
          requireAdminApproval: true,
        },
      });
      assert.equal(created.status, 201);

      const devId = 'DEV_GUARD_TEST_01';
      const claimRes = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: {
          token: created.json.rawToken,
          deviceId: devId,
          deviceName: 'Phone Guard Check',
          deviceType: 'android',
        },
      });
      assert.equal(claimRes.status, 200);
      assert.equal(claimRes.json.deviceStatus, 'pending_approval');

      // 1) pending_approval blocks login + orders API
      const loginPending = await req(baseUrl, 'POST', '/api/auth/login', {
        headers: { 'X-Device-Id': devId },
        body: { username: 'admin_test', password: 'Password#123' },
      });
      assert.equal(loginPending.status, 403);
      assert.equal(loginPending.json.code, 'DEVICE_PENDING_APPROVAL');

      const ordersPending = await req(baseUrl, 'GET', '/api/orders', {
        token: adminToken,
        headers: { 'X-Device-Id': devId },
      });
      assert.equal(ordersPending.status, 403);
      assert.equal(ordersPending.json.code, 'DEVICE_PENDING_APPROVAL');

      // 2) Reject device -> blocks login + orders + appears in summary.rejected
      const rejectRes = await req(baseUrl, 'POST', `/api/admin/devices/${devId}/reject`, {
        token: adminToken,
        body: { reason: 'جهاز غير مصرح به' },
      });
      assert.equal(rejectRes.status, 200);
      assert.equal(rejectRes.json.device.status, 'rejected');

      const listAfterReject = await req(baseUrl, 'GET', '/api/admin/devices', { token: adminToken });
      assert.equal(listAfterReject.status, 200);
      assert.ok(listAfterReject.json.summary.rejected >= 1);

      const loginRejected = await req(baseUrl, 'POST', '/api/auth/login', {
        headers: { 'X-Device-Id': devId },
        body: { username: 'admin_test', password: 'Password#123' },
      });
      assert.equal(loginRejected.status, 403);
      assert.equal(loginRejected.json.code, 'DEVICE_REJECTED');

      // 3) Admin can approve -> becomes active -> login & refresh succeed
      const approveRes = await req(baseUrl, 'POST', `/api/admin/devices/${devId}/approve`, {
        token: adminToken,
      });
      assert.equal(approveRes.status, 200);
      assert.equal(approveRes.json.device.status, 'active');

      const loginActive = await req(baseUrl, 'POST', '/api/auth/login', {
        headers: { 'X-Device-Id': devId },
        body: { username: 'admin_test', password: 'Password#123' },
      });
      assert.equal(loginActive.status, 200);
      const devAccess = loginActive.json.accessToken;
      const devRefresh = loginActive.json.refreshToken;
      assert.ok(devAccess && devRefresh);

      // 4) Disconnect device temporarily -> revokes device sessions, blocks API & refresh with DEVICE_DISCONNECTED
      const discRes = await req(baseUrl, 'POST', `/api/admin/devices/${devId}/disconnect`, {
        token: adminToken,
      });
      assert.equal(discRes.status, 200);
      assert.equal(discRes.json.device.status, 'disconnected');

      const listAfterDisc = await req(baseUrl, 'GET', '/api/admin/devices', { token: adminToken });
      assert.ok(listAfterDisc.json.summary.disconnected >= 1);

      const apiDisc = await req(baseUrl, 'GET', '/api/admin/devices', {
        token: devAccess,
        headers: { 'X-Device-Id': devId },
      });
      assert.equal(apiDisc.status, 403);
      assert.equal(apiDisc.json.code, 'DEVICE_DISCONNECTED');

      const refreshDisc = await req(baseUrl, 'POST', '/api/auth/refresh', {
        headers: { 'X-Device-Id': devId },
        body: { refreshToken: devRefresh, deviceId: devId },
      });
      assert.equal(refreshDisc.status, 403);
      assert.equal(refreshDisc.json.code, 'DEVICE_DISCONNECTED');

      // Re-approve from disconnected -> succeeds
      const reApprove = await req(baseUrl, 'POST', `/api/admin/devices/${devId}/approve`, {
        token: adminToken,
      });
      assert.equal(reApprove.status, 200);
      assert.equal(reApprove.json.device.status, 'active');

      // 5) Permanent revoke -> cannot be re-approved via /approve (409 DEVICE_REVOKED_REPAIR_REQUIRED) & blocks auth
      const revRes = await req(baseUrl, 'POST', `/api/admin/devices/${devId}/revoke`, {
        token: adminToken,
      });
      assert.equal(revRes.status, 200);
      assert.equal(revRes.json.device.status, 'revoked');

      const approveRevoked = await req(baseUrl, 'POST', `/api/admin/devices/${devId}/approve`, {
        token: adminToken,
      });
      assert.equal(approveRevoked.status, 409);
      assert.equal(approveRevoked.json.code, 'DEVICE_REVOKED_REPAIR_REQUIRED');

      const loginRevoked = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin_test', password: 'Password#123', deviceId: devId },
      });
      assert.equal(loginRevoked.status, 403);
      assert.equal(loginRevoked.json.code, 'DEVICE_REVOKED');
    });

    console.log('\n=== 7. Live Endpoint Reachability Verification & Non-Destructive Settings Update ===');

    await test('test-endpoint verifies AWLAD identity, rejects spoofed HTTP servers, unreachable hosts & enforces HTTPS on VPS', async () => {
      // 1) Valid live AWLAD server
      const okTest = await req(baseUrl, 'POST', '/api/admin/connection/test-endpoint', {
        token: adminToken,
        body: { mode: 'local_network', url: baseUrl },
      });
      assert.equal(okTest.status, 200);
      assert.equal(okTest.json.ok, true);
      assert.equal(okTest.json.reachable, true);
      assert.equal(okTest.json.companyName, 'شركة أولاد سليم للاختبار المعزول');

      // 2) Arbitrary HTTP server that is NOT AWLAD SELIM
      const dummyServer = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'SomeOtherApp' }));
      });
      await new Promise<void>((resolve) => dummyServer.listen(0, '127.0.0.1', resolve));
      const dummyPort = (dummyServer.address() as { port: number }).port;
      try {
        const notAwlad = await req(baseUrl, 'POST', '/api/admin/connection/test-endpoint', {
          token: adminToken,
          body: { mode: 'local_network', url: `http://127.0.0.1:${dummyPort}` },
        });
        assert.equal(notAwlad.status, 400);
        assert.equal(notAwlad.json.code, 'PAIRING_ENDPOINT_NOT_AWLAD');
      } finally {
        dummyServer.close();
      }

      // 3) Closed port (after dummyServer is closed)
      const unreachable = await req(baseUrl, 'POST', '/api/admin/connection/test-endpoint', {
        token: adminToken,
        body: { mode: 'local_network', url: `http://127.0.0.1:${dummyPort}` },
      });
      assert.equal(unreachable.status, 400);
      assert.equal(unreachable.json.code, 'PAIRING_ENDPOINT_UNREACHABLE');

      // 4) Cloud VPS rejects plain http:// when enforceHttps is true
      const vpsHttp = await req(baseUrl, 'POST', '/api/admin/connection/test-endpoint', {
        token: adminToken,
        body: { mode: 'cloud_vps', url: 'http://vps.awladselim.cloud', enforceHttps: true },
      });
      assert.equal(vpsHttp.status, 400);
      assert.equal(vpsHttp.json.code, 'HTTPS_REQUIRED_FOR_REMOTE');

      // 5) createPairingToken with verifyReachability=true rejects unreachable endpoint
      const verifyFail = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: {
          connectionMode: 'local_network',
          serverBaseUrl: `http://127.0.0.1:${dummyPort}`,
          verifyReachability: true,
        },
      });
      assert.equal(verifyFail.status, 400);
      assert.equal(verifyFail.json.code, 'PAIRING_ENDPOINT_UNREACHABLE');

      // 6) Updating connectionConfig to cloud_vps preserves existing customers/balances completely
      const settingsUpdate = await req(baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: {
          extraSettings: {
            connectionConfig: {
              activeMode: 'cloud_vps',
              configVersion: 9,
              cloudVps: { vpsUrl: 'https://vps.awladselim.cloud', notes: 'Production VPS' },
            },
          },
        },
      });
      assert.equal(settingsUpdate.status, 200);
      const afterDb = readJsonDatabase();
      const preservedCustomer = (afterDb.customers || []).find((c: any) => c.id === 'CUST_PRESERVE_01');
      assert.ok(preservedCustomer);
      assert.equal(preservedCustomer.balance, 4250.5);
    });

    console.log('\n=== 8. Electron Single-Instance Database PID Lock ===');

    await test('acquireDatabaseLock prevents concurrent PID collision, recovers stale locks, and releases cleanly', async () => {
      const { createRequire } = await import('node:module');
      const requireCjs = createRequire(import.meta.url);
      const { acquireDatabaseLock, releaseDatabaseLock } = requireCjs('../../electron/dataBootstrap.cjs');

      const lockTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_lock_test_'));
      try {
        // 1) Simulate stale lock from an exited PID -> should be cleaned & acquired
        const lockFile = path.join(lockTestDir, 'server.lock');
        fs.writeFileSync(lockFile, JSON.stringify({ pid: 9999999, startedAt: new Date().toISOString() }), 'utf8');
        const acquiredPath = acquireDatabaseLock(lockTestDir);
        assert.equal(acquiredPath, lockFile);
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        assert.equal(lockData.pid, process.pid);

        // 2) Simulate another live PID owning the lock -> must throw collision error
        fs.writeFileSync(lockFile, JSON.stringify({ pid: process.ppid || 1, startedAt: new Date().toISOString() }), 'utf8');
        assert.throws(
          () => acquireDatabaseLock(lockTestDir),
          /توجد نسخة أخرى من خادم AWLAD SELIM/
        );

        // 3) Releasing a foreign PID lock must NOT delete it
        releaseDatabaseLock(lockFile);
        assert.equal(fs.existsSync(lockFile), true);

        // 4) Own PID lock is released cleanly
        fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
        releaseDatabaseLock(lockFile);
        assert.equal(fs.existsSync(lockFile), false);
      } finally {
        fs.rmSync(lockTestDir, { recursive: true, force: true });
      }
    });

    console.log('\n=== 9. Universal Links, Uninstalled App Fallback, Reconnect URL Sync & Cross-Mode Financial Parity ===');

    await test('apple-app-site-association and /pair/:token platform download fallbacks work for Android/iOS/Windows', async () => {
      // Configure appDownloadUrls via system settings
      const dlUpdate = await req(baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: {
          extraSettings: {
            connectionConfig: {
              activeMode: 'local_network',
              localNetwork: { ip: '127.0.0.1', port: addr.port, hostname: 'erp-test' },
              deploymentProfile: {
                hostingLocation: 'laptop_windows',
                domainType: 'none',
                planTier: 'free',
                subscriptionStatus: 'none',
              },
              appDownloadUrls: {
                androidApkUrl: 'https://downloads.awladselim.com/awlad.apk',
                iosStoreUrl: 'https://testflight.apple.com/join/awladtest',
                windowsUrl: 'https://downloads.awladselim.com/awlad-setup.exe',
              },
            },
          },
        },
      });
      assert.equal(dlUpdate.status, 200);

      // 1) Apple Universal Links AASA
      const aasaRes = await req(baseUrl, 'GET', '/.well-known/apple-app-site-association');
      assert.equal(aasaRes.status, 200);
      assert.ok(Array.isArray(aasaRes.json?.applinks?.details));
      assert.deepEqual(aasaRes.json.applinks.details[0].paths, ['/pair/*', '/invite/*']);

      // 2) Create invite token and verify Android/iOS/Windows UA download blocks
      const created = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: { connectionMode: 'local_network', serverBaseUrl: baseUrl, singleUse: false },
      });
      assert.equal(created.status, 201);
      const rawToken = created.json.rawToken;

      const androidHtml = await req(baseUrl, 'GET', `/pair/${rawToken}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' },
      });
      assert.equal(androidHtml.status, 200);
      assert.ok(androidHtml.text.includes('https://downloads.awladselim.com/awlad.apk'));

      const iosHtml = await req(baseUrl, 'GET', `/invite/${rawToken}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
      });
      assert.equal(iosHtml.status, 200);
      assert.ok(iosHtml.text.includes('https://testflight.apple.com/join/awladtest'));
      assert.ok(iosHtml.text.includes('awladselim://pair?token='));

      const winHtml = await req(baseUrl, 'GET', `/pair/${rawToken}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      assert.equal(winHtml.status, 200);
      assert.ok(winHtml.text.includes('https://downloads.awladselim.com/awlad-setup.exe'));
    });

    await test('Auto-reconnect & configVersion sync switches saved URL when server URL changes after disconnect', async () => {
      memStorage.clear();

      // Stand up a second reachable endpoint simulating an updated server/VPS/tunnel target
      const app2 = createApiApp();
      const server2 = http.createServer(app2);
      await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve));
      const port2 = (server2.address() as { port: number }).port;
      const baseUrl2 = `http://127.0.0.1:${port2}`;

      try {
        // Device previously saved baseUrl with configVersion=1 and a dead primary endpoint + live fallback
        apiMod.setConfiguredApiBaseUrl('http://127.0.0.1:59999');
        apiMod.saveStoredConnectionProfiles({
          activeMode: 'free_remote',
          configVersion: 1,
          freeRemote: { tunnelUrl: 'http://127.0.0.1:59999', autoDetect: true },
        });
        apiMod.saveFallbackEndpoints([
          { mode: 'local_network', url: baseUrl2, label: 'Fallback Reachable' },
        ]);

        const recRes = await discoveryMod.syncConnectionConfigFromServer({ triggerHeartbeat: true });
        assert.equal(recRes.updated, true);
        assert.equal(recRes.switchedUrl, baseUrl2);
        assert.equal(apiMod.getConfiguredApiBaseUrl(), baseUrl2);
      } finally {
        server2.close();
      }
    });

    await test('Financial, inventory & invoice data remain 100% unified across all 4 modes and Admin/Rep/Customer logins', async () => {
      // Seed a warehouse, product, customer, and customer user cleanly via API
      const dbBefore = readJsonDatabase();
      if (!Array.isArray(dbBefore.warehouses) || dbBefore.warehouses.length === 0) {
        dbBefore.warehouses = [{ id: 'WH_UNIFIED_01', name: 'المخزن الرئيسي', isDefault: true }];
        writeJsonDatabase(dbBefore);
      }
      const whId = readJsonDatabase().warehouses[0].id;

      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'UNI-PRD-100',
          barcode: 'UNI-PRD-100',
          name: 'صنف اختبار التوحيد المركزي',
          category: 'عام',
          baseUnit: 'قطعة',
          purchasePrice: 70,
          sellingPrice: 100,
          stockPerWarehouse: { [whId]: 50 },
        },
      });
      assert.equal(prodRes.status, 201);
      const productId = prodRes.json.product.id;

      const custRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: {
          name: 'عميل التوحيد المركزي',
          phone: '01099887766',
          address: 'الجيزة',
          openingBalance: 0,
        },
      });
      assert.equal(custRes.status, 201);
      const customerId = custRes.json.customer.id;

      const custUserRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'حساب عميل التوحيد',
          username: 'cust_unified_01',
          password: 'CustPassword#123',
          role: 'customer',
          linkedCustomerId: customerId,
        },
      });
      assert.equal(custUserRes.status, 201);

      // Create & confirm a sales invoice of 5 units @ 100 = 500 on credit (paid=0)
      const invRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: adminToken,
        body: {
          customerId,
          warehouseId: whId,
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [
            {
              productId,
              productName: 'صنف اختبار التوحيد المركزي',
              unit: 'قطعة',
              unitFactor: 1,
              quantity: 5,
              unitPrice: 100,
            },
          ],
        },
      });
      assert.equal(invRes.status, 201);
      assert.equal(invRes.json.invoice.grandTotal, 500);

      // Switch across all 4 modes + deployment profiles without touching business tables
      for (const mode of ['local_network', 'free_remote', 'pro_remote', 'cloud_vps'] as const) {
        const sw = await req(baseUrl, 'PUT', '/api/admin/settings', {
          token: adminToken,
          body: {
            extraSettings: {
              connectionConfig: {
                activeMode: mode,
                deploymentProfile: {
                  hostingLocation: mode === 'cloud_vps' ? 'cloud_vps' : 'laptop_windows',
                  domainType: mode === 'free_remote' ? 'trycloudflare' : mode === 'local_network' ? 'none' : 'custom_domain',
                  planTier: mode === 'cloud_vps' ? 'enterprise_vps' : mode === 'pro_remote' ? 'pro' : 'free',
                  subscriptionStatus: mode === 'local_network' ? 'none' : 'active',
                },
              },
            },
          },
        });
        assert.equal(sw.status, 200);
      }

      // Log in as Customer & check Admin bootstrap -> verify same unified balance (500) and stock (45)
      const custLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'cust_unified_01', password: 'CustPassword#123' },
      });
      assert.equal(custLogin.status, 200);
      const custToken = custLogin.json.accessToken;

      const custStmt = await req(baseUrl, 'GET', '/api/customers/me/statement', { token: custToken });
      assert.equal(custStmt.status, 200);
      assert.equal(custStmt.json.summary.currentBalance, 500);

      const bootCheck = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(bootCheck.status, 200);
      const prodCheck = bootCheck.json.data.products.find((p: any) => p.id === productId);
      const custCheck = bootCheck.json.data.customers.find((c: any) => c.id === customerId);
      assert.equal(prodCheck.stockPerWarehouse[whId], 45);
      assert.equal(custCheck.currentBalance, 500);

      // Clean up temporary warehouse fallback test data inside isolated temp dir only
    });

    await test('Electron tunnel auto-start config persists opt-in inside dataDir without leaking secrets to discovery', async () => {
      const { createRequire } = await import('node:module');
      const requireCjs = createRequire(import.meta.url);
      const { readTunnelAutoStartConfig, writeTunnelAutoStartConfig } = requireCjs('../../electron/dataBootstrap.cjs');

      const tunDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_tunnel_cfg_'));
      try {
        const initial = readTunnelAutoStartConfig(tunDir);
        assert.equal(initial.enabled, false);

        const saved = writeTunnelAutoStartConfig(tunDir, {
          enabled: true,
          mode: 'pro_remote',
          token: 'super-secret-named-tunnel-token',
          domainUrl: 'https://erp.awladselim.com',
        });
        assert.equal(saved.enabled, true);
        assert.equal(saved.mode, 'pro_remote');
        assert.equal(saved.token, 'super-secret-named-tunnel-token');

        const reloaded = readTunnelAutoStartConfig(tunDir);
        assert.equal(reloaded.enabled, true);
        assert.equal(reloaded.domainUrl, 'https://erp.awladselim.com');

        // Confirm /api/connection/discovery NEVER contains any tunnel token secret
        const discRes = await req(baseUrl, 'GET', '/api/connection/discovery');
        assert.equal(discRes.status, 200);
        assert.equal(discRes.text.includes('super-secret-named-tunnel-token'), false);
      } finally {
        fs.rmSync(tunDir, { recursive: true, force: true });
      }
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

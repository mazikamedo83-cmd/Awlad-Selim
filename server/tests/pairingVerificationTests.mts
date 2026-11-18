import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
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
const nativeMod = await import('../../src/services/native.ts');
const supervisorMod = await import('../../scripts/tunnel-supervisor.mjs');

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

      // When selected mode matches activeMode AND its profile URL is empty, activeEndpoint STILL must NOT leak!
      const rSameAsActiveEmpty = apiMod.resolvePairingEndpointForMode({
        selectedMode: 'pro_remote',
        activeMode: 'pro_remote',
        profiles: unconfiguredProfiles,
        activeEndpoint: 'http://192.168.10.50:3000',
      });
      assert.equal(rSameAsActiveEmpty.effectiveMode, 'pro_remote');
      assert.equal(rSameAsActiveEmpty.endpointUrl, '');
      assert.equal(apiMod.validateConnectionUrl('pro_remote', rSameAsActiveEmpty.endpointUrl, true).valid, false);

      // Auto mode picks activeMode when valid, or falls back across valid configured profiles
      const rAutoActive = apiMod.resolvePairingEndpointForMode({
        selectedMode: 'auto',
        activeMode: 'free_remote',
        profiles,
        activeEndpoint: 'http://192.168.10.50:3000',
      });
      assert.equal(rAutoActive.effectiveMode, 'free_remote');
      assert.equal(rAutoActive.endpointUrl, 'https://awlad-test-tunnel.trycloudflare.com');

      const rAutoFallback = apiMod.resolvePairingEndpointForMode({
        selectedMode: 'auto',
        activeMode: 'free_remote',
        profiles: {
          ...profiles,
          activeMode: 'free_remote',
          freeRemote: { tunnelUrl: '' },
          proRemote: { domainUrl: '' },
        },
        activeEndpoint: '',
      });
      assert.equal(rAutoFallback.effectiveMode, 'cloud_vps');
      assert.equal(rAutoFallback.endpointUrl, 'https://vps.awladselim.cloud');
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
      assert.equal(apiMod.validateConnectionUrl('local_network', 'awlad-selim-server.local:3000', true).valid, true);
      assert.equal(apiMod.validateConnectionUrl('local_network', 'awlad-selim-server.local:3000', true).normalizedUrl, 'http://awlad-selim-server.local:3000');
      assert.equal(apiMod.validateConnectionUrl('cloud_vps', 'https://vps.awladselim.cloud', true).valid, true);
    });

    await test('parsePairingInput parses custom scheme, invite variants, triple-slash scheme, App Links /pair/ & /invite/, query pair_token, JSON, and raw token', () => {
      const p1 = discoveryMod.parsePairingInput(
        'awladselim://pair?token=tok_abc12345&server=https%3A%2F%2Ferp.awladselim.com'
      );
      assert.equal(p1?.token, 'tok_abc12345');
      assert.equal(p1?.serverUrl, 'https://erp.awladselim.com');

      const pInviteScheme = discoveryMod.parsePairingInput(
        'awladselim://invite?token=tok_inv_scheme1&server=https%3A%2F%2Ferp.awladselim.com'
      );
      assert.equal(pInviteScheme?.token, 'tok_inv_scheme1');
      assert.equal(pInviteScheme?.serverUrl, 'https://erp.awladselim.com');

      const pTriplePair = discoveryMod.parsePairingInput(
        'awladselim:///pair/tok_triple_99?server=https%3A%2F%2Ferp.awladselim.com'
      );
      assert.equal(pTriplePair?.token, 'tok_triple_99');
      assert.equal(pTriplePair?.serverUrl, 'https://erp.awladselim.com');

      const pTripleInvite = discoveryMod.parsePairingInput(
        'awladselim:///invite/tok_triple_77?server=https%3A%2F%2Fvps.awladselim.cloud'
      );
      assert.equal(pTripleInvite?.token, 'tok_triple_77');
      assert.equal(pTripleInvite?.serverUrl, 'https://vps.awladselim.cloud');

      // Missing token after awladselim://pair must return null (must NOT treat "pair" as token)
      assert.equal(discoveryMod.parsePairingInput('awladselim://pair'), null);
      assert.equal(discoveryMod.parsePairingInput('awladselim://invite'), null);

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
        // QR payload must NEVER contain JWTs (eyJ...), passwords, or token hashes
        assert.ok(!/eyJ[A-Za-z0-9_-]+\./.test(res.json.qrPayload), 'QR must not contain JWT');
        assert.ok(!/password|secret|tokenHash|refreshToken/i.test(res.json.qrPayload), 'QR must not contain secrets');
        assert.ok(
          res.json.deepLinkUrl.startsWith(
            `awladselim://pair?token=${encodeURIComponent(res.json.rawToken)}&server=${encodeURIComponent(expectedUrl)}`
          )
        );
      }

      // Auto mode on backend selects activeMode endpoint cleanly
      const autoRes = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: { connectionMode: 'auto', targetDeviceType: 'android' },
      });
      assert.equal(autoRes.status, 201);
      assert.equal(autoRes.json.tokenRecord.connectionMode, 'local_network');
      assert.equal(autoRes.json.serverBaseUrl, 'http://192.168.10.50:3000');

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

      // Reject unencrypted HTTP external domain BEFORE touching serverBaseUrl
      const badHttpRemoteClaim = await discoveryMod.claimPairingInvitation(
        'awladselim://pair?token=tok_http_block&server=http%3A%2F%2Fexternal-shop.example.com'
      );
      assert.equal(badHttpRemoteClaim.ok, false);
      assert.equal(apiMod.getConfiguredApiBaseUrl(), baseUrl);

      // Verify QR matrix encode -> jsQR decode -> parsePairingInput -> claimPairingInvitation round-trip for /invite/ link on Android device
      const createdInvite = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: {
          connectionMode: 'local_network',
          serverBaseUrl: baseUrl,
          targetDeviceType: 'android',
          singleUse: true,
        },
      });
      assert.equal(createdInvite.status, 201);
      const inviteUrl = `${baseUrl}/invite/${createdInvite.json.rawToken}`;
      const qrObj = QRCode.create(inviteUrl, { errorCorrectionLevel: 'M' });
      const modules = qrObj.modules;
      const scale = 4;
      const margin = 4;
      const dim = (modules.size + margin * 2) * scale;
      const rgba = new Uint8ClampedArray(dim * dim * 4);
      for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
          const mr = Math.floor(y / scale) - margin;
          const mc = Math.floor(x / scale) - margin;
          const dark = mr >= 0 && mr < modules.size && mc >= 0 && mc < modules.size ? modules.get(mr, mc) : false;
          const val = dark ? 0 : 255;
          const off = (y * dim + x) * 4;
          rgba[off] = val;
          rgba[off + 1] = val;
          rgba[off + 2] = val;
          rgba[off + 3] = 255;
        }
      }
      const decodedQr = jsQR(rgba, dim, dim);
      assert.equal(decodedQr?.data, inviteUrl);

      const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36' },
      });
      try {
        const inviteClaim = await discoveryMod.claimPairingInvitation(decodedQr!.data, { clearExistingAuth: true });
        assert.equal(inviteClaim.ok, true);
        assert.equal(inviteClaim.endpointUrl, baseUrl);
        assert.equal(apiMod.getStoredTokens(), null);
      } finally {
        if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
      }

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

      // PG mode preserves explicit serverBaseUrl distinct from saved profiles across resolve & claim
      const pgExplicit = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: pgAdminToken,
        body: {
          connectionMode: 'pro_remote',
          serverBaseUrl: 'https://explicit-branch.awladselim.com',
          targetDeviceType: 'android',
        },
      });
      assert.equal(pgExplicit.status, 201);
      assert.equal(pgExplicit.json.serverBaseUrl, 'https://explicit-branch.awladselim.com');

      const pgExplicitResolve = await req(baseUrl, 'GET', `/api/pairing/resolve/${pgExplicit.json.rawToken}`);
      assert.equal(pgExplicitResolve.status, 200);
      assert.equal(pgExplicitResolve.json.endpointUrl, 'https://explicit-branch.awladselim.com');

      const pgExplicitClaim = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: { token: pgExplicit.json.rawToken, deviceId: 'PG_DEV_03', deviceType: 'android' },
      });
      assert.equal(pgExplicitClaim.status, 200);
      assert.equal(pgExplicitClaim.json.endpointUrl, 'https://explicit-branch.awladselim.com');
      assert.equal(pgExplicitClaim.json.requiresLogin, true);

      // PG mode revoke blocks subsequent resolve/claim with 410
      const pgRevCreate = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: pgAdminToken,
        body: { connectionMode: 'local_network', targetDeviceType: 'any' },
      });
      assert.equal(pgRevCreate.status, 201);
      const pgRevRes = await req(baseUrl, 'POST', `/api/admin/pairing/tokens/${pgRevCreate.json.tokenRecord.id}/revoke`, {
        token: pgAdminToken,
      });
      assert.equal(pgRevRes.status, 200);
      const pgRevClaim = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: { token: pgRevCreate.json.rawToken, deviceId: 'PG_DEV_04', deviceType: 'android' },
      });
      assert.equal(pgRevClaim.status, 410);
      assert.equal(pgRevClaim.json.code, 'PAIRING_TOKEN_REVOKED');

      setInjectedPool(null);
      resetPgModeCache();
    });

    console.log('\n=== 6. Auto Tunnel Supervisor, /api/internal/tunnel-status & AASA Universal Links ===');

    await test('tunnel-supervisor extracts trycloudflare.com URLs and builds valid payloads', () => {
      const sampleLog = '2026-11-18T10:00:00Z INF |  https://awlad-shop-demo-123.trycloudflare.com  |';
      assert.equal(supervisorMod.extractQuickTunnelUrl(sampleLog), 'https://awlad-shop-demo-123.trycloudflare.com');
      assert.equal(supervisorMod.extractQuickTunnelUrl('no tunnel here'), '');

      const pQuick = supervisorMod.buildTunnelStatusPayload({
        mode: 'quick',
        status: 'online',
        tunnelUrl: 'https://awlad-shop-demo-123.trycloudflare.com/',
        localPort: 3000,
      });
      assert.equal(pQuick.provider, 'cloudflared_quick');
      assert.equal(pQuick.tunnelUrl, 'https://awlad-shop-demo-123.trycloudflare.com');

      const pNamed = supervisorMod.buildTunnelStatusPayload({
        mode: 'named',
        status: 'online',
        localPort: 3000,
      });
      assert.equal(pNamed.provider, 'cloudflared_named');
    });

    await test('POST /api/internal/tunnel-status rejects non-loopback unauthorized callers and auto-updates Quick Tunnel configVersion', async () => {
      const blockedAnon = await req(baseUrl, 'POST', '/api/internal/tunnel-status', {
        headers: { 'X-Forwarded-For': '203.0.113.20' },
        body: { status: 'online', tunnelUrl: 'https://rogue.trycloudflare.com' },
      });
      assert.equal(blockedAnon.status, 403);
      assert.equal(blockedAnon.json.code, 'FORBIDDEN_TUNNEL_UPDATE');

      const blockedRep = await req(baseUrl, 'POST', '/api/internal/tunnel-status', {
        token: repToken,
        headers: { 'X-Forwarded-For': '203.0.113.20' },
        body: { status: 'online', tunnelUrl: 'https://rogue.trycloudflare.com' },
      });
      assert.equal(blockedRep.status, 403);

      const beforeDiscovery = await req(baseUrl, 'GET', '/api/connection/discovery');
      const prevVer = Number(beforeDiscovery.json.configVersion || 1);

      const updateRes = await req(baseUrl, 'POST', '/api/internal/tunnel-status', {
        body: {
          status: 'online',
          provider: 'cloudflared_quick',
          tunnelUrl: 'https://awlad-auto-999.trycloudflare.com',
          localPort: addr.port,
        },
      });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.json.configUpdated, true);
      assert.equal(updateRes.json.tunnelStatus.status, 'online');

      const afterDiscovery = await req(baseUrl, 'GET', '/api/connection/discovery');
      assert.equal(afterDiscovery.json.profiles.freeRemote.tunnelUrl, 'https://awlad-auto-999.trycloudflare.com');
      assert.equal(afterDiscovery.json.profiles.freeRemote.autoDetect, true);
      assert.ok(Number(afterDiscovery.json.configVersion) > prevVer);

      // cloudflared_named must NOT overwrite freeRemote.tunnelUrl
      const namedRes = await req(baseUrl, 'POST', '/api/internal/tunnel-status', {
        body: {
          status: 'online',
          provider: 'cloudflared_named',
          tunnelUrl: 'https://erp.awladselim.com',
          localPort: addr.port,
        },
      });
      assert.equal(namedRes.status, 200);
      assert.equal(namedRes.json.configUpdated, false);
      const afterNamed = await req(baseUrl, 'GET', '/api/connection/discovery');
      assert.equal(afterNamed.json.profiles.freeRemote.tunnelUrl, 'https://awlad-auto-999.trycloudflare.com');
    });

    await test('apple-app-site-association and /pair/:token Windows/iOS/Android views serve expected deep/fallback links', async () => {
      process.env.APPLE_TEAM_ID = 'TEAM12345';
      process.env.IOS_BUNDLE_ID = 'com.awladselim.erp';
      const aasa = await req(baseUrl, 'GET', '/.well-known/apple-app-site-association');
      assert.equal(aasa.status, 200);
      assert.equal(aasa.json.applinks.details[0].appID, 'TEAM12345.com.awladselim.erp');
      assert.deepEqual(aasa.json.applinks.details[0].appIDs, ['TEAM12345.com.awladselim.erp']);
      assert.ok(aasa.json.applinks.details[0].paths.includes('/pair/*'));
      assert.ok(Array.isArray(aasa.json.applinks.details[0].components));
      delete process.env.APPLE_TEAM_ID;
      delete process.env.IOS_BUNDLE_ID;

      const created = await req(baseUrl, 'POST', '/api/admin/pairing/tokens', {
        token: adminToken,
        body: { connectionMode: 'local_network', serverBaseUrl: baseUrl, targetDeviceType: 'any' },
      });
      assert.equal(created.status, 201);

      const iosPage = await req(baseUrl, 'GET', `/pair/${created.json.rawToken}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
      });
      assert.equal(iosPage.status, 200);
      assert.ok(iosPage.text.includes('iPhone / iPad (iOS)'));
      assert.ok(iosPage.text.includes('copy-link-btn'));

      const winPage = await req(baseUrl, 'GET', `/pair/${created.json.rawToken}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      assert.equal(winPage.status, 200);
      assert.ok(winPage.text.includes('Windows Desktop'));
    });

    console.log('\n=== 7. Client Auto-Failover, Revoked Device API/Login Blocking & Unified Central DB ===');

    await test('syncConnectionConfigFromServer recovers from dead endpoint onto reachable fallback URL', async () => {
      memStorage.clear();
      // Configure dead primary URL + reachable fallback pointing to local test server
      apiMod.setConfiguredApiBaseUrl('http://127.0.0.1:59998');
      apiMod.saveFallbackEndpoints([{ mode: 'local_network', url: baseUrl, label: 'LAN Fallback' }]);

      const syncRes = await discoveryMod.syncConnectionConfigFromServer({ triggerHeartbeat: false });
      assert.equal(syncRes.updated, true);
      assert.equal(syncRes.switchedUrl, baseUrl);
      assert.equal(apiMod.getConfiguredApiBaseUrl(), baseUrl);
    });

    await test('Revoked device is blocked across login, authenticated API calls, and resend-link restores manual login', async () => {
      // Login rep with DEV_REP_LOCK -> auto-registers active device
      const loginOk = await req(baseUrl, 'POST', '/api/auth/login', {
        headers: { 'X-Device-Id': 'DEV_REP_LOCK' },
        body: { username: 'rep_test', password: 'RepPassword#123', deviceId: 'DEV_REP_LOCK', deviceName: 'Rep Phone', deviceType: 'android' },
      });
      assert.equal(loginOk.status, 200);
      const repSessionToken = loginOk.json.accessToken;

      const productsOk = await req(baseUrl, 'GET', '/api/products', {
        token: repSessionToken,
        headers: { 'X-Device-Id': 'DEV_REP_LOCK' },
      });
      assert.equal(productsOk.status, 200);

      // Admin revokes DEV_REP_LOCK
      const rev = await req(baseUrl, 'POST', '/api/admin/devices/DEV_REP_LOCK/revoke', { token: adminToken });
      assert.equal(rev.status, 200);

      // Existing token MUST be rejected (401/403)
      const blockedApi = await req(baseUrl, 'GET', '/api/products', {
        token: repSessionToken,
        headers: { 'X-Device-Id': 'DEV_REP_LOCK' },
      });
      assert.ok(blockedApi.status === 401 || blockedApi.status === 403);

      // Fresh login from revoked device MUST be rejected with 403 DEVICE_REVOKED
      const blockedLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        headers: { 'X-Device-Id': 'DEV_REP_LOCK' },
        body: { username: 'rep_test', password: 'RepPassword#123', deviceId: 'DEV_REP_LOCK', deviceType: 'android' },
      });
      assert.equal(blockedLogin.status, 403);
      assert.equal(blockedLogin.json.code, 'DEVICE_REVOKED');

      // Admin re-sends link -> device claims token (no auto-login!) -> manual login succeeds again
      const resend = await req(baseUrl, 'POST', '/api/admin/devices/DEV_REP_LOCK/resend-link', {
        token: adminToken,
        body: { connectionMode: 'local_network', serverBaseUrl: baseUrl },
      });
      assert.equal(resend.status, 201);

      const reClaim = await req(baseUrl, 'POST', '/api/pairing/claim', {
        body: { token: resend.json.rawToken, deviceId: 'DEV_REP_LOCK', deviceType: 'android', deviceName: 'Rep Phone' },
      });
      assert.equal(reClaim.status, 200);
      assert.equal(reClaim.json.requiresLogin, true);
      assert.equal(reClaim.json.accessToken, undefined);

      const loginRestored = await req(baseUrl, 'POST', '/api/auth/login', {
        headers: { 'X-Device-Id': 'DEV_REP_LOCK' },
        body: { username: 'rep_test', password: 'RepPassword#123', deviceId: 'DEV_REP_LOCK', deviceType: 'android' },
      });
      assert.equal(loginRestored.status, 200);
    });

    await test('Single unified central database serves Admin, Representative, and Customer accounts consistently', async () => {
      // Admin creates a product in central DB
      const createdProd = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: { code: 'UNIFIED-01', name: 'منتج موحد مركزي', baseUnit: 'كرتونة', purchasePrice: 90, sellingPrice: 110 },
      });
      assert.equal(createdProd.status, 201);

      // Rep sees exact same product from central DB
      const repProds = await req(baseUrl, 'GET', '/api/products', { token: repToken });
      assert.equal(repProds.status, 200);
      assert.ok(repProds.json.products.some((p: any) => p.code === 'UNIFIED-01'));

      // Admin creates customer + linked customer user and checks catalog & statement read from same DB
      const custRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { code: 'C-UNI-1', name: 'عميل موحد', phone: '01000001111', customerType: 'app', openingBalance: 0 },
      });
      assert.equal(custRes.status, 201);

      const custUserRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'حساب عميل موحد',
          username: 'cust_unified',
          password: 'CustPassword#123',
          role: 'customer',
          linkedCustomerId: custRes.json.customer.id,
          permissions: { canView: true },
        },
      });
      assert.equal(custUserRes.status, 201);

      const custLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'cust_unified', password: 'CustPassword#123' },
      });
      assert.equal(custLogin.status, 200);

      const custCatalog = await req(baseUrl, 'GET', '/api/products', { token: custLogin.json.accessToken });
      assert.equal(custCatalog.status, 200);
      assert.ok(custCatalog.json.products.some((p: any) => p.code === 'UNIFIED-01'));

      // Customer role RBAC check: blocked from admin & staff routes even after valid pairing/login
      const custAdminBlocked = await req(baseUrl, 'GET', '/api/admin/devices', { token: custLogin.json.accessToken });
      assert.equal(custAdminBlocked.status, 403);
    });

    await test('UI & Android contract checks: PairingAndDevicesPanel non-override, AndroidManifest, and on-demand QR camera helper', async () => {
      const panelSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/modules/settings/PairingAndDevicesPanel.tsx'), 'utf8');
      assert.ok(!panelSrc.includes('serverBaseUrl: activeEndpoint'), 'PairingAndDevicesPanel must NEVER pass serverBaseUrl: activeEndpoint directly');
      assert.ok(panelSrc.includes('resolvePairingEndpointForMode'), 'PairingAndDevicesPanel must use resolvePairingEndpointForMode');
      assert.ok(panelSrc.includes('targetUrlValidation.valid'), 'PairingAndDevicesPanel must preview and enforce URL validity before submission');

      const manifestSrc = fs.readFileSync(path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'), 'utf8');
      assert.ok(manifestSrc.includes('android:scheme="awladselim" android:host="pair"'));
      assert.ok(manifestSrc.includes('android:scheme="awladselim" android:host="invite"'));
      assert.ok(manifestSrc.includes('android.permission.CAMERA'));

      const appLinksManifest = fs.readFileSync(path.join(process.cwd(), 'android/app/src/applinks/AndroidManifest.xml'), 'utf8');
      assert.ok(appLinksManifest.includes('android:pathPrefix="/pair/"'));
      assert.ok(appLinksManifest.includes('android:pathPrefix="/invite/"'));

      // Camera helper handles OverconstrainedError fallback & NotAllowedError without premature launch
      const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      try {
        let calls = 0;
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: {
            userAgent: 'Android',
            mediaDevices: {
              getUserMedia: async () => {
                calls++;
                if (calls === 1) {
                  const err = new Error('Overconstrained');
                  err.name = 'OverconstrainedError';
                  throw err;
                }
                return { getTracks: () => [] };
              },
            },
          },
        });
        const camOk = await nativeMod.requestCameraStreamForQr();
        assert.equal(camOk.ok, true);
        assert.equal(calls, 2);

        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: {
            userAgent: 'Android',
            mediaDevices: {
              getUserMedia: async () => {
                const err = new Error('Denied');
                err.name = 'NotAllowedError';
                throw err;
              },
            },
          },
        });
        const camDenied = await nativeMod.requestCameraStreamForQr();
        assert.equal(camDenied.ok, false);
        if (!camDenied.ok) {
          assert.equal(camDenied.reason, 'permission_denied');
        }
      } finally {
        if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
      }
    });

    await test('Pre-build Android security, LAN-only HTTP enforcement, manifest gating, Java 21 & Debug workflow checks', async () => {
      // 1) App-layer LAN-only HTTP enforcement
      assert.equal(apiMod.isLocalOrIpHost('192.168.1.50:3000'), true);
      assert.equal(apiMod.isLocalOrIpHost('10.0.0.25:3000'), true);
      assert.equal(apiMod.isLocalOrIpHost('172.16.5.10:3000'), true);
      assert.equal(apiMod.isLocalOrIpHost('127.0.0.1:3000'), true);
      assert.equal(apiMod.isLocalOrIpHost('awlad-selim-server.local:3000'), true);
      assert.equal(apiMod.isLocalOrIpHost('203.0.113.10:3000'), false, 'Public IP must not be treated as LAN');
      assert.equal(apiMod.isLocalOrIpHost('8.8.8.8'), false, 'Public IP 8.8.8.8 must not be treated as LAN');
      assert.equal(apiMod.isLocalOrIpHost('erp.example.com'), false);

      memStorage.clear();
      apiMod.saveStoredConnectionProfiles({
        activeMode: 'local_network',
        localNetwork: { ip: '192.168.1.50', port: 3000, hostname: 'erp-lan' },
        freeRemote: { tunnelUrl: '' },
        proRemote: { domainUrl: '' },
        cloudVps: { vpsUrl: '', notes: '' },
        enforceHttpsForRemote: true,
      });

      const blockedPublicIp = await apiMod.testServerHealth('http://203.0.113.10:3000');
      assert.equal(blockedPublicIp.ok, false);
      assert.ok(blockedPublicIp.error?.includes('HTTPS'));

      const blockedRemoteDomain = await apiMod.testServerHealth('http://shop.example.com');
      assert.equal(blockedRemoteDomain.ok, false);
      assert.ok(blockedRemoteDomain.error?.includes('HTTPS'));

      // 2) AndroidManifest, network_security_config, and Capacitor config checks
      const manifestSrc = fs.readFileSync(path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'), 'utf8');
      assert.ok(manifestSrc.includes('android:networkSecurityConfig="@xml/network_security_config"'));
      assert.ok(!manifestSrc.includes('android:usesCleartextTraffic="true"'));
      assert.ok(!manifestSrc.includes('android:autoVerify="true"'));

      const netSecSrc = fs.readFileSync(path.join(process.cwd(), 'android/app/src/main/res/xml/network_security_config.xml'), 'utf8');
      assert.ok(netSecSrc.includes('<base-config cleartextTrafficPermitted="true">'));
      assert.ok(netSecSrc.includes('<debug-overrides>'));
      const baseBlockMatch = netSecSrc.match(/<base-config[\s\S]*?<\/base-config>/);
      assert.ok(baseBlockMatch && !baseBlockMatch[0].includes('certificates src="user"'), 'Release base-config must not trust user CAs');

      const capConfigTs = fs.readFileSync(path.join(process.cwd(), 'capacitor.config.ts'), 'utf8');
      assert.ok(!capConfigTs.includes('allowMixedContent'), 'allowMixedContent must never be enabled');

      // 3) Gradle manifest merge gating & Java 21 checks
      const appGradle = fs.readFileSync(path.join(process.cwd(), 'android/app/build.gradle'), 'utf8');
      assert.ok(appGradle.includes("manifest.srcFile 'src/applinks/AndroidManifest.xml'"));
      assert.ok(appGradle.includes('enableVerifiedAppLinks'));
      assert.ok(appGradle.includes("configuredAppLinkHost != 'awladselim.app'"));

      const capBuildGradle = fs.readFileSync(path.join(process.cwd(), 'android/app/capacitor.build.gradle'), 'utf8');
      assert.ok(capBuildGradle.includes('JavaVersion.VERSION_21'));

      // 4) GitHub Actions Debug APK workflow checks (no release signing, no App Links)
      const workflowYml = fs.readFileSync(path.join(process.cwd(), '.github/workflows/mobile-android.yml'), 'utf8');
      assert.ok(workflowYml.includes("java-version: '21'"));
      assert.ok(workflowYml.includes('./gradlew assembleDebug'));
      assert.ok(!workflowYml.includes('assembleRelease'));
      assert.ok(!workflowYml.includes('signingConfig'));
      assert.ok(workflowYml.includes("AWLAD_APP_LINK_HOST: ''"));
    });

    await test('Unified v3.0.0 Release readiness across Android, iOS, and Windows configs', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
      assert.equal(pkg.version, '3.0.0');
      assert.equal(pkg.build?.productName, 'AWLAD SELIM');
      assert.equal(pkg.build?.appId, 'com.awladselim.erp');
      assert.equal(pkg.build?.portable?.artifactName, 'AWLAD-SELIM-Portable-${version}.exe');

      const appGradle = fs.readFileSync(path.join(process.cwd(), 'android/app/build.gradle'), 'utf8');
      assert.ok(appGradle.includes('versionName "3.0.0"'));
      assert.ok(appGradle.includes('versionCode 3'));
      assert.ok(appGradle.includes('hasValidReleaseSigning'));
      assert.ok(appGradle.includes('signingConfigs.release'));
      assert.ok(!appGradle.includes('signingConfigs.debug'));

      const iosPlist = fs.readFileSync(path.join(process.cwd(), 'ios/App/App/Info.plist'), 'utf8');
      assert.ok(iosPlist.includes('<key>CFBundleDisplayName</key>') && iosPlist.includes('AWLAD SELIM'));
      assert.ok(iosPlist.includes('<key>CFBundleName</key>') && iosPlist.includes('<string>AWLAD SELIM</string>'));
      assert.ok(iosPlist.includes('<key>NSAllowsLocalNetworking</key>') && iosPlist.includes('<true/>'));
      assert.ok(!/<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/.test(iosPlist), 'NSAllowsArbitraryLoads must be false in Production');
      assert.ok(iosPlist.includes('<key>NSCameraUsageDescription</key>'));

      const privacyPlist = fs.readFileSync(path.join(process.cwd(), 'ios/App/App/PrivacyInfo.xcprivacy'), 'utf8');
      assert.ok(privacyPlist.includes('NSPrivacyAccessedAPICategoryUserDefaults'));

      const pbxproj = fs.readFileSync(path.join(process.cwd(), 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
      assert.ok(pbxproj.includes('MARKETING_VERSION = 3.0.0;'));
      assert.ok(pbxproj.includes('CURRENT_PROJECT_VERSION = 3;'));
      assert.ok(pbxproj.includes('CODE_SIGN_IDENTITY = "Apple Distribution";'));
      assert.ok(pbxproj.includes('PrivacyInfo.xcprivacy'));

      const androidRelYml = fs.readFileSync(path.join(process.cwd(), '.github/workflows/android-release.yml'), 'utf8');
      assert.ok(androidRelYml.includes('./gradlew assembleRelease'));
      assert.ok(androidRelYml.includes('apksigner') && androidRelYml.includes('verify --verbose --print-certs'));
      assert.ok(androidRelYml.includes('ANDROID_KEYSTORE_BASE64'));

      const iosRelYml = fs.readFileSync(path.join(process.cwd(), '.github/workflows/mobile-ios.yml'), 'utf8');
      assert.ok(iosRelYml.includes('macos-latest'));
      assert.ok(iosRelYml.includes('xcodebuild'));
      assert.ok(iosRelYml.includes('APPLE_TEAM_ID'));
      assert.ok(iosRelYml.includes('codesign --verify'));

      const winRelYml = fs.readFileSync(path.join(process.cwd(), '.github/workflows/windows-build.yml'), 'utf8');
      assert.ok(winRelYml.includes('AWLAD-SELIM-Setup-'));
      assert.ok(winRelYml.includes('AWLAD-SELIM-Portable-'));
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

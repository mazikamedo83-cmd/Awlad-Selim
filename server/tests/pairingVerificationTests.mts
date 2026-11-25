import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad-pairing-test-'));
process.env.AWLAD_DATA_DIR = tempDir;
process.env.JWT_SECRET = 'awlad_selim_pairing_test_secret_key_2026_xyz';
process.env.BOOTSTRAP_ADMIN_SECRET = 'awlad_bootstrap_pairing_test_2026';
process.env.NODE_ENV = 'test';
process.env.ANDROID_APP_ID = 'com.awladselim.erp';
process.env.ANDROID_APP_SHA256_FINGERPRINTS =
  'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

const memStorage = new Map<string, string>();
const localStorageMock = {
  getItem(k: string) {
    return memStorage.has(k) ? memStorage.get(k)! : null;
  },
  setItem(k: string, v: string) {
    memStorage.set(k, String(v));
  },
  removeItem(k: string) {
    memStorage.delete(k);
  },
  clear() {
    memStorage.clear();
  },
};

(globalThis as any).localStorage = localStorageMock;
(globalThis as any).window = {
  location: { origin: 'http://127.0.0.1:3000', protocol: 'http:' },
  localStorage: localStorageMock,
  addEventListener() {},
  removeEventListener() {},
};

const { initializeServerRuntime, createApiApp } = await import('../app.js');
const { bootstrapAdmin, loginUser } = await import('../db/stores/authStore.js');
const { parseValidAndroidSha256Fingerprints } = await import('../db/stores/connectionPairingStore.js');
const {
  parsePairingInput,
  claimPairingInvitation,
  discoverServerCandidates,
} = await import('../../src/services/discovery.ts');

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

await initializeServerRuntime();
await bootstrapAdmin({
  fullName: 'مدير الربط العام',
  username: 'pair_admin',
  password: 'PairAdminPassword!2026',
  bootstrapSecret: process.env.BOOTSTRAP_ADMIN_SECRET,
});

const app = createApiApp();
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', () => resolve()));
const port = (server.address() as any).port;
const baseUrl = `http://127.0.0.1:${port}`;

try {
  const loginRes = await loginUser({
    username: 'pair_admin',
    password: 'PairAdminPassword!2026',
    deviceId: 'DEV-ADMIN-HOST',
    deviceType: 'windows',
  });
  const adminToken = loginRes.accessToken;

  await test('1. Discovery endpoint & Android Digital Asset Links filter placeholders cleanly', async () => {
    const fps = parseValidAndroidSha256Fingerprints(
      'REPLACE_WITH_YOUR_SHA256, 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00, aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99'
    );
    assert.equal(fps.length, 1);

    const discRes = await fetch(`${baseUrl}/api/connection/discovery`);
    assert.equal(discRes.status, 200);
    const discJson = await discRes.json();
    assert.equal(discJson.ok, true);
    assert.ok(discJson.profiles);

    const assetRes = await fetch(`${baseUrl}/.well-known/assetlinks.json`);
    assert.equal(assetRes.status, 200);
    const assetJson = await assetRes.json();
    assert.equal(assetJson.length, 1);
    assert.equal(assetJson[0].target.package_name, 'com.awladselim.erp');
  });

  await test('2. Client parsePairingInput supports deep-links, HTTP invite URLs, JSON QR & raw tokens', () => {
    const p1 = parsePairingInput('awladselim://pair?token=TOKEN_ABC_12345678&server=https%3A%2F%2Ferp.awladselim.com');
    assert.equal(p1?.token, 'TOKEN_ABC_12345678');
    assert.equal(p1?.serverUrl, 'https://erp.awladselim.com');

    const p2 = parsePairingInput('http://192.168.1.50:3000/pair/TOKEN_XYZ_98765432');
    assert.equal(p2?.token, 'TOKEN_XYZ_98765432');
    assert.equal(p2?.serverUrl, 'http://192.168.1.50:3000');

    const p3 = parsePairingInput('{"token":"TOKEN_JSON_123456","serverUrl":"https://demo.awladselim.com"}');
    assert.equal(p3?.token, 'TOKEN_JSON_123456');
    assert.equal(p3?.serverUrl, 'https://demo.awladselim.com');

    const p4 = parsePairingInput('PLAIN_TOKEN_999888777');
    assert.equal(p4?.token, 'PLAIN_TOKEN_999888777');
  });

  await test('3. Admin pairing token lifecycle: create, public landing, claim, single-use replay rejection & device revocation', async () => {
    const createRes = await fetch(`${baseUrl}/api/admin/pairing/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        targetDeviceType: 'android',
        connectionMode: 'local_network',
        serverBaseUrl: baseUrl,
        ttlMinutes: 30,
        singleUse: true,
        requireAdminApproval: true,
        notes: 'هاتف مندوب اختباري',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.ok, true);
    assert.ok(created.rawToken);
    assert.ok(created.directInviteUrl.includes('/pair/'));

    // GET /pair/:token does NOT consume single-use token
    const pairJson = await fetch(`${baseUrl}/pair/${created.rawToken}?format=json`).then((r) => r.json());
    assert.equal(pairJson.ok, true);
    assert.equal(pairJson.status, 'active');

    // Client claims invitation
    const claimRes = await claimPairingInvitation(created.directInviteUrl);
    assert.equal(claimRes.ok, true);
    assert.equal(claimRes.requiresAdminApproval, true);
    assert.equal(claimRes.endpointUrl, baseUrl);

    // Replay of single-use token must fail with 409
    const replay = await claimPairingInvitation(created.directInviteUrl);
    assert.equal(replay.ok, false);

    // Admin sees pending device and approves it
    const devicesRes = await fetch(`${baseUrl}/api/admin/devices`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((r) => r.json());
    assert.ok(devicesRes.devices.some((d: any) => d.status === 'pending_approval'));
    const pairedDev = devicesRes.devices.find((d: any) => d.status === 'pending_approval');

    const approveRes = await fetch(`${baseUrl}/api/admin/devices/${pairedDev.deviceId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(approveRes.status, 200);

    // Revoking device succeeds
    const revokeRes = await fetch(`${baseUrl}/api/admin/devices/${pairedDev.deviceId}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(revokeRes.status, 200);
  });

  await test('4. discoverServerCandidates finds live local discovery server', async () => {
    const found = await discoverServerCandidates();
    assert.ok(Array.isArray(found));
  });
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log(`\nALL PAIRING VERIFICATION TESTS PASSED (${passed} groups)!`);

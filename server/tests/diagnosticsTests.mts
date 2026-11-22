import assert from 'node:assert/strict';

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

const diagMod = await import('../../src/services/diagnostics.ts');
const nativeMod = await import('../../src/services/native.ts');

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

async function main() {
  console.log('\n=== Diagnostics Redaction & GPS Reverse Geocode Verification ===');

  await test('logDiagnostic redacts secrets, tokens, passwords, Bearer JWTs, and query tokens', () => {
    diagMod.clearDiagnostics();
    const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.signaturepart99';
    const entry = diagMod.logDiagnostic({
      category: 'network_error',
      severity: 'error',
      source: 'apiRequest',
      message: `Failed with Authorization: Bearer ${fakeJwt} on https://erp.example.com/pair?pair_token=secret123`,
      details: {
        token: 'raw_access_token',
        refreshToken: 'raw_refresh_token',
        password: 'MySecretPassword!1',
        apiKey: 'secret_key',
        nested: {
          authorization: `Bearer ${fakeJwt}`,
          safeField: `hello ${fakeJwt}`,
        },
      },
    });

    const all = diagMod.getDiagnostics();
    assert.equal(all.length, 1);
    const dumped = JSON.stringify(all[0]);
    assert.ok(!dumped.includes('raw_access_token'));
    assert.ok(!dumped.includes('raw_refresh_token'));
    assert.ok(!dumped.includes('MySecretPassword'));
    assert.ok(!dumped.includes('secret_key'));
    assert.ok(!dumped.includes('secret123'));
    assert.ok(!dumped.includes(fakeJwt));
    assert.equal((entry.details as any).token, '[REDACTED]');
    assert.equal((entry.details as any).password, '[REDACTED]');
    assert.ok(entry.message.includes('Bearer [REDACTED]'));
    assert.ok(entry.message.includes('pair_token=[REDACTED]'));

    const exported = JSON.parse(diagMod.formatDiagnosticsExport());
    assert.equal(exported.count, 1);
  });

  await test('logDiagnostic enforces 300-entry ring buffer and clearDiagnostics empties store', () => {
    diagMod.clearDiagnostics();
    for (let i = 0; i < 310; i++) {
      diagMod.logDiagnostic({
        category: 'app_event',
        severity: 'info',
        source: 'ring_test',
        message: `event_${i}`,
      });
    }
    const entries = diagMod.getDiagnostics();
    assert.equal(entries.length, 300);
    assert.equal(entries[0].message, 'event_309');

    diagMod.clearDiagnostics();
    assert.equal(diagMod.getDiagnostics().length, 0);
  });

  await test('parseLatLngCoords & reverseGeocodeCoords fail honestly when offline/unhealthy without fabricating addresses', async () => {
    assert.deepEqual(nativeMod.parseLatLngCoords('30.786500, 31.000400'), { lat: 30.7865, lng: 31.0004 });
    assert.equal(nativeMod.parseLatLngCoords('not coordinates'), null);
    assert.equal(nativeMod.parseLatLngCoords('120.0, 31.0'), null);

    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new Error('Network unreachable');
      }) as any;
      const failRes = await nativeMod.reverseGeocodeCoords(30.7865, 31.0004);
      assert.equal(failRes.ok, false);
      if (!failRes.ok) {
        assert.ok(failRes.error && failRes.error.length > 0);
      }
      assert.equal('address' in failRes, false);

      globalThis.fetch = (async () => ({
        ok: true,
        json: async () => ({
          display_name: 'شارع النصر، طنطا، الغربية، مصر',
          address: { road: 'شارع النصر', city: 'طنطا', state: 'الغربية' },
        }),
      })) as any;
      const okRes = await nativeMod.reverseGeocodeCoords(30.7865, 31.0004);
      assert.equal(okRes.ok, true);
      assert.ok(okRes.address?.includes('شارع النصر'));
      assert.equal(okRes.area, 'طنطا');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  console.log(`\nALL DIAGNOSTICS & GPS TESTS PASSED: ${passed} / ${passed}`);
}

main().catch((err) => {
  console.error('\nDiagnostics & GPS test suite failed:', err);
  process.exit(1);
});

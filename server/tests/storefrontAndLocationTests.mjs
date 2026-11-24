import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_storefront_loc_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_storefront_and_location_tests_2026_secure';
for (const pgEnvKey of [
  'DATABASE_URL',
  'PG_CONNECTION_STRING',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
]) {
  delete process.env[pgEnvKey];
}

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');

let passed = 0;
async function test(name, fn) {
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

async function req(baseUrl, method, urlPath, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function createPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();
  return {
    async query(sql, params) {
      return memPool.query(sql, params);
    },
    async connect() {
      const client = await memPool.connect();
      return {
        query(sql, params) {
          return client.query(sql, params);
        },
        release() {
          client.release();
        },
      };
    },
  };
}

async function runSuite(modeLabel, pgPool = null) {
  console.log(`\n=== Storefront CMS, Promo Pricing, Favorites & Location Security Tests (${modeLabel}) ===`);
  if (pgPool) {
    setInjectedPool(pgPool);
    resetPgModeCache();
    const init = await initializeSchema();
    assert.equal(init.success, true, init.error || 'PG-mem schema init failed');
  } else {
    setInjectedPool(null);
    resetPgModeCache();
  }

  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const bootRes = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
      body: { fullName: 'مدير المتجر والنظام', username: 'sf_admin', password: 'StrongPassword!2026' },
    });
    assert.equal(bootRes.status, 201);

    const adminLogin = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { username: 'sf_admin', password: 'StrongPassword!2026' },
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.json.accessToken;

    const bootData = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    const whMainId = bootData.warehouses[0].id;

    // Create products for promo & regular price tests
    const p1Res = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        code: 'SF-101',
        name: 'زيت ذرة عافية 800 مل',
        category: 'زيوت وسمن',
        baseUnit: 'زجاجة',
        units: [{ id: 'u-ctn', name: 'كرتونة', conversionFactor: 12, sellingPrice: 1100, purchasePrice: 900 }],
        purchasePrice: 80,
        sellingPrice: 100,
        stockPerWarehouse: { [whMainId]: 200 },
      },
    });
    assert.equal(p1Res.status, 201);
    const prod1 = p1Res.json.product;

    // Restricted sales staff without canManageSettings
    const staffRes = await req(baseUrl, 'POST', '/api/admin/users', {
      token: adminToken,
      body: {
        username: 'sf_staff_no_settings',
        fullName: 'موظف بدون صلاحية إعدادات',
        password: 'StrongPassword!2026',
        role: 'sales',
        permissions: { canView: true, canManageSales: true, canManageSettings: false },
      },
    });
    assert.equal(staffRes.status, 201);
    const staffToken = (
      await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'sf_staff_no_settings', password: 'StrongPassword!2026' },
      })
    ).json.accessToken;

    let custAToken;
    let custAId;
    let custBToken;

    await test(`[${modeLabel}] 1. Registration & Customer geolocation strictly reject (0, 0) while persisting valid Egypt coords`, async () => {
      // Registration with (0,0) rejected
      const badReg1 = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'عميل موقع صفري',
          username: 'cust_zero_1',
          password: 'StrongPassword!2026',
          phone: '01011122233',
          latitude: 0,
          longitude: 0,
        },
      });
      assert.equal(badReg1.status, 400);
      assert.equal(badReg1.json.code, 'ZERO_ZERO_COORDINATES');

      const badReg2 = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'عميل إحداثي صفري',
          username: 'cust_zero_2',
          password: 'StrongPassword!2026',
          phone: '01011122234',
          geoCoordinates: '0, 0',
        },
      });
      assert.equal(badReg2.status, 400);
      assert.equal(badReg2.json.code, 'ZERO_ZERO_COORDINATES');

      // Valid customer A registration with Cairo coords
      const regA = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'سوبرماركت الفجر',
          shopName: 'سوبرماركت الفجر',
          username: 'cust_fagr',
          password: 'StrongPassword!2026',
          phone: '01011122235',
          address: 'شارع الثورة - مصر الجديدة',
          area: 'مصر الجديدة',
          city: 'القاهرة',
          governorate: 'القاهرة',
          latitude: 30.0888,
          longitude: 31.3372,
          geoCoordinates: '30.0888, 31.3372',
        },
      });
      assert.equal(regA.status, 201);
      custAToken = regA.json.accessToken;

      const meA = await req(baseUrl, 'GET', '/api/customers/me', { token: custAToken });
      assert.equal(meA.status, 200);
      custAId = meA.json.customer.id;
      assert.equal(meA.json.customer.latitude, 30.0888);
      assert.equal(meA.json.customer.longitude, 31.3372);
      assert.equal(meA.json.customer.city, 'القاهرة');

      // Admin customer creation with (0, 0) rejected
      const badCreate = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: {
          name: 'عميل خطأ',
          phone: '01099988811',
          latitude: 0,
          longitude: 0,
        },
      });
      assert.equal(badCreate.status, 400);
      assert.equal(badCreate.json.code, 'ZERO_ZERO_COORDINATES');

      // Customer self-update with (0, 0) rejected
      const badSelfUpdate = await req(baseUrl, 'PUT', '/api/customers/me', {
        token: custAToken,
        body: { geoCoordinates: '0,0' },
      });
      assert.equal(badSelfUpdate.status, 400);
      assert.equal(badSelfUpdate.json.code, 'ZERO_ZERO_COORDINATES');

      // Admin update customer with (0, 0) rejected
      const badAdminUpdate = await req(baseUrl, 'PUT', `/api/customers/${custAId}`, {
        token: adminToken,
        body: { latitude: 0, longitude: 0 },
      });
      assert.equal(badAdminUpdate.status, 400);
      assert.equal(badAdminUpdate.json.code, 'ZERO_ZERO_COORDINATES');

      // Register Customer B for isolation tests
      const regB = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'أسواق الهدى',
          username: 'cust_hoda',
          password: 'StrongPassword!2026',
          phone: '01011122236',
        },
      });
      assert.equal(regB.status, 201);
      custBToken = regB.json.accessToken;
    });

    await test(`[${modeLabel}] 2. Maps config & reverse-geocode (0, 0) protection`, async () => {
      const cfg = await req(baseUrl, 'GET', '/api/maps/config');
      assert.equal(cfg.status, 200);
      assert.equal(cfg.json.ok, true);
      assert.equal(cfg.json.mapId, 'DEMO_MAP_ID');
      assert.equal(cfg.json.attributionId, 'gmp_mcp_codeassist_v1_aistudio');

      const badRev = await req(baseUrl, 'GET', '/api/maps/reverse-geocode?lat=0&lng=0');
      assert.equal(badRev.status, 400);
      assert.equal(badRev.json.code, 'ZERO_ZERO_COORDINATES');
    });

    await test(`[${modeLabel}] 3. Storefront Draft -> Live Publish workflow, RBAC & Validation`, async () => {
      // Unauthenticated rejected
      const unauth = await req(baseUrl, 'GET', '/api/storefront/published');
      assert.equal(unauth.status, 401);

      // Customer & staff without canManageSettings blocked from CMS admin endpoints
      for (const tk of [custAToken, staffToken]) {
        const g = await req(baseUrl, 'GET', '/api/storefront/admin', { token: tk });
        assert.equal(g.status, 403);
        const d = await req(baseUrl, 'PUT', '/api/storefront/draft', { token: tk, body: { banners: [] } });
        assert.equal(d.status, 403);
        const p = await req(baseUrl, 'POST', '/api/storefront/publish', { token: tk, body: {} });
        assert.equal(p.status, 403);
      }

      // Invalid XSS image scheme or non-positive promo rejected
      const badImg = await req(baseUrl, 'PUT', '/api/storefront/draft', {
        token: adminToken,
        body: {
          banners: [{ title: 'بانر سيء', imageUrl: 'javascript:alert(1)' }],
        },
      });
      assert.equal(badImg.status, 400);
      assert.equal(badImg.json.code, 'INVALID_STOREFRONT_IMAGE');

      const badOffer = await req(baseUrl, 'PUT', '/api/storefront/draft', {
        token: adminToken,
        body: {
          offers: [{ productId: prod1.id, unit: 'كرتونة', promoPrice: -5 }],
        },
      });
      assert.equal(badOffer.status, 400);
      assert.equal(badOffer.json.code, 'INVALID_PROMO_PRICE');

      // Save Draft with real offer & banner -> Customer published remains clean (0 banners, 0 offers)
      const draftPayload = {
        offersSectionTitle: 'عروض مخصصة عشانك',
        banners: [
          {
            title: 'مهرجان التوفير',
            subtitle: 'خصومات حقيقية على الكرتونة',
            imageUrl: '/awlad-selim-logo.png',
            targetType: 'offers',
            isActive: true,
          },
        ],
        offers: [
          {
            productId: prod1.id,
            unit: 'كرتونة',
            badgeText: 'عرض عشانك',
            promoPrice: 950,
            originalPriceSnapshot: 1100,
            isActive: true,
          },
          {
            // Inactive/paused offer must NOT be applied on server
            productId: prod1.id,
            unit: 'زجاجة',
            badgeText: 'عرض متوقف',
            promoPrice: 50,
            originalPriceSnapshot: 100,
            isActive: false,
          },
        ],
        displayCategories: [
          {
            title: 'تجهيزات رمضان',
            productIds: [prod1.id],
            linkedCategoryNames: ['زيوت وسمن'],
            isVisible: true,
          },
        ],
        featuredProductIds: [prod1.id],
      };

      const saveDraftRes = await req(baseUrl, 'PUT', '/api/storefront/draft', {
        token: adminToken,
        body: draftPayload,
      });
      assert.equal(saveDraftRes.status, 200);
      assert.equal(saveDraftRes.json.draft.banners.length, 1);

      const pubBefore = await req(baseUrl, 'GET', '/api/storefront/published', { token: custAToken });
      assert.equal(pubBefore.status, 200);
      assert.equal(pubBefore.json.storefront.banners.length, 0, 'Unpublished draft must not leak to customers');
      assert.equal(pubBefore.json.storefront.offers.length, 0);

      // Publish Storefront -> Customer now sees published version >= 1
      const pubRes = await req(baseUrl, 'POST', '/api/storefront/publish', {
        token: adminToken,
        body: draftPayload,
      });
      assert.equal(pubRes.status, 200);
      assert.ok(pubRes.json.published.version >= 1);

      const pubAfter = await req(baseUrl, 'GET', '/api/storefront/published', { token: custAToken });
      assert.equal(pubAfter.status, 200);
      assert.equal(pubAfter.json.storefront.banners.length, 1);
      assert.equal(pubAfter.json.storefront.offers.length, 2);
      assert.equal(pubAfter.json.storefront.displayCategories.length, 1);
    });

    await test(`[${modeLabel}] 4. Server enforces active storefront promo price & rejects spoofed/inactive offer prices`, async () => {
      // Customer attempts to order 2 cartons (tampering unitPrice: 1) and 3 bottles (where promoPrice: 50 is inactive)
      const ordRes = await req(baseUrl, 'POST', '/api/orders', {
        token: custAToken,
        body: {
          items: [
            { productId: prod1.id, unit: 'كرتونة', quantity: 2, unitPrice: 1 },
            { productId: prod1.id, unit: 'زجاجة', quantity: 3, unitPrice: 50 },
          ],
          notes: 'طلب متجر باختبار تسعير العروض',
        },
      });
      assert.equal(ordRes.status, 201);
      const ord = ordRes.json.order;

      const ctnLine = ord.items.find((i) => i.unit === 'كرتونة');
      const btlLine = ord.items.find((i) => i.unit === 'زجاجة');
      assert.equal(ctnLine.unitPrice, 950, 'Server MUST apply active published promoPrice 950 for carton');
      assert.equal(ctnLine.unitPrice * ctnLine.quantity, 1900);
      assert.equal(btlLine.unitPrice, 100, 'Inactive offer MUST fall back to regular bottle price 100');
      assert.equal(btlLine.unitPrice * btlLine.quantity, 300);
      assert.equal(ord.totalAmount, 2200);
    });

    await test(`[${modeLabel}] 5. Customer favorites persist per-customer & reject non-customer roles`, async () => {
      // Staff blocked from modifying customer favorites
      const staffToggle = await req(baseUrl, 'POST', '/api/storefront/favorites/toggle', {
        token: staffToken,
        body: { productId: prod1.id },
      });
      assert.equal(staffToggle.status, 403);

      // Customer A toggles prod1 ON
      const togOn = await req(baseUrl, 'POST', '/api/storefront/favorites/toggle', {
        token: custAToken,
        body: { productId: prod1.id },
      });
      assert.equal(togOn.status, 200);
      assert.equal(togOn.json.isFavorite, true);
      assert.deepEqual(togOn.json.favoriteProductIds, [prod1.id]);

      // Customer A persists on GET; Customer B remains isolated (empty)
      const favA = await req(baseUrl, 'GET', '/api/storefront/favorites', { token: custAToken });
      assert.equal(favA.status, 200);
      assert.deepEqual(favA.json.favoriteProductIds, [prod1.id]);

      const favB = await req(baseUrl, 'GET', '/api/storefront/favorites', { token: custBToken });
      assert.equal(favB.status, 200);
      assert.deepEqual(favB.json.favoriteProductIds, []);

      // Customer A toggles prod1 OFF
      const togOff = await req(baseUrl, 'POST', '/api/storefront/favorites/toggle', {
        token: custAToken,
        body: { productId: prod1.id },
      });
      assert.equal(togOff.status, 200);
      assert.equal(togOff.json.isFavorite, false);
      assert.deepEqual(togOff.json.favoriteProductIds, []);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  await runSuite('JSON_LEDGER');
  await runSuite('POSTGRES_PG_MEM', createPgMemPool());
  console.log(`\nALL STOREFRONT & LOCATION TESTS PASSED (${passed} checks)\n`);
} finally {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}

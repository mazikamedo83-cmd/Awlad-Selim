import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_groups_cats_test_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_product_groups_and_categories_2026_secure';

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
const { readJsonDatabase, writeJsonDatabase } = await import('../db/jsonLedger.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { runDataMigration } = await import('../db/migrator.js');
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

async function runCoreSuite(modeLabel, baseUrl) {
  let adminToken = '';
  let whId = '';
  let cbId = '';
  let custId = '';
  let suppId = '';

  await test(`[${modeLabel}] 1. Fresh database has zero seeded productGroups, categories, or sample products`, async () => {
    const bootRes = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
      body: { fullName: 'مدير الاختبار', username: 'grp_admin', password: 'Password123!' },
    });
    assert.equal(bootRes.status, 201);

    const loginRes = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { username: 'grp_admin', password: 'Password123!' },
    });
    assert.equal(loginRes.status, 200);
    adminToken = loginRes.json.accessToken;

    const boot = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
    assert.equal(boot.status, 200);
    assert.deepEqual(boot.json.data.productGroups, []);
    assert.deepEqual(boot.json.data.categories, []);
    assert.deepEqual(boot.json.data.products, []);

    const groupsRes = await req(baseUrl, 'GET', '/api/products/groups', { token: adminToken });
    assert.equal(groupsRes.status, 200);
    assert.deepEqual(groupsRes.json.productGroups, []);

    const catsRes = await req(baseUrl, 'GET', '/api/products/categories', { token: adminToken });
    assert.equal(catsRes.status, 200);
    assert.deepEqual(catsRes.json.categories, []);

    // Setup operational warehouse, cashbox, customer, supplier
    const whRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
      token: adminToken,
      body: { name: 'المخزن الرئيسي', code: 'WH-G1', isDefault: true },
    });
    assert.equal(whRes.status, 201);
    whId = whRes.json.warehouse.id;

    const cbRes = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
      token: adminToken,
      body: { name: 'الخزينة الرئيسية', type: 'cashbox', openingBalance: 10000, isDefault: true },
    });
    assert.equal(cbRes.status, 201);
    cbId = cbRes.json.cashbox.id;

    const custRes = await req(baseUrl, 'POST', '/api/customers', {
      token: adminToken,
      body: { code: 'CG-1', name: 'عميل المجموعات', phone: '01099001122', address: 'القاهرة' },
    });
    assert.equal(custRes.status, 201);
    custId = custRes.json.customer.id;

    const suppRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
      token: adminToken,
      body: { code: 'SG-1', name: 'مورد المجموعات', phone: '01088001122' },
    });
    assert.equal(suppRes.status, 201);
    suppId = suppRes.json.supplier.id;
  });

  let grpA, grpB, grpEmpty;
  let catA1, catB1, catEmpty;

  await test(`[${modeLabel}] 2. Product Group CRUD, Arabic duplicate guard, suspend/activate`, async () => {
    const gA = await req(baseUrl, 'POST', '/api/products/groups', {
      token: adminToken,
      body: { name: 'شركة تايجر', description: 'شركة أولى' },
    });
    assert.equal(gA.status, 201);
    grpA = gA.json.productGroup;
    assert.equal(grpA.status, 'active');

    // Duplicate with Arabic Alef/Hamza variation must fail with 409
    const dupA = await req(baseUrl, 'POST', '/api/products/groups', {
      token: adminToken,
      body: { name: '  شركة تايجر  ' },
    });
    assert.equal(dupA.status, 409);
    assert.equal(dupA.json.code, 'DUPLICATE_GROUP');

    const gB = await req(baseUrl, 'POST', '/api/products/groups', {
      token: adminToken,
      body: { name: 'شركة شيبسي' },
    });
    assert.equal(gB.status, 201);
    grpB = gB.json.productGroup;

    const gE = await req(baseUrl, 'POST', '/api/products/groups', {
      token: adminToken,
      body: { name: 'مجموعة مؤقتة' },
    });
    assert.equal(gE.status, 201);
    grpEmpty = gE.json.productGroup;

    // Suspend & reactivate grpEmpty
    const susp = await req(baseUrl, 'PUT', `/api/products/groups/${grpEmpty.id}`, {
      token: adminToken,
      body: { status: 'suspended' },
    });
    assert.equal(susp.status, 200);
    assert.equal(susp.json.productGroup.status, 'suspended');

    const react = await req(baseUrl, 'PUT', `/api/products/groups/${grpEmpty.id}`, {
      token: adminToken,
      body: { status: 'active' },
    });
    assert.equal(react.status, 200);
    assert.equal(react.json.productGroup.status, 'active');

    // Delete empty group succeeds
    const delEmpty = await req(baseUrl, 'DELETE', `/api/products/groups/${grpEmpty.id}`, {
      token: adminToken,
    });
    assert.equal(delEmpty.status, 200);
  });

  await test(`[${modeLabel}] 3. Linked Categories scoped per Group & safe delete protection`, async () => {
    // Same category name allowed in two distinct groups
    const c1 = await req(baseUrl, 'POST', '/api/products/categories', {
      token: adminToken,
      body: { name: 'شيبسي عائلي', groupId: grpA.id },
    });
    assert.equal(c1.status, 201);
    catA1 = c1.json.category;
    assert.equal(catA1.groupId, grpA.id);
    assert.equal(catA1.groupName, grpA.name);

    const c2 = await req(baseUrl, 'POST', '/api/products/categories', {
      token: adminToken,
      body: { name: 'شيبسي عائلي', groupId: grpB.id },
    });
    assert.equal(c2.status, 201);
    catB1 = c2.json.category;
    assert.equal(catB1.groupId, grpB.id);
    assert.equal(catB1.groupName, grpB.name);

    // Duplicate inside the SAME group rejected
    const dupCat = await req(baseUrl, 'POST', '/api/products/categories', {
      token: adminToken,
      body: { name: 'شيبسى عائلى', groupId: grpA.id },
    });
    assert.equal(dupCat.status, 409);
    assert.equal(dupCat.json.code, 'DUPLICATE_CATEGORY');

    // Group in use by category cannot be deleted
    const delGrpInUse = await req(baseUrl, 'DELETE', `/api/products/groups/${grpA.id}`, {
      token: adminToken,
    });
    assert.equal(delGrpInUse.status, 409);
    assert.equal(delGrpInUse.json.code, 'GROUP_IN_USE');

    // Create & safely delete an empty category
    const cEmpty = await req(baseUrl, 'POST', '/api/products/categories', {
      token: adminToken,
      body: { name: 'تصنيف فارغ', groupId: grpB.id },
    });
    assert.equal(cEmpty.status, 201);
    catEmpty = cEmpty.json.category;
    const delEmptyCat = await req(baseUrl, 'DELETE', `/api/products/categories/${catEmpty.id}`, {
      token: adminToken,
    });
    assert.equal(delEmptyCat.status, 200);
  });

  let prodA, prodB;

  await test(`[${modeLabel}] 4. Product create/edit validates Group-Category link & preserves stock on reassign`, async () => {
    // Mismatched groupId (grpA) + categoryId (catB1 belonging to grpB) MUST fail with 400 CATEGORY_GROUP_MISMATCH
    const mismatchRes = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        code: 'BAD-1',
        name: 'صنف متعارض',
        groupId: grpA.id,
        categoryId: catB1.id,
        baseUnit: 'كرتونة',
        purchasePrice: 50,
        sellingPrice: 60,
      },
    });
    assert.equal(mismatchRes.status, 400);
    assert.equal(mismatchRes.json.code, 'CATEGORY_GROUP_MISMATCH');

    // Valid Product under grpA / catA1
    const pA = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        code: 'TG-1',
        name: 'تايجر بالجبنة',
        groupId: grpA.id,
        categoryId: catA1.id,
        baseUnit: 'كرتونة',
        purchasePrice: 80,
        sellingPrice: 100,
        stockPerWarehouse: { [whId]: 50 },
      },
    });
    assert.equal(pA.status, 201);
    prodA = pA.json.product;
    assert.equal(prodA.groupId, grpA.id);
    assert.equal(prodA.groupName, grpA.name);
    assert.equal(prodA.categoryId, catA1.id);
    assert.equal(prodA.category, catA1.name);

    // Valid Product under grpB / catB1
    const pB = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        code: 'CH-1',
        name: 'شيبسي بالملح',
        groupId: grpB.id,
        categoryId: catB1.id,
        baseUnit: 'كرتونة',
        purchasePrice: 90,
        sellingPrice: 110,
        stockPerWarehouse: { [whId]: 30 },
      },
    });
    assert.equal(pB.status, 201);
    prodB = pB.json.product;

    // Deleting category in use by product MUST be rejected
    const delCatInUse = await req(baseUrl, 'DELETE', `/api/products/categories/${catA1.id}`, {
      token: adminToken,
    });
    assert.equal(delCatInUse.status, 409);
    assert.equal(delCatInUse.json.code, 'CATEGORY_IN_USE');

    // Moving prodB to grpA / catA1 and back preserves stockPerWarehouse = 30
    const moveRes = await req(baseUrl, 'PUT', `/api/products/${prodB.id}`, {
      token: adminToken,
      body: { groupId: grpA.id, categoryId: catA1.id },
    });
    assert.equal(moveRes.status, 200);
    assert.equal(moveRes.json.product.groupId, grpA.id);
    assert.equal(moveRes.json.product.categoryId, catA1.id);
    assert.equal(moveRes.json.product.stockPerWarehouse[whId], 30);

    const moveBack = await req(baseUrl, 'PUT', `/api/products/${prodB.id}`, {
      token: adminToken,
      body: { groupId: grpB.id, categoryId: catB1.id },
    });
    assert.equal(moveBack.status, 200);
    prodB = moveBack.json.product;
    assert.equal(prodB.stockPerWarehouse[whId], 30);
  });

  let salesInv, salesRet;

  await test(`[${modeLabel}] 5. Invoices & Returns stamp immutable Group/Category snapshots before rename`, async () => {
    // Sales Invoice for prodA
    const invRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
      token: adminToken,
      body: {
        customerId: custId,
        warehouseId: whId,
        cashboxId: cbId,
        status: 'confirmed',
        paymentType: 'cash',
        paidAmount: 200,
        items: [
          {
            productId: prodA.id,
            productName: prodA.name,
            unit: 'كرتونة',
            unitFactor: 1,
            quantity: 2,
            unitPrice: 100,
          },
        ],
      },
    });
    assert.equal(invRes.status, 201);
    salesInv = invRes.json.invoice;
    assert.equal(salesInv.items[0].groupId, grpA.id);
    assert.equal(salesInv.items[0].groupName, 'شركة تايجر');
    assert.equal(salesInv.items[0].categoryId, catA1.id);
    assert.equal(salesInv.items[0].categoryName, 'شيبسي عائلي');

    // Sales Return for prodA
    const retRes = await req(baseUrl, 'POST', '/api/invoices/returns', {
      token: adminToken,
      body: {
        type: 'sales_return',
        originalInvoiceId: salesInv.id,
        originalInvoiceNumber: salesInv.invoiceNumber,
        partyId: custId,
        partyName: 'عميل المجموعات',
        warehouseId: whId,
        refundType: 'balance',
        reason: 'مرتجع اختبار التصنيف',
        items: [
          {
            productId: prodA.id,
            productName: prodA.name,
            unit: 'كرتونة',
            unitFactor: 1,
            quantity: 1,
            unitPrice: 100,
            total: 100,
          },
        ],
        grandTotal: 100,
      },
    });
    assert.equal(retRes.status, 201);
    salesRet = retRes.json.invoiceReturn;
    assert.equal(salesRet.items[0].groupId, grpA.id);
    assert.equal(salesRet.items[0].groupName, 'شركة تايجر');
    assert.equal(salesRet.items[0].categoryId, catA1.id);
    assert.equal(salesRet.items[0].categoryName, 'شيبسي عائلي');

    // Purchase Invoice for prodB
    const purRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
      token: adminToken,
      body: {
        supplierId: suppId,
        warehouseId: whId,
        cashboxId: cbId,
        status: 'confirmed',
        paymentType: 'cash',
        paidAmount: 450,
        items: [
          {
            productId: prodB.id,
            productName: prodB.name,
            unit: 'كرتونة',
            unitFactor: 1,
            quantity: 5,
            unitPrice: 90,
          },
        ],
      },
    });
    assert.equal(purRes.status, 201);
    assert.equal(purRes.json.invoice.items[0].groupId, grpB.id);
    assert.equal(purRes.json.invoice.items[0].groupName, 'شركة شيبسي');
    assert.equal(purRes.json.invoice.items[0].categoryId, catB1.id);
    assert.equal(purRes.json.invoice.items[0].categoryName, 'شيبسي عائلي');
  });

  await test(`[${modeLabel}] 6. Renaming Group & Category updates current catalog only; historical snapshots stay immutable`, async () => {
    const renGrp = await req(baseUrl, 'PUT', `/api/products/groups/${grpA.id}`, {
      token: adminToken,
      body: { name: 'تايجر مصر المعدلة' },
    });
    assert.equal(renGrp.status, 200);

    const renCat = await req(baseUrl, 'PUT', `/api/products/categories/${catA1.id}`, {
      token: adminToken,
      body: { name: 'سناكس عائلي مطور' },
    });
    assert.equal(renCat.status, 200);

    // Current product updated
    const prodsAfter = (await req(baseUrl, 'GET', '/api/products', { token: adminToken })).json.products;
    const updatedProdA = prodsAfter.find((p) => p.id === prodA.id);
    assert.equal(updatedProdA.groupName, 'تايجر مصر المعدلة');
    assert.equal(updatedProdA.category, 'سناكس عائلي مطور');

    // Current category updated
    const catsAfter = (await req(baseUrl, 'GET', '/api/products/categories', { token: adminToken })).json.categories;
    const updatedCatA1 = catsAfter.find((c) => c.id === catA1.id);
    assert.equal(updatedCatA1.groupName, 'تايجر مصر المعدلة');
    assert.equal(updatedCatA1.name, 'سناكس عائلي مطور');

    // Historical invoice & return retain original snapshot names
    const invsAfter = (await req(baseUrl, 'GET', '/api/invoices', { token: adminToken })).json.invoices;
    const historicInv = invsAfter.find((i) => i.id === salesInv.id);
    assert.equal(historicInv.items[0].groupName, 'شركة تايجر');
    assert.equal(historicInv.items[0].categoryName, 'شيبسي عائلي');

    const bootAfter = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    const historicRet = (bootAfter.invoiceReturns || []).find((r) => r.id === salesRet.id);
    assert.equal(historicRet.items[0].groupName, 'شركة تايجر');
    assert.equal(historicRet.items[0].categoryName, 'شيبسي عائلي');
  });

  await test(`[${modeLabel}] 7. Sync pull includes productGroups and categories`, async () => {
    const pullRes = await req(baseUrl, 'GET', '/api/sync/pull', { token: adminToken });
    assert.equal(pullRes.status, 200);
    assert.ok(Array.isArray(pullRes.json.productGroups));
    assert.ok(pullRes.json.productGroups.some((g) => g.id === grpA.id && g.name === 'تايجر مصر المعدلة'));
    assert.ok(Array.isArray(pullRes.json.categories));
    assert.ok(pullRes.json.categories.some((c) => c.id === catA1.id && c.groupId === grpA.id));
  });
}

try {
  // ── Mode A: JSON Ledger HTTP API ──
  console.log('\n=== Product Groups & Categories Suite (JSON Ledger) ===');
  setInjectedPool(null);
  resetPgModeCache();
  const appJson = createApiApp();
  const serverJson = http.createServer(appJson);
  await new Promise((resolve) => serverJson.listen(0, '127.0.0.1', resolve));
  const jsonUrl = `http://127.0.0.1:${serverJson.address().port}`;
  try {
    await runCoreSuite('JSON', jsonUrl);
  } finally {
    await new Promise((resolve) => serverJson.close(resolve));
  }

  // ── Mode B: Migration parity JSON -> PostgreSQL (pg-mem) ──
  console.log('\n=== Product Groups & Categories Suite (Migrator Parity + PostgreSQL pg-mem) ===');
  const poolMig = createPgMemPool();
  setInjectedPool(poolMig);
  resetPgModeCache();
  await initializeSchema();

  const jsonSnapshot = readJsonDatabase();
  const migReport = await runDataMigration(jsonSnapshot, 'مختبر الترحيل', {
    targetPool: poolMig,
    skipBackupFile: true,
    skipLogFile: true,
  });
  assert.equal(migReport.success, true);

  const pgGroups = (await poolMig.query('SELECT * FROM product_groups')).rows;
  assert.equal(pgGroups.length, jsonSnapshot.productGroups.length);
  const pgCats = (await poolMig.query('SELECT * FROM product_categories')).rows;
  assert.equal(pgCats.length, jsonSnapshot.categories.length);
  const pgInvItems = (await poolMig.query('SELECT * FROM invoice_items')).rows;
  assert.ok(pgInvItems.some((it) => it.group_name === 'شركة تايجر' && it.category_name === 'شيبسي عائلي'));
  passed++;
  console.log('  [PASS] [Migration] PostgreSQL pg-mem migration preserved linked productGroups, categories, products & item snapshots');

  // ── Mode C: Fresh PostgreSQL (pg-mem) Direct HTTP API ──
  const poolPgFresh = createPgMemPool();
  setInjectedPool(poolPgFresh);
  resetPgModeCache();
  await initializeSchema();

  const appPg = createApiApp();
  const serverPg = http.createServer(appPg);
  await new Promise((resolve) => serverPg.listen(0, '127.0.0.1', resolve));
  const pgUrl = `http://127.0.0.1:${serverPg.address().port}`;
  try {
    await runCoreSuite('PG-MEM', pgUrl);
  } finally {
    await new Promise((resolve) => serverPg.close(resolve));
  }

  console.log(`\nProduct Groups & Categories suite finished: ${passed} passed.\n`);
} finally {
  setInjectedPool(null);
  resetPgModeCache();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}

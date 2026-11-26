import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_branch_col_tests_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'branch_collection_audit_jwt_secret_key_awlad_selim_2026_z';

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { runDataMigration } = await import('../db/migrator.js');
const { readJsonDatabase } = await import('../db/jsonLedger.js');

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

async function req(baseUrl, method, urlPath, { token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
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

async function runSuite(label, isPg = false, pgPool = null) {
  console.log(`\n=== ${label} ===`);
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  let adminToken = '';
  let repToken = '';
  let rep2Token = '';
  let repId = '';
  let repVanWhId = '';
  let whMainId = '';
  let cbMainId = '';
  let cbBranch2Id = '';
  let prodId = '';
  let custFifoId = '';
  let custOpeningId = '';

  try {
    await test(`${label} | 1. Bootstrap admin, 2 reps, 2 cashboxes, warehouse & product`, async () => {
      const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'مدير عام الفرع',
          username: 'branch_admin',
          password: 'AdminPassword!123',
          phone: '01010000001',
        },
      });
      assert.equal(bootAdmin.status, 201);

      adminToken = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'branch_admin', password: 'AdminPassword!123' },
        })
      ).json.accessToken;
      assert.ok(adminToken);

      const regRep = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب أول - سامي',
          username: 'rep_sami',
          password: 'RepPassword!123',
          phone: '01020000002',
          area: 'المعادي',
        },
      });
      assert.equal(regRep.status, 201);
      repToken = regRep.json.accessToken;
      repId = regRep.json.representativeProfile.id;
      repVanWhId = regRep.json.representativeProfile.warehouseId;

      const regRep2 = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'مندوب ثاني - كريم',
          username: 'rep_karim',
          password: 'RepPassword!123',
          phone: '01030000003',
          area: 'حلوان',
        },
      });
      assert.equal(regRep2.status, 201);
      rep2Token = regRep2.json.accessToken;

      whMainId = (
        await req(baseUrl, 'POST', '/api/inventory/warehouses', {
          token: adminToken,
          body: { name: 'المخزن الرئيسي', code: 'MAIN', isDefault: true },
        })
      ).json.warehouse.id;

      cbMainId = (
        await req(baseUrl, 'POST', '/api/admin/cashboxes', {
          token: adminToken,
          body: { name: 'الخزينة الافتراضية', type: 'cash', openingBalance: 1000, isDefault: true },
        })
      ).json.cashbox.id;

      cbBranch2Id = (
        await req(baseUrl, 'POST', '/api/admin/cashboxes', {
          token: adminToken,
          body: { name: 'خزينة فرع المعادي', type: 'cash', openingBalance: 5000, isDefault: false },
        })
      ).json.cashbox.id;

      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          name: 'شاي العروسة 250 جم',
          code: 'PRD-TEA',
          barcode: '6220000222333',
          category: 'مشروبات',
          baseUnit: 'عبوة',
          purchasePrice: 40,
          sellingPrice: 100,
          stockPerWarehouse: { [whMainId]: 200, [repVanWhId]: 100 },
        },
      });
      assert.equal(prodRes.status, 201);
      prodId = prodRes.json.product.id;

      custFifoId = (
        await req(baseUrl, 'POST', '/api/customers', {
          token: repToken,
          body: {
            name: 'محلات الأمل',
            shopName: 'سوبر ماركت الأمل',
            phone: '01150000001',
            openingBalance: 0,
          },
        })
      ).json.customer.id;

      custOpeningId = (
        await req(baseUrl, 'POST', '/api/customers', {
          token: repToken,
          body: {
            name: 'عميل رصيد افتتاحي',
            shopName: 'أولاد بركة',
            phone: '01150000002',
            openingBalance: 400,
          },
        })
      ).json.customer.id;
    });

    let repInv1Id = '';
    let repInv2Id = '';
    let openingInvId = '';

    await test(`${label} | 2. Branch collection on rep invoices: targeted invoice, FIFO partial/full, overpayment & RBAC`, async () => {
      // Rep creates 2 confirmed credit sales invoices: inv1 (500) and inv2 (300)
      const inv1Res = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: repToken,
        body: {
          customerId: custFifoId,
          warehouseId: repVanWhId,
          date: '2026-11-20',
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prodId, unit: 'عبوة', unitFactor: 1, quantity: 5, unitPrice: 100, discount: 0 }],
        },
      });
      assert.equal(inv1Res.status, 201);
      repInv1Id = inv1Res.json.invoice.id;
      assert.equal(Number(inv1Res.json.invoice.grandTotal), 500);
      assert.equal(inv1Res.json.invoice.representativeId, repId);

      const inv2Res = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: repToken,
        body: {
          customerId: custFifoId,
          warehouseId: repVanWhId,
          date: '2026-11-21',
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prodId, unit: 'عبوة', unitFactor: 1, quantity: 3, unitPrice: 100, discount: 0 }],
        },
      });
      assert.equal(inv2Res.status, 201);
      repInv2Id = inv2Res.json.invoice.id;
      assert.equal(Number(inv2Res.json.invoice.grandTotal), 300);

      // Rep 2 trying to collect on Rep 1's specific invoice must be rejected (403)
      const forbiddenOtherRep = await req(baseUrl, 'POST', `/api/customers/${custFifoId}/payment`, {
        token: rep2Token,
        body: { invoiceId: repInv1Id, amount: 50, date: '2026-11-21' },
      });
      assert.equal(forbiddenOtherRep.status, 403, 'Another representative must be blocked from targeting Rep 1 invoice');

      // 2a. Branch collects 200 targeting inv1 explicitly into secondary branch cashbox cbBranch2Id
      const branchTargetedPay = await req(baseUrl, 'POST', `/api/customers/${custFifoId}/payment`, {
        token: adminToken,
        body: {
          invoiceId: repInv1Id,
          amount: 200,
          cashboxId: cbBranch2Id,
          paymentMethod: 'cash',
          date: '2026-11-21',
          notes: 'تحصيل بالفرع على الفاتورة الأولى',
        },
      });
      assert.equal(branchTargetedPay.status, 200);
      assert.equal(branchTargetedPay.json.collectionLocation, 'branch');
      assert.equal(Number(branchTargetedPay.json.customer.currentBalance), 600);
      assert.equal(branchTargetedPay.json.allocatedInvoices.length, 1);
      assert.equal(branchTargetedPay.json.allocatedInvoices[0].invoiceId, repInv1Id);
      assert.equal(Number(branchTargetedPay.json.allocatedInvoices[0].remainingAmountAfter), 300);

      // Verify cbBranch2Id rose to 5200 while cbMainId stayed 1000
      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(Number(boot.cashboxes.find((c) => c.id === cbBranch2Id).currentBalance), 5200);
      assert.equal(Number(boot.cashboxes.find((c) => c.id === cbMainId).currentBalance), 1000);
      const updatedInv1 = boot.invoices.find((i) => i.id === repInv1Id);
      assert.equal(updatedInv1.representativeId, repId, 'Rep attribution on invoice must be preserved after branch collection');
      assert.equal(updatedInv1.payments[0].collectionLocation, 'branch');

      // 2b. Branch collects 450 without invoiceId -> FIFO settles inv1 remaining (300) + 150 of inv2
      const branchFifoPay = await req(baseUrl, 'POST', `/api/customers/${custFifoId}/payment`, {
        token: adminToken,
        body: {
          amount: 450,
          cashboxId: cbBranch2Id,
          paymentMethod: 'cash',
          date: '2026-11-22',
          notes: 'تحصيل بالفرع بدون تحديد فاتورة (FIFO)',
        },
      });
      assert.equal(branchFifoPay.status, 200);
      assert.equal(branchFifoPay.json.collectionLocation, 'branch');
      assert.equal(branchFifoPay.json.allocatedInvoices.length, 2);
      assert.equal(branchFifoPay.json.allocatedInvoices[0].invoiceId, repInv1Id);
      assert.equal(Number(branchFifoPay.json.allocatedInvoices[0].remainingAmountAfter), 0);
      assert.equal(branchFifoPay.json.allocatedInvoices[1].invoiceId, repInv2Id);
      assert.equal(Number(branchFifoPay.json.allocatedInvoices[1].remainingAmountAfter), 150);
      assert.equal(Number(branchFifoPay.json.customer.currentBalance), 150);

      // 2c. Rep collects remaining 150 directly
      const repDirectPay = await req(baseUrl, 'POST', `/api/customers/${custFifoId}/payment`, {
        token: repToken,
        body: {
          amount: 150,
          paymentMethod: 'cash',
          date: '2026-11-22',
          notes: 'تحصيل المندوب المباشر',
        },
      });
      assert.equal(repDirectPay.status, 200);
      assert.equal(repDirectPay.json.collectionLocation, 'rep');
      assert.equal(Number(repDirectPay.json.customer.currentBalance), 0);
      assert.equal(repDirectPay.json.allocatedInvoices.length, 1);
      assert.equal(repDirectPay.json.allocatedInvoices[0].invoiceId, repInv2Id);
      assert.equal(Number(repDirectPay.json.allocatedInvoices[0].remainingAmountAfter), 0);

      // Verify cbMainId incremented by rep direct collection (1000 + 150 = 1150) & cbBranch2Id at 5650 (5200 + 450)
      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(Number(boot.cashboxes.find((c) => c.id === cbBranch2Id).currentBalance), 5650);
      assert.equal(Number(boot.cashboxes.find((c) => c.id === cbMainId).currentBalance), 1150);

      // 2d. Branch collects 250 advance overpayment on zero-balance customer
      const advPay = await req(baseUrl, 'POST', `/api/customers/${custFifoId}/payment`, {
        token: adminToken,
        body: {
          amount: 250,
          cashboxId: cbBranch2Id,
          date: '2026-11-23',
          notes: 'دفعة مقدمة على الحساب بالفرع',
        },
      });
      assert.equal(advPay.status, 200);
      assert.equal(advPay.json.isAdvanceCredit, true);
      assert.equal(Number(advPay.json.creditAmount), 250);
      assert.equal(Number(advPay.json.customer.currentBalance), -250);
    });

    await test(`${label} | 3. Opening-balance settlement precedence (Group 17b) settles opening before invoices`, async () => {
      // custOpeningId starts with openingBalance: 400. Rep creates credit invoice of 300 -> currentBalance 700.
      const invRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: repToken,
        body: {
          customerId: custOpeningId,
          warehouseId: repVanWhId,
          date: '2026-11-22',
          paymentType: 'credit',
          paidAmount: 0,
          status: 'confirmed',
          items: [{ productId: prodId, unit: 'عبوة', unitFactor: 1, quantity: 3, unitPrice: 100, discount: 0 }],
        },
      });
      assert.equal(invRes.status, 201);
      openingInvId = invRes.json.invoice.id;

      // Branch pays 500 without invoiceId -> 400 settles openingBalance, 100 allocates to openingInvId (200 left)
      const pay1 = await req(baseUrl, 'POST', `/api/customers/${custOpeningId}/payment`, {
        token: adminToken,
        body: {
          amount: 500,
          cashboxId: cbBranch2Id,
          date: '2026-11-23',
          notes: 'سداد افتتاحي + جزء من الفاتورة',
        },
      });
      assert.equal(pay1.status, 200);
      assert.equal(Number(pay1.json.unallocatedAmount), 400, '400 opening balance must be settled first');
      assert.equal(pay1.json.allocatedInvoices.length, 1);
      assert.equal(pay1.json.allocatedInvoices[0].invoiceId, openingInvId);
      assert.equal(Number(pay1.json.allocatedInvoices[0].allocatedAmount), 100);
      assert.equal(Number(pay1.json.allocatedInvoices[0].remainingAmountAfter), 200);
      assert.equal(Number(pay1.json.customer.currentBalance), 200);

      // Second payment of 200 -> opening balance is now 0 remaining, so full 200 allocates to openingInvId
      const pay2 = await req(baseUrl, 'POST', `/api/customers/${custOpeningId}/payment`, {
        token: adminToken,
        body: {
          amount: 200,
          cashboxId: cbBranch2Id,
          date: '2026-11-23',
          notes: 'استكمال الفاتورة بعد تصفية الافتتاحي',
        },
      });
      assert.equal(pay2.status, 200);
      assert.equal(Number(pay2.json.unallocatedAmount), 0);
      assert.equal(pay2.json.allocatedInvoices.length, 1);
      assert.equal(Number(pay2.json.allocatedInvoices[0].allocatedAmount), 200);
      assert.equal(Number(pay2.json.allocatedInvoices[0].remainingAmountAfter), 0);
      assert.equal(Number(pay2.json.customer.currentBalance), 0);
    });

    await test(`${label} | 4. getRepDetailedReport splits collectedByRep vs collectedByBranch accurately`, async () => {
      const rptRes = await req(
        baseUrl,
        'GET',
        `/api/reports/rep-summary?representativeId=${encodeURIComponent(repId)}&dateFrom=2026-11-01&dateTo=2026-11-30`,
        { token: adminToken }
      );
      assert.equal(rptRes.status, 200);
      const rpt = rptRes.json.report;

      // Rep-scoped collections include rep direct collections (150) + branch collections linked to the rep's invoices (500 + 150 + 300 = 950).
      // Admin manual opening-balance settlement (400) & advance credit (250) belong to company/branch ledger rather than rep-scoped report.
      assert.equal(rpt.summary.collectedByRepCount, 1);
      assert.equal(rpt.summary.collectedByRepTotal, 150);
      assert.equal(rpt.summary.collectedByBranchTotal, 950);
      assert.equal(rpt.summary.collectionsTotal, 1100);

      const fifoRow = rpt.customersSummary.find((c) => c.id === custFifoId);
      assert.ok(fifoRow);
      assert.equal(fifoRow.repDirectCollectionsTotal, 150);
      assert.equal(fifoRow.branchCollectionsTotal, 650);

      const rptInv1 = rpt.invoices.find((i) => i.id === repInv1Id);
      assert.ok(rptInv1);
      assert.ok(rptInv1.payments.every((p) => p.collectionLocation === 'branch' && p.collectedByBranch === true && p.collectedByRep === false));

      const rptInv2 = rpt.invoices.find((i) => i.id === repInv2Id);
      assert.ok(rptInv2);
      assert.ok(rptInv2.payments.some((p) => p.collectionLocation === 'branch' && p.amount === 150));
      assert.ok(rptInv2.payments.some((p) => p.collectionLocation === 'rep' && p.amount === 150));

      // Verify customer statements still reflect full balances including opening balance (400) and advance credit (-250)
      const stmtFifo = await req(baseUrl, 'GET', `/api/customers/${custFifoId}/statement`, { token: adminToken });
      assert.equal(stmtFifo.status, 200);
      assert.equal(Number(stmtFifo.json.statement.customer.currentBalance), -250);

      const stmtOpen = await req(baseUrl, 'GET', `/api/customers/${custOpeningId}/statement`, { token: adminToken });
      assert.equal(stmtOpen.status, 200);
      assert.equal(Number(stmtOpen.json.statement.customer.currentBalance), 0);
    });

    await test(`${label} | 5. branchNumber persists in settings + branches and migrates cleanly to Postgres`, async () => {
      const updRes = await req(baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: {
          companyName: 'مؤسسة أولاد سليم للتجارة',
          phone1: '01000001111',
          address: 'المعادي - القاهرة',
          branchNumber: 'BR-09',
          extraSettings: {
            branches: [
              {
                id: 'br-main',
                name: 'الفرع الرئيسي - المعادي',
                branchNumber: 'BR-09',
                warehouseId: whMainId,
                cashboxId: cbMainId,
                isDefault: true,
              },
            ],
          },
        },
      });
      assert.equal(updRes.status, 200);
      assert.equal(updRes.json.settings.branchNumber, 'BR-09');

      const bootAfter = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(bootAfter.settings.branchNumber, 'BR-09');
      assert.equal(bootAfter.settings.extraSettings.branches[0].branchNumber, 'BR-09');

      if (!isPg) {
        const jsonDb = readJsonDatabase();
        const migPool = createPgMemPool();
        const migRes = await runDataMigration(jsonDb, 'مدير عام الفرع', {
          targetPool: migPool,
          isTestRun: true,
        });
        assert.equal(migRes.success, true, migRes.error || 'Migration failed');
        const stDb = await migPool.query(`SELECT branch_number, extra_settings FROM system_settings LIMIT 1`);
        assert.equal(stDb.rows.length, 1);
        assert.equal(stDb.rows[0].branch_number, 'BR-09');
        assert.equal(stDb.rows[0].extra_settings.branches[0].branchNumber, 'BR-09');

        const payDb = await migPool.query(
          `SELECT collection_location FROM invoice_payments WHERE invoice_id = $1`,
          [repInv1Id]
        );
        assert.ok(payDb.rows.length >= 1);
        assert.ok(payDb.rows.every((r) => r.collection_location === 'branch'));
      } else if (pgPool) {
        const stDb = await pgPool.query(`SELECT branch_number, extra_settings FROM system_settings LIMIT 1`);
        assert.equal(stDb.rows[0].branch_number, 'BR-09');
        assert.equal(stDb.rows[0].extra_settings.branches[0].branchNumber, 'BR-09');
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  try {
    setInjectedPool(null);
    resetPgModeCache();
    await runSuite('JSON Ledger Branch Collection & Audit', false, null);

    const pgPool = createPgMemPool();
    setInjectedPool(pgPool);
    const init = await initializeSchema();
    assert.equal(init.success, true, `Postgres schema init failed: ${init.error}`);
    process.env.DB_STRICT_MODE = 'true';
    resetPgModeCache();
    await runSuite('Strict Postgres (pg-mem) Branch Collection & Audit', true, pgPool);

    console.log(`\nALL BRANCH COLLECTION, OPENING BALANCE & BRANCH NUMBER TESTS PASSED: ${passed} / ${passed}`);
  } finally {
    delete process.env.DB_STRICT_MODE;
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nBranch collection verification suite failed:', err);
  process.exit(1);
});

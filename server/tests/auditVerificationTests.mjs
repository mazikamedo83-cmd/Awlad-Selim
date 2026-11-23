import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

// Isolate data directory BEFORE importing server modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_audit_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'audit_test_jwt_secret_key_for_awlad_selim_erp_2026_secure';

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

async function runAuditLifecycleSuite(label) {
  console.log(`\n=== ${label} ===`);
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Setup admin, warehouses, cashbox, rep, restricted staff, accountant, product with unit carton=12
    let adminToken = '';
    let repToken = '';
    let repId = '';
    let mainWhId = '';
    let vanWhId = '';
    let cashboxMainId = '';
    let cashboxSecId = '';
    let productId = '';
    let repCustId = '';
    let vanSaleInvId = '';
    let restrictedToken = '';
    let acctToken = '';

    await test(`${label} | 1. Bootstrap admin, warehouses, cashboxes, rep & multi-unit product`, async () => {
      const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'مدير النظام العام',
          username: 'audit_admin',
          password: 'AdminStrongPassword!99',
          phone: '01000001000',
        },
      });
      assert.equal(bootAdmin.status, 201);

      const loginAdmin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'audit_admin', password: 'AdminStrongPassword!99' },
      });
      assert.equal(loginAdmin.status, 200);
      adminToken = loginAdmin.json.accessToken;

      const whRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
        token: adminToken,
        body: { name: 'المخزن الرئيسي الاختباري', code: 'WH-MAIN', isDefault: true },
      });
      assert.equal(whRes.status, 201);
      mainWhId = whRes.json.warehouse.id;

      const cb1 = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: adminToken,
        body: { name: 'الخزينة الرئيسية', type: 'cash', openingBalance: 5000, isDefault: true },
      });
      assert.equal(cb1.status, 201);
      cashboxMainId = cb1.json.cashbox.id;

      const cb2 = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: adminToken,
        body: { name: 'خزينة التحويلات', type: 'cash', openingBalance: 1000 },
      });
      assert.equal(cb2.status, 201);
      cashboxSecId = cb2.json.cashbox.id;

      // Create representative user (auto-creates or links rep profile, let's inspect bootstrap)
      const repUserRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مندوب التوزيع كريم',
          username: 'rep_karim',
          password: 'RepPassword!99',
          phone: '01000002000',
          role: 'representative',
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: false,
            canDelete: false,
            canManageSales: true,
            canManageAccounts: true,
            canManageTransfers: true,
          },
        },
      });
      assert.equal(repUserRes.status, 201);

      const loginRep = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'rep_karim', password: 'RepPassword!99' },
      });
      assert.equal(loginRep.status, 200);
      repToken = loginRep.json.accessToken;

      // Ensure rep profile + van warehouse exist
      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      let rep = (boot.representatives || []).find((r) => r.userId === repUserRes.json.user.id);
      if (!rep) {
        const repCreate = await req(baseUrl, 'POST', '/api/admin/representatives', {
          token: adminToken,
          body: {
            name: 'مندوب التوزيع كريم',
            phone: '01000002000',
            userId: repUserRes.json.user.id,
            openingBalance: 0,
          },
        });
        assert.equal(repCreate.status, 201);
        rep = repCreate.json.representative;
      }
      repId = rep.id;

      const vanRes = await req(baseUrl, 'POST', '/api/inventory/rep-van-warehouse', {
        token: adminToken,
        body: { repName: rep.name },
      });
      assert.equal(vanRes.status, 200);
      vanWhId = vanRes.json.warehouse.id;

      // Create product with carton=12 pieces and initial 120 pieces in main warehouse
      const prodRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'PRD-OIL-01',
          barcode: '622111222333',
          name: 'زيت طعام 1 لتر',
          category: 'زيوت',
          baseUnit: 'قطعة',
          purchasePrice: 50,
          sellingPrice: 70,
          wholesalePrice: 65,
          stockPerWarehouse: { [mainWhId]: 120 },
          units: [
            {
              name: 'كرتونة',
              conversionFactor: 12,
              purchasePrice: 600,
              sellingPrice: 800,
              wholesalePrice: 750,
              barcode: '622111222999',
            },
          ],
        },
      });
      assert.equal(prodRes.status, 201);
      productId = prodRes.json.product.id;

      // Restricted staff (no cashbox/accounts/review permissions)
      const restRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'موظف عرض فقط',
          username: 'viewer_only',
          password: 'ViewPassword!99',
          role: 'sales',
          permissions: { canView: true, canAdd: false, canManageSales: false },
        },
      });
      assert.equal(restRes.status, 201);
      restrictedToken = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'viewer_only', password: 'ViewPassword!99' },
        })
      ).json.accessToken;

      // Accountant with canManageAccounts: true, canManageCashboxes: false
      const acctRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'محاسب فواتير وتحصيلات',
          username: 'acct_cash_ops',
          password: 'AcctPassword!99',
          role: 'accountant',
          permissions: {
            canView: true,
            canAdd: true,
            canManageAccounts: true,
            canManageCashboxes: false,
            canViewReports: true,
          },
        },
      });
      assert.equal(acctRes.status, 201);
      acctToken = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'acct_cash_ops', password: 'AcctPassword!99' },
        })
      ).json.accessToken;
    });

    await test(`${label} | 2. Rep-created customer auto-adds allowedRepIds & stays visible across sync`, async () => {
      const createCustRes = await req(baseUrl, 'POST', '/api/customers', {
        token: repToken,
        body: {
          code: 'CUST-REP-01',
          name: 'سوبر ماركت الهدى',
          shopName: 'ماركت الهدى',
          phone: '01122334455',
          address: 'شارع النيل الرئيسي',
          openingBalance: 0,
        },
      });
      assert.equal(createCustRes.status, 201);
      const createdCust = createCustRes.json.customer;
      repCustId = createdCust.id;
      assert.ok(
        Array.isArray(createdCust.allowedRepIds) && createdCust.allowedRepIds.includes(repId),
        'Rep-created customer must auto-include rep.id in allowedRepIds'
      );

      const listCustRes = await req(baseUrl, 'GET', '/api/customers', { token: repToken });
      assert.equal(listCustRes.status, 200);
      assert.ok(listCustRes.json.customers.some((c) => c.id === repCustId));

      const pullRes = await req(baseUrl, 'GET', '/api/sync/pull', { token: repToken });
      assert.equal(pullRes.status, 200);
      assert.ok((pullRes.json.customers || []).some((c) => c.id === repCustId));
    });

    await test(`${label} | 3. Custody multi-unit dispatch -> receipt -> confirmed rep invoice -> review -> 409 duplicate guard -> return`, async () => {
      // Admin dispatches 1 كرتونة (= 12 قطعة) to rep van
      const dispRes = await req(baseUrl, 'POST', '/api/inventory/rep-item-transfers', {
        token: adminToken,
        body: {
          representativeId: repId,
          representativeName: 'مندوب التوزيع كريم',
          sourceWarehouseId: mainWhId,
          targetWarehouseId: vanWhId,
          transferMode: 'custody_dispatch',
          autoDispatch: true,
          notes: 'صرف عهدة 1 كرتونة',
          items: [
            {
              productId,
              productName: 'زيت طعام 1 لتر',
              unit: 'كرتونة',
              requestedQty: 1,
            },
          ],
        },
      });
      assert.equal(dispRes.status, 201);
      const transferId = dispRes.json.request.id;

      // Before rep confirms receipt: mainWh should be 108 (120 - 12), vanWh MUST still be 0
      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      let prod = boot.products.find((p) => p.id === productId);
      assert.equal(Number(prod.stockPerWarehouse[mainWhId]), 108);
      assert.equal(Number(prod.stockPerWarehouse[vanWhId] || 0), 0);

      // Statement before receipt shows pendingReceiveQty = 12, receivedQty = 0
      const stmtBeforeRec = (
        await req(baseUrl, 'GET', `/api/inventory/rep-custody/statement?repId=${encodeURIComponent(repId)}`, {
          token: repToken,
        })
      ).json.statement;
      assert.equal(stmtBeforeRec.totals.totalPendingReceiveQty, 12);
      assert.equal(stmtBeforeRec.totals.totalReceivedQty, 0);

      // Rep confirms receipt
      const recRes = await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${transferId}/status`, {
        token: repToken,
        body: { status: 'received', notes: 'تم استلام الكرتونة كاملة' },
      });
      assert.equal(recRes.status, 200);

      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      prod = boot.products.find((p) => p.id === productId);
      assert.equal(Number(prod.stockPerWarehouse[vanWhId]), 12);

      // Rep issues immediate confirmed sales invoice from van for 2 pieces (2 * 70 = 140, paid 50, remaining 90)
      const invIdemKey = `rep-sale-${Date.now()}`;
      const salePayload = {
        customerId: repCustId,
        customerName: 'سوبر ماركت الهدى',
        warehouseId: vanWhId,
        warehouseName: 'سيارة المندوب - مندوب التوزيع كريم',
        representativeId: repId,
        representativeName: 'مندوب التوزيع كريم',
        paymentType: 'partial',
        paidAmount: 50,
        remainingAmount: 90,
        subtotal: 140,
        grandTotal: 140,
        status: 'confirmed',
        items: [
          {
            productId,
            productName: 'زيت طعام 1 لتر',
            unit: 'قطعة',
            unitFactor: 1,
            quantity: 2,
            unitPrice: 70,
            discount: 0,
            total: 140,
          },
        ],
      };

      const saleRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: repToken,
        headers: { 'Idempotency-Key': invIdemKey },
        body: salePayload,
      });
      assert.equal(saleRes.status, 201);
      const saleInv = saleRes.json.invoice;
      vanSaleInvId = saleInv.id;
      assert.equal(saleInv.status, 'confirmed');
      assert.equal(saleInv.reviewStatus, 'needs_review');

      // Replay with same Idempotency-Key MUST NOT duplicate stock or balance changes
      const replayRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: repToken,
        headers: { 'Idempotency-Key': invIdemKey },
        body: salePayload,
      });
      assert.ok([200, 201].includes(replayRes.status));
      assert.equal(replayRes.json.invoice.id, vanSaleInvId);

      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      prod = boot.products.find((p) => p.id === productId);
      let cust = boot.customers.find((c) => c.id === repCustId);
      let repObj = boot.representatives.find((r) => r.id === repId);
      assert.equal(Number(prod.stockPerWarehouse[vanWhId]), 10);
      assert.equal(Number(cust.currentBalance), 90);
      assert.equal(Number(repObj.currentBalance), 50);

      // Restricted staff blocked from marking invoice reviewed (403)
      const forbiddenRev = await req(baseUrl, 'POST', `/api/invoices/${vanSaleInvId}/mark-reviewed`, {
        token: restrictedToken,
        body: {},
      });
      assert.equal(forbiddenRev.status, 403);

      // Admin marks invoice reviewed -> reviewStatus becomes 'reviewed', ZERO duplicate stock/balance effects
      const revRes = await req(baseUrl, 'POST', `/api/invoices/${vanSaleInvId}/mark-reviewed`, {
        token: adminToken,
        body: { reviewNotes: 'تمت مراجعة الفاتورة واعتمادها محاسبياً' },
      });
      assert.equal(revRes.status, 200);
      assert.equal(revRes.json.invoice.reviewStatus, 'reviewed');

      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      prod = boot.products.find((p) => p.id === productId);
      cust = boot.customers.find((c) => c.id === repCustId);
      repObj = boot.representatives.find((r) => r.id === repId);
      assert.equal(Number(prod.stockPerWarehouse[vanWhId]), 10);
      assert.equal(Number(cust.currentBalance), 90);
      assert.equal(Number(repObj.currentBalance), 50);

      // Duplicate custody delivery guard: referencing confirmed van invoiceId MUST return 409
      const dupDeliv = await req(baseUrl, 'POST', '/api/inventory/rep-custody/deliver', {
        token: repToken,
        body: {
          representativeId: repId,
          customerId: repCustId,
          invoiceId: vanSaleInvId,
          invoiceNumber: saleInv.invoiceNumber,
          items: [{ productId, unit: 'قطعة', quantity: 2 }],
        },
      });
      assert.equal(dupDeliv.status, 409);
      assert.equal(dupDeliv.json.code, 'DUPLICATE_INVOICE_CUSTODY_DELIVERY');

      // Rep returns 3 pieces to main warehouse via /api/sync/push (record_custody_return) + replay check
      const returnOpId = `op-cust-ret-${Date.now()}`;
      const syncPush1 = await req(baseUrl, 'POST', '/api/sync/push', {
        token: repToken,
        body: {
          operations: [
            {
              operationId: returnOpId,
              operationType: 'record_custody_return',
              entityType: 'rep_custody',
              payload: {
                representativeId: repId,
                targetWarehouseId: mainWhId,
                items: [{ productId, unit: 'قطعة', quantity: 3 }],
                notes: 'مرتجع 3 قطع غير مباعة',
              },
            },
          ],
        },
      });
      assert.equal(syncPush1.status, 200);
      assert.equal(syncPush1.json.results[0].status, 'synced');

      // Deduplicate replay via sync push
      const syncPushReplay = await req(baseUrl, 'POST', '/api/sync/push', {
        token: repToken,
        body: {
          operations: [
            {
              operationId: returnOpId,
              operationType: 'record_custody_return',
              entityType: 'rep_custody',
              payload: {
                representativeId: repId,
                targetWarehouseId: mainWhId,
                items: [{ productId, unit: 'قطعة', quantity: 3 }],
              },
            },
          ],
        },
      });
      assert.equal(syncPushReplay.status, 200);
      assert.equal(syncPushReplay.json.results[0].deduplicated, true);

      // Verify stock: van = 7 (12 - 2 sold - 3 returned), main = 111 (108 + 3)
      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      prod = boot.products.find((p) => p.id === productId);
      assert.equal(Number(prod.stockPerWarehouse[vanWhId]), 7);
      assert.equal(Number(prod.stockPerWarehouse[mainWhId]), 111);

      // Reconcile custody statement totals
      const stmtFinal = (
        await req(baseUrl, 'GET', `/api/inventory/rep-custody/statement?repId=${encodeURIComponent(repId)}`, {
          token: repToken,
        })
      ).json.statement;
      assert.equal(stmtFinal.totals.totalReceivedQty, 12);
      assert.equal(stmtFinal.totals.totalPendingReceiveQty, 0);
      assert.equal(stmtFinal.totals.totalDeliveredQty, 2);
      assert.equal(stmtFinal.totals.totalReturnedQty, 3);
      assert.equal(stmtFinal.totals.totalRemainingCustodyQty, 7);
      assert.equal(stmtFinal.totals.totalVanPhysicalQty, 7);
    });

    await test(`${label} | 4. Item Movement Report accuracy across global & warehouse-filtered views`, async () => {
      const globalRepRes = await req(
        baseUrl,
        'GET',
        `/api/inventory/item-movement-report?productId=${encodeURIComponent(productId)}`,
        { token: adminToken }
      );
      assert.equal(globalRepRes.status, 200);
      const rpt = globalRepRes.json.report;

      assert.equal(rpt.sections.sales.length, 1);
      assert.equal(rpt.sections.sales[0].baseQuantity, 2);
      assert.equal(rpt.sections.custody_sent.length, 1);
      assert.equal(rpt.sections.custody_sent[0].baseQuantity, 12);
      assert.equal(rpt.sections.custody_received.length, 1);
      assert.equal(rpt.sections.custody_received[0].baseQuantity, 12);
      assert.equal(rpt.sections.custody_deliveries.length, 1); // Only the 3-piece return, NO duplicate sale delivery
      assert.equal(rpt.sections.custody_deliveries[0].docType, 'returned_to_warehouse');
      assert.equal(rpt.sections.custody_deliveries[0].baseQuantity, 3);
      // Internal transfers/returns must NOT inflate global totals
      assert.equal(rpt.totals.totalSalesQty, 2);
      assert.equal(rpt.totals.totalQtyOut, 2);
      assert.equal(rpt.totals.totalQtyIn, 0);
      assert.equal(rpt.totals.currentBalance, 118); // 111 main + 7 van

      // Warehouse-filtered report for van warehouse accurately tracks van in=12, out=5 (2 sold + 3 returned), balance=7
      const vanRepRes = await req(
        baseUrl,
        'GET',
        `/api/inventory/item-movement-report?productId=${encodeURIComponent(productId)}&warehouseId=${encodeURIComponent(vanWhId)}`,
        { token: adminToken }
      );
      assert.equal(vanRepRes.status, 200);
      const vanRpt = vanRepRes.json.report;
      assert.equal(vanRpt.totals.totalQtyIn, 12);
      assert.equal(vanRpt.totals.totalQtyOut, 5);
      assert.equal(vanRpt.totals.currentBalance, 7);
    });

    await test(`${label} | 5. Cash Ops RBAC alignment (cash_deposit/expense allowed with canManageAccounts, transfer stays restricted)`, async () => {
      // Restricted staff blocked everywhere (403)
      assert.equal(
        (
          await req(baseUrl, 'POST', '/api/admin/cash-operations', {
            token: restrictedToken,
            body: { type: 'cash_deposit', cashboxId: cashboxMainId, amount: 100, category: 'إيداع' },
          })
        ).status,
        403
      );
      assert.equal(
        (
          await req(baseUrl, 'POST', '/api/admin/expenses', {
            token: restrictedToken,
            body: { type: 'expense', cashboxId: cashboxMainId, amount: 50, category: 'ضيافة' },
          })
        ).status,
        403
      );

      // Accountant (canManageAccounts: true, canManageCashboxes: false) succeeds on deposit & expense via REST + sync/push
      const depRes = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: acctToken,
        body: { type: 'cash_deposit', cashboxId: cashboxMainId, amount: 250, category: 'توريد حسابات' },
      });
      assert.equal(depRes.status, 201);

      const expRes = await req(baseUrl, 'POST', '/api/admin/expenses', {
        token: acctToken,
        body: { type: 'expense', cashboxId: cashboxMainId, amount: 50, category: 'مستلزمات' },
      });
      assert.equal(expRes.status, 201);

      const syncCashRes = await req(baseUrl, 'POST', '/api/sync/push', {
        token: acctToken,
        body: {
          operations: [
            {
              operationId: `op-cash-${Date.now()}`,
              operationType: 'execute_cash_operation',
              entityType: 'cashbox',
              payload: { type: 'cash_deposit', cashboxId: cashboxMainId, amount: 100, category: 'إيداع أوفلاين' },
            },
          ],
        },
      });
      assert.equal(syncCashRes.status, 200);
      assert.equal(syncCashRes.json.results[0].status, 'synced');

      // Accountant WITHOUT canManageCashboxes is STILL blocked (403) from cashbox_transfer
      const transferForbidden = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: acctToken,
        body: { type: 'cashbox_transfer', fromId: cashboxMainId, toId: cashboxSecId, amount: 100 },
      });
      assert.equal(transferForbidden.status, 403);

      const syncTransferForbidden = await req(baseUrl, 'POST', '/api/sync/push', {
        token: acctToken,
        body: {
          operations: [
            {
              operationId: `op-tr-block-${Date.now()}`,
              operationType: 'execute_cash_operation',
              entityType: 'cashbox',
              payload: { type: 'cashbox_transfer', fromId: cashboxMainId, toId: cashboxSecId, amount: 100 },
            },
          ],
        },
      });
      assert.equal(syncTransferForbidden.status, 200);
      assert.equal(syncTransferForbidden.json.results[0].status, 'failed');

      // Verify net cashbox balance: 5000 + 50 (Scenario 3 default-cashbox rep sale) + 250 - 50 + 100 = 5350
      const bootAfter = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const cb = bootAfter.cashboxes.find((c) => c.id === cashboxMainId);
      assert.equal(Number(cb.currentBalance), 5350);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  try {
    // Run against JSON Ledger Mode
    resetPgModeCache();
    await runAuditLifecycleSuite('JSON Ledger HTTP API');

    // Run against Strict Postgres (pg-mem) Mode
    const pgPool = createPgMemPool();
    setInjectedPool(pgPool);
    const init = await initializeSchema();
    assert.equal(init.success, true, `Postgres schema init failed: ${init.error}`);
    process.env.DB_STRICT_MODE = 'true';
    resetPgModeCache();
    await runAuditLifecycleSuite('Strict Postgres (pg-mem) HTTP API');

    console.log(`\nALL AUDIT VERIFICATION TESTS PASSED: ${passed} / ${passed}`);
  } finally {
    delete process.env.DB_STRICT_MODE;
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nAudit verification suite failed:', err);
  process.exit(1);
});

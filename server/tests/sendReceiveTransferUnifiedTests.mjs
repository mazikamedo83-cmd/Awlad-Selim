import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

// Isolate data directory & database mode BEFORE importing server modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_unified_sync_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_unified_send_receive_transfer_2026';
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

async function runUnifiedSuiteForBackend(label, setupBackendFn) {
  console.log(`\n=== Unified Send, Receive & Transfer Suite (${label}) ===`);
  await setupBackendFn();

  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    let adminToken = '';
    let adminUserId = '';
    let repAToken = '';
    let repAUserId = '';
    let repAProfile = null;
    let repAVanId = '';
    let repBToken = '';
    let repBUserId = '';
    let repBProfile = null;
    let repBVanId = '';
    let restrictedToken = '';
    let mainWhId = '';
    let cashboxId = '';
    let product1 = null;
    let supplier1 = null;
    let custByAdmin = null;
    let custByRep = null;

    await test(`[${label}] 1. Bootstrap admin, users (Rep A, Rep B, restricted staff), warehouses, product & supplier`, async () => {
      const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'طارق سليم المدير',
          username: 'admin_main',
          password: 'AdminPassword!2026',
          phone: '01010000001',
        },
      });
      assert.equal(bootAdmin.status, 201);
      adminUserId = bootAdmin.json.user.id;

      const loginAdmin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin_main', password: 'AdminPassword!2026' },
      });
      assert.equal(loginAdmin.status, 200);
      adminToken = loginAdmin.json.accessToken;

      const boot = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(boot.status, 200);
      mainWhId = boot.json.data.warehouses[0].id;
      cashboxId = boot.json.data.cashboxes[0].id;

      // Fund cashbox via cash_deposit operation
      const depRes = await req(baseUrl, 'POST', '/api/admin/cash-operations', {
        token: adminToken,
        body: {
          type: 'cash_deposit',
          cashboxId,
          amount: 50000,
          category: 'تغذية رأس مال اختباري',
          notes: 'رصيد اختباري للخزينة الرئيسية',
        },
      });
      assert.ok([200, 201].includes(depRes.status), `Expected cashbox seed success, got ${depRes.status}`);

      // Create Rep A user + profile + van warehouse
      const uARes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'محمد المندوب الأول',
          username: 'rep_alpha',
          password: 'RepPassword!1',
          phone: '01020000001',
          role: 'representative',
          jobTitle: 'مندوب مبيعات',
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: true,
            canManageSales: true,
            canCreatePurchase: true,
            canManageTransfers: true,
            canSend: true,
            canReceive: true,
          },
        },
      });
      assert.equal(uARes.status, 201);
      repAUserId = uARes.json.user.id;

      const rARes = await req(baseUrl, 'POST', '/api/admin/representatives', {
        token: adminToken,
        body: {
          userId: repAUserId,
          name: 'محمد المندوب الأول',
          phone: '01020000001',
          vehicleNumber: 'ق ر م 101',
          openingBalance: 0,
        },
      });
      assert.equal(rARes.status, 201);
      repAProfile = rARes.json.representative;

      // Create Rep B user + profile + van warehouse
      const uBRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'سالم المندوب الثاني',
          username: 'rep_beta',
          password: 'RepPassword!2',
          phone: '01020000002',
          role: 'representative',
          jobTitle: 'مندوب مبيعات',
          permissions: {
            canView: true,
            canAdd: true,
            canEdit: true,
            canManageSales: true,
            canCreatePurchase: true,
            canManageTransfers: true,
            canSend: true,
            canReceive: true,
          },
        },
      });
      assert.equal(uBRes.status, 201);
      repBUserId = uBRes.json.user.id;

      const rBRes = await req(baseUrl, 'POST', '/api/admin/representatives', {
        token: adminToken,
        body: {
          userId: repBUserId,
          name: 'سالم المندوب الثاني',
          phone: '01020000002',
          vehicleNumber: 'ق ر م 202',
          openingBalance: 0,
        },
      });
      assert.equal(rBRes.status, 201);
      repBProfile = rBRes.json.representative;

      // Restricted staff without transfer/inventory permissions
      const uRRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'موظف مقيد',
          username: 'staff_limited',
          password: 'LimitedPassword!1',
          phone: '01030000003',
          role: 'sales',
          jobTitle: 'مبيعات داخلية',
          permissions: { canView: true, canManageSales: true },
        },
      });
      assert.equal(uRRes.status, 201);

      const loginRepA = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'rep_alpha', password: 'RepPassword!1' },
      });
      assert.equal(loginRepA.status, 200);
      repAToken = loginRepA.json.accessToken;

      const loginRepB = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'rep_beta', password: 'RepPassword!2' },
      });
      assert.equal(loginRepB.status, 200);
      repBToken = loginRepB.json.accessToken;

      const loginLim = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'staff_limited', password: 'LimitedPassword!1' },
      });
      assert.equal(loginLim.status, 200);
      restrictedToken = loginLim.json.accessToken;

      const whARes = await req(baseUrl, 'POST', '/api/inventory/rep-van-warehouse', {
        token: repAToken,
        body: { repName: repAProfile.name },
      });
      assert.equal(whARes.status, 200);
      repAVanId = whARes.json.warehouse.id;

      const whBRes = await req(baseUrl, 'POST', '/api/inventory/rep-van-warehouse', {
        token: repBToken,
        body: { repName: repBProfile.name },
      });
      assert.equal(whBRes.status, 200);
      repBVanId = whBRes.json.warehouse.id;

      // Create Product with 100 units in mainWhId
      const pRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'PRD-U1',
          barcode: '622111001',
          name: 'مكرونة السليم 400 جم',
          category: 'مواد غذائية',
          baseUnit: 'كيس',
          units: [{ id: 'u-carton', name: 'كرتونة', conversionFactor: 20, sellingPrice: 300, purchasePrice: 220 }],
          purchasePrice: 11,
          sellingPrice: 15,
          minStockLevel: 5,
          stockPerWarehouse: { [mainWhId]: 100 },
          status: 'active',
        },
      });
      assert.equal(pRes.status, 201);
      product1 = pRes.json.product;

      // Create Supplier
      const sRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: {
          name: 'شركة النيل للتوريدات',
          phone: '01112223334',
          address: 'القاهرة',
        },
      });
      assert.equal(sRes.status, 201);
      supplier1 = sRes.json.supplier;

      // Create Admin customer & Rep B customer to verify all customers visible to Rep A
      const cAdminRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: 'عميل الإدارة الرئيسي', phone: '01299990001', address: 'طنطا' },
      });
      assert.equal(cAdminRes.status, 201);
      custByAdmin = cAdminRes.json.customer;

      const cRepBRes = await req(baseUrl, 'POST', '/api/customers', {
        token: repBToken,
        body: { name: 'عميل المندوب الثاني', phone: '01299990002', address: 'المحلة' },
      });
      assert.equal(cRepBRes.status, 201);
      custByRep = cRepBRes.json.customer;
    });

    await test(`[${label}] 2. Two-way dispatchRecipients & All customers visibility on /api/sync/pull`, async () => {
      const pullA = await req(baseUrl, 'GET', '/api/sync/pull', { token: repAToken });
      assert.equal(pullA.status, 200);
      assert.ok(Array.isArray(pullA.json.customers));
      assert.ok(pullA.json.customers.some((c) => c.id === custByAdmin.id), 'Rep must see admin-created customers');
      assert.ok(pullA.json.customers.some((c) => c.id === custByRep.id), 'Rep must see other reps customers');
      assert.ok(
        Array.isArray(pullA.json.repTransferTargets) && pullA.json.repTransferTargets.some((t) => t.id === repBProfile.id),
        'Rep pull must return repTransferTargets for rep_to_rep transfers'
      );

      const recAdmin = await req(baseUrl, 'GET', '/api/sync/dispatches/recipients', { token: adminToken });
      assert.equal(recAdmin.status, 200);
      assert.ok(recAdmin.json.recipients.some((r) => r.id === repAUserId), 'Admin must see Rep A in two-way dispatch recipients');
      assert.ok(recAdmin.json.recipients.some((r) => r.id === repBUserId), 'Admin must see Rep B in two-way dispatch recipients');
      assert.ok(!recAdmin.json.recipients.some((r) => r.id === adminUserId), 'Admin should not receive self in recipients list');

      const recRepA = await req(baseUrl, 'GET', '/api/sync/dispatches/recipients', { token: repAToken });
      assert.equal(recRepA.status, 200);
      assert.ok(recRepA.json.recipients.some((r) => r.id === adminUserId), 'Rep must see Admin in dispatch recipients');
    });

    await test(`[${label}] 3. Admin -> Rep dispatch batch & read-only inspection safety (no auto-confirm, no self-confirm)`, async () => {
      const opId = `OP-ADMIN-TO-REP-${Date.now()}`;
      const batchRes = await req(baseUrl, 'POST', '/api/sync/dispatches', {
        token: adminToken,
        body: {
          recipientUserId: repAUserId,
          notes: 'دفعة تحديث منتج للمندوب الأول',
          operations: [
            {
              operationId: opId,
              operationType: 'update_product',
              entityType: 'product',
              entityId: product1.id,
              summaryAr: `تعديل سعر الصنف ${product1.name}`,
              payload: { sellingPrice: 16 },
              createdAt: new Date().toISOString(),
            },
          ],
        },
      });
      assert.equal(batchRes.status, 201);
      const batch = batchRes.json.batch;
      assert.equal(batch.senderUserId, adminUserId);
      assert.equal(batch.recipientUserId, repAUserId);
      assert.equal(batch.receiptStatus, 'في انتظار الاستلام');

      // Admin cannot self-confirm own dispatch
      const selfConfirm = await req(baseUrl, 'POST', `/api/sync/dispatches/${batch.id}/confirm-receipt`, {
        token: adminToken,
        body: { receiptNotes: 'self try' },
      });
      assert.equal(selfConfirm.status, 403);

      // Rep A inspects batch -> status MUST stay 'في انتظار الاستلام' (no auto-confirm)
      const inspectRes = await req(baseUrl, 'GET', `/api/sync/dispatches/${batch.id}`, { token: repAToken });
      assert.equal(inspectRes.status, 200);
      assert.equal(inspectRes.json.batch.receiptStatus, 'في انتظار الاستلام');

      // Wrong Rep B cannot confirm Rep A's batch
      const wrongRepConfirm = await req(baseUrl, 'POST', `/api/sync/dispatches/${batch.id}/confirm-receipt`, {
        token: repBToken,
        body: { receiptNotes: 'wrong rep' },
      });
      assert.equal(wrongRepConfirm.status, 403);

      // Rep A explicitly confirms receipt
      const confirmRes = await req(baseUrl, 'POST', `/api/sync/dispatches/${batch.id}/confirm-receipt`, {
        token: repAToken,
        body: { receiptNotes: 'تم الاستلام والمراجعة' },
      });
      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.json.batch.receiptStatus, 'تم الاستلام');
      assert.equal(confirmRes.json.batch.receivedByUserId, repAUserId);
    });

    await test(`[${label}] 4. Financial Transfers: owner_to_rep, rep_to_rep, idempotency, self-confirm block & reject`, async () => {
      const boot0 = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      const initialCashbox = boot0.json.data.cashboxes.find((c) => c.id === cashboxId).currentBalance;

      // Admin sends 5000 cash custody to Rep A
      const tOwner = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
        token: adminToken,
        body: {
          direction: 'owner_to_rep',
          senderId: 'OWNER',
          senderName: 'الخزينة الرئيسية',
          receiverId: repAProfile.id,
          receiverName: repAProfile.name,
          amount: 5000,
          cashboxId,
          notes: 'عهدة افتتاحية للمندوب',
        },
      });
      assert.equal(tOwner.status, 201);
      const trOwner = tOwner.json.transfer;
      assert.equal(trOwner.status, 'awaiting_receipt');

      // Rep A confirms receipt -> Cashbox drops 5000, Rep A gains 5000
      const confOwner = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${trOwner.id}/confirm`, {
        token: repAToken,
        body: { confirmationNotes: 'تم استلام العهدة النقدية' },
      });
      assert.equal(confOwner.status, 200);

      const boot1 = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      const cbAfterOwner = boot1.json.data.cashboxes.find((c) => c.id === cashboxId).currentBalance;
      const repAAfterOwner = boot1.json.data.representatives.find((r) => r.id === repAProfile.id).currentBalance;
      assert.equal(cbAfterOwner, initialCashbox - 5000);
      assert.equal(repAAfterOwner, 5000);

      // Rep A initiates rep_to_rep cash transfer of 1200 to Rep B with idempotency key
      const idemKey = `IDEM-R2R-CASH-${Date.now()}`;
      const r2r1 = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
        token: repAToken,
        headers: { 'Idempotency-Key': idemKey },
        body: {
          direction: 'rep_to_rep',
          senderId: repAProfile.id,
          senderName: repAProfile.name,
          receiverId: repBProfile.id,
          receiverName: repBProfile.name,
          amount: 1200,
          notes: 'تحويل نقدية لمندوب زميل',
        },
      });
      assert.equal(r2r1.status, 201);
      const trR2R = r2r1.json.transfer;
      assert.equal(trR2R.direction, 'rep_to_rep');
      assert.equal(trR2R.status, 'awaiting_receipt');

      // Replay with same idempotency key must deduplicate without creating second record
      const r2rReplay = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
        token: repAToken,
        headers: { 'Idempotency-Key': idemKey },
        body: {
          direction: 'rep_to_rep',
          senderId: repAProfile.id,
          senderName: repAProfile.name,
          receiverId: repBProfile.id,
          receiverName: repBProfile.name,
          amount: 1200,
          notes: 'تحويل نقدية لمندوب زميل',
        },
      });
      assert.equal(r2rReplay.status, 200);
      assert.equal(r2rReplay.json.transfer.id, trR2R.id);

      // Sender Rep A CANNOT confirm their own rep_to_rep transfer
      const selfTry = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${trR2R.id}/confirm`, {
        token: repAToken,
        body: { confirmationNotes: 'self' },
      });
      assert.equal(selfTry.status, 403);

      // Receiver Rep B confirms rep_to_rep -> Rep A = 3800, Rep B = 1200, Main Cashbox UNCHANGED
      const confR2R = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${trR2R.id}/confirm`, {
        token: repBToken,
        body: { confirmationNotes: 'تم استلام المبلغ من زميلي' },
      });
      assert.equal(confR2R.status, 200);

      const boot2 = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      const cbAfterR2R = boot2.json.data.cashboxes.find((c) => c.id === cashboxId).currentBalance;
      const repAAfterR2R = boot2.json.data.representatives.find((r) => r.id === repAProfile.id).currentBalance;
      const repBAfterR2R = boot2.json.data.representatives.find((r) => r.id === repBProfile.id).currentBalance;
      assert.equal(cbAfterR2R, cbAfterOwner, 'Rep-to-rep cash transfer must NEVER touch Main Cashbox!');
      assert.equal(repAAfterR2R, 3800);
      assert.equal(repBAfterR2R, 1200);

      // Reject flow test: Rep B sends 200 to Rep A, Rep A rejects -> balances untouched
      const r2rRejSend = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
        token: repBToken,
        body: {
          direction: 'rep_to_rep',
          senderId: repBProfile.id,
          senderName: repBProfile.name,
          receiverId: repAProfile.id,
          receiverName: repAProfile.name,
          amount: 200,
          notes: 'مبلغ للاختبار مرفوض',
        },
      });
      assert.equal(r2rRejSend.status, 201);
      const rejRes = await req(baseUrl, 'POST', `/api/inventory/rep-transfers/${r2rRejSend.json.transfer.id}/reject`, {
        token: repAToken,
        body: { rejectionReason: 'المبلغ غير مطابق' },
      });
      assert.equal(rejRes.status, 200);
      assert.equal(rejRes.json.status, 'rejected');

      const boot3 = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(boot3.json.data.representatives.find((r) => r.id === repAProfile.id).currentBalance, 3800);
      assert.equal(boot3.json.data.representatives.find((r) => r.id === repBProfile.id).currentBalance, 1200);
    });

    await test(`[${label}] 5. Stock/Custody Transfers (custody_dispatch + rep_to_rep) & Custody Formula Integrity`, async () => {
      // Admin dispatches 10 units to Rep A
      const dispRes = await req(baseUrl, 'POST', '/api/inventory/rep-item-transfers', {
        token: adminToken,
        body: {
          transferMode: 'custody_dispatch',
          autoDispatch: true,
          representativeId: repAProfile.id,
          representativeName: repAProfile.name,
          sourceWarehouseId: mainWhId,
          sourceWarehouseName: 'المخزن الرئيسي',
          targetWarehouseId: repAVanId,
          targetWarehouseName: 'سيارة الأول',
          items: [
            {
              productId: product1.id,
              productName: product1.name,
              unit: product1.baseUnit,
              unitFactor: 1,
              requestedQty: 10,
              approvedQty: 10,
            },
          ],
          notes: 'صرف عهدة بضاعة للمندوب الأول',
        },
      });
      assert.equal(dispRes.status, 201);
      const dispReq = dispRes.json.request;
      assert.equal(dispReq.status, 'executed');

      // Rep A confirms receipt -> Van A now has 10 units
      const confDisp = await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${dispReq.id}/status`, {
        token: repAToken,
        body: { status: 'received' },
      });
      assert.equal(confDisp.status, 200);

      // Rep A initiates rep_to_rep transfer of 4 units to Rep B with idempotency key
      const idemItemKey = `IDEM-R2R-ITEM-${Date.now()}`;
      const r2rItemRes = await req(baseUrl, 'POST', '/api/inventory/rep-item-transfers', {
        token: repAToken,
        headers: { 'Idempotency-Key': idemItemKey },
        body: {
          transferMode: 'rep_to_rep',
          autoDispatch: true,
          senderRepresentativeId: repAProfile.id,
          senderRepresentativeName: repAProfile.name,
          representativeId: repBProfile.id,
          representativeName: repBProfile.name,
          sourceWarehouseId: repAVanId,
          sourceWarehouseName: 'سيارة الأول',
          targetWarehouseId: repBVanId,
          targetWarehouseName: 'سيارة الثاني',
          items: [
            {
              productId: product1.id,
              productName: product1.name,
              unit: product1.baseUnit,
              unitFactor: 1,
              requestedQty: 4,
              approvedQty: 4,
            },
          ],
          notes: 'تحويل عهدة بضاعة من سيارة إلى سيارة',
        },
      });
      assert.equal(r2rItemRes.status, 201);
      const r2rItem = r2rItemRes.json.request;
      assert.equal(r2rItem.status, 'executed');
      assert.equal(r2rItem.transferMode, 'rep_to_rep');

      // Self-confirm block for sender Rep A
      const selfItemConfirm = await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${r2rItem.id}/status`, {
        token: repAToken,
        body: { status: 'received' },
      });
      assert.equal(selfItemConfirm.status, 403);

      // Rep B confirms receipt -> Van A = 6, Van B = 4
      const confItemB = await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${r2rItem.id}/status`, {
        token: repBToken,
        body: { status: 'received' },
      });
      assert.equal(confItemB.status, 200);

      const boot = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      const pAfter = boot.json.data.products.find((p) => p.id === product1.id);
      assert.equal(pAfter.stockPerWarehouse[mainWhId], 90);
      assert.equal(pAfter.stockPerWarehouse[repAVanId], 6);
      assert.equal(pAfter.stockPerWarehouse[repBVanId], 4);

      // Custody Statement Formula Verification for Rep A and Rep B
      const stmtA = await req(baseUrl, 'GET', `/api/inventory/rep-custody/statement?repId=${repAProfile.id}`, {
        token: adminToken,
      });
      assert.equal(stmtA.status, 200);
      const rowA = stmtA.json.statement.itemsSummary.find((it) => it.productId === product1.id);
      assert.ok(rowA);
      assert.equal(rowA.remainingCustodyQty, 6);
      assert.equal(
        rowA.remainingCustodyQty,
        rowA.receivedQty - rowA.deliveredToCustomersQty - rowA.returnedToWarehouseQty - rowA.approvedReductionsQty,
        'Custody statement formula mismatch for Rep A'
      );

      const stmtB = await req(baseUrl, 'GET', `/api/inventory/rep-custody/statement?repId=${repBProfile.id}`, {
        token: adminToken,
      });
      assert.equal(stmtB.status, 200);
      const rowB = stmtB.json.statement.itemsSummary.find((it) => it.productId === product1.id);
      assert.ok(rowB);
      assert.equal(rowB.receivedQty, 4);
      assert.equal(rowB.remainingCustodyQty, 4);
      assert.equal(
        rowB.remainingCustodyQty,
        rowB.receivedQty - rowB.deliveredToCustomersQty - rowB.returnedToWarehouseQty - rowB.approvedReductionsQty,
        'Custody statement formula mismatch for Rep B'
      );
    });

    await test(`[${label}] 6. Offline /api/sync/push executes newly added op types + deduplicates replay without double posting`, async () => {
      const now = new Date().toISOString();
      const opSup = `OP-SUP-${Date.now()}`;
      const opProd = `OP-PRD-${Date.now()}`;
      const opDmg = `OP-DMG-${Date.now()}`;
      const opTr = `OP-TR-${Date.now()}`;
      const opRepCash = `OP-RCASH-${Date.now()}`;
      const opRepItem = `OP-RITEM-${Date.now()}`;

      const operations = [
        {
          operationId: opSup,
          operationType: 'update_supplier',
          entityType: 'supplier',
          entityId: supplier1.id,
          payload: { updates: { address: 'الجيزة - المريوطية' } },
          createdAt: now,
        },
        {
          operationId: opProd,
          operationType: 'update_product',
          entityType: 'product',
          entityId: product1.id,
          payload: { sellingPrice: 17 },
          createdAt: now,
        },
        {
          operationId: opDmg,
          operationType: 'record_damaged_stock',
          entityType: 'inventory',
          entityId: product1.id,
          payload: {
            productId: product1.id,
            warehouseId: mainWhId,
            quantity: 2,
            reason: 'تلف تغليف أثناء الاختبار',
          },
          createdAt: now,
        },
        {
          operationId: opTr,
          operationType: 'transfer_stock',
          entityType: 'inventory',
          entityId: product1.id,
          payload: {
            productId: product1.id,
            fromWarehouseId: mainWhId,
            toWarehouseId: repAVanId,
            quantity: 3,
            notes: 'تحويل أوفلاين متزامن',
          },
          createdAt: now,
        },
        {
          operationId: opRepCash,
          operationType: 'create_rep_transfer',
          entityType: 'rep_transfer',
          localId: 'LOCAL-RC-1',
          payload: {
            direction: 'rep_to_rep',
            senderId: repAProfile.id,
            senderName: repAProfile.name,
            receiverId: repBProfile.id,
            receiverName: repBProfile.name,
            amount: 100,
            notes: 'تحويل نقدي أوفلاين',
            idempotencyKey: opRepCash,
          },
          createdAt: now,
        },
        {
          operationId: opRepItem,
          operationType: 'create_rep_item_transfer',
          entityType: 'rep_item_transfer',
          localId: 'LOCAL-RI-1',
          payload: {
            transferMode: 'custody_dispatch',
            autoDispatch: true,
            representativeId: repBProfile.id,
            representativeName: repBProfile.name,
            sourceWarehouseId: mainWhId,
            sourceWarehouseName: 'المخزن الرئيسي',
            targetWarehouseId: repBVanId,
            targetWarehouseName: 'سيارة الثاني',
            items: [
              {
                productId: product1.id,
                productName: product1.name,
                unit: product1.baseUnit,
                unitFactor: 1,
                requestedQty: 5,
                approvedQty: 5,
              },
            ],
            notes: 'صرف عهدة أوفلاين',
            idempotencyKey: opRepItem,
          },
          createdAt: now,
        },
      ];

      const pushRes1 = await req(baseUrl, 'POST', '/api/sync/push', {
        token: adminToken,
        body: { operations },
      });
      assert.equal(pushRes1.status, 200);
      assert.equal(pushRes1.json.results.length, 6);
      for (const r of pushRes1.json.results) {
        assert.equal(r.status, 'synced', `Expected operation ${r.operationId} to sync cleanly, got ${JSON.stringify(r)}`);
      }

      // Replay exact same operations -> MUST deduplicate without subtracting stock again
      const pushRes2 = await req(baseUrl, 'POST', '/api/sync/push', {
        token: adminToken,
        body: { operations },
      });
      assert.equal(pushRes2.status, 200);
      for (const r of pushRes2.json.results) {
        assert.equal(r.status, 'synced');
        assert.equal(r.deduplicated, true, `Replay for ${r.operationId} must return deduplicated: true`);
      }

      const bootAfter = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      const prodAfter = bootAfter.json.data.products.find((p) => p.id === product1.id);
      const supAfter = bootAfter.json.data.suppliers.find((s) => s.id === supplier1.id);
      assert.equal(supAfter.address, 'الجيزة - المريوطية');
      assert.equal(prodAfter.sellingPrice, 17);
      // MainWh was 90 -> -2 (damaged) -3 (transfer_stock) -5 (custody_dispatch) = 80 (once only, not twice!)
      assert.equal(prodAfter.stockPerWarehouse[mainWhId], 80);
      // Van A was 6 -> +3 = 9
      assert.equal(prodAfter.stockPerWarehouse[repAVanId], 9);

      // Confirm the offline rep cash transfer via confirm_rep_transfer sync push by Rep B
      const offlineCashCreated = bootAfter.json.data.repTransfers.find((t) => t.notes === 'تحويل نقدي أوفلاين');
      assert.ok(offlineCashCreated);
      const opConfirmCash = `OP-CONF-CASH-${Date.now()}`;
      const confPush = await req(baseUrl, 'POST', '/api/sync/push', {
        token: repBToken,
        body: {
          operations: [
            {
              operationId: opConfirmCash,
              operationType: 'confirm_rep_transfer',
              entityType: 'rep_transfer',
              entityId: offlineCashCreated.id,
              payload: { transferId: offlineCashCreated.id, confirmationNotes: 'اعتماد أوفلاين من الثاني' },
              createdAt: new Date().toISOString(),
            },
          ],
        },
      });
      assert.equal(confPush.status, 200);
      assert.equal(confPush.json.results[0].status, 'synced');
    });

    await test(`[${label}] 7. RBAC Boundary: Restricted staff cannot invoke admin inventory/transfer operations`, async () => {
      const r1 = await req(baseUrl, 'POST', '/api/inventory/rep-transfers', {
        token: restrictedToken,
        body: {
          direction: 'owner_to_rep',
          senderId: 'OWNER',
          receiverId: repAProfile.id,
          amount: 100,
          cashboxId,
        },
      });
      assert.equal(r1.status, 403);

      const r2 = await req(baseUrl, 'POST', '/api/inventory/damaged', {
        token: restrictedToken,
        body: { productId: product1.id, warehouseId: mainWhId, quantity: 1, reason: 'hack' },
      });
      assert.equal(r2.status, 403);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  // Run against JSON Ledger
  await runUnifiedSuiteForBackend('JSON-LEDGER', async () => {
    setInjectedPool(null);
    resetPgModeCache();
  });

  // Run against PostgreSQL (pg-mem)
  await runUnifiedSuiteForBackend('POSTGRES-PGMEM', async () => {
    const pgPool = createPgMemPool();
    setInjectedPool(pgPool);
    resetPgModeCache();
    const init = await initializeSchema();
    assert.equal(init.success, true, `Postgres schema initialization failed: ${init.error}`);
  });

  console.log(`\nALL UNIFIED SEND/RECEIVE/TRANSFER TESTS PASSED (${passed} assertions groups).`);
} finally {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}

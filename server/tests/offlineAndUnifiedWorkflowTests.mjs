import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_offline_test_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_offline_and_unified_tests_2026_secure';

const { createApiApp } = await import('../app.js');
const { readJsonDatabase, writeJsonDatabase } = await import('../db/jsonLedger.js');
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

async function runCoreSuite(baseUrl, modeLabel) {
  console.log(`\n=== Running Offline-First, Sync, Unified Customers & Order Advance Suite [${modeLabel}] ===`);

  let adminToken = '';
  let repToken = '';
  let custToken = '';
  let otherCustToken = '';
  let staffSalesToken = '';
  let staffSalesId = '';
  let whId = '';
  let cbId = '';
  let prodId = '';
  let custId = '';
  let otherCustId = '';
  let repId = '';

  await test(`[${modeLabel}] 1. Bootstrap owner, staff, rep, products & unified customers`, async () => {
    const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
      body: {
        fullName: 'أحمد سليم',
        username: 'admin_owner',
        password: 'AdminPassword!2026',
        phone: '01000001000',
      },
    });
    assert.equal(bootAdmin.status, 201);

    adminToken = (
      await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin_owner', password: 'AdminPassword!2026' },
      })
    ).json.accessToken;
    assert.ok(adminToken);

    const boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    whId = boot.warehouses[0].id;
    cbId = boot.cashboxes[0].id;

    // Product with initial stock 50 and price 1000
    const pRes = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        code: 'PRD-UNI-1',
        barcode: '62299001',
        name: 'زيت طعام ممتاز 1 لتر',
        category: 'زيوت',
        baseUnit: 'زجاجة',
        units: [],
        purchasePrice: 800,
        sellingPrice: 1000,
        minStockLevel: 5,
        stockPerWarehouse: { [whId]: 50 },
        status: 'active',
      },
    });
    assert.equal(pRes.status, 201);
    prodId = pRes.json.product.id;

    // Customer 1 created directly in store catalog first (without user account)
    const c1Res = await req(baseUrl, 'POST', '/api/customers', {
      token: adminToken,
      body: {
        code: 'CUS-UNI-1',
        name: 'عميل متجر موحد',
        shopName: 'سوبرماركت النور',
        phone: '01088887777',
        address: 'شارع الجمهورية',
      },
    });
    assert.equal(c1Res.status, 201);
    custId = c1Res.json.customer.id;

    // Auto-create/link customer user with normalized phone "+20 10-8888-7777" -> links to SAME existing customer (NO duplicate!)
    const uCustRes = await req(baseUrl, 'POST', '/api/admin/users', {
      token: adminToken,
      body: {
        fullName: 'عميل متجر موحد',
        username: 'cust_noor',
        password: 'CustPassword!2026',
        phone: '+20 10-8888-7777',
        role: 'customer',
      },
    });
    assert.equal(uCustRes.status, 201);
    assert.equal(uCustRes.json.user.linkedCustomerId, custId, 'Normalized phone MUST match single unified Customer ID');

    // Second customer for tenant isolation check
    const uOtherCust = await req(baseUrl, 'POST', '/api/admin/users', {
      token: adminToken,
      body: {
        fullName: 'عميل معزول آخر',
        username: 'cust_isolated',
        password: 'CustPassword!2026',
        phone: '01155554444',
        role: 'customer',
      },
    });
    assert.equal(uOtherCust.status, 201);
    otherCustId = uOtherCust.json.user.linkedCustomerId;
    assert.notEqual(otherCustId, custId);

    // Representative user + profile
    const uRep = await req(baseUrl, 'POST', '/api/admin/users', {
      token: adminToken,
      body: {
        fullName: 'مندوب التوصيل خالد',
        username: 'rep_khaled',
        password: 'RepPassword!2026',
        phone: '01233332222',
        role: 'representative',
      },
    });
    assert.equal(uRep.status, 201);
    const repProfRes = await req(baseUrl, 'POST', '/api/admin/representatives', {
      token: adminToken,
      body: {
        name: 'خالد للتوصيل',
        phone: '01233332222',
        vehicleNumber: 'ق ر م 442',
        userId: uRep.json.user.id,
        openingBalance: 0,
        status: 'active',
      },
    });
    assert.equal(repProfRes.status, 201);
    const bootAfterRep = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    repId = bootAfterRep.representatives.find((r) => r.userId === uRep.json.user.id).id;

    // Assign cust1 to repId so rep can also manage delivery / create orders
    await req(baseUrl, 'PUT', `/api/customers/${custId}`, {
      token: adminToken,
      body: { assignedRepId: repId, allowedRepIds: [repId] },
    });

    // Sales staff for permission revocation offline sync test
    const uSales = await req(baseUrl, 'POST', '/api/admin/users', {
      token: adminToken,
      body: {
        fullName: 'موظف مبيعات ميداني',
        username: 'sales_field',
        password: 'SalesPassword!2026',
        phone: '01544443333',
        role: 'sales',
        permissions: {
          canView: true,
          canAdd: true,
          canEdit: true,
          canManageSales: true,
          canManageAccounts: true,
        },
      },
    });
    assert.equal(uSales.status, 201);
    staffSalesId = uSales.json.user.id;

    custToken = (await req(baseUrl, 'POST', '/api/auth/login', { body: { username: 'cust_noor', password: 'CustPassword!2026' } })).json.accessToken;
    otherCustToken = (await req(baseUrl, 'POST', '/api/auth/login', { body: { username: 'cust_isolated', password: 'CustPassword!2026' } })).json.accessToken;
    repToken = (await req(baseUrl, 'POST', '/api/auth/login', { body: { username: 'rep_khaled', password: 'RepPassword!2026' } })).json.accessToken;
    staffSalesToken = (await req(baseUrl, 'POST', '/api/auth/login', { body: { username: 'sales_field', password: 'SalesPassword!2026' } })).json.accessToken;

    // Ambiguous duplicate phone check -> explicit 409 AMBIGUOUS_CUSTOMER_PHONE
    await req(baseUrl, 'POST', '/api/customers', {
      token: adminToken,
      body: { code: 'CUS-DUP-1', name: 'مكرر 1', phone: '01099990001', address: 'أ' },
    });
    await req(baseUrl, 'POST', '/api/customers', {
      token: adminToken,
      body: { code: 'CUS-DUP-2', name: 'مكرر 2', phone: '01099990001', address: 'ب' },
    });
    const ambigRes = await req(baseUrl, 'POST', '/api/admin/users', {
      token: adminToken,
      body: {
        fullName: 'مستخدم هاتف مكرر',
        username: 'ambig_phone_user',
        password: 'CustPassword!2026',
        phone: '01099990001',
        role: 'customer',
      },
    });
    assert.equal(ambigRes.status, 409);
    assert.equal(ambigRes.json.code, 'AMBIGUOUS_CUSTOMER_PHONE');
  });

  await test(`[${modeLabel}] 2. Unified Order Lifecycle + Advance Payment + Rep Delivery + Invoice Conversion (Zero Double Counting)`, async () => {
    // Customer places app order for 10 units @ 1000 = 10,000
    const ordRes = await req(baseUrl, 'POST', '/api/orders', {
      token: custToken,
      body: {
        items: [{ productId: prodId, unit: 'زجاجة', quantity: 10 }],
        notes: 'توصيل صباحاً',
      },
    });
    assert.equal(ordRes.status, 201);
    const orderId = ordRes.json.order.id;
    assert.equal(ordRes.json.order.totalAmount, 10000);
    assert.equal(ordRes.json.order.status, 'pending');

    // Approve order -> MUST NOT create invoice and MUST NOT touch stock!
    const appRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/approve`, {
      token: adminToken,
      body: { notes: 'موافق عليه للتجهيز' },
    });
    assert.equal(appRes.status, 200);
    assert.equal(appRes.json.order.status, 'approved');

    let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    assert.equal(boot.invoices.length, 0);
    assert.equal(boot.products.find((p) => p.id === prodId).stockPerWarehouse[whId], 50);

    // Record Advance Payment of 5,000 on order (with idempotency key)
    const advRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/advance-payment`, {
      token: adminToken,
      headers: { 'Idempotency-Key': 'adv-key-1' },
      body: {
        amount: 5000,
        cashboxId: cbId,
        paymentMethod: 'cash',
        notes: 'عربون مقدم',
      },
    });
    assert.equal(advRes.status, 201);
    assert.equal(advRes.json.advancePayment.amount, 5000);
    assert.equal(advRes.json.advancePayment.status, 'active');
    assert.equal(advRes.json.order.advancePaidAmount, 5000);
    assert.equal(advRes.json.order.remainingAmount, 5000);

    // Repeat same idempotency key -> deduplicated
    const advDup = await req(baseUrl, 'POST', `/api/orders/${orderId}/advance-payment`, {
      token: adminToken,
      headers: { 'Idempotency-Key': 'adv-key-1' },
      body: { amount: 5000, cashboxId: cbId },
    });
    assert.equal(advDup.status, 200);
    assert.equal(advDup.json.deduplicated, true);

    // Check customer balance = -5000, cashbox = +5000, ZERO sales invoices, ZERO sales income revenue
    boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    assert.equal(boot.customers.find((c) => c.id === custId).currentBalance, -5000);
    assert.equal(boot.cashboxes.find((c) => c.id === cbId).currentBalance, 5000);
    assert.equal(boot.invoices.length, 0);
    assert.equal(
      (boot.expenseIncomeRecords || []).filter((e) => e.type === 'income').length,
      0,
      'Advance payment must NEVER be recognized as sales revenue'
    );

    // Assign delivery rep -> status becomes rep_assigned
    const assignRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/assign-rep`, {
      token: adminToken,
      body: { repId, notes: 'توصيل بسيارة المندوب' },
    });
    assert.equal(assignRes.status, 200);
    assert.equal(assignRes.json.order.status, 'rep_assigned');
    assert.equal(assignRes.json.order.deliveryRepId, repId);

    // Rep starts delivery -> out_for_delivery
    const outRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/delivery-status`, {
      token: repToken,
      body: { status: 'out_for_delivery', deliveryNotes: 'خرجت السيارة للتوصيل' },
    });
    assert.equal(outRes.status, 200);
    assert.equal(outRes.json.order.status, 'out_for_delivery');

    // Rep marks delivered (0 extra collected here; total collected stays 5000 advance)
    const delivRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/delivery-status`, {
      token: repToken,
      body: {
        status: 'delivered',
        collectedAmount: 0,
        deliveryNotes: 'تم التسليم لأمين المخزن بالمحل',
        deliveryProof: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
    assert.equal(delivRes.status, 200);
    assert.equal(delivRes.json.order.status, 'delivered');
    assert.ok(delivRes.json.order.deliveredAt);

    // Convert delivered order into confirmed invoice with paidAtInvoice = 0 -> applies 5,000 advance cleanly!
    const convRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/convert-to-invoice`, {
      token: adminToken,
      body: {
        warehouseId: whId,
        warehouseName: 'المستودع الرئيسي',
        cashboxId: cbId,
        status: 'confirmed',
        paymentType: 'partial',
        paidAtInvoice: 0,
      },
    });
    assert.equal(convRes.status, 201);
    const inv = convRes.json.invoice;
    assert.equal(inv.grandTotal, 10000);
    assert.equal(inv.appliedAdvanceAmount, 5000);
    assert.equal(inv.paidAmount, 5000);
    assert.equal(inv.remainingAmount, 5000);
    assert.equal(convRes.json.order.status, 'invoiced');

    // Double conversion blocked -> 409
    const doubleConv = await req(baseUrl, 'POST', `/api/orders/${orderId}/convert-to-invoice`, {
      token: adminToken,
      body: { warehouseId: whId, cashboxId: cbId },
    });
    assert.equal(doubleConv.status, 409);

    // Verify ZERO double counting: cashbox STILL 5,000; customer balance = +5,000; stock = 40
    boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    assert.equal(boot.cashboxes.find((c) => c.id === cbId).currentBalance, 5000, 'Cashbox must NOT receive advance twice');
    assert.equal(boot.customers.find((c) => c.id === custId).currentBalance, 5000, 'Customer balance = -5000 + 10000 = +5000');
    assert.equal(boot.products.find((p) => p.id === prodId).stockPerWarehouse[whId], 40, 'Stock deducted once (50 - 10)');
    assert.equal(boot.orderAdvancePayments.find((a) => a.orderId === orderId).status, 'applied');

    // Statement shows order_advance credit 5,000 + sales_invoice debit 10,000 -> final runningBalance +5,000
    const stmtRes = await req(baseUrl, 'GET', `/api/customers/${custId}/statement`, { token: adminToken });
    assert.equal(stmtRes.status, 200);
    assert.equal(stmtRes.json.statement.summary.currentBalance, 5000);
    assert.equal(stmtRes.json.statement.summary.totalCredit, 5000);
    assert.equal(stmtRes.json.statement.summary.totalDebit, 10000);
    assert.ok(stmtRes.json.statement.entries.some((e) => e.type === 'order_advance' && e.credit === 5000));

    // Add direct store credit invoice (+2,000) to SAME unified customer -> hybrid customer, balance = +7,000
    const directRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
      token: adminToken,
      body: {
        customerId: custId,
        warehouseId: whId,
        cashboxId: cbId,
        status: 'confirmed',
        paymentType: 'credit',
        paidAmount: 0,
        items: [{ productId: prodId, productName: 'زيت طعام ممتاز 1 لتر', unit: 'زجاجة', unitFactor: 1, quantity: 2, unitPrice: 1000 }],
      },
    });
    assert.equal(directRes.status, 201);
    const stmtHybrid = (await req(baseUrl, 'GET', `/api/customers/${custId}/statement`, { token: adminToken })).json.statement;
    assert.equal(stmtHybrid.customerType, 'hybrid');
    assert.equal(stmtHybrid.summary.currentBalance, 7000);

    // Cancel the converted invoice -> reverses 10,000 debt (-3000 net), restores 10 stock (38 -> 48), keeps cashbox 5000, restores advance to 'active'
    const cancelRes = await req(baseUrl, 'POST', `/api/invoices/${inv.id}/cancel`, {
      token: adminToken,
      body: { reason: 'مراجعة الطلب بعد التحويل' },
    });
    assert.equal(cancelRes.status, 200);

    boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    assert.equal(boot.customers.find((c) => c.id === custId).currentBalance, -3000);
    assert.equal(boot.cashboxes.find((c) => c.id === cbId).currentBalance, 5000);
    assert.equal(boot.products.find((p) => p.id === prodId).stockPerWarehouse[whId], 48);
    assert.equal(boot.orderAdvancePayments.find((a) => a.orderId === orderId).status, 'active');
  });

  await test(`[${modeLabel}] 3. Offline Sync Push/Pull, Deduplication, Alias Chaining & Conflict Review (No Silent LWW)`, async () => {
    // 3a. Customer tenant isolation on /api/sync/pull & cross-customer order attempt blocked
    const pullCust = await req(baseUrl, 'GET', '/api/sync/pull', { token: custToken });
    assert.equal(pullCust.status, 200);
    assert.equal(pullCust.json.scope, 'customer');
    assert.equal(pullCust.json.customerProfile.id, custId);
    assert.equal(pullCust.json.products[0].purchasePrice, undefined);
    assert.equal(pullCust.json.products[0].stockPerWarehouse, undefined);

    const pullOther = await req(baseUrl, 'GET', '/api/sync/pull', { token: otherCustToken });
    assert.equal(pullOther.status, 200);
    assert.equal(pullOther.json.customerItemOrders.length, 0, 'Other customer MUST NOT see Cust 1 orders');

    // 3b. Local alias chaining (create_customer + create_order in same batch) + deduplication
    const aliasCustomerLocalId = 'CUS-LOC-ALIAS-1';
    const opCustId = `OP-CUST-${modeLabel}-1`;
    const opOrdId = `OP-ORD-${modeLabel}-1`;

    const pushBatch1 = await req(baseUrl, 'POST', '/api/sync/push', {
      token: staffSalesToken,
      headers: { 'x-device-id': 'DEV-WIN-TEST-01' },
      body: {
        deviceId: 'DEV-WIN-TEST-01',
        operations: [
          {
            operationId: opCustId,
            operationType: 'create_customer',
            payload: {
              localId: aliasCustomerLocalId,
              code: `CUS-OFF-${modeLabel}`,
              name: 'عميل أوفلاين متزامن',
              phone: modeLabel === 'PG' ? '01077776662' : '01077776661',
              address: 'الحي الثالث',
              openingBalance: 0,
            },
          },
          {
            operationId: opOrdId,
            operationType: 'create_order',
            payload: {
              customerId: aliasCustomerLocalId,
              items: [{ productId: prodId, unit: 'زجاجة', quantity: 2 }],
              notes: 'طلب من أوفلاين بعد إنشاء العميل',
              sourcePlatform: 'windows',
            },
          },
        ],
      },
    });
    assert.equal(pushBatch1.status, 200);
    assert.equal(pushBatch1.json.results.length, 2);
    assert.equal(pushBatch1.json.results[0].status, 'synced');
    assert.equal(pushBatch1.json.results[1].status, 'synced');
    const createdCentralCustId = pushBatch1.json.results[0].entityId;
    const syncedOrder = pushBatch1.json.results[1].result.order;
    assert.equal(syncedOrder.customerId, createdCentralCustId, 'Offline order MUST bind to resolved central customer ID');

    // Re-push same operations -> deduplicated (NO duplicate customer or duplicate order!)
    const pushDup = await req(baseUrl, 'POST', '/api/sync/push', {
      token: staffSalesToken,
      body: {
        deviceId: 'DEV-WIN-TEST-01',
        operations: [
          { operationId: opCustId, operationType: 'create_customer', payload: { localId: aliasCustomerLocalId, name: 'عميل أوفلاين متزامن' } },
          { operationId: opOrdId, operationType: 'create_order', payload: { customerId: aliasCustomerLocalId, items: [{ productId: prodId, quantity: 2 }] } },
        ],
      },
    });
    assert.equal(pushDup.status, 200);
    assert.equal(pushDup.json.results[0].deduplicated, true);
    assert.equal(pushDup.json.results[1].deduplicated, true);

    // 3c. Insufficient stock on offline invoice -> creates sync_conflicts record with needs_review (NEVER silently forced!)
    const stockBeforeConflict = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data.products.find(
      (p) => p.id === prodId
    ).stockPerWarehouse[whId];

    const opStockConflict = `OP-INV-CONFLICT-${modeLabel}`;
    const conflictPush = await req(baseUrl, 'POST', '/api/sync/push', {
      token: staffSalesToken,
      body: {
        deviceId: 'DEV-ANDROID-02',
        operations: [
          {
            operationId: opStockConflict,
            operationType: 'create_sales_invoice',
            payload: {
              customerId: createdCentralCustId,
              warehouseId: whId,
              cashboxId: cbId,
              status: 'confirmed',
              paymentType: 'credit',
              paidAmount: 0,
              items: [
                {
                  productId: prodId,
                  productName: 'زيت طعام ممتاز 1 لتر',
                  unit: 'زجاجة',
                  unitFactor: 1,
                  quantity: 999,
                  unitPrice: 1000,
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(conflictPush.status, 200);
    assert.equal(conflictPush.json.results[0].status, 'needs_review');
    assert.equal(conflictPush.json.conflicts.length, 1);
    const conflictId1 = conflictPush.json.conflicts[0].id;

    // Stock remained untouched
    const stockAfterConflict = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data.products.find(
      (p) => p.id === prodId
    ).stockPerWarehouse[whId];
    assert.equal(stockAfterConflict, stockBeforeConflict);

    // Admin reviews & resolves conflict with 'keep_server'
    const resKeep = await req(baseUrl, 'POST', `/api/sync/conflicts/${conflictId1}/resolve`, {
      token: adminToken,
      body: { action: 'keep_server', resolutionNotes: 'الكمية غير متوفرة بالمستودع' },
    });
    assert.equal(resKeep.status, 200);
    assert.equal(resKeep.json.conflict.status, 'resolved_keep_server');

    // 3d. VERSION_CONFLICT on stale edit_sales_invoice -> needs_review & manual apply_local resolution
    const editInvRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
      token: adminToken,
      body: {
        customerId: createdCentralCustId,
        warehouseId: whId,
        cashboxId: cbId,
        status: 'confirmed',
        paymentType: 'credit',
        paidAmount: 0,
        items: [{ productId: prodId, productName: 'زيت طعام ممتاز 1 لتر', unit: 'زجاجة', unitFactor: 1, quantity: 1, unitPrice: 1000 }],
      },
    });
    assert.equal(editInvRes.status, 201);
    const invToEdit = editInvRes.json.invoice;

    // Simulate central edit bumping version on server
    const serverEdit = await req(baseUrl, 'PUT', `/api/invoices/${invToEdit.id}`, {
      token: adminToken,
      body: { notes: 'تعديل مركزي أحدث' },
    });
    assert.equal(serverEdit.status, 200);
    assert.ok(serverEdit.json.invoice.version >= 2);

    // Offline client pushes stale edit with baseVersion: 1 -> VERSION_CONFLICT (needs_review)
    const opVerConflict = `OP-VER-CONFLICT-${modeLabel}`;
    const verPush = await req(baseUrl, 'POST', '/api/sync/push', {
      token: staffSalesToken,
      body: {
        deviceId: 'DEV-IOS-03',
        operations: [
          {
            operationId: opVerConflict,
            operationType: 'edit_sales_invoice',
            payload: {
              invoiceId: invToEdit.id,
              baseVersion: 1,
              notes: 'تعديل أوفلاين أقدم',
            },
          },
        ],
      },
    });
    assert.equal(verPush.status, 200);
    assert.equal(verPush.json.results[0].status, 'needs_review');
    assert.equal(verPush.json.results[0].code, 'VERSION_CONFLICT');
    const verConflictId = verPush.json.conflicts[0].id;

    // Admin manually resolves VERSION_CONFLICT choosing apply_local
    const resApply = await req(baseUrl, 'POST', `/api/sync/conflicts/${verConflictId}/resolve`, {
      token: adminToken,
      body: { action: 'apply_local', resolutionNotes: 'اعتماد ملاحظة الفرع' },
    });
    assert.equal(resApply.status, 200);
    assert.equal(resApply.json.conflict.status, 'resolved_apply_local');
    assert.equal(resApply.json.appliedResult.invoice.notes, 'تعديل أوفلاين أقدم');

    // 3e. Revoked permission or deactivated user -> halts/blocks queued sync operation cleanly
    await req(baseUrl, 'PUT', `/api/admin/users/${staffSalesId}`, {
      token: adminToken,
      body: {
        permissions: {
          canView: true,
          canAdd: true,
          canManageSales: false,
          canManageAccounts: false,
        },
      },
    });
    const revPush = await req(baseUrl, 'POST', '/api/sync/push', {
      token: staffSalesToken,
      body: {
        deviceId: 'DEV-WIN-TEST-01',
        operations: [
          {
            operationId: `OP-REVOKED-${modeLabel}`,
            operationType: 'create_sales_invoice',
            payload: {
              customerId: createdCentralCustId,
              warehouseId: whId,
              cashboxId: cbId,
              status: 'confirmed',
              paymentType: 'cash',
              paidAmount: 1000,
              items: [{ productId: prodId, productName: 'زيت طعام ممتاز 1 لتر', unit: 'زجاجة', unitFactor: 1, quantity: 1, unitPrice: 1000 }],
            },
          },
        ],
      },
    });
    assert.equal(revPush.status, 200);
    assert.equal(revPush.json.results[0].status, 'needs_review');
    assert.equal(revPush.json.results[0].code, 'PERMISSION_REVOKED');

    // Deactivate user -> ACCOUNT_DEACTIVATED + stoppedDueToAuthRevoke === true
    await req(baseUrl, 'PUT', `/api/admin/users/${staffSalesId}`, {
      token: adminToken,
      body: { isActive: false },
    });
    const deactPush = await req(baseUrl, 'POST', '/api/sync/push', {
      token: staffSalesToken,
      body: {
        deviceId: 'DEV-WIN-TEST-01',
        operations: [
          {
            operationId: `OP-DEACT-${modeLabel}`,
            operationType: 'create_order',
            payload: {
              customerId: createdCentralCustId,
              items: [{ productId: prodId, unit: 'زجاجة', quantity: 1 }],
            },
          },
        ],
      },
    });
    assert.equal(deactPush.status, 200);
    assert.equal(deactPush.json.stoppedDueToAuthRevoke, true);
    assert.equal(deactPush.json.results[0].code, 'ACCOUNT_DEACTIVATED');
  });
}

try {
  // 1. JSON Ledger Mode
  resetPgModeCache();
  const jsonApp = createApiApp();
  const jsonServer = http.createServer(jsonApp);
  await new Promise((resolve) => jsonServer.listen(0, '127.0.0.1', resolve));
  const jsonPort = jsonServer.address().port;
  try {
    await runCoreSuite(`http://127.0.0.1:${jsonPort}`, 'JSON');
  } finally {
    await new Promise((resolve) => jsonServer.close(resolve));
  }

  // 2. PostgreSQL (pg-mem) Mode
  const pool = createPgMemPool();
  setInjectedPool(pool);
  await initializeSchema();
  resetPgModeCache();
  const pgApp = createApiApp();
  const pgServer = http.createServer(pgApp);
  await new Promise((resolve) => pgServer.listen(0, '127.0.0.1', resolve));
  const pgPort = pgServer.address().port;
  try {
    await runCoreSuite(`http://127.0.0.1:${pgPort}`, 'PG');
  } finally {
    setInjectedPool(null);
    resetPgModeCache();
    await new Promise((resolve) => pgServer.close(resolve));
  }

  console.log(`\nALL OFFLINE & UNIFIED WORKFLOW TESTS PASSED (${passed}/${passed})`);
} finally {
  try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_rep_rbac_tests_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'rep_purchase_customer_rbac_jwt_secret_key_awlad_selim_2026_x';

const { createApiApp } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache, REP_DEFAULT_PERMISSIONS, CUSTOMER_DEFAULT_PERMISSIONS } = await import('../db/stores/mode.js');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SVG_XSS_DATA_URL =
  'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=';

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
  let adminUserId = '';
  let repToken = '';
  let repUserId = '';
  let repId = '';
  let repVanWhId = '';
  let purchStaffToken = '';
  let limitedRepToken = '';
  let limitedRepUserId = '';
  let whMainId = '';
  let cbMainId = '';
  let suppId = '';
  let prodId = '';
  let repDraftInvId = '';
  let offlineCustId = '';

  try {
    // ------------------------------------------------------------------
    // Scenario 10: Representative self-registration -> auto permissions + 1:1 rep + van warehouse
    // ------------------------------------------------------------------
    await test(`${label} | 10. Representative self-registration auto-assigns REP_DEFAULT_PERMISSIONS & 1:1 rep/van profile`, async () => {
      const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'مدير النظام الرئيسي',
          username: 'master_admin',
          password: 'AdminPassword!123',
          phone: '01011110000',
        },
      });
      assert.equal(bootAdmin.status, 201);
      adminUserId = bootAdmin.json.user.id;

      const loginAdmin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'master_admin', password: 'AdminPassword!123' },
      });
      assert.equal(loginAdmin.status, 200);
      adminToken = loginAdmin.json.accessToken;

      const regRep = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'representative',
          fullName: 'محمد حسن المندوب',
          username: 'rep_hassan',
          password: 'RepPassword!123',
          phone: '01022223333',
          area: 'المعادي',
          vehicleNumber: 'أ ب ج 123',
        },
      });
      assert.equal(regRep.status, 201);
      assert.equal(regRep.json.user.role, 'representative');
      repToken = regRep.json.accessToken;
      repUserId = regRep.json.user.id;
      assert.ok(regRep.json.representativeProfile?.id, 'Expected 1:1 representativeProfile');
      repId = regRep.json.representativeProfile.id;
      repVanWhId = regRep.json.representativeProfile.warehouseId;
      assert.ok(repVanWhId, 'Expected auto-provisioned van warehouse');

      for (const [k, v] of Object.entries(REP_DEFAULT_PERMISSIONS)) {
        assert.equal(
          Boolean(regRep.json.user.permissions[k]),
          Boolean(v),
          `Mismatch for rep default permission ${k}`
        );
      }
      assert.equal(regRep.json.user.permissions.canCreatePurchase, true);
      assert.equal(regRep.json.user.permissions.canManagePurchases, false);
    });

    // ------------------------------------------------------------------
    // Scenario 11: Customer self-registration -> auto CUSTOMER_DEFAULT_PERMISSIONS & 1:1 customer profile
    // ------------------------------------------------------------------
    await test(`${label} | 11. Customer self-registration auto-assigns CUSTOMER_DEFAULT_PERMISSIONS & 1:1 profile`, async () => {
      const regCust = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'أحمد سعيد العميل',
          username: 'cust_saeed',
          password: 'CustPassword!123',
          phone: '01144445555',
          shopName: 'سوبر ماركت السعادة',
          area: 'مدينة نصر',
          address: 'شارع عباس العقاد',
        },
      });
      assert.equal(regCust.status, 201);
      assert.equal(regCust.json.user.role, 'customer');
      assert.ok(regCust.json.customerProfile?.id, 'Expected 1:1 customer profile on registration');
      assert.equal(regCust.json.customerProfile.shopName, 'سوبر ماركت السعادة');
      for (const [k, v] of Object.entries(CUSTOMER_DEFAULT_PERMISSIONS)) {
        assert.equal(
          Boolean(regCust.json.user.permissions[k]),
          Boolean(v),
          `Mismatch for customer permission ${k}`
        );
      }
      // Customer must remain blocked from staff purchase endpoint
      const forbiddenRes = await req(baseUrl, 'GET', '/api/invoices', {
        token: regCust.json.accessToken,
      });
      assert.equal(forbiddenRes.status, 403);
    });

    // ------------------------------------------------------------------
    // Scenario 12: Admin creates/updates user with role='representative' without duplicate profile creation
    // ------------------------------------------------------------------
    await test(`${label} | 12. Admin creates & updates representative user -> auto profile/van warehouse without duplicates`, async () => {
      const createRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'محمود عادل مندوب',
          username: 'rep_adel',
          password: 'AdelPassword!123',
          phone: '01277778888',
          role: 'representative',
          autoCreateRepProfile: true,
        },
      });
      assert.equal(createRes.status, 201);
      limitedRepUserId = createRes.json.user.id;
      assert.equal(createRes.json.user.permissions.canCreatePurchase, true);
      assert.equal(createRes.json.user.permissions.canManagePurchases, false);

      // Update repeat (preserving idempotency of 1:1 rep link, adding custom permission test later)
      const updRes = await req(baseUrl, 'PUT', `/api/admin/users/${limitedRepUserId}`, {
        token: adminToken,
        body: {
          role: 'representative',
          autoCreateRepProfile: true,
          fullName: 'محمود عادل مندوب - محدث',
        },
      });
      assert.equal(updRes.status, 200);

      const loginAdel = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'rep_adel', password: 'AdelPassword!123' },
      });
      assert.equal(loginAdel.status, 200);
      limitedRepToken = loginAdel.json.accessToken;

      const bootAfter = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      assert.equal(bootAfter.status, 200);
      const linkedReps = bootAfter.json.data.representatives.filter((r) => r.userId === limitedRepUserId);
      assert.equal(linkedReps.length, 1, 'Repeated update must NOT create duplicate representative records');

      // Also create a Purchasing Officer account to receive & confirm rep purchases
      const purchUser = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مسؤول المشتريات والاستلام',
          username: 'purch_officer',
          password: 'PurchPassword!123',
          role: 'purchases',
        },
      });
      assert.equal(purchUser.status, 201);
      purchStaffToken = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'purch_officer', password: 'PurchPassword!123' },
        })
      ).json.accessToken;

      // Setup master data: warehouse, cashbox, supplier, product (qty 100, purchasePrice 50)
      whMainId = (
        await req(baseUrl, 'POST', '/api/inventory/warehouses', {
          token: adminToken,
          body: { name: 'المخزن الرئيسي', code: 'MAIN', isDefault: true },
        })
      ).json.warehouse.id;

      cbMainId = (
        await req(baseUrl, 'POST', '/api/admin/cashboxes', {
          token: adminToken,
          body: { name: 'الخزينة الرئيسية', type: 'cash', openingBalance: 10000 },
        })
      ).json.cashbox.id;

      suppId = (
        await req(baseUrl, 'POST', '/api/admin/suppliers', {
          token: repToken, // Scenario 14 check: rep with canCreatePurchase can also create supplier!
          body: { name: 'شركة النور للتوريدات', phone: '01500001111', address: 'العاشر من رمضان', openingBalance: 1000 },
        })
      ).json.supplier.id;
      assert.ok(suppId, 'Rep with canCreatePurchase must be able to create supplier');

      const prodRes = await req(baseUrl, 'POST', '/api/inventory/products', {
        token: adminToken,
        body: {
          name: 'سكر الأسرة 1 كجم',
          code: 'PRD-SUGAR',
          barcode: '6220000111222',
          category: 'مواد غذائية',
          baseUnit: 'كيس',
          purchasePrice: 50,
          sellingPrice: 65,
          initialStock: { [whMainId]: 100 },
        },
      });
      assert.equal(prodRes.status, 201);
      prodId = prodRes.json.product.id;
    });

    // ------------------------------------------------------------------
    // Scenario 1 & 2: Rep creates draft purchase invoice -> NO stock/balance impact & blocked from confirming (403)
    // ------------------------------------------------------------------
    await test(`${label} | 1 & 2. Rep creates purchase draft -> ZERO stock/balance impact & direct confirm blocked (403)`, async () => {
      // Scenario 2a: Rep tries POST /api/invoices/purchase with status: 'confirmed' -> stays draft or blocked cleanly; confirm route -> 403!
      const createRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: repToken,
        body: {
          supplierId: suppId,
          warehouseId: whMainId,
          date: '2026-04-15',
          paymentType: 'cash',
          paymentMethod: 'cash',
          cashboxId: cbMainId,
          paidAmount: 800,
          status: 'confirmed', // Rep attempt to force confirm must be forced to draft!
          sendNow: false,
          notes: 'مسودة شراء أولية من المندوب',
          items: [
            {
              productId: prodId,
              unit: 'كيس',
              unitFactor: 1,
              quantity: 10,
              unitPrice: 80, // total 800 (will affect weighted avg cost once confirmed later: (100*50 + 10*80)/110 = 52.73)
              discount: 0,
            },
          ],
        },
      });
      assert.equal(createRes.status, 201);
      const inv = createRes.json.invoice;
      repDraftInvId = inv.id;
      assert.equal(inv.type, 'purchase');
      assert.equal(inv.status, 'draft', 'Rep purchase invoice must ALWAYS remain draft');
      assert.equal(inv.dispatchStatus, 'draft');
      assert.equal(inv.isRepPurchase, true);

      // Scenario 2b: Rep directly tries POST /api/invoices/:id/confirm -> MUST return 403
      const forbiddenConfirm = await req(baseUrl, 'POST', `/api/invoices/${repDraftInvId}/confirm`, {
        token: repToken,
      });
      assert.equal(forbiddenConfirm.status, 403, 'Representative must be blocked from confirming purchase invoice');

      // Scenario 14: Rep tries purchase return -> MUST return 403 (requires canManagePurchases, not canCreatePurchase)
      const forbiddenReturn = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: repToken,
        body: {
          type: 'purchase_return',
          invoiceId: repDraftInvId,
          items: [{ productId: prodId, quantity: 1 }],
        },
      });
      assert.equal(forbiddenReturn.status, 403, 'canCreatePurchase must NOT grant purchase_return authority');

      // Verify ZERO change to product stock, weighted avg cost, supplier balance, or cashbox balance
      const boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const prod = boot.products.find((p) => p.id === prodId);
      const supp = boot.suppliers.find((s) => s.id === suppId);
      const cb = boot.cashboxes.find((c) => c.id === cbMainId);
      assert.equal(Number(prod.stockPerWarehouse[whMainId]), 100);
      assert.equal(Number(prod.purchasePrice), 50);
      assert.equal(Number(supp.currentBalance), 1000);
      assert.equal(Number(cb.currentBalance), 10000);
    });

    // ------------------------------------------------------------------
    // Scenario 3: Rep checks /purchase-receivers and sends invoice to Admin -> notifications created, still zero stock impact
    // ------------------------------------------------------------------
    await test(`${label} | 3. Rep sends purchase draft to Admin -> dispatchStatus='sent' & notifications without stock impact`, async () => {
      const receiversRes = await req(baseUrl, 'GET', '/api/invoices/purchase-receivers', { token: repToken });
      assert.equal(receiversRes.status, 200);
      assert.ok(receiversRes.json.receivers.some((r) => r.id === adminUserId), 'Admin should appear in purchase receivers');

      const sendRes = await req(baseUrl, 'POST', `/api/invoices/purchase/${repDraftInvId}/send`, {
        token: repToken,
        body: {
          recipientUserId: adminUserId,
          recipientName: 'مدير النظام الرئيسي',
          notes: 'برجاء مراجعة واعتماد كمية السكر',
        },
      });
      assert.equal(sendRes.status, 200);
      const inv = sendRes.json.invoice;
      assert.equal(inv.status, 'draft');
      assert.equal(inv.dispatchStatus, 'sent');
      assert.equal(inv.recipientUserId, adminUserId);
      assert.ok(inv.dispatchHistory.some((h) => h.action === 'sent'));

      // Stock & balances remain completely unchanged
      const boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(Number(boot.products.find((p) => p.id === prodId).stockPerWarehouse[whMainId]), 100);
      assert.equal(Number(boot.cashboxes.find((c) => c.id === cbMainId).currentBalance), 10000);
    });

    // ------------------------------------------------------------------
    // Scenario 4 & 5: Purchasing staff receives ('received') then rejects with reason; rep edits & resends
    // ------------------------------------------------------------------
    await test(`${label} | 4 & 5. Receive -> Reject (empty blocked 400, reason required) -> Rep edits & resends without stock impact`, async () => {
      // Receive step
      const recRes = await req(baseUrl, 'POST', `/api/invoices/purchase/${repDraftInvId}/receive`, {
        token: purchStaffToken,
        body: { notes: 'تم استلام الفاتورة للمراجعة' },
      });
      assert.equal(recRes.status, 200);
      assert.equal(recRes.json.invoice.status, 'draft');
      assert.equal(recRes.json.invoice.dispatchStatus, 'received');
      assert.ok(recRes.json.invoice.receivedBy);

      // Empty rejection reason -> 400
      const badReject = await req(baseUrl, 'POST', `/api/invoices/purchase/${repDraftInvId}/reject`, {
        token: adminToken,
        body: { reason: '   ' },
      });
      assert.equal(badReject.status, 400);

      // Valid rejection reason
      const rejRes = await req(baseUrl, 'POST', `/api/invoices/purchase/${repDraftInvId}/reject`, {
        token: adminToken,
        body: { reason: 'سعر الوحدة مرتفع عن الاتفاق — يرجى تعديله إلى 70' },
      });
      assert.equal(rejRes.status, 200);
      assert.equal(rejRes.json.invoice.status, 'draft');
      assert.equal(rejRes.json.invoice.dispatchStatus, 'rejected');
      assert.equal(rejRes.json.invoice.rejectionReason, 'سعر الوحدة مرتفع عن الاتفاق — يرجى تعديله إلى 70');

      // Rep checks notifications endpoint -> should reflect rejected purchase alert
      const repNotifRes = await req(baseUrl, 'GET', '/api/mobile/notifications', { token: repToken });
      assert.equal(repNotifRes.status, 200);
      assert.ok(
        repNotifRes.json.notifications.some(
          (n) => String(n.title).includes('رفض') || String(n.body).includes('70')
        ),
        'Rep notifications must alert about rejected purchase invoice'
      );

      // Still ZERO stock/supplier/cashbox effect
      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(Number(boot.products.find((p) => p.id === prodId).stockPerWarehouse[whMainId]), 100);
      assert.equal(Number(boot.cashboxes.find((c) => c.id === cbMainId).currentBalance), 10000);

      // Rep edits the rejected draft unitPrice from 80 -> 70 and resends
      const editRes = await req(baseUrl, 'PUT', `/api/invoices/purchase/${repDraftInvId}`, {
        token: repToken,
        body: {
          supplierId: suppId,
          warehouseId: whMainId,
          date: '2026-04-15',
          paymentType: 'partial',
          paymentMethod: 'cash',
          cashboxId: cbMainId,
          paidAmount: 500,
          notes: 'تم تعديل السعر إلى 70 حسب طلب الإدارة',
          items: [
            {
              productId: prodId,
              unit: 'كيس',
              unitFactor: 1,
              quantity: 10,
              unitPrice: 70, // Total 700, paid 500 -> remaining 200 credit to supplier
              discount: 0,
            },
          ],
        },
      });
      assert.equal(editRes.status, 200);
      assert.equal(Number(editRes.json.invoice.grandTotal), 700);
      assert.equal(editRes.json.invoice.status, 'draft');

      const resendRes = await req(baseUrl, 'POST', `/api/invoices/purchase/${repDraftInvId}/send`, {
        token: repToken,
        body: {
          recipientUserId: adminUserId,
          recipientName: 'مدير النظام الرئيسي',
          notes: 'إعادة إرسال بعد تعديل السعر',
        },
      });
      assert.equal(resendRes.status, 200);
      assert.equal(resendRes.json.invoice.dispatchStatus, 'sent');
      assert.ok(resendRes.json.invoice.dispatchHistory.some((h) => h.action === 'resent'));
    });

    // ------------------------------------------------------------------
    // Scenario 6: Admin confirms draft purchase -> posts stock, weighted avg cost, supplier balance & cashbox; double confirm blocked
    // ------------------------------------------------------------------
    await test(`${label} | 6. Admin confirms purchase draft -> updates stock, weighted avg cost, supplier & cashbox; blocks double confirm`, async () => {
      const confirmRes = await req(baseUrl, 'POST', `/api/invoices/${repDraftInvId}/confirm`, {
        token: adminToken,
      });
      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.json.invoice.status, 'confirmed');
      assert.equal(confirmRes.json.invoice.dispatchStatus, 'confirmed');

      // Double-confirm must fail cleanly (409)
      const doubleConfirmRes = await req(baseUrl, 'POST', `/api/invoices/${repDraftInvId}/confirm`, {
        token: adminToken,
      });
      assert.equal(doubleConfirmRes.status, 409);

      const boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const prod = boot.products.find((p) => p.id === prodId);
      const supp = boot.suppliers.find((s) => s.id === suppId);
      const cb = boot.cashboxes.find((c) => c.id === cbMainId);

      // Initial 100 @ 50 + Purchased 10 @ 70 => Qty = 110, Weighted Avg Cost = (5000+700)/110 = 51.82
      assert.equal(Number(prod.stockPerWarehouse[whMainId]), 110);
      assert.ok(Math.abs(Number(prod.purchasePrice) - 51.82) <= 0.02, `Expected weighted avg ~51.82, got ${prod.purchasePrice}`);
      // Initial supplier balance 1000 + remaining 200 = 1200
      assert.equal(Number(supp.currentBalance), 1200);
      // Initial cashbox 10000 - paid 500 = 9500
      assert.equal(Number(cb.currentBalance), 9500);
    });

    // ------------------------------------------------------------------
    // Scenario 7, 8 & 9: Rep adds customer with 10 fields + 3 phones + shopPhoto, partial edit preserves photo, clearShopPhoto deletes, SVG rejected
    // ------------------------------------------------------------------
    await test(`${label} | 7, 8 & 9. Customer rich profile (shopPhoto, 3 phones, GPS, governorate), preservation on partial edit, clearShopPhoto, SVG reject`, async () => {
      // Scenario 9: Reject SVG image XSS
      const svgRes = await req(baseUrl, 'POST', '/api/customers', {
        token: repToken,
        body: {
          name: 'عميل مرفوض',
          shopName: 'محل مرفوض',
          phone: '01099990001',
          shopPhoto: SVG_XSS_DATA_URL,
        },
      });
      assert.equal(svgRes.status, 400, 'SVG image upload must be rejected for security');

      // Scenario 7: Valid customer creation with all 10 components
      const custCreateRes = await req(baseUrl, 'POST', '/api/customers', {
        token: repToken,
        body: {
          shopName: 'مخازن الهدى',
          name: 'الحاج طارق محمود',
          shopPhoto: TINY_PNG_DATA_URL,
          address: '15 شارع الهرم',
          geoCoordinates: '30.0074, 31.2098',
          governorate: 'الجيزة',
          area: 'الهرم',
          phone: '01055551111',
          phones: [
            { number: '01055551111', label: 'المحل', isPrimary: true },
            { number: '01155552222', label: 'واتساب' },
            { number: '01255553333', label: 'شخصي' },
          ],
          notes: 'التسليم صباحًا فقط',
          openingBalance: 450,
        },
      });
      assert.equal(custCreateRes.status, 201);
      const cust = custCreateRes.json.customer;
      assert.equal(cust.shopName, 'مخازن الهدى');
      assert.equal(cust.governorate, 'الجيزة');
      assert.equal(cust.area, 'الهرم');
      assert.equal(cust.geoCoordinates, '30.0074, 31.2098');
      assert.equal(cust.phone, '01055551111');
      assert.equal(cust.secondaryPhone, '01155552222');
      assert.equal(cust.phones.length, 3);
      assert.equal(cust.shopPhoto, TINY_PNG_DATA_URL);
      assert.equal(Number(cust.openingBalance), 450);

      // Scenario 8a: Partial update WITHOUT shopPhoto/photo -> preserves existing shopPhoto
      const partialEditRes = await req(baseUrl, 'PUT', `/api/customers/${cust.id}`, {
        token: repToken,
        body: {
          name: 'الحاج طارق محمود (محدث)',
          governorate: 'الجيزة',
          area: 'الطالبية',
          phones: [
            { number: '01155552222', label: 'واتساب رئيسي', isPrimary: true },
            { number: '01055551111', label: 'المحل' },
          ],
        },
      });
      assert.equal(partialEditRes.status, 200);
      assert.equal(partialEditRes.json.customer.name, 'الحاج طارق محمود (محدث)');
      assert.equal(partialEditRes.json.customer.phone, '01155552222');
      assert.equal(partialEditRes.json.customer.secondaryPhone, '01055551111');
      assert.equal(partialEditRes.json.customer.shopPhoto, TINY_PNG_DATA_URL, 'Existing shopPhoto must be preserved on partial edit');

      // Scenario 8b: Update with clearShopPhoto: true -> deletes shopPhoto & photo
      const clearPhotoRes = await req(baseUrl, 'PUT', `/api/customers/${cust.id}`, {
        token: adminToken,
        body: {
          clearShopPhoto: true,
        },
      });
      assert.equal(clearPhotoRes.status, 200);
      assert.ok(!clearPhotoRes.json.customer.shopPhoto, 'clearShopPhoto: true must remove shopPhoto');
      assert.ok(!clearPhotoRes.json.customer.photo, 'clearShopPhoto: true must remove photo');
    });

    // ------------------------------------------------------------------
    // Scenario 13: Offline /api/sync/push queue batching (purchase draft + send + rich customer + update customer)
    // ------------------------------------------------------------------
    await test(`${label} | 13. Offline /api/sync/push processes purchase draft, send_purchase_invoice, create_customer & update_customer idempotently`, async () => {
      const pushPayload = {
        deviceId: 'DEV-ANDROID-01',
        operations: [
          {
            operationId: 'OP-SYNC-CUST-1',
            operationType: 'create_customer',
            entityType: 'customer',
            payload: {
              shopName: 'متجر السلام الأوفلاين',
              name: 'سالم الأوفلاين',
              governorate: 'الإسكندرية',
              area: 'سموحة',
              address: 'شارع فوزي معاذ',
              geoCoordinates: '31.2156, 29.9553',
              shopPhoto: TINY_PNG_DATA_URL,
              phones: [
                { number: '01088881111', label: 'رئيسي', isPrimary: true },
                { number: '01288882222', label: 'ثانوي' },
              ],
              notes: 'تمت الإضافة أوفلاين',
            },
          },
          {
            operationId: 'OP-SYNC-PUR-1',
            operationType: 'create_purchase_invoice',
            entityType: 'invoice',
            payload: {
              supplierId: suppId,
              warehouseId: whMainId,
              date: '2026-04-16',
              paymentType: 'credit',
              paymentMethod: 'cash',
              cashboxId: cbMainId,
              paidAmount: 0,
              sendNow: true,
              recipientUserId: adminUserId,
              recipientName: 'مدير النظام الرئيسي',
              items: [
                {
                  productId: prodId,
                  unit: 'كيس',
                  unitFactor: 1,
                  quantity: 5,
                  unitPrice: 60,
                  discount: 0,
                },
              ],
            },
          },
        ],
      };

      const syncRes1 = await req(baseUrl, 'POST', '/api/sync/push', {
        token: repToken,
        body: pushPayload,
      });
      assert.equal(syncRes1.status, 200);
      assert.equal(syncRes1.json.results.length, 2);
      assert.equal(syncRes1.json.results[0].status, 'applied');
      assert.equal(syncRes1.json.results[1].status, 'applied');

      offlineCustId = syncRes1.json.results[0].data.id;
      const syncedPurchaseInv = syncRes1.json.results[1].data;
      assert.equal(syncedPurchaseInv.status, 'draft');
      assert.equal(syncedPurchaseInv.dispatchStatus, 'sent');

      // Replay exact same batch -> deduplicated, zero duplicates!
      const syncReplay = await req(baseUrl, 'POST', '/api/sync/push', {
        token: repToken,
        body: pushPayload,
      });
      assert.equal(syncReplay.status, 200);
      assert.equal(syncReplay.json.results[0].status, 'deduplicated');
      assert.equal(syncReplay.json.results[1].status, 'deduplicated');

      // Now update customer via sync/push without shopPhoto -> preserves photo
      const syncCustUpdate = await req(baseUrl, 'POST', '/api/sync/push', {
        token: repToken,
        body: {
          deviceId: 'DEV-ANDROID-01',
          operations: [
            {
              operationId: 'OP-SYNC-CUST-UPD-1',
              operationType: 'update_customer',
              entityType: 'customer',
              entityId: offlineCustId,
              payload: {
                customerId: offlineCustId,
                governorate: 'الإسكندرية',
                area: 'سيدي جابر',
              },
            },
          ],
        },
      });
      assert.equal(syncCustUpdate.status, 200);
      assert.equal(syncCustUpdate.json.results[0].status, 'applied');
      assert.equal(syncCustUpdate.json.results[0].data.area, 'سيدي جابر');
      assert.equal(syncCustUpdate.json.results[0].data.shopPhoto, TINY_PNG_DATA_URL);
    });

    // ------------------------------------------------------------------
    // Scenario 15: Postgres schema & column parity verification when running in pg-mem mode
    // ------------------------------------------------------------------
    if (isPg && pgPool) {
      await test(`${label} | 15. Verify PostgreSQL columns (governorate, phones_json, shop_photo, dispatch_status, is_rep_purchase, recipient_user_id) persisted cleanly`, async () => {
        const custDbRes = await pgPool.query(
          `SELECT id, governorate, phones_json, shop_photo FROM customers WHERE id = $1`,
          [offlineCustId]
        );
        assert.equal(custDbRes.rows.length, 1);
        assert.equal(custDbRes.rows[0].governorate, 'الإسكندرية');
        assert.equal(custDbRes.rows[0].shop_photo, TINY_PNG_DATA_URL);
        assert.equal(custDbRes.rows[0].phones_json.length, 2);

        const invDbRes = await pgPool.query(
          `SELECT id, status, dispatch_status, is_rep_purchase, recipient_user_id, dispatch_history FROM invoices WHERE id = $1`,
          [repDraftInvId]
        );
        assert.equal(invDbRes.rows.length, 1);
        assert.equal(invDbRes.rows[0].status, 'confirmed');
        assert.equal(invDbRes.rows[0].dispatch_status, 'confirmed');
        assert.equal(invDbRes.rows[0].is_rep_purchase, true);
        assert.ok(Array.isArray(invDbRes.rows[0].dispatch_history));
      });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  try {
    resetPgModeCache();
    await runSuite('JSON Ledger HTTP API', false, null);

    const pgPool = createPgMemPool();
    setInjectedPool(pgPool);
    const init = await initializeSchema();
    assert.equal(init.success, true, `Postgres schema init failed: ${init.error}`);
    process.env.DB_STRICT_MODE = 'true';
    resetPgModeCache();
    await runSuite('Strict Postgres (pg-mem) HTTP API', true, pgPool);

    console.log(`\nALL REP PURCHASE / CUSTOMER / RBAC VERIFICATION TESTS PASSED: ${passed} / ${passed}`);
  } finally {
    delete process.env.DB_STRICT_MODE;
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nVerification suite failed:', err);
  process.exit(1);
});

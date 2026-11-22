import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

// Isolate data directory BEFORE importing server modules
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_master_repair_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'master_repair_jwt_secret_key_for_awlad_selim_erp_2026_secure';

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

async function runMasterRepairSuite(label) {
  console.log(`\n=== ${label} ===`);
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    let adminToken = '';
    let rep1Token = '';
    let rep2Token = '';
    let viewerToken = '';
    let rep1Id = '';
    let rep2Id = '';
    let whMainId = '';
    let cbMainId = '';
    let custId = '';
    let suppId = '';
    let prodId = '';

    await test(`${label} | 1. Bootstrap admin, users, reps, warehouse, cashbox, customer, supplier & base product`, async () => {
      const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
        body: {
          fullName: 'مدير التدقيق',
          username: 'repair_admin',
          password: 'AdminStrongPassword!99',
          phone: '01000001001',
        },
      });
      assert.equal(bootAdmin.status, 201);

      adminToken = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'repair_admin', password: 'AdminStrongPassword!99' },
        })
      ).json.accessToken;

      const whRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
        token: adminToken,
        body: { name: 'المستودع الرئيسي للاختبار', code: 'WH-M', isDefault: true },
      });
      assert.equal(whRes.status, 201);
      whMainId = whRes.json.warehouse.id;

      const cbRes = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
        token: adminToken,
        body: { name: 'الخزينة الرئيسية للاختبار', type: 'cash', openingBalance: 10000, isDefault: true },
      });
      assert.equal(cbRes.status, 201);
      cbMainId = cbRes.json.cashbox.id;

      // Two reps to verify rep ownership on invoice edit
      const rep1User = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مندوب أول',
          username: 'rep_one',
          password: 'RepPassword!11',
          phone: '01011111111',
          role: 'representative',
          permissions: { canView: true, canAdd: true, canEdit: true, canManageSales: true },
        },
      });
      assert.equal(rep1User.status, 201);
      rep1Token = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'rep_one', password: 'RepPassword!11' },
        })
      ).json.accessToken;

      const rep2User = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مندوب ثانٍ',
          username: 'rep_two',
          password: 'RepPassword!22',
          phone: '01022222222',
          role: 'representative',
          permissions: { canView: true, canAdd: true, canEdit: true, canManageSales: true },
        },
      });
      assert.equal(rep2User.status, 201);
      rep2Token = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'rep_two', password: 'RepPassword!22' },
        })
      ).json.accessToken;

      const viewerUser = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مستخدم مشاهدة',
          username: 'viewer_user',
          password: 'ViewPassword!33',
          role: 'sales',
          permissions: { canView: true, canManageInventory: false, canManagePurchases: false },
        },
      });
      assert.equal(viewerUser.status, 201);
      viewerToken = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'viewer_user', password: 'ViewPassword!33' },
        })
      ).json.accessToken;

      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      let r1 = (boot.representatives || []).find((r) => r.userId === rep1User.json.user.id);
      if (!r1) {
        r1 = (
          await req(baseUrl, 'POST', '/api/admin/representatives', {
            token: adminToken,
            body: { name: 'مندوب أول', phone: '01011111111', userId: rep1User.json.user.id },
          })
        ).json.representative;
      }
      rep1Id = r1.id;

      let r2 = (boot.representatives || []).find((r) => r.userId === rep2User.json.user.id);
      if (!r2) {
        r2 = (
          await req(baseUrl, 'POST', '/api/admin/representatives', {
            token: adminToken,
            body: { name: 'مندوب ثانٍ', phone: '01022222222', userId: rep2User.json.user.id },
          })
        ).json.representative;
      }
      rep2Id = r2.id;

      const cRes = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: {
          code: 'C-REPAIR-1',
          name: 'شركة النور التجارية',
          shopName: 'سوبر ماركت النور',
          phone: '01200000001',
          secondaryPhone: '01200000002',
          allowedRepIds: [rep1Id, rep2Id],
        },
      });
      assert.equal(cRes.status, 201);
      custId = cRes.json.customer.id;
      assert.equal(cRes.json.customer.secondaryPhone, '01200000002');

      const sRes = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: { code: 'S-REPAIR-1', name: 'مورد الجملة المتحدة', phone: '01500000001' },
      });
      assert.equal(sRes.status, 201);
      suppId = sRes.json.supplier.id;

      const pRes = await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'SKU-TEA-01',
          barcode: '622999000111',
          name: 'شاي أحمد ناعم 250 جم',
          category: 'مشروبات ساخنة',
          baseUnit: 'عبوة',
          purchasePrice: 40,
          sellingPrice: 55,
          stockPerWarehouse: { [whMainId]: 100 },
          units: [
            { name: 'كرتونة', conversionFactor: 10, barcode: '622999000999', purchasePrice: 400, sellingPrice: 540 },
          ],
        },
      });
      assert.equal(pRes.status, 201);
      prodId = pRes.json.product.id;
    });

    await test(`${label} | 2. Confirmed Sales Invoice Edit records reason, editHistory, audit_logs (oldValues/newValues), sale_edit movements & guards`, async () => {
      // Rep 1 creates confirmed partial sales invoice: 10 units @ 55 = 550, paid 200, remaining 350
      const saleRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: rep1Token,
        body: {
          customerId: custId,
          warehouseId: whMainId,
          cashboxId: cbMainId,
          status: 'confirmed',
          paymentType: 'partial',
          paidAmount: 200,
          items: [{ productId: prodId, productName: 'شاي أحمد ناعم 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 10, unitPrice: 55 }],
        },
      });
      assert.equal(saleRes.status, 201);
      const invId = saleRes.json.invoice.id;

      // Partial balance return of 2 units (2 * 55 = 110) before editing -> stock 100 - 10 + 2 = 92; custBalance = 350 - 110 = 240
      const retRes = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: adminToken,
        body: {
          type: 'sales_return',
          originalInvoiceId: invId,
          originalInvoiceNumber: saleRes.json.invoice.invoiceNumber,
          partyId: custId,
          warehouseId: whMainId,
          refundType: 'balance',
          reason: 'مرتجع 2 عبوة قبل التعديل',
          items: [{ productId: prodId, productName: 'شاي أحمد ناعم 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 2, unitPrice: 55, total: 110 }],
          grandTotal: 110,
        },
      });
      assert.equal(retRes.status, 201);

      // Rep 2 cannot edit Rep 1's invoice -> 403
      const rep2Edit = await req(baseUrl, 'PUT', `/api/invoices/${invId}`, {
        token: rep2Token,
        body: {
          reason: 'محاولة تعديل غير مصرحة',
          items: [{ productId: prodId, productName: 'شاي أحمد ناعم 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 12, unitPrice: 55 }],
        },
      });
      assert.equal(rep2Edit.status, 403);

      // Guard: setting grandTotal below paidAmount (200) -> 400 GRAND_TOTAL_BELOW_PAID
      const belowPaid = await req(baseUrl, 'PUT', `/api/invoices/${invId}`, {
        token: adminToken,
        body: {
          reason: 'تخفيض أقل من المدفوع',
          items: [{ productId: prodId, productName: 'شاي أحمد ناعم 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 3, unitPrice: 55 }],
        },
      });
      assert.equal(belowPaid.status, 400);
      assert.equal(belowPaid.json.code, 'GRAND_TOTAL_BELOW_PAID');

      // Guard: setting quantity below returnedQuantityByItem (2) -> 400 BELOW_RETURNED_QUANTITY
      const belowRet = await req(baseUrl, 'PUT', `/api/invoices/${invId}`, {
        token: adminToken,
        body: {
          reason: 'تخفيض أقل من المرتجع',
          items: [{ productId: prodId, productName: 'شاي أحمد ناعم 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 1, unitPrice: 250 }],
        },
      });
      assert.equal(belowRet.status, 400);
      assert.equal(belowRet.json.code, 'BELOW_RETURNED_QUANTITY');

      // Valid edit: change quantity from 10 to 14 @ 55 = 770 (diff = +220), preserving paidAmount = 200 & cashbox = 10200
      const editRes = await req(baseUrl, 'PUT', `/api/invoices/${invId}`, {
        token: adminToken,
        body: {
          reason: 'زيادة الكمية المطلوبة من العميل',
          items: [{ productId: prodId, productName: 'شاي أحمد ناعم 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 14, unitPrice: 55 }],
        },
      });
      assert.equal(editRes.status, 200);
      const editedInv = editRes.json.invoice;
      assert.equal(editedInv.grandTotal, 770);
      assert.equal(editedInv.paidAmount, 200);
      assert.equal(editedInv.remainingAmount, 570);
      assert.equal(editedInv.editHistory.length, 1);
      assert.equal(editedInv.editHistory[0].reason, 'زيادة الكمية المطلوبة من العميل');
      assert.equal(editedInv.editHistory[0].before.grandTotal, 550);
      assert.equal(editedInv.editHistory[0].after.grandTotal, 770);

      // Verify stock (92 - 4 = 88), customer balance (240 + 220 = 460), cashbox unchanged (10200)
      const boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(Number(boot.products.find((p) => p.id === prodId).stockPerWarehouse[whMainId]), 88);
      assert.equal(Number(boot.customers.find((c) => c.id === custId).currentBalance), 460);
      assert.equal(Number(boot.cashboxes.find((c) => c.id === cbMainId).currentBalance), 10200);

      // Verify sale_edit movement has balanceBefore=92, balanceAfter=88
      const editMv = (boot.stockMovements || []).find(
        (m) => m.referenceId === invId && (m.type === 'sale_edit' || m.movementType === 'sale_edit')
      );
      assert.ok(editMv, 'sale_edit movement must exist');
      assert.equal(Number(editMv.quantity), 4);
      assert.equal(Number(editMv.balanceBefore), 92);
      assert.equal(Number(editMv.balanceAfter), 88);

      // Verify audit log has oldValues & newValues
      const auditRes = await req(baseUrl, 'GET', '/api/admin/audit-logs?limit=20', { token: adminToken });
      assert.equal(auditRes.status, 200);
      const editLog = auditRes.json.logs.find((l) => l.recordId === invId && String(l.action).includes('تعديل فاتورة'));
      assert.ok(editLog, 'Audit log for edit must exist');
      assert.equal(editLog.oldValues.grandTotal, 550);
      assert.equal(editLog.newValues.grandTotal, 770);
      assert.equal(editLog.details, 'زيادة الكمية المطلوبة من العميل');

      // Now cancel this edited+partially-returned sales invoice -> reverses only unreturned 14 - 2 = 12 units (88 -> 100),
      // reverses customer balance (remaining 570 - prior balance return 110 = 460 -> 460 - 460 = 0),
      // reverses cashbox paidAmount 200 (10200 -> 10000), reverses rep1 balance (200 -> 0)
      const cancelRes = await req(baseUrl, 'POST', `/api/invoices/${invId}/cancel`, {
        token: adminToken,
        body: { reason: 'إلغاء بعد تعديل ومرتجع جزئي' },
      });
      assert.equal(cancelRes.status, 200);
      assert.equal(cancelRes.json.invoice.status, 'cancelled');

      const bootAfterCancel = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(Number(bootAfterCancel.products.find((p) => p.id === prodId).stockPerWarehouse[whMainId]), 100);
      assert.equal(Number(bootAfterCancel.customers.find((c) => c.id === custId).currentBalance), 0);
      assert.equal(Number(bootAfterCancel.cashboxes.find((c) => c.id === cbMainId).currentBalance), 10000);
      assert.equal(Number(bootAfterCancel.representatives.find((r) => r.id === rep1Id).currentBalance), 0);

      const cancelMv = (bootAfterCancel.stockMovements || []).find(
        (m) => m.referenceId === invId && (m.type === 'sale_cancel' || m.movementType === 'sale_cancel')
      );
      assert.ok(cancelMv, 'sale_cancel movement must exist');
      assert.equal(Number(cancelMv.quantity), 12);
      assert.equal(Number(cancelMv.balanceBefore), 88);
      assert.equal(Number(cancelMv.balanceAfter), 100);

      const cancelFt = (bootAfterCancel.financialTransactions || []).find((ft) => ft.relatedDocId === invId && ft.type === 'withdrawal');
      assert.ok(cancelFt, 'Linked financial_transaction reversal row must exist');
      assert.equal(Number(cancelFt.amount), 200);
    });

    await test(`${label} | 3. Purchase inline new product (single stock increment), 3-tier duplicate check & purchase cancel after partial return`, async () => {
      // Viewer without inventory/purchase permissions gets 403 on duplicate check
      const forbiddenDup = await req(baseUrl, 'POST', '/api/products/check-duplicate', {
        token: viewerToken,
        body: { name: 'شاي أحمد' },
      });
      assert.equal(forbiddenDup.status, 403);

      // Duplicate check Tier 1: unit barcode match
      const dupBarcode = await req(baseUrl, 'POST', '/api/products/check-duplicate', {
        token: adminToken,
        body: { barcode: '622999000999', name: 'اسم مختلف' },
      });
      assert.equal(dupBarcode.status, 200);
      assert.equal(dupBarcode.json.matchReason, 'barcode');
      assert.equal(dupBarcode.json.exactMatch.id, prodId);

      // Duplicate check Tier 2: product code match
      const dupCode = await req(baseUrl, 'POST', '/api/products/check-duplicate', {
        token: adminToken,
        body: { code: 'sku-tea-01', name: 'اسم آخر' },
      });
      assert.equal(dupCode.status, 200);
      assert.equal(dupCode.json.matchReason, 'code');
      assert.equal(dupCode.json.exactMatch.id, prodId);

      // Duplicate check Tier 3: normalized Arabic name + category + baseUnit (أ -> ا, ة -> ه)
      const dupComposite = await req(baseUrl, 'POST', '/api/products/check-duplicate', {
        token: adminToken,
        body: { name: 'شاي احمد  ناعم 250 جم', category: 'مشروبات ساخنه', baseUnit: 'عبوه' },
      });
      assert.equal(dupComposite.status, 200);
      assert.equal(dupComposite.json.matchReason, 'name_category_unit');
      assert.equal(dupComposite.json.exactMatch.id, prodId);

      // Similar name with DIFFERENT unit -> no exactMatch, but appears in similarMatches
      const simRes = await req(baseUrl, 'POST', '/api/products/check-duplicate', {
        token: adminToken,
        body: { name: 'شاي احمد ناعم', category: 'مشروبات ساخنة', baseUnit: 'كيلو' },
      });
      assert.equal(simRes.status, 200);
      assert.equal(simRes.json.exactMatch, null);
      assert.ok(simRes.json.similarMatches.some((p) => p.id === prodId));

      // Create purchase invoice with an inline new product (qty = 10 @ 25 = 250, paid 100, remaining 150)
      const purRes = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: adminToken,
        body: {
          supplierId: suppId,
          warehouseId: whMainId,
          cashboxId: cbMainId,
          status: 'confirmed',
          paymentType: 'partial',
          paidAmount: 100,
          items: [
            {
              productId: '',
              productName: 'قهوة سريعه الذوبان 100 جم',
              unit: 'برطمان',
              unitFactor: 1,
              quantity: 10,
              unitPrice: 25,
              newProduct: {
                name: 'قهوة سريعه الذوبان 100 جم',
                code: 'SKU-COF-99',
                barcode: '622555888777',
                category: 'مشروبات ساخنة',
                baseUnit: 'برطمان',
                purchasePrice: 25,
                sellingPrice: 35,
              },
            },
          ],
        },
      });
      assert.equal(purRes.status, 201);
      const purInv = purRes.json.invoice;
      const inlineProdId = purInv.items[0].productId;
      assert.ok(inlineProdId, 'Inline new product must receive generated productId');

      let boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      const createdProd = boot.products.find((p) => p.id === inlineProdId);
      assert.ok(createdProd);
      // CRITICAL: stock MUST be 10 (incremented ONCE, never 20!)
      assert.equal(Number(createdProd.stockPerWarehouse[whMainId]), 10);
      assert.equal(Number(boot.suppliers.find((s) => s.id === suppId).currentBalance), 150);
      assert.equal(Number(boot.cashboxes.find((c) => c.id === cbMainId).currentBalance), 9900);

      // Verify purchase movement has balanceBefore=0, balanceAfter=10
      const purMv = (boot.stockMovements || []).find(
        (m) => m.referenceId === purInv.id && (m.type === 'purchase' || m.movementType === 'purchase')
      );
      assert.ok(purMv);
      assert.equal(Number(purMv.balanceBefore), 0);
      assert.equal(Number(purMv.balanceAfter), 10);

      // Partial purchase balance return of 3 units (3 * 25 = 75): stock 10 -> 7, supplier 150 -> 75
      const purRet = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: adminToken,
        body: {
          type: 'purchase_return',
          originalInvoiceId: purInv.id,
          originalInvoiceNumber: purInv.invoiceNumber,
          partyId: suppId,
          warehouseId: whMainId,
          refundType: 'balance',
          reason: 'مرتجع 3 برطمانات',
          items: [{ productId: inlineProdId, productName: createdProd.name, unit: 'برطمان', unitFactor: 1, quantity: 3, unitPrice: 25, total: 75 }],
          grandTotal: 75,
        },
      });
      assert.equal(purRet.status, 201);

      // Cancel purchase invoice -> reverses ONLY remaining 7 units (7 -> 0), supplier (75 - 75 = 0), cashbox (+100 -> 10000)
      const cancelPur = await req(baseUrl, 'POST', `/api/invoices/${purInv.id}/cancel`, {
        token: adminToken,
        body: { reason: 'إلغاء فاتورة المشتريات بعد مرتجع جزئي' },
      });
      assert.equal(cancelPur.status, 200);

      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(Number(boot.products.find((p) => p.id === inlineProdId).stockPerWarehouse[whMainId]), 0);
      assert.equal(Number(boot.suppliers.find((s) => s.id === suppId).currentBalance), 0);
      assert.equal(Number(boot.cashboxes.find((c) => c.id === cbMainId).currentBalance), 10000);

      // Submitting inline newProduct with existing barcode reuses existing inlineProdId instead of creating duplicate SKU
      const countBefore = boot.products.length;
      const purReuse = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: adminToken,
        body: {
          supplierId: suppId,
          warehouseId: whMainId,
          cashboxId: cbMainId,
          status: 'confirmed',
          paymentType: 'credit',
          paidAmount: 0,
          items: [
            {
              productId: '',
              productName: 'قهوة نفس الباركود',
              unit: 'برطمان',
              unitFactor: 1,
              quantity: 5,
              unitPrice: 25,
              newProduct: { name: 'قهوة نفس الباركود', barcode: '622555888777' },
            },
          ],
        },
      });
      assert.equal(purReuse.status, 201);
      assert.equal(purReuse.json.invoice.items[0].productId, inlineProdId);

      boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      assert.equal(boot.products.length, countBefore);
      assert.equal(Number(boot.products.find((p) => p.id === inlineProdId).stockPerWarehouse[whMainId]), 5);
    });

    await test(`${label} | 4. Cash return cancel + Order Advance restore + Comprehensive Report balance & lifecycle exclusion`, async () => {
      // Create & approve customer order with an advance payment of 80
      const custAccountRes = await req(baseUrl, 'POST', `/api/customers/${custId}/link-user`, {
        token: adminToken,
        body: { createUser: { username: 'cust_nour', password: 'CustomerPassword!1', phone: '01200000001' } },
      });
      assert.equal(custAccountRes.status, 200);
      const custToken = (
        await req(baseUrl, 'POST', '/api/auth/login', {
          body: { username: 'cust_nour', password: 'CustomerPassword!1' },
        })
      ).json.accessToken;

      const ordRes = await req(baseUrl, 'POST', '/api/orders', {
        token: custToken,
        body: { items: [{ productId: prodId, unit: 'عبوة', quantity: 5 }] },
      });
      assert.equal(ordRes.status, 201);
      const orderId = ordRes.json.order.id;

      await req(baseUrl, 'POST', `/api/orders/${orderId}/approve`, { token: adminToken, body: {} });
      const advRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/advance-payment`, {
        token: adminToken,
        body: { amount: 80, cashboxId: cbMainId, notes: 'عربون طلب' },
      });
      assert.equal(advRes.status, 201);

      // Convert order to confirmed sales invoice (5 * 55 = 275, paidAtInvoice = 120 + advance 80 = 200, remaining = 75)
      const convRes = await req(baseUrl, 'POST', `/api/orders/${orderId}/convert-to-invoice`, {
        token: adminToken,
        body: {
          warehouseId: whMainId,
          cashboxId: cbMainId,
          status: 'confirmed',
          paymentType: 'partial',
          paidAtInvoice: 120,
          appliedAdvanceAmount: 80,
          items: [{ productId: prodId, productName: 'شاي أحمد ناعم 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 5, unitPrice: 55 }],
        },
      });
      assert.equal(convRes.status, 201);
      const advInv = convRes.json.invoice;

      // Cash return of 1 unit (55) on cashbox cbMainId
      const cashRet = await req(baseUrl, 'POST', '/api/invoices/returns', {
        token: adminToken,
        body: {
          type: 'sales_return',
          originalInvoiceId: advInv.id,
          originalInvoiceNumber: advInv.invoiceNumber,
          partyId: custId,
          warehouseId: whMainId,
          cashboxId: cbMainId,
          refundType: 'cash',
          reason: 'مرتجع نقدي 1 عبوة',
          items: [{ productId: prodId, productName: 'شاي أحمد ناعم 250 جم', unit: 'عبوة', unitFactor: 1, quantity: 1, unitPrice: 55, total: 55 }],
          grandTotal: 55,
        },
      });
      assert.equal(cashRet.status, 201);

      // Cancel invoice: net cash paid at invoice (120) minus cash return (55) = 65 reversed from cashbox; advance (80) restored!
      const cancelAdvInv = await req(baseUrl, 'POST', `/api/invoices/${advInv.id}/cancel`, {
        token: adminToken,
        body: { reason: 'إلغاء طلب بعربون ومرتجع نقدي' },
      });
      assert.equal(cancelAdvInv.status, 200);

      const bootAfter = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
      // Cashbox balance should be: 10000 + 80 (active restored advance) + 120 (at invoice) - 55 (cash return) - 65 (cancel reversal) = 10080
      const liveCb = Number(bootAfter.cashboxes.find((c) => c.id === cbMainId).currentBalance);
      assert.equal(liveCb, 10080);

      // Restored advance should be active again
      const restoredAdv = (bootAfter.orderAdvancePayments || []).find((a) => a.orderId === orderId);
      assert.ok(restoredAdv);
      assert.equal(restoredAdv.status, 'active');

      // Comprehensive Report drawerBalance must match liveCb (10080) with 0 variance, and itemLifecycle must NOT double-count sale_edit/sale_cancel
      const rptRes = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&productId=${encodeURIComponent(prodId)}`,
        { token: adminToken }
      );
      assert.equal(rptRes.status, 200);
      assert.equal(Number(rptRes.json.report.summary.drawerBalance), liveCb);
      const lifecycleMovements = rptRes.json.report.itemLifecycle?.movements || [];
      assert.equal(
        lifecycleMovements.some((m) => ['sale_edit', 'purchase_edit', 'sale_cancel', 'purchase_cancel'].includes(m.movementType || m.type)),
        false,
        'itemLifecycle must exclude raw sale_edit/purchase_edit/sale_cancel/purchase_cancel adjustment rows'
      );
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  try {
    resetPgModeCache();
    await runMasterRepairSuite('JSON Ledger HTTP API');

    const pgPool = createPgMemPool();
    setInjectedPool(pgPool);
    const init = await initializeSchema();
    assert.equal(init.success, true, `Postgres schema init failed: ${init.error}`);
    process.env.DB_STRICT_MODE = 'true';
    resetPgModeCache();
    await runMasterRepairSuite('Strict Postgres (pg-mem) HTTP API');

    console.log(`\nALL MASTER REPAIR VERIFICATION TESTS PASSED: ${passed} / ${passed}`);
  } finally {
    delete process.env.DB_STRICT_MODE;
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nMaster repair verification suite failed:', err);
  process.exit(1);
});

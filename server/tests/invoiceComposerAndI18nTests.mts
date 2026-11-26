import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_composer_i18n_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'awlad_selim_composer_i18n_test_secret_2026_secure';

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

// Browser-like globals for translator/sync tests
const memStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (memStorage.has(k) ? memStorage.get(k)! : null),
  setItem: (k: string, v: string) => memStorage.set(k, String(v)),
  removeItem: (k: string) => memStorage.delete(k),
  clear: () => memStorage.clear(),
};

const mockRoot = {
  dir: 'rtl',
  lang: 'ar',
  attributes: new Map<string, string>(),
  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
  },
  getAttribute(k: string) {
    return this.attributes.get(k);
  },
};
const mockBody = {
  dir: 'rtl',
  style: { textAlign: 'right' },
};
(globalThis as any).document = {
  documentElement: mockRoot,
  body: mockBody,
  title: '',
};
(globalThis as any).window = {
  location: { origin: 'http://127.0.0.1', protocol: 'http:' },
  localStorage: (globalThis as any).localStorage,
};

const { roundCurrency, computeLineTotal } = await import('../../src/utils/quantity.ts');
const {
  tr,
  setActiveLanguageRuntime,
  getActiveLanguage,
  getActiveDir,
  getActiveLocale,
  translateSystemEntityName,
} = await import('../../src/i18n/translator.ts');
const { AR_TO_EN_MAP, translateDynamicArabic } = await import('../../src/i18n/dictionary.ts');
const { createApiApp } = await import('../app.js');
const { setInjectedPool } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');

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

async function req(baseUrl: string, method: string, urlPath: string, { token, body }: any = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

console.log('\n=== Invoice Composer & Complete AR/EN i18n Test Suite ===');

await test('1. Classic invoice line totals, discounts, and remaining balance calculations are accurate', () => {
  const line1 = computeLineTotal(5, 10, 0);
  const line2 = computeLineTotal(2, 58, 4);
  assert.equal(line1, 50);
  assert.equal(line2, 112);

  const subtotal = roundCurrency(line1 + line2);
  const discount = roundCurrency(12);
  const grandTotal = Math.max(0, roundCurrency(subtotal - discount));
  const paid = roundCurrency(100);
  const remaining = Math.max(0, roundCurrency(grandTotal - paid));

  assert.equal(subtotal, 162);
  assert.equal(grandTotal, 150);
  assert.equal(remaining, 50);

  const decimalTotal = computeLineTotal(3, 10.34, roundCurrency(1.005));
  assert.equal(decimalTotal, roundCurrency(3 * 10.34 - roundCurrency(1.005)));
});

await test('2. Restored classic invoice and stock transfer views do not reference InvoiceWritingWorkspace or invoiceComposer', () => {
  const filesToCheck = [
    path.resolve(process.cwd(), 'src/components/modules/sales/NewSaleInvoiceModal.tsx'),
    path.resolve(process.cwd(), 'src/components/modules/purchases/PurchaseInvoicesView.tsx'),
    path.resolve(process.cwd(), 'src/components/modules/representatives/RepTransferView.tsx'),
    path.resolve(process.cwd(), 'src/components/modules/mobile/RepPortal.tsx'),
  ];
  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(!content.includes('InvoiceWritingWorkspace'), `${filePath} should not contain InvoiceWritingWorkspace`);
    assert.ok(!content.includes('invoiceComposer'), `${filePath} should not contain invoiceComposer`);
  }
});

await test('3. Sales subtotal + discountTotal calculation & Rep Stock Transfer creates custody without rep debt/profit', async () => {
  setInjectedPool(null);
  resetPgModeCache();
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as any;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Bootstrap admin
    const bootAdmin = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
      body: { fullName: 'طارق سليم', username: 'admin_comp', password: 'StrongPassword!123', phone: '01010000001' },
    });
    assert.equal(bootAdmin.status, 201);
    const adminToken = (
      await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin_comp', password: 'StrongPassword!123' },
      })
    ).json.accessToken;

    const boot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    const whMainId = boot.warehouses[0].id;
    const cashboxMainId = boot.cashboxes[0].id;

    // Create product & customer & rep
    const prod = (
      await req(baseUrl, 'POST', '/api/products', {
        token: adminToken,
        body: {
          code: 'P-CALC',
          name: 'بسكويت سليم فاخر',
          category: 'بسكويت',
          baseUnit: 'قطعة',
          purchasePrice: 8,
          sellingPrice: 12.5,
          stockPerWarehouse: { [whMainId]: 100 },
          status: 'active',
        },
      })
    ).json.product;

    const cust = (
      await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { code: 'C-CALC', name: 'شركة النور للتجارة', phone: '01099887766' },
      })
    ).json.customer;

    const repUserRes = await req(baseUrl, 'POST', '/api/admin/users', {
      token: adminToken,
      body: {
        username: 'rep_karim',
        fullName: 'كريم عبد الله',
        password: 'RepPassword!123',
        phone: '01055443322',
        role: 'representative',
        jobTitle: 'مندوب مبيعات',
        department: 'المناديب',
        permissions: { canView: true, canAdd: true, canManageSales: true },
      },
    });
    assert.equal(repUserRes.status, 201);
    const repUser = repUserRes.json.user;

    const vanWhRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
      token: adminToken,
      body: { name: 'سيارة المندوب (كريم)', location: 'خط القاهرة', managerName: 'كريم عبد الله' },
    });
    assert.equal(vanWhRes.status, 201);
    const vanWh = vanWhRes.json.warehouse;

    const repProfRes = await req(baseUrl, 'POST', '/api/admin/representatives', {
      token: adminToken,
      body: { name: 'كريم عبد الله', phone: '01055443322', userId: repUser.id, warehouseId: vanWh.id, openingBalance: 0 },
    });
    assert.equal(repProfRes.status, 201);
    const repProfile = repProfRes.json.representative;

    // Sales invoice with line discount (10 * 12.50 - 5 = 120 net line) + header discount (10) -> subtotal 125, discountTotal 15, grandTotal 110
    const saleRes = await req(baseUrl, 'POST', '/api/invoices/sales', {
      token: adminToken,
      body: {
        customerId: cust.id,
        warehouseId: whMainId,
        cashboxId: cashboxMainId,
        status: 'confirmed',
        paymentType: 'cash',
        paidAmount: 110,
        discountTotal: 15,
        items: [
          {
            productId: prod.id,
            productName: prod.name,
            unit: 'قطعة',
            unitFactor: 1,
            quantity: 10,
            unitPrice: 12.5,
            discount: 5,
            total: 120,
          },
        ],
      },
    });
    assert.equal(saleRes.status, 201);
    assert.equal(roundCurrency(saleRes.json.invoice.subtotal), 125);
    assert.equal(roundCurrency(saleRes.json.invoice.discountTotal), 15);
    assert.equal(roundCurrency(saleRes.json.invoice.grandTotal), 110);

    // Rep stock transfer (Admin -> Rep Van Custody): dispatch 20 units directly to rep van
    const repWhId = repProfile.warehouseId || vanWh.id;
    const transferRes = await req(baseUrl, 'POST', '/api/inventory/rep-item-transfers', {
      token: adminToken,
      body: {
        representativeId: repProfile.id,
        sourceWarehouseId: whMainId,
        sourceWarehouseName: 'المستودع الرئيسي',
        targetWarehouseId: repWhId,
        targetWarehouseName: vanWh.name,
        transferMode: 'custody_dispatch',
        autoDispatch: true,
        notes: 'تحويل عهدة افتتاحية',
        items: [{ productId: prod.id, productName: prod.name, unit: 'قطعة', unitFactor: 1, requestedQty: 20 }],
      },
    });
    assert.equal(transferRes.status, 201);
    const reqId = transferRes.json.request.id;

    // Admin approves & executes if not already executed, then rep confirms physical receipt
    if (transferRes.json.request.status !== 'executed') {
      if (transferRes.json.request.status === 'pending') {
        assert.equal(
          (await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${reqId}/status`, {
            token: adminToken,
            body: { status: 'approved' },
          })).status,
          200
        );
      }
      assert.equal(
        (await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${reqId}/status`, {
          token: adminToken,
          body: { status: 'executed' },
        })).status,
        200
      );
    }

    const repToken = (
      await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'rep_karim', password: 'RepPassword!123' },
      })
    ).json.accessToken;

    const acceptRes = await req(baseUrl, 'POST', `/api/inventory/rep-item-transfers/${reqId}/status`, {
      token: repToken,
      body: { status: 'received', notes: 'تم استلام العهدة' },
    });
    assert.equal(acceptRes.status, 200);

    // Check rep custody & verify NO debt/revenue/profit added to cashbox or customers
    const afterBoot = (await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken })).json.data;
    const repWhStock = Number(
      afterBoot.products.find((p: any) => p.id === prod.id).stockPerWarehouse[repWhId] ?? 0
    );
    assert.equal(repWhStock, 20);
    const stmt = (
      await req(baseUrl, 'GET', `/api/inventory/rep-custody/statement?repId=${repProfile.id}`, { token: adminToken })
    ).json.statement;
    assert.equal(stmt.itemsSummary.find((i: any) => i.productId === prod.id).remainingCustodyQty, 20);
    assert.equal(afterBoot.cashboxes.find((c: any) => c.id === cashboxMainId).currentBalance, 110); // Only the sale cash!
    assert.equal(afterBoot.customers.find((c: any) => c.id === cust.id).currentBalance, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('4. Complete AR/EN translation switches UI & dir/lang while strictly preserving user-entered data', () => {
  // Switch to English
  setActiveLanguageRuntime('en');
  assert.equal(getActiveLanguage(), 'en');
  assert.equal(getActiveDir(), 'ltr');
  assert.equal(getActiveLocale(), 'en-US');
  assert.equal(mockRoot.dir, 'ltr');
  assert.equal(mockRoot.lang, 'en');
  assert.equal(mockBody.style.textAlign, 'left');

  // Explicit bilingual UI calls
  assert.equal(tr('المبيعات وفواتير البيع', 'Sales & Invoices'), 'Sales & Invoices');
  assert.equal(tr('حفظ وإرسال للموافقة', 'Save & Submit for Approval'), 'Save & Submit for Approval');

  // Dictionary lookups for status badges / currency / units / payment labels
  assert.equal(tr('ج.م'), 'EGP');
  assert.equal(tr('قطعة'), 'Piece');
  assert.equal(tr('كرتونة'), 'Carton');
  assert.equal(tr('مؤكدة'), 'Confirmed');
  assert.equal(tr('نقدي'), 'Cash');
  assert.equal(tr('إرسال واستلام'), 'Send & Receive');

  // Dynamic backend report/voucher patterns
  assert.equal(translateDynamicArabic('فاتورة مبيعات رقم INV-2026-0015'), 'Sales Invoice #INV-2026-0015');
  assert.equal(translateDynamicArabic('فاتورة مشتريات رقم PUR-2026-0008'), 'Purchase Invoice #PUR-2026-0008');
  assert.equal(translateDynamicArabic('سند مالي رقم FIN-2026-0004'), 'Financial Voucher #FIN-2026-0004');
  assert.equal(
    translateDynamicArabic('تسليم من عهدة المندوب للعميل رقم RDL-2026-0003'),
    'Custody Delivery to Customer #RDL-2026-0003'
  );
  assert.ok(Object.keys(AR_TO_EN_MAP).length > 300);

  // Known system entities ARE translated in English mode:
  assert.equal(translateSystemEntityName('عميل نقدي / عام'), 'Cash / Walk-in Customer');
  assert.equal(translateSystemEntityName('المستودع الرئيسي'), 'Main Warehouse');
  assert.equal(translateSystemEntityName('الخزينة الرئيسية'), 'Main Cashbox');
  assert.equal(translateSystemEntityName('سيارة المندوب (كريم)'), 'Rep Van (كريم)');

  // CRITICAL: User-entered Arabic names MUST NEVER be translated/altered!
  const userCustomer = 'سوبرماركت البركة - الحاج أحمد';
  const userSupplier = 'شركة النيل لتوزيع المواد الغذائية';
  const userProduct = 'شيبسي عائلي ملح وخل 100 جم';
  const userRep = 'كريم عبد الله محمد';
  const userNotes = 'عميل مهم جداً - التوصيل قبل الساعة 4 مساءً';

  assert.equal(translateSystemEntityName(userCustomer), userCustomer);
  assert.equal(translateSystemEntityName(userSupplier), userSupplier);
  assert.equal(translateSystemEntityName(userProduct), userProduct);
  assert.equal(translateSystemEntityName(userRep), userRep);
  assert.equal(translateSystemEntityName(userNotes), userNotes);
  assert.equal(tr(userCustomer), userCustomer);
  assert.equal(tr(userProduct), userProduct);

  // Switch back to Arabic
  setActiveLanguageRuntime('ar');
  assert.equal(getActiveLanguage(), 'ar');
  assert.equal(getActiveDir(), 'rtl');
  assert.equal(getActiveLocale(), 'ar-EG');
  assert.equal(mockRoot.dir, 'rtl');
  assert.equal(mockRoot.lang, 'ar');
  assert.equal(mockBody.style.textAlign, 'right');
  assert.equal(tr('المبيعات وفواتير البيع', 'Sales & Invoices'), 'المبيعات وفواتير البيع');
  assert.equal(translateSystemEntityName('المستودع الرئيسي'), 'المستودع الرئيسي');
});

console.log(`\nALL COMPOSER & I18N TESTS PASSED (${passed}/${passed})\n`);
process.exit(0);

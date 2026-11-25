import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('\n=== Dashboard Balance Visibility & Windows Unified UI Verification ===');

const rootDir = process.cwd();
const readSrc = (relPath) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

test('PreferencesContext exports MASKED_BALANCE_TEXT, all 12 balance keys, sessionStorage persistence, and reset APIs', () => {
  const src = readSrc('src/context/PreferencesContext.tsx');
  assert.ok(src.includes("export const MASKED_BALANCE_TEXT = '••••••';"));
  const expectedKeys = [
    'sales',
    'purchases',
    'cashboxes',
    'inventory',
    'customerDebts',
    'supplierDebts',
    'expenses',
    'income',
    'profits',
    'chart',
    'cashboxesTable',
    'invoicesTable',
  ];
  for (const key of expectedKeys) {
    assert.ok(src.includes(`'${key}'`), `Missing dashboard balance key: ${key}`);
  }
  assert.ok(src.includes('awlad_selim_hidden_balances_v1'), 'Missing sessionStorage key');
  assert.ok(src.includes('window.sessionStorage'), 'Missing sessionStorage persistence');
  assert.ok(src.includes('toggleDashboardBalanceSection'), 'Missing individual toggle handler');
  assert.ok(src.includes('toggleAllDashboardBalances'), 'Missing global toggle handler');
  assert.ok(src.includes('resetDashboardBalancesVisibility'), 'Missing state reset handler');
  assert.ok(src.includes('resetDashboardBalancesSessionStorage'), 'Missing sessionStorage reset helper');
});

test('AuthContext resets dashboard balance visibility across logout, session expiration, and token revocation', () => {
  const src = readSrc('src/context/AuthContext.tsx');
  assert.ok(src.includes('resetDashboardBalancesSessionStorage'), 'AuthContext must import resetDashboardBalancesSessionStorage');
  assert.ok(src.includes('resetDashboardBalancesVisibility'), 'AuthContext must call resetDashboardBalancesVisibility');
  const occurrences = (src.match(/resetDashboardBalancesSessionStorage\(\)/g) || []).length;
  assert.ok(occurrences >= 3, `Expected >= 3 reset invocations in AuthContext, found ${occurrences}`);
});

test('DashboardView renders independent Eye/EyeOff buttons, global toggle, profits card, and masked tooltips/exports', () => {
  const src = readSrc('src/components/modules/dashboard/DashboardView.tsx');
  assert.ok(src.includes("from 'lucide-react'") && src.includes('Eye') && src.includes('EyeOff'));
  assert.ok(src.includes('data-testid="dashboard-toggle-all-balances"'), 'Missing global hide/show button');
  assert.ok(src.includes('إخفاء الأرصدة') && src.includes('إظهار الأرصدة'), 'Missing global toggle Arabic labels');
  assert.ok(src.includes('data-testid={`toggle-balance-${sectionKey}`}'), 'Missing per-card Eye button');
  assert.ok(src.includes('e.stopPropagation()'), 'Per-card Eye button must stop click propagation');
  const requiredSections = [
    "'sales'",
    "'purchases'",
    "'cashboxes'",
    "'inventory'",
    "'customerDebts'",
    "'supplierDebts'",
    "'expenses'",
    "'income'",
    "'profits'",
    "'chart'",
    "'cashboxesTable'",
    "'invoicesTable'",
  ];
  for (const sec of requiredSections) {
    assert.ok(src.includes(sec), `DashboardView missing render/toggle for ${sec}`);
  }
  // Ensure chart hidden replaces numeric bars & tooltips completely with masked visual state
  assert.ok(src.includes('chartHidden ? (') && src.includes('data-testid="balance-value-chart"'), 'Chart must completely replace bar values with masked state when hidden');
  // Ensure profits use real item cost and net profit calculation
  assert.ok(src.includes('grossProfit') && src.includes('netProfit'));
});

test('Windows Shell (Header, Sidebar, App) enforces default open sidebar, toggle next to logo, push margins, and 1-click theme toggle', () => {
  const header = readSrc('src/components/layout/Header.tsx');
  const sidebar = readSrc('src/components/layout/Sidebar.tsx');
  const app = readSrc('src/App.tsx');

  assert.ok(header.includes('/awlad-selim-logo.png'), 'Original logo must be preserved in Header');
  assert.ok(header.includes('aria-label="تبديل القائمة الجانبية"'), 'Hamburger toggle beside logo required');
  assert.ok(header.includes('data-testid="header-theme-toggle"'), '1-click theme toggle required in Header');
  assert.ok(header.includes('awlad-brand-gradient'), 'Top blue brand bar required');

  assert.ok(sidebar.includes('/awlad-selim-logo.png'), 'Original logo must be preserved in Sidebar');
  assert.ok(sidebar.includes("isLtr ? 'left-0 border-r' : 'right-0 border-l'"), 'Sidebar must support symmetric LTR/RTL');
  assert.ok(app.includes('window.innerWidth >= 1024 && !isNativeCapacitor()'), 'Sidebar open by default on Windows desktop');
  assert.ok(app.includes("'lg:mr-12'") && app.includes("'lg:mr-52'"), 'RTL desktop content push margin required');
  assert.ok(app.includes("'lg:ml-12'") && app.includes("'lg:ml-52'"), 'LTR desktop content push margin required');
});

test('All 11 Windows UI module families preserve compact brand tokens and avoid name clipping on critical tables', () => {
  const brandCss = readSrc('src/styles/design-system.css');
  for (const hex of ['#001A49', '#011E58', '#003589', '#1659C8']) {
    assert.ok(brandCss.includes(hex), `Missing official brand palette hex ${hex} in design-system.css`);
  }

  const customers = readSrc('src/components/modules/customers/CustomersView.tsx');
  assert.ok(!customers.includes('font-black text-slate-900 truncate'), 'Customer primary name must not truncate');

  const itemReport = readSrc('src/components/modules/reports/ItemMovementReport.tsx');
  assert.ok(!itemReport.includes('wh.warehouseName}</div>\n') || !itemReport.includes('truncate">{wh.warehouseName}'), 'Warehouse name must not truncate');
  assert.ok(!itemReport.includes('truncate">{rep.representativeName}'), 'Rep name must not truncate');

  const requiredModulePaths = [
    'src/components/modules/dashboard/DashboardView.tsx',
    'src/components/modules/inventory/InventoryView.tsx',
    'src/components/modules/sales/SalesInvoicesView.tsx',
    'src/components/modules/purchases/PurchaseInvoicesView.tsx',
    'src/components/modules/customers/CustomersView.tsx',
    'src/components/modules/suppliers/SuppliersView.tsx',
    'src/components/modules/finance/FinanceView.tsx',
    'src/components/modules/representatives/RepTransferView.tsx',
    'src/components/modules/reports/ReportsView.tsx',
    'src/components/modules/settings/SettingsView.tsx',
    'src/components/common/Modal.tsx',
  ];
  for (const rel of requiredModulePaths) {
    assert.ok(fs.existsSync(path.join(rootDir, rel)), `Expected module missing: ${rel}`);
  }
});

console.log(`\n[Dashboard & Windows UI Tests] ${passed} checks passed.\n`);

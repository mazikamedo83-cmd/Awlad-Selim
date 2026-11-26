import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const readFile = (relPath) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

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

console.log('\n=== Platform Separation (Windows Sidebar Only / Restored Web & Mobile) & Send/Receive Label Verification ===');

test('1. Preload & native bridge expose strict Electron Windows platform detection independent of viewport width', () => {
  const preload = readFile('electron/preload.cjs');
  const dts = readFile('src/types/global.d.ts');
  const native = readFile('src/services/native.ts');

  assert.ok(preload.includes('platform: process.platform'), 'electron/preload.cjs must expose process.platform');
  assert.ok(dts.includes('platform?: string;'), 'global.d.ts must declare platform on AwladDesktopBridge');
  assert.ok(native.includes('export function isWindowsDesktopApp()'), 'native.ts must export isWindowsDesktopApp');
  assert.ok(native.includes('export function getAppPlatform()'), 'native.ts must export getAppPlatform');
  assert.ok(!native.includes('innerWidth'), 'Platform detection must never depend on window.innerWidth');
});

test('2. App.tsx & Header.tsx render Sidebar on Desktop/Web, remove horizontal sections from Header, and keep exact 7 shortcuts', () => {
  const app = readFile('src/App.tsx');
  const header = readFile('src/components/layout/Header.tsx');

  assert.ok(app.includes('const isWindowsDesktop = isWindowsDesktopApp();'));
  assert.ok(app.includes('setIsSectionsOpen(true)'), 'Sidebar auto-open must run on staff login');
  assert.ok(app.includes('<Sidebar'), 'App must render <Sidebar> in desktop shell');
  assert.ok(app.includes('{!isWindowsDesktop && (isMobileApp || isMobileViewport)'), 'Mobile app shell must stay scoped to mobile');

  assert.ok(header.includes('{!isSidebarOpen && (') && header.includes('data-testid="sidebar-toggle-btn"'), 'Header reopen sidebar button must appear when sidebar is closed');
  assert.ok(!header.includes('webHorizontalSections'), 'Header must not contain horizontal sections menu');
  assert.ok(!header.includes('web-horizontal-sections-nav'), 'Header must not render web-horizontal-sections-nav');

  const expectedShortcutKeys = [
    "'home'",
    "'add-customer'",
    "'add-product'",
    "'new-sale'",
    "'new-purchase'",
    "'stock-transfer'",
    "'add-expense'",
  ];
  for (const key of expectedShortcutKeys) {
    assert.ok(header.includes(`key: ${key}`), `Header missing required quick shortcut ${key}`);
  }
});

test('3. Android/iOS Mobile shells (StaffMobileShell & MobilePortal) have zero vertical Sidebar leakage and keep original layouts', () => {
  const staffShell = readFile('src/components/modules/mobile/StaffMobileShell.tsx');
  const mobilePortal = readFile('src/components/modules/mobile/MobilePortal.tsx');

  assert.ok(!staffShell.includes('<Sidebar'), 'StaffMobileShell must not render <Sidebar>');
  assert.ok(!staffShell.includes('isMobileSidebarOpen'), 'StaffMobileShell must not retain mobile sidebar state');
  assert.ok(!staffShell.includes('mobile-sidebar-toggle-btn'), 'StaffMobileShell must not render sidebar toggle button');
  assert.ok(staffShell.includes('mobileGridTiles') && staffShell.includes('bottomNavTabs'), 'StaffMobileShell must preserve 3-col tiles and 5-tab bar');

  assert.ok(!mobilePortal.includes('portal-sections-sidebar'), 'MobilePortal must not render vertical portal sidebar');
  assert.ok(!mobilePortal.includes('isDrawerOpen'), 'MobilePortal must not retain drawer state');
  assert.ok(!mobilePortal.includes('sidebar-toggle-btn'), 'MobilePortal must not render sidebar toggle button');
  assert.ok(mobilePortal.includes('bottomNavItems'), 'MobilePortal must preserve 5-tab mobile bottom nav');
});

test('4. Sidebar preserves all 10 system module sections, auto-expands on open, and closes cleanly with (X)', () => {
  const sidebar = readFile('src/components/layout/Sidebar.tsx');
  const expectedSectionIds = [
    "'sales'",
    "'purchases'",
    "'inventory'",
    "'finance'",
    "'cheques-inst'",
    "'representatives'",
    "'employees'",
    "'reports'",
    "'management'",
    "'settings'",
  ];
  for (const id of expectedSectionIds) {
    assert.ok(sidebar.includes(id), `Sidebar missing section ${id}`);
  }
  assert.ok(sidebar.includes('data-testid="sidebar-close-btn"'), 'Sidebar must include explicit close (X) button');
  assert.ok(sidebar.includes('setOpenSectionIds(ALL_OPEN_SECTIONS)'), 'Sidebar must expand all sections when reopened');
  assert.ok(sidebar.includes('if (!mobileDrawer && !isOpen) {\n    return null;\n  }'), 'Closing sidebar must unmount aside so main expands seamlessly');
});

test('5. Send and Receive buttons/labels across ALL platforms show only إرسال and استلام without السيرفر', () => {
  const refresh = readFile('src/components/modules/mobile/RefreshSyncScreen.tsx');
  const syncCenter = readFile('src/components/common/SyncCenterModal.tsx');
  const offlineInd = readFile('src/components/layout/OfflineIndicator.tsx');
  const staffShell = readFile('src/components/modules/mobile/StaffMobileShell.tsx');
  const repPortal = readFile('src/components/modules/mobile/RepPortal.tsx');
  const dataCtx = readFile('src/context/DataContext.tsx');
  const syncEng = readFile('src/services/syncEngine.ts');

  for (const [name, content] of [
    ['RefreshSyncScreen.tsx', refresh],
    ['SyncCenterModal.tsx', syncCenter],
    ['OfflineIndicator.tsx', offlineInd],
    ['StaffMobileShell.tsx', staffShell],
    ['RepPortal.tsx', repPortal],
    ['DataContext.tsx', dataCtx],
    ['syncEngine.ts', syncEng],
  ]) {
    assert.ok(!content.includes('إرسال إلى السيرفر'), `${name} still contains 'إرسال إلى السيرفر'`);
    assert.ok(!content.includes('الإرسال إلى السيرفر'), `${name} still contains 'الإرسال إلى السيرفر'`);
    assert.ok(!content.includes('استلام من السيرفر'), `${name} still contains 'استلام من السيرفر'`);
  }

  assert.ok(!syncCenter.includes('بانتظار السيرفر'), 'SyncCenterModal still says بانتظار السيرفر');
  assert.ok(!syncCenter.includes('نسخة السيرفر'), 'SyncCenterModal still says نسخة السيرفر');
  assert.ok(refresh.includes("? `إرسال (${kpiStats.readyToSend})`\n                : 'إرسال'"), 'RefreshSyncScreen send button must say إرسال');
  assert.ok(refresh.includes("? `استلام (${kpiStats.awaitingReceiveTotal})`\n                : 'استلام'"), 'RefreshSyncScreen receive button must say استلام');
  assert.ok(staffShell.includes("label: 'إرسال واستلام'"), 'StaffMobileShell tile must say إرسال واستلام');
});

console.log(`\n[Platform UI Correction Tests] ${passed} checks passed.\n`);

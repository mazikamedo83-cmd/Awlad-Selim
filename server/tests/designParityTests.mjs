import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();

console.log('=== Cross-Platform Design System & Build Parity Tests ===');

// 1. Single unified staff shell in src/App.tsx (no separate mobile staff shell)
const appTsx = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
assert.ok(!appTsx.includes('StaffMobileShell'), 'App.tsx must not reference legacy StaffMobileShell');
assert.ok(!appTsx.includes('useMobileStaffShell'), 'App.tsx must not branch staff UI by platform/viewport');
assert.ok(appTsx.includes('<Sidebar') && appTsx.includes('<Header'), 'App.tsx must render unified Sidebar + Header');
assert.ok(!fs.existsSync(path.join(root, 'src/components/modules/mobile/StaffMobileShell.tsx')), 'Legacy StaffMobileShell.tsx must be deleted');
console.log('  [PASS] 1. Single unified staff shell enforced across Web, Windows, Android, and iOS');

// 2. Central design system, bundled Cairo fonts, and offline HTML entry
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.ok(!indexHtml.includes('fonts.googleapis.com'), 'index.html must not depend on external Google Fonts CDN');
assert.ok(indexHtml.includes('viewport-fit=cover'), 'index.html must include viewport-fit=cover for notches/safe areas');
assert.ok(indexHtml.includes('dir="rtl"'), 'index.html must enforce dir="rtl"');
assert.ok(indexHtml.includes('<meta name="color-scheme" content="light"'), 'index.html must lock light color-scheme');

const mainTsx = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
for (const weight of ['300', '400', '500', '600', '700', '800', '900']) {
  assert.ok(mainTsx.includes(`@fontsource/cairo/${weight}.css`), `main.tsx must bundle Cairo weight ${weight}`);
}

const indexCss = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
assert.ok(indexCss.includes('./styles/design-system.css'), 'src/index.css must import central design-system.css');
assert.ok(indexCss.includes('--font-sans') && indexCss.includes("'Cairo'"), 'src/index.css must bind Tailwind --font-sans to Cairo');
assert.ok(indexCss.includes('-webkit-text-size-adjust: 100%'), 'src/index.css must lock text-size-adjust for WebViews');
console.log('  [PASS] 2. Central Design System & self-hosted Cairo typography configured cleanly');

// 3. Verify built dist/ bundles Cairo .woff2 fonts offline + CSS + logo
const distDir = path.join(root, 'dist');
const distAssetsDir = path.join(distDir, 'assets');
assert.ok(fs.existsSync(path.join(distDir, 'index.html')), 'dist/index.html must exist after npm run build');
assert.ok(fs.existsSync(path.join(distDir, 'awlad-selim-logo.png')), 'dist/awlad-selim-logo.png must exist');
const assetFiles = fs.readdirSync(distAssetsDir);
const cairoWoff2Files = assetFiles.filter((f) => f.includes('cairo-arabic') && f.endsWith('.woff2'));
const cssFiles = assetFiles.filter((f) => f.endsWith('.css'));
assert.ok(cairoWoff2Files.length >= 6, `Expected >= 6 bundled Cairo Arabic .woff2 weights in dist/assets, found ${cairoWoff2Files.length}`);
assert.ok(cssFiles.length >= 1, 'Expected compiled CSS bundle in dist/assets');
console.log(`  [PASS] 3. Verified offline font & CSS bundle (${cairoWoff2Files.length} Cairo Arabic woff2 files in dist/assets)`);

// 4. Verify Android & iOS Capacitor public directories match built dist/
const distHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const androidPublicDir = path.join(root, 'android/app/src/main/assets/public');
const iosPublicDir = path.join(root, 'ios/App/App/public');
for (const [label, targetDir] of [
  ['Android', androidPublicDir],
  ['iOS', iosPublicDir],
]) {
  const nativeHtmlPath = path.join(targetDir, 'index.html');
  assert.ok(fs.existsSync(nativeHtmlPath), `${label} synced index.html must exist`);
  assert.equal(fs.readFileSync(nativeHtmlPath, 'utf8'), distHtml, `${label} index.html must match dist/index.html`);
  const nativeAssets = fs.readdirSync(path.join(targetDir, 'assets'));
  for (const fontFile of cairoWoff2Files) {
    assert.ok(nativeAssets.includes(fontFile), `${label} bundle must include ${fontFile}`);
  }
}
console.log('  [PASS] 4. Android & iOS native public bundles match dist/ cleanly');

// 5. Verify Electron, Android, and iOS native rendering normalizations
const electronMain = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
assert.ok(electronMain.includes('setZoomFactor(1.0)'), 'electron/main.cjs must lock zoom factor at 1.0');
assert.ok(electronMain.includes("backgroundColor: '#f8fafc'"), 'electron/main.cjs must configure light surface backgroundColor');

const mainActivity = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/awladselim/erp/MainActivity.java'), 'utf8');
assert.ok(mainActivity.includes('setTextZoom(100)'), 'MainActivity.java must lock WebView textZoom at 100%');
assert.ok(mainActivity.includes('setAlgorithmicDarkeningAllowed(false)'), 'MainActivity.java must disable algorithmic WebView darkening');

const androidStyles = fs.readFileSync(path.join(root, 'android/app/src/main/res/values/styles.xml'), 'utf8');
assert.ok(androidStyles.includes('Theme.AppCompat.Light.NoActionBar'), 'Android styles.xml must use Light.NoActionBar');

const iosPlist = fs.readFileSync(path.join(root, 'ios/App/App/Info.plist'), 'utf8');
assert.ok(iosPlist.includes('<key>UIUserInterfaceStyle</key>') && iosPlist.includes('<string>Light</string>'), 'iOS Info.plist must lock Light UIUserInterfaceStyle');

const designSystemCss = fs.readFileSync(path.join(root, 'src/styles/design-system.css'), 'utf8');
assert.ok(
  designSystemCss.includes('--safe-area-inset-top') && designSystemCss.includes('env(safe-area-inset-top'),
  'design-system.css must support both env() and Capacitor SystemBars --safe-area-inset-* variables'
);
assert.ok(designSystemCss.includes('.awlad-table-scroll'), 'design-system.css must define .awlad-table-scroll');

const capConfigTs = fs.readFileSync(path.join(root, 'capacitor.config.ts'), 'utf8');
assert.ok(capConfigTs.includes('SystemBars') && capConfigTs.includes("insetsHandling: 'css'"), 'capacitor.config.ts must configure SystemBars css insetsHandling');
for (const [label, capJsonPath] of [
  ['Android', path.join(root, 'android/app/src/main/assets/capacitor.config.json')],
  ['iOS', path.join(root, 'ios/App/App/capacitor.config.json')],
]) {
  const capJson = JSON.parse(fs.readFileSync(capJsonPath, 'utf8'));
  assert.equal(capJson?.plugins?.SystemBars?.insetsHandling, 'css', `${label} capacitor.config.json must include synced SystemBars settings`);
}

const nativeSvc = fs.readFileSync(path.join(root, 'src/services/native.ts'), 'utf8');
assert.ok(nativeSvc.includes('syncNativeStatusBarStyle'), 'native.ts must expose syncNativeStatusBarStyle');
assert.ok(appTsx.includes('syncNativeStatusBarStyle'), 'App.tsx must sync native status bar icon contrast with current header');
console.log('  [PASS] 5. Electron, Android WebView, iOS WKWebView, Safe Areas, and SystemBars normalization verified');

// 6. Verify all UI tables are horizontally scrollable on small screens & zero hardcoded font overrides exist
function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const srcFiles = walkFiles(path.join(root, 'src'));
for (const file of srcFiles) {
  const rel = path.relative(root, file);
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(!/font-\['/.test(content), `Hardcoded font class found in ${rel}; use centralized font tokens`);
  assert.ok(!content.includes('fonts.googleapis.com'), `External Google Font reference found in ${rel}`);
  if (rel.startsWith('src/components/') && !rel.includes('PrintDocument') && !rel.includes('PdfExporter')) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('<table')) {
        const ctx = lines.slice(Math.max(0, i - 5), i + 2).join(' ');
        assert.ok(
          ctx.includes('overflow-x-auto') || ctx.includes('awlad-table-scroll') || ctx.includes('print:'),
          `UI table without mobile horizontal scroll wrapper at ${rel}:${i + 1}`
        );
      }
    }
  }
}
console.log('  [PASS] 6. All UI tables have mobile horizontal scroll wrappers & zero hardcoded font overrides');

// 7. Verify standalone server serves offline font & CSS assets via HTTP
const sandboxDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_design_srv_'));
try {
  process.env.AWLAD_DATA_DIR = sandboxDataDir;
  process.env.AWLAD_ELECTRON = 'true';
  const { startStandaloneServer } = await import('../../server/index.js');
  const srv = await startStandaloneServer({ port: 0, host: '127.0.0.1', distDir });
  try {
    const htmlRes = await fetch(`${srv.localUrl}/`);
    assert.equal(htmlRes.status, 200);
    const fontRes = await fetch(`${srv.localUrl}/assets/${cairoWoff2Files[0]}`);
    assert.equal(fontRes.status, 200);
    const cssRes = await fetch(`${srv.localUrl}/assets/${cssFiles[0]}`);
    assert.equal(cssRes.status, 200);
    console.log('  [PASS] 7. Standalone server serves bundled index.html, CSS, and Cairo .woff2 font offline');
  } finally {
    await srv.close();
  }
} finally {
  fs.rmSync(sandboxDataDir, { recursive: true, force: true });
}

console.log('DESIGN SYSTEM & CROSS-PLATFORM PARITY TESTS PASSED (7/7)');

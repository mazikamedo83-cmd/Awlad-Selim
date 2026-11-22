const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, session, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { prepareElectronDataDirectory } = require('./dataBootstrap.cjs');

let mainWindow = null;
let serverInstance = null;
let desktopState = {
  isElectron: true,
  platform: process.platform,
  dataDir: '',
  backupsDir: '',
  offlineClientDir: '',
  distDir: '',
  uiEntry: '',
  envFilePath: null,
  port: 3000,
  lanUrls: [],
  databaseState: null,
};
let isShuttingDown = false;

// Ensure single instance on Windows so port 3000 & data directory never collide
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function getAppRoot() {
  return app.getAppPath();
}

function getLegacySourceCandidates(appRoot) {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'server', 'data'));
  }
  candidates.push(path.join(path.dirname(process.execPath), 'server', 'data'));
  candidates.push(path.join(appRoot, 'server', 'data'));
  return candidates;
}

function getEnvFileCandidates(appRoot) {
  const candidates = [];
  if (process.env.AWLAD_ENV_FILE) {
    candidates.push(process.env.AWLAD_ENV_FILE);
  }
  candidates.push(path.join(path.dirname(process.execPath), '.env'));
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, '.env'));
  }
  candidates.push(path.join(appRoot, '.env'));
  return candidates;
}

function showLanDialog() {
  const urls = (desktopState.lanUrls || []).map((u) => u.url);
  const urlListText = urls.length > 0
    ? urls.join('\n')
    : `http://127.0.0.1:${desktopState.port}`;

  const detail = [
    `يعمل خادم أولاد سليم حاليًا على المنفذ: ${desktopState.port}`,
    '',
    'عناوين الاتصال على الشبكة المحلية (للمندوبين وتطبيق العملاء):',
    urlListText,
    '',
    `مجلد البيانات النشط:\n${desktopState.dataDir}`,
  ].join('\n');

  const buttons = urls.length > 0 ? ['نسخ أول عنوان LAN', 'إغلاق'] : ['إغلاق'];
  dialog.showMessageBox(mainWindow || undefined, {
    type: 'info',
    title: 'اتصال الشبكة المحلية - AWLAD SELIM',
    message: 'بيانات خادم أولاد سليم على الشبكة المحلية (LAN)',
    detail,
    buttons,
    defaultId: 0,
  }).then((res) => {
    if (urls.length > 0 && res.response === 0) {
      clipboard.writeText(urls[0]);
    }
  }).catch(() => {});
}

function buildApplicationMenu() {
  const template = [
    {
      label: 'ملف',
      submenu: [
        {
          label: 'فتح مجلد البيانات (%APPDATA%\\AWLAD SELIM\\data)',
          click: () => {
            if (desktopState.dataDir) shell.openPath(desktopState.dataDir);
          },
        },
        {
          label: 'فتح مجلد النسخ الاحتياطية',
          click: () => {
            if (desktopState.backupsDir) shell.openPath(desktopState.backupsDir);
          },
        },
        { type: 'separator' },
        {
          label: 'طباعة الصفحة الحالية',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.print();
            }
          },
        },
        { type: 'separator' },
        {
          label: 'خروج آمن وإغلاق الخادم',
          accelerator: 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'عرض',
      submenu: [
        { label: 'إعادة تحميل', role: 'reload' },
        { label: 'إعادة تحميل قسري (مسح الكاش)', role: 'forceReload' },
        { label: 'تكبير', role: 'zoomIn' },
        { label: 'تصغير', role: 'zoomOut' },
        { label: 'الحجم الافتراضي', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'ملء الشاشة', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'الشبكة والبيانات',
      submenu: [
        {
          label: 'عناوين الشبكة المحلية (للمندوبين والعملاء)',
          click: () => showLanDialog(),
        },
        {
          label: 'معلومات نسخة البرنامج',
          click: () => {
            dialog.showMessageBox(mainWindow || undefined, {
              type: 'info',
              title: 'AWLAD SELIM Desktop',
              message: `AWLAD SELIM للمحاسبة وإدارة الأعمال (${app.getVersion()})`,
              detail: [
                `مجلد البيانات: ${desktopState.dataDir}`,
                `مجلد النسخ الاحتياطية: ${desktopState.backupsDir}`,
                `منفذ الخادم: ${desktopState.port}`,
              ].join('\n'),
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function ensureOfflineClientKey() {
  if (!desktopState.offlineClientDir) return null;
  fs.mkdirSync(desktopState.offlineClientDir, { recursive: true });
  const encKeyPath = path.join(desktopState.offlineClientDir, '.vault.key.enc');
  const legacyKeyPath = path.join(desktopState.offlineClientDir, '.vault.key');
  const canUseSafeStorage = Boolean(
    safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable()
  );

  if (canUseSafeStorage && fs.existsSync(encKeyPath)) {
    try {
      const encBuf = fs.readFileSync(encKeyPath);
      const hex = safeStorage.decryptString(encBuf);
      const key = Buffer.from(hex, 'hex');
      if (key.length === 32) return key;
    } catch {
      // fall through to legacy migration or regeneration
    }
  }

  if (fs.existsSync(legacyKeyPath)) {
    try {
      const raw = fs.readFileSync(legacyKeyPath);
      if (raw.length === 32) {
        if (canUseSafeStorage) {
          try {
            const encrypted = safeStorage.encryptString(raw.toString('hex'));
            fs.writeFileSync(encKeyPath, encrypted, { mode: 0o600 });
            fs.unlinkSync(legacyKeyPath);
          } catch {
            // keep legacy file if OS keychain migration fails temporarily
          }
        }
        return raw;
      }
    } catch {
      // ignore read failure
    }
  }

  const key = nodeCrypto.randomBytes(32);
  if (canUseSafeStorage) {
    try {
      const encrypted = safeStorage.encryptString(key.toString('hex'));
      fs.writeFileSync(encKeyPath, encrypted, { mode: 0o600 });
      return key;
    } catch {
      // fall back below if OS encryption throws
    }
  }
  fs.writeFileSync(legacyKeyPath, key, { mode: 0o600 });
  return key;
}

function sanitizeKeySegment(val) {
  return String(val || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default';
}

function writeEncryptedOfflineFile(filePath, plainBuffer) {
  const key = ensureOfflineClientKey();
  if (!key) throw new Error('Offline client directory not initialized');
  const iv = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([Buffer.from('AWL1', 'ascii'), iv, tag, encrypted]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, payload);
  fs.renameSync(tmpPath, filePath);
}

function readEncryptedOfflineFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const key = ensureOfflineClientKey();
  if (!key) return null;
  const raw = fs.readFileSync(filePath);
  if (raw.length < 32 || raw.subarray(0, 4).toString('ascii') !== 'AWL1') return null;
  const iv = raw.subarray(4, 16);
  const tag = raw.subarray(16, 32);
  const data = raw.subarray(32);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function registerIpcHandlers() {
  ipcMain.handle('awlad:get-desktop-info', () => ({
    ...desktopState,
    appVersion: app.getVersion(),
  }));

  ipcMain.handle('awlad:open-data-folder', async () => {
    if (!desktopState.dataDir) return { ok: false };
    const err = await shell.openPath(desktopState.dataDir);
    return { ok: !err, error: err || null };
  });

  ipcMain.handle('awlad:open-backups-folder', async () => {
    if (!desktopState.backupsDir) return { ok: false };
    const err = await shell.openPath(desktopState.backupsDir);
    return { ok: !err, error: err || null };
  });

  ipcMain.handle('awlad:copy-text', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  ipcMain.handle('awlad:offline-kv-get', (_event, namespace, key) => {
    try {
      if (!desktopState.offlineClientDir) return { ok: false, value: null };
      const filePath = path.join(
        desktopState.offlineClientDir,
        sanitizeKeySegment(namespace),
        `${sanitizeKeySegment(key)}.enc`
      );
      const buf = readEncryptedOfflineFile(filePath);
      if (!buf) return { ok: true, value: null };
      return { ok: true, value: JSON.parse(buf.toString('utf8')) };
    } catch (err) {
      return { ok: false, value: null, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('awlad:offline-kv-set', (_event, namespace, key, value) => {
    try {
      if (!desktopState.offlineClientDir) return { ok: false };
      const filePath = path.join(
        desktopState.offlineClientDir,
        sanitizeKeySegment(namespace),
        `${sanitizeKeySegment(key)}.enc`
      );
      writeEncryptedOfflineFile(filePath, Buffer.from(JSON.stringify(value), 'utf8'));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('awlad:offline-kv-delete', (_event, namespace, key) => {
    try {
      if (!desktopState.offlineClientDir) return { ok: false };
      const filePath = path.join(
        desktopState.offlineClientDir,
        sanitizeKeySegment(namespace),
        `${sanitizeKeySegment(key)}.enc`
      );
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('awlad:offline-media-write', (_event, mediaKey, dataUrl) => {
    try {
      if (!desktopState.offlineClientDir) return { ok: false };
      const filePath = path.join(
        desktopState.offlineClientDir,
        'media',
        `${sanitizeKeySegment(mediaKey)}.enc`
      );
      writeEncryptedOfflineFile(filePath, Buffer.from(String(dataUrl || ''), 'utf8'));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('awlad:offline-media-read', (_event, mediaKey) => {
    try {
      if (!desktopState.offlineClientDir) return { ok: false, dataUrl: null };
      const filePath = path.join(
        desktopState.offlineClientDir,
        'media',
        `${sanitizeKeySegment(mediaKey)}.enc`
      );
      const buf = readEncryptedOfflineFile(filePath);
      return { ok: true, dataUrl: buf ? buf.toString('utf8') : null };
    } catch (err) {
      return { ok: false, dataUrl: null, error: err?.message || String(err) };
    }
  });
}

async function createMainWindow(startUrl, appRoot, options = {}) {
  const iconPng = path.join(appRoot, 'build', 'icon.png');
  const iconIco = path.join(appRoot, 'build', 'icon.ico');
  const chosenIcon = process.platform === 'win32' && fs.existsSync(iconIco) ? iconIco : iconPng;

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f8fafc',
    title: 'AWLAD SELIM - أولاد سليم للمحاسبة وإدارة الأعمال',
    icon: fs.existsSync(chosenIcon) ? chosenIcon : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(1.0);
      mainWindow.webContents.setVisualZoomLevelLimits(1, 3).catch(() => {});
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.maximize();
      mainWindow.show();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(startUrl) || url.startsWith('about:blank')) {
      return { action: 'allow' };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  try {
    await session.defaultSession.clearCache();
    const storagesToClear = ['serviceworkers', 'cachestorage'];
    if (options.isFreshDatabase) {
      storagesToClear.push('localstorage', 'indexdb', 'cookies');
    }
    await session.defaultSession.clearStorageData({
      origin: startUrl,
      storages: storagesToClear,
    });
  } catch (err) {
    console.warn('[Electron Cache Clear Warning]:', err?.message || err);
  }

  await mainWindow.loadURL(startUrl, {
    extraHeaders: 'pragma: no-cache\nCache-Control: no-cache, no-store, must-revalidate\n',
  });
}

async function shutdownGracefully() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (serverInstance && typeof serverInstance.close === 'function') {
    try {
      await serverInstance.close();
    } catch (err) {
      console.error('[Electron Server Shutdown Error]:', err);
    }
  }
}

async function bootstrapApplication() {
  const appRoot = getAppRoot();
  const appDataBase = process.env.AWLAD_APP_DATA_ROOT || app.getPath('appData');
  const allowLegacyImport = !app.isPackaged || process.env.AWLAD_ALLOW_LEGACY_IMPORT === 'true';

  let prepResult;
  try {
    prepResult = prepareElectronDataDirectory({
      appDataDir: appDataBase,
      legacySourceDirs: allowLegacyImport ? getLegacySourceCandidates(appRoot) : [],
      envFileCandidates: allowLegacyImport ? getEnvFileCandidates(appRoot) : [],
    });
  } catch (err) {
    dialog.showErrorBox(
      'فشل التحقق من سلامة قاعدة البيانات - AWLAD SELIM',
      `تم إيقاف التشغيل لحماية بياناتك ومنع استبدالها بقاعدة بيانات فارغة.\n\nالتفاصيل:\n${err.message}`
    );
    app.exit(1);
    return;
  }

  // Always point embedded server at verified %APPDATA%\AWLAD SELIM\data before loading server modules
  process.env.AWLAD_ELECTRON = 'true';
  process.env.AWLAD_IS_PACKAGED = app.isPackaged ? 'true' : 'false';
  process.env.AWLAD_DATA_DIR = prepResult.targetDataDir;
  if (prepResult.envFilePath && allowLegacyImport) {
    process.env.AWLAD_ENV_FILE = prepResult.envFilePath;
  }

  const offlineClientDir = path.join(path.dirname(prepResult.targetDataDir), 'offline_client');
  const isFreshDatabase =
    !prepResult.databaseState?.exists ||
    Number(prepResult.databaseState?.counts?.users || 0) === 0;

  // On a clean database with zero users, purge any leftover client auth/session vault from prior installs
  if (isFreshDatabase) {
    for (const staleFolder of ['offline_auth_session', 'offline_auth_creds', 'account_vault']) {
      try {
        fs.rmSync(path.join(offlineClientDir, staleFolder), { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
  }

  desktopState.dataDir = prepResult.targetDataDir;
  desktopState.backupsDir = prepResult.backupsDir;
  desktopState.offlineClientDir = offlineClientDir;
  desktopState.envFilePath = allowLegacyImport ? prepResult.envFilePath : null;
  desktopState.databaseState = prepResult.databaseState;

  const devStartUrl = !app.isPackaged ? (process.env.ELECTRON_START_URL || '').trim() : '';
  let startUrl = devStartUrl;

  if (!devStartUrl) {
    const distDir = path.join(appRoot, 'dist');
    const distIndexPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(distIndexPath)) {
      dialog.showErrorBox(
        'ملفات الواجهة مفقودة - AWLAD SELIM',
        `تعذر العثور على ملف الواجهة المحدث:\n${distIndexPath}\n\nيرجى إعادة تثبيت أو إعادة بناء نسخة Windows.`
      );
      app.exit(1);
      return;
    }

    desktopState.distDir = distDir;
    desktopState.uiEntry = distIndexPath;

    const serverEntryUrl = pathToFileURL(path.join(appRoot, 'server', 'index.js')).href;
    const { startStandaloneServer } = await import(serverEntryUrl);

    try {
      serverInstance = await startStandaloneServer({
        host: '0.0.0.0',
        port: Number(process.env.PORT || process.env.API_PORT || 3000),
        distDir,
        envFiles: allowLegacyImport && prepResult.envFilePath ? [prepResult.envFilePath] : [],
        allowPortFallback: process.env.AWLAD_ALLOW_PORT_FALLBACK === 'true',
      });
    } catch (err) {
      dialog.showErrorBox(
        'تعذر تشغيل خادم AWLAD SELIM المحلي',
        `حدث خطأ أثناء تشغيل الخادم الداخلي على المنفذ ${process.env.PORT || 3000}.\n\n${err.message}\n\nإذا كان هناك خادم قديم أو آخر يعمل على نفس المنفذ، أغلقه ثم أعد فتح البرنامج.`
      );
      app.exit(1);
      return;
    }

    desktopState.port = serverInstance.port;
    desktopState.lanUrls = serverInstance.lanUrls || [];
    startUrl = serverInstance.localUrl;
  }

  registerIpcHandlers();
  buildApplicationMenu();
  await createMainWindow(startUrl, appRoot, { isFreshDatabase });
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    bootstrapApplication().catch((err) => {
      console.error('[Electron Fatal Bootstrap Error]:', err);
      dialog.showErrorBox('خطأ غير متوقع عند تشغيل AWLAD SELIM', err?.stack || err?.message || String(err));
      app.exit(1);
    });
  });

  app.on('before-quit', (event) => {
    if (!isShuttingDown) {
      event.preventDefault();
      shutdownGracefully().finally(() => {
        app.exit(0);
      });
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

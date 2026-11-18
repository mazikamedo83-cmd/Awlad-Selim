const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const {
  prepareElectronDataDirectory,
  acquireDatabaseLock,
  releaseDatabaseLock,
  readTunnelAutoStartConfig,
  writeTunnelAutoStartConfig,
} = require('./dataBootstrap.cjs');
const { createTunnelSupervisor } = require('./tunnelSupervisor.cjs');

let mainWindow = null;
let serverInstance = null;
let dbLockPath = null;
const tunnelSupervisor = createTunnelSupervisor({
  getPort: () => desktopState.port || 3000,
});
let desktopState = {
  isElectron: true,
  platform: process.platform,
  dataDir: '',
  backupsDir: '',
  envFilePath: null,
  port: 3000,
  lanUrls: [],
  serverStatus: 'online',
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

  ipcMain.handle('awlad:get-auto-start', () => {
    const supported = process.platform === 'win32' || process.platform === 'darwin';
    if (!supported) return { ok: true, openAtLogin: false, supported: false };
    try {
      const settings = app.getLoginItemSettings();
      return { ok: true, openAtLogin: Boolean(settings.openAtLogin), supported: true };
    } catch {
      return { ok: false, openAtLogin: false, supported };
    }
  });

  ipcMain.handle('awlad:set-auto-start', (_event, enabled) => {
    const supported = process.platform === 'win32' || process.platform === 'darwin';
    if (!supported) {
      return { ok: false, openAtLogin: false, supported: false, error: 'التشغيل التلقائي مدعوم على Windows و macOS فقط.' };
    }
    try {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        args: ['--minimized'],
      });
      const settings = app.getLoginItemSettings();
      return { ok: true, openAtLogin: Boolean(settings.openAtLogin), supported: true };
    } catch (err) {
      return { ok: false, openAtLogin: false, supported: true, error: err?.message || 'تعذر حفظ إعداد التشغيل التلقائي' };
    }
  });

  ipcMain.handle('awlad:get-tunnel-status', () => ({
    ok: true,
    status: tunnelSupervisor.getStatus(),
  }));

  ipcMain.handle('awlad:start-tunnel', (_event, opts) => tunnelSupervisor.start(opts || {}));

  ipcMain.handle('awlad:stop-tunnel', () => tunnelSupervisor.stop());

  ipcMain.handle('awlad:get-tunnel-auto-start', () => {
    const cfg = readTunnelAutoStartConfig(desktopState.dataDir);
    return {
      ok: true,
      config: {
        enabled: cfg.enabled,
        mode: cfg.mode,
        domainUrl: cfg.domainUrl,
        hasToken: Boolean(cfg.token),
      },
    };
  });

  ipcMain.handle('awlad:set-tunnel-auto-start', (_event, opts = {}) => {
    try {
      const saved = writeTunnelAutoStartConfig(desktopState.dataDir, opts || {});
      return {
        ok: true,
        config: {
          enabled: saved.enabled,
          mode: saved.mode,
          domainUrl: saved.domainUrl,
          hasToken: Boolean(saved.token),
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || 'تعذر حفظ إعداد التشغيل التلقائي للنفق',
        config: { enabled: false, mode: 'free_remote', domainUrl: '', hasToken: false },
      };
    }
  });

  // Encrypted local offline vault (AES-256-GCM) inside active desktop dataDir
  const getVaultDir = () => {
    const baseDir = desktopState.dataDir || app.getPath('userData');
    const dir = path.join(baseDir, 'offline-vault');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  const getVaultKey = () => {
    const dir = getVaultDir();
    const keyFile = path.join(dir, '.vault.key');
    if (fs.existsSync(keyFile)) {
      const buf = fs.readFileSync(keyFile);
      if (buf.length === 32) return buf;
    }
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
    return key;
  };

  const vaultFilePath = (store, key) => {
    const safeStore = String(store || 'meta').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeKey = crypto.createHash('sha256').update(String(key || 'item')).digest('hex').slice(0, 32);
    const subDir = path.join(getVaultDir(), safeStore);
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
    return path.join(subDir, `${safeKey}.enc`);
  };

  ipcMain.handle('awlad:offline-get', (_event, store, key) => {
    try {
      const file = vaultFilePath(store, key);
      if (!fs.existsSync(file)) return { ok: true, value: null };
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const vaultKey = getVaultKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, Buffer.from(raw.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(raw.tag, 'hex'));
      const plain = Buffer.concat([decipher.update(Buffer.from(raw.ct, 'base64')), decipher.final()]).toString('utf8');
      return { ok: true, value: JSON.parse(plain) };
    } catch {
      return { ok: false, value: null };
    }
  });

  ipcMain.handle('awlad:offline-set', (_event, store, key, value) => {
    try {
      const file = vaultFilePath(store, key);
      const vaultKey = getVaultKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
      const ct = Buffer.concat([cipher.update(JSON.stringify(value ?? null), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      fs.writeFileSync(
        file,
        JSON.stringify({ v: 1, iv: iv.toString('hex'), tag: tag.toString('hex'), ct: ct.toString('base64') }),
        'utf8'
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || 'Vault write failed' };
    }
  });

  ipcMain.handle('awlad:offline-remove', (_event, store, key) => {
    try {
      const file = vaultFilePath(store, key);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('awlad:offline-read-media', (_event, mediaKey) => {
    try {
      const safeName = String(mediaKey || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
      const mediaFile = path.join(getVaultDir(), 'media', `${safeName}.txt`);
      if (!fs.existsSync(mediaFile)) return { ok: true, dataUrl: null };
      return { ok: true, dataUrl: fs.readFileSync(mediaFile, 'utf8') };
    } catch {
      return { ok: false, dataUrl: null };
    }
  });

  ipcMain.handle('awlad:offline-write-media', (_event, mediaKey, dataUrl) => {
    try {
      const safeName = String(mediaKey || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
      const mediaDir = path.join(getVaultDir(), 'media');
      if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
      fs.writeFileSync(path.join(mediaDir, `${safeName}.txt`), String(dataUrl || ''), 'utf8');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

async function createMainWindow(startUrl, appRoot) {
  const iconPng = path.join(appRoot, 'build', 'icon.png');
  const iconIco = path.join(appRoot, 'build', 'icon.ico');
  const chosenIcon = process.platform === 'win32' && fs.existsSync(iconIco) ? iconIco : iconPng;

  nativeTheme.themeSource = 'light';

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
      zoomFactor: 1.0,
      spellcheck: false,
    },
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(1.0);
    }
  });

  const launchMinimized = process.argv.includes('--minimized');
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (launchMinimized) {
        mainWindow.minimize();
      } else {
        mainWindow.maximize();
      }
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

  await mainWindow.loadURL(startUrl);
}

async function shutdownGracefully() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try {
    await tunnelSupervisor.stop();
  } catch (err) {
    console.error('[Electron Tunnel Shutdown Error]:', err);
  }

  if (serverInstance && typeof serverInstance.close === 'function') {
    try {
      await serverInstance.close();
    } catch (err) {
      console.error('[Electron Server Shutdown Error]:', err);
    }
  }

  if (dbLockPath) {
    releaseDatabaseLock(dbLockPath);
    dbLockPath = null;
  }
}

async function bootstrapApplication() {
  const appRoot = getAppRoot();
  const appDataBase = process.env.AWLAD_APP_DATA_ROOT || app.getPath('appData');

  let prepResult;
  try {
    prepResult = prepareElectronDataDirectory({
      appDataDir: appDataBase,
      legacySourceDirs: getLegacySourceCandidates(appRoot),
      envFileCandidates: getEnvFileCandidates(appRoot),
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
  process.env.AWLAD_DATA_DIR = prepResult.targetDataDir;
  if (prepResult.envFilePath) {
    process.env.AWLAD_ENV_FILE = prepResult.envFilePath;
  }

  desktopState.dataDir = prepResult.targetDataDir;
  desktopState.backupsDir = prepResult.backupsDir;
  desktopState.envFilePath = prepResult.envFilePath;
  desktopState.databaseState = prepResult.databaseState;

  try {
    dbLockPath = acquireDatabaseLock(prepResult.targetDataDir);
  } catch (err) {
    dialog.showErrorBox(
      'خادم AWLAD SELIM يعمل بالفعل',
      err?.message || 'توجد نسخة أخرى قيد التشغيل على نفس قاعدة البيانات.'
    );
    app.exit(1);
    return;
  }

  const devStartUrl = (process.env.ELECTRON_START_URL || '').trim();
  let startUrl = devStartUrl;

  if (!devStartUrl) {
    const serverEntryUrl = pathToFileURL(path.join(appRoot, 'server', 'index.js')).href;
    const { startStandaloneServer } = await import(serverEntryUrl);

    try {
      serverInstance = await startStandaloneServer({
        host: '0.0.0.0',
        port: Number(process.env.PORT || process.env.API_PORT || 3000),
        distDir: path.join(appRoot, 'dist'),
        envFiles: prepResult.envFilePath ? [prepResult.envFilePath] : [],
        allowPortFallback: false,
      });
    } catch (err) {
      dialog.showErrorBox(
        'تعذر تشغيل خادم AWLAD SELIM المحلي',
        `حدث خطأ أثناء تشغيل الخادم الداخلي على المنفذ ${process.env.PORT || 3000}.\n\n${err.message}\n\nإذا كان هناك خادم آخر يعمل على نفس المنفذ، أغلقه ثم أعد فتح البرنامج.`
      );
      app.exit(1);
      return;
    }

    desktopState.port = serverInstance.port;
    desktopState.lanUrls = serverInstance.lanUrls || [];
    desktopState.serverStatus = 'online';
    if (serverInstance.httpServer) {
      serverInstance.httpServer.on('error', (err) => {
        console.error('[Electron Embedded Server Error]:', err);
        desktopState.serverStatus = 'error';
      });
    }
    startUrl = serverInstance.localUrl;

    const autoTunnelCfg = readTunnelAutoStartConfig(prepResult.targetDataDir);
    if (autoTunnelCfg.enabled) {
      try {
        tunnelSupervisor.start({
          mode: autoTunnelCfg.mode,
          token: autoTunnelCfg.token,
          domainUrl: autoTunnelCfg.domainUrl,
        });
      } catch (tunErr) {
        console.warn('[Electron Auto-Tunnel Warning]:', tunErr?.message || tunErr);
      }
    }
  }

  registerIpcHandlers();
  buildApplicationMenu();
  await createMainWindow(startUrl, appRoot);
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

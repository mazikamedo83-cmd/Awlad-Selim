const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function inspectDatabaseFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, valid: false, hasRealData: false, counts: null, sha256: null, size: 0 };
  }
  try {
    const buf = fs.readFileSync(filePath);
    const parsed = JSON.parse(buf.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { exists: true, valid: false, hasRealData: false, counts: null, sha256: sha256Buffer(buf), size: buf.length };
    }
    const counts = {
      users: Array.isArray(parsed.users) ? parsed.users.length : 0,
      products: Array.isArray(parsed.products) ? parsed.products.length : 0,
      customers: Array.isArray(parsed.customers) ? parsed.customers.length : 0,
      suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers.length : 0,
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices.length : 0,
      cashboxes: Array.isArray(parsed.cashboxes) ? parsed.cashboxes.length : 0,
      financialTransactions: Array.isArray(parsed.financialTransactions) ? parsed.financialTransactions.length : 0,
    };
    const hasRealData =
      counts.users > 0 ||
      counts.products > 0 ||
      counts.customers > 0 ||
      counts.suppliers > 0 ||
      counts.invoices > 0 ||
      counts.financialTransactions > 0;

    return {
      exists: true,
      valid: true,
      hasRealData,
      counts,
      sha256: sha256Buffer(buf),
      size: buf.length,
    };
  } catch (err) {
    return {
      exists: true,
      valid: false,
      hasRealData: false,
      counts: null,
      error: err.message,
      sha256: null,
      size: fs.statSync(filePath).size,
    };
  }
}

function listTransferableFiles(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.endsWith('.tmp') && name !== 'SHA256SUMS.txt');
}

function atomicVerifiedCopy(srcFile, destFile) {
  const srcBuf = fs.readFileSync(srcFile);
  const srcHash = sha256Buffer(srcBuf);

  if (srcFile.toLowerCase().endsWith('.json')) {
    // Validate source JSON integrity before copying
    JSON.parse(srcBuf.toString('utf8'));
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const tmpFile = `${destFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, srcBuf);
  fs.renameSync(tmpFile, destFile);

  const destHash = sha256File(destFile);
  if (destHash !== srcHash) {
    throw new Error(`Integrity mismatch after copying ${path.basename(srcFile)}: expected ${srcHash}, got ${destHash}`);
  }
  return { file: path.basename(destFile), sha256: destHash, bytes: srcBuf.length };
}

function backupDirectoryFiles(srcDir, backupTargetDir) {
  const files = listTransferableFiles(srcDir);
  if (!files.length) return [];
  fs.mkdirSync(backupTargetDir, { recursive: true });
  const records = [];
  for (const name of files) {
    const src = path.join(srcDir, name);
    const dst = path.join(backupTargetDir, name);
    const copied = atomicVerifiedCopy(src, dst);
    if (name === 'database.json') {
      try {
        fs.chmodSync(dst, 0o444);
      } catch {
        // Windows chmod fallback
      }
    }
    records.push(copied);
  }
  return records;
}

/**
 * Safely prepares %APPDATA%\AWLAD SELIM\data (or provided appDataDir) without ever
 * overwriting or resetting an existing valid database.
 */
function prepareElectronDataDirectory({
  appDataDir,
  legacySourceDirs = [],
  backupsDir = null,
  envFileCandidates = [],
} = {}) {
  if (!appDataDir) {
    throw new Error('appDataDir is required to initialize AWLAD SELIM data directory.');
  }

  const appRootDataContainer = path.join(path.resolve(appDataDir), 'AWLAD SELIM');
  const targetDataDir = path.join(appRootDataContainer, 'data');
  const resolvedBackupsDir = backupsDir
    ? path.resolve(backupsDir)
    : path.join(appRootDataContainer, 'backups');

  fs.mkdirSync(appRootDataContainer, { recursive: true });
  fs.mkdirSync(targetDataDir, { recursive: true });
  fs.mkdirSync(resolvedBackupsDir, { recursive: true });

  // Copy optional .env into %APPDATA%\AWLAD SELIM\.env only if target .env does not exist yet
  const targetEnvFile = path.join(appRootDataContainer, '.env');
  if (!fs.existsSync(targetEnvFile)) {
    for (const candidate of envFileCandidates) {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        atomicVerifiedCopy(candidate, targetEnvFile);
        break;
      }
    }
  }

  const targetDbPath = path.join(targetDataDir, 'database.json');
  const targetDbState = inspectDatabaseFile(targetDbPath);

  if (targetDbState.exists && !targetDbState.valid) {
    const quarantineDir = path.join(resolvedBackupsDir, `corrupted_target_guard_${Date.now()}`);
    backupDirectoryFiles(targetDataDir, quarantineDir);
    throw new Error(
      `Existing database.json in "${targetDataDir}" failed JSON validation (${targetDbState.error || 'invalid structure'}). Preserved backup in "${quarantineDir}" without resetting data.`
    );
  }

  const normalizedTarget = path.resolve(targetDataDir).toLowerCase();
  const uniqueSources = [];
  for (const dir of legacySourceDirs) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    if (resolved.toLowerCase() === normalizedTarget) continue;
    if (fs.existsSync(resolved) && !uniqueSources.includes(resolved)) {
      uniqueSources.push(resolved);
    }
  }

  // Pick the legacy source that contains database.json (preferred) or any legacy ledger files
  let chosenSourceDir = null;
  for (const src of uniqueSources) {
    const srcDb = inspectDatabaseFile(path.join(src, 'database.json'));
    if (srcDb.exists && srcDb.valid) {
      chosenSourceDir = src;
      break;
    }
  }
  if (!chosenSourceDir) {
    for (const src of uniqueSources) {
      if (listTransferableFiles(src).length > 0) {
        chosenSourceDir = src;
        break;
      }
    }
  }

  const migratedFiles = [];
  const skippedFiles = [];
  let backupPath = null;

  if (chosenSourceDir) {
    const sourceFiles = listTransferableFiles(chosenSourceDir);
    const filesNeedingCopy = sourceFiles.filter((fileName) => {
      const destPath = path.join(targetDataDir, fileName);
      if (fileName === 'database.json') {
        // NEVER overwrite an existing valid target database.json
        if (targetDbState.exists) return false;
        const srcDb = inspectDatabaseFile(path.join(chosenSourceDir, 'database.json'));
        return srcDb.exists && srcDb.valid;
      }
      return !fs.existsSync(destPath);
    });

    if (filesNeedingCopy.length > 0) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = path.join(resolvedBackupsDir, `pre_electron_transfer_${timestamp}`);
      const sourceBackupRecords = backupDirectoryFiles(chosenSourceDir, path.join(backupPath, 'source_server_data'));
      const targetBeforeRecords = backupDirectoryFiles(targetDataDir, path.join(backupPath, 'target_before'));

      for (const fileName of filesNeedingCopy) {
        const srcPath = path.join(chosenSourceDir, fileName);
        const destPath = path.join(targetDataDir, fileName);

        if (fileName === 'database.json') {
          const srcCheck = inspectDatabaseFile(srcPath);
          if (!srcCheck.valid) {
            throw new Error(`Refusing to migrate invalid source database.json from "${srcPath}".`);
          }
          // Double guard: if target appeared concurrently or exists, never overwrite
          if (fs.existsSync(destPath)) {
            skippedFiles.push({ file: fileName, reason: 'existing_target_preserved' });
            continue;
          }
          const copied = atomicVerifiedCopy(srcPath, destPath);
          const destCheck = inspectDatabaseFile(destPath);
          if (!destCheck.valid || destCheck.sha256 !== srcCheck.sha256 || JSON.stringify(destCheck.counts) !== JSON.stringify(srcCheck.counts)) {
            throw new Error(`Post-copy integrity verification failed for database.json in "${destPath}".`);
          }
          migratedFiles.push({ ...copied, counts: destCheck.counts });
        } else {
          const copied = atomicVerifiedCopy(srcPath, destPath);
          migratedFiles.push(copied);
        }
      }

      const manifest = {
        createdAt: new Date().toISOString(),
        sourceDir: chosenSourceDir,
        targetDataDir,
        sourceBackupRecords,
        targetBeforeRecords,
        migratedFiles,
        skippedFiles,
      };
      fs.writeFileSync(path.join(backupPath, 'MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');
    }
  }

  const finalTargetDbState = inspectDatabaseFile(targetDbPath);

  return {
    ok: true,
    appRootDataContainer,
    targetDataDir,
    backupsDir: resolvedBackupsDir,
    envFilePath: fs.existsSync(targetEnvFile) ? targetEnvFile : null,
    chosenSourceDir,
    backupPath,
    migratedFiles,
    skippedFiles,
    existingTargetPreserved: targetDbState.exists,
    databaseState: finalTargetDbState,
  };
}

function applyElectronRuntimeEnvironment({
  isPackaged = false,
  targetDataDir = '',
  envFilePath = null,
  env = process.env,
} = {}) {
  const packaged = Boolean(isPackaged);
  env.AWLAD_ELECTRON = 'true';
  env.AWLAD_IS_PACKAGED = packaged ? 'true' : 'false';
  if (packaged) {
    // Enforce Production Strict Mode (PostgreSQL-only, zero JSON fallback)
    // automatically for packaged Windows builds before importing server/index.js.
    env.NODE_ENV = 'production';
    env.AWLAD_REQUIRE_POSTGRES = 'true';

    if (env.ALLOW_MOBILE_LAN_HTTP === undefined) {
      let hasExplicitLanSettingInEnvFile = false;
      if (envFilePath && fs.existsSync(envFilePath)) {
        try {
          const rawEnv = fs.readFileSync(envFilePath, 'utf8');
          hasExplicitLanSettingInEnvFile = /^\s*ALLOW_MOBILE_LAN_HTTP\s*=/m.test(rawEnv);
        } catch {
          hasExplicitLanSettingInEnvFile = false;
        }
      }
      if (!hasExplicitLanSettingInEnvFile) {
        env.ALLOW_MOBILE_LAN_HTTP = 'true';
      }
    }
  }
  if (targetDataDir) {
    env.AWLAD_DATA_DIR = targetDataDir;
  }
  if (envFilePath) {
    env.AWLAD_ENV_FILE = envFilePath;
  }
  return env;
}

module.exports = {
  inspectDatabaseFile,
  prepareElectronDataDirectory,
  applyElectronRuntimeEnvironment,
};

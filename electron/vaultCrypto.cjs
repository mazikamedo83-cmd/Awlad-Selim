const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

function ensureOfflineClientKey({ offlineClientDir, safeStorage }) {
  if (!offlineClientDir) return null;
  fs.mkdirSync(offlineClientDir, { recursive: true });
  const encKeyPath = path.join(offlineClientDir, '.vault.key.enc');
  const legacyKeyPath = path.join(offlineClientDir, '.vault.key');

  const canUseSafeStorage = Boolean(
    safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable()
  );

  if (!canUseSafeStorage) {
    throw new Error(
      'مخزن حماية نظام التشغيل (OS safeStorage) غير متاح. تم إيقاف تخزين بيانات الدخول الحساسة لحماية الحسابات ومنع الحفظ غير المشفر.'
    );
  }

  // 1. If encrypted master key exists, it MUST decrypt cleanly — NEVER silently overwrite or discard it
  if (fs.existsSync(encKeyPath)) {
    let hex;
    try {
      const encBuf = fs.readFileSync(encKeyPath);
      hex = safeStorage.decryptString(encBuf);
    } catch (err) {
      throw new Error(
        `تعذر فك تشفير مفتاح الخزنة المحمي بـ safeStorage دون إتلاف البيانات الحالية: ${err?.message || String(err)}`
      );
    }
    const key = Buffer.from(String(hex || '').trim(), 'hex');
    if (key.length !== 32) {
      throw new Error('مفتاح الخزنة المحمي غير صالح الطول. تم إيقاف العملية لحماية البيانات.');
    }
    return key;
  }

  // 2. Migrate legacy .vault.key ONLY after verifying roundtrip encryption + decryption read-back
  if (fs.existsSync(legacyKeyPath)) {
    const raw = fs.readFileSync(legacyKeyPath);
    if (raw.length !== 32) {
      throw new Error('ملف المفتاح القديم غير صالح. لم يتم حذفه لتفادي فقدان البيانات.');
    }
    try {
      const encrypted = safeStorage.encryptString(raw.toString('hex'));
      const tmpEncPath = `${encKeyPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpEncPath, encrypted, { mode: 0o600 });
      fs.renameSync(tmpEncPath, encKeyPath);

      const readBackBuf = fs.readFileSync(encKeyPath);
      const decryptedHex = safeStorage.decryptString(readBackBuf);
      const recovered = Buffer.from(String(decryptedHex || '').trim(), 'hex');
      if (recovered.length !== 32 || Buffer.compare(raw, recovered) !== 0) {
        try {
          fs.unlinkSync(encKeyPath);
        } catch {
          // ignore cleanup failure
        }
        throw new Error('فشل التحقق من مطابقة المفتاح بعد التشفير.');
      }

      fs.unlinkSync(legacyKeyPath);
      return raw;
    } catch (err) {
      throw new Error(
        `فشل ترحيل مفتاح الخزنة إلى مخزن نظام التشغيل الآمن (تم الإبقاء على الملف القديم دون حذف): ${err?.message || String(err)}`
      );
    }
  }

  // 3. Provision a brand-new 256-bit vault key protected exclusively via OS safeStorage (never plaintext)
  const key = nodeCrypto.randomBytes(32);
  try {
    const encrypted = safeStorage.encryptString(key.toString('hex'));
    const tmpEncPath = `${encKeyPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpEncPath, encrypted, { mode: 0o600 });
    fs.renameSync(tmpEncPath, encKeyPath);

    const verifyHex = safeStorage.decryptString(fs.readFileSync(encKeyPath));
    const verified = Buffer.from(String(verifyHex || '').trim(), 'hex');
    if (verified.length !== 32 || Buffer.compare(key, verified) !== 0) {
      throw new Error('فشل التحقق من حفظ مفتاح التشفير في المخزن الآمن.');
    }
    return key;
  } catch (err) {
    throw new Error(`تعذر إنشاء وحفظ مفتاح الخزنة داخل safeStorage: ${err?.message || String(err)}`);
  }
}

function writeEncryptedOfflineFile({ offlineClientDir, safeStorage, filePath, plainBuffer }) {
  const key = ensureOfflineClientKey({ offlineClientDir, safeStorage });
  if (!key) throw new Error('مجلد التخزين الآمن للعميل غير مهيأ.');
  const iv = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([Buffer.from('AWL1', 'ascii'), iv, tag, encrypted]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, payload, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

function readEncryptedOfflineFile({ offlineClientDir, safeStorage, filePath }) {
  if (!fs.existsSync(filePath)) return null;
  const key = ensureOfflineClientKey({ offlineClientDir, safeStorage });
  if (!key) throw new Error('مجلد التخزين الآمن للعميل غير مهيأ.');
  const raw = fs.readFileSync(filePath);
  if (raw.length < 32 || raw.subarray(0, 4).toString('ascii') !== 'AWL1') {
    throw new Error('صيغة ملف الخزنة المشفر غير صالحة أو تالفة.');
  }
  const iv = raw.subarray(4, 16);
  const tag = raw.subarray(16, 32);
  const data = raw.subarray(32);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

module.exports = {
  ensureOfflineClientKey,
  writeEncryptedOfflineFile,
  readEncryptedOfflineFile,
};

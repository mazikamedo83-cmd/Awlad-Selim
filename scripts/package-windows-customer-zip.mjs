import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eqIdx = raw.indexOf('=');
    if (eqIdx === -1) {
      args[raw.slice(2)] = 'true';
    } else {
      args[raw.slice(2, eqIdx)] = raw.slice(eqIdx + 1);
    }
  }
  return args;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanName, 'utf8');
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(rawData);
    const compressed = zlib.deflateRawSync(rawData, { level: 6 });
    const useStore = compressed.length >= rawData.length;
    const payload = useStore ? rawData : compressed;
    const method = useStore ? 0 : 8;
    const { dosTime, dosDate } = toDosTimeDate(entry.mtime || new Date());

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, payload);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4); // version made by (Unix / 2.0)
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attrs
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external file attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  eocd.writeUInt16LE(0, 4); // number of this disk
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildFirstTimeInstallDoc(version) {
  return [
    '====================================================================',
    `AWLAD SELIM ERP v${version} - دليل التثبيت والتشغيل لأول مرة (Windows)`,
    '====================================================================',
    '',
    'محتويات حزمة التسليم للعملاء:',
    `  1. 01-Installer/AWLAD-SELIM-Setup-${version}.exe    (المثبت الرسمي للنظام)`,
    `  2. 02-Portable/AWLAD-SELIM-Portable-${version}.exe  (نسخة محمولة عند الحاجة)`,
    '  3. 03-Documentation/                               (أدلة التثبيت والترقية الآمنة)',
    '  4. SHA256SUMS.txt                                  (بصمات التحقق الأمني للملفات)',
    '',
    'خطوات التثبيت والتشغيل لأول مرة على جهاز عميل جديد:',
    '1. شغّل ملف التثبيت 01-Installer\\AWLAD-SELIM-Setup-' + version + '.exe واتبع المعالج.',
    '2. عند أول تشغيل، لا يفتح النظام أي حساب إداري تلقائياً ولا يحتوي على أي بيانات أو جلسات خاصة بأي شركة أخرى.',
    '3. ستظهر شاشة تسجيل الدخول:',
    '   - إذا كان هذا هو الجهاز الرئيسي الجديد للشركة ولم يُسجل لها مدير بعد: اختر "إعداد حساب المدير الأول للشركة" وأنشئ اسم المستخدم وكلمة المرور الخاصة بكم.',
    '   - بعد وجود حساب مدير للشركة على السيرفر، يُمنع إنشاء مدير أول جديد من هذه الشاشة نهائياً.',
    '   - إذا كان هذا الجهاز فرعياً أو موظفاً يتصل بسيرفر الشركة: أدخل بيانات حسابك المسجل من قبل الإدارة فقط.',
    '4. لربط أجهزة المندوبين والعملاء (Android / iOS) بنفس سيرفر هذا الجهاز:',
    '   - اسمح للتطبيق أو لمنفذ TCP 3000 في جدار حماية Windows (Private Network).',
    '   - من داخل البرنامج (الإعدادات -> Server & Connection Settings) أنشئ رابط الربط أو QR Code.',
    '',
    'مسار حفظ بيانات الشركة على الجهاز:',
    '  %APPDATA%\\AWLAD SELIM\\data',
    '  %APPDATA%\\AWLAD SELIM\\backups',
    '====================================================================',
    '',
  ].join('\r\n');
}

function buildMigrationDoc(version) {
  return [
    '====================================================================',
    `AWLAD SELIM ERP v${version} - دليل التحديث والانتقال الآمن (Windows & Android)`,
    '====================================================================',
    '',
    'أولاً: تحديث برنامج Windows للعملاء الحاليين:',
    '1. يقوم المثبت Setup-' + version + '.exe بالترقية مع الحفاظ التلقائي على مجلد بيانات الشركة:',
    '   %APPDATA%\\AWLAD SELIM\\data',
    '2. لن يفتح النظام حساب Admin تلقائياً بعد التحديث؛ سيُطلب من كل مستخدم تسجيل الدخول بحسابه وكلمة مروره.',
    '3. تبقى جميع الفواتير والأصناف والعملاء والحسابات والصلاحيات كما هي دون فقدان.',
    '',
    'ثانياً: الانتقال إلى نسخة Android الإنتاجية الموقعة بالمفتاح النهائي الجديد:',
    '  (هام: بما أن النسخة الإنتاجية الجديدة موقعة بمفتاح Production مستقل غير المفتاح القديم،',
    '   لا يسمح نظام Android بالتحديث فوق النسخة القديمة مباشرة ويجب اتباع الخطوات التالية بالترتيب):',
    '1. في النسخة القديمة على الهاتف، افتح مركز المزامنة وتأكد أن العمليات المعلقة = 0.',
    '   - إذا وجدت عمليات غير متزامنة، اضغط "مزامنة الآن" أو استخدم "تصدير المعلق" لحفظ ملف احتياطي آمن.',
    '2. بعد التأكد من تصفير المعلق أو حفظ النسخة الاحتياطية، قم بإلغاء تثبيت (Uninstall) النسخة القديمة من الهاتف.',
    `3. ثبّت ملف الإنتاج الجديد: AWLAD-SELIM-${version}-Release.apk.`,
    '4. عند الفتح، اربط التطبيق بنفس السيرفر المركزي (IP محلي / QR / نفق خارجي) وسجّل الدخول بنفس حسابك القديم:',
    '   - نفس اسم المستخدم وكلمة المرور القديمة ستعمل مباشرة لأن الحسابات والصلاحيات محفوظة على السيرفر المركزي.',
    '   - لا تنشئ حساباً جديداً إذا كان لديك حساب سابق.',
    '   - إذا كان لديك ملف عمليات معلقة مصدّر، استخدم "استيراد نسخة معلقة" داخل مركز المزامنة لإرساله بأمان دون تكرار.',
    '====================================================================',
    '',
  ].join('\r\n');
}

export function packageWindowsCustomerZip({ distDir, outPath, version }) {
  if (!distDir) throw new Error('distDir is required');
  if (!version) throw new Error('version is required');

  const resolvedDist = path.resolve(distDir);
  if (!fs.existsSync(resolvedDist)) {
    throw new Error(`Distribution directory does not exist: ${resolvedDist}`);
  }

  const setupName = `AWLAD-SELIM-Setup-${version}.exe`;
  const setupPath = path.join(resolvedDist, setupName);
  if (!fs.existsSync(setupPath)) {
    throw new Error(`Missing required Windows Setup installer: ${setupPath}`);
  }
  const setupBytes = fs.readFileSync(setupPath);
  if (setupBytes.length === 0) {
    throw new Error(`Windows Setup installer is empty: ${setupPath}`);
  }

  const portableName = `AWLAD-SELIM-Portable-${version}.exe`;
  const portablePath = path.join(resolvedDist, portableName);
  const hasPortable = fs.existsSync(portablePath) && fs.statSync(portablePath).size > 0;
  const portableBytes = hasPortable ? fs.readFileSync(portablePath) : null;

  const rootFolder = `AWLAD-SELIM-Windows-Customer-${version}`;
  const firstTimeDocName = '03-Documentation/دليل-التثبيت-والتشغيل-لأول-مرة.txt';
  const migrationDocName = '03-Documentation/دليل-التحديث-والانتقال-الآمن.txt';

  const firstTimeDocBuf = Buffer.from(buildFirstTimeInstallDoc(version), 'utf8');
  const migrationDocBuf = Buffer.from(buildMigrationDoc(version), 'utf8');

  const entries = [
    {
      name: `${rootFolder}/01-Installer/${setupName}`,
      data: setupBytes,
      checksumPath: `01-Installer/${setupName}`,
    },
  ];

  if (portableBytes) {
    entries.push({
      name: `${rootFolder}/02-Portable/${portableName}`,
      data: portableBytes,
      checksumPath: `02-Portable/${portableName}`,
    });
  }

  entries.push(
    {
      name: `${rootFolder}/${firstTimeDocName}`,
      data: firstTimeDocBuf,
      checksumPath: firstTimeDocName,
    },
    {
      name: `${rootFolder}/${migrationDocName}`,
      data: migrationDocBuf,
      checksumPath: migrationDocName,
    }
  );

  // Hygiene guard: ensure no forbidden secrets or internal company DB paths exist inside ZIP manifest
  const forbiddenPatterns = [
    /\.env($|\.)/i,
    /\.jwt_secret/i,
    /database\.json/i,
    /sessions\.json/i,
    /AWLAD_SELIM_BACKUP/i,
    /\.jks$/i,
    /\.keystore$/i,
    /keystore\.properties$/i,
  ];
  for (const item of entries) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(item.name)) {
        throw new Error(`Forbidden file matched customer ZIP hygiene policy: ${item.name}`);
      }
    }
  }

  const checksumLines = entries.map((item) => `${sha256(item.data)}  ${item.checksumPath}`);
  const checksumBuf = Buffer.from(checksumLines.join('\r\n') + '\r\n', 'utf8');
  entries.push({
    name: `${rootFolder}/SHA256SUMS.txt`,
    data: checksumBuf,
    checksumPath: 'SHA256SUMS.txt',
  });

  const zipPath = path.resolve(
    outPath || path.join(resolvedDist, `AWLAD-SELIM-Windows-Customer-${version}.zip`)
  );
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  const zipBuffer = createZipBuffer(entries);
  fs.writeFileSync(zipPath, zipBuffer);

  return {
    zipPath,
    zipSize: zipBuffer.length,
    zipSha256: sha256(zipBuffer),
    entryNames: entries.map((e) => e.name),
  };
}

const isCliEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isCliEntry) {
  const args = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  const version = args.version || pkg.version;
  const distDir = args['dist-dir'] || 'dist-electron';
  const outPath = args.out || undefined;

  const result = packageWindowsCustomerZip({ distDir, outPath, version });
  console.log(`[OK] Customer ZIP packaged: ${result.zipPath}`);
  console.log(`[OK] Size: ${(result.zipSize / (1024 * 1024)).toFixed(2)} MB | SHA-256: ${result.zipSha256}`);
  console.log('[OK] Entries:');
  for (const name of result.entryNames) {
    console.log(`  - ${name}`);
  }
}

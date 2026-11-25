import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');

// Precomputed CRC-32 lookup table
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeZipArchive(zipPath, files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const file of files) {
    const nameBuf = Buffer.from(file.entryName.replace(/\\/g, '/'), 'utf8');
    const rawBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const compressedBuf = zlib.deflateRawSync(rawBuf);
    const useDeflate = compressedBuf.length < rawBuf.length;
    const payload = useDeflate ? compressedBuf : rawBuf;
    const method = useDeflate ? 8 : 0;
    const crcVal = crc32(rawBuf);

    // Local file header (30 bytes + name)
    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crcVal, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(rawBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);

    localChunks.push(lfh, payload);

    // Central directory header (46 bytes + name)
    const cdh = Buffer.alloc(46 + nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crcVal, 16);
    cdh.writeUInt32LE(payload.length, 20);
    cdh.writeUInt32LE(rawBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    nameBuf.copy(cdh, 46);

    centralChunks.push(cdh);
    offset += lfh.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const finalBuf = Buffer.concat([...localChunks, centralDirBuf, eocd]);
  const tmpPath = `${zipPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, finalBuf);
  fs.renameSync(tmpPath, zipPath);
}

function readZipCentralDirectory(zipPath) {
  const buf = fs.readFileSync(zipPath);
  if (buf.length < 22) {
    throw new Error(`Invalid ZIP archive (too small): ${zipPath}`);
  }
  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 65557);
  for (let pos = buf.length - 22; pos >= minOffset; pos--) {
    if (buf.readUInt32LE(pos) === 0x06054b50) {
      eocdOffset = pos;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error(`Invalid ZIP archive (missing End of Central Directory): ${zipPath}`);
  }

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let cursor = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Corrupt central directory entry at index ${i}`);
    }
    const method = buf.readUInt16LE(cursor + 10);
    const crc = buf.readUInt32LE(cursor + 16);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString('utf8', cursor + 46, cursor + 46 + nameLen);

    entries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function isExecutedAsCli(importMetaUrl, argv1) {
  if (!importMetaUrl || !argv1) return false;
  try {
    const selfPath = path.resolve(fileURLToPath(importMetaUrl));
    const entryPath = path.resolve(argv1);
    if (process.platform === 'win32') {
      return selfPath.toLowerCase() === entryPath.toLowerCase();
    }
    return selfPath === entryPath;
  } catch {
    return false;
  }
}

export function verifyCustomerZipArchive({
  zipPath,
  version,
  expectedSetupPath,
  allowPortable = false,
} = {}) {
  if (!zipPath || !fs.existsSync(zipPath)) {
    throw new Error(`Customer ZIP not found: ${zipPath}`);
  }
  const entries = readZipCentralDirectory(zipPath);
  const names = entries.map((e) => e.name);
  const rootPrefix = `AWLAD-SELIM-Windows-Customer-${version}`;
  const expectedSetupEntry = `${rootPrefix}/01-Installer/AWLAD-SELIM-Setup-${version}.exe`;
  const expectedWinGuide = `${rootPrefix}/02-Instructions/WINDOWS_SETUP_GUIDE.md`;
  const expectedMobGuide = `${rootPrefix}/02-Instructions/MOBILE_CENTRAL_SERVER_GUIDE.md`;
  const expectedSums = `${rootPrefix}/SHA256SUMS.txt`;

  for (const required of [expectedSetupEntry, expectedWinGuide, expectedMobGuide, expectedSums]) {
    if (!names.includes(required)) {
      throw new Error(`Customer ZIP missing required entry: ${required}`);
    }
  }

  for (const entryName of names) {
    const lower = entryName.toLowerCase();
    if (!allowPortable && lower.includes('portable')) {
      throw new Error(`Customer Setup ZIP must NOT contain Portable executable: ${entryName}`);
    }
    if (
      lower.endsWith('.env') ||
      lower.includes('/.env') ||
      lower.endsWith('database.json') ||
      lower.endsWith('sessions.json') ||
      lower.endsWith('.jwt_secret')
    ) {
      throw new Error(`Customer ZIP contains forbidden secret/data file: ${entryName}`);
    }
  }

  if (expectedSetupPath && fs.existsSync(expectedSetupPath)) {
    const setupBuf = fs.readFileSync(expectedSetupPath);
    const setupEntry = entries.find((e) => e.name === expectedSetupEntry);
    if (!setupEntry || setupEntry.uncompressedSize !== setupBuf.length || setupEntry.crc !== crc32(setupBuf)) {
      throw new Error(`Setup EXE integrity mismatch inside Customer ZIP: ${expectedSetupEntry}`);
    }
  }

  return {
    ok: true,
    zipPath,
    version,
    entries,
  };
}

export function buildCustomerZipArchive({
  distDir = path.join(REPO_ROOT, 'dist-electron'),
  version,
  allowPortable = false,
} = {}) {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '3.0.0';
  const ver = version || pkgVersion;
  const resolvedDistDir = path.resolve(distDir);
  const setupFilename = `AWLAD-SELIM-Setup-${ver}.exe`;
  const setupPath = path.join(resolvedDistDir, setupFilename);

  if (!fs.existsSync(setupPath)) {
    throw new Error(`Missing Windows Setup installer: ${setupPath}`);
  }

  const winGuidePath = path.join(REPO_ROOT, 'WINDOWS_SETUP_GUIDE.md');
  const mobGuidePath = path.join(REPO_ROOT, 'MOBILE_CENTRAL_SERVER_GUIDE.md');
  const setupBuf = fs.readFileSync(setupPath);
  const winGuideBuf = fs.existsSync(winGuidePath)
    ? fs.readFileSync(winGuidePath)
    : Buffer.from('# WINDOWS SETUP GUIDE\n', 'utf8');
  const mobGuideBuf = fs.existsSync(mobGuidePath)
    ? fs.readFileSync(mobGuidePath)
    : Buffer.from('# MOBILE CENTRAL SERVER GUIDE\n', 'utf8');

  const rootPrefix = `AWLAD-SELIM-Windows-Customer-${ver}`;
  const filesWithoutSums = [
    {
      entryName: `${rootPrefix}/01-Installer/${setupFilename}`,
      relPath: `01-Installer/${setupFilename}`,
      data: setupBuf,
    },
    {
      entryName: `${rootPrefix}/02-Instructions/WINDOWS_SETUP_GUIDE.md`,
      relPath: `02-Instructions/WINDOWS_SETUP_GUIDE.md`,
      data: winGuideBuf,
    },
    {
      entryName: `${rootPrefix}/02-Instructions/MOBILE_CENTRAL_SERVER_GUIDE.md`,
      relPath: `02-Instructions/MOBILE_CENTRAL_SERVER_GUIDE.md`,
      data: mobGuideBuf,
    },
  ];

  const shaLines = filesWithoutSums.map((f) => {
    const hash = crypto.createHash('sha256').update(f.data).digest('hex');
    return `${hash}  ${f.relPath}`;
  });
  const sumsBuf = Buffer.from(shaLines.join('\n') + '\n', 'utf8');

  const allFiles = [
    ...filesWithoutSums,
    {
      entryName: `${rootPrefix}/SHA256SUMS.txt`,
      relPath: 'SHA256SUMS.txt',
      data: sumsBuf,
    },
  ];

  const zipPath = path.join(resolvedDistDir, `AWLAD-SELIM-Windows-Customer-${ver}.zip`);
  writeZipArchive(zipPath, allFiles);

  const verified = verifyCustomerZipArchive({
    zipPath,
    version: ver,
    expectedSetupPath: setupPath,
    allowPortable,
  });

  return {
    ok: true,
    zipPath,
    version: ver,
    entries: verified.entries,
  };
}

if (isExecutedAsCli(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  let distDir = path.join(REPO_ROOT, 'dist-electron');
  let version = '';
  let verifyOnly = false;

  for (const arg of args) {
    if (arg.startsWith('--dist-dir=')) {
      distDir = arg.slice('--dist-dir='.length);
    } else if (arg.startsWith('--version=')) {
      version = arg.slice('--version='.length);
    } else if (arg === '--verify-only') {
      verifyOnly = true;
    }
  }

  const pkgVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version || '3.0.0';
  const effectiveVersion = version || pkgVersion;
  const resolvedDistDir = path.resolve(distDir);
  const zipPath = path.join(resolvedDistDir, `AWLAD-SELIM-Windows-Customer-${effectiveVersion}.zip`);
  const setupPath = path.join(resolvedDistDir, `AWLAD-SELIM-Setup-${effectiveVersion}.exe`);

  const result = verifyOnly
    ? verifyCustomerZipArchive({
        zipPath,
        version: effectiveVersion,
        expectedSetupPath: setupPath,
        allowPortable: false,
      })
    : buildCustomerZipArchive({
        distDir: resolvedDistDir,
        version: effectiveVersion,
        allowPortable: false,
      });

  console.log(
    `[Windows Customer ZIP ${verifyOnly ? 'Verified' : 'Created'}]: ${result.zipPath} (${result.entries.length} files)`
  );
  for (const entry of result.entries) {
    console.log(` - ${entry.name} (${entry.uncompressedSize} bytes)`);
  }
}

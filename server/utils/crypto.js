import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AWLAD_DATA_DIR
  ? path.resolve(process.env.AWLAD_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const jwtSecretFile = path.join(dataDir, '.jwt_secret');

// Legacy frontend static salt - ONLY used on the server to verify and transparently upgrade old migrated hashes.
const LEGACY_STATIC_SALT = 'awlad_selim_secure_salt_2026';

let cachedJwtSecret = '';

export function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    return process.env.JWT_SECRET;
  }
  if (cachedJwtSecret) return cachedJwtSecret;

  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(jwtSecretFile)) {
    const stored = fs.readFileSync(jwtSecretFile, 'utf8').trim();
    if (stored.length >= 32) {
      cachedJwtSecret = stored;
      return cachedJwtSecret;
    }
  }

  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(jwtSecretFile, generated, { encoding: 'utf8', mode: 0o600 });
  } catch {
    fs.writeFileSync(jwtSecretFile, generated, 'utf8');
  }
  cachedJwtSecret = generated;
  return cachedJwtSecret;
}

export async function hashPasswordBcrypt(password) {
  const clean = String(password || '');
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(clean, salt);
}

export function verifyLegacySha256(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(storedHash)) {
    return false;
  }
  const computed = crypto.createHash('sha256').update(String(password || '') + LEGACY_STATIC_SALT).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

export async function verifyPasswordAndCheckUpgrade(password, storedHash) {
  const clean = String(password || '');
  if (!storedHash || typeof storedHash !== 'string') {
    return { valid: false, needsUpgrade: false };
  }

  // Standard bcrypt hashes ($2a$, $2b$, $2y$)
  if (storedHash.startsWith('$2')) {
    const valid = await bcrypt.compare(clean, storedHash);
    return { valid, needsUpgrade: false };
  }

  // Legacy SHA-256 hash migrated from old database.json
  const legacyValid = verifyLegacySha256(clean, storedHash);
  return { valid: legacyValid, needsUpgrade: legacyValid };
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function signJwt(payload, expiresInSeconds = 900) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${header}.${body}`;
  const sig = crypto
    .createHmac('sha256', getJwtSecret())
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

export function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const expectedSig = crypto
    .createHmac('sha256', getJwtSecret())
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(body));
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function generateServerId(prefix = 'AS') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
}

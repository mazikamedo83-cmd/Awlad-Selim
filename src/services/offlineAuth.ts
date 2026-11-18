import type { Customer, Representative, User } from '../types';
import { getKV, removeKV, setKV } from './localDb';

const CRED_NAMESPACE = 'offline_auth_creds';
const SESSION_NAMESPACE = 'offline_auth_session';
const ACTIVE_SESSION_KEY = 'last_verified';
const OFFLINE_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredOfflineCredential {
  userId: string;
  usernameLower: string;
  serverOrigin: string;
  saltHex: string;
  verifierHex: string;
  user: User;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
  lastVerifiedAt: string;
  revoked?: boolean;
}

interface StoredLastVerifiedSession {
  userId: string;
  usernameLower: string;
  serverOrigin: string;
  lastVerifiedAt: string;
}

export function normalizeServerOrigin(rawUrl: string): string {
  const clean = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!clean) {
    return typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin.toLowerCase()
      : 'local';
  }
  try {
    const parsed = new URL(clean);
    return parsed.origin.toLowerCase();
  } catch {
    return clean.toLowerCase();
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomSaltHex(len = 16): string {
  const bytes = new Uint8Array(len);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToHex(bytes);
}

// Pure-JS fallback key derivation when crypto.subtle is unavailable (e.g., plain HTTP LAN origins)
function fallbackDeriveHex(password: string, saltHex: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const input = `${saltHex}::${password}`;
  for (let round = 0; round < 512; round += 1) {
    for (let i = 0; i < input.length; i += 1) {
      const code = input.charCodeAt(i);
      h1 ^= code ^ (round & 0xff);
      h1 = Math.imul(h1, 0x01000193);
      h2 = (h2 ^ ((h1 >>> 16) + code + round)) >>> 0;
      h2 = Math.imul(h2, 0x85ebca6b);
    }
  }
  return `fb_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

async function deriveVerifierHex(password: string, saltHex: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      );
      const saltBuf = hexToBytes(saltHex);
      const derived = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltBuf.buffer as ArrayBuffer,
          iterations: 50000,
          hash: 'SHA-256',
        },
        keyMaterial,
        256
      );
      return `pbkdf2_${bytesToHex(new Uint8Array(derived))}`;
    } catch {
      // fall back below if WebCrypto fails in restricted context
    }
  }
  return fallbackDeriveHex(password, saltHex);
}

function credKey(serverOrigin: string, usernameLower: string): string {
  return `${serverOrigin}::${usernameLower}`;
}

function userIndexKey(userId: string): string {
  return `uid::${userId}`;
}

export async function saveVerifiedOnlineCredentials(params: {
  serverUrl: string;
  username: string;
  password: string;
  user: User;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
}): Promise<void> {
  const usernameLower = String(params.username || params.user?.username || '').trim().toLowerCase();
  if (!usernameLower || !params.password || !params.user?.id) return;

  const serverOrigin = normalizeServerOrigin(params.serverUrl);
  const saltHex = randomSaltHex(16);
  const verifierHex = await deriveVerifierHex(params.password, saltHex);
  const nowIso = new Date().toISOString();

  const record: StoredOfflineCredential = {
    userId: params.user.id,
    usernameLower,
    serverOrigin,
    saltHex,
    verifierHex,
    user: params.user,
    customerProfile: params.customerProfile || null,
    representativeProfile: params.representativeProfile || null,
    lastVerifiedAt: nowIso,
    revoked: false,
  };

  const cKey = credKey(serverOrigin, usernameLower);
  await setKV(CRED_NAMESPACE, cKey, record);
  await setKV(CRED_NAMESPACE, userIndexKey(params.user.id), cKey);
  await setKV<StoredLastVerifiedSession>(SESSION_NAMESPACE, ACTIVE_SESSION_KEY, {
    userId: params.user.id,
    usernameLower,
    serverOrigin,
    lastVerifiedAt: nowIso,
  });
}

export async function refreshCachedUserAuthorization(params: {
  serverUrl: string;
  user: User;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
}): Promise<void> {
  if (!params.user?.id) return;
  const serverOrigin = normalizeServerOrigin(params.serverUrl);
  const usernameLower = String(params.user.username || '').trim().toLowerCase();
  const cKey =
    (await getKV<string>(CRED_NAMESPACE, userIndexKey(params.user.id))) ||
    (usernameLower ? credKey(serverOrigin, usernameLower) : '');
  const nowIso = new Date().toISOString();

  if (cKey) {
    const existing = await getKV<StoredOfflineCredential>(CRED_NAMESPACE, cKey);
    if (existing) {
      await setKV(CRED_NAMESPACE, cKey, {
        ...existing,
        user: params.user,
        customerProfile: params.customerProfile || null,
        representativeProfile: params.representativeProfile || null,
        lastVerifiedAt: nowIso,
        revoked: params.user.isActive === false,
      });
    }
  }

  if (params.user.isActive !== false && usernameLower) {
    await setKV<StoredLastVerifiedSession>(SESSION_NAMESPACE, ACTIVE_SESSION_KEY, {
      userId: params.user.id,
      usernameLower,
      serverOrigin,
      lastVerifiedAt: nowIso,
    });
  }
}

export async function verifyOfflineLogin(params: {
  serverUrl: string;
  username: string;
  password: string;
}): Promise<
  | {
      ok: true;
      user: User;
      customerProfile: Customer | null;
      representativeProfile: Representative | null;
      lastVerifiedAt: string;
    }
  | { ok: false; error: string }
> {
  const usernameLower = String(params.username || '').trim().toLowerCase();
  const serverOrigin = normalizeServerOrigin(params.serverUrl);
  if (!usernameLower || !params.password) {
    return { ok: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' };
  }

  const record = await getKV<StoredOfflineCredential>(CRED_NAMESPACE, credKey(serverOrigin, usernameLower));
  if (!record) {
    return {
      ok: false,
      error: 'لا توجد بيانات دخول محلية موثقة لهذا الحساب بدون إنترنت. يجب تسجيل الدخول مرة واحدة على الأقل أثناء الاتصال بالسيرفر.',
    };
  }

  if (record.revoked || record.user?.isActive === false) {
    return {
      ok: false,
      error: 'تم إيقاف هذا الحساب أو سحب صلاحيته من السيرفر المركزي.',
    };
  }

  const verifiedAtMs = Date.parse(record.lastVerifiedAt || '');
  if (Number.isFinite(verifiedAtMs) && Date.now() - verifiedAtMs > OFFLINE_SESSION_MAX_AGE_MS) {
    return {
      ok: false,
      error: 'انتهت صلاحية الجلسة المحلية المؤقتة. يرجى الاتصال بالسيرفر لتجديد التحقق.',
    };
  }

  let candidateHex: string;
  if (record.verifierHex.startsWith('fb_')) {
    candidateHex = fallbackDeriveHex(params.password, record.saltHex);
  } else {
    candidateHex = await deriveVerifierHex(params.password, record.saltHex);
  }

  if (candidateHex !== record.verifierHex) {
    return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
  }

  await setKV<StoredLastVerifiedSession>(SESSION_NAMESPACE, ACTIVE_SESSION_KEY, {
    userId: record.user.id,
    usernameLower,
    serverOrigin: record.serverOrigin,
    lastVerifiedAt: record.lastVerifiedAt,
  });

  return {
    ok: true,
    user: record.user,
    customerProfile: record.customerProfile || null,
    representativeProfile: record.representativeProfile || null,
    lastVerifiedAt: record.lastVerifiedAt,
  };
}

export async function restoreLastVerifiedOfflineSession(serverUrl: string): Promise<{
  user: User;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
  lastVerifiedAt: string;
} | null> {
  const session = await getKV<StoredLastVerifiedSession>(SESSION_NAMESPACE, ACTIVE_SESSION_KEY);
  if (!session?.userId || !session.usernameLower) return null;

  const targetOrigin = session.serverOrigin || normalizeServerOrigin(serverUrl);
  const record = await getKV<StoredOfflineCredential>(
    CRED_NAMESPACE,
    credKey(targetOrigin, session.usernameLower)
  );
  if (!record || record.revoked || record.user?.isActive === false) return null;

  const verifiedAtMs = Date.parse(record.lastVerifiedAt || '');
  if (Number.isFinite(verifiedAtMs) && Date.now() - verifiedAtMs > OFFLINE_SESSION_MAX_AGE_MS) {
    return null;
  }

  return {
    user: record.user,
    customerProfile: record.customerProfile || null,
    representativeProfile: record.representativeProfile || null,
    lastVerifiedAt: record.lastVerifiedAt,
  };
}

export async function clearLastVerifiedOfflineSession(_userId?: string): Promise<void> {
  await removeKV(SESSION_NAMESPACE, ACTIVE_SESSION_KEY);
}

export async function revokeOfflineUser(userId: string): Promise<void> {
  if (!userId) return;
  const cKey = await getKV<string>(CRED_NAMESPACE, userIndexKey(userId));
  if (cKey) {
    const existing = await getKV<StoredOfflineCredential>(CRED_NAMESPACE, cKey);
    if (existing) {
      await setKV(CRED_NAMESPACE, cKey, { ...existing, revoked: true });
    }
  }
  const session = await getKV<StoredLastVerifiedSession>(SESSION_NAMESPACE, ACTIVE_SESSION_KEY);
  if (session?.userId === userId) {
    await removeKV(SESSION_NAMESPACE, ACTIVE_SESSION_KEY);
  }
}

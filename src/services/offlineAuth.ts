import { localDb, type OfflineAuthProfileRecord } from './localDb';
import { constantTimeEqual, generateRandomHex, pbkdf2Sha256Hex } from './offlineCrypto';
import type { Customer, Representative, User } from '../types';

const LAST_VERIFIED_META_KEY = 'last_verified_auth_session';
const PBKDF2_ITERATIONS = 12000;

export function normalizeServerOrigin(serverUrl?: string): string {
  const clean = String(serverUrl || '').trim().replace(/\/+$/, '');
  if (!clean) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin.toLowerCase();
    }
    return 'same-origin';
  }
  try {
    return new URL(clean).origin.toLowerCase();
  } catch {
    return clean.toLowerCase();
  }
}

export function buildAuthProfileKey(serverUrl: string | undefined, username: string): string {
  const origin = normalizeServerOrigin(serverUrl);
  const cleanUser = String(username || '').trim().toLowerCase();
  return `${origin}::${cleanUser}`;
}

export async function saveVerifiedOnlineCredentials(params: {
  serverUrl?: string;
  username: string;
  password?: string;
  user: User;
  customerProfile?: Customer | null;
  representativeProfile?: Representative | null;
}): Promise<void> {
  const cleanUsername = String(params.username || params.user?.username || '').trim().toLowerCase();
  if (!cleanUsername || !params.user?.id) return;

  const serverOrigin = normalizeServerOrigin(params.serverUrl);
  const profileKey = buildAuthProfileKey(params.serverUrl, cleanUsername);
  const existing = await localDb.getAuthProfile(profileKey);

  let salt = existing?.salt || '';
  let iterations = existing?.iterations || PBKDF2_ITERATIONS;
  let verifierHash = existing?.verifierHash || '';

  if (params.password && params.password.length > 0) {
    salt = generateRandomHex(16);
    iterations = PBKDF2_ITERATIONS;
    verifierHash = await pbkdf2Sha256Hex(params.password, salt, iterations);
  }

  // Never store plaintext password or server passwordHash
  const sanitizedUser: User = {
    ...params.user,
    passwordHash: '',
  };

  const now = new Date().toISOString();
  const record: OfflineAuthProfileRecord = {
    profileKey,
    serverOrigin,
    username: cleanUsername,
    userId: sanitizedUser.id,
    salt,
    iterations,
    verifierHash,
    user: sanitizedUser,
    customerProfile: params.customerProfile ?? existing?.customerProfile ?? null,
    representativeProfile: params.representativeProfile ?? existing?.representativeProfile ?? null,
    lastVerifiedAt: now,
    isActive: sanitizedUser.isActive !== false,
  };

  await localDb.upsertAuthProfile(record);
  await localDb.setMeta(LAST_VERIFIED_META_KEY, {
    profileKey,
    userId: sanitizedUser.id,
    serverOrigin,
    lastVerifiedAt: now,
  });
}

export async function refreshCachedUserAuthorization(params: {
  serverUrl?: string;
  user: User;
  customerProfile?: Customer | null;
  representativeProfile?: Representative | null;
}): Promise<void> {
  await saveVerifiedOnlineCredentials({
    serverUrl: params.serverUrl,
    username: params.user.username,
    user: params.user,
    customerProfile: params.customerProfile,
    representativeProfile: params.representativeProfile,
  });
}

export async function verifyOfflineLogin(params: {
  serverUrl?: string;
  username: string;
  password: string;
}): Promise<{
  ok: true;
  user: User;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
  lastVerifiedAt: string;
} | {
  ok: false;
  code: string;
  error: string;
}> {
  const cleanUser = String(params.username || '').trim().toLowerCase();
  const pass = String(params.password || '');
  if (!cleanUser || !pass) {
    return { ok: false, code: 'CREDENTIALS_REQUIRED', error: 'يرجى إدخال اسم المستخدم وكلمة المرور' };
  }

  const profileKey = buildAuthProfileKey(params.serverUrl, cleanUser);
  const record = await localDb.getAuthProfile(profileKey);

  if (!record || !record.verifierHash || !record.salt) {
    return {
      ok: false,
      code: 'OFFLINE_USER_NOT_VERIFIED',
      error:
        'لا يمكن تسجيل الدخول دون اتصال لحساب لم يتم التحقق منه مسبقًا على هذا الجهاز. يرجى الاتصال بالسيرفر المركزي لتسجيل الدخول أول مرة.',
    };
  }

  if (!record.isActive || record.user?.isActive === false) {
    return {
      ok: false,
      code: 'OFFLINE_USER_INACTIVE',
      error: 'هذا الحساب موقوف حسب آخر تحقق موثق من السيرفر المركزي.',
    };
  }

  const derived = await pbkdf2Sha256Hex(pass, record.salt, record.iterations || PBKDF2_ITERATIONS);
  if (!constantTimeEqual(derived, record.verifierHash)) {
    return {
      ok: false,
      code: 'INVALID_OFFLINE_PASSWORD',
      error: 'كلمة المرور غير صحيحة للتحقق المحلي دون اتصال.',
    };
  }

  await localDb.setMeta(LAST_VERIFIED_META_KEY, {
    profileKey: record.profileKey,
    userId: record.userId,
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

export async function restoreLastVerifiedOfflineSession(serverUrl?: string): Promise<{
  user: User;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
  lastVerifiedAt: string;
} | null> {
  const meta = await localDb.getMeta<{
    profileKey: string;
    userId: string;
    serverOrigin: string;
    lastVerifiedAt: string;
  }>(LAST_VERIFIED_META_KEY);

  if (!meta?.profileKey) return null;
  const targetOrigin = normalizeServerOrigin(serverUrl);
  if (meta.serverOrigin && targetOrigin && meta.serverOrigin !== targetOrigin) {
    return null;
  }

  const record = await localDb.getAuthProfile(meta.profileKey);
  if (!record || !record.isActive || record.user?.isActive === false) return null;

  return {
    user: record.user,
    customerProfile: record.customerProfile || null,
    representativeProfile: record.representativeProfile || null,
    lastVerifiedAt: record.lastVerifiedAt,
  };
}

export async function clearLastVerifiedOfflineSession(userId?: string): Promise<void> {
  await localDb.setMeta(LAST_VERIFIED_META_KEY, null);
  if (userId) {
    const all = await localDb.listAuthProfiles();
    for (const p of all) {
      if (p.userId === userId) {
        // Keep PBKDF2 verifier on device if user simply signed out? Wait:
        // If explicit logout or account deactivation:
        // On explicit logout, clearing LAST_VERIFIED_META_KEY prevents auto-restore on reload
        // while keeping verifier allows verified user to re-authenticate offline with password if needed;
        // On revocation/deactivation we explicitly call revokeOfflineUser().
      }
    }
  }
}

export async function revokeOfflineUser(userId: string): Promise<void> {
  await localDb.setMeta(LAST_VERIFIED_META_KEY, null);
  const all = await localDb.listAuthProfiles();
  for (const p of all) {
    if (p.userId === userId) {
      await localDb.deleteAuthProfile(p.profileKey);
    }
  }
}

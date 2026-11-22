import type { Customer, Representative, User, UserRole } from '../types';
import { getKV, setKV } from './localDb';
import { getOrCreatePersistentDeviceId, getPref, setPref } from './native';
import { normalizeServerOrigin } from './offlineAuth';

const VAULT_NAMESPACE = 'account_vault';
const VAULT_RECORDS_KEY = 'saved_accounts_v1';
const ACTIVE_ACCOUNT_PREF_KEY = 'awlad_selim_active_account_id_v1';
const RUNTIME_UNLOCKED_KEY = 'awlad_selim_runtime_unlocked_uid';
const ACCOUNT_INDEX_LS_KEY = 'awlad_selim_saved_accounts_meta_v1';

export type SavedAccountSessionStatus = 'active' | 'logged_out' | 'expired' | 'revoked';

export interface SavedDeviceAccount {
  userId: string;
  username: string;
  fullName: string;
  role: UserRole;
  jobTitle?: string;
  shopName?: string;
  avatarPhoto?: string;
  serverOrigin: string;
  installationId?: string;
  deviceId: string;
  accessToken?: string;
  refreshToken?: string;
  sessionStatus: SavedAccountSessionStatus;
  lastLoginAt: string;
  lastVerifiedAt?: string;
  lastError?: string;
}

function getSafeSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage;
    }
  } catch {
    // ignore restricted sessionStorage contexts
  }
  return null;
}

export function hasRuntimeSessionStorage(): boolean {
  return getSafeSessionStorage() !== null;
}

export function getRuntimeUnlockedAccountId(): string | null {
  const ss = getSafeSessionStorage();
  if (!ss) return null;
  try {
    const val = ss.getItem(RUNTIME_UNLOCKED_KEY);
    return val ? val.trim() : null;
  } catch {
    return null;
  }
}

export function setRuntimeUnlockedAccountId(userId: string | null): void {
  const ss = getSafeSessionStorage();
  if (!ss) return;
  try {
    if (!userId) {
      ss.removeItem(RUNTIME_UNLOCKED_KEY);
    } else {
      ss.setItem(RUNTIME_UNLOCKED_KEY, String(userId).trim());
    }
  } catch {
    // ignore
  }
}

export async function getActiveAccountId(): Promise<string | null> {
  const val = await getPref(ACTIVE_ACCOUNT_PREF_KEY);
  return val ? val.trim() : null;
}

export function getActiveAccountIdSync(): string | null {
  try {
    const val = localStorage.getItem(ACTIVE_ACCOUNT_PREF_KEY);
    return val ? val.trim() : null;
  } catch {
    return null;
  }
}

export async function setActiveAccountId(userId: string | null): Promise<void> {
  if (!userId) {
    try {
      localStorage.removeItem(ACTIVE_ACCOUNT_PREF_KEY);
    } catch {
      // ignore
    }
    await setPref(ACTIVE_ACCOUNT_PREF_KEY, '');
    return;
  }
  await setPref(ACTIVE_ACCOUNT_PREF_KEY, String(userId).trim());
}

function stripSensitiveTokensForDisplayMeta(records: SavedDeviceAccount[]): Array<Omit<SavedDeviceAccount, 'accessToken' | 'refreshToken'>> {
  return records.map(({ accessToken: _a, refreshToken: _r, ...rest }) => rest);
}

function persistDisplayMetaCache(records: SavedDeviceAccount[]): void {
  try {
    localStorage.setItem(ACCOUNT_INDEX_LS_KEY, JSON.stringify(stripSensitiveTokensForDisplayMeta(records)));
  } catch {
    // ignore storage quota errors
  }
}

async function loadRawAccounts(): Promise<SavedDeviceAccount[]> {
  const fromVault = await getKV<SavedDeviceAccount[]>(VAULT_NAMESPACE, VAULT_RECORDS_KEY);
  if (Array.isArray(fromVault)) {
    return fromVault;
  }
  return [];
}

async function saveRawAccounts(records: SavedDeviceAccount[]): Promise<void> {
  const sorted = [...records].sort((a, b) => String(b.lastLoginAt || '').localeCompare(String(a.lastLoginAt || '')));
  await setKV(VAULT_NAMESPACE, VAULT_RECORDS_KEY, sorted);
  persistDisplayMetaCache(sorted);
}

export async function listSavedAccounts(serverUrl?: string): Promise<SavedDeviceAccount[]> {
  const all = await loadRawAccounts();
  const targetOrigin = serverUrl !== undefined ? normalizeServerOrigin(serverUrl) : null;
  const filtered = targetOrigin
    ? all.filter((entry) => !entry.serverOrigin || entry.serverOrigin === targetOrigin)
    : all;
  return [...filtered].sort((a, b) => String(b.lastLoginAt || '').localeCompare(String(a.lastLoginAt || '')));
}

export async function getSavedAccount(userId: string): Promise<SavedDeviceAccount | null> {
  if (!userId) return null;
  const all = await loadRawAccounts();
  return all.find((item) => item.userId === userId) || null;
}

export async function upsertSavedAccount(params: {
  serverUrl: string;
  installationId?: string;
  user: User;
  customerProfile?: Customer | null;
  representativeProfile?: Representative | null;
  accessToken?: string;
  refreshToken?: string;
  sessionStatus?: SavedAccountSessionStatus;
  lastError?: string;
}): Promise<SavedDeviceAccount> {
  const { user, customerProfile, representativeProfile } = params;
  const serverOrigin = normalizeServerOrigin(params.serverUrl);
  const all = await loadRawAccounts();
  const existingIdx = all.findIndex((item) => item.userId === user.id);
  const existing = existingIdx >= 0 ? all[existingIdx] : null;
  const nowIso = new Date().toISOString();

  const avatarPhoto =
    customerProfile?.shopPhoto ||
    customerProfile?.photo ||
    existing?.avatarPhoto ||
    undefined;

  const nextEntry: SavedDeviceAccount = {
    userId: user.id,
    username: user.username,
    fullName: user.fullName || customerProfile?.name || representativeProfile?.name || user.username,
    role: user.role,
    jobTitle: user.jobTitle || existing?.jobTitle,
    shopName: customerProfile?.shopName || existing?.shopName,
    avatarPhoto,
    serverOrigin,
    installationId: String(params.installationId || existing?.installationId || '').trim() || undefined,
    deviceId: getOrCreatePersistentDeviceId(),
    accessToken: params.accessToken !== undefined ? params.accessToken : existing?.accessToken,
    refreshToken: params.refreshToken !== undefined ? params.refreshToken : existing?.refreshToken,
    sessionStatus: params.sessionStatus || 'active',
    lastLoginAt: nowIso,
    lastVerifiedAt: nowIso,
    lastError: params.lastError,
  };

  if (existingIdx >= 0) {
    all[existingIdx] = nextEntry;
  } else {
    all.unshift(nextEntry);
  }
  await saveRawAccounts(all);
  await setActiveAccountId(user.id);
  return nextEntry;
}

export async function updateSavedAccountTokens(
  userId: string,
  tokens: { accessToken: string; refreshToken: string } | null,
  extra?: Partial<Pick<SavedDeviceAccount, 'sessionStatus' | 'lastVerifiedAt' | 'lastError' | 'fullName' | 'role' | 'avatarPhoto' | 'shopName'>>
): Promise<void> {
  if (!userId) return;
  const all = await loadRawAccounts();
  const idx = all.findIndex((item) => item.userId === userId);
  if (idx < 0) return;
  all[idx] = {
    ...all[idx],
    accessToken: tokens ? tokens.accessToken : undefined,
    refreshToken: tokens ? tokens.refreshToken : undefined,
    ...(extra || {}),
  };
  await saveRawAccounts(all);
}

export async function markSavedAccountStatus(
  userId: string,
  sessionStatus: SavedAccountSessionStatus,
  lastError?: string
): Promise<void> {
  if (!userId) return;
  const all = await loadRawAccounts();
  const idx = all.findIndex((item) => item.userId === userId);
  if (idx < 0) return;
  const clearTokens = sessionStatus === 'logged_out' || sessionStatus === 'revoked' || sessionStatus === 'expired';
  all[idx] = {
    ...all[idx],
    sessionStatus,
    lastError,
    ...(clearTokens ? { accessToken: undefined, refreshToken: undefined } : {}),
  };
  await saveRawAccounts(all);
}

export async function removeSavedAccount(userId: string): Promise<void> {
  if (!userId) return;
  const all = await loadRawAccounts();
  const next = all.filter((item) => item.userId !== userId);
  await saveRawAccounts(next);
  const activeId = await getActiveAccountId();
  if (activeId === userId) {
    await setActiveAccountId(null);
  }
  if (getRuntimeUnlockedAccountId() === userId) {
    setRuntimeUnlockedAccountId(null);
  }
}

export async function clearSavedAccountsForServerMismatch(
  serverUrl: string,
  newInstallationId: string
): Promise<void> {
  const targetOrigin = normalizeServerOrigin(serverUrl);
  const cleanNewId = String(newInstallationId || '').trim();
  if (!cleanNewId) return;
  const all = await loadRawAccounts();
  const kept = all.filter(
    (entry) =>
      entry.serverOrigin !== targetOrigin ||
      !entry.installationId ||
      entry.installationId === cleanNewId
  );
  if (kept.length !== all.length) {
    await saveRawAccounts(kept);
  }
}

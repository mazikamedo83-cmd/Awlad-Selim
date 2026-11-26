import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Customer, CustomerPhoneEntry, MobileConfig, Representative, User, UserRole, UserShortcutItem } from '../types';
import {
  DEFAULT_DB_UNAVAILABLE_MESSAGE,
  apiRequest,
  detectModeFromUrl,
  getConfiguredApiBaseUrl,
  getStoredConnectionProfiles,
  getStoredInstallationId,
  getStoredTokens,
  hydrateServerUrlFromNative,
  isDatabaseUnavailableError,
  saveStoredTokens,
  saveStoredTokensAsync,
  setAuthExpiredHandler,
  setStoredInstallationIdAsync,
  subscribeServerDbStatus,
} from '../services/api';
import { getClientDeviceDescriptor, isElectronDesktop, isNativeCapacitor } from '../services/native';
import { clearReadCache, purgeLegacyLocalDatabaseCache } from '../services/storage';
import {
  clearLastVerifiedOfflineSession,
  refreshCachedUserAuthorization,
  restoreLastVerifiedOfflineSession,
  restoreOfflineSessionByUserId,
  revokeOfflineUser,
  saveVerifiedOnlineCredentials,
  verifyOfflineLogin,
} from '../services/offlineAuth';
import {
  SavedDeviceAccount,
  clearSavedAccountsForServerMismatch,
  getRuntimeUnlockedAccountId,
  getSavedAccount,
  hasRuntimeSessionStorage,
  listSavedAccounts,
  markSavedAccountStatus,
  removeSavedAccount,
  setActiveAccountId,
  setRuntimeUnlockedAccountId,
  updateSavedAccountTokens,
  upsertSavedAccount,
} from '../services/accountVault';
import { logDiagnostic } from '../services/diagnostics';
import { resetDashboardBalancesSessionStorage, usePreferences } from './PreferencesContext';
import { tr } from '../i18n/translator';

export interface PairingBannerMessage {
  type: 'success' | 'warning' | 'error';
  message: string;
}

export const DEFAULT_MOBILE_CONFIG: MobileConfig = {
  enableCustomerApp: true,
  enableRepApp: true,
  allowCustomerPriceView: true,
  requireOrderApproval: true,
};

export interface AuthSessionStateActions {
  setCurrentUser: (user: User | null) => void;
  setCustomerProfile: (profile: Customer | null) => void;
  setRepresentativeProfile: (profile: Representative | null) => void;
  setMobileConfig: (config: MobileConfig) => void;
  setLinkWarning: (warning: string | null) => void;
  setSessionExpiredMessage: (msg: string | null) => void;
  setIsDatabaseUnavailable: (unavailable: boolean) => void;
  setDatabaseUnavailableMessage: (msg: string | null) => void;
  setNeedsAdminSetup: (needed: boolean) => void;
  setIsOfflineSession: (offline: boolean) => void;
  setPermissionsMayBeStale: (stale: boolean) => void;
  setLastVerifiedAt: (iso: string | null) => void;
  setIsLoading: (loading: boolean) => void;
}

export interface AuthSessionCheckDeps {
  apiRequest: typeof apiRequest;
  getConfiguredApiBaseUrl: typeof getConfiguredApiBaseUrl;
  getStoredInstallationId: typeof getStoredInstallationId;
  getStoredTokens: typeof getStoredTokens;
  hydrateServerUrlFromNative: typeof hydrateServerUrlFromNative;
  saveStoredTokens: typeof saveStoredTokens;
  setStoredInstallationIdAsync: typeof setStoredInstallationIdAsync;
  isNativeCapacitor: typeof isNativeCapacitor;
  isElectronDesktop: typeof isElectronDesktop;
  clearReadCache: typeof clearReadCache;
  purgeLegacyLocalDatabaseCache: typeof purgeLegacyLocalDatabaseCache;
  clearLastVerifiedOfflineSession: typeof clearLastVerifiedOfflineSession;
  refreshCachedUserAuthorization: typeof refreshCachedUserAuthorization;
  restoreLastVerifiedOfflineSession: typeof restoreLastVerifiedOfflineSession;
  revokeOfflineUser: typeof revokeOfflineUser;
}

const DEFAULT_AUTH_SESSION_DEPS: AuthSessionCheckDeps = {
  apiRequest,
  getConfiguredApiBaseUrl,
  getStoredInstallationId,
  getStoredTokens,
  hydrateServerUrlFromNative,
  saveStoredTokens,
  setStoredInstallationIdAsync,
  isNativeCapacitor,
  isElectronDesktop,
  clearReadCache,
  purgeLegacyLocalDatabaseCache,
  clearLastVerifiedOfflineSession,
  refreshCachedUserAuthorization,
  restoreLastVerifiedOfflineSession,
  revokeOfflineUser,
};

export function isAuthSecurityRejectionError(err: any): boolean {
  const code = String(err?.code || '');
  return (
    err?.status === 401 ||
    code === 'SESSION_REVOKED' ||
    code === 'DEVICE_REVOKED' ||
    code === 'ACCOUNT_DEACTIVATED' ||
    code === 'ACCOUNT_SUSPENDED' ||
    code === 'INVALID_TOKEN' ||
    code === 'UNAUTHORIZED'
  );
}

export function clearDashboardPrivacyMasks(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('awlad_selim_dashboard_masked_groups_v1');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('awlad:privacy-reset'));
    }
  } catch {
    // ignore
  }
}

export function createAuthExpiredCallback(
  actions: Pick<
    AuthSessionStateActions,
    | 'setCurrentUser'
    | 'setCustomerProfile'
    | 'setRepresentativeProfile'
    | 'setLinkWarning'
    | 'setIsOfflineSession'
    | 'setPermissionsMayBeStale'
    | 'setLastVerifiedAt'
    | 'setIsDatabaseUnavailable'
    | 'setDatabaseUnavailableMessage'
    | 'setSessionExpiredMessage'
  >,
  cleanup?: {
    getCurrentUserId?: () => string | null;
    revokeOfflineUser?: typeof revokeOfflineUser;
    clearLastVerifiedOfflineSession?: typeof clearLastVerifiedOfflineSession;
    clearReadCache?: typeof clearReadCache;
    onAccountStatusMarked?: (userId: string, message?: string) => void;
  }
) {
  return (message?: string) => {
    clearDashboardPrivacyMasks();
    logDiagnostic({
      category: 'auth',
      severity: 'warning',
      source: 'auth.sessionExpired',
      message: message ? tr(message) : tr('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.', 'Session expired, please sign in again.'),
    });
    const uid = cleanup?.getCurrentUserId?.();
    if (uid && cleanup?.revokeOfflineUser) {
      cleanup.revokeOfflineUser(uid).catch(() => {});
    } else if (cleanup?.clearLastVerifiedOfflineSession) {
      cleanup.clearLastVerifiedOfflineSession().catch(() => {});
    }
    if (uid) {
      markSavedAccountStatus(uid, 'expired', message).catch(() => {});
      setRuntimeUnlockedAccountId(null);
      cleanup?.onAccountStatusMarked?.(uid, message);
      cleanup?.clearReadCache?.(uid);
    } else {
      cleanup?.clearReadCache?.();
    }
    actions.setCurrentUser(null);
    actions.setCustomerProfile(null);
    actions.setRepresentativeProfile(null);
    actions.setLinkWarning(null);
    actions.setIsOfflineSession(false);
    actions.setPermissionsMayBeStale(false);
    actions.setLastVerifiedAt(null);
    actions.setIsDatabaseUnavailable(false);
    actions.setDatabaseUnavailableMessage(null);
    actions.setSessionExpiredMessage(message ? tr(message) : tr('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.', 'Session expired, please sign in again.'));
    resetDashboardBalancesSessionStorage();
  };
}

export async function executeAuthSessionCheck(params: {
  getCurrentUser: () => User | null;
  actions: AuthSessionStateActions;
  isStale?: () => boolean;
  deps?: Partial<AuthSessionCheckDeps>;
  onSavedAccountsLoaded?: (accounts: SavedDeviceAccount[]) => void;
}): Promise<void> {
  const { getCurrentUser, actions, isStale = () => false, onSavedAccountsLoaded } = params;
  const deps: AuthSessionCheckDeps = { ...DEFAULT_AUTH_SESSION_DEPS, ...(params.deps || {}) };

  deps.purgeLegacyLocalDatabaseCache();
  await deps.hydrateServerUrlFromNative();
  if (isStale()) return;

  const baseUrl = deps.getConfiguredApiBaseUrl();
  const prevInstallationId = deps.getStoredInstallationId();
  let serverInstallationId = '';
  let serverUnreachable = false;
  let statusDbUnavailable = false;
  let statusDbMessage: string | null = null;

  const resetToUnauthenticated = (
    setupNeeded: boolean,
    preserveDbAlert = false,
    dbMessage: string | null = null
  ) => {
    actions.setCurrentUser(null);
    actions.setCustomerProfile(null);
    actions.setRepresentativeProfile(null);
    actions.setLinkWarning(null);
    actions.setIsOfflineSession(false);
    actions.setPermissionsMayBeStale(false);
    actions.setLastVerifiedAt(null);
    actions.setNeedsAdminSetup(setupNeeded);
    if (preserveDbAlert) {
      actions.setIsDatabaseUnavailable(true);
      actions.setDatabaseUnavailableMessage(dbMessage ? tr(dbMessage) : tr(DEFAULT_DB_UNAVAILABLE_MESSAGE));
      actions.setSessionExpiredMessage(null);
    } else {
      actions.setIsDatabaseUnavailable(false);
      actions.setDatabaseUnavailableMessage(null);
    }
    resetDashboardBalancesSessionStorage();
    actions.setIsLoading(false);
  };

  const handleDbUnavailable = async (dbMessage?: string | null) => {
    const resolvedMessage = dbMessage ? tr(dbMessage) : tr(DEFAULT_DB_UNAVAILABLE_MESSAGE);
    actions.setSessionExpiredMessage(null);
    actions.setIsOfflineSession(false);
    actions.setIsDatabaseUnavailable(true);
    actions.setDatabaseUnavailableMessage(resolvedMessage);

    if (!getCurrentUser()) {
      const restored = await deps
        .restoreLastVerifiedOfflineSession(baseUrl, serverInstallationId || prevInstallationId)
        .catch(() => null);
      if (isStale()) return;
      if (restored) {
        actions.setCurrentUser(restored.user);
        actions.setCustomerProfile(restored.customerProfile);
        actions.setRepresentativeProfile(restored.representativeProfile);
        actions.setIsOfflineSession(false);
        actions.setPermissionsMayBeStale(true);
        actions.setLastVerifiedAt(restored.lastVerifiedAt);
        actions.setNeedsAdminSetup(false);
      }
    }
    actions.setIsLoading(false);
  };

  try {
    try {
      const statusRes = await deps.apiRequest<{
        ok: boolean;
        needsAdminSetup: boolean;
        installationId?: string;
      }>('/api/auth/status', {
        skipAuth: true,
      });
      if (isStale()) return;
      serverInstallationId = String(statusRes.installationId || '').trim();
      const setupNeeded = Boolean(statusRes.needsAdminSetup);
      actions.setNeedsAdminSetup(setupNeeded);

      if (setupNeeded) {
        deps.saveStoredTokens(null);
        await deps.clearLastVerifiedOfflineSession().catch(() => {});
        deps.clearReadCache();
        if (serverInstallationId) {
          await deps.setStoredInstallationIdAsync(serverInstallationId).catch(() => {});
          await clearSavedAccountsForServerMismatch(baseUrl, serverInstallationId).catch(() => {});
        }
        if (onSavedAccountsLoaded) {
          onSavedAccountsLoaded(await listSavedAccounts(baseUrl).catch(() => []));
        }
        resetToUnauthenticated(true);
        return;
      }

      if (prevInstallationId && serverInstallationId && prevInstallationId !== serverInstallationId) {
        deps.saveStoredTokens(null);
        await deps.clearLastVerifiedOfflineSession().catch(() => {});
        deps.clearReadCache();
        await deps.setStoredInstallationIdAsync(serverInstallationId).catch(() => {});
        await clearSavedAccountsForServerMismatch(baseUrl, serverInstallationId).catch(() => {});
        if (onSavedAccountsLoaded) {
          onSavedAccountsLoaded(await listSavedAccounts(baseUrl).catch(() => []));
        }
        resetToUnauthenticated(false);
        return;
      }
    } catch (err: any) {
      if (isStale()) return;
      if (isDatabaseUnavailableError(err)) {
        statusDbUnavailable = true;
        statusDbMessage = err?.message || DEFAULT_DB_UNAVAILABLE_MESSAGE;
      } else if (err?.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        serverUnreachable = true;
      }
    }

    const vaultAccounts = await listSavedAccounts(baseUrl).catch(() => [] as SavedDeviceAccount[]);
    if (isStale()) return;
    onSavedAccountsLoaded?.(vaultAccounts);

    // Cold-boot / multi-account chooser policy: if saved accounts exist on this device and either
    // >1 account is stored or sessionStorage hasn't unlocked an account yet, present chooser cleanly.
    const runtimeUnlockedUid = getRuntimeUnlockedAccountId();
    if (
      (hasRuntimeSessionStorage() || vaultAccounts.length > 1) &&
      !runtimeUnlockedUid &&
      !getCurrentUser() &&
      vaultAccounts.length > 0
    ) {
      if (serverInstallationId && !prevInstallationId) {
        await deps.setStoredInstallationIdAsync(serverInstallationId).catch(() => {});
      }
      resetToUnauthenticated(false, statusDbUnavailable, statusDbMessage);
      return;
    }

    const tokens = deps.getStoredTokens();
    const canProbeWebCookieSession =
      !tokens?.accessToken &&
      !deps.isElectronDesktop() &&
      !deps.isNativeCapacitor() &&
      hasRuntimeSessionStorage() &&
      vaultAccounts.length <= 1;

    if (!tokens?.accessToken && !canProbeWebCookieSession) {
      if (serverInstallationId && !prevInstallationId) {
        await deps.setStoredInstallationIdAsync(serverInstallationId).catch(() => {});
      }
      resetToUnauthenticated(false, statusDbUnavailable, statusDbMessage);
      return;
    }

    if (statusDbUnavailable) {
      await handleDbUnavailable(statusDbMessage);
      return;
    }

    try {
      const me = await deps.apiRequest<{
        ok: boolean;
        installationId?: string;
        user: User;
        customerProfile: Customer | null;
        representativeProfile: Representative | null;
        mobileConfig?: MobileConfig;
        linkWarning: string | null;
      }>('/api/auth/me');
      if (isStale()) return;
      const resolvedInstallationId = String(
        me.installationId || serverInstallationId || prevInstallationId || ''
      ).trim();
      if (resolvedInstallationId) {
        await deps.setStoredInstallationIdAsync(resolvedInstallationId).catch(() => {});
      }
      actions.setCurrentUser(me.user);
      actions.setCustomerProfile(me.customerProfile || null);
      actions.setRepresentativeProfile(me.representativeProfile || null);
      actions.setMobileConfig(me.mobileConfig || DEFAULT_MOBILE_CONFIG);
      actions.setLinkWarning(me.linkWarning || null);
      actions.setSessionExpiredMessage(null);
      actions.setIsDatabaseUnavailable(false);
      actions.setDatabaseUnavailableMessage(null);
      actions.setNeedsAdminSetup(false);
      actions.setIsOfflineSession(false);
      actions.setPermissionsMayBeStale(false);
      const nowIso = new Date().toISOString();
      actions.setLastVerifiedAt(nowIso);
      setRuntimeUnlockedAccountId(me.user.id);
      const latestTokens = deps.getStoredTokens();
      if (latestTokens?.refreshToken || (!deps.isElectronDesktop() && !deps.isNativeCapacitor())) {
        upsertSavedAccount({
          serverUrl: baseUrl,
          installationId: resolvedInstallationId,
          user: me.user,
          customerProfile: me.customerProfile || null,
          representativeProfile: me.representativeProfile || null,
          accessToken: latestTokens?.accessToken || '',
          refreshToken: latestTokens?.refreshToken || '',
          sessionStatus: 'active',
        })
          .then(async () => {
            if (onSavedAccountsLoaded) {
              onSavedAccountsLoaded(await listSavedAccounts(baseUrl).catch(() => []));
            }
          })
          .catch(() => {});
      }
      deps
        .refreshCachedUserAuthorization({
          serverUrl: baseUrl,
          installationId: resolvedInstallationId,
          user: me.user,
          customerProfile: me.customerProfile || null,
          representativeProfile: me.representativeProfile || null,
        })
        .catch(() => {});
    } catch (err: any) {
      if (isStale()) return;
      if (isAuthSecurityRejectionError(err)) {
        const wasAnonymousCookieProbe = !tokens?.accessToken && canProbeWebCookieSession && !getCurrentUser();
        const prevUid = getCurrentUser()?.id || null;
        if (prevUid) {
          await deps.revokeOfflineUser(prevUid).catch(() => {});
          await markSavedAccountStatus(
            prevUid,
            err?.status === 403 ? 'revoked' : 'expired',
            err?.message
          ).catch(() => {});
        } else if (!wasAnonymousCookieProbe) {
          await deps.clearLastVerifiedOfflineSession().catch(() => {});
        }
        setRuntimeUnlockedAccountId(null);
        deps.saveStoredTokens(null);
        actions.setCurrentUser(null);
        actions.setCustomerProfile(null);
        actions.setRepresentativeProfile(null);
        actions.setLinkWarning(null);
        actions.setIsOfflineSession(false);
        actions.setPermissionsMayBeStale(false);
        actions.setLastVerifiedAt(null);
        actions.setIsDatabaseUnavailable(false);
        actions.setDatabaseUnavailableMessage(null);
        resetDashboardBalancesSessionStorage();
        if (onSavedAccountsLoaded) {
          onSavedAccountsLoaded(await listSavedAccounts(baseUrl).catch(() => []));
        }
        if (wasAnonymousCookieProbe) {
          actions.setSessionExpiredMessage(null);
        } else if (
          err?.code === 'DEVICE_REVOKED' ||
          err?.code === 'ACCOUNT_DEACTIVATED' ||
          err?.code === 'ACCOUNT_SUSPENDED' ||
          err?.code === 'SESSION_REVOKED'
        ) {
          actions.setSessionExpiredMessage(err.message);
        } else if (err?.status === 401) {
          actions.setSessionExpiredMessage(err?.message ? tr(err.message) : tr('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.', 'Session expired, please sign in again.'));
        }
      } else if (isDatabaseUnavailableError(err)) {
        await handleDbUnavailable(err?.message ? tr(err.message) : tr(DEFAULT_DB_UNAVAILABLE_MESSAGE));
      } else if (
        (err?.status === 0 || serverUnreachable) &&
        (deps.isNativeCapacitor() || deps.isElectronDesktop()) &&
        Boolean(tokens?.refreshToken)
      ) {
        actions.setIsDatabaseUnavailable(false);
        actions.setDatabaseUnavailableMessage(null);
        const restored = await deps
          .restoreLastVerifiedOfflineSession(baseUrl, serverInstallationId || prevInstallationId)
          .catch(() => null);
        if (isStale()) return;
        if (restored) {
          setRuntimeUnlockedAccountId(restored.user.id);
          actions.setCurrentUser(restored.user);
          actions.setCustomerProfile(restored.customerProfile);
          actions.setRepresentativeProfile(restored.representativeProfile);
          actions.setIsOfflineSession(true);
          actions.setPermissionsMayBeStale(true);
          actions.setLastVerifiedAt(restored.lastVerifiedAt);
          actions.setNeedsAdminSetup(false);
        } else {
          resetToUnauthenticated(false);
        }
      } else {
        actions.setIsDatabaseUnavailable(false);
        actions.setDatabaseUnavailableMessage(null);
        actions.setCurrentUser(null);
        actions.setCustomerProfile(null);
        actions.setRepresentativeProfile(null);
        actions.setLinkWarning(null);
        actions.setIsOfflineSession(false);
        actions.setPermissionsMayBeStale(false);
        actions.setLastVerifiedAt(null);
      }
    }
  } finally {
    if (!isStale()) {
      actions.setIsLoading(false);
    }
  }
}

interface AuthContextType {
  currentUser: User | null;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
  mobileConfig: MobileConfig;
  linkWarning: string | null;
  sessionExpiredMessage: string | null;
  isDatabaseUnavailable: boolean;
  databaseUnavailableMessage: string | null;
  pairingBanner: PairingBannerMessage | null;
  setPairingBanner: (banner: PairingBannerMessage | null) => void;
  clearPairingBanner: () => void;
  needsAdminSetup: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOfflineSession: boolean;
  lastVerifiedAt: string | null;
  permissionsMayBeStale: boolean;
  savedAccounts: SavedDeviceAccount[];
  isAccountSwitcherOpen: boolean;
  setIsAccountSwitcherOpen: (open: boolean) => void;
  refreshSavedAccounts: () => Promise<void>;
  resumeSavedAccount: (userId: string) => Promise<{
    success: boolean;
    needsPassword?: boolean;
    username?: string;
    error?: string;
  }>;
  removeSavedAccountFromDevice: (userId: string) => Promise<{ serverRevoked: boolean; warning?: string }>;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; requirePasswordChange?: boolean }>;
  registerAccount: (payload: {
    role: 'customer' | 'representative';
    fullName: string;
    username: string;
    password: string;
    phone: string;
    address?: string;
    shopName?: string;
    governorate?: string;
    area?: string;
    city?: string;
    latitude?: number | null;
    longitude?: number | null;
    locationCapturedAt?: string | null;
    shopPhoto?: string;
    phones?: CustomerPhoneEntry[];
    vehicleNumber?: string;
    geoCoordinates?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  bootstrapAdmin: (payload: { fullName: string; username: string; password: string; phone?: string; companyName?: string }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<{ serverRevoked: boolean; warning?: string }>;
  handleServerAuthRevoked: (reason?: string) => Promise<void>;
  updatePassword: (newPassword: string, currentPassword?: string) => Promise<{ success: boolean; error?: string }>;
  updateUserShortcuts: (shortcuts: UserShortcutItem[]) => Promise<{ success: boolean; shortcuts?: UserShortcutItem[]; error?: string }>;
  refreshAuthContext: () => Promise<void>;
  hasPermission: (permissionKey: keyof User['permissions']) => boolean;
  hasRole: (roles: UserRole[]) => boolean;
  clearSessionExpiredMessage: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { resetDashboardBalancesVisibility } = usePreferences();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [customerProfile, setCustomerProfile] = useState<Customer | null>(null);
  const [representativeProfile, setRepresentativeProfile] = useState<Representative | null>(null);
  const [mobileConfig, setMobileConfig] = useState<MobileConfig>(DEFAULT_MOBILE_CONFIG);
  const [linkWarning, setLinkWarning] = useState<string | null>(null);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const [isDatabaseUnavailable, setIsDatabaseUnavailable] = useState<boolean>(false);
  const [databaseUnavailableMessage, setDatabaseUnavailableMessage] = useState<string | null>(null);
  const [pairingBanner, setPairingBanner] = useState<PairingBannerMessage | null>(null);
  const [needsAdminSetup, setNeedsAdminSetup] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [permissionsMayBeStale, setPermissionsMayBeStale] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<SavedDeviceAccount[]>([]);
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);

  const currentUserRef = useRef<User | null>(null);
  currentUserRef.current = currentUser;
  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = currentUser?.id || null;
  const isDatabaseUnavailableRef = useRef<boolean>(false);
  isDatabaseUnavailableRef.current = isDatabaseUnavailable;
  const checkSeqRef = useRef(0);
  const isCheckingRef = useRef(false);

  const refreshSavedAccounts = useCallback(async () => {
    const baseUrl = getConfiguredApiBaseUrl();
    const list = await listSavedAccounts(baseUrl).catch(() => []);
    setSavedAccounts(list);
  }, []);

  const checkStatusAndSession = useCallback(async () => {
    const seq = ++checkSeqRef.current;
    isCheckingRef.current = true;
    try {
      await executeAuthSessionCheck({
        getCurrentUser: () => currentUserRef.current,
        isStale: () => seq !== checkSeqRef.current,
        onSavedAccountsLoaded: (accounts) => {
          if (seq === checkSeqRef.current) setSavedAccounts(accounts);
        },
        actions: {
          setCurrentUser,
          setCustomerProfile,
          setRepresentativeProfile,
          setMobileConfig,
          setLinkWarning,
          setSessionExpiredMessage,
          setIsDatabaseUnavailable,
          setDatabaseUnavailableMessage,
          setNeedsAdminSetup,
          setIsOfflineSession,
          setPermissionsMayBeStale,
          setLastVerifiedAt,
          setIsLoading,
        },
      });
    } finally {
      if (seq === checkSeqRef.current) {
        isCheckingRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    setAuthExpiredHandler(
      createAuthExpiredCallback(
        {
          setCurrentUser,
          setCustomerProfile,
          setRepresentativeProfile,
          setLinkWarning,
          setIsOfflineSession,
          setPermissionsMayBeStale,
          setLastVerifiedAt,
          setIsDatabaseUnavailable,
          setDatabaseUnavailableMessage,
          setSessionExpiredMessage,
        },
        {
          getCurrentUserId: () => currentUserIdRef.current,
          revokeOfflineUser,
          clearLastVerifiedOfflineSession,
          clearReadCache,
          onAccountStatusMarked: () => {
            refreshSavedAccounts().catch(() => {});
          },
        }
      )
    );

    const unsubscribeDbStatus = subscribeServerDbStatus((available, message) => {
      if (!available) {
        isDatabaseUnavailableRef.current = true;
        setIsDatabaseUnavailable(true);
        setDatabaseUnavailableMessage(message ? tr(message) : tr(DEFAULT_DB_UNAVAILABLE_MESSAGE));
        setSessionExpiredMessage(null);
      } else if (isDatabaseUnavailableRef.current) {
        if (!isCheckingRef.current) {
          checkStatusAndSession().catch(() => {});
        }
      }
    });

    checkStatusAndSession();
    return () => {
      setAuthExpiredHandler(null);
      unsubscribeDbStatus();
    };
  }, [checkStatusAndSession, refreshSavedAccounts]);

  useEffect(() => {
    if (!isDatabaseUnavailable) return;
    const timer = window.setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (!isCheckingRef.current) {
        checkStatusAndSession().catch(() => {});
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [isDatabaseUnavailable, checkStatusAndSession]);

  const persistActiveVaultAccount = useCallback(
    async (params: {
      baseUrl: string;
      installationId?: string;
      user: User;
      customerProfile: Customer | null;
      representativeProfile: Representative | null;
      accessToken: string;
      refreshToken: string;
    }) => {
      await upsertSavedAccount({
        serverUrl: params.baseUrl,
        installationId: params.installationId,
        user: params.user,
        customerProfile: params.customerProfile,
        representativeProfile: params.representativeProfile,
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        sessionStatus: 'active',
      });
      await refreshSavedAccounts();
    },
    [refreshSavedAccounts]
  );

  const resumeSavedAccount = async (
    userId: string
  ): Promise<{ success: boolean; needsPassword?: boolean; username?: string; error?: string }> => {
    const entry = await getSavedAccount(userId);
    if (!entry) {
      return { success: false, error: tr('الحساب غير موجود ضمن الحسابات المحفوظة على الجهاز.', 'Account not found among saved accounts on this device.') };
    }
    if (entry.sessionStatus !== 'active' || !entry.refreshToken) {
      const webPasswordHint =
        !entry.refreshToken && entry.sessionStatus === 'active'
          ? tr('لحماية جلسة الويب وعدم حفظ التوكنات في المتصفح، يرجى إدخال كلمة المرور لتأكيد الدخول.', 'To protect your web session without storing tokens in the browser, please enter your password to confirm login.')
          : undefined;
      return {
        success: false,
        needsPassword: true,
        username: entry.username,
        error:
          webPasswordHint ||
          (entry.sessionStatus === 'revoked'
            ? (entry.lastError ? tr(entry.lastError) : tr('تم إيقاف الجلسة أو سحب صلاحية هذا الجهاز من الإدارة.', 'Session disabled or device access revoked by administration.'))
            : entry.sessionStatus === 'logged_out'
            ? tr('تم تسجيل الخروج من هذا الحساب سابقاً. أدخل كلمة المرور للدخول مجدداً.', 'Previously signed out of this account. Enter password to sign in again.')
            : tr('انتهت صلاحية الجلسة المحفوظة. أدخل كلمة المرور لتأكيد الدخول.', 'Saved session expired. Enter password to confirm login.')),
      };
    }

    const baseUrl = getConfiguredApiBaseUrl();
    const installationId = getStoredInstallationId();
    try {
      const refreshRes = await apiRequest<{
        ok: boolean;
        accessToken: string;
        refreshToken: string;
      }>('/api/auth/refresh', {
        method: 'POST',
        body: { refreshToken: entry.refreshToken },
        skipAuth: true,
      });

      const nextTokens = {
        accessToken: refreshRes.accessToken,
        refreshToken: refreshRes.refreshToken,
      };
      try {
        await saveStoredTokensAsync(nextTokens);
      } catch (vaultErr: any) {
        return {
          success: false,
          error: vaultErr?.message ? tr(vaultErr.message) : tr('تعذر حفظ مفاتيح الجلسة في المخزن الآمن للنظام.', 'Failed to save session keys in the system secure vault.'),
        };
      }

      const me = await apiRequest<{
        ok: boolean;
        installationId?: string;
        user: User;
        customerProfile: Customer | null;
        representativeProfile: Representative | null;
        mobileConfig?: MobileConfig;
        linkWarning: string | null;
      }>('/api/auth/me');

      const resolvedInstallationId = String(me.installationId || installationId || entry.installationId || '').trim();
      if (resolvedInstallationId) {
        await setStoredInstallationIdAsync(resolvedInstallationId).catch(() => {});
      }

      setRuntimeUnlockedAccountId(me.user.id);
      await persistActiveVaultAccount({
        baseUrl,
        installationId: resolvedInstallationId,
        user: me.user,
        customerProfile: me.customerProfile || null,
        representativeProfile: me.representativeProfile || null,
        accessToken: nextTokens.accessToken,
        refreshToken: nextTokens.refreshToken,
      });

      await refreshCachedUserAuthorization({
        serverUrl: baseUrl,
        installationId: resolvedInstallationId,
        user: me.user,
        customerProfile: me.customerProfile || null,
        representativeProfile: me.representativeProfile || null,
      }).catch(() => {});

      setCurrentUser(me.user);
      setCustomerProfile(me.customerProfile || null);
      setRepresentativeProfile(me.representativeProfile || null);
      setMobileConfig(me.mobileConfig || DEFAULT_MOBILE_CONFIG);
      setLinkWarning(me.linkWarning || null);
      setSessionExpiredMessage(null);
      setIsDatabaseUnavailable(false);
      setDatabaseUnavailableMessage(null);
      setNeedsAdminSetup(false);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setLastVerifiedAt(new Date().toISOString());
      setIsAccountSwitcherOpen(false);
      return { success: true };
    } catch (err: any) {
      if (isAuthSecurityRejectionError(err)) {
        const status = err?.status === 403 ? 'revoked' : 'expired';
        await markSavedAccountStatus(userId, status, err?.message).catch(() => {});
        await revokeOfflineUser(userId).catch(() => {});
        if (getCurrentUserIdOrNull(currentUserRef.current) === userId || !currentUserRef.current) {
          saveStoredTokens(null);
        }
        await refreshSavedAccounts();
        return {
          success: false,
          needsPassword: true,
          username: entry.username,
          error: err?.message ? tr(err.message) : tr('انتهت صلاحية الجلسة المحفوظة، يرجى إدخال كلمة المرور.', 'Saved session expired, please enter your password.'),
        };
      }

      if (err?.status === 0 || isDatabaseUnavailableError(err)) {
        if (isDatabaseUnavailableError(err)) {
          setIsDatabaseUnavailable(true);
          setDatabaseUnavailableMessage(err?.message ? tr(err.message) : tr(DEFAULT_DB_UNAVAILABLE_MESSAGE));
        }
        const offlineUserSession = await restoreOfflineSessionByUserId(
          userId,
          baseUrl,
          installationId || entry.installationId || ''
        ).catch(() => null);
        if (offlineUserSession && (isNativeCapacitor() || isElectronDesktop() || isDatabaseUnavailableError(err))) {
          saveStoredTokens({
            accessToken: entry.accessToken || 'offline_cached_token',
            refreshToken: entry.refreshToken,
          });
          setRuntimeUnlockedAccountId(offlineUserSession.user.id);
          await setActiveAccountId(offlineUserSession.user.id);
          setCurrentUser(offlineUserSession.user);
          setCustomerProfile(offlineUserSession.customerProfile);
          setRepresentativeProfile(offlineUserSession.representativeProfile);
          setMobileConfig(DEFAULT_MOBILE_CONFIG);
          setLinkWarning(null);
          setSessionExpiredMessage(null);
          setNeedsAdminSetup(false);
          setIsOfflineSession(!isDatabaseUnavailableError(err));
          setPermissionsMayBeStale(true);
          setLastVerifiedAt(offlineUserSession.lastVerifiedAt);
          setIsAccountSwitcherOpen(false);
          return { success: true };
        }
      }

      return {
        success: false,
        error: err?.message ? tr(err.message) : tr('تعذر فتح الحساب المحفوظ الآن.', 'Unable to open the saved account right now.'),
      };
    }
  };

  const removeSavedAccountFromDevice = async (
    userId: string
  ): Promise<{ serverRevoked: boolean; warning?: string }> => {
    const isRemovingActive = currentUserRef.current?.id === userId;
    const entry = await getSavedAccount(userId).catch(() => null);
    let serverRevoked = true;
    let warning: string | undefined;
    if (entry?.refreshToken || isRemovingActive) {
      try {
        await apiRequest('/api/auth/logout', {
          method: 'POST',
          skipAuth: !isRemovingActive,
          body: entry?.refreshToken ? { refreshToken: entry.refreshToken } : {},
        });
      } catch {
        serverRevoked = false;
        warning = tr(
          'تمت إزالة الحساب محلياً، لكن تعذر إبلاغ السيرفر لإلغاء الجلسة عن بُعد بسبب عدم الاتصال.',
          'Account removed locally, but could not notify the server to revoke the remote session due to offline status.'
        );
      }
    }
    await removeSavedAccount(userId);
    await revokeOfflineUser(userId).catch(() => {});
    clearReadCache(userId);
    await refreshSavedAccounts();
    if (isRemovingActive) {
      clearDashboardPrivacyMasks();
      await saveStoredTokensAsync(null).catch(() => saveStoredTokens(null));
      setRuntimeUnlockedAccountId(null);
      setCurrentUser(null);
      setCustomerProfile(null);
      setRepresentativeProfile(null);
      setLinkWarning(null);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setLastVerifiedAt(null);
      setIsAccountSwitcherOpen(false);
      resetDashboardBalancesSessionStorage();
      resetDashboardBalancesVisibility();
    }
    return { serverRevoked, warning };
  };

  const login = async (
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string; requirePasswordChange?: boolean }> => {
    const descriptor = getClientDeviceDescriptor();
    const baseUrl = getConfiguredApiBaseUrl();
    const mode = detectModeFromUrl(baseUrl, getStoredConnectionProfiles());
    try {
      const res = await apiRequest<{
        ok: boolean;
        installationId?: string;
        accessToken: string;
        refreshToken: string;
        user: User;
        customerProfile: Customer | null;
        representativeProfile: Representative | null;
        mobileConfig?: MobileConfig;
        linkWarning: string | null;
      }>('/api/auth/login', {
        method: 'POST',
        body: {
          username: username.trim(),
          password,
          ...descriptor,
          connectionMode: mode,
          serverUrlUsed: baseUrl,
        },
        skipAuth: true,
      });

      const resolvedInstallationId = String(res.installationId || getStoredInstallationId() || '').trim();
      if (resolvedInstallationId) {
        await setStoredInstallationIdAsync(resolvedInstallationId).catch(() => {});
      }
      try {
        await saveStoredTokensAsync({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        await persistActiveVaultAccount({
          baseUrl,
          installationId: resolvedInstallationId,
          user: res.user,
          customerProfile: res.customerProfile || null,
          representativeProfile: res.representativeProfile || null,
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
        });
      } catch (vaultErr: any) {
        return {
          success: false,
          error: vaultErr?.message
            ? tr(vaultErr.message)
            : tr('تعذر حفظ بيانات الجلسة في المخزن الآمن للنظام. لم يتم تسجيل الدخول حفاظاً على أمان البيانات.', 'Failed to save session data in the system secure vault. Sign-in aborted to protect data security.'),
        };
      }

      setRuntimeUnlockedAccountId(res.user.id);
      await saveVerifiedOnlineCredentials({
        serverUrl: baseUrl,
        installationId: resolvedInstallationId,
        username: username.trim(),
        password,
        user: res.user,
        customerProfile: res.customerProfile || null,
        representativeProfile: res.representativeProfile || null,
      }).catch(() => {});

      setCurrentUser(res.user);
      setCustomerProfile(res.customerProfile || null);
      setRepresentativeProfile(res.representativeProfile || null);
      setMobileConfig(res.mobileConfig || DEFAULT_MOBILE_CONFIG);
      setLinkWarning(res.linkWarning || null);
      setSessionExpiredMessage(null);
      setIsDatabaseUnavailable(false);
      setDatabaseUnavailableMessage(null);
      setNeedsAdminSetup(false);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setLastVerifiedAt(new Date().toISOString());
      setIsAccountSwitcherOpen(false);

      return {
        success: true,
        requirePasswordChange: res.user.mustChangePassword === true,
      };
    } catch (err: any) {
      if (err?.status === 0) {
        const offlineRes = await verifyOfflineLogin({
          serverUrl: baseUrl,
          installationId: getStoredInstallationId(),
          username: username.trim(),
          password,
        });
        if (offlineRes.ok) {
          setRuntimeUnlockedAccountId(offlineRes.user.id);
          await setActiveAccountId(offlineRes.user.id).catch(() => {});
          setCurrentUser(offlineRes.user);
          setCustomerProfile(offlineRes.customerProfile);
          setRepresentativeProfile(offlineRes.representativeProfile);
          setMobileConfig(DEFAULT_MOBILE_CONFIG);
          setLinkWarning(null);
          setSessionExpiredMessage(null);
          setIsDatabaseUnavailable(false);
          setDatabaseUnavailableMessage(null);
          setNeedsAdminSetup(false);
          setIsOfflineSession(true);
          setPermissionsMayBeStale(true);
          setLastVerifiedAt(offlineRes.lastVerifiedAt);
          setIsAccountSwitcherOpen(false);
          return { success: true, requirePasswordChange: false };
        }
        return { success: false, error: offlineRes.error };
      }
      if (isDatabaseUnavailableError(err)) {
        setIsDatabaseUnavailable(true);
        setDatabaseUnavailableMessage(err?.message ? tr(err.message) : tr(DEFAULT_DB_UNAVAILABLE_MESSAGE));
        setSessionExpiredMessage(null);
      }
      const loginErr = err?.message ? tr(err.message) : tr('تعذر تسجيل الدخول', 'Failed to sign in');
      logDiagnostic({
        category: 'auth',
        severity: 'warning',
        source: 'auth.login',
        message: loginErr,
        details: { username: username.trim(), status: err?.status, code: err?.code },
      });
      return { success: false, error: loginErr };
    }
  };

  const registerAccount = async (payload: {
    role: 'customer' | 'representative';
    fullName: string;
    username: string;
    password: string;
    phone: string;
    address?: string;
    shopName?: string;
    governorate?: string;
    area?: string;
    city?: string;
    latitude?: number | null;
    longitude?: number | null;
    locationCapturedAt?: string | null;
    shopPhoto?: string;
    phones?: CustomerPhoneEntry[];
    vehicleNumber?: string;
    geoCoordinates?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const descriptor = getClientDeviceDescriptor();
    const baseUrl = getConfiguredApiBaseUrl();
    try {
      const res = await apiRequest<{
        ok: boolean;
        installationId?: string;
        accessToken: string;
        refreshToken: string;
        user: User;
        customerProfile: Customer | null;
        representativeProfile: Representative | null;
        mobileConfig?: MobileConfig;
        linkWarning: string | null;
      }>('/api/auth/register', {
        method: 'POST',
        body: {
          ...payload,
          username: payload.username.trim(),
          fullName: payload.fullName.trim(),
          phone: payload.phone.trim(),
          ...descriptor,
        },
        skipAuth: true,
      });

      const resolvedInstallationId = String(res.installationId || getStoredInstallationId() || '').trim();
      if (resolvedInstallationId) {
        await setStoredInstallationIdAsync(resolvedInstallationId).catch(() => {});
      }
      try {
        await saveStoredTokensAsync({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        await persistActiveVaultAccount({
          baseUrl,
          installationId: resolvedInstallationId,
          user: res.user,
          customerProfile: res.customerProfile || null,
          representativeProfile: res.representativeProfile || null,
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
        });
      } catch (vaultErr: any) {
        return {
          success: false,
          error: vaultErr?.message
            ? tr(vaultErr.message)
            : tr('تم إنشاء الحساب، لكن تعذر حفظ الجلسة في المخزن الآمن للنظام. يرجى إعادة المحاولة.', 'Account created, but failed to save session in the system secure vault. Please try again.'),
        };
      }

      setRuntimeUnlockedAccountId(res.user.id);
      await saveVerifiedOnlineCredentials({
        serverUrl: baseUrl,
        installationId: resolvedInstallationId,
        username: payload.username.trim(),
        password: payload.password,
        user: res.user,
        customerProfile: res.customerProfile || null,
        representativeProfile: res.representativeProfile || null,
      }).catch(() => {});

      setCurrentUser(res.user);
      setCustomerProfile(res.customerProfile || null);
      setRepresentativeProfile(res.representativeProfile || null);
      setMobileConfig(res.mobileConfig || DEFAULT_MOBILE_CONFIG);
      setLinkWarning(res.linkWarning || null);
      setSessionExpiredMessage(null);
      setIsDatabaseUnavailable(false);
      setDatabaseUnavailableMessage(null);
      setNeedsAdminSetup(false);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setLastVerifiedAt(new Date().toISOString());
      setIsAccountSwitcherOpen(false);

      return { success: true };
    } catch (err: any) {
      if (isDatabaseUnavailableError(err)) {
        setIsDatabaseUnavailable(true);
        setDatabaseUnavailableMessage(err?.message ? tr(err.message) : tr(DEFAULT_DB_UNAVAILABLE_MESSAGE));
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء الحساب الجديد', 'Failed to create new account') };
    }
  };

  const bootstrapAdmin = async (payload: {
    fullName: string;
    username: string;
    password: string;
    phone?: string;
    companyName?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      await apiRequest('/api/auth/bootstrap-admin', {
        method: 'POST',
        body: payload,
        skipAuth: true,
      });
      setNeedsAdminSetup(false);
      const loginRes = await login(payload.username, payload.password);
      if (!loginRes.success) {
        return { success: false, error: loginRes.error };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء حساب المدير', 'Failed to create administrator account') };
    }
  };

  const logout = async (): Promise<{ serverRevoked: boolean; warning?: string }> => {
    const tokens = getStoredTokens();
    const uid = currentUser?.id;
    let serverRevoked = true;
    let warning: string | undefined;
    try {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        body: tokens?.refreshToken ? { refreshToken: tokens.refreshToken } : {},
      });
    } catch {
      serverRevoked = false;
      warning = tr(
        'تم تسجيل الخروج محلياً، لكن تعذر إبلاغ السيرفر لإلغاء الجلسة عن بُعد بسبب عدم توفر الاتصال.',
        'Signed out locally, but could not notify the server to revoke the remote session due to no connection.'
      );
    }
    await clearLastVerifiedOfflineSession(uid).catch(() => {});
    if (uid) {
      await markSavedAccountStatus(uid, 'logged_out').catch(() => {});
      clearReadCache(uid);
    } else {
      clearReadCache();
    }
    clearDashboardPrivacyMasks();
    setRuntimeUnlockedAccountId(null);
    await setActiveAccountId(null).catch(() => {});
    await saveStoredTokensAsync(null).catch(() => saveStoredTokens(null));
    await refreshSavedAccounts().catch(() => {});

    setCurrentUser(null);
    setCustomerProfile(null);
    setRepresentativeProfile(null);
    setMobileConfig(DEFAULT_MOBILE_CONFIG);
    setLinkWarning(null);
    setSessionExpiredMessage(warning || null);
    setIsDatabaseUnavailable(false);
    setDatabaseUnavailableMessage(null);
    setIsOfflineSession(false);
    setPermissionsMayBeStale(false);
    setLastVerifiedAt(null);
    setIsAccountSwitcherOpen(false);
    resetDashboardBalancesSessionStorage();
    resetDashboardBalancesVisibility();
    return { serverRevoked, warning };
  };

  const handleServerAuthRevoked = useCallback(async (reason?: string) => {
    clearDashboardPrivacyMasks();
    const revokeMsg = reason ? tr(reason) : tr('تم إيقاف الحساب أو سحب الصلاحية من السيرفر المركزي.', 'Account disabled or permission revoked by the central server.');
    logDiagnostic({
      category: 'auth',
      severity: 'error',
      source: 'auth.serverRevoked',
      message: revokeMsg,
    });
    const uid = currentUserIdRef.current;
    if (uid) {
      await revokeOfflineUser(uid).catch(() => {});
      await markSavedAccountStatus(uid, 'revoked', reason).catch(() => {});
      clearReadCache(uid);
    } else {
      await clearLastVerifiedOfflineSession().catch(() => {});
      clearReadCache();
    }
    setRuntimeUnlockedAccountId(null);
    await setActiveAccountId(null).catch(() => {});
    saveStoredTokens(null);
    await refreshSavedAccounts().catch(() => {});
    setCurrentUser(null);
    setCustomerProfile(null);
    setRepresentativeProfile(null);
    setMobileConfig(DEFAULT_MOBILE_CONFIG);
    setLinkWarning(null);
    setIsOfflineSession(false);
    setPermissionsMayBeStale(false);
    setLastVerifiedAt(null);
    setIsDatabaseUnavailable(false);
    setDatabaseUnavailableMessage(null);
    setSessionExpiredMessage(revokeMsg);
    setIsAccountSwitcherOpen(false);
    resetDashboardBalancesSessionStorage();
    resetDashboardBalancesVisibility();
  }, [refreshSavedAccounts, resetDashboardBalancesVisibility]);

  const updatePassword = async (
    newPassword: string,
    currentPassword?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!currentUser) return { success: false, error: tr('المستخدم غير مسجل', 'User is not logged in') };
    try {
      await apiRequest('/api/auth/password', {
        method: 'PUT',
        body: { currentPassword, newPassword },
      });
      const updatedUser: User = { ...currentUser, mustChangePassword: false };
      setCurrentUser(updatedUser);
      await saveVerifiedOnlineCredentials({
        serverUrl: getConfiguredApiBaseUrl(),
        installationId: getStoredInstallationId(),
        username: updatedUser.username,
        password: newPassword,
        user: updatedUser,
        customerProfile,
        representativeProfile,
      }).catch(() => {});
      const curTokens = getStoredTokens();
      if (curTokens?.refreshToken) {
        await updateSavedAccountTokens(updatedUser.id, curTokens, {
          sessionStatus: 'active',
          lastVerifiedAt: new Date().toISOString(),
        }).catch(() => {});
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('فشل تحديث كلمة المرور', 'Failed to update password') };
    }
  };

  const updateUserShortcuts = async (
    shortcuts: UserShortcutItem[]
  ): Promise<{ success: boolean; shortcuts?: UserShortcutItem[]; error?: string }> => {
    if (!currentUser) return { success: false, error: tr('المستخدم غير مسجل', 'User is not logged in') };
    try {
      const res = await apiRequest<{ ok: boolean; shortcuts: UserShortcutItem[]; user?: User }>('/api/auth/shortcuts', {
        method: 'PUT',
        body: { shortcuts },
      });
      const nextShortcuts = Array.isArray(res.shortcuts) ? res.shortcuts : shortcuts;
      setCurrentUser((prev) => (prev ? { ...prev, shortcuts: nextShortcuts } : null));
      return { success: true, shortcuts: nextShortcuts };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حفظ اختصارات لوحة المفاتيح', 'Failed to save keyboard shortcuts') };
    }
  };

  const hasPermission = (permissionKey: keyof User['permissions']): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return Boolean(currentUser.permissions?.[permissionKey]);
  };

  const hasRole = (roles: UserRole[]): boolean => {
    if (!currentUser) return false;
    return roles.includes(currentUser.role);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        customerProfile,
        representativeProfile,
        mobileConfig,
        linkWarning,
        sessionExpiredMessage,
        isDatabaseUnavailable,
        databaseUnavailableMessage,
        pairingBanner,
        setPairingBanner,
        clearPairingBanner: () => setPairingBanner(null),
        needsAdminSetup,
        isAuthenticated: Boolean(currentUser),
        isLoading,
        isOfflineSession,
        lastVerifiedAt,
        permissionsMayBeStale,
        savedAccounts,
        isAccountSwitcherOpen,
        setIsAccountSwitcherOpen,
        refreshSavedAccounts,
        resumeSavedAccount,
        removeSavedAccountFromDevice,
        login,
        registerAccount,
        bootstrapAdmin,
        logout,
        handleServerAuthRevoked,
        updatePassword,
        updateUserShortcuts,
        refreshAuthContext: checkStatusAndSession,
        hasPermission,
        hasRole,
        clearSessionExpiredMessage: () => setSessionExpiredMessage(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

function getCurrentUserIdOrNull(u: User | null): string | null {
  return u?.id || null;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};



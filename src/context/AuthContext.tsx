import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Customer, MobileConfig, Representative, User, UserRole, UserShortcutItem } from '../types';
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
  setAuthExpiredHandler,
  setStoredInstallationIdAsync,
  subscribeServerDbStatus,
} from '../services/api';
import { getClientDeviceDescriptor, isNativeCapacitor } from '../services/native';
import { clearReadCache, purgeLegacyLocalDatabaseCache } from '../services/storage';
import {
  clearLastVerifiedOfflineSession,
  refreshCachedUserAuthorization,
  restoreLastVerifiedOfflineSession,
  revokeOfflineUser,
  saveVerifiedOnlineCredentials,
  verifyOfflineLogin,
} from '../services/offlineAuth';

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
  }
) {
  return (message?: string) => {
    const uid = cleanup?.getCurrentUserId?.();
    if (uid && cleanup?.revokeOfflineUser) {
      cleanup.revokeOfflineUser(uid).catch(() => {});
    } else if (cleanup?.clearLastVerifiedOfflineSession) {
      cleanup.clearLastVerifiedOfflineSession().catch(() => {});
    }
    cleanup?.clearReadCache?.();
    actions.setCurrentUser(null);
    actions.setCustomerProfile(null);
    actions.setRepresentativeProfile(null);
    actions.setLinkWarning(null);
    actions.setIsOfflineSession(false);
    actions.setPermissionsMayBeStale(false);
    actions.setLastVerifiedAt(null);
    actions.setIsDatabaseUnavailable(false);
    actions.setDatabaseUnavailableMessage(null);
    actions.setSessionExpiredMessage(message || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');
  };
}

export async function executeAuthSessionCheck(params: {
  getCurrentUser: () => User | null;
  actions: AuthSessionStateActions;
  isStale?: () => boolean;
  deps?: Partial<AuthSessionCheckDeps>;
}): Promise<void> {
  const { getCurrentUser, actions, isStale = () => false } = params;
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
      actions.setDatabaseUnavailableMessage(dbMessage || DEFAULT_DB_UNAVAILABLE_MESSAGE);
      actions.setSessionExpiredMessage(null);
    } else {
      actions.setIsDatabaseUnavailable(false);
      actions.setDatabaseUnavailableMessage(null);
    }
    actions.setIsLoading(false);
  };

  const handleDbUnavailable = async (dbMessage?: string | null) => {
    const resolvedMessage = dbMessage || DEFAULT_DB_UNAVAILABLE_MESSAGE;
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
        }
        resetToUnauthenticated(true);
        return;
      }

      if (prevInstallationId && serverInstallationId && prevInstallationId !== serverInstallationId) {
        // Different company database or clean reinstall on same host: wipe previous client session
        deps.saveStoredTokens(null);
        await deps.clearLastVerifiedOfflineSession().catch(() => {});
        deps.clearReadCache();
        await deps.setStoredInstallationIdAsync(serverInstallationId).catch(() => {});
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

    const tokens = deps.getStoredTokens();
    if (!tokens?.accessToken) {
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
        const prevUid = getCurrentUser()?.id || null;
        if (prevUid) {
          await deps.revokeOfflineUser(prevUid).catch(() => {});
        } else {
          await deps.clearLastVerifiedOfflineSession().catch(() => {});
        }
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
        if (
          err?.code === 'DEVICE_REVOKED' ||
          err?.code === 'ACCOUNT_DEACTIVATED' ||
          err?.code === 'ACCOUNT_SUSPENDED' ||
          err?.code === 'SESSION_REVOKED'
        ) {
          actions.setSessionExpiredMessage(err.message);
        } else if (err?.status === 401) {
          actions.setSessionExpiredMessage(err?.message || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');
        }
      } else if (isDatabaseUnavailableError(err)) {
        await handleDbUnavailable(err?.message || DEFAULT_DB_UNAVAILABLE_MESSAGE);
      } else if ((err?.status === 0 || serverUnreachable) && deps.isNativeCapacitor() && Boolean(tokens?.refreshToken)) {
        actions.setIsDatabaseUnavailable(false);
        actions.setDatabaseUnavailableMessage(null);
        const restored = await deps
          .restoreLastVerifiedOfflineSession(baseUrl, serverInstallationId || prevInstallationId)
          .catch(() => null);
        if (isStale()) return;
        if (restored) {
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
        // Unverified unexpected non-503 failure: clear unverified session state
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
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; requirePasswordChange?: boolean }>;
  registerAccount: (payload: {
    role: 'customer' | 'representative';
    fullName: string;
    username: string;
    password: string;
    phone: string;
    address?: string;
    shopName?: string;
    area?: string;
    vehicleNumber?: string;
    geoCoordinates?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  bootstrapAdmin: (payload: { fullName: string; username: string; password: string; phone?: string; companyName?: string }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
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

  const currentUserRef = useRef<User | null>(null);
  currentUserRef.current = currentUser;
  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = currentUser?.id || null;
  const isDatabaseUnavailableRef = useRef<boolean>(false);
  isDatabaseUnavailableRef.current = isDatabaseUnavailable;
  const checkSeqRef = useRef(0);
  const isCheckingRef = useRef(false);

  const checkStatusAndSession = useCallback(async () => {
    const seq = ++checkSeqRef.current;
    isCheckingRef.current = true;
    try {
      await executeAuthSessionCheck({
        getCurrentUser: () => currentUserRef.current,
        isStale: () => seq !== checkSeqRef.current,
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
        }
      )
    );

    const unsubscribeDbStatus = subscribeServerDbStatus((available, message) => {
      if (!available) {
        isDatabaseUnavailableRef.current = true;
        setIsDatabaseUnavailable(true);
        setDatabaseUnavailableMessage(message || DEFAULT_DB_UNAVAILABLE_MESSAGE);
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
  }, [checkStatusAndSession]);

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
      saveStoredTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
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
          return { success: true, requirePasswordChange: false };
        }
        return { success: false, error: offlineRes.error };
      }
      if (isDatabaseUnavailableError(err)) {
        setIsDatabaseUnavailable(true);
        setDatabaseUnavailableMessage(err?.message || DEFAULT_DB_UNAVAILABLE_MESSAGE);
        setSessionExpiredMessage(null);
      }
      return { success: false, error: err?.message || 'تعذر تسجيل الدخول' };
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
    area?: string;
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
      saveStoredTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
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

      return { success: true };
    } catch (err: any) {
      if (isDatabaseUnavailableError(err)) {
        setIsDatabaseUnavailable(true);
        setDatabaseUnavailableMessage(err?.message || DEFAULT_DB_UNAVAILABLE_MESSAGE);
      }
      return { success: false, error: err?.message || 'تعذر إنشاء الحساب الجديد' };
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
      return { success: false, error: err?.message || 'تعذر إنشاء حساب المدير' };
    }
  };

  const logout = async () => {
    const tokens = getStoredTokens();
    const uid = currentUser?.id;
    try {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: tokens?.refreshToken },
      });
    } catch {
      // always clear local session even if server unreachable
    }
    await clearLastVerifiedOfflineSession(uid).catch(() => {});
    saveStoredTokens(null);
    clearReadCache();
    setCurrentUser(null);
    setCustomerProfile(null);
    setRepresentativeProfile(null);
    setMobileConfig(DEFAULT_MOBILE_CONFIG);
    setLinkWarning(null);
    setSessionExpiredMessage(null);
    setIsDatabaseUnavailable(false);
    setDatabaseUnavailableMessage(null);
    setIsOfflineSession(false);
    setPermissionsMayBeStale(false);
    setLastVerifiedAt(null);
  };

  const handleServerAuthRevoked = useCallback(async (reason?: string) => {
    const uid = currentUserIdRef.current;
    if (uid) {
      await revokeOfflineUser(uid).catch(() => {});
    } else {
      await clearLastVerifiedOfflineSession().catch(() => {});
    }
    saveStoredTokens(null);
    clearReadCache();
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
    setSessionExpiredMessage(reason || 'تم إيقاف الحساب أو سحب الصلاحية من السيرفر المركزي.');
  }, []);

  const updatePassword = async (
    newPassword: string,
    currentPassword?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!currentUser) return { success: false, error: 'المستخدم غير مسجل' };
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
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'فشل تحديث كلمة المرور' };
    }
  };

  const updateUserShortcuts = async (
    shortcuts: UserShortcutItem[]
  ): Promise<{ success: boolean; shortcuts?: UserShortcutItem[]; error?: string }> => {
    if (!currentUser) return { success: false, error: 'المستخدم غير مسجل' };
    try {
      const res = await apiRequest<{ ok: boolean; shortcuts: UserShortcutItem[]; user?: User }>('/api/auth/shortcuts', {
        method: 'PUT',
        body: { shortcuts },
      });
      const nextShortcuts = Array.isArray(res.shortcuts) ? res.shortcuts : shortcuts;
      setCurrentUser((prev) => (prev ? { ...prev, shortcuts: nextShortcuts } : null));
      return { success: true, shortcuts: nextShortcuts };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر حفظ اختصارات لوحة المفاتيح' };
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

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};


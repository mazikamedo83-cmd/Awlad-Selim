import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Customer, MobileConfig, Representative, User, UserRole, UserShortcutItem } from '../types';
import {
  apiRequest,
  detectModeFromUrl,
  getConfiguredApiBaseUrl,
  getStoredConnectionProfiles,
  getStoredInstallationId,
  getStoredTokens,
  hydrateServerUrlFromNative,
  saveStoredTokens,
  setAuthExpiredHandler,
  setStoredInstallationIdAsync,
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

const DEFAULT_MOBILE_CONFIG: MobileConfig = {
  enableCustomerApp: true,
  enableRepApp: true,
  allowCustomerPriceView: true,
  requireOrderApproval: true,
};

interface AuthContextType {
  currentUser: User | null;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
  mobileConfig: MobileConfig;
  linkWarning: string | null;
  sessionExpiredMessage: string | null;
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
  const [pairingBanner, setPairingBanner] = useState<PairingBannerMessage | null>(null);
  const [needsAdminSetup, setNeedsAdminSetup] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [permissionsMayBeStale, setPermissionsMayBeStale] = useState(false);

  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = currentUser?.id || null;
  const checkSeqRef = useRef(0);

  const checkStatusAndSession = useCallback(async () => {
    const seq = ++checkSeqRef.current;
    purgeLegacyLocalDatabaseCache();
    await hydrateServerUrlFromNative();
    if (seq !== checkSeqRef.current) return;
    const baseUrl = getConfiguredApiBaseUrl();
    const prevInstallationId = getStoredInstallationId();
    let serverInstallationId = '';
    let serverUnreachable = false;

    const resetToUnauthenticated = (setupNeeded: boolean) => {
      setCurrentUser(null);
      setCustomerProfile(null);
      setRepresentativeProfile(null);
      setLinkWarning(null);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setLastVerifiedAt(null);
      setNeedsAdminSetup(setupNeeded);
      setIsLoading(false);
    };

    try {
      const statusRes = await apiRequest<{
        ok: boolean;
        needsAdminSetup: boolean;
        installationId?: string;
      }>('/api/auth/status', {
        skipAuth: true,
      });
      if (seq !== checkSeqRef.current) return;
      serverInstallationId = String(statusRes.installationId || '').trim();
      const setupNeeded = Boolean(statusRes.needsAdminSetup);
      setNeedsAdminSetup(setupNeeded);

      if (setupNeeded) {
        saveStoredTokens(null);
        await clearLastVerifiedOfflineSession().catch(() => {});
        clearReadCache();
        if (serverInstallationId) {
          await setStoredInstallationIdAsync(serverInstallationId).catch(() => {});
        }
        resetToUnauthenticated(true);
        return;
      }

      if (prevInstallationId && serverInstallationId && prevInstallationId !== serverInstallationId) {
        // Different company database or clean reinstall on same host: wipe previous client session
        saveStoredTokens(null);
        await clearLastVerifiedOfflineSession().catch(() => {});
        clearReadCache();
        await setStoredInstallationIdAsync(serverInstallationId).catch(() => {});
        resetToUnauthenticated(false);
        return;
      }
    } catch (err: any) {
      if (err?.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        serverUnreachable = true;
      }
    }

    const tokens = getStoredTokens();
    if (!tokens?.accessToken) {
      if (serverInstallationId && !prevInstallationId) {
        await setStoredInstallationIdAsync(serverInstallationId).catch(() => {});
      }
      resetToUnauthenticated(false);
      return;
    }

    try {
      const me = await apiRequest<{
        ok: boolean;
        installationId?: string;
        user: User;
        customerProfile: Customer | null;
        representativeProfile: Representative | null;
        mobileConfig?: MobileConfig;
        linkWarning: string | null;
      }>('/api/auth/me');
      if (seq !== checkSeqRef.current) return;
      const resolvedInstallationId = String(me.installationId || serverInstallationId || prevInstallationId || '').trim();
      if (resolvedInstallationId) {
        await setStoredInstallationIdAsync(resolvedInstallationId).catch(() => {});
      }
      setCurrentUser(me.user);
      setCustomerProfile(me.customerProfile || null);
      setRepresentativeProfile(me.representativeProfile || null);
      setMobileConfig(me.mobileConfig || DEFAULT_MOBILE_CONFIG);
      setLinkWarning(me.linkWarning || null);
      setSessionExpiredMessage(null);
      setNeedsAdminSetup(false);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      const nowIso = new Date().toISOString();
      setLastVerifiedAt(nowIso);
      refreshCachedUserAuthorization({
        serverUrl: baseUrl,
        installationId: resolvedInstallationId,
        user: me.user,
        customerProfile: me.customerProfile || null,
        representativeProfile: me.representativeProfile || null,
      }).catch(() => {});
    } catch (err: any) {
      if (seq !== checkSeqRef.current) return;
      if (err?.status === 401 || err?.code === 'DEVICE_REVOKED' || err?.code === 'ACCOUNT_DEACTIVATED') {
        const prevUid = currentUserIdRef.current;
        if (prevUid) {
          revokeOfflineUser(prevUid).catch(() => {});
        } else {
          clearLastVerifiedOfflineSession().catch(() => {});
        }
        saveStoredTokens(null);
        setCurrentUser(null);
        setCustomerProfile(null);
        setRepresentativeProfile(null);
        setLinkWarning(null);
        setIsOfflineSession(false);
        setPermissionsMayBeStale(false);
        setLastVerifiedAt(null);
        if (err?.code === 'DEVICE_REVOKED' || err?.code === 'ACCOUNT_DEACTIVATED') {
          setSessionExpiredMessage(err.message);
        }
      } else if ((err?.status === 0 || serverUnreachable) && isNativeCapacitor() && Boolean(tokens?.refreshToken)) {
        const restored = await restoreLastVerifiedOfflineSession(
          baseUrl,
          serverInstallationId || prevInstallationId
        ).catch(() => null);
        if (seq !== checkSeqRef.current) return;
        if (restored) {
          setCurrentUser(restored.user);
          setCustomerProfile(restored.customerProfile);
          setRepresentativeProfile(restored.representativeProfile);
          setIsOfflineSession(true);
          setPermissionsMayBeStale(true);
          setLastVerifiedAt(restored.lastVerifiedAt);
          setNeedsAdminSetup(false);
        } else {
          resetToUnauthenticated(false);
        }
      } else {
        // Desktop/Web or unreachable server without verified active online validation: force login screen
        setCurrentUser(null);
        setCustomerProfile(null);
        setRepresentativeProfile(null);
        setLinkWarning(null);
        setIsOfflineSession(false);
        setPermissionsMayBeStale(false);
        setLastVerifiedAt(null);
      }
    } finally {
      if (seq === checkSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    setAuthExpiredHandler((message) => {
      setCurrentUser(null);
      setCustomerProfile(null);
      setRepresentativeProfile(null);
      setLinkWarning(null);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setSessionExpiredMessage(message || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');
    });
    checkStatusAndSession();
    return () => {
      setAuthExpiredHandler(null);
    };
  }, [checkStatusAndSession]);

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
          setNeedsAdminSetup(false);
          setIsOfflineSession(true);
          setPermissionsMayBeStale(true);
          setLastVerifiedAt(offlineRes.lastVerifiedAt);
          return { success: true, requirePasswordChange: false };
        }
        return { success: false, error: offlineRes.error };
      }
      return { success: false, error: err?.message || 'تعذر تسجيل الدخول' };
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

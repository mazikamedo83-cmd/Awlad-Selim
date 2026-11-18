import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Customer, MobileConfig, Representative, User, UserRole, UserShortcutItem } from '../types';
import {
  apiRequest,
  getConfiguredApiBaseUrl,
  getConnectionModeLabel,
  getStoredTokens,
  hydrateServerUrlFromNative,
  saveStoredTokens,
  setAuthExpiredHandler,
} from '../services/api';
import { clearReadCache, purgeLegacyLocalDatabaseCache } from '../services/storage';
import {
  saveVerifiedOnlineCredentials,
  refreshCachedUserAuthorization,
  verifyOfflineLogin,
  restoreLastVerifiedOfflineSession,
  clearLastVerifiedOfflineSession,
  revokeOfflineUser,
} from '../services/offlineAuth';
import {
  claimPairingInvitation,
  parsePairingInput,
  syncConnectionConfigFromServer,
} from '../services/discovery';
import { getInitialAppLaunchUrl, subscribeAppUrlOpen } from '../services/native';

const DEFAULT_MOBILE_CONFIG: MobileConfig = {
  enableCustomerApp: true,
  enableRepApp: true,
  allowCustomerPriceView: true,
  requireOrderApproval: true,
};

export interface PairingNotice {
  type: 'success' | 'info' | 'warning' | 'error';
  text: string;
}

interface AuthContextType {
  currentUser: User | null;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
  mobileConfig: MobileConfig;
  linkWarning: string | null;
  sessionExpiredMessage: string | null;
  pairingNotice: PairingNotice | null;
  needsAdminSetup: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOfflineSession: boolean;
  permissionsMayBeStale: boolean;
  lastVerifiedAt: string | null;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; requirePasswordChange?: boolean; offlineMode?: boolean }>;
  bootstrapAdmin: (payload: { fullName: string; username: string; password: string; phone?: string; companyName?: string }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updatePassword: (newPassword: string, currentPassword?: string) => Promise<{ success: boolean; error?: string }>;
  updateUserShortcuts: (shortcuts: UserShortcutItem[]) => Promise<{ success: boolean; shortcuts?: UserShortcutItem[]; error?: string }>;
  refreshAuthContext: () => Promise<void>;
  handleCentralAuthRevoked: (reason?: string) => Promise<void>;
  processDeepLinkOrPairingInput: (rawInput: string) => Promise<{ ok: boolean; error?: string; requiresAdminApproval?: boolean }>;
  clearPairingNotice: () => void;
  hasPermission: (permissionKey: keyof User['permissions']) => boolean;
  hasRole: (roles: UserRole[]) => boolean;
  clearSessionExpiredMessage: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isNetworkOfflineError(err: any): boolean {
  return (
    err?.status === 0 ||
    err?.code === 'NETWORK_ERROR' ||
    err?.code === 'TIMEOUT' ||
    err?.code === 'SERVER_URL_NOT_CONFIGURED' ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  );
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [customerProfile, setCustomerProfile] = useState<Customer | null>(null);
  const [representativeProfile, setRepresentativeProfile] = useState<Representative | null>(null);
  const [mobileConfig, setMobileConfig] = useState<MobileConfig>(DEFAULT_MOBILE_CONFIG);
  const [linkWarning, setLinkWarning] = useState<string | null>(null);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const [pairingNotice, setPairingNotice] = useState<PairingNotice | null>(null);
  const [needsAdminSetup, setNeedsAdminSetup] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [permissionsMayBeStale, setPermissionsMayBeStale] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);

  const processedPairingTokensRef = useRef<Set<string>>(new Set());
  const inFlightPairingTokensRef = useRef<Set<string>>(new Set());

  const handleCentralAuthRevoked = useCallback(async (reason?: string) => {
    const uid = currentUser?.id;
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
    setLinkWarning(null);
    setIsOfflineSession(false);
    setPermissionsMayBeStale(false);
    setSessionExpiredMessage(reason || 'تم إنهاء الجلسة أو إيقاف الصلاحية من السيرفر المركزي.');
  }, [currentUser?.id]);

  const checkStatusAndSession = useCallback(async () => {
    purgeLegacyLocalDatabaseCache();
    await hydrateServerUrlFromNative();
    const baseUrl = getConfiguredApiBaseUrl();

    try {
      const statusRes = await apiRequest<{ ok: boolean; needsAdminSetup: boolean }>('/api/auth/status', {
        skipAuth: true,
        timeoutMs: 5000,
      });
      setNeedsAdminSetup(Boolean(statusRes.needsAdminSetup));
    } catch {
      // ignore if offline or server URL not configured yet
    }

    const tokens = getStoredTokens();
    if (!tokens?.accessToken) {
      setCurrentUser(null);
      setCustomerProfile(null);
      setRepresentativeProfile(null);
      setLinkWarning(null);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setIsLoading(false);
      return;
    }

    try {
      const me = await apiRequest<{
        ok: boolean;
        user: User;
        customerProfile: Customer | null;
        representativeProfile: Representative | null;
        mobileConfig?: MobileConfig;
        linkWarning: string | null;
      }>('/api/auth/me', { timeoutMs: 8000 });

      if (me.user?.isActive === false) {
        await revokeOfflineUser(me.user.id).catch(() => {});
        saveStoredTokens(null);
        setCurrentUser(null);
        setCustomerProfile(null);
        setRepresentativeProfile(null);
        setSessionExpiredMessage('تم إيقاف هذا الحساب من الإدارة.');
        setIsOfflineSession(false);
        setPermissionsMayBeStale(false);
        return;
      }

      const nowIso = new Date().toISOString();
      setCurrentUser(me.user);
      setCustomerProfile(me.customerProfile || null);
      setRepresentativeProfile(me.representativeProfile || null);
      setMobileConfig(me.mobileConfig || DEFAULT_MOBILE_CONFIG);
      setLinkWarning(me.linkWarning || null);
      setSessionExpiredMessage(null);
      setNeedsAdminSetup(false);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setLastVerifiedAt(nowIso);

      await refreshCachedUserAuthorization({
        serverUrl: baseUrl,
        user: me.user,
        customerProfile: me.customerProfile || null,
        representativeProfile: me.representativeProfile || null,
      }).catch(() => {});
    } catch (err: any) {
      if (
        err?.status === 401 ||
        err?.code === 'ACCOUNT_DEACTIVATED' ||
        err?.code === 'DEVICE_REVOKED' ||
        err?.code === 'DEVICE_REJECTED' ||
        err?.code === 'DEVICE_DISCONNECTED' ||
        err?.code === 'DEVICE_PENDING_APPROVAL'
      ) {
        await revokeOfflineUser(currentUser?.id || '').catch(() => {});
        await clearLastVerifiedOfflineSession().catch(() => {});
        saveStoredTokens(null);
        setCurrentUser(null);
        setCustomerProfile(null);
        setRepresentativeProfile(null);
        setLinkWarning(null);
        setIsOfflineSession(false);
        setPermissionsMayBeStale(false);
        if (err?.message) {
          setSessionExpiredMessage(err.message);
        }
      } else if (isNetworkOfflineError(err)) {
        // Restore previously verified offline session on this device
        const restored = await restoreLastVerifiedOfflineSession(baseUrl);
        if (restored) {
          setCurrentUser(restored.user);
          setCustomerProfile(restored.customerProfile);
          setRepresentativeProfile(restored.representativeProfile);
          setLastVerifiedAt(restored.lastVerifiedAt);
          setIsOfflineSession(true);
          setPermissionsMayBeStale(true);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.id]);

  const processDeepLinkOrPairingInput = useCallback(
    async (
      rawInput: string
    ): Promise<{ ok: boolean; error?: string; requiresAdminApproval?: boolean }> => {
      const parsed = parsePairingInput(rawInput);
      const tokenKey = parsed?.token ? `${parsed.serverUrl || ''}::${parsed.token}` : '';
      if (tokenKey && (processedPairingTokensRef.current.has(tokenKey) || inFlightPairingTokensRef.current.has(tokenKey))) {
        return { ok: true };
      }
      if (tokenKey) {
        inFlightPairingTokensRef.current.add(tokenKey);
      }

      try {
        const res = await claimPairingInvitation(rawInput, { clearExistingAuth: true });
        if (!res.ok) {
          setPairingNotice({ type: 'error', text: res.error || 'تعذر إتمام ربط الجهاز.' });
          return { ok: false, error: res.error };
        }

        if (tokenKey) {
          processedPairingTokensRef.current.add(tokenKey);
        }

        // Clean browser query/path token so reload never replays single-use pairing URL
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          try {
            const urlObj = new URL(window.location.href);
            if (urlObj.searchParams.has('pair_token') || /^\/(?:pair|invite)\//i.test(urlObj.pathname)) {
              urlObj.searchParams.delete('pair_token');
              if (/^\/(?:pair|invite)\//i.test(urlObj.pathname)) {
                urlObj.pathname = '/';
              }
              window.history.replaceState({}, '', urlObj.pathname + urlObj.search);
            }
          } catch {
            // ignore history error
          }
        }

        // Ensure current session state reflects cleared pre-pairing auth before user logs in manually
        await clearLastVerifiedOfflineSession().catch(() => {});
        setCurrentUser(null);
        setCustomerProfile(null);
        setRepresentativeProfile(null);
        setLinkWarning(null);
        setIsOfflineSession(false);
        setPermissionsMayBeStale(false);

        const modeText = getConnectionModeLabel(res.activeMode);
        if (res.requiresAdminApproval) {
          setPairingNotice({
            type: 'warning',
            text: `تم ربط الجهاز بسيرفر (${res.companyName || 'أولاد سليم'}) عبر ${modeText} وهو الآن بانتظار موافقة مدير النظام في لوحة إدارة الأجهزة قبل تسجيل الدخول.`,
          });
        } else {
          setPairingNotice({
            type: 'success',
            text: `تم ربط الجهاز بنجاح بسيرفر (${res.companyName || 'أولاد سليم'}) عبر ${modeText}. يمكنك الآن تسجيل الدخول بحسابك المعتاد.`,
          });
        }

        await checkStatusAndSession().catch(() => {});
        return { ok: true, requiresAdminApproval: res.requiresAdminApproval };
      } finally {
        if (tokenKey) {
          inFlightPairingTokensRef.current.delete(tokenKey);
        }
      }
    },
    [checkStatusAndSession]
  );

  useEffect(() => {
    setAuthExpiredHandler((message) => {
      revokeOfflineUser(currentUser?.id || '').catch(() => {});
      setCurrentUser(null);
      setCustomerProfile(null);
      setRepresentativeProfile(null);
      setLinkWarning(null);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setSessionExpiredMessage(message || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');
    });

    (async () => {
      await hydrateServerUrlFromNative();
      const initialDeepLink = await getInitialAppLaunchUrl().catch(() => null);
      if (initialDeepLink && parsePairingInput(initialDeepLink)?.token) {
        await processDeepLinkOrPairingInput(initialDeepLink).catch(() => {});
      } else {
        await checkStatusAndSession();
      }
    })();

    const unsubDeepLink = subscribeAppUrlOpen((openedUrl) => {
      if (openedUrl && parsePairingInput(openedUrl)?.token) {
        processDeepLinkOrPairingInput(openedUrl).catch(() => {});
      }
    });

    const handleOnline = () => {
      syncConnectionConfigFromServer({ triggerHeartbeat: Boolean(getStoredTokens()?.accessToken) })
        .then((syncRes) => {
          if (syncRes.quickTunnelChangedWarning) {
            setPairingNotice({ type: 'info', text: syncRes.quickTunnelChangedWarning });
          } else if (syncRes.switchedUrl) {
            setPairingNotice({ type: 'info', text: `تم تحديث مسار السيرفر تلقائياً إلى: ${syncRes.switchedUrl}` });
          }
        })
        .catch(() => {});
      if (getStoredTokens()?.accessToken || currentUser) {
        checkStatusAndSession().catch(() => {});
      }
    };
    window.addEventListener('online', handleOnline);

    const heartbeatTimer = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const hasToken = Boolean(getStoredTokens()?.accessToken);
      if (!hasToken && !getConfiguredApiBaseUrl()) return;
      syncConnectionConfigFromServer({ triggerHeartbeat: hasToken })
        .then((syncRes) => {
          if (syncRes.quickTunnelChangedWarning) {
            setPairingNotice({ type: 'info', text: syncRes.quickTunnelChangedWarning });
          }
        })
        .catch(() => {});
    }, 60000);

    return () => {
      unsubDeepLink();
      window.removeEventListener('online', handleOnline);
      clearInterval(heartbeatTimer);
      setAuthExpiredHandler(null);
    };
  }, [checkStatusAndSession, processDeepLinkOrPairingInput]);

  const login = async (
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string; requirePasswordChange?: boolean; offlineMode?: boolean }> => {
    const baseUrl = getConfiguredApiBaseUrl();
    const cleanUser = username.trim();
    try {
      const res = await apiRequest<{
        ok: boolean;
        accessToken: string;
        refreshToken: string;
        user: User;
        customerProfile: Customer | null;
        representativeProfile: Representative | null;
        mobileConfig?: MobileConfig;
        linkWarning: string | null;
      }>('/api/auth/login', {
        method: 'POST',
        body: { username: cleanUser, password },
        skipAuth: true,
        timeoutMs: 8000,
      });

      const nowIso = new Date().toISOString();
      saveStoredTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      setCurrentUser(res.user);
      setCustomerProfile(res.customerProfile || null);
      setRepresentativeProfile(res.representativeProfile || null);
      setMobileConfig(res.mobileConfig || DEFAULT_MOBILE_CONFIG);
      setLinkWarning(res.linkWarning || null);
      setSessionExpiredMessage(null);
      setNeedsAdminSetup(false);
      setIsOfflineSession(false);
      setPermissionsMayBeStale(false);
      setLastVerifiedAt(nowIso);

      await saveVerifiedOnlineCredentials({
        serverUrl: baseUrl,
        username: res.user.username || cleanUser,
        password,
        user: res.user,
        customerProfile: res.customerProfile || null,
        representativeProfile: res.representativeProfile || null,
      }).catch(() => {});

      return {
        success: true,
        requirePasswordChange: res.user.mustChangePassword === true,
        offlineMode: false,
      };
    } catch (err: any) {
      // Strictly fallback to local PBKDF2 offline login ONLY when the central server is unreachable
      if (isNetworkOfflineError(err)) {
        const offline = await verifyOfflineLogin({
          serverUrl: baseUrl,
          username: cleanUser,
          password,
        });
        if (offline.ok) {
          setCurrentUser(offline.user);
          setCustomerProfile(offline.customerProfile);
          setRepresentativeProfile(offline.representativeProfile);
          setLinkWarning(null);
          setSessionExpiredMessage(null);
          setNeedsAdminSetup(false);
          setIsOfflineSession(true);
          setPermissionsMayBeStale(true);
          setLastVerifiedAt(offline.lastVerifiedAt);
          return {
            success: true,
            offlineMode: true,
          };
        }
        return {
          success: false,
          error: (offline as { ok: false; error: string }).error,
        };
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
        timeoutMs: 4000,
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
  };

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
      const updatedUser = { ...currentUser, mustChangePassword: false };
      setCurrentUser(updatedUser);
      await saveVerifiedOnlineCredentials({
        serverUrl: getConfiguredApiBaseUrl(),
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
        pairingNotice,
        needsAdminSetup,
        isAuthenticated: Boolean(currentUser),
        isLoading,
        isOfflineSession,
        permissionsMayBeStale,
        lastVerifiedAt,
        login,
        bootstrapAdmin,
        logout,
        updatePassword,
        updateUserShortcuts,
        refreshAuthContext: checkStatusAndSession,
        handleCentralAuthRevoked,
        processDeepLinkOrPairingInput,
        clearPairingNotice: () => setPairingNotice(null),
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

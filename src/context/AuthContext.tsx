import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Customer, Representative, User, UserRole } from '../types';
import { apiRequest, getStoredTokens, saveStoredTokens } from '../services/api';
import { purgeLegacyLocalDatabaseCache } from '../services/storage';

interface AuthContextType {
  currentUser: User | null;
  customerProfile: Customer | null;
  representativeProfile: Representative | null;
  linkWarning: string | null;
  needsAdminSetup: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; requirePasswordChange?: boolean }>;
  bootstrapAdmin: (payload: { fullName: string; username: string; password: string; phone?: string; companyName?: string }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updatePassword: (newPassword: string, currentPassword?: string) => Promise<{ success: boolean; error?: string }>;
  refreshAuthContext: () => Promise<void>;
  hasPermission: (permissionKey: keyof User['permissions']) => boolean;
  hasRole: (roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [customerProfile, setCustomerProfile] = useState<Customer | null>(null);
  const [representativeProfile, setRepresentativeProfile] = useState<Representative | null>(null);
  const [linkWarning, setLinkWarning] = useState<string | null>(null);
  const [needsAdminSetup, setNeedsAdminSetup] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);

  const checkStatusAndSession = useCallback(async () => {
    purgeLegacyLocalDatabaseCache();
    try {
      const statusRes = await apiRequest<{ ok: boolean; needsAdminSetup: boolean }>('/api/auth/status', {
        skipAuth: true,
      });
      setNeedsAdminSetup(Boolean(statusRes.needsAdminSetup));
    } catch {
      // ignore if offline while restoring
    }

    const tokens = getStoredTokens();
    if (!tokens?.accessToken) {
      setCurrentUser(null);
      setCustomerProfile(null);
      setRepresentativeProfile(null);
      setLinkWarning(null);
      setIsLoading(false);
      return;
    }

    try {
      const me = await apiRequest<{
        ok: boolean;
        user: User;
        customerProfile: Customer | null;
        representativeProfile: Representative | null;
        linkWarning: string | null;
      }>('/api/auth/me');
      setCurrentUser(me.user);
      setCustomerProfile(me.customerProfile || null);
      setRepresentativeProfile(me.representativeProfile || null);
      setLinkWarning(me.linkWarning || null);
      setNeedsAdminSetup(false);
    } catch {
      saveStoredTokens(null);
      setCurrentUser(null);
      setCustomerProfile(null);
      setRepresentativeProfile(null);
      setLinkWarning(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatusAndSession();
  }, [checkStatusAndSession]);

  const login = async (
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string; requirePasswordChange?: boolean }> => {
    try {
      const res = await apiRequest<{
        ok: boolean;
        accessToken: string;
        refreshToken: string;
        user: User;
        customerProfile: Customer | null;
        representativeProfile: Representative | null;
        linkWarning: string | null;
      }>('/api/auth/login', {
        method: 'POST',
        body: { username: username.trim(), password },
        skipAuth: true,
      });

      saveStoredTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      setCurrentUser(res.user);
      setCustomerProfile(res.customerProfile || null);
      setRepresentativeProfile(res.representativeProfile || null);
      setLinkWarning(res.linkWarning || null);
      setNeedsAdminSetup(false);

      return {
        success: true,
        requirePasswordChange: res.user.mustChangePassword === true,
      };
    } catch (err: any) {
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
      // Automatically sign in with the newly created owner credentials
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
    try {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: tokens?.refreshToken },
      });
    } catch {
      // always clear local session even if server unreachable
    }
    saveStoredTokens(null);
    setCurrentUser(null);
    setCustomerProfile(null);
    setRepresentativeProfile(null);
    setLinkWarning(null);
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
      setCurrentUser((prev) => (prev ? { ...prev, mustChangePassword: false } : null));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'فشل تحديث كلمة المرور' };
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
        linkWarning,
        needsAdminSetup,
        isAuthenticated: Boolean(currentUser),
        isLoading,
        login,
        bootstrapAdmin,
        logout,
        updatePassword,
        refreshAuthContext: checkStatusAndSession,
        hasPermission,
        hasRole,
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

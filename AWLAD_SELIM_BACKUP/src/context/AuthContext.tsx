import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { hashPassword, loadDatabase, saveDatabase, logAuditEvent } from '../services/storage';

interface AuthContextType {
  currentUser: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; requirePasswordChange?: boolean }>;
  logout: () => void;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  hasPermission: (permissionKey: keyof User['permissions']) => boolean;
  hasRole: (roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_USER_KEY = 'awlad_selim_current_session';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Restore session
    const initAuth = async () => {
      try {
        const storedSession = localStorage.getItem(SESSION_USER_KEY);
        if (storedSession) {
          const user = JSON.parse(storedSession) as User;
          // verify user still exists in database and is active
          const db = await loadDatabase();
          const freshUser = db.users.find(u => u.id === user.id);
          if (freshUser && freshUser.isActive) {
            setCurrentUser(freshUser);
          } else {
            localStorage.removeItem(SESSION_USER_KEY);
          }
        }
      } catch (e) {
        console.error('Session restore error:', e);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string; requirePasswordChange?: boolean }> => {
    try {
      const cleanUsername = username.trim().toLowerCase();
      const cleanPassword = password.trim();

      if (!cleanUsername || !cleanPassword) {
        return { success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' };
      }

      const db = await loadDatabase();
      const user = db.users.find(u => u.username.toLowerCase() === cleanUsername);

      if (!user) {
        return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
      }

      if (!user.isActive) {
        return { success: false, error: 'هذا الحساب معطل حالياً. يرجى مراجعة إدارة أولاد سليم' };
      }

      const inputHash = await hashPassword(cleanPassword);
      if (inputHash !== user.passwordHash) {
        return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
      }

      // Update last login
      const updatedUser: User = {
        ...user,
        lastLogin: new Date().toISOString(),
      };

      const updatedUsers = db.users.map(u => u.id === user.id ? updatedUser : u);
      saveDatabase({ ...db, users: updatedUsers });

      // Save session
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);

      logAuditEvent({
        userId: updatedUser.id,
        userName: updatedUser.fullName,
        action: 'تسجيل دخول ناجح للنظام',
        module: 'المصادقة والأمان',
        recordId: updatedUser.id,
        details: `قام المستخدم ${updatedUser.fullName} (${updatedUser.username}) بتسجيل الدخول للنظام بنجاح.`,
      });

      return {
        success: true,
        requirePasswordChange: updatedUser.mustChangePassword === true,
      };
    } catch (err) {
      console.error('Login error:', err);
      return { success: false, error: 'حدث خطأ غير متوقع أثناء تسجيل الدخول' };
    }
  };

  const logout = () => {
    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'تسجيل خروج من النظام',
        module: 'المصادقة والأمان',
        recordId: currentUser.id,
        details: `قام المستخدم ${currentUser.fullName} بتسجيل الخروج من النظام بأمان.`,
      });
    }
    localStorage.removeItem(SESSION_USER_KEY);
    setCurrentUser(null);
  };

  const updatePassword = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    if (!currentUser) return { success: false, error: 'المستخدم غير مسجل' };
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'يجب أن لا تقل كلمة المرور عن 6 أحرف أو أرقام' };
    }

    try {
      const newHash = await hashPassword(newPassword.trim());
      const db = await loadDatabase();
      const updatedUser: User = {
        ...currentUser,
        passwordHash: newHash,
        mustChangePassword: false,
      };

      const updatedUsers = db.users.map(u => u.id === currentUser.id ? updatedUser : u);
      saveDatabase({ ...db, users: updatedUsers });

      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);

      logAuditEvent({
        userId: updatedUser.id,
        userName: updatedUser.fullName,
        action: 'تغيير كلمة المرور',
        module: 'المصادقة والأمان',
        recordId: updatedUser.id,
        details: 'تم تحديث كلمة المرور بنجاح للمستخدم.',
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: 'فشل حفظ كلمة المرور الجديدة' };
    }
  };

  const hasPermission = (permissionKey: keyof User['permissions']): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return !!currentUser.permissions[permissionKey];
  };

  const hasRole = (roles: UserRole[]): boolean => {
    if (!currentUser) return false;
    return roles.includes(currentUser.role);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: !!currentUser,
        isLoading,
        login,
        logout,
        updatePassword,
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

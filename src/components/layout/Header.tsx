import React, { useEffect, useState } from 'react';
import {
  LogOut,
  Maximize,
  Minimize,
  Bell,
  ArrowLeftRight,
  AlertTriangle,
  Server,
  Settings,
  Users,
  UserPlus,
  PackagePlus,
  FilePlus2,
  ShoppingCart,
  ReceiptText,
  Truck,
  Menu,
  LayoutDashboard,
  Sun,
  Moon,
  Globe,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useShortcuts } from '../../context/ShortcutsContext';
import { OfflineIndicator } from './OfflineIndicator';
import { NavItemKey } from './Sidebar';
import { MobileNotificationItem, UserPermissions } from '../../types';
import { MobileNotificationsSheet } from '../modules/mobile/MobileNotificationsSheet';
import { MobileServerModal } from '../modules/mobile/MobileServerModal';

interface HeaderProps {
  currentPage: NavItemKey;
  isWindowsDesktop?: boolean;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNavigate: (page: NavItemKey) => void;
  onNavigateToTransfers?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPage,
  isSidebarOpen,
  onToggleSidebar,
  onNavigate,
  onNavigateToTransfers,
}) => {
  const { currentUser, logout, hasPermission, refreshAuthContext, setIsAccountSwitcherOpen, savedAccounts } = useAuth();
  const {
    customerItemOrders = [],
    mobileNotifications = [],
    unreadNotificationCount = 0,
    pendingSendReceiveCount = 0,
    markNotificationsRead,
    triggerManualSync,
  } = useData();
  const { triggerAction } = useShortcuts();
  const { resolvedTheme, setThemePreference, dir, language, setLanguage, t } = usePreferences();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);

  useEffect(() => {
    if (!showLogoutModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        setShowLogoutModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [showLogoutModal]);

  const canPerm = (perm?: keyof UserPermissions | Array<keyof UserPermissions>) => {
    if (!perm) return true;
    if (currentUser?.role === 'admin') return true;
    if (Array.isArray(perm)) return perm.some((p) => hasPermission(p));
    return hasPermission(perm);
  };

  // Permanent 7 Quick Shortcuts inside Top Blue Bar (RBAC-gated)
  const quickBarShortcuts: Array<{
    key: string;
    label: string;
    icon: React.ElementType;
    onClick: () => void;
    allowed: boolean;
    isActive?: boolean;
  }> = [
    {
      key: 'home',
      label: t('الرئيسية', 'Home'),
      icon: LayoutDashboard,
      onClick: () => onNavigate('dashboard'),
      allowed: true,
      isActive: currentPage === 'dashboard',
    },
    {
      key: 'add-customer',
      label: t('إضافة عميل', 'Add Customer'),
      icon: UserPlus,
      onClick: () => triggerAction('action:new_customer'),
      allowed: canPerm('canManageSales') && canPerm('canAdd'),
    },
    {
      key: 'add-product',
      label: t('إضافة صنف', 'Add Product'),
      icon: PackagePlus,
      onClick: () => triggerAction('action:add_product'),
      allowed: canPerm('canManageInventory') && canPerm('canAdd'),
    },
    {
      key: 'new-sale',
      label: t('فاتورة بيع', 'Sales Invoice'),
      icon: FilePlus2,
      onClick: () => triggerAction('nav:new-sale'),
      allowed: canPerm('canManageSales'),
      isActive: currentPage === 'new-sale',
    },
    {
      key: 'new-purchase',
      label: t('فاتورة شراء', 'Purchase Invoice'),
      icon: ShoppingCart,
      onClick: () => triggerAction('nav:new-purchase'),
      allowed: canPerm(['canManagePurchases', 'canCreatePurchase']),
      isActive: currentPage === 'new-purchase',
    },
    {
      key: 'stock-transfer',
      label: t('تحويل الأصناف', 'Stock Transfer'),
      icon: Truck,
      onClick: () => triggerAction('action:new_stock_transfer'),
      allowed: canPerm(['canCreateStockTransfer', 'canManageInventory']),
    },
    {
      key: 'add-expense',
      label: t('تسجيل مصروف', 'Add Expense'),
      icon: ReceiptText,
      onClick: () => triggerAction('action:add_expense'),
      allowed: canPerm('canManageCashboxes'),
    },
  ].filter((s) => s.allowed);

  // Check new customer/rep orders
  const pendingOrdersCount = customerItemOrders.filter((o) => o.status === 'pending').length;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleSelectNotification = (item: MobileNotificationItem) => {
    const allowedTargets: NavItemKey[] = [
      'customer-orders',
      'customers',
      'rep-item-transfers',
      'rep-transfers',
      'stock-counts',
      'stock-transfers-orders',
      'products',
      'sales-invoices',
      'purchase-invoices',
      'cashboxes',
      'refresh-sync',
    ];
    if (item.targetTab && allowedTargets.includes(item.targetTab as NavItemKey)) {
      onNavigate(item.targetTab as NavItemKey);
    } else {
      onNavigate('dashboard');
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return t('مالك / مدير عام', 'Owner / General Manager');
      case 'manager':
        return t('مدير فرع', 'Branch Manager');
      case 'accountant':
        return t('محاسب مالي', 'Accountant');
      case 'warehouse':
        return t('أمين مستودع', 'Warehouse Keeper');
      case 'sales':
        return t('موظف مبيعات', 'Sales Staff');
      case 'purchases':
        return t('موظف مشتريات', 'Purchases Staff');
      case 'representative':
        return t('مندوب مبيعات', 'Sales Representative');
      case 'customer':
        return t('عميل مسجل', 'Registered Customer');
      default:
        return t('موظف', 'Staff');
    }
  };

  return (
    <>
      {/* Top Logo-Navy/Royal Header */}
      <header className="sticky top-0 z-30 awlad-brand-gradient text-white shadow-sm border-b border-[var(--awlad-royal-500)]/40 dark:border-[#2A4D86] pt-safe no-print">
        <div className="max-w-full mx-auto px-2 sm:px-3">
          {/* Top Row: Brand Identity + (Windows Sidebar Toggle) + Utility Controls */}
          <div className="h-10 flex items-center justify-between gap-2">
            {/* Brand Logo & Name (+ Independent Sidebar Toggle strictly on Windows Desktop) */}
            <div className="flex items-center gap-2 min-w-0">
              <img
                src="/awlad-selim-logo.png"
                alt="AWLAD SELIM"
                className="h-7 w-7 object-contain bg-white no-dark-surface rounded-md p-0.5 shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-xs font-black text-white leading-tight truncate">
                  AWLAD SELIM
                </h1>
                <p className="text-[10px] text-blue-100 font-semibold truncate">
                  {currentUser ? `${currentUser.fullName} · ${getRoleLabel(currentUser.role)}` : t('أولاد سليم', 'Awlad Selim')}
                </p>
              </div>
              {!isSidebarOpen && (
                <button
                  type="button"
                  data-testid="sidebar-toggle-btn"
                  onClick={onToggleSidebar}
                  aria-label={t('فتح القائمة الجانبية', 'Open sidebar')}
                  aria-expanded={isSidebarOpen}
                  aria-controls="system-sections-drawer"
                  title={t('فتح القائمة الجانبية', 'Open sidebar')}
                  className="min-h-[30px] px-2.5 py-1 flex items-center justify-center gap-1.5 rounded-md border text-xs font-black whitespace-nowrap shrink-0 cursor-pointer transition-colors bg-white/15 hover:bg-white/25 border-white/30 text-white"
                >
                  <Menu className="w-4 h-4 shrink-0" />
                  <span>{t('قائمة الأقسام', 'Modules Menu')}</span>
                </button>
              )}
            </div>

            {/* Utility Controls: Alerts, Status, Notifications, Server, Language, Theme, Fullscreen, Logout */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <OfflineIndicator variant="dark" />

              {pendingOrdersCount > 0 && canPerm('canManageSales') && (
                <button
                  type="button"
                  onClick={() => onNavigate('customer-orders')}
                  title={t(
                    `يوجد ${pendingOrdersCount} طلب شراء جديد بانتظار المراجعة`,
                    `${pendingOrdersCount} new purchase orders awaiting review`
                  )}
                  className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-white/15 text-white border border-white/25 text-[11px] font-black hover:bg-white/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Bell className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden xl:inline">{t('طلبات', 'Orders')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-white text-blue-950 no-dark-surface text-[10px] font-mono tabular-nums">
                    {pendingOrdersCount}
                  </span>
                </button>
              )}

              {pendingSendReceiveCount > 0 && canPerm(['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove']) && (
                <button
                  type="button"
                  onClick={() => (onNavigateToTransfers ? onNavigateToTransfers() : onNavigate('refresh-sync'))}
                  title={t(
                    `يوجد ${pendingSendReceiveCount} عملية إرسال واستلام وتحويل بانتظار المراجعة`,
                    `${pendingSendReceiveCount} send, receive & transfer operations awaiting review`
                  )}
                  className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-white/15 text-white border border-white/25 text-[11px] font-bold hover:bg-white/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden xl:inline">{t('الإرسال والتحويلات', 'Send & Transfers')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-white text-blue-950 no-dark-surface text-[10px] font-mono tabular-nums font-black">
                    {pendingSendReceiveCount}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsNotificationsOpen(true);
                  markNotificationsRead();
                }}
                className="relative min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title={t('التنبيهات والإشعارات', 'Alerts & Notifications')}
                aria-label={t('التنبيهات والإشعارات', 'Alerts & Notifications')}
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -end-1 min-w-[16px] h-[16px] px-1 rounded bg-red-600 text-white text-[9px] font-mono tabular-nums font-black flex items-center justify-center">
                    {unreadNotificationCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsServerModalOpen(true)}
                className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title={t('عنوان وإعدادات السيرفر المركزي', 'Central Server Address & Settings')}
                aria-label={t('إعدادات السيرفر', 'Server Settings')}
              >
                <Server className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsAccountSwitcherOpen(true)}
                className="relative min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title={t('الحسابات المحفوظة وتبديل الحساب', 'Saved Accounts & Switcher')}
                aria-label={t('تبديل الحساب', 'Switch Account')}
              >
                <Users className="w-4 h-4" />
                {savedAccounts.length > 1 && (
                  <span className="absolute -top-1 -end-1 min-w-[15px] h-[15px] px-1 rounded bg-[var(--awlad-royal-500)] text-white text-[9px] font-mono tabular-nums font-black flex items-center justify-center">
                    {savedAccounts.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                data-testid="header-language-toggle"
                onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
                className="min-h-[30px] px-2 flex items-center justify-center gap-1 rounded-md bg-white/15 hover:bg-white/25 border border-white/25 text-white text-[11px] font-black transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title={language === 'en' ? 'التبديل إلى اللغة العربية' : 'Switch to English'}
                aria-label={language === 'en' ? 'العربية' : 'English'}
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>{language === 'en' ? 'العربية' : 'English'}</span>
              </button>

              <button
                type="button"
                data-testid="header-theme-toggle"
                onClick={() => setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title={resolvedTheme === 'dark' ? t('التبديل إلى الوضع النهاري', 'Switch to Light Mode') : t('التبديل إلى الوضع الداكن', 'Switch to Dark Mode')}
                aria-label={resolvedTheme === 'dark' ? t('التبديل إلى الوضع النهاري', 'Switch to Light Mode') : t('التبديل إلى الوضع الداكن', 'Switch to Dark Mode')}
              >
                {resolvedTheme === 'dark' ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => onNavigate('system-settings')}
                className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title={t('الإعدادات', 'Settings')}
                aria-label={t('الإعدادات', 'Settings')}
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="hidden md:flex min-h-[30px] min-w-[30px] items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title={t('ملء الشاشة', 'Fullscreen')}
                aria-label={t('ملء الشاشة', 'Fullscreen')}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setShowLogoutModal(true)}
                className="min-h-[30px] px-2 flex items-center justify-center gap-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title={t('تسجيل الخروج من النظام', 'Sign out of system')}
                aria-label={t('تسجيل الخروج', 'Logout')}
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{t('خروج', 'Logout')}</span>
              </button>
            </div>
          </div>

          {/* Permanent 7 Quick Shortcuts inside Top Blue Header */}
          {quickBarShortcuts.length > 0 && (
            <div
              data-testid="header-quick-shortcuts"
              aria-label={t('اختصارات العمليات السريعة', 'Quick Operation Shortcuts')}
              className="flex flex-wrap items-center gap-1.5 border-t border-white/15 py-1.5"
            >
              <span className="text-[11px] font-bold text-blue-100 whitespace-nowrap shrink-0 pe-1">
                {t('وصول سريع:', 'Quick Access:')}
              </span>
              {quickBarShortcuts.map((sc) => {
                const Icon = sc.icon;
                return (
                  <button
                    key={sc.key}
                    type="button"
                    data-testid={`quick-shortcut-${sc.key}`}
                    onClick={sc.onClick}
                    aria-current={sc.isActive ? 'page' : undefined}
                    className={`h-7 px-2.5 rounded-md border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      sc.isActive
                        ? 'bg-white text-[var(--awlad-navy-900)] border-white dark:bg-[#1659C8] dark:text-white dark:border-[#60A5FA]/50 shadow-xs font-black'
                        : 'bg-white/12 hover:bg-white/25 border-white/20 text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{sc.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      <MobileNotificationsSheet
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        notifications={mobileNotifications}
        unreadCount={unreadNotificationCount}
        onMarkAllRead={markNotificationsRead}
        onSelectNotification={handleSelectNotification}
      />

      <MobileServerModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        onSaved={async () => {
          await refreshAuthContext();
          await triggerManualSync();
        }}
      />

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 dark:bg-[#040B17]/75 backdrop-blur-xs no-print"
          onClick={() => setShowLogoutModal(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setShowLogoutModal(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            dir={dir}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg bg-white dark:bg-[#0E1C36] p-3 shadow-2xl border border-slate-200 dark:border-[#21375C] text-start animate-in fade-in zoom-in duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 flex items-center justify-center mx-auto mb-2 border border-red-100 dark:border-red-500/30">
              <AlertTriangle className="w-4 h-4" />
            </div>

            <h3 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC] text-center mb-1">
              {t('هل تريد تسجيل الخروج؟', 'Sign out of your account?')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-[#A9BCD9] text-center mb-3 leading-relaxed">
              {t(
                'سيتم إنهاء جلستك الحالية والعودة لشاشة الدخول. لن يتم فقد أي بيانات تجارية أو فواتير محفوظة.',
                'Your current session will end and return to the login screen. No saved business data or invoices will be lost.'
              )}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowLogoutModal(false);
                  logout();
                }}
                className="flex-1 py-1.5 px-3 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-md shadow-xs transition-colors cursor-pointer"
              >
                {t('نعم، تسجيل الخروج', 'Yes, Sign Out')}
              </button>
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3461] text-slate-700 dark:text-[#DCE6F5] border border-transparent dark:border-[#21375C] text-xs font-bold rounded-md transition-colors cursor-pointer"
              >
                {t('إلغاء والعودة', 'Cancel & Return')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

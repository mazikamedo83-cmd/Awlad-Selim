import React, { useState } from 'react';
import {
  LogOut,
  LayoutGrid,
  LayoutDashboard,
  Boxes,
  Wallet,
  ShoppingCart,
  Maximize,
  Minimize,
  Bell,
  ArrowLeftRight,
  AlertTriangle,
  Server,
  Settings,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { OfflineIndicator } from './OfflineIndicator';
import { NavItemKey } from './Sidebar';
import { MobileNotificationItem, UserPermissions } from '../../types';
import { MobileNotificationsSheet } from '../modules/mobile/MobileNotificationsSheet';
import { MobileServerModal } from '../modules/mobile/MobileServerModal';
import { isMobileAppPlatform } from '../../services/native';

interface HeaderProps {
  currentPage: NavItemKey;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNavigate: (page: NavItemKey) => void;
  onNavigateToTransfers?: () => void;
}

const INVENTORY_KEYS: NavItemKey[] = [
  'products',
  'product-categories',
  'units-settings',
  'warehouses',
  'stock-transfers',
  'stock-transfers-orders',
  'stock-adjustments',
  'stock-counts',
  'damaged-stock',
  'stock-movements',
  'abu-selim-import',
];

const FINANCE_KEYS: NavItemKey[] = [
  'accounts',
  'customer-accounts',
  'supplier-accounts',
  'cashboxes',
  'cashbox-transfer',
  'expenses',
  'personal-accounts',
  'cheques',
  'installments',
];

const SALES_KEYS: NavItemKey[] = [
  'sales-invoices',
  'new-sale',
  'customers',
  'sales-returns',
  'deleted-invoices',
  'customer-orders',
];

export const Header: React.FC<HeaderProps> = ({
  currentPage,
  isSidebarOpen,
  onToggleSidebar,
  onNavigate,
  onNavigateToTransfers,
}) => {
  const { currentUser, logout, hasPermission, refreshAuthContext } = useAuth();
  const {
    repTransfers,
    customerItemOrders = [],
    mobileNotifications = [],
    unreadNotificationCount = 0,
    markNotificationsRead,
    triggerManualSync,
  } = useData();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);

  const canPerm = (perm?: keyof UserPermissions | Array<keyof UserPermissions>) => {
    if (!perm) return true;
    if (currentUser?.role === 'admin') return true;
    if (Array.isArray(perm)) return perm.some((p) => hasPermission(p));
    return hasPermission(perm);
  };

  const hideSectionsNav = isMobileAppPlatform();

  // Primary navigation buttons (Keep الأقسام on Windows; remove ONLY on Android & iOS)
  const primaryNavButtons: Array<{
    key: string;
    label: string;
    icon: React.ElementType;
    active: boolean;
    onClick: () => void;
    controlsDrawer?: boolean;
  }> = [
    ...(!hideSectionsNav
      ? [
          {
            key: 'sections',
            label: 'الأقسام',
            icon: LayoutGrid,
            active: isSidebarOpen,
            onClick: onToggleSidebar,
            controlsDrawer: true,
          },
        ]
      : []),
    {
      key: 'dashboard',
      label: 'الرئيسية',
      icon: LayoutDashboard,
      active: currentPage === 'dashboard',
      onClick: () => onNavigate('dashboard'),
    },
    {
      key: 'inventory',
      label: 'المخزون',
      icon: Boxes,
      active: INVENTORY_KEYS.includes(currentPage),
      onClick: () =>
        onNavigate(
          canPerm('canManageInventory')
            ? 'products'
            : canPerm('canManageWarehouses')
            ? 'warehouses'
            : 'stock-counts'
        ),
    },
    {
      key: 'finance',
      label: 'الحسابات',
      icon: Wallet,
      active: FINANCE_KEYS.includes(currentPage),
      onClick: () =>
        onNavigate(
          canPerm('canManageAccounts')
            ? 'customer-accounts'
            : canPerm('canManageCashboxes')
            ? 'cashboxes'
            : 'cheques'
        ),
    },
    {
      key: 'sales',
      label: 'المبيعات',
      icon: ShoppingCart,
      active: SALES_KEYS.includes(currentPage),
      onClick: () => onNavigate('sales-invoices'),
    },
  ];

  // Check pending transfers & new customer/rep orders
  const pendingTransfersCount = repTransfers.filter((t) => t.status === 'awaiting_receipt').length;
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
        return 'مالك / مدير عام';
      case 'manager':
        return 'مدير فرع';
      case 'accountant':
        return 'محاسب مالي';
      case 'warehouse':
        return 'أمين مستودع';
      case 'sales':
        return 'موظف مبيعات';
      default:
        return 'موظف';
    }
  };

  return (
    <>
      {/* Top Blue Rectangle Header */}
      <header className="sticky top-0 z-30 bg-gradient-to-l from-blue-950 via-blue-900 to-blue-950 text-white shadow-md border-b border-blue-800/80 pt-safe no-print">
        <div className="max-w-7xl mx-auto px-2.5 sm:px-5">
          {/* Top Row: Brand Identity + (Desktop 5 Primary Buttons) + Utility Controls */}
          <div className="h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-3">
            {/* Brand Logo & Name */}
            <div className="flex items-center gap-2.5 min-w-0 shrink-0">
              <img
                src="/awlad-selim-logo.png"
                alt="AWLAD SELIM"
                className="h-9 w-9 sm:h-10 sm:w-10 object-contain bg-white rounded-xl p-1 shadow-xs shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-xs sm:text-sm font-black text-white leading-tight truncate">
                  AWLAD SELIM
                </h1>
                <p className="text-[10px] text-blue-200 font-semibold truncate">
                  {currentUser ? `${currentUser.fullName} · ${getRoleLabel(currentUser.role)}` : 'أولاد سليم'}
                </p>
              </div>
            </div>

            {/* Desktop Center: Exact 5 Navigation Buttons inside the Top Blue Rectangle */}
            <nav
              aria-label="التنقل الرئيسي"
              className="hidden lg:flex items-center justify-center gap-1.5 flex-1 min-w-0"
            >
              {primaryNavButtons.map((btn) => {
                const Icon = btn.icon;
                return (
                  <button
                    key={btn.key}
                    type="button"
                    onClick={btn.onClick}
                    aria-expanded={btn.controlsDrawer ? isSidebarOpen : undefined}
                    aria-controls={btn.controlsDrawer ? 'system-sections-drawer' : undefined}
                    aria-current={!btn.controlsDrawer && btn.active ? 'page' : undefined}
                    className={`min-h-[40px] px-3.5 xl:px-4 py-1.5 rounded-xl text-xs flex items-center gap-2 whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                      btn.active
                        ? 'bg-white text-blue-950 font-black shadow-sm'
                        : 'bg-white/10 text-blue-50 border border-white/15 hover:bg-white/20 hover:text-white font-bold'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{btn.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Left (RTL End): Alerts, Status, Notifications, Server, Fullscreen, Logout */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <OfflineIndicator variant="dark" />

              {pendingOrdersCount > 0 && canPerm('canManageSales') && (
                <button
                  type="button"
                  onClick={() => onNavigate('customer-orders')}
                  title={`يوجد ${pendingOrdersCount} طلب شراء جديد بانتظار المراجعة`}
                  className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-xl bg-sky-400/20 text-sky-100 border border-sky-300/35 text-[11px] font-black hover:bg-sky-400/30 transition-all cursor-pointer whitespace-nowrap"
                >
                  <Bell className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden xl:inline">طلبات جديدة</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-white text-blue-950 text-[10px] font-mono">
                    {pendingOrdersCount}
                  </span>
                </button>
              )}

              {pendingTransfersCount > 0 && onNavigateToTransfers && (
                <button
                  type="button"
                  onClick={onNavigateToTransfers}
                  title={`يوجد ${pendingTransfersCount} طلب تحويل بالنصف معلق`}
                  className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-xl bg-amber-400/20 text-amber-100 border border-amber-300/40 text-[11px] font-bold hover:bg-amber-400/30 transition-all cursor-pointer whitespace-nowrap"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-300 text-amber-950 text-[10px] font-mono">
                    {pendingTransfersCount}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsNotificationsOpen(true);
                  markNotificationsRead();
                }}
                className="relative min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer"
                title="التنبيهات والإشعارات"
                aria-label="التنبيهات والإشعارات"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-red-600 text-white text-[9px] font-black flex items-center justify-center">
                    {unreadNotificationCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsServerModalOpen(true)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer"
                title="عنوان وإعدادات السيرفر المركزي"
                aria-label="إعدادات السيرفر"
              >
                <Server className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('system-settings')}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer"
                title="الإعدادات"
                aria-label="الإعدادات"
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="hidden md:flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer"
                title="ملء الشاشة"
                aria-label="ملء الشاشة"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setShowLogoutModal(true)}
                className="min-h-[38px] px-2.5 sm:px-3 flex items-center justify-center gap-1.5 rounded-xl bg-red-600/90 hover:bg-red-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                title="تسجيل الخروج من النظام"
                aria-label="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">خروج</span>
              </button>
            </div>
          </div>

          {/* Mobile & Tablet (< lg): Primary Navigation Buttons Inside Top Blue Rectangle */}
          <nav
            aria-label="التنقل الرئيسي للجوال"
            className={`lg:hidden border-t border-white/15 py-1.5 grid ${hideSectionsNav ? 'grid-cols-4' : 'grid-cols-5'} gap-1`}
          >
            {primaryNavButtons.map((btn) => {
              const Icon = btn.icon;
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={btn.onClick}
                  aria-expanded={btn.controlsDrawer ? isSidebarOpen : undefined}
                  aria-controls={btn.controlsDrawer ? 'system-sections-drawer' : undefined}
                  aria-current={!btn.controlsDrawer && btn.active ? 'page' : undefined}
                  className={`min-h-[44px] px-1 py-1.5 rounded-xl flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 text-[11px] sm:text-xs whitespace-nowrap transition-all cursor-pointer ${
                    btn.active
                      ? 'bg-white text-blue-950 font-black shadow-sm'
                      : 'bg-white/10 text-blue-50 hover:bg-white/20 font-bold'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="leading-none truncate max-w-full">{btn.label}</span>
                </button>
              );
            })}
          </nav>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs no-print">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-right animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4 border border-red-100">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-slate-900 text-center mb-1">
              هل تريد تسجيل الخروج؟
            </h3>
            <p className="text-xs text-slate-500 text-center mb-6 leading-relaxed">
              سيتم إنهاء جلستك الحالية والعودة لشاشة الدخول. لن يتم فقد أي بيانات تجارية أو فواتير محفوظة.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowLogoutModal(false);
                  logout();
                }}
                className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md transition-colors cursor-pointer"
              >
                نعم، تسجيل الخروج
              </button>
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                إلغاء والعودة
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

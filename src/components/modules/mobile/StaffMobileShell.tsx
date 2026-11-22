import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Wallet,
  Menu,
  Bell,
  Server,
  RefreshCw,
  LogOut,
  X,
  Truck,
  CreditCard,
  Users2,
  Users,
  FileBarChart,
  Shield,
  Settings,
  ArrowDownCircle,
  ArrowUpCircle,
  TrendingDown,
  TrendingUp,
  WifiOff,
  ChevronLeft,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { registerAndroidBackButton } from '../../../services/native';
import { CashOperationType, MobileNotificationItem, UserPermissions } from '../../../types';
import { NavItemKey } from '../../layout/Sidebar';
import { MobileNotificationsSheet } from './MobileNotificationsSheet';
import { MobileServerModal } from './MobileServerModal';
import { ConfirmDialog } from '../../common/ConfirmDialog';

interface StaffMobileShellProps {
  currentPage: NavItemKey;
  onNavigate: (page: NavItemKey) => void;
  onOpenCashOp: (mode: CashOperationType) => void;
  children: React.ReactNode;
}

interface LauncherItem {
  key: NavItemKey;
  label: string;
  permission?: keyof UserPermissions | Array<keyof UserPermissions>;
  allowAllStaff?: boolean;
  badge?: string;
}

interface LauncherSection {
  id: string;
  title: string;
  icon: React.ElementType;
  colorClass: string;
  permission?: keyof UserPermissions | Array<keyof UserPermissions>;
  items: LauncherItem[];
}

export const StaffMobileShell: React.FC<StaffMobileShellProps> = ({
  currentPage,
  onNavigate,
  onOpenCashOp,
  children,
}) => {
  const { currentUser, hasPermission, logout, refreshAuthContext } = useAuth();
  const data = useData();

  const [isLauncherOpen, setIsLauncherOpen] = useState(false);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Record<string, boolean>>({});
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSectionIds((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const checkPerm = (perm?: keyof UserPermissions | Array<keyof UserPermissions>) => {
    if (!perm) return true;
    if (currentUser?.role === 'admin') return true;
    if (Array.isArray(perm)) return perm.some((p) => hasPermission(p));
    return hasPermission(perm);
  };

  // Android hardware back button handling: close sheets/modals first, else go back to dashboard
  useEffect(() => {
    return registerAndroidBackButton(() => {
      if (showLogoutConfirm) {
        setShowLogoutConfirm(false);
        return true;
      }
      if (isNotificationsOpen) {
        setIsNotificationsOpen(false);
        return true;
      }
      if (isServerModalOpen) {
        setIsServerModalOpen(false);
        return true;
      }
      if (isLauncherOpen) {
        setIsLauncherOpen(false);
        return true;
      }
      if (currentPage !== 'dashboard') {
        onNavigate('dashboard');
        return true;
      }
      return false;
    });
  }, [showLogoutConfirm, isNotificationsOpen, isServerModalOpen, isLauncherOpen, currentPage, onNavigate]);

  // Close drawer cleanly via Escape key on desktop/tablet keyboards
  useEffect(() => {
    if (!isLauncherOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLauncherOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isLauncherOpen]);

  const sections: LauncherSection[] = useMemo(
    () => [
      {
        id: 'sales',
        title: 'المبيعات والعملاء',
        icon: ShoppingCart,
        colorClass: 'bg-blue-50 text-blue-900 border-blue-200',
        permission: 'canManageSales',
        items: [
          { key: 'customer-orders', label: 'طلبات العملاء والمندوبين' },
          { key: 'new-sale', label: 'فاتورة مبيعات جديدة (+)', badge: 'سريع' },
          { key: 'sales-invoices', label: 'فواتير المبيعات' },
          { key: 'quotes', label: 'عروض الأسعار', badge: 'جديد' },
          { key: 'customers', label: 'دليل العملاء والأرصدة والتحصيل' },
          { key: 'sales-returns', label: 'مرتجع المبيعات' },
          { key: 'deleted-invoices', label: 'الفواتير المحذوفة والملغاة', permission: 'canViewDeletedInvoices' },
        ],
      },
      {
        id: 'purchases',
        title: 'المشتريات والموردون',
        icon: Truck,
        colorClass: 'bg-purple-50 text-purple-900 border-purple-200',
        permission: ['canManagePurchases', 'canCreatePurchase'],
        items: [
          { key: 'new-purchase', label: 'فاتورة شراء جديدة (+)' },
          { key: 'purchase-invoices', label: 'فواتير المشتريات' },
          { key: 'suppliers', label: 'دليل الموردين والأرصدة والتسويات' },
          { key: 'purchase-returns', label: 'مرتجع المشتريات', permission: 'canManagePurchases' },
        ],
      },
      {
        id: 'inventory',
        title: 'المخازن والمنتجات',
        icon: Boxes,
        colorClass: 'bg-amber-50 text-amber-900 border-amber-200',
        permission: 'canManageInventory',
        items: [
          { key: 'products', label: 'المنتجات والأسعار والباركود' },
          { key: 'product-categories', label: 'تصنيفات السلع' },
          { key: 'units-settings', label: 'الوحدات ومعاملات التحويل', permission: ['canManageInventory', 'canManageSettings'] },
          { key: 'warehouses', label: 'أرصدة المستودعات', permission: 'canManageWarehouses' },
          {
            key: 'stock-transfers-orders',
            label: 'أوامر تحويل الأصناف',
            permission: ['canCreateStockTransfer', 'canApproveStockTransfer', 'canExecuteStockTransfer', 'canManageInventory'],
          },
          {
            key: 'stock-counts',
            label: 'جرد المخزن المعتمد',
            permission: ['canCreateStockCount', 'canApproveStockCount', 'canManageInventory'],
          },
          { key: 'stock-transfers', label: 'تحويل سريع بين المستودعات' },
          { key: 'stock-adjustments', label: 'تسوية سريعة للمخزون' },
          { key: 'damaged-stock', label: 'بضاعة تالفة ومنتهية' },
          { key: 'stock-movements', label: 'سجل حركة الأصناف' },
          { key: 'item-movement-report', label: 'تقرير حركة الصنف المفصل', badge: 'مفصل', permission: ['canManageInventory', 'canViewReports'] },
          { key: 'abu-selim-import', label: 'استيراد الملفات' },
        ],
      },
      {
        id: 'finance',
        title: 'المالية والخزائن',
        icon: Wallet,
        colorClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
        permission: 'canManageCashboxes',
        items: [
          { key: 'cashboxes', label: 'الخزائن والبنوك والحركة النقدية' },
          { key: 'cashbox-transfer', label: 'تحويل بين الخزائن' },
          { key: 'expenses', label: 'المصروفات والإيرادات' },
          { key: 'personal-accounts', label: 'الحسابات الشخصية للملاك', permission: 'canViewPersonalAccounts' },
        ],
      },
      {
        id: 'cheques',
        title: 'الشيكات والأقساط',
        icon: CreditCard,
        colorClass: 'bg-indigo-50 text-indigo-900 border-indigo-200',
        permission: 'canManageAccounts',
        items: [
          { key: 'cheques', label: 'الشيكات (واردة / صادرة)' },
          { key: 'installments', label: 'إدارة وجدولة الأقساط' },
        ],
      },
      {
        id: 'reps',
        title: 'المندوبون والتحويلات',
        icon: Users2,
        colorClass: 'bg-cyan-50 text-cyan-900 border-cyan-200',
        permission: 'canManageReps',
        items: [
          { key: 'reps', label: 'قائمة المناديب والعهد' },
          { key: 'rep-transfers', label: 'طلب تحويل بالنصف (المالي)', permission: 'canManageTransfers' },
          { key: 'rep-item-transfers', label: 'تحويل أصناف وعهدة للمناديب', permission: 'canManageTransfers' },
        ],
      },
      {
        id: 'hr',
        title: 'الموظفون والرواتب',
        icon: Users,
        colorClass: 'bg-rose-50 text-rose-900 border-rose-200',
        permission: 'canManageEmployees',
        items: [
          { key: 'employees', label: 'شؤون الموظفين' },
          { key: 'attendance', label: 'الحضور والغياب' },
          { key: 'advances', label: 'السلف والخصومات والمكافآت', permission: 'canManageSalaries' },
          { key: 'payroll', label: 'مسير صرف الرواتب', permission: 'canManageSalaries' },
        ],
      },
      {
        id: 'reports-users',
        title: 'التقارير والمستخدمون',
        icon: FileBarChart,
        colorClass: 'bg-slate-100 text-slate-900 border-slate-300',
        items: [
          { key: 'reports', label: 'جميع التقارير والأرباح', permission: 'canViewReports' },
          { key: 'item-movement-report', label: 'تقرير حركة الصنف المفصل', permission: ['canViewReports', 'canManageInventory'] },
          { key: 'users', label: 'إدارة المستخدمين والصلاحيات', permission: 'canManageUsers' },
          { key: 'audit-log', label: 'سجل العمليات (Audit)', permission: 'canManageUsers' },
        ],
      },
      {
        id: 'settings',
        title: 'الإعدادات والنسخ الاحتياطي',
        icon: Settings,
        colorClass: 'bg-slate-100 text-slate-900 border-slate-300',
        permission: 'canManageSettings',
        items: [
          { key: 'system-settings', label: 'إعدادات النظام والحساب', allowAllStaff: true },
          { key: 'branches-settings', label: 'الفروع', permission: 'canManageSettings' },
          { key: 'barcode-settings', label: 'إعدادات الباركود', permission: 'canManageSettings' },
          { key: 'printers-settings', label: 'الطابعات المتعددة', permission: 'canManageSettings' },
          { key: 'invoice-settings', label: 'تصميم الفاتورة', permission: 'canManageSettings' },
          { key: 'mobile-settings', label: 'إعدادات تطبيق العملاء والمناديب', permission: 'canManageSettings' },
          { key: 'online-sync-settings', label: 'المزامنة أونلاين', permission: 'canManageSettings' },
          { key: 'services-settings', label: 'الخدمات والتنبيهات', permission: 'canManageSettings' },
          { key: 'server-settings', label: 'إعدادات السيرفر والاتصال', permission: 'canManageSettings' },
          { key: 'diagnostics-settings', label: 'سجل التشخيص والأخطاء', permission: 'canManageSettings' },
          { key: 'backup', label: 'النسخ الاحتياطي والاستعادة', permission: 'canManageSettings' },
          { key: 'migration', label: 'PostgreSQL وسجل الترحيل', permission: 'canManageSettings' },
        ],
      },
    ],
    []
  );

  const filteredSections = useMemo(
    () =>
      sections
        .map((sec) => {
          const secAllowed = checkPerm(sec.permission);
          const allowedItems = sec.items.filter((item) => {
            if (item.allowAllStaff) return true;
            if (item.permission) return checkPerm(item.permission);
            return secAllowed;
          });
          return { ...sec, items: allowedItems };
        })
        .filter((sec) => sec.items.length > 0),
    [sections, currentUser]
  );

  const getRoleArabicLabel = (role?: string) => {
    switch (role) {
      case 'admin':
        return 'مدير عام / الإدارة';
      case 'manager':
        return 'مدير فرع';
      case 'accountant':
        return 'محاسب مالي';
      case 'sales':
        return 'موظف مبيعات';
      case 'warehouse':
        return 'أمين مستودع';
      case 'purchases':
        return 'موظف مشتريات';
      default:
        return 'موظف';
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
      'quotes',
      'purchase-invoices',
      'cashboxes',
      'item-movement-report',
    ];
    if (item.targetTab && allowedTargets.includes(item.targetTab as NavItemKey)) {
      onNavigate(item.targetTab as NavItemKey);
    } else {
      onNavigate('dashboard');
    }
  };

  // Primary top navigation tabs scoped strictly by actual Windows permissions
  const topNavTabs = useMemo(() => {
    const tabs: Array<{ key: string; label: string; icon: React.ElementType; active: boolean; onClick: () => void }> = [
      {
        key: 'dashboard',
        label: 'الرئيسية',
        icon: LayoutDashboard,
        active: currentPage === 'dashboard',
        onClick: () => {
          setIsLauncherOpen(false);
          onNavigate('dashboard');
        },
      },
    ];

    if (checkPerm('canManageSales')) {
      tabs.push({
        key: 'sales',
        label: 'المبيعات',
        icon: ShoppingCart,
        active: ['sales-invoices', 'new-sale', 'customers', 'sales-returns', 'deleted-invoices'].includes(currentPage),
        onClick: () => {
          setIsLauncherOpen(false);
          onNavigate('sales-invoices');
        },
      });
    } else if (checkPerm('canManagePurchases')) {
      tabs.push({
        key: 'purchases',
        label: 'المشتريات',
        icon: Truck,
        active: ['purchase-invoices', 'new-purchase', 'suppliers', 'purchase-returns'].includes(currentPage),
        onClick: () => {
          setIsLauncherOpen(false);
          onNavigate('purchase-invoices');
        },
      });
    }

    if (checkPerm(['canManageInventory', 'canManageWarehouses', 'canCreateStockCount', 'canCreateStockTransfer'])) {
      tabs.push({
        key: 'inventory',
        label: 'المخزون',
        icon: Boxes,
        active: [
          'products',
          'product-categories',
          'units-settings',
          'warehouses',
          'stock-transfers',
          'stock-transfers-orders',
          'stock-counts',
          'stock-adjustments',
          'damaged-stock',
          'stock-movements',
          'abu-selim-import',
        ].includes(currentPage),
        onClick: () => {
          setIsLauncherOpen(false);
          onNavigate(checkPerm('canManageInventory') ? 'products' : 'stock-counts');
        },
      });
    }

    if (checkPerm(['canManageCashboxes', 'canManageAccounts'])) {
      tabs.push({
        key: 'finance',
        label: 'المالية',
        icon: Wallet,
        active: ['cashboxes', 'cashbox-transfer', 'expenses', 'personal-accounts', 'cheques', 'installments'].includes(
          currentPage
        ),
        onClick: () => {
          setIsLauncherOpen(false);
          onNavigate(checkPerm('canManageCashboxes') ? 'cashboxes' : 'cheques');
        },
      });
    } else if (checkPerm('canViewReports')) {
      tabs.push({
        key: 'reports',
        label: 'التقارير',
        icon: FileBarChart,
        active: currentPage === 'reports',
        onClick: () => {
          setIsLauncherOpen(false);
          onNavigate('reports');
        },
      });
    }

    return tabs;
  }, [currentPage, currentUser, onNavigate]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-['Cairo'] antialiased pb-6">
      {/* Unified Blue Top Header Bar */}
      <header className="sticky top-0 z-30 bg-blue-950 text-white shadow-md pt-safe no-print">
        <div className="max-w-7xl mx-auto px-2.5 sm:px-5">
          {/* Desktop single-row / Mobile row 1: Brand + (Desktop inline nav) + Utility actions */}
          <div className="h-14 flex items-center justify-between gap-2 sm:gap-4">
            {/* Brand & Identity */}
            <div className="flex items-center gap-2.5 min-w-0 shrink">
              <img
                src="/awlad-selim-logo.png"
                alt="AWLAD SELIM"
                className="h-9 w-9 object-contain bg-white rounded-xl p-1 shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-xs sm:text-sm font-black truncate leading-tight">AWLAD SELIM</h1>
                <p className="text-[10px] text-blue-200 truncate">
                  {getRoleArabicLabel(currentUser?.role)} · {currentUser?.fullName}
                </p>
              </div>
            </div>

            {/* Primary Navigation + الأقسام Button (Single-row on lg+ screens) */}
            <nav
              aria-label="التنقل الرئيسي"
              className="hidden lg:flex items-center gap-1.5 flex-1 justify-center min-w-0"
            >
              <button
                type="button"
                onClick={() => setIsLauncherOpen((prev) => !prev)}
                aria-expanded={isLauncherOpen}
                aria-controls="staff-sections-drawer"
                className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                  isLauncherOpen
                    ? 'bg-sky-400/20 text-white border-sky-300/70'
                    : 'bg-white/10 text-blue-50 border-white/15 hover:bg-white/20 hover:text-white'
                }`}
              >
                <Menu className="w-4 h-4 shrink-0" />
                <span>الأقسام</span>
              </button>

              <div className="h-5 w-px bg-white/15 mx-0.5 shrink-0" aria-hidden="true" />

              {topNavTabs.map((tab) => {
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={tab.onClick}
                    aria-current={tab.active ? 'page' : undefined}
                    className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      tab.active
                        ? 'bg-white text-blue-950 font-black shadow-xs'
                        : 'text-blue-100 hover:bg-white/10 hover:text-white font-bold'
                    }`}
                  >
                    <TabIcon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Right Utility Controls */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsNotificationsOpen(true);
                  data.markNotificationsRead();
                }}
                className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="التنبيهات والإشعارات"
                aria-label="الإشعارات"
              >
                <Bell className="w-4 h-4" />
                {data.unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center">
                    {data.unreadNotificationCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsServerModalOpen(true)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="عنوان السيرفر المركزي"
                aria-label="إعدادات السيرفر"
              >
                <Server className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => data.triggerManualSync()}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="تحديث ومزامنة"
                aria-label="تحديث ومزامنة"
              >
                <RefreshCw className={`w-4 h-4 ${data.networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-red-600/90 hover:bg-red-700 text-white cursor-pointer"
                title="تسجيل الخروج"
                aria-label="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mobile & Tablet (< lg) Navigation Strip inside the Blue Top Bar */}
          <nav
            aria-label="أزرار التنقل الرئيسية"
            className="lg:hidden border-t border-white/10 py-1.5 flex items-center justify-between sm:justify-start gap-1 sm:gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
          >
            <button
              type="button"
              onClick={() => setIsLauncherOpen((prev) => !prev)}
              aria-expanded={isLauncherOpen}
              aria-controls="staff-sections-drawer"
              className={`min-h-[40px] px-2 sm:px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                isLauncherOpen
                  ? 'bg-sky-400/20 text-white border-sky-300/70'
                  : 'bg-white/10 text-blue-50 border-white/15 hover:bg-white/20 hover:text-white'
              }`}
            >
              <Menu className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>الأقسام</span>
            </button>

            <div className="h-5 w-px bg-white/15 shrink-0" aria-hidden="true" />

            {topNavTabs.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={tab.onClick}
                  aria-current={tab.active ? 'page' : undefined}
                  className={`min-h-[40px] px-2 sm:px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    tab.active
                      ? 'bg-white text-blue-950 font-black shadow-xs'
                      : 'text-blue-100 hover:bg-white/10 hover:text-white font-bold'
                  }`}
                >
                  <TabIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-3 sm:p-5 space-y-3">
        {(data.isUsingOfflineCache || data.networkStatus === 'disconnected') && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-center justify-between gap-2 no-print">
            <div className="flex items-center gap-2 min-w-0">
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="truncate">
                بيانات مخزنة مؤقتاً — تعذر الاتصال بالسيرفر المركزي
                {data.lastCacheTimestamp
                  ? ` · ${new Date(data.lastCacheTimestamp).toLocaleTimeString('ar-EG')}`
                  : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={() => data.triggerManualSync()}
              className="px-3 py-1.5 rounded-xl bg-amber-600 text-white text-[11px] font-bold shrink-0 cursor-pointer"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {children}
      </main>

      {/* Side Drawer Backdrop */}
      {isLauncherOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-xs transition-opacity no-print"
          onClick={() => setIsLauncherOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* RTL Sliding Side Drawer (Triggered exclusively by «الأقسام» button) */}
      <aside
        id="staff-sections-drawer"
        aria-label="قائمة الأقسام الجانبية"
        aria-hidden={!isLauncherOpen}
        className={`fixed inset-y-0 right-0 z-50 w-[86vw] max-w-[340px] sm:w-80 lg:w-96 bg-white text-slate-800 shadow-2xl border-l border-slate-200 flex flex-col pt-safe pb-safe transition-transform duration-200 ease-out no-print ${
          isLauncherOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
        }`}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-200 bg-blue-950 text-white shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/awlad-selim-logo.png"
              alt="AWLAD SELIM"
              className="h-8 w-8 object-contain bg-white rounded-lg p-1 shrink-0"
            />
            <div className="min-w-0">
              <h2 className="text-sm font-black truncate">أقسام النظام</h2>
              <p className="text-[11px] text-blue-200 truncate">
                {getRoleArabicLabel(currentUser?.role)} · {currentUser?.fullName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsLauncherOpen(false)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer shrink-0"
            aria-label="إغلاق القائمة الجانبية"
            title="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Scrollable Sections & Sub-Functions */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50/70">
          {/* Quick Dashboard Link */}
          <button
            type="button"
            onClick={() => {
              setIsLauncherOpen(false);
              onNavigate('dashboard');
            }}
            className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-xs font-bold border transition-colors cursor-pointer ${
              currentPage === 'dashboard'
                ? 'bg-blue-950 text-white border-blue-950 shadow-xs font-black'
                : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>لوحة التحكم الرئيسية</span>
            </div>
            <ChevronLeft className={`w-4 h-4 shrink-0 ${currentPage === 'dashboard' ? 'text-blue-200' : 'text-slate-400'}`} />
          </button>

          {/* Quick Cash Operations (if cashbox permission granted) */}
          {checkPerm('canManageCashboxes') && (
            <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-3 space-y-2">
              <p className="text-xs font-black text-emerald-950">العمليات النقدية السريعة</p>
              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setIsLauncherOpen(false);
                    onOpenCashOp('cash_deposit');
                  }}
                  className="min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                >
                  <ArrowDownCircle className="w-4 h-4 shrink-0" />
                  <span>إيداع نقدي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsLauncherOpen(false);
                    onOpenCashOp('cash_withdrawal');
                  }}
                  className="min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-white border border-rose-200 text-rose-800 hover:bg-rose-50 cursor-pointer"
                >
                  <ArrowUpCircle className="w-4 h-4 shrink-0" />
                  <span>سحب نقدي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsLauncherOpen(false);
                    onOpenCashOp('expense');
                  }}
                  className="min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-white border border-orange-200 text-orange-800 hover:bg-orange-50 cursor-pointer"
                >
                  <TrendingDown className="w-4 h-4 shrink-0" />
                  <span>مصروف</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsLauncherOpen(false);
                    onOpenCashOp('profit_deposit');
                  }}
                  className="min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-white border border-teal-200 text-teal-800 hover:bg-teal-50 cursor-pointer"
                >
                  <TrendingUp className="w-4 h-4 shrink-0" />
                  <span>إيداع ربحي</span>
                </button>
              </div>
            </div>
          )}

          {/* Filtered System Sections */}
          {filteredSections.map((sec) => {
            const SecIcon = sec.icon;
            const isSectionCollapsed = Boolean(collapsedSectionIds[sec.id]);
            return (
              <div key={sec.id} className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-2xs">
                <button
                  type="button"
                  onClick={() => toggleSectionCollapse(sec.id)}
                  aria-expanded={!isSectionCollapsed}
                  className={`w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-black cursor-pointer ${
                    !isSectionCollapsed ? 'border-b ' : ''
                  }${sec.colorClass}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <SecIcon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{sec.title}</span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 transition-transform duration-150 ${
                      isSectionCollapsed ? 'rotate-90' : ''
                    }`}
                  />
                </button>

                {!isSectionCollapsed && (
                  <div className="divide-y divide-slate-100">
                    {sec.items.map((item) => {
                      const active = currentPage === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            setIsLauncherOpen(false);
                            onNavigate(item.key);
                          }}
                          className={`w-full min-h-[44px] px-4 py-2.5 flex items-center justify-between gap-2 text-right text-xs font-bold transition-colors cursor-pointer ${
                            active ? 'bg-blue-50 text-blue-950 font-black' : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{item.label}</span>
                            {item.badge && (
                              <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-[10px] font-black shrink-0">
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <ChevronLeft className={`w-4 h-4 shrink-0 ${active ? 'text-blue-700' : 'text-slate-400'}`} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <MobileNotificationsSheet
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        notifications={data.mobileNotifications}
        unreadCount={data.unreadNotificationCount}
        onMarkAllRead={data.markNotificationsRead}
        onSelectNotification={handleSelectNotification}
      />

      <MobileServerModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        onSaved={async () => {
          await refreshAuthContext();
          await data.triggerManualSync();
        }}
      />

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          logout();
        }}
        variant="danger"
        title="هل تريد تسجيل الخروج؟"
        message="سيتم إنهاء جلستك الحالية والعودة إلى شاشة الدخول الموحدة."
        confirmLabel="نعم، تسجيل الخروج"
      />
    </div>
  );
};

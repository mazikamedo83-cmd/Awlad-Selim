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
  Settings,
  ArrowDownCircle,
  ArrowUpCircle,
  ArrowLeftRight,
  TrendingDown,
  TrendingUp,
  WifiOff,
  ChevronLeft,
  ChevronDown,
  Maximize,
  Minimize,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { registerAndroidBackButton } from '../../../services/native';
import { CashOperationType, MobileNotificationItem, UserPermissions } from '../../../types';
import { NavItemKey } from '../../../config/navigation';
import { UI_CLASSES } from '../../../styles/designSystem';
import { MobileNotificationsSheet } from './MobileNotificationsSheet';
import { MobileServerModal } from './MobileServerModal';
import { SyncCenterModal } from '../../common/SyncCenterModal';
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
  headerGradientClass: string;
  iconBadgeClass: string;
  permission?: keyof UserPermissions | Array<keyof UserPermissions>;
  items: LauncherItem[];
}

export const StaffMobileShell: React.FC<StaffMobileShellProps> = ({
  currentPage,
  onNavigate,
  onOpenCashOp,
  children,
}) => {
  const { currentUser, hasPermission, logout, refreshAuthContext, isOfflineSession, permissionsMayBeStale } = useAuth();
  const data = useData();

  const [isLauncherOpen, setIsLauncherOpen] = useState(false);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Record<string, boolean>>({});
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isSyncCenterOpen, setIsSyncCenterOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSectionIds((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const toggleFullscreen = () => {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
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
      if (isSyncCenterOpen) {
        setIsSyncCenterOpen(false);
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
  }, [showLogoutConfirm, isNotificationsOpen, isServerModalOpen, isSyncCenterOpen, isLauncherOpen, currentPage, onNavigate]);

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
        headerGradientClass: 'bg-gradient-to-l from-blue-50/95 via-sky-50/80 to-indigo-50/65 text-blue-950 border-blue-100/90',
        iconBadgeClass: 'bg-gradient-to-br from-blue-600/15 to-indigo-500/15 text-blue-800',
        permission: 'canManageSales',
        items: [
          { key: 'new-sale', label: 'فاتورة مبيعات جديدة (+)', badge: 'سريع' },
          { key: 'sales-invoices', label: 'فواتير المبيعات' },
          { key: 'customers', label: 'دليل العملاء والأرصدة والتحصيل' },
          { key: 'customer-orders', label: 'طلبات العملاء والمناديب', badge: 'موحد' },
          { key: 'sales-returns', label: 'مرتجع المبيعات' },
          { key: 'deleted-invoices', label: 'الفواتير المحذوفة والملغاة', permission: 'canViewDeletedInvoices' },
        ],
      },
      {
        id: 'purchases',
        title: 'المشتريات والموردون',
        icon: Truck,
        headerGradientClass: 'bg-gradient-to-l from-indigo-50/90 via-blue-50/75 to-violet-50/70 text-indigo-950 border-indigo-100/90',
        iconBadgeClass: 'bg-gradient-to-br from-indigo-600/15 to-violet-500/15 text-indigo-800',
        permission: 'canManagePurchases',
        items: [
          { key: 'new-purchase', label: 'فاتورة شراء جديدة (+)' },
          { key: 'purchase-invoices', label: 'فواتير المشتريات' },
          { key: 'suppliers', label: 'دليل الموردين والأرصدة والتسويات' },
          { key: 'purchase-returns', label: 'مرتجع المشتريات' },
        ],
      },
      {
        id: 'inventory',
        title: 'المخازن والمنتجات',
        icon: Boxes,
        headerGradientClass: 'bg-gradient-to-l from-sky-50/95 via-blue-50/80 to-indigo-50/65 text-blue-950 border-sky-100/90',
        iconBadgeClass: 'bg-gradient-to-br from-sky-600/15 to-blue-600/15 text-blue-800',
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
          { key: 'abu-selim-import', label: 'استيراد الملفات' },
        ],
      },
      {
        id: 'finance',
        title: 'المالية والخزائن',
        icon: Wallet,
        headerGradientClass: 'bg-gradient-to-l from-blue-50/90 via-indigo-50/75 to-violet-50/70 text-blue-950 border-blue-100/90',
        iconBadgeClass: 'bg-gradient-to-br from-blue-700/15 to-violet-500/15 text-indigo-800',
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
        headerGradientClass: 'bg-gradient-to-l from-violet-50/85 via-indigo-50/75 to-blue-50/70 text-indigo-950 border-indigo-100/90',
        iconBadgeClass: 'bg-gradient-to-br from-violet-600/15 to-blue-600/15 text-indigo-800',
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
        headerGradientClass: 'bg-gradient-to-l from-sky-50/90 via-blue-50/80 to-violet-50/65 text-blue-950 border-sky-100/90',
        iconBadgeClass: 'bg-gradient-to-br from-sky-600/15 to-indigo-600/15 text-blue-800',
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
        headerGradientClass: 'bg-gradient-to-l from-indigo-50/85 via-slate-50/90 to-blue-50/75 text-slate-900 border-indigo-100/90',
        iconBadgeClass: 'bg-gradient-to-br from-indigo-600/15 to-blue-600/15 text-indigo-800',
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
        headerGradientClass: 'bg-gradient-to-l from-blue-50/85 via-slate-50/95 to-violet-50/65 text-slate-900 border-blue-100/90',
        iconBadgeClass: 'bg-gradient-to-br from-blue-600/15 to-violet-500/15 text-blue-900',
        items: [
          { key: 'reports', label: 'جميع التقارير والأرباح', permission: 'canViewReports' },
          { key: 'users', label: 'إدارة المستخدمين والصلاحيات', permission: 'canManageUsers' },
          { key: 'audit-log', label: 'سجل العمليات (Audit)', permission: 'canManageUsers' },
        ],
      },
      {
        id: 'settings',
        title: 'الإعدادات والنسخ الاحتياطي',
        icon: Settings,
        headerGradientClass: 'bg-gradient-to-l from-slate-100/85 via-blue-50/70 to-indigo-50/65 text-slate-900 border-slate-200/90',
        iconBadgeClass: 'bg-gradient-to-br from-slate-600/15 to-indigo-600/15 text-slate-800',
        permission: 'canManageSettings',
        items: [
          { key: 'system-settings', label: 'إعدادات النظام والحساب', allowAllStaff: true },
          { key: 'shortcuts-settings', label: 'اختصارات لوحة المفاتيح', allowAllStaff: true },
          { key: 'branches-settings', label: 'الفروع', permission: 'canManageSettings' },
          { key: 'barcode-settings', label: 'إعدادات الباركود', permission: 'canManageSettings' },
          { key: 'printers-settings', label: 'الطابعات المتعددة', permission: 'canManageSettings' },
          { key: 'invoice-settings', label: 'تصميم الفاتورة', permission: 'canManageSettings' },
          { key: 'mobile-settings', label: 'إعدادات تطبيق العملاء والمناديب', permission: 'canManageSettings' },
          { key: 'online-sync-settings', label: 'المزامنة أونلاين', permission: 'canManageSettings' },
          { key: 'services-settings', label: 'الخدمات والتنبيهات', permission: 'canManageSettings' },
          { key: 'server-settings', label: 'إعدادات السيرفر والاتصال', permission: 'canManageSettings' },
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

  // Auto-expand section containing the active page
  useEffect(() => {
    if (currentPage === 'dashboard') return;
    const owner = filteredSections.find((sec) => sec.items.some((it) => it.key === currentPage));
    if (owner) {
      setCollapsedSectionIds((prev) => (prev[owner.id] ? { ...prev, [owner.id]: false } : prev));
    }
  }, [currentPage, filteredSections]);

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
      default:
        return 'موظف';
    }
  };

  const handleSelectNotification = (item: MobileNotificationItem) => {
    const allowedTargets: NavItemKey[] = [
      'customers',
      'customer-orders',
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

  const pendingTransfersCount = useMemo(
    () => (data.repTransfers || []).filter((t) => t.status === 'awaiting_receipt').length,
    [data.repTransfers]
  );

  // Exact top bar order after «الأقسام»:
  // 2. الرئيسية  3. المخزون  4. المالية  5. المبيعات
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

    if (checkPerm('canManageSales')) {
      tabs.push({
        key: 'sales',
        label: 'المبيعات',
        icon: ShoppingCart,
        active: ['sales-invoices', 'new-sale', 'customers', 'customer-orders', 'sales-returns', 'deleted-invoices'].includes(currentPage),
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

    return tabs;
  }, [currentPage, currentUser, onNavigate]);

  const statusDotClass =
    data.networkStatus === 'connected'
      ? 'bg-emerald-400'
      : data.networkStatus === 'synchronizing'
      ? 'bg-sky-400 animate-pulse'
      : data.networkStatus === 'pending'
      ? 'bg-amber-400'
      : 'bg-rose-400';

  return (
    <div className={UI_CLASSES.appShell}>
      {/* Unified Blue Top Header Bar (Desktop, Windows, Android, iOS) */}
      <header className={UI_CLASSES.blueHeaderBar}>
        <div className="max-w-7xl mx-auto px-2.5 sm:px-5">
          {/* Row 1: Brand + (Desktop inline 5-button nav) + Utility actions */}
          <div className="h-14 flex items-center justify-between gap-2 sm:gap-4">
            {/* Brand & Identity */}
            <div className="flex items-center gap-2.5 min-w-0 shrink">
              <img
                src="/awlad-selim-logo.png"
                alt="AWLAD SELIM"
                className="h-9 w-9 object-contain bg-white rounded-xl p-1 shrink-0 shadow-xs"
              />
              <div className="min-w-0">
                <h1 className="text-xs sm:text-sm font-black truncate leading-tight tracking-wide">AWLAD SELIM</h1>
                <p className="text-[10px] text-blue-200 truncate">
                  {getRoleArabicLabel(currentUser?.role)} · {currentUser?.fullName}
                </p>
              </div>
            </div>

            {/* 5 Primary Buttons in Exact Order on Desktop (lg+):
                1. الأقسام  2. الرئيسية  3. المخزون  4. المالية  5. المبيعات */}
            <nav
              aria-label="التنقل الرئيسي"
              className="hidden lg:flex items-center gap-1.5 flex-1 justify-center min-w-0"
            >
              <button
                type="button"
                onClick={() => setIsLauncherOpen((prev) => !prev)}
                aria-expanded={isLauncherOpen}
                aria-controls="staff-sections-drawer"
                className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 border transition-all cursor-pointer ${
                  isLauncherOpen
                    ? 'bg-gradient-to-l from-sky-400/30 via-blue-400/25 to-violet-400/30 text-white border-sky-200/75 shadow-sm'
                    : 'bg-white/10 text-blue-50 border-white/20 hover:bg-white/20 hover:text-white'
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
                    className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                      tab.active
                        ? 'bg-gradient-to-l from-white via-blue-50 to-indigo-50 text-blue-950 font-black shadow-sm ring-1 ring-white/70'
                        : 'text-blue-100 hover:bg-white/12 hover:text-white font-bold'
                    }`}
                  >
                    <TabIcon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Right/End Utility Controls */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              {pendingTransfersCount > 0 && checkPerm('canManageTransfers') && (
                <button
                  type="button"
                  onClick={() => {
                    setIsLauncherOpen(false);
                    onNavigate('rep-transfers');
                  }}
                  title={`يوجد ${pendingTransfersCount} طلب تحويل بالنصف معلق يحتاج تأكيد`}
                  className="hidden sm:flex items-center gap-1 px-2.5 min-h-[38px] rounded-xl bg-amber-400/20 hover:bg-amber-400/30 border border-amber-300/40 text-amber-100 text-[11px] font-bold cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="hidden xl:inline">تحويل بالنصف</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black font-mono">
                    {pendingTransfersCount}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsSyncCenterOpen(true)}
                title={
                  data.networkStatus === 'connected'
                    ? 'متصل بالشبكة المركزية — اضغط لفتح مركز المزامنة'
                    : data.networkStatus === 'synchronizing'
                    ? 'جاري المزامنة مع السيرفر المركزي...'
                    : 'وضع العمل المحلي / دون اتصال — اضغط لفتح مركز المزامنة'
                }
                className="relative flex items-center gap-1.5 px-2.5 min-h-[38px] rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] font-bold text-blue-100 cursor-pointer transition-colors"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass}`} />
                <span className="hidden xl:inline">
                  {data.networkStatus === 'connected' ? 'متصل' : data.networkStatus === 'synchronizing' ? 'مزامنة' : 'محلي'}
                </span>
                {(data.pendingSyncCount + data.failedSyncCount + data.conflictsCount) > 0 && (
                  <span
                    className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${
                      data.conflictsCount > 0 || data.failedSyncCount > 0
                        ? 'bg-rose-500 text-white'
                        : 'bg-amber-400 text-slate-950'
                    }`}
                  >
                    {data.pendingSyncCount + data.failedSyncCount + data.conflictsCount}
                  </span>
                )}
              </button>

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
                onClick={toggleFullscreen}
                className="hidden md:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="ملء الشاشة"
                aria-label="ملء الشاشة"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
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

          {/* Mobile & Tablet (< lg): All 5 primary buttons inside the SAME Blue Top Header */}
          <nav
            aria-label="أزرار التنقل الرئيسية"
            className="lg:hidden border-t border-white/15 py-1.5 flex items-center justify-between gap-1 sm:gap-1.5"
          >
            <button
              type="button"
              onClick={() => setIsLauncherOpen((prev) => !prev)}
              aria-expanded={isLauncherOpen}
              aria-controls="staff-sections-drawer"
              className={`flex-1 sm:flex-initial min-h-[40px] px-1.5 sm:px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap border transition-all cursor-pointer ${
                isLauncherOpen
                  ? 'bg-gradient-to-l from-sky-400/30 via-blue-400/25 to-violet-400/30 text-white border-sky-200/75 shadow-sm'
                  : 'bg-white/10 text-blue-50 border-white/20 hover:bg-white/20 hover:text-white'
              }`}
            >
              <Menu className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>الأقسام</span>
            </button>

            {topNavTabs.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={tab.onClick}
                  aria-current={tab.active ? 'page' : undefined}
                  className={`flex-1 sm:flex-initial min-h-[40px] px-1.5 sm:px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                    tab.active
                      ? 'bg-gradient-to-l from-white via-blue-50 to-indigo-50 text-blue-950 font-black shadow-sm ring-1 ring-white/70'
                      : 'text-blue-100 hover:bg-white/12 hover:text-white font-bold'
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

      {/* Main Content Area (Original Dashboard & All Views Restored Intact) */}
      <main className="max-w-7xl mx-auto p-3 sm:p-5 space-y-3">
        {(data.isUsingOfflineCache || data.networkStatus === 'disconnected') && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex flex-wrap items-center justify-between gap-2 no-print">
            <div className="flex items-center gap-2 min-w-0">
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="truncate">
                {isOfflineSession
                  ? 'وضع العمل المحلي (دون إنترنت) — يتم حفظ العمليات محلياً وتطبيقها على السيرفر فور عودة الاتصال'
                  : 'بيانات مخزنة مؤقتاً — تعذر الاتصال بالسيرفر المركزي'}
                {permissionsMayBeStale ? ' · الصلاحيات محفوظة من آخر تحقق' : ''}
                {data.lastCacheTimestamp
                  ? ` · ${new Date(data.lastCacheTimestamp).toLocaleTimeString('ar-EG')}`
                  : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsSyncCenterOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-900 text-[11px] font-bold cursor-pointer"
              >
                مركز المزامنة
              </button>
              <button
                type="button"
                onClick={() => data.triggerManualSync()}
                className="px-3 py-1.5 rounded-xl bg-amber-600 text-white text-[11px] font-bold cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </div>
          </div>
        )}

        {(data.pendingSyncCount > 0 || data.failedSyncCount > 0 || data.conflictsCount > 0) && (
          <div
            className={`p-3 rounded-2xl border text-xs font-bold flex flex-wrap items-center justify-between gap-2 no-print ${
              data.conflictsCount > 0 || data.failedSyncCount > 0
                ? 'bg-rose-50 border-rose-300 text-rose-900'
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}
          >
            <span>
              {data.conflictsCount > 0
                ? `يوجد (${data.conflictsCount}) تعارضات مزامنة تحتاج مراجعة قبل الاعتماد النهائي.`
                : data.failedSyncCount > 0
                ? `يوجد (${data.failedSyncCount}) عمليات تعذرت مزامنتها و(${data.pendingSyncCount}) بانتظار الرفع.`
                : `يوجد (${data.pendingSyncCount}) عمليات محلية بانتظار المزامنة (الأرصدة المحلية تقديرية حتى تأكيد السيرفر).`}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsSyncCenterOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-blue-900 text-white text-[11px] font-bold cursor-pointer"
              >
                فتح مركز المزامنة
              </button>
            </div>
          </div>
        )}

        {children}
      </main>

      {/* Side Drawer Backdrop */}
      {isLauncherOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-xs transition-opacity no-print"
          onClick={() => setIsLauncherOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* RTL Soft-Gradient Sliding Side Drawer (Triggered exclusively by «الأقسام» button) */}
      <aside
        id="staff-sections-drawer"
        aria-label="قائمة الأقسام الجانبية"
        aria-hidden={!isLauncherOpen}
        className={`${UI_CLASSES.softGradientDrawer} ${
          isLauncherOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
        }`}
      >
        {/* Drawer Header with Royal Blue -> Indigo Gradient */}
        <div className={UI_CLASSES.drawerHeaderGradient}>
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/awlad-selim-logo.png"
              alt="AWLAD SELIM"
              className="h-9 w-9 object-contain bg-white rounded-xl p-1 shrink-0 shadow-xs"
            />
            <div className="min-w-0">
              <h2 className="text-sm font-black truncate tracking-wide">أقسام النظام</h2>
              <p className="text-[11px] text-blue-200 truncate">
                {getRoleArabicLabel(currentUser?.role)} · {currentUser?.fullName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsLauncherOpen(false)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/12 hover:bg-white/25 border border-white/15 text-white cursor-pointer shrink-0 transition-colors"
            aria-label="إغلاق القائمة الجانبية"
            title="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Scrollable Sections & Sub-Functions */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-gradient-to-b from-slate-50/80 via-blue-50/25 to-indigo-50/40">
          {/* Quick Dashboard Link */}
          <button
            type="button"
            onClick={() => {
              setIsLauncherOpen(false);
              onNavigate('dashboard');
            }}
            className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl flex items-center justify-between text-xs font-bold border transition-all cursor-pointer ${
              currentPage === 'dashboard'
                ? UI_CLASSES.drawerActiveItem
                : 'bg-gradient-to-l from-white via-blue-50/45 to-indigo-50/45 text-slate-800 border-blue-100/90 hover:from-blue-50/80 hover:to-indigo-50/80 shadow-2xs'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                  currentPage === 'dashboard' ? 'bg-white/20 text-white' : 'bg-blue-100/80 text-blue-800'
                }`}
              >
                <LayoutDashboard className="w-4 h-4 shrink-0" />
              </div>
              <span>لوحة التحكم الرئيسية</span>
            </div>
            <ChevronLeft className={`w-4 h-4 shrink-0 ${currentPage === 'dashboard' ? 'text-blue-100' : 'text-slate-400'}`} />
          </button>

          {/* Quick Cash Operations (if cashbox permission granted) */}
          {checkPerm('canManageCashboxes') && (
            <div className="bg-gradient-to-br from-blue-50/85 via-white to-violet-50/75 border border-blue-100/90 rounded-2xl p-3 space-y-2 shadow-2xs">
              <p className="text-xs font-black text-blue-950">العمليات النقدية السريعة</p>
              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setIsLauncherOpen(false);
                    onOpenCashOp('cash_deposit');
                  }}
                  className="min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-white/95 border border-blue-100 text-emerald-700 hover:bg-emerald-50/80 transition-colors cursor-pointer shadow-2xs"
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
                  className="min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-white/95 border border-blue-100 text-rose-700 hover:bg-rose-50/80 transition-colors cursor-pointer shadow-2xs"
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
                  className="min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-white/95 border border-blue-100 text-orange-700 hover:bg-orange-50/80 transition-colors cursor-pointer shadow-2xs"
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
                  className="min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-white/95 border border-blue-100 text-indigo-700 hover:bg-indigo-50/80 transition-colors cursor-pointer shadow-2xs"
                >
                  <TrendingUp className="w-4 h-4 shrink-0" />
                  <span>إيداع ربحي</span>
                </button>
              </div>
            </div>
          )}

          {/* Filtered System Sections with Harmonious Soft Gradients */}
          {filteredSections.map((sec) => {
            const SecIcon = sec.icon;
            const isSectionCollapsed = Boolean(collapsedSectionIds[sec.id]);
            const hasActiveChild = sec.items.some((item) => item.key === currentPage);
            return (
              <div
                key={sec.id}
                className={`rounded-2xl border overflow-hidden bg-white/95 shadow-2xs transition-colors ${
                  hasActiveChild ? 'border-blue-300/90 ring-1 ring-blue-100' : 'border-blue-100/80'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSectionCollapse(sec.id)}
                  aria-expanded={!isSectionCollapsed}
                  className={`w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-black transition-colors cursor-pointer ${
                    !isSectionCollapsed ? 'border-b ' : ''
                  }${
                    hasActiveChild
                      ? 'bg-gradient-to-l from-blue-100/90 via-sky-50 to-violet-100/75 text-blue-950 border-blue-200/80'
                      : sec.headerGradientClass
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${sec.iconBadgeClass}`}>
                      <SecIcon className="w-4 h-4 shrink-0" />
                    </span>
                    <span className="truncate">{sec.title}</span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 text-blue-700/70 transition-transform duration-200 ${
                      isSectionCollapsed ? 'rotate-90' : ''
                    }`}
                  />
                </button>

                {!isSectionCollapsed && (
                  <div className="divide-y divide-slate-100/90 p-1.5 space-y-0.5 bg-gradient-to-b from-white to-slate-50/40">
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
                          className={`w-full min-h-[42px] px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-right text-xs font-bold transition-all cursor-pointer ${
                            active
                              ? 'bg-gradient-to-l from-blue-700 via-blue-600 to-indigo-600 text-white font-black shadow-xs'
                              : 'text-slate-700 hover:bg-gradient-to-l hover:from-blue-50/80 hover:to-violet-50/60 hover:text-blue-950'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                active ? 'bg-white' : 'bg-blue-300'
                              }`}
                            />
                            <span className="truncate">{item.label}</span>
                            {item.badge && (
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-black shrink-0 ${
                                  active
                                    ? 'bg-white/20 text-white'
                                    : 'bg-gradient-to-l from-blue-100 to-indigo-100 text-blue-900'
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <ChevronLeft className={`w-4 h-4 shrink-0 ${active ? 'text-blue-100' : 'text-slate-400'}`} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Drawer Footer */}
        <div className="px-4 py-2.5 border-t border-blue-100/80 bg-gradient-to-l from-slate-50 via-blue-50/50 to-indigo-50/50 text-center shrink-0">
          <div className="text-[11px] text-slate-600 font-bold flex items-center justify-center gap-2">
            <span>AWLAD SELIM</span>
            <span className="text-blue-300">•</span>
            <span className="text-indigo-700">نظام محاسبي متكامل وآمن</span>
          </div>
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

      <SyncCenterModal
        isOpen={isSyncCenterOpen}
        onClose={() => setIsSyncCenterOpen(false)}
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

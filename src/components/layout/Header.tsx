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
  ReceiptText,
  Truck,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  LayoutDashboard,
  Sun,
  Moon,
  ChevronDown,
} from 'lucide-react';
import {
  SalesInvoiceIcon,
  SuppliersTruckIcon,
  WarehouseBoxesIcon,
  SafeVaultIcon,
  ChequesIcon,
  RepsFleetIcon,
  EmployeesHrIcon,
  ReportsChartIcon,
  UsersShieldIcon,
  SettingsTwinGearsIcon,
} from '../common/AppIcons';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { usePreferences } from '../../context/PreferencesContext';
import { useShortcuts } from '../../context/ShortcutsContext';
import { OfflineIndicator } from './OfflineIndicator';
import { NavItemKey } from './Sidebar';
import { MobileNotificationItem, UserPermissions } from '../../types';
import { MobileNotificationsSheet } from '../modules/mobile/MobileNotificationsSheet';
import { MobileServerModal } from '../modules/mobile/MobileServerModal';
import { isWindowsDesktopApp } from '../../services/native';

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
  isWindowsDesktop,
  isSidebarOpen,
  onToggleSidebar,
  onNavigate,
  onNavigateToTransfers,
}) => {
  const { currentUser, logout, hasPermission, refreshAuthContext, setIsAccountSwitcherOpen, savedAccounts } = useAuth();
  const {
    repTransfers,
    customerItemOrders = [],
    mobileNotifications = [],
    unreadNotificationCount = 0,
    incomingDispatchCount = 0,
    markNotificationsRead,
    triggerManualSync,
  } = useData();
  const { triggerAction } = useShortcuts();
  const { resolvedTheme, setThemePreference, dir } = usePreferences();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [openWebMenuId, setOpenWebMenuId] = useState<string | null>(null);
  const webNavRef = React.useRef<HTMLDivElement | null>(null);

  const isWinDesktop = typeof isWindowsDesktop === 'boolean' ? isWindowsDesktop : isWindowsDesktopApp();

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

  useEffect(() => {
    if (!openWebMenuId) return;
    const handleOutside = (e: MouseEvent) => {
      if (webNavRef.current && !webNavRef.current.contains(e.target as Node)) {
        setOpenWebMenuId(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenWebMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [openWebMenuId]);

  const canPerm = (perm?: keyof UserPermissions | Array<keyof UserPermissions>) => {
    if (!perm) return true;
    if (currentUser?.role === 'admin') return true;
    if (Array.isArray(perm)) return perm.some((p) => hasPermission(p));
    return hasPermission(perm);
  };

  // Permanent Quick Shortcuts inside Top Blue Bar (RBAC-gated)
  const quickBarShortcuts: Array<{
    key: string;
    label: string;
    icon: React.ElementType;
    onClick: () => void;
    allowed: boolean;
  }> = [
    {
      key: 'add-customer',
      label: 'إضافة عميل',
      icon: UserPlus,
      onClick: () => triggerAction('action:new_customer'),
      allowed: canPerm('canManageSales') && canPerm('canAdd'),
    },
    {
      key: 'add-product',
      label: 'إضافة صنف',
      icon: PackagePlus,
      onClick: () => triggerAction('action:add_product'),
      allowed: canPerm('canManageInventory') && canPerm('canAdd'),
    },
    {
      key: 'new-sale',
      label: 'فاتورة بيع',
      icon: FilePlus2,
      onClick: () => triggerAction('nav:new-sale'),
      allowed: canPerm('canManageSales'),
    },
    {
      key: 'add-expense',
      label: 'تسجيل مصروف',
      icon: ReceiptText,
      onClick: () => triggerAction('action:add_expense'),
      allowed: canPerm('canManageCashboxes'),
    },
    {
      key: 'stock-transfer',
      label: 'تحويل أصناف',
      icon: Truck,
      onClick: () => triggerAction('action:new_stock_transfer'),
      allowed: canPerm(['canCreateStockTransfer', 'canManageInventory']),
    },
  ].filter((s) => s.allowed);

  // Check pending transfers & new customer/rep orders
  const pendingTransfersCount = repTransfers.filter((t) => t.status === 'awaiting_receipt').length;
  const pendingOrdersCount = customerItemOrders.filter((o) => o.status === 'pending').length;

  // Original Web Desktop Horizontal Sections Menu (never uses Sidebar; strict RBAC gating)
  const webHorizontalSections = React.useMemo(() => {
    const rawSections: Array<{
      id: string;
      title: string;
      icon: React.ElementType;
      permission?: keyof UserPermissions | Array<keyof UserPermissions>;
      items: Array<{
        key: NavItemKey;
        label: string;
        permission?: keyof UserPermissions | Array<keyof UserPermissions>;
        allowAllStaff?: boolean;
        badge?: string;
      }>;
    }> = [
      {
        id: 'sales',
        title: 'المبيعات',
        icon: SalesInvoiceIcon,
        permission: 'canManageSales',
        items: [
          {
            key: 'customer-orders',
            label: 'طلبات العملاء والمندوبين',
            badge: pendingOrdersCount > 0 ? `${pendingOrdersCount}` : undefined,
          },
          { key: 'sales-invoices', label: 'فواتير المبيعات' },
          { key: 'quotes', label: 'عروض الأسعار' },
          { key: 'new-sale', label: 'فاتورة مبيعات جديدة (+)' },
          { key: 'customers', label: 'العملاء والأرصدة' },
          { key: 'sales-returns', label: 'مرتجع المبيعات' },
          { key: 'deleted-invoices', label: 'الفواتير المحذوفة والملغاة', permission: 'canViewDeletedInvoices' },
        ],
      },
      {
        id: 'purchases',
        title: 'المشتريات',
        icon: SuppliersTruckIcon,
        permission: ['canManagePurchases', 'canCreatePurchase'],
        items: [
          { key: 'purchase-invoices', label: 'فواتير المشتريات' },
          { key: 'new-purchase', label: 'فاتورة شراء جديدة (+)' },
          { key: 'suppliers', label: 'دليل الموردين والأرصدة' },
          { key: 'purchase-returns', label: 'مرتجع المشتريات', permission: 'canManagePurchases' },
        ],
      },
      {
        id: 'inventory',
        title: 'المخازن',
        icon: WarehouseBoxesIcon,
        permission: 'canManageInventory',
        items: [
          { key: 'products', label: 'المنتجات والأسعار' },
          { key: 'product-categories', label: 'تصنيفات السلع' },
          {
            key: 'units-settings',
            label: 'الوحدات ومعاملات التحويل',
            permission: ['canManageInventory', 'canManageSettings'],
          },
          { key: 'abu-selim-import', label: 'استيراد الملفات' },
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
        ],
      },
      {
        id: 'finance',
        title: 'الحسابات',
        icon: SafeVaultIcon,
        permission: ['canManageCashboxes', 'canManageAccounts'],
        items: [
          {
            key: 'customer-accounts',
            label: 'حسابات العملاء وكشوف الحساب',
            permission: ['canManageAccounts', 'canManageCashboxes'],
          },
          {
            key: 'supplier-accounts',
            label: 'حسابات الموردين وكشوف الحساب',
            permission: ['canManageAccounts', 'canManageCashboxes'],
          },
          { key: 'cashboxes', label: 'الخزائن والبنوك', permission: 'canManageCashboxes' },
          { key: 'cashbox-transfer', label: 'تحويل بين الخزائن', permission: 'canManageCashboxes' },
          { key: 'expenses', label: 'المصروفات والإيرادات', permission: 'canManageCashboxes' },
          {
            key: 'personal-accounts',
            label: 'الحسابات الشخصية للملاك',
            permission: 'canViewPersonalAccounts',
          },
        ],
      },
      {
        id: 'cheques-inst',
        title: 'الشيكات والأقساط',
        icon: ChequesIcon,
        permission: 'canManageAccounts',
        items: [
          { key: 'cheques', label: 'الشيكات (واردة / صادرة)' },
          { key: 'installments', label: 'إدارة وجدولة الأقساط' },
        ],
      },
      {
        id: 'representatives',
        title: 'المندوبون',
        icon: RepsFleetIcon,
        permission: 'canManageReps',
        items: [
          {
            key: 'refresh-sync',
            label: 'REFRESH · إرسال واستلام المندوبين',
            permission: ['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove'],
            badge: incomingDispatchCount > 0 ? `${incomingDispatchCount}` : undefined,
          },
          { key: 'reps', label: 'قائمة المناديب' },
          {
            key: 'rep-transfers',
            label: 'طلب تحويل بالنصف (المالي)',
            permission: 'canManageTransfers',
          },
          {
            key: 'rep-item-transfers',
            label: 'تحويل أصناف وعهدة (فاتورة)',
            permission: 'canManageTransfers',
          },
        ],
      },
      {
        id: 'employees',
        title: 'الموظفون',
        icon: EmployeesHrIcon,
        permission: 'canManageEmployees',
        items: [
          { key: 'employees', label: 'شؤون الموظفين' },
        ],
      },
      {
        id: 'reports',
        title: 'التقارير',
        icon: ReportsChartIcon,
        permission: 'canViewReports',
        items: [
          { key: 'reports', label: 'جميع التقارير والأرباح' },
          {
            key: 'item-movement-report',
            label: 'تقرير حركة الصنف المفصل',
            permission: ['canViewReports', 'canManageInventory'],
          },
        ],
      },
      {
        id: 'management',
        title: 'المستخدمون',
        icon: UsersShieldIcon,
        permission: 'canManageUsers',
        items: [
          { key: 'users', label: 'إدارة المستخدمين' },
          { key: 'audit-log', label: 'سجل العمليات (Audit)' },
        ],
      },
      {
        id: 'settings',
        title: 'الإعدادات',
        icon: SettingsTwinGearsIcon,
        permission: 'canManageSettings',
        items: [
          { key: 'system-settings', label: 'إعدادات النظام والحساب', allowAllStaff: true },
          { key: 'branches-settings', label: 'إدارة الفروع' },
          { key: 'barcode-settings', label: 'إعدادات الباركود' },
          { key: 'printers-settings', label: 'الطابعات المتعددة' },
          { key: 'invoice-settings', label: 'تصميم وإعدادات الفاتورة' },
          { key: 'storefront-manager', label: 'إدارة واجهة المتجر والعروض' },
          { key: 'mobile-settings', label: 'إعدادات تطبيق الهاتف' },
          { key: 'online-sync-settings', label: 'مزامنة أونلاين' },
          { key: 'services-settings', label: 'الخدمات والتنبيهات' },
          { key: 'server-settings', label: 'إعدادات السيرفر والاتصال' },
          { key: 'diagnostics-settings', label: 'سجل التشخيص والأخطاء' },
          { key: 'backup', label: 'النسخ الاحتياطي والاستعادة' },
          { key: 'migration', label: 'سجل الترحيل و PostgreSQL' },
          { key: 'shortcuts-settings', label: 'اختصارات لوحة المفاتيح', allowAllStaff: true },
        ],
      },
    ];

    return rawSections
      .map((sec) => {
        const secAllowed = canPerm(sec.permission);
        const items = sec.items.filter((item) => {
          if (item.allowAllStaff) return true;
          if (item.permission) return canPerm(item.permission);
          return secAllowed;
        });
        return { ...sec, items };
      })
      .filter((sec) => sec.items.length > 0);
  }, [currentUser, pendingOrdersCount, incomingDispatchCount]);

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
        return 'مالك / مدير عام';
      case 'manager':
        return 'مدير فرع';
      case 'accountant':
        return 'محاسب مالي';
      case 'warehouse':
        return 'أمين مستودع';
      case 'sales':
        return 'موظف مبيعات';
      case 'purchases':
        return 'موظف مشتريات';
      case 'representative':
        return 'مندوب مبيعات';
      case 'customer':
        return 'عميل مسجل';
      default:
        return 'موظف';
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
                  {currentUser ? `${currentUser.fullName} · ${getRoleLabel(currentUser.role)}` : 'أولاد سليم'}
                </p>
              </div>
              {isWinDesktop && (
                <button
                  type="button"
                  data-testid="sidebar-toggle-btn"
                  onClick={onToggleSidebar}
                  aria-label="تبديل القائمة الجانبية"
                  aria-expanded={isSidebarOpen}
                  aria-controls="system-sections-drawer"
                  title={isSidebarOpen ? 'إغلاق القائمة الجانبية' : 'فتح القائمة الجانبية'}
                  className={`min-h-[30px] px-2.5 py-1 flex items-center justify-center gap-1.5 rounded-md border text-xs font-black whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    isSidebarOpen
                      ? 'bg-white text-[var(--awlad-navy-900)] border-white dark:bg-[#1659C8] dark:text-white dark:border-[#60A5FA]/50 shadow-xs'
                      : 'bg-white/15 hover:bg-white/25 border-white/30 text-white'
                  }`}
                >
                  {isSidebarOpen ? (
                    dir === 'ltr' ? <PanelRightOpen className="w-4 h-4 shrink-0" /> : <PanelRightClose className="w-4 h-4 shrink-0" />
                  ) : (
                    <Menu className="w-4 h-4" />
                  )}
                  <span>{isSidebarOpen ? 'إغلاق القائمة' : 'قائمة الأقسام'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                aria-current={currentPage === 'dashboard' ? 'page' : undefined}
                title="لوحة التحكم الرئيسية"
                className={`hidden sm:flex min-h-[30px] px-2 py-1 items-center gap-1 rounded-md text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  currentPage === 'dashboard'
                    ? 'bg-white/20 text-white border border-white/30'
                    : 'text-blue-100 hover:text-white hover:bg-white/10 border border-transparent'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
                <span>الرئيسية</span>
              </button>
            </div>

            {/* Left (RTL End): Alerts, Status, Notifications, Server, Fullscreen, Logout */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <OfflineIndicator variant="dark" />

              {pendingOrdersCount > 0 && canPerm('canManageSales') && (
                <button
                  type="button"
                  onClick={() => onNavigate('customer-orders')}
                  title={`يوجد ${pendingOrdersCount} طلب شراء جديد بانتظار المراجعة`}
                  className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-white/15 text-white border border-white/25 text-[11px] font-black hover:bg-white/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Bell className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden xl:inline">طلبات</span>
                  <span className="px-1.5 py-0.5 rounded bg-white text-blue-950 no-dark-surface text-[10px] font-mono tabular-nums">
                    {pendingOrdersCount}
                  </span>
                </button>
              )}

              {pendingTransfersCount > 0 && onNavigateToTransfers && (
                <button
                  type="button"
                  onClick={onNavigateToTransfers}
                  title={`يوجد ${pendingTransfersCount} طلب تحويل معلق`}
                  className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-amber-400/20 text-amber-100 border border-amber-300/40 text-[11px] font-bold hover:bg-amber-400/30 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                  <span className="px-1.5 py-0.5 rounded bg-amber-300 text-amber-950 no-dark-surface text-[10px] font-mono tabular-nums">
                    {pendingTransfersCount}
                  </span>
                </button>
              )}

              {incomingDispatchCount > 0 && canPerm(['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove']) && (
                <button
                  type="button"
                  onClick={() => onNavigate('refresh-sync')}
                  title={`يوجد ${incomingDispatchCount} دفعة إرسال من المندوبين بانتظار الاستلام`}
                  className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-white/15 text-white border border-white/25 text-[11px] font-bold hover:bg-white/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>REFRESH</span>
                  <span className="px-1.5 py-0.5 rounded bg-white text-blue-950 no-dark-surface text-[10px] font-mono tabular-nums font-black">
                    {incomingDispatchCount}
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
                title="التنبيهات والإشعارات"
                aria-label="التنبيهات والإشعارات"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded bg-red-600 text-white text-[9px] font-mono tabular-nums font-black flex items-center justify-center">
                    {unreadNotificationCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsServerModalOpen(true)}
                className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title="عنوان وإعدادات السيرفر المركزي"
                aria-label="إعدادات السيرفر"
              >
                <Server className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsAccountSwitcherOpen(true)}
                className="relative min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title="الحسابات المحفوظة وتبديل الحساب"
                aria-label="تبديل الحساب"
              >
                <Users className="w-4 h-4" />
                {savedAccounts.length > 1 && (
                  <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded bg-[var(--awlad-royal-500)] text-white text-[9px] font-mono tabular-nums font-black flex items-center justify-center">
                    {savedAccounts.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                data-testid="header-theme-toggle"
                onClick={() => setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title={resolvedTheme === 'dark' ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الداكن'}
                aria-label={resolvedTheme === 'dark' ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الداكن'}
              >
                {resolvedTheme === 'dark' ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => onNavigate('system-settings')}
                className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title="الإعدادات"
                aria-label="الإعدادات"
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="hidden md:flex min-h-[30px] min-w-[30px] items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-blue-50 hover:text-white transition-colors cursor-pointer shrink-0"
                title="ملء الشاشة"
                aria-label="ملء الشاشة"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setShowLogoutModal(true)}
                className="min-h-[30px] px-2 flex items-center justify-center gap-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title="تسجيل الخروج من النظام"
                aria-label="تسجيل الخروج"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">خروج</span>
              </button>
            </div>
          </div>

          {/* Original Web Horizontal Sections Navigation Bar (strictly non-Windows Desktop browsers) */}
          {!isWinDesktop && webHorizontalSections.length > 0 && (
            <nav
              ref={webNavRef}
              data-testid="web-horizontal-sections-nav"
              aria-label="قائمة أقسام النظام"
              className="flex flex-wrap items-center gap-1 border-t border-white/15 py-1 relative z-40"
            >
              {webHorizontalSections.map((section) => {
                const SectionIcon = section.icon;
                const isMenuOpen = openWebMenuId === section.id;
                const hasActiveChild = section.items.some((item) => item.key === currentPage);
                const sectionBadgeCount = section.items.reduce(
                  (sum, it) => sum + (it.badge ? Number(it.badge) || 0 : 0),
                  0
                );
                return (
                  <div key={section.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenWebMenuId((prev) => (prev === section.id ? null : section.id))}
                      aria-expanded={isMenuOpen}
                      aria-haspopup="menu"
                      className={`h-7 px-2 rounded-md text-[11px] font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors border ${
                        isMenuOpen || hasActiveChild
                          ? 'bg-white text-[var(--awlad-navy-900)] border-white dark:bg-[#1659C8] dark:text-white dark:border-[#60A5FA]/50 font-black shadow-xs'
                          : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
                      }`}
                    >
                      <SectionIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>{section.title}</span>
                      {sectionBadgeCount > 0 && (
                        <span className="px-1 py-0.2 rounded bg-amber-300 text-amber-950 no-dark-surface text-[9px] font-mono tabular-nums font-black">
                          {sectionBadgeCount}
                        </span>
                      )}
                      <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isMenuOpen && (
                      <div
                        role="menu"
                        className={`absolute top-full mt-1 ${dir === 'ltr' ? 'left-0' : 'right-0'} min-w-[220px] max-w-[270px] max-h-[70vh] overflow-y-auto rounded-lg bg-white dark:bg-[#0E1C36] text-slate-800 dark:text-[#DCE6F5] border border-slate-200 dark:border-[#21375C] shadow-xl p-1 space-y-0.5 z-50`}
                      >
                        {section.items.map((item) => {
                          const isActive = currentPage === item.key;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenWebMenuId(null);
                                onNavigate(item.key);
                              }}
                              className={`w-full px-2.5 py-1.5 rounded-md text-right text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                isActive
                                  ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white font-black'
                                  : 'text-slate-700 dark:text-[#DCE6F5] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] font-semibold'
                              }`}
                            >
                              <span className="truncate">{item.label}</span>
                              {item.badge && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums font-bold shrink-0 ${
                                    isActive
                                      ? 'bg-white/20 text-white'
                                      : 'bg-[var(--awlad-blue-tint-50)] text-[var(--awlad-navy-900)] border border-[var(--awlad-blue-tint-100)]'
                                  }`}
                                >
                                  {item.badge}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          )}

          {/* Permanent Desktop Quick Shortcuts inside Top Header */}
          {quickBarShortcuts.length > 0 && (
            <div
              aria-label="اختصارات العمليات السريعة"
              className="hidden md:flex items-center justify-between gap-1.5 border-t border-white/15 py-1 overflow-x-auto no-scrollbar"
            >
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] font-bold text-blue-100 whitespace-nowrap shrink-0 pl-1">
                  وصول سريع:
                </span>
                {quickBarShortcuts.map((sc) => {
                  const Icon = sc.icon;
                  return (
                    <button
                      key={sc.key}
                      type="button"
                      onClick={sc.onClick}
                      className="h-6 px-2 rounded-md bg-white/12 hover:bg-white/25 border border-white/20 text-white text-[11px] font-bold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      <Icon className="w-3 h-3 shrink-0" />
                      <span>{sc.label}</span>
                    </button>
                  );
                })}
              </div>
              {currentPage !== 'dashboard' && (
                <button
                  type="button"
                  onClick={() => onNavigate('dashboard')}
                  className="h-6 px-2 rounded-md text-blue-100 hover:text-white hover:bg-white/10 text-[11px] font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  لوحة التحكم
                </button>
              )}
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
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg bg-white dark:bg-[#0E1C36] p-3 shadow-2xl border border-slate-200 dark:border-[#21375C] text-right animate-in fade-in zoom-in duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 flex items-center justify-center mx-auto mb-2 border border-red-100 dark:border-red-500/30">
              <AlertTriangle className="w-4 h-4" />
            </div>

            <h3 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC] text-center mb-1">
              هل تريد تسجيل الخروج؟
            </h3>
            <p className="text-xs text-slate-500 dark:text-[#A9BCD9] text-center mb-3 leading-relaxed">
              سيتم إنهاء جلستك الحالية والعودة لشاشة الدخول. لن يتم فقد أي بيانات تجارية أو فواتير محفوظة.
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
                نعم، تسجيل الخروج
              </button>
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3461] text-slate-700 dark:text-[#DCE6F5] border border-transparent dark:border-[#21375C] text-xs font-bold rounded-md transition-colors cursor-pointer"
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

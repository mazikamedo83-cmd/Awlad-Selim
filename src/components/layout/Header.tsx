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
  Globe,
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
  const { resolvedTheme, setThemePreference, dir, language, setLanguage, t } = usePreferences();
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
    },
    {
      key: 'add-expense',
      label: t('تسجيل مصروف', 'Add Expense'),
      icon: ReceiptText,
      onClick: () => triggerAction('action:add_expense'),
      allowed: canPerm('canManageCashboxes'),
    },
    {
      key: 'stock-transfer',
      label: t('تحويل أصناف', 'Stock Transfer'),
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
        title: t('المبيعات', 'Sales'),
        icon: SalesInvoiceIcon,
        permission: 'canManageSales',
        items: [
          {
            key: 'customer-orders',
            label: t('طلبات العملاء والمندوبين', 'Customer & Rep Orders'),
            badge: pendingOrdersCount > 0 ? `${pendingOrdersCount}` : undefined,
          },
          { key: 'sales-invoices', label: t('فواتير المبيعات', 'Sales Invoices') },
          { key: 'quotes', label: t('عروض الأسعار', 'Price Quotes') },
          { key: 'new-sale', label: t('فاتورة مبيعات جديدة (+)', 'New Sales Invoice (+)') },
          { key: 'customers', label: t('العملاء والأرصدة', 'Customers & Balances') },
          { key: 'sales-returns', label: t('مرتجع المبيعات', 'Sales Returns') },
          { key: 'deleted-invoices', label: t('الفواتير المحذوفة والملغاة', 'Deleted & Cancelled Invoices'), permission: 'canViewDeletedInvoices' },
        ],
      },
      {
        id: 'purchases',
        title: t('المشتريات', 'Purchases'),
        icon: SuppliersTruckIcon,
        permission: ['canManagePurchases', 'canCreatePurchase'],
        items: [
          { key: 'purchase-invoices', label: t('فواتير المشتريات', 'Purchase Invoices') },
          { key: 'new-purchase', label: t('فاتورة شراء جديدة (+)', 'New Purchase Invoice (+)') },
          { key: 'suppliers', label: t('دليل الموردين والأرصدة', 'Suppliers & Balances') },
          { key: 'purchase-returns', label: t('مرتجع المشتريات', 'Purchase Returns'), permission: 'canManagePurchases' },
        ],
      },
      {
        id: 'inventory',
        title: t('المخازن', 'Inventory'),
        icon: WarehouseBoxesIcon,
        permission: 'canManageInventory',
        items: [
          { key: 'products', label: t('المنتجات والأسعار', 'Products & Pricing') },
          { key: 'product-categories', label: t('تصنيفات السلع', 'Product Categories') },
          {
            key: 'units-settings',
            label: t('الوحدات ومعاملات التحويل', 'Units & Conversions'),
            permission: ['canManageInventory', 'canManageSettings'],
          },
          { key: 'abu-selim-import', label: t('استيراد الملفات', 'Import Files') },
          { key: 'warehouses', label: t('أرصدة المستودعات', 'Warehouse Balances'), permission: 'canManageWarehouses' },
          {
            key: 'stock-transfers-orders',
            label: t('أوامر تحويل الأصناف', 'Stock Transfer Orders'),
            permission: ['canCreateStockTransfer', 'canApproveStockTransfer', 'canExecuteStockTransfer', 'canManageInventory'],
          },
          {
            key: 'stock-counts',
            label: t('جرد المخزن المعتمد', 'Approved Stock Counts'),
            permission: ['canCreateStockCount', 'canApproveStockCount', 'canManageInventory'],
          },
          { key: 'stock-transfers', label: t('تحويل سريع بين المستودعات', 'Quick Warehouse Transfer') },
          { key: 'stock-adjustments', label: t('تسوية سريعة للمخزون', 'Quick Stock Adjustment') },
          { key: 'damaged-stock', label: t('بضاعة تالفة ومنتهية', 'Damaged & Expired Stock') },
          { key: 'stock-movements', label: t('سجل حركة الأصناف', 'Stock Movement Log') },
        ],
      },
      {
        id: 'finance',
        title: t('الحسابات', 'Finance'),
        icon: SafeVaultIcon,
        permission: ['canManageCashboxes', 'canManageAccounts'],
        items: [
          {
            key: 'customer-accounts',
            label: t('حسابات العملاء وكشوف الحساب', 'Customer Accounts & Statements'),
            permission: ['canManageAccounts', 'canManageCashboxes'],
          },
          {
            key: 'supplier-accounts',
            label: t('حسابات الموردين وكشوف الحساب', 'Supplier Accounts & Statements'),
            permission: ['canManageAccounts', 'canManageCashboxes'],
          },
          { key: 'cashboxes', label: t('الخزائن والبنوك', 'Cashboxes & Banks'), permission: 'canManageCashboxes' },
          { key: 'cashbox-transfer', label: t('تحويل بين الخزائن', 'Cashbox Transfer'), permission: 'canManageCashboxes' },
          { key: 'expenses', label: t('المصروفات والإيرادات', 'Expenses & Revenues'), permission: 'canManageCashboxes' },
          {
            key: 'personal-accounts',
            label: t('الحسابات الشخصية للملاك', 'Owners Personal Accounts'),
            permission: 'canViewPersonalAccounts',
          },
        ],
      },
      {
        id: 'cheques-inst',
        title: t('الشيكات والأقساط', 'Cheques & Installments'),
        icon: ChequesIcon,
        permission: 'canManageAccounts',
        items: [
          { key: 'cheques', label: t('الشيكات (واردة / صادرة)', 'Cheques (Incoming / Outgoing)') },
          { key: 'installments', label: t('إدارة وجدولة الأقساط', 'Installments & Scheduling') },
        ],
      },
      {
        id: 'representatives',
        title: t('المندوبون', 'Representatives'),
        icon: RepsFleetIcon,
        permission: 'canManageReps',
        items: [
          {
            key: 'refresh-sync',
            label: t('REFRESH · إرسال واستلام المندوبين', 'REFRESH · Send & Receive'),
            permission: ['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove'],
            badge: incomingDispatchCount > 0 ? `${incomingDispatchCount}` : undefined,
          },
          { key: 'reps', label: t('قائمة المناديب', 'Representatives List') },
          {
            key: 'rep-transfers',
            label: t('طلب تحويل بالنصف (المالي)', 'Financial Transfer Requests'),
            permission: 'canManageTransfers',
          },
          {
            key: 'rep-item-transfers',
            label: t('تحويل أصناف وعهدة (فاتورة)', 'Rep Stock & Custody Transfer'),
            permission: 'canManageTransfers',
          },
        ],
      },
      {
        id: 'employees',
        title: t('الموظفون', 'Employees'),
        icon: EmployeesHrIcon,
        permission: 'canManageEmployees',
        items: [
          { key: 'employees', label: t('شؤون الموظفين', 'HR & Payroll') },
        ],
      },
      {
        id: 'reports',
        title: t('التقارير', 'Reports'),
        icon: ReportsChartIcon,
        permission: 'canViewReports',
        items: [
          { key: 'reports', label: t('جميع التقارير والأرباح', 'All Reports & Profit') },
          {
            key: 'item-movement-report',
            label: t('تقرير حركة الصنف المفصل', 'Detailed Item Movement Report'),
            permission: ['canViewReports', 'canManageInventory'],
          },
        ],
      },
      {
        id: 'management',
        title: t('المستخدمون', 'Users'),
        icon: UsersShieldIcon,
        permission: 'canManageUsers',
        items: [
          { key: 'users', label: t('إدارة المستخدمين', 'Users Management') },
          { key: 'audit-log', label: t('سجل العمليات (Audit)', 'Audit Log') },
        ],
      },
      {
        id: 'settings',
        title: t('الإعدادات', 'Settings'),
        icon: SettingsTwinGearsIcon,
        permission: 'canManageSettings',
        items: [
          { key: 'system-settings', label: t('إعدادات النظام والحساب', 'System & Account Settings'), allowAllStaff: true },
          { key: 'branches-settings', label: t('إدارة الفروع', 'Branches Management') },
          { key: 'barcode-settings', label: t('إعدادات الباركود', 'Barcode Settings') },
          { key: 'printers-settings', label: t('الطابعات المتعددة', 'Multiple Printers') },
          { key: 'invoice-settings', label: t('تصميم وإعدادات الفاتورة', 'Invoice Design & Settings') },
          { key: 'storefront-manager', label: t('إدارة واجهة المتجر والعروض', 'Storefront & Offers Manager') },
          { key: 'mobile-settings', label: t('إعدادات تطبيق الهاتف', 'Mobile App Settings') },
          { key: 'online-sync-settings', label: t('مزامنة أونلاين', 'Online Sync') },
          { key: 'services-settings', label: t('الخدمات والتنبيهات', 'Services & Alerts') },
          { key: 'server-settings', label: t('إعدادات السيرفر والاتصال', 'Server & Connection') },
          { key: 'diagnostics-settings', label: t('سجل التشخيص والأخطاء', 'Diagnostic & Error Logs') },
          { key: 'backup', label: t('النسخ الاحتياطي والاستعادة', 'Backup & Restore') },
          { key: 'migration', label: t('سجل الترحيل و PostgreSQL', 'Migration & PostgreSQL') },
          { key: 'shortcuts-settings', label: t('اختصارات لوحة المفاتيح', 'Keyboard Shortcuts'), allowAllStaff: true },
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
  }, [currentUser, pendingOrdersCount, incomingDispatchCount, language]);

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
              {isWinDesktop && (
                <button
                  type="button"
                  data-testid="sidebar-toggle-btn"
                  onClick={onToggleSidebar}
                  aria-label={t('تبديل القائمة الجانبية', 'Toggle sidebar')}
                  aria-expanded={isSidebarOpen}
                  aria-controls="system-sections-drawer"
                  title={isSidebarOpen ? t('إغلاق القائمة الجانبية', 'Close sidebar') : t('فتح القائمة الجانبية', 'Open sidebar')}
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
                  <span>{isSidebarOpen ? t('إغلاق القائمة', 'Close Menu') : t('قائمة الأقسام', 'Modules Menu')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                aria-current={currentPage === 'dashboard' ? 'page' : undefined}
                title={t('لوحة التحكم الرئيسية', 'Main Dashboard')}
                className={`hidden sm:flex min-h-[30px] px-2 py-1 items-center gap-1 rounded-md text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  currentPage === 'dashboard'
                    ? 'bg-white/20 text-white border border-white/30'
                    : 'text-blue-100 hover:text-white hover:bg-white/10 border border-transparent'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
                <span>{t('الرئيسية', 'Home')}</span>
              </button>
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

              {pendingTransfersCount > 0 && onNavigateToTransfers && (
                <button
                  type="button"
                  onClick={onNavigateToTransfers}
                  title={t(
                    `يوجد ${pendingTransfersCount} طلب تحويل معلق`,
                    `${pendingTransfersCount} pending transfer requests`
                  )}
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
                  title={t(
                    `يوجد ${incomingDispatchCount} دفعة إرسال من المندوبين بانتظار الاستلام`,
                    `${incomingDispatchCount} incoming representative dispatches awaiting receipt`
                  )}
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

          {/* Original Web Horizontal Sections Navigation Bar (strictly non-Windows Desktop browsers) */}
          {!isWinDesktop && webHorizontalSections.length > 0 && (
            <nav
              ref={webNavRef}
              data-testid="web-horizontal-sections-nav"
              aria-label={t('قائمة أقسام النظام', 'System Sections Menu')}
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
                              className={`w-full px-2.5 py-1.5 rounded-md text-start text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
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
              aria-label={t('اختصارات العمليات السريعة', 'Quick Operation Shortcuts')}
              className="hidden md:flex items-center justify-between gap-1.5 border-t border-white/15 py-1 overflow-x-auto no-scrollbar"
            >
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] font-bold text-blue-100 whitespace-nowrap shrink-0 pe-1">
                  {t('وصول سريع:', 'Quick Access:')}
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
                  {t('لوحة التحكم', 'Dashboard')}
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

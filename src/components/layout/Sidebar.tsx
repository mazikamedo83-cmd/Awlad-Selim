import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  Boxes,
  Wallet,
  CreditCard,
  Users2,
  Users,
  FileBarChart,
  Shield,
  Settings,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowDownCircle,
  ArrowUpCircle,
  TrendingDown,
  TrendingUp,
  ArrowLeftRight,
  X,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import {
  DashboardHomeIcon,
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
import { CashOperationType } from '../../types';

export type NavItemKey =
  | 'dashboard'
  | 'customer-orders'
  | 'sales-invoices'
  | 'quotes'
  | 'new-sale'
  | 'customers'
  | 'sales-returns'
  | 'deleted-invoices'
  | 'purchase-invoices'
  | 'new-purchase'
  | 'suppliers'
  | 'purchase-returns'
  | 'products'
  | 'product-categories'
  | 'units-settings'
  | 'warehouses'
  | 'stock-transfers'
  | 'stock-transfers-orders'
  | 'stock-adjustments'
  | 'stock-counts'
  | 'damaged-stock'
  | 'stock-movements'
  | 'item-movement-report'
  | 'abu-selim-import'
  | 'accounts'
  | 'customer-accounts'
  | 'supplier-accounts'
  | 'cashboxes'
  | 'cashbox-transfer'
  | 'expenses'
  | 'personal-accounts'
  | 'cheques'
  | 'installments'
  | 'reps'
  | 'rep-transfers'
  | 'rep-item-transfers'
  | 'refresh-sync'
  | 'employees'
  | 'reports'
  | 'users'
  | 'audit-log'
  | 'system-settings'
  | 'server-settings'
  | 'backup'
  | 'migration'
  | 'branches-settings'
  | 'barcode-settings'
  | 'printers-settings'
  | 'invoice-settings'
  | 'mobile-settings'
  | 'online-sync-settings'
  | 'shortcuts-settings'
  | 'storefront-manager'
  | 'services-settings'
  | 'diagnostics-settings';

interface SidebarProps {
  currentPage: NavItemKey;
  onNavigate: (page: NavItemKey) => void;
  isOpen: boolean;
  onClose: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenCashOp?: (mode: CashOperationType) => void;
  mobileDrawer?: boolean;
}

interface NavSection {
  id: string;
  title: string;
  icon: React.ElementType;
  headerGradient: string;
  iconAccent: string;
  permission?: string | string[];
  items: Array<{
    key: NavItemKey;
    label: string;
    permission?: string | string[];
    allowAllStaff?: boolean;
    badge?: string;
  }>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  isOpen,
  onClose,
  isCollapsed = false,
  onToggleCollapse,
  onOpenCashOp,
  mobileDrawer = false,
}) => {
  const { hasPermission, currentUser } = useAuth();
  const { customerItemOrders = [], incomingDispatchCount = 0 } = useData();
  const { dir, t, language } = usePreferences();
  const isLtr = dir === 'ltr';
  const pendingOrdersCount = customerItemOrders.filter((o) => o.status === 'pending').length;

  // Expand all Windows desktop sections by default; users can collapse/expand freely
  const [openSectionIds, setOpenSectionIds] = useState<Record<string, boolean>>({
    sales: true,
    purchases: true,
    inventory: true,
    finance: true,
    'cheques-inst': true,
    representatives: true,
    employees: true,
    reports: true,
    management: true,
    settings: true,
  });

  const navSections: NavSection[] = useMemo(
    () => [
      {
        id: 'sales',
        title: t('المبيعات والعملاء', 'Sales & Customers'),
        icon: SalesInvoiceIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        title: t('المشتريات والموردون', 'Purchases & Suppliers'),
        icon: SuppliersTruckIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        title: t('المخازن والمنتجات', 'Inventory & Products'),
        icon: WarehouseBoxesIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        title: t('الحسابات والخزائن', 'Finance & Cashboxes'),
        icon: SafeVaultIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
        permission: 'canManageAccounts',
        items: [
          { key: 'cheques', label: t('الشيكات (واردة / صادرة)', 'Cheques (Incoming / Outgoing)') },
          { key: 'installments', label: t('إدارة وجدولة الأقساط', 'Installments & Scheduling') },
        ],
      },
      {
        id: 'representatives',
        title: t('المندوبون والتحويلات', 'Representatives & Transfers'),
        icon: RepsFleetIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
        permission: 'canManageEmployees',
        items: [
          { key: 'employees', label: t('شؤون الموظفين', 'HR & Payroll') },
        ],
      },
      {
        id: 'reports',
        title: t('التقارير المحاسبية', 'Accounting Reports'),
        icon: ReportsChartIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        title: t('المستخدمون والصلاحيات', 'Users & Permissions'),
        icon: UsersShieldIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
        permission: 'canManageUsers',
        items: [
          { key: 'users', label: t('إدارة المستخدمين', 'Users Management') },
          { key: 'audit-log', label: t('سجل العمليات (Audit)', 'Audit Log') },
        ],
      },
      {
        id: 'settings',
        title: t('الإعدادات والنسخ الاحتياطي', 'Settings & Backup'),
        icon: SettingsTwinGearsIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
    ],
    [pendingOrdersCount, incomingDispatchCount, language]
  );

  // Auto-open the section owning the current page
  useEffect(() => {
    if (currentPage === 'dashboard') return;
    const ownerSection = navSections.find((sec) => sec.items.some((it) => it.key === currentPage));
    if (ownerSection) {
      setOpenSectionIds((prev) => ({ ...prev, [ownerSection.id]: true }));
    }
  }, [currentPage, navSections]);

  // Escape key closes the mobile sliding drawer ONLY when no modal is open (never auto-closes docked desktop sidebar)
  useEffect(() => {
    if (!isOpen || !mobileDrawer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"], .fixed.inset-0.z-50')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, mobileDrawer, onClose]);

  const checkPerm = (perm?: string | string[]) => {
    if (!perm) return true;
    if (currentUser?.role === 'admin') return true;
    if (Array.isArray(perm)) return perm.some((p) => hasPermission(p as any));
    return hasPermission(perm as any);
  };

  const filteredSections = navSections
    .map((section) => {
      const sectionAllowed = checkPerm(section.permission);
      const allowedItems = section.items.filter((item) => {
        if (item.allowAllStaff) return true;
        if (item.permission) return checkPerm(item.permission);
        return sectionAllowed;
      });
      return {
        ...section,
        items: allowedItems,
      };
    })
    .filter((section) => section.items.length > 0);

  const toggleSection = (id: string) => {
    setOpenSectionIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleItemClick = (key: NavItemKey) => {
    onNavigate(key);
    if (mobileDrawer) {
      onClose();
    }
  };

  if (!mobileDrawer && !isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop Overlay for Mobile Sliding Drawer ONLY */}
      {mobileDrawer && isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 dark:bg-[#040B17]/70 backdrop-blur-[2px] transition-opacity no-print"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Vertical Sidebar: Docked push sibling on Desktop/Tablet (>=768px), Responsive sliding drawer on Mobile */}
      <aside
        id="system-sections-drawer"
        aria-label={t('قائمة الأقسام الجانبية', 'Sidebar Sections Menu')}
        aria-hidden={!isOpen}
        className={`${
          mobileDrawer
            ? `fixed top-0 bottom-0 ${isLtr ? 'left-0 border-r' : 'right-0 border-l'} z-50 w-[82vw] max-w-[280px] shadow-2xl transition-transform duration-200 ease-out ${
                isOpen
                  ? 'translate-x-0 pointer-events-auto'
                  : isLtr
                  ? '-translate-x-full pointer-events-none'
                  : 'translate-x-full pointer-events-none'
              }`
            : `relative shrink-0 h-full ${isLtr ? 'border-r' : 'border-l'} ${
                isCollapsed ? 'w-12' : 'w-[162px] sm:w-56'
              } shadow-xs`
        } bg-white dark:bg-[#0E1C36] text-slate-800 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] flex flex-col pt-safe pb-safe no-print`}
      >
        {/* Sidebar Header Strip (Logo Navy/Royal Gradient) */}
        <div className="h-10 flex items-center justify-between px-1.5 sm:px-2 awlad-brand-gradient text-white border-b border-[var(--awlad-royal-500)]/40 dark:border-[#2A4D86] shrink-0">
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
            <img
              src="/awlad-selim-logo.png"
              alt={t('أولاد سليم', 'Awlad Selim')}
              className="h-6 w-6 object-contain bg-white no-dark-surface rounded-md p-0.5 shrink-0"
            />
            <div className="text-start min-w-0">
              <span className="block font-black text-[11px] sm:text-xs text-white tracking-wide truncate">
                {t('أقسام النظام', 'System Sections')}
              </span>
            </div>
          </div>

          <button
            type="button"
            data-testid="sidebar-close-btn"
            onClick={onClose}
            className="h-7 px-1.5 sm:px-2 flex items-center justify-center gap-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-[10.5px] sm:text-[11px] font-bold transition-colors cursor-pointer shrink-0"
            aria-label={t('إغلاق قائمة الأقسام', 'Close Sections Menu')}
            title={t('إغلاق القائمة الجانبية', 'Close Sidebar')}
          >
            <X className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{t('إغلاق', 'Close')}</span>
          </button>
        </div>

        {/* Collapsed Slim Rail Mode (Desktop lg+) */}
        {isCollapsed && (
          <div className="hidden lg:flex flex-col items-center flex-1 overflow-y-auto py-1.5 gap-1 no-scrollbar">
            <button
              type="button"
              onClick={() => handleItemClick('dashboard')}
              title={t('لوحة التحكم الرئيسية', 'Main Dashboard')}
              className={`w-9 h-9 rounded-md flex items-center justify-center border transition-colors cursor-pointer ${
                currentPage === 'dashboard'
                  ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                  : 'bg-white dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461]'
              }`}
            >
              <DashboardHomeIcon className="w-4 h-4" />
            </button>
            {filteredSections.map((section) => {
              const SectionIcon = section.icon;
              const hasActiveChild = section.items.some((item) => item.key === currentPage);
              return (
                <button
                  key={section.id}
                  type="button"
                  title={section.title}
                  onClick={() => {
                    const firstItem = section.items[0];
                    if (firstItem) handleItemClick(firstItem.key);
                  }}
                  className={`w-9 h-9 rounded-md flex items-center justify-center border transition-colors cursor-pointer ${
                    hasActiveChild
                      ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                      : 'bg-white dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461]'
                  }`}
                >
                  <SectionIcon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        )}

        {/* Expanded Sections Container */}
        <div className={`flex-1 overflow-y-auto overscroll-contain p-1 space-y-1 ${isCollapsed ? 'lg:hidden' : ''}`}>
          {/* Quick Link: Dashboard */}
          <button
            type="button"
            onClick={() => handleItemClick('dashboard')}
            className={`w-full min-h-[30px] flex items-center justify-between px-2 py-1 rounded-md font-bold text-xs border transition-all cursor-pointer ${
              currentPage === 'dashboard'
                ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40 font-black'
                : 'bg-white dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461]'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-5 h-5 rounded bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E] flex items-center justify-center shrink-0">
                <DashboardHomeIcon className="w-3.5 h-3.5" />
              </span>
              <span className="truncate">{t('لوحة التحكم الرئيسية', 'Main Dashboard')}</span>
            </div>
            {isLtr ? (
              <ChevronRight
                className={`w-3.5 h-3.5 shrink-0 ${
                  currentPage === 'dashboard' ? 'text-blue-100' : 'text-slate-400 dark:text-[#849BBF]'
                }`}
              />
            ) : (
              <ChevronLeft
                className={`w-3.5 h-3.5 shrink-0 ${
                  currentPage === 'dashboard' ? 'text-blue-100' : 'text-slate-400 dark:text-[#849BBF]'
                }`}
              />
            )}
          </button>

          {/* Quick Cash Operations (Direct Execution, Permission-Gated) */}
          {checkPerm('canManageCashboxes') && onOpenCashOp && (
            <div className="rounded-lg bg-[var(--awlad-blue-tint-50)]/70 dark:bg-[#132544] border border-[var(--awlad-blue-tint-100)] dark:border-[#21375C] p-1 space-y-1">
              <p className="text-[11px] font-black text-[var(--awlad-navy-900)] dark:text-[#F3F7FC] flex items-center gap-1">
                <Wallet className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#60A5FA]" />
                <span>{t('العمليات النقدية السريعة', 'Quick Cash Operations')}</span>
              </p>
              <div className="grid grid-cols-2 gap-1 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cash_deposit');
                    if (mobileDrawer) onClose();
                  }}
                  className="h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#2A436E] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] hover:border-[var(--awlad-royal-700)] dark:hover:border-[#3B82F6] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <ArrowDownCircle className="w-3 h-3 text-emerald-700 dark:text-emerald-400 shrink-0" />
                  <span>{t('إيداع نقدي', 'Cash Deposit')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cash_withdrawal');
                    if (mobileDrawer) onClose();
                  }}
                  className="h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#2A436E] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] hover:border-[var(--awlad-royal-700)] dark:hover:border-[#3B82F6] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <ArrowUpCircle className="w-3 h-3 text-red-700 dark:text-red-400 shrink-0" />
                  <span>{t('سحب نقدي', 'Cash Withdrawal')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('expense');
                    if (mobileDrawer) onClose();
                  }}
                  className="h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#2A436E] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] hover:border-[var(--awlad-royal-700)] dark:hover:border-[#3B82F6] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <TrendingDown className="w-3 h-3 text-amber-700 dark:text-amber-400 shrink-0" />
                  <span>{t('مصروف', 'Expense')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('profit_deposit');
                    if (mobileDrawer) onClose();
                  }}
                  className="h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#2A436E] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] hover:border-[var(--awlad-royal-700)] dark:hover:border-[#3B82F6] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <TrendingUp className="w-3 h-3 text-[var(--awlad-royal-700)] dark:text-[#60A5FA] shrink-0" />
                  <span>{t('إيداع ربحي', 'Profit Deposit')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cashbox_transfer');
                    if (mobileDrawer) onClose();
                  }}
                  className="col-span-2 h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E] text-[var(--awlad-royal-700)] dark:text-[#85B8FF] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <ArrowLeftRight className="w-3 h-3 shrink-0" />
                  <span>{t('ترحيل فوري بين الخزائن', 'Instant Cashbox Transfer')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Expandable / Collapsible Sections List */}
          {filteredSections.map((section) => {
            const SectionIcon = section.icon;
            const isExpanded = Boolean(openSectionIds[section.id]);
            const hasActiveChild = section.items.some((item) => item.key === currentPage);

            return (
              <div
                key={section.id}
                className={`rounded-lg border overflow-hidden bg-white dark:bg-[#0E1C36] transition-colors ${
                  hasActiveChild ? 'border-[var(--awlad-royal-700)] dark:border-[#3B82F6]' : 'border-slate-200 dark:border-[#21375C]'
                }`}
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                  className={`w-full min-h-[28px] flex items-center justify-between px-2 py-0.5 text-xs font-black transition-colors cursor-pointer ${
                    section.headerGradient
                  } ${isExpanded ? 'border-b border-slate-200 dark:border-[#21375C]' : ''}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-5 h-5 rounded flex items-center justify-center shrink-0 p-0.5 ${section.iconAccent}`}
                    >
                      <SectionIcon className="w-3.5 h-3.5" />
                    </span>
                    <span className="truncate">{section.title}</span>
                  </div>

                  <ChevronDown
                    className={`w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-[#849BBF] transition-transform duration-150 ${
                      isExpanded ? 'rotate-180 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]' : ''
                    }`}
                  />
                </button>

                {/* Collapsible Submenu Items */}
                {isExpanded && (
                  <div className="p-1 space-y-0.5 bg-white dark:bg-[#0E1C36]">
                    {section.items.map((item) => {
                      const isActive = currentPage === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => handleItemClick(item.key)}
                          className={`w-full min-h-[28px] flex items-center justify-between gap-1.5 px-2 py-1 rounded-md text-[11.5px] transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white font-black'
                              : 'text-slate-700 dark:text-[#C9D7EC] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] hover:text-[var(--awlad-navy-900)] dark:hover:text-[#F3F7FC] font-semibold'
                          }`}
                        >
                          <span className="truncate">{item.label}</span>

                          {item.badge && (
                            <span
                              className={`text-[10px] font-bold font-mono tabular-nums px-1.5 py-0.5 rounded shrink-0 ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#16366B] text-[var(--awlad-navy-900)] dark:text-[#85B8FF] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]'
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
        </div>

        {/* Clean Drawer Footer */}
        <div className={`p-1.5 border-t border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#0A162B] text-center shrink-0 ${isCollapsed ? 'lg:hidden' : ''}`}>
          <div className="text-[10px] text-[var(--awlad-brand-silver)] dark:text-[#849BBF] font-semibold">
            <span>{t('أولاد سليم للمحاسبة • v3.0.0', 'AWLAD SELIM Accounting • v3.0.0')}</span>
          </div>
        </div>
      </aside>
    </>
  );
};

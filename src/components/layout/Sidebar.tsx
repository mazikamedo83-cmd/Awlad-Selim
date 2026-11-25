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
  | 'attendance'
  | 'advances'
  | 'payroll'
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
}) => {
  const { hasPermission, currentUser } = useAuth();
  const { customerItemOrders = [], incomingDispatchCount = 0 } = useData();
  const { dir } = usePreferences();
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
        title: 'المبيعات والعملاء',
        icon: SalesInvoiceIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        title: 'المشتريات والموردون',
        icon: SuppliersTruckIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        title: 'المخازن والمنتجات',
        icon: WarehouseBoxesIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        title: 'الحسابات والخزائن',
        icon: SafeVaultIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
        permission: 'canManageAccounts',
        items: [
          { key: 'cheques', label: 'الشيكات (واردة / صادرة)' },
          { key: 'installments', label: 'إدارة وجدولة الأقساط' },
        ],
      },
      {
        id: 'representatives',
        title: 'المندوبون والتحويلات',
        icon: RepsFleetIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        title: 'الموظفون والرواتب',
        icon: EmployeesHrIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
        permission: 'canManageEmployees',
        items: [
          { key: 'employees', label: 'شؤون الموظفين' },
          { key: 'attendance', label: 'الحضور والغياب' },
          { key: 'advances', label: 'السلف والخصومات والمكافآت', permission: 'canManageSalaries' },
          { key: 'payroll', label: 'مسير صرف الرواتب', permission: 'canManageSalaries' },
        ],
      },
      {
        id: 'reports',
        title: 'التقارير المحاسبية',
        icon: ReportsChartIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
        title: 'المستخدمون والصلاحيات',
        icon: UsersShieldIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
        permission: 'canManageUsers',
        items: [
          { key: 'users', label: 'إدارة المستخدمين' },
          { key: 'audit-log', label: 'سجل العمليات (Audit)' },
        ],
      },
      {
        id: 'settings',
        title: 'الإعدادات والنسخ الاحتياطي',
        icon: SettingsTwinGearsIcon,
        headerGradient: 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#132544] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border-[var(--awlad-blue-tint-100)] dark:border-[#21375C]',
        iconAccent: 'bg-white dark:bg-[#172E56] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E]',
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
    ],
    [pendingOrdersCount, incomingDispatchCount]
  );

  // Auto-open the section owning the current page
  useEffect(() => {
    if (currentPage === 'dashboard') return;
    const ownerSection = navSections.find((sec) => sec.items.some((it) => it.key === currentPage));
    if (ownerSection) {
      setOpenSectionIds((prev) => ({ ...prev, [ownerSection.id]: true }));
    }
  }, [currentPage, navSections]);

  // Escape key closes the mobile/tablet sliding drawer when no modal is open
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (typeof window !== 'undefined' && window.innerWidth >= 1024) return;
      if (document.querySelector('.fixed.inset-0.z-50')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

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
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop Overlay for Tablet/Small Viewports (< 1024px) */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/35 dark:bg-[#040B17]/65 backdrop-blur-[2px] transition-opacity lg:hidden no-print"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Collapsible Sidebar Drawer (RTL right-docked / LTR left-docked) */}
      <aside
        id="system-sections-drawer"
        aria-label="قائمة الأقسام الجانبية"
        aria-hidden={!isOpen}
        className={`fixed top-0 bottom-0 ${isLtr ? 'left-0 border-r' : 'right-0 border-l'} z-50 lg:z-40 bg-white dark:bg-[#0E1C36] text-slate-800 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] shadow-lg transition-all duration-200 ease-out flex flex-col pt-safe pb-safe no-print ${
          isCollapsed ? 'lg:w-12 w-[78vw] max-w-[260px]' : 'w-[78vw] max-w-[260px] lg:w-52'
        } ${
          isOpen
            ? 'translate-x-0 pointer-events-auto'
            : isLtr
            ? '-translate-x-full pointer-events-none'
            : 'translate-x-full pointer-events-none'
        }`}
      >
        {/* Drawer Header Strip (Logo Navy/Royal Gradient) */}
        <div className={`h-11 flex items-center ${isCollapsed ? 'lg:justify-center lg:px-1 justify-between px-2.5' : 'justify-between px-2'} awlad-brand-gradient text-white border-b border-[var(--awlad-royal-500)]/40 dark:border-[#2A4D86] shrink-0`}>
          <div className={`flex items-center gap-1.5 min-w-0 ${isCollapsed ? 'lg:hidden' : ''}`}>
            <img
              src="/awlad-selim-logo.png"
              alt="أولاد سليم"
              className="h-7 w-7 object-contain bg-white no-dark-surface rounded-md p-0.5 shrink-0"
            />
            <div className="text-right min-w-0">
              <span className="block font-black text-xs text-white tracking-wide truncate">
                أقسام النظام
              </span>
              <span className="block text-[10px] text-blue-100 font-semibold truncate">
                {currentUser?.fullName}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="hidden lg:flex h-7 w-7 items-center justify-center rounded-md bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer"
                aria-label={isCollapsed ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية'}
                title={isCollapsed ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية لشريط أيقونات'}
              >
                {isCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`h-7 w-7 flex items-center justify-center rounded-md bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer ${
                isCollapsed ? 'lg:hidden' : ''
              }`}
              aria-label="إغلاق قائمة الأقسام"
              title="إخفاء القائمة"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Collapsed Slim Rail Mode (Desktop lg+) */}
        {isCollapsed && (
          <div className="hidden lg:flex flex-col items-center flex-1 overflow-y-auto py-1.5 gap-1 no-scrollbar">
            <button
              type="button"
              onClick={() => handleItemClick('dashboard')}
              title="لوحة التحكم الرئيسية"
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
          {/* Quick Link: الرئيسية */}
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
              <span className="truncate">لوحة التحكم الرئيسية</span>
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
                <span>العمليات النقدية السريعة</span>
              </p>
              <div className="grid grid-cols-2 gap-1 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cash_deposit');
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#2A436E] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] hover:border-[var(--awlad-royal-700)] dark:hover:border-[#3B82F6] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <ArrowDownCircle className="w-3 h-3 text-emerald-700 dark:text-emerald-400 shrink-0" />
                  <span>إيداع نقدي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cash_withdrawal');
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#2A436E] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] hover:border-[var(--awlad-royal-700)] dark:hover:border-[#3B82F6] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <ArrowUpCircle className="w-3 h-3 text-red-700 dark:text-red-400 shrink-0" />
                  <span>سحب نقدي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('expense');
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#2A436E] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] hover:border-[var(--awlad-royal-700)] dark:hover:border-[#3B82F6] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <TrendingDown className="w-3 h-3 text-amber-700 dark:text-amber-400 shrink-0" />
                  <span>مصروف</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('profit_deposit');
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#2A436E] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] hover:border-[var(--awlad-royal-700)] dark:hover:border-[#3B82F6] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <TrendingUp className="w-3 h-3 text-[var(--awlad-royal-700)] dark:text-[#60A5FA] shrink-0" />
                  <span>إيداع ربحي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cashbox_transfer');
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="col-span-2 h-6.5 flex items-center justify-center gap-1 rounded-md bg-white dark:bg-[#0E1C36] border border-[var(--awlad-blue-tint-100)] dark:border-[#2A436E] text-[var(--awlad-royal-700)] dark:text-[#85B8FF] hover:bg-[var(--awlad-blue-tint-50)] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                >
                  <ArrowLeftRight className="w-3 h-3 shrink-0" />
                  <span>ترحيل فوري بين الخزائن</span>
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
            <span>أولاد سليم للمحاسبة • v3.0.0</span>
          </div>
        </div>
      </aside>
    </>
  );
};

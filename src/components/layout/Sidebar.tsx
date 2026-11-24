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
  ArrowDownCircle,
  ArrowUpCircle,
  TrendingDown,
  TrendingUp,
  ArrowLeftRight,
  X,
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
  onOpenCashOp,
}) => {
  const { hasPermission, currentUser } = useAuth();
  const { customerItemOrders = [] } = useData();
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
        headerGradient: 'bg-gradient-to-l from-blue-50/95 via-sky-50/80 to-white text-blue-950 border-blue-100',
        iconAccent: 'bg-white border border-blue-100 shadow-2xs',
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
        headerGradient: 'bg-slate-50 text-indigo-950 border-slate-200',
        iconAccent: 'bg-white border border-indigo-100',
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
        headerGradient: 'bg-slate-50 text-sky-950 border-slate-200',
        iconAccent: 'bg-white border border-sky-100',
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
        headerGradient: 'bg-slate-50 text-emerald-950 border-slate-200',
        iconAccent: 'bg-white border border-emerald-100',
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
        headerGradient: 'bg-gradient-to-l from-violet-50/90 via-purple-50/65 to-white text-violet-950 border-violet-100',
        iconAccent: 'bg-white border border-violet-100 shadow-2xs',
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
        headerGradient: 'bg-gradient-to-l from-cyan-50/90 via-sky-50/65 to-white text-cyan-950 border-cyan-100',
        iconAccent: 'bg-white border border-cyan-100 shadow-2xs',
        permission: 'canManageReps',
        items: [
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
        headerGradient: 'bg-slate-50 text-rose-950 border-slate-200',
        iconAccent: 'bg-white border border-rose-100',
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
        headerGradient: 'bg-slate-50 text-blue-950 border-slate-200',
        iconAccent: 'bg-white border border-blue-100',
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
        headerGradient: 'bg-slate-50 text-slate-900 border-slate-200',
        iconAccent: 'bg-white border border-slate-200',
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
        headerGradient: 'bg-slate-50 text-slate-900 border-slate-200',
        iconAccent: 'bg-white border border-slate-200',
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
    [pendingOrdersCount]
  );

  // Auto-open the section owning the current page
  useEffect(() => {
    if (currentPage === 'dashboard') return;
    const ownerSection = navSections.find((sec) => sec.items.some((it) => it.key === currentPage));
    if (ownerSection) {
      setOpenSectionIds((prev) => ({ ...prev, [ownerSection.id]: true }));
    }
  }, [currentPage, navSections]);

  // Escape key closes the sliding drawer
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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
    // On mobile viewports (< 768px), automatically close drawer after choosing a destination
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop Overlay for Narrow Viewports */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px] transition-opacity md:hidden no-print"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* RTL Sliding Sidebar Drawer — Traditional Accounting Structure */}
      <aside
        id="system-sections-drawer"
        aria-label="قائمة الأقسام الجانبية"
        aria-hidden={!isOpen}
        className={`fixed top-0 bottom-0 right-0 z-50 md:z-40 w-[82vw] max-w-[300px] md:w-72 bg-white text-slate-800 border-l border-slate-200 shadow-lg transition-transform duration-200 ease-out flex flex-col pt-safe pb-safe no-print ${
          isOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
        }`}
      >
        {/* Drawer Header Strip (Soft Royal Blue to Indigo Gradient) */}
        <div className="h-16 flex items-center justify-between px-4 bg-gradient-to-l from-blue-950 via-blue-900 to-indigo-900 text-white border-b border-blue-800/60 shrink-0 shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/awlad-selim-logo.png"
              alt="أولاد سليم"
              className="h-10 w-10 object-contain bg-white rounded-xl p-1 shrink-0 shadow-xs"
            />
            <div className="text-right min-w-0">
              <span className="block font-black text-sm text-white tracking-wide truncate">
                أقسام النظام
              </span>
              <span className="block text-[10px] text-blue-200 font-semibold truncate">
                AWLAD SELIM · {currentUser?.fullName}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer shrink-0"
            aria-label="إغلاق قائمة الأقسام"
            title="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Sections Container */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3.5 space-y-2.5">
          {/* Quick Link: الرئيسية */}
          <button
            type="button"
            onClick={() => handleItemClick('dashboard')}
            className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-2xl font-bold text-xs border transition-all cursor-pointer ${
              currentPage === 'dashboard'
                ? 'bg-gradient-to-l from-blue-700 via-blue-600 to-indigo-600 text-white border-blue-600 shadow-md shadow-blue-600/20 font-black'
                : 'bg-white/90 text-slate-800 border-blue-100 hover:bg-gradient-to-l hover:from-blue-50 hover:to-sky-50 hover:text-blue-950 shadow-2xs'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-xl bg-white border border-blue-100 flex items-center justify-center shrink-0">
                <DashboardHomeIcon className="w-5 h-5" />
              </span>
              <span>لوحة التحكم الرئيسية</span>
            </div>
            <ChevronLeft
              className={`w-4 h-4 shrink-0 ${
                currentPage === 'dashboard' ? 'text-blue-100' : 'text-slate-400'
              }`}
            />
          </button>

          {/* Quick Cash Operations (Direct Execution, Permission-Gated) */}
          {checkPerm('canManageCashboxes') && onOpenCashOp && (
            <div className="rounded-2xl bg-gradient-to-br from-emerald-50/90 via-white to-sky-50/80 border border-emerald-200/70 p-3 space-y-2 shadow-2xs">
              <p className="text-[11px] font-black text-emerald-950 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                <span>العمليات النقدية السريعة</span>
              </p>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cash_deposit');
                    if (typeof window !== 'undefined' && window.innerWidth < 768) onClose();
                  }}
                  className="min-h-[36px] flex items-center justify-center gap-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-50 transition-colors cursor-pointer"
                >
                  <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>إيداع نقدي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cash_withdrawal');
                    if (typeof window !== 'undefined' && window.innerWidth < 768) onClose();
                  }}
                  className="min-h-[36px] flex items-center justify-center gap-1.5 rounded-lg bg-white border border-rose-200 text-rose-800 hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>سحب نقدي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('expense');
                    if (typeof window !== 'undefined' && window.innerWidth < 768) onClose();
                  }}
                  className="min-h-[36px] flex items-center justify-center gap-1.5 rounded-lg bg-white border border-orange-200 text-orange-800 hover:bg-orange-50 transition-colors cursor-pointer"
                >
                  <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                  <span>مصروف</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('profit_deposit');
                    if (typeof window !== 'undefined' && window.innerWidth < 768) onClose();
                  }}
                  className="min-h-[36px] flex items-center justify-center gap-1.5 rounded-lg bg-white border border-teal-200 text-teal-800 hover:bg-teal-50 transition-colors cursor-pointer"
                >
                  <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                  <span>إيداع ربحي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cashbox_transfer');
                    if (typeof window !== 'undefined' && window.innerWidth < 768) onClose();
                  }}
                  className="col-span-2 min-h-[36px] flex items-center justify-center gap-1.5 rounded-lg bg-white border border-blue-200 text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
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
                className={`rounded-xl border overflow-hidden bg-white transition-colors ${
                  hasActiveChild ? 'border-blue-400' : 'border-slate-200'
                }`}
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                  className={`w-full min-h-[40px] flex items-center justify-between px-3 py-2 text-xs font-black transition-colors cursor-pointer ${
                    section.headerGradient
                  } ${isExpanded ? 'border-b border-slate-200' : ''}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 p-1 ${section.iconAccent}`}
                    >
                      <SectionIcon className="w-5 h-5" />
                    </span>
                    <span className="truncate">{section.title}</span>
                  </div>

                  <ChevronDown
                    className={`w-4 h-4 shrink-0 text-slate-500 transition-transform duration-150 ${
                      isExpanded ? 'rotate-180 text-blue-700' : ''
                    }`}
                  />
                </button>

                {/* Collapsible Submenu Items */}
                {isExpanded && (
                  <div className="p-1 space-y-0.5 bg-white">
                    {section.items.map((item) => {
                      const isActive = currentPage === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => handleItemClick(item.key)}
                          className={`w-full min-h-[36px] flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-blue-900 text-white font-black'
                              : 'text-slate-700 hover:bg-slate-100 hover:text-blue-950 font-semibold'
                          }`}
                        >
                          <span className="truncate">{item.label}</span>

                          {item.badge && (
                            <span
                              className={`text-[10px] font-bold font-mono tabular-nums px-1.5 py-0.5 rounded shrink-0 ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-blue-50 text-blue-900 border border-blue-200'
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
        <div className="p-2.5 border-t border-slate-200 bg-slate-50 text-center shrink-0">
          <div className="text-[11px] text-slate-600 font-semibold">
            <span>أولاد سليم للمحاسبة • v3.0.0</span>
          </div>
        </div>
      </aside>
    </>
  );
};

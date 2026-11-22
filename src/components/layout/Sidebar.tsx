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

  // Expandable/collapsible section groups; current page's section stays open smoothly
  const [openSectionIds, setOpenSectionIds] = useState<Record<string, boolean>>({
    sales: true,
    inventory: false,
    finance: false,
  });

  const navSections: NavSection[] = useMemo(
    () => [
      {
        id: 'sales',
        title: 'المبيعات والعملاء',
        icon: ShoppingCart,
        headerGradient: 'bg-gradient-to-l from-blue-50/95 via-sky-50/80 to-white text-blue-950 border-blue-100',
        iconAccent: 'bg-blue-100/80 text-blue-800',
        permission: 'canManageSales',
        items: [
          {
            key: 'customer-orders',
            label: 'طلبات العملاء والمندوبين',
            badge: pendingOrdersCount > 0 ? `${pendingOrdersCount} جديد` : undefined,
          },
          { key: 'sales-invoices', label: 'فواتير المبيعات' },
          { key: 'quotes', label: 'عروض الأسعار', badge: 'جديد' },
          { key: 'new-sale', label: 'فاتورة مبيعات جديدة (+)', badge: 'جديد' },
          { key: 'customers', label: 'العملاء والأرصدة' },
          { key: 'sales-returns', label: 'مرتجع المبيعات' },
          { key: 'deleted-invoices', label: 'الفواتير المحذوفة والملغاة', permission: 'canViewDeletedInvoices' },
        ],
      },
      {
        id: 'purchases',
        title: 'المشتريات والموردون',
        icon: Truck,
        headerGradient: 'bg-gradient-to-l from-indigo-50/90 via-violet-50/70 to-white text-indigo-950 border-indigo-100',
        iconAccent: 'bg-indigo-100/80 text-indigo-800',
        permission: 'canManagePurchases',
        items: [
          { key: 'purchase-invoices', label: 'فواتير المشتريات' },
          { key: 'new-purchase', label: 'فاتورة شراء جديدة (+)' },
          { key: 'suppliers', label: 'دليل الموردين والأرصدة' },
          { key: 'purchase-returns', label: 'مرتجع المشتريات' },
        ],
      },
      {
        id: 'inventory',
        title: 'المخازن والمنتجات',
        icon: Boxes,
        headerGradient: 'bg-gradient-to-l from-sky-50/95 via-cyan-50/70 to-white text-sky-950 border-sky-100',
        iconAccent: 'bg-sky-100/80 text-sky-800',
        permission: 'canManageInventory',
        items: [
          { key: 'products', label: 'المنتجات والأسعار' },
          { key: 'product-categories', label: 'تصنيفات السلع' },
          {
            key: 'units-settings',
            label: 'الوحدات ومعاملات التحويل',
            permission: ['canManageInventory', 'canManageSettings'],
          },
          { key: 'abu-selim-import', label: 'استيراد الملفات', badge: 'جديد' },
          { key: 'warehouses', label: 'أرصدة المستودعات', permission: 'canManageWarehouses' },
          {
            key: 'stock-transfers-orders',
            label: 'أوامر تحويل الأصناف',
            badge: 'منظم',
            permission: ['canCreateStockTransfer', 'canApproveStockTransfer', 'canExecuteStockTransfer', 'canManageInventory'],
          },
          {
            key: 'stock-counts',
            label: 'جرد المخزن المعتمد',
            badge: 'جرد',
            permission: ['canCreateStockCount', 'canApproveStockCount', 'canManageInventory'],
          },
          { key: 'stock-transfers', label: 'تحويل سريع بين المستودعات' },
          { key: 'stock-adjustments', label: 'تسوية سريعة للمخزون' },
          { key: 'damaged-stock', label: 'بضاعة تالفة ومنتهية' },
          { key: 'stock-movements', label: 'سجل حركة الأصناف' },
          {
            key: 'item-movement-report',
            label: 'تقرير حركة الصنف المفصل',
            badge: 'مفصل',
            permission: ['canManageInventory', 'canViewReports'],
          },
        ],
      },
      {
        id: 'finance',
        title: 'المالية والخزائن',
        icon: Wallet,
        headerGradient: 'bg-gradient-to-l from-emerald-50/90 via-teal-50/65 to-white text-emerald-950 border-emerald-100',
        iconAccent: 'bg-emerald-100/80 text-emerald-800',
        permission: 'canManageCashboxes',
        items: [
          { key: 'cashboxes', label: 'الخزائن والبنوك' },
          { key: 'cashbox-transfer', label: 'تحويل بين الخزائن' },
          { key: 'expenses', label: 'المصروفات والإيرادات' },
          {
            key: 'personal-accounts',
            label: 'الحسابات الشخصية للملاك',
            badge: 'مستقل',
            permission: 'canViewPersonalAccounts',
          },
        ],
      },
      {
        id: 'cheques-inst',
        title: 'الشيكات والأقساط',
        icon: CreditCard,
        headerGradient: 'bg-gradient-to-l from-violet-50/90 via-purple-50/65 to-white text-violet-950 border-violet-100',
        iconAccent: 'bg-violet-100/80 text-violet-800',
        permission: 'canManageAccounts',
        items: [
          { key: 'cheques', label: 'الشيكات (واردة / صادرة)' },
          { key: 'installments', label: 'إدارة وجدولة الأقساط' },
        ],
      },
      {
        id: 'representatives',
        title: 'المندوبون والتحويلات',
        icon: Users2,
        headerGradient: 'bg-gradient-to-l from-cyan-50/90 via-sky-50/65 to-white text-cyan-950 border-cyan-100',
        iconAccent: 'bg-cyan-100/80 text-cyan-800',
        permission: 'canManageReps',
        items: [
          { key: 'reps', label: 'قائمة المناديب' },
          {
            key: 'rep-transfers',
            label: 'طلب تحويل بالنصف (المالي)',
            badge: 'تأكيد ثنائي',
            permission: 'canManageTransfers',
          },
          {
            key: 'rep-item-transfers',
            label: 'تحويل أصناف وعهدة (فاتورة)',
            badge: 'عهدة',
            permission: 'canManageTransfers',
          },
        ],
      },
      {
        id: 'employees',
        title: 'الموظفون والرواتب',
        icon: Users,
        headerGradient: 'bg-gradient-to-l from-rose-50/85 via-pink-50/60 to-white text-rose-950 border-rose-100',
        iconAccent: 'bg-rose-100/80 text-rose-800',
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
        icon: FileBarChart,
        headerGradient: 'bg-gradient-to-l from-blue-50/85 via-indigo-50/65 to-white text-blue-950 border-blue-100',
        iconAccent: 'bg-blue-100/80 text-blue-800',
        permission: 'canViewReports',
        items: [
          { key: 'reports', label: 'جميع التقارير والأرباح' },
          { key: 'item-movement-report', label: 'تقرير حركة الصنف المفصل', badge: 'جديد' },
        ],
      },
      {
        id: 'management',
        title: 'المستخدمون والصلاحيات',
        icon: Shield,
        headerGradient: 'bg-gradient-to-l from-slate-100/95 via-blue-50/65 to-white text-slate-900 border-slate-200/80',
        iconAccent: 'bg-slate-200/80 text-slate-800',
        permission: 'canManageUsers',
        items: [
          { key: 'users', label: 'إدارة المستخدمين' },
          { key: 'audit-log', label: 'سجل العمليات (Audit)' },
        ],
      },
      {
        id: 'settings',
        title: 'الإعدادات والنسخ الاحتياطي',
        icon: Settings,
        headerGradient: 'bg-gradient-to-l from-slate-100/90 via-indigo-50/60 to-white text-slate-900 border-slate-200/80',
        iconAccent: 'bg-indigo-100/70 text-indigo-800',
        permission: 'canManageSettings',
        items: [
          { key: 'system-settings', label: 'إعدادات النظام والحساب', allowAllStaff: true },
          { key: 'branches-settings', label: 'إدارة الفروع' },
          { key: 'barcode-settings', label: 'إعدادات الباركود' },
          { key: 'printers-settings', label: 'الطابعات المتعددة' },
          { key: 'invoice-settings', label: 'تصميم وإعدادات الفاتورة' },
          { key: 'mobile-settings', label: 'إعدادات تطبيق الهاتف' },
          { key: 'online-sync-settings', label: 'مزامنة أونلاين' },
          { key: 'services-settings', label: 'الخدمات والتنبيهات' },
          { key: 'server-settings', label: 'إعدادات السيرفر والاتصال' },
          { key: 'diagnostics-settings', label: 'سجل التشخيص والأخطاء' },
          { key: 'backup', label: 'النسخ الاحتياطي والاستعادة' },
          { key: 'migration', label: 'سجل الترحيل و PostgreSQL', badge: 'جديد' },
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
    // On mobile/tablet viewports, automatically close drawer after choosing a destination
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      onClose();
    }
  };

  return (
    <>
      {/* Soft Backdrop Overlay for Mobile/Tablet (tapping outside closes drawer cleanly) */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px] transition-opacity lg:hidden no-print"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* RTL Sliding Sidebar Drawer with Soft Calm Gradients */}
      <aside
        id="system-sections-drawer"
        aria-label="قائمة الأقسام الجانبية"
        aria-hidden={!isOpen}
        className={`fixed top-0 bottom-0 right-0 z-50 lg:z-40 w-[82vw] max-w-[330px] sm:w-80 bg-gradient-to-b from-white via-sky-50/60 to-indigo-50/75 text-slate-800 border-l border-blue-200/80 shadow-2xl transition-transform duration-300 ease-out flex flex-col pt-safe pb-safe no-print ${
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
              <LayoutDashboard className="w-4 h-4 shrink-0" />
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
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl bg-white/95 border border-emerald-200/80 text-emerald-800 hover:bg-emerald-50 transition-colors cursor-pointer"
                >
                  <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>إيداع نقدي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cash_withdrawal');
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl bg-white/95 border border-rose-200/80 text-rose-800 hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>سحب نقدي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('expense');
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl bg-white/95 border border-orange-200/80 text-orange-800 hover:bg-orange-50 transition-colors cursor-pointer"
                >
                  <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                  <span>مصروف</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('profit_deposit');
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl bg-white/95 border border-teal-200/80 text-teal-800 hover:bg-teal-50 transition-colors cursor-pointer"
                >
                  <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                  <span>إيداع ربحي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashOp('cashbox_transfer');
                    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose();
                  }}
                  className="col-span-2 min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl bg-white/95 border border-blue-200/80 text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
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
                className={`rounded-2xl border overflow-hidden bg-white/90 backdrop-blur-xs shadow-2xs transition-colors ${
                  hasActiveChild ? 'border-blue-300' : 'border-slate-200/80'
                }`}
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                  className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 text-xs font-black transition-colors cursor-pointer ${
                    section.headerGradient
                  } ${isExpanded ? 'border-b' : ''}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${section.iconAccent}`}
                    >
                      <SectionIcon className="w-4 h-4" />
                    </span>
                    <span className="truncate">{section.title}</span>
                  </div>

                  <ChevronDown
                    className={`w-4 h-4 shrink-0 text-slate-500 transition-transform duration-200 ${
                      isExpanded ? 'rotate-180 text-blue-700' : ''
                    }`}
                  />
                </button>

                {/* Collapsible Submenu Items */}
                {isExpanded && (
                  <div className="p-1.5 space-y-1 bg-gradient-to-b from-white to-slate-50/70">
                    {section.items.map((item) => {
                      const isActive = currentPage === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => handleItemClick(item.key)}
                          className={`w-full min-h-[40px] flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs transition-all cursor-pointer ${
                            isActive
                              ? 'bg-gradient-to-l from-blue-600 to-indigo-600 text-white font-black shadow-xs shadow-blue-600/20'
                              : 'text-slate-700 hover:bg-blue-50/80 hover:text-blue-950 font-semibold'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                isActive ? 'bg-white' : 'bg-blue-400/70'
                              }`}
                            />
                            <span className="truncate">{item.label}</span>
                          </div>

                          {item.badge && (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-blue-50 text-blue-800 border border-blue-200/80'
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

        {/* Soft Gradient Drawer Footer */}
        <div className="p-3 border-t border-blue-100 bg-gradient-to-l from-sky-50/90 via-white to-indigo-50/90 text-center shrink-0">
          <div className="text-[11px] text-slate-600 font-semibold">
            <span>أولاد سليم v3.0.0</span>
            <span className="mx-2 text-slate-300">•</span>
            <span className="text-emerald-700 font-bold">نظام محاسبي متكامل</span>
          </div>
        </div>
      </aside>
    </>
  );
};

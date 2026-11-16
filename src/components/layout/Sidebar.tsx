import React, { useState } from 'react';
import { 
  LayoutDashboard, ShoppingCart, Truck, Boxes, Wallet, CreditCard, 
  Users2, Users, FileBarChart, Shield, Settings, ChevronDown, ChevronLeft, 
  ArrowLeftRight, PackagePlus, FilePlus, UserCheck, CalendarDays, DollarSign,
  Smartphone, Database, X, HelpCircle
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export type NavItemKey =
  | 'dashboard'
  | 'sales-invoices'
  | 'new-sale'
  | 'customers'
  | 'sales-returns'
  | 'deleted-invoices'
  | 'purchase-invoices'
  | 'new-purchase'
  | 'suppliers'
  | 'purchase-returns'
  | 'products'
  | 'product-categories' // إدارة تصنيفات السلع
  | 'units-settings' // الوحدات ومعاملات التحويل
  | 'warehouses'
  | 'stock-transfers'
  | 'stock-transfers-orders' // تحويل الأصناف المنظم
  | 'stock-adjustments'
  | 'stock-counts' // جرد المخزن المعتمد
  | 'damaged-stock'
  | 'stock-movements'
  | 'abu-selim-import' // استيراد الملفات
  | 'cashboxes'
  | 'cashbox-transfer'
  | 'expenses'
  | 'personal-accounts' // الحسابات الشخصية لأصحاب النشاط
  | 'cheques'
  | 'installments'
  | 'reps'
  | 'rep-transfers' // "طلب تحويل بالنصف (المالي)"
  | 'rep-item-transfers' // طلبات تحويل الأصناف والعهد المرتبطة بالفاتورة
  | 'employees'
  | 'attendance'
  | 'advances'
  | 'payroll'
  | 'reports'
  | 'users'
  | 'audit-log'
  | 'system-settings'
  | 'server-settings' // إعدادات السيرفر والاتصال المحلي
  | 'backup'
  | 'migration'
  | 'branches-settings'
  | 'barcode-settings'
  | 'printers-settings'
  | 'invoice-settings'
  | 'mobile-settings'
  | 'online-sync-settings'
  | 'shortcuts-settings'
  | 'services-settings';

interface SidebarProps {
  currentPage: NavItemKey;
  onNavigate: (page: NavItemKey) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavSection {
  id: string;
  title: string;
  icon: React.ElementType;
  permission?: string | string[];
  items: Array<{
    key: NavItemKey;
    label: string;
    icon?: React.ElementType;
    permission?: string | string[];
    badge?: string;
  }>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
  isCollapsed,
  onToggleCollapse,
}) => {
  const { hasPermission, currentUser } = useAuth();

  // Accordion state: only one section open at a time; clicking open section closes it.
  const [openSectionId, setOpenSectionId] = useState<string | null>('sales');

  const toggleSection = (id: string) => {
    setOpenSectionId(prev => (prev === id ? null : id));
  };

  const navSections: NavSection[] = [
    {
      id: 'sales',
      title: 'المبيعات والعملاء',
      icon: ShoppingCart,
      permission: 'canManageSales',
      items: [
        { key: 'sales-invoices', label: 'فواتير المبيعات' },
        { key: 'new-sale', label: 'فاتورة مبيعات جديدة (+)', badge: 'جديد' },
        { key: 'customers', label: 'دليل العملاء والأرصدة' },
        { key: 'sales-returns', label: 'مرتجع المبيعات' },
        { key: 'deleted-invoices', label: 'الفواتير المحذوفة والملغاة', permission: 'canViewDeletedInvoices' },
      ],
    },
    {
      id: 'purchases',
      title: 'المشتريات والموردون',
      icon: Truck,
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
      permission: 'canManageInventory',
      items: [
        { key: 'products', label: 'المنتجات والأسعار' },
        { key: 'product-categories', label: 'تصنيفات السلع' },
        { key: 'units-settings', label: 'الوحدات ومعاملات التحويل' },
        { key: 'abu-selim-import', label: 'استيراد الملفات', badge: 'جديد' },
        { key: 'warehouses', label: 'أرصدة المستودعات', permission: 'canManageWarehouses' },
        { key: 'stock-transfers-orders', label: 'أوامر تحويل الأصناف', badge: 'منظم', permission: ['canCreateStockTransfer', 'canApproveStockTransfer', 'canExecuteStockTransfer', 'canManageInventory'] },
        { key: 'stock-counts', label: 'جرد المخزن المعتمد', badge: 'جرد', permission: ['canCreateStockCount', 'canApproveStockCount', 'canManageInventory'] },
        { key: 'stock-transfers', label: 'تحويل سريع بين المستودعات' },
        { key: 'stock-adjustments', label: 'تسوية سريعة للمخزون' },
        { key: 'damaged-stock', label: 'بضاعة تالفة ومنتهية' },
        { key: 'stock-movements', label: 'سجل حركة الأصناف' },
      ],
    },
    {
      id: 'finance',
      title: 'المالية والخزائن',
      icon: Wallet,
      permission: 'canManageCashboxes',
      items: [
        { key: 'cashboxes', label: 'الخزائن والبنوك' },
        { key: 'cashbox-transfer', label: 'تحويل بين الخزائن' },
        { key: 'expenses', label: 'المصروفات والإيرادات' },
        { key: 'personal-accounts', label: 'الحسابات الشخصية للملاك', badge: 'مستقل', permission: 'canViewPersonalAccounts' },
      ],
    },
    {
      id: 'cheques-inst',
      title: 'الشيكات والأقساط',
      icon: CreditCard,
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
      permission: 'canManageEmployees',
      items: [
        { key: 'employees', label: 'شؤون الموظفين' },
        { key: 'advances', label: 'السلف والخصومات والمكافآت', permission: 'canManageSalaries' },
        { key: 'payroll', label: 'مسير صرف الرواتب', permission: 'canManageSalaries' },
      ],
    },
    {
      id: 'reports',
      title: 'التقارير المحاسبية',
      icon: FileBarChart,
      permission: 'canViewReports',
      items: [
        { key: 'reports', label: 'جميع التقارير والأرباح' },
      ],
    },
    {
      id: 'management',
      title: 'المستخدمون والصلاحيات',
      icon: Shield,
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
      permission: 'canManageSettings',
      items: [
        { key: 'system-settings', label: 'إعدادات النظام والطباعة' },
        { key: 'server-settings', label: 'إعدادات السيرفر والاتصال' },
        { key: 'backup', label: 'النسخ الاحتياطي والاستعادة' },
        { key: 'migration', label: 'سجل الترحيل و PostgreSQL', badge: 'جديد' },
      ],
    },
  ];

  const checkPerm = (perm?: string | string[]) => {
    if (!perm) return true;
    if (currentUser?.role === 'admin') return true;
    if (Array.isArray(perm)) return perm.some((p) => hasPermission(p as any));
    return hasPermission(perm as any);
  };

  // Filter sections and items based on permissions (allow section if user has section perm OR any child item perm)
  const filteredSections = navSections
    .map(section => {
      const sectionAllowed = checkPerm(section.permission);
      const allowedItems = section.items.filter(item => {
        if (item.permission) return checkPerm(item.permission);
        return sectionAllowed;
      });
      return {
        ...section,
        items: allowedItems,
      };
    })
    .filter(section => section.items.length > 0);

  const handleItemClick = (key: NavItemKey) => {
    onNavigate(key);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 right-0 z-40 bg-slate-900 text-slate-200 border-l border-slate-800 transition-all duration-300 flex flex-col no-print
          ${isOpenMobile ? 'translate-x-0 w-72' : 'translate-x-full lg:translate-x-0'}
          ${isCollapsed ? 'lg:w-20' : 'lg:w-72'}
        `}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/80 bg-slate-950">
          <div className="flex items-center gap-3 overflow-hidden">
            <img
              src="/awlad-selim-logo.png"
              alt="أولاد سليم"
              className="h-10 w-auto object-contain shrink-0"
            />
            {!isCollapsed && (
              <div className="text-right">
                <span className="block font-black text-sm text-white tracking-wide">
                  أولاد سليم
                </span>
                <span className="block text-[10px] text-blue-400 font-medium">
                  نظام المحاسبة المتكامل
                </span>
              </div>
            )}
          </div>

          {/* Close button on mobile */}
          <button
            onClick={onCloseMobile}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {/* Main Dashboard item */}
          <button
            onClick={() => handleItemClick('dashboard')}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl font-bold text-xs transition-all ${
              currentPage === 'dashboard'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 font-black'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
            }`}
            title="لوحة التحكم الرئيسية"
          >
            <LayoutDashboard className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span>لوحة التحكم الرئيسية</span>}
          </button>

          <div className="h-px bg-slate-800 my-2"></div>

          {/* Accordion Sections */}
          {filteredSections.map(section => {
            const SectionIcon = section.icon;
            const isOpen = openSectionId === section.id;
            const hasActiveChild = section.items.some(item => item.key === currentPage);

            return (
              <div key={section.id} className="rounded-xl overflow-hidden">
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    hasActiveChild
                      ? 'bg-blue-950/60 text-blue-300 border border-blue-900/50'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                  title={section.title}
                >
                  <div className="flex items-center gap-3">
                    <SectionIcon className={`w-4 h-4 shrink-0 ${hasActiveChild ? 'text-blue-400' : 'text-slate-400'}`} />
                    {!isCollapsed && <span>{section.title}</span>}
                  </div>

                  {!isCollapsed && (
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-blue-400' : ''
                      }`}
                    />
                  )}
                </button>

                {/* Submenu (Accordion items) */}
                {isOpen && !isCollapsed && (
                  <div className="mt-1 mr-4 pr-3 border-r-2 border-slate-800 space-y-1 py-1">
                    {section.items.map(item => {
                      const isActive = currentPage === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => handleItemClick(item.key)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-xs font-bold'
                              : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-slate-600'}`}></span>
                            <span>{item.label}</span>
                          </div>

                          {item.badge && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                              isActive ? 'bg-blue-700 text-white' : 'bg-blue-900/40 text-blue-300 border border-blue-800'
                            }`}>
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

        {/* Sidebar Footer info */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60 text-center">
          {!isCollapsed ? (
            <div className="text-[11px] text-slate-400 font-medium">
              <span>أولاد سليم v2.4</span>
              <span className="mx-2">•</span>
              <span className="text-emerald-400">نظام محمي وآمن</span>
            </div>
          ) : (
            <span className="text-[10px] text-blue-400 font-black">AS</span>
          )}
        </div>
      </aside>
    </>
  );
};

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
  | 'purchase-invoices'
  | 'new-purchase'
  | 'suppliers'
  | 'purchase-returns'
  | 'products'
  | 'product-categories' // إدارة تصنيفات السلع
  | 'warehouses'
  | 'stock-transfers'
  | 'stock-adjustments'
  | 'damaged-stock'
  | 'stock-movements'
  | 'abu-selim-import' // استيراد ملفات أبو سليم
  | 'cashboxes'
  | 'cashbox-transfer'
  | 'expenses'
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
  | 'desktop-mobile';

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
  permission?: string;
  items: Array<{
    key: NavItemKey;
    label: string;
    icon?: React.ElementType;
    permission?: string;
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
      items: [
        { key: 'sales-invoices', label: 'فواتير المبيعات' },
        { key: 'new-sale', label: 'فاتورة مبيعات جديدة (+)', badge: 'جديد' },
        { key: 'customers', label: 'دليل العملاء والأرصدة' },
        { key: 'sales-returns', label: 'مرتجع المبيعات' },
      ],
    },
    {
      id: 'purchases',
      title: 'المشتريات والموردون',
      icon: Truck,
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
      items: [
        { key: 'products', label: 'المنتجات والأسعار' },
        { key: 'product-categories', label: 'تصنيفات السلع' },
        { key: 'abu-selim-import', label: 'استيراد ملفات أبو سليم', badge: 'جديد' },
        { key: 'warehouses', label: 'أرصدة المستودعات' },
        { key: 'stock-transfers', label: 'تحويل بين المستودعات' },
        { key: 'stock-adjustments', label: 'جرد وتسوية المخزون' },
        { key: 'damaged-stock', label: 'بضاعة تالفة ومنتهية' },
        { key: 'stock-movements', label: 'سجل حركة الأصناف' },
      ],
    },
    {
      id: 'finance',
      title: 'المالية والخزائن',
      icon: Wallet,
      items: [
        { key: 'cashboxes', label: 'الخزائن والبنوك' },
        { key: 'cashbox-transfer', label: 'تحويل بين الخزائن' },
        { key: 'expenses', label: 'المصروفات والإيرادات' },
      ],
    },
    {
      id: 'cheques-inst',
      title: 'الشيكات والأقساط',
      icon: CreditCard,
      items: [
        { key: 'cheques', label: 'الشيكات (واردة / صادرة)' },
        { key: 'installments', label: 'إدارة وجدولة الأقساط' },
      ],
    },
    {
      id: 'representatives',
      title: 'المندوبون والتحويلات',
      icon: Users2,
      items: [
        { key: 'reps', label: 'قائمة المناديب' },
        { 
          key: 'rep-transfers', 
          label: 'طلب تحويل بالنصف (المالي)', 
          badge: 'تأكيد ثنائي',
        },
        {
          key: 'rep-item-transfers',
          label: 'تحويل أصناف وعهدة (فاتورة)',
          badge: 'عهدة',
        },
      ],
    },
    {
      id: 'employees',
      title: 'الموظفون والرواتب',
      icon: Users,
      items: [
        { key: 'employees', label: 'شؤون الموظفين' },
        { key: 'attendance', label: 'الحضور والغياب' },
        { key: 'advances', label: 'السلف والخصومات' },
        { key: 'payroll', label: 'مسير صرف الرواتب' },
      ],
    },
    {
      id: 'reports',
      title: 'التقارير المحاسبية',
      icon: FileBarChart,
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
        { key: 'desktop-mobile', label: 'تطبيق Android و Windows' },
      ],
    },
  ];

  // Filter sections based on permissions
  const filteredSections = navSections.filter(section => {
    if (currentUser?.role === 'admin') return true;
    if (section.permission) {
      return hasPermission(section.permission as any);
    }
    return true;
  });

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

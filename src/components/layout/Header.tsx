import React, { useState, useEffect, useRef } from 'react';
import { 
  LogOut, Menu, Maximize, Minimize, Bell, ArrowLeftRight, UserCheck, 
  ShieldCheck, AlertTriangle, ChevronDown, Wallet, FileText, Sliders,
  ArrowDownCircle, ArrowUpCircle, TrendingDown, TrendingUp, Users, GitBranch,
  Tag, Ruler, Barcode, Printer, Smartphone, Wifi, Wrench, Trash2, Boxes
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { OfflineIndicator } from './OfflineIndicator';
import { NavItemKey } from './Sidebar';
import { CashOperationType, UserPermissions } from '../../types';

interface HeaderProps {
  onToggleSidebar: () => void;
  onNavigate?: (page: NavItemKey) => void;
  onOpenCashOp?: (mode: CashOperationType) => void;
  onNavigateToTransfers?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  onNavigate,
  onOpenCashOp,
  onNavigateToTransfers,
}) => {
  const { currentUser, logout, hasPermission } = useAuth();
  const { repTransfers, customerItemOrders = [] } = useData();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [openMenu, setOpenMenu] = useState<'cash' | 'invoices' | 'control' | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const canPerm = (perm?: keyof UserPermissions | Array<keyof UserPermissions>) => {
    if (!perm) return true;
    if (currentUser?.role === 'admin') return true;
    if (Array.isArray(perm)) return perm.some((p) => hasPermission(p));
    return hasPermission(perm);
  };

  type CashMenuItem = { label: string; icon: React.ElementType; action: () => void; perm?: keyof UserPermissions; cls?: string; shortcutAction?: string };
  type NavMenuItem = { label: string; icon: React.ElementType; page: NavItemKey; perm?: keyof UserPermissions | Array<keyof UserPermissions>; cls?: string; shortcutAction?: string };

  const cashMenuItemsRaw: CashMenuItem[] = [
    { label: 'سحب نقدي', icon: ArrowUpCircle, action: () => onOpenCashOp?.('cash_withdrawal'), perm: 'canManageCashboxes', cls: 'text-rose-700', shortcutAction: 'action:cash_withdrawal' },
    { label: 'إيداع نقدي', icon: ArrowDownCircle, action: () => onOpenCashOp?.('cash_deposit'), perm: 'canManageCashboxes', cls: 'text-emerald-700', shortcutAction: 'action:cash_deposit' },
    { label: 'ترحيل بين الخزائن', icon: ArrowLeftRight, action: () => onOpenCashOp?.('cashbox_transfer'), perm: 'canManageCashboxes', cls: 'text-blue-900' },
    { label: 'مصروفات', icon: TrendingDown, action: () => onOpenCashOp?.('expense'), perm: 'canManageCashboxes', cls: 'text-orange-700' },
    { label: 'إيداع ربحي', icon: TrendingUp, action: () => onOpenCashOp?.('profit_deposit'), perm: 'canManageCashboxes', cls: 'text-teal-700' },
    { label: 'الحسابات الشخصية للملاك', icon: Wallet, action: () => onNavigate?.('personal-accounts'), perm: 'canViewPersonalAccounts', cls: 'text-indigo-900' },
  ];
  const cashMenuItems = cashMenuItemsRaw.filter((it) => canPerm(it.perm));

  const invoiceMenuItemsRaw: NavMenuItem[] = [
    { label: 'طلبات العملاء والمندوبين', icon: Bell, page: 'customer-orders', perm: 'canManageSales', cls: 'text-amber-700' },
    { label: 'فواتير البيع', icon: FileText, page: 'sales-invoices', perm: 'canManageSales', cls: 'text-blue-900', shortcutAction: 'nav:sales' },
    { label: 'فواتير الشراء', icon: FileText, page: 'purchase-invoices', perm: 'canManagePurchases', cls: 'text-indigo-800', shortcutAction: 'nav:purchases' },
    { label: 'فواتير مرتجع البيع', icon: FileText, page: 'sales-returns', perm: 'canManageSales', cls: 'text-amber-700', shortcutAction: 'nav:returns' },
    { label: 'فواتير مرتجع الشراء', icon: FileText, page: 'purchase-returns', perm: 'canManagePurchases', cls: 'text-purple-700' },
    { label: 'تالف', icon: Trash2, page: 'damaged-stock', perm: 'canManageInventory', cls: 'text-red-700' },
    { label: 'تحويل', icon: Boxes, page: 'stock-transfers-orders', perm: ['canCreateStockTransfer', 'canApproveStockTransfer', 'canExecuteStockTransfer', 'canManageInventory'], cls: 'text-blue-700', shortcutAction: 'nav:stock-transfers' },
    { label: 'الفواتير المحذوفة', icon: Trash2, page: 'deleted-invoices', perm: 'canViewDeletedInvoices', cls: 'text-rose-700' },
  ];
  const invoiceMenuItems = invoiceMenuItemsRaw.filter((it) => canPerm(it.perm));

  const controlMenuItemsRaw: NavMenuItem[] = [
    { label: 'المستخدمون', icon: Users, page: 'users', perm: 'canManageUsers' },
    { label: 'الفروع', icon: GitBranch, page: 'branches-settings', perm: 'canManageSettings' },
    { label: 'تغيير اسم التصنيفات', icon: Tag, page: 'product-categories', perm: 'canManageInventory' },
    { label: 'الوحدات', icon: Ruler, page: 'units-settings', perm: ['canManageInventory', 'canManageSettings'] },
    { label: 'إعدادات الباركود', icon: Barcode, page: 'barcode-settings', perm: 'canManageSettings' },
    { label: 'الطابعات المتعددة', icon: Printer, page: 'printers-settings', perm: 'canManageSettings' },
    { label: 'إعدادات الفاتورة', icon: FileText, page: 'invoice-settings', perm: 'canManageSettings' },
    { label: 'إعدادات الموبايل', icon: Smartphone, page: 'mobile-settings', perm: 'canManageSettings' },
    { label: 'مزامنة أونلاين', icon: Wifi, page: 'online-sync-settings', perm: 'canManageSettings' },
    { label: 'الخدمات', icon: Wrench, page: 'services-settings', perm: 'canManageSettings' },
  ];
  const controlMenuItems = controlMenuItemsRaw.filter((it) => canPerm(it.perm));

  // Check pending transfers & new customer/rep orders
  const pendingTransfersCount = repTransfers.filter(t => t.status === 'awaiting_receipt').length;
  const pendingOrdersCount = customerItemOrders.filter(o => o.status === 'pending').length;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <span className="bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5 rounded-full border border-red-200">مالك / مدير عام</span>;
      case 'manager':
        return <span className="bg-blue-100 text-blue-700 text-[11px] font-bold px-2 py-0.5 rounded-full border border-blue-200">مدير فرع</span>;
      case 'accountant':
        return <span className="bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2 py-0.5 rounded-full border border-emerald-200">محاسب مالي</span>;
      case 'customer':
        return <span className="bg-cyan-100 text-cyan-800 text-[11px] font-bold px-2 py-0.5 rounded-full border border-cyan-200">عميل</span>;
      case 'representative':
        return <span className="bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-full border border-amber-200">مندوب مبيعات</span>;
      case 'warehouse':
        return <span className="bg-purple-100 text-purple-700 text-[11px] font-bold px-2 py-0.5 rounded-full border border-purple-200">أمين مستودع</span>;
      default:
        return <span className="bg-slate-100 text-slate-700 text-[11px] font-bold px-2 py-0.5 rounded-full">موظف</span>;
    }
  };

  return (
    <>
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-xs px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
        {/* Left: Hamburger & Brand Title & Top Menus */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={onToggleSidebar}
            className="p-2 rounded-xl text-slate-600 hover:text-blue-900 hover:bg-slate-100 transition-colors focus:outline-hidden cursor-pointer"
            title="تبديل القائمة الجانبية"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 sm:gap-3">
            <img 
              src="/awlad-selim-logo.png" 
              alt="أولاد سليم" 
              className="h-9 sm:h-10 w-auto object-contain"
            />
            <div className="hidden xl:block">
              <h1 className="text-sm font-black text-blue-950 leading-tight">
                أولاد سليم – AWLAD SELIM
              </h1>
              <p className="text-[11px] text-slate-500 font-medium">
                نظام المحاسبة وإدارة الأعمال لتجارة المواد الغذائية
              </p>
            </div>
          </div>

          {/* 3 Top Dropdown Menus */}
          <div ref={menuContainerRef} className="flex items-center gap-1.5 mr-1">
            {/* 1. التعاملات النقدية */}
            {cashMenuItems.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu((prev) => (prev === 'cash' ? null : 'cash'))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                    openMenu === 'cash'
                      ? 'bg-blue-900 text-white border-blue-900 shadow-sm'
                      : 'bg-slate-50 hover:bg-blue-50 text-blue-950 border-slate-200'
                  }`}
                >
                  <Wallet className="w-3.5 h-3.5" />
                  <span>التعاملات النقدية</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openMenu === 'cash' ? 'rotate-180' : ''}`} />
                </button>
                {openMenu === 'cash' && (
                  <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white border border-slate-200 shadow-2xl py-1.5 z-50">
                    {cashMenuItems.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            item.action();
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3.5 py-2 text-right text-xs font-bold text-slate-800 hover:bg-blue-50 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5">
                            <ItemIcon className={`w-4 h-4 shrink-0 ${item.cls || 'text-blue-900'}`} />
                            <span>{item.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 2. الفواتير */}
            {invoiceMenuItems.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu((prev) => (prev === 'invoices' ? null : 'invoices'))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                    openMenu === 'invoices'
                      ? 'bg-blue-900 text-white border-blue-900 shadow-sm'
                      : 'bg-slate-50 hover:bg-blue-50 text-blue-950 border-slate-200'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>الفواتير</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openMenu === 'invoices' ? 'rotate-180' : ''}`} />
                </button>
                {openMenu === 'invoices' && (
                  <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white border border-slate-200 shadow-2xl py-1.5 z-50">
                    {invoiceMenuItems.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            onNavigate?.(item.page);
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3.5 py-2 text-right text-xs font-bold text-slate-800 hover:bg-blue-50 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5">
                            <ItemIcon className={`w-4 h-4 shrink-0 ${item.cls || 'text-blue-900'}`} />
                            <span>{item.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 3. لوحة التحكم */}
            {controlMenuItems.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu((prev) => (prev === 'control' ? null : 'control'))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                    openMenu === 'control'
                      ? 'bg-blue-900 text-white border-blue-900 shadow-sm'
                      : 'bg-slate-50 hover:bg-blue-50 text-blue-950 border-slate-200'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>لوحة التحكم</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openMenu === 'control' ? 'rotate-180' : ''}`} />
                </button>
                {openMenu === 'control' && (
                  <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white border border-slate-200 shadow-2xl py-1.5 z-50 max-h-[75vh] overflow-y-auto">
                    {controlMenuItems.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            onNavigate?.(item.page);
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3.5 py-2 text-right text-xs font-bold text-slate-800 hover:bg-blue-50 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5">
                            <ItemIcon className="w-4 h-4 shrink-0 text-blue-900" />
                            <span>{item.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Status, Alerts, User Profile & Logout */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Offline/Online Status Indicator */}
          <OfflineIndicator />

          {/* New Customer & Rep Orders Alert Button */}
          {pendingOrdersCount > 0 && canPerm('canManageSales') && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('customer-orders')}
              title={`يوجد ${pendingOrdersCount} طلب شراء جديد من تطبيق الموبايل بانتظار المراجعة`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-50 text-blue-950 border border-blue-300 text-xs font-black hover:bg-blue-100 transition-all animate-pulse cursor-pointer"
            >
              <Bell className="w-3.5 h-3.5 text-blue-700" />
              <span className="hidden sm:inline">طلبات العملاء والمندوبين</span>
              <span className="w-5 h-5 rounded-full bg-blue-900 text-white text-[10px] flex items-center justify-center font-mono">
                {pendingOrdersCount}
              </span>
            </button>
          )}

          {/* Pending Transfer Alert Button */}
          {pendingTransfersCount > 0 && onNavigateToTransfers && (
            <button
              onClick={onNavigateToTransfers}
              title={`يوجد ${pendingTransfersCount} طلب تحويل بالنصف معلق يحتاج تأكيد`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 text-xs font-bold hover:bg-amber-100 transition-all animate-pulse"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-amber-600" />
              <span>طلب تحويل بالنصف</span>
              <span className="w-4 h-4 rounded-full bg-amber-600 text-white text-[10px] flex items-center justify-center font-mono">
                {pendingTransfersCount}
              </span>
            </button>
          )}

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="hidden md:flex p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            title="ملء الشاشة"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>

          <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>

          {/* User Info */}
          {currentUser && (
            <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
              <div className="w-8 h-8 rounded-lg bg-blue-900 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                {currentUser.fullName.slice(0, 2)}
              </div>
              <div className="hidden lg:block text-right">
                <span className="block text-xs font-bold text-slate-900 leading-tight">
                  {currentUser.fullName}
                </span>
                <div className="mt-0.5">
                  {getRoleBadge(currentUser.role)}
                </div>
              </div>
            </div>
          )}

          {/* Logout Button (Mandatory Requirement 24) */}
          <button
            onClick={() => setShowLogoutModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 transition-all text-xs font-bold shadow-xs active:scale-95"
            title="تسجيل الخروج من النظام"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">خروج</span>
          </button>
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs no-print">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-right animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4 border border-red-100">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-slate-900 text-center mb-1">
              هل تريد تسجيل الخروج؟
            </h3>
            <p className="text-xs text-slate-500 text-center mb-6 leading-relaxed">
              سيتم إنهاء جلستك الحالية والعودة لشاشة الدخول. لن يتم فقد أي بيانات تجارية أو فواتير محفوظة.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowLogoutModal(false);
                  logout();
                }}
                className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md transition-colors"
              >
                نعم، تسجيل الخروج
              </button>
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
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

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
  Shield,
  Settings,
  ArrowDownCircle,
  ArrowUpCircle,
  TrendingDown,
  TrendingUp,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  ArrowRight,
  Search,
  Plus,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber, formatLocaleTime } from '../../../i18n/translator';
import { registerAndroidBackButton } from '../../../services/native';
import { CashOperationType, MobileNotificationItem, UserPermissions } from '../../../types';
import type { NavItemKey } from '../../layout/Sidebar';
import { MobileNotificationsSheet } from './MobileNotificationsSheet';
import { MobileServerModal } from './MobileServerModal';
import { MobileAddProductModal } from './MobileAddProductModal';
import { MobileSendReceiveScreen } from './MobileSendReceiveScreen';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import {
  SalesInvoiceIcon,
  PurchaseInvoiceIcon,
  SalesReturnIcon,
  PurchaseReturnIcon,
  CustomersGroupIcon,
  SuppliersTruckIcon,
  WarehouseBoxesIcon,
  AccountsLedgerIcon,
  SafeVaultIcon,
  ExpensesCashIcon,
  ChequesIcon,
  InstallmentsIcon,
  RepsFleetIcon,
  EmployeesHrIcon,
  ReportsChartIcon,
  UsersShieldIcon,
  BackupCloudIcon,
  SettingsTwinGearsIcon,
  LogoutDoorIcon,
  OrdersClipboardIcon,
  PriceQuoteIcon,
  SalesInvoicesListIcon,
  PurchaseInvoicesListIcon,
  StockTransfersIcon,
  StockCountIcon,
  CashTransferIcon,
  AuditShieldIcon,
  DeletedInvoicesIcon,
  PersonalAccountsIcon,
  DamagedStockIcon,
  BranchesBuildingIcon,
  ProductAddIcon,
  RefreshCloudIcon,
} from '../../common/AppIcons';

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
  colorClass: string;
  permission?: keyof UserPermissions | Array<keyof UserPermissions>;
  items: LauncherItem[];
}

export const StaffMobileShell: React.FC<StaffMobileShellProps> = ({
  currentPage,
  onNavigate,
  onOpenCashOp,
  children,
}) => {
  const { currentUser, hasPermission, logout, refreshAuthContext, setIsAccountSwitcherOpen, savedAccounts } = useAuth();
  const data = useData();
  const { t, dir, isRtl } = usePreferences();
  const BackArrow = isRtl ? ArrowRight : ArrowLeft;
  const NavChevron = isRtl ? ChevronLeft : ChevronRight;

  const [isMoreViewOpen, setIsMoreViewOpen] = useState(false);
  const [moreSearchQuery, setMoreSearchQuery] = useState('');
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Record<string, boolean>>({});
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [mobileBanner, setMobileBanner] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSectionIds((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const checkPerm = (perm?: keyof UserPermissions | Array<keyof UserPermissions>) => {
    if (!perm) return true;
    if (currentUser?.role === 'admin') return true;
    if (Array.isArray(perm)) return perm.some((p) => hasPermission(p));
    return hasPermission(perm);
  };

  const canMobileAddProduct =
    checkPerm('canManageInventory') && (currentUser?.role === 'admin' || checkPerm('canAdd'));

  // Android hardware back button handling: close sheets/modals first, else go back to dashboard
  useEffect(() => {
    return registerAndroidBackButton(() => {
      if (showLogoutConfirm) {
        setShowLogoutConfirm(false);
        return true;
      }
      if (isAddProductModalOpen) {
        setIsAddProductModalOpen(false);
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
      if (isMoreViewOpen) {
        setIsMoreViewOpen(false);
        return true;
      }
      if (currentPage !== 'dashboard') {
        onNavigate('dashboard');
        return true;
      }
      return false;
    });
  }, [showLogoutConfirm, isAddProductModalOpen, isNotificationsOpen, isServerModalOpen, isMoreViewOpen, currentPage, onNavigate]);

  const sections: LauncherSection[] = useMemo(
    () => [
      {
        id: 'sales',
        title: t('المبيعات والعملاء', 'Sales & Customers'),
        icon: ShoppingCart,
        colorClass: 'bg-[var(--awlad-blue-tint-50)] text-[var(--awlad-navy-900)] border-[var(--awlad-blue-tint-100)]',
        permission: 'canManageSales',
        items: [
          { key: 'customer-orders', label: t('طلبات العملاء والمندوبين', 'Customer & Rep Orders') },
          { key: 'new-sale', label: t('فاتورة مبيعات جديدة (+)', 'New Sales Invoice (+)'), badge: t('سريع', 'Quick') },
          { key: 'sales-invoices', label: t('فواتير المبيعات', 'Sales Invoices') },
          { key: 'quotes', label: t('عروض الأسعار', 'Price Quotes'), badge: t('جديد', 'New') },
          { key: 'customers', label: t('دليل العملاء والأرصدة والتحصيل', 'Customers, Balances & Collections') },
          { key: 'sales-returns', label: t('مرتجع المبيعات', 'Sales Returns') },
          { key: 'deleted-invoices', label: t('الفواتير المحذوفة والملغاة', 'Deleted & Voided Invoices'), permission: 'canViewDeletedInvoices' },
        ],
      },
      {
        id: 'purchases',
        title: t('المشتريات والموردون', 'Purchases & Suppliers'),
        icon: Truck,
        colorClass: 'bg-[var(--awlad-blue-tint-50)] text-[var(--awlad-navy-900)] border-[var(--awlad-blue-tint-100)]',
        permission: ['canManagePurchases', 'canCreatePurchase'],
        items: [
          { key: 'new-purchase', label: t('فاتورة شراء جديدة (+)', 'New Purchase Invoice (+)') },
          { key: 'purchase-invoices', label: t('فواتير المشتريات', 'Purchase Invoices') },
          { key: 'suppliers', label: t('دليل الموردين والأرصدة والتسويات', 'Suppliers, Balances & Settlements') },
          { key: 'purchase-returns', label: t('مرتجع المشتريات', 'Purchase Returns'), permission: 'canManagePurchases' },
        ],
      },
      {
        id: 'inventory',
        title: t('المخازن والمنتجات', 'Inventory & Products'),
        icon: Boxes,
        colorClass: 'bg-[var(--awlad-blue-tint-50)] text-[var(--awlad-navy-900)] border-[var(--awlad-blue-tint-100)]',
        permission: 'canManageInventory',
        items: [
          { key: 'products', label: t('المنتجات والأسعار والباركود', 'Products, Prices & Barcodes') },
          { key: 'product-categories', label: t('تصنيفات السلع', 'Product Categories') },
          { key: 'units-settings', label: t('الوحدات ومعاملات التحويل', 'Units & Conversion Factors'), permission: ['canManageInventory', 'canManageSettings'] },
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
          { key: 'stock-movements', label: t('سجل حركة الأصناف', 'Stock Movements Log') },
          { key: 'abu-selim-import', label: t('استيراد الملفات', 'Import Files') },
        ],
      },
      {
        id: 'finance',
        title: t('الحسابات والخزائن', 'Accounts & Cashboxes'),
        icon: Wallet,
        colorClass: 'bg-[var(--awlad-blue-tint-50)] text-[var(--awlad-navy-900)] border-[var(--awlad-blue-tint-100)]',
        permission: ['canManageCashboxes', 'canManageAccounts'],
        items: [
          {
            key: 'customer-accounts',
            label: t('حسابات العملاء وكشوف الحساب', 'Customer Accounts & Statements'),
            badge: t('العملاء', 'Customers'),
            permission: ['canManageAccounts', 'canManageCashboxes'],
          },
          {
            key: 'supplier-accounts',
            label: t('حسابات الموردين وكشوف الحساب', 'Supplier Accounts & Statements'),
            badge: t('الموردون', 'Suppliers'),
            permission: ['canManageAccounts', 'canManageCashboxes'],
          },
          { key: 'cashboxes', label: t('الخزائن والبنوك والحركة النقدية', 'Cashboxes, Banks & Cash Flow'), permission: 'canManageCashboxes' },
          { key: 'cashbox-transfer', label: t('تحويل بين الخزائن', 'Cashbox Transfer'), permission: 'canManageCashboxes' },
          { key: 'expenses', label: t('المصروفات والإيرادات', 'Expenses & Revenues'), permission: 'canManageCashboxes' },
          { key: 'personal-accounts', label: t('الحسابات الشخصية للملاك', 'Owners Personal Accounts'), permission: 'canViewPersonalAccounts' },
        ],
      },
      {
        id: 'cheques',
        title: t('الشيكات والأقساط', 'Cheques & Installments'),
        icon: CreditCard,
        colorClass: 'bg-[var(--awlad-blue-tint-50)] text-[var(--awlad-navy-900)] border-[var(--awlad-blue-tint-100)]',
        permission: 'canManageAccounts',
        items: [
          { key: 'cheques', label: t('الشيكات (واردة / صادرة)', 'Cheques (Incoming / Outgoing)') },
          { key: 'installments', label: t('إدارة وجدولة الأقساط', 'Installments Management') },
        ],
      },
      {
        id: 'reps',
        title: t('المندوبون والتحويلات', 'Representatives & Transfers'),
        icon: Users2,
        colorClass: 'bg-[var(--awlad-blue-tint-50)] text-[var(--awlad-navy-900)] border-[var(--awlad-blue-tint-100)]',
        permission: ['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove'],
        items: [
          {
            key: 'refresh-sync',
            label: t('إرسال واستلام', 'Send & Receive'),
            permission: ['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove'],
          },
          { key: 'reps', label: t('قائمة المناديب والعهد', 'Representatives & Custody'), permission: 'canManageReps' },
          { key: 'rep-transfers', label: t('طلب تحويل بالنصف (المالي)', 'Cash Custody Transfer'), permission: 'canManageTransfers' },
          { key: 'rep-item-transfers', label: t('تحويل أصناف وعهدة للمناديب', 'Rep Stock Custody Transfer'), permission: 'canManageTransfers' },
        ],
      },
      {
        id: 'hr',
        title: t('الموظفون', 'Employees'),
        icon: Users,
        colorClass: 'bg-[var(--awlad-blue-tint-50)] text-[var(--awlad-navy-900)] border-[var(--awlad-blue-tint-100)]',
        permission: 'canManageEmployees',
        items: [
          { key: 'employees', label: t('شؤون الموظفين', 'HR & Employees') },
        ],
      },
      {
        id: 'reports-users',
        title: t('التقارير والمستخدمون', 'Reports & Users'),
        icon: FileBarChart,
        colorClass: 'bg-slate-100 text-slate-900 border-slate-300',
        items: [
          { key: 'reports', label: t('جميع التقارير والأرباح', 'All Reports & Profits'), permission: 'canViewReports' },
          { key: 'item-movement-report', label: t('تقرير حركة الصنف المفصل', 'Detailed Item Movement Report'), permission: ['canViewReports', 'canManageInventory'] },
          { key: 'users', label: t('إدارة المستخدمين والصلاحيات', 'Users & Permissions'), permission: 'canManageUsers' },
          { key: 'audit-log', label: t('سجل العمليات (Audit)', 'Audit Log'), permission: 'canManageUsers' },
        ],
      },
      {
        id: 'settings',
        title: t('الإعدادات والنسخ الاحتياطي', 'Settings & Backup'),
        icon: Settings,
        colorClass: 'bg-slate-100 text-slate-900 border-slate-300',
        permission: 'canManageSettings',
        items: [
          { key: 'system-settings', label: t('إعدادات النظام والحساب', 'System & Account Settings'), allowAllStaff: true },
          { key: 'branches-settings', label: t('الفروع', 'Branches'), permission: 'canManageSettings' },
          { key: 'barcode-settings', label: t('إعدادات الباركود', 'Barcode Settings'), permission: 'canManageSettings' },
          { key: 'printers-settings', label: t('الطابعات المتعددة', 'Multiple Printers'), permission: 'canManageSettings' },
          { key: 'invoice-settings', label: t('تصميم الفاتورة', 'Invoice Design'), permission: 'canManageSettings' },
          { key: 'storefront-manager', label: t('إدارة واجهة المتجر والعروض', 'Storefront & Offers Manager'), permission: 'canManageSettings' },
          { key: 'mobile-settings', label: t('إعدادات تطبيق العملاء والمناديب', 'Customer & Rep App Settings'), permission: 'canManageSettings' },
          { key: 'online-sync-settings', label: t('المزامنة أونلاين', 'Online Sync'), permission: 'canManageSettings' },
          { key: 'services-settings', label: t('الخدمات والتنبيهات', 'Services & Alerts'), permission: 'canManageSettings' },
          { key: 'server-settings', label: t('إعدادات السيرفر والاتصال', 'Server & Connection Settings'), permission: 'canManageSettings' },
          { key: 'diagnostics-settings', label: t('سجل التشخيص والأخطاء', 'Diagnostics & Error Logs'), permission: 'canManageSettings' },
          { key: 'backup', label: t('النسخ الاحتياطي والاستعادة', 'Backup & Restore'), permission: 'canManageSettings' },
          { key: 'migration', label: t('PostgreSQL وسجل الترحيل', 'PostgreSQL & Migration Log'), permission: 'canManageSettings' },
        ],
      },
    ],
    [t]
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

  const getRoleArabicLabel = (role?: string) => {
    switch (role) {
      case 'admin':
        return t('مدير عام / الإدارة', 'General Manager / Admin');
      case 'manager':
        return t('مدير فرع', 'Branch Manager');
      case 'accountant':
        return t('محاسب مالي', 'Accountant');
      case 'sales':
        return t('موظف مبيعات', 'Sales Staff');
      case 'warehouse':
        return t('أمين مستودع', 'Warehouse Keeper');
      case 'purchases':
        return t('موظف مشتريات', 'Purchases Staff');
      case 'representative':
        return t('مندوب مبيعات', 'Sales Rep');
      case 'customer':
        return t('عميل مسجل', 'Registered Customer');
      default:
        return t('موظف', 'Staff');
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
      'quotes',
      'purchase-invoices',
      'cashboxes',
      'item-movement-report',
      'refresh-sync',
    ];
    if (item.targetTab && allowedTargets.includes(item.targetTab as NavItemKey)) {
      onNavigate(item.targetTab as NavItemKey);
    } else {
      onNavigate('dashboard');
    }
  };

  // Filtered sections for "المزيد" Searchable Categorized Accordion
  const searchableSections = useMemo(() => {
    const q = moreSearchQuery.trim().toLowerCase();
    if (!q) return filteredSections;
    return filteredSections
      .map((sec) => ({
        ...sec,
        items: sec.items.filter(
          (it) =>
            it.label.toLowerCase().includes(q) ||
            sec.title.toLowerCase().includes(q)
        ),
      }))
      .filter((sec) => sec.items.length > 0);
  }, [filteredSections, moreSearchQuery]);

  // Fixed 5-Tab Bottom Navigation Bar (permission-gated)
  const bottomNavTabs = useMemo(() => {
    const tabs: Array<{
      key: string;
      label: string;
      icon: React.ElementType;
      active: boolean;
      onClick: () => void;
    }> = [
      {
        key: 'dashboard',
        label: t('الرئيسية', 'Home'),
        icon: LayoutDashboard,
        active: !isMoreViewOpen && currentPage === 'dashboard',
        onClick: () => {
          setIsMoreViewOpen(false);
          onNavigate('dashboard');
        },
      },
    ];

    if (checkPerm('canManageSales')) {
      tabs.push({
        key: 'sales',
        label: t('المبيعات', 'Sales'),
        icon: ShoppingCart,
        active:
          !isMoreViewOpen &&
          ['sales-invoices', 'new-sale', 'customers', 'sales-returns', 'customer-orders', 'quotes'].includes(currentPage),
        onClick: () => {
          setIsMoreViewOpen(false);
          onNavigate('sales-invoices');
        },
      });
    } else if (checkPerm('canManageAccounts')) {
      tabs.push({
        key: 'accounts',
        label: t('الحسابات', 'Accounts'),
        icon: Wallet,
        active: !isMoreViewOpen && ['customer-accounts', 'supplier-accounts', 'cheques'].includes(currentPage),
        onClick: () => {
          setIsMoreViewOpen(false);
          onNavigate('customer-accounts');
        },
      });
    }

    if (checkPerm(['canManageInventory', 'canManageWarehouses', 'canCreateStockCount', 'canCreateStockTransfer'])) {
      tabs.push({
        key: 'inventory',
        label: t('المخزون', 'Inventory'),
        icon: Boxes,
        active:
          !isMoreViewOpen &&
          [
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
          ].includes(currentPage),
        onClick: () => {
          setIsMoreViewOpen(false);
          onNavigate(checkPerm('canManageInventory') ? 'products' : 'stock-counts');
        },
      });
    }

    if (checkPerm(['canManagePurchases', 'canCreatePurchase'])) {
      tabs.push({
        key: 'purchases',
        label: t('المشتريات', 'Purchases'),
        icon: Truck,
        active: !isMoreViewOpen && ['purchase-invoices', 'new-purchase', 'suppliers', 'purchase-returns'].includes(currentPage),
        onClick: () => {
          setIsMoreViewOpen(false);
          onNavigate('purchase-invoices');
        },
      });
    } else if (checkPerm('canManageCashboxes')) {
      tabs.push({
        key: 'cashboxes',
        label: t('الخزينة', 'Cashbox'),
        icon: Wallet,
        active: !isMoreViewOpen && ['cashboxes', 'cashbox-transfer', 'expenses'].includes(currentPage),
        onClick: () => {
          setIsMoreViewOpen(false);
          onNavigate('cashboxes');
        },
      });
    } else if (checkPerm('canViewReports')) {
      tabs.push({
        key: 'reports',
        label: t('التقارير', 'Reports'),
        icon: FileBarChart,
        active: !isMoreViewOpen && ['reports', 'item-movement-report'].includes(currentPage),
        onClick: () => {
          setIsMoreViewOpen(false);
          onNavigate('reports');
        },
      });
    }

    tabs.push({
      key: 'more',
      label: t('المزيد', 'More'),
      icon: Menu,
      active: isMoreViewOpen,
      onClick: () => setIsMoreViewOpen((prev) => !prev),
    });

    return tabs;
  }, [currentPage, currentUser, isMoreViewOpen, onNavigate, t]);

  const mobileGridTiles = useMemo(() => {
    const tiles: Array<{
      id: string;
      label: string;
      icon: React.ReactNode;
      onClick: () => void;
    }> = [];

    if (checkPerm('canManageSales')) {
      tiles.push({
        id: 'new-sale',
        label: t('فاتورة بيع', 'Sales Invoice'),
        icon: <SalesInvoiceIcon className="w-11 h-11" />,
        onClick: () => onNavigate('new-sale'),
      });
      tiles.push({
        id: 'sales-invoices',
        label: t('عرض فواتير البيع', 'Sales Invoices'),
        icon: <SalesInvoicesListIcon className="w-11 h-11" />,
        onClick: () => onNavigate('sales-invoices'),
      });
      tiles.push({
        id: 'sales-returns',
        label: t('مرتجع بيع', 'Sales Return'),
        icon: <SalesReturnIcon className="w-11 h-11" />,
        onClick: () => onNavigate('sales-returns'),
      });
      tiles.push({
        id: 'customer-orders',
        label: t('طلبات العملاء', 'Customer Orders'),
        icon: <OrdersClipboardIcon className="w-11 h-11" />,
        onClick: () => onNavigate('customer-orders'),
      });
      tiles.push({
        id: 'quotes',
        label: t('عروض الأسعار', 'Price Quotes'),
        icon: <PriceQuoteIcon className="w-11 h-11" />,
        onClick: () => onNavigate('quotes'),
      });
      tiles.push({
        id: 'customers',
        label: t('العملاء', 'Customers'),
        icon: <CustomersGroupIcon className="w-11 h-11" />,
        onClick: () => onNavigate('customers'),
      });
    }
    if (checkPerm('canViewDeletedInvoices')) {
      tiles.push({
        id: 'deleted-invoices',
        label: t('الفواتير المحذوفة', 'Deleted Invoices'),
        icon: <DeletedInvoicesIcon className="w-11 h-11" />,
        onClick: () => onNavigate('deleted-invoices'),
      });
    }

    if (checkPerm(['canManagePurchases', 'canCreatePurchase'])) {
      tiles.push({
        id: 'new-purchase',
        label: t('فاتورة شراء', 'Purchase Invoice'),
        icon: <PurchaseInvoiceIcon className="w-11 h-11" />,
        onClick: () => onNavigate('new-purchase'),
      });
      tiles.push({
        id: 'purchase-invoices',
        label: t('عرض فواتير الشراء', 'Purchase Invoices'),
        icon: <PurchaseInvoicesListIcon className="w-11 h-11" />,
        onClick: () => onNavigate('purchase-invoices'),
      });
      tiles.push({
        id: 'suppliers',
        label: t('الموردون', 'Suppliers'),
        icon: <SuppliersTruckIcon className="w-11 h-11" />,
        onClick: () => onNavigate('suppliers'),
      });
    }
    if (checkPerm('canManagePurchases')) {
      tiles.push({
        id: 'purchase-returns',
        label: t('مرتجع شراء', 'Purchase Return'),
        icon: <PurchaseReturnIcon className="w-11 h-11" />,
        onClick: () => onNavigate('purchase-returns'),
      });
    }

    if (canMobileAddProduct) {
      tiles.push({
        id: 'mobile-add-product',
        label: t('إضافة صنف جديد', 'Add Product'),
        icon: <ProductAddIcon className="w-10 h-10" />,
        onClick: () => setIsAddProductModalOpen(true),
      });
    }
    if (checkPerm(['canManageInventory', 'canManageWarehouses'])) {
      tiles.push({
        id: 'inventory',
        label: t('المخزن والأصناف', 'Inventory & Items'),
        icon: <WarehouseBoxesIcon className="w-10 h-10" />,
        onClick: () =>
          onNavigate(
            checkPerm('canManageInventory') ? 'products' : 'warehouses'
          ),
      });
    }
    if (checkPerm('canManageInventory')) {
      tiles.push({
        id: 'damaged-stock',
        label: t('بضاعة تالفة', 'Damaged Stock'),
        icon: <DamagedStockIcon className="w-10 h-10" />,
        onClick: () => onNavigate('damaged-stock'),
      });
    }

    if (checkPerm(['canCreateStockTransfer', 'canApproveStockTransfer', 'canExecuteStockTransfer', 'canManageInventory'])) {
      tiles.push({
        id: 'stock-transfers-orders',
        label: t('تحويل الأصناف', 'Stock Transfers'),
        icon: <StockTransfersIcon className="w-11 h-11" />,
        onClick: () => onNavigate('stock-transfers-orders'),
      });
    }

    if (checkPerm(['canCreateStockCount', 'canApproveStockCount', 'canManageInventory'])) {
      tiles.push({
        id: 'stock-counts',
        label: t('جرد المخزون', 'Stock Count'),
        icon: <StockCountIcon className="w-11 h-11" />,
        onClick: () => onNavigate('stock-counts'),
      });
    }

    if (checkPerm(['canManageAccounts', 'canManageCashboxes'])) {
      tiles.push({
        id: 'customer-accounts',
        label: t('الحسابات الشاملة', 'All Accounts'),
        icon: <AccountsLedgerIcon className="w-11 h-11" />,
        onClick: () => onNavigate('customer-accounts'),
      });
    }

    if (checkPerm('canManageCashboxes')) {
      tiles.push({
        id: 'cashboxes',
        label: t('الخزينة', 'Cashbox'),
        icon: <SafeVaultIcon className="w-11 h-11" />,
        onClick: () => onNavigate('cashboxes'),
      });
      tiles.push({
        id: 'cashbox-transfer',
        label: t('تحويل الخزائن', 'Cashbox Transfer'),
        icon: <CashTransferIcon className="w-11 h-11" />,
        onClick: () => onNavigate('cashbox-transfer'),
      });
      tiles.push({
        id: 'expenses',
        label: t('المصروفات', 'Expenses'),
        icon: <ExpensesCashIcon className="w-11 h-11" />,
        onClick: () => onNavigate('expenses'),
      });
    }
    if (checkPerm('canViewPersonalAccounts')) {
      tiles.push({
        id: 'personal-accounts',
        label: t('الحسابات الشخصية', 'Personal Accounts'),
        icon: <PersonalAccountsIcon className="w-11 h-11" />,
        onClick: () => onNavigate('personal-accounts'),
      });
    }

    if (checkPerm('canManageAccounts')) {
      tiles.push({
        id: 'cheques',
        label: t('الشيكات', 'Cheques'),
        icon: <ChequesIcon className="w-11 h-11" />,
        onClick: () => onNavigate('cheques'),
      });
      tiles.push({
        id: 'installments',
        label: t('الأقساط', 'Installments'),
        icon: <InstallmentsIcon className="w-11 h-11" />,
        onClick: () => onNavigate('installments'),
      });
    }

    if (checkPerm(['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove'])) {
      tiles.push({
        id: 'refresh-sync',
        label: t('إرسال واستلام', 'Send & Receive'),
        icon: <RefreshCloudIcon className="w-11 h-11" />,
        onClick: () => onNavigate('refresh-sync'),
      });
    }

    if (checkPerm('canManageReps')) {
      tiles.push({
        id: 'reps',
        label: t('المندوبون', 'Representatives'),
        icon: <RepsFleetIcon className="w-11 h-11" />,
        onClick: () => onNavigate('reps'),
      });
    }

    if (checkPerm('canManageEmployees')) {
      tiles.push({
        id: 'employees',
        label: t('شؤون الموظفين', 'HR & Employees'),
        icon: <EmployeesHrIcon className="w-11 h-11" />,
        onClick: () => onNavigate('employees'),
      });
    }

    if (checkPerm('canViewReports')) {
      tiles.push({
        id: 'reports',
        label: t('التقارير والأرباح', 'Reports & Profits'),
        icon: <ReportsChartIcon className="w-11 h-11" />,
        onClick: () => onNavigate('reports'),
      });
    }

    if (checkPerm('canManageUsers')) {
      tiles.push({
        id: 'users',
        label: t('المستخدمون', 'Users'),
        icon: <UsersShieldIcon className="w-11 h-11" />,
        onClick: () => onNavigate('users'),
      });
      tiles.push({
        id: 'audit-log',
        label: t('سجل المراجعة', 'Audit Log'),
        icon: <AuditShieldIcon className="w-11 h-11" />,
        onClick: () => onNavigate('audit-log'),
      });
    }

    if (checkPerm('canManageSettings')) {
      tiles.push({
        id: 'branches-settings',
        label: t('الفروع', 'Branches'),
        icon: <BranchesBuildingIcon className="w-11 h-11" />,
        onClick: () => onNavigate('branches-settings'),
      });
      tiles.push({
        id: 'backup',
        label: t('النسخ الاحتياطي', 'Backup'),
        icon: <BackupCloudIcon className="w-11 h-11" />,
        onClick: () => onNavigate('backup'),
      });
    }

    tiles.push({
      id: 'system-settings',
      label: t('الإعدادات', 'Settings'),
      icon: <SettingsTwinGearsIcon className="w-11 h-11" />,
      onClick: () => onNavigate('system-settings'),
    });

    tiles.push({
      id: 'logout',
      label: t('تسجيل الخروج', 'Logout'),
      icon: <LogoutDoorIcon className="w-11 h-11" />,
      onClick: () => setShowLogoutConfirm(true),
    });

    return tiles;
  }, [currentUser, onNavigate, t]);

  return (
    <div dir={dir} className="h-[100dvh] overflow-hidden print:h-auto print:overflow-visible bg-[var(--awlad-surface-page)] dark:bg-[#081326] text-slate-800 dark:text-[#DCE6F5] font-['Cairo'] antialiased flex flex-col">
      {/* Slim Logo-Navy/Royal Top App Header Bar */}
      <header className="shrink-0 z-30 awlad-brand-gradient text-white border-b border-[var(--awlad-royal-500)]/40 pt-safe no-print">
        <div className="w-full max-w-full mx-auto px-2 h-11 flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0 shrink">
            <img
              src="/awlad-selim-logo.png"
              alt="AWLAD SELIM"
              className="no-dark-surface h-7 w-7 object-contain bg-white dark:bg-white rounded-md p-0.5 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-xs font-black truncate leading-tight">AWLAD SELIM</h1>
              <p className="text-[10px] text-blue-100 truncate">
                {getRoleArabicLabel(currentUser?.role)} · {currentUser?.fullName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsNotificationsOpen(true);
                data.markNotificationsRead();
              }}
              className="relative min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md hover:bg-white/15 text-white cursor-pointer"
              title={t('الإشعارات', 'Notifications')}
              aria-label={t('الإشعارات', 'Notifications')}
            >
              <Bell className="w-4 h-4" />
              {data.unreadNotificationCount > 0 && (
                <span className="absolute top-0.5 end-0.5 min-w-[14px] h-[14px] px-1 rounded bg-red-600 text-white text-[9px] font-black flex items-center justify-center tabular-nums">
                  {formatLocaleNumber(data.unreadNotificationCount)}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsServerModalOpen(true)}
              className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md hover:bg-white/15 text-white cursor-pointer"
              title={t('عنوان السيرفر المركزي', 'Central Server Address')}
              aria-label={t('إعدادات السيرفر', 'Server Settings')}
            >
              <Server className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => data.triggerManualSync()}
              className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md hover:bg-white/15 text-white cursor-pointer"
              title={t('تحديث ومزامنة', 'Refresh & Sync')}
              aria-label={t('تحديث ومزامنة', 'Refresh & Sync')}
            >
              <RefreshCw className={`w-4 h-4 ${data.networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => setIsAccountSwitcherOpen(true)}
              className="relative min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md hover:bg-white/15 text-white cursor-pointer"
              title={t('الحسابات المحفوظة', 'Saved Accounts')}
              aria-label={t('تبديل الحساب', 'Switch Account')}
            >
              <Users className="w-4 h-4" />
              {savedAccounts.length > 1 && (
                <span className="absolute top-0.5 end-0.5 min-w-[14px] h-[14px] px-1 rounded bg-[var(--awlad-royal-500)] text-white text-[9px] font-black flex items-center justify-center tabular-nums">
                  {formatLocaleNumber(savedAccounts.length)}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsMoreViewOpen(false);
                onNavigate('system-settings');
              }}
              className={`min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md cursor-pointer ${
                !isMoreViewOpen && currentPage === 'system-settings' ? 'bg-white dark:bg-[#1659C8] text-[var(--awlad-navy-900)] dark:text-white' : 'text-white hover:bg-white/15'
              }`}
              title={t('الإعدادات', 'Settings')}
              aria-label={t('الإعدادات', 'Settings')}
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md bg-red-600/90 hover:bg-red-700 text-white cursor-pointer"
              title={t('تسجيل الخروج', 'Logout')}
              aria-label={t('تسجيل الخروج', 'Logout')}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto p-1.5 sm:p-2 space-y-2 print:overflow-visible">
        {(data.isUsingOfflineCache || data.networkStatus === 'disconnected') && (
          <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-center justify-between gap-2 no-print">
            <div className="flex items-center gap-2 min-w-0">
              <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span className="truncate">
                {t('بيانات مخزنة مؤقتاً', 'Cached offline data')}
                {data.lastCacheTimestamp
                  ? ` · ${formatLocaleTime(data.lastCacheTimestamp)}`
                  : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={() => data.triggerManualSync()}
              className="min-h-[30px] px-2.5 rounded-md bg-amber-600 text-white text-[11px] font-bold shrink-0 cursor-pointer"
            >
              {t('إعادة المحاولة', 'Retry')}
            </button>
          </div>
        )}

        {mobileBanner && (
          <div className="px-2.5 py-1.5 rounded-lg bg-[var(--awlad-blue-tint-50)] border border-[var(--awlad-blue-tint-100)] text-[var(--awlad-navy-900)] text-xs font-bold flex items-center justify-between gap-2 no-print">
            <span>{mobileBanner}</span>
            <button
              type="button"
              onClick={() => setMobileBanner(null)}
              className="text-[11px] underline shrink-0 cursor-pointer"
            >
              {t('إغلاق', 'Close')}
            </button>
          </div>
        )}

        {!isMoreViewOpen && currentPage === 'refresh-sync' ? (
          <MobileSendReceiveScreen onBack={() => onNavigate('dashboard')} />
        ) : isMoreViewOpen ? (
          <section aria-label={t('جميع الأقسام والعمليات', 'All Sections & Operations')} className="space-y-2 no-print">
            <div className="bg-white rounded-lg border border-slate-200 p-1.5">
              <div className="relative">
                <input
                  type="text"
                  value={moreSearchQuery}
                  onChange={(e) => setMoreSearchQuery(e.target.value)}
                  placeholder={t('ابحث عن قسم أو شاشة...', 'Search for a section or screen...')}
                  className="w-full h-9 rounded-md border border-slate-300 ps-8 pe-7 text-xs font-bold bg-slate-50 focus:bg-white focus:outline-hidden focus:border-[var(--awlad-royal-700)]"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2.5 top-2.5" />
                {moreSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setMoreSearchQuery('')}
                    className="absolute end-1.5 top-1.5 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    aria-label={t('مسح البحث', 'Clear search')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {checkPerm('canManageCashboxes') && !moreSearchQuery.trim() && (
              <div className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5">
                <p className="text-[11px] font-black text-[var(--awlad-navy-900)]">{t('عمليات الخزينة السريعة', 'Quick Cashbox Operations')}</p>
                <div className="grid grid-cols-2 gap-1.5 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreViewOpen(false);
                      onOpenCashOp('cash_deposit');
                    }}
                    className="h-9 flex items-center justify-center gap-1.5 rounded-md bg-[var(--awlad-blue-tint-50)] border border-[var(--awlad-blue-tint-100)] text-[var(--awlad-navy-900)] cursor-pointer"
                  >
                    <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>{t('إيداع نقدي', 'Cash Deposit')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreViewOpen(false);
                      onOpenCashOp('cash_withdrawal');
                    }}
                    className="h-9 flex items-center justify-center gap-1.5 rounded-md bg-[var(--awlad-blue-tint-50)] border border-[var(--awlad-blue-tint-100)] text-[var(--awlad-navy-900)] cursor-pointer"
                  >
                    <ArrowUpCircle className="w-3.5 h-3.5 text-red-700 shrink-0" />
                    <span>{t('سحب نقدي', 'Cash Withdrawal')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreViewOpen(false);
                      onOpenCashOp('expense');
                    }}
                    className="h-9 flex items-center justify-center gap-1.5 rounded-md bg-[var(--awlad-blue-tint-50)] border border-[var(--awlad-blue-tint-100)] text-[var(--awlad-navy-900)] cursor-pointer"
                  >
                    <TrendingDown className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    <span>{t('مصروف', 'Expense')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreViewOpen(false);
                      onOpenCashOp('profit_deposit');
                    }}
                    className="h-9 flex items-center justify-center gap-1.5 rounded-md bg-[var(--awlad-blue-tint-50)] border border-[var(--awlad-blue-tint-100)] text-[var(--awlad-navy-900)] cursor-pointer"
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] shrink-0" />
                    <span>{t('إيداع ربحي', 'Profit Deposit')}</span>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {searchableSections.map((sec) => {
                const SecIcon = sec.icon;
                const isCollapsed = !moreSearchQuery.trim() && Boolean(collapsedSectionIds[sec.id]);
                return (
                  <div key={sec.id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleSectionCollapse(sec.id)}
                      aria-expanded={!isCollapsed}
                      className="w-full min-h-[34px] px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs font-black bg-slate-50 border-b border-slate-200 text-slate-900 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <SecIcon className="w-4 h-4 text-[var(--awlad-royal-700)] shrink-0" />
                        <span className="truncate">{sec.title}</span>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-150 ${
                          isCollapsed ? (isRtl ? 'rotate-90' : '-rotate-90') : ''
                        }`}
                      />
                    </button>

                    {!isCollapsed && (
                      <div className="divide-y divide-slate-100">
                        {sec.items.map((item) => {
                          const active = currentPage === item.key;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => {
                                setIsMoreViewOpen(false);
                                onNavigate(item.key);
                              }}
                              className={`w-full min-h-[36px] px-2.5 py-1.5 flex items-center justify-between gap-2 text-start text-xs transition-colors cursor-pointer ${
                                active ? 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#1659C8] text-[var(--awlad-navy-900)] dark:text-white font-black' : 'text-slate-800 hover:bg-slate-50 font-bold'
                              }`}
                            >
                              <span className="truncate">{item.label}</span>
                              <NavChevron className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-[var(--awlad-royal-700)] dark:text-white' : 'text-slate-400'}`} />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <>
            {currentPage !== 'dashboard' && (
              <div className="flex items-center justify-between bg-white rounded-lg border border-slate-200 px-2 py-1 no-print">
                <button
                  type="button"
                  onClick={() => onNavigate('dashboard')}
                  className="h-8 px-2 rounded-md text-[var(--awlad-navy-900)] hover:bg-[var(--awlad-blue-tint-50)] text-xs font-black flex items-center gap-1.5 cursor-pointer"
                >
                  <BackArrow className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('العودة للرئيسية', 'Back to Home')}</span>
                </button>
                <span className="text-[11px] font-bold text-slate-500 truncate">{data.settings.companyName || t('أولاد سليم', 'AWLAD SELIM')}</span>
              </div>
            )}

            {currentPage === 'dashboard' && (
              <section aria-label={t('الاختصارات السريعة', 'Quick Shortcuts')} className="space-y-2 no-print">
                {/* Compact Logo-Navy Banner */}
                <div className="rounded-lg awlad-brand-gradient text-white px-2.5 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-black truncate">{data.settings.companyName || 'AWLAD SELIM'}</div>
                    <div className="text-[11px] text-blue-100 truncate">
                      {getRoleArabicLabel(currentUser?.role)} · {currentUser?.fullName}
                    </div>
                  </div>
                  {canMobileAddProduct && (
                    <button
                      type="button"
                      onClick={() => setIsAddProductModalOpen(true)}
                      className="h-8 px-2.5 rounded-md bg-white dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-[var(--awlad-navy-900)] dark:text-white text-xs font-black flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{t('أضف صنف', 'Add Product')}</span>
                    </button>
                  )}
                </div>

                {/* 3-Col Compact Quick Shortcuts Grid */}
                <div>
                  <h2 className="text-xs font-black text-[var(--awlad-navy-900)] mb-1">{t('الاختصارات السريعة', 'Quick Shortcuts')}</h2>
                  <div className="grid grid-cols-3 gap-1.5">
                    {mobileGridTiles.map((tile) => (
                      <button
                        key={tile.id}
                        type="button"
                        onClick={tile.onClick}
                        className="bg-white rounded-lg border border-slate-200 hover:border-[var(--awlad-royal-700)]/50 active:scale-[0.98] p-1.5 min-h-[64px] flex flex-col items-center justify-center gap-0.5 text-center transition-all cursor-pointer"
                      >
                        <div className="flex items-center justify-center scale-90">{tile.icon}</div>
                        <span className="text-[11px] font-black text-slate-800 leading-tight">{tile.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {children}
          </>
        )}
      </main>

      {/* Compact 5-Tab Bottom Navigation Bar */}
      <nav
        aria-label={t('التنقل السفلي', 'Bottom Navigation')}
        className="shrink-0 z-30 bg-white dark:bg-[#0E1C36] border-t border-slate-200 dark:border-[#21375C] pb-safe shadow-[0_-2px_10px_rgba(1,30,88,0.08)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.35)] no-print"
      >
        <div className="w-full max-w-3xl mx-auto flex items-stretch justify-around">
          {bottomNavTabs.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={tab.onClick}
                aria-current={tab.active ? 'page' : undefined}
                className={`flex-1 min-h-[46px] py-1 px-1 flex flex-col items-center justify-center gap-0.5 relative cursor-pointer transition-colors ${
                  tab.active ? 'text-[var(--awlad-royal-700)] dark:text-[#60A5FA] font-black' : 'text-slate-500 dark:text-[#95ACCE] hover:text-[var(--awlad-navy-900)] dark:hover:text-[#DCE6F5] font-bold'
                }`}
              >
                {tab.active && (
                  <span className="absolute top-0 inset-x-3 h-[2.5px] rounded-b bg-[var(--awlad-royal-700)] dark:bg-[#60A5FA]" aria-hidden="true" />
                )}
                <TabIcon className="w-4 h-4 shrink-0" />
                <span className="text-[10.5px] leading-tight whitespace-nowrap">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <MobileAddProductModal
        isOpen={isAddProductModalOpen}
        onClose={() => setIsAddProductModalOpen(false)}
        onSaved={(pname) => setMobileBanner(t(`تمت إضافة الصنف "${pname}" بنجاح.`, `Product "${pname}" added successfully.`))}
      />

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

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          logout();
        }}
        variant="danger"
        title={t('هل تريد تسجيل الخروج؟', 'Log out?')}
        message={t('سيتم إنهاء جلستك الحالية والعودة إلى شاشة الدخول الموحدة.', 'Your current session will end and you will return to the login screen.')}
        confirmLabel={t('نعم، تسجيل الخروج', 'Yes, Logout')}
      />
    </div>
  );
};

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
  ChevronDown,
  ArrowRight,
  Search,
  Plus,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { registerAndroidBackButton } from '../../../services/native';
import { CashOperationType, MobileNotificationItem, UserPermissions } from '../../../types';
import { NavItemKey } from '../../layout/Sidebar';
import { MobileNotificationsSheet } from './MobileNotificationsSheet';
import { MobileServerModal } from './MobileServerModal';
import { MobileAddProductModal } from './MobileAddProductModal';
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
        title: 'المبيعات والعملاء',
        icon: ShoppingCart,
        colorClass: 'bg-blue-50 text-blue-900 border-blue-200',
        permission: 'canManageSales',
        items: [
          { key: 'customer-orders', label: 'طلبات العملاء والمندوبين' },
          { key: 'new-sale', label: 'فاتورة مبيعات جديدة (+)', badge: 'سريع' },
          { key: 'sales-invoices', label: 'فواتير المبيعات' },
          { key: 'quotes', label: 'عروض الأسعار', badge: 'جديد' },
          { key: 'customers', label: 'دليل العملاء والأرصدة والتحصيل' },
          { key: 'sales-returns', label: 'مرتجع المبيعات' },
          { key: 'deleted-invoices', label: 'الفواتير المحذوفة والملغاة', permission: 'canViewDeletedInvoices' },
        ],
      },
      {
        id: 'purchases',
        title: 'المشتريات والموردون',
        icon: Truck,
        colorClass: 'bg-emerald-50 text-[#0F5A33] border-emerald-200',
        permission: ['canManagePurchases', 'canCreatePurchase'],
        items: [
          { key: 'new-purchase', label: 'فاتورة شراء جديدة (+)' },
          { key: 'purchase-invoices', label: 'فواتير المشتريات' },
          { key: 'suppliers', label: 'دليل الموردين والأرصدة والتسويات' },
          { key: 'purchase-returns', label: 'مرتجع المشتريات', permission: 'canManagePurchases' },
        ],
      },
      {
        id: 'inventory',
        title: 'المخازن والمنتجات',
        icon: Boxes,
        colorClass: 'bg-amber-50 text-amber-900 border-amber-200',
        permission: 'canManageInventory',
        items: [
          { key: 'products', label: 'المنتجات والأسعار والباركود' },
          { key: 'product-categories', label: 'تصنيفات السلع' },
          { key: 'units-settings', label: 'الوحدات ومعاملات التحويل', permission: ['canManageInventory', 'canManageSettings'] },
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
          { key: 'abu-selim-import', label: 'استيراد الملفات' },
        ],
      },
      {
        id: 'finance',
        title: 'الحسابات والخزائن',
        icon: Wallet,
        colorClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
        permission: ['canManageCashboxes', 'canManageAccounts'],
        items: [
          {
            key: 'customer-accounts',
            label: 'حسابات العملاء وكشوف الحساب',
            badge: 'العملاء',
            permission: ['canManageAccounts', 'canManageCashboxes'],
          },
          {
            key: 'supplier-accounts',
            label: 'حسابات الموردين وكشوف الحساب',
            badge: 'الموردون',
            permission: ['canManageAccounts', 'canManageCashboxes'],
          },
          { key: 'cashboxes', label: 'الخزائن والبنوك والحركة النقدية', permission: 'canManageCashboxes' },
          { key: 'cashbox-transfer', label: 'تحويل بين الخزائن', permission: 'canManageCashboxes' },
          { key: 'expenses', label: 'المصروفات والإيرادات', permission: 'canManageCashboxes' },
          { key: 'personal-accounts', label: 'الحسابات الشخصية للملاك', permission: 'canViewPersonalAccounts' },
        ],
      },
      {
        id: 'cheques',
        title: 'الشيكات والأقساط',
        icon: CreditCard,
        colorClass: 'bg-indigo-50 text-indigo-900 border-indigo-200',
        permission: 'canManageAccounts',
        items: [
          { key: 'cheques', label: 'الشيكات (واردة / صادرة)' },
          { key: 'installments', label: 'إدارة وجدولة الأقساط' },
        ],
      },
      {
        id: 'reps',
        title: 'المندوبون والتحويلات',
        icon: Users2,
        colorClass: 'bg-cyan-50 text-cyan-900 border-cyan-200',
        permission: ['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove'],
        items: [
          {
            key: 'refresh-sync',
            label: 'REFRESH · إرسال واستلام المندوبين',
            permission: ['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove'],
          },
          { key: 'reps', label: 'قائمة المناديب والعهد', permission: 'canManageReps' },
          { key: 'rep-transfers', label: 'طلب تحويل بالنصف (المالي)', permission: 'canManageTransfers' },
          { key: 'rep-item-transfers', label: 'تحويل أصناف وعهدة للمناديب', permission: 'canManageTransfers' },
        ],
      },
      {
        id: 'hr',
        title: 'الموظفون والرواتب',
        icon: Users,
        colorClass: 'bg-rose-50 text-rose-900 border-rose-200',
        permission: 'canManageEmployees',
        items: [
          { key: 'employees', label: 'شؤون الموظفين' },
          { key: 'attendance', label: 'الحضور والغياب' },
          { key: 'advances', label: 'السلف والخصومات والمكافآت', permission: 'canManageSalaries' },
          { key: 'payroll', label: 'مسير صرف الرواتب', permission: 'canManageSalaries' },
        ],
      },
      {
        id: 'reports-users',
        title: 'التقارير والمستخدمون',
        icon: FileBarChart,
        colorClass: 'bg-slate-100 text-slate-900 border-slate-300',
        items: [
          { key: 'reports', label: 'جميع التقارير والأرباح', permission: 'canViewReports' },
          { key: 'item-movement-report', label: 'تقرير حركة الصنف المفصل', permission: ['canViewReports', 'canManageInventory'] },
          { key: 'users', label: 'إدارة المستخدمين والصلاحيات', permission: 'canManageUsers' },
          { key: 'audit-log', label: 'سجل العمليات (Audit)', permission: 'canManageUsers' },
        ],
      },
      {
        id: 'settings',
        title: 'الإعدادات والنسخ الاحتياطي',
        icon: Settings,
        colorClass: 'bg-slate-100 text-slate-900 border-slate-300',
        permission: 'canManageSettings',
        items: [
          { key: 'system-settings', label: 'إعدادات النظام والحساب', allowAllStaff: true },
          { key: 'branches-settings', label: 'الفروع', permission: 'canManageSettings' },
          { key: 'barcode-settings', label: 'إعدادات الباركود', permission: 'canManageSettings' },
          { key: 'printers-settings', label: 'الطابعات المتعددة', permission: 'canManageSettings' },
          { key: 'invoice-settings', label: 'تصميم الفاتورة', permission: 'canManageSettings' },
          { key: 'storefront-manager', label: 'إدارة واجهة المتجر والعروض', permission: 'canManageSettings' },
          { key: 'mobile-settings', label: 'إعدادات تطبيق العملاء والمناديب', permission: 'canManageSettings' },
          { key: 'online-sync-settings', label: 'المزامنة أونلاين', permission: 'canManageSettings' },
          { key: 'services-settings', label: 'الخدمات والتنبيهات', permission: 'canManageSettings' },
          { key: 'server-settings', label: 'إعدادات السيرفر والاتصال', permission: 'canManageSettings' },
          { key: 'diagnostics-settings', label: 'سجل التشخيص والأخطاء', permission: 'canManageSettings' },
          { key: 'backup', label: 'النسخ الاحتياطي والاستعادة', permission: 'canManageSettings' },
          { key: 'migration', label: 'PostgreSQL وسجل الترحيل', permission: 'canManageSettings' },
        ],
      },
    ],
    []
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
        return 'مدير عام / الإدارة';
      case 'manager':
        return 'مدير فرع';
      case 'accountant':
        return 'محاسب مالي';
      case 'sales':
        return 'موظف مبيعات';
      case 'warehouse':
        return 'أمين مستودع';
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
        label: 'الرئيسية',
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
        label: 'المبيعات',
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
        label: 'الحسابات',
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
        label: 'المخزون',
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
        label: 'المشتريات',
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
        label: 'الخزينة',
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
        label: 'التقارير',
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
      label: 'المزيد',
      icon: Menu,
      active: isMoreViewOpen,
      onClick: () => setIsMoreViewOpen((prev) => !prev),
    });

    return tabs;
  }, [currentPage, currentUser, isMoreViewOpen, onNavigate]);

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
        label: 'فاتورة بيع',
        icon: <SalesInvoiceIcon className="w-11 h-11" />,
        onClick: () => onNavigate('new-sale'),
      });
      tiles.push({
        id: 'sales-invoices',
        label: 'عرض فواتير البيع',
        icon: <SalesInvoicesListIcon className="w-11 h-11" />,
        onClick: () => onNavigate('sales-invoices'),
      });
      tiles.push({
        id: 'sales-returns',
        label: 'مرتجع بيع',
        icon: <SalesReturnIcon className="w-11 h-11" />,
        onClick: () => onNavigate('sales-returns'),
      });
      tiles.push({
        id: 'customer-orders',
        label: 'طلبات العملاء',
        icon: <OrdersClipboardIcon className="w-11 h-11" />,
        onClick: () => onNavigate('customer-orders'),
      });
      tiles.push({
        id: 'quotes',
        label: 'عروض الأسعار',
        icon: <PriceQuoteIcon className="w-11 h-11" />,
        onClick: () => onNavigate('quotes'),
      });
      tiles.push({
        id: 'customers',
        label: 'العملاء',
        icon: <CustomersGroupIcon className="w-11 h-11" />,
        onClick: () => onNavigate('customers'),
      });
    }
    if (checkPerm('canViewDeletedInvoices')) {
      tiles.push({
        id: 'deleted-invoices',
        label: 'الفواتير المحذوفة',
        icon: <DeletedInvoicesIcon className="w-11 h-11" />,
        onClick: () => onNavigate('deleted-invoices'),
      });
    }

    if (checkPerm(['canManagePurchases', 'canCreatePurchase'])) {
      tiles.push({
        id: 'new-purchase',
        label: 'فاتورة شراء',
        icon: <PurchaseInvoiceIcon className="w-11 h-11" />,
        onClick: () => onNavigate('new-purchase'),
      });
      tiles.push({
        id: 'purchase-invoices',
        label: 'عرض فواتير الشراء',
        icon: <PurchaseInvoicesListIcon className="w-11 h-11" />,
        onClick: () => onNavigate('purchase-invoices'),
      });
      tiles.push({
        id: 'suppliers',
        label: 'الموردون',
        icon: <SuppliersTruckIcon className="w-11 h-11" />,
        onClick: () => onNavigate('suppliers'),
      });
    }
    if (checkPerm('canManagePurchases')) {
      tiles.push({
        id: 'purchase-returns',
        label: 'مرتجع شراء',
        icon: <PurchaseReturnIcon className="w-11 h-11" />,
        onClick: () => onNavigate('purchase-returns'),
      });
    }

    if (canMobileAddProduct) {
      tiles.push({
        id: 'mobile-add-product',
        label: 'إضافة صنف جديد',
        icon: <ProductAddIcon className="w-10 h-10" />,
        onClick: () => setIsAddProductModalOpen(true),
      });
    }
    if (checkPerm(['canManageInventory', 'canManageWarehouses'])) {
      tiles.push({
        id: 'inventory',
        label: 'المخزن والأصناف',
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
        label: 'بضاعة تالفة',
        icon: <DamagedStockIcon className="w-10 h-10" />,
        onClick: () => onNavigate('damaged-stock'),
      });
    }

    if (checkPerm(['canCreateStockTransfer', 'canApproveStockTransfer', 'canExecuteStockTransfer', 'canManageInventory'])) {
      tiles.push({
        id: 'stock-transfers-orders',
        label: 'تحويل الأصناف',
        icon: <StockTransfersIcon className="w-11 h-11" />,
        onClick: () => onNavigate('stock-transfers-orders'),
      });
    }

    if (checkPerm(['canCreateStockCount', 'canApproveStockCount', 'canManageInventory'])) {
      tiles.push({
        id: 'stock-counts',
        label: 'جرد المخزون',
        icon: <StockCountIcon className="w-11 h-11" />,
        onClick: () => onNavigate('stock-counts'),
      });
    }

    if (checkPerm(['canManageAccounts', 'canManageCashboxes'])) {
      tiles.push({
        id: 'customer-accounts',
        label: 'الحسابات الشاملة',
        icon: <AccountsLedgerIcon className="w-11 h-11" />,
        onClick: () => onNavigate('customer-accounts'),
      });
    }

    if (checkPerm('canManageCashboxes')) {
      tiles.push({
        id: 'cashboxes',
        label: 'الخزينة',
        icon: <SafeVaultIcon className="w-11 h-11" />,
        onClick: () => onNavigate('cashboxes'),
      });
      tiles.push({
        id: 'cashbox-transfer',
        label: 'تحويل الخزائن',
        icon: <CashTransferIcon className="w-11 h-11" />,
        onClick: () => onNavigate('cashbox-transfer'),
      });
      tiles.push({
        id: 'expenses',
        label: 'المصروفات',
        icon: <ExpensesCashIcon className="w-11 h-11" />,
        onClick: () => onNavigate('expenses'),
      });
    }
    if (checkPerm('canViewPersonalAccounts')) {
      tiles.push({
        id: 'personal-accounts',
        label: 'الحسابات الشخصية',
        icon: <PersonalAccountsIcon className="w-11 h-11" />,
        onClick: () => onNavigate('personal-accounts'),
      });
    }

    if (checkPerm('canManageAccounts')) {
      tiles.push({
        id: 'cheques',
        label: 'الشيكات',
        icon: <ChequesIcon className="w-11 h-11" />,
        onClick: () => onNavigate('cheques'),
      });
      tiles.push({
        id: 'installments',
        label: 'الأقساط',
        icon: <InstallmentsIcon className="w-11 h-11" />,
        onClick: () => onNavigate('installments'),
      });
    }

    if (checkPerm(['canManageReps', 'canManageTransfers', 'canManageSales', 'canManageAccounts', 'canApprove'])) {
      tiles.push({
        id: 'refresh-sync',
        label: 'استلام المندوبين',
        icon: <RefreshCloudIcon className="w-11 h-11" />,
        onClick: () => onNavigate('refresh-sync'),
      });
    }

    if (checkPerm('canManageReps')) {
      tiles.push({
        id: 'reps',
        label: 'المندوبون',
        icon: <RepsFleetIcon className="w-11 h-11" />,
        onClick: () => onNavigate('reps'),
      });
    }

    if (checkPerm('canManageEmployees')) {
      tiles.push({
        id: 'employees',
        label: 'شؤون الموظفين',
        icon: <EmployeesHrIcon className="w-11 h-11" />,
        onClick: () => onNavigate('employees'),
      });
    }

    if (checkPerm('canViewReports')) {
      tiles.push({
        id: 'reports',
        label: 'التقارير والأرباح',
        icon: <ReportsChartIcon className="w-11 h-11" />,
        onClick: () => onNavigate('reports'),
      });
    }

    if (checkPerm('canManageUsers')) {
      tiles.push({
        id: 'users',
        label: 'المستخدمون',
        icon: <UsersShieldIcon className="w-11 h-11" />,
        onClick: () => onNavigate('users'),
      });
      tiles.push({
        id: 'audit-log',
        label: 'سجل المراجعة',
        icon: <AuditShieldIcon className="w-11 h-11" />,
        onClick: () => onNavigate('audit-log'),
      });
    }

    if (checkPerm('canManageSettings')) {
      tiles.push({
        id: 'branches-settings',
        label: 'الفروع',
        icon: <BranchesBuildingIcon className="w-11 h-11" />,
        onClick: () => onNavigate('branches-settings'),
      });
      tiles.push({
        id: 'backup',
        label: 'النسخ الاحتياطي',
        icon: <BackupCloudIcon className="w-11 h-11" />,
        onClick: () => onNavigate('backup'),
      });
    }

    tiles.push({
      id: 'system-settings',
      label: 'الإعدادات',
      icon: <SettingsTwinGearsIcon className="w-11 h-11" />,
      onClick: () => onNavigate('system-settings'),
    });

    tiles.push({
      id: 'logout',
      label: 'تسجيل الخروج',
      icon: <LogoutDoorIcon className="w-11 h-11" />,
      onClick: () => setShowLogoutConfirm(true),
    });

    return tiles;
  }, [currentUser, onNavigate]);

  return (
    <div className="min-h-screen bg-[#f5f7f6] dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-['Cairo'] antialiased pb-20">
      {/* Slim Emerald Top App Header Bar */}
      <header className="sticky top-0 z-30 bg-[#0F5A33] text-white shadow-sm pt-safe no-print">
        <div className="max-w-3xl mx-auto px-3 h-13 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 shrink">
            <img
              src="/awlad-selim-logo.png"
              alt="AWLAD SELIM"
              className="h-8 w-8 object-contain bg-white rounded-lg p-0.5 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-xs font-black truncate leading-tight">AWLAD SELIM</h1>
              <p className="text-[10px] text-emerald-100 truncate">
                {getRoleArabicLabel(currentUser?.role)} · {currentUser?.fullName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsNotificationsOpen(true);
                data.markNotificationsRead();
              }}
              className="relative min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-white/15 text-white cursor-pointer"
              title="الإشعارات"
              aria-label="الإشعارات"
            >
              <Bell className="w-4 h-4" />
              {data.unreadNotificationCount > 0 && (
                <span className="absolute top-1.5 right-1 min-w-[16px] h-[16px] px-1 rounded bg-red-600 text-white text-[9px] font-black flex items-center justify-center tabular-nums">
                  {data.unreadNotificationCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsServerModalOpen(true)}
              className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-white/15 text-white cursor-pointer"
              title="عنوان السيرفر المركزي"
              aria-label="إعدادات السيرفر"
            >
              <Server className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => data.triggerManualSync()}
              className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-white/15 text-white cursor-pointer"
              title="تحديث ومزامنة"
              aria-label="تحديث ومزامنة"
            >
              <RefreshCw className={`w-4 h-4 ${data.networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => setIsAccountSwitcherOpen(true)}
              className="relative min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-white/15 text-white cursor-pointer"
              title="الحسابات المحفوظة"
              aria-label="تبديل الحساب"
            >
              <Users className="w-4 h-4" />
              {savedAccounts.length > 1 && (
                <span className="absolute top-1.5 right-1 min-w-[15px] h-[15px] px-1 rounded bg-emerald-500 text-white text-[9px] font-black flex items-center justify-center tabular-nums">
                  {savedAccounts.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsMoreViewOpen(false);
                onNavigate('system-settings');
              }}
              className={`min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg cursor-pointer ${
                !isMoreViewOpen && currentPage === 'system-settings' ? 'bg-white text-[#0F5A33]' : 'text-white hover:bg-white/15'
              }`}
              title="الإعدادات"
              aria-label="الإعدادات"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg bg-red-600/90 hover:bg-red-700 text-white cursor-pointer"
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto p-3 space-y-3">
        {(data.isUsingOfflineCache || data.networkStatus === 'disconnected') && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-center justify-between gap-2 no-print">
            <div className="flex items-center gap-2 min-w-0">
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="truncate">
                بيانات مخزنة مؤقتاً
                {data.lastCacheTimestamp
                  ? ` · ${new Date(data.lastCacheTimestamp).toLocaleTimeString('ar-EG')}`
                  : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={() => data.triggerManualSync()}
              className="min-h-[36px] px-3 rounded-lg bg-amber-600 text-white text-[11px] font-bold shrink-0 cursor-pointer"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {mobileBanner && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-between gap-2 no-print">
            <span>{mobileBanner}</span>
            <button
              type="button"
              onClick={() => setMobileBanner(null)}
              className="text-[11px] underline shrink-0 cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        )}

        {/* WA0007 Searchable Categorized Accordion View ("المزيد") */}
        {isMoreViewOpen ? (
          <section aria-label="جميع الأقسام والعمليات" className="space-y-3 no-print">
            <div className="bg-white rounded-xl border border-slate-200 p-2.5">
              <div className="relative">
                <input
                  type="text"
                  value={moreSearchQuery}
                  onChange={(e) => setMoreSearchQuery(e.target.value)}
                  placeholder="ابحث عن قسم أو شاشة..."
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 pr-9 pl-8 text-xs font-bold bg-slate-50 focus:bg-white focus:outline-hidden focus:border-[#0F5A33]"
                />
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
                {moreSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setMoreSearchQuery('')}
                    className="absolute left-2 top-2.5 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    aria-label="مسح البحث"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {checkPerm('canManageCashboxes') && !moreSearchQuery.trim() && (
              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                <p className="text-xs font-black text-slate-900">عمليات الخزينة السريعة</p>
                <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreViewOpen(false);
                      onOpenCashOp('cash_deposit');
                    }}
                    className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 cursor-pointer"
                  >
                    <ArrowDownCircle className="w-4 h-4 shrink-0" />
                    <span>إيداع نقدي</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreViewOpen(false);
                      onOpenCashOp('cash_withdrawal');
                    }}
                    className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 cursor-pointer"
                  >
                    <ArrowUpCircle className="w-4 h-4 shrink-0" />
                    <span>سحب نقدي</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreViewOpen(false);
                      onOpenCashOp('expense');
                    }}
                    className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-900 cursor-pointer"
                  >
                    <TrendingDown className="w-4 h-4 shrink-0" />
                    <span>مصروف</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreViewOpen(false);
                      onOpenCashOp('profit_deposit');
                    }}
                    className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 cursor-pointer"
                  >
                    <TrendingUp className="w-4 h-4 shrink-0" />
                    <span>إيداع ربحي</span>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              {searchableSections.map((sec) => {
                const SecIcon = sec.icon;
                const isCollapsed = !moreSearchQuery.trim() && Boolean(collapsedSectionIds[sec.id]);
                return (
                  <div key={sec.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleSectionCollapse(sec.id)}
                      aria-expanded={!isCollapsed}
                      className="w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-black bg-slate-50 border-b border-slate-200 text-slate-900 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <SecIcon className="w-4 h-4 text-[#0F5A33] shrink-0" />
                        <span className="truncate">{sec.title}</span>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-150 ${
                          isCollapsed ? 'rotate-90' : ''
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
                              className={`w-full min-h-[46px] px-4 py-2.5 flex items-center justify-between gap-2 text-right text-xs transition-colors cursor-pointer ${
                                active ? 'bg-emerald-50 text-[#0F5A33] font-black' : 'text-slate-800 hover:bg-slate-50 font-bold'
                              }`}
                            >
                              <span className="truncate">{item.label}</span>
                              <ChevronLeft className={`w-4 h-4 shrink-0 ${active ? 'text-[#0F5A33]' : 'text-slate-400'}`} />
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
              <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-3 py-1.5 no-print">
                <button
                  type="button"
                  onClick={() => onNavigate('dashboard')}
                  className="min-h-[44px] px-3 rounded-lg text-[#0F5A33] hover:bg-emerald-50 text-xs font-black flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4 shrink-0" />
                  <span>العودة للرئيسية</span>
                </button>
                <span className="text-[11px] font-bold text-slate-500">{data.settings.companyName || 'أولاد سليم'}</span>
              </div>
            )}

            {currentPage === 'dashboard' && (
              <section aria-label="الاختصارات السريعة" className="space-y-3 no-print">
                {/* Compact Emerald Store Banner */}
                <div className="rounded-xl bg-[#0F5A33] text-white p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black truncate">{data.settings.companyName || 'AWLAD SELIM'}</div>
                    <div className="text-[11px] text-emerald-100 truncate mt-0.5">
                      {getRoleArabicLabel(currentUser?.role)} · {currentUser?.fullName}
                    </div>
                  </div>
                  {canMobileAddProduct && (
                    <button
                      type="button"
                      onClick={() => setIsAddProductModalOpen(true)}
                      className="min-h-[44px] px-3 rounded-lg bg-white text-[#0F5A33] text-xs font-black flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>أضف صنف</span>
                    </button>
                  )}
                </div>

                {/* 3-Col Square Quick Shortcuts Grid */}
                <div>
                  <h2 className="text-xs font-black text-slate-700 mb-2">الاختصارات السريعة</h2>
                  <div className="grid grid-cols-3 gap-2.5">
                    {mobileGridTiles.map((tile) => (
                      <button
                        key={tile.id}
                        type="button"
                        onClick={tile.onClick}
                        className="bg-white rounded-xl border border-slate-200 hover:border-[#0F5A33]/40 active:scale-[0.98] p-2.5 min-h-[96px] flex flex-col items-center justify-center gap-1.5 text-center transition-all cursor-pointer"
                      >
                        <div className="flex items-center justify-center">{tile.icon}</div>
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

      {/* Fixed 5-Tab Bottom Navigation Bar */}
      <nav
        aria-label="التنقل السفلي"
        className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 pb-safe shadow-[0_-2px_10px_rgba(15,23,42,0.06)] no-print"
      >
        <div className="max-w-3xl mx-auto flex items-stretch justify-around">
          {bottomNavTabs.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={tab.onClick}
                aria-current={tab.active ? 'page' : undefined}
                className={`flex-1 min-h-[54px] py-1.5 px-1 flex flex-col items-center justify-center gap-0.5 relative cursor-pointer transition-colors ${
                  tab.active ? 'text-[#0F5A33] font-black' : 'text-slate-500 hover:text-slate-800 font-bold'
                }`}
              >
                {tab.active && (
                  <span className="absolute top-0 inset-x-4 h-[3px] rounded-b bg-[#0F5A33]" aria-hidden="true" />
                )}
                <TabIcon className="w-5 h-5 shrink-0" />
                <span className="text-[10px] leading-tight whitespace-nowrap">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <MobileAddProductModal
        isOpen={isAddProductModalOpen}
        onClose={() => setIsAddProductModalOpen(false)}
        onSaved={(pname) => setMobileBanner(`تمت إضافة الصنف "${pname}" بنجاح.`)}
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
        title="هل تريد تسجيل الخروج؟"
        message="سيتم إنهاء جلستك الحالية والعودة إلى شاشة الدخول الموحدة."
        confirmLabel="نعم، تسجيل الخروج"
      />
    </div>
  );
};

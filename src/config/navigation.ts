import React from 'react';
import {
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
} from 'lucide-react';
import { UserPermissions } from '../types';

export type NavItemKey =
  | 'dashboard'
  | 'sales-invoices'
  | 'new-sale'
  | 'customers'
  | 'customer-orders'
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
  | 'services-settings';

export type PermissionRequirement = keyof UserPermissions | Array<keyof UserPermissions>;

export interface NavSectionItem {
  key: NavItemKey;
  label: string;
  icon?: React.ElementType;
  permission?: PermissionRequirement;
  allowAllStaff?: boolean;
  badge?: string;
  shortcutAction?: string;
}

export interface NavSection {
  id: string;
  title: string;
  icon: React.ElementType;
  permission?: PermissionRequirement;
  items: NavSectionItem[];
}

/**
 * Single Source of Truth for Sidebar sections, order, labels, icons, badges, and permissions.
 * Used identically across Google AI Studio Preview, Windows Desktop, Android, and iOS.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'sales',
    title: 'المبيعات والعملاء',
    icon: ShoppingCart,
    permission: 'canManageSales',
    items: [
      { key: 'sales-invoices', label: 'فواتير المبيعات' },
      { key: 'new-sale', label: 'فاتورة مبيعات جديدة (+)', badge: 'جديد' },
      { key: 'customers', label: 'دليل العملاء والأرصدة' },
      { key: 'customer-orders', label: 'طلبات العملاء والمناديب', badge: 'موحد' },
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
      { key: 'attendance', label: 'الحضور والغياب' },
      { key: 'advances', label: 'السلف والخصومات والمكافآت', permission: 'canManageSalaries' },
      { key: 'payroll', label: 'مسير صرف الرواتب', permission: 'canManageSalaries' },
    ],
  },
  {
    id: 'reports',
    title: 'التقارير المحاسبية',
    icon: FileBarChart,
    permission: 'canViewReports',
    items: [{ key: 'reports', label: 'جميع التقارير والأرباح' }],
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
      { key: 'system-settings', label: 'إعدادات النظام والحساب', allowAllStaff: true },
      { key: 'shortcuts-settings', label: 'اختصارات لوحة المفاتيح', allowAllStaff: true },
      { key: 'branches-settings', label: 'الفروع', permission: 'canManageSettings' },
      { key: 'barcode-settings', label: 'إعدادات الباركود', permission: 'canManageSettings' },
      { key: 'printers-settings', label: 'الطابعات المتعددة', permission: 'canManageSettings' },
      { key: 'invoice-settings', label: 'تصميم الفاتورة', permission: 'canManageSettings' },
      { key: 'mobile-settings', label: 'إعدادات تطبيق العملاء والمناديب', permission: 'canManageSettings' },
      { key: 'online-sync-settings', label: 'المزامنة أونلاين', permission: 'canManageSettings' },
      { key: 'services-settings', label: 'الخدمات والتنبيهات', permission: 'canManageSettings' },
      { key: 'server-settings', label: 'إعدادات السيرفر والاتصال', permission: 'canManageSettings' },
      { key: 'backup', label: 'النسخ الاحتياطي والاستعادة', permission: 'canManageSettings' },
      { key: 'migration', label: 'سجل الترحيل و PostgreSQL', badge: 'جديد', permission: 'canManageSettings' },
    ],
  },
];

export const PAGE_PERMISSIONS: Partial<Record<NavItemKey, PermissionRequirement>> = {
  'sales-invoices': 'canManageSales',
  'new-sale': 'canManageSales',
  'customers': 'canManageSales',
  'customer-orders': 'canManageSales',
  'sales-returns': 'canManageSales',
  'deleted-invoices': 'canViewDeletedInvoices',
  'purchase-invoices': 'canManagePurchases',
  'new-purchase': 'canManagePurchases',
  'suppliers': 'canManagePurchases',
  'purchase-returns': 'canManagePurchases',
  'products': 'canManageInventory',
  'product-categories': 'canManageInventory',
  'units-settings': ['canManageInventory', 'canManageSettings'],
  'abu-selim-import': 'canManageInventory',
  'warehouses': 'canManageWarehouses',
  'stock-transfers': 'canManageInventory',
  'stock-transfers-orders': ['canCreateStockTransfer', 'canApproveStockTransfer', 'canExecuteStockTransfer', 'canManageInventory'],
  'stock-adjustments': 'canManageInventory',
  'stock-counts': ['canCreateStockCount', 'canApproveStockCount', 'canManageInventory'],
  'damaged-stock': 'canManageInventory',
  'stock-movements': 'canManageInventory',
  'cashboxes': 'canManageCashboxes',
  'cashbox-transfer': 'canManageCashboxes',
  'expenses': 'canManageCashboxes',
  'personal-accounts': 'canViewPersonalAccounts',
  'cheques': 'canManageAccounts',
  'installments': 'canManageAccounts',
  'reps': 'canManageReps',
  'rep-transfers': 'canManageTransfers',
  'rep-item-transfers': 'canManageTransfers',
  'employees': 'canManageEmployees',
  'attendance': 'canManageEmployees',
  'advances': 'canManageSalaries',
  'payroll': 'canManageSalaries',
  'reports': 'canViewReports',
  'users': 'canManageUsers',
  'audit-log': 'canManageUsers',
  'server-settings': 'canManageSettings',
  'backup': 'canManageSettings',
  'migration': 'canManageSettings',
  'branches-settings': 'canManageSettings',
  'barcode-settings': 'canManageSettings',
  'printers-settings': 'canManageSettings',
  'invoice-settings': 'canManageSettings',
  'mobile-settings': 'canManageSettings',
  'online-sync-settings': 'canManageSettings',
  'services-settings': 'canManageSettings',
};

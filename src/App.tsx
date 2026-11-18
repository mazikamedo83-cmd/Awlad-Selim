/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ShortcutsProvider, useShortcuts } from './context/ShortcutsContext';
import { LoginView } from './components/modules/auth/LoginView';
import { ChangePasswordModal } from './components/modules/auth/ChangePasswordModal';
import { MobilePortal } from './components/modules/mobile/MobilePortal';
import { StaffMobileShell } from './components/modules/mobile/StaffMobileShell';
import { NavItemKey } from './config/navigation';
import { ShieldAlert } from 'lucide-react';
import { CashOperationType } from './types';
import { PAGE_PERMISSIONS } from './config/navigation';
import { UI_CLASSES } from './styles/designSystem';

// Views
import { DashboardView } from './components/modules/dashboard/DashboardView';
import { SalesInvoicesView } from './components/modules/sales/SalesInvoicesView';
import { DeletedInvoicesView } from './components/modules/sales/DeletedInvoicesView';
import { CustomersView } from './components/modules/customers/CustomersView';
import { CustomerRepOrdersView } from './components/modules/orders/CustomerRepOrdersView';
import { PurchaseInvoicesView } from './components/modules/purchases/PurchaseInvoicesView';
import { SuppliersView } from './components/modules/suppliers/SuppliersView';
import { ReturnsView } from './components/modules/returns/ReturnsView';
import { InventoryView } from './components/modules/inventory/InventoryView';
import { FinanceView } from './components/modules/finance/FinanceView';
import { CashOperationModal } from './components/modules/finance/CashOperationModal';
import { PersonalAccountsView } from './components/modules/personal/PersonalAccountsView';
import { ChequesView } from './components/modules/cheques/ChequesView';
import { RepTransferView } from './components/modules/representatives/RepTransferView';
import { EmployeesView } from './components/modules/employees/EmployeesView';
import { ReportsView } from './components/modules/reports/ReportsView';
import { UsersManagementView } from './components/modules/users/UsersManagementView';
import { SettingsView } from './components/modules/settings/SettingsView';

const ShortcutGlobalActions: React.FC<{ onOpenCashOp: (mode: CashOperationType) => void }> = ({ onOpenCashOp }) => {
  const { registerHandler } = useShortcuts();
  useEffect(() => {
    const u1 = registerHandler('action:cash_deposit', () => onOpenCashOp('cash_deposit'));
    const u2 = registerHandler('action:cash_withdrawal', () => onOpenCashOp('cash_withdrawal'));
    return () => {
      u1();
      u2();
    };
  }, [registerHandler, onOpenCashOp]);
  return null;
};

const MainAppContent: React.FC = () => {
  const { isAuthenticated, isLoading, currentUser, hasPermission } = useAuth();
  const [currentPage, setCurrentPage] = useState<NavItemKey>('dashboard');
  const [cashOpModal, setCashOpModal] = useState<{ open: boolean; mode: CashOperationType }>({
    open: false,
    mode: 'cash_deposit',
  });

  if (isLoading) {
    return (
      <div className={UI_CLASSES.loadingScreen}>
        <div className="text-center space-y-4">
          <div className="w-14 h-14 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-bold text-slate-300">جاري تشغيل نظام أولاد سليم...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView />;
  }

  if (currentUser?.role === 'customer' || currentUser?.role === 'representative') {
    return <MobilePortal />;
  }

  const requiredPerm = PAGE_PERMISSIONS[currentPage];
  const isPageAllowed =
    !requiredPerm ||
    currentUser?.role === 'admin' ||
    (Array.isArray(requiredPerm) ? requiredPerm.some((p) => hasPermission(p)) : hasPermission(requiredPerm));

  const renderActivePage = () => {
    if (!isPageAllowed) {
      return (
        <div className="bg-white rounded-2xl border border-red-200 p-10 text-center space-y-3 shadow-xs">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
          <h3 className="text-base font-black text-slate-900">غير مصرح لك بالوصول إلى هذه الشاشة</h3>
          <p className="text-xs text-slate-500">هذه الصلاحية مقيدة لحسابك. يرجى مراجعة المدير العام عند الحاجة.</p>
          <button
            onClick={() => setCurrentPage('dashboard')}
            className="px-5 py-2 rounded-xl bg-blue-900 text-white text-xs font-bold cursor-pointer"
          >
            العودة إلى الرئيسية
          </button>
        </div>
      );
    }

    switch (currentPage) {
      case 'dashboard':
        return <DashboardView onNavigate={(page) => setCurrentPage(page)} />;

      case 'sales-invoices':
        return <SalesInvoicesView />;

      case 'new-sale':
        return <SalesInvoicesView initialOpenNew={true} />;

      case 'deleted-invoices':
        return <DeletedInvoicesView />;

      case 'customers':
        return <CustomersView />;

      case 'customer-orders':
        return <CustomerRepOrdersView />;

      case 'purchase-invoices':
        return <PurchaseInvoicesView />;

      case 'new-purchase':
        return <PurchaseInvoicesView initialOpenNew={true} />;

      case 'suppliers':
        return <SuppliersView />;

      case 'sales-returns':
        return <ReturnsView initialTypeFilter="sales_return" />;

      case 'purchase-returns':
        return <ReturnsView initialTypeFilter="purchase_return" />;

      case 'products':
        return <InventoryView initialTab="products" />;

      case 'product-categories':
        return <InventoryView initialTab="categories" />;

      case 'units-settings':
        return <InventoryView initialTab="units" />;

      case 'warehouses':
        return <InventoryView initialTab="warehouses" />;

      case 'stock-transfers':
        return <InventoryView initialTab="transfers" />;

      case 'stock-transfers-orders':
        return <InventoryView initialTab="stock-transfers" />;

      case 'stock-adjustments':
        return <InventoryView initialTab="adjustments" />;

      case 'stock-counts':
        return <InventoryView initialTab="stock-counts" />;

      case 'damaged-stock':
        return <InventoryView initialTab="damaged" />;

      case 'stock-movements':
        return <InventoryView initialTab="movements" />;

      case 'abu-selim-import':
        return <SettingsView initialTab="abu-selim" />;

      case 'cashboxes':
        return <FinanceView initialTab="cashboxes" />;
      case 'cashbox-transfer':
        return <FinanceView initialTab="transfer" />;
      case 'expenses':
        return <FinanceView initialTab="expenses" />;

      case 'personal-accounts':
        return <PersonalAccountsView />;

      case 'cheques':
        return <ChequesView initialTab="cheques" />;
      case 'installments':
        return <ChequesView initialTab="installments" />;

      case 'reps':
        return <RepTransferView initialTab="reps-list" />;

      case 'rep-transfers':
        return <RepTransferView initialTab="cash-transfers" />;

      case 'rep-item-transfers':
        return <RepTransferView initialTab="item-transfers" />;

      case 'employees':
        return <EmployeesView initialTab="employees" />;
      case 'attendance':
        return <EmployeesView initialTab="attendance" />;
      case 'advances':
        return <EmployeesView initialTab="advances" />;
      case 'payroll':
        return <EmployeesView initialTab="payrolls" />;

      case 'reports':
        return <ReportsView />;

      case 'users':
        return <UsersManagementView initialTab="users" />;
      case 'audit-log':
        return <UsersManagementView initialTab="audit" />;

      case 'system-settings':
        return (
          <SettingsView
            initialTab={
              currentUser?.role === 'admin' || hasPermission('canManageSettings') ? 'general' : 'shortcuts'
            }
          />
        );

      case 'server-settings':
        return <SettingsView initialTab="server" />;

      case 'backup':
        return <SettingsView initialTab="backup" />;

      case 'migration':
        return <SettingsView initialTab="migration" />;

      case 'branches-settings':
        return <SettingsView initialTab="branches" />;

      case 'barcode-settings':
        return <SettingsView initialTab="barcode" />;

      case 'printers-settings':
        return <SettingsView initialTab="printers" />;

      case 'invoice-settings':
        return <SettingsView initialTab="invoice-design" />;

      case 'mobile-settings':
        return <SettingsView initialTab="mobile-config" />;

      case 'online-sync-settings':
        return <SettingsView initialTab="online-sync" />;

      case 'shortcuts-settings':
        return <SettingsView initialTab="shortcuts" />;

      case 'services-settings':
        return <SettingsView initialTab="services" />;

      default:
        return <DashboardView onNavigate={(page) => setCurrentPage(page)} />;
    }
  };

  return (
    <ShortcutsProvider onNavigate={(page) => setCurrentPage(page as NavItemKey)}>
      <ShortcutGlobalActions onOpenCashOp={(mode) => setCashOpModal({ open: true, mode })} />
      <ChangePasswordModal />

      <CashOperationModal
        isOpen={cashOpModal.open}
        initialMode={cashOpModal.mode}
        onClose={() => setCashOpModal((prev) => ({ ...prev, open: false }))}
      />

      <StaffMobileShell
        currentPage={currentPage}
        onNavigate={(page) => setCurrentPage(page)}
        onOpenCashOp={(mode) => setCashOpModal({ open: true, mode })}
      >
        {renderActivePage()}
      </StaffMobileShell>
    </ShortcutsProvider>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <MainAppContent />
      </DataProvider>
    </AuthProvider>
  );
}

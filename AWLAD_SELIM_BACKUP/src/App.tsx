/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { LoginView } from './components/modules/auth/LoginView';
import { ChangePasswordModal } from './components/modules/auth/ChangePasswordModal';
import { Header } from './components/layout/Header';
import { Sidebar, NavItemKey } from './components/layout/Sidebar';

// Views
import { DashboardView } from './components/modules/dashboard/DashboardView';
import { SalesInvoicesView } from './components/modules/sales/SalesInvoicesView';
import { CustomersView } from './components/modules/customers/CustomersView';
import { PurchaseInvoicesView } from './components/modules/purchases/PurchaseInvoicesView';
import { SuppliersView } from './components/modules/suppliers/SuppliersView';
import { ReturnsView } from './components/modules/returns/ReturnsView';
import { InventoryView } from './components/modules/inventory/InventoryView';
import { FinanceView } from './components/modules/finance/FinanceView';
import { ChequesView } from './components/modules/cheques/ChequesView';
import { RepTransferView } from './components/modules/representatives/RepTransferView';
import { EmployeesView } from './components/modules/employees/EmployeesView';
import { ReportsView } from './components/modules/reports/ReportsView';
import { UsersManagementView } from './components/modules/users/UsersManagementView';
import { SettingsView } from './components/modules/settings/SettingsView';
import { MobilePortal } from './components/modules/mobile/MobilePortal';

const MainAppContent: React.FC = () => {
  const { isAuthenticated, isLoading, currentUser } = useAuth();
  const [currentPage, setCurrentPage] = useState<NavItemKey>('dashboard');
  const [isSidebarOpenMobile, setIsSidebarOpenMobile] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white font-['Cairo']">
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

  const renderActivePage = () => {
    switch (currentPage) {
      case 'dashboard':
        return (
          <DashboardView 
            onNavigate={(page) => setCurrentPage(page)} 
          />
        );

      case 'sales-invoices':
      case 'new-sale':
        return <SalesInvoicesView />;

      case 'customers':
        return <CustomersView />;

      case 'purchase-invoices':
      case 'new-purchase':
        return <PurchaseInvoicesView />;

      case 'suppliers':
        return <SuppliersView />;

      case 'sales-returns':
      case 'purchase-returns':
        return <ReturnsView />;

      case 'products':
        return <InventoryView initialTab="products" />;

      case 'product-categories':
        return <InventoryView initialTab="categories" />;

      case 'warehouses':
        return <InventoryView initialTab="warehouses" />;

      case 'stock-transfers':
        return <InventoryView initialTab="transfers" />;

      case 'stock-adjustments':
        return <InventoryView initialTab="adjustments" />;

      case 'damaged-stock':
        return <InventoryView initialTab="damaged" />;

      case 'stock-movements':
        return <InventoryView initialTab="movements" />;

      case 'abu-selim-import':
        return <SettingsView initialTab="abu-selim" />;

      case 'cashboxes':
      case 'cashbox-transfer':
      case 'expenses':
        return <FinanceView />;

      case 'cheques':
      case 'installments':
        return <ChequesView />;

      case 'reps':
        return <RepTransferView initialTab="reps-list" />;

      case 'rep-transfers':
        return <RepTransferView initialTab="cash-transfers" />;

      case 'rep-item-transfers':
        return <RepTransferView initialTab="item-transfers" />;

      case 'employees':
      case 'attendance':
      case 'advances':
      case 'payroll':
        return <EmployeesView />;

      case 'reports':
        return <ReportsView />;

      case 'users':
      case 'audit-log':
        return <UsersManagementView />;

      case 'system-settings':
        return <SettingsView initialTab="general" />;

      case 'server-settings':
        return <SettingsView initialTab="server" />;

      case 'backup':
        return <SettingsView initialTab="backup" />;

      case 'desktop-mobile':
        return <SettingsView initialTab="mobile-desktop" />;

      default:
        return <DashboardView onNavigate={(page) => setCurrentPage(page)} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-800 flex flex-col font-['Cairo'] antialiased">
      {/* Compulsory Password Change Modal for Initial Admin */}
      <ChangePasswordModal />

      {/* Accordion Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={(page) => setCurrentPage(page)}
        isOpenMobile={isSidebarOpenMobile}
        onCloseMobile={() => setIsSidebarOpenMobile(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Content Area (offset by sidebar width on large screens) */}
      <div 
        className={`flex-1 flex flex-col transition-all duration-300 ${
          isSidebarCollapsed ? 'lg:mr-20' : 'lg:mr-72'
        }`}
      >
        {/* Top Header with verified network indicator and logout button */}
        <Header 
          onToggleSidebar={() => setIsSidebarOpenMobile(prev => !prev)}
          onNavigateToTransfers={() => setCurrentPage('rep-transfers')}
        />

        {/* Page Body */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {renderActivePage()}
        </main>
      </div>
    </div>
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

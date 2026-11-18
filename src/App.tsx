/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ShortcutsProvider, useShortcuts } from './context/ShortcutsContext';
import { LoginView } from './components/modules/auth/LoginView';
import { ChangePasswordModal } from './components/modules/auth/ChangePasswordModal';
import { Header } from './components/layout/Header';
import { Sidebar, NavItemKey } from './components/layout/Sidebar';
import { ShieldAlert, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { UserPermissions, CashOperationType } from './types';

// Views
import { DashboardView } from './components/modules/dashboard/DashboardView';
import { SalesInvoicesView } from './components/modules/sales/SalesInvoicesView';
import { DeletedInvoicesView } from './components/modules/sales/DeletedInvoicesView';
import { CustomersView } from './components/modules/customers/CustomersView';
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
import { MobilePortal } from './components/modules/mobile/MobilePortal';
import { StaffMobileShell } from './components/modules/mobile/StaffMobileShell';
import { getLaunchDeepLinkUrl, isNativeCapacitor, subscribeDeepLinks } from './services/native';
import {
  hasConfiguredServerUrl,
  hydrateServerUrlFromNative,
  saveStoredConnectionProfiles,
  setConfiguredApiBaseUrl,
} from './services/api';
import { claimPairingInvitation, discoverServerCandidates, parsePairingInput } from './services/discovery';

const PAGE_PERMISSIONS: Partial<Record<NavItemKey, keyof UserPermissions | Array<keyof UserPermissions>>> = {
  'sales-invoices': 'canManageSales',
  'new-sale': 'canManageSales',
  'customers': 'canManageSales',
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
  const {
    isAuthenticated,
    isLoading,
    currentUser,
    hasPermission,
    refreshAuthContext,
    pairingBanner,
    setPairingBanner,
    clearPairingBanner,
  } = useAuth();
  const [currentPage, setCurrentPage] = useState<NavItemKey>('dashboard');
  const [isSidebarOpenMobile, setIsSidebarOpenMobile] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [cashOpModal, setCashOpModal] = useState<{ open: boolean; mode: CashOperationType }>({
    open: false,
    mode: 'cash_deposit',
  });
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 1024;
  });

  const inFlightPairingUrlsRef = useRef<Set<string>>(new Set());
  const recentPairingUrlsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let active = true;

    const handlePairingUrl = async (rawUrl: string) => {
      const cleanUrl = String(rawUrl || '').trim();
      if (!cleanUrl) return;
      const parsed = parsePairingInput(cleanUrl);
      if (!parsed?.token) {
        if (/^(?:awladselim:\/\/|https?:\/\/[^/]+\/(?:pair|invite)\/)/i.test(cleanUrl)) {
          setPairingBanner({
            type: 'error',
            message: 'رابط الدعوة غير مكتمل أو لا يحتوي على رمز ربط صالح.',
          });
        }
        return;
      }

      const dedupeKey = `${parsed.serverUrl || ''}|${parsed.token}`;
      const lastHandledAt = recentPairingUrlsRef.current.get(dedupeKey) || 0;
      if (inFlightPairingUrlsRef.current.has(dedupeKey) || Date.now() - lastHandledAt < 5000) {
        return;
      }

      inFlightPairingUrlsRef.current.add(dedupeKey);
      try {
        const res = await claimPairingInvitation(cleanUrl, { clearExistingAuth: true });
        if (!active) return;
        if (res.ok) {
          setPairingBanner({
            type: res.requiresAdminApproval ? 'warning' : 'success',
            message: res.requiresAdminApproval
              ? `تم ربط الجهاز بسيرفر (${res.companyName || ''}). بانتظار اعتماد مدير النظام، ثم أدخل بيانات حسابك للدخول.`
              : `تم إعداد الاتصال تلقائياً بسيرفر (${res.companyName || ''}). يرجى تسجيل الدخول باسم المستخدم وكلمة المرور المعتادة.`,
          });
          await refreshAuthContext();
        } else {
          setPairingBanner({
            type: 'error',
            message: res.error || 'تعذر تفعيل رابط الربط',
          });
        }
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          const cleanPath = window.location.pathname;
          if (cleanPath.startsWith('/pair/') || cleanPath.startsWith('/invite/') || window.location.search.includes('pair_token=')) {
            window.history.replaceState({}, '', '/');
          }
        }
      } finally {
        recentPairingUrlsRef.current.set(dedupeKey, Date.now());
        inFlightPairingUrlsRef.current.delete(dedupeKey);
      }
    };

    const unsubscribeLinks = subscribeDeepLinks(
      (url) => {
        handlePairingUrl(url);
      },
      { skipInitialLaunchUrl: true }
    );

    const bootstrapLinksAndDiscovery = async () => {
      await hydrateServerUrlFromNative();
      if (!active) return;

      const nativeLaunchUrl = isNativeCapacitor() ? await getLaunchDeepLinkUrl() : null;
      if (!active) return;

      if (nativeLaunchUrl) {
        const parsedLaunch = parsePairingInput(nativeLaunchUrl);
        if (parsedLaunch?.token || /^(?:awladselim:\/\/|https?:\/\/[^/]+\/(?:pair|invite)\/)/i.test(nativeLaunchUrl)) {
          await handlePairingUrl(nativeLaunchUrl);
          return;
        }
      }

      if (typeof window !== 'undefined') {
        const loc = window.location.href;
        if (
          loc.includes('pair_token=') ||
          window.location.pathname.startsWith('/pair/') ||
          window.location.pathname.startsWith('/invite/')
        ) {
          await handlePairingUrl(loc);
          return;
        }
      }

      if (isNativeCapacitor() && !hasConfiguredServerUrl()) {
        try {
          const found = await discoverServerCandidates();
          if (!active || found.length === 0 || hasConfiguredServerUrl()) return;
          const first = found[0];
          if (first.profiles) saveStoredConnectionProfiles(first.profiles);
          setConfiguredApiBaseUrl(first.url);
          setPairingBanner({
            type: 'success',
            message: `تم اكتشاف السيرفر المركزي تلقائياً على الشبكة المحلية (${first.url}). يرجى تسجيل الدخول بحسابك.`,
          });
          await refreshAuthContext();
        } catch {
          // ignore discovery failures
        }
      }
    };

    bootstrapLinksAndDiscovery();

    return () => {
      active = false;
      unsubscribeLinks();
    };
  }, [refreshAuthContext, setPairingBanner]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const sync = () => setIsMobileViewport(mq.matches);
    sync();
    if (mq.addEventListener) {
      mq.addEventListener('change', sync);
      return () => mq.removeEventListener('change', sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  const useMobileStaffShell = isNativeCapacitor() || isMobileViewport;

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
            className="px-5 py-2 rounded-xl bg-blue-900 text-white text-xs font-bold"
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

      {pairingBanner && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] w-[calc(100%-1.5rem)] max-w-lg px-2 pointer-events-none">
          <div
            className={`pointer-events-auto p-3.5 rounded-2xl border shadow-xl text-xs font-bold flex items-start justify-between gap-2.5 ${
              pairingBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : pairingBanner.type === 'warning'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            <div className="flex items-start gap-2">
              {pairingBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{pairingBanner.message}</span>
            </div>
            <button
              type="button"
              onClick={clearPairingBanner}
              className="p-1 rounded-lg hover:bg-black/5 shrink-0 cursor-pointer"
              aria-label="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {useMobileStaffShell ? (
        <StaffMobileShell
          currentPage={currentPage}
          onNavigate={(page) => setCurrentPage(page)}
          onOpenCashOp={(mode) => setCashOpModal({ open: true, mode })}
        >
          {renderActivePage()}
        </StaffMobileShell>
      ) : (
        <div className="min-h-screen bg-slate-100/70 text-slate-800 flex flex-col font-['Cairo'] antialiased">
          <Sidebar
            currentPage={currentPage}
            onNavigate={(page) => setCurrentPage(page)}
            isOpenMobile={isSidebarOpenMobile}
            onCloseMobile={() => setIsSidebarOpenMobile(false)}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />

          <div
            className={`flex-1 flex flex-col transition-all duration-300 ${
              isSidebarCollapsed ? 'lg:mr-20' : 'lg:mr-72'
            }`}
          >
            <Header
              onToggleSidebar={() => {
                if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
                  setIsSidebarCollapsed((prev) => !prev);
                } else {
                  setIsSidebarOpenMobile((prev) => !prev);
                }
              }}
              onNavigate={(page) => setCurrentPage(page)}
              onOpenCashOp={(mode) => setCashOpModal({ open: true, mode })}
              onNavigateToTransfers={() => setCurrentPage('rep-transfers')}
            />

            <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
              {renderActivePage()}
            </main>
          </div>
        </div>
      )}
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

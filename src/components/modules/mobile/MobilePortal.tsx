import React, { useState, useEffect } from 'react';
import {
  Bell,
  CloudOff,
  LogOut,
  RefreshCw,
  Server,
  ShieldAlert,
  WifiOff,
  Home,
  Globe,
  BellRing,
  Volume2,
  Package,
  ShoppingCart,
  ClipboardList,
  Receipt,
  Users,
  FilePlus2,
  FileText,
  ArrowLeftRight,
  X,
  ChevronLeft,
  AlertCircle,
  Settings,
  Lock,
  ShieldCheck,
  Heart,
  Tag,
  Menu,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { getStoredTokens } from '../../../services/api';
import { isMobileAppPlatform, registerAndroidBackButton } from '../../../services/native';
import { MobileNotificationItem } from '../../../types';
import { CustomerPortal, CustomerTabKey } from './CustomerPortal';
import { RepPortal, RepTabKey } from './RepPortal';
import { MobileNotificationsSheet } from './MobileNotificationsSheet';
import { MobileServerModal } from './MobileServerModal';
import { SyncCenterModal } from '../../common/SyncCenterModal';

export const MobilePortal: React.FC = () => {
  const {
    currentUser,
    isOfflineSession,
    permissionsMayBeStale,
    isDatabaseUnavailable,
    databaseUnavailableMessage,
    linkWarning,
    logout,
    refreshAuthContext,
    hasPermission,
    updatePassword,
  } = useAuth();
  const data = useData();
  const { themePreference, setThemePreference, language, setLanguage, t } = usePreferences();
  const isRep = currentUser?.role === 'representative';
  const hideSectionsNav = isMobileAppPlatform();

  const [customerTab, setCustomerTab] = useState<CustomerTabKey>('home');
  const [repTab, setRepTab] = useState<RepTabKey>('home');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isSyncCenterOpen, setIsSyncCenterOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [showPasswordBox, setShowPasswordBox] = useState(false);
  const [currPwd, setCurrPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [isSavingPwd, setIsSavingPwd] = useState(false);
  const [pwdFeedback, setPwdFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasUnsavedRepInvoice, setHasUnsavedRepInvoice] = useState(false);
  const [pendingRepTab, setPendingRepTab] = useState<RepTabKey | null>(null);
  const [customerCartCount, setCustomerCartCount] = useState(0);

  const notifStorageKey = `awlad_selim_notif_prefs_${currentUser?.id || 'guest'}`;
  const [notifPrefs, setNotifPrefs] = useState<{
    soundEnabled: boolean;
    dispatchAlerts: boolean;
    orderAlerts: boolean;
  }>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(notifStorageKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          soundEnabled: parsed.soundEnabled !== false,
          dispatchAlerts: parsed.dispatchAlerts !== false,
          orderAlerts: parsed.orderAlerts !== false,
        };
      }
    } catch {
      // ignore storage errors
    }
    return { soundEnabled: true, dispatchAlerts: true, orderAlerts: true };
  });

  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(notifStorageKey) : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          setNotifPrefs({
            soundEnabled: parsed.soundEnabled !== false,
            dispatchAlerts: parsed.dispatchAlerts !== false,
            orderAlerts: parsed.orderAlerts !== false,
          });
        }
      } catch {
        // ignore storage errors
      }
    };
    loadFromStorage();
    const handler = () => loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('awlad-notif-prefs-changed', handler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('awlad-notif-prefs-changed', handler);
      }
    };
  }, [notifStorageKey]);

  const toggleNotifPref = (key: 'soundEnabled' | 'dispatchAlerts' | 'orderAlerts') => {
    setNotifPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(notifStorageKey, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('awlad-notif-prefs-changed'));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const requestRepTabChange = (nextTab: RepTabKey) => {
    if (isRep && repTab === 'new-invoice' && hasUnsavedRepInvoice && nextTab !== 'new-invoice') {
      setPendingRepTab(nextTab);
      return;
    }
    setRepTab(nextTab);
  };

  const syncBadgeCount = data.pendingSyncCount + data.conflictsCount;

  // Android hardware back button handling: close modals/drawer first, else return to home tab
  useEffect(() => {
    return registerAndroidBackButton(() => {
      if (pendingRepTab) {
        setPendingRepTab(null);
        return true;
      }
      if (isSettingsModalOpen) {
        setIsSettingsModalOpen(false);
        return true;
      }
      if (isSyncCenterOpen) {
        setIsSyncCenterOpen(false);
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
      if (isDrawerOpen) {
        setIsDrawerOpen(false);
        return true;
      }
      if (isRep && repTab !== 'home') {
        requestRepTabChange('home');
        return true;
      }
      if (!isRep && customerTab !== 'home') {
        setCustomerTab('home');
        return true;
      }
      return false;
    });
  }, [pendingRepTab, isSettingsModalOpen, isSyncCenterOpen, isNotificationsOpen, isServerModalOpen, isDrawerOpen, isRep, repTab, customerTab, hasUnsavedRepInvoice]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDrawerOpen]);

  const handleSelectNotification = (item: MobileNotificationItem) => {
    if (isRep) {
      if (
        item.targetTab === 'custody' ||
        item.targetTab === 'invoices' ||
        item.targetTab === 'purchases-list' ||
        item.targetTab === 'suppliers' ||
        item.targetTab === 'rep-reports' ||
        item.targetTab === 'customers' ||
        item.targetTab === 'new-invoice' ||
        item.targetTab === 'orders' ||
        item.targetTab === 'refresh' ||
        item.targetTab === 'cash'
      ) {
        requestRepTabChange(item.targetTab as RepTabKey);
      } else {
        requestRepTabChange('home');
      }
    } else {
      if (
        item.targetTab === 'account' ||
        item.targetTab === 'orders' ||
        item.targetTab === 'categories' ||
        item.targetTab === 'offers' ||
        item.targetTab === 'favorites' ||
        item.targetTab === 'more' ||
        item.targetTab === 'cart'
      ) {
        setCustomerTab(item.targetTab);
      } else if ((item.targetTab as string) === 'catalog') {
        setCustomerTab('categories');
      } else {
        setCustomerTab('orders');
      }
    }
  };

  // Rep permission flags for bottom nav
  const isAdmin = currentUser?.role === 'admin';
  const canRepSales = isAdmin || hasPermission('canManageSales');
  const canRepCreatePurchase = isAdmin || hasPermission('canManagePurchases') || hasPermission('canCreatePurchase');
  const canRepCash =
    isAdmin ||
    hasPermission('canManageCashboxes') ||
    hasPermission('canManageAccounts') ||
    hasPermission('canManageTransfers') ||
    hasPermission('canManageSales');

  const repMoreSecondaryTabs: RepTabKey[] = [
    'more',
    'new-purchase',
    'sales-return',
    'purchase-return',
    'cash-deposit',
    'cash-withdrawal',
    'custody-transfer',
    'new-customer',
    'new-supplier',
    'refresh',
    'cheques-installments',
    'new-quote',
    'orders',
    'invoices',
    'purchases-list',
    'sales-returns-list',
    'purchase-returns-list',
    'custody',
    'suppliers',
    'rep-reports',
  ];

  // Fixed 5-tab bottom navigation bar items
  const bottomNavItems = isRep
    ? [
        { key: 'home', label: 'الرئيسية', icon: Home, active: repTab === 'home', badge: 0, onSelect: () => requestRepTabChange('home') },
        { key: 'customers', label: 'العملاء', icon: Users, active: repTab === 'customers', badge: 0, onSelect: () => requestRepTabChange('customers') },
        canRepSales
          ? { key: 'new-invoice', label: 'فاتورة', icon: FilePlus2, active: repTab === 'new-invoice', badge: 0, onSelect: () => requestRepTabChange('new-invoice') }
          : canRepCreatePurchase
          ? { key: 'new-purchase', label: 'شراء', icon: Receipt, active: repTab === 'new-purchase', badge: 0, onSelect: () => requestRepTabChange('new-purchase') }
          : { key: 'orders', label: 'الطلبات', icon: ClipboardList, active: repTab === 'orders', badge: 0, onSelect: () => requestRepTabChange('orders') },
        canRepCash
          ? { key: 'cash', label: 'النقدية', icon: Receipt, active: repTab === 'cash', badge: 0, onSelect: () => requestRepTabChange('cash') }
          : { key: 'rep-reports', label: 'التقارير', icon: FileText, active: repTab === 'rep-reports', badge: 0, onSelect: () => requestRepTabChange('rep-reports') },
        {
          key: 'more',
          label: 'المزيد',
          icon: Menu,
          active: repMoreSecondaryTabs.includes(repTab) && !(repTab === 'rep-reports' && !canRepCash) && !(repTab === 'new-purchase' && !canRepSales) && !(repTab === 'orders' && !canRepSales && !canRepCreatePurchase),
          badge: 0,
          onSelect: () => requestRepTabChange('more'),
        },
      ]
    : [
        { key: 'home', label: 'الرئيسية', icon: Home, active: customerTab === 'home', badge: 0, onSelect: () => setCustomerTab('home') },
        { key: 'categories', label: 'الأقسام', icon: Package, active: customerTab === 'categories', badge: 0, onSelect: () => setCustomerTab('categories') },
        { key: 'offers', label: 'العروض', icon: Tag, active: customerTab === 'offers', badge: 0, onSelect: () => setCustomerTab('offers') },
        { key: 'favorites', label: 'المفضلة', icon: Heart, active: customerTab === 'favorites', badge: data.customerFavorites?.length || 0, onSelect: () => setCustomerTab('favorites') },
        { key: 'more', label: 'المزيد', icon: Menu, active: ['more', 'orders', 'account'].includes(customerTab), badge: 0, onSelect: () => setCustomerTab('more') },
      ];

  const allPortalDestinations = isRep
    ? [
        { key: 'home', label: 'الرئيسية (الشبكة السريعة)', icon: Home, active: repTab === 'home', onSelect: () => requestRepTabChange('home') },
        { key: 'cash', label: 'النقدية والعهدة المالية', icon: Receipt, active: repTab === 'cash', onSelect: () => requestRepTabChange('cash') },
        { key: 'refresh', label: 'REFRESH · الإرسال والاستلام', icon: RefreshCw, active: repTab === 'refresh', onSelect: () => requestRepTabChange('refresh') },
        { key: 'new-invoice', label: 'إصدار فاتورة بيع', icon: FilePlus2, active: repTab === 'new-invoice', onSelect: () => requestRepTabChange('new-invoice') },
        { key: 'new-quote', label: 'عرض سعر', icon: FileText, active: repTab === 'new-quote', onSelect: () => requestRepTabChange('new-quote') },
        { key: 'customers', label: 'دليل العملاء', icon: Users, active: repTab === 'customers', onSelect: () => requestRepTabChange('customers') },
        { key: 'orders', label: 'الطلبات والتسليمات', icon: ClipboardList, active: repTab === 'orders', onSelect: () => requestRepTabChange('orders') },
        { key: 'invoices', label: 'سجل فواتير المبيعات', icon: FileText, active: repTab === 'invoices', onSelect: () => requestRepTabChange('invoices') },
        ...(currentUser?.role === 'admin' || hasPermission('canManagePurchases') || hasPermission('canCreatePurchase')
          ? [
              { key: 'purchases-list', label: 'فواتير الشراء', icon: Receipt, active: repTab === 'purchases-list', onSelect: () => requestRepTabChange('purchases-list') },
              { key: 'suppliers', label: 'الموردون وكشف الحساب', icon: Users, active: repTab === 'suppliers', onSelect: () => requestRepTabChange('suppliers') },
            ]
          : []),
        { key: 'rep-reports', label: 'تقارير المندوب', icon: FileText, active: repTab === 'rep-reports', onSelect: () => requestRepTabChange('rep-reports') },
        { key: 'custody', label: 'المخزن والعهدة والتحويلات', icon: ArrowLeftRight, active: repTab === 'custody', onSelect: () => requestRepTabChange('custody') },
        { key: 'more', label: 'المزيد والإعدادات', icon: Menu, active: repTab === 'more', onSelect: () => requestRepTabChange('more') },
      ]
    : [
        { key: 'home', label: 'الرئيسية', icon: Home, active: customerTab === 'home', onSelect: () => setCustomerTab('home') },
        { key: 'categories', label: 'الأقسام والمنتجات', icon: Package, active: customerTab === 'categories', onSelect: () => setCustomerTab('categories') },
        { key: 'offers', label: 'العروض والخصومات', icon: Tag, active: customerTab === 'offers', onSelect: () => setCustomerTab('offers') },
        { key: 'favorites', label: 'المفضلة', icon: Heart, active: customerTab === 'favorites', onSelect: () => setCustomerTab('favorites') },
        { key: 'cart', label: `سلة الطلبات (${customerCartCount})`, icon: ShoppingCart, active: customerTab === 'cart', onSelect: () => setCustomerTab('cart') },
        { key: 'orders', label: 'طلباتي الحالية', icon: ClipboardList, active: customerTab === 'orders', onSelect: () => setCustomerTab('orders') },
        { key: 'account', label: 'فواتيري وكشف الحساب', icon: Receipt, active: customerTab === 'account', onSelect: () => setCustomerTab('account') },
        { key: 'more', label: 'المزيد والإعدادات', icon: Menu, active: customerTab === 'more', onSelect: () => setCustomerTab('more') },
      ];

  return (
    <div className="min-h-screen bg-[#F4F6FA] dark:bg-[#081326] text-slate-800 dark:text-[#DCE6F5] font-sans antialiased pb-16 pb-safe">
      {/* Slim Brand Mobile App Header */}
      <header className="sticky top-0 z-30 awlad-brand-gradient text-white shadow-sm border-b border-[var(--awlad-navy-950)] pt-safe">
        <div className="max-w-5xl mx-auto px-3 sm:px-4">
          <div className="h-12 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {!hideSectionsNav && (
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen((prev) => !prev)}
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer shrink-0"
                  title="أقسام البوابة"
                  aria-label="أقسام البوابة"
                >
                  <Menu className="w-4 h-4" />
                </button>
              )}
              <img
                src="/awlad-selim-logo.png"
                alt="AWLAD SELIM"
                className="no-dark-surface h-7 w-7 object-contain bg-white dark:bg-white rounded-md p-0.5 shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-xs sm:text-sm font-black truncate leading-tight">أولاد سليم</h1>
                <p className="text-[10px] text-blue-100 truncate">
                  {isRep ? 'بوابة المندوب' : 'متجر العملاء'} · {currentUser?.fullName}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setIsSyncCenterOpen(true)}
                className={`relative min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-white cursor-pointer ${
                  data.conflictsCount > 0
                    ? 'bg-orange-600 hover:bg-orange-700'
                    : data.pendingSyncCount > 0
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-white/10 hover:bg-white/20'
                }`}
                title="مركز المزامنة"
                aria-label="مركز المزامنة"
              >
                <CloudOff className="w-4 h-4" />
                {syncBadgeCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded bg-slate-900 dark:bg-[#1659C8] text-white text-[9px] font-black flex items-center justify-center tabular-nums">
                    {syncBadgeCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsNotificationsOpen(true);
                  data.markNotificationsRead();
                }}
                className="relative min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="الإشعارات"
                aria-label="الإشعارات"
              >
                <Bell className="w-4 h-4" />
                {data.unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded bg-red-600 text-white text-[9px] font-black flex items-center justify-center tabular-nums">
                    {data.unreadNotificationCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => data.triggerManualSync()}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="تحديث ومزامنة"
                aria-label="تحديث ومزامنة"
              >
                <RefreshCw className={`w-4 h-4 ${data.networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(true)}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="الإعدادات"
                aria-label="الإعدادات"
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={logout}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg bg-red-600/90 hover:bg-red-700 text-white cursor-pointer"
                title="تسجيل الخروج"
                aria-label="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Compact Sliding Sections Drawer (Windows/Web only) */}
      {!hideSectionsNav && isDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px] transition-opacity"
          onClick={() => setIsDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      {!hideSectionsNav && (
      <aside
        aria-label="قائمة أقسام البوابة"
        aria-hidden={!isDrawerOpen}
        className={`fixed top-0 bottom-0 right-0 z-50 w-[80vw] max-w-[290px] bg-white dark:bg-[#0E1C36] text-slate-800 dark:text-[#DCE6F5] border-l border-slate-200 dark:border-[#21375C] shadow-2xl transition-transform duration-200 ease-out flex flex-col pt-safe pb-safe ${
          isDrawerOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
        }`}
      >
        <div className="h-12 flex items-center justify-between px-3 bg-[var(--awlad-navy-950)] text-white border-b border-[var(--awlad-navy-900)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/awlad-selim-logo.png"
              alt="AWLAD SELIM"
              className="no-dark-surface h-7 w-7 object-contain bg-white dark:bg-white rounded-md p-0.5 shrink-0"
            />
            <div className="min-w-0">
              <span className="block text-xs font-black truncate">أقسام البوابة</span>
              <span className="block text-[10px] text-blue-200 truncate">
                {isRep ? 'بوابة المندوب' : 'بوابة العميل'} · {currentUser?.fullName}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsDrawerOpen(false)}
            className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 text-white cursor-pointer shrink-0"
            aria-label="إغلاق القائمة الجانبية"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {allPortalDestinations.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  item.onSelect();
                  setIsDrawerOpen(false);
                }}
                className={`w-full min-h-[34px] px-2.5 py-1 rounded-md flex items-center justify-between gap-2 text-xs border transition-colors cursor-pointer ${
                  item.active
                    ? 'bg-[var(--awlad-navy-900)] dark:bg-[#1659C8] text-white border-[var(--awlad-navy-900)] dark:border-[#60A5FA]/40 font-black'
                    : 'bg-white dark:bg-[#132544] text-slate-800 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] hover:bg-[#EEF3FA] dark:hover:bg-[#1A3461] font-bold'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </div>
                <ChevronLeft className={`w-3.5 h-3.5 shrink-0 ${item.active ? 'text-blue-200' : 'text-slate-400'}`} />
              </button>
            );
          })}
        </div>
      </aside>
      )}

      <main className="max-w-5xl mx-auto p-2 space-y-2">
        {linkWarning && (
          <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900">
            {linkWarning}
          </div>
        )}

        {(isDatabaseUnavailable || (data.networkStatus === 'error' && data.lastError)) && (
          <div className="px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-200 text-xs font-bold text-red-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>
                {isDatabaseUnavailable
                  ? databaseUnavailableMessage || data.lastError
                  : data.lastError}
              </span>
            </div>
            <button
              type="button"
              disabled={data.isSyncing}
              onClick={() => {
                refreshAuthContext().catch(() => {});
                data.triggerManualSync();
              }}
              className="px-2 py-1 rounded-md bg-red-600 text-white text-[11px] font-bold shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {data.isSyncing ? 'جاري الفحص...' : 'إعادة المحاولة'}
            </button>
          </div>
        )}

        {!isDatabaseUnavailable && (isOfflineSession || permissionsMayBeStale) && (
          <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              وضع الدخول المحلي الموثق — يتم تطبيق آخر صلاحيات موثقة من السيرفر وقد تتحدث فور عودة الاتصال.
            </span>
          </div>
        )}

        {!isDatabaseUnavailable &&
          data.networkStatus !== 'error' &&
          (data.isUsingOfflineCache || data.networkStatus === 'disconnected') && (
            <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  العمل دون اتصال — تُحفظ عملياتك في قاعدة البيانات المحلية وتُزامن تلقائياً فور عودة الشبكة
                  {data.lastServerSyncAt ? ` · آخر مزامنة: ${new Date(data.lastServerSyncAt).toLocaleTimeString('ar-EG')}` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => data.triggerManualSync()}
                className="px-2 py-1 rounded-md bg-amber-600 text-white text-[11px] font-bold shrink-0 cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

        {(data.pendingSyncCount > 0 || data.conflictsCount > 0) && (
          <div className="px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-bold text-blue-900 flex items-center justify-between gap-2">
            <span>
              {data.conflictsCount > 0
                ? `توجد (${data.conflictsCount}) تعارضات مزامنة تحتاج مراجعة و(${data.pendingSyncCount}) عمليات محلية بانتظار الاعتماد المركزي.`
                : `توجد (${data.pendingSyncCount}) عمليات محلية بانتظار المزامنة (الأرصدة الحالية مبدئية لحين الاعتماد المركزي).`}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setIsSyncCenterOpen(true)}
                className="px-2 py-1 rounded-md bg-white border border-blue-300 text-blue-900 text-[11px] font-bold cursor-pointer"
              >
                مركز المزامنة
              </button>
              <button
                type="button"
                onClick={() => data.triggerManualSync()}
                className="px-2 py-1 rounded-md bg-blue-900 text-white text-[11px] font-bold cursor-pointer"
              >
                مزامنة الآن
              </button>
            </div>
          </div>
        )}

        {isRep ? (
          <RepPortal
            activeTab={repTab}
            onTabChange={setRepTab}
            onOpenServerModal={() => setIsServerModalOpen(true)}
            onLogout={logout}
            onUnsavedInvoiceChange={setHasUnsavedRepInvoice}
          />
        ) : (
          <CustomerPortal
            activeTab={customerTab}
            onTabChange={setCustomerTab}
            onCartCountChange={setCustomerCartCount}
            onOpenNotifications={() => {
              setIsNotificationsOpen(true);
              data.markNotificationsRead();
            }}
            onOpenServerModal={() => setIsServerModalOpen(true)}
            onOpenSyncCenter={() => setIsSyncCenterOpen(true)}
            onLogout={logout}
          />
        )}
      </main>

      {/* Fixed 5-Tab Mobile Bottom Navigation Bar */}
      <nav
        aria-label="شريط التنقل السفلي"
        className="fixed bottom-0 inset-x-0 z-30 bg-white dark:bg-[#0E1C36] border-t border-slate-200 dark:border-[#21375C] pb-safe shadow-sm dark:shadow-[0_-4px_16px_rgba(0,0,0,0.35)]"
      >
        <div className="max-w-5xl mx-auto grid grid-cols-5 gap-0.5 px-1">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onSelect}
                aria-current={item.active ? 'page' : undefined}
                className={`relative min-h-[48px] py-1 px-1 flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                  item.active
                    ? 'text-[var(--awlad-royal-700)] dark:text-[#60A5FA] font-black'
                    : 'text-slate-500 dark:text-[#95ACCE] hover:text-slate-800 dark:hover:text-[#DCE6F5] font-bold'
                }`}
              >
                {item.active && (
                  <span className="absolute top-0 inset-x-3 h-[2.5px] rounded-b bg-[var(--awlad-royal-700)] dark:bg-[#60A5FA]" />
                )}
                <div className="relative">
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.badge > 0 && (
                    <span className="absolute -top-1.5 -left-2 min-w-[15px] h-[15px] px-1 rounded bg-[var(--awlad-royal-700)] text-white text-[9px] font-black flex items-center justify-center tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] leading-none truncate max-w-full">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {pendingRepTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-lg p-3 shadow-2xl border border-slate-200 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-black text-sm text-amber-800">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>توجد أصناف غير محفوظة في الفاتورة</span>
            </div>
            <p className="text-slate-600 leading-snug">
              توجد أصناف مضافة في شاشة فاتورة البيع لم تُحفظ بعد. هل تود البقاء لإكمال الفاتورة أم الانتقال مع الاحتفاظ بالبيانات مؤقتاً؟
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => setPendingRepTab(null)}
                className="h-8 rounded-md bg-blue-900 text-white font-black cursor-pointer"
              >
                البقاء في الفاتورة
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingRepTab;
                  setPendingRepTab(null);
                  setRepTab(target);
                }}
                className="h-8 rounded-md bg-slate-100 text-slate-800 font-bold cursor-pointer"
              >
                الانتقال مؤقتاً
              </button>
            </div>
          </div>
        </div>
      )}

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
          if (getStoredTokens()?.accessToken) {
            await data.triggerManualSync();
          }
        }}
      />

      <SyncCenterModal
        isOpen={isSyncCenterOpen}
        onClose={() => setIsSyncCenterOpen(false)}
      />

      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white dark:bg-[#0E1C36] rounded-lg p-3 shadow-2xl border border-slate-200 dark:border-[#21375C] space-y-2 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#1B2F52] pb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-blue-50 dark:bg-[#172E56] text-blue-800 dark:text-[#85B8FF] flex items-center justify-center">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-xs text-slate-900 dark:text-[#F3F7FC]">إعدادات التطبيق والحساب</h3>
                  <p className="text-[11px] text-slate-500 dark:text-[#97AECE]">
                    {isRep ? 'بوابة المندوب' : 'بوابة العميل'} · {currentUser?.fullName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="h-8 w-8 rounded-md bg-slate-100 dark:bg-[#132544] hover:bg-slate-200 dark:hover:bg-[#1A3461] flex items-center justify-center text-slate-700 dark:text-[#DCE6F5] cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5 max-h-[72vh] overflow-y-auto pr-0.5">
              {/* Theme Switcher */}
              <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1">
                <p className="font-black text-[11px] text-slate-800 dark:text-[#F3F7FC]">مظهر التطبيق</p>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { key: 'light', label: 'نهاري', icon: Sun },
                      { key: 'dark', label: 'داكن', icon: Moon },
                      { key: 'system', label: 'تلقائي', icon: Monitor },
                    ] as const
                  ).map((opt) => {
                    const Icon = opt.icon;
                    const active = themePreference === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setThemePreference(opt.key)}
                        className={`h-8 rounded-md border text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                          active
                            ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                            : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] hover:bg-slate-100 dark:hover:bg-[#1A3461]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Language Switcher (preserving RTL/LTR engine without exposing technical strings) */}
              <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1">
                <p className="font-black text-[11px] text-slate-800 dark:text-[#F3F7FC] flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
                  <span>{t('لغة الواجهة', 'Interface Language')}</span>
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLanguage('ar')}
                    className={`h-8 rounded-md border font-bold cursor-pointer transition-colors ${
                      language === 'ar'
                        ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                        : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] hover:bg-slate-100 dark:hover:bg-[#1A3461]'
                    }`}
                  >
                    العربية
                  </button>
                  <button
                    type="button"
                    onClick={() => setLanguage('en')}
                    className={`h-8 rounded-md border font-bold cursor-pointer transition-colors ${
                      language === 'en'
                        ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                        : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] hover:bg-slate-100 dark:hover:bg-[#1A3461]'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>

              {/* Notifications & Alert Toggles */}
              <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1.5">
                <p className="font-black text-[11px] text-slate-800 dark:text-[#F3F7FC] flex items-center gap-1.5">
                  <BellRing className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
                  <span>{t('تفضيلات التنبيهات', 'Notification Preferences')}</span>
                </p>
                <div className="space-y-1">
                  <label className="flex items-center justify-between gap-2 px-1.5 py-1 rounded bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] cursor-pointer">
                    <span className="flex items-center gap-1.5 font-bold text-[11px] text-slate-700 dark:text-[#DCE6F5]">
                      <Volume2 className="w-3.5 h-3.5 text-slate-500 dark:text-[#8CA3C7]" />
                      <span>أصوات التنبيه والباركود</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={notifPrefs.soundEnabled}
                      onChange={() => toggleNotifPref('soundEnabled')}
                      className="w-4 h-4 accent-[#003589] dark:accent-[#3B82F6] cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 px-1.5 py-1 rounded bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] cursor-pointer">
                    <span className="font-bold text-[11px] text-slate-700 dark:text-[#DCE6F5]">
                      تنبيهات الإرسال والاستلام والترحيل
                    </span>
                    <input
                      type="checkbox"
                      checked={notifPrefs.dispatchAlerts}
                      onChange={() => toggleNotifPref('dispatchAlerts')}
                      className="w-4 h-4 accent-[#003589] dark:accent-[#3B82F6] cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 px-1.5 py-1 rounded bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] cursor-pointer">
                    <span className="font-bold text-[11px] text-slate-700 dark:text-[#DCE6F5]">
                      تنبيهات الطلبات والموافقات الفورية
                    </span>
                    <input
                      type="checkbox"
                      checked={notifPrefs.orderAlerts}
                      onChange={() => toggleNotifPref('orderAlerts')}
                      className="w-4 h-4 accent-[#003589] dark:accent-[#3B82F6] cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* Scoped Permissions Summary */}
              <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-black text-slate-800 dark:text-[#F3F7FC]">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    <span>حالة الحساب والصلاحيات</span>
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] font-mono">
                    @{currentUser?.username} · {isRep ? 'مندوب' : 'عميل'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-700 dark:text-[#CBD9EE] font-bold leading-snug">
                  {Object.entries(currentUser?.permissions || {})
                    .filter(([, ok]) => Boolean(ok))
                    .slice(0, 8)
                    .map(([k]) =>
                      k === 'canManageSales'
                        ? 'المبيعات'
                        : k === 'canCreatePurchase'
                        ? 'فواتير الشراء'
                        : k === 'canManageTransfers'
                        ? 'العهد والتحويل'
                        : k === 'canView'
                        ? 'العرض'
                        : k === 'canAdd'
                        ? 'الإضافة'
                        : k === 'canEdit'
                        ? 'التعديل'
                        : k === 'canPrint'
                        ? 'الطباعة'
                        : k === 'canSend'
                        ? 'الإرسال'
                        : k === 'canReceive'
                        ? 'الاستلام'
                        : k
                    )
                    .join(' · ') || 'صلاحيات العرض الأساسية'}
                </p>
              </div>

              {/* Change Password Inline Accordion */}
              <button
                type="button"
                onClick={() => {
                  setShowPasswordBox((prev) => !prev);
                  setPwdFeedback(null);
                }}
                className="w-full min-h-[34px] px-2.5 rounded-md bg-slate-50 dark:bg-[#132544] hover:bg-[#EEF3FA] dark:hover:bg-[#1A3461] border border-slate-200 dark:border-[#21375C] flex items-center justify-between font-bold text-slate-800 dark:text-[#F3F7FC] cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
                  <span>تغيير كلمة المرور</span>
                </span>
                <ChevronLeft className={`w-3.5 h-3.5 text-slate-400 dark:text-[#849BBF] transition-transform ${showPasswordBox ? '-rotate-90' : ''}`} />
              </button>

              {showPasswordBox && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setPwdFeedback(null);
                    if (newPwd.length < 4) {
                      setPwdFeedback({ type: 'error', text: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل.' });
                      return;
                    }
                    if (newPwd !== confirmPwd) {
                      setPwdFeedback({ type: 'error', text: 'تأكيد كلمة المرور غير مطابق.' });
                      return;
                    }
                    setIsSavingPwd(true);
                    const res = await updatePassword(newPwd, currPwd || undefined);
                    setIsSavingPwd(false);
                    if (res.success) {
                      setCurrPwd('');
                      setNewPwd('');
                      setConfirmPwd('');
                      setPwdFeedback({ type: 'success', text: 'تم تحديث كلمة المرور بنجاح.' });
                    } else {
                      setPwdFeedback({ type: 'error', text: res.error || 'تعذر تغيير كلمة المرور.' });
                    }
                  }}
                  className="p-2 rounded-md bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#21375C] space-y-1.5"
                >
                  {pwdFeedback && (
                    <p className={`text-[11px] font-bold ${pwdFeedback.type === 'success' ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                      {pwdFeedback.text}
                    </p>
                  )}
                  <input
                    type="password"
                    required
                    value={currPwd}
                    onChange={(e) => setCurrPwd(e.target.value)}
                    placeholder="كلمة المرور الحالية"
                    className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] px-2 bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-500 dark:placeholder:text-[#8CA3C7] font-mono"
                  />
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    placeholder="كلمة المرور الجديدة"
                    className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] px-2 bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-500 dark:placeholder:text-[#8CA3C7] font-mono"
                  />
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    placeholder="تأكيد كلمة المرور الجديدة"
                    className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] px-2 bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-500 dark:placeholder:text-[#8CA3C7] font-mono"
                  />
                  <button
                    type="submit"
                    disabled={isSavingPwd}
                    className="w-full h-8 rounded-md bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] hover:bg-[var(--awlad-royal-600)] dark:hover:bg-[#1F6BE6] text-white font-black cursor-pointer disabled:opacity-50"
                  >
                    {isSavingPwd ? 'جاري التحديث...' : 'حفظ كلمة المرور'}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsSettingsModalOpen(false);
                  setIsServerModalOpen(true);
                }}
                className="w-full min-h-[34px] px-2.5 rounded-md bg-slate-50 dark:bg-[#132544] hover:bg-[#EEF3FA] dark:hover:bg-[#1A3461] border border-slate-200 dark:border-[#21375C] flex items-center justify-between font-bold text-slate-800 dark:text-[#F3F7FC] cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Server className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
                  <span>عنوان السيرفر والاتصال المركزي</span>
                </span>
                <ChevronLeft className="w-3.5 h-3.5 text-slate-400 dark:text-[#849BBF]" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSettingsModalOpen(false);
                  setIsSyncCenterOpen(true);
                }}
                className="w-full min-h-[34px] px-2.5 rounded-md bg-slate-50 dark:bg-[#132544] hover:bg-[#EEF3FA] dark:hover:bg-[#1A3461] border border-slate-200 dark:border-[#21375C] flex items-center justify-between font-bold text-slate-800 dark:text-[#F3F7FC] cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <CloudOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>مركز المزامنة والعمليات المعلقة</span>
                </span>
                <span className="font-mono font-black text-slate-800 dark:text-[#F3F7FC] tabular-nums">
                  {syncBadgeCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSettingsModalOpen(false);
                  data.triggerManualSync();
                }}
                className="w-full min-h-[34px] px-2.5 rounded-md bg-[var(--awlad-navy-900)] dark:bg-[#1659C8] hover:bg-[var(--awlad-navy-950)] dark:hover:bg-[#1F6BE6] text-white flex items-center justify-center gap-1.5 font-black cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${data.networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
                <span>مزامنة البيانات الآن</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSettingsModalOpen(false);
                  logout();
                }}
                className="w-full min-h-[34px] px-2.5 rounded-md bg-red-50 dark:bg-red-500/15 hover:bg-red-100 dark:hover:bg-red-500/25 border border-red-200 dark:border-red-500/35 text-red-700 dark:text-red-300 flex items-center justify-center gap-1.5 font-black cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>تسجيل الخروج من الحساب</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

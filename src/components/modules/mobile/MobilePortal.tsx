import React, { useState, useEffect } from 'react';
import {
  Bell,
  CloudOff,
  LogOut,
  RefreshCw,
  Server,
  ShieldAlert,
  WifiOff,
  LayoutGrid,
  Home,
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
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
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
  } = useAuth();
  const data = useData();
  const isRep = currentUser?.role === 'representative';
  const hideSectionsNav = isMobileAppPlatform();

  const [customerTab, setCustomerTab] = useState<CustomerTabKey>('home');
  const [repTab, setRepTab] = useState<RepTabKey>('home');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isSyncCenterOpen, setIsSyncCenterOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [hasUnsavedRepInvoice, setHasUnsavedRepInvoice] = useState(false);
  const [pendingRepTab, setPendingRepTab] = useState<RepTabKey | null>(null);

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
      if (item.targetTab === 'account' || item.targetTab === 'orders' || item.targetTab === 'catalog' || item.targetTab === 'cart') {
        setCustomerTab(item.targetTab);
      } else {
        setCustomerTab('orders');
      }
    }
  };

  // Top Blue Bar navigation items + Drawer full destinations (zero bottom navigation bar)
  const topQuickButtons = isRep
    ? [
        { key: 'home' as const, label: 'الرئيسية', icon: Home, active: repTab === 'home', onSelect: () => requestRepTabChange('home') },
        { key: 'cash' as const, label: 'النقدية', icon: Receipt, active: repTab === 'cash', onSelect: () => requestRepTabChange('cash') },
        { key: 'custody' as const, label: 'العهدة', icon: ArrowLeftRight, active: repTab === 'custody', onSelect: () => requestRepTabChange('custody') },
        { key: 'more' as const, label: 'المزيد', icon: LayoutGrid, active: repTab === 'more', onSelect: () => requestRepTabChange('more') },
      ]
    : [
        { key: 'home' as const, label: 'الرئيسية', icon: Home, active: customerTab === 'home', onSelect: () => setCustomerTab('home') },
        { key: 'catalog' as const, label: 'الكتالوج', icon: Package, active: customerTab === 'catalog', onSelect: () => setCustomerTab('catalog') },
        { key: 'account' as const, label: 'فواتيري', icon: Receipt, active: customerTab === 'account', onSelect: () => setCustomerTab('account') },
        { key: 'cart' as const, label: 'الطلبات', icon: ShoppingCart, active: customerTab === 'cart' || customerTab === 'orders', onSelect: () => setCustomerTab('orders') },
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
          ? [{ key: 'purchases-list', label: 'فواتير الشراء', icon: Receipt, active: repTab === 'purchases-list', onSelect: () => requestRepTabChange('purchases-list') }]
          : []),
        { key: 'custody', label: 'المخزن والعهدة والتحويلات', icon: ArrowLeftRight, active: repTab === 'custody', onSelect: () => requestRepTabChange('custody') },
        { key: 'more', label: 'المزيد والإعدادات', icon: LayoutGrid, active: repTab === 'more', onSelect: () => requestRepTabChange('more') },
      ]
    : [
        { key: 'home', label: 'الرئيسية', icon: Home, active: customerTab === 'home', onSelect: () => setCustomerTab('home') },
        { key: 'catalog', label: 'كتالوج المنتجات', icon: Package, active: customerTab === 'catalog', onSelect: () => setCustomerTab('catalog') },
        { key: 'cart', label: 'سلة الطلبات', icon: ShoppingCart, active: customerTab === 'cart', onSelect: () => setCustomerTab('cart') },
        { key: 'orders', label: 'طلباتي الحالية', icon: ClipboardList, active: customerTab === 'orders', onSelect: () => setCustomerTab('orders') },
        { key: 'account', label: 'فواتيري وكشف الحساب', icon: Receipt, active: customerTab === 'account', onSelect: () => setCustomerTab('account') },
      ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans antialiased pb-6 pb-safe">
      {/* Top Blue Rectangle Header with Unified Navigation (Zero Bottom Nav Bar) */}
      <header className="sticky top-0 z-30 bg-gradient-to-l from-blue-950 via-blue-900 to-blue-950 text-white shadow-md border-b border-blue-800/80 pt-safe">
        <div className="max-w-5xl mx-auto px-3 sm:px-5">
          <div className="h-14 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="/awlad-selim-logo.png"
                alt="AWLAD SELIM"
                className="h-9 w-9 object-contain bg-white rounded-xl p-1 shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-sm font-black truncate leading-tight">AWLAD SELIM</h1>
                <p className="text-[10px] text-blue-200 truncate">
                  {isRep ? 'بوابة المندوب' : 'بوابة العميل'} · {currentUser?.fullName}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setIsSyncCenterOpen(true)}
                className={`relative min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-white cursor-pointer ${
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
                  <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">
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
                className="relative min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="الإشعارات"
                aria-label="الإشعارات"
              >
                <Bell className="w-4 h-4" />
                {data.unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center">
                    {data.unreadNotificationCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsServerModalOpen(true)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="عنوان السيرفر المركزي"
                aria-label="إعدادات السيرفر"
              >
                <Server className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => data.triggerManualSync()}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="تحديث ومزامنة"
                aria-label="تحديث ومزامنة"
              >
                <RefreshCw className={`w-4 h-4 ${data.networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(true)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="الإعدادات"
                aria-label="الإعدادات"
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={logout}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-red-600/90 hover:bg-red-700 text-white cursor-pointer"
                title="تسجيل الخروج"
                aria-label="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Top Blue Navigation Strip (Ordered Right-to-Left; الأقسام hidden ONLY on Android/iOS) */}
          <nav
            aria-label="التنقل الرئيسي"
            className={`border-t border-white/15 py-1.5 grid ${hideSectionsNav ? 'grid-cols-4' : 'grid-cols-5'} gap-1`}
          >
            {!hideSectionsNav && (
              <button
                type="button"
                onClick={() => setIsDrawerOpen((prev) => !prev)}
                aria-expanded={isDrawerOpen}
                className={`min-h-[42px] px-1 py-1.5 rounded-xl flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 text-[11px] sm:text-xs whitespace-nowrap transition-all cursor-pointer ${
                  isDrawerOpen
                    ? 'bg-white text-blue-950 font-black shadow-sm'
                    : 'bg-white/10 text-blue-50 hover:bg-white/20 font-bold'
                }`}
              >
                <LayoutGrid className="w-4 h-4 shrink-0" />
                <span className="leading-none truncate max-w-full">الأقسام</span>
              </button>
            )}

            {topQuickButtons.map((btn) => {
              const Icon = btn.icon;
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={btn.onSelect}
                  aria-current={btn.active ? 'page' : undefined}
                  className={`min-h-[42px] px-1 py-1.5 rounded-xl flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 text-[11px] sm:text-xs whitespace-nowrap transition-all cursor-pointer ${
                    btn.active
                      ? 'bg-white text-blue-950 font-black shadow-sm'
                      : 'bg-white/10 text-blue-50 hover:bg-white/20 font-bold'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="leading-none truncate max-w-full">{btn.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Soft-Gradient Sliding Sections Drawer (Windows/Web only) */}
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
        className={`fixed top-0 bottom-0 right-0 z-50 w-[82vw] max-w-[320px] bg-gradient-to-b from-white via-sky-50/60 to-indigo-50/75 text-slate-800 border-l border-blue-200/80 shadow-2xl transition-transform duration-300 ease-out flex flex-col pt-safe pb-safe ${
          isDrawerOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
        }`}
      >
        <div className="h-16 flex items-center justify-between px-4 bg-gradient-to-l from-blue-950 via-blue-900 to-indigo-900 text-white border-b border-blue-800/60 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/awlad-selim-logo.png"
              alt="AWLAD SELIM"
              className="h-9 w-9 object-contain bg-white rounded-xl p-1 shrink-0"
            />
            <div className="min-w-0">
              <span className="block text-sm font-black truncate">أقسام البوابة</span>
              <span className="block text-[10px] text-blue-200 truncate">
                {isRep ? 'بوابة المندوب' : 'بوابة العميل'} · {currentUser?.fullName}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsDrawerOpen(false)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 text-white cursor-pointer shrink-0"
            aria-label="إغلاق القائمة الجانبية"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-2">
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
                className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-2 text-xs border transition-all cursor-pointer ${
                  item.active
                    ? 'bg-gradient-to-l from-blue-600 to-indigo-600 text-white border-blue-600 font-black shadow-sm'
                    : 'bg-white/90 text-slate-800 border-blue-100 hover:bg-blue-50/70 font-bold'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </div>
                <ChevronLeft className={`w-4 h-4 shrink-0 ${item.active ? 'text-blue-100' : 'text-slate-400'}`} />
              </button>
            );
          })}
        </div>
      </aside>
      )}

      <main className="max-w-5xl mx-auto p-3.5 space-y-3.5">
        {linkWarning && (
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900">
            {linkWarning}
          </div>
        )}

        {(isDatabaseUnavailable || (data.networkStatus === 'error' && data.lastError)) && (
          <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-800 flex items-center justify-between gap-2">
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
              className="px-3 py-1.5 rounded-xl bg-red-600 text-white text-[11px] font-bold shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {data.isSyncing ? 'جاري الفحص...' : 'إعادة المحاولة'}
            </button>
          </div>
        )}

        {!isDatabaseUnavailable && (isOfflineSession || permissionsMayBeStale) && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              وضع الدخول المحلي الموثق — يتم تطبيق آخر صلاحيات موثقة من السيرفر وقد تتحدث فور عودة الاتصال.
            </span>
          </div>
        )}

        {!isDatabaseUnavailable &&
          data.networkStatus !== 'error' &&
          (data.isUsingOfflineCache || data.networkStatus === 'disconnected') && (
            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-center justify-between gap-2">
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
                className="px-3 py-1.5 rounded-xl bg-amber-600 text-white text-[11px] font-bold shrink-0 cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

        {(data.pendingSyncCount > 0 || data.conflictsCount > 0) && (
          <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200 text-xs font-bold text-blue-900 flex items-center justify-between gap-2">
            <span>
              {data.conflictsCount > 0
                ? `توجد (${data.conflictsCount}) تعارضات مزامنة تحتاج مراجعة و(${data.pendingSyncCount}) عمليات محلية بانتظار الاعتماد المركزي.`
                : `توجد (${data.pendingSyncCount}) عمليات محلية بانتظار المزامنة (الأرصدة الحالية مبدئية لحين الاعتماد المركزي).`}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsSyncCenterOpen(true)}
                className="px-2.5 py-1.5 rounded-xl bg-white border border-blue-300 text-blue-900 text-[11px] font-bold cursor-pointer"
              >
                مركز المزامنة
              </button>
              <button
                type="button"
                onClick={() => data.triggerManualSync()}
                className="px-3 py-1.5 rounded-xl bg-blue-900 text-white text-[11px] font-bold cursor-pointer"
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
          <CustomerPortal activeTab={customerTab} onTabChange={setCustomerTab} />
        )}
      </main>

      {pendingRepTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-3 text-xs">
            <div className="flex items-center gap-2 font-black text-sm text-amber-800">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>توجد أصناف غير محفوظة في الفاتورة</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              توجد أصناف مضافة في شاشة فاتورة البيع لم تُحفظ بعد. هل تود البقاء لإكمال الفاتورة أم الانتقال مع الاحتفاظ بالبيانات مؤقتاً؟
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingRepTab(null)}
                className="min-h-[44px] rounded-xl bg-blue-900 text-white font-black cursor-pointer"
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
                className="min-h-[44px] rounded-xl bg-slate-100 text-slate-800 font-bold cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-800 flex items-center justify-center">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-900">إعدادات التطبيق والحساب</h3>
                  <p className="text-[11px] text-slate-500">
                    {isRep ? 'بوابة المندوب' : 'بوابة العميل'} · {currentUser?.fullName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="min-h-[36px] min-w-[36px] rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setIsSettingsModalOpen(false);
                  setIsServerModalOpen(true);
                }}
                className="w-full min-h-[44px] px-3.5 rounded-2xl bg-slate-50 hover:bg-blue-50 border border-slate-200 flex items-center justify-between font-bold text-slate-800 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-700" />
                  <span>عنوان السيرفر والاتصال المركزي</span>
                </span>
                <ChevronLeft className="w-4 h-4 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSettingsModalOpen(false);
                  setIsSyncCenterOpen(true);
                }}
                className="w-full min-h-[44px] px-3.5 rounded-2xl bg-slate-50 hover:bg-blue-50 border border-slate-200 flex items-center justify-between font-bold text-slate-800 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <CloudOff className="w-4 h-4 text-amber-600" />
                  <span>مركز المزامنة والعمليات المعلقة</span>
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-slate-200 text-slate-800 text-[10px] font-black">
                  {syncBadgeCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSettingsModalOpen(false);
                  data.triggerManualSync();
                }}
                className="w-full min-h-[44px] px-3.5 rounded-2xl bg-blue-900 hover:bg-blue-950 text-white flex items-center justify-center gap-2 font-black cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${data.networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
                <span>مزامنة البيانات الآن</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSettingsModalOpen(false);
                  logout();
                }}
                className="w-full min-h-[44px] px-3.5 rounded-2xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 flex items-center justify-center gap-2 font-black cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>تسجيل الخروج من الحساب</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

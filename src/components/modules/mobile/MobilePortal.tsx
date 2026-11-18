import React, { useState, useEffect } from 'react';
import {
  Bell,
  LogOut,
  RefreshCw,
  Server,
  WifiOff,
  Home,
  Package,
  ShoppingCart,
  ClipboardList,
  Receipt,
  Users,
  FilePlus2,
  FileText,
  ArrowLeftRight,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { registerAndroidBackButton } from '../../../services/native';
import { MobileNotificationItem } from '../../../types';
import { UI_CLASSES } from '../../../styles/designSystem';
import { CustomerPortal, CustomerTabKey } from './CustomerPortal';
import { RepPortal, RepTabKey } from './RepPortal';
import { MobileNotificationsSheet } from './MobileNotificationsSheet';
import { MobileServerModal } from './MobileServerModal';
import { SyncCenterModal } from '../../common/SyncCenterModal';

export const MobilePortal: React.FC = () => {
  const { currentUser, linkWarning, logout, refreshAuthContext, isOfflineSession, permissionsMayBeStale } = useAuth();
  const data = useData();
  const isRep = currentUser?.role === 'representative';

  const [customerTab, setCustomerTab] = useState<CustomerTabKey>('home');
  const [customerCartCount, setCustomerCartCount] = useState(0);
  const [repTab, setRepTab] = useState<RepTabKey>('home');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isSyncCenterOpen, setIsSyncCenterOpen] = useState(false);

  // Android hardware back button handling: close modals first, else return to home tab
  useEffect(() => {
    return registerAndroidBackButton(() => {
      if (isNotificationsOpen) {
        setIsNotificationsOpen(false);
        return true;
      }
      if (isServerModalOpen) {
        setIsServerModalOpen(false);
        return true;
      }
      if (isSyncCenterOpen) {
        setIsSyncCenterOpen(false);
        return true;
      }
      if (isRep && repTab !== 'home') {
        setRepTab('home');
        return true;
      }
      if (!isRep && customerTab !== 'home') {
        setCustomerTab('home');
        return true;
      }
      return false;
    });
  }, [isNotificationsOpen, isServerModalOpen, isSyncCenterOpen, isRep, repTab, customerTab]);

  const handleSelectNotification = (item: MobileNotificationItem) => {
    if (isRep) {
      if (item.targetTab === 'custody' || item.targetTab === 'invoices' || item.targetTab === 'customers' || item.targetTab === 'new-invoice') {
        setRepTab(item.targetTab);
      } else {
        setRepTab('home');
      }
    } else {
      if (item.targetTab === 'account' || item.targetTab === 'orders' || item.targetTab === 'catalog' || item.targetTab === 'cart') {
        setCustomerTab(item.targetTab);
      } else {
        setCustomerTab('orders');
      }
    }
  };

  const portalNavTabs = isRep
    ? [
        { key: 'home' as const, label: 'الرئيسية', icon: Home, active: repTab === 'home', onClick: () => setRepTab('home') },
        { key: 'customers' as const, label: 'عملائي', icon: Users, active: repTab === 'customers', onClick: () => setRepTab('customers') },
        { key: 'new-invoice' as const, label: 'فاتورة بيع', icon: FilePlus2, active: repTab === 'new-invoice', onClick: () => setRepTab('new-invoice') },
        { key: 'invoices' as const, label: 'الفواتير', icon: FileText, active: repTab === 'invoices', onClick: () => setRepTab('invoices') },
        { key: 'custody' as const, label: 'العهدة', icon: ArrowLeftRight, active: repTab === 'custody', onClick: () => setRepTab('custody') },
      ]
    : [
        { key: 'home' as const, label: 'الرئيسية', icon: Home, active: customerTab === 'home', onClick: () => setCustomerTab('home') },
        { key: 'catalog' as const, label: 'الكتالوج', icon: Package, active: customerTab === 'catalog', onClick: () => setCustomerTab('catalog') },
        {
          key: 'cart' as const,
          label: customerCartCount > 0 ? `السلة (${customerCartCount})` : 'السلة',
          icon: ShoppingCart,
          active: customerTab === 'cart',
          onClick: () => setCustomerTab('cart'),
        },
        { key: 'orders' as const, label: 'طلباتي', icon: ClipboardList, active: customerTab === 'orders', onClick: () => setCustomerTab('orders') },
        { key: 'account' as const, label: 'فواتيري', icon: Receipt, active: customerTab === 'account', onClick: () => setCustomerTab('account') },
      ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans antialiased pb-6 pb-safe">
      {/* Unified Blue Top Header with Integrated Portal Navigation */}
      <header className={UI_CLASSES.blueHeaderBar}>
        <div className="max-w-6xl mx-auto px-2.5 sm:px-5">
          <div className="h-14 flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2.5 min-w-0 shrink">
              <img
                src="/awlad-selim-logo.png"
                alt="AWLAD SELIM"
                className="h-9 w-9 object-contain bg-white rounded-xl p-1 shrink-0 shadow-xs"
              />
              <div className="min-w-0">
                <h1 className="text-xs sm:text-sm font-black truncate leading-tight">AWLAD SELIM</h1>
                <p className="text-[10px] text-blue-200 truncate">
                  {isRep ? 'بوابة المندوب' : 'بوابة العميل'} · {currentUser?.fullName}
                </p>
              </div>
            </div>

            {/* Desktop inline navigation tabs */}
            <nav aria-label="التنقل الرئيسي" className="hidden lg:flex items-center gap-1.5 flex-1 justify-center">
              {portalNavTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={tab.onClick}
                    aria-current={tab.active ? 'page' : undefined}
                    className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                      tab.active
                        ? 'bg-gradient-to-l from-white via-blue-50 to-indigo-50 text-blue-950 font-black shadow-sm ring-1 ring-white/70'
                        : 'text-blue-100 hover:bg-white/12 hover:text-white font-bold'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsNotificationsOpen(true);
                  data.markNotificationsRead();
                }}
                className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="الإشعارات"
                aria-label="الإشعارات"
              >
                <Bell className="w-4 h-4" />
                {data.unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center">
                    {data.unreadNotificationCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsServerModalOpen(true)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="عنوان السيرفر المركزي"
                aria-label="إعدادات السيرفر"
              >
                <Server className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsSyncCenterOpen(true)}
                className="relative min-h-[40px] min-w-[40px] px-2 flex items-center justify-center gap-1 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="مركز المزامنة"
                aria-label="مركز المزامنة"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    data.networkStatus === 'connected'
                      ? 'bg-emerald-400'
                      : data.networkStatus === 'synchronizing'
                      ? 'bg-sky-400 animate-pulse'
                      : 'bg-amber-400'
                  }`}
                />
                {(data.pendingSyncCount + data.failedSyncCount + data.conflictsCount) > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black flex items-center justify-center">
                    {data.pendingSyncCount + data.failedSyncCount + data.conflictsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => data.triggerManualSync()}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="تحديث ومزامنة"
                aria-label="تحديث ومزامنة"
              >
                <RefreshCw className={`w-4 h-4 ${data.networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={logout}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-red-600/90 hover:bg-red-700 text-white cursor-pointer"
                title="تسجيل الخروج"
                aria-label="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mobile & Tablet (< lg) Navigation Strip inside the Blue Top Header */}
          <nav
            aria-label="أزرار التنقل الرئيسية"
            className="lg:hidden border-t border-white/15 py-1.5 flex items-center justify-between gap-1 sm:gap-1.5"
          >
            {portalNavTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={tab.onClick}
                  aria-current={tab.active ? 'page' : undefined}
                  className={`flex-1 sm:flex-initial min-h-[40px] px-1.5 sm:px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                    tab.active
                      ? 'bg-gradient-to-l from-white via-blue-50 to-indigo-50 text-blue-950 font-black shadow-sm ring-1 ring-white/70'
                      : 'text-blue-100 hover:bg-white/12 hover:text-white font-bold'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-3.5 space-y-3.5">
        {linkWarning && (
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900">
            {linkWarning}
          </div>
        )}

        {(data.isUsingOfflineCache || data.networkStatus === 'disconnected') && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                {isOfflineSession
                  ? 'وضع العمل بدون إنترنت — يتم حفظ الطلبات والعمليات محلياً لمزامنتها تلقائياً'
                  : 'بيانات مخزنة محلياً — تعذر الاتصال بسيرفر المحل'}
                {permissionsMayBeStale ? ' · الصلاحيات محفوظة من آخر تحقق' : ''}
                {data.lastCacheTimestamp ? ` · آخر مزامنة: ${new Date(data.lastCacheTimestamp).toLocaleTimeString('ar-EG')}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsSyncCenterOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-900 text-[11px] font-bold cursor-pointer"
              >
                مركز المزامنة
              </button>
              <button
                type="button"
                onClick={() => data.triggerManualSync()}
                className="px-3 py-1.5 rounded-xl bg-amber-600 text-white text-[11px] font-bold cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </div>
          </div>
        )}

        {(data.offlineOrdersCount > 0 || data.pendingSyncCount > 0 || data.conflictsCount > 0) && (
          <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200 text-xs font-bold text-blue-900 flex flex-wrap items-center justify-between gap-2">
            <span>
              {data.conflictsCount > 0
                ? `يوجد (${data.conflictsCount}) تعارضات بانتظار المراجعة.`
                : `يوجد (${Math.max(data.offlineOrdersCount, data.pendingSyncCount)}) عمليات بانتظار المزامنة التلقائية فور عودة الشبكة (الأرصدة المحلية تقديرية حتى تأكيد السيرفر).`}
            </span>
            <button
              type="button"
              onClick={() => setIsSyncCenterOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-blue-900 text-white text-[11px] font-bold shrink-0 cursor-pointer"
            >
              فتح مركز المزامنة
            </button>
          </div>
        )}

        {isRep ? (
          <RepPortal activeTab={repTab} onTabChange={setRepTab} />
        ) : (
          <CustomerPortal
            activeTab={customerTab}
            onTabChange={setCustomerTab}
            onCartCountChange={setCustomerCartCount}
          />
        )}
      </main>

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

      <SyncCenterModal
        isOpen={isSyncCenterOpen}
        onClose={() => setIsSyncCenterOpen(false)}
      />
    </div>
  );
};

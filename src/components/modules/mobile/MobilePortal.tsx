import React, { useState, useEffect } from 'react';
import { Bell, LogOut, RefreshCw, Server, WifiOff } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { registerAndroidBackButton } from '../../../services/native';
import { MobileNotificationItem } from '../../../types';
import { CustomerPortal, CustomerTabKey } from './CustomerPortal';
import { RepPortal, RepTabKey } from './RepPortal';
import { MobileNotificationsSheet } from './MobileNotificationsSheet';
import { MobileServerModal } from './MobileServerModal';

export const MobilePortal: React.FC = () => {
  const { currentUser, linkWarning, logout, refreshAuthContext } = useAuth();
  const data = useData();
  const isRep = currentUser?.role === 'representative';

  const [customerTab, setCustomerTab] = useState<CustomerTabKey>('home');
  const [repTab, setRepTab] = useState<RepTabKey>('home');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);

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
  }, [isNotificationsOpen, isServerModalOpen, isRep, repTab, customerTab]);

  const handleSelectNotification = (item: MobileNotificationItem) => {
    if (isRep) {
      if (
        item.targetTab === 'custody' ||
        item.targetTab === 'invoices' ||
        item.targetTab === 'customers' ||
        item.targetTab === 'new-invoice' ||
        item.targetTab === 'orders'
      ) {
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

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-['Cairo'] pb-24">
      {/* Slim Top App Header (strictly compact mobile chrome) */}
      <header className="sticky top-0 z-30 bg-blue-950 text-white shadow-sm pt-safe">
        <div className="max-w-5xl mx-auto px-3.5 h-14 flex items-center justify-between gap-2">
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
              onClick={() => {
                setIsNotificationsOpen(true);
                data.markNotificationsRead();
              }}
              className="relative min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
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
              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              title="عنوان السيرفر المركزي"
              aria-label="إعدادات السيرفر"
            >
              <Server className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => data.triggerManualSync()}
              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              title="تحديث ومزامنة"
              aria-label="تحديث ومزامنة"
            >
              <RefreshCw className={`w-4 h-4 ${data.networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={logout}
              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-red-600/90 hover:bg-red-700 text-white cursor-pointer"
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-3.5 space-y-3.5">
        {linkWarning && (
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900">
            {linkWarning}
          </div>
        )}

        {(data.isUsingOfflineCache || data.networkStatus === 'disconnected') && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                بيانات مخزنة مؤقتاً (للقراءة فقط) — تعذر الاتصال بسيرفر المحل
                {data.lastCacheTimestamp ? ` · آخر مزامنة: ${new Date(data.lastCacheTimestamp).toLocaleTimeString('ar-EG')}` : ''}
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

        {data.offlineOrdersCount > 0 && (
          <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200 text-xs font-bold text-blue-900 flex items-center justify-between gap-2">
            <span>يوجد ({data.offlineOrdersCount}) طلبات بانتظار المزامنة التلقائية فور عودة الشبكة.</span>
            <button
              type="button"
              onClick={() => data.triggerManualSync()}
              className="px-3 py-1.5 rounded-xl bg-blue-900 text-white text-[11px] font-bold shrink-0 cursor-pointer"
            >
              مزامنة الآن
            </button>
          </div>
        )}

        {isRep ? (
          <RepPortal activeTab={repTab} onTabChange={setRepTab} />
        ) : (
          <CustomerPortal activeTab={customerTab} onTabChange={setCustomerTab} />
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
    </div>
  );
};

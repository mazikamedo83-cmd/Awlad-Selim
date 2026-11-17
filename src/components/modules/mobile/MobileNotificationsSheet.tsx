import React from 'react';
import { Bell, CheckCheck, X, ArrowLeft } from 'lucide-react';
import { MobileNotificationItem } from '../../../types';

interface MobileNotificationsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: MobileNotificationItem[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onSelectNotification: (item: MobileNotificationItem) => void;
}

export const MobileNotificationsSheet: React.FC<MobileNotificationsSheetProps> = ({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  onMarkAllRead,
  onSelectNotification,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 max-h-[82vh] flex flex-col overflow-hidden pb-safe">
        <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 sm:hidden" />

        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-900" />
            <h3 className="text-sm font-black text-slate-900">
              التنبيهات والإشعارات {unreadCount > 0 ? `(${unreadCount})` : ''}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="min-h-[40px] px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                <span>تحديد الكل كمقروء</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="p-10 text-center space-y-2 text-slate-500 text-xs">
              <Bell className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="font-bold text-slate-700">لا توجد إشعارات جديدة حالياً</p>
              <p>تظهر هنا تحديثات الطلبات والفواتير والتحويلات المخزنية والنقدية فور حدوثها.</p>
            </div>
          ) : (
            notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectNotification(item);
                  onClose();
                }}
                className="w-full text-right p-4 hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-start justify-between gap-3 cursor-pointer"
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-black text-slate-900">{item.title}</span>
                    {item.referenceNumber && (
                      <span className="font-mono text-[11px] text-blue-800">
                        · {item.referenceNumber}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{item.body}</p>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {new Date(item.createdAt).toLocaleString('ar-EG')}
                  </p>
                </div>
                <ArrowLeft className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

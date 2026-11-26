import React, { useEffect } from 'react';
import { Bell, CheckCheck, X, ArrowLeft, ArrowRight } from 'lucide-react';
import { MobileNotificationItem } from '../../../types';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime, formatLocaleNumber } from '../../../i18n/translator';

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
  const { t, dir, isRtl } = usePreferences();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const NavArrow = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div
      dir={dir}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-[#0E1C36] rounded-t-xl sm:rounded-xl shadow-2xl border border-slate-200 dark:border-[#21375C] max-h-[82vh] flex flex-col overflow-hidden pb-safe"
      >
        <div className="w-9 h-1 bg-slate-300 rounded-full mx-auto mt-2 mb-0.5 sm:hidden" />

        <div className="flex items-center justify-between px-2.5 py-2 border-b border-slate-200">
          <div className="flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-blue-900" />
            <h3 className="text-xs font-black text-slate-900">
              {t('التنبيهات والإشعارات', 'Alerts & Notifications')} {unreadCount > 0 ? `(${formatLocaleNumber(unreadCount)})` : ''}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="h-8 px-2 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-900 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>{t('تحديد الكل كمقروء', 'Mark All Read')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer"
              aria-label={t('إغلاق', 'Close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="p-3 text-center space-y-1 text-slate-500 text-xs">
              <Bell className="w-6 h-6 text-slate-300 mx-auto" />
              <p className="font-bold text-slate-700">{t('لا توجد إشعارات جديدة حالياً', 'No new notifications at the moment')}</p>
              <p>{t('تظهر هنا تحديثات الطلبات والفواتير والتحويلات المخزنية والنقدية فور حدوثها.', 'Order, invoice, stock transfer, and cash updates appear here as they happen.')}</p>
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
                className="w-full text-start px-2.5 py-2 hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-start justify-between gap-2 cursor-pointer"
              >
                <div className="space-y-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-black text-slate-900">{t(item.title)}</span>
                    {item.referenceNumber && (
                      <span className="font-mono text-[11px] text-blue-800">
                        · {item.referenceNumber}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-snug">{t(item.body)}</p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {formatLocaleDateTime(item.createdAt)}
                  </p>
                </div>
                <NavArrow className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

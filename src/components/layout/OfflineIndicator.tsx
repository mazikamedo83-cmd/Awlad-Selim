import React, { useState } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { SyncCenterModal } from '../common/SyncCenterModal';

interface OfflineIndicatorProps {
  variant?: 'light' | 'dark';
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ variant = 'light' }) => {
  const { isOfflineSession, permissionsMayBeStale, isDatabaseUnavailable } = useAuth();
  const {
    networkStatus,
    pendingSyncCount,
    conflictsCount,
    lastSyncTime,
    lastError,
    hasTentativeLocalBalances,
    triggerSync,
  } = useData();
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  const isDark = variant === 'dark';

  const getStatusConfig = () => {
    if (conflictsCount > 0) {
      return {
        icon: AlertTriangle,
        color: isDark
          ? 'text-amber-100 bg-amber-500/25 border-amber-300/40'
          : 'text-amber-700 bg-amber-500/10 border-amber-500/30',
        dot: 'bg-amber-400',
        label: `تعارض يحتاج مراجعة (${conflictsCount})`,
      };
    }
    switch (networkStatus) {
      case 'connected':
        return {
          icon: Wifi,
          color: isDark
            ? 'text-emerald-100 bg-emerald-500/20 border-emerald-300/35'
            : 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
          dot: 'bg-emerald-400',
          label: 'متصل بالشبكة المركزية',
        };
      case 'disconnected':
        return {
          icon: WifiOff,
          color: isDark
            ? 'text-rose-100 bg-rose-500/25 border-rose-300/40'
            : 'text-rose-600 bg-rose-500/10 border-rose-500/20',
          dot: 'bg-rose-400',
          label:
            pendingSyncCount > 0
              ? `عمل محلي دون إنترنت (${pendingSyncCount} معلقة)`
              : 'وضع العمل دون إنترنت (محلي)',
        };
      case 'synchronizing':
        return {
          icon: RefreshCw,
          color: isDark
            ? 'text-blue-100 bg-[#1659C8]/30 border-blue-300/40'
            : 'text-[#003589] bg-[#EEF3FA] border-[#DCE6F5]',
          dot: 'bg-blue-300 animate-ping',
          label: 'جاري مزامنة البيانات...',
        };
      case 'pending':
        return {
          icon: Clock,
          color: isDark
            ? 'text-amber-100 bg-amber-500/25 border-amber-300/40'
            : 'text-amber-600 bg-amber-500/10 border-amber-500/20',
          dot: 'bg-amber-400',
          label: `مزامنة معلقة (${pendingSyncCount})`,
        };
      case 'error':
      default:
        return {
          icon: AlertCircle,
          color: isDark
            ? 'text-rose-100 bg-rose-500/25 border-rose-300/40'
            : 'text-rose-600 bg-rose-500/10 border-rose-500/20',
          dot: 'bg-rose-400',
          label: isDatabaseUnavailable ? 'قاعدة البيانات غير متاحة مؤقتًا' : 'تعذر المزامنة مع السيرفر',
        };
    }
  };

  const config = getStatusConfig();
  const IconComponent = config.icon;
  const totalBadge = pendingSyncCount + conflictsCount;

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setIsSyncModalOpen(true)}
          title={`مركز المزامنة: ${config.label}${lastError ? ` | ${lastError}` : ''} | آخر فحص: ${lastSyncTime}${
            hasTentativeLocalBalances ? ' | توجد عمليات غير متزامنة (أرصدة محلية مبدئية)' : ''
          }`}
          className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-bold ${config.color} transition-all cursor-pointer hover:opacity-90 whitespace-nowrap`}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${config.dot}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dot}`}></span>
          </span>
          <IconComponent className={`w-3.5 h-3.5 shrink-0 ${networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
          <span className="hidden 2xl:inline">{config.label}</span>
          {totalBadge > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-slate-900 dark:bg-[#1659C8] text-white text-[10px] font-mono">
              {totalBadge}
            </span>
          )}
        </button>

        {!isDatabaseUnavailable && (isOfflineSession || permissionsMayBeStale) && (
          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            title="جلسة محلية موثقة — الصلاحيات المطبقة من آخر تحقق وقد تتحدث عند الاتصال"
            className="hidden xl:flex items-center gap-1 px-2 py-1 rounded-md bg-amber-400/20 border border-amber-300/40 text-amber-100 text-[10px] font-bold cursor-pointer whitespace-nowrap"
          >
            <ShieldAlert className="w-3 h-3 shrink-0" />
            <span>صلاحيات محلية</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => triggerSync(true)}
          title="تحديث ومزامنة فورية مع السيرفر المركزي"
          aria-label="تحديث ومزامنة"
          className={`min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md transition-colors cursor-pointer ${
            isDark
              ? 'bg-white/10 hover:bg-white/20 text-blue-100 hover:text-white'
              : 'p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <SyncCenterModal isOpen={isSyncModalOpen} onClose={() => setIsSyncModalOpen(false)} />
    </>
  );
};

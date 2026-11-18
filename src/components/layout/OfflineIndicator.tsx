import React, { useState } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { SyncCenterModal } from '../common/SyncCenterModal';

export const OfflineIndicator: React.FC = () => {
  const { isOfflineSession, permissionsMayBeStale } = useAuth();
  const {
    networkStatus,
    pendingSyncCount,
    conflictsCount,
    lastSyncTime,
    hasTentativeLocalBalances,
    triggerSync,
  } = useData();
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  const getStatusConfig = () => {
    if (conflictsCount > 0) {
      return {
        icon: AlertTriangle,
        color: 'text-orange-700 bg-orange-500/10 border-orange-500/30',
        dot: 'bg-orange-500',
        label: `تعارض يحتاج مراجعة (${conflictsCount})`,
      };
    }
    switch (networkStatus) {
      case 'connected':
        return {
          icon: Wifi,
          color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
          dot: 'bg-emerald-500',
          label: 'متصل بالشبكة المركزية',
        };
      case 'disconnected':
        return {
          icon: WifiOff,
          color: 'text-rose-600 bg-rose-500/10 border-rose-500/20',
          dot: 'bg-rose-500',
          label:
            pendingSyncCount > 0
              ? `عمل محلي دون إنترنت (${pendingSyncCount} معلقة)`
              : 'وضع العمل دون إنترنت (محلي)',
        };
      case 'synchronizing':
        return {
          icon: RefreshCw,
          color: 'text-blue-600 bg-blue-500/10 border-blue-500/20',
          dot: 'bg-blue-500 animate-ping',
          label: 'جاري مزامنة البيانات...',
        };
      case 'pending':
        return {
          icon: Clock,
          color: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
          dot: 'bg-amber-500',
          label: `مزامنة معلقة (${pendingSyncCount})`,
        };
      case 'error':
      default:
        return {
          icon: AlertCircle,
          color: 'text-rose-600 bg-rose-500/10 border-rose-500/20',
          dot: 'bg-rose-500',
          label: 'تعذر المزامنة مع السيرفر',
        };
    }
  };

  const config = getStatusConfig();
  const IconComponent = config.icon;
  const totalBadge = pendingSyncCount + conflictsCount;

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setIsSyncModalOpen(true)}
          title={`مركز المزامنة: ${config.label} | آخر فحص: ${lastSyncTime}${
            hasTentativeLocalBalances ? ' | توجد عمليات غير متزامنة (أرصدة محلية مبدئية)' : ''
          }`}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold ${config.color} transition-all cursor-pointer hover:opacity-90`}
        >
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${config.dot}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dot}`}></span>
          </span>
          <IconComponent className={`w-3.5 h-3.5 ${networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
          <span className="hidden md:inline">{config.label}</span>
          {totalBadge > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-mono">
              {totalBadge}
            </span>
          )}
        </button>

        {(isOfflineSession || permissionsMayBeStale) && (
          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            title="جلسة محلية موثقة — الصلاحيات المطبقة من آخر تحقق وقد تتحدث عند الاتصال"
            className="hidden xl:flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-800 text-[10px] font-bold cursor-pointer"
          >
            <ShieldAlert className="w-3 h-3 shrink-0" />
            <span>صلاحيات محلية</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => triggerSync(true)}
          title="تحديث ومزامنة فورية مع السيرفر المركزي"
          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${networkStatus === 'synchronizing' ? 'animate-spin text-blue-600' : ''}`} />
        </button>
      </div>

      <SyncCenterModal isOpen={isSyncModalOpen} onClose={() => setIsSyncModalOpen(false)} />
    </>
  );
};


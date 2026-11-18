import React from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { useData } from '../../context/DataContext';

export const OfflineIndicator: React.FC = () => {
  const { networkStatus, pendingChangesCount, lastSyncTime, triggerManualSync } = useData();

  const getStatusConfig = () => {
    switch (networkStatus) {
      case 'connected':
        return {
          icon: Wifi,
          color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
          dot: 'bg-emerald-500',
          label: 'متصل بالشبكة المركزية',
        };
      case 'disconnected':
        return {
          icon: WifiOff,
          color: 'text-rose-500 bg-rose-500/10 border-rose-500/20',
          dot: 'bg-rose-500',
          label: 'وضع العمل دون إنترنت (محلي)',
        };
      case 'synchronizing':
        return {
          icon: RefreshCw,
          color: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
          dot: 'bg-blue-500 animate-ping',
          label: 'جاري مزامنة البيانات...',
        };
      case 'pending':
        return {
          icon: Clock,
          color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
          dot: 'bg-amber-500',
          label: `مزامنة معلقة (${pendingChangesCount})`,
        };
      case 'error':
      default:
        return {
          icon: AlertCircle,
          color: 'text-rose-500 bg-rose-500/10 border-rose-500/20',
          dot: 'bg-rose-500',
          label: 'خطأ في المزامنة',
        };
    }
  };

  const config = getStatusConfig();
  const IconComponent = config.icon;

  return (
    <div className="flex items-center gap-2">
      {/* Network status indicator (status only, not a toggle) */}
      <div 
        title={`حالة الاتصال: ${config.label} | آخر فحص وتحديث: ${lastSyncTime}`}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${config.color} transition-all`}
      >
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${config.dot}`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dot}`}></span>
        </span>
        <IconComponent className={`w-3.5 h-3.5 ${networkStatus === 'synchronizing' ? 'animate-spin' : ''}`} />
        <span className="hidden md:inline">{config.label}</span>
      </div>

      {/* Manual refresh / sync trigger button */}
      <button
        onClick={triggerManualSync}
        title="تحديث والتحقق من المزامنة مع السيرفر المركزي"
        className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition-colors"
      >
        <RefreshCw className={`w-4 h-4 ${networkStatus === 'synchronizing' ? 'animate-spin text-blue-600' : ''}`} />
      </button>
    </div>
  );
};

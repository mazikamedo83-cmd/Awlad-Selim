import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { Modal } from './Modal';
import { useData } from '../../context/DataContext';

interface SyncCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncCenterModal: React.FC<SyncCenterModalProps> = ({ isOpen, onClose }) => {
  const {
    networkStatus,
    isSyncing,
    lastServerSyncAt,
    lastError,
    syncQueue,
    syncConflicts,
    pendingSyncCount,
    failedSyncCount,
    conflictsCount,
    triggerManualSync,
    resolveSyncConflict,
  } = useData();

  const [activeTab, setActiveTab] = useState<'queue' | 'conflicts'>(
    conflictsCount > 0 ? 'conflicts' : 'queue'
  );
  const [notesByConflict, setNotesByConflict] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const unresolvedConflicts = syncConflicts.filter((c) => c.status === 'needs_review');
  const resolvedConflicts = syncConflicts.filter((c) => c.status !== 'needs_review');

  const handleResolve = async (
    conflictId: string,
    action: 'keep_server' | 'apply_local' | 'dismiss'
  ) => {
    setResolvingId(conflictId);
    setActionMessage(null);
    const res = await resolveSyncConflict(conflictId, action, notesByConflict[conflictId] || '');
    setResolvingId(null);
    if (res.success) {
      setActionMessage({ type: 'ok', text: 'تمت معالجة التعارض وتحديث المزامنة بنجاح.' });
    } else {
      setActionMessage({ type: 'err', text: res.error || 'تعذر معالجة التعارض.' });
    }
  };

  const getQueueBadge = (status: string) => {
    switch (status) {
      case 'synced':
        return { label: 'تمت المزامنة', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 };
      case 'needs_review':
        return { label: 'تعارض للمراجعة', cls: 'bg-orange-50 text-orange-700 border-orange-200', icon: AlertTriangle };
      case 'failed':
        return { label: 'فشل مؤقت', cls: 'bg-red-50 text-red-700 border-red-200', icon: XCircle };
      default:
        return { label: 'بانتظار السيرفر', cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: Clock };
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="مركز المزامنة والعمل المحلي"
      subtitle="مراقبة العمليات المسجلة بدون إنترنت ومعالجة تعارضات السيرفر المركزي"
      maxWidth="4xl"
    >
      <div className="space-y-4 text-xs">
        {/* Connection Status Summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl border border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            {networkStatus === 'disconnected' ? (
              <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700">
                <WifiOff className="w-5 h-5" />
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-700">
                <Wifi className="w-5 h-5" />
              </div>
            )}
            <div>
              <p className="font-black text-slate-900">
                {networkStatus === 'connected'
                  ? 'متصل بالسيرفر المركزي'
                  : networkStatus === 'synchronizing'
                  ? 'جاري المزامنة مع السيرفر...'
                  : networkStatus === 'disconnected'
                  ? 'وضع العمل المحلي دون اتصال'
                  : 'توجد عمليات معلقة أو تعارضات'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                آخر مزامنة ناجحة:{' '}
                {lastServerSyncAt ? new Date(lastServerSyncAt).toLocaleString('ar-EG') : 'لم تتم بعد'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSyncing}
            onClick={() => triggerManualSync()}
            className="min-h-[40px] px-4 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold flex items-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'جاري المزامنة...' : 'مزامنة الآن'}</span>
          </button>
        </div>

        {lastError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-bold">
            {lastError}
          </div>
        )}

        {actionMessage && (
          <div
            className={`p-3 rounded-xl border font-bold ${
              actionMessage.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {actionMessage.text}
          </div>
        )}

        {/* Counters */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/70 text-center">
            <p className="text-[11px] text-amber-800 font-bold">معلقة بالانتظار</p>
            <p className="text-lg font-black text-amber-950 font-mono">{pendingSyncCount}</p>
          </div>
          <div className="p-3 rounded-xl border border-red-200 bg-red-50/70 text-center">
            <p className="text-[11px] text-red-800 font-bold">فشل إعادة الإرسال</p>
            <p className="text-lg font-black text-red-950 font-mono">{failedSyncCount}</p>
          </div>
          <div className="p-3 rounded-xl border border-orange-200 bg-orange-50/70 text-center">
            <p className="text-[11px] text-orange-800 font-bold">تعارضات للمراجعة</p>
            <p className="text-lg font-black text-orange-950 font-mono">{conflictsCount}</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 border-b border-slate-200 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`px-4 py-2 rounded-xl font-bold transition-colors cursor-pointer ${
              activeTab === 'queue'
                ? 'bg-blue-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            سجل العمليات المحلية ({syncQueue.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('conflicts')}
            className={`px-4 py-2 rounded-xl font-bold transition-colors cursor-pointer ${
              activeTab === 'conflicts'
                ? 'bg-orange-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            التعارضات ({unresolvedConflicts.length})
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'queue' ? (
          syncQueue.length === 0 ? (
            <div className="py-10 text-center text-slate-500 space-y-2">
              <Server className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="font-bold">لا توجد عمليات محلية معلقة حالياً.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
              {[...syncQueue]
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
                .map((op) => {
                  const badge = getQueueBadge(op.status);
                  const BadgeIcon = badge.icon;
                  return (
                    <div
                      key={op.operationId}
                      className="p-3 rounded-xl border border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <p className="font-black text-slate-900 truncate">{op.summaryAr}</p>
                        <p className="text-[11px] text-slate-500 font-mono">
                          {op.operationType} · {new Date(op.createdAt).toLocaleString('ar-EG')} · محاولات: {op.attempts}
                        </p>
                        {op.lastError && (
                          <p className="text-[11px] text-red-700 font-bold">{op.lastError}</p>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${badge.cls}`}
                      >
                        <BadgeIcon className="w-3.5 h-3.5" />
                        <span>{badge.label}</span>
                      </span>
                    </div>
                  );
                })}
            </div>
          )
        ) : syncConflicts.length === 0 ? (
          <div className="py-10 text-center text-slate-500 space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="font-bold">لا توجد تعارضات مزامنة مسجلة.</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
            {[...unresolvedConflicts, ...resolvedConflicts].map((cf) => {
              const isOpenConflict = cf.status === 'needs_review';
              return (
                <div
                  key={cf.id}
                  className={`p-3.5 rounded-2xl border space-y-2.5 ${
                    isOpenConflict ? 'border-orange-300 bg-orange-50/40' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-900">{cf.conflictReason}</p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {cf.operationType} · {cf.userName || 'مستخدم'} · {new Date(cf.createdAt).toLocaleString('ar-EG')}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700">
                      {isOpenConflict ? 'يحتاج قرار' : cf.status}
                    </span>
                  </div>

                  {isOpenConflict && (
                    <>
                      <input
                        type="text"
                        value={notesByConflict[cf.id] || ''}
                        onChange={(e) =>
                          setNotesByConflict((prev) => ({ ...prev, [cf.id]: e.target.value }))
                        }
                        placeholder="ملاحظة قرار المعالجة (اختياري)..."
                        className="w-full p-2 rounded-xl border border-slate-300 bg-white text-xs"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={resolvingId === cf.id}
                          onClick={() => handleResolve(cf.id, 'keep_server')}
                          className="px-3 py-1.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          اعتماد نسخة السيرفر
                        </button>
                        <button
                          type="button"
                          disabled={resolvingId === cf.id}
                          onClick={() => handleResolve(cf.id, 'apply_local')}
                          className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          تطبيق التعديل المحلي
                        </button>
                        <button
                          type="button"
                          disabled={resolvingId === cf.id}
                          onClick={() => handleResolve(cf.id, 'dismiss')}
                          className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold cursor-pointer disabled:opacity-50"
                        >
                          تجاهل
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};

import React, { useState } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  ShieldAlert,
  Wifi,
  WifiOff,
  Server,
  UploadCloud,
} from 'lucide-react';
import { Modal } from './Modal';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import type { SyncConflictRecord, SyncQueueStatus } from '../../types';

interface SyncCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncCenterModal: React.FC<SyncCenterModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, isOfflineSession, permissionsMayBeStale, lastVerifiedAt } = useAuth();
  const {
    syncQueue,
    syncConflicts,
    isServerReachable,
    isSyncing,
    pendingSyncCount,
    failedSyncCount,
    conflictsCount,
    hasTentativeLocalBalances,
    lastServerSyncAt,
    triggerSync,
    resolveSyncConflict,
  } = useData();

  const [activeTab, setActiveTab] = useState<'queue' | 'conflicts'>(
    conflictsCount > 0 ? 'conflicts' : 'queue'
  );
  const [resolutionNotesMap, setResolutionNotesMap] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canResolveConflicts =
    currentUser?.role === 'admin' ||
    Boolean(currentUser?.permissions?.canManageSales) ||
    Boolean(currentUser?.permissions?.canManageAccounts);

  const getQueueStatusBadge = (status: SyncQueueStatus) => {
    switch (status) {
      case 'local':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
            <Clock className="w-3 h-3" /> محلي
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-300">
            <Clock className="w-3 h-3" /> قيد الانتظار
          </span>
        );
      case 'syncing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-300">
            <RefreshCw className="w-3 h-3 animate-spin" /> جاري المزامنة
          </span>
        );
      case 'synced':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3" /> متزامن ومعتمد
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-300">
            <XCircle className="w-3 h-3" /> فشل المؤقت
          </span>
        );
      case 'needs_review':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-orange-50 text-orange-800 border border-orange-300">
            <AlertTriangle className="w-3 h-3" /> يحتاج مراجعة
          </span>
        );
    }
  };

  const handleResolve = async (
    conflict: SyncConflictRecord,
    action: 'keep_server' | 'apply_local' | 'dismiss'
  ) => {
    setFeedback(null);
    setResolvingId(conflict.id);
    const res = await resolveSyncConflict(
      conflict.id,
      action,
      resolutionNotesMap[conflict.id] || ''
    );
    setResolvingId(null);
    if (res.success) {
      setFeedback({ type: 'success', message: 'تمت معالجة التعارض وتحديث السيرفر بنجاح.' });
    } else {
      setFeedback({ type: 'error', message: res.error || 'تعذر معالجة التعارض' });
    }
  };

  const sortedQueue = [...syncQueue].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  const openConflicts = syncConflicts.filter((c) => c.status === 'needs_review');
  const resolvedConflicts = syncConflicts.filter((c) => c.status !== 'needs_review');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="مركز المزامنة وطابور العمليات دون إنترنت"
      subtitle="متابعة العمليات المحلية غير المتزامنة، وإعادة المحاولة، ومراجعة التعارضات بأمان تام"
      maxWidth="4xl"
    >
      <div className="space-y-4">
        {/* Status Summary & Immediate Sync Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-black border ${
                isServerReachable
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
            >
              {isServerReachable ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              <span>{isServerReachable ? 'السيرفر المركزي متاح' : 'العمل دون اتصال بالسيرفر'}</span>
            </div>

            <div className="text-xs text-slate-600 font-bold flex items-center gap-1.5">
              <Server className="w-4 h-4 text-slate-400" />
              <span>
                آخر مزامنة:{' '}
                {lastServerSyncAt
                  ? new Date(lastServerSyncAt).toLocaleString('ar-EG')
                  : 'لم تتم مزامنة كاملة بعد'}
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={isSyncing}
            onClick={() => triggerSync(true)}
            className="px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black flex items-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'جاري المزامنة...' : 'مزامنة فورية الآن'}</span>
          </button>
        </div>

        {/* Honest Warnings: Stale Permissions + Tentative Local Balances */}
        {(isOfflineSession || permissionsMayBeStale) && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <span>
                جلسة دخول محلية موثقة — الصلاحيات المطبقة مأخوذة من آخر تحقق ناجح
                {lastVerifiedAt ? ` (${new Date(lastVerifiedAt).toLocaleString('ar-EG')})` : ''}
                ، وقد تكون قد تغيرت على السيرفر. سيتم التحقق من الحساب وتحديث الصلاحيات تلقائياً عند عودة الاتصال.
              </span>
            </div>
          </div>
        )}

        {hasTentativeLocalBalances && (
          <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs font-bold text-blue-900 flex items-start gap-2">
            <UploadCloud className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <span>
              توجد ({pendingSyncCount}) عملية محلية لم تُعتمد مركزيًا بعد؛ جميع الأرصدة والحالات الناتجة عنها مبدئية ولا تُعد معتمدة رسمياً حتى إتمام المزامنة مع السيرفر المركزي.
            </span>
          </div>
        )}

        {feedback && (
          <div
            className={`p-3 rounded-xl border text-xs font-bold ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* Stats Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
            <p className="text-[11px] text-slate-500 font-bold">بانتظار المزامنة</p>
            <p className="text-lg font-black text-amber-700 mt-0.5">{pendingSyncCount}</p>
          </div>
          <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
            <p className="text-[11px] text-slate-500 font-bold">محاولات فاشلة</p>
            <p className="text-lg font-black text-rose-700 mt-0.5">{failedSyncCount}</p>
          </div>
          <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
            <p className="text-[11px] text-slate-500 font-bold">تعارضات تحتاج مراجعة</p>
            <p className="text-lg font-black text-orange-700 mt-0.5">{conflictsCount}</p>
          </div>
          <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
            <p className="text-[11px] text-slate-500 font-bold">إجمالي السجل المحلي</p>
            <p className="text-lg font-black text-slate-800 mt-0.5">{syncQueue.length}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-colors cursor-pointer ${
              activeTab === 'queue'
                ? 'bg-blue-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            طابور المزامنة ({syncQueue.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('conflicts')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'conflicts'
                ? 'bg-orange-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>تعارضات المزامنة (Needs Review)</span>
            {conflictsCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-white text-orange-700 text-[10px]">
                {conflictsCount}
              </span>
            )}
          </button>
        </div>

        {/* Queue Tab */}
        {activeTab === 'queue' && (
          <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
            {sortedQueue.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs font-bold bg-slate-50 rounded-2xl border border-slate-200">
                لا توجد عمليات في طابور المزامنة المحلي حالياً. جميع البيانات متزامنة مع السيرفر.
              </div>
            ) : (
              sortedQueue.map((item) => (
                <div
                  key={item.operationId}
                  className="p-3.5 rounded-xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {getQueueStatusBadge(item.status)}
                      <span className="text-xs font-black text-slate-900">{item.summaryAr}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap gap-3 font-medium">
                      <span className="font-mono">{item.operationId}</span>
                      <span>{new Date(item.createdAt).toLocaleString('ar-EG')}</span>
                      {item.attempts > 0 && <span>عدد المحاولات: {item.attempts}</span>}
                    </div>
                    {item.lastError && (
                      <p className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                        {item.lastError}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Conflicts Tab */}
        {activeTab === 'conflicts' && (
          <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
            {openConflicts.length === 0 && resolvedConflicts.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs font-bold bg-slate-50 rounded-2xl border border-slate-200">
                لا توجد تعارضات مزامنة مسجلة.
              </div>
            ) : (
              <>
                {openConflicts.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 rounded-2xl border-2 border-orange-300 bg-orange-50/40 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0" />
                        <span className="text-xs font-black text-slate-900">
                          تعارض في عملية ({c.operationType}) — {c.userName || c.userId}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">{c.id}</span>
                    </div>

                    <p className="text-xs font-bold text-orange-950 bg-white p-2.5 rounded-xl border border-orange-200">
                      سبب التعارض: {c.conflictReason}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                      <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
                        <p className="font-black text-blue-900">البيانات المرسلة من الجهاز (المحلية):</p>
                        <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-slate-700 max-h-36 overflow-y-auto dir-ltr text-left">
                          {JSON.stringify(c.localPayload, null, 2)}
                        </pre>
                      </div>
                      <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
                        <p className="font-black text-emerald-900">الحالة الحالية على السيرفر المركزي:</p>
                        <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-slate-700 max-h-36 overflow-y-auto dir-ltr text-left">
                          {JSON.stringify(c.serverSnapshot, null, 2)}
                        </pre>
                      </div>
                    </div>

                    {canResolveConflicts ? (
                      <div className="space-y-2 pt-1">
                        <input
                          type="text"
                          value={resolutionNotesMap[c.id] || ''}
                          onChange={(e) =>
                            setResolutionNotesMap((prev) => ({ ...prev, [c.id]: e.target.value }))
                          }
                          placeholder="ملاحظات المراجعة الإدارية (اختياري)..."
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={resolvingId === c.id}
                            onClick={() => handleResolve(c, 'keep_server')}
                            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            الاحتفاظ بنسخة السيرفر
                          </button>
                          <button
                            type="button"
                            disabled={resolvingId === c.id}
                            onClick={() => handleResolve(c, 'apply_local')}
                            className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            اعتماد النسخة المحلية
                          </button>
                          <button
                            type="button"
                            disabled={resolvingId === c.id}
                            onClick={() => handleResolve(c, 'dismiss')}
                            className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            تجاهل وإغلاق
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] font-bold text-slate-600">
                        يرجى مراجعة مدير النظام أو المسؤول المالي لاعتماد الحل المناسب لهذا التعارض.
                      </p>
                    )}
                  </div>
                ))}

                {resolvedConflicts.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-xs font-black text-slate-600">تعارضات تمت معالجتها سابقاً:</p>
                    {resolvedConflicts.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className="font-bold text-slate-800">{c.conflictReason}</span>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                          تمت المعالجة ({c.status})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

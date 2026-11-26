import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  Server,
  ShieldCheck,
  Upload,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { Modal } from './Modal';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { usePreferences } from '../../context/PreferencesContext';
import { formatLocaleDateTime } from '../../i18n/translator';
import { getConfiguredApiBaseUrl, getStoredInstallationId } from '../../services/api';
import { localDb } from '../../services/localDb';
import { saveAndShareDocument } from '../../services/native';
import { normalizeServerOrigin } from '../../services/offlineAuth';
import type { SyncQueueItem } from '../../types';

interface SyncCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncCenterModal: React.FC<SyncCenterModalProps> = ({ isOpen, onClose }) => {
  const { currentUser } = useAuth();
  const { t } = usePreferences();
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
  const [busyTransfer, setBusyTransfer] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const unresolvedConflicts = syncConflicts.filter((c) => c.status === 'needs_review');
  const resolvedConflicts = syncConflicts.filter((c) => c.status !== 'needs_review');
  const unsyncedOperations = syncQueue.filter((q) => q.status !== 'synced');
  const hasUnsyncedData = pendingSyncCount > 0 || failedSyncCount > 0 || conflictsCount > 0;

  const handleExportPendingOperations = async () => {
    if (!currentUser) return;
    setBusyTransfer(true);
    setActionMessage(null);
    try {
      const payload = {
        format: 'awlad_selim_pending_sync_v1',
        exportedAt: new Date().toISOString(),
        userId: currentUser.id,
        username: currentUser.username,
        serverOrigin: normalizeServerOrigin(getConfiguredApiBaseUrl()),
        installationId: getStoredInstallationId() || undefined,
        operations: unsyncedOperations,
        conflicts: unresolvedConflicts,
      };
      const stamp = new Date().toISOString().slice(0, 10);
      const res = await saveAndShareDocument({
        filename: `awlad-selim-pending-sync-${stamp}.json`,
        content: JSON.stringify(payload, null, 2),
        mimeType: 'application/json;charset=utf-8',
        title: t('نسخة احتياطية للعمليات المحلية غير المتزامنة - AWLAD SELIM', 'Unsynced Local Operations Backup - AWLAD SELIM'),
      });
      if (res.ok) {
        setActionMessage({
          type: 'ok',
          text: t(
            `تم تصدير (${unsyncedOperations.length}) عملية محلية احتياطياً. يمكنك استيرادها بعد التحديث إذا تعذرت المزامنة قبل حذف النسخة القديمة.`,
            `Exported (${unsyncedOperations.length}) local operations as backup. You can import them after updating if sync failed beforehand.`
          ),
        });
      } else {
        setActionMessage({ type: 'err', text: res.error || t('تعذر تصدير النسخة الاحتياطية.', 'Failed to export backup.') });
      }
    } finally {
      setBusyTransfer(false);
    }
  };

  const handleImportPendingOperations = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentUser) return;

    setBusyTransfer(true);
    setActionMessage(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      if (parsed?.format !== 'awlad_selim_pending_sync_v1' || !Array.isArray(parsed.operations)) {
        setActionMessage({ type: 'err', text: t('صيغة ملف العمليات المعلقة غير صالحة.', 'Invalid pending operations file format.') });
        return;
      }

      const currentIid = getStoredInstallationId();
      if (parsed.installationId && currentIid && parsed.installationId !== currentIid) {
        setActionMessage({
          type: 'err',
          text: t('هذا الملف يخص قاعدة بيانات شركة أخرى ولا يمكن استيراده هنا.', 'This file belongs to another company database and cannot be imported here.'),
        });
        return;
      }

      const sameOwner =
        parsed.userId === currentUser.id ||
        (parsed.username &&
          String(parsed.username).trim().toLowerCase() ===
            String(currentUser.username || '').trim().toLowerCase());
      if (!sameOwner) {
        setActionMessage({
          type: 'err',
          text: t('هذا الملف يخص حساب مستخدم آخر. يرجى تسجيل الدخول بنفس الحساب الأصلي أولاً.', 'This file belongs to another user account. Please sign in with the original account first.'),
        });
        return;
      }

      const existing = await localDb.listSyncQueue(currentUser.id);
      const existingIds = new Set(existing.map((op) => op.operationId));
      let importedCount = 0;

      for (const rawOp of parsed.operations as SyncQueueItem[]) {
        if (!rawOp?.operationId || !rawOp?.operationType || existingIds.has(rawOp.operationId)) {
          continue;
        }
        await localDb.putSyncOperation({
          ...rawOp,
          userId: currentUser.id,
          status: 'pending',
          nextRetryAt: undefined,
          updatedAt: new Date().toISOString(),
        });
        existingIds.add(rawOp.operationId);
        importedCount += 1;
      }

      await triggerManualSync();
      setActionMessage({
        type: 'ok',
        text:
          importedCount > 0
            ? t(`تم استيراد (${importedCount}) عملية محلية بأمان وبدء المزامنة.`, `Safely imported (${importedCount}) local operations and started sync.`)
            : t('جميع العمليات الموجودة في الملف مسجلة أو متزامنة بالفعل.', 'All operations in this file are already recorded or synced.'),
      });
    } catch {
      setActionMessage({ type: 'err', text: t('تعذر قراءة ملف العمليات الاحتياطي.', 'Failed to read backup operations file.') });
    } finally {
      setBusyTransfer(false);
    }
  };

  const handleResolve = async (
    conflictId: string,
    action: 'keep_server' | 'apply_local' | 'dismiss'
  ) => {
    setResolvingId(conflictId);
    setActionMessage(null);
    const res = await resolveSyncConflict(conflictId, action, notesByConflict[conflictId] || '');
    setResolvingId(null);
    if (res.success) {
      setActionMessage({ type: 'ok', text: t('تمت معالجة التعارض وتحديث المزامنة بنجاح.', 'Conflict resolved and sync updated successfully.') });
    } else {
      setActionMessage({ type: 'err', text: res.error || t('تعذر معالجة التعارض.', 'Could not resolve conflict.') });
    }
  };

  const getQueueBadge = (status: string) => {
    switch (status) {
      case 'synced':
        return { label: t('تمت المزامنة', 'Synced'), cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 };
      case 'needs_review':
        return { label: t('تعارض للمراجعة', 'Needs Review'), cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: AlertTriangle };
      case 'failed':
        return { label: t('فشل مؤقت', 'Temporary Failure'), cls: 'bg-red-50 text-red-700 border-red-200', icon: XCircle };
      default:
        return { label: t('بانتظار الإرسال', 'Pending Upload'), cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: Clock };
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('مركز المزامنة والعمل المحلي', 'Sync & Offline Center')}
      subtitle={t('مراقبة العمليات المسجلة بدون إنترنت ومعالجة تعارضات المزامنة', 'Monitor offline queued operations and resolve sync conflicts')}
      maxWidth="4xl"
    >
      <div className="space-y-2.5 text-xs">
        {/* Connection Status Summary */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            {networkStatus === 'disconnected' ? (
              <div className="p-2 rounded-lg bg-rose-100 text-rose-700">
                <WifiOff className="w-4 h-4" />
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
                <Wifi className="w-4 h-4" />
              </div>
            )}
            <div>
              <p className="font-black text-slate-900">
                {networkStatus === 'connected'
                  ? t('متصل وجاهز للإرسال والاستلام', 'Connected & Ready to Sync')
                  : networkStatus === 'synchronizing'
                  ? t('جاري الإرسال والاستلام والمزامنة...', 'Synchronizing data...')
                  : networkStatus === 'disconnected'
                  ? t('وضع العمل المحلي دون اتصال', 'Offline Local Mode')
                  : networkStatus === 'error'
                  ? t('قاعدة البيانات غير متاحة مؤقتاً أو تعذرت المزامنة', 'Database temporarily unavailable or sync failed')
                  : t('توجد عمليات معلقة أو تعارضات', 'Pending operations or conflicts detected')}
              </p>
              <p className="text-[11px] text-slate-500">
                {t('آخر مزامنة ناجحة:', 'Last successful sync:')}{' '}
                {lastServerSyncAt ? formatLocaleDateTime(lastServerSyncAt) : t('لم تتم بعد', 'Not yet synced')}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSyncing}
            onClick={() => triggerManualSync()}
            className="min-h-[34px] px-3 rounded-lg bg-[#003589] hover:bg-[#011E58] text-white font-bold flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? t('جاري المزامنة...', 'Syncing...') : t('مزامنة الآن', 'Sync Now')}</span>
          </button>
        </div>

        {/* Pre-Upgrade / Pre-Uninstall Readiness & Safe Transfer */}
        <div
          className={`p-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 ${
            hasUnsyncedData
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-emerald-50 border-emerald-200 text-emerald-950'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0 flex-1">
            {hasUnsyncedData ? (
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" />
            ) : (
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-700 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <p className="font-black">
                {hasUnsyncedData
                  ? t(
                      `لا تحذف التطبيق الآن: توجد (${unsyncedOperations.length + unresolvedConflicts.length}) عملية محلية غير متزامنة`,
                      `Do not uninstall now: (${unsyncedOperations.length + unresolvedConflicts.length}) unsynced local operations remain`
                    )
                  : t('الحالة آمنة للترقية: جميع العمليات مرسلة ومتزامنة بالكامل', 'Safe to upgrade: all operations are fully synced')}
              </p>
              <p className="text-[11px] opacity-85">
                {hasUnsyncedData
                  ? t(
                      'اضغط "مزامنة الآن" لإرسالها، أو صدّر نسخة احتياطية آمنة قبل حذف النسخة القديمة ثم استوردها بعد تثبيت الإصدار الجديد.',
                      'Click "Sync Now" to send them, or export a safe backup before removing the old app and import it after installing the new version.'
                    )
                  : t('حسابك وبيانات شركتك محفوظة بالكامل ويمكنك تسجيل الدخول مباشرة بعد التحديث.', 'Your account and company data are fully preserved and you can log in right after updating.')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {unsyncedOperations.length > 0 && (
              <button
                type="button"
                disabled={busyTransfer}
                onClick={handleExportPendingOperations}
                className="min-h-[32px] px-2.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t('تصدير المعلق', 'Export Pending')}</span>
              </button>
            )}
            <button
              type="button"
              disabled={busyTransfer}
              onClick={() => importInputRef.current?.click()}
              className="min-h-[32px] px-2.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{t('استيراد نسخة معلقة', 'Import Pending Backup')}</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportPendingOperations}
              className="hidden"
            />
          </div>
        </div>

        {lastError && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-bold">
            {t(lastError)}
          </div>
        )}

        {actionMessage && (
          <div
            className={`p-2.5 rounded-lg border font-bold ${
              actionMessage.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {actionMessage.text}
          </div>
        )}

        {/* Counters Strip */}
        <div className="grid grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-amber-50/70 px-3 py-1.5 text-center">
            <p className="text-[10px] text-amber-800 font-bold">{t('معلقة بالانتظار', 'Pending')}</p>
            <p className="text-sm font-black text-amber-950 font-mono tabular-nums">{pendingSyncCount}</p>
          </div>
          <div className="bg-red-50/70 px-3 py-1.5 text-center">
            <p className="text-[10px] text-red-800 font-bold">{t('فشل إعادة الإرسال', 'Retry Failed')}</p>
            <p className="text-sm font-black text-red-950 font-mono tabular-nums">{failedSyncCount}</p>
          </div>
          <div className="bg-amber-50/70 px-3 py-1.5 text-center">
            <p className="text-[10px] text-amber-800 font-bold">{t('تعارضات للمراجعة', 'Conflicts to Review')}</p>
            <p className="text-sm font-black text-amber-950 font-mono tabular-nums">{conflictsCount}</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-1.5 border-b border-slate-200 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`min-h-[32px] px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
              activeTab === 'queue'
                ? 'bg-[#011E58] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {t(`سجل العمليات المحلية (${syncQueue.length})`, `Local Operations Log (${syncQueue.length})`)}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('conflicts')}
            className={`min-h-[32px] px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
              activeTab === 'conflicts'
                ? 'bg-[#003589] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {t(`التعارضات (${unresolvedConflicts.length})`, `Conflicts (${unresolvedConflicts.length})`)}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'queue' ? (
          syncQueue.length === 0 ? (
            <div className="py-6 text-center text-slate-500 space-y-1.5">
              <Server className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="font-bold">{t('لا توجد عمليات محلية معلقة حالياً.', 'No pending local operations currently.')}</p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg bg-white divide-y divide-slate-200 max-h-[45vh] overflow-y-auto">
              {[...syncQueue]
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
                .map((op) => {
                  const badge = getQueueBadge(op.status);
                  const BadgeIcon = badge.icon;
                  return (
                    <div
                      key={op.operationId}
                      className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50"
                    >
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <p className="font-black text-slate-900 truncate">{t(op.summaryAr)}</p>
                        <p className="text-[11px] text-slate-500 font-mono">
                          {op.operationType} · {formatLocaleDateTime(op.createdAt)} · {t('محاولات:', 'Attempts:')} {op.attempts}
                        </p>
                        {op.lastError && (
                          <p className="text-[11px] text-red-700 font-bold">{t(op.lastError)}</p>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-bold shrink-0 ${badge.cls}`}
                      >
                        <BadgeIcon className="w-3 h-3" />
                        <span>{badge.label}</span>
                      </span>
                    </div>
                  );
                })}
            </div>
          )
        ) : syncConflicts.length === 0 ? (
          <div className="py-6 text-center text-slate-500 space-y-1.5">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="font-bold">{t('لا توجد تعارضات مزامنة مسجلة.', 'No sync conflicts recorded.')}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[45vh] overflow-y-auto pe-0.5">
            {[...unresolvedConflicts, ...resolvedConflicts].map((cf) => {
              const isOpenConflict = cf.status === 'needs_review';
              return (
                <div
                  key={cf.id}
                  className={`p-2.5 rounded-lg border space-y-2 ${
                    isOpenConflict ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-900">{t(cf.conflictReason)}</p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {cf.operationType} · {cf.userName || t('مستخدم', 'User')} · {formatLocaleDateTime(cf.createdAt)}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-slate-700">
                      {isOpenConflict ? t('يحتاج قرار', 'Decision Required') : t(cf.status)}
                    </span>
                  </div>

                  {isOpenConflict && (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                          {t('ملاحظة قرار المعالجة (اختياري):', 'Resolution Note (Optional):')}
                        </label>
                        <input
                          type="text"
                          value={notesByConflict[cf.id] || ''}
                          onChange={(e) =>
                            setNotesByConflict((prev) => ({ ...prev, [cf.id]: e.target.value }))
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={resolvingId === cf.id}
                          onClick={() => handleResolve(cf.id, 'keep_server')}
                          className="min-h-[30px] px-2.5 py-1 rounded-lg bg-[#003589] hover:bg-[#011E58] text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          {t('اعتماد النسخة المعتمدة', 'Keep Server Version')}
                        </button>
                        <button
                          type="button"
                          disabled={resolvingId === cf.id}
                          onClick={() => handleResolve(cf.id, 'apply_local')}
                          className="min-h-[30px] px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          {t('تطبيق التعديل المحلي', 'Apply Local Change')}
                        </button>
                        <button
                          type="button"
                          disabled={resolvingId === cf.id}
                          onClick={() => handleResolve(cf.id, 'dismiss')}
                          className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold cursor-pointer disabled:opacity-50"
                        >
                          {t('تجاهل', 'Dismiss')}
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

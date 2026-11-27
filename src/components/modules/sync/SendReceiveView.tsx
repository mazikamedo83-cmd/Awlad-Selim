import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Filter,
  History,
  Package,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Timer,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import type {
  ReceivePreviewResponse,
  SendReceiveActivityLogResponse,
  SendReceiveHistoryEntry,
  SyncConflictRecord,
  SyncQueueItem,
} from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import {
  formatDurationAr,
  formatMobileSyncTimestamp,
} from '../../../services/syncEngine';
import { roundCurrency } from '../../../utils/quantity';
import { Modal } from '../../common/Modal';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import {
  OriginalSourceDocumentModal,
  OriginalSourceDocumentTarget,
} from '../../common/OriginalSourceDocumentModal';

export interface SendReceiveViewProps {
  onBack?: () => void;
  onNavigate?: (page: any) => void;
}

type LogSectionTab = 'transfer_orders' | 'custody_returns' | 'dispatch_logs' | 'confirmation_logs';

const OPERATION_LABELS: Record<string, { ar: string; en: string }> = {
  create_sales_invoice: { ar: 'فواتير مبيعات', en: 'Sales Invoices' },
  edit_sales_invoice: { ar: 'تعديل فواتير مبيعات', en: 'Edited Sales Invoices' },
  cancel_invoice: { ar: 'إلغاء فواتير', en: 'Cancelled Invoices' },
  confirm_draft_invoice: { ar: 'اعتماد مسودات فواتير', en: 'Confirmed Draft Invoices' },
  create_purchase_invoice: { ar: 'فواتير مشتريات', en: 'Purchase Invoices' },
  edit_purchase_invoice: { ar: 'تعديل فواتير مشتريات', en: 'Edited Purchase Invoices' },
  purchase_action: { ar: 'إجراءات المشتريات', en: 'Purchase Actions' },
  customer_payment: { ar: 'تحصيلات عملاء', en: 'Customer Collections' },
  add_invoice_payment: { ar: 'سداد فواتير', en: 'Invoice Payments' },
  supplier_payment: { ar: 'مدفوعات موردين', en: 'Supplier Payments' },
  settle_supplier_advance: { ar: 'تسوية دفعات موردين', en: 'Supplier Advances' },
  create_return: { ar: 'مرتجعات', en: 'Returns' },
  sales_return_request: { ar: 'طلبات مرتجع مبيعات', en: 'Sales Return Requests' },
  purchase_return_request: { ar: 'طلبات مرتجع مشتريات', en: 'Purchase Return Requests' },
  create_rep_item_transfer: { ar: 'أمر تحويل أصناف', en: 'Transfer Orders' },
  update_rep_item_transfer_status: { ar: 'إجراءات أوامر التحويل', en: 'Transfer Order Actions' },
  confirm_custody_receipt: { ar: 'تأكيد استلام عهدة', en: 'Custody Receipt Confirmations' },
  rep_custody_op: { ar: 'حركات عهدة المندوب', en: 'Rep Custody Operations' },
  create_rep_transfer: { ar: 'تحويلات نقدية للمندوبين', en: 'Rep Cash Transfers' },
  rep_transfer_action: { ar: 'إجراءات تحويلات المندوبين', en: 'Rep Transfer Actions' },
  add_customer: { ar: 'إضافة عملاء جدد', en: 'New Customers' },
  update_customer: { ar: 'تحديث بيانات عملاء', en: 'Customer Updates' },
  create_order: { ar: 'طلبات عملاء', en: 'Customer Orders' },
  order_action: { ar: 'تحديثات طلبات', en: 'Order Actions' },
};

function formatLiveStopwatch(ms: number, isRtl: boolean): string {
  const safe = Math.max(0, ms);
  if (safe >= 60000) {
    const mins = Math.floor(safe / 60000);
    const secs = ((safe % 60000) / 1000).toFixed(1);
    return isRtl ? `${mins} د ${secs} ث` : `${mins}m ${secs}s`;
  }
  const secs = (safe / 1000).toFixed(1);
  return isRtl ? `${secs} ث` : `${secs}s`;
}

function splitDateTimeParts(
  iso: string | undefined | null
): { date: string; time: string; full: string } | null {
  if (!iso) return null;
  const formatted = formatMobileSyncTimestamp(iso);
  if (!formatted) return null;
  return {
    date: `${formatted.dateStr} ${formatted.weekdayStr}`.trim(),
    time: `${formatted.timeStr} ${formatted.periodStr}`.trim(),
    full: formatted.fullText,
  };
}

function formatIsoDateTime(iso: string | undefined | null, isRtl: boolean): string {
  if (!iso) return '-';
  const parts = splitDateTimeParts(iso);
  if (parts) return `${parts.date}${parts.time ? ` · ${parts.time}` : ''}`;
  try {
    return new Date(iso).toLocaleString(isRtl ? 'ar-EG' : 'en-US');
  } catch {
    return String(iso);
  }
}

export const SendReceiveView: React.FC<SendReceiveViewProps> = ({ onBack, onNavigate }) => {
  const { currentUser } = useAuth();
  const {
    networkStatus,
    isSyncing,
    syncQueue,
    syncConflicts,
    lastSendSummary,
    lastReceiveSummary,
    sendReceiveHistory,
    sendProgressStage,
    receiveProgressStage,
    sendSyncOperations,
    previewReceiveUpdates,
    confirmReceiveUpdates,
    resolveSyncConflict,
    getSendReceiveActivityLog,
    representatives = [],
    repItemTransfers = [],
    repCustodyReturnRequests = [],
    settings,
  } = useData();
  const { t, dir, isRtl } = usePreferences();
  const fmt = (n: number) => formatLocaleNumber(Number(n || 0));

  const currencyLabel = settings.currency || t('ج.م', 'EGP');
  const BackArrow = isRtl ? ArrowRight : ArrowLeft;

  // Confirmation modals & local UI state (zero auto-actions on mount)
  const [sendSummaryModalOps, setSendSummaryModalOps] = useState<SyncQueueItem[] | null>(null);
  const [receivePreviewState, setReceivePreviewState] = useState<{
    preview: ReceivePreviewResponse;
    previewDurationMs: number;
  } | null>(null);
  const [selectedCustodyIds, setSelectedCustodyIds] = useState<string[]>([]);
  const [selectedCashIds, setSelectedCashIds] = useState<string[]>([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [conflictsModalOpen, setConflictsModalOpen] = useState(false);

  // Unified Send & Receive Activity Log state + compact filters
  const [activeLogTab, setActiveLogTab] = useState<LogSectionTab>('transfer_orders');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterRepId, setFilterRepId] = useState('all');
  const [filterOperationType, setFilterOperationType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDocNumber, setFilterDocNumber] = useState('');
  const [activityLog, setActivityLog] = useState<SendReceiveActivityLogResponse | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [sourceDocTarget, setSourceDocTarget] = useState<OriginalSourceDocumentTarget | null>(null);

  // Active execution states + real stopwatch timers
  const [activeMode, setActiveMode] = useState<'idle' | 'send' | 'receive_preview' | 'receive_confirm'>('idle');
  const [liveSendElapsedMs, setLiveSendElapsedMs] = useState<number>(0);
  const [liveReceiveElapsedMs, setLiveReceiveElapsedMs] = useState<number>(0);
  const opStartPerfRef = useRef<number>(0);
  const receiveBaseMsRef = useRef<number>(0);

  const [banner, setBanner] = useState<{
    type: 'success' | 'error' | 'warning' | 'info';
    text: string;
  } | null>(null);

  const loadActivityLog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const res = await getSendReceiveActivityLog({
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        repId: filterRepId !== 'all' ? filterRepId : undefined,
        operationType: filterOperationType !== 'all' ? filterOperationType : undefined,
        status: filterStatus !== 'all' ? filterStatus : undefined,
        docNumber: filterDocNumber.trim() || undefined,
      });
      if (res) setActivityLog(res);
    } finally {
      setLoadingLog(false);
    }
  }, [
    getSendReceiveActivityLog,
    filterDateFrom,
    filterDateTo,
    filterRepId,
    filterOperationType,
    filterStatus,
    filterDocNumber,
  ]);

  useEffect(() => {
    void loadActivityLog();
  }, [loadActivityLog, repItemTransfers.length, repCustodyReturnRequests.length, sendReceiveHistory.length]);

  useEffect(() => {
    if (activeMode === 'idle') return;
    const interval = window.setInterval(() => {
      const delta = Math.max(0, performance.now() - opStartPerfRef.current);
      if (activeMode === 'send') {
        setLiveSendElapsedMs(delta);
      } else if (activeMode === 'receive_preview') {
        setLiveReceiveElapsedMs(delta);
      } else if (activeMode === 'receive_confirm') {
        setLiveReceiveElapsedMs(receiveBaseMsRef.current + delta);
      }
    }, 80);
    return () => window.clearInterval(interval);
  }, [activeMode]);

  const userQueue = useMemo(
    () =>
      (syncQueue || [])
        .filter((q) => !q.userId || !currentUser?.id || q.userId === currentUser.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [syncQueue, currentUser?.id]
  );

  const sendableOps = useMemo(
    () => userQueue.filter((q) => q.status === 'pending' || q.status === 'failed'),
    [userQueue]
  );

  const failedOpsCount = useMemo(
    () => sendableOps.filter((q) => q.status === 'failed').length,
    [sendableOps]
  );

  const unresolvedConflicts = useMemo(
    () => (syncConflicts || []).filter((c) => c.status === 'needs_review'),
    [syncConflicts]
  );

  const sendSummaryBreakdown = useMemo(() => {
    const ops = sendSummaryModalOps || [];
    const grouped = new Map<string, { type: string; label: string; count: number; samples: string[] }>();
    for (const op of ops) {
      const meta = OPERATION_LABELS[op.operationType] || {
        ar: op.operationType,
        en: op.operationType,
      };
      const existing = grouped.get(op.operationType) || {
        type: op.operationType,
        label: t(meta.ar, meta.en),
        count: 0,
        samples: [],
      };
      existing.count += 1;
      const sampleLabel =
        op.payload?.docNumber ||
        op.payload?.name ||
        op.payload?.transferNumber ||
        op.entityId ||
        op.operationId;
      if (sampleLabel && existing.samples.length < 3) {
        existing.samples.push(String(sampleLabel));
      }
      grouped.set(op.operationType, existing);
    }
    return Array.from(grouped.values());
  }, [sendSummaryModalOps, t]);

  const isBusy = activeMode !== 'idle' || isSyncing;

  const handleSendClick = () => {
    if (isBusy) return;
    setBanner(null);
    if (sendableOps.length === 0) {
      setBanner({
        type: 'info',
        text: t(
          'لا توجد عمليات جديدة معلقة للإرسال حالياً.',
          'No pending local operations are ready to send right now.'
        ),
      });
      return;
    }
    setSendSummaryModalOps(sendableOps);
  };

  const handleConfirmSend = async () => {
    if (!sendSummaryModalOps || sendSummaryModalOps.length === 0 || isBusy) return;
    const opIds = sendSummaryModalOps.map((o) => o.operationId);
    setSendSummaryModalOps(null);
    setBanner(null);

    opStartPerfRef.current = performance.now();
    setLiveSendElapsedMs(0);
    setActiveMode('send');
    try {
      const res = await sendSyncOperations(opIds);
      const durationText = formatDurationAr(res.durationMs);
      if (res.ok) {
        const dedupNote =
          res.deduplicatedCount > 0
            ? ` (${t(`منها ${res.deduplicatedCount} مكررة مسبقاً وتم منع تكرارها`, `including ${res.deduplicatedCount} already accepted and deduplicated`)})`
            : '';
        setBanner({
          type: 'success',
          text: `${t(
            `تم إرسال ${formatLocaleNumber(res.sentCount)} عملية بنجاح خلال ${durationText}`,
            `Sent ${formatLocaleNumber(res.sentCount)} operation(s) successfully in ${durationText}`
          )}${dedupNote}.`,
        });
        void loadActivityLog();
      } else {
        setBanner({
          type: 'error',
          text: `${res.error || t('تعذر إكمال الإرسال', 'Send failed')} · ${t('المدة الفعلية:', 'Duration:')} ${durationText}`,
        });
      }
    } finally {
      setActiveMode('idle');
    }
  };

  const handleReceiveClick = async () => {
    if (isBusy) return;
    setBanner(null);
    opStartPerfRef.current = performance.now();
    receiveBaseMsRef.current = 0;
    setLiveReceiveElapsedMs(0);
    setActiveMode('receive_preview');
    try {
      const res = await previewReceiveUpdates();
      setActiveMode('idle');
      if (!res.ok || !res.preview) {
        const durationText = formatDurationAr(res.durationMs);
        setBanner({
          type: 'error',
          text: `${res.error || t('تعذر جلب التحديثات الواردة من السيرفر', 'Failed to fetch incoming updates from server')} · ${t('المدة الفعلية:', 'Duration:')} ${durationText}`,
        });
        return;
      }

      const custodyIds = (res.preview.items.custodyDispatches || []).map((c) => c.id);
      const cashIds = (res.preview.items.cashTransfers || []).map((tItem) => tItem.id);
      const batchIds = (res.preview.items.dispatchBatches || []).map((b) => b.id);

      setSelectedCustodyIds(custodyIds);
      setSelectedCashIds(cashIds);
      setSelectedBatchIds(batchIds);
      receiveBaseMsRef.current = res.durationMs;
      setLiveReceiveElapsedMs(res.durationMs);
      setReceivePreviewState({
        preview: res.preview,
        previewDurationMs: res.durationMs,
      });
    } catch {
      setActiveMode('idle');
      setBanner({
        type: 'error',
        text: t('تعذر الاتصال بالخادم لفحص التحديثات الواردة.', 'Unable to contact server to preview incoming updates.'),
      });
    }
  };

  const handleConfirmReceive = async () => {
    if (!receivePreviewState || isBusy) return;
    const { preview, previewDurationMs } = receivePreviewState;
    setReceivePreviewState(null);

    opStartPerfRef.current = performance.now();
    receiveBaseMsRef.current = previewDurationMs;
    setActiveMode('receive_confirm');
    try {
      const idempotencyKey = `RCV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const res = await confirmReceiveUpdates({
        idempotencyKey,
        confirmCustodyIds: selectedCustodyIds,
        confirmCashTransferIds: selectedCashIds,
        confirmBatchIds: selectedBatchIds,
        previewDurationMs,
      });
      const durationText = formatDurationAr(res.durationMs);
      if (res.ok) {
        const appliedCount = res.response?.receivedCount || 0;
        const updatesTotal =
          (preview.summary.updatedCatalogCount || 0) +
          (preview.summary.updatedCustomersCount || 0) +
          (preview.summary.updatedInvoicesCount || 0);
        setBanner({
          type: 'success',
          text:
            appliedCount > 0 || updatesTotal > 0
              ? t(
                  `تم تأكيد الاستلام وتحديث البيانات (${formatLocaleNumber(appliedCount + updatesTotal)} بند/تحديث) خلال ${durationText}.`,
                  `Receipt confirmed and updates applied (${formatLocaleNumber(appliedCount + updatesTotal)} item/update) in ${durationText}.`
                )
              : t(
                  `تم الفحص والتأكيد — البيانات محدثة ولا توجد عهد أو تحويلات معلقة (${durationText}).`,
                  `Checked and confirmed — data is up to date (${durationText}).`
                ),
        });
        void loadActivityLog();
      } else {
        setBanner({
          type: 'error',
          text: `${res.error || t('تعذر تأكيد الاستلام', 'Failed to confirm receipt')} · ${t('المدة الفعلية:', 'Duration:')} ${durationText}`,
        });
      }
    } finally {
      setActiveMode('idle');
    }
  };

  const handleResolveConflict = async (
    cf: SyncConflictRecord,
    action: 'apply_local' | 'keep_server' | 'dismiss'
  ) => {
    const res = await resolveSyncConflict(cf.id, action);
    setBanner({
      type: res.success ? 'success' : 'error',
      text: res.success
        ? t('تمت معالجة التعارض بنجاح.', 'Conflict resolved successfully.')
        : res.error || t('تعذر معالجة التعارض', 'Failed to resolve conflict'),
    });
  };

  const transferOrders = activityLog?.transferOrders || [];
  const custodyReturnRequests = activityLog?.custodyReturnRequests || [];
  const dispatchLogs = activityLog?.dispatchLogs || [];
  const confirmationLogs = activityLog?.confirmationLogs || [];

  const localSendHistory = useMemo(
    () => (sendReceiveHistory || []).filter((e: SendReceiveHistoryEntry) => e.type === 'send'),
    [sendReceiveHistory]
  );

  const repFilterOptions = useMemo(
    () =>
      representatives.map((r) => ({
        value: r.id,
        label: r.name,
        subtitle: r.phone || r.code,
      })),
    [representatives]
  );

  const lastSendSuccessDt = splitDateTimeParts(lastSendSummary?.at);
  const lastSendAttemptDt = splitDateTimeParts(lastSendSummary?.lastAttemptAt);
  const lastReceiveSuccessDt = splitDateTimeParts(lastReceiveSummary?.at);
  const lastReceiveAttemptDt = splitDateTimeParts(lastReceiveSummary?.lastAttemptAt);

  const previewSummary = receivePreviewState?.preview.summary;
  const previewItems = receivePreviewState?.preview.items;
  const hasPreviewActions = Boolean(
    previewSummary &&
      (previewSummary.custodyDispatchesCount > 0 ||
        previewSummary.cashTransfersCount > 0 ||
        previewSummary.dispatchBatchesCount > 0 ||
        (previewSummary.updatedCatalogCount || 0) > 0 ||
        (previewSummary.updatedCustomersCount || 0) > 0 ||
        (previewSummary.updatedInvoicesCount || 0) > 0)
  );

  return (
    <div dir={dir} data-testid="send-receive-view" className="w-full max-w-6xl mx-auto space-y-3 pb-4">
      {/* Compact Brand Header */}
      <div className="rounded-lg bg-[#011E58] dark:bg-[#0B1933] text-white px-3.5 py-2.5 border border-[#003589]/50 dark:border-[#21375C] flex flex-wrap items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="h-9 w-9 rounded-md bg-white/15 hover:bg-white/25 text-white flex items-center justify-center shrink-0 cursor-pointer"
              title={t('رجوع', 'Back')}
              aria-label={t('رجوع', 'Back')}
            >
              <BackArrow className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-black tracking-tight truncate">
              {t('سجل الإرسال والاستلام', 'Send & Receive Log')}
            </h1>
            <p className="text-[11px] text-blue-100/90 truncate">
              {t(
                'متابعة الإرسال والاستلام اليدوي وسجل أوامر التحويل وطلبات الإرجاع وتأكيدات الاستلام بمستنداتها الأصلية',
                'Manual Send/Receive controls plus unified Transfer Orders, Return Requests, Dispatch & Confirmation Logs'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-xs font-bold">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('stock-transfers-orders')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/15 hover:bg-white/25 border border-white/25 text-white cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>{t('أوامر التحويل', 'Transfer Orders')}</span>
            </button>
          )}
          {networkStatus === 'disconnected' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/20 border border-rose-300/40 text-rose-100">
              <WifiOff className="w-3.5 h-3.5" />
              <span>{t('غير متصل', 'Offline')}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/20 border border-emerald-300/40 text-emerald-100">
              <Wifi className="w-3.5 h-3.5" />
              <span>{t('متصل بالخادم', 'Online')}</span>
            </span>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          role="status"
          data-testid="send-receive-banner"
          className={`rounded-lg border px-3 py-2 text-xs font-bold flex items-center justify-between gap-2 ${
            banner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-700/60 text-emerald-900 dark:text-emerald-200'
              : banner.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/35 border-rose-200 dark:border-rose-700/60 text-rose-900 dark:text-rose-200'
              : banner.type === 'warning'
              ? 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-700/60 text-amber-900 dark:text-amber-200'
              : 'bg-blue-50 dark:bg-[#0E2448] border-blue-200 dark:border-[#21375C] text-[#011E58] dark:text-[#DCE6F5]'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : banner.type === 'error' ? (
              <XCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-[11px] underline shrink-0 cursor-pointer"
          >
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {/* Optional Conflicts Alert Bar */}
      {unresolvedConflicts.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              {t(
                `توجد ${formatLocaleNumber(unresolvedConflicts.length)} تعارضات متزامنة تحتاج قرارك اليدوي.`,
                `${formatLocaleNumber(unresolvedConflicts.length)} sync conflict(s) require manual review.`
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setConflictsModalOpen(true)}
            className="h-8 px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
          >
            {t('مراجعة التعارضات', 'Review Conflicts')}
          </button>
        </div>
      )}

      {/* Core Two-Column Desktop / Stacked Mobile Cards: Send & Receive */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* SEND CARD */}
        <section
          aria-label={t('الإرسال', 'Send')}
          data-testid="send-card"
          className="rounded-lg bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] p-3.5 flex flex-col justify-between gap-3 shadow-xs"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-[#1E3357] pb-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-md bg-[#EEF3FA] dark:bg-[#163161] border border-[#DCE6F5] dark:border-[#24437A] text-[#003589] dark:text-[#7FB2FF] flex items-center justify-center shrink-0">
                  <ArrowUpCircle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-[#011E58] dark:text-[#F3F7FC]">
                    {t('إرسال العمليات', 'Send Operations')}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-[#9AB0D2]">
                    {t('رفع العمليات المحلية المؤكدة بعد موافقتك', 'Upload confirmed local operations after approval')}
                  </p>
                </div>
              </div>

              <div className="text-end shrink-0">
                <span className="block text-[10px] font-bold text-slate-500 dark:text-[#9AB0D2]">
                  {t('بانتظار الإرسال', 'Ready to Send')}
                </span>
                <span
                  data-testid="pending-send-count"
                  className={`font-mono text-base font-black tabular-nums ${
                    sendableOps.length > 0
                      ? 'text-[#003589] dark:text-[#60A5FA]'
                      : 'text-slate-600 dark:text-[#C5D5EE]'
                  }`}
                >
                  {formatLocaleNumber(sendableOps.length)}
                </span>
              </div>
            </div>

            {failedOpsCount > 0 && (
              <div className="rounded-md bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-700/50 px-2.5 py-1.5 text-[11px] font-bold text-rose-800 dark:text-rose-200">
                {t(
                  `توجد ${formatLocaleNumber(failedOpsCount)} عمليات تعذر إرسالها سابقاً ومحتفظ بها محلياً لإعادة المحاولة يدوياً.`,
                  `${formatLocaleNumber(failedOpsCount)} previously failed operation(s) retained locally for manual retry.`
                )}
              </div>
            )}

            <button
              type="button"
              data-testid="manual-send-btn"
              disabled={isBusy}
              onClick={handleSendClick}
              className="w-full min-h-[44px] px-4 rounded-md bg-[#003589] hover:bg-[#011E58] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] disabled:opacity-60 text-white text-sm font-black flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {activeMode === 'send' ? (
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Send className="w-4 h-4 shrink-0" />
              )}
              <span>
                {activeMode === 'send'
                  ? t('جاري الإرسال...', 'Sending...')
                  : t('إرسال', 'Send')}
              </span>
              {sendableOps.length > 0 && activeMode !== 'send' && (
                <span className="font-mono text-xs bg-white/20 px-1.5 py-0.5 rounded tabular-nums">
                  {formatLocaleNumber(sendableOps.length)}
                </span>
              )}
            </button>

            {activeMode === 'send' && (
              <div
                data-testid="send-live-timer"
                className="rounded-md bg-[#EEF3FA] dark:bg-[#13294E] border border-[#DCE6F5] dark:border-[#24437A] px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold text-[#011E58] dark:text-[#DCE6F5]"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Timer className="w-4 h-4 text-[#003589] dark:text-[#60A5FA] shrink-0" />
                  <span className="truncate">{sendProgressStage || t('جاري تنفيذ الإرسال...', 'Sending...')}</span>
                </span>
                <span className="font-mono font-black tabular-nums shrink-0">
                  {formatLiveStopwatch(liveSendElapsedMs, isRtl)}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-[#1E3357] text-xs">
            <div
              data-testid="last-send-success"
              className="rounded-md bg-slate-50 dark:bg-[#0A162B] border border-slate-200 dark:border-[#1E3357] p-2.5 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-slate-800 dark:text-[#E2ECFA] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{t('آخر إرسال ناجح', 'Last Successful Send')}</span>
                </span>
                {lastSendSummary?.lastSuccessDurationMs != null && lastSendSuccessDt && (
                  <span
                    data-testid="last-send-duration"
                    className="font-mono text-[11px] font-black text-[#003589] dark:text-[#60A5FA] tabular-nums"
                  >
                    {t('المدة:', 'Duration:')} {formatDurationAr(lastSendSummary.lastSuccessDurationMs)}
                  </span>
                )}
              </div>

              {lastSendSuccessDt ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-[#A9BCD9]">
                  <span data-testid="last-send-datetime" className="font-mono tabular-nums">
                    {lastSendSuccessDt.date}
                    {lastSendSuccessDt.time ? ` · ${lastSendSuccessDt.time}` : ''}
                  </span>
                  <span className="font-bold text-slate-700 dark:text-[#D1DFF3] tabular-nums">
                    {t('العمليات:', 'Ops:')} {formatLocaleNumber(lastSendSummary?.count || 0)}
                  </span>
                </div>
              ) : (
                <p data-testid="last-send-datetime" className="text-[11px] text-slate-500 dark:text-[#8CA3C7]">
                  {t('لم يتم تنفيذ إرسال ناجح بعد', 'No successful send recorded yet')}
                </p>
              )}
            </div>

            {lastSendSummary && lastSendSummary.ok === false && (
              <div
                data-testid="last-send-failure"
                className="rounded-md bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-700/60 p-2.5 space-y-1 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2 font-black text-rose-800 dark:text-rose-200">
                  <span className="flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('فشل آخر محاولة إرسال', 'Last Send Attempt Failed')}</span>
                  </span>
                  {lastSendSummary.durationMs != null && (
                    <span className="font-mono tabular-nums">
                      {formatDurationAr(lastSendSummary.durationMs)}
                    </span>
                  )}
                </div>
                {lastSendAttemptDt && (
                  <p className="font-mono text-rose-700 dark:text-rose-300 tabular-nums">
                    {lastSendAttemptDt.full}
                  </p>
                )}
                {lastSendSummary.error && (
                  <p className="font-bold text-rose-900 dark:text-rose-100">
                    {t('السبب:', 'Reason:')} {lastSendSummary.error}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* RECEIVE CARD */}
        <section
          aria-label={t('الاستلام', 'Receive')}
          data-testid="receive-card"
          className="rounded-lg bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] p-3.5 flex flex-col justify-between gap-3 shadow-xs"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-[#1E3357] pb-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-700/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                  <ArrowDownCircle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-[#011E58] dark:text-[#F3F7FC]">
                    {t('استلام التحديثات والعهد', 'Receive Updates & Custody')}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-[#9AB0D2]">
                    {t('معاينة ما هو متاح ثم تأكيد الاستلام يدوياً', 'Preview available items first, then confirm explicitly')}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-md bg-slate-50 dark:bg-[#0A162B] border border-slate-200 dark:border-[#1E3357] px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 dark:text-[#A9BCD9]">
              {t(
                'لن تدخل أي عهدة أصناف أو تحويلات أو تحديثات قبل عرض الملخص وموافقتك الصريحة.',
                'Custody dispatches, cash transfers, and updates only apply after preview and your explicit confirmation.'
              )}
            </div>

            <button
              type="button"
              data-testid="manual-receive-btn"
              disabled={isBusy}
              onClick={handleReceiveClick}
              className="w-full min-h-[44px] px-4 rounded-md bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-black flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {activeMode === 'receive_preview' || activeMode === 'receive_confirm' ? (
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <ArrowDownCircle className="w-4 h-4 shrink-0" />
              )}
              <span>
                {activeMode === 'receive_preview'
                  ? t('جاري فحص التحديثات...', 'Checking updates...')
                  : activeMode === 'receive_confirm'
                  ? t('جاري تطبيق الاستلام...', 'Applying receipt...')
                  : t('استلام', 'Receive')}
              </span>
            </button>

            {(activeMode === 'receive_preview' || activeMode === 'receive_confirm') && (
              <div
                data-testid="receive-live-timer"
                className="rounded-md bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-700/60 px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-200"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Timer className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    {receiveProgressStage ||
                      (activeMode === 'receive_preview'
                        ? t('جاري جلب ملخص التحديثات...', 'Fetching update summary...')
                        : t('جاري تطبيق البيانات المستلمة...', 'Applying received data...'))}
                  </span>
                </span>
                <span className="font-mono font-black tabular-nums shrink-0">
                  {formatLiveStopwatch(liveReceiveElapsedMs, isRtl)}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-[#1E3357] text-xs">
            <div
              data-testid="last-receive-success"
              className="rounded-md bg-slate-50 dark:bg-[#0A162B] border border-slate-200 dark:border-[#1E3357] p-2.5 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-slate-800 dark:text-[#E2ECFA] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{t('آخر استلام ناجح', 'Last Successful Receive')}</span>
                </span>
                {lastReceiveSummary?.lastSuccessDurationMs != null && lastReceiveSuccessDt && (
                  <span
                    data-testid="last-receive-duration"
                    className="font-mono text-[11px] font-black text-emerald-700 dark:text-emerald-400 tabular-nums"
                  >
                    {t('المدة:', 'Duration:')} {formatDurationAr(lastReceiveSummary.lastSuccessDurationMs)}
                  </span>
                )}
              </div>

              {lastReceiveSuccessDt ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-[#A9BCD9]">
                  <span data-testid="last-receive-datetime" className="font-mono tabular-nums">
                    {lastReceiveSuccessDt.date}
                    {lastReceiveSuccessDt.time ? ` · ${lastReceiveSuccessDt.time}` : ''}
                  </span>
                  <span className="font-bold text-slate-700 dark:text-[#D1DFF3] tabular-nums">
                    {t('العناصر:', 'Items:')} {formatLocaleNumber(lastReceiveSummary?.count || 0)}
                  </span>
                </div>
              ) : (
                <p data-testid="last-receive-datetime" className="text-[11px] text-slate-500 dark:text-[#8CA3C7]">
                  {t('لم يتم تنفيذ استلام ناجح بعد', 'No successful receive recorded yet')}
                </p>
              )}
            </div>

            {lastReceiveSummary && lastReceiveSummary.ok === false && (
              <div
                data-testid="last-receive-failure"
                className="rounded-md bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-700/60 p-2.5 space-y-1 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2 font-black text-rose-800 dark:text-rose-200">
                  <span className="flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('فشل آخر محاولة استلام', 'Last Receive Attempt Failed')}</span>
                  </span>
                  {lastReceiveSummary.durationMs != null && (
                    <span className="font-mono tabular-nums">
                      {formatDurationAr(lastReceiveSummary.durationMs)}
                    </span>
                  )}
                </div>
                {lastReceiveAttemptDt && (
                  <p className="font-mono text-rose-700 dark:text-rose-300 tabular-nums">
                    {lastReceiveAttemptDt.full}
                  </p>
                )}
                {lastReceiveSummary.error && (
                  <p className="font-bold text-rose-900 dark:text-rose-100">
                    {t('السبب:', 'Reason:')} {lastReceiveSummary.error}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* UNIFIED SECTION: سجل الإرسال والاستلام (أ، ب، ج، د، هـ) */}
      <section
        aria-label={t('سجل الإرسال والاستلام', 'Send & Receive Activity Log')}
        data-testid="send-receive-history"
        className="rounded-lg bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] overflow-hidden shadow-xs"
      >
        {/* Top Bar + Compact Filters (هـ) */}
        <div className="p-3 border-b border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#0A162B] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[#003589] dark:text-[#60A5FA]" />
              <h2 className="text-xs sm:text-sm font-black text-[#011E58] dark:text-[#F3F7FC]">
                {t('سجل الإرسال والاستلام الموحد', 'Unified Send & Receive Log')}
              </h2>
            </div>

            <button
              type="button"
              onClick={() => void loadActivityLog()}
              disabled={loadingLog}
              className="h-8 px-2.5 rounded-md border border-slate-300 dark:border-[#2B436E] bg-white dark:bg-[#0E1C36] text-xs font-bold text-slate-700 dark:text-[#DCE6F5] flex items-center gap-1.5 cursor-pointer hover:bg-slate-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingLog ? 'animate-spin' : ''}`} />
              <span>{t('تحديث السجل', 'Refresh Log')}</span>
            </button>
          </div>

          {/* Compact Filter Bar (هـ. الفلاتر والبحث) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 text-xs items-end">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">{t('من تاريخ', 'From Date')}</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2B436E] bg-white dark:bg-[#0E1C36] px-2 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">{t('إلى تاريخ', 'To Date')}</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2B436E] bg-white dark:bg-[#0E1C36] px-2 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">{t('المندوب', 'Representative')}</label>
              <SearchableFilterSelect
                value={filterRepId}
                onChange={setFilterRepId}
                options={repFilterOptions}
                allOptionLabel={t('جميع المناديب', 'All Reps')}
                includeAllOption
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">{t('نوع العملية', 'Operation Type')}</label>
              <select
                value={filterOperationType}
                onChange={(e) => setFilterOperationType(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2B436E] bg-white dark:bg-[#0E1C36] px-2 font-bold text-xs"
              >
                <option value="all">{t('كل العمليات', 'All Operations')}</option>
                <option value="rep_item_transfer">{t('أمر تحويل', 'Transfer Order')}</option>
                <option value="rep_custody_return_request">{t('طلب إرجاع بضاعة', 'Custody Return Request')}</option>
                <option value="sync_dispatch_batch">{t('دفعة إرسال مستندات', 'Sync Dispatch Batch')}</option>
                <option value="rep_transfer">{t('تحويل نقدي لمندوب', 'Rep Cash Transfer')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">{t('الحالة', 'Status')}</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2B436E] bg-white dark:bg-[#0E1C36] px-2 font-bold text-xs"
              >
                <option value="all">{t('كل الحالات', 'All Statuses')}</option>
                <option value="pending">{t('قيد الانتظار', 'Pending')}</option>
                <option value="executed">{t('تم الإرسال', 'Dispatched')}</option>
                <option value="received">{t('تم الاستلام', 'Received')}</option>
                <option value="partially_approved">{t('معتمد جزئياً', 'Partially Approved')}</option>
                <option value="approved">{t('معتمد', 'Approved')}</option>
                <option value="rejected">{t('مرفوض', 'Rejected')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">{t('رقم المستند', 'Document #')}</label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={filterDocNumber}
                  onChange={(e) => setFilterDocNumber(e.target.value)}
                  placeholder={t('بحث برقم المستند...', 'Search doc #...')}
                  className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2B436E] bg-white dark:bg-[#0E1C36] px-2 text-xs font-mono"
                />
                {(filterDateFrom || filterDateTo || filterRepId !== 'all' || filterOperationType !== 'all' || filterStatus !== 'all' || filterDocNumber) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterDateFrom('');
                      setFilterDateTo('');
                      setFilterRepId('all');
                      setFilterOperationType('all');
                      setFilterStatus('all');
                      setFilterDocNumber('');
                    }}
                    className="h-8 px-2 rounded-md border border-slate-300 bg-white text-[11px] font-bold text-slate-600 cursor-pointer shrink-0"
                    title={t('مسح الفلاتر', 'Clear Filters')}
                  >
                    <Filter className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 4 Structured Section Tabs (أ، ب، ج، د) */}
          <div className="flex flex-wrap gap-1.5 pt-1 text-xs font-bold">
            {(
              [
                {
                  key: 'transfer_orders' as const,
                  icon: ArrowLeftRight,
                  label: t('أ. أوامر التحويل', 'A. Transfer Orders'),
                  count: transferOrders.length,
                },
                {
                  key: 'custody_returns' as const,
                  icon: RotateCcw,
                  label: t('ب. طلبات إرجاع البضاعة', 'B. Custody Returns'),
                  count: custodyReturnRequests.length,
                },
                {
                  key: 'dispatch_logs' as const,
                  icon: Send,
                  label: t('ج. سجل عمليات الإرسال', 'C. Dispatch Log'),
                  count: dispatchLogs.length + localSendHistory.length,
                },
                {
                  key: 'confirmation_logs' as const,
                  icon: CheckCircle2,
                  label: t('د. سجل عمليات الاستلام والتأكيد', 'D. Receipt & Confirmations'),
                  count: confirmationLogs.length,
                },
              ]
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeLogTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveLogTab(tab.key)}
                  className={`h-8 px-2.5 rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#011E58] dark:bg-[#1659C8] text-white border-[#011E58] dark:border-[#1659C8]'
                      : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#C5D5EE] border-slate-200 dark:border-[#21375C] hover:bg-slate-100 dark:hover:bg-[#162848]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  <span className="font-mono text-[11px] opacity-85">({fmt(tab.count)})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section Content */}
        <div className="overflow-x-auto">
          {/* أ. أوامر التحويل */}
          {activeLogTab === 'transfer_orders' && (
            transferOrders.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                <Clock className="w-5 h-5 mx-auto mb-1 opacity-60" />
                <p className="font-bold">{t('لا توجد أوامر تحويل مطابقة للفلاتر الحالية.', 'No transfer orders match the current filters.')}</p>
              </div>
            ) : (
              <table className="w-full text-xs text-start border-collapse">
                <thead className="bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] text-[11px] border-b border-slate-200 dark:border-[#21375C]">
                  <tr>
                    <th className="p-2.5 text-start">{t('رقم أمر التحويل', 'Transfer Order #')}</th>
                    <th className="p-2.5 text-start">{t('الإنشاء', 'Created At')}</th>
                    <th className="p-2.5 text-start">{t('المندوب', 'Rep')}</th>
                    <th className="p-2.5 text-start">{t('الأصناف والكميات', 'Items & Qtys')}</th>
                    <th className="p-2.5 text-center">{t('الحالة', 'Status')}</th>
                    <th className="p-2.5 text-start">{t('الإرسال', 'Sent At')}</th>
                    <th className="p-2.5 text-start">{t('استلام المندوب', 'Rep Received At')}</th>
                    <th className="p-2.5 text-start">{t('تفاصيل التأكيد', 'Confirmation Details')}</th>
                    <th className="p-2.5 text-center">{t('المستند الأصلي', 'Source Doc')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1E3357]">
                  {transferOrders.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-[#13264A]/40">
                      <td className="p-2.5 font-mono font-black text-[#003589] dark:text-[#7FB2FF]">{row.documentNumber}</td>
                      <td className="p-2.5 font-mono text-[11px]">{formatIsoDateTime(row.createdAt, isRtl)}</td>
                      <td className="p-2.5 font-bold">{row.representativeName}</td>
                      <td className="p-2.5 text-[11px] max-w-xs truncate">
                        {(row.items || []).map((i) => `${i.productName} (${fmt(i.quantity)} ${t(i.unit)})`).join(' · ')}
                      </td>
                      <td className="p-2.5 text-center">
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] text-[10px] font-bold">
                          {t(row.status)}
                        </span>
                      </td>
                      <td className="p-2.5 font-mono text-[11px]">{formatIsoDateTime(row.sentAt, isRtl)}</td>
                      <td className="p-2.5 font-mono text-[11px]">{formatIsoDateTime(row.receivedAt, isRtl)}</td>
                      <td className="p-2.5 text-[11px] text-slate-600 dark:text-[#A9BCD9]">
                        {row.confirmationDetails || row.receivedBy || '-'}
                      </td>
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setSourceDocTarget({
                              docType: row.docType || 'rep_item_transfer',
                              docId: row.id,
                              docNumber: row.documentNumber,
                            })
                          }
                          className="h-7 px-2.5 rounded bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{t('فتح المستند', 'Open Doc')}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {/* ب. طلبات إرجاع البضاعة */}
          {activeLogTab === 'custody_returns' && (
            custodyReturnRequests.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                <Clock className="w-5 h-5 mx-auto mb-1 opacity-60" />
                <p className="font-bold">{t('لا توجد طلبات إرجاع بضاعة مطابقة للفلاتر الحالية.', 'No custody return requests match the current filters.')}</p>
              </div>
            ) : (
              <table className="w-full text-xs text-start border-collapse">
                <thead className="bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] text-[11px] border-b border-slate-200 dark:border-[#21375C]">
                  <tr>
                    <th className="p-2.5 text-start">{t('رقم طلب الإرجاع', 'Return #')}</th>
                    <th className="p-2.5 text-start">{t('المندوب', 'Rep')}</th>
                    <th className="p-2.5 text-start">{t('الأصناف المطلوبة', 'Requested Items')}</th>
                    <th className="p-2.5 text-center">{t('المستلم فعلياً', 'Actual Received')}</th>
                    <th className="p-2.5 text-center">{t('المعتمد', 'Approved')}</th>
                    <th className="p-2.5 text-center">{t('المتبقي على المندوب', 'Remaining Custody')}</th>
                    <th className="p-2.5 text-center">{t('الحالة', 'Status')}</th>
                    <th className="p-2.5 text-start">{t('التواريخ (إرسال / مراجعة / اعتماد)', 'Sent / Reviewed / Approved')}</th>
                    <th className="p-2.5 text-center">{t('المستند الأصلي', 'Source Doc')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1E3357]">
                  {custodyReturnRequests.map((req) => {
                    const reqTotal = (req.items || []).reduce((s, i) => s + Number(i.requestedQty || 0), 0);
                    const recTotal = (req.items || []).reduce((s, i) => s + Number(i.actualReceivedQty || 0), 0);
                    const appTotal = (req.items || []).reduce((s, i) => s + Number(i.approvedQty || 0), 0);
                    const remTotal = (req.items || []).reduce((s, i) => s + Number(i.remainingCustodyQty || 0), 0);
                    return (
                      <tr key={req.id} className="hover:bg-slate-50/70 dark:hover:bg-[#13264A]/40">
                        <td className="p-2.5 font-mono font-black text-[#003589] dark:text-[#7FB2FF]">{req.requestNumber}</td>
                        <td className="p-2.5 font-bold">{req.representativeName}</td>
                        <td className="p-2.5 text-[11px]">
                          <strong>[{fmt(reqTotal)}]</strong>{' '}
                          {(req.items || []).map((i) => `${i.productName} (${fmt(i.requestedQty)})`).join(' · ')}
                        </td>
                        <td className="p-2.5 text-center font-mono font-bold text-blue-700">{fmt(recTotal)}</td>
                        <td className="p-2.5 text-center font-mono font-bold text-emerald-700">{fmt(appTotal)}</td>
                        <td className="p-2.5 text-center font-mono font-bold text-amber-700">{fmt(remTotal)}</td>
                        <td className="p-2.5 text-center">
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] text-[10px] font-bold">
                            {t(req.status)}
                          </span>
                        </td>
                        <td className="p-2.5 text-[10px] font-mono">
                          <div>{t('إرسال:', 'S:')} {formatIsoDateTime(req.sentAt, isRtl)}</div>
                          {req.reviewedAt && <div>{t('مراجعة:', 'R:')} {formatIsoDateTime(req.reviewedAt, isRtl)}</div>}
                          {req.approvedAt && <div>{t('اعتماد:', 'A:')} {formatIsoDateTime(req.approvedAt, isRtl)}</div>}
                        </td>
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setSourceDocTarget({
                                docType: 'custody_return_request',
                                docId: req.id,
                                docNumber: req.requestNumber,
                              })
                            }
                            className="h-7 px-2.5 rounded bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{t('فتح المستند', 'Open Doc')}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}

          {/* ج. سجل عمليات الإرسال */}
          {activeLogTab === 'dispatch_logs' && (
            <div className="divide-y divide-slate-100 dark:divide-[#1E3357]">
              {dispatchLogs.length === 0 && localSendHistory.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  <Clock className="w-5 h-5 mx-auto mb-1 opacity-60" />
                  <p className="font-bold">{t('لا توجد عمليات إرسال مسجلة حتى الآن.', 'No dispatch operations recorded yet.')}</p>
                </div>
              ) : (
                <>
                  {dispatchLogs.length > 0 && (
                    <table className="w-full text-xs text-start border-collapse">
                      <thead className="bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] text-[11px] border-b border-slate-200 dark:border-[#21375C]">
                        <tr>
                          <th className="p-2.5 text-start">{t('نوع العملية', 'Operation Type')}</th>
                          <th className="p-2.5 text-start">{t('رقم المستند', 'Document #')}</th>
                          <th className="p-2.5 text-start">{t('المرسل', 'Sender')}</th>
                          <th className="p-2.5 text-start">{t('المستلم', 'Receiver')}</th>
                          <th className="p-2.5 text-start">{t('التاريخ والوقت', 'Timestamp')}</th>
                          <th className="p-2.5 text-center">{t('المدة', 'Duration')}</th>
                          <th className="p-2.5 text-center">{t('نتيجة الإرسال', 'Send Result')}</th>
                          <th className="p-2.5 text-center">{t('المستند الأصلي', 'Source Doc')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-[#1E3357]">
                        {dispatchLogs.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-[#13264A]/40">
                            <td className="p-2.5 font-bold">{row.operationTypeLabel}</td>
                            <td className="p-2.5 font-mono font-black text-[#003589] dark:text-[#7FB2FF]">{row.documentNumber}</td>
                            <td className="p-2.5">{row.senderName || '-'}</td>
                            <td className="p-2.5 font-semibold">{row.receiverName || '-'}</td>
                            <td className="p-2.5 font-mono text-[11px]">{formatIsoDateTime(row.timestamp, isRtl)}</td>
                            <td className="p-2.5 text-center font-mono text-[11px]">
                              {row.durationMs != null ? formatDurationAr(row.durationMs) : '-'}
                            </td>
                            <td className="p-2.5 text-center">
                              <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                                {row.sendResult}
                              </span>
                            </td>
                            <td className="p-2.5 text-center">
                              <button
                                type="button"
                                onClick={() =>
                                  setSourceDocTarget({
                                    docType: row.docType,
                                    docId: row.docId,
                                    docNumber: row.documentNumber,
                                  })
                                }
                                className="h-7 px-2.5 rounded bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>{t('فتح المستند', 'Open Doc')}</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {localSendHistory.map((entry: SendReceiveHistoryEntry) => {
                    const dt = splitDateTimeParts(entry.finishedAt || entry.startedAt);
                    return (
                      <div
                        key={entry.id}
                        data-testid="history-entry"
                        className="px-3.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs bg-slate-50/40"
                      >
                        <div className="flex items-center gap-2">
                          <ArrowUpCircle className="w-4 h-4 text-[#003589]" />
                          <span className="font-bold">{t('إرسال محلي عبر شاشة الإرسال والاستلام', 'Manual Client Send Batch')}</span>
                          {entry.detailsSummary && (
                            <span className="text-[11px] text-slate-600">· {entry.detailsSummary}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] font-mono">
                          <span>{dt ? `${dt.date}${dt.time ? ` ${dt.time}` : ''}` : ''}</span>
                          <span className="px-2 py-0.5 rounded bg-slate-100 border font-bold">
                            {formatDurationAr(entry.durationMs)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* د. سجل عمليات الاستلام والتأكيد */}
          {activeLogTab === 'confirmation_logs' && (
            confirmationLogs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                <Clock className="w-5 h-5 mx-auto mb-1 opacity-60" />
                <p className="font-bold">{t('لا توجد عمليات استلام وتأكيد مطابقة للفلاتر الحالية.', 'No receipt confirmation logs match the current filters.')}</p>
              </div>
            ) : (
              <table className="w-full text-xs text-start border-collapse">
                <thead className="bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] text-[11px] border-b border-slate-200 dark:border-[#21375C]">
                  <tr>
                    <th className="p-2.5 text-start">{t('نوع العملية', 'Operation')}</th>
                    <th className="p-2.5 text-start">{t('رقم المستند', 'Document #')}</th>
                    <th className="p-2.5 text-center">{t('حالة الوصول والتأكيد', 'Arrival & Confirmation')}</th>
                    <th className="p-2.5 text-center">{t('الكمية المعتمدة', 'Approved Qty')}</th>
                    <th className="p-2.5 text-center">{t('المرفوض / المختلف عليه', 'Rejected / Disputed')}</th>
                    <th className="p-2.5 text-start">{t('المستخدم المؤكد', 'Confirmed By')}</th>
                    <th className="p-2.5 text-start">{t('التاريخ والوقت', 'Timestamp')}</th>
                    <th className="p-2.5 text-center">{t('المستند الأصلي', 'Source Doc')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1E3357]">
                  {confirmationLogs.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-[#13264A]/40">
                      <td className="p-2.5 font-bold">{row.operationTypeLabel}</td>
                      <td className="p-2.5 font-mono font-black text-[#003589] dark:text-[#7FB2FF]">{row.documentNumber}</td>
                      <td className="p-2.5 text-center">
                        <div className="space-y-0.5">
                          <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                            {row.arrivedStatus}
                          </span>
                          <div className="text-[10px] text-slate-500">
                            {row.repConfirmed && t('تأكيد المندوب', 'Rep Confirmed')}
                            {row.repConfirmed && row.adminConfirmed ? ' · ' : ''}
                            {row.adminConfirmed && t('اعتماد الإدارة', 'Admin Approved')}
                          </div>
                        </div>
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-emerald-700">
                        {row.approvedQty !== undefined ? fmt(row.approvedQty) : '-'}
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-rose-700">
                        {row.rejectedOrDisputedQty !== undefined ? fmt(row.rejectedOrDisputedQty) : '0'}
                      </td>
                      <td className="p-2.5 font-semibold">{row.confirmedByName || '-'}</td>
                      <td className="p-2.5 font-mono text-[11px]">{formatIsoDateTime(row.confirmedAt, isRtl)}</td>
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setSourceDocTarget({
                              docType: row.docType,
                              docId: row.docId,
                              docNumber: row.documentNumber,
                            })
                          }
                          className="h-7 px-2.5 rounded bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>{t('فتح المستند', 'Open Doc')}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </section>

      {/* SEND CONFIRMATION MODAL */}
      <Modal
        isOpen={Boolean(sendSummaryModalOps)}
        onClose={() => setSendSummaryModalOps(null)}
        title={t('ملخص وتأكيد الإرسال', 'Send Summary & Confirmation')}
        maxWidth="lg"
      >
        {sendSummaryModalOps && (
          <div data-testid="send-confirm-modal" className="space-y-3 text-xs">
            <div className="rounded-md bg-[#EEF3FA] dark:bg-[#13294E] border border-[#DCE6F5] dark:border-[#24437A] p-3 flex items-center justify-between gap-2">
              <span className="font-black text-[#011E58] dark:text-[#F3F7FC]">
                {t('إجمالي العمليات الجاهزة للإرسال:', 'Total operations ready to send:')}
              </span>
              <span className="font-mono text-base font-black text-[#003589] dark:text-[#60A5FA] tabular-nums">
                {formatLocaleNumber(sendSummaryModalOps.length)}
              </span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-[#1E3357] rounded-md border border-slate-200 dark:border-[#21375C] bg-white dark:bg-[#0A162B] max-h-60 overflow-y-auto">
              {sendSummaryBreakdown.map((item) => (
                <div key={item.type} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block font-black text-slate-900 dark:text-[#F3F7FC]">
                      {item.label}
                    </span>
                    {item.samples.length > 0 && (
                      <span className="block text-[11px] font-mono text-slate-500 dark:text-[#8CA3C7] truncate">
                        {item.samples.join(' · ')}
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-black text-[#003589] dark:text-[#60A5FA] tabular-nums shrink-0">
                    {formatLocaleNumber(item.count)}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSendSummaryModalOps(null)}
                className="h-9 px-3.5 rounded-md border border-slate-300 dark:border-[#2B436E] bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-send-modal-btn"
                onClick={handleConfirmSend}
                className="h-9 px-4 rounded-md bg-[#003589] hover:bg-[#011E58] dark:bg-[#1659C8] text-white font-black flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{t('تأكيد الإرسال الآن', 'Confirm Send Now')}</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* RECEIVE PREVIEW CONFIRMATION MODAL */}
      <Modal
        isOpen={Boolean(receivePreviewState)}
        onClose={() => setReceivePreviewState(null)}
        title={t('ملخص التحديثات المتاحة للاستلام', 'Incoming Updates Summary')}
        maxWidth="xl"
      >
        {receivePreviewState && previewSummary && previewItems && (
          <div data-testid="receive-confirm-modal" className="space-y-3 text-xs">
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-700/60 p-2.5 font-bold text-emerald-900 dark:text-emerald-200">
              {hasPreviewActions
                ? t(
                    'راجع التحديثات والعهد الواردة أدناه ثم اضغط «تأكيد الاستلام» لتطبيقها وإدخال العهدة.',
                    'Review incoming updates and custody items below, then click "Confirm Receipt" to apply them.'
                  )
                : t(
                    'لا توجد عهد أصناف أو تحويلات أو تحديثات جديدة حالياً. اضغط «تأكيد الاستلام» لتسجيل الفحص أو «إغلاق».',
                    'No new custody dispatches, transfers, or updates are pending right now.'
                  )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="rounded-md border border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#0A162B] p-2">
                <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-[#9AB0D2]">
                  <Package className="w-3.5 h-3.5 text-[#003589] dark:text-[#60A5FA]" />
                  {t('أوامر تحويل واردة', 'Transfer Orders')}
                </span>
                <span className="font-mono text-base font-black text-slate-900 dark:text-[#F3F7FC] tabular-nums">
                  {formatLocaleNumber(previewSummary.custodyDispatchesCount)}
                </span>
              </div>

              <div className="rounded-md border border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#0A162B] p-2">
                <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-[#9AB0D2]">
                  <Wallet className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                  {t('تحويلات نقدية', 'Cash Transfers')}
                </span>
                <span className="font-mono text-base font-black text-slate-900 dark:text-[#F3F7FC] tabular-nums">
                  {formatLocaleNumber(previewSummary.cashTransfersCount)}
                </span>
              </div>

              <div className="rounded-md border border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#0A162B] p-2">
                <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-[#9AB0D2]">
                  <Users className="w-3.5 h-3.5 text-[#003589] dark:text-[#60A5FA]" />
                  {t('أصناف/عملاء/فواتير محدثة', 'Catalog / Customers / Docs')}
                </span>
                <span className="font-mono text-base font-black text-slate-900 dark:text-[#F3F7FC] tabular-nums">
                  {(previewSummary.updatedCatalogCount || 0) +
                    (previewSummary.updatedCustomersCount || 0) +
                    (previewSummary.updatedInvoicesCount || 0) +
                    previewSummary.dispatchBatchesCount}
                </span>
              </div>
            </div>

            {previewItems.custodyDispatches.length > 0 && (
              <div className="space-y-1">
                <h3 className="font-black text-slate-800 dark:text-[#E2ECFA]">
                  {t('أوامر التحويل بانتظار تأكيد الاستلام', 'Transfer Orders Awaiting Confirmation')}
                </h3>
                <div className="divide-y divide-slate-100 dark:divide-[#1E3357] rounded-md border border-slate-200 dark:border-[#21375C] max-h-40 overflow-y-auto">
                  {previewItems.custodyDispatches.map((cd) => {
                    const checked = selectedCustodyIds.includes(cd.id);
                    return (
                      <label
                        key={cd.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#13264A]"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedCustodyIds((prev) =>
                                e.target.checked ? [...prev, cd.id] : prev.filter((x) => x !== cd.id)
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block font-black text-slate-900 dark:text-[#F3F7FC] truncate">
                              {cd.requestNumber || cd.id} · {cd.sourceWarehouseName} → {cd.targetWarehouseName}
                            </span>
                            <span className="block text-[11px] text-slate-500 dark:text-[#8CA3C7] truncate">
                              {cd.date}{cd.notes ? ` · ${cd.notes}` : ''}
                            </span>
                          </span>
                        </span>
                        <span className="font-mono font-bold text-slate-700 dark:text-[#D1DFF3] shrink-0">
                          {formatLocaleNumber(cd.itemsCount || 0)} {t('صنف', 'items')} ({formatLocaleNumber(cd.totalQty || 0)})
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {previewItems.cashTransfers.length > 0 && (
              <div className="space-y-1">
                <h3 className="font-black text-slate-800 dark:text-[#E2ECFA]">
                  {t('التحويلات النقدية الواردة', 'Incoming Cash Transfers')}
                </h3>
                <div className="divide-y divide-slate-100 dark:divide-[#1E3357] rounded-md border border-slate-200 dark:border-[#21375C] max-h-36 overflow-y-auto">
                  {previewItems.cashTransfers.map((ct) => {
                    const checked = selectedCashIds.includes(ct.id);
                    return (
                      <label
                        key={ct.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#13264A]"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedCashIds((prev) =>
                                e.target.checked ? [...prev, ct.id] : prev.filter((x) => x !== ct.id)
                              )
                            }
                          />
                          <span className="font-black text-slate-900 dark:text-[#F3F7FC]">
                            {ct.transferNumber || ct.id} · {ct.senderName} ({ct.direction})
                          </span>
                        </span>
                        <span className="font-mono font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {formatLocaleNumber(roundCurrency(ct.amount))} {currencyLabel}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {previewItems.dispatchBatches.length > 0 && (
              <div className="space-y-1">
                <h3 className="font-black text-slate-800 dark:text-[#E2ECFA]">
                  {t('دفعات مستندات واردة', 'Incoming Document Batches')}
                </h3>
                <div className="divide-y divide-slate-100 dark:divide-[#1E3357] rounded-md border border-slate-200 dark:border-[#21375C] max-h-36 overflow-y-auto">
                  {previewItems.dispatchBatches.map((bt) => {
                    const checked = selectedBatchIds.includes(bt.id);
                    return (
                      <label
                        key={bt.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#13264A]"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedBatchIds((prev) =>
                                e.target.checked ? [...prev, bt.id] : prev.filter((x) => x !== bt.id)
                              )
                            }
                          />
                          <span className="font-black text-slate-900 dark:text-[#F3F7FC]">
                            {bt.batchNumber} · {bt.senderName}
                          </span>
                        </span>
                        <span className="font-mono font-bold text-slate-700 dark:text-[#D1DFF3] tabular-nums">
                          {formatLocaleNumber(bt.salesCount + bt.collectionsCount + bt.returnsCount)}{' '}
                          {t('مستند', 'docs')}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {((previewSummary.updatedCatalogCount || 0) > 0 ||
              (previewSummary.updatedCustomersCount || 0) > 0 ||
              (previewSummary.updatedInvoicesCount || 0) > 0) && (
              <div className="rounded-md border border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#0A162B] p-2.5 text-[11px] space-y-1">
                <div className="font-black text-slate-800 dark:text-[#E2ECFA]">
                  {t('ملخص تحديثات البيانات الأساسية:', 'Master Data Updates Summary:')}
                </div>
                <div className="flex flex-wrap gap-3 text-slate-600 dark:text-[#A9BCD9] font-bold">
                  {(previewSummary.updatedCatalogCount || 0) > 0 && (
                    <span>
                      {t('أصناف محدثة:', 'Updated Products:')} {formatLocaleNumber(previewSummary.updatedCatalogCount || 0)}
                    </span>
                  )}
                  {(previewSummary.updatedCustomersCount || 0) > 0 && (
                    <span>
                      {t('عملاء محدثون:', 'Updated Customers:')} {formatLocaleNumber(previewSummary.updatedCustomersCount || 0)}
                    </span>
                  )}
                  {(previewSummary.updatedInvoicesCount || 0) > 0 && (
                    <span>
                      {t('فواتير محدثة:', 'Updated Invoices:')} {formatLocaleNumber(previewSummary.updatedInvoicesCount || 0)}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setReceivePreviewState(null)}
                className="h-9 px-3.5 rounded-md border border-slate-300 dark:border-[#2B436E] bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-receive-modal-btn"
                onClick={handleConfirmReceive}
                className="h-9 px-4 rounded-md bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 text-white font-black flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{t('تأكيد الاستلام', 'Confirm Receipt')}</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* CONFLICTS MODAL */}
      <Modal
        isOpen={conflictsModalOpen}
        onClose={() => setConflictsModalOpen(false)}
        title={t('مراجعة تعارضات المزامنة', 'Review Sync Conflicts')}
        maxWidth="lg"
      >
        <div className="space-y-2 text-xs">
          {unresolvedConflicts.length === 0 ? (
            <p className="text-slate-500 dark:text-[#9AB0D2] font-bold py-4 text-center">
              {t('لا توجد تعارضات حالياً.', 'No pending conflicts.')}
            </p>
          ) : (
            unresolvedConflicts.map((cf) => (
              <div
                key={cf.id}
                className="rounded-md border border-amber-200 dark:border-amber-700/60 bg-amber-50/70 dark:bg-amber-950/30 p-3 space-y-2"
              >
                <div className="font-black text-slate-900 dark:text-[#F3F7FC]">
                  {cf.operationType} · {cf.entityId || cf.operationId}
                </div>
                <p className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                  {cf.conflictReason}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleResolveConflict(cf, 'apply_local')}
                    className="h-8 px-2.5 rounded-md bg-[#003589] text-white font-bold cursor-pointer"
                  >
                    {t('تطبيق المحلي', 'Apply Local')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolveConflict(cf, 'keep_server')}
                    className="h-8 px-2.5 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-300 dark:border-[#2B436E] text-slate-800 dark:text-[#DCE6F5] font-bold cursor-pointer"
                  >
                    {t('اعتماد نسخة الخادم', 'Keep Server')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolveConflict(cf, 'dismiss')}
                    className="h-8 px-2.5 rounded-md bg-white dark:bg-[#0E1C36] border border-rose-300 dark:border-rose-700/60 text-rose-700 dark:text-rose-300 font-bold cursor-pointer"
                  >
                    {t('تجاهل', 'Dismiss')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <OriginalSourceDocumentModal target={sourceDocTarget} onClose={() => setSourceDocTarget(null)} />
    </div>
  );
};

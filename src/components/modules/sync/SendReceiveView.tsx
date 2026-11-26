import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Eye,
  Package,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Wallet,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import type {
  ReceivePreviewResponse,
  RepItemTransferRequest,
  RepTransfer,
  SyncConflictRecord,
  SyncDispatchBatch,
  SyncQueueItem,
} from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import {
  formatCountdownMmSs,
  formatMobileSyncTimestamp,
} from '../../../services/syncEngine';
import { roundCurrency } from '../../../utils/quantity';
import { UnifiedColumn, UnifiedDataTable } from '../../common/UnifiedDataTable';
import { Modal } from '../../common/Modal';

export interface SendReceiveViewProps {
  onBack?: () => void;
}

type SendReceiveTab = 'batches' | 'transfers' | 'conflicts';

export const SendReceiveView: React.FC<SendReceiveViewProps> = ({ onBack }) => {
  const { currentUser } = useAuth();
  const {
    networkStatus,
    isSyncing,
    pendingSyncCount,
    failedSyncCount,
    conflictsCount,
    syncQueue,
    syncConflicts,
    syncDispatchBatches,
    dispatchRecipients,
    incomingDispatchCount,
    serverSyncState,
    sendProgressPercent,
    sendProgressStage,
    receiveProgressPercent,
    receiveProgressStage,
    mandatorySendEnabled,
    mandatorySendRemainingSeconds,
    isMandatorySending,
    isMandatorySendPendingRetry,
    triggerMandatorySendNow,
    sendSyncOperations,
    previewReceiveUpdates,
    confirmReceiveUpdates,
    triggerManualSync,
    createAndSendDispatchBatch,
    retryDispatchBatch,
    confirmDispatchReceipt,
    failDispatchReceipt,
    refreshDispatches,
    resolveSyncConflict,
    repTransfers,
    repItemTransfers,
    representatives,
    confirmRepTransferReceipt,
    rejectRepTransfer,
    updateRepItemTransferStatus,
    settings,
  } = useData();
  const { t, locale, dir, isRtl } = usePreferences();

  const [activeTab, setActiveTab] = useState<SendReceiveTab>('batches');
  const [selectedOpIds, setSelectedOpIds] = useState<string[]>([]);
  const [recipientUserId, setRecipientUserId] = useState<string>('');
  const [batchNotes, setBatchNotes] = useState<string>('');
  const [pendingSendConfirm, setPendingSendConfirm] = useState<{
    ops: SyncQueueItem[];
    recipientUserId: string;
    recipientName: string;
    notes: string;
  } | null>(null);
  const [isManualSendModalOpen, setIsManualSendModalOpen] = useState(false);
  const [receivePreviewModal, setReceivePreviewModal] = useState<ReceivePreviewResponse | null>(null);
  const [selectedReceiveBatchIds, setSelectedReceiveBatchIds] = useState<string[]>([]);
  const [selectedReceiveCashIds, setSelectedReceiveCashIds] = useState<string[]>([]);
  const [selectedReceiveCustodyIds, setSelectedReceiveCustodyIds] = useState<string[]>([]);
  const [isCheckingPreview, setIsCheckingPreview] = useState(false);

  const [inspectedBatch, setInspectedBatch] = useState<SyncDispatchBatch | null>(null);
  const [receiptNotesInput, setReceiptNotesInput] = useState('');
  const [hasDiscrepancyInput, setHasDiscrepancyInput] = useState(false);
  const [discrepancyNote, setDiscrepancyNote] = useState('');
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [isRejectBoxOpen, setIsRejectBoxOpen] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [banner, setBanner] = useState<{
    type: 'success' | 'error' | 'warning' | 'info';
    text: string;
  } | null>(null);

  const isRepRole = currentUser?.role === 'representative';
  const myRepProfile = useMemo(
    () => (representatives || []).find((r) => r.userId === currentUser?.id),
    [representatives, currentUser?.id]
  );

  const pendingOps = useMemo(
    () => (syncQueue || []).filter((q) => q.status !== 'synced'),
    [syncQueue]
  );

  const pendingByCategory = useMemo(() => {
    const counts = {
      sales: 0,
      collections: 0,
      returns: 0,
      customers: 0,
      orders: 0,
      transfers: 0,
      other: 0,
    };
    for (const op of pendingOps) {
      const tp = op.operationType;
      if (['create_invoice', 'confirm_draft_invoice', 'edit_sales_invoice', 'cancel_invoice', 'mark_invoice_reviewed'].includes(tp)) {
        counts.sales += 1;
      } else if (['record_customer_payment', 'add_invoice_payment', 'cash_operation', 'record_order_advance_payment'].includes(tp)) {
        counts.collections += 1;
      } else if (['create_return', 'create_sales_return_request', 'create_purchase_return_request'].includes(tp)) {
        counts.returns += 1;
      } else if (['add_customer', 'update_customer', 'update_customer_favorites'].includes(tp)) {
        counts.customers += 1;
      } else if (['create_order', 'update_order_delivery_status', 'update_customer_item_order', 'update_customer_item_order_content', 'cancel_customer_item_order'].includes(tp)) {
        counts.orders += 1;
      } else if (['create_rep_transfer', 'confirm_rep_transfer', 'reject_rep_transfer', 'create_rep_item_transfer', 'update_rep_item_transfer_status', 'create_stock_transfer_request', 'execute_stock_transfer_request'].includes(tp)) {
        counts.transfers += 1;
      } else {
        counts.other += 1;
      }
    }
    return counts;
  }, [pendingOps]);

  useEffect(() => {
    if (!recipientUserId && dispatchRecipients.length > 0) {
      setRecipientUserId(dispatchRecipients[0].id);
    }
  }, [dispatchRecipients, recipientUserId]);

  useEffect(() => {
    setSelectedOpIds((prev) => {
      const validIds = new Set(pendingOps.map((op) => op.operationId));
      const kept = prev.filter((id) => validIds.has(id));
      if (kept.length > 0) return kept;
      return pendingOps.map((op) => op.operationId);
    });
  }, [pendingOps]);

  const actionableCashTransfers = useMemo(() => {
    return (repTransfers || []).filter((trItem) => {
      if (trItem.status !== 'awaiting_receipt' || !currentUser || currentUser.role === 'customer') {
        return false;
      }
      if (isRepRole) {
        if (!myRepProfile) return false;
        return (
          (trItem.direction === 'owner_to_rep' || trItem.direction === 'rep_to_rep') &&
          trItem.receiverId === myRepProfile.id &&
          trItem.senderId !== myRepProfile.id
        );
      }
      const p = currentUser.permissions || {};
      return (
        currentUser.role === 'admin' ||
        currentUser.role === 'manager' ||
        Boolean(p.canManageTransfers || p.canManageReps || p.canManageCashboxes || p.canApprove)
      );
    });
  }, [repTransfers, currentUser, isRepRole, myRepProfile]);

  const actionableItemTransfers = useMemo(() => {
    return (repItemTransfers || []).filter((reqItem) => {
      if (!currentUser || currentUser.role === 'customer') return false;
      if (isRepRole) {
        if (!myRepProfile) return false;
        return (
          reqItem.status === 'executed' &&
          reqItem.representativeId === myRepProfile.id &&
          reqItem.senderRepresentativeId !== myRepProfile.id
        );
      }
      const p = currentUser.permissions || {};
      if (
        currentUser.role !== 'admin' &&
        currentUser.role !== 'manager' &&
        !p.canManageTransfers &&
        !p.canManageReps &&
        !p.canApprove
      ) {
        return false;
      }
      return reqItem.status === 'pending' || reqItem.status === 'approved' || reqItem.status === 'executed';
    });
  }, [repItemTransfers, currentUser, isRepRole, myRepProfile]);

  const kpiStats = useMemo(() => {
    const readyToSend = pendingOps.length;
    const awaitingReceiveTotal =
      incomingDispatchCount + actionableCashTransfers.length + actionableItemTransfers.length;
    return {
      readyToSend,
      awaitingReceiveTotal,
      pendingTransfersCount: actionableCashTransfers.length + actionableItemTransfers.length,
      conflictsTotal: syncConflicts.length,
    };
  }, [
    pendingOps.length,
    incomingDispatchCount,
    actionableCashTransfers.length,
    actionableItemTransfers.length,
    syncConflicts.length,
  ]);

  const formattedLastSend = useMemo(
    () => formatMobileSyncTimestamp(serverSyncState?.lastSendAt || undefined),
    [serverSyncState?.lastSendAt]
  );
  const formattedLastReceive = useMemo(
    () => formatMobileSyncTimestamp(serverSyncState?.lastReceiveAt || undefined),
    [serverSyncState?.lastReceiveAt]
  );

  const fmtDate = (iso?: string) => {
    if (!iso) return '—';
    const formatted = formatMobileSyncTimestamp(iso);
    return formatted ? formatted.fullText : iso;
  };

  const fmtMoney = (val: number) =>
    `${roundCurrency(val).toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${t(settings?.currency || 'ج.م')}`;

  const formatSyncSummaryMap = (summaryMap?: Record<string, number> | null): string => {
    if (!summaryMap || typeof summaryMap !== 'object') return '';
    return Object.entries(summaryMap)
      .filter(([, count]) => Number(count) > 0)
      .map(([k, count]) => `${t(k)}: ${count}`)
      .join(' · ');
  };

  const handleOpenManualSendModal = () => {
    setBanner(null);
    if (pendingOps.length === 0) {
      setBanner({
        type: 'info',
        text: t('لا توجد عمليات معلقة للإرسال حالياً', 'No pending local operations to send right now'),
      });
      return;
    }
    setIsManualSendModalOpen(true);
  };

  const handleExecuteManualSend = async () => {
    setIsSubmittingAction(true);
    setBanner(null);
    try {
      const res = await sendSyncOperations();
      await refreshDispatches();
      if (res.ok && res.failedCount === 0) {
        setIsManualSendModalOpen(false);
        setBanner({
          type: 'success',
          text:
            res.sentCount > 0
              ? t(
                  `تم إرسال ${res.sentCount} عملية وتحديث وقت آخر إرسال بنجاح`,
                  `Sent ${res.sentCount} operation(s) and updated last send timestamp`
                )
              : t('لا توجد عمليات معلقة للإرسال', 'No pending operations to send'),
        });
      } else {
        setBanner({
          type: res.failedCount > 0 ? 'error' : 'warning',
          text:
            res.error ||
            t(
              `تعذر إرسال ${res.failedCount} عملية — بقيت العمليات المتعثرة في الطابور للمحاولة مجدداً دون فقدان`,
              `${res.failedCount} operation(s) failed — retained in queue for safe retry`
            ),
        });
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleQuickReceive = async () => {
    setBanner(null);
    setIsCheckingPreview(true);
    try {
      const result = await previewReceiveUpdates();
      if (!result.ok || !result.preview) {
        setBanner({
          type: 'error',
          text: result.error || t('تعذر فحص التحديثات الواردة من السيرفر', 'Could not check incoming updates from server'),
        });
        return;
      }
      const pv = result.preview;
      if (pv.totalItemsCount === 0) {
        setBanner({
          type: 'info',
          text: t('لا توجد بيانات جديدة للاستلام حالياً', 'No new data available to receive right now'),
        });
        return;
      }
      setSelectedReceiveBatchIds(pv.items.dispatchBatches.map((b) => b.id));
      setSelectedReceiveCashIds(pv.items.cashTransfers.map((c) => c.id));
      setSelectedReceiveCustodyIds(pv.items.custodyDispatches.map((i) => i.id));
      setReceivePreviewModal(pv);
    } finally {
      setIsCheckingPreview(false);
    }
  };

  const handleConfirmManualReceive = async () => {
    if (!receivePreviewModal) return;
    setIsSubmittingAction(true);
    setBanner(null);
    try {
      const res = await confirmReceiveUpdates({
        confirmBatchIds: selectedReceiveBatchIds,
        confirmCashTransferIds: selectedReceiveCashIds,
        confirmCustodyIds: selectedReceiveCustodyIds,
      });
      await refreshDispatches();
      if (res.ok) {
        const count = res.response?.receivedCount || 0;
        setReceivePreviewModal(null);
        setBanner({
          type: 'success',
          text: t(
            `تم تأكيد الاستلام وتحديث البيانات (${count} عناصر مستلمة)`,
            `Receipt confirmed and data updated (${count} items received)`
          ),
        });
      } else {
        setBanner({
          type: 'error',
          text: res.error || t('تعذر تأكيد الاستلام حالياً', 'Could not confirm receipt right now'),
        });
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handlePrepareBatchSend = () => {
    setBanner(null);
    const ops = pendingOps.filter((op) => selectedOpIds.includes(op.operationId));
    if (ops.length === 0) {
      setBanner({
        type: 'warning',
        text: t('يرجى تحديد عملية واحدة على الأقل للإرسال', 'Please select at least one operation to send'),
      });
      return;
    }
    const chosenRecip = dispatchRecipients.find((r) => r.id === recipientUserId);
    if (!chosenRecip) {
      setBanner({
        type: 'warning',
        text: t('يرجى اختيار المستلم أولاً', 'Please select a recipient first'),
      });
      return;
    }
    setPendingSendConfirm({
      ops,
      recipientUserId: chosenRecip.id,
      recipientName: chosenRecip.fullName,
      notes: batchNotes.trim(),
    });
  };

  const handleConfirmSendBatch = async () => {
    if (!pendingSendConfirm) return;
    setIsSubmittingAction(true);
    try {
      const res = await createAndSendDispatchBatch({
        selectedOperations: pendingSendConfirm.ops,
        recipientUserId: pendingSendConfirm.recipientUserId,
        notes: pendingSendConfirm.notes,
      });
      setPendingSendConfirm(null);
      if (res.success) {
        setBatchNotes('');
        setBanner({
          type: 'success',
          text: t('تم إرسال الدفعة الرسمية بنجاح', 'Official batch sent successfully'),
        });
      } else if (res.queuedOfflineConfirmed) {
        setBatchNotes('');
        setBanner({
          type: 'info',
          text: res.error || t('تم تأكيد الإرسال محلياً وسيتم الرفع فور توفر الاتصال', 'Send confirmed locally and will upload once connected'),
        });
      } else {
        setBanner({
          type: 'error',
          text: res.error || t('فشل إرسال الدفعة', 'Failed to send batch'),
        });
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Strictly read-only inspection (never auto-mutates receiptStatus)
  const handleOpenInspectBatch = (batch: SyncDispatchBatch) => {
    setInspectedBatch(batch);
    setReceiptNotesInput('');
    setHasDiscrepancyInput(false);
    setDiscrepancyNote('');
    setRejectReasonInput('');
    setIsRejectBoxOpen(false);
  };

  const handleConfirmInspectedBatch = async () => {
    if (!inspectedBatch) return;
    if (hasDiscrepancyInput && !discrepancyNote.trim()) {
      setBanner({
        type: 'warning',
        text: t('يرجى كتابة ملاحظة الاختلاف عند تحديد وجود فرق', 'Please enter a discrepancy note when flagging a difference'),
      });
      return;
    }
    setIsSubmittingAction(true);
    try {
      const res = await confirmDispatchReceipt(inspectedBatch.id, {
        receiptNotes: receiptNotesInput.trim(),
        hasDiscrepancy: hasDiscrepancyInput,
        discrepancyNote: discrepancyNote.trim(),
      });
      if (res.success) {
        setInspectedBatch(null);
        setBanner({
          type: 'success',
          text: t('تم تأكيد استلام الدفعة بنجاح', 'Batch receipt confirmed successfully'),
        });
      } else {
        setBanner({
          type: 'error',
          text: res.error || t('تعذر تأكيد الاستلام', 'Could not confirm receipt'),
        });
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleFailInspectedBatch = async () => {
    if (!inspectedBatch) return;
    if (!rejectReasonInput.trim()) {
      setBanner({
        type: 'warning',
        text: t('يرجى كتابة سبب تعذر الاستلام', 'Please provide a reason for receipt failure'),
      });
      return;
    }
    setIsSubmittingAction(true);
    try {
      const res = await failDispatchReceipt(inspectedBatch.id, rejectReasonInput.trim());
      if (res.success) {
        setInspectedBatch(null);
        setBanner({
          type: 'warning',
          text: t('تم تسجيل تعذر استلام الدفعة', 'Batch receipt marked as failed'),
        });
      } else {
        setBanner({
          type: 'error',
          text: res.error || t('تعذر تسجيل الرفض', 'Could not record rejection'),
        });
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const getStatusTextClass = (status: string) => {
    if (status === 'تم الاستلام' || status === 'تم الإرسال') {
      return 'text-emerald-700 dark:text-emerald-400 font-black';
    }
    if (status === 'فشل الإرسال' || status === 'تعذر الاستلام') {
      return 'text-rose-700 dark:text-rose-400 font-black';
    }
    if (status === 'جاري الإرسال' || status === 'جاري الاستلام') {
      return 'text-blue-700 dark:text-blue-400 font-black';
    }
    return 'text-amber-700 dark:text-amber-400 font-black';
  };

  // Official 12-column Dispatch Batches table
  const dispatchColumns: UnifiedColumn<SyncDispatchBatch>[] = [
    {
      key: 'batchNumber',
      header: 'رقم العملية',
      sortable: true,
      sortValue: (b) => b.batchNumber || b.id,
      exportValue: (b) => b.batchNumber || b.id,
      render: (b) => (
        <span className="font-mono font-black text-[#011E58] dark:text-[#85B8FF]">
          {b.batchNumber || b.id}
        </span>
      ),
    },
    {
      key: 'senderName',
      header: 'المرسل',
      sortable: true,
      sortValue: (b) => b.senderName || '',
      exportValue: (b) => b.senderName || '',
      render: (b) => <span className="font-bold">{b.senderName || '—'}</span>,
    },
    {
      key: 'recipientName',
      header: 'المستلم',
      sortable: true,
      sortValue: (b) => b.recipientName || '',
      exportValue: (b) => b.recipientName || '',
      render: (b) => <span className="font-bold">{b.recipientName || '—'}</span>,
    },
    {
      key: 'sentAt',
      header: 'تاريخ الإرسال',
      sortable: true,
      sortValue: (b) => b.sentAt || b.createdAt || '',
      exportValue: (b) => fmtDate(b.sentAt || b.createdAt),
      render: (b) => <span className="text-[11px] font-mono tabular-nums">{fmtDate(b.sentAt || b.createdAt)}</span>,
    },
    {
      key: 'salesCount',
      header: 'عدد فواتير البيع',
      align: 'center',
      sortable: true,
      sortValue: (b) => Number(b.salesCount || 0),
      exportValue: (b) => Number(b.salesCount || 0),
      render: (b) => <span className="font-mono font-bold tabular-nums">{Number(b.salesCount || 0)}</span>,
    },
    {
      key: 'collectionsCount',
      header: 'عدد التحصيلات',
      align: 'center',
      sortable: true,
      sortValue: (b) => Number(b.collectionsCount || 0),
      exportValue: (b) => Number(b.collectionsCount || 0),
      render: (b) => <span className="font-mono font-bold tabular-nums">{Number(b.collectionsCount || 0)}</span>,
    },
    {
      key: 'returnsCount',
      header: 'عدد المرتجعات',
      align: 'center',
      sortable: true,
      sortValue: (b) => Number(b.returnsCount || 0),
      exportValue: (b) => Number(b.returnsCount || 0),
      render: (b) => <span className="font-mono font-bold tabular-nums">{Number(b.returnsCount || 0)}</span>,
    },
    {
      key: 'totalCashAmount',
      header: 'إجمالي التحصيلات',
      align: 'center',
      sortable: true,
      sortValue: (b) => Number(b.totalCashAmount || 0),
      exportValue: (b) => Number(b.totalCashAmount || 0),
      render: (b) => <span className="font-mono font-black tabular-nums">{fmtMoney(Number(b.totalCashAmount || 0))}</span>,
    },
    {
      key: 'sendStatus',
      header: 'حالة الإرسال',
      align: 'center',
      sortable: true,
      sortValue: (b) => b.sendStatus,
      exportValue: (b) => t(b.sendStatus),
      render: (b) => (
        <span className={`text-[11px] ${getStatusTextClass(b.sendStatus)}`}>
          {t(b.sendStatus)}
        </span>
      ),
    },
    {
      key: 'receiptStatus',
      header: 'حالة الاستلام',
      align: 'center',
      sortable: true,
      sortValue: (b) => b.receiptStatus,
      exportValue: (b) => t(b.receiptStatus),
      render: (b) => (
        <span className={`text-[11px] ${getStatusTextClass(b.receiptStatus)}`}>
          {t(b.receiptStatus)}
        </span>
      ),
    },
    {
      key: 'receivedAt',
      header: 'تاريخ الاستلام',
      sortable: true,
      sortValue: (b) => b.receivedAt || '',
      exportValue: (b) => fmtDate(b.receivedAt),
      render: (b) => <span className="text-[11px] font-mono tabular-nums">{fmtDate(b.receivedAt)}</span>,
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      align: 'center',
      exportValue: () => '',
      render: (b) => {
        const canRetry =
          b.senderUserId === currentUser?.id &&
          (b.sendStatus === 'فشل الإرسال' || b.sendStatus === 'جاهزة للإرسال');
        return (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleOpenInspectBatch(b)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#EEF3FA] dark:bg-[#172E56] text-[#003589] dark:text-[#85B8FF] border border-[#DCE6F5] dark:border-[#2A436E] text-[11px] font-bold hover:opacity-90 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{t('عرض', 'View')}</span>
            </button>
            {canRetry && (
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => retryDispatchBatch(b)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[11px] font-bold hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('إعادة إرسال', 'Retry')}</span>
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const isInspectedReceiver =
    inspectedBatch &&
    inspectedBatch.recipientUserId === currentUser?.id &&
    inspectedBatch.senderUserId !== currentUser?.id &&
    (inspectedBatch.receiptStatus === 'في انتظار الاستلام' ||
      inspectedBatch.receiptStatus === 'جاري الاستلام');

  return (
    <div dir={dir} data-testid="send-receive-view" className="space-y-3 text-xs">
      {/* Top Header & Quick Send / Receive Actions */}
      <div className="bg-white dark:bg-[#0E1C36] rounded-xl border border-slate-200 dark:border-[#21375C] p-3 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label={t('رجوع', 'Back')}
                className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-[#2A436E] bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] hover:bg-slate-100 cursor-pointer"
              >
                {isRtl ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
              </button>
            )}
            <div>
              <h2 className="text-sm sm:text-base font-black text-[#011E58] dark:text-[#F3F7FC]">
                {t('الإرسال والاستلام', 'Send & Receive')}
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-[#A9BCD9]">
                <span className="inline-flex items-center gap-1 font-bold">
                  {networkStatus === 'disconnected' ? (
                    <WifiOff className="w-3.5 h-3.5 text-rose-600" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                  )}
                  {networkStatus === 'disconnected'
                    ? t('وضع العمل دون اتصال', 'Offline Mode')
                    : networkStatus === 'synchronizing'
                    ? t('جاري المزامنة...', 'Synchronizing...')
                    : t('متصل بالسيرفر', 'Connected')}
                </span>
                {mandatorySendEnabled && (
                  <span className="inline-flex items-center gap-1 font-mono font-bold text-[#003589] dark:text-[#85B8FF]">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {t('الإرسال الإجباري بعد', 'Mandatory send in')}: {formatCountdownMmSs(mandatorySendRemainingSeconds)}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="sync-manual-send-btn"
              disabled={isSyncing || isMandatorySending || isSubmittingAction}
              onClick={handleOpenManualSendModal}
              className="min-h-[36px] px-3.5 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black text-xs inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <ArrowUpCircle className="w-4 h-4" />
              <span>
                {kpiStats.readyToSend > 0
                  ? `${t('إرسال', 'Send')} (${kpiStats.readyToSend})`
                  : t('إرسال', 'Send')}
              </span>
            </button>

            <button
              type="button"
              data-testid="sync-manual-receive-btn"
              disabled={isSyncing || isMandatorySending || isCheckingPreview}
              onClick={handleQuickReceive}
              className="min-h-[36px] px-3.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-black text-xs inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <ArrowDownCircle className="w-4 h-4" />
              <span>
                {isCheckingPreview
                  ? t('جاري الفحص...', 'Checking...')
                  : kpiStats.awaitingReceiveTotal > 0
                  ? `${t('استلام', 'Receive')} (${kpiStats.awaitingReceiveTotal})`
                  : t('استلام', 'Receive')}
              </span>
            </button>

            {failedSyncCount > 0 && (
              <button
                type="button"
                disabled={isSyncing || isSubmittingAction}
                onClick={handleExecuteManualSend}
                className="min-h-[36px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-black text-xs inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t(`إعادة المحاولة (${failedSyncCount})`, `Retry Failed (${failedSyncCount})`)}</span>
              </button>
            )}

            <button
              type="button"
              data-testid="sync-refresh-snapshot-btn"
              disabled={isSyncing || isMandatorySending}
              onClick={() => triggerManualSync()}
              className="min-h-[36px] px-2.5 rounded-lg border border-slate-300 dark:border-[#2A436E] bg-slate-50 dark:bg-[#132544] text-slate-800 dark:text-[#DCE6F5] font-bold text-xs inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer hover:bg-slate-100"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{t('تحديث', 'Refresh')}</span>
            </button>
          </div>
        </div>

        {/* Authoritative Per-User Send / Receive Timestamps & Pending Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="p-2.5 rounded-lg bg-[#EEF3FA]/70 dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#21375C]">
            <div className="text-[10px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('آخر إرسال مؤكد', 'Last Confirmed Send')}</div>
            <div data-testid="last-send-timestamp" className="font-mono font-bold tabular-nums text-[#011E58] dark:text-[#F3F7FC] truncate">
              {formattedLastSend ? formattedLastSend.fullText : t('لم يتم الإرسال بعد', 'Not sent yet')}
            </div>
            {serverSyncState?.lastSendAt && (
              <div className="text-[10px] text-slate-600 dark:text-[#8CA3C7] truncate mt-0.5">
                {t(`عدد العمليات: ${serverSyncState.lastSendCount}`, `Count: ${serverSyncState.lastSendCount}`)}
                {formatSyncSummaryMap(serverSyncState.lastSendSummary)
                  ? ` · ${formatSyncSummaryMap(serverSyncState.lastSendSummary)}`
                  : ''}
              </div>
            )}
          </div>

          <div className="p-2.5 rounded-lg bg-[#EEF3FA]/70 dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#21375C]">
            <div className="text-[10px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('آخر استلام مؤكد', 'Last Confirmed Receive')}</div>
            <div data-testid="last-receive-timestamp" className="font-mono font-bold tabular-nums text-[#011E58] dark:text-[#F3F7FC] truncate">
              {formattedLastReceive ? formattedLastReceive.fullText : t('لم يتم الاستلام بعد', 'Not received yet')}
            </div>
            {serverSyncState?.lastReceiveAt && (
              <div className="text-[10px] text-slate-600 dark:text-[#8CA3C7] truncate mt-0.5">
                {t(`عدد المستلم: ${serverSyncState.lastReceiveCount}`, `Count: ${serverSyncState.lastReceiveCount}`)}
                {formatSyncSummaryMap(serverSyncState.lastReceiveSummary)
                  ? ` · ${formatSyncSummaryMap(serverSyncState.lastReceiveSummary)}`
                  : ''}
              </div>
            )}
          </div>

          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
            <div className="text-[10px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('العمليات المعلقة / المتعثرة', 'Pending / Failed Ops')}</div>
            <div className="font-mono font-black tabular-nums text-slate-900 dark:text-[#F3F7FC]">
              {pendingSyncCount} {failedSyncCount > 0 ? `(${failedSyncCount} ${t('فشل', 'failed')})` : ''}
            </div>
            {pendingOps.length > 0 && (
              <div className="text-[10px] text-slate-600 dark:text-[#8CA3C7] truncate mt-0.5">
                {[
                  pendingByCategory.sales > 0 ? `${t('مبيعات', 'Sales')}: ${pendingByCategory.sales}` : '',
                  pendingByCategory.collections > 0 ? `${t('تحصيل', 'Collections')}: ${pendingByCategory.collections}` : '',
                  pendingByCategory.returns > 0 ? `${t('مرتجع', 'Returns')}: ${pendingByCategory.returns}` : '',
                  pendingByCategory.customers > 0 ? `${t('عملاء', 'Customers')}: ${pendingByCategory.customers}` : '',
                  pendingByCategory.orders > 0 ? `${t('طلبات', 'Orders')}: ${pendingByCategory.orders}` : '',
                  pendingByCategory.transfers > 0 ? `${t('تحويلات', 'Transfers')}: ${pendingByCategory.transfers}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
          </div>

          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
            <div className="text-[10px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('بانتظار الاستلام والاعتماد', 'Awaiting Receipt & Approval')}</div>
            <div className="font-mono font-black tabular-nums text-slate-900 dark:text-[#F3F7FC]">
              {kpiStats.awaitingReceiveTotal}
            </div>
            <div className="text-[10px] text-slate-600 dark:text-[#8CA3C7] truncate mt-0.5">
              {t(`دفعات: ${incomingDispatchCount} · عهد وتحويلات: ${kpiStats.pendingTransfersCount}`, `Batches: ${incomingDispatchCount} · Transfers: ${kpiStats.pendingTransfersCount}`)}
            </div>
          </div>
        </div>

        {isMandatorySendPendingRetry && (
          <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-2 text-amber-900 dark:text-amber-200">
            <span className="font-bold">
              {t('يوجد إرسال إجباري بانتظار التنفيذ فور استقرار الاتصال.', 'A mandatory send is waiting to run as soon as connection stabilizes.')}
            </span>
            <button
              type="button"
              onClick={() => triggerMandatorySendNow()}
              className="px-2.5 py-1 rounded-md bg-amber-600 text-white font-bold text-[11px] cursor-pointer"
            >
              {t('تنفيذ الإرسال الآن', 'Run Send Now')}
            </button>
          </div>
        )}

        {(sendProgressPercent > 0 || receiveProgressPercent > 0) && (
          <div className="space-y-1.5">
            {sendProgressPercent > 0 && (
              <div className="space-y-0.5">
                <div className="flex justify-between text-[11px] font-bold text-[#003589] dark:text-[#85B8FF]">
                  <span>{sendProgressStage || t('جاري الإرسال...', 'Sending...')}</span>
                  <span className="font-mono tabular-nums">{sendProgressPercent}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-[#1B2F52] overflow-hidden">
                  <div className="h-full bg-[#003589] transition-all" style={{ width: `${sendProgressPercent}%` }} />
                </div>
              </div>
            )}
            {receiveProgressPercent > 0 && (
              <div className="space-y-0.5">
                <div className="flex justify-between text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                  <span>{receiveProgressStage || t('جاري الاستلام...', 'Receiving...')}</span>
                  <span className="font-mono tabular-nums">{receiveProgressPercent}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-[#1B2F52] overflow-hidden">
                  <div className="h-full bg-emerald-600 transition-all" style={{ width: `${receiveProgressPercent}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {banner && (
          <div
            data-testid="sync-status-banner"
            className={`px-3 py-2 rounded-lg border font-bold flex items-center justify-between gap-2 ${
              banner.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : banner.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                : banner.type === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'
            }`}
          >
            <span>{banner.text}</span>
            <button type="button" onClick={() => setBanner(null)} className="text-[11px] underline cursor-pointer">
              {t('إغلاق', 'Close')}
            </button>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('batches')}
          className={`min-h-[34px] px-3 rounded-lg font-bold border transition-colors cursor-pointer ${
            activeTab === 'batches'
              ? 'bg-[#003589] text-white border-[#003589]'
              : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C]'
          }`}
        >
          {t('دفعات الإرسال والاستلام', 'Send & Receive Batches')} ({syncDispatchBatches.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('transfers')}
          className={`min-h-[34px] px-3 rounded-lg font-bold border transition-colors cursor-pointer ${
            activeTab === 'transfers'
              ? 'bg-[#003589] text-white border-[#003589]'
              : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C]'
          }`}
        >
          {t('التحويلات والعهد الواردة', 'Incoming Transfers & Custody')} ({kpiStats.pendingTransfersCount})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('conflicts')}
          className={`min-h-[34px] px-3 rounded-lg font-bold border transition-colors cursor-pointer ${
            activeTab === 'conflicts'
              ? 'bg-[#003589] text-white border-[#003589]'
              : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C]'
          }`}
        >
          {t('تعارضات المزامنة', 'Sync Conflicts')} ({conflictsCount})
        </button>
      </div>

      {activeTab === 'batches' && (
        <div className="space-y-3">
          {/* Pending Local Operations Composer for Official Dispatch Batch */}
          {pendingOps.length > 0 && (
            <div className="bg-white dark:bg-[#0E1C36] rounded-xl border border-slate-200 dark:border-[#21375C] p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-black text-[#011E58] dark:text-[#F3F7FC]">
                  {t('العمليات المحلية الجاهزة للإرسال', 'Local Operations Ready to Send')} ({pendingOps.length})
                </h3>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setSelectedOpIds(pendingOps.map((op) => op.operationId))}
                    className="text-[#003589] dark:text-[#85B8FF] font-bold underline cursor-pointer"
                  >
                    {t('تحديد الكل', 'Select All')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedOpIds([])}
                    className="text-slate-500 font-bold underline cursor-pointer"
                  >
                    {t('إلغاء التحديد', 'Clear')}
                  </button>
                </div>
              </div>

              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1B2F52] border border-slate-200 dark:border-[#21375C] rounded-lg">
                {pendingOps.map((op) => {
                  const checked = selectedOpIds.includes(op.operationId);
                  return (
                    <label
                      key={op.operationId}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-[#132544] cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedOpIds((prev) => [...prev, op.operationId]);
                            } else {
                              setSelectedOpIds((prev) => prev.filter((id) => id !== op.operationId));
                            }
                          }}
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 dark:text-[#F3F7FC] truncate">
                            {op.summaryAr || op.operationType}
                          </div>
                          {op.lastError && (
                            <div className="text-[10px] text-rose-600 dark:text-rose-300 truncate">{op.lastError}</div>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0 tabular-nums">
                        {op.status === 'failed' ? `${t('فشل', 'Failed')} · ` : ''}
                        {fmtDate(op.createdAt)}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <div>
                  <label className="block text-[11px] font-bold mb-0.5 text-slate-700 dark:text-[#A9BCD9]">
                    {t('المستلم (للدفعة الرسمية):', 'Recipient (Official Batch):')}
                  </label>
                  <select
                    value={recipientUserId}
                    onChange={(e) => setRecipientUserId(e.target.value)}
                    className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#081326] px-2 font-bold"
                  >
                    <option value="">{t('اختر المستلم...', 'Select recipient...')}</option>
                    {dispatchRecipients.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.fullName} ({t(r.role)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold mb-0.5 text-slate-700 dark:text-[#A9BCD9]">
                    {t('ملاحظات الدفعة (اختياري):', 'Batch Notes (optional):')}
                  </label>
                  <input
                    type="text"
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    placeholder={t('ملاحظة للمستلم...', 'Note for recipient...')}
                    className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#081326] px-2"
                  />
                </div>
                <button
                  type="button"
                  disabled={selectedOpIds.length === 0 || !recipientUserId || isSyncing}
                  onClick={handlePrepareBatchSend}
                  className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black inline-flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{t(`إرسال كدفعة رسمية (${selectedOpIds.length})`, `Send Official Batch (${selectedOpIds.length})`)}</span>
                </button>
              </div>
            </div>
          )}

          {/* Official 12-column Dispatch Batches UnifiedDataTable */}
          <UnifiedDataTable<SyncDispatchBatch>
            title={t('سجل دفعات الإرسال والاستلام الرسمية', 'Official Send & Receive Batches Log')}
            columns={dispatchColumns}
            data={syncDispatchBatches}
            rowKey={(b) => b.id || b.clientBatchUuid}
            searchPlaceholder={t('بحث برقم العملية، المرسل، المستلم...', 'Search batch #, sender, recipient...')}
            searchFilter={(b, q) =>
              `${b.batchNumber} ${b.senderName} ${b.recipientName} ${b.sendStatus} ${b.receiptStatus}`
                .toLowerCase()
                .includes(q.toLowerCase())
            }
            exportFilename="awlad-selim-send-receive-batches"
            pdfTitle={t('سجل دفعات الإرسال والاستلام', 'Send & Receive Batches Log')}
            emptyTitle={t('لا توجد دفعات إرسال واستلام بعد', 'No send & receive batches yet')}
            emptySubtitle={t('عند إرسال أو استلام دفعات عمليات ستظهر تفاصيلها هنا', 'Sent or received operation batches will appear here')}
            compact
          />
        </div>
      )}

      {activeTab === 'transfers' && (
        <div className="space-y-3">
          {/* Cash Transfers Awaiting Receipt */}
          <div className="bg-white dark:bg-[#0E1C36] rounded-xl border border-slate-200 dark:border-[#21375C] p-3 space-y-2">
            <div className="flex items-center gap-2 font-black text-[#011E58] dark:text-[#F3F7FC]">
              <Wallet className="w-4 h-4 text-[#003589] dark:text-[#85B8FF]" />
              <span>{t('التحويلات النقدية بانتظار تأكيد الاستلام', 'Cash Transfers Awaiting Receipt')} ({actionableCashTransfers.length})</span>
            </div>
            {actionableCashTransfers.length === 0 ? (
              <p className="text-slate-500 dark:text-[#A9BCD9] py-2">{t('لا توجد تحويلات نقدية معلقة', 'No pending cash transfers')}</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                {actionableCashTransfers.map((trItem: RepTransfer) => (
                  <div key={trItem.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-black text-slate-900 dark:text-[#F3F7FC]">
                        {trItem.senderName} → {trItem.receiverName} ({fmtMoney(trItem.amount)})
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-[#A9BCD9]">
                        {trItem.transferNumber || trItem.id} • {fmtDate(trItem.sentAt || trItem.date)} {trItem.notes ? `• ${trItem.notes}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isSubmittingAction}
                        onClick={async () => {
                          setIsSubmittingAction(true);
                          try {
                            const r = await confirmRepTransferReceipt(trItem.id, t('تم الاستلام من شاشة الإرسال والاستلام', 'Confirmed from Send & Receive'));
                            setBanner({
                              type: r.success ? 'success' : 'error',
                              text: r.success ? t('تم تأكيد استلام التحويل النقدي', 'Cash transfer receipt confirmed') : (r.error || t('تعذر التأكيد', 'Could not confirm')),
                            });
                          } finally {
                            setIsSubmittingAction(false);
                          }
                        }}
                        className="px-2.5 py-1 rounded-md bg-emerald-700 text-white font-bold text-[11px] cursor-pointer disabled:opacity-50"
                      >
                        {t('تأكيد الاستلام', 'Confirm Receipt')}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingAction}
                        onClick={async () => {
                          setIsSubmittingAction(true);
                          try {
                            const r = await rejectRepTransfer(trItem.id, t('رفض من شاشة الإرسال والاستلام', 'Rejected from Send & Receive'));
                            setBanner({
                              type: r.success ? 'warning' : 'error',
                              text: r.success ? t('تم رفض التحويل النقدي', 'Cash transfer rejected') : (r.error || t('تعذر الرفض', 'Could not reject')),
                            });
                          } finally {
                            setIsSubmittingAction(false);
                          }
                        }}
                        className="px-2.5 py-1 rounded-md bg-rose-600 text-white font-bold text-[11px] cursor-pointer disabled:opacity-50"
                      >
                        {t('رفض', 'Reject')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Item Custody Transfers Awaiting Action */}
          <div className="bg-white dark:bg-[#0E1C36] rounded-xl border border-slate-200 dark:border-[#21375C] p-3 space-y-2">
            <div className="flex items-center gap-2 font-black text-[#011E58] dark:text-[#F3F7FC]">
              <Package className="w-4 h-4 text-[#003589] dark:text-[#85B8FF]" />
              <span>{t('طلبات وعهد البضائع بانتظار الإجراء', 'Inventory Custody Transfers Awaiting Action')} ({actionableItemTransfers.length})</span>
            </div>
            {actionableItemTransfers.length === 0 ? (
              <p className="text-slate-500 dark:text-[#A9BCD9] py-2">{t('لا توجد تحويلات بضائع معلقة', 'No pending inventory transfers')}</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                {actionableItemTransfers.map((reqItem: RepItemTransferRequest) => (
                  <div key={reqItem.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-black text-slate-900 dark:text-[#F3F7FC]">
                        {reqItem.requestNumber} — {reqItem.sourceWarehouseName} → {reqItem.targetWarehouseName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-[#A9BCD9]">
                        {reqItem.representativeName} • {reqItem.items.length} {t('أصناف', 'items')} • {t(reqItem.status)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {reqItem.status === 'executed' && (
                        <button
                          type="button"
                          disabled={isSubmittingAction}
                          onClick={async () => {
                            setIsSubmittingAction(true);
                            try {
                              const r = await updateRepItemTransferStatus(reqItem.id, 'received', undefined, t('تم استلام البضاعة', 'Goods received'));
                              setBanner({
                                type: r.success ? 'success' : 'error',
                                text: r.success ? t('تم تأكيد استلام عهدة البضاعة', 'Custody items receipt confirmed') : (r.error || t('تعذر تأكيد الاستلام', 'Could not confirm receipt')),
                              });
                            } finally {
                              setIsSubmittingAction(false);
                            }
                          }}
                          className="px-2.5 py-1 rounded-md bg-emerald-700 text-white font-bold text-[11px] cursor-pointer disabled:opacity-50"
                        >
                          {t('تأكيد استلام البضاعة', 'Confirm Items Receipt')}
                        </button>
                      )}
                      {!isRepRole && reqItem.status === 'pending' && (
                        <button
                          type="button"
                          disabled={isSubmittingAction}
                          onClick={async () => {
                            setIsSubmittingAction(true);
                            try {
                              const r = await updateRepItemTransferStatus(reqItem.id, 'executed');
                              setBanner({
                                type: r.success ? 'success' : 'error',
                                text: r.success ? t('تم صرف وتنفيذ التحويل', 'Transfer executed') : (r.error || t('تعذر التنفيذ', 'Could not execute')),
                              });
                            } finally {
                              setIsSubmittingAction(false);
                            }
                          }}
                          className="px-2.5 py-1 rounded-md bg-[#003589] text-white font-bold text-[11px] cursor-pointer disabled:opacity-50"
                        >
                          {t('صرف وتنفيذ', 'Execute Dispatch')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'conflicts' && (
        <div className="bg-white dark:bg-[#0E1C36] rounded-xl border border-slate-200 dark:border-[#21375C] p-3 space-y-2">
          <div className="flex items-center gap-2 font-black text-amber-800 dark:text-amber-300">
            <ShieldAlert className="w-4 h-4" />
            <span>{t('تعارضات المزامنة التي تحتاج مراجعة', 'Sync Conflicts Requiring Review')} ({syncConflicts.length})</span>
          </div>
          {syncConflicts.length === 0 ? (
            <p className="text-slate-500 dark:text-[#A9BCD9] py-2">{t('لا توجد تعارضات مزامنة حالياً', 'No sync conflicts right now')}</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
              {syncConflicts.map((c: SyncConflictRecord) => (
                <div key={c.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-black text-slate-900 dark:text-[#F3F7FC]">
                      {c.operationType} — {c.conflictReason}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-[#A9BCD9] font-mono">
                      {c.operationId} • {fmtDate(c.createdAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => resolveSyncConflict(c.id, 'keep_server')}
                      className="px-2 py-1 rounded-md bg-blue-50 dark:bg-[#172E56] text-[#003589] dark:text-[#85B8FF] border border-blue-200 dark:border-[#2A436E] font-bold text-[11px] cursor-pointer"
                    >
                      {t('اعتماد النسخة المعتمدة', 'Keep Authorized Copy')}
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveSyncConflict(c.id, 'apply_local')}
                      className="px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold text-[11px] cursor-pointer"
                    >
                      {t('تطبيق المحلي', 'Apply Local')}
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveSyncConflict(c.id, 'dismiss')}
                      className="px-2 py-1 rounded-md bg-slate-100 dark:bg-[#132544] text-slate-700 dark:text-[#A9BCD9] font-bold text-[11px] cursor-pointer"
                    >
                      {t('تجاهل', 'Dismiss')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Manual Send Queue Confirmation Modal */}
      <Modal
        isOpen={isManualSendModalOpen}
        onClose={() => !isSubmittingAction && setIsManualSendModalOpen(false)}
        title={t('مراجعة وتأكيد الإرسال اليدوي للسيرفر', 'Review & Confirm Manual Send to Server')}
        maxWidth="lg"
      >
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: t('فواتير مبيعات', 'Sales'), count: pendingByCategory.sales },
              { label: t('تحصيلات ونقدية', 'Collections'), count: pendingByCategory.collections },
              { label: t('مرتجعات', 'Returns'), count: pendingByCategory.returns },
              { label: t('العملاء', 'Customers'), count: pendingByCategory.customers },
              { label: t('الطلبات', 'Orders'), count: pendingByCategory.orders },
              { label: t('التحويلات والعهد', 'Transfers'), count: pendingByCategory.transfers + pendingByCategory.other },
            ].map((cat) => (
              <div
                key={cat.label}
                className="p-2 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] flex items-center justify-between"
              >
                <span className="font-bold text-slate-700 dark:text-[#A9BCD9]">{cat.label}</span>
                <strong className="font-mono font-black tabular-nums text-[#011E58] dark:text-[#85B8FF]">
                  {cat.count}
                </strong>
              </div>
            ))}
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1B2F52] border border-slate-200 dark:border-[#21375C] rounded-lg">
            {pendingOps.map((op) => (
              <div key={op.operationId} className="px-2.5 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 dark:text-[#F3F7FC] truncate">
                    {op.summaryAr || op.operationType}
                  </div>
                  {op.lastError && (
                    <div className="text-[10px] text-rose-600 dark:text-rose-300 truncate">{op.lastError}</div>
                  )}
                </div>
                <span className="font-mono text-[10px] text-slate-500 shrink-0 tabular-nums">
                  {op.status === 'failed' ? `${t('متعثرة', 'Failed')} · ` : ''}
                  {fmtDate(op.createdAt)}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#21375C]">
            <button
              type="button"
              disabled={isSubmittingAction}
              onClick={() => setIsManualSendModalOpen(false)}
              className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="button"
              data-testid="confirm-manual-send-modal-btn"
              disabled={isSubmittingAction || pendingOps.length === 0}
              onClick={handleExecuteManualSend}
              className="h-8 px-4 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
              <span>
                {isSubmittingAction
                  ? t('جاري الإرسال...', 'Sending...')
                  : t(`تأكيد الإرسال (${pendingOps.length})`, `Confirm & Send (${pendingOps.length})`)}
              </span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Receive Preview & Confirm Modal */}
      <Modal
        isOpen={Boolean(receivePreviewModal)}
        onClose={() => !isSubmittingAction && setReceivePreviewModal(null)}
        title={t('معاينة وتأكيد الاستلام من السيرفر', 'Preview & Confirm Server Receipt')}
        maxWidth="2xl"
      >
        {receivePreviewModal && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-2 rounded-lg bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#21375C]">
                <div className="text-[10px] text-slate-500 font-bold">{t('عهد بضائع واردة', 'Custody Dispatches')}</div>
                <div className="font-mono font-black tabular-nums text-[#011E58] dark:text-[#85B8FF]">
                  {receivePreviewModal.items.custodyDispatches.length}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#21375C]">
                <div className="text-[10px] text-slate-500 font-bold">{t('تحويلات نقدية', 'Cash Transfers')}</div>
                <div className="font-mono font-black tabular-nums text-[#011E58] dark:text-[#85B8FF]">
                  {receivePreviewModal.items.cashTransfers.length}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#21375C]">
                <div className="text-[10px] text-slate-500 font-bold">{t('دفعات رسمية', 'Dispatch Batches')}</div>
                <div className="font-mono font-black tabular-nums text-[#011E58] dark:text-[#85B8FF]">
                  {receivePreviewModal.items.dispatchBatches.length}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
                <div className="text-[10px] text-slate-500 font-bold">{t('مستندات وأصناف محدثة', 'Updated Docs & Items')}</div>
                <div className="font-mono font-black tabular-nums text-slate-900 dark:text-[#F3F7FC]">
                  {receivePreviewModal.summary.updatedDocumentsCount}
                </div>
              </div>
            </div>

            {receivePreviewModal.items.custodyDispatches.length > 0 && (
              <div className="space-y-1">
                <div className="font-black text-[#011E58] dark:text-[#85B8FF]">
                  {t('عهد وبضائع منصرفة بانتظار تأكيد الاستلام (تُضاف لمخزنك عند التأكيد):', 'Custody Dispatches Awaiting Confirmation (Added to Van on Confirm):')}
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1B2F52] border border-slate-200 dark:border-[#21375C] rounded-lg">
                  {receivePreviewModal.items.custodyDispatches.map((c) => (
                    <label key={c.id} className="px-2.5 py-2 flex items-center justify-between gap-2 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedReceiveCustodyIds.includes(c.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedReceiveCustodyIds((p) => [...p, c.id]);
                            else setSelectedReceiveCustodyIds((p) => p.filter((x) => x !== c.id));
                          }}
                        />
                        <div>
                          <div className="font-black text-slate-900 dark:text-[#F3F7FC]">
                            {c.requestNumber} · {c.sourceWarehouseName} → {c.targetWarehouseName}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {c.itemsCount} {t('أصناف', 'items')} ({c.totalQty} {t('وحدة', 'units')})
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-[10px] text-slate-500">{fmtDate(c.createdAt)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {receivePreviewModal.items.cashTransfers.length > 0 && (
              <div className="space-y-1">
                <div className="font-black text-[#011E58] dark:text-[#85B8FF]">
                  {t('تحويلات نقدية واردة بانتظار الاستلام:', 'Incoming Cash Transfers Awaiting Receipt:')}
                </div>
                <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1B2F52] border border-slate-200 dark:border-[#21375C] rounded-lg">
                  {receivePreviewModal.items.cashTransfers.map((trItem) => (
                    <label key={trItem.id} className="px-2.5 py-2 flex items-center justify-between gap-2 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedReceiveCashIds.includes(trItem.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedReceiveCashIds((p) => [...p, trItem.id]);
                            else setSelectedReceiveCashIds((p) => p.filter((x) => x !== trItem.id));
                          }}
                        />
                        <div>
                          <div className="font-black text-slate-900 dark:text-[#F3F7FC]">
                            {trItem.senderName} ({t(trItem.direction)})
                          </div>
                          <div className="text-[10px] text-slate-500">{trItem.transferNumber} · {fmtDate(trItem.sentAt)}</div>
                        </div>
                      </div>
                      <span className="font-mono font-black tabular-nums text-emerald-700 dark:text-emerald-400">
                        {fmtMoney(trItem.amount)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {receivePreviewModal.items.dispatchBatches.length > 0 && (
              <div className="space-y-1">
                <div className="font-black text-[#011E58] dark:text-[#85B8FF]">
                  {t('دفعات العمليات الرسمية الواردة:', 'Incoming Official Dispatch Batches:')}
                </div>
                <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1B2F52] border border-slate-200 dark:border-[#21375C] rounded-lg">
                  {receivePreviewModal.items.dispatchBatches.map((b) => (
                    <label key={b.id} className="px-2.5 py-2 flex items-center justify-between gap-2 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedReceiveBatchIds.includes(b.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedReceiveBatchIds((p) => [...p, b.id]);
                            else setSelectedReceiveBatchIds((p) => p.filter((x) => x !== b.id));
                          }}
                        />
                        <div>
                          <div className="font-black text-slate-900 dark:text-[#F3F7FC]">
                            {b.batchNumber} · {b.senderName}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {t(`مبيعات ${b.salesCount} · تحصيلات ${b.collectionsCount} · مرتجع ${b.returnsCount}`, `Sales ${b.salesCount} · Coll ${b.collectionsCount}`)}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono font-bold tabular-nums">{fmtMoney(b.totalAmount)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {receivePreviewModal.items.updatedDocuments.length > 0 && (
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] text-[11px] space-y-1">
                <div className="font-black text-slate-700 dark:text-[#DCE6F5]">
                  {t(`تحديثات المستندات والأصناف (${receivePreviewModal.items.updatedDocuments.length}):`, `Updated Documents (${receivePreviewModal.items.updatedDocuments.length}):`)}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono">
                  {receivePreviewModal.items.updatedDocuments.slice(0, 8).map((docItem) => (
                    <span key={docItem.id}>
                      {docItem.number} ({t(docItem.status)})
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#21375C]">
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setReceivePreviewModal(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-manual-receive-modal-btn"
                disabled={isSubmittingAction}
                onClick={handleConfirmManualReceive}
                className="h-8 px-4 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {isSubmittingAction
                    ? t('جاري الاستلام...', 'Receiving...')
                    : t('تأكيد الاستلام الآن', 'Confirm & Apply Receipt')}
                </span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Pre-Send Summary Confirmation Modal */}
      <Modal
        isOpen={Boolean(pendingSendConfirm)}
        onClose={() => !isSubmittingAction && setPendingSendConfirm(null)}
        title={t('تأكيد إرسال الدفعة الرسمية', 'Confirm Official Batch Send')}
        maxWidth="lg"
      >
        {pendingSendConfirm && (
          <div className="space-y-3 text-xs">
            <div className="p-2.5 rounded-lg bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#21375C] space-y-1">
              <div>
                <span className="font-bold text-slate-600 dark:text-[#A9BCD9]">{t('المستلم:', 'Recipient:')} </span>
                <span className="font-black text-[#011E58] dark:text-[#F3F7FC]">{pendingSendConfirm.recipientName}</span>
              </div>
              <div>
                <span className="font-bold text-slate-600 dark:text-[#A9BCD9]">{t('عدد العمليات:', 'Operations count:')} </span>
                <span className="font-mono font-black">{pendingSendConfirm.ops.length}</span>
              </div>
              {pendingSendConfirm.notes && (
                <div>
                  <span className="font-bold text-slate-600 dark:text-[#A9BCD9]">{t('ملاحظات:', 'Notes:')} </span>
                  <span>{pendingSendConfirm.notes}</span>
                </div>
              )}
            </div>

            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1B2F52] border border-slate-200 dark:border-[#21375C] rounded-lg">
              {pendingSendConfirm.ops.map((op) => (
                <div key={op.operationId} className="px-2.5 py-1.5 flex items-center justify-between gap-2">
                  <span className="font-bold">{op.summaryAr || op.operationType}</span>
                  <span className="font-mono text-[10px] text-slate-500">{op.operationId}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#21375C]">
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={() => setPendingSendConfirm(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={handleConfirmSendBatch}
                className="h-8 px-4 rounded-md bg-[#003589] text-white font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t('تأكيد الإرسال الآن', 'Confirm & Send Now')}</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Read-Only Inspect & Manual Receipt Modal */}
      <Modal
        isOpen={Boolean(inspectedBatch)}
        onClose={() => !isSubmittingAction && setInspectedBatch(null)}
        title={
          inspectedBatch
            ? `${t('تفاصيل الدفعة', 'Batch Details')} — ${inspectedBatch.batchNumber || inspectedBatch.id}`
            : ''
        }
        maxWidth="2xl"
      >
        {inspectedBatch && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 dark:bg-[#132544] p-2.5 rounded-lg border border-slate-200 dark:border-[#21375C]">
              <div>
                <div className="text-[10px] text-slate-500 font-bold">{t('المرسل', 'Sender')}</div>
                <div className="font-black">{inspectedBatch.senderName}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 font-bold">{t('المستلم', 'Recipient')}</div>
                <div className="font-black">{inspectedBatch.recipientName}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 font-bold">{t('حالة الإرسال', 'Send Status')}</div>
                <div className="font-black">{t(inspectedBatch.sendStatus)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 font-bold">{t('حالة الاستلام', 'Receipt Status')}</div>
                <div className="font-black">{t(inspectedBatch.receiptStatus)}</div>
              </div>
            </div>

            {inspectedBatch.notes && (
              <div className="p-2 rounded-md bg-[#EEF3FA] dark:bg-[#172E56] font-bold">
                {t('ملاحظات المرسل:', 'Sender Notes:')} {inspectedBatch.notes}
              </div>
            )}

            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1B2F52] border border-slate-200 dark:border-[#21375C] rounded-lg">
              {(inspectedBatch.docSummary && inspectedBatch.docSummary.length > 0
                ? inspectedBatch.docSummary
                : (inspectedBatch.operationsSnapshot || []).map((op) => ({
                    operationId: op.operationId,
                    operationType: op.operationType,
                    summaryAr: op.summaryAr,
                    amount: undefined,
                    customerName: undefined,
                  }))
              ).map((item, idx) => (
                <div key={item.operationId || idx} className="px-2.5 py-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-[#F3F7FC]">{item.summaryAr || item.operationType}</div>
                    {item.customerName && (
                      <div className="text-[11px] text-slate-500">{item.customerName}</div>
                    )}
                  </div>
                  {item.amount !== undefined && (
                    <span className="font-mono font-black text-[#011E58] dark:text-[#85B8FF]">
                      {fmtMoney(Number(item.amount || 0))}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {isInspectedReceiver && (
              <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2">
                <div className="font-black text-emerald-900 dark:text-emerald-200">
                  {t('إجراءات تأكيد الاستلام اليدوي', 'Manual Receipt Confirmation Actions')}
                </div>
                <input
                  type="text"
                  value={receiptNotesInput}
                  onChange={(e) => setReceiptNotesInput(e.target.value)}
                  placeholder={t('ملاحظات الاستلام (اختياري)...', 'Receipt notes (optional)...')}
                  className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#081326] px-2"
                />
                <label className="flex items-center gap-2 font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasDiscrepancyInput}
                    onChange={(e) => setHasDiscrepancyInput(e.target.checked)}
                  />
                  <span>{t('يوجد اختلاف أو ملاحظة مراجعة عند الاستلام', 'Flag discrepancy or review note on receipt')}</span>
                </label>
                {hasDiscrepancyInput && (
                  <textarea
                    rows={2}
                    value={discrepancyNote}
                    onChange={(e) => setDiscrepancyNote(e.target.value)}
                    placeholder={t('اكتب تفاصيل الاختلاف...', 'Describe the discrepancy...')}
                    className="w-full rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-[#081326] p-2"
                  />
                )}

                {isRejectBoxOpen && (
                  <div className="space-y-1.5 pt-1">
                    <textarea
                      rows={2}
                      value={rejectReasonInput}
                      onChange={(e) => setRejectReasonInput(e.target.value)}
                      placeholder={t('سبب تعذر الاستلام أو الرفض...', 'Reason for failing/rejecting receipt...')}
                      className="w-full rounded-md border border-rose-300 dark:border-rose-700 bg-white dark:bg-[#081326] p-2"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  {!isRejectBoxOpen ? (
                    <button
                      type="button"
                      onClick={() => setIsRejectBoxOpen(true)}
                      className="h-8 px-3 rounded-md border border-rose-300 text-rose-700 dark:text-rose-300 font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{t('تعذر الاستلام', 'Fail Receipt')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isSubmittingAction}
                      onClick={handleFailInspectedBatch}
                      className="h-8 px-3 rounded-md bg-rose-600 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{t('تأكيد تعذر الاستلام', 'Confirm Failure')}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isSubmittingAction}
                    onClick={handleConfirmInspectedBatch}
                    className="h-8 px-4 rounded-md bg-emerald-700 text-white font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{t('تأكيد الاستلام', 'Confirm Receipt')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

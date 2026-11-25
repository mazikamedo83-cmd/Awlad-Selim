import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Send,
  Eye,
  X,
  Wifi,
  WifiOff,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { UnifiedColumn, UnifiedDataTable } from '../../common/UnifiedDataTable';
import { SyncDispatchBatch, SyncDispatchBatchDocSummaryItem, SyncDispatchBatchStatus, SyncQueueItem } from '../../../types';

interface RefreshSyncScreenProps {
  onBack?: () => void;
}

function formatElapsedTenths(ms: number): string {
  const totalTenths = Math.max(0, Math.floor(ms / 100));
  const mins = Math.floor(totalTenths / 600);
  const secs = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function formatDateTimeAr(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG');
  } catch {
    return String(iso);
  }
}

function getDispatchStatusClasses(status: SyncDispatchBatchStatus | string): string {
  switch (status) {
    case 'تم الاستلام':
    case 'تم الإرسال':
      return 'bg-emerald-50 text-emerald-900 border-emerald-200';
    case 'في انتظار الاستلام':
    case 'جاهزة للإرسال':
      return 'bg-blue-50 text-blue-950 border-blue-200';
    case 'جاري الإرسال':
    case 'جاري الاستلام':
      return 'bg-sky-50 text-sky-900 border-sky-200';
    case 'محفوظة محليًا':
      return 'bg-slate-100 text-slate-800 border-slate-300';
    case 'فشل الإرسال':
    case 'تعذر الاستلام':
      return 'bg-red-50 text-red-900 border-red-200';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

export const RefreshSyncScreen: React.FC<RefreshSyncScreenProps> = ({ onBack }) => {
  const data = useData();
  const { currentUser, representativeProfile, hasPermission } = useAuth();

  const isRepUser = currentUser?.role === 'representative';
  const isOnline =
    (typeof navigator === 'undefined' ? true : navigator.onLine !== false) &&
    data.networkStatus !== 'disconnected' &&
    data.isServerReachable !== false;

  const rep = useMemo(
    () =>
      representativeProfile ||
      data.representatives.find((r) => r.userId && r.userId === currentUser?.id) ||
      null,
    [representativeProfile, data.representatives, currentUser]
  );

  // Timers for sync status feedback
  const [isSending, setIsSending] = useState(false);
  const [sendElapsedMs, setSendElapsedMs] = useState(0);
  const sendStartRef = useRef<number | null>(null);

  const [isReceiving, setIsReceiving] = useState(false);
  const [receiveElapsedMs, setReceiveElapsedMs] = useState(0);
  const receiveStartRef = useRef<number | null>(null);

  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Batch creation state (Rep Mode)
  const [selectedOpIds, setSelectedOpIds] = useState<string[]>([]);
  const [recipientUserId, setRecipientUserId] = useState<string>('');
  const [batchNotes, setBatchNotes] = useState<string>('');

  // Admin/Staff filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [senderFilter, setSenderFilter] = useState<string>('all');
  const [recipientFilter, setRecipientFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Inspection Modal state
  const [inspectedBatch, setInspectedBatch] = useState<SyncDispatchBatch | null>(null);
  const [receiptNotesInput, setReceiptNotesInput] = useState<string>('');
  const [failReasonInput, setFailReasonInput] = useState<string>('');
  const [showFailReasonBox, setShowFailReasonBox] = useState<boolean>(false);
  const [batchActionLoading, setBatchActionLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isSending) return;
    sendStartRef.current = Date.now();
    setSendElapsedMs(0);
    const id = window.setInterval(() => {
      if (sendStartRef.current !== null) setSendElapsedMs(Date.now() - sendStartRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [isSending]);

  useEffect(() => {
    if (!isReceiving) return;
    receiveStartRef.current = Date.now();
    setReceiveElapsedMs(0);
    const id = window.setInterval(() => {
      if (receiveStartRef.current !== null) setReceiveElapsedMs(Date.now() - receiveStartRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [isReceiving]);

  useEffect(() => {
    data.refreshDispatches().catch(() => {});
  }, []);

  // Unsent local queue operations (eligible for dispatch batch)
  const unsentQueueOps = useMemo(
    () =>
      (data.syncQueue || []).filter(
        (q) => q.status === 'pending' || q.status === 'local' || q.status === 'failed' || q.status === 'syncing'
      ),
    [data.syncQueue]
  );

  // Keep selected operations synchronized with newly added offline operations
  useEffect(() => {
    const validIds = new Set(unsentQueueOps.map((q) => q.operationId));
    setSelectedOpIds((prev) => {
      const preserved = prev.filter((id) => validIds.has(id));
      if (preserved.length === 0 && unsentQueueOps.length > 0) {
        return unsentQueueOps.map((q) => q.operationId);
      }
      return preserved;
    });
  }, [unsentQueueOps]);

  // Pre-select first recipient when options load
  useEffect(() => {
    if (!recipientUserId && Array.isArray(data.dispatchRecipients) && data.dispatchRecipients.length > 0) {
      setRecipientUserId(data.dispatchRecipients[0].id);
    }
  }, [data.dispatchRecipients, recipientUserId]);

  const awaitingCustodyDispatches = useMemo(() => {
    return (data.repItemTransfers || []).filter((t) => {
      if (t.status !== 'executed') return false;
      if (rep) return t.representativeId === rep.id;
      return isRepUser ? false : true;
    });
  }, [data.repItemTransfers, rep, isRepUser]);

  const awaitingCashTransfers = useMemo(() => {
    return (data.repTransfers || []).filter((t) => {
      if (t.status !== 'awaiting_receipt' || t.direction !== 'owner_to_rep') return false;
      if (rep) return t.receiverId === rep.id;
      return isRepUser ? false : true;
    });
  }, [data.repTransfers, rep, isRepUser]);

  // All dispatch batches visible to user
  const allBatches = useMemo(() => data.syncDispatchBatches || [], [data.syncDispatchBatches]);

  const failedDraftBatches = useMemo(
    () =>
      allBatches.filter(
        (b) => b.sendStatus === 'فشل الإرسال' && b.senderUserId === currentUser?.id
      ),
    [allBatches, currentUser?.id]
  );

  const uniqueSenders = useMemo(() => {
    const map = new Map<string, string>();
    allBatches.forEach((b) => {
      if (b.senderUserId) map.set(b.senderUserId, b.senderName || b.representativeName || 'مندوب');
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allBatches]);

  const uniqueRecipients = useMemo(() => {
    const map = new Map<string, string>();
    allBatches.forEach((b) => {
      if (b.recipientUserId) map.set(b.recipientUserId, b.recipientName || 'مستلم');
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allBatches]);

  const filteredBatches = useMemo(() => {
    return allBatches.filter((b) => {
      if (statusFilter !== 'all') {
        if (b.receiptStatus !== statusFilter && b.sendStatus !== statusFilter) return false;
      }
      if (senderFilter !== 'all' && b.senderUserId !== senderFilter) return false;
      if (recipientFilter !== 'all' && b.recipientUserId !== recipientFilter) return false;
      if (dateFilter) {
        const refDate = String(b.sentAt || b.createdAt || '').slice(0, 10);
        if (refDate !== dateFilter) return false;
      }
      return true;
    });
  }, [allBatches, statusFilter, senderFilter, recipientFilter, dateFilter]);

  const kpiStats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const waiting = allBatches.filter(
      (b) => b.receiptStatus === 'في انتظار الاستلام' || b.receiptStatus === 'جاري الاستلام'
    ).length;
    const confirmedToday = allBatches.filter(
      (b) => b.receiptStatus === 'تم الاستلام' && String(b.receivedAt || '').slice(0, 10) === todayStr
    ).length;
    const failed = allBatches.filter(
      (b) => b.sendStatus === 'فشل الإرسال' || b.receiptStatus === 'تعذر الاستلام'
    ).length;
    const totalCash = allBatches
      .filter((b) => b.receiptStatus === 'تم الاستلام')
      .reduce((sum, b) => sum + Number(b.totalCashAmount || 0), 0);
    return { waiting, confirmedToday, failed, totalCash };
  }, [allBatches]);

  const handleSendSelectedDispatchBatch = async () => {
    if (isSending) return;
    setActionMsg(null);
    const chosenOps = unsentQueueOps.filter((q) => selectedOpIds.includes(q.operationId));
    if (chosenOps.length === 0) {
      setActionMsg({ type: 'error', text: 'يرجى تحديد عملية واحدة على الأقل للإرسال.' });
      return;
    }
    if (!recipientUserId) {
      setActionMsg({ type: 'error', text: 'يرجى اختيار الموظف المستلم أولاً.' });
      return;
    }
    setIsSending(true);
    const res = await data.createAndSendDispatchBatch({
      selectedOperations: chosenOps,
      recipientUserId,
      notes: batchNotes.trim(),
    });
    const finalElapsed = sendStartRef.current !== null ? Date.now() - sendStartRef.current : 0;
    setSendElapsedMs(finalElapsed);
    setIsSending(false);
    if (res.success && res.batch) {
      setBatchNotes('');
      setActionMsg({
        type: 'success',
        text: `تم إرسال الدفعة الرسمية (${res.batch.batchNumber}) بنجاح إلى ${res.batch.recipientName} وهي الآن «${res.batch.receiptStatus}».`,
      });
    } else {
      setActionMsg({
        type: 'error',
        text: res.error || 'فشل إرسال الدفعة — بقيت العمليات محفوظة محلياً دون أي حذف، ويمكنك إعادة الإرسال فور عودة الاتصال.',
      });
    }
  };

  const handleRetryBatch = async (batch: SyncDispatchBatch) => {
    if (isSending) return;
    setActionMsg(null);
    setIsSending(true);
    const res = await data.retryDispatchBatch(batch);
    const finalElapsed = sendStartRef.current !== null ? Date.now() - sendStartRef.current : 0;
    setSendElapsedMs(finalElapsed);
    setIsSending(false);
    if (res.success && res.batch) {
      setActionMsg({
        type: 'success',
        text: `تمت إعادة إرسال الدفعة بنجاح برقم (${res.batch.batchNumber}).`,
      });
    } else {
      setActionMsg({
        type: 'error',
        text: res.error || 'لا يزال الاتصال متعذراً؛ بقيت الدفعة والعمليات محفوظة محلياً.',
      });
    }
  };

  const handleReceiveSyncNow = async () => {
    if (isReceiving) return;
    setActionMsg(null);
    setIsReceiving(true);
    const res = await data.syncReceiveOnly();
    await data.refreshDispatches();
    const finalElapsed = receiveStartRef.current !== null ? Date.now() - receiveStartRef.current : 0;
    setReceiveElapsedMs(finalElapsed);
    setIsReceiving(false);
    if (res.ok) {
      setActionMsg({
        type: 'success',
        text: `تم استلام وتحديث البيانات من السيرفر (${res.count} سجل).`,
      });
    } else {
      setActionMsg({
        type: 'error',
        text: res.error || 'تعذر الاتصال بالسيرفر لجلب التحديثات.',
      });
    }
  };

  const canConfirmBatch = (batch: SyncDispatchBatch) => {
    if (!currentUser) return false;
    if (currentUser.role === 'representative' || currentUser.role === 'customer') return false;
    if (batch.senderUserId === currentUser.id) return false;
    if (batch.receiptStatus === 'تم الاستلام' || batch.sendStatus === 'فشل الإرسال') return false;
    return (
      currentUser.role === 'admin' ||
      currentUser.role === 'manager' ||
      batch.recipientUserId === currentUser.id ||
      hasPermission('canManageReps') ||
      hasPermission('canManageTransfers') ||
      hasPermission('canApprove')
    );
  };

  const handleOpenInspectBatch = async (batch: SyncDispatchBatch) => {
    setInspectedBatch(batch);
    setReceiptNotesInput(batch.receiptNotes || '');
    setFailReasonInput('');
    setShowFailReasonBox(false);
    if (
      canConfirmBatch(batch) &&
      batch.receiptStatus === 'في انتظار الاستلام' &&
      !batch.isLocalOnly &&
      isOnline
    ) {
      const res = await data.markDispatchReceiving(batch.id);
      if (res.success && res.batch) {
        setInspectedBatch(res.batch);
      }
    }
  };

  const handleConfirmInspectedBatch = async (targetBatch?: SyncDispatchBatch) => {
    const target = targetBatch || inspectedBatch;
    if (!target || batchActionLoading) return;
    setBatchActionLoading(true);
    setActionMsg(null);
    const res = await data.confirmDispatchReceipt(target.id, receiptNotesInput.trim());
    setBatchActionLoading(false);
    if (res.success && res.batch) {
      setInspectedBatch(res.batch);
      setActionMsg({
        type: 'success',
        text: `تم «استلام وتأكيد» الدفعة (${res.batch.batchNumber}) بواسطة ${res.batch.receivedByName || currentUser?.fullName} دون تكرار أي قيد مالي أو مخزني.`,
      });
    } else {
      setActionMsg({ type: 'error', text: res.error || 'تعذر تأكيد استلام الدفعة.' });
    }
  };

  const handleFailInspectedBatch = async () => {
    if (!inspectedBatch || batchActionLoading) return;
    if (!failReasonInput.trim()) {
      setActionMsg({ type: 'error', text: 'يرجى كتابة سبب تعذر الاستلام قبل الحفظ.' });
      return;
    }
    setBatchActionLoading(true);
    setActionMsg(null);
    const res = await data.failDispatchReceipt(inspectedBatch.id, failReasonInput.trim());
    setBatchActionLoading(false);
    if (res.success && res.batch) {
      setInspectedBatch(res.batch);
      setShowFailReasonBox(false);
      setActionMsg({
        type: 'success',
        text: `تم تسجيل حالة «تعذر الاستلام» للدفعة (${res.batch.batchNumber}).`,
      });
    } else {
      setActionMsg({ type: 'error', text: res.error || 'تعذر تسجيل سبب عدم الاستلام.' });
    }
  };

  const handleConfirmCustodyDispatch = async (transferId: string, requestNumber: string) => {
    setConfirmingId(transferId);
    setActionMsg(null);
    const res = await data.updateRepItemTransferStatus(transferId, 'received');
    setConfirmingId(null);
    if (res.success) {
      setActionMsg({
        type: 'success',
        text: res.queuedOffline
          ? `تم تسجيل استلام العهدة (${requestNumber}) محلياً بانتظار الإرسال للسيرفر.`
          : `تم تأكيد استلام عهدة التحويل (${requestNumber}) وإضافتها لمخزون السيارة.`,
      });
    } else {
      setActionMsg({ type: 'error', text: res.error || 'تعذر تأكيد استلام العهدة' });
    }
  };

  const handleConfirmIncomingCash = async (transferId: string, transferNumber: string) => {
    setConfirmingId(transferId);
    setActionMsg(null);
    const res = await data.confirmRepTransferReceipt(transferId, 'تم تأكيد الاستلام من شاشة REFRESH');
    setConfirmingId(null);
    if (res.success) {
      setActionMsg({
        type: 'success',
        text: `تم تأكيد استلام العهدة النقدية (${transferNumber}) بنجاح.`,
      });
    } else {
      setActionMsg({ type: 'error', text: res.error || 'تعذر تأكيد الاستلام النقدي' });
    }
  };

  // Column definitions: Rep Unsent Local Queue Table
  const queueColumns: UnifiedColumn<SyncQueueItem>[] = useMemo(
    () => [
      {
        key: 'summaryAr',
        header: 'بيان العملية المحلية',
        align: 'right',
        sortValue: (r) => r.summaryAr,
        exportValue: (r) => r.summaryAr,
        render: (r) => (
          <div>
            <div className="font-bold text-slate-900">{r.summaryAr}</div>
            {r.lastError && <div className="text-[10px] text-red-700 font-bold mt-0.5">{r.lastError}</div>}
          </div>
        ),
      },
      {
        key: 'localId',
        header: 'المرجع المحلي',
        align: 'center',
        sortValue: (r) => r.localId || r.operationId,
        exportValue: (r) => r.localId || r.operationId,
        render: (r) => (
          <span className="font-mono text-[11px] font-bold text-blue-950 tabular-nums">
            {r.localId || r.operationId}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'القيمة',
        align: 'center',
        sortValue: (r) => Number(r.payload?.total ?? r.payload?.amount ?? r.payload?.paidAmount ?? 0),
        exportValue: (r) => Number(r.payload?.total ?? r.payload?.amount ?? r.payload?.paidAmount ?? 0),
        render: (r) => {
          const val = Number(r.payload?.total ?? r.payload?.amount ?? r.payload?.paidAmount ?? 0);
          return (
            <span className="font-mono font-bold text-slate-900 tabular-nums">
              {val > 0 ? `${val.toLocaleString()} ${data.settings.currency}` : '—'}
            </span>
          );
        },
      },
      {
        key: 'statusLabel',
        header: 'حالة الحفظ / الإرسال',
        align: 'center',
        sortValue: (r) => r.status,
        exportValue: (r) =>
          r.status === 'failed'
            ? 'فشل الإرسال'
            : r.status === 'syncing'
            ? 'جاري الإرسال'
            : !isOnline || r.status === 'local'
            ? 'محفوظة محليًا'
            : 'جاهزة للإرسال',
        render: (r) => {
          const label: SyncDispatchBatchStatus =
            r.status === 'failed'
              ? 'فشل الإرسال'
              : r.status === 'syncing'
              ? 'جاري الإرسال'
              : !isOnline || r.status === 'local'
              ? 'محفوظة محليًا'
              : 'جاهزة للإرسال';
          return (
            <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold ${getDispatchStatusClasses(label)}`}>
              {label}
            </span>
          );
        },
      },
      {
        key: 'createdAt',
        header: 'وقت التسجيل',
        align: 'center',
        sortValue: (r) => r.createdAt,
        exportValue: (r) => formatDateTimeAr(r.createdAt),
        render: (r) => <span className="font-mono text-[11px] text-slate-600 tabular-nums">{formatDateTimeAr(r.createdAt)}</span>,
      },
    ],
    [data.settings.currency, isOnline]
  );

  // Column definitions: Official 12-Column Dispatch Batches Table (Exact Required Headers)
  const dispatchColumns: UnifiedColumn<SyncDispatchBatch>[] = useMemo(
    () => [
      {
        key: 'batchNumber',
        header: 'رقم العملية',
        align: 'center',
        sortValue: (b) => b.batchNumber,
        exportValue: (b) => b.batchNumber,
        render: (b) => (
          <span className="font-mono font-black text-blue-950 tabular-nums">{b.batchNumber}</span>
        ),
      },
      {
        key: 'senderName',
        header: 'المرسل',
        align: 'right',
        sortValue: (b) => b.senderName || b.representativeName || '',
        exportValue: (b) => b.senderName || b.representativeName || '',
        render: (b) => (
          <div>
            <div className="font-bold text-slate-900">{b.senderName || '—'}</div>
            {b.representativeName && b.representativeName !== b.senderName && (
              <div className="text-[10px] text-slate-500">{b.representativeName}</div>
            )}
          </div>
        ),
      },
      {
        key: 'recipientName',
        header: 'المستلم',
        align: 'right',
        sortValue: (b) => b.recipientName || '',
        exportValue: (b) => b.recipientName || '',
        render: (b) => <span className="font-bold text-slate-800">{b.recipientName || '—'}</span>,
      },
      {
        key: 'sentAt',
        header: 'تاريخ الإرسال',
        align: 'center',
        sortValue: (b) => b.sentAt || b.createdAt || '',
        exportValue: (b) => formatDateTimeAr(b.sentAt || b.createdAt),
        render: (b) => (
          <span className="font-mono text-[11px] text-slate-700 tabular-nums">
            {formatDateTimeAr(b.sentAt || b.createdAt)}
          </span>
        ),
      },
      {
        key: 'salesCount',
        header: 'عدد فواتير البيع',
        align: 'center',
        sortValue: (b) => Number(b.salesCount || 0),
        exportValue: (b) => Number(b.salesCount || 0),
        render: (b) => <span className="font-mono font-bold text-slate-900 tabular-nums">{b.salesCount || 0}</span>,
      },
      {
        key: 'collectionsCount',
        header: 'عدد التحصيلات',
        align: 'center',
        sortValue: (b) => Number(b.collectionsCount || 0),
        exportValue: (b) => Number(b.collectionsCount || 0),
        render: (b) => <span className="font-mono font-bold text-slate-900 tabular-nums">{b.collectionsCount || 0}</span>,
      },
      {
        key: 'returnsCount',
        header: 'عدد المرتجعات',
        align: 'center',
        sortValue: (b) => Number(b.returnsCount || 0),
        exportValue: (b) => Number(b.returnsCount || 0),
        render: (b) => <span className="font-mono font-bold text-slate-900 tabular-nums">{b.returnsCount || 0}</span>,
      },
      {
        key: 'totalCashAmount',
        header: 'إجمالي التحصيلات',
        align: 'center',
        sortValue: (b) => Number(b.totalCashAmount || 0),
        exportValue: (b) => Number(b.totalCashAmount || 0),
        render: (b) => (
          <span className="font-mono font-black text-blue-950 tabular-nums">
            {Number(b.totalCashAmount || 0).toLocaleString()} {data.settings.currency}
          </span>
        ),
      },
      {
        key: 'sendStatus',
        header: 'حالة الإرسال',
        align: 'center',
        sortValue: (b) => b.sendStatus,
        exportValue: (b) => b.sendStatus,
        render: (b) => (
          <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${getDispatchStatusClasses(b.sendStatus)}`}>
            {b.sendStatus}
          </span>
        ),
      },
      {
        key: 'receiptStatus',
        header: 'حالة الاستلام',
        align: 'center',
        sortValue: (b) => b.receiptStatus,
        exportValue: (b) => b.receiptStatus,
        render: (b) => (
          <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${getDispatchStatusClasses(b.receiptStatus)}`}>
            {b.receiptStatus}
          </span>
        ),
      },
      {
        key: 'receivedAt',
        header: 'تاريخ الاستلام',
        align: 'center',
        sortValue: (b) => b.receivedAt || '',
        exportValue: (b) => formatDateTimeAr(b.receivedAt),
        render: (b) => (
          <span className="font-mono text-[11px] text-slate-700 tabular-nums">
            {b.receivedAt ? formatDateTimeAr(b.receivedAt) : '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'الإجراءات',
        align: 'center',
        sortable: false,
        render: (b) => (
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenInspectBatch(b);
              }}
              className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>مراجعة</span>
            </button>
            {b.sendStatus === 'فشل الإرسال' && b.senderUserId === currentUser?.id && (
              <button
                type="button"
                disabled={isSending}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRetryBatch(b);
                }}
                className="px-2 py-0.5 rounded-md bg-blue-900 hover:bg-blue-950 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>إعادة إرسال</span>
              </button>
            )}
            {canConfirmBatch(b) && (
              <button
                type="button"
                disabled={batchActionLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  handleConfirmInspectedBatch(b);
                }}
                className="px-2 py-0.5 rounded-md bg-blue-950 hover:bg-blue-900 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>استلام وتأكيد</span>
              </button>
            )}
          </div>
        ),
      },
    ],
    [data.settings.currency, currentUser?.id, isSending, batchActionLoading]
  );

  // Batch inspection document columns
  const batchDocColumns: UnifiedColumn<SyncDispatchBatchDocSummaryItem>[] = useMemo(
    () => [
      {
        key: 'docNumber',
        header: 'رقم المستند',
        align: 'center',
        sortValue: (d) => d.docNumber || d.entityId || d.operationId,
        exportValue: (d) => d.docNumber || d.entityId || d.operationId,
        render: (d) => <span className="font-mono font-bold text-blue-950 tabular-nums">{d.docNumber || d.entityId || '—'}</span>,
      },
      {
        key: 'summaryAr',
        header: 'العملية',
        align: 'right',
        sortValue: (d) => d.summaryAr,
        exportValue: (d) => d.summaryAr,
        render: (d) => <span className="font-bold text-slate-900">{d.summaryAr}</span>,
      },
      {
        key: 'customerName',
        header: 'العميل / الجهة',
        align: 'right',
        sortValue: (d) => d.customerName || '',
        exportValue: (d) => d.customerName || '',
        render: (d) => <span className="text-slate-700">{d.customerName || '—'}</span>,
      },
      {
        key: 'amount',
        header: 'القيمة',
        align: 'center',
        sortValue: (d) => Number(d.amount || 0),
        exportValue: (d) => Number(d.amount || 0),
        render: (d) => (
          <span className="font-mono font-bold text-slate-900 tabular-nums">
            {Number(d.amount || 0).toLocaleString()} {data.settings.currency}
          </span>
        ),
      },
      {
        key: 'paidAmount',
        header: 'التحصيل النقدي',
        align: 'center',
        sortValue: (d) => Number(d.paidAmount || 0),
        exportValue: (d) => Number(d.paidAmount || 0),
        render: (d) => (
          <span className="font-mono font-bold text-emerald-800 tabular-nums">
            {Number(d.paidAmount || 0).toLocaleString()} {data.settings.currency}
          </span>
        ),
      },
      {
        key: 'createdAt',
        header: 'وقت الإنشاء',
        align: 'center',
        sortValue: (d) => d.createdAt || '',
        exportValue: (d) => formatDateTimeAr(d.createdAt),
        render: (d) => <span className="font-mono text-[11px] text-slate-600 tabular-nums">{formatDateTimeAr(d.createdAt)}</span>,
      },
    ],
    [data.settings.currency]
  );

  // Incoming Custody & Cash Tables for Reps
  const incomingCustodyRows = useMemo(
    () => [
      ...awaitingCustodyDispatches.map((tr) => ({
        id: `item:${tr.id}`,
        rawId: tr.id,
        kind: 'item' as const,
        docNo: tr.requestNumber,
        typeLabel: tr.transferMode === 'custody_dispatch' ? 'صرف عهدة بضاعة للمندوب' : 'تحويل أصناف للسيارة',
        detail: (tr.items || []).map((it) => `${it.productName} (${it.approvedQty ?? it.requestedQty} ${it.unit})`).join(' · '),
        date: tr.date,
      })),
      ...awaitingCashTransfers.map((ct) => ({
        id: `cash:${ct.id}`,
        rawId: ct.id,
        kind: 'cash' as const,
        docNo: ct.transferNumber,
        typeLabel: 'عهدة نقدية واردة من الإدارة',
        detail: `${ct.amount.toLocaleString()} ${data.settings.currency}${ct.notes ? ` · ${ct.notes}` : ''}`,
        date: ct.date,
      })),
    ],
    [awaitingCustodyDispatches, awaitingCashTransfers, data.settings.currency]
  );

  const incomingCustodyColumns: UnifiedColumn<(typeof incomingCustodyRows)[number]>[] = useMemo(
    () => [
      {
        key: 'docNo',
        header: 'رقم المستند',
        align: 'center',
        sortValue: (r) => r.docNo,
        exportValue: (r) => r.docNo,
        render: (r) => <span className="font-mono font-black text-blue-950 tabular-nums">{r.docNo}</span>,
      },
      {
        key: 'typeLabel',
        header: 'النوع',
        align: 'right',
        sortValue: (r) => r.typeLabel,
        exportValue: (r) => r.typeLabel,
        render: (r) => <span className="font-bold text-slate-900">{r.typeLabel}</span>,
      },
      {
        key: 'detail',
        header: 'التفاصيل / الأصناف',
        align: 'right',
        sortValue: (r) => r.detail,
        exportValue: (r) => r.detail,
        render: (r) => <span className="text-xs text-slate-700">{r.detail}</span>,
      },
      {
        key: 'date',
        header: 'التاريخ',
        align: 'center',
        sortValue: (r) => r.date,
        exportValue: (r) => r.date,
        render: (r) => <span className="font-mono text-[11px] text-slate-600 tabular-nums">{r.date}</span>,
      },
      {
        key: 'actions',
        header: 'الإجراء',
        align: 'center',
        sortable: false,
        render: (r) => (
          <button
            type="button"
            disabled={confirmingId === r.rawId}
            onClick={() =>
              r.kind === 'item'
                ? handleConfirmCustodyDispatch(r.rawId, r.docNo)
                : handleConfirmIncomingCash(r.rawId, r.docNo)
            }
            className="px-2.5 py-1 rounded-md bg-blue-900 hover:bg-blue-950 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            {confirmingId === r.rawId ? 'جاري التأكيد...' : 'تأكيد الاستلام'}
          </button>
        ),
      },
    ],
    [confirmingId]
  );

  const inspectedDocs: SyncDispatchBatchDocSummaryItem[] = useMemo(() => {
    if (!inspectedBatch) return [];
    if (Array.isArray(inspectedBatch.docSummary) && inspectedBatch.docSummary.length > 0) {
      return inspectedBatch.docSummary;
    }
    if (Array.isArray(inspectedBatch.operationsSnapshot)) {
      return inspectedBatch.operationsSnapshot.map((op) => ({
        operationId: op.operationId,
        operationType: op.operationType,
        entityType: op.entityType,
        entityId: op.entityId || op.localId,
        docNumber: op.payload?.invoiceNumber || op.payload?.receiptNumber || op.localId,
        customerName: op.payload?.customerName || op.payload?.name,
        amount: Number(op.payload?.total ?? op.payload?.amount ?? 0),
        paidAmount: Number(op.payload?.paidAmount ?? op.payload?.amount ?? 0),
        summaryAr: op.summaryAr,
        createdAt: op.createdAt,
      }));
    }
    return [];
  }, [inspectedBatch]);

  return (
    <div className="space-y-2">
      {/* Top Header Strip */}
      <div className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-blue-950 text-white flex items-center justify-center shrink-0">
            <RefreshCw className={`w-4 h-4 ${isSending || isReceiving ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-black text-slate-900">
              REFRESH · مركز إرسال واستلام المندوبين
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
              <span className={`inline-flex items-center gap-1 font-bold ${isOnline ? 'text-emerald-800' : 'text-red-700'}`}>
                {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {isOnline ? 'متصل بالسيرفر المركزي' : 'وضع العمل بدون إنترنت'}
              </span>
              <span aria-hidden="true">·</span>
              <span>آخر مزامنة: <strong className="font-mono tabular-nums">{formatDateTimeAr(data.lastServerSyncAt)}</strong></span>
              {(isSending || sendElapsedMs > 0) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-blue-950 font-bold">
                    زمن الإرسال: {formatElapsedTenths(sendElapsedMs)}
                  </span>
                </>
              )}
              {(isReceiving || receiveElapsedMs > 0) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-emerald-800 font-bold">
                    زمن التحديث: {formatElapsedTenths(receiveElapsedMs)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            disabled={isReceiving}
            onClick={handleReceiveSyncNow}
            className="h-8 px-2.5 rounded-md bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span>{isReceiving ? 'جاري التحديث...' : 'تحديث واستلام من السيرفر'}</span>
          </button>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              رجوع
            </button>
          )}
        </div>
      </div>

      {actionMsg && (
        <div
          className={`p-2 rounded-lg border text-xs font-bold flex items-center gap-2 ${
            actionMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {actionMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* Compact Hairline KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden">
        <div className="bg-white px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500">
            {isRepUser ? 'العمليات المعلقة للإرسال' : 'دفعات في انتظار الاستلام'}
          </div>
          <div className="text-sm font-black text-blue-950 font-mono tabular-nums mt-0.5">
            {isRepUser ? unsentQueueOps.length : kpiStats.waiting}
          </div>
        </div>
        <div className="bg-white px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500">دفعات تم استلامها اليوم</div>
          <div className="text-sm font-black text-emerald-800 font-mono tabular-nums mt-0.5">
            {kpiStats.confirmedToday}
          </div>
        </div>
        <div className="bg-white px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500">دفعات فشل أو تعذر استلامها</div>
          <div className="text-sm font-black text-red-700 font-mono tabular-nums mt-0.5">
            {kpiStats.failed}
          </div>
        </div>
        <div className="bg-white px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500">إجمالي التحصيلات المستلمة</div>
          <div className="text-sm font-black text-slate-900 font-mono tabular-nums mt-0.5">
            {kpiStats.totalCash.toLocaleString()} {data.settings.currency}
          </div>
        </div>
      </div>

      {/* REP DISPATCH BUILDER PANEL */}
      {(isRepUser || unsentQueueOps.length > 0 || failedDraftBatches.length > 0) && (
        <div className="space-y-2">
          {failedDraftBatches.length > 0 && (
            <div className="bg-red-50 rounded-lg border border-red-200 p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-red-900">
                  توجد دفعات فشل إرسالها وتحتاج إعادة محاولة ({failedDraftBatches.length})
                </span>
              </div>
              <div className="space-y-1.5">
                {failedDraftBatches.map((draft) => (
                  <div
                    key={draft.id}
                    className="bg-white rounded-md border border-red-200 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-red-900">{draft.batchNumber}</span>
                      <span className="mx-1.5 text-slate-400">·</span>
                      <span className="font-bold text-slate-800">المستلم: {draft.recipientName}</span>
                      <span className="mx-1.5 text-slate-400">·</span>
                      <span className="font-mono tabular-nums">{draft.operationIds.length} عمليات</span>
                    </div>
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => handleRetryBatch(draft)}
                      className="px-2.5 py-1 rounded-md bg-blue-900 hover:bg-blue-950 text-white font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>إعادة الإرسال الآن</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <UnifiedDataTable<SyncQueueItem>
            title="العمليات المحفوظة محلياً الجاهزة للإرسال"
            subtitle="حدد العمليات واختر الموظف المستلم لإصدار دفعة إرسال رسمية برقم متسلسل"
            columns={queueColumns}
            data={unsentQueueOps}
            rowKey={(r) => r.operationId}
            selectable={true}
            selectedKeys={selectedOpIds}
            onSelectionChange={setSelectedOpIds}
            emptyTitle="لا توجد عمليات محلية معلقة"
            emptySubtitle="جميع فواتيرك وتحصيلاتك مرسلة ومعتمدة على السيرفر المركزي"
            exportFilename="العمليات-المحلية-المعلقة"
            pdfTitle="قائمة العمليات المحلية المعلقة"
            compact
            headerActions={
              unsentQueueOps.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={recipientUserId}
                    onChange={(e) => setRecipientUserId(e.target.value)}
                    aria-label="الموظف المستلم للدفعة"
                    className="h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold text-slate-900"
                  >
                    <option value="">-- اختر المستلم (إدارة / موظف) --</option>
                    {(data.dispatchRecipients || []).map((rec) => (
                      <option key={rec.id} value={rec.id}>
                        {rec.fullName} ({rec.jobTitle || rec.role})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    placeholder="ملاحظات الإرسال (اختياري)..."
                    className="h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold text-slate-900 w-44"
                  />
                  <button
                    type="button"
                    disabled={isSending || selectedOpIds.length === 0}
                    onClick={handleSendSelectedDispatchBatch}
                    className="h-8 px-3 rounded-md bg-blue-900 hover:bg-blue-950 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSending ? 'جاري الإرسال...' : `إرسال الدفعة (${selectedOpIds.length})`}</span>
                  </button>
                </div>
              ) : undefined
            }
          />
        </div>
      )}

      {/* INCOMING CUSTODY DISPATCHES & CASH TRANSFERS FOR REPS */}
      {(awaitingCustodyDispatches.length > 0 || awaitingCashTransfers.length > 0) && (
        <UnifiedDataTable
          title="العهد والتحويلات الواردة من الإدارة بانتظار تأكيد الاستلام"
          subtitle="بضائع منصرفة للسيارة وعهد نقدية بانتظار اعتماد استلامك"
          columns={incomingCustodyColumns}
          data={incomingCustodyRows}
          rowKey={(r) => r.id}
          searchable={false}
          compact
        />
      )}

      {/* OFFICIAL 12-COLUMN DISPATCH BATCHES LOG */}
      <UnifiedDataTable<SyncDispatchBatch>
        title={isRepUser ? 'سجل دفعات الإرسال والاستلام الرسمية' : 'جدول إرسال واستلام المندوبين المركزي'}
        subtitle="متابعة كافة دفعات المندوبين وحالات الإرسال والاستلام وتفاصيل كل مستند"
        columns={dispatchColumns}
        data={filteredBatches}
        rowKey={(b) => b.id}
        onRowClick={(b) => handleOpenInspectBatch(b)}
        exportFilename="سجل-دفعات-إرسال-واستلام-المندوبين"
        pdfTitle="سجل دفعات إرسال واستلام المندوبين"
        searchPlaceholder="ابحث برقم الدفعة، اسم المندوب، المستلم..."
        toolbarFilters={
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="تصفية بحالة الدفعة"
              className="h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold text-slate-800"
            >
              <option value="all">جميع الحالات</option>
              <option value="في انتظار الاستلام">في انتظار الاستلام</option>
              <option value="جاري الاستلام">جاري الاستلام</option>
              <option value="تم الاستلام">تم الاستلام</option>
              <option value="تعذر الاستلام">تعذر الاستلام</option>
              <option value="فشل الإرسال">فشل الإرسال</option>
              <option value="تم الإرسال">تم الإرسال</option>
              <option value="جاري الإرسال">جاري الإرسال</option>
              <option value="جاهزة للإرسال">جاهزة للإرسال</option>
              <option value="محفوظة محليًا">محفوظة محليًا</option>
            </select>

            {!isRepUser && uniqueSenders.length > 0 && (
              <select
                value={senderFilter}
                onChange={(e) => setSenderFilter(e.target.value)}
                aria-label="تصفية بالمرسل"
                className="h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold text-slate-800"
              >
                <option value="all">كل المندوبين</option>
                {uniqueSenders.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}

            {uniqueRecipients.length > 0 && (
              <select
                value={recipientFilter}
                onChange={(e) => setRecipientFilter(e.target.value)}
                aria-label="تصفية بالمستلم"
                className="h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold text-slate-800"
              >
                <option value="all">كل المستلمين</option>
                {uniqueRecipients.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}

            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="تصفية بتاريخ الإرسال"
              className="h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold text-slate-800"
            />

            {(statusFilter !== 'all' || senderFilter !== 'all' || recipientFilter !== 'all' || dateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setSenderFilter('all');
                  setRecipientFilter('all');
                  setDateFilter('');
                }}
                className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
              >
                إعادة ضبط
              </button>
            )}
          </div>
        }
      />

      {/* BATCH INSPECTION & CONFIRMATION PORTAL MODAL */}
      {inspectedBatch &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-2 sm:p-3">
            <div
              dir="rtl"
              className="bg-white rounded-lg border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-3 py-2 bg-blue-950 text-white flex items-center justify-between gap-2 shrink-0">
                <div>
                  <h3 className="text-xs sm:text-sm font-black">
                    مراجعة دفعة الإرسال · <span className="font-mono">{inspectedBatch.batchNumber}</span>
                  </h3>
                  <p className="text-[11px] text-blue-200">
                    المرسل: {inspectedBatch.senderName} · المستلم المحدد: {inspectedBatch.recipientName} · أرسلت في: {formatDateTimeAr(inspectedBatch.sentAt || inspectedBatch.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedBatch(null)}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  aria-label="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {/* Compact Hairline Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden text-xs">
                  <div className="px-2.5 py-1.5 bg-white">
                    <div className="text-[10px] text-slate-500">حالة الإرسال</div>
                    <div className="font-black text-slate-900">{inspectedBatch.sendStatus}</div>
                  </div>
                  <div className="px-2.5 py-1.5 bg-white">
                    <div className="text-[10px] text-slate-500">حالة الاستلام</div>
                    <div className="font-black text-blue-950">{inspectedBatch.receiptStatus}</div>
                  </div>
                  <div className="px-2.5 py-1.5 bg-white">
                    <div className="text-[10px] text-slate-500">إجمالي المبيعات بالدفعة</div>
                    <div className="font-mono font-black text-slate-900 tabular-nums">
                      {Number(inspectedBatch.totalSalesAmount || 0).toLocaleString()} {data.settings.currency}
                    </div>
                  </div>
                  <div className="px-2.5 py-1.5 bg-white">
                    <div className="text-[10px] text-slate-500">إجمالي التحصيلات النقدية</div>
                    <div className="font-mono font-black text-emerald-800 tabular-nums">
                      {Number(inspectedBatch.totalCashAmount || 0).toLocaleString()} {data.settings.currency}
                    </div>
                  </div>
                </div>

                {/* Operational Counts Breakdown */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden text-center text-xs">
                  <div className="px-2 py-1 bg-white">
                    <div className="text-[10px] text-slate-500">فواتير بيع</div>
                    <div className="font-mono font-black tabular-nums">{inspectedBatch.salesCount || 0}</div>
                  </div>
                  <div className="px-2 py-1 bg-white">
                    <div className="text-[10px] text-slate-500">تحصيلات</div>
                    <div className="font-mono font-black tabular-nums">{inspectedBatch.collectionsCount || 0}</div>
                  </div>
                  <div className="px-2 py-1 bg-white">
                    <div className="text-[10px] text-slate-500">مرتجعات</div>
                    <div className="font-mono font-black tabular-nums">{inspectedBatch.returnsCount || 0}</div>
                  </div>
                  <div className="px-2 py-1 bg-white">
                    <div className="text-[10px] text-slate-500">فواتير شراء</div>
                    <div className="font-mono font-black tabular-nums">{inspectedBatch.purchasesCount || 0}</div>
                  </div>
                  <div className="px-2 py-1 bg-white">
                    <div className="text-[10px] text-slate-500">عملاء جدد</div>
                    <div className="font-mono font-black tabular-nums">{inspectedBatch.customersCount || 0}</div>
                  </div>
                  <div className="px-2 py-1 bg-white">
                    <div className="text-[10px] text-slate-500">عمليات عهدة</div>
                    <div className="font-mono font-black tabular-nums">{inspectedBatch.custodyOpsCount || 0}</div>
                  </div>
                </div>

                {(inspectedBatch.notes || inspectedBatch.receiptNotes || inspectedBatch.errorMessage || inspectedBatch.receivedByName) && (
                  <div className="p-2 rounded-md bg-slate-50 border border-slate-200 text-xs space-y-1">
                    {inspectedBatch.notes && (
                      <div>
                        <span className="font-bold text-slate-600">ملاحظات المرسل: </span>
                        <span className="text-slate-900">{inspectedBatch.notes}</span>
                      </div>
                    )}
                    {inspectedBatch.receivedByName && (
                      <div>
                        <span className="font-bold text-emerald-800">المستلم الفعلي: </span>
                        <span className="font-black text-slate-900">
                          {inspectedBatch.receivedByName} ({formatDateTimeAr(inspectedBatch.receivedAt)})
                        </span>
                      </div>
                    )}
                    {inspectedBatch.receiptNotes && (
                      <div>
                        <span className="font-bold text-slate-600">ملاحظات الاستلام: </span>
                        <span className="text-slate-900">{inspectedBatch.receiptNotes}</span>
                      </div>
                    )}
                    {inspectedBatch.errorMessage && (
                      <div className="text-red-700 font-bold">
                        سبب المشكلة / التعذر: {inspectedBatch.errorMessage}
                      </div>
                    )}
                  </div>
                )}

                {/* Document Line Items Table */}
                <UnifiedDataTable<SyncDispatchBatchDocSummaryItem>
                  title={`تفاصيل المستندات داخل الدفعة (${inspectedDocs.length})`}
                  columns={batchDocColumns}
                  data={inspectedDocs}
                  rowKey={(d, idx) => d.operationId || String(idx)}
                  searchable={inspectedDocs.length > 5}
                  compact
                  defaultPageSize={10}
                />

                {/* Admin / Staff Confirmation Action Section */}
                {canConfirmBatch(inspectedBatch) && (
                  <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200 space-y-2">
                    <div className="text-xs font-black text-blue-950">
                      اعتماد استلام الدفعة إدارياً (تأكيد التوثيق دون تكرار أي ترحيل مالي أو مخزني)
                    </div>
                    <input
                      type="text"
                      value={receiptNotesInput}
                      onChange={(e) => setReceiptNotesInput(e.target.value)}
                      placeholder="ملاحظات الاستلام والتدقيق (اختياري)..."
                      className="w-full h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs font-bold text-slate-900"
                    />

                    {showFailReasonBox && (
                      <div className="space-y-1.5 p-2 rounded-md bg-white border border-red-200">
                        <label className="block text-xs font-bold text-red-800">
                          سبب تعذر الاستلام:
                        </label>
                        <input
                          type="text"
                          value={failReasonInput}
                          onChange={(e) => setFailReasonInput(e.target.value)}
                          placeholder="مثال: نقص مستندات أو فرق عهدة..."
                          className="w-full h-8 px-2.5 rounded-md border border-red-300 text-xs font-bold text-slate-900"
                        />
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={batchActionLoading}
                            onClick={handleFailInspectedBatch}
                            className="h-8 px-3 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            حفظ حالة «تعذر الاستلام»
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowFailReasonBox(false)}
                            className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {!showFailReasonBox && (
                        <button
                          type="button"
                          disabled={batchActionLoading}
                          onClick={() => setShowFailReasonBox(true)}
                          className="h-8 px-3 rounded-md bg-white border border-red-300 text-red-800 hover:bg-red-50 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          <span>تعذر الاستلام</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={batchActionLoading}
                        onClick={() => handleConfirmInspectedBatch(inspectedBatch)}
                        className="h-8 px-3 rounded-md bg-blue-950 hover:bg-blue-900 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>{batchActionLoading ? 'جاري التأكيد...' : 'استلام وتأكيد'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

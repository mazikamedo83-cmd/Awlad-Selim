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
  Wallet,
  PackageCheck,
  ListChecks,
  History,
  GitCompare,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime, formatLocaleNumber } from '../../../i18n/translator';
import { fetchDispatchBatchDetails } from '../../../services/api';
import { formatCountdownMmSs } from '../../../services/syncEngine';
import { UnifiedColumn, UnifiedDataTable } from '../../common/UnifiedDataTable';
import { RepTransferView } from '../representatives/RepTransferView';
import {
  AuditLogItem,
  RepItemTransferRequest,
  RepTransfer,
  SyncConflictRecord,
  SyncDispatchBatch,
  SyncDispatchBatchDocSummaryItem,
  SyncDispatchBatchStatus,
  SyncQueueItem,
} from '../../../types';

export type UnifiedTransferSyncTab =
  | 'send'
  | 'receive'
  | 'financial-transfers'
  | 'stock-custody'
  | 'pending'
  | 'log';

interface RefreshSyncScreenProps {
  onBack?: () => void;
  initialTab?: UnifiedTransferSyncTab;
}

type UnifiedLogStatus =
  | 'جديد'
  | 'في انتظار الإرسال'
  | 'تم الإرسال'
  | 'في انتظار الاستلام'
  | 'تم الاستلام'
  | 'مكتمل'
  | 'فشل المزامنة'
  | 'مرفوض';

interface UnifiedOpLogRow {
  id: string;
  sourceKind: 'dispatch' | 'cash' | 'item';
  opTypeKey: 'dispatch' | 'cash_transfer' | 'stock_transfer';
  docNumber: string;
  opTypeAr: string;
  opTypeEn: string;
  senderName: string;
  receiverName: string;
  createdAt: string;
  sentAt: string;
  receivedAt: string;
  unifiedStatus: UnifiedLogStatus;
  failureReason: string;
  amountText: string;
  notes?: string;
  rawDispatch?: SyncDispatchBatch;
  rawCash?: RepTransfer;
  rawItem?: RepItemTransferRequest;
}

function formatElapsedTenths(ms: number): string {
  const totalTenths = Math.max(0, Math.floor(ms / 100));
  const mins = Math.floor(totalTenths / 600);
  const secs = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function formatDateTimeLocale(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return formatLocaleDateTime(iso);
  } catch {
    return String(iso);
  }
}

const DISPATCH_STATUS_EN: Record<string, string> = {
  'تم الاستلام': 'Received',
  'تم الإرسال': 'Sent',
  'في انتظار الاستلام': 'Awaiting Receipt',
  'جاهزة للإرسال': 'Ready to Send',
  'جاري الإرسال': 'Sending...',
  'جاري الاستلام': 'Receiving...',
  'محفوظة محليًا': 'Saved Locally',
  'فشل الإرسال': 'Send Failed',
  'تعذر الاستلام': 'Receipt Failed',
  'جديد': 'New',
  'في انتظار الإرسال': 'Awaiting Send',
  'مكتمل': 'Completed',
  'فشل المزامنة': 'Sync Failed',
  'مرفوض': 'Rejected',
};

function getDispatchStatusClasses(status: SyncDispatchBatchStatus | UnifiedLogStatus | string): string {
  switch (status) {
    case 'تم الاستلام':
    case 'تم الإرسال':
    case 'مكتمل':
      return 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
    case 'في انتظار الاستلام':
    case 'جاهزة للإرسال':
    case 'في انتظار الإرسال':
      return 'bg-blue-50 text-blue-950 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800';
    case 'جاري الإرسال':
    case 'جاري الاستلام':
    case 'جديد':
      return 'bg-[#EEF3FA] text-[#003589] border-[#DCE6F5] dark:bg-[#132544] dark:text-[#85B8FF] dark:border-[#2C4775]';
    case 'محفوظة محليًا':
      return 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-[#132544] dark:text-[#CBD5E1] dark:border-[#2C4775]';
    case 'فشل الإرسال':
    case 'تعذر الاستلام':
    case 'فشل المزامنة':
    case 'مرفوض':
      return 'bg-red-50 text-red-900 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-[#132544] dark:text-[#CBD5E1] dark:border-[#2C4775]';
  }
}

export const RefreshSyncScreen: React.FC<RefreshSyncScreenProps> = ({ onBack, initialTab }) => {
  const data = useData();
  const { currentUser, representativeProfile, hasPermission } = useAuth();
  const { t, dir } = usePreferences();

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

  // Active Unified 6-Tab state
  const [activeUnifiedTab, setActiveUnifiedTab] = useState<UnifiedTransferSyncTab>(initialTab || 'send');
  const [stockSubTab, setStockSubTab] = useState<'item-transfers' | 'rep-custody-statement'>('item-transfers');
  const [logViewMode, setLogViewMode] = useState<'unified' | 'batches'>('unified');

  useEffect(() => {
    if (initialTab) {
      setActiveUnifiedTab(initialTab);
    }
  }, [initialTab]);

  // Timers for sync status feedback
  const [isSending, setIsSending] = useState(false);
  const [sendElapsedMs, setSendElapsedMs] = useState(0);
  const sendStartRef = useRef<number | null>(null);

  const [isReceiving, setIsReceiving] = useState(false);
  const [receiveElapsedMs, setReceiveElapsedMs] = useState(0);
  const receiveStartRef = useRef<number | null>(null);

  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastSendOutcomes, setLastSendOutcomes] = useState<
    Array<{ id: string; label: string; ok: boolean; detail: string }>
  >([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);

  // Cash Transfer rejection modal state
  const [rejectCashTarget, setRejectCashTarget] = useState<{ id: string; docNo: string } | null>(null);
  const [rejectCashReason, setRejectCashReason] = useState<string>('');
  const [rejectCashLoading, setRejectCashLoading] = useState<boolean>(false);

  // Read-only Transfer / Item inspection modal state
  const [inspectedTransferRow, setInspectedTransferRow] = useState<UnifiedOpLogRow | null>(null);

  // Batch creation state
  const [selectedOpIds, setSelectedOpIds] = useState<string[]>([]);
  const [recipientUserId, setRecipientUserId] = useState<string>('');
  const [batchNotes, setBatchNotes] = useState<string>('');

  // Log & Batch filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [senderFilter, setSenderFilter] = useState<string>('all');
  const [recipientFilter, setRecipientFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [opTypeFilter, setOpTypeFilter] = useState<string>('all');
  const [dateFromFilter, setDateFromFilter] = useState<string>('');
  const [dateToFilter, setDateToFilter] = useState<string>('');

  // Inspection & Confirmation Modal state
  const [inspectedBatch, setInspectedBatch] = useState<SyncDispatchBatch | null>(null);
  const [inspectedAuditTrail, setInspectedAuditTrail] = useState<AuditLogItem[]>([]);
  const [isLoadingInspectDetails, setIsLoadingInspectDetails] = useState<boolean>(false);
  const [receiptNotesInput, setReceiptNotesInput] = useState<string>('');
  const [hasDiscrepancyInput, setHasDiscrepancyInput] = useState<boolean>(false);
  const [discrepancyNoteInput, setDiscrepancyNoteInput] = useState<string>('');
  const [failReasonInput, setFailReasonInput] = useState<string>('');
  const [showFailReasonBox, setShowFailReasonBox] = useState<boolean>(false);
  const [batchActionLoading, setBatchActionLoading] = useState<boolean>(false);

  // Explicit Pre-Send Summary Confirmation Modal state
  const [pendingSendConfirm, setPendingSendConfirm] = useState<{
    chosenOps: SyncQueueItem[];
    recipientId: string;
    recipientLabel: string;
    notes: string;
    salesCount: number;
    collectionsCount: number;
    returnsCount: number;
    purchasesCount: number;
    ordersCount: number;
    customersCount: number;
    custodyOpsCount: number;
    totalSalesAmount: number;
    totalCashAmount: number;
  } | null>(null);

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

  useEffect(() => {
    if (!pendingSendConfirm && !inspectedBatch && !rejectCashTarget && !inspectedTransferRow) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      if (pendingSendConfirm) {
        setPendingSendConfirm(null);
      } else if (rejectCashTarget && !rejectCashLoading) {
        setRejectCashTarget(null);
      } else if (inspectedTransferRow) {
        setInspectedTransferRow(null);
      } else if (inspectedBatch && !batchActionLoading) {
        setInspectedBatch(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pendingSendConfirm, inspectedBatch, batchActionLoading, rejectCashTarget, rejectCashLoading, inspectedTransferRow]);

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
      if (rep) {
        if (t.senderRepresentativeId && t.senderRepresentativeId === rep.id) return false;
        return t.representativeId === rep.id;
      }
      if (isRepUser) return false;
      if (currentUser && t.requestedBy === currentUser.id && t.transferMode === 'rep_to_rep') return false;
      return true;
    });
  }, [data.repItemTransfers, rep, isRepUser, currentUser]);

  const awaitingCashTransfers = useMemo(() => {
    return (data.repTransfers || []).filter((t) => {
      if (t.status !== 'awaiting_receipt') return false;
      if (rep) {
        if (t.senderId === rep.id) return false;
        return (t.direction === 'owner_to_rep' || t.direction === 'rep_to_rep') && t.receiverId === rep.id;
      }
      if (isRepUser) return false;
      return t.direction === 'rep_to_owner' || t.direction === 'rep_to_rep';
    });
  }, [data.repTransfers, rep, isRepUser]);

  // All dispatch batches visible to user
  const allBatches = useMemo(() => data.syncDispatchBatches || [], [data.syncDispatchBatches]);

  const failedDraftBatches = useMemo(
    () =>
      allBatches.filter(
        (b) =>
          (b.sendStatus === 'فشل الإرسال' || (b.isLocalOnly && b.isConfirmedSendQueued)) &&
          b.senderUserId === currentUser?.id
      ),
    [allBatches, currentUser?.id]
  );

  const needsReviewConflicts = useMemo(
    () => (data.syncConflicts || []).filter((c) => c.status === 'needs_review'),
    [data.syncConflicts]
  );

  const pendingCashAll = useMemo(
    () => (data.repTransfers || []).filter((tr) => tr.status === 'awaiting_receipt'),
    [data.repTransfers]
  );

  const pendingItemAll = useMemo(
    () =>
      (data.repItemTransfers || []).filter(
        (tr) => tr.status === 'pending' || tr.status === 'approved' || tr.status === 'executed'
      ),
    [data.repItemTransfers]
  );

  const canConfirmBatch = (batch: SyncDispatchBatch) => {
    if (!currentUser) return false;
    if (currentUser.role === 'customer') return false;
    if (batch.senderUserId === currentUser.id) return false;
    if (batch.isLocalOnly || batch.receiptStatus === 'تم الاستلام' || batch.sendStatus === 'فشل الإرسال') return false;
    if (currentUser.role === 'representative') {
      return batch.recipientUserId === currentUser.id;
    }
    return (
      currentUser.role === 'admin' ||
      currentUser.role === 'manager' ||
      batch.recipientUserId === currentUser.id ||
      hasPermission('canManageReps') ||
      hasPermission('canManageTransfers') ||
      hasPermission('canApprove')
    );
  };

  const incomingBatchesToConfirm = useMemo(
    () => allBatches.filter((b) => canConfirmBatch(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allBatches, currentUser?.id, currentUser?.role]
  );

  const uniqueSenders = useMemo(() => {
    const map = new Map<string, string>();
    allBatches.forEach((b) => {
      if (b.senderUserId) map.set(b.senderUserId, b.senderName || b.representativeName || t('مندوب', 'Rep'));
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allBatches, t]);

  const uniqueRecipients = useMemo(() => {
    const map = new Map<string, string>();
    allBatches.forEach((b) => {
      if (b.recipientUserId) map.set(b.recipientUserId, b.recipientName || t('مستلم', 'Recipient'));
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allBatches, t]);

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

  // Unified Operations Log combining Dispatch Batches, Financial Transfers, and Stock/Custody Transfers
  const unifiedLogRows: UnifiedOpLogRow[] = useMemo(() => {
    const rows: UnifiedOpLogRow[] = [];

    for (const b of allBatches) {
      let unifiedStatus: UnifiedLogStatus = 'في انتظار الاستلام';
      if (b.sendStatus === 'فشل الإرسال' || b.receiptStatus === 'تعذر الاستلام') {
        unifiedStatus = 'فشل المزامنة';
      } else if (b.receiptStatus === 'تم الاستلام') {
        unifiedStatus = 'مكتمل';
      } else if (b.isLocalOnly && b.isConfirmedSendQueued) {
        unifiedStatus = 'في انتظار الإرسال';
      } else if (b.isLocalOnly) {
        unifiedStatus = 'جديد';
      } else if (b.receiptStatus === 'في انتظار الاستلام' || b.receiptStatus === 'جاري الاستلام') {
        unifiedStatus = 'في انتظار الاستلام';
      } else if (b.sendStatus === 'تم الإرسال') {
        unifiedStatus = 'تم الإرسال';
      }

      rows.push({
        id: `batch:${b.id}`,
        sourceKind: 'dispatch',
        opTypeKey: 'dispatch',
        docNumber: b.batchNumber,
        opTypeAr: 'دفعة إرسال واستلام',
        opTypeEn: 'Send & Receive Dispatch',
        senderName: b.senderName || b.representativeName || '—',
        receiverName: b.recipientName || '—',
        createdAt: b.createdAt || b.sentAt || '',
        sentAt: b.sentAt || b.createdAt || '',
        receivedAt: b.receivedAt || '',
        unifiedStatus,
        failureReason: b.errorMessage || b.rejectionReason || '',
        amountText: `${formatLocaleNumber(Number(b.totalCashAmount || 0))} ${data.settings.currency}`,
        notes: b.notes || b.receiptNotes || '',
        rawDispatch: b,
      });
    }

    for (const tr of data.repTransfers || []) {
      let unifiedStatus: UnifiedLogStatus = 'في انتظار الاستلام';
      if (tr.status === 'confirmed') unifiedStatus = 'مكتمل';
      else if (tr.status === 'rejected') unifiedStatus = 'مرفوض';
      else if (tr.syncStatus === 'failed') unifiedStatus = 'فشل المزامنة';
      else if (tr.syncStatus === 'pending' || tr.syncStatus === 'local') unifiedStatus = 'في انتظار الإرسال';
      else unifiedStatus = 'في انتظار الاستلام';

      const opAr =
        tr.direction === 'rep_to_rep'
          ? 'تحويل مالي (مندوب ← مندوب)'
          : tr.direction === 'owner_to_rep'
          ? 'تحويل مالي (صرف عهدة للمندوب)'
          : 'تحويل مالي (توريد للخزينة)';
      const opEn =
        tr.direction === 'rep_to_rep'
          ? 'Financial Transfer (Rep ↔ Rep)'
          : tr.direction === 'owner_to_rep'
          ? 'Financial Transfer (To Rep)'
          : 'Financial Transfer (To Treasury)';

      rows.push({
        id: `cash:${tr.id}`,
        sourceKind: 'cash',
        opTypeKey: 'cash_transfer',
        docNumber: tr.transferNumber,
        opTypeAr: opAr,
        opTypeEn: opEn,
        senderName: tr.senderName || '—',
        receiverName: tr.receiverName || '—',
        createdAt: tr.timestamp || tr.sentAt || tr.date || '',
        sentAt: tr.sentAt || tr.timestamp || tr.date || '',
        receivedAt: tr.confirmedAt || '',
        unifiedStatus,
        failureReason: tr.rejectionReason || '',
        amountText: `${formatLocaleNumber(Number(tr.amount || 0))} ${data.settings.currency}`,
        notes: tr.notes || '',
        rawCash: tr,
      });
    }

    for (const it of data.repItemTransfers || []) {
      let unifiedStatus: UnifiedLogStatus = 'جديد';
      if (it.status === 'received') unifiedStatus = 'مكتمل';
      else if (it.status === 'rejected') unifiedStatus = 'مرفوض';
      else if (it.status === 'executed') unifiedStatus = 'في انتظار الاستلام';
      else if (it.status === 'approved') unifiedStatus = 'تم الإرسال';
      else if (it.status === 'pending') unifiedStatus = 'في انتظار الإرسال';

      const opAr =
        it.transferMode === 'rep_to_rep'
          ? 'تحويل بضاعة (مندوب ← مندوب)'
          : it.transferMode === 'custody_dispatch'
          ? 'صرف عهدة بضاعة للمندوب'
          : 'طلب تحويل أصناف للمخزن/السيارة';
      const opEn =
        it.transferMode === 'rep_to_rep'
          ? 'Stock Transfer (Rep ↔ Rep)'
          : it.transferMode === 'custody_dispatch'
          ? 'Goods Custody Dispatch'
          : 'Stock Transfer Request';

      rows.push({
        id: `item:${it.id}`,
        sourceKind: 'item',
        opTypeKey: 'stock_transfer',
        docNumber: it.requestNumber,
        opTypeAr: opAr,
        opTypeEn: opEn,
        senderName: it.senderRepresentativeName || it.sourceWarehouseName || '—',
        receiverName: it.representativeName || it.targetWarehouseName || '—',
        createdAt: it.createdAt || it.date || '',
        sentAt: it.executedAt || it.approvedAt || it.createdAt || it.date || '',
        receivedAt: it.receivedAt || '',
        unifiedStatus,
        failureReason: it.rejectionReason || '',
        amountText: `${formatLocaleNumber((it.items || []).length)} ${t('صنف', 'item(s)')}`,
        notes: it.notes || '',
        rawItem: it,
      });
    }

    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [allBatches, data.repTransfers, data.repItemTransfers, data.settings.currency, t]);

  const uniqueLogSenders = useMemo(() => {
    const set = new Set<string>();
    unifiedLogRows.forEach((r) => {
      if (r.senderName && r.senderName !== '—') set.add(r.senderName);
    });
    return Array.from(set).sort();
  }, [unifiedLogRows]);

  const uniqueLogReceivers = useMemo(() => {
    const set = new Set<string>();
    unifiedLogRows.forEach((r) => {
      if (r.receiverName && r.receiverName !== '—') set.add(r.receiverName);
    });
    return Array.from(set).sort();
  }, [unifiedLogRows]);

  const filteredUnifiedLogRows = useMemo(() => {
    return unifiedLogRows.filter((r) => {
      if (opTypeFilter !== 'all' && r.opTypeKey !== opTypeFilter) return false;
      if (statusFilter !== 'all' && r.unifiedStatus !== statusFilter) return false;
      if (senderFilter !== 'all' && r.senderName !== senderFilter) return false;
      if (recipientFilter !== 'all' && r.receiverName !== recipientFilter) return false;
      const refDay = String(r.sentAt || r.createdAt || '').slice(0, 10);
      if (dateFilter && refDay !== dateFilter) return false;
      if (dateFromFilter && refDay && refDay < dateFromFilter) return false;
      if (dateToFilter && refDay && refDay > dateToFilter) return false;
      return true;
    });
  }, [unifiedLogRows, opTypeFilter, statusFilter, senderFilter, recipientFilter, dateFilter, dateFromFilter, dateToFilter]);

  const kpiStats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const waiting = allBatches.filter(
      (b) => b.receiptStatus === 'في انتظار الاستلام' || b.receiptStatus === 'جاري الاستلام'
    ).length;
    const confirmedToday = allBatches.filter(
      (b) => b.receiptStatus === 'تم الاستلام' && String(b.receivedAt || '').slice(0, 10) === todayStr
    ).length;
    const confirmedTotal = allBatches.filter((b) => b.receiptStatus === 'تم الاستلام').length;
    const failedBatches = allBatches.filter(
      (b) => b.sendStatus === 'فشل الإرسال' || b.receiptStatus === 'تعذر الاستلام'
    ).length;
    const totalCash = allBatches
      .filter((b) => b.receiptStatus === 'تم الاستلام')
      .reduce((sum, b) => sum + Number(b.totalCashAmount || 0), 0);
    const readyOps = unsentQueueOps.filter((q) => q.status !== 'failed').length;
    const failedOps = unsentQueueOps.filter((q) => q.status === 'failed').length;
    const syncedOps = (data.syncQueue || []).filter((q) => q.status === 'synced').length;
    const syncedBatches = allBatches.filter((b) => !b.isLocalOnly && b.sendStatus === 'تم الإرسال').length;
    const incomingBatchesForUser = isRepUser
      ? allBatches.filter((b) => !b.isLocalOnly && b.recipientUserId === currentUser?.id && b.receiptStatus !== 'تم الاستلام').length
      : waiting;
    const awaitingReceiveTotal = awaitingCustodyDispatches.length + awaitingCashTransfers.length + incomingBatchesForUser;
    const pendingAllTotal =
      unsentQueueOps.length +
      failedDraftBatches.length +
      needsReviewConflicts.length;
    return {
      waiting,
      confirmedToday,
      confirmedTotal,
      failed: failedBatches + failedOps + needsReviewConflicts.length,
      readyToSend: readyOps + failedDraftBatches.filter((b) => b.isLocalOnly && b.isConfirmedSendQueued).length,
      syncedTotal: Math.max(syncedOps, syncedBatches),
      awaitingReceiveTotal,
      pendingAllTotal,
      totalCash,
    };
  }, [
    allBatches,
    unsentQueueOps,
    data.syncQueue,
    failedDraftBatches,
    awaitingCustodyDispatches.length,
    awaitingCashTransfers.length,
    needsReviewConflicts.length,
    isRepUser,
    currentUser?.id,
  ]);

  const handleRequestPreSendConfirmation = () => {
    if (isSending) return;
    setActionMsg(null);
    const chosenOps = unsentQueueOps.filter((q) => selectedOpIds.includes(q.operationId));
    if (chosenOps.length === 0) {
      setActionMsg({ type: 'error', text: t('يرجى تحديد عملية واحدة على الأقل للإرسال.', 'Please select at least one operation to send.') });
      return;
    }
    if (!recipientUserId) {
      setActionMsg({ type: 'error', text: t('يرجى اختيار الموظف المستلم أولاً.', 'Please select the recipient first.') });
      return;
    }
    const rec = (data.dispatchRecipients || []).find((r) => r.id === recipientUserId);
    let salesCount = 0;
    let collectionsCount = 0;
    let returnsCount = 0;
    let purchasesCount = 0;
    let ordersCount = 0;
    let customersCount = 0;
    let custodyOpsCount = 0;
    let totalSalesAmount = 0;
    let totalCashAmount = 0;

    for (const op of chosenOps) {
      const p = op.payload || {};
      if (op.operationType === 'create_sales_invoice') {
        salesCount += 1;
        totalSalesAmount += Number(p.grandTotal ?? p.total ?? 0);
        totalCashAmount += Number(p.paidAmount ?? 0);
      } else if (op.operationType === 'create_purchase_invoice' || op.operationType === 'send_purchase_invoice') {
        purchasesCount += 1;
      } else if (
        op.operationType === 'record_customer_payment' ||
        op.operationType === 'add_invoice_payment' ||
        op.operationType === 'record_order_advance'
      ) {
        collectionsCount += 1;
        totalCashAmount += Number(p.amount ?? 0);
      } else if (op.operationType.includes('return')) {
        returnsCount += 1;
      } else if (op.operationType === 'create_order') {
        ordersCount += 1;
      } else if (op.operationType === 'create_customer' || op.operationType === 'update_customer') {
        customersCount += 1;
      } else if (
        op.operationType.includes('custody') ||
        op.operationType.includes('transfer') ||
        op.operationType === 'record_damaged_stock'
      ) {
        custodyOpsCount += 1;
        if (op.operationType === 'create_rep_transfer') {
          totalCashAmount += Number(p.amount ?? 0);
        }
      }
    }

    setPendingSendConfirm({
      chosenOps,
      recipientId: recipientUserId,
      recipientLabel: rec ? `${rec.fullName} (${t(rec.jobTitle || rec.role)})` : recipientUserId,
      notes: batchNotes.trim(),
      salesCount,
      collectionsCount,
      returnsCount,
      purchasesCount,
      ordersCount,
      customersCount,
      custodyOpsCount,
      totalSalesAmount: Number(totalSalesAmount.toFixed(2)),
      totalCashAmount: Number(totalCashAmount.toFixed(2)),
    });
  };

  const handleConfirmAndSendDispatchBatch = async () => {
    if (isSending || !pendingSendConfirm) return;
    const payload = pendingSendConfirm;
    setPendingSendConfirm(null);
    setActionMsg(null);
    setLastSendOutcomes([]);
    setIsSending(true);
    const res = await data.createAndSendDispatchBatch({
      selectedOperations: payload.chosenOps,
      recipientUserId: payload.recipientId,
      notes: payload.notes,
    });
    const finalElapsed = sendStartRef.current !== null ? Date.now() - sendStartRef.current : 0;
    setSendElapsedMs(finalElapsed);
    setIsSending(false);
    if (res.success && res.batch) {
      setBatchNotes('');
      setLastSendOutcomes(
        payload.chosenOps.map((op) => ({
          id: op.operationId,
          label: op.summaryAr ? t(op.summaryAr) : op.localId || op.operationId,
          ok: true,
          detail: t(`تم الإرسال ضمن الدفعة ${res.batch!.batchNumber}`, `Sent in batch ${res.batch!.batchNumber}`),
        }))
      );
      setActionMsg({
        type: 'success',
        text: t(
          `تم إرسال الدفعة الرسمية (${res.batch.batchNumber}) بنجاح إلى ${res.batch.recipientName} وهي الآن «${res.batch.receiptStatus}».`,
          `Official batch (${res.batch.batchNumber}) sent successfully to ${res.batch.recipientName} (${DISPATCH_STATUS_EN[res.batch.receiptStatus] || res.batch.receiptStatus}).`
        ),
      });
    } else if (res.queuedOfflineConfirmed && res.batch) {
      setBatchNotes('');
      setLastSendOutcomes(
        payload.chosenOps.map((op) => ({
          id: op.operationId,
          label: op.summaryAr ? t(op.summaryAr) : op.localId || op.operationId,
          ok: true,
          detail: t(`مؤكدة للإرسال عند الاتصال (${res.batch!.batchNumber})`, `Confirmed for sync when online (${res.batch!.batchNumber})`),
        }))
      );
      setActionMsg({
        type: 'success',
        text: t(
          `طلب الإرسال مؤكد من المرسل (${res.batch.batchNumber}) — تم حفظه في طابور الإرسال المؤكد وسيتم إرساله تلقائياً فور عودة الاتصال دون إرسال أي مسودات غير مؤكدة.`,
          `Dispatch confirmed by sender (${res.batch.batchNumber}) — queued in confirmed outbox for auto-send once online without sending unconfirmed drafts.`
        ),
      });
    } else {
      setLastSendOutcomes(
        payload.chosenOps.map((op) => ({
          id: op.operationId,
          label: op.summaryAr ? t(op.summaryAr) : op.localId || op.operationId,
          ok: false,
          detail: res.error ? t(res.error) : t('تعذر الإرسال — محفوظة محلياً لإعادة المحاولة', 'Send failed — kept locally for retry'),
        }))
      );
      setActionMsg({
        type: 'error',
        text:
          res.error ||
          t(
            'فشل إرسال الدفعة — بقيت العمليات محفوظة محلياً دون أي حذف، ويمكنك إعادة الإرسال فور عودة الاتصال.',
            'Failed to send batch — operations remain saved locally without data loss and can be retried once connected.'
          ),
      });
    }
  };

  const handleRetryBatch = async (batch: SyncDispatchBatch) => {
    if (isSending) return;
    setActionMsg(null);
    setLastSendOutcomes([]);
    setIsSending(true);
    const res = await data.retryDispatchBatch(batch);
    const finalElapsed = sendStartRef.current !== null ? Date.now() - sendStartRef.current : 0;
    setSendElapsedMs(finalElapsed);
    setIsSending(false);
    if (res.success && res.batch) {
      setActionMsg({
        type: 'success',
        text: t(`تمت إعادة إرسال الدفعة بنجاح برقم (${res.batch.batchNumber}).`, `Batch resent successfully (#${res.batch.batchNumber}).`),
      });
    } else {
      setActionMsg({
        type: 'error',
        text: res.error || t('لا يزال الاتصال متعذراً؛ بقيت الدفعة والعمليات محفوظة محلياً.', 'Still offline; batch and operations remain saved locally.'),
      });
    }
  };

  const handleDirectQueueSend = async () => {
    if (isSending) return;
    setActionMsg(null);
    setLastSendOutcomes([]);
    setIsSending(true);
    const attemptedOps = [...unsentQueueOps];
    const res = await data.syncSendOnly();
    await data.refreshDispatches();
    const finalElapsed = sendStartRef.current !== null ? Date.now() - sendStartRef.current : 0;
    setSendElapsedMs(finalElapsed);
    setIsSending(false);

    if (attemptedOps.length > 0) {
      const latestMap = new Map((data.syncQueue || []).map((q) => [q.operationId, q]));
      setLastSendOutcomes(
        attemptedOps.map((op) => {
          const updated = latestMap.get(op.operationId);
          const isFailed = updated && (updated.status === 'failed' || updated.status === 'needs_review');
          return {
            id: op.operationId,
            label: op.summaryAr ? t(op.summaryAr) : op.localId || op.operationId,
            ok: !isFailed && res.ok,
            detail: isFailed
              ? updated?.lastError
                ? t(updated.lastError)
                : t('فشل الإرسال — محفوظة لإعادة المحاولة', 'Send failed — kept for retry')
              : res.ok
              ? t('تم الإرسال بنجاح', 'Sent successfully')
              : res.error
              ? t(res.error)
              : t('تعذر الإرسال', 'Send failed'),
          };
        })
      );
    }

    if (res.ok && res.failedCount === 0 && res.conflictCount === 0) {
      setActionMsg({
        type: 'success',
        text:
          res.count > 0
            ? t(`تم إرسال (${res.count}) عملية بنجاح.`, `Successfully sent (${res.count}) operation(s).`)
            : t('لا توجد عمليات محلية معلقة للإرسال حالياً — السجل متزامن بالكامل.', 'No pending local operations to send — log is fully synced.'),
      });
    } else {
      setActionMsg({
        type: 'error',
        text:
          res.error ||
          t(
            `اكتمل الإرسال مع وجود (${res.failedCount}) عملية فاشلة و(${res.conflictCount}) تعارض — بقيت العمليات الفاشلة محفوظة لإعادة المحاولة.`,
            `Send finished with (${res.failedCount}) failed operation(s) and (${res.conflictCount}) conflict(s) — failed operations remain saved for retry.`
          ),
      });
    }
  };

  const handleTopSendToServer = async () => {
    if (isSending) return;
    setActionMsg(null);
    setLastSendOutcomes([]);

    // 1) If there are local unsent operations and a recipient is available, use the explicit pre-send confirmation modal
    if (unsentQueueOps.length > 0 && recipientUserId) {
      if (selectedOpIds.length === 0) {
        setSelectedOpIds(unsentQueueOps.map((q) => q.operationId));
      }
      handleRequestPreSendConfirmation();
      return;
    }

    // 2) If there are failed/queued batches ready for retry
    if (unsentQueueOps.length === 0 && failedDraftBatches.length > 0) {
      await handleRetryBatch(failedDraftBatches[0]);
      return;
    }

    // 3) Direct idempotent queue push
    await handleDirectQueueSend();
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
        text: t(
          `تم استلام وتحديث البيانات (${res.count} سجل). مراجعة المستندات لا تؤكد الاستلام تلقائياً — استخدم «تأكيد الاستلام» للاعتماد.`,
          `Received and updated (${res.count}) records. Inspecting documents does not auto-confirm receipt — use «Confirm Receipt» to approve.`
        ),
      });
    } else {
      setActionMsg({
        type: 'error',
        text: res.error || t('تعذر الاتصال لجلب التحديثات.', 'Connection failed while fetching updates.'),
      });
    }
  };

  // Purely read-only inspection — NEVER mutates batch status automatically when opened
  const handleOpenInspectBatch = (batch: SyncDispatchBatch, focusFailBox = false) => {
    setInspectedBatch(batch);
    setInspectedAuditTrail([]);
    setReceiptNotesInput(batch.receiptNotes || '');
    setHasDiscrepancyInput(Boolean(batch.discrepancyDetails?.hasDiscrepancy));
    setDiscrepancyNoteInput(batch.discrepancyDetails?.note || '');
    setFailReasonInput(batch.rejectionReason || '');
    setShowFailReasonBox(focusFailBox);
    if (!batch.isLocalOnly && isOnline) {
      setIsLoadingInspectDetails(true);
      fetchDispatchBatchDetails(batch.id)
        .then((res) => {
          setInspectedBatch((curr) => (curr && curr.id === batch.id && res?.batch ? res.batch : curr));
          if (Array.isArray(res?.auditTrail)) {
            setInspectedAuditTrail(res.auditTrail);
          }
        })
        .catch(() => {})
        .finally(() => setIsLoadingInspectDetails(false));
    } else {
      setIsLoadingInspectDetails(false);
    }
  };

  const handleConfirmInspectedBatch = async (targetBatch?: SyncDispatchBatch) => {
    const target = targetBatch || inspectedBatch;
    if (!target || batchActionLoading) return;
    if (hasDiscrepancyInput && !discrepancyNoteInput.trim()) {
      setActionMsg({ type: 'error', text: t('يرجى كتابة تفاصيل الفرق أو الاعتراض قبل تأكيد الاستلام.', 'Please enter discrepancy or objection details before confirming receipt.') });
      return;
    }
    setBatchActionLoading(true);
    setActionMsg(null);
    const res = await data.confirmDispatchReceipt(target.id, {
      receiptNotes: receiptNotesInput.trim(),
      hasDiscrepancy: hasDiscrepancyInput,
      discrepancyNote: discrepancyNoteInput.trim(),
    });
    setBatchActionLoading(false);
    if (res.success && res.batch) {
      setInspectedBatch(res.batch);
      setActionMsg({
        type: 'success',
        text: t(
          `تم «استلام وتأكيد» الدفعة (${res.batch.batchNumber}) بواسطة ${res.batch.receivedByName || currentUser?.fullName} دون تكرار أي قيد مالي أو مخزني.`,
          `Batch (${res.batch.batchNumber}) received and confirmed by ${res.batch.receivedByName || currentUser?.fullName} without duplicate ledger/stock entries.`
        ),
      });
    } else {
      setActionMsg({ type: 'error', text: res.error || t('تعذر تأكيد استلام الدفعة.', 'Failed to confirm batch receipt.') });
    }
  };

  const handleFailInspectedBatch = async () => {
    if (!inspectedBatch || batchActionLoading) return;
    if (!failReasonInput.trim()) {
      setActionMsg({ type: 'error', text: t('يرجى كتابة سبب تعذر الاستلام قبل الحفظ.', 'Please enter the failure reason before saving.') });
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
        text: t(`تم تسجيل حالة «تعذر الاستلام» للدفعة (${res.batch.batchNumber}).`, `Recorded «Receipt Failed» status for batch (${res.batch.batchNumber}).`),
      });
    } else {
      setActionMsg({ type: 'error', text: res.error || t('تعذر تسجيل سبب عدم الاستلام.', 'Failed to record non-receipt reason.') });
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
          ? t(`تم تسجيل استلام العهدة (${requestNumber}) محلياً بانتظار الإرسال.`, `Custody receipt (${requestNumber}) recorded locally awaiting sync.`)
          : t(`تم تأكيد استلام عهدة التحويل (${requestNumber}) وإضافتها لمخزون المستلم.`, `Transfer custody (${requestNumber}) confirmed and added to receiver inventory.`),
      });
    } else {
      setActionMsg({ type: 'error', text: res.error || t('تعذر تأكيد استلام العهدة', 'Failed to confirm custody receipt') });
    }
  };

  const handleConfirmIncomingCash = async (transferId: string, transferNumber: string) => {
    setConfirmingId(transferId);
    setActionMsg(null);
    const res = await data.confirmRepTransferReceipt(
      transferId,
      t('تم تأكيد الاستلام من مركز الإرسال والاستلام والتحويل', 'Receipt confirmed from Send, Receive & Transfer Center')
    );
    setConfirmingId(null);
    if (res.success) {
      setActionMsg({
        type: 'success',
        text: t(`تم تأكيد استلام التحويل المالي (${transferNumber}) بنجاح.`, `Cash transfer (${transferNumber}) confirmed successfully.`),
      });
    } else {
      setActionMsg({ type: 'error', text: res.error || t('تعذر تأكيد الاستلام النقدي', 'Failed to confirm cash receipt') });
    }
  };

  const handleRejectIncomingCash = async () => {
    if (!rejectCashTarget || rejectCashLoading) return;
    if (!rejectCashReason.trim()) {
      setActionMsg({ type: 'error', text: t('يرجى إدخال سبب رفض التحويل النقدي.', 'Please enter a rejection reason for the cash transfer.') });
      return;
    }
    setRejectCashLoading(true);
    setActionMsg(null);
    const res = await data.rejectRepTransfer(rejectCashTarget.id, rejectCashReason.trim());
    setRejectCashLoading(false);
    if (res.success) {
      const docNo = rejectCashTarget.docNo;
      setRejectCashTarget(null);
      setRejectCashReason('');
      setActionMsg({
        type: 'success',
        text: t(`تم رفض التحويل النقدي (${docNo}) وإعادة حالة العملية.`, `Cash transfer (${docNo}) rejected cleanly.`),
      });
    } else {
      setActionMsg({ type: 'error', text: res.error || t('تعذر رفض التحويل النقدي', 'Failed to reject cash transfer') });
    }
  };

  const handleResolveConflict = async (
    conflict: SyncConflictRecord,
    action: 'keep_server' | 'apply_local' | 'dismiss'
  ) => {
    if (resolvingConflictId) return;
    setResolvingConflictId(conflict.id);
    setActionMsg(null);
    const res = await data.resolveSyncConflict(conflict.id, action);
    setResolvingConflictId(null);
    if (res.success) {
      setActionMsg({
        type: 'success',
        text: t('تمت معالجة التعارض وتحديث حالة المزامنة.', 'Conflict resolved and sync state updated.'),
      });
    } else {
      setActionMsg({
        type: 'error',
        text: res.error || t('تعذر حل التعارض.', 'Failed to resolve conflict.'),
      });
    }
  };

  // Column definitions: Unsent Local Queue Table
  const queueColumns: UnifiedColumn<SyncQueueItem>[] = useMemo(
    () => [
      {
        key: 'summaryAr',
        header: t('بيان العملية المحلية', 'Local Operation'),
        align: 'right',
        sortValue: (r) => r.summaryAr,
        exportValue: (r) => t(r.summaryAr),
        render: (r) => (
          <div>
            <div className="font-bold text-slate-900 dark:text-[#EEF4FC]">{t(r.summaryAr)}</div>
            {r.lastError && <div className="text-[10px] text-red-700 dark:text-red-400 font-bold mt-0.5">{t(r.lastError)}</div>}
          </div>
        ),
      },
      {
        key: 'localId',
        header: t('المرجع المحلي', 'Local Ref'),
        align: 'center',
        sortValue: (r) => r.localId || r.operationId,
        exportValue: (r) => r.localId || r.operationId,
        render: (r) => (
          <span className="font-mono text-[11px] font-bold text-blue-950 dark:text-[#85B8FF] tabular-nums">
            {r.localId || r.operationId}
          </span>
        ),
      },
      {
        key: 'amount',
        header: t('القيمة', 'Amount'),
        align: 'center',
        sortValue: (r) => Number(r.payload?.total ?? r.payload?.amount ?? r.payload?.paidAmount ?? 0),
        exportValue: (r) => Number(r.payload?.total ?? r.payload?.amount ?? r.payload?.paidAmount ?? 0),
        render: (r) => {
          const val = Number(r.payload?.total ?? r.payload?.amount ?? r.payload?.paidAmount ?? 0);
          return (
            <span className="font-mono font-bold text-slate-900 dark:text-[#EEF4FC] tabular-nums">
              {val > 0 ? `${formatLocaleNumber(val)} ${data.settings.currency}` : '—'}
            </span>
          );
        },
      },
      {
        key: 'statusLabel',
        header: t('حالة الحفظ / الإرسال', 'Save / Send Status'),
        align: 'center',
        sortValue: (r) => r.status,
        exportValue: (r) => {
          const rawLabel: SyncDispatchBatchStatus =
            r.status === 'failed'
              ? 'فشل الإرسال'
              : r.status === 'syncing'
              ? 'جاري الإرسال'
              : !isOnline || r.status === 'local'
              ? 'محفوظة محليًا'
              : 'جاهزة للإرسال';
          return t(rawLabel, DISPATCH_STATUS_EN[rawLabel] || rawLabel);
        },
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
              {t(label, DISPATCH_STATUS_EN[label] || label)}
            </span>
          );
        },
      },
      {
        key: 'createdAt',
        header: t('وقت التسجيل', 'Recorded At'),
        align: 'center',
        sortValue: (r) => r.createdAt,
        exportValue: (r) => formatDateTimeLocale(r.createdAt),
        render: (r) => <span className="font-mono text-[11px] text-slate-600 dark:text-[#97AECE] tabular-nums">{formatDateTimeLocale(r.createdAt)}</span>,
      },
    ],
    [data.settings.currency, isOnline, t]
  );

  // Column definitions: Official 12-Column Dispatch Batches Table
  const dispatchColumns: UnifiedColumn<SyncDispatchBatch>[] = useMemo(
    () => [
      {
        key: 'batchNumber',
        header: t('رقم العملية', 'Batch #'),
        align: 'center',
        sortValue: (b) => b.batchNumber,
        exportValue: (b) => b.batchNumber,
        render: (b) => (
          <span className="font-mono font-black text-blue-950 dark:text-[#85B8FF] tabular-nums">{b.batchNumber}</span>
        ),
      },
      {
        key: 'senderName',
        header: t('المرسل', 'Sender'),
        align: 'right',
        sortValue: (b) => b.senderName || b.representativeName || '',
        exportValue: (b) => b.senderName || b.representativeName || '',
        render: (b) => (
          <div>
            <div className="font-bold text-slate-900 dark:text-[#EEF4FC]">{b.senderName || '—'}</div>
            {b.representativeName && b.representativeName !== b.senderName && (
              <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{b.representativeName}</div>
            )}
          </div>
        ),
      },
      {
        key: 'recipientName',
        header: t('المستلم', 'Recipient'),
        align: 'right',
        sortValue: (b) => b.recipientName || '',
        exportValue: (b) => b.recipientName || '',
        render: (b) => <span className="font-bold text-slate-800 dark:text-[#DCE6F5]">{b.recipientName || '—'}</span>,
      },
      {
        key: 'sentAt',
        header: t('تاريخ الإرسال', 'Sent At'),
        align: 'center',
        sortValue: (b) => b.sentAt || b.createdAt || '',
        exportValue: (b) => formatDateTimeLocale(b.sentAt || b.createdAt),
        render: (b) => (
          <span className="font-mono text-[11px] text-slate-700 dark:text-[#A9BCD8] tabular-nums">
            {formatDateTimeLocale(b.sentAt || b.createdAt)}
          </span>
        ),
      },
      {
        key: 'salesCount',
        header: t('عدد فواتير البيع', 'Sales Invoices'),
        align: 'center',
        sortValue: (b) => Number(b.salesCount || 0),
        exportValue: (b) => Number(b.salesCount || 0),
        render: (b) => <span className="font-mono font-bold text-slate-900 dark:text-[#EEF4FC] tabular-nums">{formatLocaleNumber(b.salesCount || 0)}</span>,
      },
      {
        key: 'collectionsCount',
        header: t('عدد التحصيلات', 'Collections'),
        align: 'center',
        sortValue: (b) => Number(b.collectionsCount || 0),
        exportValue: (b) => Number(b.collectionsCount || 0),
        render: (b) => <span className="font-mono font-bold text-slate-900 dark:text-[#EEF4FC] tabular-nums">{formatLocaleNumber(b.collectionsCount || 0)}</span>,
      },
      {
        key: 'returnsCount',
        header: t('عدد المرتجعات', 'Returns'),
        align: 'center',
        sortValue: (b) => Number(b.returnsCount || 0),
        exportValue: (b) => Number(b.returnsCount || 0),
        render: (b) => <span className="font-mono font-bold text-slate-900 dark:text-[#EEF4FC] tabular-nums">{formatLocaleNumber(b.returnsCount || 0)}</span>,
      },
      {
        key: 'totalCashAmount',
        header: t('إجمالي التحصيلات', 'Total Cash'),
        align: 'center',
        sortValue: (b) => Number(b.totalCashAmount || 0),
        exportValue: (b) => Number(b.totalCashAmount || 0),
        render: (b) => (
          <span className="font-mono font-black text-blue-950 dark:text-[#85B8FF] tabular-nums">
            {formatLocaleNumber(Number(b.totalCashAmount || 0))} {data.settings.currency}
          </span>
        ),
      },
      {
        key: 'sendStatus',
        header: t('حالة الإرسال', 'Send Status'),
        align: 'center',
        sortValue: (b) => b.sendStatus,
        exportValue: (b) =>
          b.isConfirmedSendQueued && b.isLocalOnly
            ? t('طلب الإرسال مؤكد من المرسل — في انتظار المزامنة', 'Send confirmed by sender — awaiting sync')
            : t(b.sendStatus, DISPATCH_STATUS_EN[b.sendStatus] || b.sendStatus),
        render: (b) => (
          <div className="flex flex-col items-center gap-0.5">
            <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${getDispatchStatusClasses(b.sendStatus)}`}>
              {t(b.sendStatus, DISPATCH_STATUS_EN[b.sendStatus] || b.sendStatus)}
            </span>
            {b.isConfirmedSendQueued && b.isLocalOnly && (
              <span className="text-[10px] font-bold text-[#003589] dark:text-[#85B8FF]">
                {t('طلب الإرسال مؤكد · انتظار المزامنة', 'Send confirmed · awaiting sync')}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'receiptStatus',
        header: t('حالة الاستلام', 'Receipt Status'),
        align: 'center',
        sortValue: (b) => b.receiptStatus,
        exportValue: (b) => t(b.receiptStatus, DISPATCH_STATUS_EN[b.receiptStatus] || b.receiptStatus),
        render: (b) => (
          <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${getDispatchStatusClasses(b.receiptStatus)}`}>
            {t(b.receiptStatus, DISPATCH_STATUS_EN[b.receiptStatus] || b.receiptStatus)}
          </span>
        ),
      },
      {
        key: 'receivedAt',
        header: t('تاريخ الاستلام', 'Received At'),
        align: 'center',
        sortValue: (b) => b.receivedAt || '',
        exportValue: (b) => formatDateTimeLocale(b.receivedAt),
        render: (b) => (
          <span className="font-mono text-[11px] text-slate-700 dark:text-[#A9BCD8] tabular-nums">
            {b.receivedAt ? formatDateTimeLocale(b.receivedAt) : '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: t('الإجراءات', 'Actions'),
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
              className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3158] dark:text-[#EEF4FC] text-slate-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{t('مراجعة', 'Inspect')}</span>
            </button>
            {(b.sendStatus === 'فشل الإرسال' || (b.isLocalOnly && b.isConfirmedSendQueued)) && b.senderUserId === currentUser?.id && (
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
                <span>{b.isConfirmedSendQueued ? t('مزامنة الإرسال', 'Sync Dispatch') : t('إعادة إرسال', 'Retry Send')}</span>
              </button>
            )}
            {canConfirmBatch(b) && (
              <button
                type="button"
                disabled={batchActionLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenInspectBatch(b);
                }}
                className="px-2 py-0.5 rounded-md bg-blue-950 hover:bg-blue-900 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{t('مراجعة واستلام', 'Inspect & Receive')}</span>
              </button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.settings.currency, currentUser?.id, isSending, batchActionLoading, t]
  );

  // Unified Operations Log Columns
  const unifiedLogColumns: UnifiedColumn<UnifiedOpLogRow>[] = useMemo(
    () => [
      {
        key: 'docNumber',
        header: t('رقم العملية', 'Op #'),
        align: 'center',
        sortValue: (r) => r.docNumber,
        exportValue: (r) => r.docNumber,
        render: (r) => <span className="font-mono font-black text-blue-950 dark:text-[#85B8FF] tabular-nums">{r.docNumber}</span>,
      },
      {
        key: 'opTypeAr',
        header: t('نوع العملية', 'Operation Type'),
        align: 'right',
        sortValue: (r) => t(r.opTypeAr, r.opTypeEn),
        exportValue: (r) => t(r.opTypeAr, r.opTypeEn),
        render: (r) => (
          <div>
            <div className="font-bold text-slate-900 dark:text-[#EEF4FC]">{t(r.opTypeAr, r.opTypeEn)}</div>
            <div className="text-[10px] font-mono text-slate-500 dark:text-[#8DA2C5]">{r.amountText}</div>
          </div>
        ),
      },
      {
        key: 'senderName',
        header: t('المرسل', 'Sender'),
        align: 'right',
        sortValue: (r) => r.senderName,
        exportValue: (r) => r.senderName,
        render: (r) => <span className="font-bold text-slate-800 dark:text-[#DCE6F5]">{r.senderName}</span>,
      },
      {
        key: 'receiverName',
        header: t('المستلم', 'Receiver'),
        align: 'right',
        sortValue: (r) => r.receiverName,
        exportValue: (r) => r.receiverName,
        render: (r) => <span className="font-bold text-slate-800 dark:text-[#DCE6F5]">{r.receiverName}</span>,
      },
      {
        key: 'createdAt',
        header: t('تاريخ الإنشاء', 'Created At'),
        align: 'center',
        sortValue: (r) => r.createdAt,
        exportValue: (r) => formatDateTimeLocale(r.createdAt),
        render: (r) => <span className="font-mono text-[11px] text-slate-600 dark:text-[#97AECE] tabular-nums">{formatDateTimeLocale(r.createdAt)}</span>,
      },
      {
        key: 'sentAt',
        header: t('تاريخ الإرسال', 'Sent At'),
        align: 'center',
        sortValue: (r) => r.sentAt,
        exportValue: (r) => formatDateTimeLocale(r.sentAt),
        render: (r) => <span className="font-mono text-[11px] text-slate-700 dark:text-[#A9BCD8] tabular-nums">{formatDateTimeLocale(r.sentAt)}</span>,
      },
      {
        key: 'receivedAt',
        header: t('تاريخ الاستلام', 'Received At'),
        align: 'center',
        sortValue: (r) => r.receivedAt,
        exportValue: (r) => formatDateTimeLocale(r.receivedAt),
        render: (r) => (
          <span className="font-mono text-[11px] text-slate-700 dark:text-[#A9BCD8] tabular-nums">
            {r.receivedAt ? formatDateTimeLocale(r.receivedAt) : '—'}
          </span>
        ),
      },
      {
        key: 'unifiedStatus',
        header: t('حالة العملية', 'Status'),
        align: 'center',
        sortValue: (r) => r.unifiedStatus,
        exportValue: (r) => t(r.unifiedStatus, DISPATCH_STATUS_EN[r.unifiedStatus] || r.unifiedStatus),
        render: (r) => (
          <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${getDispatchStatusClasses(r.unifiedStatus)}`}>
            {t(r.unifiedStatus, DISPATCH_STATUS_EN[r.unifiedStatus] || r.unifiedStatus)}
          </span>
        ),
      },
      {
        key: 'failureReason',
        header: t('سبب الفشل إن وجد', 'Failure Reason'),
        align: 'right',
        sortValue: (r) => r.failureReason,
        exportValue: (r) => (r.failureReason ? t(r.failureReason) : ''),
        render: (r) =>
          r.failureReason ? (
            <span className="text-[11px] font-bold text-red-700 dark:text-red-400">{t(r.failureReason)}</span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
      },
      {
        key: 'actions',
        header: t('الإجراءات', 'Actions'),
        align: 'center',
        sortable: false,
        render: (r) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (r.rawDispatch) {
                handleOpenInspectBatch(r.rawDispatch);
              } else {
                setInspectedTransferRow(r);
              }
            }}
            className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3158] dark:text-[#EEF4FC] text-slate-800 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{t('تفاصيل', 'Details')}</span>
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  // Batch inspection document columns
  const batchDocColumns: UnifiedColumn<SyncDispatchBatchDocSummaryItem>[] = useMemo(
    () => [
      {
        key: 'docNumber',
        header: t('رقم المستند', 'Doc #'),
        align: 'center',
        sortValue: (d) => d.docNumber || d.entityId || d.operationId,
        exportValue: (d) => d.docNumber || d.entityId || d.operationId,
        render: (d) => <span className="font-mono font-bold text-blue-950 dark:text-[#85B8FF] tabular-nums">{d.docNumber || d.entityId || '—'}</span>,
      },
      {
        key: 'summaryAr',
        header: t('العملية', 'Operation'),
        align: 'right',
        sortValue: (d) => d.summaryAr,
        exportValue: (d) => t(d.summaryAr),
        render: (d) => <span className="font-bold text-slate-900 dark:text-[#EEF4FC]">{t(d.summaryAr)}</span>,
      },
      {
        key: 'customerName',
        header: t('العميل / الجهة', 'Customer / Party'),
        align: 'right',
        sortValue: (d) => d.customerName || '',
        exportValue: (d) => d.customerName || '',
        render: (d) => <span className="text-slate-700 dark:text-[#CBD5E1]">{d.customerName || '—'}</span>,
      },
      {
        key: 'amount',
        header: t('القيمة', 'Amount'),
        align: 'center',
        sortValue: (d) => Number(d.amount || 0),
        exportValue: (d) => Number(d.amount || 0),
        render: (d) => (
          <span className="font-mono font-bold text-slate-900 dark:text-[#EEF4FC] tabular-nums">
            {formatLocaleNumber(Number(d.amount || 0))} {data.settings.currency}
          </span>
        ),
      },
      {
        key: 'paidAmount',
        header: t('التحصيل النقدي', 'Cash Collected'),
        align: 'center',
        sortValue: (d) => Number(d.paidAmount || 0),
        exportValue: (d) => Number(d.paidAmount || 0),
        render: (d) => (
          <span className="font-mono font-bold text-emerald-800 dark:text-emerald-400 tabular-nums">
            {formatLocaleNumber(Number(d.paidAmount || 0))} {data.settings.currency}
          </span>
        ),
      },
      {
        key: 'createdAt',
        header: t('وقت الإنشاء', 'Created At'),
        align: 'center',
        sortValue: (d) => d.createdAt || '',
        exportValue: (d) => formatDateTimeLocale(d.createdAt),
        render: (d) => <span className="font-mono text-[11px] text-slate-600 dark:text-[#97AECE] tabular-nums">{formatDateTimeLocale(d.createdAt)}</span>,
      },
    ],
    [data.settings.currency, t]
  );

  // Incoming Custody & Cash Tables
  const incomingCustodyRows = useMemo(
    () => [
      ...awaitingCustodyDispatches.map((tr) => ({
        id: `item:${tr.id}`,
        rawId: tr.id,
        kind: 'item' as const,
        docNo: tr.requestNumber,
        senderName: tr.senderRepresentativeName || tr.sourceWarehouseName || t('الإدارة', 'Management'),
        typeLabel:
          tr.transferMode === 'rep_to_rep'
            ? t('تحويل بضاعة وارد من مندوب آخر', 'Incoming Rep-to-Rep Goods Transfer')
            : tr.transferMode === 'custody_dispatch'
            ? t('صرف عهدة بضاعة للمندوب', 'Goods Custody Dispatch to Rep')
            : t('تحويل أصناف للسيارة', 'Vehicle Stock Transfer'),
        detail: (tr.items || []).map((it) => `${it.productName} (${it.approvedQty ?? it.requestedQty} ${t(it.unit)})`).join(' · '),
        date: tr.date,
      })),
      ...awaitingCashTransfers.map((ct) => ({
        id: `cash:${ct.id}`,
        rawId: ct.id,
        kind: 'cash' as const,
        docNo: ct.transferNumber,
        senderName: ct.senderName || t('الإدارة', 'Management'),
        typeLabel:
          ct.direction === 'rep_to_rep'
            ? t('تحويل مالي وارد (مندوب ← مندوب)', 'Incoming Financial Transfer (Rep → Rep)')
            : ct.direction === 'rep_to_owner'
            ? t('توريد نقدي وارد من المندوب للخزينة', 'Incoming Rep Cash Remittance to Treasury')
            : t('عهدة نقدية واردة من الإدارة', 'Incoming Cash Custody from Management'),
        detail: `${formatLocaleNumber(ct.amount)} ${data.settings.currency}${ct.notes ? ` · ${ct.notes}` : ''}`,
        date: ct.date,
      })),
    ],
    [awaitingCustodyDispatches, awaitingCashTransfers, data.settings.currency, t]
  );

  const incomingCustodyColumns: UnifiedColumn<(typeof incomingCustodyRows)[number]>[] = useMemo(
    () => [
      {
        key: 'docNo',
        header: t('رقم المستند', 'Doc #'),
        align: 'center',
        sortValue: (r) => r.docNo,
        exportValue: (r) => r.docNo,
        render: (r) => <span className="font-mono font-black text-blue-950 dark:text-[#85B8FF] tabular-nums">{r.docNo}</span>,
      },
      {
        key: 'typeLabel',
        header: t('النوع والمرسل', 'Type & Sender'),
        align: 'right',
        sortValue: (r) => r.typeLabel,
        exportValue: (r) => `${r.typeLabel} (${r.senderName})`,
        render: (r) => (
          <div>
            <div className="font-bold text-slate-900 dark:text-[#EEF4FC]">{r.typeLabel}</div>
            <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">
              {t('المرسل:', 'From:')} {r.senderName}
            </div>
          </div>
        ),
      },
      {
        key: 'detail',
        header: t('التفاصيل / الأصناف', 'Details / Items'),
        align: 'right',
        sortValue: (r) => r.detail,
        exportValue: (r) => r.detail,
        render: (r) => <span className="text-xs text-slate-700 dark:text-[#CBD5E1]">{r.detail}</span>,
      },
      {
        key: 'date',
        header: t('التاريخ', 'Date'),
        align: 'center',
        sortValue: (r) => r.date,
        exportValue: (r) => r.date,
        render: (r) => <span className="font-mono text-[11px] text-slate-600 dark:text-[#97AECE] tabular-nums">{r.date}</span>,
      },
      {
        key: 'actions',
        header: t('الإجراء', 'Action'),
        align: 'center',
        sortable: false,
        render: (r) => (
          <div className="flex items-center justify-center gap-1">
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
              {confirmingId === r.rawId ? t('جاري التأكيد...', 'Confirming...') : t('تأكيد الاستلام', 'Confirm Receipt')}
            </button>
            {r.kind === 'cash' && (
              <button
                type="button"
                disabled={confirmingId === r.rawId}
                onClick={() => {
                  setRejectCashTarget({ id: r.rawId, docNo: r.docNo });
                  setRejectCashReason('');
                }}
                className="px-2 py-1 rounded-md bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 text-[11px] font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                {t('رفض', 'Reject')}
              </button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirmingId, t]
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

  const tabDefinitions: Array<{
    key: UnifiedTransferSyncTab;
    label: string;
    icon: React.ElementType;
    badge?: number;
  }> = [
    {
      key: 'send',
      label: t('إرسال', 'Send'),
      icon: ArrowUpFromLine,
      badge: kpiStats.readyToSend,
    },
    {
      key: 'receive',
      label: t('استلام', 'Receive'),
      icon: ArrowDownToLine,
      badge: kpiStats.awaitingReceiveTotal,
    },
    {
      key: 'financial-transfers',
      label: t('تحويلات مالية', 'Financial Transfers'),
      icon: Wallet,
    },
    {
      key: 'stock-custody',
      label: t('تحويلات بضائع وعهد', 'Stock & Custody'),
      icon: PackageCheck,
    },
    {
      key: 'pending',
      label: t('العمليات المعلقة', 'Pending Ops'),
      icon: ListChecks,
      badge: kpiStats.pendingAllTotal,
    },
    {
      key: 'log',
      label: t('سجل العمليات', 'Operations Log'),
      icon: History,
    },
  ];

  return (
    <div dir={dir} className="space-y-2">
      {/* Top Header Strip */}
      <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-blue-950 text-white flex items-center justify-center shrink-0">
            <RefreshCw className={`w-4 h-4 ${isSending || isReceiving ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-black text-slate-900 dark:text-[#EEF4FC]">
              {t('الإرسال والاستلام والتحويل · المركز الموحد', 'Send, Receive & Transfers · Unified Center')}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-[#8DA2C5]">
              <span className={`inline-flex items-center gap-1 font-bold ${isOnline ? 'text-emerald-800 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {isOnline ? t('متصل وجاهز للإرسال والاستلام', 'Connected & Ready to Send/Receive') : t('وضع العمل بدون إنترنت', 'Offline Working Mode')}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('آخر مزامنة:', 'Last sync:')}{' '}
                <strong className="font-mono tabular-nums text-slate-900 dark:text-[#EEF4FC]">{formatDateTimeLocale(data.lastServerSyncAt)}</strong>
              </span>
              {(isSending || sendElapsedMs > 0) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-[#003589] dark:text-[#85B8FF] font-bold">
                    {t('زمن الإرسال:', 'Send time:')} {formatElapsedTenths(sendElapsedMs)}
                  </span>
                </>
              )}
              {(isReceiving || receiveElapsedMs > 0) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-emerald-800 dark:text-emerald-400 font-bold">
                    {t('زمن الاستلام:', 'Receive time:')} {formatElapsedTenths(receiveElapsedMs)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto">
          <button
            type="button"
            data-testid="refresh-send-btn"
            disabled={isSending || data.isMandatorySending}
            onClick={handleTopSendToServer}
            className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-0 sm:h-8 px-3 rounded-md bg-[#003589] hover:bg-[#011E58] dark:bg-[#1659C8] dark:hover:bg-[#1D63D8] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap shadow-xs"
          >
            <ArrowUpFromLine className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span>
              {isSending || data.isMandatorySending
                ? t('جاري الإرسال...', 'Sending...')
                : kpiStats.readyToSend > 0
                ? `${t('إرسال', 'Send')} (${formatLocaleNumber(kpiStats.readyToSend)})`
                : t('إرسال', 'Send')}
            </span>
          </button>
          <button
            type="button"
            data-testid="refresh-receive-btn"
            disabled={isReceiving}
            onClick={handleReceiveSyncNow}
            className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-0 sm:h-8 px-3 rounded-md bg-[#011E58] hover:bg-[#001A49] dark:bg-[#132952] dark:hover:bg-[#1B3A70] dark:border dark:border-[#2E4F86] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap shadow-xs"
          >
            <ArrowDownToLine className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span>
              {isReceiving
                ? t('جاري الاستلام...', 'Receiving...')
                : kpiStats.awaitingReceiveTotal > 0
                ? `${t('استلام', 'Receive')} (${formatLocaleNumber(kpiStats.awaitingReceiveTotal)})`
                : t('استلام', 'Receive')}
            </span>
          </button>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="min-h-[42px] sm:min-h-0 sm:h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3158] text-slate-800 dark:text-[#EEF4FC] text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              {t('رجوع', 'Back')}
            </button>
          )}
        </div>
      </div>

      {/* Dedicated Mobile & Tablet Send / Receive Operational Panel */}
      <div
        data-testid="mobile-send-receive-panel"
        className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden"
      >
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 flex flex-col justify-between gap-1" data-testid="sync-last-send">
          <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-slate-500 dark:text-[#8DA2C5]">
            <span>{t('آخر إرسال', 'Last Send')}</span>
            <ArrowUpFromLine className="w-3.5 h-3.5 text-[#003589] dark:text-[#85B8FF] shrink-0" />
          </div>
          <div className="text-xs font-black text-slate-900 dark:text-[#EEF4FC] font-mono tabular-nums leading-snug">
            {data.lastSendSummary?.at ? formatDateTimeLocale(data.lastSendSummary.at) : t('لم يتم الإرسال بعد', 'Not sent yet')}
          </div>
          <div className="text-[10px] font-bold">
            {data.lastSendSummary?.ok === false && data.lastSendSummary?.error ? (
              <span className="text-red-700 dark:text-red-400">
                {t('آخر محاولة تعذرت · العمليات محفوظة محلياً', 'Last attempt failed · operations saved locally')}
              </span>
            ) : data.lastSendSummary?.at ? (
              <span className="text-emerald-800 dark:text-emerald-400">
                {t(`تم إرسال (${data.lastSendSummary.count || 0}) عملية بنجاح`, `Sent (${data.lastSendSummary.count || 0}) operation(s) successfully`)}
              </span>
            ) : (
              <span className="text-slate-500 dark:text-[#8DA2C5]">{t('في انتظار أول عملية إرسال', 'Awaiting first send')}</span>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 flex flex-col justify-between gap-1" data-testid="sync-pending-ops-count">
          <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-slate-500 dark:text-[#8DA2C5]">
            <span>{t('عدد العمليات المعلقة', 'Pending Operations')}</span>
            <Clock className={`w-3.5 h-3.5 shrink-0 ${unsentQueueOps.length > 0 ? 'text-amber-600' : 'text-emerald-700'}`} />
          </div>
          <div
            className={`text-base font-black font-mono tabular-nums leading-tight ${
              unsentQueueOps.length > 0
                ? 'text-amber-800 dark:text-amber-300'
                : 'text-emerald-800 dark:text-emerald-400'
            }`}
          >
            {formatLocaleNumber(unsentQueueOps.length)}
          </div>
          <div className="text-[10px] font-bold text-slate-600 dark:text-[#97AECE]">
            {unsentQueueOps.length > 0
              ? t('فواتير / تحصيلات / تحويلات بانتظار الإرسال', 'Invoices / collections / transfers awaiting send')
              : t('كافة العمليات متزامنة', 'All operations synced')}
          </div>
        </div>

        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 flex flex-col justify-between gap-1" data-testid="sync-last-receive">
          <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-slate-500 dark:text-[#8DA2C5]">
            <span>{t('آخر استلام', 'Last Receive')}</span>
            <ArrowDownToLine className="w-3.5 h-3.5 text-[#011E58] dark:text-[#85B8FF] shrink-0" />
          </div>
          <div className="text-xs font-black text-slate-900 dark:text-[#EEF4FC] font-mono tabular-nums leading-snug">
            {data.lastReceiveSummary?.at ? formatDateTimeLocale(data.lastReceiveSummary.at) : t('لم يتم الاستلام بعد', 'Not received yet')}
          </div>
          <div className="text-[10px] font-bold">
            {data.lastReceiveSummary?.ok === false && data.lastReceiveSummary?.error ? (
              <span className="text-red-700 dark:text-red-400">{t('تعذر التحديث الأخير — أعد المحاولة', 'Last update failed — retry')}</span>
            ) : data.lastReceiveSummary?.at ? (
              <span className="text-[#003589] dark:text-[#85B8FF]">
                {t(`تم تحديث (${data.lastReceiveSummary.count || 0}) سجل`, `Updated (${data.lastReceiveSummary.count || 0}) record(s)`)}
              </span>
            ) : (
              <span className="text-slate-500 dark:text-[#8DA2C5]">{t('اضغط استلام لجلب التحديثات', 'Press Receive to fetch updates')}</span>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 flex flex-col justify-between gap-1" data-testid="sync-mandatory-countdown">
          <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-slate-500 dark:text-[#8DA2C5]">
            <span>{t('الإرسال الإجباري بعد', 'Mandatory Send In')}</span>
            <span className="text-[10px] font-mono text-slate-500 dark:text-[#8DA2C5]">
              {t(`كل ${data.mandatorySendIntervalMinutes} د`, `Every ${data.mandatorySendIntervalMinutes}m`)}
            </span>
          </div>
          <div className="text-base font-black text-[#011E58] dark:text-[#85B8FF] font-mono tabular-nums leading-tight" dir="ltr">
            {data.isMandatorySending
              ? t('جاري...', 'Sending...')
              : data.mandatorySendEnabled
              ? formatCountdownMmSs(data.mandatorySendRemainingSeconds)
              : t('متوقف', 'Paused')}
          </div>
          <div className="text-[10px] font-bold">
            {data.isMandatorySendPendingRetry ? (
              <span className="text-amber-700 dark:text-amber-300">
                {t('في انتظار عودة الاتصال للإرسال', 'Awaiting connection to send')}
              </span>
            ) : !data.mandatorySendEnabled ? (
              <span className="text-slate-500 dark:text-[#8DA2C5]">{t('معطل من إعدادات الإدارة', 'Disabled by management settings')}</span>
            ) : data.isMandatorySending ? (
              <span className="text-[#003589] dark:text-[#85B8FF]">{t('جاري تنفيذ الإرسال التلقائي...', 'Running automatic send...')}</span>
            ) : (
              <span className="text-slate-600 dark:text-[#97AECE]">{t('يعمل تلقائياً بدون تداخل', 'Runs automatically without overlap')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Live Progress Bar Indicator for Send or Receive */}
      {(isSending || data.isMandatorySending || data.sendProgressPercent > 0 || isReceiving || data.receiveProgressPercent > 0) && (
        <div
          data-testid="sync-progress-bar"
          className="bg-white dark:bg-[#0E1C36] rounded-lg border border-[#DCE6F5] dark:border-[#2C4775] px-3 py-2 space-y-1.5"
        >
          {(isSending || data.isMandatorySending || data.sendProgressPercent > 0) && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                <span className="text-[#003589] dark:text-[#85B8FF]">
                  {data.sendProgressStage || t('جاري إرسال العمليات...', 'Sending operations...')}
                </span>
                <span className="font-mono font-black text-[#011E58] dark:text-[#EEF4FC] tabular-nums">
                  {Math.max(5, data.sendProgressPercent || (isSending ? 35 : 0))}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-[#132544] overflow-hidden">
                <div
                  className="h-full bg-[#003589] dark:bg-[#1659C8] transition-all duration-200"
                  style={{ width: `${Math.max(5, Math.min(100, data.sendProgressPercent || (isSending ? 35 : 0)))}%` }}
                />
              </div>
            </div>
          )}
          {(isReceiving || data.receiveProgressPercent > 0) && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                <span className="text-[#011E58] dark:text-[#85B8FF]">
                  {data.receiveProgressStage || t('جاري استلام التحديثات...', 'Receiving updates...')}
                </span>
                <span className="font-mono font-black text-[#011E58] dark:text-[#EEF4FC] tabular-nums">
                  {Math.max(5, data.receiveProgressPercent || (isReceiving ? 35 : 0))}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-[#132544] overflow-hidden">
                <div
                  className="h-full bg-[#011E58] dark:bg-[#2F6FE4] transition-all duration-200"
                  style={{ width: `${Math.max(5, Math.min(100, data.receiveProgressPercent || (isReceiving ? 35 : 0)))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {actionMsg && (
        <div
          className={`p-2 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
            actionMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{actionMsg.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMsg(null)}
            className="text-[11px] underline shrink-0 cursor-pointer"
          >
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {lastSendOutcomes.length > 0 && (
        <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-2 space-y-1 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-black text-[#011E58] dark:text-[#EEF4FC]">
              {t(`نتائج الإرسال التفصيلية (${lastSendOutcomes.length} عملية)`, `Detailed Send Results (${lastSendOutcomes.length} operations)`)}
            </span>
            <button
              type="button"
              onClick={() => setLastSendOutcomes([])}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:text-[#97AECE] cursor-pointer"
            >
              {t('إخفاء', 'Hide')}
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-[#21375C] max-h-36 overflow-y-auto">
            {lastSendOutcomes.map((item) => (
              <div key={item.id} className="py-1 flex items-center justify-between gap-2 text-[11px]">
                <span className="font-bold text-slate-800 dark:text-[#EEF4FC]">{item.label}</span>
                <span
                  className={`font-bold whitespace-nowrap ${
                    item.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {item.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compact 5-Counter Send & Receive Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-md overflow-hidden">
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5" data-testid="counter-ready-send">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#8DA2C5]">{t('جاهزة للإرسال', 'Ready to Send')}</div>
          <div className="text-sm font-black text-[#003589] dark:text-[#85B8FF] font-mono tabular-nums mt-0.5">
            {formatLocaleNumber(kpiStats.readyToSend)}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5" data-testid="counter-failed">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#8DA2C5]">{t('فاشلة / تعارضات', 'Failed / Conflicts')}</div>
          <div className="text-sm font-black text-red-700 dark:text-red-400 font-mono tabular-nums mt-0.5">
            {formatLocaleNumber(kpiStats.failed)}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5" data-testid="counter-synced">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#8DA2C5]">{t('متزامنة', 'Synced')}</div>
          <div className="text-sm font-black text-slate-900 dark:text-[#EEF4FC] font-mono tabular-nums mt-0.5">
            {formatLocaleNumber(kpiStats.syncedTotal)}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5" data-testid="counter-awaiting-receive">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#8DA2C5]">{t('واردة بانتظار الاستلام', 'Incoming Awaiting Receipt')}</div>
          <div className="text-sm font-black text-amber-700 dark:text-amber-300 font-mono tabular-nums mt-0.5">
            {formatLocaleNumber(kpiStats.awaitingReceiveTotal)}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5 col-span-2 sm:col-span-1" data-testid="counter-confirmed-received">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#8DA2C5]">{t('مستلمة ومؤكدة', 'Received & Confirmed')}</div>
          <div className="flex items-baseline justify-between gap-2 mt-0.5">
            <span className="text-sm font-black text-emerald-800 dark:text-emerald-400 font-mono tabular-nums">
              {formatLocaleNumber(kpiStats.confirmedTotal)}
            </span>
            <span className="text-[10px] font-bold text-slate-500 dark:text-[#97AECE] font-mono tabular-nums">
              {formatLocaleNumber(kpiStats.totalCash)} {data.settings.currency}
            </span>
          </div>
        </div>
      </div>

      {/* UNIFIED 6-TAB BAR */}
      <div
        role="tablist"
        aria-label={t('تبويبات الإرسال والاستلام والتحويل', 'Send, Receive & Transfer Tabs')}
        data-testid="unified-send-receive-tabs"
        className="bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] rounded-lg p-1 flex flex-wrap items-center gap-1"
      >
        {tabDefinitions.map((tab) => {
          const Icon = tab.icon;
          const active = activeUnifiedTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`unified-tab-${tab.key}`}
              onClick={() => setActiveUnifiedTab(tab.key)}
              className={`h-8 px-2.5 rounded-md text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-[#011E58] text-white dark:bg-[#1659C8] shadow-xs'
                  : 'text-slate-700 dark:text-[#CBD5E1] hover:bg-slate-100 dark:hover:bg-[#132544]'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
              {typeof tab.badge === 'number' && tab.badge > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-mono tabular-nums font-black ${
                    active
                      ? 'bg-white text-[#011E58] no-dark-surface'
                      : 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200'
                  }`}
                >
                  {formatLocaleNumber(tab.badge)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ==================== TAB 1: SEND (إرسال) ==================== */}
      {activeUnifiedTab === 'send' && (
        <div className="space-y-2" data-testid="tab-panel-send">
          {/* Quick Dispatch & Transfer Action Strip */}
          <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="text-slate-700 dark:text-[#CBD5E1] font-bold">
              {t(
                'أرسل العمليات المحلية كدفعة رسمية إلى المستلم المحدد (إدارة ↔ مندوب)، أو أنشئ تحويلاً مالياً / بضائعياً مباشراً.',
                'Dispatch local operations to a chosen recipient (Management ↔ Rep), or launch a new financial/stock transfer.'
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={isSending || unsentQueueOps.length === 0}
                onClick={handleDirectQueueSend}
                className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3158] text-slate-800 dark:text-[#EEF4FC] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <ArrowUpFromLine className="w-3.5 h-3.5" />
                <span>{t('دفع فوري للطابور', 'Quick Push Queue')}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveUnifiedTab('financial-transfers')}
                className="h-8 px-2.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] dark:bg-[#132544] text-[#011E58] dark:text-[#85B8FF] border border-[#DCE6F5] dark:border-[#2C4775] font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>{t('تحويل مالي جديد', 'New Financial Transfer')}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveUnifiedTab('stock-custody')}
                className="h-8 px-2.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] dark:bg-[#132544] text-[#011E58] dark:text-[#85B8FF] border border-[#DCE6F5] dark:border-[#2C4775] font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <PackageCheck className="w-3.5 h-3.5" />
                <span>{t('تحويل بضائع / عهدة', 'New Stock / Custody Transfer')}</span>
              </button>
            </div>
          </div>

          {failedDraftBatches.length > 0 && (
            <div className="bg-blue-50/80 dark:bg-[#132544] rounded-lg border border-blue-200 dark:border-[#2C4775] p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-blue-950 dark:text-[#EEF4FC]">
                  {t('دفعات مؤكدة الإرسال أو تحتاج إعادة محاولة', 'Confirmed or Retryable Batches')} ({formatLocaleNumber(failedDraftBatches.length)})
                </span>
              </div>
              <div className="space-y-1.5">
                {failedDraftBatches.map((draft) => (
                  <div
                    key={draft.id}
                    className="bg-white dark:bg-[#0E1C36] rounded-md border border-slate-200 dark:border-[#21375C] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div>
                        <span className="font-mono font-bold text-[#011E58] dark:text-[#85B8FF]">{draft.batchNumber}</span>
                        <span className="mx-1.5 text-slate-400">·</span>
                        <span className="font-bold text-slate-800 dark:text-[#EEF4FC]">{t('المستلم:', 'Recipient:')} {draft.recipientName}</span>
                        <span className="mx-1.5 text-slate-400">·</span>
                        <span className="font-mono tabular-nums text-slate-700 dark:text-[#A9BCD8]">
                          {formatLocaleNumber(draft.operationIds.length)} {t('عمليات', 'operations')}
                        </span>
                      </div>
                      {draft.isConfirmedSendQueued && (
                        <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                          {t('طلب الإرسال مؤكد من المرسل — في انتظار المزامنة التلقائية فور عودة الاتصال', 'Dispatch confirmed by sender — awaiting automatic sync when connected')}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => handleRetryBatch(draft)}
                      className="px-2.5 py-1 rounded-md bg-blue-900 hover:bg-blue-950 text-white font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{draft.isConfirmedSendQueued ? t('محاولة المزامنة الآن', 'Sync Now') : t('إعادة الإرسال الآن', 'Retry Send Now')}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <UnifiedDataTable<SyncQueueItem>
            title={t('العمليات المحفوظة محلياً الجاهزة للإرسال', 'Locally Saved Operations Ready to Send')}
            subtitle={t(
              'حدد العمليات واختر الموظف أو المندوب المستلم لإصدار دفعة إرسال رسمية برقم متسلسل (اتجاهين: الإدارة ↔ المندوب)',
              'Select operations and choose a recipient to issue an official numbered batch (Two-Way: Management ↔ Rep)'
            )}
            columns={queueColumns}
            data={unsentQueueOps}
            rowKey={(r) => r.operationId}
            selectable={true}
            selectedKeys={selectedOpIds}
            onSelectionChange={setSelectedOpIds}
            emptyTitle={t('لا توجد عمليات محلية معلقة', 'No Pending Local Operations')}
            emptySubtitle={t('جميع فواتيرك وتحصيلاتك وتحويلاتك مرسلة ومعتمدة بالكامل', 'All your invoices, collections and transfers are fully sent and synced')}
            exportFilename={t('العمليات-المحلية-المعلقة', 'pending-local-operations')}
            pdfTitle={t('قائمة العمليات المحلية المعلقة', 'Pending Local Operations List')}
            compact
            headerActions={
              unsentQueueOps.length > 0 ? (
                <div className="awlad-filter-row w-auto max-w-full" data-testid="sync-batch-send-row">
                  <select
                    value={recipientUserId}
                    onChange={(e) => setRecipientUserId(e.target.value)}
                    aria-label={t('الموظف المستلم للدفعة', 'Batch Recipient')}
                    className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                  >
                    <option value="">{t('-- اختر المستلم (إدارة / موظف / مندوب) --', '-- Select Recipient (Admin / Staff / Rep) --')}</option>
                    {(data.dispatchRecipients || []).map((rec) => (
                      <option key={rec.id} value={rec.id}>
                        {rec.fullName} ({t(rec.jobTitle || rec.role)})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    placeholder={t('ملاحظات الإرسال (اختياري)...', 'Dispatch notes (optional)...')}
                    className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] w-40 shrink-0"
                  />
                  <button
                    type="button"
                    disabled={isSending || selectedOpIds.length === 0}
                    onClick={handleRequestPreSendConfirmation}
                    className="h-8 px-3 rounded-md bg-blue-900 hover:bg-blue-950 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" />
                    <span>{isSending ? t('جاري الإرسال...', 'Sending...') : `${t('إرسال', 'Send')} (${formatLocaleNumber(selectedOpIds.length)})`}</span>
                  </button>
                </div>
              ) : undefined
            }
          />
        </div>
      )}

      {/* ==================== TAB 2: RECEIVE (استلام) ==================== */}
      {activeUnifiedTab === 'receive' && (
        <div className="space-y-2" data-testid="tab-panel-receive">
          {/* Manual Pull & Read-Only Safety Rule */}
          <div className="bg-blue-50/70 dark:bg-[#132544] rounded-lg border border-blue-200 dark:border-[#2C4775] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="space-y-0.5">
              <div className="font-black text-[#011E58] dark:text-[#EEF4FC]">
                {t('قاعدة الاستلام المعتمد: مراجعة المستندات لا تؤكد الاستلام تلقائياً', 'Verified Receipt Rule: Inspecting documents never auto-confirms receipt')}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-[#97AECE]">
                {t(
                  'اضغط «جلب التحديثات من السيرفر» لتحميل الدفعات والتحويلات الواردة، ثم استخدم «مراجعة واستلام» أو «تأكيد الاستلام» يدوياً لاعتمادها.',
                  'Press «Pull Updates from Server» to load incoming dispatches and transfers, then click «Inspect & Receive» or «Confirm Receipt» manually.'
                )}
              </div>
            </div>
            <button
              type="button"
              disabled={isReceiving}
              onClick={handleReceiveSyncNow}
              className="h-8 px-3 rounded-md bg-[#011E58] hover:bg-[#003589] text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              <span>{isReceiving ? t('جاري الاستلام...', 'Receiving...') : t('جلب التحديثات من السيرفر', 'Pull Updates from Server')}</span>
            </button>
          </div>

          {incomingBatchesToConfirm.length > 0 && (
            <UnifiedDataTable<SyncDispatchBatch>
              title={t(`دفعات الإرسال الواردة بانتظار المراجعة والاستلام (${incomingBatchesToConfirm.length})`, `Incoming Dispatch Batches Awaiting Review (${incomingBatchesToConfirm.length})`)}
              subtitle={t('مراجعة محتوى الدفعة قبل التأكيد النهائي للاستلام بدون تكرار القيود', 'Review batch contents before final receipt confirmation')}
              columns={dispatchColumns}
              data={incomingBatchesToConfirm}
              rowKey={(b) => b.id}
              onRowClick={(b) => handleOpenInspectBatch(b)}
              searchable={incomingBatchesToConfirm.length > 5}
              compact
            />
          )}

          {incomingCustodyRows.length > 0 && (
            <UnifiedDataTable
              title={t(`التحويلات المالية وبضائع العهد الواردة بانتظار الاستلام (${incomingCustodyRows.length})`, `Incoming Cash & Stock Transfers Awaiting Receipt (${incomingCustodyRows.length})`)}
              subtitle={t('بضائع منصرفة للسيارة وتحويلات مالية واردة (من الإدارة أو من مندوب آخر) بانتظار اعتماد استلامك', 'Incoming goods custody and financial transfers awaiting your explicit confirmation')}
              columns={incomingCustodyColumns}
              data={incomingCustodyRows}
              rowKey={(r) => r.id}
              searchable={incomingCustodyRows.length > 5}
              compact
            />
          )}

          {incomingBatchesToConfirm.length === 0 && incomingCustodyRows.length === 0 && (
            <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-6 text-center space-y-1.5">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <div className="text-sm font-black text-slate-800 dark:text-[#EEF4FC]">
                {t('لا توجد دفعات أو تحويلات واردة بانتظار الاستلام حالياً', 'No incoming dispatches or transfers awaiting receipt')}
              </div>
              <p className="text-xs text-slate-500 dark:text-[#8DA2C5]">
                {t('يمكنك الضغط على «جلب التحديثات من السيرفر» لفحص أي عمليات جديدة مرسلة إليك.', 'Click «Pull Updates from Server» to check for newly dispatched operations.')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 3: FINANCIAL TRANSFERS (تحويلات مالية) ==================== */}
      {activeUnifiedTab === 'financial-transfers' && (
        <div data-testid="tab-panel-financial-transfers">
          <RepTransferView initialTab="cash-transfers" embeddedMode />
        </div>
      )}

      {/* ==================== TAB 4: STOCK & CUSTODY (تحويلات بضائع وعهد) ==================== */}
      {activeUnifiedTab === 'stock-custody' && (
        <div className="space-y-2" data-testid="tab-panel-stock-custody">
          <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStockSubTab('item-transfers')}
                className={`h-8 px-3 rounded-md text-xs font-black cursor-pointer transition-colors ${
                  stockSubTab === 'item-transfers'
                    ? 'bg-[#011E58] text-white dark:bg-[#1659C8]'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#132544] dark:text-[#CBD5E1]'
                }`}
              >
                {t('تحويلات البضائع والعهد (مخزن ↔ سيارة / مندوب ↔ مندوب)', 'Goods & Custody Transfers (Warehouse ↔ Van / Rep ↔ Rep)')}
              </button>
              <button
                type="button"
                onClick={() => setStockSubTab('rep-custody-statement')}
                className={`h-8 px-3 rounded-md text-xs font-black cursor-pointer transition-colors ${
                  stockSubTab === 'rep-custody-statement'
                    ? 'bg-[#011E58] text-white dark:bg-[#1659C8]'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#132544] dark:text-[#CBD5E1]'
                }`}
              >
                {t('كشف عهدة المندوب والتسويات', 'Rep Custody Statement & Settlements')}
              </button>
            </div>
          </div>

          <RepTransferView initialTab={stockSubTab} embeddedMode />
        </div>
      )}

      {/* ==================== TAB 5: PENDING OPERATIONS (العمليات المعلقة) ==================== */}
      {activeUnifiedTab === 'pending' && (
        <div className="space-y-2" data-testid="tab-panel-pending">
          {/* Sync Conflicts Requiring Manual Review */}
          {needsReviewConflicts.length > 0 && (
            <div className="bg-red-50/70 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-black text-red-900 dark:text-red-200">
                  <GitCompare className="w-4 h-4 shrink-0" />
                  <span>
                    {t(`تعارضات مزامنة تحتاج مراجعة يدوية (${needsReviewConflicts.length})`, `Sync Conflicts Requiring Manual Review (${needsReviewConflicts.length})`)}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                {needsReviewConflicts.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="bg-white dark:bg-[#0E1C36] rounded-md border border-red-200 dark:border-red-800 p-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-black text-slate-900 dark:text-[#EEF4FC]">
                        {t(conflict.operationType)} · <span className="font-mono">{conflict.entityId || conflict.operationId}</span>
                      </div>
                      <div className="text-[11px] font-bold text-red-700 dark:text-red-300">
                        {t('سبب التعارض:', 'Reason:')} {t(conflict.conflictReason)}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5] font-mono">
                        {formatDateTimeLocale(conflict.createdAt)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={resolvingConflictId === conflict.id}
                        onClick={() => handleResolveConflict(conflict, 'keep_server')}
                        className="h-7 px-2.5 rounded bg-blue-900 hover:bg-blue-950 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        {t('إبقاء نسخة السيرفر', 'Keep Server')}
                      </button>
                      <button
                        type="button"
                        disabled={resolvingConflictId === conflict.id}
                        onClick={() => handleResolveConflict(conflict, 'apply_local')}
                        className="h-7 px-2.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        {t('اعتماد التعديل المحلي', 'Apply Local')}
                      </button>
                      <button
                        type="button"
                        disabled={resolvingConflictId === conflict.id}
                        onClick={() => handleResolveConflict(conflict, 'dismiss')}
                        className="h-7 px-2.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] text-slate-800 dark:text-[#EEF4FC] text-[11px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        {t('تجاهل', 'Dismiss')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unsent Local Queue */}
          <UnifiedDataTable<SyncQueueItem>
            title={t(`طابور العمليات المحلية غير المرسلة (${unsentQueueOps.length})`, `Unsent Local Sync Queue (${unsentQueueOps.length})`)}
            subtitle={t('فواتير وتحصيلات وتعديلات وتحويلات محفوظة محلياً بانتظار المزامنة', 'Invoices, collections, edits & transfers saved locally awaiting sync')}
            columns={queueColumns}
            data={unsentQueueOps}
            rowKey={(r) => r.operationId}
            emptyTitle={t('لا توجد عمليات في طابور المزامنة', 'Sync Queue is Empty')}
            emptySubtitle={t('تم إرسال كافة العمليات المحلية بنجاح', 'All local operations have been sent')}
            compact
            headerActions={
              unsentQueueOps.length > 0 ? (
                <button
                  type="button"
                  disabled={isSending}
                  onClick={handleDirectQueueSend}
                  className="h-8 px-3 rounded-md bg-blue-900 hover:bg-blue-950 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSending ? t('جاري الإرسال...', 'Sending...') : t('إرسال المعلق الآن', 'Send Pending Now')}</span>
                </button>
              ) : undefined
            }
          />

          {/* Offline-Confirmed / Failed Batches */}
          {failedDraftBatches.length > 0 && (
            <div className="bg-blue-50/80 dark:bg-[#132544] rounded-lg border border-blue-200 dark:border-[#2C4775] p-2.5 space-y-1.5">
              <div className="text-xs font-black text-blue-950 dark:text-[#EEF4FC]">
                {t('دفعات مؤكدة بانتظار المزامنة أو إعادة الإرسال', 'Confirmed Queued / Retryable Dispatch Batches')} ({formatLocaleNumber(failedDraftBatches.length)})
              </div>
              <div className="space-y-1.5">
                {failedDraftBatches.map((draft) => (
                  <div
                    key={draft.id}
                    className="bg-white dark:bg-[#0E1C36] rounded-md border border-slate-200 dark:border-[#21375C] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-[#011E58] dark:text-[#85B8FF]">{draft.batchNumber}</span>
                      <span className="mx-1.5 text-slate-400">·</span>
                      <span className="font-bold text-slate-800 dark:text-[#EEF4FC]">{draft.recipientName}</span>
                      {draft.errorMessage && (
                        <span className="ms-2 text-red-700 dark:text-red-400 font-bold">({t(draft.errorMessage)})</span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => handleRetryBatch(draft)}
                      className="px-2.5 py-1 rounded-md bg-blue-900 hover:bg-blue-950 text-white font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{t('إعادة المحاولة', 'Retry')}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Cash & Stock Transfers Summary */}
          {(pendingCashAll.length > 0 || pendingItemAll.length > 0) && (
            <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-2.5 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-black text-[#011E58] dark:text-[#EEF4FC]">
                  {t('تحويلات مالية وبضائع لم تكتمل دورتها بعد', 'In-Progress Financial & Stock Transfers')} ({formatLocaleNumber(pendingCashAll.length + pendingItemAll.length)})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveUnifiedTab('receive')}
                    className="h-7 px-2.5 rounded bg-blue-900 hover:bg-blue-950 text-white font-bold cursor-pointer"
                  >
                    {t('فتح تبويب الاستلام', 'Open Receive Tab')}
                  </button>
                </div>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-[#21375C]">
                {pendingCashAll.map((ct) => (
                  <div key={ct.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-black text-blue-950 dark:text-[#85B8FF]">{ct.transferNumber}</span>
                      <span className="mx-1.5 text-slate-400">·</span>
                      <span className="font-bold text-slate-800 dark:text-[#EEF4FC]">
                        {ct.senderName} ← {ct.receiverName}
                      </span>
                      <span className="mx-1.5 text-slate-400">·</span>
                      <span className="font-mono font-bold text-emerald-800 dark:text-emerald-400">
                        {formatLocaleNumber(ct.amount)} {data.settings.currency}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${getDispatchStatusClasses('في انتظار الاستلام')}`}>
                      {t('في انتظار الاستلام', 'Awaiting Receipt')}
                    </span>
                  </div>
                ))}
                {pendingItemAll.map((it) => (
                  <div key={it.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-black text-blue-950 dark:text-[#85B8FF]">{it.requestNumber}</span>
                      <span className="mx-1.5 text-slate-400">·</span>
                      <span className="font-bold text-slate-800 dark:text-[#EEF4FC]">
                        {it.senderRepresentativeName || it.sourceWarehouseName} ← {it.representativeName || it.targetWarehouseName}
                      </span>
                      <span className="mx-1.5 text-slate-400">·</span>
                      <span className="font-mono text-slate-600 dark:text-[#97AECE]">
                        {formatLocaleNumber((it.items || []).length)} {t('صنف', 'item(s)')}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${getDispatchStatusClasses(it.status === 'executed' ? 'في انتظار الاستلام' : 'في انتظار الإرسال')}`}>
                      {it.status === 'executed'
                        ? t('في انتظار استلام المستلم', 'Awaiting Receiver Receipt')
                        : it.status === 'approved'
                        ? t('معتمد — قيد التنفيذ', 'Approved — In Progress')
                        : t('قيد المراجعة', 'Pending Review')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 6: OPERATIONS LOG (سجل العمليات) ==================== */}
      {activeUnifiedTab === 'log' && (
        <div className="space-y-2" data-testid="tab-panel-log">
          <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLogViewMode('unified')}
                className={`h-8 px-3 rounded-md text-xs font-black cursor-pointer transition-colors ${
                  logViewMode === 'unified'
                    ? 'bg-[#011E58] text-white dark:bg-[#1659C8]'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#132544] dark:text-[#CBD5E1]'
                }`}
              >
                {t('السجل الموحد الشامل (جميع العمليات)', 'Unified Operations Log (All Types)')}
              </button>
              <button
                type="button"
                onClick={() => setLogViewMode('batches')}
                className={`h-8 px-3 rounded-md text-xs font-black cursor-pointer transition-colors ${
                  logViewMode === 'batches'
                    ? 'bg-[#011E58] text-white dark:bg-[#1659C8]'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#132544] dark:text-[#CBD5E1]'
                }`}
              >
                {t('جدول دفعات الإرسال التفصيلي (12 عمود)', 'Detailed Dispatch Batches (12 Columns)')}
              </button>
            </div>
          </div>

          {logViewMode === 'unified' ? (
            <UnifiedDataTable<UnifiedOpLogRow>
              title={t('سجل العمليات الموحد (إرسال / استلام / تحويل مالي / تحويل بضائع)', 'Unified Operations Log (Send / Receive / Cash / Stock)')}
              subtitle={t('تتبع كامل لحالة كل عملية وتواريخ الإنشاء والإرسال والاستلام وأسباب الفشل إن وجدت', 'Full lifecycle tracking for every dispatch and transfer operation')}
              columns={unifiedLogColumns}
              data={filteredUnifiedLogRows}
              rowKey={(r) => r.id}
              onRowClick={(r) => {
                if (r.rawDispatch) {
                  handleOpenInspectBatch(r.rawDispatch);
                } else {
                  setInspectedTransferRow(r);
                }
              }}
              exportFilename={t('سجل-عمليات-الارسال-والاستلام-والتحويل', 'unified-send-receive-transfer-log')}
              pdfTitle={t('سجل عمليات الإرسال والاستلام والتحويل الموحد', 'Unified Send, Receive & Transfer Log')}
              searchPlaceholder={t('ابحث برقم العملية، المرسل، المستلم، الملاحظات...', 'Search by op #, sender, receiver, notes...')}
              toolbarFilters={
                <div className="flex flex-wrap items-center gap-1.5 shrink-0" data-testid="sync-filter-row">
                  <select
                    value={opTypeFilter}
                    onChange={(e) => setOpTypeFilter(e.target.value)}
                    aria-label={t('تصفية بنوع العملية', 'Filter by operation type')}
                    className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                  >
                    <option value="all">{t('كل الأنواع', 'All Types')}</option>
                    <option value="dispatch">{t('دفعات إرسال واستلام', 'Dispatches')}</option>
                    <option value="cash_transfer">{t('تحويلات مالية', 'Financial Transfers')}</option>
                    <option value="stock_transfer">{t('تحويلات بضائع وعهد', 'Stock & Custody')}</option>
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    aria-label={t('تصفية بالحالة', 'Filter by status')}
                    className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                  >
                    <option value="all">{t('جميع الحالات', 'All Statuses')}</option>
                    <option value="جديد">{t('جديد', 'New')}</option>
                    <option value="في انتظار الإرسال">{t('في انتظار الإرسال', 'Awaiting Send')}</option>
                    <option value="تم الإرسال">{t('تم الإرسال', 'Sent')}</option>
                    <option value="في انتظار الاستلام">{t('في انتظار الاستلام', 'Awaiting Receipt')}</option>
                    <option value="تم الاستلام">{t('تم الاستلام', 'Received')}</option>
                    <option value="مكتمل">{t('مكتمل', 'Completed')}</option>
                    <option value="فشل المزامنة">{t('فشل المزامنة', 'Sync Failed')}</option>
                    <option value="مرفوض">{t('مرفوض', 'Rejected')}</option>
                  </select>

                  {uniqueLogSenders.length > 0 && (
                    <select
                      value={senderFilter}
                      onChange={(e) => setSenderFilter(e.target.value)}
                      aria-label={t('تصفية بالمرسل', 'Filter by sender')}
                      className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                    >
                      <option value="all">{t('كل المرسلين', 'All Senders')}</option>
                      {uniqueLogSenders.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}

                  {uniqueLogReceivers.length > 0 && (
                    <select
                      value={recipientFilter}
                      onChange={(e) => setRecipientFilter(e.target.value)}
                      aria-label={t('تصفية بالمستلم', 'Filter by receiver')}
                      className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                    >
                      <option value="all">{t('كل المستلمين', 'All Receivers')}</option>
                      {uniqueLogReceivers.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  )}

                  <input
                    type="date"
                    value={dateFromFilter}
                    onChange={(e) => setDateFromFilter(e.target.value)}
                    aria-label={t('من تاريخ', 'From date')}
                    title={t('من تاريخ', 'From date')}
                    className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                  />

                  <input
                    type="date"
                    value={dateToFilter}
                    onChange={(e) => setDateToFilter(e.target.value)}
                    aria-label={t('إلى تاريخ', 'To date')}
                    title={t('إلى تاريخ', 'To date')}
                    className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                  />

                  {(opTypeFilter !== 'all' ||
                    statusFilter !== 'all' ||
                    senderFilter !== 'all' ||
                    recipientFilter !== 'all' ||
                    dateFromFilter ||
                    dateToFilter ||
                    dateFilter) && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpTypeFilter('all');
                        setStatusFilter('all');
                        setSenderFilter('all');
                        setRecipientFilter('all');
                        setDateFromFilter('');
                        setDateToFilter('');
                        setDateFilter('');
                      }}
                      className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3158] text-slate-700 dark:text-[#EEF4FC] text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {t('إعادة ضبط', 'Reset')}
                    </button>
                  )}
                </div>
              }
            />
          ) : (
            <UnifiedDataTable<SyncDispatchBatch>
              title={isRepUser ? t('سجل دفعات الإرسال والاستلام الرسمية', 'Official Dispatch & Receipt Log') : t('جدول إرسال واستلام المندوبين المركزي', 'Central Representatives Dispatch & Receipt Log')}
              subtitle={t('متابعة كافة دفعات المندوبين وحالات الإرسال والاستلام وتفاصيل كل مستند', 'Track all rep dispatch batches, send/receipt statuses, and document details')}
              columns={dispatchColumns}
              data={filteredBatches}
              rowKey={(b) => b.id}
              onRowClick={(b) => handleOpenInspectBatch(b)}
              exportFilename={t('سجل-دفعات-إرسال-واستلام-المندوبين', 'rep-dispatch-batches-log')}
              pdfTitle={t('سجل دفعات إرسال واستلام المندوبين', 'Representatives Dispatch Batches Log')}
              searchPlaceholder={t('ابحث برقم الدفعة، اسم المندوب، المستلم...', 'Search by batch #, rep name, recipient...')}
              toolbarFilters={
                <div className="flex flex-nowrap items-center gap-1.5 shrink-0 [&>*]:shrink-0" data-testid="sync-filter-row">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    aria-label={t('تصفية بحالة الدفعة', 'Filter by batch status')}
                    className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                  >
                    <option value="all">{t('جميع الحالات', 'All Statuses')}</option>
                    <option value="في انتظار الاستلام">{t('في انتظار الاستلام', 'Awaiting Receipt')}</option>
                    <option value="جاري الاستلام">{t('جاري الاستلام', 'Receiving...')}</option>
                    <option value="تم الاستلام">{t('تم الاستلام', 'Received')}</option>
                    <option value="تعذر الاستلام">{t('تعذر الاستلام', 'Receipt Failed')}</option>
                    <option value="فشل الإرسال">{t('فشل الإرسال', 'Send Failed')}</option>
                    <option value="تم الإرسال">{t('تم الإرسال', 'Sent')}</option>
                    <option value="جاري الإرسال">{t('جاري الإرسال', 'Sending...')}</option>
                    <option value="جاهزة للإرسال">{t('جاهزة للإرسال', 'Ready to Send')}</option>
                    <option value="محفوظة محليًا">{t('محفوظة محليًا', 'Saved Locally')}</option>
                  </select>

                  {!isRepUser && uniqueSenders.length > 0 && (
                    <select
                      value={senderFilter}
                      onChange={(e) => setSenderFilter(e.target.value)}
                      aria-label={t('تصفية بالمرسل', 'Filter by sender')}
                      className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                    >
                      <option value="all">{t('كل المرسلين', 'All Senders')}</option>
                      {uniqueSenders.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}

                  {uniqueRecipients.length > 0 && (
                    <select
                      value={recipientFilter}
                      onChange={(e) => setRecipientFilter(e.target.value)}
                      aria-label={t('تصفية بالمستلم', 'Filter by recipient')}
                      className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
                    >
                      <option value="all">{t('كل المستلمين', 'All Recipients')}</option>
                      {uniqueRecipients.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  )}

                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    aria-label={t('تصفية بتاريخ الإرسال', 'Filter by send date')}
                    className="h-8 px-2 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] shrink-0"
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
                      className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3158] text-slate-700 dark:text-[#EEF4FC] text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {t('إعادة ضبط', 'Reset')}
                    </button>
                  )}
                </div>
              }
            />
          )}
        </div>
      )}

      {/* PRE-SEND SUMMARY CONFIRMATION MODAL */}
      {pendingSendConfirm &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/65 backdrop-blur-[2px] p-3"
            onClick={() => setPendingSendConfirm(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              dir={dir}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#0E1C36] rounded-xl border border-slate-200 dark:border-[#21375C] shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-blue-950 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  <h3 className="text-sm font-black">{t('تأكيد إرسال الدفعة الرسمية', 'Confirm Official Batch Dispatch')}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingSendConfirm(null)}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  aria-label={t('إغلاق', 'Close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1">
                  <div className="text-slate-600 dark:text-[#8DA2C5]">
                    {t('المستلم المحدد:', 'Selected Recipient:')} <strong className="text-slate-900 dark:text-[#EEF4FC]">{pendingSendConfirm.recipientLabel}</strong>
                  </div>
                  <div className="text-slate-600 dark:text-[#8DA2C5]">
                    {t('إجمالي العمليات المحددة:', 'Total Selected Operations:')} <strong className="font-mono text-[#011E58] dark:text-[#85B8FF]">{formatLocaleNumber(pendingSendConfirm.chosenOps.length)}</strong>
                  </div>
                  {pendingSendConfirm.notes && (
                    <div className="text-slate-600 dark:text-[#8DA2C5]">
                      {t('ملاحظات:', 'Notes:')} <span className="text-slate-900 dark:text-[#EEF4FC]">{pendingSendConfirm.notes}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="p-2 rounded-md border border-slate-200 dark:border-[#21375C] bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('فواتير البيع', 'Sales Invoices')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC]">{formatLocaleNumber(pendingSendConfirm.salesCount)}</div>
                  </div>
                  <div className="p-2 rounded-md border border-slate-200 dark:border-[#21375C] bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('التحصيلات', 'Collections')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC]">{formatLocaleNumber(pendingSendConfirm.collectionsCount)}</div>
                  </div>
                  <div className="p-2 rounded-md border border-slate-200 dark:border-[#21375C] bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('المرتجعات', 'Returns')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC]">{formatLocaleNumber(pendingSendConfirm.returnsCount)}</div>
                  </div>
                  <div className="p-2 rounded-md border border-slate-200 dark:border-[#21375C] bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('عهد / أخرى', 'Custody / Other')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC]">
                      {formatLocaleNumber(pendingSendConfirm.ordersCount + pendingSendConfirm.purchasesCount + pendingSendConfirm.customersCount + pendingSendConfirm.custodyOpsCount)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-md border border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#132544]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('إجمالي المبيعات', 'Total Sales')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC]">
                      {formatLocaleNumber(pendingSendConfirm.totalSalesAmount)} {data.settings.currency}
                    </div>
                  </div>
                  <div className="p-2 rounded-md border border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#132544]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('إجمالي النقدية', 'Total Cash')}</div>
                    <div className="font-mono font-black text-emerald-800 dark:text-emerald-400">
                      {formatLocaleNumber(pendingSendConfirm.totalCashAmount)} {data.settings.currency}
                    </div>
                  </div>
                </div>

                {!isOnline && (
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 font-bold">
                    {t(
                      'أنت غير متصل حالياً: عند تأكيد الإرسال، سيتم حفظ الدفعة في طابور الإرسال المؤكد («طلب الإرسال مؤكد من المرسل») وإرسالها تلقائياً عند عودة الاتصال دون إرسال أي مسودات غير مؤكدة.',
                      'You are currently offline: once confirmed, the batch will be queued in Confirmed Outbox and sent automatically upon reconnection without sending unconfirmed drafts.'
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPendingSendConfirm(null)}
                    className="h-8 px-3 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3158] text-slate-800 dark:text-[#EEF4FC] font-bold cursor-pointer"
                  >
                    {t('إلغاء', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmAndSendDispatchBatch}
                    className="h-8 px-4 rounded-md bg-blue-900 hover:bg-blue-950 text-white font-black flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isOnline ? t('تأكيد الإرسال الآن', 'Confirm & Send Now') : t('تأكيد الحفظ للإرسال عند الاتصال', 'Confirm Save for Online Sync')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* REJECT CASH TRANSFER MODAL */}
      {rejectCashTarget &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/65 backdrop-blur-[2px] p-3"
            onClick={() => { if (!rejectCashLoading) setRejectCashTarget(null); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              dir={dir}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#0E1C36] rounded-xl border border-slate-200 dark:border-[#21375C] shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-red-800 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4" />
                  <h3 className="text-sm font-black">
                    {t('رفض التحويل المالي', 'Reject Financial Transfer')} · <span className="font-mono">{rejectCashTarget.docNo}</span>
                  </h3>
                </div>
                <button
                  type="button"
                  disabled={rejectCashLoading}
                  onClick={() => setRejectCashTarget(null)}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  aria-label={t('إغلاق', 'Close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-800 dark:text-[#EEF4FC] mb-1">
                    {t('سبب رفض التحويل:', 'Rejection Reason:')}
                  </label>
                  <input
                    type="text"
                    value={rejectCashReason}
                    onChange={(e) => setRejectCashReason(e.target.value)}
                    placeholder={t('اكتب سبب عدم استلام المبلغ أو المراجعة...', 'Enter reason for not accepting transfer...')}
                    className="w-full h-9 px-2.5 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC]"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={rejectCashLoading}
                    onClick={() => setRejectCashTarget(null)}
                    className="h-8 px-3 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] text-slate-800 dark:text-[#EEF4FC] font-bold cursor-pointer"
                  >
                    {t('إلغاء', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={rejectCashLoading || !rejectCashReason.trim()}
                    onClick={handleRejectIncomingCash}
                    className="h-8 px-4 rounded-md bg-red-600 hover:bg-red-700 text-white font-black cursor-pointer disabled:opacity-50"
                  >
                    {rejectCashLoading ? t('جاري الحفظ...', 'Saving...') : t('تأكيد الرفض', 'Confirm Rejection')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* READ-ONLY TRANSFER DETAIL MODAL */}
      {inspectedTransferRow &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            className="fixed inset-0 z-[92] flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-3"
            onClick={() => setInspectedTransferRow(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              dir={dir}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#0E1C36] rounded-xl border border-slate-200 dark:border-[#21375C] shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-blue-950 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  <h3 className="text-sm font-black">
                    {t(inspectedTransferRow.opTypeAr, inspectedTransferRow.opTypeEn)} · <span className="font-mono">{inspectedTransferRow.docNumber}</span>
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedTransferRow(null)}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  aria-label={t('إغلاق', 'Close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="p-2 rounded bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('المرسل', 'Sender')}</div>
                    <div className="font-black text-slate-900 dark:text-[#EEF4FC]">{inspectedTransferRow.senderName}</div>
                  </div>
                  <div className="p-2 rounded bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('المستلم', 'Receiver')}</div>
                    <div className="font-black text-slate-900 dark:text-[#EEF4FC]">{inspectedTransferRow.receiverName}</div>
                  </div>
                  <div className="p-2 rounded bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('الحالة', 'Status')}</div>
                    <div className="font-black text-[#011E58] dark:text-[#85B8FF]">
                      {t(inspectedTransferRow.unifiedStatus, DISPATCH_STATUS_EN[inspectedTransferRow.unifiedStatus] || inspectedTransferRow.unifiedStatus)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded border border-slate-200 dark:border-[#21375C]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('تاريخ الإنشاء', 'Created')}</div>
                    <div className="font-mono text-[11px] font-bold text-slate-800 dark:text-[#EEF4FC]">{formatDateTimeLocale(inspectedTransferRow.createdAt)}</div>
                  </div>
                  <div className="p-2 rounded border border-slate-200 dark:border-[#21375C]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('تاريخ الإرسال', 'Sent')}</div>
                    <div className="font-mono text-[11px] font-bold text-slate-800 dark:text-[#EEF4FC]">{formatDateTimeLocale(inspectedTransferRow.sentAt)}</div>
                  </div>
                  <div className="p-2 rounded border border-slate-200 dark:border-[#21375C]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('تاريخ الاستلام', 'Received')}</div>
                    <div className="font-mono text-[11px] font-bold text-slate-800 dark:text-[#EEF4FC]">{formatDateTimeLocale(inspectedTransferRow.receivedAt)}</div>
                  </div>
                </div>
                {inspectedTransferRow.rawItem && (
                  <div className="rounded border border-slate-200 dark:border-[#21375C] overflow-hidden">
                    <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-[#132544] font-black text-slate-800 dark:text-[#EEF4FC]">
                      {t('الأصناف المرفقة', 'Attached Items')}
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-[#21375C]">
                      {(inspectedTransferRow.rawItem.items || []).map((item, idx) => (
                        <div key={idx} className="px-2.5 py-1.5 flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-800 dark:text-[#EEF4FC]">{item.productName}</span>
                          <span className="font-mono font-black text-[#011E58] dark:text-[#85B8FF]">
                            {formatLocaleNumber(item.approvedQty ?? item.requestedQty)} {t(item.unit)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(inspectedTransferRow.notes || inspectedTransferRow.failureReason) && (
                  <div className="p-2.5 rounded bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1">
                    {inspectedTransferRow.notes && (
                      <div>
                        <span className="font-bold text-slate-500 dark:text-[#8DA2C5]">{t('ملاحظات:', 'Notes:')} </span>
                        <span className="text-slate-900 dark:text-[#EEF4FC]">{inspectedTransferRow.notes}</span>
                      </div>
                    )}
                    {inspectedTransferRow.failureReason && (
                      <div className="text-red-700 dark:text-red-300 font-bold">
                        {t('سبب الفشل / الرفض:', 'Failure / Rejection Reason:')} {t(inspectedTransferRow.failureReason)}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setInspectedTransferRow(null)}
                    className="h-8 px-4 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] text-slate-800 dark:text-[#EEF4FC] font-bold cursor-pointer"
                  >
                    {t('إغلاق', 'Close')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* BATCH INSPECTION & CONFIRMATION PORTAL MODAL */}
      {inspectedBatch &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-2 sm:p-3"
            onClick={() => { if (!batchActionLoading) setInspectedBatch(null); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              dir={dir}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-3 py-2 bg-blue-950 text-white flex items-center justify-between gap-2 shrink-0">
                <div>
                  <h3 className="text-xs sm:text-sm font-black">
                    {t('مراجعة دفعة الإرسال', 'Inspect Dispatch Batch')} · <span className="font-mono">{inspectedBatch.batchNumber}</span>
                  </h3>
                  <p className="text-[11px] text-blue-200">
                    {t('المرسل:', 'Sender:')} {inspectedBatch.senderName} · {t('المستلم المحدد:', 'Target Recipient:')} {inspectedBatch.recipientName} · {t('أرسلت في:', 'Sent at:')} {formatDateTimeLocale(inspectedBatch.sentAt || inspectedBatch.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedBatch(null)}
                  className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  aria-label={t('إغلاق', 'Close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {/* Compact Hairline Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-md overflow-hidden text-xs">
                  <div className="px-2.5 py-1.5 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('حالة الإرسال', 'Send Status')}</div>
                    <div className="font-black text-slate-900 dark:text-[#EEF4FC]">
                      {t(inspectedBatch.sendStatus, DISPATCH_STATUS_EN[inspectedBatch.sendStatus] || inspectedBatch.sendStatus)}
                    </div>
                  </div>
                  <div className="px-2.5 py-1.5 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('حالة الاستلام', 'Receipt Status')}</div>
                    <div className="font-black text-[#011E58] dark:text-[#85B8FF]">
                      {t(inspectedBatch.receiptStatus, DISPATCH_STATUS_EN[inspectedBatch.receiptStatus] || inspectedBatch.receiptStatus)}
                    </div>
                  </div>
                  <div className="px-2.5 py-1.5 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('إجمالي المبيعات بالدفعة', 'Batch Total Sales')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC] tabular-nums">
                      {formatLocaleNumber(Number(inspectedBatch.totalSalesAmount || 0))} {data.settings.currency}
                    </div>
                  </div>
                  <div className="px-2.5 py-1.5 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('إجمالي التحصيلات النقدية', 'Total Cash Collections')}</div>
                    <div className="font-mono font-black text-emerald-800 dark:text-emerald-400 tabular-nums">
                      {formatLocaleNumber(Number(inspectedBatch.totalCashAmount || 0))} {data.settings.currency}
                    </div>
                  </div>
                </div>

                {/* Operational Counts Breakdown */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-md overflow-hidden text-center text-xs">
                  <div className="px-2 py-1 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('فواتير بيع', 'Sales')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC] tabular-nums">{formatLocaleNumber(inspectedBatch.salesCount || 0)}</div>
                  </div>
                  <div className="px-2 py-1 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('تحصيلات', 'Collections')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC] tabular-nums">{formatLocaleNumber(inspectedBatch.collectionsCount || 0)}</div>
                  </div>
                  <div className="px-2 py-1 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('مرتجعات', 'Returns')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC] tabular-nums">{formatLocaleNumber(inspectedBatch.returnsCount || 0)}</div>
                  </div>
                  <div className="px-2 py-1 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('فواتير شراء', 'Purchases')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC] tabular-nums">{formatLocaleNumber(inspectedBatch.purchasesCount || 0)}</div>
                  </div>
                  <div className="px-2 py-1 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('عملاء جدد', 'New Customers')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC] tabular-nums">{formatLocaleNumber(inspectedBatch.customersCount || 0)}</div>
                  </div>
                  <div className="px-2 py-1 bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#8DA2C5]">{t('عمليات عهدة', 'Custody Ops')}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#EEF4FC] tabular-nums">{formatLocaleNumber(inspectedBatch.custodyOpsCount || 0)}</div>
                  </div>
                </div>

                {(inspectedBatch.notes || inspectedBatch.receiptNotes || inspectedBatch.errorMessage || inspectedBatch.receivedByName || inspectedBatch.discrepancyDetails?.hasDiscrepancy) && (
                  <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] text-xs space-y-1">
                    {inspectedBatch.notes && (
                      <div>
                        <span className="font-bold text-slate-600 dark:text-[#8DA2C5]">{t('ملاحظات المرسل:', 'Sender Notes:')} </span>
                        <span className="text-slate-900 dark:text-[#EEF4FC]">{inspectedBatch.notes}</span>
                      </div>
                    )}
                    {inspectedBatch.receivedByName && (
                      <div>
                        <span className="font-bold text-emerald-800 dark:text-emerald-400">{t('المستلم الفعلي:', 'Actual Receiver:')} </span>
                        <span className="font-black text-slate-900 dark:text-[#EEF4FC]">
                          {inspectedBatch.receivedByName} ({formatDateTimeLocale(inspectedBatch.receivedAt)})
                        </span>
                      </div>
                    )}
                    {inspectedBatch.receiptNotes && (
                      <div>
                        <span className="font-bold text-slate-600 dark:text-[#8DA2C5]">{t('ملاحظات الاستلام:', 'Receipt Notes:')} </span>
                        <span className="text-slate-900 dark:text-[#EEF4FC]">{inspectedBatch.receiptNotes}</span>
                      </div>
                    )}
                    {inspectedBatch.discrepancyDetails?.hasDiscrepancy && (
                      <div className="text-amber-800 dark:text-amber-300 font-bold">
                        {t('ملاحظة فرق / اعتراض استلام:', 'Discrepancy / Objection Note:')} {inspectedBatch.discrepancyDetails.note || t('تم توثيق فرق', 'Discrepancy noted')}
                      </div>
                    )}
                    {inspectedBatch.errorMessage && (
                      <div className="text-red-700 dark:text-red-300 font-bold">
                        {t('سبب المشكلة / التعذر:', 'Error / Failure Reason:')} {t(inspectedBatch.errorMessage)}
                      </div>
                    )}
                  </div>
                )}

                {/* Document Line Items Table */}
                <UnifiedDataTable<SyncDispatchBatchDocSummaryItem>
                  title={t(`تفاصيل المستندات داخل الدفعة (${inspectedDocs.length})`, `Documents in Batch (${inspectedDocs.length})`)}
                  columns={batchDocColumns}
                  data={inspectedDocs}
                  rowKey={(d, idx) => d.operationId || String(idx)}
                  searchable={inspectedDocs.length > 5}
                  compact
                  defaultPageSize={10}
                />

                {/* Device Traceability & Dispatch Audit Trail */}
                {(inspectedBatch.deviceId || inspectedBatch.receivedDeviceId || isLoadingInspectDetails || inspectedAuditTrail.length > 0) && (
                  <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] text-xs space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-black text-slate-800 dark:text-[#EEF4FC]">{t('سجل التتبع والأجهزة للدفعة', 'Device Traceability & Audit Trail')}</span>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-600 dark:text-[#97AECE]">
                        {inspectedBatch.deviceId && <span>{t('جهاز الإرسال:', 'Sender Device:')} {inspectedBatch.deviceId}</span>}
                        {inspectedBatch.receivedDeviceId && <span>{t('جهاز الاستلام:', 'Receiver Device:')} {inspectedBatch.receivedDeviceId}</span>}
                      </div>
                    </div>
                    {isLoadingInspectDetails ? (
                      <div className="text-[11px] text-slate-500 dark:text-[#8DA2C5]">{t('جاري تحميل سجل التدقيق...', 'Loading audit log...')}</div>
                    ) : inspectedAuditTrail.length > 0 ? (
                      <div className="divide-y divide-slate-200/70 dark:divide-[#21375C] rounded border border-slate-200 dark:border-[#21375C] bg-white dark:bg-[#0E1C36]">
                        {inspectedAuditTrail.map((entry) => (
                          <div key={entry.id} className="px-2 py-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <div className="font-bold text-slate-800 dark:text-[#EEF4FC]">
                              {t(entry.action)}
                              {entry.details ? <span className="font-normal text-slate-500 dark:text-[#97AECE]"> — {entry.details}</span> : null}
                            </div>
                            <div className="text-slate-500 dark:text-[#8DA2C5] font-mono">
                              {entry.userName} · {formatDateTimeLocale(entry.timestamp)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Authorized Recipient Explicit Confirmation / Objection / Reject Section */}
                {canConfirmBatch(inspectedBatch) && (
                  <div className="p-2.5 rounded-lg bg-blue-50/70 dark:bg-[#132544] border border-blue-200 dark:border-[#2C4775] space-y-2">
                    <div className="text-xs font-black text-blue-950 dark:text-[#EEF4FC]">
                      {t(
                        'اعتماد استلام الدفعة إدارياً (يتم التوثيق وتأكيد الاستلام يدوياً دون تكرار أي قيد مالي أو مخزني)',
                        'Approve batch receipt administratively (manual verification without duplicate financial or stock entries)'
                      )}
                    </div>
                    <input
                      type="text"
                      value={receiptNotesInput}
                      onChange={(e) => setReceiptNotesInput(e.target.value)}
                      placeholder={t('ملاحظات الاستلام والتدقيق (اختياري)...', 'Receipt and audit notes (optional)...')}
                      className="w-full h-8 px-2.5 rounded-md border border-slate-300 dark:border-[#2C4775] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC]"
                    />

                    <label className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hasDiscrepancyInput}
                        onChange={(e) => setHasDiscrepancyInput(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>{t('توثيق اعتراض أو فرق جردي/نقدي مع الاستلام', 'Record discrepancy or cash/stock objection upon receipt')}</span>
                    </label>

                    {hasDiscrepancyInput && (
                      <input
                        type="text"
                        value={discrepancyNoteInput}
                        onChange={(e) => setDiscrepancyNoteInput(e.target.value)}
                        placeholder={t('تفاصيل الفرق أو الاعتراض الموثق...', 'Details of discrepancy or objection...')}
                        className="w-full h-8 px-2.5 rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC]"
                      />
                    )}

                    {showFailReasonBox && (
                      <div className="space-y-1.5 p-2 rounded-md bg-white dark:bg-[#0E1C36] border border-red-200 dark:border-red-800">
                        <label className="block text-xs font-bold text-red-800 dark:text-red-300">
                          {t('سبب تعذر الاستلام / الرفض:', 'Failure / Rejection Reason:')}
                        </label>
                        <input
                          type="text"
                          value={failReasonInput}
                          onChange={(e) => setFailReasonInput(e.target.value)}
                          placeholder={t('مثال: نقص مستندات أو فرق عهدة...', 'Example: Missing documents or custody discrepancy...')}
                          className="w-full h-8 px-2.5 rounded-md border border-red-300 dark:border-red-700 bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC]"
                        />
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={batchActionLoading}
                            onClick={handleFailInspectedBatch}
                            className="h-8 px-3 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            {t('حفظ حالة «تعذر الاستلام»', 'Save «Receipt Failed» Status')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowFailReasonBox(false)}
                            className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:text-[#EEF4FC] text-slate-700 text-xs font-bold cursor-pointer"
                          >
                            {t('إلغاء', 'Cancel')}
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
                          className="h-8 px-3 rounded-md bg-white dark:bg-[#0E1C36] border border-red-300 dark:border-red-700 text-red-800 dark:text-red-300 hover:bg-red-50 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          <span>{t('رفض / تعذر الاستلام', 'Reject / Receipt Failed')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={batchActionLoading}
                        onClick={() => handleConfirmInspectedBatch(inspectedBatch)}
                        className="h-8 px-3 rounded-md bg-blue-950 hover:bg-blue-900 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>{batchActionLoading ? t('جاري التأكيد...', 'Confirming...') : t('تأكيد الاستلام النهائي', 'Confirm Final Receipt')}</span>
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

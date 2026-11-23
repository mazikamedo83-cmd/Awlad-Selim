import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  AlertCircle,
  Clock,
  PackageCheck,
  Wallet,
  RefreshCw,
  CloudOff,
  Server,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';

interface RefreshSyncScreenProps {
  onBack?: () => void;
}

type SendVisualState = 'ready' | 'pending' | 'sending' | 'success' | 'error';
type ReceiveVisualState = 'new_data' | 'receiving' | 'success' | 'error';

function formatElapsedTenths(ms: number): string {
  const totalTenths = Math.max(0, Math.floor(ms / 100));
  const mins = Math.floor(totalTenths / 600);
  const secs = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export const RefreshSyncScreen: React.FC<RefreshSyncScreenProps> = ({ onBack }) => {
  const data = useData();
  const { currentUser, representativeProfile } = useAuth();

  const rep = useMemo(
    () =>
      representativeProfile ||
      data.representatives.find((r) => r.userId && r.userId === currentUser?.id) ||
      (currentUser?.role !== 'representative'
        ? data.representatives.find((r) => !r.userId && r.name === currentUser?.fullName)
        : undefined) ||
      null,
    [representativeProfile, data.representatives, currentUser]
  );

  // Send panel timer & live state
  const [isSending, setIsSending] = useState(false);
  const [sendElapsedMs, setSendElapsedMs] = useState(0);
  const [sendRunResult, setSendRunResult] = useState<{
    state: SendVisualState;
    confirmedCount?: number;
    error?: string;
  } | null>(null);
  const sendStartRef = useRef<number | null>(null);

  // Receive panel timer & live state
  const [isReceiving, setIsReceiving] = useState(false);
  const [receiveElapsedMs, setReceiveElapsedMs] = useState(0);
  const [receiveRunResult, setReceiveRunResult] = useState<{
    state: ReceiveVisualState;
    receivedCount?: number;
    error?: string;
  } | null>(null);
  const receiveStartRef = useRef<number | null>(null);

  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSending) return;
    sendStartRef.current = Date.now();
    setSendElapsedMs(0);
    const id = window.setInterval(() => {
      if (sendStartRef.current !== null) {
        setSendElapsedMs(Date.now() - sendStartRef.current);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [isSending]);

  useEffect(() => {
    if (!isReceiving) return;
    receiveStartRef.current = Date.now();
    setReceiveElapsedMs(0);
    const id = window.setInterval(() => {
      if (receiveStartRef.current !== null) {
        setReceiveElapsedMs(Date.now() - receiveStartRef.current);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [isReceiving]);

  const pendingOps = useMemo(
    () =>
      (data.syncQueue || []).filter(
        (q) => q.status === 'pending' || q.status === 'local' || q.status === 'failed' || q.status === 'syncing'
      ),
    [data.syncQueue]
  );

  const awaitingCustodyDispatches = useMemo(() => {
    return (data.repItemTransfers || []).filter((t) => {
      if (t.status !== 'executed') return false;
      if (rep) return t.representativeId === rep.id;
      return true;
    });
  }, [data.repItemTransfers, rep]);

  const awaitingCashTransfers = useMemo(() => {
    return (data.repTransfers || []).filter((t) => {
      if (t.status !== 'awaiting_receipt' || t.direction !== 'owner_to_rep') return false;
      if (rep) return t.receiverId === rep.id;
      return true;
    });
  }, [data.repTransfers, rep]);

  const incomingAwaitingCount = awaitingCustodyDispatches.length + awaitingCashTransfers.length;

  const currentSendStatus: { state: SendVisualState; label: string } = useMemo(() => {
    if (isSending) return { state: 'sending', label: 'جاري الإرسال' };
    if (sendRunResult?.state === 'error' || (data.failedSyncCount > 0 && pendingOps.length > 0)) {
      return { state: 'error', label: 'فشل الإرسال' };
    }
    if (pendingOps.length > 0) return { state: 'pending', label: 'توجد عمليات معلقة' };
    if (sendRunResult?.state === 'success') return { state: 'success', label: 'تم الإرسال بنجاح' };
    return { state: 'ready', label: 'جاهز للإرسال' };
  }, [isSending, sendRunResult, data.failedSyncCount, pendingOps.length]);

  const currentReceiveStatus: { state: ReceiveVisualState; label: string } = useMemo(() => {
    if (isReceiving) return { state: 'receiving', label: 'جاري الاستلام' };
    if (receiveRunResult?.state === 'error') return { state: 'error', label: 'تعذر الاستلام' };
    if (incomingAwaitingCount > 0) return { state: 'new_data', label: 'توجد بيانات جديدة للاستلام' };
    if (receiveRunResult?.state === 'success' || data.lastReceiveSummary?.ok) {
      return { state: 'success', label: 'تم الاستلام بنجاح' };
    }
    return { state: 'new_data', label: 'توجد بيانات جديدة للاستلام' };
  }, [isReceiving, receiveRunResult, incomingAwaitingCount, data.lastReceiveSummary]);

  const handleSendNow = async () => {
    if (isSending) return;
    setActionMsg(null);
    setSendRunResult(null);
    setIsSending(true);
    const res = await data.syncSendOnly();
    const finalElapsed = sendStartRef.current !== null ? Date.now() - sendStartRef.current : 0;
    setSendElapsedMs(finalElapsed);
    setIsSending(false);
    if (res.ok && res.failedCount === 0) {
      setSendRunResult({ state: 'success', confirmedCount: res.count });
      setActionMsg({
        type: 'success',
        text: `تم إرسال واعتماد (${res.count}) عملية من السيرفر بنجاح.`,
      });
    } else {
      setSendRunResult({
        state: 'error',
        confirmedCount: res.count,
        error: res.error || `تعذر إرسال (${res.failedCount}) عملية — بقيت محفوظة محلياً.`,
      });
      setActionMsg({
        type: 'error',
        text: res.error || `فشل الإرسال لعدد (${res.failedCount}) عملية. لم تُحذف أي عملية محلية غير مؤكدة.`,
      });
    }
  };

  const handleReceiveNow = async () => {
    if (isReceiving) return;
    setActionMsg(null);
    setReceiveRunResult(null);
    setIsReceiving(true);
    const res = await data.syncReceiveOnly();
    const finalElapsed = receiveStartRef.current !== null ? Date.now() - receiveStartRef.current : 0;
    setReceiveElapsedMs(finalElapsed);
    setIsReceiving(false);
    if (res.ok) {
      setReceiveRunResult({ state: 'success', receivedCount: res.count });
      setActionMsg({
        type: 'success',
        text: `تم الاستلام بنجاح وتحديث البيانات (${res.count} سجل).`,
      });
    } else {
      setReceiveRunResult({
        state: 'error',
        error: res.error || 'تعذر الاتصال بالسيرفر لجلب التحديثات',
      });
      setActionMsg({
        type: 'error',
        text: res.error || 'تعذر استلام البيانات من السيرفر',
      });
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

  const formatTimestamp = (iso?: string | null) => {
    if (!iso) return 'لم يتم بعد';
    try {
      return new Date(iso).toLocaleString('ar-EG');
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-blue-950 text-white flex items-center justify-center shrink-0">
            <RefreshCw className={`w-5 h-5 ${isSending || isReceiving ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-black text-slate-900">REFRESH · مركز الإرسال والاستلام</h2>
            <p className="text-[11px] text-slate-500">
              مزامنة مستقلة للعمليات المحلية المعلقة واستلام عهد البضاعة والتحويلات الواردة
            </p>
          </div>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold shrink-0 cursor-pointer"
          >
            رجوع
          </button>
        )}
      </div>

      {actionMsg && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
            actionMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
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

      {/* Dual Send / Receive Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SEND PANEL */}
        <section className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 flex items-center justify-center">
                  <ArrowUpFromLine className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">إرسال البيانات (Send)</h3>
                  <p className="text-[11px] text-slate-500">رفع الفواتير والتحصيلات والعمليات المعلقة للسيرفر</p>
                </div>
              </div>
              <div className="text-left font-mono tabular-nums">
                <div className="text-xs font-black text-blue-950 flex items-center gap-1 justify-end">
                  <Clock className="w-3.5 h-3.5 text-blue-700" />
                  <span>{formatElapsedTenths(sendElapsedMs)}</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 font-bold">الحالة الحالية:</span>
                <strong
                  className={`font-black ${
                    currentSendStatus.state === 'error'
                      ? 'text-red-700'
                      : currentSendStatus.state === 'pending'
                      ? 'text-amber-700'
                      : currentSendStatus.state === 'success'
                      ? 'text-emerald-700'
                      : 'text-blue-900'
                  }`}
                >
                  {currentSendStatus.label}
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">العمليات المعلقة محلياً:</span>
                <strong className="font-mono tabular-nums text-slate-900">
                  {pendingOps.length} عملية
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">تاريخ ووقت آخر إرسال:</span>
                <span className="font-mono text-[11px] text-slate-700">
                  {formatTimestamp(data.lastSendSummary?.at)}
                </span>
              </div>
              {data.lastSendSummary && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">المؤكد من السيرفر في آخر إرسال:</span>
                  <strong className="font-mono tabular-nums text-emerald-700">
                    {data.lastSendSummary.count} عملية
                  </strong>
                </div>
              )}
              {sendRunResult?.error && (
                <p className="text-[11px] font-bold text-red-700 pt-1 border-t border-slate-200">
                  {sendRunResult.error}
                </p>
              )}
            </div>

            {pendingOps.length > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-2xl p-3 bg-slate-50/70">
                <p className="text-[11px] font-black text-slate-700 flex items-center gap-1.5">
                  <CloudOff className="w-3.5 h-3.5 text-amber-600" />
                  <span>قائمة العمليات المحفوظة محلياً (لن تُحذف قبل اعتماد السيرفر):</span>
                </p>
                {pendingOps.map((op) => (
                  <div
                    key={op.operationId}
                    className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-slate-200/70 last:border-b-0"
                  >
                    <span className="font-bold text-slate-800 truncate">{op.summaryAr}</span>
                    <span
                      className={`font-mono shrink-0 ${
                        op.status === 'failed' ? 'text-red-700 font-bold' : 'text-amber-800'
                      }`}
                    >
                      {op.status === 'failed' ? 'فشل مؤقت' : 'معلق'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={isSending}
            onClick={handleSendNow}
            className="w-full min-h-[48px] rounded-2xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55"
          >
            <ArrowUpFromLine className="w-4 h-4" />
            <span>{isSending ? 'جاري الإرسال...' : 'إرسال العمليات المعلقة الآن'}</span>
          </button>
        </section>

        {/* RECEIVE PANEL */}
        <section className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center justify-center">
                  <ArrowDownToLine className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">استلام البيانات (Receive)</h3>
                  <p className="text-[11px] text-slate-500">جلب الأسعار والأرصدة وعهد البضاعة والتحويلات الواردة</p>
                </div>
              </div>
              <div className="text-left font-mono tabular-nums">
                <div className="text-xs font-black text-emerald-800 flex items-center gap-1 justify-end">
                  <Clock className="w-3.5 h-3.5 text-emerald-700" />
                  <span>{formatElapsedTenths(receiveElapsedMs)}</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 font-bold">الحالة الحالية:</span>
                <strong
                  className={`font-black ${
                    currentReceiveStatus.state === 'error'
                      ? 'text-red-700'
                      : currentReceiveStatus.state === 'success'
                      ? 'text-emerald-700'
                      : 'text-blue-900'
                  }`}
                >
                  {currentReceiveStatus.label}
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">عهد وتحويلات بانتظار تأكيدك:</span>
                <strong className="font-mono tabular-nums text-amber-800">
                  {incomingAwaitingCount} عنصر
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">تاريخ ووقت آخر استلام:</span>
                <span className="font-mono text-[11px] text-slate-700">
                  {formatTimestamp(data.lastReceiveSummary?.at)}
                </span>
              </div>
              {data.lastReceiveSummary && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">السجلات المستلمة في آخر تحديث:</span>
                  <strong className="font-mono tabular-nums text-emerald-700">
                    {data.lastReceiveSummary.count} سجل
                  </strong>
                </div>
              )}
              {receiveRunResult?.error && (
                <p className="text-[11px] font-bold text-red-700 pt-1 border-t border-slate-200">
                  {receiveRunResult.error}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={isReceiving}
            onClick={handleReceiveNow}
            className="w-full min-h-[48px] rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55"
          >
            <ArrowDownToLine className="w-4 h-4" />
            <span>{isReceiving ? 'جاري الاستلام...' : 'استلام التحديثات الآن'}</span>
          </button>
        </section>
      </div>

      {/* Incoming Custody Dispatches & Cash Transfers Awaiting Confirmation */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-900" />
            <h3 className="text-sm font-black text-slate-900">
              العهد والتحويلات الواردة من الإدارة بانتظار تأكيد الاستلام ({incomingAwaitingCount})
            </h3>
          </div>
          <button
            type="button"
            onClick={() => data.triggerManualSync()}
            className="min-h-[40px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
          >
            مزامنة كاملة
          </button>
        </div>

        {incomingAwaitingCount === 0 ? (
          <p className="text-xs text-slate-500 py-5 text-center">
            لا توجد عهد أصناف أو تحويلات نقدية جديدة معلقة للاستلام حالياً.
          </p>
        ) : (
          <div className="space-y-3">
            {awaitingCustodyDispatches.map((tr) => (
              <div
                key={tr.id}
                className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PackageCheck className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="font-mono font-black text-blue-950">{tr.requestNumber}</span>
                    <span className="text-slate-500">·</span>
                    <span className="font-bold text-slate-700">
                      {tr.transferMode === 'custody_dispatch' ? 'صرف عهدة بضاعة للمندوب' : 'تحويل أصناف للسيارة'}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500">{tr.date}</span>
                </div>

                <div className="divide-y divide-amber-200/60 bg-white rounded-xl border border-amber-200/80 px-3">
                  {(tr.items || []).map((it, idx) => (
                    <div key={idx} className="py-2 flex items-center justify-between">
                      <span className="font-bold text-slate-900">{it.productName}</span>
                      <span className="font-mono font-black text-blue-950 tabular-nums">
                        {it.approvedQty ?? it.requestedQty} {it.unit}
                      </span>
                    </div>
                  ))}
                </div>

                {tr.notes && <p className="text-[11px] text-slate-600">{tr.notes}</p>}

                <button
                  type="button"
                  disabled={confirmingId === tr.id}
                  onClick={() => handleConfirmCustodyDispatch(tr.id, tr.requestNumber)}
                  className="w-full min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {confirmingId === tr.id ? 'جاري التأكيد...' : 'تأكيد استلام العهدة وإضافتها للسيارة'}
                </button>
              </div>
            ))}

            {awaitingCashTransfers.map((ct) => (
              <div
                key={ct.id}
                className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-blue-900 shrink-0" />
                    <span className="font-mono font-black text-blue-950">{ct.transferNumber}</span>
                    <span className="text-slate-500">·</span>
                    <span className="font-bold text-slate-700">عهدة نقدية واردة من الإدارة</span>
                  </div>
                  <strong className="font-mono text-sm font-black text-emerald-700 tabular-nums">
                    {ct.amount.toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
                {ct.notes && <p className="text-[11px] text-slate-600">{ct.notes}</p>}
                <button
                  type="button"
                  disabled={confirmingId === ct.id}
                  onClick={() => handleConfirmIncomingCash(ct.id, ct.transferNumber)}
                  className="w-full min-h-[44px] rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {confirmingId === ct.id ? 'جاري التأكيد...' : 'تأكيد الاستلام النقدي'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

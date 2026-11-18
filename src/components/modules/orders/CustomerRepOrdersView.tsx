import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  Eye,
  FileText,
  MapPin,
  RefreshCw,
  Search,
  Truck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { CustomerItemOrderRequest } from '../../../types';
import { Modal } from '../../common/Modal';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: 'طلب جديد', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  under_review: { label: 'قيد المراجعة', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  approved: { label: 'معتمد', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rep_assigned: { label: 'مُسند لمندوب', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  out_for_delivery: { label: 'خرج للتوصيل', cls: 'bg-purple-50 text-purple-800 border-purple-200' },
  delivered: { label: 'تم التسليم', cls: 'bg-teal-50 text-teal-800 border-teal-200' },
  invoiced: { label: 'تمت الفوترة', cls: 'bg-slate-100 text-slate-800 border-slate-300' },
  rejected: { label: 'مرفوض', cls: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'ملغي', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  needs_review: { label: 'يحتاج مراجعة', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
};

export const CustomerRepOrdersView: React.FC = () => {
  const {
    customerItemOrders = [],
    representatives,
    warehouses,
    cashboxes,
    settings,
    triggerManualSync,
    reviewCustomerItemOrder,
    approveCustomerItemOrder,
    rejectCustomerItemOrder,
    assignOrderDeliveryRep,
    updateOrderDeliveryStatus,
    recordOrderAdvancePayment,
    convertOrderToInvoice,
  } = useData();
  const { hasPermission } = useAuth();
  const canManageSales = hasPermission('canManageSales');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [requesterFilter, setRequesterFilter] = useState<'all' | 'customer' | 'representative'>('all');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Action sub-modals
  const [rejectModalOrder, setRejectModalOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [assignModalOrder, setAssignModalOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [assignRepId, setAssignRepId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');

  const [advanceModalOrder, setAdvanceModalOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState<number>(0);
  const [advanceCashboxId, setAdvanceCashboxId] = useState<string>(() => cashboxes[0]?.id || 'cb-main');
  const [advanceMethod, setAdvanceMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [advanceNotes, setAdvanceNotes] = useState('');

  const [convertModalOrder, setConvertModalOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [convertWarehouseId, setConvertWarehouseId] = useState<string>(() => warehouses[0]?.id || 'wh-main');
  const [convertCashboxId, setConvertCashboxId] = useState<string>(() => cashboxes[0]?.id || 'cb-main');
  const [convertPaid, setConvertPaid] = useState<number>(0);
  const [convertDiscount, setConvertDiscount] = useState<number>(0);
  const [convertPaymentType, setConvertPaymentType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [convertNotes, setConvertNotes] = useState('');

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customerItemOrders
      .filter((o) => {
        if (statusFilter !== 'all' && o.status !== statusFilter) return false;
        const reqType = o.requesterType || (o.representativeId ? 'representative' : 'customer');
        if (requesterFilter !== 'all' && reqType !== requesterFilter) return false;
        if (!q) return true;
        return [
          o.requestNumber,
          o.customerName,
          o.shopName,
          o.customerPhone,
          o.submittedByName,
          o.representativeName,
          o.deliveryRepName,
        ]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(q));
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [customerItemOrders, search, statusFilter, requesterFilter]);

  const selectedOrder = useMemo(
    () => customerItemOrders.find((o) => o.id === selectedOrderId) || null,
    [customerItemOrders, selectedOrderId]
  );

  const stats = useMemo(() => {
    return {
      pending: customerItemOrders.filter((o) => o.status === 'pending').length,
      inProgress: customerItemOrders.filter((o) => ['under_review', 'approved'].includes(o.status)).length,
      delivery: customerItemOrders.filter((o) => ['rep_assigned', 'out_for_delivery'].includes(o.status)).length,
      done: customerItemOrders.filter((o) => ['delivered', 'invoiced'].includes(o.status)).length,
    };
  }, [customerItemOrders]);

  const runAction = async (fn: () => Promise<{ success: boolean; error?: string }>, okText: string) => {
    setBusy(true);
    setFeedback(null);
    const res = await fn();
    setBusy(false);
    if (res.success) {
      setFeedback({ type: 'ok', text: okText });
    } else {
      setFeedback({ type: 'err', text: res.error || 'تعذر تنفيذ العملية' });
    }
    return res.success;
  };

  const getOrderTotal = (ord: CustomerItemOrderRequest) => {
    if (Number(ord.totalAmount || 0) > 0) return Number(ord.totalAmount);
    if (Number(ord.totalEstimatedAmount || 0) > 0) return Number(ord.totalEstimatedAmount);
    return (ord.items || []).reduce(
      (s, it) => s + Number(it.unitPrice ?? 0) * Number(it.quantity || 0),
      0
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">طلبات العملاء والمندوبين</h1>
          <p className="text-xs text-slate-500">
            مراجعة واعتماد طلبات الأصناف، إسناد مناديب التوصيل، الدفعات المقدمة، والتحويل لفواتير مبيعات
          </p>
        </div>
        <button
          type="button"
          onClick={() => triggerManualSync()}
          className="px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>تحديث الطلبات</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-bold ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-xs">
          <p className="text-xs text-amber-800 font-bold flex items-center gap-1.5">
            <Clock className="w-4 h-4" /> طلبات جديدة
          </p>
          <p className="text-2xl font-black text-amber-950 mt-1 font-mono">{stats.pending}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-blue-200 shadow-xs">
          <p className="text-xs text-blue-800 font-bold flex items-center gap-1.5">
            <ClipboardList className="w-4 h-4" /> مراجعة واعتماد
          </p>
          <p className="text-2xl font-black text-blue-950 mt-1 font-mono">{stats.inProgress}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-indigo-200 shadow-xs">
          <p className="text-xs text-indigo-800 font-bold flex items-center gap-1.5">
            <Truck className="w-4 h-4" /> قيد التوصيل
          </p>
          <p className="text-2xl font-black text-indigo-950 mt-1 font-mono">{stats.delivery}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-xs">
          <p className="text-xs text-emerald-800 font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> مسلمة / مفوترة
          </p>
          <p className="text-2xl font-black text-emerald-950 mt-1 font-mono">{stats.done}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3 text-xs">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث برقم الطلب، العميل، المحل، أو المندوب..."
            className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 outline-hidden focus:border-blue-700"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="py-2 px-3 rounded-xl border border-slate-300 font-bold bg-slate-50"
        >
          <option value="all">كل الحالات</option>
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
        <select
          value={requesterFilter}
          onChange={(e) => setRequesterFilter(e.target.value as any)}
          className="py-2 px-3 rounded-xl border border-slate-300 font-bold bg-slate-50"
        >
          <option value="all">كل المصادر</option>
          <option value="customer">طلبات العملاء</option>
          <option value="representative">طلبات المناديب</option>
        </select>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden awlad-table-scroll">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
              <th className="p-3">رقم الطلب</th>
              <th className="p-3">العميل / المحل</th>
              <th className="p-3">المصدر</th>
              <th className="p-3 text-center">الأصناف</th>
              <th className="p-3 text-center">الإجمالي</th>
              <th className="p-3 text-center">المدفوع مقدماً</th>
              <th className="p-3 text-center">الحالة</th>
              <th className="p-3 text-center">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-400">
                  لا توجد طلبات مطابقة لخيارات البحث الحالية.
                </td>
              </tr>
            ) : (
              filteredOrders.map((ord) => {
                const statusInfo = STATUS_META[ord.status] || {
                  label: ord.status,
                  cls: 'bg-slate-100 text-slate-700 border-slate-200',
                };
                const total = getOrderTotal(ord);
                const advance = Number(ord.advancePaidAmount || 0);
                const isRepReq = ord.requesterType === 'representative' || Boolean(ord.representativeId);

                return (
                  <tr key={ord.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-mono font-bold text-slate-900">
                      <div>{ord.requestNumber}</div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(ord.createdAt).toLocaleDateString('ar-EG')}
                      </div>
                    </td>
                    <td className="p-3">
                      <p className="font-bold text-slate-900">{ord.customerName}</p>
                      {(ord.shopName || ord.customerPhone) && (
                        <p className="text-[11px] text-slate-500">
                          {[ord.shopName, ord.customerPhone].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="p-3">
                      <span className="text-[11px] font-bold text-slate-700">
                        {isRepReq ? `مندوب: ${ord.representativeName || ord.submittedByName || ''}` : 'تطبيق العميل'}
                      </span>
                    </td>
                    <td className="p-3 text-center font-mono font-bold">{ord.items?.length || 0}</td>
                    <td className="p-3 text-center font-mono font-black text-blue-950">
                      {total.toLocaleString()} {settings.currency}
                    </td>
                    <td className="p-3 text-center font-mono font-bold text-emerald-700">
                      {advance > 0 ? `${advance.toLocaleString()} ${settings.currency}` : '-'}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-lg border text-[11px] font-bold ${statusInfo.cls}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setSelectedOrderId(ord.id)}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                          title="عرض التفاصيل"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {canManageSales && ord.status === 'pending' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              runAction(() => reviewCustomerItemOrder(ord.id), 'تم بدء مراجعة الطلب')
                            }
                            className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold cursor-pointer"
                          >
                            مراجعة
                          </button>
                        )}

                        {canManageSales && ['pending', 'under_review'].includes(ord.status) && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                runAction(() => approveCustomerItemOrder(ord.id), 'تم اعتماد الطلب')
                              }
                              className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                            >
                              اعتماد
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setRejectModalOrder(ord);
                                setRejectReason('');
                              }}
                              className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-bold cursor-pointer"
                            >
                              رفض
                            </button>
                          </>
                        )}

                        {canManageSales &&
                          ['approved', 'rep_assigned', 'out_for_delivery', 'delivered'].includes(ord.status) && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setAssignModalOrder(ord);
                                  setAssignRepId(ord.deliveryRepId || representatives[0]?.id || '');
                                  setAssignNotes('');
                                }}
                                className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 cursor-pointer"
                                title="تعيين مندوب توصيل"
                              >
                                <UserCheck className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAdvanceModalOrder(ord);
                                  setAdvanceAmount(0);
                                  setAdvanceCashboxId(cashboxes[0]?.id || 'cb-main');
                                  setAdvanceNotes('');
                                }}
                                className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer"
                                title="تسجيل دفعة مقدمة"
                              >
                                <DollarSign className="w-4 h-4" />
                              </button>
                              {!ord.invoiceId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConvertModalOrder(ord);
                                    setConvertWarehouseId(warehouses[0]?.id || 'wh-main');
                                    setConvertCashboxId(cashboxes[0]?.id || 'cb-main');
                                    setConvertPaid(0);
                                    setConvertDiscount(0);
                                    setConvertPaymentType('cash');
                                    setConvertNotes(ord.notes || '');
                                  }}
                                  className="px-2 py-1 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  <span>تحويل لفاتورة</span>
                                </button>
                              )}
                            </>
                          )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Order Detail Modal */}
      <Modal
        isOpen={Boolean(selectedOrder)}
        onClose={() => setSelectedOrderId(null)}
        title={selectedOrder ? `تفاصيل الطلب ${selectedOrder.requestNumber}` : ''}
        subtitle={selectedOrder ? `${selectedOrder.customerName} · ${STATUS_META[selectedOrder.status]?.label || selectedOrder.status}` : ''}
        maxWidth="4xl"
      >
        {selectedOrder && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <div>
                <p className="text-slate-500">العميل:</p>
                <p className="font-bold text-slate-900">{selectedOrder.customerName}</p>
                {selectedOrder.shopName && <p className="text-slate-600">{selectedOrder.shopName}</p>}
                {selectedOrder.customerPhone && <p className="font-mono text-slate-600">{selectedOrder.customerPhone}</p>}
              </div>
              <div>
                <p className="text-slate-500">التوصيل والملاحظات:</p>
                <p className="font-bold text-slate-800">{selectedOrder.deliveryAddress || 'غير محدد'}</p>
                {selectedOrder.geoCoordinates && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(selectedOrder.geoCoordinates)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-700 font-bold mt-1"
                  >
                    <MapPin className="w-3.5 h-3.5" /> عرض الموقع الجغرافي
                  </a>
                )}
                {selectedOrder.deliveryRepName && (
                  <p className="text-indigo-800 font-bold mt-1">مندوب التوصيل: {selectedOrder.deliveryRepName}</p>
                )}
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden awlad-table-scroll">
              <table className="w-full text-right">
                <thead>
                  <tr className="bg-slate-100 border-b text-slate-700 font-bold">
                    <th className="p-2.5">الصنف</th>
                    <th className="p-2.5 text-center">الوحدة</th>
                    <th className="p-2.5 text-center">الكمية</th>
                    <th className="p-2.5 text-center">السعر المرجعي</th>
                    <th className="p-2.5 text-center">الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(selectedOrder.items || []).map((it, idx) => {
                    const price = Number(it.unitPrice ?? 0);
                    return (
                      <tr key={idx}>
                        <td className="p-2.5 font-bold">{it.productName}</td>
                        <td className="p-2.5 text-center">{it.unit}</td>
                        <td className="p-2.5 text-center font-mono font-bold">{it.quantity}</td>
                        <td className="p-2.5 text-center font-mono">
                          {price.toLocaleString()} {settings.currency}
                        </td>
                        <td className="p-2.5 text-center font-mono font-black text-blue-950">
                          {(price * Number(it.quantity || 0)).toLocaleString()} {settings.currency}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedOrder.notes && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
                <strong>ملاحظات:</strong> {selectedOrder.notes}
              </div>
            )}

            {canManageSales &&
              ['rep_assigned', 'out_for_delivery', 'approved'].includes(selectedOrder.status) && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
                  {selectedOrder.status !== 'out_for_delivery' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          () =>
                            updateOrderDeliveryStatus(selectedOrder.id, {
                              status: 'out_for_delivery',
                            }),
                          'تم تحديث الحالة إلى خرج للتوصيل'
                        )
                      }
                      className="px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold cursor-pointer"
                    >
                      بدء التوصيل
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction(
                        () => updateOrderDeliveryStatus(selectedOrder.id, { status: 'delivered' }),
                        'تم تأكيد تسليم الطلب'
                      )
                    }
                    className="px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold cursor-pointer"
                  >
                    تأكيد التسليم
                  </button>
                </div>
              )}
          </div>
        )}
      </Modal>

      {/* Reject Modal */}
      <Modal
        isOpen={Boolean(rejectModalOrder)}
        onClose={() => setRejectModalOrder(null)}
        title="رفض الطلب"
        maxWidth="md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!rejectModalOrder) return;
            const ok = await runAction(
              () => rejectCustomerItemOrder(rejectModalOrder.id, rejectReason.trim() || 'مرفوض من الإدارة'),
              'تم رفض الطلب'
            );
            if (ok) setRejectModalOrder(null);
          }}
          className="space-y-3 text-xs"
        >
          <label className="block font-bold text-slate-700">سبب الرفض:</label>
          <textarea
            required
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full p-2.5 rounded-xl border border-slate-300"
            placeholder="اكتب سبب الرفض ليظهر للعميل أو المندوب..."
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectModalOrder(null)}
              className="px-4 py-2 rounded-xl bg-slate-100 font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold flex items-center gap-1 cursor-pointer"
            >
              <XCircle className="w-4 h-4" /> تأكيد الرفض
            </button>
          </div>
        </form>
      </Modal>

      {/* Assign Delivery Rep Modal */}
      <Modal
        isOpen={Boolean(assignModalOrder)}
        onClose={() => setAssignModalOrder(null)}
        title="إسناد مندوب توصيل"
        maxWidth="md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!assignModalOrder || !assignRepId) return;
            const ok = await runAction(
              () => assignOrderDeliveryRep(assignModalOrder.id, assignRepId, assignNotes),
              'تم إسناد المندوب للتوصيل بنجاح'
            );
            if (ok) setAssignModalOrder(null);
          }}
          className="space-y-3 text-xs"
        >
          <div>
            <label className="block font-bold text-slate-700 mb-1">اختر المندوب:</label>
            <select
              required
              value={assignRepId}
              onChange={(e) => setAssignRepId(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold"
            >
              <option value="">-- اختر مندوباً --</option>
              {representatives.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">ملاحظات التوصيل:</label>
            <input
              type="text"
              value={assignNotes}
              onChange={(e) => setAssignNotes(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAssignModalOrder(null)}
              className="px-4 py-2 rounded-xl bg-slate-100 font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={busy || !assignRepId}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold cursor-pointer"
            >
              حفظ الإسناد
            </button>
          </div>
        </form>
      </Modal>

      {/* Advance Payment Modal */}
      <Modal
        isOpen={Boolean(advanceModalOrder)}
        onClose={() => setAdvanceModalOrder(null)}
        title="تسجيل دفعة مقدمة على الطلب"
        maxWidth="md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!advanceModalOrder || advanceAmount <= 0) return;
            const ok = await runAction(
              () =>
                recordOrderAdvancePayment(advanceModalOrder.id, {
                  amount: advanceAmount,
                  cashboxId: advanceCashboxId,
                  paymentMethod: advanceMethod,
                  notes: advanceNotes,
                }),
              'تم تسجيل الدفعة المقدمة بنجاح'
            );
            if (ok) setAdvanceModalOrder(null);
          }}
          className="space-y-3 text-xs"
        >
          <div>
            <label className="block font-bold text-slate-700 mb-1">المبلغ ({settings.currency}):</label>
            <input
              type="number"
              min={0.01}
              step="0.01"
              required
              value={advanceAmount}
              onChange={(e) => setAdvanceAmount(Number(e.target.value))}
              className="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-1">الخزينة:</label>
              <select
                value={advanceCashboxId}
                onChange={(e) => setAdvanceCashboxId(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold"
              >
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">الطريقة:</label>
              <select
                value={advanceMethod}
                onChange={(e) => setAdvanceMethod(e.target.value as any)}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold"
              >
                <option value="cash">نقدي</option>
                <option value="bank">تحويل بنكي</option>
                <option value="cheque">شيك</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">ملاحظات:</label>
            <input
              type="text"
              value={advanceNotes}
              onChange={(e) => setAdvanceNotes(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdvanceModalOrder(null)}
              className="px-4 py-2 rounded-xl bg-slate-100 font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={busy || advanceAmount <= 0}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer"
            >
              تسجيل الدفعة
            </button>
          </div>
        </form>
      </Modal>

      {/* Convert Order to Sales Invoice Modal */}
      <Modal
        isOpen={Boolean(convertModalOrder)}
        onClose={() => setConvertModalOrder(null)}
        title={convertModalOrder ? `تحويل الطلب ${convertModalOrder.requestNumber} إلى فاتورة` : ''}
        maxWidth="md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!convertModalOrder) return;
            const ok = await runAction(
              () =>
                convertOrderToInvoice(convertModalOrder.id, {
                  warehouseId: convertWarehouseId,
                  cashboxId: convertCashboxId,
                  paymentType: convertPaymentType,
                  paidAtInvoice: convertPaid,
                  discountTotal: convertDiscount,
                  notes: convertNotes,
                }),
              'تم تحويل الطلب إلى فاتورة مبيعات معتمدة بنجاح'
            );
            if (ok) setConvertModalOrder(null);
          }}
          className="space-y-3 text-xs"
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-1">مستودع الصرف:</label>
              <select
                value={convertWarehouseId}
                onChange={(e) => setConvertWarehouseId(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">الخزينة:</label>
              <select
                value={convertCashboxId}
                onChange={(e) => setConvertCashboxId(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold"
              >
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-1">نوع الدفع:</label>
              <select
                value={convertPaymentType}
                onChange={(e) => setConvertPaymentType(e.target.value as any)}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold"
              >
                <option value="cash">نقدي</option>
                <option value="partial">جزئي</option>
                <option value="credit">آجل</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">المدفوع عند الفاتورة:</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={convertPaid}
                onChange={(e) => setConvertPaid(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">الخصم:</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={convertDiscount}
                onChange={(e) => setConvertDiscount(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-bold"
              />
            </div>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">ملاحظات الفاتورة:</label>
            <input
              type="text"
              value={convertNotes}
              onChange={(e) => setConvertNotes(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConvertModalOrder(null)}
              className="px-4 py-2 rounded-xl bg-slate-100 font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-blue-900 text-white font-bold cursor-pointer"
            >
              اعتماد وتحويل لفاتورة
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

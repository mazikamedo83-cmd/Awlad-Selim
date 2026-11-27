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
  Truck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDate, formatLocaleNumber } from '../../../i18n/translator';
import { CustomerItemOrderRequest } from '../../../types';
import { Modal } from '../../common/Modal';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

const STATUS_META: Record<string, { labelAr: string; labelEn: string; cls: string }> = {
  pending: { labelAr: 'طلب جديد', labelEn: 'New Request', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  under_review: { labelAr: 'قيد المراجعة', labelEn: 'Under Review', cls: 'bg-[#EEF3FA] text-[#011E58] border-[#DCE6F5]' },
  approved: { labelAr: 'معتمد', labelEn: 'Approved', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  invoiced: { labelAr: 'تمت الفوترة', labelEn: 'Invoiced', cls: 'bg-[#DCE6F5] text-[#011E58] border-[#B8CAE8]' },
  preparing: { labelAr: 'قيد التجهيز', labelEn: 'Preparing', cls: 'bg-[#EEF3FA] text-[#003589] border-[#B8CAE8]' },
  rep_assigned: { labelAr: 'مُسند لمندوب', labelEn: 'Assigned to Rep', cls: 'bg-[#DCE6F5] text-[#002160] border-[#B8CAE8]' },
  out_for_delivery: { labelAr: 'خرج للتوصيل', labelEn: 'Out for Delivery', cls: 'bg-[#003589]/10 text-[#003589] border-[#003589]/30' },
  delivered: { labelAr: 'تم التسليم', labelEn: 'Delivered', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  collected: { labelAr: 'تم التحصيل', labelEn: 'Collected', cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  closed: { labelAr: 'مغلق', labelEn: 'Closed', cls: 'bg-slate-200 text-slate-900 border-slate-300' },
  rejected: { labelAr: 'مرفوض', labelEn: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { labelAr: 'ملغي', labelEn: 'Cancelled', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  needs_review: { labelAr: 'يحتاج مراجعة', labelEn: 'Needs Review', cls: 'bg-amber-50 text-amber-900 border-amber-300' },
};

export const CustomerRepOrdersView: React.FC = () => {
  const {
    customerItemOrders = [],
    representatives,
    warehouses,
    cashboxes,
    settings,
    refreshData,
    reviewCustomerItemOrder,
    approveCustomerItemOrder,
    rejectCustomerItemOrder,
    assignOrderDeliveryRep,
    advanceOrderStage,
    recordOrderAdvancePayment,
    convertOrderToInvoice,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const { t, locale, isRtl } = usePreferences();
  const canManageSales = hasPermission('canManageSales');
  const hasTreasuryAccess =
    currentUser?.role === 'admin' ||
    hasPermission('canManageCashboxes') ||
    hasPermission('canManageAccounts');

  const defaultCashboxId = (cashboxes.find((cb) => cb.isDefault) || cashboxes[0])?.id || 'cb-main';

  const getStatusLabel = (status: string) => {
    const meta = STATUS_META[status];
    if (!meta) return t(status);
    return isRtl ? meta.labelAr : meta.labelEn;
  };

  const getStatusCls = (status: string) => {
    return STATUS_META[status]?.cls || 'bg-slate-100 text-slate-700 border-slate-200';
  };

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
  const [advanceCashboxId, setAdvanceCashboxId] = useState<string>(() => defaultCashboxId);
  const [advanceMethod, setAdvanceMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [advanceNotes, setAdvanceNotes] = useState('');

  const [collectStageOrder, setCollectStageOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [collectAmount, setCollectAmount] = useState<number>(0);
  const [collectCashboxId, setCollectCashboxId] = useState<string>(() => defaultCashboxId);
  const [collectMethod, setCollectMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [collectNotes, setCollectNotes] = useState('');

  const [convertModalOrder, setConvertModalOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [convertWarehouseId, setConvertWarehouseId] = useState<string>(() => warehouses[0]?.id || 'wh-main');
  const [convertCashboxId, setConvertCashboxId] = useState<string>(() => defaultCashboxId);
  const [convertPaid, setConvertPaid] = useState<number>(0);
  const [convertDiscount, setConvertDiscount] = useState<number>(0);
  const [convertPaymentType, setConvertPaymentType] = useState<'cash' | 'credit' | 'partial'>(() =>
    hasTreasuryAccess ? 'cash' : 'credit'
  );
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
      inProgress: customerItemOrders.filter((o) => ['under_review', 'approved', 'invoiced'].includes(o.status)).length,
      delivery: customerItemOrders.filter((o) => ['preparing', 'rep_assigned', 'out_for_delivery'].includes(o.status)).length,
      done: customerItemOrders.filter((o) => ['delivered', 'collected', 'closed'].includes(o.status)).length,
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
      setFeedback({ type: 'err', text: res.error ? t(res.error) : t('تعذر تنفيذ العملية', 'Failed to execute action') });
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
    <div className="space-y-2">
      <div className="bg-white px-2.5 py-2 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-black text-slate-900">{t('طلبات العملاء والمندوبين', 'Customer & Representative Orders')}</h1>
          <p className="text-[11px] text-slate-500">
            {t(
              'مراجعة واعتماد طلبات الأصناف، إسناد مناديب التوصيل، الدفعات المقدمة، والتحويل لفواتير مبيعات',
              'Review and approve item orders, assign delivery reps, record advance payments, and convert to sales invoices'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refreshData()}
          className="px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t('تحديث الطلبات', 'Refresh Orders')}</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`px-2.5 py-1.5 rounded-md border text-xs font-bold ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Compact Summary Ledger Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden">
        <div className="bg-white px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-amber-800 font-bold flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {t('طلبات جديدة', 'New Requests')}
          </span>
          <span className="text-sm font-black text-amber-950 font-mono tabular-nums">{stats.pending}</span>
        </div>
        <div className="bg-white px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-blue-800 font-bold flex items-center gap-1">
            <ClipboardList className="w-3.5 h-3.5" /> {t('مراجعة واعتماد', 'Review & Approval')}
          </span>
          <span className="text-sm font-black text-blue-950 font-mono tabular-nums">{stats.inProgress}</span>
        </div>
        <div className="bg-white px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-[#003589] font-bold flex items-center gap-1">
            <Truck className="w-3.5 h-3.5" /> {t('قيد التوصيل', 'In Delivery')}
          </span>
          <span className="text-sm font-black text-[#011E58] font-mono tabular-nums">{stats.delivery}</span>
        </div>
        <div className="bg-white px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-emerald-800 font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> {t('مسلمة / مفوترة', 'Delivered / Invoiced')}
          </span>
          <span className="text-sm font-black text-emerald-950 font-mono tabular-nums">{stats.done}</span>
        </div>
      </div>

      {/* Unified Orders Table */}
      <UnifiedDataTable<CustomerItemOrderRequest>
        compact
        title={t(`سجل طلبات العملاء والمندوبين (${filteredOrders.length})`, `Customer & Rep Orders Log (${filteredOrders.length})`)}
        data={filteredOrders}
        rowKey={(ord) => ord.id}
        onRowClick={(ord) => setSelectedOrderId(ord.id)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('بحث برقم الطلب، العميل، المحل، أو المندوب...', 'Search by order #, customer, shop, or rep...')}
        exportFilename="AWLAD_SELIM_Orders"
        pdfTitle={t('طلبات العملاء والمندوبين', 'Customer & Representative Orders')}
        emptyTitle={t('لا توجد طلبات مطابقة لخيارات البحث الحالية', 'No orders match the current filters')}
        emptySubtitle={t('جرّب تغيير فلاتر الحالة أو المصدر.', 'Try changing the status or source filters.')}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 shrink-0 px-2 rounded-md border border-slate-300 font-bold bg-white text-xs"
            >
              <option value="all">{t('كل الحالات', 'All Statuses')}</option>
              {Object.entries(STATUS_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {isRtl ? meta.labelAr : meta.labelEn}
                </option>
              ))}
            </select>
            <select
              value={requesterFilter}
              onChange={(e) => setRequesterFilter(e.target.value as any)}
              className="h-8 shrink-0 px-2 rounded-md border border-slate-300 font-bold bg-white text-xs"
            >
              <option value="all">{t('كل المصادر', 'All Sources')}</option>
              <option value="customer">{t('طلبات العملاء', 'Customer Orders')}</option>
              <option value="representative">{t('طلبات المناديب', 'Representative Orders')}</option>
            </select>
          </div>
        }
        columns={[
          {
            key: 'requestNumber',
            header: t('رقم الطلب', 'Order #'),
            sortValue: (o) => o.createdAt,
            exportValue: (o) => o.requestNumber,
            render: (ord) => (
              <div className="font-mono font-bold text-slate-900">
                <div>{ord.requestNumber}</div>
                <div className="text-[10px] text-slate-400 tabular-nums">
                  {formatLocaleDate(ord.createdAt)}
                </div>
              </div>
            ),
          },
          {
            key: 'customerName',
            header: t('العميل / المحل', 'Customer / Shop'),
            sortValue: (o) => o.customerName,
            exportValue: (o) => o.customerName,
            render: (ord) => (
              <div>
                <p className="font-bold text-slate-900">{ord.customerName}</p>
                {(ord.shopName || ord.customerPhone) && (
                  <p className="text-[11px] text-slate-500">
                    {[ord.shopName, ord.customerPhone].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            ),
          },
          {
            key: 'source',
            header: t('المصدر', 'Source'),
            sortValue: (o) =>
              o.requesterType === 'representative' || Boolean(o.representativeId)
                ? o.representativeName || o.submittedByName || ''
                : t('تطبيق العميل', 'Customer App'),
            exportValue: (o) =>
              o.requesterType === 'representative' || Boolean(o.representativeId)
                ? `${t('مندوب:', 'Rep:')} ${o.representativeName || o.submittedByName || ''}`
                : t('تطبيق العميل', 'Customer App'),
            render: (ord) => {
              const isRepReq = ord.requesterType === 'representative' || Boolean(ord.representativeId);
              return (
                <span className="text-[11px] font-bold text-slate-700">
                  {isRepReq
                    ? `${t('مندوب:', 'Rep:')} ${ord.representativeName || ord.submittedByName || ''}`
                    : t('تطبيق العميل', 'Customer App')}
                </span>
              );
            },
          },
          {
            key: 'itemsCount',
            header: t('الأصناف', 'Items'),
            align: 'center',
            sortValue: (o) => o.items?.length || 0,
            exportValue: (o) => o.items?.length || 0,
            render: (ord) => <span className="font-mono tabular-nums font-bold">{ord.items?.length || 0}</span>,
          },
          {
            key: 'total',
            header: t('الإجمالي', 'Total'),
            align: 'center',
            sortValue: (o) => o.invoiceTotal ?? getOrderTotal(o),
            exportValue: (o) => o.invoiceTotal ?? getOrderTotal(o),
            render: (ord) => {
              const total = getOrderTotal(ord);
              return (
                <div className="font-mono font-black text-blue-950 tabular-nums">
                  <div>
                    {formatLocaleNumber(ord.invoiceTotal ?? total)} {t(settings.currency)}
                  </div>
                  {ord.invoiceNumber && (
                    <div className="text-[10px] font-normal text-blue-700">
                      {t('فاتورة:', 'Invoice:')} {ord.invoiceNumber}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            key: 'advance',
            header: t('المدفوع مقدماً', 'Advance Paid'),
            align: 'center',
            sortValue: (o) => Number(o.invoicePaidAmount ?? o.advancePaidAmount ?? 0),
            exportValue: (o) => Number(o.invoicePaidAmount ?? o.advancePaidAmount ?? 0),
            render: (ord) => {
              const advance = Number(ord.advancePaidAmount || 0);
              return (
                <div className="font-mono font-bold text-emerald-700 tabular-nums">
                  <div>
                    {(ord.invoicePaidAmount ?? advance) > 0
                      ? `${formatLocaleNumber(ord.invoicePaidAmount ?? advance)} ${t(settings.currency)}`
                      : '—'}
                  </div>
                  {typeof ord.invoiceRemainingAmount === 'number' && ord.invoiceRemainingAmount > 0 && (
                    <div className="text-[10px] text-red-600">
                      {t('متبقي:', 'Remaining:')} {formatLocaleNumber(ord.invoiceRemainingAmount)}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            key: 'status',
            header: t('الحالة', 'Status'),
            align: 'center',
            sortValue: (o) => getStatusLabel(o.status),
            exportValue: (o) => getStatusLabel(o.status),
            render: (ord) => (
              <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold ${getStatusCls(ord.status)}`}>
                {getStatusLabel(ord.status)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: t('الإجراءات', 'Actions'),
            align: 'center',
            sortable: false,
            render: (ord) => (
              <div className="flex items-center justify-center gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSelectedOrderId(ord.id)}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                  title={t('عرض التفاصيل وسجل التحصيلات', 'View details & collection history')}
                >
                  <Eye className="w-4 h-4" />
                </button>

                {canManageSales && ord.status === 'pending' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(() => reviewCustomerItemOrder(ord.id), t('تم بدء مراجعة الطلب', 'Order review started'))}
                    className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold cursor-pointer"
                  >
                    {t('مراجعة', 'Review')}
                  </button>
                )}

                {canManageSales && ['pending', 'under_review'].includes(ord.status) && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runAction(() => approveCustomerItemOrder(ord.id), t('تم اعتماد الطلب', 'Order approved'))}
                      className="px-2 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                    >
                      {t('اعتماد', 'Approve')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRejectModalOrder(ord);
                        setRejectReason('');
                      }}
                      className="px-2 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 font-bold cursor-pointer"
                    >
                      {t('رفض', 'Reject')}
                    </button>
                  </>
                )}

                {canManageSales &&
                  ['approved', 'invoiced', 'preparing', 'rep_assigned', 'out_for_delivery', 'delivered', 'collected'].includes(
                    ord.status
                  ) && (
                    <>
                      {['approved', 'invoiced'].includes(ord.status) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            runAction(() => advanceOrderStage(ord.id, { status: 'preparing' }), t('تم بدء تجهيز الطلب', 'Order preparation started'))
                          }
                          className="px-2 py-1 rounded-md bg-[#0049B0] hover:bg-[#003589] text-white font-bold cursor-pointer"
                        >
                          {t('بدء التجهيز', 'Start Preparing')}
                        </button>
                      )}
                      {['preparing', 'rep_assigned'].includes(ord.status) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            runAction(
                              () => advanceOrderStage(ord.id, { status: 'out_for_delivery' }),
                              t('تم إخراج الطلب للتوصيل', 'Order dispatched for delivery')
                            )
                          }
                          className="px-2 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                        >
                          {t('خروج للتوصيل', 'Out for Delivery')}
                        </button>
                      )}
                      {ord.status === 'out_for_delivery' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            runAction(() => advanceOrderStage(ord.id, { status: 'delivered' }), t('تم تسليم الطلب بنجاح', 'Order marked as delivered'))
                          }
                          className="px-2 py-1 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-bold cursor-pointer"
                        >
                          {t('تم التسليم', 'Mark Delivered')}
                        </button>
                      )}
                      {ord.status === 'delivered' && (
                        <button
                          type="button"
                          onClick={() => {
                            setCollectStageOrder(ord);
                            setCollectAmount(Number(ord.invoiceRemainingAmount ?? ord.remainingAmount ?? 0));
                            setCollectCashboxId(cashboxes[0]?.id || 'cb-main');
                            setCollectMethod('cash');
                            setCollectNotes('');
                          }}
                          className="px-2 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                        >
                          {t('تحصيل الدفعة', 'Collect Payment')}
                        </button>
                      )}
                      {['delivered', 'collected'].includes(ord.status) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            runAction(() => advanceOrderStage(ord.id, { status: 'closed' }), t('تم إغلاق دورة الطلب بنجاح', 'Order cycle closed successfully'))
                          }
                          className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-900 text-white font-bold cursor-pointer"
                        >
                          {t('إغلاق الطلب', 'Close Order')}
                        </button>
                      )}
                      {['approved', 'invoiced', 'preparing', 'rep_assigned', 'out_for_delivery'].includes(ord.status) && (
                        <button
                          type="button"
                          onClick={() => {
                            setAssignModalOrder(ord);
                            setAssignRepId(ord.deliveryRepId || representatives[0]?.id || '');
                            setAssignNotes('');
                          }}
                          className="p-1.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] cursor-pointer"
                          title={t('تعيين مندوب توصيل', 'Assign Delivery Rep')}
                        >
                          <UserCheck className="w-4 h-4" />
                        </button>
                      )}
                      {!ord.invoiceId && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setAdvanceModalOrder(ord);
                              setAdvanceAmount(0);
                              setAdvanceCashboxId(cashboxes[0]?.id || 'cb-main');
                              setAdvanceNotes('');
                            }}
                            className="p-1.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#003589] cursor-pointer"
                            title={t('تسجيل دفعة مقدمة', 'Record Advance Payment')}
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>
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
                            className="px-2 py-1 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>{t('تحويل لفاتورة', 'Convert to Invoice')}</span>
                          </button>
                        </>
                      )}
                    </>
                  )}
              </div>
            ),
          },
        ]}
      />

      {/* Order Detail Modal */}
      <Modal
        isOpen={Boolean(selectedOrder)}
        onClose={() => setSelectedOrderId(null)}
        title={selectedOrder ? t(`تفاصيل الطلب ${selectedOrder.requestNumber}`, `Order Details ${selectedOrder.requestNumber}`) : ''}
        subtitle={selectedOrder ? `${selectedOrder.customerName} · ${getStatusLabel(selectedOrder.status)}` : ''}
        maxWidth="4xl"
      >
        {selectedOrder && (
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 rounded-md bg-slate-50 border border-slate-200">
              <div>
                <p className="text-slate-500">{t('العميل:', 'Customer:')}</p>
                <p className="font-bold text-slate-900">{selectedOrder.customerName}</p>
                {selectedOrder.shopName && <p className="text-slate-600">{selectedOrder.shopName}</p>}
                {selectedOrder.customerPhone && <p className="font-mono text-slate-600" dir="ltr">{selectedOrder.customerPhone}</p>}
              </div>
              <div>
                <p className="text-slate-500">{t('التوصيل والملاحظات:', 'Delivery & Notes:')}</p>
                <p className="font-bold text-slate-800">{selectedOrder.deliveryAddress || t('غير محدد', 'Not specified')}</p>
                {selectedOrder.geoCoordinates && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(selectedOrder.geoCoordinates)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[#003589] hover:text-[#0049B0] font-bold mt-1"
                  >
                    <MapPin className="w-3.5 h-3.5" /> {t('عرض الموقع الجغرافي', 'View Location on Map')}
                  </a>
                )}
                {selectedOrder.deliveryRepName && (
                  <p className="text-[#011E58] font-bold mt-1">
                    {t('مندوب التوصيل:', 'Delivery Rep:')} {selectedOrder.deliveryRepName}
                  </p>
                )}
              </div>
            </div>

            <UnifiedDataTable<(typeof selectedOrder.items)[number]>
              compact
              searchable={false}
              data={selectedOrder.items || []}
              rowKey={(it, idx) => `${it.productId || it.productName}-${idx}`}
              maxHeightClassName="max-h-72"
              columns={[
                {
                  key: 'productName',
                  header: t('الصنف', 'Item'),
                  render: (it) => <span className="font-bold text-slate-900">{it.productName}</span>,
                },
                {
                  key: 'unit',
                  header: t('الوحدة', 'Unit'),
                  align: 'center',
                  render: (it) => <span>{t(it.unit)}</span>,
                },
                {
                  key: 'quantity',
                  header: t('الكمية', 'Qty'),
                  align: 'center',
                  render: (it) => <span className="font-mono tabular-nums font-bold">{it.quantity}</span>,
                },
                {
                  key: 'unitPrice',
                  header: t('السعر المرجعي', 'Ref. Price'),
                  align: 'center',
                  render: (it) => (
                    <span className="font-mono tabular-nums">
                      {formatLocaleNumber(Number(it.unitPrice ?? 0))} {t(settings.currency)}
                    </span>
                  ),
                },
                {
                  key: 'total',
                  header: t('الإجمالي', 'Total'),
                  align: 'center',
                  render: (it) => (
                    <span className="font-mono tabular-nums font-black text-blue-950">
                      {formatLocaleNumber(Number(it.unitPrice ?? 0) * Number(it.quantity || 0))} {t(settings.currency)}
                    </span>
                  ),
                },
              ]}
            />

            {selectedOrder.notes && (
              <div className="px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900">
                <strong>{t('ملاحظات:', 'Notes:')}</strong> {selectedOrder.notes}
              </div>
            )}

            {/* Linked Invoice Payment Summary & History */}
            {(selectedOrder.invoiceId || (selectedOrder.paymentsHistory && selectedOrder.paymentsHistory.length > 0)) && (
              <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black text-slate-900">
                    {t('ملخص سداد الفاتورة', 'Invoice Payment Summary')} {selectedOrder.invoiceNumber ? `(${selectedOrder.invoiceNumber})` : ''}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                    selectedOrder.paymentStatus === 'paid'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : selectedOrder.paymentStatus === 'partial'
                      ? 'bg-blue-50 text-blue-800 border-blue-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}>
                    {selectedOrder.paymentStatus === 'paid'
                      ? t('مسدد بالكامل', 'Fully Paid')
                      : selectedOrder.paymentStatus === 'partial'
                      ? t('مدفوع جزئياً', 'Partially Paid')
                      : t('غير مسدد', 'Unpaid')}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-px text-center bg-slate-200 rounded-md overflow-hidden border border-slate-200 tabular-nums">
                  <div className="bg-white px-2 py-1.5">
                    <span className="block text-[10px] text-slate-500">{t('إجمالي الفاتورة', 'Invoice Total')}</span>
                    <strong className="font-mono text-slate-900">{formatLocaleNumber(Number(selectedOrder.invoiceTotal ?? getOrderTotal(selectedOrder)))} {t(settings.currency)}</strong>
                  </div>
                  <div className="bg-white px-2 py-1.5">
                    <span className="block text-[10px] text-slate-500">{t('المدفوع', 'Paid')}</span>
                    <strong className="font-mono text-emerald-700">{formatLocaleNumber(Number(selectedOrder.invoicePaidAmount ?? selectedOrder.advancePaidAmount ?? 0))} {t(settings.currency)}</strong>
                  </div>
                  <div className="bg-white px-2 py-1.5">
                    <span className="block text-[10px] text-slate-500">{t('المتبقي', 'Remaining')}</span>
                    <strong className="font-mono text-red-600">{formatLocaleNumber(Number(selectedOrder.invoiceRemainingAmount ?? selectedOrder.remainingAmount ?? 0))} {t(settings.currency)}</strong>
                  </div>
                </div>
                {selectedOrder.paymentsHistory && selectedOrder.paymentsHistory.length > 0 && (
                  <UnifiedDataTable<NonNullable<CustomerItemOrderRequest['paymentsHistory']>[number]>
                    compact
                    searchable={false}
                    data={selectedOrder.paymentsHistory}
                    rowKey={(ph) => ph.id}
                    maxHeightClassName="max-h-60"
                    columns={[
                      {
                        key: 'paymentNumber',
                        header: t('رقم الدفعة', 'Payment #'),
                        render: (ph) => <span className="font-mono">{ph.paymentNumber}</span>,
                      },
                      {
                        key: 'date',
                        header: t('التاريخ', 'Date'),
                        render: (ph) => <span className="font-mono tabular-nums">{ph.date}</span>,
                      },
                      {
                        key: 'amount',
                        header: t('المبلغ', 'Amount'),
                        align: 'center',
                        render: (ph) => (
                          <span className="font-mono font-bold text-emerald-700 tabular-nums">
                            {formatLocaleNumber(ph.amount)} {t(settings.currency)}
                          </span>
                        ),
                      },
                      {
                        key: 'method',
                        header: t('الخزينة / الطريقة', 'Cashbox / Method'),
                        render: (ph) => <span>{ph.cashboxName || t(ph.paymentMethod)}</span>,
                      },
                      {
                        key: 'notes',
                        header: t('ملاحظات', 'Notes'),
                        render: (ph) => <span className="text-slate-500">{ph.notes || '—'}</span>,
                      },
                    ]}
                  />
                )}
              </div>
            )}

            {canManageSales &&
              ['approved', 'invoiced', 'preparing', 'rep_assigned', 'out_for_delivery', 'delivered', 'collected'].includes(selectedOrder.status) && (
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-200">
                  {['approved', 'invoiced'].includes(selectedOrder.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          () => advanceOrderStage(selectedOrder.id, { status: 'preparing' }),
                          t('تم تحديث الحالة إلى قيد التجهيز', 'Status updated to preparing')
                        )
                      }
                      className="h-8 px-2.5 rounded-md bg-[#0049B0] hover:bg-[#003589] text-white font-bold cursor-pointer"
                    >
                      {t('بدء التجهيز', 'Start Preparing')}
                    </button>
                  )}
                  {['preparing', 'rep_assigned', 'approved'].includes(selectedOrder.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          () => advanceOrderStage(selectedOrder.id, { status: 'out_for_delivery' }),
                          t('تم تحديث الحالة إلى خرج للتوصيل', 'Status updated to out for delivery')
                        )
                      }
                      className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                    >
                      {t('خروج للتوصيل', 'Out for Delivery')}
                    </button>
                  )}
                  {['out_for_delivery', 'rep_assigned'].includes(selectedOrder.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          () => advanceOrderStage(selectedOrder.id, { status: 'delivered' }),
                          t('تم تأكيد تسليم الطلب', 'Order delivery confirmed')
                        )
                      }
                      className="h-8 px-2.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-bold cursor-pointer"
                    >
                      {t('تم التسليم', 'Mark Delivered')}
                    </button>
                  )}
                  {selectedOrder.status === 'delivered' && (
                    <button
                      type="button"
                      onClick={() => {
                        setCollectStageOrder(selectedOrder);
                        setCollectAmount(Number(selectedOrder.invoiceRemainingAmount ?? selectedOrder.remainingAmount ?? 0));
                        setCollectCashboxId(cashboxes[0]?.id || 'cb-main');
                        setCollectMethod('cash');
                        setCollectNotes('');
                      }}
                      className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                    >
                      {t('تحصيل الدفعة', 'Collect Payment')}
                    </button>
                  )}
                  {['delivered', 'collected'].includes(selectedOrder.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          () => advanceOrderStage(selectedOrder.id, { status: 'closed' }),
                          t('تم إغلاق الطلب', 'Order closed')
                        )
                      }
                      className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-black text-white font-bold cursor-pointer"
                    >
                      {t('إغلاق الطلب', 'Close Order')}
                    </button>
                  )}
                </div>
              )}
          </div>
        )}
      </Modal>

      {/* Collect Order Stage Modal */}
      <Modal
        isOpen={Boolean(collectStageOrder)}
        onClose={() => setCollectStageOrder(null)}
        title={collectStageOrder ? t(`تحصيل دفعة للطلب ${collectStageOrder.requestNumber}`, `Collect Payment for Order ${collectStageOrder.requestNumber}`) : ''}
        maxWidth="md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!collectStageOrder) return;
            const ok = await runAction(
              () =>
                advanceOrderStage(collectStageOrder.id, {
                  status: 'collected',
                  collectedAmount: collectAmount,
                  ...(hasTreasuryAccess ? { cashboxId: collectCashboxId } : {}),
                  paymentMethod: collectMethod,
                  notes: collectNotes,
                }),
              t('تم تسجيل التحصيل وتحديث مرحلة الطلب', 'Collection recorded and order stage updated')
            );
            if (ok) setCollectStageOrder(null);
          }}
          className="space-y-2 text-xs"
        >
          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t(`المبلغ المحصل (${t(settings.currency)}):`, `Collected Amount (${t(settings.currency)}):`)}</label>
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={collectAmount || ''}
              onChange={(e) => setCollectAmount(e.target.value === '' ? 0 : Number(e.target.value))}
              className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 font-mono font-bold"
            />
          </div>
          <div className={hasTreasuryAccess ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
            {hasTreasuryAccess && (
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('الخزينة:', 'Cashbox:')}</label>
                <select
                  value={collectCashboxId}
                  onChange={(e) => setCollectCashboxId(e.target.value)}
                  className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 bg-white font-bold"
                >
                  {cashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>{cb.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('طريقة الدفع:', 'Payment Method:')}</label>
              <select
                value={collectMethod}
                onChange={(e) => setCollectMethod(e.target.value as any)}
                className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 bg-white font-bold"
              >
                <option value="cash">{t('نقدي', 'Cash')}</option>
                <option value="bank">{t('تحويل بنكي', 'Bank Transfer')}</option>
                <option value="cheque">{t('شيك', 'Cheque')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات:', 'Notes:')}</label>
            <input
              type="text"
              value={collectNotes}
              onChange={(e) => setCollectNotes(e.target.value)}
              className="w-full h-8 py-1 px-2 rounded-md border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setCollectStageOrder(null)} className="px-2.5 py-1 rounded-md bg-slate-100 font-bold cursor-pointer">
              {t('إلغاء', 'Cancel')}
            </button>
            <button type="submit" disabled={busy} className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer">
              {t('تأكيد التحصيل', 'Confirm Collection')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reject Modal */}
      <Modal
        isOpen={Boolean(rejectModalOrder)}
        onClose={() => setRejectModalOrder(null)}
        title={t('رفض الطلب', 'Reject Order')}
        maxWidth="md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!rejectModalOrder) return;
            const ok = await runAction(
              () => rejectCustomerItemOrder(rejectModalOrder.id, rejectReason.trim() || t('مرفوض من الإدارة', 'Rejected by management')),
              t('تم رفض الطلب', 'Order rejected')
            );
            if (ok) setRejectModalOrder(null);
          }}
          className="space-y-2 text-xs"
        >
          <label className="block font-bold text-slate-700">{t('سبب الرفض:', 'Rejection Reason:')}</label>
          <textarea
            required
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full py-1.5 px-2 rounded-md border border-slate-300"
          />
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={() => setRejectModalOrder(null)}
              className="px-2.5 py-1 rounded-md bg-slate-100 font-bold cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1 rounded-md bg-red-600 text-white font-bold flex items-center gap-1 cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" /> {t('تأكيد الرفض', 'Confirm Rejection')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Assign Delivery Rep Modal */}
      <Modal
        isOpen={Boolean(assignModalOrder)}
        onClose={() => setAssignModalOrder(null)}
        title={t('إسناد مندوب توصيل', 'Assign Delivery Representative')}
        maxWidth="md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!assignModalOrder || !assignRepId) return;
            const ok = await runAction(
              () => assignOrderDeliveryRep(assignModalOrder.id, assignRepId, assignNotes),
              t('تم إسناد المندوب للتوصيل بنجاح', 'Delivery rep assigned successfully')
            );
            if (ok) setAssignModalOrder(null);
          }}
          className="space-y-2 text-xs"
        >
          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('اختر المندوب:', 'Select Representative:')}</label>
            <select
              required
              value={assignRepId}
              onChange={(e) => setAssignRepId(e.target.value)}
              className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 bg-white font-bold"
            >
              <option value="">{t('-- اختر مندوباً --', '-- Select Representative --')}</option>
              {representatives.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات التوصيل:', 'Delivery Notes:')}</label>
            <input
              type="text"
              value={assignNotes}
              onChange={(e) => setAssignNotes(e.target.value)}
              className="w-full h-8 py-1 px-2 rounded-md border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={() => setAssignModalOrder(null)}
              className="px-2.5 py-1 rounded-md bg-slate-100 font-bold cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || !assignRepId}
              className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
            >
              {t('حفظ الإسناد', 'Save Assignment')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Advance Payment Modal */}
      <Modal
        isOpen={Boolean(advanceModalOrder)}
        onClose={() => setAdvanceModalOrder(null)}
        title={t('تسجيل دفعة مقدمة على الطلب', 'Record Advance Payment on Order')}
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
                  cashboxId: hasTreasuryAccess ? advanceCashboxId : defaultCashboxId,
                  paymentMethod: advanceMethod,
                  notes: advanceNotes,
                }),
              t('تم تسجيل الدفعة المقدمة بنجاح', 'Advance payment recorded successfully')
            );
            if (ok) setAdvanceModalOrder(null);
          }}
          className="space-y-2 text-xs"
        >
          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t(`المبلغ (${t(settings.currency)}):`, `Amount (${t(settings.currency)}):`)}</label>
            <input
              type="number"
              min={0.01}
              step="0.01"
              required
              value={advanceAmount || ''}
              onChange={(e) => setAdvanceAmount(e.target.value === '' ? 0 : Number(e.target.value))}
              className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 font-mono font-bold"
            />
          </div>
          <div className={hasTreasuryAccess ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
            {hasTreasuryAccess && (
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('الخزينة:', 'Cashbox:')}</label>
                <select
                  value={advanceCashboxId}
                  onChange={(e) => setAdvanceCashboxId(e.target.value)}
                  className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 bg-white font-bold"
                >
                  {cashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('الطريقة:', 'Method:')}</label>
              <select
                value={advanceMethod}
                onChange={(e) => setAdvanceMethod(e.target.value as any)}
                className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 bg-white font-bold"
              >
                <option value="cash">{t('نقدي', 'Cash')}</option>
                <option value="bank">{t('تحويل بنكي', 'Bank Transfer')}</option>
                <option value="cheque">{t('شيك', 'Cheque')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات:', 'Notes:')}</label>
            <input
              type="text"
              value={advanceNotes}
              onChange={(e) => setAdvanceNotes(e.target.value)}
              className="w-full h-8 py-1 px-2 rounded-md border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={() => setAdvanceModalOrder(null)}
              className="px-2.5 py-1 rounded-md bg-slate-100 font-bold cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || advanceAmount <= 0}
              className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
            >
              {t('تسجيل الدفعة', 'Record Payment')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Convert Order to Sales Invoice Modal */}
      <Modal
        isOpen={Boolean(convertModalOrder)}
        onClose={() => setConvertModalOrder(null)}
        title={convertModalOrder ? t(`تحويل الطلب ${convertModalOrder.requestNumber} إلى فاتورة`, `Convert Order ${convertModalOrder.requestNumber} to Invoice`) : ''}
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
                  ...(hasTreasuryAccess
                    ? {
                        cashboxId: convertCashboxId,
                        paymentType: convertPaymentType,
                        paidAtInvoice: convertPaid,
                      }
                    : {
                        paymentType: 'credit',
                        paidAtInvoice: 0,
                      }),
                  discountTotal: convertDiscount,
                  notes: convertNotes,
                }),
              t('تم تحويل الطلب إلى فاتورة مبيعات معتمدة بنجاح', 'Order converted to confirmed sales invoice successfully')
            );
            if (ok) setConvertModalOrder(null);
          }}
          className="space-y-2 text-xs"
        >
          <div className={hasTreasuryAccess ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('مستودع الصرف:', 'Issue Warehouse:')}</label>
              <select
                value={convertWarehouseId}
                onChange={(e) => setConvertWarehouseId(e.target.value)}
                className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 bg-white font-bold"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {t(w.name)}
                  </option>
                ))}
              </select>
            </div>
            {hasTreasuryAccess && (
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('الخزينة:', 'Cashbox:')}</label>
                <select
                  value={convertCashboxId}
                  onChange={(e) => setConvertCashboxId(e.target.value)}
                  className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 bg-white font-bold"
                >
                  {cashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className={hasTreasuryAccess ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-1 gap-2'}>
            {hasTreasuryAccess && (
              <>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('نوع الدفع:', 'Payment Type:')}</label>
                  <select
                    value={convertPaymentType}
                    onChange={(e) => setConvertPaymentType(e.target.value as any)}
                    className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    <option value="cash">{t('نقدي', 'Cash')}</option>
                    <option value="partial">{t('جزئي', 'Partial')}</option>
                    <option value="credit">{t('آجل', 'Credit')}</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('المدفوع عند الفاتورة:', 'Paid at Invoice:')}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={convertPaid || ''}
                    onChange={(e) => setConvertPaid(e.target.value === '' ? 0 : Number(e.target.value))}
                    className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 font-mono font-bold"
                  />
                </div>
              </>
            )}
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('الخصم:', 'Discount:')}</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={convertDiscount || ''}
                onChange={(e) => setConvertDiscount(e.target.value === '' ? 0 : Number(e.target.value))}
                className="w-full h-8 py-1 px-2 rounded-md border border-slate-300 font-mono font-bold"
              />
            </div>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات الفاتورة:', 'Invoice Notes:')}</label>
            <input
              type="text"
              value={convertNotes}
              onChange={(e) => setConvertNotes(e.target.value)}
              className="w-full h-8 py-1 px-2 rounded-md border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={() => setConvertModalOrder(null)}
              className="px-2.5 py-1 rounded-md bg-slate-100 font-bold cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
            >
              {t('اعتماد وتحويل لفاتورة', 'Approve & Convert to Invoice')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};


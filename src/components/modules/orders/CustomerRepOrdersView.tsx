import React, { useMemo, useState } from 'react';
import {
  ShoppingBag,
  Search,
  RefreshCw,
  Check,
  X,
  Clock,
  Eye,
  ShoppingCart,
  Phone,
  MapPin,
  ExternalLink,
  History,
  UserCheck,
  Store,
  UserSquare2,
  Package,
  AlertCircle,
  CheckCircle2,
  Filter,
  Truck,
  Wallet,
  CloudOff,
  CloudCheck,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { CustomerItemOrderRequest, CustomerItemOrderStatus } from '../../../types';
import { Modal } from '../../common/Modal';
import { NewSaleInvoiceModal } from '../sales/NewSaleInvoiceModal';

type FilterStatus =
  | 'all'
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rep_assigned'
  | 'out_for_delivery'
  | 'delivered'
  | 'needs_review'
  | 'rejected'
  | 'invoiced';
type FilterAccountType = 'all' | 'customer' | 'representative';

const STATUS_META: Record<
  CustomerItemOrderStatus,
  { label: string; badgeClass: string }
> = {
  pending: {
    label: 'جديد',
    badgeClass: 'bg-amber-100 text-amber-900 border border-amber-300',
  },
  under_review: {
    label: 'قيد المراجعة',
    badgeClass: 'bg-sky-100 text-sky-900 border border-sky-300',
  },
  approved: {
    label: 'مقبول (بانتظار الفوترة)',
    badgeClass: 'bg-emerald-100 text-emerald-900 border border-emerald-300',
  },
  rep_assigned: {
    label: 'تم تعيين مندوب',
    badgeClass: 'bg-indigo-100 text-indigo-900 border border-indigo-300',
  },
  out_for_delivery: {
    label: 'جاري التوصيل',
    badgeClass: 'bg-purple-100 text-purple-900 border border-purple-300',
  },
  delivered: {
    label: 'تم التسليم',
    badgeClass: 'bg-teal-100 text-teal-900 border border-teal-300',
  },
  needs_review: {
    label: 'يحتاج مراجعة',
    badgeClass: 'bg-rose-100 text-rose-900 border border-rose-300',
  },
  rejected: {
    label: 'مرفوض',
    badgeClass: 'bg-red-100 text-red-900 border border-red-300',
  },
  invoiced: {
    label: 'تم التحويل لفاتورة',
    badgeClass: 'bg-blue-100 text-blue-950 border border-blue-300',
  },
  cancelled: {
    label: 'ملغى',
    badgeClass: 'bg-slate-200 text-slate-700 border border-slate-300',
  },
};

export const CustomerRepOrdersView: React.FC = () => {
  const {
    customerItemOrders = [],
    orderAdvancePayments = [],
    products = [],
    representatives = [],
    cashboxes = [],
    cachedMediaMap = {},
    settings,
    reviewCustomerItemOrder,
    approveCustomerItemOrder,
    rejectCustomerItemOrder,
    assignOrderDeliveryRep,
    recordOrderAdvancePayment,
    refreshData,
  } = useData();
  const { currentUser, hasPermission } = useAuth();

  const canActOnOrders =
    currentUser?.role === 'admin' || hasPermission('canManageSales');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [accountTypeFilter, setAccountTypeFilter] = useState<FilterAccountType>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [rejectingOrder, setRejectingOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Assign Delivery Rep Modal
  const [assigningOrder, setAssigningOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [assignRepId, setAssignRepId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);

  // Record Advance Payment Modal
  const [advanceOrder, setAdvanceOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState<number>(0);
  const [advanceCashboxId, setAdvanceCashboxId] = useState<string>(cashboxes[0]?.id || 'CASH-01');
  const [advanceMethod, setAdvanceMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [advanceNotes, setAdvanceNotes] = useState('');
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const [convertingOrder, setConvertingOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const productImageById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) {
      const img = cachedMediaMap[p.id] || p.image;
      if (p.id && img) map.set(p.id, img);
    }
    return map;
  }, [products, cachedMediaMap]);

  const counts = useMemo(() => {
    let pending = 0;
    let underReview = 0;
    let approved = 0;
    let delivery = 0;
    let rejected = 0;
    let invoiced = 0;
    for (const ord of customerItemOrders) {
      if (ord.status === 'pending') pending += 1;
      else if (ord.status === 'under_review') underReview += 1;
      else if (ord.status === 'approved') approved += 1;
      else if (ord.status === 'rep_assigned' || ord.status === 'out_for_delivery' || ord.status === 'delivered') delivery += 1;
      else if (ord.status === 'rejected') rejected += 1;
      else if (ord.status === 'invoiced') invoiced += 1;
    }
    return {
      total: customerItemOrders.length,
      pending,
      underReview,
      approved,
      delivery,
      rejected,
      invoiced,
    };
  }, [customerItemOrders]);

  const getOrderAccountType = (ord: CustomerItemOrderRequest): 'customer' | 'representative' => {
    if (ord.requesterType === 'representative' || ord.representativeId) {
      return 'representative';
    }
    return 'customer';
  };

  const getOrderTotal = (ord: CustomerItemOrderRequest): number => {
    if (typeof ord.totalAmount === 'number' && Number.isFinite(ord.totalAmount) && ord.totalAmount > 0) {
      return ord.totalAmount;
    }
    return (ord.items || []).reduce(
      (sum, it) => sum + Number(it.quantity || 0) * Number(it.unitPrice || 0),
      0
    );
  };

  const filteredOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return [...customerItemOrders]
      .filter((ord) => {
        if (statusFilter !== 'all' && ord.status !== statusFilter) return false;
        const accType = getOrderAccountType(ord);
        if (accountTypeFilter !== 'all' && accType !== accountTypeFilter) return false;

        if (dateFrom) {
          const ordDate = String(ord.createdAt || '').slice(0, 10);
          if (ordDate && ordDate < dateFrom) return false;
        }
        if (dateTo) {
          const ordDate = String(ord.createdAt || '').slice(0, 10);
          if (ordDate && ordDate > dateTo) return false;
        }

        if (q) {
          const hay = [
            ord.requestNumber,
            ord.customerName,
            ord.shopName,
            ord.submittedByName,
            ord.representativeName,
            ord.customerPhone,
            ...(ord.items || []).map((it) => it.productName),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [customerItemOrders, statusFilter, accountTypeFilter, dateFrom, dateTo, searchTerm]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleStartReview = async (ord: CustomerItemOrderRequest) => {
    if (busyOrderId || !canActOnOrders) return;
    setBusyOrderId(ord.id);
    setBanner(null);
    try {
      const res = await reviewCustomerItemOrder(ord.id);
      if (res.success) {
        setBanner({
          type: 'success',
          text: `تم وضع الطلب (${ord.requestNumber}) قيد المراجعة.`,
        });
      } else {
        setBanner({ type: 'error', text: res.error || 'تعذر بدء مراجعة الطلب' });
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleApprove = async (ord: CustomerItemOrderRequest) => {
    if (busyOrderId || !canActOnOrders) return;
    setBusyOrderId(ord.id);
    setBanner(null);
    try {
      const res = await approveCustomerItemOrder(ord.id);
      if (res.success) {
        setBanner({
          type: 'success',
          text: `تم قبول الطلب (${ord.requestNumber}) وتسجيل الاعتماد. لم يتم إنشاء فاتورة تلقائياً — يمكنك الآن استكمال إجراءات التحويل إلى فاتورة من زر «تحويل إلى فاتورة مبيعات».`,
        });
      } else {
        setBanner({ type: 'error', text: res.error || 'تعذر قبول الطلب' });
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleOpenRejectModal = (ord: CustomerItemOrderRequest) => {
    setRejectingOrder(ord);
    setRejectReason('');
    setRejectError(null);
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingOrder || busyOrderId || !canActOnOrders) return;
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setRejectError('يرجى كتابة سبب الرفض ليظهر بوضوح لصاحب الطلب في تطبيق الموبايل.');
      return;
    }
    setBusyOrderId(rejectingOrder.id);
    setRejectError(null);
    try {
      const res = await rejectCustomerItemOrder(rejectingOrder.id, trimmed);
      if (res.success) {
        setBanner({
          type: 'success',
          text: `تم رفض الطلب (${rejectingOrder.requestNumber}) وإرسال سبب الرفض لصاحب الطلب.`,
        });
        setRejectingOrder(null);
        setRejectReason('');
      } else {
        setRejectError(res.error || 'تعذر رفض الطلب');
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleOpenAssignRep = (ord: CustomerItemOrderRequest) => {
    setAssigningOrder(ord);
    setAssignRepId(ord.deliveryRepId || representatives[0]?.id || '');
    setAssignNotes('');
    setAssignError(null);
  };

  const handleConfirmAssignRep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningOrder || busyOrderId || !canActOnOrders) return;
    if (!assignRepId) {
      setAssignError('يرجى اختيار المندوب المكلف بالتوصيل.');
      return;
    }
    setBusyOrderId(assigningOrder.id);
    setAssignError(null);
    try {
      const res = await assignOrderDeliveryRep(assigningOrder.id, assignRepId, assignNotes.trim() || undefined);
      if (res.success) {
        setBanner({
          type: 'success',
          text: `تم تعيين المندوب للطلب (${assigningOrder.requestNumber}) بنجاح.`,
        });
        setAssigningOrder(null);
      } else {
        setAssignError(res.error || 'تعذر تعيين مندوب التوصيل');
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleOpenAdvanceModal = (ord: CustomerItemOrderRequest) => {
    setAdvanceOrder(ord);
    setAdvanceAmount(0);
    setAdvanceCashboxId(cashboxes[0]?.id || 'CASH-01');
    setAdvanceMethod('cash');
    setAdvanceNotes('');
    setAdvanceError(null);
  };

  const handleConfirmAdvancePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advanceOrder || busyOrderId || !canActOnOrders) return;
    if (!advanceAmount || advanceAmount <= 0) {
      setAdvanceError('يرجى إدخال مبلغ الدفعة المقدمة أكبر من صفر.');
      return;
    }
    if (!advanceCashboxId) {
      setAdvanceError('يرجى اختيار الخزينة.');
      return;
    }
    setBusyOrderId(advanceOrder.id);
    setAdvanceError(null);
    try {
      const res = await recordOrderAdvancePayment(advanceOrder.id, {
        amount: Number(advanceAmount),
        cashboxId: advanceCashboxId,
        paymentMethod: advanceMethod,
        notes: advanceNotes.trim() || undefined,
      });
      if (res.success) {
        setBanner({
          type: 'success',
          text: res.queuedOffline
            ? `تم حفظ الدفعة المقدمة (${advanceAmount.toLocaleString()} ${settings.currency}) للطلب ${advanceOrder.requestNumber} محلياً في طابور المزامنة.`
            : `تم تسجيل دفعة مقدمة بقيمة ${advanceAmount.toLocaleString()} ${settings.currency} للطلب (${advanceOrder.requestNumber}) بنجاح دون احتساب إيراد مبيعات قبل الفوترة.`,
        });
        setAdvanceOrder(null);
      } else {
        setAdvanceError(res.error || 'تعذر تسجيل الدفعة المقدمة');
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setAccountTypeFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-5 text-right">
      {/* Header Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-900 text-white flex items-center justify-center shadow-xs">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-slate-900">طلبات العملاء والمندوبين</h2>
                {counts.pending > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-black animate-pulse">
                    {counts.pending} طلب جديد
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                استقبال ومراجعة طلبات الشراء الواردة من تطبيق الموبايل للعملاء والمناديب — قبول الطلب لا ينشئ فاتورة تلقائياً ولا يؤثر على المخزون أو الحسابات إلا عند الاعتماد المنفصل.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-950 border border-blue-200 text-xs font-black cursor-pointer disabled:opacity-60 self-start lg:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>تحديث الطلبات</span>
        </button>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { key: 'all' as FilterStatus, label: 'إجمالي الطلبات', count: counts.total, cls: 'bg-white border-slate-200 text-slate-900' },
          { key: 'pending' as FilterStatus, label: 'جديد', count: counts.pending, cls: 'bg-amber-50 border-amber-200 text-amber-950' },
          { key: 'under_review' as FilterStatus, label: 'قيد المراجعة', count: counts.underReview, cls: 'bg-sky-50 border-sky-200 text-sky-950' },
          { key: 'approved' as FilterStatus, label: 'مقبول', count: counts.approved, cls: 'bg-emerald-50 border-emerald-200 text-emerald-950' },
          { key: 'rep_assigned' as FilterStatus, label: 'مراحل التوصيل', count: counts.delivery, cls: 'bg-indigo-50 border-indigo-200 text-indigo-950' },
          { key: 'invoiced' as FilterStatus, label: 'مفوتر', count: counts.invoiced, cls: 'bg-blue-50 border-blue-200 text-blue-950' },
        ].map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => setStatusFilter(card.key)}
            className={`p-3.5 rounded-2xl border text-right transition-all cursor-pointer ${card.cls} ${
              statusFilter === card.key ? 'ring-2 ring-blue-700 shadow-sm' : 'hover:shadow-xs'
            }`}
          >
            <div className="text-[11px] font-bold opacity-80">{card.label}</div>
            <div className="text-2xl font-black font-mono mt-1">{card.count}</div>
          </button>
        ))}
      </div>

      {/* Status Action Banner */}
      {banner && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="underline cursor-pointer shrink-0"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Search & Filters Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs text-xs">
        <div className="flex items-center gap-2 font-black text-slate-700">
          <Filter className="w-4 h-4 text-blue-900" />
          <span>البحث والتصفية</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث برقم الطلب، اسم العميل/المحل، اسم المندوب، أو الصنف..."
              className="w-full pr-9 pl-3 py-2.5 rounded-xl border border-slate-300 bg-white font-semibold outline-hidden focus:border-blue-600"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
            aria-label="تصفية حسب حالة الطلب"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-bold outline-hidden focus:border-blue-600"
          >
            <option value="all">جميع الحالات</option>
            <option value="pending">جديد</option>
            <option value="under_review">قيد المراجعة</option>
            <option value="approved">مقبول</option>
            <option value="rep_assigned">تم تعيين مندوب</option>
            <option value="out_for_delivery">جاري التوصيل</option>
            <option value="delivered">تم التسليم</option>
            <option value="needs_review">يحتاج مراجعة</option>
            <option value="invoiced">تم التحويل لفاتورة</option>
            <option value="rejected">مرفوض</option>
          </select>

          <select
            value={accountTypeFilter}
            onChange={(e) => setAccountTypeFilter(e.target.value as FilterAccountType)}
            aria-label="تصفية حسب نوع الحساب"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-bold outline-hidden focus:border-blue-600"
          >
            <option value="all">كل أنواع الحسابات (عميل + مندوب)</option>
            <option value="customer">طلبات العملاء فقط</option>
            <option value="representative">طلبات المناديب فقط</option>
          </select>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="من تاريخ"
              className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 font-mono font-bold outline-hidden focus:border-blue-600"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="إلى تاريخ"
              className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 font-mono font-bold outline-hidden focus:border-blue-600"
            />
          </div>
        </div>

        {(searchTerm || statusFilter !== 'all' || accountTypeFilter !== 'all' || dateFrom || dateTo) && (
          <div className="flex items-center justify-between pt-1 text-[11px]">
            <span className="text-slate-500 font-bold">
              عدد النتائج المطابقة: <strong className="text-slate-900">{filteredOrders.length}</strong>
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="text-blue-800 hover:underline font-bold cursor-pointer"
            >
              إعادة ضبط الفلاتر
            </button>
          </div>
        )}
      </div>

      {/* Orders List */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center space-y-2 shadow-2xs">
          <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-black text-slate-700">لا توجد طلبات مطابقة للعرض حالياً</h3>
          <p className="text-xs text-slate-400">
            ستظهر هنا تلقائياً أي طلبات جديدة يرسلها العملاء أو المناديب من تطبيق الموبايل.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const accountType = getOrderAccountType(order);
            const isRepOrder = accountType === 'representative';
            const statusMeta = STATUS_META[order.status] || {
              label: order.status,
              badgeClass: 'bg-slate-100 text-slate-700',
            };
            const orderTotal = getOrderTotal(order);
            const isBusy = busyOrderId === order.id;
            const isExpanded = expandedHistoryId === order.id;

            const mapQuery = order.geoCoordinates?.trim() || order.deliveryAddress?.trim() || '';
            const mapHref =
              mapQuery.startsWith('http://') || mapQuery.startsWith('https://')
                ? mapQuery
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;

            return (
              <article
                key={order.id}
                className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4 text-xs"
              >
                {/* Top Order Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-black text-blue-950 bg-blue-50 border border-blue-200 px-3 py-1 rounded-xl">
                        {order.requestNumber}
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black ${
                          isRepOrder
                            ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                            : 'bg-cyan-100 text-cyan-900 border border-cyan-200'
                        }`}
                      >
                        {isRepOrder ? (
                          <UserSquare2 className="w-3.5 h-3.5" />
                        ) : (
                          <Store className="w-3.5 h-3.5" />
                        )}
                        <span>{isRepOrder ? 'مندوب' : 'عميل'}</span>
                      </span>

                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ${statusMeta.badgeClass}`}>
                        {statusMeta.label}
                      </span>

                      {order.syncStatus && order.syncStatus !== 'synced' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black bg-amber-50 text-amber-800 border border-amber-300">
                          <CloudOff className="w-3 h-3" />
                          <span>محلي بانتظار المزامنة</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <CloudCheck className="w-3 h-3" />
                          <span>معتمد مركزيًا</span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700">
                      <span>
                        <strong>صاحب الطلب:</strong>{' '}
                        <span className="text-slate-900 font-black">
                          {order.submittedByName || (isRepOrder ? order.representativeName : order.customerName) || order.customerName}
                        </span>
                      </span>

                      {isRepOrder && (
                        <span>
                          <strong>العميل المطلوب له الطلب:</strong>{' '}
                          <span className="font-bold text-blue-900">
                            {order.customerName}
                            {order.shopName ? ` (${order.shopName})` : ''}
                          </span>
                        </span>
                      )}

                      {!isRepOrder && order.shopName && (
                        <span>
                          <strong>المحل:</strong> <span className="font-bold">{order.shopName}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-left sm:text-right space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-600 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{new Date(order.createdAt).toLocaleString('ar-EG')}</span>
                    </div>
                    <div className="text-sm font-black text-blue-950 font-mono">
                      إجمالي الطلب: {orderTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {settings.currency}
                    </div>
                    {Number(order.advancePaidAmount || 0) > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono font-black">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                          دفعة مقدمة: {Number(order.advancePaidAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })} {settings.currency}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200">
                          المتبقي: {Math.max(0, orderTotal - Number(order.advancePaidAmount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })} {settings.currency}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Contact & Delivery Snapshot */}
                {(order.customerPhone || order.deliveryAddress) && (
                  <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
                    {order.customerPhone && (
                      <a
                        href={`tel:${order.customerPhone}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold hover:bg-emerald-100"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>{order.customerPhone}</span>
                      </a>
                    )}
                    {order.deliveryAddress && (
                      <a
                        href={mapHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 text-slate-800 border border-slate-200 hover:bg-blue-50"
                      >
                        <MapPin className="w-3.5 h-3.5 text-red-600" />
                        <span>{order.deliveryAddress}</span>
                        <ExternalLink className="w-3 h-3 text-blue-700" />
                      </a>
                    )}
                  </div>
                )}

                {/* Items List with Product Images, Quantities, Prices & Line Totals */}
                <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-50/70">
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-100 text-[11px] font-black text-slate-600 border-b border-slate-200">
                    <div className="col-span-6 sm:col-span-5">الصنف</div>
                    <div className="col-span-2 text-center">الكمية</div>
                    <div className="col-span-2 text-center">السعر</div>
                    <div className="col-span-2 sm:col-span-3 text-left">الإجمالي</div>
                  </div>
                  <div className="divide-y divide-slate-200/70">
                    {(order.items || []).map((it, idx) => {
                      const imgSrc = it.productImage || productImageById.get(it.productId) || '';
                      const unitPrice = Number(it.unitPrice || 0);
                      const lineTotal = Number(it.quantity || 0) * unitPrice;
                      return (
                        <div
                          key={`${it.productId}-${idx}`}
                          className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 bg-white"
                        >
                          <div className="col-span-6 sm:col-span-5 flex items-center gap-2.5 min-w-0">
                            {imgSrc ? (
                              <img
                                src={imgSrc}
                                alt={it.productName}
                                className="w-10 h-10 rounded-xl object-cover border border-slate-200 bg-slate-50 shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-xl border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                                <Package className="w-4 h-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 truncate">{it.productName}</div>
                              <div className="text-[11px] text-slate-500">
                                {it.unit}
                                {it.productCode ? ` · ${it.productCode}` : ''}
                              </div>
                            </div>
                          </div>

                          <div className="col-span-2 text-center font-mono font-black text-slate-800">
                            {it.quantity}
                          </div>

                          <div className="col-span-2 text-center font-mono font-bold text-slate-700">
                            {unitPrice > 0 ? unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                          </div>

                          <div className="col-span-2 sm:col-span-3 text-left font-mono font-black text-blue-950">
                            {lineTotal > 0
                              ? `${lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${settings.currency}`
                              : '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Notes, Reviewer Metadata & Rejection Reason */}
                {order.notes && (
                  <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-950">
                    <strong>الملاحظات:</strong> {order.notes}
                  </div>
                )}

                {order.reviewedBy && (
                  <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
                    <UserCheck className="w-4 h-4 text-blue-800 shrink-0" />
                    <span>
                      <strong>المسؤول عن القرار / المراجعة:</strong> {order.reviewedBy}
                    </span>
                    {order.reviewedAt && (
                      <span className="font-mono text-slate-500">
                        ({new Date(order.reviewedAt).toLocaleString('ar-EG')})
                      </span>
                    )}
                    {order.invoiceNumber && (
                      <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-950 font-mono font-black">
                        فاتورة رقم: {order.invoiceNumber}
                      </span>
                    )}
                  </div>
                )}

                {order.status === 'rejected' && order.rejectionReason && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-900 font-bold">
                    سبب الرفض المرسل لصاحب الطلب: {order.rejectionReason}
                  </div>
                )}

                {/* Delivery Rep & Advance Payments Snapshot */}
                {(order.deliveryRepName || order.deliveryNotes || order.collectedAmount || order.deliveryProof) && (
                  <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-1.5 text-[11px] text-indigo-950">
                    <div className="flex flex-wrap items-center gap-3 font-bold">
                      <span className="inline-flex items-center gap-1">
                        <Truck className="w-3.5 h-3.5 text-indigo-700" />
                        <span>مندوب التوصيل: {order.deliveryRepName || '—'}</span>
                      </span>
                      {order.deliveredAt && (
                        <span className="font-mono text-slate-600">
                          وقت التسليم: {new Date(order.deliveredAt).toLocaleString('ar-EG')}
                        </span>
                      )}
                      {Number(order.collectedAmount || 0) > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 font-mono font-black">
                          محصل عند التسليم: {Number(order.collectedAmount).toLocaleString()} {settings.currency}
                        </span>
                      )}
                    </div>
                    {order.deliveryNotes && <p className="text-slate-700">ملاحظات التسليم: {order.deliveryNotes}</p>}
                    {order.deliveryProof && order.deliveryProof.startsWith('data:image') && (
                      <div className="pt-1">
                        <img
                          src={order.deliveryProof}
                          alt="إثبات التسليم"
                          className="w-24 h-24 rounded-xl object-cover border border-indigo-200 bg-white"
                        />
                      </div>
                    )}
                  </div>
                )}

                {(() => {
                  const orderAdvances = orderAdvancePayments.filter((a) => a.orderId === order.id);
                  if (orderAdvances.length === 0) return null;
                  return (
                    <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1 text-[11px]">
                      <div className="font-black text-emerald-950 flex items-center gap-1.5">
                        <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                        <span>سجل الدفعات المقدمة على هذا الطلب ({orderAdvances.length}):</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {orderAdvances.map((adv) => (
                          <span key={adv.id} className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200 font-mono font-bold text-emerald-900">
                            {adv.paymentNumber} · {adv.amount.toLocaleString()} {settings.currency} ({adv.status === 'applied' ? 'مطبقة على فاتورة' : 'متاحة بالخزينة'})
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Decision, Delivery Rep, Advance Payment & Conversion Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {canActOnOrders && order.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleStartReview(order)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>بدء المراجعة</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleApprove(order)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>قبول الطلب</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleOpenRejectModal(order)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white font-black cursor-pointer disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>رفض الطلب</span>
                        </button>
                      </>
                    )}

                    {canActOnOrders && order.status === 'under_review' && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleApprove(order)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>قبول الطلب</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleOpenRejectModal(order)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white font-black cursor-pointer disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>رفض الطلب</span>
                        </button>
                      </>
                    )}

                    {canActOnOrders &&
                      (order.status === 'pending' ||
                        order.status === 'under_review' ||
                        order.status === 'approved' ||
                        order.status === 'rep_assigned') && (
                        <button
                          type="button"
                          disabled={isBusy || representatives.length === 0}
                          onClick={() => handleOpenAssignRep(order)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          <Truck className="w-3.5 h-3.5" />
                          <span>تعيين مندوب للتوصيل</span>
                        </button>
                      )}

                    {canActOnOrders &&
                      order.status !== 'rejected' &&
                      order.status !== 'cancelled' &&
                      order.status !== 'invoiced' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleOpenAdvanceModal(order)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          <Wallet className="w-3.5 h-3.5" />
                          <span>تسجيل دفعة مقدمة</span>
                        </button>
                      )}

                    {canActOnOrders &&
                      (order.status === 'approved' ||
                        order.status === 'rep_assigned' ||
                        order.status === 'out_for_delivery' ||
                        order.status === 'delivered' ||
                        order.status === 'needs_review') && (
                        <button
                          type="button"
                          onClick={() => setConvertingOrder(order)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-black shadow-xs cursor-pointer"
                        >
                          <ShoppingCart className="w-3.5 h-3.5" />
                          <span>تحويل الطلب إلى فاتورة</span>
                        </button>
                      )}
                  </div>

                  {order.statusHistory && order.statusHistory.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpandedHistoryId(isExpanded ? null : order.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-blue-900 cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>{isExpanded ? 'إخفاء سجل الحالات' : `سجل الحالات (${order.statusHistory.length})`}</span>
                    </button>
                  )}
                </div>

                {isExpanded && order.statusHistory && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-600">
                    {order.statusHistory.map((h) => {
                      const mapped = STATUS_META[h.toStatus as CustomerItemOrderStatus];
                      return (
                        <div key={h.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            <strong>{mapped ? mapped.label : h.toStatus}</strong> — بواسطة: {h.changedByName}
                            {h.reason ? ` (${h.reason})` : ''}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {new Date(h.changedAt).toLocaleString('ar-EG')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectingOrder && (
        <Modal
          isOpen={!!rejectingOrder}
          onClose={() => setRejectingOrder(null)}
          title={`رفض الطلب: ${rejectingOrder.requestNumber}`}
          subtitle={`${rejectingOrder.submittedByName || rejectingOrder.customerName}`}
          maxWidth="md"
        >
          <form onSubmit={handleConfirmReject} className="space-y-4 text-xs">
            {rejectError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
                {rejectError}
              </div>
            )}
            <div>
              <label className="block font-bold text-slate-800 mb-1.5">
                سبب الرفض (سيتم إرساله لصاحب الطلب في تطبيق الموبايل): <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={4}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="مثال: الصنف غير متوفر حالياً بالمستودع، أو يرجى مراجعة الكمية..."
                className="w-full rounded-xl border border-slate-300 p-3 outline-hidden focus:border-red-600"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRejectingOrder(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={busyOrderId === rejectingOrder.id}
                className="px-5 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {busyOrderId === rejectingOrder.id ? 'جاري التنفيذ...' : 'تأكيد الرفض وإرسال السبب'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Assign Delivery Rep Modal */}
      {assigningOrder && (
        <Modal
          isOpen={!!assigningOrder}
          onClose={() => setAssigningOrder(null)}
          title={`تعيين مندوب للتوصيل — ${assigningOrder.requestNumber}`}
          subtitle={assigningOrder.customerName}
          maxWidth="md"
        >
          <form onSubmit={handleConfirmAssignRep} className="space-y-4 text-xs">
            {assignError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
                {assignError}
              </div>
            )}
            <div>
              <label className="block font-bold text-slate-800 mb-1.5">المندوب المكلف بالتوصيل:</label>
              <select
                required
                value={assignRepId}
                onChange={(e) => setAssignRepId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-bold outline-hidden focus:border-indigo-600"
              >
                <option value="">-- اختر المندوب --</option>
                {representatives.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.vehicleNumber ? `(${r.vehicleNumber})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-800 mb-1.5">ملاحظات للمندوب (اختياري):</label>
              <textarea
                rows={3}
                value={assignNotes}
                onChange={(e) => setAssignNotes(e.target.value)}
                placeholder="تعليمات التسليم أو التحصيل..."
                className="w-full rounded-xl border border-slate-300 p-2.5 outline-hidden focus:border-indigo-600"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAssigningOrder(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={busyOrderId === assigningOrder.id}
                className="px-5 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {busyOrderId === assigningOrder.id ? 'جاري التعيين...' : 'تأكيد تعيين المندوب'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Record Order Advance Payment Modal */}
      {advanceOrder && (
        <Modal
          isOpen={!!advanceOrder}
          onClose={() => setAdvanceOrder(null)}
          title={`تسجيل دفعة مقدمة على الطلب — ${advanceOrder.requestNumber}`}
          subtitle={`${advanceOrder.customerName} | إجمالي الطلب: ${getOrderTotal(advanceOrder).toLocaleString()} ${settings.currency}`}
          maxWidth="md"
        >
          <form onSubmit={handleConfirmAdvancePayment} className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 leading-relaxed">
              تسجَّل الدفعة المقدمة كرصيد دائن للعميل وتُودع بالخزينة مباشرة دون احتساب إيراد مبيعات؛ ويتم تطبيقها تلقائياً عند «تحويل الطلب إلى فاتورة».
            </div>
            {advanceError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
                {advanceError}
              </div>
            )}
            <div>
              <label className="block font-bold text-slate-800 mb-1">المبلغ ({settings.currency}):</label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={advanceAmount || ''}
                onChange={(e) => setAdvanceAmount(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-lg font-black text-center font-mono text-emerald-800 outline-hidden focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-800 mb-1">الخزينة:</label>
              <select
                value={advanceCashboxId}
                onChange={(e) => setAdvanceCashboxId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-bold outline-hidden"
              >
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.name} ({cb.currentBalance.toLocaleString()} {settings.currency})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-800 mb-1">طريقة الدفع:</label>
              <div className="grid grid-cols-3 gap-2 font-bold">
                {[
                  { id: 'cash' as const, label: 'نقدي' },
                  { id: 'bank' as const, label: 'تحويل بنكي' },
                  { id: 'cheque' as const, label: 'شيك' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setAdvanceMethod(m.id)}
                    className={`p-2 rounded-xl border cursor-pointer ${
                      advanceMethod === m.id
                        ? 'bg-blue-900 text-white border-blue-900'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block font-bold text-slate-800 mb-1">ملاحظات:</label>
              <input
                type="text"
                value={advanceNotes}
                onChange={(e) => setAdvanceNotes(e.target.value)}
                placeholder="عربون حجز بضاعة / دفعة تحت الحساب..."
                className="w-full rounded-xl border border-slate-300 p-2.5 outline-hidden"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAdvanceOrder(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={busyOrderId === advanceOrder.id}
                className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {busyOrderId === advanceOrder.id ? 'جاري التسجيل...' : 'تأكيد تسجيل الدفعة المقدمة'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Separate Sales Invoice Conversion Modal */}
      <NewSaleInvoiceModal
        isOpen={!!convertingOrder}
        onClose={() => setConvertingOrder(null)}
        sourceOrder={convertingOrder}
        onInvoiceCreated={(_, shouldPrint) => {
          setConvertingOrder(null);
          setBanner({
            type: 'success',
            text: shouldPrint
              ? 'تم تحويل الطلب إلى فاتورة مبيعات مع تطبيق الدفعة المقدمة وقواعد المخزون والحسابات.'
              : 'تم تحويل الطلب إلى فاتورة مبيعات بنجاح.',
          });
        }}
      />
    </div>
  );
};

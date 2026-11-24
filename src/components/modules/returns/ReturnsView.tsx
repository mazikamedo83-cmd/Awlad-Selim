import React, { useState, useMemo, useEffect } from 'react';
import { 
  RotateCcw, Plus, Search, Filter, Printer, Download, Eye, 
  AlertCircle, Check, FileText, XCircle, CheckCircle2, Clock
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { InvoiceReturn, Invoice, PurchaseReturnRequest, SalesReturnRequest } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { QuantityInput } from '../../common/QuantityInput';

export interface ReturnsViewProps {
  initialTypeFilter?: 'all' | 'sales_return' | 'purchase_return';
}

export const ReturnsView: React.FC<ReturnsViewProps> = ({ initialTypeFilter = 'all' }) => {
  const {
    invoiceReturns,
    invoices,
    cashboxes,
    settings,
    createReturn,
    purchaseReturnRequests = [],
    approvePurchaseReturnRequest,
    rejectPurchaseReturnRequest,
    salesReturnRequests = [],
    createSalesReturnRequest,
    approveSalesReturnRequest,
    rejectSalesReturnRequest,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const isRepRole = currentUser?.role === 'representative';
  const canManagePurchaseReturnRequests =
    !isRepRole &&
    currentUser?.role !== 'customer' &&
    (currentUser?.role === 'admin' || hasPermission('canManagePurchases') || hasPermission('canApprove'));
  const canManageSalesReturnRequests =
    !isRepRole &&
    currentUser?.role !== 'customer' &&
    (currentUser?.role === 'admin' ||
      hasPermission('canManageSales') ||
      hasPermission('canApprove') ||
      hasPermission('canManageCashboxes') ||
      hasPermission('canManageAccounts'));
  const canUseTreasuryCashRefund =
    !isRepRole &&
    currentUser?.role !== 'customer' &&
    (currentUser?.role === 'admin' ||
      hasPermission('canManageCashboxes') ||
      hasPermission('canManageAccounts'));

  const [returnTypeFilter, setReturnTypeFilter] = useState<'all' | 'sales_return' | 'purchase_return'>(initialTypeFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  useEffect(() => {
    setReturnTypeFilter(initialTypeFilter);
    if (initialTypeFilter === 'sales_return' || initialTypeFilter === 'purchase_return') {
      setReturnType(initialTypeFilter);
    }
  }, [initialTypeFilter]);

  // Print modal
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // New return form
  const [returnType, setReturnType] = useState<'sales_return' | 'purchase_return'>('sales_return');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [refundType, setRefundType] = useState<'balance' | 'cash'>('balance');
  const [refundCashboxId, setRefundCashboxId] = useState(cashboxes[0]?.id || '');
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Rep Purchase Return Request approval/rejection workflow state
  const [requestBanner, setRequestBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<'pending' | 'all' | 'approved' | 'rejected'>('pending');
  const [approvingReq, setApprovingReq] = useState<PurchaseReturnRequest | null>(null);
  const [approveRefundType, setApproveRefundType] = useState<'balance' | 'cash'>('balance');
  const [approveCashboxId, setApproveCashboxId] = useState(cashboxes[0]?.id || '');
  const [approveNotes, setApproveNotes] = useState('');
  const [approveError, setApproveError] = useState<string | null>(null);
  const [isProcessingReq, setIsProcessingReq] = useState(false);
  const [rejectingReq, setRejectingReq] = useState<PurchaseReturnRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Sales Return Request approval/rejection workflow state
  const [salesReqStatusFilter, setSalesReqStatusFilter] = useState<'pending' | 'all' | 'approved' | 'rejected'>('pending');
  const [approvingSalesReq, setApprovingSalesReq] = useState<SalesReturnRequest | null>(null);
  const [approveSalesRefundType, setApproveSalesRefundType] = useState<'cash' | 'balance'>('cash');
  const [approveSalesCashboxId, setApproveSalesCashboxId] = useState(cashboxes[0]?.id || '');
  const [approveSalesNotes, setApproveSalesNotes] = useState('');
  const [approveSalesError, setApproveSalesError] = useState<string | null>(null);
  const [isProcessingSalesReq, setIsProcessingSalesReq] = useState(false);
  const [rejectingSalesReq, setRejectingSalesReq] = useState<SalesReturnRequest | null>(null);
  const [rejectSalesReason, setRejectSalesReason] = useState('');
  const [rejectSalesError, setRejectSalesError] = useState<string | null>(null);

  useEffect(() => {
    if (!approveCashboxId && cashboxes[0]?.id) {
      setApproveCashboxId(cashboxes[0].id);
    }
    if (!approveSalesCashboxId && cashboxes[0]?.id) {
      setApproveSalesCashboxId(cashboxes[0].id);
    }
  }, [cashboxes, approveCashboxId, approveSalesCashboxId]);

  const pendingPrReqCount = useMemo(
    () => purchaseReturnRequests.filter((r) => r.status === 'pending').length,
    [purchaseReturnRequests]
  );

  const pendingSrReqCount = useMemo(
    () => salesReturnRequests.filter((r) => r.status === 'pending').length,
    [salesReturnRequests]
  );

  const filteredPrRequests = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return purchaseReturnRequests.filter((r) => {
      if (requestStatusFilter !== 'all' && r.status !== requestStatusFilter) return false;
      if (!q) return true;
      return (
        r.requestNumber.toLowerCase().includes(q) ||
        r.originalInvoiceNumber.toLowerCase().includes(q) ||
        r.supplierName.toLowerCase().includes(q) ||
        r.requestedByName.toLowerCase().includes(q)
      );
    });
  }, [purchaseReturnRequests, requestStatusFilter, searchTerm]);

  const filteredSrRequests = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return salesReturnRequests.filter((r) => {
      if (salesReqStatusFilter !== 'all' && r.status !== salesReqStatusFilter) return false;
      if (!q) return true;
      return (
        r.requestNumber.toLowerCase().includes(q) ||
        r.originalInvoiceNumber.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.requestedByName.toLowerCase().includes(q)
      );
    });
  }, [salesReturnRequests, salesReqStatusFilter, searchTerm]);

  const handleOpenApproveReq = (req: PurchaseReturnRequest) => {
    setApprovingReq(req);
    setApproveRefundType(canUseTreasuryCashRefund && req.refundType === 'cash' ? 'cash' : 'balance');
    setApproveCashboxId(req.cashboxId || cashboxes[0]?.id || '');
    setApproveNotes(req.notes || '');
    setApproveError(null);
  };

  const handleConfirmApproveReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingReq || isProcessingReq) return;
    if (approveRefundType === 'cash' && (!canUseTreasuryCashRefund || !approveCashboxId)) {
      setApproveError('يرجى اختيار الخزينة التي سيتم استرداد قيمتها إليها (تتطلب صلاحية الخزائن).');
      return;
    }
    setApproveError(null);
    setIsProcessingReq(true);
    const res = await approvePurchaseReturnRequest(approvingReq.id, {
      refundType: canUseTreasuryCashRefund ? approveRefundType : 'balance',
      cashboxId: canUseTreasuryCashRefund && approveRefundType === 'cash' ? approveCashboxId : undefined,
      notes: approveNotes.trim() || undefined,
    });
    setIsProcessingReq(false);
    if (res.success) {
      setRequestBanner({
        type: 'success',
        text: `تم اعتماد طلب مرتجع المشتريات (${approvingReq.requestNumber}) وإنشاء المرتجع (${res.invoiceReturn?.returnNumber || ''}) وتحديث المخزون وحساب المورد.`,
      });
      setApprovingReq(null);
    } else {
      setApproveError(res.error || 'تعذر اعتماد طلب مرتجع المشتريات');
    }
  };

  const handleConfirmRejectReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingReq || isProcessingReq) return;
    if (!rejectReason.trim()) {
      setRejectError('يرجى كتابة سبب رفض طلب مرتجع المشتريات.');
      return;
    }
    setRejectError(null);
    setIsProcessingReq(true);
    const res = await rejectPurchaseReturnRequest(rejectingReq.id, rejectReason.trim());
    setIsProcessingReq(false);
    if (res.success) {
      setRequestBanner({
        type: 'success',
        text: `تم رفض طلب مرتجع المشتريات (${rejectingReq.requestNumber}) وإبلاغ المندوب بالسبب.`,
      });
      setRejectingReq(null);
      setRejectReason('');
    } else {
      setRejectError(res.error || 'تعذر رفض الطلب');
    }
  };

  const handleOpenApproveSalesReq = (req: SalesReturnRequest) => {
    setApprovingSalesReq(req);
    setApproveSalesRefundType(canUseTreasuryCashRefund && req.refundType === 'cash' ? 'cash' : 'balance');
    setApproveSalesCashboxId(req.cashboxId || cashboxes[0]?.id || '');
    setApproveSalesNotes(req.notes || '');
    setApproveSalesError(null);
  };

  const handleConfirmApproveSalesReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingSalesReq || isProcessingSalesReq) return;
    if (approveSalesRefundType === 'cash' && (!canUseTreasuryCashRefund || !approveSalesCashboxId)) {
      setApproveSalesError('يرجى اختيار الخزينة المصروف منها المبلغ (تتطلب صلاحية الخزائن أو الحسابات).');
      return;
    }
    setApproveSalesError(null);
    setIsProcessingSalesReq(true);
    const res = await approveSalesReturnRequest(approvingSalesReq.id, {
      refundType: canUseTreasuryCashRefund ? approveSalesRefundType : 'balance',
      cashboxId: canUseTreasuryCashRefund && approveSalesRefundType === 'cash' ? approveSalesCashboxId : undefined,
      notes: approveSalesNotes.trim() || undefined,
    });
    setIsProcessingSalesReq(false);
    if (res.success) {
      setRequestBanner({
        type: 'success',
        text: `تم اعتماد طلب مرتجع المبيعات (${approvingSalesReq.requestNumber}) وإنشاء المرتجع (${res.invoiceReturn?.returnNumber || ''}) وتحديث المخزون والحساب.`,
      });
      setApprovingSalesReq(null);
    } else {
      setApproveSalesError(res.error || 'تعذر اعتماد طلب مرتجع المبيعات');
    }
  };

  const handleConfirmRejectSalesReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingSalesReq || isProcessingSalesReq) return;
    if (!rejectSalesReason.trim()) {
      setRejectSalesError('يرجى كتابة سبب رفض طلب مرتجع المبيعات.');
      return;
    }
    setRejectSalesError(null);
    setIsProcessingSalesReq(true);
    const res = await rejectSalesReturnRequest(rejectingSalesReq.id, rejectSalesReason.trim());
    setIsProcessingSalesReq(false);
    if (res.success) {
      setRequestBanner({
        type: 'success',
        text: `تم رفض طلب مرتجع المبيعات (${rejectingSalesReq.requestNumber}) وإبلاغ المندوب بالسبب.`,
      });
      setRejectingSalesReq(null);
      setRejectSalesReason('');
    } else {
      setRejectSalesError(res.error || 'تعذر رفض الطلب');
    }
  };

  // Filter available invoices according to type
  const availableInvoices = useMemo(() => {
    const invType = returnType === 'sales_return' ? 'sales' : 'purchase';
    return invoices.filter(i => i.type === invType && i.status === 'confirmed');
  }, [invoices, returnType]);

  const selectedInvoice = useMemo(() => {
    return invoices.find(i => i.id === selectedInvoiceId);
  }, [invoices, selectedInvoiceId]);

  // When invoice is chosen, initialize quantities to 0
  const handleSelectInvoice = (id: string) => {
    setSelectedInvoiceId(id);
    const inv = invoices.find(i => i.id === id);
    if (inv) {
      const qMap: Record<string, number> = {};
      inv.items.forEach(it => {
        qMap[it.productId] = 0;
      });
      setReturnQuantities(qMap);
    }
  };

  const filteredReturns = useMemo(() => {
    return invoiceReturns.filter(r => {
      const matchType = returnTypeFilter === 'all' ? true : r.type === returnTypeFilter;
      const matchSearch = 
        r.returnNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.originalInvoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.partyName.toLowerCase().includes(searchTerm.toLowerCase());
      return matchType && matchSearch;
    });
  }, [invoiceReturns, returnTypeFilter, searchTerm]);

  // Calculate return grand total
  const calculatedGrandTotal = useMemo(() => {
    if (!selectedInvoice) return 0;
    let total = 0;
    for (const item of selectedInvoice.items) {
      const q = returnQuantities[item.productId] || 0;
      total += q * item.unitPrice;
    }
    return total;
  }, [selectedInvoice, returnQuantities]);

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) {
      setError('يرجى اختيار الفاتورة الأصلية أولاً');
      return;
    }

    const returnItems = selectedInvoice.items
      .filter(item => (returnQuantities[item.productId] || 0) > 0)
      .map(item => {
        const q = returnQuantities[item.productId] || 0;
        return {
          productId: item.productId,
          productName: item.productName,
          unit: item.unit,
          quantity: q,
          unitPrice: item.unitPrice,
          total: q * item.unitPrice,
        };
      });

    if (returnItems.length === 0) {
      setError('يرجى تحديد كمية أكبر من صفر لصنف واحد على الأقل للمرتجع');
      return;
    }

    if (!reason.trim()) {
      setError('يرجى كتابة سبب المرتجع');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    if (isRepRole && returnType === 'sales_return' && refundType === 'cash') {
      const reqRes = await createSalesReturnRequest({
        originalInvoiceId: selectedInvoice.id,
        items: returnItems.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        })),
        refundType: 'cash',
        reason: reason.trim(),
        date: returnDate,
        notes: `طلب مرتجع مبيعات نقدي مرتبط بالفاتورة ${selectedInvoice.invoiceNumber}`,
      });
      setIsSubmitting(false);
      if (reqRes.success) {
        setIsNewModalOpen(false);
        setSelectedInvoiceId('');
        setReturnQuantities({});
        setRequestBanner({
          type: 'success',
          text: reqRes.queuedOffline
            ? 'تم حفظ طلب مرتجع المبيعات النقدي في طابور المزامنة لمراجعة الإدارة والخزينة فور عودة الاتصال.'
            : `تم رفع طلب مرتجع المبيعات النقدي (${reqRes.request?.requestNumber || ''}) للمراجعة دون تعديل رصيد الخزينة حتى الاعتماد.`,
        });
      } else {
        setError(reqRes.error || 'تعذر رفع طلب مرتجع المبيعات النقدي');
      }
      return;
    }

    const effectiveRefundType = canUseTreasuryCashRefund ? refundType : 'balance';
    const effectiveCashboxId =
      canUseTreasuryCashRefund && effectiveRefundType === 'cash' ? refundCashboxId : undefined;

    const res = await createReturn({
      type: returnType,
      originalInvoiceId: selectedInvoice.id,
      originalInvoiceNumber: selectedInvoice.invoiceNumber,
      date: returnDate,
      partyId: selectedInvoice.customerId || selectedInvoice.supplierId || '',
      partyName: selectedInvoice.customerName || selectedInvoice.supplierName || 'عام',
      warehouseId: selectedInvoice.warehouseId,
      warehouseName: selectedInvoice.warehouseName,
      items: returnItems,
      grandTotal: calculatedGrandTotal,
      refundType: effectiveRefundType,
      cashboxId: effectiveCashboxId,
      reason: reason.trim(),
      notes: `مرتجع مرتبط بالفاتورة ${selectedInvoice.invoiceNumber}`,
    });

    setIsSubmitting(false);

    if (res.success) {
      setIsNewModalOpen(false);
      setSelectedInvoiceId('');
      setReturnQuantities({});
    } else {
      setError(res.error || 'تعذر تسجيل المرتجع');
    }
  };

  const handlePrintReturn = (ret: InvoiceReturn) => {
    setPrintData({
      title: ret.type === 'sales_return' ? 'سند مرتجع مبيعات' : 'سند مرتجع مشتريات',
      docNumber: ret.returnNumber,
      docType: ret.type === 'sales_return' ? 'مرتجع مبيعات' : 'مرتجع مشتريات',
      date: ret.date,
      partyName: ret.partyName,
      warehouseName: ret.warehouseName,
      grandTotal: ret.grandTotal,
      paidAmount: ret.refundType === 'cash' ? ret.grandTotal : 0,
      paymentType: ret.refundType === 'cash' ? 'رد نقدي فوري' : 'خصم من رصيد الحساب',
      notes: `الفاتورة الأصلية: ${ret.originalInvoiceNumber} | السبب: ${ret.reason}`,
      items: ret.items.map(it => ({
        name: it.productName,
        unit: it.unit,
        quantity: it.quantity,
        price: it.unitPrice,
        total: it.total,
      })),
    });
    setIsPrintModalOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إدارة مرتجعات المبيعات والمشتريات</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ربط المرتجعات بالفاتورة الأصلية والتحقق من عدم تجاوز الكميات وتعديل المخازن والأرصدة
          </p>
        </div>

        <button
          onClick={() => {
            setSelectedInvoiceId('');
            setReturnQuantities({});
            setIsNewModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-md shadow-blue-900/20 active:scale-95 transition-all cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>إنشاء سند مرتجع جديد</span>
        </button>
      </div>

      {/* Filter and Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex-1 min-w-[240px] relative">
          <input
            type="text"
            placeholder="بحث برقم المرتجع، الفاتورة الأصلية، أو الطرف..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2 pr-9 pl-3 text-xs focus:bg-white focus:border-blue-600 outline-hidden"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setReturnTypeFilter('all')}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
              returnTypeFilter === 'all' ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            الكل
          </button>
          <button
            onClick={() => setReturnTypeFilter('sales_return')}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
              returnTypeFilter === 'sales_return' ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            مرتجع مبيعات
          </button>
          <button
            onClick={() => setReturnTypeFilter('purchase_return')}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
              returnTypeFilter === 'purchase_return' ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            مرتجع مشتريات
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden awlad-table-scroll">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-slate-50 font-bold border-b text-slate-700">
              <th className="p-3.5">رقم المرتجع</th>
              <th className="p-3.5">النوع</th>
              <th className="p-3.5">الفاتورة الأصلية</th>
              <th className="p-3.5">التاريخ</th>
              <th className="p-3.5">العميل / المورد</th>
              <th className="p-3.5">المستودع</th>
              <th className="p-3.5 text-center">القيمة الإجمالية</th>
              <th className="p-3.5">طريقة التسوية</th>
              <th className="p-3.5 text-center">طباعة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredReturns.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-400">
                  لا توجد مرتجعات مسجلة حتى الآن
                </td>
              </tr>
            ) : (
              filteredReturns.map(ret => (
                <tr key={ret.id} className="hover:bg-slate-50">
                  <td className="p-3.5 font-mono font-bold text-blue-900">{ret.returnNumber}</td>
                  <td className="p-3.5">
                    {ret.type === 'sales_return' ? (
                      <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-bold text-[10px]">مرتجع مبيعات</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 font-bold text-[10px]">مرتجع مشتريات</span>
                    )}
                  </td>
                  <td className="p-3.5 font-mono text-slate-700">{ret.originalInvoiceNumber}</td>
                  <td className="p-3.5 font-mono text-slate-600">{ret.date}</td>
                  <td className="p-3.5 font-bold text-slate-800">{ret.partyName}</td>
                  <td className="p-3.5 text-slate-600">{ret.warehouseName}</td>
                  <td className="p-3.5 text-center font-black text-slate-900">{ret.grandTotal.toLocaleString()} {settings.currency}</td>
                  <td className="p-3.5">
                    <span className="text-[11px] font-semibold text-slate-700">
                      {ret.refundType === 'balance' ? 'خصم من الرصيد' : 'رد نقدي من الخزينة'}
                    </span>
                  </td>
                  <td className="p-3.5 text-center">
                    <button
                      onClick={() => handlePrintReturn(ret)}
                      className="p-1.5 text-slate-500 hover:text-blue-900"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Sales Return Requests Approval Queue (for Admin / Sales / Treasury Managers) */}
      {canManageSalesReturnRequests && returnTypeFilter !== 'purchase_return' && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-xs p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-800 shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-slate-900">طلبات مرتجع المبيعات من المناديب</h3>
                  {pendingSrReqCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-mono font-black text-[11px]">
                      {pendingSrReqCount} بانتظار الاعتماد
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  تُسجَّل طلبات المرتجع النقدي المرفوعة من المندوب للمراجعة فقط دون مساس بالخزينة أو المخزون حتى اعتمادها وتحديد الخزينة من المخولين.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'pending' as const, label: `معلق (${pendingSrReqCount})` },
                { id: 'approved' as const, label: 'معتمد' },
                { id: 'rejected' as const, label: 'مرفوض' },
                { id: 'all' as const, label: 'الكل' },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSalesReqStatusFilter(st.id)}
                  className={`px-3 py-1.5 rounded-xl font-bold border cursor-pointer ${
                    salesReqStatusFilter === st.id
                      ? 'bg-amber-900 text-white border-amber-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {filteredSrRequests.length === 0 ? (
            <div className="p-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
              لا توجد طلبات مرتجع مبيعات في هذا التصنيف.
            </div>
          ) : (
            <div className="awlad-table-scroll border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50 font-bold border-b text-slate-700">
                    <th className="p-3">رقم الطلب</th>
                    <th className="p-3">الفاتورة الأصلية</th>
                    <th className="p-3">المندوب / مقدم الطلب</th>
                    <th className="p-3">العميل والمستودع</th>
                    <th className="p-3">الأصناف</th>
                    <th className="p-3 text-center">الإجمالي</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3 text-center">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSrRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50 align-top">
                      <td className="p-3 font-mono font-black text-amber-900">
                        {req.requestNumber}
                        <span className="block text-[10px] text-slate-500 font-normal">{req.date}</span>
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-800">{req.originalInvoiceNumber}</td>
                      <td className="p-3 font-bold text-slate-800">
                        {req.representativeName || req.requestedByName}
                        <span className="block text-[10px] text-slate-500 font-normal">بواسطة: {req.requestedByName}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-slate-800 block">{req.customerName}</span>
                        <span className="text-[10px] text-slate-500">{req.warehouseName}</span>
                      </td>
                      <td className="p-3">
                        <div className="space-y-0.5">
                          {(req.items || []).map((it, i) => (
                            <div key={i} className="text-[11px] text-slate-700">
                              <span className="font-bold">{it.productName}</span> ({it.quantity} {it.unit} × {it.unitPrice})
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">السبب: {req.reason}</p>
                      </td>
                      <td className="p-3 text-center font-mono font-black text-slate-900 whitespace-nowrap">
                        {Number(req.grandTotal || 0).toLocaleString()} {settings.currency}
                        <span className="block text-[10px] text-slate-500 font-normal">
                          {req.refundType === 'cash' ? 'طلب رد نقدي' : 'طلب خصم من الرصيد'}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {req.status === 'pending' && (
                          <span className="px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-900 font-bold text-[10px]">
                            قيد الانتظار
                          </span>
                        )}
                        {req.status === 'approved' && (
                          <div className="space-y-0.5">
                            <span className="px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-900 font-bold text-[10px] inline-block">
                              معتمد
                            </span>
                            {req.approvedReturnNumber && (
                              <span className="block font-mono text-[10px] text-emerald-800">{req.approvedReturnNumber}</span>
                            )}
                          </div>
                        )}
                        {req.status === 'rejected' && (
                          <div className="space-y-0.5">
                            <span className="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-900 font-bold text-[10px] inline-block">
                              مرفوض
                            </span>
                            {req.rejectionReason && (
                              <span className="block text-[10px] text-red-700 max-w-[160px]">{req.rejectionReason}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        {req.status === 'pending' ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenApproveSalesReq(req)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>اعتماد</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingSalesReq(req);
                                setRejectSalesReason('');
                                setRejectSalesError(null);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>رفض</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 font-semibold">
                            {req.reviewedByName || 'تمت المراجعة'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Purchase Return Requests Approval Queue (for Admin / Purchase Managers) */}
      {canManagePurchaseReturnRequests && returnTypeFilter !== 'sales_return' && (
        <div className="bg-white rounded-2xl border border-indigo-200 shadow-xs p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-800 shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-slate-900">طلبات مرتجع المشتريات من المناديب</h3>
                  {pendingPrReqCount > 0 && (
                    <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-300 font-mono font-black text-[11px] tabular-nums">
                      {pendingPrReqCount} بانتظار المراجعة
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  لا يتأثر المخزون أو رصيد المورد أو الخزينة إلا بعد اعتماد الطلب رسمياً من الإدارة أو مسؤول المشتريات.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'pending' as const, label: `معلق (${pendingPrReqCount})` },
                { id: 'approved' as const, label: 'معتمد' },
                { id: 'rejected' as const, label: 'مرفوض' },
                { id: 'all' as const, label: 'الكل' },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setRequestStatusFilter(st.id)}
                  className={`px-3 py-1.5 rounded-xl font-bold border cursor-pointer ${
                    requestStatusFilter === st.id
                      ? 'bg-indigo-900 text-white border-indigo-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {requestBanner && (
            <div
              className={`p-3 rounded-xl border font-bold flex items-center justify-between gap-2 ${
                requestBanner.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <span>{requestBanner.text}</span>
              <button type="button" onClick={() => setRequestBanner(null)} className="underline text-[11px] cursor-pointer">
                إغلاق
              </button>
            </div>
          )}

          {filteredPrRequests.length === 0 ? (
            <div className="p-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
              لا توجد طلبات مرتجع مشتريات في هذا التصنيف.
            </div>
          ) : (
            <div className="awlad-table-scroll border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50 font-bold border-b text-slate-700">
                    <th className="p-3">رقم الطلب</th>
                    <th className="p-3">الفاتورة الأصلية</th>
                    <th className="p-3">المندوب / مقدم الطلب</th>
                    <th className="p-3">المورد والمستودع</th>
                    <th className="p-3">الأصناف</th>
                    <th className="p-3 text-center">الإجمالي</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3 text-center">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPrRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50 align-top">
                      <td className="p-3 font-mono font-black text-indigo-900">
                        {req.requestNumber}
                        <span className="block text-[10px] text-slate-500 font-normal">{req.date}</span>
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-800">{req.originalInvoiceNumber}</td>
                      <td className="p-3 font-bold text-slate-800">
                        {req.representativeName || req.requestedByName}
                        <span className="block text-[10px] text-slate-500 font-normal">بواسطة: {req.requestedByName}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-slate-800 block">{req.supplierName}</span>
                        <span className="text-[10px] text-slate-500">{req.warehouseName}</span>
                      </td>
                      <td className="p-3">
                        <div className="space-y-0.5">
                          {(req.items || []).map((it, i) => (
                            <div key={i} className="text-[11px] text-slate-700">
                              <span className="font-bold">{it.productName}</span> ({it.quantity} {it.unit} × {it.unitPrice})
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">السبب: {req.reason}</p>
                      </td>
                      <td className="p-3 text-center font-mono font-black text-slate-900 whitespace-nowrap">
                        {Number(req.grandTotal || 0).toLocaleString()} {settings.currency}
                        <span className="block text-[10px] text-slate-500 font-normal">
                          {req.refundType === 'cash' ? 'مقترح: نقدي' : 'مقترح: خصم رصيد'}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {req.status === 'pending' && (
                          <span className="px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-900 font-bold text-[10px]">
                            قيد الانتظار
                          </span>
                        )}
                        {req.status === 'approved' && (
                          <div className="space-y-0.5">
                            <span className="px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-900 font-bold text-[10px] inline-block">
                              معتمد
                            </span>
                            {req.approvedReturnNumber && (
                              <span className="block font-mono text-[10px] text-emerald-800">{req.approvedReturnNumber}</span>
                            )}
                          </div>
                        )}
                        {req.status === 'rejected' && (
                          <div className="space-y-0.5">
                            <span className="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-900 font-bold text-[10px] inline-block">
                              مرفوض
                            </span>
                            {req.rejectionReason && (
                              <span className="block text-[10px] text-red-700 max-w-[160px]">{req.rejectionReason}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        {req.status === 'pending' ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenApproveReq(req)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>اعتماد</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingReq(req);
                                setRejectReason('');
                                setRejectError(null);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>رفض</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 font-semibold">
                            {req.reviewedByName || 'تمت المراجعة'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Create Return Modal */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="إنشاء سند مرتجع مرتبط بفاتورة"
        maxWidth="4xl"
      >
        <form onSubmit={handleSubmitReturn} className="space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl font-bold">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">نوع المرتجع:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReturnType('sales_return');
                    setSelectedInvoiceId('');
                  }}
                  className={`p-2 rounded-xl font-bold border transition-all ${
                    returnType === 'sales_return' ? 'bg-blue-900 text-white' : 'bg-slate-50'
                  }`}
                >
                  مرتجع مبيعات من عميل
                </button>
                {!isRepRole && (
                  <button
                    type="button"
                    onClick={() => {
                      setReturnType('purchase_return');
                      setSelectedInvoiceId('');
                    }}
                    className={`p-2 rounded-xl font-bold border transition-all ${
                      returnType === 'purchase_return' ? 'bg-blue-900 text-white' : 'bg-slate-50'
                    }`}
                  >
                    مرتجع مشتريات لمورد
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">تاريخ المرتجع:</label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full border rounded-xl p-2 font-mono font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">اختر الفاتورة الأصلية المراد الإرجاع منها:</label>
            <select
              value={selectedInvoiceId}
              onChange={(e) => handleSelectInvoice(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold bg-white"
            >
              <option value="">-- اختر الفاتورة الأصلية --</option>
              {availableInvoices.map(inv => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} - ({inv.customerName || inv.supplierName}) - الإجمالي: {inv.grandTotal} {settings.currency} بتاريخ {inv.date}
                </option>
              ))}
            </select>
          </div>

          {/* Item Quantities Return Form */}
          {selectedInvoice && (
            <div className="border rounded-xl p-3 bg-slate-50 space-y-2 awlad-table-scroll">
              <h4 className="font-bold text-slate-800">الأصناف المتوفرة بالفاتورة الأصلية للإرجاع:</h4>
              <table className="w-full text-right text-xs bg-white rounded-lg border">
                <thead>
                  <tr className="bg-slate-100 border-b">
                    <th className="p-2">الصنف</th>
                    <th className="p-2 text-center">الوحدة</th>
                    <th className="p-2 text-center">الكمية الأصلية</th>
                    <th className="p-2 text-center">السعر</th>
                    <th className="p-2 text-center w-28">الكمية المرتجعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedInvoice.items.map(it => {
                    const alreadyRet = selectedInvoice.returnedQuantityByItem?.[it.productId] || 0;
                    const maxAllowed = it.quantity - alreadyRet;

                    return (
                      <tr key={it.productId}>
                        <td className="p-2 font-bold">{it.productName}</td>
                        <td className="p-2 text-center">{it.unit}</td>
                        <td className="p-2 text-center font-bold">
                          {it.quantity} {alreadyRet > 0 && <span className="text-red-600 text-[10px] block">تم إرجاع {alreadyRet} سابقاً</span>}
                        </td>
                        <td className="p-2 text-center">{it.unitPrice}</td>
                        <td className="p-2 text-center">
                          <QuantityInput
                            allowDecimals
                            min={0}
                            max={maxAllowed}
                            value={returnQuantities[it.productId] || 0}
                            onChange={(q) =>
                              setReturnQuantities((prev) => ({
                                ...prev,
                                [it.productId]: Math.min(maxAllowed, Math.max(0, q)),
                              }))
                            }
                            ariaLabel={`كمية المرتجع ${it.productName}`}
                            inputClassName="w-20 border rounded-lg p-1 text-center font-mono font-bold outline-hidden focus:border-blue-700"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex justify-between items-center pt-2">
                <span className="font-bold text-slate-700">إجمالي قيمة المرتجع المحتسب:</span>
                <span className="text-sm font-black text-blue-900 font-mono">
                  {calculatedGrandTotal.toFixed(2)} {settings.currency}
                </span>
              </div>
            </div>
          )}

          {/* Refund method */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl">
            <div>
              <label className="block font-bold mb-1">طريقة التسوية المالية:</label>
              <select
                value={canUseTreasuryCashRefund || (isRepRole && returnType === 'sales_return') ? refundType : 'balance'}
                onChange={(e) => setRefundType(e.target.value as 'balance' | 'cash')}
                className="w-full bg-white border rounded-xl p-2 font-bold"
              >
                <option value="balance">تعديل وخصم من رصيد الحساب الآجل</option>
                {(canUseTreasuryCashRefund || (isRepRole && returnType === 'sales_return')) && (
                  <option value="cash">
                    {isRepRole ? 'طلب رد نقدي (يرفع لموافقة الخزينة/الإدارة)' : 'رد نقدي فوري من الخزينة'}
                  </option>
                )}
              </select>
            </div>
            {canUseTreasuryCashRefund && refundType === 'cash' ? (
              <div>
                <label className="block font-bold mb-1">الخزينة المسدد منها:</label>
                <select
                  value={refundCashboxId}
                  onChange={(e) => setRefundCashboxId(e.target.value)}
                  className="w-full bg-white border rounded-xl p-2 font-bold"
                >
                  {cashboxes.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            ) : isRepRole && refundType === 'cash' ? (
              <div className="flex items-center p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
                يُرسل هذا المرتجع كطلب مراجعة للخزينة والإدارة، ولا يتم صرف أو خصم أي مبلغ من أي خزينة إلا بعد الاعتماد.
              </div>
            ) : !canUseTreasuryCashRefund ? (
              <div className="flex items-center p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[11px]">
                الرد النقدي من الخزينة متاح لصلاحية إدارة الخزائن والحسابات فقط.
              </div>
            ) : null}
          </div>

          <div>
            <label className="block font-bold mb-1">سبب المرتجع:</label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border rounded-xl p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsNewModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button type="submit" disabled={isSubmitting || calculatedGrandTotal === 0} className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-950">
              اعتماد المرتجع وتعديل المخزن
            </button>
          </div>
        </form>
      </Modal>

      {/* Approve Purchase Return Request Modal */}
      <Modal
        isOpen={Boolean(approvingReq)}
        onClose={() => !isProcessingReq && setApprovingReq(null)}
        title={approvingReq ? `اعتماد طلب مرتجع مشتريات: ${approvingReq.requestNumber}` : ''}
        subtitle="سيتم إنشاء سند مرتجع مشتريات رسمي وخصم الكميات من المخزن وتحديث حساب المورد/الخزينة."
        maxWidth="md"
      >
        {approvingReq && (
          <form onSubmit={handleConfirmApproveReq} className="space-y-4 text-xs">
            {approveError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{approveError}</div>
            )}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">المورد:</span>
                <strong className="text-slate-900">{approvingReq.supplierName}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">الفاتورة الأصلية:</span>
                <strong className="font-mono text-blue-900">{approvingReq.originalInvoiceNumber}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">الإجمالي:</span>
                <strong className="font-mono text-emerald-800">
                  {Number(approvingReq.grandTotal || 0).toLocaleString()} {settings.currency}
                </strong>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">طريقة التسوية المالية:</label>
              <select
                value={canUseTreasuryCashRefund ? approveRefundType : 'balance'}
                onChange={(e) => setApproveRefundType(e.target.value as 'balance' | 'cash')}
                className="w-full border rounded-xl p-2.5 font-bold bg-white"
              >
                <option value="balance">تعديل وخصم من رصيد حساب المورد</option>
                {canUseTreasuryCashRefund && (
                  <option value="cash">استرداد نقدي إلى الخزينة</option>
                )}
              </select>
            </div>

            {canUseTreasuryCashRefund && approveRefundType === 'cash' && (
              <div>
                <label className="block font-bold mb-1">الخزينة المستلمة للاسترداد النقدي:</label>
                <select
                  value={approveCashboxId}
                  onChange={(e) => setApproveCashboxId(e.target.value)}
                  className="w-full border rounded-xl p-2.5 font-bold bg-white"
                >
                  {cashboxes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">ملاحظات الاعتماد (اختياري):</label>
              <input
                type="text"
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                className="w-full border rounded-xl p-2.5"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingReq}
                onClick={() => setApprovingReq(null)}
                className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isProcessingReq}
                className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-black cursor-pointer disabled:opacity-50"
              >
                {isProcessingReq ? 'جاري الاعتماد...' : 'تأكيد الاعتماد والترحيل'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reject Purchase Return Request Modal */}
      <Modal
        isOpen={Boolean(rejectingReq)}
        onClose={() => !isProcessingReq && setRejectingReq(null)}
        title={rejectingReq ? `رفض طلب مرتجع مشتريات: ${rejectingReq.requestNumber}` : ''}
        maxWidth="md"
      >
        {rejectingReq && (
          <form onSubmit={handleConfirmRejectReq} className="space-y-4 text-xs">
            {rejectError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{rejectError}</div>
            )}
            <div>
              <label className="block font-bold mb-1">سبب الرفض (إلزامي):</label>
              <textarea
                rows={3}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="اكتب سبب رفض طلب مرتجع المشتريات ليظهر للمندوب..."
                className="w-full border rounded-xl p-2.5"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingReq}
                onClick={() => setRejectingReq(null)}
                className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isProcessingReq}
                className="px-5 py-2 bg-red-700 hover:bg-red-800 text-white rounded-xl font-black cursor-pointer disabled:opacity-50"
              >
                {isProcessingReq ? 'جاري الرفض...' : 'تأكيد رفض الطلب'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Approve Sales Return Request Modal */}
      <Modal
        isOpen={Boolean(approvingSalesReq)}
        onClose={() => !isProcessingSalesReq && setApprovingSalesReq(null)}
        title={approvingSalesReq ? `اعتماد طلب مرتجع مبيعات: ${approvingSalesReq.requestNumber}` : ''}
        subtitle="سيتم إنشاء سند مرتجع مبيعات رسمي وإرجاع الكميات للمخزن وتحديث الخزينة أو حساب العميل."
        maxWidth="md"
      >
        {approvingSalesReq && (
          <form onSubmit={handleConfirmApproveSalesReq} className="space-y-4 text-xs">
            {approveSalesError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{approveSalesError}</div>
            )}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">العميل:</span>
                <strong className="text-slate-900">{approvingSalesReq.customerName}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">الفاتورة الأصلية:</span>
                <strong className="font-mono text-blue-900">{approvingSalesReq.originalInvoiceNumber}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">الإجمالي:</span>
                <strong className="font-mono text-emerald-800">
                  {Number(approvingSalesReq.grandTotal || 0).toLocaleString()} {settings.currency}
                </strong>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">طريقة التسوية المالية المعتمدة:</label>
              <select
                value={canUseTreasuryCashRefund ? approveSalesRefundType : 'balance'}
                onChange={(e) => setApproveSalesRefundType(e.target.value as 'cash' | 'balance')}
                className="w-full border rounded-xl p-2.5 font-bold bg-white"
              >
                <option value="balance">تعديل وخصم من رصيد حساب العميل</option>
                {canUseTreasuryCashRefund && (
                  <option value="cash">صرف نقدي من الخزينة</option>
                )}
              </select>
            </div>

            {canUseTreasuryCashRefund && approveSalesRefundType === 'cash' && (
              <div>
                <label className="block font-bold mb-1">الخزينة المصروف منها:</label>
                <select
                  value={approveSalesCashboxId}
                  onChange={(e) => setApproveSalesCashboxId(e.target.value)}
                  className="w-full border rounded-xl p-2.5 font-bold bg-white"
                >
                  {cashboxes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">ملاحظات الاعتماد (اختياري):</label>
              <input
                type="text"
                value={approveSalesNotes}
                onChange={(e) => setApproveSalesNotes(e.target.value)}
                className="w-full border rounded-xl p-2.5"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingSalesReq}
                onClick={() => setApprovingSalesReq(null)}
                className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isProcessingSalesReq}
                className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-black cursor-pointer disabled:opacity-50"
              >
                {isProcessingSalesReq ? 'جاري الاعتماد...' : 'تأكيد الاعتماد والترحيل'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reject Sales Return Request Modal */}
      <Modal
        isOpen={Boolean(rejectingSalesReq)}
        onClose={() => !isProcessingSalesReq && setRejectingSalesReq(null)}
        title={rejectingSalesReq ? `رفض طلب مرتجع مبيعات: ${rejectingSalesReq.requestNumber}` : ''}
        maxWidth="md"
      >
        {rejectingSalesReq && (
          <form onSubmit={handleConfirmRejectSalesReq} className="space-y-4 text-xs">
            {rejectSalesError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{rejectSalesError}</div>
            )}
            <div>
              <label className="block font-bold mb-1">سبب الرفض (إلزامي):</label>
              <textarea
                rows={3}
                required
                value={rejectSalesReason}
                onChange={(e) => setRejectSalesReason(e.target.value)}
                placeholder="اكتب سبب رفض طلب مرتجع المبيعات ليظهر للمندوب..."
                className="w-full border rounded-xl p-2.5"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingSalesReq}
                onClick={() => setRejectingSalesReq(null)}
                className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isProcessingSalesReq}
                className="px-5 py-2 bg-red-700 hover:bg-red-800 text-white rounded-xl font-black cursor-pointer disabled:opacity-50"
              >
                {isProcessingSalesReq ? 'جاري الرفض...' : 'تأكيد رفض الطلب'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Print Document Modal */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />
    </div>
  );
};

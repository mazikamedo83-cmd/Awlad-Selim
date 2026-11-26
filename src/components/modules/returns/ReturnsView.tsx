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
import { EditableItemGrid } from '../../common/EditableItemGrid';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import {
  LinkedGroupCategoryFilter,
  filterProductsByGroupCategory,
} from '../../common/LinkedGroupCategoryFilter';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber, translateSystemEntityName } from '../../../i18n/translator';

export interface ReturnsViewProps {
  initialTypeFilter?: 'all' | 'sales_return' | 'purchase_return';
}

export const ReturnsView: React.FC<ReturnsViewProps> = ({ initialTypeFilter = 'all' }) => {
  const {
    invoiceReturns,
    invoices,
    products,
    warehouses = [],
    productGroups = [],
    categories = [],
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
  const { t, locale } = usePreferences();
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

  // Print & Preview modal
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [previewReturn, setPreviewReturn] = useState<InvoiceReturn | null>(null);
  const [previewSalesRequest, setPreviewSalesRequest] = useState<SalesReturnRequest | null>(null);
  const [previewPurchaseRequest, setPreviewPurchaseRequest] = useState<PurchaseReturnRequest | null>(null);

  // New return form
  const [returnType, setReturnType] = useState<'sales_return' | 'purchase_return'>('sales_return');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [refundType, setRefundType] = useState<'balance' | 'cash'>('balance');
  const [refundCashboxId, setRefundCashboxId] = useState(cashboxes[0]?.id || '');
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number | ''>>({});
  const [returnUnitPrices, setReturnUnitPrices] = useState<Record<string, number>>({});
  const [retGroupFilter, setRetGroupFilter] = useState('all');
  const [retCatFilter, setRetCatFilter] = useState('all');
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
      setApproveError(t('يرجى اختيار الخزينة التي سيتم استرداد قيمتها إليها (تتطلب صلاحية الخزائن).', 'Please select the cashbox to receive the refund (requires cashbox permission).'));
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
        text: t(
          `تم اعتماد طلب مرتجع المشتريات (${approvingReq.requestNumber}) وإنشاء المرتجع (${res.invoiceReturn?.returnNumber || ''}) وتحديث المخزون وحساب المورد.`,
          `Purchase return request (${approvingReq.requestNumber}) approved, return (${res.invoiceReturn?.returnNumber || ''}) created, and inventory & supplier balance updated.`
        ),
      });
      setApprovingReq(null);
    } else {
      setApproveError(res.error ? t(res.error) : t('تعذر اعتماد طلب مرتجع المشتريات', 'Unable to approve purchase return request'));
    }
  };

  const handleConfirmRejectReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingReq || isProcessingReq) return;
    if (!rejectReason.trim()) {
      setRejectError(t('يرجى كتابة سبب رفض طلب مرتجع المشتريات.', 'Please enter a rejection reason for the purchase return request.'));
      return;
    }
    setRejectError(null);
    setIsProcessingReq(true);
    const res = await rejectPurchaseReturnRequest(rejectingReq.id, rejectReason.trim());
    setIsProcessingReq(false);
    if (res.success) {
      setRequestBanner({
        type: 'success',
        text: t(
          `تم رفض طلب مرتجع المشتريات (${rejectingReq.requestNumber}) وإبلاغ المندوب بالسبب.`,
          `Purchase return request (${rejectingReq.requestNumber}) rejected and representative notified.`
        ),
      });
      setRejectingReq(null);
      setRejectReason('');
    } else {
      setRejectError(res.error ? t(res.error) : t('تعذر رفض الطلب', 'Unable to reject request'));
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
      setApproveSalesError(t('يرجى اختيار الخزينة المصروف منها المبلغ (تتطلب صلاحية الخزائن أو الحسابات).', 'Please select the cashbox to disburse from (requires cashbox or accounts permission).'));
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
        text: t(
          `تم اعتماد طلب مرتجع المبيعات (${approvingSalesReq.requestNumber}) وإنشاء المرتجع (${res.invoiceReturn?.returnNumber || ''}) وتحديث المخزون والحساب.`,
          `Sales return request (${approvingSalesReq.requestNumber}) approved, return (${res.invoiceReturn?.returnNumber || ''}) created, and inventory & account updated.`
        ),
      });
      setApprovingSalesReq(null);
    } else {
      setApproveSalesError(res.error ? t(res.error) : t('تعذر اعتماد طلب مرتجع المبيعات', 'Unable to approve sales return request'));
    }
  };

  const handleConfirmRejectSalesReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingSalesReq || isProcessingSalesReq) return;
    if (!rejectSalesReason.trim()) {
      setRejectSalesError(t('يرجى كتابة سبب رفض طلب مرتجع المبيعات.', 'Please enter a rejection reason for the sales return request.'));
      return;
    }
    setRejectSalesError(null);
    setIsProcessingSalesReq(true);
    const res = await rejectSalesReturnRequest(rejectingSalesReq.id, rejectSalesReason.trim());
    setIsProcessingSalesReq(false);
    if (res.success) {
      setRequestBanner({
        type: 'success',
        text: t(
          `تم رفض طلب مرتجع المبيعات (${rejectingSalesReq.requestNumber}) وإبلاغ المندوب بالسبب.`,
          `Sales return request (${rejectingSalesReq.requestNumber}) rejected and representative notified.`
        ),
      });
      setRejectingSalesReq(null);
      setRejectSalesReason('');
    } else {
      setRejectSalesError(res.error ? t(res.error) : t('تعذر رفض الطلب', 'Unable to reject request'));
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

  // When invoice is chosen, leave quantities empty until entered by user
  const handleSelectInvoice = (id: string) => {
    setSelectedInvoiceId(id);
    setRetGroupFilter('all');
    setRetCatFilter('all');
    const inv = invoices.find(i => i.id === id);
    if (inv) {
      const qMap: Record<string, number | ''> = {};
      const pMap: Record<string, number> = {};
      inv.items.forEach(it => {
        qMap[it.productId] = '';
        pMap[it.productId] = Number(it.unitPrice || 0);
      });
      setReturnQuantities(qMap);
      setReturnUnitPrices(pMap);
    } else {
      setReturnUnitPrices({});
    }
  };

  const filteredReturnInvoiceItems = useMemo(() => {
    if (!selectedInvoice) return [];
    const hasFilter = (retGroupFilter && retGroupFilter !== 'all') || (retCatFilter && retCatFilter !== 'all');
    if (!hasFilter) return selectedInvoice.items;
    return selectedInvoice.items.filter((it) => {
      const catalogProd = products.find((p) => p.id === it.productId);
      const syntheticProd: any = catalogProd
        ? {
            ...catalogProd,
            groupId: it.groupId || catalogProd.groupId,
            groupName: it.groupName || catalogProd.groupName,
            categoryId: it.categoryId || catalogProd.categoryId,
            category: it.categoryName || catalogProd.category,
          }
        : {
            id: it.productId,
            name: it.productName,
            groupId: it.groupId,
            groupName: it.groupName,
            categoryId: it.categoryId,
            category: it.categoryName || '',
            baseUnit: it.unit,
            units: [],
            code: '',
            purchasePrice: 0,
            sellingPrice: it.unitPrice,
            minStockLevel: 0,
            stockPerWarehouse: {},
            status: 'active',
          };
      return (
        filterProductsByGroupCategory(
          [syntheticProd],
          productGroups,
          categories,
          retGroupFilter,
          retCatFilter
        ).length > 0
      );
    });
  }, [selectedInvoice, products, productGroups, categories, retGroupFilter, retCatFilter]);

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
      const q = Number(returnQuantities[item.productId] || 0);
      const price = returnUnitPrices[item.productId] ?? item.unitPrice;
      total += q * price;
    }
    return total;
  }, [selectedInvoice, returnQuantities, returnUnitPrices]);

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) {
      setError(t('يرجى اختيار الفاتورة الأصلية أولاً', 'Please select the original invoice first'));
      return;
    }

    const returnItems = selectedInvoice.items
      .filter(item => Number(returnQuantities[item.productId] || 0) > 0)
      .map(item => {
        const q = Number(returnQuantities[item.productId] || 0);
        const price = returnUnitPrices[item.productId] ?? item.unitPrice;
        const catalogProd = products.find((p) => p.id === item.productId);
        return {
          productId: item.productId,
          productName: item.productName,
          groupId: item.groupId || catalogProd?.groupId,
          groupName: item.groupName || catalogProd?.groupName,
          categoryId: item.categoryId || catalogProd?.categoryId,
          categoryName: item.categoryName || catalogProd?.category,
          unit: item.unit,
          quantity: q,
          unitPrice: price,
          total: q * price,
        };
      });

    if (returnItems.length === 0) {
      setError(t('يرجى تحديد كمية أكبر من صفر لصنف واحد على الأقل للمرتجع', 'Please specify a quantity greater than zero for at least one item'));
      return;
    }

    if (!reason.trim()) {
      setError(t('يرجى كتابة سبب المرتجع', 'Please enter a return reason'));
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
        notes: t(`طلب مرتجع مبيعات نقدي مرتبط بالفاتورة ${selectedInvoice.invoiceNumber}`, `Cash sales return request linked to invoice ${selectedInvoice.invoiceNumber}`),
      });
      setIsSubmitting(false);
      if (reqRes.success) {
        setIsNewModalOpen(false);
        setSelectedInvoiceId('');
        setReturnQuantities({});
        setRequestBanner({
          type: 'success',
          text: reqRes.queuedOffline
            ? t('تم حفظ طلب مرتجع المبيعات النقدي في طابور المزامنة لمراجعة الإدارة والخزينة فور عودة الاتصال.', 'Cash sales return request queued offline for management & treasury review once online.')
            : t(`تم رفع طلب مرتجع المبيعات النقدي (${reqRes.request?.requestNumber || ''}) للمراجعة دون تعديل رصيد الخزينة حتى الاعتماد.`, `Cash sales return request (${reqRes.request?.requestNumber || ''}) submitted for review without modifying treasury balance until approved.`),
        });
      } else {
        setError(reqRes.error ? t(reqRes.error) : t('تعذر رفع طلب مرتجع المبيعات النقدي', 'Unable to submit cash sales return request'));
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
      setError(res.error ? t(res.error) : t('تعذر تسجيل المرتجع', 'Unable to record return'));
    }
  };

  const handlePrintReturn = (ret: InvoiceReturn) => {
    setPrintData({
      title: ret.type === 'sales_return' ? t('سند مرتجع مبيعات', 'Sales Return Voucher') : t('سند مرتجع مشتريات', 'Purchase Return Voucher'),
      docNumber: ret.returnNumber,
      docType: ret.type === 'sales_return' ? t('مرتجع مبيعات', 'Sales Return') : t('مرتجع مشتريات', 'Purchase Return'),
      date: ret.date,
      partyName: translateSystemEntityName(ret.partyName),
      warehouseName: translateSystemEntityName(ret.warehouseName),
      grandTotal: ret.grandTotal,
      paidAmount: ret.refundType === 'cash' ? ret.grandTotal : 0,
      paymentType: ret.refundType === 'cash' ? t('رد نقدي فوري', 'Immediate Cash Refund') : t('خصم من رصيد الحساب', 'Deduct from Account Balance'),
      notes: `${t('الفاتورة الأصلية:', 'Original Invoice:')} ${ret.originalInvoiceNumber} | ${t('السبب:', 'Reason:')} ${ret.reason}`,
      items: ret.items.map(it => ({
        name: it.productName,
        unit: t(it.unit),
        quantity: it.quantity,
        price: it.unitPrice,
        total: it.total,
      })),
    });
    setIsPrintModalOpen(true);
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight">{t('إدارة مرتجعات المبيعات والمشتريات', 'Sales & Purchase Returns Management')}</h2>
          <p className="text-[11px] text-slate-500">
            {t('ربط المرتجعات بالفاتورة الأصلية والتحقق من عدم تجاوز الكميات وتعديل المخازن والأرصدة', 'Link returns to original invoices, validate quantities, and update warehouses and balances')}
          </p>
        </div>

        <button
          onClick={() => {
            setSelectedInvoiceId('');
            setReturnQuantities({});
            setIsNewModalOpen(true);
          }}
          className="h-8 flex items-center gap-1.5 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t('إنشاء سند مرتجع جديد', 'Create New Return Voucher')}</span>
        </button>
      </div>

      {/* Unified Returns Table */}
      <UnifiedDataTable<InvoiceReturn>
        compact
        title={t(`سجل مرتجعات المبيعات والمشتريات (${filteredReturns.length})`, `Sales & Purchase Returns Log (${filteredReturns.length})`)}
        data={filteredReturns}
        rowKey={(ret) => ret.id}
        onRowClick={(ret) => setPreviewReturn(ret)}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={t('بحث برقم المرتجع، الفاتورة الأصلية، أو الطرف...', 'Search by return #, original invoice, or party...')}
        exportFilename="AWLAD_SELIM_Returns"
        pdfTitle={t('سجل مرتجعات المبيعات والمشتريات', 'Sales & Purchase Returns Log')}
        emptyTitle={t('لا توجد مرتجعات مسجلة حتى الآن', 'No returns recorded yet')}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setReturnTypeFilter('all')}
              className={`h-8 inline-flex items-center px-2.5 rounded-md text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                returnTypeFilter === 'all' ? 'bg-blue-900 text-white' : 'bg-white border border-slate-300 text-slate-700'
              }`}
            >
              {t('الكل', 'All')}
            </button>
            <button
              type="button"
              onClick={() => setReturnTypeFilter('sales_return')}
              className={`h-8 inline-flex items-center px-2.5 rounded-md text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                returnTypeFilter === 'sales_return' ? 'bg-blue-900 text-white' : 'bg-white border border-slate-300 text-slate-700'
              }`}
            >
              {t('مرتجع مبيعات', 'Sales Return')}
            </button>
            <button
              type="button"
              onClick={() => setReturnTypeFilter('purchase_return')}
              className={`h-8 inline-flex items-center px-2.5 rounded-md text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                returnTypeFilter === 'purchase_return' ? 'bg-blue-900 text-white' : 'bg-white border border-slate-300 text-slate-700'
              }`}
            >
              {t('مرتجع مشتريات', 'Purchase Return')}
            </button>
          </div>
        }
        columns={[
          {
            key: 'returnNumber',
            header: t('رقم المرتجع', 'Return #'),
            sortValue: (r) => r.returnNumber,
            exportValue: (r) => r.returnNumber,
            render: (r) => <span className="font-mono font-bold text-blue-900">{r.returnNumber}</span>,
          },
          {
            key: 'type',
            header: t('النوع', 'Type'),
            sortValue: (r) => r.type,
            exportValue: (r) => (r.type === 'sales_return' ? t('مرتجع مبيعات', 'Sales Return') : t('مرتجع مشتريات', 'Purchase Return')),
            render: (r) =>
              r.type === 'sales_return' ? (
                <span className="px-2 py-0.5 rounded border border-[#DCE6F5] bg-[#EEF3FA] text-[#011E58] font-bold text-[10px]">
                  {t('مرتجع مبيعات', 'Sales Return')}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded border border-[#B8CAE8] bg-[#DCE6F5] text-[#002160] font-bold text-[10px]">
                  {t('مرتجع مشتريات', 'Purchase Return')}
                </span>
              ),
          },
          {
            key: 'originalInvoiceNumber',
            header: t('الفاتورة الأصلية', 'Original Invoice'),
            sortValue: (r) => r.originalInvoiceNumber,
            exportValue: (r) => r.originalInvoiceNumber,
            render: (r) => <span className="font-mono text-slate-700">{r.originalInvoiceNumber}</span>,
          },
          {
            key: 'date',
            header: t('التاريخ', 'Date'),
            sortValue: (r) => r.date,
            exportValue: (r) => r.date,
            render: (r) => <span className="font-mono tabular-nums text-slate-600">{r.date}</span>,
          },
          {
            key: 'partyName',
            header: t('العميل / المورد', 'Customer / Supplier'),
            sortValue: (r) => r.partyName,
            exportValue: (r) => translateSystemEntityName(r.partyName),
            render: (r) => <span className="font-bold text-slate-800">{translateSystemEntityName(r.partyName)}</span>,
          },
          {
            key: 'warehouseName',
            header: t('المستودع', 'Warehouse'),
            sortValue: (r) => r.warehouseName,
            exportValue: (r) => translateSystemEntityName(r.warehouseName),
            render: (r) => <span className="text-slate-600">{translateSystemEntityName(r.warehouseName)}</span>,
          },
          {
            key: 'grandTotal',
            header: t('القيمة الإجمالية', 'Total Value'),
            align: 'center',
            sortValue: (r) => r.grandTotal,
            exportValue: (r) => r.grandTotal,
            render: (r) => (
              <span className="font-mono tabular-nums font-black text-slate-900">
                {formatLocaleNumber(r.grandTotal)} {t(settings.currency)}
              </span>
            ),
          },
          {
            key: 'refundType',
            header: t('طريقة التسوية', 'Settlement Method'),
            sortValue: (r) => r.refundType,
            exportValue: (r) => (r.refundType === 'balance' ? t('خصم من الرصيد', 'Balance Deduction') : t('رد نقدي من الخزينة', 'Cash Refund from Treasury')),
            render: (r) => (
              <span className="text-[11px] font-semibold text-slate-700">
                {r.refundType === 'balance' ? t('خصم من الرصيد', 'Balance Deduction') : t('رد نقدي من الخزينة', 'Cash Refund from Treasury')}
              </span>
            ),
          },
          {
            key: 'actions',
            header: t('طباعة', 'Print'),
            align: 'center',
            sortable: false,
            render: (r) => (
              <button
                type="button"
                onClick={() => handlePrintReturn(r)}
                className="p-1.5 text-slate-500 hover:text-blue-900 cursor-pointer"
                title={t('طباعة سند المرتجع', 'Print Return Voucher')}
              >
                <Printer className="w-4 h-4" />
              </button>
            ),
          },
        ]}
      />

      {/* Sales Return Requests Approval Queue (for Admin / Sales / Treasury Managers) */}
      {canManageSalesReturnRequests && returnTypeFilter !== 'purchase_return' && (
        <div className="bg-white rounded-lg border border-amber-200 p-2.5 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-800 shrink-0">
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-black text-slate-900">{t('طلبات مرتجع المبيعات من المناديب', 'Sales Return Requests from Representatives')}</h3>
                  {pendingSrReqCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-mono font-black text-[10px]">
                      {pendingSrReqCount} {t('بانتظار الاعتماد', 'Pending Approval')}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  {t('تُسجَّل طلبات المرتجع النقدي المرفوعة من المندوب للمراجعة فقط دون مساس بالخزينة أو المخزون حتى اعتمادها وتحديد الخزينة من المخولين.', 'Cash return requests submitted by representatives are logged for review only without affecting treasury or inventory until approved by authorized staff.')}
                </p>
              </div>
            </div>

            <div className="awlad-filter-row w-auto max-w-full" data-testid="returns-sales-req-filter-row">
              {[
                { id: 'pending' as const, label: `${t('معلق', 'Pending')} (${pendingSrReqCount})` },
                { id: 'approved' as const, label: t('معتمد', 'Approved') },
                { id: 'rejected' as const, label: t('مرفوض', 'Rejected') },
                { id: 'all' as const, label: t('الكل', 'All') },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSalesReqStatusFilter(st.id)}
                  className={`h-8 px-2.5 rounded-md text-xs font-bold border whitespace-nowrap shrink-0 cursor-pointer ${
                    salesReqStatusFilter === st.id
                      ? 'bg-[#011E58] text-white border-[#011E58]'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-[#EEF3FA]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          <UnifiedDataTable<SalesReturnRequest>
            compact
            searchable={false}
            data={filteredSrRequests}
            rowKey={(req) => req.id}
            onRowClick={(req) => setPreviewSalesRequest(req)}
            exportFilename="AWLAD_SELIM_SalesReturnRequests"
            emptyTitle={t('لا توجد طلبات مرتجع مبيعات في هذا التصنيف', 'No sales return requests in this category')}
            columns={[
              {
                key: 'requestNumber',
                header: t('رقم الطلب', 'Request #'),
                sortValue: (r) => r.requestNumber,
                exportValue: (r) => r.requestNumber,
                render: (r) => (
                  <div>
                    <span className="font-mono font-black text-amber-900 block">{r.requestNumber}</span>
                    <span className="text-[10px] font-mono tabular-nums text-slate-500">{r.date}</span>
                  </div>
                ),
              },
              {
                key: 'originalInvoiceNumber',
                header: t('الفاتورة الأصلية', 'Original Invoice'),
                sortValue: (r) => r.originalInvoiceNumber,
                exportValue: (r) => r.originalInvoiceNumber,
                render: (r) => <span className="font-mono font-bold text-slate-800">{r.originalInvoiceNumber}</span>,
              },
              {
                key: 'requestedByName',
                header: t('المندوب / مقدم الطلب', 'Rep / Requester'),
                sortValue: (r) => r.representativeName || r.requestedByName,
                exportValue: (r) => r.representativeName || r.requestedByName,
                render: (r) => (
                  <div>
                    <span className="font-bold text-slate-800 block">{r.representativeName || r.requestedByName}</span>
                    <span className="text-[10px] text-slate-500">{t('بواسطة:', 'By:')} {r.requestedByName}</span>
                  </div>
                ),
              },
              {
                key: 'customerName',
                header: t('العميل والمستودع', 'Customer & Warehouse'),
                sortValue: (r) => r.customerName,
                exportValue: (r) => `${translateSystemEntityName(r.customerName)} (${translateSystemEntityName(r.warehouseName)})`,
                render: (r) => (
                  <div>
                    <span className="font-bold text-slate-800 block">{translateSystemEntityName(r.customerName)}</span>
                    <span className="text-[10px] text-slate-500">{translateSystemEntityName(r.warehouseName)}</span>
                  </div>
                ),
              },
              {
                key: 'items',
                header: t('الأصناف', 'Items'),
                render: (r) => (
                  <div>
                    <div className="space-y-0.5">
                      {(r.items || []).map((it, i) => (
                        <div key={i} className="text-[11px] text-slate-700">
                          <span className="font-bold">{it.productName}</span> ({it.quantity} {t(it.unit)} × {it.unitPrice})
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">{t('السبب:', 'Reason:')} {r.reason}</p>
                  </div>
                ),
              },
              {
                key: 'grandTotal',
                header: t('الإجمالي', 'Total'),
                align: 'center',
                sortValue: (r) => Number(r.grandTotal || 0),
                exportValue: (r) => Number(r.grandTotal || 0),
                render: (r) => (
                  <div className="font-mono tabular-nums font-black text-slate-900 whitespace-nowrap">
                    {formatLocaleNumber(Number(r.grandTotal || 0))} {t(settings.currency)}
                    <span className="block text-[10px] text-slate-500 font-normal">
                      {r.refundType === 'cash' ? t('طلب رد نقدي', 'Cash refund request') : t('طلب خصم من الرصيد', 'Balance deduction request')}
                    </span>
                  </div>
                ),
              },
              {
                key: 'status',
                header: t('الحالة', 'Status'),
                align: 'center',
                sortValue: (r) => r.status,
                exportValue: (r) => (r.status === 'pending' ? t('قيد الانتظار', 'Pending') : r.status === 'approved' ? t('معتمد', 'Approved') : t('مرفوض', 'Rejected')),
                render: (r) =>
                  r.status === 'pending' ? (
                    <span className="px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-900 font-bold text-[10px]">
                      {t('قيد الانتظار', 'Pending')}
                    </span>
                  ) : r.status === 'approved' ? (
                    <div className="space-y-0.5">
                      <span className="px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-900 font-bold text-[10px] inline-block">
                        {t('معتمد', 'Approved')}
                      </span>
                      {r.approvedReturnNumber && (
                        <span className="block font-mono text-[10px] text-emerald-800">{r.approvedReturnNumber}</span>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <span className="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-900 font-bold text-[10px] inline-block">
                        {t('مرفوض', 'Rejected')}
                      </span>
                      {r.rejectionReason && (
                        <span className="block text-[10px] text-red-700 max-w-[160px]">{r.rejectionReason}</span>
                      )}
                    </div>
                  ),
              },
              {
                key: 'actions',
                header: t('الإجراءات', 'Actions'),
                align: 'center',
                sortable: false,
                render: (r) =>
                  r.status === 'pending' ? (
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenApproveSalesReq(r)}
                        className="px-2 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{t('اعتماد', 'Approve')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingSalesReq(r);
                          setRejectSalesReason('');
                          setRejectSalesError(null);
                        }}
                        className="px-2 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{t('رفض', 'Reject')}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-500 font-semibold">{r.reviewedByName || t('تمت المراجعة', 'Reviewed')}</span>
                  ),
              },
            ]}
          />
        </div>
      )}

      {/* Purchase Return Requests Approval Queue (for Admin / Purchase Managers) */}
      {canManagePurchaseReturnRequests && returnTypeFilter !== 'sales_return' && (
        <div className="bg-white rounded-lg border border-[#DCE6F5] p-2.5 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] flex items-center justify-center text-[#011E58] shrink-0">
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-black text-slate-900">{t('طلبات مرتجع المشتريات من المناديب', 'Purchase Return Requests from Representatives')}</h3>
                  {pendingPrReqCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-300 font-mono font-black text-[10px] tabular-nums">
                      {pendingPrReqCount} {t('بانتظار المراجعة', 'Pending Review')}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  {t('لا يتأثر المخزون أو رصيد المورد أو الخزينة إلا بعد اعتماد الطلب رسمياً من الإدارة أو مسؤول المشتريات.', 'Inventory, supplier balance, and treasury are not affected until officially approved by management or purchasing manager.')}
                </p>
              </div>
            </div>

            <div className="awlad-filter-row w-auto max-w-full" data-testid="returns-purchase-req-filter-row">
              {[
                { id: 'pending' as const, label: `${t('معلق', 'Pending')} (${pendingPrReqCount})` },
                { id: 'approved' as const, label: t('معتمد', 'Approved') },
                { id: 'rejected' as const, label: t('مرفوض', 'Rejected') },
                { id: 'all' as const, label: t('الكل', 'All') },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setRequestStatusFilter(st.id)}
                  className={`h-8 px-2.5 rounded-md text-xs font-bold border whitespace-nowrap shrink-0 cursor-pointer ${
                    requestStatusFilter === st.id
                      ? 'bg-[#011E58] text-white border-[#011E58]'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-[#EEF3FA]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {requestBanner && (
            <div
              className={`px-3 py-2 rounded-lg border font-bold flex items-center justify-between gap-2 ${
                requestBanner.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <span>{requestBanner.text}</span>
              <button type="button" onClick={() => setRequestBanner(null)} className="underline text-[11px] cursor-pointer">
                {t('إغلاق', 'Close')}
              </button>
            </div>
          )}

          <UnifiedDataTable<PurchaseReturnRequest>
            compact
            searchable={false}
            data={filteredPrRequests}
            rowKey={(req) => req.id}
            onRowClick={(req) => setPreviewPurchaseRequest(req)}
            exportFilename="AWLAD_SELIM_PurchaseReturnRequests"
            emptyTitle={t('لا توجد طلبات مرتجع مشتريات في هذا التصنيف', 'No purchase return requests in this category')}
            columns={[
              {
                key: 'requestNumber',
                header: t('رقم الطلب', 'Request #'),
                sortValue: (r) => r.requestNumber,
                exportValue: (r) => r.requestNumber,
                render: (r) => (
                  <div>
                    <span className="font-mono font-black text-[#011E58] block">{r.requestNumber}</span>
                    <span className="text-[10px] font-mono tabular-nums text-slate-500">{r.date}</span>
                  </div>
                ),
              },
              {
                key: 'originalInvoiceNumber',
                header: t('الفاتورة الأصلية', 'Original Invoice'),
                sortValue: (r) => r.originalInvoiceNumber,
                exportValue: (r) => r.originalInvoiceNumber,
                render: (r) => <span className="font-mono font-bold text-slate-800">{r.originalInvoiceNumber}</span>,
              },
              {
                key: 'requestedByName',
                header: t('المندوب / مقدم الطلب', 'Rep / Requester'),
                sortValue: (r) => r.representativeName || r.requestedByName,
                exportValue: (r) => r.representativeName || r.requestedByName,
                render: (r) => (
                  <div>
                    <span className="font-bold text-slate-800 block">{r.representativeName || r.requestedByName}</span>
                    <span className="text-[10px] text-slate-500">{t('بواسطة:', 'By:')} {r.requestedByName}</span>
                  </div>
                ),
              },
              {
                key: 'supplierName',
                header: t('المورد والمستودع', 'Supplier & Warehouse'),
                sortValue: (r) => r.supplierName,
                exportValue: (r) => `${translateSystemEntityName(r.supplierName)} (${translateSystemEntityName(r.warehouseName)})`,
                render: (r) => (
                  <div>
                    <span className="font-bold text-slate-800 block">{translateSystemEntityName(r.supplierName)}</span>
                    <span className="text-[10px] text-slate-500">{translateSystemEntityName(r.warehouseName)}</span>
                  </div>
                ),
              },
              {
                key: 'items',
                header: t('الأصناف', 'Items'),
                render: (r) => (
                  <div>
                    <div className="space-y-0.5">
                      {(r.items || []).map((it, i) => (
                        <div key={i} className="text-[11px] text-slate-700">
                          <span className="font-bold">{it.productName}</span> ({it.quantity} {t(it.unit)} × {it.unitPrice})
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">{t('السبب:', 'Reason:')} {r.reason}</p>
                  </div>
                ),
              },
              {
                key: 'grandTotal',
                header: t('الإجمالي', 'Total'),
                align: 'center',
                sortValue: (r) => Number(r.grandTotal || 0),
                exportValue: (r) => Number(r.grandTotal || 0),
                render: (r) => (
                  <div className="font-mono tabular-nums font-black text-slate-900 whitespace-nowrap">
                    {formatLocaleNumber(Number(r.grandTotal || 0))} {t(settings.currency)}
                    <span className="block text-[10px] text-slate-500 font-normal">
                      {r.refundType === 'cash' ? t('مقترح: نقدي', 'Suggested: Cash') : t('مقترح: خصم رصيد', 'Suggested: Balance Ded.')}
                    </span>
                  </div>
                ),
              },
              {
                key: 'status',
                header: t('الحالة', 'Status'),
                align: 'center',
                sortValue: (r) => r.status,
                exportValue: (r) => (r.status === 'pending' ? t('قيد الانتظار', 'Pending') : r.status === 'approved' ? t('معتمد', 'Approved') : t('مرفوض', 'Rejected')),
                render: (r) =>
                  r.status === 'pending' ? (
                    <span className="px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-900 font-bold text-[10px]">
                      {t('قيد الانتظار', 'Pending')}
                    </span>
                  ) : r.status === 'approved' ? (
                    <div className="space-y-0.5">
                      <span className="px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-900 font-bold text-[10px] inline-block">
                        {t('معتمد', 'Approved')}
                      </span>
                      {r.approvedReturnNumber && (
                        <span className="block font-mono text-[10px] text-emerald-800">{r.approvedReturnNumber}</span>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <span className="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-900 font-bold text-[10px] inline-block">
                        {t('مرفوض', 'Rejected')}
                      </span>
                      {r.rejectionReason && (
                        <span className="block text-[10px] text-red-700 max-w-[160px]">{r.rejectionReason}</span>
                      )}
                    </div>
                  ),
              },
              {
                key: 'actions',
                header: t('الإجراءات', 'Actions'),
                align: 'center',
                sortable: false,
                render: (r) =>
                  r.status === 'pending' ? (
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenApproveReq(r)}
                        className="px-2 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{t('اعتماد', 'Approve')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingReq(r);
                          setRejectReason('');
                          setRejectError(null);
                        }}
                        className="px-2 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{t('رفض', 'Reject')}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-500 font-semibold">{r.reviewedByName || t('تمت المراجعة', 'Reviewed')}</span>
                  ),
              },
            ]}
          />
        </div>
      )}

      {/* Create Return Modal */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title={t('إنشاء سند مرتجع مرتبط بفاتورة', 'Create Invoice-Linked Return Voucher')}
        maxWidth="4xl"
      >
        <form onSubmit={handleSubmitReturn} className="space-y-2 text-xs">
          {error && (
            <div className="px-2.5 py-1.5 bg-red-50 text-red-700 rounded-md font-bold">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-0.5">{t('نوع المرتجع:', 'Return Type:')}</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setReturnType('sales_return');
                    setSelectedInvoiceId('');
                  }}
                  className={`h-8 px-2 rounded-md font-bold border transition-colors cursor-pointer ${
                    returnType === 'sales_return' ? 'bg-blue-900 text-white border-blue-900' : 'bg-slate-50 border-slate-300'
                  }`}
                >
                  {t('مرتجع مبيعات من عميل', 'Customer Sales Return')}
                </button>
                {!isRepRole && (
                  <button
                    type="button"
                    onClick={() => {
                      setReturnType('purchase_return');
                      setSelectedInvoiceId('');
                    }}
                    className={`h-8 px-2 rounded-md font-bold border transition-colors cursor-pointer ${
                      returnType === 'purchase_return' ? 'bg-blue-900 text-white border-blue-900' : 'bg-slate-50 border-slate-300'
                    }`}
                  >
                    {t('مرتجع مشتريات لمورد', 'Supplier Purchase Return')}
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block font-bold mb-0.5">{t('تاريخ المرتجع:', 'Return Date:')}</label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md py-1 px-2 font-mono font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold mb-0.5">{t('اختر الفاتورة الأصلية المراد الإرجاع منها:', 'Select Original Invoice to Return From:')}</label>
            <select
              value={selectedInvoiceId}
              onChange={(e) => handleSelectInvoice(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md py-1 px-2 font-bold bg-white"
            >
              <option value="">{t('-- اختر الفاتورة الأصلية --', '-- Select Original Invoice --')}</option>
              {availableInvoices.map(inv => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} - ({inv.customerName || inv.supplierName}) - {t('الإجمالي:', 'Total:')} {formatLocaleNumber(inv.grandTotal)} {t(settings.currency)} {t('بتاريخ', 'on')} {inv.date}
                </option>
              ))}
            </select>
          </div>

          {/* Item Quantities Return Form */}
          {selectedInvoice && (
            <div className="border border-slate-200 rounded-lg p-2 bg-slate-50 space-y-1.5 awlad-table-scroll">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-bold text-slate-800">{t('الأصناف المتوفرة بالفاتورة الأصلية للإرجاع:', 'Available Items in Original Invoice for Return:')}</h4>
              </div>
              <LinkedGroupCategoryFilter
                productGroups={productGroups}
                categories={categories}
                selectedGroupId={retGroupFilter}
                selectedCategoryId={retCatFilter}
                autoAdvanceOnSelect
                onFilterChange={(nextGroupId, nextCategoryId) => {
                  setRetGroupFilter(nextGroupId);
                  setRetCatFilter(nextCategoryId);
                }}
              />
              <EditableItemGrid
                rows={filteredReturnInvoiceItems.map((it) => {
                  const alreadyRet = selectedInvoice.returnedQuantityByItem?.[it.productId] || 0;
                  const maxAllowed = Math.max(0, it.quantity - alreadyRet);
                  const currentQty = Number(returnQuantities[it.productId] || 0);
                  const currentPrice = returnUnitPrices[it.productId] ?? it.unitPrice;
                  return {
                    rowKey: it.productId,
                    productId: it.productId,
                    productName: it.productName,
                    barcode: it.barcode,
                    unit: it.unit,
                    unitFactor: it.unitFactor || 1,
                    quantity: currentQty,
                    maxQuantity: maxAllowed,
                    unitPrice: currentPrice,
                    total: currentQty * currentPrice,
                    availableStock: maxAllowed,
                    secondaryBadge:
                      alreadyRet > 0
                        ? t(`سابق: ${alreadyRet}`, `Prev ret: ${alreadyRet}`)
                        : undefined,
                  };
                })}
                products={products}
                warehouses={warehouses}
                currency={settings.currency}
                priceMode={returnType === 'purchase_return' ? 'purchase' : 'selling'}
                showPriceColumns
                showStockColumn
                stockColumnLabel={t('المتاح للإرجاع', 'Max Returnable')}
                qtyColumnLabel={t('الكمية المرتجعة', 'Return Qty')}
                allowUnitEdit={false}
                allowQtyEdit
                allowPriceEdit
                minQty={0}
                canDelete={false}
                canDuplicate={false}
                canAddNew={false}
                hideCostInfo={isRepRole}
                onUpdateRow={(idx, patch) => {
                  const targetItem = filteredReturnInvoiceItems[idx];
                  if (!targetItem) return;
                  const alreadyRet = selectedInvoice.returnedQuantityByItem?.[targetItem.productId] || 0;
                  const maxAllowed = Math.max(0, targetItem.quantity - alreadyRet);
                  if (patch.quantity !== undefined) {
                    const clamped = Math.min(maxAllowed, Math.max(0, patch.quantity));
                    setReturnQuantities((prev) => ({
                      ...prev,
                      [targetItem.productId]: clamped === 0 ? '' : clamped,
                    }));
                  }
                  if (patch.unitPrice !== undefined) {
                    setReturnUnitPrices((prev) => ({
                      ...prev,
                      [targetItem.productId]: Math.max(0, patch.unitPrice!),
                    }));
                  }
                }}
                onNotify={(msg) => setRequestBanner({ type: 'success', text: msg })}
                maxHeightClass="max-h-60"
                compact
              />

              <div className="flex justify-between items-center pt-1">
                <span className="font-bold text-slate-700">{t('إجمالي قيمة المرتجع المحتسب:', 'Calculated Return Total:')}</span>
                <span className="text-sm font-black text-blue-900 font-mono">
                  {calculatedGrandTotal.toFixed(2)} {t(settings.currency)}
                </span>
              </div>
            </div>
          )}

          {/* Refund method */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
            <div>
              <label className="block font-bold mb-0.5">{t('طريقة التسوية المالية:', 'Financial Settlement Method:')}</label>
              <select
                value={canUseTreasuryCashRefund || (isRepRole && returnType === 'sales_return') ? refundType : 'balance'}
                onChange={(e) => setRefundType(e.target.value as 'balance' | 'cash')}
                className="w-full h-8 bg-white border border-slate-300 rounded-md py-1 px-2 font-bold"
              >
                <option value="balance">{t('تعديل وخصم من رصيد الحساب الآجل', 'Adjust & deduct from credit account balance')}</option>
                {(canUseTreasuryCashRefund || (isRepRole && returnType === 'sales_return')) && (
                  <option value="cash">
                    {isRepRole ? t('طلب رد نقدي (يرفع لموافقة الخزينة/الإدارة)', 'Cash refund request (requires treasury/admin approval)') : t('رد نقدي فوري من الخزينة', 'Immediate cash refund from treasury')}
                  </option>
                )}
              </select>
            </div>
            {canUseTreasuryCashRefund && refundType === 'cash' ? (
              <div>
                <label className="block font-bold mb-0.5">{t('الخزينة المسدد منها:', 'Paid from Cashbox:')}</label>
                <select
                  value={refundCashboxId}
                  onChange={(e) => setRefundCashboxId(e.target.value)}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md py-1 px-2 font-bold"
                >
                  {cashboxes.map(c => (
                    <option key={c.id} value={c.id}>{t(c.name)}</option>
                  ))}
                </select>
              </div>
            ) : isRepRole && refundType === 'cash' ? (
              <div className="flex items-center px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
                {t('يُرسل هذا المرتجع كطلب مراجعة للخزينة والإدارة، ولا يتم صرف أو خصم أي مبلغ من أي خزينة إلا بعد الاعتماد.', 'This return is sent as a review request to treasury & management; no amount is disbursed or deducted from any cashbox until approved.')}
              </div>
            ) : !canUseTreasuryCashRefund ? (
              <div className="flex items-center px-2 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[11px]">
                {t('الرد النقدي من الخزينة متاح لصلاحية إدارة الخزائن والحسابات فقط.', 'Cash refund from treasury is available only with cashboxes and accounts management permission.')}
              </div>
            ) : null}
          </div>

          <div>
            <label className="block font-bold mb-0.5">{t('سبب المرتجع:', 'Return Reason:')}</label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md py-1 px-2"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsNewModalOpen(false)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">{t('إلغاء', 'Cancel')}</button>
            <button type="submit" disabled={isSubmitting || calculatedGrandTotal === 0} className="px-3 py-1 bg-blue-900 text-white rounded-md font-bold hover:bg-blue-950 cursor-pointer disabled:opacity-50">
              {t('اعتماد المرتجع وتعديل المخزن', 'Approve Return & Update Inventory')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Approve Purchase Return Request Modal */}
      <Modal
        isOpen={Boolean(approvingReq)}
        onClose={() => !isProcessingReq && setApprovingReq(null)}
        title={approvingReq ? `${t('اعتماد طلب مرتجع مشتريات:', 'Approve Purchase Return Request:')} ${approvingReq.requestNumber}` : ''}
        subtitle={t('سيتم إنشاء سند مرتجع مشتريات رسمي وخصم الكميات من المخزن وتحديث حساب المورد/الخزينة.', 'An official purchase return voucher will be created, stock deducted, and supplier/treasury account updated.')}
        maxWidth="md"
      >
        {approvingReq && (
          <form onSubmit={handleConfirmApproveReq} className="space-y-2 text-xs">
            {approveError && (
              <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{approveError}</div>
            )}
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('المورد:', 'Supplier:')}</span>
                <strong className="text-slate-900">{approvingReq.supplierName}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('الفاتورة الأصلية:', 'Original Invoice:')}</span>
                <strong className="font-mono text-blue-900">{approvingReq.originalInvoiceNumber}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('الإجمالي:', 'Total:')}</span>
                <strong className="font-mono text-emerald-800">
                  {formatLocaleNumber(Number(approvingReq.grandTotal || 0))} {t(settings.currency)}
                </strong>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-0.5">{t('طريقة التسوية المالية:', 'Financial Settlement Method:')}</label>
              <select
                value={canUseTreasuryCashRefund ? approveRefundType : 'balance'}
                onChange={(e) => setApproveRefundType(e.target.value as 'balance' | 'cash')}
                className="w-full h-8 border border-slate-300 rounded-md py-1 px-2 font-bold bg-white"
              >
                <option value="balance">{t('تعديل وخصم من رصيد حساب المورد', 'Adjust & deduct from supplier account balance')}</option>
                {canUseTreasuryCashRefund && (
                  <option value="cash">{t('استرداد نقدي إلى الخزينة', 'Cash refund to treasury')}</option>
                )}
              </select>
            </div>

            {canUseTreasuryCashRefund && approveRefundType === 'cash' && (
              <div>
                <label className="block font-bold mb-0.5">{t('الخزينة المستلمة للاسترداد النقدي:', 'Receiving Cashbox for Cash Refund:')}</label>
                <select
                  value={approveCashboxId}
                  onChange={(e) => setApproveCashboxId(e.target.value)}
                  className="w-full h-8 border border-slate-300 rounded-md py-1 px-2 font-bold bg-white"
                >
                  {cashboxes.map((c) => (
                    <option key={c.id} value={c.id}>{t(c.name)}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-bold mb-0.5">{t('ملاحظات الاعتماد (اختياري):', 'Approval Notes (optional):')}</label>
              <input
                type="text"
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md py-1 px-2"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingReq}
                onClick={() => setApprovingReq(null)}
                className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isProcessingReq}
                className="h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
              >
                {isProcessingReq ? t('جاري الاعتماد...', 'Approving...') : t('تأكيد الاعتماد والترحيل', 'Confirm Approval & Post')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reject Purchase Return Request Modal */}
      <Modal
        isOpen={Boolean(rejectingReq)}
        onClose={() => !isProcessingReq && setRejectingReq(null)}
        title={rejectingReq ? `${t('رفض طلب مرتجع مشتريات:', 'Reject Purchase Return Request:')} ${rejectingReq.requestNumber}` : ''}
        maxWidth="md"
      >
        {rejectingReq && (
          <form onSubmit={handleConfirmRejectReq} className="space-y-2 text-xs">
            {rejectError && (
              <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{rejectError}</div>
            )}
            <div>
              <label className="block font-bold mb-0.5">{t('سبب الرفض (إلزامي):', 'Rejection Reason (required):')}</label>
              <textarea
                rows={3}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full border border-slate-300 rounded-md py-1.5 px-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingReq}
                onClick={() => setRejectingReq(null)}
                className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isProcessingReq}
                className="px-3 py-1 bg-red-700 hover:bg-red-800 text-white rounded-md font-black cursor-pointer disabled:opacity-50"
              >
                {isProcessingReq ? t('جاري الرفض...', 'Rejecting...') : t('تأكيد رفض الطلب', 'Confirm Rejection')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Approve Sales Return Request Modal */}
      <Modal
        isOpen={Boolean(approvingSalesReq)}
        onClose={() => !isProcessingSalesReq && setApprovingSalesReq(null)}
        title={approvingSalesReq ? `${t('اعتماد طلب مرتجع مبيعات:', 'Approve Sales Return Request:')} ${approvingSalesReq.requestNumber}` : ''}
        subtitle={t('سيتم إنشاء سند مرتجع مبيعات رسمي وإرجاع الكميات للمخزن وتحديث الخزينة أو حساب العميل.', 'An official sales return voucher will be created, stock returned, and treasury or customer account updated.')}
        maxWidth="md"
      >
        {approvingSalesReq && (
          <form onSubmit={handleConfirmApproveSalesReq} className="space-y-2 text-xs">
            {approveSalesError && (
              <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{approveSalesError}</div>
            )}
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('العميل:', 'Customer:')}</span>
                <strong className="text-slate-900">{translateSystemEntityName(approvingSalesReq.customerName)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('الفاتورة الأصلية:', 'Original Invoice:')}</span>
                <strong className="font-mono text-blue-900">{approvingSalesReq.originalInvoiceNumber}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t('الإجمالي:', 'Total:')}</span>
                <strong className="font-mono text-emerald-800">
                  {formatLocaleNumber(Number(approvingSalesReq.grandTotal || 0))} {t(settings.currency)}
                </strong>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-0.5">{t('طريقة التسوية المالية المعتمدة:', 'Approved Financial Settlement Method:')}</label>
              <select
                value={canUseTreasuryCashRefund ? approveSalesRefundType : 'balance'}
                onChange={(e) => setApproveSalesRefundType(e.target.value as 'cash' | 'balance')}
                className="w-full h-8 border border-slate-300 rounded-md py-1 px-2 font-bold bg-white"
              >
                <option value="balance">{t('تعديل وخصم من رصيد حساب العميل', 'Adjust & deduct from customer account balance')}</option>
                {canUseTreasuryCashRefund && (
                  <option value="cash">{t('صرف نقدي من الخزينة', 'Cash disbursement from treasury')}</option>
                )}
              </select>
            </div>

            {canUseTreasuryCashRefund && approveSalesRefundType === 'cash' && (
              <div>
                <label className="block font-bold mb-0.5">{t('الخزينة المصروف منها:', 'Disbursing Cashbox:')}</label>
                <select
                  value={approveSalesCashboxId}
                  onChange={(e) => setApproveSalesCashboxId(e.target.value)}
                  className="w-full h-8 border border-slate-300 rounded-md py-1 px-2 font-bold bg-white"
                >
                  {cashboxes.map((c) => (
                    <option key={c.id} value={c.id}>{t(c.name)}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-bold mb-0.5">{t('ملاحظات الاعتماد (اختياري):', 'Approval Notes (optional):')}</label>
              <input
                type="text"
                value={approveSalesNotes}
                onChange={(e) => setApproveSalesNotes(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md py-1 px-2"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingSalesReq}
                onClick={() => setApprovingSalesReq(null)}
                className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isProcessingSalesReq}
                className="h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
              >
                {isProcessingSalesReq ? t('جاري الاعتماد...', 'Approving...') : t('تأكيد الاعتماد والترحيل', 'Confirm Approval & Post')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reject Sales Return Request Modal */}
      <Modal
        isOpen={Boolean(rejectingSalesReq)}
        onClose={() => !isProcessingSalesReq && setRejectingSalesReq(null)}
        title={rejectingSalesReq ? `${t('رفض طلب مرتجع مبيعات:', 'Reject Sales Return Request:')} ${rejectingSalesReq.requestNumber}` : ''}
        maxWidth="md"
      >
        {rejectingSalesReq && (
          <form onSubmit={handleConfirmRejectSalesReq} className="space-y-2 text-xs">
            {rejectSalesError && (
              <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{rejectSalesError}</div>
            )}
            <div>
              <label className="block font-bold mb-0.5">{t('سبب الرفض (إلزامي):', 'Rejection Reason (required):')}</label>
              <textarea
                rows={3}
                required
                value={rejectSalesReason}
                onChange={(e) => setRejectSalesReason(e.target.value)}
                className="w-full border border-slate-300 rounded-md py-1.5 px-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingSalesReq}
                onClick={() => setRejectingSalesReq(null)}
                className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isProcessingSalesReq}
                className="px-3 py-1 bg-red-700 hover:bg-red-800 text-white rounded-md font-black cursor-pointer disabled:opacity-50"
              >
                {isProcessingSalesReq ? t('جاري الرفض...', 'Rejecting...') : t('تأكيد رفض الطلب', 'Confirm Rejection')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Return Details Preview Modal (Read-only inspection) */}
      <Modal
        isOpen={Boolean(previewReturn)}
        onClose={() => setPreviewReturn(null)}
        title={previewReturn ? `${t('تفاصيل سند المرتجع:', 'Return Voucher Details:')} ${previewReturn.returnNumber}` : ''}
        maxWidth="2xl"
      >
        {previewReturn && (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('النوع', 'Type')}</span>
                <strong className="text-slate-900 dark:text-[#F3F7FC]">
                  {previewReturn.type === 'sales_return' ? t('مرتجع مبيعات', 'Sales Return') : t('مرتجع مشتريات', 'Purchase Return')}
                </strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الفاتورة الأصلية', 'Original Invoice')}</span>
                <strong className="font-mono text-slate-900 dark:text-[#F3F7FC]">{previewReturn.originalInvoiceNumber}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('التاريخ', 'Date')}</span>
                <strong className="font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">{previewReturn.date}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('العميل / المورد', 'Customer / Supplier')}</span>
                <strong className="text-slate-900 dark:text-[#F3F7FC]">{translateSystemEntityName(previewReturn.partyName)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المستودع', 'Warehouse')}</span>
                <strong className="text-slate-900 dark:text-[#F3F7FC]">{translateSystemEntityName(previewReturn.warehouseName)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('طريقة التسوية', 'Settlement Method')}</span>
                <strong className="text-slate-900 dark:text-[#F3F7FC]">
                  {previewReturn.refundType === 'cash' ? t('رد نقدي من الخزينة', 'Cash Refund from Treasury') : t('خصم من رصيد الحساب', 'Deduct from Account Balance')}
                </strong>
              </div>
            </div>

            {previewReturn.reason && (
              <div className="p-2 rounded-md bg-amber-50/70 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 text-amber-950 dark:text-amber-200">
                <span className="font-bold">{t('سبب المرتجع:', 'Return Reason:')} </span>
                <span>{previewReturn.reason}</span>
              </div>
            )}

            <div className="border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden awlad-table-scroll">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#172E56] text-slate-700 dark:text-[#F3F7FC] font-bold border-b border-slate-200 dark:border-[#2A436E]">
                    <th className="p-2">{t('الصنف', 'Item')}</th>
                    <th className="p-2 text-center">{t('الوحدة', 'Unit')}</th>
                    <th className="p-2 text-center">{t('الكمية', 'Quantity')}</th>
                    <th className="p-2 text-center">{t('السعر', 'Price')}</th>
                    <th className="p-2 text-center">{t('الإجمالي', 'Total')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                  {(previewReturn.items || []).map((it, idx) => (
                    <tr key={`${it.productId}-${idx}`}>
                      <td className="p-2 font-bold">{it.productName}</td>
                      <td className="p-2 text-center">{t(it.unit)}</td>
                      <td className="p-2 text-center font-mono tabular-nums">{it.quantity}</td>
                      <td className="p-2 text-center font-mono tabular-nums">{formatLocaleNumber(Number(it.unitPrice || 0))}</td>
                      <td className="p-2 text-center font-mono tabular-nums font-bold">{formatLocaleNumber(Number(it.total || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-[#21375C]">
              <div className="font-black text-sm text-slate-900 dark:text-[#F3F7FC]">
                {t('الإجمالي:', 'Total:')}{' '}
                <span className="font-mono tabular-nums text-[#003589] dark:text-[#85B8FF]">
                  {formatLocaleNumber(Number(previewReturn.grandTotal || 0))} {t(settings.currency)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = previewReturn;
                    setPreviewReturn(null);
                    handlePrintReturn(target);
                  }}
                  className="h-8 px-3 rounded-md bg-[#003589] dark:bg-[#1659C8] hover:bg-[#0049B0] text-white font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{t('طباعة السند', 'Print Voucher')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewReturn(null)}
                  className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
                >
                  {t('إغلاق', 'Close')}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Sales Return Request Detail Modal */}
      <Modal
        isOpen={!!previewSalesRequest}
        onClose={() => setPreviewSalesRequest(null)}
        title={previewSalesRequest ? `${t('تفاصيل طلب مرتجع مبيعات:', 'Sales Return Request Details:')} ${previewSalesRequest.requestNumber}` : t('تفاصيل طلب مرتجع مبيعات', 'Sales Return Request Details')}
        subtitle={previewSalesRequest?.customerName ? translateSystemEntityName(previewSalesRequest.customerName) : undefined}
        maxWidth="2xl"
      >
        {previewSalesRequest && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الفاتورة الأصلية', 'Original Invoice')}</span>
                <strong className="font-mono">{previewSalesRequest.originalInvoiceNumber}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المندوب / المرسل', 'Rep / Sender')}</span>
                <strong>{previewSalesRequest.representativeName || previewSalesRequest.requestedByName}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('التاريخ', 'Date')}</span>
                <strong className="font-mono tabular-nums">{previewSalesRequest.date}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('العميل', 'Customer')}</span>
                <strong>{translateSystemEntityName(previewSalesRequest.customerName)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المستودع', 'Warehouse')}</span>
                <strong>{translateSystemEntityName(previewSalesRequest.warehouseName)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الإجمالي', 'Total')}</span>
                <strong className="font-mono tabular-nums text-[#003589] dark:text-[#85B8FF]">
                  {formatLocaleNumber(Number(previewSalesRequest.grandTotal || 0))} {t(settings.currency)}
                </strong>
              </div>
            </div>
            {previewSalesRequest.reason && (
              <div className="p-2 rounded-md bg-amber-50/70 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30">
                <span className="font-bold">{t('سبب المرتجع:', 'Return Reason:')} </span>
                <span>{previewSalesRequest.reason}</span>
              </div>
            )}
            <div className="border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#172E56] font-bold border-b border-slate-200 dark:border-[#2A436E]">
                    <th className="p-2">{t('الصنف', 'Item')}</th>
                    <th className="p-2 text-center">{t('الوحدة', 'Unit')}</th>
                    <th className="p-2 text-center">{t('الكمية', 'Quantity')}</th>
                    <th className="p-2 text-center">{t('السعر', 'Price')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                  {(previewSalesRequest.items || []).map((it, idx) => (
                    <tr key={`${it.productId}-${idx}`}>
                      <td className="p-2 font-bold">{it.productName}</td>
                      <td className="p-2 text-center">{t(it.unit)}</td>
                      <td className="p-2 text-center font-mono tabular-nums">{it.quantity}</td>
                      <td className="p-2 text-center font-mono tabular-nums">{formatLocaleNumber(Number(it.unitPrice || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#21375C]">
              {previewSalesRequest.status === 'pending' && canManageSalesReturnRequests && (
                <button
                  type="button"
                  onClick={() => {
                    const req = previewSalesRequest;
                    setPreviewSalesRequest(null);
                    handleOpenApproveSalesReq(req);
                  }}
                  className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                >
                  {t('مراجعة واعتماد', 'Review & Approve')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setPreviewSalesRequest(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Purchase Return Request Detail Modal */}
      <Modal
        isOpen={!!previewPurchaseRequest}
        onClose={() => setPreviewPurchaseRequest(null)}
        title={previewPurchaseRequest ? `${t('تفاصيل طلب مرتجع مشتريات:', 'Purchase Return Request Details:')} ${previewPurchaseRequest.requestNumber}` : t('تفاصيل طلب مرتجع مشتريات', 'Purchase Return Request Details')}
        subtitle={previewPurchaseRequest?.supplierName}
        maxWidth="2xl"
      >
        {previewPurchaseRequest && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الفاتورة الأصلية', 'Original Invoice')}</span>
                <strong className="font-mono">{previewPurchaseRequest.originalInvoiceNumber}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المندوب / المرسل', 'Rep / Sender')}</span>
                <strong>{previewPurchaseRequest.representativeName || previewPurchaseRequest.requestedByName}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('التاريخ', 'Date')}</span>
                <strong className="font-mono tabular-nums">{previewPurchaseRequest.date}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المورد', 'Supplier')}</span>
                <strong>{previewPurchaseRequest.supplierName}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المستودع', 'Warehouse')}</span>
                <strong>{translateSystemEntityName(previewPurchaseRequest.warehouseName)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الإجمالي', 'Total')}</span>
                <strong className="font-mono tabular-nums text-[#003589] dark:text-[#85B8FF]">
                  {formatLocaleNumber(Number(previewPurchaseRequest.grandTotal || 0))} {t(settings.currency)}
                </strong>
              </div>
            </div>
            {previewPurchaseRequest.reason && (
              <div className="p-2 rounded-md bg-amber-50/70 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30">
                <span className="font-bold">{t('سبب المرتجع:', 'Return Reason:')} </span>
                <span>{previewPurchaseRequest.reason}</span>
              </div>
            )}
            <div className="border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#172E56] font-bold border-b border-slate-200 dark:border-[#2A436E]">
                    <th className="p-2">{t('الصنف', 'Item')}</th>
                    <th className="p-2 text-center">{t('الوحدة', 'Unit')}</th>
                    <th className="p-2 text-center">{t('الكمية', 'Quantity')}</th>
                    <th className="p-2 text-center">{t('السعر', 'Price')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                  {(previewPurchaseRequest.items || []).map((it, idx) => (
                    <tr key={`${it.productId}-${idx}`}>
                      <td className="p-2 font-bold">{it.productName}</td>
                      <td className="p-2 text-center">{t(it.unit)}</td>
                      <td className="p-2 text-center font-mono tabular-nums">{it.quantity}</td>
                      <td className="p-2 text-center font-mono tabular-nums">{formatLocaleNumber(Number(it.unitPrice || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#21375C]">
              <button
                type="button"
                onClick={() => setPreviewPurchaseRequest(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
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

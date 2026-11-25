import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus, Filter, Printer, Download, Eye, XCircle,
  CheckCircle, FileText, Calendar, ArrowLeftRight, DollarSign,
  Edit, AlertCircle, Check, History, Clock
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { Invoice, InvoiceItem } from '../../../types';
import { NewSaleInvoiceModal } from './NewSaleInvoiceModal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { exportToExcel } from '../../common/ExcelExporter';
import { QuantityInput } from '../../common/QuantityInput';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { computeLineTotal } from '../../../utils/quantity';

export interface SalesInvoicesViewProps {
  initialStatusFilter?: 'all' | 'confirmed' | 'draft' | 'cancelled';
  initialOpenNew?: boolean;
  initialTab?: 'invoices' | 'quotes';
}

export const SalesInvoicesView: React.FC<SalesInvoicesViewProps> = ({
  initialStatusFilter = 'all',
  initialOpenNew = false,
  initialTab = 'invoices',
}) => {
  const {
    invoices,
    customers,
    products,
    warehouses,
    representatives,
    cashboxes,
    settings,
    cancelInvoice,
    confirmDraftInvoice,
    addInvoicePayment,
    editSalesInvoice,
    createSalesQuote,
    convertQuoteToInvoice,
    markInvoiceReviewed,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const { registerHandler } = useShortcuts();
  const canReviewInvoices =
    currentUser?.role === 'admin' ||
    hasPermission('canReviewRepInvoices') ||
    hasPermission('canManageSales') ||
    hasPermission('canApprove');

  const [activeTab, setActiveTab] = useState<'invoices' | 'quotes'>(initialTab);
  const [isNewModalOpen, setIsNewModalOpen] = useState(initialOpenNew);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomerFilter, setSelectedCustomerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'draft' | 'cancelled'>(initialStatusFilter);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'needs_review' | 'reviewed'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    if (initialOpenNew) {
      setIsNewModalOpen(true);
    }
  }, [initialOpenNew]);

  // Print modal state
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Detail View modal state
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);

  // Confirm Dialogs state (Cancel invoice / Confirm Draft)
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);
  const [confirmDraftTarget, setConfirmDraftTarget] = useState<Invoice | null>(null);
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);

  // Subsequent Payment on Invoice Modal state
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentCashboxId, setPaymentCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    if (!cashboxes.some((c) => c.id === paymentCashboxId) && cashboxes[0]?.id) {
      setPaymentCashboxId(cashboxes[0].id);
    }
  }, [cashboxes, paymentCashboxId]);

  // Edit Invoice Modal state
  const [editModalInvoice, setEditModalInvoice] = useState<Invoice | null>(null);
  const [editDate, setEditDate] = useState<string>('');
  const [editDiscount, setEditDiscount] = useState<number>(0);
  const [editNotes, setEditNotes] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [editItems, setEditItems] = useState<InvoiceItem[]>([]);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Review Rep Invoice modal state
  const [reviewTarget, setReviewTarget] = useState<Invoice | null>(null);
  const [reviewNotesInput, setReviewNotesInput] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // Create Quote modal state
  const [isNewQuoteOpen, setIsNewQuoteOpen] = useState(false);
  const [quoteCustomerId, setQuoteCustomerId] = useState('');
  const [quoteWarehouseId, setQuoteWarehouseId] = useState(warehouses[0]?.id || 'wh-main');
  const [quoteRepId, setQuoteRepId] = useState('');
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().split('T')[0]);
  const [quoteDiscountTotal, setQuoteDiscountTotal] = useState<number | ''>('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [quoteItems, setQuoteItems] = useState<InvoiceItem[]>([]);
  const [quoteSelectedProductId, setQuoteSelectedProductId] = useState('');
  const [quoteQty, setQuoteQty] = useState<number | ''>('');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isSubmittingQuote, setIsSubmittingQuote] = useState(false);

  // Convert Quote to Invoice modal state
  const [convertQuoteTarget, setConvertQuoteTarget] = useState<Invoice | null>(null);
  const [convertWarehouseId, setConvertWarehouseId] = useState(warehouses[0]?.id || 'wh-main');
  const [convertCashboxId, setConvertCashboxId] = useState(cashboxes[0]?.id || 'cb-main');
  const [convertPaymentType, setConvertPaymentType] = useState<'cash' | 'partial' | 'credit'>('cash');
  const [convertPaidAtInvoice, setConvertPaidAtInvoice] = useState<number | ''>('');
  const [convertDiscountTotal, setConvertDiscountTotal] = useState<number | ''>('');
  const [convertNotes, setConvertNotes] = useState('');
  const [isConvertingQuote, setIsConvertingQuote] = useState(false);

  // Filter sales invoices & quotes
  const salesInvoices = useMemo(() => {
    return invoices.filter(i => i.type === 'sales');
  }, [invoices]);

  const quotesList = useMemo(() => {
    return invoices.filter(i => i.type === 'quote');
  }, [invoices]);

  const convertedQuoteIds = useMemo(() => {
    return new Set(
      invoices
        .filter((i) => i.type === 'sales' && i.status !== 'cancelled' && i.convertedFromQuoteId)
        .map((i) => String(i.convertedFromQuoteId))
    );
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    return salesInvoices.filter(inv => {
      const matchSearch = 
        inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (inv.customerName && inv.customerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.representativeName && inv.representativeName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.convertedFromQuoteNumber && inv.convertedFromQuoteNumber.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchCustomer = selectedCustomerFilter ? inv.customerId === selectedCustomerFilter : true;
      const matchStatus = statusFilter === 'all' ? true : inv.status === statusFilter;
      const matchReview =
        reviewFilter === 'all'
          ? true
          : reviewFilter === 'needs_review'
          ? inv.reviewStatus === 'needs_review'
          : inv.reviewStatus === 'reviewed';
      const matchDateFrom = dateFrom ? inv.date >= dateFrom : true;
      const matchDateTo = dateTo ? inv.date <= dateTo : true;

      return matchSearch && matchCustomer && matchStatus && matchReview && matchDateFrom && matchDateTo;
    });
  }, [salesInvoices, searchTerm, selectedCustomerFilter, statusFilter, reviewFilter, dateFrom, dateTo]);

  const filteredQuotes = useMemo(() => {
    return quotesList.filter(q => {
      const matchSearch =
        q.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (q.customerName && q.customerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (q.representativeName && q.representativeName.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchCustomer = selectedCustomerFilter ? q.customerId === selectedCustomerFilter : true;
      const matchDateFrom = dateFrom ? q.date >= dateFrom : true;
      const matchDateTo = dateTo ? q.date <= dateTo : true;
      return matchSearch && matchCustomer && matchDateFrom && matchDateTo;
    });
  }, [quotesList, searchTerm, selectedCustomerFilter, dateFrom, dateTo]);

  // Open print preview
  const handlePrint = (inv: Invoice) => {
    const isQuote = inv.type === 'quote';
    setPrintData({
      title: isQuote ? 'عرض سعر — أولاد سليم' : 'فاتورة مبيعات أولاد سليم',
      docNumber: inv.invoiceNumber,
      docType: isQuote ? 'عرض سعر' : 'فاتورة مبيعات',
      date: inv.date,
      partyName: inv.customerName,
      warehouseName: inv.warehouseName,
      representativeName: inv.representativeName,
      paymentType: isQuote
        ? 'عرض سعر استرشادي (بلا أثر مخزني أو مالي)'
        : inv.paymentType === 'cash'
        ? 'نقدي'
        : inv.paymentType === 'credit'
        ? 'آجل'
        : 'جزئي',
      items: inv.items.map(it => ({
        name: it.productName,
        unit: it.unit,
        quantity: it.quantity,
        price: it.unitPrice,
        discount: it.discount,
        total: it.total,
      })),
      subtotal: inv.subtotal,
      discountTotal: inv.discountTotal,
      grandTotal: inv.grandTotal,
      paidAmount: isQuote ? undefined : inv.paidAmount,
      remainingAmount: isQuote ? undefined : inv.remainingAmount,
      notes: inv.notes,
    });
    setIsPrintModalOpen(true);
  };

  // Export to Excel
  const handleExportExcel = () => {
    const headers = [
      'رقم الفاتورة',
      'التاريخ',
      'العميل',
      'المندوب',
      'المستودع',
      'الإجمالي',
      'المدفوع',
      'المتبقي',
      'نوع السداد',
      'الحالة',
      'الملاحظات'
    ];

    const rows = filteredInvoices.map(inv => [
      inv.invoiceNumber,
      inv.date,
      inv.customerName || 'نقدي',
      inv.representativeName || '-',
      inv.warehouseName,
      inv.grandTotal,
      inv.paidAmount,
      inv.remainingAmount,
      inv.paymentType,
      inv.status,
      inv.notes || ''
    ]);

    exportToExcel(`فواتير_مبيعات_أولاد_سليم_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handleExecuteCancelInvoice = async (reason?: string) => {
    if (!cancelTarget || !reason) return;
    setIsConfirmLoading(true);
    const res = await cancelInvoice(cancelTarget.id, reason);
    setIsConfirmLoading(false);
    if (!res.success) {
      setActionMessage({ type: 'error', text: res.error || 'تعذر إلغاء الفاتورة' });
    } else {
      setActionMessage({ type: 'success', text: `تم إلغاء الفاتورة (${cancelTarget.invoiceNumber}) بنجاح.` });
      setCancelTarget(null);
    }
  };

  const handleExecuteConfirmDraft = async () => {
    if (!confirmDraftTarget) return;
    setIsConfirmLoading(true);
    const res = await confirmDraftInvoice(confirmDraftTarget.id);
    setIsConfirmLoading(false);
    if (!res.success) {
      setActionMessage({ type: 'error', text: res.error || 'تعذر اعتماد الفاتورة المسودة' });
    } else {
      setActionMessage({ type: 'success', text: `تم اعتماد الفاتورة (${confirmDraftTarget.invoiceNumber}) وتحديث المخزون والحسابات بنجاح.` });
      setConfirmDraftTarget(null);
    }
  };

  useEffect(() => {
    const unregPrint = registerHandler('action:print_document', () => {
      if (activeInvoice) {
        handlePrint(activeInvoice);
      } else if (filteredInvoices.length > 0 && !isNewModalOpen) {
        handlePrint(filteredInvoices[0]);
      }
    });
    return () => unregPrint();
  }, [registerHandler, activeInvoice, filteredInvoices, isNewModalOpen]);

  // Handle Opening Payment Modal
  const handleOpenPaymentModal = (inv: Invoice) => {
    setPaymentModalInvoice(inv);
    setPaymentAmount(inv.remainingAmount);
    setPaymentCashboxId(cashboxes[0]?.id || '');
    setPaymentMethod('cash');
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentNotes('');
    setPaymentError(null);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalInvoice) return;
    setPaymentError(null);
    setIsSubmittingPayment(true);
    const res = await addInvoicePayment(paymentModalInvoice.id, {
      amount: paymentAmount,
      date: paymentDate,
      paymentMethod,
      cashboxId: paymentCashboxId,
      notes: paymentNotes,
    });
    setIsSubmittingPayment(false);
    if (!res.success) {
      setPaymentError(res.error || 'تعذر تسجيل الدفعة');
    } else {
      setPaymentModalInvoice(null);
    }
  };

  // Handle Opening Edit Modal
  const handleOpenEditModal = (inv: Invoice) => {
    setEditModalInvoice(inv);
    setEditDate(inv.date);
    setEditDiscount(inv.discountTotal || 0);
    setEditNotes(inv.notes || '');
    setEditReason('');
    setEditItems(inv.items.map(it => ({ ...it })));
    setEditError(null);
  };

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalInvoice) return;
    if (!editReason.trim()) {
      setEditError('يرجى كتابة سبب تعديل الفاتورة لتوثيقه في سجل المراجعة.');
      return;
    }
    setEditError(null);
    setIsSubmittingEdit(true);
    const res = await editSalesInvoice(editModalInvoice.id, {
      date: editDate,
      discountTotal: editDiscount,
      notes: editNotes,
      reason: editReason.trim(),
      items: editItems,
    });
    setIsSubmittingEdit(false);
    if (!res.success) {
      setEditError(res.error || 'تعذر تعديل الفاتورة');
    } else {
      setEditModalInvoice(null);
    }
  };

  const handleAddQuoteItem = (prodId?: string) => {
    const pid = prodId || quoteSelectedProductId;
    const prod = products.find((p) => p.id === pid);
    if (!prod) return;
    const qty = Math.max(0.001, Number(quoteQty || 1));
    const unitPrice = Number(prod.sellingPrice || 0);
    setQuoteItems((prev) => {
      const existingIdx = prev.findIndex((i) => i.productId === prod.id && i.unit === prod.baseUnit);
      if (existingIdx >= 0) {
        return prev.map((it, idx) =>
          idx === existingIdx
            ? {
                ...it,
                quantity: it.quantity + qty,
                total: computeLineTotal(it.quantity + qty, it.unitPrice, it.discount || 0),
              }
            : it
        );
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          barcode: prod.barcode || prod.code || '',
          unit: prod.baseUnit,
          unitFactor: 1,
          quantity: qty,
          unitPrice,
          purchasePriceAtTime: Number(prod.purchasePrice || 0),
          discount: 0,
          total: computeLineTotal(qty, unitPrice, 0),
        },
      ];
    });
    setQuoteSelectedProductId('');
    setQuoteQty('');
  };

  const handleSubmitQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuoteError(null);
    if (quoteItems.length === 0) {
      setQuoteError('أضف صنفاً واحداً على الأقل لعرض السعر');
      return;
    }
    const cust = customers.find((c) => c.id === quoteCustomerId);
    const wh = warehouses.find((w) => w.id === quoteWarehouseId) || warehouses[0];
    const rep = representatives.find((r) => r.id === quoteRepId);
    const subtotal = quoteItems.reduce((s, it) => s + computeLineTotal(it.quantity, it.unitPrice, it.discount || 0), 0);
    const grandTotal = Math.max(0, subtotal - Number(quoteDiscountTotal || 0));

    setIsSubmittingQuote(true);
    const res = await createSalesQuote({
      date: quoteDate,
      customerId: cust?.id,
      customerName: cust?.name || 'عميل نقدي / عرض سعر عام',
      representativeId: rep?.id,
      representativeName: rep?.name,
      warehouseId: wh?.id || 'wh-main',
      warehouseName: wh?.name || 'المخزن الرئيسي',
      items: quoteItems,
      subtotal,
      discountTotal: Number(quoteDiscountTotal || 0),
      taxTotal: 0,
      grandTotal,
      paidAmount: 0,
      remainingAmount: grandTotal,
      paymentType: 'credit',
      paymentMethod: 'cash',
      cashboxId: cashboxes[0]?.id || 'cb-main',
      status: 'draft',
      notes: quoteNotes.trim() || undefined,
    });
    setIsSubmittingQuote(false);
    if (!res.success) {
      setQuoteError(res.error || 'تعذر إنشاء عرض السعر');
      return;
    }
    setIsNewQuoteOpen(false);
    setQuoteItems([]);
    setQuoteNotes('');
    setQuoteDiscountTotal('');
    setActionMessage({
      type: 'success',
      text: `تم إنشاء عرض السعر (${res.invoice?.invoiceNumber || ''}) بنجاح دون أي تأثير على المخزون أو الحسابات.`,
    });
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewTarget) return;
    setIsSubmittingReview(true);
    const res = await markInvoiceReviewed(reviewTarget.id, reviewNotesInput.trim() || undefined);
    setIsSubmittingReview(false);
    if (!res.success) {
      setActionMessage({ type: 'error', text: res.error || 'تعذر تأكيد مراجعة الفاتورة' });
    } else {
      setActionMessage({
        type: 'success',
        text: `تم اعتماد مراجعة فاتورة المندوب (${reviewTarget.invoiceNumber}) بنجاح دون تكرار القيد أو المخزون.`,
      });
      setReviewTarget(null);
      setReviewNotesInput('');
    }
  };

  const handleSubmitConvertQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convertQuoteTarget) return;
    setIsConvertingQuote(true);
    const res = await convertQuoteToInvoice(convertQuoteTarget.id, {
      warehouseId: convertWarehouseId,
      cashboxId: convertCashboxId,
      paymentType: convertPaymentType,
      paidAtInvoice: Number(convertPaidAtInvoice || 0),
      discountTotal: Number(convertDiscountTotal || 0),
      notes: convertNotes.trim() || undefined,
    });
    setIsConvertingQuote(false);
    if (!res.success) {
      setActionMessage({ type: 'error', text: res.error || 'تعذر تحويل عرض السعر لفاتورة' });
      return;
    }
    setConvertQuoteTarget(null);
    setActiveTab('invoices');
    setActionMessage({
      type: 'success',
      text: `تم تحويل عرض السعر (${convertQuoteTarget.invoiceNumber}) إلى فاتورة بيع (${res.invoice?.invoiceNumber || ''}) بنجاح.`,
    });
  };

  return (
    <div className="space-y-2">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight">إدارة فواتير المبيعات وعروض الأسعار</h2>
          <p className="text-[11px] text-slate-500">
            عرض وتوليد وطباعة فواتير المبيعات ومراجعة فواتير المناديب وإصدار عروض الأسعار وتحويلها 1:1
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center bg-slate-100 p-0.5 rounded-md text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('invoices')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeTab === 'invoices' ? 'bg-[#011E58] text-white' : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              فواتير المبيعات ({salesInvoices.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('quotes')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeTab === 'quotes' ? 'bg-[#011E58] text-white' : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              عروض الأسعار ({quotesList.length})
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#003589]" />
            <span>تصدير Excel</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setQuoteCustomerId('');
              setQuoteWarehouseId(warehouses[0]?.id || 'wh-main');
              setQuoteRepId('');
              setQuoteDate(new Date().toISOString().split('T')[0]);
              setQuoteDiscountTotal(0);
              setQuoteNotes('');
              setQuoteItems([]);
              setQuoteError(null);
              setIsNewQuoteOpen(true);
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#011E58] hover:bg-[#002160] text-white text-xs font-bold transition-all cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>عرض سعر جديد</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>فاتورة بيع جديدة</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {actionMessage && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{actionMessage.text}</span>
          <button onClick={() => setActionMessage(null)} className="text-xs underline cursor-pointer">
            إغلاق
          </button>
        </div>
      )}

      {/* Invoices Table OR Quotes Table */}
      {activeTab === 'invoices' ? (
        <UnifiedDataTable<Invoice>
          title="سجل فواتير المبيعات"
          subtitle="الفواتير المعتمدة والمسودات والمراجعة الإدارية"
          data={filteredInvoices}
          rowKey={(inv) => inv.id}
          compact
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="بحث برقم الفاتورة أو العميل أو المندوب..."
          exportFilename="AWLAD_SELIM_SalesInvoices"
          pdfTitle="سجل فواتير المبيعات"
          emptyTitle="لا توجد فواتير مبيعات مطابقة لمعايير البحث الحالية"
          toolbarFilters={
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <div className="min-w-[165px]">
                <SearchableFilterSelect
                  id="sales-filter-customer"
                  value={selectedCustomerFilter}
                  onChange={setSelectedCustomerFilter}
                  options={customers.map((c) => ({
                    value: c.id,
                    label: c.shopName || c.name,
                    subtitle: c.phone || c.name,
                    searchText: `${c.name} ${c.shopName || ''} ${c.phone || ''} ${c.code || ''}`,
                  }))}
                  allOptionLabel="جميع العملاء"
                  allOptionValue=""
                  searchPlaceholder="ابحث باسم العميل أو المحل أو الهاتف..."
                  allowClear
                  buttonClassName="rounded-lg min-h-[32px]"
                />
              </div>
              <div className="min-w-[130px]">
                <SearchableFilterSelect
                  id="sales-filter-status"
                  value={statusFilter}
                  onChange={(val) => setStatusFilter((val as any) || 'all')}
                  options={[
                    { value: 'confirmed', label: 'فواتير مؤكدة' },
                    { value: 'draft', label: 'مسودات' },
                    { value: 'cancelled', label: 'فواتير ملغاة / محذوفة' },
                  ]}
                  allOptionLabel="جميع الحالات"
                  allOptionValue="all"
                  allowClear
                  buttonClassName="rounded-lg min-h-[32px]"
                />
              </div>
              <div className="min-w-[145px]">
                <SearchableFilterSelect
                  id="sales-filter-review"
                  value={reviewFilter}
                  onChange={(val) => setReviewFilter((val as any) || 'all')}
                  options={[
                    { value: 'needs_review', label: 'تحتاج مراجعة الإدارة' },
                    { value: 'reviewed', label: 'تمت المراجعة' },
                  ]}
                  allOptionLabel="حالة المراجعة"
                  allOptionValue="all"
                  allowClear
                  buttonClassName="rounded-lg min-h-[32px]"
                />
              </div>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 h-8 text-xs font-mono font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
                title="من تاريخ"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 h-8 text-xs font-mono font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
                title="إلى تاريخ"
              />
            </div>
          }
          columns={[
            {
              key: 'invoiceNumber',
              header: 'رقم الفاتورة',
              sortable: true,
              sortValue: (inv) => inv.invoiceNumber,
              exportValue: (inv) => inv.invoiceNumber,
              render: (inv) => (
                <div className="font-mono font-bold text-[#011E58]">
                  <div>{inv.invoiceNumber}</div>
                  {inv.linkedRepTransferNumber && (
                    <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 bg-[#DCE6F5] border border-[#B8CAE8] text-[#011E58] rounded text-[9px] font-sans font-bold">
                      <span>تحويل عهدة: {inv.linkedRepTransferNumber}</span>
                    </span>
                  )}
                  {inv.linkedCustomerOrderId && (
                    <span className="inline-flex items-center gap-1 mt-0.5 mr-1 px-1.5 py-0.5 bg-[#EEF3FA] border border-[#DCE6F5] text-[#003589] rounded text-[9px] font-sans font-bold">
                      <span>طلب عميل</span>
                    </span>
                  )}
                  {inv.convertedFromQuoteNumber && (
                    <span className="inline-flex items-center gap-1 mt-0.5 mr-1 px-1.5 py-0.5 bg-slate-100 border border-slate-300 text-slate-700 rounded text-[9px] font-sans font-bold">
                      <span>من عرض سعر: {inv.convertedFromQuoteNumber}</span>
                    </span>
                  )}
                  <div className="text-[10px] font-sans font-normal text-slate-500 mt-0.5">
                    بواسطة: {inv.createdBy}
                    {inv.editedBy ? ` · تعديل: ${inv.editedBy}` : ''}
                    {inv.cancelledBy ? ` · إلغاء: ${inv.cancelledBy}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'date',
              header: 'التاريخ',
              sortable: true,
              sortValue: (inv) => inv.date,
              exportValue: (inv) => inv.date,
              render: (inv) => <span className="font-mono text-slate-600">{inv.date}</span>,
            },
            {
              key: 'customerName',
              header: 'العميل',
              sortable: true,
              sortValue: (inv) => inv.customerName || '',
              exportValue: (inv) => inv.customerName || 'نقدي عام',
              render: (inv) => <span className="font-bold text-slate-800">{inv.customerName || 'نقدي عام'}</span>,
            },
            {
              key: 'representativeName',
              header: 'المندوب',
              sortable: true,
              sortValue: (inv) => inv.representativeName || '',
              exportValue: (inv) => inv.representativeName || '-',
              render: (inv) => <span className="text-slate-600">{inv.representativeName || '-'}</span>,
            },
            {
              key: 'warehouseName',
              header: 'المستودع',
              sortable: true,
              sortValue: (inv) => inv.warehouseName || '',
              exportValue: (inv) => inv.warehouseName || '-',
              render: (inv) => <span className="text-slate-600">{inv.warehouseName}</span>,
            },
            {
              key: 'grandTotal',
              header: 'الإجمالي',
              align: 'center',
              sortable: true,
              sortValue: (inv) => inv.grandTotal,
              exportValue: (inv) => inv.grandTotal,
              render: (inv) => (
                <span className="font-black text-slate-900 tabular-nums font-mono">
                  {inv.grandTotal.toLocaleString()} {settings.currency}
                </span>
              ),
            },
            {
              key: 'paidAmount',
              header: 'المدفوع',
              align: 'center',
              sortable: true,
              sortValue: (inv) => inv.paidAmount,
              exportValue: (inv) => inv.paidAmount,
              render: (inv) => <span className="font-bold text-emerald-700 tabular-nums font-mono">{inv.paidAmount.toLocaleString()}</span>,
            },
            {
              key: 'remainingAmount',
              header: 'المتبقي',
              align: 'center',
              sortable: true,
              sortValue: (inv) => inv.remainingAmount,
              exportValue: (inv) => inv.remainingAmount,
              render: (inv) => <span className="font-bold text-red-600 tabular-nums font-mono">{inv.remainingAmount.toLocaleString()}</span>,
            },
            {
              key: 'paymentType',
              header: 'نوع الدفع',
              align: 'center',
              exportValue: (inv) => (inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'credit' ? 'آجل' : 'جزئي'),
              render: (inv) => (
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  inv.paymentType === 'cash' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                  inv.paymentType === 'credit' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                  'bg-blue-50 text-blue-800 border border-blue-200'
                }`}>
                  {inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'credit' ? 'آجل' : 'جزئي'}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'الحالة والمراجعة',
              exportValue: (inv) => `${inv.status === 'confirmed' ? 'مؤكدة' : inv.status === 'draft' ? 'مسودة' : 'ملغاة'}${inv.reviewStatus === 'needs_review' ? ' - تحتاج مراجعة' : inv.reviewStatus === 'reviewed' ? ' - تمت المراجعة' : ''}`,
              render: (inv) => (
                <div className="flex flex-col items-start gap-1">
                  {inv.status === 'confirmed' ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                      مؤكدة
                    </span>
                  ) : inv.status === 'draft' ? (
                    <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                      مسودة (بلا خصم)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
                      ملغاة
                    </span>
                  )}
                  {inv.reviewStatus === 'needs_review' && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                      تحتاج مراجعة الإدارة
                    </span>
                  )}
                  {inv.reviewStatus === 'reviewed' && (
                    <span className="px-2 py-0.5 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] text-[10px] font-bold">
                      تمت المراجعة {inv.reviewedBy ? `(${inv.reviewedBy})` : ''}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: 'actions',
              header: 'الإجراءات',
              align: 'center',
              render: (inv) => (
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  {inv.reviewStatus === 'needs_review' && canReviewInvoices && (
                    <button
                      type="button"
                      onClick={() => {
                        setReviewTarget(inv);
                        setReviewNotesInput(inv.reviewNotes || '');
                      }}
                      className="px-2 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                      title="تأكيد مراجعة فاتورة المندوب بدون تكرار القيد"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>تأكيد المراجعة</span>
                    </button>
                  )}
                  {inv.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => setConfirmDraftTarget(inv)}
                      className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 border border-emerald-200 transition-colors cursor-pointer"
                      title="اعتماد الفاتورة المسودة وخصم المخزون"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                  {inv.status === 'confirmed' && inv.remainingAmount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleOpenPaymentModal(inv)}
                      className="p-1.5 rounded-lg text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 transition-colors cursor-pointer"
                      title="تسجيل دفعة سداد على نفس الفاتورة"
                    >
                      <DollarSign className="w-4 h-4" />
                    </button>
                  )}
                  {inv.status === 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(inv)}
                      className="p-1.5 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-50 transition-colors cursor-pointer"
                      title="تعديل بيانات الفاتورة والأصناف"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handlePrint(inv)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                    title="طباعة (A4 / حراري 80mm / 58mm)"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveInvoice(inv)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                    title="عرض تفاصيل الفاتورة وسجل الدفعات"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {inv.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() => setCancelTarget(inv)}
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                      title="إلغاء الفاتورة"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      ) : (
        <UnifiedDataTable<Invoice>
          title="سجل عروض الأسعار"
          subtitle="عروض الأسعار لا تخصم من المخزون ولا تُقيد مالياً حتى يتم تحويلها لفاتورة بيع معتمدة"
          data={filteredQuotes}
          rowKey={(q) => q.id}
          compact
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="بحث برقم العرض أو العميل..."
          exportFilename="AWLAD_SELIM_Quotes"
          pdfTitle="سجل عروض الأسعار"
          emptyTitle="لا توجد عروض أسعار مسجلة بعد"
          headerActions={
            <button
              type="button"
              onClick={() => setIsNewQuoteOpen(true)}
              className="px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-bold cursor-pointer"
            >
              + إنشاء عرض سعر
            </button>
          }
          toolbarFilters={
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <div className="min-w-[165px]">
                <SearchableFilterSelect
                  id="quotes-filter-customer"
                  value={selectedCustomerFilter}
                  onChange={setSelectedCustomerFilter}
                  options={customers.map((c) => ({
                    value: c.id,
                    label: c.shopName || c.name,
                    subtitle: c.phone || c.name,
                    searchText: `${c.name} ${c.shopName || ''} ${c.phone || ''} ${c.code || ''}`,
                  }))}
                  allOptionLabel="جميع العملاء"
                  allOptionValue=""
                  allowClear
                  buttonClassName="rounded-lg min-h-[32px]"
                />
              </div>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 h-8 text-xs font-mono font-semibold"
                title="من تاريخ"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 h-8 text-xs font-mono font-semibold"
                title="إلى تاريخ"
              />
            </div>
          }
          columns={[
            {
              key: 'invoiceNumber',
              header: 'رقم عرض السعر',
              sortable: true,
              sortValue: (q) => q.invoiceNumber,
              exportValue: (q) => q.invoiceNumber,
              render: (q) => (
                <div className="font-mono font-bold text-blue-900">
                  <div>{q.invoiceNumber}</div>
                  <div className="text-[10px] font-sans font-normal text-slate-500">بواسطة: {q.createdBy}</div>
                </div>
              ),
            },
            {
              key: 'date',
              header: 'التاريخ',
              sortable: true,
              sortValue: (q) => q.date,
              exportValue: (q) => q.date,
              render: (q) => <span className="font-mono text-slate-600">{q.date}</span>,
            },
            {
              key: 'customerName',
              header: 'العميل',
              sortable: true,
              sortValue: (q) => q.customerName || '',
              exportValue: (q) => q.customerName || 'عميل نقدي / عرض سعر عام',
              render: (q) => <span className="font-bold text-slate-800">{q.customerName || 'عميل نقدي / عرض سعر عام'}</span>,
            },
            {
              key: 'warehouseName',
              header: 'المستودع',
              exportValue: (q) => q.warehouseName || '-',
              render: (q) => <span className="text-slate-600">{q.warehouseName}</span>,
            },
            {
              key: 'itemsCount',
              header: 'الأصناف',
              align: 'center',
              sortable: true,
              sortValue: (q) => q.items.length,
              exportValue: (q) => q.items.length,
              render: (q) => <span className="font-mono font-bold">{q.items.length}</span>,
            },
            {
              key: 'grandTotal',
              header: 'الإجمالي',
              align: 'center',
              sortable: true,
              sortValue: (q) => q.grandTotal,
              exportValue: (q) => q.grandTotal,
              render: (q) => (
                <span className="font-black text-slate-900 tabular-nums font-mono">
                  {q.grandTotal.toLocaleString()} {settings.currency}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'الحالة',
              exportValue: (q) => (q.status === 'cancelled' ? 'ملغي' : convertedQuoteIds.has(q.id) ? 'تم التحويل لفاتورة' : 'عرض سعر'),
              render: (q) => {
                const isConverted = convertedQuoteIds.has(q.id);
                return q.status === 'cancelled' ? (
                  <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
                    ملغي
                  </span>
                ) : isConverted ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                    تم التحويل لفاتورة
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-bold">
                    عرض سعر (بلا خصم مخزني)
                  </span>
                );
              },
            },
            {
              key: 'actions',
              header: 'الإجراءات',
              align: 'center',
              render: (quote) => {
                const isConverted = convertedQuoteIds.has(quote.id);
                return (
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    {quote.status !== 'cancelled' && !isConverted && (
                      <button
                        type="button"
                        onClick={() => {
                          setConvertQuoteTarget(quote);
                          setConvertWarehouseId(quote.warehouseId || warehouses[0]?.id || 'wh-main');
                          setConvertCashboxId(cashboxes[0]?.id || 'cb-main');
                          setConvertPaymentType('cash');
                          setConvertPaidAtInvoice(quote.grandTotal);
                          setConvertDiscountTotal(quote.discountTotal || 0);
                          setConvertNotes(quote.notes || '');
                        }}
                        className="px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        <span>تحويل لفاتورة بيع</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handlePrint(quote)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                      title="طباعة عرض السعر"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveInvoice(quote)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                      title="عرض التفاصيل"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {quote.status !== 'cancelled' && !isConverted && (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(quote)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                        title="إلغاء عرض السعر"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      )}

      {/* New Invoice Modal */}
      <NewSaleInvoiceModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onInvoiceCreated={(newInv, shouldPrint) => {
          setActionMessage({
            type: 'success',
            text: `تم حفظ الفاتورة رقم (${newInv.invoiceNumber}) بنجاح${newInv.status === 'draft' ? ' (كمسودة)' : ''}.`,
          });
          if (shouldPrint) {
            handlePrint(newInv);
          }
        }}
      />

      {/* Cancel Invoice Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleExecuteCancelInvoice}
        title={`إلغاء الفاتورة ${cancelTarget?.invoiceNumber || ''}`}
        message="سيتم إلغاء الفاتورة ورد الكميات إلى المخزن وتسوية رصيد العميل والخزينة. يرجى كتابة سبب الإلغاء:"
        confirmLabel="تأكيد إلغاء الفاتورة"
        variant="danger"
        requireInput
        inputLabel="سبب الإلغاء:"
        inputPlaceholder="اكتب سبب إلغاء الفاتورة..."
        isLoading={isConfirmLoading}
      />

      {/* Confirm Draft Invoice Dialog */}
      <ConfirmDialog
        isOpen={!!confirmDraftTarget}
        onClose={() => setConfirmDraftTarget(null)}
        onConfirm={handleExecuteConfirmDraft}
        title={`اعتماد المسودة ${confirmDraftTarget?.invoiceNumber || ''}`}
        message={`هل تريد اعتماد الفاتورة المسودة (${confirmDraftTarget?.invoiceNumber || ''}) الآن؟ سيتم خصم المخزون وتحديث الأرصدة المالية.`}
        confirmLabel="اعتماد الفاتورة الآن"
        variant="success"
        isLoading={isConfirmLoading}
      />

      {/* Print Document Modal */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />

      {/* View Detail Modal */}
      {activeInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-right max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <h3 className="text-sm font-black text-slate-900">
                تفاصيل الفاتورة: {activeInvoice.invoiceNumber}
              </h3>
              <button
                onClick={() => setActiveInvoice(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                إغلاق ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs mb-2 p-2 bg-slate-50 rounded-md border border-slate-200">
              <div>
                <p className="text-slate-500">العميل: <strong className="text-slate-800">{activeInvoice.customerName}</strong></p>
                <p className="text-slate-500">المستودع: <strong className="text-slate-800">{activeInvoice.warehouseName}</strong></p>
                <p className="text-slate-500">أنشئت بواسطة: <strong className="text-slate-800">{activeInvoice.createdBy}</strong></p>
                {activeInvoice.convertedFromQuoteNumber && (
                  <p className="text-slate-500">محولة من عرض سعر: <strong className="font-mono text-blue-900">{activeInvoice.convertedFromQuoteNumber}</strong></p>
                )}
              </div>
              <div>
                <p className="text-slate-500">التاريخ: <strong className="font-mono text-slate-800">{activeInvoice.date}</strong></p>
                <p className="text-slate-500">المندوب: <strong className="text-slate-800">{activeInvoice.representativeName || '-'}</strong></p>
                {activeInvoice.reviewedBy && (
                  <p className="text-emerald-700">مراجعة الإدارة: <strong>{activeInvoice.reviewedBy}</strong> {activeInvoice.reviewNotes ? `(${activeInvoice.reviewNotes})` : ''}</p>
                )}
                {activeInvoice.editedBy && (
                  <p className="text-amber-700">آخر تعديل: <strong>{activeInvoice.editedBy}</strong></p>
                )}
                {activeInvoice.cancelledBy && (
                  <p className="text-red-700">ألغيت بواسطة: <strong>{activeInvoice.cancelledBy}</strong> {activeInvoice.cancelReason ? `— ${activeInvoice.cancelReason}` : ''}</p>
                )}
              </div>
            </div>

            <div className="mb-3">
              <UnifiedDataTable<InvoiceItem>
                title="أصناف الفاتورة"
                data={activeInvoice.items}
                rowKey={(it, i) => `${it.productId || it.productName}-${i}`}
                searchable={false}
                compact
                defaultPageSize={25}
                columns={[
                  {
                    key: 'productName',
                    header: 'الصنف',
                    render: (it) => <span className="font-semibold">{it.productName}</span>,
                  },
                  {
                    key: 'unit',
                    header: 'الوحدة',
                    align: 'center',
                    render: (it) => <span>{it.unit}</span>,
                  },
                  {
                    key: 'quantity',
                    header: 'الكمية',
                    align: 'center',
                    render: (it) => <span className="font-bold font-mono tabular-nums">{it.quantity}</span>,
                  },
                  {
                    key: 'unitPrice',
                    header: 'السعر',
                    align: 'center',
                    render: (it) => <span className="font-mono tabular-nums">{it.unitPrice}</span>,
                  },
                  {
                    key: 'total',
                    header: 'الإجمالي',
                    align: 'center',
                    render: (it) => <span className="font-bold font-mono text-blue-900 tabular-nums">{it.total}</span>,
                  },
                ]}
              />
            </div>

            {/* Payments History on this Invoice */}
            <div className="mt-3 mb-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-emerald-700" />
                  <h4 className="text-xs font-black text-slate-800">
                    سجل الدفعات المسددة على هذه الفاتورة ({activeInvoice.payments?.length || (activeInvoice.paidAmount > 0 ? 1 : 0)})
                  </h4>
                </div>
                {activeInvoice.remainingAmount > 0 && activeInvoice.status === 'confirmed' && (
                  <button
                    onClick={() => {
                      const inv = activeInvoice;
                      setActiveInvoice(null);
                      handleOpenPaymentModal(inv);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>سداد دفعة جديدة</span>
                  </button>
                )}
              </div>

              {(!activeInvoice.payments || activeInvoice.payments.length === 0) ? (
                <div className="text-[11px] text-slate-500 py-1">
                  {activeInvoice.paidAmount > 0 ? (
                    <p>تم سداد دفعة نقدية بقيمة <strong className="text-emerald-700 font-bold">{activeInvoice.paidAmount.toLocaleString()} {settings.currency}</strong> عند إنشاء الفاتورة.</p>
                  ) : (
                    <p className="text-amber-700">فاتورة آجلة بالكامل، لم يتم سداد أي دفعات بعد.</p>
                  )}
                </div>
              ) : (
                <UnifiedDataTable
                  title="سجل الدفعات"
                  data={activeInvoice.payments}
                  rowKey={(p) => p.id}
                  searchable={false}
                  compact
                  defaultPageSize={10}
                  columns={[
                    {
                      key: 'date',
                      header: 'التاريخ',
                      render: (p) => <span className="font-mono">{p.date}</span>,
                    },
                    {
                      key: 'amount',
                      header: 'المبلغ',
                      render: (p) => <span className="font-black text-emerald-700 font-mono tabular-nums">{p.amount.toLocaleString()} {settings.currency}</span>,
                    },
                    {
                      key: 'method',
                      header: 'طريقة الدفع',
                      render: (p) => <span>{p.paymentMethod === 'cash' ? 'نقدي' : p.paymentMethod === 'bank' ? 'بنكي' : 'شيك'}</span>,
                    },
                    {
                      key: 'cashboxName',
                      header: 'الخزينة',
                      render: (p) => <span className="text-slate-600">{p.cashboxName}</span>,
                    },
                    {
                      key: 'createdBy',
                      header: 'المستخدم',
                      render: (p) => <span className="text-slate-500">{p.createdBy}</span>,
                    },
                    {
                      key: 'notes',
                      header: 'ملاحظات',
                      render: (p) => <span className="text-slate-500">{p.notes || '-'}</span>,
                    },
                  ]}
                />
              )}
            </div>

            {Array.isArray(activeInvoice.editHistory) && activeInvoice.editHistory.length > 0 && (
              <div className="mb-3 p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  <h4 className="text-xs font-black text-amber-950">
                    سجل التعديلات السابقة ({activeInvoice.editHistory.length})
                  </h4>
                </div>
                <div className="space-y-1">
                  {activeInvoice.editHistory.map((entry, idx) => (
                    <div
                      key={`${entry.editedAt}-${idx}`}
                      className="p-2 bg-white border border-amber-200/80 rounded-lg text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-900">
                          بواسطة: {entry.editedBy || 'غير محدد'}
                          {entry.reason ? ` · السبب: ${entry.reason}` : ''}
                        </div>
                        {entry.before && entry.after && (
                          <div className="text-slate-600 font-mono">
                            الإجمالي: {Number(entry.before.grandTotal ?? 0).toLocaleString()} →{' '}
                            <strong className="text-blue-900">{Number(entry.after.grandTotal ?? 0).toLocaleString()} {settings.currency}</strong>
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-slate-500 shrink-0" dir="ltr">
                        {entry.editedAt ? new Date(entry.editedAt).toLocaleString('ar-EG') : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2.5 border-t text-xs">
              <div className="flex items-center gap-3 text-slate-600">
                <span>الإجمالي: <strong className="text-sm font-black text-slate-900">{activeInvoice.grandTotal.toLocaleString()} {settings.currency}</strong></span>
                <span>المدفوع: <strong className="text-sm font-bold text-emerald-700">{activeInvoice.paidAmount.toLocaleString()}</strong></span>
                <span>المتبقي: <strong className="text-sm font-bold text-red-600">{activeInvoice.remainingAmount.toLocaleString()}</strong></span>
              </div>
              <button
                onClick={() => {
                  const inv = activeInvoice;
                  setActiveInvoice(null);
                  handlePrint(inv);
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-[#003589] text-white rounded-md font-bold hover:bg-[#0049B0] transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة هذه الفاتورة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Subsequent Payment Modal */}
      {paymentModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-right animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  تسجيل دفعة على الفاتورة: {paymentModalInvoice.invoiceNumber}
                </h3>
                <p className="text-[11px] text-slate-500">
                  العميل: <strong className="text-slate-800">{paymentModalInvoice.customerName || 'نقدي عام'}</strong>
                </p>
              </div>
              <button
                onClick={() => setPaymentModalInvoice(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {paymentError && (
              <div className="mb-2 p-2 bg-red-50 border border-red-200 text-red-700 rounded-md text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{paymentError}</span>
              </div>
            )}

            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-px bg-slate-200 rounded-md overflow-hidden text-center text-xs mb-2 border border-slate-200">
              <div className="bg-slate-50 px-2 py-1">
                <span className="block text-[10px] text-slate-500">إجمالي الفاتورة</span>
                <span className="font-bold text-slate-800 tabular-nums">{paymentModalInvoice.grandTotal.toLocaleString()} {settings.currency}</span>
              </div>
              <div className="bg-slate-50 px-2 py-1">
                <span className="block text-[10px] text-slate-500">المدفوع سابقاً</span>
                <span className="font-bold text-emerald-700 tabular-nums">{paymentModalInvoice.paidAmount.toLocaleString()}</span>
              </div>
              <div className="bg-slate-50 px-2 py-1">
                <span className="block text-[10px] text-slate-500">المتبقي المطلوب</span>
                <span className="font-black text-red-600 tabular-nums">{paymentModalInvoice.remainingAmount.toLocaleString()} {settings.currency}</span>
              </div>
            </div>

            <form onSubmit={handleSubmitPayment} className="space-y-2 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">قيمة الدفعة الجديدة ({settings.currency}):</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={paymentModalInvoice.remainingAmount}
                  placeholder="0.00"
                  value={paymentAmount || ''}
                  onChange={(e) => setPaymentAmount(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                  className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-bold text-sm text-emerald-800 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">الخزينة / الحساب المستلم:</label>
                  <select
                    value={paymentCashboxId}
                    onChange={(e) => setPaymentCashboxId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white"
                  >
                    {cashboxes.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.balanceHidden ? `${c.name} (رصيد محجوب)` : `${c.name} (${(c.currentBalance ?? 0).toLocaleString()} ${settings.currency})`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">طريقة الدفع:</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white"
                  >
                    <option value="cash">نقداً (كاش)</option>
                    <option value="bank">تحويل بنكي</option>
                    <option value="cheque">شيك مصرفي</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">تاريخ الدفعة:</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">ملاحظات / رقم الإيصال:</label>
                  <input
                    type="text"
                    placeholder="ملاحظات أو رقم التحويل..."
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-1.5 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setPaymentModalInvoice(null)}
                  className="px-3 py-1 rounded-md border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPayment || paymentAmount <= 0}
                  className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingPayment ? 'جاري الحفظ...' : 'تأكيد وقبض الدفعة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Invoice Modal */}
      {editModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-right max-h-[90vh] overflow-y-auto animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  تعديل الفاتورة رقم: {editModalInvoice.invoiceNumber}
                </h3>
                <p className="text-[11px] text-slate-500">
                  العميل: <strong className="text-slate-800">{editModalInvoice.customerName}</strong> | المستودع: <strong className="text-slate-800">{editModalInvoice.warehouseName}</strong>
                </p>
              </div>
              <button
                onClick={() => setEditModalInvoice(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {editError && (
              <div className="mb-2 p-2 bg-red-50 border border-red-200 text-red-700 rounded-md text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitEdit} className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">تاريخ الفاتورة:</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">إجمالي الخصم ({settings.currency}):</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={editDiscount || ''}
                    onChange={(e) => setEditDiscount(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-bold"
                  />
                </div>
              </div>

              {/* Items Table for Editing Quantities & Prices */}
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">أصناف الفاتورة (تعديل الكميات والأسعار):</label>
                <div className="border border-slate-200 rounded-lg overflow-hidden awlad-table-scroll">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                        <th className="px-2 py-1.5">الصنف</th>
                        <th className="px-2 py-1.5 text-center">الوحدة</th>
                        <th className="px-2 py-1.5 text-center w-24">الكمية</th>
                        <th className="px-2 py-1.5 text-center w-28">السعر</th>
                        <th className="px-2 py-1.5 text-center">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-2 py-1 font-bold text-slate-800">{item.productName}</td>
                          <td className="px-2 py-1 text-center text-slate-600">{item.unit}</td>
                          <td className="px-2 py-1 text-center">
                            <QuantityInput
                              allowDecimals
                              min={0.001}
                              value={item.quantity}
                              onChange={(newQty) => {
                                setEditItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? {
                                          ...it,
                                          quantity: newQty,
                                          total: computeLineTotal(newQty, it.unitPrice, it.discount || 0),
                                        }
                                      : it
                                  )
                                );
                              }}
                              ariaLabel={`كمية ${item.productName}`}
                              inputClassName="w-20 px-1.5 py-0.5 rounded-md border border-slate-300 text-center font-bold font-mono outline-hidden focus:border-blue-700"
                            />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={item.unitPrice}
                              onChange={(e) => {
                                const newPrice = parseFloat(e.target.value) || 0;
                                setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, unitPrice: newPrice, total: (it.quantity * newPrice) - (it.discount || 0) } : it));
                              }}
                              className="w-24 px-1.5 py-0.5 rounded-md border border-slate-300 text-center font-bold"
                            />
                          </td>
                          <td className="px-2 py-1 text-center font-black text-blue-900 tabular-nums">
                            {((item.quantity * item.unitPrice) - (item.discount || 0)).toLocaleString()} {settings.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-0.5">ملاحظات الفاتورة:</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-2 py-1 rounded-md border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-0.5">
                  سبب التعديل (إلزامي للتدقيق): <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="مثال: تصحيح كمية الصنف أو تعديل السعر المتفق عليه..."
                  className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-semibold focus:border-blue-600 outline-hidden"
                />
              </div>

              {/* Recalculated Summary */}
              {(() => {
                const subtotal = editItems.reduce((acc, it) => acc + (it.quantity * it.unitPrice), 0);
                const grand = Math.max(0, subtotal - editDiscount);
                const diff = grand - editModalInvoice.grandTotal;
                return (
                  <div className="p-2 bg-blue-50/70 rounded-md border border-blue-200 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-600 block text-[10px]">الإجمالي المحسوب الجديد:</span>
                      <strong className="text-sm font-black text-blue-950">{grand.toLocaleString()} {settings.currency}</strong>
                    </div>
                    <div>
                      <span className="text-slate-600 block text-[10px]">الفرق عن الفاتورة الأصلية:</span>
                      <strong className={`text-sm font-black ${diff > 0 ? 'text-red-700' : diff < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                        {diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()} {settings.currency}
                      </strong>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-1.5 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setEditModalInvoice(null)}
                  className="px-3 py-1 rounded-md border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingEdit ? 'جاري حفظ التعديل...' : 'حفظ وتحديث الفاتورة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Rep Invoice Review Modal */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-right">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <h3 className="text-sm font-black text-slate-900">
                تأكيد مراجعة فاتورة المندوب ({reviewTarget.invoiceNumber})
              </h3>
              <button type="button" onClick={() => setReviewTarget(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer">
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-2">
              هذه الفاتورة نُفذت وقُيدت بالفعل في المخزون والحسابات من تطبيق المندوب ({reviewTarget.representativeName || reviewTarget.createdBy}). تأكيد المراجعة يحدّث حالة المراجعة فقط دون تكرار أي قيد.
            </p>
            <form onSubmit={handleSubmitReview} className="space-y-2 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">ملاحظات المراجعة (اختياري):</label>
                <textarea
                  rows={2}
                  value={reviewNotesInput}
                  onChange={(e) => setReviewNotesInput(e.target.value)}
                  placeholder="ملاحظة الإدارة على الفاتورة..."
                  className="w-full px-2 py-1 rounded-md border border-slate-300"
                />
              </div>
              <div className="flex justify-end gap-1.5 pt-2 border-t">
                <button type="button" onClick={() => setReviewTarget(null)} className="px-3 py-1 rounded-md border border-slate-300 font-bold cursor-pointer">
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReview}
                  className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingReview ? 'جاري التأكيد...' : 'اعتماد المراجعة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Quote Modal */}
      {isNewQuoteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-right max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <div>
                <h3 className="text-sm font-black text-slate-900">إنشاء عرض سعر جديد</h3>
                <p className="text-[11px] text-slate-500">لا يخصم من المخزون ولا يُقيد مالياً إلا بعد التحويل لفاتورة بيع</p>
              </div>
              <button type="button" onClick={() => setIsNewQuoteOpen(false)} className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer">
                ✕
              </button>
            </div>

            {quoteError && (
              <div className="mb-2 p-2 bg-red-50 border border-red-200 text-red-700 rounded-md text-xs font-bold">
                {quoteError}
              </div>
            )}

            <form onSubmit={handleSubmitQuote} className="space-y-2 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">العميل:</label>
                  <select
                    value={quoteCustomerId}
                    onChange={(e) => setQuoteCustomerId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    <option value="">-- عميل عام / نقدي --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">المستودع المقترح:</label>
                  <select
                    value={quoteWarehouseId}
                    onChange={(e) => setQuoteWarehouseId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">التاريخ:</label>
                  <input
                    type="date"
                    value={quoteDate}
                    onChange={(e) => setQuoteDate(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-mono"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                <label className="block font-bold text-slate-700">إضافة أصناف لعرض السعر:</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <ProductSearchSelect
                      products={products}
                      warehouses={warehouses}
                      warehouseId={quoteWarehouseId}
                      selectedProductId={quoteSelectedProductId}
                      onSelect={(p) => {
                        setQuoteSelectedProductId(p.id);
                        handleAddQuoteItem(p.id);
                      }}
                      clearOnSelect
                      currency={settings.currency}
                    />
                  </div>
                  <div className="w-28">
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={quoteQty}
                      onChange={setQuoteQty}
                      ariaLabel="الكمية"
                      inputClassName="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden awlad-table-scroll">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-100 font-bold text-slate-700 border-b">
                      <th className="p-2">الصنف</th>
                      <th className="p-2 text-center">الوحدة</th>
                      <th className="p-2 text-center">الكمية</th>
                      <th className="p-2 text-center">السعر</th>
                      <th className="p-2 text-center">الإجمالي</th>
                      <th className="p-2 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {quoteItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-400">لم تُضف أصناف بعد</td>
                      </tr>
                    ) : (
                      quoteItems.map((it, idx) => (
                        <tr key={`${it.productId}-${idx}`}>
                          <td className="p-2 font-bold">{it.productName}</td>
                          <td className="p-2 text-center">{it.unit}</td>
                          <td className="p-2 text-center">
                            <QuantityInput
                              allowDecimals
                              min={0.001}
                              value={it.quantity}
                              onChange={(val) =>
                                setQuoteItems((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, quantity: val, total: computeLineTotal(val, row.unitPrice, row.discount || 0) } : row
                                  )
                                )
                              }
                              ariaLabel={`كمية ${it.productName}`}
                              inputClassName="w-20 p-1 rounded-md border border-slate-300 text-center font-mono font-bold"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <input
                              type="number"
                              min={0}
                              step="0.5"
                              value={it.unitPrice}
                              onChange={(e) => {
                                const price = parseFloat(e.target.value) || 0;
                                setQuoteItems((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, unitPrice: price, total: computeLineTotal(row.quantity, price, row.discount || 0) } : row
                                  )
                                );
                              }}
                              className="w-24 p-1 rounded-md border border-slate-300 text-center font-mono font-bold"
                            />
                          </td>
                          <td className="p-2 text-center font-black text-blue-900 tabular-nums">
                            {it.total.toLocaleString()} {settings.currency}
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => setQuoteItems((prev) => prev.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700 font-bold cursor-pointer"
                            >
                              حذف
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">المندوب (اختياري):</label>
                  <select
                    value={quoteRepId}
                    onChange={(e) => setQuoteRepId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    <option value="">-- بدون مندوب --</option>
                    {representatives.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">الخصم الإجمالي ({settings.currency}):</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={quoteDiscountTotal}
                    onChange={(e) => setQuoteDiscountTotal(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">ملاحظات عرض السعر:</label>
                  <input
                    type="text"
                    value={quoteNotes}
                    onChange={(e) => setQuoteNotes(e.target.value)}
                    placeholder="مدة الصلاحية أو شروط السداد..."
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <div className="text-sm font-black text-blue-950 tabular-nums">
                  الصافي المقترح: {Math.max(0, quoteItems.reduce((s, it) => s + it.total, 0) - Number(quoteDiscountTotal || 0)).toLocaleString()} {settings.currency}
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setIsNewQuoteOpen(false)} className="px-3 py-1 rounded-md border border-slate-300 font-bold cursor-pointer">
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingQuote || quoteItems.length === 0}
                    className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                  >
                    {isSubmittingQuote ? 'جاري الحفظ...' : 'حفظ عرض السعر'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Convert Quote to Sales Invoice Modal */}
      {convertQuoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-right">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <h3 className="text-sm font-black text-slate-900">
                تحويل عرض السعر {convertQuoteTarget.invoiceNumber} إلى فاتورة بيع
              </h3>
              <button type="button" onClick={() => setConvertQuoteTarget(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer">
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmitConvertQuote} className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">مستودع الصرف:</label>
                  <select
                    value={convertWarehouseId}
                    onChange={(e) => setConvertWarehouseId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">الخزينة:</label>
                  <select
                    value={convertCashboxId}
                    onChange={(e) => setConvertCashboxId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    {cashboxes.map((cb) => (
                      <option key={cb.id} value={cb.id}>{cb.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">نوع الدفع:</label>
                  <select
                    value={convertPaymentType}
                    onChange={(e) => {
                      const nextType = e.target.value as 'cash' | 'partial' | 'credit';
                      setConvertPaymentType(nextType);
                      if (nextType === 'cash') {
                        setConvertPaidAtInvoice(Math.max(0, convertQuoteTarget.subtotal - Number(convertDiscountTotal || 0)));
                      } else if (nextType === 'credit') {
                        setConvertPaidAtInvoice('');
                      }
                    }}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    <option value="cash">نقدي</option>
                    <option value="partial">جزئي</option>
                    <option value="credit">آجل</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">المدفوع:</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={convertPaidAtInvoice}
                    onChange={(e) => setConvertPaidAtInvoice(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">الخصم:</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={convertDiscountTotal}
                    onChange={(e) => setConvertDiscountTotal(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-mono font-bold"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">ملاحظات الفاتورة:</label>
                <input
                  type="text"
                  value={convertNotes}
                  onChange={(e) => setConvertNotes(e.target.value)}
                  className="w-full h-8 px-2 py-1 rounded-md border border-slate-300"
                />
              </div>
              <div className="flex justify-end gap-1.5 pt-2 border-t">
                <button type="button" onClick={() => setConvertQuoteTarget(null)} className="px-3 py-1 rounded-md border border-slate-300 font-bold cursor-pointer">
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isConvertingQuote}
                  className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {isConvertingQuote ? 'جاري التحويل...' : 'تأكيد التحويل لفاتورة بيع'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus, Filter, Printer, Download, Eye, XCircle,
  CheckCircle, FileText, Calendar, ArrowLeftRight, DollarSign,
  Edit, AlertCircle, Check, History, Clock
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime, formatLocaleNumber, translateSystemEntityName } from '../../../i18n/translator';
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
  const { t, isLtr, locale } = usePreferences();
  const fmt = (n: number) => formatLocaleNumber(n);
  const currencyLabel = t(settings.currency);
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
      title: isQuote
        ? t('عرض سعر — أولاد سليم', 'Price Quote — Awlad Selim')
        : t('فاتورة مبيعات أولاد سليم', 'Awlad Selim Sales Invoice'),
      docNumber: inv.invoiceNumber,
      docType: isQuote ? t('عرض سعر', 'Price Quote') : t('فاتورة مبيعات', 'Sales Invoice'),
      date: inv.date,
      partyName: inv.customerName ? translateSystemEntityName(inv.customerName) : undefined,
      warehouseName: inv.warehouseName ? translateSystemEntityName(inv.warehouseName) : undefined,
      representativeName: inv.representativeName,
      paymentType: isQuote
        ? t('عرض سعر استرشادي (بلا أثر مخزني أو مالي)', 'Indicative Price Quote (No stock/financial impact)')
        : inv.paymentType === 'cash'
        ? t('نقدي', 'Cash')
        : inv.paymentType === 'credit'
        ? t('آجل', 'Credit')
        : t('جزئي', 'Partial'),
      items: inv.items.map(it => ({
        name: it.productName,
        unit: t(it.unit),
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
      t('رقم الفاتورة', 'Invoice No.'),
      t('التاريخ', 'Date'),
      t('العميل', 'Customer'),
      t('المندوب', 'Representative'),
      t('المستودع', 'Warehouse'),
      t('الإجمالي', 'Total'),
      t('المدفوع', 'Paid'),
      t('المتبقي', 'Remaining'),
      t('نوع السداد', 'Payment Type'),
      t('الحالة', 'Status'),
      t('الملاحظات', 'Notes')
    ];

    const rows = filteredInvoices.map(inv => [
      inv.invoiceNumber,
      inv.date,
      inv.customerName ? translateSystemEntityName(inv.customerName) : t('نقدي', 'Cash'),
      inv.representativeName || '-',
      inv.warehouseName ? translateSystemEntityName(inv.warehouseName) : '-',
      inv.grandTotal,
      inv.paidAmount,
      inv.remainingAmount,
      inv.paymentType === 'cash' ? t('نقدي', 'Cash') : inv.paymentType === 'credit' ? t('آجل', 'Credit') : t('جزئي', 'Partial'),
      inv.status === 'confirmed' ? t('مؤكدة', 'Confirmed') : inv.status === 'draft' ? t('مسودة', 'Draft') : t('ملغاة', 'Cancelled'),
      inv.notes || ''
    ]);

    exportToExcel(
      `${isLtr ? 'AWLAD_SELIM_SalesInvoices' : 'فواتير_مبيعات_أولاد_سليم'}_${new Date().toISOString().split('T')[0]}`,
      headers,
      rows
    );
  };

  const handleExecuteCancelInvoice = async (reason?: string) => {
    if (!cancelTarget || !reason) return;
    setIsConfirmLoading(true);
    const res = await cancelInvoice(cancelTarget.id, reason);
    setIsConfirmLoading(false);
    if (!res.success) {
      setActionMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر إلغاء الفاتورة', 'Unable to cancel invoice') });
    } else {
      setActionMessage({
        type: 'success',
        text: isLtr
          ? `Invoice (${cancelTarget.invoiceNumber}) cancelled successfully.`
          : `تم إلغاء الفاتورة (${cancelTarget.invoiceNumber}) بنجاح.`,
      });
      setCancelTarget(null);
    }
  };

  const handleExecuteConfirmDraft = async () => {
    if (!confirmDraftTarget) return;
    setIsConfirmLoading(true);
    const res = await confirmDraftInvoice(confirmDraftTarget.id);
    setIsConfirmLoading(false);
    if (!res.success) {
      setActionMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر اعتماد الفاتورة المسودة', 'Unable to confirm draft invoice') });
    } else {
      setActionMessage({
        type: 'success',
        text: isLtr
          ? `Invoice (${confirmDraftTarget.invoiceNumber}) confirmed and inventory & accounts updated successfully.`
          : `تم اعتماد الفاتورة (${confirmDraftTarget.invoiceNumber}) وتحديث المخزون والحسابات بنجاح.`,
      });
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
      setPaymentError(res.error ? t(res.error) : t('تعذر تسجيل الدفعة', 'Unable to record payment'));
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
      setEditError(t('يرجى كتابة سبب تعديل الفاتورة لتوثيقه في سجل المراجعة.', 'Please enter a reason for editing the invoice to document it in the audit log.'));
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
      setEditError(res.error ? t(res.error) : t('تعذر تعديل الفاتورة', 'Unable to update invoice'));
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
      setQuoteError(t('أضف صنفاً واحداً على الأقل لعرض السعر', 'Add at least one item to the price quote'));
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
      setQuoteError(res.error ? t(res.error) : t('تعذر إنشاء عرض السعر', 'Unable to create price quote'));
      return;
    }
    setIsNewQuoteOpen(false);
    setQuoteItems([]);
    setQuoteNotes('');
    setQuoteDiscountTotal('');
    setActionMessage({
      type: 'success',
      text: isLtr
        ? `Price quote (${res.invoice?.invoiceNumber || ''}) created successfully with no impact on stock or accounts.`
        : `تم إنشاء عرض السعر (${res.invoice?.invoiceNumber || ''}) بنجاح دون أي تأثير على المخزون أو الحسابات.`,
    });
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewTarget) return;
    setIsSubmittingReview(true);
    const res = await markInvoiceReviewed(reviewTarget.id, reviewNotesInput.trim() || undefined);
    setIsSubmittingReview(false);
    if (!res.success) {
      setActionMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر تأكيد مراجعة الفاتورة', 'Unable to confirm invoice review') });
    } else {
      setActionMessage({
        type: 'success',
        text: isLtr
          ? `Rep invoice (${reviewTarget.invoiceNumber}) review confirmed successfully without duplicating entries or stock.`
          : `تم اعتماد مراجعة فاتورة المندوب (${reviewTarget.invoiceNumber}) بنجاح دون تكرار القيد أو المخزون.`,
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
      setActionMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر تحويل عرض السعر لفاتورة', 'Unable to convert quote to invoice') });
      return;
    }
    setConvertQuoteTarget(null);
    setActiveTab('invoices');
    setActionMessage({
      type: 'success',
      text: isLtr
        ? `Quote (${convertQuoteTarget.invoiceNumber}) converted to sales invoice (${res.invoice?.invoiceNumber || ''}) successfully.`
        : `تم تحويل عرض السعر (${convertQuoteTarget.invoiceNumber}) إلى فاتورة بيع (${res.invoice?.invoiceNumber || ''}) بنجاح.`,
    });
  };

  return (
    <div className="space-y-2">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white dark:bg-[#0E1C36] px-2.5 py-2 rounded-lg border border-slate-200 dark:border-[#21375C]">
        <div>
          <h2 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC] tracking-tight">
            {t('إدارة فواتير المبيعات وعروض الأسعار', 'Sales Invoices & Price Quotes')}
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-[#97AECE]">
            {t(
              'عرض وتوليد وطباعة فواتير المبيعات ومراجعة فواتير المناديب وإصدار عروض الأسعار وتحويلها 1:1',
              'View, create, and print sales invoices, review rep invoices, issue price quotes, and convert 1:1'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center bg-slate-100 dark:bg-[#132544] dark:border dark:border-[#21375C] p-0.5 rounded-md text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('invoices')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeTab === 'invoices'
                  ? 'bg-[#011E58] dark:bg-[#1659C8] text-white'
                  : 'text-slate-700 dark:text-[#A9BCD9] hover:text-slate-900 dark:hover:text-[#F3F7FC]'
              }`}
            >
              {t('فواتير المبيعات', 'Sales Invoices')} ({fmt(salesInvoices.length)})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('quotes')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeTab === 'quotes'
                  ? 'bg-[#011E58] dark:bg-[#1659C8] text-white'
                  : 'text-slate-700 dark:text-[#A9BCD9] hover:text-slate-900 dark:hover:text-[#F3F7FC]'
              }`}
            >
              {t('عروض الأسعار', 'Price Quotes')} ({fmt(quotesList.length)})
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-[#2A436E] dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] text-xs font-bold hover:bg-slate-50 dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#003589] dark:text-[#85B8FF]" />
            <span>{t('تصدير Excel', 'Export Excel')}</span>
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
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#011E58] hover:bg-[#002160] dark:bg-[#173C7E] dark:hover:bg-[#1659C8] dark:border dark:border-[#2E5CA8] text-white text-xs font-bold transition-all cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{t('عرض سعر جديد', 'New Quote')}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white text-xs font-black transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('فاتورة بيع جديدة', 'New Sales Invoice')}</span>
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
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {/* Invoices Table OR Quotes Table */}
      {activeTab === 'invoices' ? (
        <UnifiedDataTable<Invoice>
          title={t('سجل فواتير المبيعات', 'Sales Invoices Log')}
          subtitle={t('الفواتير المعتمدة والمسودات والمراجعة الإدارية', 'Confirmed invoices, drafts, and administrative review')}
          data={filteredInvoices}
          rowKey={(inv) => inv.id}
          onRowClick={(inv) => setActiveInvoice(inv)}
          compact
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder={t('بحث برقم الفاتورة أو العميل أو المندوب...', 'Search by invoice #, customer, or rep...')}
          exportFilename="AWLAD_SELIM_SalesInvoices"
          pdfTitle={t('سجل فواتير المبيعات', 'Sales Invoices Log')}
          emptyTitle={t('لا توجد فواتير مبيعات مطابقة لمعايير البحث الحالية', 'No sales invoices match the current search criteria')}
          toolbarFilters={
            <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
              <div className="w-[155px] shrink-0">
                <SearchableFilterSelect
                  id="sales-filter-customer"
                  inlinePrefix={t('العميل', 'Customer')}
                  value={selectedCustomerFilter}
                  onChange={setSelectedCustomerFilter}
                  options={customers.map((c) => ({
                    value: c.id,
                    label: c.shopName || c.name,
                    subtitle: c.phone || c.name,
                    searchText: `${c.name} ${c.shopName || ''} ${c.phone || ''} ${c.code || ''}`,
                  }))}
                  allOptionLabel={t('الكل', 'All')}
                  allOptionValue=""
                  searchPlaceholder={t('ابحث باسم العميل أو المحل أو الهاتف...', 'Search by customer, shop, or phone...')}
                  allowClear
                  buttonClassName="rounded-md h-8 min-h-[32px]"
                />
              </div>
              <div className="w-[130px] shrink-0">
                <SearchableFilterSelect
                  id="sales-filter-status"
                  inlinePrefix={t('الحالة', 'Status')}
                  value={statusFilter}
                  onChange={(val) => setStatusFilter((val as any) || 'all')}
                  options={[
                    { value: 'confirmed', label: t('فواتير مؤكدة', 'Confirmed Invoices') },
                    { value: 'draft', label: t('مسودات', 'Drafts') },
                    { value: 'cancelled', label: t('فواتير ملغاة / محذوفة', 'Cancelled / Deleted Invoices') },
                  ]}
                  allOptionLabel={t('الكل', 'All')}
                  allOptionValue="all"
                  allowClear
                  buttonClassName="rounded-md h-8 min-h-[32px]"
                />
              </div>
              <div className="w-[140px] shrink-0">
                <SearchableFilterSelect
                  id="sales-filter-review"
                  inlinePrefix={t('المراجعة', 'Review')}
                  value={reviewFilter}
                  onChange={(val) => setReviewFilter((val as any) || 'all')}
                  options={[
                    { value: 'needs_review', label: t('تحتاج مراجعة الإدارة', 'Needs Admin Review') },
                    { value: 'reviewed', label: t('تمت المراجعة', 'Reviewed') },
                  ]}
                  allOptionLabel={t('الكل', 'All')}
                  allOptionValue="all"
                  allowClear
                  buttonClassName="rounded-md h-8 min-h-[32px]"
                />
              </div>
              <label className="inline-flex items-center gap-1 h-8 px-2 bg-slate-50 dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md shrink-0">
                <span className="text-[10.5px] font-bold text-slate-500">{t('من:', 'From:')}</span>
                <input
                  type="date"
                  aria-label={t('من تاريخ', 'From date')}
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-xs font-mono font-semibold text-slate-800 dark:text-[#EEF4FC] outline-hidden"
                  title={t('من تاريخ', 'From date')}
                />
              </label>
              <label className="inline-flex items-center gap-1 h-8 px-2 bg-slate-50 dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md shrink-0">
                <span className="text-[10.5px] font-bold text-slate-500">{t('إلى:', 'To:')}</span>
                <input
                  type="date"
                  aria-label={t('إلى تاريخ', 'To date')}
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent text-xs font-mono font-semibold text-slate-800 dark:text-[#EEF4FC] outline-hidden"
                  title={t('إلى تاريخ', 'To date')}
                />
              </label>
            </div>
          }
          columns={[
            {
              key: 'invoiceNumber',
              header: t('رقم الفاتورة', 'Invoice No.'),
              sortable: true,
              sortValue: (inv) => inv.invoiceNumber,
              exportValue: (inv) => inv.invoiceNumber,
              render: (inv) => (
                <div className="font-mono font-bold text-[#011E58]">
                  <div>{inv.invoiceNumber}</div>
                  {inv.linkedRepTransferNumber && (
                    <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 bg-[#DCE6F5] border border-[#B8CAE8] text-[#011E58] rounded text-[9px] font-sans font-bold">
                      <span>{t('تحويل عهدة:', 'Custody transfer:')} {inv.linkedRepTransferNumber}</span>
                    </span>
                  )}
                  {inv.linkedCustomerOrderId && (
                    <span className="inline-flex items-center gap-1 mt-0.5 ms-1 px-1.5 py-0.5 bg-[#EEF3FA] border border-[#DCE6F5] text-[#003589] rounded text-[9px] font-sans font-bold">
                      <span>{t('طلب عميل', 'Customer Order')}</span>
                    </span>
                  )}
                  {inv.convertedFromQuoteNumber && (
                    <span className="inline-flex items-center gap-1 mt-0.5 ms-1 px-1.5 py-0.5 bg-slate-100 border border-slate-300 text-slate-700 rounded text-[9px] font-sans font-bold">
                      <span>{t('من عرض سعر:', 'From quote:')} {inv.convertedFromQuoteNumber}</span>
                    </span>
                  )}
                  <div className="text-[10px] font-sans font-normal text-slate-500 mt-0.5">
                    {t('بواسطة:', 'By:')} {inv.createdBy}
                    {inv.editedBy ? ` · ${t('تعديل:', 'Edited:')} ${inv.editedBy}` : ''}
                    {inv.cancelledBy ? ` · ${t('إلغاء:', 'Cancelled:')} ${inv.cancelledBy}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'date',
              header: t('التاريخ', 'Date'),
              sortable: true,
              sortValue: (inv) => inv.date,
              exportValue: (inv) => inv.date,
              render: (inv) => <span className="font-mono text-slate-600">{inv.date}</span>,
            },
            {
              key: 'customerName',
              header: t('العميل', 'Customer'),
              sortable: true,
              sortValue: (inv) => inv.customerName || '',
              exportValue: (inv) => (inv.customerName ? translateSystemEntityName(inv.customerName) : t('نقدي عام', 'Walk-in Cash')),
              render: (inv) => <span className="font-bold text-slate-800">{inv.customerName ? translateSystemEntityName(inv.customerName) : t('نقدي عام', 'Walk-in Cash')}</span>,
            },
            {
              key: 'representativeName',
              header: t('المندوب', 'Representative'),
              sortable: true,
              sortValue: (inv) => inv.representativeName || '',
              exportValue: (inv) => inv.representativeName || '-',
              render: (inv) => <span className="text-slate-600">{inv.representativeName || '-'}</span>,
            },
            {
              key: 'warehouseName',
              header: t('المستودع', 'Warehouse'),
              sortable: true,
              sortValue: (inv) => inv.warehouseName || '',
              exportValue: (inv) => (inv.warehouseName ? translateSystemEntityName(inv.warehouseName) : '-'),
              render: (inv) => <span className="text-slate-600">{inv.warehouseName ? translateSystemEntityName(inv.warehouseName) : '-'}</span>,
            },
            {
              key: 'grandTotal',
              header: t('الإجمالي', 'Total'),
              align: 'center',
              sortable: true,
              sortValue: (inv) => inv.grandTotal,
              exportValue: (inv) => inv.grandTotal,
              render: (inv) => (
                <span className="font-black text-slate-900 tabular-nums font-mono">
                  {fmt(inv.grandTotal)} {currencyLabel}
                </span>
              ),
            },
            {
              key: 'paidAmount',
              header: t('المدفوع', 'Paid'),
              align: 'center',
              sortable: true,
              sortValue: (inv) => inv.paidAmount,
              exportValue: (inv) => inv.paidAmount,
              render: (inv) => <span className="font-bold text-emerald-700 tabular-nums font-mono">{fmt(inv.paidAmount)}</span>,
            },
            {
              key: 'remainingAmount',
              header: t('المتبقي', 'Remaining'),
              align: 'center',
              sortable: true,
              sortValue: (inv) => inv.remainingAmount,
              exportValue: (inv) => inv.remainingAmount,
              render: (inv) => <span className="font-bold text-red-600 tabular-nums font-mono">{fmt(inv.remainingAmount)}</span>,
            },
            {
              key: 'paymentType',
              header: t('نوع الدفع', 'Payment Type'),
              align: 'center',
              exportValue: (inv) => (inv.paymentType === 'cash' ? t('نقدي', 'Cash') : inv.paymentType === 'credit' ? t('آجل', 'Credit') : t('جزئي', 'Partial')),
              render: (inv) => (
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  inv.paymentType === 'cash' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                  inv.paymentType === 'credit' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                  'bg-blue-50 text-blue-800 border border-blue-200'
                }`}>
                  {inv.paymentType === 'cash' ? t('نقدي', 'Cash') : inv.paymentType === 'credit' ? t('آجل', 'Credit') : t('جزئي', 'Partial')}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('الحالة والمراجعة', 'Status & Review'),
              exportValue: (inv) => `${inv.status === 'confirmed' ? t('مؤكدة', 'Confirmed') : inv.status === 'draft' ? t('مسودة', 'Draft') : t('ملغاة', 'Cancelled')}${inv.reviewStatus === 'needs_review' ? ` - ${t('تحتاج مراجعة', 'Needs review')}` : inv.reviewStatus === 'reviewed' ? ` - ${t('تمت المراجعة', 'Reviewed')}` : ''}`,
              render: (inv) => (
                <div className="flex flex-col items-start gap-1">
                  {inv.status === 'confirmed' ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                      {t('مؤكدة', 'Confirmed')}
                    </span>
                  ) : inv.status === 'draft' ? (
                    <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                      {t('مسودة (بلا خصم)', 'Draft (No stock deduction)')}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
                      {t('ملغاة', 'Cancelled')}
                    </span>
                  )}
                  {inv.reviewStatus === 'needs_review' && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                      {t('تحتاج مراجعة الإدارة', 'Needs Admin Review')}
                    </span>
                  )}
                  {inv.reviewStatus === 'reviewed' && (
                    <span className="px-2 py-0.5 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] text-[10px] font-bold">
                      {t('تمت المراجعة', 'Reviewed')} {inv.reviewedBy ? `(${inv.reviewedBy})` : ''}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
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
                      title={t('تأكيد مراجعة فاتورة المندوب بدون تكرار القيد', 'Confirm rep invoice review without duplicating entry')}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{t('تأكيد المراجعة', 'Confirm Review')}</span>
                    </button>
                  )}
                  {inv.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => setConfirmDraftTarget(inv)}
                      className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 border border-emerald-200 transition-colors cursor-pointer"
                      title={t('اعتماد الفاتورة المسودة وخصم المخزون', 'Approve draft invoice and deduct inventory')}
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                  {inv.status === 'confirmed' && inv.remainingAmount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleOpenPaymentModal(inv)}
                      className="p-1.5 rounded-lg text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 transition-colors cursor-pointer"
                      title={t('تسجيل دفعة سداد على نفس الفاتورة', 'Record payment on this invoice')}
                    >
                      <DollarSign className="w-4 h-4" />
                    </button>
                  )}
                  {inv.status === 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(inv)}
                      className="p-1.5 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-50 transition-colors cursor-pointer"
                      title={t('تعديل بيانات الفاتورة والأصناف', 'Edit invoice details and items')}
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handlePrint(inv)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                    title={t('طباعة (A4 / حراري 80mm / 58mm)', 'Print (A4 / Thermal 80mm / 58mm)')}
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveInvoice(inv)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                    title={t('عرض تفاصيل الفاتورة وسجل الدفعات', 'View invoice details and payment log')}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {inv.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() => setCancelTarget(inv)}
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                      title={t('إلغاء الفاتورة', 'Cancel Invoice')}
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
          title={t('سجل عروض الأسعار', 'Price Quotes Log')}
          subtitle={t('عروض الأسعار لا تخصم من المخزون ولا تُقيد مالياً حتى يتم تحويلها لفاتورة بيع معتمدة', 'Price quotes do not affect inventory or finances until converted to a confirmed sales invoice')}
          data={filteredQuotes}
          rowKey={(q) => q.id}
          onRowClick={(q) => setActiveInvoice(q)}
          compact
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder={t('بحث برقم العرض أو العميل...', 'Search by quote # or customer...')}
          exportFilename="AWLAD_SELIM_Quotes"
          pdfTitle={t('سجل عروض الأسعار', 'Price Quotes Log')}
          emptyTitle={t('لا توجد عروض أسعار مسجلة بعد', 'No price quotes recorded yet')}
          headerActions={
            <button
              type="button"
              onClick={() => setIsNewQuoteOpen(true)}
              className="px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-bold cursor-pointer"
            >
              {t('+ إنشاء عرض سعر', '+ New Price Quote')}
            </button>
          }
          toolbarFilters={
            <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
              <div className="w-[160px] shrink-0">
                <SearchableFilterSelect
                  id="quotes-filter-customer"
                  inlinePrefix={t('العميل', 'Customer')}
                  value={selectedCustomerFilter}
                  onChange={setSelectedCustomerFilter}
                  options={customers.map((c) => ({
                    value: c.id,
                    label: c.shopName || c.name,
                    subtitle: c.phone || c.name,
                    searchText: `${c.name} ${c.shopName || ''} ${c.phone || ''} ${c.code || ''}`,
                  }))}
                  allOptionLabel={t('الكل', 'All')}
                  allOptionValue=""
                  allowClear
                  buttonClassName="rounded-md h-8 min-h-[32px]"
                />
              </div>
              <label className="inline-flex items-center gap-1 h-8 px-2 bg-slate-50 dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md shrink-0">
                <span className="text-[10.5px] font-bold text-slate-500">{t('من:', 'From:')}</span>
                <input
                  type="date"
                  aria-label={t('من تاريخ', 'From date')}
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-xs font-mono font-semibold text-slate-800 dark:text-[#EEF4FC] outline-hidden"
                  title={t('من تاريخ', 'From date')}
                />
              </label>
              <label className="inline-flex items-center gap-1 h-8 px-2 bg-slate-50 dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md shrink-0">
                <span className="text-[10.5px] font-bold text-slate-500">{t('إلى:', 'To:')}</span>
                <input
                  type="date"
                  aria-label={t('إلى تاريخ', 'To date')}
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent text-xs font-mono font-semibold text-slate-800 dark:text-[#EEF4FC] outline-hidden"
                  title={t('إلى تاريخ', 'To date')}
                />
              </label>
            </div>
          }
          columns={[
            {
              key: 'invoiceNumber',
              header: t('رقم عرض السعر', 'Quote No.'),
              sortable: true,
              sortValue: (q) => q.invoiceNumber,
              exportValue: (q) => q.invoiceNumber,
              render: (q) => (
                <div className="font-mono font-bold text-blue-900">
                  <div>{q.invoiceNumber}</div>
                  <div className="text-[10px] font-sans font-normal text-slate-500">{t('بواسطة:', 'By:')} {q.createdBy}</div>
                </div>
              ),
            },
            {
              key: 'date',
              header: t('التاريخ', 'Date'),
              sortable: true,
              sortValue: (q) => q.date,
              exportValue: (q) => q.date,
              render: (q) => <span className="font-mono text-slate-600">{q.date}</span>,
            },
            {
              key: 'customerName',
              header: t('العميل', 'Customer'),
              sortable: true,
              sortValue: (q) => q.customerName || '',
              exportValue: (q) => (q.customerName ? translateSystemEntityName(q.customerName) : t('عميل نقدي / عرض سعر عام', 'Walk-in / General Quote')),
              render: (q) => <span className="font-bold text-slate-800">{q.customerName ? translateSystemEntityName(q.customerName) : t('عميل نقدي / عرض سعر عام', 'Walk-in / General Quote')}</span>,
            },
            {
              key: 'warehouseName',
              header: t('المستودع', 'Warehouse'),
              exportValue: (q) => (q.warehouseName ? translateSystemEntityName(q.warehouseName) : '-'),
              render: (q) => <span className="text-slate-600">{q.warehouseName ? translateSystemEntityName(q.warehouseName) : '-'}</span>,
            },
            {
              key: 'itemsCount',
              header: t('الأصناف', 'Items'),
              align: 'center',
              sortable: true,
              sortValue: (q) => q.items.length,
              exportValue: (q) => q.items.length,
              render: (q) => <span className="font-mono font-bold">{fmt(q.items.length)}</span>,
            },
            {
              key: 'grandTotal',
              header: t('الإجمالي', 'Total'),
              align: 'center',
              sortable: true,
              sortValue: (q) => q.grandTotal,
              exportValue: (q) => q.grandTotal,
              render: (q) => (
                <span className="font-black text-slate-900 tabular-nums font-mono">
                  {fmt(q.grandTotal)} {currencyLabel}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              exportValue: (q) => (q.status === 'cancelled' ? t('ملغي', 'Cancelled') : convertedQuoteIds.has(q.id) ? t('تم التحويل لفاتورة', 'Converted to Invoice') : t('عرض سعر', 'Price Quote')),
              render: (q) => {
                const isConverted = convertedQuoteIds.has(q.id);
                return q.status === 'cancelled' ? (
                  <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
                    {t('ملغي', 'Cancelled')}
                  </span>
                ) : isConverted ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                    {t('تم التحويل لفاتورة', 'Converted to Invoice')}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-bold">
                    {t('عرض سعر (بلا خصم مخزني)', 'Price Quote (No stock deduction)')}
                  </span>
                );
              },
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
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
                        <span>{t('تحويل لفاتورة بيع', 'Convert to Sales Invoice')}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handlePrint(quote)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                      title={t('طباعة عرض السعر', 'Print Price Quote')}
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveInvoice(quote)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                      title={t('عرض التفاصيل', 'View Details')}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {quote.status !== 'cancelled' && !isConverted && (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(quote)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                        title={t('إلغاء عرض السعر', 'Cancel Price Quote')}
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
            text: isLtr
              ? `Invoice #(${newInv.invoiceNumber}) saved successfully${newInv.status === 'draft' ? ' (as draft)' : ''}.`
              : `تم حفظ الفاتورة رقم (${newInv.invoiceNumber}) بنجاح${newInv.status === 'draft' ? ' (كمسودة)' : ''}.`,
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
        title={`${t('إلغاء الفاتورة', 'Cancel Invoice')} ${cancelTarget?.invoiceNumber || ''}`}
        message={t('سيتم إلغاء الفاتورة ورد الكميات إلى المخزن وتسوية رصيد العميل والخزينة. يرجى كتابة سبب الإلغاء:', 'The invoice will be cancelled, quantities returned to stock, and customer & cashbox balances settled. Please enter a cancellation reason:')}
        confirmLabel={t('تأكيد إلغاء الفاتورة', 'Confirm Cancel Invoice')}
        variant="danger"
        requireInput
        inputLabel={t('سبب الإلغاء:', 'Cancellation Reason:')}
        inputPlaceholder={t('اكتب سبب إلغاء الفاتورة...', 'Enter invoice cancellation reason...')}
        isLoading={isConfirmLoading}
      />

      {/* Confirm Draft Invoice Dialog */}
      <ConfirmDialog
        isOpen={!!confirmDraftTarget}
        onClose={() => setConfirmDraftTarget(null)}
        onConfirm={handleExecuteConfirmDraft}
        title={`${t('اعتماد المسودة', 'Approve Draft')} ${confirmDraftTarget?.invoiceNumber || ''}`}
        message={
          isLtr
            ? `Do you want to approve draft invoice (${confirmDraftTarget?.invoiceNumber || ''}) now? Inventory will be deducted and financial balances updated.`
            : `هل تريد اعتماد الفاتورة المسودة (${confirmDraftTarget?.invoiceNumber || ''}) الآن؟ سيتم خصم المخزون وتحديث الأرصدة المالية.`
        }
        confirmLabel={t('اعتماد الفاتورة الآن', 'Approve Invoice Now')}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 dark:bg-[#040B17]/75 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white dark:bg-[#0E1C36] rounded-lg shadow-2xl border border-slate-200 dark:border-[#21375C] p-2.5 text-start max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#21375C] pb-2 mb-2">
              <h3 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC]">
                {t('تفاصيل الفاتورة:', 'Invoice Details:')} {activeInvoice.invoiceNumber}
              </h3>
              <button
                onClick={() => setActiveInvoice(null)}
                className="text-slate-500 dark:text-[#97AECE] hover:text-slate-700 dark:hover:text-[#F3F7FC] text-xs font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')} ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs mb-2 p-2 bg-slate-50 dark:bg-[#132544] rounded-md border border-slate-200 dark:border-[#21375C]">
              <div>
                <p className="text-slate-500 dark:text-[#97AECE]">{t('العميل:', 'Customer:')} <strong className="text-slate-800 dark:text-[#F3F7FC]">{activeInvoice.customerName ? translateSystemEntityName(activeInvoice.customerName) : '-'}</strong></p>
                <p className="text-slate-500 dark:text-[#97AECE]">{t('المستودع:', 'Warehouse:')} <strong className="text-slate-800 dark:text-[#F3F7FC]">{activeInvoice.warehouseName ? translateSystemEntityName(activeInvoice.warehouseName) : '-'}</strong></p>
                <p className="text-slate-500 dark:text-[#97AECE]">{t('أنشئت بواسطة:', 'Created by:')} <strong className="text-slate-800 dark:text-[#F3F7FC]">{activeInvoice.createdBy}</strong></p>
                {activeInvoice.convertedFromQuoteNumber && (
                  <p className="text-slate-500 dark:text-[#97AECE]">{t('محولة من عرض سعر:', 'Converted from quote:')} <strong className="font-mono text-blue-900 dark:text-[#85B8FF]">{activeInvoice.convertedFromQuoteNumber}</strong></p>
                )}
              </div>
              <div>
                <p className="text-slate-500 dark:text-[#97AECE]">{t('التاريخ:', 'Date:')} <strong className="font-mono text-slate-800 dark:text-[#F3F7FC]">{activeInvoice.date}</strong></p>
                <p className="text-slate-500 dark:text-[#97AECE]">{t('المندوب:', 'Representative:')} <strong className="text-slate-800 dark:text-[#F3F7FC]">{activeInvoice.representativeName || '-'}</strong></p>
                {activeInvoice.reviewedBy && (
                  <p className="text-emerald-700 dark:text-emerald-300">{t('مراجعة الإدارة:', 'Admin Review:')} <strong>{activeInvoice.reviewedBy}</strong> {activeInvoice.reviewNotes ? `(${activeInvoice.reviewNotes})` : ''}</p>
                )}
                {activeInvoice.editedBy && (
                  <p className="text-amber-700 dark:text-amber-300">{t('آخر تعديل:', 'Last edited by:')} <strong>{activeInvoice.editedBy}</strong></p>
                )}
                {activeInvoice.cancelledBy && (
                  <p className="text-red-700 dark:text-rose-300">{t('ألغيت بواسطة:', 'Cancelled by:')} <strong>{activeInvoice.cancelledBy}</strong> {activeInvoice.cancelReason ? `— ${activeInvoice.cancelReason}` : ''}</p>
                )}
              </div>
            </div>

            <div className="mb-2.5">
              <UnifiedDataTable<InvoiceItem>
                title={t('أصناف الفاتورة', 'Invoice Items')}
                data={activeInvoice.items}
                rowKey={(it, i) => `${it.productId || it.productName}-${i}`}
                searchable={false}
                compact
                defaultPageSize={25}
                columns={[
                  {
                    key: 'productName',
                    header: t('الصنف', 'Product'),
                    render: (it) => <span className="font-semibold">{it.productName}</span>,
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
                    render: (it) => <span className="font-bold font-mono tabular-nums">{fmt(it.quantity)}</span>,
                  },
                  {
                    key: 'unitPrice',
                    header: t('السعر', 'Price'),
                    align: 'center',
                    render: (it) => <span className="font-mono tabular-nums">{fmt(it.unitPrice)}</span>,
                  },
                  {
                    key: 'total',
                    header: t('الإجمالي', 'Total'),
                    align: 'center',
                    render: (it) => <span className="font-bold font-mono text-blue-900 dark:text-[#85B8FF] tabular-nums">{fmt(it.total)}</span>,
                  },
                ]}
              />
            </div>

            {/* Payments History on this Invoice */}
            <div className="mt-2 mb-2.5 p-2.5 bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] rounded-lg">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                  <h4 className="text-xs font-black text-slate-800 dark:text-[#F3F7FC]">
                    {t('سجل الدفعات المسددة على هذه الفاتورة', 'Payments Recorded on This Invoice')} ({fmt(activeInvoice.payments?.length || (activeInvoice.paidAmount > 0 ? 1 : 0))})
                  </h4>
                </div>
                {activeInvoice.remainingAmount > 0 && activeInvoice.status === 'confirmed' && (
                  <button
                    onClick={() => {
                      const inv = activeInvoice;
                      setActiveInvoice(null);
                      handleOpenPaymentModal(inv);
                    }}
                    className="h-7 flex items-center gap-1 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('سداد دفعة جديدة', 'Record New Payment')}</span>
                  </button>
                )}
              </div>

              {(!activeInvoice.payments || activeInvoice.payments.length === 0) ? (
                <div className="text-[11px] text-slate-500 dark:text-[#97AECE] py-1">
                  {activeInvoice.paidAmount > 0 ? (
                    <p>
                      {t('تم سداد دفعة نقدية بقيمة', 'A cash payment of')}{' '}
                      <strong className="text-emerald-700 dark:text-emerald-300 font-bold">{fmt(activeInvoice.paidAmount)} {currencyLabel}</strong>{' '}
                      {t('عند إنشاء الفاتورة.', 'was paid upon invoice creation.')}
                    </p>
                  ) : (
                    <p className="text-amber-700 dark:text-amber-300">
                      {t('فاتورة آجلة بالكامل، لم يتم سداد أي دفعات بعد.', 'Fully credit invoice; no payments recorded yet.')}
                    </p>
                  )}
                </div>
              ) : (
                <UnifiedDataTable
                  title={t('سجل الدفعات', 'Payments Log')}
                  data={activeInvoice.payments}
                  rowKey={(p) => p.id}
                  searchable={false}
                  compact
                  defaultPageSize={10}
                  columns={[
                    {
                      key: 'date',
                      header: t('التاريخ', 'Date'),
                      render: (p) => <span className="font-mono">{p.date}</span>,
                    },
                    {
                      key: 'amount',
                      header: t('المبلغ', 'Amount'),
                      render: (p) => <span className="font-black text-emerald-700 font-mono tabular-nums">{fmt(p.amount)} {currencyLabel}</span>,
                    },
                    {
                      key: 'method',
                      header: t('طريقة الدفع', 'Payment Method'),
                      render: (p) => <span>{p.paymentMethod === 'cash' ? t('نقدي', 'Cash') : p.paymentMethod === 'bank' ? t('بنكي', 'Bank') : t('شيك', 'Cheque')}</span>,
                    },
                    {
                      key: 'cashboxName',
                      header: t('الخزينة', 'Cashbox'),
                      render: (p) => <span className="text-slate-600">{p.cashboxName ? t(p.cashboxName) : '-'}</span>,
                    },
                    {
                      key: 'createdBy',
                      header: t('المستخدم', 'User'),
                      render: (p) => <span className="text-slate-500">{p.createdBy}</span>,
                    },
                    {
                      key: 'notes',
                      header: t('ملاحظات', 'Notes'),
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
                    {t('سجل التعديلات السابقة', 'Previous Edit History')} ({fmt(activeInvoice.editHistory.length)})
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
                          {t('بواسطة:', 'By:')} {entry.editedBy || t('غير محدد', 'Unspecified')}
                          {entry.reason ? ` · ${t('السبب:', 'Reason:')} ${entry.reason}` : ''}
                        </div>
                        {entry.before && entry.after && (
                          <div className="text-slate-600 font-mono">
                            {t('الإجمالي:', 'Total:')} {fmt(Number(entry.before.grandTotal ?? 0))} →{' '}
                            <strong className="text-blue-900">{fmt(Number(entry.after.grandTotal ?? 0))} {currencyLabel}</strong>
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-slate-500 shrink-0" dir="ltr">
                        {entry.editedAt ? formatLocaleDateTime(entry.editedAt) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2.5 border-t text-xs">
              <div className="flex items-center gap-3 text-slate-600">
                <span>{t('الإجمالي:', 'Total:')} <strong className="text-sm font-black text-slate-900">{fmt(activeInvoice.grandTotal)} {currencyLabel}</strong></span>
                <span>{t('المدفوع:', 'Paid:')} <strong className="text-sm font-bold text-emerald-700">{fmt(activeInvoice.paidAmount)}</strong></span>
                <span>{t('المتبقي:', 'Remaining:')} <strong className="text-sm font-bold text-red-600">{fmt(activeInvoice.remainingAmount)}</strong></span>
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
                <span>{t('طباعة هذه الفاتورة', 'Print This Invoice')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Subsequent Payment Modal */}
      {paymentModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-start animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  {t('تسجيل دفعة على الفاتورة:', 'Record Payment on Invoice:')} {paymentModalInvoice.invoiceNumber}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {t('العميل:', 'Customer:')} <strong className="text-slate-800">{paymentModalInvoice.customerName ? translateSystemEntityName(paymentModalInvoice.customerName) : t('نقدي عام', 'Walk-in Cash')}</strong>
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
                <span className="block text-[10px] text-slate-500">{t('إجمالي الفاتورة', 'Invoice Total')}</span>
                <span className="font-bold text-slate-800 tabular-nums">{fmt(paymentModalInvoice.grandTotal)} {currencyLabel}</span>
              </div>
              <div className="bg-slate-50 px-2 py-1">
                <span className="block text-[10px] text-slate-500">{t('المدفوع سابقاً', 'Previously Paid')}</span>
                <span className="font-bold text-emerald-700 tabular-nums">{fmt(paymentModalInvoice.paidAmount)}</span>
              </div>
              <div className="bg-slate-50 px-2 py-1">
                <span className="block text-[10px] text-slate-500">{t('المتبقي المطلوب', 'Remaining Due')}</span>
                <span className="font-black text-red-600 tabular-nums">{fmt(paymentModalInvoice.remainingAmount)} {currencyLabel}</span>
              </div>
            </div>

            <form onSubmit={handleSubmitPayment} className="space-y-2 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('قيمة الدفعة الجديدة', 'New Payment Amount')} ({currencyLabel}):</label>
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
                  <label className="block font-bold text-slate-700 mb-0.5">{t('الخزينة / الحساب المستلم:', 'Receiving Cashbox / Account:')}</label>
                  <select
                    value={paymentCashboxId}
                    onChange={(e) => setPaymentCashboxId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white"
                  >
                    {cashboxes.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.balanceHidden ? `${t(c.name)} (${t('رصيد محجوب', 'Balance hidden')})` : `${t(c.name)} (${fmt(c.currentBalance ?? 0)} ${currencyLabel})`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('طريقة الدفع:', 'Payment Method:')}</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white"
                  >
                    <option value="cash">{t('نقداً (كاش)', 'Cash')}</option>
                    <option value="bank">{t('تحويل بنكي', 'Bank Transfer')}</option>
                    <option value="cheque">{t('شيك مصرفي', 'Bank Cheque')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('تاريخ الدفعة:', 'Payment Date:')}</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات / رقم الإيصال:', 'Notes / Receipt No.:')}</label>
                  <input
                    type="text"
                    placeholder={t('ملاحظات أو رقم التحويل...', 'Notes or transfer reference...')}
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
                  {t('إلغاء', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPayment || paymentAmount <= 0}
                  className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingPayment ? t('جاري الحفظ...', 'Saving...') : t('تأكيد وقبض الدفعة', 'Confirm & Collect Payment')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Invoice Modal */}
      {editModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-start max-h-[90vh] overflow-y-auto animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  {t('تعديل الفاتورة رقم:', 'Edit Invoice #')} {editModalInvoice.invoiceNumber}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {t('العميل:', 'Customer:')} <strong className="text-slate-800">{editModalInvoice.customerName ? translateSystemEntityName(editModalInvoice.customerName) : '-'}</strong> | {t('المستودع:', 'Warehouse:')} <strong className="text-slate-800">{editModalInvoice.warehouseName ? translateSystemEntityName(editModalInvoice.warehouseName) : '-'}</strong>
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
                  <label className="block font-bold text-slate-700 mb-0.5">{t('تاريخ الفاتورة:', 'Invoice Date:')}</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('إجمالي الخصم', 'Total Discount')} ({currencyLabel}):</label>
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
                <label className="block font-bold text-slate-700 mb-0.5">{t('أصناف الفاتورة (تعديل الكميات والأسعار):', 'Invoice Items (Edit Quantities & Prices):')}</label>
                <div className="border border-slate-200 rounded-lg overflow-hidden awlad-table-scroll">
                  <table className="w-full text-start text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                        <th className="px-2 py-1.5">{t('الصنف', 'Product')}</th>
                        <th className="px-2 py-1.5 text-center">{t('الوحدة', 'Unit')}</th>
                        <th className="px-2 py-1.5 text-center w-24">{t('الكمية', 'Qty')}</th>
                        <th className="px-2 py-1.5 text-center w-28">{t('السعر', 'Price')}</th>
                        <th className="px-2 py-1.5 text-center">{t('الإجمالي', 'Total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-2 py-1 font-bold text-slate-800">{item.productName}</td>
                          <td className="px-2 py-1 text-center text-slate-600">{t(item.unit)}</td>
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
                              ariaLabel={`${t('كمية', 'Qty')} ${item.productName}`}
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
                            {fmt((item.quantity * item.unitPrice) - (item.discount || 0))} {currencyLabel}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات الفاتورة:', 'Invoice Notes:')}</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-2 py-1 rounded-md border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-0.5">
                  {t('سبب التعديل (إلزامي للتدقيق):', 'Edit Reason (Required for Audit):')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder={t('مثال: تصحيح كمية الصنف أو تعديل السعر المتفق عليه...', 'e.g., Correct item quantity or update agreed price...')}
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
                      <span className="text-slate-600 block text-[10px]">{t('الإجمالي المحسوب الجديد:', 'New Calculated Total:')}</span>
                      <strong className="text-sm font-black text-blue-950">{fmt(grand)} {currencyLabel}</strong>
                    </div>
                    <div>
                      <span className="text-slate-600 block text-[10px]">{t('الفرق عن الفاتورة الأصلية:', 'Difference from Original:')}</span>
                      <strong className={`text-sm font-black ${diff > 0 ? 'text-red-700' : diff < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                        {diff > 0 ? `+${fmt(diff)}` : fmt(diff)} {currencyLabel}
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
                  {t('إلغاء', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingEdit ? t('جاري حفظ التعديل...', 'Saving changes...') : t('حفظ وتحديث الفاتورة', 'Save & Update Invoice')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Rep Invoice Review Modal */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-start">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <h3 className="text-sm font-black text-slate-900">
                {t('تأكيد مراجعة فاتورة المندوب', 'Confirm Rep Invoice Review')} ({reviewTarget.invoiceNumber})
              </h3>
              <button type="button" onClick={() => setReviewTarget(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer">
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-2">
              {isLtr
                ? `This invoice was already executed and posted to inventory & accounts from the rep app (${reviewTarget.representativeName || reviewTarget.createdBy}). Confirming review only updates the review status without duplicating any entry.`
                : `هذه الفاتورة نُفذت وقُيدت بالفعل في المخزون والحسابات من تطبيق المندوب (${reviewTarget.representativeName || reviewTarget.createdBy}). تأكيد المراجعة يحدّث حالة المراجعة فقط دون تكرار أي قيد.`}
            </p>
            <form onSubmit={handleSubmitReview} className="space-y-2 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات المراجعة (اختياري):', 'Review Notes (Optional):')}</label>
                <textarea
                  rows={2}
                  value={reviewNotesInput}
                  onChange={(e) => setReviewNotesInput(e.target.value)}
                  placeholder={t('ملاحظة الإدارة على الفاتورة...', 'Admin note on invoice...')}
                  className="w-full px-2 py-1 rounded-md border border-slate-300"
                />
              </div>
              <div className="flex justify-end gap-1.5 pt-2 border-t">
                <button type="button" onClick={() => setReviewTarget(null)} className="px-3 py-1 rounded-md border border-slate-300 font-bold cursor-pointer">
                  {t('إلغاء', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReview}
                  className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingReview ? t('جاري التأكيد...', 'Confirming...') : t('اعتماد المراجعة', 'Approve Review')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Quote Modal */}
      {isNewQuoteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-start max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <div>
                <h3 className="text-sm font-black text-slate-900">{t('إنشاء عرض سعر جديد', 'Create New Price Quote')}</h3>
                <p className="text-[11px] text-slate-500">{t('لا يخصم من المخزون ولا يُقيد مالياً إلا بعد التحويل لفاتورة بيع', 'Does not affect stock or finances until converted to a sales invoice')}</p>
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
                  <label className="block font-bold text-slate-700 mb-0.5">{t('العميل:', 'Customer:')}</label>
                  <select
                    value={quoteCustomerId}
                    onChange={(e) => setQuoteCustomerId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    <option value="">{t('-- عميل عام / نقدي --', '-- General / Cash Customer --')}</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('المستودع المقترح:', 'Suggested Warehouse:')}</label>
                  <select
                    value={quoteWarehouseId}
                    onChange={(e) => setQuoteWarehouseId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{t(w.name)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('التاريخ:', 'Date:')}</label>
                  <input
                    type="date"
                    value={quoteDate}
                    onChange={(e) => setQuoteDate(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 font-mono"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                <label className="block font-bold text-slate-700">{t('إضافة أصناف لعرض السعر:', 'Add Items to Price Quote:')}</label>
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
                      currency={currencyLabel}
                    />
                  </div>
                  <div className="w-28">
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={quoteQty}
                      onChange={setQuoteQty}
                      ariaLabel={t('الكمية', 'Qty')}
                      inputClassName="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden awlad-table-scroll">
                <table className="w-full text-start text-xs">
                  <thead>
                    <tr className="bg-slate-100 font-bold text-slate-700 border-b">
                      <th className="p-2">{t('الصنف', 'Product')}</th>
                      <th className="p-2 text-center">{t('الوحدة', 'Unit')}</th>
                      <th className="p-2 text-center">{t('الكمية', 'Qty')}</th>
                      <th className="p-2 text-center">{t('السعر', 'Price')}</th>
                      <th className="p-2 text-center">{t('الإجمالي', 'Total')}</th>
                      <th className="p-2 text-center">{t('حذف', 'Delete')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {quoteItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-400">{t('لم تُضف أصناف بعد', 'No items added yet')}</td>
                      </tr>
                    ) : (
                      quoteItems.map((it, idx) => (
                        <tr key={`${it.productId}-${idx}`}>
                          <td className="p-2 font-bold">{it.productName}</td>
                          <td className="p-2 text-center">{t(it.unit)}</td>
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
                              ariaLabel={`${t('كمية', 'Qty')} ${it.productName}`}
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
                            {fmt(it.total)} {currencyLabel}
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => setQuoteItems((prev) => prev.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700 font-bold cursor-pointer"
                            >
                              {t('حذف', 'Delete')}
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
                  <label className="block font-bold text-slate-700 mb-0.5">{t('المندوب (اختياري):', 'Representative (Optional):')}</label>
                  <select
                    value={quoteRepId}
                    onChange={(e) => setQuoteRepId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    <option value="">{t('-- بدون مندوب --', '-- No Rep --')}</option>
                    {representatives.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('الخصم الإجمالي', 'Total Discount')} ({currencyLabel}):</label>
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
                  <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات عرض السعر:', 'Quote Notes:')}</label>
                  <input
                    type="text"
                    value={quoteNotes}
                    onChange={(e) => setQuoteNotes(e.target.value)}
                    placeholder={t('مدة الصلاحية أو شروط السداد...', 'Validity period or payment terms...')}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <div className="text-sm font-black text-blue-950 tabular-nums">
                  {t('الصافي المقترح:', 'Suggested Net:')} {fmt(Math.max(0, quoteItems.reduce((s, it) => s + it.total, 0) - Number(quoteDiscountTotal || 0)))} {currencyLabel}
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setIsNewQuoteOpen(false)} className="px-3 py-1 rounded-md border border-slate-300 font-bold cursor-pointer">
                    {t('إلغاء', 'Cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingQuote || quoteItems.length === 0}
                    className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                  >
                    {isSubmittingQuote ? t('جاري الحفظ...', 'Saving...') : t('حفظ عرض السعر', 'Save Price Quote')}
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
          <div className="w-full max-w-lg bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-start">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <h3 className="text-sm font-black text-slate-900">
                {isLtr
                  ? `Convert Price Quote ${convertQuoteTarget.invoiceNumber} to Sales Invoice`
                  : `تحويل عرض السعر ${convertQuoteTarget.invoiceNumber} إلى فاتورة بيع`}
              </h3>
              <button type="button" onClick={() => setConvertQuoteTarget(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer">
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmitConvertQuote} className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('مستودع الصرف:', 'Dispatch Warehouse:')}</label>
                  <select
                    value={convertWarehouseId}
                    onChange={(e) => setConvertWarehouseId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{t(w.name)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('الخزينة:', 'Cashbox:')}</label>
                  <select
                    value={convertCashboxId}
                    onChange={(e) => setConvertCashboxId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    {cashboxes.map((cb) => (
                      <option key={cb.id} value={cb.id}>{t(cb.name)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('نوع الدفع:', 'Payment Type:')}</label>
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
                    <option value="cash">{t('نقدي', 'Cash')}</option>
                    <option value="partial">{t('جزئي', 'Partial')}</option>
                    <option value="credit">{t('آجل', 'Credit')}</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('المدفوع:', 'Paid:')}</label>
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
                  <label className="block font-bold text-slate-700 mb-0.5">{t('الخصم:', 'Discount:')}</label>
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
                <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات الفاتورة:', 'Invoice Notes:')}</label>
                <input
                  type="text"
                  value={convertNotes}
                  onChange={(e) => setConvertNotes(e.target.value)}
                  className="w-full h-8 px-2 py-1 rounded-md border border-slate-300"
                />
              </div>
              <div className="flex justify-end gap-1.5 pt-2 border-t">
                <button type="button" onClick={() => setConvertQuoteTarget(null)} className="px-3 py-1 rounded-md border border-slate-300 font-bold cursor-pointer">
                  {t('إلغاء', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isConvertingQuote}
                  className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {isConvertingQuote ? t('جاري التحويل...', 'Converting...') : t('تأكيد التحويل لفاتورة بيع', 'Confirm Conversion to Sales Invoice')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

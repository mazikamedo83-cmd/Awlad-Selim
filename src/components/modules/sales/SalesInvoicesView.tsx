import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Search, Filter, Printer, Download, Eye, XCircle, 
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
import { computeLineTotal } from '../../../utils/quantity';

export interface SalesInvoicesViewProps {
  initialStatusFilter?: 'all' | 'confirmed' | 'draft' | 'cancelled';
  initialOpenNew?: boolean;
}

export const SalesInvoicesView: React.FC<SalesInvoicesViewProps> = ({
  initialStatusFilter = 'all',
  initialOpenNew = false,
}) => {
  const { invoices, customers, cashboxes, settings, cancelInvoice, confirmDraftInvoice, addInvoicePayment, editSalesInvoice } = useData();
  const { hasPermission } = useAuth();
  const { registerHandler } = useShortcuts();

  const [isNewModalOpen, setIsNewModalOpen] = useState(initialOpenNew);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomerFilter, setSelectedCustomerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'draft' | 'cancelled'>(initialStatusFilter);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
  const [editItems, setEditItems] = useState<InvoiceItem[]>([]);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Filter only sales invoices
  const salesInvoices = useMemo(() => {
    return invoices.filter(i => i.type === 'sales');
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    return salesInvoices.filter(inv => {
      const matchSearch = 
        inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (inv.customerName && inv.customerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.representativeName && inv.representativeName.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchCustomer = selectedCustomerFilter ? inv.customerId === selectedCustomerFilter : true;
      const matchStatus = statusFilter === 'all' ? true : inv.status === statusFilter;
      const matchDateFrom = dateFrom ? inv.date >= dateFrom : true;
      const matchDateTo = dateTo ? inv.date <= dateTo : true;

      return matchSearch && matchCustomer && matchStatus && matchDateFrom && matchDateTo;
    });
  }, [salesInvoices, searchTerm, selectedCustomerFilter, statusFilter, dateFrom, dateTo]);

  // Open print preview
  const handlePrint = (inv: Invoice) => {
    setPrintData({
      title: 'فاتورة مبيعات أولاد سليم',
      docNumber: inv.invoiceNumber,
      docType: 'فاتورة مبيعات',
      date: inv.date,
      partyName: inv.customerName,
      warehouseName: inv.warehouseName,
      representativeName: inv.representativeName,
      paymentType: inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'credit' ? 'آجل' : 'جزئي',
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
      paidAmount: inv.paidAmount,
      remainingAmount: inv.remainingAmount,
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
    setEditItems(inv.items.map(it => ({ ...it })));
    setEditError(null);
  };

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalInvoice) return;
    setEditError(null);
    setIsSubmittingEdit(true);
    const res = await editSalesInvoice(editModalInvoice.id, {
      date: editDate,
      discountTotal: editDiscount,
      notes: editNotes,
      items: editItems,
    });
    setIsSubmittingEdit(false);
    if (!res.success) {
      setEditError(res.error || 'تعذر تعديل الفاتورة');
    } else {
      setEditModalInvoice(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إدارة فواتير المبيعات</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            عرض وتوليد وطباعة فواتير مبيعات المواد الغذائية ومتابعة التحصيلات والديون
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>

          <button
            onClick={() => setIsNewModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-md shadow-blue-900/20 transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>فاتورة بيع جديدة</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {actionMessage && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
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

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="بحث برقم الفاتورة أو العميل أو المندوب..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2 pr-9 pl-3 text-xs focus:bg-white focus:border-blue-600 outline-hidden"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
        </div>

        {/* Customer Filter */}
        <div>
          <select
            value={selectedCustomerFilter}
            onChange={(e) => setSelectedCustomerFilter(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
          >
            <option value="">-- جميع العملاء --</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
          >
            <option value="all">-- جميع الحالات --</option>
            <option value="confirmed">فواتير مؤكدة</option>
            <option value="draft">مسودات</option>
            <option value="cancelled">فواتير ملغاة / محذوفة</option>
          </select>
        </div>

        {/* Date From */}
        <div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
            placeholder="من تاريخ"
          />
        </div>

        {/* Date To */}
        <div>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
            placeholder="إلى تاريخ"
          />
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <th className="p-3.5">رقم الفاتورة</th>
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">العميل</th>
                <th className="p-3.5">المندوب</th>
                <th className="p-3.5">المستودع</th>
                <th className="p-3.5">الإجمالي</th>
                <th className="p-3.5">المدفوع</th>
                <th className="p-3.5">المتبقي</th>
                <th className="p-3.5">نوع الدفع</th>
                <th className="p-3.5">الحالة</th>
                <th className="p-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">
                    لا توجد فواتير مبيعات مطابقة لمعايير البحث الحالية
                  </td>
                </tr>
              ) : (
                filteredInvoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 font-bold font-mono text-blue-900">
                      <div>{inv.invoiceNumber}</div>
                      {inv.linkedRepTransferNumber && (
                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded text-[9px] font-sans font-bold">
                          <span>تحويل عهدة: {inv.linkedRepTransferNumber}</span>
                        </span>
                      )}
                      {inv.linkedCustomerOrderId && (
                        <span className="inline-flex items-center gap-1 mt-0.5 mr-1 px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-800 rounded text-[9px] font-sans font-bold">
                          <span>طلب عميل</span>
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 font-mono text-slate-600">{inv.date}</td>
                    <td className="p-3.5 font-bold text-slate-800">{inv.customerName || 'نقدي عام'}</td>
                    <td className="p-3.5 text-slate-600">{inv.representativeName || '-'}</td>
                    <td className="p-3.5 text-slate-600">{inv.warehouseName}</td>
                    <td className="p-3.5 font-black text-slate-900">{inv.grandTotal.toLocaleString()} {settings.currency}</td>
                    <td className="p-3.5 font-bold text-emerald-700">{inv.paidAmount.toLocaleString()}</td>
                    <td className="p-3.5 font-bold text-red-600">{inv.remainingAmount.toLocaleString()}</td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        inv.paymentType === 'cash' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                        inv.paymentType === 'credit' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                        'bg-blue-50 text-blue-800 border border-blue-200'
                      }`}>
                        {inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'credit' ? 'آجل' : 'جزئي'}
                      </span>
                    </td>
                    <td className="p-3.5">
                      {inv.status === 'confirmed' ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                          مؤكدة
                        </span>
                      ) : inv.status === 'draft' ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                          مسودة (بلا خصم)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
                          ملغاة
                        </span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center justify-center gap-1.5">
                        {inv.status === 'draft' && (
                          <button
                            onClick={() => setConfirmDraftTarget(inv)}
                            className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 border border-emerald-200 transition-colors cursor-pointer"
                            title="اعتماد الفاتورة المسودة وخصم المخزون"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                        {inv.status === 'confirmed' && inv.remainingAmount > 0 && (
                          <button
                            onClick={() => handleOpenPaymentModal(inv)}
                            className="p-1.5 rounded-lg text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 transition-colors"
                            title="تسجيل دفعة سداد على نفس الفاتورة"
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>
                        )}
                        {inv.status === 'confirmed' && (
                          <button
                            onClick={() => handleOpenEditModal(inv)}
                            className="p-1.5 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-50 transition-colors"
                            title="تعديل بيانات الفاتورة والأصناف"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handlePrint(inv)}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors"
                          title="طباعة (A4 / حراري 80mm / 58mm)"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setActiveInvoice(inv)}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 transition-colors"
                          title="عرض تفاصيل الفاتورة وسجل الدفعات"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {inv.status !== 'cancelled' && (
                          <button
                            onClick={() => setCancelTarget(inv)}
                            className="p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-50 transition-colors"
                            title="إلغاء الفاتورة"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 text-right max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="text-base font-black text-slate-900">
                تفاصيل الفاتورة: {activeInvoice.invoiceNumber}
              </h3>
              <button
                onClick={() => setActiveInvoice(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                إغلاق ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs mb-4 p-3 bg-slate-50 rounded-xl">
              <div>
                <p className="text-slate-500">العميل: <strong className="text-slate-800">{activeInvoice.customerName}</strong></p>
                <p className="text-slate-500">المستودع: <strong className="text-slate-800">{activeInvoice.warehouseName}</strong></p>
              </div>
              <div>
                <p className="text-slate-500">التاريخ: <strong className="font-mono text-slate-800">{activeInvoice.date}</strong></p>
                <p className="text-slate-500">المندوب: <strong className="text-slate-800">{activeInvoice.representativeName || '-'}</strong></p>
              </div>
            </div>

            <div className="awlad-table-scroll mb-4">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-100 font-bold border-b">
                  <th className="p-2">الصنف</th>
                  <th className="p-2 text-center">الوحدة</th>
                  <th className="p-2 text-center">الكمية</th>
                  <th className="p-2 text-center">السعر</th>
                  <th className="p-2 text-center">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {activeInvoice.items.map((it, i) => (
                  <tr key={i}>
                    <td className="p-2 font-semibold">{it.productName}</td>
                    <td className="p-2 text-center">{it.unit}</td>
                    <td className="p-2 text-center font-bold">{it.quantity}</td>
                    <td className="p-2 text-center">{it.unitPrice}</td>
                    <td className="p-2 text-center font-bold text-blue-900">{it.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* Payments History on this Invoice */}
            <div className="mt-4 mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-700" />
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
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition-colors cursor-pointer"
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
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] text-right">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600 font-bold">
                        <th className="py-1.5 px-2">التاريخ</th>
                        <th className="py-1.5 px-2">المبلغ</th>
                        <th className="py-1.5 px-2">طريقة الدفع</th>
                        <th className="py-1.5 px-2">الخزينة</th>
                        <th className="py-1.5 px-2">المستخدم</th>
                        <th className="py-1.5 px-2">ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {activeInvoice.payments.map((p) => (
                        <tr key={p.id}>
                          <td className="py-1.5 px-2 font-mono">{p.date}</td>
                          <td className="py-1.5 px-2 font-black text-emerald-700">{p.amount.toLocaleString()} {settings.currency}</td>
                          <td className="py-1.5 px-2">{p.paymentMethod === 'cash' ? 'نقدي' : p.paymentMethod === 'bank' ? 'بنكي' : 'شيك'}</td>
                          <td className="py-1.5 px-2 text-slate-600">{p.cashboxName}</td>
                          <td className="py-1.5 px-2 text-slate-500">{p.createdBy}</td>
                          <td className="py-1.5 px-2 text-slate-500">{p.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-3 border-t text-xs">
              <div className="flex items-center gap-4 text-slate-600">
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
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-950 transition-colors cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة هذه الفاتورة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Subsequent Payment Modal */}
      {paymentModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 text-right animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  تسجيل دفعة على الفاتورة: {paymentModalInvoice.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  العميل: <strong className="text-slate-800">{paymentModalInvoice.customerName || 'نقدي عام'}</strong>
                </p>
              </div>
              <button
                onClick={() => setPaymentModalInvoice(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {paymentError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{paymentError}</span>
              </div>
            )}

            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-2.5 p-3 bg-slate-50 rounded-xl text-center text-xs mb-4 border border-slate-200">
              <div>
                <span className="block text-[10px] text-slate-500">إجمالي الفاتورة</span>
                <span className="font-bold text-slate-800">{paymentModalInvoice.grandTotal.toLocaleString()} {settings.currency}</span>
              </div>
              <div>
                <span className="block text-[10px] text-slate-500">المدفوع سابقاً</span>
                <span className="font-bold text-emerald-700">{paymentModalInvoice.paidAmount.toLocaleString()}</span>
              </div>
              <div>
                <span className="block text-[10px] text-slate-500">المتبقي المطلوب</span>
                <span className="font-black text-red-600">{paymentModalInvoice.remainingAmount.toLocaleString()} {settings.currency}</span>
              </div>
            </div>

            <form onSubmit={handleSubmitPayment} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">قيمة الدفعة الجديدة ({settings.currency}):</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={paymentModalInvoice.remainingAmount}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-sm text-emerald-800 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الخزينة / الحساب المستلم:</label>
                  <select
                    value={paymentCashboxId}
                    onChange={(e) => setPaymentCashboxId(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                  >
                    {cashboxes.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.currentBalance.toLocaleString()} {settings.currency})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">طريقة الدفع:</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="cash">نقداً (كاش)</option>
                    <option value="bank">تحويل بنكي</option>
                    <option value="cheque">شيك مصرفي</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">تاريخ الدفعة:</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات / رقم الإيصال:</label>
                <input
                  type="text"
                  placeholder="ملاحظات أو رقم التحويل..."
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setPaymentModalInvoice(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPayment || paymentAmount <= 0}
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black transition-colors disabled:opacity-50 cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 text-right max-h-[90vh] overflow-y-auto animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  تعديل الفاتورة رقم: {editModalInvoice.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  العميل: <strong className="text-slate-800">{editModalInvoice.customerName}</strong> | المستودع: <strong className="text-slate-800">{editModalInvoice.warehouseName}</strong>
                </p>
              </div>
              <button
                onClick={() => setEditModalInvoice(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {editError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitEdit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">تاريخ الفاتورة:</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">إجمالي الخصم ({settings.currency}):</label>
                  <input
                    type="number"
                    min={0}
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-bold"
                  />
                </div>
              </div>

              {/* Items Table for Editing Quantities & Prices */}
              <div>
                <label className="block font-bold text-slate-700 mb-1.5">أصناف الفاتورة (تعديل الكميات والأسعار):</label>
                <div className="border border-slate-200 rounded-xl overflow-hidden awlad-table-scroll">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                        <th className="p-2.5">الصنف</th>
                        <th className="p-2.5 text-center">الوحدة</th>
                        <th className="p-2.5 text-center w-24">الكمية</th>
                        <th className="p-2.5 text-center w-28">السعر</th>
                        <th className="p-2.5 text-center">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-2.5 font-bold text-slate-800">{item.productName}</td>
                          <td className="p-2.5 text-center text-slate-600">{item.unit}</td>
                          <td className="p-2.5 text-center">
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
                              inputClassName="w-20 p-1.5 rounded-lg border border-slate-300 text-center font-bold font-mono outline-hidden focus:border-blue-700"
                            />
                          </td>
                          <td className="p-2.5 text-center">
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={item.unitPrice}
                              onChange={(e) => {
                                const newPrice = parseFloat(e.target.value) || 0;
                                setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, unitPrice: newPrice, total: (it.quantity * newPrice) - (it.discount || 0) } : it));
                              }}
                              className="w-24 p-1.5 rounded-lg border border-slate-300 text-center font-bold"
                            />
                          </td>
                          <td className="p-2.5 text-center font-black text-blue-900">
                            {((item.quantity * item.unitPrice) - (item.discount || 0)).toLocaleString()} {settings.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات الفاتورة:</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300"
                />
              </div>

              {/* Recalculated Summary */}
              {(() => {
                const subtotal = editItems.reduce((acc, it) => acc + (it.quantity * it.unitPrice), 0);
                const grand = Math.max(0, subtotal - editDiscount);
                const diff = grand - editModalInvoice.grandTotal;
                return (
                  <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200 flex items-center justify-between text-xs">
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

              <div className="flex items-center justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setEditModalInvoice(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-black transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingEdit ? 'جاري حفظ التعديل...' : 'حفظ وتحديث الفاتورة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

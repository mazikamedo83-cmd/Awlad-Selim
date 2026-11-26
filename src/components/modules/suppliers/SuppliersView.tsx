import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Search, Phone, MapPin, DollarSign, FileText, 
  ArrowUpRight, Printer, Edit, Trash2, AlertCircle, CheckCircle2, ShieldAlert 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { Supplier } from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { SuppliersTruckIcon } from '../../common/AppIcons';
import { UnifiedDataTable, UnifiedColumn } from '../../common/UnifiedDataTable';

export const SuppliersView: React.FC = () => {
  const {
    suppliers, invoices, invoiceReturns, financialTransactions, cashboxes, settings,
    addSupplier, updateSupplier, deleteSupplier, recordSupplierPayment, settleSupplierAdvance
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const { t, language } = usePreferences();
  const canApproveOverpayment =
    currentUser?.role === 'admin' ||
    currentUser?.role === 'manager' ||
    hasPermission('canApprove');

  const { registerHandler, consumePendingAction } = useShortcuts();

  const [searchTerm, setSearchTerm] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'payable' | 'advance' | 'settled'>('all');
  const [sortBy, setSortBy] = useState<'default' | 'balance_desc' | 'balance_asc' | 'name'>('default');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierFormError, setSupplierFormError] = useState<string | null>(null);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [isDeletingSupplier, setIsDeletingSupplier] = useState(false);

  // Statement modal state
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null);

  // Payment modal state
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentCashboxId, setPaymentCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Advance settlement modal state
  const [settleSupplier, setSettleSupplier] = useState<Supplier | null>(null);
  const [settleInvoiceId, setSettleInvoiceId] = useState<string>('');
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settleNotes, setSettleNotes] = useState<string>('');
  const [settleError, setSettleError] = useState<string | null>(null);
  const [isConfirmingSettle, setIsConfirmingSettle] = useState(false);
  const [isSettlingAdvance, setIsSettlingAdvance] = useState(false);

  // Print state
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Form state
  const [formData, setFormData] = useState<{
    code: string;
    name: string;
    phone: string;
    address: string;
    notes: string;
    openingBalance: number | '';
  }>({
    code: '',
    name: '',
    phone: '',
    address: '',
    notes: '',
    openingBalance: '',
  });

  useEffect(() => {
    if (cashboxes.length > 0 && (!paymentCashboxId || !cashboxes.some(c => c.id === paymentCashboxId))) {
      setPaymentCashboxId(cashboxes[0].id);
    }
  }, [cashboxes, paymentCashboxId]);

  const supplierSummary = useMemo(() => {
    let totalPayable = 0;
    let totalAdvance = 0;
    suppliers.forEach((s) => {
      const bal = Number(s.currentBalance || 0);
      if (bal > 0) totalPayable += bal;
      else if (bal < 0) totalAdvance += Math.abs(bal);
    });
    return { count: suppliers.length, totalPayable, totalAdvance };
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    const q = searchTerm.toLowerCase();
    const list = suppliers.filter((s) => {
      const matchSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.phone || '').includes(searchTerm) ||
        (s.address || '').toLowerCase().includes(q);
      if (!matchSearch) return false;
      const bal = Number(s.currentBalance || 0);
      if (balanceFilter === 'payable') return bal > 0.005;
      if (balanceFilter === 'advance') return bal < -0.005;
      if (balanceFilter === 'settled') return Math.abs(bal) <= 0.005;
      return true;
    });
    if (sortBy === 'balance_desc') {
      return [...list].sort((a, b) => Number(b.currentBalance || 0) - Number(a.currentBalance || 0));
    }
    if (sortBy === 'balance_asc') {
      return [...list].sort((a, b) => Number(a.currentBalance || 0) - Number(b.currentBalance || 0));
    }
    if (sortBy === 'name') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name, language));
    }
    return list;
  }, [suppliers, searchTerm, balanceFilter, sortBy, language]);

  const handleOpenAdd = () => {
    const nextCode = `SUPP-${(suppliers.length + 2001)}`;
    setFormData({
      code: nextCode,
      name: '',
      phone: '',
      address: '',
      notes: '',
      openingBalance: '',
    });
    setSupplierFormError(null);
    setEditingSupplier(null);
    setIsAddModalOpen(true);
  };

  useEffect(() => {
    if (consumePendingAction('action:add_supplier')) {
      handleOpenAdd();
    }
    return registerHandler('action:add_supplier', () => handleOpenAdd());
  }, [registerHandler, consumePendingAction, suppliers.length]);

  const handleOpenEdit = (s: Supplier) => {
    setFormData({
      code: s.code,
      name: s.name,
      phone: s.phone,
      address: s.address,
      notes: s.notes || '',
      openingBalance: s.openingBalance,
    });
    setSupplierFormError(null);
    setEditingSupplier(s);
    setIsAddModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingSupplier) return;
    setSupplierFormError(null);
    if (!formData.name.trim()) {
      setSupplierFormError(t('يرجى إدخال اسم المورد أو الشركة.', 'Please enter the supplier or company name.'));
      return;
    }

    setIsSavingSupplier(true);
    try {
      if (editingSupplier) {
        await updateSupplier(editingSupplier.id, {
          name: formData.name.trim(),
          phone: formData.phone.trim(),
          address: formData.address.trim(),
          notes: formData.notes.trim(),
        });
        setStatusBanner({
          type: 'success',
          text: t(
            `تم تحديث بيانات المورد (${formData.name.trim()}) بنجاح.`,
            `Supplier (${formData.name.trim()}) updated successfully.`
          ),
        });
      } else {
        await addSupplier({
          code: formData.code.trim(),
          name: formData.name.trim(),
          phone: formData.phone.trim(),
          address: formData.address.trim(),
          notes: formData.notes.trim(),
          openingBalance: Number(formData.openingBalance) || 0,
        });
        setStatusBanner({
          type: 'success',
          text: t(
            `تمت إضافة المورد (${formData.name.trim()}) بنجاح.`,
            `Supplier (${formData.name.trim()}) added successfully.`
          ),
        });
      }
      setIsAddModalOpen(false);
    } catch (err: any) {
      setSupplierFormError(t(err?.message || 'تعذر حفظ بيانات المورد', err?.message || 'Could not save supplier details'));
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPayment) return;
    setPaymentError(null);
    if (!paymentSupplier || paymentAmount <= 0) {
      setPaymentError(t('يرجى إدخال مبلغ صحيح أكبر من صفر.', 'Please enter a valid amount greater than zero.'));
      return;
    }
    if (!paymentCashboxId) {
      setPaymentError(t('يرجى اختيار الخزينة أو الحساب البنكي المسدد منه.', 'Please select the cashbox or bank account to pay from.'));
      return;
    }
    const debt = Math.max(0, Number(paymentSupplier.currentBalance || 0));
    const overpayment = Math.max(0, Number((paymentAmount - debt).toFixed(2)));
    if (overpayment > 0.009 && !canApproveOverpayment) {
      setPaymentError(
        t(
          'المبلغ المدخل يتجاوز المستحق للمورد — يتطلب سداد الدفعة الزائدة/المقدمة موافقة المدير أو صلاحية الاعتماد.',
          'Entered amount exceeds supplier balance due — advance/overpayment requires manager or approval permission.'
        )
      );
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const res = await recordSupplierPayment(
        paymentSupplier.id,
        paymentAmount,
        paymentCashboxId,
        paymentNotes || 'سداد دفعة للمورد'
      );

      if (res.success) {
        setPrintData({
          title: t('سند صرف وسداد نقدية لمورد', 'Supplier Cash Payment Voucher'),
          docNumber: `PAY-${Date.now().toString().slice(-6)}`,
          docType: t('سند صرف', 'Payment Voucher'),
          date: new Date().toISOString().split('T')[0],
          partyName: paymentSupplier.name,
          partyPhone: paymentSupplier.phone,
          partyAddress: paymentSupplier.address,
          grandTotal: paymentAmount,
          paidAmount: paymentAmount,
          notes: paymentNotes || t('تم صرف المبلغ نقداً من الخزينة لحساب المورد', 'Cash disbursed from cashbox to supplier account'),
        });
        setIsPrintModalOpen(true);
        setStatusBanner({
          type: 'success',
          text: t(
            `تم سداد مبلغ ${formatLocaleNumber(paymentAmount)} ${t(settings.currency)} للمورد (${paymentSupplier.name}).`,
            `Paid ${formatLocaleNumber(paymentAmount)} ${t(settings.currency)} to supplier (${paymentSupplier.name}).`
          ),
        });
        setPaymentSupplier(null);
        setPaymentAmount(0);
        setPaymentNotes('');
        setPaymentError(null);
      } else {
        setPaymentError(t(res.error || 'تعذر سداد الدفعة', res.error || 'Could not record payment'));
      }
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleConfirmDeleteSupplier = async () => {
    if (!supplierToDelete) return;
    setIsDeletingSupplier(true);
    try {
      await deleteSupplier(supplierToDelete.id);
      setStatusBanner({
        type: 'success',
        text: t(`تم حذف المورد (${supplierToDelete.name}) بنجاح.`, `Supplier (${supplierToDelete.name}) deleted successfully.`),
      });
      if (statementSupplier?.id === supplierToDelete.id) {
        setStatementSupplier(null);
      }
      setSupplierToDelete(null);
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: t(err?.message || 'تعذر حذف المورد لوجود فواتير أو حركات مالية مرتبطة به.', err?.message || 'Cannot delete supplier linked to existing invoices or financial transactions.'),
      });
      setSupplierToDelete(null);
    } finally {
      setIsDeletingSupplier(false);
    }
  };

  const getSupplierAdvanceInfo = (supp: Supplier) => {
    const openInvoices = invoices.filter(
      (i) => i.supplierId === supp.id && i.type === 'purchase' && i.status === 'confirmed' && Number(i.remainingAmount || 0) > 0
    );
    const openInvoicesRemaining = openInvoices.reduce((s, i) => s + Number(i.remainingAmount || 0), 0);
    const availableAdvance = Math.max(0, Number((openInvoicesRemaining - Number(supp.currentBalance || 0)).toFixed(2)));
    return { openInvoices, openInvoicesRemaining, availableAdvance };
  };

  const handleOpenSettleModal = (supp: Supplier) => {
    const { openInvoices, availableAdvance } = getSupplierAdvanceInfo(supp);
    const firstInv = openInvoices[0];
    setSettleError(null);
    setSettleNotes(t('تسوية دفعة مقدمة على فاتورة المشتريات', 'Settle advance payment against purchase invoice'));
    setSettleSupplier(supp);
    setSettleInvoiceId(firstInv?.id || '');
    setSettleAmount(firstInv ? Math.min(availableAdvance, Number(firstInv.remainingAmount || 0)) : 0);
  };

  const handleConfirmSettleAdvance = async () => {
    if (!settleSupplier || !settleInvoiceId || settleAmount <= 0 || isSettlingAdvance) return;
    setIsSettlingAdvance(true);
    setSettleError(null);
    try {
      const res = await settleSupplierAdvance(settleSupplier.id, {
        invoiceId: settleInvoiceId,
        amount: settleAmount,
        notes: settleNotes,
      });
      if (res.success) {
        setStatusBanner({
          type: 'success',
          text: t(
            `تمت تسوية دفعة مقدمة بمبلغ ${formatLocaleNumber(settleAmount)} ${t(settings.currency)} لصالح المورد (${settleSupplier.name}) دون حركة خزينة.`,
            `Settled advance payment of ${formatLocaleNumber(settleAmount)} ${t(settings.currency)} for supplier (${settleSupplier.name}) with no cashbox movement.`
          ),
        });
        setIsConfirmingSettle(false);
        setSettleSupplier(null);
      } else {
        setIsConfirmingSettle(false);
        setSettleError(t(res.error || 'تعذر تنفيذ تسوية الدفعة المقدمة', res.error || 'Could not complete advance settlement'));
      }
    } finally {
      setIsSettlingAdvance(false);
    }
  };

  // Supplier chronological ledger (opening + purchases + returns + payments)
  const supplierMovements = useMemo(() => {
    if (!statementSupplier) return [];
    const events: Array<{
      id: string;
      date: string;
      docNumber: string;
      typeLabel: string;
      badgeClass: string;
      description: string;
      credit: number;
      debit: number;
      timestamp: number;
    }> = [];

    if (statementSupplier.openingBalance !== 0) {
      events.push({
        id: 'opening-bal',
        date: statementSupplier.createdAt ? statementSupplier.createdAt.split('T')[0] : '2026-01-01',
        docNumber: t('افتتاحي', 'OPENING'),
        typeLabel: t('رصيد أول المدة', 'Opening Balance'),
        badgeClass: 'bg-slate-100 text-slate-800',
        description: t('الرصيد الافتتاحي المسجل للمورد', 'Recorded opening balance for supplier'),
        credit: statementSupplier.openingBalance > 0 ? statementSupplier.openingBalance : 0,
        debit: statementSupplier.openingBalance < 0 ? Math.abs(statementSupplier.openingBalance) : 0,
        timestamp: new Date(statementSupplier.createdAt || '2026-01-01').getTime(),
      });
    }

    invoices
      .filter(i => i.supplierId === statementSupplier.id && i.status === 'confirmed' && i.type === 'purchase')
      .forEach(inv => {
        const cashPaidAtInvoice =
          Array.isArray(inv.payments) && inv.payments.length > 0
            ? inv.payments
                .filter((p) => (p.paymentMethod as string) !== 'advance_settlement')
                .reduce((ps, p) => ps + Number(p.amount || 0), 0)
            : Number(inv.paidAtInvoice ?? inv.paidAmount ?? 0);
        events.push({
          id: inv.id,
          date: inv.date,
          docNumber: inv.invoiceNumber,
          typeLabel: t('فاتورة مشتريات', 'Purchase Invoice'),
          badgeClass: 'bg-[#EEF3FA] text-[#011E58]',
          description: t(`توريد بضاعة للمستودع (${t(inv.warehouseName)})`, `Goods supply to warehouse (${t(inv.warehouseName)})`),
          credit: inv.grandTotal,
          debit: cashPaidAtInvoice > 0 ? cashPaidAtInvoice : 0,
          timestamp: new Date(inv.date).getTime(),
        });
      });

    invoiceReturns
      .filter(r => r.partyId === statementSupplier.id && r.type === 'purchase_return')
      .forEach(ret => {
        events.push({
          id: ret.id,
          date: ret.date,
          docNumber: ret.returnNumber,
          typeLabel: t('مرتجع مشتريات', 'Purchase Return'),
          badgeClass: 'bg-amber-50 text-amber-800',
          description: t(`مرتجع للفاتورة (${ret.originalInvoiceNumber}) - ${t(ret.reason)}`, `Return for invoice (${ret.originalInvoiceNumber}) - ${t(ret.reason)}`),
          credit: 0,
          debit: ret.grandTotal,
          timestamp: new Date(ret.date).getTime(),
        });
      });

    financialTransactions
      .filter(tx => tx.partyId === statementSupplier.id && tx.type === 'supplier_payment')
      .forEach(tx => {
        events.push({
          id: tx.id,
          date: tx.date,
          docNumber: tx.transactionNumber,
          typeLabel: t('سند صرف نقدية', 'Cash Payment Voucher'),
          badgeClass: 'bg-emerald-50 text-emerald-800',
          description: t(`سداد من (${t(tx.cashboxName)}) - ${t(tx.notes || tx.description)}`, `Paid from (${t(tx.cashboxName)}) - ${t(tx.notes || tx.description)}`),
          credit: 0,
          debit: tx.amount,
          timestamp: new Date(tx.date).getTime(),
        });
      });

    events.sort((a, b) => a.timestamp - b.timestamp);
    let running = 0;
    return events.map(ev => {
      running = running + ev.credit - ev.debit;
      return { ...ev, runningBalance: running };
    });
  }, [statementSupplier, invoices, invoiceReturns, financialTransactions, t]);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
            <SuppliersTruckIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900 tracking-tight">{t('دليل الموردين والمطاحن', 'Suppliers & Mills Directory')}</h2>
            <p className="text-[11px] text-slate-500">
              {t(
                'إدارة حسابات ومستحقات شركات ومصانع الأغذية وسداد الدفعات النقدية',
                'Manage supplier & factory accounts, payables, and cash payments'
              )}
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('إضافة مورد جديد', 'Add New Supplier')}</span>
        </button>
      </div>

      {statusBanner && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </div>
          <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {/* Compact Supplier Summary Ledger Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden text-xs">
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('إجمالي الموردين المسجلين', 'Total Registered Suppliers')}</div>
          <div className="text-sm font-black font-mono tabular-nums text-[var(--awlad-navy-950)] dark:text-[#F3F7FC]">
            {formatLocaleNumber(supplierSummary.count)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t('مورد', 'suppliers')}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('مستحقات للموردين (علينا)', 'Payable to Suppliers (We Owe)')}</div>
          <div className="text-sm font-black font-mono tabular-nums text-rose-700 dark:text-rose-400">
            {formatLocaleNumber(supplierSummary.totalPayable)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t(settings.currency)}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('دفعات مقدمة لدى الموردين (لنا)', 'Advances with Suppliers (Our Credit)')}</div>
          <div className="text-sm font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatLocaleNumber(supplierSummary.totalAdvance)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t(settings.currency)}</span>
          </div>
        </div>
      </div>

      {/* Unified Suppliers Table */}
      <UnifiedDataTable<Supplier>
        title={t(`سجل الموردين والمطاحن (${formatLocaleNumber(filteredSuppliers.length)})`, `Suppliers & Mills Ledger (${formatLocaleNumber(filteredSuppliers.length)})`)}
        subtitle={t('بحث، فرز، كشوف حسابات، وتسوية الدفعات المقدمة', 'Search, sort, account statements, and advance settlements')}
        data={filteredSuppliers}
        rowKey={(s) => s.id}
        onRowClick={(s) => setStatementSupplier(s)}
        compact
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={t('بحث باسم المورد أو الكود أو رقم الهاتف أو العنوان...', 'Search by supplier name, code, phone, or address...')}
        exportFilename="AWLAD_SELIM_Suppliers"
        pdfTitle={t('دليل الموردين والمطاحن', 'Suppliers & Mills Directory')}
        emptyTitle={t('لا يوجد موردون مسجلون حالياً', 'No Suppliers Registered Yet')}
        emptySubtitle={t('انقر على زر "إضافة مورد جديد" لإضافة أول شركة توريد أو مورد للمنظومة.', 'Click "Add New Supplier" to add your first supplier or vendor.')}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
            <select
              aria-label={t('تصفية رصيد المورد', 'Filter Supplier Balance')}
              value={balanceFilter}
              onChange={(e) => setBalanceFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC] outline-hidden focus:border-[var(--awlad-royal-700)]"
            >
              <option value="all">{t(`كل الأرصدة (${formatLocaleNumber(suppliers.length)})`, `All Balances (${formatLocaleNumber(suppliers.length)})`)}</option>
              <option value="payable">{t('مستحق للمورد (علينا)', 'Payable (We Owe)')}</option>
              <option value="advance">{t('رصيد مقدم (لنا)', 'Advance Credit (For Us)')}</option>
              <option value="settled">{t('حساب متوازن', 'Settled Account')}</option>
            </select>
            <select
              aria-label={t('ترتيب الموردين', 'Sort Suppliers')}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC] outline-hidden focus:border-[var(--awlad-royal-700)]"
            >
              <option value="default">{t('الترتيب الافتراضي', 'Default Order')}</option>
              <option value="balance_desc">{t('الأعلى مديونية', 'Highest Payable')}</option>
              <option value="balance_asc">{t('الأعلى رصيد مقدم', 'Highest Advance Credit')}</option>
              <option value="name">{t('ترتيب أبجدي', 'Alphabetical')}</option>
            </select>
          </div>
        }
        columns={[
          {
            key: 'code',
            header: t('الكود', 'Code'),
            sortValue: (s) => s.code,
            exportValue: (s) => s.code,
            render: (s) => (
              <span className="font-mono text-[11px] font-bold text-[#011E58] bg-[#EEF3FA] px-2 py-0.5 rounded border border-[#DCE6F5] whitespace-nowrap">
                {s.code}
              </span>
            ),
          },
          {
            key: 'name',
            header: t('اسم المورد / الشركة', 'Supplier / Company Name'),
            sortValue: (s) => s.name,
            exportValue: (s) => s.name,
            render: (s) => <span className="font-black text-slate-900">{s.name}</span>,
          },
          {
            key: 'phone',
            header: t('الهاتف', 'Phone'),
            sortValue: (s) => s.phone,
            exportValue: (s) => s.phone,
            render: (s) => (
              <span className="font-mono tabular-nums text-slate-700" dir="ltr">
                {s.phone || '—'}
              </span>
            ),
          },
          {
            key: 'address',
            header: t('العنوان', 'Address'),
            sortValue: (s) => s.address || '',
            exportValue: (s) => s.address || '',
            render: (s) => <span className="text-slate-600">{s.address || '—'}</span>,
          },
          {
            key: 'currentBalance',
            header: t('الرصيد الحالي', 'Current Balance'),
            align: 'center',
            sortValue: (s) => Number(s.currentBalance || 0),
            exportValue: (s) => Number(s.currentBalance || 0),
            render: (supp) => (
              <div className="space-y-0.5 text-center">
                <div
                  className={`font-mono font-black text-xs tabular-nums ${
                    supp.currentBalance < 0
                      ? 'text-emerald-700'
                      : supp.currentBalance > 0
                      ? 'text-red-700'
                      : 'text-slate-600'
                  }`}
                >
                  {formatLocaleNumber(Math.abs(Number(supp.currentBalance || 0)))} {t(settings.currency)}
                </div>
                <span
                  className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${
                    supp.currentBalance < 0
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : supp.currentBalance > 0
                      ? 'bg-red-50 text-red-800 border-red-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  {supp.currentBalance < 0
                    ? t('رصيد لنا (مقدم)', 'Advance (For Us)')
                    : supp.currentBalance > 0
                    ? t('مستحق للمورد', 'Payable to Supplier')
                    : t('متوازن', 'Settled')}
                </span>
              </div>
            ),
          },
          {
            key: 'availableAdvance',
            header: t('مقدم قابل للتسوية', 'Settleable Advance'),
            align: 'center',
            sortValue: (s) => getSupplierAdvanceInfo(s).availableAdvance,
            exportValue: (s) => getSupplierAdvanceInfo(s).availableAdvance,
            render: (supp) => {
              const { openInvoices, availableAdvance } = getSupplierAdvanceInfo(supp);
              if (availableAdvance <= 0 || openInvoices.length === 0) {
                return <span className="text-slate-400">—</span>;
              }
              return (
                <span className="font-mono font-bold text-emerald-700 tabular-nums">
                  {formatLocaleNumber(availableAdvance)} {t(settings.currency)}
                </span>
              );
            },
          },
          {
            key: 'actions',
            header: t('الإجراءات', 'Actions'),
            align: 'center',
            sortable: false,
            render: (supp) => {
              const { openInvoices, availableAdvance } = getSupplierAdvanceInfo(supp);
              return (
                <div className="flex items-center justify-center gap-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentError(null);
                      setPaymentNotes('');
                      setPaymentSupplier(supp);
                      setPaymentAmount(supp.currentBalance > 0 ? supp.currentBalance : 0);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold text-[11px] whitespace-nowrap cursor-pointer"
                  >
                    <ArrowUpRight className="w-3 h-3" />
                    <span>{t('سداد دفعة', 'Pay')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatementSupplier(supp)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-bold text-[11px] whitespace-nowrap cursor-pointer"
                  >
                    <FileText className="w-3 h-3" />
                    <span>{t('كشف الحساب', 'Statement')}</span>
                  </button>
                  {availableAdvance > 0 && openInvoices.length > 0 && (currentUser?.role === 'admin' || hasPermission('canManageAccounts')) && (
                    <button
                      type="button"
                      onClick={() => handleOpenSettleModal(supp)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] rounded-md font-bold text-[11px] whitespace-nowrap cursor-pointer"
                    >
                      <DollarSign className="w-3 h-3" />
                      <span>{t('تسوية مقدم', 'Settle Advance')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(supp)}
                    className="p-1 text-slate-500 hover:text-blue-900 hover:bg-slate-100 rounded-md cursor-pointer"
                    title={t('تعديل بيانات المورد', 'Edit Supplier Details')}
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  {(currentUser?.role === 'admin' || hasPermission('canDelete')) && (
                    <button
                      type="button"
                      onClick={() => setSupplierToDelete(supp)}
                      className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                      title={t('حذف المورد', 'Delete Supplier')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            },
          },
        ] as UnifiedColumn<Supplier>[]}
      />

      {/* Supplier Statement Modal */}
      {statementSupplier && (
        <Modal
          isOpen={!!statementSupplier}
          onClose={() => setStatementSupplier(null)}
          title={t(
            `كشف حساب المورد: ${statementSupplier.name} (${statementSupplier.code})`,
            `Supplier Statement: ${statementSupplier.name} (${statementSupplier.code})`
          )}
          subtitle={
            statementSupplier.currentBalance < 0
              ? t(
                  `دفعة مقدمة للمورد / رصيد لنا: ${formatLocaleNumber(Math.abs(statementSupplier.currentBalance))} ${t(settings.currency)}`,
                  `Supplier Advance / Credit Balance: ${formatLocaleNumber(Math.abs(statementSupplier.currentBalance))} ${t(settings.currency)}`
                )
              : t(
                  `الرصيد المستحق الحالي للمورد: ${formatLocaleNumber(statementSupplier.currentBalance)} ${t(settings.currency)}`,
                  `Current Payable to Supplier: ${formatLocaleNumber(statementSupplier.currentBalance)} ${t(settings.currency)}`
                )
          }
          maxWidth="4xl"
        >
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2.5">
                <a
                  href={`tel:${statementSupplier.phone}`}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-[#EEF3FA] text-[#011E58] rounded-md font-mono font-bold border border-[#DCE6F5] hover:bg-[#DCE6F5]"
                >
                  <Phone className="w-3.5 h-3.5 text-[#003589]" />
                  <span dir="ltr">{statementSupplier.phone}</span>
                </a>
                <span className="text-slate-600">{statementSupplier.address}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPrintData({
                      title: t('كشف حساب مورد معتمد', 'Certified Supplier Account Statement'),
                      docNumber: statementSupplier.code,
                      docType: t('كشف حساب', 'Account Statement'),
                      date: new Date().toISOString().split('T')[0],
                      partyName: statementSupplier.name,
                      partyPhone: statementSupplier.phone,
                      partyAddress: statementSupplier.address,
                      grandTotal: statementSupplier.currentBalance,
                      notes: t(
                        `الرصيد المستحق: ${formatLocaleNumber(statementSupplier.currentBalance)} ${t(settings.currency)}`,
                        `Balance Due: ${formatLocaleNumber(statementSupplier.currentBalance)} ${t(settings.currency)}`
                      ),
                    });
                    setIsPrintModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-blue-900" />
                  <span>{t('طباعة كشف الحساب', 'Print Statement')}</span>
                </button>
              </div>
            </div>

            <UnifiedDataTable<(typeof supplierMovements)[number]>
              compact
              maxHeightClassName="max-h-96"
              data={supplierMovements}
              rowKey={(mov) => mov.id}
              searchPlaceholder={t('بحث برقم المستند أو البيان...', 'Search by document number or description...')}
              exportFilename={`AWLAD_SELIM_Supplier_${statementSupplier.code}`}
              pdfTitle={t(`كشف حساب المورد: ${statementSupplier.name}`, `Supplier Statement: ${statementSupplier.name}`)}
              emptyTitle={t('لا توجد فواتير أو حركات مشتريات مسجلة لهذا المورد بعد', 'No purchase invoices or transactions recorded for this supplier yet')}
              emptySubtitle={t(
                `الرصيد الافتتاحي هو: ${formatLocaleNumber(statementSupplier.openingBalance)} ${t(settings.currency)}`,
                `Opening Balance: ${formatLocaleNumber(statementSupplier.openingBalance)} ${t(settings.currency)}`
              )}
              columns={[
                {
                  key: 'date',
                  header: t('التاريخ', 'Date'),
                  sortValue: (m) => m.date,
                  exportValue: (m) => m.date,
                  render: (m) => <span className="font-mono tabular-nums text-slate-600">{m.date}</span>,
                },
                {
                  key: 'docNumber',
                  header: t('رقم المستند', 'Document #'),
                  sortValue: (m) => m.docNumber,
                  exportValue: (m) => m.docNumber,
                  render: (m) => <span className="font-mono font-bold text-blue-900">{m.docNumber}</span>,
                },
                {
                  key: 'typeLabel',
                  header: t('نوع المعاملة', 'Transaction Type'),
                  sortValue: (m) => m.typeLabel,
                  exportValue: (m) => m.typeLabel,
                  render: (m) => (
                    <span className={`px-2 py-0.5 rounded border border-slate-200 text-[10px] font-bold ${m.badgeClass}`}>
                      {m.typeLabel}
                    </span>
                  ),
                },
                {
                  key: 'description',
                  header: t('البيان', 'Description'),
                  sortValue: (m) => m.description,
                  exportValue: (m) => m.description,
                  render: (m) => <span className="text-slate-700">{m.description}</span>,
                },
                {
                  key: 'credit',
                  header: t('له / مشتريات (دائن)', 'Credit / Purchases'),
                  align: 'center',
                  sortValue: (m) => m.credit,
                  exportValue: (m) => m.credit,
                  render: (m) => (
                    <span className="font-mono tabular-nums font-bold text-slate-900">
                      {m.credit > 0 ? formatLocaleNumber(m.credit) : '—'}
                    </span>
                  ),
                },
                {
                  key: 'debit',
                  header: t('سداد / مرتجع (مدين)', 'Debit / Payments & Returns'),
                  align: 'center',
                  sortValue: (m) => m.debit,
                  exportValue: (m) => m.debit,
                  render: (m) => (
                    <span className="font-mono tabular-nums font-bold text-emerald-700">
                      {m.debit > 0 ? formatLocaleNumber(m.debit) : '—'}
                    </span>
                  ),
                },
                {
                  key: 'runningBalance',
                  header: t('الرصيد التراكمي', 'Running Balance'),
                  align: 'center',
                  sortValue: (m) => m.runningBalance,
                  exportValue: (m) => m.runningBalance,
                  render: (m) => (
                    <span className="font-mono font-black text-red-700 tabular-nums">
                      {formatLocaleNumber(Math.abs(m.runningBalance))}
                    </span>
                  ),
                },
                {
                  key: 'direction',
                  header: t('الاتجاه', 'Direction'),
                  align: 'center',
                  exportValue: (m) =>
                    m.runningBalance > 0.005
                      ? t('علينا', 'Payable')
                      : m.runningBalance < -0.005
                      ? t('لنا (مقدم)', 'Advance')
                      : t('متوازن', 'Settled'),
                  render: (m) => (
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-black border ${
                        m.runningBalance > 0.005
                          ? 'bg-red-50 text-red-800 border-red-200'
                          : m.runningBalance < -0.005
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {m.runningBalance > 0.005
                        ? t('علينا', 'Payable')
                        : m.runningBalance < -0.005
                        ? t('لنا (مقدم)', 'Advance')
                        : t('متوازن', 'Settled')}
                    </span>
                  ),
                },
              ]}
            />

            <div className="flex justify-end pt-2 border-t">
              <button
                type="button"
                onClick={() => setStatementSupplier(null)}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-md cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingSupplier ? t('تعديل بيانات المورد', 'Edit Supplier Details') : t('إضافة مورد جديد', 'Add New Supplier')}
        maxWidth="md"
      >
        <form onSubmit={handleSaveSupplier} className="space-y-2 text-xs">
          {supplierFormError && (
            <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{supplierFormError}</span>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">{t('اسم المورد / الشركة:', 'Supplier / Company Name:')}</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">{t('الهاتف:', 'Phone:')}</label>
            <input
              type="tel"
              required
              dir="ltr"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">{t('العنوان:', 'Address:')}</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1"
            />
          </div>
          {!editingSupplier && (
            <div>
              <label className="block font-bold mb-1">{t('رصيد أول المدة المستحق له:', 'Opening Balance Payable:')}</label>
              <input
                type="number"
                value={formData.openingBalance}
                onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
              {t('إلغاء', 'Cancel')}
            </button>
            <button type="submit" disabled={isSavingSupplier} className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50">
              {isSavingSupplier ? t('جاري الحفظ...', 'Saving...') : t('حفظ المورد', 'Save Supplier')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Supplier Payment Modal */}
      {paymentSupplier && (
        <Modal
          isOpen={!!paymentSupplier}
          onClose={() => setPaymentSupplier(null)}
          title={t(`سداد دفعة للمورد: ${paymentSupplier.name}`, `Pay Supplier: ${paymentSupplier.name}`)}
          subtitle={
            paymentSupplier.currentBalance > 0
              ? t(
                  `المستحق للمورد (علينا): ${formatLocaleNumber(paymentSupplier.currentBalance)} ${t(settings.currency)}`,
                  `Payable to Supplier: ${formatLocaleNumber(paymentSupplier.currentBalance)} ${t(settings.currency)}`
                )
              : paymentSupplier.currentBalance < 0
              ? t(
                  `دفعة مقدمة لنا عند المورد: ${formatLocaleNumber(Math.abs(paymentSupplier.currentBalance))} ${t(settings.currency)}`,
                  `Advance Credit with Supplier: ${formatLocaleNumber(Math.abs(paymentSupplier.currentBalance))} ${t(settings.currency)}`
                )
              : t('حساب المورد متوازن حالياً (0)', 'Supplier account is currently settled (0)')
          }
          maxWidth="md"
        >
          <form onSubmit={handleRecordPayment} className="space-y-2 text-xs">
            {paymentError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{paymentError}</span>
              </div>
            )}
            <div>
              <label className="block font-bold mb-1">{t(`المبلغ المسدد (${t(settings.currency)}):`, `Payment Amount (${t(settings.currency)}):`)}</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={paymentAmount || ''}
                onChange={(e) => setPaymentAmount(Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 text-center text-[#011E58] font-mono font-black text-sm"
              />
            </div>

            {(() => {
              const debt = Math.max(0, Number(paymentSupplier.currentBalance || 0));
              const overpayment = Math.max(0, Number((paymentAmount - debt).toFixed(2)));
              if (overpayment <= 0.009) return null;
              return (
                <div
                  className={`p-2 rounded-md border font-bold leading-relaxed space-y-1 ${
                    canApproveOverpayment
                      ? 'bg-amber-50 border-amber-200 text-amber-950'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-black">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>
                      {canApproveOverpayment
                        ? t('تنبيه دفعة مقدمة للمورد (رصيد لنا)', 'Supplier Advance Overpayment Notice (Credit for Us)')
                        : t('سداد يتجاوز المستحق يتطلب صلاحية اعتماد إدارية', 'Overpayment Requires Managerial Approval Permission')}
                    </span>
                  </div>
                  <p>
                    {t(
                      `المبلغ المدخل يتجاوز المديونية القائمة (${formatLocaleNumber(debt)} ${t(settings.currency)}) بمقدار ${formatLocaleNumber(overpayment)} ${t(settings.currency)} — سيُسجل كدفعة مقدمة لنا عند المورد.`,
                      `Entered amount exceeds current payable (${formatLocaleNumber(debt)} ${t(settings.currency)}) by ${formatLocaleNumber(overpayment)} ${t(settings.currency)} — it will be recorded as an advance credit with the supplier.`
                    )}
                  </p>
                  {!canApproveOverpayment && (
                    <p className="text-[11px] underline">
                      {t(
                        'لا تملك صلاحية اعتماد الدفعة الزائدة للمورد (مسموح للمدير العام / مدير الفرع / صلاحية الاعتماد فقط).',
                        'You do not have permission to approve supplier overpayments (allowed for Admin / Branch Manager / Approver only).'
                      )}
                    </p>
                  )}
                </div>
              );
            })()}

            <div>
              <label className="block font-bold mb-1">{t('الخزينة أو الحساب المسدد منه:', 'Paying Cashbox / Bank Account:')}</label>
              <select
                value={paymentCashboxId}
                onChange={(e) => setPaymentCashboxId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>
                    {cb.balanceHidden
                      ? `${t(cb.name)} (${t('رصيد محجوب', 'Balance Hidden')})`
                      : `${t(cb.name)} (${t('رصيدها:', 'Balance:')} ${formatLocaleNumber(cb.currentBalance ?? 0)})`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">{t('ملاحظات الصرف:', 'Payment Notes:')}</label>
              <input
                type="text"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setPaymentSupplier(null)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={
                  isSubmittingPayment ||
                  (paymentAmount - Math.max(0, Number(paymentSupplier.currentBalance || 0)) > 0.009 &&
                    !canApproveOverpayment)
                }
                className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
              >
                {isSubmittingPayment ? t('جاري الصرف...', 'Processing...') : t('تأكيد الصرف', 'Confirm Payment')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={!!supplierToDelete}
        onClose={() => !isDeletingSupplier && setSupplierToDelete(null)}
        onConfirm={handleConfirmDeleteSupplier}
        variant="danger"
        isLoading={isDeletingSupplier}
        title={t('تأكيد حذف المورد', 'Confirm Delete Supplier')}
        message={
          supplierToDelete
            ? t(
                `هل أنت متأكد من حذف المورد (${supplierToDelete.name})؟ لن يتم الحذف إذا كان مرتبطاً بفواتير أو حركات مالية.`,
                `Are you sure you want to delete supplier (${supplierToDelete.name})? Deletion will be blocked if linked to invoices or financial transactions.`
              )
            : ''
        }
        confirmLabel={t('حذف المورد', 'Delete Supplier')}
      />

      {/* Advance Settlement Modal */}
      {settleSupplier && (
        <Modal
          isOpen={!!settleSupplier}
          onClose={() => !isSettlingAdvance && setSettleSupplier(null)}
          title={t(`تسوية دفعة مقدمة للمورد: ${settleSupplier.name}`, `Settle Advance for Supplier: ${settleSupplier.name}`)}
          subtitle={t(
            'تسوية داخلية من الرصيد المقدم المتاح على فاتورة مشتريات دون التأثير على الخزائن',
            'Internal settlement from available advance credit onto a purchase invoice without affecting cashboxes'
          )}
          maxWidth="md"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { availableAdvance, openInvoices } = getSupplierAdvanceInfo(settleSupplier);
              const inv = openInvoices.find((i) => i.id === settleInvoiceId);
              if (!inv) {
                setSettleError(t('يرجى اختيار فاتورة مشتريات مفتوحة للتسوية.', 'Please select an open purchase invoice for settlement.'));
                return;
              }
              if (settleAmount <= 0 || settleAmount > Math.min(availableAdvance, inv.remainingAmount) + 0.01) {
                setSettleError(t('مبلغ التسوية يتجاوز المسموح به على الفاتورة أو الرصيد المقدم المتاح.', 'Settlement amount exceeds invoice remaining balance or available advance credit.'));
                return;
              }
              setSettleError(null);
              setIsConfirmingSettle(true);
            }}
            className="space-y-2 text-xs"
          >
            {settleError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{settleError}</span>
              </div>
            )}
            <div>
              <label className="block font-bold mb-1">{t('فاتورة المشتريات المفتوحة:', 'Open Purchase Invoice:')}</label>
              <select
                value={settleInvoiceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSettleInvoiceId(id);
                  const { openInvoices, availableAdvance } = getSupplierAdvanceInfo(settleSupplier);
                  const found = openInvoices.find((i) => i.id === id);
                  if (found) {
                    setSettleAmount(Math.min(availableAdvance, Number(found.remainingAmount || 0)));
                  }
                }}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
              >
                {getSupplierAdvanceInfo(settleSupplier).openInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — {t('متبقي:', 'Remaining:')} {formatLocaleNumber(Number(inv.remainingAmount || 0))} {t(settings.currency)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">
                {t(
                  `مبلغ التسوية (${t(settings.currency)}) — المتاح: ${formatLocaleNumber(getSupplierAdvanceInfo(settleSupplier).availableAdvance)}`,
                  `Settlement Amount (${t(settings.currency)}) — Available: ${formatLocaleNumber(getSupplierAdvanceInfo(settleSupplier).availableAdvance)}`
                )}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={settleAmount || ''}
                onChange={(e) => setSettleAmount(Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 text-center font-mono font-black text-emerald-800 text-sm"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">{t('ملاحظات التسوية:', 'Settlement Notes:')}</label>
              <input
                type="text"
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setSettleSupplier(null)}
                className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isSettlingAdvance}
                className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
              >
                {t('تنفيذ التسوية', 'Execute Settlement')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={isConfirmingSettle}
        onClose={() => !isSettlingAdvance && setIsConfirmingSettle(false)}
        onConfirm={handleConfirmSettleAdvance}
        variant="warning"
        isLoading={isSettlingAdvance}
        title={t('تأكيد تسوية الدفعة المقدمة', 'Confirm Advance Settlement')}
        message={
          settleSupplier
            ? t(
                `سيتم تسوية مبلغ ${formatLocaleNumber(settleAmount)} ${t(settings.currency)} من رصيد الدفعة المقدمة لحساب المورد (${settleSupplier.name}) على الفاتورة المحددة دون أي سحب أو حركة جديدة في الخزينة.`,
                `An amount of ${formatLocaleNumber(settleAmount)} ${t(settings.currency)} from the advance credit of supplier (${settleSupplier.name}) will be settled against the selected invoice with no new cashbox withdrawal.`
              )
            : ''
        }
        confirmLabel={t('تأكيد التسوية', 'Confirm Settlement')}
      />

      {/* Print Document Modal */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />
    </div>
  );
};

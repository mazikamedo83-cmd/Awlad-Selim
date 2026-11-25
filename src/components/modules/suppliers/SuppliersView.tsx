import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Search, Phone, MapPin, DollarSign, FileText, 
  ArrowUpRight, Printer, Edit, Trash2, AlertCircle, CheckCircle2, ShieldAlert 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
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
      return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }
    return list;
  }, [suppliers, searchTerm, balanceFilter, sortBy]);

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
      setSupplierFormError('يرجى إدخال اسم المورد أو الشركة.');
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
        setStatusBanner({ type: 'success', text: `تم تحديث بيانات المورد (${formData.name.trim()}) بنجاح.` });
      } else {
        await addSupplier({
          code: formData.code.trim(),
          name: formData.name.trim(),
          phone: formData.phone.trim(),
          address: formData.address.trim(),
          notes: formData.notes.trim(),
          openingBalance: Number(formData.openingBalance) || 0,
        });
        setStatusBanner({ type: 'success', text: `تمت إضافة المورد (${formData.name.trim()}) بنجاح.` });
      }
      setIsAddModalOpen(false);
    } catch (err: any) {
      setSupplierFormError(err?.message || 'تعذر حفظ بيانات المورد');
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPayment) return;
    setPaymentError(null);
    if (!paymentSupplier || paymentAmount <= 0) {
      setPaymentError('يرجى إدخال مبلغ صحيح أكبر من صفر.');
      return;
    }
    if (!paymentCashboxId) {
      setPaymentError('يرجى اختيار الخزينة أو الحساب البنكي المسدد منه.');
      return;
    }
    const debt = Math.max(0, Number(paymentSupplier.currentBalance || 0));
    const overpayment = Math.max(0, Number((paymentAmount - debt).toFixed(2)));
    if (overpayment > 0.009 && !canApproveOverpayment) {
      setPaymentError('المبلغ المدخل يتجاوز المستحق للمورد — يتطلب سداد الدفعة الزائدة/المقدمة موافقة المدير أو صلاحية الاعتماد.');
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
          title: 'سند صرف وسداد نقدية لمورد',
          docNumber: `PAY-${Date.now().toString().slice(-6)}`,
          docType: 'سند صرف',
          date: new Date().toISOString().split('T')[0],
          partyName: paymentSupplier.name,
          partyPhone: paymentSupplier.phone,
          partyAddress: paymentSupplier.address,
          grandTotal: paymentAmount,
          paidAmount: paymentAmount,
          notes: paymentNotes || 'تم صرف المبلغ نقداً من الخزينة لحساب المورد',
        });
        setIsPrintModalOpen(true);
        setStatusBanner({ type: 'success', text: `تم سداد مبلغ ${paymentAmount.toLocaleString()} ${settings.currency} للمورد (${paymentSupplier.name}).` });
        setPaymentSupplier(null);
        setPaymentAmount(0);
        setPaymentNotes('');
        setPaymentError(null);
      } else {
        setPaymentError(res.error || 'تعذر سداد الدفعة');
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
      setStatusBanner({ type: 'success', text: `تم حذف المورد (${supplierToDelete.name}) بنجاح.` });
      if (statementSupplier?.id === supplierToDelete.id) {
        setStatementSupplier(null);
      }
      setSupplierToDelete(null);
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err?.message || 'تعذر حذف المورد لوجود فواتير أو حركات مالية مرتبطة به.' });
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
    setSettleNotes('تسوية دفعة مقدمة على فاتورة المشتريات');
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
          text: `تمت تسوية دفعة مقدمة بمبلغ ${settleAmount.toLocaleString()} ${settings.currency} لصالح المورد (${settleSupplier.name}) دون حركة خزينة.`,
        });
        setIsConfirmingSettle(false);
        setSettleSupplier(null);
      } else {
        setIsConfirmingSettle(false);
        setSettleError(res.error || 'تعذر تنفيذ تسوية الدفعة المقدمة');
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
      credit: number; // له / مشتريات
      debit: number;  // سداد / مرتجع
      timestamp: number;
    }> = [];

    if (statementSupplier.openingBalance !== 0) {
      events.push({
        id: 'opening-bal',
        date: statementSupplier.createdAt ? statementSupplier.createdAt.split('T')[0] : '2026-01-01',
        docNumber: 'افتتاحي',
        typeLabel: 'رصيد أول المدة',
        badgeClass: 'bg-slate-100 text-slate-800',
        description: 'الرصيد الافتتاحي المسجل للمورد',
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
          typeLabel: 'فاتورة مشتريات',
          badgeClass: 'bg-[#EEF3FA] text-[#011E58]',
          description: `توريد بضاعة للمستودع (${inv.warehouseName})`,
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
          typeLabel: 'مرتجع مشتريات',
          badgeClass: 'bg-amber-50 text-amber-800',
          description: `مرتجع للفاتورة (${ret.originalInvoiceNumber}) - ${ret.reason}`,
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
          typeLabel: 'سند صرف نقدية',
          badgeClass: 'bg-emerald-50 text-emerald-800',
          description: `سداد من (${tx.cashboxName}) - ${tx.notes || tx.description}`,
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
  }, [statementSupplier, invoices, invoiceReturns, financialTransactions]);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
            <SuppliersTruckIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900 tracking-tight">دليل الموردين والمطاحن</h2>
            <p className="text-[11px] text-slate-500">
              إدارة حسابات ومستحقات شركات ومصانع الأغذية وسداد الدفعات النقدية
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>إضافة مورد جديد</span>
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
            إغلاق
          </button>
        </div>
      )}

      {/* Compact Supplier Summary Ledger Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden text-xs">
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">إجمالي الموردين المسجلين</div>
          <div className="text-sm font-black font-mono tabular-nums text-[var(--awlad-navy-950)] dark:text-[#F3F7FC]">
            {supplierSummary.count} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">مورد</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">مستحقات للموردين (علينا)</div>
          <div className="text-sm font-black font-mono tabular-nums text-rose-700 dark:text-rose-400">
            {supplierSummary.totalPayable.toLocaleString()} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">دفعات مقدمة لدى الموردين (لنا)</div>
          <div className="text-sm font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {supplierSummary.totalAdvance.toLocaleString()} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
          </div>
        </div>
      </div>

      {/* Unified Suppliers Table */}
      <UnifiedDataTable<Supplier>
        title={`سجل الموردين والمطاحن (${filteredSuppliers.length})`}
        subtitle="بحث، فرز، كشوف حسابات، وتسوية الدفعات المقدمة"
        data={filteredSuppliers}
        rowKey={(s) => s.id}
        onRowClick={(s) => setStatementSupplier(s)}
        compact
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="بحث باسم المورد أو الكود أو رقم الهاتف أو العنوان..."
        exportFilename="AWLAD_SELIM_Suppliers"
        pdfTitle="دليل الموردين والمطاحن"
        emptyTitle="لا يوجد موردون مسجلون حالياً"
        emptySubtitle={'انقر على زر "إضافة مورد جديد" لإضافة أول شركة توريد أو مورد للمنظومة.'}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
            <select
              aria-label="تصفية رصيد المورد"
              value={balanceFilter}
              onChange={(e) => setBalanceFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC] outline-hidden focus:border-[var(--awlad-royal-700)]"
            >
              <option value="all">كل الأرصدة ({suppliers.length})</option>
              <option value="payable">مستحق للمورد (علينا)</option>
              <option value="advance">رصيد مقدم (لنا)</option>
              <option value="settled">حساب متوازن</option>
            </select>
            <select
              aria-label="ترتيب الموردين"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC] outline-hidden focus:border-[var(--awlad-royal-700)]"
            >
              <option value="default">الترتيب الافتراضي</option>
              <option value="balance_desc">الأعلى مديونية</option>
              <option value="balance_asc">الأعلى رصيد مقدم</option>
              <option value="name">ترتيب أبجدي</option>
            </select>
          </div>
        }
        columns={[
          {
            key: 'code',
            header: 'الكود',
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
            header: 'اسم المورد / الشركة',
            sortValue: (s) => s.name,
            exportValue: (s) => s.name,
            render: (s) => <span className="font-black text-slate-900">{s.name}</span>,
          },
          {
            key: 'phone',
            header: 'الهاتف',
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
            header: 'العنوان',
            sortValue: (s) => s.address || '',
            exportValue: (s) => s.address || '',
            render: (s) => <span className="text-slate-600">{s.address || '—'}</span>,
          },
          {
            key: 'currentBalance',
            header: 'الرصيد الحالي',
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
                  {Math.abs(Number(supp.currentBalance || 0)).toLocaleString()} {settings.currency}
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
                  {supp.currentBalance < 0 ? 'رصيد لنا (مقدم)' : supp.currentBalance > 0 ? 'مستحق للمورد' : 'متوازن'}
                </span>
              </div>
            ),
          },
          {
            key: 'availableAdvance',
            header: 'مقدم قابل للتسوية',
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
                  {availableAdvance.toLocaleString()} {settings.currency}
                </span>
              );
            },
          },
          {
            key: 'actions',
            header: 'الإجراءات',
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
                    <span>سداد دفعة</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatementSupplier(supp)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-bold text-[11px] whitespace-nowrap cursor-pointer"
                  >
                    <FileText className="w-3 h-3" />
                    <span>كشف الحساب</span>
                  </button>
                  {availableAdvance > 0 && openInvoices.length > 0 && (currentUser?.role === 'admin' || hasPermission('canManageAccounts')) && (
                    <button
                      type="button"
                      onClick={() => handleOpenSettleModal(supp)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] rounded-md font-bold text-[11px] whitespace-nowrap cursor-pointer"
                    >
                      <DollarSign className="w-3 h-3" />
                      <span>تسوية مقدم</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(supp)}
                    className="p-1 text-slate-500 hover:text-blue-900 hover:bg-slate-100 rounded-md cursor-pointer"
                    title="تعديل بيانات المورد"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  {(currentUser?.role === 'admin' || hasPermission('canDelete')) && (
                    <button
                      type="button"
                      onClick={() => setSupplierToDelete(supp)}
                      className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                      title="حذف المورد"
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

      {/* Supplier Statement Modal (Section 5: فواتير المشتريات المرتبطة، مرتجعات المشتريات، المدفوعات، كشف الحساب) */}
      {statementSupplier && (
        <Modal
          isOpen={!!statementSupplier}
          onClose={() => setStatementSupplier(null)}
          title={`كشف حساب المورد: ${statementSupplier.name} (${statementSupplier.code})`}
          subtitle={
            statementSupplier.currentBalance < 0
              ? `دفعة مقدمة للمورد / رصيد لنا: ${Math.abs(statementSupplier.currentBalance).toLocaleString()} ${settings.currency}`
              : `الرصيد المستحق الحالي للمورد: ${statementSupplier.currentBalance.toLocaleString()} ${settings.currency}`
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
                  <span>{statementSupplier.phone}</span>
                </a>
                <span className="text-slate-600">{statementSupplier.address}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPrintData({
                      title: 'كشف حساب مورد معتمد',
                      docNumber: statementSupplier.code,
                      docType: 'كشف حساب',
                      date: new Date().toISOString().split('T')[0],
                      partyName: statementSupplier.name,
                      partyPhone: statementSupplier.phone,
                      partyAddress: statementSupplier.address,
                      grandTotal: statementSupplier.currentBalance,
                      notes: `الرصيد المستحق: ${statementSupplier.currentBalance.toLocaleString()} ${settings.currency}`,
                    });
                    setIsPrintModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-blue-900" />
                  <span>طباعة كشف الحساب</span>
                </button>
              </div>
            </div>

            <UnifiedDataTable<(typeof supplierMovements)[number]>
              compact
              maxHeightClassName="max-h-96"
              data={supplierMovements}
              rowKey={(mov) => mov.id}
              searchPlaceholder="بحث برقم المستند أو البيان..."
              exportFilename={`AWLAD_SELIM_Supplier_${statementSupplier.code}`}
              pdfTitle={`كشف حساب المورد: ${statementSupplier.name}`}
              emptyTitle="لا توجد فواتير أو حركات مشتريات مسجلة لهذا المورد بعد"
              emptySubtitle={`الرصيد الافتتاحي هو: ${statementSupplier.openingBalance.toLocaleString()} ${settings.currency}`}
              columns={[
                {
                  key: 'date',
                  header: 'التاريخ',
                  sortValue: (m) => m.date,
                  exportValue: (m) => m.date,
                  render: (m) => <span className="font-mono tabular-nums text-slate-600">{m.date}</span>,
                },
                {
                  key: 'docNumber',
                  header: 'رقم المستند',
                  sortValue: (m) => m.docNumber,
                  exportValue: (m) => m.docNumber,
                  render: (m) => <span className="font-mono font-bold text-blue-900">{m.docNumber}</span>,
                },
                {
                  key: 'typeLabel',
                  header: 'نوع المعاملة',
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
                  header: 'البيان',
                  sortValue: (m) => m.description,
                  exportValue: (m) => m.description,
                  render: (m) => <span className="text-slate-700">{m.description}</span>,
                },
                {
                  key: 'credit',
                  header: 'له / مشتريات (دائن)',
                  align: 'center',
                  sortValue: (m) => m.credit,
                  exportValue: (m) => m.credit,
                  render: (m) => (
                    <span className="font-mono tabular-nums font-bold text-slate-900">
                      {m.credit > 0 ? m.credit.toLocaleString() : '—'}
                    </span>
                  ),
                },
                {
                  key: 'debit',
                  header: 'سداد / مرتجع (مدين)',
                  align: 'center',
                  sortValue: (m) => m.debit,
                  exportValue: (m) => m.debit,
                  render: (m) => (
                    <span className="font-mono tabular-nums font-bold text-emerald-700">
                      {m.debit > 0 ? m.debit.toLocaleString() : '—'}
                    </span>
                  ),
                },
                {
                  key: 'runningBalance',
                  header: 'الرصيد التراكمي',
                  align: 'center',
                  sortValue: (m) => m.runningBalance,
                  exportValue: (m) => m.runningBalance,
                  render: (m) => (
                    <span className="font-mono font-black text-red-700 tabular-nums">
                      {Math.abs(m.runningBalance).toLocaleString()}
                    </span>
                  ),
                },
                {
                  key: 'direction',
                  header: 'الاتجاه',
                  align: 'center',
                  exportValue: (m) => (m.runningBalance > 0.005 ? 'علينا' : m.runningBalance < -0.005 ? 'لنا (مقدم)' : 'متوازن'),
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
                      {m.runningBalance > 0.005 ? 'علينا' : m.runningBalance < -0.005 ? 'لنا (مقدم)' : 'متوازن'}
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
                إغلاق
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingSupplier ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
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
            <label className="block font-bold mb-1">اسم المورد / الشركة:</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">الهاتف:</label>
            <input
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">العنوان:</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1"
            />
          </div>
          {!editingSupplier && (
            <div>
              <label className="block font-bold mb-1">رصيد أول المدة المستحق له:</label>
              <input
                type="number"
                placeholder="0.00"
                value={formData.openingBalance}
                onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">إلغاء</button>
            <button type="submit" disabled={isSavingSupplier} className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50">
              {isSavingSupplier ? 'جاري الحفظ...' : 'حفظ المورد'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Supplier Payment Modal */}
      {paymentSupplier && (
        <Modal
          isOpen={!!paymentSupplier}
          onClose={() => setPaymentSupplier(null)}
          title={`سداد دفعة للمورد: ${paymentSupplier.name}`}
          subtitle={
            paymentSupplier.currentBalance > 0
              ? `المستحق للمورد (علينا): ${paymentSupplier.currentBalance.toLocaleString()} ${settings.currency}`
              : paymentSupplier.currentBalance < 0
              ? `دفعة مقدمة لنا عند المورد: ${Math.abs(paymentSupplier.currentBalance).toLocaleString()} ${settings.currency}`
              : 'حساب المورد متوازن حالياً (0)'
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
              <label className="block font-bold mb-1">المبلغ المسدد ({settings.currency}):</label>
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
                        ? 'تنبيه دفعة مقدمة للمورد (رصيد لنا)'
                        : 'سداد يتجاوز المستحق يتطلب صلاحية اعتماد إدارية'}
                    </span>
                  </div>
                  <p>
                    المبلغ المدخل يتجاوز المديونية القائمة ({debt.toLocaleString()} {settings.currency}) بمقدار {overpayment.toLocaleString()} {settings.currency} — سيُسجل كدفعة مقدمة لنا عند المورد.
                  </p>
                  {!canApproveOverpayment && (
                    <p className="text-[11px] underline">
                      لا تملك صلاحية اعتماد الدفعة الزائدة للمورد (مسموح للمدير العام / مدير الفرع / صلاحية الاعتماد فقط).
                    </p>
                  )}
                </div>
              );
            })()}

            <div>
              <label className="block font-bold mb-1">الخزينة أو الحساب المسدد منه:</label>
              <select
                value={paymentCashboxId}
                onChange={(e) => setPaymentCashboxId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>
                    {cb.balanceHidden ? `${cb.name} (رصيد محجوب)` : `${cb.name} (رصيدها: ${(cb.currentBalance ?? 0).toLocaleString()})`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">ملاحظات الصرف:</label>
              <input
                type="text"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="سداد دفعة من حساب المورد..."
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setPaymentSupplier(null)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">إلغاء</button>
              <button
                type="submit"
                disabled={
                  isSubmittingPayment ||
                  (paymentAmount - Math.max(0, Number(paymentSupplier.currentBalance || 0)) > 0.009 &&
                    !canApproveOverpayment)
                }
                className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
              >
                {isSubmittingPayment ? 'جاري الصرف...' : 'تأكيد الصرف'}
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
        title="تأكيد حذف المورد"
        message={supplierToDelete ? `هل أنت متأكد من حذف المورد (${supplierToDelete.name})؟ لن يتم الحذف إذا كان مرتبطاً بفواتير أو حركات مالية.` : ''}
        confirmLabel="حذف المورد"
      />

      {/* Advance Settlement Modal */}
      {settleSupplier && (
        <Modal
          isOpen={!!settleSupplier}
          onClose={() => !isSettlingAdvance && setSettleSupplier(null)}
          title={`تسوية دفعة مقدمة للمورد: ${settleSupplier.name}`}
          subtitle="تسوية داخلية من الرصيد المقدم المتاح على فاتورة مشتريات دون التأثير على الخزائن"
          maxWidth="md"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { availableAdvance, openInvoices } = getSupplierAdvanceInfo(settleSupplier);
              const inv = openInvoices.find((i) => i.id === settleInvoiceId);
              if (!inv) {
                setSettleError('يرجى اختيار فاتورة مشتريات مفتوحة للتسوية.');
                return;
              }
              if (settleAmount <= 0 || settleAmount > Math.min(availableAdvance, inv.remainingAmount) + 0.01) {
                setSettleError('مبلغ التسوية يتجاوز المسموح به على الفاتورة أو الرصيد المقدم المتاح.');
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
              <label className="block font-bold mb-1">فاتورة المشتريات المفتوحة:</label>
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
                    {inv.invoiceNumber} — متبقي: {Number(inv.remainingAmount || 0).toLocaleString()} {settings.currency}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">
                مبلغ التسوية ({settings.currency}) — المتاح: {getSupplierAdvanceInfo(settleSupplier).availableAdvance.toLocaleString()}
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
              <label className="block font-bold mb-1">ملاحظات التسوية:</label>
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
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSettlingAdvance}
                className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
              >
                تنفيذ التسوية
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
        title="تأكيد تسوية الدفعة المقدمة"
        message={
          settleSupplier
            ? `سيتم تسوية مبلغ ${settleAmount.toLocaleString()} ${settings.currency} من رصيد الدفعة المقدمة لحساب المورد (${settleSupplier.name}) على الفاتورة المحددة دون أي سحب أو حركة جديدة في الخزينة.`
            : ''
        }
        confirmLabel="تأكيد التسوية"
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

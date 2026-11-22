import React, { useState, useMemo } from 'react';
import {
  UserCheck, Plus, ArrowDownCircle, ArrowUpCircle, Wallet, Edit, Printer,
  Download, FileDown, ShieldCheck, AlertCircle, CheckCircle2, Search, SlidersHorizontal
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { OwnerPersonalAccount, OwnerPersonalTransaction } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';

const TX_TYPE_LABELS: Record<OwnerPersonalTransaction['type'], { label: string; color: string }> = {
  opening_balance: { label: 'رصيد افتتاحي', color: 'bg-slate-100 text-slate-700' },
  personal_deposit: { label: 'إيداع شخصي', color: 'bg-emerald-100 text-emerald-800' },
  personal_withdrawal: { label: 'سحب شخصي', color: 'bg-rose-100 text-rose-800' },
  personal_expense: { label: 'مصروف شخصي', color: 'bg-orange-100 text-orange-800' },
  adjustment: { label: 'تسوية معتمدة', color: 'bg-indigo-100 text-indigo-800' },
};

export const PersonalAccountsView: React.FC = () => {
  const {
    ownerAccounts = [],
    ownerTransactions = [],
    cashboxes,
    settings,
    createOwnerAccount,
    updateOwnerAccount,
    createOwnerTransaction,
    editOwnerTransaction,
  } = useData();
  const { currentUser, hasPermission } = useAuth();

  const canCreateTx = currentUser?.role === 'admin' || hasPermission('canCreatePersonalTx');
  const canEditTx = currentUser?.role === 'admin' || hasPermission('canEditPersonalTx');
  const canAdjust = currentUser?.role === 'admin' || hasPermission('canApprovePersonalAdjustment');

  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [txTypeFilter, setTxTypeFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create / Edit Account Modal
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<OwnerPersonalAccount | null>(null);
  const [accOwnerName, setAccOwnerName] = useState('');
  const [accName, setAccName] = useState('');
  const [accDesc, setAccDesc] = useState('');
  const [accOpening, setAccOpening] = useState<number>(0);
  const [accStatus, setAccStatus] = useState<'active' | 'suspended'>('active');
  const [accNotes, setAccNotes] = useState('');
  const [accError, setAccError] = useState<string | null>(null);
  const [isSavingAcc, setIsSavingAcc] = useState(false);

  // Create Transaction Modal
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txAccountId, setTxAccountId] = useState('');
  const [txType, setTxType] = useState<OwnerPersonalTransaction['type']>('personal_deposit');
  const [txAmount, setTxAmount] = useState<number>(0);
  const [txDate, setTxDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [txCashboxId, setTxCashboxId] = useState<string>('');
  const [txReason, setTxReason] = useState('');
  const [txNotes, setTxNotes] = useState('');
  const [txError, setTxError] = useState<string | null>(null);
  const [isSavingTx, setIsSavingTx] = useState(false);

  // Edit Transaction Modal
  const [editingTx, setEditingTx] = useState<OwnerPersonalTransaction | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editDate, setEditDate] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Print
  const [printData, setPrintData] = useState<PrintData | null>(null);

  const filteredTransactions = useMemo(() => {
    return ownerTransactions.filter((t) => {
      if (selectedAccountId !== 'all' && t.accountId !== selectedAccountId) return false;
      if (txTypeFilter !== 'all' && t.type !== txTypeFilter) return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const hit =
          t.txNumber.toLowerCase().includes(q) ||
          t.ownerName.toLowerCase().includes(q) ||
          t.accountName.toLowerCase().includes(q) ||
          (t.notes || '').toLowerCase().includes(q) ||
          (t.reason || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [ownerTransactions, selectedAccountId, txTypeFilter, dateFrom, dateTo, searchTerm]);

  const totals = useMemo(() => {
    const totalBalance = ownerAccounts.reduce((sum, a) => sum + Number(a.currentBalance || 0), 0);
    const totalDeposits = ownerTransactions
      .filter((t) => t.type === 'personal_deposit' || t.type === 'opening_balance')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalWithdrawals = ownerTransactions
      .filter((t) => t.type === 'personal_withdrawal' || t.type === 'personal_expense')
      .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
    return { totalBalance, totalDeposits, totalWithdrawals };
  }, [ownerAccounts, ownerTransactions]);

  const openNewAccountModal = () => {
    setEditingAccount(null);
    setAccOwnerName('');
    setAccName('');
    setAccDesc('');
    setAccOpening(0);
    setAccStatus('active');
    setAccNotes('');
    setAccError(null);
    setIsAccountModalOpen(true);
  };

  const openEditAccountModal = (acc: OwnerPersonalAccount) => {
    setEditingAccount(acc);
    setAccOwnerName(acc.ownerName);
    setAccName(acc.accountName);
    setAccDesc(acc.description || '');
    setAccOpening(acc.openingBalance);
    setAccStatus(acc.status);
    setAccNotes(acc.notes || '');
    setAccError(null);
    setIsAccountModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccError(null);
    if (!accOwnerName.trim() || !accName.trim()) {
      setAccError('يرجى إدخال اسم المالك واسم الحساب الشخصي.');
      return;
    }
    setIsSavingAcc(true);
    const res = editingAccount
      ? await updateOwnerAccount(editingAccount.id, {
          ownerName: accOwnerName.trim(),
          accountName: accName.trim(),
          description: accDesc.trim(),
          status: accStatus,
          notes: accNotes.trim(),
        })
      : await createOwnerAccount({
          ownerName: accOwnerName.trim(),
          accountName: accName.trim(),
          description: accDesc.trim(),
          openingBalance: Number(accOpening || 0),
          notes: accNotes.trim(),
        });
    setIsSavingAcc(false);
    if (!res.success) {
      setAccError(res.error || 'تعذر حفظ الحساب الشخصي');
      return;
    }
    setIsAccountModalOpen(false);
    setBanner({
      type: 'success',
      text: editingAccount ? 'تم تحديث بيانات الحساب الشخصي بنجاح.' : 'تم إنشاء الحساب الشخصي للمالك بنجاح.',
    });
  };

  const openNewTxModal = (presetAccountId?: string, presetType?: OwnerPersonalTransaction['type']) => {
    const targetAccId = presetAccountId || (selectedAccountId !== 'all' ? selectedAccountId : ownerAccounts[0]?.id || '');
    setTxAccountId(targetAccId);
    setTxType(presetType || 'personal_deposit');
    setTxAmount(0);
    setTxDate(new Date().toISOString().split('T')[0]);
    setTxCashboxId('');
    setTxReason('');
    setTxNotes('');
    setTxError(null);
    setIsTxModalOpen(true);
  };

  const handleSaveTx = async (e: React.FormEvent) => {
    e.preventDefault();
    setTxError(null);
    if (!txAccountId) {
      setTxError('يرجى اختيار الحساب الشخصي أولاً.');
      return;
    }
    if (!txAmount || (txType !== 'adjustment' && txAmount <= 0)) {
      setTxError('يرجى إدخال مبلغ صحيح.');
      return;
    }
    if (txType === 'adjustment' && !txReason.trim()) {
      setTxError('يجب توضيح سبب التسوية لاعتمادها في سجل التدقيق.');
      return;
    }

    setIsSavingTx(true);
    const res = await createOwnerTransaction(txAccountId, {
      type: txType,
      amount: txAmount,
      date: txDate,
      cashboxId: txType === 'adjustment' ? undefined : txCashboxId || undefined,
      reason: txReason.trim(),
      notes: txNotes.trim(),
    });
    setIsSavingTx(false);
    if (!res.success) {
      setTxError(res.error || 'تعذر تسجيل الحركة الشخصية');
      return;
    }
    setIsTxModalOpen(false);
    setBanner({ type: 'success', text: `تم تسجيل الحركة (${res.transaction?.txNumber}) بنجاح.` });
  };

  const openEditTxModal = (tx: OwnerPersonalTransaction) => {
    setEditingTx(tx);
    setEditAmount(tx.amount);
    setEditDate(tx.date);
    setEditNotes(tx.notes || '');
    setEditReason('');
    setEditError(null);
  };

  const handleSaveEditTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;
    setEditError(null);
    if (!editReason.trim()) {
      setEditError('يرجى إدخال سبب التعديل لإثباته في سجل التدقيق.');
      return;
    }
    setIsSavingEdit(true);
    const res = await editOwnerTransaction(editingTx.id, {
      amount: editAmount,
      date: editDate,
      notes: editNotes.trim(),
      reason: editReason.trim(),
    });
    setIsSavingEdit(false);
    if (!res.success) {
      setEditError(res.error || 'تعذر تعديل الحركة الشخصية');
      return;
    }
    setEditingTx(null);
    setBanner({ type: 'success', text: `تم تعديل القيد الشخصي (${res.transaction?.txNumber}) وتحديث الرصيد.` });
  };

  const handleExportExcel = () => {
    const headers = ['رقم القيد', 'التاريخ', 'المالك', 'الحساب', 'النوع', 'المبلغ', 'الرصيد بعد', 'الخزينة', 'السبب / الملاحظات', 'بواسطة'];
    const rows = filteredTransactions.map((t) => [
      t.txNumber,
      t.date,
      t.ownerName,
      t.accountName,
      TX_TYPE_LABELS[t.type]?.label || t.type,
      t.amount,
      t.balanceAfter,
      t.cashboxName || 'مستقل (بدون خزينة)',
      t.reason || t.notes || '-',
      t.createdBy,
    ]);
    exportToExcel(`الحسابات_الشخصية_للملاك_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handleExportPdf = () => {
    exportTableToPdf(
      'كشف الحسابات الشخصية لأصحاب النشاط',
      ['رقم القيد', 'التاريخ', 'المالك / الحساب', 'النوع', 'المبلغ', 'الرصيد بعد', 'ملاحظات'],
      filteredTransactions.map((t) => [
        t.txNumber,
        t.date,
        `${t.ownerName} - ${t.accountName}`,
        TX_TYPE_LABELS[t.type]?.label || t.type,
        `${t.amount.toLocaleString()} ${settings.currency}`,
        `${t.balanceAfter.toLocaleString()} ${settings.currency}`,
        t.reason || t.notes || '-',
      ]),
      {
        companyName: settings.companyName,
        subtitle: 'حسابات خاصة للملاك — معزولة محاسبياً عن المبيعات والمصروفات التشغيلية',
        summaryPairs: [
          { label: 'إجمالي أرصدة الملاك', value: `${totals.totalBalance.toLocaleString()} ${settings.currency}`, highlight: true },
          { label: 'إجمالي الإيداعات', value: `${totals.totalDeposits.toLocaleString()} ${settings.currency}` },
          { label: 'إجمالي المسحوبات والمصروفات', value: `${totals.totalWithdrawals.toLocaleString()} ${settings.currency}` },
        ],
      }
    );
  };

  const handlePrintVoucher = (tx: OwnerPersonalTransaction) => {
    setPrintData({
      title: `إيصال حركة شخصية للمالك (${TX_TYPE_LABELS[tx.type]?.label || tx.type})`,
      docNumber: tx.txNumber,
      docType: tx.type === 'personal_deposit' ? 'سند قبض' : 'سند صرف',
      date: tx.date,
      partyName: `${tx.ownerName} — ${tx.accountName}`,
      warehouseName: tx.cashboxName || 'قيد شخصي مستقل',
      grandTotal: Math.abs(tx.amount),
      paidAmount: Math.abs(tx.amount),
      previousBalance: tx.balanceBefore,
      currentBalance: tx.balanceAfter,
      notes: `${tx.reason ? `السبب: ${tx.reason} | ` : ''}${tx.notes || ''}`,
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-blue-900" />
            <span>الحسابات الشخصية لأصحاب النشاط (الملاك)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            دفتر خاص ومعزول تماماً عن حسابات العملاء والموردين وإيرادات ومصروفات التشغيل والمخزون
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-2 border border-blue-200 bg-blue-50 rounded-xl text-xs font-bold hover:bg-blue-100 text-blue-900 cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>تصدير PDF</span>
          </button>
          {canCreateTx && (
            <>
              <button
                type="button"
                onClick={openNewAccountModal}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>حساب مالك جديد</span>
              </button>
              <button
                type="button"
                onClick={() => openNewTxModal()}
                disabled={ownerAccounts.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-black shadow-md disabled:opacity-50 cursor-pointer"
              >
                <Wallet className="w-4 h-4" />
                <span>تسجيل حركة شخصية</span>
              </button>
            </>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{banner.text}</span>
          </div>
          <button type="button" onClick={() => setBanner(null)} className="underline text-[11px] cursor-pointer">
            إغلاق
          </button>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold text-slate-500 block">عدد حسابات الملاك</span>
          <strong className="text-xl font-black text-blue-950 font-mono mt-1 block">{ownerAccounts.length}</strong>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold text-slate-500 block">إجمالي الإيداعات والافتتاحي</span>
          <strong className="text-xl font-black text-emerald-700 font-mono mt-1 block">
            {totals.totalDeposits.toLocaleString()} <span className="text-xs">{settings.currency}</span>
          </strong>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold text-slate-500 block">إجمالي المسحوبات والمصروفات</span>
          <strong className="text-xl font-black text-rose-700 font-mono mt-1 block">
            {totals.totalWithdrawals.toLocaleString()} <span className="text-xs">{settings.currency}</span>
          </strong>
        </div>
        <div className="bg-blue-950 text-white p-4 rounded-2xl shadow-md">
          <span className="text-xs font-bold text-blue-200 block">صافي أرصدة الملاك الحالية</span>
          <strong className="text-xl font-black font-mono mt-1 block">
            {totals.totalBalance.toLocaleString()} <span className="text-xs">{settings.currency}</span>
          </strong>
        </div>
      </div>

      {/* Owner Accounts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {ownerAccounts.length === 0 ? (
          <div className="md:col-span-3 bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500 space-y-2">
            <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="font-bold text-slate-700">لا توجد حسابات شخصية مضافة لأصحاب النشاط بعد</p>
            <p>أنشئ أول حساب مالك لتسجيل الإيداعات والمسحوبات والمصروفات الشخصية بمعزل عن حسابات الشركة.</p>
          </div>
        ) : (
          ownerAccounts.map((acc) => {
            const isSelected = selectedAccountId === acc.id;
            return (
              <div
                key={acc.id}
                onClick={() => setSelectedAccountId(isSelected ? 'all' : acc.id)}
                className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white shadow-xs ${
                  isSelected ? 'border-blue-700 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-bold text-blue-800">{acc.ownerName}</span>
                    <h4 className="text-sm font-black text-slate-900">{acc.accountName}</h4>
                    {acc.description && <p className="text-[11px] text-slate-500 mt-0.5">{acc.description}</p>}
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${acc.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                      {acc.status === 'active' ? 'نشط' : 'موقوف'}
                    </span>
                    {canEditTx && (
                      <button
                        type="button"
                        onClick={() => openEditAccountModal(acc)}
                        className="p-1 text-slate-400 hover:text-blue-900 cursor-pointer"
                        title="تعديل بيانات الحساب"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-500 block">الرصيد الحالي</span>
                    <strong className={`text-base font-black font-mono ${acc.currentBalance >= 0 ? 'text-blue-950' : 'text-red-700'}`}>
                      {acc.currentBalance.toLocaleString()} {settings.currency}
                    </strong>
                  </div>
                  {canCreateTx && acc.status === 'active' && (
                    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openNewTxModal(acc.id, 'personal_deposit')}
                        className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold hover:bg-emerald-100 cursor-pointer"
                      >
                        + إيداع
                      </button>
                      <button
                        type="button"
                        onClick={() => openNewTxModal(acc.id, 'personal_withdrawal')}
                        className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-bold hover:bg-rose-100 cursor-pointer"
                      >
                        - سحب
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
        <div className="relative">
          <input
            type="text"
            placeholder="بحث برقم القيد أو السبب..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2 pr-9 pl-3 outline-hidden focus:bg-white"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
        </div>
        <select
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold"
        >
          <option value="all">كل حسابات الملاك</option>
          {ownerAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.ownerName} - {a.accountName}</option>
          ))}
        </select>
        <select
          value={txTypeFilter}
          onChange={(e) => setTxTypeFilter(e.target.value)}
          className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold"
        >
          <option value="all">كل أنواع الحركات</option>
          <option value="personal_deposit">إيداع شخصي</option>
          <option value="personal_withdrawal">سحب شخصي</option>
          <option value="personal_expense">مصروف شخصي</option>
          <option value="adjustment">تسوية</option>
          <option value="opening_balance">رصيد افتتاحي</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono"
        />
      </div>

      {/* Ledger Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <th className="p-3">رقم الحركة</th>
                <th className="p-3">التاريخ</th>
                <th className="p-3">المالك / الحساب</th>
                <th className="p-3">النوع</th>
                <th className="p-3 text-center">المبلغ</th>
                <th className="p-3 text-center">الرصيد بعد</th>
                <th className="p-3">ربط الخزينة</th>
                <th className="p-3">السبب / الملاحظات</th>
                <th className="p-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    لا توجد حركات شخصية مطابقة للبحث.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
                  const meta = TX_TYPE_LABELS[tx.type] || { label: tx.type, color: 'bg-slate-100 text-slate-700' };
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-blue-900">{tx.txNumber}</td>
                      <td className="p-3 font-mono text-slate-600">{tx.date}</td>
                      <td className="p-3">
                        <span className="font-bold text-slate-900 block">{tx.ownerName}</span>
                        <span className="text-[10px] text-slate-500">{tx.accountName}</span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.color}`}>{meta.label}</span>
                      </td>
                      <td className="p-3 text-center font-mono font-black text-slate-900">
                        {tx.amount.toLocaleString()} {settings.currency}
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-blue-950">
                        {tx.balanceAfter.toLocaleString()}
                      </td>
                      <td className="p-3 text-[11px] text-slate-600">{tx.cashboxName || 'قيد مستقل'}</td>
                      <td className="p-3 text-[11px] text-slate-600">
                        <div>{tx.reason || tx.notes || '-'}</div>
                        {tx.editedBy && (
                          <span className="text-[10px] text-amber-700 block">تم التعديل بواسطة {tx.editedBy}</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handlePrintVoucher(tx)}
                            className="p-1.5 text-slate-500 hover:text-blue-900 cursor-pointer"
                            title="طباعة سند"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          {canEditTx && (
                            <button
                              type="button"
                              onClick={() => openEditTxModal(tx)}
                              className="p-1.5 text-slate-500 hover:text-amber-700 cursor-pointer"
                              title="تعديل الحركة مع تسجيل السبب"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
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
      </div>

      {/* Create / Edit Account Modal */}
      <Modal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        title={editingAccount ? 'تعديل حساب مالك شخصي' : 'إنشاء حساب شخصي جديد للمالك'}
        maxWidth="md"
      >
        <form onSubmit={handleSaveAccount} className="space-y-3 text-xs">
          {accError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{accError}</div>
          )}
          <div>
            <label className="block font-bold mb-1">اسم المالك / الشريك:</label>
            <input
              type="text"
              required
              value={accOwnerName}
              onChange={(e) => setAccOwnerName(e.target.value)}
              placeholder="مثال: الحاج سليم / أ. أحمد سليم"
              className="w-full border rounded-xl p-2.5 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">اسم الحساب الشخصي:</label>
            <input
              type="text"
              required
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              placeholder="مثال: الحساب الجاري الشخصي"
              className="w-full border rounded-xl p-2.5 font-bold"
            />
          </div>
          {!editingAccount ? (
            <div>
              <label className="block font-bold mb-1">الرصيد الافتتاحي ({settings.currency}):</label>
              <input
                type="number"
                step="0.01"
                value={accOpening}
                onChange={(e) => setAccOpening(Number(e.target.value))}
                className="w-full border rounded-xl p-2.5 font-mono font-bold"
              />
            </div>
          ) : (
            <div>
              <label className="block font-bold mb-1">حالة الحساب:</label>
              <select
                value={accStatus}
                onChange={(e) => setAccStatus(e.target.value as any)}
                className="w-full border rounded-xl p-2.5 font-bold"
              >
                <option value="active">نشط</option>
                <option value="suspended">موقوف</option>
              </select>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">وصف / ملاحظات:</label>
            <textarea
              rows={2}
              value={accDesc}
              onChange={(e) => setAccDesc(e.target.value)}
              className="w-full border rounded-xl p-2"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={() => setIsAccountModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">
              إلغاء
            </button>
            <button type="submit" disabled={isSavingAcc} className="px-5 py-2 bg-blue-900 text-white rounded-xl font-bold cursor-pointer">
              {isSavingAcc ? 'جاري الحفظ...' : 'حفظ الحساب'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Personal Transaction Modal */}
      <Modal
        isOpen={isTxModalOpen}
        onClose={() => setIsTxModalOpen(false)}
        title="تسجيل حركة حساب شخصي"
        subtitle="هذه العملية معزولة تماماً عن المبيعات والمصروفات التشغيلية للنشاط"
        maxWidth="md"
      >
        <form onSubmit={handleSaveTx} className="space-y-3 text-xs">
          {txError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{txError}</div>
          )}
          <div>
            <label className="block font-bold mb-1">الحساب الشخصي:</label>
            <select
              value={txAccountId}
              onChange={(e) => setTxAccountId(e.target.value)}
              required
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {ownerAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ownerName} - {a.accountName} ({a.currentBalance.toLocaleString()} {settings.currency})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">نوع الحركة:</label>
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value as any)}
                className="w-full border rounded-xl p-2.5 font-bold"
              >
                <option value="personal_deposit">إيداع شخصي (+)</option>
                <option value="personal_withdrawal">سحب شخصي (-)</option>
                <option value="personal_expense">مصروف شخصي (-)</option>
                {canAdjust && <option value="adjustment">تسوية رصيد (+/-)</option>}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">التاريخ:</label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">
              {txType === 'adjustment' ? 'قيمة التسوية (+ زيادة / - خصم):' : `المبلغ (${settings.currency}):`}
            </label>
            <input
              type="number"
              step="0.01"
              required
              value={txAmount || ''}
              onChange={(e) => setTxAmount(Number(e.target.value))}
              className="w-full border border-blue-300 bg-blue-50 rounded-xl p-2.5 font-mono font-black text-center text-base"
            />
          </div>

          {txType !== 'adjustment' && (
            <div>
              <label className="block font-bold mb-1">ربط بخزينة الشركة (اختياري):</label>
              <select
                value={txCashboxId}
                onChange={(e) => setTxCashboxId(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-bold"
              >
                <option value="">-- بدون ربط بخزينة النشاط (قيد شخصي خارجي مستقل) --</option>
                {cashboxes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.balanceHidden ? `${c.name} (رصيد محجوب)` : `${c.name} (${(c.currentBalance ?? 0).toLocaleString()} ${settings.currency})`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">
              السبب / البيان {txType === 'adjustment' ? <span className="text-red-600">*</span> : ''}:
            </label>
            <input
              type="text"
              required={txType === 'adjustment'}
              value={txReason}
              onChange={(e) => setTxReason(e.target.value)}
              placeholder="مثال: مصروفات عائلية / سداد التزام شخصي / تمويل من المالك"
              className="w-full border rounded-xl p-2.5 font-bold"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">ملاحظات إضافية:</label>
            <textarea
              rows={2}
              value={txNotes}
              onChange={(e) => setTxNotes(e.target.value)}
              className="w-full border rounded-xl p-2"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={() => setIsTxModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">
              إلغاء
            </button>
            <button type="submit" disabled={isSavingTx} className="px-6 py-2 bg-blue-900 text-white rounded-xl font-black cursor-pointer">
              {isSavingTx ? 'جاري التسجيل...' : 'حفظ القيد الشخصي'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Personal Transaction Modal */}
      {editingTx && (
        <Modal
          isOpen={!!editingTx}
          onClose={() => setEditingTx(null)}
          title={`تعديل الحركة الشخصية (${editingTx.txNumber})`}
          maxWidth="md"
        >
          <form onSubmit={handleSaveEditTx} className="space-y-3 text-xs">
            {editError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{editError}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1">المبلغ:</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editAmount}
                  onChange={(e) => setEditAmount(Number(e.target.value))}
                  className="w-full border rounded-xl p-2.5 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">التاريخ:</label>
                <input
                  type="date"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full border rounded-xl p-2.5 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-bold mb-1">سبب التعديل (إلزامي للتدقيق): <span className="text-red-600">*</span></label>
              <input
                type="text"
                required
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="اكتب سبب التعديل بالتفصيل..."
                className="w-full border border-amber-300 rounded-xl p-2.5 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">ملاحظات:</label>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full border rounded-xl p-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <button type="button" onClick={() => setEditingTx(null)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">
                إلغاء
              </button>
              <button type="submit" disabled={isSavingEdit} className="px-5 py-2 bg-amber-600 text-white rounded-xl font-black cursor-pointer">
                {isSavingEdit ? 'جاري التعديل...' : 'حفظ التعديل وتحديث الرصيد'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <PrintDocumentModal isOpen={!!printData} onClose={() => setPrintData(null)} data={printData} />
    </div>
  );
};

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
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

const TX_TYPE_LABELS: Record<OwnerPersonalTransaction['type'], { label: string; color: string }> = {
  opening_balance: { label: 'رصيد افتتاحي', color: 'bg-slate-100 text-slate-700' },
  personal_deposit: { label: 'إيداع شخصي', color: 'bg-emerald-100 text-emerald-800' },
  personal_withdrawal: { label: 'سحب شخصي', color: 'bg-rose-100 text-rose-800' },
  personal_expense: { label: 'مصروف شخصي', color: 'bg-amber-100 text-amber-900' },
  adjustment: { label: 'تسوية معتمدة', color: 'bg-[#DCE6F5] text-[#011E58]' },
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
  const [accOpening, setAccOpening] = useState<number | ''>('');
  const [accStatus, setAccStatus] = useState<'active' | 'suspended'>('active');
  const [accNotes, setAccNotes] = useState('');
  const [accError, setAccError] = useState<string | null>(null);
  const [isSavingAcc, setIsSavingAcc] = useState(false);

  // Create Transaction Modal
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txAccountId, setTxAccountId] = useState('');
  const [txType, setTxType] = useState<OwnerPersonalTransaction['type']>('personal_deposit');
  const [txAmount, setTxAmount] = useState<number | ''>('');
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
    setAccOpening('');
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
    setTxAmount('');
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
    const numTxAmt = Number(txAmount || 0);
    if (txAmount === '' || (txType !== 'adjustment' && numTxAmt <= 0)) {
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
      amount: numTxAmt,
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
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-1.5">
            <UserCheck className="w-4 h-4 text-blue-900" />
            <span>الحسابات الشخصية لأصحاب النشاط (الملاك)</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            دفتر خاص ومعزول تماماً عن حسابات العملاء والموردين وإيرادات ومصروفات التشغيل والمخزون
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1 px-2.5 py-1 border border-slate-300 rounded-md text-xs font-bold hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="flex items-center gap-1 px-2.5 py-1 border border-blue-200 bg-blue-50 rounded-md text-xs font-bold hover:bg-blue-100 text-blue-900 cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>تصدير PDF</span>
          </button>
          {canCreateTx && (
            <>
              <button
                type="button"
                onClick={openNewAccountModal}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-md text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>حساب مالك جديد</span>
              </button>
              <button
                type="button"
                onClick={() => openNewTxModal()}
                disabled={ownerAccounts.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 bg-blue-900 hover:bg-blue-950 text-white rounded-md text-xs font-black disabled:opacity-50 cursor-pointer"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>تسجيل حركة شخصية</span>
              </button>
            </>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`px-2.5 py-1.5 rounded-md border text-xs font-bold flex items-center justify-between gap-2 ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {banner.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{banner.text}</span>
          </div>
          <button type="button" onClick={() => setBanner(null)} className="underline text-[11px] cursor-pointer">
            إغلاق
          </button>
        </div>
      )}

      {/* Compact KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden">
        <div className="bg-white px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-slate-500 block">عدد حسابات الملاك</span>
          <strong className="text-sm font-black text-blue-950 font-mono tabular-nums">{ownerAccounts.length}</strong>
        </div>
        <div className="bg-white px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-slate-500 block">إجمالي الإيداعات والافتتاحي</span>
          <strong className="text-sm font-black text-emerald-700 font-mono tabular-nums">
            {totals.totalDeposits.toLocaleString()} <span className="text-[11px]">{settings.currency}</span>
          </strong>
        </div>
        <div className="bg-white px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-slate-500 block">إجمالي المسحوبات والمصروفات</span>
          <strong className="text-sm font-black text-rose-700 font-mono tabular-nums">
            {totals.totalWithdrawals.toLocaleString()} <span className="text-[11px]">{settings.currency}</span>
          </strong>
        </div>
        <div className="bg-[#011E58] text-white px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-[#DCE6F5] block">صافي أرصدة الملاك الحالية</span>
          <strong className="text-sm font-black font-mono tabular-nums">
            {totals.totalBalance.toLocaleString()} <span className="text-[11px]">{settings.currency}</span>
          </strong>
        </div>
      </div>

      {/* Owner Accounts Table */}
      <UnifiedDataTable<OwnerPersonalAccount>
        title="دليل حسابات الملاك الشخصية"
        subtitle="انقر على أي حساب لتصفية كشف حركاته بالأسفل"
        data={ownerAccounts}
        rowKey={(acc) => acc.id}
        searchable={false}
        compact
        defaultPageSize={10}
        onRowClick={(acc) => setSelectedAccountId(selectedAccountId === acc.id ? 'all' : acc.id)}
        rowClassName={(acc) => (selectedAccountId === acc.id ? 'bg-blue-50/70' : '')}
        emptyTitle="لا توجد حسابات شخصية مضافة لأصحاب النشاط بعد"
        emptySubtitle="أنشئ أول حساب مالك لتسجيل الإيداعات والمسحوبات والمصروفات الشخصية بمعزل عن حسابات الشركة."
        columns={[
          {
            key: 'ownerName',
            header: 'اسم المالك',
            align: 'right',
            sortValue: (a) => a.ownerName,
            exportValue: (a) => a.ownerName,
            render: (a) => <span className="font-bold text-blue-950">{a.ownerName}</span>,
          },
          {
            key: 'accountName',
            header: 'اسم الحساب الشخصي',
            align: 'right',
            sortValue: (a) => a.accountName,
            exportValue: (a) => a.accountName,
            render: (a) => (
              <div>
                <div className="font-bold text-slate-900">{a.accountName}</div>
                {a.description && <div className="text-[10px] text-slate-500">{a.description}</div>}
              </div>
            ),
          },
          {
            key: 'status',
            header: 'الحالة',
            align: 'center',
            sortValue: (a) => a.status,
            exportValue: (a) => (a.status === 'active' ? 'نشط' : 'موقوف'),
            render: (a) => (
              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${a.status === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                {a.status === 'active' ? 'نشط' : 'موقوف'}
              </span>
            ),
          },
          {
            key: 'currentBalance',
            header: 'الرصيد الحالي',
            align: 'center',
            sortValue: (a) => a.currentBalance,
            exportValue: (a) => a.currentBalance,
            render: (a) => (
              <span className={`font-mono font-black tabular-nums ${a.currentBalance >= 0 ? 'text-blue-950' : 'text-red-700'}`}>
                {a.currentBalance.toLocaleString()} {settings.currency}
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'الإجراءات',
            align: 'center',
            sortable: false,
            render: (acc) => (
              <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                {canCreateTx && acc.status === 'active' && (
                  <>
                    <button
                      type="button"
                      onClick={() => openNewTxModal(acc.id, 'personal_deposit')}
                      className="px-2 py-1 rounded bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] text-[10px] font-bold hover:bg-[#DCE6F5] cursor-pointer"
                    >
                      + إيداع
                    </button>
                    <button
                      type="button"
                      onClick={() => openNewTxModal(acc.id, 'personal_withdrawal')}
                      className="px-2 py-1 rounded bg-rose-50 text-rose-800 border border-rose-200 text-[10px] font-bold hover:bg-rose-100 cursor-pointer"
                    >
                      - سحب
                    </button>
                  </>
                )}
                {canEditTx && (
                  <button
                    type="button"
                    onClick={() => openEditAccountModal(acc)}
                    className="p-1 text-slate-500 hover:text-blue-900 cursor-pointer"
                    title="تعديل بيانات الحساب"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Personal Transactions Ledger Table */}
      <UnifiedDataTable<OwnerPersonalTransaction>
        title="سجل الحركات الشخصية للملاك"
        data={filteredTransactions}
        rowKey={(tx) => tx.id}
        compact
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="بحث برقم القيد أو السبب..."
        exportFilename="الحسابات-الشخصية-للملاك"
        pdfTitle="كشف الحسابات الشخصية لأصحاب النشاط"
        emptyTitle="لا توجد حركات شخصية مطابقة للبحث"
        toolbarFilters={
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold"
            >
              <option value="all">كل حسابات الملاك</option>
              {ownerAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.ownerName} - {a.accountName}</option>
              ))}
            </select>
            <select
              value={txTypeFilter}
              onChange={(e) => setTxTypeFilter(e.target.value)}
              className="h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold"
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
              className="h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-mono"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-mono"
            />
          </div>
        }
        columns={[
          {
            key: 'txNumber',
            header: 'رقم الحركة',
            align: 'right',
            sortValue: (t) => t.txNumber,
            exportValue: (t) => t.txNumber,
            render: (t) => <span className="font-mono font-bold text-blue-900">{t.txNumber}</span>,
          },
          {
            key: 'date',
            header: 'التاريخ',
            align: 'center',
            sortValue: (t) => t.date,
            exportValue: (t) => t.date,
            render: (t) => <span className="font-mono text-slate-600 tabular-nums">{t.date}</span>,
          },
          {
            key: 'ownerName',
            header: 'المالك / الحساب',
            align: 'right',
            sortValue: (t) => `${t.ownerName} ${t.accountName}`,
            exportValue: (t) => `${t.ownerName} - ${t.accountName}`,
            render: (t) => (
              <div>
                <span className="font-bold text-slate-900 block">{t.ownerName}</span>
                <span className="text-[10px] text-slate-500">{t.accountName}</span>
              </div>
            ),
          },
          {
            key: 'type',
            header: 'النوع',
            align: 'center',
            sortValue: (t) => t.type,
            exportValue: (t) => TX_TYPE_LABELS[t.type]?.label || t.type,
            render: (t) => {
              const meta = TX_TYPE_LABELS[t.type] || { label: t.type, color: 'bg-slate-100 text-slate-700' };
              return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${meta.color}`}>{meta.label}</span>;
            },
          },
          {
            key: 'amount',
            header: 'المبلغ',
            align: 'center',
            sortValue: (t) => t.amount,
            exportValue: (t) => t.amount,
            render: (t) => (
              <span className="font-mono font-black text-slate-900 tabular-nums">
                {t.amount.toLocaleString()} {settings.currency}
              </span>
            ),
          },
          {
            key: 'balanceAfter',
            header: 'الرصيد بعد',
            align: 'center',
            sortValue: (t) => t.balanceAfter,
            exportValue: (t) => t.balanceAfter,
            render: (t) => (
              <span className="font-mono font-bold text-blue-950 tabular-nums">
                {t.balanceAfter.toLocaleString()}
              </span>
            ),
          },
          {
            key: 'cashboxName',
            header: 'ربط الخزينة',
            align: 'right',
            sortValue: (t) => t.cashboxName || 'قيد مستقل',
            exportValue: (t) => t.cashboxName || 'قيد مستقل',
            render: (t) => <span className="text-[11px] text-slate-600">{t.cashboxName || 'قيد مستقل'}</span>,
          },
          {
            key: 'reason',
            header: 'السبب / الملاحظات',
            align: 'right',
            sortValue: (t) => t.reason || t.notes || '',
            exportValue: (t) => t.reason || t.notes || '-',
            render: (t) => (
              <div className="text-[11px] text-slate-600">
                <div>{t.reason || t.notes || '-'}</div>
                {t.editedBy && <span className="text-[10px] text-amber-700 block">تم التعديل بواسطة {t.editedBy}</span>}
              </div>
            ),
          },
          {
            key: 'actions',
            header: 'الإجراءات',
            align: 'center',
            sortable: false,
            render: (tx) => (
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
            ),
          },
        ]}
      />

      {/* Create / Edit Account Modal */}
      <Modal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        title={editingAccount ? 'تعديل حساب مالك شخصي' : 'إنشاء حساب شخصي جديد للمالك'}
        maxWidth="md"
      >
        <form onSubmit={handleSaveAccount} className="space-y-2 text-xs">
          {accError && (
            <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{accError}</div>
          )}
          <div>
            <label className="block font-bold mb-1">اسم المالك / الشريك:</label>
            <input
              type="text"
              required
              value={accOwnerName}
              onChange={(e) => setAccOwnerName(e.target.value)}
              placeholder="مثال: الحاج سليم / أ. أحمد سليم"
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
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
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
            />
          </div>
          {!editingAccount ? (
            <div>
              <label className="block font-bold mb-1">الرصيد الافتتاحي ({settings.currency}):</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={accOpening}
                onChange={(e) => setAccOpening(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
              />
            </div>
          ) : (
            <div>
              <label className="block font-bold mb-1">حالة الحساب:</label>
              <select
                value={accStatus}
                onChange={(e) => setAccStatus(e.target.value as any)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
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
              className="w-full border border-slate-300 rounded-md px-2 py-1.5"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAccountModalOpen(false)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
              إلغاء
            </button>
            <button type="submit" disabled={isSavingAcc} className="px-3 py-1 bg-blue-900 text-white rounded-md font-bold cursor-pointer">
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
        <form onSubmit={handleSaveTx} className="space-y-2 text-xs">
          {txError && (
            <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{txError}</div>
          )}
          <div>
            <label className="block font-bold mb-1">الحساب الشخصي:</label>
            <select
              value={txAccountId}
              onChange={(e) => setTxAccountId(e.target.value)}
              required
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
            >
              {ownerAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ownerName} - {a.accountName} ({a.currentBalance.toLocaleString()} {settings.currency})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">نوع الحركة:</label>
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value as any)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
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
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono"
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
              className="w-full h-8 border border-blue-300 bg-blue-50 rounded-md px-2 py-1 font-mono font-black text-center text-sm"
            />
          </div>

          {txType !== 'adjustment' && (
            <div>
              <label className="block font-bold mb-1">ربط بخزينة الشركة (اختياري):</label>
              <select
                value={txCashboxId}
                onChange={(e) => setTxCashboxId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
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
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">ملاحظات إضافية:</label>
            <textarea
              rows={2}
              value={txNotes}
              onChange={(e) => setTxNotes(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsTxModalOpen(false)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
              إلغاء
            </button>
            <button type="submit" disabled={isSavingTx} className="px-3 py-1 bg-blue-900 text-white rounded-md font-black cursor-pointer">
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
          <form onSubmit={handleSaveEditTx} className="space-y-2 text-xs">
            {editError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{editError}</div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold mb-1">المبلغ:</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={editAmount || ''}
                  onChange={(e) => setEditAmount(e.target.value === '' ? 0 : Number(e.target.value))}
                  className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">التاريخ:</label>
                <input
                  type="date"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono"
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
                className="w-full h-8 border border-amber-300 rounded-md px-2 py-1 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">ملاحظات:</label>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setEditingTx(null)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
                إلغاء
              </button>
              <button type="submit" disabled={isSavingEdit} className="px-3 py-1 bg-amber-600 text-white rounded-md font-black cursor-pointer">
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

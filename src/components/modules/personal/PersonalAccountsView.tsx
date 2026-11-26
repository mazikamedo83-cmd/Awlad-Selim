import React, { useState, useMemo } from 'react';
import {
  UserCheck, Plus, ArrowDownCircle, ArrowUpCircle, Wallet, Edit, Printer,
  Download, FileDown, ShieldCheck, AlertCircle, CheckCircle2, Search
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { OwnerPersonalAccount, OwnerPersonalTransaction } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

const TX_TYPE_LABELS: Record<OwnerPersonalTransaction['type'], { labelAr: string; labelEn: string; color: string }> = {
  opening_balance: { labelAr: 'رصيد افتتاحي', labelEn: 'Opening Balance', color: 'bg-slate-100 text-slate-700' },
  personal_deposit: { labelAr: 'إيداع شخصي', labelEn: 'Personal Deposit', color: 'bg-emerald-100 text-emerald-800' },
  personal_withdrawal: { labelAr: 'سحب شخصي', labelEn: 'Personal Withdrawal', color: 'bg-rose-100 text-rose-800' },
  personal_expense: { labelAr: 'مصروف شخصي', labelEn: 'Personal Expense', color: 'bg-amber-100 text-amber-900' },
  adjustment: { labelAr: 'تسوية معتمدة', labelEn: 'Approved Adjustment', color: 'bg-[#DCE6F5] text-[#011E58]' },
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
  const { t } = usePreferences();

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
      setAccError(t('يرجى إدخال اسم المالك واسم الحساب الشخصي.', 'Please enter the owner name and personal account name.'));
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
      setAccError(res.error ? t(res.error) : t('تعذر حفظ الحساب الشخصي', 'Failed to save personal account'));
      return;
    }
    setIsAccountModalOpen(false);
    setBanner({
      type: 'success',
      text: editingAccount
        ? t('تم تحديث بيانات الحساب الشخصي بنجاح.', 'Personal account updated successfully.')
        : t('تم إنشاء الحساب الشخصي للمالك بنجاح.', 'Owner personal account created successfully.'),
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
      setTxError(t('يرجى اختيار الحساب الشخصي أولاً.', 'Please select a personal account first.'));
      return;
    }
    const numTxAmt = Number(txAmount || 0);
    if (txAmount === '' || (txType !== 'adjustment' && numTxAmt <= 0)) {
      setTxError(t('يرجى إدخال مبلغ صحيح.', 'Please enter a valid amount.'));
      return;
    }
    if (txType === 'adjustment' && !txReason.trim()) {
      setTxError(t('يجب توضيح سبب التسوية لاعتمادها في سجل التدقيق.', 'Adjustment reason is required for the audit log.'));
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
      setTxError(res.error ? t(res.error) : t('تعذر تسجيل الحركة الشخصية', 'Failed to record personal transaction'));
      return;
    }
    setIsTxModalOpen(false);
    setBanner({
      type: 'success',
      text: t(`تم تسجيل الحركة (${res.transaction?.txNumber}) بنجاح.`, `Transaction (${res.transaction?.txNumber}) recorded successfully.`),
    });
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
      setEditError(t('يرجى إدخال سبب التعديل لإثباته في سجل التدقيق.', 'Edit reason is required for the audit log.'));
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
      setEditError(res.error ? t(res.error) : t('تعذر تعديل الحركة الشخصية', 'Failed to edit personal transaction'));
      return;
    }
    setEditingTx(null);
    setBanner({
      type: 'success',
      text: t(
        `تم تعديل القيد الشخصي (${res.transaction?.txNumber}) وتحديث الرصيد.`,
        `Personal entry (${res.transaction?.txNumber}) updated and balance recalculated.`
      ),
    });
  };

  const getTxTypeLabel = (type: OwnerPersonalTransaction['type']) => {
    const meta = TX_TYPE_LABELS[type];
    return meta ? t(meta.labelAr, meta.labelEn) : t(type);
  };

  const handleExportExcel = () => {
    const headers = [
      t('رقم القيد', 'Entry No.'),
      t('التاريخ', 'Date'),
      t('المالك', 'Owner'),
      t('الحساب', 'Account'),
      t('النوع', 'Type'),
      t('المبلغ', 'Amount'),
      t('الرصيد بعد', 'Balance After'),
      t('الخزينة', 'Cashbox'),
      t('السبب / الملاحظات', 'Reason / Notes'),
      t('بواسطة', 'Created By'),
    ];
    const rows = filteredTransactions.map((tx) => [
      tx.txNumber,
      tx.date,
      tx.ownerName,
      tx.accountName,
      getTxTypeLabel(tx.type),
      tx.amount,
      tx.balanceAfter,
      tx.cashboxName ? t(tx.cashboxName) : t('مستقل (بدون خزينة)', 'Standalone (No Cashbox)'),
      tx.reason || tx.notes || '-',
      tx.createdBy,
    ]);
    exportToExcel(
      `${t('الحسابات_الشخصية_للملاك', 'Owners_Personal_Accounts')}_${new Date().toISOString().split('T')[0]}`,
      headers,
      rows
    );
  };

  const handleExportPdf = () => {
    exportTableToPdf(
      t('كشف الحسابات الشخصية لأصحاب النشاط', 'Owners Personal Accounts Statement'),
      [
        t('رقم القيد', 'Entry No.'),
        t('التاريخ', 'Date'),
        t('المالك / الحساب', 'Owner / Account'),
        t('النوع', 'Type'),
        t('المبلغ', 'Amount'),
        t('الرصيد بعد', 'Balance After'),
        t('ملاحظات', 'Notes'),
      ],
      filteredTransactions.map((tx) => [
        tx.txNumber,
        tx.date,
        `${tx.ownerName} - ${tx.accountName}`,
        getTxTypeLabel(tx.type),
        `${formatLocaleNumber(tx.amount)} ${t(settings.currency)}`,
        `${formatLocaleNumber(tx.balanceAfter)} ${t(settings.currency)}`,
        tx.reason || tx.notes || '-',
      ]),
      {
        companyName: settings.companyName,
        subtitle: t(
          'حسابات خاصة للملاك — معزولة محاسبياً عن المبيعات والمصروفات التشغيلية',
          'Private owner accounts — isolated from business sales and operating expenses'
        ),
        summaryPairs: [
          { label: t('إجمالي أرصدة الملاك', 'Total Owner Balances'), value: `${formatLocaleNumber(totals.totalBalance)} ${t(settings.currency)}`, highlight: true },
          { label: t('إجمالي الإيداعات', 'Total Deposits'), value: `${formatLocaleNumber(totals.totalDeposits)} ${t(settings.currency)}` },
          { label: t('إجمالي المسحوبات والمصروفات', 'Total Withdrawals & Expenses'), value: `${formatLocaleNumber(totals.totalWithdrawals)} ${t(settings.currency)}` },
        ],
      }
    );
  };

  const handlePrintVoucher = (tx: OwnerPersonalTransaction) => {
    setPrintData({
      title: `${t('إيصال حركة شخصية للمالك', 'Owner Personal Transaction Voucher')} (${getTxTypeLabel(tx.type)})`,
      docNumber: tx.txNumber,
      docType: tx.type === 'personal_deposit' ? t('سند قبض', 'Receipt Voucher') : t('سند صرف', 'Payment Voucher'),
      date: tx.date,
      partyName: `${tx.ownerName} — ${tx.accountName}`,
      warehouseName: tx.cashboxName ? t(tx.cashboxName) : t('قيد شخصي مستقل', 'Standalone Personal Entry'),
      grandTotal: Math.abs(tx.amount),
      paidAmount: Math.abs(tx.amount),
      previousBalance: tx.balanceBefore,
      currentBalance: tx.balanceAfter,
      notes: `${tx.reason ? `${t('السبب:', 'Reason:')} ${tx.reason} | ` : ''}${tx.notes || ''}`,
    });
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-1.5">
            <UserCheck className="w-4 h-4 text-blue-900" />
            <span>{t('الحسابات الشخصية لأصحاب النشاط (الملاك)', 'Owners Personal Accounts')}</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            {t(
              'دفتر خاص ومعزول تماماً عن حسابات العملاء والموردين وإيرادات ومصروفات التشغيل والمخزون',
              'Dedicated private ledger isolated from customer/supplier accounts, inventory, and business operations'
            )}
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
            <span>{t('تصدير PDF', 'Export PDF')}</span>
          </button>
          {canCreateTx && (
            <>
              <button
                type="button"
                onClick={openNewAccountModal}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-md text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('حساب مالك جديد', 'New Owner Account')}</span>
              </button>
              <button
                type="button"
                onClick={() => openNewTxModal()}
                disabled={ownerAccounts.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 bg-blue-900 hover:bg-blue-950 text-white rounded-md text-xs font-black disabled:opacity-50 cursor-pointer"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>{t('تسجيل حركة شخصية', 'Record Personal Entry')}</span>
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
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {/* Compact KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden">
        <div className="bg-white px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-slate-500 block">{t('عدد حسابات الملاك', 'Owner Accounts Count')}</span>
          <strong className="text-sm font-black text-blue-950 font-mono tabular-nums">{formatLocaleNumber(ownerAccounts.length)}</strong>
        </div>
        <div className="bg-white px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-slate-500 block">{t('إجمالي الإيداعات والافتتاحي', 'Total Deposits & Opening')}</span>
          <strong className="text-sm font-black text-emerald-700 font-mono tabular-nums">
            {formatLocaleNumber(totals.totalDeposits)} <span className="text-[11px]">{t(settings.currency)}</span>
          </strong>
        </div>
        <div className="bg-white px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-slate-500 block">{t('إجمالي المسحوبات والمصروفات', 'Total Withdrawals & Expenses')}</span>
          <strong className="text-sm font-black text-rose-700 font-mono tabular-nums">
            {formatLocaleNumber(totals.totalWithdrawals)} <span className="text-[11px]">{t(settings.currency)}</span>
          </strong>
        </div>
        <div className="bg-[#011E58] text-white px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-[#DCE6F5] block">{t('صافي أرصدة الملاك الحالية', 'Net Current Owner Balances')}</span>
          <strong className="text-sm font-black font-mono tabular-nums">
            {formatLocaleNumber(totals.totalBalance)} <span className="text-[11px]">{t(settings.currency)}</span>
          </strong>
        </div>
      </div>

      {/* Owner Accounts Table */}
      <UnifiedDataTable<OwnerPersonalAccount>
        title={t('دليل حسابات الملاك الشخصية', 'Owners Personal Accounts Directory')}
        subtitle={t('انقر على أي حساب لتصفية كشف حركاته بالأسفل', 'Click any account to filter its transaction ledger below')}
        data={ownerAccounts}
        rowKey={(acc) => acc.id}
        searchable={false}
        compact
        defaultPageSize={10}
        onRowClick={(acc) => setSelectedAccountId(selectedAccountId === acc.id ? 'all' : acc.id)}
        rowClassName={(acc) => (selectedAccountId === acc.id ? 'bg-blue-50/70' : '')}
        emptyTitle={t('لا توجد حسابات شخصية مضافة لأصحاب النشاط بعد', 'No personal owner accounts added yet')}
        emptySubtitle={t('أنشئ أول حساب مالك لتسجيل الإيداعات والمسحوبات والمصروفات الشخصية بمعزل عن حسابات الشركة.', 'Create an owner account to record personal deposits, withdrawals, and expenses separately.')}
        columns={[
          {
            key: 'ownerName',
            header: t('اسم المالك', 'Owner Name'),
            align: 'right',
            sortValue: (a) => a.ownerName,
            exportValue: (a) => a.ownerName,
            render: (a) => <span className="font-bold text-blue-950">{a.ownerName}</span>,
          },
          {
            key: 'accountName',
            header: t('اسم الحساب الشخصي', 'Account Name'),
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
            header: t('الحالة', 'Status'),
            align: 'center',
            sortValue: (a) => a.status,
            exportValue: (a) => (a.status === 'active' ? t('نشط', 'Active') : t('موقوف', 'Suspended')),
            render: (a) => (
              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${a.status === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                {a.status === 'active' ? t('نشط', 'Active') : t('موقوف', 'Suspended')}
              </span>
            ),
          },
          {
            key: 'currentBalance',
            header: t('الرصيد الحالي', 'Current Balance'),
            align: 'center',
            sortValue: (a) => a.currentBalance,
            exportValue: (a) => a.currentBalance,
            render: (a) => (
              <span className={`font-mono font-black tabular-nums ${a.currentBalance >= 0 ? 'text-blue-950' : 'text-red-700'}`}>
                {formatLocaleNumber(a.currentBalance)} {t(settings.currency)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: t('الإجراءات', 'Actions'),
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
                      {t('+ إيداع', '+ Deposit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => openNewTxModal(acc.id, 'personal_withdrawal')}
                      className="px-2 py-1 rounded bg-rose-50 text-rose-800 border border-rose-200 text-[10px] font-bold hover:bg-rose-100 cursor-pointer"
                    >
                      {t('- سحب', '- Withdraw')}
                    </button>
                  </>
                )}
                {canEditTx && (
                  <button
                    type="button"
                    onClick={() => openEditAccountModal(acc)}
                    className="p-1 text-slate-500 hover:text-blue-900 cursor-pointer"
                    title={t('تعديل بيانات الحساب', 'Edit Account Details')}
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
        title={t('سجل الحركات الشخصية للملاك', 'Owner Personal Transactions Ledger')}
        data={filteredTransactions}
        rowKey={(tx) => tx.id}
        compact
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={t('بحث برقم القيد أو السبب...', 'Search by entry number or reason...')}
        exportFilename="AWLAD_SELIM_Owner_Personal_Accounts"
        pdfTitle={t('كشف الحسابات الشخصية لأصحاب النشاط', 'Business Owners Personal Accounts Statement')}
        emptyTitle={t('لا توجد حركات شخصية مطابقة للبحث', 'No Matching Personal Transactions')}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="h-8 shrink-0 bg-white border border-slate-300 rounded-md px-2 font-bold"
            >
              <option value="all">{t('كل حسابات الملاك', 'All Owner Accounts')}</option>
              {ownerAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.ownerName} - {a.accountName}</option>
              ))}
            </select>
            <select
              value={txTypeFilter}
              onChange={(e) => setTxTypeFilter(e.target.value)}
              className="h-8 shrink-0 bg-white border border-slate-300 rounded-md px-2 font-bold"
            >
              <option value="all">{t('كل أنواع الحركات', 'All Transaction Types')}</option>
              <option value="personal_deposit">{t('إيداع شخصي', 'Personal Deposit')}</option>
              <option value="personal_withdrawal">{t('سحب شخصي', 'Personal Withdrawal')}</option>
              <option value="personal_expense">{t('مصروف شخصي', 'Personal Expense')}</option>
              <option value="adjustment">{t('تسوية', 'Adjustment')}</option>
              <option value="opening_balance">{t('رصيد افتتاحي', 'Opening Balance')}</option>
            </select>
            <label className="inline-flex items-center gap-1 h-8 px-2 bg-white border border-slate-300 rounded-md shrink-0">
              <span className="text-[10.5px] font-bold text-slate-500">{t('من:', 'From:')}</span>
              <input
                type="date"
                aria-label={t('من تاريخ', 'From date')}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-transparent text-xs font-mono font-semibold outline-hidden"
              />
            </label>
            <label className="inline-flex items-center gap-1 h-8 px-2 bg-white border border-slate-300 rounded-md shrink-0">
              <span className="text-[10.5px] font-bold text-slate-500">{t('إلى:', 'To:')}</span>
              <input
                type="date"
                aria-label={t('إلى تاريخ', 'To date')}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-transparent text-xs font-mono font-semibold outline-hidden"
              />
            </label>
          </div>
        }
        columns={[
          {
            key: 'txNumber',
            header: t('رقم الحركة', 'Entry #'),
            align: 'right',
            sortValue: (tx) => tx.txNumber,
            exportValue: (tx) => tx.txNumber,
            render: (tx) => <span className="font-mono font-bold text-blue-900">{tx.txNumber}</span>,
          },
          {
            key: 'date',
            header: t('التاريخ', 'Date'),
            align: 'center',
            sortValue: (tx) => tx.date,
            exportValue: (tx) => tx.date,
            render: (tx) => <span className="font-mono text-slate-600 tabular-nums">{tx.date}</span>,
          },
          {
            key: 'ownerName',
            header: t('المالك / الحساب', 'Owner / Account'),
            align: 'right',
            sortValue: (tx) => `${tx.ownerName} ${tx.accountName}`,
            exportValue: (tx) => `${tx.ownerName} - ${tx.accountName}`,
            render: (tx) => (
              <div>
                <span className="font-bold text-slate-900 block">{tx.ownerName}</span>
                <span className="text-[10px] text-slate-500">{tx.accountName}</span>
              </div>
            ),
          },
          {
            key: 'type',
            header: t('النوع', 'Type'),
            align: 'center',
            sortValue: (tx) => tx.type,
            exportValue: (tx) => {
              const meta = TX_TYPE_LABELS[tx.type];
              return meta ? t(meta.labelAr, meta.labelEn) : tx.type;
            },
            render: (tx) => {
              const meta = TX_TYPE_LABELS[tx.type];
              const label = meta ? t(meta.labelAr, meta.labelEn) : tx.type;
              return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${meta?.color || 'bg-slate-100 text-slate-700'}`}>{label}</span>;
            },
          },
          {
            key: 'amount',
            header: t('المبلغ', 'Amount'),
            align: 'center',
            sortValue: (tx) => tx.amount,
            exportValue: (tx) => tx.amount,
            render: (tx) => (
              <span className="font-mono font-black text-slate-900 tabular-nums">
                {formatLocaleNumber(tx.amount)} {t(settings.currency)}
              </span>
            ),
          },
          {
            key: 'balanceAfter',
            header: t('الرصيد بعد', 'Balance After'),
            align: 'center',
            sortValue: (tx) => tx.balanceAfter,
            exportValue: (tx) => tx.balanceAfter,
            render: (tx) => (
              <span className="font-mono font-bold text-blue-950 tabular-nums">
                {formatLocaleNumber(tx.balanceAfter)}
              </span>
            ),
          },
          {
            key: 'cashboxName',
            header: t('ربط الخزينة', 'Cashbox Link'),
            align: 'right',
            sortValue: (tx) => tx.cashboxName || t('قيد مستقل', 'Standalone Entry'),
            exportValue: (tx) => tx.cashboxName ? t(tx.cashboxName) : t('قيد مستقل', 'Standalone Entry'),
            render: (tx) => <span className="text-[11px] text-slate-600">{tx.cashboxName ? t(tx.cashboxName) : t('قيد مستقل', 'Standalone Entry')}</span>,
          },
          {
            key: 'reason',
            header: t('السبب / الملاحظات', 'Reason / Notes'),
            align: 'right',
            sortValue: (tx) => tx.reason || tx.notes || '',
            exportValue: (tx) => tx.reason || tx.notes || '-',
            render: (tx) => (
              <div className="text-[11px] text-slate-600">
                <div>{tx.reason || tx.notes || '-'}</div>
                {tx.editedBy && <span className="text-[10px] text-amber-700 block">{t(`تم التعديل بواسطة ${tx.editedBy}`, `Edited by ${tx.editedBy}`)}</span>}
              </div>
            ),
          },
          {
            key: 'actions',
            header: t('الإجراءات', 'Actions'),
            align: 'center',
            sortable: false,
            render: (tx) => (
              <div className="flex items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={() => handlePrintVoucher(tx)}
                  className="p-1.5 text-slate-500 hover:text-blue-900 cursor-pointer"
                  title={t('طباعة سند', 'Print Voucher')}
                >
                  <Printer className="w-4 h-4" />
                </button>
                {canEditTx && (
                  <button
                    type="button"
                    onClick={() => openEditTxModal(tx)}
                    className="p-1.5 text-slate-500 hover:text-amber-700 cursor-pointer"
                    title={t('تعديل الحركة مع تسجيل السبب', 'Edit Transaction with Audit Reason')}
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
        title={editingAccount ? t('تعديل حساب مالك شخصي', 'Edit Owner Personal Account') : t('إنشاء حساب شخصي جديد للمالك', 'Create New Owner Personal Account')}
        maxWidth="md"
      >
        <form onSubmit={handleSaveAccount} className="space-y-2 text-xs">
          {accError && (
            <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{accError}</div>
          )}
          <div>
            <label className="block font-bold mb-1">{t('اسم المالك / الشريك:', 'Owner / Partner Name:')}</label>
            <input
              type="text"
              required
              value={accOwnerName}
              onChange={(e) => setAccOwnerName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">{t('اسم الحساب الشخصي:', 'Personal Account Name:')}</label>
            <input
              type="text"
              required
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
            />
          </div>
          {!editingAccount ? (
            <div>
              <label className="block font-bold mb-1">{t(`الرصيد الافتتاحي (${t(settings.currency)}):`, `Opening Balance (${t(settings.currency)}):`)}</label>
              <input
                type="number"
                step="0.01"
                value={accOpening}
                onChange={(e) => setAccOpening(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
              />
            </div>
          ) : (
            <div>
              <label className="block font-bold mb-1">{t('حالة الحساب:', 'Account Status:')}</label>
              <select
                value={accStatus}
                onChange={(e) => setAccStatus(e.target.value as any)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
              >
                <option value="active">{t('نشط', 'Active')}</option>
                <option value="suspended">{t('موقوف', 'Suspended')}</option>
              </select>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">{t('وصف / ملاحظات:', 'Description / Notes:')}</label>
            <textarea
              rows={2}
              value={accDesc}
              onChange={(e) => setAccDesc(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAccountModalOpen(false)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
              {t('إلغاء', 'Cancel')}
            </button>
            <button type="submit" disabled={isSavingAcc} className="px-3 py-1 bg-blue-900 text-white rounded-md font-bold cursor-pointer">
              {isSavingAcc ? t('جاري الحفظ...', 'Saving...') : t('حفظ الحساب', 'Save Account')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Personal Transaction Modal */}
      <Modal
        isOpen={isTxModalOpen}
        onClose={() => setIsTxModalOpen(false)}
        title={t('تسجيل حركة حساب شخصي', 'Record Personal Account Transaction')}
        subtitle={t('هذه العملية معزولة تماماً عن المبيعات والمصروفات التشغيلية للنشاط', 'This operation is completely isolated from business sales and operating expenses')}
        maxWidth="md"
      >
        <form onSubmit={handleSaveTx} className="space-y-2 text-xs">
          {txError && (
            <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{txError}</div>
          )}
          <div>
            <label className="block font-bold mb-1">{t('الحساب الشخصي:', 'Personal Account:')}</label>
            <select
              value={txAccountId}
              onChange={(e) => setTxAccountId(e.target.value)}
              required
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
            >
              {ownerAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ownerName} - {a.accountName} ({formatLocaleNumber(a.currentBalance)} {t(settings.currency)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">{t('نوع الحركة:', 'Transaction Type:')}</label>
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value as any)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
              >
                <option value="personal_deposit">{t('إيداع شخصي (+)', 'Personal Deposit (+)')}</option>
                <option value="personal_withdrawal">{t('سحب شخصي (-)', 'Personal Withdrawal (-)')}</option>
                <option value="personal_expense">{t('مصروف شخصي (-)', 'Personal Expense (-)')}</option>
                {canAdjust && <option value="adjustment">{t('تسوية رصيد (+/-)', 'Balance Adjustment (+/-)')}</option>}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">{t('التاريخ:', 'Date:')}</label>
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
              {txType === 'adjustment'
                ? t('قيمة التسوية (+ زيادة / - خصم):', 'Adjustment Amount (+ Credit / - Debit):')
                : t(`المبلغ (${t(settings.currency)}):`, `Amount (${t(settings.currency)}):`)}
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
              <label className="block font-bold mb-1">{t('ربط بخزينة الشركة (اختياري):', 'Link to Company Cashbox (Optional):')}</label>
              <select
                value={txCashboxId}
                onChange={(e) => setTxCashboxId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
              >
                <option value="">{t('-- بدون ربط بخزينة النشاط (قيد شخصي خارجي مستقل) --', '-- No Cashbox Link (Independent External Personal Entry) --')}</option>
                {cashboxes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.balanceHidden ? `${t(c.name)} (${t('رصيد محجوب', 'Balance Hidden')})` : `${t(c.name)} (${formatLocaleNumber(c.currentBalance ?? 0)} ${t(settings.currency)})`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">
              {t('السبب / البيان', 'Reason / Statement')} {txType === 'adjustment' ? <span className="text-red-600">*</span> : ''}:
            </label>
            <input
              type="text"
              required={txType === 'adjustment'}
              value={txReason}
              onChange={(e) => setTxReason(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">{t('ملاحظات إضافية:', 'Additional Notes:')}</label>
            <textarea
              rows={2}
              value={txNotes}
              onChange={(e) => setTxNotes(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsTxModalOpen(false)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
              {t('إلغاء', 'Cancel')}
            </button>
            <button type="submit" disabled={isSavingTx} className="px-3 py-1 bg-blue-900 text-white rounded-md font-black cursor-pointer">
              {isSavingTx ? t('جاري التسجيل...', 'Recording...') : t('حفظ القيد الشخصي', 'Save Personal Entry')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Personal Transaction Modal */}
      {editingTx && (
        <Modal
          isOpen={!!editingTx}
          onClose={() => setEditingTx(null)}
          title={t(`تعديل الحركة الشخصية (${editingTx.txNumber})`, `Edit Personal Transaction (${editingTx.txNumber})`)}
          maxWidth="md"
        >
          <form onSubmit={handleSaveEditTx} className="space-y-2 text-xs">
            {editError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{editError}</div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold mb-1">{t('المبلغ:', 'Amount:')}</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editAmount || ''}
                  onChange={(e) => setEditAmount(e.target.value === '' ? 0 : Number(e.target.value))}
                  className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{t('التاريخ:', 'Date:')}</label>
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
              <label className="block font-bold mb-1">
                {t('سبب التعديل (إلزامي للتدقيق):', 'Edit Reason (Required for Audit):')} <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                className="w-full h-8 border border-amber-300 rounded-md px-2 py-1 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">{t('ملاحظات:', 'Notes:')}</label>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setEditingTx(null)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
                {t('إلغاء', 'Cancel')}
              </button>
              <button type="submit" disabled={isSavingEdit} className="px-3 py-1 bg-amber-600 text-white rounded-md font-black cursor-pointer">
                {isSavingEdit ? t('جاري التعديل...', 'Updating...') : t('حفظ التعديل وتحديث الرصيد', 'Save Edit & Update Balance')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <PrintDocumentModal isOpen={!!printData} onClose={() => setPrintData(null)} data={printData} />
    </div>
  );
};

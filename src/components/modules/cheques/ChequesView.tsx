import React, { useState, useEffect } from 'react';
import { 
  CreditCard, Plus, Search, CheckCircle2, Clock, AlertCircle, 
  XCircle, RotateCcw, Calendar, Check 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { Cheque, InstallmentSchedule } from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

interface ChequesViewProps {
  initialTab?: 'cheques' | 'installments';
}

export const ChequesView: React.FC<ChequesViewProps> = ({ initialTab }) => {
  const { cheques, installments, cashboxes, settings, addCheque, updateChequeStatus, payInstallment } = useData();
  const { t } = usePreferences();

  const [activeTab, setActiveTab] = useState<'cheques' | 'installments'>(initialTab || 'cheques');
  const [searchTerm, setSearchTerm] = useState('');
  const [chequeTypeFilter, setChequeTypeFilter] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const [chequeStatusFilter, setChequeStatusFilter] = useState<'all' | 'pending' | 'collected' | 'rejected'>('all');
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add Cheque Modal
  const [isAddChequeOpen, setIsAddChequeOpen] = useState(false);
  const [chequeNum, setChequeNum] = useState('');
  const [chequeType, setChequeType] = useState<'incoming' | 'outgoing'>('incoming');
  const [bankName, setBankName] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [partyName, setPartyName] = useState('');
  const [notes, setNotes] = useState('');
  const [chequeError, setChequeError] = useState<string | null>(null);
  const [isSavingCheque, setIsSavingCheque] = useState(false);

  // Collect Cheque Modal
  const [collectingCheque, setCollectingCheque] = useState<Cheque | null>(null);
  const [collectCashboxId, setCollectCashboxId] = useState(cashboxes[0]?.id || '');
  const [collectError, setCollectError] = useState<string | null>(null);
  const [isCollectingCheque, setIsCollectingCheque] = useState(false);

  // Reject Cheque Confirmation
  const [rejectingCheque, setRejectingCheque] = useState<Cheque | null>(null);
  const [isRejectingCheque, setIsRejectingCheque] = useState(false);

  // Pay Installment Modal
  const [payingSchedule, setPayingSchedule] = useState<{ schedule: InstallmentSchedule; itemId: string; amount: number } | null>(null);
  const [installmentCashboxId, setInstallmentCashboxId] = useState(cashboxes[0]?.id || '');
  const [installmentError, setInstallmentError] = useState<string | null>(null);
  const [isPayingInstallment, setIsPayingInstallment] = useState(false);

  // Read-only Detail Modals
  const [previewCheque, setPreviewCheque] = useState<Cheque | null>(null);
  const [previewInstallment, setPreviewInstallment] = useState<InstallmentSchedule | null>(null);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (cashboxes.length === 0) return;
    if (!collectCashboxId || !cashboxes.some(c => c.id === collectCashboxId)) {
      setCollectCashboxId(cashboxes[0].id);
    }
    if (!installmentCashboxId || !cashboxes.some(c => c.id === installmentCashboxId)) {
      setInstallmentCashboxId(cashboxes[0].id);
    }
  }, [cashboxes, collectCashboxId, installmentCashboxId]);

  const handleAddChequeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingCheque) return;
    setChequeError(null);
    const numAmt = Number(amount || 0);
    if (!chequeNum.trim() || numAmt <= 0) {
      setChequeError(t('يرجى إدخال رقم الشيك ومبلغ أكبر من صفر.', 'Please enter a cheque number and an amount greater than zero.'));
      return;
    }

    setIsSavingCheque(true);
    try {
      await addCheque({
        chequeNumber: chequeNum.trim(),
        type: chequeType,
        bankName: bankName.trim(),
        amount: numAmt,
        issueDate: new Date().toISOString().split('T')[0],
        dueDate,
        partyName: partyName.trim(),
        status: 'pending',
        notes: notes.trim(),
      });

      setStatusBanner({
        type: 'success',
        text: t(`تم تسجيل الشيك رقم (${chequeNum.trim()}) بنجاح.`, `Cheque No. (${chequeNum.trim()}) recorded successfully.`),
      });
      setIsAddChequeOpen(false);
      setChequeNum('');
      setBankName('');
      setAmount('');
      setPartyName('');
      setNotes('');
    } catch (err: any) {
      setChequeError(err?.message ? t(err.message) : t('تعذر حفظ الشيك', 'Failed to save cheque'));
    } finally {
      setIsSavingCheque(false);
    }
  };

  const handleConfirmCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCollectingCheque) return;
    setCollectError(null);
    if (!collectingCheque) return;
    if (!collectCashboxId) {
      setCollectError(t('يرجى اختيار الخزينة أو الحساب البنكي.', 'Please select a cashbox or bank account.'));
      return;
    }
    setIsCollectingCheque(true);
    try {
      await updateChequeStatus(collectingCheque.id, 'collected', collectCashboxId, 'تم تحصيل الشيك وإيداعه بنجاح');
      setStatusBanner({
        type: 'success',
        text: t(`تم تحصيل الشيك رقم (${collectingCheque.chequeNumber}) بنجاح.`, `Cheque No. (${collectingCheque.chequeNumber}) collected successfully.`),
      });
      setCollectingCheque(null);
    } catch (err: any) {
      setCollectError(err?.message ? t(err.message) : t('تعذر تحصيل الشيك', 'Failed to collect cheque'));
    } finally {
      setIsCollectingCheque(false);
    }
  };

  const handleConfirmRejectCheque = async (reason?: string) => {
    if (!rejectingCheque) return;
    setIsRejectingCheque(true);
    try {
      await updateChequeStatus(rejectingCheque.id, 'rejected', undefined, reason || 'شيك مرتد / مرفوض');
      setStatusBanner({
        type: 'success',
        text: t(`تم تسجيل رفض/ارتداد الشيك رقم (${rejectingCheque.chequeNumber}).`, `Cheque No. (${rejectingCheque.chequeNumber}) marked as rejected/bounced.`),
      });
      setRejectingCheque(null);
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err?.message ? t(err.message) : t('تعذر تحديث حالة الشيك', 'Failed to update cheque status') });
      setRejectingCheque(null);
    } finally {
      setIsRejectingCheque(false);
    }
  };

  const handlePayInstallmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPayingInstallment) return;
    setInstallmentError(null);
    if (!payingSchedule) return;
    if (!installmentCashboxId) {
      setInstallmentError(t('يرجى اختيار الخزينة المودع بها.', 'Please select the deposit cashbox.'));
      return;
    }
    setIsPayingInstallment(true);
    try {
      await payInstallment(payingSchedule.schedule.id, payingSchedule.itemId, payingSchedule.amount, installmentCashboxId);
      setStatusBanner({
        type: 'success',
        text: t(
          `تم تسجيل سداد القسط بمبلغ ${formatLocaleNumber(payingSchedule.amount)} ${t(settings.currency)}.`,
          `Installment payment of ${formatLocaleNumber(payingSchedule.amount)} ${t(settings.currency)} recorded.`
        ),
      });
      setPayingSchedule(null);
    } catch (err: any) {
      setInstallmentError(err?.message ? t(err.message) : t('تعذر سداد القسط', 'Failed to pay installment'));
    } finally {
      setIsPayingInstallment(false);
    }
  };

  const filteredCheques = cheques.filter((c) => {
    const q = searchTerm.toLowerCase();
    const matchSearch =
      !q ||
      c.chequeNumber.toLowerCase().includes(q) ||
      c.bankName.toLowerCase().includes(q) ||
      c.partyName.toLowerCase().includes(q);
    const matchType = chequeTypeFilter === 'all' ? true : c.type === chequeTypeFilter;
    const matchStatus = chequeStatusFilter === 'all' ? true : c.status === chequeStatusFilter;
    return matchSearch && matchType && matchStatus;
  });

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight">{t('إدارة الشيكات والأقساط المالية', 'Cheques & Installments Management')}</h2>
          <p className="text-[11px] text-slate-500">
            {t('متابعة استحقاق الشيكات البنكية، تواريخ التحصيل، وجداول أقساط العملاء', 'Track bank cheque maturities, collection dates, and customer installment schedules')}
          </p>
        </div>

        {activeTab === 'cheques' && (
          <button
            onClick={() => {
              setChequeError(null);
              setIsAddChequeOpen(true);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-900 hover:bg-blue-950 text-white text-xs font-black cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('إضافة شيك بنكي', 'Add Bank Cheque')}</span>
          </button>
        )}
      </div>

      {statusBanner && (
        <div
          className={`px-2.5 py-1.5 rounded-md border text-xs font-bold flex items-center justify-between gap-2 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-1.5">
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

      {/* Tabs */}
      <div className="flex border-b border-slate-200 text-xs font-bold gap-3">
        <button
          onClick={() => setActiveTab('cheques')}
          className={`pb-1.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'cheques' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {t('الشيكات البنكية', 'Bank Cheques')} ({formatLocaleNumber(cheques.length)})
        </button>
        <button
          onClick={() => setActiveTab('installments')}
          className={`pb-1.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'installments' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {t('جداول متابعة الأقساط', 'Installment Schedules')} ({formatLocaleNumber(installments.length)})
        </button>
      </div>

      {/* Cheques Tab */}
      {activeTab === 'cheques' && (
        <UnifiedDataTable<Cheque>
          title={`${t('سجل الشيكات البنكية', 'Bank Cheques Register')} (${formatLocaleNumber(filteredCheques.length)})`}
          data={filteredCheques}
          rowKey={(chq) => chq.id}
          onRowClick={(chq) => setPreviewCheque(chq)}
          compact
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder={t('بحث برقم الشيك أو البنك أو الطرف...', 'Search by cheque #, bank, or party...')}
          exportFilename={t('سجل-الشيكات-البنكية', 'bank-cheques-register')}
          pdfTitle={t('سجل الشيكات البنكية', 'Bank Cheques Register')}
          toolbarFilters={
            <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
              <select
                aria-label={t('نوع الشيك', 'Cheque Type')}
                value={chequeTypeFilter}
                onChange={(e) => setChequeTypeFilter(e.target.value as any)}
                className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC]"
              >
                <option value="all">{t('كل الأنواع', 'All Types')}</option>
                <option value="incoming">{t('شيك وارد (لنا)', 'Incoming Cheque (Receivable)')}</option>
                <option value="outgoing">{t('شيك صادر (علينا)', 'Outgoing Cheque (Payable)')}</option>
              </select>
              <select
                aria-label={t('حالة الشيك', 'Cheque Status')}
                value={chequeStatusFilter}
                onChange={(e) => setChequeStatusFilter(e.target.value as any)}
                className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC]"
              >
                <option value="all">{t('كل الحالات', 'All Statuses')}</option>
                <option value="pending">{t('قيد التحصيل', 'Pending Collection')}</option>
                <option value="collected">{t('محصل / مدفوع', 'Collected / Paid')}</option>
                <option value="rejected">{t('مرفوض / مرتد', 'Rejected / Bounced')}</option>
              </select>
            </div>
          }
          columns={[
            {
              key: 'chequeNumber',
              header: t('رقم الشيك', 'Cheque No.'),
              align: 'right',
              sortValue: (c) => c.chequeNumber,
              exportValue: (c) => c.chequeNumber,
              render: (c) => <span className="font-mono font-bold text-blue-900">{c.chequeNumber}</span>,
            },
            {
              key: 'type',
              header: t('النوع', 'Type'),
              align: 'center',
              sortValue: (c) => c.type,
              exportValue: (c) => (c.type === 'incoming' ? t('شيك وارد (لنا)', 'Incoming (Receivable)') : t('شيك صادر (علينا)', 'Outgoing (Payable)')),
              render: (c) =>
                c.type === 'incoming' ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[10px]">{t('شيك وارد (لنا)', 'Incoming (Receivable)')}</span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 font-bold text-[10px]">{t('شيك صادر (علينا)', 'Outgoing (Payable)')}</span>
                ),
            },
            {
              key: 'bankName',
              header: t('البنك المسحوب عليه', 'Drawee Bank'),
              align: 'right',
              sortValue: (c) => c.bankName,
              exportValue: (c) => c.bankName,
              render: (c) => <span className="font-semibold">{c.bankName}</span>,
            },
            {
              key: 'partyName',
              header: t('الطرف (الساحب / المستفيد)', 'Party (Drawer / Payee)'),
              align: 'right',
              sortValue: (c) => c.partyName,
              exportValue: (c) => c.partyName,
              render: (c) => <span className="font-bold text-slate-800">{c.partyName}</span>,
            },
            {
              key: 'dueDate',
              header: t('تاريخ الاستحقاق', 'Due Date'),
              align: 'center',
              sortValue: (c) => c.dueDate,
              exportValue: (c) => c.dueDate,
              render: (c) => <span className="font-mono text-slate-600 tabular-nums">{c.dueDate}</span>,
            },
            {
              key: 'amount',
              header: t('المبلغ', 'Amount'),
              align: 'center',
              sortValue: (c) => c.amount,
              exportValue: (c) => c.amount,
              render: (c) => (
                <span className="font-mono font-black text-blue-950 tabular-nums">
                  {formatLocaleNumber(c.amount)} {t(settings.currency)}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              sortValue: (c) => c.status,
              exportValue: (c) =>
                c.status === 'collected'
                  ? t('تم التحصيل', 'Collected')
                  : c.status === 'pending'
                  ? t('برسم التحصيل', 'Pending')
                  : c.status === 'rejected'
                  ? t('مرفوض', 'Rejected')
                  : t('جديد', 'New'),
              render: (c) =>
                c.status === 'collected' ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">{t('تم التحصيل', 'Collected')}</span>
                ) : c.status === 'pending' ? (
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">{t('برسم التحصيل', 'Pending')}</span>
                ) : c.status === 'rejected' ? (
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[10px]">{t('مرفوض', 'Rejected')}</span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-bold text-[10px]">{t('جديد', 'New')}</span>
                ),
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
              align: 'center',
              sortable: false,
              render: (chq) =>
                chq.status !== 'collected' && chq.status !== 'rejected' ? (
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => {
                        setCollectError(null);
                        setCollectingCheque(chq);
                      }}
                      className="px-2 py-0.5 bg-blue-900 hover:bg-blue-950 text-white rounded-md font-bold text-[11px] cursor-pointer"
                    >
                      {t('تحصيل', 'Collect')}
                    </button>
                    <button
                      onClick={() => setRejectingCheque(chq)}
                      className="px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-md font-bold text-[11px] cursor-pointer"
                    >
                      {t('رفض / ارتداد', 'Reject / Bounce')}
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-400">—</span>
                ),
            },
          ]}
        />
      )}

      {/* Installments Tab */}
      {activeTab === 'installments' && (
        <UnifiedDataTable<InstallmentSchedule & { flatItems?: any }>
          title={t('جداول متابعة الأقساط', 'Installment Schedules')}
          data={installments}
          rowKey={(sch) => sch.id}
          onRowClick={(sch) => setPreviewInstallment(sch)}
          compact
          exportFilename={t('جداول-الأقساط', 'installment-schedules')}
          pdfTitle={t('جداول متابعة الأقساط', 'Installment Schedules')}
          columns={[
            {
              key: 'scheduleNumber',
              header: t('رقم الجدولة', 'Schedule No.'),
              align: 'center',
              sortValue: (s) => s.scheduleNumber,
              exportValue: (s) => s.scheduleNumber,
              render: (s) => <span className="font-mono font-bold text-blue-900">{s.scheduleNumber}</span>,
            },
            {
              key: 'customerName',
              header: t('العميل', 'Customer'),
              align: 'right',
              sortValue: (s) => s.customerName,
              exportValue: (s) => s.customerName,
              render: (s) => <span className="font-bold text-slate-900">{s.customerName}</span>,
            },
            {
              key: 'totalAmount',
              header: t('إجمالي الأقساط', 'Total Installments'),
              align: 'center',
              sortValue: (s) => s.totalAmount,
              exportValue: (s) => s.totalAmount,
              render: (s) => <span className="font-mono font-bold tabular-nums">{formatLocaleNumber(s.totalAmount)} {t(settings.currency)}</span>,
            },
            {
              key: 'paidAmount',
              header: t('المسدد', 'Paid'),
              align: 'center',
              sortValue: (s) => s.paidAmount,
              exportValue: (s) => s.paidAmount,
              render: (s) => <span className="font-mono font-bold text-emerald-700 tabular-nums">{formatLocaleNumber(s.paidAmount)}</span>,
            },
            {
              key: 'remainingAmount',
              header: t('المتبقي', 'Remaining'),
              align: 'center',
              sortValue: (s) => s.remainingAmount,
              exportValue: (s) => s.remainingAmount,
              render: (s) => <span className="font-mono font-bold text-red-700 tabular-nums">{formatLocaleNumber(s.remainingAmount)} {t(settings.currency)}</span>,
            },
            {
              key: 'nextDue',
              header: t('الأقساط المستحقة', 'Due Installments'),
              align: 'right',
              sortable: false,
              render: (sch) => (
                <div className="space-y-1">
                  {sch.items.map((it) => {
                    const isOverdue = it.status === 'pending' && new Date(it.dueDate) < new Date();
                    return (
                      <div key={it.id} className="flex items-center justify-between gap-2 text-[11px] py-0.5 border-b border-slate-100 last:border-b-0">
                        <span className="font-bold">{t('قسط', 'Installment')} {it.installmentNumber} ({it.dueDate})</span>
                        <span className="font-mono tabular-nums">{formatLocaleNumber(it.amount)}</span>
                        {it.status === 'paid' ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">{t('مسدد', 'Paid')}</span>
                        ) : (
                          <button
                            onClick={() => {
                              setInstallmentError(null);
                              setPayingSchedule({ schedule: sch, itemId: it.id, amount: it.amount - it.paidAmount });
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold text-white cursor-pointer ${isOverdue ? 'bg-red-600' : 'bg-blue-900'}`}
                          >
                            {isOverdue ? t('متأخر · سداد', 'Overdue · Pay') : t('تسجيل سداد', 'Record Payment')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Add Cheque Modal */}
      <Modal
        isOpen={isAddChequeOpen}
        onClose={() => setIsAddChequeOpen(false)}
        title={t('إضافة شيك بنكي جديد', 'Add New Bank Cheque')}
        maxWidth="md"
      >
        <form onSubmit={handleAddChequeSubmit} className="space-y-2 text-xs">
          {chequeError && (
            <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{chequeError}</span>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">{t('نوع الشيك:', 'Cheque Type:')}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChequeType('incoming')}
                className={`h-8 px-2 border rounded-md font-bold cursor-pointer ${chequeType === 'incoming' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                {t('شيك وارد (من عميل)', 'Incoming Cheque (Customer)')}
              </button>
              <button
                type="button"
                onClick={() => setChequeType('outgoing')}
                className={`h-8 px-2 border rounded-md font-bold cursor-pointer ${chequeType === 'outgoing' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                {t('شيك صادر (لمورد)', 'Outgoing Cheque (Supplier)')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">{t('رقم الشيك:', 'Cheque No.:')}</label>
              <input
                type="text"
                required
                value={chequeNum}
                onChange={(e) => setChequeNum(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
              />
            </div>

            <div>
              <label className="block font-bold mb-1">{t('البنك:', 'Bank:')}</label>
              <input
                type="text"
                required
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">{t('الطرف (العميل أو المورد):', 'Party (Customer or Supplier):')}</label>
            <input
              type="text"
              required
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">{t('المبلغ', 'Amount')} ({t(settings.currency)}):</label>
              <input
                type="number"
                min="1"
                required
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-black text-center"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">{t('تاريخ الاستحقاق:', 'Due Date:')}</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAddChequeOpen(false)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
              {t('إلغاء', 'Cancel')}
            </button>
            <button type="submit" disabled={isSavingCheque} className="px-3 py-1 bg-blue-900 text-white rounded-md font-bold cursor-pointer disabled:opacity-50">
              {isSavingCheque ? t('جاري الحفظ...', 'Saving...') : t('حفظ الشيك', 'Save Cheque')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Collect Cheque Modal */}
      {collectingCheque && (
        <Modal
          isOpen={!!collectingCheque}
          onClose={() => setCollectingCheque(null)}
          title={t(`تحصيل الشيك رقم ${collectingCheque.chequeNumber}`, `Collect Cheque #${collectingCheque.chequeNumber}`)}
          maxWidth="md"
        >
          <form onSubmit={handleConfirmCollect} className="space-y-2 text-xs">
            {collectError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{collectError}</span>
              </div>
            )}
            <div className="p-2 bg-slate-50 rounded-md border border-slate-200 space-y-1">
              <p>{t('البنك:', 'Bank:')} <strong>{collectingCheque.bankName}</strong></p>
              <p>{t('المبلغ:', 'Amount:')} <strong className="font-mono text-emerald-800">{formatLocaleNumber(collectingCheque.amount)} {t(settings.currency)}</strong></p>
            </div>

            <div>
              <label className="block font-bold mb-1">{t('الخزينة أو الحساب البنكي المودع به:', 'Deposit Cashbox or Bank Account:')}</label>
              <select
                value={collectCashboxId}
                onChange={(e) => setCollectCashboxId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>{t(cb.name)}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setCollectingCheque(null)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
                {t('إلغاء', 'Cancel')}
              </button>
              <button type="submit" disabled={isCollectingCheque} className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50">
                {isCollectingCheque ? t('جاري التحصيل...', 'Collecting...') : t('تأكيد التحصيل', 'Confirm Collection')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Pay Installment Modal */}
      {payingSchedule && (
        <Modal
          isOpen={!!payingSchedule}
          onClose={() => setPayingSchedule(null)}
          title={t('سداد قسط العميل', 'Pay Customer Installment')}
          maxWidth="md"
        >
          <form onSubmit={handlePayInstallmentSubmit} className="space-y-2 text-xs">
            {installmentError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{installmentError}</span>
              </div>
            )}
            <div>
              <label className="block font-bold mb-1">{t('المبلغ المسدد', 'Paid Amount')} ({t(settings.currency)}):</label>
              <input
                type="number"
                min="1"
                required
                value={payingSchedule.amount}
                onChange={(e) => setPayingSchedule({ ...payingSchedule, amount: Number(e.target.value) })}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-mono font-black text-center text-emerald-800"
              />
            </div>

            <div>
              <label className="block font-bold mb-1">{t('الخزينة المودع بها:', 'Deposit Cashbox:')}</label>
              <select
                value={installmentCashboxId}
                onChange={(e) => setInstallmentCashboxId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 py-1 font-bold bg-white"
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>{t(cb.name)}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setPayingSchedule(null)} className="px-2.5 py-1 border border-slate-300 rounded-md font-bold cursor-pointer">
                {t('إلغاء', 'Cancel')}
              </button>
              <button type="submit" disabled={isPayingInstallment} className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50">
                {isPayingInstallment ? t('جاري التسديد...', 'Processing...') : t('تأكيد سداد القسط', 'Confirm Installment Payment')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={!!rejectingCheque}
        onClose={() => !isRejectingCheque && setRejectingCheque(null)}
        onConfirm={handleConfirmRejectCheque}
        variant="danger"
        requireInput
        inputLabel={t('سبب رفض / ارتداد الشيك:', 'Rejection / Bounce Reason:')}
        inputPlaceholder={t('مثال: عدم كفاية الرصيد أو خطأ في التوقيع...', 'e.g., Insufficient funds or signature mismatch...')}
        isLoading={isRejectingCheque}
        title={t('تأكيد رفض الشيك البنكي', 'Confirm Cheque Rejection')}
        message={
          rejectingCheque
            ? t(
                `تسجيل ارتداد الشيك رقم (${rejectingCheque.chequeNumber}) الخاص بـ (${rejectingCheque.partyName}).`,
                `Record bounced/rejected status for Cheque #${rejectingCheque.chequeNumber} (${rejectingCheque.partyName}).`
              )
            : ''
        }
        confirmLabel={t('تأكيد الرفض', 'Confirm Rejection')}
      />

      {/* Preview Cheque Detail Modal */}
      <Modal
        isOpen={!!previewCheque}
        onClose={() => setPreviewCheque(null)}
        title={previewCheque ? t(`تفاصيل الشيك رقم ${previewCheque.chequeNumber}`, `Cheque Details #${previewCheque.chequeNumber}`) : t('تفاصيل الشيك', 'Cheque Details')}
        maxWidth="md"
      >
        {previewCheque && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('رقم الشيك', 'Cheque No.')}</span>
                <strong className="font-mono text-slate-900 dark:text-[#F3F7FC]">{previewCheque.chequeNumber}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('النوع', 'Type')}</span>
                <strong className="text-slate-900 dark:text-[#F3F7FC]">
                  {previewCheque.type === 'incoming' ? t('شيك وارد (لنا)', 'Incoming Cheque (Receivable)') : t('شيك صادر (علينا)', 'Outgoing Cheque (Payable)')}
                </strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('البنك المسحوب عليه', 'Drawee Bank')}</span>
                <strong className="text-slate-900 dark:text-[#F3F7FC]">{previewCheque.bankName}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الطرف', 'Party')}</span>
                <strong className="text-slate-900 dark:text-[#F3F7FC]">{previewCheque.partyName}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('تاريخ الاستحقاق', 'Due Date')}</span>
                <strong className="font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">{previewCheque.dueDate}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المبلغ', 'Amount')}</span>
                <strong className="font-mono tabular-nums text-blue-950 dark:text-[#85B8FF]">
                  {formatLocaleNumber(previewCheque.amount)} {t(settings.currency)}
                </strong>
              </div>
            </div>
            {previewCheque.notes && (
              <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
                <span className="font-bold text-slate-600 dark:text-[#97AECE]">{t('ملاحظات:', 'Notes:')} </span>
                <span className="text-slate-900 dark:text-[#EEF4FC]">{t(previewCheque.notes)}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#21375C]">
              {previewCheque.status !== 'collected' && previewCheque.status !== 'rejected' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const target = previewCheque;
                      setPreviewCheque(null);
                      setCollectError(null);
                      setCollectingCheque(target);
                    }}
                    className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                  >
                    {t('تحصيل الشيك', 'Collect Cheque')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = previewCheque;
                      setPreviewCheque(null);
                      setRejectingCheque(target);
                    }}
                    className="h-8 px-3 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold cursor-pointer"
                  >
                    {t('رفض / ارتداد', 'Reject / Bounce')}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setPreviewCheque(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Preview Installment Schedule Detail Modal */}
      <Modal
        isOpen={!!previewInstallment}
        onClose={() => setPreviewInstallment(null)}
        title={previewInstallment ? t(`تفاصيل جدولة الأقساط (${previewInstallment.scheduleNumber})`, `Installment Schedule Details (${previewInstallment.scheduleNumber})`) : t('تفاصيل الأقساط', 'Installment Details')}
        subtitle={previewInstallment?.customerName}
        maxWidth="lg"
      >
        {previewInstallment && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الإجمالي', 'Total')}</span>
                <strong className="font-mono tabular-nums">{formatLocaleNumber(previewInstallment.totalAmount)} {t(settings.currency)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المسدد', 'Paid')}</span>
                <strong className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">{formatLocaleNumber(previewInstallment.paidAmount)} {t(settings.currency)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المتبقي', 'Remaining')}</span>
                <strong className="font-mono tabular-nums text-red-700 dark:text-red-400">{formatLocaleNumber(previewInstallment.remainingAmount)} {t(settings.currency)}</strong>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#172E56] font-bold border-b border-slate-200 dark:border-[#2A436E]">
                    <th className="p-2">{t('القسط', 'Installment')}</th>
                    <th className="p-2 text-center">{t('تاريخ الاستحقاق', 'Due Date')}</th>
                    <th className="p-2 text-center">{t('المبلغ', 'Amount')}</th>
                    <th className="p-2 text-center">{t('المسدد', 'Paid')}</th>
                    <th className="p-2 text-center">{t('الحالة', 'Status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                  {previewInstallment.items.map((it) => (
                    <tr key={it.id}>
                      <td className="p-2 font-bold">{t('قسط', 'Installment')} {it.installmentNumber}</td>
                      <td className="p-2 text-center font-mono tabular-nums">{it.dueDate}</td>
                      <td className="p-2 text-center font-mono tabular-nums font-bold">{formatLocaleNumber(it.amount)}</td>
                      <td className="p-2 text-center font-mono tabular-nums">{formatLocaleNumber(it.paidAmount)}</td>
                      <td className="p-2 text-center">
                        {it.status === 'paid' ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">{t('مسدد', 'Paid')}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const sch = previewInstallment;
                              setPreviewInstallment(null);
                              setInstallmentError(null);
                              setPayingSchedule({ schedule: sch, itemId: it.id, amount: it.amount - it.paidAmount });
                            }}
                            className="px-2 py-0.5 rounded bg-[#003589] text-white font-bold text-[10px] cursor-pointer"
                          >
                            {t('تسجيل سداد', 'Record Payment')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-[#21375C]">
              <button
                type="button"
                onClick={() => setPreviewInstallment(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

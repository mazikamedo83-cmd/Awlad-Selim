import React, { useState, useEffect } from 'react';
import { Wallet, ArrowLeftRight, TrendingDown, TrendingUp, AlertCircle, CheckCircle2, Printer } from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { CashOperationType, FinancialTransaction } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';

interface CashOperationModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: CashOperationType;
  onCompleted?: (tx?: FinancialTransaction) => void;
}

const OP_LABELS: Record<
  CashOperationType,
  { titleAr: string; titleEn: string; badgeAr: string; badgeEn: string; btnClass: string; defaultCategory: string }
> = {
  cash_withdrawal: {
    titleAr: 'سحب نقدي من الخزينة',
    titleEn: 'Cash Withdrawal from Cashbox',
    badgeAr: 'سحب نقدي',
    badgeEn: 'Withdrawal',
    btnClass: 'bg-rose-700 hover:bg-rose-800',
    defaultCategory: 'سحب نقدي',
  },
  cash_deposit: {
    titleAr: 'إيداع نقدي بالخزينة',
    titleEn: 'Cash Deposit to Cashbox',
    badgeAr: 'إيداع نقدي',
    badgeEn: 'Deposit',
    btnClass: 'bg-[#003589] hover:bg-[#0049B0]',
    defaultCategory: 'إيداع نقدي',
  },
  cashbox_transfer: {
    titleAr: 'ترحيل / تحويل بين الخزائن',
    titleEn: 'Transfer Between Cashboxes',
    badgeAr: 'ترحيل نقدي',
    badgeEn: 'Transfer',
    btnClass: 'bg-[#011E58] hover:bg-[#002160]',
    defaultCategory: 'ترحيل بين الخزائن',
  },
  expense: {
    titleAr: 'تسجيل مصروف تشغيل',
    titleEn: 'Record Operating Expense',
    badgeAr: 'مصروفات',
    badgeEn: 'Expense',
    btnClass: 'bg-amber-700 hover:bg-amber-800',
    defaultCategory: 'مصروفات تشغيل',
  },
  profit_deposit: {
    titleAr: 'إيداع ربحي / إيراد خزينة',
    titleEn: 'Profit / Revenue Deposit',
    badgeAr: 'إيداع ربحي',
    badgeEn: 'Profit Deposit',
    btnClass: 'bg-[#003589] hover:bg-[#0049B0]',
    defaultCategory: 'إيداع ربحي',
  },
};

export const CashOperationModal: React.FC<CashOperationModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'cash_deposit',
  onCompleted,
}) => {
  const { cashboxes, settings, executeCashOperation } = useData();
  const { t } = usePreferences();
  const [opType, setOpType] = useState<CashOperationType>(initialMode);
  const [cashboxId, setCashboxId] = useState<string>('');
  const [targetCashboxId, setTargetCashboxId] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState<string>('');
  const [recipientOrPayer, setRecipientOrPayer] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [printAfterSave, setPrintAfterSave] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [printData, setPrintData] = useState<PrintData | null>(null);

  useEffect(() => {
    if (isOpen) {
      setOpType(initialMode);
      setCategory('');
      setCashboxId(cashboxes[0]?.id || '');
      setTargetCashboxId(cashboxes[1]?.id || cashboxes[0]?.id || '');
      setAmount(0);
      setDate(new Date().toISOString().split('T')[0]);
      setRecipientOrPayer('');
      setNotes('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen || cashboxes.length === 0) return;
    if (!cashboxId || !cashboxes.some((c) => c.id === cashboxId)) {
      setCashboxId(cashboxes[0].id);
    }
    if (!targetCashboxId || !cashboxes.some((c) => c.id === targetCashboxId)) {
      setTargetCashboxId(cashboxes[1]?.id || cashboxes[0].id);
    }
  }, [isOpen, cashboxes, cashboxId, targetCashboxId]);

  const handleModeChange = (nextMode: CashOperationType) => {
    setOpType(nextMode);
    setError(null);
  };

  const selectedCb = cashboxes.find((c) => c.id === cashboxId);
  const targetCb = cashboxes.find((c) => c.id === targetCashboxId);
  const isOutflow = opType === 'cash_withdrawal' || opType === 'cashbox_transfer' || opType === 'expense';
  const currentBalance = Number(selectedCb?.currentBalance || 0);
  const projectedBalance = isOutflow ? currentBalance - (amount || 0) : currentBalance + (amount || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    if (!cashboxId) {
      setError(t('يرجى تحديد الخزينة', 'Please select a cashbox'));
      return;
    }
    if (opType === 'cashbox_transfer' && (!targetCashboxId || targetCashboxId === cashboxId)) {
      setError(t('يرجى تحديد خزينة وجهة مختلفة للترحيل', 'Please select a different destination cashbox'));
      return;
    }
    if (!amount || amount <= 0) {
      setError(t('يرجى إدخال مبلغ صحيح أكبر من الصفر', 'Please enter a valid amount greater than zero'));
      return;
    }
    if (isOutflow && currentBalance < amount) {
      setError(
        t(
          `الرصيد المتاح (${formatLocaleNumber(currentBalance)}) في ${selectedCb?.name || 'الخزينة'} لا يكفي لهذه العملية.`,
          `Available balance (${formatLocaleNumber(currentBalance)}) in ${selectedCb ? t(selectedCb.name) : 'Cashbox'} is insufficient for this operation.`
        )
      );
      return;
    }

    setIsSubmitting(true);
    let res: { success: boolean; transaction?: any; error?: string };
    try {
      res = await executeCashOperation({
        type: opType,
        cashboxId,
        targetCashboxId: opType === 'cashbox_transfer' ? targetCashboxId : undefined,
        amount,
        date,
        category: category.trim() || OP_LABELS[opType].defaultCategory,
        recipientOrPayer: recipientOrPayer.trim(),
        notes: notes.trim(),
      });
    } finally {
      setIsSubmitting(false);
    }

    if (!res.success) {
      setError(res.error ? t(res.error) : t('تعذر تنفيذ العملية النقدية', 'Failed to execute cash operation'));
      return;
    }

    if (onCompleted) onCompleted(res.transaction);

    if (printAfterSave && res.transaction) {
      const m = OP_LABELS[opType];
      setPrintData({
        title: t(m.titleAr, m.titleEn),
        docNumber: res.transaction.transactionNumber,
        docType: isOutflow ? t('سند صرف', 'Payment Voucher') : t('سند قبض', 'Receipt Voucher'),
        date: res.transaction.date,
        partyName: recipientOrPayer || (selectedCb ? t(selectedCb.name) : ''),
        warehouseName: selectedCb ? t(selectedCb.name) : undefined,
        paymentType: t(m.badgeAr, m.badgeEn),
        grandTotal: amount,
        paidAmount: amount,
        previousBalance: currentBalance,
        currentBalance: projectedBalance,
        notes: `${category}${notes ? ` | ${notes}` : ''}`,
      });
    } else {
      onClose();
    }
  };

  const meta = OP_LABELS[opType];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t(meta.titleAr, meta.titleEn)}
        subtitle={t('تسجيل وتوثيق فوري للعملية النقدية على الخزينة وسجل المراجعة', 'Instant recording and audit logging of cashbox transaction')}
        maxWidth="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-2.5 text-xs">
          {/* Operation Type Switcher */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 bg-slate-100 p-1 rounded-lg">
            {(Object.keys(OP_LABELS) as CashOperationType[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleModeChange(key)}
                className={`py-1.5 px-2 rounded-md font-bold text-[11px] transition-all cursor-pointer ${
                  opType === key
                    ? 'bg-blue-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-white'
                }`}
              >
                {t(OP_LABELS[key].badgeAr, OP_LABELS[key].badgeEn)}
              </button>
            ))}
          </div>

          {error && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">
                {opType === 'cashbox_transfer' ? t('من خزينة / حساب:', 'From Cashbox / Account:') : t('الخزينة / الحساب البنكي:', 'Cashbox / Bank Account:')}
              </label>
              <select
                value={cashboxId}
                onChange={(e) => setCashboxId(e.target.value)}
                required
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 py-1 font-bold"
              >
                {cashboxes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.balanceHidden
                      ? `${t(c.name)} (${t('رصيد محجوب', 'Balance Hidden')})`
                      : `${t(c.name)} (${formatLocaleNumber(c.currentBalance ?? 0)} ${t(settings.currency)})`}
                  </option>
                ))}
              </select>
            </div>

            {opType === 'cashbox_transfer' ? (
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('إلى خزينة / حساب وجهة:', 'To Destination Cashbox / Account:')}</label>
                <select
                  value={targetCashboxId}
                  onChange={(e) => setTargetCashboxId(e.target.value)}
                  required
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 py-1 font-bold"
                >
                  {cashboxes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.balanceHidden
                        ? `${t(c.name)} (${t('رصيد محجوب', 'Balance Hidden')})`
                        : `${t(c.name)} (${formatLocaleNumber(c.currentBalance ?? 0)} ${t(settings.currency)})`}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('تاريخ العملية:', 'Transaction Date:')}</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 py-1 font-mono font-bold"
                />
              </div>
            )}
          </div>

          {/* Live balance preview */}
          {selectedCb && (
            <div className="px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-blue-900" />
                <span className="text-slate-600 font-bold">{t('الرصيد الحالي', 'Current Balance')} ({t(selectedCb.name)}):</span>
                <strong className="font-mono text-slate-900 tabular-nums">
                  {formatLocaleNumber(currentBalance)} {t(settings.currency)}
                </strong>
              </div>
              {amount > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">{t('الرصيد بعد العملية:', 'Balance After:')}</span>
                  <strong className={`font-mono font-black tabular-nums ${projectedBalance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {formatLocaleNumber(projectedBalance)} {t(settings.currency)}
                  </strong>
                  {opType === 'cashbox_transfer' && targetCb && (
                    <span className="text-blue-800 font-mono font-bold tabular-nums">
                      ({t('الوجهة:', 'Destination:')} {targetCb.balanceHidden ? t('محجوب', 'Hidden') : formatLocaleNumber((targetCb.currentBalance ?? 0) + amount)})
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('المبلغ', 'Amount')} ({t(settings.currency)}):</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder="0.00"
                className="w-full h-8 bg-blue-50 border border-blue-300 rounded-md px-2.5 py-1 font-mono font-black text-center text-sm text-blue-950"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-0.5">
                {opType === 'expense'
                  ? t('بند المصروف:', 'Expense Item:')
                  : opType === 'profit_deposit'
                  ? t('تصنيف الربح / الإيراد:', 'Profit / Revenue Category:')
                  : t('التصنيف / البيان:', 'Category / Description:')}
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t(meta.defaultCategory)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 py-1 font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('المستفيد / المودع / المسؤول:', 'Beneficiary / Payer / Responsible:')}</label>
              <input
                type="text"
                value={recipientOrPayer}
                onChange={(e) => setRecipientOrPayer(e.target.value)}
                placeholder={t('اسم الشخص أو الجهة...', 'Person or party name...')}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 py-1 font-bold"
              />
            </div>
            {opType === 'cashbox_transfer' && (
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('تاريخ الترحيل:', 'Transfer Date:')}</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 py-1 font-mono font-bold"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات وتفاصيل:', 'Notes & Details:')}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('أدخل تفاصيل أو سبب العملية للتوثيق في سجل الحركات...', 'Enter details or reason for audit logging...')}
              className="w-full bg-white border border-slate-300 rounded-md p-2"
            />
          </div>

          <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={printAfterSave}
              onChange={(e) => setPrintAfterSave(e.target.checked)}
              className="w-4 h-4 rounded text-blue-900"
            />
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span className="font-bold text-slate-700">{t('فتح معاينة وطباعة السند بعد الاعتماد مباشرة', 'Open voucher preview & print immediately after approval')}</span>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-slate-300 rounded-md font-bold text-slate-700 cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-4 py-1.5 text-white rounded-md font-black transition-all cursor-pointer disabled:opacity-50 ${meta.btnClass}`}
            >
              {isSubmitting ? t('جاري التنفيذ...', 'Processing...') : t(`اعتماد ${meta.badgeAr}`, `Approve ${meta.badgeEn}`)}
            </button>
          </div>
        </form>
      </Modal>

      <PrintDocumentModal
        isOpen={!!printData}
        onClose={() => {
          setPrintData(null);
          onClose();
        }}
        data={printData}
      />
    </>
  );
};

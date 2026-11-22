import React, { useState, useEffect } from 'react';
import { Wallet, ArrowLeftRight, TrendingDown, TrendingUp, AlertCircle, CheckCircle2, Printer } from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { CashOperationType, FinancialTransaction } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';

interface CashOperationModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: CashOperationType;
  onCompleted?: (tx?: FinancialTransaction) => void;
}

const OP_LABELS: Record<CashOperationType, { title: string; badge: string; btnClass: string; defaultCategory: string }> = {
  cash_withdrawal: {
    title: 'سحب نقدي من الخزينة',
    badge: 'سحب نقدي',
    btnClass: 'bg-rose-700 hover:bg-rose-800',
    defaultCategory: 'سحب نقدي',
  },
  cash_deposit: {
    title: 'إيداع نقدي بالخزينة',
    badge: 'إيداع نقدي',
    btnClass: 'bg-emerald-700 hover:bg-emerald-800',
    defaultCategory: 'إيداع نقدي',
  },
  cashbox_transfer: {
    title: 'ترحيل / تحويل بين الخزائن',
    badge: 'ترحيل نقدي',
    btnClass: 'bg-blue-900 hover:bg-blue-950',
    defaultCategory: 'ترحيل بين الخزائن',
  },
  expense: {
    title: 'تسجيل مصروف تشغيل',
    badge: 'مصروفات',
    btnClass: 'bg-orange-700 hover:bg-orange-800',
    defaultCategory: 'مصروفات تشغيل',
  },
  profit_deposit: {
    title: 'إيداع ربحي / إيراد خزينة',
    badge: 'إيداع ربحي',
    btnClass: 'bg-teal-700 hover:bg-teal-800',
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
  const [opType, setOpType] = useState<CashOperationType>(initialMode);
  const [cashboxId, setCashboxId] = useState<string>('');
  const [targetCashboxId, setTargetCashboxId] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState<string>(OP_LABELS[initialMode].defaultCategory);
  const [recipientOrPayer, setRecipientOrPayer] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [printAfterSave, setPrintAfterSave] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [printData, setPrintData] = useState<PrintData | null>(null);

  useEffect(() => {
    if (isOpen) {
      setOpType(initialMode);
      setCategory(OP_LABELS[initialMode].defaultCategory);
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
    setCategory(OP_LABELS[nextMode].defaultCategory);
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
      setError('يرجى تحديد الخزينة');
      return;
    }
    if (opType === 'cashbox_transfer' && (!targetCashboxId || targetCashboxId === cashboxId)) {
      setError('يرجى تحديد خزينة وجهة مختلفة للترحيل');
      return;
    }
    if (!amount || amount <= 0) {
      setError('يرجى إدخال مبلغ صحيح أكبر من الصفر');
      return;
    }
    if (isOutflow && currentBalance < amount) {
      setError(`الرصيد المتاح (${currentBalance.toLocaleString()}) في ${selectedCb?.name || 'الخزينة'} لا يكفي لهذه العملية.`);
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
      setError(res.error || 'تعذر تنفيذ العملية النقدية');
      return;
    }

    if (onCompleted) onCompleted(res.transaction);

    if (printAfterSave && res.transaction) {
      setPrintData({
        title: OP_LABELS[opType].title,
        docNumber: res.transaction.transactionNumber,
        docType: isOutflow ? 'سند صرف' : 'سند قبض',
        date: res.transaction.date,
        partyName: recipientOrPayer || selectedCb?.name || '',
        warehouseName: selectedCb?.name,
        paymentType: OP_LABELS[opType].badge,
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
        title={meta.title}
        subtitle="تسجيل وتوثيق فوري للعملية النقدية على الخزينة وسجل المراجعة"
        maxWidth="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Operation Type Switcher */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 bg-slate-100 p-1.5 rounded-xl">
            {(Object.keys(OP_LABELS) as CashOperationType[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleModeChange(key)}
                className={`py-2 px-2 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                  opType === key
                    ? 'bg-blue-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-white'
                }`}
              >
                {OP_LABELS[key].badge}
              </button>
            ))}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {opType === 'cashbox_transfer' ? 'من خزينة / حساب:' : 'الخزينة / الحساب البنكي:'}
              </label>
              <select
                value={cashboxId}
                onChange={(e) => setCashboxId(e.target.value)}
                required
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
              >
                {cashboxes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.balanceHidden ? `${c.name} (رصيد محجوب)` : `${c.name} (${(c.currentBalance ?? 0).toLocaleString()} ${settings.currency})`}
                  </option>
                ))}
              </select>
            </div>

            {opType === 'cashbox_transfer' ? (
              <div>
                <label className="block font-bold text-slate-700 mb-1">إلى خزينة / حساب وجهة:</label>
                <select
                  value={targetCashboxId}
                  onChange={(e) => setTargetCashboxId(e.target.value)}
                  required
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
                >
                  {cashboxes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.balanceHidden ? `${c.name} (رصيد محجوب)` : `${c.name} (${(c.currentBalance ?? 0).toLocaleString()} ${settings.currency})`}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block font-bold text-slate-700 mb-1">تاريخ العملية:</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-mono font-bold"
                />
              </div>
            )}
          </div>

          {/* Live balance preview */}
          {selectedCb && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-blue-900" />
                <span className="text-slate-600 font-bold">الرصيد الحالي ({selectedCb.name}):</span>
                <strong className="font-mono text-slate-900">
                  {currentBalance.toLocaleString()} {settings.currency}
                </strong>
              </div>
              {amount > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">الرصيد بعد العملية:</span>
                  <strong className={`font-mono font-black ${projectedBalance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {projectedBalance.toLocaleString()} {settings.currency}
                  </strong>
                  {opType === 'cashbox_transfer' && targetCb && (
                    <span className="text-blue-800 font-mono font-bold">
                      (الوجهة: {targetCb.balanceHidden ? 'محجوب' : ((targetCb.currentBalance ?? 0) + amount).toLocaleString()})
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">المبلغ ({settings.currency}):</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder="0.00"
                className="w-full bg-blue-50 border border-blue-300 rounded-xl p-2.5 font-mono font-black text-center text-base text-blue-950"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {opType === 'expense' ? 'بند المصروف:' : opType === 'profit_deposit' ? 'تصنيف الربح / الإيراد:' : 'التصنيف / البيان:'}
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={meta.defaultCategory}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">المستفيد / المودع / المسؤول:</label>
              <input
                type="text"
                value={recipientOrPayer}
                onChange={(e) => setRecipientOrPayer(e.target.value)}
                placeholder="اسم الشخص أو الجهة..."
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
              />
            </div>
            {opType === 'cashbox_transfer' && (
              <div>
                <label className="block font-bold text-slate-700 mb-1">تاريخ الترحيل:</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-mono font-bold"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">ملاحظات وتفاصيل:</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أدخل تفاصيل أو سبب العملية للتوثيق في سجل الحركات..."
              className="w-full bg-white border border-slate-300 rounded-xl p-2.5"
            />
          </div>

          <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={printAfterSave}
              onChange={(e) => setPrintAfterSave(e.target.checked)}
              className="w-4 h-4 rounded text-blue-900"
            />
            <Printer className="w-4 h-4 text-slate-600" />
            <span className="font-bold text-slate-700">فتح معاينة وطباعة السند بعد الاعتماد مباشرة</span>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-xl font-bold text-slate-700 cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-6 py-2 text-white rounded-xl font-black shadow-md transition-all cursor-pointer disabled:opacity-50 ${meta.btnClass}`}
            >
              {isSubmitting ? 'جاري التنفيذ...' : `اعتماد ${meta.badge}`}
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

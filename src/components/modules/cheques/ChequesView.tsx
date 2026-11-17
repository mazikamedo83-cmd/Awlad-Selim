import React, { useState, useEffect } from 'react';
import { 
  CreditCard, Plus, Search, CheckCircle2, Clock, AlertCircle, 
  XCircle, RotateCcw, Calendar, Check 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { Cheque, InstallmentSchedule } from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';

interface ChequesViewProps {
  initialTab?: 'cheques' | 'installments';
}

export const ChequesView: React.FC<ChequesViewProps> = ({ initialTab }) => {
  const { cheques, installments, cashboxes, settings, addCheque, updateChequeStatus, payInstallment } = useData();

  const [activeTab, setActiveTab] = useState<'cheques' | 'installments'>(initialTab || 'cheques');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add Cheque Modal
  const [isAddChequeOpen, setIsAddChequeOpen] = useState(false);
  const [chequeNum, setChequeNum] = useState('');
  const [chequeType, setChequeType] = useState<'incoming' | 'outgoing'>('incoming');
  const [bankName, setBankName] = useState('البنك الأهلي المصري');
  const [amount, setAmount] = useState(10000);
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
    if (!chequeNum.trim() || amount <= 0) {
      setChequeError('يرجى إدخال رقم الشيك ومبلغ أكبر من صفر.');
      return;
    }

    setIsSavingCheque(true);
    try {
      await addCheque({
        chequeNumber: chequeNum.trim(),
        type: chequeType,
        bankName: bankName.trim(),
        amount,
        issueDate: new Date().toISOString().split('T')[0],
        dueDate,
        partyName: partyName.trim(),
        status: 'pending',
        notes: notes.trim(),
      });

      setStatusBanner({ type: 'success', text: `تم تسجيل الشيك رقم (${chequeNum.trim()}) بنجاح.` });
      setIsAddChequeOpen(false);
      setChequeNum('');
      setAmount(0);
      setPartyName('');
      setNotes('');
    } catch (err: any) {
      setChequeError(err?.message || 'تعذر حفظ الشيك');
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
      setCollectError('يرجى اختيار الخزينة أو الحساب البنكي.');
      return;
    }
    setIsCollectingCheque(true);
    try {
      await updateChequeStatus(collectingCheque.id, 'collected', collectCashboxId, 'تم تحصيل الشيك وإيداعه بنجاح');
      setStatusBanner({ type: 'success', text: `تم تحصيل الشيك رقم (${collectingCheque.chequeNumber}) بنجاح.` });
      setCollectingCheque(null);
    } catch (err: any) {
      setCollectError(err?.message || 'تعذر تحصيل الشيك');
    } finally {
      setIsCollectingCheque(false);
    }
  };

  const handleConfirmRejectCheque = async (reason?: string) => {
    if (!rejectingCheque) return;
    setIsRejectingCheque(true);
    try {
      await updateChequeStatus(rejectingCheque.id, 'rejected', undefined, reason || 'شيك مرتد / مرفوض');
      setStatusBanner({ type: 'success', text: `تم تسجيل رفض/ارتداد الشيك رقم (${rejectingCheque.chequeNumber}).` });
      setRejectingCheque(null);
    } catch (err: any) {
      setStatusBanner({ type: 'error', text: err?.message || 'تعذر تحديث حالة الشيك' });
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
      setInstallmentError('يرجى اختيار الخزينة المودع بها.');
      return;
    }
    setIsPayingInstallment(true);
    try {
      await payInstallment(payingSchedule.schedule.id, payingSchedule.itemId, payingSchedule.amount, installmentCashboxId);
      setStatusBanner({ type: 'success', text: `تم تسجيل سداد القسط بمبلغ ${payingSchedule.amount.toLocaleString()} ${settings.currency}.` });
      setPayingSchedule(null);
    } catch (err: any) {
      setInstallmentError(err?.message || 'تعذر سداد القسط');
    } finally {
      setIsPayingInstallment(false);
    }
  };

  const filteredCheques = cheques.filter(c => 
    c.chequeNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.bankName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.partyName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إدارة الشيكات والأقساط المالية</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            متابعة استحقاق الشيكات البنكية، تواريخ التحصيل، وجداول أقساط العملاء
          </p>
        </div>

        {activeTab === 'cheques' && (
          <button
            onClick={() => {
              setChequeError(null);
              setIsAddChequeOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة شيك بنكي</span>
          </button>
        )}
      </div>

      {statusBanner && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
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

      {/* Tabs */}
      <div className="flex border-b border-slate-200 text-xs font-bold gap-4">
        <button
          onClick={() => setActiveTab('cheques')}
          className={`pb-2.5 transition-colors border-b-2 ${
            activeTab === 'cheques' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          الشيكات البنكية ({cheques.length})
        </button>
        <button
          onClick={() => setActiveTab('installments')}
          className={`pb-2.5 transition-colors border-b-2 ${
            activeTab === 'installments' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          جداول متابعة الأقساط ({installments.length})
        </button>
      </div>

      {/* Cheques Tab */}
      {activeTab === 'cheques' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-3 border-b">
            <input
              type="text"
              placeholder="بحث برقم الشيك أو البنك أو الطرف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full max-w-sm bg-slate-50 border rounded-xl px-3 py-2 text-xs outline-hidden"
            />
          </div>

          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 font-bold border-b text-slate-700">
                <th className="p-3">رقم الشيك</th>
                <th className="p-3">النوع</th>
                <th className="p-3">البنك المسحوب عليه</th>
                <th className="p-3">الطرف (الساحب / المستفيد)</th>
                <th className="p-3">تاريخ الاستحقاق</th>
                <th className="p-3 text-center">المبلغ</th>
                <th className="p-3">الحالة</th>
                <th className="p-3 text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCheques.map(chq => (
                <tr key={chq.id} className="hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold text-blue-900">{chq.chequeNumber}</td>
                  <td className="p-3">
                    {chq.type === 'incoming' ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-bold text-[10px]">شيك وارد (لنا)</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 font-bold text-[10px]">شيك صادر (علينا)</span>
                    )}
                  </td>
                  <td className="p-3 font-semibold">{chq.bankName}</td>
                  <td className="p-3 font-bold text-slate-800">{chq.partyName}</td>
                  <td className="p-3 font-mono text-slate-600">{chq.dueDate}</td>
                  <td className="p-3 text-center font-mono font-black text-sm text-blue-950">
                    {chq.amount.toLocaleString()} {settings.currency}
                  </td>
                  <td className="p-3">
                    {chq.status === 'collected' ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">تم التحصيل</span>
                    ) : chq.status === 'pending' ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px]">برسم التحصيل</span>
                    ) : chq.status === 'rejected' ? (
                      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold text-[10px]">مرفوض</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 font-bold text-[10px]">جديد</span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {chq.status !== 'collected' && chq.status !== 'rejected' && (
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => {
                            setCollectError(null);
                            setCollectingCheque(chq);
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] cursor-pointer"
                        >
                          تحصيل
                        </button>
                        <button
                          onClick={() => setRejectingCheque(chq)}
                          className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-bold text-[11px] cursor-pointer"
                        >
                          رفض / ارتداد
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Installments Tab */}
      {activeTab === 'installments' && (
        <div className="space-y-4">
          {installments.map(sch => (
            <div key={sch.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between border-b pb-3">
                <div>
                  <span className="font-mono font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded">{sch.scheduleNumber}</span>
                  <h3 className="text-sm font-black text-slate-900 mt-1">العميل: {sch.customerName}</h3>
                </div>
                <div className="flex gap-4 font-bold text-slate-700">
                  <span>إجمالي الأقساط: <strong className="font-mono">{sch.totalAmount} {settings.currency}</strong></span>
                  <span>المسدد: <strong className="font-mono text-emerald-700">{sch.paidAmount}</strong></span>
                  <span>المتبقي: <strong className="font-mono text-red-700">{sch.remainingAmount} {settings.currency}</strong></span>
                </div>
              </div>

              {/* Installments Table */}
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50 font-bold border-b">
                    <th className="p-2">رقم القسط</th>
                    <th className="p-2">تاريخ الاستحقاق</th>
                    <th className="p-2 text-center">مبلغ القسط</th>
                    <th className="p-2 text-center">المدفوع</th>
                    <th className="p-2">الحالة</th>
                    <th className="p-2 text-center">سداد</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sch.items.map(it => {
                    const isOverdue = it.status === 'pending' && new Date(it.dueDate) < new Date();
                    return (
                      <tr key={it.id} className="hover:bg-slate-50">
                        <td className="p-2 font-bold">القسط {it.installmentNumber}</td>
                        <td className="p-2 font-mono text-slate-600">{it.dueDate}</td>
                        <td className="p-2 text-center font-bold">{it.amount.toLocaleString()}</td>
                        <td className="p-2 text-center font-bold text-emerald-700">{it.paidAmount.toLocaleString()}</td>
                        <td className="p-2">
                          {it.status === 'paid' ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">مسدد بالكامل</span>
                          ) : isOverdue ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold animate-pulse">متأخر عن الموعد</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">في الانتظار</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {it.status !== 'paid' && (
                            <button
                              onClick={() => {
                                setInstallmentError(null);
                                setPayingSchedule({ schedule: sch, itemId: it.id, amount: it.amount - it.paidAmount });
                              }}
                              className="px-2 py-1 bg-emerald-600 text-white rounded-lg font-bold cursor-pointer"
                            >
                              تسجيل سداد
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Add Cheque Modal */}
      <Modal
        isOpen={isAddChequeOpen}
        onClose={() => setIsAddChequeOpen(false)}
        title="إضافة شيك بنكي جديد"
        maxWidth="md"
      >
        <form onSubmit={handleAddChequeSubmit} className="space-y-4 text-xs">
          {chequeError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{chequeError}</span>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">نوع الشيك:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChequeType('incoming')}
                className={`p-2 border rounded-xl font-bold ${chequeType === 'incoming' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                شيك وارد (من عميل)
              </button>
              <button
                type="button"
                onClick={() => setChequeType('outgoing')}
                className={`p-2 border rounded-xl font-bold ${chequeType === 'outgoing' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                شيك صادر (لمورد)
              </button>
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">رقم الشيك:</label>
            <input
              type="text"
              required
              value={chequeNum}
              onChange={(e) => setChequeNum(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-mono font-bold"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">البنك:</label>
            <input
              type="text"
              required
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">الطرف (العميل أو المورد):</label>
            <input
              type="text"
              required
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">المبلغ ({settings.currency}):</label>
              <input
                type="number"
                min="1"
                required
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full border rounded-xl p-2.5 font-mono font-black text-center"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">تاريخ الاستحقاق:</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-mono font-bold"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAddChequeOpen(false)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">إلغاء</button>
            <button type="submit" disabled={isSavingCheque} className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50">
              {isSavingCheque ? 'جاري الحفظ...' : 'حفظ الشيك'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Collect Cheque Modal */}
      {collectingCheque && (
        <Modal
          isOpen={!!collectingCheque}
          onClose={() => setCollectingCheque(null)}
          title={`تحصيل الشيك رقم ${collectingCheque.chequeNumber}`}
          maxWidth="md"
        >
          <form onSubmit={handleConfirmCollect} className="space-y-4 text-xs">
            {collectError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{collectError}</span>
              </div>
            )}
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <p>البنك: <strong>{collectingCheque.bankName}</strong></p>
              <p>المبلغ: <strong className="font-mono text-emerald-800">{collectingCheque.amount.toLocaleString()} {settings.currency}</strong></p>
            </div>

            <div>
              <label className="block font-bold mb-1">الخزينة أو الحساب البنكي المودع به:</label>
              <select
                value={collectCashboxId}
                onChange={(e) => setCollectCashboxId(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-bold"
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>{cb.name}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setCollectingCheque(null)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">إلغاء</button>
              <button type="submit" disabled={isCollectingCheque} className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50">
                {isCollectingCheque ? 'جاري التحصيل...' : 'تأكيد التحصيل'}
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
          title="سداد قسط العميل"
          maxWidth="md"
        >
          <form onSubmit={handlePayInstallmentSubmit} className="space-y-4 text-xs">
            {installmentError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{installmentError}</span>
              </div>
            )}
            <div>
              <label className="block font-bold mb-1">المبلغ المسدد ({settings.currency}):</label>
              <input
                type="number"
                min="1"
                required
                value={payingSchedule.amount}
                onChange={(e) => setPayingSchedule({ ...payingSchedule, amount: Number(e.target.value) })}
                className="w-full border rounded-xl p-2.5 font-mono font-black text-center text-emerald-800"
              />
            </div>

            <div>
              <label className="block font-bold mb-1">الخزينة المودع بها:</label>
              <select
                value={installmentCashboxId}
                onChange={(e) => setInstallmentCashboxId(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-bold"
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>{cb.name}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setPayingSchedule(null)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">إلغاء</button>
              <button type="submit" disabled={isPayingInstallment} className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50">
                {isPayingInstallment ? 'جاري التسديد...' : 'تأكيد سداد القسط'}
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
        inputLabel="سبب رفض / ارتداد الشيك:"
        inputPlaceholder="مثال: عدم كفاية الرصيد أو خطأ في التوقيع..."
        isLoading={isRejectingCheque}
        title="تأكيد رفض الشيك البنكي"
        message={rejectingCheque ? `تسجيل ارتداد الشيك رقم (${rejectingCheque.chequeNumber}) الخاص بـ (${rejectingCheque.partyName}).` : ''}
        confirmLabel="تأكيد الرفض"
      />
    </div>
  );
};

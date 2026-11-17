import React, { useState, useMemo, useEffect } from 'react';
import { 
  Wallet, Plus, ArrowLeftRight, TrendingDown, TrendingUp, 
  Printer, Download, Search, CheckCircle2, AlertCircle, Building2, Landmark 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { Cashbox, ExpenseIncomeRecord } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';

interface FinanceViewProps {
  initialTab?: 'cashboxes' | 'transfer' | 'expenses';
}

export const FinanceView: React.FC<FinanceViewProps> = ({ initialTab }) => {
  const { 
    cashboxes, financialTransactions, expenseIncomes, settings, 
    addCashbox, transferBetweenCashboxes, addExpenseIncome 
  } = useData();

  const [activeTab, setActiveTab] = useState<'cashboxes' | 'transactions' | 'expenses'>(
    initialTab === 'expenses' ? 'expenses' : 'cashboxes'
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [expenseTypeFilter, setExpenseTypeFilter] = useState<'all' | 'expense' | 'income'>('all');
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Transfer modal
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(initialTab === 'transfer');
  const [fromCbId, setFromCbId] = useState(cashboxes[0]?.id || '');
  const [toCbId, setToCbId] = useState(cashboxes[1]?.id || cashboxes[0]?.id || '');
  const [transferAmount, setTransferAmount] = useState(1000);
  const [transferNotes, setTransferNotes] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);

  // Add Cashbox modal
  const [isAddCashboxOpen, setIsAddCashboxOpen] = useState(false);
  const [newCbName, setNewCbName] = useState('');
  const [newCbType, setNewCbType] = useState<'cashbox' | 'bank'>('cashbox');
  const [newCbAccount, setNewCbAccount] = useState('');
  const [newCbOpening, setNewCbOpening] = useState(0);
  const [cashboxError, setCashboxError] = useState<string | null>(null);

  // Expense / Income modal
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [recordType, setRecordType] = useState<'expense' | 'income'>('expense');
  const [category, setCategory] = useState('وقود ونقل وتوزيع');
  const [amount, setAmount] = useState(500);
  const [selectedCashboxId, setSelectedCashboxId] = useState(cashboxes[0]?.id || '');
  const [recipientOrPayer, setRecipientOrPayer] = useState('');
  const [notes, setNotes] = useState('');
  const [expenseError, setExpenseError] = useState<string | null>(null);

  // Print modal
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  useEffect(() => {
    if (initialTab === 'expenses') {
      setActiveTab('expenses');
    } else if (initialTab === 'transfer') {
      setActiveTab('cashboxes');
      setTransferError(null);
      setIsTransferModalOpen(true);
    } else if (initialTab === 'cashboxes') {
      setActiveTab('cashboxes');
    }
  }, [initialTab]);

  useEffect(() => {
    if (cashboxes.length === 0) return;
    if (!fromCbId || !cashboxes.some(c => c.id === fromCbId)) {
      setFromCbId(cashboxes[0].id);
    }
    if (!toCbId || !cashboxes.some(c => c.id === toCbId)) {
      setToCbId(cashboxes[1]?.id || cashboxes[0].id);
    }
    if (!selectedCashboxId || !cashboxes.some(c => c.id === selectedCashboxId)) {
      setSelectedCashboxId(cashboxes[0].id);
    }
  }, [cashboxes, fromCbId, toCbId, selectedCashboxId]);

  const totalLiquidity = useMemo(() => {
    return cashboxes.reduce((acc, c) => acc + c.currentBalance, 0);
  }, [cashboxes]);

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError(null);
    if (!fromCbId || !toCbId) {
      setTransferError('يرجى تحديد الخزينة المحول منها والمحول إليها.');
      return;
    }
    if (fromCbId === toCbId) {
      setTransferError('لا يمكن التحويل من نفس الخزينة إلى نفسها.');
      return;
    }
    const res = await transferBetweenCashboxes(fromCbId, toCbId, transferAmount, transferNotes || 'تحويل مالي بين الخزائن');
    if (!res.success) {
      setTransferError(res.error || 'فشل التحويل');
    } else {
      setIsTransferModalOpen(false);
      setTransferNotes('');
      setStatusBanner({ type: 'success', text: `تم تنفيذ التحويل المالي بمبلغ ${transferAmount.toLocaleString()} ${settings.currency} بنجاح.` });
    }
  };

  const handleAddCashboxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCashboxError(null);
    if (!newCbName.trim()) {
      setCashboxError('يرجى إدخال اسم الخزينة أو الحساب البنكي.');
      return;
    }
    try {
      await addCashbox({
        name: newCbName.trim(),
        type: newCbType,
        accountNumber: newCbType === 'bank' ? newCbAccount.trim() : undefined,
        openingBalance: Number(newCbOpening) || 0,
        isDefault: false,
      });
      setIsAddCashboxOpen(false);
      setStatusBanner({ type: 'success', text: `تمت إضافة (${newCbName.trim()}) بنجاح.` });
      setNewCbName('');
      setNewCbAccount('');
      setNewCbOpening(0);
    } catch (err: any) {
      setCashboxError(err?.message || 'تعذر إنشاء الخزينة أو الحساب البنكي');
    }
  };

  const handleAddExpenseIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    setExpenseError(null);
    if (amount <= 0) {
      setExpenseError('يرجى إدخال مبلغ أكبر من صفر.');
      return;
    }
    if (!selectedCashboxId) {
      setExpenseError('يرجى اختيار الخزينة المتأثرة.');
      return;
    }
    const cb = cashboxes.find(c => c.id === selectedCashboxId);

    try {
      await addExpenseIncome({
        type: recordType,
        category: category.trim(),
        amount,
        date: new Date().toISOString().split('T')[0],
        cashboxId: selectedCashboxId,
        cashboxName: cb?.name || '',
        paymentMethod: 'نقدي',
        recipientOrPayer: recipientOrPayer.trim() || (recordType === 'expense' ? 'جهة صرف' : 'جهة تحصيل'),
        notes: notes.trim(),
      });

      setIsExpenseModalOpen(false);
      setStatusBanner({
        type: 'success',
        text: recordType === 'expense'
          ? `تم تسجيل سند صرف (${category}) بمبلغ ${amount.toLocaleString()} ${settings.currency}.`
          : `تم تسجيل سند قبض إيراد (${category}) بمبلغ ${amount.toLocaleString()} ${settings.currency}.`,
      });

      // Print voucher
      setPrintData({
        title: recordType === 'expense' ? 'سند صرف مصروفات' : 'سند قبض إيرادات',
        docNumber: `${recordType === 'expense' ? 'EXP' : 'INC'}-${Date.now().toString().slice(-6)}`,
        docType: recordType === 'expense' ? 'سند صرف' : 'سند قبض',
        date: new Date().toISOString().split('T')[0],
        partyName: recipientOrPayer,
        grandTotal: amount,
        paidAmount: amount,
        notes: `${category} - ${notes}`,
      });
      setIsPrintModalOpen(true);
    } catch (err: any) {
      setExpenseError(err?.message || 'تعذر تسجيل السند المالي');
    }
  };

  const filteredTransactions = useMemo(() => {
    return financialTransactions.filter(tx => 
      tx.transactionNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.cashboxName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [financialTransactions, searchTerm]);

  const filteredExpenses = useMemo(() => {
    return expenseIncomes.filter(rec => {
      const matchType = expenseTypeFilter === 'all' || rec.type === expenseTypeFilter;
      const q = searchTerm.toLowerCase();
      const matchSearch =
        !q ||
        (rec.recordNumber || '').toLowerCase().includes(q) ||
        rec.category.toLowerCase().includes(q) ||
        rec.cashboxName.toLowerCase().includes(q) ||
        (rec.recipientOrPayer || '').toLowerCase().includes(q) ||
        (rec.notes || '').toLowerCase().includes(q);
      return matchType && matchSearch;
    });
  }, [expenseIncomes, expenseTypeFilter, searchTerm]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">المالية والخزائن والحسابات البنكية</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إدارة السيولة النقدية، التحويل بين الخزائن، وسندات الصرف والقبض
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setExpenseError(null);
              setRecordType('expense');
              setIsExpenseModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <TrendingDown className="w-4 h-4" />
            <span>سند صرف مصروف</span>
          </button>

          <button
            onClick={() => {
              setExpenseError(null);
              setRecordType('income');
              setIsExpenseModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <TrendingUp className="w-4 h-4" />
            <span>سند قبض إيراد</span>
          </button>

          <button
            onClick={() => {
              setTransferError(null);
              setIsTransferModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>تحويل بين الخزائن</span>
          </button>
        </div>
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
          onClick={() => setActiveTab('cashboxes')}
          className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'cashboxes' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          أرصدة الخزائن والبنوك ({cashboxes.length})
        </button>
        <button
          onClick={() => setActiveTab('transactions')}
          className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'transactions' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          سجل الحركات المالية اليومية ({financialTransactions.length})
        </button>
        <button
          onClick={() => setActiveTab('expenses')}
          className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'expenses' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          المصروفات والإيرادات ({expenseIncomes.length})
        </button>
      </div>

      {/* Tab 1: Cashboxes List */}
      {activeTab === 'cashboxes' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cashboxes.map(cb => (
              <div key={cb.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs text-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-900 flex items-center justify-center font-bold">
                    {cb.type === 'bank' ? <Landmark className="w-5 h-5" /> : <Wallet className="w-5 h-5" />}
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    {cb.type === 'bank' ? 'حساب بنكي' : 'خزينة نقدية'}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{cb.name}</h3>
                  {cb.accountNumber && (
                    <p className="font-mono text-[11px] text-slate-500 mt-0.5">رقم الحساب: {cb.accountNumber}</p>
                  )}
                </div>

                <div className="pt-2 border-t flex justify-between items-center">
                  <span className="text-slate-500">الرصيد المتاح:</span>
                  <span className="font-mono text-base font-black text-blue-950">
                    {cb.currentBalance.toLocaleString()} {settings.currency}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setIsAddCashboxOpen(true)}
              className="text-xs font-bold text-blue-900 hover:underline flex items-center gap-1"
            >
              + إضافة خزينة أو حساب بنكي جديد
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Financial Transactions */}
      {activeTab === 'transactions' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-3 border-b">
            <input
              type="text"
              placeholder="بحث برقم الحركة، الخزينة، أو البيان..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full max-w-sm bg-slate-50 border rounded-xl px-3 py-2 text-xs outline-hidden"
            />
          </div>

          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 font-bold border-b text-slate-700">
                <th className="p-3">رقم الحركة</th>
                <th className="p-3">التاريخ</th>
                <th className="p-3">الخزينة</th>
                <th className="p-3">نوع الحركة</th>
                <th className="p-3">البيان</th>
                <th className="p-3 text-center">المبلغ</th>
                <th className="p-3">المستخدم المسؤول</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.map(tx => (
                <tr key={tx.id} className="hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold text-blue-900">{tx.transactionNumber}</td>
                  <td className="p-3 font-mono text-slate-600">{tx.date}</td>
                  <td className="p-3 font-semibold">{tx.cashboxName}</td>
                  <td className="p-3 font-bold text-slate-800">{tx.category}</td>
                  <td className="p-3 text-slate-600">{tx.description}</td>
                  <td className="p-3 text-center font-mono font-black text-sm text-blue-950">
                    {tx.amount.toLocaleString()} {settings.currency}
                  </td>
                  <td className="p-3 text-slate-500">{tx.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: Expenses & Income */}
      {activeTab === 'expenses' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-3">
          <div className="p-3 border-b flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <input
                  type="text"
                  placeholder="بحث برقم السند، البند، الخزينة، أو الجهة..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border rounded-xl pr-9 pl-3 py-2 text-xs outline-hidden focus:bg-white focus:border-blue-600"
                />
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              </div>

              <select
                value={expenseTypeFilter}
                onChange={(e) => setExpenseTypeFilter(e.target.value as any)}
                className="bg-slate-50 border rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-hidden"
              >
                <option value="all">الكل (مصروفات وإيرادات)</option>
                <option value="expense">المصروفات فقط</option>
                <option value="income">الإيرادات فقط</option>
              </select>
            </div>

            <button
              onClick={() => {
                const headers = ['رقم السند', 'التاريخ', 'النوع', 'البند', 'الخزينة', 'الجهة', 'المبلغ', 'ملاحظات'];
                const rows = filteredExpenses.map(r => [
                  r.recordNumber,
                  r.date,
                  r.type === 'expense' ? 'مصروف' : 'إيراد',
                  r.category,
                  r.cashboxName,
                  r.recipientOrPayer,
                  r.amount,
                  r.notes || '',
                ]);
                exportToExcel(`المصروفات_والإيرادات_${new Date().toISOString().split('T')[0]}`, headers, rows);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-emerald-800 rounded-xl text-xs font-bold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>تصدير Excel</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b text-slate-700">
                  <th className="p-3">رقم السند</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">النوع</th>
                  <th className="p-3">البند / التصنيف</th>
                  <th className="p-3">الخزينة</th>
                  <th className="p-3">الجهة المستلمة / الدافعة</th>
                  <th className="p-3 text-center">المبلغ</th>
                  <th className="p-3">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400">
                      لا توجد مصروفات أو إيرادات مسجلة مطابقة للبحث.
                    </td>
                  </tr>
                ) : (
                  filteredExpenses.map(rec => (
                    <tr key={rec.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-blue-900">{rec.recordNumber}</td>
                      <td className="p-3 font-mono text-slate-600">{rec.date}</td>
                      <td className="p-3">
                        {rec.type === 'expense' ? (
                          <span className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-800 border border-orange-200 font-bold text-[10px]">
                            سند صرف (مصروف)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200 font-bold text-[10px]">
                            سند قبض (إيراد)
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-bold text-slate-800">{rec.category}</td>
                      <td className="p-3 font-semibold text-slate-700">{rec.cashboxName}</td>
                      <td className="p-3 text-slate-700">{rec.recipientOrPayer}</td>
                      <td className={`p-3 text-center font-mono font-black text-sm ${
                        rec.type === 'expense' ? 'text-orange-700' : 'text-teal-700'
                      }`}>
                        {rec.amount.toLocaleString()} {settings.currency}
                      </td>
                      <td className="p-3 text-slate-500">{rec.notes || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title="تحويل نقدية بين الخزائن والبنوك"
        maxWidth="md"
      >
        <form onSubmit={handleExecuteTransfer} className="space-y-4 text-xs">
          {transferError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{transferError}</span>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">من الخزينة / الحساب:</label>
            <select
              value={fromCbId}
              onChange={(e) => setFromCbId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {cashboxes.map(c => (
                <option key={c.id} value={c.id}>{c.name} (رصيدها: {c.currentBalance})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">إلى الخزينة / الحساب:</label>
            <select
              value={toCbId}
              onChange={(e) => setToCbId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {cashboxes.map(c => (
                <option key={c.id} value={c.id}>{c.name} (رصيدها: {c.currentBalance})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">المبلغ المراد تحويله ({settings.currency}):</label>
            <input
              type="number"
              min="1"
              required
              value={transferAmount}
              onChange={(e) => setTransferAmount(Number(e.target.value))}
              className="w-full border rounded-xl p-2.5 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">البيان:</label>
            <input
              type="text"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              placeholder="إيداع بنكي لحساب المبيعات..."
              className="w-full border rounded-xl p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsTransferModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button type="submit" className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold">تنفيذ التحويل المالي</button>
          </div>
        </form>
      </Modal>

      {/* Add Cashbox Modal */}
      <Modal
        isOpen={isAddCashboxOpen}
        onClose={() => setIsAddCashboxOpen(false)}
        title="إضافة خزينة أو حساب بنكي"
        maxWidth="md"
      >
        <form onSubmit={handleAddCashboxSubmit} className="space-y-4 text-xs">
          {cashboxError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{cashboxError}</span>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">نوع الحساب:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewCbType('cashbox')}
                className={`p-2 border rounded-xl font-bold ${newCbType === 'cashbox' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                خزينة نقدية
              </button>
              <button
                type="button"
                onClick={() => setNewCbType('bank')}
                className={`p-2 border rounded-xl font-bold ${newCbType === 'bank' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                حساب بنكي
              </button>
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">اسم الخزينة أو البنك:</label>
            <input
              type="text"
              required
              placeholder="مثال: حساب البنك الأهلي الجاري"
              value={newCbName}
              onChange={(e) => setNewCbName(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            />
          </div>

          {newCbType === 'bank' && (
            <div>
              <label className="block font-bold mb-1">رقم الحساب أو الآيبان:</label>
              <input
                type="text"
                placeholder="IBAN / Account Number"
                value={newCbAccount}
                onChange={(e) => setNewCbAccount(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-mono"
              />
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">الرصيد الافتتاحي:</label>
            <input
              type="number"
              value={newCbOpening}
              onChange={(e) => setNewCbOpening(Number(e.target.value))}
              className="w-full border rounded-xl p-2.5 font-mono font-bold"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAddCashboxOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button type="submit" className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold">حفظ الحساب</button>
          </div>
        </form>
      </Modal>

      {/* Expense/Income Voucher Modal */}
      <Modal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        title={recordType === 'expense' ? 'تسجيل سند صرف مصروفات' : 'تسجيل سند قبض إيرادات'}
        maxWidth="md"
      >
        <form onSubmit={handleAddExpenseIncome} className="space-y-4 text-xs">
          {expenseError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{expenseError}</span>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">بند {recordType === 'expense' ? 'المصروف' : 'الإيراد'}:</label>
            <input
              type="text"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="وقود، صيانة، كهرباء، إيجار، تخريد..."
              className="w-full border rounded-xl p-2.5 font-bold"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">المبلغ ({settings.currency}):</label>
            <input
              type="number"
              min="1"
              required
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full border rounded-xl p-2.5 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">الخزينة المتأثرة:</label>
            <select
              value={selectedCashboxId}
              onChange={(e) => setSelectedCashboxId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {cashboxes.map(c => (
                <option key={c.id} value={c.id}>{c.name} (رصيدها: {c.currentBalance})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">{recordType === 'expense' ? 'الجهة المستلمة للمصروف:' : 'الجهة المسددة للإيراد:'}</label>
            <input
              type="text"
              required
              value={recipientOrPayer}
              onChange={(e) => setRecipientOrPayer(e.target.value)}
              className="w-full border rounded-xl p-2.5"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">ملاحظات السند:</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border rounded-xl p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsExpenseModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button
              type="submit"
              className={`px-6 py-2 text-white rounded-xl font-bold shadow-md ${
                recordType === 'expense' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-teal-600 hover:bg-teal-700'
              }`}
            >
              اعتماد السند وطباعته
            </button>
          </div>
        </form>
      </Modal>

      {/* Print Document Modal */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />
    </div>
  );
};

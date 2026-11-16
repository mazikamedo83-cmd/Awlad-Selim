import React, { useState, useMemo } from 'react';
import { 
  Wallet, Plus, ArrowLeftRight, TrendingDown, TrendingUp, 
  Printer, Download, Search, Check, AlertCircle, Building2, Landmark 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { Cashbox, ExpenseIncomeRecord } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';

export const FinanceView: React.FC = () => {
  const { 
    cashboxes, financialTransactions, expenseIncomes, settings, 
    addCashbox, transferBetweenCashboxes, addExpenseIncome 
  } = useData();

  const [activeTab, setActiveTab] = useState<'cashboxes' | 'transactions' | 'expenses'>('cashboxes');
  const [searchTerm, setSearchTerm] = useState('');

  // Transfer modal
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [fromCbId, setFromCbId] = useState(cashboxes[0]?.id || '');
  const [toCbId, setToCbId] = useState(cashboxes[1]?.id || '');
  const [transferAmount, setTransferAmount] = useState(1000);
  const [transferNotes, setTransferNotes] = useState('');

  // Add Cashbox modal
  const [isAddCashboxOpen, setIsAddCashboxOpen] = useState(false);
  const [newCbName, setNewCbName] = useState('');
  const [newCbType, setNewCbType] = useState<'cashbox' | 'bank'>('cashbox');
  const [newCbAccount, setNewCbAccount] = useState('');
  const [newCbOpening, setNewCbOpening] = useState(0);

  // Expense / Income modal
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [recordType, setRecordType] = useState<'expense' | 'income'>('expense');
  const [category, setCategory] = useState('وقود ونقل وتوزيع');
  const [amount, setAmount] = useState(500);
  const [selectedCashboxId, setSelectedCashboxId] = useState(cashboxes[0]?.id || '');
  const [recipientOrPayer, setRecipientOrPayer] = useState('');
  const [notes, setNotes] = useState('');

  // Print modal
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const totalLiquidity = useMemo(() => {
    return cashboxes.reduce((acc, c) => acc + c.currentBalance, 0);
  }, [cashboxes]);

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await transferBetweenCashboxes(fromCbId, toCbId, transferAmount, transferNotes || 'تحويل مالي بين الخزائن');
    if (!res.success) {
      alert(res.error || 'فشل التحويل');
    } else {
      setIsTransferModalOpen(false);
    }
  };

  const handleAddCashboxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCbName.trim()) return;
    await addCashbox({
      name: newCbName,
      type: newCbType,
      accountNumber: newCbType === 'bank' ? newCbAccount : undefined,
      openingBalance: newCbOpening,
      isDefault: false,
    });
    setIsAddCashboxOpen(false);
    setNewCbName('');
    setNewCbAccount('');
    setNewCbOpening(0);
  };

  const handleAddExpenseIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) return;
    const cb = cashboxes.find(c => c.id === selectedCashboxId);

    await addExpenseIncome({
      type: recordType,
      category,
      amount,
      date: new Date().toISOString().split('T')[0],
      cashboxId: selectedCashboxId,
      cashboxName: cb?.name || '',
      paymentMethod: 'نقدي',
      recipientOrPayer: recipientOrPayer || (recordType === 'expense' ? 'جهة صرف' : 'جهة تحصيل'),
      notes,
    });

    setIsExpenseModalOpen(false);

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
  };

  const filteredTransactions = useMemo(() => {
    return financialTransactions.filter(tx => 
      tx.transactionNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.cashboxName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [financialTransactions, searchTerm]);

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
              setRecordType('expense');
              setIsExpenseModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold transition-all"
          >
            <TrendingDown className="w-4 h-4" />
            <span>سند صرف مصروف</span>
          </button>

          <button
            onClick={() => {
              setRecordType('income');
              setIsExpenseModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-all"
          >
            <TrendingUp className="w-4 h-4" />
            <span>سند قبض إيراد</span>
          </button>

          <button
            onClick={() => setIsTransferModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-bold transition-all shadow-md"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>تحويل بين الخزائن</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 text-xs font-bold gap-4">
        <button
          onClick={() => setActiveTab('cashboxes')}
          className={`pb-2.5 transition-colors border-b-2 ${
            activeTab === 'cashboxes' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          أرصدة الخزائن والبنوك ({cashboxes.length})
        </button>
        <button
          onClick={() => setActiveTab('transactions')}
          className={`pb-2.5 transition-colors border-b-2 ${
            activeTab === 'transactions' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          سجل الحركات المالية اليومية ({financialTransactions.length})
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

      {/* Transfer Modal */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title="تحويل نقدية بين الخزائن والبنوك"
        maxWidth="md"
      >
        <form onSubmit={handleExecuteTransfer} className="space-y-4 text-xs">
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

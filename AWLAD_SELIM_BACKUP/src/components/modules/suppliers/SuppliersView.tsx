import React, { useState, useMemo } from 'react';
import { 
  Truck, Plus, Search, Phone, MapPin, DollarSign, FileText, 
  ArrowUpRight, Printer, Download, Edit, Trash2 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { Supplier } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';

export const SuppliersView: React.FC = () => {
  const { suppliers, invoices, cashboxes, settings, addSupplier, updateSupplier, deleteSupplier, recordSupplierPayment } = useData();

  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  // Statement modal state
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null);

  // Payment modal state
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentCashboxId, setPaymentCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [paymentNotes, setPaymentNotes] = useState<string>('');

  // Print state
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    phone: '',
    address: '',
    notes: '',
    openingBalance: 0,
  });

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(s => 
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.phone.includes(searchTerm) ||
      s.address.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [suppliers, searchTerm]);

  const handleOpenAdd = () => {
    const nextCode = `SUPP-${(suppliers.length + 2001)}`;
    setFormData({
      code: nextCode,
      name: '',
      phone: '',
      address: '',
      notes: '',
      openingBalance: 0,
    });
    setEditingSupplier(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (s: Supplier) => {
    setFormData({
      code: s.code,
      name: s.name,
      phone: s.phone,
      address: s.address,
      notes: s.notes || '',
      openingBalance: s.openingBalance,
    });
    setEditingSupplier(s);
    setIsAddModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    if (editingSupplier) {
      await updateSupplier(editingSupplier.id, {
        name: formData.name,
        phone: formData.phone,
        address: formData.address,
        notes: formData.notes,
      });
    } else {
      await addSupplier({
        code: formData.code,
        name: formData.name,
        phone: formData.phone,
        address: formData.address,
        notes: formData.notes,
        openingBalance: formData.openingBalance,
      });
    }
    setIsAddModalOpen(false);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentSupplier || paymentAmount <= 0) return;

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
      setPaymentSupplier(null);
      setPaymentAmount(0);
      setPaymentNotes('');
    } else {
      alert(res.error || 'تعذر سداد الدفعة');
    }
  };

  // Supplier purchase movements
  const supplierMovements = useMemo(() => {
    if (!statementSupplier) return [];
    return invoices.filter(i => i.supplierId === statementSupplier.id && i.status === 'confirmed');
  }, [statementSupplier, invoices]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">دليل الموردين والمطاحن</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إدارة حسابات ومستحقات شركات ومصانع الأغذية وسداد الدفعات النقدية
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-md shadow-blue-900/20 active:scale-95 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة مورد جديد</span>
        </button>
      </div>

      {/* Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative">
          <input
            type="text"
            placeholder="بحث باسم المورد أو الكود أو رقم الهاتف..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 pr-10 pl-4 text-xs focus:bg-white focus:border-blue-600 outline-hidden"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
        </div>
      </div>

      {/* Grid */}
      {filteredSuppliers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-sm font-bold text-slate-600">لا يوجد موردون مسجلون حالياً</p>
          <p className="text-xs text-slate-400 mt-1">انقر على زر "إضافة مورد جديد" لإضافة أول شركة توريد أو مورد للمنظومة.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filteredSuppliers.map(supp => (
            <div key={supp.id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 text-xs space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-[11px] font-bold text-indigo-900 bg-indigo-50 px-2 py-0.5 rounded-md">
                    {supp.code}
                  </span>
                  <h3 className="text-sm font-black text-slate-900 mt-1">{supp.name}</h3>
                </div>
                <button
                  onClick={() => handleOpenEdit(supp)}
                  className="p-1.5 text-slate-400 hover:text-blue-900 hover:bg-slate-100 rounded-lg"
                >
                  <Edit className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1 text-slate-600">
                <p className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-slate-400" /> {supp.phone}</p>
                <p className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-slate-400" /> {supp.address}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border flex items-center justify-between">
                <span className="font-bold text-slate-600">مستحقات المورد:</span>
                <span className="font-mono font-black text-sm text-purple-800">
                  {supp.currentBalance.toLocaleString()} {settings.currency}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                <button
                  onClick={() => {
                    setPaymentSupplier(supp);
                    setPaymentAmount(supp.currentBalance > 0 ? supp.currentBalance : 0);
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>سداد دفعة</span>
                </button>
                <button
                  onClick={() => setStatementSupplier(supp)}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold"
                >
                  <FileText className="w-4 h-4" />
                  <span>كشف الحساب</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Supplier Statement Modal (Section 5: فواتير المشتريات المرتبطة، مرتجعات المشتريات، المدفوعات، كشف الحساب) */}
      {statementSupplier && (
        <Modal
          isOpen={!!statementSupplier}
          onClose={() => setStatementSupplier(null)}
          title={`كشف حساب المورد: ${statementSupplier.name} (${statementSupplier.code})`}
          subtitle={`الرصيد المستحق الحالي للمورد: ${statementSupplier.currentBalance.toLocaleString()} ${settings.currency}`}
          maxWidth="4xl"
        >
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center gap-3">
                <a
                  href={`tel:${statementSupplier.phone}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg font-mono font-bold border border-emerald-200 hover:bg-emerald-100"
                >
                  <Phone className="w-3.5 h-3.5 text-emerald-600" />
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
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50"
                >
                  <Printer className="w-3.5 h-3.5 text-blue-900" />
                  <span>طباعة كشف الحساب</span>
                </button>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b">
                  <tr>
                    <th className="p-2.5">التاريخ</th>
                    <th className="p-2.5">رقم المستند</th>
                    <th className="p-2.5">نوع المعاملة</th>
                    <th className="p-2.5">البيان</th>
                    <th className="p-2.5 text-center">له / مشتريات (دائن)</th>
                    <th className="p-2.5 text-center">سداد / مرتجع (مدين)</th>
                    <th className="p-2.5 text-center">الرصيد التراكمي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {supplierMovements.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        لا توجد فواتير أو حركات مشتريات مسجلة لهذا المورد بعد. الرصيد الافتتاحي هو: {statementSupplier.openingBalance.toLocaleString()} {settings.currency}
                      </td>
                    </tr>
                  ) : (
                    supplierMovements.map((inv, idx) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono text-slate-600">{inv.date}</td>
                        <td className="p-2.5 font-mono font-bold text-blue-900">{inv.invoiceNumber}</td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 text-[10px] font-bold">
                            فاتورة مشتريات
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-700">توريد بضاعة للمستودع ({inv.warehouseName})</td>
                        <td className="p-2.5 text-center font-mono font-bold text-slate-900">{inv.grandTotal.toLocaleString()}</td>
                        <td className="p-2.5 text-center font-mono font-bold text-emerald-700">{inv.paidAmount.toLocaleString()}</td>
                        <td className="p-2.5 text-center font-mono font-black text-purple-900">{inv.remainingAmount.toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <button
                type="button"
                onClick={() => setStatementSupplier(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl"
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
        <form onSubmit={handleSaveSupplier} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold mb-1">اسم المورد / الشركة:</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full border rounded-xl p-2.5 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">الهاتف:</label>
            <input
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full border rounded-xl p-2.5 font-mono"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">العنوان:</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full border rounded-xl p-2.5"
            />
          </div>
          {!editingSupplier && (
            <div>
              <label className="block font-bold mb-1">رصيد أول المدة المستحق له:</label>
              <input
                type="number"
                value={formData.openingBalance}
                onChange={(e) => setFormData({ ...formData, openingBalance: Number(e.target.value) })}
                className="w-full border rounded-xl p-2.5 font-mono font-bold"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button type="submit" className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold">حفظ المورد</button>
          </div>
        </form>
      </Modal>

      {/* Supplier Payment Modal */}
      {paymentSupplier && (
        <Modal
          isOpen={!!paymentSupplier}
          onClose={() => setPaymentSupplier(null)}
          title={`سداد دفعة للمورد: ${paymentSupplier.name}`}
          maxWidth="md"
        >
          <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold mb-1">المبلغ المسدد ({settings.currency}):</label>
              <input
                type="number"
                min="1"
                required
                value={paymentAmount || ''}
                onChange={(e) => setPaymentAmount(Number(e.target.value))}
                className="w-full border rounded-xl p-2.5 text-center text-purple-900 font-mono font-black text-sm"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">الخزينة أو الحساب المسدد منه:</label>
              <select
                value={paymentCashboxId}
                onChange={(e) => setPaymentCashboxId(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-bold"
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>{cb.name} (رصيدها: {cb.currentBalance})</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setPaymentSupplier(null)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
              <button type="submit" className="px-6 py-2 bg-purple-600 text-white rounded-xl font-bold">تأكيد الصرف</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Print Document Modal */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />
    </div>
  );
};

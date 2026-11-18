import React, { useState, useMemo, useEffect } from 'react';
import { 
  RotateCcw, Plus, Search, Filter, Printer, Download, Eye, 
  AlertCircle, Check, FileText 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { InvoiceReturn, Invoice } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';

export interface ReturnsViewProps {
  initialTypeFilter?: 'all' | 'sales_return' | 'purchase_return';
}

export const ReturnsView: React.FC<ReturnsViewProps> = ({ initialTypeFilter = 'all' }) => {
  const { invoiceReturns, invoices, cashboxes, settings, createReturn } = useData();

  const [returnTypeFilter, setReturnTypeFilter] = useState<'all' | 'sales_return' | 'purchase_return'>(initialTypeFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  useEffect(() => {
    setReturnTypeFilter(initialTypeFilter);
    if (initialTypeFilter === 'sales_return' || initialTypeFilter === 'purchase_return') {
      setReturnType(initialTypeFilter);
    }
  }, [initialTypeFilter]);

  // Print modal
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // New return form
  const [returnType, setReturnType] = useState<'sales_return' | 'purchase_return'>('sales_return');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('عيوب تصنيع / تلف في العبوة');
  const [refundType, setRefundType] = useState<'balance' | 'cash'>('balance');
  const [refundCashboxId, setRefundCashboxId] = useState(cashboxes[0]?.id || '');
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter available invoices according to type
  const availableInvoices = useMemo(() => {
    const invType = returnType === 'sales_return' ? 'sales' : 'purchase';
    return invoices.filter(i => i.type === invType && i.status === 'confirmed');
  }, [invoices, returnType]);

  const selectedInvoice = useMemo(() => {
    return invoices.find(i => i.id === selectedInvoiceId);
  }, [invoices, selectedInvoiceId]);

  // When invoice is chosen, initialize quantities to 0
  const handleSelectInvoice = (id: string) => {
    setSelectedInvoiceId(id);
    const inv = invoices.find(i => i.id === id);
    if (inv) {
      const qMap: Record<string, number> = {};
      inv.items.forEach(it => {
        qMap[it.productId] = 0;
      });
      setReturnQuantities(qMap);
    }
  };

  const filteredReturns = useMemo(() => {
    return invoiceReturns.filter(r => {
      const matchType = returnTypeFilter === 'all' ? true : r.type === returnTypeFilter;
      const matchSearch = 
        r.returnNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.originalInvoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.partyName.toLowerCase().includes(searchTerm.toLowerCase());
      return matchType && matchSearch;
    });
  }, [invoiceReturns, returnTypeFilter, searchTerm]);

  // Calculate return grand total
  const calculatedGrandTotal = useMemo(() => {
    if (!selectedInvoice) return 0;
    let total = 0;
    for (const item of selectedInvoice.items) {
      const q = returnQuantities[item.productId] || 0;
      total += q * item.unitPrice;
    }
    return total;
  }, [selectedInvoice, returnQuantities]);

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) {
      setError('يرجى اختيار الفاتورة الأصلية أولاً');
      return;
    }

    const returnItems = selectedInvoice.items
      .filter(item => (returnQuantities[item.productId] || 0) > 0)
      .map(item => {
        const q = returnQuantities[item.productId] || 0;
        return {
          productId: item.productId,
          productName: item.productName,
          unit: item.unit,
          quantity: q,
          unitPrice: item.unitPrice,
          total: q * item.unitPrice,
        };
      });

    if (returnItems.length === 0) {
      setError('يرجى تحديد كمية أكبر من صفر لصنف واحد على الأقل للمرتجع');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const res = await createReturn({
      type: returnType,
      originalInvoiceId: selectedInvoice.id,
      originalInvoiceNumber: selectedInvoice.invoiceNumber,
      date: returnDate,
      partyId: selectedInvoice.customerId || selectedInvoice.supplierId || '',
      partyName: selectedInvoice.customerName || selectedInvoice.supplierName || 'عام',
      warehouseId: selectedInvoice.warehouseId,
      warehouseName: selectedInvoice.warehouseName,
      items: returnItems,
      grandTotal: calculatedGrandTotal,
      refundType,
      cashboxId: refundType === 'cash' ? refundCashboxId : undefined,
      reason,
      notes: `مرتجع مرتبط بالفاتورة ${selectedInvoice.invoiceNumber}`,
    });

    setIsSubmitting(false);

    if (res.success) {
      setIsNewModalOpen(false);
      setSelectedInvoiceId('');
      setReturnQuantities({});
    } else {
      setError(res.error || 'تعذر تسجيل المرتجع');
    }
  };

  const handlePrintReturn = (ret: InvoiceReturn) => {
    setPrintData({
      title: ret.type === 'sales_return' ? 'سند مرتجع مبيعات' : 'سند مرتجع مشتريات',
      docNumber: ret.returnNumber,
      docType: ret.type === 'sales_return' ? 'مرتجع مبيعات' : 'مرتجع مشتريات',
      date: ret.date,
      partyName: ret.partyName,
      warehouseName: ret.warehouseName,
      grandTotal: ret.grandTotal,
      paidAmount: ret.refundType === 'cash' ? ret.grandTotal : 0,
      paymentType: ret.refundType === 'cash' ? 'رد نقدي فوري' : 'خصم من رصيد الحساب',
      notes: `الفاتورة الأصلية: ${ret.originalInvoiceNumber} | السبب: ${ret.reason}`,
      items: ret.items.map(it => ({
        name: it.productName,
        unit: it.unit,
        quantity: it.quantity,
        price: it.unitPrice,
        total: it.total,
      })),
    });
    setIsPrintModalOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إدارة مرتجعات المبيعات والمشتريات</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ربط المرتجعات بالفاتورة الأصلية والتحقق من عدم تجاوز الكميات وتعديل المخازن والأرصدة
          </p>
        </div>

        <button
          onClick={() => {
            setSelectedInvoiceId('');
            setReturnQuantities({});
            setIsNewModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-md shadow-blue-900/20 active:scale-95 transition-all cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>إنشاء سند مرتجع جديد</span>
        </button>
      </div>

      {/* Filter and Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex-1 min-w-[240px] relative">
          <input
            type="text"
            placeholder="بحث برقم المرتجع، الفاتورة الأصلية، أو الطرف..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2 pr-9 pl-3 text-xs focus:bg-white focus:border-blue-600 outline-hidden"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setReturnTypeFilter('all')}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
              returnTypeFilter === 'all' ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            الكل
          </button>
          <button
            onClick={() => setReturnTypeFilter('sales_return')}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
              returnTypeFilter === 'sales_return' ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            مرتجع مبيعات
          </button>
          <button
            onClick={() => setReturnTypeFilter('purchase_return')}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
              returnTypeFilter === 'purchase_return' ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            مرتجع مشتريات
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-slate-50 font-bold border-b text-slate-700">
              <th className="p-3.5">رقم المرتجع</th>
              <th className="p-3.5">النوع</th>
              <th className="p-3.5">الفاتورة الأصلية</th>
              <th className="p-3.5">التاريخ</th>
              <th className="p-3.5">العميل / المورد</th>
              <th className="p-3.5">المستودع</th>
              <th className="p-3.5 text-center">القيمة الإجمالية</th>
              <th className="p-3.5">طريقة التسوية</th>
              <th className="p-3.5 text-center">طباعة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredReturns.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-400">
                  لا توجد مرتجعات مسجلة حتى الآن
                </td>
              </tr>
            ) : (
              filteredReturns.map(ret => (
                <tr key={ret.id} className="hover:bg-slate-50">
                  <td className="p-3.5 font-mono font-bold text-blue-900">{ret.returnNumber}</td>
                  <td className="p-3.5">
                    {ret.type === 'sales_return' ? (
                      <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-bold text-[10px]">مرتجع مبيعات</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 font-bold text-[10px]">مرتجع مشتريات</span>
                    )}
                  </td>
                  <td className="p-3.5 font-mono text-slate-700">{ret.originalInvoiceNumber}</td>
                  <td className="p-3.5 font-mono text-slate-600">{ret.date}</td>
                  <td className="p-3.5 font-bold text-slate-800">{ret.partyName}</td>
                  <td className="p-3.5 text-slate-600">{ret.warehouseName}</td>
                  <td className="p-3.5 text-center font-black text-slate-900">{ret.grandTotal.toLocaleString()} {settings.currency}</td>
                  <td className="p-3.5">
                    <span className="text-[11px] font-semibold text-slate-700">
                      {ret.refundType === 'balance' ? 'خصم من الرصيد' : 'رد نقدي من الخزينة'}
                    </span>
                  </td>
                  <td className="p-3.5 text-center">
                    <button
                      onClick={() => handlePrintReturn(ret)}
                      className="p-1.5 text-slate-500 hover:text-blue-900"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Return Modal */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="إنشاء سند مرتجع مرتبط بفاتورة"
        maxWidth="4xl"
      >
        <form onSubmit={handleSubmitReturn} className="space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl font-bold">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">نوع المرتجع:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReturnType('sales_return');
                    setSelectedInvoiceId('');
                  }}
                  className={`p-2 rounded-xl font-bold border transition-all ${
                    returnType === 'sales_return' ? 'bg-blue-900 text-white' : 'bg-slate-50'
                  }`}
                >
                  مرتجع مبيعات من عميل
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReturnType('purchase_return');
                    setSelectedInvoiceId('');
                  }}
                  className={`p-2 rounded-xl font-bold border transition-all ${
                    returnType === 'purchase_return' ? 'bg-blue-900 text-white' : 'bg-slate-50'
                  }`}
                >
                  مرتجع مشتريات لمورد
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">تاريخ المرتجع:</label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full border rounded-xl p-2 font-mono font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">اختر الفاتورة الأصلية المراد الإرجاع منها:</label>
            <select
              value={selectedInvoiceId}
              onChange={(e) => handleSelectInvoice(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold bg-white"
            >
              <option value="">-- اختر الفاتورة الأصلية --</option>
              {availableInvoices.map(inv => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} - ({inv.customerName || inv.supplierName}) - الإجمالي: {inv.grandTotal} {settings.currency} بتاريخ {inv.date}
                </option>
              ))}
            </select>
          </div>

          {/* Item Quantities Return Form */}
          {selectedInvoice && (
            <div className="border rounded-xl p-3 bg-slate-50 space-y-2">
              <h4 className="font-bold text-slate-800">الأصناف المتوفرة بالفاتورة الأصلية للإرجاع:</h4>
              <table className="w-full text-right text-xs bg-white rounded-lg border">
                <thead>
                  <tr className="bg-slate-100 border-b">
                    <th className="p-2">الصنف</th>
                    <th className="p-2 text-center">الوحدة</th>
                    <th className="p-2 text-center">الكمية الأصلية</th>
                    <th className="p-2 text-center">السعر</th>
                    <th className="p-2 text-center w-28">الكمية المرتجعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedInvoice.items.map(it => {
                    const alreadyRet = selectedInvoice.returnedQuantityByItem?.[it.productId] || 0;
                    const maxAllowed = it.quantity - alreadyRet;

                    return (
                      <tr key={it.productId}>
                        <td className="p-2 font-bold">{it.productName}</td>
                        <td className="p-2 text-center">{it.unit}</td>
                        <td className="p-2 text-center font-bold">
                          {it.quantity} {alreadyRet > 0 && <span className="text-red-600 text-[10px] block">تم إرجاع {alreadyRet} سابقاً</span>}
                        </td>
                        <td className="p-2 text-center">{it.unitPrice}</td>
                        <td className="p-2 text-center">
                          <input
                            type="number"
                            min="0"
                            max={maxAllowed}
                            value={returnQuantities[it.productId] || 0}
                            onChange={(e) => setReturnQuantities({
                              ...returnQuantities,
                              [it.productId]: Math.min(maxAllowed, Number(e.target.value))
                            })}
                            className="w-20 border rounded-lg p-1 text-center font-mono font-bold"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex justify-between items-center pt-2">
                <span className="font-bold text-slate-700">إجمالي قيمة المرتجع المحتسب:</span>
                <span className="text-sm font-black text-blue-900 font-mono">
                  {calculatedGrandTotal.toFixed(2)} {settings.currency}
                </span>
              </div>
            </div>
          )}

          {/* Refund method */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl">
            <div>
              <label className="block font-bold mb-1">طريقة التسوية المالية:</label>
              <select
                value={refundType}
                onChange={(e) => setRefundType(e.target.value as any)}
                className="w-full bg-white border rounded-xl p-2 font-bold"
              >
                <option value="balance">تعديل وخصم من رصيد الحساب الآجل</option>
                <option value="cash">رد نقدي فوري من الخزينة</option>
              </select>
            </div>
            {refundType === 'cash' && (
              <div>
                <label className="block font-bold mb-1">الخزينة المسدد منها:</label>
                <select
                  value={refundCashboxId}
                  onChange={(e) => setRefundCashboxId(e.target.value)}
                  className="w-full bg-white border rounded-xl p-2 font-bold"
                >
                  {cashboxes.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block font-bold mb-1">سبب المرتجع:</label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border rounded-xl p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsNewModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button type="submit" disabled={isSubmitting || calculatedGrandTotal === 0} className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-950">
              اعتماد المرتجع وتعديل المخزن
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

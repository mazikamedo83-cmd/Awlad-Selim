import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Search, Filter, Printer, Download, Eye, XCircle, 
  CheckCircle, Truck, Trash2, Check, AlertCircle 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { Invoice } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';

export interface PurchaseInvoicesViewProps {
  initialStatusFilter?: 'all' | 'confirmed' | 'draft' | 'cancelled';
  initialOpenNew?: boolean;
}

export const PurchaseInvoicesView: React.FC<PurchaseInvoicesViewProps> = ({
  initialStatusFilter = 'all',
  initialOpenNew = false,
}) => {
  const { 
    invoices, suppliers, products, warehouses, cashboxes, 
    settings, createPurchaseInvoice, cancelInvoice 
  } = useData();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'draft' | 'cancelled'>(initialStatusFilter);
  const [isNewModalOpen, setIsNewModalOpen] = useState(initialOpenNew);
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    if (initialOpenNew) {
      setItems([]);
      setIsNewModalOpen(true);
    }
  }, [initialOpenNew]);

  // New Purchase Form state
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(suppliers[0]?.id || '');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'partial'>('partial');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [discountTotal, setDiscountTotal] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Items
  const [items, setItems] = useState<Array<{
    productId: string;
    productName: string;
    barcode: string;
    unit: string;
    unitFactor: number;
    quantity: number;
    unitPrice: number;
    purchasePriceAtTime: number;
    discount: number;
    total: number;
  }>>([]);

  // Item input
  const [itemProdId, setItemProdId] = useState('');
  const [itemQty, setItemQty] = useState(10);
  const [itemPrice, setItemPrice] = useState(0);

  const purchaseInvoices = useMemo(() => {
    return invoices.filter(i => i.type === 'purchase');
  }, [invoices]);

  const filteredPurchases = useMemo(() => {
    return purchaseInvoices.filter(inv => {
      const matchSearch =
        inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (inv.supplierName && inv.supplierName.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchStatus = statusFilter === 'all' ? true : inv.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [purchaseInvoices, searchTerm, statusFilter]);

  const handleProductPick = (prodId: string) => {
    setItemProdId(prodId);
    const p = products.find(prod => prod.id === prodId);
    if (p) {
      setItemPrice(p.purchasePrice);
    }
  };

  const handleAddItem = () => {
    const prod = products.find(p => p.id === itemProdId);
    if (!prod) return;
    const total = itemQty * itemPrice;

    setItems(prev => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        barcode: prod.barcode,
        unit: prod.baseUnit,
        unitFactor: 1,
        quantity: itemQty,
        unitPrice: itemPrice,
        purchasePriceAtTime: itemPrice,
        discount: 0,
        total,
      }
    ]);
    setItemProdId('');
  };

  const subtotal = useMemo(() => items.reduce((a, b) => a + b.total, 0), [items]);
  const grandTotal = useMemo(() => Math.max(0, subtotal - discountTotal), [subtotal, discountTotal]);
  const remainingAmount = useMemo(() => {
    if (paymentType === 'cash') return 0;
    return Math.max(0, grandTotal - paidAmount);
  }, [grandTotal, paidAmount, paymentType]);

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) {
      setError('يرجى إضافة أصناف لفاتورة الشراء');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    const supp = suppliers.find(s => s.id === selectedSupplierId);
    const wh = warehouses.find(w => w.id === selectedWarehouseId);

    const res = await createPurchaseInvoice({
      date: invoiceDate,
      supplierId: selectedSupplierId,
      supplierName: supp?.name || 'مورد عام',
      warehouseId: selectedWarehouseId,
      warehouseName: wh?.name || 'المستودع الرئيسي',
      items,
      subtotal,
      discountTotal,
      taxTotal: 0,
      grandTotal,
      paidAmount: paymentType === 'cash' ? grandTotal : paidAmount,
      remainingAmount,
      paymentType,
      paymentMethod: 'bank',
      cashboxId: selectedCashboxId,
      status: 'confirmed',
      notes,
    });

    setIsSubmitting(false);

    if (res.success) {
      setIsNewModalOpen(false);
      setItems([]);
      if (res.invoice) {
        handlePrint(res.invoice);
      }
    } else {
      setError(res.error || 'فشل حفظ فاتورة الشراء');
    }
  };

  const handlePrint = (inv: Invoice) => {
    setPrintData({
      title: 'فاتورة مشتريات وتوريد بضائع',
      docNumber: inv.invoiceNumber,
      docType: 'فاتورة مشتريات',
      date: inv.date,
      partyName: inv.supplierName,
      warehouseName: inv.warehouseName,
      grandTotal: inv.grandTotal,
      paidAmount: inv.paidAmount,
      remainingAmount: inv.remainingAmount,
      items: inv.items.map(it => ({
        name: it.productName,
        unit: it.unit,
        quantity: it.quantity,
        price: it.unitPrice,
        total: it.total,
      })),
      notes: inv.notes,
    });
    setIsPrintModalOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إدارة فواتير المشتريات</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            توثيق توريدات البضائع الغذائية من المصانع والمطاحن وزيادة أرصدة المخازن آلياً
          </p>
        </div>

        <button
          onClick={() => {
            setItems([]);
            setIsNewModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-md shadow-blue-900/20 active:scale-95 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>فاتورة شراء جديدة</span>
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3 border-b flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="بحث برقم الفاتورة أو المورد..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full max-w-sm bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:border-blue-600 outline-hidden"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:border-blue-600 outline-hidden"
          >
            <option value="all">-- جميع الحالات --</option>
            <option value="confirmed">فواتير مؤكدة</option>
            <option value="draft">مسودات</option>
            <option value="cancelled">ملغاة / محذوفة</option>
          </select>
        </div>

        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-slate-50 font-bold border-b text-slate-700">
              <th className="p-3">رقم الفاتورة</th>
              <th className="p-3">التاريخ</th>
              <th className="p-3">المورد</th>
              <th className="p-3">المستودع المستلم</th>
              <th className="p-3 text-center">الإجمالي</th>
              <th className="p-3 text-center">المدفوع</th>
              <th className="p-3 text-center">المتبقي للمورد</th>
              <th className="p-3 text-center">طباعة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredPurchases.map(inv => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="p-3 font-mono font-bold text-blue-900">{inv.invoiceNumber}</td>
                <td className="p-3 font-mono text-slate-600">{inv.date}</td>
                <td className="p-3 font-bold text-slate-800">{inv.supplierName}</td>
                <td className="p-3 text-slate-600">{inv.warehouseName}</td>
                <td className="p-3 text-center font-black">{inv.grandTotal.toLocaleString()} {settings.currency}</td>
                <td className="p-3 text-center text-emerald-700 font-bold">{inv.paidAmount.toLocaleString()}</td>
                <td className="p-3 text-center text-red-700 font-bold">{inv.remainingAmount.toLocaleString()}</td>
                <td className="p-3 text-center">
                  <button
                    onClick={() => handlePrint(inv)}
                    className="p-1.5 text-slate-500 hover:text-blue-900"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Purchase Invoice Modal */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="إنشاء فاتورة مشتريات وتوريد جديدة"
        maxWidth="4xl"
      >
        <form onSubmit={handleCreatePurchase} className="space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl font-bold">{error}</div>
          )}

          <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3 rounded-xl">
            <div>
              <label className="block font-bold mb-1">المورد:</label>
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold"
              >
                {suppliers.length === 0 ? (
                  <option value="">-- لا يوجد موردين مسجلين بعد --</option>
                ) : (
                  suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">المستودع المستلم:</label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold"
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">التاريخ:</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 font-mono font-bold"
              />
            </div>
          </div>

          {/* Add product to purchase */}
          <div className="flex gap-2 items-end bg-blue-50/60 p-3 rounded-xl border border-blue-200">
            <div className="flex-1">
              <label className="block font-bold text-slate-700 mb-1">اختر السلعة المشتراة:</label>
              <select
                value={itemProdId}
                onChange={(e) => handleProductPick(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold"
              >
                <option value="">-- اختر الصنف --</option>
                {products.length === 0 ? (
                  <option value="" disabled>-- لا توجد أصناف بالمخزن بعد (يرجى إضافة صنف أولاً) --</option>
                ) : (
                  products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                  ))
                )}
              </select>
            </div>
            <div className="w-24">
              <label className="block font-bold text-slate-700 mb-1">الكمية:</label>
              <input
                type="number"
                min="1"
                value={itemQty}
                onChange={(e) => setItemQty(Number(e.target.value))}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 text-center font-mono font-bold"
              />
            </div>
            <div className="w-28">
              <label className="block font-bold text-slate-700 mb-1">سعر الشراء:</label>
              <input
                type="number"
                step="0.5"
                value={itemPrice}
                onChange={(e) => setItemPrice(Number(e.target.value))}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 text-center font-mono font-bold"
              />
            </div>
            <button
              type="button"
              onClick={handleAddItem}
              className="px-4 py-2 bg-blue-900 text-white rounded-xl font-bold"
            >
              إضافة
            </button>
          </div>

          {/* Items list */}
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-right">
              <thead>
                <tr className="bg-slate-100 font-bold border-b">
                  <th className="p-2">الصنف</th>
                  <th className="p-2 text-center">الكمية</th>
                  <th className="p-2 text-center">سعر الشراء</th>
                  <th className="p-2 text-center">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="p-2 font-bold">{it.productName}</td>
                    <td className="p-2 text-center font-bold">{it.quantity}</td>
                    <td className="p-2 text-center">{it.unitPrice}</td>
                    <td className="p-2 text-center font-bold text-blue-900">{it.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Payment & Totals */}
          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-xl">
            <div className="space-y-2">
              <label className="block font-bold">الخزينة المسدد منها:</label>
              <select
                value={selectedCashboxId}
                onChange={(e) => setSelectedCashboxId(e.target.value)}
                className="w-full bg-white border rounded-xl p-2 font-bold"
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>{cb.name} ({cb.currentBalance})</option>
                ))}
              </select>
              <div>
                <label className="block font-bold mb-1">المدفوع نقداً للمورد:</label>
                <input
                  type="number"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(Number(e.target.value))}
                  className="w-full bg-white border rounded-xl p-2 font-mono font-bold"
                />
              </div>
            </div>

            <div className="bg-white p-3 rounded-xl border space-y-1.5 font-bold">
              <div className="flex justify-between"><span>الإجمالي:</span><span>{grandTotal} {settings.currency}</span></div>
              <div className="flex justify-between text-emerald-700"><span>المدفوع:</span><span>{paidAmount}</span></div>
              <div className="flex justify-between text-red-700 border-t pt-1"><span>المتبقي للمورد:</span><span>{remainingAmount} {settings.currency}</span></div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={() => setIsNewModalOpen(false)}
              className="px-4 py-2 border rounded-xl font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || items.length === 0}
              className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-950"
            >
              اعتماد فاتورة المشتريات
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

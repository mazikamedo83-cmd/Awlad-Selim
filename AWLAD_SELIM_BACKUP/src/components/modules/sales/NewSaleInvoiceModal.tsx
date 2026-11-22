import React, { useState, useMemo } from 'react';
import { 
  Plus, Trash2, Search, Barcode, Printer, Save, Check, 
  AlertCircle, History, Info, ChevronDown 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { Product, Customer, InvoiceItem } from '../../../types';
import { Modal } from '../../common/Modal';

interface NewSaleInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoiceCreated?: (invoice: any) => void;
}

export const NewSaleInvoiceModal: React.FC<NewSaleInvoiceModalProps> = ({
  isOpen,
  onClose,
  onInvoiceCreated,
}) => {
  const { 
    products, customers, warehouses, representatives, cashboxes, 
    settings, createSalesInvoice 
  } = useData();
  const { currentUser } = useAuth();

  // Form states
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(warehouses[0]?.id || 'WH-01');
  const [selectedRepId, setSelectedRepId] = useState<string>(representatives[0]?.id || '');
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>(cashboxes[0]?.id || 'CASH-01');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [discountTotal, setDiscountTotal] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invoice Items
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

  // Product selector inputs
  const [productSearch, setProductSearch] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedUnitName, setSelectedUnitName] = useState<string>('');
  const [inputQuantity, setInputQuantity] = useState<number>(1);
  const [inputUnitPrice, setInputUnitPrice] = useState<number>(0);

  // Selected customer object
  const selectedCustomer = useMemo(() => {
    return customers.find(c => c.id === selectedCustomerId);
  }, [customers, selectedCustomerId]);

  // Selected product object
  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === selectedProductId);
  }, [products, selectedProductId]);

  // CRITICAL SPEC REQUIREMENT 7:
  // "When selecting a customer and product inside a sales invoice:
  // - Display the last three actual prices at which that specific customer purchased that specific product.
  // - Display them from oldest to newest.
  // - The product's default selling price remains the default invoice price.
  // - Previous prices are for reference only. Never automatically replace the current product price with an old price.
  // - Authorized users can manually adjust the selling price."
  const lastThreePrices = useMemo(() => {
    if (!selectedCustomer || !selectedProductId) return [];
    const history = selectedCustomer.priceHistory?.[selectedProductId];
    if (!history || !Array.isArray(history)) return [];
    // Oldest to newest:
    return history.slice(-3);
  }, [selectedCustomer, selectedProductId]);

  // When a product is selected, set default unit and default product selling price
  const handleProductSelect = (prodId: string) => {
    setSelectedProductId(prodId);
    const prod = products.find(p => p.id === prodId);
    if (prod) {
      // Default to first additional unit (e.g. كرتونة) if exists, else base unit
      if (prod.units && prod.units.length > 0) {
        const u = prod.units[0];
        setSelectedUnitName(u.name);
        setInputUnitPrice(u.sellingPrice);
      } else {
        setSelectedUnitName(prod.baseUnit);
        setInputUnitPrice(prod.sellingPrice);
      }
      setInputQuantity(1);
    }
  };

  // When unit is changed, update price accordingly
  const handleUnitChange = (unitName: string) => {
    setSelectedUnitName(unitName);
    if (!selectedProduct) return;

    if (unitName === selectedProduct.baseUnit) {
      setInputUnitPrice(selectedProduct.sellingPrice);
    } else {
      const foundUnit = selectedProduct.units.find(u => u.name === unitName);
      if (foundUnit) {
        setInputUnitPrice(foundUnit.sellingPrice);
      }
    }
  };

  // Barcode rapid scan handler
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const barcode = barcodeInput.trim();
    const prod = products.find(p => p.barcode === barcode || p.code === barcode || p.units.some(u => u.barcode === barcode));

    if (prod) {
      handleProductSelect(prod.id);
      setBarcodeInput('');
    } else {
      setError(`لم يتم العثور على صنف بالباركود أو الكود: ${barcode}`);
    }
  };

  // Add Item to table
  const handleAddItem = () => {
    if (!selectedProduct) {
      setError('يرجى اختيار صنف أولاً');
      return;
    }
    if (inputQuantity <= 0) {
      setError('يرجى إدخال كمية صحيحة أكبر من صفر');
      return;
    }
    if (inputUnitPrice < 0) {
      setError('سعر البيع لا يمكن أن يكون سالباً');
      return;
    }

    // Determine unit factor
    let unitFactor = 1;
    let purchasePriceAtTime = selectedProduct.purchasePrice;

    if (selectedUnitName !== selectedProduct.baseUnit) {
      const u = selectedProduct.units.find(un => un.name === selectedUnitName);
      if (u) {
        unitFactor = u.conversionFactor;
        purchasePriceAtTime = u.purchasePrice || (selectedProduct.purchasePrice * unitFactor);
      }
    }

    // Check stock available in warehouse
    const availInWh = selectedProduct.stockPerWarehouse[selectedWarehouseId] || 0;
    const reqBase = inputQuantity * unitFactor;
    if (availInWh < reqBase && !settings.allowNegativeStock) {
      setError(`الكمية المتاحة بالمستودع من (${selectedProduct.name}) هي ${availInWh} ${selectedProduct.baseUnit}، وهي غير كافية.`);
      return;
    }

    const itemTotal = (inputQuantity * inputUnitPrice);

    setItems(prev => [
      ...prev,
      {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        barcode: selectedProduct.barcode,
        unit: selectedUnitName,
        unitFactor,
        quantity: inputQuantity,
        unitPrice: inputUnitPrice,
        purchasePriceAtTime,
        discount: 0,
        total: itemTotal,
      }
    ]);

    // Reset picker
    setSelectedProductId('');
    setInputQuantity(1);
    setInputUnitPrice(0);
    setError(null);
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  // Calculations
  const subtotal = useMemo(() => {
    return items.reduce((acc, it) => acc + it.total, 0);
  }, [items]);

  const grandTotal = useMemo(() => {
    return Math.max(0, subtotal - discountTotal);
  }, [subtotal, discountTotal]);

  const remainingAmount = useMemo(() => {
    if (paymentType === 'cash') return 0;
    return Math.max(0, grandTotal - paidAmount);
  }, [grandTotal, paidAmount, paymentType]);

  // Adjust paid amount automatically if cash
  React.useEffect(() => {
    if (paymentType === 'cash') {
      setPaidAmount(grandTotal);
    } else if (paymentType === 'credit') {
      setPaidAmount(0);
    }
  }, [paymentType, grandTotal]);

  const handleSubmitInvoice = async () => {
    if (items.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل للفاتورة');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    const wh = warehouses.find(w => w.id === selectedWarehouseId);
    const rep = representatives.find(r => r.id === selectedRepId);

    const res = await createSalesInvoice({
      date: invoiceDate,
      customerId: selectedCustomerId || undefined,
      customerName: selectedCustomer?.name || 'عميل نقدي / عام',
      representativeId: selectedRepId || undefined,
      representativeName: rep?.name,
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
      paymentMethod: 'cash',
      cashboxId: selectedCashboxId,
      status: 'confirmed',
      notes,
    });

    setIsSubmitting(false);

    if (res.success) {
      if (onInvoiceCreated) {
        onInvoiceCreated(res.invoice);
      }
      onClose();
    } else {
      setError(res.error || 'حدث خطأ أثناء حفظ الفاتورة');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="إنشاء فاتورة مبيعات جديدة"
      subtitle="إصدار فاتورة بيع وتحديث المخازن وحسابات العملاء والخزينة آلياً"
      maxWidth="6xl"
    >
      <div className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Top Controls: Customer, Warehouse, Rep, Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
          {/* Customer */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">العميل:</label>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:border-blue-600 outline-hidden"
            >
              <option value="">-- عميل نقدي عام --</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.currentBalance > 0 ? `عليه: ${c.currentBalance}` : `رصيد: ${c.currentBalance}`})
                </option>
              ))}
            </select>
          </div>

          {/* Warehouse */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">المستودع المصروف منه:</label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:border-blue-600 outline-hidden"
            >
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          {/* Representative */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">المندوب المسؤول:</label>
            <select
              value={selectedRepId}
              onChange={(e) => setSelectedRepId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:border-blue-600 outline-hidden"
            >
              <option value="">-- بيع مباشر من المركز --</option>
              {representatives.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">تاريخ الفاتورة:</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-semibold focus:border-blue-600 outline-hidden"
            />
          </div>
        </div>

        {/* Product Picker & Barcode & Customer Price History Box */}
        <div className="bg-blue-50/50 border border-blue-200 rounded-2xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {/* Barcode Fast Scanner */}
            <form onSubmit={handleBarcodeSubmit} className="w-full sm:w-64">
              <div className="relative">
                <input
                  type="text"
                  placeholder="امسح الباركود أو الكود..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  className="w-full bg-white border border-blue-300 rounded-xl py-2 pr-9 pl-3 text-xs font-mono focus:border-blue-700 outline-hidden"
                />
                <Barcode className="w-4 h-4 text-blue-600 absolute right-2.5 top-2.5" />
              </div>
            </form>

            {/* Product Dropdown / Search */}
            <div className="flex-1 w-full">
              <select
                value={selectedProductId}
                onChange={(e) => handleProductSelect(e.target.value)}
                className="w-full bg-white border border-blue-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:border-blue-700 outline-hidden"
              >
                <option value="">-- اختر السلعة الغذائية من القائمة --</option>
                {products.map(p => {
                  const stockInWh = p.stockPerWarehouse[selectedWarehouseId] || 0;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} [{p.category}] - الرصيد: {stockInWh} {p.baseUnit} - السعر الافتراضي: {p.sellingPrice} {settings.currency}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* SPEC REQUIREMENT 7: Customer Last Three Selling Prices Display */}
          {selectedProduct && selectedCustomer && (
            <div className="bg-white rounded-xl p-3 border border-blue-200 text-xs flex flex-wrap items-center justify-between gap-2 shadow-xs">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-blue-700 shrink-0" />
                <span className="font-bold text-slate-800">
                  سجل آخر 3 أسعار بيع فعلية لهذا العميل ({selectedCustomer.name}) للصنف ({selectedProduct.name}):
                </span>
              </div>

              <div className="flex items-center gap-2">
                {lastThreePrices.length > 0 ? (
                  lastThreePrices.map((price, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setInputUnitPrice(price)}
                      title="انقر لنسخ هذا السعر السابق للاسترشاد"
                      className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-300 font-mono font-bold text-xs transition-colors"
                    >
                      {price} {settings.currency} <span className="text-[10px] text-slate-500 font-sans">({idx === 0 ? 'أقدم' : idx === lastThreePrices.length - 1 ? 'أحدث' : 'سابق'})</span>
                    </button>
                  ))
                ) : (
                  <span className="text-slate-500 italic text-[11px]">
                    لا توجد عمليات شراء سابقة لهذا العميل بهذا الصنف (السعر الافتراضي هو المطبق)
                  </span>
                )}
                <span className="text-[10px] text-slate-400 border-r border-slate-300 pr-2">
                  * السعر الافتراضي للمنتج يبقى هو المعتمد أولياً
                </span>
              </div>
            </div>
          )}

          {/* Unit, Quantity, Price, and Add Button */}
          {selectedProduct && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-blue-100 text-xs">
              {/* Unit selector */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">وحدة البيع:</label>
                <select
                  value={selectedUnitName}
                  onChange={(e) => handleUnitChange(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold outline-hidden"
                >
                  {/* Additional packaging units (e.g. كرتونة، شيكارة) */}
                  {selectedProduct.units.map(u => (
                    <option key={u.id} value={u.name}>
                      {u.name} (تحتوي {u.conversionFactor} {selectedProduct.baseUnit})
                    </option>
                  ))}
                  {/* Base unit */}
                  <option value={selectedProduct.baseUnit}>
                    {selectedProduct.baseUnit} (فردي أساسي)
                  </option>
                </select>
              </div>

              {/* Quantity */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">الكمية:</label>
                <input
                  type="number"
                  min="1"
                  value={inputQuantity}
                  onChange={(e) => setInputQuantity(Number(e.target.value))}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-center font-mono outline-hidden"
                />
              </div>

              {/* Unit Price (Editable by user) */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">سعر الوحدة:</label>
                <input
                  type="number"
                  step="0.5"
                  value={inputUnitPrice}
                  onChange={(e) => setInputUnitPrice(Number(e.target.value))}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-black text-center text-blue-900 font-mono outline-hidden"
                />
              </div>

              {/* Add item button */}
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-bold shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة للصنف بالفاتورة</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Invoice Items Table */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="p-3 w-10 text-center">#</th>
                <th className="p-3">اسم الصنف</th>
                <th className="p-3 text-center">الوحدة</th>
                <th className="p-3 text-center">الكمية</th>
                <th className="p-3 text-center">سعر الوحدة</th>
                <th className="p-3 text-center">الإجمالي</th>
                <th className="p-3 text-center w-12">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    لم يتم إضافة أصناف إلى الفاتورة بعد. استخدم البحث أو قارئ الباركود أعلاه لإضافة سلع.
                  </td>
                </tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 text-center font-bold text-slate-400">{idx + 1}</td>
                    <td className="p-3 font-bold text-slate-800">{it.productName}</td>
                    <td className="p-3 text-center text-slate-600">{it.unit}</td>
                    <td className="p-3 text-center font-bold font-mono text-sm">{it.quantity}</td>
                    <td className="p-3 text-center font-bold font-mono">{it.unitPrice.toFixed(2)}</td>
                    <td className="p-3 text-center font-black font-mono text-blue-950 text-sm">
                      {it.total.toFixed(2)} {settings.currency}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="text-red-500 hover:text-red-700 p-1 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Invoice Summary and Payment Config */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-slate-50 p-5 rounded-2xl border border-slate-200 text-xs">
          {/* Notes and Payment Method */}
          <div className="space-y-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">نوع السداد:</label>
              <div className="grid grid-cols-3 gap-2 font-bold">
                <button
                  type="button"
                  onClick={() => setPaymentType('cash')}
                  className={`p-2 rounded-xl border text-center transition-all ${
                    paymentType === 'cash' ? 'bg-blue-900 text-white border-blue-900 shadow-xs' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  نقدي كامل
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('credit')}
                  className={`p-2 rounded-xl border text-center transition-all ${
                    paymentType === 'credit' ? 'bg-blue-900 text-white border-blue-900 shadow-xs' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  آجل بالكامل
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('partial')}
                  className={`p-2 rounded-xl border text-center transition-all ${
                    paymentType === 'partial' ? 'bg-blue-900 text-white border-blue-900 shadow-xs' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  دفعة نقدية + آجل
                </button>
              </div>
            </div>

            {/* Target Cashbox for payment */}
            {paymentType !== 'credit' && (
              <div>
                <label className="block font-bold text-slate-700 mb-1">الخزينة المودع بها المبلغ:</label>
                <select
                  value={selectedCashboxId}
                  onChange={(e) => setSelectedCashboxId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:border-blue-600 outline-hidden"
                >
                  {cashboxes.map(cb => (
                    <option key={cb.id} value={cb.id}>
                      {cb.name} (رصيدها الحالي: {cb.currentBalance} {settings.currency})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">ملاحظات الفاتورة:</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أدخل أي ملاحظات خاصة بالتسليم أو الدفع..."
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-xs outline-hidden focus:border-blue-600"
              />
            </div>
          </div>

          {/* Totals Breakdown */}
          <div className="space-y-2.5 bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex justify-between text-slate-600 font-bold">
              <span>المجموع الفرعي:</span>
              <span className="font-mono text-sm">{subtotal.toFixed(2)} {settings.currency}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-600 font-bold">خصم إضافي:</span>
              <div className="w-32">
                <input
                  type="number"
                  min="0"
                  value={discountTotal}
                  onChange={(e) => setDiscountTotal(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-center font-mono font-bold text-red-600 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-between text-base font-black text-blue-950 pt-2 border-t border-slate-200">
              <span>صافي الفاتورة الإجمالي:</span>
              <span className="font-mono">{grandTotal.toFixed(2)} {settings.currency}</span>
            </div>

            {paymentType === 'partial' && (
              <div className="flex items-center justify-between pt-1">
                <span className="font-bold text-emerald-700">المدفوع نقداً:</span>
                <div className="w-32">
                  <input
                    type="number"
                    min="0"
                    max={grandTotal}
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                    className="w-full bg-emerald-50 border border-emerald-300 rounded-lg px-2 py-1 text-center font-mono font-bold text-emerald-800 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-between text-sm font-bold text-red-600 pt-1">
              <span>المتبقي في ذمة العميل (آجل):</span>
              <span className="font-mono">{remainingAmount.toFixed(2)} {settings.currency}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-100 transition-colors"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={handleSubmitInvoice}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-lg shadow-blue-900/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>{isSubmitting ? 'جاري الاعتماد...' : 'اعتماد وحفظ فاتورة المبيعات'}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};

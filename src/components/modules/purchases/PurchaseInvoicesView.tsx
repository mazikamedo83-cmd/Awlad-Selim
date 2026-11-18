import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Printer, Trash2, Save, CheckCircle2, XCircle
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { Invoice } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { QuantityInput } from '../../common/QuantityInput';
import { computeLineTotal } from '../../../utils/quantity';

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
  const { registerHandler } = useShortcuts();

  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'draft' | 'cancelled'>(initialStatusFilter);
  const [isNewModalOpen, setIsNewModalOpen] = useState(initialOpenNew);
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    if (initialOpenNew) {
      setItems([]);
      setError(null);
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

  // Sync defaults when lists load asynchronously
  useEffect(() => {
    if (!suppliers.some((s) => s.id === selectedSupplierId) && suppliers[0]?.id) {
      setSelectedSupplierId(suppliers[0].id);
    }
  }, [suppliers, selectedSupplierId]);

  useEffect(() => {
    if (!warehouses.some((w) => w.id === selectedWarehouseId) && warehouses[0]?.id) {
      setSelectedWarehouseId(warehouses[0].id);
    }
  }, [warehouses, selectedWarehouseId]);

  useEffect(() => {
    if (!cashboxes.some((c) => c.id === selectedCashboxId) && cashboxes[0]?.id) {
      setSelectedCashboxId(cashboxes[0].id);
    }
  }, [cashboxes, selectedCashboxId]);

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
  const [itemQty, setItemQty] = useState(1);
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
      setItemQty(1);
    }
  };

  const handleAddItem = () => {
    const prod = products.find(p => p.id === itemProdId);
    if (!prod) {
      setError('يرجى اختيار الصنف أولاً');
      return;
    }
    if (itemQty <= 0) {
      setError('يرجى إدخال كمية صحيحة أكبر من صفر');
      return;
    }
    const total = computeLineTotal(itemQty, itemPrice);

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
    setItemQty(1);
    setItemPrice(0);
    setError(null);
    window.setTimeout(() => {
      productSearchRef.current?.focus();
    }, 30);
  };

  const subtotal = useMemo(() => items.reduce((a, b) => a + b.total, 0), [items]);
  const grandTotal = useMemo(() => Math.max(0, subtotal - discountTotal), [subtotal, discountTotal]);

  useEffect(() => {
    if (paymentType === 'cash') {
      setPaidAmount(grandTotal);
    } else if (paymentType === 'credit') {
      setPaidAmount(0);
    }
  }, [paymentType, grandTotal]);

  const remainingAmount = useMemo(() => {
    if (paymentType === 'cash') return 0;
    return Math.max(0, grandTotal - paidAmount);
  }, [grandTotal, paidAmount, paymentType]);

  const handlePrint = useCallback((inv: Invoice) => {
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
  }, []);

  const handleSubmitPurchase = useCallback(async (shouldPrint: boolean) => {
    if (isSubmitting) return;
    if (items.length === 0) {
      setError('يرجى إضافة أصناف لفاتورة الشراء');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      const supp = suppliers.find(s => s.id === selectedSupplierId);
      const wh = warehouses.find(w => w.id === selectedWarehouseId);
      const rawPaid = Number(paidAmount) || 0;
      if (paymentType === 'partial' && rawPaid < 0) {
        setError('المبلغ المدفوع لا يمكن أن يكون سالباً');
        return;
      }

      const effectivePaid = paymentType === 'cash' ? grandTotal : paymentType === 'credit' ? 0 : Math.min(grandTotal, rawPaid);

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
        paidAmount: effectivePaid,
        remainingAmount: Math.max(0, grandTotal - effectivePaid),
        paymentType,
        paymentMethod: 'bank',
        cashboxId: selectedCashboxId,
        status: 'confirmed',
        notes,
      });

      if (res.success) {
        setIsNewModalOpen(false);
        setItems([]);
        setDiscountTotal(0);
        setNotes('');
        setActionMessage({
          type: 'success',
          text: `تم حفظ فاتورة المشتريات رقم (${res.invoice?.invoiceNumber || ''}) وتحديث المخزون بنجاح.`,
        });
        if (shouldPrint && res.invoice) {
          handlePrint(res.invoice);
        }
      } else {
        setError(res.error || 'فشل حفظ فاتورة الشراء');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting, items, suppliers, selectedSupplierId, warehouses, selectedWarehouseId, paymentType, grandTotal,
    paidAmount, createPurchaseInvoice, invoiceDate, subtotal, discountTotal, selectedCashboxId,
    notes, handlePrint
  ]);

  const submitPurchaseRef = useRef(handleSubmitPurchase);
  submitPurchaseRef.current = handleSubmitPurchase;

  useEffect(() => {
    if (!isNewModalOpen) return;
    const u1 = registerHandler('action:save_invoice', () => {
      submitPurchaseRef.current(false);
    });
    const u2 = registerHandler('action:focus_product_search', () => {
      productSearchRef.current?.focus();
    });
    return () => {
      u1();
      u2();
    };
  }, [isNewModalOpen, registerHandler]);

  const handleConfirmCancelPurchase = async (reason?: string) => {
    if (!cancelTarget || !reason) return;
    setIsCancelling(true);
    const res = await cancelInvoice(cancelTarget.id, reason);
    setIsCancelling(false);
    if (!res.success) {
      setActionMessage({ type: 'error', text: res.error || 'تعذر إلغاء فاتورة الشراء' });
    } else {
      setActionMessage({ type: 'success', text: `تم إلغاء فاتورة الشراء (${cancelTarget.invoiceNumber}) بنجاح.` });
      setCancelTarget(null);
    }
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
            setError(null);
            setIsNewModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-md shadow-blue-900/20 active:scale-95 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>فاتورة شراء جديدة</span>
        </button>
      </div>

      {actionMessage && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionMessage.text}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="text-xs underline cursor-pointer">
            إغلاق
          </button>
        </div>
      )}

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

        <div className="overflow-x-auto">
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
                <th className="p-3 text-center">الحالة</th>
                <th className="p-3 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    لا توجد فواتير مشتريات مسجلة
                  </td>
                </tr>
              ) : (
                filteredPurchases.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-blue-900">{inv.invoiceNumber}</td>
                    <td className="p-3 font-mono text-slate-600">{inv.date}</td>
                    <td className="p-3 font-bold text-slate-800">{inv.supplierName}</td>
                    <td className="p-3 text-slate-600">{inv.warehouseName}</td>
                    <td className="p-3 text-center font-black">{inv.grandTotal.toLocaleString()} {settings.currency}</td>
                    <td className="p-3 text-center text-emerald-700 font-bold">{inv.paidAmount.toLocaleString()}</td>
                    <td className="p-3 text-center text-red-700 font-bold">{inv.remainingAmount.toLocaleString()}</td>
                    <td className="p-3 text-center">
                      {inv.status === 'cancelled' ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[10px] font-bold">ملغاة</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">مؤكدة</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handlePrint(inv)}
                          className="p-1.5 text-slate-500 hover:text-blue-900 hover:bg-blue-50 rounded-lg cursor-pointer"
                          title="طباعة الفاتورة"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        {inv.status !== 'cancelled' && (
                          <button
                            onClick={() => setCancelTarget(inv)}
                            className="p-1.5 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                            title="إلغاء فاتورة الشراء"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Purchase Invoice Modal */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="إنشاء فاتورة مشتريات وتوريد جديدة"
        maxWidth="4xl"
      >
        <div className="space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl font-bold">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-xl">
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

          {/* Add product to purchase using instant search */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end bg-blue-50/60 p-3 rounded-xl border border-blue-200">
            <div className="sm:col-span-6">
              <label className="block font-bold text-slate-700 mb-1">ابحث واختر السلعة المشتراة:</label>
              <ProductSearchSelect
                products={products}
                selectedProductId={itemProdId}
                warehouseId={selectedWarehouseId}
                warehouses={warehouses}
                priceMode="purchase"
                currency={settings.currency}
                inputRef={productSearchRef}
                placeholder="ابحث بالاسم أو الكود أو الباركود..."
                onSelect={(prod) => handleProductPick(prod.id)}
                onAfterSelect={() => {
                  qtyInputRef.current?.focus();
                  qtyInputRef.current?.select();
                }}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">الكمية:</label>
              <QuantityInput
                inputRef={qtyInputRef}
                allowDecimals
                min={0.001}
                value={itemQty}
                onChange={setItemQty}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddItem();
                  }
                }}
                ariaLabel="كمية الشراء"
                inputClassName="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-center font-mono font-bold outline-hidden focus:border-blue-700"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">سعر الشراء:</label>
              <input
                type="number"
                step="0.5"
                value={itemPrice}
                onChange={(e) => setItemPrice(Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddItem();
                  }
                }}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-center font-mono font-bold"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={handleAddItem}
                className="w-full py-2.5 px-3 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-bold cursor-pointer"
              >
                + إضافة
              </button>
            </div>
          </div>

          {/* Items list */}
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-right">
              <thead>
                <tr className="bg-slate-100 font-bold border-b">
                  <th className="p-2.5">الصنف</th>
                  <th className="p-2.5 text-center">الكمية</th>
                  <th className="p-2.5 text-center">سعر الشراء</th>
                  <th className="p-2.5 text-center">الإجمالي</th>
                  <th className="p-2.5 text-center w-12">حذف</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      لم تتم إضافة أصناف بعد. ابحث عن صنف أعلاه لإضافته.
                    </td>
                  </tr>
                ) : (
                  items.map((it, i) => (
                    <tr key={i}>
                      <td className="p-2 font-bold">{it.productName}</td>
                      <td className="p-2 text-center">
                        <QuantityInput
                          allowDecimals
                          min={0.001}
                          value={it.quantity}
                          onChange={(q) => {
                            setItems((prev) =>
                              prev.map((row, idx) =>
                                idx === i
                                  ? { ...row, quantity: q, total: computeLineTotal(q, row.unitPrice, row.discount || 0) }
                                  : row
                              )
                            );
                          }}
                          ariaLabel={`كمية ${it.productName}`}
                          inputClassName="w-20 border rounded-lg px-2 py-1 text-center font-mono font-bold outline-hidden focus:border-blue-700"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={it.unitPrice}
                          onChange={(e) => {
                            const p = Math.max(0, Number(e.target.value));
                            setItems((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, unitPrice: p, purchasePriceAtTime: p, total: row.quantity * p } : row
                              )
                            );
                          }}
                          className="w-24 border rounded-lg px-2 py-1 text-center font-mono font-bold"
                        />
                      </td>
                      <td className="p-2 text-center font-bold text-blue-900">{it.total.toLocaleString()}</td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                          className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer"
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

          {/* Payment & Totals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3 rounded-xl">
            <div className="space-y-2.5">
              <div>
                <label className="block font-bold mb-1">طريقة السداد للمورد:</label>
                <div className="grid grid-cols-3 gap-1.5 font-bold">
                  <button
                    type="button"
                    onClick={() => setPaymentType('cash')}
                    className={`p-2 rounded-xl border ${paymentType === 'cash' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-700 border-slate-300'}`}
                  >
                    نقدي كامل
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('credit')}
                    className={`p-2 rounded-xl border ${paymentType === 'credit' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-700 border-slate-300'}`}
                  >
                    آجل بالكامل
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('partial')}
                    className={`p-2 rounded-xl border ${paymentType === 'partial' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-700 border-slate-300'}`}
                  >
                    دفعة + آجل
                  </button>
                </div>
              </div>

              {paymentType !== 'credit' && (
                <div>
                  <label className="block font-bold mb-1">الخزينة المسدد منها:</label>
                  <select
                    value={selectedCashboxId}
                    onChange={(e) => setSelectedCashboxId(e.target.value)}
                    className="w-full bg-white border rounded-xl p-2 font-bold"
                  >
                    {cashboxes.map(cb => (
                      <option key={cb.id} value={cb.id}>{cb.name} ({cb.currentBalance})</option>
                    ))}
                  </select>
                </div>
              )}

              {paymentType === 'partial' && (
                <div>
                  <label className="block font-bold mb-1">المدفوع نقداً للمورد:</label>
                  <input
                    type="number"
                    min="0"
                    max={grandTotal}
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                    className="w-full bg-white border rounded-xl p-2 font-mono font-bold"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold mb-1">ملاحظات الفاتورة:</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="رقم بوليصة التوريد أو ملاحظات..."
                  className="w-full bg-white border rounded-xl p-2"
                />
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border space-y-2 font-bold">
              <div className="flex justify-between">
                <span>المجموع الفرعي:</span>
                <span>{subtotal.toLocaleString()} {settings.currency}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>الخصم المكتسب:</span>
                <input
                  type="number"
                  min="0"
                  value={discountTotal}
                  onChange={(e) => setDiscountTotal(Math.max(0, Number(e.target.value)))}
                  className="w-24 border rounded-lg px-2 py-1 text-center font-mono text-red-600"
                />
              </div>
              <div className="flex justify-between text-base font-black text-blue-950 border-t pt-1.5">
                <span>الإجمالي الصافي:</span>
                <span>{grandTotal.toLocaleString()} {settings.currency}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>المدفوع:</span>
                <span>{paidAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-red-700 border-t pt-1">
                <span>المتبقي للمورد:</span>
                <span>{remainingAmount.toLocaleString()} {settings.currency}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t">
            <button
              type="button"
              onClick={() => setIsNewModalOpen(false)}
              className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isSubmitting || items.length === 0}
                onClick={() => handleSubmitPurchase(false)}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{isSubmitting ? 'جاري الحفظ...' : 'حفظ الفاتورة فقط'}</span>
              </button>
              <button
                type="button"
                disabled={isSubmitting || items.length === 0}
                onClick={() => handleSubmitPurchase(true)}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                <span>حفظ وطباعة الفاتورة</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancelPurchase}
        title={`إلغاء فاتورة الشراء ${cancelTarget?.invoiceNumber || ''}`}
        message="سيتم إلغاء فاتورة المشتريات وتحديث المخزون وحساب المورد والخزينة. يرجى كتابة السبب:"
        confirmLabel="تأكيد الإلغاء"
        variant="danger"
        requireInput
        inputLabel="سبب الإلغاء:"
        isLoading={isCancelling}
      />

      {/* Print Document Modal */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />
    </div>
  );
};

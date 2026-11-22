import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Printer, Trash2, Save, CheckCircle2, XCircle, PackagePlus, AlertTriangle
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { apiRequest } from '../../../services/api';
import { Invoice, InlinePurchaseNewProduct, Product } from '../../../types';
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

interface PurchaseDraftItem {
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
  newProduct?: InlinePurchaseNewProduct;
}

function normalizeArabicNameForDup(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

function checkLocalProductDuplicates(
  products: Product[],
  payload: { name: string; barcode: string; code: string; category: string; baseUnit: string }
): { exactMatch: Product | null; matchedBy: string | null; similarMatches: Product[] } {
  const bc = payload.barcode.trim().toLowerCase();
  const cd = payload.code.trim().toLowerCase();
  const normName = normalizeArabicNameForDup(payload.name);
  const normCat = normalizeArabicNameForDup(payload.category);
  const normUnit = normalizeArabicNameForDup(payload.baseUnit);

  if (bc) {
    const byBarcode = products.find(
      (p) =>
        String(p.barcode || '').trim().toLowerCase() === bc ||
        (Array.isArray(p.units) && p.units.some((u) => String(u.barcode || '').trim().toLowerCase() === bc))
    );
    if (byBarcode) return { exactMatch: byBarcode, matchedBy: 'barcode', similarMatches: [] };
  }
  if (cd) {
    const byCode = products.find((p) => String(p.code || '').trim().toLowerCase() === cd);
    if (byCode) return { exactMatch: byCode, matchedBy: 'code', similarMatches: [] };
  }
  if (normName) {
    const exactFull = products.find(
      (p) =>
        normalizeArabicNameForDup(p.name) === normName &&
        normalizeArabicNameForDup(p.category || '') === normCat &&
        normalizeArabicNameForDup(p.baseUnit || '') === normUnit
    );
    if (exactFull) return { exactMatch: exactFull, matchedBy: 'name_category_unit', similarMatches: [] };

    const similarMatches = products
      .filter((p) => {
        const pNorm = normalizeArabicNameForDup(p.name);
        return pNorm && (pNorm === normName || pNorm.includes(normName) || normName.includes(pNorm));
      })
      .slice(0, 5);
    return { exactMatch: null, matchedBy: null, similarMatches };
  }
  return { exactMatch: null, matchedBy: null, similarMatches: [] };
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

  // New Purchase Form state (numeric inputs default to '' so user types explicitly)
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(suppliers[0]?.id || '');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'partial'>('partial');
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [discountTotal, setDiscountTotal] = useState<number | ''>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Items
  const [items, setItems] = useState<PurchaseDraftItem[]>([]);

  // Existing item input (blank defaults)
  const [itemProdId, setItemProdId] = useState('');
  const [itemQty, setItemQty] = useState<number | ''>('');
  const [itemPrice, setItemPrice] = useState<number | ''>('');

  // Inline new product creation state
  const [showInlineNewProduct, setShowInlineNewProduct] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdBarcode, setNewProdBarcode] = useState('');
  const [newProdCode, setNewProdCode] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('أصناف عامة');
  const [newProdBaseUnit, setNewProdBaseUnit] = useState('قطعة');
  const [newProdQty, setNewProdQty] = useState<number | ''>('');
  const [newProdPurchasePrice, setNewProdPurchasePrice] = useState<number | ''>('');
  const [newProdSellingPrice, setNewProdSellingPrice] = useState<number | ''>('');
  const [duplicateCheckState, setDuplicateCheckState] = useState<{
    checking: boolean;
    exactMatch: Product | null;
    matchedBy: string | null;
    similarMatches: Product[];
  }>({ checking: false, exactMatch: null, matchedBy: null, similarMatches: [] });

  const resetPurchaseModalForm = useCallback(() => {
    setItems([]);
    setItemProdId('');
    setItemQty('');
    setItemPrice('');
    setPaidAmount('');
    setDiscountTotal('');
    setNotes('');
    setError(null);
    setShowInlineNewProduct(false);
    setNewProdName('');
    setNewProdBarcode('');
    setNewProdCode('');
    setNewProdQty('');
    setNewProdPurchasePrice('');
    setNewProdSellingPrice('');
    setDuplicateCheckState({ checking: false, exactMatch: null, matchedBy: null, similarMatches: [] });
  }, []);

  useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    if (initialOpenNew) {
      resetPurchaseModalForm();
      setIsNewModalOpen(true);
    }
  }, [initialOpenNew, resetPurchaseModalForm]);

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

  // Debounced duplicate check while typing an inline new product
  useEffect(() => {
    if (!showInlineNewProduct) return;
    const hasQuery = Boolean(newProdName.trim() || newProdBarcode.trim() || newProdCode.trim());
    if (!hasQuery) {
      setDuplicateCheckState({ checking: false, exactMatch: null, matchedBy: null, similarMatches: [] });
      return;
    }

    let cancelled = false;
    setDuplicateCheckState((prev) => ({ ...prev, checking: true }));
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiRequest<{
          ok: boolean;
          exactMatch?: Product | null;
          matchedBy?: string | null;
          similarMatches?: Product[];
        }>('/api/products/check-duplicate', {
          method: 'POST',
          body: {
            name: newProdName.trim(),
            barcode: newProdBarcode.trim(),
            code: newProdCode.trim(),
            category: newProdCategory.trim(),
            baseUnit: newProdBaseUnit.trim(),
          },
        });
        if (!cancelled) {
          setDuplicateCheckState({
            checking: false,
            exactMatch: res?.exactMatch || null,
            matchedBy: res?.matchedBy || null,
            similarMatches: Array.isArray(res?.similarMatches) ? res.similarMatches : [],
          });
        }
      } catch {
        if (!cancelled) {
          const localRes = checkLocalProductDuplicates(products, {
            name: newProdName,
            barcode: newProdBarcode,
            code: newProdCode,
            category: newProdCategory,
            baseUnit: newProdBaseUnit,
          });
          setDuplicateCheckState({
            checking: false,
            exactMatch: localRes.exactMatch,
            matchedBy: localRes.matchedBy,
            similarMatches: localRes.similarMatches,
          });
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showInlineNewProduct, newProdName, newProdBarcode, newProdCode, newProdCategory, newProdBaseUnit, products]);

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
      setItemPrice(p.purchasePrice > 0 ? p.purchasePrice : '');
    }
  };

  const handleUseExistingDuplicateProduct = (prod: Product) => {
    setShowInlineNewProduct(false);
    setItemProdId(prod.id);
    setItemPrice(prod.purchasePrice > 0 ? prod.purchasePrice : '');
    if (newProdQty !== '' && Number(newProdQty) > 0) {
      setItemQty(Number(newProdQty));
    }
    setError(null);
    window.setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 30);
  };

  const handleAddItem = () => {
    const prod = products.find(p => p.id === itemProdId);
    if (!prod) {
      setError('يرجى اختيار الصنف أولاً');
      return;
    }
    const qtyNum = Number(itemQty || 0);
    if (qtyNum <= 0) {
      setError('يرجى إدخال كمية صحيحة أكبر من صفر');
      return;
    }
    const priceNum = Math.max(0, Number(itemPrice || 0));
    const total = computeLineTotal(qtyNum, priceNum);

    setItems(prev => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        barcode: prod.barcode,
        unit: prod.baseUnit,
        unitFactor: 1,
        quantity: qtyNum,
        unitPrice: priceNum,
        purchasePriceAtTime: priceNum,
        discount: 0,
        total,
      }
    ]);
    setItemProdId('');
    setItemQty('');
    setItemPrice('');
    setError(null);
    window.setTimeout(() => {
      productSearchRef.current?.focus();
    }, 30);
  };

  const handleAddInlineNewProductItem = () => {
    const cleanName = newProdName.trim();
    if (!cleanName) {
      setError('يرجى إدخال اسم الصنف الجديد');
      return;
    }
    const qtyNum = Number(newProdQty || 0);
    if (qtyNum <= 0) {
      setError('يرجى إدخال كمية الشراء للصنف الجديد أكبر من صفر');
      return;
    }
    const buyPrice = Math.max(0, Number(newProdPurchasePrice || 0));
    const sellPrice = newProdSellingPrice === '' ? buyPrice : Math.max(0, Number(newProdSellingPrice || 0));

    // Prevent exact duplicate creation by auto-binding to the existing product
    const exact = duplicateCheckState.exactMatch;
    if (exact) {
      const total = computeLineTotal(qtyNum, buyPrice || exact.purchasePrice || 0);
      const effectiveBuy = buyPrice || exact.purchasePrice || 0;
      setItems((prev) => [
        ...prev,
        {
          productId: exact.id,
          productName: exact.name,
          barcode: exact.barcode || '',
          unit: exact.baseUnit,
          unitFactor: 1,
          quantity: qtyNum,
          unitPrice: effectiveBuy,
          purchasePriceAtTime: effectiveBuy,
          discount: 0,
          total,
        },
      ]);
      setActionMessage({
        type: 'success',
        text: `تم ربط البند بالصنف المسجل مسبقاً (${exact.name}) لمنع التكرار في المخزن.`,
      });
    } else {
      const cleanCategory = newProdCategory.trim() || 'أصناف عامة';
      const cleanUnit = newProdBaseUnit.trim() || 'قطعة';
      const cleanBarcode = newProdBarcode.trim();
      const cleanCode = newProdCode.trim();
      const total = computeLineTotal(qtyNum, buyPrice);
      setItems((prev) => [
        ...prev,
        {
          productId: '',
          productName: cleanName,
          barcode: cleanBarcode || cleanCode,
          unit: cleanUnit,
          unitFactor: 1,
          quantity: qtyNum,
          unitPrice: buyPrice,
          purchasePriceAtTime: buyPrice,
          discount: 0,
          total,
          newProduct: {
            name: cleanName,
            barcode: cleanBarcode || undefined,
            code: cleanCode || undefined,
            category: cleanCategory,
            baseUnit: cleanUnit,
            purchasePrice: buyPrice,
            sellingPrice: sellPrice,
          },
        },
      ]);
    }

    setNewProdName('');
    setNewProdBarcode('');
    setNewProdCode('');
    setNewProdQty('');
    setNewProdPurchasePrice('');
    setNewProdSellingPrice('');
    setDuplicateCheckState({ checking: false, exactMatch: null, matchedBy: null, similarMatches: [] });
    setShowInlineNewProduct(false);
    setError(null);
  };

  const subtotal = useMemo(() => items.reduce((a, b) => a + b.total, 0), [items]);
  const numericDiscount = useMemo(() => Math.max(0, Number(discountTotal || 0)), [discountTotal]);
  const grandTotal = useMemo(() => Math.max(0, subtotal - numericDiscount), [subtotal, numericDiscount]);

  useEffect(() => {
    if (paymentType === 'cash') {
      setPaidAmount(grandTotal > 0 ? grandTotal : '');
    } else if (paymentType === 'credit') {
      setPaidAmount('');
    }
  }, [paymentType, grandTotal]);

  const numericPaid = useMemo(() => {
    if (paymentType === 'cash') return grandTotal;
    if (paymentType === 'credit') return 0;
    return Math.min(grandTotal, Math.max(0, Number(paidAmount || 0)));
  }, [grandTotal, paidAmount, paymentType]);

  const remainingAmount = useMemo(() => {
    if (paymentType === 'cash') return 0;
    return Math.max(0, grandTotal - numericPaid);
  }, [grandTotal, numericPaid, paymentType]);

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
      const rawPaid = Number(paidAmount || 0);
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
        discountTotal: numericDiscount,
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
        resetPurchaseModalForm();
        setActionMessage({
          type: 'success',
          text: `تم حفظ فاتورة المشتريات رقم (${res.invoice?.invoiceNumber || ''}) وتحديث المخزون والأصناف بنجاح.`,
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
    paidAmount, createPurchaseInvoice, invoiceDate, subtotal, numericDiscount, selectedCashboxId,
    notes, handlePrint, resetPurchaseModalForm
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
            resetPurchaseModalForm();
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

          {/* Add product to purchase using instant search + Inline New Product Creation */}
          <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-black text-slate-800">إضافة أصناف لفاتورة الشراء:</span>
              <button
                type="button"
                onClick={() => {
                  setShowInlineNewProduct((prev) => !prev);
                  setError(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold border transition-colors cursor-pointer ${
                  showInlineNewProduct
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-blue-900 border-blue-300 hover:bg-blue-50'
                }`}
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>{showInlineNewProduct ? 'إغلاق إنشاء الصنف الجديد' : 'إنشاء صنف جديد داخل الفاتورة'}</span>
              </button>
            </div>

            {!showInlineNewProduct ? (
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
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
                    placeholder="الكمية"
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
                    min="0"
                    placeholder="السعر"
                    value={itemPrice}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setItemPrice(raw === '' ? '' : Number(raw));
                    }}
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
            ) : (
              <div className="bg-white p-3.5 rounded-xl border border-blue-200 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">اسم الصنف الجديد: *</label>
                    <input
                      type="text"
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                      placeholder="مثال: سكر الضحى 1 كجم"
                      className="w-full border border-slate-300 rounded-xl p-2 font-bold focus:border-blue-600 outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الباركود (اختياري):</label>
                    <input
                      type="text"
                      value={newProdBarcode}
                      onChange={(e) => setNewProdBarcode(e.target.value)}
                      placeholder="622..."
                      className="w-full border border-slate-300 rounded-xl p-2 font-mono focus:border-blue-600 outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الكود (اختياري):</label>
                    <input
                      type="text"
                      value={newProdCode}
                      onChange={(e) => setNewProdCode(e.target.value)}
                      placeholder="PRD-..."
                      className="w-full border border-slate-300 rounded-xl p-2 font-mono focus:border-blue-600 outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">التصنيف:</label>
                    <input
                      type="text"
                      value={newProdCategory}
                      onChange={(e) => setNewProdCategory(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl p-2 font-semibold focus:border-blue-600 outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الوحدة الأساسية:</label>
                    <input
                      type="text"
                      value={newProdBaseUnit}
                      onChange={(e) => setNewProdBaseUnit(e.target.value)}
                      placeholder="قطعة / كرتونة / كجم"
                      className="w-full border border-slate-300 rounded-xl p-2 font-semibold focus:border-blue-600 outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الكمية المشتراة: *</label>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={newProdQty}
                      placeholder="الكمية"
                      onChange={setNewProdQty}
                      ariaLabel="كمية الصنف الجديد"
                      inputClassName="w-full bg-white border border-slate-300 rounded-xl p-2 text-center font-mono font-bold outline-hidden focus:border-blue-700"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">سعر الشراء: *</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="سعر الشراء"
                      value={newProdPurchasePrice}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setNewProdPurchasePrice(raw === '' ? '' : Number(raw));
                      }}
                      className="w-full border border-slate-300 rounded-xl p-2 text-center font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">سعر البيع المقترح:</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="سعر البيع"
                      value={newProdSellingPrice}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setNewProdSellingPrice(raw === '' ? '' : Number(raw));
                      }}
                      className="w-full border border-slate-300 rounded-xl p-2 text-center font-mono font-bold"
                    />
                  </div>
                </div>

                {/* Live Duplicate Check Alerts */}
                {duplicateCheckState.exactMatch && (
                  <div className="p-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>
                        هذا الصنف مسجل مسبقاً ({duplicateCheckState.exactMatch.name} — {duplicateCheckState.exactMatch.code})! لن يُنشأ صنف مكرر.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUseExistingDuplicateProduct(duplicateCheckState.exactMatch!)}
                      className="px-3 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold cursor-pointer"
                    >
                      استخدام الصنف الموجود
                    </button>
                  </div>
                )}

                {!duplicateCheckState.exactMatch && duplicateCheckState.similarMatches.length > 0 && (
                  <div className="p-2.5 rounded-xl border border-blue-200 bg-blue-50/70 text-blue-950 space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-blue-700" />
                      <span>توجد أصناف متشابهة بالاسم (اختر منها إن كان نفس الصنف):</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {duplicateCheckState.similarMatches.map((sim) => (
                        <button
                          key={sim.id}
                          type="button"
                          onClick={() => handleUseExistingDuplicateProduct(sim)}
                          className="px-2.5 py-1 rounded-lg bg-white border border-blue-300 hover:bg-blue-100 text-blue-900 font-bold text-[11px] cursor-pointer"
                        >
                          {sim.name} ({sim.baseUnit}) — {sim.purchasePrice} {settings.currency}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowInlineNewProduct(false)}
                    className="px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-600 cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={handleAddInlineNewProductItem}
                    className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                  >
                    {duplicateCheckState.exactMatch ? 'ربط بالصنف الموجود وإضافته' : '+ إضافة الصنف للفاتورة'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Items list */}
          <div className="border rounded-xl awlad-table-scroll">
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
                      لم تتم إضافة أصناف بعد. ابحث عن صنف أعلاه أو أنشئ صنفاً جديداً لإضافته.
                    </td>
                  </tr>
                ) : (
                  items.map((it, i) => (
                    <tr key={i}>
                      <td className="p-2 font-bold">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{it.productName}</span>
                          {it.newProduct && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                              صنف جديد ({it.unit})
                            </span>
                          )}
                        </div>
                      </td>
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
                                idx === i
                                  ? {
                                      ...row,
                                      unitPrice: p,
                                      purchasePriceAtTime: p,
                                      total: row.quantity * p,
                                      newProduct: row.newProduct ? { ...row.newProduct, purchasePrice: p } : undefined,
                                    }
                                  : row
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
                    placeholder="أدخل المبلغ المدفوع"
                    value={paidAmount}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setPaidAmount(raw === '' ? '' : Number(raw));
                    }}
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
                  placeholder="0"
                  value={discountTotal}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setDiscountTotal(raw === '' ? '' : Math.max(0, Number(raw)));
                  }}
                  className="w-24 border rounded-lg px-2 py-1 text-center font-mono text-red-600"
                />
              </div>
              <div className="flex justify-between text-base font-black text-blue-950 border-t pt-1.5">
                <span>الإجمالي الصافي:</span>
                <span>{grandTotal.toLocaleString()} {settings.currency}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>المدفوع:</span>
                <span>{numericPaid.toLocaleString()}</span>
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

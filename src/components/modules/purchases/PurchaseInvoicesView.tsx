import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Printer, Trash2, Save, CheckCircle2, XCircle, PackagePlus, AlertTriangle,
  Eye, Edit, AlertCircle, History, Clock, Send, UserCheck
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { apiRequest } from '../../../services/api';
import { Invoice, InvoiceItem, InlinePurchaseNewProduct, Product } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { QuantityInput } from '../../common/QuantityInput';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { computeLineTotal } from '../../../utils/quantity';

export interface PurchaseInvoicesViewProps {
  initialStatusFilter?: 'all' | 'rep_incoming' | 'confirmed' | 'draft' | 'cancelled';
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
    invoices, suppliers, products, warehouses, cashboxes, purchaseReceivers = [],
    settings, createPurchaseInvoice, editPurchaseInvoice, cancelInvoice,
    sendPurchaseInvoice, receivePurchaseInvoice, rejectPurchaseInvoice, confirmDraftInvoice,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const canEditPurchase = currentUser?.role === 'admin' || (hasPermission('canManagePurchases') && hasPermission('canEdit'));
  const canCreatePurchaseDraft =
    currentUser?.role === 'admin' ||
    hasPermission('canManagePurchases') ||
    hasPermission('canCreatePurchase') ||
    hasPermission('canSend');
  const canApprovePurchase =
    currentUser?.role === 'admin' ||
    hasPermission('canManagePurchases') ||
    hasPermission('canApprove') ||
    hasPermission('canReviewRepInvoices');
  const canReceivePurchase =
    currentUser?.role !== 'representative' &&
    currentUser?.role !== 'customer' &&
    (canApprovePurchase || hasPermission('canReceive'));
  const { registerHandler } = useShortcuts();

  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'rep_incoming' | 'confirmed' | 'draft' | 'cancelled'>(initialStatusFilter);
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [isNewModalOpen, setIsNewModalOpen] = useState(initialOpenNew);
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [isDispatchActionBusy, setIsDispatchActionBusy] = useState(false);
  const [isRejectBoxOpen, setIsRejectBoxOpen] = useState(false);
  const [rejectReasonText, setRejectReasonText] = useState('');
  const [newRecipientUserId, setNewRecipientUserId] = useState('');
  const [sendModalInvoice, setSendModalInvoice] = useState<Invoice | null>(null);
  const [sendModalRecipientId, setSendModalRecipientId] = useState('');
  const [sendModalNotes, setSendModalNotes] = useState('');
  const [isSendingModalBusy, setIsSendingModalBusy] = useState(false);

  // Edit Purchase Invoice Modal state
  const [editModalInvoice, setEditModalInvoice] = useState<Invoice | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editSupplierId, setEditSupplierId] = useState('');
  const [editWarehouseId, setEditWarehouseId] = useState('');
  const [editDiscount, setEditDiscount] = useState<number>(0);
  const [editNotes, setEditNotes] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editItems, setEditItems] = useState<InvoiceItem[]>([]);
  const [editAddProdId, setEditAddProdId] = useState('');
  const [editAddQty, setEditAddQty] = useState<number | ''>('');
  const [editAddPrice, setEditAddPrice] = useState<number | ''>('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

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
  const [newProdCategory, setNewProdCategory] = useState('');
  const [newProdBaseUnit, setNewProdBaseUnit] = useState('');
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

  const repIncomingPendingCount = useMemo(() => {
    return purchaseInvoices.filter(i => i.status === 'draft' && i.dispatchStatus === 'sent').length;
  }, [purchaseInvoices]);

  const displayedActiveInvoice = useMemo(() => {
    if (!activeInvoice) return null;
    return purchaseInvoices.find((i) => i.id === activeInvoice.id) || activeInvoice;
  }, [activeInvoice, purchaseInvoices]);

  const getPurchaseStatusBadge = (inv: Invoice) => {
    if (inv.status === 'cancelled') {
      return { label: 'ملغاة', cls: 'bg-red-50 text-red-700 border border-red-200' };
    }
    if (inv.status === 'confirmed') {
      return { label: 'مؤكدة ومعتمدة', cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200' };
    }
    switch (inv.dispatchStatus) {
      case 'sent':
        return { label: 'مرسلة بانتظار الاستلام', cls: 'bg-amber-50 text-amber-900 border border-amber-200' };
      case 'received':
        return { label: 'تم الاستلام (بانتظار الاعتماد)', cls: 'bg-sky-50 text-sky-900 border border-sky-200' };
      case 'rejected':
        return { label: 'مرفوضة', cls: 'bg-rose-50 text-rose-800 border border-rose-200' };
      default:
        return { label: 'مسودة', cls: 'bg-slate-100 text-slate-700 border border-slate-200' };
    }
  };

  const filteredPurchases = useMemo(() => {
    return purchaseInvoices.filter(inv => {
      const q = searchTerm.toLowerCase();
      const matchSearch =
        !q ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        (inv.supplierName && inv.supplierName.toLowerCase().includes(q)) ||
        (inv.representativeName && inv.representativeName.toLowerCase().includes(q)) ||
        (inv.sentBy && inv.sentBy.toLowerCase().includes(q));
      const matchSupplier = supplierFilter === 'all' ? true : inv.supplierId === supplierFilter;
      const matchStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'rep_incoming'
          ? Boolean(inv.isRepPurchase || inv.representativeId || inv.sentByUserId || (inv.dispatchStatus && inv.dispatchStatus !== 'draft'))
          : inv.status === statusFilter;
      return matchSearch && matchSupplier && matchStatus;
    });
  }, [purchaseInvoices, searchTerm, supplierFilter, statusFilter]);

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
    const sellPrice = newProdSellingPrice === '' ? 0 : Math.max(0, Number(newProdSellingPrice || 0));

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

  const handleSubmitPurchase = useCallback(async (shouldPrint: boolean, sendToAdmin = false) => {
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
      const chosenReceiver = purchaseReceivers.find((r) => r.id === newRecipientUserId);
      const createAsDraft = sendToAdmin || !canApprovePurchase;

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
        status: createAsDraft ? 'draft' : 'confirmed',
        dispatchStatus: createAsDraft ? (sendToAdmin ? 'sent' : 'draft') : 'confirmed',
        sendNow: createAsDraft && sendToAdmin,
        recipientUserId: createAsDraft && sendToAdmin ? chosenReceiver?.id : undefined,
        recipientName: createAsDraft && sendToAdmin ? (chosenReceiver?.fullName || 'الإدارة العامة') : undefined,
        notes,
      });

      if (res.success) {
        setIsNewModalOpen(false);
        resetPurchaseModalForm();
        setNewRecipientUserId('');
        setActionMessage({
          type: 'success',
          text: !createAsDraft
            ? `تم حفظ فاتورة المشتريات رقم (${res.invoice?.invoiceNumber || ''}) وتحديث المخزون والأصناف بنجاح.`
            : sendToAdmin
            ? `تم حفظ فاتورة الشراء وإرسالها للإدارة (${res.invoice?.invoiceNumber || ''}) بانتظار الاستلام والاعتماد دون تعديل الأرصدة.`
            : `تم حفظ فاتورة الشراء كمسودة (${res.invoice?.invoiceNumber || ''}) بانتظار الإرسال أو المراجعة دون تعديل المخزون.`,
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
    notes, handlePrint, resetPurchaseModalForm, canApprovePurchase, purchaseReceivers, newRecipientUserId
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

  const handleOpenEditModal = (inv: Invoice) => {
    setEditModalInvoice(inv);
    setEditDate(inv.date);
    setEditSupplierId(inv.supplierId || '');
    setEditWarehouseId(inv.warehouseId || '');
    setEditDiscount(inv.discountTotal || 0);
    setEditNotes(inv.notes || '');
    setEditReason('');
    setEditItems(inv.items.map((it) => ({ ...it })));
    setEditAddProdId('');
    setEditAddQty('');
    setEditAddPrice('');
    setEditError(null);
  };

  const handleEditPickProduct = (p: Product) => {
    setEditAddProdId(p.id);
    setEditAddPrice(p.purchasePrice > 0 ? p.purchasePrice : '');
  };

  const handleAddItemToEdit = () => {
    const prod = products.find((p) => p.id === editAddProdId);
    if (!prod) {
      setEditError('يرجى اختيار الصنف أولاً لإضافته للفاتورة');
      return;
    }
    const qtyNum = Number(editAddQty || 0);
    if (qtyNum <= 0) {
      setEditError('يرجى إدخال كمية صحيحة أكبر من صفر');
      return;
    }
    const priceNum = Math.max(0, Number(editAddPrice || 0));
    setEditItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        barcode: prod.barcode || prod.code || '',
        unit: prod.baseUnit,
        unitFactor: 1,
        quantity: qtyNum,
        unitPrice: priceNum,
        purchasePriceAtTime: priceNum,
        discount: 0,
        total: computeLineTotal(qtyNum, priceNum, 0),
      },
    ]);
    setEditAddProdId('');
    setEditAddQty('');
    setEditAddPrice('');
    setEditError(null);
  };

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalInvoice) return;
    if (editItems.length === 0) {
      setEditError('يجب أن تحتوي فاتورة المشتريات على صنف واحد على الأقل.');
      return;
    }
    if (editModalInvoice.status === 'confirmed' && !editReason.trim()) {
      setEditError('يرجى كتابة سبب تعديل الفاتورة لتوثيقه في سجل المراجعة.');
      return;
    }
    const subtotalNext = editItems.reduce((s, it) => s + computeLineTotal(it.quantity, it.unitPrice, it.discount || 0), 0);
    const grandNext = Math.max(0, subtotalNext - Math.max(0, Number(editDiscount || 0)));
    if (grandNext < Number(editModalInvoice.paidAmount || 0) - 0.01) {
      setEditError(
        `لا يمكن أن يكون الإجمالي المعدل (${grandNext.toLocaleString()}) أقل من المبلغ المدفوع مسبقاً (${Number(editModalInvoice.paidAmount || 0).toLocaleString()}).`
      );
      return;
    }

    const suppObj = suppliers.find((s) => s.id === editSupplierId);
    const whObj = warehouses.find((w) => w.id === editWarehouseId);
    setEditError(null);
    setIsSubmittingEdit(true);
    const res = await editPurchaseInvoice(editModalInvoice.id, {
      date: editDate,
      supplierId: editSupplierId || undefined,
      supplierName: suppObj?.name || 'مورد نقدي',
      warehouseId: editWarehouseId || editModalInvoice.warehouseId,
      warehouseName: whObj?.name || editModalInvoice.warehouseName,
      discountTotal: Math.max(0, Number(editDiscount || 0)),
      notes: editNotes,
      reason: editReason.trim() || 'تعديل فاتورة مشتريات',
      items: editItems,
    });
    setIsSubmittingEdit(false);
    if (!res.success) {
      setEditError(res.error || 'تعذر تعديل فاتورة المشتريات');
    } else {
      setEditModalInvoice(null);
      setActionMessage({
        type: 'success',
        text: res.queuedOffline
          ? `تم حفظ تعديل فاتورة المشتريات (${editModalInvoice.invoiceNumber}) محلياً للمزامنة عند عودة الاتصال.`
          : `تم تحديث فاتورة المشتريات رقم (${editModalInvoice.invoiceNumber}) والمخزون ورصيد المورد بنجاح.`,
      });
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

        <div className="flex flex-wrap items-center gap-2">
          {repIncomingPendingCount > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter('rep_incoming')}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-black cursor-pointer hover:bg-amber-100"
            >
              <Send className="w-4 h-4 text-amber-700" />
              <span>وارد من المناديب ({repIncomingPendingCount})</span>
            </button>
          )}
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
      <UnifiedDataTable<Invoice>
        title="سجل فواتير المشتريات"
        subtitle="فواتير الشراء المعتمدة والمسودات وفواتير المناديب الواردة"
        data={filteredPurchases}
        rowKey={(inv) => inv.id}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="بحث برقم الفاتورة أو المورد أو المندوب..."
        exportFilename="AWLAD_SELIM_PurchaseInvoices"
        pdfTitle="سجل فواتير المشتريات"
        emptyTitle="لا توجد فواتير مشتريات مسجلة"
        toolbarFilters={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="min-w-[180px]">
              <SearchableFilterSelect
                id="purchase-filter-supplier"
                value={supplierFilter}
                onChange={setSupplierFilter}
                options={suppliers.map((s) => ({
                  value: s.id,
                  label: s.name,
                  subtitle: s.phone || s.companyName,
                  searchText: `${s.name} ${s.phone || ''} ${s.companyName || ''}`,
                }))}
                allOptionLabel="جميع الموردين"
                allOptionValue="all"
                searchPlaceholder="ابحث باسم المورد أو الهاتف..."
                allowClear
                buttonClassName="rounded-xl min-h-[36px]"
              />
            </div>
            <div className="min-w-[185px]">
              <SearchableFilterSelect
                id="purchase-filter-status"
                value={statusFilter}
                onChange={(val) => setStatusFilter((val as any) || 'all')}
                options={[
                  { value: 'rep_incoming', label: 'فواتير شراء المناديب (الواردة)' },
                  { value: 'confirmed', label: 'فواتير مؤكدة ومعتمدة' },
                  { value: 'draft', label: 'مسودات وبانتظار الاعتماد' },
                  { value: 'cancelled', label: 'ملغاة / محذوفة' },
                ]}
                allOptionLabel="جميع الحالات"
                allOptionValue="all"
                allowClear
                buttonClassName="rounded-xl min-h-[36px]"
              />
            </div>
          </div>
        }
        columns={[
          {
            key: 'invoiceNumber',
            header: 'رقم الفاتورة',
            sortable: true,
            sortValue: (inv) => inv.invoiceNumber,
            exportValue: (inv) => inv.invoiceNumber,
            render: (inv) => <span className="font-mono font-bold text-blue-900">{inv.invoiceNumber}</span>,
          },
          {
            key: 'date',
            header: 'التاريخ',
            sortable: true,
            sortValue: (inv) => inv.date,
            exportValue: (inv) => inv.date,
            render: (inv) => <span className="font-mono text-slate-600">{inv.date}</span>,
          },
          {
            key: 'supplierName',
            header: 'المورد / المرسل',
            sortable: true,
            sortValue: (inv) => inv.supplierName || '',
            exportValue: (inv) => inv.supplierName || '-',
            render: (inv) => (
              <div>
                <div className="font-bold text-slate-800">{inv.supplierName}</div>
                {(inv.representativeName || inv.sentBy) && (
                  <div className="text-[10px] text-indigo-700 font-bold mt-0.5">
                    المندوب / المرسل: {inv.representativeName || inv.sentBy}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'warehouseName',
            header: 'المستودع المستلم',
            exportValue: (inv) => inv.warehouseName || '-',
            render: (inv) => <span className="text-slate-600">{inv.warehouseName}</span>,
          },
          {
            key: 'grandTotal',
            header: 'الإجمالي',
            align: 'center',
            sortable: true,
            sortValue: (inv) => inv.grandTotal,
            exportValue: (inv) => inv.grandTotal,
            render: (inv) => <span className="font-black font-mono tabular-nums">{inv.grandTotal.toLocaleString()} {settings.currency}</span>,
          },
          {
            key: 'paidAmount',
            header: 'المدفوع',
            align: 'center',
            sortable: true,
            sortValue: (inv) => inv.paidAmount,
            exportValue: (inv) => inv.paidAmount,
            render: (inv) => <span className="text-emerald-700 font-bold font-mono tabular-nums">{inv.paidAmount.toLocaleString()}</span>,
          },
          {
            key: 'remainingAmount',
            header: 'المتبقي للمورد',
            align: 'center',
            sortable: true,
            sortValue: (inv) => inv.remainingAmount,
            exportValue: (inv) => inv.remainingAmount,
            render: (inv) => <span className="text-red-700 font-bold font-mono tabular-nums">{inv.remainingAmount.toLocaleString()}</span>,
          },
          {
            key: 'status',
            header: 'الحالة',
            align: 'center',
            exportValue: (inv) => getPurchaseStatusBadge(inv).label,
            render: (inv) => {
              const badge = getPurchaseStatusBadge(inv);
              return (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block ${badge.cls}`}>
                  {badge.label}
                </span>
              );
            },
          },
          {
            key: 'actions',
            header: 'الإجراءات',
            align: 'center',
            render: (inv) => (
              <div className="flex items-center justify-center gap-1.5">
                {inv.status === 'draft' && (!inv.dispatchStatus || inv.dispatchStatus === 'draft' || inv.dispatchStatus === 'rejected') && canCreatePurchaseDraft && (
                  <button
                    type="button"
                    onClick={() => {
                      setSendModalInvoice(inv);
                      setSendModalRecipientId(inv.recipientUserId || '');
                      setSendModalNotes('');
                    }}
                    className="p-1.5 text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 rounded-lg cursor-pointer"
                    title={inv.dispatchStatus === 'rejected' ? 'إعادة إرسال الفاتورة للإدارة' : 'إرسال الفاتورة للإدارة'}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
                {inv.status !== 'cancelled' && canEditPurchase && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(inv)}
                    className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg cursor-pointer"
                    title="تعديل فاتورة الشراء والأصناف"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsRejectBoxOpen(false);
                    setRejectReasonText('');
                    setActiveInvoice(inv);
                  }}
                  className="p-1.5 text-slate-500 hover:text-blue-900 hover:bg-blue-50 rounded-lg cursor-pointer"
                  title="عرض تفاصيل الفاتورة وسجل الإرسال والتعديلات"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handlePrint(inv)}
                  className="p-1.5 text-slate-500 hover:text-blue-900 hover:bg-blue-50 rounded-lg cursor-pointer"
                  title="طباعة الفاتورة"
                >
                  <Printer className="w-4 h-4" />
                </button>
                {inv.status !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => setCancelTarget(inv)}
                    className="p-1.5 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                    title="إلغاء فاتورة الشراء"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

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

          <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block font-bold text-indigo-950 mb-1">المسؤول الموجه إليه عند الإرسال للإدارة (اختياري):</label>
              <select
                value={newRecipientUserId}
                onChange={(e) => setNewRecipientUserId(e.target.value)}
                className="w-full bg-white border border-indigo-200 rounded-xl p-2 font-bold"
              >
                <option value="">الإدارة العامة (جميع المسؤولين المختصين)</option>
                {purchaseReceivers.map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName} ({r.role})</option>
                ))}
              </select>
            </div>
            <span className="text-[11px] font-bold text-indigo-800">
              «حفظ وإرسال للإدارة» يحفظها كمسودة مرسلة دون تعديل أرصدة المخزون أو المورد لحين الاعتماد.
            </span>
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
                onClick={() => handleSubmitPurchase(false, true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-800 hover:bg-indigo-900 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>{isSubmitting ? 'جاري الإرسال...' : 'حفظ وإرسال للإدارة'}</span>
              </button>
              <button
                type="button"
                disabled={isSubmitting || items.length === 0}
                onClick={() => handleSubmitPurchase(false, false)}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{isSubmitting ? 'جاري الحفظ...' : canApprovePurchase ? 'حفظ واعتماد الفاتورة' : 'حفظ كمسودة'}</span>
              </button>
              <button
                type="button"
                disabled={isSubmitting || items.length === 0}
                onClick={() => handleSubmitPurchase(true, false)}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                <span>حفظ وطباعة الفاتورة</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Purchase Invoice Details Modal */}
      {displayedActiveInvoice && (() => {
        const badge = getPurchaseStatusBadge(displayedActiveInvoice);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 text-right max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-base font-black text-slate-900">
                  تفاصيل فاتورة المشتريات: {displayedActiveInvoice.invoiceNumber}
                </h3>
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>
              <button
                onClick={() => {
                  setActiveInvoice(null);
                  setIsRejectBoxOpen(false);
                  setRejectReasonText('');
                }}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                إغلاق ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-4 p-3 bg-slate-50 rounded-xl">
              <div className="space-y-1">
                <p className="text-slate-500">المورد: <strong className="text-slate-800">{displayedActiveInvoice.supplierName || 'مورد نقدي'}</strong></p>
                <p className="text-slate-500">المستودع المستلم: <strong className="text-slate-800">{displayedActiveInvoice.warehouseName}</strong></p>
                <p className="text-slate-500">أنشئت بواسطة: <strong className="text-slate-800">{displayedActiveInvoice.createdBy}</strong></p>
                {(displayedActiveInvoice.sentBy || displayedActiveInvoice.representativeName) && (
                  <p className="text-indigo-800">
                    المرسل / المندوب: <strong>{displayedActiveInvoice.sentBy || displayedActiveInvoice.representativeName}</strong>
                    {displayedActiveInvoice.sentAt ? ` (${new Date(displayedActiveInvoice.sentAt).toLocaleString('ar-EG')})` : ''}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-slate-500">التاريخ: <strong className="font-mono text-slate-800">{displayedActiveInvoice.date}</strong></p>
                {displayedActiveInvoice.recipientName && (
                  <p className="text-slate-500">الموجه إليه: <strong className="text-slate-800">{displayedActiveInvoice.recipientName}</strong></p>
                )}
                {displayedActiveInvoice.receivedBy && (
                  <p className="text-sky-800">
                    تم الاستلام بواسطة: <strong>{displayedActiveInvoice.receivedBy}</strong>
                    {displayedActiveInvoice.receivedAt ? ` (${new Date(displayedActiveInvoice.receivedAt).toLocaleString('ar-EG')})` : ''}
                  </p>
                )}
                {displayedActiveInvoice.editedBy && (
                  <p className="text-amber-700">آخر تعديل: <strong>{displayedActiveInvoice.editedBy}</strong></p>
                )}
                {displayedActiveInvoice.cancelledBy && (
                  <p className="text-red-700">ألغيت بواسطة: <strong>{displayedActiveInvoice.cancelledBy}</strong> {displayedActiveInvoice.cancelReason ? `— ${displayedActiveInvoice.cancelReason}` : ''}</p>
                )}
              </div>
            </div>

            {displayedActiveInvoice.dispatchStatus === 'rejected' && displayedActiveInvoice.rejectionReason && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
                <strong className="block mb-0.5">
                  سبب الرفض ({displayedActiveInvoice.rejectedBy || 'الإدارة'}):
                </strong>
                <span>{displayedActiveInvoice.rejectionReason}</span>
              </div>
            )}

            <div className="mb-4">
              <UnifiedDataTable<InvoiceItem>
                title="أصناف فاتورة الشراء"
                data={displayedActiveInvoice.items}
                rowKey={(it, i) => `${it.productId || it.productName}-${i}`}
                searchable={false}
                compact
                defaultPageSize={25}
                columns={[
                  {
                    key: 'productName',
                    header: 'الصنف',
                    render: (it) => <span className="font-semibold">{it.productName}</span>,
                  },
                  {
                    key: 'unit',
                    header: 'الوحدة',
                    align: 'center',
                    render: (it) => <span>{it.unit}</span>,
                  },
                  {
                    key: 'quantity',
                    header: 'الكمية',
                    align: 'center',
                    render: (it) => <span className="font-bold font-mono tabular-nums">{it.quantity}</span>,
                  },
                  {
                    key: 'unitPrice',
                    header: 'سعر الشراء',
                    align: 'center',
                    render: (it) => <span className="font-mono tabular-nums">{it.unitPrice}</span>,
                  },
                  {
                    key: 'total',
                    header: 'الإجمالي',
                    align: 'center',
                    render: (it) => <span className="font-bold font-mono text-blue-900 tabular-nums">{it.total.toLocaleString()}</span>,
                  },
                ]}
              />
            </div>

            <div className="mt-4 mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <History className="w-4 h-4 text-emerald-700" />
                <h4 className="text-xs font-black text-slate-800">
                  سجل الدفعات المسددة ({displayedActiveInvoice.payments?.length || (displayedActiveInvoice.paidAmount > 0 ? 1 : 0)})
                </h4>
              </div>
              {(!displayedActiveInvoice.payments || displayedActiveInvoice.payments.length === 0) ? (
                <p className="text-[11px] text-slate-500">
                  {displayedActiveInvoice.paidAmount > 0
                    ? `تم تسجيل دفعة مخططة بقيمة ${displayedActiveInvoice.paidAmount.toLocaleString()} ${settings.currency}.`
                    : 'فاتورة آجلة بالكامل للمورد.'}
                </p>
              ) : (
                <UnifiedDataTable
                  title="سجل الدفعات المسددة"
                  data={displayedActiveInvoice.payments}
                  rowKey={(p) => p.id}
                  searchable={false}
                  compact
                  defaultPageSize={10}
                  columns={[
                    {
                      key: 'date',
                      header: 'التاريخ',
                      render: (p) => <span className="font-mono">{p.date}</span>,
                    },
                    {
                      key: 'amount',
                      header: 'المبلغ',
                      render: (p) => <span className="font-black text-emerald-700 font-mono tabular-nums">{p.amount.toLocaleString()} {settings.currency}</span>,
                    },
                    {
                      key: 'cashboxName',
                      header: 'الخزينة',
                      render: (p) => <span className="text-slate-600">{p.cashboxName}</span>,
                    },
                    {
                      key: 'notes',
                      header: 'ملاحظات',
                      render: (p) => <span className="text-slate-500">{p.notes || '-'}</span>,
                    },
                  ]}
                />
              )}
            </div>

            {Array.isArray(displayedActiveInvoice.dispatchHistory) && displayedActiveInvoice.dispatchHistory.length > 0 && (
              <div className="mb-4 p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-indigo-700" />
                  <h4 className="text-xs font-black text-indigo-950">
                    سجل الإرسال والاستلام والاعتماد ({displayedActiveInvoice.dispatchHistory.length})
                  </h4>
                </div>
                <div className="space-y-1.5">
                  {displayedActiveInvoice.dispatchHistory.map((h, idx) => (
                    <div key={`${h.at}-${idx}`} className="p-2 bg-white border border-indigo-200/70 rounded-lg text-[11px] flex items-center justify-between gap-2">
                      <div>
                        <strong className="text-slate-900">
                          {h.action === 'created' ? 'إنشاء الفاتورة' :
                           h.action === 'sent' ? 'إرسال للإدارة' :
                           h.action === 'resent' ? 'إعادة إرسال للإدارة' :
                           h.action === 'received' ? 'استلام الفاتورة' :
                           h.action === 'rejected' ? 'رفض الفاتورة' :
                           h.action === 'confirmed' ? 'اعتماد وترحيل' : h.action}
                        </strong>
                        {h.by && <span className="text-slate-600 mr-1.5">· {h.by}</span>}
                        {h.recipientName && <span className="text-indigo-700 mr-1.5">→ {h.recipientName}</span>}
                        {(h.notes || h.reason) && <p className="text-slate-500 mt-0.5">{h.notes || h.reason}</p>}
                      </div>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0" dir="ltr">
                        {h.at ? new Date(h.at).toLocaleString('ar-EG') : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(displayedActiveInvoice.editHistory) && displayedActiveInvoice.editHistory.length > 0 && (
              <div className="mb-4 p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-700" />
                  <h4 className="text-xs font-black text-amber-950">
                    سجل التعديلات السابقة ({displayedActiveInvoice.editHistory.length})
                  </h4>
                </div>
                <div className="space-y-1.5">
                  {displayedActiveInvoice.editHistory.map((entry, idx) => (
                    <div
                      key={`${entry.editedAt}-${idx}`}
                      className="p-2.5 bg-white border border-amber-200/80 rounded-lg text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-900">
                          بواسطة: {entry.editedBy || 'غير محدد'}
                          {entry.reason ? ` · السبب: ${entry.reason}` : ''}
                        </div>
                        {entry.before && entry.after && (
                          <div className="text-slate-600 font-mono">
                            الإجمالي: {Number(entry.before.grandTotal ?? 0).toLocaleString()} →{' '}
                            <strong className="text-blue-900">{Number(entry.after.grandTotal ?? 0).toLocaleString()} {settings.currency}</strong>
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-slate-500 shrink-0" dir="ltr">
                        {entry.editedAt ? new Date(entry.editedAt).toLocaleString('ar-EG') : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {displayedActiveInvoice.status === 'draft' && (canCreatePurchaseDraft || canReceivePurchase || canApprovePurchase) && (
              <div className="mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-xs">
                <p className="text-[11px] font-bold text-slate-600">
                  ملاحظة محاسبية: هذه الفاتورة لا تزال مسودة ولم تؤثر على أرصدة المخازن أو المورد أو الخزينة بعد. يتم الترحيل الفعلي فقط عند الضغط على «اعتماد وترحيل الفاتورة».
                </p>

                {isRejectBoxOpen && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                    <label className="block font-black text-rose-900">سبب رفض الفاتورة وإعادتها للمندوب:</label>
                    <input
                      type="text"
                      value={rejectReasonText}
                      onChange={(e) => setRejectReasonText(e.target.value)}
                      placeholder="اكتب سبب الرفض بوضوح..."
                      className="w-full p-2 rounded-xl border border-rose-300 bg-white font-semibold"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsRejectBoxOpen(false);
                          setRejectReasonText('');
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold cursor-pointer"
                      >
                        تراجع
                      </button>
                      <button
                        type="button"
                        disabled={isDispatchActionBusy || !rejectReasonText.trim()}
                        onClick={async () => {
                          if (!rejectReasonText.trim()) return;
                          setIsDispatchActionBusy(true);
                          const res = await rejectPurchaseInvoice(displayedActiveInvoice.id, rejectReasonText.trim());
                          setIsDispatchActionBusy(false);
                          if (res.success) {
                            setIsRejectBoxOpen(false);
                            setRejectReasonText('');
                            setActionMessage({ type: 'success', text: `تم رفض الفاتورة (${displayedActiveInvoice.invoiceNumber}) وإخطار المندوب.` });
                          } else {
                            setActionMessage({ type: 'error', text: res.error || 'تعذر رفض الفاتورة' });
                          }
                        }}
                        className="px-4 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-black disabled:opacity-50 cursor-pointer"
                      >
                        {isDispatchActionBusy ? 'جاري الرفض...' : 'تأكيد الرفض'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {canCreatePurchaseDraft && (!displayedActiveInvoice.dispatchStatus || displayedActiveInvoice.dispatchStatus === 'draft' || displayedActiveInvoice.dispatchStatus === 'rejected') && (
                    <button
                      type="button"
                      disabled={isDispatchActionBusy}
                      onClick={() => {
                        setSendModalInvoice(displayedActiveInvoice);
                        setSendModalRecipientId(displayedActiveInvoice.recipientUserId || '');
                        setSendModalNotes('');
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-800 hover:bg-indigo-900 text-white font-bold cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                      <span>{displayedActiveInvoice.dispatchStatus === 'rejected' ? 'إعادة إرسال للإدارة' : 'إرسال للإدارة'}</span>
                    </button>
                  )}

                  {canReceivePurchase && displayedActiveInvoice.dispatchStatus === 'sent' && (
                    <button
                      type="button"
                      disabled={isDispatchActionBusy}
                      onClick={async () => {
                        setIsDispatchActionBusy(true);
                        const res = await receivePurchaseInvoice(displayedActiveInvoice.id);
                        setIsDispatchActionBusy(false);
                        if (res.success) {
                          setActionMessage({
                            type: 'success',
                            text: `تم استلام فاتورة الشراء (${displayedActiveInvoice.invoiceNumber}) بنجاح وبانتظار الاعتماد النهائي.`,
                          });
                        } else {
                          setActionMessage({ type: 'error', text: res.error || 'تعذر تأكيد استلام الفاتورة' });
                        }
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-bold cursor-pointer disabled:opacity-50"
                    >
                      <UserCheck className="w-4 h-4" />
                      <span>تأكيد استلام الفاتورة</span>
                    </button>
                  )}

                  {canReceivePurchase && (displayedActiveInvoice.dispatchStatus === 'sent' || displayedActiveInvoice.dispatchStatus === 'received') && !isRejectBoxOpen && (
                    <button
                      type="button"
                      disabled={isDispatchActionBusy}
                      onClick={() => setIsRejectBoxOpen(true)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 font-bold cursor-pointer disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>رفض مع ذكر السبب</span>
                    </button>
                  )}

                  {canApprovePurchase && displayedActiveInvoice.dispatchStatus !== 'rejected' && (
                    <button
                      type="button"
                      disabled={isDispatchActionBusy}
                      onClick={async () => {
                        setIsDispatchActionBusy(true);
                        const res = await confirmDraftInvoice(displayedActiveInvoice.id);
                        setIsDispatchActionBusy(false);
                        if (res.success) {
                          setActionMessage({
                            type: 'success',
                            text: `تم اعتماد وترحيل فاتورة الشراء (${displayedActiveInvoice.invoiceNumber}) للمخزون وحساب المورد بنجاح.`,
                          });
                        } else {
                          setActionMessage({ type: 'error', text: res.error || 'تعذر اعتماد الفاتورة' });
                        }
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>اعتماد وترحيل الفاتورة</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t text-xs">
              <div className="flex items-center gap-4 text-slate-600">
                <span>الإجمالي: <strong className="text-sm font-black text-slate-900">{displayedActiveInvoice.grandTotal.toLocaleString()} {settings.currency}</strong></span>
                <span>المدفوع: <strong className="text-sm font-bold text-emerald-700">{displayedActiveInvoice.paidAmount.toLocaleString()}</strong></span>
                <span>المتبقي للمورد: <strong className="text-sm font-bold text-red-600">{displayedActiveInvoice.remainingAmount.toLocaleString()}</strong></span>
              </div>
              <button
                onClick={() => {
                  const inv = displayedActiveInvoice;
                  setActiveInvoice(null);
                  handlePrint(inv);
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-950 transition-colors cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة هذه الفاتورة</span>
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Edit Purchase Invoice Modal */}
      {editModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 text-right max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  تعديل فاتورة المشتريات رقم: {editModalInvoice.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  المدفوع مسبقاً للمورد: <strong className="text-emerald-700">{editModalInvoice.paidAmount.toLocaleString()} {settings.currency}</strong>
                </p>
              </div>
              <button
                onClick={() => setEditModalInvoice(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {editError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitEdit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">المورد:</label>
                  <select
                    value={editSupplierId}
                    onChange={(e) => setEditSupplierId(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-300 bg-white font-bold"
                  >
                    <option value="">مورد نقدي</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">المستودع المستلم:</label>
                  <select
                    value={editWarehouseId}
                    onChange={(e) => setEditWarehouseId(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-300 bg-white font-bold"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">تاريخ الفاتورة:</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-300 bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">إجمالي الخصم ({settings.currency}):</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full p-2 rounded-xl border border-slate-300 bg-white font-bold"
                  />
                </div>
              </div>

              {/* Add another item inside Edit Modal */}
              <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-200 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                <div className="sm:col-span-5">
                  <label className="block font-bold text-slate-700 mb-1">إضافة صنف آخر للفاتورة:</label>
                  <ProductSearchSelect
                    products={products}
                    selectedProductId={editAddProdId}
                    warehouseId={editWarehouseId}
                    warehouses={warehouses}
                    priceMode="purchase"
                    currency={settings.currency}
                    placeholder="ابحث لإضافة صنف..."
                    onSelect={handleEditPickProduct}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">الكمية:</label>
                  <QuantityInput
                    allowDecimals
                    min={0.001}
                    value={editAddQty}
                    onChange={setEditAddQty}
                    placeholder="الكمية"
                    ariaLabel="كمية صنف مضاف"
                    inputClassName="w-full p-2 rounded-xl border border-slate-300 bg-white text-center font-mono font-bold"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block font-bold text-slate-700 mb-1">سعر الشراء:</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    placeholder="السعر"
                    value={editAddPrice}
                    onChange={(e) => setEditAddPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    className="w-full p-2 rounded-xl border border-slate-300 bg-white text-center font-mono font-bold"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={handleAddItemToEdit}
                    className="w-full py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold cursor-pointer"
                  >
                    + إضافة
                  </button>
                </div>
              </div>

              {/* Editable items table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden awlad-table-scroll">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                      <th className="p-2.5">الصنف</th>
                      <th className="p-2.5 text-center">الوحدة</th>
                      <th className="p-2.5 text-center w-24">الكمية</th>
                      <th className="p-2.5 text-center w-28">سعر الشراء</th>
                      <th className="p-2.5 text-center">الإجمالي</th>
                      <th className="p-2.5 text-center w-12">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editItems.map((item, idx) => {
                      const prodObj = products.find((p) => p.id === item.productId);
                      const unitOptions = prodObj
                        ? [
                            { name: prodObj.baseUnit, factor: 1 },
                            ...(prodObj.units || []).map((u) => ({ name: u.name, factor: u.conversionFactor || 1 })),
                          ]
                        : [{ name: item.unit, factor: item.unitFactor || 1 }];
                      return (
                        <tr key={`${item.productId}-${idx}`}>
                          <td className="p-2.5 font-bold text-slate-800">{item.productName}</td>
                          <td className="p-2.5 text-center">
                            <select
                              value={item.unit}
                              onChange={(e) => {
                                const chosen = unitOptions.find((u) => u.name === e.target.value) || { name: e.target.value, factor: 1 };
                                setEditItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? {
                                          ...it,
                                          unit: chosen.name,
                                          unitFactor: chosen.factor,
                                          purchasePriceAtTime: chosen.factor > 0 ? Number((it.unitPrice / chosen.factor).toFixed(2)) : it.unitPrice,
                                        }
                                      : it
                                  )
                                );
                              }}
                              className="p-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                            >
                              {unitOptions.map((u) => (
                                <option key={u.name} value={u.name}>{u.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2.5 text-center">
                            <QuantityInput
                              allowDecimals
                              min={0.001}
                              value={item.quantity}
                              onChange={(newQty) => {
                                setEditItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? { ...it, quantity: newQty, total: computeLineTotal(newQty, it.unitPrice, it.discount || 0) }
                                      : it
                                  )
                                );
                              }}
                              ariaLabel={`كمية ${item.productName}`}
                              inputClassName="w-20 p-1.5 rounded-lg border border-slate-300 text-center font-bold font-mono outline-hidden focus:border-blue-700"
                            />
                          </td>
                          <td className="p-2.5 text-center">
                            <input
                              type="number"
                              min={0}
                              step="0.5"
                              value={item.unitPrice}
                              onChange={(e) => {
                                const newPrice = Math.max(0, parseFloat(e.target.value) || 0);
                                setEditItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? {
                                          ...it,
                                          unitPrice: newPrice,
                                          purchasePriceAtTime: (it.unitFactor || 1) > 0 ? Number((newPrice / (it.unitFactor || 1)).toFixed(2)) : newPrice,
                                          total: computeLineTotal(it.quantity, newPrice, it.discount || 0),
                                        }
                                      : it
                                  )
                                );
                              }}
                              className="w-24 p-1.5 rounded-lg border border-slate-300 text-center font-bold font-mono"
                            />
                          </td>
                          <td className="p-2.5 text-center font-black text-blue-900">
                            {computeLineTotal(item.quantity, item.unitPrice, item.discount || 0).toLocaleString()} {settings.currency}
                          </td>
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              disabled={editItems.length <= 1}
                              onClick={() => setEditItems((prev) => prev.filter((_, i) => i !== idx))}
                              className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded disabled:opacity-30 cursor-pointer"
                              title="حذف البند"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات الفاتورة:</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  سبب التعديل {editModalInvoice.status === 'confirmed' ? '(إلزامي للتدقيق):' : '(اختياري):'}{' '}
                  {editModalInvoice.status === 'confirmed' && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  required={editModalInvoice.status === 'confirmed'}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="مثال: تعديل كميات أو أسعار التوريد من المورد..."
                  className="w-full p-2.5 rounded-xl border border-slate-300 font-semibold focus:border-blue-600 outline-hidden"
                />
              </div>

              {(() => {
                const sub = editItems.reduce((acc, it) => acc + computeLineTotal(it.quantity, it.unitPrice, it.discount || 0), 0);
                const grand = Math.max(0, sub - Math.max(0, Number(editDiscount || 0)));
                const diff = grand - editModalInvoice.grandTotal;
                const belowPaid = grand < Number(editModalInvoice.paidAmount || 0) - 0.01;
                return (
                  <div className="space-y-2">
                    <div className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${belowPaid ? 'bg-red-50 border-red-300' : 'bg-blue-50/70 border-blue-200'}`}>
                      <div>
                        <span className="text-slate-600 block text-[10px]">الإجمالي المعدّل:</span>
                        <strong className="text-sm font-black text-blue-950">{grand.toLocaleString()} {settings.currency}</strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block text-[10px]">المدفوع مسبقاً:</span>
                        <strong className="text-sm font-bold text-emerald-700">{editModalInvoice.paidAmount.toLocaleString()} {settings.currency}</strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block text-[10px]">المتبقي للمورد بعد التعديل:</span>
                        <strong className="text-sm font-bold text-red-700">{Math.max(0, grand - editModalInvoice.paidAmount).toLocaleString()} {settings.currency}</strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block text-[10px]">الفرق عن الأصل:</span>
                        <strong className={`text-sm font-black ${diff > 0 ? 'text-red-700' : diff < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                          {diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()} {settings.currency}
                        </strong>
                      </div>
                    </div>
                    {belowPaid && (
                      <div className="text-[11px] font-bold text-red-700">
                        تحذير: الإجمالي المعدّل أقل من المبلغ المدفوع مسبقاً للمورد ولن يُسمح بالحفظ.
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setEditModalInvoice(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit || editItems.length === 0 || (editItems.reduce((acc, it) => acc + computeLineTotal(it.quantity, it.unitPrice, it.discount || 0), 0) - Math.max(0, Number(editDiscount || 0))) < Number(editModalInvoice.paidAmount || 0) - 0.01}
                  className="px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-black transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingEdit ? 'جاري حفظ التعديل...' : 'حفظ وتحديث الفاتورة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

      {sendModalInvoice && (
        <Modal
          isOpen={Boolean(sendModalInvoice)}
          onClose={() => !isSendingModalBusy && setSendModalInvoice(null)}
          title={`${sendModalInvoice.dispatchStatus === 'rejected' ? 'إعادة إرسال' : 'إرسال'} فاتورة الشراء (${sendModalInvoice.invoiceNumber}) للإدارة`}
          maxWidth="md"
        >
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-bold">
              سيتم توجيه الفاتورة للإدارة للاستلام والمراجعة فقط دون تعديل المخزون أو حساب المورد أو الخزينة حتى الاعتماد.
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">المسؤول الموجه إليه:</label>
              <select
                value={sendModalRecipientId}
                onChange={(e) => setSendModalRecipientId(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold"
              >
                <option value="">الإدارة العامة (جميع المسؤولين المختصين)</option>
                {purchaseReceivers.map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName} ({r.role})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">ملاحظة للإدارة (اختياري):</label>
              <input
                type="text"
                value={sendModalNotes}
                onChange={(e) => setSendModalNotes(e.target.value)}
                placeholder="مثال: تم شراء البضاعة وبانتظار مراجعة التسعير والكميات..."
                className="w-full p-2.5 rounded-xl border border-slate-300"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isSendingModalBusy}
                onClick={() => setSendModalInvoice(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSendingModalBusy}
                onClick={async () => {
                  const chosen = purchaseReceivers.find((r) => r.id === sendModalRecipientId);
                  setIsSendingModalBusy(true);
                  const res = await sendPurchaseInvoice(sendModalInvoice.id, {
                    recipientUserId: chosen?.id || undefined,
                    recipientName: chosen?.fullName || 'الإدارة العامة',
                    notes: sendModalNotes.trim() || undefined,
                  });
                  setIsSendingModalBusy(false);
                  if (res.success) {
                    setSendModalInvoice(null);
                    setActionMessage({
                      type: 'success',
                      text: `تم إرسال فاتورة الشراء (${sendModalInvoice.invoiceNumber}) إلى ${chosen?.fullName || 'الإدارة العامة'} بانتظار الاستلام والاعتماد.`,
                    });
                  } else {
                    setActionMessage({ type: 'error', text: res.error || 'تعذر إرسال الفاتورة' });
                  }
                }}
                className="px-5 py-2 rounded-xl bg-indigo-800 hover:bg-indigo-900 text-white font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>{isSendingModalBusy ? 'جاري الإرسال...' : 'تأكيد الإرسال'}</span>
              </button>
            </div>
          </div>
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

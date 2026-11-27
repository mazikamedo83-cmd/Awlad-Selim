import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Printer, Save, CheckCircle2, XCircle, PackagePlus, AlertTriangle,
  Eye, Edit, AlertCircle, History, Clock, Send, UserCheck, Barcode
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { apiRequest } from '../../../services/api';
import { Invoice, InvoiceItem, InlinePurchaseNewProduct, Product, SupplierPriceHistoryEntry } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import {
  LinkedGroupCategoryFilter,
  filterProductsByGroupCategory,
  getScopedCategoriesForGroup,
  resolveGroupCategoryCascade,
} from '../../common/LinkedGroupCategoryFilter';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import { SearchableTaxonomySelect } from '../../common/SearchableTaxonomySelect';
import { EditableItemGrid, EditableGridRow } from '../../common/EditableItemGrid';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { QuantityInput } from '../../common/QuantityInput';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { computeLineTotal, roundCurrency } from '../../../utils/quantity';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime, formatLocaleNumber, translateSystemEntityName } from '../../../i18n/translator';

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
  groupId?: string;
  groupName?: string;
  categoryId?: string;
  categoryName?: string;
  notes?: string;
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
    invoices, suppliers, products, productGroups = [], categories = [], productUnits = [], warehouses, cashboxes, purchaseReceivers = [],
    settings, createPurchaseInvoice, editPurchaseInvoice, cancelInvoice,
    sendPurchaseInvoice, receivePurchaseInvoice, rejectPurchaseInvoice, confirmDraftInvoice,
    addProductGroup, updateProductGroup, addCategory, updateCategory, addProductUnit, updateProductUnit,
    getSupplierPriceHistory,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const { t, locale } = usePreferences();
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

  const purchaseGroupTriggerRef = useRef<HTMLButtonElement | null>(null);
  const purchaseCategoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);
  const unitPriceInputRef = useRef<HTMLInputElement | null>(null);

  const editGroupTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editCategoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editProductSearchRef = useRef<HTMLInputElement | null>(null);
  const editQtyInputRef = useRef<HTMLInputElement | null>(null);
  const editPriceInputRef = useRef<HTMLInputElement | null>(null);

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
  const [editDiscount, setEditDiscount] = useState<number | ''>('');
  const [editNotes, setEditNotes] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editItems, setEditItems] = useState<InvoiceItem[]>([]);
  const [editGroupFilter, setEditGroupFilter] = useState('');
  const [editCatFilter, setEditCatFilter] = useState('');
  const [editAddProdId, setEditAddProdId] = useState('');
  const [editAddQty, setEditAddQty] = useState<number | ''>('');
  const [editAddPrice, setEditAddPrice] = useState<number | ''>('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // New Purchase Form state (zero unintended auto-selections)
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'partial'>('partial');
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [discountTotal, setDiscountTotal] = useState<number | ''>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplierPriceHistoryMap, setSupplierPriceHistoryMap] = useState<Record<string, SupplierPriceHistoryEntry[]>>({});

  // Items
  const [items, setItems] = useState<PurchaseDraftItem[]>([]);

  // Classic Item Entry states
  const [purchaseGroupFilter, setPurchaseGroupFilter] = useState('');
  const [purchaseCatFilter, setPurchaseCatFilter] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [itemProdId, setItemProdId] = useState('');
  const [itemUnitName, setItemUnitName] = useState('');
  const [itemQty, setItemQty] = useState<number | ''>('');
  const [itemPrice, setItemPrice] = useState<number | ''>('');

  // Inline new product creation state
  const [showInlineNewProduct, setShowInlineNewProduct] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdBarcode, setNewProdBarcode] = useState('');
  const [newProdCode, setNewProdCode] = useState('');
  const [newProdGroupId, setNewProdGroupId] = useState('');
  const [newProdCategoryId, setNewProdCategoryId] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('');
  const [newProdClass1, setNewProdClass1] = useState('');
  const [newProdClass2, setNewProdClass2] = useState('');
  const [newProdUnitId, setNewProdUnitId] = useState('');
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
    setSelectedSupplierId('');
    setSelectedWarehouseId('');
    setSelectedCashboxId('');
    setItems([]);
    setPurchaseGroupFilter('');
    setPurchaseCatFilter('');
    setBarcodeInput('');
    setItemProdId('');
    setItemUnitName('');
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
    setNewProdGroupId('');
    setNewProdCategoryId('');
    setNewProdCategory('');
    setNewProdClass1('');
    setNewProdClass2('');
    setNewProdUnitId('');
    setNewProdBaseUnit('');
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

  useEffect(() => {
    const activeSupId = isNewModalOpen ? selectedSupplierId : editModalInvoice ? editSupplierId : '';
    let cancelled = false;
    if (!activeSupId) {
      setSupplierPriceHistoryMap({});
      return;
    }
    getSupplierPriceHistory(activeSupId).then((hist) => {
      if (!cancelled) setSupplierPriceHistoryMap(hist || {});
    });
    return () => {
      cancelled = true;
    };
  }, [isNewModalOpen, selectedSupplierId, editModalInvoice, editSupplierId, getSupplierPriceHistory]);

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
      return { label: t('ملغاة', 'Cancelled'), cls: 'bg-red-50 text-red-700 border border-red-200' };
    }
    if (inv.status === 'confirmed') {
      return { label: t('مؤكدة ومعتمدة', 'Confirmed & Approved'), cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200' };
    }
    switch (inv.dispatchStatus) {
      case 'sent':
        return { label: t('مرسلة بانتظار الاستلام', 'Sent (Awaiting Receipt)'), cls: 'bg-amber-50 text-amber-900 border border-amber-200' };
      case 'received':
        return { label: t('تم الاستلام (بانتظار الاعتماد)', 'Received (Pending Approval)'), cls: 'bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5]' };
      case 'rejected':
        return { label: t('مرفوضة', 'Rejected'), cls: 'bg-rose-50 text-rose-800 border border-rose-200' };
      default:
        return { label: t('مسودة', 'Draft'), cls: 'bg-slate-100 text-slate-700 border border-slate-200' };
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

  const filteredPurchaseProducts = useMemo(
    () =>
      filterProductsByGroupCategory(
        products,
        productGroups,
        categories,
        purchaseGroupFilter,
        purchaseCatFilter
      ),
    [products, productGroups, categories, purchaseGroupFilter, purchaseCatFilter]
  );

  const filteredEditProducts = useMemo(
    () =>
      filterProductsByGroupCategory(
        products,
        productGroups,
        categories,
        editGroupFilter,
        editCatFilter
      ),
    [products, productGroups, categories, editGroupFilter, editCatFilter]
  );

  const inlineScopedCategories = useMemo(
    () => getScopedCategoriesForGroup(categories, newProdGroupId === '' ? 'all' : newProdGroupId),
    [categories, newProdGroupId]
  );

  const activeGroupsList = useMemo(
    () => productGroups.filter((g) => g.status !== 'suspended'),
    [productGroups]
  );

  const selectedPurchaseProduct = useMemo(
    () => products.find((p) => p.id === itemProdId) || null,
    [products, itemProdId]
  );

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) || null,
    [suppliers, selectedSupplierId]
  );

  const purchaseUnitOptions = useMemo(() => {
    if (!selectedPurchaseProduct) return [];
    return [
      {
        name: selectedPurchaseProduct.baseUnit,
        conversionFactor: 1,
        purchasePrice: selectedPurchaseProduct.purchasePrice,
      },
      ...(selectedPurchaseProduct.units || []).map((u) => ({
        name: u.name,
        conversionFactor: u.conversionFactor || 1,
        purchasePrice: u.purchasePrice || selectedPurchaseProduct.purchasePrice * (u.conversionFactor || 1),
      })),
    ];
  }, [selectedPurchaseProduct]);

  const supplierProductHistoryEntries = useMemo(() => {
    if (!selectedSupplierId || !selectedPurchaseProduct) return [];
    const raw = supplierPriceHistoryMap[selectedPurchaseProduct.id] || [];
    const curUnit = purchaseUnitOptions.find(
      (u) => u.name === (itemUnitName || selectedPurchaseProduct.baseUnit)
    );
    const curFactor = Number(curUnit?.conversionFactor || 1);
    return raw
      .slice(0, 3)
      .map((entry) => {
        const histFactor = Number(entry.unitFactor || 1) || 1;
        const adj = Math.round(((Number(entry.price || 0) / histFactor) * curFactor) * 100) / 100;
        return {
          unitPrice: adj,
          date: entry.date || '',
          invoiceNumber: entry.invoiceNumber || '',
        };
      })
      .filter((e) => e.unitPrice > 0);
  }, [selectedSupplierId, selectedPurchaseProduct, supplierPriceHistoryMap, purchaseUnitOptions, itemUnitName]);

  const handleProductPick = (prodId: string) => {
    setItemProdId(prodId);
    const p = products.find((prod) => prod.id === prodId);
    if (!p) return;
    setItemUnitName(p.baseUnit);
    setItemQty('');
    setItemPrice(p.purchasePrice > 0 ? p.purchasePrice : '');
    setError(null);
    window.setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 30);
  };

  const handlePurchaseUnitSelect = (unitName: string) => {
    setItemUnitName(unitName);
    const matched = purchaseUnitOptions.find((u) => u.name === unitName);
    if (matched) {
      setItemPrice(matched.purchasePrice > 0 ? matched.purchasePrice : '');
    }
  };

  const handlePurchaseBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    const barcode = barcodeInput.trim();
    const prod = products.find(
      (p) =>
        p.barcode === barcode ||
        p.code === barcode ||
        p.units.some((u) => u.barcode === barcode)
    );
    if (prod) {
      const unitMatch = prod.units.find((u) => u.barcode === barcode);
      const unitBuy = unitMatch ? unitMatch.purchasePrice : prod.purchasePrice;
      setItemProdId(prod.id);
      setItemUnitName(unitMatch?.name || prod.baseUnit);
      setItemQty('');
      setItemPrice(unitBuy > 0 ? unitBuy : '');
      setBarcodeInput('');
      setError(null);
      window.setTimeout(() => {
        qtyInputRef.current?.focus();
        qtyInputRef.current?.select();
      }, 30);
    } else {
      setError(
        t(
          `لم يتم العثور على صنف بالباركود أو الكود: ${barcode}`,
          `No item found with barcode or code: ${barcode}`
        )
      );
    }
  };

  const handleUseExistingDuplicateProduct = (prod: Product) => {
    setShowInlineNewProduct(false);
    setItemProdId(prod.id);
    setItemUnitName(prod.baseUnit);
    const price = prod.purchasePrice > 0 ? prod.purchasePrice : '';
    const qty = newProdQty !== '' && Number(newProdQty) > 0 ? Number(newProdQty) : '';
    setItemPrice(price);
    setItemQty(qty);
    setError(null);
    window.setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 30);
  };

  const handleAddItem = () => {
    const prod = products.find((p) => p.id === itemProdId);
    if (!prod) {
      setError(t('يرجى اختيار الصنف أولاً', 'Please select a product first'));
      return;
    }
    const qtyNum = Number(itemQty || 0);
    if (qtyNum <= 0) {
      setError(t('يرجى إدخال كمية صحيحة أكبر من صفر', 'Please enter a valid quantity greater than zero'));
      return;
    }
    const priceNum = Math.max(0, Number(itemPrice || 0));
    const effectiveUnit = itemUnitName || prod.baseUnit;
    const unitOpt = purchaseUnitOptions.find((u) => u.name === effectiveUnit);
    const unitFactor = unitOpt?.conversionFactor || 1;
    const total = computeLineTotal(qtyNum, priceNum, 0);

    setItems((prev) => {
      const existingIdx = prev.findIndex(
        (it) => it.productId === prod.id && it.unit === effectiveUnit
      );
      if (existingIdx >= 0) {
        return prev.map((it, idx) => {
          if (idx !== existingIdx) return it;
          const nextQty = Number((it.quantity + qtyNum).toFixed(4));
          return {
            ...it,
            quantity: nextQty,
            unitPrice: priceNum,
            purchasePriceAtTime: priceNum,
            total: computeLineTotal(nextQty, priceNum, it.discount || 0),
          };
        });
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          barcode: prod.barcode,
          unit: effectiveUnit,
          unitFactor,
          quantity: qtyNum,
          unitPrice: priceNum,
          purchasePriceAtTime: priceNum,
          discount: 0,
          total,
          groupId: prod.groupId,
          groupName: prod.groupName,
          categoryId: prod.categoryId,
          categoryName: prod.category,
        },
      ];
    });
    setItemProdId('');
    setItemUnitName('');
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
      setError(t('يرجى إدخال اسم الصنف الجديد', 'Please enter the new product name'));
      return;
    }
    const qtyNum = Number(newProdQty || 0);
    if (qtyNum <= 0) {
      setError(t('يرجى إدخال كمية الشراء للصنف الجديد أكبر من صفر', 'Please enter purchase quantity greater than zero'));
      return;
    }
    const buyPrice = Math.max(0, Number(newProdPurchasePrice || 0));
    const sellPrice = newProdSellingPrice === '' ? 0 : Math.max(0, Number(newProdSellingPrice || 0));

    // Prevent exact duplicate creation by auto-binding to the existing product
    const exact = duplicateCheckState.exactMatch;
    if (exact) {
      const total = computeLineTotal(qtyNum, buyPrice || exact.purchasePrice || 0);
      const effectiveBuy = buyPrice || exact.purchasePrice || 0;
      setItems((prev) => {
        const existingIdx = prev.findIndex((it) => it.productId === exact.id && it.unit === exact.baseUnit);
        if (existingIdx >= 0) {
          return prev.map((it, idx) => {
            if (idx !== existingIdx) return it;
            const nextQty = Number((it.quantity + qtyNum).toFixed(4));
            return {
              ...it,
              quantity: nextQty,
              unitPrice: effectiveBuy,
              purchasePriceAtTime: effectiveBuy,
              total: computeLineTotal(nextQty, effectiveBuy, it.discount || 0),
            };
          });
        }
        return [
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
            groupId: exact.groupId,
            groupName: exact.groupName,
            categoryId: exact.categoryId,
            categoryName: exact.category,
          },
        ];
      });
      setActionMessage({
        type: 'success',
        text: t(`تم ربط البند بالصنف المسجل مسبقاً (${exact.name}) لمنع التكرار في المخزن.`, `Linked line item to existing product (${exact.name}) to prevent warehouse duplication.`),
      });
    } else {
      const chosenGroup = productGroups.find((g) => g.id === newProdGroupId);
      const chosenCat = categories.find((c) => c.id === newProdCategoryId);
      const cleanCategory = (chosenCat?.name || newProdCategory).trim();
      const cleanUnit = newProdBaseUnit.trim();
      if (!cleanUnit) {
        setError(t('يرجى اختيار أو كتابة الوحدة للصنف الجديد', 'Please select or enter a unit for the new product'));
        return;
      }
      const matchedCatalogUnit =
        (newProdUnitId ? productUnits.find((u) => u.id === newProdUnitId) : undefined) ||
        productUnits.find((u) => normalizeArabicNameForDup(u.name) === normalizeArabicNameForDup(cleanUnit));
      const cleanBarcode = newProdBarcode.trim();
      const cleanCode = newProdCode.trim();
      const total = computeLineTotal(qtyNum, buyPrice);
      setItems((prev) => [
        ...prev,
        {
          productId: '',
          productName: cleanName,
          barcode: cleanBarcode || cleanCode,
          unit: matchedCatalogUnit?.name || cleanUnit,
          unitFactor: 1,
          quantity: qtyNum,
          unitPrice: buyPrice,
          purchasePriceAtTime: buyPrice,
          discount: 0,
          total,
          groupId: chosenGroup?.id || chosenCat?.groupId,
          groupName: chosenGroup?.name,
          categoryId: chosenCat?.id,
          categoryName: cleanCategory || undefined,
          newProduct: {
            name: cleanName,
            barcode: cleanBarcode || undefined,
            code: cleanCode || undefined,
            groupId: chosenGroup?.id || chosenCat?.groupId,
            groupName: chosenGroup?.name,
            categoryId: chosenCat?.id,
            category: cleanCategory,
            class1: newProdClass1.trim() || undefined,
            class2: newProdClass2.trim() || undefined,
            unitId: matchedCatalogUnit?.id || (newProdUnitId || undefined),
            baseUnit: matchedCatalogUnit?.name || cleanUnit,
            purchasePrice: buyPrice,
            sellingPrice: sellPrice,
          },
        },
      ]);
    }

    setNewProdName('');
    setNewProdBarcode('');
    setNewProdCode('');
    setNewProdGroupId('');
    setNewProdCategoryId('');
    setNewProdCategory('');
    setNewProdClass1('');
    setNewProdClass2('');
    setNewProdUnitId('');
    setNewProdBaseUnit('');
    setNewProdQty('');
    setNewProdPurchasePrice('');
    setNewProdSellingPrice('');
    setDuplicateCheckState({ checking: false, exactMatch: null, matchedBy: null, similarMatches: [] });
    setShowInlineNewProduct(false);
    setError(null);
  };

  const subtotal = useMemo(
    () => roundCurrency(items.reduce((a, b) => a + b.quantity * b.unitPrice, 0)),
    [items]
  );
  const itemDiscountsTotal = useMemo(
    () => roundCurrency(items.reduce((a, b) => a + (b.discount || 0), 0)),
    [items]
  );
  const generalDiscountNum = useMemo(
    () => Math.max(0, roundCurrency(Number(discountTotal || 0))),
    [discountTotal]
  );
  const numericDiscount = useMemo(
    () => roundCurrency(itemDiscountsTotal + generalDiscountNum),
    [itemDiscountsTotal, generalDiscountNum]
  );
  const grandTotal = useMemo(
    () => Math.max(0, roundCurrency(subtotal - numericDiscount)),
    [subtotal, numericDiscount]
  );

  useEffect(() => {
    if (paymentType === 'cash') {
      setPaidAmount(grandTotal > 0 ? grandTotal : '');
    } else if (paymentType === 'credit') {
      setPaidAmount('');
    } else if (paymentType === 'partial') {
      setPaidAmount((prev) => {
        if (prev === '' || prev === undefined) return '';
        const n = Number(prev);
        if (!Number.isFinite(n) || n < 0) return '';
        return n > grandTotal ? grandTotal : prev;
      });
    }
  }, [paymentType, grandTotal]);

  const numericPaid = useMemo(() => {
    if (paymentType === 'cash') return grandTotal;
    if (paymentType === 'credit') return 0;
    return Math.min(grandTotal, Math.max(0, Number(paidAmount || 0)));
  }, [grandTotal, paidAmount, paymentType]);

  const remainingAmount = useMemo(() => {
    if (paymentType === 'cash') return 0;
    return Math.max(0, roundCurrency(grandTotal - numericPaid));
  }, [grandTotal, numericPaid, paymentType]);

  const supplierPrevBalance = selectedSupplier ? Number(selectedSupplier.currentBalance || 0) : null;
  const supplierAfterBalance =
    supplierPrevBalance !== null ? roundCurrency(supplierPrevBalance + remainingAmount) : null;

  const handlePrint = useCallback((inv: Invoice) => {
    setPrintData({
      title: t('فاتورة مشتريات وتوريد بضائع', 'Purchase & Supply Invoice'),
      docNumber: inv.invoiceNumber,
      docType: t('فاتورة مشتريات', 'Purchase Invoice'),
      date: inv.date,
      partyName: inv.supplierName ? translateSystemEntityName(inv.supplierName) : undefined,
      warehouseName: inv.warehouseName ? translateSystemEntityName(inv.warehouseName) : undefined,
      grandTotal: inv.grandTotal,
      paidAmount: inv.paidAmount,
      remainingAmount: inv.remainingAmount,
      items: inv.items.map(it => ({
        name: it.productName,
        unit: t(it.unit),
        quantity: it.quantity,
        price: it.unitPrice,
        total: it.total,
      })),
      notes: inv.notes,
    });
    setIsPrintModalOpen(true);
  }, [t]);

  const handleSubmitPurchase = useCallback(async (shouldPrint: boolean, sendToAdmin = false) => {
    if (isSubmitting) return;
    if (items.length === 0) {
      setError(t('يرجى إضافة أصناف لفاتورة الشراء', 'Please add items to the purchase invoice'));
      return;
    }
    if (!selectedWarehouseId) {
      setError(t('يرجى اختيار المستودع المستلم', 'Please select the receiving warehouse'));
      return;
    }
    const rawPaid = Number(paidAmount || 0);
    const estPaid = paymentType === 'cash' ? grandTotal : paymentType === 'credit' ? 0 : Math.min(grandTotal, rawPaid);
    if (paymentType !== 'credit' && estPaid > 0 && !selectedCashboxId) {
      setError(t('يرجى اختيار الخزينة المصروف منها', 'Please select the disbursing cashbox'));
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      const supp = suppliers.find(s => s.id === selectedSupplierId);
      const wh = warehouses.find(w => w.id === selectedWarehouseId);
      if (paymentType === 'partial' && rawPaid < 0) {
        setError(t('المبلغ المدفوع لا يمكن أن يكون سالباً', 'Paid amount cannot be negative'));
        return;
      }

      const effectivePaid = estPaid;
      const effectiveCashboxId = paymentType === 'credit' || effectivePaid <= 0 ? '' : selectedCashboxId;
      const chosenReceiver = purchaseReceivers.find((r) => r.id === newRecipientUserId);
      const createAsDraft = sendToAdmin || !canApprovePurchase;
      const itemNotesSummary = items
        .filter((it) => it.notes && it.notes.trim())
        .map((it) => `${it.productName}: ${it.notes!.trim()}`)
        .join(' | ');
      const combinedNotes = [notes.trim(), itemNotesSummary].filter(Boolean).join(' — ');

      const res = await createPurchaseInvoice({
        date: invoiceDate,
        supplierId: selectedSupplierId,
        supplierName: supp?.name || 'مورد عام',
        warehouseId: selectedWarehouseId,
        warehouseName: wh?.name || 'المستودع الرئيسي',
        items: items.map(({ notes: _n, ...rest }) => rest),
        subtotal,
        discountTotal: numericDiscount,
        taxTotal: 0,
        grandTotal,
        paidAmount: effectivePaid,
        remainingAmount: Math.max(0, roundCurrency(grandTotal - effectivePaid)),
        paymentType,
        paymentMethod: 'cash',
        cashboxId: effectiveCashboxId,
        status: createAsDraft ? 'draft' : 'confirmed',
        dispatchStatus: createAsDraft ? (sendToAdmin ? 'sent' : 'draft') : 'confirmed',
        sendNow: createAsDraft && sendToAdmin,
        recipientUserId: createAsDraft && sendToAdmin ? chosenReceiver?.id : undefined,
        recipientName: createAsDraft && sendToAdmin ? (chosenReceiver?.fullName || 'الإدارة العامة') : undefined,
        notes: combinedNotes,
      });

      if (res.success) {
        setIsNewModalOpen(false);
        resetPurchaseModalForm();
        setNewRecipientUserId('');
        setActionMessage({
          type: 'success',
          text: !createAsDraft
            ? t(`تم حفظ فاتورة المشتريات رقم (${res.invoice?.invoiceNumber || ''}) وتحديث المخزون والأصناف بنجاح.`, `Purchase invoice (${res.invoice?.invoiceNumber || ''}) saved and inventory updated successfully.`)
            : sendToAdmin
            ? t(`تم حفظ فاتورة الشراء وإرسالها للإدارة (${res.invoice?.invoiceNumber || ''}) بانتظار الاستلام والاعتماد دون تعديل الأرصدة.`, `Purchase invoice (${res.invoice?.invoiceNumber || ''}) saved and sent to management pending receipt and approval without affecting balances.`)
            : t(`تم حفظ فاتورة الشراء كمسودة (${res.invoice?.invoiceNumber || ''}) بانتظار الإرسال أو المراجعة دون تعديل المخزون.`, `Purchase invoice saved as draft (${res.invoice?.invoiceNumber || ''}) pending submission or review without modifying stock.`),
        });
        if (shouldPrint && res.invoice) {
          handlePrint(res.invoice);
        }
      } else {
        setError(res.error ? t(res.error) : t('فشل حفظ فاتورة الشراء', 'Failed to save purchase invoice'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting, items, suppliers, selectedSupplierId, warehouses, selectedWarehouseId, paymentType, grandTotal,
    paidAmount, createPurchaseInvoice, invoiceDate, subtotal, numericDiscount, selectedCashboxId,
    notes, handlePrint, resetPurchaseModalForm, canApprovePurchase, purchaseReceivers, newRecipientUserId, t
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
      setActionMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر إلغاء فاتورة الشراء', 'Unable to cancel purchase invoice') });
    } else {
      setActionMessage({ type: 'success', text: t(`تم إلغاء فاتورة الشراء (${cancelTarget.invoiceNumber}) بنجاح.`, `Purchase invoice (${cancelTarget.invoiceNumber}) cancelled successfully.`) });
      setCancelTarget(null);
    }
  };

  const handleOpenEditModal = (inv: Invoice) => {
    setEditModalInvoice(inv);
    setEditDate(inv.date);
    setEditSupplierId(inv.supplierId || '');
    setEditWarehouseId(inv.warehouseId || '');
    setEditDiscount(inv.discountTotal ? inv.discountTotal : '');
    setEditNotes(inv.notes || '');
    setEditReason('');
    setEditItems(inv.items.map((it) => ({ ...it })));
    setEditGroupFilter('');
    setEditCatFilter('');
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
      setEditError(t('يرجى اختيار الصنف أولاً لإضافته للفاتورة', 'Please select a product first to add it to the invoice'));
      return;
    }
    const qtyNum = Number(editAddQty || 0);
    if (qtyNum <= 0) {
      setEditError(t('يرجى إدخال كمية صحيحة أكبر من صفر', 'Please enter a valid quantity greater than zero'));
      return;
    }
    const priceNum = Math.max(0, Number(editAddPrice || 0));
    setEditItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.productId === prod.id && it.unit === prod.baseUnit);
      if (existingIdx >= 0) {
        return prev.map((it, idx) => {
          if (idx !== existingIdx) return it;
          const nextQty = Number((it.quantity + qtyNum).toFixed(4));
          return {
            ...it,
            quantity: nextQty,
            unitPrice: priceNum,
            purchasePriceAtTime: priceNum,
            total: computeLineTotal(nextQty, priceNum, it.discount || 0),
          };
        });
      }
      return [
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
          groupId: prod.groupId,
          groupName: prod.groupName,
          categoryId: prod.categoryId,
          categoryName: prod.category,
        },
      ];
    });
    setEditAddProdId('');
    setEditAddQty('');
    setEditAddPrice('');
    setEditError(null);
    window.setTimeout(() => editProductSearchRef.current?.focus(), 30);
  };

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalInvoice) return;
    if (editItems.length === 0) {
      setEditError(t('يجب أن تحتوي فاتورة المشتريات على صنف واحد على الأقل.', 'Purchase invoice must contain at least one item.'));
      return;
    }
    if (editModalInvoice.status === 'confirmed' && !editReason.trim()) {
      setEditError(t('يرجى كتابة سبب تعديل الفاتورة لتوثيقه في سجل المراجعة.', 'Please enter the edit reason to log it in the audit trail.'));
      return;
    }
    const subtotalNext = editItems.reduce((s, it) => s + computeLineTotal(it.quantity, it.unitPrice, it.discount || 0), 0);
    const grandNext = Math.max(0, subtotalNext - Math.max(0, Number(editDiscount || 0)));
    if (grandNext < Number(editModalInvoice.paidAmount || 0) - 0.01) {
      setEditError(
        t(
          `لا يمكن أن يكون الإجمالي المعدل (${formatLocaleNumber(grandNext)}) أقل من المبلغ المدفوع مسبقاً (${formatLocaleNumber(Number(editModalInvoice.paidAmount || 0))}).`,
          `Edited total (${formatLocaleNumber(grandNext)}) cannot be less than previously paid amount (${formatLocaleNumber(Number(editModalInvoice.paidAmount || 0))}).`
        )
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
      setEditError(res.error ? t(res.error) : t('تعذر تعديل فاتورة المشتريات', 'Unable to update purchase invoice'));
    } else {
      setEditModalInvoice(null);
      setActionMessage({
        type: 'success',
        text: res.queuedOffline
          ? t(`تم حفظ تعديل فاتورة المشتريات (${editModalInvoice.invoiceNumber}) محلياً للمزامنة عند عودة الاتصال.`, `Purchase invoice (${editModalInvoice.invoiceNumber}) edit saved locally to sync once back online.`)
          : t(`تم تحديث فاتورة المشتريات رقم (${editModalInvoice.invoiceNumber}) والمخزون ورصيد المورد بنجاح.`, `Purchase invoice (${editModalInvoice.invoiceNumber}), inventory, and supplier balance updated successfully.`),
      });
    }
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight">{t('إدارة فواتير المشتريات', 'Purchase Invoices Management')}</h2>
          <p className="text-[11px] text-slate-500">
            {t('توثيق توريدات البضائع الغذائية من المصانع والمطاحن وزيادة أرصدة المخازن آلياً', 'Record food supply deliveries from factories & mills and update warehouse stock automatically')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {repIncomingPendingCount > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter('rep_incoming')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-xs font-black cursor-pointer hover:bg-amber-100"
            >
              <Send className="w-3.5 h-3.5 text-amber-700" />
              <span>{t('وارد من المناديب', 'Incoming from Reps')} ({repIncomingPendingCount})</span>
            </button>
          )}
          <button
            onClick={() => {
              resetPurchaseModalForm();
              setIsNewModalOpen(true);
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('فاتورة شراء جديدة', 'New Purchase Invoice')}</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
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
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {/* Table */}
      <UnifiedDataTable<Invoice>
        compact
        title={t('سجل فواتير المشتريات', 'Purchase Invoices Log')}
        subtitle={t('فواتير الشراء المعتمدة والمسودات وفواتير المناديب الواردة', 'Approved purchase invoices, drafts, and incoming representative invoices')}
        data={filteredPurchases}
        rowKey={(inv) => inv.id}
        onRowClick={(inv) => {
          setIsRejectBoxOpen(false);
          setRejectReasonText('');
          setActiveInvoice(inv);
        }}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={t('بحث برقم الفاتورة أو المورد أو المندوب...', 'Search by invoice #, supplier, or rep...')}
        exportFilename="AWLAD_SELIM_PurchaseInvoices"
        pdfTitle={t('سجل فواتير المشتريات', 'Purchase Invoices Log')}
        emptyTitle={t('لا توجد فواتير مشتريات مسجلة', 'No purchase invoices recorded')}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
            <div className="w-[165px] shrink-0">
              <SearchableFilterSelect
                id="purchase-filter-supplier"
                inlinePrefix={t('المورد', 'Supplier')}
                value={supplierFilter}
                onChange={setSupplierFilter}
                options={suppliers.map((s) => ({
                  value: s.id,
                  label: s.name,
                  subtitle: s.phone || s.companyName,
                  searchText: `${s.name} ${s.phone || ''} ${s.companyName || ''}`,
                }))}
                allOptionLabel={t('الكل', 'All')}
                allOptionValue="all"
                searchPlaceholder={t('ابحث باسم المورد أو الهاتف...', 'Search supplier name or phone...')}
                allowClear
                buttonClassName="rounded-md h-8 min-h-[32px]"
              />
            </div>
            <div className="w-[165px] shrink-0">
              <SearchableFilterSelect
                id="purchase-filter-status"
                inlinePrefix={t('الحالة', 'Status')}
                value={statusFilter}
                onChange={(val) => setStatusFilter((val as any) || 'all')}
                options={[
                  { value: 'rep_incoming', label: t('فواتير شراء المناديب (الواردة)', 'Rep Purchase Invoices (Incoming)') },
                  { value: 'confirmed', label: t('فواتير مؤكدة ومعتمدة', 'Confirmed & Approved Invoices') },
                  { value: 'draft', label: t('مسودات وبانتظار الاعتماد', 'Drafts & Pending Approval') },
                  { value: 'cancelled', label: t('ملغاة / محذوفة', 'Cancelled / Deleted') },
                ]}
                allOptionLabel={t('الكل', 'All')}
                allOptionValue="all"
                allowClear
                buttonClassName="rounded-md h-8 min-h-[32px]"
              />
            </div>
          </div>
        }
        columns={[
          {
            key: 'invoiceNumber',
            header: t('رقم الفاتورة', 'Invoice #'),
            sortable: true,
            sortValue: (inv) => inv.invoiceNumber,
            exportValue: (inv) => inv.invoiceNumber,
            render: (inv) => <span className="font-mono font-bold text-blue-900">{inv.invoiceNumber}</span>,
          },
          {
            key: 'date',
            header: t('التاريخ', 'Date'),
            sortable: true,
            sortValue: (inv) => inv.date,
            exportValue: (inv) => inv.date,
            render: (inv) => <span className="font-mono text-slate-600">{inv.date}</span>,
          },
          {
            key: 'supplierName',
            header: t('المورد / المرسل', 'Supplier / Sender'),
            sortable: true,
            sortValue: (inv) => inv.supplierName || '',
            exportValue: (inv) => inv.supplierName || '-',
            render: (inv) => (
              <div>
                <div className="font-bold text-slate-800">{inv.supplierName ? translateSystemEntityName(inv.supplierName) : '-'}</div>
                {(inv.representativeName || inv.sentBy) && (
                  <div className="text-[10px] text-[#003589] font-bold mt-0.5">
                    {t('المندوب / المرسل:', 'Rep / Sender:')} {inv.representativeName || inv.sentBy}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'warehouseName',
            header: t('المستودع المستلم', 'Receiving Warehouse'),
            exportValue: (inv) => inv.warehouseName ? translateSystemEntityName(inv.warehouseName) : '-',
            render: (inv) => <span className="text-slate-600">{inv.warehouseName ? translateSystemEntityName(inv.warehouseName) : '-'}</span>,
          },
          {
            key: 'grandTotal',
            header: t('الإجمالي', 'Total'),
            align: 'center',
            sortable: true,
            sortValue: (inv) => inv.grandTotal,
            exportValue: (inv) => inv.grandTotal,
            render: (inv) => <span className="font-black font-mono tabular-nums">{formatLocaleNumber(inv.grandTotal)} {t(settings.currency)}</span>,
          },
          {
            key: 'paidAmount',
            header: t('المدفوع', 'Paid'),
            align: 'center',
            sortable: true,
            sortValue: (inv) => inv.paidAmount,
            exportValue: (inv) => inv.paidAmount,
            render: (inv) => <span className="text-emerald-700 font-bold font-mono tabular-nums">{formatLocaleNumber(inv.paidAmount)}</span>,
          },
          {
            key: 'remainingAmount',
            header: t('المتبقي للمورد', 'Balance Due'),
            align: 'center',
            sortable: true,
            sortValue: (inv) => inv.remainingAmount,
            exportValue: (inv) => inv.remainingAmount,
            render: (inv) => <span className="text-red-700 font-bold font-mono tabular-nums">{formatLocaleNumber(inv.remainingAmount)}</span>,
          },
          {
            key: 'status',
            header: t('الحالة', 'Status'),
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
            header: t('الإجراءات', 'Actions'),
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
                    className="p-1.5 text-[#003589] hover:text-[#011E58] hover:bg-[#EEF3FA] rounded-md cursor-pointer"
                    title={inv.dispatchStatus === 'rejected' ? t('إعادة إرسال الفاتورة للإدارة', 'Resend Invoice to Management') : t('إرسال الفاتورة للإدارة', 'Send Invoice to Management')}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
                {inv.status !== 'cancelled' && canEditPurchase && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(inv)}
                    className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg cursor-pointer"
                    title={t('تعديل فاتورة الشراء والأصناف', 'Edit Purchase Invoice & Items')}
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
                  title={t('عرض تفاصيل الفاتورة وسجل الإرسال والتعديلات', 'View Invoice Details, Dispatch & Edit History')}
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handlePrint(inv)}
                  className="p-1.5 text-slate-500 hover:text-blue-900 hover:bg-blue-50 rounded-lg cursor-pointer"
                  title={t('طباعة الفاتورة', 'Print Invoice')}
                >
                  <Printer className="w-4 h-4" />
                </button>
                {inv.status !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => setCancelTarget(inv)}
                    className="p-1.5 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                    title={t('إلغاء فاتورة الشراء', 'Cancel Purchase Invoice')}
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* New Purchase Invoice Modal (Classic Stacked Form & Items Table) */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title={t('إنشاء فاتورة مشتريات وتوريد جديدة', 'Create New Purchase & Supply Invoice')}
        maxWidth="4xl"
      >
        <div className="space-y-2.5 text-xs">
          {error && (
            <div className="p-2 bg-red-50 border border-red-200 text-red-700 rounded-md font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Header Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div>
              <SearchableFilterSelect
                id="purchase-modal-supplier"
                label={t('المورد', 'Supplier')}
                value={selectedSupplierId}
                onChange={setSelectedSupplierId}
                onValueSelected={() => {
                  window.setTimeout(() => purchaseGroupTriggerRef.current?.focus(), 25);
                }}
                options={suppliers.map((s) => ({
                  value: s.id,
                  label: s.name,
                  subtitle: s.phone || s.companyName || undefined,
                  badge: `${t('رصيد:', 'Bal:')} ${formatLocaleNumber(s.currentBalance || 0)}`,
                  searchText: `${s.name} ${s.phone || ''} ${s.companyName || ''}`,
                }))}
                includeAllOption={false}
                placeholder={t('-- مورد نقدي / ابحث عن مورد --', '-- Walk-in / Search Supplier --')}
                minSearchChars={2}
                searchPlaceholder={t('اكتب حرفين على الأقل باسم المورد أو الهاتف...', 'Type at least 2 chars...')}
                allowClear
                minPanelWidth={260}
                buttonClassName="rounded-md h-8"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                {t('المستودع المستلم:', 'Receiving Warehouse:')}
              </label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-800"
              >
                <option value="">{t('-- اختيار المستودع --', '-- Select Warehouse --')}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {t(w.name)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                {t('تاريخ الفاتورة:', 'Invoice Date:')}
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-mono text-xs font-bold"
              />
            </div>
          </div>

          {/* Item Add / Inline New Product Section */}
          <div className="bg-blue-50/60 p-2.5 rounded-lg border border-blue-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <form onSubmit={handlePurchaseBarcodeSubmit} className="flex-1 min-w-[200px]">
                <div className="relative flex items-center">
                  <Barcode className="w-3.5 h-3.5 text-slate-400 absolute start-2 pointer-events-none" />
                  <input
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    placeholder={t('امسح الباركود أو اكتب الكود واضغط Enter...', 'Scan barcode or enter code & press Enter...')}
                    className="w-full h-8 ps-7 pe-2 bg-white border border-slate-300 rounded-md text-xs font-mono"
                  />
                </div>
              </form>
              <button
                type="button"
                onClick={() => {
                  setShowInlineNewProduct((prev) => !prev);
                  setError(null);
                }}
                className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-bold border transition-colors cursor-pointer ${
                  showInlineNewProduct
                    ? 'bg-[#011E58] text-white border-[#011E58]'
                    : 'bg-white text-[#011E58] border-[#B8CAE8] hover:bg-[#DCE6F5]'
                }`}
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>{showInlineNewProduct ? t('الرجوع للبحث', 'Back to Search') : t('+ صنف جديد', '+ New Product')}</span>
              </button>
            </div>

            {showInlineNewProduct ? (
              <div className="bg-white p-2.5 rounded-lg border border-blue-200 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('اسم الصنف الجديد: *', 'New Product Name: *')}</label>
                    <input
                      type="text"
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                      className="w-full h-8 border border-slate-300 bg-white rounded-md px-2 font-bold focus:border-blue-600 outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الباركود:', 'Barcode:')}</label>
                    <input
                      type="text"
                      value={newProdBarcode}
                      onChange={(e) => setNewProdBarcode(e.target.value)}
                      className="w-full h-8 border border-slate-300 bg-white rounded-md px-2 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الكود:', 'Code:')}</label>
                    <input
                      type="text"
                      value={newProdCode}
                      onChange={(e) => setNewProdCode(e.target.value)}
                      className="w-full h-8 border border-slate-300 bg-white rounded-md px-2 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <SearchableTaxonomySelect
                      label={t('المجموعة', 'Group')}
                      compact
                      items={activeGroupsList.map((g) => ({
                        id: g.id,
                        name: g.name,
                        status: g.status,
                      }))}
                      valueId={newProdGroupId}
                      allowClear
                      emptyDisplayText={t('-- اختر المجموعة --', '-- Select Group --')}
                      clearLabel={t('بدون مجموعة', 'No Group')}
                      createLabel={t('إضافة مجموعة جديدة', 'Add New Group')}
                      searchPlaceholder={t('بحث باسم المجموعة...', 'Search group...')}
                      triggerClassName="h-8 !min-h-[32px] !py-1 rounded-md text-xs"
                      onChange={({ id }) => {
                        const gid = id || '';
                        setNewProdGroupId(gid);
                        if (newProdCategoryId) {
                          const curCat = categories.find((c) => c.id === newProdCategoryId);
                          if (!curCat || (gid && curCat.groupId !== gid)) {
                            setNewProdCategoryId('');
                            setNewProdCategory('');
                          }
                        }
                      }}
                      onCreate={async (name) => {
                        const res = await addProductGroup(name);
                        if (res.success && res.productGroup) {
                          return { success: true, item: { id: res.productGroup.id, name: res.productGroup.name } };
                        }
                        return { success: false, error: res.error ? t(res.error) : t('تعذر إضافة المجموعة', 'Unable to add group') };
                      }}
                      onRename={async (id, newName) => {
                        const res = await updateProductGroup(id, { name: newName });
                        return res.success
                          ? { success: true }
                          : { success: false, error: res.error ? t(res.error) : t('تعذر تعديل المجموعة', 'Unable to rename group') };
                      }}
                    />
                  </div>
                  <div>
                    <SearchableTaxonomySelect
                      label={t('التصنيف', 'Category')}
                      compact
                      items={inlineScopedCategories.map((c) => ({
                        id: c.id,
                        name: c.name,
                        subtitle: !newProdGroupId ? c.groupName : undefined,
                        status: c.status,
                      }))}
                      valueId={newProdCategoryId}
                      valueText={newProdCategory}
                      allowClear
                      emptyDisplayText={
                        newProdGroupId && inlineScopedCategories.length === 0
                          ? t('لا توجد تصنيفات بالمجموعة', 'No categories in group')
                          : t('-- اختر التصنيف --', '-- Select Category --')
                      }
                      clearLabel={t('بدون تصنيف', 'No Category')}
                      createLabel={t('إضافة تصنيف جديد', 'Add New Category')}
                      searchPlaceholder={t('بحث باسم التصنيف...', 'Search category...')}
                      triggerClassName="h-8 !min-h-[32px] !py-1 rounded-md text-xs"
                      onChange={({ id, name }) => {
                        const cid = id || '';
                        setNewProdCategoryId(cid);
                        const catObj = cid ? categories.find((c) => c.id === cid) : undefined;
                        setNewProdCategory(catObj?.name || name || '');
                        if (catObj?.groupId && !newProdGroupId) {
                          setNewProdGroupId(catObj.groupId);
                        }
                      }}
                      onCreate={async (name) => {
                        const res = await addCategory(name, '', newProdGroupId || '');
                        if (res.success && res.category) {
                          const cat = res.category;
                          if (cat.groupId && !newProdGroupId) setNewProdGroupId(cat.groupId);
                          return { success: true, item: { id: cat.id, name: cat.name } };
                        }
                        return { success: false, error: res.error ? t(res.error) : t('تعذر إضافة التصنيف', 'Unable to add category') };
                      }}
                      onRename={async (id, newName) => {
                        try {
                          await updateCategory(id, { name: newName });
                          if (newProdCategoryId === id) setNewProdCategory(newName);
                          return { success: true };
                        } catch (err: any) {
                          return { success: false, error: err?.message ? t(err.message) : t('تعذر تعديل التصنيف', 'Unable to rename category') };
                        }
                      }}
                    />
                  </div>
                  <div>
                    <SearchableTaxonomySelect
                      label={t('الوحدة', 'Unit')}
                      required
                      compact
                      items={productUnits
                        .filter((u) => u.status !== 'suspended' || u.id === newProdUnitId)
                        .map((u) => ({
                          id: u.id,
                          name: u.name,
                          subtitle: u.shortCode || undefined,
                          status: u.status,
                        }))}
                      valueId={newProdUnitId}
                      valueText={newProdBaseUnit}
                      allowManualText
                      emptyDisplayText={t('-- اختر أو اكتب الوحدة --', '-- Select or Type Unit --')}
                      createLabel={t('إضافة وحدة جديدة', 'Add New Unit')}
                      searchPlaceholder={t('بحث باسم الوحدة أو كتابتها...', 'Search or type unit...')}
                      triggerClassName="h-8 !min-h-[32px] !py-1 rounded-md text-xs"
                      onChange={({ id, name }) => {
                        setNewProdUnitId(id || '');
                        setNewProdBaseUnit(name);
                      }}
                      onCreate={async (name) => {
                        const res = await addProductUnit(name);
                        if (res.success && res.productUnit) {
                          return { success: true, item: { id: res.productUnit.id, name: res.productUnit.name } };
                        }
                        return { success: false, error: res.error ? t(res.error) : t('تعذر إضافة الوحدة', 'Unable to add unit') };
                      }}
                      onRename={async (id, newName) => {
                        const res = await updateProductUnit(id, { name: newName });
                        if (res.success) {
                          if (newProdUnitId === id) setNewProdBaseUnit(newName);
                          return { success: true };
                        }
                        return { success: false, error: res.error ? t(res.error) : t('تعذر تعديل الوحدة', 'Unable to rename unit') };
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الكمية: *', 'Qty: *')}</label>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={newProdQty}
                      onChange={setNewProdQty}
                      ariaLabel={t('كمية الصنف الجديد', 'New Product Qty')}
                      inputClassName="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-center font-mono font-bold text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('سعر شراء الوحدة: *', 'Unit Buy Price: *')}</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={newProdPurchasePrice}
                      onChange={(e) => setNewProdPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full h-8 border border-slate-300 bg-white rounded-md px-2 text-center font-mono font-bold text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('سعر بيع الوحدة:', 'Unit Sell Price:')}</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={newProdSellingPrice}
                      onChange={(e) => setNewProdSellingPrice(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full h-8 border border-slate-300 bg-white rounded-md px-2 text-center font-mono font-bold text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('التصنيف 1:', 'Class 1:')}</label>
                    <input
                      type="text"
                      value={newProdClass1}
                      onChange={(e) => setNewProdClass1(e.target.value)}
                      placeholder={t('تصنيف 1 مستقل...', 'Independent class 1...')}
                      className="w-full h-8 border border-slate-300 bg-white rounded-md px-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('التصنيف 2:', 'Class 2:')}</label>
                    <input
                      type="text"
                      value={newProdClass2}
                      onChange={(e) => setNewProdClass2(e.target.value)}
                      placeholder={t('تصنيف 2 مستقل...', 'Independent class 2...')}
                      className="w-full h-8 border border-slate-300 bg-white rounded-md px-2 text-xs"
                    />
                  </div>
                </div>

                {duplicateCheckState.exactMatch && (
                  <div className="p-2 rounded border border-amber-300 bg-amber-50 text-amber-950 space-y-1 text-xs">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      <span>
                        {t(
                          `مسجل مسبقاً (${duplicateCheckState.exactMatch.name})!`,
                          `Already exists (${duplicateCheckState.exactMatch.name})!`
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUseExistingDuplicateProduct(duplicateCheckState.exactMatch!)}
                      className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-800 text-white font-bold cursor-pointer"
                    >
                      {t('استخدام الصنف الموجود', 'Use Existing Product')}
                    </button>
                  </div>
                )}

                {!duplicateCheckState.exactMatch && duplicateCheckState.similarMatches.length > 0 && (
                  <div className="p-2 rounded border border-blue-200 bg-blue-50/70 text-blue-950 space-y-1 text-[11px]">
                    <div className="font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-blue-700" />
                      <span>{t('أصناف متشابهة:', 'Similar items:')}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {duplicateCheckState.similarMatches.map((sim) => (
                        <button
                          key={sim.id}
                          type="button"
                          onClick={() => handleUseExistingDuplicateProduct(sim)}
                          className="px-2 py-0.5 rounded bg-white border border-blue-300 hover:bg-blue-100 text-blue-900 font-bold cursor-pointer"
                        >
                          {sim.name} ({sim.purchasePrice})
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowInlineNewProduct(false)}
                    className="h-8 px-3 rounded border border-slate-300 font-bold text-slate-600 cursor-pointer"
                  >
                    {t('إلغاء', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddInlineNewProductItem}
                    className="h-8 px-3 rounded bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                  >
                    {duplicateCheckState.exactMatch
                      ? t('ربط وإضافة', 'Link & Add')
                      : t('+ إضافة للفاتورة', '+ Add to Invoice')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <LinkedGroupCategoryFilter
                  productGroups={productGroups}
                  categories={categories}
                  selectedGroupId={purchaseGroupFilter}
                  selectedCategoryId={purchaseCatFilter}
                  groupTriggerRef={purchaseGroupTriggerRef}
                  categoryTriggerRef={purchaseCategoryTriggerRef}
                  allowAll={false}
                  minSearchChars={2}
                  autoAdvanceOnSelect
                  onCategoryAfterSelect={() => {
                    window.setTimeout(() => productSearchRef.current?.focus(), 20);
                  }}
                  onFilterChange={(nextGroupId, nextCategoryId) => {
                    setPurchaseGroupFilter(nextGroupId);
                    setPurchaseCatFilter(nextCategoryId);
                    const { clearSelectedProduct } = resolveGroupCategoryCascade(
                      products,
                      productGroups,
                      categories,
                      nextGroupId,
                      nextCategoryId,
                      itemProdId
                    );
                    if (clearSelectedProduct) {
                      setItemProdId('');
                      setItemUnitName('');
                      setItemQty('');
                      setItemPrice('');
                    }
                  }}
                  compact
                />
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('اختيار الصنف:', 'Select Product:')}</label>
                    <ProductSearchSelect
                      inputRef={productSearchRef}
                      products={filteredPurchaseProducts}
                      selectedProductId={itemProdId}
                      warehouseId={selectedWarehouseId}
                      warehouses={warehouses}
                      priceMode="purchase"
                      currency={settings.currency}
                      minSearchChars={2}
                      placeholder={t('اكتب حرفين على الأقل للبحث...', 'Type at least 2 chars to search...')}
                      onSelect={(p) => handleProductPick(p.id)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الوحدة:', 'Unit:')}</label>
                    <select
                      disabled={!selectedPurchaseProduct}
                      value={itemUnitName}
                      onChange={(e) => handlePurchaseUnitSelect(e.target.value)}
                      className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-xs font-bold disabled:bg-slate-100"
                    >
                      {purchaseUnitOptions.length === 0 ? (
                        <option value="">{t('-- الوحدة --', '-- Unit --')}</option>
                      ) : (
                        purchaseUnitOptions.map((u) => (
                          <option key={u.name} value={u.name}>{t(u.name)}</option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الكمية:', 'Qty:')}</label>
                    <QuantityInput
                      inputRef={qtyInputRef}
                      allowDecimals
                      min={0.001}
                      disabled={!selectedPurchaseProduct}
                      value={itemQty}
                      onChange={(val) => setItemQty(val)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          unitPriceInputRef.current?.focus();
                          unitPriceInputRef.current?.select();
                        }
                      }}
                      ariaLabel={t('الكمية', 'Qty')}
                      inputClassName="w-full h-8 px-2 rounded-md border border-slate-300 bg-white text-center font-mono font-bold disabled:bg-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('سعر الشراء:', 'Buy Price:')}</label>
                    <input
                      ref={unitPriceInputRef}
                      type="number"
                      min={0}
                      step="0.5"
                      disabled={!selectedPurchaseProduct}
                      value={itemPrice}
                      onChange={(e) => setItemPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleAddItem();
                        }
                      }}
                      className="w-full h-8 px-2 rounded-md border border-slate-300 bg-white text-center font-mono font-bold disabled:bg-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <button
                      type="button"
                      disabled={!selectedPurchaseProduct}
                      onClick={handleAddItem}
                      className="w-full h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer disabled:opacity-50"
                    >
                      {t('+', '+')}
                    </button>
                  </div>
                </div>

                {selectedSupplierId && selectedPurchaseProduct && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                    <span className="font-bold text-slate-700">
                      {t('آخر ثلاثة أسعار شراء من هذا المورد:', 'Last 3 purchase prices from this supplier:')}
                    </span>
                    {supplierProductHistoryEntries.length > 0 ? (
                      supplierProductHistoryEntries.map((entry, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setItemPrice(entry.unitPrice)}
                          className="px-2 py-0.5 rounded bg-white border border-blue-300 hover:bg-blue-100 text-blue-900 font-bold cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <span className="font-mono font-black">{formatLocaleNumber(entry.unitPrice)} {t(settings.currency)}</span>
                          {entry.date && <span className="text-[10px] text-slate-500 font-mono">({entry.date})</span>}
                          {entry.invoiceNumber && <span className="text-[10px] text-blue-700 font-mono">{entry.invoiceNumber}</span>}
                        </button>
                      ))
                    ) : (
                      <span className="text-slate-500 font-semibold">
                        {t('لا توجد أسعار سابقة', 'No previous prices')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Editable Added Items Grid */}
          <EditableItemGrid
            rows={items.map((it, idx) => ({
              ...it,
              rowKey: `${it.productId || it.productName}-${it.unit}-${idx}`,
              secondaryBadge: it.newProduct ? t('صنف جديد', 'New') : undefined,
            }))}
            products={products}
            warehouses={warehouses}
            currency={settings.currency}
            priceMode="purchase"
            showPriceColumns
            showDiscountColumn
            allowUnitEdit
            allowQtyEdit
            allowPriceEdit
            allowDiscountEdit
            recalcPriceOnUnitChange
            onUpdateRow={(idx, patch: Partial<EditableGridRow>) => {
              setItems((prev) =>
                prev.map((row, rIdx) => {
                  if (rIdx !== idx) return row;
                  const nextUnit = patch.unit ?? row.unit;
                  const nextFactor = patch.unitFactor ?? row.unitFactor;
                  const nextQty = patch.quantity !== undefined ? Math.max(0.001, patch.quantity) : row.quantity;
                  const nextPrice = patch.unitPrice !== undefined ? Math.max(0, patch.unitPrice) : row.unitPrice;
                  const nextDisc = patch.discount !== undefined ? Math.max(0, patch.discount) : (row.discount || 0);
                  return {
                    ...row,
                    unit: nextUnit,
                    unitFactor: nextFactor,
                    quantity: nextQty,
                    unitPrice: nextPrice,
                    purchasePriceAtTime: nextPrice,
                    discount: nextDisc,
                    total: computeLineTotal(nextQty, nextPrice, nextDisc),
                    newProduct: row.newProduct
                      ? { ...row.newProduct, baseUnit: nextUnit, purchasePrice: nextPrice }
                      : undefined,
                  };
                })
              );
            }}
            onDuplicateRow={(idx) => {
              const target = items[idx];
              if (!target) return;
              setItems((prev) => {
                const next = [...prev];
                next.splice(idx + 1, 0, { ...target });
                return next;
              });
            }}
            onDeleteRow={(idx) => setItems((prev) => prev.filter((_, i) => i !== idx))}
            onAddNewItem={() => window.setTimeout(() => productSearchRef.current?.focus(), 20)}
            onGridAdvanceOut={() => window.setTimeout(() => productSearchRef.current?.focus(), 20)}
            onNotify={(msg) => setActionMessage({ type: 'success', text: msg })}
            maxHeightClass="max-h-56"
            emptyStateText={t(
              'لم يتم إضافة أصناف بعد — ابحث عن صنف أو أضف صنفاً جديداً',
              'No items added yet — search a product or add a new item'
            )}
          />

          {/* Target Manager Routing Notice */}
          <div className="bg-[#EEF3FA] border border-[#DCE6F5] rounded-lg p-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex-1 min-w-[200px]">
              <label className="block font-bold text-[#011E58] mb-0.5">
                {t('المسؤول الموجه إليه عند الإرسال للإدارة (اختياري):', 'Target Manager When Sending to Management (optional):')}
              </label>
              <select
                value={newRecipientUserId}
                onChange={(e) => setNewRecipientUserId(e.target.value)}
                className="w-full h-8 bg-white border border-[#DCE6F5] rounded-md px-2 py-1 font-bold"
              >
                <option value="">{t('الإدارة العامة (جميع المسؤولين المختصين)', 'General Management (All Authorized Managers)')}</option>
                {purchaseReceivers.map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName} ({t(r.role)})</option>
                ))}
              </select>
            </div>
            <span className="text-[11px] font-bold text-[#003589]">
              {t('«حفظ وإرسال للإدارة» يحفظها كمسودة مرسلة دون تعديل أرصدة المخزون أو المورد لحين الاعتماد.', '"Save & Send to Management" saves it as a sent draft without modifying inventory or supplier balances until approved.')}
            </span>
          </div>

          {/* Payment & Summary Totals */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('نظام الدفع:', 'Payment Mode:')}</label>
                  <div className="grid grid-cols-3 gap-1 font-bold text-[11px]">
                    <button
                      type="button"
                      onClick={() => setPaymentType('cash')}
                      className={`h-8 rounded border cursor-pointer ${
                        paymentType === 'cash' ? 'bg-[#003589] text-white border-[#003589]' : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      {t('نقدي', 'Cash')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentType('partial');
                        if (paymentType === 'cash') setPaidAmount('');
                      }}
                      className={`h-8 rounded border cursor-pointer ${
                        paymentType === 'partial' ? 'bg-[#003589] text-white border-[#003589]' : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      {t('جزئي', 'Partial')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentType('credit')}
                      className={`h-8 rounded border cursor-pointer ${
                        paymentType === 'credit' ? 'bg-[#003589] text-white border-[#003589]' : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      {t('آجل', 'Credit')}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الخزينة:', 'Cashbox:')}</label>
                  <select
                    value={selectedCashboxId}
                    disabled={paymentType === 'credit'}
                    onChange={(e) => setSelectedCashboxId(e.target.value)}
                    className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-xs font-bold disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">{t('-- اختيار الخزينة --', '-- Select Cashbox --')}</option>
                    {cashboxes.map((c) => (
                      <option key={c.id} value={c.id}>{t(c.name)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الخصم', 'Discount')} ({t(settings.currency)}):</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={discountTotal}
                    onChange={(e) => setDiscountTotal(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-center font-mono font-bold"
                  />
                </div>
                {paymentType === 'partial' ? (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('المدفوع للمورد:', 'Paid to Supplier:')}</label>
                    <input
                      type="number"
                      min={0}
                      max={grandTotal}
                      step="0.5"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      className="w-full h-8 bg-white border border-blue-400 rounded-md px-2 text-center font-mono font-black text-blue-950"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('ملاحظات:', 'Notes:')}</label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-xs"
                    />
                  </div>
                )}
              </div>

              {paymentType === 'partial' && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('ملاحظات:', 'Notes:')}</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-xs"
                  />
                </div>
              )}
            </div>

            <div className="bg-blue-50/50 p-2.5 rounded-lg border border-blue-200 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600 font-semibold">{t('الإجمالي قبل الخصم:', 'Subtotal:')}</span>
                <span className="font-mono font-bold text-slate-800">{formatLocaleNumber(subtotal)} {t(settings.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 font-semibold">{t('الخصم:', 'Discount:')}</span>
                <span className="font-mono font-bold text-rose-700">{formatLocaleNumber(numericDiscount)} {t(settings.currency)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-blue-200 text-sm font-black text-[#011E58]">
                <span>{t('صافي الفاتورة:', 'Net Total:')}</span>
                <span className="font-mono">{formatLocaleNumber(grandTotal)} {t(settings.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 font-semibold">{t('المدفوع:', 'Paid:')}</span>
                <span className="font-mono font-bold text-emerald-700">{formatLocaleNumber(numericPaid)} {t(settings.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 font-semibold">{t('المتبقي (آجل للمورد):', 'Remaining (Due):')}</span>
                <span className="font-mono font-black text-red-700">{formatLocaleNumber(remainingAmount)} {t(settings.currency)}</span>
              </div>
              {supplierPrevBalance !== null && supplierAfterBalance !== null && (
                <div className="flex justify-between pt-1 border-t border-blue-200 text-[11px] text-slate-600">
                  <span>{t('رصيد المورد (سابق / بعد):', 'Supplier Balance (Prev / After):')}</span>
                  <span className="font-mono font-bold">
                    {formatLocaleNumber(supplierPrevBalance)} → {formatLocaleNumber(supplierAfterBalance)} {t(settings.currency)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Footer Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsNewModalOpen(false)}
              className="h-8 px-3 rounded-md border border-slate-300 text-slate-600 font-bold cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={isSubmitting || items.length === 0}
              onClick={() => handleSubmitPurchase(false, true)}
              className="h-8 flex items-center gap-1.5 px-3 bg-[#011E58] hover:bg-[#002160] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? t('جاري الإرسال...', 'Sending...') : t('حفظ وإرسال للإدارة', 'Save & Send to Management')}</span>
            </button>
            <button
              type="button"
              disabled={isSubmitting || items.length === 0}
              onClick={() => handleSubmitPurchase(false, false)}
              className="h-8 flex items-center gap-1.5 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? t('جاري الحفظ...', 'Saving...')
                  : canApprovePurchase
                  ? t('اعتماد الفاتورة', 'Save & Approve')
                  : t('حفظ مسودة', 'Save Draft')}
              </span>
            </button>
            <button
              type="button"
              disabled={isSubmitting || items.length === 0}
              onClick={() => handleSubmitPurchase(true, false)}
              className="h-8 flex items-center gap-1.5 px-3 bg-[#002160] hover:bg-[#001A49] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{t('حفظ وطباعة', 'Save & Print')}</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Purchase Invoice Details Modal */}
      {displayedActiveInvoice && (() => {
        const badge = getPurchaseStatusBadge(displayedActiveInvoice);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-start max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-black text-slate-900">
                  {t('تفاصيل فاتورة المشتريات:', 'Purchase Invoice Details:')} {displayedActiveInvoice.invoiceNumber}
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
                className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                {t('إغلاق ✕', 'Close ✕')}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mb-3 p-2.5 bg-slate-50 rounded-lg">
              <div className="space-y-1">
                <p className="text-slate-500">{t('المورد:', 'Supplier:')} <strong className="text-slate-800">{displayedActiveInvoice.supplierName ? translateSystemEntityName(displayedActiveInvoice.supplierName) : t('مورد نقدي', 'Cash Supplier')}</strong></p>
                <p className="text-slate-500">{t('المستودع المستلم:', 'Receiving Warehouse:')} <strong className="text-slate-800">{translateSystemEntityName(displayedActiveInvoice.warehouseName)}</strong></p>
                <p className="text-slate-500">{t('أنشئت بواسطة:', 'Created by:')} <strong className="text-slate-800">{displayedActiveInvoice.createdBy}</strong></p>
                {(displayedActiveInvoice.sentBy || displayedActiveInvoice.representativeName) && (
                  <p className="text-[#011E58]">
                    {t('المرسل / المندوب:', 'Sender / Rep:')} <strong>{displayedActiveInvoice.sentBy || displayedActiveInvoice.representativeName}</strong>
                    {displayedActiveInvoice.sentAt ? ` (${formatLocaleDateTime(displayedActiveInvoice.sentAt)})` : ''}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-slate-500">{t('التاريخ:', 'Date:')} <strong className="font-mono text-slate-800">{displayedActiveInvoice.date}</strong></p>
                {displayedActiveInvoice.recipientName && (
                  <p className="text-slate-500">{t('الموجه إليه:', 'Directed to:')} <strong className="text-slate-800">{t(displayedActiveInvoice.recipientName)}</strong></p>
                )}
                {displayedActiveInvoice.receivedBy && (
                  <p className="text-[#003589]">
                    {t('تم الاستلام بواسطة:', 'Received by:')} <strong>{displayedActiveInvoice.receivedBy}</strong>
                    {displayedActiveInvoice.receivedAt ? ` (${formatLocaleDateTime(displayedActiveInvoice.receivedAt)})` : ''}
                  </p>
                )}
                {displayedActiveInvoice.editedBy && (
                  <p className="text-amber-700">{t('آخر تعديل:', 'Last edited by:')} <strong>{displayedActiveInvoice.editedBy}</strong></p>
                )}
                {displayedActiveInvoice.cancelledBy && (
                  <p className="text-red-700">{t('ألغيت بواسطة:', 'Cancelled by:')} <strong>{displayedActiveInvoice.cancelledBy}</strong> {displayedActiveInvoice.cancelReason ? `— ${displayedActiveInvoice.cancelReason}` : ''}</p>
                )}
              </div>
            </div>

            {displayedActiveInvoice.dispatchStatus === 'rejected' && displayedActiveInvoice.rejectionReason && (
              <div className="mb-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs">
                <strong className="block mb-0.5">
                  {t('سبب الرفض', 'Rejection Reason')} ({displayedActiveInvoice.rejectedBy ? t(displayedActiveInvoice.rejectedBy) : t('الإدارة', 'Management')}):
                </strong>
                <span>{displayedActiveInvoice.rejectionReason}</span>
              </div>
            )}

            <div className="mb-4">
              <UnifiedDataTable<InvoiceItem>
                title={t('أصناف فاتورة الشراء', 'Purchase Invoice Items')}
                data={displayedActiveInvoice.items}
                rowKey={(it, i) => `${it.productId || it.productName}-${i}`}
                searchable={false}
                compact
                defaultPageSize={25}
                columns={[
                  {
                    key: 'productName',
                    header: t('الصنف', 'Item'),
                    render: (it) => <span className="font-semibold">{it.productName}</span>,
                  },
                  {
                    key: 'unit',
                    header: t('الوحدة', 'Unit'),
                    align: 'center',
                    render: (it) => <span>{t(it.unit)}</span>,
                  },
                  {
                    key: 'quantity',
                    header: t('الكمية', 'Qty'),
                    align: 'center',
                    render: (it) => <span className="font-bold font-mono tabular-nums">{it.quantity}</span>,
                  },
                  {
                    key: 'unitPrice',
                    header: t('سعر الشراء', 'Buy Price'),
                    align: 'center',
                    render: (it) => <span className="font-mono tabular-nums">{it.unitPrice}</span>,
                  },
                  {
                    key: 'total',
                    header: t('الإجمالي', 'Total'),
                    align: 'center',
                    render: (it) => <span className="font-bold font-mono text-blue-900 tabular-nums">{formatLocaleNumber(it.total)}</span>,
                  },
                ]}
              />
            </div>

            <div className="mt-3 mb-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <History className="w-4 h-4 text-emerald-700" />
                <h4 className="text-xs font-black text-slate-800">
                  {t('سجل الدفعات المسددة', 'Payment History')} ({displayedActiveInvoice.payments?.length || (displayedActiveInvoice.paidAmount > 0 ? 1 : 0)})
                </h4>
              </div>
              {(!displayedActiveInvoice.payments || displayedActiveInvoice.payments.length === 0) ? (
                <p className="text-[11px] text-slate-500">
                  {displayedActiveInvoice.paidAmount > 0
                    ? t(`تم تسجيل دفعة مخططة بقيمة ${formatLocaleNumber(displayedActiveInvoice.paidAmount)} ${t(settings.currency)}.`, `A scheduled payment of ${formatLocaleNumber(displayedActiveInvoice.paidAmount)} ${t(settings.currency)} was recorded.`)
                    : t('فاتورة آجلة بالكامل للمورد.', 'Full credit invoice to supplier.')}
                </p>
              ) : (
                <UnifiedDataTable
                  title={t('سجل الدفعات المسددة', 'Payment History')}
                  data={displayedActiveInvoice.payments}
                  rowKey={(p) => p.id}
                  searchable={false}
                  compact
                  defaultPageSize={10}
                  columns={[
                    {
                      key: 'date',
                      header: t('التاريخ', 'Date'),
                      render: (p) => <span className="font-mono">{p.date}</span>,
                    },
                    {
                      key: 'amount',
                      header: t('المبلغ', 'Amount'),
                      render: (p) => <span className="font-black text-emerald-700 font-mono tabular-nums">{formatLocaleNumber(p.amount)} {t(settings.currency)}</span>,
                    },
                    {
                      key: 'cashboxName',
                      header: t('الخزينة', 'Cashbox'),
                      render: (p) => <span className="text-slate-600">{t(p.cashboxName)}</span>,
                    },
                    {
                      key: 'notes',
                      header: t('ملاحظات', 'Notes'),
                      render: (p) => <span className="text-slate-500">{p.notes || '-'}</span>,
                    },
                  ]}
                />
              )}
            </div>

            {Array.isArray(displayedActiveInvoice.dispatchHistory) && displayedActiveInvoice.dispatchHistory.length > 0 && (
              <div className="mb-3 p-2.5 bg-[#EEF3FA] border border-[#DCE6F5] rounded-lg space-y-1.5">
                <div className="flex items-center gap-2">
                  <Send className="w-3.5 h-3.5 text-[#003589]" />
                  <h4 className="text-xs font-black text-[#011E58]">
                    {t('سجل الإرسال والاستلام والاعتماد', 'Dispatch, Receipt & Approval History')} ({displayedActiveInvoice.dispatchHistory.length})
                  </h4>
                </div>
                <div className="space-y-1">
                  {displayedActiveInvoice.dispatchHistory.map((h, idx) => (
                    <div key={`${h.at}-${idx}`} className="p-2 bg-white border border-[#DCE6F5] rounded-lg text-[11px] flex items-center justify-between gap-2">
                      <div>
                        <strong className="text-slate-900">
                          {h.action === 'created' ? t('إنشاء الفاتورة', 'Invoice Created') :
                           h.action === 'sent' ? t('إرسال للإدارة', 'Sent to Management') :
                           h.action === 'resent' ? t('إعادة إرسال للإدارة', 'Resent to Management') :
                           h.action === 'received' ? t('استلام الفاتورة', 'Invoice Received') :
                           h.action === 'rejected' ? t('رفض الفاتورة', 'Invoice Rejected') :
                           h.action === 'confirmed' ? t('اعتماد وترحيل', 'Approved & Posted') : h.action}
                        </strong>
                        {h.by && <span className="text-slate-600 ms-1.5">· {h.by}</span>}
                        {h.recipientName && <span className="text-[#003589] ms-1.5">→ {t(h.recipientName)}</span>}
                        {(h.notes || h.reason) && <p className="text-slate-500 mt-0.5">{h.notes || h.reason}</p>}
                      </div>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0" dir="ltr">
                        {h.at ? formatLocaleDateTime(h.at) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(displayedActiveInvoice.editHistory) && displayedActiveInvoice.editHistory.length > 0 && (
              <div className="mb-3 p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg space-y-1.5">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  <h4 className="text-xs font-black text-amber-950">
                    {t('سجل التعديلات السابقة', 'Previous Edit History')} ({displayedActiveInvoice.editHistory.length})
                  </h4>
                </div>
                <div className="space-y-1">
                  {displayedActiveInvoice.editHistory.map((entry, idx) => (
                    <div
                      key={`${entry.editedAt}-${idx}`}
                      className="p-2 bg-white border border-amber-200/80 rounded-lg text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-900">
                          {t('بواسطة:', 'By:')} {entry.editedBy || t('غير محدد', 'Unspecified')}
                          {entry.reason ? ` · ${t('السبب:', 'Reason:')} ${entry.reason}` : ''}
                        </div>
                        {entry.before && entry.after && (
                          <div className="text-slate-600 font-mono">
                            {t('الإجمالي:', 'Total:')} {formatLocaleNumber(Number(entry.before.grandTotal ?? 0))} →{' '}
                            <strong className="text-blue-900">{formatLocaleNumber(Number(entry.after.grandTotal ?? 0))} {t(settings.currency)}</strong>
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-slate-500 shrink-0" dir="ltr">
                        {entry.editedAt ? formatLocaleDateTime(entry.editedAt) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {displayedActiveInvoice.status === 'draft' && (canCreatePurchaseDraft || canReceivePurchase || canApprovePurchase) && (
              <div className="mb-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5 text-xs">
                <p className="text-[11px] font-bold text-slate-600">
                  {t('ملاحظة محاسبية: هذه الفاتورة لا تزال مسودة ولم تؤثر على أرصدة المخازن أو المورد أو الخزينة بعد. يتم الترحيل الفعلي فقط عند الضغط على «اعتماد وترحيل الفاتورة».', 'Accounting Note: This invoice is still a draft and has not affected inventory, supplier, or treasury balances yet. Posting only occurs when clicking "Approve & Post Invoice".')}
                </p>

                {isRejectBoxOpen && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg space-y-2">
                    <label className="block font-black text-rose-900">{t('سبب رفض الفاتورة وإعادتها للمندوب:', 'Reason for Rejecting & Returning Invoice to Rep:')}</label>
                    <input
                      type="text"
                      value={rejectReasonText}
                      onChange={(e) => setRejectReasonText(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-rose-300 bg-white font-semibold"
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
                        {t('تراجع', 'Back')}
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
                            setActionMessage({ type: 'success', text: t(`تم رفض الفاتورة (${displayedActiveInvoice.invoiceNumber}) وإخطار المندوب.`, `Invoice (${displayedActiveInvoice.invoiceNumber}) rejected and representative notified.`) });
                          } else {
                            setActionMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر رفض الفاتورة', 'Unable to reject invoice') });
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-black disabled:opacity-50 cursor-pointer"
                      >
                        {isDispatchActionBusy ? t('جاري الرفض...', 'Rejecting...') : t('تأكيد الرفض', 'Confirm Rejection')}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  {canCreatePurchaseDraft && (!displayedActiveInvoice.dispatchStatus || displayedActiveInvoice.dispatchStatus === 'draft' || displayedActiveInvoice.dispatchStatus === 'rejected') && (
                    <button
                      type="button"
                      disabled={isDispatchActionBusy}
                      onClick={() => {
                        setSendModalInvoice(displayedActiveInvoice);
                        setSendModalRecipientId(displayedActiveInvoice.recipientUserId || '');
                        setSendModalNotes('');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#011E58] hover:bg-[#002160] text-white font-bold cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{displayedActiveInvoice.dispatchStatus === 'rejected' ? t('إعادة إرسال للإدارة', 'Resend to Management') : t('إرسال للإدارة', 'Send to Management')}</span>
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
                            text: t(`تم استلام فاتورة الشراء (${displayedActiveInvoice.invoiceNumber}) بنجاح وبانتظار الاعتماد النهائي.`, `Purchase invoice (${displayedActiveInvoice.invoiceNumber}) received successfully, awaiting final approval.`),
                          });
                        } else {
                          setActionMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر تأكيد استلام الفاتورة', 'Unable to confirm invoice receipt') });
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{t('تأكيد استلام الفاتورة', 'Confirm Receipt')}</span>
                    </button>
                  )}

                  {canReceivePurchase && (displayedActiveInvoice.dispatchStatus === 'sent' || displayedActiveInvoice.dispatchStatus === 'received') && !isRejectBoxOpen && (
                    <button
                      type="button"
                      disabled={isDispatchActionBusy}
                      onClick={() => setIsRejectBoxOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 font-bold cursor-pointer disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{t('رفض مع ذكر السبب', 'Reject with Reason')}</span>
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
                            text: t(`تم اعتماد وترحيل فاتورة الشراء (${displayedActiveInvoice.invoiceNumber}) للمخزون وحساب المورد بنجاح.`, `Purchase invoice (${displayedActiveInvoice.invoiceNumber}) approved and posted to inventory and supplier account.`),
                          });
                        } else {
                          setActionMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر اعتماد الفاتورة', 'Unable to approve invoice') });
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t('اعتماد وترحيل الفاتورة', 'Approve & Post Invoice')}</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2.5 border-t text-xs">
              <div className="flex items-center gap-4 text-slate-600">
                <span>{t('الإجمالي:', 'Total:')} <strong className="text-sm font-black text-slate-900">{formatLocaleNumber(displayedActiveInvoice.grandTotal)} {t(settings.currency)}</strong></span>
                <span>{t('المدفوع:', 'Paid:')} <strong className="text-sm font-bold text-emerald-700">{formatLocaleNumber(displayedActiveInvoice.paidAmount)}</strong></span>
                <span>{t('المتبقي للمورد:', 'Balance Due:')} <strong className="text-sm font-bold text-red-600">{formatLocaleNumber(displayedActiveInvoice.remainingAmount)}</strong></span>
              </div>
              <button
                onClick={() => {
                  const inv = displayedActiveInvoice;
                  setActiveInvoice(null);
                  handlePrint(inv);
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-[#003589] text-white rounded-md font-bold hover:bg-[#0049B0] transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{t('طباعة هذه الفاتورة', 'Print This Invoice')}</span>
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Edit Purchase Invoice Modal */}
      {editModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white rounded-lg shadow-2xl border border-slate-200 p-2.5 text-start max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  {t('تعديل فاتورة المشتريات رقم:', 'Edit Purchase Invoice #:')} {editModalInvoice.invoiceNumber}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {t('المدفوع مسبقاً للمورد:', 'Previously Paid to Supplier:')} <strong className="text-emerald-700">{formatLocaleNumber(editModalInvoice.paidAmount)} {t(settings.currency)}</strong>
                </p>
              </div>
              <button
                onClick={() => setEditModalInvoice(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {editError && (
              <div className="mb-2 px-2.5 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-md text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitEdit} className="space-y-2 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('المورد:', 'Supplier:')}</label>
                  <select
                    value={editSupplierId}
                    onChange={(e) => setEditSupplierId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    <option value="">{t('مورد نقدي', 'Cash Supplier')}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('المستودع المستلم:', 'Receiving Warehouse:')}</label>
                  <select
                    value={editWarehouseId}
                    onChange={(e) => setEditWarehouseId(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{t(w.name)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('تاريخ الفاتورة:', 'Invoice Date:')}</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">{t('إجمالي الخصم', 'Total Discount')} ({t(settings.currency)}):</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
                  />
                </div>
              </div>

              {/* Add another item inside Edit Modal */}
              <div className="bg-blue-50/60 p-2.5 rounded-lg border border-blue-200 space-y-2">
                <LinkedGroupCategoryFilter
                  productGroups={productGroups}
                  categories={categories}
                  selectedGroupId={editGroupFilter}
                  selectedCategoryId={editCatFilter}
                  groupTriggerRef={editGroupTriggerRef}
                  categoryTriggerRef={editCategoryTriggerRef}
                  allowAll={false}
                  minSearchChars={2}
                  autoAdvanceOnSelect
                  onCategoryAfterSelect={() => {
                    window.setTimeout(() => editProductSearchRef.current?.focus(), 20);
                  }}
                  onFilterChange={(nextGroupId, nextCategoryId) => {
                    setEditGroupFilter(nextGroupId);
                    setEditCatFilter(nextCategoryId);
                    const { clearSelectedProduct } = resolveGroupCategoryCascade(
                      products,
                      productGroups,
                      categories,
                      nextGroupId,
                      nextCategoryId,
                      editAddProdId
                    );
                    if (clearSelectedProduct) {
                      setEditAddProdId('');
                      setEditAddQty('');
                      setEditAddPrice('');
                    }
                  }}
                  compact
                />
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                  <div className="sm:col-span-5">
                    <label className="block font-bold text-slate-700 mb-1">{t('إضافة صنف آخر للفاتورة:', 'Add Another Item to Invoice:')}</label>
                    <ProductSearchSelect
                      inputRef={editProductSearchRef}
                      products={filteredEditProducts}
                      selectedProductId={editAddProdId}
                      warehouseId={editWarehouseId}
                      warehouses={warehouses}
                      priceMode="purchase"
                      currency={settings.currency}
                      minSearchChars={2}
                      placeholder={t('اكتب حرفين على الأقل للبحث...', 'Type at least 2 chars to search...')}
                      onSelect={handleEditPickProduct}
                      onAfterSelect={() => {
                        window.setTimeout(() => {
                          editQtyInputRef.current?.focus();
                          editQtyInputRef.current?.select();
                        }, 25);
                      }}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">{t('الكمية:', 'Qty:')}</label>
                    <QuantityInput
                      inputRef={editQtyInputRef}
                      allowDecimals
                      min={0.001}
                      value={editAddQty}
                      onChange={setEditAddQty}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          editPriceInputRef.current?.focus();
                          editPriceInputRef.current?.select();
                        }
                      }}
                      ariaLabel={t('كمية صنف مضاف', 'Added Item Qty')}
                      inputClassName="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-center font-mono font-bold"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block font-bold text-slate-700 mb-1">{t('سعر الشراء:', 'Buy Price:')}</label>
                    <input
                      ref={editPriceInputRef}
                      type="number"
                      min={0}
                      step="0.5"
                      value={editAddPrice}
                      onChange={(e) => setEditAddPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleAddItemToEdit();
                        }
                      }}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-center font-mono font-bold"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={handleAddItemToEdit}
                      className="w-full py-1.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                    >
                      {t('+ إضافة', '+ Add')}
                    </button>
                  </div>
                </div>
                {editSupplierId && editAddProdId && (() => {
                  const rawHist = (supplierPriceHistoryMap[editAddProdId] || []).slice(0, 3).filter((e) => Number(e.price || 0) > 0);
                  return (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                      <span className="font-bold text-slate-700">
                        {t('آخر ثلاثة أسعار شراء من هذا المورد:', 'Last 3 purchase prices from this supplier:')}
                      </span>
                      {rawHist.length > 0 ? (
                        rawHist.map((entry, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setEditAddPrice(Number(entry.price || 0))}
                            className="px-2 py-0.5 rounded bg-white border border-blue-300 hover:bg-blue-100 text-blue-900 font-bold cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <span className="font-mono font-black">{formatLocaleNumber(Number(entry.price || 0))} {t(settings.currency)}</span>
                            {entry.unit && <span className="text-[10px] text-slate-600">({t(entry.unit)})</span>}
                            {entry.date && <span className="text-[10px] text-slate-500 font-mono">({entry.date})</span>}
                            {entry.invoiceNumber && <span className="text-[10px] text-blue-700 font-mono">{entry.invoiceNumber}</span>}
                          </button>
                        ))
                      ) : (
                        <span className="text-slate-500 font-semibold">
                          {t('لا توجد أسعار سابقة', 'No previous prices')}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Editable items table */}
              <EditableItemGrid
                rows={editItems.map((it, idx) => ({
                  ...it,
                  rowKey: `${it.productId}-${it.unit}-${idx}`,
                }))}
                products={products}
                warehouses={warehouses}
                currency={settings.currency}
                priceMode="purchase"
                showPriceColumns
                allowUnitEdit
                allowQtyEdit
                allowPriceEdit
                canDelete={editItems.length > 1}
                canDuplicate
                canAddNew
                recalcPriceOnUnitChange
                onUpdateRow={(idx, patch) => {
                  setEditItems((prev) =>
                    prev.map((it, i) => {
                      if (i !== idx) return it;
                      const nextUnit = patch.unit ?? it.unit;
                      const nextFactor = patch.unitFactor ?? it.unitFactor;
                      const nextQty = patch.quantity !== undefined ? Math.max(0.001, patch.quantity) : it.quantity;
                      const nextPrice = patch.unitPrice !== undefined ? Math.max(0, patch.unitPrice) : it.unitPrice;
                      const nextDisc = patch.discount !== undefined ? Math.max(0, patch.discount) : (it.discount || 0);
                      return {
                        ...it,
                        unit: nextUnit,
                        unitFactor: nextFactor,
                        quantity: nextQty,
                        unitPrice: nextPrice,
                        purchasePriceAtTime:
                          nextFactor > 0 ? Number((nextPrice / nextFactor).toFixed(2)) : nextPrice,
                        discount: nextDisc,
                        total: computeLineTotal(nextQty, nextPrice, nextDisc),
                      };
                    })
                  );
                }}
                onDuplicateRow={(idx) => {
                  const target = editItems[idx];
                  if (!target) return;
                  setEditItems((prev) => {
                    const next = [...prev];
                    next.splice(idx + 1, 0, { ...target });
                    return next;
                  });
                }}
                onDeleteRow={(idx) => {
                  if (editItems.length <= 1) return;
                  setEditItems((prev) => prev.filter((_, i) => i !== idx));
                }}
                onAddNewItem={() => window.setTimeout(() => editProductSearchRef.current?.focus(), 20)}
                onGridAdvanceOut={() => window.setTimeout(() => editProductSearchRef.current?.focus(), 20)}
                onNotify={(msg) => setActionMessage({ type: 'success', text: msg })}
                maxHeightClass="max-h-56"
              />

              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('ملاحظات الفاتورة:', 'Invoice Notes:')}</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {t('سبب التعديل', 'Edit Reason')} {editModalInvoice.status === 'confirmed' ? t('(إلزامي للتدقيق):', '(required for audit):') : t('(اختياري):', '(optional):')}{' '}
                  {editModalInvoice.status === 'confirmed' && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  required={editModalInvoice.status === 'confirmed'}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-semibold focus:border-blue-600 outline-hidden"
                />
              </div>

              {(() => {
                const sub = editItems.reduce((acc, it) => acc + computeLineTotal(it.quantity, it.unitPrice, it.discount || 0), 0);
                const grand = Math.max(0, sub - Math.max(0, Number(editDiscount || 0)));
                const diff = grand - editModalInvoice.grandTotal;
                const belowPaid = grand < Number(editModalInvoice.paidAmount || 0) - 0.01;
                return (
                  <div className="space-y-1.5">
                    <div className={`p-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-xs ${belowPaid ? 'bg-red-50 border-red-300' : 'bg-blue-50/70 border-blue-200'}`}>
                      <div>
                        <span className="text-slate-600 block text-[10px]">{t('الإجمالي المعدّل:', 'Adjusted Total:')}</span>
                        <strong className="text-sm font-black text-blue-950">{formatLocaleNumber(grand)} {t(settings.currency)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block text-[10px]">{t('المدفوع مسبقاً:', 'Previously Paid:')}</span>
                        <strong className="text-sm font-bold text-emerald-700">{formatLocaleNumber(editModalInvoice.paidAmount)} {t(settings.currency)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block text-[10px]">{t('المتبقي للمورد بعد التعديل:', 'Remaining Due After Edit:')}</span>
                        <strong className="text-sm font-bold text-red-700">{formatLocaleNumber(Math.max(0, grand - editModalInvoice.paidAmount))} {t(settings.currency)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-600 block text-[10px]">{t('الفرق عن الأصل:', 'Diff from Original:')}</span>
                        <strong className={`text-sm font-black ${diff > 0 ? 'text-red-700' : diff < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                          {diff > 0 ? `+${formatLocaleNumber(diff)}` : formatLocaleNumber(diff)} {t(settings.currency)}
                        </strong>
                      </div>
                    </div>
                    {belowPaid && (
                      <div className="text-[11px] font-bold text-red-700">
                        {t('تحذير: الإجمالي المعدّل أقل من المبلغ المدفوع مسبقاً للمورد ولن يُسمح بالحفظ.', 'Warning: Adjusted total is less than the amount already paid to supplier and cannot be saved.')}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-1.5 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setEditModalInvoice(null)}
                  className="px-3 py-1 rounded-md border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  {t('إلغاء', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit || editItems.length === 0 || (editItems.reduce((acc, it) => acc + computeLineTotal(it.quantity, it.unitPrice, it.discount || 0), 0) - Math.max(0, Number(editDiscount || 0))) < Number(editModalInvoice.paidAmount || 0) - 0.01}
                  className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingEdit ? t('جاري حفظ التعديل...', 'Saving Changes...') : t('حفظ وتحديث الفاتورة', 'Save & Update Invoice')}
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
        title={`${t('إلغاء فاتورة الشراء', 'Cancel Purchase Invoice')} ${cancelTarget?.invoiceNumber || ''}`}
        message={t('سيتم إلغاء فاتورة المشتريات وتحديث المخزون وحساب المورد والخزينة. يرجى كتابة السبب:', 'The purchase invoice will be cancelled and inventory, supplier account, and treasury updated. Please enter the reason:')}
        confirmLabel={t('تأكيد الإلغاء', 'Confirm Cancellation')}
        variant="danger"
        requireInput
        inputLabel={t('سبب الإلغاء:', 'Cancellation Reason:')}
        isLoading={isCancelling}
      />

      {sendModalInvoice && (
        <Modal
          isOpen={Boolean(sendModalInvoice)}
          onClose={() => !isSendingModalBusy && setSendModalInvoice(null)}
          title={`${sendModalInvoice.dispatchStatus === 'rejected' ? t('إعادة إرسال', 'Resend') : t('إرسال', 'Send')} ${t('فاتورة الشراء', 'Purchase Invoice')} (${sendModalInvoice.invoiceNumber}) ${t('للإدارة', 'to Management')}`}
          maxWidth="md"
        >
          <div className="space-y-2 text-xs">
            <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold">
              {t('سيتم توجيه الفاتورة للإدارة للاستلام والمراجعة فقط دون تعديل المخزون أو حساب المورد أو الخزينة حتى الاعتماد.', 'The invoice will be routed to management for receipt and review only without modifying inventory, supplier balance, or treasury until approved.')}
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('المسؤول الموجه إليه:', 'Target Manager:')}</label>
              <select
                value={sendModalRecipientId}
                onChange={(e) => setSendModalRecipientId(e.target.value)}
                className="w-full h-8 px-2 py-1 rounded-md border border-slate-300 bg-white font-bold"
              >
                <option value="">{t('الإدارة العامة (جميع المسؤولين المختصين)', 'General Management (All Authorized Managers)')}</option>
                {purchaseReceivers.map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName} ({t(r.role)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظة للإدارة (اختياري):', 'Note to Management (optional):')}</label>
              <input
                type="text"
                value={sendModalNotes}
                onChange={(e) => setSendModalNotes(e.target.value)}
                className="w-full h-8 px-2 py-1 rounded-md border border-slate-300"
              />
            </div>
            <div className="flex justify-end gap-1.5 pt-2 border-t">
              <button
                type="button"
                disabled={isSendingModalBusy}
                onClick={() => setSendModalInvoice(null)}
                className="px-3 py-1 rounded-md border border-slate-300 font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
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
                      text: t(
                        `تم إرسال فاتورة الشراء (${sendModalInvoice.invoiceNumber}) إلى ${chosen?.fullName || 'الإدارة العامة'} بانتظار الاستلام والاعتماد.`,
                        `Purchase invoice (${sendModalInvoice.invoiceNumber}) sent to ${chosen?.fullName || t('الإدارة العامة', 'General Management')} awaiting receipt and approval.`
                      ),
                    });
                  } else {
                    setActionMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر إرسال الفاتورة', 'Unable to send invoice') });
                  }
                }}
                className="px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSendingModalBusy ? t('جاري الإرسال...', 'Sending...') : t('تأكيد الإرسال', 'Confirm Send')}</span>
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

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  AlertTriangle,
  Barcode,
  Plus,
  Printer,
  Save,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber, translateSystemEntityName } from '../../../i18n/translator';
import { CustomerItemOrderRequest, CustomerPriceHistoryEntry } from '../../../types';
import { Modal } from '../../common/Modal';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import {
  filterProductsByGroupCategory,
  LinkedGroupCategoryFilter,
  resolveGroupCategoryCascade,
} from '../../common/LinkedGroupCategoryFilter';
import { EditableItemGrid } from '../../common/EditableItemGrid';
import { QuantityInput } from '../../common/QuantityInput';
import { computeLineTotal, roundCurrency } from '../../../utils/quantity';

interface NewSaleInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoiceCreated?: (invoice: any, shouldPrint?: boolean) => void;
  sourceOrder?: CustomerItemOrderRequest | null;
}

interface DraftSaleRow {
  productId: string;
  productName: string;
  barcode: string;
  groupId?: string;
  groupName?: string;
  categoryId?: string;
  categoryName?: string;
  unit: string;
  unitFactor: number;
  quantity: number;
  unitPrice: number;
  purchasePriceAtTime: number;
  discount: number;
  total: number;
}

export const NewSaleInvoiceModal: React.FC<NewSaleInvoiceModalProps> = ({
  isOpen,
  onClose,
  onInvoiceCreated,
  sourceOrder = null,
}) => {
  const {
    products,
    productGroups,
    categories,
    customers,
    warehouses,
    representatives,
    cashboxes,
    settings,
    createSalesInvoice,
    convertOrderToInvoice,
    createRepItemTransfer,
    getCustomerPriceHistory,
  } = useData();
  const { currentUser } = useAuth();
  const { registerHandler } = useShortcuts();
  const { t, language } = usePreferences();
  const groupTriggerRef = useRef<HTMLButtonElement | null>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);
  const unitPriceInputRef = useRef<HTMLInputElement | null>(null);
  const [gridNotice, setGridNotice] = useState<{ text: string; type: 'success' | 'info' | 'warning' | 'error' } | null>(null);

  // Header & Payment states
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(warehouses[0]?.id || 'WH-01');
  const [selectedRepId, setSelectedRepId] = useState<string>(representatives[0]?.id || '');
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>(cashboxes[0]?.id || 'CASH-01');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [invoiceStatusMode, setInvoiceStatusMode] = useState<'confirmed' | 'draft'>('confirmed');
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [discountTotal, setDiscountTotal] = useState<number | ''>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Added Invoice Items
  const [items, setItems] = useState<DraftSaleRow[]>([]);

  // Classic Item Entry states
  const [itemGroupFilter, setItemGroupFilter] = useState('all');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedUnitName, setSelectedUnitName] = useState<string>('');
  const [inputQuantity, setInputQuantity] = useState<number | ''>('');
  const [inputUnitPrice, setInputUnitPrice] = useState<number | ''>('');

  const scopedSaleProducts = useMemo(
    () =>
      filterProductsByGroupCategory(
        products,
        productGroups,
        categories,
        itemGroupFilter,
        itemCategoryFilter
      ),
    [products, productGroups, categories, itemGroupFilter, itemCategoryFilter]
  );

  const hydratedSourceOrderRef = useRef<CustomerItemOrderRequest | null>(sourceOrder);
  hydratedSourceOrderRef.current = sourceOrder;

  // Hydrate when opening or sourceOrder changes
  useEffect(() => {
    if (!isOpen) return;
    const order = hydratedSourceOrderRef.current;
    setError(null);
    setInvoiceStatusMode('confirmed');
    setItemGroupFilter('all');
    setItemCategoryFilter('all');
    setBarcodeInput('');
    setSelectedProductId('');
    setSelectedUnitName('');
    setInputQuantity('');
    setInputUnitPrice('');
    setSelectedWarehouseId((prev) =>
      warehouses.some((w) => w.id === prev) ? prev : warehouses[0]?.id || 'WH-01'
    );
    setSelectedCashboxId((prev) =>
      cashboxes.some((c) => c.id === prev) ? prev : cashboxes[0]?.id || 'CASH-01'
    );

    if (order) {
      const orderAdvance = Math.max(0, Number(order.advancePaidAmount || 0));
      setSelectedCustomerId(order.customerId || '');
      if (order.deliveryRepId || order.representativeId) {
        setSelectedRepId(order.deliveryRepId || order.representativeId || '');
      }
      setPaymentType(orderAdvance > 0 ? 'partial' : 'credit');
      setPaidAmount('');
      setDiscountTotal('');
      setNotes(
        `${t('تحويل طلب عميل رقم', 'Converted customer order #')} ${order.requestNumber}${order.notes ? ` — ${order.notes}` : ''}`
      );
      const hydrated: DraftSaleRow[] = (order.items || []).map((oi) => {
        const prod = products.find((p) => p.id === oi.productId);
        const unitName = oi.unit || prod?.baseUnit || 'قطعة';
        const matchedUnit = prod?.units?.find((u) => u.name === unitName);
        const unitFactor = oi.unitFactor || matchedUnit?.conversionFactor || 1;
        const unitPrice =
          matchedUnit?.sellingPrice ??
          (prod && prod.sellingPrice > 0 ? prod.sellingPrice : oi.unitPrice || 0);
        const purchasePriceAtTime =
          matchedUnit?.purchasePrice ?? (prod?.purchasePrice || 0) * unitFactor;
        return {
          productId: oi.productId,
          productName: prod?.name || oi.productName,
          barcode: prod?.barcode || oi.productCode || '',
          unit: unitName,
          unitFactor,
          quantity: oi.quantity,
          unitPrice,
          purchasePriceAtTime,
          discount: 0,
          total: computeLineTotal(oi.quantity, unitPrice, 0),
        };
      });
      setItems(hydrated);
    } else {
      setSelectedCustomerId('');
      setPaymentType('cash');
      setPaidAmount('');
      setDiscountTotal('');
      setNotes('');
      setItems([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sourceOrder?.id]);

  // Fallback defaults when warehouses/cashboxes load after modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (warehouses.length > 0 && !warehouses.some((w) => w.id === selectedWarehouseId)) {
      setSelectedWarehouseId(warehouses[0].id);
    }
    if (cashboxes.length > 0 && !cashboxes.some((c) => c.id === selectedCashboxId)) {
      setSelectedCashboxId(cashboxes[0].id);
    }
  }, [isOpen, warehouses, cashboxes, selectedWarehouseId, selectedCashboxId]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId),
    [customers, selectedCustomerId]
  );

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId),
    [products, selectedProductId]
  );

  const [fetchedPriceHistory, setFetchedPriceHistory] = useState<
    Record<string, Array<CustomerPriceHistoryEntry | number>>
  >({});

  useEffect(() => {
    let cancelled = false;
    if (!isOpen || !selectedCustomerId) {
      setFetchedPriceHistory({});
      return;
    }
    getCustomerPriceHistory(selectedCustomerId).then((hist) => {
      if (!cancelled) setFetchedPriceHistory(hist || {});
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedCustomerId, getCustomerPriceHistory]);

  const customerProductHistoryEntries = useMemo(() => {
    if (!selectedCustomerId || !selectedProduct) return [];
    const raw =
      fetchedPriceHistory[selectedProduct.id] ||
      selectedCustomer?.priceHistory?.[selectedProduct.id] ||
      [];
    return raw
      .slice(0, 3)
      .map((entry) => {
        if (typeof entry === 'number') {
          return { unitPrice: entry, date: '' };
        }
        return { unitPrice: Number(entry.price || 0), date: entry.date || '' };
      })
      .filter((e) => e.unitPrice > 0);
  }, [selectedCustomerId, selectedCustomer, selectedProduct, fetchedPriceHistory]);

  const productUnitOptions = useMemo(() => {
    if (!selectedProduct) return [];
    return [
      {
        name: selectedProduct.baseUnit,
        conversionFactor: 1,
        sellingPrice: selectedProduct.sellingPrice,
        purchasePrice: selectedProduct.purchasePrice,
      },
      ...(selectedProduct.units || []).map((u) => ({
        name: u.name,
        conversionFactor: u.conversionFactor || 1,
        sellingPrice: u.sellingPrice,
        purchasePrice: u.purchasePrice,
      })),
    ];
  }, [selectedProduct]);

  const handleProductSelect = (prodId: string) => {
    setSelectedProductId(prodId);
    const prod = products.find((p) => p.id === prodId);
    if (!prod) return;
    const opts = [
      { name: prod.baseUnit, conversionFactor: 1, sellingPrice: prod.sellingPrice },
      ...(prod.units || []).map((u) => ({
        name: u.name,
        conversionFactor: u.conversionFactor || 1,
        sellingPrice: u.sellingPrice,
      })),
    ];
    const initialUnit = prod.units && prod.units.length > 0 ? opts[1] || opts[0] : opts[0];
    setSelectedUnitName(initialUnit.name);
    setInputQuantity('');
    setInputUnitPrice(initialUnit.sellingPrice > 0 ? initialUnit.sellingPrice : '');
    setError(null);
    window.setTimeout(() => {
      qtyInputRef.current?.focus();
    }, 30);
  };

  const handleUnitChange = (unitName: string) => {
    setSelectedUnitName(unitName);
    const matched = productUnitOptions.find((u) => u.name === unitName);
    if (matched) {
      setInputUnitPrice(matched.sellingPrice > 0 ? matched.sellingPrice : '');
    }
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
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
      const matchedUnit = prod.units.find((u) => u.barcode === barcode);
      setSelectedProductId(prod.id);
      if (matchedUnit) {
        setSelectedUnitName(matchedUnit.name);
        setInputUnitPrice(matchedUnit.sellingPrice > 0 ? matchedUnit.sellingPrice : '');
      } else {
        setSelectedUnitName(prod.baseUnit);
        setInputUnitPrice(prod.sellingPrice > 0 ? prod.sellingPrice : '');
      }
      setInputQuantity('');
      setBarcodeInput('');
      setError(null);
      window.setTimeout(() => qtyInputRef.current?.focus(), 30);
    } else {
      setError(
        t(
          `لم يتم العثور على صنف بالباركود أو الكود: ${barcode}`,
          `No item found with barcode or code: ${barcode}`
        )
      );
    }
  };

  const handleAddItem = () => {
    if (!selectedProduct) {
      setError(t('يرجى اختيار صنف أولاً', 'Please select an item first'));
      return;
    }
    const qtyVal = Number(inputQuantity || 0);
    const priceVal = Number(inputUnitPrice || 0);
    if (qtyVal <= 0) {
      setError(
        t(
          'يرجى إدخال كمية صحيحة أكبر من صفر',
          'Please enter a valid quantity greater than zero'
        )
      );
      return;
    }
    if (priceVal < 0) {
      setError(t('سعر البيع لا يمكن أن يكون سالباً', 'Selling price cannot be negative'));
      return;
    }

    let unitFactor = 1;
    let purchasePriceAtTime = selectedProduct.purchasePrice;
    const effectiveUnit = selectedUnitName || selectedProduct.baseUnit;

    if (effectiveUnit !== selectedProduct.baseUnit) {
      const u = selectedProduct.units.find((un) => un.name === effectiveUnit);
      if (u) {
        unitFactor = u.conversionFactor;
        purchasePriceAtTime = u.purchasePrice || selectedProduct.purchasePrice * unitFactor;
      }
    }

    const availInWh = selectedProduct.stockPerWarehouse[selectedWarehouseId] || 0;
    const reqBase = qtyVal * unitFactor;
    const existingBaseForProduct = items
      .filter((it) => it.productId === selectedProduct.id)
      .reduce((sum, it) => sum + it.quantity * (it.unitFactor || 1), 0);
    const isRepInvoice = Boolean(selectedRepId || currentUser?.role === 'representative');

    if (
      invoiceStatusMode === 'confirmed' &&
      availInWh < existingBaseForProduct + reqBase &&
      !settings.allowNegativeStock &&
      !isRepInvoice
    ) {
      setError(
        t(
          `الكمية المتاحة بالمستودع من (${selectedProduct.name}) هي ${availInWh} ${selectedProduct.baseUnit}، وهي غير كافية لإجمالي الكمية المطلوبة (${existingBaseForProduct + reqBase}).`,
          `Available warehouse stock for (${selectedProduct.name}) is ${availInWh} ${t(selectedProduct.baseUnit)}, which is insufficient for total requested quantity (${existingBaseForProduct + reqBase}).`
        )
      );
      return;
    }

    const itemTotal = computeLineTotal(qtyVal, priceVal, 0);

    setItems((prev) => {
      const existingIdx = prev.findIndex(
        (it) => it.productId === selectedProduct.id && it.unit === effectiveUnit
      );
      if (existingIdx >= 0) {
        return prev.map((it, idx) => {
          if (idx !== existingIdx) return it;
          const nextQty = Number((it.quantity + qtyVal).toFixed(4));
          return {
            ...it,
            quantity: nextQty,
            unitPrice: priceVal,
            purchasePriceAtTime,
            total: computeLineTotal(nextQty, priceVal, it.discount || 0),
          };
        });
      }
      return [
        ...prev,
        {
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          barcode: selectedProduct.barcode,
          groupId: selectedProduct.groupId,
          groupName: selectedProduct.groupName,
          categoryId: selectedProduct.categoryId,
          categoryName: selectedProduct.category,
          unit: effectiveUnit,
          unitFactor,
          quantity: qtyVal,
          unitPrice: priceVal,
          purchasePriceAtTime,
          discount: 0,
          total: itemTotal,
        },
      ];
    });

    setSelectedProductId('');
    setSelectedUnitName('');
    setInputQuantity('');
    setInputUnitPrice('');
    setError(null);
    window.setTimeout(() => {
      productSearchRef.current?.focus();
    }, 30);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Accounting Summary Totals
  const grossSubtotal = useMemo(
    () => roundCurrency(items.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0)),
    [items]
  );

  const itemDiscountsTotal = useMemo(
    () => roundCurrency(items.reduce((acc, it) => acc + (it.discount || 0), 0)),
    [items]
  );

  const generalDiscountNum = useMemo(
    () => Math.max(0, roundCurrency(Number(discountTotal || 0))),
    [discountTotal]
  );

  const totalDiscount = useMemo(
    () => roundCurrency(itemDiscountsTotal + generalDiscountNum),
    [itemDiscountsTotal, generalDiscountNum]
  );

  const grandTotal = useMemo(
    () => Math.max(0, roundCurrency(grossSubtotal - totalDiscount)),
    [grossSubtotal, totalDiscount]
  );

  const appliedAdvance = useMemo(() => {
    if (!sourceOrder) return 0;
    return Math.min(grandTotal, Math.max(0, Number(sourceOrder.advancePaidAmount || 0)));
  }, [sourceOrder, grandTotal]);

  const maxCashAtInvoice = useMemo(
    () => Math.max(0, roundCurrency(grandTotal - appliedAdvance)),
    [grandTotal, appliedAdvance]
  );

  const effectivePaidAtInvoice = useMemo(() => {
    if (paymentType === 'cash') return maxCashAtInvoice;
    if (paymentType === 'credit') return 0;
    return Math.min(maxCashAtInvoice, Math.max(0, Number(paidAmount) || 0));
  }, [paymentType, maxCashAtInvoice, paidAmount]);

  const remainingAmount = useMemo(
    () => Math.max(0, roundCurrency(grandTotal - appliedAdvance - effectivePaidAtInvoice)),
    [grandTotal, appliedAdvance, effectivePaidAtInvoice]
  );

  const previousBalance = selectedCustomer ? Number(selectedCustomer.currentBalance || 0) : null;
  const currentBalanceAfter =
    previousBalance !== null ? roundCurrency(previousBalance + remainingAmount) : null;

  const shortageItems = useMemo(() => {
    const list: Array<{
      productId: string;
      productName: string;
      unit: string;
      requestedQty: number;
      availableInVanQty: number;
      shortageQty: number;
    }> = [];

    items.forEach((it) => {
      const prod = products.find((p) => p.id === it.productId);
      if (prod) {
        const avail = prod.stockPerWarehouse[selectedWarehouseId] || 0;
        const reqBase = it.quantity * (it.unitFactor || 1);
        if (avail < reqBase) {
          list.push({
            productId: it.productId,
            productName: it.productName,
            unit: it.unit,
            requestedQty: reqBase,
            availableInVanQty: avail,
            shortageQty: reqBase - avail,
          });
        }
      }
    });

    return list;
  }, [items, products, selectedWarehouseId]);

  useEffect(() => {
    if (paymentType === 'cash') {
      setPaidAmount(maxCashAtInvoice > 0 ? maxCashAtInvoice : '');
    } else if (paymentType === 'credit') {
      setPaidAmount('');
    } else {
      setPaidAmount((prev) => {
        if (prev === '' || prev === undefined) return '';
        const n = Number(prev);
        if (!Number.isFinite(n) || n < 0) return '';
        return n > maxCashAtInvoice ? maxCashAtInvoice : prev;
      });
    }
  }, [paymentType, maxCashAtInvoice]);

  const handleSubmitInvoice = useCallback(
    async (shouldPrint = false) => {
      if (isSubmitting) return;
      if (items.length === 0) {
        setError(t('يرجى إضافة صنف واحد على الأقل للفاتورة', 'Please add at least one item to the invoice'));
        return;
      }
      const wh = warehouses.find((w) => w.id === selectedWarehouseId);
      const canNegative =
        Boolean(settings.allowNegativeStock) &&
        (currentUser?.role === 'admin' || Boolean(currentUser?.permissions?.canAllowNegativeInventory));

      if (invoiceStatusMode === 'confirmed' && shortageItems.length > 0 && !canNegative) {
        const names = shortageItems
          .map((s) => `${s.productName} (${t('متاح', 'avail.')} ${s.availableInVanQty})`)
          .join(language === 'en' ? ', ' : '، ');
        setError(
          t(
            `لا يمكن اعتماد الفاتورة لعدم كفاية الرصيد في (${wh?.name || 'المستودع المحدد'}): ${names}. يمكنك الحفظ كمسودة أو تنفيذ تحويل مخزني أولاً.`,
            `Cannot confirm invoice due to insufficient stock in (${wh?.name ? translateSystemEntityName(wh.name) : t('المستودع المحدد', 'Selected Warehouse')}): ${names}. You can save as draft or make a stock transfer first.`
          )
        );
        return;
      }

      setError(null);
      setIsSubmitting(true);

      try {
        const rep =
          representatives.find((r) => r.id === selectedRepId) ||
          representatives.find((r) => r.userId && r.userId === currentUser?.id) ||
          (currentUser?.role !== 'representative'
            ? representatives.find(
                (r) => !r.userId && r.name.toLowerCase() === currentUser?.fullName?.toLowerCase()
              )
            : undefined);

        let linkedTransferId: string | undefined;
        let linkedTransferNumber: string | undefined;

        if (invoiceStatusMode === 'confirmed' && shortageItems.length > 0 && rep && canNegative) {
          const mainWh = warehouses.find((w) => w.isDefault) || warehouses[0];
          if (mainWh) {
            const transferRes = await createRepItemTransfer({
              date: invoiceDate,
              representativeId: rep.id,
              representativeName: rep.name,
              sourceWarehouseId: mainWh.id,
              sourceWarehouseName: mainWh.name,
              targetWarehouseId: selectedWarehouseId,
              targetWarehouseName: wh?.name || `سيارة المندوب (${rep.name})`,
              items: shortageItems,
              notes: t(
                'طلب تحويل عهدة آلي مرتبط بالفاتورة',
                'Auto-generated custody transfer request linked to invoice'
              ),
            });
            if (transferRes.success && transferRes.request) {
              linkedTransferId = transferRes.request.id;
              linkedTransferNumber = transferRes.request.requestNumber;
            }
          }
        }

        const totalPaidOnInvoice = Math.min(grandTotal, appliedAdvance + effectivePaidAtInvoice);

        const payload = {
          date: invoiceDate,
          customerId: selectedCustomerId || undefined,
          customerName: selectedCustomer?.name || sourceOrder?.customerName || 'عميل نقدي / عام',
          representativeId: selectedRepId || rep?.id,
          representativeName: rep?.name,
          warehouseId: selectedWarehouseId,
          warehouseName: wh?.name || 'المستودع الرئيسي',
          items,
          subtotal: grossSubtotal,
          discountTotal: totalDiscount,
          taxTotal: 0,
          grandTotal,
          paidAmount: totalPaidOnInvoice,
          appliedAdvanceAmount: appliedAdvance,
          paidAtInvoice: effectivePaidAtInvoice,
          remainingAmount: Math.max(0, roundCurrency(grandTotal - totalPaidOnInvoice)),
          paymentType,
          paymentMethod: 'cash' as const,
          cashboxId: paymentType === 'credit' || effectivePaidAtInvoice <= 0 ? '' : (selectedCashboxId || cashboxes[0]?.id || ''),
          status: invoiceStatusMode,
          notes: notes.trim(),
          linkedRepTransferId: linkedTransferId,
          linkedRepTransferNumber: linkedTransferNumber,
        };

        const res = sourceOrder
          ? await convertOrderToInvoice(sourceOrder.id, payload)
          : await createSalesInvoice(payload);

        if (res.success) {
          if (onInvoiceCreated) {
            onInvoiceCreated(res.invoice, shouldPrint);
          }
          onClose();
        } else {
          setError(
            res.error ? t(res.error) : t('حدث خطأ أثناء حفظ الفاتورة', 'An error occurred while saving the invoice')
          );
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      items,
      warehouses,
      selectedWarehouseId,
      representatives,
      selectedRepId,
      currentUser,
      settings.allowNegativeStock,
      invoiceStatusMode,
      shortageItems,
      createRepItemTransfer,
      invoiceDate,
      selectedCustomerId,
      selectedCustomer,
      sourceOrder,
      grossSubtotal,
      totalDiscount,
      grandTotal,
      appliedAdvance,
      effectivePaidAtInvoice,
      paymentType,
      selectedCashboxId,
      notes,
      convertOrderToInvoice,
      createSalesInvoice,
      onInvoiceCreated,
      onClose,
      language,
      t,
    ]
  );

  const submitRef = useRef(handleSubmitInvoice);
  submitRef.current = handleSubmitInvoice;

  useEffect(() => {
    if (!isOpen) return;
    const u1 = registerHandler('action:save_invoice', () => submitRef.current(false));
    const u2 = registerHandler('action:focus_product_search', () => productSearchRef.current?.focus());
    return () => {
      u1();
      u2();
    };
  }, [isOpen, registerHandler]);

  const currencyLabel = t(settings.currency);
  const inlinePreviewTotal =
    inputQuantity !== '' && inputUnitPrice !== ''
      ? computeLineTotal(Number(inputQuantity), Number(inputUnitPrice), 0)
      : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        sourceOrder
          ? t(
              `تحويل طلب العميل (${sourceOrder.requestNumber}) إلى فاتورة بيع`,
              `Convert Customer Order (${sourceOrder.requestNumber}) to Sales Invoice`
            )
          : t('إنشاء فاتورة مبيعات جديدة', 'Create New Sales Invoice')
      }
      subtitle={
        sourceOrder
          ? t(
              `العميل: ${sourceOrder.customerName} — راجع الأسعار والكميات واختر الاعتماد أو الحفظ كمسودة`,
              `Customer: ${sourceOrder.customerName} — Review prices and quantities and choose confirm or save as draft`
            )
          : t(
              'إصدار فاتورة بيع وتحديث المخازن وحسابات العملاء والخزينة آلياً',
              'Issue a sales invoice and automatically update warehouses, customer balances, and cashbox'
            )
      }
      maxWidth="4xl"
    >
      <div className="space-y-2.5 text-xs">
        {error && (
          <div className="p-2 bg-red-50 border border-red-200 text-red-700 rounded-md font-bold flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Header Row */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
          <div>
            <SearchableFilterSelect
              id="sale-modal-customer"
              label={t('العميل', 'Customer')}
              disabled={Boolean(sourceOrder)}
              value={selectedCustomerId}
              onChange={setSelectedCustomerId}
              options={customers.map((c) => ({
                value: c.id,
                label: c.shopName ? `${c.shopName} (${c.name})` : c.name,
                subtitle: c.phone || undefined,
                badge:
                  c.currentBalance > 0
                    ? `${t('عليه:', 'Owes:')} ${formatLocaleNumber(c.currentBalance)}`
                    : `${t('رصيد:', 'Bal:')} ${formatLocaleNumber(c.currentBalance)}`,
                searchText: `${c.name} ${c.shopName || ''} ${c.phone || ''} ${c.code || ''}`,
              }))}
              allOptionLabel={t('-- عميل نقدي عام --', '-- Walk-in / Cash Customer --')}
              allOptionValue=""
              searchPlaceholder={t(
                'ابحث باسم العميل أو المحل أو الهاتف...',
                'Search by customer, shop, or phone...'
              )}
              allowClear={!sourceOrder}
              minPanelWidth={260}
              buttonClassName="rounded-md h-8"
              onAfterSelect={() => {
                window.setTimeout(() => groupTriggerRef.current?.focus(), 20);
              }}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
              {t('المستودع المصروف منه:', 'Issue Warehouse:')}
            </label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-800"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {t(w.name)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <SearchableFilterSelect
              id="sale-modal-rep"
              label={t('المندوب', 'Rep')}
              value={selectedRepId}
              onChange={setSelectedRepId}
              options={representatives.map((r) => ({
                value: r.id,
                label: r.name,
                subtitle: r.phone || undefined,
                searchText: `${r.name} ${r.phone || ''}`,
              }))}
              allOptionLabel={t('-- بيع مباشر --', '-- Direct Sale --')}
              allOptionValue=""
              searchPlaceholder={t('ابحث باسم المندوب...', 'Search by rep name...')}
              allowClear
              buttonClassName="rounded-md h-8"
            />
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

        {/* Classic Inline Item Add Bar */}
        <div className="bg-blue-50/60 p-2.5 rounded-lg border border-blue-200 space-y-2">
          <LinkedGroupCategoryFilter
            productGroups={productGroups}
            categories={categories}
            selectedGroupId={itemGroupFilter}
            selectedCategoryId={itemCategoryFilter}
            groupTriggerRef={groupTriggerRef}
            categoryTriggerRef={categoryTriggerRef}
            autoAdvanceOnSelect
            onCategoryAfterSelect={() => {
              window.setTimeout(() => productSearchRef.current?.focus(), 20);
            }}
            onFilterChange={(nextGroupId, nextCategoryId) => {
              setItemGroupFilter(nextGroupId);
              setItemCategoryFilter(nextCategoryId);
              const { clearSelectedProduct } = resolveGroupCategoryCascade(
                products,
                productGroups,
                categories,
                nextGroupId,
                nextCategoryId,
                selectedProductId
              );
              if (clearSelectedProduct) {
                setSelectedProductId('');
                setSelectedUnitName('');
                setInputQuantity('');
                setInputUnitPrice('');
              }
            }}
          />
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
            <form onSubmit={handleBarcodeSubmit} className="sm:col-span-4">
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                {t('قراءة باركود سريع:', 'Quick Barcode Scan:')}
              </label>
              <div className="relative flex items-center">
                <Barcode className="w-3.5 h-3.5 text-slate-400 absolute start-2 pointer-events-none" />
                <input
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder={t('امسح الباركود واضغط Enter...', 'Scan barcode & press Enter...')}
                  className="w-full h-8 ps-7 pe-2 bg-white border border-slate-300 rounded-md text-xs font-mono"
                />
              </div>
            </form>
            <div className="sm:col-span-8">
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                {t('اختيار الصنف:', 'Select Item:')}
              </label>
              <ProductSearchSelect
                inputRef={productSearchRef}
                products={scopedSaleProducts}
                warehouses={warehouses}
                warehouseId={selectedWarehouseId}
                selectedProductId={selectedProductId}
                priceMode="selling"
                currency={settings.currency}
                placeholder={t('ابحث باسم الصنف أو الكود أو الباركود...', 'Search item by name, code, or barcode...')}
                onSelect={(prod) => handleProductSelect(prod.id)}
                onAfterSelect={() => {
                  window.setTimeout(() => qtyInputRef.current?.focus(), 20);
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                {t('الوحدة:', 'Unit:')}
              </label>
              <select
                disabled={!selectedProduct}
                value={selectedUnitName}
                onChange={(e) => handleUnitChange(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-xs font-bold disabled:bg-slate-100"
              >
                {productUnitOptions.length === 0 ? (
                  <option value="">{t('-- الوحدة --', '-- Unit --')}</option>
                ) : (
                  productUnitOptions.map((u) => (
                    <option key={u.name} value={u.name}>
                      {t(u.name)}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                {t('الكمية:', 'Qty:')}
              </label>
              <QuantityInput
                inputRef={qtyInputRef}
                allowDecimals
                min={0.001}
                disabled={!selectedProduct}
                value={inputQuantity}
                onChange={(val) => setInputQuantity(val)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    window.setTimeout(() => {
                      unitPriceInputRef.current?.focus();
                      unitPriceInputRef.current?.select();
                    }, 10);
                  }
                }}
                placeholder=""
                ariaLabel={t('الكمية', 'Quantity')}
                inputClassName="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-center font-mono font-bold text-xs disabled:bg-slate-100"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                {t('سعر الوحدة', 'Unit Price')} ({currencyLabel}):
              </label>
              <input
                ref={unitPriceInputRef}
                type="number"
                min={0}
                step="0.5"
                disabled={!selectedProduct}
                value={inputUnitPrice}
                onChange={(e) => setInputUnitPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleAddItem();
                  }
                }}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-center font-mono font-bold text-xs disabled:bg-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                {t('القيمة:', 'Line Total:')}
              </label>
              <div className="w-full h-8 bg-slate-100 border border-slate-200 rounded-md px-2 flex items-center justify-center font-mono font-black text-blue-950">
                {formatLocaleNumber(inlinePreviewTotal)}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-2">
              <button
                type="button"
                disabled={!selectedProduct}
                onClick={handleAddItem}
                className="w-full h-8 flex items-center justify-center gap-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold text-xs disabled:opacity-50 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('إضافة', 'Add')}</span>
              </button>
            </div>
          </div>

          {customerProductHistoryEntries.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
              <span className="font-bold text-slate-600">
                {t('أسعار سابقة لهذا العميل:', 'Previous prices for this customer:')}
              </span>
              {customerProductHistoryEntries.map((entry, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setInputUnitPrice(entry.unitPrice)}
                  className="px-2 py-0.5 rounded bg-white border border-blue-300 hover:bg-blue-100 text-blue-900 font-mono font-bold cursor-pointer"
                >
                  {formatLocaleNumber(entry.unitPrice)} {currencyLabel}
                </button>
              ))}
            </div>
          )}
        </div>

        {gridNotice && (
          <div
            className={`px-2.5 py-1.5 rounded-md border text-[11px] font-bold flex items-center justify-between gap-2 ${
              gridNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : gridNotice.type === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : gridNotice.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}
          >
            <span>{gridNotice.text}</span>
            <button
              type="button"
              onClick={() => setGridNotice(null)}
              className="text-[10px] underline cursor-pointer"
            >
              {t('إغلاق', 'Close')}
            </button>
          </div>
        )}

        <EditableItemGrid
          rows={items.map((item, idx) => ({
            ...item,
            rowKey: `${item.productId}-${item.unit}-${idx}`,
          }))}
          products={products}
          warehouses={warehouses}
          currency={settings.currency}
          priceMode="selling"
          showPriceColumns
          showDiscountColumn
          allowUnitEdit
          allowQtyEdit
          allowPriceEdit
          allowDiscountEdit
          canDelete
          canDuplicate
          canAddNew
          hideCostInfo={currentUser?.role === 'representative'}
          recalcPriceOnUnitChange
          maxHeightClass="max-h-60"
          onUpdateRow={(idx, patch) => {
            setItems((prev) =>
              prev.map((row, i) => {
                if (i !== idx) return row;
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
                  purchasePriceAtTime: patch.purchasePriceAtTime ?? row.purchasePriceAtTime,
                  discount: nextDisc,
                  total: patch.total ?? computeLineTotal(nextQty, nextPrice, nextDisc),
                };
              })
            );
          }}
          onDeleteRow={handleRemoveItem}
          onDuplicateRow={(idx) => {
            setItems((prev) => {
              const target = prev[idx];
              if (!target) return prev;
              const copy = { ...target };
              return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
            });
          }}
          onAddNewItem={() => window.setTimeout(() => productSearchRef.current?.focus(), 20)}
          onNotify={(text, type = 'info') => {
            setGridNotice({ text, type });
            window.setTimeout(() => {
              setGridNotice((cur) => (cur?.text === text ? null : cur));
            }, 2500);
          }}
          emptyStateText={t(
            'لم يتم إضافة أي أصناف بعد — ابحث عن الصنف أو امسح الباركود للإضافة',
            'No items added yet — search an item or scan barcode to add'
          )}
        />

        {/* Shortage Warning */}
        {shortageItems.length > 0 && invoiceStatusMode === 'confirmed' && (
          <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-black text-amber-900">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>
                {t(
                  `تنبيه المخزون: عجز في (${shortageItems.length}) أصناف`,
                  `Inventory Alert: Shortage in (${shortageItems.length}) items`
                )}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {shortageItems.map((sh, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-amber-300 rounded text-[10px] font-bold text-amber-900"
                >
                  <span>{sh.productName}:</span>
                  <span className="text-red-600 font-mono">
                    {t('عجز', 'Shortage')} {sh.shortageQty} {t(sh.unit)}
                  </span>
                  <span className="text-slate-400 font-mono">
                    ({t('المتاح:', 'Avail:')} {sh.availableInVanQty})
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Payment & Totals Summary Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="space-y-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                  {t('نظام الدفع:', 'Payment Mode:')}
                </label>
                <div className="grid grid-cols-3 gap-1 font-bold text-[11px]">
                  <button
                    type="button"
                    onClick={() => setPaymentType('cash')}
                    className={`h-8 rounded border cursor-pointer ${
                      paymentType === 'cash'
                        ? 'bg-[#003589] text-white border-[#003589]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {t('نقدي', 'Cash')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (paymentType === 'cash') setPaidAmount('');
                      setPaymentType('partial');
                    }}
                    className={`h-8 rounded border cursor-pointer ${
                      paymentType === 'partial'
                        ? 'bg-[#003589] text-white border-[#003589]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {t('جزئي', 'Partial')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('credit')}
                    className={`h-8 rounded border cursor-pointer ${
                      paymentType === 'credit'
                        ? 'bg-[#003589] text-white border-[#003589]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {t('آجل', 'Credit')}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                  {t('وضع الحفظ:', 'Save Mode:')}
                </label>
                <div className="grid grid-cols-2 gap-1 font-bold text-[11px]">
                  <button
                    type="button"
                    onClick={() => setInvoiceStatusMode('confirmed')}
                    className={`h-8 px-1.5 rounded border cursor-pointer ${
                      invoiceStatusMode === 'confirmed'
                        ? 'bg-[#011E58] text-white border-[#011E58]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {t('اعتماد وإصدار', 'Confirm & Issue')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInvoiceStatusMode('draft')}
                    className={`h-8 px-1.5 rounded border cursor-pointer ${
                      invoiceStatusMode === 'draft'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {t('مسودة', 'Draft')}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                  {t('الخزينة:', 'Cashbox:')}
                </label>
                <select
                  value={selectedCashboxId}
                  disabled={paymentType === 'credit' || maxCashAtInvoice <= 0}
                  onChange={(e) => setSelectedCashboxId(e.target.value)}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-xs font-bold disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {cashboxes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t(c.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                  {t('الخصم العام', 'Discount')} ({currencyLabel}):
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={discountTotal}
                  onChange={(e) => setDiscountTotal(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-center font-mono font-bold"
                />
              </div>
            </div>

            {paymentType === 'partial' && (
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                  {t('المبلغ المدفوع الآن', 'Amount Paid Now')} ({currencyLabel}):
                </label>
                <input
                  type="number"
                  min={0}
                  max={maxCashAtInvoice}
                  step="0.5"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                  className="w-full h-8 bg-white border border-blue-400 rounded-md px-2 text-center font-mono font-black text-blue-950"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                {t('ملاحظات:', 'Notes:')}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 text-xs"
              />
            </div>
          </div>

          <div className="bg-blue-50/50 p-2.5 rounded-lg border border-blue-200 flex flex-col justify-between space-y-1.5">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600 font-semibold">{t('الإجمالي قبل الخصم:', 'Subtotal:')}</span>
                <span className="font-mono font-bold text-slate-800">{formatLocaleNumber(grossSubtotal)} {currencyLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 font-semibold">{t('الخصم:', 'Discount:')}</span>
                <span className="font-mono font-bold text-rose-700">{formatLocaleNumber(totalDiscount)} {currencyLabel}</span>
              </div>
              {appliedAdvance > 0 && (
                <div className="flex justify-between text-emerald-800 font-bold">
                  <span>{t('الدفعة المقدمة المخصومة:', 'Applied Advance:')}</span>
                  <span className="font-mono">{formatLocaleNumber(appliedAdvance)} {currencyLabel}</span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 border-t border-blue-200 text-sm font-black text-[#011E58]">
                <span>{t('صافي الفاتورة:', 'Net Total:')}</span>
                <span className="font-mono">{formatLocaleNumber(grandTotal)} {currencyLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 font-semibold">{t('المدفوع:', 'Paid:')}</span>
                <span className="font-mono font-bold text-emerald-700">{formatLocaleNumber(effectivePaidAtInvoice)} {currencyLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 font-semibold">{t('المتبقي (آجل):', 'Remaining:')}</span>
                <span className="font-mono font-black text-red-700">{formatLocaleNumber(remainingAmount)} {currencyLabel}</span>
              </div>
              {previousBalance !== null && currentBalanceAfter !== null && (
                <div className="flex justify-between pt-1 border-t border-blue-200 text-[11px] text-slate-600">
                  <span>{t('رصيد العميل (سابق / بعد):', 'Customer Balance (Prev / After):')}</span>
                  <span className="font-mono font-bold">
                    {formatLocaleNumber(previousBalance)} → {formatLocaleNumber(currentBalanceAfter)} {currencyLabel}
                  </span>
                </div>
              )}
            </div>

            {appliedAdvance > 0 && (
              <div className="p-1.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-900">
                {t(
                  'تم خصم الدفعة المقدمة تلقائياً — يُودع بالخزينة فقط المبلغ المحصل الآن.',
                  'Advance payment applied automatically — only cash collected now goes to cashbox.'
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-md border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
          >
            {t('إلغاء', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={() => handleSubmitInvoice(false)}
            className={`h-8 flex items-center gap-1.5 px-3.5 rounded-md text-white font-black transition-all disabled:opacity-50 cursor-pointer ${
              invoiceStatusMode === 'draft'
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-[#011E58] hover:bg-[#002160]'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>
              {isSubmitting
                ? t('جاري الحفظ...', 'Saving...')
                : invoiceStatusMode === 'draft'
                ? t('حفظ كمسودة', 'Save Draft')
                : t('حفظ الفاتورة', 'Save Invoice')}
            </span>
          </button>
          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={() => handleSubmitInvoice(true)}
            className="h-8 flex items-center gap-1.5 px-3.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black transition-all disabled:opacity-50 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>
              {invoiceStatusMode === 'draft'
                ? t('حفظ مسودة وطباعة', 'Save Draft & Print')
                : t('حفظ وطباعة', 'Save & Print')}
            </span>
          </button>
        </div>
      </div>
    </Modal>
  );
};


import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Trash2, Barcode, AlertCircle, History, AlertTriangle, Save, Printer
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { CustomerItemOrderRequest } from '../../../types';
import { Modal } from '../../common/Modal';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import { QuantityInput } from '../../common/QuantityInput';
import { computeLineTotal } from '../../../utils/quantity';

interface NewSaleInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoiceCreated?: (invoice: any, shouldPrint?: boolean) => void;
  sourceOrder?: CustomerItemOrderRequest | null;
}

export const NewSaleInvoiceModal: React.FC<NewSaleInvoiceModalProps> = ({
  isOpen,
  onClose,
  onInvoiceCreated,
  sourceOrder = null,
}) => {
  const {
    products, customers, warehouses, representatives, cashboxes,
    settings, createSalesInvoice, convertOrderToInvoice, createRepItemTransfer,
    getCustomerPriceHistory,
  } = useData();
  const { currentUser } = useAuth();
  const { registerHandler } = useShortcuts();
  const { t, locale } = usePreferences();
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);

  // Form states
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
  const [barcodeInput, setBarcodeInput] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedUnitName, setSelectedUnitName] = useState<string>('');
  const [inputQuantity, setInputQuantity] = useState<number | ''>('');
  const [inputUnitPrice, setInputUnitPrice] = useState<number | ''>('');

  const hydratedSourceOrderRef = useRef<CustomerItemOrderRequest | null>(sourceOrder);
  hydratedSourceOrderRef.current = sourceOrder;

  // Hydrate when opening or when sourceOrder identity changes
  useEffect(() => {
    if (!isOpen) return;
    const order = hydratedSourceOrderRef.current;
    setError(null);
    setInvoiceStatusMode('confirmed');
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
      const hydrated = (order.items || []).map((oi) => {
        const prod = products.find((p) => p.id === oi.productId);
        const unitName = oi.unit || prod?.baseUnit || 'قطعة';
        const matchedUnit = prod?.units?.find((u) => u.name === unitName);
        const unitFactor = oi.unitFactor || matchedUnit?.conversionFactor || 1;
        const unitPrice =
          matchedUnit?.sellingPrice ??
          (prod && prod.sellingPrice > 0 ? prod.sellingPrice : oi.unitPrice || 0);
        const purchasePriceAtTime =
          matchedUnit?.purchasePrice ??
          ((prod?.purchasePrice || 0) * unitFactor);
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
          total: oi.quantity * unitPrice,
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

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId);
  }, [customers, selectedCustomerId]);

  const selectedProduct = useMemo(() => {
    return products.find((p) => p.id === selectedProductId);
  }, [products, selectedProductId]);

  const [fetchedPriceHistory, setFetchedPriceHistory] = useState<Record<string, Array<{ price: number; date: string; invoiceNumber?: string; unit?: string; quantity?: number; unitFactor?: number } | number>>>({});

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

  const lastThreePrices = useMemo(() => {
    if (!selectedCustomer || !selectedProductId) return [];
    const liveHist = fetchedPriceHistory[selectedProductId];
    const history = Array.isArray(liveHist) && liveHist.length > 0 ? liveHist : selectedCustomer.priceHistory?.[selectedProductId];
    if (!history || !Array.isArray(history)) return [];
    return history.slice(-3);
  }, [selectedCustomer, selectedProductId, fetchedPriceHistory]);

  const handleProductSelect = (prodId: string) => {
    setSelectedProductId(prodId);
    const prod = products.find((p) => p.id === prodId);
    if (prod) {
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

  const handleUnitChange = (unitName: string) => {
    setSelectedUnitName(unitName);
    if (!selectedProduct) return;

    if (unitName === selectedProduct.baseUnit) {
      setInputUnitPrice(selectedProduct.sellingPrice);
    } else {
      const foundUnit = selectedProduct.units.find((u) => u.name === unitName);
      if (foundUnit) {
        setInputUnitPrice(foundUnit.sellingPrice);
      }
    }
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const barcode = barcodeInput.trim();
    const prod = products.find(
      (p) => p.barcode === barcode || p.code === barcode || p.units.some((u) => u.barcode === barcode)
    );

    if (prod) {
      handleProductSelect(prod.id);
      setBarcodeInput('');
    } else {
      setError(t(`لم يتم العثور على صنف بالباركود أو الكود: ${barcode}`, `No item found with barcode or code: ${barcode}`));
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
      setError(t('يرجى إدخال كمية صحيحة أكبر من صفر', 'Please enter a valid quantity greater than zero'));
      return;
    }
    if (priceVal < 0) {
      setError(t('سعر البيع لا يمكن أن يكون سالباً', 'Selling price cannot be negative'));
      return;
    }

    let unitFactor = 1;
    let purchasePriceAtTime = selectedProduct.purchasePrice;

    if (selectedUnitName !== selectedProduct.baseUnit) {
      const u = selectedProduct.units.find((un) => un.name === selectedUnitName);
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

    if (invoiceStatusMode === 'confirmed' && availInWh < existingBaseForProduct + reqBase && !settings.allowNegativeStock && !isRepInvoice) {
      setError(
        t(
          `الكمية المتاحة بالمستودع من (${selectedProduct.name}) هي ${availInWh} ${selectedProduct.baseUnit}، وهي غير كافية لإجمالي الكمية المطلوبة (${existingBaseForProduct + reqBase}).`,
          `Available warehouse stock for (${selectedProduct.name}) is ${availInWh} ${t(selectedProduct.baseUnit)}, which is insufficient for the total requested quantity (${existingBaseForProduct + reqBase}).`
        )
      );
      return;
    }

    const itemTotal = computeLineTotal(qtyVal, priceVal);

    setItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.productId === selectedProduct.id && it.unit === selectedUnitName);
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
          unit: selectedUnitName,
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
    setInputQuantity('');
    setInputUnitPrice('');
    setError(null);
    window.setTimeout(() => {
      productSearchRef.current?.focus();
    }, 30);
  };

  const handleUpdateRowPrice = (idx: number, newPrice: number) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              ...it,
              unitPrice: Math.max(0, newPrice),
              total: computeLineTotal(it.quantity, Math.max(0, newPrice), it.discount || 0),
            }
          : it
      )
    );
  };

  const handleUpdateRowQty = (idx: number, newQty: number) => {
    const qty = Math.max(0.001, newQty);
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? { ...it, quantity: qty, total: computeLineTotal(qty, it.unitPrice, it.discount || 0) }
          : it
      )
    );
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const subtotal = useMemo(() => {
    return items.reduce((acc, it) => acc + it.total, 0);
  }, [items]);

  const grandTotal = useMemo(() => {
    return Math.max(0, subtotal - Number(discountTotal || 0));
  }, [subtotal, discountTotal]);

  const appliedAdvance = useMemo(() => {
    if (!sourceOrder) return 0;
    return Math.min(grandTotal, Math.max(0, Number(sourceOrder.advancePaidAmount || 0)));
  }, [sourceOrder, grandTotal]);

  const maxCashAtInvoice = useMemo(() => {
    return Math.max(0, grandTotal - appliedAdvance);
  }, [grandTotal, appliedAdvance]);

  const effectivePaidAtInvoice = useMemo(() => {
    if (paymentType === 'cash') return maxCashAtInvoice;
    if (paymentType === 'credit') return 0;
    return Math.min(maxCashAtInvoice, Math.max(0, Number(paidAmount) || 0));
  }, [paymentType, maxCashAtInvoice, paidAmount]);

  const remainingAmount = useMemo(() => {
    return Math.max(0, grandTotal - appliedAdvance - effectivePaidAtInvoice);
  }, [grandTotal, appliedAdvance, effectivePaidAtInvoice]);

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
      setPaidAmount(maxCashAtInvoice);
    } else if (paymentType === 'credit') {
      setPaidAmount(0);
    }
  }, [paymentType, maxCashAtInvoice]);

  const handleSubmitInvoice = useCallback(async (shouldPrint = false) => {
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
      const names = shortageItems.map((s) => `${s.productName} (${t('متاح', 'avail.')} ${s.availableInVanQty})`).join('، ');
      setError(
        t(
          `لا يمكن اعتماد الفاتورة لعدم كفاية الرصيد في (${wh?.name || 'المستودع المحدد'}): ${names}. يمكنك الحفظ كمسودة أو تنفيذ تحويل مخزني أولاً.`,
          `Cannot confirm invoice due to insufficient stock in (${wh?.name ? t(wh.name) : t('المستودع المحدد', 'Selected Warehouse')}): ${names}. You can save as draft or make a stock transfer first.`
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
            notes: t('طلب تحويل عهدة آلي مرتبط بالفاتورة', 'Auto-generated custody transfer request linked to invoice'),
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
        subtotal,
        discountTotal: Number(discountTotal || 0),
        taxTotal: 0,
        grandTotal,
        paidAmount: totalPaidOnInvoice,
        appliedAdvanceAmount: appliedAdvance,
        paidAtInvoice: effectivePaidAtInvoice,
        remainingAmount: Math.max(0, grandTotal - totalPaidOnInvoice),
        paymentType,
        paymentMethod: 'cash' as const,
        cashboxId: selectedCashboxId,
        status: invoiceStatusMode,
        notes,
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
        setError(res.error ? t(res.error) : t('حدث خطأ أثناء حفظ الفاتورة', 'An error occurred while saving the invoice'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting, items, warehouses, selectedWarehouseId, representatives, selectedRepId, currentUser,
    settings.allowNegativeStock, invoiceStatusMode, shortageItems, createRepItemTransfer, invoiceDate,
    selectedCustomerId, selectedCustomer, sourceOrder, subtotal, discountTotal, grandTotal, appliedAdvance,
    effectivePaidAtInvoice, paymentType, selectedCashboxId, notes, convertOrderToInvoice, createSalesInvoice,
    onInvoiceCreated, onClose, t
  ]);

  const submitRef = useRef(handleSubmitInvoice);
  submitRef.current = handleSubmitInvoice;

  useEffect(() => {
    if (!isOpen) return;
    const u1 = registerHandler('action:save_invoice', () => {
      submitRef.current(false);
    });
    const u2 = registerHandler('action:focus_product_search', () => {
      productSearchRef.current?.focus();
    });
    return () => {
      u1();
      u2();
    };
  }, [isOpen, registerHandler]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        sourceOrder
          ? t(`تحويل طلب العميل (${sourceOrder.requestNumber}) إلى فاتورة بيع`, `Convert Customer Order (${sourceOrder.requestNumber}) to Sales Invoice`)
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
      maxWidth="6xl"
    >
      <div className="space-y-2">
        {error && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-xs font-bold text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Top Controls: Customer, Warehouse, Rep, Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200 text-xs">
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
              searchPlaceholder={t('ابحث باسم العميل أو المحل أو الهاتف...', 'Search by customer, shop, or phone...')}
              allowClear={!sourceOrder}
              minPanelWidth={270}
              buttonClassName="rounded-md"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('المستودع المصروف منه:', 'Issue From Warehouse:')}</label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-semibold focus:border-blue-600 outline-hidden"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{t(w.name)}</option>
              ))}
            </select>
          </div>

          <div>
            <SearchableFilterSelect
              id="sale-modal-rep"
              label={t('المندوب المسؤول', 'Responsible Rep')}
              value={selectedRepId}
              onChange={setSelectedRepId}
              options={representatives.map((r) => ({
                value: r.id,
                label: r.name,
                subtitle: r.phone || undefined,
                searchText: `${r.name} ${r.phone || ''}`,
              }))}
              allOptionLabel={t('-- بيع مباشر من المركز --', '-- Direct Center Sale --')}
              allOptionValue=""
              searchPlaceholder={t('ابحث باسم المندوب...', 'Search by rep name...')}
              allowClear
              buttonClassName="rounded-md"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('تاريخ الفاتورة:', 'Invoice Date:')}</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-mono font-semibold focus:border-blue-600 outline-hidden"
            />
          </div>
        </div>

        {/* Product Picker & Barcode & Customer Price History Box */}
        <div className="bg-[#EEF3FA] border border-[#DCE6F5] rounded-lg p-2 space-y-1.5">
          <div className="flex flex-col sm:flex-row items-center gap-1.5">
            <form onSubmit={handleBarcodeSubmit} className="w-full sm:w-56">
              <div className="relative">
                <input
                  type="text"
                  placeholder={t('امسح الباركود أو الكود...', 'Scan barcode or code...')}
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  className="w-full h-8 bg-white border border-[#B8CAE8] rounded-md py-1 ps-7 pe-2 text-xs font-mono focus:border-[#003589] outline-hidden"
                />
                <Barcode className="w-3.5 h-3.5 text-[#003589] absolute start-2 top-2" />
              </div>
            </form>

            <div className="flex-1 w-full">
              <ProductSearchSelect
                products={products}
                selectedProductId={selectedProductId}
                warehouseId={selectedWarehouseId}
                warehouses={warehouses}
                priceMode="selling"
                currency={settings.currency}
                inputRef={productSearchRef}
                placeholder={t('ابحث باسم السلعة أو الكود أو الباركود...', 'Search by item name, code, or barcode...')}
                onSelect={(prod) => handleProductSelect(prod.id)}
                onAfterSelect={() => {
                  qtyInputRef.current?.focus();
                  qtyInputRef.current?.select();
                }}
              />
            </div>
          </div>

          {selectedProduct && selectedCustomer && (
            <div className="bg-white dark:bg-[#132544] rounded-md p-2 border border-blue-200 dark:border-[#2A436E] text-xs flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-blue-700 dark:text-[#85B8FF] shrink-0" />
                <span className="font-bold text-slate-800 dark:text-[#F3F7FC]">
                  {t(
                    `آخر 3 أسعار بيع فعلية لهذا العميل (${selectedCustomer.name}) للصنف (${selectedProduct.name}) — من الأقدم للأحدث:`,
                    `Last 3 actual selling prices for (${selectedCustomer.name}) on (${selectedProduct.name}) — oldest to newest:`
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {lastThreePrices.length > 0 ? (
                  lastThreePrices.map((entry, idx) => {
                    const priceVal = typeof entry === 'number' ? entry : Number(entry.price || 0);
                    const priceDate = typeof entry === 'number' ? '' : (entry.date || '');
                    const entryUnit = typeof entry === 'number' ? '' : (entry.unit || '');
                    const entryQty = typeof entry === 'number' ? undefined : entry.quantity;
                    const entryFactor = typeof entry === 'number' ? 1 : Number(entry.unitFactor || 1);
                    const orderTag = idx === 0 ? t('الأقدم', 'Oldest') : idx === lastThreePrices.length - 1 ? t('الأحدث', 'Newest') : t('الوسيط', 'Middle');
                    const activeUnitFactor =
                      selectedUnitName === selectedProduct.baseUnit
                        ? 1
                        : selectedProduct.units.find((u) => u.name === selectedUnitName)?.conversionFactor || 1;
                    const normalizedPerSelectedUnit =
                      entryUnit && entryUnit !== selectedUnitName && entryFactor > 0
                        ? Math.round((priceVal / entryFactor) * activeUnitFactor * 100) / 100
                        : null;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setInputUnitPrice(normalizedPerSelectedUnit ?? priceVal)}
                        title={t('انقر لتطبيق هذا السعر يدوياً (مع ضبط الوحدة الحالية عند الحاجة)', 'Click to apply this price (adjusting for current unit if needed)')}
                        className="px-2 py-1 rounded-md bg-blue-50 dark:bg-[#16366B] hover:bg-blue-100 dark:hover:bg-[#1B4282] text-blue-900 dark:text-[#EEF4FC] border border-blue-300 dark:border-[#3B82F6]/40 text-start transition-colors cursor-pointer"
                      >
                        <span className="font-mono font-bold text-xs block">
                          {priceVal} {t(settings.currency)}
                          {entryUnit ? ` / ${t(entryUnit)}` : ''}
                        </span>
                        <span className="text-[10px] text-slate-600 dark:text-[#A9BCD9] block">
                          {orderTag}
                          {priceDate ? ` · ${priceDate}` : ''}
                          {typeof entryQty === 'number' && entryQty > 0 ? ` · ${t('كمية:', 'Qty:')} ${entryQty}` : ''}
                          {normalizedPerSelectedUnit !== null ? ` · ${t('يعادل', 'eq.')} ${normalizedPerSelectedUnit} / ${t(selectedUnitName)}` : ''}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <span className="text-slate-500 dark:text-[#97AECE] italic text-[11px]">
                    {t('لا توجد أسعار بيع سابقة لهذا الصنف مع هذا العميل', 'No previous selling prices recorded for this item & customer')}
                  </span>
                )}
              </div>
            </div>
          )}

          {selectedProduct && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1.5 border-t border-blue-100 dark:border-[#21375C] text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('وحدة البيع:', 'Sale Unit:')}</label>
                <select
                  value={selectedUnitName}
                  onChange={(e) => handleUnitChange(e.target.value)}
                  className="w-full h-8 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] text-slate-800 dark:text-[#EEF4FC] rounded-md px-2 py-1 text-xs font-bold outline-hidden"
                >
                  {selectedProduct.units.map((u) => (
                    <option key={u.id} value={u.name}>
                      {t(u.name)} ({t('تحتوي', 'contains')} {u.conversionFactor} {t(selectedProduct.baseUnit)})
                    </option>
                  ))}
                  <option value={selectedProduct.baseUnit}>
                    {t(selectedProduct.baseUnit)} ({t('فردي أساسي', 'Base unit')})
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('الكمية:', 'Quantity:')}</label>
                <QuantityInput
                  inputRef={qtyInputRef}
                  allowDecimals
                  min={0.001}
                  value={inputQuantity}
                  onChange={setInputQuantity}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddItem();
                    }
                  }}
                  ariaLabel={t('الكمية', 'Quantity')}
                  inputClassName="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-bold text-center font-mono outline-hidden focus:border-blue-700"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('سعر الوحدة:', 'Unit Price:')}</label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="0.00"
                  value={inputUnitPrice}
                  onChange={(e) => setInputUnitPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddItem();
                    }
                  }}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-black text-center text-blue-900 font-mono outline-hidden focus:border-blue-700"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="w-full h-8 flex items-center justify-center gap-1.5 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold transition-all active:scale-95 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('إضافة للصنف بالفاتورة', 'Add Item to Invoice')}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Invoice Items Table */}
        <div className="border border-slate-200 rounded-lg overflow-hidden awlad-table-scroll">
          <table className="w-full text-start text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="px-2 py-1.5 w-8 text-center">#</th>
                <th className="px-2 py-1.5">{t('اسم الصنف', 'Item Name')}</th>
                <th className="px-2 py-1.5 text-center">{t('الوحدة', 'Unit')}</th>
                <th className="px-2 py-1.5 text-center w-24">{t('الكمية', 'Qty')}</th>
                <th className="px-2 py-1.5 text-center w-24">{t('سعر الوحدة', 'Unit Price')}</th>
                <th className="px-2 py-1.5 text-center">{t('الإجمالي', 'Total')}</th>
                <th className="px-2 py-1.5 text-center w-10">{t('حذف', 'Delete')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-3 text-center text-slate-400">
                    {t('لم يتم إضافة أصناف إلى الفاتورة بعد. استخدم البحث أو قارئ الباركود أعلاه لإضافة سلع.', 'No items added to the invoice yet. Use search or barcode scanner above.')}
                  </td>
                </tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-2 py-1 text-center font-bold text-slate-400">{idx + 1}</td>
                    <td className="px-2 py-1 font-bold text-slate-800">{it.productName}</td>
                    <td className="px-2 py-1 text-center text-slate-600">{t(it.unit)}</td>
                    <td className="px-2 py-1 text-center">
                      <QuantityInput
                        allowDecimals
                        min={0.001}
                        value={it.quantity}
                        onChange={(q) => handleUpdateRowQty(idx, q)}
                        ariaLabel={`${t('كمية', 'Quantity')} ${it.productName}`}
                        inputClassName="w-20 border border-slate-300 rounded-md px-1.5 py-0.5 text-center font-bold font-mono outline-hidden focus:border-blue-700"
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={it.unitPrice}
                        onChange={(e) => handleUpdateRowPrice(idx, Number(e.target.value))}
                        className="w-22 border border-slate-300 rounded-md px-1.5 py-0.5 text-center font-bold font-mono text-blue-900"
                      />
                    </td>
                    <td className="px-2 py-1 text-center font-black font-mono text-blue-950 text-xs tabular-nums">
                      {it.total.toFixed(2)} {t(settings.currency)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="text-red-500 hover:text-red-700 p-1 rounded-md hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {shortageItems.length > 0 && invoiceStatusMode === 'confirmed' && (
          <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-black text-amber-900">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>{t(`تنبيه المخزون: عجز في (${shortageItems.length}) أصناف`, `Inventory Alert: Shortage in (${shortageItems.length}) items`)}</span>
            </div>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {shortageItems.map((sh, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-amber-300 rounded text-[10px] font-bold text-amber-900">
                  <span>{sh.productName}:</span>
                  <span className="text-red-600 font-mono">{t('عجز', 'Shortage')} {sh.shortageQty} {t(sh.unit)}</span>
                  <span className="text-slate-400 font-mono">({t('المتاح:', 'Avail:')} {sh.availableInVanQty})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Invoice Summary, Status Mode, and Payment Config */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200 text-xs">
          <div className="space-y-1.5">
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('وضع حفظ الفاتورة:', 'Invoice Save Mode:')}</label>
              <div className="grid grid-cols-2 gap-1.5 font-bold">
                <button
                  type="button"
                  onClick={() => setInvoiceStatusMode('confirmed')}
                  className={`py-1 px-2 rounded-md border text-center transition-all cursor-pointer ${
                    invoiceStatusMode === 'confirmed'
                      ? 'bg-[#011E58] text-white border-[#011E58]'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  {t('اعتماد وإصدار (خصم المخزون)', 'Confirm & Issue (Deduct Stock)')}
                </button>
                <button
                  type="button"
                  onClick={() => setInvoiceStatusMode('draft')}
                  className={`py-1 px-2 rounded-md border text-center transition-all cursor-pointer ${
                    invoiceStatusMode === 'draft'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  {t('حفظ كمسودة (بدون خصم مخزون)', 'Save as Draft (No Stock Deduction)')}
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('نوع السداد:', 'Payment Type:')}</label>
              <div className="grid grid-cols-3 gap-1.5 font-bold">
                <button
                  type="button"
                  onClick={() => setPaymentType('cash')}
                  className={`py-1 px-2 rounded-md border text-center transition-all cursor-pointer ${
                    paymentType === 'cash' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  {t('نقدي كامل', 'Full Cash')}
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('credit')}
                  className={`py-1 px-2 rounded-md border text-center transition-all cursor-pointer ${
                    paymentType === 'credit' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  {t('آجل بالكامل', 'Full Credit')}
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('partial')}
                  className={`py-1 px-2 rounded-md border text-center transition-all cursor-pointer ${
                    paymentType === 'partial' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  {t('دفعة نقدية + آجل', 'Cash + Credit')}
                </button>
              </div>
            </div>

            {paymentType !== 'credit' && (
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('الخزينة المودع بها المبلغ:', 'Deposit Cashbox:')}</label>
                <select
                  value={selectedCashboxId}
                  onChange={(e) => setSelectedCashboxId(e.target.value)}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-semibold focus:border-blue-600 outline-hidden"
                >
                  {cashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.name} ({t('رصيدها الحالي:', 'Current balance:')} {formatLocaleNumber(cb.currentBalance ?? 0)} {t(settings.currency)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات الفاتورة:', 'Invoice Notes:')}</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('أدخل أي ملاحظات خاصة بالتسليم أو الدفع...', 'Enter any delivery or payment notes...')}
                className="w-full bg-white border border-slate-300 rounded-md px-2 py-1 text-xs outline-hidden focus:border-blue-600"
              />
            </div>
          </div>

          <div className="space-y-1.5 bg-white p-2 rounded-lg border border-slate-200">
            <div className="flex justify-between text-slate-600 font-bold">
              <span>{t('المجموع الفرعي:', 'Subtotal:')}</span>
              <span className="font-mono text-xs tabular-nums">{subtotal.toFixed(2)} {t(settings.currency)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-600 font-bold">{t('خصم إضافي:', 'Additional Discount:')}</span>
              <div className="w-28">
                <input
                  type="number"
                  min="0"
                  placeholder="0.00"
                  value={discountTotal}
                  onChange={(e) => setDiscountTotal(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full h-7 bg-slate-50 border border-slate-300 rounded-md px-2 py-0.5 text-center font-mono font-bold text-red-600 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-between text-sm font-black text-blue-950 pt-1 border-t border-slate-200">
              <span>{t('صافي الفاتورة الإجمالي:', 'Net Invoice Total:')}</span>
              <span className="font-mono tabular-nums">{grandTotal.toFixed(2)} {t(settings.currency)}</span>
            </div>

            {appliedAdvance > 0 && (
              <div className="p-1.5 rounded-md bg-emerald-50 border border-emerald-200 space-y-0.5 text-xs">
                <div className="flex justify-between font-black text-emerald-900">
                  <span>{t('الدفعة المقدمة المدفوعة مسبقاً على الطلب:', 'Advance Payment Already Paid on Order:')}</span>
                  <span className="font-mono">- {appliedAdvance.toFixed(2)} {t(settings.currency)}</span>
                </div>
                <p className="text-[11px] text-emerald-800">
                  {t(
                    'لا تضاف للخزينة مرة أخرى عند التحويل — تودَع بالخزينة فقط أي قيمة محصلة نقداً الآن.',
                    'Will not be deposited to cashbox again upon conversion — only cash collected now is deposited.'
                  )}
                </p>
              </div>
            )}

            {paymentType === 'partial' && (
              <div className="flex items-center justify-between pt-0.5">
                <span className="font-bold text-emerald-700">
                  {appliedAdvance > 0 ? t('المحصل نقداً عند الفوترة:', 'Cash Collected at Invoicing:') : t('المدفوع نقداً:', 'Paid in Cash:')}
                </span>
                <div className="w-28">
                  <input
                    type="number"
                    min="0"
                    max={maxCashAtInvoice}
                    placeholder="0.00"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value === '' ? '' : Math.min(maxCashAtInvoice, Math.max(0, Number(e.target.value))))}
                    className="w-full h-7 bg-emerald-50 border border-emerald-300 rounded-md px-2 py-0.5 text-center font-mono font-bold text-emerald-800 text-xs"
                  />
                </div>
              </div>
            )}

            {paymentType === 'cash' && appliedAdvance > 0 && (
              <div className="flex justify-between text-xs font-bold text-emerald-700 pt-0.5">
                <span>{t('المحصل نقداً بالخزينة عند الفوترة:', 'Cash Collected to Cashbox at Invoicing:')}</span>
                <span className="font-mono tabular-nums">{effectivePaidAtInvoice.toFixed(2)} {t(settings.currency)}</span>
              </div>
            )}

            <div className="flex justify-between text-xs font-bold text-red-600 pt-0.5">
              <span>{t('المتبقي في ذمة العميل (آجل):', 'Remaining Customer Balance (Credit):')}</span>
              <span className="font-mono tabular-nums">{remainingAmount.toFixed(2)} {t(settings.currency)}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
          >
            {t('إلغاء', 'Cancel')}
          </button>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={isSubmitting || items.length === 0}
              onClick={() => handleSubmitInvoice(false)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-white text-xs font-black transition-all active:scale-95 disabled:opacity-50 cursor-pointer ${
                invoiceStatusMode === 'draft'
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-[#011E58] hover:bg-[#002160]'
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? t('جاري التنفيذ...', 'Processing...')
                  : invoiceStatusMode === 'draft'
                  ? t('حفظ الفاتورة كمسودة', 'Save Invoice as Draft')
                  : t('حفظ الفاتورة فقط', 'Save Invoice Only')}
              </span>
            </button>

            <button
              type="button"
              disabled={isSubmitting || items.length === 0}
              onClick={() => handleSubmitInvoice(true)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{invoiceStatusMode === 'draft' ? t('حفظ كمسودة وطباعة', 'Save Draft & Print') : t('حفظ وطباعة الفاتورة', 'Save & Print Invoice')}</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

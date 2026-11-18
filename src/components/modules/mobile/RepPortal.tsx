import React, { useMemo, useState, useEffect } from 'react';
import {
  FilePlus2, Truck, Search, Plus, Minus,
  Trash2, CheckCircle2, AlertCircle, AlertTriangle, Phone, MapPin,
  History, ShieldAlert, RefreshCw, Share2, FileDown, Boxes
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { CustomerItemOrderRequest, CustomerItemOrderStatus, CustomerPriceHistoryEntry, Invoice } from '../../../types';
import { exportHtmlToPdf } from '../../common/PdfExporter';
import { isNativeCapacitor } from '../../../services/native';

export type RepTabKey = 'home' | 'customers' | 'new-invoice' | 'invoices' | 'custody';

interface RepPortalProps {
  activeTab: RepTabKey;
  onTabChange: (tab: RepTabKey) => void;
}

export const RepPortal: React.FC<RepPortalProps> = ({ activeTab, onTabChange }) => {
  const { currentUser, representativeProfile, mobileConfig } = useAuth();
  const data = useData();
  const isNative = isNativeCapacitor();

  const rep =
    representativeProfile ||
    data.representatives.find(
      (r) =>
        (r.userId && r.userId === currentUser?.id) ||
        r.name === currentUser?.fullName
    ) ||
    null;

  const vanWarehouse = useMemo(() => {
    if (!rep) return data.warehouses[0] || null;
    return (
      data.warehouses.find((w) => w.name.includes(rep.name) || w.managerName === rep.name) ||
      data.warehouses.find((w) => !w.isDefault) ||
      data.warehouses[0] ||
      null
    );
  }, [data.warehouses, rep]);

  const mainWarehouse = useMemo(() => {
    return data.warehouses.find((w) => w.isDefault) || data.warehouses[0] || null;
  }, [data.warehouses]);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

  // Customers search
  const [customerSearch, setCustomerSearch] = useState('');

  // New Invoice state
  const [invCustomerId, setInvCustomerId] = useState<string>('');
  const [invWarehouseId, setInvWarehouseId] = useState<string>('');
  const [invProductId, setInvProductId] = useState<string>('');
  const [invUnitName, setInvUnitName] = useState<string>('');
  const [invQty, setInvQty] = useState<number>(1);
  const [invPrice, setInvPrice] = useState<number>(0);
  const [invPaymentType, setInvPaymentType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [invPaidAmount, setInvPaidAmount] = useState<number>(0);
  const [invCashboxId, setInvCashboxId] = useState<string>(data.cashboxes[0]?.id || 'CASH-01');
  const [invNotes, setInvNotes] = useState<string>('');
  const [invItems, setInvItems] = useState<Array<{
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
  const [priceHistoryMap, setPriceHistoryMap] = useState<Record<string, CustomerPriceHistoryEntry[]>>({});
  const [isSubmittingInvoice, setIsSubmittingInvoice] = useState(false);

  // Custody sub-tab & transfer forms
  const [custodySubTab, setCustodySubTab] = useState<'van' | 'items' | 'cash'>('van');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [reqProdId, setReqProdId] = useState('');
  const [reqQty, setReqQty] = useState(5);
  const [reqItems, setReqItems] = useState<Array<{
    productId: string;
    productName: string;
    unit: string;
    requestedQty: number;
    availableInVanQty: number;
    shortageQty: number;
  }>>([]);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [cashNotes, setCashNotes] = useState<string>('');
  const [isSendingTransfer, setIsSendingTransfer] = useState(false);

  // Rep delivery orders & rep customer order request modal/panel
  const [customersSubView, setCustomersSubView] = useState<'list' | 'orders'>('list');
  const [repOrderCustomerId, setRepOrderCustomerId] = useState<string>('');
  const [repOrderProdId, setRepOrderProdId] = useState<string>('');
  const [repOrderUnit, setRepOrderUnit] = useState<string>('');
  const [repOrderQty, setRepOrderQty] = useState<number>(1);
  const [repOrderNotes, setRepOrderNotes] = useState<string>('');
  const [repOrderItems, setRepOrderItems] = useState<Array<{
    productId: string;
    productCode: string;
    productName: string;
    unit: string;
    unitFactor: number;
    quantity: number;
    unitPrice: number;
  }>>([]);
  const [isSubmittingRepOrder, setIsSubmittingRepOrder] = useState(false);
  const [deliveryReviewId, setDeliveryReviewId] = useState<string | null>(null);
  const [deliveryReviewNote, setDeliveryReviewNote] = useState<string>('');
  const [busyDeliveryOrderId, setBusyDeliveryOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!invWarehouseId && vanWarehouse?.id) {
      setInvWarehouseId(vanWarehouse.id);
    }
    if (!invCashboxId && data.cashboxes[0]?.id) {
      setInvCashboxId(data.cashboxes[0].id);
    }
  }, [vanWarehouse?.id, invWarehouseId, data.cashboxes, invCashboxId]);

  useEffect(() => {
    let active = true;
    if (!invCustomerId) {
      setPriceHistoryMap({});
      return;
    }
    data.getCustomerPriceHistory(invCustomerId).then((res) => {
      if (active) setPriceHistoryMap(res);
    });
    return () => {
      active = false;
    };
  }, [invCustomerId, data.getCustomerPriceHistory]);

  const activeProducts = useMemo(
    () => data.products.filter((p) => p.status === 'active'),
    [data.products]
  );

  const selectedProduct = useMemo(
    () => activeProducts.find((p) => p.id === invProductId) || null,
    [activeProducts, invProductId]
  );

  const selectedProdLastPrices = useMemo(() => {
    if (!invProductId) return [];
    const list = priceHistoryMap[invProductId] || [];
    return list.slice(-3);
  }, [priceHistoryMap, invProductId]);

  const handleSelectProduct = (prodId: string) => {
    setInvProductId(prodId);
    const prod = activeProducts.find((p) => p.id === prodId);
    if (!prod) return;
    if (prod.units && prod.units.length > 0) {
      setInvUnitName(prod.units[0].name);
      setInvPrice(prod.units[0].sellingPrice);
    } else {
      setInvUnitName(prod.baseUnit);
      setInvPrice(prod.sellingPrice);
    }
    setInvQty(1);
  };

  const handleUnitChange = (unitName: string) => {
    setInvUnitName(unitName);
    if (!selectedProduct) return;
    if (unitName === selectedProduct.baseUnit) {
      setInvPrice(selectedProduct.sellingPrice);
    } else {
      const u = selectedProduct.units.find((x) => x.name === unitName);
      if (u) setInvPrice(u.sellingPrice);
    }
  };

  const handleAddInvoiceItem = () => {
    if (!selectedProduct || invQty <= 0) return;
    let unitFactor = 1;
    let purchasePriceAtTime = selectedProduct.purchasePrice;
    if (invUnitName !== selectedProduct.baseUnit) {
      const u = selectedProduct.units.find((x) => x.name === invUnitName);
      if (u) {
        unitFactor = u.conversionFactor;
        purchasePriceAtTime = u.purchasePrice || selectedProduct.purchasePrice * unitFactor;
      }
    }
    const total = invQty * invPrice;
    setInvItems((prev) => [
      ...prev,
      {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        barcode: selectedProduct.barcode,
        unit: invUnitName || selectedProduct.baseUnit,
        unitFactor,
        quantity: invQty,
        unitPrice: invPrice,
        purchasePriceAtTime,
        discount: 0,
        total,
      },
    ]);
    setInvProductId('');
    setInvQty(1);
    setInvPrice(0);
  };

  const invGrandTotal = useMemo(
    () => invItems.reduce((sum, it) => sum + it.total, 0),
    [invItems]
  );

  const effectiveVanId = invWarehouseId || vanWarehouse?.id || '';

  const shortageItems = useMemo(() => {
    const out: Array<{
      productId: string;
      productName: string;
      unit: string;
      requestedQty: number;
      availableInVanQty: number;
      shortageQty: number;
    }> = [];
    for (const it of invItems) {
      const prod = activeProducts.find((p) => p.id === it.productId);
      if (!prod) continue;
      const avail = prod.stockPerWarehouse?.[effectiveVanId] || 0;
      const reqBase = it.quantity * (it.unitFactor || 1);
      if (avail < reqBase) {
        out.push({
          productId: it.productId,
          productName: it.productName,
          unit: prod.baseUnit,
          requestedQty: reqBase,
          availableInVanQty: avail,
          shortageQty: reqBase - avail,
        });
      }
    }
    return out;
  }, [invItems, activeProducts, effectiveVanId]);

  const handleCreateInvoice = async (mode: 'confirmed' | 'draft_with_transfer' | 'draft') => {
    if (!invCustomerId) {
      setFeedback({ type: 'error', text: 'يرجى اختيار العميل أولاً.' });
      return;
    }
    if (!invItems.length) {
      setFeedback({ type: 'error', text: 'يرجى إضافة صنف واحد على الأقل للفاتورة.' });
      return;
    }
    if (!rep) {
      setFeedback({ type: 'error', text: 'حسابك غير مرتبط بملف مندوب نشط.' });
      return;
    }

    const cust = data.customers.find((c) => c.id === invCustomerId);
    const wh = data.warehouses.find((w) => w.id === effectiveVanId) || vanWarehouse;
    const paid =
      invPaymentType === 'cash'
        ? invGrandTotal
        : invPaymentType === 'credit'
        ? 0
        : Math.min(invGrandTotal, Math.max(0, invPaidAmount));

    const forceDraft = shortageItems.length > 0 || mode !== 'confirmed';

    setIsSubmittingInvoice(true);
    setFeedback(null);
    const res = await data.createSalesInvoice({
      date: new Date().toISOString().split('T')[0],
      customerId: invCustomerId,
      customerName: cust?.name || 'عميل',
      representativeId: rep.id,
      representativeName: rep.name,
      warehouseId: effectiveVanId,
      warehouseName: wh?.name || `سيارة المندوب (${rep.name})`,
      items: invItems,
      subtotal: invGrandTotal,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: invGrandTotal,
      paidAmount: paid,
      remainingAmount: Math.max(0, invGrandTotal - paid),
      paymentType: invPaymentType,
      paymentMethod: 'cash',
      cashboxId: invCashboxId,
      status: forceDraft ? 'draft' : 'confirmed',
      notes: invNotes.trim() || undefined,
    });

    if (!res.success || !res.invoice) {
      setIsSubmittingInvoice(false);
      setFeedback({ type: 'error', text: res.error || 'تعذر حفظ الفاتورة' });
      return;
    }

    if (mode === 'draft_with_transfer' && shortageItems.length > 0 && mainWarehouse) {
      const trRes = await data.createRepItemTransfer({
        date: new Date().toISOString().split('T')[0],
        representativeId: rep.id,
        representativeName: rep.name,
        invoiceId: res.invoice.id,
        invoiceNumber: res.invoice.invoiceNumber,
        sourceWarehouseId: mainWarehouse.id,
        sourceWarehouseName: mainWarehouse.name,
        targetWarehouseId: effectiveVanId,
        targetWarehouseName: wh?.name || `سيارة المندوب (${rep.name})`,
        items: shortageItems.map((sh) => ({
          productId: sh.productId,
          productName: sh.productName,
          unit: sh.unit,
          requestedQty: sh.shortageQty,
          availableInVanQty: sh.availableInVanQty,
          shortageQty: sh.shortageQty,
        })),
        notes: `طلب تحويل عجز آلي مرتبط بمسودة فاتورة ${res.invoice.invoiceNumber}`,
      });
      setIsSubmittingInvoice(false);
      setInvItems([]);
      setInvNotes('');
      if (trRes.success) {
        setFeedback({
          type: 'success',
          text: `تم حفظ الفاتورة كمسودة (${res.invoice.invoiceNumber}) وإرسال طلب التحويل رقم ${trRes.request?.requestNumber || ''} للإدارة.`,
        });
      } else {
        setFeedback({
          type: 'warning',
          text: `تم حفظ الفاتورة كمسودة (${res.invoice.invoiceNumber}) لكن تعذر إرسال طلب التحويل: ${trRes.error}`,
        });
      }
      onTabChange('invoices');
      return;
    }

    setIsSubmittingInvoice(false);
    setInvItems([]);
    setInvNotes('');
    setFeedback({
      type: 'success',
      text: forceDraft
        ? `تم حفظ الفاتورة كمسودة (${res.invoice.invoiceNumber}).`
        : `تم اعتماد وإصدار الفاتورة (${res.invoice.invoiceNumber}) بنجاح.`,
    });
    onTabChange('invoices');
  };

  const myItemTransfers = useMemo(() => {
    return (data.repItemTransfers || [])
      .filter((t) => !rep || t.representativeId === rep.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.repItemTransfers, rep]);

  const myCashTransfers = useMemo(() => {
    return (data.repTransfers || [])
      .filter((t) => !rep || t.senderId === rep.id || t.receiverId === rep.id)
      .sort((a, b) => (b.timestamp || b.sentAt || '').localeCompare(a.timestamp || a.sentAt || ''));
  }, [data.repTransfers, rep]);

  const myInvoices = useMemo(() => {
    return (data.invoices || [])
      .filter((i) => i.type === 'sales')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.invoices]);

  const draftsReadyToConfirm = useMemo(() => {
    return myInvoices.filter((inv) => {
      if (inv.status !== 'draft') return false;
      if (inv.linkedRepTransferId) {
        const tr = myItemTransfers.find((t) => t.id === inv.linkedRepTransferId);
        return tr?.status === 'executed' || tr?.status === 'received';
      }
      return true;
    });
  }, [myInvoices, myItemTransfers]);

  const myAssignedDeliveries = useMemo(() => {
    return (data.customerItemOrders || [])
      .filter((o) =>
        rep && (o.assignedDeliveryRepId === rep.id || o.representativeId === rep.id)
      )
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.customerItemOrders, rep]);

  const activeDeliveryOrders = useMemo(
    () =>
      myAssignedDeliveries.filter((o) =>
        ['rep_assigned', 'out_for_delivery', 'needs_review'].includes(o.status)
      ),
    [myAssignedDeliveries]
  );

  const getDeliveryStatusLabel = (status: CustomerItemOrderStatus) => {
    switch (status) {
      case 'pending': return 'جديد';
      case 'under_review': return 'قيد المراجعة';
      case 'approved': return 'مقبول';
      case 'rep_assigned': return 'مسند لك للتوصيل';
      case 'out_for_delivery': return 'جاري التوصيل';
      case 'delivered': return 'تم التسليم';
      case 'needs_review': return 'يحتاج مراجعة';
      case 'invoiced': return 'مفوتر';
      case 'rejected': return 'مرفوض';
      default: return status;
    }
  };

  const handleDeliveryStatusChange = async (
    order: CustomerItemOrderRequest,
    status: 'out_for_delivery' | 'delivered' | 'needs_review',
    reason?: string
  ) => {
    setBusyDeliveryOrderId(order.id);
    setFeedback(null);
    try {
      const res = await data.updateOrderDeliveryStatus(order.id, status, reason);
      if (res.success) {
        setDeliveryReviewId(null);
        setDeliveryReviewNote('');
        setFeedback({
          type: res.queuedOffline ? 'warning' : 'success',
          text: res.queuedOffline
            ? `تم تسجيل حالة التوصيل (${getDeliveryStatusLabel(status)}) محلياً للمزامنة التلقائية.`
            : `تم تحديث حالة الطلب ${order.requestNumber} إلى (${getDeliveryStatusLabel(status)}).`,
        });
      } else {
        setFeedback({ type: 'error', text: res.error || 'تعذر تحديث حالة التوصيل' });
      }
    } finally {
      setBusyDeliveryOrderId(null);
    }
  };

  const handleSelectRepOrderProduct = (prodId: string) => {
    setRepOrderProdId(prodId);
    const prod = activeProducts.find((p) => p.id === prodId);
    if (!prod) return;
    setRepOrderUnit(prod.units?.[0]?.name || prod.baseUnit);
    setRepOrderQty(1);
  };

  const handleAddRepOrderItem = () => {
    const prod = activeProducts.find((p) => p.id === repOrderProdId);
    if (!prod || repOrderQty <= 0) return;
    const unitName = repOrderUnit || prod.baseUnit;
    const matched = prod.units?.find((u) => u.name === unitName);
    const unitFactor = matched ? Number(matched.conversionFactor || 1) : 1;
    const unitPrice = matched ? Number(matched.sellingPrice || 0) : Number(prod.sellingPrice || 0);
    setRepOrderItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        productCode: prod.code,
        productName: prod.name,
        unit: unitName,
        unitFactor,
        quantity: repOrderQty,
        unitPrice,
      },
    ]);
    setRepOrderProdId('');
    setRepOrderQty(1);
  };

  const handleSubmitRepOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repOrderCustomerId) {
      setFeedback({ type: 'error', text: 'يرجى اختيار العميل للطلب أولاً.' });
      return;
    }
    if (!repOrderItems.length) {
      setFeedback({ type: 'error', text: 'يرجى إضافة صنف واحد على الأقل للطلب.' });
      return;
    }
    const cust = data.customers.find((c) => c.id === repOrderCustomerId);
    if (!cust) {
      setFeedback({ type: 'error', text: 'العميل غير متاح ضمن نطاق حسابك.' });
      return;
    }
    setIsSubmittingRepOrder(true);
    setFeedback(null);
    try {
      const res = await data.createCustomerItemOrder({
        customerId: cust.id,
        customerName: cust.name,
        customerPhone: cust.phone,
        shopName: cust.shopName || cust.name,
        deliveryAddress: cust.address,
        geoCoordinates: cust.geoCoordinates,
        items: repOrderItems,
        notes: repOrderNotes.trim() || `طلب ميداني مرفوع بواسطة المندوب (${rep?.name || currentUser?.fullName || ''})`,
      });
      if (res.success || res.queuedOffline) {
        setRepOrderItems([]);
        setRepOrderNotes('');
        setFeedback({
          type: res.queuedOffline ? 'warning' : 'success',
          text: res.queuedOffline
            ? 'تم حفظ طلب العميل محلياً للمزامنة التلقائية فور عودة الاتصال.'
            : `تم إرسال طلب العميل (${res.order?.requestNumber || ''}) للإدارة بنجاح.`,
        });
      } else {
        setFeedback({ type: 'error', text: res.error || 'تعذر إرسال الطلب' });
      }
    } finally {
      setIsSubmittingRepOrder(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    return data.customers.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.shopName && c.shopName.toLowerCase().includes(q)) ||
        c.phone.includes(q) ||
        (c.area && c.area.toLowerCase().includes(q))
    );
  }, [data.customers, customerSearch]);

  const canConfirmDraft = (inv: Invoice): { ready: boolean; reason?: string } => {
    if (inv.linkedRepTransferId) {
      const tr = myItemTransfers.find((t) => t.id === inv.linkedRepTransferId);
      if (tr && tr.status !== 'executed' && tr.status !== 'received') {
        return {
          ready: false,
          reason:
            tr.status === 'rejected'
              ? 'تم رفض طلب تحويل الأصناف المرتبط من الإدارة'
              : 'بانتظار موافقة وصرف الإدارة لطلب التحويل المرتبط',
        };
      }
    }
    return { ready: true };
  };

  const handleConfirmDraft = async (inv: Invoice) => {
    setFeedback(null);
    const res = await data.confirmDraftInvoice(inv.id);
    if (res.success) {
      setFeedback({ type: 'success', text: `تم اعتماد الفاتورة ${inv.invoiceNumber} نهائياً وتحديث المخزون والحساب.` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر اعتماد المسودة' });
    }
  };

  const handleConfirmItemReceived = async (reqId: string, reqNum: string) => {
    setFeedback(null);
    const res = await data.updateRepItemTransferStatus(reqId, 'received');
    if (res.success) {
      setFeedback({ type: 'success', text: `تم تأكيد استلام أصناف التحويل ${reqNum} على سيارتك.` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر تأكيد الاستلام' });
    }
  };

  const handleSendDirectItemTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rep || !mainWarehouse || !effectiveVanId || reqItems.length === 0) return;
    setIsSendingTransfer(true);
    const wh = data.warehouses.find((w) => w.id === effectiveVanId);
    const res = await data.createRepItemTransfer({
      date: new Date().toISOString().split('T')[0],
      representativeId: rep.id,
      representativeName: rep.name,
      sourceWarehouseId: mainWarehouse.id,
      sourceWarehouseName: mainWarehouse.name,
      targetWarehouseId: effectiveVanId,
      targetWarehouseName: wh?.name || `سيارة المندوب (${rep.name})`,
      items: reqItems,
      notes: 'طلب تغذية عهدة سيارة من تطبيق المندوب',
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setReqItems([]);
      setFeedback({ type: 'success', text: `تم إرسال طلب التحويل ${res.request?.requestNumber || ''} للإدارة.` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر إرسال طلب التحويل' });
    }
  };

  const handleSendCashToOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rep || cashAmount <= 0) return;
    setIsSendingTransfer(true);
    const res = await data.createRepTransfer({
      direction: 'rep_to_owner',
      senderId: rep.id,
      senderName: rep.name,
      receiverId: 'OWNER',
      receiverName: 'الفرع الرئيسي (الخزينة)',
      amount: cashAmount,
      cashboxId: data.cashboxes[0]?.id || 'CASH-01',
      notes: cashNotes.trim() || 'توريد تحصيلات من تطبيق المندوب',
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setCashAmount(0);
      setCashNotes('');
      setFeedback({ type: 'success', text: `تم إرسال إشعار التوريد النقدي رقم ${res.transfer?.transferNumber || ''} بانتظار تأكيد الخزينة.` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر إرسال التحويل النقدي' });
    }
  };

  const handleConfirmOwnerCash = async (transferId: string) => {
    const res = await data.confirmRepTransferReceipt(transferId, 'تم الاستلام الفعلي عبر تطبيق المندوب');
    if (res.success) {
      setFeedback({ type: 'success', text: 'تم تأكيد استلام العهدة النقدية وتحديث رصيدك.' });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر تأكيد الاستلام' });
    }
  };

  const exportInvoiceDocument = (inv: Invoice) => {
    exportHtmlToPdf({
      title: inv.status === 'draft' ? 'مسودة فاتورة مبيعات' : 'فاتورة مبيعات',
      companyName: data.settings.companyName,
      companySubtitle: data.settings.companySubtitle,
      docNumber: inv.invoiceNumber,
      dateRangeText: inv.date,
      meta: [
        { label: 'العميل', value: inv.customerName || '-' },
        { label: 'المندوب', value: inv.representativeName || rep?.name || '-' },
        { label: 'المخزن', value: inv.warehouseName || '-' },
      ],
      tableHeaders: ['م', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الإجمالي'],
      tableRows: (inv.items || []).map((it, idx) => [
        idx + 1,
        it.productName,
        it.unit,
        it.quantity,
        it.unitPrice.toFixed(2),
        it.total.toFixed(2),
      ]),
      summaryPairs: [
        { label: 'الصافي الإجمالي', value: `${inv.grandTotal.toFixed(2)} ${data.settings.currency}`, highlight: true },
        { label: 'المدفوع', value: `${inv.paidAmount.toFixed(2)} ${data.settings.currency}` },
        { label: 'المتبقي', value: `${inv.remainingAmount.toFixed(2)} ${data.settings.currency}` },
      ],
      notes: inv.notes,
    });
  };

  if (mobileConfig.enableRepApp === false) {
    return (
      <div className="bg-white rounded-3xl border border-amber-200 p-8 text-center space-y-3 shadow-xs">
        <ShieldAlert className="w-12 h-12 text-amber-600 mx-auto" />
        <h3 className="text-base font-black text-slate-900">بوابة المناديب متوقفة مؤقتاً</h3>
        <p className="text-xs text-slate-600">
          تم تعطيل وصول تطبيق المناديب مؤقتاً من إعدادات الإدارة. يرجى مراجعة مسؤول النظام.
        </p>
        <button
          type="button"
          onClick={() => data.triggerManualSync()}
          className="min-h-[44px] px-5 rounded-xl bg-blue-900 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>إعادة المحاولة</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : feedback.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* TAB 1: HOME */}
      {activeTab === 'home' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">مرحباً، مندوب المبيعات</p>
                <h2 className="text-lg font-black text-slate-900">
                  {rep?.name || currentUser?.fullName}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {vanWarehouse?.name || 'سيارة المندوب'} {rep?.vehicleNumber ? `· ${rep.vehicleNumber}` : ''}
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-900 shrink-0">
                <Truck className="w-6 h-6" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">العهدة النقدية الحالية</span>
                <strong className="text-lg font-black font-mono tabular-nums text-emerald-700">
                  {(rep?.currentBalance || 0).toLocaleString()} {data.settings.currency}
                </strong>
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">العملاء المسموحون لك</span>
                <strong className="text-lg font-black font-mono tabular-nums text-blue-950">
                  {data.customers.length}
                </strong>
              </div>
            </div>

            {draftsReadyToConfirm.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-emerald-900">
                  لديك ({draftsReadyToConfirm.length}) مسودة فاتورة جاهزة للاعتماد النهائي الآن.
                </span>
                <button
                  type="button"
                  onClick={() => onTabChange('invoices')}
                  className="min-h-[40px] px-3.5 rounded-xl bg-emerald-700 text-white font-bold shrink-0 cursor-pointer"
                >
                  اعتماد الآن
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onTabChange('new-invoice')}
                className="min-h-[48px] rounded-2xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
              >
                <FilePlus2 className="w-4 h-4" />
                <span>إصدار فاتورة بيع</span>
              </button>
              <button
                type="button"
                onClick={() => onTabChange('custody')}
                className="min-h-[48px] rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
              >
                <Boxes className="w-4 h-4" />
                <span>العهدة والتحويلات</span>
              </button>
            </div>
          </div>

          {activeDeliveryOrders.length > 0 && (
            <div className="bg-white rounded-3xl border border-indigo-200 p-4 shadow-xs space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-indigo-950">
                  أوامر التوصيل المسندة لك ({activeDeliveryOrders.length})
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setCustomersSubView('orders');
                    onTabChange('customers');
                  }}
                  className="text-xs font-bold text-blue-900 cursor-pointer"
                >
                  عرض سجل الطلبات
                </button>
              </div>
              <div className="space-y-2.5">
                {activeDeliveryOrders.map((ord) => (
                  <div key={ord.id} className="p-3 rounded-2xl bg-indigo-50/50 border border-indigo-200 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-black text-blue-950">{ord.requestNumber}</span>
                        <span className="mx-1.5 text-slate-400">·</span>
                        <strong className="text-slate-900">{ord.shopName || ord.customerName}</strong>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 text-[10px] font-bold">
                        {getDeliveryStatusLabel(ord.status)}
                      </span>
                    </div>
                    {ord.deliveryAddress && (
                      <p className="text-[11px] text-slate-600">{ord.deliveryAddress}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {ord.status === 'rep_assigned' && (
                        <button
                          type="button"
                          disabled={busyDeliveryOrderId === ord.id}
                          onClick={() => handleDeliveryStatusChange(ord, 'out_for_delivery')}
                          className="min-h-[38px] px-3 rounded-xl bg-purple-700 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          بدء التوصيل
                        </button>
                      )}
                      {(ord.status === 'rep_assigned' || ord.status === 'out_for_delivery') && (
                        <button
                          type="button"
                          disabled={busyDeliveryOrderId === ord.id}
                          onClick={() => handleDeliveryStatusChange(ord, 'delivered')}
                          className="min-h-[38px] px-3 rounded-xl bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          تأكيد التسليم للعميل
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setDeliveryReviewId(deliveryReviewId === ord.id ? null : ord.id);
                          setDeliveryReviewNote('');
                        }}
                        className="min-h-[38px] px-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-bold cursor-pointer"
                      >
                        ملاحظة / يحتاج مراجعة
                      </button>
                    </div>
                    {deliveryReviewId === ord.id && (
                      <div className="flex gap-2 pt-1">
                        <input
                          type="text"
                          value={deliveryReviewNote}
                          onChange={(e) => setDeliveryReviewNote(e.target.value)}
                          placeholder="اذكر سبب المراجعة أو العودة للإدارة..."
                          className="flex-1 min-h-[38px] rounded-xl border border-rose-300 px-2.5 bg-white"
                        />
                        <button
                          type="button"
                          disabled={busyDeliveryOrderId === ord.id || !deliveryReviewNote.trim()}
                          onClick={() => handleDeliveryStatusChange(ord, 'needs_review', deliveryReviewNote.trim())}
                          className="min-h-[38px] px-3 rounded-xl bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50"
                        >
                          إرسال
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ALLOWED CUSTOMERS + REP ORDERS */}
      {activeTab === 'customers' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1.5 bg-white p-1.5 rounded-2xl border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setCustomersSubView('list')}
              className={`min-h-[42px] rounded-xl font-bold cursor-pointer ${
                customersSubView === 'list' ? 'bg-blue-900 text-white' : 'text-slate-600'
              }`}
            >
              عملائي ({data.customers.length})
            </button>
            <button
              type="button"
              onClick={() => setCustomersSubView('orders')}
              className={`min-h-[42px] rounded-xl font-bold cursor-pointer ${
                customersSubView === 'orders' ? 'bg-blue-900 text-white' : 'text-slate-600'
              }`}
            >
              طلبات العملاء والتوصيل ({myAssignedDeliveries.length})
            </button>
          </div>

          {customersSubView === 'list' ? (
            <>
              <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs">
                <div className="relative">
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="ابحث باسم العميل أو المحل أو المنطقة أو الهاتف..."
                    className="w-full rounded-xl border border-slate-300 py-3 pr-10 pl-3 text-xs font-semibold outline-hidden focus:border-blue-600"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
                </div>
              </div>

              {filteredCustomers.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-xs text-slate-500">
                  لا يوجد عملاء مخصصون لحسابك حالياً. راجع مدير النظام لتحديد العملاء المسموحين لك.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredCustomers.map((c) => {
                    const mapsQuery = encodeURIComponent(c.geoCoordinates || c.address || c.name);
                    return (
                      <div
                        key={c.id}
                        className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-black text-sm text-slate-900">{c.shopName || c.name}</h3>
                            <p className="text-[11px] text-slate-500">
                              {c.name} · {c.code} {c.area ? `· ${c.area}` : ''}
                            </p>
                          </div>
                          <strong
                            className={`font-mono text-sm tabular-nums ${
                              c.currentBalance > 0 ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {c.currentBalance.toLocaleString()} {data.settings.currency}
                          </strong>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <a
                            href={`tel:${c.phone}`}
                            className="min-h-[42px] px-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold inline-flex items-center gap-1.5"
                          >
                            <Phone className="w-4 h-4" />
                            <span>{c.phone}</span>
                          </a>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[42px] px-3 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 font-bold inline-flex items-center gap-1.5"
                          >
                            <MapPin className="w-4 h-4" />
                            <span>الموقع</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setInvCustomerId(c.id);
                              onTabChange('new-invoice');
                            }}
                            className="min-h-[42px] flex-1 px-3 rounded-xl bg-blue-900 text-white font-bold cursor-pointer"
                          >
                            فاتورة جديدة
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRepOrderCustomerId(c.id);
                              setCustomersSubView('orders');
                            }}
                            className="min-h-[42px] px-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold cursor-pointer"
                          >
                            طلب أصناف
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3 text-xs">
              <form
                onSubmit={handleSubmitRepOrder}
                className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3"
              >
                <h4 className="font-black text-sm text-slate-900">رفع طلب أصناف جديد لعميل (متاح أونلاين وأوفلاين)</h4>
                <select
                  value={repOrderCustomerId}
                  onChange={(e) => setRepOrderCustomerId(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 bg-white font-bold"
                >
                  <option value="">-- اختر العميل المسموح --</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shopName ? `${c.shopName} (${c.name})` : c.name} — {c.phone}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={repOrderProdId}
                    onChange={(e) => handleSelectRepOrderProduct(e.target.value)}
                    className="flex-1 min-w-[180px] min-h-[42px] rounded-xl border border-slate-300 px-2.5 bg-white font-bold"
                  >
                    <option value="">-- اختر الصنف --</option>
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sellingPrice} {data.settings.currency})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={repOrderQty}
                    onChange={(e) => setRepOrderQty(Math.max(1, Number(e.target.value)))}
                    className="w-20 min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold"
                  />
                  <button
                    type="button"
                    onClick={handleAddRepOrderItem}
                    className="min-h-[42px] px-3.5 rounded-xl bg-blue-900 text-white font-bold cursor-pointer"
                  >
                    إضافة
                  </button>
                </div>

                {repOrderItems.length > 0 && (
                  <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl">
                    {repOrderItems.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <span className="font-bold">
                          {it.productName} ({it.quantity} {it.unit})
                        </span>
                        <button
                          type="button"
                          onClick={() => setRepOrderItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-red-600 font-bold px-2 cursor-pointer"
                        >
                          حذف
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  value={repOrderNotes}
                  onChange={(e) => setRepOrderNotes(e.target.value)}
                  placeholder="ملاحظات الطلب والتسليم..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
                />

                <button
                  type="submit"
                  disabled={isSubmittingRepOrder || !repOrderCustomerId || repOrderItems.length === 0}
                  className="w-full min-h-[44px] rounded-xl bg-emerald-700 text-white font-black disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingRepOrder ? 'جاري الإرسال...' : 'إرسال طلب العميل للإدارة'}
                </button>
              </form>

              {myAssignedDeliveries.map((ord) => (
                <div key={ord.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-black text-blue-950">{ord.requestNumber}</span>
                      <span className="mx-1.5 text-slate-400">·</span>
                      <strong className="text-slate-900">{ord.shopName || ord.customerName}</strong>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-900 font-bold text-[10px]">
                      {getDeliveryStatusLabel(ord.status)}
                    </span>
                  </div>
                  <div className="space-y-1 bg-slate-50 rounded-xl p-2 text-[11px]">
                    {(ord.items || []).map((it, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>{it.productName}</span>
                        <span className="font-mono">{it.quantity} {it.unit}</span>
                      </div>
                    ))}
                  </div>
                  {['rep_assigned', 'out_for_delivery', 'needs_review'].includes(ord.status) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {ord.status === 'rep_assigned' && (
                        <button
                          type="button"
                          disabled={busyDeliveryOrderId === ord.id}
                          onClick={() => handleDeliveryStatusChange(ord, 'out_for_delivery')}
                          className="min-h-[38px] px-3 rounded-xl bg-purple-700 text-white font-bold cursor-pointer"
                        >
                          بدء التوصيل
                        </button>
                      )}
                      {(ord.status === 'rep_assigned' || ord.status === 'out_for_delivery') && (
                        <button
                          type="button"
                          disabled={busyDeliveryOrderId === ord.id}
                          onClick={() => handleDeliveryStatusChange(ord, 'delivered')}
                          className="min-h-[38px] px-3 rounded-xl bg-emerald-700 text-white font-bold cursor-pointer"
                        >
                          تأكيد التسليم
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: NEW SALES INVOICE */}
      {activeTab === 'new-invoice' && (
        <div className="space-y-4">
          {data.isUsingOfflineCache && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900">
              وضع عدم الاتصال (بيانات محلية): يتم حفظ الفاتورة محلياً وترحيلها تلقائياً للسيرفر فور عودة الشبكة مع مراجعة الأرصدة.
            </div>
          )}

          <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-black text-slate-900">إنشاء فاتورة مبيعات ميدانية</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">العميل المسموح:</label>
                <select
                  value={invCustomerId}
                  onChange={(e) => setInvCustomerId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
                >
                  <option value="">-- اختر العميل --</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shopName ? `${c.shopName} (${c.name})` : c.name} — رصيد: {c.currentBalance}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">مستودع الصرف (السيارة):</label>
                <select
                  value={effectiveVanId}
                  onChange={(e) => setInvWarehouseId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
                >
                  {data.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-2.5">
              <label className="block font-bold text-slate-800">إضافة صنف:</label>
              <select
                value={invProductId}
                onChange={(e) => handleSelectProduct(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-blue-300 px-3 font-bold bg-white"
              >
                <option value="">-- اختر الصنف --</option>
                {activeProducts.map((p) => {
                  const vanQty = p.stockPerWarehouse?.[effectiveVanId] || 0;
                  const mainQty = mainWarehouse ? p.stockPerWarehouse?.[mainWarehouse.id] || 0 : 0;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} (سيارتي: {vanQty} | الرئيسي: {mainQty} {p.baseUnit})
                    </option>
                  );
                })}
              </select>

              {selectedProduct && invCustomerId && (
                <div className="p-2.5 rounded-xl bg-white border border-blue-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-blue-950">
                    <History className="w-4 h-4 shrink-0" />
                    <span>آخر 3 أسعار بيع لهذا العميل:</span>
                  </div>
                  {selectedProdLastPrices.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedProdLastPrices.map((entry, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setInvPrice(entry.price)}
                          className="min-h-[38px] px-3 py-1 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-950 font-mono font-bold text-[11px] cursor-pointer"
                        >
                          {entry.price} {data.settings.currency}
                          {entry.date ? ` · ${entry.date}` : ''}
                          {entry.invoiceNumber ? ` · ${entry.invoiceNumber}` : ''}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">لا يوجد سجل أسعار سابق لهذا العميل بهذا الصنف.</p>
                  )}
                </div>
              )}

              {selectedProduct && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">الوحدة</label>
                    <select
                      value={invUnitName}
                      onChange={(e) => handleUnitChange(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-2 bg-white font-bold"
                    >
                      {selectedProduct.units.map((u) => (
                        <option key={u.id} value={u.name}>
                          {u.name} ({u.conversionFactor})
                        </option>
                      ))}
                      <option value={selectedProduct.baseUnit}>{selectedProduct.baseUnit}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">الكمية</label>
                    <input
                      type="number"
                      min={1}
                      value={invQty}
                      onChange={(e) => setInvQty(Math.max(1, Number(e.target.value)))}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">السعر</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      value={invPrice}
                      onChange={(e) => setInvPrice(Math.max(0, Number(e.target.value)))}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                </div>
              )}

              {selectedProduct && (
                <button
                  type="button"
                  onClick={handleAddInvoiceItem}
                  className="w-full min-h-[44px] rounded-xl bg-blue-900 text-white font-black flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة الصنف للفاتورة</span>
                </button>
              )}
            </div>

            {invItems.length > 0 && (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl px-3">
                {invItems.map((it, idx) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{it.productName}</p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {it.quantity} {it.unit} × {it.unitPrice.toLocaleString()} ={' '}
                        {it.total.toLocaleString()} {data.settings.currency}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {shortageItems.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-black">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>عجز في مخزون سيارتك لعدد ({shortageItems.length}) أصناف</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  {shortageItems.map((sh) => (
                    <div key={sh.productId} className="flex items-center justify-between font-mono">
                      <span className="font-sans font-bold">{sh.productName}</span>
                      <span className="text-red-700">
                        المتاح: {sh.availableInVanQty} · العجز: {sh.shortageQty} {sh.unit}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-amber-800">
                  سيتم حفظ الفاتورة كمسودة، ويمكنك إرسال طلب تحويل أصناف للعجز من المخزن الرئيسي الآن لاعتمادها فور التنفيذ.
                </p>
              </div>
            )}

            {invItems.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'cash' as const, label: 'نقدي' },
                    { key: 'credit' as const, label: 'آجل' },
                    { key: 'partial' as const, label: 'جزئي' },
                  ].map((pt) => (
                    <button
                      key={pt.key}
                      type="button"
                      onClick={() => setInvPaymentType(pt.key)}
                      className={`min-h-[42px] rounded-xl border font-bold cursor-pointer ${
                        invPaymentType === pt.key
                          ? 'bg-blue-900 text-white border-blue-900'
                          : 'bg-slate-50 text-slate-700 border-slate-300'
                      }`}
                    >
                      {pt.label}
                    </button>
                  ))}
                </div>

                {invPaymentType === 'partial' && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">المدفوع نقداً الآن</label>
                    <input
                      type="number"
                      min={0}
                      max={invGrandTotal}
                      value={invPaidAmount}
                      onChange={(e) => setInvPaidAmount(Number(e.target.value))}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
                    />
                  </div>
                )}

                {invPaymentType !== 'credit' && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الخزينة</label>
                    <select
                      value={invCashboxId}
                      onChange={(e) => setInvCashboxId(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 bg-white font-bold"
                    >
                      {data.cashboxes.map((cb) => (
                        <option key={cb.id} value={cb.id}>
                          {cb.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <input
                  type="text"
                  value={invNotes}
                  onChange={(e) => setInvNotes(e.target.value)}
                  placeholder="ملاحظات الفاتورة (اختياري)..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
                />

                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between font-black text-sm text-blue-950">
                  <span>إجمالي الفاتورة:</span>
                  <span className="font-mono tabular-nums">
                    {invGrandTotal.toLocaleString()} {data.settings.currency}
                  </span>
                </div>

                {shortageItems.length > 0 ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft_with_transfer')}
                      className="w-full min-h-[48px] rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-black cursor-pointer disabled:opacity-50"
                    >
                      {isSubmittingInvoice
                        ? 'جاري الحفظ والإرسال...'
                        : 'حفظ كمسودة وإرسال طلب تحويل للعجز'}
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft')}
                      className="w-full min-h-[44px] rounded-2xl bg-slate-200 text-slate-800 font-bold cursor-pointer"
                    >
                      حفظ كمسودة فقط
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft')}
                      className="min-h-[48px] rounded-2xl bg-slate-200 text-slate-800 font-bold cursor-pointer"
                    >
                      حفظ كمسودة
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('confirmed')}
                      className="min-h-[48px] rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
                    >
                      {isSubmittingInvoice ? 'جاري الإصدار...' : 'اعتماد وإصدار'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: INVOICES & DRAFTS */}
      {activeTab === 'invoices' && (
        <div className="space-y-3">
          {myInvoices.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-xs text-slate-500">
              لا توجد فواتير مسجلة لك حتى الآن.
            </div>
          ) : (
            myInvoices.map((inv) => {
              const confirmCheck = inv.status === 'draft' ? canConfirmDraft(inv) : { ready: false };
              return (
                <div
                  key={inv.id}
                  className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono font-black text-sm text-blue-950">
                        {inv.invoiceNumber}
                      </span>
                      <p className="text-[11px] text-slate-500">
                        {inv.customerName} · {inv.date}
                      </p>
                    </div>
                    <div className="text-left">
                      <strong className="font-mono text-sm text-slate-900 tabular-nums block">
                        {inv.grandTotal.toLocaleString()} {data.settings.currency}
                      </strong>
                      <span
                        className={`text-[11px] font-bold ${
                          inv.status === 'confirmed'
                            ? 'text-emerald-700'
                            : inv.status === 'draft'
                            ? 'text-amber-700'
                            : 'text-red-700'
                        }`}
                      >
                        {inv.status === 'confirmed' ? 'معتمدة' : inv.status === 'draft' ? 'مسودة' : 'ملغاة'}
                      </span>
                    </div>
                  </div>

                  {inv.status === 'draft' && inv.linkedRepTransferNumber && (
                    <p className="text-[11px] text-blue-900 font-bold">
                      مرتبطة بطلب تحويل: {inv.linkedRepTransferNumber}
                      {!confirmCheck.ready && confirmCheck.reason ? ` — ${confirmCheck.reason}` : ''}
                    </p>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    {inv.status === 'draft' && (
                      <button
                        type="button"
                        disabled={!confirmCheck.ready}
                        onClick={() => handleConfirmDraft(inv)}
                        className="flex-1 min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black disabled:opacity-45 cursor-pointer"
                      >
                        اعتماد نهائي
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="min-h-[44px] px-3.5 rounded-xl bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      التفاصيل
                    </button>
                    <button
                      type="button"
                      onClick={() => exportInvoiceDocument(inv)}
                      className="min-h-[44px] px-3.5 rounded-xl bg-blue-900 text-white font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {isNative ? <Share2 className="w-4 h-4" /> : <FileDown className="w-4 h-4" />}
                      <span>{isNative ? 'مشاركة' : 'PDF'}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 5: CUSTODY & TRANSFERS */}
      {activeTab === 'custody' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-1.5 bg-white p-1.5 rounded-2xl border border-slate-200 text-xs">
            {[
              { key: 'van' as const, label: 'مخزون سيارتي' },
              { key: 'items' as const, label: `تحويل الأصناف (${myItemTransfers.length})` },
              { key: 'cash' as const, label: `النقدي (${myCashTransfers.length})` },
            ].map((st) => (
              <button
                key={st.key}
                type="button"
                onClick={() => setCustodySubTab(st.key)}
                className={`min-h-[42px] rounded-xl font-bold cursor-pointer ${
                  custodySubTab === st.key ? 'bg-blue-900 text-white' : 'text-slate-600'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {custodySubTab === 'van' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5 text-xs">
              <h4 className="font-black text-slate-900">
                أرصدة البضاعة في: {vanWarehouse?.name || 'سيارة المندوب'}
              </h4>
              <div className="divide-y divide-slate-100">
                {activeProducts
                  .filter((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) > 0)
                  .map((p) => (
                    <div key={p.id} className="py-2.5 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-900">{p.name}</p>
                        <p className="text-[11px] text-slate-500">{p.category}</p>
                      </div>
                      <strong className="font-mono text-sm text-blue-950 tabular-nums">
                        {p.stockPerWarehouse?.[effectiveVanId] || 0} {p.baseUnit}
                      </strong>
                    </div>
                  ))}
                {activeProducts.every((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) <= 0) && (
                  <p className="py-6 text-center text-slate-400">لا توجد بضاعة متوفرة حالياً داخل مستودع السيارة.</p>
                )}
              </div>
            </div>
          )}

          {custodySubTab === 'items' && (
            <div className="space-y-3 text-xs">
              <form
                onSubmit={handleSendDirectItemTransfer}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3"
              >
                <h4 className="font-black text-slate-900">طلب تحويل أصناف من المخزن الرئيسي إلى السيارة</h4>
                <div className="flex gap-2">
                  <select
                    value={reqProdId}
                    onChange={(e) => setReqProdId(e.target.value)}
                    className="flex-1 min-h-[42px] rounded-xl border border-slate-300 px-2.5 bg-white font-bold"
                  >
                    <option value="">-- اختر الصنف --</option>
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (الرئيسي: {mainWarehouse ? p.stockPerWarehouse?.[mainWarehouse.id] || 0 : 0})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={reqQty}
                    onChange={(e) => setReqQty(Math.max(1, Number(e.target.value)))}
                    className="w-20 min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const prod = activeProducts.find((p) => p.id === reqProdId);
                      if (!prod || reqQty <= 0) return;
                      const vanQty = prod.stockPerWarehouse?.[effectiveVanId] || 0;
                      setReqItems((prev) => [
                        ...prev,
                        {
                          productId: prod.id,
                          productName: prod.name,
                          unit: prod.baseUnit,
                          requestedQty: reqQty,
                          availableInVanQty: vanQty,
                          shortageQty: Math.max(0, reqQty - vanQty),
                        },
                      ]);
                      setReqProdId('');
                    }}
                    className="min-h-[42px] px-3.5 rounded-xl bg-blue-900 text-white font-bold cursor-pointer"
                  >
                    إضافة
                  </button>
                </div>

                {reqItems.length > 0 && (
                  <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl">
                    {reqItems.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <span className="font-bold">{it.productName} ({it.requestedQty} {it.unit})</span>
                        <button
                          type="button"
                          onClick={() => setReqItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-red-600 font-bold px-2 cursor-pointer"
                        >
                          حذف
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSendingTransfer || reqItems.length === 0}
                  className="w-full min-h-[44px] rounded-xl bg-emerald-700 text-white font-black disabled:opacity-50 cursor-pointer"
                >
                  {isSendingTransfer ? 'جاري الإرسال...' : 'إرسال طلب التحويل للإدارة'}
                </button>
              </form>

              {myItemTransfers.map((tr) => (
                <div key={tr.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-blue-950">{tr.requestNumber}</span>
                    <span className="font-bold text-slate-700">
                      {tr.status === 'pending'
                        ? 'قيد مراجعة الإدارة'
                        : tr.status === 'approved'
                        ? 'معتمد — بانتظار الصرف'
                        : tr.status === 'executed'
                        ? 'تم الصرف — بانتظار تأكيد استلامك'
                        : tr.status === 'received'
                        ? 'تم الاستلام الفعلي'
                        : 'مرفوض'}
                    </span>
                  </div>
                  {tr.invoiceNumber && (
                    <p className="text-[11px] text-blue-800 font-bold">مرتبط بفاتورة: {tr.invoiceNumber}</p>
                  )}
                  <div className="space-y-1 text-[11px] text-slate-600">
                    {tr.items.map((it, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{it.productName}</span>
                        <span className="font-mono">{it.requestedQty} {it.unit}</span>
                      </div>
                    ))}
                  </div>
                  {tr.status === 'executed' && (
                    <button
                      type="button"
                      onClick={() => handleConfirmItemReceived(tr.id, tr.requestNumber)}
                      className="w-full min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer"
                    >
                      تأكيد استلام الأصناف فعلياً
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {custodySubTab === 'cash' && (
            <div className="space-y-3 text-xs">
              <form
                onSubmit={handleSendCashToOwner}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3"
              >
                <h4 className="font-black text-slate-900">توريد نقدية من المندوب إلى خزينة الفرع</h4>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={cashAmount || ''}
                    onChange={(e) => setCashAmount(Number(e.target.value))}
                    placeholder={`المبلغ (${data.settings.currency})`}
                    className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
                  />
                  <button
                    type="submit"
                    disabled={isSendingTransfer || cashAmount <= 0}
                    className="min-h-[44px] px-4 rounded-xl bg-blue-900 text-white font-black disabled:opacity-50 cursor-pointer"
                  >
                    إرسال التوريد
                  </button>
                </div>
                <input
                  type="text"
                  value={cashNotes}
                  onChange={(e) => setCashNotes(e.target.value)}
                  placeholder="ملاحظات التوريد (اختياري)..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
                />
              </form>

              {myCashTransfers.map((t) => (
                <div key={t.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-blue-950">{t.transferNumber}</span>
                    <strong className="font-mono text-sm text-slate-900">
                      {t.amount.toLocaleString()} {data.settings.currency}
                    </strong>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    {t.direction === 'rep_to_owner' ? 'توريد إلى الفرع' : 'عهدة واردة لك من الإدارة'} ·{' '}
                    {t.status === 'received'
                      ? 'تم الاستلام والتسوية'
                      : t.status === 'awaiting_receipt'
                      ? 'بانتظار تأكيد الاستلام'
                      : 'مرفوض'}
                  </p>
                  {t.status === 'awaiting_receipt' && t.direction === 'owner_to_rep' && (
                    <button
                      type="button"
                      onClick={() => handleConfirmOwnerCash(t.id)}
                      className="w-full min-h-[44px] rounded-xl bg-emerald-700 text-white font-black cursor-pointer"
                    >
                      تأكيد استلام العهدة النقدية
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invoice Detail Sheet */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-200 max-h-[82vh] flex flex-col gap-3 text-xs pb-safe">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h4 className="font-black text-sm text-slate-900">
                  {selectedInvoice.invoiceNumber} — {selectedInvoice.customerName}
                </h4>
                <p className="text-slate-500 font-mono">{selectedInvoice.date}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="min-h-[40px] px-3 rounded-xl bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {(selectedInvoice.items || []).map((it, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900">{it.productName}</p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {it.quantity} {it.unit} × {it.unitPrice.toLocaleString()}
                    </p>
                  </div>
                  <strong className="font-mono text-blue-950">
                    {it.total.toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => exportInvoiceDocument(selectedInvoice)}
              className="min-h-[46px] rounded-xl bg-blue-900 text-white font-black flex items-center justify-center gap-2 cursor-pointer"
            >
              {isNative ? <Share2 className="w-4 h-4" /> : <FileDown className="w-4 h-4" />}
              <span>{isNative ? 'مشاركة / حفظ الفاتورة' : 'طباعة / PDF'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  Package,
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  MapPin,
  RefreshCw,
  History,
  FileDown,
  Share2,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  CloudOff,
  CloudCheck,
  Truck,
  Wallet,
  Heart,
  Tag,
  Barcode,
  LayoutGrid,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber } from '../../../i18n/translator';
import { CustomerPriceHistoryEntry, Invoice, Product } from '../../../types';
import { getCurrentLocationSafe, isNativeCapacitor } from '../../../services/native';
import { resolveActiveStorefrontOffer, isZeroZeroLocation } from '../../../utils/storefront';
import { exportHtmlToPdf } from '../../common/PdfExporter';
import { exportToExcel } from '../../common/ExcelExporter';
import { QuantityInput } from '../../common/QuantityInput';
import { QrScannerModal } from '../../common/QrScannerModal';
import { CustomerLocationPickerModal } from '../../common/CustomerLocationPickerModal';
import { computeLineTotal, round3 } from '../../../utils/quantity';
import { CustomerStorefrontHome, CustomerCartItem } from './CustomerStorefrontHome';
import { CustomerMoreScreen } from './CustomerMoreScreen';

export type CustomerTabKey =
  | 'home'
  | 'categories'
  | 'offers'
  | 'favorites'
  | 'more'
  | 'cart'
  | 'orders'
  | 'account';

interface CustomerPortalProps {
  activeTab: CustomerTabKey;
  onTabChange: (tab: CustomerTabKey) => void;
  focusReferenceId?: string | null;
  onCartCountChange?: (count: number) => void;
  onOpenNotifications?: () => void;
  onOpenServerModal?: () => void;
  onOpenSyncCenter?: () => void;
  onLogout?: () => void;
}

const CUSTOMER_ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'طلب جديد',
  under_review: 'قيد المراجعة',
  approved: 'معتمد',
  invoiced: 'تم التحويل لفاتورة',
  preparing: 'قيد التجهيز',
  rep_assigned: 'تم تعيين مندوب',
  out_for_delivery: 'خرج للتوصيل',
  delivered: 'تم التسليم',
  collected: 'تم التحصيل',
  closed: 'مغلق',
  needs_review: 'يحتاج مراجعة',
  rejected: 'مرفوض',
  cancelled: 'ملغى',
};

const CUSTOMER_ORDER_STATUS_LABELS_EN: Record<string, string> = {
  pending: 'New Order',
  under_review: 'Under Review',
  approved: 'Approved',
  invoiced: 'Converted to Invoice',
  preparing: 'Preparing',
  rep_assigned: 'Rep Assigned',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  collected: 'Collected',
  closed: 'Closed',
  needs_review: 'Needs Review',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const NINE_STAGE_TIMELINE: Array<{ key: string; label: string; labelEn: string }> = [
  { key: 'pending', label: 'جديد', labelEn: 'New' },
  { key: 'under_review', label: 'مراجعة', labelEn: 'Review' },
  { key: 'approved', label: 'معتمد', labelEn: 'Approved' },
  { key: 'invoiced', label: 'فوترة', labelEn: 'Invoiced' },
  { key: 'preparing', label: 'تجهيز', labelEn: 'Preparing' },
  { key: 'out_for_delivery', label: 'توصيل', labelEn: 'Delivery' },
  { key: 'delivered', label: 'تسليم', labelEn: 'Delivered' },
  { key: 'collected', label: 'تحصيل', labelEn: 'Collected' },
  { key: 'closed', label: 'إغلاق', labelEn: 'Closed' },
];

const createClientIdempotencyKey = () =>
  `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const CustomerPortal: React.FC<CustomerPortalProps> = ({
  activeTab,
  onTabChange,
  onCartCountChange,
  onOpenNotifications,
  onOpenServerModal,
  onOpenSyncCenter,
  onLogout,
}) => {
  const { currentUser, customerProfile, mobileConfig, logout } = useAuth();
  const data = useData();
  const { t, dir, isRtl } = usePreferences();
  const BackArrow = isRtl ? ArrowRight : ArrowLeft;
  const customer = data.customers[0] || customerProfile || null;
  const allowPriceView = mobileConfig.allowCustomerPriceView !== false;
  const isNative = isNativeCapacitor();
  const storefront = data.publishedStorefront;

  // Search & category filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDisplayProductIds, setSelectedDisplayProductIds] = useState<string[] | null>(null);
  const [selectedUnitsByProd, setSelectedUnitsByProd] = useState<Record<string, string>>({});
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);

  // Cart state
  const [cartItems, setCartItems] = useState<CustomerCartItem[]>([]);
  const [flyDot, setFlyDot] = useState<{ x: number; y: number; key: number } | null>(null);

  // Checkout snapshot fields
  const [checkoutPhone, setCheckoutPhone] = useState('');
  const [checkoutShopName, setCheckoutShopName] = useState('');
  const [checkoutAddress, setCheckoutAddress] = useState('');
  const [checkoutGeo, setCheckoutGeo] = useState('');
  const [checkoutLat, setCheckoutLat] = useState<number | undefined>(undefined);
  const [checkoutLng, setCheckoutLng] = useState<number | undefined>(undefined);
  const [orderNotes, setOrderNotes] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // Account & invoices sub-tab
  const [accountSubTab, setAccountSubTab] = useState<'invoices' | 'statement'>('invoices');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const idempotencyKeyRef = useRef<string>(createClientIdempotencyKey());
  const rotateIdempotencyKey = () => {
    idempotencyKeyRef.current = createClientIdempotencyKey();
  };

  useEffect(() => {
    if (customer) {
      setCheckoutPhone((prev) => prev || customer.phone || currentUser?.phone || '');
      setCheckoutShopName((prev) => prev || customer.shopName || customer.name || '');
      setCheckoutAddress((prev) => prev || customer.address || '');
      if (customer.latitude && customer.longitude && !isZeroZeroLocation(customer.latitude, customer.longitude)) {
        setCheckoutLat((prev) => prev ?? customer.latitude);
        setCheckoutLng((prev) => prev ?? customer.longitude);
        setCheckoutGeo((prev) => prev || `${customer.latitude!.toFixed(6)}, ${customer.longitude!.toFixed(6)}`);
      } else if (customer.geoCoordinates) {
        setCheckoutGeo((prev) => prev || customer.geoCoordinates || '');
      }
    }
  }, [customer, currentUser?.phone]);

  useEffect(() => {
    onCartCountChange?.(cartItems.length);
  }, [cartItems.length, onCartCountChange]);

  const hiddenSet = useMemo(
    () => new Set((storefront?.hiddenProductIds || []).map(String)),
    [storefront?.hiddenProductIds]
  );

  const activeProducts = useMemo(
    () => data.products.filter((p) => p.status === 'active' && !hiddenSet.has(p.id)),
    [data.products, hiddenSet]
  );

  const imageCategoryTiles = useMemo(() => {
    const overrideMap = new Map(
      (storefront?.imageCategorySettings || []).map((c) => [c.categoryId, c])
    );
    const erpCats = (data.categories || []).filter((c) => c.status !== 'suspended');
    const erpTiles = erpCats
      .map((cat, idx) => {
        const ov = overrideMap.get(cat.id);
        if (ov && ov.isVisible === false) return null;
        return {
          id: cat.id,
          name: ov?.displayName?.trim() || cat.name,
          rawCategoryName: cat.name,
          imageUrl: ov?.imageUrl || '',
          sortOrder: ov?.sortOrder ?? idx + 1,
          productIds: undefined as string[] | undefined,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      name: string;
      rawCategoryName: string;
      imageUrl: string;
      sortOrder: number;
      productIds?: string[];
    }>;

    // Fallback if server didn't return categories array yet: derive from products
    if (erpTiles.length === 0) {
      const names = Array.from(new Set(activeProducts.map((p) => p.category).filter(Boolean)));
      names.forEach((name, idx) => {
        erpTiles.push({
          id: `cat-${idx}`,
          name,
          rawCategoryName: name,
          imageUrl: '',
          sortOrder: idx + 1,
        });
      });
    }

    const displayTiles = (storefront?.displayCategories || [])
      .filter((dc) => dc.isActive !== false && dc.name)
      .map((dc, idx) => ({
        id: `disp-${dc.id}`,
        name: dc.name,
        rawCategoryName: dc.name,
        imageUrl: dc.imageUrl || '',
        sortOrder: dc.sortOrder ?? 100 + idx,
        productIds: dc.productIds || [],
      }));

    return [...erpTiles, ...displayTiles].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [data.categories, storefront, activeProducts]);

  const getProductUnits = (prod: Product) => {
    const list: Array<{ name: string; factor: number; sellingPrice: number }> = [
      { name: prod.baseUnit, factor: 1, sellingPrice: prod.sellingPrice },
    ];
    for (const u of prod.units || []) {
      if (u.name && u.name !== prod.baseUnit) {
        list.push({
          name: u.name,
          factor: Number(u.conversionFactor) || 1,
          sellingPrice: Number(u.sellingPrice) || prod.sellingPrice * (Number(u.conversionFactor) || 1),
        });
      }
    }
    return list;
  };

  const getEffectiveCustomerPrice = (prod: Product, unitName: string, factor: number): number | null => {
    if (!allowPriceView) return null;
    const promo = resolveActiveStorefrontOffer(prod, unitName, storefront);
    if (promo.hasPromo) {
      return promo.effectivePrice;
    }
    const hist = customer?.priceHistory?.[prod.id];
    if (Array.isArray(hist) && hist.length > 0) {
      const latest = hist[hist.length - 1] as number | CustomerPriceHistoryEntry;
      const val = typeof latest === 'number' ? latest : latest.price;
      const entryUnit = typeof latest === 'number' ? undefined : latest.unit;
      if (typeof val === 'number' && val > 0 && (!entryUnit || entryUnit === unitName)) {
        return val;
      }
    }
    const unitEntry = getProductUnits(prod).find((u) => u.name === unitName);
    const price = unitEntry?.sellingPrice ?? prod.sellingPrice * factor;
    return price > 0 ? price : null;
  };

  const isProductAvailable = (prod: Product): boolean => {
    if (typeof prod.inStock === 'boolean') return prod.inStock;
    if (typeof prod.availableQty === 'number') return prod.availableQty > 0;
    return Object.values(prod.stockPerWarehouse || {}).reduce((sum, v) => sum + Number(v || 0), 0) > 0;
  };

  const triggerFlyDot = (originRect?: DOMRect | null) => {
    if (!originRect) return;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;
    setFlyDot({
      x: originRect.left + originRect.width / 2,
      y: originRect.top + originRect.height / 2,
      key: Date.now(),
    });
    window.setTimeout(() => setFlyDot(null), 500);
  };

  const handleAddToCart = (
    prod: Product,
    forcedUnitName?: string,
    addQty = 1,
    originRect?: DOMRect | null
  ) => {
    if (!isProductAvailable(prod)) {
      setFeedback({
        type: 'error',
        text: t(`الصنف (${prod.name}) غير متوفر بالمخزون حالياً.`, `Product (${prod.name}) is currently out of stock.`),
      });
      return;
    }
    const unitName = forcedUnitName || selectedUnitsByProd[prod.id] || prod.baseUnit;
    const safeQty = Math.max(0.001, Number(addQty) || 1);
    const unitMeta = getProductUnits(prod).find((u) => u.name === unitName) || {
      name: prod.baseUnit,
      factor: 1,
      sellingPrice: prod.sellingPrice,
    };
    const effectivePrice = getEffectiveCustomerPrice(prod, unitMeta.name, unitMeta.factor);

    rotateIdempotencyKey();
    setCartItems((prev) => {
      const idx = prev.findIndex(
        (it) => it.product.id === prod.id && it.unitName === unitMeta.name
      );
      if (idx >= 0) {
        return prev.map((it, i) =>
          i === idx
            ? { ...it, quantity: round3(it.quantity + safeQty), unitPrice: effectivePrice }
            : it
        );
      }
      return [
        ...prev,
        {
          product: prod,
          quantity: safeQty,
          unitName: unitMeta.name,
          unitFactor: unitMeta.factor,
          unitPrice: effectivePrice,
        },
      ];
    });
    triggerFlyDot(originRect);
    setFeedback({
      type: 'success',
      text: t(
        `تمت إضافة (${prod.name} — ${safeQty} ${unitMeta.name}) إلى السلة`,
        `Added (${prod.name} — ${safeQty} ${unitMeta.name}) to cart`
      ),
    });
    window.setTimeout(() => setFeedback(null), 2000);
  };

  const handleUpdateCartByKey = (productId: string, unitName: string, delta: number) => {
    const idx = cartItems.findIndex((it) => it.product.id === productId && it.unitName === unitName);
    if (idx >= 0) {
      updateCartQuantity(idx, delta);
    }
  };

  const setCartQuantity = (idx: number, nextQty: number) => {
    rotateIdempotencyKey();
    setCartItems((prev) =>
      prev
        .map((it, i) => (i === idx ? { ...it, quantity: round3(nextQty) } : it))
        .filter((it) => it.quantity > 0)
    );
  };

  const updateCartQuantity = (idx: number, delta: number) => {
    rotateIdempotencyKey();
    setCartItems((prev) =>
      prev
        .map((it, i) => (i === idx ? { ...it, quantity: round3(it.quantity + delta) } : it))
        .filter((it) => it.quantity > 0)
    );
  };

  const updateCartUnit = (idx: number, unitName: string) => {
    rotateIdempotencyKey();
    setCartItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const unitMeta = getProductUnits(it.product).find((u) => u.name === unitName);
        const factor = unitMeta?.factor || 1;
        return {
          ...it,
          unitName,
          unitFactor: factor,
          unitPrice: getEffectiveCustomerPrice(it.product, unitName, factor),
        };
      })
    );
  };

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeProducts.filter((p) => {
      const unitBarcodes = (p.units || []).map((u) => u.barcode || '').join(' ').toLowerCase();
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        unitBarcodes.includes(q);
      if (selectedDisplayProductIds) {
        return matchSearch && selectedDisplayProductIds.includes(p.id);
      }
      const matchCat = selectedCategory === 'all' || p.category === selectedCategory;
      return matchSearch && matchCat;
    });
  }, [activeProducts, searchQuery, selectedCategory, selectedDisplayProductIds]);

  const offerItems = useMemo(() => {
    const list: Array<{ product: Product; unitName: string }> = [];
    for (const p of activeProducts) {
      const preferred = selectedUnitsByProd[p.id] || p.baseUnit;
      if (resolveActiveStorefrontOffer(p, preferred, storefront).hasPromo) {
        list.push({ product: p, unitName: preferred });
        continue;
      }
      const matchedUnit = (p.units || []).find((u) => resolveActiveStorefrontOffer(p, u.name, storefront).hasPromo);
      if (matchedUnit) {
        list.push({ product: p, unitName: matchedUnit.name });
      }
    }
    return list;
  }, [activeProducts, selectedUnitsByProd, storefront]);

  const favoriteProducts = useMemo(() => {
    const favSet = new Set(data.customerFavorites || []);
    return activeProducts.filter((p) => favSet.has(p.id));
  }, [activeProducts, data.customerFavorites]);

  const handleCaptureLocation = async () => {
    setIsLocating(true);
    setFeedback(null);
    const res = await getCurrentLocationSafe();
    setIsLocating(false);
    if (res.ok && res.coords) {
      setCheckoutGeo(res.coords);
      if (res.latitude && res.longitude) {
        setCheckoutLat(res.latitude);
        setCheckoutLng(res.longitude);
      }
      setFeedback({ type: 'success', text: t('تم تحديد الموقع الجغرافي (GPS) بنجاح', 'GPS location captured successfully') });
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر تحديد الموقع الجغرافي', 'Failed to capture GPS location') });
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cartItems.length) return;

    setIsSubmitting(true);
    setFeedback(null);
    const res = await data.createCustomerItemOrder({
      customerId: customer?.id || '',
      customerName: customer?.name || currentUser?.fullName || t('عميل', 'Customer'),
      customerPhone: checkoutPhone.trim() || customer?.phone,
      shopName: checkoutShopName.trim() || customer?.shopName || customer?.name,
      deliveryAddress: checkoutAddress.trim() || customer?.address,
      geoCoordinates: checkoutGeo.trim() || customer?.geoCoordinates,
      items: cartItems.map((it) => ({
        productId: it.product.id,
        productCode: it.product.code,
        productName: it.product.name,
        unit: it.unitName,
        unitFactor: it.unitFactor,
        unitPrice: it.unitPrice ?? undefined,
        quantity: it.quantity,
      })),
      notes: orderNotes.trim() || t('طلب أصناف من تطبيق الموبايل', 'Item order from mobile app'),
      idempotencyKey: idempotencyKeyRef.current,
    });
    setIsSubmitting(false);

    if (res.queuedOffline) {
      setCartItems([]);
      setOrderNotes('');
      rotateIdempotencyKey();
      setFeedback({
        type: 'warning',
        text: t(
          `تم حفظ الطلب محلياً في طابور المزامنة (${res.order?.requestNumber || ''}) وسيتم إرساله تلقائياً فور عودة الاتصال.`,
          `Order saved locally in sync queue (${res.order?.requestNumber || ''}) and will be sent automatically once online.`
        ),
      });
      onTabChange('orders');
    } else if (res.success) {
      setCartItems([]);
      setOrderNotes('');
      rotateIdempotencyKey();
      setFeedback({
        type: 'success',
        text: t(
          `تم إرسال الطلب رقم ${res.order?.requestNumber || ''} بنجاح وسيتم مراجعته من الإدارة.`,
          `Order #${res.order?.requestNumber || ''} sent successfully and will be reviewed by management.`
        ),
      });
      onTabChange('orders');
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر إرسال الطلب حالياً', 'Unable to submit order right now') });
    }
  };

  const handleReorder = (order: typeof data.customerItemOrders extends Array<infer U> ? U : any) => {
    const mapped = (order.items || [])
      .map((oi: any) => {
        const prod = activeProducts.find((p) => p.id === oi.productId);
        if (!prod) return null;
        const unitMeta = getProductUnits(prod).find((u) => u.name === oi.unit) || {
          name: oi.unit || prod.baseUnit,
          factor: oi.unitFactor || 1,
          sellingPrice: prod.sellingPrice,
        };
        return {
          product: prod,
          quantity: Number(oi.quantity) || 1,
          unitName: unitMeta.name,
          unitFactor: unitMeta.factor,
          unitPrice: getEffectiveCustomerPrice(prod, unitMeta.name, unitMeta.factor),
        };
      })
      .filter(Boolean) as CustomerCartItem[];

    if (!mapped.length) {
      setFeedback({ type: 'error', text: t('الأصناف في هذا الطلب لم تعد متاحة حالياً.', 'Items in this order are no longer available.') });
      return;
    }
    rotateIdempotencyKey();
    setCartItems(mapped);
    setFeedback({
      type: 'success',
      text: t('تم نسخ أصناف الطلب إلى السلة — يمكنك تعديل الكميات والإرسال.', 'Order items copied to cart — you can adjust quantities and submit.'),
    });
    onTabChange('cart');
  };

  const myInvoices = useMemo(() => {
    return (data.invoices || [])
      .filter((i) => i.type === 'sales')
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [data.invoices]);

  const myOrders = useMemo(() => {
    return [...(data.customerItemOrders || [])].sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
  }, [data.customerItemOrders]);

  const cartTotalQty = round3(cartItems.reduce((sum, it) => sum + it.quantity, 0));
  const cartEstimatedTotal = cartItems.reduce(
    (sum, it) => sum + (it.unitPrice ? computeLineTotal(it.quantity, it.unitPrice) : 0),
    0
  );

  const exportInvoiceDocument = (inv: Invoice) => {
    const activeBranches = data.settings.extraSettings?.branches || [];
    const matchedBranch = activeBranches.find((b) => b.isDefault) || activeBranches[0];
    const resolvedBranchNumber = matchedBranch?.branchNumber || data.settings.branchNumber || '';
    const repObj = inv.representativeId
      ? data.representatives.find((r) => r.id === inv.representativeId)
      : inv.representativeName
      ? data.representatives.find((r) => r.name === inv.representativeName)
      : undefined;

    exportHtmlToPdf({
      title: t('فاتورة مبيعات', 'Sales Invoice'),
      companyName: data.settings.companyName,
      companySubtitle: data.settings.companySubtitle,
      address: data.settings.address,
      phone1: data.settings.phone1,
      phone2: data.settings.phone2,
      branchName: matchedBranch?.name,
      branchNumber: resolvedBranchNumber,
      representativeName: inv.representativeName || repObj?.name,
      representativePhone: repObj?.phone,
      docNumber: inv.invoiceNumber,
      dateRangeText: inv.date,
      meta: [
        { label: t('العميل', 'Customer'), value: customer?.name || inv.customerName || '-' },
        {
          label: t('طريقة السداد', 'Payment Method'),
          value:
            inv.paymentType === 'cash'
              ? t('نقدي', 'Cash')
              : inv.paymentType === 'credit'
              ? t('آجل', 'Credit')
              : t('سداد جزئي', 'Partial Payment'),
        },
      ],
      tableHeaders: allowPriceView
        ? [t('م', '#'), t('الصنف', 'Product'), t('الوحدة', 'Unit'), t('الكمية', 'Qty'), t('السعر', 'Price'), t('الإجمالي', 'Total')]
        : [t('م', '#'), t('الصنف', 'Product'), t('الوحدة', 'Unit'), t('الكمية', 'Qty')],
      tableRows: (inv.items || []).map((it, idx) =>
        allowPriceView
          ? [idx + 1, it.productName, it.unit, it.quantity, it.unitPrice.toFixed(2), it.total.toFixed(2)]
          : [idx + 1, it.productName, it.unit, it.quantity]
      ),
      summaryPairs: allowPriceView
        ? [
            { label: t('الصافي الإجمالي', 'Net Total'), value: `${inv.grandTotal.toFixed(2)} ${data.settings.currency}`, highlight: true },
            { label: t('المدفوع', 'Paid'), value: `${inv.paidAmount.toFixed(2)} ${data.settings.currency}` },
            { label: t('المتبقي', 'Remaining'), value: `${inv.remainingAmount.toFixed(2)} ${data.settings.currency}` },
          ]
        : [],
      notes: inv.notes,
    });
  };

  const exportStatementExcel = () => {
    const entries = data.customerStatement?.entries || [];
    exportToExcel(
      `${t('كشف_حساب', 'Account_Statement')}_${customer?.name || t('العميل', 'Customer')}`,
      allowPriceView
        ? [t('التاريخ', 'Date'), t('رقم المستند', 'Doc #'), t('البيان', 'Description'), t('مدين', 'Debit'), t('دائن', 'Credit'), t('الرصيد', 'Balance')]
        : [t('التاريخ', 'Date'), t('رقم المستند', 'Doc #'), t('البيان', 'Description')],
      entries.map((row) =>
        allowPriceView
          ? [row.date, row.docNumber, row.description, row.debit ?? 0, row.credit ?? 0, row.runningBalance ?? 0]
          : [row.date, row.docNumber, row.description]
      )
    );
  };

  if (mobileConfig.enableCustomerApp === false) {
    return (
      <div dir={dir} className="bg-white dark:bg-[#0E1C36] rounded-lg border border-amber-200 dark:border-amber-800/60 p-3.5 text-center space-y-2">
        <ShieldAlert className="w-10 h-10 text-amber-600 dark:text-amber-400 mx-auto" />
        <h3 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC]">{t('بوابة العملاء متوقفة مؤقتاً', 'Customer Portal Temporarily Paused')}</h3>
        <p className="text-xs text-slate-600 dark:text-[#A9BCD9] leading-relaxed">
          {t(
            'تم إيقاف استقبال طلبات العملاء عبر تطبيق الموبايل مؤقتاً من إعدادات الإدارة. يرجى التواصل مع مؤسسة أولاد سليم.',
            'Customer mobile app orders are temporarily paused by management settings. Please contact AWLAD SELIM.'
          )}
        </p>
        <button
          type="button"
          onClick={() => data.triggerManualSync()}
          className="h-8 px-3.5 rounded-md bg-[#003589] hover:bg-[#011E58] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t('إعادة التحقق', 'Recheck')}</span>
        </button>
      </div>
    );
  }

  const renderStoreProductCard = (prod: Product, forcedUnit?: string) => {
    const units = getProductUnits(prod);
    const activeUnit = forcedUnit || selectedUnitsByProd[prod.id] || prod.baseUnit;
    const promo = resolveActiveStorefrontOffer(prod, activeUnit, storefront);
    const effectivePrice = getEffectiveCustomerPrice(prod, activeUnit, units.find((u) => u.name === activeUnit)?.factor || 1);
    const available = isProductAvailable(prod);
    const isFav = (data.customerFavorites || []).includes(prod.id);
    const cartEntry = cartItems.find((c) => c.product.id === prod.id && c.unitName === activeUnit);

    return (
      <div
        key={`${prod.id}-${activeUnit}`}
        className="relative bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-1.5 flex flex-col justify-between gap-1"
      >
        {promo.hasPromo && (
          <div className="absolute top-1.5 start-1.5 z-10 bg-[#C81E1E] text-white text-[10px] font-black px-1.5 py-0.5 rounded">
            {promo.badgeText || t('عرض عشانك', 'Special Offer')}
          </div>
        )}

        <button
          type="button"
          onClick={() => data.toggleCustomerFavorite(prod.id)}
          aria-label={isFav ? t('إزالة من المفضلة', 'Remove from favorites') : t('إضافة للمفضلة', 'Add to favorites')}
          className={`absolute top-1.5 end-1.5 z-10 w-7 h-7 rounded-md flex items-center justify-center border cursor-pointer ${
            isFav
              ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-[#C81E1E]'
              : 'bg-white/90 dark:bg-[#132544]/95 border-slate-200 dark:border-[#2A436E] text-slate-400'
          }`}
        >
          <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
        </button>

        <div className="w-full py-3 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-100 dark:border-[#21375C] flex items-center justify-center">
          <Package className="w-7 h-7 text-slate-300 dark:text-[#6E89B2]" />
        </div>

        <div className="space-y-1 flex-1 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-black text-slate-900 dark:text-[#F3F7FC] line-clamp-2 leading-snug min-h-[2rem]">
              {prod.name}
            </h3>
            <div className="flex items-center justify-between gap-1 mt-0.5">
              {units.length > 1 ? (
                <select
                  value={activeUnit}
                  onChange={(e) =>
                    setSelectedUnitsByProd((prev) => ({ ...prev, [prod.id]: e.target.value }))
                  }
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-200 dark:border-[#2A436E] bg-slate-50 dark:bg-[#10203D] text-slate-700 dark:text-[#DCE6F5] outline-none"
                >
                  {units.map((u) => (
                    <option key={u.name} value={u.name}>
                      {u.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-200 dark:border-[#2A436E] bg-slate-50 dark:bg-[#132544] text-slate-600 dark:text-[#A9BCD9]">
                  {activeUnit}
                </span>
              )}
              {!available && <span className="text-[10px] font-bold text-red-600 dark:text-red-400">{t('غير متاح', 'Unavailable')}</span>}
            </div>
          </div>

          {allowPriceView ? (
            <div className="pt-0.5 flex items-baseline flex-wrap gap-1 awlad-tabular">
              <strong className="text-xs sm:text-sm font-black text-[#011E58] dark:text-[#85B8FF]">
                {effectivePrice !== null ? `${formatLocaleNumber(effectivePrice)} ${data.settings.currency}` : t('حسب التسعير', 'Per pricing')}
              </strong>
              {promo.hasPromo && (
                <span className="text-[10px] font-bold text-slate-400 line-through">
                  {formatLocaleNumber(promo.regularPrice)}
                </span>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-slate-400 pt-0.5">{t('السعر عند الاعتماد', 'Price upon approval')}</p>
          )}

          {cartEntry ? (
            <div className="flex items-center justify-between gap-1 bg-[#EEF3FA] dark:bg-[#132544] border border-[#003589]/30 dark:border-[#2A436E] rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => handleUpdateCartByKey(prod.id, activeUnit, 1)}
                className="w-7 h-7 rounded-md bg-[#003589] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white flex items-center justify-center cursor-pointer"
                aria-label={t('زيادة الكمية', 'Increase quantity')}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-black text-[#011E58] dark:text-[#85B8FF] awlad-tabular">
                {formatLocaleNumber(cartEntry.quantity)}
              </span>
              <button
                type="button"
                onClick={() => handleUpdateCartByKey(prod.id, activeUnit, -1)}
                className="w-7 h-7 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#2A436E] text-slate-700 dark:text-[#DCE6F5] flex items-center justify-center cursor-pointer"
                aria-label={t('تقليل الكمية', 'Decrease quantity')}
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!available}
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                handleAddToCart(prod, activeUnit, 1, rect);
              }}
              className="w-full h-8 rounded-md bg-[#003589] hover:bg-[#011E58] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] disabled:bg-slate-200 dark:disabled:bg-[#132544] disabled:text-slate-400 dark:disabled:text-[#849BBF] text-white text-[11px] font-black flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>{available ? t('إضافة للسلة', 'Add to cart') : t('نفد المخزون', 'Out of stock')}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const showStoreSearchBar = ['home', 'categories', 'offers', 'favorites'].includes(activeTab);

  return (
    <div dir={dir} className="space-y-2">
      {/* Reduced-motion-safe fly-to-cart visual dot */}
      {flyDot && (
        <div
          key={flyDot.key}
          className="awlad-fly-dot"
          style={{ left: `${flyDot.x}px`, top: `${flyDot.y}px` }}
          aria-hidden="true"
        />
      )}

      {/* Long Search Bar + Barcode Scan */}
      {showStoreSearchBar && (
        <div className="flex items-center gap-1.5 bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] rounded-lg p-1">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#849BBF] absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('بتدور علي منتج معين؟', 'Looking for a product?')}
              className="w-full h-8 ps-8 pe-7 rounded-md bg-slate-50 dark:bg-[#10203D] border border-transparent dark:border-[#2A436E] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] outline-none focus:ring-2 focus:ring-[#003589]/30 dark:focus:ring-[#3B82F6]/30"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute end-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-[#DCE6F5] cursor-pointer"
                aria-label={t('مسح البحث', 'Clear search')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsBarcodeScannerOpen(true)}
            className="h-8 min-w-[34px] px-2 rounded-md bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#2A436E] text-[#003589] dark:text-[#85B8FF] flex items-center justify-center cursor-pointer shrink-0"
            title={t('بحث بالباركود', 'Search by barcode')}
            aria-label={t('بحث بالباركود', 'Search by barcode')}
          >
            <Barcode className="w-4 h-4" />
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`p-2 rounded-lg border text-xs font-bold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : feedback.type === 'warning'
              ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
              : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
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

      {/* Search Override View when typing query on Home */}
      {activeTab === 'home' && searchQuery.trim().length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-0.5 text-xs">
            <h2 className="font-black text-slate-900 dark:text-[#F3F7FC]">
              {t('نتائج البحث', 'Search Results')} ({formatLocaleNumber(filteredProducts.length)})
            </h2>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="font-bold text-[#003589] dark:text-[#85B8FF] cursor-pointer"
            >
              {t('إلغاء البحث', 'Clear Search')}
            </button>
          </div>
          {filteredProducts.length === 0 ? (
            <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-3 text-center text-xs text-slate-500 dark:text-[#97AECE]">
              {t(`لا توجد أصناف مطابقة لبحثك "${searchQuery}".`, `No products match "${searchQuery}".`)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
              {filteredProducts.map((p) => renderStoreProductCard(p))}
            </div>
          )}
        </div>
      ) : null}

      {/* TAB 1: STOREFRONT HOME */}
      {activeTab === 'home' && searchQuery.trim().length === 0 && (
        <CustomerStorefrontHome
          storefront={storefront}
          products={activeProducts}
          categories={data.categories || []}
          currency={data.settings.currency}
          allowPriceView={allowPriceView}
          favoriteIds={data.customerFavorites || []}
          cartItems={cartItems}
          selectedUnitsByProd={selectedUnitsByProd}
          onSelectUnit={(pid, unit) =>
            setSelectedUnitsByProd((prev) => ({ ...prev, [pid]: unit }))
          }
          onAddToCart={(prod, unit, qty, rect) => handleAddToCart(prod, unit, qty, rect)}
          onUpdateCartItemQty={handleUpdateCartByKey}
          onToggleFavorite={(pid) => data.toggleCustomerFavorite(pid)}
          onNavigateTab={(tab) => onTabChange(tab)}
          onOpenCategory={(catName, displayProductIds) => {
            setSelectedCategory(catName);
            setSelectedDisplayProductIds(displayProductIds || null);
            onTabChange('categories');
          }}
        />
      )}

      {/* TAB 2: CATEGORIES (الأقسام المصورة + المنتجات) */}
      {activeTab === 'categories' && (
        <div className="space-y-2">
          {imageCategoryTiles.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <h2 className="text-xs font-black text-slate-900 dark:text-[#F3F7FC]">
                  {t('الأقسام المصورة', 'Categories')}
                </h2>
                {(selectedCategory !== 'all' || selectedDisplayProductIds) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('all');
                      setSelectedDisplayProductIds(null);
                    }}
                      className="text-xs font-black text-[#003589] dark:text-[#85B8FF] cursor-pointer"
                  >
                    {t('عرض جميع الأصناف', 'Show All Products')}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('all');
                    setSelectedDisplayProductIds(null);
                  }}
                  className={`rounded-lg border p-1.5 flex flex-col items-center justify-center gap-1 text-center cursor-pointer transition-colors ${
                    selectedCategory === 'all' && !selectedDisplayProductIds
                      ? 'bg-[#003589] dark:bg-[#1659C8] text-white border-[#003589] dark:border-[#60A5FA]/40'
                      : 'bg-white dark:bg-[#0E1C36] text-slate-800 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C]'
                  }`}
                >
                  <LayoutGrid className="w-5 h-5" />
                  <span className="text-[10px] font-black">{t('الكل', 'All')} ({formatLocaleNumber(activeProducts.length)})</span>
                </button>

                {imageCategoryTiles.map((tile) => {
                  const isSelected =
                    (tile.productIds && selectedDisplayProductIds === tile.productIds) ||
                    (!selectedDisplayProductIds && selectedCategory === tile.rawCategoryName);
                  return (
                    <button
                      key={tile.id}
                      type="button"
                      onClick={() => {
                        if (tile.productIds) {
                          setSelectedCategory(tile.name);
                          setSelectedDisplayProductIds(tile.productIds);
                        } else {
                          setSelectedDisplayProductIds(null);
                          setSelectedCategory(tile.rawCategoryName);
                        }
                      }}
                      className={`rounded-lg border p-1.5 flex flex-col items-center justify-between gap-1 text-center cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-[#003589] dark:border-[#3B82F6] ring-2 ring-[#003589]/25 dark:ring-[#3B82F6]/30 bg-[#EEF3FA] dark:bg-[#16366B]'
                          : 'bg-white dark:bg-[#0E1C36] border-slate-200 dark:border-[#21375C]'
                      }`}
                    >
                      <div className="w-full aspect-square rounded-md bg-slate-50 dark:bg-[#132544] overflow-hidden flex items-center justify-center">
                        {tile.imageUrl ? (
                          <img src={tile.imageUrl} alt={tile.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <LayoutGrid className="w-5 h-5 text-[#003589]/75 dark:text-[#85B8FF]" />
                        )}
                      </div>
                      <span className="text-[10px] font-black text-slate-800 dark:text-[#DCE6F5] line-clamp-2 leading-tight">
                        {tile.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <h3 className="text-xs font-black text-slate-600 dark:text-[#A9BCD9] px-0.5">
              {selectedCategory === 'all' ? t('جميع المنتجات', 'All Products') : selectedCategory} ({formatLocaleNumber(filteredProducts.length)})
            </h3>
            {filteredProducts.length === 0 ? (
              <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-3 text-center text-xs text-slate-500 dark:text-[#97AECE]">
                {t('لا توجد أصناف مطابقة في هذا القسم.', 'No matching products in this category.')}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                {filteredProducts.map((p) => renderStoreProductCard(p))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: OFFERS */}
      {activeTab === 'offers' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-0.5">
            <Tag className="w-4 h-4 text-[#C81E1E]" />
            <h2 className="text-xs font-black text-slate-900 dark:text-[#F3F7FC]">
              {storefront?.offersSectionTitle || t('العروض والخصومات الحالية', 'Active Offers')}
            </h2>
          </div>

          {offerItems.filter(({ product }) => {
            const q = searchQuery.trim().toLowerCase();
            return !q || product.name.toLowerCase().includes(q) || product.code.toLowerCase().includes(q);
          }).length === 0 ? (
            <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-3 text-center space-y-2 text-xs text-slate-500 dark:text-[#97AECE]">
              <Tag className="w-7 h-7 text-slate-300 dark:text-[#6E89B2] mx-auto" />
              <p className="font-bold">{t('لا توجد عروض نشطة حالياً — يمكنك تصفح الأقسام والمنتجات.', 'No active offers right now — browse categories and products.')}</p>
              <button
                type="button"
                onClick={() => onTabChange('categories')}
                className="h-8 px-3 rounded-md bg-[#003589] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-bold cursor-pointer"
              >
                {t('تصفح الأقسام', 'Browse Categories')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
              {offerItems
                .filter(({ product }) => {
                  const q = searchQuery.trim().toLowerCase();
                  return !q || product.name.toLowerCase().includes(q) || product.code.toLowerCase().includes(q);
                })
                .map(({ product, unitName }) => renderStoreProductCard(product, unitName))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: FAVORITES */}
      {activeTab === 'favorites' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-0.5">
            <Heart className="w-4 h-4 text-[#C81E1E] fill-current" />
            <h2 className="text-xs font-black text-slate-900 dark:text-[#F3F7FC]">
              {t('المنتجات المفضلة', 'My Favorites')} ({favoriteProducts.length})
            </h2>
          </div>

          {favoriteProducts.length === 0 ? (
            <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-3 text-center space-y-2 text-xs text-slate-500 dark:text-[#97AECE]">
              <Heart className="w-7 h-7 text-slate-300 dark:text-[#6E89B2] mx-auto" />
              <p className="font-bold">{t('لم تضف أي أصناف إلى المفضلة بعد.', 'You have not added any products to favorites yet.')}</p>
              <button
                type="button"
                onClick={() => onTabChange('home')}
                className="h-8 px-3 rounded-md bg-[#003589] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-bold cursor-pointer"
              >
                {t('استكشاف المنتجات', 'Explore Products')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
              {favoriteProducts
                .filter((p) => {
                  const q = searchQuery.trim().toLowerCase();
                  return !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
                })
                .map((p) => renderStoreProductCard(p))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: MORE */}
      {activeTab === 'more' && (
        <CustomerMoreScreen
          allowPriceView={allowPriceView}
          ordersCount={myOrders.length}
          invoicesCount={myInvoices.length}
          favoritesCount={favoriteProducts.length}
          onOpenSection={(section) => {
            if (section === 'orders') onTabChange('orders');
            else if (section === 'favorites') onTabChange('favorites');
            else if (section === 'invoices') {
              setAccountSubTab('invoices');
              onTabChange('account');
            } else if (section === 'statement') {
              setAccountSubTab('statement');
              data.refreshCustomerStatement();
              onTabChange('account');
            }
          }}
          onOpenNotifications={() => {
            data.markNotificationsRead();
            onOpenNotifications?.();
          }}
          onOpenServerModal={() => onOpenServerModal?.()}
          onOpenSyncCenter={() => onOpenSyncCenter?.()}
          onLogout={() => {
            if (onLogout) onLogout();
            else logout();
          }}
        />
      )}

      {/* CART & CHECKOUT VIEW */}
      {activeTab === 'cart' && (
        <form onSubmit={handleSubmitOrder} className="space-y-2">
          <div className="flex items-center justify-between bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] px-2.5 py-1">
            <button
              type="button"
              onClick={() => onTabChange('home')}
              className="text-xs font-black text-[#003589] dark:text-[#85B8FF] flex items-center gap-1 cursor-pointer"
            >
              <BackArrow className="w-3.5 h-3.5" />
              <span>{t('متابعة التسوق', 'Continue Shopping')}</span>
            </button>
            <span className="text-xs font-bold text-slate-600 dark:text-[#A9BCD9] awlad-tabular">
              {formatLocaleNumber(cartTotalQty)} {t('وحدة', 'unit')} · {formatLocaleNumber(cartItems.length)} {t('صنف', 'item')}
            </span>
          </div>

          <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-[#1B2F52] flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-900 dark:text-[#F3F7FC]">
                {t('محتويات سلة الطلب', 'Cart Contents')} ({formatLocaleNumber(cartItems.length)} {t('صنف', 'items')})
              </h3>
              {allowPriceView && cartEstimatedTotal > 0 && (
                <span className="text-xs font-mono font-black text-[#011E58] dark:text-[#85B8FF] awlad-tabular">
                  {formatLocaleNumber(cartEstimatedTotal)} {data.settings.currency}
                </span>
              )}
            </div>

            {cartItems.length === 0 ? (
              <div className="py-5 text-center space-y-2 text-xs text-slate-500 dark:text-[#97AECE]">
                <ShoppingCart className="w-7 h-7 text-slate-300 dark:text-[#6E89B2] mx-auto" />
                <p>{t('السلة فارغة حالياً.', 'Your cart is currently empty.')}</p>
                <button
                  type="button"
                  onClick={() => onTabChange('categories')}
                  className="h-8 px-3.5 rounded-md bg-[#003589] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-bold cursor-pointer"
                >
                  {t('اختر الأصناف من المتجر', 'Browse Store Products')}
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-[#172E56] text-[11px] font-black text-slate-600 dark:text-[#DCE6F5] border-b border-slate-200 dark:border-[#2A436E]">
                    <tr>
                      <th className="px-2 py-1.5">{t('الصنف', 'Product')}</th>
                      <th className="px-2 py-1.5">{t('الوحدة', 'Unit')}</th>
                      <th className="px-2 py-1.5 text-center">{t('الكمية', 'Qty')}</th>
                      {allowPriceView && <th className="px-2 py-1.5 text-center">{t('الإجمالي', 'Total')}</th>}
                      <th className="px-2 py-1.5 text-center">{t('حذف', 'Remove')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                    {cartItems.map((it, idx) => (
                      <tr key={`${it.product.id}-${it.unitName}-${idx}`}>
                        <td className="px-2 py-1">
                          <span className="font-black text-slate-900 dark:text-[#F3F7FC] block">{it.product.name}</span>
                          {allowPriceView && it.unitPrice ? (
                            <span className="text-[10px] font-mono text-slate-500 dark:text-[#97AECE] awlad-tabular">
                              {formatLocaleNumber(it.unitPrice)} {data.settings.currency}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={it.unitName}
                            onChange={(e) => updateCartUnit(idx, e.target.value)}
                            className="h-7 rounded-md border border-slate-300 dark:border-[#2A436E] px-1.5 text-[11px] font-bold bg-slate-50 dark:bg-[#10203D] text-slate-900 dark:text-[#DCE6F5]"
                          >
                            {getProductUnits(it.product).map((u) => (
                              <option key={u.name} value={u.name}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-center">
                          <QuantityInput
                            showSteppers
                            allowDecimals
                            min={0.001}
                            value={it.quantity}
                            onChange={(q) => setCartQuantity(idx, q)}
                            onRemoveWhenZero={() => updateCartQuantity(idx, -it.quantity)}
                            ariaLabel={`${t('كمية', 'Quantity')} ${it.product.name}`}
                          />
                        </td>
                        {allowPriceView && (
                          <td className="px-2 py-1 text-center font-mono font-black text-[#011E58] dark:text-[#85B8FF] awlad-tabular whitespace-nowrap">
                            {it.unitPrice ? `${formatLocaleNumber(it.unitPrice * it.quantity)}` : '-'}
                          </td>
                        )}
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => updateCartQuantity(idx, -it.quantity)}
                            className="p-1 inline-flex items-center justify-center rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                            title={t('إزالة', 'Remove')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {cartItems.length > 0 && (
            <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-2.5 space-y-1.5 text-xs">
              <h4 className="font-black text-slate-900 dark:text-[#F3F7FC]">{t('بيانات الاستلام والتوصيل', 'Delivery & Contact Details')}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('اسم المحل / المستلم', 'Shop / Recipient Name')}</label>
                  <input
                    type="text"
                    value={checkoutShopName}
                    onChange={(e) => setCheckoutShopName(e.target.value)}
                    className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('رقم الهاتف للتواصل', 'Contact Phone')}</label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={checkoutPhone}
                    onChange={(e) => setCheckoutPhone(e.target.value)}
                    className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2 font-mono text-start"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('عنوان التوصيل', 'Delivery Address')}</label>
                  <input
                    type="text"
                    value={checkoutAddress}
                    onChange={(e) => setCheckoutAddress(e.target.value)}
                    className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('ملاحظات للطلب', 'Order Notes')}</label>
                  <input
                    type="text"
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder={t('مواعيد استلام مفضلة أو ملاحظات...', 'Preferred delivery times or notes...')}
                    className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="text"
                  dir="ltr"
                  value={checkoutGeo}
                  onChange={(e) => setCheckoutGeo(e.target.value)}
                  placeholder={t('إحداثيات الموقع (اختياري)', 'Location coordinates (optional)')}
                  className="flex-1 min-w-[140px] h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2 font-mono text-start"
                />
                <button
                  type="button"
                  onClick={() => setIsLocationPickerOpen(true)}
                  className="h-8 px-2.5 rounded-md bg-[#EEF3FA] dark:bg-[#132544] text-[#003589] dark:text-[#85B8FF] border border-[#DCE6F5] dark:border-[#2A436E] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{t('الخريطة', 'Map')}</span>
                </button>
                <button
                  type="button"
                  disabled={isLocating}
                  onClick={handleCaptureLocation}
                  className="h-8 px-2.5 rounded-md bg-slate-100 dark:bg-[#132544] text-slate-800 dark:text-[#DCE6F5] border border-slate-200 dark:border-[#21375C] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{isLocating ? t('تحديد...', 'Locating...') : 'GPS'}</span>
                </button>
              </div>

              {allowPriceView && cartEstimatedTotal > 0 && (
                <div className="px-2.5 py-1.5 rounded-md bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#2A436E] flex items-center justify-between font-black text-[#011E58] dark:text-[#85B8FF] awlad-tabular">
                  <span>{t('الإجمالي التقديري:', 'Estimated Total:')}</span>
                  <span className="font-mono text-sm">
                    {formatLocaleNumber(cartEstimatedTotal)} {data.settings.currency}
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#011E58] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white text-xs font-black disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? t('جاري إرسال الطلب...', 'Submitting order...') : t('تأكيد وإرسال الطلب للإدارة', 'Confirm & Send Order')}
              </button>
            </div>
          )}
        </form>
      )}

      {/* ORDERS LIFECYCLE VIEW */}
      {activeTab === 'orders' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] px-2.5 py-1">
            <button
              type="button"
              onClick={() => onTabChange('more')}
              className="text-xs font-black text-[#003589] dark:text-[#85B8FF] flex items-center gap-1 cursor-pointer"
            >
              <BackArrow className="w-3.5 h-3.5" />
              <span>{t('رجوع إلى المزيد', 'Back to More')}</span>
            </button>
            <span className="text-xs font-black text-slate-900 dark:text-[#F3F7FC]">{t('طلباتي', 'My Orders')} ({formatLocaleNumber(myOrders.length)})</span>
          </div>

          {myOrders.length === 0 ? (
            <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-3 text-center text-xs text-slate-500 dark:text-[#97AECE]">
              {t('لا توجد طلبات مسجلة حتى الآن.', 'No orders recorded yet.')}
            </div>
          ) : (
            <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] overflow-x-auto">
              <table className="w-full text-start text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-[#172E56] text-[11px] font-black text-slate-600 dark:text-[#DCE6F5] border-b border-slate-200 dark:border-[#2A436E]">
                  <tr>
                    <th className="px-2 py-1.5">{t('رقم الطلب', 'Order #')}</th>
                    <th className="px-2 py-1.5">{t('التاريخ', 'Date')}</th>
                    <th className="px-2 py-1.5 text-center">{t('الأصناف', 'Items')}</th>
                    {allowPriceView && <th className="px-2 py-1.5 text-center">{t('الإجمالي', 'Total')}</th>}
                    <th className="px-2 py-1.5 text-center">{t('الحالة', 'Status')}</th>
                    <th className="px-2 py-1.5 text-center">{t('المندوب / المزامنة', 'Rep / Sync')}</th>
                    <th className="px-2 py-1.5 text-center">{t('إجراءات', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                  {myOrders.map((ord) => {
                    const isExpanded = expandedHistoryId === ord.id;
                    const orderTotal = Number(ord.invoiceTotal ?? ord.totalAmount ?? 0);
                    return (
                      <React.Fragment key={ord.id}>
                        <tr className="hover:bg-slate-50/70 dark:hover:bg-[#1A3461]">
                          <td className="px-2 py-1 font-mono font-black text-[#011E58] dark:text-[#85B8FF] whitespace-nowrap">
                            {ord.requestNumber}
                          </td>
                          <td className="px-2 py-1 font-mono text-[11px] text-slate-500 dark:text-[#97AECE] whitespace-nowrap">
                            {formatLocaleDate(ord.createdAt)}
                          </td>
                          <td className="px-2 py-1 text-center font-mono awlad-tabular whitespace-nowrap">
                            {formatLocaleNumber(ord.items?.length || 0)}
                          </td>
                          {allowPriceView && (
                            <td className="px-2 py-1 text-center font-mono font-bold text-slate-900 dark:text-[#F3F7FC] awlad-tabular whitespace-nowrap">
                              {orderTotal > 0 ? `${formatLocaleNumber(orderTotal)} ${data.settings.currency}` : '—'}
                            </td>
                          )}
                          <td className="px-2 py-1 text-center whitespace-nowrap">
                            <span
                              className={`font-bold text-[11px] ${
                                ord.status === 'invoiced' || ord.status === 'approved' || ord.status === 'delivered'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : ord.status === 'rejected' || ord.status === 'needs_review'
                                  ? 'text-red-700 dark:text-red-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {ord.status === 'invoiced'
                                ? t(`تم التحويل لفاتورة (${ord.invoiceNumber || ''})`, `Converted to Invoice (${ord.invoiceNumber || ''})`)
                                : t(CUSTOMER_ORDER_STATUS_LABELS[ord.status] || ord.status, CUSTOMER_ORDER_STATUS_LABELS_EN[ord.status] || ord.status)}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-center whitespace-nowrap">
                            <div className="inline-flex flex-col items-center gap-0.5">
                              {ord.deliveryRepName && (
                                <span className="text-[10px] font-bold text-[#003589] dark:text-[#85B8FF] flex items-center gap-0.5">
                                  <Truck className="w-3 h-3" />
                                  {ord.deliveryRepName}
                                </span>
                              )}
                              {ord.syncStatus && ord.syncStatus !== 'synced' ? (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50">
                                  <CloudOff className="w-2.5 h-2.5" />
                                  <span>{t('محلي', 'Local')}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
                                  <CloudCheck className="w-2.5 h-2.5" />
                                  <span>{t('معتمد', 'Synced')}</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setExpandedHistoryId(isExpanded ? null : ord.id)}
                                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#132544] border border-transparent dark:border-[#21375C] text-slate-700 dark:text-[#DCE6F5] font-bold inline-flex items-center gap-1 cursor-pointer text-[11px]"
                              >
                                <History className="w-3 h-3" />
                                <span>{isExpanded ? t('إخفاء', 'Hide') : t('التفاصيل', 'Details')}</span>
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReorder(ord)}
                                className="px-2 py-0.5 rounded-md bg-[#003589] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-bold cursor-pointer text-[11px]"
                              >
                                {t('إعادة الطلب', 'Reorder')}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-slate-50/80 dark:bg-[#12223E]">
                            <td colSpan={allowPriceView ? 7 : 6} className="p-2.5 space-y-2">
                              {ord.rejectionReason && (
                                <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-300 font-bold text-[11px]">
                                  {t('سبب الرفض:', 'Rejection reason:')} {ord.rejectionReason}
                                </div>
                              )}

                              {ord.status !== 'rejected' && ord.status !== 'cancelled' && (
                                <div className="bg-white dark:bg-[#0E1C36] rounded-lg p-2 border border-slate-200 dark:border-[#21375C]">
                                  <p className="text-[10px] font-bold text-slate-500 dark:text-[#97AECE] mb-1.5">{t('مسار الطلب (9 مراحل):', 'Order Timeline (9 Stages):')}</p>
                                  <div className="grid grid-cols-9 gap-1 text-center">
                                    {NINE_STAGE_TIMELINE.map((st, idx) => {
                                      const effectiveStatus = ord.status === 'rep_assigned' ? 'preparing' : ord.status;
                                      const currentIdx = NINE_STAGE_TIMELINE.findIndex((s) => s.key === effectiveStatus);
                                      const reached = currentIdx >= idx;
                                      return (
                                        <div key={st.key} className="flex flex-col items-center gap-0.5">
                                          <div className={`w-full h-1.5 rounded ${reached ? 'bg-[#003589] dark:bg-[#1659C8]' : 'bg-slate-200 dark:bg-[#2A436E]'}`} />
                                          <span className={`text-[9px] leading-tight truncate max-w-full ${reached ? 'font-black text-[#011E58] dark:text-[#85B8FF]' : 'text-slate-400 dark:text-[#849BBF]'}`}>
                                            {t(st.label, st.labelEn)}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] overflow-hidden">
                                <table className="w-full text-start text-[11px]">
                                  <thead className="bg-slate-50 dark:bg-[#172E56] text-slate-500 dark:text-[#DCE6F5] font-bold border-b border-slate-200 dark:border-[#2A436E]">
                                    <tr>
                                      <th className="px-2 py-1">{t('الصنف', 'Product')}</th>
                                      <th className="px-2 py-1 text-center">{t('الكمية', 'Qty')}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                                    {(ord.items || []).map((it, i) => (
                                      <tr key={i}>
                                        <td className="px-2 py-1">
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-bold text-slate-800 dark:text-[#DCE6F5]">{it.productName}</span>
                                          </div>
                                        </td>
                                        <td className="px-2 py-1 text-center font-mono text-slate-600 dark:text-[#A9BCD9] whitespace-nowrap">
                                          {formatLocaleNumber(it.quantity)} {it.unit}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {allowPriceView && Number(ord.advancePaidAmount || 0) > 0 && (
                                <div className="flex items-center justify-between text-[11px] text-emerald-700 dark:text-emerald-400 font-bold px-1">
                                  <span className="inline-flex items-center gap-1"><Wallet className="w-3 h-3" /> {t('دفعة مقدمة مسددة:', 'Advance payment paid:')}</span>
                                  <span className="font-mono awlad-tabular">
                                    {formatLocaleNumber(Number(ord.advancePaidAmount))} {data.settings.currency}
                                  </span>
                                </div>
                              )}

                              {ord.statusHistory && ord.statusHistory.length > 0 && (
                                <div className="border-t border-slate-200 dark:border-[#21375C] pt-1.5 space-y-1 text-[10px] text-slate-600 dark:text-[#A9BCD9]">
                                  {ord.statusHistory.map((h) => (
                                    <div key={h.id} className="flex items-center justify-between">
                                      <span>
                                        {t(CUSTOMER_ORDER_STATUS_LABELS[h.toStatus] || h.toStatus, CUSTOMER_ORDER_STATUS_LABELS_EN[h.toStatus] || h.toStatus)}
                                        {h.reason ? ` — ${h.reason}` : ''}
                                      </span>
                                      <span className="font-mono text-slate-400 dark:text-[#849BBF]">
                                        {formatLocaleDateTime(h.changedAt)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ACCOUNT & INVOICES & STATEMENT VIEW */}
      {activeTab === 'account' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] px-2.5 py-1">
            <button
              type="button"
              onClick={() => onTabChange('more')}
              className="text-xs font-black text-[#003589] dark:text-[#85B8FF] flex items-center gap-1 cursor-pointer"
            >
              <BackArrow className="w-3.5 h-3.5" />
              <span>{t('رجوع إلى المزيد', 'Back to More')}</span>
            </button>
            <span className="text-xs font-black text-slate-900 dark:text-[#F3F7FC]">{t('الفواتير وكشف الحساب', 'Invoices & Statement')}</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 bg-white dark:bg-[#0E1C36] p-1 rounded-lg border border-slate-200 dark:border-[#21375C]">
            <button
              type="button"
              onClick={() => setAccountSubTab('invoices')}
              className={`h-8 rounded-md text-xs font-black cursor-pointer ${
                accountSubTab === 'invoices' ? 'bg-[#003589] dark:bg-[#1659C8] text-white' : 'text-slate-600 dark:text-[#A9BCD9]'
              }`}
            >
              {t('فواتيري', 'My Invoices')} ({formatLocaleNumber(myInvoices.length)})
            </button>
            <button
              type="button"
              onClick={() => {
                setAccountSubTab('statement');
                data.refreshCustomerStatement();
              }}
              className={`h-8 rounded-md text-xs font-black cursor-pointer ${
                accountSubTab === 'statement' ? 'bg-[#003589] dark:bg-[#1659C8] text-white' : 'text-slate-600 dark:text-[#A9BCD9]'
              }`}
            >
              {t('كشف الحساب التفصيلي', 'Detailed Account Statement')}
            </button>
          </div>

          {!allowPriceView && (
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-xs font-bold text-amber-900 dark:text-amber-300">
              {t(
                'عرض المبالغ والأسعار مخفي وفق إعدادات الإدارة — يتم عرض أرقام المستندات والكميات فقط.',
                'Amounts and prices are hidden per management settings — only document numbers and quantities are shown.'
              )}
            </div>
          )}

          {accountSubTab === 'invoices' && (
            <div>
              {myInvoices.length === 0 ? (
                <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-3 text-center text-xs text-slate-500 dark:text-[#97AECE]">
                  {t('لا توجد فواتير مبيعات معتمدة حتى الآن.', 'No approved sales invoices yet.')}
                </div>
              ) : (
                <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] overflow-x-auto">
                  <table className="w-full text-start text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-[#172E56] text-[11px] font-black text-slate-600 dark:text-[#DCE6F5] border-b border-slate-200 dark:border-[#2A436E]">
                      <tr>
                        <th className="px-2 py-1.5">{t('رقم الفاتورة', 'Invoice #')}</th>
                        <th className="px-2 py-1.5">{t('التاريخ', 'Date')}</th>
                        {allowPriceView && (
                          <>
                            <th className="px-2 py-1.5 text-center">{t('الإجمالي', 'Total')}</th>
                            <th className="px-2 py-1.5 text-center">{t('المدفوع', 'Paid')}</th>
                            <th className="px-2 py-1.5 text-center">{t('المتبقي', 'Remaining')}</th>
                          </>
                        )}
                        <th className="px-2 py-1.5 text-center">{t('الإجراءات', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                      {myInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-[#1A3461]">
                          <td className="px-2 py-1 font-mono font-black text-[#011E58] dark:text-[#85B8FF] whitespace-nowrap">
                            {inv.invoiceNumber}
                          </td>
                          <td className="px-2 py-1 font-mono text-[11px] text-slate-500 dark:text-[#97AECE] whitespace-nowrap">
                            {inv.date}
                          </td>
                          {allowPriceView && (
                            <>
                              <td className="px-2 py-1 text-center font-mono font-bold text-slate-900 dark:text-[#F3F7FC] awlad-tabular whitespace-nowrap">
                                {formatLocaleNumber(inv.grandTotal)} {data.settings.currency}
                              </td>
                              <td className="px-2 py-1 text-center font-mono text-slate-600 dark:text-[#A9BCD9] awlad-tabular whitespace-nowrap">
                                {formatLocaleNumber(inv.paidAmount)}
                              </td>
                              <td className={`px-2 py-1 text-center font-mono font-bold awlad-tabular whitespace-nowrap ${inv.remainingAmount > 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                                {formatLocaleNumber(inv.remainingAmount)}
                              </td>
                            </>
                          )}
                          <td className="px-2 py-1 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedInvoice(inv)}
                                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#132544] hover:bg-slate-200 dark:hover:bg-[#1A3461] text-slate-800 dark:text-[#DCE6F5] font-bold cursor-pointer text-[11px]"
                              >
                                {t('الأصناف', 'Items')}
                              </button>
                              <button
                                type="button"
                                onClick={() => exportInvoiceDocument(inv)}
                                className="px-2 py-0.5 rounded-md bg-[#003589] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-bold inline-flex items-center gap-1 cursor-pointer text-[11px]"
                              >
                                {isNative ? <Share2 className="w-3 h-3" /> : <FileDown className="w-3 h-3" />}
                                <span>{isNative ? t('مشاركة', 'Share') : 'PDF'}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {accountSubTab === 'statement' && (
            <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-2.5 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-black text-slate-900 dark:text-[#F3F7FC]">{t('حركة الحساب', 'Account Statement')}</h4>
                <button
                  type="button"
                  onClick={exportStatementExcel}
                  className="h-8 px-2.5 rounded-md bg-[#003589] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-bold flex items-center gap-1.5 cursor-pointer text-[11px]"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>{isNative ? t('مشاركة CSV', 'Share CSV') : t('تصدير Excel', 'Export Excel')}</span>
                </button>
              </div>

              {allowPriceView && data.customerStatement?.summary && (
                <div className="grid grid-cols-3 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-md overflow-hidden text-center">
                  <div className="bg-white dark:bg-[#132544] px-2 py-1.5">
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('إجمالي مدين', 'Total Debit')}</span>
                    <strong className="font-mono text-xs text-red-700 dark:text-red-400 awlad-tabular">
                      {formatLocaleNumber(data.customerStatement.summary.totalDebit || 0)}
                    </strong>
                  </div>
                  <div className="bg-white dark:bg-[#132544] px-2 py-1.5">
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('إجمالي دائن', 'Total Credit')}</span>
                    <strong className="font-mono text-xs text-emerald-700 dark:text-emerald-400 awlad-tabular">
                      {formatLocaleNumber(data.customerStatement.summary.totalCredit || 0)}
                    </strong>
                  </div>
                  <div className="bg-white dark:bg-[#132544] px-2 py-1.5">
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الصافي الحالي', 'Current Balance')}</span>
                    <strong className="font-mono text-xs text-[#011E58] dark:text-[#85B8FF] awlad-tabular">
                      {formatLocaleNumber(data.customerStatement.summary.currentBalance || 0)}
                    </strong>
                  </div>
                </div>
              )}

              {(data.customerStatement?.entries || []).length === 0 ? (
                <p className="text-center text-slate-400 dark:text-[#849BBF] py-4">{t('لا توجد حركات مسجلة في كشف الحساب.', 'No transactions recorded in account statement.')}</p>
              ) : (
                <div className="overflow-x-auto border border-slate-200 dark:border-[#21375C] rounded-md">
                  <table className="w-full text-start text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-[#172E56] text-[11px] font-black text-slate-600 dark:text-[#DCE6F5] border-b border-slate-200 dark:border-[#2A436E]">
                      <tr>
                        <th className="px-2 py-1.5">{t('التاريخ / المستند', 'Date / Doc')}</th>
                        <th className="px-2 py-1.5">{t('البيان', 'Description')}</th>
                        {allowPriceView && (
                          <>
                            <th className="px-2 py-1.5 text-center">{t('مدين', 'Debit')}</th>
                            <th className="px-2 py-1.5 text-center">{t('دائن', 'Credit')}</th>
                            <th className="px-2 py-1.5 text-center">{t('الرصيد', 'Balance')}</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                      {data.customerStatement!.entries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-slate-50/70 dark:hover:bg-[#1A3461]">
                          <td className="px-2 py-1 whitespace-nowrap">
                            <span className="font-bold text-slate-900 dark:text-[#F3F7FC] block">{t(entry.label)}</span>
                            <span className="font-mono text-[10px] text-slate-500 dark:text-[#97AECE]">{entry.docNumber} · {entry.date}</span>
                          </td>
                          <td className="px-2 py-1 text-[11px] text-slate-600 dark:text-[#A9BCD9]">
                            {entry.description ? t(entry.description) : ''}
                          </td>
                          {allowPriceView && (
                            <>
                              <td className="px-2 py-1 text-center font-mono text-red-700 dark:text-red-400 awlad-tabular whitespace-nowrap">
                                {entry.debit ? formatLocaleNumber(entry.debit) : '—'}
                              </td>
                              <td className="px-2 py-1 text-center font-mono text-emerald-700 dark:text-emerald-400 awlad-tabular whitespace-nowrap">
                                {entry.credit ? formatLocaleNumber(entry.credit) : '—'}
                              </td>
                              <td className="px-2 py-1 text-center font-mono font-black text-[#011E58] dark:text-[#85B8FF] awlad-tabular whitespace-nowrap">
                                {formatLocaleNumber(entry.runningBalance ?? 0)}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating Brand Cart FAB */}
      {activeTab !== 'cart' && (
        <button
          type="button"
          onClick={() => onTabChange('cart')}
          className="fixed bottom-16 end-3 z-30 min-h-[38px] px-3 rounded-lg bg-[#003589] hover:bg-[#011E58] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white shadow-lg border border-white/20 dark:border-[#60A5FA]/40 flex items-center gap-2 cursor-pointer transition-transform active:scale-95"
          aria-label={t('سلة التسوق', 'Shopping Cart')}
        >
          <div className="relative">
            <ShoppingCart className="w-4 h-4" />
            {cartItems.length > 0 && (
              <span className="absolute -top-1.5 -end-2 min-w-[15px] h-[15px] px-1 rounded bg-[#C81E1E] text-white text-[9px] font-black flex items-center justify-center awlad-tabular">
                {formatLocaleNumber(cartItems.length)}
              </span>
            )}
          </div>
          <div className="text-start">
            <span className="block text-[11px] font-black leading-none">{t('السلة', 'Cart')}</span>
            {allowPriceView && cartEstimatedTotal > 0 && (
              <span className="block text-[10px] text-[#DCE6F5] awlad-tabular mt-0.5">
                {formatLocaleNumber(cartEstimatedTotal)} {data.settings.currency}
              </span>
            )}
          </div>
        </button>
      )}

      {/* Invoice Details Sheet */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-[#0E1C36] rounded-t-lg sm:rounded-lg p-2.5 shadow-xl border border-slate-200 dark:border-[#21375C] max-h-[82vh] flex flex-col gap-2 text-xs pb-safe">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#1B2F52] pb-1.5">
              <div>
                <h4 className="font-black text-xs sm:text-sm text-slate-900 dark:text-[#F3F7FC]">
                  {t('تفاصيل الفاتورة', 'Invoice Details')} {selectedInvoice.invoiceNumber}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-[#97AECE] font-mono">{selectedInvoice.date}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="h-8 px-2.5 rounded-md bg-slate-100 dark:bg-[#132544] font-bold text-slate-700 dark:text-[#DCE6F5] cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto border border-slate-200 dark:border-[#21375C] rounded-md">
              <table className="w-full text-start text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-[#172E56] text-[11px] font-black text-slate-600 dark:text-[#DCE6F5] border-b border-slate-200 dark:border-[#2A436E]">
                  <tr>
                    <th className="px-2 py-1.5">{t('الصنف', 'Product')}</th>
                    <th className="px-2 py-1.5 text-center">{t('الكمية', 'Qty')}</th>
                    {allowPriceView && (
                      <>
                        <th className="px-2 py-1.5 text-center">{t('السعر', 'Price')}</th>
                        <th className="px-2 py-1.5 text-center">{t('الإجمالي', 'Total')}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                  {(selectedInvoice.items || []).map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1 font-bold text-slate-900 dark:text-[#F3F7FC]">{it.productName}</td>
                      <td className="px-2 py-1 text-center font-mono text-slate-600 dark:text-[#A9BCD9] whitespace-nowrap">
                        {formatLocaleNumber(it.quantity)} {it.unit}
                      </td>
                      {allowPriceView && (
                        <>
                          <td className="px-2 py-1 text-center font-mono text-slate-600 dark:text-[#A9BCD9] awlad-tabular whitespace-nowrap">
                            {formatLocaleNumber(it.unitPrice)}
                          </td>
                          <td className="px-2 py-1 text-center font-mono font-black text-[#011E58] dark:text-[#85B8FF] awlad-tabular whitespace-nowrap">
                            {formatLocaleNumber(it.total)} {data.settings.currency}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => exportInvoiceDocument(selectedInvoice)}
              className="h-9 rounded-lg bg-[#003589] hover:bg-[#011E58] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-black flex items-center justify-center gap-2 cursor-pointer"
            >
              {isNative ? <Share2 className="w-4 h-4" /> : <FileDown className="w-4 h-4" />}
              <span>{isNative ? t('مشاركة / حفظ الفاتورة', 'Share / Save Invoice') : t('طباعة / PDF', 'Print / PDF')}</span>
            </button>
          </div>
        </div>
      )}

      <QrScannerModal
        isOpen={isBarcodeScannerOpen}
        mode="barcode"
        onClose={() => setIsBarcodeScannerOpen(false)}
        onDetected={(rawText) => {
          setIsBarcodeScannerOpen(false);
          setSearchQuery(rawText.trim());
        }}
      />

      <CustomerLocationPickerModal
        isOpen={isLocationPickerOpen}
        onClose={() => setIsLocationPickerOpen(false)}
        onConfirm={(loc) => {
          setCheckoutLat(loc.latitude);
          setCheckoutLng(loc.longitude);
          setCheckoutGeo(loc.geoCoordinates);
          if (loc.address) setCheckoutAddress(loc.address);
          setFeedback({ type: 'success', text: t('تم تحديد موقع التوصيل على الخريطة.', 'Delivery location selected on map.') });
        }}
        initialLat={checkoutLat}
        initialLng={checkoutLng}
        initialGeoCoordinates={checkoutGeo}
        initialAddress={checkoutAddress}
        title={t('تحديد موقع التوصيل على الخريطة', 'Select Delivery Location on Map')}
      />
    </div>
  );
};

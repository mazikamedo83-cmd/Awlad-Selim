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
  X,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
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

const NINE_STAGE_TIMELINE: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'جديد' },
  { key: 'under_review', label: 'مراجعة' },
  { key: 'approved', label: 'معتمد' },
  { key: 'invoiced', label: 'فوترة' },
  { key: 'preparing', label: 'تجهيز' },
  { key: 'out_for_delivery', label: 'توصيل' },
  { key: 'delivered', label: 'تسليم' },
  { key: 'collected', label: 'تحصيل' },
  { key: 'closed', label: 'إغلاق' },
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
  const { t } = usePreferences();
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
      setFeedback({ type: 'error', text: `الصنف (${prod.name}) غير متوفر بالمخزون حالياً.` });
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
    setFeedback({ type: 'success', text: `تمت إضافة (${prod.name} — ${safeQty} ${unitMeta.name}) إلى السلة` });
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
      setFeedback({ type: 'success', text: 'تم تحديد الموقع الجغرافي (GPS) بنجاح' });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر تحديد الموقع الجغرافي' });
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cartItems.length) return;

    setIsSubmitting(true);
    setFeedback(null);
    const res = await data.createCustomerItemOrder({
      customerId: customer?.id || '',
      customerName: customer?.name || currentUser?.fullName || 'عميل',
      customerPhone: checkoutPhone.trim() || customer?.phone,
      shopName: checkoutShopName.trim() || customer?.shopName || customer?.name,
      deliveryAddress: checkoutAddress.trim() || customer?.address,
      geoCoordinates: checkoutGeo.trim() || customer?.geoCoordinates,
      items: cartItems.map((it) => ({
        productId: it.product.id,
        productCode: it.product.code,
        productName: it.product.name,
        productImage: it.product.image,
        unit: it.unitName,
        unitFactor: it.unitFactor,
        unitPrice: it.unitPrice ?? undefined,
        quantity: it.quantity,
      })),
      notes: orderNotes.trim() || 'طلب أصناف من تطبيق الموبايل',
      idempotencyKey: idempotencyKeyRef.current,
    });
    setIsSubmitting(false);

    if (res.queuedOffline) {
      setCartItems([]);
      setOrderNotes('');
      rotateIdempotencyKey();
      setFeedback({
        type: 'warning',
        text: `تم حفظ الطلب محلياً في طابور المزامنة (${res.order?.requestNumber || ''}) وسيتم إرساله تلقائياً فور عودة الاتصال.`,
      });
      onTabChange('orders');
    } else if (res.success) {
      setCartItems([]);
      setOrderNotes('');
      rotateIdempotencyKey();
      setFeedback({
        type: 'success',
        text: `تم إرسال الطلب رقم ${res.order?.requestNumber || ''} بنجاح وسيتم مراجعته من الإدارة.`,
      });
      onTabChange('orders');
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر إرسال الطلب للسيرفر' });
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
      setFeedback({ type: 'error', text: 'الأصناف في هذا الطلب لم تعد متاحة حالياً.' });
      return;
    }
    rotateIdempotencyKey();
    setCartItems(mapped);
    setFeedback({ type: 'success', text: 'تم نسخ أصناف الطلب إلى السلة — يمكنك تعديل الكميات والإرسال.' });
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
      title: 'فاتورة مبيعات',
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
        { label: 'العميل', value: customer?.name || inv.customerName || '-' },
        { label: 'طريقة السداد', value: inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'credit' ? 'آجل' : 'سداد جزئي' },
      ],
      tableHeaders: allowPriceView
        ? ['م', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الإجمالي']
        : ['م', 'الصنف', 'الوحدة', 'الكمية'],
      tableRows: (inv.items || []).map((it, idx) =>
        allowPriceView
          ? [idx + 1, it.productName, it.unit, it.quantity, it.unitPrice.toFixed(2), it.total.toFixed(2)]
          : [idx + 1, it.productName, it.unit, it.quantity]
      ),
      summaryPairs: allowPriceView
        ? [
            { label: 'الصافي الإجمالي', value: `${inv.grandTotal.toFixed(2)} ${data.settings.currency}`, highlight: true },
            { label: 'المدفوع', value: `${inv.paidAmount.toFixed(2)} ${data.settings.currency}` },
            { label: 'المتبقي', value: `${inv.remainingAmount.toFixed(2)} ${data.settings.currency}` },
          ]
        : [],
      notes: inv.notes,
    });
  };

  const exportStatementExcel = () => {
    const entries = data.customerStatement?.entries || [];
    exportToExcel(
      `كشف_حساب_${customer?.name || 'العميل'}`,
      allowPriceView
        ? ['التاريخ', 'رقم المستند', 'البيان', 'مدين', 'دائن', 'الرصيد']
        : ['التاريخ', 'رقم المستند', 'البيان'],
      entries.map((row) =>
        allowPriceView
          ? [row.date, row.docNumber, row.description, row.debit ?? 0, row.credit ?? 0, row.runningBalance ?? 0]
          : [row.date, row.docNumber, row.description]
      )
    );
  };

  if (mobileConfig.enableCustomerApp === false) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-amber-200 dark:border-amber-800 p-8 text-center space-y-3 shadow-xs">
        <ShieldAlert className="w-12 h-12 text-amber-600 mx-auto" />
        <h3 className="text-base font-black text-slate-900 dark:text-slate-100">بوابة العملاء متوقفة مؤقتاً</h3>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          تم إيقاف استقبال طلبات العملاء عبر تطبيق الموبايل مؤقتاً من إعدادات الإدارة. يرجى التواصل مع مؤسسة أولاد سليم.
        </p>
        <button
          type="button"
          onClick={() => data.triggerManualSync()}
          className="min-h-[44px] px-5 rounded-xl bg-[#0F5A33] text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>إعادة التحقق</span>
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
    const thumb = data.cachedMediaMap?.[prod.id] || prod.image;

    return (
      <div
        key={`${prod.id}-${activeUnit}`}
        className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-2.5 shadow-2xs flex flex-col justify-between gap-2"
      >
        {promo.hasPromo && (
          <div className="absolute top-2 right-2 z-10 bg-[#C81E1E] text-white text-[10px] font-black px-2 py-0.5 rounded-md">
            {promo.badgeText || 'عرض عشانك'}
          </div>
        )}

        <button
          type="button"
          onClick={() => data.toggleCustomerFavorite(prod.id)}
          aria-label={isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
          className={`absolute top-2 left-2 z-10 w-8 h-8 rounded-lg flex items-center justify-center border cursor-pointer ${
            isFav
              ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-[#C81E1E]'
              : 'bg-white/90 dark:bg-slate-800/90 border-slate-200 dark:border-slate-700 text-slate-400'
          }`}
        >
          <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
        </button>

        <div className="w-full aspect-square rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 flex items-center justify-center">
          {thumb ? (
            <img src={thumb} alt={prod.name} className="w-full h-full object-contain p-1.5" loading="lazy" />
          ) : (
            <Package className="w-10 h-10 text-slate-300 dark:text-slate-600" />
          )}
        </div>

        <div className="space-y-1 flex-1 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-black text-slate-900 dark:text-slate-100 line-clamp-2 leading-snug min-h-[2.1rem]">
              {prod.name}
            </h3>
            <div className="flex items-center justify-between gap-1 mt-1">
              {units.length > 1 ? (
                <select
                  value={activeUnit}
                  onChange={(e) =>
                    setSelectedUnitsByProd((prev) => ({ ...prev, [prod.id]: e.target.value }))
                  }
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none"
                >
                  {units.map((u) => (
                    <option key={u.name} value={u.name}>
                      {u.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {activeUnit}
                </span>
              )}
              {!available && <span className="text-[10px] font-bold text-red-600">غير متاح</span>}
            </div>
          </div>

          {allowPriceView ? (
            <div className="pt-1 flex items-baseline flex-wrap gap-1.5 awlad-tabular">
              <strong className="text-sm font-black text-[#0F5A33] dark:text-emerald-400">
                {effectivePrice !== null ? `${effectivePrice.toLocaleString()} ${data.settings.currency}` : 'حسب التسعير'}
              </strong>
              {promo.hasPromo && (
                <span className="text-[11px] font-bold text-slate-400 line-through">
                  {promo.regularPrice.toLocaleString()}
                </span>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-slate-400 pt-1">السعر عند الاعتماد</p>
          )}

          {cartEntry ? (
            <div className="flex items-center justify-between gap-1 bg-emerald-50 dark:bg-emerald-950/60 border border-[#0F5A33]/30 rounded-xl p-1">
              <button
                type="button"
                onClick={() => handleUpdateCartByKey(prod.id, activeUnit, 1)}
                className="w-8 h-8 rounded-lg bg-[#0F5A33] text-white flex items-center justify-center cursor-pointer"
                aria-label="زيادة الكمية"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-black text-[#0F5A33] dark:text-emerald-300 awlad-tabular">
                {cartEntry.quantity}
              </span>
              <button
                type="button"
                onClick={() => handleUpdateCartByKey(prod.id, activeUnit, -1)}
                className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
                aria-label="تقليل الكمية"
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
              className="w-full min-h-[38px] rounded-xl bg-[#0F5A33] hover:bg-[#0B4426] disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
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
    <div className="space-y-4">
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
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-1.5 shadow-2xs">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('بتدور علي منتج معين؟', 'Looking for a product?')}
              className="w-full min-h-[40px] pr-9 pl-8 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-[#0F5A33]/30"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="مسح البحث"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsBarcodeScannerOpen(true)}
            className="min-h-[40px] min-w-[42px] px-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[#0F5A33] dark:text-emerald-300 flex items-center justify-center cursor-pointer shrink-0"
            title="بحث بالباركود"
            aria-label="بحث بالباركود"
          >
            <Barcode className="w-5 h-5" />
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
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
        <div className="space-y-3">
          <div className="flex items-center justify-between px-0.5 text-xs">
            <h2 className="font-black text-slate-900 dark:text-slate-100">
              نتائج البحث ({filteredProducts.length})
            </h2>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="font-bold text-[#0F5A33] dark:text-emerald-400 cursor-pointer"
            >
              إلغاء البحث
            </button>
          </div>
          {filteredProducts.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center text-xs text-slate-500">
              لا توجد أصناف مطابقة لبحثك "{searchQuery}".
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
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
          cachedMediaMap={data.cachedMediaMap || {}}
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
        <div className="space-y-4">
          {imageCategoryTiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-0.5">
                <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">
                  {t('الأقسام المصورة', 'Categories')}
                </h2>
                {(selectedCategory !== 'all' || selectedDisplayProductIds) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('all');
                      setSelectedDisplayProductIds(null);
                    }}
                    className="text-xs font-black text-[#0F5A33] dark:text-emerald-400 cursor-pointer"
                  >
                    عرض جميع الأصناف
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('all');
                    setSelectedDisplayProductIds(null);
                  }}
                  className={`rounded-2xl border p-2 flex flex-col items-center justify-center gap-1.5 text-center cursor-pointer transition-colors ${
                    selectedCategory === 'all' && !selectedDisplayProductIds
                      ? 'bg-[#0F5A33] text-white border-[#0F5A33]'
                      : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <LayoutGrid className="w-6 h-6" />
                  <span className="text-[11px] font-black">الكل ({activeProducts.length})</span>
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
                      className={`rounded-2xl border p-2 flex flex-col items-center justify-between gap-1.5 text-center cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-[#0F5A33] ring-2 ring-[#0F5A33]/25 bg-emerald-50/70 dark:bg-emerald-950/40'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="w-full aspect-square rounded-xl bg-slate-50 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                        {tile.imageUrl ? (
                          <img src={tile.imageUrl} alt={tile.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <LayoutGrid className="w-6 h-6 text-[#0F5A33]/70 dark:text-emerald-400" />
                        )}
                      </div>
                      <span className="text-[11px] font-black text-slate-800 dark:text-slate-200 line-clamp-2 leading-tight">
                        {tile.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 px-0.5">
              {selectedCategory === 'all' ? 'جميع المنتجات' : selectedCategory} ({filteredProducts.length})
            </h3>
            {filteredProducts.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center text-xs text-slate-500">
                لا توجد أصناف مطابقة في هذا القسم.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {filteredProducts.map((p) => renderStoreProductCard(p))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: OFFERS */}
      {activeTab === 'offers' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-0.5">
            <Tag className="w-4 h-4 text-[#C81E1E]" />
            <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">
              {storefront?.offersSectionTitle || t('العروض والخصومات الحالية', 'Active Offers')}
            </h2>
          </div>

          {offerItems.filter(({ product }) => {
            const q = searchQuery.trim().toLowerCase();
            return !q || product.name.toLowerCase().includes(q) || product.code.toLowerCase().includes(q);
          }).length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-2 text-xs text-slate-500">
              <Tag className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="font-bold">لا توجد عروض نشطة حالياً — يمكنك تصفح الأقسام والمنتجات.</p>
              <button
                type="button"
                onClick={() => onTabChange('categories')}
                className="min-h-[40px] px-4 rounded-xl bg-[#0F5A33] text-white font-bold cursor-pointer"
              >
                تصفح الأقسام
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
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
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-0.5">
            <Heart className="w-4 h-4 text-[#C81E1E] fill-current" />
            <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">
              {t('المنتجات المفضلة', 'My Favorites')} ({favoriteProducts.length})
            </h2>
          </div>

          {favoriteProducts.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-2 text-xs text-slate-500">
              <Heart className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="font-bold">لم تضف أي أصناف إلى المفضلة بعد.</p>
              <button
                type="button"
                onClick={() => onTabChange('home')}
                className="min-h-[40px] px-4 rounded-xl bg-[#0F5A33] text-white font-bold cursor-pointer"
              >
                استكشاف المنتجات
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
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
        <form onSubmit={handleSubmitOrder} className="space-y-4">
          <div className="flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2">
            <button
              type="button"
              onClick={() => onTabChange('home')}
              className="text-xs font-black text-[#0F5A33] dark:text-emerald-400 flex items-center gap-1 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>متابعة التسوق</span>
            </button>
            <span className="text-xs font-bold text-slate-500 awlad-tabular">{cartTotalQty} وحدة</span>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
            <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
              محتويات سلة الطلب ({cartTotalQty} وحدة)
            </h3>

            {cartItems.length === 0 ? (
              <div className="py-8 text-center space-y-3 text-xs text-slate-500">
                <ShoppingCart className="w-10 h-10 text-slate-300 mx-auto" />
                <p>السلة فارغة حالياً.</p>
                <button
                  type="button"
                  onClick={() => onTabChange('categories')}
                  className="min-h-[44px] px-5 rounded-xl bg-[#0F5A33] text-white font-bold cursor-pointer"
                >
                  اختر الأصناف من المتجر
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {cartItems.map((it, idx) => (
                  <div key={`${it.product.id}-${it.unitName}-${idx}`} className="py-3 space-y-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-black text-slate-900 dark:text-slate-100">{it.product.name}</p>
                        {allowPriceView && it.unitPrice ? (
                          <p className="text-[11px] text-[#0F5A33] dark:text-emerald-400 font-mono awlad-tabular">
                            {it.unitPrice.toLocaleString()} {data.settings.currency} × {it.quantity} ={' '}
                            {(it.unitPrice * it.quantity).toLocaleString()} {data.settings.currency}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(idx, -it.quantity)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                        title="إزالة"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={it.unitName}
                        onChange={(e) => updateCartUnit(idx, e.target.value)}
                        className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 px-2.5 text-xs font-bold bg-slate-50 dark:bg-slate-800"
                      >
                        {getProductUnits(it.product).map((u) => (
                          <option key={u.name} value={u.name}>
                            {u.name}
                          </option>
                        ))}
                      </select>

                      <QuantityInput
                        showSteppers
                        allowDecimals
                        min={0.001}
                        value={it.quantity}
                        onChange={(q) => setCartQuantity(idx, q)}
                        onRemoveWhenZero={() => updateCartQuantity(idx, -it.quantity)}
                        ariaLabel={`كمية ${it.product.name}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {cartItems.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3 text-xs">
              <h4 className="font-black text-slate-900 dark:text-slate-100">بيانات الاستلام والتوصيل</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">اسم المحل / المستلم</label>
                  <input
                    type="text"
                    value={checkoutShopName}
                    onChange={(e) => setCheckoutShopName(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">رقم الهاتف للتواصل</label>
                  <input
                    type="tel"
                    value={checkoutPhone}
                    onChange={(e) => setCheckoutPhone(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">عنوان التوصيل</label>
                <input
                  type="text"
                  value={checkoutAddress}
                  onChange={(e) => setCheckoutAddress(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={checkoutGeo}
                  onChange={(e) => setCheckoutGeo(e.target.value)}
                  placeholder="إحداثيات الموقع (اختياري)"
                  className="flex-1 min-w-[160px] min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setIsLocationPickerOpen(true)}
                  className="min-h-[44px] px-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#0F5A33] dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <MapPin className="w-4 h-4" />
                  <span>تحديد على الخريطة</span>
                </button>
                <button
                  type="button"
                  disabled={isLocating}
                  onClick={handleCaptureLocation}
                  className="min-h-[44px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <MapPin className="w-4 h-4" />
                  <span>{isLocating ? 'تحديد...' : 'GPS'}</span>
                </button>
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">ملاحظات للطلب</label>
                <textarea
                  rows={2}
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="مواعيد استلام مفضلة أو ملاحظات..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3"
                />
              </div>

              {allowPriceView && cartEstimatedTotal > 0 && (
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between font-black text-[#0F5A33] dark:text-emerald-300 awlad-tabular">
                  <span>الإجمالي التقديري:</span>
                  <span className="font-mono text-sm">
                    {cartEstimatedTotal.toLocaleString()} {data.settings.currency}
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[48px] rounded-2xl bg-[#0F5A33] hover:bg-[#0B4426] text-white text-sm font-black shadow-md disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? 'جاري إرسال الطلب...' : 'تأكيد وإرسال الطلب للإدارة'}
              </button>
            </div>
          )}
        </form>
      )}

      {/* ORDERS LIFECYCLE VIEW */}
      {activeTab === 'orders' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2">
            <button
              type="button"
              onClick={() => onTabChange('more')}
              className="text-xs font-black text-[#0F5A33] dark:text-emerald-400 flex items-center gap-1 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>رجوع إلى المزيد</span>
            </button>
            <span className="text-xs font-black text-slate-900 dark:text-slate-100">طلباتي ({myOrders.length})</span>
          </div>

          {myOrders.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-10 text-center text-xs text-slate-500">
              لا توجد طلبات مسجلة حتى الآن.
            </div>
          ) : (
            myOrders.map((ord) => {
              const isExpanded = expandedHistoryId === ord.id;
              return (
                <div key={ord.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono font-black text-sm text-[#0F5A33] dark:text-emerald-400">
                        {ord.requestNumber}
                      </span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {new Date(ord.createdAt).toLocaleDateString('ar-EG')} · {ord.items?.length || 0} أصناف
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`font-bold text-xs ${
                          ord.status === 'invoiced' || ord.status === 'approved' || ord.status === 'delivered'
                            ? 'text-[#0F5A33] dark:text-emerald-400'
                            : ord.status === 'rejected' || ord.status === 'needs_review'
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {ord.status === 'invoiced'
                          ? `تم التحويل لفاتورة (${ord.invoiceNumber || ''})`
                          : CUSTOMER_ORDER_STATUS_LABELS[ord.status] || ord.status}
                      </span>
                      {ord.syncStatus && ord.syncStatus !== 'synced' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          <CloudOff className="w-3 h-3" />
                          <span>محلي بانتظار المزامنة</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <CloudCheck className="w-3 h-3" />
                          <span>معتمد مركزيًا</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {ord.deliveryRepName && (
                    <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[#0F5A33] dark:text-emerald-200 font-bold flex items-center gap-2 text-[11px]">
                      <Truck className="w-3.5 h-3.5 shrink-0" />
                      <span>مندوب التوصيل: {ord.deliveryRepName}</span>
                    </div>
                  )}

                  {ord.rejectionReason && (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold">
                      سبب الرفض: {ord.rejectionReason}
                    </div>
                  )}

                  {ord.status !== 'rejected' && ord.status !== 'cancelled' && (
                    <div className="bg-slate-50 dark:bg-slate-800/70 rounded-xl p-2.5 border border-slate-200 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-500 mb-2">مسار الطلب (9 مراحل):</p>
                      <div className="grid grid-cols-9 gap-1 text-center">
                        {NINE_STAGE_TIMELINE.map((st, idx) => {
                          const effectiveStatus = ord.status === 'rep_assigned' ? 'preparing' : ord.status;
                          const currentIdx = NINE_STAGE_TIMELINE.findIndex((s) => s.key === effectiveStatus);
                          const reached = currentIdx >= idx;
                          return (
                            <div key={st.key} className="flex flex-col items-center gap-1">
                              <div className={`w-full h-1.5 rounded ${reached ? 'bg-[#0F5A33]' : 'bg-slate-200 dark:bg-slate-700'}`} />
                              <span className={`text-[9px] leading-tight truncate max-w-full ${reached ? 'font-black text-[#0F5A33] dark:text-emerald-400' : 'text-slate-400'}`}>
                                {st.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl p-2.5">
                    {(ord.items || []).map((it, i) => {
                      const itemImg = data.cachedMediaMap?.[it.productId] || it.productImage;
                      return (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {itemImg && (
                              <img src={itemImg} alt={it.productName} className="w-7 h-7 rounded-lg object-cover border border-slate-200 shrink-0" />
                            )}
                            <span className="font-bold text-slate-800 dark:text-slate-200 truncate">{it.productName}</span>
                          </div>
                          <span className="font-mono text-slate-600 dark:text-slate-400 shrink-0">
                            {it.quantity} {it.unit}
                          </span>
                        </div>
                      );
                    })}
                    {allowPriceView && ((ord.invoiceTotal ?? ord.totalAmount ?? 0) > 0) && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1 font-black text-[#0F5A33] dark:text-emerald-400">
                        <div className="flex items-center justify-between">
                          <span>{ord.invoiceId ? `إجمالي الفاتورة (${ord.invoiceNumber || ''})` : 'الإجمالي'}</span>
                          <span className="font-mono awlad-tabular">
                            {Number(ord.invoiceTotal ?? ord.totalAmount ?? 0).toLocaleString()} {data.settings.currency}
                          </span>
                        </div>
                        {Number(ord.advancePaidAmount || 0) > 0 && (
                          <div className="flex items-center justify-between text-[11px] text-emerald-700">
                            <span className="inline-flex items-center gap-1"><Wallet className="w-3 h-3" /> دفعة مقدمة مسددة:</span>
                            <span className="font-mono awlad-tabular">
                              {Number(ord.advancePaidAmount).toLocaleString()} {data.settings.currency}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setExpandedHistoryId(isExpanded ? null : ord.id)}
                      className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>متابعة المراحل</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReorder(ord)}
                      className="min-h-[40px] px-3.5 rounded-xl bg-[#0F5A33] text-white font-bold cursor-pointer"
                    >
                      إعادة الطلب
                    </button>
                  </div>

                  {isExpanded && ord.statusHistory && ord.statusHistory.length > 0 && (
                    <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                      {ord.statusHistory.map((h) => (
                        <div key={h.id} className="flex items-center justify-between">
                          <span>
                            {CUSTOMER_ORDER_STATUS_LABELS[h.toStatus] || h.toStatus}
                            {h.reason ? ` — ${h.reason}` : ''}
                          </span>
                          <span className="font-mono text-slate-400">
                            {new Date(h.changedAt).toLocaleString('ar-EG')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ACCOUNT & INVOICES & STATEMENT VIEW */}
      {activeTab === 'account' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2">
            <button
              type="button"
              onClick={() => onTabChange('more')}
              className="text-xs font-black text-[#0F5A33] dark:text-emerald-400 flex items-center gap-1 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>رجوع إلى المزيد</span>
            </button>
            <span className="text-xs font-black text-slate-900 dark:text-slate-100">الفواتير وكشف الحساب</span>
          </div>

          <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setAccountSubTab('invoices')}
              className={`flex-1 min-h-[44px] rounded-xl text-xs font-black cursor-pointer ${
                accountSubTab === 'invoices' ? 'bg-[#0F5A33] text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              فواتيري ({myInvoices.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setAccountSubTab('statement');
                data.refreshCustomerStatement();
              }}
              className={`flex-1 min-h-[44px] rounded-xl text-xs font-black cursor-pointer ${
                accountSubTab === 'statement' ? 'bg-[#0F5A33] text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              كشف الحساب التفصيلي
            </button>
          </div>

          {!allowPriceView && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900">
              عرض المبالغ والأسعار مخفي وفق إعدادات الإدارة — يتم عرض أرقام المستندات والكميات فقط.
            </div>
          )}

          {accountSubTab === 'invoices' && (
            <div className="space-y-3">
              {myInvoices.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-10 text-center text-xs text-slate-500">
                  لا توجد فواتير مبيعات معتمدة حتى الآن.
                </div>
              ) : (
                myInvoices.map((inv) => (
                  <div key={inv.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono font-black text-sm text-[#0F5A33] dark:text-emerald-400">
                          {inv.invoiceNumber}
                        </span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span className="font-mono text-slate-500">{inv.date}</span>
                      </div>
                      {allowPriceView && (
                        <strong className="font-mono text-sm text-slate-900 dark:text-slate-100 awlad-tabular">
                          {inv.grandTotal.toLocaleString()} {data.settings.currency}
                        </strong>
                      )}
                    </div>

                    {allowPriceView && (
                      <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                        <span>المدفوع: {inv.paidAmount.toLocaleString()}</span>
                        <span className={inv.remainingAmount > 0 ? 'text-red-700 dark:text-red-400 font-bold' : 'text-emerald-700 font-bold'}>
                          المتبقي: {inv.remainingAmount.toLocaleString()}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className="flex-1 min-h-[42px] rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 font-bold cursor-pointer"
                      >
                        عرض الأصناف
                      </button>
                      <button
                        type="button"
                        onClick={() => exportInvoiceDocument(inv)}
                        className="min-h-[42px] px-4 rounded-xl bg-[#0F5A33] text-white font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        {isNative ? <Share2 className="w-4 h-4" /> : <FileDown className="w-4 h-4" />}
                        <span>{isNative ? 'مشاركة' : 'PDF'}</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {accountSubTab === 'statement' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-black text-slate-900 dark:text-slate-100">حركة الحساب</h4>
                <button
                  type="button"
                  onClick={exportStatementExcel}
                  className="min-h-[40px] px-3.5 rounded-xl bg-[#0F5A33] text-white font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>{isNative ? 'مشاركة CSV' : 'تصدير Excel'}</span>
                </button>
              </div>

              {allowPriceView && data.customerStatement?.summary && (
                <div className="grid grid-cols-3 gap-2 text-center bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div>
                    <span className="text-[10px] text-slate-500 block">إجمالي مدين</span>
                    <strong className="font-mono text-red-700 dark:text-red-400">
                      {(data.customerStatement.summary.totalDebit || 0).toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">إجمالي دائن</span>
                    <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                      {(data.customerStatement.summary.totalCredit || 0).toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">الصافي الحالي</span>
                    <strong className="font-mono text-[#0F5A33] dark:text-emerald-300">
                      {(data.customerStatement.summary.currentBalance || 0).toLocaleString()}
                    </strong>
                  </div>
                </div>
              )}

              {(data.customerStatement?.entries || []).length === 0 ? (
                <p className="text-center text-slate-400 py-6">لا توجد حركات مسجلة في كشف الحساب.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.customerStatement!.entries.map((entry) => (
                    <div key={entry.id} className="py-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-slate-100">{entry.label}</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {entry.docNumber} · {entry.date}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">{entry.description}</p>
                      {allowPriceView && (
                        <div className="flex items-center justify-between font-mono text-[11px] awlad-tabular pt-0.5">
                          <span className="text-red-700 dark:text-red-400">
                            {entry.debit ? `مدين: ${entry.debit.toLocaleString()}` : ''}
                          </span>
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {entry.credit ? `دائن: ${entry.credit.toLocaleString()}` : ''}
                          </span>
                          <span className="font-black text-[#0F5A33] dark:text-emerald-300">
                            الرصيد: {(entry.runningBalance ?? 0).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating Green Cart FAB */}
      {activeTab !== 'cart' && (
        <button
          type="button"
          onClick={() => onTabChange('cart')}
          className="fixed bottom-20 left-4 z-30 min-h-[48px] px-4 rounded-2xl bg-[#0F5A33] hover:bg-[#0B4426] text-white shadow-xl border border-white/20 flex items-center gap-2 cursor-pointer transition-transform active:scale-95"
          aria-label="سلة التسوق"
        >
          <div className="relative">
            <ShoppingCart className="w-5 h-5" />
            {cartItems.length > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-md bg-[#C81E1E] text-white text-[10px] font-black flex items-center justify-center awlad-tabular">
                {cartItems.length}
              </span>
            )}
          </div>
          <div className="text-right">
            <span className="block text-xs font-black leading-none">{t('السلة', 'Cart')}</span>
            {allowPriceView && cartEstimatedTotal > 0 && (
              <span className="block text-[10px] text-emerald-100 awlad-tabular mt-0.5">
                {cartEstimatedTotal.toLocaleString()} {data.settings.currency}
              </span>
            )}
          </div>
        </button>
      )}

      {/* Invoice Details Sheet */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[82vh] flex flex-col gap-3 text-xs pb-safe">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h4 className="font-black text-sm text-slate-900 dark:text-slate-100">
                  تفاصيل الفاتورة {selectedInvoice.invoiceNumber}
                </h4>
                <p className="text-slate-500 font-mono">{selectedInvoice.date}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {(selectedInvoice.items || []).map((it, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900 dark:text-slate-100">{it.productName}</p>
                    <p className="text-[11px] text-slate-500">
                      {it.quantity} {it.unit}
                      {allowPriceView ? ` × ${it.unitPrice.toLocaleString()} ${data.settings.currency}` : ''}
                    </p>
                  </div>
                  {allowPriceView && (
                    <strong className="font-mono text-[#0F5A33] dark:text-emerald-400">
                      {it.total.toLocaleString()} {data.settings.currency}
                    </strong>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => exportInvoiceDocument(selectedInvoice)}
              className="min-h-[46px] rounded-xl bg-[#0F5A33] text-white font-black flex items-center justify-center gap-2 cursor-pointer"
            >
              {isNative ? <Share2 className="w-4 h-4" /> : <FileDown className="w-4 h-4" />}
              <span>{isNative ? 'مشاركة / حفظ الفاتورة' : 'طباعة / PDF'}</span>
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
          setFeedback({ type: 'success', text: 'تم تحديد موقع التوصيل على الخريطة.' });
        }}
        initialLat={checkoutLat}
        initialLng={checkoutLng}
        initialGeoCoordinates={checkoutGeo}
        initialAddress={checkoutAddress}
        title="تحديد موقع التوصيل على الخريطة"
      />
    </div>
  );
};

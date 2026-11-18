import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  Package, ShoppingCart, Receipt, Search, Plus, Minus,
  Trash2, CheckCircle2, AlertCircle, Clock, MapPin, Phone, Building2,
  RefreshCw, History, FileDown, Share2, ShieldAlert, ChevronDown, ChevronUp
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { CustomerItemOrderStatus, CustomerPriceHistoryEntry, Invoice, Product } from '../../../types';
import { getCurrentLocationSafe, isNativeCapacitor } from '../../../services/native';
import { exportHtmlToPdf } from '../../common/PdfExporter';
import { exportToExcel } from '../../common/ExcelExporter';

export type CustomerTabKey = 'home' | 'catalog' | 'cart' | 'orders' | 'account';

interface CustomerPortalProps {
  activeTab: CustomerTabKey;
  onTabChange: (tab: CustomerTabKey) => void;
  focusReferenceId?: string | null;
  onCartCountChange?: (count: number) => void;
}

const ORDER_STATUS_META: Record<CustomerItemOrderStatus, { label: string; colorClass: string }> = {
  pending: { label: 'جديد — بانتظار المراجعة', colorClass: 'text-amber-700' },
  under_review: { label: 'قيد المراجعة', colorClass: 'text-sky-700' },
  approved: { label: 'تمت الموافقة (جاري التجهيز)', colorClass: 'text-blue-800' },
  rep_assigned: { label: 'تم تعيين مندوب للتوصيل', colorClass: 'text-indigo-700' },
  out_for_delivery: { label: 'في الطريق للتوصيل', colorClass: 'text-purple-700' },
  delivered: { label: 'تم التسليم', colorClass: 'text-teal-700' },
  needs_review: { label: 'يحتاج مراجعة', colorClass: 'text-rose-700' },
  rejected: { label: 'مرفوض', colorClass: 'text-red-700' },
  invoiced: { label: 'تم إصدار الفاتورة', colorClass: 'text-emerald-700' },
  cancelled: { label: 'ملغى', colorClass: 'text-slate-500' },
};

const createClientIdempotencyKey = () =>
  `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const CustomerPortal: React.FC<CustomerPortalProps> = ({
  activeTab,
  onTabChange,
  onCartCountChange,
}) => {
  const { currentUser, customerProfile, mobileConfig } = useAuth();
  const data = useData();
  const customer = customerProfile || data.customers[0] || null;
  const allowPriceView = mobileConfig.allowCustomerPriceView !== false;
  const isNative = isNativeCapacitor();

  // Search & category filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedUnitsByProd, setSelectedUnitsByProd] = useState<Record<string, string>>({});

  // Cart state
  const [cartItems, setCartItems] = useState<Array<{
    product: Product;
    quantity: number;
    unitName: string;
    unitFactor: number;
    unitPrice: number | null;
  }>>([]);

  // Checkout snapshot fields
  const [checkoutPhone, setCheckoutPhone] = useState('');
  const [checkoutShopName, setCheckoutShopName] = useState('');
  const [checkoutAddress, setCheckoutAddress] = useState('');
  const [checkoutGeo, setCheckoutGeo] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [isLocating, setIsLocating] = useState(false);
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
      setCheckoutGeo((prev) => prev || customer.geoCoordinates || '');
    }
  }, [customer, currentUser?.phone]);

  const activeProducts = useMemo(
    () => data.products.filter((p) => p.status === 'active'),
    [data.products]
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    activeProducts.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [activeProducts]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeProducts.filter((p) => {
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q));
      const matchCat = selectedCategory === 'all' || p.category === selectedCategory;
      return matchSearch && matchCat;
    });
  }, [activeProducts, searchQuery, selectedCategory]);

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

  const getCustomerCustomPrice = (prod: Product, unitName: string, factor: number): number | null => {
    if (!allowPriceView) return null;
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

  const getTotalAvailableStock = (prod: Product): number => {
    return Object.values(prod.stockPerWarehouse || {}).reduce((sum, v) => sum + Number(v || 0), 0);
  };

  const handleAddToCart = (prod: Product) => {
    const unitName = selectedUnitsByProd[prod.id] || prod.baseUnit;
    const unitMeta = getProductUnits(prod).find((u) => u.name === unitName) || {
      name: prod.baseUnit,
      factor: 1,
      sellingPrice: prod.sellingPrice,
    };
    const customPrice = getCustomerCustomPrice(prod, unitMeta.name, unitMeta.factor);

    rotateIdempotencyKey();
    setCartItems((prev) => {
      const idx = prev.findIndex(
        (it) => it.product.id === prod.id && it.unitName === unitMeta.name
      );
      if (idx >= 0) {
        return prev.map((it, i) =>
          i === idx ? { ...it, quantity: it.quantity + 1 } : it
        );
      }
      return [
        ...prev,
        {
          product: prod,
          quantity: 1,
          unitName: unitMeta.name,
          unitFactor: unitMeta.factor,
          unitPrice: customPrice,
        },
      ];
    });
    setFeedback({ type: 'success', text: `تمت إضافة (${prod.name} — ${unitMeta.name}) إلى السلة` });
    window.setTimeout(() => setFeedback(null), 2200);
  };

  const updateCartQuantity = (idx: number, delta: number) => {
    rotateIdempotencyKey();
    setCartItems((prev) =>
      prev
        .map((it, i) => (i === idx ? { ...it, quantity: it.quantity + delta } : it))
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
          unitPrice: getCustomerCustomPrice(it.product, unitName, factor),
        };
      })
    );
  };

  const handleCaptureLocation = async () => {
    setIsLocating(true);
    setFeedback(null);
    const res = await getCurrentLocationSafe();
    setIsLocating(false);
    if (res.ok && res.coords) {
      setCheckoutGeo(res.coords);
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
        unit: it.unitName,
        unitFactor: it.unitFactor,
        quantity: it.quantity,
      })),
      notes: orderNotes.trim() || 'طلب أصناف من تطبيق الموبايل',
      idempotencyKey: idempotencyKeyRef.current,
    });
    setIsSubmitting(false);

    if (res.success) {
      setCartItems([]);
      setOrderNotes('');
      rotateIdempotencyKey();
      setFeedback({
        type: 'success',
        text: `تم إرسال الطلب رقم ${res.order?.requestNumber || ''} بنجاح وسيتم مراجعته من الإدارة.`,
      });
      onTabChange('orders');
    } else if (res.queuedOffline) {
      setCartItems([]);
      setOrderNotes('');
      rotateIdempotencyKey();
      setFeedback({ type: 'warning', text: res.error || 'تم حفظ الطلب للإرسال التلقائي فور عودة الشبكة.' });
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
          unitPrice: getCustomerCustomPrice(prod, unitMeta.name, unitMeta.factor),
        };
      })
      .filter(Boolean) as typeof cartItems;

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

  const cartTotalQty = cartItems.reduce((sum, it) => sum + it.quantity, 0);
  useEffect(() => {
    onCartCountChange?.(cartTotalQty);
  }, [cartTotalQty, onCartCountChange]);

  const cartEstimatedTotal = cartItems.reduce(
    (sum, it) => sum + (it.unitPrice ? it.unitPrice * it.quantity : 0),
    0
  );

  const exportInvoiceDocument = (inv: Invoice) => {
    exportHtmlToPdf({
      title: 'فاتورة مبيعات',
      companyName: data.settings.companyName,
      companySubtitle: data.settings.companySubtitle,
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
      <div className="bg-white rounded-3xl border border-amber-200 p-8 text-center space-y-3 shadow-xs">
        <ShieldAlert className="w-12 h-12 text-amber-600 mx-auto" />
        <h3 className="text-base font-black text-slate-900">بوابة العملاء متوقفة مؤقتاً</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          تم إيقاف استقبال طلبات العملاء عبر تطبيق الموبايل مؤقتاً من إعدادات الإدارة. يرجى التواصل مع مؤسسة أولاد سليم.
        </p>
        <button
          type="button"
          onClick={() => data.triggerManualSync()}
          className="min-h-[44px] px-5 rounded-xl bg-blue-900 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>إعادة التحقق</span>
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
                <p className="text-xs text-slate-500">أهلاً بك</p>
                <h2 className="text-lg font-black text-slate-900">
                  {customer?.shopName || customer?.name || currentUser?.fullName}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {customer?.code ? `كود العميل: ${customer.code}` : ''}
                  {customer?.area ? ` · ${customer.area}` : ''}
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-900 shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
            </div>

            {allowPriceView ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] text-slate-500 block">الرصيد الحالي</span>
                  <strong
                    className={`text-lg font-black font-mono tabular-nums ${
                      (customer?.currentBalance || 0) > 0
                        ? 'text-red-700'
                        : (customer?.currentBalance || 0) < 0
                        ? 'text-emerald-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {Math.abs(customer?.currentBalance || 0).toLocaleString()} {data.settings.currency}
                  </strong>
                  <span className="text-[11px] text-slate-500 block">
                    {(customer?.currentBalance || 0) > 0
                      ? 'مديونية مستحقة'
                      : (customer?.currentBalance || 0) < 0
                      ? 'رصيد دائن لك'
                      : 'الحساب خالص'}
                  </span>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] text-slate-500 block">الفواتير المعتمدة</span>
                  <strong className="text-lg font-black font-mono tabular-nums text-blue-950">
                    {myInvoices.length}
                  </strong>
                  <span className="text-[11px] text-slate-500 block">فاتورة مبيعات</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 col-span-2 sm:col-span-1">
                  <span className="text-[11px] text-slate-500 block">طلباتي الجارية</span>
                  <strong className="text-lg font-black font-mono tabular-nums text-amber-700">
                    {myOrders.filter((o) => !['invoiced', 'rejected', 'cancelled'].includes(o.status)).length}
                  </strong>
                  <span className="text-[11px] text-slate-500 block">قيد التجهيز والتوصيل</span>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                عرض الأسعار والأرصدة المالية مخفي مؤقتاً حسب إعدادات الإدارة. يمكنك تصفح الأصناف وإرسال طلبات التوريد بشكل طبيعي.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onTabChange('catalog')}
                className="min-h-[48px] rounded-2xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
              >
                <Package className="w-4 h-4" />
                <span>تصفح المنتجات وطلب بضاعة</span>
              </button>
              <button
                type="button"
                onClick={() => onTabChange('account')}
                className="min-h-[48px] rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
              >
                <Receipt className="w-4 h-4" />
                <span>فواتيري وكشف الحساب</span>
              </button>
            </div>
          </div>

          {/* Latest Orders Snapshot */}
          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900">آخر طلبات البضاعة</h3>
              <button
                type="button"
                onClick={() => onTabChange('orders')}
                className="text-xs font-bold text-blue-900 min-h-[36px] px-2 cursor-pointer"
              >
                عرض الكل ({myOrders.length})
              </button>
            </div>
            {myOrders.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">لم ترسل أي طلبات توريد حتى الآن.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {myOrders.slice(0, 3).map((ord) => {
                  const meta = ORDER_STATUS_META[ord.status] || { label: ord.status, colorClass: 'text-slate-700' };
                  return (
                    <div key={ord.id} className="py-3 flex items-center justify-between text-xs gap-2">
                      <div>
                        <span className="font-mono font-black text-blue-950">{ord.requestNumber}</span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span className="text-slate-600">{ord.items?.length || 0} أصناف</span>
                      </div>
                      <span className={`font-bold ${meta.colorClass}`}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CATALOG */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-3 shadow-xs">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث باسم الصنف أو الكود أو الباركود..."
                className="w-full rounded-xl border border-slate-300 py-3 pr-10 pl-3 text-xs font-semibold outline-hidden focus:border-blue-600"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`min-h-[40px] px-4 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-blue-900 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                جميع الأصناف ({activeProducts.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-blue-900 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredProducts.length === 0 ? (
              <div className="col-span-full bg-white rounded-3xl border border-slate-200 p-10 text-center text-xs text-slate-500">
                لا توجد أصناف مطابقة لبحثك.
              </div>
            ) : (
              filteredProducts.map((prod) => {
                const units = getProductUnits(prod);
                const selectedUnit = selectedUnitsByProd[prod.id] || prod.baseUnit;
                const unitMeta = units.find((u) => u.name === selectedUnit) || units[0];
                const price = getCustomerCustomPrice(prod, unitMeta.name, unitMeta.factor);
                const avail = getTotalAvailableStock(prod);

                return (
                  <div
                    key={prod.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start gap-3">
                      {(data.cachedMediaMap?.[prod.id] || prod.image) && (
                        <img
                          src={data.cachedMediaMap?.[prod.id] || prod.image}
                          alt={prod.name}
                          className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0 bg-slate-50"
                        />
                      )}
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-black text-sm text-slate-900 truncate">{prod.name}</h3>
                          <span className="font-mono text-[11px] text-slate-500 shrink-0">{prod.code}</span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {prod.category} · {avail > 0 ? 'متوفر بالمخزون' : 'غير متوفر حالياً'}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between gap-2">
                        <select
                          value={selectedUnit}
                          onChange={(e) =>
                            setSelectedUnitsByProd((prev) => ({
                              ...prev,
                              [prod.id]: e.target.value,
                            }))
                          }
                          className="min-h-[40px] rounded-xl border border-slate-300 px-2.5 text-xs font-bold bg-slate-50 outline-hidden"
                        >
                          {units.map((u) => (
                            <option key={u.name} value={u.name}>
                              {u.name}
                            </option>
                          ))}
                        </select>

                        {allowPriceView ? (
                          <div className="text-left font-mono tabular-nums">
                            <span className="text-sm font-black text-blue-950">
                              {price !== null ? `${price.toLocaleString()} ${data.settings.currency}` : 'حسب التسعير'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">السعر عند الاعتماد</span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddToCart(prod)}
                        className="w-full min-h-[44px] rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold flex items-center justify-center gap-2 active:scale-98 transition-transform cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>إضافة للسلة</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: CART */}
      {activeTab === 'cart' && (
        <form onSubmit={handleSubmitOrder} className="space-y-4">
          <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3">
            <h3 className="text-sm font-black text-slate-900">
              محتويات سلة الطلب ({cartTotalQty} وحدة)
            </h3>

            {cartItems.length === 0 ? (
              <div className="py-8 text-center space-y-3 text-xs text-slate-500">
                <ShoppingCart className="w-10 h-10 text-slate-300 mx-auto" />
                <p>السلة فارغة حالياً.</p>
                <button
                  type="button"
                  onClick={() => onTabChange('catalog')}
                  className="min-h-[44px] px-5 rounded-xl bg-blue-900 text-white font-bold cursor-pointer"
                >
                  اختر الأصناف من الكتالوج
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {cartItems.map((it, idx) => (
                  <div key={`${it.product.id}-${it.unitName}-${idx}`} className="py-3 space-y-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-black text-slate-900">{it.product.name}</p>
                        {allowPriceView && it.unitPrice ? (
                          <p className="text-[11px] text-blue-900 font-mono">
                            {it.unitPrice.toLocaleString()} {data.settings.currency} × {it.quantity} ={' '}
                            {(it.unitPrice * it.quantity).toLocaleString()} {data.settings.currency}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(idx, -it.quantity)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-red-600 hover:bg-red-50 cursor-pointer"
                        title="إزالة"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={it.unitName}
                        onChange={(e) => updateCartUnit(idx, e.target.value)}
                        className="min-h-[42px] rounded-xl border border-slate-300 px-2.5 text-xs font-bold bg-slate-50"
                      >
                        {getProductUnits(it.product).map((u) => (
                          <option key={u.name} value={u.name}>
                            {u.name}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateCartQuantity(idx, -1)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-100 text-slate-800 font-black cursor-pointer"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="font-mono font-black text-sm w-8 text-center tabular-nums">
                          {it.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartQuantity(idx, 1)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-blue-900 text-white font-black cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {cartItems.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
              <h4 className="font-black text-slate-900">بيانات الاستلام والتوصيل</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">اسم المحل / المستلم</label>
                  <input
                    type="text"
                    value={checkoutShopName}
                    onChange={(e) => setCheckoutShopName(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم الهاتف للتواصل</label>
                  <input
                    type="tel"
                    value={checkoutPhone}
                    onChange={(e) => setCheckoutPhone(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">عنوان التوصيل</label>
                <input
                  type="text"
                  value={checkoutAddress}
                  onChange={(e) => setCheckoutAddress(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={checkoutGeo}
                  onChange={(e) => setCheckoutGeo(e.target.value)}
                  placeholder="إحداثيات GPS (اختياري)"
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono"
                />
                <button
                  type="button"
                  disabled={isLocating}
                  onClick={handleCaptureLocation}
                  className="min-h-[44px] px-3.5 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <MapPin className="w-4 h-4" />
                  <span>{isLocating ? 'جاري التحديد...' : 'موقعي GPS'}</span>
                </button>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات للطلب</label>
                <textarea
                  rows={2}
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="مواعيد استلام مفضلة أو ملاحظات..."
                  className="w-full rounded-xl border border-slate-300 p-3"
                />
              </div>

              {allowPriceView && cartEstimatedTotal > 0 && (
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between font-black text-blue-950">
                  <span>الإجمالي التقديري:</span>
                  <span className="font-mono text-sm">
                    {cartEstimatedTotal.toLocaleString()} {data.settings.currency}
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[48px] rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-black shadow-md disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? 'جاري إرسال الطلب...' : 'تأكيد وإرسال الطلب للإدارة'}
              </button>
            </div>
          )}
        </form>
      )}

      {/* TAB 4: ORDERS */}
      {activeTab === 'orders' && (
        <div className="space-y-3">
          {myOrders.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-xs text-slate-500">
              لا توجد طلبات مسجلة حتى الآن.
            </div>
          ) : (
            myOrders.map((ord) => {
              const isExpanded = expandedHistoryId === ord.id;
              const statusMeta = ORDER_STATUS_META[ord.status] || { label: ord.status, colorClass: 'text-slate-700' };
              return (
                <div key={ord.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-black text-sm text-blue-950">
                          {ord.requestNumber}
                        </span>
                        {ord.isLocalQueued && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                            في انتظار المزامنة
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {new Date(ord.createdAt).toLocaleDateString('ar-EG')} · {ord.items?.length || 0} أصناف
                      </p>
                    </div>
                    <span className={`font-bold text-xs ${statusMeta.colorClass}`}>
                      {ord.status === 'invoiced' && ord.invoiceNumber
                        ? `${statusMeta.label} (${ord.invoiceNumber})`
                        : statusMeta.label}
                    </span>
                  </div>

                  {(ord.assignedDeliveryRepName || (allowPriceView && Number(ord.advancePaidAmount || 0) > 0)) && (
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      {ord.assignedDeliveryRepName && (
                        <span className="px-2.5 py-1 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold">
                          مندوب التوصيل: {ord.assignedDeliveryRepName}
                        </span>
                      )}
                      {allowPriceView && Number(ord.advancePaidAmount || 0) > 0 && (
                        <span className="px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold font-mono">
                          دفعة مقدمة مسددة: {Number(ord.advancePaidAmount).toLocaleString()} {data.settings.currency}
                        </span>
                      )}
                    </div>
                  )}

                  {ord.rejectionReason && (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold">
                      سبب الرفض: {ord.rejectionReason}
                    </div>
                  )}

                  <div className="space-y-1 bg-slate-50 rounded-xl p-2.5">
                    {(ord.items || []).map((it, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="font-bold text-slate-800">{it.productName}</span>
                        <span className="font-mono text-slate-600">
                          {it.quantity} {it.unit}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setExpandedHistoryId(isExpanded ? null : ord.id)}
                      className="min-h-[40px] px-3 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>متابعة المراحل</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReorder(ord)}
                      className="min-h-[40px] px-3.5 rounded-xl bg-blue-900 text-white font-bold cursor-pointer"
                    >
                      إعادة الطلب
                    </button>
                  </div>

                  {isExpanded && ord.statusHistory && ord.statusHistory.length > 0 && (
                    <div className="border-t border-slate-200 pt-2 space-y-1.5 text-[11px] text-slate-600">
                      {ord.statusHistory.map((h) => {
                        const hm = ORDER_STATUS_META[h.toStatus as CustomerItemOrderStatus];
                        return (
                          <div key={h.id} className="flex items-center justify-between gap-2">
                            <span>
                              {hm ? hm.label : h.toStatus}
                              {h.reason ? ` — ${h.reason}` : ''}
                            </span>
                            <span className="font-mono text-slate-400 shrink-0">
                              {new Date(h.changedAt).toLocaleString('ar-EG')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 5: INVOICES & STATEMENT */}
      {activeTab === 'account' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 bg-white p-1.5 rounded-2xl border border-slate-200">
            <button
              type="button"
              onClick={() => setAccountSubTab('invoices')}
              className={`flex-1 min-h-[44px] rounded-xl text-xs font-black cursor-pointer ${
                accountSubTab === 'invoices' ? 'bg-blue-900 text-white' : 'text-slate-600'
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
                accountSubTab === 'statement' ? 'bg-blue-900 text-white' : 'text-slate-600'
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
                <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-xs text-slate-500">
                  لا توجد فواتير مبيعات معتمدة حتى الآن.
                </div>
              ) : (
                myInvoices.map((inv) => (
                  <div key={inv.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono font-black text-sm text-blue-950">
                          {inv.invoiceNumber}
                        </span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span className="font-mono text-slate-500">{inv.date}</span>
                      </div>
                      {allowPriceView && (
                        <strong className="font-mono text-sm text-slate-900 tabular-nums">
                          {inv.grandTotal.toLocaleString()} {data.settings.currency}
                        </strong>
                      )}
                    </div>

                    {allowPriceView && (
                      <div className="flex items-center justify-between text-[11px] text-slate-600">
                        <span>المدفوع: {inv.paidAmount.toLocaleString()}</span>
                        <span className={inv.remainingAmount > 0 ? 'text-red-700 font-bold' : 'text-emerald-700 font-bold'}>
                          المتبقي: {inv.remainingAmount.toLocaleString()}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className="flex-1 min-h-[42px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer"
                      >
                        عرض الأصناف
                      </button>
                      <button
                        type="button"
                        onClick={() => exportInvoiceDocument(inv)}
                        className="min-h-[42px] px-4 rounded-xl bg-blue-900 text-white font-bold flex items-center gap-1.5 cursor-pointer"
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
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-black text-slate-900">حركة الحساب</h4>
                <button
                  type="button"
                  onClick={exportStatementExcel}
                  className="min-h-[40px] px-3.5 rounded-xl bg-emerald-700 text-white font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>{isNative ? 'مشاركة CSV' : 'تصدير Excel'}</span>
                </button>
              </div>

              {allowPriceView && data.customerStatement?.summary && (
                <div className="grid grid-cols-3 gap-2 text-center bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-[10px] text-slate-500 block">إجمالي مدين</span>
                    <strong className="font-mono text-red-700">
                      {(data.customerStatement.summary.totalDebit || 0).toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">إجمالي دائن</span>
                    <strong className="font-mono text-emerald-700">
                      {(data.customerStatement.summary.totalCredit || 0).toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">الصافي الحالي</span>
                    <strong className="font-mono text-blue-950">
                      {(data.customerStatement.summary.currentBalance || 0).toLocaleString()}
                    </strong>
                  </div>
                </div>
              )}

              {(data.customerStatement?.entries || []).length === 0 ? (
                <p className="text-center text-slate-400 py-6">لا توجد حركات مسجلة في كشف الحساب.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.customerStatement!.entries.map((entry) => (
                    <div key={entry.id} className="py-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{entry.label}</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {entry.docNumber} · {entry.date}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">{entry.description}</p>
                      {allowPriceView && (
                        <div className="flex items-center justify-between font-mono text-[11px] tabular-nums pt-0.5">
                          <span className="text-red-700">
                            {entry.debit ? `مدين: ${entry.debit.toLocaleString()}` : ''}
                          </span>
                          <span className="text-emerald-700">
                            {entry.credit ? `دائن: ${entry.credit.toLocaleString()}` : ''}
                          </span>
                          <span className="font-black text-blue-950">
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

      {/* Invoice Details Sheet */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-200 max-h-[82vh] flex flex-col gap-3 text-xs pb-safe">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h4 className="font-black text-sm text-slate-900">
                  تفاصيل الفاتورة {selectedInvoice.invoiceNumber}
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
                    <p className="text-[11px] text-slate-500">
                      {it.quantity} {it.unit}
                      {allowPriceView ? ` × ${it.unitPrice.toLocaleString()} ${data.settings.currency}` : ''}
                    </p>
                  </div>
                  {allowPriceView && (
                    <strong className="font-mono text-blue-950">
                      {it.total.toLocaleString()} {data.settings.currency}
                    </strong>
                  )}
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

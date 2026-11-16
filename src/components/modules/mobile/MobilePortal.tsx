import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import {
  LogOut, PackagePlus, ClipboardList, Truck, ShoppingBag,
  Search, Plus, Minus, Trash2, CheckCircle2, AlertCircle,
  Clock, MapPin, Phone, Building2, RefreshCw, History, FileText, WifiOff
} from 'lucide-react';
import { Product } from '../../../types';

const createClientIdempotencyKey = () =>
  `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const MobilePortal: React.FC = () => {
  const { currentUser, customerProfile, representativeProfile, linkWarning, logout } = useAuth();
  const data = useData();
  const isRep = currentUser?.role === 'representative';
  const isCustomer = currentUser?.role === 'customer';

  // Authoritative profile comes strictly from backend auth context (1:1 customer.userId / rep link)
  const customer = customerProfile;
  const rep = representativeProfile;

  // View state for customers & reps
  const [activeTab, setActiveTab] = useState<'catalog' | 'cart' | 'orders'>('catalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Customer Cart
  const [cartItems, setCartItems] = useState<Array<{
    product: Product;
    quantity: number;
    unitName: string;
    unitPrice: number | null;
  }>>([]);

  // Delivery snapshot fields confirmed during checkout
  const [checkoutPhone, setCheckoutPhone] = useState('');
  const [checkoutShopName, setCheckoutShopName] = useState('');
  const [checkoutAddress, setCheckoutAddress] = useState('');
  const [checkoutGeo, setCheckoutGeo] = useState('');
  const [isLocating, setIsLocating] = useState(false);

  // Sync checkout fields whenever customerProfile loads
  useEffect(() => {
    if (customer) {
      setCheckoutPhone((prev) => prev || customer.phone || currentUser?.phone || '');
      setCheckoutShopName((prev) => prev || customer.shopName || customer.name || '');
      setCheckoutAddress((prev) => prev || customer.address || '');
      setCheckoutGeo((prev) => prev || customer.geoCoordinates || '');
    }
  }, [customer, currentUser?.phone]);

  // Stable idempotency key per cart session to guarantee single submission on retries/double-tap
  const idempotencyKeyRef = useRef<string>(createClientIdempotencyKey());
  const rotateIdempotencyKey = () => {
    idempotencyKeyRef.current = createClientIdempotencyKey();
  };

  // Rep Item Transfer items state
  const [repTransferItems, setRepTransferItems] = useState<Array<{
    productId: string;
    productName: string;
    unit: string;
    quantity: number;
  }>>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [orderNotes, setOrderNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const activeProducts = useMemo(() => {
    return data.products.filter((p) => p.status === 'active');
  }, [data.products]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    activeProducts.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [activeProducts]);

  const filteredProducts = useMemo(() => {
    return activeProducts.filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.barcode && p.barcode.includes(searchQuery));
      const matchCat = selectedCategory === 'all' || p.category === selectedCategory;
      return matchSearch && matchCat;
    });
  }, [activeProducts, searchQuery, selectedCategory]);

  const getCustomerProductPrice = (productId: string): number | null => {
    if (!customer) return null;
    const history = customer.priceHistory?.[productId];
    if (history && history.length > 0) {
      return history[history.length - 1];
    }
    return null;
  };

  const handleAddToCart = (product: Product) => {
    const customPrice = getCustomerProductPrice(product.id);
    rotateIdempotencyKey();
    setCartItems((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          unitName: product.baseUnit,
          unitPrice: customPrice,
        },
      ];
    });
    setFeedbackMessage({ type: 'success', text: `تمت إضافة "${product.name}" إلى سلة الطلبات.` });
    setTimeout(() => setFeedbackMessage(null), 3000);
  };

  const handleUpdateCartQuantity = (productId: string, delta: number) => {
    rotateIdempotencyKey();
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as typeof cartItems
    );
  };

  const handleUpdateCartUnit = (productId: string, unitName: string) => {
    rotateIdempotencyKey();
    setCartItems((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, unitName } : item
      )
    );
  };

  const handleRemoveFromCart = (productId: string) => {
    rotateIdempotencyKey();
    setCartItems((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      setFeedbackMessage({ type: 'error', text: 'المتصفح لا يدعم تحديد الموقع التلقائي، يمكنك كتابة الإحداثيات أو العنوان يدوياً.' });
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCheckoutGeo(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`);
        setIsLocating(false);
      },
      () => {
        setIsLocating(false);
        setFeedbackMessage({ type: 'error', text: 'تعذر الحصول على الموقع الجغرافي، يرجى التأكد من تفعيل GPS أو إدخال العنوان يدوياً.' });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Submit Customer Order
  const handleSubmitCustomerOrder = async () => {
    if (!customer) {
      setFeedbackMessage({
        type: 'error',
        text: linkWarning || 'حسابك غير مربوط بملف عميل معتمد في النظام. يرجى مراجعة الإدارة.',
      });
      return;
    }
    if (cartItems.length === 0) {
      setFeedbackMessage({ type: 'error', text: 'يرجى إضافة صنف واحد على الأقل للسلة.' });
      return;
    }
    if (!checkoutPhone.trim() || !checkoutAddress.trim()) {
      setFeedbackMessage({ type: 'error', text: 'يرجى تأكيد رقم الهاتف وعنوان التسليم قبل إرسال الطلب.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await data.createCustomerItemOrder({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: checkoutPhone.trim(),
        shopName: checkoutShopName.trim() || customer.shopName || customer.name,
        deliveryAddress: checkoutAddress.trim(),
        geoCoordinates: checkoutGeo.trim() || undefined,
        items: cartItems.map((item) => ({
          productId: item.product.id,
          productName: item.product.name,
          unit: item.unitName || item.product.baseUnit,
          quantity: item.quantity,
          unitPrice: item.unitPrice || 0,
        })),
        notes: orderNotes.trim() || undefined,
        idempotencyKey: idempotencyKeyRef.current,
      });

      if (result.success) {
        setCartItems([]);
        setOrderNotes('');
        rotateIdempotencyKey();
        setActiveTab('orders');
        if (result.queuedOffline) {
          setFeedbackMessage({
            type: 'warning',
            text: 'لا يوجد اتصال بالسيرفر حالياً — تم حفظ الطلب مؤقتاً في قائمة الانتظار وسيُرسل تلقائياً فور عودة الاتصال.',
          });
        } else {
          setFeedbackMessage({
            type: 'success',
            text: `تم إرسال الطلب (${result.order?.requestNumber || ''}) وحفظه في السيرفر بنجاح. ستتم مراجعته وإصدار الفاتورة من الإدارة.`,
          });
        }
      } else {
        setFeedbackMessage({
          type: 'error',
          text: result.error || 'تعذر إرسال الطلب إلى السيرفر، لم يتم تأكيد الإرسال.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Rep: Add item to transfer request
  const handleAddRepTransferItem = () => {
    const prod = activeProducts.find((p) => p.id === selectedProductId);
    if (!prod || selectedQuantity <= 0) return;
    setRepTransferItems((prev) => [
      ...prev,
      { productId: prod.id, productName: prod.name, unit: prod.baseUnit, quantity: selectedQuantity },
    ]);
    setSelectedProductId('');
    setSelectedQuantity(1);
  };

  // Rep: Submit Transfer Request
  const handleSubmitRepTransfer = async () => {
    if (!rep) {
      setFeedbackMessage({ type: 'error', text: 'حساب المندوب غير مربوط بملف مندوب مسجل.' });
      return;
    }
    if (repTransferItems.length === 0) {
      setFeedbackMessage({ type: 'error', text: 'يرجى تحديد الأصناف والكميات المطلوبة أولاً.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const source = data.warehouses.find((w) => w.isDefault) || data.warehouses[0];
      if (!source) {
        setFeedbackMessage({ type: 'error', text: 'يجب إعداد المخزن الرئيسي أولاً من الإدارة.' });
        return;
      }

      let target = data.warehouses.find((w) => w.id !== source.id && w.name.includes(rep.name));
      if (!target) {
        const ensured = await data.ensureRepVanWarehouse(rep.name);
        target = ensured.warehouse;
      }

      if (!target) {
        setFeedbackMessage({ type: 'error', text: 'تعذر تهيئة مستودع سيارة المندوب.' });
        return;
      }

      const result = await data.createRepItemTransfer({
        date: new Date().toISOString().split('T')[0],
        representativeId: rep.id,
        representativeName: rep.name,
        sourceWarehouseId: source.id,
        sourceWarehouseName: source.name,
        targetWarehouseId: target.id,
        targetWarehouseName: target.name,
        items: repTransferItems.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          unit: i.unit,
          requestedQty: i.quantity,
          availableInVanQty: 0,
          shortageQty: i.quantity,
        })),
        notes: orderNotes.trim() || undefined,
      });

      if (result.success) {
        setRepTransferItems([]);
        setOrderNotes('');
        setFeedbackMessage({
          type: 'success',
          text: 'تم إرسال طلب تحويل الأصناف بنجاح للإدارة. لن يتم خصم المخزون إلا بعد اعتماد وتنفيذ الإدارة وتأكيدك للاستلام.',
        });
      } else {
        setFeedbackMessage({ type: 'error', text: result.error || 'تعذر إرسال طلب التحويل.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Customer order history (backend already isolates strictly to the customer's own orders)
  const myCustomerOrders = useMemo(() => {
    if (!customer) return [];
    return (data.customerItemOrders || []).filter((o) => o.customerId === customer.id);
  }, [data.customerItemOrders, customer]);

  // Rep transfer history
  const myRepTransfers = useMemo(() => {
    return (data.repItemTransfers || []).filter((t) => t.representativeId === rep?.id);
  }, [data.repItemTransfers, rep]);

  const confirmReceipt = async (transferId: string) => {
    const res = await data.updateRepItemTransferStatus(transferId, 'received', undefined, 'تم تأكيد الاستلام من تطبيق المندوب');
    if (res.success) {
      setFeedbackMessage({ type: 'success', text: 'تم تأكيد استلام التحويل وإضافته لعهدتك بنجاح.' });
    } else {
      setFeedbackMessage({ type: 'error', text: res.error || 'تعذر تأكيد الاستلام.' });
    }
  };

  const statusBadge = (status: string, rejectionReason?: string) => {
    if (status === 'pending') {
      return { cls: 'bg-amber-100 text-amber-800', label: 'جديد — قيد مراجعة الإدارة' };
    }
    if (status === 'approved') {
      return { cls: 'bg-blue-100 text-blue-800', label: 'مقبول — جاري تجهيز الفاتورة' };
    }
    if (status === 'rejected') {
      return { cls: 'bg-red-100 text-red-800', label: `مرفوض${rejectionReason ? `: ${rejectionReason}` : ''}` };
    }
    return { cls: 'bg-emerald-100 text-emerald-800', label: 'تم التحويل إلى فاتورة' };
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-100 font-['Cairo'] pb-20">
      {/* Mobile Top Header */}
      <header className="sticky top-0 z-30 bg-slate-950 text-white shadow-md px-4 py-3 border-b border-slate-800">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/awlad-selim-logo.png" alt="أولاد سليم" className="h-8 w-auto object-contain" />
            <div>
              <h1 className="text-sm font-black tracking-wide text-white">أولاد سليم للجملة</h1>
              <p className="text-[11px] text-blue-300 font-semibold">
                {isRep ? 'بوابة المندوب الميداني' : 'بوابة طلبات الجملة للعملاء'} • {currentUser?.fullName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.offlineOrdersCount > 0 && (
              <button
                onClick={() => data.triggerManualSync()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/20 text-amber-200 border border-amber-500/30 text-[11px] font-bold cursor-pointer"
                title="مزامنة الطلبات المعلقة"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>معلق ({data.offlineOrdersCount})</span>
              </button>
            )}
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 text-xs font-bold transition-all cursor-pointer"
              title="تسجيل الخروج"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>خروج</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-4xl mx-auto p-4 space-y-4">
        {/* Account link warning banner */}
        {isCustomer && (!customer || linkWarning) && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900 flex items-start gap-3 text-xs font-bold shadow-xs">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>تنبيه ربط الحساب:</p>
              <p className="font-normal leading-relaxed">
                {linkWarning || 'حسابك غير مربوط بملف عميل معتمد بعد. يرجى التواصل مع إدارة أولاد سليم لربط الحساب قبل إرسال الطلبات.'}
              </p>
            </div>
          </div>
        )}

        {/* Network Offline Queue Notice */}
        {data.offlineOrdersCount > 0 && (
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-between gap-3 text-xs font-bold">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
              <span>يوجد ({data.offlineOrdersCount}) طلب محفوظ مؤقتاً بانتظار الإرسال للسيرفر.</span>
            </div>
            <button
              onClick={() => data.triggerManualSync()}
              className="px-3 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 cursor-pointer shrink-0"
            >
              محاولة الإرسال الآن
            </button>
          </div>
        )}

        {/* Feedback Alert */}
        {feedbackMessage && (
          <div
            className={`p-4 rounded-2xl flex items-center gap-3 text-xs font-bold shadow-xs transition-all ${
              feedbackMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                : feedbackMessage.type === 'warning'
                ? 'bg-amber-50 text-amber-900 border border-amber-200'
                : 'bg-red-50 text-red-900 border border-red-200'
            }`}
          >
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle
                className={`w-5 h-5 shrink-0 ${
                  feedbackMessage.type === 'warning' ? 'text-amber-600' : 'text-red-600'
                }`}
              />
            )}
            <span className="leading-relaxed">{feedbackMessage.text}</span>
          </div>
        )}

        {/* ============================================================ */}
        {/* VIEW 1: CUSTOMER PORTAL */}
        {/* ============================================================ */}
        {isCustomer && (
          <>
            {/* Customer Profile Summary Strip */}
            {customer && (
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-900 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-black text-slate-900">
                      {customer.shopName || customer.name}{' '}
                      <span className="font-mono text-[10px] text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded">
                        {customer.code}
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {customer.phone} • {customer.address}
                    </p>
                  </div>
                </div>
                <div className="text-left font-mono">
                  <span className="text-[10px] text-slate-400 block">الرصيد الحالي</span>
                  <strong className={`text-xs font-black ${customer.currentBalance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {customer.currentBalance.toLocaleString()} ج.م
                  </strong>
                </div>
              </div>
            )}

            {/* Top Navigation Tabs for Customer */}
            <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-xs text-xs font-bold">
              <button
                onClick={() => setActiveTab('catalog')}
                className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  activeTab === 'catalog' ? 'bg-blue-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ShoppingBag className="w-4 h-4" />
                <span>دليل المنتجات</span>
              </button>

              <button
                onClick={() => setActiveTab('cart')}
                className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer relative ${
                  activeTab === 'cart' ? 'bg-blue-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <PackagePlus className="w-4 h-4" />
                <span>السلة</span>
                {cartItems.length > 0 && (
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-black flex items-center justify-center">
                    {cartItems.reduce((acc, i) => acc + i.quantity, 0)}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('orders')}
                className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  activeTab === 'orders' ? 'bg-blue-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ClipboardList className="w-4 h-4" />
                <span>طلباتي ({myCustomerOrders.length})</span>
              </button>
            </div>

            {/* TAB: CATALOG */}
            {activeTab === 'catalog' && (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ابحث عن منتج بالاسم أو الكود أو الباركود..."
                      className="w-full pl-3 pr-10 py-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:border-blue-700"
                    />
                  </div>

                  {categories.length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                      <button
                        onClick={() => setSelectedCategory('all')}
                        className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-all ${
                          selectedCategory === 'all'
                            ? 'bg-blue-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        الكل
                      </button>
                      {categories.map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-all ${
                            selectedCategory === cat
                              ? 'bg-blue-900 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredProducts.map((prod) => {
                    const customPrice = getCustomerProductPrice(prod.id);
                    return (
                      <div
                        key={prod.id}
                        className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs hover:border-blue-400 transition-all flex flex-col justify-between"
                      >
                        <div className="flex gap-3">
                          <div className="w-20 h-20 rounded-xl bg-slate-100 border border-slate-200 shrink-0 overflow-hidden flex items-center justify-center">
                            {prod.image ? (
                              <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" />
                            ) : (
                              <ShoppingBag className="w-7 h-7 text-slate-300" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                              {prod.category || 'عام'}
                            </span>
                            <h3 className="text-xs font-black text-slate-900 truncate mt-1">{prod.name}</h3>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">كود: {prod.code}</p>

                            <div className="mt-2">
                              {customPrice !== null ? (
                                <div className="text-xs font-black text-emerald-800">
                                  {customPrice.toLocaleString()} ج.م{' '}
                                  <span className="text-[10px] text-slate-500 font-medium">/{prod.baseUnit} (سعر خاص)</span>
                                </div>
                              ) : prod.sellingPrice > 0 ? (
                                <div className="text-xs font-black text-blue-900">
                                  {prod.sellingPrice.toLocaleString()} ج.م{' '}
                                  <span className="text-[10px] text-slate-500 font-medium">/{prod.baseUnit} (سعر استرشادي)</span>
                                </div>
                              ) : (
                                <div className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md inline-block">
                                  سعر جملة يُحدد عند اعتماد الطلب
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-[11px] text-slate-500 font-medium">الوحدة: {prod.baseUnit}</span>
                          <button
                            onClick={() => handleAddToCart(prod)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>إضافة للسلة</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {filteredProducts.length === 0 && (
                  <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
                    <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-500">لا توجد منتجات مطابقة للبحث.</p>
                  </div>
                )}
              </div>
            )}

            {/* TAB: CART */}
            {activeTab === 'cart' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <PackagePlus className="w-4 h-4 text-blue-900" />
                    <span>سلة طلبيات الجملة ({cartItems.length} صنف)</span>
                  </h2>
                  {cartItems.length > 0 && (
                    <button
                      onClick={() => {
                        setCartItems([]);
                        rotateIdempotencyKey();
                      }}
                      className="text-xs text-red-600 hover:text-red-700 font-bold cursor-pointer"
                    >
                      إفراغ السلة
                    </button>
                  )}
                </div>

                {cartItems.length > 0 ? (
                  <div className="space-y-4">
                    <div className="divide-y divide-slate-100">
                      {cartItems.map((item) => {
                        const availableUnits = [
                          item.product.baseUnit,
                          ...(item.product.units || []).map((u) => u.name),
                        ];
                        return (
                          <div key={item.product.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 shrink-0 overflow-hidden flex items-center justify-center">
                                {item.product.image ? (
                                  <img src={item.product.image} alt={item.product.name} className="w-full h-full object-cover" />
                                ) : (
                                  <ShoppingBag className="w-5 h-5 text-slate-400" />
                                )}
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-slate-900">{item.product.name}</h4>
                                <p className="text-[10px] text-slate-500">
                                  {item.unitPrice
                                    ? `${item.unitPrice} ج.م / ${item.product.baseUnit}`
                                    : item.product.sellingPrice > 0
                                    ? `${item.product.sellingPrice} ج.م / ${item.product.baseUnit} (استرشادي)`
                                    : 'السعر يحدد بعد مراجعة الإدارة'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-2">
                              {availableUnits.length > 1 && (
                                <select
                                  value={item.unitName}
                                  onChange={(e) => handleUpdateCartUnit(item.product.id, e.target.value)}
                                  className="px-2 py-1 text-[11px] font-bold border border-slate-200 rounded-lg bg-white"
                                >
                                  {availableUnits.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                              )}

                              <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                                <button
                                  onClick={() => handleUpdateCartQuantity(item.product.id, -1)}
                                  className="px-2 py-1 text-slate-600 hover:bg-slate-200 cursor-pointer"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="px-3 text-xs font-black text-slate-900">{item.quantity}</span>
                                <button
                                  onClick={() => handleUpdateCartQuantity(item.product.id, 1)}
                                  className="px-2 py-1 text-slate-600 hover:bg-slate-200 cursor-pointer"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>

                              <button
                                onClick={() => handleRemoveFromCart(item.product.id)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer"
                                title="حذف"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Delivery Snapshot Confirmation */}
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                      <h3 className="font-black text-slate-800 flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-blue-900" />
                        <span>تأكيد بيانات المحل والتوصيل</span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">اسم المحل / المنشأة:</label>
                          <input
                            type="text"
                            value={checkoutShopName}
                            onChange={(e) => setCheckoutShopName(e.target.value)}
                            className="w-full p-2 rounded-xl border border-slate-200 bg-white font-semibold"
                            placeholder="اسم المحل"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            رقم الهاتف للتواصل: <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="tel"
                            value={checkoutPhone}
                            onChange={(e) => setCheckoutPhone(e.target.value)}
                            className="w-full p-2 rounded-xl border border-slate-200 bg-white font-mono font-bold"
                            placeholder="01xxxxxxxxx"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            عنوان التسليم بالتفصيل: <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={checkoutAddress}
                            onChange={(e) => setCheckoutAddress(e.target.value)}
                            className="w-full p-2 rounded-xl border border-slate-200 bg-white"
                            placeholder="العنوان الكامل لتسليم البضاعة"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">إحداثيات GPS أو رابط الموقع (اختياري):</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={checkoutGeo}
                              onChange={(e) => setCheckoutGeo(e.target.value)}
                              className="flex-1 p-2 rounded-xl border border-slate-200 bg-white font-mono text-[11px]"
                              placeholder="30.0444, 31.2357"
                            />
                            <button
                              type="button"
                              onClick={handleDetectLocation}
                              disabled={isLocating}
                              className="px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 font-bold text-[11px] cursor-pointer shrink-0 disabled:opacity-50"
                            >
                              {isLocating ? 'جاري التحديد...' : 'موقعي الحالي GPS'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Order Notes */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        ملاحظات أو تعليمات تسليم الطلبية (اختياري):
                      </label>
                      <textarea
                        value={orderNotes}
                        onChange={(e) => setOrderNotes(e.target.value)}
                        placeholder="أي تعليمات إضافية تخص موعد التسليم أو الأصناف..."
                        className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:border-blue-700"
                        rows={2}
                      />
                    </div>

                    <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-[11px] leading-relaxed">
                      <strong>تنبيه نظام الجملة:</strong> إرسال الطلب يصل مباشرة للنظام المركزي للإدارة للمراجعة وتحديد الأسعار النهائية وإصدار الفاتورة، ولن يتم خصم أي مخزون أو تحميل مديونية إلا عند اعتماد الفاتورة.
                    </div>

                    <button
                      disabled={isSubmitting || !customer}
                      onClick={handleSubmitCustomerOrder}
                      className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmitting ? 'جاري إرسال الطلب وحفظه بالسيرفر...' : 'تأكيد وإرسال طلب الجملة للإدارة'}
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <PackagePlus className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-500">سلة الطلبات فارغة حالياً.</p>
                    <button
                      onClick={() => setActiveTab('catalog')}
                      className="mt-3 px-4 py-2 rounded-xl bg-blue-900 text-white text-xs font-bold cursor-pointer"
                    >
                      تصفح المنتجات وأضف للطلب
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB: ORDERS */}
            {activeTab === 'orders' && (
              <div className="space-y-3">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-blue-900" />
                      <span>سجل طلبات الجملة الخاصة بك ({myCustomerOrders.length})</span>
                    </h2>
                    <button
                      onClick={() => data.refreshData()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>تحديث الحالة</span>
                    </button>
                  </div>

                  <div className="space-y-3">
                    {myCustomerOrders.map((order) => {
                      const badge = statusBadge(order.status, order.rejectionReason);
                      const isExpanded = expandedHistoryId === order.id;
                      return (
                        <div key={order.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-black text-blue-900 font-mono">{order.requestNumber}</span>
                              {order.invoiceNumber && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-bold">
                                  <FileText className="w-3 h-3" />
                                  فاتورة: {order.invoiceNumber}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {new Date(order.createdAt).toLocaleString('ar-EG')}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-600 flex flex-wrap gap-3">
                            {order.shopName && (
                              <span className="inline-flex items-center gap-1">
                                <Building2 className="w-3 h-3 text-slate-400" />
                                {order.shopName}
                              </span>
                            )}
                            {order.customerPhone && (
                              <span className="inline-flex items-center gap-1 font-mono">
                                <Phone className="w-3 h-3 text-slate-400" />
                                {order.customerPhone}
                              </span>
                            )}
                            {order.deliveryAddress && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-red-500" />
                                {order.deliveryAddress}
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-slate-800 bg-white p-2.5 rounded-lg border border-slate-100 space-y-1">
                            {order.items.map((i, idx) => (
                              <div key={idx} className="flex items-center justify-between">
                                <span className="font-bold">
                                  {i.productName} — {i.quantity} {i.unit}
                                </span>
                                <span className="text-[11px] font-mono text-slate-500">
                                  {i.unitPrice && i.unitPrice > 0 ? `${i.unitPrice.toLocaleString()} ج.م (استرشادي)` : 'تسعير الإدارة'}
                                </span>
                              </div>
                            ))}
                          </div>

                          {order.notes && (
                            <p className="text-[11px] text-slate-600">ملاحظاتك: {order.notes}</p>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60 text-xs">
                            <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${badge.cls}`}>
                              {badge.label}
                            </span>

                            <div className="flex items-center gap-3">
                              {order.statusHistory && order.statusHistory.length > 0 && (
                                <button
                                  onClick={() => setExpandedHistoryId(isExpanded ? null : order.id)}
                                  className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-blue-900 font-bold cursor-pointer"
                                >
                                  <History className="w-3.5 h-3.5" />
                                  <span>{isExpanded ? 'إخفاء السجل' : 'تتبع الحالة'}</span>
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  rotateIdempotencyKey();
                                  const newCart = order.items
                                    .map((oi) => {
                                      const prod = activeProducts.find((p) => p.id === oi.productId);
                                      if (!prod) return null;
                                      return {
                                        product: prod,
                                        quantity: oi.quantity,
                                        unitName: oi.unit || prod.baseUnit,
                                        unitPrice: getCustomerProductPrice(prod.id),
                                      };
                                    })
                                    .filter(Boolean) as typeof cartItems;
                                  setCartItems(newCart);
                                  setActiveTab('cart');
                                  setFeedbackMessage({ type: 'success', text: 'تم نسخ أصناف الطلب السابق إلى السلة.' });
                                }}
                                className="text-xs text-blue-900 hover:underline font-bold cursor-pointer"
                              >
                                إعادة الطلب
                              </button>
                            </div>
                          </div>

                          {isExpanded && order.statusHistory && (
                            <div className="mt-2 pt-2 border-t border-slate-200 space-y-1.5 text-[11px]">
                              {order.statusHistory.map((h) => (
                                <div key={h.id} className="flex items-center justify-between text-slate-600">
                                  <span>
                                    <Clock className="w-3 h-3 inline ml-1 text-slate-400" />
                                    <strong>{h.toStatus === 'pending' ? 'طلب جديد' : h.toStatus === 'approved' ? 'مقبول' : h.toStatus === 'rejected' ? 'مرفوض' : 'فاتورة صادرة'}</strong>
                                    {h.reason ? ` — ${h.reason}` : ''}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-400">
                                    {new Date(h.changedAt).toLocaleString('ar-EG')}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {myCustomerOrders.length === 0 && (
                      <div className="text-center py-8 text-xs text-slate-500 font-medium">
                        لم تقم بإرسال أي طلبات بعد.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ============================================================ */}
        {/* VIEW 2: REPRESENTATIVE PORTAL */}
        {/* ============================================================ */}
        {isRep && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-black text-slate-900">{rep?.name || currentUser?.fullName}</h2>
                  <p className="text-xs text-slate-500">رقم الهاتف: {rep?.phone || currentUser?.phone || 'غير مسجل'}</p>
                </div>
                <div className="text-left">
                  <span className="text-[10px] text-slate-500 block">رصيد العهدة المالي</span>
                  <span className="text-sm font-black text-blue-900">
                    {(rep?.currentBalance || 0).toLocaleString()} ج.م
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Truck className="w-4 h-4 text-purple-700" />
                <span>طلب تحويل عهدة أصناف (من المخزن الرئيسي إلى السيارة)</span>
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                حدد الأصناف التي تحتاجها في سيارتك. يصل الطلب للإدارة وتتم مراجعته، ولن يتم خصم المخزون إلا بعد اعتماد التنفيذ وتأكيد استلامك الفعلي.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-2">
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="p-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden"
                >
                  <option value="">-- اختر الصنف الغذائي --</option>
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  min="1"
                  value={selectedQuantity}
                  onChange={(e) => setSelectedQuantity(Math.max(1, Number(e.target.value)))}
                  placeholder="الكمية"
                  className="p-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50 text-center font-bold"
                />

                <button
                  type="button"
                  onClick={handleAddRepTransferItem}
                  className="px-4 py-2.5 rounded-xl bg-blue-900 text-white text-xs font-bold hover:bg-blue-800 transition-all cursor-pointer"
                >
                  إضافة
                </button>
              </div>

              {repTransferItems.length > 0 && (
                <div className="space-y-2 pt-2">
                  {repTransferItems.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                      <span className="font-bold text-slate-800">{item.productName}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-blue-900 font-bold">
                          {item.quantity} {item.unit}
                        </span>
                        <button
                          onClick={() => setRepTransferItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  <textarea
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="ملاحظات الطلب أو سبب التحويل..."
                    className="w-full p-2.5 text-xs rounded-xl border border-slate-200 bg-slate-50"
                    rows={2}
                  />

                  <button
                    disabled={isSubmitting}
                    onClick={handleSubmitRepTransfer}
                    className="w-full py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? 'جاري إرسال الطلب...' : 'إرسال طلب التحويل للإدارة'}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-slate-700" />
                <span>طلبات التحويل السابقة وحالات الاستلام</span>
              </h3>

              <div className="space-y-2.5">
                {myRepTransfers.map((tr) => (
                  <div key={tr.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold font-mono text-purple-900">{tr.requestNumber}</span>
                      <span className="text-[10px] text-slate-500">{tr.date}</span>
                    </div>

                    <div className="text-slate-700">
                      {tr.items.map((it) => `${it.productName} (${it.requestedQty})`).join('، ')}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          tr.status === 'pending'
                            ? 'bg-amber-100 text-amber-800'
                            : tr.status === 'approved'
                            ? 'bg-blue-100 text-blue-800'
                            : tr.status === 'executed'
                            ? 'bg-purple-100 text-purple-800 font-black'
                            : tr.status === 'received'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {tr.status === 'pending'
                          ? 'بانتظار الإدارة'
                          : tr.status === 'approved'
                          ? 'تمت الموافقة قيد التجهيز'
                          : tr.status === 'executed'
                          ? 'تم التنفيذ من المخزن - بانتظار استلامك'
                          : tr.status === 'received'
                          ? 'تم الاستلام في عهدتك'
                          : 'مرفوض'}
                      </span>

                      {tr.status === 'executed' && (
                        <button
                          onClick={() => confirmReceipt(tr.id)}
                          className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] cursor-pointer"
                        >
                          تأكيد استلام الأصناف
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {myRepTransfers.length === 0 && (
                  <div className="text-center py-6 text-xs text-slate-500">
                    لا توجد طلبات تحويل أصناف سابقة.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

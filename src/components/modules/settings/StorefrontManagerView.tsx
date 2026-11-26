import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Package,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Smartphone,
  Sparkles,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime, formatLocaleNumber } from '../../../i18n/translator';
import {
  Product,
  StorefrontBanner,
  StorefrontConfig,
  StorefrontDisplayCategory,
  StorefrontImageCategorySetting,
  StorefrontOffer,
  StorefrontSectionConfig,
  StorefrontShortcut,
  StorefrontTargetType,
} from '../../../types';
import {
  DEFAULT_STOREFRONT_CONFIG,
  isStorefrontWindowActive,
  resolveUnitRegularPrice,
} from '../../../utils/storefront';
import { CustomerStorefrontHome } from '../mobile/CustomerStorefrontHome';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

type CmsTabKey = 'banners' | 'offers' | 'shortcuts' | 'categories' | 'products_sections';

const ICON_OPTIONS = [
  { value: 'tag', labelAr: 'عرض / خصم', labelEn: 'Offer / Discount' },
  { value: 'heart', labelAr: 'المفضلة', labelEn: 'Favorites' },
  { value: 'package', labelAr: 'الطلبات / الصناديق', labelEn: 'Orders / Packages' },
  { value: 'wallet', labelAr: 'كشف الحساب / المحفظة', labelEn: 'Statement / Wallet' },
  { value: 'orders', labelAr: 'الفواتير', labelEn: 'Invoices' },
  { value: 'grid', labelAr: 'الأقسام', labelEn: 'Categories' },
  { value: 'sparkles', labelAr: 'مميز', labelEn: 'Featured' },
];

const TARGET_TYPE_OPTIONS: Array<{ value: StorefrontTargetType; labelAr: string; labelEn: string }> = [
  { value: 'none', labelAr: 'بدون رابط', labelEn: 'No Link' },
  { value: 'offers', labelAr: 'صفحة العروض', labelEn: 'Offers Page' },
  { value: 'category', labelAr: 'قسم محدد', labelEn: 'Specific Category' },
  { value: 'product', labelAr: 'منتج محدد', labelEn: 'Specific Product' },
  { value: 'internal_page', labelAr: 'شاشة داخل التطبيق', labelEn: 'In-App Screen' },
];

const INTERNAL_PAGE_OPTIONS = [
  { value: 'offers', labelAr: 'العروض', labelEn: 'Offers' },
  { value: 'categories', labelAr: 'الأقسام المصورة', labelEn: 'Visual Categories' },
  { value: 'favorites', labelAr: 'المفضلة', labelEn: 'Favorites' },
  { value: 'orders', labelAr: 'طلباتي', labelEn: 'My Orders' },
  { value: 'statement', labelAr: 'كشف الحساب', labelEn: 'Statement' },
  { value: 'cart', labelAr: 'سلة التسوق', labelEn: 'Shopping Cart' },
  { value: 'more', labelAr: 'المزيد', labelEn: 'More' },
];

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function readImageFileAsCompressedDataUrl(file: File, maxDim = 1080): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.onload = () => {
      const src = String(reader.result || '');
      if (!src.startsWith('data:image/')) {
        resolve(src);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || maxDim) * scale));
          const h = Math.max(1, Math.round((img.height || maxDim) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(src);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const out = canvas.toDataURL('image/webp', 0.85);
          resolve(out.startsWith('data:image/') ? out : src);
        } catch {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

function cloneStorefront(src?: StorefrontConfig | null): StorefrontConfig {
  const base = src || DEFAULT_STOREFRONT_CONFIG;
  return {
    version: Number(base.version || 1),
    status: base.status || 'draft',
    updatedAt: base.updatedAt,
    updatedBy: base.updatedBy,
    publishedAt: base.publishedAt,
    publishedBy: base.publishedBy,
    offersSectionTitle: base.offersSectionTitle || 'عروض مخصصة عشانك',
    categoriesSectionTitle: base.categoriesSectionTitle || 'الأقسام المصورة',
    featuredSectionTitle: base.featuredSectionTitle || 'أصناف مقترحة لك',
    banners: Array.isArray(base.banners) ? base.banners.map((b) => ({ ...b })) : [],
    shortcuts: Array.isArray(base.shortcuts)
      ? base.shortcuts.map((s) => ({ ...s }))
      : DEFAULT_STOREFRONT_CONFIG.shortcuts.map((s) => ({ ...s })),
    offers: Array.isArray(base.offers) ? base.offers.map((o) => ({ ...o })) : [],
    imageCategorySettings: Array.isArray(base.imageCategorySettings)
      ? base.imageCategorySettings.map((c) => ({ ...c }))
      : [],
    displayCategories: Array.isArray(base.displayCategories)
      ? base.displayCategories.map((dc) => ({ ...dc, productIds: [...(dc.productIds || [])] }))
      : [],
    featuredProductIds: Array.isArray(base.featuredProductIds) ? [...base.featuredProductIds] : [],
    hiddenProductIds: Array.isArray(base.hiddenProductIds) ? [...base.hiddenProductIds] : [],
    sections:
      Array.isArray(base.sections) && base.sections.length > 0
        ? base.sections.map((sec) => ({ ...sec }))
        : DEFAULT_STOREFRONT_CONFIG.sections.map((sec) => ({ ...sec })),
  };
}

export const StorefrontManagerView: React.FC = () => {
  const { t, language } = usePreferences();
  const {
    products,
    categories,
    settings,
    publishedStorefront,
    storefrontDraft,
    storefrontPublishedAdmin,
    refreshStorefrontAdmin,
    saveStorefrontDraft,
    publishStorefront,
  } = useData();

  const [activeTab, setActiveTab] = useState<CmsTabKey>('banners');
  const [draft, setDraft] = useState<StorefrontConfig>(() =>
    cloneStorefront(storefrontDraft || storefrontPublishedAdmin || publishedStorefront)
  );
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [isLoadingCms, setIsLoadingCms] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showMobilePreview, setShowMobilePreview] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add/Edit Banner form state
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerSubtitle, setBannerSubtitle] = useState('');
  const [bannerImageUrl, setBannerImageUrl] = useState('');
  const [bannerTargetType, setBannerTargetType] = useState<StorefrontTargetType>('offers');
  const [bannerTargetId, setBannerTargetId] = useState('');
  const [bannerStartsAt, setBannerStartsAt] = useState('');
  const [bannerEndsAt, setBannerEndsAt] = useState('');

  // Add Offer form state (promoPrice starts empty '' per zero-default-0 policy)
  const [offerTitle, setOfferTitle] = useState('');
  const [offerProductId, setOfferProductId] = useState('');
  const [offerUnit, setOfferUnit] = useState('');
  const [offerPromoPrice, setOfferPromoPrice] = useState('');
  const [offerBadgeText, setOfferBadgeText] = useState('عرض عشانك');
  const [offerStartsAt, setOfferStartsAt] = useState('');
  const [offerEndsAt, setOfferEndsAt] = useState('');
  const [offerProductSearch, setOfferProductSearch] = useState('');

  // Add Shortcut form state
  const [scLabel, setScLabel] = useState('');
  const [scIconKey, setScIconKey] = useState('tag');
  const [scTargetType, setScTargetType] = useState<StorefrontTargetType>('offers');
  const [scTargetId, setScTargetId] = useState('');

  // Add Display Category form state
  const [dispName, setDispName] = useState('');
  const [dispImageUrl, setDispImageUrl] = useState('');
  const [dispProductSearch, setDispProductSearch] = useState('');
  const [dispSelectedProductIds, setDispSelectedProductIds] = useState<string[]>([]);

  // Featured / Hidden product search
  const [prodFilterSearch, setProdFilterSearch] = useState('');

  const activeProducts = useMemo(
    () => products.filter((p) => p.status === 'active'),
    [products]
  );

  const selectedOfferProduct = useMemo(
    () => activeProducts.find((p) => p.id === offerProductId) || null,
    [activeProducts, offerProductId]
  );

  const selectedOfferProductUnits = useMemo(() => {
    if (!selectedOfferProduct) return [];
    const list = [
      {
        name: selectedOfferProduct.baseUnit,
        regularPrice: resolveUnitRegularPrice(selectedOfferProduct, selectedOfferProduct.baseUnit),
      },
    ];
    for (const u of selectedOfferProduct.units || []) {
      if (u.name && u.name !== selectedOfferProduct.baseUnit) {
        list.push({
          name: u.name,
          regularPrice: resolveUnitRegularPrice(selectedOfferProduct, u.name),
        });
      }
    }
    return list;
  }, [selectedOfferProduct]);

  useEffect(() => {
    if (selectedOfferProduct) {
      setOfferUnit((prev) =>
        selectedOfferProductUnits.some((u) => u.name === prev) ? prev : selectedOfferProduct.baseUnit
      );
    } else {
      setOfferUnit('');
    }
  }, [selectedOfferProduct, selectedOfferProductUnits]);

  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoadingCms(true);
      const res = await refreshStorefrontAdmin();
      if (!active) return;
      setIsLoadingCms(false);
      if (res.success && res.draft) {
        setDraft(cloneStorefront(res.draft));
        setHasUnsavedEdits(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const updateDraft = (updater: (prev: StorefrontConfig) => StorefrontConfig) => {
    setDraft((prev) => updater(prev));
    setHasUnsavedEdits(true);
    setFeedback(null);
  };

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    setFeedback(null);
    const res = await saveStorefrontDraft(draft);
    setIsSavingDraft(false);
    if (res.success) {
      if (res.draft) setDraft(cloneStorefront(res.draft));
      setHasUnsavedEdits(false);
      setFeedback({ type: 'success', text: t('تم حفظ المسودة في السيرفر بنجاح. اضغط "نشر للتطبيق" لتظهر للعملاء.', 'Draft saved on server successfully. Click "Publish to App" to make it live for customers.') });
    } else {
      setFeedback({ type: 'error', text: res.error ? t(res.error) : t('تعذر حفظ مسودة الواجهة', 'Could not save storefront draft') });
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    setFeedback(null);
    const res = await publishStorefront(draft);
    setIsPublishing(false);
    if (res.success) {
      if (res.draft) setDraft(cloneStorefront(res.draft));
      setHasUnsavedEdits(false);
      setFeedback({ type: 'success', text: t('تم نشر واجهة المتجر والعروض وتطبيقها مباشرة على تطبيق العملاء.', 'Storefront and offers published live to customer app.') });
    } else {
      setFeedback({ type: 'error', text: res.error ? t(res.error) : t('تعذر نشر واجهة المتجر', 'Could not publish storefront') });
    }
  };

  const handleRefresh = async () => {
    setIsLoadingCms(true);
    setFeedback(null);
    const res = await refreshStorefrontAdmin();
    setIsLoadingCms(false);
    if (res.success && res.draft) {
      setDraft(cloneStorefront(res.draft));
      setHasUnsavedEdits(false);
    } else if (!res.success) {
      setFeedback({ type: 'error', text: res.error ? t(res.error) : t('تعذر تحميل بيانات واجهة المتجر', 'Could not load storefront data') });
    }
  };

  const handleAddBanner = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bannerTitle.trim() && !bannerImageUrl.trim()) {
      setFeedback({ type: 'error', text: t('يرجى إدخال عنوان البانر أو رفع صورة البانر.', 'Please enter a banner title or upload a banner image.') });
      return;
    }
    const nextBanner: StorefrontBanner = {
      id: makeId('bnr'),
      title: bannerTitle.trim(),
      subtitle: bannerSubtitle.trim() || undefined,
      imageUrl: bannerImageUrl.trim(),
      targetType: bannerTargetType,
      targetId: bannerTargetType === 'none' || bannerTargetType === 'offers' ? '' : bannerTargetId,
      sortOrder: draft.banners.length + 1,
      isActive: true,
      startsAt: bannerStartsAt || undefined,
      endsAt: bannerEndsAt || undefined,
    };
    updateDraft((prev) => ({ ...prev, banners: [...prev.banners, nextBanner] }));
    setBannerTitle('');
    setBannerSubtitle('');
    setBannerImageUrl('');
    setBannerTargetType('offers');
    setBannerTargetId('');
    setBannerStartsAt('');
    setBannerEndsAt('');
  };

  const handleAddOffer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOfferProduct) {
      setFeedback({ type: 'error', text: t('اختر الصنف أولاً.', 'Select a product first.') });
      return;
    }
    const cleanUnit = offerUnit || selectedOfferProduct.baseUnit;
    const regular = resolveUnitRegularPrice(selectedOfferProduct, cleanUnit);
    const parsedPromo = Number(offerPromoPrice);
    if (!offerPromoPrice.trim() || !Number.isFinite(parsedPromo) || parsedPromo <= 0) {
      setFeedback({ type: 'error', text: t('يرجى إدخال سعر عرض صحيح أكبر من صفر.', 'Please enter a valid promo price greater than zero.') });
      return;
    }
    if (regular > 0 && parsedPromo >= regular) {
      setFeedback({
        type: 'error',
        text: t(
          `سعر العرض (${parsedPromo}) يجب أن يكون أقل من السعر الأساسي (${regular}).`,
          `Promo price (${parsedPromo}) must be lower than regular price (${regular}).`
        ),
      });
      return;
    }
    const nextOffer: StorefrontOffer = {
      id: makeId('off'),
      title: offerTitle.trim() || `عرض على ${selectedOfferProduct.name}`,
      productId: selectedOfferProduct.id,
      unit: cleanUnit,
      promoPrice: Math.round(parsedPromo * 100) / 100,
      badgeText: offerBadgeText.trim() || 'عرض عشانك',
      startsAt: offerStartsAt || undefined,
      endsAt: offerEndsAt || undefined,
      sortOrder: draft.offers.length + 1,
      isActive: true,
    };
    updateDraft((prev) => ({ ...prev, offers: [...prev.offers, nextOffer] }));
    setOfferTitle('');
    setOfferPromoPrice('');
    setOfferBadgeText('عرض عشانك');
    setOfferStartsAt('');
    setOfferEndsAt('');
  };

  const handleAddShortcut = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scLabel.trim()) {
      setFeedback({ type: 'error', text: t('يرجى كتابة اسم الاختصار.', 'Please enter shortcut label.') });
      return;
    }
    const nextSc: StorefrontShortcut = {
      id: makeId('sc'),
      label: scLabel.trim(),
      iconKey: scIconKey,
      targetType: scTargetType,
      targetId: scTargetType === 'none' || scTargetType === 'offers' ? '' : scTargetId,
      sortOrder: draft.shortcuts.length + 1,
      isActive: true,
    };
    updateDraft((prev) => ({ ...prev, shortcuts: [...prev.shortcuts, nextSc] }));
    setScLabel('');
    setScTargetId('');
  };

  const upsertImageCategorySetting = (
    categoryId: string,
    patch: Partial<StorefrontImageCategorySetting>
  ) => {
    updateDraft((prev) => {
      const idx = prev.imageCategorySettings.findIndex((c) => c.categoryId === categoryId);
      const list = [...prev.imageCategorySettings];
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch };
      } else {
        list.push({
          categoryId,
          displayName: '',
          imageUrl: '',
          sortOrder: list.length + 1,
          isVisible: true,
          ...patch,
        });
      }
      return { ...prev, imageCategorySettings: list };
    });
  };

  const handleAddDisplayCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispName.trim()) {
      setFeedback({ type: 'error', text: t('يرجى إدخال اسم التصنيف المخصص للعرض.', 'Please enter custom display category name.') });
      return;
    }
    const nextDc: StorefrontDisplayCategory = {
      id: makeId('dcat'),
      name: dispName.trim(),
      imageUrl: dispImageUrl.trim() || undefined,
      productIds: [...dispSelectedProductIds],
      sortOrder: draft.displayCategories.length + 1,
      isActive: true,
    };
    updateDraft((prev) => ({ ...prev, displayCategories: [...prev.displayCategories, nextDc] }));
    setDispName('');
    setDispImageUrl('');
    setDispSelectedProductIds([]);
  };

  const moveSection = (key: string, dir: -1 | 1) => {
    updateDraft((prev) => {
      const sorted = [...prev.sections].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const idx = sorted.findIndex((s) => s.key === key);
      if (idx < 0) return prev;
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= sorted.length) return prev;
      const copy = [...sorted];
      const temp = copy[idx];
      copy[idx] = copy[swapIdx];
      copy[swapIdx] = temp;
      const reindexed: StorefrontSectionConfig[] = copy.map((s, i) => ({
        ...s,
        sortOrder: i + 1,
      }));
      return { ...prev, sections: reindexed };
    });
  };

  const filteredOfferSearchProducts = useMemo(() => {
    const q = offerProductSearch.trim().toLowerCase();
    if (!q) return activeProducts.slice(0, 60);
    return activeProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [activeProducts, offerProductSearch]);

  const filteredDisplayCatProducts = useMemo(() => {
    const q = dispProductSearch.trim().toLowerCase();
    if (!q) return activeProducts.slice(0, 50);
    return activeProducts
      .filter((p) => p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [activeProducts, dispProductSearch]);

  const publishedSource = storefrontPublishedAdmin || publishedStorefront;
  const activeOfferCount = draft.offers.filter((o) => isStorefrontWindowActive(o)).length;
  const activeBannerCount = draft.banners.filter((b) => isStorefrontWindowActive(b)).length;

  const renderTargetIdSelector = (
    targetType: StorefrontTargetType,
    targetId: string,
    onChangeId: (val: string) => void
  ) => {
    if (targetType === 'product') {
      return (
        <select
          value={targetId}
          onChange={(e) => onChangeId(e.target.value)}
          className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs font-bold"
        >
          <option value="">{t('-- اختر الصنف --', '-- Select Product --')}</option>
          {activeProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code})
            </option>
          ))}
        </select>
      );
    }
    if (targetType === 'category') {
      return (
        <select
          value={targetId}
          onChange={(e) => onChangeId(e.target.value)}
          className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs font-bold"
        >
          <option value="">{t('-- اختر القسم --', '-- Select Category --')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {draft.displayCategories.map((dc) => (
            <option key={dc.id} value={dc.id}>
              {dc.name} ({t('تصنيف عرض', 'Display Category')})
            </option>
          ))}
        </select>
      );
    }
    if (targetType === 'internal_page') {
      return (
        <select
          value={targetId}
          onChange={(e) => onChangeId(e.target.value)}
          className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs font-bold"
        >
          <option value="">{t('-- اختر الشاشة --', '-- Select Screen --')}</option>
          {INTERNAL_PAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {language === 'en' ? opt.labelEn : opt.labelAr}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        type="text"
        disabled
        value={t('توجيه تلقائي', 'Auto Routing')}
        className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-200 bg-slate-100 text-xs text-slate-400"
      />
    );
  };

  return (
    <div className="space-y-2.5">
      {/* Top Toolbar */}
      <div className="bg-white rounded-lg border border-slate-200 p-2.5 sm:p-3 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-8 h-8 rounded-lg bg-[#011E58] text-white flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-black text-slate-900">
                {t('إدارة واجهة المتجر والعروض (تطبيق العملاء)', 'Storefront & Offers CMS (Customer App)')}
              </h1>
              <p className="text-[11px] text-slate-500">
                {t(
                  'تحكم في البانرات، العروض والأسعار المخفضة، الاختصارات، والأقسام المصورة عبر مسودة قابلة للمعاينة قبل النشر.',
                  'Manage banners, discounted offers, shortcuts, and visual categories in a previewable draft before publishing.'
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] font-bold">
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              {t('إصدار المسودة:', 'Draft Version:')} {draft.version || 1}
            </span>
            <span className="px-2 py-0.5 rounded bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5]">
              {t('المنشور حالياً:', 'Currently Published:')} {publishedSource.publishedAt ? formatLocaleDateTime(publishedSource.publishedAt) : t('الافتراضي', 'Default')}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              {t('بانرات نشطة:', 'Active Banners:')} {activeBannerCount} · {t('عروض نشطة:', 'Active Offers:')} {activeOfferCount}
            </span>
            {hasUnsavedEdits && (
              <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300">
                {t('يوجد تعديلات غير محفوظة في المسودة', 'Unsaved edits in draft')}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowMobilePreview((v) => !v)}
            className="min-h-[32px] px-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            {showMobilePreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showMobilePreview ? t('إخفاء المعاينة', 'Hide Preview') : t('معاينة الموبايل', 'Mobile Preview')}</span>
          </button>
          <button
            type="button"
            disabled={isLoadingCms}
            onClick={handleRefresh}
            className="min-h-[32px] px-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCms ? 'animate-spin' : ''}`} />
            <span>{t('تحديث', 'Refresh')}</span>
          </button>
          <button
            type="button"
            disabled={isSavingDraft || isPublishing}
            onClick={handleSaveDraft}
            className="min-h-[32px] px-3 rounded-md bg-slate-800 hover:bg-slate-900 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSavingDraft ? t('جاري الحفظ...', 'Saving...') : t('حفظ المسودة', 'Save Draft')}</span>
          </button>
          <button
            type="button"
            disabled={isPublishing || isSavingDraft}
            onClick={handlePublish}
            className="min-h-[32px] px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isPublishing ? t('جاري النشر...', 'Publishing...') : t('نشر للتطبيق الآن', 'Publish to App Now')}</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="bg-white rounded-lg border border-slate-200 p-1 flex flex-wrap gap-1 shadow-2xs">
        {(
          [
            { key: 'banners', label: `${t('البانرات الإعلانية', 'Promotional Banners')} (${draft.banners.length})`, icon: ImageIcon },
            { key: 'offers', label: `${t('العروض والخصومات', 'Offers & Discounts')} (${draft.offers.length})`, icon: Tag },
            { key: 'shortcuts', label: `${t('الاختصارات', 'Shortcuts')} (${draft.shortcuts.length})`, icon: Sparkles },
            { key: 'categories', label: t('الأقسام المصورة والتصنيفات', 'Visual Categories & Groups'), icon: LayoutGrid },
            { key: 'products_sections', label: t('المنتجات المميزة وترتيب الشاشة', 'Featured Items & Section Order'), icon: Layers },
          ] as Array<{ key: CmsTabKey; label: string; icon: React.ComponentType<any> }>
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-[32px] px-2.5 py-1 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors ${
                active
                  ? 'bg-[#011E58] text-white'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Editor + Optional Live Mobile Preview */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start">
        <div className={showMobilePreview ? 'xl:col-span-7 space-y-2.5' : 'xl:col-span-12 space-y-2.5'}>
          {/* TAB 1: BANNERS */}
          {activeTab === 'banners' && (
            <div className="space-y-2.5">
              <form onSubmit={handleAddBanner} className="bg-white rounded-lg border border-slate-200 p-2.5 sm:p-3 space-y-2 shadow-xs">
                <h2 className="text-sm font-black text-slate-900">{t('إضافة بانر إعلاني جديد', 'Add New Promotional Banner')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('عنوان البانر', 'Banner Title')}</label>
                    <input
                      type="text"
                      value={bannerTitle}
                      onChange={(e) => setBannerTitle(e.target.value)}
                      placeholder={t('مثال: عروض أول الشهر على الزيوت', 'e.g., Monthly Oil Promotions')}
                      className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('نص فرعي (اختياري)', 'Subtitle (Optional)')}</label>
                    <input
                      type="text"
                      value={bannerSubtitle}
                      onChange={(e) => setBannerSubtitle(e.target.value)}
                      placeholder={t('مثال: خصومات حصرية لطلبات الجملة', 'e.g., Exclusive wholesale order discounts')}
                      className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('صورة البانر (رفع أو رابط)', 'Banner Image (Upload or URL)')}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        dir="ltr"
                        value={bannerImageUrl}
                        onChange={(e) => setBannerImageUrl(e.target.value)}
                        placeholder={t('https://... أو ارفع صورة', 'https://... or upload image')}
                        className="flex-1 min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs"
                      />
                      <label className="min-h-[32px] h-8 px-2.5 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] text-xs font-black flex items-center gap-1 cursor-pointer shrink-0">
                        <Upload className="w-4 h-4" />
                        <span>{t('رفع', 'Upload')}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const url = await readImageFileAsCompressedDataUrl(file, 1280);
                            setBannerImageUrl(url);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('نوع التوجيه عند الضغط', 'Click Action Type')}</label>
                      <select
                        value={bannerTargetType}
                        onChange={(e) => {
                          setBannerTargetType(e.target.value as StorefrontTargetType);
                          setBannerTargetId('');
                        }}
                        className="w-full min-h-[32px] h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold"
                      >
                        {TARGET_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {language === 'en' ? opt.labelEn : opt.labelAr}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('الهدف', 'Target')}</label>
                      {renderTargetIdSelector(bannerTargetType, bannerTargetId, setBannerTargetId)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('بداية الظهور (اختياري)', 'Start Date (Optional)')}</label>
                    <input
                      type="datetime-local"
                      value={bannerStartsAt}
                      onChange={(e) => setBannerStartsAt(e.target.value)}
                      className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('نهاية الظهور (اختياري)', 'End Date (Optional)')}</label>
                    <input
                      type="datetime-local"
                      value={bannerEndsAt}
                      onChange={(e) => setBannerEndsAt(e.target.value)}
                      className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="min-h-[32px] h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('إضافة البانر للمسودة', 'Add Banner to Draft')}</span>
                </button>
              </form>

              <UnifiedDataTable<StorefrontBanner>
                compact
                searchable={false}
                paginated={false}
                title={`${t('البانرات الحالية', 'Current Banners')} (${draft.banners.length})`}
                subtitle={t('لا تظهر أي بانرات وهمية للعميل عند فراغ القائمة', 'No placeholder banners are shown to customers when empty')}
                data={draft.banners}
                rowKey={(bnr) => bnr.id}
                emptyTitle={t('لم يتم إضافة بانرات بعد', 'No banners added yet')}
                columns={[
                  {
                    key: 'image',
                    header: t('الصورة', 'Image'),
                    width: '80px',
                    render: (bnr) => (
                      <div className="w-20 h-12 rounded-lg bg-slate-200 overflow-hidden flex items-center justify-center">
                        {bnr.imageUrl ? <img src={bnr.imageUrl} alt={bnr.title} className="w-full h-full object-cover" /> : <ImageIcon className="w-4 h-4 text-slate-400" />}
                      </div>
                    ),
                  },
                  {
                    key: 'title',
                    header: t('العنوان والوصف', 'Title & Subtitle'),
                    render: (bnr) => (
                      <div>
                        <p className="font-black text-slate-900">{bnr.title || t('بانر بدون عنوان', 'Untitled Banner')}</p>
                        {bnr.subtitle && <p className="text-[11px] text-slate-500">{bnr.subtitle}</p>}
                      </div>
                    ),
                  },
                  { key: 'targetType', header: t('التوجيه', 'Target'), render: (bnr) => <span className="font-mono text-slate-600">{bnr.targetType}</span> },
                  {
                    key: 'isActive',
                    header: t('نشط', 'Active'),
                    align: 'center',
                    render: (bnr) => (
                      <input
                        type="checkbox"
                        checked={bnr.isActive}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            banners: prev.banners.map((b) => (b.id === bnr.id ? { ...b, isActive: e.target.checked } : b)),
                          }))
                        }
                      />
                    ),
                  },
                  {
                    key: 'actions',
                    header: t('حذف', 'Delete'),
                    align: 'center',
                    render: (bnr) => (
                      <button
                        type="button"
                        onClick={() => updateDraft((prev) => ({ ...prev, banners: prev.banners.filter((b) => b.id !== bnr.id) }))}
                        className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer"
                        aria-label={t('حذف البانر', 'Delete Banner')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {/* TAB 2: OFFERS */}
          {activeTab === 'offers' && (
            <div className="space-y-2.5">
              <div className="bg-white rounded-lg border border-slate-200 p-2.5 sm:p-3 space-y-1.5 shadow-xs">
                <label className="block text-[11px] font-bold text-slate-600">{t('عنوان قسم العروض في الصفحة الرئيسية', 'Offers Section Title on Home Screen')}</label>
                <input
                  type="text"
                  value={draft.offersSectionTitle || ''}
                  onChange={(e) => updateDraft((prev) => ({ ...prev, offersSectionTitle: e.target.value }))}
                  placeholder={t('عروض مخصصة عشانك', 'Special Offers For You')}
                  className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs font-bold"
                />
              </div>

              <form onSubmit={handleAddOffer} className="bg-white rounded-lg border border-slate-200 p-2.5 sm:p-3 space-y-2 shadow-xs">
                <h2 className="text-sm font-black text-slate-900">{t('إضافة عرض بسعر مخفض حقيقي', 'Add Real Discounted Offer')}</h2>
                <p className="text-[11px] text-slate-500">
                  {t(
                    'يتم تطبيق سعر العرض تلقائياً من السيرفر عند إنشاء الطلب، ولا يمكن إدخال سعر عرض مساوٍ أو أعلى من السعر الأصلي.',
                    'Promo prices are applied server-side when creating orders and cannot equal or exceed the regular price.'
                  )}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('ابحث عن الصنف', 'Search Product')}</label>
                    <div className="relative mb-1.5">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2.5 top-2.5" />
                      <input
                        type="text"
                        value={offerProductSearch}
                        onChange={(e) => setOfferProductSearch(e.target.value)}
                        placeholder={t('بحث بالاسم أو الكود أو الباركود...', 'Search by name, code, or barcode...')}
                        className="w-full h-8 ps-8 pe-2.5 rounded-md border border-slate-300 text-xs"
                      />
                    </div>
                    <select
                      value={offerProductId}
                      onChange={(e) => setOfferProductId(e.target.value)}
                      className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs font-bold"
                    >
                      <option value="">{t('-- اختر الصنف --', '-- Select Product --')}</option>
                      {filteredOfferSearchProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('الوحدة', 'Unit')}</label>
                      <select
                        value={offerUnit}
                        onChange={(e) => setOfferUnit(e.target.value)}
                        disabled={!selectedOfferProduct}
                        className="w-full min-h-[32px] h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold"
                      >
                        {selectedOfferProductUnits.map((u) => (
                          <option key={u.name} value={u.name}>
                            {t(u.name)} ({formatLocaleNumber(u.regularPrice)} {t(settings.currency)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        {t('سعر العرض', 'Promo Price')} ({t(settings.currency)})
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={offerPromoPrice}
                        onChange={(e) => setOfferPromoPrice(e.target.value)}
                        placeholder={t('أدخل سعر العرض', 'Enter promo price')}
                        className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs font-black awlad-tabular"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('عنوان العرض', 'Offer Title')}</label>
                    <input
                      type="text"
                      value={offerTitle}
                      onChange={(e) => setOfferTitle(e.target.value)}
                      placeholder={t('اختياري (يملأ تلقائياً باسم الصنف)', 'Optional (auto-filled from item name)')}
                      className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('شارة العرض الحمراء', 'Red Offer Badge')}</label>
                    <input
                      type="text"
                      value={offerBadgeText}
                      onChange={(e) => setOfferBadgeText(e.target.value)}
                      placeholder={t('عرض عشانك', 'Special Offer')}
                      className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs font-bold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('من تاريخ', 'From Date')}</label>
                      <input
                        type="datetime-local"
                        value={offerStartsAt}
                        onChange={(e) => setOfferStartsAt(e.target.value)}
                        className="w-full min-h-[32px] h-8 px-2 rounded-md border border-slate-300 text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('إلى تاريخ', 'To Date')}</label>
                      <input
                        type="datetime-local"
                        value={offerEndsAt}
                        onChange={(e) => setOfferEndsAt(e.target.value)}
                        className="w-full min-h-[32px] h-8 px-2 rounded-md border border-slate-300 text-[11px]"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="min-h-[32px] h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('إضافة العرض للمسودة', 'Add Offer to Draft')}</span>
                </button>
              </form>

              <UnifiedDataTable<StorefrontOffer>
                compact
                paginated={false}
                title={`${t('العروض المسجلة', 'Registered Offers')} (${draft.offers.length})`}
                data={draft.offers}
                rowKey={(off) => off.id}
                searchPlaceholder={t('بحث باسم الصنف أو عنوان العرض...', 'Search by product name or offer title...')}
                searchFilter={(off, q) => {
                  const prod = products.find((p) => p.id === off.productId);
                  return (prod?.name || off.title || '').toLowerCase().includes(q) || (off.badgeText || '').toLowerCase().includes(q);
                }}
                emptyTitle={t('لا توجد عروض مسجلة حالياً', 'No offers registered yet')}
                columns={[
                  {
                    key: 'title',
                    header: t('الصنف والشارة', 'Item & Badge'),
                    render: (off) => {
                      const prod = products.find((p) => p.id === off.productId);
                      return (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="bg-[#C81E1E] text-white text-[10px] font-black px-2 py-0.5 rounded-md">
                            {off.badgeText || t('عرض عشانك', 'Special Offer')}
                          </span>
                          <span className="font-black text-slate-900">{prod?.name || off.title}</span>
                        </div>
                      );
                    },
                  },
                  {
                    key: 'unit',
                    header: t('الوحدة', 'Unit'),
                    align: 'center',
                    render: (off) => {
                      const prod = products.find((p) => p.id === off.productId);
                      return t(off.unit || prod?.baseUnit || '-');
                    },
                  },
                  {
                    key: 'promoPrice',
                    header: t('سعر العرض', 'Promo Price'),
                    align: 'center',
                    render: (off) => {
                      const prod = products.find((p) => p.id === off.productId);
                      const regular = prod ? resolveUnitRegularPrice(prod, off.unit || prod.baseUnit) : 0;
                      const validPrice = regular > 0 && off.promoPrice < regular;
                      return (
                        <div className="font-mono tabular-nums">
                          <span className="text-[#003589] font-black">{formatLocaleNumber(off.promoPrice)} {t(settings.currency)}</span>
                          {!validPrice && regular > 0 && <span className="block text-[10px] text-red-600 font-sans">{t('ليس أقل من الأصلي!', 'Not lower than regular price!')}</span>}
                        </div>
                      );
                    },
                  },
                  {
                    key: 'regularPrice',
                    header: t('السعر الأصلي', 'Regular Price'),
                    align: 'center',
                    render: (off) => {
                      const prod = products.find((p) => p.id === off.productId);
                      const regular = prod ? resolveUnitRegularPrice(prod, off.unit || prod.baseUnit) : 0;
                      return regular > 0 ? <span className="line-through text-slate-400 font-mono tabular-nums">{formatLocaleNumber(regular)} {t(settings.currency)}</span> : '-';
                    },
                  },
                  {
                    key: 'isActive',
                    header: t('نشط', 'Active'),
                    align: 'center',
                    render: (off) => (
                      <input
                        type="checkbox"
                        checked={off.isActive}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            offers: prev.offers.map((o) => (o.id === off.id ? { ...o, isActive: e.target.checked } : o)),
                          }))
                        }
                      />
                    ),
                  },
                  {
                    key: 'actions',
                    header: t('حذف', 'Delete'),
                    align: 'center',
                    render: (off) => (
                      <button
                        type="button"
                        onClick={() => updateDraft((prev) => ({ ...prev, offers: prev.offers.filter((o) => o.id !== off.id) }))}
                        className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer"
                        aria-label={t('حذف العرض', 'Delete Offer')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {/* TAB 3: SHORTCUTS */}
          {activeTab === 'shortcuts' && (
            <div className="space-y-2.5">
              <form onSubmit={handleAddShortcut} className="bg-white rounded-lg border border-slate-200 p-2.5 sm:p-3 space-y-2 shadow-xs">
                <h2 className="text-sm font-black text-slate-900">{t('إضافة اختصار سريع لشريط "إختصاراتك"', 'Add Quick Shortcut to "Your Shortcuts" Bar')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('اسم الاختصار', 'Shortcut Label')}</label>
                    <input
                      type="text"
                      value={scLabel}
                      onChange={(e) => setScLabel(e.target.value)}
                      placeholder={t('مثال: عروض اليوم', 'e.g., Today Offers')}
                      className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('الأيقونة', 'Icon')}</label>
                    <select
                      value={scIconKey}
                      onChange={(e) => setScIconKey(e.target.value)}
                      className="w-full min-h-[32px] h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold"
                    >
                      {ICON_OPTIONS.map((ic) => (
                        <option key={ic.value} value={ic.value}>
                          {language === 'en' ? ic.labelEn : ic.labelAr}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('نوع التوجيه', 'Action Type')}</label>
                    <select
                      value={scTargetType}
                      onChange={(e) => {
                        setScTargetType(e.target.value as StorefrontTargetType);
                        setScTargetId('');
                      }}
                      className="w-full min-h-[32px] h-8 px-2 rounded-md border border-slate-300 bg-white text-xs font-bold"
                    >
                      {TARGET_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {language === 'en' ? opt.labelEn : opt.labelAr}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('الهدف', 'Target')}</label>
                    {renderTargetIdSelector(scTargetType, scTargetId, setScTargetId)}
                  </div>
                </div>
                <button
                  type="submit"
                  className="min-h-[32px] h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('إضافة الاختصار', 'Add Shortcut')}</span>
                </button>
              </form>

              <UnifiedDataTable<StorefrontShortcut>
                compact
                searchable={false}
                paginated={false}
                title={`${t('الاختصارات الحالية', 'Current Shortcuts')} (${draft.shortcuts.length})`}
                data={draft.shortcuts}
                rowKey={(sc) => sc.id}
                emptyTitle={t('لا توجد اختصارات', 'No shortcuts')}
                columns={[
                  { key: 'label', header: t('الاختصار', 'Shortcut'), render: (sc) => <span className="font-black text-slate-900">{sc.label}</span> },
                  { key: 'iconKey', header: t('الأيقونة', 'Icon'), render: (sc) => <span className="font-mono text-slate-600">{sc.iconKey}</span> },
                  { key: 'target', header: t('التوجيه', 'Target'), render: (sc) => <span className="text-slate-600">{sc.targetType} {sc.targetId ? `(${sc.targetId})` : ''}</span> },
                  {
                    key: 'isActive',
                    header: t('مفعل', 'Active'),
                    align: 'center',
                    render: (sc) => (
                      <input
                        type="checkbox"
                        checked={sc.isActive}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            shortcuts: prev.shortcuts.map((item) => (item.id === sc.id ? { ...item, isActive: e.target.checked } : item)),
                          }))
                        }
                      />
                    ),
                  },
                  {
                    key: 'actions',
                    header: t('حذف', 'Delete'),
                    align: 'center',
                    render: (sc) => (
                      <button
                        type="button"
                        onClick={() => updateDraft((prev) => ({ ...prev, shortcuts: prev.shortcuts.filter((item) => item.id !== sc.id) }))}
                        className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer"
                        aria-label={t('حذف الاختصار', 'Delete Shortcut')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {/* TAB 4: IMAGE CATEGORIES & APP DISPLAY CATEGORIES */}
          {activeTab === 'categories' && (
            <div className="space-y-2.5">
              <div className="bg-white rounded-lg border border-slate-200 p-2.5 sm:p-3 space-y-1.5 shadow-xs">
                <label className="block text-[11px] font-bold text-slate-600">{t('عنوان شاشة الأقسام المصورة', 'Visual Categories Section Title')}</label>
                <input
                  type="text"
                  value={draft.categoriesSectionTitle || ''}
                  onChange={(e) => updateDraft((prev) => ({ ...prev, categoriesSectionTitle: e.target.value }))}
                  placeholder={t('الأقسام المصورة', 'Visual Categories')}
                  className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs font-bold"
                />
              </div>

              <UnifiedDataTable
                compact
                paginated={false}
                title={t('تخصيص صور وأسماء أقسام الأصناف', 'Customize Product Category Images & Titles')}
                subtitle={t('ارفع صورة لكل قسم أو عدل اسم العرض أو أخفه من واجهة المتجر فقط دون المساس بأقسام المخزون في ERP', 'Upload images, customize display names, or hide categories in the storefront without modifying ERP inventory categories')}
                data={categories.map((cat, idx) => ({ ...cat, _idx: idx }))}
                rowKey={(cat) => cat.id}
                searchPlaceholder={t('بحث باسم القسم...', 'Search by category name...')}
                searchFilter={(cat, q) => cat.name.toLowerCase().includes(q)}
                columns={[
                  {
                    key: 'image',
                    header: t('الصورة', 'Image'),
                    width: '60px',
                    render: (cat) => {
                      const ov = draft.imageCategorySettings.find((c) => c.categoryId === cat.id);
                      return (
                        <div className="w-11 h-11 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center">
                          {ov?.imageUrl ? <img src={ov.imageUrl} alt={cat.name} className="w-full h-full object-cover" /> : <LayoutGrid className="w-5 h-5 text-[#003589]/60" />}
                        </div>
                      );
                    },
                  },
                  { key: 'name', header: t('القسم الأساسي', 'Base Category'), render: (cat) => <span className="font-bold text-slate-800">{cat.name}</span> },
                  {
                    key: 'displayName',
                    header: t('اسم العرض بالتطبيق', 'App Display Name'),
                    render: (cat) => {
                      const ov = draft.imageCategorySettings.find((c) => c.categoryId === cat.id);
                      return (
                        <input
                          type="text"
                          value={ov?.displayName ?? ''}
                          onChange={(e) => upsertImageCategorySetting(cat.id, { displayName: e.target.value, sortOrder: ov?.sortOrder ?? cat._idx + 1 })}
                          placeholder={`${t('افتراضي:', 'Default:')} ${cat.name}`}
                          className="w-full min-h-[34px] px-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                        />
                      );
                    },
                  },
                  {
                    key: 'imageUrl',
                    header: t('صورة القسم', 'Category Image'),
                    render: (cat) => {
                      const ov = draft.imageCategorySettings.find((c) => c.categoryId === cat.id);
                      return (
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            dir="ltr"
                            value={ov?.imageUrl ?? ''}
                            onChange={(e) => upsertImageCategorySetting(cat.id, { imageUrl: e.target.value, sortOrder: ov?.sortOrder ?? cat._idx + 1 })}
                            placeholder={t('رابط الصورة أو ارفع...', 'Image URL or upload...')}
                            className="flex-1 min-w-[130px] min-h-[34px] px-2 rounded-lg border border-slate-300 bg-white text-xs"
                          />
                          <label className="min-h-[34px] px-2.5 rounded-lg bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] text-xs font-black flex items-center cursor-pointer">
                            <Upload className="w-3.5 h-3.5" />
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                const url = await readImageFileAsCompressedDataUrl(f, 720);
                                upsertImageCategorySetting(cat.id, { imageUrl: url, sortOrder: ov?.sortOrder ?? cat._idx + 1 });
                              }}
                            />
                          </label>
                        </div>
                      );
                    },
                  },
                  {
                    key: 'isVisible',
                    header: t('ظاهر', 'Visible'),
                    align: 'center',
                    render: (cat) => {
                      const ov = draft.imageCategorySettings.find((c) => c.categoryId === cat.id);
                      const isVisible = ov ? ov.isVisible !== false : true;
                      return (
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={(e) => upsertImageCategorySetting(cat.id, { isVisible: e.target.checked, sortOrder: ov?.sortOrder ?? cat._idx + 1 })}
                        />
                      );
                    },
                  },
                ]}
              />

              {/* App-only Display Categories */}
              <form onSubmit={handleAddDisplayCategory} className="bg-white rounded-lg border border-slate-200 p-2.5 sm:p-3 space-y-2 shadow-xs">
                <h2 className="text-sm font-black text-slate-900">{t('إضافة تصنيف عرض إضافي خاص بالتطبيق فقط', 'Add App-Only Display Category')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('اسم تصنيف العرض', 'Display Category Name')}</label>
                    <input
                      type="text"
                      value={dispName}
                      onChange={(e) => setDispName(e.target.value)}
                      placeholder={t('مثال: تجهيزات رمضان / الأكثر طلباً', 'e.g., Seasonal Specials / Best Sellers')}
                      className="w-full min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('صورة التصنيف (اختياري)', 'Category Image (Optional)')}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        dir="ltr"
                        value={dispImageUrl}
                        onChange={(e) => setDispImageUrl(e.target.value)}
                        placeholder={t('رابط الصورة أو ارفع...', 'Image URL or upload...')}
                        className="flex-1 min-h-[32px] h-8 px-2.5 rounded-md border border-slate-300 text-xs"
                      />
                      <label className="min-h-[32px] h-8 px-2.5 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] text-xs font-black flex items-center gap-1 cursor-pointer">
                        <Upload className="w-4 h-4" />
                        <span>{t('رفع', 'Upload')}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const url = await readImageFileAsCompressedDataUrl(f, 720);
                            setDispImageUrl(url);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-slate-600">
                    {t('اختر المنتجات المرتبطة بهذا التصنيف', 'Select products linked to this category')} ({dispSelectedProductIds.length} {t('محدد', 'selected')})
                  </label>
                  <input
                    type="text"
                    value={dispProductSearch}
                    onChange={(e) => setDispProductSearch(e.target.value)}
                    placeholder={t('بحث عن منتجات لضمها...', 'Search products to include...')}
                    className="w-full h-8 px-2.5 rounded-md border border-slate-300 text-xs"
                  />
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {filteredDisplayCatProducts.map((p) => {
                      const checked = dispSelectedProductIds.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className={`p-1.5 rounded-lg border text-xs font-bold flex items-center gap-2 cursor-pointer ${
                            checked ? 'bg-[#EEF3FA] border-[#003589] text-[#011E58]' : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setDispSelectedProductIds((prev) =>
                                e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                              )
                            }
                          />
                          <span className="truncate">{p.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  className="min-h-[32px] h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('إضافة تصنيف العرض', 'Add Display Category')}</span>
                </button>

                {draft.displayCategories.length > 0 && (
                  <div className="pt-2">
                    <UnifiedDataTable<StorefrontDisplayCategory>
                      compact
                      searchable={false}
                      paginated={false}
                      data={draft.displayCategories}
                      rowKey={(dc) => dc.id}
                      columns={[
                        {
                          key: 'image',
                          header: t('الصورة', 'Image'),
                          width: '56px',
                          render: (dc) => (
                            <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center">
                              {dc.imageUrl ? <img src={dc.imageUrl} alt={dc.name} className="w-full h-full object-cover" /> : <LayoutGrid className="w-4 h-4 text-[#003589]" />}
                            </div>
                          ),
                        },
                        { key: 'name', header: t('اسم التصنيف', 'Category Name'), render: (dc) => <span className="font-black text-slate-900">{dc.name}</span> },
                        { key: 'count', header: t('عدد الأصناف', 'Items Count'), align: 'center', render: (dc) => <span className="font-mono tabular-nums">{dc.productIds.length} {t('صنف', 'items')}</span> },
                        {
                          key: 'actions',
                          header: t('حذف', 'Delete'),
                          align: 'center',
                          render: (dc) => (
                            <button
                              type="button"
                              onClick={() => updateDraft((prev) => ({ ...prev, displayCategories: prev.displayCategories.filter((item) => item.id !== dc.id) }))}
                              className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
              </form>
            </div>
          )}

          {/* TAB 5: FEATURED / HIDDEN PRODUCTS & HOMEPAGE SECTIONS */}
          {activeTab === 'products_sections' && (
            <div className="space-y-2.5">
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                title={t('ترتيب وظهور أقسام الصفحة الرئيسية', 'Homepage Section Order & Visibility')}
                headerActions={
                  <input
                    type="text"
                    value={draft.featuredSectionTitle || ''}
                    onChange={(e) => updateDraft((prev) => ({ ...prev, featuredSectionTitle: e.target.value }))}
                    placeholder={t('عنوان الأصناف المقترحة', 'Featured Products Title')}
                    className="min-h-[34px] px-3 rounded-xl border border-slate-300 text-xs font-bold bg-white text-slate-900"
                  />
                }
                data={[...draft.sections].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((sec, idx, arr) => ({ ...sec, _idx: idx, _total: arr.length }))}
                rowKey={(sec) => sec.key}
                columns={[
                  { key: '_idx', header: '#', width: '48px', align: 'center', render: (sec) => <span className="font-mono font-black text-blue-900">{sec._idx + 1}</span> },
                  {
                    key: 'title',
                    header: t('عنوان القسم بالتطبيق', 'App Section Title'),
                    render: (sec) => (
                      <input
                        type="text"
                        value={sec.title}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            sections: prev.sections.map((s) => (s.key === sec.key ? { ...s, title: e.target.value } : s)),
                          }))
                        }
                        className="w-full min-h-[34px] px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                      />
                    ),
                  },
                  {
                    key: 'order',
                    header: t('الترتيب', 'Order'),
                    align: 'center',
                    render: (sec) => (
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" disabled={sec._idx === 0} onClick={() => moveSection(sec.key, -1)} className="p-1.5 rounded-lg bg-slate-100 border border-slate-200 disabled:opacity-40 cursor-pointer" aria-label={t('أعلى', 'Move Up')}>
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" disabled={sec._idx === sec._total - 1} onClick={() => moveSection(sec.key, 1)} className="p-1.5 rounded-lg bg-slate-100 border border-slate-200 disabled:opacity-40 cursor-pointer" aria-label={t('أسفل', 'Move Down')}>
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ),
                  },
                  {
                    key: 'isVisible',
                    header: t('إظهار', 'Visible'),
                    align: 'center',
                    render: (sec) => (
                      <input
                        type="checkbox"
                        checked={sec.isVisible !== false}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            sections: prev.sections.map((s) => (s.key === sec.key ? { ...s, isVisible: e.target.checked } : s)),
                          }))
                        }
                      />
                    ),
                  },
                ]}
              />

              <UnifiedDataTable<Product>
                compact
                title={t('الأصناف المميزة والمخفية في التطبيق', 'Featured & Hidden App Products')}
                subtitle={`${t('مميزة:', 'Featured:')} ${draft.featuredProductIds.length} · ${t('مخفية عن العميل:', 'Hidden from customer:')} ${draft.hiddenProductIds.length}`}
                data={activeProducts}
                rowKey={(p) => p.id}
                searchValue={prodFilterSearch}
                onSearchChange={setProdFilterSearch}
                searchPlaceholder={t('بحث بالاسم أو القسم أو الكود...', 'Search by name, category, or code...')}
                searchFilter={(p, q) =>
                  p.name.toLowerCase().includes(q) ||
                  (p.category || '').toLowerCase().includes(q) ||
                  (p.code || '').toLowerCase().includes(q)
                }
                defaultPageSize={15}
                columns={[
                  {
                    key: 'code',
                    header: t('الرمز', 'Icon'),
                    width: '64px',
                    render: () => (
                      <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                        <Package className="w-4 h-4 text-slate-300" />
                      </div>
                    ),
                  },
                  { key: 'name', header: t('اسم الصنف', 'Item Name'), render: (p) => <span className="font-black text-slate-900">{p.name}</span> },
                  { key: 'category', header: t('القسم', 'Category'), render: (p) => <span className="text-slate-600">{t(p.category || '')}</span> },
                  {
                    key: 'sellingPrice',
                    header: t('السعر', 'Price'),
                    align: 'center',
                    render: (p) => <span className="font-mono font-bold tabular-nums">{formatLocaleNumber(p.sellingPrice)} {t(settings.currency)}</span>,
                  },
                  {
                    key: 'featured',
                    header: t('مميز', 'Featured'),
                    align: 'center',
                    render: (p) => (
                      <input
                        type="checkbox"
                        checked={draft.featuredProductIds.includes(p.id)}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            featuredProductIds: e.target.checked
                              ? [...prev.featuredProductIds, p.id]
                              : prev.featuredProductIds.filter((id) => id !== p.id),
                          }))
                        }
                      />
                    ),
                  },
                  {
                    key: 'hidden',
                    header: t('إخفاء', 'Hide'),
                    align: 'center',
                    render: (p) => (
                      <input
                        type="checkbox"
                        checked={draft.hiddenProductIds.includes(p.id)}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            hiddenProductIds: e.target.checked
                              ? [...prev.hiddenProductIds, p.id]
                              : prev.hiddenProductIds.filter((id) => id !== p.id),
                          }))
                        }
                      />
                    ),
                  },
                ]}
              />
            </div>
          )}
        </div>

        {/* Live Mobile Storefront Preview Panel */}
        {showMobilePreview && (
          <div className="xl:col-span-5 xl:sticky xl:top-20 flex flex-col items-center">
            <div className="w-full max-w-[390px] bg-slate-900 rounded-[2.2rem] p-3 shadow-2xl border-4 border-slate-800">
              <div className="bg-[#011E58] text-white rounded-t-[1.6rem] px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-white p-0.5 flex items-center justify-center shrink-0">
                    <img
                      src="/awlad-selim-logo.png"
                      alt={t('أولاد سليم', 'Awlad Selim')}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-black leading-none">{t('أولاد سليم', 'Awlad Selim')}</p>
                    <p className="text-[10px] text-[#DCE6F5] mt-0.5">{t('معاينة المسودة المباشرة', 'Live Draft Preview')}</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-white/15 text-[10px] font-bold">
                  {hasUnsavedEdits ? t('مسودة معدلة', 'Modified Draft') : t('محدث', 'Up to Date')}
                </span>
              </div>
              <div className="bg-[#F4F6FA] rounded-b-[1.6rem] p-3 max-h-[640px] overflow-y-auto">
                <CustomerStorefrontHome
                  storefront={draft}
                  products={activeProducts}
                  categories={categories}
                  currency={t(settings.currency || 'ج.م')}
                  allowPriceView={true}
                  favoriteIds={[]}
                  cartItems={[]}
                  selectedUnitsByProd={{}}
                  onSelectUnit={() => {}}
                  onAddToCart={() => {}}
                  onUpdateCartItemQty={() => {}}
                  onToggleFavorite={() => {}}
                  onNavigateTab={() => {}}
                  onOpenCategory={() => {}}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

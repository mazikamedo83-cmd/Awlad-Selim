import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Heart,
  Package,
  Plus,
  Minus,
  ShoppingCart,
  Sparkles,
  Tag,
  Wallet,
  ClipboardList,
  LayoutGrid,
  Check,
  X,
} from 'lucide-react';
import {
  Product,
  ProductCategory,
  StorefrontBanner,
  StorefrontConfig,
  StorefrontShortcut,
} from '../../../types';
import {
  isStorefrontWindowActive,
  resolveActiveStorefrontOffer,
  ResolvedProductPromo,
} from '../../../utils/storefront';
import { usePreferences } from '../../../context/PreferencesContext';

export interface CustomerCartItem {
  product: Product;
  quantity: number;
  unitName: string;
  unitFactor: number;
  unitPrice: number | null;
}

interface CustomerStorefrontHomeProps {
  storefront: StorefrontConfig;
  products: Product[];
  categories: ProductCategory[];
  cachedMediaMap: Record<string, string>;
  currency: string;
  allowPriceView: boolean;
  favoriteIds: string[];
  cartItems: CustomerCartItem[];
  selectedUnitsByProd: Record<string, string>;
  onSelectUnit: (productId: string, unitName: string) => void;
  onAddToCart: (product: Product, unitName?: string, qty?: number, originRect?: DOMRect | null) => void;
  onUpdateCartItemQty: (productId: string, unitName: string, delta: number) => void;
  onToggleFavorite: (productId: string) => void;
  onNavigateTab: (tab: 'home' | 'categories' | 'offers' | 'favorites' | 'more' | 'cart' | 'orders' | 'account') => void;
  onOpenCategory: (categoryName: string, displayCategoryProductIds?: string[]) => void;
}

const getShortcutIcon = (iconKey: string) => {
  switch (iconKey) {
    case 'tag':
      return Tag;
    case 'heart':
      return Heart;
    case 'package':
      return Package;
    case 'wallet':
      return Wallet;
    case 'orders':
      return ClipboardList;
    case 'grid':
      return LayoutGrid;
    default:
      return Sparkles;
  }
};

export const CustomerStorefrontHome: React.FC<CustomerStorefrontHomeProps> = ({
  storefront,
  products,
  categories,
  cachedMediaMap,
  currency,
  allowPriceView,
  favoriteIds,
  cartItems,
  selectedUnitsByProd,
  onSelectUnit,
  onAddToCart,
  onUpdateCartItemQty,
  onToggleFavorite,
  onNavigateTab,
  onOpenCategory,
}) => {
  const { t } = usePreferences();
  const [activeBannerIdx, setActiveBannerIdx] = useState(0);
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const [quickQty, setQuickQty] = useState(1);
  const touchStartXRef = useRef<number | null>(null);
  const [bannerTick, setBannerTick] = useState(0);

  const hiddenSet = useMemo(
    () => new Set((storefront.hiddenProductIds || []).map(String)),
    [storefront.hiddenProductIds]
  );

  const visibleProducts = useMemo(
    () => products.filter((p) => p.status === 'active' && !hiddenSet.has(p.id)),
    [products, hiddenSet]
  );

  const activeBanners = useMemo(
    () =>
      (storefront.banners || [])
        .filter((b) => isStorefrontWindowActive(b) && (b.imageUrl || b.title))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [storefront.banners]
  );

  useEffect(() => {
    if (activeBannerIdx >= activeBanners.length && activeBanners.length > 0) {
      setActiveBannerIdx(0);
    }
  }, [activeBanners.length, activeBannerIdx]);

  useEffect(() => {
    if (activeBanners.length <= 1) return;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const timer = window.setInterval(() => {
      setActiveBannerIdx((prev) => (prev + 1) % activeBanners.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [activeBanners.length, bannerTick]);

  const activeShortcuts = useMemo(
    () =>
      (storefront.shortcuts || [])
        .filter((s) => s.isActive !== false && s.label)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [storefront.shortcuts]
  );

  const offerProductPairs = useMemo(() => {
    const out: Array<{ product: Product; unitName: string; promo: ResolvedProductPromo }> = [];
    for (const prod of visibleProducts) {
      const preferredUnit = selectedUnitsByProd[prod.id] || prod.baseUnit;
      let promo = resolveActiveStorefrontOffer(prod, preferredUnit, storefront);
      let matchedUnit = preferredUnit;
      if (!promo.hasPromo && Array.isArray(prod.units)) {
        for (const u of prod.units) {
          const check = resolveActiveStorefrontOffer(prod, u.name, storefront);
          if (check.hasPromo) {
            promo = check;
            matchedUnit = u.name;
            break;
          }
        }
      }
      if (promo.hasPromo) {
        out.push({ product: prod, unitName: matchedUnit, promo });
      }
    }
    return out;
  }, [visibleProducts, selectedUnitsByProd, storefront]);

  const featuredProducts = useMemo(() => {
    const idOrder = storefront.featuredProductIds || [];
    if (idOrder.length > 0) {
      const map = new Map(visibleProducts.map((p) => [p.id, p]));
      const ordered = idOrder.map((id) => map.get(id)).filter(Boolean) as Product[];
      if (ordered.length > 0) return ordered;
    }
    return visibleProducts.slice(0, 12);
  }, [visibleProducts, storefront.featuredProductIds]);

  const imageCategoryTiles = useMemo(() => {
    const overrideMap = new Map(
      (storefront.imageCategorySettings || []).map((c) => [c.categoryId, c])
    );
    const activeCats = (categories || []).filter((c) => c.status !== 'suspended');
    const erpTiles = activeCats
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

    // Also include active app-only Display Categories
    const displayTiles = (storefront.displayCategories || [])
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
  }, [categories, storefront.imageCategorySettings, storefront.displayCategories]);

  const isProductInStock = (prod: Product) => {
    if (typeof prod.inStock === 'boolean') return prod.inStock;
    if (typeof prod.availableQty === 'number') return prod.availableQty > 0;
    return Object.values(prod.stockPerWarehouse || {}).reduce((sum, v) => sum + Number(v || 0), 0) > 0;
  };

  const getProductUnits = (prod: Product) => {
    const list = [{ name: prod.baseUnit, factor: 1, sellingPrice: prod.sellingPrice }];
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

  const handleNavigationTarget = (targetType?: string, targetId?: string) => {
    if (!targetType || targetType === 'none') return;
    if (targetType === 'offers') {
      onNavigateTab('offers');
      return;
    }
    if (targetType === 'category' && targetId) {
      const matchedCat = categories.find((c) => c.id === targetId || c.name === targetId);
      const matchedDisplay = (storefront.displayCategories || []).find((d) => d.id === targetId || d.name === targetId);
      if (matchedDisplay) {
        onOpenCategory(matchedDisplay.name, matchedDisplay.productIds);
      } else {
        onOpenCategory(matchedCat?.name || targetId);
      }
      return;
    }
    if (targetType === 'product' && targetId) {
      const found = visibleProducts.find((p) => p.id === targetId);
      if (found) {
        setQuickQty(1);
        setQuickProduct(found);
      }
      return;
    }
    if (targetType === 'internal_page') {
      if (targetId === 'favorites') onNavigateTab('favorites');
      else if (targetId === 'categories') onNavigateTab('categories');
      else if (targetId === 'offers') onNavigateTab('offers');
      else if (targetId === 'cart') onNavigateTab('cart');
      else if (targetId === 'orders' || targetId === 'account' || targetId === 'statement') onNavigateTab('more');
      else onNavigateTab('more');
    }
  };

  const renderProductCard = (prod: Product, forcedUnit?: string) => {
    const units = getProductUnits(prod);
    const activeUnit = forcedUnit || selectedUnitsByProd[prod.id] || prod.baseUnit;
    const promo = resolveActiveStorefrontOffer(prod, activeUnit, storefront);
    const available = isProductInStock(prod);
    const isFav = favoriteIds.includes(prod.id);
    const cartEntry = cartItems.find((c) => c.product.id === prod.id && c.unitName === activeUnit);
    const thumb = cachedMediaMap?.[prod.id] || prod.image;

    return (
      <div
        key={`${prod.id}-${activeUnit}`}
        className="relative bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-1.5 flex flex-col justify-between gap-1 transition-colors"
      >
        {/* Promo rectangular corner ribbon (zero pill) */}
        {promo.hasPromo && (
          <div className="absolute top-1.5 right-1.5 z-10 bg-[#C81E1E] text-white text-[10px] font-black px-1.5 py-0.5 rounded shadow-xs">
            {promo.badgeText || t('عرض عشانك', 'Offer')}
          </div>
        )}

        {/* Favorite toggle */}
        <button
          type="button"
          onClick={() => onToggleFavorite(prod.id)}
          aria-label={isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
          className={`absolute top-1.5 left-1.5 z-10 w-7 h-7 rounded-md flex items-center justify-center border cursor-pointer transition-colors ${
            isFav
              ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-[#C81E1E]'
              : 'bg-white/90 dark:bg-slate-800/90 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-500'
          }`}
        >
          <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
        </button>

        {/* Square Product Image */}
        <button
          type="button"
          onClick={() => {
            setQuickQty(1);
            setQuickProduct(prod);
          }}
          className="w-full aspect-square rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 flex items-center justify-center cursor-pointer"
        >
          {thumb ? (
            <img src={thumb} alt={prod.name} className="w-full h-full object-contain p-1" loading="lazy" />
          ) : (
            <Package className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          )}
        </button>

        {/* Product Meta */}
        <div className="space-y-1 flex-1 flex flex-col justify-between">
          <div>
            <button
              type="button"
              onClick={() => {
                setQuickQty(1);
                setQuickProduct(prod);
              }}
              className="text-right w-full cursor-pointer"
            >
              <h3 className="text-xs font-black text-slate-900 dark:text-slate-100 line-clamp-2 leading-snug min-h-[2rem]">
                {prod.name}
              </h3>
            </button>

            <div className="flex items-center justify-between gap-1 mt-0.5">
              {units.length > 1 ? (
                <select
                  value={activeUnit}
                  onChange={(e) => onSelectUnit(prod.id, e.target.value)}
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
              {!available && (
                <span className="text-[10px] font-bold text-red-600 dark:text-red-400">غير متاح</span>
              )}
            </div>
          </div>

          {allowPriceView ? (
            <div className="pt-0.5 flex items-baseline flex-wrap gap-1 awlad-tabular">
              <strong className="text-xs sm:text-sm font-black text-[var(--awlad-royal-700)] dark:text-blue-400">
                {promo.effectivePrice.toLocaleString()} {currency}
              </strong>
              {promo.hasPromo && (
                <span className="text-[10px] font-bold text-slate-400 line-through">
                  {promo.regularPrice.toLocaleString()}
                </span>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-slate-400 pt-0.5">السعر عند الاعتماد</p>
          )}

          {cartEntry ? (
            <div className="flex items-center justify-between gap-1 bg-[#EEF3FA] dark:bg-slate-800 border border-[#DCE6F5] dark:border-slate-700 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => onUpdateCartItemQty(prod.id, activeUnit, 1)}
                className="w-7 h-7 rounded-md bg-[var(--awlad-royal-700)] text-white flex items-center justify-center cursor-pointer"
                aria-label="زيادة الكمية"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-black text-[var(--awlad-navy-950)] dark:text-blue-300 awlad-tabular">
                {cartEntry.quantity}
              </span>
              <button
                type="button"
                onClick={() => onUpdateCartItemQty(prod.id, activeUnit, -1)}
                className="w-7 h-7 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
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
                onAddToCart(prod, activeUnit, 1, rect);
              }}
              className="w-full h-8 rounded-md bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white text-[11px] font-black flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>{available ? t('إضافة للسلة', 'Add to cart') : t('نفد المخزون', 'Out of stock')}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const orderedSections = useMemo(() => {
    const base =
      Array.isArray(storefront.sections) && storefront.sections.length > 0
        ? storefront.sections
        : [
            { key: 'banners', title: 'البانرات الإعلانية', isVisible: true, sortOrder: 1 },
            { key: 'shortcuts', title: 'اختصاراتك', isVisible: true, sortOrder: 2 },
            { key: 'offers', title: 'عروض مخصصة عشانك', isVisible: true, sortOrder: 3 },
            { key: 'categories', title: 'الأقسام المصورة', isVisible: true, sortOrder: 4 },
            { key: 'featured', title: 'أصناف مقترحة لك', isVisible: true, sortOrder: 5 },
          ];
    return [...base].filter((s) => s.isVisible !== false).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [storefront.sections]);

  return (
    <div className="space-y-2">
      {orderedSections.map((sec) => {
        if (sec.key === 'banners') {
          if (activeBanners.length === 0) return null;
          const activeBanner: StorefrontBanner | undefined = activeBanners[activeBannerIdx];
          if (!activeBanner) return null;

          return (
            <section key="banners" aria-label={sec.title} className="space-y-1.5">
              <div
                onTouchStart={(e) => {
                  touchStartXRef.current = e.touches[0]?.clientX ?? null;
                }}
                onTouchEnd={(e) => {
                  if (touchStartXRef.current === null || activeBanners.length <= 1) return;
                  const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
                  const diff = endX - touchStartXRef.current;
                  touchStartXRef.current = null;
                  if (Math.abs(diff) > 35) {
                    setBannerTick((n) => n + 1);
                    setActiveBannerIdx((prev) =>
                      diff > 0
                        ? (prev + 1) % activeBanners.length
                        : (prev - 1 + activeBanners.length) % activeBanners.length
                    );
                  }
                }}
                onClick={() => handleNavigationTarget(activeBanner.targetType, activeBanner.targetId)}
                className="relative w-full aspect-[16/7] sm:aspect-[16/5] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-[var(--awlad-navy-900)] cursor-pointer"
              >
                {activeBanner.imageUrl ? (
                  <img
                    src={activeBanner.imageUrl}
                    alt={activeBanner.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col justify-center px-4 awlad-brand-gradient text-white">
                    <h2 className="text-base sm:text-lg font-black">{activeBanner.title}</h2>
                    {activeBanner.subtitle && (
                      <p className="text-[11px] text-blue-100 mt-0.5">{activeBanner.subtitle}</p>
                    )}
                  </div>
                )}

                {activeBanner.imageUrl && (activeBanner.title || activeBanner.subtitle) && (
                  <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/75 via-black/35 to-transparent text-white">
                    {activeBanner.title && <p className="text-xs sm:text-sm font-black">{activeBanner.title}</p>}
                    {activeBanner.subtitle && (
                      <p className="text-[10px] text-white/90 line-clamp-1">{activeBanner.subtitle}</p>
                    )}
                  </div>
                )}
              </div>

              {activeBanners.length > 1 && (
                <div className="flex items-center justify-center gap-1.5">
                  {activeBanners.map((b, idx) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setBannerTick((n) => n + 1);
                        setActiveBannerIdx(idx);
                      }}
                      aria-label={`بانر ${idx + 1}`}
                      className={`h-1.5 rounded transition-all cursor-pointer ${
                        idx === activeBannerIdx
                          ? 'w-5 bg-[var(--awlad-royal-700)] dark:bg-blue-400'
                          : 'w-2 bg-slate-300 dark:bg-slate-700'
                      }`}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        }

        if (sec.key === 'shortcuts') {
          if (activeShortcuts.length === 0) return null;
          return (
            <section key="shortcuts" aria-label="إختصاراتك" className="space-y-1.5">
              <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 px-0.5">
                {sec.title || t('إختصاراتك', 'Your Shortcuts')}
              </h2>
              <div className="flex items-stretch gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {activeShortcuts.map((sc: StorefrontShortcut) => {
                  const Icon = getShortcutIcon(sc.iconKey);
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => handleNavigationTarget(sc.targetType, sc.targetId)}
                      className="min-w-[72px] flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[var(--awlad-royal-700)] rounded-lg p-1.5 flex flex-col items-center justify-center gap-1 text-center cursor-pointer transition-colors"
                    >
                      <div className="w-7 h-7 rounded-md bg-[#EEF3FA] dark:bg-slate-800 text-[var(--awlad-royal-700)] dark:text-blue-400 flex items-center justify-center">
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-black text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {sc.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        }

        if (sec.key === 'offers') {
          if (offerProductPairs.length === 0) return null;
          return (
            <section key="offers" aria-label="عروض عشانك" className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <h2 className="text-xs font-black text-slate-900 dark:text-slate-100">
                  {storefront.offersSectionTitle || sec.title || t('عروض مخصصة عشانك', 'Offers For You')}
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('offers')}
                  className="text-[11px] font-black text-[var(--awlad-royal-700)] dark:text-blue-400 flex items-center gap-0.5 cursor-pointer"
                >
                  <span>{t('عرض الكل', 'View all')}</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                {offerProductPairs.slice(0, 6).map(({ product, unitName }) => renderProductCard(product, unitName))}
              </div>
            </section>
          );
        }

        if (sec.key === 'categories') {
          if (imageCategoryTiles.length === 0) return null;
          return (
            <section key="categories" aria-label="الأقسام المصورة" className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <h2 className="text-xs font-black text-slate-900 dark:text-slate-100">
                  {storefront.categoriesSectionTitle || sec.title || t('الأقسام المصورة', 'Categories')}
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('categories')}
                  className="text-[11px] font-black text-[var(--awlad-royal-700)] dark:text-blue-400 flex items-center gap-0.5 cursor-pointer"
                >
                  <span>{t('عرض الكل', 'View all')}</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {imageCategoryTiles.slice(0, 9).map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => onOpenCategory(tile.rawCategoryName, tile.productIds)}
                    className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-[var(--awlad-royal-700)] p-1.5 flex flex-col items-center justify-between gap-1 text-center cursor-pointer transition-colors"
                  >
                    <div className="w-full aspect-square rounded-md bg-slate-50 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                      {tile.imageUrl ? (
                        <img src={tile.imageUrl} alt={tile.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <LayoutGrid className="w-5 h-5 text-[var(--awlad-royal-700)]/70 dark:text-blue-400" />
                      )}
                    </div>
                    <span className="text-[10px] font-black text-slate-800 dark:text-slate-200 line-clamp-2 leading-tight">
                      {tile.name}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        }

        if (sec.key === 'featured') {
          if (featuredProducts.length === 0) return null;
          return (
            <section key="featured" aria-label="الأصناف المميزة" className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <h2 className="text-xs font-black text-slate-900 dark:text-slate-100">
                  {storefront.featuredSectionTitle || sec.title || t('أصناف مقترحة لك', 'Featured Products')}
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('categories')}
                  className="text-[11px] font-black text-[var(--awlad-royal-700)] dark:text-blue-400 flex items-center gap-0.5 cursor-pointer"
                >
                  <span>{t('تصفح الكل', 'Browse all')}</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                {featuredProducts.map((p) => renderProductCard(p))}
              </div>
            </section>
          );
        }

        return null;
      })}

      {/* Quick Product Detail Sheet */}
      {quickProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-3">
          <div className="bg-white dark:bg-slate-900 w-full sm:max-w-md rounded-t-xl sm:rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-2 shadow-xl pb-safe">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100">{quickProduct.name}</h3>
                <p className="text-[11px] text-slate-500">{quickProduct.category} · {quickProduct.code}</p>
              </div>
              <button
                type="button"
                onClick={() => setQuickProduct(null)}
                className="p-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full h-36 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex items-center justify-center overflow-hidden">
              {cachedMediaMap?.[quickProduct.id] || quickProduct.image ? (
                <img
                  src={cachedMediaMap?.[quickProduct.id] || quickProduct.image}
                  alt={quickProduct.name}
                  className="h-full object-contain p-2"
                />
              ) : (
                <Package className="w-10 h-10 text-slate-300" />
              )}
            </div>

            {(() => {
              const units = getProductUnits(quickProduct);
              const unitName = selectedUnitsByProd[quickProduct.id] || quickProduct.baseUnit;
              const promo = resolveActiveStorefrontOffer(quickProduct, unitName, storefront);
              const available = isProductInStock(quickProduct);
              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={unitName}
                      onChange={(e) => onSelectUnit(quickProduct.id, e.target.value)}
                      className="h-8 px-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold"
                    >
                      {units.map((u) => (
                        <option key={u.name} value={u.name}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    {allowPriceView && (
                      <div className="text-left awlad-tabular">
                        <strong className="text-sm font-black text-[var(--awlad-royal-700)] dark:text-blue-400">
                          {promo.effectivePrice.toLocaleString()} {currency}
                        </strong>
                        {promo.hasPromo && (
                          <span className="block text-[11px] text-slate-400 line-through">
                            {promo.regularPrice.toLocaleString()} {currency}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">الكمية:</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setQuickQty((q) => q + 1)}
                        className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 font-black flex items-center justify-center cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <span className="w-9 text-center text-sm font-black awlad-tabular">{quickQty}</span>
                      <button
                        type="button"
                        onClick={() => setQuickQty((q) => Math.max(1, q - 1))}
                        className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 font-black flex items-center justify-center cursor-pointer"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!available}
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      onAddToCart(quickProduct, unitName, quickQty, rect);
                      setQuickProduct(null);
                    }}
                    className="w-full h-9 rounded-lg bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] disabled:bg-slate-300 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>{available ? 'إضافة الكمية للسلة' : 'غير متوفر حالياً'}</span>
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

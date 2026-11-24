import { Product, StorefrontConfig, StorefrontOffer } from '../types';

export const DEFAULT_STOREFRONT_CONFIG: StorefrontConfig = {
  version: 1,
  status: 'published',
  offersSectionTitle: 'عروض مخصصة عشانك',
  categoriesSectionTitle: 'الأقسام المصورة',
  featuredSectionTitle: 'أصناف مقترحة لك',
  banners: [],
  shortcuts: [
    {
      id: 'sc-offers',
      label: 'عروض اليوم',
      iconKey: 'tag',
      targetType: 'offers',
      targetId: '',
      sortOrder: 1,
      isActive: true,
    },
    {
      id: 'sc-favorites',
      label: 'المفضلة',
      iconKey: 'heart',
      targetType: 'internal_page',
      targetId: 'favorites',
      sortOrder: 2,
      isActive: true,
    },
    {
      id: 'sc-orders',
      label: 'طلباتي',
      iconKey: 'package',
      targetType: 'internal_page',
      targetId: 'orders',
      sortOrder: 3,
      isActive: true,
    },
    {
      id: 'sc-statement',
      label: 'كشف الحساب',
      iconKey: 'wallet',
      targetType: 'internal_page',
      targetId: 'statement',
      sortOrder: 4,
      isActive: true,
    },
  ],
  offers: [],
  imageCategorySettings: [],
  displayCategories: [],
  featuredProductIds: [],
  hiddenProductIds: [],
  sections: [
    { key: 'banners', title: 'البانرات الإعلانية', isVisible: true, sortOrder: 1 },
    { key: 'shortcuts', title: 'اختصاراتك', isVisible: true, sortOrder: 2 },
    { key: 'offers', title: 'عروض عشانك', isVisible: true, sortOrder: 3 },
    { key: 'categories', title: 'الأقسام المصورة', isVisible: true, sortOrder: 4 },
    { key: 'featured', title: 'الأصناف المميزة', isVisible: true, sortOrder: 5 },
  ],
};

export function isStorefrontWindowActive(
  item: { isActive?: boolean; startsAt?: string; endsAt?: string } | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!item || item.isActive === false) return false;
  if (item.startsAt) {
    const s = Date.parse(item.startsAt);
    if (Number.isFinite(s) && nowMs < s) return false;
  }
  if (item.endsAt) {
    const e = Date.parse(item.endsAt);
    if (Number.isFinite(e) && nowMs > e) return false;
  }
  return true;
}

export function resolveUnitRegularPrice(product: Product, unitName?: string): number {
  const cleanUnit = String(unitName || product.baseUnit || '').trim();
  if (!cleanUnit || cleanUnit === product.baseUnit) {
    return Math.round(Number(product.sellingPrice || 0) * 100) / 100;
  }
  const matched = Array.isArray(product.units) ? product.units.find((u) => u.name === cleanUnit) : undefined;
  if (matched) {
    const up = Number(matched.sellingPrice || 0);
    if (up > 0) return Math.round(up * 100) / 100;
    return Math.round(Number(product.sellingPrice || 0) * Number(matched.conversionFactor || 1) * 100) / 100;
  }
  return Math.round(Number(product.sellingPrice || 0) * 100) / 100;
}

export interface ResolvedProductPromo {
  hasPromo: boolean;
  offer?: StorefrontOffer;
  badgeText?: string;
  regularPrice: number;
  effectivePrice: number;
  discountPercent: number;
}

export function resolveActiveStorefrontOffer(
  product: Product,
  unitName: string | undefined,
  storefront: StorefrontConfig | null | undefined,
  nowMs = Date.now()
): ResolvedProductPromo {
  const regularPrice = resolveUnitRegularPrice(product, unitName);
  if (!storefront || !Array.isArray(storefront.offers)) {
    return { hasPromo: false, regularPrice, effectivePrice: regularPrice, discountPercent: 0 };
  }
  const cleanUnit = String(unitName || product.baseUnit || '').trim();
  const matching = storefront.offers.filter((o) => {
    if (!o || o.productId !== product.id) return false;
    if (!isStorefrontWindowActive(o, nowMs)) return false;
    const offerUnit = String(o.unit || product.baseUnit || '').trim();
    return offerUnit === cleanUnit;
  });

  let best: StorefrontOffer | undefined;
  for (const offer of matching) {
    const promo = Math.round(Number(offer.promoPrice || 0) * 100) / 100;
    if (promo > 0 && promo < regularPrice) {
      if (!best || promo < Number(best.promoPrice)) {
        best = offer;
      }
    }
  }

  if (!best) {
    return { hasPromo: false, regularPrice, effectivePrice: regularPrice, discountPercent: 0 };
  }
  const effectivePrice = Math.round(Number(best.promoPrice) * 100) / 100;
  const discountPercent =
    regularPrice > 0 ? Math.max(1, Math.round(((regularPrice - effectivePrice) / regularPrice) * 100)) : 0;

  return {
    hasPromo: true,
    offer: best,
    badgeText: best.badgeText || 'عرض عشانك',
    regularPrice,
    effectivePrice,
    discountPercent,
  };
}

export function isZeroZeroLocation(lat?: number | null, lng?: number | null): boolean {
  if (lat === undefined || lat === null || lng === undefined || lng === null) return false;
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001;
}

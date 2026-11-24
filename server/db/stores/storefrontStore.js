import { getPool, withTransaction } from '../postgres.js';
import { readJsonDatabase, withJsonTransaction, createEmptyDatabaseState } from '../jsonLedger.js';
import { generateServerId } from '../../utils/crypto.js';
import { AppError, nowIso, round2 } from '../../utils/errors.js';
import { isPgMode } from './mode.js';
import { recordAuditLog } from './authStore.js';

function sanitizeSafeStorefrontImage(raw) {
  if (raw === undefined || raw === null) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\/[A-Za-z0-9_./-]+$/.test(trimmed) || /^https:\/\/[^\s"'<>]+$/i.test(trimmed)) {
    return trimmed;
  }
  throw new AppError(
    400,
    'صيغة صورة الواجهة غير مدعومة أو غير آمنة (يُسمح بصور PNG/JPG/WEBP أو رابط آمن HTTPS فقط)',
    'INVALID_STOREFRONT_IMAGE'
  );
}

function sanitizeOptionalIsoDate(raw) {
  if (raw === undefined || raw === null) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  const ts = Date.parse(trimmed);
  if (!Number.isFinite(ts)) {
    throw new AppError(400, `تاريخ العرض أو البانر غير صالح: ${trimmed}`, 'INVALID_STOREFRONT_DATE');
  }
  return trimmed;
}

export const DEFAULT_STOREFRONT_SECTIONS = [
  { key: 'banners', title: 'البانرات الإعلانية', isVisible: true, sortOrder: 1 },
  { key: 'shortcuts', title: 'اختصاراتك', isVisible: true, sortOrder: 2 },
  { key: 'offers', title: 'عروض عشانك', isVisible: true, sortOrder: 3 },
  { key: 'categories', title: 'الأقسام المصورة', isVisible: true, sortOrder: 4 },
  { key: 'featured', title: 'الأصناف المميزة', isVisible: true, sortOrder: 5 },
];

export const DEFAULT_STOREFRONT_SHORTCUTS = [
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
];

export function createDefaultStorefrontConfig(overrides = {}) {
  return {
    version: Number(overrides.version || 1),
    status: overrides.status === 'published' ? 'published' : 'draft',
    updatedAt: overrides.updatedAt || nowIso(),
    updatedBy: overrides.updatedBy || '',
    publishedAt: overrides.publishedAt || undefined,
    publishedBy: overrides.publishedBy || undefined,
    offersSectionTitle: 'عروض مخصصة عشانك',
    categoriesSectionTitle: 'الأقسام المصورة',
    featuredSectionTitle: 'أصناف مقترحة لك',
    banners: [],
    shortcuts: DEFAULT_STOREFRONT_SHORTCUTS.map((s) => ({ ...s })),
    offers: [],
    imageCategorySettings: [],
    displayCategories: [],
    featuredProductIds: [],
    hiddenProductIds: [],
    sections: DEFAULT_STOREFRONT_SECTIONS.map((s) => ({ ...s })),
  };
}

export function sanitizeStorefrontConfig(raw, { statusOverride, actorName } = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const defaults = createDefaultStorefrontConfig();

  const banners = Array.isArray(src.banners)
    ? src.banners
        .filter((b) => b && typeof b === 'object')
        .map((b, idx) => {
          const title = String(b.title || '').trim();
          const imageUrl = sanitizeSafeStorefrontImage(b.imageUrl || b.image || '');
          const targetType = ['product', 'category', 'offers', 'internal_page', 'none'].includes(b.targetType)
            ? b.targetType
            : 'none';
          const startsAt = sanitizeOptionalIsoDate(b.startsAt);
          const endsAt = sanitizeOptionalIsoDate(b.endsAt);
          if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
            throw new AppError(400, `تاريخ نهاية البانر (${title || idx + 1}) يجب أن يكون بعد تاريخ البداية`, 'INVALID_BANNER_DATES');
          }
          return {
            id: String(b.id || generateServerId('BNR')).trim(),
            title,
            subtitle: String(b.subtitle || '').trim(),
            imageUrl,
            targetType,
            targetId: String(b.targetId || '').trim(),
            targetLabel: String(b.targetLabel || '').trim(),
            sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : idx + 1,
            startsAt,
            endsAt,
            isActive: b.isActive !== false,
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const shortcuts = Array.isArray(src.shortcuts)
    ? src.shortcuts
        .filter((s) => s && typeof s === 'object' && String(s.label || '').trim())
        .map((s, idx) => ({
          id: String(s.id || generateServerId('SHC')).trim(),
          label: String(s.label || '').trim(),
          iconKey: String(s.iconKey || 'tag').trim(),
          targetType: ['product', 'category', 'offers', 'internal_page', 'none'].includes(s.targetType)
            ? s.targetType
            : 'offers',
          targetId: String(s.targetId || '').trim(),
          sortOrder: Number.isFinite(Number(s.sortOrder)) ? Number(s.sortOrder) : idx + 1,
          isActive: s.isActive !== false,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : defaults.shortcuts;

  const offers = Array.isArray(src.offers)
    ? src.offers
        .filter((o) => o && typeof o === 'object' && String(o.productId || '').trim())
        .map((o, idx) => {
          const promoPrice = round2(Number(o.promoPrice ?? 0));
          if (!Number.isFinite(promoPrice) || promoPrice <= 0) {
            throw new AppError(400, 'سعر العرض يجب أن يكون رقمًا أكبر من صفر', 'INVALID_PROMO_PRICE');
          }
          const startsAt = sanitizeOptionalIsoDate(o.startsAt);
          const endsAt = sanitizeOptionalIsoDate(o.endsAt);
          if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
            throw new AppError(400, 'تاريخ نهاية العرض يجب أن يكون بعد تاريخ البداية', 'INVALID_OFFER_DATES');
          }
          return {
            id: String(o.id || generateServerId('OFR')).trim(),
            productId: String(o.productId).trim(),
            unit: String(o.unit || '').trim(),
            badgeText: String(o.badgeText || 'عرض عشانك').trim().slice(0, 40),
            promoPrice,
            originalPriceSnapshot: Number.isFinite(Number(o.originalPriceSnapshot)) ? round2(Number(o.originalPriceSnapshot)) : undefined,
            startsAt,
            endsAt,
            sortOrder: Number.isFinite(Number(o.sortOrder)) ? Number(o.sortOrder) : idx + 1,
            isActive: o.isActive !== false,
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const imageCategorySettings = Array.isArray(src.imageCategorySettings)
    ? src.imageCategorySettings
        .filter((c) => c && typeof c === 'object' && (String(c.categoryId || '').trim() || String(c.categoryName || '').trim()))
        .map((c, idx) => ({
          categoryId: String(c.categoryId || '').trim(),
          categoryName: String(c.categoryName || '').trim(),
          displayTitle: String(c.displayTitle || c.categoryName || '').trim(),
          imageUrl: sanitizeSafeStorefrontImage(c.imageUrl || ''),
          sortOrder: Number.isFinite(Number(c.sortOrder)) ? Number(c.sortOrder) : idx + 1,
          isVisible: c.isVisible !== false,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const displayCategories = Array.isArray(src.displayCategories)
    ? src.displayCategories
        .filter((dc) => dc && typeof dc === 'object' && String(dc.title || '').trim())
        .map((dc, idx) => ({
          id: String(dc.id || generateServerId('DCAT')).trim(),
          title: String(dc.title || '').trim(),
          description: String(dc.description || '').trim(),
          imageUrl: sanitizeSafeStorefrontImage(dc.imageUrl || ''),
          productIds: Array.isArray(dc.productIds)
            ? Array.from(new Set(dc.productIds.map((p) => String(p || '').trim()).filter(Boolean)))
            : [],
          linkedCategoryNames: Array.isArray(dc.linkedCategoryNames)
            ? Array.from(new Set(dc.linkedCategoryNames.map((n) => String(n || '').trim()).filter(Boolean)))
            : [],
          sortOrder: Number.isFinite(Number(dc.sortOrder)) ? Number(dc.sortOrder) : idx + 1,
          isVisible: dc.isVisible !== false,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const featuredProductIds = Array.isArray(src.featuredProductIds)
    ? Array.from(new Set(src.featuredProductIds.map((id) => String(id || '').trim()).filter(Boolean)))
    : [];

  const hiddenProductIds = Array.isArray(src.hiddenProductIds)
    ? Array.from(new Set(src.hiddenProductIds.map((id) => String(id || '').trim()).filter(Boolean)))
    : [];

  const rawSections = Array.isArray(src.sections) ? src.sections : defaults.sections;
  const sectionsMap = new Map();
  for (const def of defaults.sections) {
    sectionsMap.set(def.key, { ...def });
  }
  for (const s of rawSections) {
    if (!s || typeof s !== 'object') continue;
    const key = String(s.key || '').trim();
    if (!sectionsMap.has(key)) continue;
    const baseSec = sectionsMap.get(key);
    sectionsMap.set(key, {
      key,
      title: String(s.title || baseSec.title).trim(),
      isVisible: s.isVisible !== false,
      sortOrder: Number.isFinite(Number(s.sortOrder)) ? Number(s.sortOrder) : baseSec.sortOrder,
    });
  }
  const sections = Array.from(sectionsMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    version: Math.max(1, Number(src.version || 1)),
    status: statusOverride || (src.status === 'published' ? 'published' : 'draft'),
    updatedAt: nowIso(),
    updatedBy: actorName || String(src.updatedBy || ''),
    publishedAt: src.publishedAt || undefined,
    publishedBy: src.publishedBy || undefined,
    offersSectionTitle: String(src.offersSectionTitle || defaults.offersSectionTitle).trim() || defaults.offersSectionTitle,
    categoriesSectionTitle: String(src.categoriesSectionTitle || defaults.categoriesSectionTitle).trim() || defaults.categoriesSectionTitle,
    featuredSectionTitle: String(src.featuredSectionTitle || defaults.featuredSectionTitle).trim() || defaults.featuredSectionTitle,
    banners,
    shortcuts,
    offers,
    imageCategorySettings,
    displayCategories,
    featuredProductIds,
    hiddenProductIds,
    sections,
  };
}

async function readExtraSettingsRecord() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT id, extra_settings FROM system_settings LIMIT 1');
    return res.rows[0]?.extra_settings || {};
  }
  const db = readJsonDatabase();
  return db.settings?.extraSettings || {};
}

export async function getPublishedStorefront() {
  const extra = await readExtraSettingsRecord();
  if (extra?.storefrontPublished && typeof extra.storefrontPublished === 'object') {
    return sanitizeStorefrontConfig(extra.storefrontPublished, {
      statusOverride: 'published',
      actorName: extra.storefrontPublished.publishedBy || '',
    });
  }
  return createDefaultStorefrontConfig({ status: 'published' });
}

export async function getAdminStorefront() {
  const extra = await readExtraSettingsRecord();
  const published = extra?.storefrontPublished
    ? sanitizeStorefrontConfig(extra.storefrontPublished, {
        statusOverride: 'published',
        actorName: extra.storefrontPublished.publishedBy || '',
      })
    : createDefaultStorefrontConfig({ status: 'published' });
  const draft = extra?.storefrontDraft
    ? sanitizeStorefrontConfig(extra.storefrontDraft, {
        statusOverride: 'draft',
        actorName: extra.storefrontDraft.updatedBy || '',
      })
    : { ...structuredClone(published), status: 'draft' };
  return { draft, published };
}

export async function saveStorefrontDraft(payload, actor) {
  const now = nowIso();
  const draft = sanitizeStorefrontConfig(payload, {
    statusOverride: 'draft',
    actorName: actor?.fullName || actor?.username || 'الإدارة',
  });
  draft.updatedAt = now;

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const res = await client.query('SELECT id, extra_settings FROM system_settings LIMIT 1');
      let id = res.rows[0]?.id;
      const curExtra = res.rows[0]?.extra_settings || {};
      const nextExtra = {
        ...curExtra,
        storefrontDraft: draft,
      };
      if (!id) {
        id = 'settings-main';
        const fallback = createEmptyDatabaseState().settings;
        await client.query(
          `INSERT INTO system_settings (id, company_name, company_subtitle, currency, default_print_mode, invoice_notes, allow_negative_stock, extra_settings, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            fallback.companyName,
            fallback.companySubtitle,
            fallback.currency,
            fallback.defaultPrintMode,
            fallback.invoiceNotes,
            false,
            JSON.stringify(nextExtra),
            now,
          ]
        );
      } else {
        await client.query('UPDATE system_settings SET extra_settings = $1, updated_at = $2 WHERE id = $3', [
          JSON.stringify(nextExtra),
          now,
          id,
        ]);
      }
      const published = curExtra?.storefrontPublished
        ? sanitizeStorefrontConfig(curExtra.storefrontPublished, { statusOverride: 'published' })
        : createDefaultStorefrontConfig({ status: 'published' });
      return { draft, published };
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: 'حفظ مسودة واجهة متجر العملاء والموبايل',
      module: 'إدارة المتجر الإلكتروني',
    });
    return result;
  }

  const result = await withJsonTransaction(async (db) => {
    db.settings = db.settings || createEmptyDatabaseState().settings;
    db.settings.extraSettings = {
      ...(db.settings.extraSettings || {}),
      storefrontDraft: draft,
    };
    const published = db.settings.extraSettings?.storefrontPublished
      ? sanitizeStorefrontConfig(db.settings.extraSettings.storefrontPublished, { statusOverride: 'published' })
      : createDefaultStorefrontConfig({ status: 'published' });
    return { draft, published };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: 'حفظ مسودة واجهة متجر العملاء والموبايل',
    module: 'إدارة المتجر الإلكتروني',
  });
  return result;
}

export async function publishStorefront(payload, actor) {
  const now = nowIso();
  const actorName = actor?.fullName || actor?.username || 'الإدارة';

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const res = await client.query('SELECT id, extra_settings FROM system_settings LIMIT 1');
      let id = res.rows[0]?.id;
      const curExtra = res.rows[0]?.extra_settings || {};
      const sourceConfig = payload && typeof payload === 'object' && Object.keys(payload).length > 0
        ? payload
        : (curExtra.storefrontDraft || curExtra.storefrontPublished || createDefaultStorefrontConfig());
      const prevVersion = Number(curExtra.storefrontPublished?.version || 0);
      const nextVersion = prevVersion + 1;

      const published = sanitizeStorefrontConfig(sourceConfig, {
        statusOverride: 'published',
        actorName,
      });
      published.version = nextVersion;
      published.publishedAt = now;
      published.publishedBy = actorName;

      const draft = { ...structuredClone(published), status: 'draft' };
      const nextExtra = {
        ...curExtra,
        storefrontDraft: draft,
        storefrontPublished: published,
      };
      if (!id) {
        id = 'settings-main';
        const fallback = createEmptyDatabaseState().settings;
        await client.query(
          `INSERT INTO system_settings (id, company_name, company_subtitle, currency, default_print_mode, invoice_notes, allow_negative_stock, extra_settings, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            fallback.companyName,
            fallback.companySubtitle,
            fallback.currency,
            fallback.defaultPrintMode,
            fallback.invoiceNotes,
            false,
            JSON.stringify(nextExtra),
            now,
          ]
        );
      } else {
        await client.query('UPDATE system_settings SET extra_settings = $1, updated_at = $2 WHERE id = $3', [
          JSON.stringify(nextExtra),
          now,
          id,
        ]);
      }
      return { draft, published };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `نشر واجهة متجر العملاء والموبايل (إصدار #${result.published.version})`,
      module: 'إدارة المتجر الإلكتروني',
    });
    return result;
  }

  const result = await withJsonTransaction(async (db) => {
    db.settings = db.settings || createEmptyDatabaseState().settings;
    const curExtra = db.settings.extraSettings || {};
    const sourceConfig = payload && typeof payload === 'object' && Object.keys(payload).length > 0
      ? payload
      : (curExtra.storefrontDraft || curExtra.storefrontPublished || createDefaultStorefrontConfig());
    const prevVersion = Number(curExtra.storefrontPublished?.version || 0);
    const nextVersion = prevVersion + 1;

    const published = sanitizeStorefrontConfig(sourceConfig, {
      statusOverride: 'published',
      actorName,
    });
    published.version = nextVersion;
    published.publishedAt = now;
    published.publishedBy = actorName;

    const draft = { ...structuredClone(published), status: 'draft' };
    db.settings.extraSettings = {
      ...curExtra,
      storefrontDraft: draft,
      storefrontPublished: published,
    };
    return { draft, published };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `نشر واجهة متجر العملاء والموبايل (إصدار #${result.published.version})`,
    module: 'إدارة المتجر الإلكتروني',
  });
  return result;
}

export function isOfferWindowActive(item, nowMs = Date.now()) {
  if (!item || item.isActive === false) return false;
  if (item.startsAt) {
    const startMs = Date.parse(item.startsAt);
    if (Number.isFinite(startMs) && nowMs < startMs) return false;
  }
  if (item.endsAt) {
    const endMs = Date.parse(item.endsAt);
    if (Number.isFinite(endMs) && nowMs > endMs) return false;
  }
  return true;
}

export function resolveProductUnitRegularPrice(product, unitName) {
  if (!product) return 0;
  const cleanUnit = String(unitName || product.baseUnit || '').trim();
  if (!cleanUnit || cleanUnit === product.baseUnit) {
    return round2(Number(product.sellingPrice || 0));
  }
  const matched = Array.isArray(product.units) ? product.units.find((u) => u.name === cleanUnit) : null;
  if (matched) {
    const uPrice = Number(matched.sellingPrice || 0);
    if (uPrice > 0) return round2(uPrice);
    return round2(Number(product.sellingPrice || 0) * Number(matched.conversionFactor || 1));
  }
  return round2(Number(product.sellingPrice || 0));
}

export function resolveActiveStorefrontPromo(product, unitName, publishedStorefront, nowMs = Date.now()) {
  const regularPrice = resolveProductUnitRegularPrice(product, unitName);
  if (!product || !publishedStorefront || !Array.isArray(publishedStorefront.offers)) {
    return { hasPromo: false, regularPrice, effectivePrice: regularPrice };
  }

  const cleanUnit = String(unitName || product.baseUnit || '').trim();
  const matchingOffers = publishedStorefront.offers.filter((offer) => {
    if (!offer || offer.productId !== product.id) return false;
    if (!isOfferWindowActive(offer, nowMs)) return false;
    const offerUnit = String(offer.unit || product.baseUnit || '').trim();
    return offerUnit === cleanUnit;
  });

  if (matchingOffers.length === 0) {
    return { hasPromo: false, regularPrice, effectivePrice: regularPrice };
  }

  // Pick the lowest genuine active promotional price that is strictly below regular price
  let bestOffer = null;
  for (const offer of matchingOffers) {
    const p = round2(Number(offer.promoPrice || 0));
    if (p > 0 && p < regularPrice) {
      if (!bestOffer || p < Number(bestOffer.promoPrice)) {
        bestOffer = offer;
      }
    }
  }

  if (!bestOffer) {
    return { hasPromo: false, regularPrice, effectivePrice: regularPrice };
  }

  const effectivePrice = round2(Number(bestOffer.promoPrice));
  return {
    hasPromo: true,
    offerId: bestOffer.id,
    badgeText: bestOffer.badgeText || 'عرض عشانك',
    regularPrice,
    effectivePrice,
    discountAmount: round2(regularPrice - effectivePrice),
  };
}

export async function getCustomerFavorites(customerId) {
  if (!customerId) return [];
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT favorite_product_ids FROM customers WHERE id = $1 LIMIT 1', [customerId]);
    const list = res.rows[0]?.favorite_product_ids;
    return Array.isArray(list) ? Array.from(new Set(list.map(String).filter(Boolean))) : [];
  }
  const db = readJsonDatabase();
  const cust = (db.customers || []).find((c) => c.id === customerId);
  return Array.isArray(cust?.favoriteProductIds)
    ? Array.from(new Set(cust.favoriteProductIds.map(String).filter(Boolean)))
    : [];
}

export async function setCustomerFavorites(customerId, productIds = []) {
  if (!customerId) {
    throw new AppError(404, 'ملف العميل غير موجود', 'CUSTOMER_NOT_FOUND');
  }
  const cleaned = Array.isArray(productIds)
    ? Array.from(new Set(productIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 500)
    : [];
  const now = nowIso();

  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      'UPDATE customers SET favorite_product_ids = $1, updated_at = $2 WHERE id = $3 RETURNING id',
      [JSON.stringify(cleaned), now, customerId]
    );
    if (!res.rows[0]) {
      throw new AppError(404, 'ملف العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    }
    return cleaned;
  }

  return withJsonTransaction(async (db) => {
    const idx = (db.customers || []).findIndex((c) => c.id === customerId);
    if (idx === -1) {
      throw new AppError(404, 'ملف العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    }
    db.customers[idx] = {
      ...db.customers[idx],
      favoriteProductIds: cleaned,
      updatedAt: now,
    };
    return cleaned;
  });
}

export async function toggleCustomerFavorite(customerId, productId) {
  const pid = String(productId || '').trim();
  if (!pid) {
    throw new AppError(400, 'معرف الصنف مطلوب', 'INVALID_PRODUCT_ID');
  }
  const current = await getCustomerFavorites(customerId);
  const exists = current.includes(pid);
  const next = exists ? current.filter((id) => id !== pid) : [pid, ...current];
  const saved = await setCustomerFavorites(customerId, next);
  return { favoriteProductIds: saved, isFavorite: !exists };
}

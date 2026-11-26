import { getPool, withTransaction } from '../postgres.js';
import { withJsonTransaction, readJsonDatabase } from '../jsonLedger.js';
import { hashPasswordBcrypt, generateServerId } from '../../utils/crypto.js';
import {
  AppError,
  nowIso,
  todayIso,
  round2,
  sanitizeProductForCustomer,
  sanitizeProductForRepresentative,
  sanitizeInvoiceForRepresentative,
  sanitizeUser,
  canViewCashboxBalances,
  isRepOwnerOfInvoice,
  buildPgInPredicate,
  normalizePhoneDigits as normalizePhoneDigitsShared,
} from '../../utils/errors.js';
import {
  isPgMode,
  CUSTOMER_DEFAULT_PERMISSIONS,
  resolveDefaultPermissionsForRole,
  normalizeCustomerPhonesList,
  mapPgCustomerRow,
  mapPgProductRow,
  mapPgUserRow,
  isoTimestamp,
} from './mode.js';
import { recordAuditLog, revokeAllUserSessions } from './authStore.js';
import {
  buildScopedIdemKey,
  findPgIdempotency,
  savePgIdempotency,
  findJsonIdempotency,
  saveJsonIdempotency,
} from '../../utils/idempotency.js';
import {
  attachRecordToIdentityPgTx,
  attachRecordToIdentityJsonTx,
  resolveActorIdentityPgTx,
  resolveActorIdentityJsonTx,
  logIdentityConflictPgTx,
  logIdentityConflictJsonTx,
} from '../identityManager.js';

export const DEFAULT_MOBILE_CONFIG = {
  enableCustomerApp: true,
  enableRepApp: true,
  allowCustomerPriceView: true,
  requireOrderApproval: true,
};

export function normalizePhoneDigits(rawPhone) {
  let digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0020') && digits.length >= 13) digits = '0' + digits.slice(4);
  else if (digits.startsWith('20') && digits.length >= 12) digits = '0' + digits.slice(2);
  return digits;
}

export function sanitizeSafeImageUrl(raw) {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\/api\/[A-Za-z0-9_./-]+$/.test(trimmed) || /^https:\/\/[^\s"'<>]+$/i.test(trimmed)) {
    return trimmed;
  }
  throw new AppError(
    400,
    'صيغة صورة المحل غير مدعومة أو غير آمنة (يُسمح بصور PNG أو JPG أو WEBP أو رابط HTTPS فقط)',
    'INVALID_CUSTOMER_PHOTO'
  );
}

export function sanitizeGeoCoordinates(raw) {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  if (/^(javascript|data|vbscript):/i.test(trimmed) || /[<>]/.test(trimmed)) {
    throw new AppError(400, 'إحداثيات الموقع الجغرافي غير صالحة', 'INVALID_GEO_COORDINATES');
  }
  return trimmed;
}

export function isZeroZeroCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001;
}

export function resolveCustomerGeoInput(input = {}, fallback = {}) {
  const hasExplicitLatLng = input.latitude !== undefined || input.longitude !== undefined;
  const hasGeoStr = input.geoCoordinates !== undefined;

  let lat = input.latitude !== undefined && input.latitude !== null && input.latitude !== ''
    ? Number(input.latitude)
    : undefined;
  let lng = input.longitude !== undefined && input.longitude !== null && input.longitude !== ''
    ? Number(input.longitude)
    : undefined;
  let geoStr = hasGeoStr ? sanitizeGeoCoordinates(input.geoCoordinates) : fallback.geoCoordinates;

  if (hasExplicitLatLng) {
    if (lat === undefined && lng === undefined) {
      // cleared explicitly
      geoStr = hasGeoStr ? geoStr : undefined;
    } else if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new AppError(400, 'إحداثيات خط العرض أو خط الطول غير صالحة', 'INVALID_GEO_COORDINATES');
    } else if (isZeroZeroCoords(lat, lng)) {
      throw new AppError(400, 'إحداثيات (0, 0) غير صالحة؛ يرجى تحديد موقع حقيقي على الخريطة', 'ZERO_ZERO_COORDINATES');
    } else {
      lat = Number(lat.toFixed(6));
      lng = Number(lng.toFixed(6));
      geoStr = hasGeoStr && geoStr ? geoStr : `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  } else if (hasGeoStr && geoStr) {
    const m = geoStr.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      const parsedLat = Number(m[1]);
      const parsedLng = Number(m[2]);
      if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng) || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
        throw new AppError(400, 'إحداثيات الموقع الجغرافي غير صالحة', 'INVALID_GEO_COORDINATES');
      }
      if (isZeroZeroCoords(parsedLat, parsedLng)) {
        throw new AppError(400, 'إحداثيات (0, 0) غير صالحة؛ يرجى تحديد موقع حقيقي على الخريطة', 'ZERO_ZERO_COORDINATES');
      }
      lat = Number(parsedLat.toFixed(6));
      lng = Number(parsedLng.toFixed(6));
    }
  } else if (!hasExplicitLatLng && !hasGeoStr) {
    lat = fallback.latitude;
    lng = fallback.longitude;
    geoStr = fallback.geoCoordinates;
  }

  const nextCity =
    input.city !== undefined
      ? (String(input.city || '').trim() || undefined)
      : (fallback.city || undefined);
  const nextCapturedAt =
    lat !== undefined && lng !== undefined
      ? (input.locationCapturedAt ? String(input.locationCapturedAt).trim() : (fallback.locationCapturedAt || nowIso()))
      : (input.clearLocation ? undefined : fallback.locationCapturedAt);

  return {
    geoCoordinates: geoStr,
    latitude: lat,
    longitude: lng,
    city: nextCity,
    locationCapturedAt: nextCapturedAt,
  };
}

export function normalizeCustomerRecordShape(c) {
  if (!c) return null;
  const phones = normalizeCustomerPhonesList(c.phones, c.phone || '', c.secondaryPhone || '');
  const primaryPhone = phones.find((p) => p.isPrimary)?.number || phones[0]?.number || c.phone || '';
  const secondaryEntry = phones.find((p) => !p.isPrimary && p.number !== primaryPhone) || phones[1];
  const resolvedPhoto = c.shopPhoto || c.photo || undefined;
  const latNum = c.latitude !== undefined && c.latitude !== null ? Number(c.latitude) : undefined;
  const lngNum = c.longitude !== undefined && c.longitude !== null ? Number(c.longitude) : undefined;
  const validCoords = latNum !== undefined && lngNum !== undefined && !isZeroZeroCoords(latNum, lngNum);
  return {
    ...c,
    phone: primaryPhone,
    secondaryPhone: secondaryEntry?.number || c.secondaryPhone || undefined,
    phones,
    governorate: c.governorate || undefined,
    city: c.city || undefined,
    latitude: validCoords ? latNum : undefined,
    longitude: validCoords ? lngNum : undefined,
    locationCapturedAt: c.locationCapturedAt || undefined,
    favoriteProductIds: Array.isArray(c.favoriteProductIds) ? c.favoriteProductIds.map(String).filter(Boolean) : [],
    shopPhoto: resolvedPhoto,
    photo: resolvedPhoto,
  };
}

export function customerMatchesPhoneDigits(customer, normDigits) {
  if (!customer || !normDigits) return false;
  if (normalizePhoneDigits(customer.phone) === normDigits) return true;
  if (normalizePhoneDigits(customer.secondaryPhone) === normDigits) return true;
  if (Array.isArray(customer.phones)) {
    return customer.phones.some((p) => normalizePhoneDigits(typeof p === 'string' ? p : (p?.number ?? p?.phone)) === normDigits);
  }
  return false;
}

export function normalizeAllowedRepIds(assignedRepId, allowedRepIds) {
  const arr = [
    ...(assignedRepId ? [String(assignedRepId).trim()] : []),
    ...(Array.isArray(allowedRepIds) ? allowedRepIds.map((id) => String(id || '').trim()) : []),
  ].filter(Boolean);
  const unique = Array.from(new Set(arr));
  return {
    assignedRepId: unique[0] || undefined,
    allowedRepIds: unique,
  };
}

export function isCustomerAllowedForRep(customer, repId) {
  if (!customer || !repId) return false;
  if (customer.assignedRepId === repId) return true;
  if (Array.isArray(customer.allowedRepIds) && customer.allowedRepIds.includes(repId)) return true;
  return false;
}

export async function getRepresentativeByUserId(userId) {
  if (!userId) return null;
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM representatives WHERE user_id = $1 LIMIT 1', [userId]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id || undefined,
      name: r.name,
      phone: r.phone || '',
      vehicleNumber: r.vehicle_number || '',
      warehouseId: r.warehouse_id || undefined,
      openingBalance: Number(r.opening_balance || 0),
      currentBalance: Number(r.current_balance || 0),
      commissionRate: Number(r.commission_rate || 0),
      notes: r.notes || '',
      status: r.status || 'active',
    };
  }
  const db = readJsonDatabase();
  return (db.representatives || []).find((r) => r.userId === userId) || null;
}

export async function getSystemSettingsSafe() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM system_settings LIMIT 1');
    const s = res.rows[0];
    const extra = s?.extra_settings || {};
    const mobileConfig = { ...DEFAULT_MOBILE_CONFIG, ...(extra.mobileConfig || {}) };
    return {
      companyName: s?.company_name || 'مؤسسة أولاد سليم للتجارة والتوزيع',
      companySubtitle: s?.company_subtitle || '',
      phone1: s?.phone1 || '',
      phone2: s?.phone2 || '',
      address: s?.address || '',
      branchNumber: s?.branch_number || extra.branchNumber || '',
      currency: s?.currency || 'ج.م',
      allowNegativeStock: Boolean(s?.allow_negative_stock),
      extraSettings: { ...extra, mobileConfig },
      mobileConfig,
    };
  }
  const db = readJsonDatabase();
  const s = db.settings || {};
  const extra = s.extraSettings || {};
  const mobileConfig = { ...DEFAULT_MOBILE_CONFIG, ...(extra.mobileConfig || {}) };
  return {
    ...s,
    extraSettings: { ...extra, mobileConfig },
    mobileConfig,
  };
}

export async function listCustomers() {
  let rows;
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
    rows = res.rows.map(mapPgCustomerRow);
  } else {
    const db = readJsonDatabase();
    rows = [...db.customers]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(normalizeCustomerRecordShape);
  }
  return rows;
}

export async function getCustomerById(customerId) {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM customers WHERE id = $1 LIMIT 1', [customerId]);
    return mapPgCustomerRow(res.rows[0]);
  }
  const db = readJsonDatabase();
  const found = db.customers.find((c) => c.id === customerId) || null;
  return normalizeCustomerRecordShape(found);
}

export async function getCustomerByUserId(userId) {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM customers WHERE user_id = $1 LIMIT 1', [userId]);
    return mapPgCustomerRow(res.rows[0]);
  }
  const db = readJsonDatabase();
  const found = db.customers.find((c) => c.userId === userId) || null;
  return normalizeCustomerRecordShape(found);
}

export async function createCustomer(payload, actor) {
  const name = String(payload.name || '').trim();
  if (!name) throw new AppError(400, 'اسم العميل مطلوب', 'INVALID_CUSTOMER_NAME');

  const id = payload.id || generateServerId('CUS');
  const code = String(payload.code || `C-${Date.now().toString().slice(-5)}`).trim();
  const openingBalance = round2(payload.openingBalance ?? 0);
  const currentBalance = round2(payload.currentBalance ?? openingBalance);
  const now = nowIso();
  const userId = payload.userId || null;

  const normalizedPhones = Array.isArray(payload.phones)
    ? normalizeCustomerPhonesList(payload.phones, payload.phone || '', payload.secondaryPhone || '')
    : normalizeCustomerPhonesList([], payload.phone || '', payload.secondaryPhone || '');
  const primaryPhone = normalizedPhones.find((p) => p.isPrimary)?.number || normalizedPhones[0]?.number || String(payload.phone || '').trim();
  const secondaryEntry = normalizedPhones.find((p) => !p.isPrimary && p.number !== primaryPhone) || normalizedPhones[1];
  const secondaryPhone = secondaryEntry?.number || (payload.secondaryPhone ? String(payload.secondaryPhone).trim() : null);

  const safePhoto = sanitizeSafeImageUrl(payload.shopPhoto ?? payload.photo);
  const resolvedGeo = resolveCustomerGeoInput(payload, {});
  const safeGeo = resolvedGeo.geoCoordinates;
  const governorate = payload.governorate ? String(payload.governorate).trim() : '';

  let repAlloc = normalizeAllowedRepIds(payload.assignedRepId, payload.allowedRepIds);
  if (actor?.role === 'representative') {
    const repProfile = await getRepresentativeByUserId(actor.id);
    if (repProfile?.id) {
      const mergedAllowed = Array.from(new Set([...repAlloc.allowedRepIds, repProfile.id]));
      repAlloc = normalizeAllowedRepIds(repAlloc.assignedRepId || repProfile.id, mergedAllowed);
    }
  }

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      if (userId) {
        const dupLink = await client.query('SELECT id FROM customers WHERE user_id = $1 LIMIT 1', [userId]);
        if (dupLink.rows[0]) {
          throw new AppError(409, 'حساب المستخدم المختار مرتبط مسبقًا بعميل آخر', 'USER_ALREADY_LINKED');
        }
      }
      await client.query(
        `INSERT INTO customers (id, code, user_id, assigned_rep_id, allowed_rep_ids, name, phone, normalized_phone, secondary_phone, phones, shop_name, shop_photo, photo, address, governorate, area, city, geo_coordinates, latitude, longitude, location_captured_at, opening_balance, current_balance, price_history, notes, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
        [
          id,
          code,
          userId,
          repAlloc.assignedRepId || null,
          JSON.stringify(repAlloc.allowedRepIds),
          name,
          primaryPhone,
          normalizePhoneDigitsShared(primaryPhone),
          secondaryPhone || null,
          JSON.stringify(normalizedPhones),
          payload.shopName || null,
          safePhoto || null,
          safePhoto || null,
          payload.address || '',
          governorate,
          payload.area || null,
          resolvedGeo.city || '',
          safeGeo || null,
          resolvedGeo.latitude ?? null,
          resolvedGeo.longitude ?? null,
          resolvedGeo.locationCapturedAt || null,
          openingBalance,
          currentBalance,
          JSON.stringify(payload.priceHistory || {}),
          payload.notes || '',
          payload.status || 'active',
          now,
        ]
      );
      const custIdentityId = await attachRecordToIdentityPgTx(client, {
        entityType: 'customer',
        entityId: id,
        roleKey: 'customer',
        fullName: name,
        phone: primaryPhone,
        secondaryPhone: secondaryPhone || '',
        address: payload.address || '',
        notes: payload.notes || '',
        explicitIdentityId: payload.identityId || null,
        linkedUserId: userId,
        matchByUniquePhone: false,
        now,
      });
      const normCustPh = normalizePhoneDigitsShared(primaryPhone);
      if (normCustPh) {
        const dupCustPhones = await client.query(
          `SELECT id, name, code, phone FROM customers WHERE normalized_phone = $1 AND id <> $2 LIMIT 3`,
          [normCustPh, id]
        );
        if (dupCustPhones.rows.length > 0) {
          await logIdentityConflictPgTx(client, {
            conflictType: 'shared_customer_phone_notice',
            severity: 'warning',
            identifierKey: `customer:phone:${normCustPh}`,
            candidateRecords: [
              { entityType: 'customer', id, name, code, phone: primaryPhone, identityId: custIdentityId },
              ...dupCustPhones.rows.map((dc) => ({ entityType: 'customer', id: dc.id, name: dc.name, code: dc.code, phone: dc.phone })),
            ],
          });
        }
      }
      const r = await client.query('SELECT * FROM customers WHERE id = $1', [id]);
      const mapped = mapPgCustomerRow(r.rows[0]);
      if (!mapped.identityId) mapped.identityId = custIdentityId;
      return mapped;
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إضافة عميل جديد (${created.name})`,
      module: 'العملاء',
      recordId: created.id,
    });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    if (userId && db.customers.some((c) => c.userId === userId)) {
      throw new AppError(409, 'حساب المستخدم المختار مرتبط مسبقًا بعميل آخر', 'USER_ALREADY_LINKED');
    }
    if (db.customers.some((c) => c.code === code)) {
      throw new AppError(409, 'كود العميل مستخدم مسبقًا', 'DUPLICATE_CODE');
    }
    const item = normalizeCustomerRecordShape({
      id,
      code,
      userId: userId || undefined,
      assignedRepId: repAlloc.assignedRepId,
      allowedRepIds: repAlloc.allowedRepIds,
      name,
      phone: primaryPhone,
      secondaryPhone: secondaryPhone || undefined,
      phones: normalizedPhones,
      shopName: payload.shopName || undefined,
      shopPhoto: safePhoto,
      photo: safePhoto,
      address: payload.address || '',
      governorate: governorate || undefined,
      area: payload.area || undefined,
      city: resolvedGeo.city,
      geoCoordinates: safeGeo,
      latitude: resolvedGeo.latitude,
      longitude: resolvedGeo.longitude,
      locationCapturedAt: resolvedGeo.locationCapturedAt,
      favoriteProductIds: [],
      openingBalance,
      currentBalance,
      priceHistory: payload.priceHistory || {},
      notes: payload.notes || '',
      status: payload.status || 'active',
      createdAt: now,
    });
    db.customers.unshift(item);
    const custIdentityId = attachRecordToIdentityJsonTx(db, {
      entityType: 'customer',
      entityId: id,
      roleKey: 'customer',
      fullName: name,
      phone: primaryPhone,
      secondaryPhone: secondaryPhone || '',
      address: payload.address || '',
      notes: payload.notes || '',
      explicitIdentityId: payload.identityId || null,
      linkedUserId: userId,
      matchByUniquePhone: false,
      now,
    });
    item.identityId = custIdentityId;
    const normCustPh = normalizePhoneDigitsShared(primaryPhone);
    if (normCustPh) {
      const dupCust = (db.customers || []).filter(
        (c) => c.id !== id && normalizePhoneDigitsShared(c.phone) === normCustPh
      );
      if (dupCust.length > 0) {
        logIdentityConflictJsonTx(db, {
          conflictType: 'shared_customer_phone_notice',
          severity: 'warning',
          identifierKey: `customer:phone:${normCustPh}`,
          candidateRecords: [
            { entityType: 'customer', id, name, code, phone: primaryPhone, identityId: custIdentityId },
            ...dupCust.slice(0, 3).map((dc) => ({ entityType: 'customer', id: dc.id, name: dc.name, code: dc.code, phone: dc.phone })),
          ],
        });
      }
    }
    return item;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إضافة عميل جديد (${created.name})`,
    module: 'العملاء',
    recordId: created.id,
  });
  return created;
}

function resolveUpdatedCustomerPhonesAndPhoto(cur, updates) {
  let nextPhones;
  if (Array.isArray(updates.phones)) {
    nextPhones = normalizeCustomerPhonesList(updates.phones, '', '');
  } else if (updates.phone !== undefined || updates.secondaryPhone !== undefined) {
    const curSecDigits = normalizePhoneDigits(cur.secondaryPhone || '');
    const baseOtherPhones = (cur.phones || [])
      .filter((p) => {
        if (p.isPrimary) return false;
        const pDigits = normalizePhoneDigits(p.number ?? p.phone ?? '');
        return !curSecDigits || pDigits !== curSecDigits;
      })
      .map((p) => ({ number: p.number ?? p.phone ?? '', label: p.label || '', isPrimary: false }));
    const mergedList = [
      ...(updates.phone !== undefined ? [{ number: updates.phone, label: 'رئيسي', isPrimary: true }] : cur.phone ? [{ number: cur.phone, label: 'رئيسي', isPrimary: true }] : []),
      ...(updates.secondaryPhone !== undefined ? (updates.secondaryPhone ? [{ number: updates.secondaryPhone, label: 'إضافي', isPrimary: false }] : []) : cur.secondaryPhone ? [{ number: cur.secondaryPhone, label: 'إضافي', isPrimary: false }] : []),
      ...baseOtherPhones,
    ];
    nextPhones = normalizeCustomerPhonesList(mergedList, '', '');
  } else {
    nextPhones = normalizeCustomerPhonesList(cur.phones, cur.phone || '', cur.secondaryPhone || '');
  }

  const nextPrimary = nextPhones.find((p) => p.isPrimary)?.number || nextPhones[0]?.number || (updates.phone !== undefined ? String(updates.phone || '') : cur.phone || '');
  const nextSecondaryEntry = nextPhones.find((p) => !p.isPrimary && p.number !== nextPrimary) || nextPhones[1];
  const nextSecondary = nextSecondaryEntry?.number || (updates.phones !== undefined ? undefined : (updates.secondaryPhone !== undefined ? (updates.secondaryPhone || undefined) : cur.secondaryPhone));

  let nextPhoto;
  if (updates.clearShopPhoto === true) {
    nextPhoto = undefined;
  } else if (updates.shopPhoto !== undefined || updates.photo !== undefined) {
    const incomingPhoto = updates.shopPhoto !== undefined ? updates.shopPhoto : updates.photo;
    if (incomingPhoto === null || incomingPhoto === '') {
      // Preserve existing photo unless clearShopPhoto is explicitly set to true
      nextPhoto = cur.shopPhoto || cur.photo || undefined;
    } else {
      nextPhoto = sanitizeSafeImageUrl(incomingPhoto);
    }
  } else {
    nextPhoto = cur.shopPhoto || cur.photo || undefined;
  }

  const resolvedGeo = resolveCustomerGeoInput(updates, cur);

  return {
    nextPhones,
    nextPrimary,
    nextSecondary,
    nextPhoto,
    nextGeo: resolvedGeo.geoCoordinates,
    nextLat: resolvedGeo.latitude,
    nextLng: resolvedGeo.longitude,
    nextCity: resolvedGeo.city,
    nextLocationCapturedAt: resolvedGeo.locationCapturedAt,
  };
}

export async function updateCustomer(customerId, updates, actor) {
  const now = nowIso();
  const isRepActor = actor?.role === 'representative';
  const repActor = isRepActor ? await getRepresentativeByUserId(actor.id) : null;
  if (isRepActor && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }

  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!existing.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      const cur = mapPgCustomerRow(existing.rows[0]);

      const nextUserId = isRepActor
        ? (cur.userId || null)
        : (updates.userId !== undefined ? (updates.userId || null) : (cur.userId || null));
      if (!isRepActor && nextUserId && nextUserId !== cur.userId) {
        const dupLink = await client.query('SELECT id FROM customers WHERE user_id = $1 AND id <> $2 LIMIT 1', [
          nextUserId,
          customerId,
        ]);
        if (dupLink.rows[0]) {
          throw new AppError(409, 'حساب المستخدم المختار مرتبط بعميل آخر', 'USER_ALREADY_LINKED');
        }
      }

      const repAlloc = isRepActor
        ? normalizeAllowedRepIds(cur.assignedRepId, cur.allowedRepIds)
        : (updates.allowedRepIds !== undefined || updates.assignedRepId !== undefined
            ? normalizeAllowedRepIds(
                updates.assignedRepId !== undefined ? updates.assignedRepId : undefined,
                updates.allowedRepIds !== undefined ? updates.allowedRepIds : cur.allowedRepIds
              )
            : normalizeAllowedRepIds(cur.assignedRepId, cur.allowedRepIds));

      const { nextPhones, nextPrimary, nextSecondary, nextPhoto, nextGeo, nextLat, nextLng, nextCity, nextLocationCapturedAt } = resolveUpdatedCustomerPhonesAndPhoto(cur, updates);

      await client.query(
        `UPDATE customers SET
          name = $1, phone = $2, normalized_phone = $3, secondary_phone = $4, phones = $5, shop_name = $6, shop_photo = $7, photo = $8,
          address = $9, governorate = $10, area = $11, city = $12, geo_coordinates = $13, latitude = $14, longitude = $15, location_captured_at = $16, notes = $17, status = $18, user_id = $19,
          assigned_rep_id = $20, allowed_rep_ids = $21, version = COALESCE(version, 1) + 1, updated_at = $22
         WHERE id = $23`,
        [
          updates.name ?? cur.name,
          nextPrimary,
          normalizePhoneDigitsShared(nextPrimary),
          nextSecondary ?? null,
          JSON.stringify(nextPhones),
          updates.shopName ?? cur.shopName ?? null,
          nextPhoto ?? null,
          nextPhoto ?? null,
          updates.address ?? cur.address,
          updates.governorate !== undefined ? (updates.governorate || '') : (cur.governorate || ''),
          updates.area ?? cur.area ?? null,
          nextCity || '',
          nextGeo ?? null,
          nextLat ?? null,
          nextLng ?? null,
          nextLocationCapturedAt || null,
          updates.notes ?? cur.notes ?? '',
          isRepActor ? cur.status : (updates.status ?? cur.status),
          nextUserId,
          repAlloc.assignedRepId || null,
          JSON.stringify(repAlloc.allowedRepIds),
          now,
          customerId,
        ]
      );
      await attachRecordToIdentityPgTx(client, {
        entityType: 'customer',
        entityId: customerId,
        roleKey: 'customer',
        fullName: updates.name ?? cur.name,
        phone: nextPrimary,
        secondaryPhone: nextSecondary || '',
        address: updates.address ?? cur.address ?? '',
        notes: updates.notes ?? cur.notes ?? '',
        explicitIdentityId: updates.identityId || cur.identityId || null,
        linkedUserId: nextUserId,
        matchByUniquePhone: false,
        now,
      });
      const r = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      return mapPgCustomerRow(r.rows[0]);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث بيانات العميل (${updated.name})`,
      module: 'العملاء',
      recordId: updated.id,
    });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    const idx = db.customers.findIndex((c) => c.id === customerId);
    if (idx === -1) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    const cur = normalizeCustomerRecordShape(db.customers[idx]);
    if (!isRepActor && updates.userId && updates.userId !== cur.userId && db.customers.some((c) => c.userId === updates.userId && c.id !== customerId)) {
      throw new AppError(409, 'حساب المستخدم المختار مرتبط بعميل آخر', 'USER_ALREADY_LINKED');
    }
    const repAlloc = isRepActor
      ? normalizeAllowedRepIds(cur.assignedRepId, cur.allowedRepIds)
      : (updates.allowedRepIds !== undefined || updates.assignedRepId !== undefined
          ? normalizeAllowedRepIds(
              updates.assignedRepId !== undefined ? updates.assignedRepId : undefined,
              updates.allowedRepIds !== undefined ? updates.allowedRepIds : cur.allowedRepIds
            )
          : normalizeAllowedRepIds(cur.assignedRepId, cur.allowedRepIds));
    const { nextPhones, nextPrimary, nextSecondary, nextPhoto, nextGeo, nextLat, nextLng, nextCity, nextLocationCapturedAt } = resolveUpdatedCustomerPhonesAndPhoto(cur, updates);
    const { clearShopPhoto: _ignoreClear, ...cleanUpdates } = updates;
    const merged = normalizeCustomerRecordShape({
      ...cur,
      ...cleanUpdates,
      id: cur.id,
      userId: isRepActor ? cur.userId : (cleanUpdates.userId !== undefined ? cleanUpdates.userId : cur.userId),
      status: isRepActor ? cur.status : (cleanUpdates.status ?? cur.status),
      openingBalance: cur.openingBalance,
      phone: nextPrimary,
      secondaryPhone: nextSecondary,
      phones: nextPhones,
      shopPhoto: nextPhoto,
      photo: nextPhoto,
      geoCoordinates: nextGeo,
      latitude: nextLat,
      longitude: nextLng,
      city: nextCity,
      locationCapturedAt: nextLocationCapturedAt,
      governorate: updates.governorate !== undefined ? (updates.governorate || undefined) : cur.governorate,
      assignedRepId: repAlloc.assignedRepId,
      allowedRepIds: repAlloc.allowedRepIds,
      currentBalance: cur.currentBalance, // Prevent direct balance override via profile edit
      version: Number(cur.version || 1) + 1,
      updatedAt: now,
    });
    db.customers[idx] = merged;
    merged.identityId = attachRecordToIdentityJsonTx(db, {
      entityType: 'customer',
      entityId: customerId,
      roleKey: 'customer',
      fullName: merged.name,
      phone: merged.phone,
      secondaryPhone: merged.secondaryPhone || '',
      address: merged.address || '',
      notes: merged.notes || '',
      explicitIdentityId: updates.identityId || cur.identityId || null,
      linkedUserId: merged.userId || null,
      matchByUniquePhone: false,
      now,
    });
    return merged;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحديث بيانات العميل (${updated.name})`,
    module: 'العملاء',
    recordId: updated.id,
  });
  return updated;
}

const CUSTOMER_SELF_FORBIDDEN_FIELDS = [
  'openingBalance',
  'currentBalance',
  'status',
  'assignedRepId',
  'allowedRepIds',
  'userId',
  'code',
];

export async function updateOwnCustomerProfile(userId, customerId, updates = {}, actor) {
  for (const field of CUSTOMER_SELF_FORBIDDEN_FIELDS) {
    if (updates[field] !== undefined) {
      throw new AppError(
        403,
        'لا يُسمح للعميل بتعديل الأرصدة المالية أو الحالة أو المندوب المخصص',
        'FORBIDDEN_CUSTOMER_FIELD_EDIT'
      );
    }
  }

  const allowedUpdates = {};
  if (updates.name !== undefined) {
    const cleanName = String(updates.name || '').trim();
    if (cleanName.length < 2) throw new AppError(400, 'الاسم يجب أن لا يقل عن حرفين', 'INVALID_CUSTOMER_NAME');
    allowedUpdates.name = cleanName;
  }
  if (updates.shopName !== undefined) allowedUpdates.shopName = String(updates.shopName || '').trim() || undefined;
  if (updates.phone !== undefined) allowedUpdates.phone = String(updates.phone || '').trim();
  if (updates.secondaryPhone !== undefined) allowedUpdates.secondaryPhone = String(updates.secondaryPhone || '').trim();
  if (updates.phones !== undefined) allowedUpdates.phones = updates.phones;
  if (updates.address !== undefined) allowedUpdates.address = String(updates.address || '').trim();
  if (updates.governorate !== undefined) allowedUpdates.governorate = String(updates.governorate || '').trim();
  if (updates.area !== undefined) allowedUpdates.area = String(updates.area || '').trim() || undefined;
  if (updates.city !== undefined) allowedUpdates.city = String(updates.city || '').trim() || undefined;
  if (updates.geoCoordinates !== undefined) allowedUpdates.geoCoordinates = updates.geoCoordinates;
  if (updates.latitude !== undefined) allowedUpdates.latitude = updates.latitude;
  if (updates.longitude !== undefined) allowedUpdates.longitude = updates.longitude;
  if (updates.locationCapturedAt !== undefined) allowedUpdates.locationCapturedAt = updates.locationCapturedAt;
  if (updates.shopPhoto !== undefined) allowedUpdates.shopPhoto = updates.shopPhoto;
  if (updates.photo !== undefined) allowedUpdates.photo = updates.photo;
  if (updates.clearShopPhoto !== undefined) allowedUpdates.clearShopPhoto = Boolean(updates.clearShopPhoto);

  const now = nowIso();

  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM customers WHERE id = $1 AND user_id = $2 FOR UPDATE', [
        customerId,
        userId,
      ]);
      if (!existing.rows[0]) {
        throw new AppError(404, 'ملف العميل غير موجود أو غير مربوط بحسابك', 'CUSTOMER_NOT_FOUND');
      }
      const cur = mapPgCustomerRow(existing.rows[0]);
      const { nextPhones, nextPrimary, nextSecondary, nextPhoto, nextGeo, nextLat, nextLng, nextCity, nextLocationCapturedAt } = resolveUpdatedCustomerPhonesAndPhoto(
        cur,
        allowedUpdates
      );

      const nextName = allowedUpdates.name ?? cur.name;
      const nextAddress = allowedUpdates.address ?? cur.address;
      await client.query(
        `UPDATE customers SET
          name = $1, phone = $2, normalized_phone = $3, secondary_phone = $4, phones = $5, shop_name = $6, shop_photo = $7, photo = $8,
          address = $9, governorate = $10, area = $11, city = $12, geo_coordinates = $13, latitude = $14, longitude = $15, location_captured_at = $16,
          version = COALESCE(version, 1) + 1, updated_at = $17
         WHERE id = $18`,
        [
          nextName,
          nextPrimary,
          normalizePhoneDigitsShared(nextPrimary),
          nextSecondary ?? null,
          JSON.stringify(nextPhones),
          allowedUpdates.shopName !== undefined ? (allowedUpdates.shopName || null) : (cur.shopName ?? null),
          nextPhoto ?? null,
          nextPhoto ?? null,
          nextAddress,
          allowedUpdates.governorate !== undefined ? (allowedUpdates.governorate || '') : (cur.governorate || ''),
          allowedUpdates.area !== undefined ? (allowedUpdates.area || null) : (cur.area ?? null),
          nextCity || '',
          nextGeo ?? null,
          nextLat ?? null,
          nextLng ?? null,
          nextLocationCapturedAt || null,
          now,
          customerId,
        ]
      );
      await client.query(
        `UPDATE users SET full_name = $1, phone = $2, normalized_phone = $3, address = $4, updated_at = $5 WHERE id = $6`,
        [nextName, nextPrimary, normalizePhoneDigitsShared(nextPrimary), nextAddress, now, userId]
      );
      const r = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      const mapped = mapPgCustomerRow(r.rows[0]);
      if (mapped?.assignedRepId) {
        const repRes = await client.query('SELECT id, name, phone FROM representatives WHERE id = $1 LIMIT 1', [
          mapped.assignedRepId,
        ]);
        if (repRes.rows[0]) {
          mapped.assignedRep = {
            id: repRes.rows[0].id,
            name: repRes.rows[0].name,
            phone: repRes.rows[0].phone || '',
          };
        }
      }
      return mapped;
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث العميل لبياناته وبيانات المحل (${updated.name})`,
      module: 'العملاء',
      recordId: updated.id,
    });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    const idx = db.customers.findIndex((c) => c.id === customerId && c.userId === userId);
    if (idx === -1) {
      throw new AppError(404, 'ملف العميل غير موجود أو غير مربوط بحسابك', 'CUSTOMER_NOT_FOUND');
    }
    const cur = normalizeCustomerRecordShape(db.customers[idx]);
    const { nextPhones, nextPrimary, nextSecondary, nextPhoto, nextGeo, nextLat, nextLng, nextCity, nextLocationCapturedAt } = resolveUpdatedCustomerPhonesAndPhoto(
      cur,
      allowedUpdates
    );
    const { clearShopPhoto: _ignoreClear, ...cleanAllowed } = allowedUpdates;
    const nextName = cleanAllowed.name ?? cur.name;
    const nextAddress = cleanAllowed.address ?? cur.address;
    const merged = normalizeCustomerRecordShape({
      ...cur,
      ...cleanAllowed,
      id: cur.id,
      name: nextName,
      address: nextAddress,
      phone: nextPrimary,
      secondaryPhone: nextSecondary,
      phones: nextPhones,
      shopPhoto: nextPhoto,
      photo: nextPhoto,
      geoCoordinates: nextGeo,
      latitude: nextLat,
      longitude: nextLng,
      city: nextCity,
      locationCapturedAt: nextLocationCapturedAt,
      governorate:
        allowedUpdates.governorate !== undefined ? (allowedUpdates.governorate || undefined) : cur.governorate,
      version: Number(cur.version || 1) + 1,
      updatedAt: now,
    });
    db.customers[idx] = merged;

    const uIdx = (db.users || []).findIndex((u) => u.id === userId);
    if (uIdx !== -1) {
      db.users[uIdx] = {
        ...db.users[uIdx],
        fullName: nextName,
        phone: nextPrimary,
        address: nextAddress,
      };
    }

    const out = structuredClone(merged);
    if (out.assignedRepId) {
      const rep = (db.representatives || []).find((r) => r.id === out.assignedRepId);
      if (rep) {
        out.assignedRep = { id: rep.id, name: rep.name, phone: rep.phone || '' };
      }
    }
    return out;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحديث العميل لبياناته وبيانات المحل (${updated.name})`,
    module: 'العملاء',
    recordId: updated.id,
  });
  return updated;
}

export async function deleteCustomer(customerId, actor) {
  if (await isPgMode()) {
    const deleted = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!existing.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      const cur = mapPgCustomerRow(existing.rows[0]);
      if (Math.abs(cur.currentBalance) > 0.001) {
        throw new AppError(409, 'لا يمكن حذف عميل عليه رصيد مالي غير مسوّى', 'CUSTOMER_HAS_BALANCE');
      }
      const [invRef, ordRef, txRef, chqRef] = await Promise.all([
        client.query('SELECT id FROM invoices WHERE customer_id = $1 LIMIT 1', [customerId]),
        client.query('SELECT id FROM customer_item_orders WHERE customer_id = $1 LIMIT 1', [customerId]),
        client.query(
          `SELECT id FROM financial_transactions WHERE related_entity_id = $1 AND type = 'customer_payment' LIMIT 1`,
          [customerId]
        ),
        client.query('SELECT id FROM cheques WHERE party_id = $1 LIMIT 1', [customerId]),
      ]);
      if (invRef.rows[0] || ordRef.rows[0] || txRef.rows[0] || chqRef.rows[0]) {
        throw new AppError(
          409,
          'لا يمكن حذف عميل مرتبط بفواتير أو طلبات أو حركات مالية. يمكنك إيقافه أو حظره بدلاً من الحذف.',
          'CUSTOMER_REFERENCED'
        );
      }
      await client.query('DELETE FROM customers WHERE id = $1', [customerId]);
      return cur;
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `حذف عميل (${deleted.name})`,
      module: 'العملاء',
      recordId: customerId,
    });
    return { ok: true };
  }

  const deleted = await withJsonTransaction(async (db) => {
    const cur = db.customers.find((c) => c.id === customerId);
    if (!cur) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    if (Math.abs(Number(cur.currentBalance || 0)) > 0.001) {
      throw new AppError(409, 'لا يمكن حذف عميل عليه رصيد مالي غير مسوّى', 'CUSTOMER_HAS_BALANCE');
    }
    const hasPayments = (db.financialTransactions || []).some(
      (tx) => (tx.relatedEntityId === customerId || tx.partyId === customerId) && tx.type === 'customer_payment'
    );
    const hasCheques = (db.cheques || []).some((ch) => ch.partyId === customerId);
    if (
      (db.invoices || []).some((i) => i.customerId === customerId) ||
      (db.customerItemOrders || []).some((o) => o.customerId === customerId) ||
      hasPayments ||
      hasCheques
    ) {
      throw new AppError(
        409,
        'لا يمكن حذف عميل مرتبط بفواتير أو طلبات أو حركات مالية. يمكنك إيقافه بدلاً من الحذف.',
        'CUSTOMER_REFERENCED'
      );
    }
    db.customers = db.customers.filter((c) => c.id !== customerId);
    return cur;
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `حذف عميل (${deleted.name})`,
    module: 'العملاء',
    recordId: customerId,
  });
  return { ok: true };
}

export async function linkCustomerToUser({ customerId, existingUserId, createUser }, actor) {
  const now = nowIso();
  if (!existingUserId && !createUser) {
    throw new AppError(400, 'يرجى تحديد حساب موجود أو إدخال بيانات إنشاء حساب جديد للعميل', 'MISSING_LINK_TARGET');
  }

  let newPasswordHash = null;
  if (createUser) {
    const uname = String(createUser.username || '').trim();
    const pass = String(createUser.password || '');
    if (uname.length < 3 || pass.length < 6) {
      throw new AppError(400, 'اسم المستخدم (3+ أحرف) وكلمة المرور (6+ أحرف) مطلوبان', 'INVALID_USER_CREDENTIALS');
    }
    newPasswordHash = await hashPasswordBcrypt(pass);
  }

  const liveSettings = await getSystemSettingsSafe();
  const customerPresetPerms = resolveDefaultPermissionsForRole('customer', liveSettings.extraSettings || {});

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const custRes = await client.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!custRes.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      const customer = mapPgCustomerRow(custRes.rows[0]);

      let targetUserId = existingUserId || null;
      let createdUser = null;

      if (createUser) {
        const cleanUsername = String(createUser.username).trim();
        const dupUser = await client.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [cleanUsername]);
        if (dupUser.rows[0]) throw new AppError(409, 'اسم المستخدم مسجل مسبقًا', 'DUPLICATE_USERNAME');

        targetUserId = generateServerId('USR');
        await client.query(
          `INSERT INTO users (id, full_name, username, password_hash, password_algo, phone, role, job_title, department, is_active, must_change_password, permissions, created_at)
           VALUES ($1, $2, $3, $4, 'bcrypt', $5, 'customer', 'عميل', 'المبيعات', TRUE, $6, $7, $8)`,
          [
            targetUserId,
            createUser.fullName || customer.name,
            cleanUsername,
            newPasswordHash,
            createUser.phone || customer.phone || '',
            Boolean(createUser.mustChangePassword),
            JSON.stringify(customerPresetPerms),
            now,
          ]
        );
        const uRes = await client.query('SELECT * FROM users WHERE id = $1', [targetUserId]);
        createdUser = sanitizeUser(mapPgUserRow(uRes.rows[0]));
      } else {
        const uRes = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [targetUserId]);
        if (!uRes.rows[0]) throw new AppError(404, 'حساب المستخدم غير موجود', 'USER_NOT_FOUND');
        if (uRes.rows[0].role !== 'customer') {
          throw new AppError(400, 'لا يمكن ربط العميل إلا بحساب يحمل دور عميل (customer)', 'ROLE_MISMATCH');
        }
        const already = await client.query('SELECT id, name FROM customers WHERE user_id = $1 AND id <> $2 LIMIT 1', [
          targetUserId,
          customerId,
        ]);
        if (already.rows[0]) {
          throw new AppError(409, `هذا الحساب مرتبط مسبقًا بالعميل (${already.rows[0].name})`, 'USER_ALREADY_LINKED');
        }
      }

      await client.query('UPDATE customers SET user_id = $1, updated_at = $2 WHERE id = $3', [targetUserId, now, customerId]);
      const baseCustIdentityId =
        customer.identityId ||
        (await attachRecordToIdentityPgTx(client, {
          entityType: 'customer',
          entityId: customerId,
          roleKey: 'customer',
          fullName: customer.name,
          phone: customer.phone || '',
          address: customer.address || '',
          matchByUniquePhone: false,
          now,
        }));
      await attachRecordToIdentityPgTx(client, {
        entityType: 'user',
        entityId: targetUserId,
        roleKey: 'user',
        fullName: createdUser?.fullName || customer.name,
        phone: createdUser?.phone || customer.phone || '',
        explicitIdentityId: baseCustIdentityId,
        isPrimary: true,
        now,
      });
      await attachRecordToIdentityPgTx(client, {
        entityType: 'customer',
        entityId: customerId,
        roleKey: 'customer',
        fullName: customer.name,
        phone: customer.phone || '',
        explicitIdentityId: baseCustIdentityId,
        matchByUniquePhone: false,
        now,
      });
      if (createdUser) {
        createdUser.identityId = baseCustIdentityId;
      }
      const updatedCust = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      return {
        customer: mapPgCustomerRow(updatedCust.rows[0]),
        user: createdUser,
        identityId: baseCustIdentityId,
      };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `ربط العميل (${result.customer.name}) بحساب دخول (${result.customer.userId})`,
      module: 'العملاء',
      recordId: customerId,
    });
    return result;
  }

  const result = await withJsonTransaction(async (db) => {
    const cIdx = db.customers.findIndex((c) => c.id === customerId);
    if (cIdx === -1) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    const customer = db.customers[cIdx];

    let targetUserId = existingUserId || null;
    let createdUser = null;

    if (createUser) {
      const cleanUsername = String(createUser.username).trim();
      if (db.users.some((u) => String(u.username || '').toLowerCase() === cleanUsername.toLowerCase())) {
        throw new AppError(409, 'اسم المستخدم مسجل مسبقًا', 'DUPLICATE_USERNAME');
      }
      targetUserId = generateServerId('USR');
      const newUser = {
        id: targetUserId,
        fullName: createUser.fullName || customer.name,
        username: cleanUsername,
        passwordHash: newPasswordHash,
        passwordAlgo: 'bcrypt',
        phone: createUser.phone || customer.phone || '',
        role: 'customer',
        jobTitle: 'عميل',
        department: 'المبيعات',
        isActive: true,
        mustChangePassword: Boolean(createUser.mustChangePassword),
        permissions: customerPresetPerms,
        createdAt: now,
      };
      db.users.push(newUser);
      createdUser = sanitizeUser(newUser);
    } else {
      const u = db.users.find((x) => x.id === targetUserId);
      if (!u) throw new AppError(404, 'حساب المستخدم غير موجود', 'USER_NOT_FOUND');
      if (u.role !== 'customer') {
        throw new AppError(400, 'لا يمكن ربط العميل إلا بحساب يحمل دور عميل (customer)', 'ROLE_MISMATCH');
      }
      const already = db.customers.find((c) => c.userId === targetUserId && c.id !== customerId);
      if (already) {
        throw new AppError(409, `هذا الحساب مرتبط مسبقًا بالعميل (${already.name})`, 'USER_ALREADY_LINKED');
      }
    }

    const baseCustIdentityId =
      customer.identityId ||
      attachRecordToIdentityJsonTx(db, {
        entityType: 'customer',
        entityId: customerId,
        roleKey: 'customer',
        fullName: customer.name,
        phone: customer.phone || '',
        address: customer.address || '',
        matchByUniquePhone: false,
        now,
      });
    const usrObj = db.users.find((u) => u.id === targetUserId);
    attachRecordToIdentityJsonTx(db, {
      entityType: 'user',
      entityId: targetUserId,
      roleKey: 'user',
      fullName: usrObj?.fullName || customer.name,
      phone: usrObj?.phone || customer.phone || '',
      explicitIdentityId: baseCustIdentityId,
      isPrimary: true,
      now,
    });
    if (usrObj) usrObj.identityId = baseCustIdentityId;
    if (createdUser) createdUser.identityId = baseCustIdentityId;
    db.customers[cIdx] = { ...customer, userId: targetUserId, identityId: baseCustIdentityId };
    attachRecordToIdentityJsonTx(db, {
      entityType: 'customer',
      entityId: customerId,
      roleKey: 'customer',
      fullName: customer.name,
      phone: customer.phone || '',
      explicitIdentityId: baseCustIdentityId,
      matchByUniquePhone: false,
      now,
    });
    return {
      customer: db.customers[cIdx],
      user: createdUser,
      identityId: baseCustIdentityId,
    };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `ربط العميل (${result.customer.name}) بحساب دخول (${result.customer.userId})`,
    module: 'العملاء',
    recordId: customerId,
  });
  return result;
}

export async function recordCustomerPayment({ customerId, invoiceId, amount, cashboxId, paymentMethod = 'cash', notes = '', date }, actor, idempotencyKey = '') {
  const payAmount = round2(amount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    throw new AppError(400, 'مبلغ التحصيل يجب أن يكون أكبر من الصفر', 'INVALID_AMOUNT');
  }
  const cleanMethod = ['cash', 'bank', 'cheque'].includes(paymentMethod) ? paymentMethod : 'cash';
  const methodLabel = cleanMethod === 'bank' ? 'تحويل بنكي' : cleanMethod === 'cheque' ? 'شيك' : 'نقداً';
  const collectionLocation = actor?.role === 'representative' ? 'rep' : 'branch';
  const txDate = date || todayIso();
  const now = nowIso();
  const baseTxId = generateServerId('FIN');
  const baseTxNumber = `REC-${Date.now().toString().slice(-6)}`;
  const endpoint = `POST /api/customers/${customerId}/payment`;
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);
  const requestedInvoiceId = invoiceId ? String(invoiceId).trim() : '';

  if (await isPgMode()) {
    const res = await withTransaction(async (client) => {
      const dup = await findPgIdempotency(client, scopedIdem);
      if (dup) return { deduplicated: true, ...dup };

      const custRes = await client.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!custRes.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      const cust = mapPgCustomerRow(custRes.rows[0]);

      const requestedCashboxId = actor?.role === 'representative' ? undefined : cashboxId;
      let cbRes;
      if (requestedCashboxId) {
        cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [requestedCashboxId]);
      } else {
        const defRes = await client.query('SELECT id FROM cashboxes ORDER BY is_default DESC LIMIT 1');
        const defId = defRes.rows[0]?.id;
        if (!defId) throw new AppError(400, 'لا توجد خزينة متاحة', 'CASHBOX_REQUIRED');
        cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [defId]);
      }
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const cb = cbRes.rows[0];

      const prevCbBalance = round2(Number(cb.current_balance || 0));
      const nextCustBalance = round2(cust.currentBalance - payAmount);
      const nextCbBalance = round2(prevCbBalance + payAmount);

      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      let repProfile = null;
      if (actor?.role === 'representative') {
        const repRow = (await client.query('SELECT id FROM representatives WHERE user_id = $1 LIMIT 1', [actor.id])).rows[0];
        repProfile = repRow ? { id: repRow.id } : null;
      }

      const openInvRes = await client.query(
        `SELECT * FROM invoices
         WHERE customer_id = $1 AND type = 'sales' AND status = 'confirmed' AND remaining_amount > 0.01
         ORDER BY date ASC, created_at ASC
         FOR UPDATE`,
        [customerId]
      );
      const retRes = await client.query(
        `SELECT original_invoice_id, COALESCE(SUM(grand_total), 0) AS ret_total
         FROM invoice_returns
         WHERE party_id = $1 AND type = 'sales_return' AND refund_type = 'balance'
         GROUP BY original_invoice_id`,
        [customerId]
      );
      const retByInv = new Map(retRes.rows.map((r) => [r.original_invoice_id, round2(r.ret_total || 0)]));

      const openInvoices = openInvRes.rows.filter((inv) => {
        if (actor?.role !== 'representative') return true;
        return isRepOwnerOfInvoice(
          {
            representativeId: inv.representative_id,
            sentByUserId: inv.sent_by_user_id,
            createdBy: inv.created_by,
            createdByUserId: inv.created_by_user_id,
          },
          actor,
          repProfile
        );
      });

      if (requestedInvoiceId) {
        const checkTarget = openInvRes.rows.find((r) => r.id === requestedInvoiceId);
        if (!checkTarget) {
          const existsAny = (await client.query(`SELECT id, customer_id, status FROM invoices WHERE id = $1 LIMIT 1`, [requestedInvoiceId])).rows[0];
          if (!existsAny || existsAny.customer_id !== customerId) {
            throw new AppError(404, 'الفاتورة المحددة غير موجودة لهذا العميل', 'INVOICE_NOT_FOUND');
          }
        } else if (actor?.role === 'representative' && !openInvoices.some((o) => o.id === requestedInvoiceId)) {
          throw new AppError(403, 'غير مصرح للمندوب بالتحصيل على فاتورة لا تخصه', 'FORBIDDEN_REP_INVOICE_ACCESS');
        }
      }

      await client.query('UPDATE customers SET current_balance = $1, updated_at = $2 WHERE id = $3', [
        nextCustBalance,
        now,
        customerId,
      ]);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCbBalance, cb.id]);

      let remainingToAllocate = payAmount;
      let openingAllocated = 0;
      const allocatedInvoices = [];
      let runningCb = prevCbBalance;
      let txCounter = 0;

      const emitPaymentAndFtForInvoice = async (invRow, allocAmt) => {
        const newPaid = round2(Number(invRow.paid_amount || 0) + allocAmt);
        const newRem = round2(Math.max(0, Number(invRow.grand_total || 0) - newPaid));
        const newPayType = newRem <= 0.01 ? 'cash' : 'partial';
        const payId = generateServerId('PAY');

        await client.query(
          `UPDATE invoices SET paid_amount = $1, remaining_amount = $2, payment_type = $3, updated_at = $4 WHERE id = $5`,
          [newPaid, newRem, newPayType, now, invRow.id]
        );
        await client.query(
          `INSERT INTO invoice_payments (id, invoice_id, invoice_number, amount, date, payment_method, cashbox_id, cashbox_name, notes, collection_location, created_by, created_by_user_id, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            payId,
            invRow.id,
            invRow.invoice_number,
            allocAmt,
            txDate,
            cleanMethod,
            cb.id,
            cb.name,
            notes || (collectionLocation === 'branch' ? 'تحصيل من الفرع على الفاتورة' : 'تحصيل المندوب على الفاتورة'),
            collectionLocation,
            actor.fullName,
            actor.id || null,
            actorCtx.actorIdentityId || null,
            actorCtx.actorEmployeeId || null,
            actorCtx.actingRole || actor.role || null,
            now,
          ]
        );

        runningCb = round2(runningCb + allocAmt);
        const curTxId = txCounter === 0 ? baseTxId : generateServerId('FIN');
        const curTxNum = txCounter === 0 ? baseTxNumber : `${baseTxNumber}-${txCounter + 1}`;
        txCounter++;

        await client.query(
          `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_type, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1, $2, $3, 'customer_payment', $4, $5, $6, $7, $8, 'customer', $9, $10, 'sales', $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            curTxId,
            curTxNum,
            txDate,
            allocAmt,
            cb.id,
            cb.name,
            runningCb,
            `تحصيل من عميل (${methodLabel})`,
            cust.id,
            cust.name,
            invRow.id,
            invRow.invoice_number,
            `تحصيل (${methodLabel}) على الفاتورة ${invRow.invoice_number} - العميل: ${cust.name}`,
            notes || '',
            actor.id,
            actor.fullName,
            actorCtx.actorIdentityId || null,
            actorCtx.actorEmployeeId || null,
            actorCtx.actingRole || actor.role || null,
            now,
          ]
        );

        allocatedInvoices.push({
          invoiceId: invRow.id,
          invoiceNumber: invRow.invoice_number,
          allocatedAmount: allocAmt,
          paidAmountAfter: newPaid,
          remainingAmountAfter: newRem,
          paymentId: payId,
        });
      };

      const getEffectiveRem = (invRow) => {
        const retDed = retByInv.get(invRow.id) || 0;
        return Math.max(0, round2(Number(invRow.remaining_amount || 0) - retDed));
      };

      if (requestedInvoiceId) {
        const target = openInvoices.find((inv) => inv.id === requestedInvoiceId);
        if (target) {
          const eff = getEffectiveRem(target);
          const alloc = round2(Math.min(remainingToAllocate, eff));
          if (alloc > 0.009) {
            await emitPaymentAndFtForInvoice(target, alloc);
            remainingToAllocate = round2(Math.max(0, remainingToAllocate - alloc));
          }
        }
      } else if (Number(cust.openingBalance || 0) > 0.01) {
        const priorManRes = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS s FROM financial_transactions WHERE related_entity_id = $1 AND type = 'customer_payment' AND COALESCE(related_doc_type, 'manual') NOT IN ('sales', 'order_advance')`,
          [customerId]
        );
        const priorManualPaid = round2(priorManRes.rows[0]?.s || 0);
        const unallocatedOpening = Math.max(0, round2(Number(cust.openingBalance || 0) - priorManualPaid));
        if (unallocatedOpening > 0.009) {
          openingAllocated = round2(Math.min(remainingToAllocate, unallocatedOpening));
          remainingToAllocate = round2(Math.max(0, remainingToAllocate - openingAllocated));
        }
      }

      for (const invRow of openInvoices) {
        if (remainingToAllocate <= 0.009) break;
        if (requestedInvoiceId && invRow.id === requestedInvoiceId) continue;
        const eff = getEffectiveRem(invRow);
        if (eff <= 0.009) continue;
        const alloc = round2(Math.min(remainingToAllocate, eff));
        if (alloc > 0.009) {
          await emitPaymentAndFtForInvoice(invRow, alloc);
          remainingToAllocate = round2(Math.max(0, remainingToAllocate - alloc));
        }
      }

      const manualAmount = round2(openingAllocated + remainingToAllocate);
      let finalTxId = baseTxId;
      let finalTxNum = baseTxNumber;
      if (manualAmount > 0.009 || allocatedInvoices.length === 0) {
        const amountToRecord = manualAmount > 0.009 ? manualAmount : payAmount;
        runningCb = round2(runningCb + amountToRecord);
        const curTxId = txCounter === 0 ? baseTxId : generateServerId('FIN');
        const curTxNum = txCounter === 0 ? baseTxNumber : `${baseTxNumber}-${txCounter + 1}`;
        finalTxId = curTxId;
        finalTxNum = curTxNum;
        const isAdv = nextCustBalance < 0;
        const desc = `تحصيل (${methodLabel}) من العميل: ${cust.name}${isAdv ? ' (رصيد دائن / مقدم)' : ''}`;
        await client.query(
          `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_type, related_entity_id, related_entity_name, related_doc_type, description, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1, $2, $3, 'customer_payment', $4, $5, $6, $7, $8, 'customer', $9, $10, 'manual', $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            curTxId,
            curTxNum,
            txDate,
            amountToRecord,
            cb.id,
            cb.name,
            runningCb,
            `تحصيل من عميل (${methodLabel})`,
            cust.id,
            cust.name,
            desc,
            notes || '',
            actor.id,
            actor.fullName,
            actorCtx.actorIdentityId || null,
            actorCtx.actorEmployeeId || null,
            actorCtx.actingRole || actor.role || null,
            now,
          ]
        );
      }

      const updatedCust = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      const mappedCust = mapPgCustomerRow(updatedCust.rows[0]);
      const payloadOut = {
        customer: mappedCust,
        cashboxBalance: nextCbBalance,
        paymentMethod: cleanMethod,
        collectionLocation,
        transactionId: finalTxId,
        transactionNumber: finalTxNum,
        allocatedInvoices,
        unallocatedAmount: manualAmount,
        isAdvanceCredit: mappedCust.currentBalance < 0,
        creditAmount: mappedCust.currentBalance < 0 ? round2(Math.abs(mappedCust.currentBalance)) : 0,
      };
      await savePgIdempotency(client, scopedIdem, actor, endpoint, payloadOut);
      return { deduplicated: false, ...payloadOut };
    });

    if (!res.deduplicated) {
      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `تحصيل مبلغ ${payAmount} (${methodLabel}) من العميل ${res.customer.name}${res.allocatedInvoices?.length ? ` (ربط بـ ${res.allocatedInvoices.length} فاتورة)` : ''}`,
        module: 'العملاء',
        recordId: customerId,
      });
    }
    if (!canViewCashboxBalances(actor)) {
      const sanitized = { ...res };
      delete sanitized.cashboxBalance;
      return sanitized;
    }
    return res;
  }

  const res = await withJsonTransaction(async (db) => {
    const dup = findJsonIdempotency(scopedIdem);
    if (dup) return { deduplicated: true, ...dup };

    const cust = db.customers.find((c) => c.id === customerId);
    if (!cust) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    const requestedCashboxId = actor?.role === 'representative' ? undefined : cashboxId;
    const cb = requestedCashboxId
      ? db.cashboxes.find((c) => c.id === requestedCashboxId)
      : db.cashboxes.find((c) => c.isDefault) || db.cashboxes[0];
    if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');

    const prevCbBalance = round2(Number(cb.currentBalance || 0));
    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    const repProfile =
      actor?.role === 'representative'
        ? (db.representatives || []).find((r) => r.userId === actor.id) || null
        : null;

    const allOpenInvoices = (db.invoices || [])
      .filter((i) => i.customerId === customerId && i.type === 'sales' && i.status === 'confirmed' && Number(i.remainingAmount || 0) > 0.01)
      .sort((a, b) => {
        const cmpDate = String(a.date || '').localeCompare(String(b.date || ''));
        return cmpDate !== 0 ? cmpDate : String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });

    const openInvoices = allOpenInvoices.filter((inv) => {
      if (actor?.role !== 'representative') return true;
      return isRepOwnerOfInvoice(inv, actor, repProfile);
    });

    if (requestedInvoiceId) {
      const checkTarget = (db.invoices || []).find((i) => i.id === requestedInvoiceId);
      if (checkTarget && checkTarget.customerId !== customerId) {
        throw new AppError(404, 'الفاتورة المحددة غير موجودة لهذا العميل', 'INVOICE_NOT_FOUND');
      }
      if (!checkTarget) {
        throw new AppError(404, 'الفاتورة المحددة غير موجودة لهذا العميل', 'INVOICE_NOT_FOUND');
      }
      if (actor?.role === 'representative' && !openInvoices.some((o) => o.id === requestedInvoiceId)) {
        throw new AppError(403, 'غير مصرح للمندوب بالتحصيل على فاتورة لا تخصه', 'FORBIDDEN_REP_INVOICE_ACCESS');
      }
    }

    cust.currentBalance = round2(Number(cust.currentBalance || 0) - payAmount);
    cb.currentBalance = round2(prevCbBalance + payAmount);

    const retByInv = new Map();
    for (const r of db.invoiceReturns || []) {
      if (r.partyId === customerId && r.type === 'sales_return' && r.refundType === 'balance' && r.originalInvoiceId) {
        retByInv.set(r.originalInvoiceId, round2((retByInv.get(r.originalInvoiceId) || 0) + Number(r.grandTotal || 0)));
      }
    }
    const getEffectiveRem = (inv) => Math.max(0, round2(Number(inv.remainingAmount || 0) - (retByInv.get(inv.id) || 0)));

    let remainingToAllocate = payAmount;
    let openingAllocated = 0;
    const allocatedInvoices = [];
    let runningCb = prevCbBalance;
    let txCounter = 0;

    const emitPaymentAndFtForInvoiceJson = (inv, allocAmt) => {
      const newPaid = round2(Number(inv.paidAmount || 0) + allocAmt);
      const newRem = round2(Math.max(0, Number(inv.grandTotal || 0) - newPaid));
      const payId = generateServerId('PAY');

      inv.paidAmount = newPaid;
      inv.remainingAmount = newRem;
      inv.paymentType = newRem <= 0.01 ? 'cash' : 'partial';
      inv.updatedAt = now;
      inv.payments = [
        ...(inv.payments || []),
        {
          id: payId,
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          amount: allocAmt,
          date: txDate,
          paymentMethod: cleanMethod,
          cashboxId: cb.id,
          cashboxName: cb.name,
          notes: notes || (collectionLocation === 'branch' ? 'تحصيل من الفرع على الفاتورة' : 'تحصيل المندوب على الفاتورة'),
          collectionLocation,
          createdBy: actor.fullName,
          createdByUserId: actor.id,
          actorIdentityId: actorCtxJson.actorIdentityId,
          actorEmployeeId: actorCtxJson.actorEmployeeId,
          actingRole: actorCtxJson.actingRole,
          createdAt: now,
        },
      ];

      runningCb = round2(runningCb + allocAmt);
      const curTxId = txCounter === 0 ? baseTxId : generateServerId('FIN');
      const curTxNum = txCounter === 0 ? baseTxNumber : `${baseTxNumber}-${txCounter + 1}`;
      txCounter++;

      db.financialTransactions.unshift({
        id: curTxId,
        transactionNumber: curTxNum,
        date: txDate,
        type: 'customer_payment',
        cashboxId: cb.id,
        cashboxName: cb.name,
        balanceAfter: runningCb,
        amount: allocAmt,
        paymentMethod: cleanMethod,
        category: `تحصيل من عميل (${methodLabel})`,
        relatedDocType: 'sales',
        relatedDocId: inv.id,
        relatedDocNumber: inv.invoiceNumber,
        relatedEntityId: cust.id,
        partyId: cust.id,
        partyName: cust.name,
        description: `تحصيل (${methodLabel}) على الفاتورة ${inv.invoiceNumber} - العميل: ${cust.name}`,
        notes: notes || '',
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });

      allocatedInvoices.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        allocatedAmount: allocAmt,
        paidAmountAfter: newPaid,
        remainingAmountAfter: newRem,
        paymentId: payId,
      });
    };

    if (requestedInvoiceId) {
      const target = openInvoices.find((inv) => inv.id === requestedInvoiceId);
      if (target) {
        const eff = getEffectiveRem(target);
        const alloc = round2(Math.min(remainingToAllocate, eff));
        if (alloc > 0.009) {
          emitPaymentAndFtForInvoiceJson(target, alloc);
          remainingToAllocate = round2(Math.max(0, remainingToAllocate - alloc));
        }
      }
    } else if (Number(cust.openingBalance || 0) > 0.01) {
      const priorManualPaid = round2(
        (db.financialTransactions || [])
          .filter(
            (tx) =>
              (tx.relatedEntityId === customerId || tx.partyId === customerId) &&
              tx.type === 'customer_payment' &&
              !['sales', 'order_advance'].includes(tx.relatedDocType || 'manual')
          )
          .reduce((s, tx) => s + Number(tx.amount || 0), 0)
      );
      const unallocatedOpening = Math.max(0, round2(Number(cust.openingBalance || 0) - priorManualPaid));
      if (unallocatedOpening > 0.009) {
        openingAllocated = round2(Math.min(remainingToAllocate, unallocatedOpening));
        remainingToAllocate = round2(Math.max(0, remainingToAllocate - openingAllocated));
      }
    }

    for (const inv of openInvoices) {
      if (remainingToAllocate <= 0.009) break;
      if (requestedInvoiceId && inv.id === requestedInvoiceId) continue;
      const eff = getEffectiveRem(inv);
      if (eff <= 0.009) continue;
      const alloc = round2(Math.min(remainingToAllocate, eff));
      if (alloc > 0.009) {
        emitPaymentAndFtForInvoiceJson(inv, alloc);
        remainingToAllocate = round2(Math.max(0, remainingToAllocate - alloc));
      }
    }

    const manualAmount = round2(openingAllocated + remainingToAllocate);
    let finalTxId = baseTxId;
    let finalTxNum = baseTxNumber;
    if (manualAmount > 0.009 || allocatedInvoices.length === 0) {
      const amountToRecord = manualAmount > 0.009 ? manualAmount : payAmount;
      runningCb = round2(runningCb + amountToRecord);
      const curTxId = txCounter === 0 ? baseTxId : generateServerId('FIN');
      const curTxNum = txCounter === 0 ? baseTxNumber : `${baseTxNumber}-${txCounter + 1}`;
      finalTxId = curTxId;
      finalTxNum = curTxNum;
      const isAdv = Number(cust.currentBalance || 0) < 0;
      const desc = `تحصيل (${methodLabel}) من العميل: ${cust.name}${isAdv ? ' (رصيد دائن / مقدم)' : ''}`;
      db.financialTransactions.unshift({
        id: curTxId,
        transactionNumber: curTxNum,
        date: txDate,
        type: 'customer_payment',
        cashboxId: cb.id,
        cashboxName: cb.name,
        balanceAfter: runningCb,
        amount: amountToRecord,
        paymentMethod: cleanMethod,
        category: `تحصيل من عميل (${methodLabel})`,
        relatedDocType: 'manual',
        relatedEntityId: cust.id,
        partyId: cust.id,
        partyName: cust.name,
        description: desc,
        notes: notes || '',
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });
    }

    const payloadOut = {
      customer: cust,
      cashboxBalance: cb.currentBalance,
      paymentMethod: cleanMethod,
      collectionLocation,
      transactionId: finalTxId,
      transactionNumber: finalTxNum,
      allocatedInvoices,
      unallocatedAmount: manualAmount,
      isAdvanceCredit: Number(cust.currentBalance || 0) < 0,
      creditAmount: Number(cust.currentBalance || 0) < 0 ? round2(Math.abs(Number(cust.currentBalance || 0))) : 0,
    };
    saveJsonIdempotency(scopedIdem, payloadOut);
    return { deduplicated: false, ...payloadOut };
  });

  if (!res.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحصيل مبلغ ${payAmount} (${methodLabel}) من العميل ${res.customer.name}${res.allocatedInvoices?.length ? ` (ربط بـ ${res.allocatedInvoices.length} فاتورة)` : ''}`,
      module: 'العملاء',
      recordId: customerId,
    });
  }
  if (!canViewCashboxBalances(actor)) {
    const sanitized = { ...res };
    delete sanitized.cashboxBalance;
    return sanitized;
  }
  return res;
}

export async function toggleCustomerLinkedUserStatus(customerId, isActive, actor) {
  const nextActive = Boolean(isActive);
  const now = nowIso();
  let targetUserId = null;
  let customerName = '';

  if (await isPgMode()) {
    const cust = await withTransaction(async (client) => {
      const custRes = await client.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!custRes.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      const cur = mapPgCustomerRow(custRes.rows[0]);
      if (!cur.userId) {
        throw new AppError(400, 'هذا العميل غير مربوط بحساب دخول لتطبيق العملاء', 'CUSTOMER_NO_LINKED_USER');
      }
      targetUserId = cur.userId;
      customerName = cur.name;
      await client.query('UPDATE users SET is_active = $1, updated_at = $2 WHERE id = $3', [nextActive, now, cur.userId]);
      return cur;
    });
    if (!nextActive && targetUserId) {
      await revokeAllUserSessions(targetUserId);
    }
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `${nextActive ? 'تفعيل' : 'إيقاف'} حساب تطبيق العميل (${customerName})`,
      module: 'العملاء',
      recordId: customerId,
    });
    return { customer: cust, userId: targetUserId, isActive: nextActive };
  }

  const cust = await withJsonTransaction(async (db) => {
    const cur = db.customers.find((c) => c.id === customerId);
    if (!cur) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    if (!cur.userId) {
      throw new AppError(400, 'هذا العميل غير مربوط بحساب دخول لتطبيق العملاء', 'CUSTOMER_NO_LINKED_USER');
    }
    const u = db.users.find((x) => x.id === cur.userId);
    if (!u) throw new AppError(404, 'حساب المستخدم المرتبط غير موجود', 'USER_NOT_FOUND');
    u.isActive = nextActive;
    targetUserId = cur.userId;
    customerName = cur.name;
    return cur;
  });
  if (!nextActive && targetUserId) {
    await revokeAllUserSessions(targetUserId);
  }
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `${nextActive ? 'تفعيل' : 'إيقاف'} حساب تطبيق العميل (${customerName})`,
    module: 'العملاء',
    recordId: customerId,
  });
  return { customer: cust, userId: targetUserId, isActive: nextActive };
}

export async function detectCustomerUserConflicts() {
  const customers = await listCustomers();
  let customerUsers = [];
  if (await isPgMode()) {
    const pool = getPool();
    const uRes = await pool.query(`SELECT * FROM users WHERE role = 'customer'`);
    customerUsers = uRes.rows.map((r) => sanitizeUser(mapPgUserRow(r)));
  } else {
    const db = readJsonDatabase();
    customerUsers = db.users.filter((u) => u.role === 'customer').map(sanitizeUser);
  }

  const linkedUserIds = new Set(customers.filter((c) => c.userId).map((c) => c.userId));
  const unlinkedUsers = customerUsers.filter((u) => !linkedUserIds.has(u.id));
  const unlinkedCustomers = customers.filter((c) => !c.userId);

  const phoneCounts = new Map();
  for (const c of customers) {
    const seenOnRow = new Set();
    const candidates = [c.phone, c.secondaryPhone, ...((c.phones || []).map((p) => (typeof p === 'string' ? p : p?.number)))];
    for (const candidate of candidates) {
      const norm = normalizePhoneDigits(candidate);
      if (norm && !seenOnRow.has(norm)) {
        seenOnRow.add(norm);
        phoneCounts.set(norm, (phoneCounts.get(norm) || 0) + 1);
      }
    }
  }
  const duplicatePhones = [...phoneCounts.entries()].filter(([, cnt]) => cnt > 1).map(([phone, count]) => ({ phone, count }));

  return {
    unlinkedUsers,
    unlinkedCustomerUsers: unlinkedUsers,
    unlinkedCustomers,
    duplicatePhones,
  };
}

export async function repairUnlinkedCustomerUsers(actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const repairRes = await withTransaction(async (client) => {
      const unlinkedRes = await client.query(
        `SELECT u.* FROM users u
         LEFT JOIN customers c ON c.user_id = u.id
         WHERE u.role = 'customer' AND c.id IS NULL`
      );
      const unlinkedCustsRes = await client.query(`SELECT * FROM customers WHERE user_id IS NULL`);
      const unlinkedCustomers = unlinkedCustsRes.rows.map(mapPgCustomerRow);
      const createdOrLinked = [];
      const ambiguousConflicts = [];

      for (let idx = 0; idx < unlinkedRes.rows.length; idx++) {
        const u = unlinkedRes.rows[idx];
        const normUserPhone = normalizePhoneDigits(u.phone);
        const matches = normUserPhone
          ? unlinkedCustomers.filter(
              (c) =>
                !c.userId &&
                (normalizePhoneDigits(c.phone) === normUserPhone ||
                  normalizePhoneDigits(c.secondaryPhone) === normUserPhone)
            )
          : [];

        if (matches.length === 1) {
          const target = matches[0];
          await client.query(`UPDATE customers SET user_id = $1, updated_at = $2 WHERE id = $3`, [u.id, now, target.id]);
          target.userId = u.id;
          createdOrLinked.push({ userId: u.id, username: u.username, customerId: target.id, code: target.code, action: 'linked_existing' });
        } else if (matches.length > 1) {
          ambiguousConflicts.push({
            userId: u.id,
            username: u.username,
            phone: u.phone || '',
            candidateCustomerIds: matches.map((m) => m.id),
            reason: 'رقم الهاتف مطابق لأكثر من ملف عميل في الدليل - يتطلب تحديداً يدوياً',
          });
        } else {
          const custId = generateServerId('CUS');
          const code = `CUS-${String(Date.now()).slice(-5)}-${idx + 1}`;
          await client.query(
            `INSERT INTO customers (id, code, user_id, name, phone, normalized_phone, address, shop_address, opening_balance, current_balance, notes, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$7,0,0,$8,$9,$10,$10)`,
            [
              custId,
              code,
              u.id,
              u.full_name || u.username,
              u.phone || '',
              normalizePhoneDigitsShared(u.phone || ''),
              u.address || '',
              'ملف عميل مُنشأ تلقائيًا عبر أداة إصلاح الربط',
              u.is_active === false ? 'blocked' : 'active',
              now,
            ]
          );
          createdOrLinked.push({ userId: u.id, username: u.username, customerId: custId, code, action: 'created_and_linked' });
        }
      }
      return { repairedCount: createdOrLinked.length, repaired: createdOrLinked, ambiguousConflicts };
    });

    if (repairRes.repairedCount > 0) {
      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `إصلاح وربط ${repairRes.repairedCount} حساب عميل بملف في الدليل الموحد`,
        module: 'العملاء',
      });
    }
    return repairRes;
  }

  const repairRes = await withJsonTransaction(async (db) => {
    const linkedIds = new Set((db.customers || []).filter((c) => c.userId).map((c) => c.userId));
    const unlinked = (db.users || []).filter((u) => u.role === 'customer' && !linkedIds.has(u.id));
    const createdOrLinked = [];
    const ambiguousConflicts = [];

    for (let idx = 0; idx < unlinked.length; idx++) {
      const u = unlinked[idx];
      const normUserPhone = normalizePhoneDigits(u.phone);
      const matches = normUserPhone
        ? (db.customers || []).filter(
            (c) =>
              !c.userId &&
              (normalizePhoneDigits(c.phone) === normUserPhone ||
                normalizePhoneDigits(c.secondaryPhone) === normUserPhone)
          )
        : [];

      if (matches.length === 1) {
        const target = matches[0];
        target.userId = u.id;
        target.updatedAt = now;
        createdOrLinked.push({ userId: u.id, username: u.username, customerId: target.id, code: target.code, action: 'linked_existing' });
      } else if (matches.length > 1) {
        ambiguousConflicts.push({
          userId: u.id,
          username: u.username,
          phone: u.phone || '',
          candidateCustomerIds: matches.map((m) => m.id),
          reason: 'رقم الهاتف مطابق لأكثر من ملف عميل في الدليل - يتطلب تحديداً يدوياً',
        });
      } else {
        const custId = generateServerId('CUS');
        const code = `CUS-${String(Date.now()).slice(-5)}-${idx + 1}`;
        const newCust = {
          id: custId,
          code,
          userId: u.id,
          name: u.fullName || u.username,
          phone: u.phone || '',
          address: u.address || '',
          openingBalance: 0,
          currentBalance: 0,
          priceHistory: {},
          notes: 'ملف عميل مُنشأ تلقائيًا عبر أداة إصلاح الربط',
          status: u.isActive === false ? 'blocked' : 'active',
          createdAt: now,
        };
        db.customers.unshift(newCust);
        createdOrLinked.push({ userId: u.id, username: u.username, customerId: custId, code, action: 'created_and_linked' });
      }
    }
    return { repairedCount: createdOrLinked.length, repaired: createdOrLinked, ambiguousConflicts };
  });

  if (repairRes.repairedCount > 0) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إصلاح وربط ${repairRes.repairedCount} حساب عميل بملف في الدليل الموحد`,
      module: 'العملاء',
    });
  }
  return repairRes;
}

// ==============================================================================
// Products & Categories
// ==============================================================================

export function normalizeArabicProductText(value) {
  return String(value || '')
    .trim()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export async function listProductGroups() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM product_groups ORDER BY created_at ASC');
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      status: r.status || 'active',
      createdAt: isoTimestamp(r.created_at),
      updatedAt: r.updated_at ? isoTimestamp(r.updated_at) : isoTimestamp(r.created_at),
    }));
  }
  return [...(readJsonDatabase().productGroups || [])];
}

export async function createProductGroup(payload, actor) {
  const name = String(payload?.name || '').trim();
  if (!name) throw new AppError(400, 'اسم المجموعة مطلوب', 'INVALID_GROUP');
  const norm = normalizeArabicProductText(name);
  const id = payload?.id || generateServerId('GRP');
  const description = String(payload?.description || '').trim();
  const status = payload?.status === 'suspended' ? 'suspended' : 'active';
  const now = nowIso();

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      const dup = await client.query(
        'SELECT id FROM product_groups WHERE normalized_name = $1 OR LOWER(name) = LOWER($2) LIMIT 1',
        [norm, name]
      );
      if (dup.rows[0]) throw new AppError(409, 'اسم المجموعة مسجل مسبقًا', 'DUPLICATE_GROUP');
      await client.query(
        `INSERT INTO product_groups (id, name, normalized_name, description, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [id, name, norm, description, status, now]
      );
      return { id, name, description, status, createdAt: now, updatedAt: now };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة مجموعة أصناف (${name})`, module: 'المجموعات', recordId: id });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    if (!Array.isArray(db.productGroups)) db.productGroups = [];
    if (db.productGroups.some((g) => normalizeArabicProductText(g.name) === norm)) {
      throw new AppError(409, 'اسم المجموعة مسجل مسبقًا', 'DUPLICATE_GROUP');
    }
    const group = { id, name, description, status, createdAt: now, updatedAt: now };
    db.productGroups.push(group);
    return group;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة مجموعة أصناف (${name})`, module: 'المجموعات', recordId: id });
  return created;
}

export async function updateProductGroup(groupId, updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const curRes = await client.query('SELECT * FROM product_groups WHERE id = $1 FOR UPDATE', [groupId]);
      const cur = curRes.rows[0];
      if (!cur) throw new AppError(404, 'المجموعة غير موجودة', 'GROUP_NOT_FOUND');

      const nextName = String(updates?.name ?? cur.name).trim();
      if (!nextName) throw new AppError(400, 'اسم المجموعة مطلوب', 'INVALID_GROUP');
      const nextNorm = normalizeArabicProductText(nextName);
      const dup = await client.query(
        'SELECT id FROM product_groups WHERE (normalized_name = $1 OR LOWER(name) = LOWER($2)) AND id <> $3 LIMIT 1',
        [nextNorm, nextName, groupId]
      );
      if (dup.rows[0]) throw new AppError(409, 'اسم المجموعة مسجل مسبقًا', 'DUPLICATE_GROUP');

      const nextDescription = updates?.description !== undefined ? String(updates.description || '').trim() : (cur.description || '');
      const nextStatus = updates?.status === 'suspended' || updates?.status === 'active' ? updates.status : (cur.status || 'active');

      await client.query(
        `UPDATE product_groups SET name = $1, normalized_name = $2, description = $3, status = $4, updated_at = $5 WHERE id = $6`,
        [nextName, nextNorm, nextDescription, nextStatus, now, groupId]
      );
      // Cascade group rename to current categories & products ONLY (never rewrite historical invoice/return snapshots)
      if (nextName !== cur.name) {
        await client.query('UPDATE product_categories SET group_name = $1 WHERE group_id = $2', [nextName, groupId]);
        await client.query('UPDATE products SET group_name = $1 WHERE group_id = $2', [nextName, groupId]);
      }

      return {
        id: groupId,
        name: nextName,
        description: nextDescription,
        status: nextStatus,
        createdAt: isoTimestamp(cur.created_at),
        updatedAt: now,
      };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث مجموعة أصناف (${updated.name})`, module: 'المجموعات', recordId: groupId });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    if (!Array.isArray(db.productGroups)) db.productGroups = [];
    const idx = db.productGroups.findIndex((g) => g.id === groupId);
    if (idx === -1) throw new AppError(404, 'المجموعة غير موجودة', 'GROUP_NOT_FOUND');
    const cur = db.productGroups[idx];
    const nextName = String(updates?.name ?? cur.name).trim();
    if (!nextName) throw new AppError(400, 'اسم المجموعة مطلوب', 'INVALID_GROUP');
    const nextNorm = normalizeArabicProductText(nextName);
    if (db.productGroups.some((g) => g.id !== groupId && normalizeArabicProductText(g.name) === nextNorm)) {
      throw new AppError(409, 'اسم المجموعة مسجل مسبقًا', 'DUPLICATE_GROUP');
    }
    const nextDescription = updates?.description !== undefined ? String(updates.description || '').trim() : (cur.description || '');
    const nextStatus = updates?.status === 'suspended' || updates?.status === 'active' ? updates.status : (cur.status || 'active');
    const oldName = cur.name;
    db.productGroups[idx] = {
      ...cur,
      name: nextName,
      description: nextDescription,
      status: nextStatus,
      updatedAt: now,
    };
    if (nextName !== oldName) {
      db.categories = (db.categories || []).map((c) => (c.groupId === groupId ? { ...c, groupName: nextName } : c));
      db.products = (db.products || []).map((p) => (p.groupId === groupId ? { ...p, groupName: nextName } : p));
    }
    return db.productGroups[idx];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث مجموعة أصناف (${updated.name})`, module: 'المجموعات', recordId: groupId });
  return updated;
}

export async function deleteProductGroup(groupId, actor) {
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const curRes = await client.query('SELECT * FROM product_groups WHERE id = $1 FOR UPDATE', [groupId]);
      if (!curRes.rows[0]) throw new AppError(404, 'المجموعة غير موجودة', 'GROUP_NOT_FOUND');
      const [usedCats, usedProds] = await Promise.all([
        client.query('SELECT id FROM product_categories WHERE group_id = $1 LIMIT 1', [groupId]),
        client.query('SELECT id FROM products WHERE group_id = $1 LIMIT 1', [groupId]),
      ]);
      if (usedCats.rows[0] || usedProds.rows[0]) {
        throw new AppError(409, 'لا يمكن حذف مجموعة مرتبطة بتصنيفات أو أصناف حالية. يمكنك إيقافها مؤقتًا بدلاً من الحذف.', 'GROUP_IN_USE');
      }
      await client.query('DELETE FROM product_groups WHERE id = $1', [groupId]);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'حذف مجموعة أصناف', module: 'المجموعات', recordId: groupId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    if (!Array.isArray(db.productGroups)) db.productGroups = [];
    const cur = db.productGroups.find((g) => g.id === groupId);
    if (!cur) throw new AppError(404, 'المجموعة غير موجودة', 'GROUP_NOT_FOUND');
    const usedInCats = (db.categories || []).some((c) => c.groupId === groupId);
    const usedInProds = (db.products || []).some((p) => p.groupId === groupId);
    if (usedInCats || usedInProds) {
      throw new AppError(409, 'لا يمكن حذف مجموعة مرتبطة بتصنيفات أو أصناف حالية. يمكنك إيقافها مؤقتًا بدلاً من الحذف.', 'GROUP_IN_USE');
    }
    db.productGroups = db.productGroups.filter((g) => g.id !== groupId);
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'حذف مجموعة أصناف', module: 'المجموعات', recordId: groupId });
  return { ok: true };
}

export async function listCategories() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM product_categories ORDER BY created_at ASC');
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      groupId: r.group_id || undefined,
      groupName: r.group_name || '',
      description: r.description || '',
      status: r.status || 'active',
      createdAt: isoTimestamp(r.created_at),
    }));
  }
  return readJsonDatabase().categories;
}

export async function createCategory(payload, actor) {
  const name = String(payload?.name || '').trim();
  if (!name) throw new AppError(400, 'اسم التصنيف مطلوب', 'INVALID_CATEGORY');
  const norm = normalizeArabicProductText(name);
  const rawGroupId = String(payload?.groupId || '').trim();
  const id = payload?.id || generateServerId('CAT');
  const description = String(payload?.description || '').trim();
  const status = payload?.status === 'suspended' ? 'suspended' : 'active';
  const now = nowIso();

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      let resolvedGroupName = '';
      if (rawGroupId) {
        const gRes = await client.query('SELECT id, name FROM product_groups WHERE id = $1 LIMIT 1', [rawGroupId]);
        if (!gRes.rows[0]) throw new AppError(404, 'المجموعة المحددة غير موجودة', 'GROUP_NOT_FOUND');
        resolvedGroupName = gRes.rows[0].name;
      }
      const dup = await client.query(
        'SELECT id FROM product_categories WHERE group_id = $1 AND (normalized_name = $2 OR LOWER(name) = LOWER($3)) LIMIT 1',
        [rawGroupId, norm, name]
      );
      if (dup.rows[0]) {
        throw new AppError(
          409,
          rawGroupId ? 'اسم التصنيف مسجل مسبقًا داخل هذه المجموعة' : 'اسم التصنيف مسجل مسبقًا',
          'DUPLICATE_CATEGORY'
        );
      }
      await client.query(
        `INSERT INTO product_categories (id, name, normalized_name, group_id, group_name, description, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, name, norm, rawGroupId, resolvedGroupName, description, status, now]
      );
      return {
        id,
        name,
        ...(rawGroupId ? { groupId: rawGroupId } : {}),
        groupName: resolvedGroupName,
        description,
        status,
        createdAt: now,
      };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة تصنيف (${name})`, module: 'التصنيفات', recordId: id });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    let resolvedGroupName = '';
    if (rawGroupId) {
      const grp = (db.productGroups || []).find((g) => g.id === rawGroupId);
      if (!grp) throw new AppError(404, 'المجموعة المحددة غير موجودة', 'GROUP_NOT_FOUND');
      resolvedGroupName = grp.name;
    }
    if (
      db.categories.some(
        (c) => String(c.groupId || '') === rawGroupId && normalizeArabicProductText(c.name) === norm
      )
    ) {
      throw new AppError(
        409,
        rawGroupId ? 'اسم التصنيف مسجل مسبقًا داخل هذه المجموعة' : 'اسم التصنيف مسجل مسبقًا',
        'DUPLICATE_CATEGORY'
      );
    }
    const cat = {
      id,
      name,
      ...(rawGroupId ? { groupId: rawGroupId } : {}),
      groupName: resolvedGroupName,
      description,
      status,
      createdAt: now,
    };
    db.categories.push(cat);
    return cat;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة تصنيف (${name})`, module: 'التصنيفات', recordId: id });
  return created;
}

export async function updateCategory(categoryId, updates, actor) {
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const curRes = await client.query('SELECT * FROM product_categories WHERE id = $1 FOR UPDATE', [categoryId]);
      if (!curRes.rows[0]) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
      const cur = curRes.rows[0];
      const nextName = String(updates?.name ?? cur.name).trim();
      if (!nextName) throw new AppError(400, 'اسم التصنيف مطلوب', 'INVALID_CATEGORY');
      const nextNorm = normalizeArabicProductText(nextName);
      const nextGroupId =
        updates?.groupId !== undefined ? String(updates.groupId || '').trim() : String(cur.group_id || '').trim();
      let nextGroupName = '';
      if (nextGroupId) {
        const gRes = await client.query('SELECT id, name FROM product_groups WHERE id = $1 LIMIT 1', [nextGroupId]);
        if (!gRes.rows[0]) throw new AppError(404, 'المجموعة المحددة غير موجودة', 'GROUP_NOT_FOUND');
        nextGroupName = gRes.rows[0].name;
      }

      const dup = await client.query(
        'SELECT id FROM product_categories WHERE group_id = $1 AND (normalized_name = $2 OR LOWER(name) = LOWER($3)) AND id <> $4 LIMIT 1',
        [nextGroupId, nextNorm, nextName, categoryId]
      );
      if (dup.rows[0]) {
        throw new AppError(
          409,
          nextGroupId ? 'اسم التصنيف مسجل مسبقًا داخل هذه المجموعة' : 'اسم التصنيف مسجل مسبقًا',
          'DUPLICATE_CATEGORY'
        );
      }

      const nextDescription = updates?.description !== undefined ? String(updates.description || '').trim() : (cur.description ?? '');
      const nextStatus = updates?.status === 'suspended' || updates?.status === 'active' ? updates.status : cur.status;

      await client.query(
        'UPDATE product_categories SET name = $1, normalized_name = $2, group_id = $3, group_name = $4, description = $5, status = $6 WHERE id = $7',
        [nextName, nextNorm, nextGroupId, nextGroupName, nextDescription, nextStatus, categoryId]
      );

      // Update current products linked to this category (never modify historical invoice/return rows)
      if (nextName !== cur.name || nextGroupId !== String(cur.group_id || '')) {
        await client.query(
          'UPDATE products SET category = $1, group_id = $2, group_name = $3 WHERE category_id = $4 OR (category = $5 AND COALESCE(group_id, \'\') = $6)',
          [nextName, nextGroupId || null, nextGroupName, categoryId, cur.name, String(cur.group_id || '')]
        );
      }
      return {
        id: categoryId,
        name: nextName,
        ...(nextGroupId ? { groupId: nextGroupId } : {}),
        groupName: nextGroupName,
        description: nextDescription,
        status: nextStatus,
        createdAt: isoTimestamp(cur.created_at),
      };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث تصنيف (${updated.name})`, module: 'التصنيفات', recordId: categoryId });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    const idx = db.categories.findIndex((c) => c.id === categoryId);
    if (idx === -1) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
    const cur = db.categories[idx];
    const nextName = String(updates?.name ?? cur.name).trim();
    if (!nextName) throw new AppError(400, 'اسم التصنيف مطلوب', 'INVALID_CATEGORY');
    const nextNorm = normalizeArabicProductText(nextName);
    const nextGroupId =
      updates?.groupId !== undefined ? String(updates.groupId || '').trim() : String(cur.groupId || '').trim();
    let nextGroupName = '';
    if (nextGroupId) {
      const grp = (db.productGroups || []).find((g) => g.id === nextGroupId);
      if (!grp) throw new AppError(404, 'المجموعة المحددة غير موجودة', 'GROUP_NOT_FOUND');
      nextGroupName = grp.name;
    }

    if (
      db.categories.some(
        (c) => c.id !== categoryId && String(c.groupId || '') === nextGroupId && normalizeArabicProductText(c.name) === nextNorm
      )
    ) {
      throw new AppError(
        409,
        nextGroupId ? 'اسم التصنيف مسجل مسبقًا داخل هذه المجموعة' : 'اسم التصنيف مسجل مسبقًا',
        'DUPLICATE_CATEGORY'
      );
    }

    const oldName = cur.name;
    const oldGroupId = String(cur.groupId || '');
    const nextObj = {
      ...cur,
      ...updates,
      name: nextName,
      groupName: nextGroupName,
    };
    if (nextGroupId) nextObj.groupId = nextGroupId;
    else delete nextObj.groupId;
    db.categories[idx] = nextObj;

    if (nextName !== oldName || nextGroupId !== oldGroupId) {
      db.products = db.products.map((p) => {
        const linked = p.categoryId === categoryId || (p.category === oldName && String(p.groupId || '') === oldGroupId);
        if (!linked) return p;
        return {
          ...p,
          category: nextName,
          groupId: nextGroupId || undefined,
          groupName: nextGroupName,
        };
      });
    }
    return db.categories[idx];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث تصنيف (${updated.name})`, module: 'التصنيفات', recordId: categoryId });
  return updated;
}

export async function deleteCategory(categoryId, actor) {
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const curRes = await client.query('SELECT * FROM product_categories WHERE id = $1 FOR UPDATE', [categoryId]);
      if (!curRes.rows[0]) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
      const cur = curRes.rows[0];
      const used = await client.query(
        'SELECT id FROM products WHERE category_id = $1 OR (category = $2 AND COALESCE(group_id, \'\') = $3) LIMIT 1',
        [categoryId, cur.name, String(cur.group_id || '')]
      );
      if (used.rows[0]) throw new AppError(409, 'لا يمكن حذف تصنيف مرتبط بمنتجات حالية', 'CATEGORY_IN_USE');
      await client.query('DELETE FROM product_categories WHERE id = $1', [categoryId]);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف تصنيف`, module: 'التصنيفات', recordId: categoryId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const cat = db.categories.find((c) => c.id === categoryId);
    if (!cat) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
    const inUse = db.products.some(
      (p) => p.categoryId === categoryId || (p.category === cat.name && String(p.groupId || '') === String(cat.groupId || ''))
    );
    if (inUse) {
      throw new AppError(409, 'لا يمكن حذف تصنيف مرتبط بمنتجات حالية', 'CATEGORY_IN_USE');
    }
    db.categories = db.categories.filter((c) => c.id !== categoryId);
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف تصنيف`, module: 'التصنيفات', recordId: categoryId });
  return { ok: true };
}

export async function listProductUnits() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM product_units_catalog ORDER BY created_at ASC');
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      shortCode: r.short_code || '',
      notes: r.notes || '',
      status: r.status || 'active',
      createdAt: isoTimestamp(r.created_at),
      updatedAt: r.updated_at ? isoTimestamp(r.updated_at) : isoTimestamp(r.created_at),
    }));
  }
  return [...(readJsonDatabase().productUnits || [])];
}

export async function createProductUnit(payload, actor) {
  const name = String(payload?.name || '').trim();
  if (!name) throw new AppError(400, 'اسم الوحدة مطلوب', 'INVALID_UNIT');
  const norm = normalizeArabicProductText(name);
  const id = payload?.id || generateServerId('UNT');
  const shortCode = String(payload?.shortCode || '').trim();
  const notes = String(payload?.notes ?? payload?.description ?? '').trim();
  const status = payload?.status === 'suspended' ? 'suspended' : 'active';
  const now = nowIso();

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      const dup = await client.query(
        'SELECT id FROM product_units_catalog WHERE normalized_name = $1 OR LOWER(name) = LOWER($2) LIMIT 1',
        [norm, name]
      );
      if (dup.rows[0]) throw new AppError(409, 'اسم الوحدة مسجل مسبقًا', 'DUPLICATE_UNIT');
      await client.query(
        `INSERT INTO product_units_catalog (id, name, normalized_name, short_code, notes, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [id, name, norm, shortCode, notes, status, now]
      );
      return { id, name, shortCode, notes, status, createdAt: now, updatedAt: now };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة وحدة صنف (${name})`, module: 'الوحدات', recordId: id });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    if (!Array.isArray(db.productUnits)) db.productUnits = [];
    if (db.productUnits.some((u) => normalizeArabicProductText(u.name) === norm)) {
      throw new AppError(409, 'اسم الوحدة مسجل مسبقًا', 'DUPLICATE_UNIT');
    }
    const unit = { id, name, shortCode, notes, status, createdAt: now, updatedAt: now };
    db.productUnits.push(unit);
    return unit;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة وحدة صنف (${name})`, module: 'الوحدات', recordId: id });
  return created;
}

export async function updateProductUnit(unitId, updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const curRes = await client.query('SELECT * FROM product_units_catalog WHERE id = $1 FOR UPDATE', [unitId]);
      const cur = curRes.rows[0];
      if (!cur) throw new AppError(404, 'الوحدة غير موجودة', 'UNIT_NOT_FOUND');

      const nextName = String(updates?.name ?? cur.name).trim();
      if (!nextName) throw new AppError(400, 'اسم الوحدة مطلوب', 'INVALID_UNIT');
      const nextNorm = normalizeArabicProductText(nextName);
      const dup = await client.query(
        'SELECT id FROM product_units_catalog WHERE (normalized_name = $1 OR LOWER(name) = LOWER($2)) AND id <> $3 LIMIT 1',
        [nextNorm, nextName, unitId]
      );
      if (dup.rows[0]) throw new AppError(409, 'اسم الوحدة مسجل مسبقًا', 'DUPLICATE_UNIT');

      const nextShortCode = updates?.shortCode !== undefined ? String(updates.shortCode || '').trim() : (cur.short_code || '');
      const nextNotes = updates?.notes !== undefined
        ? String(updates.notes || '').trim()
        : updates?.description !== undefined
        ? String(updates.description || '').trim()
        : (cur.notes || '');
      const nextStatus = updates?.status === 'suspended' || updates?.status === 'active' ? updates.status : (cur.status || 'active');

      await client.query(
        `UPDATE product_units_catalog SET name = $1, normalized_name = $2, short_code = $3, notes = $4, status = $5, updated_at = $6 WHERE id = $7`,
        [nextName, nextNorm, nextShortCode, nextNotes, nextStatus, now, unitId]
      );
      // Propagate rename ONLY to current products (historical invoice_items / return_items stay unchanged)
      if (nextName !== cur.name) {
        const oldNorm = normalizeArabicProductText(cur.name);
        await client.query(
          `UPDATE products SET base_unit = $1, unit_id = $2 WHERE unit_id = $2`,
          [nextName, unitId]
        );
        const legacyRows = await client.query(
          `SELECT id, base_unit FROM products WHERE unit_id IS NULL OR unit_id = ''`
        );
        for (const r of legacyRows.rows) {
          if (normalizeArabicProductText(r.base_unit) === oldNorm) {
            await client.query(
              `UPDATE products SET base_unit = $1, unit_id = $2 WHERE id = $3`,
              [nextName, unitId, r.id]
            );
          }
        }
      }

      return {
        id: unitId,
        name: nextName,
        shortCode: nextShortCode,
        notes: nextNotes,
        status: nextStatus,
        createdAt: isoTimestamp(cur.created_at),
        updatedAt: now,
      };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث وحدة صنف (${updated.name})`, module: 'الوحدات', recordId: unitId });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    if (!Array.isArray(db.productUnits)) db.productUnits = [];
    const idx = db.productUnits.findIndex((u) => u.id === unitId);
    if (idx === -1) throw new AppError(404, 'الوحدة غير موجودة', 'UNIT_NOT_FOUND');
    const cur = db.productUnits[idx];
    const nextName = String(updates?.name ?? cur.name).trim();
    if (!nextName) throw new AppError(400, 'اسم الوحدة مطلوب', 'INVALID_UNIT');
    const nextNorm = normalizeArabicProductText(nextName);
    if (db.productUnits.some((u) => u.id !== unitId && normalizeArabicProductText(u.name) === nextNorm)) {
      throw new AppError(409, 'اسم الوحدة مسجل مسبقًا', 'DUPLICATE_UNIT');
    }
    const oldNorm = normalizeArabicProductText(cur.name);
    const nextShortCode = updates?.shortCode !== undefined ? String(updates.shortCode || '').trim() : (cur.shortCode || '');
    const nextNotes = updates?.notes !== undefined
      ? String(updates.notes || '').trim()
      : updates?.description !== undefined
      ? String(updates.description || '').trim()
      : (cur.notes || '');
    const nextStatus = updates?.status === 'suspended' || updates?.status === 'active' ? updates.status : (cur.status || 'active');
    const oldName = cur.name;
    db.productUnits[idx] = {
      ...cur,
      name: nextName,
      shortCode: nextShortCode,
      notes: nextNotes,
      status: nextStatus,
      updatedAt: now,
    };
    if (nextName !== oldName) {
      db.products = (db.products || []).map((p) => {
        const linked = p.unitId === unitId || (!p.unitId && normalizeArabicProductText(p.baseUnit) === oldNorm);
        return linked ? { ...p, baseUnit: nextName, unitId } : p;
      });
    }
    return db.productUnits[idx];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث وحدة صنف (${updated.name})`, module: 'الوحدات', recordId: unitId });
  return updated;
}

export async function deleteProductUnit(unitId, actor) {
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const curRes = await client.query('SELECT * FROM product_units_catalog WHERE id = $1 FOR UPDATE', [unitId]);
      const cur = curRes.rows[0];
      if (!cur) throw new AppError(404, 'الوحدة غير موجودة', 'UNIT_NOT_FOUND');
      const usedById = await client.query(
        `SELECT id FROM products WHERE unit_id = $1 LIMIT 1`,
        [unitId]
      );
      let isUsed = Boolean(usedById.rows[0]);
      if (!isUsed) {
        const curNorm = normalizeArabicProductText(cur.name);
        const legacyRows = await client.query(
          `SELECT id, base_unit FROM products WHERE unit_id IS NULL OR unit_id = ''`
        );
        isUsed = legacyRows.rows.some((r) => normalizeArabicProductText(r.base_unit) === curNorm);
      }
      if (isUsed) {
        throw new AppError(409, 'لا يمكن حذف وحدة مرتبطة بأصناف حالية. يمكنك إيقافها مؤقتًا بدلاً من الحذف.', 'UNIT_IN_USE');
      }
      await client.query('DELETE FROM product_units_catalog WHERE id = $1', [unitId]);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'حذف وحدة صنف', module: 'الوحدات', recordId: unitId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    if (!Array.isArray(db.productUnits)) db.productUnits = [];
    const cur = db.productUnits.find((u) => u.id === unitId);
    if (!cur) throw new AppError(404, 'الوحدة غير موجودة', 'UNIT_NOT_FOUND');
    const norm = normalizeArabicProductText(cur.name);
    const usedInProds = (db.products || []).some(
      (p) => p.unitId === unitId || (!p.unitId && normalizeArabicProductText(p.baseUnit) === norm)
    );
    if (usedInProds) {
      throw new AppError(409, 'لا يمكن حذف وحدة مرتبطة بأصناف حالية. يمكنك إيقافها مؤقتًا بدلاً من الحذف.', 'UNIT_IN_USE');
    }
    db.productUnits = db.productUnits.filter((u) => u.id !== unitId);
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'حذف وحدة صنف', module: 'الوحدات', recordId: unitId });
  return { ok: true };
}

export async function resolveProductUnitPgTx(client, payload = {}, cur = null) {
  const hasExplicitUnitId = payload?.unitId !== undefined && String(payload.unitId || '').trim() !== '';
  if (hasExplicitUnitId) {
    const unitId = String(payload.unitId).trim();
    const uRes = await client.query('SELECT id, name FROM product_units_catalog WHERE id = $1 LIMIT 1', [unitId]);
    if (!uRes.rows[0]) throw new AppError(404, 'الوحدة المحددة غير موجودة', 'UNIT_NOT_FOUND');
    return { unitId: uRes.rows[0].id, baseUnit: uRes.rows[0].name };
  }

  if (payload?.baseUnit !== undefined) {
    const typedName = String(payload.baseUnit || '').trim();
    if (!typedName) {
      return cur ? { unitId: cur.unitId || null, baseUnit: cur.baseUnit } : { unitId: null, baseUnit: 'قطعة' };
    }
    const norm = normalizeArabicProductText(typedName);
    const exRes = await client.query(
      'SELECT id, name FROM product_units_catalog WHERE normalized_name = $1 OR LOWER(name) = LOWER($2) LIMIT 1',
      [norm, typedName]
    );
    if (exRes.rows[0]) {
      return { unitId: exRes.rows[0].id, baseUnit: exRes.rows[0].name };
    }
    const newId = generateServerId('UNT');
    const now = nowIso();
    await client.query(
      `INSERT INTO product_units_catalog (id, name, normalized_name, short_code, notes, status, created_at, updated_at)
       VALUES ($1, $2, $3, '', '', 'active', $4, $4)`,
      [newId, typedName, norm, now]
    );
    return { unitId: newId, baseUnit: typedName };
  }

  if (cur) {
    return { unitId: cur.unitId || null, baseUnit: cur.baseUnit || 'قطعة' };
  }
  return { unitId: null, baseUnit: 'قطعة' };
}

export function resolveProductUnitJsonTx(db, payload = {}, cur = null) {
  if (!Array.isArray(db.productUnits)) db.productUnits = [];
  const hasExplicitUnitId = payload?.unitId !== undefined && String(payload.unitId || '').trim() !== '';
  if (hasExplicitUnitId) {
    const unitId = String(payload.unitId).trim();
    const existing = db.productUnits.find((u) => u.id === unitId);
    if (!existing) throw new AppError(404, 'الوحدة المحددة غير موجودة', 'UNIT_NOT_FOUND');
    return { unitId: existing.id, baseUnit: existing.name };
  }

  if (payload?.baseUnit !== undefined) {
    const typedName = String(payload.baseUnit || '').trim();
    if (!typedName) {
      return cur ? { unitId: cur.unitId || undefined, baseUnit: cur.baseUnit } : { unitId: undefined, baseUnit: 'قطعة' };
    }
    const norm = normalizeArabicProductText(typedName);
    const existing = db.productUnits.find((u) => normalizeArabicProductText(u.name) === norm);
    if (existing) {
      return { unitId: existing.id, baseUnit: existing.name };
    }
    const newId = generateServerId('UNT');
    const now = nowIso();
    db.productUnits.push({ id: newId, name: typedName, shortCode: '', notes: '', status: 'active', createdAt: now, updatedAt: now });
    return { unitId: newId, baseUnit: typedName };
  }

  if (cur) {
    return { unitId: cur.unitId || undefined, baseUnit: cur.baseUnit || 'قطعة' };
  }
  return { unitId: undefined, baseUnit: 'قطعة' };
}

export function findProductDuplicateMatchInList(products = [], candidate = {}) {
  const cleanBarcode = String(candidate.barcode || '').trim().toLowerCase();
  const cleanCode = String(candidate.code || '').trim().toLowerCase();
  const normName = normalizeArabicProductText(candidate.name || '');
  const normCat = normalizeArabicProductText(candidate.category || 'عام');
  const normUnit = normalizeArabicProductText(candidate.baseUnit || 'قطعة');

  let exactMatch = null;
  let matchReason = null;

  if (cleanBarcode) {
    const byBarcode = products.find((p) => {
      if (String(p.barcode || '').trim().toLowerCase() === cleanBarcode) return true;
      return Array.isArray(p.units) && p.units.some((u) => String(u.barcode || '').trim().toLowerCase() === cleanBarcode);
    });
    if (byBarcode) {
      exactMatch = byBarcode;
      matchReason = 'barcode';
    }
  }

  if (!exactMatch && cleanCode) {
    const byCode = products.find((p) => String(p.code || '').trim().toLowerCase() === cleanCode);
    if (byCode) {
      exactMatch = byCode;
      matchReason = 'code';
    }
  }

  if (!exactMatch && normName) {
    const byComposite = products.find((p) => {
      const pName = normalizeArabicProductText(p.name || '');
      const pCat = normalizeArabicProductText(p.category || 'عام');
      const pUnit = normalizeArabicProductText(p.baseUnit || 'قطعة');
      return pName === normName && pCat === normCat && pUnit === normUnit;
    });
    if (byComposite) {
      exactMatch = byComposite;
      matchReason = 'name_category_unit';
    }
  }

  const similarMatches = [];
  if (normName && normName.length >= 2) {
    for (const p of products) {
      if (exactMatch && p.id === exactMatch.id) continue;
      const pName = normalizeArabicProductText(p.name || '');
      if (!pName) continue;
      if (pName === normName || (normName.length >= 3 && (pName.includes(normName) || normName.includes(pName)))) {
        similarMatches.push(p);
        if (similarMatches.length >= 5) break;
      }
    }
  }

  return {
    exactMatch,
    matchReason,
    similarMatches,
  };
}

export async function checkProductDuplicate(candidate = {}) {
  const products = await listProducts();
  return findProductDuplicateMatchInList(products, candidate);
}

export async function listProducts({ forCustomer = false, forRepresentative = false, allowCustomerPriceView = true } = {}) {
  let products = [];
  if (await isPgMode()) {
    const pool = getPool();
    const pRes = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    const uRes = await pool.query('SELECT * FROM product_units');
    const unitsByProd = new Map();
    for (const u of uRes.rows) {
      const list = unitsByProd.get(u.product_id) || [];
      list.push(u);
      unitsByProd.set(u.product_id, list);
    }
    products = pRes.rows.map((p) => mapPgProductRow(p, unitsByProd.get(p.id) || []));
  } else {
    products = [...readJsonDatabase().products].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  if (forCustomer) {
    return products.filter((p) => p.status === 'active').map((p) => sanitizeProductForCustomer(p, allowCustomerPriceView));
  }
  if (forRepresentative) {
    return products.map(sanitizeProductForRepresentative);
  }
  return products;
}

async function resolveProductGroupCategoryPgTx(client, payload, cur = null) {
  let groupId = payload.groupId !== undefined ? String(payload.groupId || '').trim() : String(cur?.groupId || '').trim();
  let groupName = '';
  let categoryId = payload.categoryId !== undefined ? String(payload.categoryId || '').trim() : String(cur?.categoryId || '').trim();
  let categoryName = payload.category !== undefined ? String(payload.category || '').trim() : String(cur?.category || '').trim();

  if (categoryId) {
    const cRes = await client.query('SELECT * FROM product_categories WHERE id = $1 LIMIT 1', [categoryId]);
    const cat = cRes.rows[0];
    if (!cat) throw new AppError(404, 'التصنيف المحدد غير موجود', 'CATEGORY_NOT_FOUND');
    const catGroupId = String(cat.group_id || '').trim();
    if (groupId && catGroupId && catGroupId !== groupId) {
      throw new AppError(400, 'التصنيف المحدد لا ينتمي إلى المجموعة المختارة', 'CATEGORY_GROUP_MISMATCH');
    }
    if (!groupId && catGroupId) {
      groupId = catGroupId;
    }
    categoryName = cat.name;
    if (cat.group_name && !groupName) groupName = cat.group_name;
  }

  if (groupId) {
    const gRes = await client.query('SELECT id, name FROM product_groups WHERE id = $1 LIMIT 1', [groupId]);
    if (!gRes.rows[0]) throw new AppError(404, 'المجموعة المحددة غير موجودة', 'GROUP_NOT_FOUND');
    groupName = gRes.rows[0].name;
  } else if (payload.groupName !== undefined) {
    groupName = String(payload.groupName || '').trim();
  }

  return {
    groupId: groupId || null,
    groupName: groupName || '',
    categoryId: categoryId || null,
    category: categoryName || 'عام',
  };
}

function resolveProductGroupCategoryJsonTx(db, payload, cur = null) {
  let groupId = payload.groupId !== undefined ? String(payload.groupId || '').trim() : String(cur?.groupId || '').trim();
  let groupName = '';
  let categoryId = payload.categoryId !== undefined ? String(payload.categoryId || '').trim() : String(cur?.categoryId || '').trim();
  let categoryName = payload.category !== undefined ? String(payload.category || '').trim() : String(cur?.category || '').trim();

  if (categoryId) {
    const cat = (db.categories || []).find((c) => c.id === categoryId);
    if (!cat) throw new AppError(404, 'التصنيف المحدد غير موجود', 'CATEGORY_NOT_FOUND');
    const catGroupId = String(cat.groupId || '').trim();
    if (groupId && catGroupId && catGroupId !== groupId) {
      throw new AppError(400, 'التصنيف المحدد لا ينتمي إلى المجموعة المختارة', 'CATEGORY_GROUP_MISMATCH');
    }
    if (!groupId && catGroupId) {
      groupId = catGroupId;
    }
    categoryName = cat.name;
    if (cat.groupName && !groupName) groupName = cat.groupName;
  }

  if (groupId) {
    const grp = (db.productGroups || []).find((g) => g.id === groupId);
    if (!grp) throw new AppError(404, 'المجموعة المحددة غير موجودة', 'GROUP_NOT_FOUND');
    groupName = grp.name;
  } else if (payload.groupName !== undefined) {
    groupName = String(payload.groupName || '').trim();
  }

  return {
    groupId: groupId || undefined,
    groupName: groupName || '',
    categoryId: categoryId || undefined,
    category: categoryName || 'عام',
  };
}

export async function createProduct(payload, actor) {
  const name = String(payload.name || '').trim();
  const code = String(payload.code || `P-${Date.now().toString().slice(-6)}`).trim();
  const barcode = String(payload.barcode || '').trim();
  if (!name) throw new AppError(400, 'اسم الصنف مطلوب', 'INVALID_PRODUCT_NAME');

  const id = payload.id || generateServerId('PRD');
  const now = nowIso();
  const importBatchId = payload.importBatchId ? String(payload.importBatchId).trim() : null;
  const importedFromFile = Boolean(payload.importedFromFile || importBatchId);
  const sourceFileName = payload.sourceFileName ? String(payload.sourceFileName).trim() : null;

  const units = Array.isArray(payload.units)
    ? payload.units.map((u, idx) => ({
        id: u.id || `${id}-U-${idx + 1}`,
        name: u.name,
        conversionFactor: Number(u.conversionFactor || 1),
        barcode: u.barcode || '',
        purchasePrice: Number(u.purchasePrice ?? 0),
        sellingPrice: Number(u.sellingPrice ?? 0),
      }))
    : [];

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      const dup = await client.query('SELECT id FROM products WHERE LOWER(code) = LOWER($1) LIMIT 1', [code]);
      if (dup.rows[0]) throw new AppError(409, 'كود الصنف مستخدم مسبقًا', 'DUPLICATE_PRODUCT_CODE');

      if (barcode) {
        const dupBc = await client.query('SELECT id, name FROM products WHERE LOWER(barcode) = LOWER($1) LIMIT 1', [barcode]);
        if (dupBc.rows[0]) {
          throw new AppError(409, `الباركود (${barcode}) مستخدم مسبقًا في الصنف (${dupBc.rows[0].name})`, 'DUPLICATE_PRODUCT_BARCODE');
        }
      }

      const resolvedMeta = await resolveProductGroupCategoryPgTx(client, payload, null);
      const resolvedUnit = await resolveProductUnitPgTx(client, payload, null);

      await client.query(
        `INSERT INTO products (id, code, barcode, name, category, category_id, group_id, group_name, base_unit, unit_id, size, color, purchase_price, selling_price, min_stock_level, stock_per_warehouse, image, notes, status, import_batch_id, imported_from_file, source_file_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
        [
          id,
          code,
          barcode,
          name,
          resolvedMeta.category,
          resolvedMeta.categoryId,
          resolvedMeta.groupId,
          resolvedMeta.groupName,
          resolvedUnit.baseUnit,
          resolvedUnit.unitId,
          payload.size || null,
          payload.color || null,
          round2(payload.purchasePrice || 0),
          round2(payload.sellingPrice || 0),
          round2(payload.minStockLevel || 0),
          JSON.stringify(payload.stockPerWarehouse || {}),
          null,
          payload.notes || '',
          payload.status || 'active',
          importBatchId,
          importedFromFile,
          sourceFileName,
          now,
        ]
      );
      for (const u of units) {
        await client.query(
          `INSERT INTO product_units (id, product_id, name, conversion_factor, barcode, purchase_price, selling_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [u.id, id, u.name, u.conversionFactor, u.barcode, u.purchasePrice, u.sellingPrice]
        );
      }

      // Opening stock movements if initial stockPerWarehouse > 0
      const stockMap = payload.stockPerWarehouse || {};
      const actorCtx = Object.values(stockMap).some((q) => Number(q || 0) > 0)
        ? await resolveActorIdentityPgTx(client, actor)
        : null;
      for (const [whId, qty] of Object.entries(stockMap)) {
        const numQty = Number(qty || 0);
        if (numQty > 0) {
          const whRes = await client.query('SELECT name FROM warehouses WHERE id = $1 LIMIT 1', [whId]);
          if (whRes.rows[0]) {
            await client.query(
              `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_type, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'opening', $8, $9, 1, $10, $8, 'opening', 'رصيد افتتاحي', $11, $12, $13, $14, $15, $16)`,
              [
                generateServerId('STK'),
                `OPEN-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`,
                todayIso(),
                id,
                name,
                whId,
                whRes.rows[0].name,
                numQty,
                resolvedUnit.baseUnit,
                round2(payload.purchasePrice || 0),
                actor.id,
                actor.fullName,
                actorCtx?.actorIdentityId || null,
                actorCtx?.actorEmployeeId || null,
                actorCtx?.actingRole || actor.role || null,
                now,
              ]
            );
          }
        }
      }

      const pRes = await client.query('SELECT * FROM products WHERE id = $1', [id]);
      const uRes = await client.query('SELECT * FROM product_units WHERE product_id = $1', [id]);
      return mapPgProductRow(pRes.rows[0], uRes.rows);
    });

    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة صنف (${name})`, module: 'المخزون', recordId: id });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    if (db.products.some((p) => String(p.code || '').trim().toLowerCase() === code.toLowerCase())) {
      throw new AppError(409, 'كود الصنف مستخدم مسبقًا', 'DUPLICATE_PRODUCT_CODE');
    }
    if (barcode) {
      const dupBc = db.products.find((p) => String(p.barcode || '').trim().toLowerCase() === barcode.toLowerCase());
      if (dupBc) {
        throw new AppError(409, `الباركود (${barcode}) مستخدم مسبقًا في الصنف (${dupBc.name})`, 'DUPLICATE_PRODUCT_BARCODE');
      }
    }
    const resolvedMeta = resolveProductGroupCategoryJsonTx(db, payload, null);
    const resolvedUnit = resolveProductUnitJsonTx(db, payload, null);
    const prod = {
      id,
      code,
      barcode,
      name,
      category: resolvedMeta.category,
      categoryId: resolvedMeta.categoryId,
      groupId: resolvedMeta.groupId,
      groupName: resolvedMeta.groupName,
      baseUnit: resolvedUnit.baseUnit,
      ...(resolvedUnit.unitId ? { unitId: resolvedUnit.unitId } : {}),
      units,
      size: payload.size || undefined,
      color: payload.color || undefined,
      purchasePrice: round2(payload.purchasePrice || 0),
      sellingPrice: round2(payload.sellingPrice || 0),
      minStockLevel: round2(payload.minStockLevel || 0),
      stockPerWarehouse: payload.stockPerWarehouse || {},
      notes: payload.notes || '',
      status: payload.status || 'active',
      importBatchId: importBatchId || undefined,
      importedFromFile,
      sourceFileName: sourceFileName || undefined,
      createdAt: now,
    };
    db.products.unshift(prod);
    const actorCtxJson = Object.values(prod.stockPerWarehouse).some((q) => Number(q || 0) > 0)
      ? resolveActorIdentityJsonTx(db, actor)
      : null;
    for (const [whId, qty] of Object.entries(prod.stockPerWarehouse)) {
      const n = Number(qty || 0);
      if (n > 0) {
        const wh = db.warehouses.find((w) => w.id === whId);
        if (wh) {
          db.stockMovements.unshift({
            id: generateServerId('STK'),
            date: todayIso(),
            type: 'opening',
            productId: prod.id,
            productName: prod.name,
            warehouseId: wh.id,
            warehouseName: wh.name,
            quantity: n,
            unitCost: prod.purchasePrice,
            notes: 'رصيد افتتاحي',
            createdByUserId: actor.id,
            createdBy: actor.fullName,
            actorIdentityId: actorCtxJson?.actorIdentityId,
            actorEmployeeId: actorCtxJson?.actorEmployeeId,
            actingRole: actorCtxJson?.actingRole,
            createdAt: now,
          });
        }
      }
    }
    return prod;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة صنف (${name})`, module: 'المخزون', recordId: id });
  return created;
}

export async function updateProduct(productId, updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      if (!pRes.rows[0]) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const uRes = await client.query('SELECT * FROM product_units WHERE product_id = $1', [productId]);
      const cur = mapPgProductRow(pRes.rows[0], uRes.rows);

      const nextName = String(updates.name ?? cur.name).trim();
      if (!nextName) throw new AppError(400, 'اسم الصنف مطلوب', 'INVALID_PRODUCT_NAME');
      const nextCode = String(updates.code ?? cur.code).trim();
      if (!nextCode) throw new AppError(400, 'كود الصنف مطلوب', 'INVALID_PRODUCT_CODE');
      const nextBarcode = String(updates.barcode ?? cur.barcode ?? '').trim();

      if (nextCode.toLowerCase() !== String(cur.code || '').toLowerCase()) {
        const dupCode = await client.query('SELECT id FROM products WHERE LOWER(code) = LOWER($1) AND id <> $2 LIMIT 1', [nextCode, productId]);
        if (dupCode.rows[0]) throw new AppError(409, 'كود الصنف مستخدم مسبقًا لصنف آخر', 'DUPLICATE_PRODUCT_CODE');
      }
      if (nextBarcode && nextBarcode.toLowerCase() !== String(cur.barcode || '').toLowerCase()) {
        const dupBc = await client.query('SELECT id, name FROM products WHERE LOWER(barcode) = LOWER($1) AND id <> $2 LIMIT 1', [nextBarcode, productId]);
        if (dupBc.rows[0]) {
          throw new AppError(409, `الباركود (${nextBarcode}) مستخدم مسبقًا في الصنف (${dupBc.rows[0].name})`, 'DUPLICATE_PRODUCT_BARCODE');
        }
      }

      const resolvedMeta = await resolveProductGroupCategoryPgTx(client, updates || {}, cur);
      const resolvedUnit = await resolveProductUnitPgTx(client, updates || {}, cur);

      await client.query(
        `UPDATE products SET
          code = $1, barcode = $2, name = $3, category = $4, category_id = $5, group_id = $6, group_name = $7, base_unit = $8, unit_id = $9,
          size = $10, color = $11, purchase_price = $12, selling_price = $13, min_stock_level = $14,
          image = $15, notes = $16, status = $17, import_batch_id = $18, imported_from_file = $19, source_file_name = $20, version = COALESCE(version, 1) + 1, updated_at = $21
         WHERE id = $22`,
        [
          nextCode,
          nextBarcode,
          nextName,
          resolvedMeta.category,
          resolvedMeta.categoryId,
          resolvedMeta.groupId,
          resolvedMeta.groupName,
          resolvedUnit.baseUnit,
          resolvedUnit.unitId,
          updates.size ?? cur.size ?? null,
          updates.color ?? cur.color ?? null,
          round2(updates.purchasePrice ?? cur.purchasePrice),
          round2(updates.sellingPrice ?? cur.sellingPrice),
          round2(updates.minStockLevel ?? cur.minStockLevel),
          null,
          updates.notes ?? cur.notes ?? '',
          updates.status ?? cur.status,
          updates.importBatchId !== undefined ? updates.importBatchId : (cur.importBatchId || null),
          updates.importedFromFile !== undefined ? Boolean(updates.importedFromFile) : Boolean(cur.importedFromFile),
          updates.sourceFileName !== undefined ? updates.sourceFileName : (cur.sourceFileName || null),
          now,
          productId,
        ]
      );

      if (Array.isArray(updates.units)) {
        await client.query('DELETE FROM product_units WHERE product_id = $1', [productId]);
        for (let idx = 0; idx < updates.units.length; idx++) {
          const u = updates.units[idx];
          await client.query(
            `INSERT INTO product_units (id, product_id, name, conversion_factor, barcode, purchase_price, selling_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              u.id || `${productId}-U-${idx + 1}`,
              productId,
              u.name,
              Number(u.conversionFactor || 1),
              u.barcode || '',
              Number(u.purchasePrice ?? 0),
              Number(u.sellingPrice ?? 0),
            ]
          );
        }
      }

      const nextP = await client.query('SELECT * FROM products WHERE id = $1', [productId]);
      const nextU = await client.query('SELECT * FROM product_units WHERE product_id = $1', [productId]);
      return mapPgProductRow(nextP.rows[0], nextU.rows);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث بيانات صنف (${updated.name})`, module: 'المخزون', recordId: productId });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    const idx = db.products.findIndex((p) => p.id === productId);
    if (idx === -1) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
    const cur = db.products[idx];
    const nextName = String(updates.name ?? cur.name).trim();
    if (!nextName) throw new AppError(400, 'اسم الصنف مطلوب', 'INVALID_PRODUCT_NAME');
    const nextCode = String(updates.code ?? cur.code).trim();
    if (!nextCode) throw new AppError(400, 'كود الصنف مطلوب', 'INVALID_PRODUCT_CODE');
    const nextBarcode = String(updates.barcode ?? cur.barcode ?? '').trim();

    if (db.products.some((p) => p.id !== productId && String(p.code || '').trim().toLowerCase() === nextCode.toLowerCase())) {
      throw new AppError(409, 'كود الصنف مستخدم مسبقًا لصنف آخر', 'DUPLICATE_PRODUCT_CODE');
    }
    if (nextBarcode) {
      const dupBc = db.products.find((p) => p.id !== productId && String(p.barcode || '').trim().toLowerCase() === nextBarcode.toLowerCase());
      if (dupBc) {
        throw new AppError(409, `الباركود (${nextBarcode}) مستخدم مسبقًا في الصنف (${dupBc.name})`, 'DUPLICATE_PRODUCT_BARCODE');
      }
    }

    const resolvedMeta = resolveProductGroupCategoryJsonTx(db, updates || {}, cur);
    const resolvedUnit = resolveProductUnitJsonTx(db, updates || {}, cur);
    const { image: _ignoredImg, ...safeUpdates } = updates || {};
    const { image: _ignoredCurImg, ...safeCur } = cur;
    db.products[idx] = {
      ...safeCur,
      ...safeUpdates,
      id: cur.id,
      name: nextName,
      code: nextCode,
      barcode: nextBarcode,
      category: resolvedMeta.category,
      categoryId: resolvedMeta.categoryId,
      groupId: resolvedMeta.groupId,
      groupName: resolvedMeta.groupName,
      baseUnit: resolvedUnit.baseUnit,
      unitId: resolvedUnit.unitId || undefined,
      stockPerWarehouse: cur.stockPerWarehouse, // Protect stock map from direct override via product edit
      version: Number(cur.version || 1) + 1,
      updatedAt: now,
    };
    return db.products[idx];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث بيانات صنف (${updated.name})`, module: 'المخزون', recordId: productId });
  return updated;
}

export async function deleteProduct(productId, actor) {
  if (await isPgMode()) {
    const name = await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      if (!pRes.rows[0]) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const [invUsed, retUsed, ordUsed, scUsed, trUsed, ritUsed] = await Promise.all([
        client.query('SELECT id FROM invoice_items WHERE product_id = $1 LIMIT 1', [productId]),
        client.query('SELECT id FROM invoice_return_items WHERE product_id = $1 LIMIT 1', [productId]),
        client.query('SELECT id FROM customer_item_order_items WHERE product_id = $1 LIMIT 1', [productId]),
        client.query('SELECT id FROM stock_count_items WHERE product_id = $1 LIMIT 1', [productId]),
        client.query('SELECT id FROM stock_transfer_request_items WHERE product_id = $1 LIMIT 1', [productId]),
        client.query('SELECT id FROM rep_item_transfer_items WHERE product_id = $1 LIMIT 1', [productId]),
      ]);
      if (invUsed.rows[0] || retUsed.rows[0] || ordUsed.rows[0] || scUsed.rows[0] || trUsed.rows[0] || ritUsed.rows[0]) {
        throw new AppError(409, 'لا يمكن حذف صنف مرتبط بفواتير أو طلبات أو حركات موثقة. يمكنك أرشفته بدلاً من الحذف.', 'PRODUCT_REFERENCED');
      }
      await client.query('DELETE FROM stock_movements WHERE product_id = $1', [productId]);
      await client.query('DELETE FROM products WHERE id = $1', [productId]);
      return pRes.rows[0].name;
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف صنف (${name})`, module: 'المخزون', recordId: productId });
    return { ok: true };
  }

  const name = await withJsonTransaction(async (db) => {
    const prod = db.products.find((p) => p.id === productId);
    if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
    const invUsed = (db.invoices || []).some((inv) => Array.isArray(inv.items) && inv.items.some((it) => it.productId === productId));
    const retUsed = (db.invoiceReturns || []).some((ret) => Array.isArray(ret.items) && ret.items.some((it) => it.productId === productId));
    const ordUsed = (db.customerItemOrders || []).some((o) => Array.isArray(o.items) && o.items.some((it) => it.productId === productId));
    const scUsed = (db.stockCounts || []).some((c) => Array.isArray(c.items) && c.items.some((it) => it.productId === productId));
    const trUsed = (db.stockTransferRequests || []).some((t) => Array.isArray(t.items) && t.items.some((it) => it.productId === productId));
    const ritUsed = (db.repItemTransfers || []).some((t) => Array.isArray(t.items) && t.items.some((it) => it.productId === productId));
    if (invUsed || retUsed || ordUsed || scUsed || trUsed || ritUsed) {
      throw new AppError(409, 'لا يمكن حذف صنف مرتبط بفواتير أو طلبات أو حركات موثقة. يمكنك أرشفته بدلاً من الحذف.', 'PRODUCT_REFERENCED');
    }
    db.products = db.products.filter((p) => p.id !== productId);
    db.stockMovements = (db.stockMovements || []).filter((m) => m.productId !== productId);
    return prod.name;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف صنف (${name})`, module: 'المخزون', recordId: productId });
  return { ok: true };
}

export async function deleteImportedProductsBatch({ batchId = null, deleteAllImported = true } = {}, actor) {
  const cleanBatchId = batchId ? String(batchId).trim() : null;

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const targetsRes = cleanBatchId
        ? await client.query(`SELECT id, name, code FROM products WHERE import_batch_id = $1 AND imported_from_file = TRUE`, [cleanBatchId])
        : await client.query(`SELECT id, name, code FROM products WHERE imported_from_file = TRUE`);

      const targets = targetsRes.rows || [];
      if (targets.length === 0) {
        return { deletedCount: 0, skippedCount: 0, skippedItems: [] };
      }

      const targetIds = targets.map((t) => t.id);
      const referencedIds = new Set();
      const CHUNK_SIZE = 500;

      const collectRefs = async (sqlPrefix, sqlSuffix = '') => {
        for (let i = 0; i < targetIds.length; i += CHUNK_SIZE) {
          const chunk = targetIds.slice(i, i + CHUNK_SIZE);
          const placeholders = chunk.map((_, idx) => `$${idx + 1}`).join(', ');
          const res = await client.query(`${sqlPrefix} (${placeholders}) ${sqlSuffix}`, chunk);
          for (const row of res.rows || []) {
            if (row.product_id) referencedIds.add(row.product_id);
          }
        }
      };

      await collectRefs(`SELECT DISTINCT product_id FROM invoice_items WHERE product_id IN`);
      await collectRefs(`SELECT DISTINCT product_id FROM invoice_return_items WHERE product_id IN`);
      await collectRefs(`SELECT DISTINCT product_id FROM customer_item_order_items WHERE product_id IN`);
      await collectRefs(`SELECT DISTINCT product_id FROM stock_count_items WHERE product_id IN`);
      await collectRefs(`SELECT DISTINCT product_id FROM stock_transfer_request_items WHERE product_id IN`);
      await collectRefs(`SELECT DISTINCT product_id FROM rep_item_transfer_items WHERE product_id IN`);
      await collectRefs(`SELECT DISTINCT product_id FROM stock_movements WHERE product_id IN`, `AND movement_type <> 'opening'`);

      const deletableIds = [];
      const skippedItems = [];
      for (const t of targets) {
        if (referencedIds.has(t.id)) {
          skippedItems.push({ id: t.id, name: t.name, code: t.code });
        } else {
          deletableIds.push(t.id);
        }
      }

      if (deletableIds.length > 0) {
        for (let i = 0; i < deletableIds.length; i += CHUNK_SIZE) {
          const chunk = deletableIds.slice(i, i + CHUNK_SIZE);
          const placeholders = chunk.map((_, idx) => `$${idx + 1}`).join(', ');
          await client.query(`DELETE FROM stock_movements WHERE product_id IN (${placeholders})`, chunk);
          await client.query(`DELETE FROM product_units WHERE product_id IN (${placeholders})`, chunk);
          await client.query(`DELETE FROM products WHERE id IN (${placeholders})`, chunk);
        }
      }

      return {
        deletedCount: deletableIds.length,
        skippedCount: skippedItems.length,
        skippedItems,
      };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `مسح الأصناف المستوردة من الملفات (تم حذف ${result.deletedCount} وتجاوز ${result.skippedCount} مستخدم في فواتير/حركات)`,
      module: 'المخزون',
      recordId: cleanBatchId || 'all_imported',
    });
    return result;
  }

  const result = await withJsonTransaction(async (db) => {
    const targets = (db.products || []).filter((p) =>
      cleanBatchId ? Boolean(p.importedFromFile) && p.importBatchId === cleanBatchId : Boolean(p.importedFromFile)
    );
    if (targets.length === 0) {
      return { deletedCount: 0, skippedCount: 0, skippedItems: [] };
    }

    const referencedIds = new Set();
    for (const inv of db.invoices || []) {
      for (const it of inv.items || []) referencedIds.add(it.productId);
    }
    for (const ret of db.invoiceReturns || []) {
      for (const it of ret.items || []) referencedIds.add(it.productId);
    }
    for (const ord of db.customerItemOrders || []) {
      for (const it of ord.items || []) referencedIds.add(it.productId);
    }
    for (const sc of db.stockCounts || []) {
      for (const it of sc.items || []) referencedIds.add(it.productId);
    }
    for (const tr of db.stockTransferRequests || []) {
      for (const it of tr.items || []) referencedIds.add(it.productId);
    }
    for (const rit of db.repItemTransfers || []) {
      for (const it of rit.items || []) referencedIds.add(it.productId);
    }
    for (const mv of db.stockMovements || []) {
      const mType = mv.type || mv.movementType;
      if (mType && mType !== 'opening') {
        referencedIds.add(mv.productId);
      }
    }

    const deletableSet = new Set();
    const skippedItems = [];
    for (const t of targets) {
      if (referencedIds.has(t.id)) {
        skippedItems.push({ id: t.id, name: t.name, code: t.code });
      } else {
        deletableSet.add(t.id);
      }
    }

    if (deletableSet.size > 0) {
      db.products = (db.products || []).filter((p) => !deletableSet.has(p.id));
      db.stockMovements = (db.stockMovements || []).filter((m) => !deletableSet.has(m.productId));
    }

    return {
      deletedCount: deletableSet.size,
      skippedCount: skippedItems.length,
      skippedItems,
    };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `مسح الأصناف المستوردة من الملفات (تم حذف ${result.deletedCount} وتجاوز ${result.skippedCount} مستخدم في فواتير/حركات)`,
    module: 'المخزون',
    recordId: cleanBatchId || 'all_imported',
  });
  return result;
}

let pgSupportsWindowFunctions = null;

export async function getCustomerProductPriceHistory(customerId, productId = null) {
  const customer = await getCustomerById(customerId);
  if (!customer) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');

  const historyMap = {};
  const cleanProdId = productId ? String(productId).trim() : null;

  if (await isPgMode()) {
    const pool = getPool();
    let res;
    if (cleanProdId) {
      res = await pool.query(
        `SELECT i.id, i.invoice_number, i.date, i.created_at, it.product_id, it.unit, it.unit_factor, it.quantity, it.unit_price
         FROM invoices i
         JOIN invoice_items it ON it.invoice_id = i.id
         WHERE i.customer_id = $1 AND i.type = 'sales' AND i.status = 'confirmed' AND it.product_id = $2
         ORDER BY i.date DESC, i.created_at DESC, i.id DESC, it.id DESC
         LIMIT 3`,
        [customerId, cleanProdId]
      );
    } else if (pgSupportsWindowFunctions !== false) {
      try {
        res = await pool.query(
          `SELECT id, invoice_number, date, created_at, product_id, unit, unit_factor, quantity, unit_price
           FROM (
             SELECT i.id, i.invoice_number, i.date, i.created_at, it.product_id, it.unit, it.unit_factor, it.quantity, it.unit_price,
                    ROW_NUMBER() OVER (
                      PARTITION BY it.product_id
                      ORDER BY i.date DESC, i.created_at DESC, i.id DESC, it.id DESC
                    ) AS rn
             FROM invoices i
             JOIN invoice_items it ON it.invoice_id = i.id
             WHERE i.customer_id = $1 AND i.type = 'sales' AND i.status = 'confirmed'
           ) ranked
           WHERE rn <= 3
           ORDER BY date DESC, created_at DESC, id DESC`,
          [customerId]
        );
        pgSupportsWindowFunctions = true;
      } catch (err) {
        if (/OVER|window/i.test(String(err?.message || ''))) {
          pgSupportsWindowFunctions = false;
          res = await pool.query(
            `SELECT i.id, i.invoice_number, i.date, i.created_at, it.product_id, it.unit, it.unit_factor, it.quantity, it.unit_price
             FROM invoices i
             JOIN invoice_items it ON it.invoice_id = i.id
             WHERE i.customer_id = $1 AND i.type = 'sales' AND i.status = 'confirmed'
             ORDER BY i.date DESC, i.created_at DESC, i.id DESC, it.id DESC`,
            [customerId]
          );
        } else {
          throw err;
        }
      }
    } else {
      res = await pool.query(
        `SELECT i.id, i.invoice_number, i.date, i.created_at, it.product_id, it.unit, it.unit_factor, it.quantity, it.unit_price
         FROM invoices i
         JOIN invoice_items it ON it.invoice_id = i.id
         WHERE i.customer_id = $1 AND i.type = 'sales' AND i.status = 'confirmed'
         ORDER BY i.date DESC, i.created_at DESC, i.id DESC, it.id DESC`,
        [customerId]
      );
    }
    for (const row of res.rows) {
      const list = historyMap[row.product_id] || [];
      if (list.length >= 3) continue;
      list.unshift({
        price: Number(row.unit_price || 0),
        quantity: Number(row.quantity || 0),
        date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date || '').split('T')[0],
        invoiceNumber: row.invoice_number,
        unit: row.unit || '',
        unitFactor: Number(row.unit_factor || 1),
      });
      historyMap[row.product_id] = list;
    }
  } else {
    const db = readJsonDatabase();
    const custInvoices = (db.invoices || [])
      .filter((i) => i.customerId === customerId && i.type === 'sales' && i.status === 'confirmed')
      .sort(
        (a, b) =>
          String(b.date || '').localeCompare(String(a.date || '')) ||
          String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
      );
    for (const inv of custInvoices) {
      for (const it of inv.items || []) {
        if (cleanProdId && it.productId !== cleanProdId) continue;
        const list = historyMap[it.productId] || [];
        if (list.length >= 3) continue;
        list.unshift({
          price: Number(it.unitPrice || 0),
          quantity: Number(it.quantity || 0),
          date: inv.date || '',
          invoiceNumber: inv.invoiceNumber || '',
          unit: it.unit || '',
          unitFactor: Number(it.unitFactor || 1),
        });
        historyMap[it.productId] = list;
      }
    }
  }

  // Fallback for legacy numeric entries stored directly on customer.priceHistory with no matching invoice item yet
  const rawLegacy = customer.priceHistory || {};
  const legacyEntries = Object.entries(rawLegacy);
  let nonConfirmedInvoiceNumbers = new Set();
  if (legacyEntries.length > 0) {
    if (await isPgMode()) {
      const ncRes = await getPool().query(
        `SELECT invoice_number FROM invoices WHERE customer_id = $1 AND (type <> 'sales' OR status <> 'confirmed')`,
        [customerId]
      );
      nonConfirmedInvoiceNumbers = new Set(ncRes.rows.map((r) => String(r.invoice_number || '').trim()).filter(Boolean));
    } else {
      const db = readJsonDatabase();
      nonConfirmedInvoiceNumbers = new Set(
        (db.invoices || [])
          .filter((i) => i.customerId === customerId && (i.type !== 'sales' || i.status !== 'confirmed'))
          .map((i) => String(i.invoiceNumber || '').trim())
          .filter(Boolean)
      );
    }
  }
  for (const [prodId, entries] of legacyEntries) {
    if (cleanProdId && prodId !== cleanProdId) continue;
    if (!historyMap[prodId] && Array.isArray(entries) && entries.length > 0) {
      const validLegacy = entries.filter((entry) => {
        if (typeof entry === 'object' && entry !== null && entry.invoiceNumber) {
          return !nonConfirmedInvoiceNumbers.has(String(entry.invoiceNumber).trim());
        }
        return true;
      });
      if (validLegacy.length === 0) continue;
      historyMap[prodId] = validLegacy.slice(-3).map((entry) =>
        typeof entry === 'object' && entry !== null
          ? {
              price: Number(entry.price || 0),
              quantity: entry.quantity !== undefined ? Number(entry.quantity || 0) : 0,
              date: String(entry.date || ''),
              invoiceNumber: String(entry.invoiceNumber || 'مسجل مسبقاً'),
              unit: String(entry.unit || ''),
              unitFactor: entry.unitFactor !== undefined ? Number(entry.unitFactor || 1) : 1,
            }
          : {
              price: Number(entry || 0),
              quantity: 0,
              date: String(customer.createdAt || '').split('T')[0],
              invoiceNumber: 'سجل تاريخي',
              unit: '',
              unitFactor: 1,
            }
      );
    }
  }

  return historyMap;
}

export async function getCustomerStatementData(customerId, { allowPriceView = true, actor = null } = {}) {
  const customer = await getCustomerById(customerId);
  if (!customer) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
  const isRep = actor?.role === 'representative';
  const hideCashboxMeta = isRep || actor?.role === 'customer';
  const repProfile = isRep ? await getRepresentativeByUserId(actor.id) : null;
  const isRepOwnCustInv = (inv) => isRepOwnerOfInvoice(inv, actor, repProfile);

  let invoices = [];
  let returns = [];
  let paymentTxs = [];
  let orders = [];
  let advancePayments = [];
  let assignedRep = null;

  if (await isPgMode()) {
    const pool = getPool();
    if (customer.assignedRepId) {
      const repRes = await pool.query('SELECT id, name, phone FROM representatives WHERE id = $1 LIMIT 1', [
        customer.assignedRepId,
      ]);
      if (repRes.rows[0]) {
        assignedRep = {
          id: repRes.rows[0].id,
          name: repRes.rows[0].name,
          phone: repRes.rows[0].phone || '',
        };
      }
    }
    const invRes = await pool.query(
      `SELECT * FROM invoices WHERE customer_id = $1 AND type = 'sales' AND status <> 'draft' ORDER BY date DESC, created_at DESC`,
      [customerId]
    );
    const invIds = invRes.rows.map((r) => r.id);
    const itemsMap = new Map();
    const payMap = new Map();
    if (invIds.length > 0) {
      const itParams = [];
      const itPred = buildPgInPredicate('invoice_id', invIds, itParams);
      const itRes = await pool.query(`SELECT * FROM invoice_items WHERE ${itPred}`, itParams);
      for (const it of itRes.rows) {
        const arr = itemsMap.get(it.invoice_id) || [];
        arr.push(it);
        itemsMap.set(it.invoice_id, arr);
      }
      const pyParams = [];
      const pyPred = buildPgInPredicate('invoice_id', invIds, pyParams);
      const pyRes = await pool.query(`SELECT * FROM invoice_payments WHERE ${pyPred} ORDER BY created_at ASC`, pyParams);
      for (const py of pyRes.rows) {
        const arr = payMap.get(py.invoice_id) || [];
        arr.push(py);
        payMap.set(py.invoice_id, arr);
      }
    }
    const { mapPgInvoiceRow, mapPgOrderRow } = await import('./mode.js');
    invoices = invRes.rows.map((r) => mapPgInvoiceRow(r, itemsMap.get(r.id) || [], payMap.get(r.id) || []));

    const retRes = await pool.query(
      `SELECT * FROM invoice_returns WHERE party_id = $1 AND type = 'sales_return' ORDER BY date DESC, created_at DESC`,
      [customerId]
    );
    returns = retRes.rows.map((r) => ({
      id: r.id,
      returnNumber: r.return_number,
      type: r.type,
      originalInvoiceId: r.original_invoice_id,
      originalInvoiceNumber: r.original_invoice_number,
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date || '').split('T')[0],
      partyId: r.party_id,
      partyName: r.party_name,
      grandTotal: Number(r.grand_total || 0),
      refundType: r.refund_type,
      ...(hideCashboxMeta ? {} : { cashboxId: r.cashbox_id || undefined }),
      reason: r.reason || '',
      createdBy: r.created_by || '',
      createdByUserId: r.created_by_user_id || undefined,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at || '',
    }));

    const txRes = await pool.query(
      `SELECT * FROM financial_transactions WHERE related_entity_id = $1 AND type = 'customer_payment' ORDER BY date ASC, created_at ASC`,
      [customerId]
    );
    paymentTxs = txRes.rows.map((r) => ({
      id: r.id,
      transactionNumber: r.transaction_number,
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date || '').split('T')[0],
      amount: Number(r.amount || 0),
      relatedDocType: r.related_doc_type,
      relatedDocId: r.related_doc_id,
      description: r.description || '',
      createdBy: r.created_by || '',
      createdByUserId: r.created_by_user_id || undefined,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at || '',
    }));

    const ordRes = await pool.query(
      `SELECT * FROM customer_item_orders WHERE customer_id = $1 ORDER BY created_at DESC`,
      [customerId]
    );
    orders = ordRes.rows.map((r) => mapPgOrderRow(r, [], []));

    const advRes = await pool.query(
      `SELECT * FROM order_advance_payments WHERE customer_id = $1 ORDER BY created_at DESC`,
      [customerId]
    );
    advancePayments = advRes.rows.map((r) => ({
      id: r.id,
      paymentNumber: r.payment_number,
      orderId: r.order_id,
      customerId: r.customer_id,
      cashboxId: r.cashbox_id,
      cashboxName: r.cashbox_name || '',
      paymentMethod: r.payment_method || 'cash',
      amount: Number(r.amount || 0),
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date || '').split('T')[0],
      notes: r.notes || '',
      status: r.status || 'active',
      appliedInvoiceId: r.applied_invoice_id || undefined,
      createdBy: r.created_by,
      createdByUserId: r.created_by_user_id || undefined,
      createdAt: isoTimestamp(r.created_at),
    }));
  } else {
    const db = readJsonDatabase();
    if (customer.assignedRepId) {
      const rep = (db.representatives || []).find((r) => r.id === customer.assignedRepId);
      if (rep) {
        assignedRep = { id: rep.id, name: rep.name, phone: rep.phone || '' };
      }
    }
    invoices = (db.invoices || [])
      .filter((i) => i.customerId === customerId && i.type === 'sales' && i.status !== 'draft')
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    returns = (db.invoiceReturns || [])
      .filter((r) => r.partyId === customerId && r.type === 'sales_return')
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    paymentTxs = (db.financialTransactions || [])
      .filter((tx) => (tx.relatedEntityId === customerId || tx.partyId === customerId) && tx.type === 'customer_payment')
      .sort((a, b) => String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || '')));
    orders = (db.customerItemOrders || [])
      .filter((o) => o.customerId === customerId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    advancePayments = (db.orderAdvancePayments || [])
      .filter((a) => a.customerId === customerId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  const visibleInvoices = isRep ? invoices.filter(isRepOwnCustInv) : invoices;
  const visibleInvoiceIds = new Set(visibleInvoices.map((i) => i.id));
  const sanitizedInvoices = visibleInvoices.map((inv) => {
    const baseInv = {
      ...inv,
      ...(hideCashboxMeta ? { cashboxId: '', cashboxName: '-' } : {}),
      items: (inv.items || []).map((it) => ({
        productId: it.productId,
        productName: it.productName,
        unit: it.unit,
        unitFactor: it.unitFactor,
        quantity: it.quantity,
        unitPrice: allowPriceView ? it.unitPrice : 0,
        discount: allowPriceView ? it.discount : 0,
        total: allowPriceView ? it.total : 0,
      })),
      payments: Array.isArray(inv.payments)
        ? inv.payments.map((p) => ({
            ...p,
            ...(hideCashboxMeta ? { cashboxId: '', cashboxName: '-' } : {}),
            amount: allowPriceView ? Number(p.amount || 0) : 0,
          }))
        : [],
      subtotal: allowPriceView ? inv.subtotal : 0,
      discountTotal: allowPriceView ? inv.discountTotal : 0,
      grandTotal: allowPriceView ? inv.grandTotal : 0,
      paidAmount: allowPriceView ? inv.paidAmount : 0,
      appliedAdvanceAmount: allowPriceView ? Number(inv.appliedAdvanceAmount || 0) : 0,
      remainingAmount: allowPriceView ? inv.remainingAmount : 0,
    };
    return isRep ? sanitizeInvoiceForRepresentative(baseInv) : baseInv;
  });

  const scopedOrders = isRep
    ? orders.filter(
        (o) =>
          o.userId === actor.id ||
          (repProfile && (o.representativeId === repProfile.id || o.deliveryRepId === repProfile.id))
      )
    : orders;
  const scopedOrderIds = new Set(scopedOrders.map((o) => o.id));

  const scopedReturnsRaw = (isRep
    ? returns.filter((r) =>
        r.originalInvoiceId ? visibleInvoiceIds.has(r.originalInvoiceId) : r.createdByUserId === actor.id
      )
    : returns
  ).map((r) => {
    if (!hideCashboxMeta) return r;
    const { cashboxId: _cb, ...rest } = r;
    return rest;
  });

  const scopedPaymentTxs = isRep
    ? paymentTxs.filter(
        (tx) =>
          (tx.relatedDocType === 'sales' && tx.relatedDocId && visibleInvoiceIds.has(tx.relatedDocId)) ||
          (tx.relatedDocType === 'order_advance' &&
            tx.relatedDocId &&
            (scopedOrderIds.has(tx.relatedDocId) || tx.createdByUserId === actor.id)) ||
          (!tx.relatedDocId && tx.createdByUserId === actor.id)
      )
    : paymentTxs;

  const scopedAdvancePayments = isRep
    ? advancePayments.filter((a) => scopedOrderIds.has(a.orderId) || a.createdByUserId === actor.id)
    : advancePayments;

  const confirmedRaw = visibleInvoices.filter((i) => i.status === 'confirmed');
  const rawEntries = [];
  const openingBal = round2(customer.openingBalance || 0);
  if (!isRep && openingBal !== 0) {
    rawEntries.push({
      id: `OPEN-${customer.id}`,
      date: (customer.createdAt || '').split('T')[0] || '-',
      sortKey: `0000-${customer.createdAt || ''}`,
      docNumber: customer.code || '-',
      type: 'opening_balance',
      label: 'رصيد افتتاحي',
      description: 'الرصيد الافتتاحي للحساب',
      debit: openingBal > 0 ? openingBal : 0,
      credit: openingBal < 0 ? Math.abs(openingBal) : 0,
    });
  }

  for (const inv of confirmedRaw) {
    const appliedAdv = round2(inv.appliedAdvanceAmount || 0);
    const cashAtInvoice = round2(Math.max(0, Number(inv.paidAmount || 0) - appliedAdv));
    const descParts = [`إجمالي الفاتورة ${round2(inv.grandTotal)}`];
    if (appliedAdv > 0) descParts.push(`خصم دفعة مقدمة ${appliedAdv}`);
    if (cashAtInvoice > 0) descParts.push(`مسدد عند الفوترة ${cashAtInvoice}`);
    if (inv.linkedCustomerOrderId) descParts.push('محولة من طلب');
    const externalCollectors = Array.isArray(inv.payments)
      ? [...new Set(
          inv.payments
            .filter((p) => p.createdBy && (!inv.createdByUserId || (p.createdByUserId && p.createdByUserId !== inv.createdByUserId)))
            .map((p) => p.createdBy)
        )]
      : [];
    if (externalCollectors.length > 0) {
      descParts.push(`تحصيل لاحق: ${externalCollectors.join('، ')}`);
    }
    rawEntries.push({
      id: `INV-${inv.id}`,
      docId: inv.id,
      docType: 'sales',
      date: inv.date || '',
      sortKey: `${inv.date || ''}-${inv.createdAt || inv.id}`,
      docNumber: inv.invoiceNumber,
      type: 'sales_invoice',
      label: `فاتورة مبيعات (${inv.items?.length || 0} صنف)`,
      description:
        inv.paidAmount > 0 || inv.linkedCustomerOrderId || externalCollectors.length > 0
          ? descParts.join(' · ')
          : `فاتورة مبيعات آجلة — رقم ${inv.invoiceNumber}`,
      debit: round2(inv.grandTotal || 0),
      credit: cashAtInvoice,
      paidAmount: round2(inv.paidAmount || 0),
      remainingAmount: round2(inv.remainingAmount || 0),
      createdBy: inv.createdBy || '',
      createdByUserId: inv.createdByUserId || undefined,
    });
  }

  const confirmedInvoiceIds = new Set(confirmedRaw.map((i) => i.id));
  for (const tx of scopedPaymentTxs) {
    // Skip payments already tied directly to a confirmed invoice line so we don't double-count paidAmount
    if (tx.relatedDocType === 'sales' && tx.relatedDocId && confirmedInvoiceIds.has(tx.relatedDocId)) {
      continue;
    }
    const isOrderAdv = tx.relatedDocType === 'order_advance';
    rawEntries.push({
      id: `PAY-${tx.id}`,
      docId: tx.id,
      docType: isOrderAdv ? 'order_advance' : 'customer_payment',
      date: tx.date || '',
      sortKey: `${tx.date || ''}-${tx.createdAt || tx.id}`,
      docNumber: tx.transactionNumber || tx.id,
      type: isOrderAdv ? 'order_advance' : 'customer_payment',
      label: isOrderAdv ? 'دفعة مقدمة على طلب (غير مفوترة بعد)' : 'سند تحصيل / دفعة حساب',
      description: tx.description || 'سداد نقدي من العميل',
      debit: 0,
      credit: round2(tx.amount || 0),
      paidAmount: round2(tx.amount || 0),
      remainingAmount: 0,
      createdBy: tx.createdBy || '',
      createdByUserId: tx.createdByUserId || undefined,
    });
  }

  for (const ret of scopedReturnsRaw) {
    rawEntries.push({
      id: `RET-${ret.id}`,
      docId: ret.id,
      docType: 'sales_return',
      date: ret.date || '',
      sortKey: `${ret.date || ''}-${ret.createdAt || ret.id}`,
      docNumber: ret.returnNumber,
      type: 'sales_return',
      label: 'مرتجع مبيعات',
      description: ret.reason || `مرتجع على فاتورة ${ret.originalInvoiceNumber || '-'}`,
      debit: 0,
      credit: ret.refundType === 'balance' ? round2(ret.grandTotal || 0) : 0,
      paidAmount: ret.refundType === 'cash' ? round2(ret.grandTotal || 0) : 0,
      remainingAmount: 0,
      createdBy: ret.createdBy || '',
      createdByUserId: ret.createdByUserId || undefined,
    });
  }

  rawEntries.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));

  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const entries = rawEntries.map(({ sortKey: _s, ...entry }) => {
    totalDebit = round2(totalDebit + entry.debit);
    totalCredit = round2(totalCredit + entry.credit);
    running = round2(running + entry.debit - entry.credit);
    return {
      ...entry,
      debit: allowPriceView ? entry.debit : null,
      credit: allowPriceView ? entry.credit : null,
      paidAmount: allowPriceView ? (entry.paidAmount ?? null) : null,
      remainingAmount: allowPriceView ? (entry.remainingAmount ?? null) : null,
      runningBalance: allowPriceView ? running : null,
    };
  });

  const openOrders = scopedOrders.filter((o) => !['invoiced', 'rejected', 'cancelled'].includes(o.status));
  const activeAdvanceBalance = round2(
    scopedAdvancePayments.filter((a) => a.status === 'active').reduce((s, a) => s + Number(a.amount || 0), 0)
  );
  const directSalesCount = confirmedRaw.filter((i) => !i.linkedCustomerOrderId).length;
  const appSourceFlag = Boolean(customer.userId) || scopedOrders.length > 0;
  const customerType =
    appSourceFlag && directSalesCount > 0 ? 'hybrid' : appSourceFlag ? 'app' : 'regular';

  const curBal = round2(customer.currentBalance || 0);
  const totalSales = round2(confirmedRaw.reduce((s, i) => s + Number(i.grandTotal || 0), 0));
  const standalonePaid = round2(
    scopedPaymentTxs
      .filter((tx) => !(tx.relatedDocType === 'sales' && tx.relatedDocId && confirmedInvoiceIds.has(tx.relatedDocId)))
      .reduce((s, tx) => s + Number(tx.amount || 0), 0)
  );
  const invoicePaidCash = round2(
    confirmedRaw.reduce((s, i) => s + Math.max(0, Number(i.paidAmount || 0) - Number(i.appliedAdvanceAmount || 0)), 0)
  );
  const totalPaid = round2(invoicePaidCash + standalonePaid);
  const sortedConfirmedByDate = [...confirmedRaw].sort((a, b) =>
    `${b.date || ''}-${b.createdAt || ''}`.localeCompare(`${a.date || ''}-${a.createdAt || ''}`)
  );
  const lastInv = sortedConfirmedByDate[0] || null;
  const sortedPaymentsByDate = [...scopedPaymentTxs].sort((a, b) =>
    `${b.date || ''}-${b.createdAt || ''}`.localeCompare(`${a.date || ''}-${a.createdAt || ''}`)
  );
  const lastPay = sortedPaymentsByDate[0] || null;
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;

  return {
    allowPriceView: Boolean(allowPriceView),
    scope: {
      isRepScoped: isRep,
      accountBalanceScope: 'company_wide',
      operationsScope: isRep ? 'representative_own_only' : 'company_wide',
    },
    customer: {
      ...customer,
      assignedRep: assignedRep || customer.assignedRep || undefined,
      openingBalance: allowPriceView ? customer.openingBalance : 0,
      currentBalance: allowPriceView ? customer.currentBalance : 0,
      priceHistory: allowPriceView ? customer.priceHistory : {},
    },
    customerType,
    invoices: sanitizedInvoices,
    returns: scopedReturnsRaw.map((r) => ({ ...r, grandTotal: allowPriceView ? r.grandTotal : 0 })),
    orders: scopedOrders.map((o) => ({
      ...o,
      totalAmount: allowPriceView ? o.totalAmount : 0,
      advancePaidAmount: allowPriceView ? o.advancePaidAmount : 0,
      remainingAmount: allowPriceView ? o.remainingAmount : 0,
    })),
    advancePayments: scopedAdvancePayments.map((a) => ({
      ...a,
      ...(hideCashboxMeta ? { cashboxId: '', cashboxName: '-' } : {}),
      amount: allowPriceView ? a.amount : 0,
    })),
    summary: {
      openingBalance: allowPriceView ? (isRep ? 0 : openingBal) : null,
      totalDebit: allowPriceView ? totalDebit : null,
      totalCredit: allowPriceView ? totalCredit : null,
      totalSales: allowPriceView ? totalSales : null,
      totalPaid: allowPriceView ? totalPaid : null,
      currentBalance: allowPriceView ? curBal : null,
      debtAmount: allowPriceView ? (curBal > 0 ? curBal : 0) : null,
      creditAmount: allowPriceView ? (curBal < 0 ? round2(Math.abs(curBal)) : 0) : null,
      balanceDirection: curBal > 0.005 ? 'debt' : curBal < -0.005 ? 'credit' : 'settled',
      activeAdvanceBalance: allowPriceView ? activeAdvanceBalance : null,
      openOrdersCount: openOrders.length,
      openOrdersEstimatedTotal: allowPriceView
        ? round2(openOrders.reduce((s, o) => s + Number(o.totalAmount || 0), 0))
        : null,
      invoicesCount: confirmedRaw.length,
      returnsCount: scopedReturnsRaw.length,
      ordersCount: scopedOrders.length,
      lastInvoiceDate: lastInv?.date || null,
      lastInvoiceNumber: lastInv?.invoiceNumber || null,
      lastPaymentDate: lastPay?.date || null,
      lastTransactionDate: lastEntry?.date || null,
    },
    entries,
  };
}

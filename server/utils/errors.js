export class AppError extends Error {
  constructor(status, message, code = 'APP_ERROR', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

export function todayIso() {
  return new Date().toISOString().split('T')[0];
}

export function nowIso() {
  return new Date().toISOString();
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, password_hash, passwordAlgo, password_algo, ...safe } = user;
  return {
    id: safe.id,
    fullName: safe.fullName ?? safe.full_name ?? '',
    username: safe.username,
    phone: safe.phone || '',
    address: safe.address || '',
    notes: safe.notes || '',
    role: safe.role,
    jobTitle: safe.jobTitle ?? safe.job_title ?? '',
    department: safe.department || '',
    identityId: safe.identityId ?? safe.identity_id ?? undefined,
    employeeId: safe.employeeId ?? safe.employee_id ?? undefined,
    activeRole: safe.activeRole ?? safe.active_role ?? undefined,
    additionalRoles: Array.isArray(safe.additionalRoles ?? safe.additional_roles)
      ? (safe.additionalRoles ?? safe.additional_roles)
      : undefined,
    isActive: safe.isActive ?? safe.is_active ?? true,
    mustChangePassword: safe.mustChangePassword ?? safe.must_change_password ?? false,
    lastLogin: safe.lastLogin ?? safe.last_login ?? undefined,
    permissions: safe.permissions || {},
    shortcuts: Array.isArray(safe.shortcuts) ? safe.shortcuts : [],
    createdAt: safe.createdAt ?? safe.created_at ?? nowIso(),
  };
}

export function sanitizeProductForCustomer(product, allowPriceView = true) {
  const stockMap = product.stockPerWarehouse || {};
  const totalStock = Object.values(stockMap).reduce((sum, val) => sum + Number(val || 0), 0);
  return {
    id: product.id,
    code: product.code,
    barcode: product.barcode || '',
    name: product.name,
    category: product.category,
    categoryId: product.categoryId,
    baseUnit: product.baseUnit,
    units: Array.isArray(product.units)
      ? product.units.map((u) => ({
          id: u.id,
          name: u.name,
          conversionFactor: Number(u.conversionFactor || 1),
          sellingPrice: allowPriceView ? Number(u.sellingPrice || 0) : 0,
          barcode: u.barcode || '',
        }))
      : [],
    size: product.size,
    color: product.color,
    sellingPrice: allowPriceView ? Number(product.sellingPrice || 0) : 0,
    hidePrices: !allowPriceView,
    inStock: totalStock > 0,
    availableQty: Math.max(0, round3(totalStock)),
    image: product.image,
    status: product.status || 'active',
    notes: product.notes || '',
    createdAt: product.createdAt,
  };
}

export function sanitizeProductForRepresentative(product) {
  if (!product) return product;
  return {
    ...product,
    purchasePrice: 0,
    units: Array.isArray(product.units)
      ? product.units.map((u) => ({
          ...u,
          purchasePrice: 0,
        }))
      : [],
  };
}

export function sanitizeInvoiceForRepresentative(invoice) {
  if (!invoice || invoice.type === 'purchase') return invoice;
  const zeroItems = (list) =>
    Array.isArray(list)
      ? list.map((it) => ({
          ...it,
          purchasePriceAtTime: 0,
        }))
      : list;
  return {
    ...invoice,
    items: zeroItems(invoice.items),
    ...(Array.isArray(invoice.editHistory)
      ? {
          editHistory: invoice.editHistory.map((h) => ({
            ...h,
            before: h?.before ? { ...h.before, items: zeroItems(h.before.items) } : h?.before,
            after: h?.after ? { ...h.after, items: zeroItems(h.after.items) } : h?.after,
          })),
        }
      : {}),
  };
}

export function isRepOwnerOfInvoice(inv, actor, repProfile = null) {
  if (!inv || !actor) return false;
  if (repProfile?.id && inv.representativeId === repProfile.id) return true;
  if (actor.id && inv.createdByUserId === actor.id) return true;
  if (actor.id && inv.sentByUserId === actor.id) return true;
  if (
    actor.id &&
    !inv.createdByUserId &&
    !inv.representativeId &&
    !inv.sentByUserId &&
    inv.createdBy === actor.id
  ) {
    return true;
  }
  return false;
}

export function buildPgInPredicate(columnSql, values, params) {
  const list = Array.isArray(values)
    ? Array.from(new Set(values.filter((v) => v !== null && v !== undefined && v !== '')))
    : [];
  if (list.length === 0) return '1 = 0';
  const placeholders = list.map((v) => {
    params.push(v);
    return `$${params.length}`;
  });
  return `${columnSql} IN (${placeholders.join(', ')})`;
}

export function getUnitSellingPrice(product, unitName) {
  if (!product) return 0;
  if (!unitName || unitName === product.baseUnit) {
    return Number(product.sellingPrice || 0);
  }
  const unitObj = Array.isArray(product.units) ? product.units.find((u) => u.name === unitName) : null;
  if (unitObj) {
    return Number(unitObj.sellingPrice ?? Number(product.sellingPrice || 0) * Number(unitObj.conversionFactor || 1));
  }
  return Number(product.sellingPrice || 0);
}

export function getUnitFactor(product, unitName) {
  if (!product || !unitName || unitName === product.baseUnit) return 1;
  const unitObj = Array.isArray(product.units) ? product.units.find((u) => u.name === unitName) : null;
  return unitObj ? Math.max(0.001, Number(unitObj.conversionFactor || 1)) : 1;
}

export function normalizePhoneDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0020') && d.length >= 13) d = '0' + d.slice(4);
  else if (d.startsWith('20') && d.length >= 12) d = '0' + d.slice(2);
  return d;
}

export function buildPhoneLookupVariants(raw) {
  const trimmed = String(raw || '').trim();
  const normPhone = normalizePhoneDigits(trimmed);
  const set = new Set();
  if (trimmed) set.add(trimmed);
  if (normPhone) {
    set.add(normPhone);
    set.add(`+2${normPhone}`);
    set.add(`2${normPhone}`);
    set.add(`002${normPhone}`);
    if (normPhone.startsWith('0') && normPhone.length > 1) {
      const noZero = normPhone.slice(1);
      set.add(noZero);
      set.add(`+20${noZero}`);
      set.add(`20${noZero}`);
      set.add(`0020${noZero}`);
    }
  }
  const suffixPattern = normPhone.length >= 7 ? `%${normPhone.slice(-7)}%` : normPhone ? `%${normPhone}%` : '';
  return { normPhone, variants: Array.from(set), suffixPattern };
}

export function canViewCashboxBalances(user) {
  if (!user || user.role === 'customer' || user.role === 'representative') return false;
  if (user.role === 'admin') return true;
  const perms = user.permissions || {};
  return Boolean(perms.canManageCashboxes || perms.canManageAccounts || perms.canViewReports);
}

export function sanitizeCashboxForViewer(cb, user) {
  if (!cb) return cb;
  const id = cb.id;
  const name = cb.name;
  const type = cb.type || 'cashbox';
  const isDefault = Boolean(cb.isDefault ?? cb.is_default);
  if (canViewCashboxBalances(user)) {
    return {
      id,
      name,
      type,
      ...(cb.accountNumber ?? cb.account_number ? { accountNumber: cb.accountNumber ?? cb.account_number } : {}),
      openingBalance: Number(cb.openingBalance ?? cb.opening_balance ?? 0),
      currentBalance: Number(cb.currentBalance ?? cb.current_balance ?? 0),
      isDefault,
    };
  }
  return {
    id,
    name,
    type,
    isDefault,
    balanceHidden: true,
  };
}

export function canViewAllRepresentatives(user) {
  if (!user || user.role === 'customer' || user.role === 'representative') return false;
  return true;
}

export function canManageSyncConflictsGlobally(user) {
  if (!user || user.role === 'customer' || user.role === 'representative') return false;
  if (user.role === 'admin') return true;
  const perms = user.permissions || {};
  if (perms.canManageSyncConflicts === true) return true;
  if (user.role === 'manager' && (perms.canManageSettings === true || perms.canManageUsers === true)) {
    return true;
  }
  return false;
}

const SYNC_FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SYNC_SECRET_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'passwordalgo',
  'password_algo',
  'refreshtoken',
  'refresh_token',
  'refreshtokenhash',
  'refresh_token_hash',
  'accesstoken',
  'access_token',
  'tokenhash',
  'token_hash',
  'jwtsecret',
  'jwt_secret',
  'bootstrapsecret',
  'bootstrap_secret',
  'apikey',
  'api_key',
  'cashboxbalance',
  'cashbox_balance',
  'balanceafter',
  'balance_after',
]);
const SYNC_COST_KEYS = new Set([
  'purchaseprice',
  'purchase_price',
  'purchasepriceattime',
  'purchase_price_at_time',
  'costprice',
  'cost_price',
  'costvalue',
  'cost_value',
  'profit',
  'profitvalue',
  'profit_value',
  'commissionrate',
  'commission_rate',
]);

export function sanitizeSyncPayload(
  raw,
  { redactCosts = false, maxDepth = 5, maxKeys = 80, maxArray = 120, maxStringLength = 50000 } = {}
) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const cleanValue = (val, depth) => {
    if (val === null || val === undefined) return val;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    if (typeof val === 'string') {
      return val.length > maxStringLength ? val.slice(0, maxStringLength) : val;
    }
    if (depth >= maxDepth) return undefined;
    if (Array.isArray(val)) {
      const outArr = [];
      for (let i = 0; i < Math.min(val.length, maxArray); i++) {
        const cleaned = cleanValue(val[i], depth + 1);
        if (cleaned !== undefined) outArr.push(cleaned);
      }
      return outArr;
    }
    if (typeof val === 'object') {
      const outObj = {};
      let count = 0;
      for (const [k, v] of Object.entries(val)) {
        if (count >= maxKeys) break;
        if (!k || SYNC_FORBIDDEN_KEYS.has(k)) continue;
        const lowerKey = k.toLowerCase();
        if (SYNC_SECRET_KEYS.has(lowerKey)) continue;
        if (redactCosts && SYNC_COST_KEYS.has(lowerKey)) continue;
        const cleaned = cleanValue(v, depth + 1);
        if (cleaned !== undefined) {
          outObj[k] = cleaned;
          count++;
        }
      }
      return outObj;
    }
    return undefined;
  };

  const result = cleanValue(raw, 0);
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}


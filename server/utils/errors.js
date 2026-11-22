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

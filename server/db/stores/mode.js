import {
  getPool,
  getPostgresConfig,
  checkPostgresHealth,
  initializeSchema,
  isStrictPostgresMode,
  setPgConnectionFailureListener,
} from '../postgres.js';
import { AppError } from '../../utils/errors.js';

export { isStrictPostgresMode };

export const DATABASE_UNAVAILABLE_CODE = 'DATABASE_UNAVAILABLE';
export const DATABASE_UNAVAILABLE_MESSAGE =
  'قاعدة البيانات المركزية (PostgreSQL) غير متاحة مؤقتًا. تم إيقاف العمليات لحماية البيانات ومنع انقسامها.';

let pgActiveCache = null;
let pgSchemaReady = false;
let lastPgHealthCheckAt = 0;
let lastPgFailureReason = null;
let pendingStrictProbe = null;

export function createDatabaseUnavailableError(
  reason = 'connection_failed',
  message = DATABASE_UNAVAILABLE_MESSAGE
) {
  return new AppError(503, message, DATABASE_UNAVAILABLE_CODE, {
    strictMode: true,
    reason,
  });
}

export function markPgUnavailable(reason = 'connection_failed') {
  pgActiveCache = false;
  lastPgFailureReason = String(reason || 'connection_failed');
  lastPgHealthCheckAt = 0;
}

setPgConnectionFailureListener((reason) => {
  if (isStrictPostgresMode()) {
    markPgUnavailable(reason);
  }
});

export function markPgAvailable({ schemaReady } = {}) {
  pgActiveCache = true;
  lastPgFailureReason = null;
  lastPgHealthCheckAt = Date.now();
  if (typeof schemaReady === 'boolean') {
    pgSchemaReady = schemaReady;
  }
}

export function isPgSchemaReady() {
  return pgSchemaReady;
}

export function getLastPgFailureReason() {
  return lastPgFailureReason;
}

function getStrictHealthCacheTtlMs() {
  const raw = process.env.AWLAD_STRICT_HEALTH_TTL_MS;
  if (raw === undefined || raw === '') return 1000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1000;
}

export async function ensureStrictPgReady({ forceHealthCheck = false } = {}) {
  if (!isStrictPostgresMode()) {
    return null;
  }

  const config = getPostgresConfig();
  const pool = getPool();
  if (!config || !pool) {
    markPgUnavailable('not_configured');
    throw createDatabaseUnavailableError('not_configured');
  }

  const ttlMs = getStrictHealthCacheTtlMs();
  if (
    !forceHealthCheck &&
    pgActiveCache === true &&
    pgSchemaReady &&
    ttlMs > 0 &&
    Date.now() - lastPgHealthCheckAt < ttlMs
  ) {
    return true;
  }

  if (pendingStrictProbe) {
    return pendingStrictProbe;
  }

  pendingStrictProbe = (async () => {
    const health = await checkPostgresHealth();
    if (health.status !== 'online') {
      markPgUnavailable(health.status || 'connection_failed');
      throw createDatabaseUnavailableError(health.status || 'connection_failed');
    }

    if (!pgSchemaReady) {
      const schemaRes = await initializeSchema();
      if (!schemaRes?.success) {
        markPgUnavailable('schema_init_failed');
        throw createDatabaseUnavailableError('schema_init_failed');
      }
    }

    markPgAvailable({ schemaReady: true });
    return true;
  })().finally(() => {
    pendingStrictProbe = null;
  });

  return pendingStrictProbe;
}

export const FULL_ADMIN_PERMISSIONS = {
  canView: true,
  canAdd: true,
  canEdit: true,
  canDelete: true,
  canPrint: true,
  canExport: true,
  canViewReports: true,
  canManageSales: true,
  canCreatePurchase: true,
  canManagePurchases: true,
  canManageInventory: true,
  canManageWarehouses: true,
  canManageCashboxes: true,
  canManageAccounts: true,
  canManageReps: true,
  canManageTransfers: true,
  canManageEmployees: true,
  canManageSalaries: true,
  canManageUsers: true,
  canManageSettings: true,
  canAllowNegativeInventory: true,
  canViewPersonalAccounts: true,
  canCreatePersonalTx: true,
  canEditPersonalTx: true,
  canApprovePersonalAdjustment: true,
  canCreateStockCount: true,
  canApproveStockCount: true,
  canCreateStockTransfer: true,
  canApproveStockTransfer: true,
  canExecuteStockTransfer: true,
  canViewDeletedInvoices: true,
  canApprove: true,
  canSend: true,
  canReceive: true,
  canReviewRepInvoices: true,
};

export const CUSTOMER_DEFAULT_PERMISSIONS = {
  canView: true,
  canAdd: false,
  canEdit: false,
  canDelete: false,
  canPrint: true,
  canExport: false,
  canViewReports: false,
  canManageSales: false,
  canCreatePurchase: false,
  canManagePurchases: false,
  canManageInventory: false,
  canManageWarehouses: false,
  canManageCashboxes: false,
  canManageAccounts: false,
  canManageReps: false,
  canManageTransfers: false,
  canManageEmployees: false,
  canManageSalaries: false,
  canManageUsers: false,
  canManageSettings: false,
  canAllowNegativeInventory: false,
  canViewPersonalAccounts: false,
  canCreatePersonalTx: false,
  canEditPersonalTx: false,
  canApprovePersonalAdjustment: false,
  canCreateStockCount: false,
  canApproveStockCount: false,
  canCreateStockTransfer: false,
  canApproveStockTransfer: false,
  canExecuteStockTransfer: false,
  canViewDeletedInvoices: false,
  canApprove: false,
  canSend: false,
  canReceive: false,
  canReviewRepInvoices: false,
};

export const REP_DEFAULT_PERMISSIONS = {
  ...CUSTOMER_DEFAULT_PERMISSIONS,
  canView: true,
  canAdd: true,
  canEdit: true,
  canPrint: true,
  canManageSales: true,
  canCreatePurchase: true,
  canManagePurchases: false,
  canManageTransfers: true,
  canManageAccounts: false,
  canManageReps: false,
  canViewReports: false,
  canSend: true,
  canReceive: true,
};

export const CUSTOMER_PRESET_ALLOWED_KEYS = new Set([
  'canView',
  'canPrint',
  'canExport',
  'canViewReports',
]);

export const REP_PRESET_ALLOWED_KEYS = new Set([
  'canView',
  'canAdd',
  'canEdit',
  'canDelete',
  'canPrint',
  'canExport',
  'canViewReports',
  'canManageSales',
  'canCreatePurchase',
  'canManageTransfers',
  'canCreateStockTransfer',
  'canSend',
  'canReceive',
]);

export const ADMIN_ONLY_PERMISSION_KEYS = new Set([
  'canManageUsers',
  'canManageSettings',
  'canManageEmployees',
  'canManageSalaries',
  'canManageCashboxes',
  'canManageAccounts',
  'canManageReps',
  'canManageInventory',
  'canManageWarehouses',
  'canManagePurchases',
  'canAllowNegativeInventory',
  'canViewPersonalAccounts',
  'canCreatePersonalTx',
  'canEditPersonalTx',
  'canApprovePersonalAdjustment',
  'canCreateStockCount',
  'canApproveStockCount',
  'canApproveStockTransfer',
  'canExecuteStockTransfer',
  'canViewDeletedInvoices',
  'canApprove',
  'canReviewRepInvoices',
  'canManageSyncConflicts',
]);

export function sanitizeEffectivePermissionsForRole(role, rawPerms = {}) {
  const cleanRole = String(role || '').trim();
  const permsObj = rawPerms && typeof rawPerms === 'object' ? rawPerms : {};
  if (cleanRole === 'admin') {
    return { ...FULL_ADMIN_PERMISSIONS };
  }
  if (cleanRole === 'customer') {
    const out = Object.fromEntries(Object.keys(FULL_ADMIN_PERMISSIONS).map((k) => [k, false]));
    for (const key of CUSTOMER_PRESET_ALLOWED_KEYS) {
      out[key] = permsObj[key] !== undefined ? Boolean(permsObj[key]) : Boolean(CUSTOMER_DEFAULT_PERMISSIONS[key]);
    }
    out.canView = true;
    return out;
  }
  if (cleanRole === 'representative') {
    const out = Object.fromEntries(Object.keys(FULL_ADMIN_PERMISSIONS).map((k) => [k, false]));
    for (const key of REP_PRESET_ALLOWED_KEYS) {
      out[key] = permsObj[key] !== undefined ? Boolean(permsObj[key]) : Boolean(REP_DEFAULT_PERMISSIONS[key]);
    }
    for (const adminKey of ADMIN_ONLY_PERMISSION_KEYS) {
      out[adminKey] = false;
    }
    out.canView = true;
    return out;
  }
  const defaults = getDefaultPermissionsForRole(cleanRole);
  return { ...defaults, ...permsObj };
}

export const DEFAULT_ROLE_PERMISSION_PRESETS = {
  representative: { ...REP_DEFAULT_PERMISSIONS },
  customer: { ...CUSTOMER_DEFAULT_PERMISSIONS },
};

export function sanitizeRolePermissionPreset(role, rawPerms = {}) {
  const cleanRole = String(role || '').trim();
  const base =
    cleanRole === 'customer'
      ? { ...CUSTOMER_DEFAULT_PERMISSIONS }
      : cleanRole === 'representative'
      ? { ...REP_DEFAULT_PERMISSIONS }
      : getDefaultPermissionsForRole(cleanRole);

  if (cleanRole !== 'customer' && cleanRole !== 'representative') {
    return base;
  }

  const allowedKeys = cleanRole === 'customer' ? CUSTOMER_PRESET_ALLOWED_KEYS : REP_PRESET_ALLOWED_KEYS;
  const sanitized = Object.fromEntries(Object.keys(FULL_ADMIN_PERMISSIONS).map((k) => [k, false]));
  for (const key of Object.keys(sanitized)) {
    if (!allowedKeys.has(key)) {
      sanitized[key] = false;
      continue;
    }
    sanitized[key] = rawPerms && Object.prototype.hasOwnProperty.call(rawPerms, key)
      ? Boolean(rawPerms[key])
      : Boolean(base[key]);
  }
  sanitized.canView = true; // View basic portal data is always baseline active
  return sanitized;
}

export function resolveRolePermissionPresets(extraSettings = {}) {
  const stored = extraSettings?.roleDefaultPermissions || {};
  return {
    representative: sanitizeRolePermissionPreset('representative', stored.representative || REP_DEFAULT_PERMISSIONS),
    customer: sanitizeRolePermissionPreset('customer', stored.customer || CUSTOMER_DEFAULT_PERMISSIONS),
  };
}

export function resolveDefaultPermissionsForRole(role, extraSettings = {}) {
  const cleanRole = String(role || '').trim();
  if (cleanRole === 'representative' || cleanRole === 'customer') {
    const presets = resolveRolePermissionPresets(extraSettings);
    return { ...presets[cleanRole] };
  }
  return getDefaultPermissionsForRole(cleanRole);
}

export function getDefaultPermissionsForRole(role) {
  switch (String(role || '').trim()) {
    case 'admin':
      return { ...FULL_ADMIN_PERMISSIONS };
    case 'customer':
      return { ...CUSTOMER_DEFAULT_PERMISSIONS };
    case 'representative':
      return { ...REP_DEFAULT_PERMISSIONS };
    case 'purchases':
      return {
        ...CUSTOMER_DEFAULT_PERMISSIONS,
        canView: true,
        canAdd: true,
        canEdit: true,
        canPrint: true,
        canExport: true,
        canViewReports: true,
        canCreatePurchase: true,
        canManagePurchases: true,
        canApprove: true,
        canSend: true,
        canReceive: true,
      };
    case 'sales':
      return {
        ...CUSTOMER_DEFAULT_PERMISSIONS,
        canView: true,
        canAdd: true,
        canEdit: true,
        canPrint: true,
        canManageSales: true,
        canSend: true,
        canReceive: true,
      };
    case 'warehouse':
      return {
        ...CUSTOMER_DEFAULT_PERMISSIONS,
        canView: true,
        canAdd: true,
        canEdit: true,
        canPrint: true,
        canManageInventory: true,
        canManageWarehouses: true,
        canCreateStockCount: true,
        canCreateStockTransfer: true,
        canExecuteStockTransfer: true,
        canSend: true,
        canReceive: true,
      };
    case 'accountant':
      return {
        ...CUSTOMER_DEFAULT_PERMISSIONS,
        canView: true,
        canAdd: true,
        canEdit: true,
        canPrint: true,
        canExport: true,
        canViewReports: true,
        canManageCashboxes: true,
        canManageAccounts: true,
        canApprove: true,
        canReviewRepInvoices: true,
      };
    case 'manager':
      return {
        ...FULL_ADMIN_PERMISSIONS,
        canManageUsers: false,
        canManageSettings: false,
        canViewPersonalAccounts: false,
        canCreatePersonalTx: false,
        canEditPersonalTx: false,
        canApprovePersonalAdjustment: false,
      };
    default:
      return { ...CUSTOMER_DEFAULT_PERMISSIONS };
  }
}

export function setPgActive(val) {
  pgActiveCache = val === null ? null : Boolean(val);
  if (val === true) {
    lastPgFailureReason = null;
    lastPgHealthCheckAt = Date.now();
  }
}

export async function isPgMode() {
  if (isStrictPostgresMode()) {
    await ensureStrictPgReady();
    return true;
  }

  if (pgActiveCache !== null) return pgActiveCache;
  const pool = getPool();
  if (!pool) {
    pgActiveCache = false;
    return false;
  }
  const health = await checkPostgresHealth();
  pgActiveCache = health.status === 'online';
  return pgActiveCache;
}

export function resetPgModeCache() {
  pgActiveCache = null;
  pgSchemaReady = false;
  lastPgHealthCheckAt = 0;
  lastPgFailureReason = null;
}

export function isoDateOnly(val) {
  if (!val) return new Date().toISOString().split('T')[0];
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return String(val).split('T')[0];
}

export function isoTimestamp(val) {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

export function mapPgUserRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    fullName: r.full_name,
    username: r.username,
    passwordHash: r.password_hash,
    passwordAlgo: r.password_algo || 'bcrypt',
    phone: r.phone || '',
    address: r.address || '',
    notes: r.notes || '',
    role: r.role,
    jobTitle: r.job_title || '',
    department: r.department || '',
    isActive: Boolean(r.is_active),
    mustChangePassword: Boolean(r.must_change_password),
    lastLogin: r.last_login ? isoTimestamp(r.last_login) : undefined,
    identityId: r.identity_id || undefined,
    employeeId: r.employee_id || undefined,
    activeRole: r.active_role || r.role,
    additionalRoles: Array.isArray(r.additional_roles) ? r.additional_roles : [],
    permissions: sanitizeEffectivePermissionsForRole(r.role, r.permissions || {}),
    shortcuts: Array.isArray(r.shortcuts) ? r.shortcuts : [],
    createdAt: isoTimestamp(r.created_at),
  };
}

export function normalizeCustomerPhoneDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0020') && d.length >= 13) d = '0' + d.slice(4);
  else if (d.startsWith('20') && d.length >= 12) d = '0' + d.slice(2);
  return d;
}

export function normalizeCustomerPhonesList(inputPhones, fallbackPrimary = '', fallbackSecondary = '') {
  const entries = [];
  const seenDigits = new Set();

  const pushEntry = (rawNumber, label = '', isPrimary = false, id = '') => {
    const num = String(rawNumber || '').trim();
    if (!num) return;
    const digits = normalizeCustomerPhoneDigits(num) || num;
    if (seenDigits.has(digits)) return;
    seenDigits.add(digits);
    entries.push({
      id: String(id || `ph-${entries.length + 1}`),
      number: num,
      phone: num,
      label: String(label || (entries.length === 0 ? 'رئيسي' : `رقم ${entries.length + 1}`)).trim(),
      isPrimary: Boolean(isPrimary),
    });
  };

  if (Array.isArray(inputPhones)) {
    for (const item of inputPhones) {
      if (typeof item === 'string') {
        pushEntry(item);
      } else if (item && typeof item === 'object') {
        pushEntry(item.number ?? item.phone ?? '', item.label || '', Boolean(item.isPrimary), item.id || '');
      }
    }
  }

  // Always preserve fallback primary/secondary if not present yet
  if (fallbackPrimary) pushEntry(fallbackPrimary, 'رئيسي', entries.length === 0);
  if (fallbackSecondary) pushEntry(fallbackSecondary, 'إضافي', false);

  if (entries.length > 0 && !entries.some((e) => e.isPrimary)) {
    entries[0].isPrimary = true;
  } else if (entries.filter((e) => e.isPrimary).length > 1) {
    let kept = false;
    for (const e of entries) {
      if (e.isPrimary && !kept) kept = true;
      else e.isPrimary = false;
    }
  }

  // Sort primary phone first for consistent legacy display
  entries.sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));
  return entries;
}

export function mapPgCustomerRow(r) {
  if (!r) return null;
  const rawAllowed = Array.isArray(r.allowed_rep_ids) ? r.allowed_rep_ids.filter(Boolean) : [];
  const mergedAllowed = Array.from(
    new Set([...(r.assigned_rep_id ? [String(r.assigned_rep_id)] : []), ...rawAllowed.map(String)])
  );
  const phones = normalizeCustomerPhonesList(r.phones, r.phone || '', r.secondary_phone || r.phone2 || '');
  const primaryPhone = phones.find((p) => p.isPrimary)?.number || phones[0]?.number || r.phone || '';
  const secondaryEntry = phones.find((p) => !p.isPrimary && p.number !== primaryPhone) || phones[1];
  const resolvedPhoto = r.shop_photo || r.photo || undefined;

  return {
    id: r.id,
    code: r.code,
    identityId: r.identity_id || undefined,
    userId: r.user_id || undefined,
    assignedRepId: r.assigned_rep_id || mergedAllowed[0] || undefined,
    allowedRepIds: mergedAllowed,
    name: r.name,
    phone: primaryPhone,
    secondaryPhone: secondaryEntry?.number || r.secondary_phone || r.phone2 || undefined,
    phones,
    shopName: r.shop_name || undefined,
    shopPhoto: resolvedPhoto,
    photo: resolvedPhoto,
    address: r.address || r.shop_address || '',
    governorate: r.governorate || undefined,
    area: r.area || undefined,
    geoCoordinates: r.geo_coordinates || r.map_location || undefined,
    openingBalance: Number(r.opening_balance || 0),
    currentBalance: Number(r.current_balance || 0),
    priceHistory: r.price_history || {},
    notes: r.notes || '',
    status: r.status || 'active',
    version: Number(r.version || 1),
    updatedAt: r.updated_at ? isoTimestamp(r.updated_at) : isoTimestamp(r.created_at),
    createdAt: isoTimestamp(r.created_at),
  };
}

export function mapPgProductRow(r, units = []) {
  if (!r) return null;
  return {
    id: r.id,
    code: r.code,
    barcode: r.barcode || '',
    name: r.name,
    category: r.category,
    categoryId: r.category_id || undefined,
    baseUnit: r.base_unit,
    units: units.map((u) => ({
      id: u.id,
      name: u.name,
      conversionFactor: Number(u.conversion_factor || 1),
      barcode: u.barcode || '',
      purchasePrice: Number(u.purchase_price ?? 0),
      sellingPrice: Number(u.selling_price ?? 0),
    })),
    size: r.size || undefined,
    color: r.color || undefined,
    purchasePrice: Number(r.purchase_price || 0),
    sellingPrice: Number(r.selling_price || 0),
    minStockLevel: Number(r.min_stock_level || 0),
    stockPerWarehouse: r.stock_per_warehouse || {},
    image: r.image || undefined,
    notes: r.notes || '',
    status: r.status || 'active',
    importBatchId: r.import_batch_id || undefined,
    importedFromFile: Boolean(r.imported_from_file),
    sourceFileName: r.source_file_name || undefined,
    version: Number(r.version || 1),
    updatedAt: r.updated_at ? isoTimestamp(r.updated_at) : isoTimestamp(r.created_at),
    createdAt: isoTimestamp(r.created_at),
  };
}

export function mapPgOrderRow(r, items = [], history = []) {
  if (!r) return null;
  const mappedItems = items.map((it) => {
    const qty = Number(it.quantity || 0);
    const unitPrice =
      it.reference_unit_price !== null && it.reference_unit_price !== undefined
        ? Number(it.reference_unit_price)
        : undefined;
    return {
      productId: it.product_id,
      productCode: it.product_code || '',
      productName: it.product_name,
      productImage: it.product_image || undefined,
      unit: it.unit,
      unitFactor: Number(it.unit_factor || 1),
      quantity: qty,
      unitPrice,
    };
  });
  const computedTotal = mappedItems.reduce(
    (sum, it) => sum + Number(it.unitPrice || 0) * Number(it.quantity || 0),
    0
  );
  const storedTotal = Number(r.total_amount || 0);
  const totalAmount = storedTotal > 0 ? storedTotal : Math.round(computedTotal * 100) / 100;
  const advancePaidAmount = Number(r.advance_paid_amount || 0);
  const remainingAmount =
    r.remaining_amount !== undefined && r.remaining_amount !== null && Number(r.remaining_amount) > 0
      ? Number(r.remaining_amount)
      : Math.max(0, Math.round((totalAmount - advancePaidAmount) * 100) / 100);
  const inferredRequesterType = r.requester_type || (r.representative_id ? 'representative' : 'customer');
  return {
    id: r.id,
    requestNumber: r.request_number,
    customerId: r.customer_id,
    userId: r.user_id || undefined,
    requesterType: inferredRequesterType,
    submittedByName: r.submitted_by_name || r.representative_name || r.customer_name || '',
    representativeId: r.representative_id || undefined,
    representativeName: r.representative_name || undefined,
    deliveryRepId: r.delivery_rep_id || undefined,
    deliveryRepName: r.delivery_rep_name || undefined,
    deliveredAt: r.delivered_at ? isoTimestamp(r.delivered_at) : undefined,
    deliveryNotes: r.delivery_notes || undefined,
    deliveryProof: r.delivery_proof || undefined,
    collectedAmount: Number(r.collected_amount || 0),
    customerName: r.customer_name,
    customerPhone: r.customer_phone || '',
    shopName: r.shop_name || '',
    deliveryAddress: r.delivery_address || '',
    geoCoordinates: r.geo_coordinates || '',
    totalAmount,
    advancePaidAmount,
    remainingAmount,
    status: r.status,
    sourcePlatform: r.source_platform || 'web',
    originDeviceId: r.origin_device_id || undefined,
    syncStatus: r.sync_status || 'synced',
    version: Number(r.version || 1),
    notes: r.notes || '',
    rejectionReason: r.rejection_reason || undefined,
    reviewedBy: r.reviewed_by || undefined,
    reviewedAt: r.reviewed_at ? isoTimestamp(r.reviewed_at) : undefined,
    invoiceId: r.invoice_id || undefined,
    invoiceNumber: r.invoice_number || undefined,
    idempotencyKey: r.idempotency_key || undefined,
    items: mappedItems,
    statusHistory: history.map((h) => ({
      id: h.id,
      fromStatus: h.from_status || null,
      toStatus: h.to_status,
      changedByName: h.changed_by_name,
      reason: h.reason || undefined,
      changedAt: isoTimestamp(h.changed_at),
    })),
    createdAt: isoTimestamp(r.created_at),
    updatedAt: isoTimestamp(r.updated_at),
  };
}

export function mapPgInvoiceRow(r, items = [], payments = []) {
  if (!r) return null;
  return {
    id: r.id,
    invoiceNumber: r.invoice_number,
    type: r.type,
    date: isoDateOnly(r.date),
    customerId: r.customer_id || undefined,
    customerName: r.customer_name || undefined,
    supplierId: r.supplier_id || undefined,
    supplierName: r.supplier_name || undefined,
    representativeId: r.representative_id || undefined,
    representativeName: r.representative_name || undefined,
    isRepPurchase: r.type === 'purchase' && Boolean(r.representative_id || (r.sent_by_user_id && r.dispatch_status)),
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name,
    items: items.map((it) => ({
      productId: it.product_id,
      productName: it.product_name,
      barcode: it.barcode || '',
      unit: it.unit,
      unitFactor: Number(it.unit_factor || 1),
      quantity: Number(it.quantity || 0),
      unitPrice: Number(it.unit_price || 0),
      purchasePriceAtTime: Number(it.purchase_price_at_time || 0),
      discount: Number(it.discount || 0),
      total: Number(it.total || 0),
    })),
    subtotal: Number(r.subtotal || 0),
    discountTotal: Number(r.discount_total || 0),
    taxTotal: Number(r.tax_total || 0),
    grandTotal: Number(r.grand_total || 0),
    paidAmount: Number(r.paid_amount || 0),
    appliedAdvanceAmount: Number(r.applied_advance_amount || 0),
    remainingAmount: Number(r.remaining_amount || 0),
    paymentType: r.payment_type,
    paymentMethod: r.payment_method,
    cashboxId: r.cashbox_id,
    status: r.status,
    notes: r.notes || '',
    payments: payments.map((p) => ({
      id: p.id,
      invoiceId: p.invoice_id,
      invoiceNumber: p.invoice_number,
      amount: Number(p.amount || 0),
      date: isoDateOnly(p.date),
      paymentMethod: p.payment_method,
      cashboxId: p.cashbox_id,
      cashboxName: p.cashbox_name,
      notes: p.notes || '',
      collectionLocation: p.collection_location || (p.acting_role === 'representative' ? 'rep' : undefined),
      createdBy: p.created_by,
      createdByUserId: p.created_by_user_id || undefined,
      actorIdentityId: p.actor_identity_id || undefined,
      actorEmployeeId: p.actor_employee_id || undefined,
      actingRole: p.acting_role || undefined,
      createdAt: isoTimestamp(p.created_at),
    })),
    linkedRepTransferId: r.linked_rep_transfer_id || undefined,
    linkedRepTransferNumber: r.linked_rep_transfer_number || undefined,
    linkedCustomerOrderId: r.linked_customer_order_id || undefined,
    returnedQuantityByItem: r.returned_quantity_by_item || {},
    originDeviceId: r.origin_device_id || undefined,
    syncStatus: r.sync_status || 'synced',
    reviewStatus: r.review_status || 'not_required',
    reviewedBy: r.reviewed_by || undefined,
    reviewedAt: r.reviewed_at ? isoTimestamp(r.reviewed_at) : undefined,
    reviewNotes: r.review_notes || undefined,
    editedBy: r.edited_by || undefined,
    editedAt: r.edited_at ? isoTimestamp(r.edited_at) : undefined,
    editHistory: Array.isArray(r.edit_history) ? r.edit_history : [],
    cancelledBy: r.cancelled_by || undefined,
    cancelledAt: r.cancelled_at ? isoTimestamp(r.cancelled_at) : undefined,
    cancelReason: r.cancel_reason || undefined,
    dispatchStatus:
      r.status === 'confirmed'
        ? 'confirmed'
        : r.dispatch_status || (r.status === 'cancelled' ? 'cancelled' : 'draft'),
    sentBy: r.sent_by || undefined,
    sentByUserId: r.sent_by_user_id || undefined,
    sentAt: r.sent_at ? isoTimestamp(r.sent_at) : undefined,
    recipientUserId: r.recipient_user_id || undefined,
    recipientName: r.recipient_name || undefined,
    receivedBy: r.received_by || undefined,
    receivedByUserId: r.received_by_user_id || undefined,
    receivedAt: r.received_at ? isoTimestamp(r.received_at) : undefined,
    rejectedBy: r.rejected_by || undefined,
    rejectedByUserId: r.rejected_by_user_id || undefined,
    rejectedAt: r.rejected_at ? isoTimestamp(r.rejected_at) : undefined,
    rejectionReason: r.rejection_reason || undefined,
    dispatchHistory: Array.isArray(r.dispatch_history) ? r.dispatch_history : [],
    version: Number(r.version || 1),
    updatedAt: r.updated_at ? isoTimestamp(r.updated_at) : isoTimestamp(r.created_at),
    createdBy: r.created_by,
    createdByUserId: r.created_by_user_id || undefined,
    actorIdentityId: r.actor_identity_id || undefined,
    actorEmployeeId: r.actor_employee_id || undefined,
    actingRole: r.acting_role || undefined,
    createdAt: isoTimestamp(r.created_at),
  };
}

export function mapPgPurchaseReturnRequestRow(r, items = []) {
  if (!r) return null;
  return {
    id: r.id,
    requestNumber: r.request_number,
    date: isoDateOnly(r.date),
    originalInvoiceId: r.original_invoice_id,
    originalInvoiceNumber: r.original_invoice_number,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name || '',
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name || '',
    representativeId: r.representative_id || undefined,
    representativeName: r.representative_name || undefined,
    requestedByUserId: r.requested_by_user_id,
    requestedByName: r.requested_by_name,
    items: items.map((it) => ({
      productId: it.product_id,
      productName: it.product_name,
      unit: it.unit,
      unitFactor: Number(it.unit_factor || 1),
      quantity: Number(it.quantity || 0),
      unitPrice: Number(it.unit_price || 0),
      total: Number(it.total || 0),
    })),
    grandTotal: Number(r.grand_total || 0),
    refundType: r.refund_type === 'cash' ? 'cash' : 'balance',
    cashboxId: r.cashbox_id || undefined,
    reason: r.reason || '',
    notes: r.notes || '',
    status: r.status || 'pending',
    reviewedByUserId: r.reviewed_by_user_id || undefined,
    reviewedByName: r.reviewed_by_name || undefined,
    reviewedAt: r.reviewed_at ? isoTimestamp(r.reviewed_at) : undefined,
    rejectionReason: r.rejection_reason || undefined,
    approvedReturnId: r.approved_return_id || undefined,
    approvedReturnNumber: r.approved_return_number || undefined,
    createdAt: isoTimestamp(r.created_at),
    updatedAt: r.updated_at ? isoTimestamp(r.updated_at) : isoTimestamp(r.created_at),
  };
}

export function mapPgSalesReturnRequestRow(r, items = []) {
  if (!r) return null;
  return {
    id: r.id,
    requestNumber: r.request_number,
    date: isoDateOnly(r.date),
    originalInvoiceId: r.original_invoice_id,
    originalInvoiceNumber: r.original_invoice_number,
    customerId: r.customer_id,
    customerName: r.customer_name || '',
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name || '',
    representativeId: r.representative_id || undefined,
    representativeName: r.representative_name || undefined,
    requestedByUserId: r.requested_by_user_id,
    requestedByName: r.requested_by_name,
    items: items.map((it) => ({
      productId: it.product_id,
      productName: it.product_name,
      unit: it.unit,
      unitFactor: Number(it.unit_factor || 1),
      quantity: Number(it.quantity || 0),
      unitPrice: Number(it.unit_price || 0),
      total: Number(it.total || 0),
    })),
    grandTotal: Number(r.grand_total || 0),
    refundType: r.refund_type === 'cash' ? 'cash' : 'balance',
    cashboxId: r.cashbox_id || undefined,
    reason: r.reason || '',
    notes: r.notes || '',
    status: r.status || 'pending',
    reviewedByUserId: r.reviewed_by_user_id || undefined,
    reviewedByName: r.reviewed_by_name || undefined,
    reviewedAt: r.reviewed_at ? isoTimestamp(r.reviewed_at) : undefined,
    rejectionReason: r.rejection_reason || undefined,
    approvedReturnId: r.approved_return_id || undefined,
    approvedReturnNumber: r.approved_return_number || undefined,
    createdAt: isoTimestamp(r.created_at),
    updatedAt: r.updated_at ? isoTimestamp(r.updated_at) : isoTimestamp(r.created_at),
  };
}


import { getPool, checkPostgresHealth } from '../postgres.js';

let pgActiveCache = null;

export const FULL_ADMIN_PERMISSIONS = {
  canView: true,
  canAdd: true,
  canEdit: true,
  canDelete: true,
  canPrint: true,
  canExport: true,
  canViewReports: true,
  canManageSales: true,
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
};

export function setPgActive(val) {
  pgActiveCache = val === null ? null : Boolean(val);
}

export async function isPgMode() {
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
    permissions: r.permissions || {},
    isSuperAdmin: Boolean(r.permissions?.isSuperAdmin),
    shortcuts: Array.isArray(r.shortcuts) ? r.shortcuts : [],
    createdAt: isoTimestamp(r.created_at),
  };
}

export function mapPgCustomerRow(r) {
  if (!r) return null;
  const rawAllowed = Array.isArray(r.allowed_rep_ids) ? r.allowed_rep_ids.filter(Boolean) : [];
  const mergedAllowed = Array.from(
    new Set([...(r.assigned_rep_id ? [String(r.assigned_rep_id)] : []), ...rawAllowed.map(String)])
  );
  return {
    id: r.id,
    code: r.code,
    userId: r.user_id || undefined,
    assignedRepId: r.assigned_rep_id || mergedAllowed[0] || undefined,
    allowedRepIds: mergedAllowed,
    name: r.name,
    phone: r.phone || '',
    secondaryPhone: r.secondary_phone || r.phone2 || undefined,
    shopName: r.shop_name || undefined,
    shopPhoto: r.shop_photo || undefined,
    photo: r.photo || undefined,
    address: r.address || r.shop_address || '',
    area: r.area || undefined,
    geoCoordinates: r.geo_coordinates || r.map_location || undefined,
    openingBalance: Number(r.opening_balance || 0),
    currentBalance: Number(r.current_balance || 0),
    priceHistory: r.price_history || {},
    notes: r.notes || '',
    status: r.status || 'active',
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
    createdAt: isoTimestamp(r.created_at),
  };
}

export function mapPgOrderRow(r, items = [], history = []) {
  if (!r) return null;
  return {
    id: r.id,
    requestNumber: r.request_number,
    customerId: r.customer_id,
    userId: r.user_id || undefined,
    customerName: r.customer_name,
    customerPhone: r.customer_phone || '',
    shopName: r.shop_name || '',
    deliveryAddress: r.delivery_address || '',
    geoCoordinates: r.geo_coordinates || '',
    status: r.status,
    notes: r.notes || '',
    rejectionReason: r.rejection_reason || undefined,
    reviewedBy: r.reviewed_by || undefined,
    reviewedAt: r.reviewed_at ? isoTimestamp(r.reviewed_at) : undefined,
    invoiceId: r.invoice_id || undefined,
    invoiceNumber: r.invoice_number || undefined,
    idempotencyKey: r.idempotency_key || undefined,
    items: items.map((it) => ({
      productId: it.product_id,
      productCode: it.product_code || '',
      productName: it.product_name,
      unit: it.unit,
      unitFactor: Number(it.unit_factor || 1),
      quantity: Number(it.quantity || 0),
      unitPrice: it.reference_unit_price !== null && it.reference_unit_price !== undefined ? Number(it.reference_unit_price) : undefined,
    })),
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
      createdBy: p.created_by,
      createdAt: isoTimestamp(p.created_at),
    })),
    linkedRepTransferId: r.linked_rep_transfer_id || undefined,
    linkedRepTransferNumber: r.linked_rep_transfer_number || undefined,
    linkedCustomerOrderId: r.linked_customer_order_id || undefined,
    returnedQuantityByItem: r.returned_quantity_by_item || {},
    createdBy: r.created_by,
    createdAt: isoTimestamp(r.created_at),
  };
}

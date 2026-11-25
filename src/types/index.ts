export type UserRole = 
  | 'admin'         // مالك / مسؤول عام
  | 'manager'       // مدير
  | 'accountant'    // محاسب
  | 'sales'         // موظف مبيعات
  | 'warehouse'     // أمين مستودع
  | 'purchases'     // موظف مشتريات
  | 'representative'
  | 'customer';// مندوب مبيعات / عميل

export interface UserPermissions {
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPrint: boolean;
  canExport: boolean;
  canViewReports: boolean;
  canManageSales: boolean;
  canManagePurchases: boolean;
  canCreatePurchase?: boolean;
  canManageInventory: boolean;
  canManageWarehouses: boolean;
  canManageCashboxes: boolean;
  canManageAccounts: boolean;
  canManageReps: boolean;
  canManageTransfers: boolean;
  canManageEmployees: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canAllowNegativeInventory: boolean;
  canApprove?: boolean;
  canSend?: boolean;
  canReceive?: boolean;
  canReviewRepInvoices?: boolean;
  canViewPersonalAccounts?: boolean;
  canCreatePersonalTx?: boolean;
  canEditPersonalTx?: boolean;
  canApprovePersonalAdjustment?: boolean;
  canCreateStockCount?: boolean;
  canApproveStockCount?: boolean;
  canCreateStockTransfer?: boolean;
  canApproveStockTransfer?: boolean;
  canExecuteStockTransfer?: boolean;
  canViewDeletedInvoices?: boolean;
}

export type ShortcutCategory = 'التنقل' | 'المبيعات والمشتريات' | 'المخزون' | 'العملاء والمالية' | 'عام';

export type ShortcutActionId =
  | 'nav:dashboard'
  | 'nav:new-sale'
  | 'nav:sales'
  | 'nav:new-purchase'
  | 'nav:purchases'
  | 'nav:returns'
  | 'nav:purchase-returns'
  | 'nav:deleted-invoices'
  | 'nav:products'
  | 'nav:product-categories'
  | 'nav:units-settings'
  | 'nav:abu-selim-import'
  | 'nav:warehouses'
  | 'nav:stock-transfers'
  | 'nav:stock-transfers-fast'
  | 'nav:stock-count'
  | 'nav:stock-adjustments'
  | 'nav:damaged-stock'
  | 'nav:stock-movements'
  | 'nav:customers'
  | 'nav:suppliers'
  | 'nav:cashboxes'
  | 'nav:cashbox-transfer'
  | 'nav:expenses'
  | 'nav:personal-accounts'
  | 'nav:cheques'
  | 'nav:installments'
  | 'nav:reps'
  | 'nav:rep-transfers'
  | 'nav:rep-item-transfers'
  | 'nav:employees'
  | 'nav:reports'
  | 'nav:users'
  | 'nav:audit-log'
  | 'nav:settings'
  | 'nav:server-settings'
  | 'nav:backup'
  | 'nav:migration'
  | 'nav:shortcuts-settings'
  | 'nav:storefront-manager'
  | 'action:save_invoice'
  | 'action:print_document'
  | 'action:focus_product_search'
  | 'action:new_customer'
  | 'action:customer_collection'
  | 'action:add_product'
  | 'action:add_supplier'
  | 'action:add_expense'
  | 'action:cash_deposit'
  | 'action:cash_withdrawal'
  | 'action:new_stock_transfer';

export interface UserShortcutItem {
  id: string;
  actionId: ShortcutActionId | string;
  label: string;
  category: ShortcutCategory | string;
  keyCombo: string;
  enabled: boolean;
}

export type IdentityEntityType =
  | 'user'
  | 'employee'
  | 'customer'
  | 'representative'
  | 'supplier';

export interface IdentityRoleLink {
  id: string;
  identityId: string;
  roleKey: string;
  linkedRecordType: IdentityEntityType | string;
  linkedRecordId: string;
  isPrimary?: boolean;
  status?: 'active' | 'inactive' | string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UnifiedIdentity {
  id: string;
  fullName: string;
  phone?: string;
  normalizedPhone?: string;
  nationalId?: string;
  commercialReg?: string;
  address?: string;
  status?: 'active' | 'inactive' | string;
  notes?: string;
  roles?: IdentityRoleLink[];
  createdAt?: string;
  updatedAt?: string;
}

export interface IdentityConflictCandidate {
  recordType: IdentityEntityType | string;
  recordId: string;
  name?: string;
  phone?: string;
  identityId?: string;
  username?: string;
}

export interface IdentityConflict {
  id: string;
  conflictType: string;
  severity?: 'info' | 'warning' | 'critical' | string;
  identifierKey?: string;
  candidateRecords: IdentityConflictCandidate[];
  status: 'pending_review' | 'resolved' | 'dismissed' | string;
  resolutionNotes?: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt?: string;
}

export interface User {
  id: string;
  fullName: string;
  username: string;
  passwordHash: string;
  phone: string;
  role: UserRole;
  jobTitle: string;
  department: string;
  address?: string;
  notes?: string;
  identityId?: string;
  employeeId?: string;
  activeRole?: UserRole | string;
  additionalRoles?: string[];
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLogin?: string;
  permissions: UserPermissions;
  shortcuts?: UserShortcutItem[];
  createdAt: string;
}

export interface ProductUnit {
  id: string;
  name: string;        // مثلا: كرتونة، باكت، قطعة، كيلو
  conversionFactor: number; // كم تحتوي من الوحدة الصغرى الأساسية
  sellingPrice: number;
  purchasePrice: number;
  barcode?: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface Product {
  id: string;
  code: string;
  barcode: string;
  name: string;
  category: string;
  categoryId?: string;
  baseUnit: string;     // الوحدة الصغرى الأساسية: قطعة، كيس، كيلو
  units: ProductUnit[]; // وحدات القياس الإضافية
  size?: string;        // المقاس عند الحاجة
  color?: string;       // اللون عند الحاجة
  class1?: string;      // التصنيف 1 عند الحاجة
  purchasePrice: number;
  sellingPrice: number;
  minStockLevel: number;
  stockPerWarehouse: Record<string, number>; // warehouseId -> quantity in base unit
  inStock?: boolean;
  availableQty?: number;
  status: 'active' | 'archived'; // active = نشط، archived = موقوف منطقياً
  notes?: string;
  importBatchId?: string;
  importedFromFile?: boolean;
  sourceFileName?: string;
  version?: number;
  updatedAt?: string;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  location: string;
  managerName?: string;
  phone?: string;
  isDefault: boolean;
  status?: 'active' | 'suspended'; // إيقاف المستودع وفق الصلاحيات
}

export interface CustomerPhoneEntry {
  id: string;
  phone: string;
  number?: string;
  label?: string;
  isPrimary?: boolean;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string;
  phones?: CustomerPhoneEntry[];
  identityId?: string;
  userId?: string; // حساب الدخول المرتبط بالعميل
  assignedRepId?: string;
  assignedRep?: {
    id: string;
    name: string;
    phone?: string;
  } | null;
  allowedRepIds?: string[];
  secondaryPhone?: string; // رقم هاتف إضافي
  shopName?: string;       // اسم المحل
  shopPhoto?: string;      // صورة المحل
  clearShopPhoto?: boolean;
  governorate?: string;    // المحافظة
  area?: string;           // المنطقة
  city?: string;           // المدينة
  geoCoordinates?: string; // الموقع الجغرافي / إحداثيات GPS أو رابط خرائط
  latitude?: number;
  longitude?: number;
  locationCapturedAt?: string;
  favoriteProductIds?: string[];
  address: string;
  photo?: string;
  notes?: string;
  openingBalance: number; // موجب = عليه دين للشركة، سالب = له رصيد دائن
  currentBalance: number;
  status: 'active' | 'blocked';
  // التاريخ الفعلي لأسعار الشراء السابقة لكل منتج: productId -> prices array [oldest to newest]
  priceHistory: Record<string, Array<number | CustomerPriceHistoryEntry>>;
  syncStatus?: SyncQueueStatus | 'synced';
  originDeviceId?: string;
  version?: number;
  updatedAt?: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  companyName?: string;
  phone: string;
  address: string;
  identityId?: string;
  userId?: string;
  notes?: string;
  openingBalance: number; // موجب = له مستحقات علينا، سالب = دفع زيادة
  currentBalance: number;
  status?: 'active' | 'suspended'; // حالة المورد: نشط / موقوف
  syncStatus?: SyncQueueStatus | 'synced';
  createdAt: string;
}

export interface InlinePurchaseNewProduct {
  name: string;
  barcode?: string;
  code?: string;
  category?: string;
  baseUnit?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  minStockLevel?: number;
}

export interface InvoiceItem {
  productId: string;
  productName: string;
  barcode: string;
  unit: string;
  unitFactor: number;
  quantity: number;
  unitPrice: number;
  purchasePriceAtTime: number;
  discount: number; // خصم بالجنيه لكل بند
  total: number;
  newProduct?: InlinePurchaseNewProduct;
}

export interface InvoicePayment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  date: string;
  paymentMethod: 'cash' | 'bank' | 'cheque';
  cashboxId: string;
  cashboxName: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface InvoiceEditHistoryEntry {
  editedBy: string;
  editedByUserId?: string;
  editedAt: string;
  reason?: string;
  before?: {
    date?: string;
    grandTotal?: number;
    discountTotal?: number;
    itemsCount?: number;
  };
  after?: {
    date?: string;
    grandTotal?: number;
    discountTotal?: number;
    itemsCount?: number;
  };
}

export type InvoiceDispatchStatus = 'draft' | 'sent' | 'received' | 'rejected' | 'confirmed';

export interface InvoiceDispatchHistoryEntry {
  id?: string;
  action: 'created' | 'sent' | 'resent' | 'received' | 'rejected' | 'confirmed' | 'edited';
  by: string;
  byUserId?: string;
  at: string;
  recipientUserId?: string;
  recipientName?: string;
  reason?: string;
  notes?: string;
}

export interface PurchaseReceiverOption {
  id: string;
  fullName: string;
  role: UserRole | string;
  jobTitle?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: 'sales' | 'purchase' | 'quote';
  date: string;
  customerId?: string;
  customerName?: string;
  supplierId?: string;
  supplierName?: string;
  representativeId?: string;
  representativeName?: string;
  warehouseId: string;
  warehouseName: string;
  items: InvoiceItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  paidAmount: number;
  paidAtInvoice?: number;
  appliedAdvanceAmount?: number;
  remainingAmount: number;
  paymentType: 'cash' | 'credit' | 'partial';
  paymentMethod: 'cash' | 'bank' | 'cheque';
  cashboxId: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  isRepPurchase?: boolean;
  dispatchStatus?: InvoiceDispatchStatus;
  sentBy?: string;
  sentByUserId?: string;
  sentAt?: string;
  recipientUserId?: string;
  recipientName?: string;
  receivedBy?: string;
  receivedByUserId?: string;
  receivedAt?: string;
  rejectedBy?: string;
  rejectedByUserId?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  dispatchHistory?: InvoiceDispatchHistoryEntry[];
  reviewStatus?: 'not_required' | 'needs_review' | 'reviewed';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  editedBy?: string;
  editedAt?: string;
  editHistory?: InvoiceEditHistoryEntry[];
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
  convertedFromQuoteId?: string;
  convertedFromQuoteNumber?: string;
  notes?: string;
  payments?: InvoicePayment[]; // دفعات متعددة مسجلة على نفس الفاتورة
  linkedRepTransferId?: string; // معرف طلب تحويل عهدة المندوب المرتبط
  linkedRepTransferNumber?: string; // رقم طلب تحويل عهدة المندوب المرتبط
  linkedCustomerOrderId?: string; // معرف طلب العميل المرتبط (1:1)
  localId?: string;
  operationId?: string;
  originDeviceId?: string;
  syncStatus?: SyncQueueStatus | 'synced';
  version?: number;
  updatedAt?: string;
  createdBy: string;
  createdByUserId?: string;
  createdByName?: string;
  actorIdentityId?: string;
  actorEmployeeId?: string;
  actingRole?: string;
  createdAt: string;
  returnedQuantityByItem?: Record<string, number>;
}

export interface InvoiceReturnItem {
  productId: string;
  productName: string;
  unit: string;
  unitFactor?: number;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceReturn {
  id: string;
  returnNumber: string;
  type: 'sales_return' | 'purchase_return';
  originalInvoiceId: string;
  originalInvoiceNumber: string;
  date: string;
  partyId: string; // customerId or supplierId
  partyName: string;
  warehouseId: string;
  warehouseName: string;
  items: InvoiceReturnItem[];
  grandTotal: number;
  refundType: 'cash' | 'balance';
  cashboxId?: string;
  reason: string;
  notes?: string;
  syncStatus?: SyncQueueStatus | 'synced';
  originDeviceId?: string;
  createdBy: string;
  createdByUserId?: string;
  createdAt: string;
}

export interface PurchaseReturnRequestItem {
  productId: string;
  productName: string;
  unit: string;
  unitFactor?: number;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PurchaseReturnRequest {
  id: string;
  requestNumber: string;
  date: string;
  originalInvoiceId: string;
  originalInvoiceNumber: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  representativeId?: string;
  representativeName?: string;
  requestedByUserId: string;
  requestedByName: string;
  items: PurchaseReturnRequestItem[];
  grandTotal: number;
  refundType: 'balance' | 'cash';
  cashboxId?: string;
  reason: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  approvedReturnId?: string;
  approvedReturnNumber?: string;
  syncStatus?: SyncQueueStatus | 'synced';
  createdAt: string;
  updatedAt?: string;
}

export interface SalesReturnRequestItem {
  productId: string;
  productName: string;
  unit: string;
  unitFactor?: number;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface SalesReturnRequest {
  id: string;
  requestNumber: string;
  date: string;
  originalInvoiceId: string;
  originalInvoiceNumber: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  representativeId?: string;
  representativeName?: string;
  requestedByUserId: string;
  requestedByName: string;
  items: SalesReturnRequestItem[];
  grandTotal: number;
  refundType: 'cash' | 'balance';
  cashboxId?: string;
  reason: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  approvedReturnId?: string;
  approvedReturnNumber?: string;
  syncStatus?: SyncQueueStatus | 'synced';
  createdAt: string;
  updatedAt?: string;
}

export interface Cashbox {
  id: string;
  name: string;
  type: 'cashbox' | 'bank';
  accountNumber?: string;
  openingBalance?: number;
  currentBalance?: number;
  balanceHidden?: boolean;
  isDefault: boolean;
}

export type FinancialTransactionType =
  | 'income'             // إيراد / سند قبض
  | 'expense'            // مصروف / سند صرف
  | 'deposit'            // إيداع بنكي
  | 'withdrawal'         // سحب
  | 'transfer'           // تحويل بين الخزائن
  | 'customer_payment'   // تحصيل من عميل
  | 'supplier_payment'   // سداد لمورد
  | 'salary_payout'      // صرف راتب
  | 'rep_transfer';      // تحويل مندوب معتمد

export interface FinancialTransaction {
  id: string;
  transactionNumber: string;
  date: string;
  type: FinancialTransactionType;
  cashboxId: string;
  cashboxName: string;
  targetCashboxId?: string;
  targetCashboxName?: string;
  amount: number;
  category: string;
  relatedDocType?: 'sales' | 'purchase' | 'sales_return' | 'purchase_return' | 'rep_transfer' | 'salary' | 'manual' | 'order_advance';
  relatedDocId?: string;
  relatedDocNumber?: string;
  partyId?: string;
  partyName?: string;
  paymentMethod?: 'cash' | 'bank' | 'cheque';
  description: string;
  notes?: string;
  syncStatus?: SyncQueueStatus | 'synced';
  createdBy: string;
  createdByUserId?: string;
  createdAt: string;
}

export type ChequeStatus = 'new' | 'pending' | 'collected' | 'rejected' | 'returned';

export interface Cheque {
  id: string;
  chequeNumber: string;
  type: 'incoming' | 'outgoing';
  bankName: string;
  amount: number;
  issueDate: string;
  dueDate: string;
  partyId?: string;
  partyName: string;
  relatedDocNumber?: string;
  status: ChequeStatus;
  cashboxId?: string;
  notes?: string;
  collectedDate?: string;
  createdAt: string;
}

export interface InstallmentItem {
  id: string;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  paidAmount: number;
  status: 'pending' | 'paid' | 'overdue';
  paidDate?: string;
  notes?: string;
}

export interface InstallmentSchedule {
  id: string;
  scheduleNumber: string;
  customerId: string;
  customerName: string;
  invoiceId?: string;
  invoiceNumber?: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  items: InstallmentItem[];
  notes?: string;
  createdAt: string;
}

export interface Representative {
  id: string;
  name: string;
  phone: string;
  vehicleNumber?: string;
  identityId?: string;
  userId?: string; // حساب الدخول المرتبط
  employeeId?: string;
  warehouseId?: string;
  openingBalance?: number;
  currentBalance?: number;
  balanceHidden?: boolean;
  commissionRate?: number;
  notes?: string;
  status: 'active' | 'inactive';
}

export type RepTransferStatus = 
  | 'new'               // جديد
  | 'awaiting_receipt'  // قيد الاستلام
  | 'received'          // تم الاستلام
  | 'rejected'          // مرفوض
  | 'cancelled';        // ملغى

export interface RepTransfer {
  id: string;
  transferNumber: string; // ترقيم تسلسلي فريد
  date: string;
  timestamp: string;
  direction: 'owner_to_rep' | 'rep_to_owner'; // اتجاه التحويل
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
  amount: number;
  cashboxId: string; // الخزينة المتأثرة للفرع
  cashboxName: string;
  notes?: string;
  status: RepTransferStatus;
  sentAt: string;
  confirmedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  confirmedBy?: string;
  auditTrail: Array<{
    timestamp: string;
    action: string;
    user: string;
    note?: string;
  }>;
}

export interface Employee {
  id: string;
  code: string;
  name: string;
  phone: string;
  jobTitle: string;
  department: string;
  nationalId?: string;
  identityId?: string;
  userId?: string;
  basicSalary: number;
  hireDate: string;
  status: 'active' | 'suspended';
  notes?: string;
}

export interface ExpenseIncomeRecord {
  id: string;
  recordNumber: string;
  type: 'expense' | 'income';
  category: string;
  amount: number;
  date: string;
  cashboxId: string;
  cashboxName: string;
  paymentMethod: string;
  recipientOrPayer: string;
  notes?: string;
  attachmentName?: string;
  syncStatus?: SyncQueueStatus | 'synced';
  createdBy: string;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  date: string;
  type: 'opening' | 'purchase' | 'sale' | 'sale_return' | 'purchase_return' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'damaged';
  productId: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  targetWarehouseId?: string;
  targetWarehouseName?: string;
  quantity: number; // in base unit
  unitCost: number;
  referenceId?: string;
  referenceNumber?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  module: string;
  recordId?: string;
  details: string;
}

export type NetworkSyncStatus = 'connected' | 'disconnected' | 'synchronizing' | 'pending' | 'error';

export interface BranchSettingItem {
  id: string;
  name: string;
  code: string;
  branchNumber?: string;
  phone?: string;
  address?: string;
  warehouseId?: string;
  cashboxId?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface UnitCatalogItem {
  id: string;
  name: string;
  shortCode?: string;
  defaultConversionFactor: number;
  notes?: string;
}

export interface PrinterSettingItem {
  id: string;
  name: string;
  role: 'a4' | 'cashier_thermal80' | 'cashier_thermal58' | 'barcode_label';
  paperWidthMm: number;
  ipOrPort: string;
  copies: number;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface ExtraSettingsConfig {
  branches?: BranchSettingItem[];
  unitsCatalog?: UnitCatalogItem[];
  barcodeConfig?: {
    labelWidthMm: number;
    labelHeightMm: number;
    showCompanyName: boolean;
    showProductCode: boolean;
    showPrice: boolean;
    prefix: string;
  };
  printers?: PrinterSettingItem[];
  invoiceTemplate?: {
    showLogo: boolean;
    showPreviousBalance: boolean;
    showRemainingBalance: boolean;
    showSignatureBoxes: boolean;
    footerText: string;
  };
  mobileConfig?: {
    enableCustomerApp: boolean;
    enableRepApp: boolean;
    allowCustomerPriceView: boolean;
    requireOrderApproval: boolean;
  };
  onlineSyncConfig?: {
    autoSyncEnabled: boolean;
    syncIntervalSeconds: number;
    cloudEndpointUrl?: string;
  };
  shortcuts?: Array<{ keyCombo: string; actionLabel: string; targetPage: string }>;
  servicesConfig?: {
    enableBarcodeScanner: boolean;
    enableAutoBackup: boolean;
    enableWhatsAppAlerts: boolean;
    whatsappNumber?: string;
  };
  connectionConfig?: ConnectionProfilesConfig;
  roleDefaultPermissions?: RoleDefaultPermissionPresets;
  storefrontDraft?: StorefrontConfig;
  storefrontPublished?: StorefrontConfig;
}

export type ThemePreference = 'light' | 'dark' | 'system';
export type LanguagePreference = 'ar' | 'en';
export type StorefrontTargetType = 'product' | 'category' | 'offers' | 'internal_page' | 'none';

export interface StorefrontBanner {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl: string;
  targetType: StorefrontTargetType;
  targetId?: string;
  sortOrder: number;
  isActive: boolean;
  startsAt?: string;
  endsAt?: string;
}

export interface StorefrontShortcut {
  id: string;
  label: string;
  iconKey: string;
  targetType: StorefrontTargetType;
  targetId?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface StorefrontOffer {
  id: string;
  title: string;
  productId: string;
  unit?: string;
  promoPrice: number;
  badgeText?: string;
  startsAt?: string;
  endsAt?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface StorefrontImageCategorySetting {
  categoryId: string;
  displayName?: string;
  imageUrl?: string;
  sortOrder: number;
  isVisible: boolean;
}

export interface StorefrontDisplayCategory {
  id: string;
  name: string;
  imageUrl?: string;
  productIds: string[];
  sortOrder: number;
  isActive: boolean;
}

export interface StorefrontSectionConfig {
  key: 'banners' | 'shortcuts' | 'offers' | 'categories' | 'featured' | string;
  title: string;
  isVisible: boolean;
  sortOrder: number;
}

export interface StorefrontConfig {
  version: number;
  status: 'draft' | 'published';
  updatedAt?: string;
  updatedBy?: string;
  publishedAt?: string;
  publishedBy?: string;
  offersSectionTitle?: string;
  categoriesSectionTitle?: string;
  featuredSectionTitle?: string;
  banners: StorefrontBanner[];
  shortcuts: StorefrontShortcut[];
  offers: StorefrontOffer[];
  imageCategorySettings: StorefrontImageCategorySetting[];
  displayCategories: StorefrontDisplayCategory[];
  featuredProductIds: string[];
  hiddenProductIds: string[];
  sections: StorefrontSectionConfig[];
}

export interface RoleDefaultPermissionPresets {
  representative: Partial<UserPermissions>;
  customer: Partial<UserPermissions>;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SystemSettings {
  companyName: string;
  companySubtitle: string;
  branchNumber?: string;
  phone1: string;
  phone2: string;
  address: string;
  commercialRegistration: string;
  taxNumber: string;
  currency: string;
  defaultPrintMode: 'a4' | 'thermal80' | 'thermal58';
  invoiceNotes: string;
  allowNegativeStock: boolean;
  extraSettings?: ExtraSettingsConfig;
}

// طلب تحويل أصناف عهدة مرتبط بفاتورة مبيعات للمندوب
export interface RepTransferItem {
  productId: string;
  productName: string;
  barcode?: string;
  unit: string;
  requestedQty: number;
  availableInVanQty: number;
  shortageQty: number;
  approvedQty?: number;
  executedQty?: number;
}

export type RepItemTransferStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'received' | 'cancelled';

export interface RepItemTransferRequest {
  id: string;
  requestNumber: string;
  date: string;
  representativeId: string;
  representativeName: string;
  invoiceId?: string; // معرف الفاتورة الأصلية المرتبطة
  invoiceNumber?: string;
  sourceWarehouseId: string; // المستودع الرئيسي المصدر
  sourceWarehouseName: string;
  targetWarehouseId: string; // مستودع سيارة المندوب
  targetWarehouseName: string;
  items: RepTransferItem[];
  status: RepItemTransferStatus;
  transferMode?: 'transfer' | 'custody_dispatch';
  rejectionReason?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  dispatchedBy?: string;
  dispatchedAt?: string;
  executedAt?: string;
  receivedBy?: string;
  receivedAt?: string;
}

export interface RepCustodyOperation {
  id: string;
  operationNumber: string;
  representativeId: string;
  representativeName: string;
  warehouseId: string;
  warehouseName: string;
  targetWarehouseId?: string;
  targetWarehouseName?: string;
  operationType:
    | 'delivered_to_customer'
    | 'returned_to_warehouse'
    | 'custody_damaged'
    | 'custody_shortage'
    | 'custody_adjustment';
  productId: string;
  productName: string;
  unit: string;
  unitFactor: number;
  quantity: number;
  baseQuantity: number;
  customerId?: string;
  customerName?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  date: string;
  reason?: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdBy: string;
  createdAt: string;
}

export interface RepCustodyStatementItem {
  productId: string;
  productName: string;
  productCode: string;
  baseUnit: string;
  purchasePrice: number;
  sellingPrice: number;
  receivedQty: number;
  pendingReceiveQty: number;
  deliveredToCustomersQty: number;
  invoicedSoldQty: number;
  returnedToWarehouseQty: number;
  approvedReductionsQty: number;
  vanPhysicalStockQty: number;
  remainingCustodyQty: number;
  custodyValueAtCost: number;
}

export interface RepCustodyStatementResponse {
  representative: Representative;
  vanWarehouseId: string;
  financialSummary: {
    currentCashCustodyBalance: number;
    totalSalesAmount: number;
    totalSalesPaidAmount: number;
    totalSalesRemainingAmount: number;
  };
  totals: {
    totalReceivedQty: number;
    totalPendingReceiveQty: number;
    totalDeliveredQty: number;
    totalReturnedQty: number;
    totalReductionsQty: number;
    totalRemainingCustodyQty: number;
    totalVanPhysicalQty: number;
    totalCustodyCostValue: number;
  };
  itemsSummary: RepCustodyStatementItem[];
  ledger: Array<{
    id: string;
    date: string;
    createdAt: string;
    docType: string;
    docNumber: string;
    productId: string;
    productName: string;
    customerName?: string;
    quantityIn: number;
    quantityOut: number;
    notes?: string;
  }>;
}

export type CustomerItemOrderStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'preparing'
  | 'rep_assigned'
  | 'out_for_delivery'
  | 'delivered'
  | 'collected'
  | 'closed'
  | 'needs_review'
  | 'invoiced'
  | 'cancelled';

export interface CustomerOrderStatusHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedByName: string;
  reason?: string;
  changedAt: string;
}

export interface CustomerOrderPaymentHistoryEntry {
  id: string;
  source: 'advance' | 'invoice_payment';
  paymentNumber: string;
  amount: number;
  paymentMethod: string;
  cashboxName?: string;
  date: string;
  createdAt: string;
  notes?: string;
}

export interface OrderAdvancePayment {
  id: string;
  paymentNumber: string;
  orderId: string;
  orderNumber?: string;
  customerId: string;
  customerName?: string;
  cashboxId: string;
  cashboxName?: string;
  paymentMethod: 'cash' | 'bank' | 'cheque';
  amount: number;
  date: string;
  notes?: string;
  status: 'active' | 'applied' | 'refunded';
  appliedInvoiceId?: string;
  createdBy: string;
  createdAt: string;
  operationId?: string;
  originDeviceId?: string;
  syncStatus?: SyncQueueStatus;
}

export interface CustomerItemOrderRequest {
  id: string;
  requestNumber: string;
  requesterType?: 'customer' | 'representative' | 'staff';
  submittedByName?: string;
  representativeId?: string;
  representativeName?: string;
  deliveryRepId?: string;
  deliveryRepName?: string;
  deliveredAt?: string;
  deliveryNotes?: string;
  deliveryProof?: string;
  collectedAmount?: number;
  customerId: string;
  userId?: string;
  customerName: string;
  customerPhone?: string;
  shopName?: string;
  deliveryAddress?: string;
  geoCoordinates?: string;
  items: Array<{
    productId: string;
    productCode?: string;
    productName: string;
    unit: string;
    unitFactor?: number;
    quantity: number;
    unitPrice?: number;
  }>;
  totalAmount?: number;
  totalEstimatedAmount?: number;
  advancePaidAmount?: number;
  remainingAmount?: number;
  invoiceTotal?: number;
  invoicePaidAmount?: number;
  invoiceRemainingAmount?: number;
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
  paymentsHistory?: CustomerOrderPaymentHistoryEntry[];
  status: CustomerItemOrderStatus;
  sourcePlatform?: string;
  localId?: string;
  operationId?: string;
  originDeviceId?: string;
  syncStatus?: SyncQueueStatus;
  version?: number;
  notes?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  idempotencyKey?: string;
  statusHistory?: CustomerOrderStatusHistoryEntry[];
}

// أوضاع الاتصال المتعددة بالسيرفر المركزي (Dual / Multi Connection System)
export type ConnectionMode = 'local_network' | 'free_remote' | 'pro_remote' | 'cloud_vps';

export interface ConnectionProfilesConfig {
  activeMode: ConnectionMode;
  configVersion?: number;
  localNetwork: {
    ip: string;
    port: number;
    hostname?: string;
  };
  freeRemote: {
    tunnelUrl: string; // Cloudflare Quick Tunnel (https://xxxx.trycloudflare.com)
    autoDetect?: boolean;
  };
  proRemote: {
    domainUrl: string; // Cloudflare Named Tunnel / Custom HTTPS Domain
    provider?: string;
  };
  cloudVps: {
    vpsUrl: string; // Future Cloud VPS HTTPS Endpoint
    notes?: string;
  };
  enforceHttpsForRemote?: boolean;
  updatedAt?: string;
}

export type DevicePlatform = 'windows' | 'android' | 'ios' | 'web';

export interface TunnelRuntimeStatus {
  status: 'offline' | 'starting' | 'online' | 'error';
  provider: string;
  tunnelUrl: string;
  localPort: number;
  startedAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
}

export interface PairedDevice {
  deviceId: string;
  deviceName: string;
  deviceType: DevicePlatform;
  osVersion?: string;
  appVersion?: string;
  linkedUserId?: string;
  linkedUserName?: string;
  connectionMode: ConnectionMode | string;
  serverUrlUsed?: string;
  ipAddress?: string;
  status: 'active' | 'pending_approval' | 'revoked';
  pairingTokenId?: string;
  configVersion?: number;
  pairedAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  isRecentlyOnline?: boolean;
  notes?: string;
}

export interface PairedDevicesSummary {
  total: number;
  active: number;
  pendingApproval: number;
  revoked: number;
  onlineNow: number;
}

export interface PairingTokenRecord {
  id: string;
  tokenPreview: string;
  createdByUserId?: string;
  createdByName: string;
  targetUserId?: string;
  targetUserName?: string;
  targetRole?: string;
  targetDeviceType: 'any' | 'windows' | 'android' | 'ios';
  connectionMode: ConnectionMode | 'auto';
  expiresAt: string;
  singleUse: boolean;
  usedCount: number;
  lastUsedAt?: string;
  requireAdminApproval: boolean;
  revokedAt?: string;
  status: 'active' | 'used' | 'expired' | 'revoked' | 'invalid';
  notes?: string;
  createdAt: string;
}

export interface PairingCreateResponse {
  ok: boolean;
  tokenRecord: PairingTokenRecord;
  rawToken: string;
  serverBaseUrl: string;
  directInviteUrl: string;
  deepLinkUrl: string;
  qrPayload: string;
}

export interface ConnectionDiscoveryResponse {
  ok: boolean;
  service: string;
  version: string;
  timestamp: string;
  companyName: string;
  activeMode: ConnectionMode;
  configVersion: number;
  supportedModes: ConnectionMode[];
  port: number;
  httpsActive: boolean;
  activeEndpoint: string;
  currentHostUrl?: string;
  lanUrls: string[];
  profiles: ConnectionProfilesConfig;
  fallbackEndpoints: Array<{ mode: ConnectionMode; url: string; label: string }>;
  tunnelStatus?: TunnelRuntimeStatus;
}

// إعدادات السيرفر والاتصال المحلي والشبكة
export interface ServerConnectionSettings {
  serverIp: string;
  hostname: string;
  port: number;
  apiBaseUrl: string;
  connectionType: ConnectionMode | 'lan' | 'vpn' | 'reverse_proxy' | 'offline_local';
  activeMode?: ConnectionMode;
  profiles?: ConnectionProfilesConfig;
  serverStatus: 'online' | 'offline' | 'checking';
  databaseStatus: 'connected' | 'disconnected' | 'migrating';
  latencyMs: number;
  syncStatus: NetworkSyncStatus;
  lastSuccessfulConnection?: string;
}

// استيراد ملفات أصناف أبو سليم
export interface ProductImportCandidate {
  id: string;
  code: string;
  name: string;
  category: string;
  baseUnit: string;
  sourceFile: string;
  isDuplicateCode: boolean;
  isDuplicateName: boolean;
  isValid: boolean;
  status: 'pending' | 'imported' | 'skipped';
  sellingPrice?: number;
  oldPrice?: number;
  description?: string;
}

// سجل الترحيل وتدقيق نقل البيانات (Migration Log)
export interface MigrationLogEntry {
  id: string;
  timestamp: string;
  version: string;
  action: string;
  source: string;
  destination: string;
  status: 'pending' | 'success' | 'failed' | 'rolled_back';
  totalRecords: number;
  migratedRecords: number;
  failedRecords: number;
  details: {
    users?: number;
    customers?: number;
    suppliers?: number;
    products?: number;
    warehouses?: number;
    invoices?: number;
    payments?: number;
    cashboxes?: number;
    financialTransactions?: number;
    repTransfers?: number;
    repItemTransfers?: number;
    ownerAccounts?: number;
    stockCounts?: number;
    stockTransfers?: number;
    auditLogs?: number;
    settings?: number;
    errors?: string[];
  };
  executedBy: string;
  notes?: string;
}

// ==============================================================================
// v4 Comprehensive ERP Extensions
// ==============================================================================

export type CashOperationType =
  | 'cash_withdrawal'
  | 'cash_deposit'
  | 'cashbox_transfer'
  | 'expense'
  | 'profit_deposit';

export interface CashOperationPayload {
  type: CashOperationType;
  cashboxId: string;
  targetCashboxId?: string;
  amount: number;
  date?: string;
  category?: string;
  recipientOrPayer?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface OwnerPersonalAccount {
  id: string;
  ownerName: string;
  accountName: string;
  description?: string;
  openingBalance: number;
  currentBalance: number;
  status: 'active' | 'suspended';
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export type OwnerPersonalTransactionType =
  | 'opening_balance'
  | 'personal_deposit'
  | 'personal_withdrawal'
  | 'personal_expense'
  | 'adjustment';

export interface OwnerPersonalTransaction {
  id: string;
  txNumber: string;
  accountId: string;
  accountName: string;
  ownerName: string;
  type: OwnerPersonalTransactionType;
  amount: number;
  date: string;
  cashboxId?: string;
  cashboxName?: string;
  balanceBefore: number;
  balanceAfter: number;
  notes?: string;
  reason?: string;
  status: string;
  idempotencyKey?: string;
  createdByUserId?: string;
  createdBy: string;
  editedBy?: string;
  editedAt?: string;
  createdAt: string;
}

export type StockCountStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface StockCountItem {
  id: string;
  productId: string;
  productCode?: string;
  productBarcode?: string;
  productName: string;
  unit: string;
  systemQty: number;
  actualQty: number;
  varianceQty: number;
  varianceType: 'matched' | 'shortage' | 'surplus';
  liveQtyAtApproval?: number;
  reason?: string;
}

export interface StockCountSession {
  id: string;
  countNumber: string;
  date: string;
  warehouseId: string;
  warehouseName: string;
  status: StockCountStatus;
  notes?: string;
  rejectionReason?: string;
  counterUserId?: string;
  counterName: string;
  submittedAt?: string;
  approvedByUserId?: string;
  approvedByName?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt?: string;
  items: StockCountItem[];
}

export type StockTransferRequestStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'executed';

export interface StockTransferRequestItem {
  id: string;
  productId: string;
  productCode?: string;
  productBarcode?: string;
  productName: string;
  unit: string;
  unitFactor: number;
  requestedQty: number;
  availableQtySnapshot: number;
  executedQty?: number;
  notes?: string;
}

export interface StockTransferRequest {
  id: string;
  transferNumber: string;
  date: string;
  sourceWarehouseId: string;
  sourceWarehouseName: string;
  targetWarehouseId: string;
  targetWarehouseName: string;
  transferType: string;
  status: StockTransferRequestStatus;
  reason?: string;
  notes?: string;
  rejectionReason?: string;
  createdByUserId?: string;
  createdBy: string;
  submittedAt?: string;
  approvedByUserId?: string;
  approvedBy?: string;
  approvedAt?: string;
  executedByUserId?: string;
  executedBy?: string;
  executedAt?: string;
  createdAt: string;
  updatedAt?: string;
  items: StockTransferRequestItem[];
}

export interface CustomerPriceHistoryEntry {
  price: number;
  date: string;
  invoiceNumber?: string;
  unit?: string;
  quantity?: number;
  unitFactor?: number;
}

export interface MobileConfig {
  enableCustomerApp: boolean;
  enableRepApp: boolean;
  allowCustomerPriceView: boolean;
  requireOrderApproval: boolean;
}

export interface MobileNotificationItem {
  id: string;
  type:
    | 'customer_order'
    | 'order_under_review'
    | 'order_approved'
    | 'order_rejected'
    | 'order_invoiced'
    | 'order_status'
    | 'invoice_confirmed'
    | 'rep_invoice_review'
    | 'custody_dispatch'
    | 'item_transfer'
    | 'cash_transfer'
    | 'invoice'
    | 'balance'
    | 'draft_ready'
    | 'stock_count'
    | 'stock_transfer'
    | 'low_stock'
    | 'rep_item_transfer_executed'
    | 'rep_item_transfer_rejected'
    | 'rep_cash_awaiting_receipt'
    | 'draft_invoice_ready'
    | 'rep_purchase_sent'
    | 'rep_purchase_received'
    | 'rep_purchase_rejected'
    | 'rep_purchase_confirmed'
    | 'sync_dispatch_incoming'
    | 'sync_dispatch_confirmed'
    | 'sync_dispatch_failed';
  title: string;
  body: string;
  createdAt: string;
  targetTab?: string;
  referenceId?: string;
  referenceNumber?: string;
  relatedId?: string;
  severity?: 'info' | 'warning' | 'success' | 'error';
}

export interface CustomerStatementEntry {
  id: string;
  docId?: string;
  docType?: 'opening_balance' | 'sales' | 'customer_payment' | 'order_advance' | 'sales_return';
  date: string;
  docNumber: string;
  type: 'opening_balance' | 'sales_invoice' | 'customer_payment' | 'order_advance' | 'sales_return';
  label: string;
  description: string;
  debit: number | null;
  credit: number | null;
  paidAmount?: number | null;
  remainingAmount?: number | null;
  runningBalance: number | null;
  createdBy?: string;
  createdByUserId?: string;
}

export interface CustomerStatementResponse {
  customer: Customer | null;
  customerType?: 'regular' | 'app' | 'hybrid';
  allowPriceView: boolean;
  scope?: {
    isRepScoped?: boolean;
    accountBalanceScope?: 'company_wide' | string;
    operationsScope?: string;
  };
  invoices?: Invoice[];
  returns?: InvoiceReturn[];
  orders?: CustomerItemOrderRequest[];
  advancePayments?: OrderAdvancePayment[];
  summary: {
    openingBalance: number | null;
    totalDebit: number | null;
    totalCredit: number | null;
    totalSales?: number | null;
    totalPaid?: number | null;
    currentBalance: number | null;
    debtAmount?: number | null;
    creditAmount?: number | null;
    balanceDirection?: 'debt' | 'credit' | 'settled';
    activeAdvanceBalance?: number | null;
    openOrdersCount?: number;
    openOrdersEstimatedTotal?: number | null;
    invoicesCount: number;
    returnsCount: number;
    ordersCount?: number;
    lastInvoiceDate?: string | null;
    lastInvoiceNumber?: string | null;
    lastPaymentDate?: string | null;
    lastTransactionDate?: string | null;
  };
  entries: CustomerStatementEntry[];
}

export interface SupplierStatementEntry {
  id: string;
  docId?: string;
  docType?: 'opening_balance' | 'purchase' | 'supplier_payment' | 'purchase_return';
  date: string;
  docNumber: string;
  type: 'opening_balance' | 'purchase_invoice' | 'supplier_payment' | 'purchase_return';
  label: string;
  description: string;
  credit: number;
  debit: number;
  paidAmount?: number;
  remainingAmount?: number;
  runningBalance: number;
  createdBy?: string;
  createdByUserId?: string;
}

export interface SupplierStatementResponse {
  supplier: Supplier;
  invoices: Invoice[];
  returns: InvoiceReturn[];
  scope?: {
    isRepScoped?: boolean;
    accountBalanceScope?: 'company_wide' | string;
    operationsScope?: string;
  };
  summary: {
    openingBalance: number;
    totalPurchases: number;
    totalCredit: number;
    totalDebit: number;
    totalPaid: number;
    currentBalance: number;
    payableAmount: number;
    advanceCreditAmount: number;
    balanceDirection: 'payable' | 'advance' | 'settled';
    invoicesCount: number;
    returnsCount: number;
    lastInvoiceDate?: string | null;
    lastInvoiceNumber?: string | null;
    lastTransactionDate?: string | null;
  };
  entries: SupplierStatementEntry[];
}

export type SyncQueueStatus = 'local' | 'pending' | 'syncing' | 'synced' | 'failed' | 'needs_review';

export type SyncOperationType =
  | 'create_order'
  | 'create_sales_invoice'
  | 'create_sales_quote'
  | 'edit_sales_invoice'
  | 'create_purchase_invoice'
  | 'send_purchase_invoice'
  | 'edit_purchase_invoice'
  | 'delete_purchase_draft'
  | 'create_invoice_return'
  | 'create_purchase_return'
  | 'create_purchase_return_request'
  | 'create_sales_return_request'
  | 'add_invoice_payment'
  | 'record_customer_payment'
  | 'record_order_advance'
  | 'update_order_delivery'
  | 'execute_cash_operation'
  | 'create_customer'
  | 'update_customer'
  | 'update_own_profile'
  | 'update_customer_favorites'
  | 'create_supplier'
  | 'confirm_custody_receipt'
  | 'record_custody_delivery'
  | 'record_custody_return';

export type SyncDispatchBatchStatus =
  | 'محفوظة محليًا'
  | 'جاهزة للإرسال'
  | 'جاري الإرسال'
  | 'تم الإرسال'
  | 'في انتظار الاستلام'
  | 'جاري الاستلام'
  | 'تم الاستلام'
  | 'فشل الإرسال'
  | 'تعذر الاستلام';

export interface SyncQueueItem {
  operationId: string;
  userId: string;
  deviceId: string;
  operationType: SyncOperationType;
  entityType: string;
  entityId?: string;
  localId?: string;
  summaryAr: string;
  payload: Record<string, any>;
  status: SyncQueueStatus;
  holdForDispatchBatch?: boolean;
  dispatchBatchId?: string;
  dispatchStage?: SyncDispatchBatchStatus;
  attempts: number;
  lastError?: string;
  conflictId?: string;
  nextRetryAt?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchRecipientOption {
  id: string;
  fullName: string;
  role: string;
  jobTitle?: string;
}

export interface SyncDispatchBatchDocSummaryItem {
  operationId: string;
  operationType: SyncOperationType | string;
  entityType: string;
  entityId?: string;
  docNumber?: string;
  customerName?: string;
  amount?: number;
  paidAmount?: number;
  summaryAr: string;
  deduplicated?: boolean;
  status?: string;
  createdAt?: string;
}

export interface SyncDispatchBatch {
  id: string;
  batchNumber: string;
  clientBatchUuid: string;
  idempotencyKey: string;
  deviceId?: string;
  senderUserId: string;
  senderName: string;
  representativeId?: string;
  representativeName?: string;
  recipientUserId: string;
  recipientName: string;
  recipientRole?: string;
  sendStatus: SyncDispatchBatchStatus;
  receiptStatus: SyncDispatchBatchStatus;
  salesCount: number;
  purchasesCount: number;
  returnsCount: number;
  collectionsCount: number;
  ordersCount: number;
  customersCount: number;
  custodyOpsCount: number;
  totalSalesAmount: number;
  totalCashAmount: number;
  operationIds: string[];
  operationsSnapshot?: SyncQueueItem[];
  docSummary?: SyncDispatchBatchDocSummaryItem[];
  notes?: string;
  receiptNotes?: string;
  errorMessage?: string;
  sentAt?: string;
  receivedByUserId?: string;
  receivedByName?: string;
  receivedAt?: string;
  receivedDeviceId?: string;
  discrepancyDetails?: {
    hasDiscrepancy?: boolean;
    note?: string;
    items?: Array<{ label: string; expected?: string | number; actual?: string | number; note?: string }>;
    reportedAt?: string;
    reportedByUserId?: string;
  };
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  isLocalOnly?: boolean;
  isConfirmedSendQueued?: boolean;
}

export interface SyncConflictRecord {
  id: string;
  operationId: string;
  operationType: SyncOperationType | string;
  entityType: string;
  entityId?: string;
  deviceId?: string;
  userId?: string;
  userName?: string;
  conflictReason: string;
  localPayload: Record<string, any>;
  serverSnapshot: Record<string, any>;
  status: 'needs_review' | 'resolved_keep_server' | 'resolved_apply_local' | 'dismissed';
  resolutionNotes?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface ItemMovementRow {
  id: string;
  date: string;
  createdAt?: string;
  docType: string;
  docId: string;
  docNumber: string;
  productId: string;
  productName: string;
  warehouseId?: string;
  warehouseName?: string;
  targetWarehouseId?: string;
  targetWarehouseName?: string;
  partyId?: string;
  partyName?: string;
  representativeId?: string;
  representativeName?: string;
  unit: string;
  quantity: number;
  baseQuantity: number;
  unitPrice: number;
  costPrice: number;
  totalValue: number;
  costValue?: number;
  profitValue: number;
  direction: 'in' | 'out' | 'neutral';
  notes?: string;
  createdBy?: string;
}

export interface ItemMovementReportResponse {
  product: Product | null;
  filters: {
    productId: string;
    warehouseId: string;
    movementType: string;
    representativeId: string;
    dateFrom: string | null;
    dateTo: string | null;
    search: string;
  };
  warehouseBreakdown: Array<{
    warehouseId: string;
    warehouseName: string;
    code?: string;
    quantity: number;
    costValue: number;
    sellingValue: number;
  }>;
  repCustodyBreakdown: Array<{
    representativeId: string;
    representativeName: string;
    warehouseId: string;
    warehouseName: string;
    quantity: number;
    costValue: number;
    sellingValue: number;
  }>;
  sections: {
    sales: ItemMovementRow[];
    purchases: ItemMovementRow[];
    sales_returns: ItemMovementRow[];
    purchase_returns: ItemMovementRow[];
    transfers: ItemMovementRow[];
    custody_sent: ItemMovementRow[];
    custody_received: ItemMovementRow[];
    custody_deliveries: ItemMovementRow[];
    adjustments: ItemMovementRow[];
  };
  totals: {
    totalSalesQty: number;
    totalSalesValue: number;
    totalPurchaseQty: number;
    totalPurchaseValue: number;
    totalSalesReturnQty: number;
    totalSalesReturnValue: number;
    totalPurchaseReturnQty: number;
    totalPurchaseReturnValue: number;
    totalCostOfGoodsSold: number;
    totalProfit: number;
    totalQtyIn: number;
    totalQtyOut: number;
    currentBalance: number;
    inventoryValuation: number;
  };
}

export type ComprehensiveReportTypeKey =
  | 'all'
  | 'sales_items'
  | 'sales_invoices'
  | 'sales_items_by_unit'
  | 'sales_items_grouped'
  | 'sales_items_grouped_by_customer'
  | 'sales_items_grouped_by_category'
  | 'sales_items_grouped_by_category_class1'
  | 'sales_return_items'
  | 'sales_return_invoices'
  | 'purchase_items'
  | 'purchase_invoices'
  | 'purchase_return_items'
  | 'purchase_return_invoices'
  | 'damaged_items'
  | 'damaged_invoices'
  | 'cash_payment'
  | 'cash_payment_customer'
  | 'cash_payment_supplier'
  | 'cash_payment_employee'
  | 'cash_withdrawal'
  | 'cash_withdrawal_customer'
  | 'cash_withdrawal_supplier';

export interface ComprehensiveReportOption {
  key: ComprehensiveReportTypeKey;
  label: string;
  group: number;
}

export interface ComprehensiveReportRow {
  rowId: string;
  docType: string;
  docId: string;
  txId?: string;
  productId?: string;
  productName?: string;
  categoryName?: string;
  class1?: string;
  operationLabel: string;
  quantity: number;
  baseQuantity?: number;
  unit: string;
  priceOrTotal: number;
  valueOrPaid: number;
  movementOrRemaining: string | number;
  employeeId?: string;
  employeeName: string;
  userName: string;
  businessDate: string;
  rawDate: string;
  actualDateTime: string;
  rawCreatedAt: string;
  profit: number;
  costValue?: number;
  barcode: string;
  displayId: string;
  invoiceNumber: string;
  branchName: string;
  warehouseId?: string;
  warehouseName?: string;
  cashboxId?: string;
  cashboxName: string;
  notes: string;
  discount: number;
  profitPercent: number;
  customerId?: string;
  supplierId?: string;
  partyName?: string;
  representativeId?: string;
  representativeName?: string;
  productCode?: string;
  paidAmount?: number;
  remainingAmount?: number;
  paymentStatus?: string;
  invoiceStatus?: string;
  actorIdentityId?: string;
  actorEmployeeId?: string;
  actingRole?: string;
  rowTone?: 'default' | 'invoice_blue' | 'cash_green' | 'warning_rose';
}

export type ReportMovementTypeKey =
  | 'all'
  | 'sales'
  | 'sales_return'
  | 'purchase'
  | 'purchase_return'
  | 'damaged'
  | 'cash_in'
  | 'cash_out';

export interface ComprehensiveReportSection {
  key: string;
  title: string;
  theme: 'sage' | 'slate';
  isInvoiceLayout: boolean;
  cashHighlightCol?: boolean;
  rows: ComprehensiveReportRow[];
  totals: {
    count: number;
    quantity: number;
    priceOrTotal: number | null;
    valueOrPaid: number;
    remaining: number | null;
    profit: number;
    costValue: number;
    discount: number;
    profitPercent: number;
  };
}

export interface ItemHistoryTimelineEntry {
  id: string;
  sortTime: string;
  date: string;
  actualDateTime: string;
  eventType: string;
  eventLabel: string;
  docType: string;
  docId: string;
  docNumber: string;
  warehouseName: string;
  partyName: string;
  unit: string;
  qty: number;
  qtyIn: number;
  qtyOut: number;
  unitPrice: number;
  unitCost: number;
  totalValue: number;
  runningBalance: number;
  userName: string;
  notes: string;
}

export interface ItemLifecyclePayload {
  product: Product & { class1?: string; createdAtFormatted?: string };
  lastPurchasePrice: number;
  lastPurchaseDate: string | null;
  lastSalePrice: number;
  lastSaleDate: string | null;
  currentStockTotal: number;
  currentStockValueAtCost: number;
  warehouseBalances: Array<{
    warehouseId: string;
    warehouseName: string;
    branchName: string;
    quantity: number;
    costValue: number;
    sellingValue: number;
  }>;
  timeline: ItemHistoryTimelineEntry[];
  fullCount: number;
}

export interface ItemLossTransaction {
  id: string;
  date: string;
  actualDateTime: string;
  docType: string;
  docId: string;
  docNumber: string;
  partyName: string;
  quantity: number;
  unit: string;
  sellingPrice: number;
  costPrice: number;
  discount: number;
  lossAmount: number;
  reason: string;
}

export interface ItemPnlSummary {
  productId: string;
  code: string;
  barcode: string;
  productName: string;
  category: string;
  class1: string;
  baseUnit: string;
  totalPurchaseQty: number;
  totalPurchaseValue: number;
  purchaseReturnsQty: number;
  purchaseReturnsValue: number;
  netPurchaseQty: number;
  netPurchaseValue: number;
  totalSalesQty: number;
  totalSalesValue: number;
  salesReturnsQty: number;
  salesReturnsValue: number;
  netSalesQty: number;
  netSalesValue: number;
  cogs: number;
  avgPurchasePrice: number;
  minPurchasePrice: number;
  maxPurchasePrice: number;
  lastPurchasePrice: number;
  lastPurchaseDate: string | null;
  avgSalePrice: number;
  minSalePrice: number;
  maxSalePrice: number;
  lastSalePrice: number;
  lastSaleDate: string | null;
  totalDiscounts: number;
  damagedQty: number;
  damagedLossValue: number;
  shortageQty: number;
  shortageLossValue: number;
  allocatedExpenses: number;
  grossProfit: number;
  netProfit: number;
  totalLoss: number;
  profitPercentOnCost: number;
  profitMarginOnSales: number;
  currentStockQty: number;
  currentStockValue: number;
  lossTransactionsCount: number;
  lossTransactions: ItemLossTransaction[];
}

export interface ComprehensiveReportResponse {
  reportType: ComprehensiveReportTypeKey;
  reportTypeLabel: string;
  reportTypes: ComprehensiveReportOption[];
  filters: Record<string, any>;
  filterOptions: {
    branches: BranchSettingItem[];
    warehouses: Array<{ id: string; name: string; code?: string }>;
    cashboxes: Array<{ id: string; name: string; type?: string; currentBalance?: number }>;
    products: Array<{
      id: string;
      code: string;
      barcode?: string;
      name: string;
      category: string;
      baseUnit: string;
      size?: string;
      color?: string;
    }>;
    customers: Array<{ id: string; name: string; phone?: string }>;
    suppliers: Array<{ id: string; name: string; phone?: string }>;
    employees: Array<{ id: string; name: string; jobTitle?: string; identityId?: string; userId?: string }>;
    representatives: Array<{ id: string; name: string; warehouseId?: string; identityId?: string; userId?: string }>;
    users: Array<{ id: string; fullName: string; username: string; role: string; identityId?: string; employeeId?: string }>;
  };
  sections: ComprehensiveReportSection[];
  pagination?: {
    enabled: boolean;
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  summary: {
    drawerBalance: number;
    reportBalance: number;
    carriedFromYesterday: number;
    reportProfit: number;
    reportProfitPercent: number;
    filteredSalesNet: number;
    filteredPurchasesNet: number;
    filteredCashIn: number;
    filteredCashOut: number;
    totalRows: number;
  };
  itemLifecycle: ItemLifecyclePayload | null;
  itemPnl: {
    selectedItem: ItemPnlSummary | null;
    items: ItemPnlSummary[];
    portfolioTotals: {
      totalPurchaseValue: number;
      totalSalesValue: number;
      netSalesValue: number;
      cogs: number;
      totalDiscounts: number;
      salesReturnsValue: number;
      purchaseReturnsValue: number;
      allocatedExpenses: number;
      grossProfit: number;
      netProfit: number;
      totalLoss: number;
      stockValuation: number;
    };
  };
}

export interface ReportSourceDocumentResponse {
  ok: boolean;
  docType: string;
  title: string;
  document: Record<string, any>;
  auditTrail: Array<{
    id: string;
    timestamp: string;
    userName: string;
    action: string;
    module: string;
    oldValues?: Record<string, any> | null;
    newValues?: Record<string, any> | null;
    notes?: string;
  }>;
}

export interface RepDetailedReportInvoiceRow {
  id: string;
  invoiceNumber: string;
  date: string;
  type: 'sales' | 'purchase' | 'quote';
  status: string;
  dispatchStatus?: string;
  partyId: string;
  partyName: string;
  warehouseId?: string;
  warehouseName: string;
  representativeId?: string;
  representativeName?: string;
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: 'paid' | 'partial' | 'credit';
  itemsCount: number;
  items: Array<{
    productId: string;
    productName: string;
    productCode?: string;
    barcode?: string;
    unit: string;
    unitFactor: number;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
  }>;
  notes?: string;
}

export interface RepDetailedReportItemRow {
  rowId: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  opType: 'sales' | 'purchase' | 'sales_return' | 'purchase_return';
  status: string;
  invoiceStatus?: string;
  paymentStatus?: 'paid' | 'partial' | 'credit';
  partyId: string;
  partyName: string;
  representativeName?: string;
  createdByName?: string;
  productId: string;
  productName: string;
  productCode?: string;
  barcode?: string;
  categoryName?: string;
  class1?: string;
  unit: string;
  quantity: number;
  unitFactor: number;
  unitPrice: number;
  grossTotal?: number;
  discount: number;
  total: number;
  returnedQty?: number;
  returnedValue?: number;
  netQty?: number;
  netValue?: number;
  paidAmount?: number;
  remainingAmount?: number;
}

export interface RepDetailedReportResponse {
  scope: {
    isRepScoped: boolean;
    representativeId?: string;
    representativeName?: string;
    canViewSuppliers: boolean;
    availableRepresentatives?: Array<{
      id: string;
      name: string;
      code?: string;
      warehouseId?: string;
    }>;
    accountBalanceNote: string;
  };
  summary: {
    salesCount: number;
    salesTotal: number;
    salesPaid: number;
    salesRemaining: number;
    salesReturnsCount: number;
    salesReturnsTotal: number;
    netSalesTotal: number;
    purchasesCount: number;
    purchasesTotal: number;
    purchasesPaid: number;
    purchasesRemaining: number;
    purchaseReturnsCount: number;
    purchaseReturnsTotal: number;
    purchaseReturnRequestsCount?: number;
    pendingPurchaseReturnRequestsCount?: number;
    salesReturnRequestsCount?: number;
    pendingSalesReturnRequestsCount?: number;
    collectionsCount: number;
    collectionsTotal: number;
    collectedByRepCount?: number;
    collectedByRepTotal?: number;
    collectedByBranchCount?: number;
    collectedByBranchTotal?: number;
    purchasePaymentsTotal: number;
    totalCustomerReceivables?: number;
    totalSupplierPayables?: number;
  };
  pagination?: {
    enabled: boolean;
    page: number;
    pageSize: number;
    totalRows: number;
    totalInvoices: number;
    totalItemRows: number;
    totalReturns: number;
    totalCollections: number;
    totalPurchaseReturnRequests: number;
    totalSalesReturnRequests?: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  customersSummary: Array<{
    id: string;
    name: string;
    shopName?: string;
    phone: string;
    companyBalance: number;
    repSalesCount: number;
    repSalesTotal: number;
    repPaidTotal: number;
    repCollectionsTotal: number;
    repDirectCollectionsTotal?: number;
    branchCollectionsTotal?: number;
  }>;
  suppliersSummary: Array<{
    id: string;
    name: string;
    companyName?: string;
    phone: string;
    companyBalance: number;
    repPurchasesCount: number;
    repPurchasesTotal: number;
    repPaidTotal: number;
  }>;
  invoices: RepDetailedReportInvoiceRow[];
  itemRows: RepDetailedReportItemRow[];
  returns: InvoiceReturn[];
  purchaseReturnRequests?: PurchaseReturnRequest[];
  salesReturnRequests?: SalesReturnRequest[];
  collections: Array<{
    id: string;
    transactionNumber?: string;
    date: string;
    amount: number;
    partyId?: string;
    partyName: string;
    paymentMethod?: string;
    relatedDocId?: string;
    relatedDocNumber?: string;
    remainingAfter?: number;
    isInvoiceLinked?: boolean;
    collectionLocation?: 'rep' | 'branch';
    collectedByRep?: boolean;
    collectedByBranch?: boolean;
    collectorName?: string;
    collectorRole?: string;
    createdBy?: string;
    notes?: string;
  }>;
  purchasePayments?: Array<{
    id: string;
    transactionNumber?: string;
    date: string;
    amount: number;
    partyId?: string;
    partyName: string;
    paymentMethod?: string;
    relatedDocId?: string;
    relatedDocNumber?: string;
    remainingAfter?: number;
    createdBy?: string;
    notes?: string;
  }>;
}


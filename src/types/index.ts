export type UserRole = 
  | 'admin'         // مالك / مسؤول عام
  | 'manager'       // مدير
  | 'accountant'    // محاسب
  | 'sales'         // موظف مبيعات
  | 'warehouse'     // أمين مستودع
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
  canManageInventory: boolean;
  canManageWarehouses: boolean;
  canManageCashboxes: boolean;
  canManageAccounts: boolean;
  canManageReps: boolean;
  canManageTransfers: boolean;
  canManageEmployees: boolean;
  canManageSalaries: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canAllowNegativeInventory: boolean;
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
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLogin?: string;
  permissions: UserPermissions;
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
  purchasePrice: number;
  sellingPrice: number;
  minStockLevel: number;
  stockPerWarehouse: Record<string, number>; // warehouseId -> quantity in base unit
  image?: string;
  status: 'active' | 'archived'; // active = نشط، archived = موقوف منطقياً
  notes?: string;
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

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string;
  userId?: string; // حساب الدخول المرتبط بالعميل
  secondaryPhone?: string; // رقم هاتف إضافي
  shopName?: string;       // اسم المحل
  shopPhoto?: string;      // صورة المحل
  area?: string;           // المنطقة
  geoCoordinates?: string; // الموقع الجغرافي / إحداثيات GPS أو رابط خرائط
  address: string;
  photo?: string;
  notes?: string;
  openingBalance: number; // موجب = عليه دين للشركة، سالب = له رصيد دائن
  currentBalance: number;
  status: 'active' | 'blocked';
  // التاريخ الفعلي لأسعار الشراء السابقة لكل منتج: productId -> prices array [oldest to newest]
  priceHistory: Record<string, number[]>;
  createdAt: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  phone: string;
  address: string;
  notes?: string;
  openingBalance: number; // موجب = له مستحقات علينا، سالب = دفع زيادة
  currentBalance: number;
  status?: 'active' | 'suspended'; // حالة المورد: نشط / موقوف
  createdAt: string;
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

export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: 'sales' | 'purchase';
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
  remainingAmount: number;
  paymentType: 'cash' | 'credit' | 'partial';
  paymentMethod: 'cash' | 'bank' | 'cheque';
  cashboxId: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  notes?: string;
  payments?: InvoicePayment[]; // دفعات متعددة مسجلة على نفس الفاتورة
  linkedRepTransferId?: string; // معرف طلب تحويل عهدة المندوب المرتبط
  linkedRepTransferNumber?: string; // رقم طلب تحويل عهدة المندوب المرتبط
  linkedCustomerOrderId?: string; // معرف طلب العميل المرتبط (1:1)
  createdBy: string;
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
  createdBy: string;
  createdAt: string;
}

export interface Cashbox {
  id: string;
  name: string;
  type: 'cashbox' | 'bank';
  accountNumber?: string;
  openingBalance: number;
  currentBalance: number;
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
  relatedDocType?: 'sales' | 'purchase' | 'sales_return' | 'purchase_return' | 'rep_transfer' | 'salary' | 'manual';
  relatedDocId?: string;
  relatedDocNumber?: string;
  partyId?: string;
  partyName?: string;
  description: string;
  notes?: string;
  createdBy: string;
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
  userId?: string; // حساب الدخول المرتبط
  openingBalance: number;
  currentBalance: number;
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
  basicSalary: number;
  hireDate: string;
  status: 'active' | 'suspended';
  notes?: string;
}

export interface EmployeeAdvanceDeduction {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'advance' | 'deduction' | 'bonus'; // سلفة | خصم | مكافأة
  amount: number;
  date: string;
  reason: string;
  cashboxId?: string;
  isSettled: boolean;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  status: 'present' | 'absent' | 'leave' | 'late';
  checkIn?: string;
  checkOut?: string;
  notes?: string;
}

export interface SalaryPayroll {
  id: string;
  payrollNumber: string;
  month: number;
  year: number;
  employeeId: string;
  employeeName: string;
  basicSalary: number;
  advancesTotal: number;
  deductionsTotal: number;
  bonusesTotal: number;
  netSalary: number;
  status: 'draft' | 'paid';
  paidDate?: string;
  cashboxId?: string;
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
}

export interface SystemSettings {
  companyName: string;
  companySubtitle: string;
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
  rejectionReason?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  executedAt?: string;
}


export type CustomerItemOrderStatus = 'pending' | 'approved' | 'rejected' | 'invoiced';
export interface CustomerOrderStatusHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedByName: string;
  reason?: string;
  changedAt: string;
}

export interface CustomerItemOrderRequest {
  id: string;
  requestNumber: string;
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
  status: CustomerItemOrderStatus;
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

// إعدادات السيرفر والاتصال المحلي والشبكة
export interface ServerConnectionSettings {
  serverIp: string;
  hostname: string;
  port: number;
  apiBaseUrl: string;
  connectionType: 'lan' | 'vpn' | 'reverse_proxy' | 'offline_local';
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
  image?: string;
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



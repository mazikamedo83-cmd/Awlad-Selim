import {
  User,
  Product,
  Warehouse,
  Customer,
  Supplier,
  Invoice,
  InvoiceReturn,
  Cashbox,
  FinancialTransaction,
  Cheque,
  InstallmentSchedule,
  Representative,
  RepTransfer,
  Employee,
  ExpenseIncomeRecord,
  StockMovement,
  AuditLogItem,
  SystemSettings,
  RepItemTransferRequest,
  ServerConnectionSettings,
  ProductGroup,
  ProductCategory,
  UnitCatalogItem,
  CustomerItemOrderRequest,
  MigrationLogEntry,
  OwnerPersonalAccount,
  OwnerPersonalTransaction,
  StockCountSession,
  StockTransferRequest,
  OrderAdvancePayment,
  SyncConflictRecord,
  RepCustodyOperation,
  PurchaseReceiverOption,
  PurchaseReturnRequest,
  SalesReturnRequest,
  UnifiedIdentity,
  IdentityRoleLink,
  IdentityConflict,
  SyncDispatchBatch,
  DispatchRecipientOption,
  RepTransferTarget,
} from '../types';

const OFFLINE_ORDERS_QUEUE_KEY = 'awlad_selim_offline_orders_queue_v3';

export interface DatabaseState {
  users: User[];
  products: Product[];
  warehouses: Warehouse[];
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  invoiceReturns: InvoiceReturn[];
  cashboxes: Cashbox[];
  financialTransactions: FinancialTransaction[];
  cheques: Cheque[];
  installments: InstallmentSchedule[];
  representatives: Representative[];
  repTransferTargets?: RepTransferTarget[];
  repTransfers: RepTransfer[];
  repItemTransfers?: RepItemTransferRequest[];
  repCustodyOperations?: RepCustodyOperation[];
  customerItemOrders?: CustomerItemOrderRequest[];
  orderAdvancePayments?: OrderAdvancePayment[];
  syncConflicts?: SyncConflictRecord[];
  employees: Employee[];
  expenseIncomes: ExpenseIncomeRecord[];
  stockMovements: StockMovement[];
  productGroups?: ProductGroup[];
  categories?: ProductCategory[];
  productUnits?: UnitCatalogItem[];
  ownerAccounts?: OwnerPersonalAccount[];
  ownerTransactions?: OwnerPersonalTransaction[];
  stockCounts?: StockCountSession[];
  stockTransferRequests?: StockTransferRequest[];
  purchaseReceivers?: PurchaseReceiverOption[];
  purchaseReturnRequests?: PurchaseReturnRequest[];
  salesReturnRequests?: SalesReturnRequest[];
  auditLogs?: AuditLogItem[];
  identities?: UnifiedIdentity[];
  identityRoles?: IdentityRoleLink[];
  identityConflicts?: IdentityConflict[];
  syncDispatchBatches?: SyncDispatchBatch[];
  dispatchRecipients?: DispatchRecipientOption[];
  settings: SystemSettings;
  serverSettings?: ServerConnectionSettings;
  migrationLogs?: MigrationLogEntry[];
}

export function generateId(prefix: string = 'AS'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`.toUpperCase();
}

export function getEmptyClientDatabaseState(): DatabaseState {
  return {
    users: [],
    products: [],
    warehouses: [],
    customers: [],
    suppliers: [],
    invoices: [],
    invoiceReturns: [],
    cashboxes: [],
    financialTransactions: [],
    cheques: [],
    installments: [],
    representatives: [],
    repTransferTargets: [],
    repTransfers: [],
    repItemTransfers: [],
    repCustodyOperations: [],
    customerItemOrders: [],
    orderAdvancePayments: [],
    syncConflicts: [],
    employees: [],
    expenseIncomes: [],
    stockMovements: [],
    productGroups: [],
    categories: [],
    productUnits: [],
    ownerAccounts: [],
    ownerTransactions: [],
    stockCounts: [],
    syncDispatchBatches: [],
    dispatchRecipients: [],
    stockTransferRequests: [],
    purchaseReceivers: [],
    purchaseReturnRequests: [],
    salesReturnRequests: [],
    auditLogs: [],
    identities: [],
    identityRoles: [],
    identityConflicts: [],
    settings: {
      companyName: 'أولاد سليم لتجارة المواد الغذائية بالجملة',
      companySubtitle: 'AWLAD SELIM - برنامج محاسبة وإدارة الأعمال المتكامل',
      phone1: '',
      phone2: '',
      address: '',
      commercialRegistration: '',
      taxNumber: '',
      currency: 'ج.م',
      defaultPrintMode: 'a4',
      invoiceNotes: '',
      allowNegativeStock: false,
    },
    serverSettings: {
      serverIp: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
      hostname: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
      port: typeof window !== 'undefined' ? Number(window.location.port || (window.location.protocol === 'https:' ? 443 : 3000)) : 3000,
      apiBaseUrl: typeof window !== 'undefined' ? window.location.origin : '',
      connectionType: 'local_network',
      activeMode: 'local_network',
      profiles: {
        activeMode: 'local_network',
        localNetwork: {
          ip: typeof window !== 'undefined' ? window.location.hostname || '192.168.1.100' : '192.168.1.100',
          port: 3000,
          hostname: 'awlad-selim-server',
        },
        freeRemote: { tunnelUrl: '' },
        proRemote: { domainUrl: '' },
        cloudVps: { vpsUrl: '', notes: '' },
        enforceHttpsForRemote: true,
      },
      serverStatus: 'checking',
      databaseStatus: 'connected',
      latencyMs: 0,
      syncStatus: 'connected',
    },
    migrationLogs: [],
  };
}

export interface QueuedCustomerOrder {
  idempotencyKey: string;
  payload: {
    customerId?: string;
    customerName?: string;
    requesterType?: 'customer' | 'representative' | 'staff';
    items: Array<{
      productId: string;
      productName: string;
      unit: string;
      unitFactor?: number;
      unitPrice?: number;
      quantity: number;
    }>;
    notes?: string;
    deliveryAddress?: string;
    geoCoordinates?: string;
    shopName?: string;
    customerPhone?: string;
  };
  queuedAt: string;
}

function offlineQueueStorageKey(userId?: string): string {
  const uid = String(userId || '').trim();
  return uid ? `${OFFLINE_ORDERS_QUEUE_KEY}_${uid}` : OFFLINE_ORDERS_QUEUE_KEY;
}

export function loadOfflineOrdersQueue(userId?: string): QueuedCustomerOrder[] {
  try {
    const raw = localStorage.getItem(offlineQueueStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOfflineOrdersQueue(queue: QueuedCustomerOrder[], userId?: string): void {
  try {
    const key = offlineQueueStorageKey(userId);
    if (!queue.length) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(queue));
    }
  } catch {
    // ignore storage errors
  }
}

const READ_CACHE_KEY_PREFIX = 'awlad_selim_read_cache_v2_';
const LEGACY_READ_CACHE_KEY = 'awlad_selim_read_cache_v1';

export interface MobileReadCacheSnapshot<T = any> {
  userId: string;
  role: string;
  cachedAt: string;
  data: T;
}

export function saveReadCache<T = any>(userId: string, role: string, data: T): void {
  if (!userId || !role) return;
  try {
    const payload: MobileReadCacheSnapshot<T> = {
      userId,
      role,
      cachedAt: new Date().toISOString(),
      data,
    };
    localStorage.setItem(`${READ_CACHE_KEY_PREFIX}${userId}`, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

export function loadReadCache<T = any>(
  userId: string,
  role: string
): MobileReadCacheSnapshot<T> | null {
  if (!userId || !role) return null;
  try {
    const raw =
      localStorage.getItem(`${READ_CACHE_KEY_PREFIX}${userId}`) ||
      localStorage.getItem(LEGACY_READ_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MobileReadCacheSnapshot<T>;
    if (parsed?.userId !== userId || parsed?.role !== role || !parsed?.data) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearReadCache(userId?: string): void {
  try {
    if (userId) {
      localStorage.removeItem(`${READ_CACHE_KEY_PREFIX}${userId}`);
    } else {
      localStorage.removeItem(LEGACY_READ_CACHE_KEY);
    }
  } catch {
    // ignore
  }
}

// Non-destructive guard: preserve any legacy browser-side database snapshots untouched
export function purgeLegacyLocalDatabaseCache(): void {
  // Intentionally left non-destructive so legacy browser data is never wiped automatically.
}

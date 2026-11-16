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
  EmployeeAdvanceDeduction,
  AttendanceRecord,
  SalaryPayroll,
  ExpenseIncomeRecord,
  StockMovement,
  AuditLogItem,
  SystemSettings,
  RepItemTransferRequest,
  ServerConnectionSettings,
  ProductCategory,
  CustomerItemOrderRequest,
  MigrationLogEntry,
  OwnerPersonalAccount,
  OwnerPersonalTransaction,
  StockCountSession,
  StockTransferRequest,
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
  repTransfers: RepTransfer[];
  repItemTransfers?: RepItemTransferRequest[];
  customerItemOrders?: CustomerItemOrderRequest[];
  employees: Employee[];
  advancesDeductions: EmployeeAdvanceDeduction[];
  attendance: AttendanceRecord[];
  payrolls: SalaryPayroll[];
  expenseIncomes: ExpenseIncomeRecord[];
  stockMovements: StockMovement[];
  categories?: ProductCategory[];
  ownerAccounts?: OwnerPersonalAccount[];
  ownerTransactions?: OwnerPersonalTransaction[];
  stockCounts?: StockCountSession[];
  stockTransferRequests?: StockTransferRequest[];
  auditLogs?: AuditLogItem[];
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
    repTransfers: [],
    repItemTransfers: [],
    customerItemOrders: [],
    employees: [],
    advancesDeductions: [],
    attendance: [],
    payrolls: [],
    expenseIncomes: [],
    stockMovements: [],
    categories: [],
    ownerAccounts: [],
    ownerTransactions: [],
    stockCounts: [],
    stockTransferRequests: [],
    auditLogs: [],
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
      connectionType: 'reverse_proxy',
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
    items: Array<{ productId: string; productName: string; unit: string; quantity: number }>;
    notes?: string;
    deliveryAddress?: string;
    geoCoordinates?: string;
    shopName?: string;
    customerPhone?: string;
  };
  queuedAt: string;
}

export function loadOfflineOrdersQueue(): QueuedCustomerOrder[] {
  try {
    const raw = localStorage.getItem(OFFLINE_ORDERS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOfflineOrdersQueue(queue: QueuedCustomerOrder[]): void {
  try {
    if (!queue.length) {
      localStorage.removeItem(OFFLINE_ORDERS_QUEUE_KEY);
    } else {
      localStorage.setItem(OFFLINE_ORDERS_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch {
    // ignore storage errors
  }
}

// Non-destructive guard: preserve any legacy browser-side database snapshots untouched
export function purgeLegacyLocalDatabaseCache(): void {
  // Intentionally left non-destructive so legacy browser data is never wiped automatically.
}

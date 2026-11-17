import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  DatabaseState,
  getEmptyClientDatabaseState,
  generateId,
  loadOfflineOrdersQueue,
  saveOfflineOrdersQueue,
  QueuedCustomerOrder,
  saveReadCache,
  loadReadCache,
} from '../services/storage';
import { apiRequest, getConfiguredApiBaseUrl, setConfiguredApiBaseUrl } from '../services/api';
import { notifyLocal, subscribeNetworkStatus } from '../services/native';
import {
  Product,
  Customer,
  Supplier,
  Invoice,
  InvoiceReturn,
  Cashbox,
  Cheque,
  InstallmentSchedule,
  Representative,
  RepTransfer,
  Employee,
  EmployeeAdvanceDeduction,
  AttendanceRecord,
  SalaryPayroll,
  ExpenseIncomeRecord,
  User,
  SystemSettings,
  NetworkSyncStatus,
  RepItemTransferRequest,
  RepItemTransferStatus,
  RepTransferItem,
  ServerConnectionSettings,
  ProductCategory,
  Warehouse,
  CustomerItemOrderRequest,
  MigrationLogEntry,
  AuditLogItem,
  CashOperationPayload,
  FinancialTransaction,
  OwnerPersonalAccount,
  OwnerPersonalTransaction,
  StockCountSession,
  StockTransferRequest,
  CustomerPriceHistoryEntry,
  CustomerStatementResponse,
  MobileNotificationItem,
} from '../types';
import { useAuth } from './AuthContext';

export interface DataContextType extends DatabaseState {
  networkStatus: NetworkSyncStatus;
  lastSyncTime: string;
  pendingChangesCount: number;
  offlineOrdersCount: number;
  lastError: string | null;
  isUsingOfflineCache: boolean;
  lastCacheTimestamp: string | null;
  customerStatement: CustomerStatementResponse | null;
  mobileNotifications: MobileNotificationItem[];
  unreadNotificationCount: number;
  markNotificationsRead: () => void;
  refreshMobileNotifications: () => Promise<void>;
  refreshCustomerStatement: () => Promise<void>;
  getCustomerPriceHistory: (customerId: string) => Promise<Record<string, CustomerPriceHistoryEntry[]>>;
  triggerManualSync: () => Promise<void>;
  exportBackup: () => Promise<void>;
  importBackup: (fileContent: string) => Promise<{ success: boolean; error?: string }>;
  resetSystemToFresh: () => Promise<void>;
  refreshData: () => Promise<void>;

  // Products & Inventory
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<{ success: boolean; error?: string }>;
  deleteImportedProducts: (payload?: { batchId?: string; deleteAllImported?: boolean }) => Promise<{ success: boolean; deletedCount?: number; skippedCount?: number; skippedItems?: Array<{ id: string; name: string; code: string }>; error?: string }>;
  toggleProductStatus: (id: string) => Promise<{ success: boolean; error?: string }>;
  transferStock: (productId: string, fromWarehouseId: string, toWarehouseId: string, quantity: number, notes: string) => Promise<{ success: boolean; error?: string }>;
  adjustStock: (productId: string, warehouseId: string, newQuantity: number, reason: string) => Promise<void>;
  recordDamagedStock: (productId: string, warehouseId: string, quantity: number, reason: string) => Promise<void>;

  // Categories
  categories: ProductCategory[];
  addCategory: (name: string, description?: string) => Promise<{ success: boolean; category?: ProductCategory; error?: string }>;
  updateCategory: (id: string, updates: Partial<ProductCategory>) => Promise<void>;
  toggleCategoryStatus: (id: string) => Promise<void>;

  // Warehouses
  addWarehouse: (wh: Omit<Warehouse, 'id'>) => Promise<{ success: boolean; error?: string; warehouse?: Warehouse }>;
  updateWarehouse: (id: string, updates: Partial<Warehouse>) => Promise<void>;
  toggleWarehouseStatus: (id: string) => Promise<{ success: boolean; error?: string }>;
  ensureRepVanWarehouse: (repName: string) => Promise<{ success: boolean; warehouse?: Warehouse; error?: string }>;

  // Customers & Suppliers
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'currentBalance' | 'priceHistory'>) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<{ success: boolean; error?: string }>;
  linkCustomerUser: (customerId: string, payload: { existingUserId?: string; createUser?: { fullName?: string; username: string; password: string; phone?: string; mustChangePassword?: boolean } }) => Promise<{ success: boolean; customer?: Customer; user?: User; error?: string }>;
  toggleCustomerUserStatus: (customerId: string, isActive: boolean) => Promise<{ success: boolean; isActive?: boolean; error?: string }>;
  recordCustomerPayment: (customerId: string, amount: number, cashboxId: string, notes: string, paymentMethod?: 'cash' | 'bank' | 'cheque') => Promise<{ success: boolean; error?: string }>;

  addSupplier: (supplier: Omit<Supplier, 'id' | 'createdAt' | 'currentBalance'>) => Promise<Supplier>;
  updateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  recordSupplierPayment: (supplierId: string, amount: number, cashboxId: string, notes: string) => Promise<{ success: boolean; error?: string }>;

  // Sales & Purchases
  createSalesInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  createPurchaseInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  confirmDraftInvoice: (invoiceId: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  cancelInvoice: (invoiceId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  addInvoicePayment: (invoiceId: string, payment: { amount: number; date?: string; paymentMethod: 'cash' | 'bank' | 'cheque'; cashboxId: string; notes?: string }) => Promise<{ success: boolean; error?: string }>;
  editSalesInvoice: (invoiceId: string, updates: { date?: string; items?: Invoice['items']; discountTotal?: number; notes?: string }) => Promise<{ success: boolean; error?: string }>;

  // Returns
  createReturn: (returnData: Omit<InvoiceReturn, 'id' | 'returnNumber' | 'createdAt' | 'createdBy'>) => Promise<{ success: boolean; error?: string }>;

  // Financial & Cashboxes
  addCashbox: (cashbox: Omit<Cashbox, 'id' | 'currentBalance'>) => Promise<void>;
  updateCashbox: (id: string, updates: Partial<Cashbox>) => Promise<void>;
  transferBetweenCashboxes: (fromCashboxId: string, toCashboxId: string, amount: number, notes: string) => Promise<{ success: boolean; error?: string }>;
  addExpenseIncome: (record: Omit<ExpenseIncomeRecord, 'id' | 'recordNumber' | 'createdAt' | 'createdBy'>) => Promise<void>;

  // Cheques & Installments
  addCheque: (cheque: Omit<Cheque, 'id' | 'createdAt'>) => Promise<void>;
  updateChequeStatus: (id: string, newStatus: Cheque['status'], cashboxId?: string, notes?: string) => Promise<void>;
  addInstallmentSchedule: (schedule: Omit<InstallmentSchedule, 'id' | 'createdAt' | 'scheduleNumber' | 'paidAmount' | 'remainingAmount'>) => Promise<void>;
  payInstallment: (scheduleId: string, installmentItemId: string, amount: number, cashboxId: string, notes?: string) => Promise<void>;

  // Representatives & Transfers
  addRepresentative: (rep: Omit<Representative, 'id' | 'currentBalance'>) => Promise<void>;
  updateRepresentative: (id: string, updates: Partial<Representative>) => Promise<void>;
  createRepTransfer: (transfer: {
    direction: 'owner_to_rep' | 'rep_to_owner';
    senderId: string;
    senderName: string;
    receiverId: string;
    receiverName: string;
    amount: number;
    cashboxId: string;
    notes?: string;
  }) => Promise<{ success: boolean; error?: string; transfer?: RepTransfer }>;
  confirmRepTransferReceipt: (transferId: string, note?: string) => Promise<{ success: boolean; error?: string }>;
  rejectRepTransfer: (transferId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  createRepItemTransfer: (transferData: Omit<RepItemTransferRequest, 'id' | 'requestNumber' | 'createdAt' | 'status' | 'createdBy'>) => Promise<{ success: boolean; request?: RepItemTransferRequest; error?: string }>;
  updateRepItemTransferStatus: (requestId: string, newStatus: RepItemTransferStatus, approvedItems?: RepTransferItem[], notes?: string) => Promise<{ success: boolean; error?: string }>;

  // Customer Orders Lifecycle
  createCustomerItemOrder: (payload: Omit<CustomerItemOrderRequest, 'id' | 'requestNumber' | 'status' | 'createdAt'> & { idempotencyKey?: string }) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; queuedOffline?: boolean; error?: string }>;
  approveCustomerItemOrder: (id: string, notes?: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  rejectCustomerItemOrder: (id: string, reason: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  convertOrderToInvoice: (orderId: string, invoicePayload: Partial<Invoice>) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; invoice?: Invoice; error?: string }>;
  updateCustomerItemOrder: (id: string, status: CustomerItemOrderRequest['status'], reason?: string) => Promise<{ success: boolean; error?: string }>;

  // Employees & Payroll
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<{ success: boolean; error?: string }>;
  updateEmployee: (id: string, updates: Partial<Employee>) => Promise<{ success: boolean; error?: string }>;
  recordAttendance: (attendance: Omit<AttendanceRecord, 'id'>) => Promise<{ success: boolean; error?: string }>;
  addAdvanceDeduction: (item: Omit<EmployeeAdvanceDeduction, 'id' | 'createdAt' | 'isSettled'>) => Promise<{ success: boolean; error?: string }>;
  paySalary: (payroll: Omit<SalaryPayroll, 'id' | 'payrollNumber'>) => Promise<{ success: boolean; error?: string }>;

  // Users & Settings
  auditLogs: AuditLogItem[];
  addUser: (userData: Omit<User, 'id' | 'createdAt'> & { password?: string; linkedCustomerId?: string }) => Promise<{ success: boolean; user?: User; error?: string }>;
  updateUser: (id: string, updates: Partial<User> & { newPassword?: string }) => Promise<{ success: boolean; error?: string }>;
  deleteUser: (id: string) => Promise<{ success: boolean; error?: string }>;
  updateSettings: (newSettings: Partial<SystemSettings>) => Promise<void>;

  // Server & Connectivity
  updateServerSettings: (newSettings: Partial<ServerConnectionSettings>) => Promise<void>;
  testServerConnection: () => Promise<{ success: boolean; latencyMs: number; error?: string }>;

  // Database Migration & Integrity
  migrationLogs: MigrationLogEntry[];
  runMigration: (executedBy?: string, isTestRun?: boolean) => Promise<{ success: boolean; log?: MigrationLogEntry; error?: string }>;
  rollbackMigration: (backupFile?: string) => Promise<{ success: boolean; error?: string }>;

  // Cash Operations & Global Category Rename
  executeCashOperation: (payload: CashOperationPayload) => Promise<{ success: boolean; transaction?: FinancialTransaction; expenseIncomeRecord?: ExpenseIncomeRecord; error?: string }>;
  renameCategoryGlobal: (categoryId: string, name: string) => Promise<{ success: boolean; error?: string }>;

  // Owner Personal Accounts
  ownerAccounts: OwnerPersonalAccount[];
  ownerTransactions: OwnerPersonalTransaction[];
  createOwnerAccount: (payload: { ownerName: string; accountName: string; description?: string; openingBalance?: number; notes?: string }) => Promise<{ success: boolean; account?: OwnerPersonalAccount; error?: string }>;
  updateOwnerAccount: (id: string, updates: Partial<OwnerPersonalAccount>) => Promise<{ success: boolean; account?: OwnerPersonalAccount; error?: string }>;
  createOwnerTransaction: (accountId: string, payload: { type: OwnerPersonalTransaction['type']; amount: number; date?: string; cashboxId?: string; reason?: string; notes?: string; idempotencyKey?: string }) => Promise<{ success: boolean; transaction?: OwnerPersonalTransaction; account?: OwnerPersonalAccount; error?: string }>;
  editOwnerTransaction: (txId: string, updates: { amount?: number; date?: string; notes?: string; reason: string }) => Promise<{ success: boolean; transaction?: OwnerPersonalTransaction; error?: string }>;

  // Stock Counts (Inventory Audit)
  stockCounts: StockCountSession[];
  createStockCount: (payload: { warehouseId: string; date?: string; notes?: string; items: Array<{ productId: string; actualQty: number; reason?: string }> }) => Promise<{ success: boolean; count?: StockCountSession; error?: string }>;
  updateStockCount: (id: string, payload: { date?: string; notes?: string; items: Array<{ productId: string; actualQty: number; reason?: string }> }) => Promise<{ success: boolean; count?: StockCountSession; error?: string }>;
  submitStockCount: (id: string) => Promise<{ success: boolean; count?: StockCountSession; error?: string }>;
  approveStockCount: (id: string, payload?: { reconcileMode?: 'apply_delta' | 'set_actual' | null; notes?: string }) => Promise<{ success: boolean; count?: StockCountSession; code?: string; diverged?: any[]; error?: string }>;
  rejectStockCount: (id: string, reason: string) => Promise<{ success: boolean; count?: StockCountSession; error?: string }>;

  // Multi-Item Stock Transfer Requests
  stockTransferRequests: StockTransferRequest[];
  createStockTransferRequest: (payload: { sourceWarehouseId?: string; targetWarehouseId?: string; sourceRepId?: string; sourceRepName?: string; targetRepId?: string; targetRepName?: string; date?: string; reason?: string; notes?: string; transferType?: string; items: Array<{ productId: string; unit?: string; unitFactor?: number; requestedQty: number; notes?: string }> }) => Promise<{ success: boolean; transfer?: StockTransferRequest; error?: string }>;
  submitStockTransferRequest: (id: string) => Promise<{ success: boolean; transfer?: StockTransferRequest; error?: string }>;
  approveStockTransferRequest: (id: string, notes?: string) => Promise<{ success: boolean; transfer?: StockTransferRequest; error?: string }>;
  rejectStockTransferRequest: (id: string, reason: string) => Promise<{ success: boolean; transfer?: StockTransferRequest; error?: string }>;
  executeStockTransferRequest: (id: string) => Promise<{ success: boolean; transfer?: StockTransferRequest; error?: string }>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, isAuthenticated } = useAuth();
  const [data, setData] = useState<DatabaseState>(() => getEmptyClientDatabaseState());
  const [networkStatus, setNetworkStatus] = useState<NetworkSyncStatus>('connected');
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString('ar-EG'));
  const [offlineQueue, setOfflineQueue] = useState<QueuedCustomerOrder[]>(() => loadOfflineOrdersQueue());
  const [lastError, setLastError] = useState<string | null>(null);
  const [isInitialLoaded, setIsInitialLoaded] = useState<boolean>(false);
  const [isUsingOfflineCache, setIsUsingOfflineCache] = useState<boolean>(false);
  const [lastCacheTimestamp, setLastCacheTimestamp] = useState<string | null>(null);
  const [customerStatement, setCustomerStatement] = useState<CustomerStatementResponse | null>(null);
  const [mobileNotifications, setMobileNotifications] = useState<MobileNotificationItem[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);

  const loadRoleScopedData = useCallback(async () => {
    if (!isAuthenticated || !currentUser) {
      setData(getEmptyClientDatabaseState());
      setCustomerStatement(null);
      setMobileNotifications([]);
      setIsUsingOfflineCache(false);
      setLastCacheTimestamp(null);
      setIsInitialLoaded(true);
      return;
    }

    try {
      if (currentUser.role === 'customer') {
        const [meRes, prodRes, catRes, ordRes, myInvRes, stmtRes] = await Promise.all([
          apiRequest<{ ok: boolean; customer: Customer | null }>('/api/customers/me'),
          apiRequest<{ ok: boolean; products: Product[] }>('/api/products'),
          apiRequest<{ ok: boolean; categories: ProductCategory[] }>('/api/products/categories'),
          apiRequest<{ ok: boolean; orders: CustomerItemOrderRequest[] }>('/api/orders'),
          apiRequest<{ ok: boolean; invoices: Invoice[]; returns: InvoiceReturn[] }>('/api/invoices/my').catch(() => ({
            invoices: [] as Invoice[],
            returns: [] as InvoiceReturn[],
          })),
          apiRequest<{ ok: boolean } & CustomerStatementResponse>('/api/customers/me/statement').catch(() => null),
        ]);

        const nextStateBase: DatabaseState = {
          ...getEmptyClientDatabaseState(),
          customers: meRes.customer ? [meRes.customer] : [],
          products: prodRes.products || [],
          categories: catRes.categories || [],
          customerItemOrders: ordRes.orders || [],
          invoices: myInvRes.invoices || [],
          invoiceReturns: myInvRes.returns || [],
        };
        const nextStmt = stmtRes
          ? {
              customer: stmtRes.customer || null,
              allowPriceView: stmtRes.allowPriceView,
              summary: stmtRes.summary,
              entries: stmtRes.entries || [],
            }
          : null;

        setData((prev) => ({
          ...nextStateBase,
          serverSettings: prev.serverSettings,
        }));
        setCustomerStatement(nextStmt);
        saveReadCache(currentUser.id, currentUser.role, {
          dbState: nextStateBase,
          customerStatement: nextStmt,
        });
        setIsUsingOfflineCache(false);
        setLastCacheTimestamp(null);
      } else {
        const [bootRes, migRes] = await Promise.all([
          apiRequest<{ ok: boolean; data: any }>('/api/admin/bootstrap'),
          currentUser.role === 'admin' || currentUser.permissions?.canManageSettings
            ? apiRequest<{ ok: boolean; logs: MigrationLogEntry[] }>('/api/admin/migration/logs').catch(() => ({ logs: [] }))
            : Promise.resolve({ logs: [] }),
        ]);
        const d = bootRes.data || {};
        const nextStateBase: DatabaseState = {
          ...getEmptyClientDatabaseState(),
          ...d,
          migrationLogs: migRes.logs || [],
        };
        setData((prev) => ({
          ...nextStateBase,
          serverSettings: prev.serverSettings,
        }));
        setCustomerStatement(null);
        if (currentUser.role === 'representative') {
          saveReadCache(currentUser.id, currentUser.role, { dbState: nextStateBase });
        }
        setIsUsingOfflineCache(false);
        setLastCacheTimestamp(null);
      }
      setNetworkStatus(offlineQueue.length > 0 ? 'pending' : 'connected');
      setLastSyncTime(new Date().toLocaleTimeString('ar-EG'));
      setLastError(null);
    } catch (err: any) {
      const canUseCache =
        (currentUser.role === 'customer' || currentUser.role === 'representative') &&
        err?.status === 0;
      if (canUseCache) {
        const cached = loadReadCache<{ dbState: DatabaseState; customerStatement?: CustomerStatementResponse | null }>(
          currentUser.id,
          currentUser.role
        );
        if (cached?.data?.dbState) {
          setData((prev) => ({
            ...getEmptyClientDatabaseState(),
            ...cached.data.dbState,
            serverSettings: prev.serverSettings,
          }));
          if (cached.data.customerStatement) {
            setCustomerStatement(cached.data.customerStatement);
          }
          setIsUsingOfflineCache(true);
          setLastCacheTimestamp(cached.cachedAt);
        }
      }
      setLastError(err?.message || 'تعذر مزامنة البيانات مع السيرفر');
      setNetworkStatus(err?.status === 0 ? 'disconnected' : 'error');
    } finally {
      setIsInitialLoaded(true);
    }
  }, [isAuthenticated, currentUser, offlineQueue.length]);

  useEffect(() => {
    loadRoleScopedData();
  }, [loadRoleScopedData]);

  // Mobile Notifications Polling + Native Local Notifications
  useEffect(() => {
    if (!currentUser) {
      setReadNotificationIds([]);
      return;
    }
    try {
      const savedRead = localStorage.getItem(`awlad_selim_read_notifs_${currentUser.id}`);
      setReadNotificationIds(savedRead ? JSON.parse(savedRead) : []);
    } catch {
      setReadNotificationIds([]);
    }
  }, [currentUser?.id]);

  const refreshMobileNotifications = useCallback(async () => {
    if (
      !isAuthenticated ||
      !currentUser ||
      (currentUser.role !== 'customer' && currentUser.role !== 'representative')
    ) {
      return;
    }
    try {
      const res = await apiRequest<{ ok: boolean; notifications: MobileNotificationItem[] }>(
        '/api/mobile/notifications'
      );
      const list = Array.isArray(res.notifications) ? res.notifications : [];
      setMobileNotifications(list);

      const seenKey = `awlad_selim_seen_notifs_${currentUser.id}`;
      let seen: string[] = [];
      try {
        const raw = localStorage.getItem(seenKey);
        seen = raw ? JSON.parse(raw) : [];
      } catch {
        seen = [];
      }

      if (seen.length === 0) {
        // Seed initial state cleanly without blasting notifications on first launch
        try {
          localStorage.setItem(seenKey, JSON.stringify(list.map((n) => n.id)));
        } catch {
          // ignore
        }
      } else {
        const unseen = list.filter((n) => !seen.includes(n.id));
        if (unseen.length > 0) {
          for (const item of unseen.slice(0, 3)) {
            let hash = 0;
            for (let i = 0; i < item.id.length; i += 1) {
              hash = (hash * 31 + item.id.charCodeAt(i)) | 0;
            }
            notifyLocal({
              id: Math.abs(hash) + 1,
              title: item.title,
              body: item.body,
              extra: { targetTab: item.targetTab, referenceId: item.referenceId },
            }).catch(() => {});
          }
          try {
            localStorage.setItem(
              seenKey,
              JSON.stringify(Array.from(new Set([...seen, ...list.map((n) => n.id)])))
            );
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // keep existing notifications silently if offline
    }
  }, [isAuthenticated, currentUser]);

  const markNotificationsRead = useCallback(() => {
    if (!currentUser) return;
    const ids = mobileNotifications.map((n) => n.id);
    setReadNotificationIds(ids);
    try {
      localStorage.setItem(`awlad_selim_read_notifs_${currentUser.id}`, JSON.stringify(ids));
    } catch {
      // ignore
    }
  }, [currentUser, mobileNotifications]);

  const unreadNotificationCount = mobileNotifications.filter(
    (n) => !readNotificationIds.includes(n.id)
  ).length;

  useEffect(() => {
    if (
      !isAuthenticated ||
      (currentUser?.role !== 'customer' && currentUser?.role !== 'representative')
    ) {
      return;
    }
    refreshMobileNotifications();
    const timer = window.setInterval(() => {
      if (navigator.onLine) {
        refreshMobileNotifications();
      }
    }, 45000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, currentUser?.role, refreshMobileNotifications]);

  const refreshCustomerStatement = useCallback(async () => {
    if (!isAuthenticated || currentUser?.role !== 'customer') return;
    try {
      const res = await apiRequest<{ ok: boolean } & CustomerStatementResponse>('/api/customers/me/statement');
      setCustomerStatement({
        customer: res.customer || null,
        allowPriceView: res.allowPriceView,
        summary: res.summary,
        entries: res.entries || [],
      });
    } catch {
      // ignore if offline
    }
  }, [isAuthenticated, currentUser?.role]);

  const getCustomerPriceHistory = useCallback(
    async (customerId: string): Promise<Record<string, CustomerPriceHistoryEntry[]>> => {
      if (!customerId) return {};
      try {
        const res = await apiRequest<{ ok: boolean; priceHistory: Record<string, CustomerPriceHistoryEntry[]> }>(
          `/api/customers/${customerId}/price-history`
        );
        return res.priceHistory || {};
      } catch {
        // fallback to cached customer record if offline
        const cust = data.customers.find((c) => c.id === customerId);
        if (!cust?.priceHistory) return {};
        const fallback: Record<string, CustomerPriceHistoryEntry[]> = {};
        for (const [pid, arr] of Object.entries(cust.priceHistory)) {
          fallback[pid] = (Array.isArray(arr) ? arr : []).map((entry) =>
            typeof entry === 'number' ? { price: entry, date: '' } : entry
          );
        }
        return fallback;
      }
    },
    [data.customers]
  );

  // Flush queued customer orders when connection recovers
  const flushOfflineOrders = useCallback(async () => {
    if (!isAuthenticated || currentUser?.role !== 'customer') return;
    const queue = loadOfflineOrdersQueue();
    if (!queue.length) return;

    const remaining: QueuedCustomerOrder[] = [];
    for (const entry of queue) {
      try {
        await apiRequest('/api/orders', {
          method: 'POST',
          body: entry.payload,
          idempotencyKey: entry.idempotencyKey,
        });
      } catch (err: any) {
        if (err?.status === 0) {
          remaining.push(entry);
        }
        // 4xx validation errors are dropped from queue rather than looping infinitely
      }
    }
    saveOfflineOrdersQueue(remaining);
    setOfflineQueue(remaining);
    if (remaining.length < queue.length) {
      await loadRoleScopedData();
    }
  }, [isAuthenticated, currentUser, loadRoleScopedData]);

  useEffect(() => {
    const unsubscribe = subscribeNetworkStatus((connected) => {
      if (connected && isAuthenticated) {
        flushOfflineOrders();
        if (currentUser?.role === 'customer' || currentUser?.role === 'representative') {
          loadRoleScopedData();
          refreshMobileNotifications();
        }
      } else if (!connected) {
        setNetworkStatus('disconnected');
      }
    });
    const interval = window.setInterval(() => {
      if (isAuthenticated && navigator.onLine) {
        flushOfflineOrders();
      }
    }, 15000);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [isAuthenticated, currentUser?.role, flushOfflineOrders, loadRoleScopedData, refreshMobileNotifications]);

  const triggerManualSync = async () => {
    setNetworkStatus('synchronizing');
    await flushOfflineOrders();
    await loadRoleScopedData();
    await refreshMobileNotifications();
  };

  // Backup Export & Restore
  const exportBackup = async () => {
    const res = await apiRequest<{ ok: boolean; backup: any }>('/api/admin/backup/export');
    const json = JSON.stringify(res.backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AWLAD_SELIM_BACKUP_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (fileContent: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const parsed = JSON.parse(fileContent);
      await apiRequest('/api/admin/backup/restore', {
        method: 'POST',
        body: { backup: parsed },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'ملف النسخة الاحتياطية غير صالح أو فشل الاستعادة' };
    }
  };

  const resetSystemToFresh = async () => {
    // Intentionally disabled in production for safety
  };

  // Products & Categories
  const addProduct = async (product: Omit<Product, 'id' | 'createdAt'>): Promise<Product> => {
    const res = await apiRequest<{ ok: boolean; product: Product }>('/api/products', {
      method: 'POST',
      body: product,
    });
    await loadRoleScopedData();
    return res.product;
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    await apiRequest(`/api/products/${id}`, { method: 'PUT', body: updates });
    await loadRoleScopedData();
  };

  const deleteProduct = async (id: string) => {
    try {
      await apiRequest(`/api/products/${id}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر حذف الصنف' };
    }
  };

  const deleteImportedProducts = async (payload: { batchId?: string; deleteAllImported?: boolean } = {}) => {
    try {
      const res = await apiRequest<{
        ok: boolean;
        deletedCount: number;
        skippedCount: number;
        skippedItems: Array<{ id: string; name: string; code: string }>;
      }>('/api/products/delete-imported', {
        method: 'POST',
        body: payload,
      });
      await loadRoleScopedData();
      return {
        success: true,
        deletedCount: res.deletedCount,
        skippedCount: res.skippedCount,
        skippedItems: res.skippedItems || [],
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر حذف الأصناف المستوردة' };
    }
  };

  const toggleProductStatus = async (id: string) => {
    const prod = data.products.find((p) => p.id === id);
    if (!prod) return { success: false, error: 'الصنف غير موجود' };
    try {
      await updateProduct(id, { status: prod.status === 'active' ? 'archived' : 'active' });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  };

  const transferStock = async (productId: string, fromWarehouseId: string, toWarehouseId: string, quantity: number, notes: string) => {
    try {
      await apiRequest('/api/inventory/transfer', {
        method: 'POST',
        body: { productId, fromWarehouseId, toWarehouseId, quantity, notes },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر التحويل المخزني' };
    }
  };

  const adjustStock = async (productId: string, warehouseId: string, newQuantity: number, reason: string) => {
    await apiRequest('/api/inventory/adjust', {
      method: 'POST',
      body: { productId, warehouseId, newQuantity, reason },
    });
    await loadRoleScopedData();
  };

  const recordDamagedStock = async (productId: string, warehouseId: string, quantity: number, reason: string) => {
    await apiRequest('/api/inventory/damaged', {
      method: 'POST',
      body: { productId, warehouseId, quantity, reason },
    });
    await loadRoleScopedData();
  };

  const addCategory = async (name: string, description = '') => {
    try {
      const res = await apiRequest<{ ok: boolean; category: ProductCategory }>('/api/products/categories', {
        method: 'POST',
        body: { name, description },
      });
      await loadRoleScopedData();
      return { success: true, category: res.category };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إضافة التصنيف' };
    }
  };

  const updateCategory = async (id: string, updates: Partial<ProductCategory>) => {
    await apiRequest(`/api/products/categories/${id}`, { method: 'PUT', body: updates });
    await loadRoleScopedData();
  };

  const toggleCategoryStatus = async (id: string) => {
    const cat = (data.categories || []).find((c) => c.id === id);
    if (!cat) return;
    await updateCategory(id, { status: cat.status === 'active' ? 'suspended' : 'active' });
  };

  // Warehouses
  const addWarehouse = async (wh: Omit<Warehouse, 'id'>) => {
    try {
      const res = await apiRequest<{ ok: boolean; warehouse: Warehouse }>('/api/inventory/warehouses', {
        method: 'POST',
        body: wh,
      });
      await loadRoleScopedData();
      return { success: true, warehouse: res.warehouse };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إضافة المستودع' };
    }
  };

  const updateWarehouse = async (id: string, updates: Partial<Warehouse>) => {
    await apiRequest(`/api/inventory/warehouses/${id}`, { method: 'PUT', body: updates });
    await loadRoleScopedData();
  };

  const toggleWarehouseStatus = async (id: string) => {
    const wh = data.warehouses.find((w) => w.id === id);
    if (!wh) return { success: false, error: 'المستودع غير موجود' };
    try {
      await updateWarehouse(id, { status: wh.status === 'suspended' ? 'active' : 'suspended' });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  };

  const ensureRepVanWarehouse = async (repName: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; warehouse: Warehouse }>('/api/inventory/rep-van-warehouse', {
        method: 'POST',
        body: { repName },
      });
      await loadRoleScopedData();
      return { success: true, warehouse: res.warehouse };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  };

  // Customers & Suppliers
  const addCustomer = async (custData: Omit<Customer, 'id' | 'createdAt' | 'currentBalance' | 'priceHistory'>): Promise<Customer> => {
    const res = await apiRequest<{ ok: boolean; customer: Customer }>('/api/customers', {
      method: 'POST',
      body: custData,
    });
    await loadRoleScopedData();
    return res.customer;
  };

  const updateCustomer = async (id: string, updates: Partial<Customer>) => {
    await apiRequest(`/api/customers/${id}`, { method: 'PUT', body: updates });
    await loadRoleScopedData();
  };

  const deleteCustomer = async (id: string) => {
    try {
      await apiRequest(`/api/customers/${id}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر حذف العميل' };
    }
  };

  const linkCustomerUser = async (
    customerId: string,
    payload: { existingUserId?: string; createUser?: { fullName?: string; username: string; password: string; phone?: string; mustChangePassword?: boolean } }
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; customer: Customer; user?: User }>(`/api/customers/${customerId}/link-user`, {
        method: 'POST',
        body: payload,
      });
      await loadRoleScopedData();
      return { success: true, customer: res.customer, user: res.user };
    } catch (err: any) {
      return { success: false, error: err?.message || 'فشل ربط حساب العميل' };
    }
  };

  const toggleCustomerUserStatus = async (customerId: string, isActive: boolean) => {
    try {
      const res = await apiRequest<{ ok: boolean; isActive: boolean }>(`/api/customers/${customerId}/toggle-user-status`, {
        method: 'POST',
        body: { isActive },
      });
      await loadRoleScopedData();
      return { success: true, isActive: res.isActive };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحديث حالة حساب العميل' };
    }
  };

  const recordCustomerPayment = async (
    customerId: string,
    amount: number,
    cashboxId: string,
    notes: string,
    paymentMethod: 'cash' | 'bank' | 'cheque' = 'cash'
  ) => {
    try {
      await apiRequest(`/api/customers/${customerId}/payment`, {
        method: 'POST',
        body: { amount, cashboxId, notes, paymentMethod },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'فشل تسجيل التحصيل' };
    }
  };

  const addSupplier = async (suppData: Omit<Supplier, 'id' | 'createdAt' | 'currentBalance'>): Promise<Supplier> => {
    const res = await apiRequest<{ ok: boolean; supplier: Supplier }>('/api/admin/suppliers', {
      method: 'POST',
      body: suppData,
    });
    await loadRoleScopedData();
    return res.supplier;
  };

  const updateSupplier = async (id: string, updates: Partial<Supplier>) => {
    await apiRequest(`/api/admin/suppliers/${id}`, { method: 'PUT', body: updates });
    await loadRoleScopedData();
  };

  const deleteSupplier = async (id: string) => {
    await apiRequest(`/api/admin/suppliers/${id}`, { method: 'DELETE' });
    await loadRoleScopedData();
  };

  const recordSupplierPayment = async (supplierId: string, amount: number, cashboxId: string, notes: string) => {
    try {
      await apiRequest('/api/admin/suppliers/payment', {
        method: 'POST',
        body: { supplierId, amount, cashboxId, notes },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'فشل سداد المورد' };
    }
  };

  // Invoices
  const createSalesInvoice = async (invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: 'إصدار فواتير المبيعات يتطلب اتصالاً مباشراً بالسيرفر المركزي (لابتوب المحل).' };
    }
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>('/api/invoices/sales', {
        method: 'POST',
        body: invoiceData,
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إنشاء فاتورة المبيعات' };
    }
  };

  const createPurchaseInvoice = async (invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => {
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>('/api/invoices/purchase', {
        method: 'POST',
        body: invoiceData,
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إنشاء فاتورة المشتريات' };
    }
  };

  const confirmDraftInvoice = async (invoiceId: string) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: 'اعتماد الفواتير يتطلب اتصالاً مباشراً بالسيرفر المركزي (لابتوب المحل).' };
    }
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>(`/api/invoices/${invoiceId}/confirm`, {
        method: 'POST',
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر اعتماد الفاتورة' };
    }
  };

  const cancelInvoice = async (invoiceId: string, reason: string) => {
    try {
      await apiRequest(`/api/invoices/${invoiceId}/cancel`, {
        method: 'POST',
        body: { reason },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إلغاء الفاتورة' };
    }
  };

  const addInvoicePayment = async (
    invoiceId: string,
    paymentData: { amount: number; date?: string; paymentMethod: 'cash' | 'bank' | 'cheque'; cashboxId: string; notes?: string }
  ) => {
    try {
      await apiRequest(`/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: paymentData,
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تسجيل الدفعة' };
    }
  };

  const editSalesInvoice = async (invoiceId: string, updates: { date?: string; items?: Invoice['items']; discountTotal?: number; notes?: string }) => {
    try {
      await apiRequest(`/api/invoices/${invoiceId}`, {
        method: 'PUT',
        body: updates,
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تعديل الفاتورة' };
    }
  };

  const createReturn = async (returnData: Omit<InvoiceReturn, 'id' | 'returnNumber' | 'createdAt' | 'createdBy'>) => {
    try {
      await apiRequest('/api/invoices/returns', {
        method: 'POST',
        body: returnData,
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إنشاء المرتجع' };
    }
  };

  // Cashboxes & Expenses
  const addCashbox = async (cb: Omit<Cashbox, 'id' | 'currentBalance'>) => {
    await apiRequest('/api/admin/cashboxes', { method: 'POST', body: cb });
    await loadRoleScopedData();
  };

  const updateCashbox = async (id: string, updates: Partial<Cashbox>) => {
    await apiRequest(`/api/admin/cashboxes/${id}`, { method: 'PUT', body: updates });
    await loadRoleScopedData();
  };

  const transferBetweenCashboxes = async (fromId: string, toId: string, amount: number, notes: string) => {
    try {
      await apiRequest('/api/admin/cashboxes/transfer', { method: 'POST', body: { fromId, toId, amount, notes } });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر التحويل بين الخزائن' };
    }
  };

  const addExpenseIncome = async (record: Omit<ExpenseIncomeRecord, 'id' | 'recordNumber' | 'createdAt' | 'createdBy'>) => {
    await apiRequest('/api/admin/expenses', { method: 'POST', body: record });
    await loadRoleScopedData();
  };

  // Cheques & Installments
  const addCheque = async (cheque: Omit<Cheque, 'id' | 'createdAt'>) => {
    await apiRequest('/api/admin/cheques', { method: 'POST', body: cheque });
    await loadRoleScopedData();
  };

  const updateChequeStatus = async (id: string, newStatus: Cheque['status'], cashboxId?: string) => {
    await apiRequest(`/api/admin/cheques/${id}/status`, { method: 'POST', body: { status: newStatus, cashboxId } });
    await loadRoleScopedData();
  };

  const addInstallmentSchedule = async (schedule: Omit<InstallmentSchedule, 'id' | 'createdAt' | 'scheduleNumber' | 'paidAmount' | 'remainingAmount'>) => {
    await apiRequest('/api/admin/installments', { method: 'POST', body: schedule });
    await loadRoleScopedData();
  };

  const payInstallment = async (scheduleId: string, installmentItemId: string, amount: number, cashboxId: string, notes?: string) => {
    await apiRequest(`/api/admin/installments/${scheduleId}/pay`, {
      method: 'POST',
      body: { installmentItemId, amount, cashboxId, notes },
    });
    await loadRoleScopedData();
  };

  // Representatives & Transfers
  const addRepresentative = async (rep: Omit<Representative, 'id' | 'currentBalance'>) => {
    await apiRequest('/api/admin/representatives', { method: 'POST', body: rep });
    await loadRoleScopedData();
  };

  const updateRepresentative = async (id: string, updates: Partial<Representative>) => {
    await apiRequest(`/api/admin/representatives/${id}`, { method: 'PUT', body: updates });
    await loadRoleScopedData();
  };

  const createRepTransfer = async (transferData: {
    direction: 'owner_to_rep' | 'rep_to_owner';
    senderId: string;
    senderName: string;
    receiverId: string;
    receiverName: string;
    amount: number;
    cashboxId: string;
    notes?: string;
  }) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: 'التحويلات النقدية تتطلب اتصالاً مباشراً بالسيرفر المركزي.' };
    }
    try {
      const res = await apiRequest<{ ok: boolean; transfer: RepTransfer }>('/api/inventory/rep-transfers', {
        method: 'POST',
        body: transferData,
      });
      await loadRoleScopedData();
      return { success: true, transfer: res.transfer };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إرسال طلب التحويل' };
    }
  };

  const confirmRepTransferReceipt = async (transferId: string, note?: string) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: 'تأكيد الاستلام النقدي يتطلب اتصالاً مباشراً بالسيرفر المركزي.' };
    }
    try {
      await apiRequest(`/api/inventory/rep-transfers/${transferId}/confirm`, { method: 'POST', body: { note } });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر اعتماد التحويل' };
    }
  };

  const rejectRepTransfer = async (transferId: string, reason: string) => {
    try {
      await apiRequest(`/api/inventory/rep-transfers/${transferId}/reject`, { method: 'POST', body: { reason } });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر رفض التحويل' };
    }
  };

  const createRepItemTransfer = async (transferData: Omit<RepItemTransferRequest, 'id' | 'requestNumber' | 'createdAt' | 'status' | 'createdBy'>) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: 'إرسال طلبات تحويل الأصناف يتطلب اتصالاً مباشراً بالسيرفر المركزي.' };
    }
    try {
      const res = await apiRequest<{ ok: boolean; request: RepItemTransferRequest }>('/api/inventory/rep-item-transfers', {
        method: 'POST',
        body: transferData,
      });
      await loadRoleScopedData();
      return { success: true, request: res.request };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إرسال طلب تحويل الأصناف' };
    }
  };

  const updateRepItemTransferStatus = async (requestId: string, newStatus: RepItemTransferStatus, approvedItems?: RepTransferItem[], notes?: string) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: 'تحديث حالة تحويل الأصناف يتطلب اتصالاً مباشراً بالسيرفر المركزي.' };
    }
    try {
      await apiRequest(`/api/inventory/rep-item-transfers/${requestId}/status`, {
        method: 'POST',
        body: { status: newStatus, approvedItems, notes },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحديث طلب التحويل' };
    }
  };

  // Customer Item Orders Lifecycle (Real Server Persistence + Honest Offline Queue)
  const createCustomerItemOrder = async (
    payload: Omit<CustomerItemOrderRequest, 'id' | 'requestNumber' | 'status' | 'createdAt'> & { idempotencyKey?: string }
  ) => {
    const idempotencyKey = payload.idempotencyKey || generateId('IDEMP');
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>('/api/orders', {
        method: 'POST',
        body: payload,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      if (err?.status === 0) {
        // Real network offline: queue with idempotency key and honestly inform caller (NOT fake success!)
        const currentQ = loadOfflineOrdersQueue();
        if (!currentQ.some((q) => q.idempotencyKey === idempotencyKey)) {
          const nextQ = [
            ...currentQ,
            {
              idempotencyKey,
              payload: {
                items: payload.items,
                notes: payload.notes,
                deliveryAddress: payload.deliveryAddress,
                geoCoordinates: payload.geoCoordinates,
                shopName: payload.shopName,
                customerPhone: payload.customerPhone,
              },
              queuedAt: new Date().toISOString(),
            },
          ];
          saveOfflineOrdersQueue(nextQ);
          setOfflineQueue(nextQ);
        }
        return {
          success: false,
          queuedOffline: true,
          error: 'لا يوجد اتصال بالسيرفر حاليًا. تم حفظ الطلب في قائمة الانتظار للإرسال التلقائي فور عودة الشبكة.',
        };
      }
      return { success: false, error: err?.message || 'تعذر إرسال الطلب للسيرفر' };
    }
  };

  const approveCustomerItemOrder = async (id: string, notes?: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(`/api/orders/${id}/approve`, {
        method: 'POST',
        body: { notes },
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر قبول الطلب' };
    }
  };

  const rejectCustomerItemOrder = async (id: string, reason: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(`/api/orders/${id}/reject`, {
        method: 'POST',
        body: { reason },
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر رفض الطلب' };
    }
  };

  const convertOrderToInvoice = async (orderId: string, invoicePayload: Partial<Invoice>) => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest; invoice: Invoice }>(
        `/api/orders/${orderId}/convert-to-invoice`,
        {
          method: 'POST',
          body: invoicePayload,
        }
      );
      await loadRoleScopedData();
      return { success: true, order: res.order, invoice: res.invoice };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحويل الطلب إلى فاتورة مبيعات' };
    }
  };

  const updateCustomerItemOrder = async (id: string, status: CustomerItemOrderRequest['status'], reason?: string) => {
    if (status === 'approved') return approveCustomerItemOrder(id, reason);
    if (status === 'rejected') return rejectCustomerItemOrder(id, reason || 'لم يتم تحديد سبب');
    return { success: false, error: 'استخدم تحويل الطلب إلى فاتورة لإكمال دورة الاعتماد' };
  };

  // Employees & HR
  const addEmployee = async (emp: Omit<Employee, 'id'>) => {
    try {
      await apiRequest('/api/admin/employees', { method: 'POST', body: emp });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إضافة الموظف' };
    }
  };

  const updateEmployee = async (id: string, updates: Partial<Employee>) => {
    try {
      await apiRequest(`/api/admin/employees/${id}`, { method: 'PUT', body: updates });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحديث بيانات الموظف' };
    }
  };

  const recordAttendance = async (attendance: Omit<AttendanceRecord, 'id'>) => {
    try {
      await apiRequest('/api/admin/attendance', { method: 'POST', body: attendance });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تسجيل الحضور' };
    }
  };

  const addAdvanceDeduction = async (item: Omit<EmployeeAdvanceDeduction, 'id' | 'createdAt' | 'isSettled'>) => {
    try {
      await apiRequest('/api/admin/advances', { method: 'POST', body: item });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تسجيل السلفة أو الخصم' };
    }
  };

  const paySalary = async (payroll: Omit<SalaryPayroll, 'id' | 'payrollNumber'>) => {
    try {
      await apiRequest('/api/admin/payrolls', { method: 'POST', body: payroll });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر صرف الراتب' };
    }
  };

  // Users & Settings
  const addUser = async (userData: Omit<User, 'id' | 'createdAt'> & { password?: string; linkedCustomerId?: string }) => {
    try {
      const res = await apiRequest<{ ok: boolean; user: User }>('/api/admin/users', {
        method: 'POST',
        body: userData,
      });
      await loadRoleScopedData();
      return { success: true, user: res.user };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إنشاء المستخدم' };
    }
  };

  const updateUser = async (id: string, updates: Partial<User> & { newPassword?: string }) => {
    try {
      await apiRequest(`/api/admin/users/${id}`, { method: 'PUT', body: updates });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحديث المستخدم' };
    }
  };

  const deleteUser = async (id: string) => {
    try {
      await apiRequest(`/api/admin/users/${id}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر حذف المستخدم' };
    }
  };

  const updateSettings = async (newSettings: Partial<SystemSettings>) => {
    await apiRequest('/api/admin/settings', { method: 'PUT', body: newSettings });
    await loadRoleScopedData();
  };

  const updateServerSettings = async (newSettings: Partial<ServerConnectionSettings>) => {
    if (newSettings.apiBaseUrl !== undefined) {
      setConfiguredApiBaseUrl(newSettings.apiBaseUrl);
    }
    setData((prev) => ({
      ...prev,
      serverSettings: { ...(prev.serverSettings as ServerConnectionSettings), ...newSettings },
    }));
  };

  const testServerConnection = async (): Promise<{ success: boolean; latencyMs: number; error?: string }> => {
    const start = performance.now();
    try {
      const base = getConfiguredApiBaseUrl();
      const res = await fetch(`${base}/api/health`);
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) return { success: false, latencyMs, error: `استجابة غير صالحة (${res.status})` };
      setNetworkStatus('connected');
      return { success: true, latencyMs };
    } catch {
      return {
        success: false,
        latencyMs: Math.round(performance.now() - start),
        error: 'تعذر الاتصال بالسيرفر، تأكد من تشغيل خدمة الخادم وعنوان الشبكة.',
      };
    }
  };

  const runMigration = async (executedBy?: string, isTestRun = false) => {
    try {
      const res = await apiRequest<{ ok: boolean; log: MigrationLogEntry }>('/api/admin/migration/run', {
        method: 'POST',
        body: { executedBy, isTestRun },
      });
      await loadRoleScopedData();
      return { success: true, log: res.log };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تنفيذ الترحيل' };
    }
  };

  const rollbackMigration = async (backupFile?: string) => {
    try {
      await apiRequest('/api/admin/migration/rollback', { method: 'POST', body: { backupFile } });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر التراجع عن الترحيل' };
    }
  };

  // v4 Cash Operations
  const executeCashOperation = async (payload: CashOperationPayload) => {
    const idempotencyKey = payload.idempotencyKey || generateId('CASH');
    try {
      const res = await apiRequest<{
        ok: boolean;
        transaction?: FinancialTransaction;
        expenseIncomeRecord?: ExpenseIncomeRecord;
      }>('/api/admin/cash-operations', {
        method: 'POST',
        body: payload,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return {
        success: true,
        transaction: res.transaction,
        expenseIncomeRecord: res.expenseIncomeRecord,
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تنفيذ العملية النقدية' };
    }
  };

  const renameCategoryGlobal = async (categoryId: string, name: string) => {
    try {
      await apiRequest(`/api/inventory/categories/${categoryId}/rename`, {
        method: 'POST',
        body: { name },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تعديل اسم التصنيف' };
    }
  };

  // v4 Owner Personal Accounts
  const createOwnerAccount = async (payload: { ownerName: string; accountName: string; description?: string; openingBalance?: number; notes?: string }) => {
    try {
      const res = await apiRequest<{ ok: boolean; account: OwnerPersonalAccount }>('/api/personal-accounts', {
        method: 'POST',
        body: payload,
      });
      await loadRoleScopedData();
      return { success: true, account: res.account };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إنشاء الحساب الشخصي' };
    }
  };

  const updateOwnerAccount = async (id: string, updates: Partial<OwnerPersonalAccount>) => {
    try {
      const res = await apiRequest<{ ok: boolean; account: OwnerPersonalAccount }>(`/api/personal-accounts/${id}`, {
        method: 'PUT',
        body: updates,
      });
      await loadRoleScopedData();
      return { success: true, account: res.account };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحديث الحساب الشخصي' };
    }
  };

  const createOwnerTransaction = async (
    accountId: string,
    payload: { type: OwnerPersonalTransaction['type']; amount: number; date?: string; cashboxId?: string; reason?: string; notes?: string; idempotencyKey?: string }
  ) => {
    const idempotencyKey = payload.idempotencyKey || generateId('OTX');
    try {
      const res = await apiRequest<{ ok: boolean; transaction: OwnerPersonalTransaction; account: OwnerPersonalAccount }>(
        `/api/personal-accounts/${accountId}/transactions`,
        { method: 'POST', body: payload, idempotencyKey }
      );
      await loadRoleScopedData();
      return { success: true, transaction: res.transaction, account: res.account };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تسجيل الحركة الشخصية' };
    }
  };

  const editOwnerTransaction = async (
    txId: string,
    updates: { amount?: number; date?: string; notes?: string; reason: string }
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; transaction: OwnerPersonalTransaction }>(`/api/personal-accounts/transactions/${txId}`, {
        method: 'PUT',
        body: updates,
      });
      await loadRoleScopedData();
      return { success: true, transaction: res.transaction };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تعديل الحركة الشخصية' };
    }
  };

  // v4 Stock Counts
  const createStockCount = async (payload: { warehouseId: string; date?: string; notes?: string; items: Array<{ productId: string; actualQty: number; reason?: string }> }) => {
    try {
      const res = await apiRequest<{ ok: boolean; count: StockCountSession }>('/api/stock-counts', {
        method: 'POST',
        body: payload,
      });
      await loadRoleScopedData();
      return { success: true, count: res.count };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إنشاء جلسة الجرد' };
    }
  };

  const updateStockCount = async (id: string, payload: { date?: string; notes?: string; items: Array<{ productId: string; actualQty: number; reason?: string }> }) => {
    try {
      const res = await apiRequest<{ ok: boolean; count: StockCountSession }>(`/api/stock-counts/${id}`, {
        method: 'PUT',
        body: payload,
      });
      await loadRoleScopedData();
      return { success: true, count: res.count };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر حفظ تعديلات الجرد' };
    }
  };

  const submitStockCount = async (id: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; count: StockCountSession }>(`/api/stock-counts/${id}/submit`, {
        method: 'POST',
      });
      await loadRoleScopedData();
      return { success: true, count: res.count };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إرسال الجرد للاعتماد' };
    }
  };

  const approveStockCount = async (id: string, payload: { reconcileMode?: 'apply_delta' | 'set_actual' | null; notes?: string } = {}) => {
    try {
      const res = await apiRequest<{ ok: boolean; count: StockCountSession }>(`/api/stock-counts/${id}/approve`, {
        method: 'POST',
        body: payload,
      });
      await loadRoleScopedData();
      return { success: true, count: res.count };
    } catch (err: any) {
      return {
        success: false,
        code: err?.code,
        diverged: err?.details?.diverged,
        error: err?.message || 'تعذر اعتماد الجرد',
      };
    }
  };

  const rejectStockCount = async (id: string, reason: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; count: StockCountSession }>(`/api/stock-counts/${id}/reject`, {
        method: 'POST',
        body: { reason },
      });
      await loadRoleScopedData();
      return { success: true, count: res.count };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر رفض الجرد' };
    }
  };

  // v4 Multi-Item Stock Transfers
  const createStockTransferRequest = async (payload: {
    sourceWarehouseId?: string;
    targetWarehouseId?: string;
    sourceRepId?: string;
    sourceRepName?: string;
    targetRepId?: string;
    targetRepName?: string;
    date?: string;
    reason?: string;
    notes?: string;
    transferType?: string;
    items: Array<{ productId: string; unit?: string; unitFactor?: number; requestedQty: number; notes?: string }>;
  }) => {
    try {
      const res = await apiRequest<{ ok: boolean; transfer: StockTransferRequest }>('/api/stock-transfers', {
        method: 'POST',
        body: payload,
      });
      await loadRoleScopedData();
      return { success: true, transfer: res.transfer };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إنشاء طلب التحويل' };
    }
  };

  const submitStockTransferRequest = async (id: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; transfer: StockTransferRequest }>(`/api/stock-transfers/${id}/submit`, {
        method: 'POST',
      });
      await loadRoleScopedData();
      return { success: true, transfer: res.transfer };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إرسال طلب التحويل للاعتماد' };
    }
  };

  const approveStockTransferRequest = async (id: string, notes?: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; transfer: StockTransferRequest }>(`/api/stock-transfers/${id}/approve`, {
        method: 'POST',
        body: { notes },
      });
      await loadRoleScopedData();
      return { success: true, transfer: res.transfer };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر اعتماد طلب التحويل' };
    }
  };

  const rejectStockTransferRequest = async (id: string, reason: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; transfer: StockTransferRequest }>(`/api/stock-transfers/${id}/reject`, {
        method: 'POST',
        body: { reason },
      });
      await loadRoleScopedData();
      return { success: true, transfer: res.transfer };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر رفض طلب التحويل' };
    }
  };

  const executeStockTransferRequest = async (id: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; transfer: StockTransferRequest }>(`/api/stock-transfers/${id}/execute`, {
        method: 'POST',
      });
      await loadRoleScopedData();
      return { success: true, transfer: res.transfer };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تنفيذ التحويل المخزني' };
    }
  };

  if (!isInitialLoaded && isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white font-['Cairo']">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-lg font-bold">جاري مزامنة بيانات نظام أولاد سليم...</p>
        </div>
      </div>
    );
  }

  return (
    <DataContext.Provider
      value={{
        ...data,
        auditLogs: data.auditLogs || [],
        networkStatus,
        lastSyncTime,
        pendingChangesCount: offlineQueue.length,
        offlineOrdersCount: offlineQueue.length,
        lastError,
        isUsingOfflineCache,
        lastCacheTimestamp,
        customerStatement,
        mobileNotifications,
        unreadNotificationCount,
        markNotificationsRead,
        refreshMobileNotifications,
        refreshCustomerStatement,
        getCustomerPriceHistory,
        triggerManualSync,
        exportBackup,
        importBackup,
        resetSystemToFresh,
        refreshData: loadRoleScopedData,
        addProduct,
        updateProduct,
        deleteProduct,
        deleteImportedProducts,
        toggleProductStatus,
        transferStock,
        adjustStock,
        recordDamagedStock,
        categories: data.categories || [],
        addCategory,
        updateCategory,
        toggleCategoryStatus,
        addWarehouse,
        updateWarehouse,
        toggleWarehouseStatus,
        ensureRepVanWarehouse,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        linkCustomerUser,
        toggleCustomerUserStatus,
        recordCustomerPayment,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        recordSupplierPayment,
        createSalesInvoice,
        createPurchaseInvoice,
        confirmDraftInvoice,
        cancelInvoice,
        addInvoicePayment,
        editSalesInvoice,
        createReturn,
        addCashbox,
        updateCashbox,
        transferBetweenCashboxes,
        addExpenseIncome,
        addCheque,
        updateChequeStatus,
        addInstallmentSchedule,
        payInstallment,
        addRepresentative,
        updateRepresentative,
        createRepTransfer,
        confirmRepTransferReceipt,
        rejectRepTransfer,
        createRepItemTransfer,
        updateRepItemTransferStatus,
        createCustomerItemOrder,
        approveCustomerItemOrder,
        rejectCustomerItemOrder,
        convertOrderToInvoice,
        updateCustomerItemOrder,
        addEmployee,
        updateEmployee,
        recordAttendance,
        addAdvanceDeduction,
        paySalary,
        addUser,
        updateUser,
        deleteUser,
        updateSettings,
        updateServerSettings,
        testServerConnection,
        migrationLogs: data.migrationLogs || [],
        runMigration,
        rollbackMigration,
        executeCashOperation,
        renameCategoryGlobal,
        ownerAccounts: data.ownerAccounts || [],
        ownerTransactions: data.ownerTransactions || [],
        createOwnerAccount,
        updateOwnerAccount,
        createOwnerTransaction,
        editOwnerTransaction,
        stockCounts: data.stockCounts || [],
        createStockCount,
        updateStockCount,
        submitStockCount,
        approveStockCount,
        rejectStockCount,
        stockTransferRequests: data.stockTransferRequests || [],
        createStockTransferRequest,
        submitStockTransferRequest,
        approveStockTransferRequest,
        rejectStockTransferRequest,
        executeStockTransferRequest,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};

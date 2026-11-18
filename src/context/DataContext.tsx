import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  DatabaseState,
  getEmptyClientDatabaseState,
  generateId,
  loadOfflineOrdersQueue,
  saveOfflineOrdersQueue,
  saveReadCache,
  loadReadCache,
} from '../services/storage';
import { apiRequest, getConfiguredApiBaseUrl, setConfiguredApiBaseUrl } from '../services/api';
import { getOrCreatePersistentDeviceId, notifyLocal, subscribeNetworkStatus } from '../services/native';
import { localDb } from '../services/localDb';
import { enqueueSyncOperation, runSyncCycle } from '../services/syncEngine';
import { warmProductMediaCache, getCachedProductImageMap } from '../services/mediaCache';
import { normalizeServerOrigin } from '../services/offlineAuth';
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
  OrderAdvancePayment,
  SyncConflictRecord,
  SyncQueueItem,
} from '../types';
import { useAuth } from './AuthContext';

export interface DataContextType extends DatabaseState {
  networkStatus: NetworkSyncStatus;
  lastSyncTime: string;
  lastServerSyncAt: string | null;
  pendingChangesCount: number;
  offlineOrdersCount: number;
  syncQueue: SyncQueueItem[];
  syncConflicts: SyncConflictRecord[];
  isServerReachable: boolean;
  isSyncing: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  conflictsCount: number;
  hasTentativeLocalBalances: boolean;
  orderAdvancePayments: OrderAdvancePayment[];
  cachedMediaMap: Record<string, string>;
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
  triggerSync: (forceAll?: boolean) => Promise<void>;
  resolveSyncConflict: (conflictId: string, resolution: 'keep_server' | 'apply_local' | 'dismiss', notes?: string) => Promise<{ success: boolean; error?: string }>;
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
  settleSupplierAdvance: (supplierId: string, payload: { invoiceId: string; amount: number; notes?: string; date?: string }) => Promise<{ success: boolean; availableAdvanceAfter?: number; settledAmount?: number; error?: string }>;

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

  // Customer Orders Lifecycle & Advance Payments & Delivery
  createCustomerItemOrder: (payload: Omit<CustomerItemOrderRequest, 'id' | 'requestNumber' | 'status' | 'createdAt'> & { idempotencyKey?: string }) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; queuedOffline?: boolean; error?: string }>;
  reviewCustomerItemOrder: (id: string, notes?: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  approveCustomerItemOrder: (id: string, notes?: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  rejectCustomerItemOrder: (id: string, reason: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  assignOrderDeliveryRep: (id: string, repId: string, notes?: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  updateOrderDeliveryStatus: (id: string, payload: { status: string; collectedAmount?: number; deliveryNotes?: string; deliveryProof?: string }) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; queuedOffline?: boolean; error?: string }>;
  recordOrderAdvancePayment: (id: string, payload: { amount: number; cashboxId: string; paymentMethod?: 'cash' | 'bank' | 'cheque'; date?: string; notes?: string }) => Promise<{ success: boolean; advancePayment?: OrderAdvancePayment; order?: CustomerItemOrderRequest; queuedOffline?: boolean; error?: string }>;
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
  const { currentUser, customerProfile, representativeProfile, isAuthenticated, isOfflineSession, handleCentralAuthRevoked } = useAuth();
  const [data, setData] = useState<DatabaseState>(() => getEmptyClientDatabaseState());
  const [networkStatus, setNetworkStatus] = useState<NetworkSyncStatus>('connected');
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString('ar-EG'));
  const [lastServerSyncAt, setLastServerSyncAt] = useState<string | null>(null);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictRecord[]>([]);
  const [cachedMediaMap, setCachedMediaMap] = useState<Record<string, string>>({});
  const [isServerReachable, setIsServerReachable] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isInitialLoaded, setIsInitialLoaded] = useState<boolean>(false);
  const [isUsingOfflineCache, setIsUsingOfflineCache] = useState<boolean>(false);
  const [lastCacheTimestamp, setLastCacheTimestamp] = useState<string | null>(null);
  const [customerStatement, setCustomerStatement] = useState<CustomerStatementResponse | null>(null);
  const [mobileNotifications, setMobileNotifications] = useState<MobileNotificationItem[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const dataRef = useRef(data);
  dataRef.current = data;

  const refreshQueueAndConflictsFromLocal = useCallback(async (userId?: string) => {
    if (!userId) {
      setSyncQueue([]);
      setSyncConflicts([]);
      return { queue: [] as SyncQueueItem[], conflicts: [] as SyncConflictRecord[] };
    }
    const [queue, conflicts, lastAt] = await Promise.all([
      localDb.listSyncQueue(userId),
      localDb.listConflicts(userId),
      localDb.getMeta<string>('last_sync_at'),
    ]);
    setSyncQueue(queue);
    setSyncConflicts(conflicts);
    if (lastAt) setLastServerSyncAt(lastAt);
    return { queue, conflicts };
  }, []);

  const persistCurrentSnapshot = useCallback(
    async (nextState: DatabaseState, statementArg: CustomerStatementResponse | null = null) => {
      if (!currentUser?.id) return;
      const nowIso = new Date().toISOString();
      const scope: 'staff' | 'representative' | 'customer' =
        currentUser.role === 'customer'
          ? 'customer'
          : currentUser.role === 'representative'
          ? 'representative'
          : 'staff';
      await localDb.saveSnapshot({
        userId: currentUser.id,
        scope,
        serverOrigin: normalizeServerOrigin(getConfiguredApiBaseUrl()),
        cachedAt: nowIso,
        serverTime: nowIso,
        user: currentUser,
        customerProfile,
        representativeProfile,
        data: {
          ...nextState,
          customerStatement: statementArg,
        },
      });
    },
    [currentUser, customerProfile, representativeProfile]
  );

  const applyPullPayload = useCallback(
    async (pullData: any) => {
      if (!pullData || !currentUser) return;
      const nextStateBase: DatabaseState = {
        ...getEmptyClientDatabaseState(),
        ...pullData,
      };
      // If pending offline queued orders exist, keep tentative local orders visible alongside server orders
      const queue = await localDb.listSyncQueue(currentUser.id);
      const pendingOrderOps = queue.filter(
        (q) => q.operationType === 'create_order' && q.status !== 'synced'
      );
      const existingKeys = new Set((nextStateBase.customerItemOrders || []).map((o) => o.idempotencyKey).filter(Boolean));
      const tentativeOrders: CustomerItemOrderRequest[] = pendingOrderOps
        .filter((op) => !op.payload?.idempotencyKey || !existingKeys.has(op.payload.idempotencyKey))
        .map((op) => ({
          id: op.localId || op.operationId,
          requestNumber: 'بانتظار المزامنة',
          customerId: op.payload.customerId || customerProfile?.id || '',
          userId: currentUser.id,
          requesterType: op.payload.requesterType || (currentUser.role === 'representative' ? 'representative' : 'customer'),
          customerName: op.payload.customerName || customerProfile?.name || currentUser.fullName,
          customerPhone: op.payload.customerPhone || '',
          shopName: op.payload.shopName || '',
          deliveryAddress: op.payload.deliveryAddress || '',
          geoCoordinates: op.payload.geoCoordinates || '',
          items: op.payload.items || [],
          status: 'pending',
          notes: op.payload.notes || '',
          idempotencyKey: op.payload.idempotencyKey,
          createdAt: op.createdAt,
          isLocalQueued: true,
        }));

      const mergedOrders = [...tentativeOrders, ...(nextStateBase.customerItemOrders || [])];
      const mergedState: DatabaseState = {
        ...nextStateBase,
        customerItemOrders: mergedOrders,
      };

      let nextStmt: CustomerStatementResponse | null = null;
      if (pullData.statement) {
        nextStmt = {
          customer: pullData.statement.customer || null,
          allowPriceView: Boolean(pullData.statement.allowPriceView),
          invoices: pullData.statement.invoices || [],
          returns: pullData.statement.returns || [],
          advancePayments: pullData.statement.advancePayments || pullData.orderAdvancePayments || [],
          summary: pullData.statement.summary,
          entries: pullData.statement.entries || [],
        };
      }

      setData((prev) => ({
        ...mergedState,
        serverSettings: prev.serverSettings,
      }));
      setCustomerStatement(nextStmt);
      if (Array.isArray(pullData.syncConflicts)) {
        await localDb.replaceServerConflicts(pullData.syncConflicts);
        setSyncConflicts(pullData.syncConflicts);
      }

      await persistCurrentSnapshot(mergedState, nextStmt);
      saveReadCache(currentUser.id, currentUser.role, {
        dbState: mergedState,
        customerStatement: nextStmt,
      });

      const cachedImgs = await getCachedProductImageMap(mergedState.products || []);
      if (Object.keys(cachedImgs).length > 0) {
        setCachedMediaMap((prev) => ({ ...prev, ...cachedImgs }));
      }
      warmProductMediaCache(mergedState.products || [], (productId, dataUrl) => {
        setCachedMediaMap((prev) => ({ ...prev, [productId]: dataUrl }));
      }).catch(() => {});

      const syncAt = pullData.serverTime || new Date().toISOString();
      setLastServerSyncAt(syncAt);
      setLastSyncTime(new Date().toLocaleTimeString('ar-EG'));
      setIsUsingOfflineCache(false);
      setIsServerReachable(true);
      setLastCacheTimestamp(null);
      setLastError(null);
    },
    [currentUser, customerProfile, persistCurrentSnapshot]
  );

  const loadRoleScopedData = useCallback(async () => {
    if (!isAuthenticated || !currentUser) {
      setData(getEmptyClientDatabaseState());
      setCustomerStatement(null);
      setMobileNotifications([]);
      setSyncQueue([]);
      setSyncConflicts([]);
      setIsUsingOfflineCache(false);
      setLastCacheTimestamp(null);
      setIsInitialLoaded(true);
      return;
    }

    // Migrate any legacy localStorage offline orders queue into IndexedDB/Vault syncQueue
    const legacyQueue = loadOfflineOrdersQueue();
    if (legacyQueue.length > 0) {
      for (const entry of legacyQueue) {
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'create_order',
          entityType: 'order',
          localId: entry.idempotencyKey,
          summaryAr: `طلب عميل (${entry.payload.items?.length || 0} صنف)`,
          payload: {
            ...entry.payload,
            idempotencyKey: entry.idempotencyKey,
          },
        });
      }
      saveOfflineOrdersQueue([]);
    }

    const { queue } = await refreshQueueAndConflictsFromLocal(currentUser.id);
    const pendingCountNow = queue.filter((q) => q.status !== 'synced').length;

    // Load local snapshot immediately for instant offline-first hydration
    const currentOrigin = normalizeServerOrigin(getConfiguredApiBaseUrl());
    const localSnap = await localDb.getSnapshot(currentUser.id);
    if (localSnap?.data && localSnap.serverOrigin === currentOrigin) {
      const snapDb: DatabaseState = {
        ...getEmptyClientDatabaseState(),
        ...localSnap.data,
      };
      setData((prev) => ({
        ...snapDb,
        serverSettings: prev.serverSettings,
      }));
      if (localSnap.data.customerStatement) {
        setCustomerStatement(localSnap.data.customerStatement);
      }
      setIsUsingOfflineCache(true);
      setLastCacheTimestamp(localSnap.cachedAt);
      const imgMap = await getCachedProductImageMap(snapDb.products || []);
      if (Object.keys(imgMap).length > 0) {
        setCachedMediaMap((prev) => ({ ...prev, ...imgMap }));
      }
      setIsInitialLoaded(true);
    }

    if (isOfflineSession && typeof navigator !== 'undefined' && navigator.onLine === false) {
      setIsServerReachable(false);
      setNetworkStatus(pendingCountNow > 0 ? 'pending' : 'disconnected');
      setIsInitialLoaded(true);
      return;
    }

    try {
      const [pullRes, migRes] = await Promise.all([
        apiRequest<any>('/api/sync/pull', { timeoutMs: 25000 }),
        currentUser.role === 'admin' || currentUser.permissions?.canManageSettings
          ? apiRequest<{ ok: boolean; logs: MigrationLogEntry[] }>('/api/admin/migration/logs').catch(() => ({ logs: [] }))
          : Promise.resolve({ logs: [] }),
      ]);
      await applyPullPayload({ ...pullRes, migrationLogs: migRes.logs || [] });
      const postQueue = await refreshQueueAndConflictsFromLocal(currentUser.id);
      const activePending = postQueue.queue.filter((q) => q.status !== 'synced').length;
      setNetworkStatus(activePending > 0 ? 'pending' : 'connected');
    } catch (err: any) {
      if (err?.status === 401 || err?.code === 'ACCOUNT_DEACTIVATED' || err?.code === 'DEVICE_REVOKED') {
        await handleCentralAuthRevoked(err.message);
        return;
      }

      // Fallback to readCache if localDb snapshot wasn't populated yet
      if (!localSnap?.data) {
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
      setIsServerReachable(err?.status !== 0 ? true : false);
      setLastError(err?.message || 'تعذر مزامنة البيانات مع السيرفر');
      setNetworkStatus(err?.status === 0 ? (pendingCountNow > 0 ? 'pending' : 'disconnected') : 'error');
    } finally {
      setIsInitialLoaded(true);
    }
  }, [isAuthenticated, currentUser, isOfflineSession, applyPullPayload, refreshQueueAndConflictsFromLocal, handleCentralAuthRevoked]);

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
    if (!isAuthenticated || !currentUser) {
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
    if (!isAuthenticated || !currentUser) {
      return;
    }
    refreshMobileNotifications();
    const timer = window.setInterval(() => {
      if (navigator.onLine) {
        refreshMobileNotifications();
      }
    }, 45000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, currentUser?.id, refreshMobileNotifications]);

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

  const triggerSync = useCallback(
    async (forceAll = false) => {
      if (!isAuthenticated || !currentUser?.id) return;
      setIsSyncing(true);
      setNetworkStatus('synchronizing');
      try {
        const outcome = await runSyncCycle({ userId: currentUser.id, forceAll });
        setIsServerReachable(outcome.serverReachable);
        if (outcome.authRevoked) {
          await handleCentralAuthRevoked(outcome.revokeReason);
          return;
        }
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        if (outcome.ok && outcome.pullData) {
          await applyPullPayload(outcome.pullData);
          const qAfter = await localDb.listSyncQueue(currentUser.id);
          const pendingAfter = qAfter.filter((q) => q.status !== 'synced').length;
          setNetworkStatus(pendingAfter > 0 ? 'pending' : 'connected');
        } else {
          const qAfter = await localDb.listSyncQueue(currentUser.id);
          const pendingAfter = qAfter.filter((q) => q.status !== 'synced').length;
          setNetworkStatus(outcome.serverReachable ? (pendingAfter > 0 ? 'pending' : 'error') : (pendingAfter > 0 ? 'pending' : 'disconnected'));
          if (outcome.error) setLastError(outcome.error);
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [isAuthenticated, currentUser?.id, refreshQueueAndConflictsFromLocal, applyPullPayload, handleCentralAuthRevoked]
  );

  const resolveSyncConflict = useCallback(
    async (conflictId: string, resolution: 'keep_server' | 'apply_local' | 'dismiss', notes = '') => {
      try {
        await apiRequest(`/api/sync/conflicts/${conflictId}/resolve`, {
          method: 'POST',
          body: { resolution, resolutionNotes: notes },
        });
        await triggerSync(false);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || 'تعذر معالجة التعارض' };
      }
    },
    [triggerSync]
  );

  useEffect(() => {
    const unsubscribe = subscribeNetworkStatus((connected) => {
      if (connected && isAuthenticated) {
        triggerSync(false);
        refreshMobileNotifications();
      } else if (!connected) {
        setIsServerReachable(false);
        setNetworkStatus('disconnected');
      }
    });
    const onOnline = () => {
      if (isAuthenticated) {
        triggerSync(false);
        refreshMobileNotifications();
      }
    };
    window.addEventListener('online', onOnline);
    const interval = window.setInterval(() => {
      if (isAuthenticated && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        triggerSync(false);
      }
    }, 30000);
    return () => {
      unsubscribe();
      window.removeEventListener('online', onOnline);
      window.clearInterval(interval);
    };
  }, [isAuthenticated, triggerSync, refreshMobileNotifications]);

  const triggerManualSync = async () => {
    await triggerSync(true);
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
    try {
      const res = await apiRequest<{ ok: boolean; customer: Customer }>('/api/customers', {
        method: 'POST',
        body: custData,
      });
      await loadRoleScopedData();
      return res.customer;
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        const localCust: Customer = {
          ...custData,
          id: generateId('CUST-LOC'),
          currentBalance: Number(custData.openingBalance || 0),
          priceHistory: {},
          createdAt: new Date().toISOString(),
        };
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'create_customer',
          entityType: 'customer',
          localId: localCust.id,
          summaryAr: `إضافة عميل: ${localCust.name}`,
          payload: { ...custData, id: localCust.id },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        const nextDb = {
          ...dataRef.current,
          customers: [localCust, ...(dataRef.current.customers || [])],
        };
        setData(nextDb);
        await persistCurrentSnapshot(nextDb);
        setNetworkStatus('pending');
        return localCust;
      }
      throw err;
    }
  };

  const updateCustomer = async (id: string, updates: Partial<Customer>) => {
    const existing = dataRef.current.customers.find((c) => c.id === id);
    try {
      await apiRequest(`/api/customers/${id}`, {
        method: 'PUT',
        body: { ...updates, expectedVersion: existing?.version },
      });
      await loadRoleScopedData();
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'update_customer',
          entityType: 'customer',
          entityId: id,
          summaryAr: `تعديل عميل: ${existing?.name || id}`,
          payload: { customerId: id, updates, expectedVersion: existing?.version },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        const nextDb = {
          ...dataRef.current,
          customers: (dataRef.current.customers || []).map((c) => (c.id === id ? { ...c, ...updates } : c)),
        };
        setData(nextDb);
        await persistCurrentSnapshot(nextDb);
        setNetworkStatus('pending');
        return;
      }
      throw err;
    }
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
    const idempotencyKey = generateId('IDEMP');
    try {
      await apiRequest(`/api/customers/${customerId}/payment`, {
        method: 'POST',
        body: { amount, cashboxId, notes, paymentMethod },
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        const cust = dataRef.current.customers.find((c) => c.id === customerId);
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'customer_payment',
          entityType: 'customer',
          entityId: customerId,
          summaryAr: `تحصيل ${amount} من ${cust?.name || customerId}`,
          payload: { customerId, amount, cashboxId, notes, paymentMethod, idempotencyKey },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        const nextDb = {
          ...dataRef.current,
          customers: (dataRef.current.customers || []).map((c) =>
            c.id === customerId ? { ...c, currentBalance: Number(c.currentBalance || 0) - Number(amount || 0) } : c
          ),
          cashboxes: (dataRef.current.cashboxes || []).map((cb) =>
            cb.id === cashboxId ? { ...cb, currentBalance: Number(cb.currentBalance || 0) + Number(amount || 0) } : cb
          ),
        };
        setData(nextDb);
        await persistCurrentSnapshot(nextDb);
        setNetworkStatus('pending');
        return { success: true };
      }
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
        idempotencyKey: generateId('IDEMP'),
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'فشل سداد المورد' };
    }
  };

  const settleSupplierAdvance = async (
    supplierId: string,
    payload: { invoiceId: string; amount: number; notes?: string; date?: string }
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; availableAdvanceAfter?: number; settledAmount?: number }>(
        `/api/admin/suppliers/${supplierId}/settle-advance`,
        {
          method: 'POST',
          body: payload,
          idempotencyKey: generateId('IDEMP'),
        }
      );
      await loadRoleScopedData();
      return {
        success: true,
        availableAdvanceAfter: res.availableAdvanceAfter,
        settledAmount: res.settledAmount,
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تسوية الدفعة المقدمة للمورد' };
    }
  };

  // Invoices (Offline-First Queueing on Disconnection + Online Server Authority)
  const createSalesInvoice = async (invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => {
    const idempotencyKey = generateId('IDEMP');
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>('/api/invoices/sales', {
        method: 'POST',
        body: invoiceData,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        const localInvoice: Invoice = {
          ...invoiceData,
          id: generateId('INV-LOC'),
          invoiceNumber: 'قيد المزامنة',
          type: 'sales',
          createdBy: currentUser.fullName,
          createdAt: new Date().toISOString(),
        };
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'create_sales_invoice',
          entityType: 'invoice',
          localId: localInvoice.id,
          summaryAr: `فاتورة مبيعات (${invoiceData.customerName || 'عميل'}) — ${invoiceData.grandTotal}`,
          payload: { ...invoiceData, idempotencyKey },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        const nextDb = {
          ...dataRef.current,
          invoices: [localInvoice, ...(dataRef.current.invoices || [])],
        };
        setData(nextDb);
        await persistCurrentSnapshot(nextDb);
        setNetworkStatus('pending');
        return { success: true, invoice: localInvoice };
      }
      return { success: false, error: err?.message || 'تعذر إنشاء فاتورة المبيعات' };
    }
  };

  const createPurchaseInvoice = async (invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => {
    const idempotencyKey = generateId('IDEMP');
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>('/api/invoices/purchase', {
        method: 'POST',
        body: invoiceData,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        const localInvoice: Invoice = {
          ...invoiceData,
          id: generateId('PINV-LOC'),
          invoiceNumber: 'قيد المزامنة',
          type: 'purchase',
          createdBy: currentUser.fullName,
          createdAt: new Date().toISOString(),
        };
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'create_purchase_invoice',
          entityType: 'invoice',
          localId: localInvoice.id,
          summaryAr: `فاتورة شراء (${invoiceData.supplierName || 'مورد'}) — ${invoiceData.grandTotal}`,
          payload: { ...invoiceData, idempotencyKey },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        const nextDb = {
          ...dataRef.current,
          invoices: [localInvoice, ...(dataRef.current.invoices || [])],
        };
        setData(nextDb);
        await persistCurrentSnapshot(nextDb);
        setNetworkStatus('pending');
        return { success: true, invoice: localInvoice };
      }
      return { success: false, error: err?.message || 'تعذر إنشاء فاتورة المشتريات' };
    }
  };

  const confirmDraftInvoice = async (invoiceId: string) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: 'اعتماد المسودات يتطلب اتصالاً مباشراً بالسيرفر المركزي.' };
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
    const idempotencyKey = generateId('IDEMP');
    try {
      await apiRequest(`/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: paymentData,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        const inv = dataRef.current.invoices.find((i) => i.id === invoiceId);
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'add_invoice_payment',
          entityType: 'invoice',
          entityId: invoiceId,
          summaryAr: `دفعة ${paymentData.amount} على فاتورة ${inv?.invoiceNumber || invoiceId}`,
          payload: { invoiceId, ...paymentData, expectedVersion: inv?.version, idempotencyKey },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        setNetworkStatus('pending');
        return { success: true };
      }
      return { success: false, error: err?.message || 'تعذر تسجيل الدفعة' };
    }
  };

  const editSalesInvoice = async (invoiceId: string, updates: { date?: string; items?: Invoice['items']; discountTotal?: number; notes?: string }) => {
    const inv = dataRef.current.invoices.find((i) => i.id === invoiceId);
    try {
      await apiRequest(`/api/invoices/${invoiceId}`, {
        method: 'PUT',
        body: { ...updates, expectedVersion: inv?.version },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'edit_sales_invoice',
          entityType: 'invoice',
          entityId: invoiceId,
          summaryAr: `تعديل فاتورة ${inv?.invoiceNumber || invoiceId}`,
          payload: { invoiceId, ...updates, expectedVersion: inv?.version },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        setNetworkStatus('pending');
        return { success: true };
      }
      return { success: false, error: err?.message || 'تعذر تعديل الفاتورة' };
    }
  };

  const createReturn = async (returnData: Omit<InvoiceReturn, 'id' | 'returnNumber' | 'createdAt' | 'createdBy'>) => {
    const idempotencyKey = generateId('IDEMP');
    try {
      await apiRequest('/api/invoices/returns', {
        method: 'POST',
        body: returnData,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'create_invoice_return',
          entityType: 'invoice_return',
          summaryAr: `مرتجع ${returnData.partyName || ''} — ${returnData.grandTotal}`,
          payload: { ...returnData, idempotencyKey },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        setNetworkStatus('pending');
        return { success: true };
      }
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
      await apiRequest('/api/admin/cashboxes/transfer', {
        method: 'POST',
        body: { fromId, toId, amount, notes },
        idempotencyKey: generateId('IDEMP'),
      });
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

  // Customer & Rep Item Orders Lifecycle (Real Server Persistence + Unified Offline Sync Queue)
  const createCustomerItemOrder = async (
    payload: Omit<CustomerItemOrderRequest, 'id' | 'requestNumber' | 'status' | 'createdAt'> & { idempotencyKey?: string }
  ) => {
    const idempotencyKey = payload.idempotencyKey || generateId('IDEMP');
    const originDeviceId = getOrCreatePersistentDeviceId();
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>('/api/orders', {
        method: 'POST',
        body: { ...payload, originDeviceId },
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        const localId = generateId('ORD-LOC');
        const op = await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'create_order',
          entityType: 'order',
          localId,
          summaryAr: `طلب جديد (${payload.customerName || 'عميل'}) — ${payload.items?.length || 0} صنف`,
          payload: {
            customerId: payload.customerId,
            customerName: payload.customerName,
            requesterType: payload.requesterType,
            representativeId: payload.representativeId,
            items: payload.items,
            notes: payload.notes,
            deliveryAddress: payload.deliveryAddress,
            geoCoordinates: payload.geoCoordinates,
            shopName: payload.shopName,
            customerPhone: payload.customerPhone,
            idempotencyKey,
            originDeviceId,
          },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        const tentativeOrder: CustomerItemOrderRequest = {
          id: localId,
          requestNumber: 'بانتظار المزامنة',
          customerId: payload.customerId,
          userId: currentUser.id,
          requesterType: payload.requesterType || (currentUser.role === 'representative' ? 'representative' : 'customer'),
          representativeId: payload.representativeId,
          customerName: payload.customerName || customerProfile?.name || currentUser.fullName,
          customerPhone: payload.customerPhone || '',
          shopName: payload.shopName || '',
          deliveryAddress: payload.deliveryAddress || '',
          geoCoordinates: payload.geoCoordinates || '',
          items: payload.items || [],
          status: 'pending',
          notes: payload.notes || '',
          idempotencyKey,
          originDeviceId: op.deviceId,
          createdAt: new Date().toISOString(),
          isLocalQueued: true,
        };
        const nextDb = {
          ...dataRef.current,
          customerItemOrders: [tentativeOrder, ...(dataRef.current.customerItemOrders || [])],
        };
        setData(nextDb);
        await persistCurrentSnapshot(nextDb);
        setNetworkStatus('pending');
        return {
          success: false,
          queuedOffline: true,
          order: tentativeOrder,
          error: 'لا يوجد اتصال بالسيرفر حاليًا. تم حفظ الطلب في طابور المزامنة وسيُرفع تلقائيًا عند عودة الشبكة.',
        };
      }
      return { success: false, error: err?.message || 'تعذر إرسال الطلب للسيرفر' };
    }
  };

  const reviewCustomerItemOrder = async (id: string, notes?: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(`/api/orders/${id}/review`, {
        method: 'POST',
        body: { notes },
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر وضع الطلب قيد المراجعة' };
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

  const assignOrderDeliveryRep = async (id: string, repId: string, notes?: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(`/api/orders/${id}/assign-rep`, {
        method: 'POST',
        body: { repId, notes },
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تعيين مندوب التوصيل' };
    }
  };

  const updateOrderDeliveryStatus = async (
    id: string,
    payload: { status: string; collectedAmount?: number; deliveryNotes?: string; deliveryProof?: string }
  ) => {
    const idempotencyKey = generateId('DELIV');
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(`/api/orders/${id}/delivery-status`, {
        method: 'POST',
        body: payload,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        const ord = dataRef.current.customerItemOrders?.find((o) => o.id === id);
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'order_delivery_update',
          entityType: 'order',
          entityId: id,
          summaryAr: `تحديث توصيل الطلب (${ord?.requestNumber || id}) إلى ${payload.status}`,
          payload: { orderId: id, ...payload, expectedVersion: ord?.version, idempotencyKey },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        const nextDb = {
          ...dataRef.current,
          customerItemOrders: (dataRef.current.customerItemOrders || []).map((o) =>
            o.id === id ? { ...o, status: payload.status as any, deliveryNotes: payload.deliveryNotes ?? o.deliveryNotes, isLocalQueued: true } : o
          ),
        };
        setData(nextDb);
        await persistCurrentSnapshot(nextDb);
        setNetworkStatus('pending');
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر تحديث حالة التوصيل' };
    }
  };

  const recordOrderAdvancePayment = async (
    id: string,
    payload: { amount: number; cashboxId: string; paymentMethod?: 'cash' | 'bank' | 'cheque'; date?: string; notes?: string }
  ) => {
    const idempotencyKey = generateId('OADV');
    const originDeviceId = getOrCreatePersistentDeviceId();
    try {
      const res = await apiRequest<{ ok: boolean; advancePayment: OrderAdvancePayment; order: CustomerItemOrderRequest }>(
        `/api/orders/${id}/advance-payment`,
        {
          method: 'POST',
          body: { ...payload, originDeviceId },
          idempotencyKey,
        }
      );
      await loadRoleScopedData();
      return { success: true, advancePayment: res.advancePayment, order: res.order };
    } catch (err: any) {
      if (err?.status === 0 && currentUser?.id) {
        const ord = dataRef.current.customerItemOrders?.find((o) => o.id === id);
        const cb = dataRef.current.cashboxes.find((c) => c.id === payload.cashboxId);
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'order_advance_payment',
          entityType: 'order_advance',
          entityId: id,
          summaryAr: `دفعة مقدمة ${payload.amount} على طلب ${ord?.requestNumber || id}`,
          payload: { orderId: id, ...payload, idempotencyKey, originDeviceId },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        const tentativeAdvance: OrderAdvancePayment = {
          id: generateId('OADV-LOC'),
          paymentNumber: 'قيد المزامنة',
          orderId: id,
          requestNumber: ord?.requestNumber || '',
          customerId: ord?.customerId || '',
          customerName: ord?.customerName || '',
          amount: Number(payload.amount || 0),
          date: payload.date || new Date().toISOString().split('T')[0],
          paymentMethod: payload.paymentMethod || 'cash',
          cashboxId: payload.cashboxId,
          cashboxName: cb?.name || '',
          status: 'available',
          notes: payload.notes || '',
          originDeviceId,
          createdBy: currentUser.fullName,
          createdAt: new Date().toISOString(),
        };
        const nextDb = {
          ...dataRef.current,
          orderAdvancePayments: [tentativeAdvance, ...(dataRef.current.orderAdvancePayments || [])],
          customerItemOrders: (dataRef.current.customerItemOrders || []).map((o) =>
            o.id === id ? { ...o, advancePaidAmount: Number(o.advancePaidAmount || 0) + Number(payload.amount || 0) } : o
          ),
          cashboxes: (dataRef.current.cashboxes || []).map((c) =>
            c.id === payload.cashboxId ? { ...c, currentBalance: Number(c.currentBalance || 0) + Number(payload.amount || 0) } : c
          ),
        };
        setData(nextDb);
        await persistCurrentSnapshot(nextDb);
        setNetworkStatus('pending');
        return { success: true, advancePayment: tentativeAdvance, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر تسجيل الدفعة المقدمة على الطلب' };
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
    if (status === 'under_review') return reviewCustomerItemOrder(id, reason);
    if (status === 'approved') return approveCustomerItemOrder(id, reason);
    if (status === 'rejected') return rejectCustomerItemOrder(id, reason || 'لم يتم تحديد سبب');
    return { success: false, error: 'استخدم أزرار التوصيل أو التحويل إلى فاتورة لإكمال دورة الاعتماد' };
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

  // v4 Cash Operations (with offline queue support)
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
      if (err?.status === 0 && currentUser?.id) {
        await enqueueSyncOperation({
          userId: currentUser.id,
          operationType: 'cash_operation',
          entityType: 'cashbox',
          entityId: payload.cashboxId,
          summaryAr: `عملية نقدية (${payload.type}) — ${payload.amount}`,
          payload: { ...payload, idempotencyKey },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        setNetworkStatus('pending');
        return { success: true };
      }
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

  const pendingSyncCount = useMemo(
    () => syncQueue.filter((q) => q.status === 'pending' || q.status === 'local' || q.status === 'syncing').length,
    [syncQueue]
  );
  const failedSyncCount = useMemo(
    () => syncQueue.filter((q) => q.status === 'failed').length,
    [syncQueue]
  );
  const conflictsCount = useMemo(
    () => syncConflicts.filter((c) => c.status === 'needs_review').length,
    [syncConflicts]
  );
  const hasTentativeLocalBalances = useMemo(
    () => syncQueue.some((q) => q.status !== 'synced'),
    [syncQueue]
  );
  const offlineOrdersCount = useMemo(
    () => syncQueue.filter((q) => q.operationType === 'create_order' && q.status !== 'synced').length,
    [syncQueue]
  );

  if (!isInitialLoaded && isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white font-sans antialiased">
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
        orderAdvancePayments: data.orderAdvancePayments || [],
        syncQueue,
        syncConflicts,
        cachedMediaMap,
        isServerReachable,
        isSyncing,
        pendingSyncCount,
        failedSyncCount,
        conflictsCount,
        hasTentativeLocalBalances,
        lastServerSyncAt,
        networkStatus,
        lastSyncTime,
        pendingChangesCount: pendingSyncCount + failedSyncCount,
        offlineOrdersCount,
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
        triggerSync,
        resolveSyncConflict,
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
        settleSupplierAdvance,
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
        reviewCustomerItemOrder,
        approveCustomerItemOrder,
        rejectCustomerItemOrder,
        assignOrderDeliveryRep,
        updateOrderDeliveryStatus,
        recordOrderAdvancePayment,
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

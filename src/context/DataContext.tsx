import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  DatabaseState,
  getEmptyClientDatabaseState,
  generateId,
} from '../services/storage';
import {
  apiRequest,
  getConfiguredApiBaseUrl,
  setConfiguredApiBaseUrl,
  getStoredConnectionProfiles,
  getStoredInstallationId,
  saveStoredConnectionProfiles,
  resolveModeEndpointUrl,
  detectModeFromUrl,
  testServerHealth,
  getDefaultConnectionProfiles,
  subscribeServerDbStatus,
} from '../services/api';
import { syncConnectionConfigFromServer } from '../services/discovery';
import { notifyLocal, subscribeAppForeground, subscribeNetworkStatus } from '../services/native';
import { localDb } from '../services/localDb';
import { normalizeServerOrigin, refreshCachedUserAuthorization } from '../services/offlineAuth';
import { getCachedProductImageMap, warmProductMediaCache } from '../services/mediaCache';
import { enqueueSyncOperation, getSyncRefreshStats, runSyncCycle, SyncRefreshSummary } from '../services/syncEngine';
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
  RepCustodyOperation,
  RepCustodyStatementResponse,
  ItemMovementReportResponse,
  ServerConnectionSettings,
  ProductCategory,
  Warehouse,
  CustomerItemOrderRequest,
  OrderAdvancePayment,
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
  ConnectionMode,
  ConnectionProfilesConfig,
  SyncQueueItem,
  SyncConflictRecord,
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
  lastServerSyncAt: string | null;
  isServerReachable: boolean;
  isSyncing: boolean;
  syncQueue: SyncQueueItem[];
  syncConflicts: SyncConflictRecord[];
  orderAdvancePayments: OrderAdvancePayment[];
  cachedMediaMap: Record<string, string>;
  pendingSyncCount: number;
  failedSyncCount: number;
  conflictsCount: number;
  hasTentativeLocalBalances: boolean;
  customerStatement: CustomerStatementResponse | null;
  mobileNotifications: MobileNotificationItem[];
  unreadNotificationCount: number;
  markNotificationsRead: () => void;
  refreshMobileNotifications: () => Promise<void>;
  refreshCustomerStatement: () => Promise<void>;
  getCustomerPriceHistory: (customerId: string) => Promise<Record<string, CustomerPriceHistoryEntry[]>>;
  triggerSync: (forceAll?: boolean) => Promise<void>;
  triggerManualSync: () => Promise<void>;
  lastSendSummary: SyncRefreshSummary | null;
  lastReceiveSummary: SyncRefreshSummary | null;
  syncSendOnly: () => Promise<{ ok: boolean; count: number; failedCount: number; conflictCount: number; error?: string }>;
  syncReceiveOnly: () => Promise<{ ok: boolean; count: number; error?: string }>;
  resolveSyncConflict: (
    conflictId: string,
    action: 'keep_server' | 'apply_local' | 'dismiss',
    resolutionNotes?: string
  ) => Promise<{ success: boolean; error?: string }>;
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
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string } | void>;
  deleteCustomer: (id: string) => Promise<{ success: boolean; error?: string }>;
  linkCustomerUser: (customerId: string, payload: { existingUserId?: string; createUser?: { fullName?: string; username: string; password: string; phone?: string; mustChangePassword?: boolean } }) => Promise<{ success: boolean; customer?: Customer; user?: User; error?: string }>;
  repairUnlinkedCustomerUsers: () => Promise<{ success: boolean; repairedCount?: number; error?: string }>;
  toggleCustomerUserStatus: (customerId: string, isActive: boolean) => Promise<{ success: boolean; isActive?: boolean; error?: string }>;
  recordCustomerPayment: (customerId: string, amount: number, cashboxId: string, notes: string, paymentMethod?: 'cash' | 'bank' | 'cheque') => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;

  addSupplier: (supplier: Omit<Supplier, 'id' | 'createdAt' | 'currentBalance'>) => Promise<Supplier>;
  updateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  recordSupplierPayment: (supplierId: string, amount: number, cashboxId: string, notes: string) => Promise<{ success: boolean; error?: string }>;
  settleSupplierAdvance: (supplierId: string, payload: { invoiceId: string; amount: number; notes?: string; date?: string }) => Promise<{ success: boolean; availableAdvanceAfter?: number; settledAmount?: number; error?: string }>;

  // Sales & Purchases & Quotes
  createSalesInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  createPurchaseInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'> & { sendNow?: boolean; recipientUserId?: string; recipientName?: string; isRepPurchase?: boolean }) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  sendPurchaseInvoice: (invoiceId: string, payload?: { recipientUserId?: string; recipientName?: string; notes?: string }) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  receivePurchaseInvoice: (invoiceId: string, notes?: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  rejectPurchaseInvoice: (invoiceId: string, reason: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  createSalesQuote: (quoteData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  convertQuoteToInvoice: (quoteId: string, payload?: Partial<Invoice> & { paidAtInvoice?: number }) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  markInvoiceReviewed: (invoiceId: string, reviewNotes?: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  confirmDraftInvoice: (invoiceId: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  cancelInvoice: (invoiceId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  addInvoicePayment: (invoiceId: string, payment: { amount: number; date?: string; paymentMethod: 'cash' | 'bank' | 'cheque'; cashboxId: string; notes?: string }) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  editSalesInvoice: (invoiceId: string, updates: { date?: string; items?: Invoice['items']; discountTotal?: number; notes?: string; reason?: string }) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  editPurchaseInvoice: (invoiceId: string, updates: { date?: string; supplierId?: string; supplierName?: string; warehouseId?: string; warehouseName?: string; items?: Invoice['items']; discountTotal?: number; paidAmount?: number; paymentType?: Invoice['paymentType']; notes?: string; reason?: string }) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string; invoice?: Invoice }>;

  // Returns
  createReturn: (returnData: Omit<InvoiceReturn, 'id' | 'returnNumber' | 'createdAt' | 'createdBy'>) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;

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
  updateRepItemTransferStatus: (requestId: string, newStatus: RepItemTransferStatus, approvedItems?: RepTransferItem[], notes?: string) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  repCustodyOperations: RepCustodyOperation[];
  recordRepCustodyDelivery: (payload: { representativeId?: string; customerId?: string; customerName?: string; productId: string; quantity: number; unit?: string; unitFactor?: number; date?: string; notes?: string; idempotencyKey?: string }) => Promise<{ success: boolean; operation?: RepCustodyOperation; queuedOffline?: boolean; error?: string }>;
  recordRepCustodyReturn: (payload: { representativeId?: string; targetWarehouseId?: string; productId: string; quantity: number; unit?: string; unitFactor?: number; date?: string; notes?: string; idempotencyKey?: string }) => Promise<{ success: boolean; operation?: RepCustodyOperation; queuedOffline?: boolean; error?: string }>;
  recordRepCustodyAdjustment: (payload: { representativeId: string; productId: string; operationType: 'custody_damaged' | 'custody_shortage' | 'custody_adjustment'; quantity: number; unit?: string; unitFactor?: number; date?: string; notes?: string }) => Promise<{ success: boolean; operation?: RepCustodyOperation; error?: string }>;
  getRepCustodyStatement: (repId?: string, filters?: { dateFrom?: string; dateTo?: string }) => Promise<{ success: boolean; statement?: RepCustodyStatementResponse; error?: string }>;
  getItemMovementReport: (filters?: { productId?: string; warehouseId?: string; movementType?: string; representativeId?: string; dateFrom?: string; dateTo?: string; search?: string }) => Promise<{ success: boolean; report?: ItemMovementReportResponse; error?: string }>;

  // Customer & Representative Orders Lifecycle
  createCustomerItemOrder: (payload: Omit<CustomerItemOrderRequest, 'id' | 'requestNumber' | 'status' | 'createdAt'> & { idempotencyKey?: string }) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; queuedOffline?: boolean; error?: string }>;
  reviewCustomerItemOrder: (id: string, notes?: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  approveCustomerItemOrder: (id: string, notes?: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  rejectCustomerItemOrder: (id: string, reason: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  assignOrderDeliveryRep: (orderId: string, repId: string, notes?: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  updateOrderDeliveryStatus: (
    orderId: string,
    payload: {
      status: 'out_for_delivery' | 'delivered';
      collectedAmount?: number;
      cashboxId?: string;
      paymentMethod?: 'cash' | 'bank' | 'cheque';
      deliveryNotes?: string;
      deliveryProof?: string;
    }
  ) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; queuedOffline?: boolean; error?: string }>;
  advanceOrderStage: (
    orderId: string,
    payload: {
      status: 'preparing' | 'out_for_delivery' | 'delivered' | 'collected' | 'closed';
      collectedAmount?: number;
      cashboxId?: string;
      paymentMethod?: 'cash' | 'bank' | 'cheque';
      deliveryNotes?: string;
      notes?: string;
    }
  ) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  recordOrderAdvancePayment: (
    orderId: string,
    payload: {
      amount: number;
      cashboxId: string;
      paymentMethod?: 'cash' | 'bank' | 'cheque';
      date?: string;
      notes?: string;
    }
  ) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; advancePayment?: OrderAdvancePayment; queuedOffline?: boolean; error?: string }>;
  convertOrderToInvoice: (orderId: string, invoicePayload: Partial<Invoice> & { paidAtInvoice?: number }) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; invoice?: Invoice; error?: string }>;
  updateCustomerItemOrder: (id: string, status: CustomerItemOrderRequest['status'], reason?: string) => Promise<{ success: boolean; error?: string }>;

  // Employees & Payroll
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<{ success: boolean; error?: string }>;
  updateEmployee: (id: string, updates: Partial<Employee>) => Promise<{ success: boolean; error?: string }>;
  recordAttendance: (attendance: Omit<AttendanceRecord, 'id'>) => Promise<{ success: boolean; error?: string }>;
  addAdvanceDeduction: (item: Omit<EmployeeAdvanceDeduction, 'id' | 'createdAt' | 'isSettled'>) => Promise<{ success: boolean; error?: string }>;
  paySalary: (payroll: Omit<SalaryPayroll, 'id' | 'payrollNumber'>) => Promise<{ success: boolean; error?: string }>;

  // Users & Settings
  auditLogs: AuditLogItem[];
  addUser: (userData: Omit<User, 'id' | 'createdAt'> & { password?: string; linkedCustomerId?: string; autoCreateCustomerProfile?: boolean; autoCreateRepProfile?: boolean }) => Promise<{ success: boolean; user?: User; linkedCustomerId?: string; error?: string }>;
  updateUser: (id: string, updates: Partial<User> & { newPassword?: string; linkedCustomerId?: string; autoCreateCustomerProfile?: boolean; autoCreateRepProfile?: boolean }) => Promise<{ success: boolean; error?: string }>;
  deleteUser: (id: string) => Promise<{ success: boolean; error?: string }>;
  updateSettings: (newSettings: Partial<SystemSettings>) => Promise<void>;

  // Server & Connectivity
  updateServerSettings: (
    newSettings: Partial<ServerConnectionSettings>,
    options?: {
      persistToServer?: boolean;
      applyToCurrentDevice?: boolean;
      targetDeviceUrl?: string;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  testServerConnection: (customUrl?: string) => Promise<{
    success: boolean;
    latencyMs: number;
    mode?: string;
    protocol?: string;
    httpsActive?: boolean;
    lanUrls?: string[];
    version?: string;
    error?: string;
  }>;

  // Database Migration & Integrity
  migrationLogs: MigrationLogEntry[];
  runMigration: (executedBy?: string, isTestRun?: boolean) => Promise<{ success: boolean; log?: MigrationLogEntry; error?: string }>;
  rollbackMigration: (backupFile?: string) => Promise<{ success: boolean; error?: string }>;

  // Cash Operations & Global Category Rename
  executeCashOperation: (payload: CashOperationPayload) => Promise<{ success: boolean; transaction?: FinancialTransaction; expenseIncomeRecord?: ExpenseIncomeRecord; queuedOffline?: boolean; error?: string }>;
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

export function isNetworkFailure(err: any): boolean {
  if (err?.status === 503 || String(err?.code || '') === 'DATABASE_UNAVAILABLE') {
    return false;
  }
  if (typeof err?.status === 'number' && err.status >= 400) {
    return false;
  }
  return err?.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/**
 * Applies pending/failed local queue items optimistically onto a cached snapshot
 * so closing/reopening the app offline preserves every locally recorded invoice, order, payment, and balance.
 */
export function overlayPendingQueueOnState(base: DatabaseState, queue: SyncQueueItem[]): DatabaseState {
  const pending = (queue || []).filter((q) => q.status !== 'synced');
  if (pending.length === 0) return base;

  const products = (base.products || []).map((p) => ({
    ...p,
    stockPerWarehouse: { ...(p.stockPerWarehouse || {}) },
  }));
  const customers = (base.customers || []).map((c) => ({ ...c }));
  const representatives = (base.representatives || []).map((r) => ({ ...r }));
  const suppliers = (base.suppliers || []).map((s) => ({ ...s }));
  const cashboxes = (base.cashboxes || []).map((cb) => ({ ...cb }));
  const invoices = (base.invoices || []).map((inv) => ({
    ...inv,
    items: (inv.items || []).map((it) => ({ ...it })),
    payments: [...(inv.payments || [])],
  }));
  const orders = (base.customerItemOrders || []).map((o) => ({ ...o }));
  const advancePayments = (base.orderAdvancePayments || []).map((a) => ({ ...a }));
  const returns = (base.invoiceReturns || []).map((r) => ({ ...r }));
  const financialTransactions = [...(base.financialTransactions || [])];
  const expenseIncomes = [...(base.expenseIncomes || [])];
  const repItemTransfers = (base.repItemTransfers || []).map((t) => ({ ...t }));
  const repCustodyOperations = [...(base.repCustodyOperations || [])];

  for (const op of pending) {
    const p = op.payload || {};
    if (op.operationType === 'create_order') {
      const targetId = op.localId || op.entityId || op.operationId;
      if (!orders.some((o) => o.id === targetId || o.localId === targetId)) {
        const estTotal = (p.items || []).reduce(
          (s: number, it: any) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0),
          0
        );
        orders.unshift({
          id: targetId,
          requestNumber: `LOC-${op.operationId.slice(-5)}`,
          customerId: p.customerId || '',
          customerName: p.customerName || 'عميل',
          requesterType: p.requesterType || 'customer',
          items: p.items || [],
          totalEstimatedAmount: estTotal,
          notes: p.notes || '',
          deliveryAddress: p.deliveryAddress || '',
          geoCoordinates: p.geoCoordinates || '',
          shopName: p.shopName || '',
          customerPhone: p.customerPhone || '',
          status: 'pending',
          createdAt: op.createdAt,
          localId: targetId,
          operationId: op.operationId,
          syncStatus: op.status,
          originDeviceId: op.deviceId,
        });
      }
    } else if (op.operationType === 'create_sales_invoice') {
      const targetId = op.localId || op.entityId || op.operationId;
      if (!invoices.some((i) => i.id === targetId || i.localId === targetId)) {
        const cust = customers.find((c) => c.id === p.customerId);
        const subtotal = (p.items || []).reduce((s: number, it: any) => s + Number(it.total || 0), 0);
        const grandTotal = Math.max(0, subtotal - Number(p.discountTotal || 0));
        const paidAmount = Math.min(grandTotal, Number(p.paidAmount || 0));
        const remainingAmount = Math.max(0, grandTotal - paidAmount);

        invoices.unshift({
          id: targetId,
          invoiceNumber: `LOC-INV-${op.operationId.slice(-5)}`,
          type: 'sales',
          status: p.status === 'draft' ? 'draft' : 'confirmed',
          date: p.date || op.createdAt.slice(0, 10),
          customerId: p.customerId,
          customerName: p.customerName || cust?.name || 'عميل',
          representativeId: p.representativeId,
          representativeName: p.representativeName,
          reviewStatus: p.status !== 'draft' && p.representativeId ? 'needs_review' : 'not_required',
          warehouseId: p.warehouseId,
          warehouseName: p.warehouseName || '',
          items: p.items || [],
          subtotal,
          discountTotal: Number(p.discountTotal || 0),
          taxTotal: Number(p.taxTotal || 0),
          grandTotal,
          paidAmount,
          remainingAmount,
          paymentType: p.paymentType || (remainingAmount === 0 ? 'cash' : paidAmount > 0 ? 'partial' : 'credit'),
          paymentMethod: p.paymentMethod || 'cash',
          cashboxId: p.cashboxId,
          notes: p.notes || '',
          createdBy: op.userId,
          createdAt: op.createdAt,
          payments: [],
          localId: targetId,
          operationId: op.operationId,
          syncStatus: op.status,
          originDeviceId: op.deviceId,
        });

        if (p.status !== 'draft') {
          if (cust) cust.currentBalance = Number(cust.currentBalance || 0) + remainingAmount;
          const cb = cashboxes.find((c) => c.id === p.cashboxId);
          if (cb && paidAmount > 0) cb.currentBalance = Number(cb.currentBalance || 0) + paidAmount;
          if (p.representativeId && paidAmount > 0) {
            const repTarget = representatives.find((r) => r.id === p.representativeId);
            if (repTarget) repTarget.currentBalance = Number(repTarget.currentBalance || 0) + paidAmount;
          }
          if (p.warehouseId) {
            for (const it of p.items || []) {
              const prod = products.find((pr) => pr.id === it.productId);
              if (prod) {
                const qtyBase = Number(it.quantity || 0) * Number(it.unitFactor || 1);
                prod.stockPerWarehouse[p.warehouseId] = Number(prod.stockPerWarehouse[p.warehouseId] || 0) - qtyBase;
              }
            }
          }
        }
      }
    } else if (op.operationType === 'create_purchase_invoice') {
      const targetId = op.localId || op.entityId || op.operationId;
      if (!invoices.some((i) => i.id === targetId || i.localId === targetId)) {
        const supp = suppliers.find((s) => s.id === p.supplierId);
        const subtotal = (p.items || []).reduce((s: number, it: any) => s + Number(it.total || 0), 0);
        const grandTotal = Math.max(0, subtotal - Number(p.discountTotal || 0));
        const paidAmount = Math.min(grandTotal, Number(p.paidAmount || 0));
        const remainingAmount = Math.max(0, grandTotal - paidAmount);
        const isDraftOrRep = p.status === 'draft' || Boolean(p.isRepPurchase);
        const nextDispatchStatus: Invoice['dispatchStatus'] = isDraftOrRep
          ? (p.sendNow ? 'sent' : 'draft')
          : 'confirmed';

        invoices.unshift({
          id: targetId,
          invoiceNumber: `LOC-PUR-${op.operationId.slice(-5)}`,
          type: 'purchase',
          status: isDraftOrRep ? 'draft' : 'confirmed',
          dispatchStatus: nextDispatchStatus,
          sentBy: p.sendNow ? (p.sentBy || op.userId) : undefined,
          sentByUserId: op.userId,
          sentAt: p.sendNow ? op.createdAt : undefined,
          recipientUserId: p.recipientUserId,
          recipientName: p.recipientName,
          date: p.date || op.createdAt.slice(0, 10),
          supplierId: p.supplierId,
          supplierName: p.supplierName || supp?.name || 'مورد',
          representativeId: p.representativeId,
          representativeName: p.representativeName,
          warehouseId: p.warehouseId,
          warehouseName: p.warehouseName || '',
          items: p.items || [],
          subtotal,
          discountTotal: Number(p.discountTotal || 0),
          taxTotal: Number(p.taxTotal || 0),
          grandTotal,
          paidAmount,
          remainingAmount,
          paymentType: p.paymentType || (remainingAmount === 0 ? 'cash' : paidAmount > 0 ? 'partial' : 'credit'),
          paymentMethod: p.paymentMethod || 'cash',
          cashboxId: p.cashboxId,
          notes: p.notes || '',
          createdBy: op.userId,
          createdAt: op.createdAt,
          payments: [],
          localId: targetId,
          operationId: op.operationId,
          syncStatus: op.status,
          originDeviceId: op.deviceId,
        });

        if (!isDraftOrRep) {
          if (supp) supp.currentBalance = Number(supp.currentBalance || 0) + remainingAmount;
          const cb = cashboxes.find((c) => c.id === p.cashboxId);
          if (cb && paidAmount > 0) cb.currentBalance = Number(cb.currentBalance || 0) - paidAmount;
          if (p.warehouseId) {
            for (const it of p.items || []) {
              const prod = products.find((pr) => pr.id === it.productId);
              if (prod) {
                const qtyBase = Number(it.quantity || 0) * Number(it.unitFactor || 1);
                prod.stockPerWarehouse[p.warehouseId] = Number(prod.stockPerWarehouse[p.warehouseId] || 0) + qtyBase;
              }
            }
          }
        }
      }
    } else if (op.operationType === 'send_purchase_invoice') {
      const targetId = p.invoiceId || op.entityId;
      const inv = invoices.find((i) => i.id === targetId || i.localId === targetId);
      if (inv && inv.status === 'draft') {
        inv.dispatchStatus = 'sent';
        inv.sentByUserId = op.userId;
        inv.sentAt = op.createdAt;
        if (p.recipientUserId !== undefined) inv.recipientUserId = p.recipientUserId;
        if (p.recipientName !== undefined) inv.recipientName = p.recipientName;
        inv.syncStatus = op.status;
      }
    } else if (op.operationType === 'edit_sales_invoice') {
      const targetId = p.invoiceId || op.entityId;
      const inv = invoices.find((i) => i.id === targetId || i.localId === targetId);
      if (inv && inv.status !== 'cancelled') {
        const oldGrand = Number(inv.grandTotal || 0);
        const nextItems = Array.isArray(p.items) ? p.items : inv.items;
        const nextSubtotal = nextItems.reduce((s: number, it: any) => s + Number(it.total || 0), 0);
        const nextDiscount = p.discountTotal !== undefined ? Number(p.discountTotal || 0) : Number(inv.discountTotal || 0);
        const nextGrand = Math.max(0, nextSubtotal - nextDiscount);
        const grandDiff = nextGrand - oldGrand;

        if (inv.status === 'confirmed' && inv.warehouseId && Array.isArray(p.items)) {
          for (const oldIt of inv.items || []) {
            const prod = products.find((pr) => pr.id === oldIt.productId);
            if (prod) {
              const qtyBase = Number(oldIt.quantity || 0) * Number(oldIt.unitFactor || 1);
              prod.stockPerWarehouse[inv.warehouseId] = Number(prod.stockPerWarehouse[inv.warehouseId] || 0) + qtyBase;
            }
          }
          for (const newIt of p.items) {
            const prod = products.find((pr) => pr.id === newIt.productId);
            if (prod) {
              const qtyBase = Number(newIt.quantity || 0) * Number(newIt.unitFactor || 1);
              prod.stockPerWarehouse[inv.warehouseId] = Number(prod.stockPerWarehouse[inv.warehouseId] || 0) - qtyBase;
            }
          }
        }

        if (inv.status === 'confirmed' && inv.customerId && grandDiff !== 0) {
          const cust = customers.find((c) => c.id === inv.customerId);
          if (cust) cust.currentBalance = Number(cust.currentBalance || 0) + grandDiff;
        }

        inv.items = nextItems;
        inv.subtotal = nextSubtotal;
        inv.discountTotal = nextDiscount;
        inv.grandTotal = nextGrand;
        inv.remainingAmount = Math.max(0, nextGrand - Number(inv.paidAmount || 0));
        if (p.date) inv.date = p.date;
        if (p.notes !== undefined) inv.notes = p.notes;
        if (p.reason) {
          const hist = Array.isArray(inv.editHistory) ? [...inv.editHistory] : [];
          hist.push({
            editedBy: op.userId,
            editedAt: op.createdAt,
            reason: String(p.reason),
            before: { grandTotal: oldGrand, discountTotal: Number(inv.discountTotal || 0), itemsCount: (inv.items || []).length },
            after: { date: inv.date, grandTotal: nextGrand, discountTotal: nextDiscount, itemsCount: nextItems.length },
          });
          inv.editHistory = hist;
        }
        inv.syncStatus = op.status;
      }
    } else if (op.operationType === 'edit_purchase_invoice') {
      const targetId = p.invoiceId || op.entityId;
      const inv = invoices.find((i) => i.id === targetId || i.localId === targetId);
      if (inv && inv.status !== 'cancelled') {
        const oldGrand = Number(inv.grandTotal || 0);
        const oldRem = Number(inv.remainingAmount || 0);
        const oldWhId = inv.warehouseId;
        const nextWhId = p.warehouseId || oldWhId;
        const oldSuppId = inv.supplierId;
        const nextSuppId = p.supplierId !== undefined ? p.supplierId : oldSuppId;
        const nextItems = Array.isArray(p.items) ? p.items : inv.items;
        const nextSubtotal = nextItems.reduce((s: number, it: any) => s + Number(it.total || 0), 0);
        const nextDiscount = p.discountTotal !== undefined ? Number(p.discountTotal || 0) : Number(inv.discountTotal || 0);
        const nextGrand = Math.max(0, nextSubtotal - nextDiscount);
        const nextPaid = inv.status === 'draft' && p.paidAmount !== undefined ? Number(p.paidAmount || 0) : Number(inv.paidAmount || 0);
        const nextRem = Math.max(0, nextGrand - nextPaid);

        if (inv.status === 'confirmed') {
          if (oldWhId) {
            for (const oldIt of inv.items || []) {
              const prod = products.find((pr) => pr.id === oldIt.productId);
              if (prod) {
                const qtyBase = Number(oldIt.quantity || 0) * Number(oldIt.unitFactor || 1);
                prod.stockPerWarehouse[oldWhId] = Number(prod.stockPerWarehouse[oldWhId] || 0) - qtyBase;
              }
            }
          }
          if (nextWhId) {
            for (const newIt of nextItems || []) {
              const prod = products.find((pr) => pr.id === newIt.productId);
              if (prod) {
                const qtyBase = Number(newIt.quantity || 0) * Number(newIt.unitFactor || 1);
                prod.stockPerWarehouse[nextWhId] = Number(prod.stockPerWarehouse[nextWhId] || 0) + qtyBase;
              }
            }
          }
          if ((oldSuppId || null) === (nextSuppId || null)) {
            const diffRem = nextRem - oldRem;
            if (nextSuppId && diffRem !== 0) {
              const supp = suppliers.find((s) => s.id === nextSuppId);
              if (supp) supp.currentBalance = Number(supp.currentBalance || 0) + diffRem;
            }
          } else {
            if (oldSuppId && oldRem !== 0) {
              const oldSupp = suppliers.find((s) => s.id === oldSuppId);
              if (oldSupp) oldSupp.currentBalance = Number(oldSupp.currentBalance || 0) - oldRem;
            }
            if (nextSuppId && nextRem !== 0) {
              const newSupp = suppliers.find((s) => s.id === nextSuppId);
              if (newSupp) newSupp.currentBalance = Number(newSupp.currentBalance || 0) + nextRem;
            }
          }
        }

        const hist = Array.isArray(inv.editHistory) ? [...inv.editHistory] : [];
        if (p.reason) {
          hist.push({
            editedBy: op.userId,
            editedAt: op.createdAt,
            reason: String(p.reason),
            before: { grandTotal: oldGrand, discountTotal: Number(inv.discountTotal || 0), itemsCount: (inv.items || []).length },
            after: { date: p.date || inv.date, grandTotal: nextGrand, discountTotal: nextDiscount, itemsCount: nextItems.length },
          });
        }
        inv.items = nextItems;
        inv.warehouseId = nextWhId;
        if (p.warehouseName) inv.warehouseName = p.warehouseName;
        inv.supplierId = nextSuppId;
        if (p.supplierName !== undefined) inv.supplierName = p.supplierName;
        inv.subtotal = nextSubtotal;
        inv.discountTotal = nextDiscount;
        inv.grandTotal = nextGrand;
        inv.paidAmount = nextPaid;
        inv.remainingAmount = nextRem;
        if (p.paymentType) inv.paymentType = p.paymentType;
        if (p.date) inv.date = p.date;
        if (p.notes !== undefined) inv.notes = p.notes;
        inv.editHistory = hist;
        inv.syncStatus = op.status;
      }
    } else if (op.operationType === 'add_invoice_payment') {
      const targetId = p.invoiceId || op.entityId;
      const amt = Number(p.amount || 0);
      const inv = invoices.find((i) => i.id === targetId || i.localId === targetId);
      if (inv && amt > 0) {
        inv.paidAmount = Number(inv.paidAmount || 0) + amt;
        inv.remainingAmount = Math.max(0, Number(inv.grandTotal || 0) - inv.paidAmount);
        inv.paymentType = inv.remainingAmount === 0 ? 'cash' : 'partial';
        inv.syncStatus = op.status;
        const cb = cashboxes.find((c) => c.id === p.cashboxId);
        inv.payments = [
          ...(inv.payments || []),
          {
            id: op.operationId,
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            amount: amt,
            date: p.date || op.createdAt.slice(0, 10),
            paymentMethod: p.paymentMethod || 'cash',
            cashboxId: p.cashboxId,
            cashboxName: cb?.name || '',
            notes: p.notes || '',
            createdBy: op.userId,
            createdAt: op.createdAt,
          },
        ];
        if (inv.type === 'sales' && inv.customerId) {
          const cust = customers.find((c) => c.id === inv.customerId);
          if (cust) cust.currentBalance = Number(cust.currentBalance || 0) - amt;
          if (cb) cb.currentBalance = Number(cb.currentBalance || 0) + amt;
        } else if (inv.type === 'purchase' && inv.supplierId) {
          const supp = suppliers.find((s) => s.id === inv.supplierId);
          if (supp) supp.currentBalance = Number(supp.currentBalance || 0) - amt;
          if (cb) cb.currentBalance = Number(cb.currentBalance || 0) - amt;
        }
      }
    } else if (op.operationType === 'record_customer_payment') {
      const cust = customers.find((c) => c.id === p.customerId);
      if (cust) cust.currentBalance = Number(cust.currentBalance || 0) - Number(p.amount || 0);
      const cb = cashboxes.find((c) => c.id === p.cashboxId);
      if (cb) cb.currentBalance = Number(cb.currentBalance || 0) + Number(p.amount || 0);
    } else if (op.operationType === 'record_order_advance') {
      const targetAdvId = op.localId || op.operationId;
      if (!advancePayments.some((a) => a.id === targetAdvId || a.operationId === op.operationId)) {
        const ord = orders.find((o) => o.id === p.orderId);
        const amt = Number(p.amount || 0);
        if (ord) {
          ord.advancePaidAmount = Number(ord.advancePaidAmount || 0) + amt;
          ord.syncStatus = op.status;
        }
        const cust = customers.find((c) => c.id === ord?.customerId);
        if (cust) cust.currentBalance = Number(cust.currentBalance || 0) - amt;
        const cb = cashboxes.find((c) => c.id === p.cashboxId);
        if (cb) cb.currentBalance = Number(cb.currentBalance || 0) + amt;
        advancePayments.unshift({
          id: targetAdvId,
          paymentNumber: `LOC-ADV-${op.operationId.slice(-5)}`,
          orderId: p.orderId,
          orderNumber: ord?.requestNumber || '',
          customerId: ord?.customerId || '',
          customerName: ord?.customerName || '',
          amount: amt,
          cashboxId: p.cashboxId,
          paymentMethod: p.paymentMethod || 'cash',
          date: p.date || op.createdAt.slice(0, 10),
          notes: p.notes || '',
          status: 'active',
          createdBy: op.userId,
          createdAt: op.createdAt,
          operationId: op.operationId,
          syncStatus: op.status,
        });
      }
    } else if (op.operationType === 'update_order_delivery') {
      const ord = orders.find((o) => o.id === p.orderId);
      if (ord) {
        ord.status = p.status;
        if (p.deliveryNotes) ord.deliveryNotes = p.deliveryNotes;
        if (p.deliveryProof) ord.deliveryProof = p.deliveryProof;
        if (p.status === 'delivered') {
          ord.deliveredAt = op.createdAt;
          if (Number(p.collectedAmount || 0) > 0) {
            ord.collectedAmount = Number(p.collectedAmount || 0);
            ord.advancePaidAmount = Number(ord.advancePaidAmount || 0) + Number(p.collectedAmount || 0);
            const cust = customers.find((c) => c.id === ord.customerId);
            if (cust) cust.currentBalance = Number(cust.currentBalance || 0) - Number(p.collectedAmount || 0);
            const cb = cashboxes.find((c) => c.id === p.cashboxId);
            if (cb) cb.currentBalance = Number(cb.currentBalance || 0) + Number(p.collectedAmount || 0);
          }
        }
        ord.syncStatus = op.status;
      }
    } else if (op.operationType === 'create_customer') {
      const targetId = op.localId || op.operationId;
      if (!customers.some((c) => c.id === targetId)) {
        const nextPhones = Array.isArray(p.phones) ? p.phones : undefined;
        const primaryPhone = p.phone || nextPhones?.[0]?.phone || '';
        const secondaryPhone = p.secondaryPhone || nextPhones?.[1]?.phone || undefined;
        customers.unshift({
          id: targetId,
          code: p.code || `LOC-${op.operationId.slice(-4)}`,
          name: p.name || '',
          shopName: p.shopName || '',
          shopPhoto: p.shopPhoto || p.photo || undefined,
          photo: p.shopPhoto || p.photo || undefined,
          phone: primaryPhone,
          secondaryPhone,
          phones: nextPhones,
          governorate: p.governorate || '',
          address: p.address || '',
          area: p.area || '',
          geoCoordinates: p.geoCoordinates || '',
          assignedRepId: p.assignedRepId || undefined,
          allowedRepIds: Array.isArray(p.allowedRepIds)
            ? p.allowedRepIds
            : p.assignedRepId
            ? [p.assignedRepId]
            : [],
          status: p.status || 'active',
          openingBalance: Number(p.openingBalance || 0),
          currentBalance: Number(p.openingBalance || 0),
          priceHistory: {},
          notes: p.notes || '',
          createdAt: op.createdAt,
          syncStatus: op.status,
          originDeviceId: op.deviceId,
        });
      }
    } else if (op.operationType === 'update_customer') {
      const targetId = p.customerId || op.entityId;
      const cust = customers.find((c) => c.id === targetId);
      if (cust) {
        if (p.name !== undefined) cust.name = p.name;
        if (Array.isArray(p.phones)) {
          cust.phones = p.phones;
          const primaryEntry = p.phones.find((x: any) => x?.isPrimary) || p.phones[0];
          const secondEntry = p.phones.find((x: any) => x !== primaryEntry);
          cust.phone = primaryEntry?.phone || p.phone || '';
          cust.secondaryPhone = secondEntry?.phone || '';
        } else {
          if (p.phone !== undefined) cust.phone = p.phone;
          if (p.secondaryPhone !== undefined) cust.secondaryPhone = p.secondaryPhone;
        }
        if (p.clearShopPhoto === true) {
          cust.shopPhoto = '';
          cust.photo = '';
        } else if (p.shopPhoto || p.photo) {
          const nextPhoto = p.shopPhoto || p.photo;
          cust.shopPhoto = nextPhoto;
          cust.photo = nextPhoto;
        }
        if (p.governorate !== undefined) cust.governorate = p.governorate;
        if (p.address !== undefined) cust.address = p.address;
        if (p.shopName !== undefined) cust.shopName = p.shopName;
        if (p.area !== undefined) cust.area = p.area;
        if (p.geoCoordinates !== undefined) cust.geoCoordinates = p.geoCoordinates;
        if (p.notes !== undefined) cust.notes = p.notes;
        if (p.status !== undefined) cust.status = p.status;
        cust.syncStatus = op.status;
      }
    } else if (op.operationType === 'create_invoice_return') {
      const targetId = op.localId || op.operationId;
      if (!returns.some((r) => r.id === targetId)) {
        const partyId = p.partyId || p.customerId || p.supplierId || '';
        const partyName = p.partyName || p.customerName || p.supplierName || '';
        const totalAmt = Number(p.grandTotal ?? p.totalAmount ?? 0);
        returns.unshift({
          id: targetId,
          returnNumber: `LOC-RET-${op.operationId.slice(-5)}`,
          originalInvoiceId: p.originalInvoiceId || '',
          originalInvoiceNumber: p.originalInvoiceNumber || '',
          date: p.date || op.createdAt.slice(0, 10),
          type: p.type || 'sales_return',
          partyId,
          partyName,
          warehouseId: p.warehouseId || '',
          warehouseName: p.warehouseName || '',
          items: p.items || [],
          grandTotal: totalAmt,
          refundType: p.refundType || 'balance',
          cashboxId: p.cashboxId,
          reason: p.reason || '',
          createdBy: op.userId,
          createdAt: op.createdAt,
          syncStatus: op.status,
        });
        if (p.warehouseId) {
          for (const it of p.items || []) {
            const prod = products.find((pr) => pr.id === it.productId);
            if (prod) {
              const qtyBase = Number(it.quantity || 0) * Number(it.unitFactor || 1);
              prod.stockPerWarehouse[p.warehouseId] =
                p.type === 'purchase_return'
                  ? Number(prod.stockPerWarehouse[p.warehouseId] || 0) - qtyBase
                  : Number(prod.stockPerWarehouse[p.warehouseId] || 0) + qtyBase;
            }
          }
        }
        if (p.type === 'sales_return') {
          if (p.refundType === 'balance' && partyId) {
            const cust = customers.find((c) => c.id === partyId);
            if (cust) cust.currentBalance = Number(cust.currentBalance || 0) - totalAmt;
          } else if (p.refundType === 'cash' && p.cashboxId) {
            const cb = cashboxes.find((c) => c.id === p.cashboxId);
            if (cb) cb.currentBalance = Number(cb.currentBalance || 0) - totalAmt;
          }
        } else if (p.type === 'purchase_return') {
          if (p.refundType === 'balance' && partyId) {
            const supp = suppliers.find((s) => s.id === partyId);
            if (supp) supp.currentBalance = Number(supp.currentBalance || 0) - totalAmt;
          } else if (p.refundType === 'cash' && p.cashboxId) {
            const cb = cashboxes.find((c) => c.id === p.cashboxId);
            if (cb) cb.currentBalance = Number(cb.currentBalance || 0) + totalAmt;
          }
        }
      }
    } else if (op.operationType === 'execute_cash_operation') {
      const targetId = op.localId || op.operationId;
      if (!financialTransactions.some((t) => t.id === targetId)) {
        const amt = Number(p.amount || 0);
        const cb = cashboxes.find((c) => c.id === p.cashboxId);
        const targetCb = p.targetCashboxId ? cashboxes.find((c) => c.id === p.targetCashboxId) : undefined;
        const opType = p.type;
        const isOutflow = opType === 'cash_withdrawal' || opType === 'cashbox_transfer' || opType === 'expense';
        if (cb && amt > 0) {
          cb.currentBalance = isOutflow
            ? Number(cb.currentBalance || 0) - amt
            : Number(cb.currentBalance || 0) + amt;
        }
        if (opType === 'cashbox_transfer' && targetCb && amt > 0) {
          targetCb.currentBalance = Number(targetCb.currentBalance || 0) + amt;
        }
        const txTypeMap: Record<string, FinancialTransaction['type']> = {
          cash_withdrawal: 'withdrawal',
          cash_deposit: 'deposit',
          cashbox_transfer: 'transfer',
          expense: 'expense',
          profit_deposit: 'income',
        };
        const category = p.category || (opType === 'expense' ? 'مصروفات تشغيل' : opType === 'profit_deposit' ? 'إيداع ربحي' : 'حركة نقدية');
        financialTransactions.unshift({
          id: targetId,
          transactionNumber: `LOC-COP-${op.operationId.slice(-5)}`,
          date: p.date || op.createdAt.slice(0, 10),
          type: txTypeMap[opType] || 'expense',
          cashboxId: p.cashboxId,
          cashboxName: cb?.name || '',
          targetCashboxId: targetCb?.id,
          targetCashboxName: targetCb?.name,
          amount: amt,
          category,
          partyName: p.recipientOrPayer || undefined,
          description: opType === 'cashbox_transfer' && targetCb ? `ترحيل محلي إلى ${targetCb.name}` : category,
          notes: p.notes || '',
          syncStatus: op.status,
          createdBy: op.userId,
          createdAt: op.createdAt,
        });
        if (opType === 'expense' || opType === 'profit_deposit') {
          expenseIncomes.unshift({
            id: `EXP-${targetId}`,
            recordNumber: `LOC-${opType === 'expense' ? 'EXP' : 'INC'}-${op.operationId.slice(-5)}`,
            type: opType === 'expense' ? 'expense' : 'income',
            category,
            amount: amt,
            date: p.date || op.createdAt.slice(0, 10),
            cashboxId: p.cashboxId,
            cashboxName: cb?.name || '',
            paymentMethod: 'cash',
            recipientOrPayer: p.recipientOrPayer || '',
            notes: p.notes || '',
            syncStatus: op.status,
            createdBy: op.userId,
            createdAt: op.createdAt,
          });
        }
      }
    } else if (op.operationType === 'create_supplier') {
      const targetId = op.localId || op.operationId;
      if (!suppliers.some((s) => s.id === targetId)) {
        suppliers.unshift({
          id: targetId,
          code: p.code || `SUP-LOC-${op.operationId.slice(-4)}`,
          name: p.name || '',
          phone: p.phone || '',
          address: p.address || '',
          status: p.status || 'active',
          openingBalance: Number(p.openingBalance || 0),
          currentBalance: Number(p.openingBalance || 0),
          notes: p.notes || '',
          createdAt: op.createdAt,
        });
      }
    } else if (op.operationType === 'create_sales_quote') {
      const targetId = op.localId || op.entityId || op.operationId;
      if (!invoices.some((i) => i.id === targetId || i.localId === targetId)) {
        const cust = customers.find((c) => c.id === p.customerId);
        const subtotal = (p.items || []).reduce((s: number, it: any) => s + Number(it.total || 0), 0);
        const grandTotal = Math.max(0, subtotal - Number(p.discountTotal || 0));
        invoices.unshift({
          id: targetId,
          invoiceNumber: `LOC-QUO-${op.operationId.slice(-5)}`,
          type: 'quote',
          status: 'draft',
          date: p.date || op.createdAt.slice(0, 10),
          customerId: p.customerId,
          customerName: p.customerName || cust?.name || 'عميل',
          warehouseId: p.warehouseId,
          warehouseName: p.warehouseName || '',
          items: p.items || [],
          subtotal,
          discountTotal: Number(p.discountTotal || 0),
          taxTotal: Number(p.taxTotal || 0),
          grandTotal,
          paidAmount: 0,
          remainingAmount: grandTotal,
          paymentType: 'credit',
          paymentMethod: 'cash',
          cashboxId: p.cashboxId || '',
          notes: p.notes || '',
          createdBy: op.userId,
          createdAt: op.createdAt,
          payments: [],
          localId: targetId,
          operationId: op.operationId,
          syncStatus: op.status,
          originDeviceId: op.deviceId,
        });
      }
    } else if (op.operationType === 'create_purchase_return') {
      const targetId = op.localId || op.operationId;
      if (!returns.some((r) => r.id === targetId)) {
        const partyId = p.partyId || p.supplierId || '';
        const partyName = p.partyName || p.supplierName || '';
        const totalAmt = Number(p.grandTotal ?? p.totalAmount ?? 0);
        returns.unshift({
          id: targetId,
          returnNumber: `LOC-PRET-${op.operationId.slice(-5)}`,
          originalInvoiceId: p.originalInvoiceId || '',
          originalInvoiceNumber: p.originalInvoiceNumber || '',
          date: p.date || op.createdAt.slice(0, 10),
          type: 'purchase_return',
          partyId,
          partyName,
          warehouseId: p.warehouseId || '',
          warehouseName: p.warehouseName || '',
          items: p.items || [],
          grandTotal: totalAmt,
          refundType: p.refundType || 'balance',
          cashboxId: p.cashboxId,
          reason: p.reason || '',
          createdBy: op.userId,
          createdAt: op.createdAt,
          syncStatus: op.status,
        });
        if (p.warehouseId) {
          for (const it of p.items || []) {
            const prod = products.find((pr) => pr.id === it.productId);
            if (prod) {
              const qtyBase = Number(it.quantity || 0) * Number(it.unitFactor || 1);
              prod.stockPerWarehouse[p.warehouseId] = Number(prod.stockPerWarehouse[p.warehouseId] || 0) - qtyBase;
            }
          }
        }
        if (p.refundType === 'balance' && partyId) {
          const supp = suppliers.find((s) => s.id === partyId);
          if (supp) supp.currentBalance = Number(supp.currentBalance || 0) - totalAmt;
        } else if (p.refundType === 'cash' && p.cashboxId) {
          const cb = cashboxes.find((c) => c.id === p.cashboxId);
          if (cb) cb.currentBalance = Number(cb.currentBalance || 0) + totalAmt;
        }
      }
    } else if (op.operationType === 'confirm_custody_receipt') {
      const reqId = p.requestId || op.entityId;
      const req = repItemTransfers.find((r) => r.id === reqId);
      if (req && req.status === 'executed') {
        req.status = 'received';
        req.receivedAt = op.createdAt;
        if (req.transferMode === 'custody_dispatch' && req.targetWarehouseId) {
          for (const it of req.items || []) {
            const prod = products.find((pr) => pr.id === it.productId);
            const qty = Number(it.executedQty ?? it.approvedQty ?? it.requestedQty ?? 0);
            if (prod && qty > 0) {
              prod.stockPerWarehouse[req.targetWarehouseId] = Number(prod.stockPerWarehouse[req.targetWarehouseId] || 0) + qty;
            }
          }
        }
      }
    } else if (op.operationType === 'record_custody_delivery') {
      const targetId = op.localId || op.operationId;
      if (!repCustodyOperations.some((c) => c.id === targetId)) {
        const bQty = Number(p.quantity || 0) * Number(p.unitFactor || 1);
        const prod = products.find((pr) => pr.id === p.productId);
        const whId = p.warehouseId || '';
        if (prod && whId) {
          prod.stockPerWarehouse[whId] = Math.max(0, Number(prod.stockPerWarehouse[whId] || 0) - bQty);
        }
        repCustodyOperations.unshift({
          id: targetId,
          operationNumber: `LOC-CDL-${op.operationId.slice(-5)}`,
          representativeId: p.representativeId || '',
          representativeName: p.representativeName || '',
          warehouseId: whId,
          warehouseName: p.warehouseName || '',
          customerId: p.customerId,
          customerName: p.customerName,
          productId: p.productId,
          productName: prod?.name || p.productName || '',
          operationType: 'delivered_to_customer',
          quantity: Number(p.quantity || 0),
          unit: p.unit || prod?.baseUnit || 'قطعة',
          unitFactor: Number(p.unitFactor || 1),
          baseQuantity: bQty,
          date: p.date || op.createdAt.slice(0, 10),
          status: 'approved',
          notes: p.notes || '',
          createdBy: op.userId,
          createdAt: op.createdAt,
        });
      }
    } else if (op.operationType === 'record_custody_return') {
      const targetId = op.localId || op.operationId;
      if (!repCustodyOperations.some((c) => c.id === targetId)) {
        const bQty = Number(p.quantity || 0) * Number(p.unitFactor || 1);
        const prod = products.find((pr) => pr.id === p.productId);
        const whId = p.warehouseId || '';
        const targetWhId = p.targetWarehouseId || '';
        if (prod && whId) {
          prod.stockPerWarehouse[whId] = Math.max(0, Number(prod.stockPerWarehouse[whId] || 0) - bQty);
        }
        if (prod && targetWhId) {
          prod.stockPerWarehouse[targetWhId] = Number(prod.stockPerWarehouse[targetWhId] || 0) + bQty;
        }
        repCustodyOperations.unshift({
          id: targetId,
          operationNumber: `LOC-CRET-${op.operationId.slice(-5)}`,
          representativeId: p.representativeId || '',
          representativeName: p.representativeName || '',
          warehouseId: whId,
          warehouseName: p.warehouseName || '',
          targetWarehouseId: targetWhId || undefined,
          targetWarehouseName: p.targetWarehouseName || undefined,
          productId: p.productId,
          productName: prod?.name || p.productName || '',
          operationType: 'returned_to_warehouse',
          quantity: Number(p.quantity || 0),
          unit: p.unit || prod?.baseUnit || 'قطعة',
          unitFactor: Number(p.unitFactor || 1),
          baseQuantity: bQty,
          date: p.date || op.createdAt.slice(0, 10),
          status: 'approved',
          notes: p.notes || '',
          createdBy: op.userId,
          createdAt: op.createdAt,
        });
      }
    }
  }

  return {
    ...base,
    products,
    customers,
    representatives,
    suppliers,
    cashboxes,
    invoices,
    customerItemOrders: orders,
    orderAdvancePayments: advancePayments,
    invoiceReturns: returns,
    financialTransactions,
    expenseIncomes,
    repItemTransfers,
    repCustodyOperations,
  };
}

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, isAuthenticated, handleServerAuthRevoked, refreshAuthContext } = useAuth();
  const [data, setData] = useState<DatabaseState>(() => getEmptyClientDatabaseState());
  const [networkStatus, setNetworkStatus] = useState<NetworkSyncStatus>('connected');
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString('ar-EG'));
  const [lastServerSyncAt, setLastServerSyncAt] = useState<string | null>(null);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictRecord[]>([]);
  const [cachedMediaMap, setCachedMediaMap] = useState<Record<string, string>>({});
  const [isServerReachable, setIsServerReachable] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isInitialLoaded, setIsInitialLoaded] = useState<boolean>(false);
  const [isUsingOfflineCache, setIsUsingOfflineCache] = useState<boolean>(false);
  const [lastCacheTimestamp, setLastCacheTimestamp] = useState<string | null>(null);
  const [customerStatement, setCustomerStatement] = useState<CustomerStatementResponse | null>(null);
  const [mobileNotifications, setMobileNotifications] = useState<MobileNotificationItem[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [lastSendSummary, setLastSendSummary] = useState<SyncRefreshSummary | null>(null);
  const [lastReceiveSummary, setLastReceiveSummary] = useState<SyncRefreshSummary | null>(null);

  const hydratedUserRef = useRef<string | null>(null);
  const isDbUnavailableRef = useRef<boolean>(false);
  const isSyncingRef = useRef<boolean>(false);
  const loadRoleScopedDataRef = useRef<(() => Promise<void>) | null>(null);

  const refreshSyncStatsFromLocal = useCallback(async () => {
    const stats = await getSyncRefreshStats().catch(() => ({ lastSendSummary: null, lastReceiveSummary: null }));
    setLastSendSummary(stats.lastSendSummary);
    setLastReceiveSummary(stats.lastReceiveSummary);
  }, []);

  useEffect(() => {
    refreshSyncStatsFromLocal();
  }, [refreshSyncStatsFromLocal]);

  useEffect(() => {
    return subscribeServerDbStatus((available, message) => {
      if (!available) {
        isDbUnavailableRef.current = true;
        setIsServerReachable(true);
        setNetworkStatus('error');
        setLastError(
          message ||
            'قاعدة البيانات المركزية (PostgreSQL) غير متاحة مؤقتًا. تم إيقاف العمليات لحماية البيانات ومنع انقسامها.'
        );
      } else if (isDbUnavailableRef.current) {
        isDbUnavailableRef.current = false;
        setLastError(null);
        setNetworkStatus((prev) => (prev === 'error' ? 'connected' : prev));
        if (!isSyncingRef.current && loadRoleScopedDataRef.current) {
          loadRoleScopedDataRef.current().catch(() => {});
        }
      }
    });
  }, []);

  const refreshQueueAndConflictsFromLocal = useCallback(async (uid?: string) => {
    const targetUid = uid || currentUser?.id;
    if (!targetUid) {
      setSyncQueue([]);
      setSyncConflicts([]);
      return;
    }
    const [q, cf] = await Promise.all([
      localDb.listSyncQueue(targetUid),
      localDb.listConflicts(targetUid),
    ]);
    setSyncQueue(q);
    setSyncConflicts(cf);
  }, [currentUser?.id]);

  const applyServerPullPayload = useCallback(
    async (pullData: any, activeUser: User) => {
      if (!pullData || !activeUser?.id) return;

      const empty = getEmptyClientDatabaseState();
      let nextStateBase: DatabaseState;
      let nextStmt: CustomerStatementResponse | null = null;

      if (pullData.scope === 'customer') {
        nextStateBase = {
          ...empty,
          customers: pullData.customerProfile ? [pullData.customerProfile] : [],
          products: pullData.products || [],
          categories: pullData.categories || [],
          customerItemOrders: pullData.customerItemOrders || [],
          orderAdvancePayments: pullData.orderAdvancePayments || [],
          invoices: pullData.invoices || [],
          invoiceReturns: pullData.invoiceReturns || [],
          syncConflicts: pullData.syncConflicts || [],
          settings: {
            ...empty.settings,
            ...(pullData.settings || {}),
          },
        };
        nextStmt = pullData.statement
          ? {
              ...pullData.statement,
              customer: pullData.statement.customer || pullData.customerProfile || null,
              allowPriceView: pullData.statement.allowPriceView,
              summary: pullData.statement.summary,
              entries: pullData.statement.entries || [],
            }
          : null;
      } else {
        const localProfiles = getStoredConnectionProfiles();
        const serverConnConfig = pullData.settings?.extraSettings?.connectionConfig;
        const mergedProfiles: ConnectionProfilesConfig = serverConnConfig
          ? {
              ...getDefaultConnectionProfiles(),
              ...localProfiles,
              ...serverConnConfig,
              localNetwork: {
                ...getDefaultConnectionProfiles().localNetwork,
                ...localProfiles.localNetwork,
                ...(serverConnConfig.localNetwork || {}),
              },
              freeRemote: { ...localProfiles.freeRemote, ...(serverConnConfig.freeRemote || {}) },
              proRemote: { ...localProfiles.proRemote, ...(serverConnConfig.proRemote || {}) },
              cloudVps: { ...localProfiles.cloudVps, ...(serverConnConfig.cloudVps || {}) },
            }
          : localProfiles;

        if (serverConnConfig) {
          saveStoredConnectionProfiles(mergedProfiles);
        }

        const deviceBaseUrl = getConfiguredApiBaseUrl();
        const activeMode: ConnectionMode = deviceBaseUrl
          ? detectModeFromUrl(deviceBaseUrl, mergedProfiles)
          : mergedProfiles.activeMode;

        const hydratedServerSettings: ServerConnectionSettings = {
          ...empty.serverSettings!,
          serverIp: mergedProfiles.localNetwork.ip || '192.168.1.100',
          hostname: mergedProfiles.localNetwork.hostname || 'awlad-selim-server',
          port: Number(mergedProfiles.localNetwork.port || 3000) || 3000,
          apiBaseUrl: deviceBaseUrl || resolveModeEndpointUrl(activeMode, mergedProfiles),
          connectionType: activeMode,
          activeMode,
          profiles: mergedProfiles,
          serverStatus: 'online',
          databaseStatus: 'connected',
          syncStatus: 'connected',
        };

        nextStateBase = {
          ...empty,
          ...pullData,
          repCustodyOperations: pullData.repCustodyOperations || [],
          purchaseReceivers: pullData.purchaseReceivers || [],
          serverSettings: hydratedServerSettings,
        };
      }

      const currentQueue = await localDb.listSyncQueue(activeUser.id);
      const effectiveState = overlayPendingQueueOnState(nextStateBase, currentQueue);

      setData((prev) => ({
        ...effectiveState,
        migrationLogs: pullData.migrationLogs || prev.migrationLogs || [],
      }));
      setCustomerStatement(nextStmt);
      setSyncQueue(currentQueue);
      setSyncConflicts(Array.isArray(pullData.syncConflicts) ? pullData.syncConflicts : []);
      setIsUsingOfflineCache(false);
      setLastCacheTimestamp(null);
      const nowServerTime = pullData.serverTime || new Date().toISOString();
      setLastServerSyncAt(nowServerTime);
      setLastSyncTime(new Date().toLocaleTimeString('ar-EG'));

      // Persist clean server baseline into multi-platform LocalDB (IndexedDB + Electron AES Vault / Capacitor Filesystem)
      const currentInstallationId = getStoredInstallationId();
      await localDb.saveSnapshot({
        userId: activeUser.id,
        scope: pullData.scope || 'staff',
        serverOrigin: normalizeServerOrigin(getConfiguredApiBaseUrl()),
        installationId: currentInstallationId || undefined,
        cachedAt: new Date().toISOString(),
        serverTime: nowServerTime,
        user: pullData.user || activeUser,
        customerProfile: pullData.customerProfile || null,
        representativeProfile: pullData.representativeProfile || null,
        mobileConfig: pullData.mobileConfig,
        data: {
          dbState: nextStateBase,
          customerStatement: nextStmt,
        },
      });

      // Keep local auth permissions & active status synced with central DB
      if (pullData.user) {
        if (pullData.user.isActive === false) {
          await handleServerAuthRevoked('تم إيقاف الحساب من الإدارة مركزيًا.');
          return;
        }
        await refreshCachedUserAuthorization({
          serverUrl: getConfiguredApiBaseUrl(),
          installationId: currentInstallationId,
          user: pullData.user,
          customerProfile: pullData.customerProfile || null,
          representativeProfile: pullData.representativeProfile || null,
        }).catch(() => {});
      }

      // Warm cached product media in background
      const prods = nextStateBase.products || [];
      getCachedProductImageMap(prods)
        .then((map) => setCachedMediaMap(map))
        .catch(() => {});
      warmProductMediaCache(prods, (productId, dataUrl) => {
        setCachedMediaMap((prev) => ({ ...prev, [productId]: dataUrl }));
      }).catch(() => {});
    },
    [handleServerAuthRevoked]
  );

  // Instant Offline-First Hydration from LocalDB whenever user logs in or opens app offline
  useEffect(() => {
    let cancelled = false;
    const hydrateFromLocalDb = async () => {
      if (!isAuthenticated || !currentUser) {
        hydratedUserRef.current = null;
        setData(getEmptyClientDatabaseState());
        setCustomerStatement(null);
        setSyncQueue([]);
        setSyncConflicts([]);
        setCachedMediaMap({});
        setMobileNotifications([]);
        setIsUsingOfflineCache(false);
        setLastCacheTimestamp(null);
        setIsInitialLoaded(true);
        return;
      }

      if (hydratedUserRef.current !== currentUser.id) {
        hydratedUserRef.current = currentUser.id;
        const [snap, queue, conflicts, lastSyncMeta] = await Promise.all([
          localDb.getSnapshot(currentUser.id),
          localDb.listSyncQueue(currentUser.id),
          localDb.listConflicts(currentUser.id),
          localDb.getMeta<string>('last_sync_at'),
        ]);
        if (cancelled) return;

        setSyncQueue(queue);
        setSyncConflicts(conflicts);
        if (lastSyncMeta) setLastServerSyncAt(lastSyncMeta);

        const expectedOrigin = normalizeServerOrigin(getConfiguredApiBaseUrl());
        const expectedInstallationId = getStoredInstallationId();
        const snapshotMatchesServer =
          snap?.data?.dbState &&
          (!snap.serverOrigin || snap.serverOrigin === expectedOrigin) &&
          (!expectedInstallationId || !snap.installationId || snap.installationId === expectedInstallationId);

        if (snapshotMatchesServer && snap?.data?.dbState) {
          const effective = overlayPendingQueueOnState(snap.data.dbState, queue);
          setData(effective);
          if (snap.data.customerStatement) {
            setCustomerStatement(snap.data.customerStatement);
          }
          setIsUsingOfflineCache(true);
          setLastCacheTimestamp(snap.cachedAt);
          setIsInitialLoaded(true);
          getCachedProductImageMap(effective.products || [])
            .then((map) => {
              if (!cancelled) setCachedMediaMap(map);
            })
            .catch(() => {});
        }
      }
    };

    hydrateFromLocalDb();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, currentUser?.id]);

  const loadRoleScopedData = useCallback(async () => {
    if (!isAuthenticated || !currentUser) {
      setIsInitialLoaded(true);
      return;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const outcome = await runSyncCycle({ userId: currentUser.id, forceAll: false });
      await refreshQueueAndConflictsFromLocal(currentUser.id);

      if (outcome.authRevoked) {
        await handleServerAuthRevoked(outcome.revokeReason);
        return;
      }

      setIsServerReachable(outcome.serverReachable);

      if (outcome.serverReachable && outcome.ok && outcome.pullData) {
        await applyServerPullPayload(outcome.pullData, currentUser);
        // Optional migration logs fetch for admin
        if (currentUser.role === 'admin' || currentUser.permissions?.canManageSettings) {
          apiRequest<{ ok: boolean; logs: MigrationLogEntry[] }>('/api/admin/migration/logs')
            .then((mig) => {
              if (Array.isArray(mig?.logs)) {
                setData((prev) => ({ ...prev, migrationLogs: mig.logs }));
              }
            })
            .catch(() => {});
        }
        // Refresh AuthContext permissions if role/permissions changed remotely
        if (JSON.stringify(outcome.pullData.user?.permissions) !== JSON.stringify(currentUser.permissions)) {
          refreshAuthContext().catch(() => {});
        }
        setNetworkStatus(outcome.conflictCount > 0 || outcome.failedCount > 0 ? 'pending' : 'connected');
        setLastError(null);
      } else {
        setNetworkStatus(outcome.serverReachable ? 'error' : 'disconnected');
        if (outcome.error) setLastError(outcome.error);
      }
    } catch (err: any) {
      const networkDown = isNetworkFailure(err);
      setIsServerReachable(!networkDown);
      setNetworkStatus(networkDown ? 'disconnected' : 'error');
      setLastError(err?.message || 'تعذر مزامنة البيانات مع السيرفر');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
      setIsInitialLoaded(true);
    }
  }, [isAuthenticated, currentUser, applyServerPullPayload, refreshQueueAndConflictsFromLocal, handleServerAuthRevoked, refreshAuthContext]);

  loadRoleScopedDataRef.current = loadRoleScopedData;

  const triggerSync = useCallback(
    async (forceAll = false) => {
      if (!isAuthenticated || !currentUser) return;
      setNetworkStatus('synchronizing');
      isSyncingRef.current = true;
      setIsSyncing(true);
      try {
        await syncConnectionConfigFromServer({ triggerHeartbeat: true }).catch(() => {});
        const outcome = await runSyncCycle({ userId: currentUser.id, forceAll });
        await refreshQueueAndConflictsFromLocal(currentUser.id);

        if (outcome.authRevoked) {
          await handleServerAuthRevoked(outcome.revokeReason);
          return;
        }
        setIsServerReachable(outcome.serverReachable);

        if (outcome.ok && outcome.pullData) {
          await applyServerPullPayload(outcome.pullData, currentUser);
          setNetworkStatus(outcome.conflictCount > 0 || outcome.failedCount > 0 ? 'pending' : 'connected');
          setLastError(null);
        } else {
          setNetworkStatus(outcome.serverReachable ? 'error' : 'disconnected');
          if (outcome.error) setLastError(outcome.error);
        }
      } catch (err: any) {
        const networkDown = isNetworkFailure(err);
        setIsServerReachable(!networkDown);
        setNetworkStatus(networkDown ? 'disconnected' : 'error');
        setLastError(err?.message || 'تعذر مزامنة البيانات مع السيرفر');
      } finally {
        isSyncingRef.current = false;
        setIsSyncing(false);
      }
    },
    [isAuthenticated, currentUser, refreshQueueAndConflictsFromLocal, handleServerAuthRevoked, applyServerPullPayload]
  );

  const triggerManualSync = useCallback(() => triggerSync(true), [triggerSync]);

  const syncSendOnly = useCallback(async () => {
    if (!isAuthenticated || !currentUser) {
      return { ok: false, count: 0, failedCount: 0, conflictCount: 0, error: 'المستخدم غير مسجل' };
    }
    setNetworkStatus('synchronizing');
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const outcome = await runSyncCycle({ userId: currentUser.id, forceAll: true, mode: 'send_only' });
      await refreshQueueAndConflictsFromLocal(currentUser.id);
      await refreshSyncStatsFromLocal();
      if (outcome.authRevoked) {
        await handleServerAuthRevoked(outcome.revokeReason);
        return { ok: false, count: 0, failedCount: outcome.failedCount, conflictCount: outcome.conflictCount, error: outcome.revokeReason };
      }
      setIsServerReachable(outcome.serverReachable);
      setNetworkStatus(
        !outcome.serverReachable ? 'disconnected' : outcome.ok ? (outcome.failedCount > 0 || outcome.conflictCount > 0 ? 'pending' : 'connected') : 'error'
      );
      if (outcome.error) setLastError(outcome.error);
      else setLastError(null);
      return {
        ok: outcome.ok,
        count: outcome.syncedCount,
        failedCount: outcome.failedCount,
        conflictCount: outcome.conflictCount,
        error: outcome.error,
      };
    } catch (err: any) {
      return { ok: false, count: 0, failedCount: 0, conflictCount: 0, error: err?.message || 'فشل الإرسال' };
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [isAuthenticated, currentUser, refreshQueueAndConflictsFromLocal, refreshSyncStatsFromLocal, handleServerAuthRevoked]);

  const syncReceiveOnly = useCallback(async () => {
    if (!isAuthenticated || !currentUser) {
      return { ok: false, count: 0, error: 'المستخدم غير مسجل' };
    }
    setNetworkStatus('synchronizing');
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const outcome = await runSyncCycle({ userId: currentUser.id, forceAll: true, mode: 'receive_only' });
      await refreshQueueAndConflictsFromLocal(currentUser.id);
      await refreshSyncStatsFromLocal();
      if (outcome.authRevoked) {
        await handleServerAuthRevoked(outcome.revokeReason);
        return { ok: false, count: 0, error: outcome.revokeReason };
      }
      setIsServerReachable(outcome.serverReachable);
      if (outcome.ok && outcome.pullData) {
        await applyServerPullPayload(outcome.pullData, currentUser);
        setNetworkStatus(outcome.conflictCount > 0 || outcome.failedCount > 0 ? 'pending' : 'connected');
        setLastError(null);
        return { ok: true, count: outcome.receivedCount || 0 };
      }
      setNetworkStatus(outcome.serverReachable ? 'error' : 'disconnected');
      if (outcome.error) setLastError(outcome.error);
      return { ok: false, count: 0, error: outcome.error || 'تعذر الاستلام من السيرفر' };
    } catch (err: any) {
      return { ok: false, count: 0, error: err?.message || 'تعذر الاستلام من السيرفر' };
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [isAuthenticated, currentUser, refreshQueueAndConflictsFromLocal, refreshSyncStatsFromLocal, handleServerAuthRevoked, applyServerPullPayload]);

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
    if (!isAuthenticated || !currentUser) return;
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
        try {
          localStorage.setItem(seenKey, JSON.stringify(list.map((n) => n.id)));
        } catch {
          // ignore
        }
      } else {
        const unseen = list.filter((n) => !seen.includes(n.id));
        if (unseen.length > 0) {
          const hasOrderUpdates = unseen.some(
            (n) => n.type === 'customer_order' || n.type === 'order_status' || String(n.type).startsWith('order_')
          );
          if (hasOrderUpdates) {
            loadRoleScopedData().catch(() => {});
          }
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
  }, [isAuthenticated, currentUser, loadRoleScopedData]);

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
    if (!isAuthenticated || !currentUser) return;

    refreshMobileNotifications();

    let lastReconnectCheckAt = 0;
    const runReconnectConfigSync = () => {
      const now = Date.now();
      if (now - lastReconnectCheckAt < 10000) return;
      lastReconnectCheckAt = now;
      syncConnectionConfigFromServer({ triggerHeartbeat: true, allowLanDiscoveryOnFailure: true })
        .then((res) => {
          if (res.switchedUrl) {
            loadRoleScopedData();
            triggerSync(true).catch(() => {});
          }
        })
        .catch(() => {});
    };

    const unsubscribeNet = subscribeNetworkStatus((connected) => {
      setIsServerReachable(connected);
      if (connected) {
        runReconnectConfigSync();
        triggerSync(true).catch(() => {});
        refreshMobileNotifications();
      } else {
        setNetworkStatus('disconnected');
      }
    });

    const unsubscribeFg = subscribeAppForeground(() => {
      if (navigator.onLine !== false) {
        runReconnectConfigSync();
        triggerSync(true).catch(() => {});
      }
    });

    // Periodic 20s auto-sync & notifications check when active & online
    const syncTimer = window.setInterval(() => {
      if (navigator.onLine !== false) {
        runSyncCycle({ userId: currentUser.id, forceAll: false })
          .then(async (outcome) => {
            await refreshQueueAndConflictsFromLocal(currentUser.id);
            if (outcome.authRevoked) {
              await handleServerAuthRevoked(outcome.revokeReason);
              return;
            }
            setIsServerReachable(outcome.serverReachable);
            if (outcome.ok && outcome.pullData) {
              await applyServerPullPayload(outcome.pullData, currentUser);
              setNetworkStatus(outcome.conflictCount > 0 || outcome.failedCount > 0 ? 'pending' : 'connected');
              setLastError(null);
            } else if (!outcome.serverReachable) {
              setNetworkStatus('disconnected');
              if (outcome.error) setLastError(outcome.error);
            } else {
              setNetworkStatus('error');
              if (outcome.error) setLastError(outcome.error);
            }
          })
          .catch(() => {});
      }
    }, 20000);

    const notifTimer = window.setInterval(() => {
      if (navigator.onLine !== false) {
        refreshMobileNotifications();
      }
    }, 45000);

    const heartbeatTimer = window.setInterval(() => {
      if (navigator.onLine !== false) {
        syncConnectionConfigFromServer({ triggerHeartbeat: true })
          .then((res) => {
            if (res.switchedUrl) {
              loadRoleScopedData();
            }
          })
          .catch(() => {});
      }
    }, 90000);

    return () => {
      unsubscribeNet();
      unsubscribeFg();
      window.clearInterval(syncTimer);
      window.clearInterval(notifTimer);
      window.clearInterval(heartbeatTimer);
    };
  }, [
    isAuthenticated,
    currentUser,
    triggerSync,
    refreshMobileNotifications,
    refreshQueueAndConflictsFromLocal,
    handleServerAuthRevoked,
    applyServerPullPayload,
    loadRoleScopedData,
  ]);

  const refreshCustomerStatement = useCallback(async () => {
    if (!isAuthenticated || currentUser?.role !== 'customer') return;
    try {
      const res = await apiRequest<{ ok: boolean } & CustomerStatementResponse>('/api/customers/me/statement');
      setCustomerStatement({
        ...res,
        customer: res.customer || null,
        allowPriceView: res.allowPriceView,
        summary: res.summary,
        entries: res.entries || [],
      });
    } catch {
      // keep cached statement if offline
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

  // Offline Queue Helper
  const queueOfflineOp = useCallback(
    async (params: {
      operationType: SyncQueueItem['operationType'];
      entityType: string;
      entityId?: string;
      localId?: string;
      summaryAr: string;
      payload: Record<string, any>;
    }) => {
      if (!currentUser) throw new Error('المستخدم غير مسجل');
      const queued = await enqueueSyncOperation({
        userId: currentUser.id,
        ...params,
      });
      const updatedQueue = await localDb.listSyncQueue(currentUser.id);
      setSyncQueue(updatedQueue);

      setData((prev) => {
        const next = overlayPendingQueueOnState(prev, [queued]);
        localDb
          .saveSnapshot({
            userId: currentUser.id,
            scope:
              currentUser.role === 'customer'
                ? 'customer'
                : currentUser.role === 'representative'
                ? 'representative'
                : 'staff',
            serverOrigin: normalizeServerOrigin(getConfiguredApiBaseUrl()),
            cachedAt: new Date().toISOString(),
            user: currentUser,
            data: { dbState: next, customerStatement },
          })
          .catch(() => {});
        return next;
      });
      setNetworkStatus('pending');
      setIsServerReachable(false);
      return queued;
    },
    [currentUser, customerStatement]
  );

  const resolveSyncConflict = async (
    conflictId: string,
    action: 'keep_server' | 'apply_local' | 'dismiss',
    resolutionNotes?: string
  ) => {
    try {
      await apiRequest(`/api/sync/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        body: { action, resolutionNotes },
      });
      await triggerSync(false);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر معالجة تعارض المزامنة' };
    }
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
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('CUS-LOC');
        const op = await queueOfflineOp({
          operationType: 'create_customer',
          entityType: 'customer',
          localId,
          summaryAr: `إضافة عميل محليًا: ${custData.shopName || custData.name}`,
          payload: { ...custData, localId },
        });
        return {
          id: localId,
          code: custData.code || `LOC-${op.operationId.slice(-4)}`,
          name: custData.name,
          shopName: custData.shopName,
          shopPhoto: custData.shopPhoto || custData.photo,
          photo: custData.shopPhoto || custData.photo,
          phone: custData.phone,
          secondaryPhone: custData.secondaryPhone,
          phones: custData.phones,
          governorate: custData.governorate,
          area: custData.area,
          geoCoordinates: custData.geoCoordinates,
          address: custData.address,
          assignedRepId: custData.assignedRepId,
          allowedRepIds: custData.allowedRepIds,
          status: custData.status || 'active',
          openingBalance: custData.openingBalance,
          currentBalance: custData.openingBalance,
          priceHistory: {},
          notes: custData.notes,
          createdAt: op.createdAt,
          syncStatus: op.status,
        };
      }
      throw err;
    }
  };

  const updateCustomer = async (id: string, updates: Partial<Customer>) => {
    const current = data.customers.find((c) => c.id === id);
    const body = { ...updates, baseVersion: current?.version ?? updates.version };
    try {
      await apiRequest(`/api/customers/${id}`, { method: 'PUT', body });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        await queueOfflineOp({
          operationType: 'update_customer',
          entityType: 'customer',
          entityId: id,
          summaryAr: `تحديث بيانات العميل: ${current?.shopName || current?.name || id}`,
          payload: { customerId: id, ...body },
        });
        setData((prev) => ({
          ...prev,
          customers: prev.customers.map((c) => {
            if (c.id !== id) return c;
            const nextPhoto = updates.clearShopPhoto ? '' : (updates.shopPhoto || updates.photo || c.shopPhoto || c.photo);
            return {
              ...c,
              ...updates,
              shopPhoto: nextPhoto,
              photo: nextPhoto,
              syncStatus: 'pending',
            };
          }),
        }));
        return { success: true, queuedOffline: true };
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

  const repairUnlinkedCustomerUsers = async () => {
    try {
      const res = await apiRequest<{ ok: boolean; repairedCount: number }>('/api/customers/conflicts/fix-unlinked', {
        method: 'POST',
      });
      await loadRoleScopedData();
      return { success: true, repairedCount: res.repairedCount || 0 };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إصلاح حسابات العملاء غير المربوطة' };
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
      if (isNetworkFailure(err) && currentUser) {
        const cust = data.customers.find((c) => c.id === customerId);
        await queueOfflineOp({
          operationType: 'record_customer_payment',
          entityType: 'payment',
          entityId: customerId,
          summaryAr: `تحصيل عميل (${cust?.name || customerId}): ${amount} ج.م`,
          payload: { customerId, amount, cashboxId, notes, paymentMethod },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'فشل تسجيل التحصيل' };
    }
  };

  const addSupplier = async (suppData: Omit<Supplier, 'id' | 'createdAt' | 'currentBalance'>): Promise<Supplier> => {
    try {
      const res = await apiRequest<{ ok: boolean; supplier: Supplier }>('/api/admin/suppliers', {
        method: 'POST',
        body: suppData,
      });
      await loadRoleScopedData();
      return res.supplier;
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('SUP-LOC');
        const op = await queueOfflineOp({
          operationType: 'create_supplier',
          entityType: 'supplier',
          localId,
          summaryAr: `إضافة مورد محليًا: ${suppData.name}`,
          payload: { ...suppData, localId },
        });
        return {
          id: localId,
          code: suppData.code || `SUP-LOC-${op.operationId.slice(-4)}`,
          name: suppData.name,
          phone: suppData.phone,
          address: suppData.address,
          status: suppData.status || 'active',
          openingBalance: suppData.openingBalance,
          currentBalance: suppData.openingBalance,
          notes: suppData.notes,
          createdAt: op.createdAt,
        };
      }
      throw err;
    }
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

  // Invoices
  const createSalesInvoice = async (invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => {
    const idempotencyKey = (invoiceData as any)?.idempotencyKey || generateId('IDEMP');
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>('/api/invoices/sales', {
        method: 'POST',
        body: invoiceData,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        if (!data.settings?.allowNegativeStock && invoiceData.status !== 'draft' && invoiceData.warehouseId) {
          for (const item of invoiceData.items || []) {
            const prod = data.products.find((p) => p.id === item.productId);
            const avail = Number(prod?.stockPerWarehouse?.[invoiceData.warehouseId] || 0);
            const needed = Number(item.quantity || 0) * Number(item.unitFactor || 1);
            if (needed > avail) {
              return {
                success: false,
                error: `الرصيد المحلي المتاح للصنف (${item.productName}) في المخزن المحدد هو (${avail}) فقط ولا يكفي للكمية المطلوبة (${needed}).`,
              };
            }
          }
        }
        const localId = generateId('INV-LOC');
        const op = await queueOfflineOp({
          operationType: 'create_sales_invoice',
          entityType: 'invoice',
          localId,
          summaryAr: `فاتورة مبيعات محلية (${invoiceData.customerName || 'عميل'}) بمبلغ ${invoiceData.grandTotal || 0} ج.م`,
          payload: { ...invoiceData, localId },
        });
        const cust = data.customers.find((c) => c.id === invoiceData.customerId);
        const optimisticInvoice: Invoice = {
          id: localId,
          invoiceNumber: `LOC-INV-${op.operationId.slice(-5)}`,
          type: 'sales',
          status: invoiceData.status === 'draft' ? 'draft' : 'confirmed',
          date: invoiceData.date || op.createdAt.slice(0, 10),
          customerId: invoiceData.customerId,
          customerName: invoiceData.customerName || cust?.name,
          warehouseId: invoiceData.warehouseId,
          warehouseName: invoiceData.warehouseName || '',
          items: invoiceData.items || [],
          subtotal: invoiceData.subtotal || 0,
          discountTotal: invoiceData.discountTotal || 0,
          taxTotal: invoiceData.taxTotal || 0,
          grandTotal: invoiceData.grandTotal || 0,
          paidAmount: invoiceData.paidAmount || 0,
          remainingAmount: invoiceData.remainingAmount || 0,
          paymentType: invoiceData.paymentType || 'cash',
          paymentMethod: invoiceData.paymentMethod || 'cash',
          cashboxId: invoiceData.cashboxId,
          notes: invoiceData.notes,
          createdBy: currentUser.id,
          createdAt: op.createdAt,
          payments: [],
          localId,
          operationId: op.operationId,
          syncStatus: 'pending',
        };
        return { success: true, invoice: optimisticInvoice, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر إنشاء فاتورة المبيعات' };
    }
  };

  const createPurchaseInvoice = async (
    invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'> & {
      sendNow?: boolean;
      recipientUserId?: string;
      recipientName?: string;
      isRepPurchase?: boolean;
    }
  ) => {
    const forceRepDraft = currentUser?.role === 'representative' || Boolean(invoiceData.isRepPurchase);
    const bodyPayload = forceRepDraft ? { ...invoiceData, status: 'draft' as const, isRepPurchase: true } : invoiceData;
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>('/api/invoices/purchase', {
        method: 'POST',
        body: bodyPayload,
        idempotencyKey: (invoiceData as any)?.idempotencyKey || generateId('IDEMP'),
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('PUR-LOC');
        const op = await queueOfflineOp({
          operationType: 'create_purchase_invoice',
          entityType: 'invoice',
          localId,
          summaryAr: `${forceRepDraft ? 'فاتورة شراء مندوب محلية' : 'فاتورة مشتريات محلية'} (${invoiceData.supplierName || 'مورد'})`,
          payload: { ...bodyPayload, localId, sentBy: currentUser.fullName, sentByUserId: currentUser.id },
        });
        const supp = data.suppliers.find((s) => s.id === invoiceData.supplierId);
        const isDraft = bodyPayload.status === 'draft' || forceRepDraft;
        const optimisticPurchase: Invoice = {
          id: localId,
          invoiceNumber: `LOC-PUR-${op.operationId.slice(-5)}`,
          type: 'purchase',
          status: isDraft ? 'draft' : 'confirmed',
          dispatchStatus: isDraft ? (invoiceData.sendNow ? 'sent' : 'draft') : 'confirmed',
          sentBy: invoiceData.sendNow ? currentUser.fullName : undefined,
          sentByUserId: currentUser.id,
          sentAt: invoiceData.sendNow ? op.createdAt : undefined,
          recipientUserId: invoiceData.recipientUserId,
          recipientName: invoiceData.recipientName,
          date: invoiceData.date || op.createdAt.slice(0, 10),
          supplierId: invoiceData.supplierId,
          supplierName: invoiceData.supplierName || supp?.name,
          representativeId: invoiceData.representativeId,
          representativeName: invoiceData.representativeName,
          warehouseId: invoiceData.warehouseId,
          warehouseName: invoiceData.warehouseName || '',
          items: invoiceData.items || [],
          subtotal: invoiceData.subtotal || 0,
          discountTotal: invoiceData.discountTotal || 0,
          taxTotal: invoiceData.taxTotal || 0,
          grandTotal: invoiceData.grandTotal || 0,
          paidAmount: invoiceData.paidAmount || 0,
          remainingAmount: invoiceData.remainingAmount || 0,
          paymentType: invoiceData.paymentType || 'cash',
          paymentMethod: invoiceData.paymentMethod || 'cash',
          cashboxId: invoiceData.cashboxId,
          notes: invoiceData.notes,
          createdBy: currentUser.id,
          createdAt: op.createdAt,
          payments: [],
          localId,
          operationId: op.operationId,
          syncStatus: op.status,
        };
        return { success: true, invoice: optimisticPurchase, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر إنشاء فاتورة المشتريات' };
    }
  };

  const sendPurchaseInvoice = async (
    invoiceId: string,
    payload: { recipientUserId?: string; recipientName?: string; notes?: string } = {}
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>(`/api/invoices/purchase/${invoiceId}/send`, {
        method: 'POST',
        body: payload,
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const existing = data.invoices.find((i) => i.id === invoiceId);
        await queueOfflineOp({
          operationType: 'send_purchase_invoice',
          entityType: 'invoice',
          entityId: invoiceId,
          summaryAr: `إرسال فاتورة شراء للإدارة (${existing?.invoiceNumber || invoiceId})`,
          payload: { invoiceId, ...payload },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر إرسال فاتورة الشراء' };
    }
  };

  const receivePurchaseInvoice = async (invoiceId: string, notes = '') => {
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>(`/api/invoices/purchase/${invoiceId}/receive`, {
        method: 'POST',
        body: { notes },
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تسجيل استلام فاتورة الشراء' };
    }
  };

  const rejectPurchaseInvoice = async (invoiceId: string, reason: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>(`/api/invoices/purchase/${invoiceId}/reject`, {
        method: 'POST',
        body: { reason },
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر رفض فاتورة الشراء' };
    }
  };

  const createSalesQuote = async (quoteData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => {
    const idempotencyKey = (quoteData as any)?.idempotencyKey || generateId('QUO');
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>('/api/invoices/quotes', {
        method: 'POST',
        body: quoteData,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('QUO-LOC');
        const op = await queueOfflineOp({
          operationType: 'create_sales_quote',
          entityType: 'quote',
          localId,
          summaryAr: `عرض سعر محلي (${quoteData.customerName || 'عميل'}) بمبلغ ${quoteData.grandTotal || 0} ج.م`,
          payload: { ...quoteData, localId },
        });
        const cust = data.customers.find((c) => c.id === quoteData.customerId);
        const optimisticQuote: Invoice = {
          id: localId,
          invoiceNumber: `LOC-QUO-${op.operationId.slice(-5)}`,
          type: 'quote',
          status: 'draft',
          date: quoteData.date || op.createdAt.slice(0, 10),
          customerId: quoteData.customerId,
          customerName: quoteData.customerName || cust?.name,
          warehouseId: quoteData.warehouseId,
          warehouseName: quoteData.warehouseName || '',
          items: quoteData.items || [],
          subtotal: quoteData.subtotal || 0,
          discountTotal: quoteData.discountTotal || 0,
          taxTotal: quoteData.taxTotal || 0,
          grandTotal: quoteData.grandTotal || 0,
          paidAmount: 0,
          remainingAmount: quoteData.grandTotal || 0,
          paymentType: 'credit',
          paymentMethod: 'cash',
          cashboxId: quoteData.cashboxId || '',
          notes: quoteData.notes,
          createdBy: currentUser.id,
          createdAt: op.createdAt,
          payments: [],
          localId,
          operationId: op.operationId,
          syncStatus: op.status,
        };
        return { success: true, invoice: optimisticQuote, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر إنشاء عرض السعر' };
    }
  };

  const convertQuoteToInvoice = async (quoteId: string, payload: Partial<Invoice> & { paidAtInvoice?: number } = {}) => {
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>(`/api/invoices/quotes/${quoteId}/convert`, {
        method: 'POST',
        body: payload,
        idempotencyKey: generateId('QCV'),
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحويل عرض السعر إلى فاتورة بيع' };
    }
  };

  const markInvoiceReviewed = async (invoiceId: string, reviewNotes = '') => {
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>(`/api/invoices/${invoiceId}/mark-reviewed`, {
        method: 'POST',
        body: { reviewNotes },
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تأكيد مراجعة الفاتورة' };
    }
  };

  const confirmDraftInvoice = async (invoiceId: string) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: 'اعتماد الفواتير يتطلب اتصالاً بالسيرفر المركزي لحسم المخزون والرصيد المعتمد.' };
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
        idempotencyKey: (paymentData as any)?.idempotencyKey || generateId('IDEMP'),
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        await queueOfflineOp({
          operationType: 'add_invoice_payment',
          entityType: 'payment',
          entityId: invoiceId,
          summaryAr: `سداد فاتورة (${invoiceId}): ${paymentData.amount} ج.م`,
          payload: { invoiceId, ...paymentData },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر تسجيل الدفعة' };
    }
  };

  const editSalesInvoice = async (invoiceId: string, updates: { date?: string; items?: Invoice['items']; discountTotal?: number; notes?: string; reason?: string }) => {
    const existing = data.invoices.find((i) => i.id === invoiceId);
    const body = { ...updates, baseVersion: existing?.version ?? 1 };
    try {
      await apiRequest(`/api/invoices/${invoiceId}`, {
        method: 'PUT',
        body,
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        await queueOfflineOp({
          operationType: 'edit_sales_invoice',
          entityType: 'invoice',
          entityId: invoiceId,
          summaryAr: `تعديل فاتورة (${existing?.invoiceNumber || invoiceId})`,
          payload: { invoiceId, ...body },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر تعديل الفاتورة' };
    }
  };

  const editPurchaseInvoice = async (
    invoiceId: string,
    updates: {
      date?: string;
      supplierId?: string;
      supplierName?: string;
      warehouseId?: string;
      warehouseName?: string;
      items?: Invoice['items'];
      discountTotal?: number;
      paidAmount?: number;
      paymentType?: Invoice['paymentType'];
      notes?: string;
      reason?: string;
    }
  ) => {
    const existing = data.invoices.find((i) => i.id === invoiceId);
    const body = { ...updates, baseVersion: existing?.version ?? 1 };
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>(`/api/invoices/purchase/${invoiceId}`, {
        method: 'PUT',
        body,
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        await queueOfflineOp({
          operationType: 'edit_purchase_invoice',
          entityType: 'invoice',
          entityId: invoiceId,
          summaryAr: `تعديل فاتورة مشتريات (${existing?.invoiceNumber || invoiceId})`,
          payload: { invoiceId, ...body },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر تعديل فاتورة المشتريات' };
    }
  };

  const createReturn = async (returnData: Omit<InvoiceReturn, 'id' | 'returnNumber' | 'createdAt' | 'createdBy'>) => {
    try {
      await apiRequest('/api/invoices/returns', {
        method: 'POST',
        body: returnData,
        idempotencyKey: generateId('IDEMP'),
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('RET-LOC');
        const opType = returnData.type === 'purchase_return' ? 'create_purchase_return' : 'create_invoice_return';
        await queueOfflineOp({
          operationType: opType,
          entityType: 'invoice_return',
          localId,
          summaryAr: `${returnData.type === 'purchase_return' ? 'مرتجع شراء محلي' : 'مرتجع بيع محلي'} (${returnData.originalInvoiceNumber || returnData.partyName || returnData.originalInvoiceId || ''})`,
          payload: { ...returnData, localId },
        });
        return { success: true, queuedOffline: true };
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
    try {
      await apiRequest('/api/admin/expenses', { method: 'POST', body: record });
      await loadRoleScopedData();
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const opType = record.type === 'income' ? 'profit_deposit' : 'expense';
        await queueOfflineOp({
          operationType: 'execute_cash_operation',
          entityType: 'cash_operation',
          summaryAr: `${record.type === 'expense' ? 'سند صرف محلي' : 'سند قبض محلي'} (${record.category}): ${record.amount} ج.م`,
          payload: {
            type: opType,
            cashboxId: record.cashboxId,
            amount: record.amount,
            date: record.date,
            category: record.category,
            recipientOrPayer: record.recipientOrPayer,
            notes: record.notes,
          },
        });
        return;
      }
      throw err;
    }
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
      return { success: false, error: 'التحويلات النقدية تتطلب اتصالاً بالسيرفر المركزي.' };
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
      return { success: false, error: 'تأكيد الاستلام النقدي يتطلب اتصالاً بالسيرفر المركزي.' };
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
      return { success: false, error: 'إرسال طلبات تحويل الأصناف يتطلب اتصالاً بالسيرفر المركزي.' };
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
    try {
      await apiRequest(`/api/inventory/rep-item-transfers/${requestId}/status`, {
        method: 'POST',
        body: { status: newStatus, approvedItems, notes },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (newStatus === 'received' && isNetworkFailure(err) && currentUser) {
        const req = (data.repItemTransfers || []).find((r) => r.id === requestId);
        await queueOfflineOp({
          operationType: 'confirm_custody_receipt',
          entityType: 'rep_item_transfer',
          entityId: requestId,
          summaryAr: `تأكيد استلام عهدة محلياً (${req?.requestNumber || requestId})`,
          payload: { requestId, notes },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر تحديث طلب التحويل' };
    }
  };

  const recordRepCustodyDelivery = async (payload: {
    representativeId?: string;
    customerId?: string;
    customerName?: string;
    productId: string;
    quantity: number;
    unit?: string;
    unitFactor?: number;
    date?: string;
    notes?: string;
    idempotencyKey?: string;
  }) => {
    const idempotencyKey = payload.idempotencyKey || generateId('CDLV');
    try {
      const res = await apiRequest<{ ok: boolean; operation: RepCustodyOperation }>('/api/inventory/rep-custody/deliver', {
        method: 'POST',
        body: payload,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, operation: res.operation };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('CDL-LOC');
        const prod = data.products.find((p) => p.id === payload.productId);
        const rep = (data.representatives || []).find((r) => r.id === payload.representativeId || r.userId === currentUser.id);
        await queueOfflineOp({
          operationType: 'record_custody_delivery',
          entityType: 'rep_custody_operation',
          localId,
          summaryAr: `تسليم من العهدة (${prod?.name || payload.productId}): ${payload.quantity}`,
          payload: {
            ...payload,
            representativeId: rep?.id || payload.representativeId,
            representativeName: rep?.name || currentUser.fullName,
            warehouseId: rep?.warehouseId,
            productName: prod?.name,
          },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر تسجيل التسليم من العهدة' };
    }
  };

  const recordRepCustodyReturn = async (payload: {
    representativeId?: string;
    targetWarehouseId?: string;
    productId: string;
    quantity: number;
    unit?: string;
    unitFactor?: number;
    date?: string;
    notes?: string;
    idempotencyKey?: string;
  }) => {
    const idempotencyKey = payload.idempotencyKey || generateId('CRET');
    try {
      const res = await apiRequest<{ ok: boolean; operation: RepCustodyOperation }>('/api/inventory/rep-custody/return', {
        method: 'POST',
        body: payload,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, operation: res.operation };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('CRET-LOC');
        const prod = data.products.find((p) => p.id === payload.productId);
        const rep = (data.representatives || []).find(
          (r) => r.id === payload.representativeId || r.userId === currentUser.id
        );
        const targetWh = (data.warehouses || []).find((w) => w.id === payload.targetWarehouseId) || data.warehouses[0];
        await queueOfflineOp({
          operationType: 'record_custody_return',
          entityType: 'rep_custody_operation',
          localId,
          summaryAr: `إرجاع عهدة للمخزن (${prod?.name || payload.productId}): ${payload.quantity}`,
          payload: {
            ...payload,
            representativeId: rep?.id || payload.representativeId,
            representativeName: rep?.name || currentUser.fullName,
            warehouseId: rep?.warehouseId,
            targetWarehouseId: targetWh?.id || payload.targetWarehouseId,
            targetWarehouseName: targetWh?.name,
            productName: prod?.name,
          },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر إرجاع الصنف للمخزن' };
    }
  };

  const recordRepCustodyAdjustment = async (payload: {
    representativeId: string;
    productId: string;
    operationType: 'custody_damaged' | 'custody_shortage' | 'custody_adjustment';
    quantity: number;
    unit?: string;
    unitFactor?: number;
    date?: string;
    notes?: string;
  }) => {
    try {
      const res = await apiRequest<{ ok: boolean; operation: RepCustodyOperation }>('/api/inventory/rep-custody/adjust', {
        method: 'POST',
        body: payload,
      });
      await loadRoleScopedData();
      return { success: true, operation: res.operation };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تسجيل تسوية العهدة' };
    }
  };

  const getRepCustodyStatement = async (repId?: string, filters?: { dateFrom?: string; dateTo?: string }) => {
    try {
      const qs = new URLSearchParams();
      if (repId) qs.set('repId', repId);
      if (filters?.dateFrom) qs.set('dateFrom', filters.dateFrom);
      if (filters?.dateTo) qs.set('dateTo', filters.dateTo);
      const res = await apiRequest<{ ok: boolean; statement: RepCustodyStatementResponse }>(
        `/api/inventory/rep-custody/statement${qs.toString() ? `?${qs.toString()}` : ''}`
      );
      return { success: true, statement: res.statement };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحميل كشف عهدة المندوب' };
    }
  };

  const getItemMovementReport = async (filters: {
    productId?: string;
    warehouseId?: string;
    movementType?: string;
    representativeId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  } = {}) => {
    try {
      const qs = new URLSearchParams();
      if (filters.productId) qs.set('productId', filters.productId);
      if (filters.warehouseId) qs.set('warehouseId', filters.warehouseId);
      if (filters.movementType) qs.set('movementType', filters.movementType);
      if (filters.representativeId) qs.set('representativeId', filters.representativeId);
      if (filters.dateFrom) qs.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) qs.set('dateTo', filters.dateTo);
      if (filters.search) qs.set('search', filters.search);
      const res = await apiRequest<{ ok: boolean; report: ItemMovementReportResponse }>(
        `/api/inventory/item-movement-report${qs.toString() ? `?${qs.toString()}` : ''}`
      );
      return { success: true, report: res.report };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحميل تقرير حركة الصنف' };
    }
  };

  // Customer & Representative Orders Lifecycle (Online + Persistent Sync Queue Offline)
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
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('ORD-LOC');
        const op = await queueOfflineOp({
          operationType: 'create_order',
          entityType: 'order',
          localId,
          summaryAr: `طلب أصناف محلي (${payload.customerName || 'عميل'})`,
          payload: {
            ...payload,
            localId,
            items: payload.items.map((it) => ({
              productId: it.productId,
              productName: it.productName,
              unit: it.unit,
              unitFactor: it.unitFactor,
              unitPrice: it.unitPrice,
              quantity: it.quantity,
            })),
          },
        });
        const estTotal = payload.items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
        const localOrder: CustomerItemOrderRequest = {
          id: localId,
          requestNumber: `LOC-${op.operationId.slice(-5)}`,
          customerId: payload.customerId,
          customerName: payload.customerName,
          requesterType: payload.requesterType,
          items: payload.items,
          totalEstimatedAmount: estTotal,
          notes: payload.notes,
          deliveryAddress: payload.deliveryAddress,
          geoCoordinates: payload.geoCoordinates,
          shopName: payload.shopName,
          customerPhone: payload.customerPhone,
          status: 'pending',
          createdAt: op.createdAt,
          localId,
          operationId: op.operationId,
          syncStatus: op.status,
        };
        return {
          success: true,
          order: localOrder,
          queuedOffline: true,
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
      return { success: false, error: err?.message || 'تعذر بدء مراجعة الطلب' };
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

  const assignOrderDeliveryRep = async (orderId: string, repId: string, notes?: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(`/api/orders/${orderId}/assign-rep`, {
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
    orderId: string,
    payload: {
      status: 'out_for_delivery' | 'delivered';
      collectedAmount?: number;
      cashboxId?: string;
      paymentMethod?: 'cash' | 'bank' | 'cheque';
      deliveryNotes?: string;
      deliveryProof?: string;
    }
  ) => {
    const idempotencyKey = generateId('DELIV');
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(
        `/api/orders/${orderId}/delivery-status`,
        {
          method: 'POST',
          body: payload,
          idempotencyKey,
        }
      );
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const ord = data.customerItemOrders?.find((o) => o.id === orderId);
        await queueOfflineOp({
          operationType: 'update_order_delivery',
          entityType: 'order',
          entityId: orderId,
          summaryAr: `${payload.status === 'delivered' ? 'تسليم طلب' : 'بدء توصيل طلب'} (${ord?.requestNumber || orderId})`,
          payload: { orderId, ...payload },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر تحديث حالة التوصيل' };
    }
  };

  const advanceOrderStage = async (
    orderId: string,
    payload: {
      status: 'preparing' | 'out_for_delivery' | 'delivered' | 'collected' | 'closed';
      collectedAmount?: number;
      cashboxId?: string;
      paymentMethod?: 'cash' | 'bank' | 'cheque';
      deliveryNotes?: string;
      notes?: string;
    }
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(`/api/orders/${orderId}/stage`, {
        method: 'POST',
        body: payload,
        idempotencyKey: generateId('ORDSTG'),
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر تحديث مرحلة الطلب' };
    }
  };

  const recordOrderAdvancePayment = async (
    orderId: string,
    payload: {
      amount: number;
      cashboxId: string;
      paymentMethod?: 'cash' | 'bank' | 'cheque';
      date?: string;
      notes?: string;
    }
  ) => {
    const idempotencyKey = generateId('ADV');
    try {
      const res = await apiRequest<{
        ok: boolean;
        order: CustomerItemOrderRequest;
        advancePayment: OrderAdvancePayment;
      }>(`/api/orders/${orderId}/advance-payment`, {
        method: 'POST',
        body: payload,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, order: res.order, advancePayment: res.advancePayment };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const ord = data.customerItemOrders?.find((o) => o.id === orderId);
        const localId = generateId('ADV-LOC');
        await queueOfflineOp({
          operationType: 'record_order_advance',
          entityType: 'order_advance',
          entityId: orderId,
          localId,
          summaryAr: `دفعة مقدمة على طلب (${ord?.requestNumber || orderId}): ${payload.amount} ج.م`,
          payload: { orderId, ...payload },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر تسجيل الدفعة المقدمة للطلب' };
    }
  };

  const convertOrderToInvoice = async (orderId: string, invoicePayload: Partial<Invoice> & { paidAtInvoice?: number }) => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest; invoice: Invoice }>(
        `/api/orders/${orderId}/convert-to-invoice`,
        {
          method: 'POST',
          body: invoicePayload,
          idempotencyKey: generateId('CNV'),
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
  const addUser = async (
    userData: Omit<User, 'id' | 'createdAt'> & {
      password?: string;
      linkedCustomerId?: string;
      autoCreateCustomerProfile?: boolean;
    }
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; user: User; linkedCustomerId?: string }>('/api/admin/users', {
        method: 'POST',
        body: userData,
      });
      await loadRoleScopedData();
      return { success: true, user: res.user, linkedCustomerId: res.linkedCustomerId };
    } catch (err: any) {
      return { success: false, error: err?.message || 'تعذر إنشاء المستخدم' };
    }
  };

  const updateUser = async (
    id: string,
    updates: Partial<User> & { newPassword?: string; linkedCustomerId?: string; autoCreateCustomerProfile?: boolean }
  ) => {
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

  const updateServerSettings = async (
    newSettings: Partial<ServerConnectionSettings>,
    options: {
      persistToServer?: boolean;
      applyToCurrentDevice?: boolean;
      targetDeviceUrl?: string;
    } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const prevServer = (data.serverSettings || getEmptyClientDatabaseState().serverSettings!) as ServerConnectionSettings;
    const prevProfiles = prevServer.profiles || getStoredConnectionProfiles();
    const nextProfiles: ConnectionProfilesConfig = newSettings.profiles
      ? {
          ...prevProfiles,
          ...newSettings.profiles,
          localNetwork: {
            ...prevProfiles.localNetwork,
            ...(newSettings.profiles.localNetwork || {}),
          },
          freeRemote: {
            ...prevProfiles.freeRemote,
            ...(newSettings.profiles.freeRemote || {}),
          },
          proRemote: {
            ...prevProfiles.proRemote,
            ...(newSettings.profiles.proRemote || {}),
          },
          cloudVps: {
            ...prevProfiles.cloudVps,
            ...(newSettings.profiles.cloudVps || {}),
          },
        }
      : prevProfiles;

    const canPersistServer =
      options.persistToServer !== false &&
      isAuthenticated &&
      Boolean(currentUser && (currentUser.role === 'admin' || currentUser.permissions?.canManageSettings));

    let persistedConnectionConfig = nextProfiles;

    if (canPersistServer) {
      try {
        const res = await apiRequest<{ ok: boolean; settings?: SystemSettings }>('/api/admin/settings', {
          method: 'PUT',
          body: {
            extraSettings: {
              ...(data.settings?.extraSettings || {}),
              connectionConfig: nextProfiles,
            },
          },
        });
        if (res.settings?.extraSettings?.connectionConfig) {
          persistedConnectionConfig = res.settings.extraSettings.connectionConfig;
        }
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || 'تعذر حفظ إعدادات الاتصال في السيرفر المركزي',
        };
      }
    }

    saveStoredConnectionProfiles(persistedConnectionConfig);

    if (options.applyToCurrentDevice === true) {
      const targetUrl =
        options.targetDeviceUrl !== undefined
          ? options.targetDeviceUrl
          : newSettings.apiBaseUrl ?? '';
      setConfiguredApiBaseUrl(targetUrl);
    } else if (options.applyToCurrentDevice === undefined && newSettings.apiBaseUrl !== undefined) {
      setConfiguredApiBaseUrl(newSettings.apiBaseUrl);
    }

    setData((prev) => {
      const mergedExtra = {
        ...(prev.settings?.extraSettings || {}),
        connectionConfig: persistedConnectionConfig,
      };
      return {
        ...prev,
        settings: {
          ...prev.settings,
          extraSettings: mergedExtra,
        },
        serverSettings: {
          ...(prev.serverSettings as ServerConnectionSettings),
          ...newSettings,
          profiles: persistedConnectionConfig,
        },
      };
    });

    return { success: true };
  };

  const testServerConnection = async (customUrl?: string) => {
    const target = customUrl !== undefined ? customUrl : getConfiguredApiBaseUrl();
    const res = await testServerHealth(target);
    setIsServerReachable(res.ok);
    if (res.ok) {
      setNetworkStatus('connected');
    }
    return {
      success: res.ok,
      latencyMs: res.latencyMs,
      mode: res.mode,
      protocol: res.protocol,
      httpsActive: res.httpsActive,
      lanUrls: res.lanUrls,
      version: res.version,
      error: res.error,
    };
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
      if (isNetworkFailure(err) && currentUser) {
        await queueOfflineOp({
          operationType: 'execute_cash_operation',
          entityType: 'cash_operation',
          summaryAr: `حركة خزينة محلية: ${payload.notes || payload.category || ''} (${payload.amount} ج.م)`,
          payload,
        });
        return { success: true, queuedOffline: true };
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

  const pendingSyncCount = syncQueue.filter((q) =>
    q.status === 'local' || q.status === 'pending' || q.status === 'syncing' || q.status === 'failed'
  ).length;
  const failedSyncCount = syncQueue.filter((q) => q.status === 'failed').length;
  const conflictsCount = syncConflicts.filter((c) => c.status === 'needs_review').length;
  const hasTentativeLocalBalances = pendingSyncCount > 0;

  if (!isInitialLoaded && isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white font-sans">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-lg font-bold">جاري تحميل ومزامنة بيانات نظام أولاد سليم...</p>
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
        syncConflicts,
        syncQueue,
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
        pendingChangesCount: pendingSyncCount + conflictsCount,
        offlineOrdersCount: syncQueue.filter((q) => q.operationType === 'create_order' && q.status !== 'synced').length,
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
        triggerSync,
        triggerManualSync,
        lastSendSummary,
        lastReceiveSummary,
        syncSendOnly,
        syncReceiveOnly,
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
        repairUnlinkedCustomerUsers,
        toggleCustomerUserStatus,
        recordCustomerPayment,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        recordSupplierPayment,
        settleSupplierAdvance,
        createSalesInvoice,
        createPurchaseInvoice,
        sendPurchaseInvoice,
        receivePurchaseInvoice,
        rejectPurchaseInvoice,
        createSalesQuote,
        convertQuoteToInvoice,
        markInvoiceReviewed,
        confirmDraftInvoice,
        cancelInvoice,
        addInvoicePayment,
        editSalesInvoice,
        editPurchaseInvoice,
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
        repCustodyOperations: data.repCustodyOperations || [],
        recordRepCustodyDelivery,
        recordRepCustodyReturn,
        recordRepCustodyAdjustment,
        getRepCustodyStatement,
        getItemMovementReport,
        createCustomerItemOrder,
        reviewCustomerItemOrder,
        approveCustomerItemOrder,
        rejectCustomerItemOrder,
        assignOrderDeliveryRep,
        updateOrderDeliveryStatus,
        advanceOrderStage,
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
        purchaseReceivers: data.purchaseReceivers || [],
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

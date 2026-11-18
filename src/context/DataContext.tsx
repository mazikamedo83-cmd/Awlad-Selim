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
  saveStoredConnectionProfiles,
  resolveModeEndpointUrl,
  detectModeFromUrl,
  testServerHealth,
  getDefaultConnectionProfiles,
} from '../services/api';
import { syncConnectionConfigFromServer } from '../services/discovery';
import { notifyLocal, subscribeAppForeground, subscribeNetworkStatus } from '../services/native';
import { localDb } from '../services/localDb';
import { normalizeServerOrigin, refreshCachedUserAuthorization } from '../services/offlineAuth';
import { getCachedProductImageMap, warmProductMediaCache } from '../services/mediaCache';
import { enqueueSyncOperation, runSyncCycle } from '../services/syncEngine';
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

  // Sales & Purchases
  createSalesInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  createPurchaseInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  confirmDraftInvoice: (invoiceId: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  cancelInvoice: (invoiceId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  addInvoicePayment: (invoiceId: string, payment: { amount: number; date?: string; paymentMethod: 'cash' | 'bank' | 'cheque'; cashboxId: string; notes?: string }) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  editSalesInvoice: (invoiceId: string, updates: { date?: string; items?: Invoice['items']; discountTotal?: number; notes?: string }) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;

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
  updateRepItemTransferStatus: (requestId: string, newStatus: RepItemTransferStatus, approvedItems?: RepTransferItem[], notes?: string) => Promise<{ success: boolean; error?: string }>;

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
  addUser: (userData: Omit<User, 'id' | 'createdAt'> & { password?: string; linkedCustomerId?: string; autoCreateCustomerProfile?: boolean }) => Promise<{ success: boolean; user?: User; linkedCustomerId?: string; error?: string }>;
  updateUser: (id: string, updates: Partial<User> & { newPassword?: string; linkedCustomerId?: string; autoCreateCustomerProfile?: boolean }) => Promise<{ success: boolean; error?: string }>;
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

function isNetworkFailure(err: any): boolean {
  return err?.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/**
 * Applies pending/failed local queue items optimistically onto a cached snapshot
 * so closing/reopening the app offline preserves every locally recorded invoice, order, payment, and balance.
 */
function overlayPendingQueueOnState(base: DatabaseState, queue: SyncQueueItem[]): DatabaseState {
  const pending = (queue || []).filter((q) => q.status !== 'synced');
  if (pending.length === 0) return base;

  const products = (base.products || []).map((p) => ({
    ...p,
    stockPerWarehouse: { ...(p.stockPerWarehouse || {}) },
  }));
  const customers = (base.customers || []).map((c) => ({ ...c }));
  const cashboxes = (base.cashboxes || []).map((cb) => ({ ...cb }));
  const invoices = (base.invoices || []).map((inv) => ({ ...inv }));
  const orders = (base.customerItemOrders || []).map((o) => ({ ...o }));
  const advancePayments = (base.orderAdvancePayments || []).map((a) => ({ ...a }));
  const returns = (base.invoiceReturns || []).map((r) => ({ ...r }));

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
        customers.unshift({
          id: targetId,
          code: p.code || `LOC-${op.operationId.slice(-4)}`,
          name: p.name || '',
          phone: p.phone || '',
          address: p.address || '',
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
        if (p.type === 'sales_return' && partyId && p.refundType === 'balance') {
          const cust = customers.find((c) => c.id === partyId);
          if (cust) cust.currentBalance = Number(cust.currentBalance || 0) - totalAmt;
        }
      }
    }
  }

  return {
    ...base,
    products,
    customers,
    cashboxes,
    invoices,
    customerItemOrders: orders,
    orderAdvancePayments: advancePayments,
    invoiceReturns: returns,
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

  const hydratedUserRef = useRef<string | null>(null);

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
      await localDb.saveSnapshot({
        userId: activeUser.id,
        scope: pullData.scope || 'staff',
        serverOrigin: normalizeServerOrigin(getConfiguredApiBaseUrl()),
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

        if (snap?.data?.dbState) {
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
      setIsServerReachable(false);
      setNetworkStatus(isNetworkFailure(err) ? 'disconnected' : 'error');
      setLastError(err?.message || 'تعذر مزامنة البيانات مع السيرفر');
    } finally {
      setIsSyncing(false);
      setIsInitialLoaded(true);
    }
  }, [isAuthenticated, currentUser, applyServerPullPayload, refreshQueueAndConflictsFromLocal, handleServerAuthRevoked, refreshAuthContext]);

  const triggerSync = useCallback(
    async (forceAll = false) => {
      if (!isAuthenticated || !currentUser) return;
      setNetworkStatus('synchronizing');
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
      } finally {
        setIsSyncing(false);
      }
    },
    [isAuthenticated, currentUser, refreshQueueAndConflictsFromLocal, handleServerAuthRevoked, applyServerPullPayload]
  );

  const triggerManualSync = useCallback(() => triggerSync(true), [triggerSync]);

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

    const unsubscribeNet = subscribeNetworkStatus((connected) => {
      setIsServerReachable(connected);
      if (connected) {
        triggerSync(false).catch(() => {});
        refreshMobileNotifications();
      } else {
        setNetworkStatus('disconnected');
      }
    });

    const unsubscribeFg = subscribeAppForeground(() => {
      if (navigator.onLine !== false) {
        triggerSync(false).catch(() => {});
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
            } else if (!outcome.serverReachable) {
              setNetworkStatus('disconnected');
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
          summaryAr: `إضافة عميل محليًا: ${custData.name}`,
          payload: { ...custData, localId },
        });
        return {
          id: localId,
          code: custData.code || `LOC-${op.operationId.slice(-4)}`,
          name: custData.name,
          phone: custData.phone,
          address: custData.address,
          status: custData.status || 'active',
          openingBalance: custData.openingBalance,
          currentBalance: custData.openingBalance,
          priceHistory: {},
          notes: custData.notes,
          createdAt: op.createdAt,
          syncStatus: 'pending',
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
          summaryAr: `تحديث بيانات العميل: ${current?.name || id}`,
          payload: { customerId: id, ...body },
        });
        setData((prev) => ({
          ...prev,
          customers: prev.customers.map((c) => (c.id === id ? { ...c, ...updates, syncStatus: 'pending' } : c)),
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

  // Invoices
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

  const createPurchaseInvoice = async (invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => {
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>('/api/invoices/purchase', {
        method: 'POST',
        body: invoiceData,
        idempotencyKey: generateId('IDEMP'),
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('PUR-LOC');
        await queueOfflineOp({
          operationType: 'create_purchase_invoice',
          entityType: 'invoice',
          localId,
          summaryAr: `فاتورة مشتريات محلية (${invoiceData.supplierName || 'مورد'})`,
          payload: { ...invoiceData, localId },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message || 'تعذر إنشاء فاتورة المشتريات' };
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
        idempotencyKey: generateId('IDEMP'),
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

  const editSalesInvoice = async (invoiceId: string, updates: { date?: string; items?: Invoice['items']; discountTotal?: number; notes?: string }) => {
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
        await queueOfflineOp({
          operationType: 'create_invoice_return',
          entityType: 'invoice_return',
          localId,
          summaryAr: `مرتجع محلي للفاتورة (${returnData.originalInvoiceNumber || returnData.originalInvoiceId})`,
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
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: 'تحديث حالة تحويل الأصناف يتطلب اتصالاً بالسيرفر المركزي.' };
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
          syncStatus: 'pending',
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
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white font-['Cairo']">
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

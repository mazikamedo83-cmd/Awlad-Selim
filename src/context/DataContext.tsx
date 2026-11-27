import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  DatabaseState,
  getEmptyClientDatabaseState,
  generateId,
} from '../services/storage';
import { setActivePrintTemplateConfig } from '../components/common/PdfExporter';
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
  fetchIdentitiesOverview,
  runIdentityAuditApi,
  linkEntityToIdentityApi,
  resolveIdentityConflictApi,
  fetchAdminStorefrontApi,
  saveStorefrontDraftApi,
  publishStorefrontApi,
  toggleCustomerFavoriteApi,
  fetchRepresentativeStatementApi,
  fetchSupplierPriceHistoryApi,
  createRepCustodyReturnRequestApi,
  approveRepCustodyReturnRequestApi,
  rejectRepCustodyReturnRequestApi,
  fetchSendReceiveActivityLogApi,
  fetchSyncSourceDocumentApi,
} from '../services/api';
import {
  DEFAULT_STOREFRONT_CONFIG,
  resolveActiveStorefrontOffer,
  ResolvedProductPromo,
} from '../utils/storefront';
import { getOrCreatePersistentDeviceId, subscribeNetworkStatus } from '../services/native';
import { localDb } from '../services/localDb';
import { normalizeServerOrigin, refreshCachedUserAuthorization } from '../services/offlineAuth';
import {
  EMPTY_USER_SYNC_STATE,
  enqueueSyncOperation,
  executeManualReceiveConfirm,
  executeManualReceivePreview,
  executeManualSendSync,
  getSendReceiveHistory,
  getStoredUserSyncState,
  getSyncRefreshStats,
  runSyncCycle,
  saveStoredUserSyncState,
  sendDispatchBatchToServer,
  SyncProgressUpdate,
  SyncRefreshSummary,
} from '../services/syncEngine';
import { formatLocaleTime, tr } from '../i18n/translator';
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
  ProductGroup,
  ProductCategory,
  UnitCatalogItem,
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
  SupplierStatementResponse,
  MobileNotificationItem,
  ConnectionMode,
  ConnectionProfilesConfig,
  SyncQueueItem,
  SyncConflictRecord,
  RoleDefaultPermissionPresets,
  PurchaseReturnRequest,
  PurchaseReturnRequestItem,
  SalesReturnRequest,
  SalesReturnRequestItem,
  UnifiedIdentity,
  IdentityRoleLink,
  IdentityConflict,
  IdentityEntityType,
  StorefrontConfig,
  SyncDispatchBatch,
  DispatchRecipientOption,
  ServerUserSyncState,
  ReceivePreviewResponse,
  ReceiveConfirmResponse,
  SendReceiveHistoryEntry,
  RepresentativeAccountStatement,
  SupplierPriceHistoryEntry,
  RepCustodyReturnRequest,
  SendReceiveActivityLogResponse,
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
  getCustomerStatement: (customerId: string) => Promise<CustomerStatementResponse | null>;
  getSupplierStatement: (supplierId: string) => Promise<SupplierStatementResponse | null>;
  getRepresentativeStatement: (repId: string) => Promise<RepresentativeAccountStatement | null>;
  getCustomerPriceHistory: (customerId: string, productId?: string) => Promise<Record<string, CustomerPriceHistoryEntry[]>>;
  getSupplierPriceHistory: (supplierId: string, productId?: string) => Promise<Record<string, SupplierPriceHistoryEntry[]>>;
  getSendReceiveActivityLog: (params?: { dateFrom?: string; dateTo?: string; repId?: string; operationType?: string; status?: string; docNumber?: string }) => Promise<SendReceiveActivityLogResponse | null>;
  getSyncSourceDocument: (docType: string, docId: string) => Promise<{ ok: boolean; document: any; auditTrail?: AuditLogItem[] } | null>;
  triggerSync: (forceAll?: boolean) => Promise<void>;
  triggerManualSync: () => Promise<void>;
  serverSyncState: ServerUserSyncState;
  lastSendSummary: SyncRefreshSummary | null;
  lastReceiveSummary: SyncRefreshSummary | null;
  sendReceiveHistory: SendReceiveHistoryEntry[];
  sendProgressPercent: number;
  sendProgressStage: string;
  receiveProgressPercent: number;
  receiveProgressStage: string;
  mandatorySendEnabled: boolean;
  mandatorySendIntervalMinutes: number;
  mandatorySendRemainingSeconds: number;
  isMandatorySending: boolean;
  isMandatorySendPendingRetry: boolean;
  triggerMandatorySendNow: () => Promise<{ ok: boolean; count: number; failedCount: number; error?: string }>;
  syncSendOnly: (options?: { includeHeldBatches?: boolean }) => Promise<{ ok: boolean; count: number; failedCount: number; conflictCount: number; error?: string }>;
  syncReceiveOnly: () => Promise<{ ok: boolean; count: number; error?: string }>;
  sendSyncOperations: (operationIds?: string[]) => Promise<{
    ok: boolean;
    sentCount: number;
    deduplicatedCount: number;
    failedCount: number;
    conflictCount: number;
    durationMs: number;
    sentAt: string | null;
    summary: Record<string, number>;
    syncState: ServerUserSyncState | null;
    error?: string;
  }>;
  previewReceiveUpdates: () => Promise<{
    ok: boolean;
    preview: ReceivePreviewResponse | null;
    durationMs: number;
    error?: string;
  }>;
  confirmReceiveUpdates: (options?: {
    idempotencyKey?: string;
    confirmCustodyIds?: string[];
    confirmCashTransferIds?: string[];
    confirmBatchIds?: string[];
    previewDurationMs?: number;
  }) => Promise<{
    ok: boolean;
    durationMs: number;
    response: ReceiveConfirmResponse | null;
    error?: string;
  }>;
  syncDispatchBatches: SyncDispatchBatch[];
  dispatchRecipients: DispatchRecipientOption[];
  incomingDispatchCount: number;
  pendingSendReceiveCount: number;
  createAndSendDispatchBatch: (params: {
    selectedOperations: SyncQueueItem[];
    recipientUserId: string;
    notes?: string;
    existingDraftBatch?: SyncDispatchBatch;
  }) => Promise<{ success: boolean; queuedOfflineConfirmed?: boolean; batch?: SyncDispatchBatch; error?: string }>;
  retryDispatchBatch: (batch: SyncDispatchBatch) => Promise<{ success: boolean; queuedOfflineConfirmed?: boolean; batch?: SyncDispatchBatch; error?: string }>;
  confirmDispatchReceipt: (
    batchId: string,
    receiptNotesOrOptions?:
      | string
      | {
          receiptNotes?: string;
          hasDiscrepancy?: boolean;
          discrepancyNote?: string;
        }
  ) => Promise<{ success: boolean; batch?: SyncDispatchBatch; error?: string }>;
  markDispatchReceiving: (batchId: string) => Promise<{ success: boolean; batch?: SyncDispatchBatch; error?: string }>;
  failDispatchReceipt: (batchId: string, reason: string) => Promise<{ success: boolean; batch?: SyncDispatchBatch; error?: string }>;
  refreshDispatches: () => Promise<void>;
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
  updateProduct: (id: string, updates: Partial<Product>) => Promise<{ success?: boolean; queuedOffline?: boolean } | void>;
  deleteProduct: (id: string) => Promise<{ success: boolean; error?: string }>;
  deleteImportedProducts: (payload?: { batchId?: string; deleteAllImported?: boolean }) => Promise<{ success: boolean; deletedCount?: number; skippedCount?: number; skippedItems?: Array<{ id: string; name: string; code: string }>; error?: string }>;
  toggleProductStatus: (id: string) => Promise<{ success: boolean; error?: string }>;
  transferStock: (productId: string, fromWarehouseId: string, toWarehouseId: string, quantity: number, notes: string) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  adjustStock: (productId: string, warehouseId: string, newQuantity: number, reason: string) => Promise<void>;
  recordDamagedStock: (productId: string, warehouseId: string, quantity: number, reason: string) => Promise<{ success?: boolean; queuedOffline?: boolean } | void>;

  // Product Groups & Categories
  productGroups: ProductGroup[];
  addProductGroup: (name: string, description?: string) => Promise<{ success: boolean; productGroup?: ProductGroup; error?: string }>;
  updateProductGroup: (id: string, updates: Partial<ProductGroup>) => Promise<{ success: boolean; productGroup?: ProductGroup; error?: string }>;
  deleteProductGroup: (id: string) => Promise<{ success: boolean; error?: string }>;
  toggleProductGroupStatus: (id: string) => Promise<{ success: boolean; error?: string }>;
  categories: ProductCategory[];
  addCategory: (name: string, description?: string, groupId?: string) => Promise<{ success: boolean; category?: ProductCategory; error?: string }>;
  updateCategory: (id: string, updates: Partial<ProductCategory>) => Promise<void>;
  deleteCategory: (id: string) => Promise<{ success: boolean; error?: string }>;
  toggleCategoryStatus: (id: string) => Promise<void>;
  productUnits: UnitCatalogItem[];
  addProductUnit: (name: string, shortCode?: string, notes?: string) => Promise<{ success: boolean; productUnit?: UnitCatalogItem; error?: string }>;
  updateProductUnit: (id: string, updates: Partial<UnitCatalogItem>) => Promise<{ success: boolean; productUnit?: UnitCatalogItem; error?: string }>;
  deleteProductUnit: (id: string) => Promise<{ success: boolean; error?: string }>;
  toggleProductUnitStatus: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Warehouses
  addWarehouse: (wh: Omit<Warehouse, 'id'>) => Promise<{ success: boolean; error?: string; warehouse?: Warehouse }>;
  updateWarehouse: (id: string, updates: Partial<Warehouse>) => Promise<void>;
  toggleWarehouseStatus: (id: string) => Promise<{ success: boolean; error?: string }>;
  ensureRepVanWarehouse: (repName: string) => Promise<{ success: boolean; warehouse?: Warehouse; error?: string }>;

  // Customers & Suppliers
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'currentBalance' | 'priceHistory'>) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string } | void>;
  updateOwnCustomerProfile: (updates: Partial<Customer>) => Promise<{ success: boolean; customer?: Customer; error?: string }>;
  deleteCustomer: (id: string) => Promise<{ success: boolean; error?: string }>;
  linkCustomerUser: (customerId: string, payload: { existingUserId?: string; createUser?: { fullName?: string; username: string; password: string; phone?: string; mustChangePassword?: boolean } }) => Promise<{ success: boolean; customer?: Customer; user?: User; error?: string }>;
  repairUnlinkedCustomerUsers: () => Promise<{ success: boolean; repairedCount?: number; error?: string }>;
  toggleCustomerUserStatus: (customerId: string, isActive: boolean) => Promise<{ success: boolean; isActive?: boolean; error?: string }>;
  recordCustomerPayment: (customerId: string, amount: number, cashboxId: string, notes: string, paymentMethod?: 'cash' | 'bank' | 'cheque', invoiceId?: string) => Promise<{ success: boolean; queuedOffline?: boolean; collectionLocation?: string; error?: string }>;

  addSupplier: (supplier: Omit<Supplier, 'id' | 'createdAt' | 'currentBalance'>) => Promise<Supplier>;
  updateSupplier: (id: string, updates: Partial<Supplier>) => Promise<{ success?: boolean; queuedOffline?: boolean } | void>;
  deleteSupplier: (id: string) => Promise<void>;
  recordSupplierPayment: (supplierId: string, amount: number, cashboxId: string, notes: string) => Promise<{ success: boolean; code?: string; isAdvancePayment?: boolean; advanceCreditBalance?: number; error?: string }>;
  settleSupplierAdvance: (supplierId: string, payload: { invoiceId: string; amount: number; notes?: string; date?: string }) => Promise<{ success: boolean; availableAdvanceAfter?: number; settledAmount?: number; error?: string }>;

  // Sales & Purchases & Quotes
  createSalesInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  createPurchaseInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'> & { sendNow?: boolean; recipientUserId?: string; recipientName?: string; isRepPurchase?: boolean }) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  sendPurchaseInvoice: (invoiceId: string, payload?: { recipientUserId?: string; recipientName?: string; notes?: string }) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  receivePurchaseInvoice: (invoiceId: string, notes?: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  rejectPurchaseInvoice: (invoiceId: string, reason: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  deleteDraftPurchaseInvoice: (invoiceId: string) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  createSalesQuote: (quoteData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice; queuedOffline?: boolean }>;
  convertQuoteToInvoice: (quoteId: string, payload?: Partial<Invoice> & { paidAtInvoice?: number }) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  markInvoiceReviewed: (invoiceId: string, reviewNotes?: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  confirmDraftInvoice: (invoiceId: string) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  cancelInvoice: (invoiceId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  addInvoicePayment: (invoiceId: string, payment: { amount: number; date?: string; paymentMethod: 'cash' | 'bank' | 'cheque'; cashboxId: string; notes?: string }) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  editSalesInvoice: (invoiceId: string, updates: { date?: string; items?: Invoice['items']; discountTotal?: number; notes?: string; reason?: string }) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  editPurchaseInvoice: (invoiceId: string, updates: { date?: string; supplierId?: string; supplierName?: string; warehouseId?: string; warehouseName?: string; items?: Invoice['items']; discountTotal?: number; paidAmount?: number; paymentType?: Invoice['paymentType']; notes?: string; reason?: string }) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string; invoice?: Invoice }>;

  // Returns & Rep Purchase Return Requests
  createReturn: (returnData: Omit<InvoiceReturn, 'id' | 'returnNumber' | 'createdAt' | 'createdBy'>) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  purchaseReturnRequests: PurchaseReturnRequest[];
  createPurchaseReturnRequest: (payload: {
    originalInvoiceId: string;
    items: Array<Pick<PurchaseReturnRequestItem, 'productId' | 'productName' | 'unit' | 'unitFactor' | 'quantity' | 'unitPrice'>>;
    refundType?: 'balance' | 'cash';
    cashboxId?: string;
    reason: string;
    notes?: string;
    date?: string;
  }) => Promise<{ success: boolean; request?: PurchaseReturnRequest; queuedOffline?: boolean; error?: string }>;
  approvePurchaseReturnRequest: (
    requestId: string,
    payload?: { refundType?: 'balance' | 'cash'; cashboxId?: string; date?: string; notes?: string }
  ) => Promise<{ success: boolean; request?: PurchaseReturnRequest; invoiceReturn?: InvoiceReturn; error?: string }>;
  rejectPurchaseReturnRequest: (
    requestId: string,
    reason: string
  ) => Promise<{ success: boolean; request?: PurchaseReturnRequest; error?: string }>;
  salesReturnRequests: SalesReturnRequest[];
  createSalesReturnRequest: (payload: {
    originalInvoiceId: string;
    items: Array<Pick<SalesReturnRequestItem, 'productId' | 'productName' | 'unit' | 'unitFactor' | 'quantity' | 'unitPrice'>>;
    refundType?: 'cash' | 'balance';
    cashboxId?: string;
    reason: string;
    notes?: string;
    date?: string;
  }) => Promise<{ success: boolean; request?: SalesReturnRequest; queuedOffline?: boolean; error?: string }>;
  approveSalesReturnRequest: (
    requestId: string,
    payload?: { refundType?: 'cash' | 'balance'; cashboxId?: string; date?: string; notes?: string }
  ) => Promise<{ success: boolean; request?: SalesReturnRequest; invoiceReturn?: InvoiceReturn; error?: string }>;
  rejectSalesReturnRequest: (
    requestId: string,
    reason: string
  ) => Promise<{ success: boolean; request?: SalesReturnRequest; error?: string }>;

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
    direction: 'owner_to_rep' | 'rep_to_owner' | 'rep_to_rep';
    senderId: string;
    senderName: string;
    receiverId: string;
    receiverName: string;
    amount: number;
    cashboxId?: string;
    notes?: string;
  }) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string; transfer?: RepTransfer }>;
  confirmRepTransferReceipt: (transferId: string, note?: string) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  rejectRepTransfer: (transferId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  createRepItemTransfer: (transferData: Omit<RepItemTransferRequest, 'id' | 'requestNumber' | 'createdAt' | 'status' | 'createdBy'> & { autoDispatch?: boolean }) => Promise<{ success: boolean; queuedOffline?: boolean; request?: RepItemTransferRequest; error?: string }>;
  updateRepItemTransferStatus: (requestId: string, newStatus: RepItemTransferStatus, approvedItems?: RepTransferItem[], notes?: string) => Promise<{ success: boolean; queuedOffline?: boolean; error?: string }>;
  repCustodyOperations: RepCustodyOperation[];
  repCustodyReturnRequests: RepCustodyReturnRequest[];
  recordRepCustodyDelivery: (payload: { representativeId?: string; customerId?: string; customerName?: string; productId: string; quantity: number; unit?: string; unitFactor?: number; date?: string; notes?: string; idempotencyKey?: string }) => Promise<{ success: boolean; operation?: RepCustodyOperation; queuedOffline?: boolean; error?: string }>;
  recordRepCustodyReturn: (payload: { representativeId?: string; targetWarehouseId?: string; productId: string; quantity: number; unit?: string; unitFactor?: number; date?: string; notes?: string; idempotencyKey?: string }) => Promise<{ success: boolean; operation?: RepCustodyOperation; queuedOffline?: boolean; error?: string }>;
  createRepCustodyReturnRequest: (payload: { representativeId?: string; targetWarehouseId?: string; date?: string; notes?: string; idempotencyKey?: string; items: Array<{ productId: string; unit?: string; unitFactor?: number; requestedQty: number; notes?: string }> }) => Promise<{ success: boolean; request?: RepCustodyReturnRequest; error?: string }>;
  approveRepCustodyReturnRequest: (requestId: string, payload: { items?: Array<{ productId: string; unit?: string; actualReceivedQty: number; approvedQty: number; rejectionReason?: string }>; reviewNotes?: string }) => Promise<{ success: boolean; request?: RepCustodyReturnRequest; error?: string }>;
  rejectRepCustodyReturnRequest: (requestId: string, reason: string) => Promise<{ success: boolean; request?: RepCustodyReturnRequest; error?: string }>;
  recordRepCustodyAdjustment: (payload: { representativeId: string; productId: string; operationType: 'custody_damaged' | 'custody_shortage' | 'custody_adjustment'; quantity: number; unit?: string; unitFactor?: number; date?: string; notes?: string }) => Promise<{ success: boolean; operation?: RepCustodyOperation; error?: string }>;
  getRepCustodyStatement: (repId?: string, filters?: { dateFrom?: string; dateTo?: string }) => Promise<{ success: boolean; statement?: RepCustodyStatementResponse; error?: string }>;
  getItemMovementReport: (filters?: { productId?: string; warehouseId?: string; movementType?: string; representativeId?: string; dateFrom?: string; dateTo?: string; search?: string; class1?: string; class2?: string }) => Promise<{ success: boolean; report?: ItemMovementReportResponse; error?: string }>;

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
  updateCustomerItemOrderContent: (orderId: string, payload: { items: Array<{ productId: string; unit?: string; unitFactor?: number; quantity: number }>; notes?: string; deliveryAddress?: string; geoCoordinates?: string }) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;
  cancelCustomerItemOrder: (orderId: string, reason?: string) => Promise<{ success: boolean; order?: CustomerItemOrderRequest; error?: string }>;

  // Employees
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<{ success: boolean; error?: string }>;
  updateEmployee: (id: string, updates: Omit<Partial<Employee>, 'userId'> & { userId?: string | null }) => Promise<{ success: boolean; error?: string }>;

  // Users, Unified Identities & Settings
  auditLogs: AuditLogItem[];
  identities: UnifiedIdentity[];
  identityRoles: IdentityRoleLink[];
  identityConflicts: IdentityConflict[];
  refreshIdentitiesOverview: () => Promise<{ success: boolean; error?: string }>;
  runIdentityAudit: (createBackup?: boolean) => Promise<{ success: boolean; result?: any; error?: string }>;
  linkEntityToIdentity: (payload: {
    targetType: IdentityEntityType;
    targetId: string;
    identityId?: string | null;
    linkEmployeeId?: string | null;
    linkUserId?: string | null;
  }) => Promise<{ success: boolean; identityId?: string; error?: string }>;
  resolveIdentityConflict: (
    conflictId: string,
    payload: { status: 'resolved' | 'dismissed' | 'pending_review'; resolutionNotes?: string }
  ) => Promise<{ success: boolean; error?: string }>;
  permissionPresets: RoleDefaultPermissionPresets | null;
  loadPermissionPresets: () => Promise<RoleDefaultPermissionPresets | null>;
  updatePermissionPresets: (presets: Partial<RoleDefaultPermissionPresets>) => Promise<{ success: boolean; presets?: RoleDefaultPermissionPresets; error?: string }>;
  addUser: (userData: Omit<User, 'id' | 'createdAt'> & { password?: string; linkedCustomerId?: string; linkedRepId?: string; linkedEmployeeId?: string | null; autoCreateCustomerProfile?: boolean; autoCreateRepProfile?: boolean; applyRolePreset?: boolean }) => Promise<{ success: boolean; user?: User; linkedCustomerId?: string; linkedRepresentativeId?: string; error?: string }>;
  updateUser: (id: string, updates: Partial<User> & { newPassword?: string; linkedCustomerId?: string; linkedRepId?: string; linkedEmployeeId?: string | null; autoCreateCustomerProfile?: boolean; autoCreateRepProfile?: boolean; applyRolePreset?: boolean }) => Promise<{ success: boolean; user?: User; linkedCustomerId?: string; linkedRepresentativeId?: string; error?: string }>;
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

  // Storefront CMS & Customer Favorites
  publishedStorefront: StorefrontConfig;
  storefrontDraft: StorefrontConfig | null;
  storefrontPublishedAdmin: StorefrontConfig | null;
  customerFavorites: string[];
  refreshStorefrontAdmin: () => Promise<{ success: boolean; draft?: StorefrontConfig; published?: StorefrontConfig; error?: string }>;
  saveStorefrontDraft: (config: Partial<StorefrontConfig>) => Promise<{ success: boolean; draft?: StorefrontConfig; error?: string }>;
  publishStorefront: (config?: Partial<StorefrontConfig>) => Promise<{ success: boolean; draft?: StorefrontConfig; published?: StorefrontConfig; error?: string }>;
  toggleCustomerFavorite: (productId: string) => Promise<{ success: boolean; favoriteProductIds: string[]; isFavorite: boolean; queuedOffline?: boolean; error?: string }>;
  resolveActiveOfferForProduct: (product: Product, unitName?: string) => ResolvedProductPromo;
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
export function overlayPendingQueueOnState(
  base: DatabaseState,
  queue: SyncQueueItem[],
  includeAll = false
): DatabaseState {
  const pending = includeAll
    ? (queue || [])
    : (queue || []).filter((q) => q.status !== 'synced');
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
  const purchaseReturnRequests = (base.purchaseReturnRequests || []).map((r) => ({ ...r }));
  const salesReturnRequests = (base.salesReturnRequests || []).map((r) => ({ ...r }));
  const financialTransactions = [...(base.financialTransactions || [])];
  const expenseIncomes = [...(base.expenseIncomes || [])];
  const repTransfers = (base.repTransfers || []).map((t) => ({ ...t }));
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
          if (paidAmount > 0 && !financialTransactions.some((t) => t.id === `FIN-${op.operationId}`)) {
            financialTransactions.unshift({
              id: `FIN-${op.operationId}`,
              transactionNumber: `LOC-FIN-${op.operationId.slice(-5)}`,
              date: p.date || op.createdAt.slice(0, 10),
              type: 'income',
              category: 'مبيعات',
              amount: paidAmount,
              cashboxId: p.cashboxId || '',
              cashboxName: cb?.name || 'تحصيل محلي',
              partyId: p.customerId,
              partyName: p.customerName || cust?.name || 'عميل',
              relatedDocId: targetId,
              relatedDocNumber: `LOC-INV-${op.operationId.slice(-5)}`,
              relatedDocType: 'sales',
              description: `تحصيل عند إصدار فاتورة محلية (${p.customerName || cust?.name || 'عميل'})`,
              createdBy: op.userId,
              createdAt: op.createdAt,
            });
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
    } else if (op.operationType === 'delete_purchase_draft') {
      const targetId = p.invoiceId || op.entityId;
      const idx = invoices.findIndex((i) => i.id === targetId || i.localId === targetId);
      if (idx >= 0 && invoices[idx].type === 'purchase' && invoices[idx].status === 'draft') {
        invoices.splice(idx, 1);
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
      const payAmt = Number(p.amount || 0);
      const cust = customers.find((c) => c.id === p.customerId);
      if (cust) cust.currentBalance = Number(cust.currentBalance || 0) - payAmt;
      const cb = cashboxes.find((c) => c.id === p.cashboxId);
      if (cb) cb.currentBalance = Number(cb.currentBalance || 0) + payAmt;
      const repTarget =
        (p.representativeId && representatives.find((r) => r.id === p.representativeId)) ||
        representatives.find((r) => r.userId === op.userId);
      if (repTarget && payAmt > 0) {
        repTarget.currentBalance = Number(repTarget.currentBalance || 0) + payAmt;
      }
      if (p.invoiceId && payAmt > 0) {
        const inv = invoices.find((i) => i.id === p.invoiceId || i.localId === p.invoiceId);
        if (inv) {
          inv.paidAmount = Number(inv.paidAmount || 0) + payAmt;
          inv.remainingAmount = Math.max(0, Number(inv.grandTotal || 0) - inv.paidAmount);
          inv.paymentType = inv.remainingAmount === 0 ? 'cash' : 'partial';
        }
      }
      const finId = `FIN-${op.operationId}`;
      if (payAmt > 0 && !financialTransactions.some((t) => t.id === finId)) {
        financialTransactions.unshift({
          id: finId,
          transactionNumber: `LOC-PAY-${op.operationId.slice(-5)}`,
          date: p.date || op.createdAt.slice(0, 10),
          type: 'customer_payment',
          category: 'تحصيل عميل',
          amount: payAmt,
          cashboxId: p.cashboxId || '',
          cashboxName: cb?.name || 'تحصيل محلي',
          partyId: p.customerId,
          partyName: cust?.name || p.customerName || 'عميل',
          relatedDocId: p.invoiceId || undefined,
          relatedDocType: p.invoiceId ? 'sales' : undefined,
          description: `تحصيل محلي من العميل (${cust?.name || p.customerName || ''})`,
          notes: p.notes || '',
          createdBy: op.userId,
          createdAt: op.createdAt,
        });
      }
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
        const primaryPhone = p.phone || nextPhones?.[0]?.phone || nextPhones?.[0]?.number || '';
        const secondaryPhone = p.secondaryPhone || nextPhones?.[1]?.phone || nextPhones?.[1]?.number || undefined;
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
          cust.phone = primaryEntry?.phone || primaryEntry?.number || p.phone || '';
          cust.secondaryPhone = secondEntry?.phone || secondEntry?.number || '';
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
          const origInv = invoices.find((i) => i.id === p.originalInvoiceId || i.localId === p.originalInvoiceId);
          if (origInv) {
            const retMap: Record<string, number> = { ...(origInv.returnedQuantityByItem || {}) };
            for (const it of p.items || []) {
              retMap[it.productId] = Number(retMap[it.productId] || 0) + Number(it.quantity || 0);
            }
            origInv.returnedQuantityByItem = retMap;
          }
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
    } else if (op.operationType === 'create_purchase_return_request') {
      const targetId = op.localId || op.entityId || op.operationId;
      if (!purchaseReturnRequests.some((r) => r.id === targetId)) {
        const origInv = invoices.find((i) => i.id === p.originalInvoiceId);
        const items = (Array.isArray(p.items) ? p.items : []).map((it: any) => ({
          productId: it.productId,
          productName: it.productName || '',
          unit: it.unit || '',
          unitFactor: Number(it.unitFactor || 1),
          quantity: Number(it.quantity || 0),
          unitPrice: Number(it.unitPrice || 0),
          total: Number(it.total ?? Number(it.quantity || 0) * Number(it.unitPrice || 0)),
        }));
        const grandTotal = items.reduce((s: number, it: any) => s + Number(it.total || 0), 0);
        purchaseReturnRequests.unshift({
          id: targetId,
          requestNumber: `LOC-PRR-${op.operationId.slice(-5)}`,
          date: p.date || op.createdAt.slice(0, 10),
          originalInvoiceId: p.originalInvoiceId || '',
          originalInvoiceNumber: origInv?.invoiceNumber || p.originalInvoiceNumber || '',
          supplierId: origInv?.supplierId || p.supplierId || '',
          supplierName: origInv?.supplierName || p.supplierName || 'مورد',
          warehouseId: origInv?.warehouseId || p.warehouseId || '',
          warehouseName: origInv?.warehouseName || p.warehouseName || '',
          requestedByUserId: op.userId,
          requestedByName: p.requestedByName || 'مندوب',
          items,
          grandTotal,
          refundType: p.refundType === 'cash' ? 'cash' : 'balance',
          cashboxId: p.refundType === 'cash' ? p.cashboxId : undefined,
          reason: p.reason || '',
          notes: p.notes || '',
          status: 'pending',
          syncStatus: op.status,
          createdAt: op.createdAt,
        });
      }
    } else if (op.operationType === 'create_sales_return_request') {
      const targetId = op.localId || op.entityId || op.operationId;
      if (!salesReturnRequests.some((r) => r.id === targetId)) {
        const origInv = invoices.find((i) => i.id === p.originalInvoiceId);
        const items = (Array.isArray(p.items) ? p.items : []).map((it: any) => ({
          productId: it.productId,
          productName: it.productName || '',
          unit: it.unit || '',
          unitFactor: Number(it.unitFactor || 1),
          quantity: Number(it.quantity || 0),
          unitPrice: Number(it.unitPrice || 0),
          total: Number(it.total ?? Number(it.quantity || 0) * Number(it.unitPrice || 0)),
        }));
        const grandTotal = items.reduce((s: number, it: any) => s + Number(it.total || 0), 0);
        salesReturnRequests.unshift({
          id: targetId,
          requestNumber: `LOC-SRR-${op.operationId.slice(-5)}`,
          date: p.date || op.createdAt.slice(0, 10),
          originalInvoiceId: p.originalInvoiceId || '',
          originalInvoiceNumber: origInv?.invoiceNumber || p.originalInvoiceNumber || '',
          customerId: origInv?.customerId || p.customerId || '',
          customerName: origInv?.customerName || p.customerName || 'عميل',
          warehouseId: origInv?.warehouseId || p.warehouseId || '',
          warehouseName: origInv?.warehouseName || p.warehouseName || '',
          requestedByUserId: op.userId,
          requestedByName: p.requestedByName || 'مندوب',
          items,
          grandTotal,
          refundType: p.refundType === 'balance' ? 'balance' : 'cash',
          cashboxId: undefined,
          reason: p.reason || '',
          notes: p.notes || '',
          status: 'pending',
          syncStatus: op.status,
          createdAt: op.createdAt,
        });
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
    } else if (op.operationType === 'update_own_profile') {
      const targetId = p.customerId || op.entityId;
      const cust = customers.find((c) => !targetId || c.id === targetId);
      if (cust) {
        Object.assign(cust, {
          name: p.name ?? cust.name,
          shopName: p.shopName ?? cust.shopName,
          phone: p.phone ?? cust.phone,
          secondaryPhone: p.secondaryPhone ?? cust.secondaryPhone,
          phones: p.phones ?? cust.phones,
          governorate: p.governorate ?? cust.governorate,
          area: p.area ?? cust.area,
          city: p.city ?? cust.city,
          address: p.address ?? cust.address,
          geoCoordinates: p.geoCoordinates ?? cust.geoCoordinates,
          latitude: p.latitude !== undefined ? p.latitude : cust.latitude,
          longitude: p.longitude !== undefined ? p.longitude : cust.longitude,
          locationCapturedAt: p.locationCapturedAt !== undefined ? p.locationCapturedAt : cust.locationCapturedAt,
          syncStatus: op.status,
        });
      }
    } else if (op.operationType === 'update_customer_favorites') {
      const ids = Array.isArray(p.favoriteProductIds) ? p.favoriteProductIds.map(String) : null;
      if (ids && customers[0]) {
        customers[0].favoriteProductIds = ids;
      }
    } else if (op.operationType === 'update_product') {
      const pid = p.productId || op.entityId;
      const prod = products.find((pr) => pr.id === pid);
      if (prod) {
        Object.assign(prod, {
          name: p.name ?? prod.name,
          code: p.code ?? prod.code,
          barcode: p.barcode ?? prod.barcode,
          category: p.category ?? prod.category,
          purchasePrice: p.purchasePrice !== undefined ? Number(p.purchasePrice) : prod.purchasePrice,
          sellingPrice: p.sellingPrice !== undefined ? Number(p.sellingPrice) : prod.sellingPrice,
          minStockLevel:
            p.minStockLevel !== undefined
              ? Number(p.minStockLevel)
              : p.minStockAlert !== undefined
              ? Number(p.minStockAlert)
              : prod.minStockLevel,
          status: p.status ?? prod.status,
          notes: p.notes ?? prod.notes,
        });
      }
    } else if (op.operationType === 'update_supplier') {
      const sid = p.supplierId || op.entityId;
      const supp = suppliers.find((s) => s.id === sid);
      if (supp) {
        Object.assign(supp, {
          name: p.name ?? supp.name,
          phone: p.phone ?? supp.phone,
          address: p.address ?? supp.address,
          status: p.status ?? supp.status,
          notes: p.notes ?? supp.notes,
        });
      }
    } else if (op.operationType === 'transfer_stock') {
      const qty = Number(p.quantity || 0);
      const prod = products.find((pr) => pr.id === p.productId);
      if (prod && qty > 0) {
        if (p.fromWarehouseId) {
          prod.stockPerWarehouse[p.fromWarehouseId] = Math.max(0, Number(prod.stockPerWarehouse[p.fromWarehouseId] || 0) - qty);
        }
        if (p.toWarehouseId) {
          prod.stockPerWarehouse[p.toWarehouseId] = Number(prod.stockPerWarehouse[p.toWarehouseId] || 0) + qty;
        }
      }
    } else if (op.operationType === 'record_damaged_stock') {
      const qty = Number(p.quantity || 0);
      const prod = products.find((pr) => pr.id === p.productId);
      if (prod && qty > 0 && p.warehouseId) {
        prod.stockPerWarehouse[p.warehouseId] = Math.max(0, Number(prod.stockPerWarehouse[p.warehouseId] || 0) - qty);
      }
    } else if (op.operationType === 'create_rep_transfer') {
      const targetId = op.localId || op.entityId || op.operationId;
      if (!repTransfers.some((t) => t.id === targetId)) {
        const cb = cashboxes.find((c) => c.id === p.cashboxId);
        repTransfers.unshift({
          id: targetId,
          transferNumber: `LOC-TRF-${op.operationId.slice(-5)}`,
          date: op.createdAt.slice(0, 10),
          timestamp: op.createdAt,
          direction: p.direction || 'rep_to_owner',
          senderId: p.senderId || '',
          senderName: p.senderName || '',
          receiverId: p.receiverId || '',
          receiverName: p.receiverName || '',
          amount: Number(p.amount || 0),
          cashboxId: p.cashboxId || '',
          cashboxName: cb?.name || (p.direction === 'rep_to_rep' ? 'تحويل بين مناديب' : ''),
          notes: p.notes || '',
          status: 'awaiting_receipt',
          sentAt: op.createdAt,
          auditTrail: [
            {
              timestamp: op.createdAt,
              action: 'طلب تحويل مالي محلي (بانتظار الإرسال والاستلام)',
              user: op.userId,
              note: p.notes || '',
            },
          ],
        });
      }
    } else if (op.operationType === 'confirm_rep_transfer') {
      const trId = p.transferId || op.entityId;
      const tr = repTransfers.find((t) => t.id === trId);
      if (tr && tr.status === 'awaiting_receipt') {
        tr.status = 'received';
        tr.confirmedAt = op.createdAt;
        const amt = Number(tr.amount || 0);
        if (tr.direction === 'rep_to_rep') {
          const sRep = representatives.find((r) => r.id === tr.senderId);
          const rRep = representatives.find((r) => r.id === tr.receiverId);
          if (sRep) sRep.currentBalance = Number(sRep.currentBalance || 0) - amt;
          if (rRep) rRep.currentBalance = Number(rRep.currentBalance || 0) + amt;
        } else {
          const repId = tr.direction === 'rep_to_owner' ? tr.senderId : tr.receiverId;
          const rep = representatives.find((r) => r.id === repId);
          const cb = cashboxes.find((c) => c.id === tr.cashboxId);
          if (rep) {
            rep.currentBalance = tr.direction === 'rep_to_owner' ? Number(rep.currentBalance || 0) - amt : Number(rep.currentBalance || 0) + amt;
          }
          if (cb) {
            cb.currentBalance = tr.direction === 'rep_to_owner' ? Number(cb.currentBalance || 0) + amt : Number(cb.currentBalance || 0) - amt;
          }
        }
      }
    } else if (op.operationType === 'create_rep_item_transfer') {
      const targetId = op.localId || op.entityId || op.operationId;
      if (!repItemTransfers.some((r) => r.id === targetId)) {
        const isAuto = Boolean((p.transferMode === 'custody_dispatch' || p.transferMode === 'rep_to_rep') && p.autoDispatch);
        repItemTransfers.unshift({
          id: targetId,
          requestNumber: `LOC-RIT-${op.operationId.slice(-5)}`,
          date: p.date || op.createdAt.slice(0, 10),
          representativeId: p.representativeId || '',
          representativeName: p.representativeName || '',
          senderRepresentativeId: p.senderRepresentativeId,
          senderRepresentativeName: p.senderRepresentativeName,
          invoiceId: p.invoiceId,
          invoiceNumber: p.invoiceNumber,
          sourceWarehouseId: p.sourceWarehouseId || '',
          sourceWarehouseName: p.sourceWarehouseName || '',
          targetWarehouseId: p.targetWarehouseId || '',
          targetWarehouseName: p.targetWarehouseName || '',
          items: Array.isArray(p.items) ? p.items : [],
          status: isAuto ? 'executed' : 'pending',
          transferMode: p.transferMode || 'transfer',
          notes: p.notes || '',
          createdBy: op.userId,
          createdAt: op.createdAt,
        });
        if (isAuto && p.sourceWarehouseId) {
          for (const it of p.items || []) {
            const prod = products.find((pr) => pr.id === it.productId);
            const qty = Number(it.approvedQty ?? it.requestedQty ?? 0);
            if (prod && qty > 0) {
              prod.stockPerWarehouse[p.sourceWarehouseId] = Math.max(0, Number(prod.stockPerWarehouse[p.sourceWarehouseId] || 0) - qty);
            }
          }
        }
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
    purchaseReturnRequests,
    salesReturnRequests,
    financialTransactions,
    expenseIncomes,
    repTransfers,
    repItemTransfers,
    repCustodyOperations,
  };
}

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, isAuthenticated, handleServerAuthRevoked, refreshAuthContext } = useAuth();
  const [data, setData] = useState<DatabaseState>(() => getEmptyClientDatabaseState());
  const [networkStatus, setNetworkStatus] = useState<NetworkSyncStatus>('connected');
  const [lastSyncTime, setLastSyncTime] = useState<string>(formatLocaleTime(new Date()));
  const [lastServerSyncAt, setLastServerSyncAt] = useState<string | null>(null);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictRecord[]>([]);
  const [syncDispatchBatches, setSyncDispatchBatches] = useState<SyncDispatchBatch[]>([]);
  const [dispatchRecipients, setDispatchRecipients] = useState<DispatchRecipientOption[]>([]);
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
  const [serverSyncState, setServerSyncState] = useState<ServerUserSyncState>(() => ({ ...EMPTY_USER_SYNC_STATE }));
  const [lastSendSummary, setLastSendSummary] = useState<SyncRefreshSummary | null>(null);
  const [lastReceiveSummary, setLastReceiveSummary] = useState<SyncRefreshSummary | null>(null);
  const [sendReceiveHistory, setSendReceiveHistory] = useState<SendReceiveHistoryEntry[]>([]);
  const [sendProgressPercent, setSendProgressPercent] = useState<number>(0);
  const [sendProgressStage, setSendProgressStage] = useState<string>('');

  useEffect(() => {
    const tpl = data.settings?.extraSettings?.invoiceTemplate;
    setActivePrintTemplateConfig({
      showLogo: tpl?.showLogo,
      footerText: tpl?.footerText || data.settings?.invoiceNotes,
      repPhoneConfig: tpl?.repPhoneConfig,
      customPrintFields: tpl?.customPrintFields,
    });
  }, [data.settings]);
  const [receiveProgressPercent, setReceiveProgressPercent] = useState<number>(0);
  const [receiveProgressStage, setReceiveProgressStage] = useState<string>('');
  const [publishedStorefront, setPublishedStorefront] = useState<StorefrontConfig>(DEFAULT_STOREFRONT_CONFIG);
  const [storefrontDraft, setStorefrontDraft] = useState<StorefrontConfig | null>(null);
  const [storefrontPublishedAdmin, setStorefrontPublishedAdmin] = useState<StorefrontConfig | null>(null);
  const [customerFavorites, setCustomerFavorites] = useState<string[]>([]);

  const hydratedUserRef = useRef<string | null>(null);
  const isDbUnavailableRef = useRef<boolean>(false);
  const isSyncingRef = useRef<boolean>(false);
  const loadRoleScopedDataRef = useRef<(() => Promise<void>) | null>(null);

  // Full manual control mode: mandatory countdown & background auto-sync are permanently disabled
  const mandatorySendEnabled = false;
  const mandatorySendIntervalMinutes = 0;
  const mandatorySendRemainingSeconds = 0;
  const isMandatorySending = false;
  const isMandatorySendPendingRetry = false;
  const resetMandatoryCountdown = useCallback(() => 0, []);

  const refreshSyncStatsFromLocal = useCallback(async () => {
    if (!currentUser?.id) {
      setLastSendSummary(null);
      setLastReceiveSummary(null);
      setSendReceiveHistory([]);
      setServerSyncState({ ...EMPTY_USER_SYNC_STATE });
      return;
    }
    const [stats, storedSyncState, history] = await Promise.all([
      getSyncRefreshStats(currentUser.id).catch(() => ({
        lastSendSummary: null,
        lastReceiveSummary: null,
      })),
      getStoredUserSyncState(currentUser.id).catch(() => ({ ...EMPTY_USER_SYNC_STATE })),
      getSendReceiveHistory(currentUser.id).catch(() => [] as SendReceiveHistoryEntry[]),
    ]);
    setLastSendSummary(stats.lastSendSummary);
    setLastReceiveSummary(stats.lastReceiveSummary);
    setSendReceiveHistory(history);
    setServerSyncState(storedSyncState);
  }, [currentUser?.id]);

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
          message
            ? tr(message)
            : tr(
                'قاعدة البيانات المركزية (PostgreSQL) غير متاحة مؤقتًا. تم إيقاف العمليات لحماية البيانات ومنع انقسامها.',
                'Central PostgreSQL database is temporarily unavailable. Operations are paused to protect data integrity.'
              )
        );
      } else if (isDbUnavailableRef.current) {
        isDbUnavailableRef.current = false;
        setLastError(null);
        setNetworkStatus((prev) => (prev === 'error' ? 'connected' : prev));
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
          productGroups: pullData.productGroups || [],
          categories: pullData.categories || [],
          productUnits: pullData.productUnits || [],
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
          productGroups: pullData.productGroups || [],
          productUnits: pullData.productUnits || [],
          repCustodyOperations: pullData.repCustodyOperations || [],
          repCustodyReturnRequests: pullData.repCustodyReturnRequests || [],
          purchaseReceivers: pullData.purchaseReceivers || [],
          purchaseReturnRequests: pullData.purchaseReturnRequests || [],
          salesReturnRequests: pullData.salesReturnRequests || [],
          identities: pullData.identities || [],
          identityRoles: pullData.identityRoles || [],
          identityConflicts: pullData.identityConflicts || [],
          serverSettings: hydratedServerSettings,
        };
      }

      const currentQueue = await localDb.listSyncQueue(activeUser.id);
      const effectiveState = overlayPendingQueueOnState(nextStateBase, currentQueue);

      setData((prev) => ({
        ...effectiveState,
        migrationLogs: pullData.migrationLogs || prev.migrationLogs || [],
      }));
      const nextStorefront: StorefrontConfig =
        pullData.publishedStorefront ||
        pullData.settings?.extraSettings?.storefrontPublished ||
        DEFAULT_STOREFRONT_CONFIG;
      setPublishedStorefront(nextStorefront);

      const favFromQueue = [...currentQueue]
        .reverse()
        .find((q) => q.status !== 'synced' && q.operationType === 'update_customer_favorites' && Array.isArray(q.payload?.favoriteProductIds));
      const nextFavorites: string[] = favFromQueue
        ? favFromQueue.payload.favoriteProductIds.map(String)
        : Array.isArray(pullData.customerFavorites)
        ? pullData.customerFavorites.map(String)
        : Array.isArray(pullData.customerProfile?.favoriteProductIds)
        ? pullData.customerProfile.favoriteProductIds.map(String)
        : [];
      setCustomerFavorites(nextFavorites);

      if (pullData.settings?.extraSettings?.storefrontDraft) {
        setStorefrontDraft(pullData.settings.extraSettings.storefrontDraft);
      }
      if (pullData.settings?.extraSettings?.storefrontPublished) {
        setStorefrontPublishedAdmin(pullData.settings.extraSettings.storefrontPublished);
      }

      setCustomerStatement(nextStmt);
      setSyncQueue(currentQueue);
      setSyncConflicts(Array.isArray(pullData.syncConflicts) ? pullData.syncConflicts : []);
      if (Array.isArray(pullData.dispatchRecipients)) {
        setDispatchRecipients(pullData.dispatchRecipients);
      }
      const serverBatches: SyncDispatchBatch[] = Array.isArray(pullData.syncDispatchBatches)
        ? pullData.syncDispatchBatches
        : [];
      const localBatches = await localDb.listDispatchBatches(activeUser.id);
      const mergedBatches: SyncDispatchBatch[] = [...serverBatches];
      for (const lb of localBatches) {
        const matched = mergedBatches.some(
          (sb) => sb.id === lb.id || (lb.clientBatchUuid && sb.clientBatchUuid === lb.clientBatchUuid)
        );
        if (!matched && (lb.isLocalOnly || lb.sendStatus === 'فشل الإرسال' || lb.sendStatus === 'جاري الإرسال')) {
          mergedBatches.unshift(lb);
        }
      }
      await localDb.saveDispatchBatches(activeUser.id, mergedBatches);
      setSyncDispatchBatches(mergedBatches);
      if (pullData.syncState) {
        const nextSyncState = { ...EMPTY_USER_SYNC_STATE, ...pullData.syncState };
        setServerSyncState(nextSyncState);
        await saveStoredUserSyncState(activeUser.id, nextSyncState).catch(() => {});
      }
      setIsUsingOfflineCache(false);
      setLastCacheTimestamp(null);
      const nowServerTime = pullData.serverTime || new Date().toISOString();
      setLastServerSyncAt(nowServerTime);
      setLastSyncTime(formatLocaleTime(new Date()));

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
          publishedStorefront: nextStorefront,
          customerFavorites: nextFavorites,
        },
      });

      // Keep local auth permissions & active status synced with central DB
      if (pullData.user) {
        if (pullData.user.isActive === false) {
          await handleServerAuthRevoked(tr('تم إيقاف الحساب من الإدارة مركزيًا.', 'Account suspended centrally by administration.'));
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
    },
    [handleServerAuthRevoked]
  );

  // Read-only initial/CRUD workspace loader (NEVER calls /api/sync/pull or modifies sync timestamps)
  const loadRoleScopedData = useCallback(async () => {
    if (!isAuthenticated || !currentUser) {
      setIsInitialLoaded(true);
      return;
    }

    try {
      if (currentUser.role === 'customer') {
        const outcome = await runSyncCycle({ userId: currentUser.id, forceAll: false, mode: 'receive_only', silent: true });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        if (outcome.authRevoked) {
          await handleServerAuthRevoked(outcome.revokeReason);
          return;
        }
        setIsServerReachable(outcome.serverReachable);
        if (outcome.serverReachable && outcome.ok && outcome.pullData) {
          await applyServerPullPayload(outcome.pullData, currentUser);
          setNetworkStatus(outcome.conflictCount > 0 || outcome.failedCount > 0 ? 'pending' : 'connected');
          setLastError(null);
        } else {
          setNetworkStatus(outcome.serverReachable ? 'error' : 'disconnected');
          if (outcome.error) setLastError(outcome.error);
        }
        return;
      }

      const bootRes = await apiRequest<{ ok: boolean; data: any }>('/api/admin/bootstrap');
      if (bootRes?.data) {
        const payload = {
          scope: currentUser.role === 'representative' ? 'representative' : 'staff',
          serverTime: new Date().toISOString(),
          user: currentUser,
          ...bootRes.data,
        };
        await applyServerPullPayload(payload, currentUser);
        setIsServerReachable(true);
        const q = await localDb.listSyncQueue(currentUser.id);
        const hasPending = q.some((item) => item.status !== 'synced');
        setNetworkStatus(hasPending ? 'pending' : 'connected');
        setLastError(null);
      }
    } catch (err: any) {
      const code = String(err?.code || '');
      if (err?.status === 401 || code === 'SESSION_REVOKED' || code === 'INVALID_TOKEN' || code === 'DEVICE_REVOKED') {
        await handleServerAuthRevoked(err?.message);
        return;
      }
      const networkDown = isNetworkFailure(err);
      setIsServerReachable(!networkDown);
      setNetworkStatus(networkDown ? 'disconnected' : 'error');
      setLastError(err?.message ? tr(err.message) : tr('تعذر تحميل بيانات العمل حالياً', 'Could not load workspace data right now'));
    } finally {
      setIsInitialLoaded(true);
    }
  }, [isAuthenticated, currentUser, applyServerPullPayload, refreshQueueAndConflictsFromLocal, handleServerAuthRevoked]);

  loadRoleScopedDataRef.current = loadRoleScopedData;

  // Instant Offline-First Hydration from LocalDB whenever user logs in or refreshes.
  // Strictly NEVER triggers automatic Send/Receive syncs on login, open, or page refresh.
  useEffect(() => {
    let cancelled = false;
    const hydrateFromLocalDb = async () => {
      if (!isAuthenticated || !currentUser) {
        hydratedUserRef.current = null;
        setData(getEmptyClientDatabaseState());
        setCustomerStatement(null);
        setPublishedStorefront(DEFAULT_STOREFRONT_CONFIG);
        setStorefrontDraft(null);
        setStorefrontPublishedAdmin(null);
        setCustomerFavorites([]);
        setSyncQueue([]);
        setSyncConflicts([]);
        setSyncDispatchBatches([]);
        setDispatchRecipients([]);
        setMobileNotifications([]);
        setServerSyncState({ ...EMPTY_USER_SYNC_STATE });
        setLastSendSummary(null);
        setLastReceiveSummary(null);
        setSendReceiveHistory([]);
        setLastServerSyncAt(null);
        setIsUsingOfflineCache(false);
        setLastCacheTimestamp(null);
        setIsInitialLoaded(true);
        return;
      }

      if (hydratedUserRef.current !== currentUser.id) {
        hydratedUserRef.current = currentUser.id;
        setData(getEmptyClientDatabaseState());
        setCustomerStatement(null);
        setPublishedStorefront(DEFAULT_STOREFRONT_CONFIG);
        setStorefrontDraft(null);
        setStorefrontPublishedAdmin(null);
        setCustomerFavorites([]);
        setMobileNotifications([]);
        setSyncQueue([]);
        setSyncConflicts([]);
        setSyncDispatchBatches([]);
        setDispatchRecipients([]);
        setServerSyncState({ ...EMPTY_USER_SYNC_STATE });
        setLastServerSyncAt(null);
        setIsUsingOfflineCache(false);
        setLastCacheTimestamp(null);

        const [snap, queue, conflicts, dispatchBatches, lastSyncMeta, storedSyncState, history] = await Promise.all([
          localDb.getSnapshot(currentUser.id),
          localDb.listSyncQueue(currentUser.id),
          localDb.listConflicts(currentUser.id),
          localDb.listDispatchBatches(currentUser.id),
          localDb.getMeta<string>(`last_sync_at:${currentUser.id}`),
          getStoredUserSyncState(currentUser.id),
          getSendReceiveHistory(currentUser.id),
        ]);
        if (cancelled) return;

        setSyncQueue(queue);
        setSyncConflicts(conflicts);
        setSyncDispatchBatches(dispatchBatches);
        setLastServerSyncAt(lastSyncMeta || null);
        setServerSyncState(storedSyncState);
        setSendReceiveHistory(history);

        const expectedOrigin = normalizeServerOrigin(getConfiguredApiBaseUrl());
        const expectedInstallationId = getStoredInstallationId();
        const snapshotMatchesServer =
          snap?.data?.dbState &&
          (!snap.serverOrigin || snap.serverOrigin === expectedOrigin) &&
          (!expectedInstallationId || !snap.installationId || snap.installationId === expectedInstallationId);

        if (snapshotMatchesServer && snap?.data?.dbState) {
          const effective = overlayPendingQueueOnState(snap.data.dbState, queue);
          setData(effective);
          if (Array.isArray(snap.data.dbState.dispatchRecipients)) {
            setDispatchRecipients(snap.data.dbState.dispatchRecipients);
          }
          if ((!dispatchBatches || dispatchBatches.length === 0) && Array.isArray(snap.data.dbState.syncDispatchBatches)) {
            setSyncDispatchBatches(snap.data.dbState.syncDispatchBatches);
          }
          if (snap.data.customerStatement) {
            setCustomerStatement(snap.data.customerStatement);
          }
          if (snap.data.publishedStorefront) {
            setPublishedStorefront(snap.data.publishedStorefront);
          } else if (snap.data.dbState.settings?.extraSettings?.storefrontPublished) {
            setPublishedStorefront(snap.data.dbState.settings.extraSettings.storefrontPublished);
          }
          if (Array.isArray(snap.data.customerFavorites)) {
            setCustomerFavorites(snap.data.customerFavorites.map(String));
          }
          const onlineNow = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
          const hasPendingOps = queue.some((q) => q.status !== 'synced');
          const hasUnresolvedConflicts = conflicts.some((c) => c.status === 'needs_review');
          setIsServerReachable(onlineNow);
          setNetworkStatus(!onlineNow ? 'disconnected' : (hasPendingOps || hasUnresolvedConflicts) ? 'pending' : 'connected');
          setIsUsingOfflineCache(!onlineNow);
          setLastCacheTimestamp(snap.cachedAt);
          setIsInitialLoaded(true);
        } else {
          // Brand new device/login with no cached snapshot: run one-time read-only baseline bootstrap
          await loadRoleScopedData();
        }
      }
    };

    hydrateFromLocalDb();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, currentUser?.id, loadRoleScopedData]);

  // Explicit workspace refresh ONLY when invoked directly (never auto-runs Sync Send or Receive)
  const triggerSync = useCallback(
    async (_forceAll = false) => {
      await loadRoleScopedData();
    },
    [loadRoleScopedData]
  );

  const triggerManualSync = useCallback(() => triggerSync(true), [triggerSync]);

  const syncSendOnly = useCallback(async (options?: { includeHeldBatches?: boolean }) => {
    if (!isAuthenticated || !currentUser) {
      return { ok: false, count: 0, failedCount: 0, conflictCount: 0, error: tr('المستخدم غير مسجل', 'User is not logged in') };
    }
    if (isSyncingRef.current) {
      return { ok: false, count: 0, failedCount: 0, conflictCount: 0, error: tr('توجد عملية مزامنة قيد التنفيذ حالياً', 'A sync operation is already in progress') };
    }
    setNetworkStatus('synchronizing');
    isSyncingRef.current = true;
    setIsSyncing(true);
    setSendProgressPercent(10);
    setSendProgressStage(tr('جاري تجهيز العمليات للإرسال...', 'Preparing operations to send...'));
    try {
      const outcome = await runSyncCycle({
        userId: currentUser.id,
        forceAll: true,
        mode: 'send_only',
        includeHeldBatches: Boolean(options?.includeHeldBatches),
        onProgress: (p: SyncProgressUpdate) => {
          setSendProgressPercent(p.percent);
          setSendProgressStage(p.stage);
        },
      });
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
      return { ok: false, count: 0, failedCount: 0, conflictCount: 0, error: err?.message ? tr(err.message) : tr('فشل الإرسال', 'Send failed') };
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
      window.setTimeout(() => {
        setSendProgressPercent(0);
        setSendProgressStage('');
      }, 600);
    }
  }, [isAuthenticated, currentUser, refreshQueueAndConflictsFromLocal, refreshSyncStatsFromLocal, handleServerAuthRevoked, resetMandatoryCountdown]);

  const syncReceiveOnly = useCallback(async () => {
    if (!isAuthenticated || !currentUser) {
      return { ok: false, count: 0, error: tr('المستخدم غير مسجل', 'User is not logged in') };
    }
    if (isSyncingRef.current) {
      return { ok: false, count: 0, error: tr('توجد عملية مزامنة قيد التنفيذ حالياً', 'A sync operation is already in progress') };
    }
    setNetworkStatus('synchronizing');
    isSyncingRef.current = true;
    setIsSyncing(true);
    setReceiveProgressPercent(10);
    setReceiveProgressStage(tr('جاري الاتصال لجلب التحديثات...', 'Connecting to fetch updates...'));
    try {
      const outcome = await runSyncCycle({
        userId: currentUser.id,
        forceAll: true,
        mode: 'receive_only',
        onProgress: (p: SyncProgressUpdate) => {
          setReceiveProgressPercent(p.percent);
          setReceiveProgressStage(p.stage);
        },
      });
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
      return { ok: false, count: 0, error: outcome.error ? tr(outcome.error) : tr('تعذر الاستلام حالياً', 'Could not receive updates right now') };
    } catch (err: any) {
      return { ok: false, count: 0, error: err?.message ? tr(err.message) : tr('تعذر الاستلام حالياً', 'Could not receive updates right now') };
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
      window.setTimeout(() => {
        setReceiveProgressPercent(0);
        setReceiveProgressStage('');
      }, 600);
    }
  }, [isAuthenticated, currentUser, refreshQueueAndConflictsFromLocal, refreshSyncStatsFromLocal, handleServerAuthRevoked, applyServerPullPayload]);

  const commitSyncedOpsToLocalSnapshot = useCallback(
    async (userId: string, syncedOpsBefore: SyncQueueItem[]) => {
      if (!userId || syncedOpsBefore.length === 0) return;
      const [snap, nextQueue] = await Promise.all([
        localDb.getSnapshot(userId),
        localDb.listSyncQueue(userId),
      ]);
      if (!snap?.data?.dbState) return;
      const syncedNow = syncedOpsBefore.filter((oldOp) => {
        const current = nextQueue.find((q) => q.operationId === oldOp.operationId);
        return !current || current.status === 'synced';
      });
      if (syncedNow.length === 0) return;
      const updatedBaseline = overlayPendingQueueOnState(
        snap.data.dbState,
        syncedNow.map((op) => ({ ...op, status: 'synced' as const })),
        true
      );
      await localDb.saveSnapshot({
        ...snap,
        cachedAt: new Date().toISOString(),
        data: {
          ...snap.data,
          dbState: updatedBaseline,
        },
      });
      setData(overlayPendingQueueOnState(updatedBaseline, nextQueue));
    },
    []
  );

  const sendSyncOperations = useCallback(
    async (operationIds?: string[]) => {
      if (!isAuthenticated || !currentUser) {
        return {
          ok: false,
          sentCount: 0,
          deduplicatedCount: 0,
          failedCount: 0,
          conflictCount: 0,
          durationMs: 0,
          sentAt: null,
          summary: {},
          syncState: null,
          error: tr('المستخدم غير مسجل', 'User is not logged in'),
        };
      }
      if (isSyncingRef.current) {
        return {
          ok: false,
          sentCount: 0,
          deduplicatedCount: 0,
          failedCount: 0,
          conflictCount: 0,
          durationMs: 0,
          sentAt: null,
          summary: {},
          syncState: serverSyncState,
          error: tr('توجد عملية قيد التنفيذ حالياً', 'An operation is already in progress'),
        };
      }
      setNetworkStatus('synchronizing');
      isSyncingRef.current = true;
      setIsSyncing(true);
      setSendProgressPercent(10);
      setSendProgressStage(tr('جاري تجهيز العمليات للإرسال...', 'Preparing operations to send...'));
      try {
        const preQueue = await localDb.listSyncQueue(currentUser.id);
        const res = await executeManualSendSync({
          userId: currentUser.id,
          operationIds,
          onProgress: (p: SyncProgressUpdate) => {
            setSendProgressPercent(p.percent);
            setSendProgressStage(p.stage);
          },
        });
        if (res.sentCount > 0) {
          await commitSyncedOpsToLocalSnapshot(currentUser.id, preQueue.filter((q) => q.status !== 'synced'));
        }
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        await refreshSyncStatsFromLocal();
        if (res.authRevoked) {
          await handleServerAuthRevoked(res.revokeReason);
          return {
            ok: false,
            sentCount: 0,
            deduplicatedCount: 0,
            failedCount: res.failedCount,
            conflictCount: res.conflictCount,
            durationMs: res.durationMs,
            sentAt: null,
            summary: {},
            syncState: null,
            error: res.revokeReason,
          };
        }
        setIsServerReachable(res.serverReachable);
        if (res.syncState) {
          setServerSyncState({ ...EMPTY_USER_SYNC_STATE, ...res.syncState });
        }
        setNetworkStatus(
          !res.serverReachable ? 'disconnected' : res.ok ? (res.failedCount > 0 || res.conflictCount > 0 ? 'pending' : 'connected') : 'error'
        );
        if (res.error) setLastError(res.error);
        else setLastError(null);

        // Full manual control: Sending NEVER triggers Receive/Pull automatically.
        return {
          ok: res.ok,
          sentCount: res.sentCount,
          deduplicatedCount: res.deduplicatedCount,
          failedCount: res.failedCount,
          conflictCount: res.conflictCount,
          durationMs: res.durationMs,
          sentAt: res.sentAt,
          summary: res.summary,
          syncState: res.syncState,
          error: res.error,
        };
      } catch (err: any) {
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        await refreshSyncStatsFromLocal();
        return {
          ok: false,
          sentCount: 0,
          deduplicatedCount: 0,
          failedCount: 0,
          conflictCount: 0,
          durationMs: 0,
          sentAt: null,
          summary: {},
          syncState: serverSyncState,
          error: err?.message ? tr(err.message) : tr('تعذر الإرسال حالياً', 'Send failed'),
        };
      } finally {
        isSyncingRef.current = false;
        setIsSyncing(false);
        window.setTimeout(() => {
          setSendProgressPercent(0);
          setSendProgressStage('');
        }, 600);
      }
    },
    [
      isAuthenticated,
      currentUser,
      serverSyncState,
      commitSyncedOpsToLocalSnapshot,
      refreshQueueAndConflictsFromLocal,
      refreshSyncStatsFromLocal,
      handleServerAuthRevoked,
    ]
  );

  const previewReceiveUpdates = useCallback(async () => {
    if (!isAuthenticated || !currentUser) {
      return { ok: false, preview: null, durationMs: 0, error: tr('المستخدم غير مسجل', 'User is not logged in') };
    }
    setReceiveProgressPercent(25);
    setReceiveProgressStage(tr('جاري التحقق من التحديثات الواردة...', 'Checking for incoming updates...'));
    try {
      const res = await executeManualReceivePreview({ userId: currentUser.id });
      if (res.authRevoked) {
        await handleServerAuthRevoked(res.revokeReason);
        return { ok: false, preview: null, durationMs: res.durationMs, error: res.revokeReason };
      }
      setIsServerReachable(res.serverReachable);
      if (res.ok && res.preview) {
        if (res.preview.syncState) {
          setServerSyncState({ ...EMPTY_USER_SYNC_STATE, ...res.preview.syncState });
        }
        setReceiveProgressPercent(100);
        setReceiveProgressStage(tr('تم فحص التحديثات', 'Checked updates'));
        return { ok: true, preview: res.preview, durationMs: res.durationMs };
      }
      await refreshSyncStatsFromLocal();
      setNetworkStatus(res.serverReachable ? 'error' : 'disconnected');
      if (res.error) setLastError(res.error);
      return { ok: false, preview: null, durationMs: res.durationMs, error: res.error };
    } catch (err: any) {
      await refreshSyncStatsFromLocal();
      const networkDown = isNetworkFailure(err);
      if (networkDown) setIsServerReachable(false);
      return {
        ok: false,
        preview: null,
        durationMs: 0,
        error: err?.message ? tr(err.message) : tr('تعذر جلب معاينة الاستلام', 'Failed to fetch receive preview'),
      };
    } finally {
      window.setTimeout(() => {
        setReceiveProgressPercent(0);
        setReceiveProgressStage('');
      }, 450);
    }
  }, [isAuthenticated, currentUser, handleServerAuthRevoked, refreshSyncStatsFromLocal]);

  const confirmReceiveUpdates = useCallback(
    async (options?: {
      idempotencyKey?: string;
      confirmCustodyIds?: string[];
      confirmCashTransferIds?: string[];
      confirmBatchIds?: string[];
      previewDurationMs?: number;
    }) => {
      if (!isAuthenticated || !currentUser) {
        return { ok: false, durationMs: 0, response: null, error: tr('المستخدم غير مسجل', 'User is not logged in') };
      }
      if (isSyncingRef.current) {
        return { ok: false, durationMs: 0, response: null, error: tr('توجد عملية قيد التنفيذ حالياً', 'An operation is already in progress') };
      }
      setNetworkStatus('synchronizing');
      isSyncingRef.current = true;
      setIsSyncing(true);
      setReceiveProgressPercent(15);
      setReceiveProgressStage(tr('جاري تأكيد الاستلام...', 'Confirming receipt...'));
      try {
        const res = await executeManualReceiveConfirm({
          userId: currentUser.id,
          idempotencyKey: options?.idempotencyKey,
          confirmCustodyIds: options?.confirmCustodyIds,
          confirmCashTransferIds: options?.confirmCashTransferIds,
          confirmBatchIds: options?.confirmBatchIds,
          previewDurationMs: options?.previewDurationMs,
          onProgress: (p: SyncProgressUpdate) => {
            setReceiveProgressPercent(p.percent);
            setReceiveProgressStage(p.stage);
          },
        });
        if (res.authRevoked) {
          await handleServerAuthRevoked(res.revokeReason);
          return { ok: false, durationMs: res.durationMs, response: null, error: res.revokeReason };
        }
        setIsServerReachable(res.serverReachable);
        if (res.response?.syncState) {
          setServerSyncState({ ...EMPTY_USER_SYNC_STATE, ...res.response.syncState });
        }
        if (res.response?.bootstrap) {
          await applyServerPullPayload(res.response.bootstrap, currentUser);
        }
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        await refreshSyncStatsFromLocal();
        setNetworkStatus(res.serverReachable ? (res.ok ? 'connected' : 'error') : 'disconnected');
        if (res.error) setLastError(res.error);
        else setLastError(null);
        return { ok: res.ok, durationMs: res.durationMs, response: res.response, error: res.error };
      } catch (err: any) {
        await refreshSyncStatsFromLocal();
        return {
          ok: false,
          durationMs: 0,
          response: null,
          error: err?.message ? tr(err.message) : tr('تعذر تأكيد الاستلام', 'Failed to confirm receive'),
        };
      } finally {
        isSyncingRef.current = false;
        setIsSyncing(false);
        window.setTimeout(() => {
          setReceiveProgressPercent(0);
          setReceiveProgressStage('');
        }, 600);
      }
    },
    [
      isAuthenticated,
      currentUser,
      applyServerPullPayload,
      refreshQueueAndConflictsFromLocal,
      refreshSyncStatsFromLocal,
      handleServerAuthRevoked,
    ]
  );

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
      try {
        localStorage.setItem(seenKey, JSON.stringify(list.map((n) => n.id)));
      } catch {
        // ignore storage errors
      }
    } catch {
      // ignore offline notification errors
    }
  }, [isAuthenticated, currentUser]);

  const markNotificationsRead = useCallback(() => {
    if (!currentUser) return;
    const allIds = mobileNotifications.map((n) => n.id);
    setReadNotificationIds(allIds);
    try {
      localStorage.setItem(`awlad_selim_read_notifs_${currentUser.id}`, JSON.stringify(allIds));
    } catch {
      // ignore storage errors
    }
  }, [currentUser, mobileNotifications]);

  const unreadNotificationCount = mobileNotifications.filter(
    (n) => !readNotificationIds.includes(n.id)
  ).length;

  // Full Manual Control: only track network reachability indicator changes;
  // NEVER auto-send, auto-receive, auto-sync on reconnect/foreground, or run periodic/countdown timers.
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    const unsubscribeNet = subscribeNetworkStatus((connected) => {
      setIsServerReachable(connected);
      if (!connected) {
        setNetworkStatus('disconnected');
      } else {
        setNetworkStatus((prev) => (prev === 'disconnected' ? 'connected' : prev));
      }
    });
    return () => {
      unsubscribeNet();
    };
  }, [isAuthenticated, currentUser?.id]);

  const triggerMandatorySendNow = useCallback(async () => {
    return {
      ok: false,
      count: 0,
      failedCount: 0,
      error: tr('الإرسال التلقائي ملغى — يتم الإرسال يدوياً فقط من شاشة الإرسال والاستلام', 'Auto-send is disabled — use manual Send in Send & Receive'),
    };
  }, []);

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

  const getCustomerStatement = useCallback(
    async (customerId: string): Promise<CustomerStatementResponse | null> => {
      if (!customerId) return null;
      try {
        const res = await apiRequest<{ ok: boolean; statement: CustomerStatementResponse }>(
          `/api/customers/${customerId}/statement`
        );
        if (res?.statement) return res.statement;
      } catch {
        // fallback cleanly to local offline computation below
      }
      const cust = data.customers.find((c) => c.id === customerId);
      if (!cust) return null;
      const custInvoices = (data.invoices || [])
        .filter((i) => i.customerId === customerId && i.type === 'sales' && i.status === 'confirmed')
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      const custReturns = (data.invoiceReturns || [])
        .filter((r) => r.partyId === customerId && r.type === 'sales_return');
      const custPayments = (data.financialTransactions || [])
        .filter((tx) => (tx.partyId === customerId || (tx as any).relatedEntityId === customerId) && tx.type === 'customer_payment');
      const confirmedIds = new Set(custInvoices.map((i) => i.id));
      const rawEntries: Array<any> = [];
      const openBal = Number(cust.openingBalance || 0);
      if (openBal !== 0) {
        rawEntries.push({
          id: `OPEN-${cust.id}`,
          docId: cust.id,
          docType: 'opening_balance',
          date: (cust.createdAt || '').split('T')[0] || '-',
          sortKey: `0000-${cust.createdAt || ''}`,
          docNumber: cust.code || '-',
          type: 'opening_balance',
          label: tr('رصيد افتتاحي', 'Opening Balance'),
          description: tr('الرصيد الافتتاحي للحساب', 'Account Opening Balance'),
          debit: openBal > 0 ? openBal : 0,
          credit: openBal < 0 ? Math.abs(openBal) : 0,
          paidAmount: 0,
          remainingAmount: 0,
        });
      }
      for (const inv of custInvoices) {
        const cashAtInv = Math.max(0, Number(inv.paidAmount || 0) - Number(inv.appliedAdvanceAmount || 0));
        rawEntries.push({
          id: `INV-${inv.id}`,
          docId: inv.id,
          docType: 'sales',
          date: inv.date || '',
          sortKey: `${inv.date || ''}-${inv.createdAt || inv.id}`,
          docNumber: inv.invoiceNumber,
          type: 'sales_invoice',
          label: tr(`فاتورة مبيعات (${inv.items?.length || 0} صنف)`, `Sales Invoice (${inv.items?.length || 0} items)`),
          description: tr(`إجمالي الفاتورة ${inv.grandTotal}`, `Invoice Total ${inv.grandTotal}`),
          debit: Number(inv.grandTotal || 0),
          credit: cashAtInv,
          paidAmount: Number(inv.paidAmount || 0),
          remainingAmount: Number(inv.remainingAmount || 0),
        });
      }
      for (const tx of custPayments) {
        if (tx.relatedDocType === 'sales' && tx.relatedDocId && confirmedIds.has(tx.relatedDocId)) continue;
        rawEntries.push({
          id: `PAY-${tx.id}`,
          docId: tx.id,
          docType: tx.relatedDocType === 'order_advance' ? 'order_advance' : 'customer_payment',
          date: tx.date || '',
          sortKey: `${tx.date || ''}-${tx.createdAt || tx.id}`,
          docNumber: tx.transactionNumber || tx.id,
          type: tx.relatedDocType === 'order_advance' ? 'order_advance' : 'customer_payment',
          label: tr('سند تحصيل / دفعة حساب', 'Collection / Payment Voucher'),
          description: tx.description ? tr(tx.description) : tr('سداد نقدي من العميل', 'Cash Payment from Customer'),
          debit: 0,
          credit: Number(tx.amount || 0),
          paidAmount: Number(tx.amount || 0),
          remainingAmount: 0,
        });
      }
      for (const ret of custReturns) {
        rawEntries.push({
          id: `RET-${ret.id}`,
          docId: ret.id,
          docType: 'sales_return',
          date: ret.date || '',
          sortKey: `${ret.date || ''}-${ret.createdAt || ret.id}`,
          docNumber: ret.returnNumber,
          type: 'sales_return',
          label: tr('مرتجع مبيعات', 'Sales Return'),
          description: ret.reason || tr(`مرتجع على فاتورة ${ret.originalInvoiceNumber || '-'}`, `Return on Invoice ${ret.originalInvoiceNumber || '-'}`),
          debit: 0,
          credit: ret.refundType === 'balance' ? Number(ret.grandTotal || 0) : 0,
          paidAmount: ret.refundType === 'cash' ? Number(ret.grandTotal || 0) : 0,
          remainingAmount: 0,
        });
      }
      rawEntries.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
      let run = 0;
      let totalDebit = 0;
      let totalCredit = 0;
      const entries = rawEntries.map(({ sortKey: _s, ...entry }) => {
        totalDebit += Number(entry.debit || 0);
        totalCredit += Number(entry.credit || 0);
        run += Number(entry.debit || 0) - Number(entry.credit || 0);
        return { ...entry, runningBalance: Number(run.toFixed(2)) };
      });
      const totalSales = custInvoices.reduce((s, i) => s + Number(i.grandTotal || 0), 0);
      const totalPaid =
        custInvoices.reduce((s, i) => s + Math.max(0, Number(i.paidAmount || 0) - Number(i.appliedAdvanceAmount || 0)), 0) +
        custPayments
          .filter((tx) => !(tx.relatedDocType === 'sales' && tx.relatedDocId && confirmedIds.has(tx.relatedDocId)))
          .reduce((s, tx) => s + Number(tx.amount || 0), 0);
      const curBal = Number(cust.currentBalance || 0);
      const lastInv = [...custInvoices].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const lastPay = [...custPayments].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      return {
        customer: cust,
        allowPriceView: true,
        invoices: custInvoices,
        returns: custReturns,
        summary: {
          openingBalance: openBal,
          totalDebit: Number(totalDebit.toFixed(2)),
          totalCredit: Number(totalCredit.toFixed(2)),
          totalSales: Number(totalSales.toFixed(2)),
          totalPaid: Number(totalPaid.toFixed(2)),
          currentBalance: curBal,
          debtAmount: curBal > 0 ? curBal : 0,
          creditAmount: curBal < 0 ? Math.abs(curBal) : 0,
          balanceDirection: curBal > 0.005 ? 'debt' : curBal < -0.005 ? 'credit' : 'settled',
          invoicesCount: custInvoices.length,
          returnsCount: custReturns.length,
          lastInvoiceDate: lastInv?.date || null,
          lastInvoiceNumber: lastInv?.invoiceNumber || null,
          lastPaymentDate: lastPay?.date || null,
          lastTransactionDate: entries[entries.length - 1]?.date || null,
        },
        entries,
      };
    },
    [data.customers, data.invoices, data.invoiceReturns, data.financialTransactions]
  );

  const getRepresentativeStatement = useCallback(
    async (repId: string): Promise<RepresentativeAccountStatement | null> => {
      if (!repId) return null;
      try {
        const res = await fetchRepresentativeStatementApi(repId);
        if (res?.statement) return res.statement;
      } catch {
        // fallback cleanly to local offline computation below
      }
      const repItem = (data.representatives || []).find((r) => r.id === repId);
      if (!repItem) return null;
      const isRepViewer = currentUser?.role === 'representative';
      const currentBalance = Number(repItem.currentBalance || 0);
      const openingBalance = Number(repItem.openingBalance || 0);
      const owedByRep = currentBalance > 0.009 ? Number(currentBalance.toFixed(2)) : 0;
      const owedToRep = currentBalance < -0.009 ? Number(Math.abs(currentBalance).toFixed(2)) : 0;
      const direction: 'debt' | 'credit' | 'settled' =
        currentBalance > 0.009 ? 'debt' : currentBalance < -0.009 ? 'credit' : 'settled';
      const statusLabel: 'عليه' | 'له' | 'متعادل' =
        direction === 'debt' ? 'عليه' : direction === 'credit' ? 'له' : 'متعادل';

      const movements = (data.repTransfers || [])
        .filter((rt: any) => rt.representativeId === repId || rt.senderId === repId || rt.receiverId === repId)
        .sort((a, b) => String(b.timestamp || b.date || '').localeCompare(String(a.timestamp || a.date || '')))
        .map((rt) => ({
          id: rt.id,
          transferNumber: rt.transferNumber,
          date: rt.date,
          timestamp: rt.timestamp,
          direction: rt.direction,
          senderId: rt.senderId,
          senderName: rt.senderName,
          receiverId: rt.receiverId,
          receiverName: rt.receiverName,
          amount: Number(rt.amount || 0),
          ...(isRepViewer ? {} : { cashboxId: rt.cashboxId || '', cashboxName: rt.cashboxName || '' }),
          notes: rt.notes || '',
          status: rt.status,
          sentAt: rt.sentAt || rt.timestamp,
          confirmedAt: rt.confirmedAt,
          confirmedBy: rt.confirmedBy,
        }));

      const receivedToCompanyTotal = Number(
        movements
          .filter((m) => m.status === 'received' && m.senderId === repId)
          .reduce((s, m) => s + Number(m.amount || 0), 0)
          .toFixed(2)
      );
      const issuedToRepTotal = Number(
        movements
          .filter((m) => m.status === 'received' && m.receiverId === repId)
          .reduce((s, m) => s + Number(m.amount || 0), 0)
          .toFixed(2)
      );

      return {
        representative: isRepViewer
          ? {
              ...repItem,
              commissionRate: undefined,
              notes: undefined,
            }
          : repItem,
        balanceSummary: {
          openingBalance,
          currentBalance,
          owedByRep,
          owedToRep,
          direction,
          statusLabel,
          issuedToRepTotal,
          receivedToCompanyTotal,
          pendingTransfersCount: movements.filter((m) => m.status === 'awaiting_receipt').length,
        },
        movements,
      };
    },
    [data.representatives, data.repTransfers, currentUser?.role]
  );

  const getSupplierStatement = useCallback(
    async (supplierId: string): Promise<SupplierStatementResponse | null> => {
      if (!supplierId) return null;
      try {
        const res = await apiRequest<{ ok: boolean; statement: SupplierStatementResponse }>(
          `/api/admin/suppliers/${supplierId}/statement`
        );
        if (res?.statement) return res.statement;
      } catch {
        // fallback cleanly to local offline computation below
      }
      const supp = data.suppliers.find((s) => s.id === supplierId);
      if (!supp) return null;
      const suppInvoices = (data.invoices || [])
        .filter((i) => i.supplierId === supplierId && i.type === 'purchase' && i.status === 'confirmed')
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      const suppReturns = (data.invoiceReturns || [])
        .filter((r) => r.partyId === supplierId && r.type === 'purchase_return');
      const suppPayments = (data.financialTransactions || [])
        .filter((tx) => (tx.partyId === supplierId || (tx as any).relatedEntityId === supplierId) && tx.type === 'supplier_payment');
      const confirmedIds = new Set(suppInvoices.map((i) => i.id));
      const rawEntries: Array<any> = [];
      const openBal = Number(supp.openingBalance || 0);
      if (openBal !== 0) {
        rawEntries.push({
          id: `OPEN-${supp.id}`,
          docId: supp.id,
          docType: 'opening_balance',
          date: (supp.createdAt || '').split('T')[0] || '-',
          sortKey: `0000-${supp.createdAt || ''}`,
          docNumber: supp.code || '-',
          type: 'opening_balance',
          label: tr('رصيد افتتاحي للمورد', 'Supplier Opening Balance'),
          description: openBal > 0
            ? tr('رصيد افتتاحي مستحق للمورد (علينا)', 'Opening Balance Payable to Supplier')
            : tr('رصيد افتتاحي مقدم عند المورد (لنا)', 'Opening Advance Credit at Supplier'),
          credit: openBal > 0 ? openBal : 0,
          debit: openBal < 0 ? Math.abs(openBal) : 0,
          paidAmount: 0,
          remainingAmount: 0,
        });
      }
      for (const inv of suppInvoices) {
        const nonSettlePaid = Array.isArray(inv.payments) && inv.payments.length > 0
          ? inv.payments.filter((p: any) => p.paymentMethod !== 'advance_settlement').reduce((s, p) => s + Number(p.amount || 0), 0)
          : Number(inv.paidAtInvoice ?? inv.paidAmount ?? 0);
        rawEntries.push({
          id: `PINV-${inv.id}`,
          docId: inv.id,
          docType: 'purchase',
          date: inv.date || '',
          sortKey: `${inv.date || ''}-${inv.createdAt || inv.id}`,
          docNumber: inv.invoiceNumber,
          type: 'purchase_invoice',
          label: tr(`فاتورة مشتريات (${inv.items?.length || 0} صنف)`, `Purchase Invoice (${inv.items?.length || 0} items)`),
          description: tr(`إجمالي المشتريات ${inv.grandTotal}`, `Total Purchases ${inv.grandTotal}`),
          credit: Number(inv.grandTotal || 0),
          debit: nonSettlePaid,
          paidAmount: Number(inv.paidAmount || 0),
          remainingAmount: Number(inv.remainingAmount || 0),
        });
      }
      for (const tx of suppPayments) {
        if (tx.relatedDocType === 'purchase' && tx.relatedDocId && confirmedIds.has(tx.relatedDocId)) continue;
        rawEntries.push({
          id: `SPAY-${tx.id}`,
          docId: tx.id,
          docType: 'supplier_payment',
          date: tx.date || '',
          sortKey: `${tx.date || ''}-${tx.createdAt || tx.id}`,
          docNumber: tx.transactionNumber || tx.id,
          type: 'supplier_payment',
          label: tr('سند صرف / سداد للمورد', 'Supplier Payment Voucher'),
          description: tx.description ? tr(tx.description) : tr('دفعة مسددة للمورد', 'Payment Made to Supplier'),
          credit: 0,
          debit: Number(tx.amount || 0),
          paidAmount: Number(tx.amount || 0),
          remainingAmount: 0,
        });
      }
      for (const ret of suppReturns) {
        rawEntries.push({
          id: `PRET-${ret.id}`,
          docId: ret.id,
          docType: 'purchase_return',
          date: ret.date || '',
          sortKey: `${ret.date || ''}-${ret.createdAt || ret.id}`,
          docNumber: ret.returnNumber,
          type: 'purchase_return',
          label: tr('مرتجع مشتريات', 'Purchase Return'),
          description: ret.reason || tr(`مرتجع على فاتورة ${ret.originalInvoiceNumber || '-'}`, `Return on Invoice ${ret.originalInvoiceNumber || '-'}`),
          credit: 0,
          debit: ret.refundType === 'balance' ? Number(ret.grandTotal || 0) : 0,
          paidAmount: ret.refundType === 'cash' ? Number(ret.grandTotal || 0) : 0,
          remainingAmount: 0,
        });
      }
      rawEntries.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
      let run = 0;
      let totalCredit = 0;
      let totalDebit = 0;
      const entries = rawEntries.map(({ sortKey: _s, ...entry }) => {
        totalCredit += Number(entry.credit || 0);
        totalDebit += Number(entry.debit || 0);
        run += Number(entry.credit || 0) - Number(entry.debit || 0);
        return { ...entry, runningBalance: Number(run.toFixed(2)) };
      });
      const totalPurchases = suppInvoices.reduce((s, i) => s + Number(i.grandTotal || 0), 0);
      const totalPaid =
        suppInvoices.reduce((s, i) => {
          const cashPart = Array.isArray(i.payments) && i.payments.length > 0
            ? i.payments.filter((p: any) => p.paymentMethod !== 'advance_settlement').reduce((ps, p) => ps + Number(p.amount || 0), 0)
            : Number(i.paidAtInvoice ?? i.paidAmount ?? 0);
          return s + cashPart;
        }, 0) +
        suppPayments
          .filter((tx) => !(tx.relatedDocType === 'purchase' && tx.relatedDocId && confirmedIds.has(tx.relatedDocId)))
          .reduce((s, tx) => s + Number(tx.amount || 0), 0);
      const curBal = Number(supp.currentBalance || 0);
      const lastInv = [...suppInvoices].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      return {
        supplier: supp,
        invoices: suppInvoices,
        returns: suppReturns,
        summary: {
          openingBalance: openBal,
          totalPurchases: Number(totalPurchases.toFixed(2)),
          totalCredit: Number(totalCredit.toFixed(2)),
          totalDebit: Number(totalDebit.toFixed(2)),
          totalPaid: Number(totalPaid.toFixed(2)),
          currentBalance: curBal,
          payableAmount: curBal > 0 ? curBal : 0,
          advanceCreditAmount: curBal < 0 ? Math.abs(curBal) : 0,
          balanceDirection: curBal > 0.005 ? 'payable' : curBal < -0.005 ? 'advance' : 'settled',
          invoicesCount: suppInvoices.length,
          returnsCount: suppReturns.length,
          lastInvoiceDate: lastInv?.date || null,
          lastInvoiceNumber: lastInv?.invoiceNumber || null,
          lastTransactionDate: entries[entries.length - 1]?.date || null,
        },
        entries,
      };
    },
    [data.suppliers, data.invoices, data.invoiceReturns, data.financialTransactions]
  );

  const getCustomerPriceHistory = useCallback(
    async (customerId: string, productId?: string): Promise<Record<string, CustomerPriceHistoryEntry[]>> => {
      if (!customerId) return {};
      try {
        const qs = productId ? `?productId=${encodeURIComponent(productId)}` : '';
        const res = await apiRequest<{ ok: boolean; priceHistory: Record<string, CustomerPriceHistoryEntry[]> }>(
          `/api/customers/${customerId}/price-history${qs}`
        );
        return res.priceHistory || {};
      } catch {
        const cust = data.customers.find((c) => c.id === customerId);
        if (!cust?.priceHistory) return {};
        const fallback: Record<string, CustomerPriceHistoryEntry[]> = {};
        for (const [pid, arr] of Object.entries(cust.priceHistory)) {
          if (productId && pid !== productId) continue;
          fallback[pid] = (Array.isArray(arr) ? arr : []).map((entry) =>
            typeof entry === 'number' ? { price: entry, date: '' } : entry
          );
        }
        return fallback;
      }
    },
    [data.customers]
  );

  const getSupplierPriceHistory = useCallback(
    async (supplierId: string, productId?: string): Promise<Record<string, SupplierPriceHistoryEntry[]>> => {
      if (!supplierId) return {};
      try {
        const res = await fetchSupplierPriceHistoryApi(supplierId, productId);
        return res.priceHistory || (res as any).history || {};
      } catch {
        // Fallback strictly from local confirmed purchase invoices, newest first
        const map: Record<string, SupplierPriceHistoryEntry[]> = {};
        const confirmed = (data.invoices || [])
          .filter((inv) => inv.type === 'purchase' && inv.status === 'confirmed' && inv.supplierId === supplierId)
          .slice()
          .sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());
        for (const inv of confirmed) {
          for (const it of inv.items || []) {
            if (productId && it.productId !== productId) continue;
            if (!map[it.productId]) map[it.productId] = [];
            if (map[it.productId].length >= 3) continue;
            map[it.productId].push({
              price: Number(it.unitPrice || 0),
              unit: it.unit || '',
              unitFactor: Number(it.unitFactor || 1),
              date: inv.date || String(inv.createdAt || '').slice(0, 10),
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
            });
          }
        }
        return map;
      }
    },
    [data.invoices]
  );

  const getSendReceiveActivityLog = useCallback(
    async (params?: { dateFrom?: string; dateTo?: string; repId?: string; operationType?: string; status?: string; docNumber?: string }): Promise<SendReceiveActivityLogResponse | null> => {
      try {
        return await fetchSendReceiveActivityLogApi(params);
      } catch {
        return null;
      }
    },
    []
  );

  const getSyncSourceDocument = useCallback(async (docType: string, docId: string) => {
    try {
      return await fetchSyncSourceDocumentApi(docType, docId);
    } catch {
      return null;
    }
  }, []);

  // Offline Queue Helper
  const REP_BATCH_HOLD_OPS = new Set<SyncQueueItem['operationType']>([
    'create_order',
    'create_sales_invoice',
    'create_sales_quote',
    'edit_sales_invoice',
    'create_purchase_invoice',
    'send_purchase_invoice',
    'edit_purchase_invoice',
    'create_invoice_return',
    'create_purchase_return_request',
    'create_sales_return_request',
    'add_invoice_payment',
    'record_customer_payment',
    'record_order_advance',
    'create_customer',
    'update_customer',
    'update_supplier',
    'update_product',
    'record_damaged_stock',
    'transfer_stock',
    'create_rep_transfer',
    'confirm_rep_transfer',
    'create_rep_item_transfer',
    'confirm_custody_receipt',
    'record_custody_delivery',
    'record_custody_return',
  ]);

  const queueOfflineOp = useCallback(
    async (params: {
      operationType: SyncQueueItem['operationType'];
      entityType: string;
      entityId?: string;
      localId?: string;
      summaryAr: string;
      payload: Record<string, any>;
    }) => {
      if (!currentUser) throw new Error(tr('المستخدم غير مسجل', 'User is not logged in'));
      const holdForDispatchBatch =
        currentUser.role === 'representative' && REP_BATCH_HOLD_OPS.has(params.operationType);
      const queued = await enqueueSyncOperation({
        userId: currentUser.id,
        ...params,
        holdForDispatchBatch,
        dispatchStage: holdForDispatchBatch ? 'محفوظة محليًا' : undefined,
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

  const refreshDispatches = useCallback(async () => {
    if (!isAuthenticated || !currentUser || currentUser.role === 'customer') return;
    try {
      const [batchesRes, recipRes] = await Promise.all([
        apiRequest<{ ok: boolean; batches: SyncDispatchBatch[] }>('/api/sync/dispatches'),
        apiRequest<{ ok: boolean; recipients: DispatchRecipientOption[] }>('/api/sync/dispatches/recipients').catch(() => ({
          ok: true,
          recipients: dispatchRecipients,
        })),
      ]);
      const serverBatches = Array.isArray(batchesRes?.batches) ? batchesRes.batches : [];
      const localBatches = await localDb.listDispatchBatches(currentUser.id);
      const merged = [...serverBatches];
      for (const lb of localBatches) {
        if (
          !merged.some((sb) => sb.id === lb.id || (lb.clientBatchUuid && sb.clientBatchUuid === lb.clientBatchUuid)) &&
          (lb.isLocalOnly ||
            lb.isConfirmedSendQueued ||
            lb.sendStatus === 'فشل الإرسال' ||
            lb.sendStatus === 'جاهزة للإرسال' ||
            lb.sendStatus === 'جاري الإرسال')
        ) {
          merged.unshift(lb);
        }
      }
      await localDb.saveDispatchBatches(currentUser.id, merged);
      setSyncDispatchBatches(merged);
      if (Array.isArray(recipRes?.recipients)) {
        setDispatchRecipients(recipRes.recipients);
      }
    } catch {
      // ignore if offline; keep local cached batches
    }
  }, [isAuthenticated, currentUser, dispatchRecipients]);

  const createAndSendDispatchBatch = useCallback(
    async (params: {
      selectedOperations: SyncQueueItem[];
      recipientUserId: string;
      notes?: string;
      existingDraftBatch?: SyncDispatchBatch;
    }) => {
      if (!currentUser) return { success: false, error: tr('المستخدم غير مسجل', 'User is not logged in') };
      const recipient =
        dispatchRecipients.find((r) => r.id === params.recipientUserId) ||
        (params.existingDraftBatch
          ? {
              id: params.existingDraftBatch.recipientUserId,
              fullName: params.existingDraftBatch.recipientName,
              role: params.existingDraftBatch.recipientRole || 'admin',
            }
          : undefined);
      if (!recipient) {
        return { success: false, error: tr('يرجى اختيار الموظف المستلم من القائمة', 'Please select the receiving employee from the list') };
      }
      if (!Array.isArray(params.selectedOperations) || params.selectedOperations.length === 0) {
        return { success: false, error: tr('يرجى تحديد عملية واحدة على الأقل لإرسالها', 'Please select at least one operation to send') };
      }
      const repProfile = (data.representatives || []).find((r) => r.userId === currentUser.id);
      isSyncingRef.current = true;
      setIsSyncing(true);
      setNetworkStatus('synchronizing');
      setSendProgressPercent(10);
      setSendProgressStage(tr('جاري تجهيز الدفعة الرسمية للإرسال...', 'Preparing official batch to send...'));
      try {
        const res = await sendDispatchBatchToServer({
          userId: currentUser.id,
          senderName: currentUser.fullName || currentUser.username,
          representativeId: repProfile?.id,
          representativeName: repProfile?.name,
          selectedOperations: params.selectedOperations,
          recipient,
          notes: params.notes,
          existingDraftBatch: params.existingDraftBatch,
          onProgress: (p: SyncProgressUpdate) => {
            setSendProgressPercent(p.percent);
            setSendProgressStage(p.stage);
          },
        });
        await refreshQueueAndConflictsFromLocal(currentUser.id);
        await refreshSyncStatsFromLocal();
        const updatedBatches = await localDb.listDispatchBatches(currentUser.id);
        setSyncDispatchBatches(updatedBatches);
        if (res.authRevoked) {
          await handleServerAuthRevoked(res.error);
          return { success: false, batch: res.batch, error: res.error };
        }
        if (res.ok) {
          await commitSyncedOpsToLocalSnapshot(currentUser.id, params.selectedOperations);
          await refreshQueueAndConflictsFromLocal(currentUser.id);
          await refreshSyncStatsFromLocal();
          return { success: true, batch: res.batch };
        }
        setNetworkStatus(res.queuedOfflineConfirmed ? 'disconnected' : 'pending');
        return {
          success: false,
          queuedOfflineConfirmed: Boolean(res.queuedOfflineConfirmed),
          batch: res.batch,
          error: res.error,
        };
      } finally {
        isSyncingRef.current = false;
        setIsSyncing(false);
        window.setTimeout(() => {
          setSendProgressPercent(0);
          setSendProgressStage('');
        }, 600);
      }
    },
    [currentUser, dispatchRecipients, data.representatives, commitSyncedOpsToLocalSnapshot, refreshQueueAndConflictsFromLocal, refreshSyncStatsFromLocal, handleServerAuthRevoked]
  );

  const retryDispatchBatch = useCallback(
    async (batch: SyncDispatchBatch) => {
      const ops = Array.isArray(batch.operationsSnapshot) && batch.operationsSnapshot.length > 0
        ? batch.operationsSnapshot
        : syncQueue.filter((q) => batch.operationIds.includes(q.operationId));
      return createAndSendDispatchBatch({
        selectedOperations: ops,
        recipientUserId: batch.recipientUserId,
        notes: batch.notes,
        existingDraftBatch: batch,
      });
    },
    [createAndSendDispatchBatch, syncQueue]
  );

  const markDispatchReceiving = useCallback(
    async (batchId: string) => {
      try {
        const res = await apiRequest<{ ok: boolean; batch: SyncDispatchBatch }>(
          `/api/sync/dispatches/${batchId}/mark-receiving`,
          { method: 'POST' }
        );
        await refreshDispatches();
        return { success: true, batch: res.batch };
      } catch (err: any) {
        return { success: false, error: err?.message || tr('تعذر تحديث حالة قيد الاستلام', 'Could not update receiving status') };
      }
    },
    [refreshDispatches]
  );

  const confirmDispatchReceipt = useCallback(
    async (
      batchId: string,
      receiptNotesOrOptions:
        | string
        | {
            receiptNotes?: string;
            hasDiscrepancy?: boolean;
            discrepancyNote?: string;
          } = ''
    ) => {
      try {
        const opts =
          typeof receiptNotesOrOptions === 'string'
            ? { receiptNotes: receiptNotesOrOptions }
            : receiptNotesOrOptions || {};
        const res = await apiRequest<{ ok: boolean; batch: SyncDispatchBatch }>(
          `/api/sync/dispatches/${batchId}/confirm-receipt`,
          {
            method: 'POST',
            body: {
              receiptNotes: opts.receiptNotes || '',
              hasDiscrepancy: Boolean(opts.hasDiscrepancy),
              discrepancyNote: opts.discrepancyNote || '',
              deviceId: getOrCreatePersistentDeviceId(),
            },
            idempotencyKey: generateId('CONF-DSP'),
          }
        );
        await refreshDispatches();
        await loadRoleScopedData();
        return { success: true, batch: res.batch };
      } catch (err: any) {
        return { success: false, error: err?.message || tr('تعذر تأكيد استلام الدفعة', 'Could not confirm batch receipt') };
      }
    },
    [refreshDispatches, loadRoleScopedData]
  );

  const failDispatchReceipt = useCallback(
    async (batchId: string, reason: string) => {
      try {
        const res = await apiRequest<{ ok: boolean; batch: SyncDispatchBatch }>(
          `/api/sync/dispatches/${batchId}/fail-receipt`,
          {
            method: 'POST',
            body: {
              reason,
              deviceId: getOrCreatePersistentDeviceId(),
            },
          }
        );
        await refreshDispatches();
        return { success: true, batch: res.batch };
      } catch (err: any) {
        return { success: false, error: err?.message || tr('تعذر تسجيل تعذر الاستلام', 'Could not record receipt failure') };
      }
    },
    [refreshDispatches]
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
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || tr('تعذر معالجة تعارض المزامنة', 'Could not resolve sync conflict') };
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
      return { success: false, error: err?.message || tr('ملف النسخة الاحتياطية غير صالح أو فشل الاستعادة', 'Invalid backup file or restore failed') };
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
    try {
      await apiRequest(`/api/products/${id}`, { method: 'PUT', body: updates });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const existing = data.products.find((pr) => pr.id === id);
        await queueOfflineOp({
          operationType: 'update_product',
          entityType: 'product',
          entityId: id,
          summaryAr: `تحديث بيانات الصنف محليًا: ${updates.name || existing?.name || id}`,
          payload: { productId: id, ...updates },
        });
        return { success: true, queuedOffline: true };
      }
      throw err;
    }
  };

  const deleteProduct = async (id: string) => {
    try {
      await apiRequest(`/api/products/${id}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حذف الصنف', 'Could not delete item') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حذف الأصناف المستوردة', 'Could not delete imported items') };
    }
  };

  const toggleProductStatus = async (id: string) => {
    const prod = data.products.find((p) => p.id === id);
    if (!prod) return { success: false, error: tr('الصنف غير موجود', 'Item not found') };
    try {
      await updateProduct(id, { status: prod.status === 'active' ? 'archived' : 'active' });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : undefined };
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
      if (isNetworkFailure(err) && currentUser) {
        const prod = data.products.find((pr) => pr.id === productId);
        await queueOfflineOp({
          operationType: 'transfer_stock',
          entityType: 'stock_transfer',
          entityId: productId,
          summaryAr: `تحويل مخزني محلي (${prod?.name || productId})`,
          payload: { productId, fromWarehouseId, toWarehouseId, quantity, notes },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر التحويل المخزني', 'Stock transfer failed') };
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
    try {
      await apiRequest('/api/inventory/damaged', {
        method: 'POST',
        body: { productId, warehouseId, quantity, reason },
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const prod = data.products.find((pr) => pr.id === productId);
        await queueOfflineOp({
          operationType: 'record_damaged_stock',
          entityType: 'damaged_stock',
          entityId: productId,
          summaryAr: `تسجيل تالف مخزني محلي (${prod?.name || productId})`,
          payload: { productId, warehouseId, quantity, reason },
        });
        return { success: true, queuedOffline: true };
      }
      throw err;
    }
  };

  const addProductGroup = async (name: string, description = '') => {
    try {
      const res = await apiRequest<{ ok: boolean; productGroup: ProductGroup }>('/api/products/groups', {
        method: 'POST',
        body: { name, description },
      });
      await loadRoleScopedData();
      return { success: true, productGroup: res.productGroup };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إضافة المجموعة', 'Could not add group') };
    }
  };

  const updateProductGroup = async (id: string, updates: Partial<ProductGroup>) => {
    try {
      const res = await apiRequest<{ ok: boolean; productGroup: ProductGroup }>(`/api/products/groups/${id}`, {
        method: 'PUT',
        body: updates,
      });
      await loadRoleScopedData();
      return { success: true, productGroup: res.productGroup };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث المجموعة', 'Could not update group') };
    }
  };

  const deleteProductGroup = async (id: string) => {
    try {
      await apiRequest(`/api/products/groups/${id}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حذف المجموعة', 'Could not delete group') };
    }
  };

  const toggleProductGroupStatus = async (id: string) => {
    const grp = (data.productGroups || []).find((g) => g.id === id);
    if (!grp) return { success: false, error: tr('المجموعة غير موجودة', 'Group not found') };
    return updateProductGroup(id, { status: grp.status === 'active' ? 'suspended' : 'active' });
  };

  const addCategory = async (name: string, description = '', groupId = '') => {
    try {
      const res = await apiRequest<{ ok: boolean; category: ProductCategory }>('/api/products/categories', {
        method: 'POST',
        body: { name, description, ...(groupId ? { groupId } : {}) },
      });
      await loadRoleScopedData();
      return { success: true, category: res.category };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إضافة التصنيف', 'Could not add category') };
    }
  };

  const updateCategory = async (id: string, updates: Partial<ProductCategory>) => {
    await apiRequest(`/api/products/categories/${id}`, { method: 'PUT', body: updates });
    await loadRoleScopedData();
  };

  const deleteCategory = async (id: string) => {
    try {
      await apiRequest(`/api/products/categories/${id}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حذف التصنيف', 'Could not delete category') };
    }
  };

  const toggleCategoryStatus = async (id: string) => {
    const cat = (data.categories || []).find((c) => c.id === id);
    if (!cat) return;
    await updateCategory(id, { status: cat.status === 'active' ? 'suspended' : 'active' });
  };

  const addProductUnit = async (name: string, shortCode = '', notes = '') => {
    try {
      const res = await apiRequest<{ ok: boolean; productUnit: UnitCatalogItem }>('/api/products/units', {
        method: 'POST',
        body: { name, shortCode, notes },
      });
      await loadRoleScopedData();
      return { success: true, productUnit: res.productUnit };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إضافة الوحدة', 'Could not add unit') };
    }
  };

  const updateProductUnit = async (id: string, updates: Partial<UnitCatalogItem>) => {
    try {
      const res = await apiRequest<{ ok: boolean; productUnit: UnitCatalogItem }>(`/api/products/units/${id}`, {
        method: 'PUT',
        body: updates,
      });
      await loadRoleScopedData();
      return { success: true, productUnit: res.productUnit };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث الوحدة', 'Could not update unit') };
    }
  };

  const deleteProductUnit = async (id: string) => {
    try {
      await apiRequest(`/api/products/units/${id}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حذف الوحدة', 'Could not delete unit') };
    }
  };

  const toggleProductUnitStatus = async (id: string) => {
    const unt = (data.productUnits || []).find((u) => u.id === id);
    if (!unt) return { success: false, error: tr('الوحدة غير موجودة', 'Unit not found') };
    return updateProductUnit(id, { status: unt.status === 'suspended' ? 'active' : 'suspended' });
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إضافة المستودع', 'Could not add warehouse') };
    }
  };

  const updateWarehouse = async (id: string, updates: Partial<Warehouse>) => {
    await apiRequest(`/api/inventory/warehouses/${id}`, { method: 'PUT', body: updates });
    await loadRoleScopedData();
  };

  const toggleWarehouseStatus = async (id: string) => {
    const wh = data.warehouses.find((w) => w.id === id);
    if (!wh) return { success: false, error: tr('المستودع غير موجود', 'Warehouse not found') };
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

  const updateOwnCustomerProfile = async (updates: Partial<Customer>) => {
    try {
      const res = await apiRequest<{ ok: boolean; customer: Customer }>('/api/customers/me', {
        method: 'PUT',
        body: updates,
      });
      await Promise.all([loadRoleScopedData(), refreshAuthContext()]);
      return { success: true, customer: res.customer };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const myCustomer = data.customers[0];
        await queueOfflineOp({
          operationType: 'update_own_profile',
          entityType: 'customer',
          entityId: myCustomer?.id,
          summaryAr: `تحديث الملف الشخصي والموقع محلياً: ${updates.shopName || updates.name || myCustomer?.name || ''}`,
          payload: {
            customerId: myCustomer?.id,
            ...updates,
          },
        });
        const mergedCustomer = myCustomer ? { ...myCustomer, ...updates, syncStatus: 'pending' as const } : undefined;
        return { success: true, customer: mergedCustomer, queuedOffline: true };
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث بيانات الملف الشخصي والمحل', 'Could not update profile & shop details') };
    }
  };

  const deleteCustomer = async (id: string) => {
    try {
      await apiRequest(`/api/customers/${id}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حذف العميل', 'Could not delete customer') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('فشل ربط حساب العميل', 'Failed to link customer account') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إصلاح حسابات العملاء غير المربوطة', 'Could not repair unlinked customer accounts') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث حالة حساب العميل', 'Could not update customer account status') };
    }
  };

  const recordCustomerPayment = async (
    customerId: string,
    amount: number,
    cashboxId: string,
    notes: string,
    paymentMethod: 'cash' | 'bank' | 'cheque' = 'cash',
    invoiceId?: string
  ) => {
    const idempotencyKey = generateId('IDEMP');
    try {
      const res = await apiRequest<{ ok?: boolean; collectionLocation?: string }>(`/api/customers/${customerId}/payment`, {
        method: 'POST',
        body: { amount, cashboxId, notes, paymentMethod, ...(invoiceId ? { invoiceId } : {}) },
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, collectionLocation: res?.collectionLocation };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const cust = data.customers.find((c) => c.id === customerId);
        await queueOfflineOp({
          operationType: 'record_customer_payment',
          entityType: 'payment',
          entityId: customerId,
          summaryAr: `تحصيل عميل (${cust?.name || customerId}): ${amount} ج.م`,
          payload: { customerId, amount, cashboxId, notes, paymentMethod, ...(invoiceId ? { invoiceId } : {}) },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('فشل تسجيل التحصيل', 'Failed to record collection') };
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
    try {
      await apiRequest(`/api/admin/suppliers/${id}`, { method: 'PUT', body: updates });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const existing = data.suppliers.find((s) => s.id === id);
        await queueOfflineOp({
          operationType: 'update_supplier',
          entityType: 'supplier',
          entityId: id,
          summaryAr: `تحديث بيانات المورد محليًا: ${updates.name || existing?.name || id}`,
          payload: { supplierId: id, ...updates },
        });
        return { success: true, queuedOffline: true };
      }
      throw err;
    }
  };

  const deleteSupplier = async (id: string) => {
    await apiRequest(`/api/admin/suppliers/${id}`, { method: 'DELETE' });
    await loadRoleScopedData();
  };

  const recordSupplierPayment = async (supplierId: string, amount: number, cashboxId: string, notes: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; isAdvancePayment?: boolean; advanceCreditBalance?: number }>('/api/admin/suppliers/payment', {
        method: 'POST',
        body: { supplierId, amount, cashboxId, notes },
        idempotencyKey: generateId('IDEMP'),
      });
      await loadRoleScopedData();
      return {
        success: true,
        isAdvancePayment: res.isAdvancePayment,
        advanceCreditBalance: res.advanceCreditBalance,
      };
    } catch (err: any) {
      return { success: false, code: err?.code, error: err?.message ? tr(err.message) : tr('فشل سداد المورد', 'Failed to record supplier payment') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تسوية الدفعة المقدمة للمورد', 'Could not settle supplier advance payment') };
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
                error: tr(
                  `الرصيد المحلي المتاح للصنف (${item.productName}) في المخزن المحدد هو (${avail}) فقط ولا يكفي للكمية المطلوبة (${needed}).`,
                  `Available local stock for (${item.productName}) in selected warehouse is only (${avail}), insufficient for requested (${needed}).`
                ),
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء فاتورة المبيعات', 'Could not create sales invoice') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء فاتورة المشتريات', 'Could not create purchase invoice') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إرسال فاتورة الشراء', 'Could not send purchase invoice') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تسجيل استلام فاتورة الشراء', 'Could not mark purchase invoice as received') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر رفض فاتورة الشراء', 'Could not reject purchase invoice') };
    }
  };

  const deleteDraftPurchaseInvoice = async (invoiceId: string) => {
    try {
      await apiRequest(`/api/invoices/purchase/${invoiceId}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const existing = data.invoices.find((i) => i.id === invoiceId);
        await queueOfflineOp({
          operationType: 'delete_purchase_draft',
          entityType: 'invoice',
          entityId: invoiceId,
          summaryAr: `حذف مسودة فاتورة شراء (${existing?.invoiceNumber || invoiceId})`,
          payload: { invoiceId },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حذف مسودة فاتورة الشراء', 'Could not delete draft purchase invoice') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء عرض السعر', 'Could not create price quote') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحويل عرض السعر إلى فاتورة بيع', 'Could not convert price quote to sales invoice') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تأكيد مراجعة الفاتورة', 'Could not confirm invoice review') };
    }
  };

  const confirmDraftInvoice = async (invoiceId: string) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, error: tr('اعتماد الفواتير يتطلب اتصالاً بالسيرفر المركزي لحسم المخزون والرصيد المعتمد.', 'Confirming invoices requires a connection to the central server to deduct inventory and post balances.') };
    }
    try {
      const res = await apiRequest<{ ok: boolean; invoice: Invoice }>(`/api/invoices/${invoiceId}/confirm`, {
        method: 'POST',
      });
      await loadRoleScopedData();
      return { success: true, invoice: res.invoice };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر اعتماد الفاتورة', 'Could not confirm invoice') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إلغاء الفاتورة', 'Could not cancel invoice') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تسجيل الدفعة', 'Could not record payment') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تعديل الفاتورة', 'Could not edit invoice') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تعديل فاتورة المشتريات', 'Could not edit purchase invoice') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء المرتجع', 'Could not create return') };
    }
  };

  const createPurchaseReturnRequest: DataContextType['createPurchaseReturnRequest'] = async (payload) => {
    try {
      const res = await apiRequest<{ ok: boolean; request: PurchaseReturnRequest }>(
        '/api/invoices/purchase-return-requests',
        {
          method: 'POST',
          body: payload,
          idempotencyKey: generateId('IDEMP'),
        }
      );
      await loadRoleScopedData();
      return { success: true, request: res.request };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('PRR-LOC');
        const origInv = (data.invoices || []).find((i) => i.id === payload.originalInvoiceId);
        await queueOfflineOp({
          operationType: 'create_purchase_return_request',
          entityType: 'purchase_return_request',
          localId,
          summaryAr: `طلب مرتجع مشتريات (${origInv?.invoiceNumber || payload.originalInvoiceId})`,
          payload: {
            ...payload,
            localId,
            originalInvoiceNumber: origInv?.invoiceNumber || '',
            supplierId: origInv?.supplierId || '',
            supplierName: origInv?.supplierName || '',
            warehouseId: origInv?.warehouseId || '',
            warehouseName: origInv?.warehouseName || '',
            requestedByName: currentUser.fullName || '',
          },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تقديم طلب مرتجع المشتريات', 'Could not submit purchase return request') };
    }
  };

  const approvePurchaseReturnRequest: DataContextType['approvePurchaseReturnRequest'] = async (requestId, payload = {}) => {
    try {
      const res = await apiRequest<{ ok: boolean; request: PurchaseReturnRequest; invoiceReturn: InvoiceReturn }>(
        `/api/invoices/purchase-return-requests/${requestId}/approve`,
        {
          method: 'POST',
          body: payload,
          idempotencyKey: generateId('IDEMP'),
        }
      );
      await loadRoleScopedData();
      return { success: true, request: res.request, invoiceReturn: res.invoiceReturn };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر اعتماد طلب مرتجع المشتريات', 'Could not approve purchase return request') };
    }
  };

  const rejectPurchaseReturnRequest: DataContextType['rejectPurchaseReturnRequest'] = async (requestId, reason) => {
    try {
      const res = await apiRequest<{ ok: boolean; request: PurchaseReturnRequest }>(
        `/api/invoices/purchase-return-requests/${requestId}/reject`,
        {
          method: 'POST',
          body: { reason },
        }
      );
      await loadRoleScopedData();
      return { success: true, request: res.request };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر رفض طلب مرتجع المشتريات', 'Could not reject purchase return request') };
    }
  };

  const createSalesReturnRequest: DataContextType['createSalesReturnRequest'] = async (payload) => {
    try {
      const res = await apiRequest<{ ok: boolean; request: SalesReturnRequest }>(
        '/api/invoices/sales-return-requests',
        {
          method: 'POST',
          body: payload,
          idempotencyKey: generateId('IDEMP'),
        }
      );
      await loadRoleScopedData();
      return { success: true, request: res.request };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('SRR-LOC');
        const origInv = (data.invoices || []).find((i) => i.id === payload.originalInvoiceId);
        await queueOfflineOp({
          operationType: 'create_sales_return_request',
          entityType: 'sales_return_request',
          localId,
          summaryAr: `طلب مرتجع مبيعات نقدي (${origInv?.invoiceNumber || payload.originalInvoiceId})`,
          payload: {
            ...payload,
            cashboxId: undefined,
            localId,
            originalInvoiceNumber: origInv?.invoiceNumber || '',
            customerId: origInv?.customerId || '',
            customerName: origInv?.customerName || '',
            warehouseId: origInv?.warehouseId || '',
            warehouseName: origInv?.warehouseName || '',
            requestedByName: currentUser.fullName || '',
          },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تقديم طلب مرتجع المبيعات النقدي', 'Could not submit cash sales return request') };
    }
  };

  const approveSalesReturnRequest: DataContextType['approveSalesReturnRequest'] = async (requestId, payload = {}) => {
    try {
      const res = await apiRequest<{ ok: boolean; request: SalesReturnRequest; invoiceReturn: InvoiceReturn }>(
        `/api/invoices/sales-return-requests/${requestId}/approve`,
        {
          method: 'POST',
          body: payload,
          idempotencyKey: generateId('IDEMP'),
        }
      );
      await loadRoleScopedData();
      return { success: true, request: res.request, invoiceReturn: res.invoiceReturn };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر اعتماد طلب مرتجع المبيعات', 'Could not approve sales return request') };
    }
  };

  const rejectSalesReturnRequest: DataContextType['rejectSalesReturnRequest'] = async (requestId, reason) => {
    try {
      const res = await apiRequest<{ ok: boolean; request: SalesReturnRequest }>(
        `/api/invoices/sales-return-requests/${requestId}/reject`,
        {
          method: 'POST',
          body: { reason },
        }
      );
      await loadRoleScopedData();
      return { success: true, request: res.request };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر رفض طلب مرتجع المبيعات', 'Could not reject sales return request') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر التحويل بين الخزائن', 'Could not transfer between cashboxes') };
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
    direction: 'owner_to_rep' | 'rep_to_owner' | 'rep_to_rep';
    senderId: string;
    senderName: string;
    receiverId: string;
    receiverName: string;
    amount: number;
    cashboxId?: string;
    notes?: string;
  }) => {
    const idempotencyKey = generateId('RTRF');
    const dirLabel =
      transferData.direction === 'rep_to_owner'
        ? 'توريد للفرع'
        : transferData.direction === 'rep_to_rep'
        ? 'تحويل بين مناديب'
        : 'صرف عهدة لمندوب';
    if (typeof navigator !== 'undefined' && navigator.onLine === false && currentUser) {
      const localId = generateId('TRF-LOC');
      await queueOfflineOp({
        operationType: 'create_rep_transfer',
        entityType: 'rep_transfer',
        localId,
        summaryAr: `طلب تحويل مالي محلي (${dirLabel}): ${Number(transferData.amount || 0).toFixed(2)} ج.م`,
        payload: { ...transferData },
      });
      return { success: true, queuedOffline: true };
    }
    try {
      const res = await apiRequest<{ ok: boolean; transfer: RepTransfer }>('/api/inventory/rep-transfers', {
        method: 'POST',
        body: transferData,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, transfer: res.transfer };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('TRF-LOC');
        await queueOfflineOp({
          operationType: 'create_rep_transfer',
          entityType: 'rep_transfer',
          localId,
          summaryAr: `طلب تحويل مالي محلي (${dirLabel}): ${Number(transferData.amount || 0).toFixed(2)} ج.م`,
          payload: { ...transferData },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إرسال طلب التحويل', 'Could not send transfer request') };
    }
  };

  const confirmRepTransferReceipt = async (transferId: string, note?: string) => {
    const idempotencyKey = generateId('CTRF');
    const trObj = (data.repTransfers || []).find((t) => t.id === transferId);
    if (typeof navigator !== 'undefined' && navigator.onLine === false && currentUser) {
      await queueOfflineOp({
        operationType: 'confirm_rep_transfer',
        entityType: 'rep_transfer',
        entityId: transferId,
        summaryAr: `تأكيد استلام تحويل مالي محليًا (${trObj?.transferNumber || transferId})`,
        payload: { transferId, note },
      });
      return { success: true, queuedOffline: true };
    }
    try {
      await apiRequest(`/api/inventory/rep-transfers/${transferId}/confirm`, {
        method: 'POST',
        body: { note },
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        await queueOfflineOp({
          operationType: 'confirm_rep_transfer',
          entityType: 'rep_transfer',
          entityId: transferId,
          summaryAr: `تأكيد استلام تحويل مالي محليًا (${trObj?.transferNumber || transferId})`,
          payload: { transferId, note },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر اعتماد التحويل', 'Could not approve transfer') };
    }
  };

  const rejectRepTransfer = async (transferId: string, reason: string) => {
    try {
      await apiRequest(`/api/inventory/rep-transfers/${transferId}/reject`, {
        method: 'POST',
        body: { reason },
        idempotencyKey: generateId('JTRF'),
      });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر رفض التحويل', 'Could not reject transfer') };
    }
  };

  const createRepItemTransfer = async (transferData: Omit<RepItemTransferRequest, 'id' | 'requestNumber' | 'createdAt' | 'status' | 'createdBy'> & { autoDispatch?: boolean }) => {
    const idempotencyKey = generateId('RITF');
    if (typeof navigator !== 'undefined' && navigator.onLine === false && currentUser) {
      const localId = generateId('RIT-LOC');
      await queueOfflineOp({
        operationType: 'create_rep_item_transfer',
        entityType: 'rep_item_transfer',
        localId,
        summaryAr: `طلب تحويل أصناف محلي (${transferData.representativeName || transferData.representativeId})`,
        payload: { ...transferData },
      });
      return { success: true, queuedOffline: true };
    }
    try {
      const res = await apiRequest<{ ok: boolean; request: RepItemTransferRequest }>('/api/inventory/rep-item-transfers', {
        method: 'POST',
        body: transferData,
        idempotencyKey,
      });
      await loadRoleScopedData();
      return { success: true, request: res.request };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        const localId = generateId('RIT-LOC');
        await queueOfflineOp({
          operationType: 'create_rep_item_transfer',
          entityType: 'rep_item_transfer',
          localId,
          summaryAr: `طلب تحويل أصناف محلي (${transferData.representativeName || transferData.representativeId})`,
          payload: { ...transferData },
        });
        return { success: true, queuedOffline: true };
      }
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إرسال طلب تحويل الأصناف', 'Could not send item transfer request') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث طلب التحويل', 'Could not update transfer request') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تسجيل التسليم من العهدة', 'Could not record custody delivery') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إرجاع الصنف للمخزن', 'Could not return item to warehouse') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تسجيل تسوية العهدة', 'Could not record custody adjustment') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحميل كشف عهدة المندوب', 'Could not load representative custody statement') };
    }
  };

  const createRepCustodyReturnRequest = async (payload: {
    representativeId?: string;
    targetWarehouseId?: string;
    date?: string;
    notes?: string;
    idempotencyKey?: string;
    items: Array<{ productId: string; unit?: string; unitFactor?: number; requestedQty: number; notes?: string }>;
  }) => {
    try {
      const idempotencyKey = payload.idempotencyKey || generateId('RCRQ');
      const res = await createRepCustodyReturnRequestApi({ ...payload, idempotencyKey });
      await loadRoleScopedData();
      return { success: true, request: res.request };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إرسال طلب إرجاع البضاعة', 'Could not submit custody return request') };
    }
  };

  const approveRepCustodyReturnRequest = async (
    requestId: string,
    payload: {
      items?: Array<{ productId: string; unit?: string; actualReceivedQty: number; approvedQty: number; rejectionReason?: string }>;
      reviewNotes?: string;
    }
  ) => {
    try {
      const res = await approveRepCustodyReturnRequestApi(requestId, payload);
      await loadRoleScopedData();
      return { success: true, request: res.request };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر اعتماد طلب إرجاع البضاعة', 'Could not approve custody return request') };
    }
  };

  const rejectRepCustodyReturnRequest = async (requestId: string, reason: string) => {
    try {
      const res = await rejectRepCustodyReturnRequestApi(requestId, reason);
      await loadRoleScopedData();
      return { success: true, request: res.request };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر رفض طلب إرجاع البضاعة', 'Could not reject custody return request') };
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
    class1?: string;
    class2?: string;
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
      if (filters.class1 && filters.class1 !== 'all') qs.set('class1', filters.class1);
      if (filters.class2 && filters.class2 !== 'all') qs.set('class2', filters.class2);
      const res = await apiRequest<{ ok: boolean; report: ItemMovementReportResponse }>(
        `/api/inventory/item-movement-report${qs.toString() ? `?${qs.toString()}` : ''}`
      );
      return { success: true, report: res.report };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحميل تقرير حركة الصنف', 'Could not load item movement report') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إرسال الطلب حالياً', 'Could not send order right now') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر بدء مراجعة الطلب', 'Could not start order review') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر قبول الطلب', 'Could not approve order') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر رفض الطلب', 'Could not reject order') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تعيين مندوب التوصيل', 'Could not assign delivery representative') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث حالة التوصيل', 'Could not update delivery status') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث مرحلة الطلب', 'Could not update order stage') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تسجيل الدفعة المقدمة للطلب', 'Could not record order advance payment') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحويل الطلب إلى فاتورة مبيعات', 'Could not convert order to sales invoice') };
    }
  };

  const updateCustomerItemOrder = async (id: string, status: CustomerItemOrderRequest['status'], reason?: string) => {
    if (status === 'under_review') return reviewCustomerItemOrder(id, reason);
    if (status === 'approved') return approveCustomerItemOrder(id, reason);
    if (status === 'rejected') return rejectCustomerItemOrder(id, reason || tr('لم يتم تحديد سبب', 'No reason specified'));
    return { success: false, error: tr('استخدم تحويل الطلب إلى فاتورة لإكمال دورة الاعتماد', 'Use Convert Order to Invoice to complete the approval cycle') };
  };

  const updateCustomerItemOrderContent = async (
    orderId: string,
    payload: {
      items: Array<{ productId: string; unit?: string; unitFactor?: number; quantity: number }>;
      notes?: string;
      deliveryAddress?: string;
      geoCoordinates?: string;
    }
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(`/api/orders/${orderId}`, {
        method: 'PUT',
        body: payload,
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تعديل الطلب', 'Could not edit order') };
    }
  };

  const cancelCustomerItemOrder = async (orderId: string, reason = '') => {
    try {
      const res = await apiRequest<{ ok: boolean; order: CustomerItemOrderRequest }>(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        body: { reason },
      });
      await loadRoleScopedData();
      return { success: true, order: res.order };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إلغاء الطلب', 'Could not cancel order') };
    }
  };

  // Employees & HR
  const addEmployee = async (emp: Omit<Employee, 'id'>) => {
    try {
      await apiRequest('/api/admin/employees', { method: 'POST', body: emp });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إضافة الموظف', 'Could not add employee') };
    }
  };

  const updateEmployee = async (id: string, updates: Omit<Partial<Employee>, 'userId'> & { userId?: string | null }) => {
    try {
      await apiRequest(`/api/admin/employees/${id}`, { method: 'PUT', body: updates });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث بيانات الموظف', 'Could not update employee') };
    }
  };

  const permissionPresets: RoleDefaultPermissionPresets | null =
    data.settings?.extraSettings?.roleDefaultPermissions || null;

  const loadPermissionPresets = async () => {
    try {
      const res = await apiRequest<{ ok: boolean; presets: RoleDefaultPermissionPresets }>(
        '/api/admin/permission-presets'
      );
      if (res.presets) {
        setData((prev) => ({
          ...prev,
          settings: {
            ...prev.settings,
            extraSettings: {
              ...(prev.settings?.extraSettings || {}),
              roleDefaultPermissions: res.presets,
            },
          },
        }));
      }
      return res.presets || null;
    } catch {
      return permissionPresets;
    }
  };

  const updatePermissionPresets = async (presets: Partial<RoleDefaultPermissionPresets>) => {
    try {
      const res = await apiRequest<{ ok: boolean; presets: RoleDefaultPermissionPresets }>(
        '/api/admin/permission-presets',
        { method: 'PUT', body: presets }
      );
      await loadRoleScopedData();
      return { success: true, presets: res.presets };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حفظ قوالب الصلاحيات الافتراضية', 'Could not save default permission templates') };
    }
  };

  const applyIdentityOverviewToState = (overview: {
    identities?: UnifiedIdentity[];
    identityRoles?: IdentityRoleLink[];
    conflicts?: IdentityConflict[];
  }) => {
    setData((prev) => ({
      ...prev,
      identities: overview.identities || prev.identities || [],
      identityRoles: overview.identityRoles || prev.identityRoles || [],
      identityConflicts: overview.conflicts || prev.identityConflicts || [],
    }));
  };

  const refreshIdentitiesOverview = async () => {
    try {
      const res = await fetchIdentitiesOverview();
      applyIdentityOverviewToState(res);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحميل سجل الهويات الموحدة', 'Could not load unified identities log') };
    }
  };

  const runIdentityAudit = async (createBackup = true) => {
    try {
      const res = await runIdentityAuditApi(createBackup);
      applyIdentityOverviewToState(res);
      await loadRoleScopedData();
      return { success: true, result: res.result };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تنفيذ تدقيق الهويات الموحدة', 'Could not run unified identities audit') };
    }
  };

  const linkEntityToIdentity = async (payload: {
    targetType: IdentityEntityType;
    targetId: string;
    identityId?: string | null;
    linkEmployeeId?: string | null;
    linkUserId?: string | null;
  }) => {
    try {
      const res = await linkEntityToIdentityApi(payload);
      applyIdentityOverviewToState(res);
      await loadRoleScopedData();
      return { success: true, identityId: res.result?.identityId };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر ربط السجل بالهوية الموحدة', 'Could not link record to unified identity') };
    }
  };

  const resolveIdentityConflict = async (
    conflictId: string,
    payload: { status: 'resolved' | 'dismissed' | 'pending_review'; resolutionNotes?: string }
  ) => {
    try {
      const res = await resolveIdentityConflictApi(conflictId, payload);
      applyIdentityOverviewToState(res);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث حالة التعارض', 'Could not update conflict status') };
    }
  };

  // Users & Settings
  const addUser = async (
    userData: Omit<User, 'id' | 'createdAt'> & {
      password?: string;
      linkedCustomerId?: string;
      linkedRepId?: string;
      linkedEmployeeId?: string | null;
      autoCreateCustomerProfile?: boolean;
      autoCreateRepProfile?: boolean;
      applyRolePreset?: boolean;
    }
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; user: User; linkedCustomerId?: string; linkedRepresentativeId?: string }>(
        '/api/admin/users',
        {
          method: 'POST',
          body: userData,
        }
      );
      await loadRoleScopedData();
      return {
        success: true,
        user: res.user,
        linkedCustomerId: res.linkedCustomerId,
        linkedRepresentativeId: res.linkedRepresentativeId,
      };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء المستخدم', 'Could not create user') };
    }
  };

  const updateUser = async (
    id: string,
    updates: Partial<User> & {
      newPassword?: string;
      linkedCustomerId?: string;
      linkedRepId?: string;
      linkedEmployeeId?: string | null;
      autoCreateCustomerProfile?: boolean;
      autoCreateRepProfile?: boolean;
      applyRolePreset?: boolean;
    }
  ) => {
    try {
      const res = await apiRequest<{ ok: boolean; user: User; linkedCustomerId?: string; linkedRepresentativeId?: string }>(
        `/api/admin/users/${id}`,
        { method: 'PUT', body: updates }
      );
      await loadRoleScopedData();
      return {
        success: true,
        user: res.user,
        linkedCustomerId: res.linkedCustomerId,
        linkedRepresentativeId: res.linkedRepresentativeId,
      };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث المستخدم', 'Could not update user') };
    }
  };

  const deleteUser = async (id: string) => {
    try {
      await apiRequest(`/api/admin/users/${id}`, { method: 'DELETE' });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حذف المستخدم', 'Could not delete user') };
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
          error: err?.message ? tr(err.message) : tr('تعذر حفظ إعدادات الاتصال في السيرفر المركزي', 'Could not save connection settings on central server'),
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تنفيذ الترحيل', 'Could not execute migration') };
    }
  };

  const rollbackMigration = async (backupFile?: string) => {
    try {
      await apiRequest('/api/admin/migration/rollback', { method: 'POST', body: { backupFile } });
      await loadRoleScopedData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر التراجع عن الترحيل', 'Could not roll back migration') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تنفيذ العملية النقدية', 'Could not execute cash operation') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تعديل اسم التصنيف', 'Could not rename category') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء الحساب الشخصي', 'Could not create personal account') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحديث الحساب الشخصي', 'Could not update personal account') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تسجيل الحركة الشخصية', 'Could not record personal transaction') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تعديل الحركة الشخصية', 'Could not edit personal transaction') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء جلسة الجرد', 'Could not create stock count session') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حفظ تعديلات الجرد', 'Could not save stock count updates') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إرسال الجرد للاعتماد', 'Could not submit stock count for approval') };
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
        error: err?.message ? tr(err.message) : tr('تعذر اعتماد الجرد', 'Could not approve stock count'),
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر رفض الجرد', 'Could not reject stock count') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إنشاء طلب التحويل', 'Could not create transfer request') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر إرسال طلب التحويل للاعتماد', 'Could not submit transfer request for approval') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر اعتماد طلب التحويل', 'Could not approve transfer request') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر رفض طلب التحويل', 'Could not reject transfer request') };
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
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تنفيذ التحويل المخزني', 'Could not execute stock transfer') };
    }
  };

  // Storefront CMS & Customer Favorites
  const refreshStorefrontAdmin = useCallback(async () => {
    try {
      const res = await fetchAdminStorefrontApi();
      setStorefrontDraft(res.draft);
      setStorefrontPublishedAdmin(res.published);
      setPublishedStorefront(res.published);
      return { success: true, draft: res.draft, published: res.published };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر تحميل إعدادات واجهة المتجر', 'Could not load storefront settings') };
    }
  }, []);

  const saveStorefrontDraft = async (config: Partial<StorefrontConfig>) => {
    try {
      const res = await saveStorefrontDraftApi(config);
      setStorefrontDraft(res.draft);
      setStorefrontPublishedAdmin(res.published);
      return { success: true, draft: res.draft };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر حفظ مسودة المتجر', 'Could not save storefront draft') };
    }
  };

  const publishStorefront = async (config?: Partial<StorefrontConfig>) => {
    try {
      const res = await publishStorefrontApi(config);
      setStorefrontDraft(res.draft);
      setStorefrontPublishedAdmin(res.published);
      setPublishedStorefront(res.published);
      await loadRoleScopedData();
      return { success: true, draft: res.draft, published: res.published };
    } catch (err: any) {
      return { success: false, error: err?.message ? tr(err.message) : tr('تعذر نشر تحديثات المتجر', 'Could not publish storefront updates') };
    }
  };

  const toggleCustomerFavorite = async (productId: string) => {
    const cleanId = String(productId || '').trim();
    if (!cleanId) {
      return { success: false, favoriteProductIds: customerFavorites, isFavorite: false, error: tr('معرف الصنف غير صالح', 'Invalid product ID') };
    }
    const prevList = customerFavorites;
    const exists = prevList.includes(cleanId);
    const optimisticList = exists ? prevList.filter((id) => id !== cleanId) : [...prevList, cleanId];
    setCustomerFavorites(optimisticList);

    try {
      const res = await toggleCustomerFavoriteApi(cleanId);
      setCustomerFavorites(res.favoriteProductIds || []);
      return {
        success: true,
        favoriteProductIds: res.favoriteProductIds || [],
        isFavorite: Boolean(res.isFavorite),
      };
    } catch (err: any) {
      if (isNetworkFailure(err) && currentUser) {
        await queueOfflineOp({
          operationType: 'update_customer_favorites',
          entityType: 'customer',
          entityId: data.customers[0]?.id,
          summaryAr: `${exists ? 'إزالة من' : 'إضافة إلى'} المفضلة محلياً`,
          payload: { favoriteProductIds: optimisticList },
        });
        return {
          success: true,
          favoriteProductIds: optimisticList,
          isFavorite: !exists,
          queuedOffline: true,
        };
      }
      setCustomerFavorites(prevList);
      return {
        success: false,
        favoriteProductIds: prevList,
        isFavorite: exists,
        error: err?.message ? tr(err.message) : tr('تعذر تحديث قائمة المفضلة', 'Could not update favorites list'),
      };
    }
  };

  const resolveActiveOfferForProduct = useCallback(
    (product: Product, unitName?: string) => resolveActiveStorefrontOffer(product, unitName, publishedStorefront),
    [publishedStorefront]
  );

  const pendingSyncCount = syncQueue.filter((q) =>
    q.status === 'local' || q.status === 'pending' || q.status === 'syncing' || q.status === 'failed'
  ).length;
  const failedSyncCount = syncQueue.filter((q) => q.status === 'failed').length;
  const conflictsCount = syncConflicts.filter((c) => c.status === 'needs_review').length;
  const hasTentativeLocalBalances = pendingSyncCount > 0;

  const incomingDispatchCount = syncDispatchBatches.filter((b) => {
    if (b.receiptStatus !== 'في انتظار الاستلام' && b.receiptStatus !== 'جاري الاستلام') return false;
    if (!currentUser || currentUser.role === 'customer') return false;
    if (b.senderUserId === currentUser.id) return false;
    if (currentUser.role === 'representative') {
      return b.recipientUserId === currentUser.id;
    }
    const p = currentUser.permissions || {};
    return (
      currentUser.role === 'admin' ||
      currentUser.role === 'manager' ||
      b.recipientUserId === currentUser.id ||
      Boolean(p.canApprove || p.canReceive || p.canManageReps || p.canManageTransfers)
    );
  }).length;

  const myRepProfileForCount =
    currentUser?.role === 'representative'
      ? (data.representatives || []).find((r) => r.userId && r.userId === currentUser.id)
      : undefined;

  const actionableCashCount = (data.repTransfers || []).filter((t) => {
    if (t.status !== 'awaiting_receipt' || !currentUser || currentUser.role === 'customer') return false;
    if (currentUser.role === 'representative') {
      if (!myRepProfileForCount) return false;
      return (t.direction === 'owner_to_rep' || t.direction === 'rep_to_rep') && t.receiverId === myRepProfileForCount.id && t.senderId !== myRepProfileForCount.id;
    }
    const p = currentUser.permissions || {};
    return currentUser.role === 'admin' || currentUser.role === 'manager' || Boolean(p.canManageTransfers || p.canManageReps || p.canManageCashboxes || p.canApprove);
  }).length;

  const actionableItemTransferCount = (data.repItemTransfers || []).filter((r) => {
    if (!currentUser || currentUser.role === 'customer') return false;
    if (currentUser.role === 'representative') {
      if (!myRepProfileForCount) return false;
      return r.status === 'executed' && r.representativeId === myRepProfileForCount.id && r.senderRepresentativeId !== myRepProfileForCount.id;
    }
    const p = currentUser.permissions || {};
    if (currentUser.role !== 'admin' && currentUser.role !== 'manager' && !p.canManageTransfers && !p.canManageReps && !p.canApprove) {
      return false;
    }
    return r.status === 'pending' || r.status === 'executed';
  }).length;

  const pendingSendReceiveCount =
    pendingSyncCount + conflictsCount + incomingDispatchCount + actionableCashCount + actionableItemTransferCount;

  if (!isInitialLoaded && isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white font-sans">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-lg font-bold">{tr('جاري تحميل ومزامنة بيانات نظام أولاد سليم...', 'Loading and syncing AWLAD SELIM system data...')}</p>
        </div>
      </div>
    );
  }

  return (
    <DataContext.Provider
      value={{
        ...data,
        repTransferTargets: data.repTransferTargets || [],
        auditLogs: data.auditLogs || [],
        orderAdvancePayments: data.orderAdvancePayments || [],
        syncConflicts,
        syncQueue,
        syncDispatchBatches,
        dispatchRecipients,
        incomingDispatchCount,
        pendingSendReceiveCount,
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
        getCustomerStatement,
        getSupplierStatement,
        getRepresentativeStatement,
        getCustomerPriceHistory,
        getSupplierPriceHistory,
        getSendReceiveActivityLog,
        getSyncSourceDocument,
        triggerSync,
        triggerManualSync,
        serverSyncState,
        lastSendSummary,
        lastReceiveSummary,
        sendReceiveHistory,
        sendProgressPercent,
        sendProgressStage,
        receiveProgressPercent,
        receiveProgressStage,
        mandatorySendEnabled,
        mandatorySendIntervalMinutes,
        mandatorySendRemainingSeconds,
        isMandatorySending,
        isMandatorySendPendingRetry,
        triggerMandatorySendNow,
        syncSendOnly,
        syncReceiveOnly,
        sendSyncOperations,
        previewReceiveUpdates,
        confirmReceiveUpdates,
        createAndSendDispatchBatch,
        retryDispatchBatch,
        confirmDispatchReceipt,
        markDispatchReceiving,
        failDispatchReceipt,
        refreshDispatches,
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
        productGroups: data.productGroups || [],
        addProductGroup,
        updateProductGroup,
        deleteProductGroup,
        toggleProductGroupStatus,
        categories: data.categories || [],
        addCategory,
        updateCategory,
        deleteCategory,
        toggleCategoryStatus,
        productUnits: data.productUnits || [],
        addProductUnit,
        updateProductUnit,
        deleteProductUnit,
        toggleProductUnitStatus,
        addWarehouse,
        updateWarehouse,
        toggleWarehouseStatus,
        ensureRepVanWarehouse,
        addCustomer,
        updateCustomer,
        updateOwnCustomerProfile,
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
        deleteDraftPurchaseInvoice,
        createSalesQuote,
        convertQuoteToInvoice,
        markInvoiceReviewed,
        confirmDraftInvoice,
        cancelInvoice,
        addInvoicePayment,
        editSalesInvoice,
        editPurchaseInvoice,
        createReturn,
        purchaseReturnRequests: data.purchaseReturnRequests || [],
        createPurchaseReturnRequest,
        approvePurchaseReturnRequest,
        rejectPurchaseReturnRequest,
        salesReturnRequests: data.salesReturnRequests || [],
        createSalesReturnRequest,
        approveSalesReturnRequest,
        rejectSalesReturnRequest,
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
        repCustodyReturnRequests: data.repCustodyReturnRequests || [],
        recordRepCustodyDelivery,
        recordRepCustodyReturn,
        createRepCustodyReturnRequest,
        approveRepCustodyReturnRequest,
        rejectRepCustodyReturnRequest,
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
        updateCustomerItemOrderContent,
        cancelCustomerItemOrder,
        addEmployee,
        updateEmployee,
        identities: data.identities || [],
        identityRoles: data.identityRoles || [],
        identityConflicts: data.identityConflicts || [],
        refreshIdentitiesOverview,
        runIdentityAudit,
        linkEntityToIdentity,
        resolveIdentityConflict,
        permissionPresets,
        loadPermissionPresets,
        updatePermissionPresets,
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
        publishedStorefront,
        storefrontDraft,
        storefrontPublishedAdmin,
        customerFavorites,
        refreshStorefrontAdmin,
        saveStorefrontDraft,
        publishStorefront,
        toggleCustomerFavorite,
        resolveActiveOfferForProduct,
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

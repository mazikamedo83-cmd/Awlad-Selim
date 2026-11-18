import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { 
  DatabaseState, loadDatabase, saveDatabase, generateId, logAuditEvent, resetDatabaseToFactoryFresh 
} from '../services/storage';
import { 
  Product, Customer, Supplier, Invoice, InvoiceReturn, Cashbox, 
  FinancialTransaction, Cheque, InstallmentSchedule, Representative, 
  RepTransfer, Employee, EmployeeAdvanceDeduction, AttendanceRecord, 
  SalaryPayroll, ExpenseIncomeRecord, StockMovement, User, SystemSettings, 
  NetworkSyncStatus, InvoicePayment, RepItemTransferRequest, RepItemTransferStatus,
  RepTransferItem, ServerConnectionSettings, ProductCategory, Warehouse, CustomerItemOrderRequest
} from '../types';
import { useAuth } from './AuthContext';

interface DataContextType extends DatabaseState {
  networkStatus: NetworkSyncStatus;
  lastSyncTime: string;
  pendingChangesCount: number;
  triggerManualSync: () => Promise<void>;
  exportBackup: () => void;
  importBackup: (fileContent: string) => Promise<{ success: boolean; error?: string }>;
  resetSystemToFresh: () => Promise<void>;

  // Products & Inventory
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<{ success: boolean; error?: string }>;
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

  // Customers & Suppliers
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'currentBalance' | 'priceHistory'>) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<{ success: boolean; error?: string }>;
  recordCustomerPayment: (customerId: string, amount: number, cashboxId: string, notes: string) => Promise<{ success: boolean; error?: string }>;

  addSupplier: (supplier: Omit<Supplier, 'id' | 'createdAt' | 'currentBalance'>) => Promise<Supplier>;
  updateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  recordSupplierPayment: (supplierId: string, amount: number, cashboxId: string, notes: string) => Promise<{ success: boolean; error?: string }>;

  // Sales & Purchases
  createSalesInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
  createPurchaseInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>) => Promise<{ success: boolean; error?: string; invoice?: Invoice }>;
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

  createCustomerItemOrder: (payload: Omit<CustomerItemOrderRequest, 'id' | 'requestNumber' | 'status' | 'createdAt'>) => Promise<{ success: boolean; error?: string }>;
  updateCustomerItemOrder: (id: string, status: CustomerItemOrderRequest['status'], reason?: string) => Promise<{ success: boolean; error?: string }>;

  // Employees & Payroll
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<void>;
  updateEmployee: (id: string, updates: Partial<Employee>) => Promise<void>;
  recordAttendance: (attendance: Omit<AttendanceRecord, 'id'>) => Promise<void>;
  addAdvanceDeduction: (item: Omit<EmployeeAdvanceDeduction, 'id' | 'createdAt' | 'isSettled'>) => Promise<void>;
  paySalary: (payroll: Omit<SalaryPayroll, 'id' | 'payrollNumber'>) => Promise<void>;

  // Users & Settings
  addUser: (userData: Omit<User, 'id' | 'createdAt'>) => Promise<void>;
  updateUser: (id: string, updates: Partial<User>) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  updateSettings: (newSettings: Partial<SystemSettings>) => Promise<void>;

  // Server & Connectivity
  updateServerSettings: (newSettings: Partial<ServerConnectionSettings>) => Promise<void>;
  testServerConnection: () => Promise<{ success: boolean; latencyMs: number; error?: string }>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [data, setData] = useState<DatabaseState | null>(null);
  const [networkStatus, setNetworkStatus] = useState<NetworkSyncStatus>('connected');
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString('ar-EG'));
  const [pendingChangesCount, setPendingChangesCount] = useState<number>(0);

  // Load database once on mount
  useEffect(() => {
    loadDatabase().then(async loaded => {
      setData(loaded);
      const base = loaded.serverSettings?.apiBaseUrl?.replace(/\/$/, '');
      if (base) {
        try {
          const response = await fetch(`${base}/api/database`, { headers: { 'Accept': 'application/json' } });
          if (response.ok) {
            const payload = await response.json();
            if (payload?.database?.users && payload?.database?.products) {
              setData(payload.database as DatabaseState); saveDatabase(payload.database as DatabaseState); setNetworkStatus('connected');
            }
          } else if (response.status === 404) {
            const seeded = await fetch(`${base}/api/database`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({database:loaded}) });
            if (!seeded.ok) setNetworkStatus('pending');
          }
        } catch { setNetworkStatus('pending'); }
      }
    });
  }, []);

  // Periodic network verification test
  useEffect(() => {
    const checkActualConnectivity = async () => {
      if (!navigator.onLine) {
        setNetworkStatus('disconnected');
        return;
      }
      try {
        // Real fetch check with short timeout to verify backend connectivity
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        await fetch('/index.html?t=' + Date.now(), { method: 'HEAD', signal: controller.signal });
        clearTimeout(timeoutId);
        setNetworkStatus(pendingChangesCount > 0 ? 'pending' : 'connected');
      } catch {
        setNetworkStatus('disconnected');
      }
    };

    checkActualConnectivity();
    const interval = setInterval(checkActualConnectivity, 15000);
    window.addEventListener('online', checkActualConnectivity);
    window.addEventListener('offline', checkActualConnectivity);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', checkActualConnectivity);
      window.removeEventListener('offline', checkActualConnectivity);
    };
  }, [pendingChangesCount]);

  // Pull shared LAN data when there are no unsent local changes.
  useEffect(() => {
    const base = data?.serverSettings?.apiBaseUrl?.replace(/\/$/, '');
    if (!base) return;
    const poll = async () => {
      if (pendingChangesCount > 0) return;
      try {
        const response = await fetch(`${base}/api/database`, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload?.database?.users && payload?.database?.products) {
          setData(payload.database as DatabaseState); saveDatabase(payload.database as DatabaseState);
        }
      } catch { /* keep local work available while LAN is unavailable */ }
    };
    const timer = window.setInterval(poll, 7000);
    return () => window.clearInterval(timer);
  }, [data?.serverSettings?.apiBaseUrl, pendingChangesCount]);

  // Persist helper
  const commitDatabase = useCallback((newState: DatabaseState) => {
    setData(newState);
    saveDatabase(newState);
    setPendingChangesCount(prev => prev + 1);
    setLastSyncTime(new Date().toLocaleTimeString('ar-EG'));
    const base = newState.serverSettings?.apiBaseUrl?.replace(/\/$/, '');
    if (base) {
      fetch(`${base}/api/database`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ database: newState }) })
        .then(res => { if (res.ok) { setPendingChangesCount(0); setNetworkStatus('connected'); } else setNetworkStatus('pending'); })
        .catch(() => setNetworkStatus('pending'));
    }
  }, []);

  const triggerManualSync = async () => {
    if (!data) return;
    setNetworkStatus('synchronizing');
    const base = data.serverSettings?.apiBaseUrl?.replace(/\/$/, '');
    if (!base) { setNetworkStatus('disconnected'); return; }
    try {
      const response = await fetch(`${base}/api/database`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ database: data }) });
      if (!response.ok) throw new Error('تعذر حفظ البيانات على السيرفر');
      setPendingChangesCount(0); setNetworkStatus('connected'); setLastSyncTime(new Date().toLocaleTimeString('ar-EG'));
    } catch { setNetworkStatus('pending'); }
  };

  const exportBackup = () => {
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `AWLAD_SELIM_BACKUP_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'تصدير نسخة احتياطية',
        module: 'النسخ الاحتياطي والنظام',
        details: 'تم تصدير نسخة احتياطية كاملة من قاعدة بيانات أولاد سليم بنجاح.',
      });
    }
  };

  const importBackup = async (fileContent: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const parsed = JSON.parse(fileContent) as DatabaseState;
      if (!parsed.products || !parsed.users || !parsed.cashboxes) {
        return { success: false, error: 'ملف النسخة الاحتياطية غير صالح أو ناقص' };
      }
      commitDatabase(parsed);
      if (currentUser) {
        logAuditEvent({
          userId: currentUser.id,
          userName: currentUser.fullName,
          action: 'استعادة نسخة احتياطية',
          module: 'النسخ الاحتياطي والنظام',
          details: 'تمت استعادة قاعدة بيانات النظام من ملف خارجي بنجاح.',
        });
      }
      return { success: true };
    } catch {
      return { success: false, error: 'تعذر قراءة ملف النسخة الاحتياطية' };
    }
  };

  const resetSystemToFresh = async (): Promise<void> => {
    const fresh = await resetDatabaseToFactoryFresh();
    setData(fresh);
    setPendingChangesCount(0);
    setLastSyncTime(new Date().toLocaleTimeString('ar-EG'));
  };

  // ------------------ PRODUCTS & INVENTORY ------------------
  const addProduct = async (productData: Omit<Product, 'id' | 'createdAt'>): Promise<Product> => {
    if (!data) throw new Error('Data not ready');

    // Check duplicate code
    if (data.products.some(p => p.code.toLowerCase().trim() === productData.code.toLowerCase().trim())) {
      throw new Error(`كود الصنف (${productData.code}) مسجل مسبقاً، يرجى استخدام كود فريد غير مكرر.`);
    }

    const newProduct: Product = {
      ...productData,
      id: generateId('PRD'),
      createdAt: new Date().toISOString(),
    };

    // If initial stock exists in any warehouse, record initial stock movement
    const initialMovements: StockMovement[] = [];
    if (productData.stockPerWarehouse) {
      Object.entries(productData.stockPerWarehouse).forEach(([whId, qty]) => {
        if (qty > 0) {
          const wh = data.warehouses.find(w => w.id === whId);
          initialMovements.push({
            id: generateId('SM'),
            date: new Date().toISOString().split('T')[0],
            type: 'opening',
            productId: newProduct.id,
            productName: newProduct.name,
            warehouseId: whId,
            warehouseName: wh?.name || 'المستودع الرئيسي',
            quantity: qty,
            unitCost: newProduct.purchasePrice,
            notes: `رصيد افتتاحي مسجل مع إضافة الصنف (${newProduct.name})`,
            createdBy: currentUser?.fullName || 'النظام',
            createdAt: new Date().toISOString(),
          });
        }
      });
    }

    const newState: DatabaseState = {
      ...data,
      products: [newProduct, ...data.products],
      stockMovements: [...initialMovements, ...data.stockMovements],
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'إضافة منتج جديد',
        module: 'المخزون والمنتجات',
        recordId: newProduct.id,
        details: `إضافة منتج غذائي: ${newProduct.name} - كود: ${newProduct.code}`,
      });
    }
    return newProduct;
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    if (!data) return;
    // Check duplicate code if code is changed
    if (updates.code) {
      const duplicate = data.products.find(p => p.id !== id && p.code.toLowerCase().trim() === updates.code!.toLowerCase().trim());
      if (duplicate) {
        throw new Error(`كود الصنف (${updates.code}) مسجل مسبقاً لصنف آخر (${duplicate.name}).`);
      }
    }
    const newState: DatabaseState = {
      ...data,
      products: data.products.map(p => p.id === id ? { ...p, ...updates } : p),
    };
    commitDatabase(newState);
  };

  const deleteProduct = async (id: string): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const prod = data.products.find(p => p.id === id);
    if (!prod) return { success: false, error: 'المنتج غير موجود' };

    // Check if product is tied to invoices or movements (Requirement 1: Logical suspension)
    const hasInvoices = data.invoices.some(inv => inv.items?.some(it => it.productId === id));
    const hasMovements = data.stockMovements.some(sm => sm.productId === id);

    if (hasInvoices || hasMovements) {
      // Logical suspension instead of hard deletion to protect financial and audit integrity
      const newState: DatabaseState = {
        ...data,
        products: data.products.map(p => p.id === id ? { ...p, status: 'archived' } : p),
      };
      commitDatabase(newState);
      if (currentUser) {
        logAuditEvent({
          userId: currentUser.id,
          userName: currentUser.fullName,
          action: 'إيقاف منتج منطقياً',
          module: 'المخزون والمنتجات',
          recordId: id,
          details: `تم إيقاف الصنف (${prod.name}) منطقياً نظراً لوجود معاملات ومستندات وفواتير مرتبطة به حفاظاً على سلامة الحسابات.`,
        });
      }
      return { success: true, error: 'تم إيقاف الصنف وتجميده منطقياً بنجاح لحماية الفواتير والحركات التاريخية المرتبطة به.' };
    }

    const newState: DatabaseState = {
      ...data,
      products: data.products.filter(p => p.id !== id),
    };
    commitDatabase(newState);
    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'حذف منتج نهائياً',
        module: 'المخزون والمنتجات',
        recordId: id,
        details: `حذف المنتج: ${prod.name}`,
      });
    }
    return { success: true };
  };

  const toggleProductStatus = async (id: string): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const prod = data.products.find(p => p.id === id);
    if (!prod) return { success: false, error: 'المنتج غير موجود' };

    const newStatus: 'active' | 'archived' = prod.status === 'active' ? 'archived' : 'active';
    const newState: DatabaseState = {
      ...data,
      products: data.products.map(p => p.id === id ? { ...p, status: newStatus } : p),
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: newStatus === 'active' ? 'إعادة تفعيل منتج' : 'إيقاف منتج',
        module: 'المخزون والمنتجات',
        recordId: id,
        details: `${newStatus === 'active' ? 'تمت إعادة تفعيل' : 'تم إيقاف'} الصنف: ${prod.name}`,
      });
    }
    return { success: true };
  };

  // ------------------ CATEGORIES ------------------
  const addCategory = async (name: string, description?: string): Promise<{ success: boolean; category?: ProductCategory; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const cleanName = name.trim();
    if (!cleanName) return { success: false, error: 'يرجى إدخال اسم التصنيف' };

    const currentCategories = data.categories || [];
    if (currentCategories.some(c => c.name.toLowerCase() === cleanName.toLowerCase())) {
      return { success: false, error: 'هذا التصنيف موجود بالفعل' };
    }

    const newCategory: ProductCategory = {
      id: generateId('CAT'),
      name: cleanName,
      description,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    const newState: DatabaseState = {
      ...data,
      categories: [newCategory, ...currentCategories],
    };
    commitDatabase(newState);
    return { success: true, category: newCategory };
  };

  const updateCategory = async (id: string, updates: Partial<ProductCategory>) => {
    if (!data) return;
    const currentCategories = data.categories || [];
    const newState: DatabaseState = {
      ...data,
      categories: currentCategories.map(c => c.id === id ? { ...c, ...updates } : c),
    };
    commitDatabase(newState);
  };

  const toggleCategoryStatus = async (id: string) => {
    if (!data) return;
    const currentCategories = data.categories || [];
    const cat = currentCategories.find(c => c.id === id);
    if (!cat) return;
    const newStatus: 'active' | 'suspended' = cat.status === 'active' ? 'suspended' : 'active';
    const newState: DatabaseState = {
      ...data,
      categories: currentCategories.map(c => c.id === id ? { ...c, status: newStatus } : c),
    };
    commitDatabase(newState);
  };

  // ------------------ WAREHOUSES ------------------
  const addWarehouse = async (wh: Omit<Warehouse, 'id'>): Promise<{ success: boolean; error?: string; warehouse?: Warehouse }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    if (!wh.name.trim()) return { success: false, error: 'يرجى إدخال اسم المستودع' };
    if (data.warehouses.some(w => w.code.toLowerCase().trim() === wh.code.toLowerCase().trim())) {
      return { success: false, error: 'كود المستودع مسجل مسبقاً' };
    }

    const newWh: Warehouse = {
      ...wh,
      id: generateId('WH'),
      status: 'active',
    };

    const newState: DatabaseState = {
      ...data,
      warehouses: [...data.warehouses, newWh],
    };
    commitDatabase(newState);
    return { success: true, warehouse: newWh };
  };

  const updateWarehouse = async (id: string, updates: Partial<Warehouse>) => {
    if (!data) return;
    const newState: DatabaseState = {
      ...data,
      warehouses: data.warehouses.map(w => w.id === id ? { ...w, ...updates } : w),
    };
    commitDatabase(newState);
  };

  const toggleWarehouseStatus = async (id: string): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const wh = data.warehouses.find(w => w.id === id);
    if (!wh) return { success: false, error: 'المستودع غير موجود' };
    if (wh.isDefault) {
      return { success: false, error: 'لا يمكن إيقاف المستودع الرئيسي الافتراضي للنظام' };
    }

    const newStatus: 'active' | 'suspended' = wh.status === 'suspended' ? 'active' : 'suspended';
    const newState: DatabaseState = {
      ...data,
      warehouses: data.warehouses.map(w => w.id === id ? { ...w, status: newStatus } : w),
    };
    commitDatabase(newState);
    return { success: true };
  };

  const transferStock = async (
    productId: string, 
    fromWarehouseId: string, 
    toWarehouseId: string, 
    quantity: number, 
    notes: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'قاعدة البيانات غير جاهزة' };
    if (fromWarehouseId === toWarehouseId) {
      return { success: false, error: 'لا يمكن التحويل لنفس المستودع' };
    }
    const product = data.products.find(p => p.id === productId);
    if (!product) return { success: false, error: 'المنتج غير موجود' };

    const currentQty = product.stockPerWarehouse[fromWarehouseId] || 0;
    if (currentQty < quantity && !data.settings.allowNegativeStock) {
      return { success: false, error: `الرصيد المتاح بالمستودع المحول منه (${currentQty}) أقل من الكمية المطلوبة (${quantity})` };
    }

    const fromWarehouse = data.warehouses.find(w => w.id === fromWarehouseId);
    const toWarehouse = data.warehouses.find(w => w.id === toWarehouseId);

    const updatedStock = {
      ...product.stockPerWarehouse,
      [fromWarehouseId]: currentQty - quantity,
      [toWarehouseId]: (product.stockPerWarehouse[toWarehouseId] || 0) + quantity,
    };

    const movementOut: StockMovement = {
      id: generateId('SM'),
      date: new Date().toISOString().split('T')[0],
      type: 'transfer_out',
      productId: product.id,
      productName: product.name,
      warehouseId: fromWarehouseId,
      warehouseName: fromWarehouse?.name || '',
      targetWarehouseId: toWarehouseId,
      targetWarehouseName: toWarehouse?.name || '',
      quantity,
      unitCost: product.purchasePrice,
      notes: `تحويل إلى ${toWarehouse?.name}: ${notes}`,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    const movementIn: StockMovement = {
      id: generateId('SM'),
      date: new Date().toISOString().split('T')[0],
      type: 'transfer_in',
      productId: product.id,
      productName: product.name,
      warehouseId: toWarehouseId,
      warehouseName: toWarehouse?.name || '',
      targetWarehouseId: fromWarehouseId,
      targetWarehouseName: fromWarehouse?.name || '',
      quantity,
      unitCost: product.purchasePrice,
      notes: `استلام تحويل من ${fromWarehouse?.name}: ${notes}`,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    const newState: DatabaseState = {
      ...data,
      products: data.products.map(p => p.id === productId ? { ...p, stockPerWarehouse: updatedStock } : p),
      stockMovements: [movementIn, movementOut, ...data.stockMovements],
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'تحويل مخزني بين المستودعات',
        module: 'المخزون والمستودعات',
        recordId: product.id,
        details: `تحويل كمية ${quantity} من ${product.name} من ${fromWarehouse?.name} إلى ${toWarehouse?.name}.`,
      });
    }

    return { success: true };
  };

  const adjustStock = async (productId: string, warehouseId: string, newQuantity: number, reason: string) => {
    if (!data) return;
    const prod = data.products.find(p => p.id === productId);
    const wh = data.warehouses.find(w => w.id === warehouseId);
    if (!prod || !wh) return;

    const oldQty = prod.stockPerWarehouse[warehouseId] || 0;
    const diff = newQuantity - oldQty;

    const updatedStock = {
      ...prod.stockPerWarehouse,
      [warehouseId]: newQuantity,
    };

    const movement: StockMovement = {
      id: generateId('SM'),
      date: new Date().toISOString().split('T')[0],
      type: 'adjustment',
      productId: prod.id,
      productName: prod.name,
      warehouseId,
      warehouseName: wh.name,
      quantity: Math.abs(diff),
      unitCost: prod.purchasePrice,
      notes: `تسوية جردية: الفرق (${diff > 0 ? '+' : ''}${diff}) - السبب: ${reason}`,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    const newState: DatabaseState = {
      ...data,
      products: data.products.map(p => p.id === productId ? { ...p, stockPerWarehouse: updatedStock } : p),
      stockMovements: [movement, ...data.stockMovements],
    };
    commitDatabase(newState);
  };

  const recordDamagedStock = async (productId: string, warehouseId: string, quantity: number, reason: string) => {
    if (!data) return;
    const prod = data.products.find(p => p.id === productId);
    const wh = data.warehouses.find(w => w.id === warehouseId);
    if (!prod || !wh) return;

    const currentQty = prod.stockPerWarehouse[warehouseId] || 0;
    const updatedStock = {
      ...prod.stockPerWarehouse,
      [warehouseId]: Math.max(0, currentQty - quantity),
    };

    const movement: StockMovement = {
      id: generateId('SM'),
      date: new Date().toISOString().split('T')[0],
      type: 'damaged',
      productId: prod.id,
      productName: prod.name,
      warehouseId,
      warehouseName: wh.name,
      quantity,
      unitCost: prod.purchasePrice,
      notes: `إثبات توالف ومنتهي الصلاحية: ${reason}`,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    const newState: DatabaseState = {
      ...data,
      products: data.products.map(p => p.id === productId ? { ...p, stockPerWarehouse: updatedStock } : p),
      stockMovements: [movement, ...data.stockMovements],
    };
    commitDatabase(newState);
  };

  // ------------------ CUSTOMERS & SUPPLIERS ------------------
  const addCustomer = async (custData: Omit<Customer, 'id' | 'createdAt' | 'currentBalance' | 'priceHistory'>): Promise<Customer> => {
    if (!data) throw new Error('Data not ready');
    const newCust: Customer = {
      ...custData,
      id: generateId('CUST'),
      currentBalance: custData.openingBalance || 0,
      priceHistory: {},
      createdAt: new Date().toISOString(),
    };
    const newState: DatabaseState = {
      ...data,
      customers: [newCust, ...data.customers],
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'إضافة عميل جديد',
        module: 'العملاء',
        recordId: newCust.id,
        details: `إضافة عميل: ${newCust.name} برصيد افتتاحي: ${newCust.openingBalance} ج.م`,
      });
    }
    return newCust;
  };

  const updateCustomer = async (id: string, updates: Partial<Customer>) => {
    if (!data) return;
    const newState: DatabaseState = {
      ...data,
      customers: data.customers.map(c => c.id === id ? { ...c, ...updates } : c),
    };
    commitDatabase(newState);
  };

  const deleteCustomer = async (id: string): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const cust = data.customers.find(c => c.id === id);
    if (!cust) return { success: false, error: 'العميل غير موجود' };

    // Check if customer has linked invoices, receipts, or returns
    const hasInvoices = data.invoices.some(i => i.customerId === id);
    const hasTransactions = data.financialTransactions.some(t => t.partyId === id);
    const hasReturns = data.invoiceReturns.some(r => r.partyId === id);

    if (hasInvoices || hasTransactions || hasReturns) {
      return {
        success: false,
        error: 'لا يمكن حذف هذا العميل لوجود فواتير أو سندات قبض أو حركات مالية مسجلة باسمه، حفاظاً على سلامة الحسابات والأرصدة التاريخية. يمكنك تغيير حالة العميل إلى "محظور / غير نشط" لإيقاف التعامل معه.',
      };
    }

    const newState: DatabaseState = {
      ...data,
      customers: data.customers.filter(c => c.id !== id),
    };
    commitDatabase(newState);
    if (currentUser && cust) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'حذف عميل',
        module: 'العملاء',
        recordId: id,
        details: `حذف العميل: ${cust.name}`,
      });
    }
    return { success: true };
  };

  const recordCustomerPayment = async (
    customerId: string, 
    amount: number, 
    cashboxId: string, 
    notes: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const customer = data.customers.find(c => c.id === customerId);
    const cashbox = data.cashboxes.find(c => c.id === cashboxId);
    if (!customer) return { success: false, error: 'العميل غير موجود' };
    if (!cashbox) return { success: false, error: 'الخزينة غير محددة' };
    if (amount <= 0) return { success: false, error: 'يرجى إدخال مبلغ صحيح' };

    const transaction: FinancialTransaction = {
      id: generateId('FT'),
      transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString().split('T')[0],
      type: 'customer_payment',
      cashboxId: cashbox.id,
      cashboxName: cashbox.name,
      amount,
      category: 'تحصيل من عميل',
      partyId: customer.id,
      partyName: customer.name,
      description: `تحصيل نقدي من العميل ${customer.name}: ${notes}`,
      notes,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    const updatedCustomer: Customer = {
      ...customer,
      currentBalance: customer.currentBalance - amount, // يقلل المديونية
    };

    const updatedCashbox: Cashbox = {
      ...cashbox,
      currentBalance: cashbox.currentBalance + amount, // يزيد رصيد الخزينة
    };

    const newState: DatabaseState = {
      ...data,
      customers: data.customers.map(c => c.id === customerId ? updatedCustomer : c),
      cashboxes: data.cashboxes.map(c => c.id === cashboxId ? updatedCashbox : c),
      financialTransactions: [transaction, ...data.financialTransactions],
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'تسجيل تحصيل من عميل',
        module: 'المالية والحسابات',
        recordId: transaction.id,
        details: `تحصيل مبلغ ${amount} ج.م من العميل ${customer.name} وإيداعه في ${cashbox.name}`,
      });
    }

    return { success: true };
  };

  const addSupplier = async (suppData: Omit<Supplier, 'id' | 'createdAt' | 'currentBalance'>): Promise<Supplier> => {
    if (!data) throw new Error('Data not ready');
    const newSupp: Supplier = {
      ...suppData,
      id: generateId('SUPP'),
      currentBalance: suppData.openingBalance || 0,
      createdAt: new Date().toISOString(),
    };
    const newState: DatabaseState = {
      ...data,
      suppliers: [newSupp, ...data.suppliers],
    };
    commitDatabase(newState);
    return newSupp;
  };

  const updateSupplier = async (id: string, updates: Partial<Supplier>) => {
    if (!data) return;
    const newState: DatabaseState = {
      ...data,
      suppliers: data.suppliers.map(s => s.id === id ? { ...s, ...updates } : s),
    };
    commitDatabase(newState);
  };

  const deleteSupplier = async (id: string) => {
    if (!data) return;
    const supp = data.suppliers.find(s => s.id === id);
    const newState: DatabaseState = {
      ...data,
      suppliers: data.suppliers.filter(s => s.id !== id),
    };
    commitDatabase(newState);
    if (currentUser && supp) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'حذف مورد',
        module: 'الموردون',
        recordId: id,
        details: `حذف المورد: ${supp.name}`,
      });
    }
  };

  const recordSupplierPayment = async (
    supplierId: string, 
    amount: number, 
    cashboxId: string, 
    notes: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const supplier = data.suppliers.find(s => s.id === supplierId);
    const cashbox = data.cashboxes.find(c => c.id === cashboxId);
    if (!supplier) return { success: false, error: 'المورد غير موجود' };
    if (!cashbox) return { success: false, error: 'الخزينة غير محددة' };
    if (amount <= 0) return { success: false, error: 'يرجى إدخال مبلغ صحيح' };

    const transaction: FinancialTransaction = {
      id: generateId('FT'),
      transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString().split('T')[0],
      type: 'supplier_payment',
      cashboxId: cashbox.id,
      cashboxName: cashbox.name,
      amount,
      category: 'سداد لمورد',
      partyId: supplier.id,
      partyName: supplier.name,
      description: `سداد للمورد ${supplier.name}: ${notes}`,
      notes,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    const updatedSupplier: Supplier = {
      ...supplier,
      currentBalance: supplier.currentBalance - amount, // يقلل مستحقات المورد
    };

    const updatedCashbox: Cashbox = {
      ...cashbox,
      currentBalance: cashbox.currentBalance - amount, // يصرف من الخزينة
    };

    const newState: DatabaseState = {
      ...data,
      suppliers: data.suppliers.map(s => s.id === supplierId ? updatedSupplier : s),
      cashboxes: data.cashboxes.map(c => c.id === cashboxId ? updatedCashbox : c),
      financialTransactions: [transaction, ...data.financialTransactions],
    };
    commitDatabase(newState);

    return { success: true };
  };

  // ------------------ SALES INVOICES ------------------
  const createSalesInvoice = async (
    invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>
  ): Promise<{ success: boolean; error?: string; invoice?: Invoice }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    if (!invoiceData.items || invoiceData.items.length === 0) {
      return { success: false, error: 'الفاتورة يجب أن تحتوي على صنف واحد على الأقل' };
    }

    // Stock verification
    if (!data.settings.allowNegativeStock) {
      for (const item of invoiceData.items) {
        const prod = data.products.find(p => p.id === item.productId);
        if (prod) {
          const avail = prod.stockPerWarehouse[invoiceData.warehouseId] || 0;
          const reqBaseQty = item.quantity * (item.unitFactor || 1);
          if (avail < reqBaseQty) {
            return {
              success: false,
              error: `الرصيد المتاح من (${prod.name}) بالمستودع هو ${avail}، وهو أقل من المطلوب (${reqBaseQty})`,
            };
          }
        }
      }
    }

    const nextNum = (data.invoices.filter(i => i.type === 'sales').length + 1).toString().padStart(4, '0');
    const invoiceNumber = `INV-2026-${nextNum}`;
    const invoiceId = generateId('INV');

    const newInvoice: Invoice = {
      ...invoiceData,
      id: invoiceId,
      invoiceNumber,
      type: 'sales',
      status: 'confirmed',
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    // 1. Update product stock and generate stock movement
    let updatedProducts = [...data.products];
    const newStockMovements: StockMovement[] = [];

    for (const item of invoiceData.items) {
      const prod = updatedProducts.find(p => p.id === item.productId);
      if (prod) {
        const baseQty = item.quantity * (item.unitFactor || 1);
        const currentQty = prod.stockPerWarehouse[invoiceData.warehouseId] || 0;
        const newQty = currentQty - baseQty;

        updatedProducts = updatedProducts.map(p => 
          p.id === prod.id 
            ? { ...p, stockPerWarehouse: { ...p.stockPerWarehouse, [invoiceData.warehouseId]: newQty } }
            : p
        );

        newStockMovements.push({
          id: generateId('SM'),
          date: newInvoice.date,
          type: 'sale',
          productId: prod.id,
          productName: prod.name,
          warehouseId: invoiceData.warehouseId,
          warehouseName: invoiceData.warehouseName,
          quantity: baseQty,
          unitCost: item.purchasePriceAtTime,
          referenceId: invoiceId,
          referenceNumber: invoiceNumber,
          notes: `فاتورة مبيعات رقم ${invoiceNumber}`,
          createdBy: currentUser?.fullName || 'النظام',
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 2. Update customer balance & Customer Last Three Selling Prices
    let updatedCustomers = [...data.customers];
    if (newInvoice.customerId) {
      const cust = updatedCustomers.find(c => c.id === newInvoice.customerId);
      if (cust) {
        const remainingToCustomer = newInvoice.remainingAmount;
        const updatedPriceHistory = { ...(cust.priceHistory || {}) };

        // Save actual price into customer's priceHistory (maintaining last 3 prices, oldest to newest)
        for (const item of newInvoice.items) {
          const actualItemPrice = item.unitPrice;
          const prevPrices = updatedPriceHistory[item.productId] ? [...updatedPriceHistory[item.productId]] : [];
          prevPrices.push(actualItemPrice);
          if (prevPrices.length > 3) {
            prevPrices.shift(); // keep max 3
          }
          updatedPriceHistory[item.productId] = prevPrices;
        }

        updatedCustomers = updatedCustomers.map(c => 
          c.id === cust.id 
            ? { 
                ...c, 
                currentBalance: c.currentBalance + remainingToCustomer,
                priceHistory: updatedPriceHistory 
              }
            : c
        );
      }
    }

    // 3. Update Cashbox if paidAmount > 0
    let updatedCashboxes = [...data.cashboxes];
    const newTransactions = [...data.financialTransactions];

    if (newInvoice.paidAmount > 0) {
      const cb = updatedCashboxes.find(c => c.id === newInvoice.cashboxId);
      if (cb) {
        updatedCashboxes = updatedCashboxes.map(c => 
          c.id === cb.id ? { ...c, currentBalance: c.currentBalance + newInvoice.paidAmount } : c
        );

        newTransactions.unshift({
          id: generateId('FT'),
          transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
          date: newInvoice.date,
          type: 'customer_payment',
          cashboxId: cb.id,
          cashboxName: cb.name,
          amount: newInvoice.paidAmount,
          category: 'مبيعات نقدية',
          relatedDocType: 'sales',
          relatedDocId: invoiceId,
          relatedDocNumber: invoiceNumber,
          partyId: newInvoice.customerId,
          partyName: newInvoice.customerName,
          description: `تحصيل دفعة مبيعات فاتورة رقم ${invoiceNumber}`,
          createdBy: currentUser?.fullName || 'النظام',
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 4. Update Representative sales/balance if assigned
    let updatedReps = [...data.representatives];
    if (newInvoice.representativeId) {
      updatedReps = updatedReps.map(r => 
        r.id === newInvoice.representativeId 
          ? { ...r, currentBalance: r.currentBalance + (newInvoice.paidAmount || 0) }
          : r
      );
    }

    const newState: DatabaseState = {
      ...data,
      products: updatedProducts,
      customers: updatedCustomers,
      cashboxes: updatedCashboxes,
      representatives: updatedReps,
      invoices: [newInvoice, ...data.invoices],
      stockMovements: [...newStockMovements, ...data.stockMovements],
      financialTransactions: newTransactions,
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'إنشاء فاتورة مبيعات',
        module: 'المبيعات',
        recordId: invoiceId,
        details: `إصدار فاتورة مبيعات رقم ${invoiceNumber} للعميل ${newInvoice.customerName || 'نقدي'} بإجمالي ${newInvoice.grandTotal} ج.م`,
      });
    }

    return { success: true, invoice: newInvoice };
  };

  // ------------------ PURCHASE INVOICES ------------------
  const createPurchaseInvoice = async (
    invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'createdBy' | 'type'>
  ): Promise<{ success: boolean; error?: string; invoice?: Invoice }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    if (!invoiceData.items || invoiceData.items.length === 0) {
      return { success: false, error: 'فاتورة الشراء يجب أن تحتوي على صنف واحد على الأقل' };
    }

    const nextNum = (data.invoices.filter(i => i.type === 'purchase').length + 1).toString().padStart(4, '0');
    const invoiceNumber = `PUR-2026-${nextNum}`;
    const invoiceId = generateId('PUR');

    const newInvoice: Invoice = {
      ...invoiceData,
      id: invoiceId,
      invoiceNumber,
      type: 'purchase',
      status: 'confirmed',
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    // 1. Update product stock and purchase cost
    let updatedProducts = [...data.products];
    const newStockMovements: StockMovement[] = [];

    for (const item of invoiceData.items) {
      const prod = updatedProducts.find(p => p.id === item.productId);
      if (prod) {
        const baseQty = item.quantity * (item.unitFactor || 1);
        const currentQty = prod.stockPerWarehouse[invoiceData.warehouseId] || 0;
        const newQty = currentQty + baseQty;

        // update purchase price if unit is base or factor
        const baseItemCost = item.unitPrice / (item.unitFactor || 1);

        updatedProducts = updatedProducts.map(p => 
          p.id === prod.id 
            ? { 
                ...p, 
                purchasePrice: baseItemCost || p.purchasePrice,
                stockPerWarehouse: { ...p.stockPerWarehouse, [invoiceData.warehouseId]: newQty } 
              }
            : p
        );

        newStockMovements.push({
          id: generateId('SM'),
          date: newInvoice.date,
          type: 'purchase',
          productId: prod.id,
          productName: prod.name,
          warehouseId: invoiceData.warehouseId,
          warehouseName: invoiceData.warehouseName,
          quantity: baseQty,
          unitCost: baseItemCost,
          referenceId: invoiceId,
          referenceNumber: invoiceNumber,
          notes: `فاتورة مشتريات رقم ${invoiceNumber}`,
          createdBy: currentUser?.fullName || 'النظام',
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 2. Update Supplier balance
    let updatedSuppliers = [...data.suppliers];
    if (newInvoice.supplierId) {
      const supp = updatedSuppliers.find(s => s.id === newInvoice.supplierId);
      if (supp) {
        const remainingToSupplier = newInvoice.remainingAmount;
        updatedSuppliers = updatedSuppliers.map(s => 
          s.id === supp.id 
            ? { ...s, currentBalance: s.currentBalance + remainingToSupplier }
            : s
        );
      }
    }

    // 3. Update Cashbox if paidAmount > 0
    let updatedCashboxes = [...data.cashboxes];
    const newTransactions = [...data.financialTransactions];

    if (newInvoice.paidAmount > 0) {
      const cb = updatedCashboxes.find(c => c.id === newInvoice.cashboxId);
      if (cb) {
        updatedCashboxes = updatedCashboxes.map(c => 
          c.id === cb.id ? { ...c, currentBalance: c.currentBalance - newInvoice.paidAmount } : c
        );

        newTransactions.unshift({
          id: generateId('FT'),
          transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
          date: newInvoice.date,
          type: 'supplier_payment',
          cashboxId: cb.id,
          cashboxName: cb.name,
          amount: newInvoice.paidAmount,
          category: 'مشتريات نقدية',
          relatedDocType: 'purchase',
          relatedDocId: invoiceId,
          relatedDocNumber: invoiceNumber,
          partyId: newInvoice.supplierId,
          partyName: newInvoice.supplierName,
          description: `سداد دفعة مشتريات فاتورة رقم ${invoiceNumber}`,
          createdBy: currentUser?.fullName || 'النظام',
          createdAt: new Date().toISOString(),
        });
      }
    }

    const newState: DatabaseState = {
      ...data,
      products: updatedProducts,
      suppliers: updatedSuppliers,
      cashboxes: updatedCashboxes,
      invoices: [newInvoice, ...data.invoices],
      stockMovements: [...newStockMovements, ...data.stockMovements],
      financialTransactions: newTransactions,
    };
    commitDatabase(newState);

    return { success: true, invoice: newInvoice };
  };

  const cancelInvoice = async (invoiceId: string, reason: string): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const invoice = data.invoices.find(i => i.id === invoiceId);
    if (!invoice) return { success: false, error: 'الفاتورة غير موجودة' };
    if (invoice.status === 'cancelled') return { success: false, error: 'الفاتورة ملغاة بالفعل' };

    // Reverse effects
    let updatedProducts = [...data.products];
    for (const item of invoice.items) {
      const prod = updatedProducts.find(p => p.id === item.productId);
      if (prod) {
        const baseQty = item.quantity * (item.unitFactor || 1);
        const currentQty = prod.stockPerWarehouse[invoice.warehouseId] || 0;
        // if sales was confirmed, cancelling returns stock back (+); if purchase, cancelling reduces stock (-)
        const newQty = invoice.type === 'sales' ? currentQty + baseQty : currentQty - baseQty;
        updatedProducts = updatedProducts.map(p => 
          p.id === prod.id 
            ? { ...p, stockPerWarehouse: { ...p.stockPerWarehouse, [invoice.warehouseId]: newQty } }
            : p
        );
      }
    }

    // Reverse balance
    let updatedCustomers = [...data.customers];
    if (invoice.customerId) {
      updatedCustomers = updatedCustomers.map(c => 
        c.id === invoice.customerId ? { ...c, currentBalance: c.currentBalance - invoice.remainingAmount } : c
      );
    }

    let updatedSuppliers = [...data.suppliers];
    if (invoice.supplierId) {
      updatedSuppliers = updatedSuppliers.map(s => 
        s.id === invoice.supplierId ? { ...s, currentBalance: s.currentBalance - invoice.remainingAmount } : s
      );
    }

    // Reverse cashbox if paid
    let updatedCashboxes = [...data.cashboxes];
    if (invoice.paidAmount > 0) {
      updatedCashboxes = updatedCashboxes.map(c => 
        c.id === invoice.cashboxId 
          ? { ...c, currentBalance: invoice.type === 'sales' ? c.currentBalance - invoice.paidAmount : c.currentBalance + invoice.paidAmount }
          : c
      );
    }

    const updatedInvoices = data.invoices.map(i => 
      i.id === invoiceId ? { ...i, status: 'cancelled' as const, notes: `${i.notes || ''} [تم الإلغاء: ${reason}]` } : i
    );

    const newState: DatabaseState = {
      ...data,
      products: updatedProducts,
      customers: updatedCustomers,
      suppliers: updatedSuppliers,
      cashboxes: updatedCashboxes,
      invoices: updatedInvoices,
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'إلغاء فاتورة',
        module: invoice.type === 'sales' ? 'المبيعات' : 'المشتريات',
        recordId: invoiceId,
        details: `تم إلغاء الفاتورة ${invoice.invoiceNumber}. السبب: ${reason}`,
      });
    }

    return { success: true };
  };

  // تسجيل دفعة لاحقة مسجلة على نفس الفاتورة القديمة
  const addInvoicePayment = async (
    invoiceId: string,
    paymentData: {
      amount: number;
      date?: string;
      paymentMethod: 'cash' | 'bank' | 'cheque';
      cashboxId: string;
      notes?: string;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'قاعدة البيانات غير مهيأة' };
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) return { success: false, error: 'الفاتورة غير موجودة' };
    if (inv.status === 'cancelled') return { success: false, error: 'لا يمكن إضافة دفعة على فاتورة ملغاة' };
    if (paymentData.amount <= 0) return { success: false, error: 'مبلغ الدفعة يجب أن يكون أكبر من الصفر' };
    if (paymentData.amount > inv.remainingAmount) {
      return { 
        success: false, 
        error: `قيمة الدفعة (${paymentData.amount} ج.م) تتجاوز المتبقي على الفاتورة (${inv.remainingAmount} ج.م)` 
      };
    }

    const cb = data.cashboxes.find(c => c.id === paymentData.cashboxId);
    if (!cb) return { success: false, error: 'الخزينة المحددة غير موجودة' };

    const paymentId = generateId('PAY');
    const paymentDate = paymentData.date || new Date().toISOString().split('T')[0];
    const newPayment: InvoicePayment = {
      id: paymentId,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: paymentData.amount,
      date: paymentDate,
      paymentMethod: paymentData.paymentMethod,
      cashboxId: cb.id,
      cashboxName: cb.name,
      notes: paymentData.notes || 'سداد دفعة على الفاتورة',
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    const newPaidAmount = inv.paidAmount + paymentData.amount;
    const newRemainingAmount = inv.grandTotal - newPaidAmount;
    const newPaymentType: 'cash' | 'credit' | 'partial' = newRemainingAmount <= 0 ? 'cash' : 'partial';

    const updatedInvoices = data.invoices.map(i => {
      if (i.id === inv.id) {
        return {
          ...i,
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount,
          paymentType: newPaymentType,
          payments: [...(i.payments || []), newPayment],
        };
      }
      return i;
    });

    const isSales = inv.type === 'sales';

    // Update customer debt if sales invoice
    let updatedCustomers = [...data.customers];
    if (isSales && inv.customerId) {
      updatedCustomers = updatedCustomers.map(c => 
        c.id === inv.customerId 
          ? { ...c, currentBalance: c.currentBalance - paymentData.amount } 
          : c
      );
    }

    // Update supplier debt if purchase invoice
    let updatedSuppliers = [...data.suppliers];
    if (!isSales && inv.supplierId) {
      updatedSuppliers = updatedSuppliers.map(s => 
        s.id === inv.supplierId 
          ? { ...s, currentBalance: s.currentBalance - paymentData.amount } 
          : s
      );
    }

    // Update Cashbox
    const updatedCashboxes = data.cashboxes.map(c => {
      if (c.id === cb.id) {
        return {
          ...c,
          currentBalance: isSales 
            ? c.currentBalance + paymentData.amount 
            : c.currentBalance - paymentData.amount,
        };
      }
      return c;
    });

    // Create Financial Transaction
    const newTransaction: FinancialTransaction = {
      id: generateId('FT'),
      transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
      date: paymentDate,
      type: isSales ? 'customer_payment' : 'supplier_payment',
      cashboxId: cb.id,
      cashboxName: cb.name,
      amount: paymentData.amount,
      category: isSales ? 'تحصيل دفعة مبيعات' : 'سداد دفعة مشتريات',
      relatedDocType: inv.type,
      relatedDocId: inv.id,
      relatedDocNumber: inv.invoiceNumber,
      partyId: isSales ? inv.customerId : inv.supplierId,
      partyName: isSales ? inv.customerName : inv.supplierName,
      description: `دفعة مسجلة على الفاتورة رقم ${inv.invoiceNumber} (${cb.name})`,
      notes: paymentData.notes,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    const newState: DatabaseState = {
      ...data,
      invoices: updatedInvoices,
      customers: updatedCustomers,
      suppliers: updatedSuppliers,
      cashboxes: updatedCashboxes,
      financialTransactions: [newTransaction, ...data.financialTransactions],
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'تسجيل دفعة على فاتورة',
        module: isSales ? 'المبيعات' : 'المشتريات',
        recordId: inv.id,
        details: `تسجيل دفعة ${paymentData.amount} ج.م على الفاتورة ${inv.invoiceNumber}. المتبقي الجديد: ${newRemainingAmount} ج.م`,
      });
    }

    return { success: true };
  };

  // تعديل فاتورة مبيعات معتمدة وإعادة احتساب الأرصدة والمخزون
  const editSalesInvoice = async (
    invoiceId: string,
    updates: {
      date?: string;
      items?: Invoice['items'];
      discountTotal?: number;
      notes?: string;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'قاعدة البيانات غير مهيأة' };
    const inv = data.invoices.find(i => i.id === invoiceId);
    if (!inv) return { success: false, error: 'الفاتورة غير موجودة' };
    if (inv.status === 'cancelled') return { success: false, error: 'لا يمكن تعديل فاتورة ملغاة' };

    let updatedProducts = [...data.products];

    // 1. Revert old stock items
    for (const oldItem of inv.items) {
      const prod = updatedProducts.find(p => p.id === oldItem.productId);
      if (prod) {
        const baseQty = oldItem.quantity * (oldItem.unitFactor || 1);
        const currentQty = prod.stockPerWarehouse[inv.warehouseId] || 0;
        updatedProducts = updatedProducts.map(p => 
          p.id === prod.id
            ? { ...p, stockPerWarehouse: { ...p.stockPerWarehouse, [inv.warehouseId]: currentQty + baseQty } }
            : p
        );
      }
    }

    // 2. Check and deduct new stock items
    const newItems = updates.items || inv.items;
    for (const newItem of newItems) {
      const prod = updatedProducts.find(p => p.id === newItem.productId);
      if (prod) {
        const baseQty = newItem.quantity * (newItem.unitFactor || 1);
        const currentQty = prod.stockPerWarehouse[inv.warehouseId] || 0;
        if (currentQty < baseQty && !data.settings.allowNegativeStock) {
          return {
            success: false,
            error: `الرصيد المتاح من (${prod.name}) في المستودع لا يكفي للتعديل الجديد (المتاح: ${currentQty}، المطلوب: ${baseQty})`
          };
        }
        updatedProducts = updatedProducts.map(p => 
          p.id === prod.id
            ? { ...p, stockPerWarehouse: { ...p.stockPerWarehouse, [inv.warehouseId]: currentQty - baseQty } }
            : p
        );
      }
    }

    // 3. Recalculate totals
    const newSubtotal = newItems.reduce((acc, it) => acc + (it.quantity * it.unitPrice), 0);
    const newDiscount = updates.discountTotal !== undefined ? updates.discountTotal : inv.discountTotal;
    const newGrandTotal = Math.max(0, newSubtotal - newDiscount);
    const differenceInGrandTotal = newGrandTotal - inv.grandTotal;
    const newRemainingAmount = Math.max(0, newGrandTotal - inv.paidAmount);
    const newPaymentType = newRemainingAmount <= 0 ? 'cash' : (inv.paidAmount > 0 ? 'partial' : 'credit');

    // 4. Update customer balance with difference
    let updatedCustomers = [...data.customers];
    if (inv.customerId && differenceInGrandTotal !== 0) {
      updatedCustomers = updatedCustomers.map(c => 
        c.id === inv.customerId
          ? { ...c, currentBalance: c.currentBalance + differenceInGrandTotal }
          : c
      );
    }

    // 5. Update invoice
    const updatedInvoice: Invoice = {
      ...inv,
      date: updates.date || inv.date,
      items: newItems,
      subtotal: newSubtotal,
      discountTotal: newDiscount,
      grandTotal: newGrandTotal,
      remainingAmount: newRemainingAmount,
      paymentType: newPaymentType,
      notes: updates.notes !== undefined ? updates.notes : inv.notes,
    };

    const newState: DatabaseState = {
      ...data,
      products: updatedProducts,
      customers: updatedCustomers,
      invoices: data.invoices.map(i => i.id === invoiceId ? updatedInvoice : i),
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'تعديل فاتورة مبيعات',
        module: 'المبيعات',
        recordId: inv.id,
        details: `تعديل الفاتورة رقم ${inv.invoiceNumber}. الإجمالي السابق: ${inv.grandTotal} ج.م، الإجمالي الجديد: ${newGrandTotal} ج.م (فرق: ${differenceInGrandTotal} ج.م)`,
      });
    }

    return { success: true };
  };

  // ------------------ RETURNS ------------------
  const createReturn = async (
    returnData: Omit<InvoiceReturn, 'id' | 'returnNumber' | 'createdAt' | 'createdBy'>
  ): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const originalInvoice = data.invoices.find(i => i.id === returnData.originalInvoiceId);
    if (!originalInvoice) return { success: false, error: 'الفاتورة الأصلية غير موجودة' };

    // Verify quantities do not exceed original remaining invoice quantities
    const alreadyReturned = originalInvoice.returnedQuantityByItem || {};
    for (const item of returnData.items) {
      const origItem = originalInvoice.items.find(it => it.productId === item.productId);
      if (!origItem) return { success: false, error: `الصنف ${item.productName} غير موجود بالفاتورة الأصلية` };

      const prevReturned = alreadyReturned[item.productId] || 0;
      if (prevReturned + item.quantity > origItem.quantity) {
        return {
          success: false,
          error: `الكمية المرتجعة للصنف (${item.productName}) تتجاوز الكمية المتبقية من الفاتورة الأصلية (المتاح للمرتجع: ${origItem.quantity - prevReturned})`,
        };
      }
    }

    const isSalesReturn = returnData.type === 'sales_return';
    const nextNum = (data.invoiceReturns.filter(r => r.type === returnData.type).length + 1).toString().padStart(4, '0');
    const returnNumber = `${isSalesReturn ? 'RET-SAL' : 'RET-PUR'}-2026-${nextNum}`;
    const returnId = generateId('RET');

    const newReturn: InvoiceReturn = {
      ...returnData,
      id: returnId,
      returnNumber,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    // 1. Update stock (sales return adds to stock, purchase return reduces stock)
    let updatedProducts = [...data.products];
    const newStockMovements: StockMovement[] = [];

    for (const item of returnData.items) {
      const prod = updatedProducts.find(p => p.id === item.productId);
      if (prod) {
        const currentQty = prod.stockPerWarehouse[returnData.warehouseId] || 0;
        const newQty = isSalesReturn ? currentQty + item.quantity : currentQty - item.quantity;

        updatedProducts = updatedProducts.map(p => 
          p.id === prod.id ? { ...p, stockPerWarehouse: { ...p.stockPerWarehouse, [returnData.warehouseId]: newQty } } : p
        );

        newStockMovements.push({
          id: generateId('SM'),
          date: returnData.date,
          type: isSalesReturn ? 'sale_return' : 'purchase_return',
          productId: prod.id,
          productName: prod.name,
          warehouseId: returnData.warehouseId,
          warehouseName: returnData.warehouseName,
          quantity: item.quantity,
          unitCost: item.unitPrice,
          referenceId: returnId,
          referenceNumber: returnNumber,
          notes: `سند مرتجع رقم ${returnNumber} - السبب: ${returnData.reason}`,
          createdBy: currentUser?.fullName || 'النظام',
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 2. Update customer/supplier balance or cashbox
    let updatedCustomers = [...data.customers];
    let updatedSuppliers = [...data.suppliers];
    let updatedCashboxes = [...data.cashboxes];
    const newTransactions = [...data.financialTransactions];

    if (returnData.refundType === 'balance') {
      if (isSalesReturn) {
        // Customer debt decreases
        updatedCustomers = updatedCustomers.map(c => 
          c.id === returnData.partyId ? { ...c, currentBalance: c.currentBalance - returnData.grandTotal } : c
        );
      } else {
        // Supplier debt decreases
        updatedSuppliers = updatedSuppliers.map(s => 
          s.id === returnData.partyId ? { ...s, currentBalance: s.currentBalance - returnData.grandTotal } : s
        );
      }
    } else if (returnData.refundType === 'cash' && returnData.cashboxId) {
      // Cash refund from or to cashbox
      const cb = updatedCashboxes.find(c => c.id === returnData.cashboxId);
      if (cb) {
        const cashDelta = isSalesReturn ? -returnData.grandTotal : returnData.grandTotal;
        updatedCashboxes = updatedCashboxes.map(c => 
          c.id === cb.id ? { ...c, currentBalance: c.currentBalance + cashDelta } : c
        );

        newTransactions.unshift({
          id: generateId('FT'),
          transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
          date: returnData.date,
          type: isSalesReturn ? 'expense' : 'income',
          cashboxId: cb.id,
          cashboxName: cb.name,
          amount: returnData.grandTotal,
          category: isSalesReturn ? 'رد قيمة مرتجع مبيعات نقدي' : 'استرداد قيمة مرتجع مشتريات نقدي',
          relatedDocType: returnData.type,
          relatedDocId: returnId,
          relatedDocNumber: returnNumber,
          partyId: returnData.partyId,
          partyName: returnData.partyName,
          description: `تسوية نقدية لمرتجع رقم ${returnNumber}`,
          createdBy: currentUser?.fullName || 'النظام',
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 3. Update original invoice returnedQuantityByItem
    const newReturnedDict = { ...alreadyReturned };
    for (const item of returnData.items) {
      newReturnedDict[item.productId] = (newReturnedDict[item.productId] || 0) + item.quantity;
    }

    const updatedInvoices = data.invoices.map(i => 
      i.id === originalInvoice.id ? { ...i, returnedQuantityByItem: newReturnedDict } : i
    );

    const newState: DatabaseState = {
      ...data,
      products: updatedProducts,
      customers: updatedCustomers,
      suppliers: updatedSuppliers,
      cashboxes: updatedCashboxes,
      invoices: updatedInvoices,
      invoiceReturns: [newReturn, ...data.invoiceReturns],
      stockMovements: [...newStockMovements, ...data.stockMovements],
      financialTransactions: newTransactions,
    };
    commitDatabase(newState);

    return { success: true };
  };

  // ------------------ CASHBOXES & EXPENSES ------------------
  const addCashbox = async (cb: Omit<Cashbox, 'id' | 'currentBalance'>) => {
    if (!data) return;
    const newCb: Cashbox = {
      ...cb,
      id: generateId(cb.type === 'bank' ? 'BANK' : 'CASH'),
      currentBalance: cb.openingBalance,
    };
    commitDatabase({ ...data, cashboxes: [...data.cashboxes, newCb] });
  };

  const updateCashbox = async (id: string, updates: Partial<Cashbox>) => {
    if (!data) return;
    commitDatabase({
      ...data,
      cashboxes: data.cashboxes.map(c => c.id === id ? { ...c, ...updates } : c),
    });
  };

  const transferBetweenCashboxes = async (
    fromCashboxId: string, 
    toCashboxId: string, 
    amount: number, 
    notes: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    if (fromCashboxId === toCashboxId) return { success: false, error: 'لا يمكن التحويل لنفس الخزينة' };
    const fromCb = data.cashboxes.find(c => c.id === fromCashboxId);
    const toCb = data.cashboxes.find(c => c.id === toCashboxId);
    if (!fromCb || !toCb) return { success: false, error: 'الخزينة غير صحيحة' };
    if (fromCb.currentBalance < amount) {
      return { success: false, error: `رصيد ${fromCb.name} الحالي (${fromCb.currentBalance}) أقل من المبلغ المطلوب تحويله` };
    }

    const tx: FinancialTransaction = {
      id: generateId('FT'),
      transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString().split('T')[0],
      type: 'transfer',
      cashboxId: fromCb.id,
      cashboxName: fromCb.name,
      targetCashboxId: toCb.id,
      targetCashboxName: toCb.name,
      amount,
      category: 'تحويل بين الخزائن',
      description: `تحويل من ${fromCb.name} إلى ${toCb.name}: ${notes}`,
      notes,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    const updatedCashboxes = data.cashboxes.map(c => {
      if (c.id === fromCashboxId) return { ...c, currentBalance: c.currentBalance - amount };
      if (c.id === toCashboxId) return { ...c, currentBalance: c.currentBalance + amount };
      return c;
    });

    commitDatabase({
      ...data,
      cashboxes: updatedCashboxes,
      financialTransactions: [tx, ...data.financialTransactions],
    });

    return { success: true };
  };

  const addExpenseIncome = async (record: Omit<ExpenseIncomeRecord, 'id' | 'recordNumber' | 'createdAt' | 'createdBy'>) => {
    if (!data) return;
    const isExpense = record.type === 'expense';
    const num = (data.expenseIncomes.filter(r => r.type === record.type).length + 1).toString().padStart(4, '0');
    const recordNumber = `${isExpense ? 'EXP' : 'INC'}-2026-${num}`;

    const newRec: ExpenseIncomeRecord = {
      ...record,
      id: generateId(isExpense ? 'EXP' : 'INC'),
      recordNumber,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    // Cashbox balance update
    const cb = data.cashboxes.find(c => c.id === record.cashboxId);
    let updatedCashboxes = [...data.cashboxes];
    if (cb) {
      const delta = isExpense ? -record.amount : record.amount;
      updatedCashboxes = updatedCashboxes.map(c => 
        c.id === cb.id ? { ...c, currentBalance: c.currentBalance + delta } : c
      );
    }

    const tx: FinancialTransaction = {
      id: generateId('FT'),
      transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
      date: record.date,
      type: isExpense ? 'expense' : 'income',
      cashboxId: record.cashboxId,
      cashboxName: record.cashboxName,
      amount: record.amount,
      category: record.category,
      partyName: record.recipientOrPayer,
      description: `${isExpense ? 'سند صرف مصروف' : 'سند قبض إيراد'}: ${record.category} - ${record.notes || ''}`,
      notes: record.notes,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    commitDatabase({
      ...data,
      cashboxes: updatedCashboxes,
      expenseIncomes: [newRec, ...data.expenseIncomes],
      financialTransactions: [tx, ...data.financialTransactions],
    });
  };

  // ------------------ CHEQUES & INSTALLMENTS ------------------
  const addCheque = async (cheque: Omit<Cheque, 'id' | 'createdAt'>) => {
    if (!data) return;
    const newCheque: Cheque = {
      ...cheque,
      id: generateId('CHQ'),
      createdAt: new Date().toISOString(),
    };
    commitDatabase({
      ...data,
      cheques: [newCheque, ...data.cheques],
    });
  };

  const updateChequeStatus = async (id: string, newStatus: Cheque['status'], cashboxId?: string, notes?: string) => {
    if (!data) return;
    const chq = data.cheques.find(c => c.id === id);
    if (!chq) return;

    let updatedCashboxes = [...data.cashboxes];
    const newTransactions = [...data.financialTransactions];

    // If collected, credit/debit target cashbox or bank account
    if (newStatus === 'collected' && chq.status !== 'collected' && cashboxId) {
      const targetCb = updatedCashboxes.find(c => c.id === cashboxId);
      if (targetCb) {
        const isIncoming = chq.type === 'incoming';
        const delta = isIncoming ? chq.amount : -chq.amount;
        updatedCashboxes = updatedCashboxes.map(c => 
          c.id === targetCb.id ? { ...c, currentBalance: c.currentBalance + delta } : c
        );

        newTransactions.unshift({
          id: generateId('FT'),
          transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
          date: new Date().toISOString().split('T')[0],
          type: isIncoming ? 'deposit' : 'withdrawal',
          cashboxId: targetCb.id,
          cashboxName: targetCb.name,
          amount: chq.amount,
          category: 'تحصيل / صرف شيك بنكي',
          partyName: chq.partyName,
          description: `تحصيل الشيك رقم ${chq.chequeNumber} بنك ${chq.bankName}`,
          notes,
          createdBy: currentUser?.fullName || 'النظام',
          createdAt: new Date().toISOString(),
        });
      }
    }

    const updatedCheques = data.cheques.map(c => 
      c.id === id 
        ? { 
            ...c, 
            status: newStatus, 
            collectedDate: newStatus === 'collected' ? new Date().toISOString().split('T')[0] : c.collectedDate,
            notes: notes ? `${c.notes || ''} [${notes}]` : c.notes,
            cashboxId: cashboxId || c.cashboxId 
          }
        : c
    );

    commitDatabase({
      ...data,
      cashboxes: updatedCashboxes,
      cheques: updatedCheques,
      financialTransactions: newTransactions,
    });
  };

  const addInstallmentSchedule = async (scheduleData: Omit<InstallmentSchedule, 'id' | 'createdAt' | 'scheduleNumber' | 'paidAmount' | 'remainingAmount'>) => {
    if (!data) return;
    const num = (data.installments.length + 1).toString().padStart(4, '0');
    const newSchedule: InstallmentSchedule = {
      ...scheduleData,
      id: generateId('SCH'),
      scheduleNumber: `SCH-2026-${num}`,
      paidAmount: 0,
      remainingAmount: scheduleData.totalAmount,
      createdAt: new Date().toISOString(),
    };
    commitDatabase({
      ...data,
      installments: [newSchedule, ...data.installments],
    });
  };

  const payInstallment = async (scheduleId: string, installmentItemId: string, amount: number, cashboxId: string, notes?: string) => {
    if (!data) return;
    const schedule = data.installments.find(s => s.id === scheduleId);
    const cashbox = data.cashboxes.find(c => c.id === cashboxId);
    if (!schedule || !cashbox) return;

    let totalPaidDelta = 0;
    const updatedItems = schedule.items.map(item => {
      if (item.id === installmentItemId) {
        const newPaid = item.paidAmount + amount;
        const isPaid = newPaid >= item.amount;
        totalPaidDelta = amount;
        return {
          ...item,
          paidAmount: newPaid,
          status: isPaid ? ('paid' as const) : ('pending' as const),
          paidDate: isPaid ? new Date().toISOString().split('T')[0] : item.paidDate,
          notes: notes ? `${item.notes || ''} [${notes}]` : item.notes,
        };
      }
      return item;
    });

    const updatedSchedule: InstallmentSchedule = {
      ...schedule,
      paidAmount: schedule.paidAmount + totalPaidDelta,
      remainingAmount: schedule.totalAmount - (schedule.paidAmount + totalPaidDelta),
      items: updatedItems,
    };

    const updatedCashboxes = data.cashboxes.map(c => 
      c.id === cashboxId ? { ...c, currentBalance: c.currentBalance + amount } : c
    );

    const tx: FinancialTransaction = {
      id: generateId('FT'),
      transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString().split('T')[0],
      type: 'customer_payment',
      cashboxId: cashbox.id,
      cashboxName: cashbox.name,
      amount,
      category: 'سداد قسط',
      partyId: schedule.customerId,
      partyName: schedule.customerName,
      description: `سداد قسط لجدول ${schedule.scheduleNumber} - العميل ${schedule.customerName}`,
      notes,
      createdBy: currentUser?.fullName || 'النظام',
      createdAt: new Date().toISOString(),
    };

    // Update customer debt
    const updatedCustomers = data.customers.map(c => 
      c.id === schedule.customerId ? { ...c, currentBalance: c.currentBalance - amount } : c
    );

    commitDatabase({
      ...data,
      installments: data.installments.map(s => s.id === scheduleId ? updatedSchedule : s),
      cashboxes: updatedCashboxes,
      customers: updatedCustomers,
      financialTransactions: [tx, ...data.financialTransactions],
    });
  };

  // ------------------ REPRESENTATIVES & TWO-WAY TRANSFER ("طلب تحويل بالنصف") ------------------
  const addRepresentative = async (rep: Omit<Representative, 'id' | 'currentBalance'>) => {
    if (!data) return;
    const newRep: Representative = {
      ...rep,
      id: generateId('REP'),
      currentBalance: rep.openingBalance,
    };
    commitDatabase({
      ...data,
      representatives: [...data.representatives, newRep],
    });
  };

  const updateRepresentative = async (id: string, updates: Partial<Representative>) => {
    if (!data) return;
    commitDatabase({
      ...data,
      representatives: data.representatives.map(r => r.id === id ? { ...r, ...updates } : r),
    });
  };

  // "طلب تحويل بالنصف" - Send transfer request
  // IMPORTANT: As specified, sending the request creates a pending transfer request.
  // Accounting balances MUST NOT update until receipt is confirmed by the receiving party!
  const createRepTransfer = async (transferData: {
    direction: 'owner_to_rep' | 'rep_to_owner';
    senderId: string;
    senderName: string;
    receiverId: string;
    receiverName: string;
    amount: number;
    cashboxId: string;
    notes?: string;
  }): Promise<{ success: boolean; error?: string; transfer?: RepTransfer }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    if (transferData.amount <= 0) return { success: false, error: 'يرجى إدخال مبلغ صحيح أكبر من صفر' };

    const cb = data.cashboxes.find(c => c.id === transferData.cashboxId);
    if (!cb) return { success: false, error: 'الخزينة المحددة غير موجودة' };

    const nextSeq = (data.repTransfers.length + 1).toString().padStart(4, '0');
    const transferNumber = `TRN-2026-${nextSeq}`;
    const transferId = generateId('TRN');

    const newTransfer: RepTransfer = {
      id: transferId,
      transferNumber,
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      direction: transferData.direction,
      senderId: transferData.senderId,
      senderName: transferData.senderName,
      receiverId: transferData.receiverId,
      receiverName: transferData.receiverName,
      amount: transferData.amount,
      cashboxId: cb.id,
      cashboxName: cb.name,
      notes: transferData.notes,
      status: 'awaiting_receipt', // قيد الاستلام
      sentAt: new Date().toISOString(),
      auditTrail: [
        {
          timestamp: new Date().toISOString(),
          action: 'إنشاء طلب التحويل بالنصف وإرساله للطرف الآخر',
          user: currentUser?.fullName || 'النظام',
          note: transferData.notes,
        }
      ],
    };

    commitDatabase({
      ...data,
      repTransfers: [newTransfer, ...data.repTransfers],
    });

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'إنشاء طلب تحويل بالنصف',
        module: 'المندوبون والتحويلات',
        recordId: transferId,
        details: `إرسال طلب تحويل بالنصف رقم ${transferNumber} بمبلغ ${transferData.amount} ج.م من ${transferData.senderName} إلى ${transferData.receiverName}. في انتظار تأكيد الاستلام.`,
      });
    }

    return { success: true, transfer: newTransfer };
  };

  // "طلب تحويل بالنصف" - Receiver confirms receipt!
  // ONLY HERE the accounting balances change!
  const confirmRepTransferReceipt = async (
    transferId: string, 
    note?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const transfer = data.repTransfers.find(t => t.id === transferId);
    if (!transfer) return { success: false, error: 'طلب التحويل غير موجود' };
    if (transfer.status === 'received') return { success: false, error: 'تم تأكيد استلام هذا التحويل مسبقاً' };
    if (transfer.status === 'rejected' || transfer.status === 'cancelled') {
      return { success: false, error: 'لا يمكن تأكيد تحويل ملغى أو مرفوض' };
    }

    const cb = data.cashboxes.find(c => c.id === transfer.cashboxId);
    if (!cb) return { success: false, error: 'الخزينة المحددة غير موجودة' };

    // Update balances according to direction
    let updatedCashboxes = [...data.cashboxes];
    let updatedReps = [...data.representatives];
    const newTransactions = [...data.financialTransactions];

    if (transfer.direction === 'rep_to_owner') {
      // Rep sent collected money to owner/main branch:
      // Representative balance decreases (-), Branch Cashbox increases (+)
      const rep = updatedReps.find(r => r.id === transfer.senderId);
      if (rep) {
        updatedReps = updatedReps.map(r => 
          r.id === rep.id ? { ...r, currentBalance: r.currentBalance - transfer.amount } : r
        );
      }
      updatedCashboxes = updatedCashboxes.map(c => 
        c.id === cb.id ? { ...c, currentBalance: c.currentBalance + transfer.amount } : c
      );

      newTransactions.unshift({
        id: generateId('FT'),
        transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
        date: new Date().toISOString().split('T')[0],
        type: 'rep_transfer',
        cashboxId: cb.id,
        cashboxName: cb.name,
        amount: transfer.amount,
        category: 'توريد تحصيلات مندوب',
        relatedDocType: 'rep_transfer',
        relatedDocId: transfer.id,
        relatedDocNumber: transfer.transferNumber,
        partyName: transfer.senderName,
        description: `تأكيد استلام توريد نقدية من المندوب ${transfer.senderName} (طلب تحويل بالنصف رقم ${transfer.transferNumber})`,
        notes: note || transfer.notes,
        createdBy: currentUser?.fullName || 'النظام',
        createdAt: new Date().toISOString(),
      });
    } else {
      // Owner sent funds/custody to representative:
      // Branch Cashbox decreases (-), Representative balance increases (+)
      const rep = updatedReps.find(r => r.id === transfer.receiverId);
      if (rep) {
        updatedReps = updatedReps.map(r => 
          r.id === rep.id ? { ...r, currentBalance: r.currentBalance + transfer.amount } : r
        );
      }
      updatedCashboxes = updatedCashboxes.map(c => 
        c.id === cb.id ? { ...c, currentBalance: c.currentBalance - transfer.amount } : c
      );

      newTransactions.unshift({
        id: generateId('FT'),
        transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
        date: new Date().toISOString().split('T')[0],
        type: 'rep_transfer',
        cashboxId: cb.id,
        cashboxName: cb.name,
        amount: transfer.amount,
        category: 'صرف عهدة ونقدية لمندوب',
        relatedDocType: 'rep_transfer',
        relatedDocId: transfer.id,
        relatedDocNumber: transfer.transferNumber,
        partyName: transfer.receiverName,
        description: `تأكيد استلام المندوب ${transfer.receiverName} لمبلغ عهدة/تحويل رقم ${transfer.transferNumber}`,
        notes: note || transfer.notes,
        createdBy: currentUser?.fullName || 'النظام',
        createdAt: new Date().toISOString(),
      });
    }

    const updatedAuditTrail = [
      ...transfer.auditTrail,
      {
        timestamp: new Date().toISOString(),
        action: 'تأكيد الاستلام الفعلي واعتماد القيود المحاسبية وتعديل الأرصدة',
        user: currentUser?.fullName || 'الطرف المستلم',
        note,
      }
    ];

    const updatedTransfer: RepTransfer = {
      ...transfer,
      status: 'received',
      confirmedAt: new Date().toISOString(),
      confirmedBy: currentUser?.fullName || 'النظام',
      auditTrail: updatedAuditTrail,
    };

    commitDatabase({
      ...data,
      repTransfers: data.repTransfers.map(t => t.id === transferId ? updatedTransfer : t),
      cashboxes: updatedCashboxes,
      representatives: updatedReps,
      financialTransactions: newTransactions,
    });

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'تأكيد استلام طلب تحويل بالنصف',
        module: 'المندوبون والتحويلات',
        recordId: transferId,
        details: `تم تأكيد استلام تحويل رقم ${transfer.transferNumber} بمبلغ ${transfer.amount} ج.م وتم تحديث الأرصدة المالية بنجاح.`,
      });
    }

    return { success: true };
  };

  const rejectRepTransfer = async (transferId: string, reason: string): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'النظام غير جاهز' };
    const transfer = data.repTransfers.find(t => t.id === transferId);
    if (!transfer) return { success: false, error: 'طلب التحويل غير موجود' };
    if (transfer.status === 'received') return { success: false, error: 'تم تأكيد الاستلام مسبقاً ولا يمكن رفضه' };

    const updatedTransfer: RepTransfer = {
      ...transfer,
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectionReason: reason,
      auditTrail: [
        ...transfer.auditTrail,
        {
          timestamp: new Date().toISOString(),
          action: 'رفض طلب التحويل',
          user: currentUser?.fullName || 'الطرف المستلم',
          note: `سبب الرفض: ${reason}`,
        }
      ],
    };

    commitDatabase({
      ...data,
      repTransfers: data.repTransfers.map(t => t.id === transferId ? updatedTransfer : t),
    });

    return { success: true };
  };

  // إنشاء طلب تحويل أصناف وعهدة مخزنية للمندوب مرتبط بفاتورة
  const createRepItemTransfer = async (
    transferData: Omit<RepItemTransferRequest, 'id' | 'requestNumber' | 'createdAt' | 'status' | 'createdBy'>
  ): Promise<{ success: boolean; request?: RepItemTransferRequest; error?: string }> => {
    if (!data) return { success: false, error: 'قاعدة البيانات غير مهيأة' };
    const reqId = generateId('RTR');
    const nextNum = ((data.repItemTransfers?.length || 0) + 1).toString().padStart(4, '0');
    const requestNumber = `RTR-${nextNum}`;

    const newRequest: RepItemTransferRequest = {
      ...transferData,
      id: reqId,
      requestNumber,
      status: 'pending',
      createdBy: currentUser?.fullName || 'مندوب مبيعات',
      createdAt: new Date().toISOString(),
    };

    const newState: DatabaseState = {
      ...data,
      repItemTransfers: [newRequest, ...(data.repItemTransfers || [])],
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'إنشاء طلب تحويل أصناف',
        module: 'المندوبون',
        recordId: reqId,
        details: `إنشاء طلب تحويل أصناف وعهدة رقم ${requestNumber} للمندوب ${newRequest.representativeName} مرتبط بفاتورة ${newRequest.invoiceNumber || '-'}`,
      });
    }

    return { success: true, request: newRequest };
  };

  // تحديث حالة طلب تحويل الأصناف (موافقة / رفض / تنفيذ التحويل المخزني)
  const updateRepItemTransferStatus = async (
    requestId: string,
    newStatus: RepItemTransferStatus,
    approvedItems?: RepTransferItem[],
    notes?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!data) return { success: false, error: 'قاعدة البيانات غير مهيأة' };
    const req = (data.repItemTransfers || []).find(r => r.id === requestId);
    if (!req) return { success: false, error: 'الطلب غير موجود' };

    let updatedProducts = [...data.products];
    const newStockMovements = [...data.stockMovements];

    // عند الموافقة والتنفيذ: خصم المستودع الرئيسي وإضافة لسيارة/عهدة المندوب
    if (newStatus === 'executed') {
      const itemsToMove = approvedItems || req.items;
      for (const item of itemsToMove) {
        const prod = updatedProducts.find(p => p.id === item.productId);
        if (prod) {
          const qty = item.approvedQty || item.requestedQty;
          const currentSource = prod.stockPerWarehouse[req.sourceWarehouseId] || 0;
          const currentTarget = prod.stockPerWarehouse[req.targetWarehouseId] || 0;

          if (currentSource < qty && !data.settings.allowNegativeStock) {
            return {
              success: false,
              error: `الرصيد المتاح من (${prod.name}) في المستودع المصدر (${currentSource}) أقل من الكمية المطلوبة للتحويل (${qty})`,
            };
          }

          updatedProducts = updatedProducts.map(p =>
            p.id === prod.id
              ? {
                  ...p,
                  stockPerWarehouse: {
                    ...p.stockPerWarehouse,
                    [req.sourceWarehouseId]: currentSource - qty,
                    [req.targetWarehouseId]: currentTarget + qty,
                  },
                }
              : p
          );

          newStockMovements.push({
            id: generateId('SM'),
            date: new Date().toISOString().split('T')[0],
            type: 'transfer_out',
            productId: prod.id,
            productName: prod.name,
            warehouseId: req.sourceWarehouseId,
            warehouseName: req.sourceWarehouseName,
            targetWarehouseId: req.targetWarehouseId,
            targetWarehouseName: req.targetWarehouseName,
            quantity: qty,
            unitCost: prod.purchasePrice,
            referenceId: req.id,
            referenceNumber: req.requestNumber,
            notes: `تحويل عهدة بضاعة للمندوب ${req.representativeName}`,
            createdBy: currentUser?.fullName || 'الإدارة',
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    const updatedRequests = (data.repItemTransfers || []).map(r => {
      if (r.id === req.id) {
        return {
          ...r,
          status: newStatus,
          notes: notes || r.notes,
          reviewedBy: currentUser?.fullName || 'الإدارة',
          reviewedAt: new Date().toISOString(),
          executedAt: newStatus === 'executed' ? new Date().toISOString() : r.executedAt,
          items: approvedItems || r.items,
        };
      }
      return r;
    });

    const newState: DatabaseState = {
      ...data,
      products: updatedProducts,
      repItemTransfers: updatedRequests,
      stockMovements: newStockMovements,
    };
    commitDatabase(newState);

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: `تحديث طلب تحويل أصناف (${newStatus})`,
        module: 'المندوبون',
        recordId: req.id,
        details: `تحديث حالة طلب تحويل بضاعة ${req.requestNumber} إلى ${newStatus}`,
      });
    }

    return { success: true };
  };

  const createCustomerItemOrder = async (payload: Omit<CustomerItemOrderRequest, 'id' | 'requestNumber' | 'status' | 'createdAt'>) => {
    if (!data) return { success: false, error: 'قاعدة البيانات غير مهيأة' };
    if (!payload.items.length) return { success: false, error: 'أضف صنفاً واحداً على الأقل' };
    const order: CustomerItemOrderRequest = { ...payload, id: generateId('COR'), requestNumber: `COR-${String((data.customerItemOrders || []).length + 1).padStart(5, '0')}`, status: 'pending', createdAt: new Date().toISOString() };
    commitDatabase({ ...data, customerItemOrders: [order, ...(data.customerItemOrders || [])] });
    return { success: true };
  };

  const updateCustomerItemOrder = async (id: string, status: CustomerItemOrderRequest['status'], reason?: string) => {
    if (!data) return { success: false, error: 'قاعدة البيانات غير مهيأة' };
    const order = (data.customerItemOrders || []).find(x => x.id === id);
    if (!order) return { success: false, error: 'الطلب غير موجود' };
    if (order.status !== 'pending') return { success: false, error: 'تمت مراجعة هذا الطلب من قبل' };
    const updated = (data.customerItemOrders || []).map(x => x.id === id ? { ...x, status, rejectionReason: status === 'rejected' ? (reason || 'لم يحدد سبب') : undefined, reviewedAt: new Date().toISOString(), reviewedBy: currentUser?.fullName || 'الإدارة' } : x);
    commitDatabase({ ...data, customerItemOrders: updated });
    return { success: true };
  };

  // ------------------ EMPLOYEES & PAYROLL ------------------
  const addEmployee = async (emp: Omit<Employee, 'id'>) => {
    if (!data) return;
    const newEmp: Employee = {
      ...emp,
      id: generateId('EMP'),
    };
    commitDatabase({
      ...data,
      employees: [...data.employees, newEmp],
    });
  };

  const updateEmployee = async (id: string, updates: Partial<Employee>) => {
    if (!data) return;
    commitDatabase({
      ...data,
      employees: data.employees.map(e => e.id === id ? { ...e, ...updates } : e),
    });
  };

  const recordAttendance = async (attendance: Omit<AttendanceRecord, 'id'>) => {
    if (!data) return;
    const newRec: AttendanceRecord = {
      ...attendance,
      id: generateId('ATT'),
    };
    commitDatabase({
      ...data,
      attendance: [newRec, ...data.attendance],
    });
  };

  const addAdvanceDeduction = async (item: Omit<EmployeeAdvanceDeduction, 'id' | 'createdAt' | 'isSettled'>) => {
    if (!data) return;
    const newItem: EmployeeAdvanceDeduction = {
      ...item,
      id: generateId(item.type.toUpperCase()),
      isSettled: false,
      createdAt: new Date().toISOString(),
    };

    // If advance (سلفة), disburse cash from cashbox
    let updatedCashboxes = [...data.cashboxes];
    const newTransactions = [...data.financialTransactions];

    if (item.type === 'advance' && item.cashboxId) {
      const cb = updatedCashboxes.find(c => c.id === item.cashboxId);
      if (cb) {
        updatedCashboxes = updatedCashboxes.map(c => 
          c.id === cb.id ? { ...c, currentBalance: c.currentBalance - item.amount } : c
        );

        newTransactions.unshift({
          id: generateId('FT'),
          transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
          date: item.date,
          type: 'expense',
          cashboxId: cb.id,
          cashboxName: cb.name,
          amount: item.amount,
          category: 'سلفة موظف',
          partyName: item.employeeName,
          description: `صرف سلفة نقدية للموظف ${item.employeeName}: ${item.reason}`,
          createdBy: currentUser?.fullName || 'النظام',
          createdAt: new Date().toISOString(),
        });
      }
    }

    commitDatabase({
      ...data,
      advancesDeductions: [newItem, ...data.advancesDeductions],
      cashboxes: updatedCashboxes,
      financialTransactions: newTransactions,
    });
  };

  const paySalary = async (payrollData: Omit<SalaryPayroll, 'id' | 'payrollNumber'>) => {
    if (!data) return;
    const num = (data.payrolls.length + 1).toString().padStart(4, '0');
    const newPayroll: SalaryPayroll = {
      ...payrollData,
      id: generateId('PAY'),
      payrollNumber: `PAY-2026-${num}`,
    };

    let updatedCashboxes = [...data.cashboxes];
    const newTransactions = [...data.financialTransactions];

    if (payrollData.cashboxId && payrollData.netSalary > 0) {
      const cb = updatedCashboxes.find(c => c.id === payrollData.cashboxId);
      if (cb) {
        updatedCashboxes = updatedCashboxes.map(c => 
          c.id === cb.id ? { ...c, currentBalance: c.currentBalance - payrollData.netSalary } : c
        );

        newTransactions.unshift({
          id: generateId('FT'),
          transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
          date: payrollData.paidDate || new Date().toISOString().split('T')[0],
          type: 'salary_payout',
          cashboxId: cb.id,
          cashboxName: cb.name,
          amount: payrollData.netSalary,
          category: 'صرف رواتب الموظفين',
          partyName: payrollData.employeeName,
          description: `صرف راتب شهر ${payrollData.month}/${payrollData.year} للموظف ${payrollData.employeeName}`,
          notes: payrollData.notes,
          createdBy: currentUser?.fullName || 'النظام',
          createdAt: new Date().toISOString(),
        });
      }
    }

    commitDatabase({
      ...data,
      payrolls: [newPayroll, ...data.payrolls],
      cashboxes: updatedCashboxes,
      financialTransactions: newTransactions,
    });
  };

  // ------------------ USERS & SETTINGS ------------------
  const addUser = async (userData: Omit<User, 'id' | 'createdAt'>) => {
    if (!data) return;
    const newUser: User = {
      ...userData,
      id: generateId('USR'),
      createdAt: new Date().toISOString(),
    };
    commitDatabase({
      ...data,
      users: [...data.users, newUser],
    });

    if (currentUser) {
      logAuditEvent({
        userId: currentUser.id,
        userName: currentUser.fullName,
        action: 'إضافة مستخدم جديد',
        module: 'المستخدمون والصلاحيات',
        recordId: newUser.id,
        details: `إضافة حساب جديد: ${newUser.fullName} (${newUser.username}) بصلاحية ${newUser.role}`,
      });
    }
  };

  const updateUser = async (id: string, updates: Partial<User>) => {
    if (!data) return;
    commitDatabase({
      ...data,
      users: data.users.map(u => u.id === id ? { ...u, ...updates } : u),
    });
  };

  const deleteUser = async (id: string) => {
    if (!data) return;
    const user = data.users.find(u => u.id === id);
    if (user?.role === 'admin' && data.users.filter(u => u.role === 'admin').length <= 1) {
      alert('لا يمكن حذف المسؤول العام الوحيد للنظام');
      return;
    }
    commitDatabase({
      ...data,
      users: data.users.filter(u => u.id !== id),
    });
  };

  const updateSettings = async (newSettings: Partial<SystemSettings>) => {
    if (!data) return;
    commitDatabase({
      ...data,
      settings: { ...data.settings, ...newSettings },
    });
  };

  const updateServerSettings = async (newSettings: Partial<ServerConnectionSettings>) => {
    if (!data) return;
    const current = data.serverSettings || {
      serverIp: '192.168.1.100',
      hostname: 'awlad-selim-server',
      port: 3000,
      apiBaseUrl: 'http://192.168.1.100:3000',
      connectionType: 'lan',
      serverStatus: 'online',
      databaseStatus: 'connected',
      latencyMs: 14,
      syncStatus: 'connected',
      lastSuccessfulConnection: new Date().toISOString(),
    };
    commitDatabase({
      ...data,
      serverSettings: { ...current, ...newSettings },
    });
  };

  const testServerConnection = async (): Promise<{ success: boolean; latencyMs: number; error?: string }> => {
    const start = performance.now();
    try {
      const configuredBase = (data?.serverSettings?.apiBaseUrl || 'http://192.168.1.100:3000').replace(/\/$/, '');
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${configuredBase}/api/health`, { method: 'GET', signal: controller.signal, headers: { 'Accept': 'application/json' } });
      window.clearTimeout(timeout);
      const latencyMs = Math.round(performance.now() - start);
      if (res.ok) {
        if (data?.serverSettings) {
          updateServerSettings({
            serverStatus: 'online',
            databaseStatus: 'connected',
            latencyMs,
            lastSuccessfulConnection: new Date().toISOString(),
            syncStatus: 'connected',
          });
        }
        return { success: true, latencyMs };
      }
      return { success: false, latencyMs, error: 'استجاب السيرفر برمز خطأ' };
    } catch {
      const latencyMs = Math.round(performance.now() - start);
      return { success: false, latencyMs, error: 'تعذر الاتصال بالسيرفر المحدد. تأكد من عنوان IP والمنفذ وتشغيل خدمة AWLAD SELIM Server.' };
    }
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white font-['Cairo']">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-lg font-bold">جاري تحميل نظام أولاد سليم للمحاسبة...</p>
        </div>
      </div>
    );
  }

  return (
    <DataContext.Provider
      value={{
        ...data,
        networkStatus,
        lastSyncTime,
        pendingChangesCount,
        triggerManualSync,
        exportBackup,
        importBackup,
        resetSystemToFresh,
        addProduct,
        updateProduct,
        deleteProduct,
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
        addCustomer,
        updateCustomer,
        deleteCustomer,
        recordCustomerPayment,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        recordSupplierPayment,
        createSalesInvoice,
        createPurchaseInvoice,
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

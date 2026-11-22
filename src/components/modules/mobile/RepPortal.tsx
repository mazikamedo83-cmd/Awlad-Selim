import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Users, FilePlus2, FileText, Truck, Search, Plus,
  Trash2, CheckCircle2, AlertCircle, AlertTriangle, Phone, MapPin,
  History, ShieldAlert, RefreshCw, Share2, FileDown, Boxes, ArrowLeftRight,
  CloudOff, CloudCheck, Camera, ShoppingBag, RotateCcw, ArrowDownCircle,
  ArrowUpCircle, UserPlus, Building2, Receipt, CreditCard, FileSpreadsheet,
  Wallet, Settings, LogOut, ChevronLeft, Lock, Warehouse as WarehouseIcon,
  Barcode, X, Eye, Calculator, ClipboardCheck
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import {
  Customer,
  CustomerItemOrderRequest,
  CustomerPriceHistoryEntry,
  Invoice,
  InvoiceReturn,
  RepCustodyStatementResponse,
} from '../../../types';
import { exportHtmlToPdf } from '../../common/PdfExporter';
import { getCurrentLocationSafe, isNativeCapacitor, parseLatLngCoords, reverseGeocodeCoords } from '../../../services/native';
import { QuantityInput } from '../../common/QuantityInput';
import { computeLineTotal } from '../../../utils/quantity';
import { compressImageFileToDataUrl } from '../../../utils/image';
import { RefreshSyncScreen } from './RefreshSyncScreen';

const REP_ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'جديد',
  under_review: 'قيد المراجعة',
  approved: 'مقبول',
  invoiced: 'مفوتر',
  preparing: 'قيد التجهيز',
  rep_assigned: 'تم تعيين مندوب',
  out_for_delivery: 'جاري التوصيل',
  delivered: 'تم التسليم',
  collected: 'تم التحصيل',
  closed: 'مغلق',
  needs_review: 'يحتاج مراجعة',
  rejected: 'مرفوض',
  cancelled: 'ملغى',
};

export type RepTabKey =
  | 'home'
  | 'cash'
  | 'more'
  | 'new-invoice'
  | 'new-purchase'
  | 'sales-return'
  | 'purchase-return'
  | 'cash-deposit'
  | 'cash-withdrawal'
  | 'custody-transfer'
  | 'new-customer'
  | 'new-supplier'
  | 'refresh'
  | 'cheques-installments'
  | 'new-quote'
  | 'customers'
  | 'orders'
  | 'invoices'
  | 'purchases-list'
  | 'sales-returns-list'
  | 'purchase-returns-list'
  | 'custody';

interface RepPortalProps {
  activeTab: RepTabKey;
  onTabChange: (tab: RepTabKey) => void;
  onOpenServerModal?: () => void;
  onLogout?: () => void;
  onUnsavedInvoiceChange?: (dirty: boolean) => void;
}

export const RepPortal: React.FC<RepPortalProps> = ({
  activeTab,
  onTabChange,
  onOpenServerModal,
  onLogout,
  onUnsavedInvoiceChange,
}) => {
  const { currentUser, representativeProfile, mobileConfig, hasPermission } = useAuth();
  const data = useData();
  const isNative = isNativeCapacitor();

  const isAdmin = currentUser?.role === 'admin';
  const canSales = isAdmin || hasPermission('canManageSales');
  const canPurchases = isAdmin || hasPermission('canManagePurchases');
  const canCashOps = isAdmin || hasPermission('canManageCashboxes') || hasPermission('canManageAccounts');
  const canTransfers = isAdmin || hasPermission('canManageTransfers') || canSales;
  const canCash = canCashOps || canTransfers;
  const canAccounts = isAdmin || hasPermission('canManageAccounts') || canSales;
  const canInventory = isAdmin || hasPermission('canManageInventory') || canTransfers;
  const canAddCustomer = isAdmin || canSales || hasPermission('canAdd');

  const rep =
    representativeProfile ||
    data.representatives.find(
      (r) =>
        (r.userId && r.userId === currentUser?.id) ||
        r.name === currentUser?.fullName
    ) ||
    null;

  const vanWarehouse = useMemo(() => {
    if (!rep) return data.warehouses[0] || null;
    return (
      data.warehouses.find((w) => w.name.includes(rep.name) || w.managerName === rep.name) ||
      data.warehouses.find((w) => !w.isDefault) ||
      data.warehouses[0] ||
      null
    );
  }, [data.warehouses, rep]);

  const mainWarehouse = useMemo(() => {
    return data.warehouses.find((w) => w.isDefault) || data.warehouses[0] || null;
  }, [data.warehouses]);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');

  // ==================== 1. SALES INVOICE STATE (preserved across tab switches) ====================
  const [invCustomerId, setInvCustomerId] = useState<string>('');
  const [invWarehouseId, setInvWarehouseId] = useState<string>('');
  const [invProductId, setInvProductId] = useState<string>('');
  const [invProdQuery, setInvProdQuery] = useState<string>('');
  const [invOnlyVanStock, setInvOnlyVanStock] = useState<boolean>(false);
  const [invUnitName, setInvUnitName] = useState<string>('');
  const [invQty, setInvQty] = useState<number>(1);
  const [invPrice, setInvPrice] = useState<number>(0);
  const [invLineDiscount, setInvLineDiscount] = useState<number>(0);
  const [invPaymentType, setInvPaymentType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [invPaidAmount, setInvPaidAmount] = useState<number>(0);
  const [invCashboxId, setInvCashboxId] = useState<string>(data.cashboxes[0]?.id || 'CASH-01');
  const [invNotes, setInvNotes] = useState<string>('');
  const [invItems, setInvItems] = useState<Array<{
    productId: string;
    productName: string;
    barcode: string;
    unit: string;
    unitFactor: number;
    quantity: number;
    unitPrice: number;
    purchasePriceAtTime: number;
    discount: number;
    total: number;
  }>>([]);
  const [priceHistoryMap, setPriceHistoryMap] = useState<Record<string, CustomerPriceHistoryEntry[]>>({});
  const [isSubmittingInvoice, setIsSubmittingInvoice] = useState(false);
  const [pendingLeaveTab, setPendingLeaveTab] = useState<RepTabKey | null>(null);
  const [selectedCustomerDetail, setSelectedCustomerDetail] = useState<Customer | null>(null);
  const [actualDrawerCash, setActualDrawerCash] = useState<string>('');

  // ==================== 2. PURCHASE INVOICE STATE ====================
  const [purSupplierId, setPurSupplierId] = useState<string>('');
  const [purWarehouseId, setPurWarehouseId] = useState<string>('');
  const [purProductId, setPurProductId] = useState<string>('');
  const [purUnitName, setPurUnitName] = useState<string>('');
  const [purQty, setPurQty] = useState<number>(1);
  const [purPrice, setPurPrice] = useState<number>(0);
  const [purPaymentType, setPurPaymentType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [purPaidAmount, setPurPaidAmount] = useState<number>(0);
  const [purCashboxId, setPurCashboxId] = useState<string>(data.cashboxes[0]?.id || 'CASH-01');
  const [purNotes, setPurNotes] = useState<string>('');
  const [purItems, setPurItems] = useState<Array<{
    productId: string;
    productName: string;
    barcode: string;
    unit: string;
    unitFactor: number;
    quantity: number;
    unitPrice: number;
    purchasePriceAtTime: number;
    discount: number;
    total: number;
  }>>([]);
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);

  // ==================== 3. RETURNS STATE (Sales Return & Purchase Return) ====================
  const [sRetCustomerId, setSRetCustomerId] = useState('');
  const [sRetInvoiceId, setSRetInvoiceId] = useState('');
  const [sRetWarehouseId, setSRetWarehouseId] = useState('');
  const [sRetProductId, setSRetProductId] = useState('');
  const [sRetQty, setSRetQty] = useState(1);
  const [sRetPrice, setSRetPrice] = useState(0);
  const [sRetSettlement, setSRetSettlement] = useState<'account' | 'cash'>('account');
  const [sRetCashboxId, setSRetCashboxId] = useState(data.cashboxes[0]?.id || 'CASH-01');
  const [sRetReason, setSRetReason] = useState('');
  const [sRetItems, setSRetItems] = useState<Array<{
    productId: string;
    productName: string;
    unit: string;
    unitFactor: number;
    quantity: number;
    unitPrice: number;
    total: number;
  }>>([]);
  const [isSubmittingSRet, setIsSubmittingSRet] = useState(false);

  const [pRetSupplierId, setPRetSupplierId] = useState('');
  const [pRetInvoiceId, setPRetInvoiceId] = useState('');
  const [pRetWarehouseId, setPRetWarehouseId] = useState('');
  const [pRetProductId, setPRetProductId] = useState('');
  const [pRetQty, setPRetQty] = useState(1);
  const [pRetPrice, setPRetPrice] = useState(0);
  const [pRetSettlement, setPRetSettlement] = useState<'account' | 'cash'>('account');
  const [pRetCashboxId, setPRetCashboxId] = useState(data.cashboxes[0]?.id || 'CASH-01');
  const [pRetReason, setPRetReason] = useState('');
  const [pRetItems, setPRetItems] = useState<Array<{
    productId: string;
    productName: string;
    unit: string;
    unitFactor: number;
    quantity: number;
    unitPrice: number;
    total: number;
  }>>([]);
  const [isSubmittingPRet, setIsSubmittingPRet] = useState(false);

  // ==================== 4. CASH DEPOSIT & WITHDRAWAL STATE ====================
  const [depMode, setDepMode] = useState<'customer_collection' | 'cashbox_deposit'>('customer_collection');
  const [depCustomerId, setDepCustomerId] = useState('');
  const [depCashboxId, setDepCashboxId] = useState(data.cashboxes[0]?.id || 'CASH-01');
  const [depMethod, setDepMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [depAmount, setDepAmount] = useState<number>(0);
  const [depNotes, setDepNotes] = useState('');
  const [isSubmittingDeposit, setIsSubmittingDeposit] = useState(false);

  const [wdCashboxId, setWdCashboxId] = useState(data.cashboxes[0]?.id || 'CASH-01');
  const [wdCategory, setWdCategory] = useState('مصروف تشغيل ومندوب');
  const [wdBeneficiary, setWdBeneficiary] = useState('');
  const [wdAmount, setWdAmount] = useState<number>(0);
  const [wdNotes, setWdNotes] = useState('');
  const [isSubmittingWithdrawal, setIsSubmittingWithdrawal] = useState(false);

  // ==================== 5. NEW CUSTOMER & NEW SUPPLIER STATE ====================
  const [newCustName, setNewCustName] = useState('');
  const [newCustShop, setNewCustShop] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustArea, setNewCustArea] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustGeo, setNewCustGeo] = useState('');
  const [newCustOpening, setNewCustOpening] = useState<number>(0);
  const [isLocatingCust, setIsLocatingCust] = useState(false);
  const [custPhoneNotice, setCustPhoneNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [custMapNotice, setCustMapNotice] = useState<string | null>(null);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);

  const [newSupName, setNewSupName] = useState('');
  const [newSupCompany, setNewSupCompany] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupAddress, setNewSupAddress] = useState('');
  const [newSupOpening, setNewSupOpening] = useState<number>(0);
  const [supPhoneNotice, setSupPhoneNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);

  // ==================== 6. PRICE QUOTES STATE ====================
  const [quoteCustomerId, setQuoteCustomerId] = useState('');
  const [quoteProductId, setQuoteProductId] = useState('');
  const [quoteUnitName, setQuoteUnitName] = useState('');
  const [quoteQty, setQuoteQty] = useState(1);
  const [quotePrice, setQuotePrice] = useState(0);
  const [quoteNotes, setQuoteNotes] = useState('');
  const [quoteItems, setQuoteItems] = useState<Array<{
    productId: string;
    productName: string;
    barcode: string;
    unit: string;
    unitFactor: number;
    quantity: number;
    unitPrice: number;
    purchasePriceAtTime: number;
    discount: number;
    total: number;
  }>>([]);
  const [isSubmittingQuote, setIsSubmittingQuote] = useState(false);
  const [convertingQuoteId, setConvertingQuoteId] = useState<string | null>(null);

  // ==================== 7. CHEQUES & INSTALLMENTS STATE ====================
  const [chqTab, setChqTab] = useState<'cheques' | 'installments'>('cheques');
  const [chqType, setChqType] = useState<'incoming' | 'outgoing'>('incoming');
  const [chqNumber, setChqNumber] = useState('');
  const [chqBank, setChqBank] = useState('');
  const [chqPartyName, setChqPartyName] = useState('');
  const [chqAmount, setChqAmount] = useState<number>(0);
  const [chqDueDate, setChqDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSavingCheque, setIsSavingCheque] = useState(false);
  const [payingInstKey, setPayingInstKey] = useState<string | null>(null);

  // ==================== 8. CUSTODY & TRANSFERS STATE ====================
  const [custodySubTab, setCustodySubTab] = useState<'van' | 'items' | 'deliver' | 'return' | 'cash'>('van');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [custodyStatement, setCustodyStatement] = useState<RepCustodyStatementResponse | null>(null);
  const [isLoadingCustodyStmt, setIsLoadingCustodyStmt] = useState(false);
  const [reqProdId, setReqProdId] = useState('');
  const [reqQty, setReqQty] = useState(5);
  const [reqItems, setReqItems] = useState<Array<{
    productId: string;
    productName: string;
    unit: string;
    requestedQty: number;
    availableInVanQty: number;
    shortageQty: number;
  }>>([]);
  const [delivCustomerId, setDelivCustomerId] = useState('');
  const [delivProdId, setDelivProdId] = useState('');
  const [delivQty, setDelivQty] = useState(1);
  const [delivNotes, setDelivNotes] = useState('');
  const [retCustodyProdId, setRetCustodyProdId] = useState('');
  const [retCustodyUnit, setRetCustodyUnit] = useState('');
  const [retCustodyQty, setRetCustodyQty] = useState(1);
  const [retCustodyTargetWhId, setRetCustodyTargetWhId] = useState('');
  const [retCustodyNotes, setRetCustodyNotes] = useState('');
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [cashNotes, setCashNotes] = useState<string>('');
  const [isSendingTransfer, setIsSendingTransfer] = useState(false);

  // ==================== 9. REPRESENTATIVE PURCHASE ORDER & DELIVERY ====================
  const [ordCustomerId, setOrdCustomerId] = useState<string>('');
  const [ordProductId, setOrdProductId] = useState<string>('');
  const [ordUnitName, setOrdUnitName] = useState<string>('');
  const [ordQty, setOrdQty] = useState<number>(1);
  const [ordPrice, setOrdPrice] = useState<number>(0);
  const [ordNotes, setOrdNotes] = useState<string>('');
  const [ordItems, setOrdItems] = useState<
    Array<{
      productId: string;
      productCode: string;
      productName: string;
      productImage?: string;
      unit: string;
      unitFactor: number;
      quantity: number;
      unitPrice: number;
    }>
  >([]);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  const [deliveringOrder, setDeliveringOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [deliveryCollectedAmount, setDeliveryCollectedAmount] = useState<number>(0);
  const [deliveryCashboxId, setDeliveryCashboxId] = useState<string>(data.cashboxes[0]?.id || 'CASH-01');
  const [deliveryMethod, setDeliveryMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [deliveryNotes, setDeliveryNotes] = useState<string>('');
  const [deliveryProof, setDeliveryProof] = useState<string>('');
  const [isUpdatingDelivery, setIsUpdatingDelivery] = useState(false);

  useEffect(() => {
    if (!invWarehouseId && vanWarehouse?.id) setInvWarehouseId(vanWarehouse.id);
    if (!purWarehouseId && mainWarehouse?.id) setPurWarehouseId(mainWarehouse.id);
    if (!sRetWarehouseId && (vanWarehouse?.id || mainWarehouse?.id)) {
      setSRetWarehouseId(vanWarehouse?.id || mainWarehouse?.id || '');
    }
    if (!pRetWarehouseId && mainWarehouse?.id) setPRetWarehouseId(mainWarehouse.id);
    const defaultCb = data.cashboxes[0]?.id;
    if (defaultCb) {
      if (!invCashboxId) setInvCashboxId(defaultCb);
      if (!purCashboxId) setPurCashboxId(defaultCb);
      if (!sRetCashboxId) setSRetCashboxId(defaultCb);
      if (!pRetCashboxId) setPRetCashboxId(defaultCb);
      if (!depCashboxId) setDepCashboxId(defaultCb);
      if (!wdCashboxId) setWdCashboxId(defaultCb);
      if (!deliveryCashboxId) setDeliveryCashboxId(defaultCb);
    }
  }, [
    vanWarehouse?.id,
    mainWarehouse?.id,
    invWarehouseId,
    purWarehouseId,
    sRetWarehouseId,
    pRetWarehouseId,
    data.cashboxes,
    invCashboxId,
    purCashboxId,
    sRetCashboxId,
    pRetCashboxId,
    depCashboxId,
    wdCashboxId,
    deliveryCashboxId,
  ]);

  useEffect(() => {
    let active = true;
    if (!invCustomerId) {
      setPriceHistoryMap({});
      return;
    }
    data.getCustomerPriceHistory(invCustomerId).then((res) => {
      if (active) setPriceHistoryMap(res);
    });
    return () => {
      active = false;
    };
  }, [invCustomerId, data.getCustomerPriceHistory]);

  useEffect(() => {
    onUnsavedInvoiceChange?.(activeTab === 'new-invoice' && invItems.length > 0);
  }, [activeTab, invItems.length, onUnsavedInvoiceChange]);

  const loadCustodyStatement = useCallback(async () => {
    setIsLoadingCustodyStmt(true);
    const res = await data.getRepCustodyStatement(rep?.id);
    setIsLoadingCustodyStmt(false);
    if (res.success && res.statement) {
      setCustodyStatement(res.statement);
    }
  }, [data.getRepCustodyStatement, rep?.id]);

  useEffect(() => {
    if (activeTab === 'custody' || activeTab === 'custody-transfer') {
      loadCustodyStatement();
    }
  }, [activeTab, loadCustodyStatement]);

  useEffect(() => {
    if (!retCustodyTargetWhId && mainWarehouse?.id) {
      setRetCustodyTargetWhId(mainWarehouse.id);
    }
  }, [retCustodyTargetWhId, mainWarehouse?.id]);

  const activeProducts = useMemo(
    () => data.products.filter((p) => p.status === 'active'),
    [data.products]
  );

  const selectedProduct = useMemo(
    () => activeProducts.find((p) => p.id === invProductId) || null,
    [activeProducts, invProductId]
  );

  const selectedProdLastPrices = useMemo(() => {
    if (!invProductId) return [];
    const list = priceHistoryMap[invProductId] || [];
    return list.slice(-3);
  }, [priceHistoryMap, invProductId]);

  const effectiveVanId = invWarehouseId || vanWarehouse?.id || '';

  const normalizeSearch = (val: string) =>
    String(val || '')
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[\u064B-\u065F]/g, '')
      .trim();

  const filteredInvoiceProducts = useMemo(() => {
    const q = normalizeSearch(invProdQuery);
    return activeProducts.filter((p) => {
      if (invOnlyVanStock && (p.stockPerWarehouse?.[effectiveVanId] || 0) <= 0) return false;
      if (!q) return true;
      return normalizeSearch(`${p.name} ${p.code} ${p.barcode || ''} ${p.category || ''}`).includes(q);
    });
  }, [activeProducts, invProdQuery, invOnlyVanStock, effectiveVanId]);

  const handleSelectProduct = (prodId: string) => {
    setInvProductId(prodId);
    const prod = activeProducts.find((p) => p.id === prodId);
    if (!prod) return;
    if (prod.units && prod.units.length > 0) {
      setInvUnitName(prod.units[0].name);
      setInvPrice(prod.units[0].sellingPrice);
    } else {
      setInvUnitName(prod.baseUnit);
      setInvPrice(prod.sellingPrice);
    }
    setInvQty(1);
    setInvLineDiscount(0);
  };

  const handleInvoiceSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = invProdQuery.trim();
    if (!raw) return;
    const exactMatch = activeProducts.find(
      (p) =>
        p.barcode === raw ||
        p.code.toLowerCase() === raw.toLowerCase()
    );
    if (exactMatch) {
      handleSelectProduct(exactMatch.id);
      setInvProdQuery('');
      return;
    }
    if (filteredInvoiceProducts.length === 1) {
      handleSelectProduct(filteredInvoiceProducts[0].id);
      setInvProdQuery('');
    }
  };

  const handleUnitChange = (unitName: string) => {
    setInvUnitName(unitName);
    if (!selectedProduct) return;
    if (unitName === selectedProduct.baseUnit) {
      setInvPrice(selectedProduct.sellingPrice);
    } else {
      const u = selectedProduct.units.find((x) => x.name === unitName);
      if (u) setInvPrice(u.sellingPrice);
    }
  };

  const handleAddInvoiceItem = () => {
    if (!selectedProduct || invQty <= 0) return;
    let unitFactor = 1;
    let purchasePriceAtTime = selectedProduct.purchasePrice;
    if (invUnitName !== selectedProduct.baseUnit) {
      const u = selectedProduct.units.find((x) => x.name === invUnitName);
      if (u) {
        unitFactor = u.conversionFactor;
        purchasePriceAtTime = u.purchasePrice || selectedProduct.purchasePrice * unitFactor;
      }
    }
    const safeDiscount = Math.max(0, Number(invLineDiscount || 0));
    const total = computeLineTotal(invQty, invPrice, safeDiscount);
    setInvItems((prev) => [
      ...prev,
      {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        barcode: selectedProduct.barcode,
        unit: invUnitName || selectedProduct.baseUnit,
        unitFactor,
        quantity: invQty,
        unitPrice: invPrice,
        purchasePriceAtTime,
        discount: safeDiscount,
        total,
      },
    ]);
    setInvProductId('');
    setInvProdQuery('');
    setInvQty(1);
    setInvPrice(0);
    setInvLineDiscount(0);
  };

  const handleUpdateInvItemQty = (idx: number, nextQty: number) => {
    setInvItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              ...it,
              quantity: nextQty,
              total: computeLineTotal(nextQty, it.unitPrice, it.discount || 0),
            }
          : it
      )
    );
  };

  const invGrandTotal = useMemo(
    () => invItems.reduce((sum, it) => sum + it.total, 0),
    [invItems]
  );

  // Van Custody Guard: sum requested quantities per productId and compare strictly to van warehouse custody balance
  const shortageItems = useMemo(() => {
    const requestedByProd = new Map<string, { name: string; unit: string; requested: number; avail: number }>();
    for (const it of invItems) {
      const prod = activeProducts.find((p) => p.id === it.productId);
      if (!prod) continue;
      const avail = prod.stockPerWarehouse?.[effectiveVanId] || 0;
      const reqBase = it.quantity * (it.unitFactor || 1);
      const prev = requestedByProd.get(it.productId);
      requestedByProd.set(it.productId, {
        name: it.productName,
        unit: prod.baseUnit,
        requested: (prev?.requested || 0) + reqBase,
        avail,
      });
    }
    const out: Array<{
      productId: string;
      productName: string;
      unit: string;
      requestedQty: number;
      availableInVanQty: number;
      shortageQty: number;
    }> = [];
    for (const [productId, entry] of requestedByProd.entries()) {
      if (entry.avail < entry.requested) {
        out.push({
          productId,
          productName: entry.name,
          unit: entry.unit,
          requestedQty: entry.requested,
          availableInVanQty: entry.avail,
          shortageQty: entry.requested - entry.avail,
        });
      }
    }
    return out;
  }, [invItems, activeProducts, effectiveVanId]);

  const handleCreateInvoice = async (mode: 'confirmed' | 'draft_with_transfer' | 'draft') => {
    if (!invCustomerId) {
      setFeedback({ type: 'error', text: 'يرجى اختيار العميل أولاً.' });
      return;
    }
    if (!invItems.length) {
      setFeedback({ type: 'error', text: 'يرجى إضافة صنف واحد على الأقل للفاتورة.' });
      return;
    }
    if (!rep) {
      setFeedback({ type: 'error', text: 'حسابك غير مرتبط بملف مندوب نشط.' });
      return;
    }
    if (mode === 'confirmed' && shortageItems.length > 0) {
      setFeedback({
        type: 'error',
        text: 'لا يمكن اعتماد فاتورة بيع بكمية تتجاوز مخزون عهدة السيارة. اطلب تحويل الأصناف أو احفظها كمسودة.',
      });
      return;
    }

    const cust = data.customers.find((c) => c.id === invCustomerId);
    const wh = data.warehouses.find((w) => w.id === effectiveVanId) || vanWarehouse;
    const paid =
      invPaymentType === 'cash'
        ? invGrandTotal
        : invPaymentType === 'credit'
        ? 0
        : Math.min(invGrandTotal, Math.max(0, invPaidAmount));

    const forceDraft = shortageItems.length > 0 || mode !== 'confirmed';

    setIsSubmittingInvoice(true);
    setFeedback(null);
    const res = await data.createSalesInvoice({
      date: new Date().toISOString().split('T')[0],
      customerId: invCustomerId,
      customerName: cust?.name || 'عميل',
      representativeId: rep.id,
      representativeName: rep.name,
      warehouseId: effectiveVanId,
      warehouseName: wh?.name || `سيارة المندوب (${rep.name})`,
      items: invItems,
      subtotal: invGrandTotal,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: invGrandTotal,
      paidAmount: paid,
      remainingAmount: Math.max(0, invGrandTotal - paid),
      paymentType: invPaymentType,
      paymentMethod: 'cash',
      cashboxId: invCashboxId,
      status: forceDraft ? 'draft' : 'confirmed',
      notes: invNotes.trim() || undefined,
    });

    if (!res.success || !res.invoice) {
      setIsSubmittingInvoice(false);
      setFeedback({ type: 'error', text: res.error || 'تعذر حفظ الفاتورة' });
      return;
    }

    if (mode === 'draft_with_transfer' && shortageItems.length > 0 && mainWarehouse) {
      const trRes = await data.createRepItemTransfer({
        date: new Date().toISOString().split('T')[0],
        representativeId: rep.id,
        representativeName: rep.name,
        invoiceId: res.invoice.id,
        invoiceNumber: res.invoice.invoiceNumber,
        sourceWarehouseId: mainWarehouse.id,
        sourceWarehouseName: mainWarehouse.name,
        targetWarehouseId: effectiveVanId,
        targetWarehouseName: wh?.name || `سيارة المندوب (${rep.name})`,
        items: shortageItems.map((sh) => ({
          productId: sh.productId,
          productName: sh.productName,
          unit: sh.unit,
          requestedQty: sh.shortageQty,
          availableInVanQty: sh.availableInVanQty,
          shortageQty: sh.shortageQty,
        })),
        notes: `طلب تحويل عجز آلي مرتبط بمسودة فاتورة ${res.invoice.invoiceNumber}`,
      });
      setIsSubmittingInvoice(false);
      setInvItems([]);
      setInvNotes('');
      setFeedback({
        type: trRes.success ? 'success' : 'warning',
        text: trRes.success
          ? `تم حفظ الفاتورة كمسودة (${res.invoice.invoiceNumber}) وإرسال طلب التحويل رقم ${trRes.request?.requestNumber || ''} للإدارة.`
          : `تم حفظ الفاتورة كمسودة (${res.invoice.invoiceNumber}) لكن تعذر إرسال طلب التحويل: ${trRes.error}`,
      });
      onTabChange('invoices');
      return;
    }

    setIsSubmittingInvoice(false);
    setInvItems([]);
    setInvNotes('');
    setFeedback({
      type: res.queuedOffline ? 'warning' : 'success',
      text: res.queuedOffline
        ? `تم حفظ الفاتورة محلياً (${res.invoice.invoiceNumber}) في طابور المزامنة بانتظار الإرسال من REFRESH.`
        : forceDraft
        ? `تم حفظ الفاتورة كمسودة (${res.invoice.invoiceNumber}).`
        : `تم اعتماد وإصدار الفاتورة (${res.invoice.invoiceNumber}) فوراً وإدراجها لمراجعة الإدارة.`,
    });
    onTabChange('invoices');
  };

  // ==================== PURCHASE INVOICE HANDLERS ====================
  const purTotal = useMemo(() => purItems.reduce((s, i) => s + i.total, 0), [purItems]);

  const handleSelectPurProduct = (prodId: string) => {
    setPurProductId(prodId);
    const prod = activeProducts.find((p) => p.id === prodId);
    if (!prod) return;
    setPurUnitName(prod.baseUnit);
    setPurPrice(prod.purchasePrice);
    setPurQty(1);
  };

  const handleAddPurItem = () => {
    const prod = activeProducts.find((p) => p.id === purProductId);
    if (!prod || purQty <= 0) return;
    let factor = 1;
    if (purUnitName !== prod.baseUnit) {
      const u = prod.units.find((x) => x.name === purUnitName);
      if (u) factor = u.conversionFactor;
    }
    setPurItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        barcode: prod.barcode,
        unit: purUnitName || prod.baseUnit,
        unitFactor: factor,
        quantity: purQty,
        unitPrice: purPrice,
        purchasePriceAtTime: purPrice,
        discount: 0,
        total: computeLineTotal(purQty, purPrice),
      },
    ]);
    setPurProductId('');
    setPurQty(1);
    setPurPrice(0);
  };

  const handleCreatePurchaseInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purSupplierId || !purItems.length) {
      setFeedback({ type: 'error', text: 'يرجى اختيار المورد وإضافة صنف واحد على الأقل.' });
      return;
    }
    const sup = data.suppliers.find((s) => s.id === purSupplierId);
    const whId = purWarehouseId || mainWarehouse?.id || vanWarehouse?.id || '';
    const wh = data.warehouses.find((w) => w.id === whId);
    const paid =
      purPaymentType === 'cash'
        ? purTotal
        : purPaymentType === 'credit'
        ? 0
        : Math.min(purTotal, Math.max(0, purPaidAmount));

    setIsSubmittingPurchase(true);
    setFeedback(null);
    const res = await data.createPurchaseInvoice({
      date: new Date().toISOString().split('T')[0],
      supplierId: purSupplierId,
      supplierName: sup?.name || 'مورد',
      representativeId: rep?.id,
      representativeName: rep?.name,
      warehouseId: whId,
      warehouseName: wh?.name || 'المخزن الرئيسي',
      items: purItems,
      subtotal: purTotal,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: purTotal,
      paidAmount: paid,
      remainingAmount: Math.max(0, purTotal - paid),
      paymentType: purPaymentType,
      paymentMethod: 'cash',
      cashboxId: purCashboxId,
      status: 'confirmed',
      notes: purNotes.trim() || undefined,
    });
    setIsSubmittingPurchase(false);
    if (res.success) {
      setPurItems([]);
      setPurNotes('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? `تم حفظ فاتورة الشراء (${res.invoice?.invoiceNumber || ''}) محلياً بانتظار المزامنة.`
          : `تم تسجيل فاتورة الشراء (${res.invoice?.invoiceNumber || ''}) بنجاح.`,
      });
      onTabChange('purchases-list');
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر حفظ فاتورة الشراء' });
    }
  };

  // ==================== RETURNS HANDLERS ====================
  const sRetTotal = useMemo(() => sRetItems.reduce((s, i) => s + i.total, 0), [sRetItems]);
  const pRetTotal = useMemo(() => pRetItems.reduce((s, i) => s + i.total, 0), [pRetItems]);

  const handleSubmitSalesReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sRetCustomerId || !sRetItems.length) {
      setFeedback({ type: 'error', text: 'يرجى اختيار العميل وإضافة صنف للمرتجع.' });
      return;
    }
    const cust = data.customers.find((c) => c.id === sRetCustomerId);
    const whId = sRetWarehouseId || effectiveVanId;
    const wh = data.warehouses.find((w) => w.id === whId);
    const inv = data.invoices.find((i) => i.id === sRetInvoiceId);
    setIsSubmittingSRet(true);
    setFeedback(null);
    const res = await data.createReturn({
      type: 'sales_return',
      date: new Date().toISOString().split('T')[0],
      originalInvoiceId: inv?.id || '',
      originalInvoiceNumber: inv?.invoiceNumber || '',
      partyId: sRetCustomerId,
      partyName: cust?.name || 'عميل',
      warehouseId: whId,
      warehouseName: wh?.name || 'سيارة المندوب',
      items: sRetItems,
      grandTotal: sRetTotal,
      refundType: sRetSettlement === 'cash' ? 'cash' : 'balance',
      cashboxId: sRetSettlement === 'cash' ? sRetCashboxId : undefined,
      reason: sRetReason.trim() || 'مرتجع مبيعات من المندوب',
    });
    setIsSubmittingSRet(false);
    if (res.success) {
      setSRetItems([]);
      setSRetReason('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? 'تم حفظ مرتجع البيع محلياً في طابور المزامنة.'
          : 'تم تسجيل مرتجع البيع وتحديث المخزون وحساب العميل.',
      });
      onTabChange('sales-returns-list');
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر تسجيل مرتجع البيع' });
    }
  };

  const handleSubmitPurchaseReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pRetSupplierId || !pRetItems.length) {
      setFeedback({ type: 'error', text: 'يرجى اختيار المورد وإضافة صنف لمرتجع الشراء.' });
      return;
    }
    const sup = data.suppliers.find((s) => s.id === pRetSupplierId);
    const whId = pRetWarehouseId || mainWarehouse?.id || effectiveVanId;
    const wh = data.warehouses.find((w) => w.id === whId);
    const inv = data.invoices.find((i) => i.id === pRetInvoiceId);
    setIsSubmittingPRet(true);
    setFeedback(null);
    const res = await data.createReturn({
      type: 'purchase_return',
      date: new Date().toISOString().split('T')[0],
      originalInvoiceId: inv?.id || '',
      originalInvoiceNumber: inv?.invoiceNumber || '',
      partyId: pRetSupplierId,
      partyName: sup?.name || 'مورد',
      warehouseId: whId,
      warehouseName: wh?.name || 'المخزن الرئيسي',
      items: pRetItems,
      grandTotal: pRetTotal,
      refundType: pRetSettlement === 'cash' ? 'cash' : 'balance',
      cashboxId: pRetSettlement === 'cash' ? pRetCashboxId : undefined,
      reason: pRetReason.trim() || 'مرتجع مشتريات للمورد',
    });
    setIsSubmittingPRet(false);
    if (res.success) {
      setPRetItems([]);
      setPRetReason('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? 'تم حفظ مرتجع الشراء محلياً في طابور المزامنة.'
          : 'تم تسجيل مرتجع المشتريات وتحديث المخزون وحساب المورد.',
      });
      onTabChange('purchase-returns-list');
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر تسجيل مرتجع الشراء' });
    }
  };

  // ==================== CASH DEPOSIT / WITHDRAWAL HANDLERS ====================
  const handleSubmitCashDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (depAmount <= 0) {
      setFeedback({ type: 'error', text: 'يرجى إدخال مبلغ صحيح أكبر من الصفر.' });
      return;
    }
    setIsSubmittingDeposit(true);
    setFeedback(null);
    try {
      if (depMode === 'customer_collection') {
        if (!depCustomerId) {
          setFeedback({ type: 'error', text: 'يرجى اختيار العميل للتحصيل منه.' });
          return;
        }
        const res = await data.recordCustomerPayment(
          depCustomerId,
          depAmount,
          depCashboxId,
          depNotes.trim() || 'تحصيل نقدي عبر تطبيق المندوب',
          depMethod
        );
        if (res.success) {
          setDepAmount(0);
          setDepNotes('');
          setFeedback({
            type: res.queuedOffline ? 'warning' : 'success',
            text: res.queuedOffline
              ? 'تم حفظ التحصيل محلياً بانتظار المزامنة.'
              : 'تم تسجيل الإيداع / تحصيل العميل وتحديث الرصيد.',
          });
        } else {
          setFeedback({ type: 'error', text: res.error || 'تعذر تسجيل التحصيل' });
        }
      } else {
        const res = await data.executeCashOperation({
          type: 'cash_deposit',
          cashboxId: depCashboxId,
          amount: depAmount,
          date: new Date().toISOString().split('T')[0],
          category: 'إيداع نقدي',
          recipientOrPayer: rep?.name || currentUser?.fullName || 'المندوب',
          notes: depNotes.trim() || 'إيداع نقدي من الشاشة الرئيسية',
        });
        if (res.success) {
          setDepAmount(0);
          setDepNotes('');
          setFeedback({
            type: res.queuedOffline ? 'warning' : 'success',
            text: res.queuedOffline
              ? 'تم حفظ الإيداع النقدي محلياً في طابور المزامنة بانتظار الإرسال.'
              : 'تم تسجيل الإيداع النقدي بالخزينة بنجاح.',
          });
        } else {
          setFeedback({ type: 'error', text: res.error || 'تعذر تسجيل الإيداع النقدي' });
        }
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر تسجيل الإيداع النقدي' });
    } finally {
      setIsSubmittingDeposit(false);
    }
  };

  const handleSubmitCashWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (wdAmount <= 0) {
      setFeedback({ type: 'error', text: 'يرجى إدخال مبلغ سحب صحيح أكبر من الصفر.' });
      return;
    }
    setIsSubmittingWithdrawal(true);
    setFeedback(null);
    try {
      const res = await data.executeCashOperation({
        type: 'expense',
        cashboxId: wdCashboxId,
        amount: wdAmount,
        date: new Date().toISOString().split('T')[0],
        category: wdCategory.trim() || 'سحب نقدي ومصروفات',
        recipientOrPayer: wdBeneficiary.trim() || rep?.name || currentUser?.fullName || '',
        notes: wdNotes.trim() || 'سحب نقدي عبر تطبيق المندوب',
      });
      if (res.success) {
        setWdAmount(0);
        setWdNotes('');
        setFeedback({
          type: res.queuedOffline ? 'warning' : 'success',
          text: res.queuedOffline
            ? 'تم حفظ السحب / المصروف محلياً في طابور المزامنة بانتظار الإرسال.'
            : 'تم تسجيل السحب / المصروف النقدي بنجاح.',
        });
      } else {
        setFeedback({ type: 'error', text: res.error || 'تعذر تسجيل السحب النقدي' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر تسجيل السحب النقدي' });
    } finally {
      setIsSubmittingWithdrawal(false);
    }
  };

  // ==================== NEW CUSTOMER & SUPPLIER HANDLERS ====================
  const handleCaptureCustLocation = async () => {
    setIsLocatingCust(true);
    try {
      const res = await getCurrentLocationSafe();
      if (res.ok && res.coords) {
        setNewCustGeo(res.coords);
        setCustMapNotice(null);
        const parsed = parseLatLngCoords(res.coords);
        if (parsed) {
          const rev = await reverseGeocodeCoords(parsed.lat, parsed.lng);
          if (rev.ok) {
            setNewCustAddress((prev) => prev.trim() || rev.address);
            if (rev.area) setNewCustArea((prev) => prev.trim() || rev.area || '');
            setFeedback({ type: 'success', text: 'تم التقاط إحداثيات GPS وجلب العنوان تلقائياً.' });
            return;
          }
          setCustMapNotice(rev.error);
          setFeedback({ type: 'warning', text: 'تم التقاط إحداثيات GPS، وتعذر جلب العنوان تلقائياً — يمكنك كتابته يدوياً.' });
          return;
        }
        setFeedback({ type: 'success', text: 'تم التقاط إحداثيات GPS للعميل.' });
      } else {
        setFeedback({ type: 'error', text: res.error || 'تعذر تحديد الموقع الجغرافي' });
      }
    } finally {
      setIsLocatingCust(false);
    }
  };

  const handleSaveNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim() || !newCustPhone.trim()) {
      setFeedback({ type: 'error', text: 'يرجى إدخال اسم العميل ورقم الهاتف.' });
      return;
    }
    setIsSavingCustomer(true);
    setFeedback(null);
    try {
      const cust = await data.addCustomer({
        code: `C-${Date.now().toString().slice(-5)}`,
        name: newCustName.trim(),
        shopName: newCustShop.trim() || newCustName.trim(),
        phone: newCustPhone.trim(),
        address: newCustAddress.trim() || newCustArea.trim() || '-',
        area: newCustArea.trim() || undefined,
        geoCoordinates: newCustGeo.trim() || undefined,
        openingBalance: Number(newCustOpening) || 0,
        status: 'active',
        allowedRepIds: rep ? [rep.id] : [],
      });
      setNewCustName('');
      setNewCustShop('');
      setNewCustPhone('');
      setNewCustArea('');
      setNewCustAddress('');
      setNewCustGeo('');
      setNewCustOpening(0);
      setInvCustomerId(cust.id);
      setFeedback({ type: 'success', text: `تم إضافة العميل (${cust.name}) بنجاح.` });
      onTabChange('customers');
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر إضافة العميل' });
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const handleSaveNewSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupName.trim() || !newSupPhone.trim()) {
      setFeedback({ type: 'error', text: 'يرجى إدخال اسم المورد ورقم الهاتف.' });
      return;
    }
    setIsSavingSupplier(true);
    setFeedback(null);
    try {
      const sup = await data.addSupplier({
        code: `S-${Date.now().toString().slice(-5)}`,
        name: newSupName.trim(),
        phone: newSupPhone.trim(),
        address: newSupAddress.trim() || '-',
        notes: newSupCompany.trim() ? `الشركة: ${newSupCompany.trim()}` : undefined,
        openingBalance: Number(newSupOpening) || 0,
        status: 'active',
      });
      setNewSupName('');
      setNewSupCompany('');
      setNewSupPhone('');
      setNewSupAddress('');
      setNewSupOpening(0);
      setPurSupplierId(sup.id);
      setFeedback({
        type: 'success',
        text: `تم تسجيل المورد (${sup.name}) بنجاح.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر حفظ المورد' });
    } finally {
      setIsSavingSupplier(false);
    }
  };

  // ==================== QUOTES HANDLERS ====================
  const quoteTotal = useMemo(() => quoteItems.reduce((s, i) => s + i.total, 0), [quoteItems]);

  const handleSelectQuoteProduct = (prodId: string) => {
    setQuoteProductId(prodId);
    const prod = activeProducts.find((p) => p.id === prodId);
    if (!prod) return;
    setQuoteUnitName(prod.baseUnit);
    setQuotePrice(prod.sellingPrice);
    setQuoteQty(1);
  };

  const handleAddQuoteItem = () => {
    const prod = activeProducts.find((p) => p.id === quoteProductId);
    if (!prod || quoteQty <= 0) return;
    let factor = 1;
    if (quoteUnitName !== prod.baseUnit) {
      const u = prod.units.find((x) => x.name === quoteUnitName);
      if (u) factor = u.conversionFactor;
    }
    setQuoteItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        barcode: prod.barcode,
        unit: quoteUnitName || prod.baseUnit,
        unitFactor: factor,
        quantity: quoteQty,
        unitPrice: quotePrice,
        purchasePriceAtTime: prod.purchasePrice * factor,
        discount: 0,
        total: computeLineTotal(quoteQty, quotePrice),
      },
    ]);
    setQuoteProductId('');
    setQuoteQty(1);
    setQuotePrice(0);
  };

  const handleCreateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quoteItems.length) {
      setFeedback({ type: 'error', text: 'يرجى إضافة صنف واحد على الأقل لعرض السعر.' });
      return;
    }
    const cust = data.customers.find((c) => c.id === quoteCustomerId);
    setIsSubmittingQuote(true);
    setFeedback(null);
    const res = await data.createSalesQuote({
      date: new Date().toISOString().split('T')[0],
      customerId: quoteCustomerId || undefined,
      customerName: cust?.name || 'عميل عام',
      representativeId: rep?.id,
      representativeName: rep?.name,
      warehouseId: effectiveVanId || mainWarehouse?.id || '',
      warehouseName: vanWarehouse?.name || mainWarehouse?.name || '',
      items: quoteItems,
      subtotal: quoteTotal,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: quoteTotal,
      paidAmount: 0,
      remainingAmount: quoteTotal,
      paymentType: 'credit',
      paymentMethod: 'cash',
      cashboxId: data.cashboxes[0]?.id || '',
      status: 'confirmed',
      notes: quoteNotes.trim() || 'عرض سعر بدون تأثير مخزني أو مالي',
    });
    setIsSubmittingQuote(false);
    if (res.success) {
      setQuoteItems([]);
      setQuoteNotes('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? `تم حفظ عرض السعر (${res.invoice?.invoiceNumber || ''}) محلياً بانتظار المزامنة.`
          : `تم إنشاء عرض السعر (${res.invoice?.invoiceNumber || ''}) دون أي تأثير على المخزون أو الحسابات.`,
      });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر حفظ عرض السعر' });
    }
  };

  const handleConvertQuote = async (quoteId: string) => {
    setConvertingQuoteId(quoteId);
    setFeedback(null);
    const res = await data.convertQuoteToInvoice(quoteId);
    setConvertingQuoteId(null);
    if (res.success) {
      setFeedback({
        type: 'success',
        text: `تم تحويل عرض السعر إلى فاتورة مبيعات (${res.invoice?.invoiceNumber || ''}) بنجاح.`,
      });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر تحويل عرض السعر لفاتورة' });
    }
  };

  // ==================== CHEQUES & INSTALLMENTS HANDLERS ====================
  const handleAddCheque = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chqNumber.trim() || !chqPartyName.trim() || chqAmount <= 0) {
      setFeedback({ type: 'error', text: 'يرجى استكمال رقم الشيك والجهة والمبلغ.' });
      return;
    }
    setIsSavingCheque(true);
    setFeedback(null);
    try {
      await data.addCheque({
        chequeNumber: chqNumber.trim(),
        type: chqType,
        partyId: '',
        partyName: chqPartyName.trim(),
        bankName: chqBank.trim() || 'بنك',
        amount: chqAmount,
        dueDate: chqDueDate,
        issueDate: new Date().toISOString().split('T')[0],
        status: 'pending',
      });
      setChqNumber('');
      setChqPartyName('');
      setChqBank('');
      setChqAmount(0);
      setFeedback({ type: 'success', text: 'تم تسجيل الشيك بنجاح.' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر حفظ الشيك' });
    } finally {
      setIsSavingCheque(false);
    }
  };

  // ==================== CUSTODY & ORDERS HELPERS ====================
  const selectedOrderProduct = useMemo(
    () => activeProducts.find((p) => p.id === ordProductId) || null,
    [activeProducts, ordProductId]
  );

  const handleSelectOrderProduct = (prodId: string) => {
    setOrdProductId(prodId);
    const prod = activeProducts.find((p) => p.id === prodId);
    if (!prod) return;
    if (prod.units && prod.units.length > 0) {
      setOrdUnitName(prod.units[0].name);
      setOrdPrice(prod.units[0].sellingPrice);
    } else {
      setOrdUnitName(prod.baseUnit);
      setOrdPrice(prod.sellingPrice);
    }
    setOrdQty(1);
  };

  const handleOrderUnitChange = (unitName: string) => {
    setOrdUnitName(unitName);
    if (!selectedOrderProduct) return;
    if (unitName === selectedOrderProduct.baseUnit) {
      setOrdPrice(selectedOrderProduct.sellingPrice);
    } else {
      const u = selectedOrderProduct.units.find((x) => x.name === unitName);
      if (u) setOrdPrice(u.sellingPrice);
    }
  };

  const handleAddOrderItem = () => {
    if (!selectedOrderProduct || ordQty <= 0) return;
    let unitFactor = 1;
    if (ordUnitName !== selectedOrderProduct.baseUnit) {
      const u = selectedOrderProduct.units.find((x) => x.name === ordUnitName);
      if (u) unitFactor = u.conversionFactor;
    }
    const unitUsed = ordUnitName || selectedOrderProduct.baseUnit;
    setOrdItems((prev) => {
      const existingIdx = prev.findIndex(
        (it) => it.productId === selectedOrderProduct.id && it.unit === unitUsed
      );
      if (existingIdx >= 0) {
        return prev.map((it, i) =>
          i === existingIdx ? { ...it, quantity: it.quantity + ordQty, unitPrice: ordPrice } : it
        );
      }
      return [
        ...prev,
        {
          productId: selectedOrderProduct.id,
          productCode: selectedOrderProduct.code,
          productName: selectedOrderProduct.name,
          productImage: selectedOrderProduct.image,
          unit: unitUsed,
          unitFactor,
          quantity: ordQty,
          unitPrice: ordPrice,
        },
      ];
    });
    setOrdProductId('');
    setOrdQty(1);
    setOrdPrice(0);
  };

  const ordTotalAmount = useMemo(
    () => ordItems.reduce((sum, it) => sum + computeLineTotal(it.quantity, it.unitPrice), 0),
    [ordItems]
  );

  const handleSubmitRepOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ordCustomerId || !ordItems.length) {
      setFeedback({ type: 'error', text: 'يرجى اختيار العميل وإضافة صنف واحد على الأقل.' });
      return;
    }
    const cust = data.customers.find((c) => c.id === ordCustomerId);
    setIsSubmittingOrder(true);
    setFeedback(null);
    const res = await data.createCustomerItemOrder({
      customerId: ordCustomerId,
      customerName: cust?.name || 'عميل',
      customerPhone: cust?.phone,
      shopName: cust?.shopName || cust?.name,
      deliveryAddress: cust?.address,
      geoCoordinates: cust?.geoCoordinates,
      requesterType: 'representative',
      items: ordItems,
      totalAmount: ordTotalAmount,
      notes: ordNotes.trim() || 'طلب شراء مرسل من المندوب',
    });
    setIsSubmittingOrder(false);
    if (res.success || res.queuedOffline) {
      setOrdItems([]);
      setOrdNotes('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? `تم حفظ الطلب محلياً (${res.order?.requestNumber || ''}) بانتظار المزامنة.`
          : `تم إرسال الطلب رقم ${res.order?.requestNumber || ''} للإدارة.`,
      });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر إرسال الطلب' });
    }
  };

  const assignedDeliveryOrders = useMemo(() => {
    return [...(data.customerItemOrders || [])]
      .filter((o) =>
        rep
          ? o.deliveryRepId === rep.id
          : ['rep_assigned', 'preparing', 'out_for_delivery', 'delivered', 'collected'].includes(o.status)
      )
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.customerItemOrders, rep]);

  const handleStartDelivery = async (ord: CustomerItemOrderRequest) => {
    setFeedback(null);
    setIsUpdatingDelivery(true);
    try {
      const res = await data.updateOrderDeliveryStatus(ord.id, { status: 'out_for_delivery' });
      if (res.success) {
        setFeedback({
          type: res.queuedOffline ? 'warning' : 'success',
          text: res.queuedOffline
            ? `تم تسجيل بدء التوصيل للطلب ${ord.requestNumber} محلياً.`
            : `الطلب ${ord.requestNumber} الآن في حالة (جاري التوصيل).`,
        });
      } else {
        setFeedback({ type: 'error', text: res.error || 'تعذر تحديث حالة التوصيل' });
      }
    } finally {
      setIsUpdatingDelivery(false);
    }
  };

  const handleOpenDeliverModal = (ord: CustomerItemOrderRequest) => {
    const remainingAfterAdv = Math.max(0, Number(ord.totalAmount || 0) - Number(ord.advancePaidAmount || 0));
    setDeliveringOrder(ord);
    setDeliveryCollectedAmount(remainingAfterAdv);
    setDeliveryCashboxId(data.cashboxes[0]?.id || 'CASH-01');
    setDeliveryMethod('cash');
    setDeliveryNotes('');
    setDeliveryProof('');
  };

  const handleConfirmDelivered = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveringOrder || isUpdatingDelivery) return;
    setIsUpdatingDelivery(true);
    setFeedback(null);
    try {
      const res = await data.updateOrderDeliveryStatus(deliveringOrder.id, {
        status: 'delivered',
        collectedAmount: deliveryCollectedAmount > 0 ? deliveryCollectedAmount : 0,
        cashboxId: deliveryCollectedAmount > 0 ? deliveryCashboxId : undefined,
        paymentMethod: deliveryMethod,
        deliveryNotes: deliveryNotes.trim() || undefined,
        deliveryProof: deliveryProof || undefined,
      });
      if (res.success) {
        setFeedback({
          type: res.queuedOffline ? 'warning' : 'success',
          text: res.queuedOffline
            ? `تم حفظ تأكيد تسليم الطلب ${deliveringOrder.requestNumber} محلياً.`
            : `تم تسجيل تسليم الطلب ${deliveringOrder.requestNumber} بنجاح.`,
        });
        setDeliveringOrder(null);
      } else {
        setFeedback({ type: 'error', text: res.error || 'تعذر تأكيد التسليم' });
      }
    } finally {
      setIsUpdatingDelivery(false);
    }
  };

  const mySubmittedOrders = useMemo(() => {
    return [...(data.customerItemOrders || [])]
      .filter((o) => !rep || o.representativeId === rep.id || o.requesterType === 'representative')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.customerItemOrders, rep]);

  const myItemTransfers = useMemo(() => {
    return (data.repItemTransfers || [])
      .filter((t) => !rep || t.representativeId === rep.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.repItemTransfers, rep]);

  const myCashTransfers = useMemo(() => {
    return (data.repTransfers || [])
      .filter((t) => !rep || t.senderId === rep.id || t.receiverId === rep.id)
      .sort((a, b) => (b.timestamp || b.sentAt || '').localeCompare(a.timestamp || a.sentAt || ''));
  }, [data.repTransfers, rep]);

  const myInvoices = useMemo(() => {
    return (data.invoices || [])
      .filter((i) => i.type === 'sales')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.invoices]);

  const myPurchases = useMemo(() => {
    return (data.invoices || [])
      .filter((i) => i.type === 'purchase')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.invoices]);

  const myQuotes = useMemo(() => {
    return (data.invoices || [])
      .filter((i) => i.type === 'quote')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.invoices]);

  const mySalesReturns = useMemo(() => {
    return (data.invoiceReturns || [])
      .filter((r: InvoiceReturn) => r.type === 'sales_return')
      .sort((a: InvoiceReturn, b: InvoiceReturn) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.invoiceReturns]);

  const myPurchaseReturns = useMemo(() => {
    return (data.invoiceReturns || [])
      .filter((r: InvoiceReturn) => r.type === 'purchase_return')
      .sort((a: InvoiceReturn, b: InvoiceReturn) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.invoiceReturns]);

  const draftsReadyToConfirm = useMemo(() => {
    return myInvoices.filter((inv) => {
      if (inv.status !== 'draft') return false;
      if (inv.linkedRepTransferId) {
        const tr = myItemTransfers.find((t) => t.id === inv.linkedRepTransferId);
        return tr?.status === 'executed' || tr?.status === 'received';
      }
      return true;
    });
  }, [myInvoices, myItemTransfers]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    return data.customers.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.shopName && c.shopName.toLowerCase().includes(q)) ||
        c.phone.includes(q) ||
        (c.area && c.area.toLowerCase().includes(q))
    );
  }, [data.customers, customerSearch]);

  const canConfirmDraft = (inv: Invoice): { ready: boolean; reason?: string } => {
    if (inv.linkedRepTransferId) {
      const tr = myItemTransfers.find((t) => t.id === inv.linkedRepTransferId);
      if (tr && tr.status !== 'executed' && tr.status !== 'received') {
        return {
          ready: false,
          reason:
            tr.status === 'rejected'
              ? 'تم رفض طلب تحويل الأصناف المرتبط من الإدارة'
              : 'بانتظار موافقة وصرف الإدارة لطلب التحويل المرتبط',
        };
      }
    }
    return { ready: true };
  };

  const handleConfirmDraft = async (inv: Invoice) => {
    setFeedback(null);
    const res = await data.confirmDraftInvoice(inv.id);
    if (res.success) {
      setFeedback({ type: 'success', text: `تم اعتماد الفاتورة ${inv.invoiceNumber} نهائياً وتحديث المخزون والحساب.` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر اعتماد المسودة' });
    }
  };

  const handleConfirmItemReceived = async (reqId: string, reqNum: string) => {
    setFeedback(null);
    const res = await data.updateRepItemTransferStatus(reqId, 'received');
    if (res.success) {
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? `تم تسجيل استلام ${reqNum} محلياً بانتظار المزامنة.`
          : `تم تأكيد استلام أصناف التحويل ${reqNum} على سيارتك.`,
      });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر تأكيد الاستلام' });
    }
  };

  const handleRecordPartialCustodyDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delivProdId || delivQty <= 0) {
      setFeedback({ type: 'error', text: 'يرجى اختيار الصنف وكمية التسليم الجزئي.' });
      return;
    }
    const cust = data.customers.find((c) => c.id === delivCustomerId);
    setIsSendingTransfer(true);
    setFeedback(null);
    const res = await data.recordRepCustodyDelivery({
      representativeId: rep?.id,
      customerId: delivCustomerId || undefined,
      customerName: cust?.name || undefined,
      productId: delivProdId,
      quantity: delivQty,
      date: new Date().toISOString().split('T')[0],
      notes: delivNotes.trim() || 'تسليم عهدة جزئي لعميل من تطبيق المندوب',
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setDelivProdId('');
      setDelivQty(1);
      setDelivNotes('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? 'تم تسجيل تسليم العهدة محلياً بانتظار المزامنة.'
          : 'تم تسجيل تسليم العهدة وتحديث المتبقي في سيارة المندوب.',
      });
      loadCustodyStatement();
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر تسجيل تسليم العهدة' });
    }
  };

  const handleRecordCustodyReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retCustodyProdId || retCustodyQty <= 0) {
      setFeedback({ type: 'error', text: 'يرجى اختيار الصنف والكمية المرتجعة للمخزن.' });
      return;
    }
    const prod = activeProducts.find((p) => p.id === retCustodyProdId);
    let factor = 1;
    const chosenUnit = retCustodyUnit || prod?.baseUnit || 'قطعة';
    if (prod && chosenUnit !== prod.baseUnit) {
      const u = prod.units.find((x) => x.name === chosenUnit);
      if (u) factor = u.conversionFactor;
    }
    const vanAvail = prod?.stockPerWarehouse?.[effectiveVanId] || 0;
    if (retCustodyQty * factor > vanAvail) {
      setFeedback({
        type: 'error',
        text: `الكمية المطلوب إرجاعها (${retCustodyQty * factor} ${prod?.baseUnit || ''}) تتجاوز المتاح في عهدة السيارة (${vanAvail}).`,
      });
      return;
    }
    setIsSendingTransfer(true);
    setFeedback(null);
    const res = await data.recordRepCustodyReturn({
      representativeId: rep?.id,
      targetWarehouseId: retCustodyTargetWhId || mainWarehouse?.id,
      productId: retCustodyProdId,
      quantity: retCustodyQty,
      unit: chosenUnit,
      unitFactor: factor,
      date: new Date().toISOString().split('T')[0],
      notes: retCustodyNotes.trim() || 'إرجاع بضاعة من عهدة المندوب للمخزن الرئيسي',
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setRetCustodyProdId('');
      setRetCustodyUnit('');
      setRetCustodyQty(1);
      setRetCustodyNotes('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? 'تم حفظ إرجاع العهدة للمخزن محلياً بانتظار المزامنة.'
          : 'تم تسجيل إرجاع العهدة إلى المخزن وتحديث الأرصدة بنجاح.',
      });
      loadCustodyStatement();
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر إرجاع الصنف للمخزن' });
    }
  };

  const handleSendDirectItemTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rep || !mainWarehouse || !effectiveVanId || reqItems.length === 0) return;
    setIsSendingTransfer(true);
    const wh = data.warehouses.find((w) => w.id === effectiveVanId);
    const res = await data.createRepItemTransfer({
      date: new Date().toISOString().split('T')[0],
      representativeId: rep.id,
      representativeName: rep.name,
      sourceWarehouseId: mainWarehouse.id,
      sourceWarehouseName: mainWarehouse.name,
      targetWarehouseId: effectiveVanId,
      targetWarehouseName: wh?.name || `سيارة المندوب (${rep.name})`,
      items: reqItems,
      notes: 'طلب تغذية عهدة سيارة من تطبيق المندوب',
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setReqItems([]);
      setFeedback({ type: 'success', text: `تم إرسال طلب التحويل ${res.request?.requestNumber || ''} للإدارة.` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر إرسال طلب التحويل' });
    }
  };

  const handleSendCashToOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rep || cashAmount <= 0) return;
    setIsSendingTransfer(true);
    const res = await data.createRepTransfer({
      direction: 'rep_to_owner',
      senderId: rep.id,
      senderName: rep.name,
      receiverId: 'OWNER',
      receiverName: 'الفرع الرئيسي (الخزينة)',
      amount: cashAmount,
      cashboxId: data.cashboxes[0]?.id || 'CASH-01',
      notes: cashNotes.trim() || 'توريد تحصيلات من تطبيق المندوب',
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setCashAmount(0);
      setCashNotes('');
      setFeedback({ type: 'success', text: `تم إرسال إشعار التوريد النقدي رقم ${res.transfer?.transferNumber || ''} بانتظار تأكيد الخزينة.` });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر إرسال التحويل النقدي' });
    }
  };

  const handleConfirmOwnerCash = async (transferId: string) => {
    const res = await data.confirmRepTransferReceipt(transferId, 'تم الاستلام الفعلي عبر تطبيق المندوب');
    if (res.success) {
      setFeedback({ type: 'success', text: 'تم تأكيد استلام العهدة النقدية وتحديث رصيدك.' });
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر تأكيد الاستلام' });
    }
  };

  const exportInvoiceDocument = (inv: Invoice) => {
    exportHtmlToPdf({
      title: inv.type === 'quote' ? 'عرض سعر' : inv.type === 'purchase' ? 'فاتورة مشتريات' : inv.status === 'draft' ? 'مسودة فاتورة مبيعات' : 'فاتورة مبيعات',
      companyName: data.settings.companyName,
      companySubtitle: data.settings.companySubtitle,
      docNumber: inv.invoiceNumber,
      dateRangeText: inv.date,
      meta: [
        { label: inv.type === 'purchase' ? 'المورد' : 'العميل', value: inv.supplierName || inv.customerName || '-' },
        { label: 'المندوب', value: inv.representativeName || rep?.name || '-' },
        { label: 'المخزن', value: inv.warehouseName || '-' },
      ],
      tableHeaders: ['م', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الإجمالي'],
      tableRows: (inv.items || []).map((it, idx) => [
        idx + 1,
        it.productName,
        it.unit,
        it.quantity,
        it.unitPrice.toFixed(2),
        it.total.toFixed(2),
      ]),
      summaryPairs: [
        { label: 'الصافي الإجمالي', value: `${inv.grandTotal.toFixed(2)} ${data.settings.currency}`, highlight: true },
        ...(inv.type !== 'quote'
          ? [
              { label: 'المدفوع', value: `${inv.paidAmount.toFixed(2)} ${data.settings.currency}` },
              { label: 'المتبقي', value: `${inv.remainingAmount.toFixed(2)} ${data.settings.currency}` },
            ]
          : []),
      ],
      notes: inv.notes,
    });
  };

  if (mobileConfig.enableRepApp === false) {
    return (
      <div className="bg-white rounded-3xl border border-amber-200 p-8 text-center space-y-3 shadow-xs">
        <ShieldAlert className="w-12 h-12 text-amber-600 mx-auto" />
        <h3 className="text-base font-black text-slate-900">بوابة المناديب متوقفة مؤقتاً</h3>
        <p className="text-xs text-slate-600">
          تم تعطيل وصول تطبيق المناديب مؤقتاً من إعدادات الإدارة. يرجى مراجعة مسؤول النظام.
        </p>
        <button
          type="button"
          onClick={() => data.triggerManualSync()}
          className="min-h-[44px] px-5 rounded-xl bg-blue-900 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>إعادة المحاولة</span>
        </button>
      </div>
    );
  }

  // ==================== BRAND STORE 4x3 TILE GRID DEFINITIONS ====================
  const homeTiles: Array<{
    key: RepTabKey;
    label: string;
    icon: React.ElementType;
    allowed: boolean;
    tone: string;
    badgeCount?: number;
  }> = [
    // Row 1
    {
      key: 'new-purchase',
      label: 'فاتورة شراء',
      icon: ShoppingBag,
      allowed: canPurchases,
      tone: 'bg-indigo-50 text-indigo-900 border-indigo-200',
    },
    {
      key: 'sales-return',
      label: 'مرتجع بيع',
      icon: RotateCcw,
      allowed: canSales,
      tone: 'bg-rose-50 text-rose-900 border-rose-200',
    },
    {
      key: 'new-invoice',
      label: 'فاتورة بيع',
      icon: FilePlus2,
      allowed: canSales,
      tone: 'bg-blue-900 text-white border-blue-950',
    },
    // Row 2
    {
      key: 'cash-deposit',
      label: 'إيداع نقدي',
      icon: ArrowDownCircle,
      allowed: canCashOps || canSales,
      tone: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    },
    {
      key: 'custody-transfer',
      label: 'تحويل',
      icon: ArrowLeftRight,
      allowed: canTransfers,
      tone: 'bg-cyan-50 text-cyan-900 border-cyan-200',
    },
    {
      key: 'purchase-return',
      label: 'مرتجع شراء',
      icon: RotateCcw,
      allowed: canPurchases,
      tone: 'bg-orange-50 text-orange-900 border-orange-200',
    },
    // Row 3
    {
      key: 'cash-withdrawal',
      label: 'سحب نقدي',
      icon: ArrowUpCircle,
      allowed: canCashOps,
      tone: 'bg-amber-50 text-amber-900 border-amber-200',
    },
    {
      key: 'new-customer',
      label: 'عميل جديد',
      icon: UserPlus,
      allowed: canAddCustomer,
      tone: 'bg-sky-50 text-sky-900 border-sky-200',
    },
    {
      key: 'new-supplier',
      label: 'مورد جديد',
      icon: Building2,
      allowed: canPurchases,
      tone: 'bg-purple-50 text-purple-900 border-purple-200',
    },
    // Row 4
    {
      key: 'refresh',
      label: 'REFRESH',
      icon: RefreshCw,
      allowed: true,
      tone: 'bg-slate-900 text-white border-slate-950',
      badgeCount: data.pendingSyncCount,
    },
    {
      key: 'cheques-installments',
      label: 'شيك وقسط',
      icon: CreditCard,
      allowed: canAccounts,
      tone: 'bg-teal-50 text-teal-900 border-teal-200',
    },
    {
      key: 'new-quote',
      label: 'عرض سعر',
      icon: FileSpreadsheet,
      allowed: canSales,
      tone: 'bg-blue-50 text-blue-950 border-blue-200',
    },
  ];

  // Helper to render safe Phone + Maps icons next to mobile Customer Phone / Address fields
  const renderPhoneAndMapsActionRow = (
    phoneVal: string,
    addressVal: string,
    geoVal: string,
    onPhoneWarn: (notice: { type: 'info' | 'error'; text: string }) => void,
    onMapWarn: (msg: string | null) => void
  ) => {
    const cleanedPhone = phoneVal.replace(/[^\d+]/g, '');
    const isPhoneValid = cleanedPhone.replace(/\D/g, '').length >= 7;
    const mapQuery = (geoVal || addressVal).trim();
    const mapsHref =
      mapQuery.startsWith('http://') || mapQuery.startsWith('https://')
        ? mapQuery
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
    return { cleanedPhone, isPhoneValid, mapQuery, mapsHref, onPhoneWarn, onMapWarn };
  };

  const guardedTabChange = (nextTab: RepTabKey) => {
    if (activeTab === 'new-invoice' && invItems.length > 0 && nextTab !== 'new-invoice') {
      setPendingLeaveTab(nextTab);
      return;
    }
    onTabChange(nextTab);
  };

  const pendingCustodyDispatches = useMemo(
    () => myItemTransfers.filter((t) => t.status === 'executed'),
    [myItemTransfers]
  );

  const pendingCashReceipts = useMemo(
    () => myCashTransfers.filter((t) => t.status === 'awaiting_receipt' && t.direction === 'owner_to_rep'),
    [myCashTransfers]
  );

  const activeAssignedOrders = useMemo(
    () => assignedDeliveryOrders.filter((o) => ['rep_assigned', 'preparing', 'out_for_delivery', 'invoiced'].includes(o.status)),
    [assignedDeliveryOrders]
  );

  const todayStr = new Date().toISOString().split('T')[0];

  const cashDrawerSummary = useMemo(() => {
    const todayRepSalesCash = myInvoices
      .filter((i) => i.date === todayStr && i.status === 'confirmed' && (!rep || i.representativeId === rep.id))
      .reduce((s, i) => s + Number(i.paidAmount || 0), 0);
    const todayCashCollections = (data.financialTransactions || [])
      .filter(
        (t) =>
          t.date === todayStr &&
          (t.type === 'deposit' || t.type === 'income') &&
          (!currentUser || t.createdBy === currentUser.fullName || t.createdBy === currentUser.username)
      )
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const todayRepRemittances = myCashTransfers
      .filter((t) => t.direction === 'rep_to_owner' && (t.timestamp || t.sentAt || '').startsWith(todayStr) && t.status !== 'rejected')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const expectedBalance = Number(rep?.currentBalance || 0);
    const parsedActual = actualDrawerCash.trim() === '' ? null : Number(actualDrawerCash);
    const variance = parsedActual === null || Number.isNaN(parsedActual) ? null : parsedActual - expectedBalance;
    return {
      todayRepSalesCash,
      todayCashCollections,
      todayRepRemittances,
      expectedBalance,
      variance,
    };
  }, [myInvoices, todayStr, rep, data.financialTransactions, currentUser, myCashTransfers, actualDrawerCash]);

  const selectedInvoiceCustomer = useMemo(
    () => data.customers.find((c) => c.id === invCustomerId) || null,
    [data.customers, invCustomerId]
  );

  const effectiveInvPaid = useMemo(() => {
    if (invPaymentType === 'cash') return invGrandTotal;
    if (invPaymentType === 'credit') return 0;
    return Math.min(invGrandTotal, Math.max(0, Number(invPaidAmount || 0)));
  }, [invPaymentType, invGrandTotal, invPaidAmount]);

  return (
    <div className="space-y-4">
      {/* Brand Store Permission-Gated Top Tabs: الرئيسية | النقدية | المزيد */}
      <div className="bg-white rounded-2xl border border-slate-200 p-1.5 shadow-2xs grid grid-cols-3 gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => guardedTabChange('home')}
          className={`min-h-[44px] rounded-xl font-black transition-colors cursor-pointer ${
            activeTab === 'home' ? 'bg-blue-900 text-white shadow-xs' : 'text-slate-700 hover:bg-slate-50'
          }`}
        >
          الرئيسية
        </button>
        {canCash ? (
          <button
            type="button"
            onClick={() => guardedTabChange('cash')}
            className={`min-h-[44px] rounded-xl font-black transition-colors cursor-pointer ${
              activeTab === 'cash' ? 'bg-blue-900 text-white shadow-xs' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            النقدية
          </button>
        ) : (
          <div className="min-h-[44px] rounded-xl flex items-center justify-center text-slate-400 bg-slate-50 text-[11px] font-bold">
            النقدية (مقيد)
          </div>
        )}
        <button
          type="button"
          onClick={() => guardedTabChange('more')}
          className={`min-h-[44px] rounded-xl font-black transition-colors cursor-pointer ${
            activeTab === 'more' ? 'bg-blue-900 text-white shadow-xs' : 'text-slate-700 hover:bg-slate-50'
          }`}
        >
          المزيد
        </button>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : feedback.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="text-[11px] underline cursor-pointer">
            إغلاق
          </button>
        </div>
      )}

      {/* ==================== TAB 1: HOME (4x3 Brand Store Tile Grid) ==================== */}
      {activeTab === 'home' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500">مرحباً، مندوب المبيعات</p>
                <h2 className="text-base font-black text-slate-900 truncate">
                  {rep?.name || currentUser?.fullName}
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {vanWarehouse?.name || 'سيارة المندوب'} {rep?.vehicleNumber ? `· ${rep.vehicleNumber}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-left px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="text-[10px] text-emerald-700 block">العهدة النقدية</span>
                  <strong className="text-sm font-black font-mono tabular-nums text-emerald-800">
                    {(rep?.currentBalance || 0).toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
              </div>
            </div>

            {(pendingCustodyDispatches.length > 0 ||
              pendingCashReceipts.length > 0 ||
              activeAssignedOrders.length > 0 ||
              draftsReadyToConfirm.length > 0 ||
              data.pendingSyncCount > 0) && (
              <div className="pt-2 border-t border-slate-100 space-y-2 text-xs">
                <div className="flex items-center gap-1.5 font-black text-blue-950">
                  <ClipboardCheck className="w-4 h-4 text-blue-800 shrink-0" />
                  <span>المهام اليومية المعلقة</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {pendingCustodyDispatches.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustodySubTab('items');
                        onTabChange('custody');
                      }}
                      className="p-2.5 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-950 flex items-center justify-between gap-2 font-bold cursor-pointer hover:bg-cyan-100"
                    >
                      <span>عهد بضاعة مرسلة بانتظار تأكيد الاستلام ({pendingCustodyDispatches.length})</span>
                      <ChevronLeft className="w-4 h-4 shrink-0" />
                    </button>
                  )}
                  {pendingCashReceipts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('cash')}
                      className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-center justify-between gap-2 font-bold cursor-pointer hover:bg-emerald-100"
                    >
                      <span>عهد نقدية واردة من الإدارة ({pendingCashReceipts.length})</span>
                      <ChevronLeft className="w-4 h-4 shrink-0" />
                    </button>
                  )}
                  {activeAssignedOrders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('orders')}
                      className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-950 flex items-center justify-between gap-2 font-bold cursor-pointer hover:bg-indigo-100"
                    >
                      <span>طلبات توصيل جارية معينة لك ({activeAssignedOrders.length})</span>
                      <ChevronLeft className="w-4 h-4 shrink-0" />
                    </button>
                  )}
                  {draftsReadyToConfirm.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('invoices')}
                      className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-950 flex items-center justify-between gap-2 font-bold cursor-pointer hover:bg-blue-100"
                    >
                      <span>مسودات فواتير جاهزة للاعتماد ({draftsReadyToConfirm.length})</span>
                      <ChevronLeft className="w-4 h-4 shrink-0" />
                    </button>
                  )}
                  {data.pendingSyncCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('refresh')}
                      className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 flex items-center justify-between gap-2 font-bold cursor-pointer hover:bg-amber-100"
                    >
                      <span>عمليات محلية بانتظار الإرسال عبر REFRESH ({data.pendingSyncCount})</span>
                      <ChevronLeft className="w-4 h-4 shrink-0" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 4x3 Operation Tile Grid */}
          <div className="grid grid-cols-3 gap-2.5">
            {homeTiles.map((tile) => {
              const Icon = tile.icon;
              return (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => {
                    if (!tile.allowed) {
                      setFeedback({
                        type: 'error',
                        text: `صلاحيات حسابك لا تسمح بفتح "${tile.label}". راجع المدير لتفعيل الصلاحية.`,
                      });
                      return;
                    }
                    onTabChange(tile.key);
                  }}
                  className={`relative min-h-[88px] p-3 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center transition-transform active:scale-97 cursor-pointer shadow-2xs ${
                    tile.allowed
                      ? tile.tone
                      : 'bg-slate-100 text-slate-400 border-slate-200 opacity-75'
                  }`}
                >
                  {!tile.allowed && (
                    <Lock className="w-3.5 h-3.5 absolute top-2 left-2 text-slate-400" />
                  )}
                  {tile.badgeCount && tile.badgeCount > 0 ? (
                    <span className="absolute top-1.5 left-1.5 min-w-[20px] h-[20px] px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black font-mono flex items-center justify-center">
                      {tile.badgeCount}
                    </span>
                  ) : null}
                  <Icon className="w-6 h-6 shrink-0" />
                  <span className="text-xs font-black leading-tight">{tile.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== TAB 2: CASH (النقدية) ==================== */}
      {activeTab === 'cash' && (
        <div className="space-y-4 text-xs">
          <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-700" />
              <span>إدارة النقدية والعهدة المالية</span>
            </h3>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                <span className="text-[11px] text-emerald-700 block">رصيد عهدة المندوب</span>
                <strong className="text-base font-black font-mono tabular-nums text-emerald-900">
                  {(rep?.currentBalance || 0).toLocaleString()} {data.settings.currency}
                </strong>
              </div>
              <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200">
                <span className="text-[11px] text-blue-700 block">إجمالي أرصدة الخزائن</span>
                <strong className="text-base font-black font-mono tabular-nums text-blue-950">
                  {data.cashboxes.reduce((s, c) => s + Number(c.currentBalance || 0), 0).toLocaleString()} {data.settings.currency}
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={!(canCashOps || canSales)}
                onClick={() => onTabChange('cash-deposit')}
                className="min-h-[44px] rounded-xl bg-emerald-700 text-white font-black cursor-pointer disabled:opacity-45"
              >
                إيداع نقدي
              </button>
              <button
                type="button"
                disabled={!canCashOps}
                onClick={() => onTabChange('cash-withdrawal')}
                className="min-h-[44px] rounded-xl bg-amber-600 text-white font-black cursor-pointer disabled:opacity-45"
              >
                سحب نقدي
              </button>
              <button
                type="button"
                disabled={!canTransfers}
                onClick={() => {
                  setCustodySubTab('cash');
                  onTabChange('custody-transfer');
                }}
                className="min-h-[44px] rounded-xl bg-blue-900 text-white font-black cursor-pointer disabled:opacity-45"
              >
                تحويل للخزينة
              </button>
            </div>
          </div>

          {/* Cash Drawer Reconciliation Card */}
          <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3">
            <h4 className="font-black text-slate-900 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-blue-900" />
              <span>تقفيل ومطابقة الدرج النقدي اليوم ({todayStr})</span>
            </h4>
            <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
              <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200">
                <span className="text-[10px] text-blue-800 block">مبيعات اليوم المحصلة</span>
                <strong className="font-mono text-sm text-blue-950">
                  {cashDrawerSummary.todayRepSalesCash.toLocaleString()}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <span className="text-[10px] text-emerald-800 block">تحصيلات / إيداعات</span>
                <strong className="font-mono text-sm text-emerald-900">
                  {cashDrawerSummary.todayCashCollections.toLocaleString()}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                <span className="text-[10px] text-amber-800 block">توريدات للفرع اليوم</span>
                <strong className="font-mono text-sm text-amber-900">
                  {cashDrawerSummary.todayRepRemittances.toLocaleString()}
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  الجرد الفعلي للنقدية بالدرج ({data.settings.currency}):
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={actualDrawerCash}
                  onChange={(e) => setActualDrawerCash(e.target.value)}
                  placeholder="أدخل النقدية المعدودة فعلياً..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono font-bold text-center"
                />
              </div>
              <div
                className={`min-h-[42px] px-3 py-2 rounded-xl border flex items-center justify-between font-bold tabular-nums ${
                  cashDrawerSummary.variance === null
                    ? 'bg-slate-50 border-slate-200 text-slate-600'
                    : Math.abs(cashDrawerSummary.variance) < 0.01
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : cashDrawerSummary.variance > 0
                    ? 'bg-blue-50 border-blue-300 text-blue-900'
                    : 'bg-red-50 border-red-300 text-red-800'
                }`}
              >
                <span>الفارق عن العهدة:</span>
                <strong className="font-mono">
                  {cashDrawerSummary.variance === null
                    ? `الدفتر: ${cashDrawerSummary.expectedBalance.toLocaleString()}`
                    : Math.abs(cashDrawerSummary.variance) < 0.01
                    ? 'مطابق تماماً (0)'
                    : `${cashDrawerSummary.variance > 0 ? 'زيادة +' : 'عجز '}${cashDrawerSummary.variance.toLocaleString()} ${data.settings.currency}`}
                </strong>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-2.5">
            <h4 className="font-black text-slate-900">حركة التحويلات النقدية للمندوب ({myCashTransfers.length})</h4>
            {myCashTransfers.length === 0 ? (
              <p className="text-center text-slate-400 py-5">لا توجد تحويلات نقدية مسجلة حالياً.</p>
            ) : (
              myCashTransfers.map((t) => (
                <div key={t.id} className="rounded-2xl border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-blue-950">{t.transferNumber}</span>
                    <strong className="font-mono text-sm text-slate-900 tabular-nums">
                      {t.amount.toLocaleString()} {data.settings.currency}
                    </strong>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    {t.direction === 'rep_to_owner' ? 'توريد إلى الفرع' : 'عهدة واردة من الإدارة'} ·{' '}
                    {t.status === 'received'
                      ? 'تم الاستلام والتسوية'
                      : t.status === 'awaiting_receipt'
                      ? 'بانتظار تأكيد الاستلام'
                      : 'مرفوض'}
                  </p>
                  {t.status === 'awaiting_receipt' && t.direction === 'owner_to_rep' && (
                    <button
                      type="button"
                      onClick={() => handleConfirmOwnerCash(t.id)}
                      className="w-full min-h-[44px] rounded-xl bg-emerald-700 text-white font-black cursor-pointer"
                    >
                      تأكيد استلام العهدة النقدية
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 3: MORE (المزيد) ==================== */}
      {activeTab === 'more' && (
        <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs divide-y divide-slate-100 text-xs">
          {[
            { key: 'purchases-list' as RepTabKey, label: 'فواتير الشراء', icon: ShoppingBag, allowed: canPurchases },
            { key: 'sales-returns-list' as RepTabKey, label: 'مرتجع البيع', icon: RotateCcw, allowed: canSales },
            { key: 'invoices' as RepTabKey, label: 'فواتير البيع', icon: FileText, allowed: canSales },
            { key: 'customers' as RepTabKey, label: 'الحسابات والعملاء', icon: Users, allowed: canAccounts },
            { key: 'custody' as RepTabKey, label: 'المخزن والعهدة', icon: WarehouseIcon, allowed: canInventory },
            { key: 'purchase-returns-list' as RepTabKey, label: 'مرتجع الشراء', icon: RotateCcw, allowed: canPurchases },
            { key: 'orders' as RepTabKey, label: 'الطلبات والتسليمات', icon: Truck, allowed: canSales },
            { key: 'new-quote' as RepTabKey, label: 'عروض الأسعار', icon: FileSpreadsheet, allowed: canSales },
            { key: 'refresh' as RepTabKey, label: 'REFRESH · الإرسال والاستلام', icon: RefreshCw, allowed: true },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                disabled={!item.allowed}
                onClick={() => onTabChange(item.key)}
                className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-2 text-right font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-blue-900 shrink-0" />
                  <span>{item.label}</span>
                </div>
                {item.allowed ? (
                  <ChevronLeft className="w-4 h-4 text-slate-400" />
                ) : (
                  <Lock className="w-4 h-4 text-slate-300" />
                )}
              </button>
            );
          })}

          {onOpenServerModal && (
            <button
              type="button"
              onClick={onOpenServerModal}
              className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-2 text-right font-bold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <Settings className="w-4 h-4 text-slate-700 shrink-0" />
                <span>الإعدادات والربط المركزي</span>
              </div>
              <ChevronLeft className="w-4 h-4 text-slate-400" />
            </button>
          )}

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-2 text-right font-black text-red-700 hover:bg-red-50 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <LogOut className="w-4 h-4 shrink-0" />
                <span>تسجيل الخروج</span>
              </div>
              <ChevronLeft className="w-4 h-4 text-red-400" />
            </button>
          )}
        </div>
      )}

      {/* ==================== REFRESH SCREEN ==================== */}
      {activeTab === 'refresh' && <RefreshSyncScreen onBack={() => onTabChange('home')} />}

      {/* ==================== ALLOWED CUSTOMERS LIST (with Safe Call & Google Maps) ==================== */}
      {activeTab === 'customers' && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="ابحث باسم العميل أو المحل أو المنطقة أو الهاتف..."
                className="w-full rounded-xl border border-slate-300 py-3 pr-10 pl-3 text-xs font-semibold outline-hidden focus:border-blue-600"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
            </div>
            {canAddCustomer && (
              <button
                type="button"
                onClick={() => onTabChange('new-customer')}
                className="min-h-[44px] px-3.5 rounded-xl bg-blue-900 text-white text-xs font-black shrink-0 cursor-pointer"
              >
                + عميل
              </button>
            )}
          </div>

          {filteredCustomers.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-xs text-slate-500">
              لا يوجد عملاء مخصصون لحسابك حالياً.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredCustomers.map((c) => {
                const cleanedPhone = String(c.phone || '').replace(/[^\d+]/g, '');
                const hasValidPhone = cleanedPhone.replace(/\D/g, '').length >= 7;
                const mapRaw = (c.geoCoordinates || c.address || '').trim();
                const hasValidMap = Boolean(mapRaw && mapRaw !== '-');
                const mapsHref =
                  mapRaw.startsWith('http://') || mapRaw.startsWith('https://')
                    ? mapRaw
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapRaw)}`;
                return (
                  <div
                    key={c.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs"
                  >
                    <div
                      onClick={() => setSelectedCustomerDetail(c)}
                      className="flex items-start justify-between gap-2 cursor-pointer"
                    >
                      <div>
                        <h3 className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                          <span>{c.shopName || c.name}</span>
                          <Eye className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          {c.name} · {c.code} {c.area ? `· ${c.area}` : ''}
                        </p>
                      </div>
                      <div className="text-left shrink-0">
                        <span className="block text-[10px] text-slate-500">
                          {c.currentBalance < 0 ? 'رصيد دائن للعميل' : c.currentBalance > 0 ? 'مديونية على العميل' : 'الرصيد'}
                        </span>
                        <strong
                          className={`font-mono text-sm tabular-nums ${
                            c.currentBalance > 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {Math.abs(c.currentBalance).toLocaleString()} {data.settings.currency}
                        </strong>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {hasValidPhone ? (
                        <a
                          href={`tel:${cleanedPhone}`}
                          className="min-h-[42px] px-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold inline-flex items-center gap-1.5"
                        >
                          <Phone className="w-4 h-4" />
                          <span>{c.phone}</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setFeedback({ type: 'warning', text: `رقم هاتف العميل (${c.name}) غير مكتمل أو غير صالح للاتصال.` })
                          }
                          className="min-h-[42px] px-3 rounded-xl bg-slate-100 text-slate-500 border border-slate-200 font-bold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Phone className="w-4 h-4" />
                          <span>{c.phone || 'بدون هاتف'}</span>
                        </button>
                      )}
                      {hasValidMap ? (
                        <a
                          href={mapsHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[42px] px-3 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 font-bold inline-flex items-center gap-1.5"
                        >
                          <MapPin className="w-4 h-4" />
                          <span>الموقع</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setFeedback({ type: 'warning', text: `لا يوجد عنوان أو موقع جغرافي مسجل للعميل (${c.name}).` })
                          }
                          className="min-h-[42px] px-3 rounded-xl bg-slate-100 text-slate-500 border border-slate-200 font-bold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <MapPin className="w-4 h-4" />
                          <span>بدون عنوان</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setInvCustomerId(c.id);
                          onTabChange('new-invoice');
                        }}
                        className="min-h-[42px] flex-1 px-3 rounded-xl bg-blue-900 text-white font-bold cursor-pointer"
                      >
                        فاتورة جديدة
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== NEW SALES INVOICE (with Van Custody Guard) ==================== */}
      {activeTab === 'new-invoice' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-black text-slate-900">إنشاء فاتورة مبيعات (مقيد بمخزون عهدة السيارة)</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">العميل المسموح:</label>
                <select
                  value={invCustomerId}
                  onChange={(e) => setInvCustomerId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
                >
                  <option value="">-- اختر العميل --</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shopName ? `${c.shopName} (${c.name})` : c.name} — رصيد: {c.currentBalance}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">مستودع الصرف (السيارة):</label>
                <select
                  value={effectiveVanId}
                  onChange={(e) => setInvWarehouseId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
                >
                  {data.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="font-bold text-slate-800">بحث / باركود وإضافة صنف:</label>
                <button
                  type="button"
                  onClick={() => setInvOnlyVanStock((prev) => !prev)}
                  className={`min-h-[34px] px-2.5 rounded-xl border text-[11px] font-bold cursor-pointer ${
                    invOnlyVanStock
                      ? 'bg-emerald-700 text-white border-emerald-800'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  {invOnlyVanStock ? 'المتاح بالسيارة فقط ✓' : 'تصفية: المتاح بالسيارة'}
                </button>
              </div>

              <div className="relative">
                <Barcode className="w-4 h-4 text-blue-800 absolute right-3 top-3 pointer-events-none" />
                <input
                  type="text"
                  value={invProdQuery}
                  onChange={(e) => setInvProdQuery(e.target.value)}
                  onKeyDown={handleInvoiceSearchKeyDown}
                  placeholder="ابحث بالاسم أو الكود أو امسح الباركود واضغط Enter..."
                  className="w-full min-h-[42px] rounded-xl border border-blue-300 pr-9 pl-8 bg-white font-semibold"
                />
                {invProdQuery && (
                  <button
                    type="button"
                    onClick={() => setInvProdQuery('')}
                    className="absolute left-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {invProdQuery.trim() && filteredInvoiceProducts.length > 0 && (
                <div className="max-h-44 overflow-y-auto bg-white rounded-xl border border-blue-200 divide-y divide-slate-100">
                  {filteredInvoiceProducts.slice(0, 20).map((p) => {
                    const vanQty = p.stockPerWarehouse?.[effectiveVanId] || 0;
                    const mainQty = mainWarehouse ? p.stockPerWarehouse?.[mainWarehouse.id] || 0 : 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          handleSelectProduct(p.id);
                          setInvProdQuery('');
                        }}
                        className="w-full text-right px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 block truncate">{p.name}</span>
                          <span className="text-[10px] font-mono text-slate-500">
                            {p.code} {p.barcode ? `| ${p.barcode}` : ''}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] font-bold text-blue-900 shrink-0">
                          سيارة: {vanQty} | رئيسي: {mainQty} {p.baseUnit}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <select
                value={invProductId}
                onChange={(e) => handleSelectProduct(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-blue-300 px-3 font-bold bg-white"
              >
                <option value="">-- أو اختر الصنف من القائمة ({filteredInvoiceProducts.length}) --</option>
                {filteredInvoiceProducts.map((p) => {
                  const vanQty = p.stockPerWarehouse?.[effectiveVanId] || 0;
                  const mainQty = mainWarehouse ? p.stockPerWarehouse?.[mainWarehouse.id] || 0 : 0;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} (سيارتي: {vanQty} | الرئيسي: {mainQty} {p.baseUnit})
                    </option>
                  );
                })}
              </select>

              {selectedProduct && invCustomerId && (
                <div className="p-2.5 rounded-xl bg-white border border-blue-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-blue-950">
                    <History className="w-4 h-4 shrink-0" />
                    <span>آخر 3 أسعار بيع لهذا العميل:</span>
                  </div>
                  {selectedProdLastPrices.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedProdLastPrices.map((entry, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setInvPrice(entry.price)}
                          className="min-h-[38px] px-3 py-1 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-950 font-mono font-bold text-[11px] cursor-pointer"
                        >
                          {entry.price} {data.settings.currency}
                          {entry.date ? ` · ${entry.date}` : ''}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">لا يوجد سجل أسعار سابق لهذا العميل بهذا الصنف.</p>
                  )}
                </div>
              )}

              {selectedProduct && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">الوحدة</label>
                    <select
                      value={invUnitName}
                      onChange={(e) => handleUnitChange(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-2 bg-white font-bold"
                    >
                      {selectedProduct.units.map((u) => (
                        <option key={u.id} value={u.name}>
                          {u.name} ({u.conversionFactor})
                        </option>
                      ))}
                      <option value={selectedProduct.baseUnit}>{selectedProduct.baseUnit}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">الكمية</label>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={invQty}
                      onChange={setInvQty}
                      ariaLabel="كمية الصنف"
                      inputClassName="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">السعر</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      value={invPrice}
                      onChange={(e) => setInvPrice(Math.max(0, Number(e.target.value)))}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">خصم البند</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      value={invLineDiscount}
                      onChange={(e) => setInvLineDiscount(Math.max(0, Number(e.target.value)))}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                </div>
              )}

              {selectedProduct && (
                <button
                  type="button"
                  onClick={handleAddInvoiceItem}
                  className="w-full min-h-[44px] rounded-xl bg-blue-900 text-white font-black flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة الصنف للفاتورة</span>
                </button>
              )}
            </div>

            {invItems.length > 0 && (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl px-3">
                {invItems.map((it, idx) => (
                  <div key={idx} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-900 truncate">{it.productName}</p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {it.unit} × {it.unitPrice.toLocaleString()}
                        {it.discount > 0 ? ` (خصم ${it.discount.toLocaleString()})` : ''} ={' '}
                        <strong className="text-blue-950">{it.total.toLocaleString()}</strong> {data.settings.currency}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <QuantityInput
                        showSteppers
                        allowDecimals
                        min={0.001}
                        value={it.quantity}
                        onChange={(q) => handleUpdateInvItemQty(idx, q)}
                        onRemoveWhenZero={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                        ariaLabel={`كمية ${it.productName}`}
                      />
                      <button
                        type="button"
                        onClick={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {shortageItems.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-black">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>عجز في مخزون سيارتك لعدد ({shortageItems.length}) أصناف — لا يمكن الاعتماد المباشر</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  {shortageItems.map((sh) => (
                    <div key={sh.productId} className="flex items-center justify-between font-mono">
                      <span className="font-sans font-bold">{sh.productName}</span>
                      <span className="text-red-700">
                        المتاح بالسيارة: {sh.availableInVanQty} · العجز: {sh.shortageQty} {sh.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {invItems.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'cash' as const, label: 'نقدي' },
                    { key: 'credit' as const, label: 'آجل' },
                    { key: 'partial' as const, label: 'جزئي' },
                  ].map((pt) => (
                    <button
                      key={pt.key}
                      type="button"
                      onClick={() => setInvPaymentType(pt.key)}
                      className={`min-h-[42px] rounded-xl border font-bold cursor-pointer ${
                        invPaymentType === pt.key
                          ? 'bg-blue-900 text-white border-blue-900'
                          : 'bg-slate-50 text-slate-700 border-slate-300'
                      }`}
                    >
                      {pt.label}
                    </button>
                  ))}
                </div>

                {invPaymentType === 'partial' && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">المدفوع نقداً الآن</label>
                    <input
                      type="number"
                      min={0}
                      max={invGrandTotal}
                      value={invPaidAmount}
                      onChange={(e) => setInvPaidAmount(Number(e.target.value))}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
                    />
                  </div>
                )}

                {invPaymentType !== 'credit' && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الخزينة</label>
                    <select
                      value={invCashboxId}
                      onChange={(e) => setInvCashboxId(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 bg-white font-bold"
                    >
                      {data.cashboxes.map((cb) => (
                        <option key={cb.id} value={cb.id}>
                          {cb.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <input
                  type="text"
                  value={invNotes}
                  onChange={(e) => setInvNotes(e.target.value)}
                  placeholder="ملاحظات الفاتورة (اختياري)..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
                />

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5 tabular-nums">
                  <div className="flex items-center justify-between font-black text-sm text-blue-950">
                    <span>إجمالي الفاتورة:</span>
                    <span className="font-mono">
                      {invGrandTotal.toLocaleString()} {data.settings.currency}
                    </span>
                  </div>
                  {selectedInvoiceCustomer && (
                    <div className="pt-1.5 border-t border-slate-200 grid grid-cols-2 gap-1.5 text-[11px] text-slate-700">
                      <div>
                        رصيد العميل قبل الفاتورة:{' '}
                        <strong className="font-mono">
                          {selectedInvoiceCustomer.currentBalance.toLocaleString()}
                        </strong>
                      </div>
                      <div>
                        المدفوع الآن:{' '}
                        <strong className="font-mono text-emerald-700">
                          {effectiveInvPaid.toLocaleString()}
                        </strong>
                      </div>
                      <div>
                        المتبقي المضاف للحساب:{' '}
                        <strong className="font-mono text-amber-800">
                          {Math.max(0, invGrandTotal - effectiveInvPaid).toLocaleString()}
                        </strong>
                      </div>
                      <div>
                        الرصيد بعد الفاتورة:{' '}
                        <strong className="font-mono text-blue-950">
                          {(
                            Number(selectedInvoiceCustomer.currentBalance || 0) +
                            Math.max(0, invGrandTotal - effectiveInvPaid)
                          ).toLocaleString()}{' '}
                          {data.settings.currency}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>

                {shortageItems.length > 0 ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft_with_transfer')}
                      className="w-full min-h-[48px] rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-black cursor-pointer disabled:opacity-50"
                    >
                      {isSubmittingInvoice ? 'جاري الحفظ...' : 'حفظ كمسودة وإرسال طلب تحويل للعجز'}
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft')}
                      className="w-full min-h-[44px] rounded-2xl bg-slate-200 text-slate-800 font-bold cursor-pointer"
                    >
                      حفظ كمسودة فقط
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft')}
                      className="min-h-[48px] rounded-2xl bg-slate-200 text-slate-800 font-bold cursor-pointer"
                    >
                      حفظ كمسودة
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('confirmed')}
                      className="min-h-[48px] rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
                    >
                      {isSubmittingInvoice ? 'جاري الإصدار...' : 'اعتماد وإصدار'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== NEW PURCHASE INVOICE ==================== */}
      {activeTab === 'new-purchase' && (
        <form onSubmit={handleCreatePurchaseInvoice} className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900">إنشاء فاتورة مشتريات جديدة</h3>
            <button
              type="button"
              onClick={() => onTabChange('new-supplier')}
              className="min-h-[40px] px-3 rounded-xl bg-purple-50 text-purple-900 border border-purple-200 font-bold cursor-pointer"
            >
              + مورد جديد
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">المورد:</label>
              <select
                value={purSupplierId}
                onChange={(e) => setPurSupplierId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
              >
                <option value="">-- اختر المورد --</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">مخزن الاستلام:</label>
              <select
                value={purWarehouseId}
                onChange={(e) => setPurWarehouseId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
              >
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-indigo-50/70 border border-indigo-200 space-y-2.5">
            <select
              value={purProductId}
              onChange={(e) => handleSelectPurProduct(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-indigo-300 px-3 font-bold bg-white"
            >
              <option value="">-- اختر الصنف للشراء --</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (تكلفة: {p.purchasePrice} {data.settings.currency})
                </option>
              ))}
            </select>
            {purProductId && (
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={purUnitName}
                  onChange={(e) => setPurUnitName(e.target.value)}
                  className="min-h-[42px] rounded-xl border border-slate-300 px-2 text-center font-bold bg-white"
                  placeholder="الوحدة"
                />
                <QuantityInput
                  allowDecimals
                  min={0.001}
                  value={purQty}
                  onChange={setPurQty}
                  ariaLabel="كمية الشراء"
                  inputClassName="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                />
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  value={purPrice}
                  onChange={(e) => setPurPrice(Math.max(0, Number(e.target.value)))}
                  className="min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                />
              </div>
            )}
            {purProductId && (
              <button
                type="button"
                onClick={handleAddPurItem}
                className="w-full min-h-[44px] rounded-xl bg-indigo-900 text-white font-black cursor-pointer"
              >
                إضافة الصنف لفاتورة الشراء
              </button>
            )}
          </div>

          {purItems.length > 0 && (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl px-3">
              {purItems.map((it, idx) => (
                <div key={idx} className="py-2 flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">
                    {it.productName} ({it.quantity} {it.unit} × {it.unitPrice})
                  </span>
                  <div className="flex items-center gap-2">
                    <strong className="font-mono text-indigo-950">{it.total.toLocaleString()}</strong>
                    <button
                      type="button"
                      onClick={() => setPurItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-red-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'cash' as const, label: 'نقدي' },
              { key: 'credit' as const, label: 'آجل' },
              { key: 'partial' as const, label: 'جزئي' },
            ].map((pt) => (
              <button
                key={pt.key}
                type="button"
                onClick={() => setPurPaymentType(pt.key)}
                className={`min-h-[42px] rounded-xl border font-bold cursor-pointer ${
                  purPaymentType === pt.key
                    ? 'bg-indigo-900 text-white border-indigo-900'
                    : 'bg-slate-50 text-slate-700 border-slate-300'
                }`}
              >
                {pt.label}
              </button>
            ))}
          </div>

          {purPaymentType === 'partial' && (
            <input
              type="number"
              min={0}
              max={purTotal}
              value={purPaidAmount}
              onChange={(e) => setPurPaidAmount(Number(e.target.value))}
              placeholder="المدفوع للمورد الآن"
              className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
            />
          )}

          {purPaymentType !== 'credit' && (
            <select
              value={purCashboxId}
              onChange={(e) => setPurCashboxId(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 bg-white font-bold"
            >
              {data.cashboxes.map((cb) => (
                <option key={cb.id} value={cb.id}>
                  {cb.name}
                </option>
              ))}
            </select>
          )}

          <input
            type="text"
            value={purNotes}
            onChange={(e) => setPurNotes(e.target.value)}
            placeholder="ملاحظات فاتورة الشراء..."
            className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
          />

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between font-black">
            <span>إجمالي فاتورة الشراء:</span>
            <strong className="font-mono text-indigo-950">
              {purTotal.toLocaleString()} {data.settings.currency}
            </strong>
          </div>

          <button
            type="submit"
            disabled={isSubmittingPurchase || purItems.length === 0}
            className="w-full min-h-[48px] rounded-2xl bg-indigo-900 hover:bg-indigo-950 text-white font-black disabled:opacity-50 cursor-pointer"
          >
            {isSubmittingPurchase ? 'جاري الحفظ...' : 'اعتماد وحفظ فاتورة الشراء'}
          </button>
        </form>
      )}

      {/* ==================== SALES RETURN ==================== */}
      {activeTab === 'sales-return' && (
        <form onSubmit={handleSubmitSalesReturn} className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
          <h3 className="text-sm font-black text-rose-900">تسجيل مرتجع مبيعات</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={sRetCustomerId}
              onChange={(e) => setSRetCustomerId(e.target.value)}
              className="min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="">-- اختر العميل --</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.shopName || c.name}</option>
              ))}
            </select>
            <select
              value={sRetInvoiceId}
              onChange={(e) => setSRetInvoiceId(e.target.value)}
              className="min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="">-- ربط بفاتورة بيع (اختياري) --</option>
              {myInvoices.filter((i) => !sRetCustomerId || i.customerId === sRetCustomerId).map((i) => (
                <option key={i.id} value={i.id}>{i.invoiceNumber} ({i.grandTotal})</option>
              ))}
            </select>
          </div>

          <div className="p-3 rounded-2xl bg-rose-50/70 border border-rose-200 space-y-2">
            <select
              value={sRetProductId}
              onChange={(e) => {
                setSRetProductId(e.target.value);
                const p = activeProducts.find((x) => x.id === e.target.value);
                if (p) setSRetPrice(p.sellingPrice);
              }}
              className="w-full min-h-[44px] rounded-xl border border-rose-300 px-3 font-bold bg-white"
            >
              <option value="">-- اختر الصنف المرتجع --</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.baseUnit})</option>
              ))}
            </select>
            {sRetProductId && (
              <div className="grid grid-cols-2 gap-2">
                <QuantityInput
                  allowDecimals
                  min={0.001}
                  value={sRetQty}
                  onChange={setSRetQty}
                  ariaLabel="كمية المرتجع"
                  inputClassName="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                />
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={sRetPrice}
                  onChange={(e) => setSRetPrice(Number(e.target.value))}
                  className="min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                />
              </div>
            )}
            {sRetProductId && (
              <button
                type="button"
                onClick={() => {
                  const p = activeProducts.find((x) => x.id === sRetProductId);
                  if (!p || sRetQty <= 0) return;
                  setSRetItems((prev) => [
                    ...prev,
                    {
                      productId: p.id,
                      productName: p.name,
                      unit: p.baseUnit,
                      unitFactor: 1,
                      quantity: sRetQty,
                      unitPrice: sRetPrice,
                      total: computeLineTotal(sRetQty, sRetPrice),
                    },
                  ]);
                  setSRetProductId('');
                  setSRetQty(1);
                }}
                className="w-full min-h-[44px] rounded-xl bg-rose-700 text-white font-black cursor-pointer"
              >
                إضافة لمرتجع البيع
              </button>
            )}
          </div>

          {sRetItems.length > 0 && (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl px-3">
              {sRetItems.map((it, idx) => (
                <div key={idx} className="py-2 flex items-center justify-between">
                  <span className="font-bold">{it.productName} ({it.quantity} × {it.unitPrice})</span>
                  <div className="flex items-center gap-2">
                    <strong className="font-mono text-rose-800">{it.total.toLocaleString()}</strong>
                    <button
                      type="button"
                      onClick={() => setSRetItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-red-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <select
              value={sRetSettlement}
              onChange={(e) => setSRetSettlement(e.target.value as 'account' | 'cash')}
              className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="account">خصم من رصيد العميل</option>
              <option value="cash">صرف نقدي من الخزينة</option>
            </select>
            <select
              value={sRetWarehouseId}
              onChange={(e) => setSRetWarehouseId(e.target.value)}
              className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          {sRetSettlement === 'cash' && (
            <select
              value={sRetCashboxId}
              onChange={(e) => setSRetCashboxId(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              {data.cashboxes.map((cb) => (
                <option key={cb.id} value={cb.id}>{cb.name}</option>
              ))}
            </select>
          )}

          <input
            type="text"
            value={sRetReason}
            onChange={(e) => setSRetReason(e.target.value)}
            placeholder="سبب المرتجع..."
            className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
          />

          <button
            type="submit"
            disabled={isSubmittingSRet || sRetItems.length === 0}
            className="w-full min-h-[48px] rounded-2xl bg-rose-700 hover:bg-rose-800 text-white font-black disabled:opacity-50 cursor-pointer"
          >
            {isSubmittingSRet ? 'جاري التسجيل...' : `اعتماد مرتجع البيع (${sRetTotal.toLocaleString()} ${data.settings.currency})`}
          </button>
        </form>
      )}

      {/* ==================== PURCHASE RETURN ==================== */}
      {activeTab === 'purchase-return' && (
        <form onSubmit={handleSubmitPurchaseReturn} className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
          <h3 className="text-sm font-black text-orange-900">تسجيل مرتجع مشتريات</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={pRetSupplierId}
              onChange={(e) => setPRetSupplierId(e.target.value)}
              className="min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="">-- اختر المورد --</option>
              {data.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              value={pRetInvoiceId}
              onChange={(e) => setPRetInvoiceId(e.target.value)}
              className="min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="">-- ربط بفاتورة شراء (اختياري) --</option>
              {myPurchases.filter((i) => !pRetSupplierId || i.supplierId === pRetSupplierId).map((i) => (
                <option key={i.id} value={i.id}>{i.invoiceNumber} ({i.grandTotal})</option>
              ))}
            </select>
          </div>

          <div className="p-3 rounded-2xl bg-orange-50/70 border border-orange-200 space-y-2">
            <select
              value={pRetProductId}
              onChange={(e) => {
                setPRetProductId(e.target.value);
                const p = activeProducts.find((x) => x.id === e.target.value);
                if (p) setPRetPrice(p.purchasePrice);
              }}
              className="w-full min-h-[44px] rounded-xl border border-orange-300 px-3 font-bold bg-white"
            >
              <option value="">-- اختر الصنف المرتجع للمورد --</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.baseUnit})</option>
              ))}
            </select>
            {pRetProductId && (
              <div className="grid grid-cols-2 gap-2">
                <QuantityInput
                  allowDecimals
                  min={0.001}
                  value={pRetQty}
                  onChange={setPRetQty}
                  ariaLabel="كمية مرتجع الشراء"
                  inputClassName="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                />
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={pRetPrice}
                  onChange={(e) => setPRetPrice(Number(e.target.value))}
                  className="min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                />
              </div>
            )}
            {pRetProductId && (
              <button
                type="button"
                onClick={() => {
                  const p = activeProducts.find((x) => x.id === pRetProductId);
                  if (!p || pRetQty <= 0) return;
                  setPRetItems((prev) => [
                    ...prev,
                    {
                      productId: p.id,
                      productName: p.name,
                      unit: p.baseUnit,
                      unitFactor: 1,
                      quantity: pRetQty,
                      unitPrice: pRetPrice,
                      total: computeLineTotal(pRetQty, pRetPrice),
                    },
                  ]);
                  setPRetProductId('');
                  setPRetQty(1);
                }}
                className="w-full min-h-[44px] rounded-xl bg-orange-700 text-white font-black cursor-pointer"
              >
                إضافة لمرتجع الشراء
              </button>
            )}
          </div>

          {pRetItems.length > 0 && (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl px-3">
              {pRetItems.map((it, idx) => (
                <div key={idx} className="py-2 flex items-center justify-between">
                  <span className="font-bold">{it.productName} ({it.quantity} × {it.unitPrice})</span>
                  <div className="flex items-center gap-2">
                    <strong className="font-mono text-orange-800">{it.total.toLocaleString()}</strong>
                    <button
                      type="button"
                      onClick={() => setPRetItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-red-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <select
              value={pRetSettlement}
              onChange={(e) => setPRetSettlement(e.target.value as 'account' | 'cash')}
              className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="account">خصم من رصيد المورد</option>
              <option value="cash">استرداد نقدي للخزينة</option>
            </select>
            <select
              value={pRetWarehouseId}
              onChange={(e) => setPRetWarehouseId(e.target.value)}
              className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <input
            type="text"
            value={pRetReason}
            onChange={(e) => setPRetReason(e.target.value)}
            placeholder="سبب مرتجع الشراء..."
            className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
          />

          <button
            type="submit"
            disabled={isSubmittingPRet || pRetItems.length === 0}
            className="w-full min-h-[48px] rounded-2xl bg-orange-700 hover:bg-orange-800 text-white font-black disabled:opacity-50 cursor-pointer"
          >
            {isSubmittingPRet ? 'جاري التسجيل...' : `اعتماد مرتجع الشراء (${pRetTotal.toLocaleString()} ${data.settings.currency})`}
          </button>
        </form>
      )}

      {/* ==================== CASH DEPOSIT / COLLECTION ==================== */}
      {activeTab === 'cash-deposit' && (
        <form onSubmit={handleSubmitCashDeposit} className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
          <h3 className="text-sm font-black text-emerald-900">إيداع نقدي / تحصيل من عميل</h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDepMode('customer_collection')}
              className={`min-h-[42px] rounded-xl font-bold border cursor-pointer ${
                depMode === 'customer_collection'
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-slate-50 text-slate-700 border-slate-300'
              }`}
            >
              تحصيل من عميل
            </button>
            <button
              type="button"
              disabled={!canCashOps}
              onClick={() => setDepMode('cashbox_deposit')}
              className={`min-h-[42px] rounded-xl font-bold border cursor-pointer disabled:opacity-45 ${
                depMode === 'cashbox_deposit'
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-slate-50 text-slate-700 border-slate-300'
              }`}
            >
              {canCashOps ? 'إيداع مباشر بالخزينة' : 'إيداع بالخزينة (مقيد)'}
            </button>
          </div>

          {depMode === 'customer_collection' && (
            <select
              value={depCustomerId}
              onChange={(e) => setDepCustomerId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="">-- اختر العميل --</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.shopName || c.name} — رصيد: {c.currentBalance}
                </option>
              ))}
            </select>
          )}

          <div className="grid grid-cols-2 gap-2">
            <select
              value={depCashboxId}
              onChange={(e) => setDepCashboxId(e.target.value)}
              className="min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              {data.cashboxes.map((cb) => (
                <option key={cb.id} value={cb.id}>{cb.name}</option>
              ))}
            </select>
            <select
              value={depMethod}
              onChange={(e) => setDepMethod(e.target.value as any)}
              className="min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="cash">نقدي</option>
              <option value="bank">تحويل بنكي</option>
              <option value="cheque">شيك</option>
            </select>
          </div>

          <input
            type="number"
            min={1}
            step="0.01"
            value={depAmount || ''}
            onChange={(e) => setDepAmount(Math.max(0, Number(e.target.value)))}
            placeholder={`المبلغ (${data.settings.currency})`}
            className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono font-black text-center text-emerald-800"
          />

          <input
            type="text"
            value={depNotes}
            onChange={(e) => setDepNotes(e.target.value)}
            placeholder="ملاحظات الإيداع / التحصيل..."
            className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
          />

          <button
            type="submit"
            disabled={isSubmittingDeposit}
            className="w-full min-h-[48px] rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
          >
            {isSubmittingDeposit ? 'جاري التسجيل...' : 'تأكيد الإيداع / التحصيل'}
          </button>
        </form>
      )}

      {/* ==================== CASH WITHDRAWAL ==================== */}
      {activeTab === 'cash-withdrawal' && (
        <form onSubmit={handleSubmitCashWithdrawal} className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
          <h3 className="text-sm font-black text-amber-900">سحب نقدي / تسجيل مصروف</h3>
          <select
            value={wdCashboxId}
            onChange={(e) => setWdCashboxId(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
          >
            {data.cashboxes.map((cb) => (
              <option key={cb.id} value={cb.id}>{cb.name} (رصيد: {cb.currentBalance.toLocaleString()})</option>
            ))}
          </select>
          <input
            type="text"
            value={wdCategory}
            onChange={(e) => setWdCategory(e.target.value)}
            placeholder="البند / التصنيف (مثال: بنزين / مصروف تشغيل)"
            className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-bold"
          />
          <input
            type="text"
            value={wdBeneficiary}
            onChange={(e) => setWdBeneficiary(e.target.value)}
            placeholder="المستفيد (اختياري)"
            className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
          />
          <input
            type="number"
            min={1}
            step="0.01"
            value={wdAmount || ''}
            onChange={(e) => setWdAmount(Math.max(0, Number(e.target.value)))}
            placeholder={`مبلغ السحب (${data.settings.currency})`}
            className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono font-black text-center text-red-700"
          />
          <input
            type="text"
            value={wdNotes}
            onChange={(e) => setWdNotes(e.target.value)}
            placeholder="بيان السحب / المصروف..."
            className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
          />
          <button
            type="submit"
            disabled={isSubmittingWithdrawal}
            className="w-full min-h-[48px] rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-black cursor-pointer disabled:opacity-50"
          >
            {isSubmittingWithdrawal ? 'جاري التسجيل...' : 'تأكيد السحب النقدي'}
          </button>
        </form>
      )}

      {/* ==================== NEW CUSTOMER (with Safe Call & Maps Icon Buttons) ==================== */}
      {activeTab === 'new-customer' && (() => {
        const helper = renderPhoneAndMapsActionRow(
          newCustPhone,
          newCustAddress || newCustArea,
          newCustGeo,
          setCustPhoneNotice,
          setCustMapNotice
        );
        return (
          <form onSubmit={handleSaveNewCustomer} className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-black text-slate-900">إضافة عميل جديد</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم العميل *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="الاسم الكامل للعميل"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المحل / النشاط</label>
                <input
                  type="text"
                  value={newCustShop}
                  onChange={(e) => setNewCustShop(e.target.value)}
                  placeholder="مثال: سوبرماركت النور"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">رقم الهاتف *</label>
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  required
                  value={newCustPhone}
                  onChange={(e) => {
                    setNewCustPhone(e.target.value);
                    if (custPhoneNotice) setCustPhoneNotice(null);
                  }}
                  placeholder="01012345678"
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
                />
                {helper.isPhoneValid ? (
                  <a
                    href={`tel:${helper.cleanedPhone}`}
                    onClick={() =>
                      setCustPhoneNotice({ type: 'info', text: `جاري الاتصال بالرقم (${helper.cleanedPhone}).` })
                    }
                    className="min-h-[44px] px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold inline-flex items-center gap-1.5 shrink-0"
                    title="اتصال هاتفي مباشر"
                  >
                    <Phone className="w-4 h-4" />
                    <span>اتصال</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setCustPhoneNotice({ type: 'error', text: 'يرجى إدخال رقم هاتف صحيح (7 أرقام على الأقل) أولاً.' })
                    }
                    className="min-h-[44px] px-3 rounded-xl bg-slate-100 text-slate-600 border border-slate-300 font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Phone className="w-4 h-4" />
                    <span>اتصال</span>
                  </button>
                )}
              </div>
              {custPhoneNotice && (
                <p className={`text-[11px] font-bold mt-1 ${custPhoneNotice.type === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
                  {custPhoneNotice.text}
                </p>
              )}
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">العنوان التفصيلي</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => {
                    setNewCustAddress(e.target.value);
                    if (custMapNotice) setCustMapNotice(null);
                  }}
                  placeholder="الشارع، المنطقة، علامة مميزة..."
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold"
                />
                {helper.mapQuery ? (
                  <a
                    href={helper.mapsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] px-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 font-bold inline-flex items-center gap-1.5 shrink-0"
                    title="فتح على خرائط Google"
                  >
                    <MapPin className="w-4 h-4 text-red-600" />
                    <span>خريطة</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCustMapNotice('يرجى كتابة العنوان أو تحديد إحداثيات GPS أولاً لفتح الخريطة.')}
                    className="min-h-[44px] px-3 rounded-xl bg-slate-100 text-slate-600 border border-slate-300 font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <MapPin className="w-4 h-4" />
                    <span>خريطة</span>
                  </button>
                )}
              </div>
              {custMapNotice && <p className="text-[11px] font-bold text-red-600 mt-1">{custMapNotice}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={newCustArea}
                onChange={(e) => setNewCustArea(e.target.value)}
                placeholder="المنطقة / خط السير"
                className="min-h-[42px] rounded-xl border border-slate-300 px-3"
              />
              <input
                type="number"
                value={newCustOpening || ''}
                onChange={(e) => setNewCustOpening(Number(e.target.value))}
                placeholder={`رصيد افتتاحي (${data.settings.currency})`}
                className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCustGeo}
                onChange={(e) => setNewCustGeo(e.target.value)}
                placeholder="إحداثيات GPS (اختياري)"
                className="flex-1 min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono"
              />
              <button
                type="button"
                disabled={isLocatingCust}
                onClick={handleCaptureCustLocation}
                className="min-h-[42px] px-3 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 font-bold cursor-pointer shrink-0"
              >
                {isLocatingCust ? 'تحديد...' : 'موقعي GPS'}
              </button>
            </div>

            <button
              type="submit"
              disabled={isSavingCustomer}
              className="w-full min-h-[48px] rounded-2xl bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isSavingCustomer ? 'جاري الحفظ...' : 'حفظ العميل الجديد'}
            </button>
          </form>
        );
      })()}

      {/* ==================== NEW SUPPLIER ==================== */}
      {activeTab === 'new-supplier' && (() => {
        const cleanedSupPhone = newSupPhone.replace(/[^\d+]/g, '');
        const supPhoneValid = cleanedSupPhone.replace(/\D/g, '').length >= 7;
        return (
          <form onSubmit={handleSaveNewSupplier} className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-black text-purple-950">إضافة مورد جديد</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={newSupName}
                onChange={(e) => setNewSupName(e.target.value)}
                placeholder="اسم المورد *"
                className="min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold"
              />
              <input
                type="text"
                value={newSupCompany}
                onChange={(e) => setNewSupCompany(e.target.value)}
                placeholder="اسم الشركة / المصنع"
                className="min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold"
              />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  required
                  value={newSupPhone}
                  onChange={(e) => {
                    setNewSupPhone(e.target.value);
                    if (supPhoneNotice) setSupPhoneNotice(null);
                  }}
                  placeholder="رقم الهاتف *"
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
                />
                {supPhoneValid ? (
                  <a
                    href={`tel:${cleanedSupPhone}`}
                    className="min-h-[44px] px-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold inline-flex items-center gap-1.5"
                  >
                    <Phone className="w-4 h-4" />
                    <span>اتصال</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setSupPhoneNotice({ type: 'error', text: 'يرجى إدخال رقم هاتف المورد (7 أرقام على الأقل).' })
                    }
                    className="min-h-[44px] px-3 rounded-xl bg-slate-100 text-slate-600 border border-slate-300 font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Phone className="w-4 h-4" />
                    <span>اتصال</span>
                  </button>
                )}
              </div>
              {supPhoneNotice && (
                <p className="text-[11px] font-bold text-red-600 mt-1">{supPhoneNotice.text}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={newSupAddress}
                onChange={(e) => setNewSupAddress(e.target.value)}
                placeholder="عنوان المورد"
                className="min-h-[42px] rounded-xl border border-slate-300 px-3"
              />
              <input
                type="number"
                value={newSupOpening || ''}
                onChange={(e) => setNewSupOpening(Number(e.target.value))}
                placeholder={`رصيد افتتاحي (${data.settings.currency})`}
                className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
              />
            </div>

            <button
              type="submit"
              disabled={isSavingSupplier}
              className="w-full min-h-[48px] rounded-2xl bg-purple-900 hover:bg-purple-950 text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isSavingSupplier ? 'جاري الحفظ...' : 'حفظ المورد الجديد'}
            </button>
          </form>
        );
      })()}

      {/* ==================== CHEQUES & INSTALLMENTS ==================== */}
      {activeTab === 'cheques-installments' && (
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-1.5 bg-white p-1.5 rounded-2xl border border-slate-200">
            <button
              type="button"
              onClick={() => setChqTab('cheques')}
              className={`min-h-[42px] rounded-xl font-black cursor-pointer ${
                chqTab === 'cheques' ? 'bg-teal-700 text-white' : 'text-slate-700'
              }`}
            >
              الشيكات ({data.cheques.length})
            </button>
            <button
              type="button"
              onClick={() => setChqTab('installments')}
              className={`min-h-[42px] rounded-xl font-black cursor-pointer ${
                chqTab === 'installments' ? 'bg-teal-700 text-white' : 'text-slate-700'
              }`}
            >
              الأقساط ({data.installments.length})
            </button>
          </div>

          {chqTab === 'cheques' && (
            <div className="space-y-3">
              <form onSubmit={handleAddCheque} className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-2.5">
                <h4 className="font-black text-slate-900">تسجيل شيك جديد</h4>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={chqType}
                    onChange={(e) => setChqType(e.target.value as 'incoming' | 'outgoing')}
                    className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
                  >
                    <option value="incoming">شيك وارد (تحصيل)</option>
                    <option value="outgoing">شيك صادر (سداد)</option>
                  </select>
                  <input
                    type="text"
                    value={chqNumber}
                    onChange={(e) => setChqNumber(e.target.value)}
                    placeholder="رقم الشيك"
                    className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={chqPartyName}
                    onChange={(e) => setChqPartyName(e.target.value)}
                    placeholder="اسم العميل / المورد"
                    className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-bold"
                  />
                  <input
                    type="text"
                    value={chqBank}
                    onChange={(e) => setChqBank(e.target.value)}
                    placeholder="اسم البنك"
                    className="min-h-[42px] rounded-xl border border-slate-300 px-3"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    value={chqAmount || ''}
                    onChange={(e) => setChqAmount(Number(e.target.value))}
                    placeholder="المبلغ"
                    className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
                  />
                  <input
                    type="date"
                    value={chqDueDate}
                    onChange={(e) => setChqDueDate(e.target.value)}
                    className="min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingCheque}
                  className="w-full min-h-[44px] rounded-xl bg-teal-700 text-white font-black cursor-pointer"
                >
                  {isSavingCheque ? 'جاري التسجيل...' : 'حفظ الشيك'}
                </button>
              </form>

              {data.cheques.map((chq) => (
                <div key={chq.id} className="bg-white rounded-2xl border border-slate-200 p-3.5 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-black text-blue-950">{chq.chequeNumber}</span>
                    <p className="text-[11px] text-slate-600">{chq.partyName} · {chq.bankName} · استحقاق {chq.dueDate}</p>
                  </div>
                  <div className="text-left">
                    <strong className="font-mono font-black text-slate-900">{chq.amount.toLocaleString()} {data.settings.currency}</strong>
                    <span className="block text-[10px] font-bold text-slate-500">
                      {chq.status === 'collected' ? 'محصل' : chq.status === 'rejected' || chq.status === 'returned' ? 'مرتد / مرفوض' : 'قيد الانتظار'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {chqTab === 'installments' && (
            <div className="space-y-3">
              {data.installments.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-slate-400">
                  لا توجد جداول أقساط نشطة حالياً.
                </div>
              ) : (
                data.installments.map((sched) => (
                  <div key={sched.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono font-black text-blue-950">{sched.scheduleNumber}</span>
                        <p className="text-[11px] text-slate-600">{sched.customerName}</p>
                      </div>
                      <strong className="font-mono text-red-700">متبقي: {sched.remainingAmount.toLocaleString()}</strong>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {(sched.items || []).filter((it) => it.status !== 'paid').slice(0, 3).map((it) => {
                        const key = `${sched.id}:${it.id}`;
                        return (
                          <div key={it.id} className="py-2 flex items-center justify-between gap-2">
                            <span className="font-mono">{it.dueDate} · {(it.amount - it.paidAmount).toLocaleString()} {data.settings.currency}</span>
                            <button
                              type="button"
                              disabled={payingInstKey === key}
                              onClick={async () => {
                                setPayingInstKey(key);
                                await data.payInstallment(sched.id, it.id, it.amount - it.paidAmount, data.cashboxes[0]?.id || 'CASH-01', 'تحصيل قسط عبر تطبيق المندوب');
                                setPayingInstKey(null);
                                setFeedback({ type: 'success', text: 'تم تحصيل القسط وتحديث الجدول.' });
                              }}
                              className="min-h-[38px] px-3 rounded-xl bg-emerald-700 text-white font-bold cursor-pointer"
                            >
                              {payingInstKey === key ? 'جاري التحصيل...' : 'تحصيل القسط'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== PRICE QUOTES (عرض سعر - Zero Stock/Balance Impact) ==================== */}
      {activeTab === 'new-quote' && (
        <div className="space-y-4 text-xs">
          <form onSubmit={handleCreateQuote} className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div>
              <h3 className="text-sm font-black text-blue-950">إنشاء عرض سعر (بدون خصم مخزني أو قيد مالي)</h3>
              <p className="text-[11px] text-slate-500">يمكن تحويل عرض السعر لاحقاً لفاتورة مبيعات معتمدة بضغطة واحدة.</p>
            </div>
            <select
              value={quoteCustomerId}
              onChange={(e) => setQuoteCustomerId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="">-- اختر العميل (أو عميل عام) --</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.shopName || c.name}</option>
              ))}
            </select>

            <div className="p-3 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-2">
              <select
                value={quoteProductId}
                onChange={(e) => handleSelectQuoteProduct(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-blue-300 px-3 font-bold bg-white"
              >
                <option value="">-- اختر الصنف لعرض السعر --</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sellingPrice} {data.settings.currency})</option>
                ))}
              </select>
              {quoteProductId && (
                <div className="grid grid-cols-2 gap-2">
                  <QuantityInput
                    allowDecimals
                    min={0.001}
                    value={quoteQty}
                    onChange={setQuoteQty}
                    ariaLabel="كمية عرض السعر"
                    inputClassName="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={quotePrice}
                    onChange={(e) => setQuotePrice(Number(e.target.value))}
                    className="min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                </div>
              )}
              {quoteProductId && (
                <button
                  type="button"
                  onClick={handleAddQuoteItem}
                  className="w-full min-h-[44px] rounded-xl bg-blue-900 text-white font-black cursor-pointer"
                >
                  إضافة للعرض
                </button>
              )}
            </div>

            {quoteItems.length > 0 && (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl px-3">
                {quoteItems.map((it, idx) => (
                  <div key={idx} className="py-2 flex items-center justify-between">
                    <span className="font-bold">{it.productName} ({it.quantity} × {it.unitPrice})</span>
                    <strong className="font-mono text-blue-950">{it.total.toLocaleString()}</strong>
                  </div>
                ))}
              </div>
            )}

            <input
              type="text"
              value={quoteNotes}
              onChange={(e) => setQuoteNotes(e.target.value)}
              placeholder="صلاحية العرض وملاحظات..."
              className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
            />

            <button
              type="submit"
              disabled={isSubmittingQuote || quoteItems.length === 0}
              className="w-full min-h-[48px] rounded-2xl bg-blue-900 hover:bg-blue-950 text-white font-black disabled:opacity-50 cursor-pointer"
            >
              {isSubmittingQuote ? 'جاري الحفظ...' : `حفظ عرض السعر (${quoteTotal.toLocaleString()} ${data.settings.currency})`}
            </button>
          </form>

          {myQuotes.length > 0 && (
            <div className="space-y-2.5">
              <h4 className="font-black text-slate-900 px-1">عروض الأسعار المسجلة ({myQuotes.length})</h4>
              {myQuotes.map((q) => {
                const isConverted = myInvoices.some((inv) => inv.convertedFromQuoteId === q.id);
                return (
                  <div key={q.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono font-black text-blue-950">{q.invoiceNumber}</span>
                        <p className="text-[11px] text-slate-500">{q.customerName} · {q.date}</p>
                      </div>
                      <strong className="font-mono font-black text-slate-900">{q.grandTotal.toLocaleString()} {data.settings.currency}</strong>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isConverted || convertingQuoteId === q.id}
                        onClick={() => handleConvertQuote(q.id)}
                        className="flex-1 min-h-[42px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black disabled:opacity-50 cursor-pointer"
                      >
                        {isConverted
                          ? 'تم التحويل لفاتورة'
                          : convertingQuoteId === q.id
                          ? 'جاري التحويل...'
                          : 'تحويل لفاتورة بيع'}
                      </button>
                      <button
                        type="button"
                        onClick={() => exportInvoiceDocument(q)}
                        className="min-h-[42px] px-3.5 rounded-xl bg-blue-900 text-white font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <FileDown className="w-4 h-4" />
                        <span>PDF</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== SALES INVOICES LIST (with needs_review badge) ==================== */}
      {activeTab === 'invoices' && (
        <div className="space-y-3">
          {myInvoices.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-xs text-slate-500">
              لا توجد فواتير مبيعات مسجلة حتى الآن.
            </div>
          ) : (
            myInvoices.map((inv) => {
              const confirmCheck = inv.status === 'draft' ? canConfirmDraft(inv) : { ready: false };
              return (
                <div
                  key={inv.id}
                  className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono font-black text-sm text-blue-950">
                        {inv.invoiceNumber}
                      </span>
                      <p className="text-[11px] text-slate-500">
                        {inv.customerName} · {inv.date}
                      </p>
                    </div>
                    <div className="text-left">
                      <strong className="font-mono text-sm text-slate-900 tabular-nums block">
                        {inv.grandTotal.toLocaleString()} {data.settings.currency}
                      </strong>
                      <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[11px]">
                        <span
                          className={`font-bold ${
                            inv.status === 'confirmed'
                              ? 'text-emerald-700'
                              : inv.status === 'draft'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          {inv.status === 'confirmed' ? 'معتمدة' : inv.status === 'draft' ? 'مسودة' : 'ملغاة'}
                        </span>
                        {inv.reviewStatus === 'needs_review' && (
                          <span className="text-amber-700 font-bold">· بانتظار مراجعة الإدارة</span>
                        )}
                        {inv.reviewStatus === 'reviewed' && (
                          <span className="text-blue-800 font-bold">· تمت المراجعة</span>
                        )}
                        {inv.syncStatus && inv.syncStatus !== 'synced' && (
                          <span className="inline-flex items-center gap-0.5 text-amber-800 font-bold">
                            <CloudOff className="w-3 h-3" />
                            <span>محلي</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {inv.status === 'draft' && inv.linkedRepTransferNumber && (
                    <p className="text-[11px] text-blue-900 font-bold">
                      مرتبطة بطلب تحويل: {inv.linkedRepTransferNumber}
                      {!confirmCheck.ready && confirmCheck.reason ? ` — ${confirmCheck.reason}` : ''}
                    </p>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    {inv.status === 'draft' && (
                      <button
                        type="button"
                        disabled={!confirmCheck.ready}
                        onClick={() => handleConfirmDraft(inv)}
                        className="flex-1 min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black disabled:opacity-45 cursor-pointer"
                      >
                        اعتماد نهائي
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="min-h-[44px] px-3.5 rounded-xl bg-slate-100 text-slate-800 font-bold cursor-pointer"
                    >
                      التفاصيل
                    </button>
                    <button
                      type="button"
                      onClick={() => exportInvoiceDocument(inv)}
                      className="min-h-[44px] px-3.5 rounded-xl bg-blue-900 text-white font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {isNative ? <Share2 className="w-4 h-4" /> : <FileDown className="w-4 h-4" />}
                      <span>{isNative ? 'مشاركة' : 'PDF'}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ==================== PURCHASES LIST & RETURNS LISTS (FROM "المزيد") ==================== */}
      {activeTab === 'purchases-list' && (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900">فواتير الشراء ({myPurchases.length})</h3>
            <button
              type="button"
              onClick={() => onTabChange('new-purchase')}
              className="min-h-[40px] px-3 rounded-xl bg-indigo-900 text-white font-bold cursor-pointer"
            >
              + فاتورة شراء
            </button>
          </div>
          {myPurchases.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-slate-400">
              لا توجد فواتير مشتريات مسجلة.
            </div>
          ) : (
            myPurchases.map((inv) => (
              <div key={inv.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                <div>
                  <span className="font-mono font-black text-indigo-950">{inv.invoiceNumber}</span>
                  <p className="text-[11px] text-slate-500">{inv.supplierName} · {inv.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <strong className="font-mono text-slate-900">{inv.grandTotal.toLocaleString()} {data.settings.currency}</strong>
                  <button
                    type="button"
                    onClick={() => exportInvoiceDocument(inv)}
                    className="min-h-[40px] px-3 rounded-xl bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    PDF
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'sales-returns-list' && (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-rose-950">مرتجعات البيع ({mySalesReturns.length})</h3>
            <button
              type="button"
              onClick={() => onTabChange('sales-return')}
              className="min-h-[40px] px-3 rounded-xl bg-rose-700 text-white font-bold cursor-pointer"
            >
              + مرتجع بيع
            </button>
          </div>
          {mySalesReturns.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-slate-400">
              لا توجد مرتجعات مبيعات.
            </div>
          ) : (
            mySalesReturns.map((r: InvoiceReturn) => (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                <div>
                  <span className="font-mono font-black text-rose-900">{r.returnNumber}</span>
                  <p className="text-[11px] text-slate-500">{r.partyName} · {r.date}</p>
                </div>
                <strong className="font-mono text-rose-800">{r.grandTotal.toLocaleString()} {data.settings.currency}</strong>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'purchase-returns-list' && (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-orange-950">مرتجعات الشراء ({myPurchaseReturns.length})</h3>
            <button
              type="button"
              onClick={() => onTabChange('purchase-return')}
              className="min-h-[40px] px-3 rounded-xl bg-orange-700 text-white font-bold cursor-pointer"
            >
              + مرتجع شراء
            </button>
          </div>
          {myPurchaseReturns.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-slate-400">
              لا توجد مرتجعات مشتريات.
            </div>
          ) : (
            myPurchaseReturns.map((r: InvoiceReturn) => (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                <div>
                  <span className="font-mono font-black text-orange-900">{r.returnNumber}</span>
                  <p className="text-[11px] text-slate-500">{r.partyName} · {r.date}</p>
                </div>
                <strong className="font-mono text-orange-800">{r.grandTotal.toLocaleString()} {data.settings.currency}</strong>
              </div>
            ))
          )}
        </div>
      )}

      {/* ==================== CUSTODY & TRANSFERS ==================== */}
      {(activeTab === 'custody' || activeTab === 'custody-transfer') && (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-1 bg-white p-1.5 rounded-2xl border border-slate-200 text-[11px]">
            {[
              { key: 'van' as const, label: 'السيارة' },
              { key: 'items' as const, label: `تحويل (${myItemTransfers.length})` },
              { key: 'deliver' as const, label: 'تسليم' },
              { key: 'return' as const, label: 'إرجاع مخزن' },
              { key: 'cash' as const, label: `نقدي (${myCashTransfers.length})` },
            ].map((st) => (
              <button
                key={st.key}
                type="button"
                onClick={() => setCustodySubTab(st.key)}
                className={`min-h-[42px] rounded-xl font-bold px-1 cursor-pointer truncate ${
                  custodySubTab === st.key ? 'bg-blue-900 text-white' : 'text-slate-600'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {custodySubTab === 'van' && (
            <div className="space-y-3 text-xs">
              {custodyStatement && (
                <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-3 shadow-xs tabular-nums">
                  <div className="flex items-center justify-between">
                    <h4 className="font-black text-sm">كشف عهدة السيارة التراكمي</h4>
                    <button
                      type="button"
                      onClick={loadCustodyStatement}
                      disabled={isLoadingCustodyStmt}
                      className="px-2.5 py-1 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCustodyStmt ? 'animate-spin' : ''}`} />
                      <span>تحديث</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                    <div className="p-2 rounded-xl bg-white/10">
                      <span className="text-[10px] text-slate-300 block">إجمالي المستلم</span>
                      <strong className="font-mono text-sm">{custodyStatement.totals.totalReceivedQty}</strong>
                    </div>
                    <div className="p-2 rounded-xl bg-white/10">
                      <span className="text-[10px] text-slate-300 block">المسلم للعملاء</span>
                      <strong className="font-mono text-sm text-sky-300">{custodyStatement.totals.totalDeliveredQty}</strong>
                    </div>
                    <div className="p-2 rounded-xl bg-white/10">
                      <span className="text-[10px] text-slate-300 block">المرتجع للمخزن</span>
                      <strong className="font-mono text-sm text-amber-300">{custodyStatement.totals.totalReturnedQty}</strong>
                    </div>
                    <div className="p-2 rounded-xl bg-emerald-800/70">
                      <span className="text-[10px] text-emerald-200 block">المتبقي الفعلي</span>
                      <strong className="font-mono text-sm">{custodyStatement.totals.totalRemainingCustodyQty}</strong>
                    </div>
                    <div className="p-2 rounded-xl bg-blue-800/70 col-span-2 sm:col-span-1">
                      <span className="text-[10px] text-blue-200 block">القيمة بالتكلفة</span>
                      <strong className="font-mono text-sm">
                        {custodyStatement.totals.totalCustodyCostValue.toLocaleString()} {data.settings.currency}
                      </strong>
                    </div>
                  </div>
                  {custodyStatement.itemsSummary.length > 0 && (
                    <div className="bg-white/5 rounded-xl p-2.5 space-y-1.5">
                      <span className="text-[10px] text-slate-300 font-bold block">تفاصيل حركة العهدة لكل صنف:</span>
                      {custodyStatement.itemsSummary.map((item) => (
                        <div key={item.productId} className="flex items-center justify-between gap-2 text-[11px] border-b border-white/10 pb-1 last:border-0 last:pb-0">
                          <span className="font-bold truncate">{item.productName}</span>
                          <span className="font-mono text-slate-200 shrink-0">
                            مستلم {item.receivedQty} | مباع {item.deliveredToCustomersQty} | مرتجع {item.returnedToWarehouseQty} | متبقي{' '}
                            <strong className="text-emerald-300">{item.remainingCustodyQty}</strong>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-slate-900">
                    أرصدة البضاعة الحالية في: {vanWarehouse?.name || 'سيارة المندوب'}
                  </h4>
                  {!custodyStatement && (
                    <button
                      type="button"
                      onClick={loadCustodyStatement}
                      disabled={isLoadingCustodyStmt}
                      className="text-blue-900 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCustodyStmt ? 'animate-spin' : ''}`} />
                      <span>كشف العهدة</span>
                    </button>
                  )}
                </div>
                <div className="divide-y divide-slate-100">
                  {activeProducts
                    .filter((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) > 0)
                    .map((p) => (
                      <div key={p.id} className="py-2.5 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-slate-900">{p.name}</p>
                          <p className="text-[11px] text-slate-500">{p.category}</p>
                        </div>
                        <strong className="font-mono text-sm text-blue-950 tabular-nums">
                          {p.stockPerWarehouse?.[effectiveVanId] || 0} {p.baseUnit}
                        </strong>
                      </div>
                    ))}
                  {activeProducts.every((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) <= 0) && (
                    <p className="py-6 text-center text-slate-400">لا توجد بضاعة متوفرة حالياً داخل مستودع السيارة.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {custodySubTab === 'deliver' && (
            <form
              onSubmit={handleRecordPartialCustodyDelivery}
              className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs"
            >
              <h4 className="font-black text-slate-900">تسليم جزئي من عهدة السيارة إلى عميل</h4>
              <select
                value={delivCustomerId}
                onChange={(e) => setDelivCustomerId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 bg-white font-bold"
              >
                <option value="">-- اختر العميل المستلم (اختياري) --</option>
                {data.customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.shopName || c.name}</option>
                ))}
              </select>
              <select
                value={delivProdId}
                onChange={(e) => setDelivProdId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 bg-white font-bold"
              >
                <option value="">-- اختر الصنف من العهدة --</option>
                {activeProducts.filter((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) > 0).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (متاح: {p.stockPerWarehouse?.[effectiveVanId] || 0} {p.baseUnit})
                  </option>
                ))}
              </select>
              <QuantityInput
                allowDecimals
                min={0.001}
                value={delivQty}
                onChange={setDelivQty}
                ariaLabel="الكمية المسلمة"
                inputClassName="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
              />
              <input
                type="text"
                value={delivNotes}
                onChange={(e) => setDelivNotes(e.target.value)}
                placeholder="ملاحظات التسليم..."
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
              />
              <button
                type="submit"
                disabled={isSendingTransfer}
                className="w-full min-h-[46px] rounded-xl bg-emerald-700 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSendingTransfer ? 'جاري التسجيل...' : 'تأكيد تسليم العهدة'}
              </button>
            </form>
          )}

          {custodySubTab === 'return' && (
            <form
              onSubmit={handleRecordCustodyReturn}
              className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 text-xs"
            >
              <h4 className="font-black text-slate-900">إرجاع بضاعة من عهدة السيارة إلى المخزن</h4>
              <select
                value={retCustodyProdId}
                onChange={(e) => {
                  const pId = e.target.value;
                  setRetCustodyProdId(pId);
                  const prod = activeProducts.find((p) => p.id === pId);
                  setRetCustodyUnit(prod?.baseUnit || '');
                }}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 bg-white font-bold"
              >
                <option value="">-- اختر الصنف المرتجع من السيارة --</option>
                {activeProducts
                  .filter((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) > 0)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (متاح بالسيارة: {p.stockPerWarehouse?.[effectiveVanId] || 0} {p.baseUnit})
                    </option>
                  ))}
              </select>

              {(() => {
                const retProd = activeProducts.find((p) => p.id === retCustodyProdId);
                return (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={retCustodyUnit || retProd?.baseUnit || ''}
                      onChange={(e) => setRetCustodyUnit(e.target.value)}
                      disabled={!retProd}
                      className="min-h-[42px] rounded-xl border border-slate-300 px-2 bg-white font-bold disabled:opacity-50"
                    >
                      {retProd ? (
                        <>
                          <option value={retProd.baseUnit}>{retProd.baseUnit}</option>
                          {retProd.units.map((u) => (
                            <option key={u.id} value={u.name}>
                              {u.name} ({u.conversionFactor})
                            </option>
                          ))}
                        </>
                      ) : (
                        <option value="">الوحدة</option>
                      )}
                    </select>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={retCustodyQty}
                      onChange={setRetCustodyQty}
                      ariaLabel="الكمية المرتجعة للمخزن"
                      inputClassName="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                );
              })()}

              <select
                value={retCustodyTargetWhId}
                onChange={(e) => setRetCustodyTargetWhId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 bg-white font-bold"
              >
                {data.warehouses
                  .filter((w) => w.id !== effectiveVanId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      إرجاع إلى: {w.name}
                    </option>
                  ))}
              </select>

              <input
                type="text"
                value={retCustodyNotes}
                onChange={(e) => setRetCustodyNotes(e.target.value)}
                placeholder="سبب الإرجاع أو ملاحظات..."
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
              />

              <button
                type="submit"
                disabled={isSendingTransfer || !retCustodyProdId}
                className="w-full min-h-[46px] rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSendingTransfer ? 'جاري تسجيل الإرجاع...' : 'تأكيد إرجاع البضاعة للمخزن'}
              </button>
            </form>
          )}

          {custodySubTab === 'items' && (
            <div className="space-y-3 text-xs">
              <form
                onSubmit={handleSendDirectItemTransfer}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3"
              >
                <h4 className="font-black text-slate-900">طلب تحويل أصناف من المخزن الرئيسي إلى السيارة</h4>
                <div className="flex gap-2">
                  <select
                    value={reqProdId}
                    onChange={(e) => setReqProdId(e.target.value)}
                    className="flex-1 min-h-[42px] rounded-xl border border-slate-300 px-2.5 bg-white font-bold"
                  >
                    <option value="">-- اختر الصنف --</option>
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (الرئيسي: {mainWarehouse ? p.stockPerWarehouse?.[mainWarehouse.id] || 0 : 0})
                      </option>
                    ))}
                  </select>
                  <QuantityInput
                    allowDecimals
                    min={0.001}
                    value={reqQty}
                    onChange={setReqQty}
                    ariaLabel="كمية التحويل المطلوبة"
                    inputClassName="w-20 min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const prod = activeProducts.find((p) => p.id === reqProdId);
                      if (!prod || reqQty <= 0) return;
                      const vanQty = prod.stockPerWarehouse?.[effectiveVanId] || 0;
                      setReqItems((prev) => [
                        ...prev,
                        {
                          productId: prod.id,
                          productName: prod.name,
                          unit: prod.baseUnit,
                          requestedQty: reqQty,
                          availableInVanQty: vanQty,
                          shortageQty: Math.max(0, reqQty - vanQty),
                        },
                      ]);
                      setReqProdId('');
                    }}
                    className="min-h-[42px] px-3.5 rounded-xl bg-blue-900 text-white font-bold cursor-pointer"
                  >
                    إضافة
                  </button>
                </div>

                {reqItems.length > 0 && (
                  <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl">
                    {reqItems.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <span className="font-bold">{it.productName} ({it.requestedQty} {it.unit})</span>
                        <button
                          type="button"
                          onClick={() => setReqItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-red-600 font-bold px-2 cursor-pointer"
                        >
                          حذف
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSendingTransfer || reqItems.length === 0}
                  className="w-full min-h-[44px] rounded-xl bg-emerald-700 text-white font-black disabled:opacity-50 cursor-pointer"
                >
                  {isSendingTransfer ? 'جاري الإرسال...' : 'إرسال طلب التحويل للإدارة'}
                </button>
              </form>

              {myItemTransfers.map((tr) => (
                <div key={tr.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-blue-950">{tr.requestNumber}</span>
                    <span className="font-bold text-slate-700">
                      {tr.status === 'pending'
                        ? 'قيد مراجعة الإدارة'
                        : tr.status === 'approved'
                        ? 'معتمد — بانتظار الصرف'
                        : tr.status === 'executed'
                        ? 'تم الصرف — بانتظار تأكيد استلامك'
                        : tr.status === 'received'
                        ? 'تم الاستلام الفعلي'
                        : 'مرفوض'}
                    </span>
                  </div>
                  <div className="space-y-1 text-[11px] text-slate-600">
                    {tr.items.map((it, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{it.productName}</span>
                        <span className="font-mono">{it.approvedQty ?? it.requestedQty} {it.unit}</span>
                      </div>
                    ))}
                  </div>
                  {tr.status === 'executed' && (
                    <button
                      type="button"
                      onClick={() => handleConfirmItemReceived(tr.id, tr.requestNumber)}
                      className="w-full min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer"
                    >
                      تأكيد استلام الأصناف فعلياً
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {custodySubTab === 'cash' && (
            <div className="space-y-3 text-xs">
              <form
                onSubmit={handleSendCashToOwner}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3"
              >
                <h4 className="font-black text-slate-900">توريد نقدية من المندوب إلى خزينة الفرع</h4>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={cashAmount || ''}
                    onChange={(e) => setCashAmount(Number(e.target.value))}
                    placeholder={`المبلغ (${data.settings.currency})`}
                    className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono font-bold"
                  />
                  <button
                    type="submit"
                    disabled={isSendingTransfer || cashAmount <= 0}
                    className="min-h-[44px] px-4 rounded-xl bg-blue-900 text-white font-black disabled:opacity-50 cursor-pointer"
                  >
                    إرسال التوريد
                  </button>
                </div>
                <input
                  type="text"
                  value={cashNotes}
                  onChange={(e) => setCashNotes(e.target.value)}
                  placeholder="ملاحظات التوريد (اختياري)..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
                />
              </form>

              {myCashTransfers.map((t) => (
                <div key={t.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-blue-950">{t.transferNumber}</span>
                    <strong className="font-mono text-sm text-slate-900">
                      {t.amount.toLocaleString()} {data.settings.currency}
                    </strong>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    {t.direction === 'rep_to_owner' ? 'توريد إلى الفرع' : 'عهدة واردة لك من الإدارة'} ·{' '}
                    {t.status === 'received'
                      ? 'تم الاستلام والتسوية'
                      : t.status === 'awaiting_receipt'
                      ? 'بانتظار تأكيد الاستلام'
                      : 'مرفوض'}
                  </p>
                  {t.status === 'awaiting_receipt' && t.direction === 'owner_to_rep' && (
                    <button
                      type="button"
                      onClick={() => handleConfirmOwnerCash(t.id)}
                      className="w-full min-h-[44px] rounded-xl bg-emerald-700 text-white font-black cursor-pointer"
                    >
                      تأكيد استلام العهدة النقدية
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== ORDERS & ASSIGNED DELIVERIES ==================== */}
      {activeTab === 'orders' && (
        <div className="space-y-4 text-xs">
          <div className="bg-white rounded-3xl border border-indigo-200 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-indigo-950 flex items-center gap-2">
                <Truck className="w-4 h-4 text-indigo-700" />
                <span>طلبات التسليم المعينة لك ({assignedDeliveryOrders.length})</span>
              </h3>
            </div>

            {assignedDeliveryOrders.length === 0 ? (
              <p className="text-slate-500 text-center py-4">لا توجد طلبات توصيل معينة لك حالياً.</p>
            ) : (
              <div className="space-y-3">
                {assignedDeliveryOrders.map((ord) => {
                  const total = Number(ord.invoiceTotal ?? ord.totalAmount ?? 0);
                  const adv = Number(ord.invoicePaidAmount ?? ord.advancePaidAmount ?? 0);
                  const remainingDue = Math.max(0, Number(ord.invoiceRemainingAmount ?? (total - adv)));
                  const mapQ = encodeURIComponent(ord.geoCoordinates || ord.deliveryAddress || ord.customerName);
                  return (
                    <div key={ord.id} className="rounded-2xl border border-slate-200 p-3.5 bg-slate-50/70 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-black text-sm text-blue-950">{ord.requestNumber}</span>
                          <p className="font-bold text-slate-900 mt-0.5">
                            {ord.shopName ? `${ord.shopName} (${ord.customerName})` : ord.customerName}
                          </p>
                          {ord.deliveryAddress && (
                            <p className="text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 text-red-600 shrink-0" />
                              <span>{ord.deliveryAddress}</span>
                            </p>
                          )}
                        </div>
                        <span className="font-black text-xs text-indigo-900">
                          {REP_ORDER_STATUS_LABELS[ord.status] || ord.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-xl border border-slate-200 font-mono text-[11px]">
                        <span>الإجمالي: <strong>{total.toLocaleString()} {data.settings.currency}</strong></span>
                        <span className="text-emerald-700 font-bold">مدفوع: {adv.toLocaleString()}</span>
                        <span className="text-blue-950 font-black">متبقي: {remainingDue.toLocaleString()}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {ord.customerPhone && (
                          <a
                            href={`tel:${ord.customerPhone}`}
                            className="min-h-[42px] px-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold inline-flex items-center gap-1.5"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>اتصال</span>
                          </a>
                        )}
                        {(ord.deliveryAddress || ord.geoCoordinates) && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${mapQ}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[42px] px-3 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 font-bold inline-flex items-center gap-1.5"
                          >
                            <MapPin className="w-3.5 h-3.5 text-red-600" />
                            <span>خريطة</span>
                          </a>
                        )}
                        {(ord.status === 'rep_assigned' || ord.status === 'preparing' || ord.status === 'invoiced') && (
                          <button
                            type="button"
                            disabled={isUpdatingDelivery}
                            onClick={() => handleStartDelivery(ord)}
                            className="flex-1 min-h-[42px] px-3 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-black cursor-pointer disabled:opacity-50"
                          >
                            بدء التوصيل
                          </button>
                        )}
                        {(ord.status === 'rep_assigned' || ord.status === 'out_for_delivery' || ord.status === 'preparing') && (
                          <button
                            type="button"
                            disabled={isUpdatingDelivery}
                            onClick={() => handleOpenDeliverModal(ord)}
                            className="flex-1 min-h-[42px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
                          >
                            تم التسليم
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmitRepOrder}
            className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3"
          >
            <h3 className="text-sm font-black text-slate-900">إرسال طلب شراء للإدارة</h3>
            <select
              value={ordCustomerId}
              onChange={(e) => setOrdCustomerId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-bold bg-white"
            >
              <option value="">-- اختر العميل --</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.shopName ? `${c.shopName} (${c.name})` : c.name}
                </option>
              ))}
            </select>

            <div className="p-3 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-2.5">
              <select
                value={ordProductId}
                onChange={(e) => handleSelectOrderProduct(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-blue-300 px-3 font-bold bg-white"
              >
                <option value="">-- اختر الصنف للطلب --</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.baseUnit})</option>
                ))}
              </select>

              {selectedOrderProduct && (
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={ordUnitName}
                    onChange={(e) => handleOrderUnitChange(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-2 bg-white font-bold"
                  >
                    {selectedOrderProduct.units.map((u) => (
                      <option key={u.id} value={u.name}>{u.name}</option>
                    ))}
                    <option value={selectedOrderProduct.baseUnit}>{selectedOrderProduct.baseUnit}</option>
                  </select>
                  <QuantityInput
                    allowDecimals
                    min={0.001}
                    value={ordQty}
                    onChange={setOrdQty}
                    ariaLabel="كمية الصنف في الطلب"
                    inputClassName="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    value={ordPrice}
                    onChange={(e) => setOrdPrice(Math.max(0, Number(e.target.value)))}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                </div>
              )}

              {selectedOrderProduct && (
                <button
                  type="button"
                  onClick={handleAddOrderItem}
                  className="w-full min-h-[44px] rounded-xl bg-blue-900 text-white font-black flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة الصنف للطلب</span>
                </button>
              )}
            </div>

            {ordItems.length > 0 && (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl px-3">
                {ordItems.map((it, idx) => (
                  <div key={`${it.productId}-${it.unit}-${idx}`} className="py-2 flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 truncate">{it.productName} ({it.quantity} {it.unit})</span>
                    <button
                      type="button"
                      onClick={() => setOrdItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-red-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              type="text"
              value={ordNotes}
              onChange={(e) => setOrdNotes(e.target.value)}
              placeholder="ملاحظات الطلب..."
              className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
            />

            <button
              type="submit"
              disabled={isSubmittingOrder || !ordItems.length}
              className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black disabled:opacity-50 cursor-pointer"
            >
              {isSubmittingOrder ? 'جاري الإرسال...' : 'إرسال الطلب للإدارة'}
            </button>
          </form>

          {mySubmittedOrders.length > 0 && (
            <div className="space-y-2.5">
              <h4 className="font-black text-slate-900 px-1">طلباتي المرسلة ({mySubmittedOrders.length})</h4>
              {mySubmittedOrders.map((ord) => (
                <div key={ord.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-blue-950">{ord.requestNumber}</span>
                    <span className="font-bold text-indigo-800">{REP_ORDER_STATUS_LABELS[ord.status] || ord.status}</span>
                  </div>
                  <p className="text-[11px] text-slate-600">{ord.customerName} · {ord.items?.length || 0} أصناف</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delivery Confirmation Sheet */}
      {deliveringOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmDelivered}
            className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-3 text-xs pb-safe max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h4 className="font-black text-sm text-slate-900">
                  تأكيد تسليم الطلب {deliveringOrder.requestNumber}
                </h4>
                <p className="text-slate-500">{deliveringOrder.customerName}</p>
              </div>
              <button
                type="button"
                onClick={() => setDeliveringOrder(null)}
                className="min-h-[38px] px-3 rounded-xl bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                إغلاق
              </button>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                المبلغ المحصل عند التسليم ({data.settings.currency}):
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={deliveryCollectedAmount}
                onChange={(e) => setDeliveryCollectedAmount(Math.max(0, Number(e.target.value)))}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono font-black text-center text-emerald-800"
              />
            </div>

            {deliveryCollectedAmount > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={deliveryCashboxId}
                  onChange={(e) => setDeliveryCashboxId(e.target.value)}
                  className="min-h-[42px] rounded-xl border border-slate-300 px-2 bg-white font-bold"
                >
                  {data.cashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>{cb.name}</option>
                  ))}
                </select>
                <select
                  value={deliveryMethod}
                  onChange={(e) => setDeliveryMethod(e.target.value as any)}
                  className="min-h-[42px] rounded-xl border border-slate-300 px-2 bg-white font-bold"
                >
                  <option value="cash">نقدي</option>
                  <option value="bank">تحويل بنكي</option>
                  <option value="cheque">شيك</option>
                </select>
              </div>
            )}

            <input
              type="text"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              placeholder="ملاحظات التسليم..."
              className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3"
            />

            <label className="min-h-[42px] px-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-900 font-bold inline-flex items-center gap-2 cursor-pointer">
              <Camera className="w-4 h-4" />
              <span>{deliveryProof ? 'تم التقاط الصورة (اضغط للتغيير)' : 'التقاط إثبات تسليم (اختياري)'}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const img = await compressImageFileToDataUrl(file);
                    setDeliveryProof(img);
                  } catch {
                    // ignore
                  }
                }}
              />
            </label>

            <button
              type="submit"
              disabled={isUpdatingDelivery}
              className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black disabled:opacity-50 cursor-pointer"
            >
              {isUpdatingDelivery ? 'جاري التسجيل...' : 'اعتماد تسليم الطلب'}
            </button>
          </form>
        </div>
      )}

      {/* Customer Tap-for-Details Sheet */}
      {selectedCustomerDetail && (() => {
        const c = selectedCustomerDetail;
        const custInvoices = myInvoices
          .filter((inv) => inv.customerId === c.id)
          .slice(0, 5);
        const latestInvoice = custInvoices[0];
        const latestPaymentTx = (data.financialTransactions || []).find(
          (tx) => tx.partyId === c.id || tx.notes?.includes(c.name)
        );
        const cleanedPhone = String(c.phone || '').replace(/[^\d+]/g, '');
        const hasValidPhone = cleanedPhone.replace(/\D/g, '').length >= 7;
        const mapRaw = (c.geoCoordinates || c.address || '').trim();
        const hasValidMap = Boolean(mapRaw && mapRaw !== '-');
        const mapsHref =
          mapRaw.startsWith('http://') || mapRaw.startsWith('https://')
            ? mapRaw
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapRaw)}`;
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
            <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col gap-3 text-xs pb-safe">
              <div className="flex items-start justify-between gap-2 border-b pb-3">
                <div>
                  <h4 className="font-black text-base text-slate-900">{c.shopName || c.name}</h4>
                  <p className="text-slate-500">
                    {c.name} · {c.code} {c.area ? `· ${c.area}` : ''}
                  </p>
                  {c.address && c.address !== '-' && (
                    <p className="text-[11px] text-slate-600 mt-0.5">{c.address}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCustomerDetail(null)}
                  className="min-h-[38px] px-3 rounded-xl bg-slate-100 font-bold text-slate-700 cursor-pointer"
                >
                  إغلاق
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">
                    {c.currentBalance < 0 ? 'رصيد دائن للعميل' : 'الرصيد المستحق'}
                  </span>
                  <strong className={`font-mono text-sm ${c.currentBalance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {Math.abs(c.currentBalance).toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
                <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200">
                  <span className="text-[10px] text-blue-800 block">آخر تعامل</span>
                  <strong className="font-mono text-[11px] text-blue-950">
                    {latestInvoice ? `${latestInvoice.date} (${latestInvoice.invoiceNumber})` : 'لا يوجد'}
                  </strong>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="text-[10px] text-emerald-800 block">آخر سداد</span>
                  <strong className="font-mono text-[11px] text-emerald-950">
                    {latestPaymentTx ? `${latestPaymentTx.amount.toLocaleString()} (${latestPaymentTx.date})` : 'لا يوجد'}
                  </strong>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {hasValidPhone && (
                  <a
                    href={`tel:${cleanedPhone}`}
                    className="min-h-[42px] px-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold inline-flex items-center gap-1.5"
                  >
                    <Phone className="w-4 h-4" />
                    <span>{c.phone}</span>
                  </a>
                )}
                {(() => {
                  const cleanedSec = String(c.secondaryPhone || '').replace(/[^\d+]/g, '');
                  return cleanedSec.replace(/\D/g, '').length >= 7 ? (
                    <a
                      href={`tel:${cleanedSec}`}
                      className="min-h-[42px] px-3 rounded-xl bg-teal-50 text-teal-800 border border-teal-200 font-mono font-bold inline-flex items-center gap-1.5"
                    >
                      <Phone className="w-4 h-4" />
                      <span>{c.secondaryPhone}</span>
                    </a>
                  ) : null;
                })()}
                {hasValidMap && (
                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[42px] px-3 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 font-bold inline-flex items-center gap-1.5"
                  >
                    <MapPin className="w-4 h-4" />
                    <span>فتح الخريطة</span>
                  </a>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 border border-slate-200 rounded-2xl p-3">
                <span className="font-black text-slate-800 block mb-1">آخر فواتير العميل ({custInvoices.length})</span>
                {custInvoices.length === 0 ? (
                  <p className="text-slate-400 text-center py-3">لا توجد فواتير مسجلة لهذا العميل.</p>
                ) : (
                  custInvoices.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                      <div>
                        <span className="font-mono font-bold text-blue-950">{inv.invoiceNumber}</span>
                        <span className="text-[10px] text-slate-500 mr-2">{inv.date}</span>
                      </div>
                      <strong className="font-mono text-slate-900 tabular-nums">
                        {inv.grandTotal.toLocaleString()} {data.settings.currency}
                      </strong>
                    </div>
                  ))
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInvCustomerId(c.id);
                    setSelectedCustomerDetail(null);
                    onTabChange('new-invoice');
                  }}
                  className="min-h-[46px] rounded-xl bg-blue-900 text-white font-black cursor-pointer"
                >
                  + فاتورة جديدة
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDepMode('customer_collection');
                    setDepCustomerId(c.id);
                    setSelectedCustomerDetail(null);
                    onTabChange('cash-deposit');
                  }}
                  className="min-h-[46px] rounded-xl bg-emerald-700 text-white font-black cursor-pointer"
                >
                  + تحصيل دفعة
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Unsaved Invoice Leave Guard Modal */}
      {pendingLeaveTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-3 text-xs">
            <div className="flex items-center gap-2 font-black text-sm text-amber-800">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>توجد أصناف غير محفوظة في الفاتورة</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              لديك ({invItems.length}) أصناف في الفاتورة الحالية ولم يتم حفظها أو اعتمادها بعد. هل تريد المغادرة مع الاحتفاظ بها أم البقاء لإكمال الفاتورة؟
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingLeaveTab(null)}
                className="min-h-[44px] rounded-xl bg-blue-900 text-white font-black cursor-pointer"
              >
                البقاء في الفاتورة
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingLeaveTab;
                  setPendingLeaveTab(null);
                  onTabChange(target);
                }}
                className="min-h-[44px] rounded-xl bg-slate-100 text-slate-800 font-bold cursor-pointer"
              >
                الانتقال (مع حفظ المسودة)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Sheet */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-200 max-h-[82vh] flex flex-col gap-3 text-xs pb-safe">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h4 className="font-black text-sm text-slate-900">
                  {selectedInvoice.invoiceNumber} — {selectedInvoice.customerName}
                </h4>
                <p className="text-slate-500 font-mono">{selectedInvoice.date}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="min-h-[40px] px-3 rounded-xl bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {(selectedInvoice.items || []).map((it, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900">{it.productName}</p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {it.quantity} {it.unit} × {it.unitPrice.toLocaleString()}
                    </p>
                  </div>
                  <strong className="font-mono text-blue-950">
                    {it.total.toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => exportInvoiceDocument(selectedInvoice)}
              className="min-h-[46px] rounded-xl bg-blue-900 text-white font-black flex items-center justify-center gap-2 cursor-pointer"
            >
              {isNative ? <Share2 className="w-4 h-4" /> : <FileDown className="w-4 h-4" />}
              <span>{isNative ? 'مشاركة / حفظ الفاتورة' : 'طباعة / PDF'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

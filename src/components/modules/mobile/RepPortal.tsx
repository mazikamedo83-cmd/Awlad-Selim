import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, FilePlus2, FileText, Truck, Search, Plus,
  Trash2, CheckCircle2, AlertCircle, AlertTriangle, Phone, MapPin,
  History, ShieldAlert, RefreshCw, Share2, FileDown, Boxes, ArrowLeftRight,
  CloudOff, CloudCheck, Camera, ShoppingBag, RotateCcw, ArrowDownCircle,
  ArrowUpCircle, UserPlus, Building2, Receipt, CreditCard, FileSpreadsheet,
  Wallet, Settings, LogOut, ChevronLeft, Lock, Warehouse as WarehouseIcon,
  Barcode, X, Eye, Calculator, ClipboardCheck, Send, Clock, Edit, Upload, ExternalLink, Store, PackagePlus,
  ArrowRight, Printer, Info, Calendar, ChevronDown, ChevronUp, SlidersHorizontal
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import {
  Customer,
  CustomerPhoneEntry,
  CustomerItemOrderRequest,
  CustomerPriceHistoryEntry,
  CustomerStatementResponse,
  InlinePurchaseNewProduct,
  Invoice,
  InvoiceReturn,
  Product,
  PurchaseReturnRequest,
  RepCustodyStatementResponse,
  RepDetailedReportResponse,
  SalesReturnRequest,
  Supplier,
  SupplierStatementResponse,
} from '../../../types';
import { apiRequest, fetchRepSummaryReport } from '../../../services/api';
import { exportHtmlToPdf } from '../../common/PdfExporter';
import { getCurrentLocationSafe, isNativeCapacitor, parseLatLngCoords, reverseGeocodeCoords } from '../../../services/native';
import { QuantityInput } from '../../common/QuantityInput';
import { computeLineTotal } from '../../../utils/quantity';
import { compressImageFileToDataUrl } from '../../../utils/image';
import { RefreshSyncScreen } from './RefreshSyncScreen';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { SearchableFilterSelect, type SearchableFilterOption } from '../../common/SearchableFilterSelect';
import { CustomerLocationPickerModal, PickedCustomerLocation } from '../../common/CustomerLocationPickerModal';
import { CustomerLocationViewerModal } from '../../common/CustomerLocationViewerModal';
import { isZeroZeroLocation } from '../../../utils/storefront';
import {
  SalesInvoiceIcon,
  SalesInvoicesListIcon,
  PurchaseInvoiceIcon,
  PurchaseInvoicesListIcon,
  SalesReturnIcon,
  PurchaseReturnIcon,
  PriceQuoteIcon,
  CustomerAddIcon,
  CustomersGroupIcon,
  SupplierAddIcon,
  TransferArrowsIcon,
  RefreshCloudIcon,
  ChequesIcon,
  WalletCashIcon,
  ExpensesCashIcon,
  WarehouseBoxesIcon,
  OrdersClipboardIcon,
  SettingsTwinGearsIcon,
  LogoutDoorIcon,
  ProductAddIcon,
} from '../../common/AppIcons';

function normalizeRepProdDupText(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

function checkRepLocalProductDuplicates(
  products: Product[],
  payload: { name: string; barcode: string; code: string; category: string; baseUnit: string }
): { exactMatch: Product | null; matchedBy: string | null; similarMatches: Product[] } {
  const bc = payload.barcode.trim().toLowerCase();
  const cd = payload.code.trim().toLowerCase();
  const normName = normalizeRepProdDupText(payload.name);
  const normCat = normalizeRepProdDupText(payload.category);
  const normUnit = normalizeRepProdDupText(payload.baseUnit);

  if (bc) {
    const byBarcode = products.find(
      (p) =>
        String(p.barcode || '').trim().toLowerCase() === bc ||
        (Array.isArray(p.units) && p.units.some((u) => String(u.barcode || '').trim().toLowerCase() === bc))
    );
    if (byBarcode) return { exactMatch: byBarcode, matchedBy: 'barcode', similarMatches: [] };
  }
  if (cd) {
    const byCode = products.find((p) => String(p.code || '').trim().toLowerCase() === cd);
    if (byCode) return { exactMatch: byCode, matchedBy: 'code', similarMatches: [] };
  }
  if (normName) {
    const exactFull = products.find(
      (p) =>
        normalizeRepProdDupText(p.name) === normName &&
        normalizeRepProdDupText(p.category || '') === normCat &&
        normalizeRepProdDupText(p.baseUnit || '') === normUnit
    );
    if (exactFull) return { exactMatch: exactFull, matchedBy: 'name_category_unit', similarMatches: [] };

    const similarMatches = products
      .filter((p) => {
        const pNorm = normalizeRepProdDupText(p.name);
        return pNorm && (pNorm === normName || pNorm.includes(normName) || normName.includes(pNorm));
      })
      .slice(0, 5);
    return { exactMatch: null, matchedBy: null, similarMatches };
  }
  return { exactMatch: null, matchedBy: null, similarMatches: [] };
}

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
  | 'custody'
  | 'suppliers'
  | 'rep-reports';

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
  const isRepRoleAccount = currentUser?.role === 'representative';
  const canSales = isAdmin || hasPermission('canManageSales');
  const canPurchases = isAdmin || hasPermission('canManagePurchases');
  const canCreatePurchase = canPurchases || hasPermission('canCreatePurchase');
  // Representative accounts never perform general treasury cashbox deposits/withdrawals
  const canCashOps = !isRepRoleAccount && (isAdmin || hasPermission('canManageCashboxes') || hasPermission('canManageAccounts'));
  const canTransfers = isAdmin || hasPermission('canManageTransfers');
  const canCash = canCashOps || canTransfers || canSales;
  const canAccounts = isAdmin || hasPermission('canManageAccounts');
  const canInventory = isAdmin || hasPermission('canManageInventory') || canTransfers;
  const canAddCustomer = isAdmin || canSales || hasPermission('canAdd');
  const canEditCustomer = isAdmin || hasPermission('canEdit');
  const canDeleteCustomer = isAdmin || hasPermission('canDelete');
  const canViewCustomerAggregateTotals =
    !isRepRoleAccount && (isAdmin || hasPermission('canManageAccounts') || hasPermission('canViewReports'));

  const rep =
    representativeProfile ||
    data.representatives.find((r) => r.userId && r.userId === currentUser?.id) ||
    (!isRepRoleAccount
      ? data.representatives.find((r) => !r.userId && r.name === currentUser?.fullName)
      : undefined) ||
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
  const [invOnlyVanStock, setInvOnlyVanStock] = useState<boolean>(false);
  const [invUnitName, setInvUnitName] = useState<string>('');
  const [invQty, setInvQty] = useState<number | ''>('');
  const [invPrice, setInvPrice] = useState<number | ''>('');
  const [invLineDiscount, setInvLineDiscount] = useState<number | ''>('');
  const [invPaymentType, setInvPaymentType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [invPaidAmount, setInvPaidAmount] = useState<number | ''>('');
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
  const [customerFilterMode, setCustomerFilterMode] = useState<'all' | 'current' | 'debtors' | 'credits'>('all');
  const [customerSortMode, setCustomerSortMode] = useState<'debt_desc' | 'credit_desc' | 'name'>('debt_desc');
  const [customerDetailSubTab, setCustomerDetailSubTab] = useState<'overview' | 'statement'>('overview');
  const [customerDetailStatement, setCustomerDetailStatement] = useState<CustomerStatementResponse | null>(null);
  const [isLoadingCustomerStatement, setIsLoadingCustomerStatement] = useState(false);
  const [stmtDateFrom, setStmtDateFrom] = useState('');
  const [stmtDateTo, setStmtDateTo] = useState('');
  const [stmtSearch, setStmtSearch] = useState('');
  const [statementPreviewDoc, setStatementPreviewDoc] = useState<{
    type: 'invoice' | 'payment';
    docId: string;
    title: string;
  } | null>(null);
  const [deleteCustomerTarget, setDeleteCustomerTarget] = useState<Customer | null>(null);
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false);
  const [safeDeleteModalOpen, setSafeDeleteModalOpen] = useState(false);
  const [safeDeleteSearch, setSafeDeleteSearch] = useState('');
  const [actualDrawerCash, setActualDrawerCash] = useState<string>('');
  const [showCustomerStats, setShowCustomerStats] = useState(false);
  const [showReportFilters, setShowReportFilters] = useState(false);

  // ==================== 2. PURCHASE INVOICE STATE ====================
  const [purEditingInvoiceId, setPurEditingInvoiceId] = useState<string | null>(null);
  const [purSupplierId, setPurSupplierId] = useState<string>('');
  const [purWarehouseId, setPurWarehouseId] = useState<string>('');
  const [purProductId, setPurProductId] = useState<string>('');
  const [purUnitName, setPurUnitName] = useState<string>('');
  const [purQty, setPurQty] = useState<number | ''>('');
  const [purPrice, setPurPrice] = useState<number | ''>('');
  const [purDiscount, setPurDiscount] = useState<number | ''>('');
  const [purPaymentType, setPurPaymentType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [purPaidAmount, setPurPaidAmount] = useState<number | ''>('');
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
    newProduct?: InlinePurchaseNewProduct;
  }>>([]);
  const [showPurInlineNewProduct, setShowPurInlineNewProduct] = useState(false);
  const [newPurProdName, setNewPurProdName] = useState('');
  const [newPurProdBarcode, setNewPurProdBarcode] = useState('');
  const [newPurProdCode, setNewPurProdCode] = useState('');
  const [newPurProdCategory, setNewPurProdCategory] = useState('');
  const [newPurProdBaseUnit, setNewPurProdBaseUnit] = useState('');
  const [newPurProdQty, setNewPurProdQty] = useState<number | ''>('');
  const [newPurProdBuyPrice, setNewPurProdBuyPrice] = useState<number | ''>('');
  const [newPurProdSellPrice, setNewPurProdSellPrice] = useState<number | ''>('');
  const [purDuplicateCheckState, setPurDuplicateCheckState] = useState<{
    checking: boolean;
    exactMatch: Product | null;
    matchedBy: string | null;
    similarMatches: Product[];
  }>({ checking: false, exactMatch: null, matchedBy: null, similarMatches: [] });
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);
  const [purReviewOpen, setPurReviewOpen] = useState(false);
  const [purRecipientUserId, setPurRecipientUserId] = useState('');
  const [purListFilter, setPurListFilter] = useState<'all' | 'draft' | 'sent' | 'received' | 'rejected' | 'confirmed'>('all');
  const [sendingPurchaseTarget, setSendingPurchaseTarget] = useState<Invoice | null>(null);
  const [sendingRecipientUserId, setSendingRecipientUserId] = useState('');
  const [isSendingPurchase, setIsSendingPurchase] = useState(false);
  const [historyPurchaseTarget, setHistoryPurchaseTarget] = useState<Invoice | null>(null);
  const [selectedPurchaseDetail, setSelectedPurchaseDetail] = useState<Invoice | null>(null);
  const [previewShopPhoto, setPreviewShopPhoto] = useState<string | null>(null);

  // ==================== 3. RETURNS STATE (Sales Return & Purchase Return) ====================
  const [sRetCustomerId, setSRetCustomerId] = useState('');
  const [sRetInvoiceId, setSRetInvoiceId] = useState('');
  const [sRetWarehouseId, setSRetWarehouseId] = useState('');
  const [sRetProductId, setSRetProductId] = useState('');
  const [sRetQty, setSRetQty] = useState<number | ''>('');
  const [sRetPrice, setSRetPrice] = useState<number | ''>('');
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
  const [pRetQty, setPRetQty] = useState<number | ''>('');
  const [pRetPrice, setPRetPrice] = useState<number | ''>('');
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
  const [depInvoiceId, setDepInvoiceId] = useState('');
  const [depCashboxId, setDepCashboxId] = useState(data.cashboxes[0]?.id || 'CASH-01');
  const [depMethod, setDepMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [depDate, setDepDate] = useState(new Date().toISOString().split('T')[0]);
  const [depAmount, setDepAmount] = useState<number | ''>('');
  const [depNotes, setDepNotes] = useState('');
  const [isSubmittingDeposit, setIsSubmittingDeposit] = useState(false);

  const [wdCashboxId, setWdCashboxId] = useState(data.cashboxes[0]?.id || 'CASH-01');
  const [wdCategory, setWdCategory] = useState('');
  const [wdBeneficiary, setWdBeneficiary] = useState('');
  const [wdAmount, setWdAmount] = useState<number | ''>('');
  const [wdNotes, setWdNotes] = useState('');
  const [isSubmittingWithdrawal, setIsSubmittingWithdrawal] = useState(false);

  // ==================== 5. NEW CUSTOMER & NEW SUPPLIER STATE ====================
  const [newCustName, setNewCustName] = useState('');
  const [newCustShop, setNewCustShop] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustExtraPhones, setNewCustExtraPhones] = useState<Array<{ id: string; phone: string; label: string }>>([]);
  const [newCustGovernorate, setNewCustGovernorate] = useState('');
  const [newCustArea, setNewCustArea] = useState('');
  const [newCustCity, setNewCustCity] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustGeo, setNewCustGeo] = useState('');
  const [newCustLat, setNewCustLat] = useState<number | undefined>(undefined);
  const [newCustLng, setNewCustLng] = useState<number | undefined>(undefined);
  const [newCustLocAt, setNewCustLocAt] = useState<string | undefined>(undefined);
  const [newCustShopPhoto, setNewCustShopPhoto] = useState('');
  const [newCustNotes, setNewCustNotes] = useState('');
  const [newCustOpening, setNewCustOpening] = useState<number | ''>('');
  const [isLocatingCust, setIsLocatingCust] = useState(false);
  const [isUploadingCustPhoto, setIsUploadingCustPhoto] = useState(false);
  const [custPhoneNotice, setCustPhoneNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [custMapNotice, setCustMapNotice] = useState<string | null>(null);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const custCameraInputRef = useRef<HTMLInputElement | null>(null);
  const custGalleryInputRef = useRef<HTMLInputElement | null>(null);

  const [editingCustomerTarget, setEditingCustomerTarget] = useState<Customer | null>(null);
  const [editCustName, setEditCustName] = useState('');
  const [editCustShop, setEditCustShop] = useState('');
  const [editCustPhone, setEditCustPhone] = useState('');
  const [editCustExtraPhones, setEditCustExtraPhones] = useState<Array<{ id: string; phone: string; label: string }>>([]);
  const [editCustGovernorate, setEditCustGovernorate] = useState('');
  const [editCustArea, setEditCustArea] = useState('');
  const [editCustCity, setEditCustCity] = useState('');
  const [editCustAddress, setEditCustAddress] = useState('');
  const [editCustGeo, setEditCustGeo] = useState('');
  const [editCustLat, setEditCustLat] = useState<number | undefined>(undefined);
  const [editCustLng, setEditCustLng] = useState<number | undefined>(undefined);
  const [editCustLocAt, setEditCustLocAt] = useState<string | undefined>(undefined);
  const [editCustShopPhoto, setEditCustShopPhoto] = useState('');
  const [editCustPhotoChanged, setEditCustPhotoChanged] = useState(false);
  const [editCustClearPhoto, setEditCustClearPhoto] = useState(false);
  const [editCustNotes, setEditCustNotes] = useState('');
  const [isLocatingEditCust, setIsLocatingEditCust] = useState(false);
  const [isUploadingEditCustPhoto, setIsUploadingEditCustPhoto] = useState(false);
  const [editCustPhoneNotice, setEditCustPhoneNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [editCustMapNotice, setEditCustMapNotice] = useState<string | null>(null);
  const [isSavingEditCustomer, setIsSavingEditCustomer] = useState(false);
  const editCustCameraInputRef = useRef<HTMLInputElement | null>(null);
  const editCustGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const [locationPickerTarget, setLocationPickerTarget] = useState<'new' | 'edit' | null>(null);
  const [locationViewerData, setLocationViewerData] = useState<{
    customerName: string;
    shopName?: string;
    address?: string;
    city?: string;
    area?: string;
    governorate?: string;
    geoCoordinates?: string;
    latitude?: number;
    longitude?: number;
  } | null>(null);

  const [newSupName, setNewSupName] = useState('');
  const [newSupCompany, setNewSupCompany] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupAddress, setNewSupAddress] = useState('');
  const [newSupOpening, setNewSupOpening] = useState<number | ''>('');
  const [supPhoneNotice, setSupPhoneNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);

  // ==================== 6. PRICE QUOTES STATE ====================
  const [quoteCustomerId, setQuoteCustomerId] = useState('');
  const [quoteProductId, setQuoteProductId] = useState('');
  const [quoteUnitName, setQuoteUnitName] = useState('');
  const [quoteQty, setQuoteQty] = useState<number | ''>('');
  const [quotePrice, setQuotePrice] = useState<number | ''>('');
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
  const [chqAmount, setChqAmount] = useState<number | ''>('');
  const [chqDueDate, setChqDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSavingCheque, setIsSavingCheque] = useState(false);
  const [payingInstKey, setPayingInstKey] = useState<string | null>(null);

  // ==================== 8. CUSTODY & TRANSFERS STATE ====================
  const [custodySubTab, setCustodySubTab] = useState<'van' | 'items' | 'deliver' | 'return' | 'cash'>('van');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [custodyStatement, setCustodyStatement] = useState<RepCustodyStatementResponse | null>(null);
  const [isLoadingCustodyStmt, setIsLoadingCustodyStmt] = useState(false);
  const [reqProdId, setReqProdId] = useState('');
  const [reqQty, setReqQty] = useState<number | ''>('');
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
  const [delivQty, setDelivQty] = useState<number | ''>('');
  const [delivNotes, setDelivNotes] = useState('');
  const [retCustodyProdId, setRetCustodyProdId] = useState('');
  const [retCustodyUnit, setRetCustodyUnit] = useState('');
  const [retCustodyQty, setRetCustodyQty] = useState<number | ''>('');
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

  // ==================== 10. SUPPLIERS, PURCHASE PAYMENTS & REP REPORTS ====================
  const [supSearch, setSupSearch] = useState('');
  const [selectedSupplierDetail, setSelectedSupplierDetail] = useState<Supplier | null>(null);
  const [supplierStatement, setSupplierStatement] = useState<SupplierStatementResponse | null>(null);
  const [isLoadingSupplierStmt, setIsLoadingSupplierStmt] = useState(false);
  const [supStmtError, setSupStmtError] = useState<string | null>(null);

  const [payingPurchaseTarget, setPayingPurchaseTarget] = useState<Invoice | null>(null);
  const [purPayAmount, setPurPayAmount] = useState<number>(0);
  const [purPayMethod, setPurPayMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [purPayDate, setPurPayDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [purPayNotes, setPurPayNotes] = useState<string>('');
  const [isSubmittingPurPayment, setIsSubmittingPurPayment] = useState(false);

  const [repReportData, setRepReportData] = useState<RepDetailedReportResponse | null>(null);
  const [isLoadingRepReport, setIsLoadingRepReport] = useState(false);
  const [repReportError, setRepReportError] = useState<string | null>(null);
  const [repReportIsOfflineFallback, setRepReportIsOfflineFallback] = useState(false);
  const [rptDateFrom, setRptDateFrom] = useState('');
  const [rptDateTo, setRptDateTo] = useState('');
  const [rptPartyKey, setRptPartyKey] = useState('all');
  const rptCustomerId = rptPartyKey.startsWith('customer:') ? rptPartyKey.slice('customer:'.length) : '';
  const rptSupplierId = rptPartyKey.startsWith('supplier:') ? rptPartyKey.slice('supplier:'.length) : '';
  const [rptProductId, setRptProductId] = useState('');
  const [rptInvoiceNumber, setRptInvoiceNumber] = useState('');
  const [rptOpType, setRptOpType] = useState<'all' | 'sales' | 'purchase' | 'sales_return' | 'purchase_return' | 'purchase_return_request'>('all');
  const [rptPaymentStatus, setRptPaymentStatus] = useState<'all' | 'paid' | 'partial' | 'credit'>('all');
  const [rptInvoiceStatus, setRptInvoiceStatus] = useState<'all' | 'confirmed' | 'draft' | 'cancelled'>('all');
  const [rptSubView, setRptSubView] = useState<'summary' | 'invoices' | 'items' | 'collections'>('summary');
  const [rptPage, setRptPage] = useState<number>(1);
  const [rptPageSize, setRptPageSize] = useState<number>(50);

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

  useEffect(() => {
    let active = true;
    if (!selectedCustomerDetail) {
      setCustomerDetailStatement(null);
      setCustomerDetailSubTab('overview');
      setStatementPreviewDoc(null);
      return;
    }
    setIsLoadingCustomerStatement(true);
    data
      .getCustomerStatement(selectedCustomerDetail.id)
      .then((res) => {
        if (active && res) {
          setCustomerDetailStatement(res);
        }
      })
      .finally(() => {
        if (active) setIsLoadingCustomerStatement(false);
      });
    return () => {
      active = false;
    };
  }, [selectedCustomerDetail?.id, data.getCustomerStatement]);

  useEffect(() => {
    let active = true;
    if (!selectedSupplierDetail) {
      setSupplierStatement(null);
      setSupStmtError(null);
      return;
    }
    setIsLoadingSupplierStmt(true);
    setSupStmtError(null);
    data
      .getSupplierStatement(selectedSupplierDetail.id)
      .then((res) => {
        if (!active) return;
        if (res) {
          setSupplierStatement(res);
        } else {
          setSupStmtError('تعذر تحميل كشف حساب المورد.');
        }
      })
      .catch((err: any) => {
        if (active) setSupStmtError(err?.message || 'تعذر تحميل كشف حساب المورد.');
      })
      .finally(() => {
        if (active) setIsLoadingSupplierStmt(false);
      });
    return () => {
      active = false;
    };
  }, [selectedSupplierDetail?.id, data.getSupplierStatement]);

  const buildOfflineRepSummary = useCallback((): RepDetailedReportResponse => {
    const matchDates = (d?: string) => {
      const dateStr = String(d || '').slice(0, 10);
      if (rptDateFrom && dateStr < rptDateFrom) return false;
      if (rptDateTo && dateStr > rptDateTo) return false;
      return true;
    };
    const qInvNum = rptInvoiceNumber.trim().toLowerCase();

    const scopedInvoices = (data.invoices || []).filter((inv) => {
      if (inv.type === 'purchase' && !canCreatePurchase) return false;
      if (rptOpType === 'sales' && inv.type !== 'sales') return false;
      if (rptOpType === 'purchase' && inv.type !== 'purchase') return false;
      if (rptOpType === 'sales_return' || rptOpType === 'purchase_return' || rptOpType === 'purchase_return_request') return false;
      if (!matchDates(inv.date)) return false;
      if (rptInvoiceStatus !== 'all' && inv.status !== rptInvoiceStatus) return false;
      if (rptCustomerId && inv.customerId !== rptCustomerId) return false;
      if (rptSupplierId && inv.supplierId !== rptSupplierId) return false;
      if (qInvNum && !String(inv.invoiceNumber || '').toLowerCase().includes(qInvNum)) return false;
      const pStatus: 'paid' | 'partial' | 'credit' =
        Number(inv.remainingAmount || 0) <= 0.009
          ? 'paid'
          : Number(inv.paidAmount || 0) > 0.009
          ? 'partial'
          : 'credit';
      if (rptPaymentStatus !== 'all' && pStatus !== rptPaymentStatus) return false;
      if (rptProductId && !(inv.items || []).some((it) => it.productId === rptProductId)) return false;
      return true;
    });

    const scopedReturns = (data.invoiceReturns || []).filter((ret: InvoiceReturn) => {
      if (ret.type === 'purchase_return' && !canCreatePurchase) return false;
      if (rptOpType === 'sales_return' && ret.type !== 'sales_return') return false;
      if (rptOpType === 'purchase_return' && ret.type !== 'purchase_return') return false;
      if (rptOpType === 'sales' || rptOpType === 'purchase' || rptOpType === 'purchase_return_request') return false;
      if (!matchDates(ret.date)) return false;
      if (rptCustomerId && (ret.type !== 'sales_return' || ret.partyId !== rptCustomerId)) return false;
      if (rptSupplierId && (ret.type !== 'purchase_return' || ret.partyId !== rptSupplierId)) return false;
      if (qInvNum && !String(ret.returnNumber || '').toLowerCase().includes(qInvNum)) return false;
      if (rptProductId && !(ret.items || []).some((it) => it.productId === rptProductId)) return false;
      return true;
    });

    const scopedPurchaseReturnRequests = canCreatePurchase
      ? (data.purchaseReturnRequests || []).filter((req) => {
          if (rptOpType !== 'all' && rptOpType !== 'purchase_return_request' && rptOpType !== 'purchase_return' && rptOpType !== 'purchase') {
            return false;
          }
          if (!matchDates(req.date)) return false;
          if (rptSupplierId && req.supplierId !== rptSupplierId) return false;
          if (rptProductId && !(req.items || []).some((it) => it.productId === rptProductId)) return false;
          if (
            qInvNum &&
            !String(req.requestNumber || '').toLowerCase().includes(qInvNum) &&
            !String(req.originalInvoiceNumber || '').toLowerCase().includes(qInvNum)
          ) {
            return false;
          }
          return true;
        })
      : [];

    const scopedSalesReturnRequests = (data.salesReturnRequests || []).filter((req) => {
      if (rptOpType !== 'all' && rptOpType !== 'sales_return' && rptOpType !== 'sales') {
        return false;
      }
      if (!matchDates(req.date)) return false;
      if (rptCustomerId && req.customerId !== rptCustomerId) return false;
      if (rptProductId && !(req.items || []).some((it) => it.productId === rptProductId)) return false;
      if (
        qInvNum &&
        !String(req.requestNumber || '').toLowerCase().includes(qInvNum) &&
        !String(req.originalInvoiceNumber || '').toLowerCase().includes(qInvNum)
      ) {
        return false;
      }
      return true;
    });

    const invoiceRows = scopedInvoices.map((inv) => {
      const paymentStatus: 'paid' | 'partial' | 'credit' =
        Number(inv.remainingAmount || 0) <= 0.009
          ? 'paid'
          : Number(inv.paidAmount || 0) > 0.009
          ? 'partial'
          : 'credit';
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.date,
        type: inv.type,
        status: inv.status,
        dispatchStatus: inv.dispatchStatus,
        partyId: inv.customerId || inv.supplierId || '',
        partyName: inv.customerName || inv.supplierName || '',
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouseName || '',
        representativeId: inv.representativeId,
        representativeName: inv.representativeName,
        grandTotal: Number(inv.grandTotal || 0),
        paidAmount: Number(inv.paidAmount || 0),
        remainingAmount: Math.max(0, Number(inv.remainingAmount || 0)),
        paymentStatus,
        itemsCount: (inv.items || []).length,
        items: (inv.items || [])
          .filter((it) => !rptProductId || it.productId === rptProductId)
          .map((it) => ({
            productId: it.productId,
            productName: it.productName,
            barcode: it.barcode,
            unit: it.unit,
            unitFactor: Number(it.unitFactor || 1),
            quantity: Number(it.quantity || 0),
            unitPrice: Number(it.unitPrice || 0),
            discount: Number(it.discount || 0),
            total: Number(it.total || 0),
          })),
        notes: inv.notes,
      };
    });

    const prodLookup = new Map(data.products.map((p) => [p.id, p]));
    const itemRows = [
      ...scopedInvoices.flatMap((inv) => {
        const paymentStatus: 'paid' | 'partial' | 'credit' =
          Number(inv.remainingAmount || 0) <= 0.009
            ? 'paid'
            : Number(inv.paidAmount || 0) > 0.009
            ? 'partial'
            : 'credit';
        const retMap = (inv as any).returnedQuantityByItem || {};
        return (inv.items || [])
          .filter((it) => !rptProductId || it.productId === rptProductId)
          .map((it, idx) => {
            const p = prodLookup.get(it.productId);
            const qty = Number(it.quantity || 0);
            const retQty = Math.min(qty, Number(retMap[`${it.productId}::${it.unit}`] ?? retMap[it.productId] ?? 0));
            const netQty = Math.max(0, qty - retQty);
            const retVal = qty > 0 ? (Number(it.total || 0) * retQty) / qty : 0;
            const netVal = Math.max(0, Number(it.total || 0) - retVal);
            return {
              rowId: `${inv.id}-${idx}`,
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
              date: inv.date,
              opType: (inv.type === 'purchase' ? 'purchase' : 'sales') as 'sales' | 'purchase',
              status: inv.status,
              invoiceStatus: inv.status,
              paymentStatus,
              partyId: inv.customerId || inv.supplierId || '',
              partyName: inv.customerName || inv.supplierName || '',
              representativeName: inv.representativeName,
              createdByName: inv.createdByName || inv.createdBy,
              productId: it.productId,
              productName: it.productName,
              productCode: p?.code,
              barcode: it.barcode || p?.barcode,
              categoryName: p?.category,
              class1: p?.class1,
              unit: it.unit,
              quantity: qty,
              unitFactor: Number(it.unitFactor || 1),
              unitPrice: Number(it.unitPrice || 0),
              grossTotal: Number(it.total || 0),
              discount: Number(it.discount || 0),
              total: Number(it.total || 0),
              returnedQty: retQty,
              returnedValue: retVal,
              netQty,
              netValue: netVal,
              paidAmount: Number(inv.paidAmount || 0),
              remainingAmount: Math.max(0, Number(inv.remainingAmount || 0)),
            };
          });
      }),
      ...scopedReturns.flatMap((ret) =>
        (ret.items || [])
          .filter((it) => !rptProductId || it.productId === rptProductId)
          .map((it, idx) => {
            const p = prodLookup.get(it.productId);
            return {
              rowId: `${ret.id}-${idx}`,
              invoiceId: ret.id,
              invoiceNumber: ret.returnNumber,
              date: ret.date,
              opType: (ret.type === 'purchase_return' ? 'purchase_return' : 'sales_return') as
                | 'sales_return'
                | 'purchase_return',
              status: 'confirmed',
              invoiceStatus: 'confirmed',
              paymentStatus: (ret.refundType === 'cash' ? 'paid' : 'credit') as 'paid' | 'credit',
              partyId: ret.partyId,
              partyName: ret.partyName,
              createdByName: ret.createdBy,
              productId: it.productId,
              productName: it.productName,
              productCode: p?.code,
              barcode: p?.barcode,
              categoryName: p?.category,
              class1: p?.class1,
              unit: it.unit,
              quantity: Number(it.quantity || 0),
              unitFactor: Number(it.unitFactor || 1),
              unitPrice: Number(it.unitPrice || 0),
              grossTotal: Number(it.total || 0),
              discount: 0,
              total: Number(it.total || 0),
              returnedQty: Number(it.quantity || 0),
              returnedValue: Number(it.total || 0),
              netQty: 0,
              netValue: -Number(it.total || 0),
            };
          })
      ),
    ];

    const confirmedSales = scopedInvoices.filter((i) => i.type === 'sales' && i.status === 'confirmed');
    const confirmedPurchases = scopedInvoices.filter((i) => i.type === 'purchase' && i.status === 'confirmed');
    const salesReturns = scopedReturns.filter((r) => r.type === 'sales_return');
    const purchaseReturns = scopedReturns.filter((r) => r.type === 'purchase_return');

    const invAllMap = new Map((data.invoices || []).map((inv) => [inv.id, inv]));
    const collections = (data.financialTransactions || [])
      .filter((tx) => {
        if (!matchDates(tx.date)) return false;
        if (tx.category !== 'تحصيل من عميل' && tx.type !== 'customer_payment') return false;
        if (rptCustomerId && tx.partyId !== rptCustomerId) return false;
        return true;
      })
      .map((tx) => {
        const linked = tx.relatedDocId ? invAllMap.get(tx.relatedDocId) : undefined;
        return {
          id: tx.id,
          transactionNumber: tx.transactionNumber,
          date: tx.date,
          amount: Number(tx.amount || 0),
          partyId: tx.partyId,
          partyName: tx.partyName || 'عميل',
          paymentMethod: tx.paymentMethod,
          relatedDocId: tx.relatedDocId,
          relatedDocNumber: tx.relatedDocNumber || linked?.invoiceNumber,
          remainingAfter: linked ? Math.max(0, Number(linked.remainingAmount || 0)) : undefined,
          createdBy: tx.createdBy,
          notes: tx.notes,
        };
      });

    const salesTotal = confirmedSales.reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    const salesReturnsTotal = salesReturns.reduce((s, r) => s + Number(r.grandTotal || 0), 0);
    const purchasesTotal = confirmedPurchases.reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    const purchaseReturnsTotal = purchaseReturns.reduce((s, r) => s + Number(r.grandTotal || 0), 0);
    const collectionsTotal = collections.reduce((s, c) => s + Number(c.amount || 0), 0);

    const maxListLen = Math.max(
      itemRows.length,
      invoiceRows.length,
      scopedReturns.length,
      collections.length,
      scopedPurchaseReturnRequests.length
    );
    const safePageSize = Math.max(1, rptPageSize || 50);
    const totalPages = Math.max(1, Math.ceil(maxListLen / safePageSize));
    const safePage = Math.min(Math.max(1, rptPage), totalPages);
    const sliceArr = <T,>(arr: T[]) => arr.slice((safePage - 1) * safePageSize, safePage * safePageSize);

    const summaryOut: RepDetailedReportResponse['summary'] = {
      salesCount: confirmedSales.length,
      salesTotal,
      salesPaid: confirmedSales.reduce((s, i) => s + Number(i.paidAmount || 0), 0),
      salesRemaining: confirmedSales.reduce((s, i) => s + Math.max(0, Number(i.remainingAmount || 0)), 0),
      salesReturnsCount: salesReturns.length,
      salesReturnsTotal,
      netSalesTotal: Math.max(0, salesTotal - salesReturnsTotal),
      purchasesCount: confirmedPurchases.length,
      purchasesTotal,
      purchasesPaid: confirmedPurchases.reduce((s, i) => s + Number(i.paidAmount || 0), 0),
      purchasesRemaining: confirmedPurchases.reduce((s, i) => s + Math.max(0, Number(i.remainingAmount || 0)), 0),
      purchaseReturnsCount: purchaseReturns.length,
      purchaseReturnsTotal,
      purchaseReturnRequestsCount: canCreatePurchase ? scopedPurchaseReturnRequests.length : 0,
      pendingPurchaseReturnRequestsCount: canCreatePurchase
        ? scopedPurchaseReturnRequests.filter((r) => r.status === 'pending').length
        : 0,
      salesReturnRequestsCount: scopedSalesReturnRequests.length,
      pendingSalesReturnRequestsCount: scopedSalesReturnRequests.filter((r) => r.status === 'pending').length,
      collectionsCount: collections.length,
      collectionsTotal,
      purchasePaymentsTotal: confirmedPurchases.reduce((s, i) => s + Number(i.paidAmount || 0), 0),
    };
    if (!isRepRoleAccount) {
      summaryOut.totalCustomerReceivables = data.customers.reduce((s, c) => s + Number(c.currentBalance || 0), 0);
      summaryOut.totalSupplierPayables = canCreatePurchase
        ? data.suppliers.reduce((s, sup) => s + Number(sup.currentBalance || 0), 0)
        : 0;
    }

    return {
      scope: {
        isRepScoped: isRepRoleAccount,
        representativeId: rep?.id,
        representativeName: rep?.name || currentUser?.fullName,
        canViewSuppliers: canCreatePurchase,
        accountBalanceNote:
          'الأرصدة الظاهرة للعملاء والموردين تمثل الرصيد المالي العام على مستوى الشركة بالكامل، بينما إحصائيات وفواتير وتحصيلات التقرير تمثل عمليات هذا المندوب فقط.',
      },
      summary: summaryOut,
      pagination: {
        enabled: true,
        page: safePage,
        pageSize: safePageSize,
        totalRows: maxListLen,
        totalInvoices: invoiceRows.length,
        totalItemRows: itemRows.length,
        totalReturns: scopedReturns.length,
        totalCollections: collections.length,
        totalPurchaseReturnRequests: scopedPurchaseReturnRequests.length,
        totalSalesReturnRequests: scopedSalesReturnRequests.length,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
      },
      customersSummary: data.customers
        .filter((c) => !rptCustomerId || c.id === rptCustomerId)
        .map((c) => {
          const cSales = confirmedSales.filter((i) => i.customerId === c.id);
          const cColls = collections.filter((tx) => tx.partyId === c.id);
          return {
            id: c.id,
            name: c.name,
            shopName: c.shopName,
            phone: c.phone,
            companyBalance: Number(c.currentBalance || 0),
            repSalesCount: cSales.length,
            repSalesTotal: cSales.reduce((s, i) => s + Number(i.grandTotal || 0), 0),
            repPaidTotal: cSales.reduce((s, i) => s + Number(i.paidAmount || 0), 0),
            repCollectionsTotal: cColls.reduce((s, tx) => s + Number(tx.amount || 0), 0),
          };
        }),
      suppliersSummary: canCreatePurchase
        ? data.suppliers
            .filter((s) => !rptSupplierId || s.id === rptSupplierId)
            .map((sup) => {
              const sPur = confirmedPurchases.filter((i) => i.supplierId === sup.id);
              return {
                id: sup.id,
                name: sup.name,
                companyName: sup.companyName,
                phone: sup.phone,
                companyBalance: Number(sup.currentBalance || 0),
                repPurchasesCount: sPur.length,
                repPurchasesTotal: sPur.reduce((s, i) => s + Number(i.grandTotal || 0), 0),
                repPaidTotal: sPur.reduce((s, i) => s + Number(i.paidAmount || 0), 0),
              };
            })
        : [],
      invoices: sliceArr(invoiceRows),
      itemRows: sliceArr(itemRows),
      returns: sliceArr(scopedReturns),
      purchaseReturnRequests: sliceArr(scopedPurchaseReturnRequests),
      salesReturnRequests: sliceArr(scopedSalesReturnRequests),
      collections: sliceArr(collections),
    };
  }, [
    data.invoices,
    data.invoiceReturns,
    data.purchaseReturnRequests,
    data.salesReturnRequests,
    data.financialTransactions,
    data.customers,
    data.suppliers,
    data.products,
    canCreatePurchase,
    isRepRoleAccount,
    rep?.id,
    rep?.name,
    currentUser?.fullName,
    rptDateFrom,
    rptDateTo,
    rptInvoiceNumber,
    rptOpType,
    rptInvoiceStatus,
    rptCustomerId,
    rptSupplierId,
    rptPaymentStatus,
    rptProductId,
    rptPage,
    rptPageSize,
  ]);

  const loadRepSummaryReport = useCallback(async () => {
    setIsLoadingRepReport(true);
    setRepReportError(null);
    setRepReportIsOfflineFallback(false);
    try {
      const report = await fetchRepSummaryReport({
        dateFrom: rptDateFrom || undefined,
        dateTo: rptDateTo || undefined,
        partyKey: rptPartyKey !== 'all' ? rptPartyKey : undefined,
        customerId: rptCustomerId || undefined,
        supplierId: canCreatePurchase && rptSupplierId ? rptSupplierId : undefined,
        productId: rptProductId || undefined,
        invoiceNumber: rptInvoiceNumber.trim() || undefined,
        opType: rptOpType,
        paymentStatus: rptPaymentStatus,
        invoiceStatus: rptInvoiceStatus,
        page: rptPage,
        pageSize: rptPageSize,
      });
      setRepReportData(report);
    } catch (err: any) {
      const fallback = buildOfflineRepSummary();
      setRepReportData(fallback);
      setRepReportIsOfflineFallback(true);
      if (err?.status && err.status >= 400 && err.status < 500) {
        setRepReportError(err?.message || 'تعذر تحميل التقرير من الخادم.');
      }
    } finally {
      setIsLoadingRepReport(false);
    }
  }, [
    rptDateFrom,
    rptDateTo,
    rptPartyKey,
    rptCustomerId,
    rptSupplierId,
    rptProductId,
    rptInvoiceNumber,
    rptOpType,
    rptPaymentStatus,
    rptInvoiceStatus,
    rptPage,
    rptPageSize,
    canCreatePurchase,
    buildOfflineRepSummary,
  ]);

  useEffect(() => {
    if (activeTab === 'rep-reports') {
      loadRepSummaryReport();
    }
  }, [activeTab, loadRepSummaryReport]);

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

  const filteredInvoiceProducts = useMemo(() => {
    return activeProducts.filter((p) => {
      if (invOnlyVanStock && (p.stockPerWarehouse?.[effectiveVanId] || 0) <= 0) return false;
      return true;
    });
  }, [activeProducts, invOnlyVanStock, effectiveVanId]);

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
    setInvQty('');
    setInvLineDiscount('');
  };

  const handleUnitChange = (unitName: string) => {
    setInvUnitName(unitName);
    if (!selectedProduct) return;
    if (unitName === selectedProduct.baseUnit) {
      setInvPrice(selectedProduct.sellingPrice > 0 ? selectedProduct.sellingPrice : '');
    } else {
      const u = selectedProduct.units.find((x) => x.name === unitName);
      if (u) setInvPrice(u.sellingPrice > 0 ? u.sellingPrice : '');
    }
  };

  const handleAddInvoiceItem = () => {
    const qtyNum = Number(invQty || 0);
    const priceNum = Math.max(0, Number(invPrice || 0));
    if (!selectedProduct || qtyNum <= 0) return;
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
    const total = computeLineTotal(qtyNum, priceNum, safeDiscount);
    setInvItems((prev) => [
      ...prev,
      {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        barcode: selectedProduct.barcode,
        unit: invUnitName || selectedProduct.baseUnit,
        unitFactor,
        quantity: qtyNum,
        unitPrice: priceNum,
        purchasePriceAtTime,
        discount: safeDiscount,
        total,
      },
    ]);
    setInvProductId('');
    setInvQty('');
    setInvPrice('');
    setInvLineDiscount('');
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
        : Math.min(invGrandTotal, Math.max(0, Number(invPaidAmount || 0)));

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
      cashboxId: isRepRoleAccount || !canCashOps ? '' : invCashboxId,
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
  const purSubtotal = useMemo(() => purItems.reduce((s, i) => s + i.total, 0), [purItems]);
  const purTotal = useMemo(() => Math.max(0, purSubtotal - Math.max(0, Number(purDiscount || 0))), [purSubtotal, purDiscount]);

  const getPurchaseDispatchMeta = (inv: Invoice) => {
    if (inv.status === 'cancelled') {
      return { key: 'cancelled', label: 'ملغاة', badgeClass: 'bg-red-50 text-red-700 border border-red-200' };
    }
    if (inv.status === 'confirmed') {
      return { key: 'confirmed', label: 'معتمدة ومرحّلة', badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-200' };
    }
    switch (inv.dispatchStatus) {
      case 'sent':
        return { key: 'sent', label: 'مرسلة بانتظار الاستلام', badgeClass: 'bg-amber-50 text-amber-900 border border-amber-200' };
      case 'received':
        return { key: 'received', label: 'تم الاستلام (بانتظار الاعتماد)', badgeClass: 'bg-sky-50 text-sky-900 border border-sky-200' };
      case 'rejected':
        return { key: 'rejected', label: 'مرفوضة', badgeClass: 'bg-rose-50 text-rose-800 border border-rose-200' };
      default:
        return { key: 'draft', label: 'مسودة', badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200' };
    }
  };

  const selectedPurProduct = useMemo(
    () => activeProducts.find((p) => p.id === purProductId) || null,
    [activeProducts, purProductId]
  );

  const purUnitOptions = useMemo(() => {
    if (!selectedPurProduct) return [];
    return [
      { name: selectedPurProduct.baseUnit, factor: 1 },
      ...(selectedPurProduct.units || []).map((u) => ({
        name: u.name,
        factor: u.conversionFactor || 1,
      })),
    ];
  }, [selectedPurProduct]);

  useEffect(() => {
    if (!showPurInlineNewProduct) return;
    const hasQuery = Boolean(newPurProdName.trim() || newPurProdBarcode.trim() || newPurProdCode.trim());
    if (!hasQuery) {
      setPurDuplicateCheckState({ checking: false, exactMatch: null, matchedBy: null, similarMatches: [] });
      return;
    }

    let cancelled = false;
    setPurDuplicateCheckState((prev) => ({ ...prev, checking: true }));
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiRequest<{
          ok: boolean;
          exactMatch?: Product | null;
          matchedBy?: string | null;
          similarMatches?: Product[];
        }>('/api/products/check-duplicate', {
          method: 'POST',
          body: {
            name: newPurProdName.trim(),
            barcode: newPurProdBarcode.trim(),
            code: newPurProdCode.trim(),
            category: newPurProdCategory.trim(),
            baseUnit: newPurProdBaseUnit.trim(),
          },
        });
        if (!cancelled) {
          setPurDuplicateCheckState({
            checking: false,
            exactMatch: res?.exactMatch || null,
            matchedBy: res?.matchedBy || null,
            similarMatches: Array.isArray(res?.similarMatches) ? res.similarMatches : [],
          });
        }
      } catch {
        if (!cancelled) {
          const localRes = checkRepLocalProductDuplicates(data.products, {
            name: newPurProdName,
            barcode: newPurProdBarcode,
            code: newPurProdCode,
            category: newPurProdCategory,
            baseUnit: newPurProdBaseUnit,
          });
          setPurDuplicateCheckState({
            checking: false,
            exactMatch: localRes.exactMatch,
            matchedBy: localRes.matchedBy,
            similarMatches: localRes.similarMatches,
          });
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    showPurInlineNewProduct,
    newPurProdName,
    newPurProdBarcode,
    newPurProdCode,
    newPurProdCategory,
    newPurProdBaseUnit,
    data.products,
  ]);

  const handleSelectPurProduct = (prodId: string) => {
    setPurProductId(prodId);
    const prod = activeProducts.find((p) => p.id === prodId);
    if (!prod) return;
    setPurUnitName(prod.baseUnit);
    setPurPrice(prod.purchasePrice > 0 ? prod.purchasePrice : '');
    setPurQty('');
  };

  const handleSelectPurUnit = (unitName: string) => {
    setPurUnitName(unitName);
    if (!selectedPurProduct) return;
    const matched = purUnitOptions.find((u) => u.name === unitName);
    const factor = matched?.factor || 1;
    if (selectedPurProduct.purchasePrice > 0) {
      setPurPrice(Number((selectedPurProduct.purchasePrice * factor).toFixed(2)));
    }
  };

  const handleUseExistingPurDuplicateProduct = (prod: Product) => {
    setShowPurInlineNewProduct(false);
    setPurProductId(prod.id);
    setPurUnitName(prod.baseUnit);
    setPurPrice(prod.purchasePrice > 0 ? prod.purchasePrice : '');
    if (newPurProdQty !== '' && Number(newPurProdQty) > 0) {
      setPurQty(Number(newPurProdQty));
    }
    setFeedback(null);
  };

  const handleAddPurInlineNewProduct = () => {
    const cleanName = newPurProdName.trim();
    if (!cleanName) {
      setFeedback({ type: 'error', text: 'يرجى إدخال اسم الصنف الجديد أولاً.' });
      return;
    }
    const qtyNum = Number(newPurProdQty || 0);
    if (qtyNum <= 0) {
      setFeedback({ type: 'error', text: 'يرجى إدخال كمية الشراء للصنف الجديد أكبر من صفر.' });
      return;
    }
    const buyPrice = Math.max(0, Number(newPurProdBuyPrice || 0));
    const sellPrice = newPurProdSellPrice === '' ? 0 : Math.max(0, Number(newPurProdSellPrice || 0));

    const exact = purDuplicateCheckState.exactMatch;
    if (exact) {
      const effectiveBuy = buyPrice || exact.purchasePrice || 0;
      setPurItems((prev) => [
        ...prev,
        {
          productId: exact.id,
          productName: exact.name,
          barcode: exact.barcode || '',
          unit: exact.baseUnit,
          unitFactor: 1,
          quantity: qtyNum,
          unitPrice: effectiveBuy,
          purchasePriceAtTime: effectiveBuy,
          discount: 0,
          total: computeLineTotal(qtyNum, effectiveBuy),
        },
      ]);
      setFeedback({
        type: 'success',
        text: `تم ربط البند بالصنف الموجود (${exact.name}) لمنع التكرار في المخزن.`,
      });
    } else {
      const cleanCategory = newPurProdCategory.trim() || 'أصناف عامة';
      const cleanUnit = newPurProdBaseUnit.trim() || 'قطعة';
      const cleanBarcode = newPurProdBarcode.trim();
      const cleanCode = newPurProdCode.trim();
      setPurItems((prev) => [
        ...prev,
        {
          productId: '',
          productName: cleanName,
          barcode: cleanBarcode || cleanCode,
          unit: cleanUnit,
          unitFactor: 1,
          quantity: qtyNum,
          unitPrice: buyPrice,
          purchasePriceAtTime: buyPrice,
          discount: 0,
          total: computeLineTotal(qtyNum, buyPrice),
          newProduct: {
            name: cleanName,
            barcode: cleanBarcode || undefined,
            code: cleanCode || undefined,
            category: cleanCategory,
            baseUnit: cleanUnit,
            purchasePrice: buyPrice,
            sellingPrice: sellPrice,
          },
        },
      ]);
      setFeedback({
        type: 'success',
        text: `تمت إضافة الصنف الجديد (${cleanName}) لبنود المسودة؛ سيُدرج بالمخزون عند اعتماد الإدارة.`,
      });
    }

    setNewPurProdName('');
    setNewPurProdBarcode('');
    setNewPurProdCode('');
    setNewPurProdQty('');
    setNewPurProdBuyPrice('');
    setNewPurProdSellPrice('');
    setPurDuplicateCheckState({ checking: false, exactMatch: null, matchedBy: null, similarMatches: [] });
    setShowPurInlineNewProduct(false);
  };

  const handleAddPurItem = () => {
    const prod = activeProducts.find((p) => p.id === purProductId);
    const qtyNum = Number(purQty || 0);
    if (!prod || qtyNum <= 0) return;
    const priceNum = Math.max(0, Number(purPrice || 0));
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
        quantity: qtyNum,
        unitPrice: priceNum,
        purchasePriceAtTime: factor > 0 ? Number((priceNum / factor).toFixed(2)) : priceNum,
        discount: 0,
        total: computeLineTotal(qtyNum, priceNum),
      },
    ]);
    setPurProductId('');
    setPurQty('');
    setPurPrice('');
  };

  const handleStartEditPurchase = (inv: Invoice) => {
    setPurEditingInvoiceId(inv.id);
    setPurSupplierId(inv.supplierId || '');
    setPurWarehouseId(inv.warehouseId || mainWarehouse?.id || '');
    setPurItems(
      (inv.items || []).map((it) => ({
        productId: it.productId,
        productName: it.productName,
        barcode: it.barcode || '',
        unit: it.unit,
        unitFactor: it.unitFactor || 1,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        purchasePriceAtTime: it.purchasePriceAtTime ?? it.unitPrice,
        discount: it.discount || 0,
        total: it.total,
      }))
    );
    setPurDiscount(Number(inv.discountTotal || 0));
    setPurPaymentType(inv.paymentType || 'cash');
    setPurPaidAmount(Number(inv.paidAmount || 0));
    setPurCashboxId(inv.cashboxId || data.cashboxes[0]?.id || 'CASH-01');
    setPurNotes(inv.notes || '');
    setPurRecipientUserId(inv.recipientUserId || '');
    onTabChange('new-purchase');
  };

  const handleOpenPurchaseReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!purSupplierId || !purItems.length) {
      setFeedback({ type: 'error', text: 'يرجى اختيار المورد وإضافة صنف واحد على الأقل.' });
      return;
    }
    setFeedback(null);
    setPurReviewOpen(true);
  };

  const handleSubmitPurchaseInvoice = async (sendNow: boolean) => {
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
        : Math.min(purTotal, Math.max(0, Number(purPaidAmount || 0)));
    const chosenRecipient = (data.purchaseReceivers || []).find((r) => r.id === purRecipientUserId);

    setIsSubmittingPurchase(true);
    setFeedback(null);

    if (purEditingInvoiceId) {
      const editRes = await data.editPurchaseInvoice(purEditingInvoiceId, {
        date: new Date().toISOString().split('T')[0],
        supplierId: purSupplierId,
        supplierName: sup?.name || 'مورد',
        warehouseId: whId,
        warehouseName: wh?.name || 'المخزن الرئيسي',
        discountTotal: Math.max(0, Number(purDiscount || 0)),
        paidAmount: paid,
        paymentType: purPaymentType,
        notes: purNotes.trim() || undefined,
        reason: 'تعديل فاتورة الشراء قبل الإرسال',
        items: purItems,
      });
      if (!editRes.success) {
        setIsSubmittingPurchase(false);
        setFeedback({ type: 'error', text: editRes.error || 'تعذر حفظ تعديلات فاتورة الشراء' });
        return;
      }

      if (sendNow) {
        const sendRes = await data.sendPurchaseInvoice(purEditingInvoiceId, {
          recipientUserId: chosenRecipient?.id || undefined,
          recipientName: chosenRecipient?.fullName || 'الإدارة العامة',
        });
        setIsSubmittingPurchase(false);
        if (!sendRes.success) {
          setFeedback({ type: 'error', text: sendRes.error || 'تم حفظ التعديل لكن تعذر إرسال الفاتورة للإدارة' });
          return;
        }
      } else {
        setIsSubmittingPurchase(false);
      }

      setPurEditingInvoiceId(null);
      setPurItems([]);
      setPurDiscount('');
      setPurNotes('');
      setPurReviewOpen(false);
      setFeedback({
        type: editRes.queuedOffline ? 'warning' : 'success',
        text: sendNow
          ? 'تم تحديث فاتورة الشراء وإرسالها للإدارة بانتظار الاستلام والمراجعة.'
          : 'تم تحديث وحفظ فاتورة الشراء كمسودة دون تعديل أرصدة المخازن.',
      });
      onTabChange('purchases-list');
      return;
    }

    const res = await data.createPurchaseInvoice({
      date: new Date().toISOString().split('T')[0],
      supplierId: purSupplierId,
      supplierName: sup?.name || 'مورد',
      representativeId: rep?.id,
      representativeName: rep?.name,
      warehouseId: whId,
      warehouseName: wh?.name || 'المخزن الرئيسي',
      items: purItems,
      subtotal: purSubtotal,
      discountTotal: Math.max(0, Number(purDiscount || 0)),
      taxTotal: 0,
      grandTotal: purTotal,
      paidAmount: paid,
      remainingAmount: Math.max(0, purTotal - paid),
      paymentType: purPaymentType,
      paymentMethod: 'cash',
      cashboxId: isRepRoleAccount || !canCashOps ? '' : purCashboxId,
      status: 'draft',
      dispatchStatus: sendNow ? 'sent' : 'draft',
      sendNow,
      recipientUserId: sendNow ? chosenRecipient?.id : undefined,
      recipientName: sendNow ? (chosenRecipient?.fullName || 'الإدارة العامة') : undefined,
      isRepPurchase: true,
      notes: purNotes.trim() || undefined,
    });
    setIsSubmittingPurchase(false);
    if (res.success) {
      setPurItems([]);
      setPurDiscount(0);
      setPurNotes('');
      setPurReviewOpen(false);
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? `تم حفظ فاتورة الشراء كمسودة (${res.invoice?.invoiceNumber || ''}) محلياً للمزامنة عبر REFRESH.`
          : sendNow
          ? `تم إرسال فاتورة الشراء (${res.invoice?.invoiceNumber || ''}) للإدارة بانتظار الاستلام والاعتماد.`
          : `تم حفظ فاتورة الشراء كمسودة (${res.invoice?.invoiceNumber || ''}) دون ترحيل للمخزون.`,
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

    if ((isRepRoleAccount || !canCashOps) && (!inv || inv.status !== 'confirmed')) {
      setFeedback({
        type: 'error',
        text: 'يرجى اختيار فاتورة مبيعات أصلية معتمدة أولاً لإتمام المرتجع.',
      });
      return;
    }

    const requiresSalesRequest = sRetSettlement === 'cash' && (isRepRoleAccount || !canCashOps);
    if (requiresSalesRequest) {
      if (!inv || inv.status !== 'confirmed') {
        setFeedback({ type: 'error', text: 'لرفع طلب مرتجع مبيعات نقدي، يجب اختيار فاتورة مبيعات أصلية معتمدة أولاً.' });
        return;
      }
      if (!sRetReason.trim()) {
        setFeedback({ type: 'error', text: 'يرجى كتابة سبب طلب مرتجع المبيعات النقدي.' });
        return;
      }
      setIsSubmittingSRet(true);
      setFeedback(null);
      const reqRes = await data.createSalesReturnRequest({
        originalInvoiceId: inv.id,
        date: new Date().toISOString().split('T')[0],
        items: sRetItems.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          unitFactor: it.unitFactor,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        })),
        refundType: 'cash',
        reason: sRetReason.trim(),
      });
      setIsSubmittingSRet(false);
      if (reqRes.success) {
        setSRetItems([]);
        setSRetReason('');
        setFeedback({
          type: reqRes.queuedOffline ? 'warning' : 'success',
          text: reqRes.queuedOffline
            ? 'تم حفظ طلب مرتجع المبيعات النقدي محلياً في طابور المزامنة لمراجعة الخزينة والإدارة — لن يتغير رصيد الخزينة قبل الاعتماد.'
            : `تم رفع طلب مرتجع المبيعات النقدي (${reqRes.request?.requestNumber || ''}) لمراجعة الإدارة والخزينة دون التأثير على الخزينة حتى الاعتماد.`,
        });
        onTabChange('sales-returns-list');
      } else {
        setFeedback({ type: 'error', text: reqRes.error || 'تعذر رفع طلب مرتجع البيع النقدي' });
      }
      return;
    }

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
      refundType: sRetSettlement === 'cash' && canCashOps && !isRepRoleAccount ? 'cash' : 'balance',
      cashboxId: sRetSettlement === 'cash' && canCashOps && !isRepRoleAccount ? sRetCashboxId : undefined,
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

  const confirmedOwnPurchases = useMemo(() => {
    return (data.invoices || [])
      .filter(
        (i) =>
          i.type === 'purchase' &&
          i.status === 'confirmed' &&
          (!isRepRoleAccount ||
            (rep?.id && i.representativeId === rep.id) ||
            (currentUser?.id && i.createdByUserId === currentUser.id) ||
            (currentUser?.id && i.sentByUserId === currentUser.id) ||
            (!i.createdByUserId && !i.representativeId && !i.sentByUserId && currentUser?.id && i.createdBy === currentUser.id))
      )
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [data.invoices, isRepRoleAccount, currentUser?.id, rep?.id]);

  const selectedPRetOrigInvoice = useMemo(
    () => confirmedOwnPurchases.find((i) => i.id === pRetInvoiceId) || null,
    [confirmedOwnPurchases, pRetInvoiceId]
  );

  const pRetReturnableOptions = useMemo(() => {
    if (!selectedPRetOrigInvoice) return [];
    const returnedByKey: Record<string, number> = {};
    for (const r of data.invoiceReturns || []) {
      if (r.type !== 'purchase_return' || r.originalInvoiceId !== selectedPRetOrigInvoice.id) continue;
      for (const it of r.items || []) {
        const k = `${it.productId}::${it.unit}`;
        returnedByKey[k] = (returnedByKey[k] || 0) + Number(it.quantity || 0);
      }
    }
    for (const req of data.purchaseReturnRequests || []) {
      if (req.status !== 'pending' || req.originalInvoiceId !== selectedPRetOrigInvoice.id) continue;
      for (const it of req.items || []) {
        const k = `${it.productId}::${it.unit}`;
        returnedByKey[k] = (returnedByKey[k] || 0) + Number(it.quantity || 0);
      }
    }
    for (const it of pRetItems) {
      const k = `${it.productId}::${it.unit}`;
      returnedByKey[k] = (returnedByKey[k] || 0) + Number(it.quantity || 0);
    }
    return (selectedPRetOrigInvoice.items || []).map((it) => {
      const k = `${it.productId}::${it.unit}`;
      const usedQty = returnedByKey[k] || 0;
      const maxReturnableQty = Math.max(0, Number(it.quantity || 0) - usedQty);
      return {
        ...it,
        maxReturnableQty,
      };
    });
  }, [selectedPRetOrigInvoice, data.invoiceReturns, data.purchaseReturnRequests, pRetItems]);

  const myPurchaseReturnRequests = useMemo(() => {
    return [...(data.purchaseReturnRequests || [])].sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
  }, [data.purchaseReturnRequests]);

  const handleSubmitPurchaseReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    const useRequestFlow = isRepRoleAccount || !canPurchases;

    if (useRequestFlow) {
      if (!selectedPRetOrigInvoice) {
        setFeedback({ type: 'error', text: 'يرجى اختيار فاتورة شراء معتمدة خاصة بك أولاً.' });
        return;
      }
      if (!pRetItems.length) {
        setFeedback({ type: 'error', text: 'يرجى إضافة صنف واحد على الأقل من بنود الفاتورة المحددة.' });
        return;
      }
      if (!pRetReason.trim()) {
        setFeedback({ type: 'error', text: 'يرجى كتابة سبب طلب مرتجع المشتريات (حقل إلزامي).' });
        return;
      }
      setIsSubmittingPRet(true);
      setFeedback(null);
      const res = await data.createPurchaseReturnRequest({
        originalInvoiceId: selectedPRetOrigInvoice.id,
        date: new Date().toISOString().split('T')[0],
        items: pRetItems.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          unitFactor: it.unitFactor,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        })),
        refundType: pRetSettlement === 'cash' ? 'cash' : 'balance',
        cashboxId: !isRepRoleAccount && canCashOps && pRetSettlement === 'cash' ? pRetCashboxId : undefined,
        reason: pRetReason.trim(),
      });
      setIsSubmittingPRet(false);
      if (res.success) {
        setPRetItems([]);
        setPRetReason('');
        setPRetProductId('');
        setPRetInvoiceId('');
        setPRetSupplierId('');
        setFeedback({
          type: res.queuedOffline ? 'warning' : 'success',
          text: res.queuedOffline
            ? 'تم حفظ طلب مرتجع المشتريات محلياً في طابور المزامنة — سيتم إرساله للإدارة عند المزامنة ولن يتغير المخزون أو حساب المورد قبل الاعتماد.'
            : `تم إرسال طلب مرتجع المشتريات (${res.request?.requestNumber || ''}) للإدارة للمراجعة والاعتماد — لن يتغير المخزون أو حساب المورد قبل اعتماد الإدارة.`,
        });
        onTabChange('purchase-returns-list');
      } else {
        setFeedback({ type: 'error', text: res.error || 'تعذر إرسال طلب مرتجع المشتريات.' });
      }
      return;
    }

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
      refundType: pRetSettlement === 'cash' && !isRepRoleAccount && canCashOps ? 'cash' : 'balance',
      cashboxId: pRetSettlement === 'cash' && !isRepRoleAccount && canCashOps ? pRetCashboxId : undefined,
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
    const depNum = Number(depAmount || 0);
    if (depNum <= 0) {
      setFeedback({ type: 'error', text: 'يرجى إدخال مبلغ صحيح أكبر من الصفر.' });
      return;
    }
    if (isRepRoleAccount && depMode === 'cashbox_deposit') {
      setFeedback({
        type: 'error',
        text: 'غير مصرح للمندوب بتنفيذ إيداع مباشر بالخزينة؛ استخدم تحصيل من عميل أو توريد عهدة.',
      });
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
          depNum,
          isRepRoleAccount || !canCashOps ? '' : depCashboxId,
          depNotes.trim() || 'تحصيل نقدي عبر تطبيق المندوب',
          depMethod,
          depInvoiceId || undefined
        );
        if (res.success) {
          const collectedCustId = depCustomerId;
          setDepAmount('');
          setDepInvoiceId('');
          setDepNotes('');
          if (selectedCustomerDetail?.id === collectedCustId) {
            data.getCustomerStatement(collectedCustId).then((st) => {
              if (st) setCustomerDetailStatement(st);
            }).catch(() => {});
          }
          setFeedback({
            type: res.queuedOffline ? 'warning' : 'success',
            text: res.queuedOffline
              ? 'تم حفظ التحصيل محلياً بانتظار المزامنة.'
              : 'تم تسجيل التحصيل من العميل وتحديث الرصيد.',
          });
        } else {
          setFeedback({ type: 'error', text: res.error || 'تعذر تسجيل التحصيل' });
        }
      } else {
        const res = await data.executeCashOperation({
          type: 'cash_deposit',
          cashboxId: depCashboxId,
          amount: depNum,
          date: depDate || new Date().toISOString().split('T')[0],
          category: 'إيداع نقدي',
          recipientOrPayer: rep?.name || currentUser?.fullName || 'المندوب',
          notes: depNotes.trim() || 'إيداع نقدي من الشاشة الرئيسية',
        });
        if (res.success) {
          setDepAmount('');
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
    if (isRepRoleAccount || !canCashOps) {
      setFeedback({
        type: 'error',
        text: 'غير مصرح لحساب المندوب بتنفيذ سحب أو مصروف مباشر من الخزينة.',
      });
      return;
    }
    const wdNum = Number(wdAmount || 0);
    if (wdNum <= 0) {
      setFeedback({ type: 'error', text: 'يرجى إدخال مبلغ سحب صحيح أكبر من الصفر.' });
      return;
    }
    setIsSubmittingWithdrawal(true);
    setFeedback(null);
    try {
      const res = await data.executeCashOperation({
        type: 'expense',
        cashboxId: wdCashboxId,
        amount: wdNum,
        date: new Date().toISOString().split('T')[0],
        category: wdCategory.trim() || 'سحب نقدي ومصروفات',
        recipientOrPayer: wdBeneficiary.trim() || rep?.name || currentUser?.fullName || '',
        notes: wdNotes.trim() || 'سحب نقدي عبر تطبيق المندوب',
      });
      if (res.success) {
        setWdAmount('');
        setWdCategory('');
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

  const openPurchasePaymentModal = (inv: Invoice) => {
    setPayingPurchaseTarget(inv);
    setPurPayAmount(Math.max(0, Number(inv.remainingAmount || 0)));
    setPurPayMethod('cash');
    setPurPayDate(new Date().toISOString().split('T')[0]);
    setPurPayNotes('');
  };

  const handleSubmitPurchasePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingPurchaseTarget) return;
    const rem = Math.max(0, Number(payingPurchaseTarget.remainingAmount || 0));
    if (purPayAmount <= 0) {
      setFeedback({ type: 'error', text: 'يرجى إدخال مبلغ سداد صحيح أكبر من الصفر.' });
      return;
    }
    if (purPayAmount > rem + 0.01) {
      setFeedback({ type: 'error', text: `مبلغ السداد يتجاوز المتبقي على الفاتورة (${rem.toLocaleString()}).` });
      return;
    }
    setIsSubmittingPurPayment(true);
    setFeedback(null);
    try {
      const defaultCb = data.cashboxes[0]?.id || 'CASH-01';
      const res = await data.addInvoicePayment(payingPurchaseTarget.id, {
        amount: purPayAmount,
        paymentMethod: purPayMethod,
        cashboxId: defaultCb,
        date: purPayDate || new Date().toISOString().split('T')[0],
        notes: purPayNotes.trim() || `دفعة سداد فاتورة شراء ${payingPurchaseTarget.invoiceNumber}`,
      });
      if (res.success) {
        const paidNum = payingPurchaseTarget.invoiceNumber;
        setPayingPurchaseTarget(null);
        setFeedback({
          type: res.queuedOffline ? 'warning' : 'success',
          text: res.queuedOffline
            ? `تم حفظ دفعة السداد للفاتورة ${paidNum} محلياً بانتظار المزامنة.`
            : `تم تسجيل دفعة سداد للفاتورة ${paidNum} وتحديث رصيد المورد بنجاح.`,
        });
      } else {
        setFeedback({ type: 'error', text: res.error || 'تعذر تسجيل دفعة السداد' });
      }
    } finally {
      setIsSubmittingPurPayment(false);
    }
  };

  // ==================== NEW CUSTOMER & SUPPLIER HANDLERS ====================
  const handleCustPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploadingCustPhoto(true);
      const dataUrl = await compressImageFileToDataUrl(file);
      setNewCustShopPhoto(dataUrl);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر معالجة صورة المحل' });
    } finally {
      setIsUploadingCustPhoto(false);
    }
  };

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
            if (rev.governorate) setNewCustGovernorate((prev) => prev.trim() || rev.governorate || '');
            setFeedback({ type: 'success', text: 'تم التقاط إحداثيات GPS وجلب العنوان والمحافظة تلقائياً.' });
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
    const primaryPhoneClean = newCustPhone.trim();
    const extraClean = newCustExtraPhones
      .map((p, idx) => ({
        id: p.id || `ph-${idx + 1}`,
        phone: p.phone.trim(),
        label: p.label.trim() || 'إضافي',
        isPrimary: false,
      }))
      .filter((p) => p.phone && p.phone !== primaryPhoneClean);

    if (!newCustName.trim() || !primaryPhoneClean) {
      setFeedback({ type: 'error', text: 'يرجى إدخال اسم العميل ورقم الهاتف الرئيسي.' });
      return;
    }

    const consolidatedPhones: CustomerPhoneEntry[] = [
      { id: 'ph-primary', phone: primaryPhoneClean, label: 'رئيسي', isPrimary: true },
      ...extraClean,
    ];

    const parsedNewGeo = parseLatLngCoords(newCustGeo || '');
    const resolvedNewLat = newCustLat ?? parsedNewGeo?.lat;
    const resolvedNewLng = newCustLng ?? parsedNewGeo?.lng;
    if (isZeroZeroLocation(resolvedNewLat, resolvedNewLng)) {
      setFeedback({ type: 'error', text: 'إحداثيات (0, 0) غير صالحة — يرجى تحديد موقع حقيقي على الخريطة.' });
      return;
    }

    setIsSavingCustomer(true);
    setFeedback(null);
    try {
      const cust = await data.addCustomer({
        code: `C-${Date.now().toString().slice(-5)}`,
        name: newCustName.trim(),
        shopName: newCustShop.trim() || newCustName.trim(),
        phone: primaryPhoneClean,
        secondaryPhone: extraClean[0]?.phone || undefined,
        phones: consolidatedPhones,
        governorate: newCustGovernorate.trim() || undefined,
        address: newCustAddress.trim() || newCustArea.trim() || '-',
        area: newCustArea.trim() || undefined,
        city: newCustCity.trim() || newCustArea.trim() || undefined,
        geoCoordinates: newCustGeo.trim() || undefined,
        latitude: resolvedNewLat,
        longitude: resolvedNewLng,
        locationCapturedAt: newCustLocAt,
        photo: newCustShopPhoto || undefined,
        shopPhoto: newCustShopPhoto || undefined,
        notes: newCustNotes.trim() || undefined,
        openingBalance: Number(newCustOpening) || 0,
        status: 'active',
        allowedRepIds: rep ? [rep.id] : [],
      });
      setNewCustName('');
      setNewCustShop('');
      setNewCustPhone('');
      setNewCustExtraPhones([]);
      setNewCustGovernorate('');
      setNewCustArea('');
      setNewCustCity('');
      setNewCustAddress('');
      setNewCustGeo('');
      setNewCustLat(undefined);
      setNewCustLng(undefined);
      setNewCustLocAt(undefined);
      setNewCustShopPhoto('');
      setNewCustNotes('');
      setNewCustOpening('');
      if (custCameraInputRef.current) custCameraInputRef.current.value = '';
      if (custGalleryInputRef.current) custGalleryInputRef.current.value = '';
      setInvCustomerId(cust.id);
      setFeedback({ type: 'success', text: `تم إضافة العميل (${cust.shopName || cust.name}) بجميع بياناته وصورته بنجاح.` });
      onTabChange('customers');
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر إضافة العميل' });
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const openEditCustomerSheet = (c: Customer) => {
    const primaryClean = String(c.phone || '').trim();
    const extras: Array<{ id: string; phone: string; label: string }> = [];
    if (Array.isArray(c.phones)) {
      c.phones.forEach((p, idx) => {
        const val = String(p?.phone || p?.number || '').trim();
        if (!val) return;
        if (val === primaryClean && (p.isPrimary || idx === 0)) return;
        if (extras.some((ex) => ex.phone === val)) return;
        extras.push({
          id: p.id || `ph-${idx + 1}`,
          phone: val,
          label: p.label || 'إضافي',
        });
      });
    }
    if (
      c.secondaryPhone &&
      String(c.secondaryPhone).trim() !== primaryClean &&
      !extras.some((ex) => ex.phone === String(c.secondaryPhone).trim())
    ) {
      extras.unshift({
        id: 'ph-sec',
        phone: String(c.secondaryPhone).trim(),
        label: 'إضافي',
      });
    }
    setEditingCustomerTarget(c);
    setEditCustName(c.name || '');
    setEditCustShop(c.shopName || '');
    setEditCustPhone(primaryClean);
    setEditCustExtraPhones(extras);
    setEditCustGovernorate(c.governorate || '');
    setEditCustArea(c.area || '');
    setEditCustCity(c.city || '');
    setEditCustAddress(c.address || '');
    setEditCustGeo(c.geoCoordinates || '');
    setEditCustLat(c.latitude);
    setEditCustLng(c.longitude);
    setEditCustLocAt(c.locationCapturedAt);
    setEditCustShopPhoto(c.shopPhoto || c.photo || '');
    setEditCustPhotoChanged(false);
    setEditCustClearPhoto(false);
    setEditCustNotes(c.notes || '');
    setEditCustPhoneNotice(null);
    setEditCustMapNotice(null);
  };

  const handleEditCustPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploadingEditCustPhoto(true);
      const dataUrl = await compressImageFileToDataUrl(file);
      setEditCustShopPhoto(dataUrl);
      setEditCustPhotoChanged(true);
      setEditCustClearPhoto(false);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر معالجة صورة المحل' });
    } finally {
      setIsUploadingEditCustPhoto(false);
    }
  };

  const handleCaptureEditCustLocation = async () => {
    setIsLocatingEditCust(true);
    try {
      const res = await getCurrentLocationSafe();
      if (res.ok && res.coords) {
        setEditCustGeo(res.coords);
        setEditCustMapNotice(null);
        const parsed = parseLatLngCoords(res.coords);
        if (parsed) {
          const rev = await reverseGeocodeCoords(parsed.lat, parsed.lng);
          if (rev.ok) {
            setEditCustAddress((prev) => (prev.trim() && prev.trim() !== '-' ? prev : rev.address));
            if (rev.area) setEditCustArea((prev) => prev.trim() || rev.area || '');
            if (rev.governorate) setEditCustGovernorate((prev) => prev.trim() || rev.governorate || '');
            setFeedback({ type: 'success', text: 'تم تحديث إحداثيات GPS وجلب العنوان والمحافظة تلقائياً.' });
            return;
          }
          setEditCustMapNotice(rev.error);
          setFeedback({ type: 'warning', text: 'تم تحديث إحداثيات GPS، وتعذر جلب العنوان تلقائياً — يمكنك كتابته يدوياً.' });
          return;
        }
        setFeedback({ type: 'success', text: 'تم تحديث إحداثيات GPS للعميل.' });
      } else {
        setFeedback({ type: 'error', text: res.error || 'تعذر تحديد الموقع الجغرافي' });
      }
    } finally {
      setIsLocatingEditCust(false);
    }
  };

  const handleSaveEditedCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomerTarget) return;
    const primaryPhoneClean = editCustPhone.trim();
    const extraClean = editCustExtraPhones
      .map((p, idx) => ({
        id: p.id || `ph-${idx + 1}`,
        phone: p.phone.trim(),
        label: p.label.trim() || 'إضافي',
        isPrimary: false,
      }))
      .filter((p) => p.phone && p.phone !== primaryPhoneClean);

    if (!editCustName.trim() || !primaryPhoneClean) {
      setFeedback({ type: 'error', text: 'يرجى إدخال اسم العميل ورقم الهاتف الرئيسي.' });
      return;
    }

    const consolidatedPhones: CustomerPhoneEntry[] = [
      { id: 'ph-primary', phone: primaryPhoneClean, label: 'رئيسي', isPrimary: true },
      ...extraClean,
    ];

    const parsedEditGeo = parseLatLngCoords(editCustGeo || '');
    const resolvedEditLat = editCustLat ?? parsedEditGeo?.lat;
    const resolvedEditLng = editCustLng ?? parsedEditGeo?.lng;
    if (isZeroZeroLocation(resolvedEditLat, resolvedEditLng)) {
      setFeedback({ type: 'error', text: 'إحداثيات (0, 0) غير صالحة — يرجى تحديد موقع حقيقي على الخريطة.' });
      return;
    }

    const updatesPayload: Partial<Customer> = {
      name: editCustName.trim(),
      shopName: editCustShop.trim() || editCustName.trim(),
      phone: primaryPhoneClean,
      secondaryPhone: extraClean[0]?.phone || undefined,
      phones: consolidatedPhones,
      governorate: editCustGovernorate.trim() || '',
      area: editCustArea.trim() || undefined,
      city: editCustCity.trim() || editCustArea.trim() || undefined,
      address: editCustAddress.trim() || editCustArea.trim() || '-',
      geoCoordinates: editCustGeo.trim() || undefined,
      latitude: resolvedEditLat,
      longitude: resolvedEditLng,
      locationCapturedAt: editCustLocAt,
      notes: editCustNotes.trim() || '',
      ...(editCustClearPhoto
        ? { clearShopPhoto: true }
        : editCustPhotoChanged && editCustShopPhoto
        ? { shopPhoto: editCustShopPhoto, photo: editCustShopPhoto }
        : {}),
    };

    setIsSavingEditCustomer(true);
    setFeedback(null);
    try {
      const res = await data.updateCustomer(editingCustomerTarget.id, updatesPayload);
      const nextPhotoVal = editCustClearPhoto
        ? undefined
        : editCustPhotoChanged && editCustShopPhoto
        ? editCustShopPhoto
        : (editingCustomerTarget.shopPhoto || editingCustomerTarget.photo);
      const nextDetail: Customer = {
        ...editingCustomerTarget,
        ...updatesPayload,
        shopPhoto: nextPhotoVal,
        photo: nextPhotoVal,
      };
      if (selectedCustomerDetail?.id === editingCustomerTarget.id) {
        setSelectedCustomerDetail(nextDetail);
      }
      setEditingCustomerTarget(null);
      setFeedback({
        type: (res as any)?.queuedOffline ? 'warning' : 'success',
        text: (res as any)?.queuedOffline
          ? `تم حفظ تعديل بيانات (${nextDetail.shopName || nextDetail.name}) محلياً بانتظار المزامنة.`
          : `تم تحديث بيانات (${nextDetail.shopName || nextDetail.name}) بنجاح.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'تعذر حفظ تعديلات العميل' });
    } finally {
      setIsSavingEditCustomer(false);
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
      setNewSupOpening('');
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
    setQuotePrice(prod.sellingPrice > 0 ? prod.sellingPrice : '');
    setQuoteQty('');
  };

  const handleAddQuoteItem = () => {
    const prod = activeProducts.find((p) => p.id === quoteProductId);
    const qQty = Number(quoteQty || 0);
    const qPrice = Math.max(0, Number(quotePrice || 0));
    if (!prod || qQty <= 0) return;
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
        quantity: qQty,
        unitPrice: qPrice,
        purchasePriceAtTime: prod.purchasePrice * factor,
        discount: 0,
        total: computeLineTotal(qQty, qPrice),
      },
    ]);
    setQuoteProductId('');
    setQuoteQty('');
    setQuotePrice('');
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
      cashboxId: isRepRoleAccount || !canCashOps ? '' : (data.cashboxes[0]?.id || ''),
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
    const chqNumAmt = Number(chqAmount || 0);
    if (!chqNumber.trim() || !chqPartyName.trim() || chqNumAmt <= 0) {
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
        amount: chqNumAmt,
        dueDate: chqDueDate,
        issueDate: new Date().toISOString().split('T')[0],
        status: 'pending',
      });
      setChqNumber('');
      setChqPartyName('');
      setChqBank('');
      setChqAmount('');
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
        cashboxId: !isRepRoleAccount && canCashOps && deliveryCollectedAmount > 0 ? deliveryCashboxId : undefined,
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

  const mySalesReturnRequests = useMemo(() => {
    return [...(data.salesReturnRequests || [])].sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
  }, [data.salesReturnRequests]);

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
    const matched = data.customers.filter((c) => {
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.shopName && c.shopName.toLowerCase().includes(q)) ||
        c.code.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.area && c.area.toLowerCase().includes(q)) ||
        (c.governorate && c.governorate.toLowerCase().includes(q));
      if (!matchesSearch) return false;
      if (customerFilterMode === 'current') return c.status !== 'blocked';
      if (customerFilterMode === 'debtors') return Number(c.currentBalance || 0) > 0.009;
      if (customerFilterMode === 'credits') return Number(c.currentBalance || 0) < -0.009;
      return true;
    });

    return [...matched].sort((a, b) => {
      if (customerSortMode === 'debt_desc') {
        return Number(b.currentBalance || 0) - Number(a.currentBalance || 0);
      }
      if (customerSortMode === 'credit_desc') {
        return Number(a.currentBalance || 0) - Number(b.currentBalance || 0);
      }
      return (a.shopName || a.name).localeCompare(b.shopName || b.name, 'ar');
    });
  }, [data.customers, customerSearch, customerFilterMode, customerSortMode]);

  const repCustomersStats = useMemo(() => {
    const total = data.customers.length;
    if (!canViewCustomerAggregateTotals) {
      return {
        total,
        debtorsCount: 0,
        creditsCount: 0,
        totalDue: 0,
        totalCredit: 0,
        debtorPct: 0,
      };
    }
    const debtors = data.customers.filter((c) => Number(c.currentBalance || 0) > 0.009);
    const credits = data.customers.filter((c) => Number(c.currentBalance || 0) < -0.009);
    const totalDue = debtors.reduce((sum, c) => sum + Number(c.currentBalance || 0), 0);
    const totalCredit = credits.reduce((sum, c) => sum + Math.abs(Number(c.currentBalance || 0)), 0);
    const debtorPct = total > 0 ? Math.round((debtors.length / total) * 100) : 0;
    return {
      total,
      debtorsCount: debtors.length,
      creditsCount: credits.length,
      totalDue,
      totalCredit,
      debtorPct,
    };
  }, [data.customers, canViewCustomerAggregateTotals]);

  const handleConfirmDeleteCustomer = async () => {
    if (!deleteCustomerTarget) return;
    setIsDeletingCustomer(true);
    const res = await data.deleteCustomer(deleteCustomerTarget.id);
    setIsDeletingCustomer(false);
    if (res.success) {
      setFeedback({ type: 'success', text: `تم حذف العميل (${deleteCustomerTarget.shopName || deleteCustomerTarget.name}) بنجاح.` });
      if (selectedCustomerDetail?.id === deleteCustomerTarget.id) {
        setSelectedCustomerDetail(null);
      }
      setDeleteCustomerTarget(null);
    } else {
      setFeedback({ type: 'error', text: res.error || 'تعذر حذف العميل.' });
      setDeleteCustomerTarget(null);
    }
  };

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
    const dQty = Number(delivQty || 0);
    if (!delivProdId || dQty <= 0) {
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
      quantity: dQty,
      date: new Date().toISOString().split('T')[0],
      notes: delivNotes.trim() || 'تسليم عهدة جزئي لعميل من تطبيق المندوب',
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setDelivProdId('');
      setDelivQty('');
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
    const rQty = Number(retCustodyQty || 0);
    if (!retCustodyProdId || rQty <= 0) {
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
    if (rQty * factor > vanAvail) {
      setFeedback({
        type: 'error',
        text: `الكمية المطلوب إرجاعها (${rQty * factor} ${prod?.baseUnit || ''}) تتجاوز المتاح في عهدة السيارة (${vanAvail}).`,
      });
      return;
    }
    setIsSendingTransfer(true);
    setFeedback(null);
    const res = await data.recordRepCustodyReturn({
      representativeId: rep?.id,
      targetWarehouseId: retCustodyTargetWhId || mainWarehouse?.id,
      productId: retCustodyProdId,
      quantity: rQty,
      unit: chosenUnit,
      unitFactor: factor,
      date: new Date().toISOString().split('T')[0],
      notes: retCustodyNotes.trim() || 'إرجاع بضاعة من عهدة المندوب للمخزن الرئيسي',
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setRetCustodyProdId('');
      setRetCustodyUnit('');
      setRetCustodyQty('');
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
    const activeBranches = data.settings.extraSettings?.branches || [];
    const matchedBranch =
      (inv.warehouseId ? activeBranches.find((b) => b.warehouseId === inv.warehouseId) : undefined) ||
      activeBranches.find((b) => b.isDefault) ||
      activeBranches[0];
    const resolvedRep = inv.representativeId
      ? data.representatives.find((r) => r.id === inv.representativeId)
      : rep;

    exportHtmlToPdf({
      title: inv.type === 'quote' ? 'عرض سعر' : inv.type === 'purchase' ? 'فاتورة مشتريات' : inv.status === 'draft' ? 'مسودة فاتورة مبيعات' : 'فاتورة مبيعات',
      companyName: data.settings.companyName,
      companySubtitle: data.settings.companySubtitle,
      address: data.settings.address,
      phone1: data.settings.phone1,
      phone2: data.settings.phone2,
      branchName: matchedBranch?.name,
      branchNumber: matchedBranch?.branchNumber || data.settings.branchNumber,
      representativeName: inv.representativeName || resolvedRep?.name,
      representativePhone: resolvedRep?.phone,
      docNumber: inv.invoiceNumber,
      dateRangeText: inv.date,
      meta: [
        { label: inv.type === 'purchase' ? 'المورد' : 'العميل', value: inv.supplierName || inv.customerName || '-' },
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
      <div className="bg-white rounded-2xl border border-amber-200 p-5 text-center space-y-2.5 shadow-xs">
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
    iconNode: React.ReactNode;
    allowed: boolean;
    tone: string;
    badgeCount?: number;
  }> = [
    // Row 1
    {
      key: 'new-purchase',
      label: 'فاتورة شراء',
      iconNode: <PurchaseInvoiceIcon className="w-11 h-11" />,
      allowed: canCreatePurchase,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'sales-return',
      label: 'مرتجع بيع',
      iconNode: <SalesReturnIcon className="w-11 h-11" />,
      allowed: canSales,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'new-invoice',
      label: 'فاتورة بيع',
      iconNode: <SalesInvoiceIcon className="w-11 h-11" />,
      allowed: canSales,
      tone: 'bg-white text-blue-950 border-blue-200 ring-1 ring-blue-100 hover:border-blue-400',
    },
    // Row 2
    {
      key: 'cash-deposit',
      label: isRepRoleAccount ? 'تحصيل من عميل' : 'إيداع نقدي',
      iconNode: <ExpensesCashIcon className="w-11 h-11" />,
      allowed: isRepRoleAccount ? (canSales || canAccounts) : (canCashOps || canAccounts || canSales),
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'custody-transfer',
      label: 'تحويل عهدة',
      iconNode: <TransferArrowsIcon className="w-11 h-11" />,
      allowed: canTransfers,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'purchase-return',
      label: isRepRoleAccount ? 'طلب مرتجع شراء' : 'مرتجع شراء',
      iconNode: <PurchaseReturnIcon className="w-11 h-11" />,
      allowed: canCreatePurchase,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    // Row 3
    ...(!isRepRoleAccount
      ? [
          {
            key: 'cash-withdrawal' as RepTabKey,
            label: 'سحب نقدي',
            iconNode: <WalletCashIcon className="w-11 h-11" />,
            allowed: canCashOps,
            tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
          },
        ]
      : [
          {
            key: 'rep-reports' as RepTabKey,
            label: 'تقارير المندوب',
            iconNode: <FileSpreadsheet className="w-10 h-10 text-blue-900" />,
            allowed: true,
            tone: 'bg-white text-blue-950 border-blue-200 hover:border-blue-400',
          },
        ]),
    {
      key: 'new-customer',
      label: 'عميل جديد',
      iconNode: <CustomerAddIcon className="w-11 h-11" />,
      allowed: canAddCustomer,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'new-supplier',
      label: 'مورد جديد',
      iconNode: <SupplierAddIcon className="w-11 h-11" />,
      allowed: canCreatePurchase,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    // Row 4
    {
      key: 'refresh',
      label: 'تحديث ومزامنة',
      iconNode: <RefreshCloudIcon className="w-11 h-11" />,
      allowed: true,
      tone: 'bg-white text-slate-900 border-blue-200 hover:border-blue-400',
      badgeCount: data.pendingSyncCount,
    },
    ...(!isRepRoleAccount
      ? [
          {
            key: 'cheques-installments' as RepTabKey,
            label: 'شيك وقسط',
            iconNode: <ChequesIcon className="w-11 h-11" />,
            allowed: canAccounts,
            tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
          },
        ]
      : [
          {
            key: 'suppliers' as RepTabKey,
            label: 'الموردون وكشوفهم',
            iconNode: <Building2 className="w-10 h-10 text-[#003589]" />,
            allowed: canCreatePurchase,
            tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
          },
        ]),
    {
      key: 'new-quote',
      label: 'عرض سعر',
      iconNode: <PriceQuoteIcon className="w-11 h-11" />,
      allowed: canSales,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
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
          (t.createdByUserId
            ? t.createdByUserId === currentUser?.id
            : !currentUser || t.createdBy === currentUser.id)
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
    <div className="space-y-2">
      {/* Slim Sub-page Return Bar (Primary tabs are navigated via fixed bottom bar) */}
      {!['home', 'cash', 'more', 'customers', 'new-invoice'].includes(activeTab) && (
        <div className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={() => guardedTabChange('home')}
            className="h-8 px-2.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] font-black inline-flex items-center gap-1 cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>الرئيسية</span>
          </button>
          <span className="font-black text-slate-800 truncate">
            {activeTab === 'cash-deposit'
              ? 'تحصيل من العميل'
              : activeTab === 'cash-withdrawal'
              ? 'سحب / مصروف'
              : activeTab === 'custody-transfer'
              ? 'تحويل عهدة'
              : activeTab === 'new-purchase'
              ? 'فاتورة شراء'
              : activeTab === 'sales-return'
              ? 'مرتجع مبيعات'
              : activeTab === 'purchase-return'
              ? 'مرتجع مشتريات'
              : activeTab === 'new-customer'
              ? 'إضافة عميل'
              : activeTab === 'new-supplier'
              ? 'إضافة مورد'
              : activeTab === 'new-quote'
              ? 'عرض سعر'
              : activeTab === 'orders'
              ? 'الطلبات والتسليمات'
              : activeTab === 'invoices'
              ? 'فواتير المبيعات'
              : activeTab === 'purchases-list'
              ? 'فواتير الشراء'
              : activeTab === 'sales-returns-list'
              ? 'سجل مرتجع البيع'
              : activeTab === 'purchase-returns-list'
              ? 'سجل مرتجع الشراء'
              : activeTab === 'custody'
              ? 'مخزون وعهدة السيارة'
              : activeTab === 'suppliers'
              ? 'الموردون'
              : activeTab === 'rep-reports'
              ? 'تقارير المندوب'
              : activeTab === 'refresh'
              ? 'المزامنة السحابية'
              : activeTab === 'cheques-installments'
              ? 'الشيكات والأقساط'
              : ''}
          </span>
        </div>
      )}

      {feedback && (
        <div
          className={`p-2 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
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
        <div className="space-y-2">
          <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-slate-500">مرحباً، مندوب المبيعات</p>
                <h2 className="text-sm font-black text-slate-900 truncate">
                  {rep?.name || currentUser?.fullName}
                </h2>
                <p className="text-[11px] text-slate-500 truncate">
                  {vanWarehouse?.name || 'سيارة المندوب'} {rep?.vehicleNumber ? `· ${rep.vehicleNumber}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-left px-2.5 py-1 rounded-lg bg-[#EEF3FA] border border-[#DCE6F5]">
                <span className="text-[10px] text-[#003589] block font-bold">العهدة النقدية</span>
                <strong className="text-xs sm:text-sm font-black font-mono tabular-nums text-[#011E58]">
                  {(rep?.currentBalance || 0).toLocaleString()} {data.settings.currency}
                </strong>
              </div>
            </div>

            {(pendingCustodyDispatches.length > 0 ||
              pendingCashReceipts.length > 0 ||
              activeAssignedOrders.length > 0 ||
              draftsReadyToConfirm.length > 0 ||
              data.pendingSyncCount > 0) && (
              <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-black text-blue-950 text-[11px]">
                  <ClipboardCheck className="w-3.5 h-3.5 text-blue-800 shrink-0" />
                  <span>المهام اليومية المعلقة</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {pendingCustodyDispatches.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustodySubTab('items');
                        onTabChange('custody');
                      }}
                      className="px-2 py-1 rounded-md bg-cyan-50 border border-cyan-200 text-cyan-950 flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-cyan-100"
                    >
                      <span>عهد بضاعة مرسلة بانتظار تأكيد الاستلام ({pendingCustodyDispatches.length})</span>
                      <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  )}
                  {pendingCashReceipts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('cash')}
                      className="px-2 py-1 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-[#DCE6F5]"
                    >
                      <span>عهد نقدية واردة من الإدارة ({pendingCashReceipts.length})</span>
                      <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  )}
                  {activeAssignedOrders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('orders')}
                      className="px-2 py-1 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-[#DCE6F5]"
                    >
                      <span>طلبات توصيل جارية معينة لك ({activeAssignedOrders.length})</span>
                      <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  )}
                  {draftsReadyToConfirm.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('invoices')}
                      className="px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-950 flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-blue-100"
                    >
                      <span>مسودات فواتير جاهزة للاعتماد ({draftsReadyToConfirm.length})</span>
                      <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  )}
                  {data.pendingSyncCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('refresh')}
                      className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-950 flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-amber-100"
                    >
                      <span>عمليات محلية بانتظار الإرسال عبر REFRESH ({data.pendingSyncCount})</span>
                      <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Customers, Purchases, Suppliers & Reports Access Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => onTabChange('customers')}
              className="bg-white rounded-lg border border-slate-200 hover:border-blue-300 px-2 py-1.5 flex items-center gap-2 text-right cursor-pointer"
            >
              <CustomersGroupIcon className="w-7 h-7 shrink-0" />
              <div className="min-w-0">
                <span className="block text-[11px] font-black text-slate-900 truncate">العملاء والحسابات</span>
                <span className="block text-[10px] text-slate-500 font-semibold truncate">
                  {data.customers.length} عميل · متابعة وكشوف
                </span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onTabChange('rep-reports')}
              className="bg-white rounded-lg border border-blue-200 hover:border-blue-400 px-2 py-1.5 flex items-center gap-2 text-right cursor-pointer"
            >
              <FileSpreadsheet className="w-7 h-7 text-blue-900 shrink-0" />
              <div className="min-w-0">
                <span className="block text-[11px] font-black text-blue-950 truncate">تقارير المندوب</span>
                <span className="block text-[10px] text-slate-500 font-semibold truncate">
                  المبيعات والتحصيلات
                </span>
              </div>
            </button>
            {canCreatePurchase && (
              <>
                <button
                  type="button"
                  onClick={() => onTabChange('purchases-list')}
                  className="bg-white rounded-lg border border-slate-200 hover:border-blue-300 px-2 py-1.5 flex items-center gap-2 text-right cursor-pointer"
                >
                  <PurchaseInvoiceIcon className="w-7 h-7 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-[11px] font-black text-slate-900 truncate">فواتير الشراء</span>
                    <span className="block text-[10px] text-slate-500 font-semibold truncate">
                      {myPurchases.length} فاتورة · سداد
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onTabChange('suppliers')}
                  className="bg-white rounded-lg border border-slate-200 hover:border-[#0053BE] px-2 py-1.5 flex items-center gap-2 text-right cursor-pointer"
                >
                  <Building2 className="w-7 h-7 text-[#003589] shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-[11px] font-black text-slate-900 truncate">الموردون وكشوفهم</span>
                    <span className="block text-[10px] text-slate-500 font-semibold truncate">
                      {data.suppliers.length} مورد · كشف الحساب
                    </span>
                  </div>
                </button>
              </>
            )}
          </div>

          {/* 4x3 Operation Tile Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {homeTiles.map((tile) => {
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
                  className={`relative min-h-[68px] p-2 rounded-lg border flex flex-col items-center justify-center gap-1 text-center transition-all active:scale-97 cursor-pointer ${
                    tile.allowed
                      ? tile.tone
                      : 'bg-slate-100 text-slate-400 border-slate-200 opacity-70'
                  }`}
                >
                  {!tile.allowed && (
                    <Lock className="w-3.5 h-3.5 absolute top-1.5 left-1.5 text-slate-400" />
                  )}
                  {tile.badgeCount && tile.badgeCount > 0 ? (
                    <span className="absolute top-1.5 left-1.5 min-w-[18px] h-[18px] px-1 rounded bg-amber-500 text-slate-950 text-[10px] font-black font-mono tabular-nums flex items-center justify-center">
                      {tile.badgeCount}
                    </span>
                  ) : null}
                  <div className="flex items-center justify-center">{tile.iconNode}</div>
                  <span className="text-[11px] font-black leading-tight">{tile.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== TAB 2: CASH (النقدية) ==================== */}
      {activeTab === 'cash' && (
        <div className="space-y-2 text-xs">
          <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-[#003589]" />
                <span>إدارة النقدية والعهدة المالية</span>
              </h3>
              <div className="px-2 py-0.5 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] flex items-center gap-1.5">
                <span className="text-[10px] text-[#003589] font-bold">رصيد العهدة:</span>
                <strong className="text-xs font-black font-mono tabular-nums text-[#011E58]">
                  {(rep?.currentBalance || 0).toLocaleString()} {data.settings.currency}
                </strong>
              </div>
            </div>

            <div className={`grid gap-1.5 ${isRepRoleAccount ? 'grid-cols-2' : 'grid-cols-3'}`}>
              <button
                type="button"
                disabled={!(canCashOps || canSales)}
                onClick={() => {
                  setDepMode('customer_collection');
                  onTabChange('cash-deposit');
                }}
                className="h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-45"
              >
                {isRepRoleAccount ? 'تحصيل من عميل' : 'إيداع نقدي'}
              </button>
              {!isRepRoleAccount && (
                <button
                  type="button"
                  disabled={!canCashOps}
                  onClick={() => onTabChange('cash-withdrawal')}
                  className="h-8 rounded-md bg-amber-600 text-white font-black cursor-pointer disabled:opacity-45"
                >
                  سحب نقدي
                </button>
              )}
              <button
                type="button"
                disabled={!canTransfers}
                onClick={() => {
                  setCustodySubTab('cash');
                  onTabChange('custody-transfer');
                }}
                className="h-8 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-black cursor-pointer disabled:opacity-45"
              >
                توريد عهدة للفرع
              </button>
            </div>
          </div>

          {/* Cash Drawer Reconciliation Card */}
          <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
            <h4 className="font-black text-slate-900 flex items-center gap-1.5">
              <Calculator className="w-4 h-4 text-blue-900" />
              <span>تقفيل ومطابقة الدرج النقدي اليوم ({todayStr})</span>
            </h4>
            <div className="grid grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden text-center tabular-nums">
              <div className="px-2 py-1.5 bg-blue-50/70">
                <span className="text-[10px] text-blue-800 block">مبيعات اليوم المحصلة</span>
                <strong className="font-mono text-xs text-blue-950">
                  {cashDrawerSummary.todayRepSalesCash.toLocaleString()}
                </strong>
              </div>
              <div className="px-2 py-1.5 bg-emerald-50/70">
                <span className="text-[10px] text-emerald-800 block">تحصيلات / إيداعات</span>
                <strong className="font-mono text-xs text-emerald-900">
                  {cashDrawerSummary.todayCashCollections.toLocaleString()}
                </strong>
              </div>
              <div className="px-2 py-1.5 bg-amber-50/70">
                <span className="text-[10px] text-amber-800 block">توريدات للفرع اليوم</span>
                <strong className="font-mono text-xs text-amber-900">
                  {cashDrawerSummary.todayRepRemittances.toLocaleString()}
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                  الجرد الفعلي للنقدية بالدرج ({data.settings.currency}):
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={actualDrawerCash}
                  onChange={(e) => setActualDrawerCash(e.target.value)}
                  placeholder="أدخل النقدية المعدودة فعلياً..."
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-bold text-center"
                />
              </div>
              <div
                className={`h-8 px-2.5 rounded-md border flex items-center justify-between font-bold tabular-nums ${
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

          <UnifiedDataTable
            compact
            paginated={false}
            searchable={false}
            title={`حركة التحويلات النقدية للمندوب (${myCashTransfers.length})`}
            data={myCashTransfers}
            rowKey={(t) => t.id}
            emptyTitle="لا توجد تحويلات نقدية مسجلة حالياً"
            emptySubtitle="ستظهر هنا التوريدات والعهد النقدية المرتبطة بك"
            columns={[
              {
                key: 'transferNumber',
                header: 'رقم التحويل',
                render: (t) => <span className="font-mono font-black text-blue-950">{t.transferNumber}</span>,
              },
              {
                key: 'direction',
                header: 'النوع',
                render: (t) => (t.direction === 'rep_to_owner' ? 'توريد إلى الفرع' : 'عهدة واردة من الإدارة'),
              },
              {
                key: 'amount',
                header: 'المبلغ',
                align: 'center',
                sortValue: (t) => Number(t.amount || 0),
                render: (t) => (
                  <strong className="font-mono text-slate-900 tabular-nums">
                    {t.amount.toLocaleString()} {data.settings.currency}
                  </strong>
                ),
              },
              {
                key: 'status',
                header: 'الحالة',
                align: 'center',
                render: (t) => (
                  <span
                    className={`font-bold ${
                      t.status === 'received'
                        ? 'text-emerald-700'
                        : t.status === 'awaiting_receipt'
                        ? 'text-amber-700'
                        : 'text-red-700'
                    }`}
                  >
                    {t.status === 'received'
                      ? 'تم الاستلام والتسوية'
                      : t.status === 'awaiting_receipt'
                      ? 'بانتظار تأكيد الاستلام'
                      : 'مرفوض'}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: 'الإجراءات',
                align: 'center',
                sortable: false,
                render: (t) =>
                  t.status === 'awaiting_receipt' && t.direction === 'owner_to_rep' ? (
                    <button
                      type="button"
                      onClick={() => handleConfirmOwnerCash(t.id)}
                      className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black cursor-pointer whitespace-nowrap"
                    >
                      تأكيد استلام العهدة النقدية
                    </button>
                  ) : (
                    <span className="text-slate-400">—</span>
                  ),
              },
            ]}
          />
        </div>
      )}

      {/* ==================== TAB 3: MORE (المزيد) ==================== */}
      {activeTab === 'more' && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100 text-xs">
          {[
            { key: 'rep-reports' as RepTabKey, label: 'تقارير المندوب الشاملة', Icon: FileSpreadsheet, allowed: true },
            { key: 'purchases-list' as RepTabKey, label: 'فواتير الشراء', Icon: PurchaseInvoicesListIcon, allowed: canCreatePurchase },
            { key: 'suppliers' as RepTabKey, label: 'الموردون وكشف الحساب', Icon: Building2, allowed: canCreatePurchase },
            { key: 'sales-returns-list' as RepTabKey, label: 'مرتجع البيع', Icon: SalesReturnIcon, allowed: canSales },
            { key: 'invoices' as RepTabKey, label: 'فواتير البيع', Icon: SalesInvoicesListIcon, allowed: canSales },
            { key: 'customers' as RepTabKey, label: 'الحسابات والعملاء', Icon: CustomersGroupIcon, allowed: canAccounts || canSales },
            { key: 'custody' as RepTabKey, label: 'المخزن والعهدة', Icon: WarehouseBoxesIcon, allowed: canInventory },
            { key: 'purchase-returns-list' as RepTabKey, label: isRepRoleAccount ? 'طلبات ومرتجعات الشراء' : 'مرتجع الشراء', Icon: PurchaseReturnIcon, allowed: canCreatePurchase },
            { key: 'orders' as RepTabKey, label: 'الطلبات والتسليمات', Icon: OrdersClipboardIcon, allowed: canSales },
            { key: 'new-quote' as RepTabKey, label: 'عروض الأسعار', Icon: PriceQuoteIcon, allowed: canSales },
            { key: 'refresh' as RepTabKey, label: 'REFRESH · الإرسال والاستلام', Icon: RefreshCloudIcon, allowed: true },
          ].map((item) => {
            const ItemIcon = item.Icon;
            return (
              <button
                key={item.key}
                type="button"
                disabled={!item.allowed}
                onClick={() => onTabChange(item.key)}
                className="w-full min-h-[36px] px-2.5 py-1.5 flex items-center justify-between gap-2 text-right font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <ItemIcon className="w-4 h-4 shrink-0" />
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
              className="w-full min-h-[36px] px-2.5 py-1.5 flex items-center justify-between gap-2 text-right font-bold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <SettingsTwinGearsIcon className="w-4 h-4 shrink-0" />
                <span>الإعدادات والربط المركزي</span>
              </div>
              <ChevronLeft className="w-4 h-4 text-slate-400" />
            </button>
          )}

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="w-full min-h-[36px] px-2.5 py-1.5 flex items-center justify-between gap-2 text-right font-black text-red-700 hover:bg-red-50 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <LogoutDoorIcon className="w-5 h-5 shrink-0" />
                <span>تسجيل الخروج</span>
              </div>
              <ChevronLeft className="w-4 h-4 text-red-400" />
            </button>
          )}
        </div>
      )}

      {/* ==================== REFRESH SCREEN ==================== */}
      {activeTab === 'refresh' && <RefreshSyncScreen onBack={() => onTabChange('home')} />}

      {/* ==================== ALLOWED CUSTOMERS LIST (Compact Actions, Collapsible KPI Strip & Table) ==================== */}
      {activeTab === 'customers' && (
        <div className="space-y-2">
          {/* Header Action Bar */}
          <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <CustomersGroupIcon className="w-6 h-6 shrink-0" />
                <div>
                  <h3 className="text-xs sm:text-sm font-black text-slate-900">العملاء والمحلات والحسابات</h3>
                  <p className="text-[10px] text-slate-500">عرض المحلات، المبالغ المتبقية وكشف الحساب التفصيلي</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {canViewCustomerAggregateTotals && (
                  <button
                    type="button"
                    onClick={() => setShowCustomerStats((p) => !p)}
                    className="h-8 px-2.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>المؤشرات ({repCustomersStats.total})</span>
                    {showCustomerStats ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                )}
                {canAddCustomer && (
                  <button
                    type="button"
                    onClick={() => onTabChange('new-customer')}
                    className="h-8 px-2.5 rounded-md bg-blue-900 hover:bg-blue-950 text-white font-black inline-flex items-center gap-1 cursor-pointer"
                  >
                    <CustomerAddIcon className="w-4 h-4 shrink-0" />
                    <span>عميل جديد</span>
                  </button>
                )}
                {canDeleteCustomer && (
                  <button
                    type="button"
                    onClick={() => {
                      setSafeDeleteSearch('');
                      setSafeDeleteModalOpen(true);
                    }}
                    className="h-8 px-2.5 rounded-md bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>حذف آمن</span>
                  </button>
                )}
              </div>
            </div>

            {canViewCustomerAggregateTotals ? (
              showCustomerStats && (
                <div className="grid grid-cols-3 lg:grid-cols-6 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden text-xs tabular-nums">
                  <div className="px-2 py-1.5 bg-slate-50">
                    <span className="text-[10px] text-slate-500 block">إجمالي العملاء</span>
                    <strong className="text-sm font-black text-slate-900">{repCustomersStats.total}</strong>
                    <span className="block text-[10px] text-slate-500">المطابق: {filteredCustomers.length}</span>
                  </div>
                  <div className="px-2 py-1.5 bg-amber-50/70">
                    <span className="text-[10px] text-amber-800 block">عملاء مدينون</span>
                    <strong className="text-sm font-black text-amber-900">{repCustomersStats.debtorsCount}</strong>
                    <span className="block text-[10px] text-amber-700">أرصدة مستحقة</span>
                  </div>
                  <div className="px-2 py-1.5 bg-[#EEF3FA]">
                    <span className="text-[10px] text-[#003589] block font-bold">أرصدة دائنة</span>
                    <strong className="text-sm font-black text-[#011E58]">{repCustomersStats.creditsCount}</strong>
                    <span className="block text-[10px] text-[#626D80]">دافعي مقدمات</span>
                  </div>
                  <div className="px-2 py-1.5 bg-rose-50/70">
                    <span className="text-[10px] text-rose-700 block">المستحق (لنا)</span>
                    <strong className="text-xs font-black font-mono text-rose-800">
                      {repCustomersStats.totalDue.toLocaleString()} {data.settings.currency}
                    </strong>
                    <span className="block text-[10px] text-rose-700 font-bold">مديونيات</span>
                  </div>
                  <div className="px-2 py-1.5 bg-emerald-50/70">
                    <span className="text-[10px] text-emerald-700 block">الدائن (علينا)</span>
                    <strong className="text-xs font-black font-mono text-emerald-800">
                      {repCustomersStats.totalCredit.toLocaleString()} {data.settings.currency}
                    </strong>
                    <span className="block text-[10px] text-emerald-700 font-bold">مقدمات مالية</span>
                  </div>
                  <div className="px-2 py-1.5 bg-blue-50/70">
                    <span className="text-[10px] text-blue-800 block">نسبة المدينين</span>
                    <strong className="text-sm font-black font-mono text-blue-950">{repCustomersStats.debtorPct}%</strong>
                    <span className="block text-[10px] text-blue-700">من الإجمالي</span>
                  </div>
                </div>
              )
            ) : (
              <div className="px-2 py-1 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-[11px] font-bold text-slate-700">
                <span>عدد العملاء: <strong className="font-mono text-slate-900">{repCustomersStats.total}</strong> (المطابق: {filteredCustomers.length})</span>
                <span className="text-slate-500">تظهر مديونية كل عميل داخل بطاقته.</span>
              </div>
            )}

            {/* Search, Filter Chips & Sort */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 items-center">
              <div className="relative sm:col-span-5">
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="ابحث بالاسم أو المحل أو الكود أو الهاتف..."
                  className="w-full h-8 rounded-md border border-slate-300 pr-7 pl-2 text-xs font-semibold outline-hidden focus:border-blue-600"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2" />
              </div>
              <select
                value={customerSortMode}
                onChange={(e) => setCustomerSortMode(e.target.value as any)}
                className="sm:col-span-3 h-8 rounded-md border border-slate-300 px-2 text-xs font-bold bg-white"
              >
                <option value="debt_desc">ترتيب: الأعلى مديونية</option>
                <option value="credit_desc">ترتيب: الأعلى رصيداً دائناً</option>
                <option value="name">ترتيب: أبجدياً</option>
              </select>
              <div className="sm:col-span-4 flex flex-wrap gap-1 text-[11px] font-bold">
                {[
                  { id: 'all', label: `الكل (${repCustomersStats.total})` },
                  { id: 'current', label: 'الحاليين' },
                  {
                    id: 'debtors',
                    label: canViewCustomerAggregateTotals
                      ? `متبقي (${repCustomersStats.debtorsCount})`
                      : 'عليهم رصيد',
                  },
                  {
                    id: 'credits',
                    label: canViewCustomerAggregateTotals
                      ? `دائنة (${repCustomersStats.creditsCount})`
                      : 'دائنة',
                  },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCustomerFilterMode(tab.id as any)}
                    className={`h-8 px-2 rounded-md border transition-colors cursor-pointer ${
                      customerFilterMode === tab.id
                        ? 'bg-blue-900 text-white border-blue-900 font-black'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <UnifiedDataTable<Customer>
            compact
            searchable={false}
            defaultPageSize={25}
            title={`جدول العملاء والمحلات (${filteredCustomers.length})`}
            data={filteredCustomers}
            rowKey={(c) => c.id}
            emptyTitle="لا يوجد عملاء مطابقون لمعايير البحث أو التصفية الحالية"
            emptySubtitle="جرّب تغيير البحث أو نوع التصفية من الأعلى"
            columns={[
              {
                key: 'shopName',
                header: 'المحل / العميل',
                sortValue: (c) => c.shopName || c.name,
                render: (c) => (
                  <div className="flex items-center gap-2 min-w-[160px]">
                    {(c.shopPhoto || c.photo) ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewShopPhoto(c.shopPhoto || c.photo || null);
                        }}
                        className="shrink-0 cursor-pointer"
                        title="عرض صورة المحل"
                      >
                        <img
                          src={c.shopPhoto || c.photo}
                          alt={c.shopName || c.name}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200 bg-slate-50"
                        />
                      </button>
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-800 shrink-0">
                        <Store className="w-4 h-4" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedCustomerDetail(c)}
                      className="text-right min-w-0 cursor-pointer"
                    >
                      <span className="font-black text-slate-900 flex items-center gap-1">
                        <span className="truncate max-w-[160px]">{c.shopName || c.name}</span>
                        <Eye className="w-3 h-3 text-blue-700 shrink-0" />
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        {c.name} · <span className="font-mono">{c.code}</span>
                      </span>
                    </button>
                  </div>
                ),
              },
              {
                key: 'area',
                header: 'المنطقة',
                sortValue: (c) => `${c.governorate || ''} ${c.area || ''}`,
                render: (c) => (
                  <span className="text-[11px] text-slate-600">
                    {[c.governorate, c.area].filter(Boolean).join(' · ') || c.address || '—'}
                  </span>
                ),
              },
              {
                key: 'phone',
                header: 'الهاتف والموقع',
                render: (c) => {
                  const cleanedPhone = String(c.phone || '').replace(/[^\d+]/g, '');
                  const hasValidPhone = cleanedPhone.replace(/\D/g, '').length >= 7;
                  const mapRaw = (c.geoCoordinates || c.address || '').trim();
                  const hasValidMap = Boolean(mapRaw && mapRaw !== '-');
                  return (
                    <div className="flex flex-wrap items-center gap-1">
                      {hasValidPhone ? (
                        <a
                          href={`tel:${cleanedPhone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="px-2 py-0.5 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] font-mono font-bold inline-flex items-center gap-1 text-[11px]"
                        >
                          <Phone className="w-3 h-3 text-[#003589]" />
                          <span>{c.phone}</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setFeedback({ type: 'warning', text: `رقم هاتف العميل (${c.name}) غير مكتمل أو غير صالح للاتصال.` })
                          }
                          className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200 font-bold inline-flex items-center gap-1 text-[11px] cursor-pointer"
                        >
                          <Phone className="w-3 h-3" />
                          <span>{c.phone || 'بدون هاتف'}</span>
                        </button>
                      )}
                      {hasValidMap && (
                        <button
                          type="button"
                          onClick={() =>
                            setLocationViewerData({
                              customerName: c.name,
                              shopName: c.shopName,
                              address: c.address,
                              city: c.city,
                              area: c.area,
                              governorate: c.governorate,
                              geoCoordinates: c.geoCoordinates,
                              latitude: c.latitude,
                              longitude: c.longitude,
                            })
                          }
                          className="px-2 py-0.5 rounded-md bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5] font-bold inline-flex items-center gap-1 text-[11px] cursor-pointer"
                        >
                          <MapPin className="w-3 h-3 text-[#003589]" />
                          <span>الموقع</span>
                        </button>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'currentBalance',
                header: 'الرصيد الحالي',
                align: 'center',
                sortValue: (c) => Number(c.currentBalance || 0),
                render: (c) => (
                  <div className="whitespace-nowrap">
                    <strong
                      className={`font-mono text-xs tabular-nums block ${
                        c.currentBalance > 0.009
                          ? 'text-red-700'
                          : c.currentBalance < -0.009
                          ? 'text-emerald-700'
                          : 'text-slate-700'
                      }`}
                    >
                      {Math.abs(c.currentBalance).toLocaleString()} {data.settings.currency}
                    </strong>
                    <span className="text-[10px] text-slate-500">
                      {c.currentBalance > 0.009 ? 'لنا' : c.currentBalance < -0.009 ? 'علينا' : 'متوازن'}
                    </span>
                  </div>
                ),
              },
              {
                key: 'actions',
                header: 'الإجراءات',
                align: 'center',
                sortable: false,
                render: (c) => (
                  <div className="flex flex-wrap items-center justify-center gap-1 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomerDetail(c);
                        setCustomerDetailSubTab('statement');
                      }}
                      className="px-2 py-0.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] font-bold inline-flex items-center gap-1 text-[11px] cursor-pointer"
                    >
                      <FileText className="w-3 h-3" />
                      <span>كشف</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDepMode('customer_collection');
                        setDepCustomerId(c.id);
                        setDepInvoiceId('');
                        setDepAmount('');
                        onTabChange('cash-deposit');
                      }}
                      className="px-2 py-0.5 rounded-md bg-[#0049B0] hover:bg-[#003589] text-white font-bold inline-flex items-center gap-1 text-[11px] cursor-pointer"
                    >
                      <Wallet className="w-3 h-3" />
                      <span>تحصيل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInvCustomerId(c.id);
                        onTabChange('new-invoice');
                      }}
                      className="px-2 py-0.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-bold text-[11px] cursor-pointer"
                    >
                      فاتورة
                    </button>
                    {canEditCustomer && (
                      <button
                        type="button"
                        onClick={() => openEditCustomerSheet(c)}
                        className="px-1.5 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-bold cursor-pointer"
                        title="تعديل بيانات العميل"
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                    )}
                    {canDeleteCustomer && (
                      <button
                        type="button"
                        onClick={() => setDeleteCustomerTarget(c)}
                        className="px-1.5 py-0.5 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold cursor-pointer"
                        title="حذف العميل"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* ==================== NEW SALES INVOICE (with Van Custody Guard) ==================== */}
      {activeTab === 'new-invoice' && (
        <div className="space-y-2">
          <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2 text-xs">
            <h3 className="text-xs sm:text-sm font-black text-slate-900">إنشاء فاتورة مبيعات (مقيد بمخزون عهدة السيارة)</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <div>
                <SearchableFilterSelect
                  id="rep-sale-customer"
                  label="العميل"
                  value={invCustomerId}
                  onChange={setInvCustomerId}
                  options={data.customers.map((c) => ({
                    value: c.id,
                    label: c.shopName ? `${c.shopName} (${c.name})` : c.name,
                    subtitle: c.phone || c.address,
                    badge: `رصيد: ${c.currentBalance}`,
                    searchText: `${c.name} ${c.shopName || ''} ${c.phone || ''} ${c.code || ''}`,
                  }))}
                  allOptionLabel="-- اختر العميل --"
                  allOptionValue=""
                  searchPlaceholder="ابحث باسم العميل أو المحل أو الهاتف..."
                  allowClear
                  buttonClassName="h-8 rounded-md"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">مستودع الصرف (السيارة):</label>
                <select
                  value={effectiveVanId}
                  onChange={(e) => setInvWarehouseId(e.target.value)}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                >
                  {data.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-2 rounded-md bg-blue-50/60 border border-blue-200 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <label className="font-bold text-slate-800">بحث / باركود وإضافة صنف ({filteredInvoiceProducts.length}):</label>
                <button
                  type="button"
                  onClick={() => setInvOnlyVanStock((prev) => !prev)}
                  className={`h-7 px-2 rounded-md border text-[11px] font-bold cursor-pointer ${
                    invOnlyVanStock
                      ? 'bg-[#003589] text-white border-[#011E58]'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  {invOnlyVanStock ? 'المتاح بالسيارة فقط ✓' : 'تصفية: المتاح بالسيارة'}
                </button>
              </div>

              <ProductSearchSelect
                products={filteredInvoiceProducts}
                selectedProductId={invProductId}
                warehouseId={effectiveVanId}
                warehouses={data.warehouses}
                priceMode="selling"
                currency={data.settings.currency}
                placeholder="ابحث بالاسم أو الكود أو امسح الباركود..."
                onSelect={(prod) => handleSelectProduct(prod.id)}
              />

              {selectedProduct && invCustomerId && (
                <div className="p-2 rounded-md bg-white border border-blue-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-blue-950 text-[11px]">
                    <History className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      آخر 3 أسعار بيع فعلية لهذا العميل ({selectedInvoiceCustomer?.shopName || selectedInvoiceCustomer?.name || ''}) للصنف ({selectedProduct.name}) — من الأقدم للأحدث:
                    </span>
                  </div>
                  {selectedProdLastPrices.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedProdLastPrices.map((entry, idx) => {
                        const priceVal = Number(entry.price || 0);
                        const priceDate = entry.date || '';
                        const entryUnit = entry.unit || '';
                        const entryQty = entry.quantity;
                        const entryFactor = Number(entry.unitFactor || 1);
                        const orderTag = idx === 0 ? 'الأقدم' : idx === selectedProdLastPrices.length - 1 ? 'الأحدث' : 'الوسيط';
                        const activeUnitFactor =
                          invUnitName === selectedProduct.baseUnit
                            ? 1
                            : selectedProduct.units.find((u) => u.name === invUnitName)?.conversionFactor || 1;
                        const normalizedPerSelectedUnit =
                          entryUnit && entryUnit !== invUnitName && entryFactor > 0
                            ? Math.round((priceVal / entryFactor) * activeUnitFactor * 100) / 100
                            : null;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setInvPrice(normalizedPerSelectedUnit ?? priceVal)}
                            title="انقر لتطبيق هذا السعر يدوياً"
                            className="px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-950 text-right cursor-pointer"
                          >
                            <span className="font-mono font-bold text-[11px] block">
                              {priceVal} {data.settings.currency}
                              {entryUnit ? ` / ${entryUnit}` : ''}
                            </span>
                            <span className="text-[10px] text-slate-600 block">
                              {orderTag}
                              {priceDate ? ` · ${priceDate}` : ''}
                              {typeof entryQty === 'number' && entryQty > 0 ? ` · كمية: ${entryQty}` : ''}
                              {normalizedPerSelectedUnit !== null ? ` · يعادل ${normalizedPerSelectedUnit} للـ${invUnitName}` : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic">لا توجد أسعار بيع سابقة لهذا الصنف مع هذا العميل</p>
                  )}
                </div>
              )}

              {selectedProduct && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">الوحدة</label>
                    <select
                      value={invUnitName}
                      onChange={(e) => handleUnitChange(e.target.value)}
                      className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
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
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">الكمية</label>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={invQty}
                      onChange={setInvQty}
                      ariaLabel="كمية الصنف"
                      inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">السعر</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      value={invPrice}
                      onChange={(e) => setInvPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      placeholder="0.00"
                      className="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">خصم البند</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      value={invLineDiscount}
                      onChange={(e) => setInvLineDiscount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      placeholder="0"
                      className="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                </div>
              )}

              {selectedProduct && (
                <button
                  type="button"
                  onClick={handleAddInvoiceItem}
                  className="w-full h-8 rounded-md bg-blue-900 text-white font-black flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة الصنف للفاتورة</span>
                </button>
              )}
            </div>

            {invItems.length > 0 && (
              <UnifiedDataTable
                compact
                paginated={false}
                searchable={false}
                title={`أصناف الفاتورة (${invItems.length})`}
                data={invItems}
                rowKey={(it, idx) => `${it.productId}-${it.unit}-${idx}`}
                columns={[
                  {
                    key: 'productName',
                    header: 'الصنف',
                    render: (it) => (
                      <div>
                        <span className="font-bold text-slate-900 block">{it.productName}</span>
                        <span className="text-[10px] text-slate-500">
                          {it.unit} · سعر {it.unitPrice.toLocaleString()}
                          {it.discount > 0 ? ` · خصم ${it.discount.toLocaleString()}` : ''}
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: 'quantity',
                    header: 'الكمية',
                    align: 'center',
                    render: (it, idx) => (
                      <div className="inline-flex justify-center">
                        <QuantityInput
                          showSteppers
                          allowDecimals
                          min={0.001}
                          value={it.quantity}
                          onChange={(q) => handleUpdateInvItemQty(idx, q)}
                          onRemoveWhenZero={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                          ariaLabel={`كمية ${it.productName}`}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'total',
                    header: 'الإجمالي',
                    align: 'center',
                    render: (it) => (
                      <strong className="font-mono text-blue-950 tabular-nums">
                        {it.total.toLocaleString()} {data.settings.currency}
                      </strong>
                    ),
                  },
                  {
                    key: 'actions',
                    header: 'حذف',
                    align: 'center',
                    sortable: false,
                    render: (_it, idx) => (
                      <button
                        type="button"
                        onClick={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="h-7 w-7 rounded-md hover:bg-red-50 inline-flex items-center justify-center text-red-600 cursor-pointer"
                        aria-label="حذف الصنف"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ),
                  },
                ]}
              />
            )}

            {shortageItems.length > 0 && (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-300 space-y-1 text-xs text-amber-950">
                <div className="flex items-center gap-1.5 font-black">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>عجز في مخزون سيارتك لعدد ({shortageItems.length}) أصناف — لا يمكن الاعتماد المباشر</span>
                </div>
                <div className="space-y-0.5 text-[11px]">
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
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { key: 'cash' as const, label: 'نقدي' },
                    { key: 'credit' as const, label: 'آجل' },
                    { key: 'partial' as const, label: 'جزئي' },
                  ].map((pt) => (
                    <button
                      key={pt.key}
                      type="button"
                      onClick={() => setInvPaymentType(pt.key)}
                      className={`h-8 rounded-md border font-bold cursor-pointer ${
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
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">المدفوع نقداً الآن</label>
                    <input
                      type="number"
                      min={0}
                      max={invGrandTotal}
                      value={invPaidAmount}
                      onChange={(e) => setInvPaidAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      placeholder="0.00"
                      className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
                    />
                  </div>
                )}

                {!isRepRoleAccount && canCashOps && invPaymentType !== 'credit' && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">الخزينة</label>
                    <select
                      value={invCashboxId}
                      onChange={(e) => setInvCashboxId(e.target.value)}
                      className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
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
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />

                <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-1 tabular-nums">
                  <div className="flex items-center justify-between font-black text-xs sm:text-sm text-blue-950">
                    <span>إجمالي الفاتورة:</span>
                    <span className="font-mono">
                      {invGrandTotal.toLocaleString()} {data.settings.currency}
                    </span>
                  </div>
                  {selectedInvoiceCustomer && (
                    <div className="pt-1 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-1 text-[11px] text-slate-700">
                      <div>
                        قبل الفاتورة:{' '}
                        <strong className="font-mono">
                          {selectedInvoiceCustomer.currentBalance.toLocaleString()}
                        </strong>
                      </div>
                      <div>
                        المدفوع:{' '}
                        <strong className="font-mono text-emerald-700">
                          {effectiveInvPaid.toLocaleString()}
                        </strong>
                      </div>
                      <div>
                        المتبقي:{' '}
                        <strong className="font-mono text-amber-800">
                          {Math.max(0, invGrandTotal - effectiveInvPaid).toLocaleString()}
                        </strong>
                      </div>
                      <div>
                        بعد الفاتورة:{' '}
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
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft_with_transfer')}
                      className="w-full h-9 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black cursor-pointer disabled:opacity-50"
                    >
                      {isSubmittingInvoice ? 'جاري الحفظ...' : 'حفظ كمسودة وإرسال طلب تحويل للعجز'}
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft')}
                      className="w-full h-8 rounded-md bg-slate-200 text-slate-800 font-bold cursor-pointer"
                    >
                      حفظ كمسودة فقط
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft')}
                      className="h-9 rounded-lg bg-slate-200 text-slate-800 font-bold cursor-pointer"
                    >
                      حفظ كمسودة
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('confirmed')}
                      className="h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
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
        <form onSubmit={handleOpenPurchaseReview} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900">
                {purEditingInvoiceId ? 'تعديل فاتورة مشتريات قبل الإرسال' : 'إنشاء فاتورة مشتريات جديدة'}
              </h3>
              <p className="text-[10px] text-slate-500">
                لا يتم تعديل المخزن أو حسابات المورد حتى استلام الإدارة واعتمادها للفاتورة
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {purEditingInvoiceId && (
                <button
                  type="button"
                  onClick={() => {
                    setPurEditingInvoiceId(null);
                    setPurItems([]);
                    setPurDiscount(0);
                    setPurNotes('');
                    onTabChange('purchases-list');
                  }}
                  className="h-8 px-2.5 rounded-md bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  إلغاء التعديل
                </button>
              )}
              <button
                type="button"
                onClick={() => onTabChange('new-supplier')}
                className="h-8 px-2.5 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] font-bold cursor-pointer"
              >
                + مورد جديد
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">المورد:</label>
              <SearchableFilterSelect
                id="rep-purchase-supplier"
                value={purSupplierId}
                onChange={setPurSupplierId}
                options={data.suppliers.map((s) => ({
                  value: s.id,
                  label: s.name,
                  subtitle: s.phone || s.companyName,
                  searchText: `${s.name} ${s.phone || ''} ${s.companyName || ''}`,
                }))}
                allOptionLabel="-- اختر المورد --"
                allOptionValue=""
                searchPlaceholder="ابحث باسم المورد أو الهاتف..."
                allowClear
                buttonClassName="h-8 rounded-md"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">مخزن الاستلام:</label>
              <select
                value={purWarehouseId}
                onChange={(e) => setPurWarehouseId(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
              >
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="font-black text-[#011E58]">إضافة أصناف لفاتورة الشراء:</span>
              <button
                type="button"
                onClick={() => {
                  setShowPurInlineNewProduct((prev) => !prev);
                  setFeedback(null);
                }}
                className={`h-7 inline-flex items-center gap-1 px-2 rounded-md text-[11px] font-bold border transition-colors cursor-pointer ${
                  showPurInlineNewProduct
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-[#011E58] border-[#DCE6F5] hover:bg-[#DCE6F5]/60'
                }`}
              >
                <PackagePlus className="w-3.5 h-3.5 shrink-0" />
                <span>{showPurInlineNewProduct ? 'إغلاق إنشاء الصنف الجديد' : 'إنشاء صنف جديد داخل الفاتورة'}</span>
              </button>
            </div>

            {!showPurInlineNewProduct ? (
              <>
                <ProductSearchSelect
                  products={activeProducts}
                  selectedProductId={purProductId}
                  warehouseId={purWarehouseId || mainWarehouse?.id}
                  warehouses={data.warehouses}
                  priceMode="purchase"
                  currency={data.settings.currency}
                  placeholder="ابحث باسم الصنف أو الكود أو الباركود..."
                  onSelect={(prod) => handleSelectPurProduct(prod.id)}
                />
                {purProductId && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      value={purUnitName}
                      onChange={(e) => handleSelectPurUnit(e.target.value)}
                      className="h-8 rounded-md border border-slate-300 px-2 text-center font-bold bg-white"
                      aria-label="وحدة الشراء"
                    >
                      {purUnitOptions.map((u) => (
                        <option key={u.name} value={u.name}>
                          {u.name}{u.factor > 1 ? ` (×${u.factor})` : ''}
                        </option>
                      ))}
                    </select>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={purQty}
                      onChange={setPurQty}
                      placeholder="الكمية"
                      ariaLabel="كمية الشراء"
                      inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      placeholder="سعر الشراء"
                      value={purPrice}
                      onChange={(e) => setPurPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      className="h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                )}
                {purProductId && (
                  <button
                    type="button"
                    onClick={handleAddPurItem}
                    className="w-full h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer"
                  >
                    إضافة الصنف لفاتورة الشراء
                  </button>
                )}
              </>
            ) : (
              <div className="bg-white p-2 rounded-md border border-[#DCE6F5] space-y-1.5">
                <div className="flex items-center gap-1.5 text-[#011E58] font-black">
                  <ProductAddIcon className="w-4 h-4 shrink-0" />
                  <span>بيانات الصنف الجديد (لا يضاف للمخزن إلا بعد اعتماد الإدارة)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">اسم الصنف الجديد: *</label>
                    <input
                      type="text"
                      value={newPurProdName}
                      onChange={(e) => setNewPurProdName(e.target.value)}
                      placeholder="مثال: شاي العروسة 250 جم"
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">الباركود (اختياري):</label>
                    <input
                      type="text"
                      value={newPurProdBarcode}
                      onChange={(e) => setNewPurProdBarcode(e.target.value)}
                      placeholder="622..."
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">الكود (اختياري):</label>
                    <input
                      type="text"
                      value={newPurProdCode}
                      onChange={(e) => setNewPurProdCode(e.target.value)}
                      placeholder="PRD-..."
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">التصنيف:</label>
                    <input
                      type="text"
                      value={newPurProdCategory}
                      onChange={(e) => setNewPurProdCategory(e.target.value)}
                      placeholder="التصنيف (اختياري)"
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">الوحدة الأساسية:</label>
                    <input
                      type="text"
                      value={newPurProdBaseUnit}
                      onChange={(e) => setNewPurProdBaseUnit(e.target.value)}
                      placeholder="قطعة / كرتونة / كجم"
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">الكمية المشتراة: *</label>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={newPurProdQty}
                      onChange={setNewPurProdQty}
                      placeholder="الكمية"
                      ariaLabel="كمية الصنف الجديد"
                      inputClassName="w-full h-8 bg-white border border-slate-300 rounded-md text-center font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">سعر الشراء: *</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      placeholder="سعر الشراء"
                      value={newPurProdBuyPrice}
                      onChange={(e) => setNewPurProdBuyPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      className="w-full h-8 border border-slate-300 rounded-md text-center font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">سعر البيع المقترح:</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      placeholder="سعر البيع"
                      value={newPurProdSellPrice}
                      onChange={(e) => setNewPurProdSellPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      className="w-full h-8 border border-slate-300 rounded-md text-center font-mono font-bold bg-white"
                    />
                  </div>
                </div>

                {purDuplicateCheckState.exactMatch && (
                  <div className="p-2 rounded-md border border-amber-300 bg-amber-50 text-amber-950 flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>
                        هذا الصنف مسجل مسبقاً ({purDuplicateCheckState.exactMatch.name} — {purDuplicateCheckState.exactMatch.code})! لن يُنشأ صنف مكرر.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUseExistingPurDuplicateProduct(purDuplicateCheckState.exactMatch!)}
                      className="h-7 px-2 rounded-md bg-amber-700 hover:bg-amber-800 text-white text-[11px] font-bold cursor-pointer"
                    >
                      استخدام الصنف الموجود
                    </button>
                  </div>
                )}

                {!purDuplicateCheckState.exactMatch && purDuplicateCheckState.similarMatches.length > 0 && (
                  <div className="p-2 rounded-md border border-blue-200 bg-blue-50/70 text-blue-950 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                      <span>توجد أصناف متشابهة بالاسم (اضغط للاختيار إن كان نفس الصنف):</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {purDuplicateCheckState.similarMatches.map((sim) => (
                        <button
                          key={sim.id}
                          type="button"
                          onClick={() => handleUseExistingPurDuplicateProduct(sim)}
                          className="h-7 px-2 rounded-md bg-white border border-blue-300 hover:bg-blue-100 text-blue-900 font-bold text-[11px] cursor-pointer"
                        >
                          {sim.name} ({sim.baseUnit})
                          {Number(sim.purchasePrice || 0) > 0 ? ` — ${sim.purchasePrice} ${data.settings.currency}` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowPurInlineNewProduct(false)}
                    className="h-8 px-2.5 rounded-md border border-slate-300 font-bold text-slate-600 cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={handleAddPurInlineNewProduct}
                    className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                  >
                    {purDuplicateCheckState.exactMatch ? 'ربط بالصنف الموجود وإضافته' : '+ إضافة الصنف للفاتورة'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {purItems.length > 0 && (
            <UnifiedDataTable
              compact
              paginated={false}
              searchable={false}
              title={`أصناف فاتورة الشراء (${purItems.length})`}
              data={purItems}
              rowKey={(it, idx) => `${it.productId}-${it.unit}-${idx}`}
              columns={[
                {
                  key: 'productName',
                  header: 'الصنف',
                  render: (it) => (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-900">{it.productName}</span>
                      {it.newProduct && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                          صنف جديد
                        </span>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'quantity',
                  header: 'الكمية',
                  align: 'center',
                  render: (it) => (
                    <span className="font-mono font-bold">
                      {it.quantity} {it.unit}
                    </span>
                  ),
                },
                {
                  key: 'unitPrice',
                  header: 'السعر',
                  align: 'center',
                  render: (it) => <span className="font-mono">{it.unitPrice.toLocaleString()}</span>,
                },
                {
                  key: 'total',
                  header: 'الإجمالي',
                  align: 'center',
                  render: (it) => <strong className="font-mono text-[#011E58]">{it.total.toLocaleString()}</strong>,
                },
                {
                  key: 'actions',
                  header: 'حذف',
                  align: 'center',
                  sortable: false,
                  render: (_it, idx) => (
                    <button
                      type="button"
                      onClick={() => setPurItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="h-7 w-7 rounded-md hover:bg-red-50 inline-flex items-center justify-center text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ),
                },
              ]}
            />
          )}

          <div className="grid grid-cols-3 gap-1.5">
            {[
              { key: 'cash' as const, label: 'نقدي' },
              { key: 'credit' as const, label: 'آجل' },
              { key: 'partial' as const, label: 'جزئي' },
            ].map((pt) => (
              <button
                key={pt.key}
                type="button"
                onClick={() => setPurPaymentType(pt.key)}
                className={`h-8 rounded-md border font-bold cursor-pointer ${
                  purPaymentType === pt.key
                    ? 'bg-[#003589] text-white border-[#011E58]'
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
              onChange={(e) => setPurPaidAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              placeholder="المدفوع للمورد الآن"
              className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
            />
          )}

          {!isRepRoleAccount && canCashOps && purPaymentType !== 'credit' && (
            <select
              value={purCashboxId}
              onChange={(e) => setPurCashboxId(e.target.value)}
              className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
            >
              {data.cashboxes.map((cb) => (
                <option key={cb.id} value={cb.id}>
                  {cb.name}
                </option>
              ))}
            </select>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <input
              type="number"
              min={0}
              max={purSubtotal}
              step="0.5"
              value={purDiscount || ''}
              onChange={(e) => setPurDiscount(Math.max(0, Number(e.target.value)))}
              placeholder={`الخصم (${data.settings.currency}) - اختياري`}
              className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
            />
            <input
              type="text"
              value={purNotes}
              onChange={(e) => setPurNotes(e.target.value)}
              placeholder="ملاحظات فاتورة الشراء..."
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />
          </div>

          <div className="px-2.5 py-1.5 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] flex items-center justify-between font-black">
            <span>صافي إجمالي فاتورة الشراء:</span>
            <strong className="font-mono text-[#011E58]">
              {purTotal.toLocaleString()} {data.settings.currency}
            </strong>
          </div>

          <button
            type="submit"
            disabled={isSubmittingPurchase || purItems.length === 0}
            className="w-full h-9 rounded-lg bg-[#011E58] hover:bg-[#003589] text-white font-black disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Eye className="w-4 h-4" />
            <span>{isSubmittingPurchase ? 'جاري المعالجة...' : 'مراجعة وإرسال الفاتورة'}</span>
          </button>
        </form>
      )}

      {/* ==================== SALES RETURN ==================== */}
      {activeTab === 'sales-return' && (
        <form onSubmit={handleSubmitSalesReturn} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2 text-xs">
          <h3 className="text-xs sm:text-sm font-black text-rose-900">تسجيل مرتجع مبيعات</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <select
              value={sRetCustomerId}
              onChange={(e) => setSRetCustomerId(e.target.value)}
              className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="">-- اختر العميل --</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.shopName || c.name}</option>
              ))}
            </select>
            <select
              value={sRetInvoiceId}
              onChange={(e) => {
                const nextInvId = e.target.value;
                setSRetInvoiceId(nextInvId);
                const matchedInv = myInvoices.find((i) => i.id === nextInvId);
                if (matchedInv?.customerId && !sRetCustomerId) {
                  setSRetCustomerId(matchedInv.customerId);
                }
              }}
              className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="">
                {isRepRoleAccount || !canCashOps
                  ? '-- اختر فاتورة البيع المعتمدة (إلزامي) --'
                  : '-- ربط بفاتورة بيع معتمدة (اختياري) --'}
              </option>
              {myInvoices
                .filter((i) => i.status === 'confirmed' && (!sRetCustomerId || i.customerId === sRetCustomerId))
                .map((i) => (
                  <option key={i.id} value={i.id}>{i.invoiceNumber} ({i.grandTotal})</option>
                ))}
            </select>
          </div>

          <div className="p-2 rounded-md bg-rose-50/70 border border-rose-200 space-y-1.5">
            <select
              value={sRetProductId}
              onChange={(e) => {
                setSRetProductId(e.target.value);
                const p = activeProducts.find((x) => x.id === e.target.value);
                if (p) setSRetPrice(p.sellingPrice);
              }}
              className="w-full h-8 rounded-md border border-rose-300 px-2 font-bold bg-white"
            >
              <option value="">-- اختر الصنف المرتجع --</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.baseUnit})</option>
              ))}
            </select>
            {sRetProductId && (
              <div className="grid grid-cols-2 gap-1.5">
                <QuantityInput
                  allowDecimals
                  min={0.001}
                  value={sRetQty}
                  onChange={setSRetQty}
                  ariaLabel="كمية المرتجع"
                  inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                />
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={sRetPrice}
                  onChange={(e) => setSRetPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                  placeholder="السعر"
                  className="h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                />
              </div>
            )}
            {sRetProductId && (
              <button
                type="button"
                onClick={() => {
                  const p = activeProducts.find((x) => x.id === sRetProductId);
                  const rq = Number(sRetQty || 0);
                  const rp = Math.max(0, Number(sRetPrice || 0));
                  if (!p || rq <= 0) return;
                  setSRetItems((prev) => [
                    ...prev,
                    {
                      productId: p.id,
                      productName: p.name,
                      unit: p.baseUnit,
                      unitFactor: 1,
                      quantity: rq,
                      unitPrice: rp,
                      total: computeLineTotal(rq, rp),
                    },
                  ]);
                  setSRetProductId('');
                  setSRetQty('');
                  setSRetPrice('');
                }}
                className="w-full h-8 rounded-md bg-rose-700 text-white font-black cursor-pointer"
              >
                إضافة لمرتجع البيع
              </button>
            )}
          </div>

          {sRetItems.length > 0 && (
            <UnifiedDataTable
              compact
              paginated={false}
              searchable={false}
              title={`أصناف مرتجع المبيعات (${sRetItems.length})`}
              data={sRetItems}
              rowKey={(it, idx) => `${it.productId}-${idx}`}
              columns={[
                { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold">{it.productName}</span> },
                {
                  key: 'quantity',
                  header: 'الكمية',
                  align: 'center',
                  render: (it) => <span className="font-mono">{it.quantity} {it.unit}</span>,
                },
                {
                  key: 'unitPrice',
                  header: 'السعر',
                  align: 'center',
                  render: (it) => <span className="font-mono">{it.unitPrice.toLocaleString()}</span>,
                },
                {
                  key: 'total',
                  header: 'الإجمالي',
                  align: 'center',
                  render: (it) => <strong className="font-mono text-rose-800">{it.total.toLocaleString()}</strong>,
                },
                {
                  key: 'actions',
                  header: 'حذف',
                  align: 'center',
                  sortable: false,
                  render: (_it, idx) => (
                    <button
                      type="button"
                      onClick={() => setSRetItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="h-7 w-7 rounded-md hover:bg-red-50 inline-flex items-center justify-center text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ),
                },
              ]}
            />
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={sRetSettlement}
              onChange={(e) => setSRetSettlement(e.target.value as 'account' | 'cash')}
              className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="account">خصم من رصيد العميل</option>
              <option value="cash">
                {isRepRoleAccount || !canCashOps
                  ? 'طلب رد نقدي (باعتماد الخزينة/الإدارة)'
                  : 'صرف نقدي من الخزينة'}
              </option>
            </select>
            <select
              value={sRetWarehouseId}
              onChange={(e) => setSRetWarehouseId(e.target.value)}
              className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          {sRetSettlement === 'cash' && (!isRepRoleAccount && canCashOps ? (
            <select
              value={sRetCashboxId}
              onChange={(e) => setSRetCashboxId(e.target.value)}
              className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              {data.cashboxes.map((cb) => (
                <option key={cb.id} value={cb.id}>{cb.name}</option>
              ))}
            </select>
          ) : (
            <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
              يُرسل هذا المرتجع النقدي كطلب مراجعة للخزينة والإدارة دون اختيار خزينة، ولا يتأثر رصيد أي خزينة حتى الاعتماد الرسمي.
            </div>
          ))}

          <input
            type="text"
            value={sRetReason}
            onChange={(e) => setSRetReason(e.target.value)}
            required={sRetSettlement === 'cash' && (isRepRoleAccount || !canCashOps)}
            placeholder={
              sRetSettlement === 'cash' && (isRepRoleAccount || !canCashOps)
                ? 'سبب طلب مرتجع المبيعات النقدي (إلزامي)...'
                : 'سبب المرتجع...'
            }
            className="w-full h-8 rounded-md border border-slate-300 px-2"
          />

          <button
            type="submit"
            disabled={isSubmittingSRet || sRetItems.length === 0}
            className="w-full h-9 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-black disabled:opacity-50 cursor-pointer"
          >
            {isSubmittingSRet
              ? 'جاري التسجيل...'
              : sRetSettlement === 'cash' && (isRepRoleAccount || !canCashOps)
              ? `إرسال طلب مرتجع بيع نقدي للمراجعة (${sRetTotal.toLocaleString()} ${data.settings.currency})`
              : `اعتماد مرتجع البيع (${sRetTotal.toLocaleString()} ${data.settings.currency})`}
          </button>
        </form>
      )}

      {/* ==================== PURCHASE RETURN / REQUEST ==================== */}
      {activeTab === 'purchase-return' && (
        <form onSubmit={handleSubmitPurchaseReturn} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs sm:text-sm font-black text-[#011E58]">
              {isRepRoleAccount || !canPurchases ? 'طلب مرتجع مشتريات (يعتمد من الإدارة)' : 'تسجيل مرتجع مشتريات'}
            </h3>
            <button
              type="button"
              onClick={() => onTabChange('purchase-returns-list')}
              className="text-[11px] font-bold text-[#003589] underline cursor-pointer"
            >
              عرض الطلبات والمرتجعات
            </button>
          </div>

          {(isRepRoleAccount || !canPurchases) && (
            <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-950 font-bold text-[11px]">
              المندوب يرفع طلب مرتجع مرتبط بفاتورة شراء معتمدة خاصة به؛ ولا يتم تعديل المخزون أو رصيد المورد أو الخزينة إلا بعد مراجعة واعتماد الإدارة.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <select
              value={pRetSupplierId}
              onChange={(e) => {
                setPRetSupplierId(e.target.value);
                if (pRetInvoiceId) {
                  const inv = confirmedOwnPurchases.find((i) => i.id === pRetInvoiceId);
                  if (inv && e.target.value && inv.supplierId !== e.target.value) {
                    setPRetInvoiceId('');
                    setPRetProductId('');
                    setPRetItems([]);
                  }
                }
              }}
              className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="">-- اختر المورد --</option>
              {data.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              value={pRetInvoiceId}
              onChange={(e) => {
                const nextId = e.target.value;
                setPRetInvoiceId(nextId);
                setPRetProductId('');
                setPRetItems([]);
                const inv = confirmedOwnPurchases.find((i) => i.id === nextId);
                if (inv) {
                  if (inv.supplierId) setPRetSupplierId(inv.supplierId);
                  if (inv.warehouseId) setPRetWarehouseId(inv.warehouseId);
                }
              }}
              className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="">
                {isRepRoleAccount || !canPurchases ? '-- اختر فاتورة الشراء المعتمدة (إلزامي) --' : '-- ربط بفاتورة شراء (اختياري) --'}
              </option>
              {confirmedOwnPurchases
                .filter((i) => !pRetSupplierId || i.supplierId === pRetSupplierId)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNumber} · {i.supplierName} ({i.grandTotal.toLocaleString()})
                  </option>
                ))}
            </select>
          </div>

          <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] space-y-1.5">
            {isRepRoleAccount || !canPurchases ? (
              !selectedPRetOrigInvoice ? (
                <p className="text-[11px] font-bold text-[#011E58] py-1.5 text-center">
                  اختر أولاً فاتورة شراء معتمدة خاصة بك لعرض الأصناف القابلة للإرجاع منها.
                </p>
              ) : (
                <>
                  <select
                    value={pRetProductId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPRetProductId(val);
                      const matched = pRetReturnableOptions.find((x) => `${x.productId}::${x.unit}` === val);
                      if (matched) {
                        setPRetQty(Math.min(1, matched.maxReturnableQty || 0));
                        setPRetPrice(Number(matched.unitPrice || 0));
                      }
                    }}
                    className="w-full h-8 rounded-md border border-[#DCE6F5] px-2 font-bold bg-white"
                  >
                    <option value="">-- اختر الصنف من بنود الفاتورة --</option>
                    {pRetReturnableOptions.map((line) => (
                      <option
                        key={`${line.productId}::${line.unit}`}
                        value={`${line.productId}::${line.unit}`}
                        disabled={line.maxReturnableQty <= 0}
                      >
                        {line.productName} ({line.unit}) — متاح للإرجاع: {line.maxReturnableQty} من {line.quantity}
                      </option>
                    ))}
                  </select>
                  {pRetProductId && (() => {
                    const selectedLine = pRetReturnableOptions.find((x) => `${x.productId}::${x.unit}` === pRetProductId);
                    if (!selectedLine) return null;
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                              الكمية (الحد الأقصى: {selectedLine.maxReturnableQty})
                            </label>
                            <QuantityInput
                              allowDecimals
                              min={0.001}
                              max={selectedLine.maxReturnableQty}
                              value={pRetQty}
                              onChange={setPRetQty}
                              ariaLabel="كمية طلب مرتجع الشراء"
                              inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">سعر الوحدة</label>
                            <input
                              type="number"
                              min={0}
                              step="0.5"
                              value={pRetPrice}
                              onChange={(e) => setPRetPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                              placeholder="السعر"
                              className="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const rq = Number(pRetQty || 0);
                            const rp = Math.max(0, Number(pRetPrice || 0));
                            if (rq <= 0) return;
                            if (rq > selectedLine.maxReturnableQty + 0.0001) {
                              setFeedback({
                                type: 'error',
                                text: `الكمية المطلوبة (${rq}) تتجاوز المتاح للإرجاع (${selectedLine.maxReturnableQty}).`,
                              });
                              return;
                            }
                            setPRetItems((prev) => [
                              ...prev,
                              {
                                productId: selectedLine.productId,
                                productName: selectedLine.productName,
                                unit: selectedLine.unit,
                                unitFactor: Number(selectedLine.unitFactor || 1),
                                quantity: rq,
                                unitPrice: rp,
                                total: computeLineTotal(rq, rp),
                              },
                            ]);
                            setPRetProductId('');
                            setPRetQty('');
                            setPRetPrice('');
                          }}
                          className="w-full h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer"
                        >
                          إضافة لطلب مرتجع الشراء
                        </button>
                      </>
                    );
                  })()}
                </>
              )
            ) : (
              <>
                <select
                  value={pRetProductId}
                  onChange={(e) => {
                    setPRetProductId(e.target.value);
                    const p = activeProducts.find((x) => x.id === e.target.value);
                    if (p) setPRetPrice(p.purchasePrice > 0 ? p.purchasePrice : '');
                  }}
                  className="w-full h-8 rounded-md border border-[#DCE6F5] px-2 font-bold bg-white"
                >
                  <option value="">-- اختر الصنف المرتجع للمورد --</option>
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.baseUnit})</option>
                  ))}
                </select>
                {pRetProductId && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={pRetQty}
                      onChange={setPRetQty}
                      ariaLabel="كمية مرتجع الشراء"
                      inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={pRetPrice}
                      onChange={(e) => setPRetPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      placeholder="السعر"
                      className="h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                )}
                {pRetProductId && (
                  <button
                    type="button"
                    onClick={() => {
                      const p = activeProducts.find((x) => x.id === pRetProductId);
                      const rq = Number(pRetQty || 0);
                      const rp = Math.max(0, Number(pRetPrice || 0));
                      if (!p || rq <= 0) return;
                      setPRetItems((prev) => [
                        ...prev,
                        {
                          productId: p.id,
                          productName: p.name,
                          unit: p.baseUnit,
                          unitFactor: 1,
                          quantity: rq,
                          unitPrice: rp,
                          total: computeLineTotal(rq, rp),
                        },
                      ]);
                      setPRetProductId('');
                      setPRetQty('');
                      setPRetPrice('');
                    }}
                    className="w-full h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer"
                  >
                    إضافة لمرتجع الشراء
                  </button>
                )}
              </>
            )}
          </div>

          {pRetItems.length > 0 && (
            <UnifiedDataTable
              compact
              paginated={false}
              searchable={false}
              title={`أصناف مرتجع المشتريات (${pRetItems.length})`}
              data={pRetItems}
              rowKey={(it, idx) => `${it.productId}-${idx}`}
              columns={[
                { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold">{it.productName}</span> },
                {
                  key: 'quantity',
                  header: 'الكمية',
                  align: 'center',
                  render: (it) => <span className="font-mono">{it.quantity} {it.unit}</span>,
                },
                {
                  key: 'unitPrice',
                  header: 'السعر',
                  align: 'center',
                  render: (it) => <span className="font-mono">{it.unitPrice.toLocaleString()}</span>,
                },
                {
                  key: 'total',
                  header: 'الإجمالي',
                  align: 'center',
                  render: (it) => <strong className="font-mono text-[#011E58]">{it.total.toLocaleString()}</strong>,
                },
                {
                  key: 'actions',
                  header: 'حذف',
                  align: 'center',
                  sortable: false,
                  render: (_it, idx) => (
                    <button
                      type="button"
                      onClick={() => setPRetItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="h-7 w-7 rounded-md hover:bg-red-50 inline-flex items-center justify-center text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ),
                },
              ]}
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <select
              value={pRetSettlement}
              onChange={(e) => setPRetSettlement(e.target.value as 'account' | 'cash')}
              className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="account">خصم من رصيد المورد</option>
              <option value="cash">استرداد نقدي</option>
            </select>
            {!(isRepRoleAccount || !canPurchases) ? (
              <select
                value={pRetWarehouseId}
                onChange={(e) => setPRetWarehouseId(e.target.value)}
                className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
              >
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            ) : !isRepRoleAccount && canCashOps && pRetSettlement === 'cash' ? (
              <select
                value={pRetCashboxId}
                onChange={(e) => setPRetCashboxId(e.target.value)}
                className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
              >
                {data.cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>{cb.name}</option>
                ))}
              </select>
            ) : (
              <div className="h-8 rounded-md border border-slate-200 px-2 flex items-center text-[11px] font-bold text-slate-600 bg-slate-50">
                {pRetSettlement === 'cash'
                  ? `تُحدد الخزينة من الإدارة عند الاعتماد · المخزن: ${selectedPRetOrigInvoice?.warehouseName || 'حسب الفاتورة'}`
                  : `المخزن: ${selectedPRetOrigInvoice?.warehouseName || 'حسب الفاتورة الأصلية'}`}
              </div>
            )}
          </div>

          <input
            type="text"
            value={pRetReason}
            onChange={(e) => setPRetReason(e.target.value)}
            required={isRepRoleAccount || !canPurchases}
            placeholder={
              isRepRoleAccount || !canPurchases
                ? 'سبب طلب مرتجع الشراء (إلزامي)...'
                : 'سبب مرتجع الشراء...'
            }
            className="w-full h-8 rounded-md border border-slate-300 px-2"
          />

          <button
            type="submit"
            disabled={
              isSubmittingPRet ||
              pRetItems.length === 0 ||
              ((isRepRoleAccount || !canPurchases) && (!selectedPRetOrigInvoice || !pRetReason.trim()))
            }
            className="w-full h-9 rounded-lg bg-[#011E58] hover:bg-[#003589] text-white font-black disabled:opacity-50 cursor-pointer"
          >
            {isSubmittingPRet
              ? 'جاري الإرسال...'
              : isRepRoleAccount || !canPurchases
              ? `إرسال طلب مرتجع الشراء للإدارة (${pRetTotal.toLocaleString()} ${data.settings.currency})`
              : `اعتماد مرتجع الشراء (${pRetTotal.toLocaleString()} ${data.settings.currency})`}
          </button>
        </form>
      )}

      {/* ==================== CASH DEPOSIT / WA0005 COLLECTION ==================== */}
      {activeTab === 'cash-deposit' && (() => {
        const depCustomer = data.customers.find((c) => c.id === depCustomerId) || null;
        const openCustomerInvoices = depCustomer
          ? myInvoices.filter(
              (inv) =>
                inv.customerId === depCustomer.id &&
                inv.status !== 'cancelled' &&
                Number(inv.remainingAmount || 0) > 0.009
            )
          : [];
        const selectedTargetInvoice = openCustomerInvoices.find((inv) => inv.id === depInvoiceId) || null;
        const currentDueTotal = Math.max(0, Number(depCustomer?.currentBalance || 0));
        const targetDueForQuickFill = selectedTargetInvoice
          ? Math.max(0, Number(selectedTargetInvoice.remainingAmount || 0))
          : currentDueTotal;
        const payNow = Math.max(0, Number(depAmount || 0));
        const remainingAfterPay = Math.max(0, currentDueTotal - payNow);
        const currency = data.settings.currency || 'ج.م';

        return (
          <form onSubmit={handleSubmitCashDeposit} className="bg-white rounded-lg border border-slate-200 overflow-hidden text-xs">
            {/* Brand Navy Collection Header */}
            <div className="awlad-brand-gradient text-white px-2.5 py-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-black shrink-0">
                  {depMode === 'cashbox_deposit' && !isRepRoleAccount ? 'إيداع مباشر بالخزينة' : 'تحصيل من العميل'}
                </h3>
                {depCustomer && depMode === 'customer_collection' && (
                  <span className="text-[11px] text-[#DCE6F5] truncate">
                    · {depCustomer.shopName || depCustomer.name}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onTabChange('customers')}
                className="h-7 px-2 rounded-md bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold cursor-pointer shrink-0"
              >
                إلغاء
              </button>
            </div>

            <div className="p-2.5 space-y-2">
              {!isRepRoleAccount && (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDepMode('customer_collection')}
                    className={`h-8 rounded-md font-bold border cursor-pointer ${
                      depMode === 'customer_collection'
                        ? 'bg-[#003589] text-white border-[#011E58]'
                        : 'bg-slate-50 text-slate-700 border-slate-300'
                    }`}
                  >
                    تحصيل من عميل
                  </button>
                  <button
                    type="button"
                    disabled={!canCashOps}
                    onClick={() => setDepMode('cashbox_deposit')}
                    className={`h-8 rounded-md font-bold border cursor-pointer disabled:opacity-45 ${
                      depMode === 'cashbox_deposit'
                        ? 'bg-[#003589] text-white border-[#011E58]'
                        : 'bg-slate-50 text-slate-700 border-slate-300'
                    }`}
                  >
                    {canCashOps ? 'إيداع مباشر بالخزينة' : 'إيداع بالخزينة (مقيد)'}
                  </button>
                </div>
              )}

              {(depMode === 'customer_collection' || isRepRoleAccount) && (
                <>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">العميل</label>
                    <select
                      value={depCustomerId}
                      onChange={(e) => {
                        setDepCustomerId(e.target.value);
                        setDepInvoiceId('');
                      }}
                      className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                    >
                      <option value="">-- اختر العميل --</option>
                      {data.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.shopName || c.name} — رصيد: {Number(c.currentBalance || 0).toLocaleString()} {currency}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* WA0005 3-Col Hairline Balance Summary Strip */}
                  {depCustomer && (
                    <div className="grid grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden tabular-nums">
                      <div className="bg-slate-50 px-2 py-1.5 text-center">
                        <span className="block text-[10px] font-bold text-slate-500">عليه حالياً</span>
                        <strong className="font-mono text-xs font-black text-slate-900">
                          {currentDueTotal.toLocaleString()} {currency}
                        </strong>
                      </div>
                      <div className="bg-white px-2 py-1.5 text-center">
                        <span className="block text-[10px] font-bold text-slate-500">هيدفع دلوقتي</span>
                        <strong className="font-mono text-xs font-black text-emerald-700">
                          {payNow.toLocaleString()} {currency}
                        </strong>
                      </div>
                      <div className="bg-slate-50 px-2 py-1.5 text-center">
                        <span className="block text-[10px] font-bold text-slate-500">هيتبقى عليه</span>
                        <strong className={`font-mono text-xs font-black ${remainingAfterPay > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {remainingAfterPay.toLocaleString()} {currency}
                        </strong>
                      </div>
                    </div>
                  )}

                  {depCustomer && openCustomerInvoices.length > 0 && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-0.5">سداد فاتورة محددة (اختياري)</label>
                      <select
                        value={depInvoiceId}
                        onChange={(e) => setDepInvoiceId(e.target.value)}
                        className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                      >
                        <option value="">توزيع تلقائي (الأقدم أولاً FIFO)</option>
                        {openCustomerInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.invoiceNumber} · {inv.date} — متبقي: {Number(inv.remainingAmount || 0).toLocaleString()} {currency}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* Amount Input + Quick Fill "ادفع المبلغ كله" */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-bold text-slate-700">المبلغ المدفوع ({currency})</label>
                  {(depMode === 'customer_collection' || isRepRoleAccount) && targetDueForQuickFill > 0 && (
                    <button
                      type="button"
                      onClick={() => setDepAmount(targetDueForQuickFill)}
                      className="h-7 px-2 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] text-[11px] font-black cursor-pointer"
                    >
                      ادفع المبلغ كله ({targetDueForQuickFill.toLocaleString()})
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={depAmount === '' ? '' : depAmount}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setDepAmount('');
                    } else {
                      setDepAmount(Math.max(0, Number(raw)));
                    }
                  }}
                  placeholder={`أدخل المبلغ (${currency})`}
                  className="w-full h-9 rounded-md border border-slate-300 px-2.5 font-mono text-sm font-black text-center text-[#011E58] bg-white tabular-nums"
                />
              </div>

              <div className={`grid gap-1.5 ${!isRepRoleAccount ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">التاريخ</label>
                  <input
                    type="date"
                    value={depDate}
                    onChange={(e) => setDepDate(e.target.value)}
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-bold bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">طريقة السداد</label>
                  <select
                    value={depMethod}
                    onChange={(e) => setDepMethod(e.target.value as any)}
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                  >
                    <option value="cash">نقدي</option>
                    <option value="bank">تحويل بنكي</option>
                    <option value="cheque">شيك</option>
                  </select>
                </div>
                {!isRepRoleAccount && (
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">الخزينة</label>
                    <select
                      value={depCashboxId}
                      onChange={(e) => setDepCashboxId(e.target.value)}
                      className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                    >
                      {data.cashboxes.map((cb) => (
                        <option key={cb.id} value={cb.id}>{cb.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">ملاحظات (اختياري)</label>
                <input
                  type="text"
                  value={depNotes}
                  onChange={(e) => setDepNotes(e.target.value)}
                  placeholder="ملاحظات (اختياري) - تظهر في إيصال الدفع"
                  className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => onTabChange('customers')}
                  className="h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-black cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDeposit || Number(depAmount || 0) <= 0}
                  className="col-span-2 h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingDeposit ? 'جاري التسجيل...' : 'دفع وتأكيد التحصيل'}
                </button>
              </div>
            </div>
          </form>
        );
      })()}

      {/* ==================== CASH WITHDRAWAL ==================== */}
      {activeTab === 'cash-withdrawal' && (
        isRepRoleAccount || !canCashOps ? (
          <div className="bg-white rounded-lg border border-red-200 p-2.5 text-center space-y-1.5 text-xs">
            <ShieldAlert className="w-6 h-6 text-red-600 mx-auto" />
            <p className="font-black text-red-800">غير مصرح لحساب المندوب بتنفيذ سحب أو مصروف مباشر من الخزائن.</p>
            <button
              type="button"
              onClick={() => onTabChange('home')}
              className="h-8 px-3 rounded-md bg-slate-100 font-bold text-slate-800 cursor-pointer"
            >
              العودة للرئيسية
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmitCashWithdrawal} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5 text-xs">
            <h3 className="text-xs sm:text-sm font-black text-amber-900">سحب نقدي / تسجيل مصروف</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <select
                value={wdCashboxId}
                onChange={(e) => setWdCashboxId(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
              >
                {data.cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.name}
                    {typeof cb.currentBalance === 'number' && !cb.balanceHidden
                      ? ` (رصيد: ${cb.currentBalance.toLocaleString()})`
                      : ''}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={wdCategory}
                onChange={(e) => setWdCategory(e.target.value)}
                placeholder="البند / التصنيف (مثال: بنزين / مصروف تشغيل)"
                className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold"
              />
              <input
                type="text"
                value={wdBeneficiary}
                onChange={(e) => setWdBeneficiary(e.target.value)}
                placeholder="المستفيد (اختياري)"
                className="w-full h-8 rounded-md border border-slate-300 px-2"
              />
              <input
                type="number"
                min={1}
                step="0.01"
                value={wdAmount || ''}
                onChange={(e) => setWdAmount(Math.max(0, Number(e.target.value)))}
                placeholder={`مبلغ السحب (${data.settings.currency})`}
                className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-black text-center text-red-700"
              />
            </div>
            <input
              type="text"
              value={wdNotes}
              onChange={(e) => setWdNotes(e.target.value)}
              placeholder="بيان السحب / المصروف..."
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />
            <button
              type="submit"
              disabled={isSubmittingWithdrawal}
              className="w-full h-9 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isSubmittingWithdrawal ? 'جاري التسجيل...' : 'تأكيد السحب النقدي'}
            </button>
          </form>
        )
      )}

      {/* ==================== NEW CUSTOMER (10-Part Store Profile, Multi-Phone, Camera/Gallery & GPS) ==================== */}
      {activeTab === 'new-customer' && (() => {
        const helper = renderPhoneAndMapsActionRow(
          newCustPhone,
          newCustAddress || newCustArea,
          newCustGeo,
          setCustPhoneNotice,
          setCustMapNotice
        );
        return (
          <form onSubmit={handleSaveNewCustomer} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2 text-xs">
            <h3 className="text-xs sm:text-sm font-black text-slate-900">إضافة عميل / محل جديد</h3>

            {/* 1. Shop Name & 2. Customer Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">اسم المحل</label>
                <input
                  type="text"
                  value={newCustShop}
                  onChange={(e) => setNewCustShop(e.target.value)}
                  placeholder="مثال: سوبرماركت النور"
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">اسم العميل / صاحب المحل *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="الاسم الكامل للعميل أو صاحب المحل"
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold"
                />
              </div>
            </div>

            {/* 3. Shop Photo (Camera + Gallery + Preview + Replace/Delete) */}
            <div className="p-2 rounded-md bg-slate-50 border border-slate-200 flex items-center gap-2">
              <div className="w-12 h-12 rounded-md border border-slate-300 bg-white overflow-hidden flex items-center justify-center shrink-0">
                {newCustShopPhoto ? (
                  <button
                    type="button"
                    onClick={() => setPreviewShopPhoto(newCustShopPhoto)}
                    className="w-full h-full cursor-pointer"
                    title="عرض الصورة"
                  >
                    <img src={newCustShopPhoto} alt="صورة المحل" className="w-full h-full object-cover" />
                  </button>
                ) : (
                  <Store className="w-4 h-4 text-slate-300" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <span className="block text-[11px] font-black text-slate-800">صورة المحل / الواجهة</span>
                <div className="flex flex-wrap gap-1.5">
                  <label className="h-7 px-2 rounded-md bg-blue-900 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer">
                    <Camera className="w-3.5 h-3.5" />
                    <span>{newCustShopPhoto ? 'تغيير بالكاميرا' : 'التقاط بالكاميرا'}</span>
                    <input
                      ref={custCameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleCustPhotoUpload}
                      className="hidden"
                    />
                  </label>
                  <label className="h-7 px-2 rounded-md bg-white text-slate-800 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>من المعرض</span>
                    <input
                      ref={custGalleryInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleCustPhotoUpload}
                      className="hidden"
                    />
                  </label>
                  {newCustShopPhoto && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewCustShopPhoto('');
                        if (custCameraInputRef.current) custCameraInputRef.current.value = '';
                        if (custGalleryInputRef.current) custGalleryInputRef.current.value = '';
                      }}
                      className="h-7 px-2 rounded-md bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold cursor-pointer"
                    >
                      حذف
                    </button>
                  )}
                </div>
                {isUploadingCustPhoto && <p className="text-[10px] font-bold text-blue-900">جاري ضغط وتجهيز الصورة...</p>}
              </div>
            </div>

            {/* 4. Address + adjacent GPS Icon Button + Maps Preview */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">عنوان المحل الرئيسي</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => {
                    setNewCustAddress(e.target.value);
                    if (custMapNotice) setCustMapNotice(null);
                  }}
                  placeholder="الشارع، المنطقة، علامة مميزة..."
                  className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-bold"
                />
                <button
                  type="button"
                  onClick={() => setLocationPickerTarget('new')}
                  className="h-8 px-2 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  title="تحديد موقع العميل على خريطة جوجل"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>خريطة</span>
                </button>
                <button
                  type="button"
                  disabled={isLocatingCust}
                  onClick={handleCaptureCustLocation}
                  className="h-8 px-2 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                  title="تحديد الموقع الحالي GPS وجلب العنوان تلقائياً"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#003589]" />
                  <span>{isLocatingCust ? 'تحديد...' : 'GPS'}</span>
                </button>
              </div>
              {newCustGeo && (
                <p className="text-[10px] font-mono text-[#003589] mt-0.5" dir="ltr">
                  GPS: {newCustGeo}
                </p>
              )}
              {custMapNotice && <p className="text-[11px] font-bold text-red-600 mt-0.5">{custMapNotice}</p>}
            </div>

            {/* 5. Governorate & Area */}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">المحافظة</label>
                <input
                  type="text"
                  value={newCustGovernorate}
                  onChange={(e) => setNewCustGovernorate(e.target.value)}
                  placeholder="مثال: القاهرة / الجيزة"
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">المنطقة / خط السير</label>
                <input
                  type="text"
                  value={newCustArea}
                  onChange={(e) => setNewCustArea(e.target.value)}
                  placeholder="المنطقة / الحي / خط السير"
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-semibold"
                />
              </div>
            </div>

            {/* 6. Primary Phone + 7. Unlimited Additional Phones */}
            <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">رقم التليفون الرئيسي *</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="tel"
                    required
                    value={newCustPhone}
                    onChange={(e) => {
                      setNewCustPhone(e.target.value);
                      if (custPhoneNotice) setCustPhoneNotice(null);
                    }}
                    placeholder="01012345678"
                    className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-mono font-bold bg-white"
                  />
                  {helper.isPhoneValid ? (
                    <a
                      href={`tel:${helper.cleanedPhone}`}
                      onClick={() =>
                        setCustPhoneNotice({ type: 'info', text: `جاري الاتصال بالرقم (${helper.cleanedPhone}).` })
                      }
                      className="h-8 px-2 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                      title="اتصال هاتفي مباشر"
                    >
                      <Phone className="w-3.5 h-3.5 text-[#003589]" />
                      <span>اتصال</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setCustPhoneNotice({ type: 'error', text: 'يرجى إدخال رقم هاتف صحيح (7 أرقام على الأقل) أولاً.' })
                      }
                      className="h-8 px-2 rounded-md bg-slate-100 text-slate-600 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>اتصال</span>
                    </button>
                  )}
                </div>
                {custPhoneNotice && (
                  <p className={`text-[10px] font-bold mt-0.5 ${custPhoneNotice.type === 'error' ? 'text-red-600' : 'text-[#003589]'}`}>
                    {custPhoneNotice.text}
                  </p>
                )}
              </div>

              {newCustExtraPhones.length > 0 && (
                <div className="space-y-1">
                  <label className="block font-bold text-slate-600 text-[10px]">أرقام تليفون إضافية:</label>
                  {newCustExtraPhones.map((extra, idx) => {
                    const cleanEx = extra.phone.replace(/[^\d+]/g, '');
                    const validEx = cleanEx.replace(/\D/g, '').length >= 7;
                    return (
                      <div key={extra.id || idx} className="flex flex-wrap sm:flex-nowrap items-center gap-1">
                        <input
                          type="tel"
                          value={extra.phone}
                          onChange={(e) => {
                            const v = e.target.value;
                            setNewCustExtraPhones((prev) => prev.map((row, i) => (i === idx ? { ...row, phone: v } : row)));
                          }}
                          placeholder="رقم إضافي..."
                          className="flex-1 min-w-[110px] h-8 rounded-md border border-slate-300 px-2 font-mono font-bold bg-white"
                        />
                        <select
                          value={extra.label}
                          onChange={(e) => {
                            const v = e.target.value;
                            setNewCustExtraPhones((prev) => prev.map((row, i) => (i === idx ? { ...row, label: v } : row)));
                          }}
                          className="h-8 rounded-md border border-slate-300 px-1.5 font-bold bg-white"
                        >
                          <option value="موبايل">موبايل</option>
                          <option value="محل">تليفون المحل</option>
                          <option value="واتساب">واتساب</option>
                          <option value="إضافي">إضافي</option>
                        </select>
                        {validEx && (
                          <a
                            href={`tel:${cleanEx}`}
                            className="h-8 px-2 rounded-md bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5] inline-flex items-center"
                            title="اتصال"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const val = extra.phone.trim();
                            if (!val) return;
                            const prevPrimary = newCustPhone.trim();
                            setNewCustPhone(val);
                            setNewCustExtraPhones((prev) =>
                              prev
                                .map((row, i) => (i === idx ? { ...row, phone: prevPrimary } : row))
                                .filter((row) => row.phone.trim() !== '')
                            );
                          }}
                          className="h-8 px-2 rounded-md bg-blue-50 text-blue-900 border border-blue-200 text-[10px] font-bold cursor-pointer shrink-0"
                        >
                          رئيسي
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewCustExtraPhones((prev) => prev.filter((_, i) => i !== idx))}
                          className="h-8 px-2 rounded-md bg-red-50 text-red-600 border border-red-200 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  setNewCustExtraPhones((prev) => [
                    ...prev,
                    { id: `ph-${Date.now()}-${prev.length}`, phone: '', label: 'موبايل' },
                  ])
                }
                className="h-7 px-2 rounded-md bg-white hover:bg-blue-50 text-blue-900 border border-blue-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة رقم تليفون آخر</span>
              </button>
            </div>

            {/* 8. Notes & 9. Opening Balance (optional) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <input
                type="text"
                value={newCustNotes}
                onChange={(e) => setNewCustNotes(e.target.value)}
                placeholder="ملاحظات عن المحل أو المواعيد (اختياري)"
                className="h-8 rounded-md border border-slate-300 px-2"
              />
              <input
                type="number"
                value={newCustOpening || ''}
                onChange={(e) => setNewCustOpening(Number(e.target.value))}
                placeholder={`رصيد افتتاحي (${data.settings.currency}) - اختياري`}
                className="h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
              />
            </div>

            {/* 10. Save Customer */}
            <button
              type="submit"
              disabled={isSavingCustomer || isUploadingCustPhoto}
              className="w-full h-9 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
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
          <form onSubmit={handleSaveNewSupplier} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2 text-xs">
            <h3 className="text-xs sm:text-sm font-black text-[#011E58]">إضافة مورد جديد</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <input
                type="text"
                required
                value={newSupName}
                onChange={(e) => setNewSupName(e.target.value)}
                placeholder="اسم المورد *"
                className="h-8 rounded-md border border-slate-300 px-2 font-bold"
              />
              <input
                type="text"
                value={newSupCompany}
                onChange={(e) => setNewSupCompany(e.target.value)}
                placeholder="اسم الشركة / المصنع"
                className="h-8 rounded-md border border-slate-300 px-2 font-bold"
              />
            </div>

            <div>
              <div className="flex items-center gap-1.5">
                <input
                  type="tel"
                  required
                  value={newSupPhone}
                  onChange={(e) => {
                    setNewSupPhone(e.target.value);
                    if (supPhoneNotice) setSupPhoneNotice(null);
                  }}
                  placeholder="رقم الهاتف *"
                  className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
                />
                {supPhoneValid ? (
                  <a
                    href={`tel:${cleanedSupPhone}`}
                    className="h-8 px-2 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1"
                  >
                    <Phone className="w-3.5 h-3.5 text-[#003589]" />
                    <span>اتصال</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setSupPhoneNotice({ type: 'error', text: 'يرجى إدخال رقم هاتف المورد (7 أرقام على الأقل).' })
                    }
                    className="h-8 px-2 rounded-md bg-slate-100 text-slate-600 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>اتصال</span>
                  </button>
                )}
              </div>
              {supPhoneNotice && (
                <p className="text-[10px] font-bold text-red-600 mt-0.5">{supPhoneNotice.text}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <input
                type="text"
                value={newSupAddress}
                onChange={(e) => setNewSupAddress(e.target.value)}
                placeholder="عنوان المورد"
                className="h-8 rounded-md border border-slate-300 px-2"
              />
              <input
                type="number"
                value={newSupOpening || ''}
                onChange={(e) => setNewSupOpening(Number(e.target.value))}
                placeholder={`رصيد افتتاحي (${data.settings.currency})`}
                className="h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
              />
            </div>

            <button
              type="submit"
              disabled={isSavingSupplier}
              className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isSavingSupplier ? 'جاري الحفظ...' : 'حفظ المورد الجديد'}
            </button>
          </form>
        );
      })()}

      {/* ==================== CHEQUES & INSTALLMENTS ==================== */}
      {activeTab === 'cheques-installments' && (
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-1 bg-white p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setChqTab('cheques')}
              className={`h-8 rounded-md font-black cursor-pointer ${
                chqTab === 'cheques' ? 'bg-[#003589] text-white' : 'text-slate-700'
              }`}
            >
              الشيكات ({data.cheques.length})
            </button>
            <button
              type="button"
              onClick={() => setChqTab('installments')}
              className={`h-8 rounded-md font-black cursor-pointer ${
                chqTab === 'installments' ? 'bg-[#003589] text-white' : 'text-slate-700'
              }`}
            >
              الأقساط ({data.installments.length})
            </button>
          </div>

          {chqTab === 'cheques' && (
            <div className="space-y-2">
              <form onSubmit={handleAddCheque} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                <h4 className="text-xs sm:text-sm font-black text-slate-900">تسجيل شيك جديد</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  <select
                    value={chqType}
                    onChange={(e) => setChqType(e.target.value as 'incoming' | 'outgoing')}
                    className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                  >
                    <option value="incoming">شيك وارد (تحصيل)</option>
                    <option value="outgoing">شيك صادر (سداد)</option>
                  </select>
                  <input
                    type="text"
                    value={chqNumber}
                    onChange={(e) => setChqNumber(e.target.value)}
                    placeholder="رقم الشيك"
                    className="h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
                  />
                  <input
                    type="text"
                    value={chqPartyName}
                    onChange={(e) => setChqPartyName(e.target.value)}
                    placeholder="اسم العميل / المورد"
                    className="h-8 rounded-md border border-slate-300 px-2 font-bold col-span-2 sm:col-span-1"
                  />
                  <input
                    type="text"
                    value={chqBank}
                    onChange={(e) => setChqBank(e.target.value)}
                    placeholder="اسم البنك"
                    className="h-8 rounded-md border border-slate-300 px-2"
                  />
                  <input
                    type="number"
                    min={1}
                    value={chqAmount || ''}
                    onChange={(e) => setChqAmount(Number(e.target.value))}
                    placeholder="المبلغ"
                    className="h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
                  />
                  <input
                    type="date"
                    value={chqDueDate}
                    onChange={(e) => setChqDueDate(e.target.value)}
                    className="h-8 rounded-md border border-slate-300 px-2 font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingCheque}
                  className="w-full h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer"
                >
                  {isSavingCheque ? 'جاري التسجيل...' : 'حفظ الشيك'}
                </button>
              </form>

              <UnifiedDataTable
                compact
                title={`الشيكات المسجلة (${data.cheques.length})`}
                data={data.cheques}
                rowKey={(chq) => chq.id}
                emptyTitle="لا توجد شيكات مسجلة"
                columns={[
                  { key: 'chequeNumber', header: 'رقم الشيك', render: (chq) => <span className="font-mono font-black text-blue-950">{chq.chequeNumber}</span> },
                  { key: 'partyName', header: 'الطرف / البنك', render: (chq) => `${chq.partyName} · ${chq.bankName}` },
                  { key: 'dueDate', header: 'الاستحقاق', align: 'center', render: (chq) => <span className="font-mono">{chq.dueDate}</span> },
                  {
                    key: 'amount',
                    header: 'المبلغ',
                    align: 'center',
                    render: (chq) => (
                      <strong className="font-mono font-black text-slate-900">
                        {chq.amount.toLocaleString()} {data.settings.currency}
                      </strong>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'الحالة',
                    align: 'center',
                    render: (chq) => (
                      <span className="font-bold text-slate-700">
                        {chq.status === 'collected' ? 'محصل' : chq.status === 'rejected' || chq.status === 'returned' ? 'مرتد / مرفوض' : 'قيد الانتظار'}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {chqTab === 'installments' && (
            <div className="space-y-2">
              <UnifiedDataTable
                compact
                title={`جداول الأقساط (${data.installments.length})`}
                data={data.installments}
                rowKey={(sched) => sched.id}
                emptyTitle="لا توجد جداول أقساط نشطة حالياً"
                columns={[
                  { key: 'scheduleNumber', header: 'رقم الجدول', render: (sched) => <span className="font-mono font-black text-blue-950">{sched.scheduleNumber}</span> },
                  { key: 'customerName', header: 'العميل', render: (sched) => <span className="font-bold">{sched.customerName}</span> },
                  {
                    key: 'remainingAmount',
                    header: 'المتبقي',
                    align: 'center',
                    render: (sched) => (
                      <strong className="font-mono text-red-700">
                        {sched.remainingAmount.toLocaleString()} {data.settings.currency}
                      </strong>
                    ),
                  },
                  {
                    key: 'actions',
                    header: 'تحصيل القسط المستحق',
                    render: (sched) => {
                      const nextDue = (sched.items || []).filter((it) => it.status !== 'paid').slice(0, 2);
                      if (nextDue.length === 0) return <span className="text-emerald-700 font-bold">مسدد بالكامل</span>;
                      return (
                        <div className="flex flex-wrap gap-1">
                          {nextDue.map((it) => {
                            const key = `${sched.id}:${it.id}`;
                            return (
                              <button
                                key={it.id}
                                type="button"
                                disabled={payingInstKey === key}
                                onClick={async () => {
                                  setPayingInstKey(key);
                                  await data.payInstallment(sched.id, it.id, it.amount - it.paidAmount, data.cashboxes[0]?.id || 'CASH-01', 'تحصيل قسط عبر تطبيق المندوب');
                                  setPayingInstKey(null);
                                  setFeedback({ type: 'success', text: 'تم تحصيل القسط وتحديث الجدول.' });
                                }}
                                className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                              >
                                {payingInstKey === key
                                  ? 'جاري التحصيل...'
                                  : `تحصيل (${(it.amount - it.paidAmount).toLocaleString()} · ${it.dueDate})`}
                              </button>
                            );
                          })}
                        </div>
                      );
                    },
                  },
                ]}
              />
            </div>
          )}
        </div>
      )}

      {/* ==================== PRICE QUOTES (عرض سعر - Zero Stock/Balance Impact) ==================== */}
      {activeTab === 'new-quote' && (
        <div className="space-y-2 text-xs">
          <form onSubmit={handleCreateQuote} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
            <div>
              <h3 className="text-xs sm:text-sm font-black text-blue-950">إنشاء عرض سعر (بدون خصم مخزني أو قيد مالي)</h3>
              <p className="text-[10px] text-slate-500">يمكن تحويل عرض السعر لاحقاً لفاتورة مبيعات معتمدة بضغطة واحدة.</p>
            </div>
            <select
              value={quoteCustomerId}
              onChange={(e) => setQuoteCustomerId(e.target.value)}
              className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="">-- اختر العميل (أو عميل عام) --</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.shopName || c.name}</option>
              ))}
            </select>

            <div className="p-2 rounded-md bg-blue-50/70 border border-blue-200 space-y-1.5">
              <select
                value={quoteProductId}
                onChange={(e) => handleSelectQuoteProduct(e.target.value)}
                className="w-full h-8 rounded-md border border-blue-300 px-2 font-bold bg-white"
              >
                <option value="">-- اختر الصنف لعرض السعر --</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sellingPrice} {data.settings.currency})</option>
                ))}
              </select>
              {quoteProductId && (
                <div className="grid grid-cols-3 gap-1.5">
                  <QuantityInput
                    allowDecimals
                    min={0.001}
                    value={quoteQty}
                    onChange={setQuoteQty}
                    ariaLabel="كمية عرض السعر"
                    inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={quotePrice}
                    onChange={(e) => setQuotePrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    placeholder="السعر"
                    className="h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddQuoteItem}
                    className="h-8 rounded-md bg-blue-900 text-white font-black cursor-pointer"
                  >
                    إضافة
                  </button>
                </div>
              )}
            </div>

            {quoteItems.length > 0 && (
              <UnifiedDataTable
                compact
                paginated={false}
                searchable={false}
                title={`أصناف عرض السعر (${quoteItems.length})`}
                data={quoteItems}
                rowKey={(it, idx) => `${it.productId}-${idx}`}
                columns={[
                  { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'quantity', header: 'الكمية', align: 'center', render: (it) => <span className="font-mono">{it.quantity}</span> },
                  { key: 'unitPrice', header: 'السعر', align: 'center', render: (it) => <span className="font-mono">{it.unitPrice.toLocaleString()}</span> },
                  { key: 'total', header: 'الإجمالي', align: 'center', render: (it) => <strong className="font-mono text-blue-950">{it.total.toLocaleString()}</strong> },
                ]}
              />
            )}

            <input
              type="text"
              value={quoteNotes}
              onChange={(e) => setQuoteNotes(e.target.value)}
              placeholder="صلاحية العرض وملاحظات..."
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />

            <button
              type="submit"
              disabled={isSubmittingQuote || quoteItems.length === 0}
              className="w-full h-9 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black disabled:opacity-50 cursor-pointer"
            >
              {isSubmittingQuote ? 'جاري الحفظ...' : `حفظ عرض السعر (${quoteTotal.toLocaleString()} ${data.settings.currency})`}
            </button>
          </form>

          {myQuotes.length > 0 && (
            <UnifiedDataTable
              compact
              title={`عروض الأسعار المسجلة (${myQuotes.length})`}
              data={myQuotes}
              rowKey={(q) => q.id}
              columns={[
                { key: 'invoiceNumber', header: 'رقم العرض', render: (q) => <span className="font-mono font-black text-blue-950">{q.invoiceNumber}</span> },
                { key: 'customerName', header: 'العميل', render: (q) => q.customerName || 'عميل عام' },
                { key: 'date', header: 'التاريخ', align: 'center', render: (q) => <span className="font-mono">{q.date}</span> },
                {
                  key: 'grandTotal',
                  header: 'الإجمالي',
                  align: 'center',
                  render: (q) => (
                    <strong className="font-mono font-black text-slate-900">
                      {q.grandTotal.toLocaleString()} {data.settings.currency}
                    </strong>
                  ),
                },
                {
                  key: 'actions',
                  header: 'الإجراءات',
                  align: 'center',
                  sortable: false,
                  render: (q) => {
                    const isConverted = myInvoices.some((inv) => inv.convertedFromQuoteId === q.id);
                    return (
                      <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={isConverted || convertingQuoteId === q.id}
                          onClick={() => handleConvertQuote(q.id)}
                          className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black disabled:opacity-50 cursor-pointer"
                        >
                          {isConverted ? 'تم التحويل' : convertingQuoteId === q.id ? 'جاري التحويل...' : 'تحويل لفاتورة'}
                        </button>
                        <button
                          type="button"
                          onClick={() => exportInvoiceDocument(q)}
                          className="px-2 py-0.5 rounded-md bg-blue-900 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileDown className="w-3 h-3" />
                          <span>PDF</span>
                        </button>
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        </div>
      )}

      {/* ==================== SALES INVOICES LIST (with needs_review badge) ==================== */}
      {activeTab === 'invoices' && (
        <UnifiedDataTable
          compact
          title={`فواتير المبيعات (${myInvoices.length})`}
          data={myInvoices}
          rowKey={(inv) => inv.id}
          emptyTitle="لا توجد فواتير مبيعات مسجلة حتى الآن"
          columns={[
            {
              key: 'invoiceNumber',
              header: 'رقم الفاتورة',
              render: (inv) => (
                <div>
                  <span className="font-mono font-black text-blue-950 block">{inv.invoiceNumber}</span>
                  {inv.syncStatus && inv.syncStatus !== 'synced' && (
                    <span className="inline-flex items-center gap-0.5 text-amber-800 font-bold text-[10px]">
                      <CloudOff className="w-3 h-3" />
                      <span>محلي</span>
                    </span>
                  )}
                </div>
              ),
            },
            { key: 'customerName', header: 'العميل', render: (inv) => <span className="font-bold">{inv.customerName || 'عميل'}</span> },
            { key: 'date', header: 'التاريخ', align: 'center', render: (inv) => <span className="font-mono">{inv.date}</span> },
            {
              key: 'grandTotal',
              header: 'الإجمالي',
              align: 'center',
              sortValue: (inv) => Number(inv.grandTotal || 0),
              render: (inv) => (
                <strong className="font-mono text-slate-900 tabular-nums">
                  {inv.grandTotal.toLocaleString()} {data.settings.currency}
                </strong>
              ),
            },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              render: (inv) => {
                const confirmCheck = inv.status === 'draft' ? canConfirmDraft(inv) : { ready: false };
                return (
                  <div className="space-y-0.5">
                    <span
                      className={`font-bold block ${
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
                      <span className="text-amber-700 font-bold text-[10px] block">بانتظار مراجعة الإدارة</span>
                    )}
                    {inv.reviewStatus === 'reviewed' && (
                      <span className="text-blue-800 font-bold text-[10px] block">تمت المراجعة</span>
                    )}
                    {inv.status === 'draft' && inv.linkedRepTransferNumber && (
                      <span className="text-[10px] text-blue-900 font-bold block">
                        تحويل: {inv.linkedRepTransferNumber}
                        {!confirmCheck.ready && confirmCheck.reason ? ` (${confirmCheck.reason})` : ''}
                      </span>
                    )}
                  </div>
                );
              },
            },
            {
              key: 'actions',
              header: 'الإجراءات',
              align: 'center',
              sortable: false,
              render: (inv) => {
                const confirmCheck = inv.status === 'draft' ? canConfirmDraft(inv) : { ready: false };
                return (
                  <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                    {inv.status === 'draft' && (
                      <button
                        type="button"
                        disabled={!confirmCheck.ready}
                        onClick={() => handleConfirmDraft(inv)}
                        className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black disabled:opacity-45 cursor-pointer"
                      >
                        اعتماد نهائي
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[11px] font-bold cursor-pointer"
                    >
                      التفاصيل
                    </button>
                    <button
                      type="button"
                      onClick={() => exportInvoiceDocument(inv)}
                      className="px-2 py-0.5 rounded-md bg-blue-900 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      {isNative ? <Share2 className="w-3 h-3" /> : <FileDown className="w-3 h-3" />}
                      <span>{isNative ? 'مشاركة' : 'PDF'}</span>
                    </button>
                  </div>
                );
              },
            },
          ]}
        />
      )}

      {/* ==================== PURCHASES LIST & DISPATCH TRACKING (FROM "المزيد") ==================== */}
      {activeTab === 'purchases-list' && (() => {
        const filteredPurchases = myPurchases.filter((inv) => {
          if (purListFilter === 'all') return true;
          return getPurchaseDispatchMeta(inv).key === purListFilter;
        });
        return (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-xs sm:text-sm font-black text-slate-900">فواتير الشراء ({filteredPurchases.length})</h3>
            <button
              type="button"
              onClick={() => {
                setPurEditingInvoiceId(null);
                onTabChange('new-purchase');
              }}
              className="h-8 px-2.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-bold cursor-pointer"
            >
              + فاتورة شراء
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {[
              { id: 'all' as const, label: 'الكل' },
              { id: 'draft' as const, label: 'مسودة' },
              { id: 'sent' as const, label: 'مرسلة' },
              { id: 'received' as const, label: 'تم الاستلام' },
              { id: 'rejected' as const, label: 'مرفوضة' },
              { id: 'confirmed' as const, label: 'معتمدة' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPurListFilter(tab.id)}
                className={`h-7 px-2 rounded-md text-[11px] font-bold border cursor-pointer ${
                  purListFilter === tab.id
                    ? 'bg-[#003589] text-white border-[#011E58]'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <UnifiedDataTable
            compact
            title={`جدول فواتير الشراء (${filteredPurchases.length})`}
            data={filteredPurchases}
            rowKey={(inv) => inv.id}
            emptyTitle="لا توجد فواتير مشتريات في هذا التصنيف"
            columns={[
              {
                key: 'invoiceNumber',
                header: 'رقم الفاتورة',
                render: (inv) => <span className="font-mono font-black text-[#011E58]">{inv.invoiceNumber}</span>,
              },
              {
                key: 'supplierName',
                header: 'المورد / المخزن',
                render: (inv) => (
                  <div>
                    <span className="font-bold text-slate-900 block">{inv.supplierName}</span>
                    <span className="text-[10px] text-slate-500">{inv.warehouseName} · {inv.date}</span>
                  </div>
                ),
              },
              {
                key: 'grandTotal',
                header: 'الإجمالي',
                align: 'center',
                sortValue: (inv) => Number(inv.grandTotal || 0),
                render: (inv) => {
                  const remainingVal = Math.max(0, Number(inv.remainingAmount || 0));
                  return (
                    <div className="whitespace-nowrap">
                      <strong className="font-mono text-slate-900 block">
                        {inv.grandTotal.toLocaleString()} {data.settings.currency}
                      </strong>
                      {inv.status === 'confirmed' && (
                        <span className={`text-[10px] font-bold block ${remainingVal > 0.009 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {remainingVal > 0.009 ? `متبقي: ${remainingVal.toLocaleString()}` : 'مسددة بالكامل'}
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'dispatchStatus',
                header: 'الحالة والاستلام',
                render: (inv) => {
                  const meta = getPurchaseDispatchMeta(inv);
                  return (
                    <div className="space-y-0.5 text-[11px]">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${meta.badgeClass}`}>
                        {meta.label}
                      </span>
                      {inv.recipientName && (
                        <span className="block text-slate-600">موجهة إلى: {inv.recipientName}</span>
                      )}
                      {inv.receivedBy && (
                        <span className="block text-sky-800 font-bold">
                          المستلم: {inv.receivedBy}
                        </span>
                      )}
                      {inv.dispatchStatus === 'rejected' && inv.rejectionReason && (
                        <span className="block text-rose-800 font-bold">سبب الرفض: {inv.rejectionReason}</span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'actions',
                header: 'الإجراءات',
                align: 'center',
                sortable: false,
                render: (inv) => {
                  const meta = getPurchaseDispatchMeta(inv);
                  const canSendOrEdit = inv.status === 'draft' && (meta.key === 'draft' || meta.key === 'rejected');
                  const remainingVal = Math.max(0, Number(inv.remainingAmount || 0));
                  const canRecordPurchasePayment =
                    canCreatePurchase &&
                    inv.status === 'confirmed' &&
                    remainingVal > 0.009 &&
                    (!isRepRoleAccount ||
                      (rep?.id && inv.representativeId === rep.id) ||
                      (currentUser?.id && inv.createdByUserId === currentUser.id) ||
                      (currentUser?.id && inv.sentByUserId === currentUser.id) ||
                      (!inv.createdByUserId &&
                        !inv.representativeId &&
                        !inv.sentByUserId &&
                        currentUser?.id &&
                        inv.createdBy === currentUser.id));
                  return (
                    <div className="flex flex-wrap items-center justify-center gap-1 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedPurchaseDetail(inv)}
                        className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-900 border border-blue-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3 h-3" />
                        <span>التفاصيل</span>
                      </button>
                      {canRecordPurchasePayment && (
                        <button
                          type="button"
                          onClick={() => openPurchasePaymentModal(inv)}
                          className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <CreditCard className="w-3 h-3" />
                          <span>سداد</span>
                        </button>
                      )}
                      {canSendOrEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setSendingPurchaseTarget(inv);
                              setSendingRecipientUserId(inv.recipientUserId || '');
                            }}
                            className="px-2 py-0.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Send className="w-3 h-3" />
                            <span>إرسال</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartEditPurchase(inv)}
                            className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit className="w-3 h-3" />
                            <span>تعديل</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setHistoryPurchaseTarget(inv)}
                        className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <History className="w-3 h-3" />
                        <span>السجل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => exportInvoiceDocument(inv)}
                        className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[11px] font-bold cursor-pointer"
                      >
                        PDF
                      </button>
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
        );
      })()}

      {activeTab === 'sales-returns-list' && (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-black text-rose-950">
                طلبات ومرتجعات البيع ({mySalesReturnRequests.length} طلب · {mySalesReturns.length} معتمد)
              </h3>
              <p className="text-[10px] text-slate-500">
                طلبات المرتجع النقدي تخضع لمراجعة الإدارة والخزينة قبل صرف أي مبالغ أو تعديل الأرصدة.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onTabChange('sales-return')}
              className="h-8 px-2.5 rounded-md bg-rose-700 text-white font-bold cursor-pointer shrink-0"
            >
              + مرتجع بيع
            </button>
          </div>

          {mySalesReturnRequests.length > 0 && (
            <UnifiedDataTable<SalesReturnRequest>
              compact
              title={`طلبات مرتجع المبيعات النقدي (${mySalesReturnRequests.length})`}
              data={mySalesReturnRequests}
              rowKey={(req) => req.id}
              columns={[
                {
                  key: 'requestNumber',
                  header: 'رقم الطلب',
                  render: (req) => (
                    <div>
                      <span className="font-mono font-black text-rose-900 block">{req.requestNumber}</span>
                      {req.syncStatus === 'pending' && (
                        <span className="text-[10px] font-bold text-slate-600">بانتظار المزامنة</span>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'customerName',
                  header: 'العميل / الفاتورة',
                  render: (req) => (
                    <div>
                      <span className="font-bold text-slate-900 block">{req.customerName}</span>
                      <span className="text-[10px] text-slate-500">فاتورة {req.originalInvoiceNumber} · {req.date}</span>
                    </div>
                  ),
                },
                {
                  key: 'grandTotal',
                  header: 'الإجمالي',
                  align: 'center',
                  render: (req) => (
                    <strong className="font-mono text-rose-800">
                      {Number(req.grandTotal || 0).toLocaleString()} {data.settings.currency}
                    </strong>
                  ),
                },
                {
                  key: 'status',
                  header: 'الحالة',
                  render: (req) => (
                    <div className="space-y-0.5 text-[11px]">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          req.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : req.status === 'rejected'
                            ? 'bg-rose-50 text-rose-800 border border-rose-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {req.status === 'approved' ? 'تم الاعتماد والتنفيذ' : req.status === 'rejected' ? 'مرفوض' : 'قيد مراجعة الخزينة/الإدارة'}
                      </span>
                      {req.reason && <span className="block text-slate-500">{req.reason}</span>}
                      {req.status === 'approved' && req.approvedReturnNumber && (
                        <span className="block font-bold text-emerald-800">مرتجع رقم: {req.approvedReturnNumber}</span>
                      )}
                      {req.status === 'rejected' && req.rejectionReason && (
                        <span className="block font-bold text-rose-800">الرفض: {req.rejectionReason}</span>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}

          <UnifiedDataTable<InvoiceReturn>
            compact
            title={`مرتجعات المبيعات المعتمدة (${mySalesReturns.length})`}
            data={mySalesReturns}
            rowKey={(r) => r.id}
            emptyTitle="لا توجد مرتجعات مبيعات معتمدة"
            columns={[
              { key: 'returnNumber', header: 'رقم المرتجع', render: (r) => <span className="font-mono font-black text-rose-900">{r.returnNumber}</span> },
              { key: 'partyName', header: 'العميل', render: (r) => r.partyName },
              { key: 'date', header: 'التاريخ', align: 'center', render: (r) => <span className="font-mono">{r.date}</span> },
              {
                key: 'grandTotal',
                header: 'الإجمالي',
                align: 'center',
                render: (r) => (
                  <strong className="font-mono text-rose-800">
                    {r.grandTotal.toLocaleString()} {data.settings.currency}
                  </strong>
                ),
              },
            ]}
          />
        </div>
      )}

      {activeTab === 'purchase-returns-list' && (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-black text-[#011E58]">
                طلبات ومرتجعات الشراء ({myPurchaseReturnRequests.length} طلب · {myPurchaseReturns.length} معتمد)
              </h3>
              <p className="text-[10px] text-slate-500">
                طلبات مرتجع الشراء تخضع لمراجعة واعتماد الإدارة قبل تعديل المخزون أو حساب المورد.
              </p>
            </div>
            {canCreatePurchase && (
              <button
                type="button"
                onClick={() => onTabChange('purchase-return')}
                className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer shrink-0"
              >
                {isRepRoleAccount ? '+ طلب مرتجع شراء' : '+ مرتجع شراء'}
              </button>
            )}
          </div>

          <UnifiedDataTable<PurchaseReturnRequest>
            compact
            title={`طلبات مرتجع المشتريات (${myPurchaseReturnRequests.length})`}
            data={myPurchaseReturnRequests}
            rowKey={(req) => req.id}
            emptyTitle="لا توجد طلبات مرتجع مشتريات مرسلة حالياً"
            columns={[
              {
                key: 'requestNumber',
                header: 'رقم الطلب',
                render: (req) => (
                  <div>
                    <span className="font-mono font-black text-[#011E58] block">{req.requestNumber}</span>
                    {req.syncStatus === 'pending' && (
                      <span className="text-[10px] font-bold text-slate-600">بانتظار المزامنة</span>
                    )}
                  </div>
                ),
              },
              {
                key: 'supplierName',
                header: 'المورد / الفاتورة',
                render: (req) => (
                  <div>
                    <span className="font-bold text-slate-900 block">{req.supplierName}</span>
                    <span className="text-[10px] text-slate-500">فاتورة {req.originalInvoiceNumber} · {req.date}</span>
                  </div>
                ),
              },
              {
                key: 'grandTotal',
                header: 'الإجمالي',
                align: 'center',
                render: (req) => (
                  <strong className="font-mono text-[#011E58]">
                    {Number(req.grandTotal || 0).toLocaleString()} {data.settings.currency}
                  </strong>
                ),
              },
              {
                key: 'status',
                header: 'الحالة',
                render: (req) => (
                  <div className="space-y-0.5 text-[11px]">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        req.status === 'approved'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : req.status === 'rejected'
                          ? 'bg-rose-50 text-rose-800 border border-rose-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {req.status === 'approved' ? 'تم الاعتماد والتنفيذ' : req.status === 'rejected' ? 'مرفوض' : 'قيد مراجعة الإدارة'}
                    </span>
                    {req.reason && <span className="block text-slate-500">{req.reason}</span>}
                    {req.status === 'approved' && req.approvedReturnNumber && (
                      <span className="block font-bold text-emerald-800">مرتجع رقم: {req.approvedReturnNumber}</span>
                    )}
                    {req.status === 'rejected' && req.rejectionReason && (
                      <span className="block font-bold text-rose-800">الرفض: {req.rejectionReason}</span>
                    )}
                  </div>
                ),
              },
            ]}
          />

          <UnifiedDataTable<InvoiceReturn>
            compact
            title={`مرتجعات المشتريات المعتمدة (${myPurchaseReturns.length})`}
            data={myPurchaseReturns}
            rowKey={(r) => r.id}
            emptyTitle="لا توجد مرتجعات مشتريات معتمدة"
            columns={[
              { key: 'returnNumber', header: 'رقم المرتجع', render: (r) => <span className="font-mono font-black text-[#011E58]">{r.returnNumber}</span> },
              {
                key: 'partyName',
                header: 'المورد',
                render: (r) => (
                  <span>
                    {r.partyName}
                    {r.originalInvoiceNumber ? ` · فاتورة ${r.originalInvoiceNumber}` : ''}
                  </span>
                ),
              },
              { key: 'date', header: 'التاريخ', align: 'center', render: (r) => <span className="font-mono">{r.date}</span> },
              {
                key: 'grandTotal',
                header: 'الإجمالي',
                align: 'center',
                render: (r) => (
                  <strong className="font-mono text-[#011E58]">
                    {r.grandTotal.toLocaleString()} {data.settings.currency}
                  </strong>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* ==================== CUSTODY & TRANSFERS ==================== */}
      {(activeTab === 'custody' || activeTab === 'custody-transfer') && (
        <div className="space-y-2">
          <div className="grid grid-cols-5 gap-1 bg-white p-1 rounded-lg border border-slate-200 text-[11px]">
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
                className={`h-8 rounded-md font-bold px-1 cursor-pointer truncate ${
                  custodySubTab === st.key ? 'bg-blue-900 text-white' : 'text-slate-600'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {custodySubTab === 'van' && (
            <div className="space-y-2 text-xs">
              {custodyStatement && (
                <div className="bg-slate-900 text-white rounded-lg p-2.5 space-y-1.5 tabular-nums">
                  <div className="flex items-center justify-between">
                    <h4 className="font-black text-xs">كشف عهدة السيارة التراكمي</h4>
                    <button
                      type="button"
                      onClick={loadCustodyStatement}
                      disabled={isLoadingCustodyStmt}
                      className="h-7 px-2 rounded-md bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingCustodyStmt ? 'animate-spin' : ''}`} />
                      <span>تحديث</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-700 border border-slate-700 rounded-md overflow-hidden text-center">
                    <div className="px-2 py-1.5 bg-slate-800">
                      <span className="text-[10px] text-slate-300 block">إجمالي المستلم</span>
                      <strong className="font-mono text-xs">{custodyStatement.totals.totalReceivedQty}</strong>
                    </div>
                    <div className="px-2 py-1.5 bg-slate-800">
                      <span className="text-[10px] text-slate-300 block">المسلم للعملاء</span>
                      <strong className="font-mono text-xs text-sky-300">{custodyStatement.totals.totalDeliveredQty}</strong>
                    </div>
                    <div className="px-2 py-1.5 bg-slate-800">
                      <span className="text-[10px] text-slate-300 block">المرتجع للمخزن</span>
                      <strong className="font-mono text-xs text-amber-300">{custodyStatement.totals.totalReturnedQty}</strong>
                    </div>
                    <div className="px-2 py-1.5 bg-[#003589]">
                      <span className="text-[10px] text-[#DCE6F5] block">المتبقي الفعلي</span>
                      <strong className="font-mono text-xs">{custodyStatement.totals.totalRemainingCustodyQty}</strong>
                    </div>
                    <div className="px-2 py-1.5 bg-blue-900 col-span-2 sm:col-span-1">
                      <span className="text-[10px] text-blue-200 block">القيمة بالتكلفة</span>
                      <strong className="font-mono text-xs">
                        {custodyStatement.totals.totalCustodyCostValue.toLocaleString()} {data.settings.currency}
                      </strong>
                    </div>
                  </div>
                  {custodyStatement.itemsSummary.length > 0 && (
                    <UnifiedDataTable
                      compact
                      paginated={false}
                      searchable={false}
                      title="تفاصيل حركة العهدة لكل صنف"
                      data={custodyStatement.itemsSummary}
                      rowKey={(item) => item.productId}
                      columns={[
                        { key: 'productName', header: 'الصنف', render: (item) => <span className="font-bold">{item.productName}</span> },
                        { key: 'receivedQty', header: 'مستلم', align: 'center', render: (item) => <span className="font-mono">{item.receivedQty}</span> },
                        { key: 'deliveredToCustomersQty', header: 'مباع', align: 'center', render: (item) => <span className="font-mono text-sky-700">{item.deliveredToCustomersQty}</span> },
                        { key: 'returnedToWarehouseQty', header: 'مرتجع', align: 'center', render: (item) => <span className="font-mono text-amber-700">{item.returnedToWarehouseQty}</span> },
                        { key: 'remainingCustodyQty', header: 'متبقي', align: 'center', render: (item) => <strong className="font-mono text-emerald-700">{item.remainingCustodyQty}</strong> },
                      ]}
                    />
                  )}
                </div>
              )}

              <UnifiedDataTable
                compact
                title={`أرصدة البضاعة الحالية في: ${vanWarehouse?.name || 'سيارة المندوب'}`}
                headerActions={
                  !custodyStatement ? (
                    <button
                      type="button"
                      onClick={loadCustodyStatement}
                      disabled={isLoadingCustodyStmt}
                      className="h-7 px-2.5 rounded-md bg-blue-50 text-blue-900 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCustodyStmt ? 'animate-spin' : ''}`} />
                      <span>كشف العهدة</span>
                    </button>
                  ) : undefined
                }
                data={activeProducts.filter((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) > 0)}
                rowKey={(p) => p.id}
                emptyTitle="لا توجد بضاعة متوفرة حالياً داخل مستودع السيارة"
                columns={[
                  { key: 'name', header: 'الصنف', render: (p) => <span className="font-bold text-slate-900">{p.name}</span> },
                  { key: 'category', header: 'التصنيف', render: (p) => <span className="text-slate-500">{p.category}</span> },
                  {
                    key: 'stock',
                    header: 'الكمية المتاحة',
                    align: 'center',
                    sortValue: (p) => Number(p.stockPerWarehouse?.[effectiveVanId] || 0),
                    render: (p) => (
                      <strong className="font-mono text-blue-950 tabular-nums">
                        {p.stockPerWarehouse?.[effectiveVanId] || 0} {p.baseUnit}
                      </strong>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {custodySubTab === 'deliver' && (
            <form
              onSubmit={handleRecordPartialCustodyDelivery}
              className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5 text-xs"
            >
              <h4 className="text-xs sm:text-sm font-black text-slate-900">تسليم جزئي من عهدة السيارة إلى عميل</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <select
                  value={delivCustomerId}
                  onChange={(e) => setDelivCustomerId(e.target.value)}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
                >
                  <option value="">-- اختر العميل المستلم (اختياري) --</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.shopName || c.name}</option>
                  ))}
                </select>
                <select
                  value={delivProdId}
                  onChange={(e) => setDelivProdId(e.target.value)}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
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
                  inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                />
                <input
                  type="text"
                  value={delivNotes}
                  onChange={(e) => setDelivNotes(e.target.value)}
                  placeholder="ملاحظات التسليم..."
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />
              </div>
              <button
                type="submit"
                disabled={isSendingTransfer}
                className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSendingTransfer ? 'جاري التسجيل...' : 'تأكيد تسليم العهدة'}
              </button>
            </form>
          )}

          {custodySubTab === 'return' && (
            <form
              onSubmit={handleRecordCustodyReturn}
              className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5 text-xs"
            >
              <h4 className="text-xs sm:text-sm font-black text-slate-900">إرجاع بضاعة من عهدة السيارة إلى المخزن</h4>
              <select
                value={retCustodyProdId}
                onChange={(e) => {
                  const pId = e.target.value;
                  setRetCustodyProdId(pId);
                  const prod = activeProducts.find((p) => p.id === pId);
                  setRetCustodyUnit(prod?.baseUnit || '');
                }}
                className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
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
                  <div className="grid grid-cols-2 gap-1.5">
                    <select
                      value={retCustodyUnit || retProd?.baseUnit || ''}
                      onChange={(e) => setRetCustodyUnit(e.target.value)}
                      disabled={!retProd}
                      className="h-8 rounded-md border border-slate-300 px-2 bg-white font-bold disabled:opacity-50"
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
                      inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <select
                  value={retCustodyTargetWhId}
                  onChange={(e) => setRetCustodyTargetWhId(e.target.value)}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
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
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />
              </div>

              <button
                type="submit"
                disabled={isSendingTransfer || !retCustodyProdId}
                className="w-full h-9 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSendingTransfer ? 'جاري تسجيل الإرجاع...' : 'تأكيد إرجاع البضاعة للمخزن'}
              </button>
            </form>
          )}

          {custodySubTab === 'items' && (
            <div className="space-y-2 text-xs">
              <form
                onSubmit={handleSendDirectItemTransfer}
                className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5"
              >
                <h4 className="text-xs sm:text-sm font-black text-slate-900">طلب تحويل أصناف من المخزن الرئيسي إلى السيارة</h4>
                <div className="flex gap-1.5">
                  <select
                    value={reqProdId}
                    onChange={(e) => setReqProdId(e.target.value)}
                    className="flex-1 h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
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
                    inputClassName="w-16 h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const prod = activeProducts.find((p) => p.id === reqProdId);
                      const rq = Number(reqQty || 0);
                      if (!prod || rq <= 0) return;
                      const vanQty = prod.stockPerWarehouse?.[effectiveVanId] || 0;
                      setReqItems((prev) => [
                        ...prev,
                        {
                          productId: prod.id,
                          productName: prod.name,
                          unit: prod.baseUnit,
                          requestedQty: rq,
                          availableInVanQty: vanQty,
                          shortageQty: Math.max(0, rq - vanQty),
                        },
                      ]);
                      setReqProdId('');
                      setReqQty('');
                    }}
                    className="h-8 px-2.5 rounded-md bg-blue-900 text-white font-bold cursor-pointer"
                  >
                    إضافة
                  </button>
                </div>

                {reqItems.length > 0 && (
                  <UnifiedDataTable
                    compact
                    paginated={false}
                    searchable={false}
                    title={`الأصناف المطلوبة للتحويل (${reqItems.length})`}
                    data={reqItems}
                    rowKey={(it, idx) => `${it.productId}-${idx}`}
                    columns={[
                      { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold">{it.productName}</span> },
                      {
                        key: 'requestedQty',
                        header: 'الكمية',
                        align: 'center',
                        render: (it) => <span className="font-mono">{it.requestedQty} {it.unit}</span>,
                      },
                      {
                        key: 'actions',
                        header: 'حذف',
                        align: 'center',
                        sortable: false,
                        render: (_it, idx) => (
                          <button
                            type="button"
                            onClick={() => setReqItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-red-600 font-bold px-2 cursor-pointer"
                          >
                            حذف
                          </button>
                        ),
                      },
                    ]}
                  />
                )}

                <button
                  type="submit"
                  disabled={isSendingTransfer || reqItems.length === 0}
                  className="w-full h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black disabled:opacity-50 cursor-pointer"
                >
                  {isSendingTransfer ? 'جاري الإرسال...' : 'إرسال طلب التحويل للإدارة'}
                </button>
              </form>

              <UnifiedDataTable
                compact
                title={`طلبات تحويل البضاعة (${myItemTransfers.length})`}
                data={myItemTransfers}
                rowKey={(tr) => tr.id}
                emptyTitle="لا توجد طلبات تحويل بضاعة مسجلة"
                columns={[
                  { key: 'requestNumber', header: 'رقم الطلب', render: (tr) => <span className="font-mono font-black text-blue-950">{tr.requestNumber}</span> },
                  {
                    key: 'items',
                    header: 'الأصناف',
                    render: (tr) => (
                      <div className="space-y-0.5 text-[11px] text-slate-700">
                        {tr.items.map((it, i) => (
                          <div key={i}>
                            {it.productName}: <span className="font-mono font-bold">{it.approvedQty ?? it.requestedQty} {it.unit}</span>
                          </div>
                        ))}
                      </div>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'الحالة',
                    align: 'center',
                    render: (tr) => (
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
                    ),
                  },
                  {
                    key: 'actions',
                    header: 'الإجراءات',
                    align: 'center',
                    sortable: false,
                    render: (tr) =>
                      tr.status === 'executed' ? (
                        <button
                          type="button"
                          onClick={() => handleConfirmItemReceived(tr.id, tr.requestNumber)}
                          className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black cursor-pointer whitespace-nowrap"
                        >
                          تأكيد استلام الأصناف فعلياً
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      ),
                  },
                ]}
              />
            </div>
          )}

          {custodySubTab === 'cash' && (
            <div className="space-y-2 text-xs">
              <form
                onSubmit={handleSendCashToOwner}
                className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5"
              >
                <h4 className="text-xs sm:text-sm font-black text-slate-900">توريد نقدية من المندوب إلى خزينة الفرع</h4>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={cashAmount || ''}
                    onChange={(e) => setCashAmount(Number(e.target.value))}
                    placeholder={`المبلغ (${data.settings.currency})`}
                    className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
                  />
                  <button
                    type="submit"
                    disabled={isSendingTransfer || cashAmount <= 0}
                    className="h-8 px-2.5 rounded-md bg-blue-900 text-white font-black disabled:opacity-50 cursor-pointer"
                  >
                    إرسال التوريد
                  </button>
                </div>
                <input
                  type="text"
                  value={cashNotes}
                  onChange={(e) => setCashNotes(e.target.value)}
                  placeholder="ملاحظات التوريد (اختياري)..."
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />
              </form>

              <UnifiedDataTable
                compact
                title={`التحويلات النقدية (${myCashTransfers.length})`}
                data={myCashTransfers}
                rowKey={(t) => t.id}
                emptyTitle="لا توجد تحويلات نقدية مسجلة"
                columns={[
                  { key: 'transferNumber', header: 'رقم التحويل', render: (t) => <span className="font-mono font-black text-blue-950">{t.transferNumber}</span> },
                  {
                    key: 'direction',
                    header: 'النوع',
                    render: (t) => (t.direction === 'rep_to_owner' ? 'توريد إلى الفرع' : 'عهدة واردة لك من الإدارة'),
                  },
                  {
                    key: 'amount',
                    header: 'المبلغ',
                    align: 'center',
                    render: (t) => (
                      <strong className="font-mono text-slate-900">
                        {t.amount.toLocaleString()} {data.settings.currency}
                      </strong>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'الحالة',
                    align: 'center',
                    render: (t) => (
                      <span className="font-bold text-slate-700">
                        {t.status === 'received'
                          ? 'تم الاستلام والتسوية'
                          : t.status === 'awaiting_receipt'
                          ? 'بانتظار تأكيد الاستلام'
                          : 'مرفوض'}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: 'الإجراءات',
                    align: 'center',
                    sortable: false,
                    render: (t) =>
                      t.status === 'awaiting_receipt' && t.direction === 'owner_to_rep' ? (
                        <button
                          type="button"
                          onClick={() => handleConfirmOwnerCash(t.id)}
                          className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black cursor-pointer whitespace-nowrap"
                        >
                          تأكيد استلام العهدة النقدية
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      ),
                  },
                ]}
              />
            </div>
          )}
        </div>
      )}

      {/* ==================== ORDERS & ASSIGNED DELIVERIES ==================== */}
      {activeTab === 'orders' && (
        <div className="space-y-2 text-xs">
          <div className="bg-white rounded-lg border border-[#DCE6F5] p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs sm:text-sm font-black text-[#011E58] flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-[#003589]" />
                <span>طلبات التسليم المعينة لك ({assignedDeliveryOrders.length})</span>
              </h3>
            </div>

            <UnifiedDataTable
              compact
              data={assignedDeliveryOrders}
              rowKey={(ord) => ord.id}
              emptyTitle="لا توجد طلبات توصيل معينة لك حالياً"
              columns={[
                {
                  key: 'requestNumber',
                  header: 'رقم الطلب',
                  render: (ord) => <span className="font-mono font-black text-blue-950">{ord.requestNumber}</span>,
                },
                {
                  key: 'customerName',
                  header: 'العميل والعنوان',
                  render: (ord) => (
                    <div>
                      <span className="font-bold text-slate-900 block">
                        {ord.shopName ? `${ord.shopName} (${ord.customerName})` : ord.customerName}
                      </span>
                      {ord.deliveryAddress && (
                        <span className="text-[10px] text-slate-600 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-red-600 shrink-0" />
                          <span>{ord.deliveryAddress}</span>
                        </span>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'total',
                  header: 'المبالغ',
                  render: (ord) => {
                    const total = Number(ord.invoiceTotal ?? ord.totalAmount ?? 0);
                    const adv = Number(ord.invoicePaidAmount ?? ord.advancePaidAmount ?? 0);
                    const remainingDue = Math.max(0, Number(ord.invoiceRemainingAmount ?? (total - adv)));
                    return (
                      <div className="font-mono text-[11px] whitespace-nowrap">
                        <div>الإجمالي: <strong>{total.toLocaleString()} {data.settings.currency}</strong></div>
                        <div className="text-emerald-700">مدفوع: {adv.toLocaleString()} · <span className="text-blue-950 font-black">متبقي: {remainingDue.toLocaleString()}</span></div>
                      </div>
                    );
                  },
                },
                {
                  key: 'status',
                  header: 'الحالة',
                  align: 'center',
                  render: (ord) => (
                    <span className="font-black text-[#011E58]">{REP_ORDER_STATUS_LABELS[ord.status] || ord.status}</span>
                  ),
                },
                {
                  key: 'actions',
                  header: 'الإجراءات',
                  align: 'center',
                  sortable: false,
                  render: (ord) => (
                    <div className="flex flex-wrap items-center justify-center gap-1 whitespace-nowrap">
                      {ord.customerPhone && (
                        <a
                          href={`tel:${ord.customerPhone}`}
                          className="px-2 py-0.5 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3 text-[#003589]" />
                          <span>اتصال</span>
                        </a>
                      )}
                      {(ord.deliveryAddress || ord.geoCoordinates) && (
                        <button
                          type="button"
                          onClick={() =>
                            setLocationViewerData({
                              customerName: ord.customerName,
                              shopName: ord.shopName,
                              address: ord.deliveryAddress,
                              geoCoordinates: ord.geoCoordinates,
                            })
                          }
                          className="px-2 py-0.5 rounded-md bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <MapPin className="w-3 h-3 text-[#003589]" />
                          <span>الموقع</span>
                        </button>
                      )}
                      {(ord.status === 'rep_assigned' || ord.status === 'preparing' || ord.status === 'invoiced') && (
                        <button
                          type="button"
                          disabled={isUpdatingDelivery}
                          onClick={() => handleStartDelivery(ord)}
                          className="px-2 py-0.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white text-[11px] font-black cursor-pointer disabled:opacity-50"
                        >
                          بدء التوصيل
                        </button>
                      )}
                      {(ord.status === 'rep_assigned' || ord.status === 'out_for_delivery' || ord.status === 'preparing') && (
                        <button
                          type="button"
                          disabled={isUpdatingDelivery}
                          onClick={() => handleOpenDeliverModal(ord)}
                          className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black cursor-pointer disabled:opacity-50"
                        >
                          تم التسليم
                        </button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>

          <form
            onSubmit={handleSubmitRepOrder}
            className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5"
          >
            <h3 className="text-xs sm:text-sm font-black text-slate-900">إرسال طلب شراء للإدارة</h3>
            <select
              value={ordCustomerId}
              onChange={(e) => setOrdCustomerId(e.target.value)}
              className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="">-- اختر العميل --</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.shopName ? `${c.shopName} (${c.name})` : c.name}
                </option>
              ))}
            </select>

            <div className="p-2 rounded-md bg-blue-50/60 border border-blue-200 space-y-1.5">
              <select
                value={ordProductId}
                onChange={(e) => handleSelectOrderProduct(e.target.value)}
                className="w-full h-8 rounded-md border border-blue-300 px-2 font-bold bg-white"
              >
                <option value="">-- اختر الصنف للطلب --</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.baseUnit})</option>
                ))}
              </select>

              {selectedOrderProduct && (
                <div className="grid grid-cols-4 gap-1.5">
                  <select
                    value={ordUnitName}
                    onChange={(e) => handleOrderUnitChange(e.target.value)}
                    className="w-full h-8 rounded-md border border-slate-300 px-1.5 bg-white font-bold"
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
                    inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    value={ordPrice || ''}
                    onChange={(e) => setOrdPrice(Math.max(0, Number(e.target.value)))}
                    placeholder="السعر"
                    className="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddOrderItem}
                    className="h-8 rounded-md bg-blue-900 text-white font-black flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة</span>
                  </button>
                </div>
              )}
            </div>

            {ordItems.length > 0 && (
              <UnifiedDataTable
                compact
                paginated={false}
                searchable={false}
                title={`أصناف الطلب (${ordItems.length})`}
                data={ordItems}
                rowKey={(it, idx) => `${it.productId}-${it.unit}-${idx}`}
                columns={[
                  { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold text-slate-900">{it.productName}</span> },
                  { key: 'quantity', header: 'الكمية', align: 'center', render: (it) => <span className="font-mono">{it.quantity} {it.unit}</span> },
                  {
                    key: 'actions',
                    header: 'حذف',
                    align: 'center',
                    sortable: false,
                    render: (_it, idx) => (
                      <button
                        type="button"
                        onClick={() => setOrdItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="h-7 w-7 rounded-md hover:bg-red-50 inline-flex items-center justify-center text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ),
                  },
                ]}
              />
            )}

            <input
              type="text"
              value={ordNotes}
              onChange={(e) => setOrdNotes(e.target.value)}
              placeholder="ملاحظات الطلب..."
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />

            <button
              type="submit"
              disabled={isSubmittingOrder || !ordItems.length}
              className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black disabled:opacity-50 cursor-pointer"
            >
              {isSubmittingOrder ? 'جاري الإرسال...' : 'إرسال الطلب للإدارة'}
            </button>
          </form>

          {mySubmittedOrders.length > 0 && (
            <UnifiedDataTable
              compact
              title={`طلباتي المرسلة (${mySubmittedOrders.length})`}
              data={mySubmittedOrders}
              rowKey={(ord) => ord.id}
              columns={[
                { key: 'requestNumber', header: 'رقم الطلب', render: (ord) => <span className="font-mono font-black text-blue-950">{ord.requestNumber}</span> },
                { key: 'customerName', header: 'العميل', render: (ord) => ord.customerName },
                { key: 'itemsCount', header: 'الأصناف', align: 'center', render: (ord) => <span className="font-mono">{ord.items?.length || 0} أصناف</span> },
                {
                  key: 'status',
                  header: 'الحالة',
                  align: 'center',
                  render: (ord) => <span className="font-bold text-[#003589]">{REP_ORDER_STATUS_LABELS[ord.status] || ord.status}</span>,
                },
              ]}
            />
          )}
        </div>
      )}

      {/* ==================== SUPPLIERS LIST & STATEMENT (FOR PERMITTED REPS) ==================== */}
      {activeTab === 'suppliers' && (
        !canCreatePurchase ? (
          <div className="bg-white rounded-lg border border-red-200 p-2.5 text-center space-y-1.5 text-xs">
            <ShieldAlert className="w-6 h-6 text-red-600 mx-auto" />
            <p className="font-black text-red-800">صلاحيات حسابك لا تسمح بعرض الموردين أو كشوف حساباتهم.</p>
            <button
              type="button"
              onClick={() => onTabChange('home')}
              className="h-8 px-3 rounded-md bg-slate-100 font-bold text-slate-800 cursor-pointer"
            >
              العودة للرئيسية
            </button>
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-5 h-5 text-[#003589] shrink-0" />
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-black text-slate-900">الموردون وكشوف الحسابات ({data.suppliers.length})</h3>
                    <p className="text-[10px] text-slate-500 truncate">
                      الرصيد المالي عام للشركة، وكشف الحساب يعرض فواتيرك ومرتجعاتك فقط.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onTabChange('new-supplier')}
                  className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                >
                  + مورد جديد
                </button>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2" />
                <input
                  type="text"
                  value={supSearch}
                  onChange={(e) => setSupSearch(e.target.value)}
                  placeholder="ابحث باسم المورد أو الشركة أو الكود أو التليفون..."
                  className="w-full h-8 rounded-md border border-slate-300 pr-7 pl-2 font-semibold"
                />
              </div>
            </div>

            {(() => {
              const q = supSearch.trim().toLowerCase();
              const filteredSuppliers = data.suppliers.filter((s) => {
                if (!q) return true;
                return (
                  s.name.toLowerCase().includes(q) ||
                  (s.companyName && s.companyName.toLowerCase().includes(q)) ||
                  (s.code && s.code.toLowerCase().includes(q)) ||
                  (s.phone && s.phone.includes(q))
                );
              });
              return (
                <UnifiedDataTable<Supplier>
                  compact
                  searchable={false}
                  title={`جدول الموردين (${filteredSuppliers.length})`}
                  data={filteredSuppliers}
                  rowKey={(sup) => sup.id}
                  emptyTitle="لا توجد بيانات موردين مطابقة للبحث"
                  columns={[
                    {
                      key: 'name',
                      header: 'المورد / الشركة',
                      render: (sup) => (
                        <div>
                          <span className="font-black text-slate-900 block">{sup.name}</span>
                          <span className="text-[10px] text-slate-500">
                            {sup.companyName ? `${sup.companyName} · ` : ''}
                            <span className="font-mono">{sup.code}</span>
                            {sup.phone ? ` · ${sup.phone}` : ''}
                          </span>
                        </div>
                      ),
                    },
                    {
                      key: 'currentBalance',
                      header: 'الرصيد العام',
                      align: 'center',
                      sortValue: (sup) => Number(sup.currentBalance || 0),
                      render: (sup) => {
                        const bal = Number(sup.currentBalance || 0);
                        return (
                          <div className="whitespace-nowrap">
                            <strong className={`font-mono tabular-nums block ${bal > 0.009 ? 'text-rose-800' : bal < -0.009 ? 'text-emerald-800' : 'text-slate-700'}`}>
                              {Math.abs(bal).toLocaleString()} {data.settings.currency}
                            </strong>
                            <span className="text-[10px] text-slate-500">
                              {bal > 0.009 ? 'علينا' : bal < -0.009 ? 'لنا' : 'متوازن'}
                            </span>
                          </div>
                        );
                      },
                    },
                    {
                      key: 'actions',
                      header: 'الإجراءات',
                      align: 'center',
                      sortable: false,
                      render: (sup) => (
                        <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedSupplierDetail(sup)}
                            className="px-2 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[11px] font-black cursor-pointer"
                          >
                            كشف حساب
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPurSupplierId(sup.id);
                              setPurEditingInvoiceId(null);
                              onTabChange('new-purchase');
                            }}
                            className="px-2 py-0.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white text-[11px] font-black cursor-pointer"
                          >
                            + فاتورة شراء
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              );
            })()}
          </div>
        )
      )}

      {/* ==================== DEDICATED REP REPORTS (تقارير المندوب) ==================== */}
      {activeTab === 'rep-reports' && (
        <div className="space-y-2 text-xs">
          <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="w-5 h-5 text-blue-900 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-black text-slate-900">تقارير المندوب التفصيلية</h3>
                  <p className="text-[10px] text-slate-500 truncate">
                    {repReportData?.scope?.accountBalanceNote ||
                      'الأرصدة عامة للشركة، وإحصائيات الفواتير والتحصيلات تخص هذا المندوب فقط.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowReportFilters((v) => !v)}
                  className={`h-8 px-2.5 rounded-md border font-bold inline-flex items-center gap-1 cursor-pointer ${
                    showReportFilters
                      ? 'bg-blue-900 text-white border-blue-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>فلاتر</span>
                  {showReportFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  disabled={isLoadingRepReport}
                  onClick={loadRepSummaryReport}
                  className="h-8 px-2.5 rounded-md bg-blue-900 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRepReport ? 'animate-spin' : ''}`} />
                  <span>تحديث</span>
                </button>
              </div>
            </div>

            {repReportIsOfflineFallback && (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
                يتم العرض حالياً من البيانات المحفوظة محلياً (وضع عدم الاتصال أو تعذر الوصول للخادم).
              </div>
            )}
            {repReportError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-700 font-bold text-[11px]">
                {repReportError}
              </div>
            )}

            {/* Collapsible Compact Filters Grid */}
            {showReportFilters && (
              <div className="pt-1.5 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">من تاريخ</label>
                  <input
                    type="date"
                    value={rptDateFrom}
                    onChange={(e) => {
                      setRptDateFrom(e.target.value);
                      setRptPage(1);
                    }}
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">إلى تاريخ</label>
                  <input
                    type="date"
                    value={rptDateTo}
                    onChange={(e) => {
                      setRptDateTo(e.target.value);
                      setRptPage(1);
                    }}
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono bg-white"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">رقم المستند</label>
                  <input
                    type="text"
                    value={rptInvoiceNumber}
                    onChange={(e) => {
                      setRptInvoiceNumber(e.target.value);
                      setRptPage(1);
                    }}
                    placeholder="رقم الفاتورة..."
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono bg-white"
                  />
                </div>
                <div>
                  <SearchableFilterSelect
                    id="rep-rpt-optype"
                    label="نوع العملية"
                    value={rptOpType}
                    onChange={(val) => {
                      setRptOpType((val as any) || 'all');
                      setRptPage(1);
                    }}
                    options={[
                      { value: 'sales', label: 'فواتير البيع' },
                      ...(canCreatePurchase ? [{ value: 'purchase', label: 'فواتير الشراء' }] : []),
                      { value: 'sales_return', label: 'مرتجعات البيع' },
                      ...(canCreatePurchase
                        ? [
                            { value: 'purchase_return', label: 'مرتجعات الشراء' },
                            { value: 'purchase_return_request', label: 'طلبات مرتجع الشراء' },
                          ]
                        : []),
                    ]}
                    allOptionLabel="جميع العمليات"
                    allOptionValue="all"
                    buttonClassName="h-8 rounded-md"
                  />
                </div>
                <div className="col-span-2">
                  <SearchableFilterSelect
                    id="rep-rpt-party"
                    label={canCreatePurchase ? 'العميل / المورد' : 'العميل'}
                    value={rptPartyKey}
                    onChange={(val) => {
                      setRptPartyKey(val);
                      setRptPage(1);
                    }}
                    options={[
                      ...data.customers.map<SearchableFilterOption>((c) => ({
                        value: `customer:${c.id}`,
                        label: c.shopName || c.name,
                        subtitle: c.phone || c.name,
                        badge: 'عميل',
                        groupLabel: 'العملاء',
                        searchText: `${c.name} ${c.shopName || ''} ${c.phone || ''}`,
                      })),
                      ...(canCreatePurchase
                        ? data.suppliers.map<SearchableFilterOption>((s) => ({
                            value: `supplier:${s.id}`,
                            label: s.name,
                            subtitle: s.phone || s.companyName,
                            badge: 'مورد',
                            groupLabel: 'الموردون',
                            searchText: `${s.name} ${s.companyName || ''} ${s.phone || ''}`,
                          }))
                        : []),
                    ]}
                    allOptionLabel={canCreatePurchase ? 'كل العملاء والموردين' : 'كل العملاء'}
                    allOptionValue="all"
                    searchPlaceholder="ابحث باسم العميل أو المحل أو المورد..."
                    allowClear
                    buttonClassName="h-8 rounded-md"
                  />
                </div>
                <div className="col-span-2">
                  <SearchableFilterSelect
                    id="rep-rpt-product"
                    label="الصنف"
                    value={rptProductId || 'all'}
                    onChange={(val) => {
                      setRptProductId(val === 'all' ? '' : val);
                      setRptPage(1);
                    }}
                    options={activeProducts.map<SearchableFilterOption>((p) => ({
                      value: p.id,
                      label: p.name,
                      subtitle: [p.code, p.barcode].filter(Boolean).join(' • '),
                      badge: p.code || undefined,
                      searchText: `${p.code || ''} ${p.barcode || ''} ${p.category || ''}`,
                    }))}
                    allOptionLabel="كل الأصناف"
                    allOptionValue="all"
                    searchPlaceholder="ابحث باسم الصنف أو الكود أو الباركود..."
                    allowClear
                    buttonClassName="h-8 rounded-md"
                  />
                </div>
                <div>
                  <SearchableFilterSelect
                    id="rep-rpt-payment-status"
                    label="حالة السداد"
                    value={rptPaymentStatus}
                    onChange={(val) => {
                      setRptPaymentStatus((val as any) || 'all');
                      setRptPage(1);
                    }}
                    options={[
                      { value: 'paid', label: 'مسددة بالكامل' },
                      { value: 'partial', label: 'مسددة جزئياً' },
                      { value: 'credit', label: 'آجل بالكامل' },
                    ]}
                    allOptionLabel="الكل"
                    allOptionValue="all"
                    buttonClassName="h-8 rounded-md"
                  />
                </div>
                <div>
                  <SearchableFilterSelect
                    id="rep-rpt-invoice-status"
                    label="حالة الفاتورة"
                    value={rptInvoiceStatus}
                    onChange={(val) => {
                      setRptInvoiceStatus((val as any) || 'all');
                      setRptPage(1);
                    }}
                    options={[
                      { value: 'confirmed', label: 'معتمدة' },
                      { value: 'draft', label: 'مسودة / بانتظار المراجعة' },
                      { value: 'cancelled', label: 'ملغاة' },
                    ]}
                    allOptionLabel="الكل"
                    allOptionValue="all"
                    buttonClassName="h-8 rounded-md"
                  />
                </div>
                <div className="col-span-2 flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setRptDateFrom('');
                      setRptDateTo('');
                      setRptPartyKey('all');
                      setRptProductId('');
                      setRptInvoiceNumber('');
                      setRptOpType('all');
                      setRptPaymentStatus('all');
                      setRptInvoiceStatus('all');
                      setRptPage(1);
                    }}
                    className="w-full h-8 px-2 rounded-md border border-slate-300 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 text-slate-700 font-bold text-[11px] flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>إعادة ضبط الفلاتر</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {repReportData && (
            <>
              {/* Hairline-Divided KPI Ledger Strip (Zero Profit / Zero Cost / Zero Cashbox Balances) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden tabular-nums">
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">مبيعات المندوب ({repReportData.summary.salesCount})</span>
                  <strong className="font-mono text-xs text-blue-950">
                    {repReportData.summary.salesTotal.toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">مرتجعات البيع ({repReportData.summary.salesReturnsCount})</span>
                  <strong className="font-mono text-xs text-rose-800">
                    {repReportData.summary.salesReturnsTotal.toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">صافي البيع</span>
                  <strong className="font-mono text-xs text-emerald-800">
                    {repReportData.summary.netSalesTotal.toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">المحصل ({repReportData.summary.collectionsCount})</span>
                  <strong className="font-mono text-xs text-emerald-900">
                    {repReportData.summary.collectionsTotal.toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">الآجل المتبقي</span>
                  <strong className="font-mono text-xs text-amber-800">
                    {repReportData.summary.salesRemaining.toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
                {!isRepRoleAccount && typeof repReportData.summary.totalCustomerReceivables === 'number' && (
                  <div className="bg-white px-2 py-1.5">
                    <span className="text-[10px] text-slate-500 block">أرصدة العملاء (عام)</span>
                    <strong className="font-mono text-xs text-slate-900">
                      {repReportData.summary.totalCustomerReceivables.toLocaleString()} {data.settings.currency}
                    </strong>
                  </div>
                )}
                {canCreatePurchase && (
                  <>
                    <div className="bg-white px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">مشتريات المندوب ({repReportData.summary.purchasesCount})</span>
                      <strong className="font-mono text-xs text-[#011E58]">
                        {repReportData.summary.purchasesTotal.toLocaleString()} {data.settings.currency}
                      </strong>
                    </div>
                    <div className="bg-white px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">المدفوع للمشتريات</span>
                      <strong className="font-mono text-xs text-emerald-800">
                        {repReportData.summary.purchasesPaid.toLocaleString()} {data.settings.currency}
                      </strong>
                    </div>
                    <div className="bg-white px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">متبقي المشتريات</span>
                      <strong className="font-mono text-xs text-amber-800">
                        {repReportData.summary.purchasesRemaining.toLocaleString()} {data.settings.currency}
                      </strong>
                    </div>
                    <div className="bg-white px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">طلبات مرتجع شراء</span>
                      <strong className="font-mono text-xs text-amber-900">
                        {repReportData.summary.purchaseReturnRequestsCount ?? 0} ({repReportData.summary.pendingPurchaseReturnRequestsCount ?? 0} قيد المراجعة)
                      </strong>
                    </div>
                  </>
                )}
              </div>

              {/* Sub-view Switcher */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-white p-1 rounded-lg border border-slate-200">
                {[
                  { id: 'summary' as const, label: 'أرصدة العملاء والموردين' },
                  { id: 'invoices' as const, label: `الفواتير (${repReportData.invoices.length})` },
                  { id: 'items' as const, label: `الأصناف (${repReportData.itemRows.length})` },
                  { id: 'collections' as const, label: `التحصيلات (${repReportData.collections.length})` },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRptSubView(tab.id)}
                    className={`h-8 rounded-md text-[11px] font-black cursor-pointer ${
                      rptSubView === tab.id ? 'bg-blue-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Sub-view 1: Account Summary & Balances */}
              {rptSubView === 'summary' && (
                <div className="space-y-2">
                  <UnifiedDataTable
                    compact
                    paginated={false}
                    searchable={false}
                    title={`ملخص العملاء (${repReportData.customersSummary.length})`}
                    data={repReportData.customersSummary}
                    rowKey={(cs) => cs.id}
                    emptyTitle="لا توجد بيانات عملاء مطابقة"
                    columns={[
                      {
                        key: 'name',
                        header: 'العميل / المحل',
                        render: (cs) => <span className="font-black text-slate-900">{cs.shopName || cs.name}</span>,
                      },
                      {
                        key: 'repSalesTotal',
                        header: 'مبيعاتك',
                        align: 'center',
                        render: (cs) => (
                          <span className="font-mono">
                            {cs.repSalesTotal.toLocaleString()} ({cs.repSalesCount})
                          </span>
                        ),
                      },
                      {
                        key: 'repCollectionsTotal',
                        header: 'تحصيلاتك',
                        align: 'center',
                        render: (cs) => <span className="font-mono text-emerald-700">{cs.repCollectionsTotal.toLocaleString()}</span>,
                      },
                      {
                        key: 'companyBalance',
                        header: 'الرصيد العام',
                        align: 'center',
                        render: (cs) => (
                          <span className={`font-mono font-black ${cs.companyBalance > 0.009 ? 'text-red-700' : cs.companyBalance < -0.009 ? 'text-emerald-700' : 'text-slate-600'}`}>
                            {Math.abs(cs.companyBalance).toLocaleString()} ({cs.companyBalance > 0.009 ? 'لنا' : cs.companyBalance < -0.009 ? 'علينا' : 'متوازن'})
                          </span>
                        ),
                      },
                      {
                        key: 'actions',
                        header: 'كشف الحساب',
                        align: 'center',
                        sortable: false,
                        render: (cs) => (
                          <button
                            type="button"
                            onClick={() => {
                              const cust = data.customers.find((c) => c.id === cs.id);
                              if (cust) {
                                setSelectedCustomerDetail(cust);
                                setCustomerDetailSubTab('statement');
                              }
                            }}
                            className="px-2 py-0.5 rounded-md text-[11px] bg-blue-50 text-blue-900 border border-blue-200 font-bold cursor-pointer whitespace-nowrap"
                          >
                            كشف الحساب
                          </button>
                        ),
                      },
                    ]}
                  />

                  {canCreatePurchase && (
                    <UnifiedDataTable
                      compact
                      paginated={false}
                      searchable={false}
                      title={`ملخص الموردين (${repReportData.suppliersSummary.length})`}
                      data={repReportData.suppliersSummary}
                      rowKey={(ss) => ss.id}
                      emptyTitle="لا توجد بيانات موردين مطابقة"
                      columns={[
                        { key: 'name', header: 'المورد', render: (ss) => <span className="font-black text-slate-900">{ss.name}</span> },
                        {
                          key: 'repPurchasesTotal',
                          header: 'مشترياتك',
                          align: 'center',
                          render: (ss) => (
                            <span className="font-mono">
                              {ss.repPurchasesTotal.toLocaleString()} ({ss.repPurchasesCount})
                            </span>
                          ),
                        },
                        {
                          key: 'repPaidTotal',
                          header: 'المدفوع',
                          align: 'center',
                          render: (ss) => <span className="font-mono text-emerald-700">{ss.repPaidTotal.toLocaleString()}</span>,
                        },
                        {
                          key: 'companyBalance',
                          header: 'الرصيد العام',
                          align: 'center',
                          render: (ss) => (
                            <span className={`font-mono font-black ${ss.companyBalance > 0.009 ? 'text-rose-700' : ss.companyBalance < -0.009 ? 'text-emerald-700' : 'text-slate-600'}`}>
                              {Math.abs(ss.companyBalance).toLocaleString()} ({ss.companyBalance > 0.009 ? 'علينا' : ss.companyBalance < -0.009 ? 'لنا' : 'متوازن'})
                            </span>
                          ),
                        },
                        {
                          key: 'actions',
                          header: 'كشف الحساب',
                          align: 'center',
                          sortable: false,
                          render: (ss) => (
                            <button
                              type="button"
                              onClick={() => {
                                const sup = data.suppliers.find((s) => s.id === ss.id);
                                if (sup) setSelectedSupplierDetail(sup);
                              }}
                              className="px-2 py-0.5 rounded-md text-[11px] bg-indigo-50 text-indigo-900 border border-indigo-200 font-bold cursor-pointer whitespace-nowrap"
                            >
                              كشف الحساب
                            </button>
                          ),
                        },
                      ]}
                    />
                  )}
                </div>
              )}

              {/* Sub-view 2: Invoices Table */}
              {rptSubView === 'invoices' && (
                <UnifiedDataTable
                  compact
                  paginated={false}
                  searchable={false}
                  title={`الفواتير (${repReportData.invoices.length})`}
                  data={repReportData.invoices}
                  rowKey={(row) => row.id}
                  emptyTitle="لا توجد فواتير مطابقة للفلاتر المحددة"
                  columns={[
                    { key: 'invoiceNumber', header: 'رقم الفاتورة', render: (row) => <span className="font-mono font-black text-blue-950">{row.invoiceNumber}</span> },
                    {
                      key: 'type',
                      header: 'النوع',
                      align: 'center',
                      render: (row) => (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${row.type === 'purchase' ? 'bg-indigo-50 text-indigo-900' : row.type === 'quote' ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-900'}`}>
                          {row.type === 'purchase' ? 'فاتورة شراء' : row.type === 'quote' ? 'عرض سعر' : 'فاتورة بيع'}
                        </span>
                      ),
                    },
                    {
                      key: 'partyName',
                      header: 'الطرف',
                      render: (row) => (
                        <div>
                          <span className="font-bold text-slate-900 block">{row.partyName}</span>
                          <span className="text-[10px] text-slate-500">{row.date} · {row.itemsCount} أصناف</span>
                        </div>
                      ),
                    },
                    {
                      key: 'grandTotal',
                      header: 'الإجمالي',
                      align: 'center',
                      render: (row) => (
                        <div className="whitespace-nowrap">
                          <strong className="font-mono text-slate-900 block">{row.grandTotal.toLocaleString()} {data.settings.currency}</strong>
                          {row.remainingAmount > 0.009 && (
                            <span className="text-[10px] text-amber-800 font-bold">متبقي: {row.remainingAmount.toLocaleString()}</span>
                          )}
                        </div>
                      ),
                    },
                    {
                      key: 'paymentStatus',
                      header: 'السداد',
                      align: 'center',
                      render: (row) => (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${row.paymentStatus === 'paid' ? 'bg-emerald-50 text-emerald-800' : row.paymentStatus === 'partial' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
                          {row.paymentStatus === 'paid' ? 'مدفوعة' : row.paymentStatus === 'partial' ? 'جزئي' : 'آجل'}
                        </span>
                      ),
                    },
                    {
                      key: 'actions',
                      header: 'الإجراءات',
                      align: 'center',
                      sortable: false,
                      render: (row) => {
                        const existingInv = (data.invoices || []).find((i) => i.id === row.id);
                        const fallbackInv: Invoice = existingInv || {
                          id: row.id,
                          invoiceNumber: row.invoiceNumber,
                          date: row.date,
                          type: row.type,
                          customerId: row.type === 'sales' ? row.partyId : undefined,
                          customerName: row.type === 'sales' ? row.partyName : undefined,
                          supplierId: row.type === 'purchase' ? row.partyId : undefined,
                          supplierName: row.type === 'purchase' ? row.partyName : undefined,
                          warehouseId: row.warehouseId || '',
                          warehouseName: row.warehouseName,
                          representativeId: row.representativeId,
                          representativeName: row.representativeName,
                          items: (row.items || []).map((it) => ({
                            productId: it.productId,
                            productName: it.productName,
                            barcode: it.barcode || '',
                            unit: it.unit,
                            unitFactor: it.unitFactor,
                            quantity: it.quantity,
                            unitPrice: it.unitPrice,
                            purchasePriceAtTime: 0,
                            discount: it.discount,
                            total: it.total,
                          })),
                          subtotal: row.grandTotal,
                          discountTotal: 0,
                          taxTotal: 0,
                          grandTotal: row.grandTotal,
                          paidAmount: row.paidAmount,
                          remainingAmount: row.remainingAmount,
                          paymentType: row.paymentStatus === 'paid' ? 'cash' : row.paymentStatus === 'partial' ? 'partial' : 'credit',
                          paymentMethod: 'cash',
                          cashboxId: '',
                          status: (row.status as any) || 'confirmed',
                          dispatchStatus: row.dispatchStatus as any,
                          notes: row.notes,
                          createdBy: currentUser?.fullName || '',
                          createdAt: row.date,
                        };
                        return (
                          <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                if (row.type === 'purchase') setSelectedPurchaseDetail(fallbackInv);
                                else setSelectedInvoice(fallbackInv);
                              }}
                              className="px-2 py-0.5 rounded-md text-[11px] bg-slate-100 text-slate-800 font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>تفاصيل</span>
                            </button>
                            {canCreatePurchase && row.type === 'purchase' && row.status === 'confirmed' && row.remainingAmount > 0.009 && (
                              <button
                                type="button"
                                onClick={() => openPurchasePaymentModal(fallbackInv)}
                                className="px-2 py-0.5 rounded-md text-[11px] bg-emerald-700 text-white font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <CreditCard className="w-3 h-3" />
                                <span>سداد</span>
                              </button>
                            )}
                          </div>
                        );
                      },
                    },
                  ]}
                />
              )}

              {/* Sub-view 3: Item Movement Rows */}
              {rptSubView === 'items' && (
                <UnifiedDataTable
                  compact
                  paginated={false}
                  searchable={false}
                  title={`حركة الأصناف (${repReportData.itemRows.length})`}
                  data={repReportData.itemRows}
                  rowKey={(it) => it.rowId}
                  emptyTitle="لا توجد حركات أصناف مطابقة"
                  columns={[
                    {
                      key: 'productName',
                      header: 'الصنف',
                      render: (it) => (
                        <div>
                          <span className="font-black text-slate-900 block">
                            {it.productName}
                            {(it.categoryName || it.class1) && (
                              <span className="text-[10px] font-normal text-slate-500 mr-1">
                                ({[it.categoryName, it.class1].filter(Boolean).join(' · ')})
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {it.opType === 'sales' ? 'بيع' : it.opType === 'purchase' ? 'شراء' : it.opType === 'sales_return' ? 'مرتجع بيع' : 'مرتجع شراء'}{' '}
                            · <span className="font-mono">{it.invoiceNumber}</span> · {it.date} · {it.partyName}
                          </span>
                        </div>
                      ),
                    },
                    {
                      key: 'quantity',
                      header: 'الكمية',
                      align: 'center',
                      render: (it) => <span className="font-mono">{it.quantity} {it.unit}</span>,
                    },
                    {
                      key: 'unitPrice',
                      header: 'السعر',
                      align: 'center',
                      render: (it) => <span className="font-mono">{it.unitPrice.toLocaleString()}</span>,
                    },
                    {
                      key: 'total',
                      header: 'الإجمالي',
                      align: 'center',
                      render: (it) => (
                        <div>
                          <strong className="font-mono text-slate-900 block">
                            {it.total.toLocaleString()} {data.settings.currency}
                          </strong>
                          {(typeof it.returnedQty === 'number' && it.returnedQty > 0 && (it.opType === 'sales' || it.opType === 'purchase')) && (
                            <span className="text-[10px] font-bold text-rose-700">
                              مرتجع: {it.returnedQty} · الصافي: {(it.netValue ?? it.total).toLocaleString()}
                            </span>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              )}

              {/* Sub-view 4: Collections */}
              {rptSubView === 'collections' && (
                <UnifiedDataTable
                  compact
                  paginated={false}
                  searchable={false}
                  title={`التحصيلات النقدية (${repReportData.collections.length})`}
                  data={repReportData.collections}
                  rowKey={(col) => col.id}
                  emptyTitle="لا توجد تحصيلات نقدية في هذه الفترة"
                  columns={[
                    {
                      key: 'partyName',
                      header: 'العميل',
                      render: (col) => (
                        <div>
                          <span className="font-black text-slate-900 block">{col.partyName}</span>
                          <span className="text-[10px] text-slate-500">
                            {col.transactionNumber ? `${col.transactionNumber} · ` : ''}{col.date}
                            {col.relatedDocNumber ? ` · فاتورة ${col.relatedDocNumber}` : ''}
                          </span>
                        </div>
                      ),
                    },
                    {
                      key: 'paymentMethod',
                      header: 'الطريقة',
                      align: 'center',
                      render: (col) => (col.paymentMethod === 'bank' ? 'تحويل بنكي' : col.paymentMethod === 'cheque' ? 'شيك' : 'نقدي'),
                    },
                    {
                      key: 'amount',
                      header: 'المبلغ المحصل',
                      align: 'center',
                      render: (col) => (
                        <div>
                          <strong className="font-mono text-emerald-700 block">
                            {col.amount.toLocaleString()} {data.settings.currency}
                          </strong>
                          {typeof col.remainingAfter === 'number' && col.relatedDocNumber && (
                            <span className="text-[10px] font-bold text-amber-800">
                              متبقي: {col.remainingAfter.toLocaleString()}
                            </span>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              )}

              {(repReportData.salesReturnRequests?.length ?? 0) > 0 && (
                <UnifiedDataTable
                  compact
                  paginated={false}
                  searchable={false}
                  title={`طلبات مرتجع المبيعات (${repReportData.salesReturnRequests?.length ?? 0})`}
                  data={repReportData.salesReturnRequests || []}
                  rowKey={(req) => req.id}
                  columns={[
                    { key: 'requestNumber', header: 'رقم الطلب', render: (req) => <span className="font-mono font-black text-rose-900">{req.requestNumber}</span> },
                    { key: 'customerName', header: 'العميل / الفاتورة', render: (req) => `${req.customerName} · فاتورة ${req.originalInvoiceNumber}` },
                    { key: 'date', header: 'التاريخ', align: 'center', render: (req) => <span className="font-mono">{req.date}</span> },
                    { key: 'status', header: 'الحالة', align: 'center', render: (req) => (req.status === 'approved' ? 'معتمد' : req.status === 'rejected' ? 'مرفوض' : 'قيد الانتظار') },
                    { key: 'grandTotal', header: 'الإجمالي', align: 'center', render: (req) => <strong className="font-mono text-rose-800">{Number(req.grandTotal || 0).toLocaleString()} {data.settings.currency}</strong> },
                  ]}
                />
              )}

              {canCreatePurchase && (repReportData.purchaseReturnRequests?.length ?? 0) > 0 && (
                <UnifiedDataTable
                  compact
                  paginated={false}
                  searchable={false}
                  title={`طلبات مرتجع المشتريات (${repReportData.purchaseReturnRequests?.length ?? 0})`}
                  data={repReportData.purchaseReturnRequests || []}
                  rowKey={(req) => req.id}
                  columns={[
                    { key: 'requestNumber', header: 'رقم الطلب', render: (req) => <span className="font-mono font-black text-[#011E58]">{req.requestNumber}</span> },
                    { key: 'supplierName', header: 'المورد / الفاتورة', render: (req) => `${req.supplierName} · فاتورة ${req.originalInvoiceNumber}` },
                    { key: 'date', header: 'التاريخ', align: 'center', render: (req) => <span className="font-mono">{req.date}</span> },
                    { key: 'status', header: 'الحالة', align: 'center', render: (req) => (req.status === 'approved' ? 'معتمد' : req.status === 'rejected' ? 'مرفوض' : 'قيد الانتظار') },
                    { key: 'grandTotal', header: 'الإجمالي', align: 'center', render: (req) => <strong className="font-mono text-[#011E58]">{Number(req.grandTotal || 0).toLocaleString()} {data.settings.currency}</strong> },
                  ]}
                />
              )}

              {/* Pagination Controls */}
              {repReportData.pagination && (repReportData.pagination.totalPages > 1 || repReportData.pagination.totalRows > 25) && (
                <div className="bg-white rounded-lg border border-slate-200 px-2 py-1.5 flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-700">
                    <span>صفحة</span>
                    <span className="font-mono text-blue-950">{repReportData.pagination.page}</span>
                    <span>من</span>
                    <span className="font-mono text-blue-950">{repReportData.pagination.totalPages}</span>
                    <span className="text-slate-400">({repReportData.pagination.totalRows} سجل)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <select
                      value={rptPageSize}
                      onChange={(e) => {
                        setRptPageSize(Number(e.target.value));
                        setRptPage(1);
                      }}
                      className="h-7 rounded-md border border-slate-300 px-2 text-[11px] font-bold bg-white"
                    >
                      <option value={25}>25 / صفحة</option>
                      <option value={50}>50 / صفحة</option>
                      <option value={100}>100 / صفحة</option>
                    </select>
                    <button
                      type="button"
                      disabled={!repReportData.pagination.hasPrevPage || isLoadingRepReport}
                      onClick={() => setRptPage((p) => Math.max(1, p - 1))}
                      className="h-7 px-2 rounded-md text-[11px] bg-slate-100 text-slate-800 font-bold disabled:opacity-45 cursor-pointer"
                    >
                      السابق
                    </button>
                    <button
                      type="button"
                      disabled={!repReportData.pagination.hasNextPage || isLoadingRepReport}
                      onClick={() => setRptPage((p) => p + 1)}
                      className="h-7 px-2 rounded-md text-[11px] bg-[#003589] text-white font-bold disabled:opacity-45 cursor-pointer"
                    >
                      التالي
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Delivery Confirmation Sheet */}
      {deliveringOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmDelivered}
            className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 space-y-2 text-xs pb-safe max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <div>
                <h4 className="font-black text-xs text-slate-900">
                  تأكيد تسليم الطلب {deliveringOrder.requestNumber}
                </h4>
                <p className="text-[11px] text-slate-500">{deliveringOrder.customerName}</p>
              </div>
              <button
                type="button"
                onClick={() => setDeliveringOrder(null)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                إغلاق
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                المبلغ المحصل عند التسليم ({data.settings.currency}):
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={deliveryCollectedAmount || ''}
                onChange={(e) => setDeliveryCollectedAmount(Math.max(0, Number(e.target.value)))}
                placeholder="المبلغ المحصل"
                className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-black text-center text-[#011E58]"
              />
            </div>

            {deliveryCollectedAmount > 0 && (
              <div className={`grid gap-1.5 ${!isRepRoleAccount && canCashOps ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {!isRepRoleAccount && canCashOps && (
                  <select
                    value={deliveryCashboxId}
                    onChange={(e) => setDeliveryCashboxId(e.target.value)}
                    className="h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
                  >
                    {data.cashboxes.map((cb) => (
                      <option key={cb.id} value={cb.id}>{cb.name}</option>
                    ))}
                  </select>
                )}
                <select
                  value={deliveryMethod}
                  onChange={(e) => setDeliveryMethod(e.target.value as any)}
                  className="h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
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
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />

            <label className="h-7 px-2 rounded-md border border-blue-200 bg-blue-50 text-blue-900 font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer">
              <Camera className="w-3.5 h-3.5" />
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
              className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black disabled:opacity-50 cursor-pointer"
            >
              {isUpdatingDelivery ? 'جاري التسجيل...' : 'اعتماد تسليم الطلب'}
            </button>
          </form>
        </div>
      )}

      {/* Customer Tap-for-Details & WA0004 Account Statement Sheet */}
      {selectedCustomerDetail && (() => {
        const c = selectedCustomerDetail;
        const custInvoices = myInvoices
          .filter((inv) => inv.customerId === c.id)
          .slice(0, 10);
        const latestInvoice = custInvoices[0];
        const latestPaymentTx = (data.financialTransactions || []).find(
          (tx) => tx.partyId === c.id || tx.notes?.includes(c.name)
        );
        const stmtSummary = customerDetailStatement?.summary;
        const allPhones: CustomerPhoneEntry[] =
          Array.isArray(c.phones) && c.phones.length > 0
            ? c.phones
            : [
                ...(c.phone ? [{ id: 'p-1', phone: c.phone, label: 'رئيسي', isPrimary: true }] : []),
                ...(c.secondaryPhone ? [{ id: 'p-2', phone: c.secondaryPhone, label: 'إضافي', isPrimary: false }] : []),
              ];
        const parsedMap = parseLatLngCoords(c.geoCoordinates || '');
        const mapRaw = (c.geoCoordinates || c.address || '').trim();
        const hasValidMap = Boolean(mapRaw && mapRaw !== '-');
        const mapsHref =
          mapRaw.startsWith('http://') || mapRaw.startsWith('https://')
            ? mapRaw
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapRaw)}`;
        const previewInvoiceObj =
          statementPreviewDoc?.type === 'invoice'
            ? data.invoices.find((inv) => inv.id === statementPreviewDoc.docId || inv.invoiceNumber === statementPreviewDoc.title) || null
            : null;
        const previewPaymentObj =
          statementPreviewDoc?.type === 'payment'
            ? data.financialTransactions.find((tx) => tx.id === statementPreviewDoc.docId) || null
            : null;

        const filteredStmtEntries = (customerDetailStatement?.entries || []).filter((entry) => {
          const entryDate = String(entry.date || '').slice(0, 10);
          if (stmtDateFrom && entryDate && entryDate < stmtDateFrom) return false;
          if (stmtDateTo && entryDate && entryDate > stmtDateTo) return false;
          const q = stmtSearch.trim().toLowerCase();
          if (q) {
            const hay = `${entry.label || ''} ${entry.docNumber || ''} ${entry.description || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const totalRemainingVal = Number(stmtSummary?.currentBalance ?? c.currentBalance ?? 0);

        const handlePrintCustomerStatementPdf = () => {
          const activeBranches = data.settings.extraSettings?.branches || [];
          const defaultBranch = activeBranches.find((b) => b.isDefault) || activeBranches[0];
          const currency = data.settings.currency || 'ج.م';
          exportHtmlToPdf({
            title: 'كشف حساب تفصيلي للعميل',
            subtitle: data.settings.companySubtitle,
            companyName: data.settings.companyName,
            address: data.settings.address,
            phone1: data.settings.phone1,
            phone2: data.settings.phone2,
            branchName: defaultBranch?.name,
            branchNumber: defaultBranch?.branchNumber || data.settings.branchNumber,
            representativeName: rep?.name,
            representativePhone: rep?.phone,
            docNumber: c.code || c.id,
            dateRangeText: stmtDateFrom || stmtDateTo ? `${stmtDateFrom || '...'} إلى ${stmtDateTo || '...'}` : undefined,
            meta: [
              { label: 'العميل', value: c.shopName || c.name },
              ...(c.phone ? [{ label: 'هاتف العميل', value: c.phone }] : []),
              ...(c.address && c.address !== '-' ? [{ label: 'عنوان العميل', value: c.address }] : []),
            ],
            tableHeaders: ['العملية', 'دفع', 'تاريخ', 'الفاتورة', 'باقي'],
            tableRows: filteredStmtEntries.map((entry) => [
              entry.label || '',
              Number(entry.credit || 0).toLocaleString(),
              entry.date || '',
              Number(entry.debit || 0).toLocaleString(),
              Number(entry.runningBalance ?? 0).toLocaleString(),
            ]),
            summaryPairs: [
              { label: 'الإجمالي المتبقي', value: `${totalRemainingVal.toLocaleString()} ${currency}`, highlight: true },
            ],
          });
        };

        const handleShareCsvStatement = () => {
          const lines = [
            'العملية,دفع,تاريخ,الفاتورة,باقي,الرقم المرجعي',
            ...filteredStmtEntries.map((entry) =>
              `"${(entry.label || '').replace(/"/g, '""')}",${Number(entry.credit || 0)},${entry.date || ''},${Number(entry.debit || 0)},${Number(entry.runningBalance ?? 0)},"${(entry.docNumber || '').replace(/"/g, '""')}"`
            ),
          ];
          const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `statement-${c.code || c.id}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        };

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
            <div className="w-full max-w-2xl bg-[#f5f7fb] rounded-t-lg sm:rounded-lg overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col text-xs pb-safe">
              {/* Brand Navy Header Bar */}
              <div className="awlad-brand-gradient text-white px-2.5 py-1.5 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedCustomerDetail(null)}
                    className="h-7 w-7 rounded-md bg-white/15 hover:bg-white/25 flex items-center justify-center text-white cursor-pointer shrink-0"
                    aria-label="رجوع"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <div className="min-w-0">
                    <h4 className="font-black text-xs truncate">
                      {customerDetailSubTab === 'statement' ? 'عرض تفصيلي لحساب الآجل' : (c.shopName || c.name)}
                    </h4>
                    <p className="text-[10px] text-[#DCE6F5] truncate">
                      {c.shopName || c.name} · {c.code}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setCustomerDetailSubTab(customerDetailSubTab === 'statement' ? 'overview' : 'statement')}
                    className="h-7 w-7 rounded-md bg-white/15 hover:bg-white/25 flex items-center justify-center text-white cursor-pointer"
                    title={customerDetailSubTab === 'statement' ? 'معلومات العميل' : 'كشف الحساب'}
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintCustomerStatementPdf}
                    className="h-7 px-2 rounded-md text-[11px] bg-white text-[#011E58] font-black inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Printer className="w-3 h-3" />
                    <span>طباعة</span>
                  </button>
                </div>
              </div>

              {/* Detail Modal Sub-Tabs */}
              <div className="px-2.5 py-1 bg-white border-b border-slate-200 shrink-0">
                <div className="grid grid-cols-2 gap-1 bg-slate-100 p-0.5 rounded-md">
                  <button
                    type="button"
                    onClick={() => setCustomerDetailSubTab('overview')}
                    className={`h-8 rounded-md text-[11px] font-black cursor-pointer ${
                      customerDetailSubTab === 'overview' ? 'bg-[#003589] text-white' : 'text-slate-700'
                    }`}
                  >
                    ملف العميل والملخص
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerDetailSubTab('statement')}
                    className={`h-8 rounded-md text-[11px] font-black cursor-pointer ${
                      customerDetailSubTab === 'statement' ? 'bg-[#003589] text-white' : 'text-slate-700'
                    }`}
                  >
                    كشف الحساب التفصيلي
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {customerDetailSubTab === 'overview' && (
                  <>
                    <div className="bg-white rounded-lg border border-slate-200 p-2 flex items-start gap-2">
                      {(c.shopPhoto || c.photo) ? (
                        <button
                          type="button"
                          onClick={() => setPreviewShopPhoto(c.shopPhoto || c.photo || null)}
                          className="shrink-0 cursor-pointer"
                          title="عرض صورة المحل بالحجم الكامل"
                        >
                          <img
                            src={c.shopPhoto || c.photo}
                            alt={c.shopName || c.name}
                            className="w-10 h-10 rounded-md object-cover border border-slate-200"
                          />
                        </button>
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] flex items-center justify-center text-[#003589] shrink-0">
                          <Store className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h4 className="font-black text-xs text-slate-900">{c.shopName || c.name}</h4>
                        <p className="text-[11px] text-slate-500">
                          {c.name} · {c.code}
                          {c.governorate ? ` · ${c.governorate}` : ''}
                          {c.area ? ` · ${c.area}` : ''}
                        </p>
                        {c.address && c.address !== '-' && (
                          <p className="text-[11px] text-slate-600 mt-0.5">{c.address}</p>
                        )}
                        {c.notes && (
                          <p className="text-[11px] text-slate-500 mt-0.5">{c.notes}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden text-center tabular-nums">
                      <div className="px-2 py-1.5 bg-white">
                        <span className="text-[10px] text-slate-500 block">
                          {c.currentBalance < -0.009
                            ? 'رصيد دائن للعميل (علينا)'
                            : c.currentBalance > 0.009
                            ? 'المبلغ المتبقي (لنا)'
                            : 'الحساب متوازن'}
                        </span>
                        <strong
                          className={`font-mono text-xs ${
                            c.currentBalance > 0.009 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {Math.abs(c.currentBalance).toLocaleString()} {data.settings.currency}
                        </strong>
                      </div>
                      <div className="px-2 py-1.5 bg-white">
                        <span className="text-[10px] text-blue-800 block">إجمالي الفواتير</span>
                        <strong className="font-mono text-xs text-blue-950">
                          {(stmtSummary?.totalSales ?? custInvoices.reduce((s, i) => s + Number(i.grandTotal || 0), 0)).toLocaleString()} {data.settings.currency}
                        </strong>
                      </div>
                      <div className="px-2 py-1.5 bg-white">
                        <span className="text-[10px] text-emerald-800 block">إجمالي المحصل</span>
                        <strong className="font-mono text-xs text-emerald-950">
                          {(stmtSummary?.totalPaid ?? stmtSummary?.totalCredit ?? 0).toLocaleString()} {data.settings.currency}
                        </strong>
                      </div>
                      <div className="px-2 py-1.5 bg-white">
                        <span className="text-[10px] text-slate-500 block">آخر فاتورة</span>
                        <strong className="font-mono text-[11px] text-blue-950">
                          {stmtSummary?.lastInvoiceDate
                            ? `${stmtSummary.lastInvoiceDate} (${stmtSummary.lastInvoiceNumber || ''})`
                            : latestInvoice
                            ? `${latestInvoice.date} (${latestInvoice.invoiceNumber})`
                            : 'لا يوجد'}
                        </strong>
                      </div>
                      <div className="px-2 py-1.5 bg-white col-span-1 sm:col-span-2">
                        <span className="text-[10px] text-slate-500 block">آخر تحصيل / سداد</span>
                        <strong className="font-mono text-[11px] text-emerald-900">
                          {stmtSummary?.lastPaymentDate
                            ? stmtSummary.lastPaymentDate
                            : latestPaymentTx
                            ? `${latestPaymentTx.amount.toLocaleString()} (${latestPaymentTx.date})`
                            : 'لا يوجد'}
                        </strong>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {allPhones.map((ph, idx) => {
                        const rawPhone = String(ph.phone || ph.number || '').trim();
                        const clean = rawPhone.replace(/[^\d+]/g, '');
                        if (clean.replace(/\D/g, '').length < 5) return null;
                        return (
                          <a
                            key={ph.id || idx}
                            href={`tel:${clean}`}
                            className={`h-7 px-2 rounded-md text-[11px] font-mono font-bold inline-flex items-center gap-1 border ${
                              ph.isPrimary || idx === 0
                                ? 'bg-[#EEF3FA] text-[#011E58] border-[#DCE6F5]'
                                : 'bg-slate-50 text-slate-800 border-slate-200'
                            }`}
                          >
                            <Phone className="w-3 h-3 text-[#003589]" />
                            <span>{rawPhone}</span>
                            {ph.label && <span className="font-sans text-[10px]">({ph.label})</span>}
                          </a>
                        );
                      })}
                      {hasValidMap && (
                        <button
                          type="button"
                          onClick={() =>
                            setLocationViewerData({
                              customerName: c.name,
                              shopName: c.shopName,
                              address: c.address,
                              city: c.city,
                              area: c.area,
                              governorate: c.governorate,
                              geoCoordinates: c.geoCoordinates,
                              latitude: c.latitude,
                              longitude: c.longitude,
                            })
                          }
                          className="h-7 px-2 rounded-md text-[11px] bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <MapPin className="w-3 h-3 text-[#003589]" />
                          <span>عرض الموقع على الخريطة</span>
                        </button>
                      )}
                    </div>

                    <UnifiedDataTable
                      compact
                      paginated={false}
                      searchable={false}
                      title={`آخر فواتير العميل (${custInvoices.length})`}
                      data={custInvoices}
                      rowKey={(inv) => inv.id}
                      emptyTitle="لا توجد فواتير مسجلة لهذا العميل"
                      onRowClick={(inv) =>
                        setStatementPreviewDoc({
                          type: 'invoice',
                          docId: inv.id,
                          title: inv.invoiceNumber,
                        })
                      }
                      columns={[
                        { key: 'invoiceNumber', header: 'رقم الفاتورة', render: (inv) => <span className="font-mono font-bold text-blue-950">{inv.invoiceNumber}</span> },
                        { key: 'date', header: 'التاريخ', align: 'center', render: (inv) => <span className="font-mono text-slate-600">{inv.date}</span> },
                        {
                          key: 'grandTotal',
                          header: 'الإجمالي',
                          align: 'center',
                          render: (inv) => (
                            <strong className="font-mono text-slate-900 tabular-nums">
                              {inv.grandTotal.toLocaleString()} {data.settings.currency}
                            </strong>
                          ),
                        },
                        {
                          key: 'remainingAmount',
                          header: 'المتبقي',
                          align: 'center',
                          render: (inv) =>
                            inv.remainingAmount > 0 ? (
                              <span className="font-mono font-bold text-red-700">{inv.remainingAmount.toLocaleString()}</span>
                            ) : (
                              <span className="text-emerald-700 font-bold">مسددة</span>
                            ),
                        },
                      ]}
                    />
                  </>
                )}

                {customerDetailSubTab === 'statement' && (
                  <div className="space-y-2">
                    {/* Customer Switcher + Date Range Filter Strip */}
                    <div className="bg-white rounded-lg border border-slate-200 p-2 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={c.id}
                          onChange={(e) => {
                            const nextC = data.customers.find((x) => x.id === e.target.value);
                            if (nextC) {
                              setSelectedCustomerDetail(nextC);
                              setCustomerDetailSubTab('statement');
                            }
                          }}
                          className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-bold bg-slate-50"
                        >
                          {data.customers.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.shopName || x.name} ({Number(x.currentBalance || 0).toLocaleString()} {data.settings.currency})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setIsLoadingCustomerStatement(true);
                            data.getCustomerStatement(c.id).then((res) => {
                              if (res) setCustomerDetailStatement(res);
                            }).finally(() => setIsLoadingCustomerStatement(false));
                          }}
                          className="h-8 w-8 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 cursor-pointer shrink-0"
                          title="تحديث كشف الحساب"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCustomerStatement ? 'animate-spin' : ''}`} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        <input
                          type="date"
                          value={stmtDateFrom}
                          onChange={(e) => setStmtDateFrom(e.target.value)}
                          title="من تاريخ"
                          className="h-8 rounded-md border border-slate-300 px-2 font-mono text-[11px] bg-slate-50"
                        />
                        <input
                          type="date"
                          value={stmtDateTo}
                          onChange={(e) => setStmtDateTo(e.target.value)}
                          title="إلى تاريخ"
                          className="h-8 rounded-md border border-slate-300 px-2 font-mono text-[11px] bg-slate-50"
                        />
                        <input
                          type="text"
                          value={stmtSearch}
                          onChange={(e) => setStmtSearch(e.target.value)}
                          placeholder="بحث برقم المستند أو العملية..."
                          className="col-span-2 sm:col-span-1 h-8 rounded-md border border-slate-300 px-2 text-[11px] bg-slate-50"
                        />
                      </div>
                    </div>

                    {/* WA0004 3-Button Action & Remaining Bar */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDepMode('customer_collection');
                          setDepCustomerId(c.id);
                          setDepInvoiceId('');
                          setDepAmount('');
                          setSelectedCustomerDetail(null);
                          onTabChange('cash-deposit');
                        }}
                        className="h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer"
                      >
                        دفع
                      </button>
                      <div className="h-8 rounded-md bg-white border border-slate-200 px-2 flex flex-col items-center justify-center text-center tabular-nums leading-tight">
                        <span className="text-[9px] text-slate-500 font-bold">اجمالي المتبقي</span>
                        <strong className={`font-mono text-[11px] font-black ${totalRemainingVal > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {totalRemainingVal.toLocaleString()} {data.settings.currency}
                        </strong>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (canEditCustomer) {
                            openEditCustomerSheet(c);
                          } else {
                            setCustomerDetailSubTab('overview');
                          }
                        }}
                        className="h-8 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 font-black cursor-pointer"
                      >
                        تصحيح
                      </button>
                    </div>

                    {customerDetailStatement?.scope?.isRepScoped && (
                      <div className="px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-950 font-bold text-[10px]">
                        رصيد حساب العميل عام للشركة، والفواتير والمرتجعات والدفعات أدناه تخص عملياتك معه فقط.
                      </div>
                    )}

                    {/* WA0004 5-Column Tabular Ledger Table */}
                    {isLoadingCustomerStatement ? (
                      <p className="text-center py-6 text-slate-500 font-bold">جاري تحميل كشف الحساب التفصيلي...</p>
                    ) : (
                      <UnifiedDataTable
                        compact
                        paginated={false}
                        searchable={false}
                        maxHeightClassName="max-h-[42vh]"
                        data={filteredStmtEntries}
                        rowKey={(entry) => entry.id}
                        emptyTitle="لا توجد حركات مسجلة مطابقة للبحث"
                        onRowClick={(entry) => {
                          if (entry.docId && (entry.docType === 'sales' || entry.docType === 'customer_payment')) {
                            setStatementPreviewDoc({
                              type: entry.docType === 'customer_payment' ? 'payment' : 'invoice',
                              docId: entry.docId,
                              title: entry.docNumber || entry.label,
                            });
                          }
                        }}
                        columns={[
                          {
                            key: 'label',
                            header: 'العملية',
                            render: (entry) => (
                              <div>
                                <span className="font-bold text-slate-900 block truncate max-w-[120px]">{entry.label}</span>
                                {entry.docNumber && (
                                  <span className="font-mono text-[10px] text-slate-400 block">{entry.docNumber}</span>
                                )}
                              </div>
                            ),
                          },
                          {
                            key: 'credit',
                            header: 'دفع',
                            align: 'center',
                            render: (entry) => (
                              <span className="font-mono font-bold text-emerald-700">
                                {entry.credit ? Number(entry.credit).toLocaleString() : '-'}
                              </span>
                            ),
                          },
                          {
                            key: 'date',
                            header: 'تاريخ',
                            align: 'center',
                            render: (entry) => <span className="font-mono text-slate-600">{entry.date}</span>,
                          },
                          {
                            key: 'debit',
                            header: 'الفاتورة',
                            align: 'center',
                            render: (entry) => (
                              <span className="font-mono font-bold text-slate-800">
                                {entry.debit ? Number(entry.debit).toLocaleString() : '-'}
                              </span>
                            ),
                          },
                          {
                            key: 'runningBalance',
                            header: 'باقي',
                            align: 'center',
                            render: (entry) => {
                              const rb = Number(entry.runningBalance ?? 0);
                              return (
                                <strong className={`font-mono font-black ${rb > 0.009 ? 'text-red-700' : 'text-emerald-700'}`}>
                                  {rb.toLocaleString()}
                                </strong>
                              );
                            },
                          },
                        ]}
                      />
                    )}

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={handleShareCsvStatement}
                        className="h-8 rounded-md bg-[#0049B0] hover:bg-[#003589] text-white font-black flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>مشاركة / CSV</span>
                      </button>
                      <button
                        type="button"
                        onClick={handlePrintCustomerStatementPdf}
                        className="h-8 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-black flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>طباعة</span>
                      </button>
                    </div>
                  </div>
                )}

                {statementPreviewDoc && (
                  <div className="p-2 rounded-md bg-blue-50 border border-blue-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <strong className="text-blue-950 font-black">
                        تفاصيل المستند: {statementPreviewDoc.title}
                      </strong>
                      <button
                        type="button"
                        onClick={() => setStatementPreviewDoc(null)}
                        className="px-2 py-0.5 rounded-md text-[11px] bg-white text-slate-700 font-bold cursor-pointer"
                      >
                        إغلاق
                      </button>
                    </div>
                    {previewInvoiceObj ? (
                      <div className="space-y-1 text-[11px]">
                        <div className="flex justify-between font-bold text-slate-700">
                          <span>التاريخ: {previewInvoiceObj.date}</span>
                          <span>الإجمالي: {previewInvoiceObj.grandTotal.toLocaleString()} {data.settings.currency}</span>
                        </div>
                        <div className="divide-y divide-blue-200/70 bg-white rounded-md p-2">
                          {(previewInvoiceObj.items || []).map((it, idx) => (
                            <div key={idx} className="py-1 flex justify-between">
                              <span>{it.productName} ({it.quantity} {it.unit})</span>
                              <strong className="font-mono">{it.total.toLocaleString()}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : previewPaymentObj ? (
                      <div className="bg-white rounded-md p-2 space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span>التاريخ:</span>
                          <strong className="font-mono">{previewPaymentObj.date}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>المبلغ المحصل:</span>
                          <strong className="font-mono text-emerald-700">
                            {previewPaymentObj.amount.toLocaleString()} {data.settings.currency}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span>البيان:</span>
                          <span>{previewPaymentObj.notes || '-'}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-600">لا تتوفر تفاصيل إضافية لهذا المستند محلياً.</p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setInvCustomerId(c.id);
                      setSelectedCustomerDetail(null);
                      onTabChange('new-invoice');
                    }}
                    className="h-8 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-black cursor-pointer"
                  >
                    + فاتورة جديدة
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDepMode('customer_collection');
                      setDepCustomerId(c.id);
                      setDepInvoiceId('');
                      setDepAmount('');
                      setSelectedCustomerDetail(null);
                      onTabChange('cash-deposit');
                    }}
                    className="h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer"
                  >
                    + تحصيل دفعة
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {canEditCustomer && (
                    <button
                      type="button"
                      onClick={() => openEditCustomerSheet(c)}
                      className="h-8 flex-1 rounded-md bg-white hover:bg-slate-100 text-slate-900 border border-slate-300 font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      <span>تعديل بيانات العميل</span>
                    </button>
                  )}
                  {canDeleteCustomer && (
                    <button
                      type="button"
                      onClick={() => setDeleteCustomerTarget(c)}
                      className="h-8 px-2.5 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Unsaved Invoice Leave Guard Modal */}
      {pendingLeaveTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-lg p-2.5 border border-slate-200 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-black text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>توجد أصناف غير محفوظة في الفاتورة</span>
            </div>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              لديك ({invItems.length}) أصناف في الفاتورة الحالية ولم يتم حفظها أو اعتمادها بعد. هل تريد المغادرة مع الاحتفاظ بها أم البقاء لإكمال الفاتورة؟
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => setPendingLeaveTab(null)}
                className="h-8 rounded-md bg-blue-900 text-white font-black cursor-pointer"
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
                className="h-8 rounded-md bg-slate-100 text-slate-800 font-bold cursor-pointer"
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
          <div className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[82vh] flex flex-col gap-2 text-xs pb-safe">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <div>
                <h4 className="font-black text-xs text-slate-900">
                  {selectedInvoice.invoiceNumber} — {selectedInvoice.customerName}
                </h4>
                <p className="text-[11px] text-slate-500 font-mono">{selectedInvoice.date}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            <UnifiedDataTable
              compact
              paginated={false}
              searchable={false}
              maxHeightClassName="max-h-[45vh]"
              data={selectedInvoice.items || []}
              rowKey={(it, idx) => `${it.productId}-${idx}`}
              columns={[
                { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold text-slate-900">{it.productName}</span> },
                { key: 'quantity', header: 'الكمية', align: 'center', render: (it) => <span className="font-mono">{it.quantity} {it.unit}</span> },
                { key: 'unitPrice', header: 'السعر', align: 'center', render: (it) => <span className="font-mono">{it.unitPrice.toLocaleString()}</span> },
                { key: 'total', header: 'الإجمالي', align: 'center', render: (it) => <strong className="font-mono text-blue-950">{it.total.toLocaleString()} {data.settings.currency}</strong> },
              ]}
            />
            <button
              type="button"
              onClick={() => exportInvoiceDocument(selectedInvoice)}
              className="h-8 rounded-md bg-blue-900 text-white font-black flex items-center justify-center gap-1 cursor-pointer"
            >
              {isNative ? <Share2 className="w-3.5 h-3.5" /> : <FileDown className="w-3.5 h-3.5" />}
              <span>{isNative ? 'مشاركة / حفظ الفاتورة' : 'طباعة / PDF'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Purchase Invoice Review & Dispatch Modal */}
      {purReviewOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[88vh] overflow-y-auto space-y-2 text-xs pb-safe">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <h4 className="font-black text-xs text-slate-900">معاينة ومراجعة فاتورة الشراء قبل الإرسال</h4>
              <button
                type="button"
                onClick={() => setPurReviewOpen(false)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                تعديل
              </button>
            </div>

            <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-0.5 text-[11px]">
              <p>المورد: <strong>{data.suppliers.find((s) => s.id === purSupplierId)?.name || 'مورد'}</strong> · المستودع: <strong>{data.warehouses.find((w) => w.id === (purWarehouseId || mainWarehouse?.id))?.name || 'المخزن الرئيسي'}</strong></p>
              <p>عدد الأصناف: <strong>{purItems.length}</strong> · طريقة السداد: <strong>{purPaymentType === 'cash' ? 'نقدي' : purPaymentType === 'credit' ? 'آجل' : 'جزئي'}</strong></p>
            </div>

            <UnifiedDataTable
              compact
              paginated={false}
              searchable={false}
              maxHeightClassName="max-h-[35vh]"
              data={purItems}
              rowKey={(it, idx) => `${it.productId}-${idx}`}
              columns={[
                {
                  key: 'productName',
                  header: 'الصنف',
                  render: (it) => (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-bold text-slate-800">{it.productName}</span>
                      {it.newProduct && (
                        <span className="text-emerald-800 text-[10px] font-bold">· جديد</span>
                      )}
                    </div>
                  ),
                },
                { key: 'quantity', header: 'الكمية', align: 'center', render: (it) => <span className="font-mono">{it.quantity} {it.unit}</span> },
                { key: 'unitPrice', header: 'السعر', align: 'center', render: (it) => <span className="font-mono">{it.unitPrice.toLocaleString()}</span> },
                { key: 'total', header: 'الإجمالي', align: 'center', render: (it) => <strong className="font-mono text-[#011E58]">{it.total.toLocaleString()}</strong> },
              ]}
            />

            <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] space-y-0.5">
              <div className="flex justify-between">
                <span>الإجمالي الفرعي:</span>
                <strong className="font-mono">{purSubtotal.toLocaleString()} {data.settings.currency}</strong>
              </div>
              {Number(purDiscount) > 0 && (
                <div className="flex justify-between text-rose-700">
                  <span>الخصم:</span>
                  <strong className="font-mono">-{Number(purDiscount).toLocaleString()} {data.settings.currency}</strong>
                </div>
              )}
              <div className="flex justify-between font-black text-[#011E58] text-xs pt-1 border-t border-[#DCE6F5]">
                <span>صافي الإجمالي:</span>
                <strong className="font-mono">{purTotal.toLocaleString()} {data.settings.currency}</strong>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">المستلم الموجه إليه (اختياري):</label>
              <select
                value={purRecipientUserId}
                onChange={(e) => setPurRecipientUserId(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
              >
                <option value="">الإدارة العامة (جميع المسؤولين المختصين)</option>
                {(data.purchaseReceivers || []).map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName} ({r.role})</option>
                ))}
              </select>
            </div>

            <div className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[10px]">
              لن يتغير رصيد المخزن أو المورد أو الخزينة إلا بعد استلام الفاتورة واعتمادها من الإدارة.
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                type="button"
                disabled={isSubmittingPurchase}
                onClick={() => handleSubmitPurchaseInvoice(false)}
                className="h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmittingPurchase ? 'جاري الحفظ...' : 'حفظ كمسودة'}
              </button>
              <button
                type="button"
                disabled={isSubmittingPurchase}
                onClick={() => handleSubmitPurchaseInvoice(true)}
                className="h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmittingPurchase ? 'جاري الإرسال...' : 'حفظ وإرسال للإدارة'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Send Draft Purchase Modal */}
      {sendingPurchaseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-lg p-2.5 border border-slate-200 space-y-2 text-xs">
            <h4 className="font-black text-xs text-slate-900">
              إرسال فاتورة الشراء ({sendingPurchaseTarget.invoiceNumber}) للإدارة
            </h4>
            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">توجيه إلى:</label>
              <select
                value={sendingRecipientUserId}
                onChange={(e) => setSendingRecipientUserId(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
              >
                <option value="">الإدارة العامة (جميع المسؤولين المختصين)</option>
                {(data.purchaseReceivers || []).map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName} ({r.role})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => setSendingPurchaseTarget(null)}
                className="h-8 rounded-md bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSendingPurchase}
                onClick={async () => {
                  const chosen = (data.purchaseReceivers || []).find((r) => r.id === sendingRecipientUserId);
                  setIsSendingPurchase(true);
                  const res = await data.sendPurchaseInvoice(sendingPurchaseTarget.id, {
                    recipientUserId: chosen?.id,
                    recipientName: chosen?.fullName || 'الإدارة العامة',
                  });
                  setIsSendingPurchase(false);
                  if (res.success) {
                    setSendingPurchaseTarget(null);
                    setFeedback({
                      type: res.queuedOffline ? 'warning' : 'success',
                      text: res.queuedOffline
                        ? `تم وضع طلب إرسال الفاتورة (${sendingPurchaseTarget.invoiceNumber}) في طابور المزامنة.`
                        : `تم إرسال الفاتورة (${sendingPurchaseTarget.invoiceNumber}) للإدارة بانتظار الاستلام.`,
                    });
                  } else {
                    setFeedback({ type: 'error', text: res.error || 'تعذر إرسال الفاتورة' });
                  }
                }}
                className="h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSendingPurchase ? 'جاري الإرسال...' : 'تأكيد الإرسال'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Dispatch History Modal */}
      {historyPurchaseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-lg p-2.5 border border-slate-200 space-y-2 text-xs max-h-[82vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <h4 className="font-black text-xs text-slate-900">
                سجل الإرسال والاستلام — {historyPurchaseTarget.invoiceNumber}
              </h4>
              <button
                type="button"
                onClick={() => setHistoryPurchaseTarget(null)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            {(!historyPurchaseTarget.dispatchHistory || historyPurchaseTarget.dispatchHistory.length === 0) ? (
              <p className="text-slate-400 text-center py-4">لا توجد حركات إرسال مسجلة بعد.</p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
                {historyPurchaseTarget.dispatchHistory.map((h, idx) => (
                  <div key={`${h.at}-${idx}`} className="p-2 bg-white flex items-start justify-between gap-2">
                    <div>
                      <strong className="text-slate-900">
                        {h.action === 'created' ? 'إنشاء المسودة' :
                         h.action === 'sent' ? 'إرسال للإدارة' :
                         h.action === 'resent' ? 'إعادة إرسال للإدارة' :
                         h.action === 'received' ? 'استلام الفاتورة' :
                         h.action === 'rejected' ? 'رفض الفاتورة' :
                         h.action === 'confirmed' ? 'اعتماد وترحيل' : h.action}
                      </strong>
                      {h.by && <span className="text-slate-600 mr-1.5">· {h.by}</span>}
                      {h.recipientName && <span className="text-[#003589] mr-1.5">→ {h.recipientName}</span>}
                      {(h.notes || h.reason) && <p className="text-slate-600 mt-0.5">{h.notes || h.reason}</p>}
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0" dir="ltr">
                      {h.at ? new Date(h.at).toLocaleString('ar-EG') : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shop Photo Lightbox Modal */}
      {previewShopPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-950/80 backdrop-blur-xs"
          onClick={() => setPreviewShopPhoto(null)}
        >
          <div className="w-full max-w-lg bg-white rounded-lg overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b bg-slate-50 text-xs">
              <strong className="text-slate-900">معاينة صورة المحل</strong>
              <button
                type="button"
                onClick={() => setPreviewShopPhoto(null)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-200 font-bold text-slate-800 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            <div className="p-2 bg-slate-900 flex items-center justify-center">
              <img src={previewShopPhoto} alt="صورة المحل" className="max-h-[75vh] w-auto object-contain rounded-md" />
            </div>
          </div>
        </div>
      )}

      {/* Rep Purchase Invoice Full Detail Modal */}
      {selectedPurchaseDetail && (() => {
        const pur = selectedPurchaseDetail;
        const meta = getPurchaseDispatchMeta(pur);
        const canSendOrEdit = pur.status === 'draft' && (meta.key === 'draft' || meta.key === 'rejected');
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
            <div className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[88vh] flex flex-col gap-2 text-xs pb-safe">
              <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-1.5">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="font-black text-xs text-slate-900 font-mono">{pur.invoiceNumber}</h4>
                    <span className="text-[11px] font-bold text-slate-600">· {meta.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {pur.supplierName || 'مورد'} · {pur.date} · {pur.warehouseName || 'المخزن الرئيسي'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPurchaseDetail(null)}
                  className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer shrink-0"
                >
                  إغلاق
                </button>
              </div>

              <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-0.5 text-[11px]">
                <p>
                  السداد: <strong>{pur.paymentType === 'cash' ? 'نقدي' : pur.paymentType === 'credit' ? 'آجل' : 'جزئي'}</strong>
                  {pur.paidAmount > 0 ? ` · مدفوع: ${pur.paidAmount.toLocaleString()} ${data.settings.currency}` : ''}
                </p>
                {pur.sentAt && (
                  <p>
                    وقت الإرسال: <strong dir="ltr" className="font-mono">{new Date(pur.sentAt).toLocaleString('ar-EG')}</strong>
                    {pur.recipientName ? ` · موجهة إلى: ${pur.recipientName}` : ''}
                  </p>
                )}
                {pur.receivedBy && (
                  <p className="text-sky-800 font-bold">
                    المستلم الفعلي: {pur.receivedBy}
                    {pur.receivedAt ? ` (${new Date(pur.receivedAt).toLocaleString('ar-EG')})` : ''}
                  </p>
                )}
                {pur.dispatchStatus === 'rejected' && pur.rejectionReason && (
                  <p className="text-rose-800 font-bold">
                    سبب الرفض ({pur.rejectedBy || 'الإدارة'}): {pur.rejectionReason}
                  </p>
                )}
                {pur.notes && <p className="text-slate-600">ملاحظات: {pur.notes}</p>}
              </div>

              <UnifiedDataTable
                compact
                paginated={false}
                searchable={false}
                maxHeightClassName="max-h-[35vh]"
                data={pur.items || []}
                rowKey={(it, idx) => `${it.productId}-${idx}`}
                columns={[
                  { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold text-slate-900">{it.productName}</span> },
                  { key: 'quantity', header: 'الكمية', align: 'center', render: (it) => <span className="font-mono">{it.quantity} {it.unit}</span> },
                  {
                    key: 'unitPrice',
                    header: 'السعر',
                    align: 'center',
                    render: (it) => (
                      <span className="font-mono">
                        {it.unitPrice.toLocaleString()}
                        {Number(it.discount || 0) > 0 ? ` (خصم ${it.discount})` : ''}
                      </span>
                    ),
                  },
                  {
                    key: 'total',
                    header: 'الإجمالي',
                    align: 'center',
                    render: (it) => (
                      <strong className="font-mono text-[#011E58] tabular-nums">
                        {it.total.toLocaleString()} {data.settings.currency}
                      </strong>
                    ),
                  },
                ]}
              />

              <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] space-y-0.5 text-[#011E58] tabular-nums">
                <div className="flex items-center justify-between font-black text-xs">
                  <span>صافي الإجمالي:</span>
                  <strong className="font-mono">
                    {pur.grandTotal.toLocaleString()} {data.settings.currency}
                  </strong>
                </div>
                {pur.status === 'confirmed' && (
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>المدفوع: {Number(pur.paidAmount || 0).toLocaleString()} {data.settings.currency}</span>
                    <span className={Number(pur.remainingAmount || 0) > 0.009 ? 'text-amber-800' : 'text-emerald-800'}>
                      المتبقي: {Math.max(0, Number(pur.remainingAmount || 0)).toLocaleString()} {data.settings.currency}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {canCreatePurchase &&
                  pur.status === 'confirmed' &&
                  Number(pur.remainingAmount || 0) > 0.009 &&
                  (!isRepRoleAccount ||
                    (rep?.id && pur.representativeId === rep.id) ||
                    (currentUser?.id && pur.createdByUserId === currentUser.id) ||
                    (currentUser?.id && pur.sentByUserId === currentUser.id) ||
                    (!pur.createdByUserId &&
                      !pur.representativeId &&
                      !pur.sentByUserId &&
                      currentUser?.id &&
                      pur.createdBy === currentUser.id)) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPurchaseDetail(null);
                        openPurchasePaymentModal(pur);
                      }}
                      className="h-8 px-2.5 rounded-md text-[11px] bg-[#003589] hover:bg-[#0049B0] text-white font-black inline-flex items-center gap-1 cursor-pointer"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>تسجيل دفعة سداد</span>
                    </button>
                  )}
                {canSendOrEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPurchaseDetail(null);
                        setSendingPurchaseTarget(pur);
                        setSendingRecipientUserId(pur.recipientUserId || '');
                      }}
                      className="h-8 px-2.5 rounded-md text-[11px] bg-[#011E58] hover:bg-[#003589] text-white font-black inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>إرسال للإدارة</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPurchaseDetail(null);
                        handleStartEditPurchase(pur);
                      }}
                      className="h-8 px-2.5 rounded-md text-[11px] bg-amber-50 text-amber-900 border border-amber-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPurchaseDetail(null);
                    setHistoryPurchaseTarget(pur);
                  }}
                  className="h-8 px-2.5 rounded-md text-[11px] bg-slate-100 text-slate-800 font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>سجل الحالات</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportInvoiceDocument(pur)}
                  className="h-8 px-2.5 rounded-md text-[11px] bg-slate-100 text-slate-800 font-bold cursor-pointer"
                >
                  طباعة / PDF
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Existing Customer Sheet for Representative */}
      {editingCustomerTarget && (() => {
        const cleanedEditPhone = editCustPhone.replace(/[^\d+]/g, '');
        const editPhoneValid = cleanedEditPhone.replace(/\D/g, '').length >= 7;
        const mapQ = (editCustGeo || editCustAddress).trim();
        const mapsHref =
          mapQ.startsWith('http://') || mapQ.startsWith('https://')
            ? mapQ
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQ)}`;
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/65 backdrop-blur-xs">
            <form
              onSubmit={handleSaveEditedCustomer}
              className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[90vh] overflow-y-auto space-y-2 text-xs pb-safe"
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                <h4 className="font-black text-xs text-slate-900">
                  تعديل بيانات العميل — {editingCustomerTarget.shopName || editingCustomerTarget.name}
                </h4>
                <button
                  type="button"
                  onClick={() => setEditingCustomerTarget(null)}
                  className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer"
                >
                  إغلاق
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">اسم المحل</label>
                  <input
                    type="text"
                    value={editCustShop}
                    onChange={(e) => setEditCustShop(e.target.value)}
                    placeholder="اسم المحل أو النشاط"
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">اسم العميل / صاحب المحل *</label>
                  <input
                    type="text"
                    required
                    value={editCustName}
                    onChange={(e) => setEditCustName(e.target.value)}
                    placeholder="الاسم الكامل"
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold"
                  />
                </div>
              </div>

              <div className="p-2 rounded-md bg-slate-50 border border-slate-200 flex items-center gap-2">
                <div className="w-12 h-12 rounded-md border border-slate-300 bg-white overflow-hidden flex items-center justify-center shrink-0">
                  {editCustShopPhoto ? (
                    <button
                      type="button"
                      onClick={() => setPreviewShopPhoto(editCustShopPhoto)}
                      className="w-full h-full cursor-pointer"
                    >
                      <img src={editCustShopPhoto} alt="صورة المحل" className="w-full h-full object-cover" />
                    </button>
                  ) : (
                    <Store className="w-4 h-4 text-slate-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <span className="block text-[11px] font-black text-slate-800">صورة المحل</span>
                  <div className="flex flex-wrap gap-1">
                    <label className="h-7 px-2 rounded-md bg-blue-900 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer">
                      <Camera className="w-3 h-3" />
                      <span>{editCustShopPhoto ? 'تغيير بالكاميرا' : 'التقاط بالكاميرا'}</span>
                      <input
                        ref={editCustCameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleEditCustPhotoUpload}
                        className="hidden"
                      />
                    </label>
                    <label className="h-7 px-2 rounded-md bg-white text-slate-800 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer">
                      <Upload className="w-3 h-3" />
                      <span>من المعرض</span>
                      <input
                        ref={editCustGalleryInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleEditCustPhotoUpload}
                        className="hidden"
                      />
                    </label>
                    {editCustShopPhoto && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditCustShopPhoto('');
                          setEditCustPhotoChanged(false);
                          setEditCustClearPhoto(true);
                          if (editCustCameraInputRef.current) editCustCameraInputRef.current.value = '';
                          if (editCustGalleryInputRef.current) editCustGalleryInputRef.current.value = '';
                        }}
                        className="h-7 px-2 rounded-md bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold cursor-pointer"
                      >
                        حذف
                      </button>
                    )}
                  </div>
                  {isUploadingEditCustPhoto && <p className="text-[10px] font-bold text-blue-900">جاري ضغط وتجهيز الصورة...</p>}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 mb-0.5">عنوان المحل الرئيسي</label>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={editCustAddress}
                    onChange={(e) => {
                      setEditCustAddress(e.target.value);
                      if (editCustMapNotice) setEditCustMapNotice(null);
                    }}
                    placeholder="الشارع، المنطقة، علامة مميزة..."
                    className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => setLocationPickerTarget('edit')}
                    className="h-8 px-2 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                    title="تحديد موقع العميل على خريطة جوجل"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>خريطة</span>
                  </button>
                  <button
                    type="button"
                    disabled={isLocatingEditCust}
                    onClick={handleCaptureEditCustLocation}
                    className="h-8 px-2 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                    title="تحديد الموقع الحالي GPS وجلب العنوان تلقائياً"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#003589]" />
                    <span>{isLocatingEditCust ? 'تحديد...' : 'GPS'}</span>
                  </button>
                </div>
                {editCustGeo && (
                  <p className="text-[10px] font-mono text-[#003589] mt-0.5" dir="ltr">
                    GPS: {editCustGeo}
                  </p>
                )}
                {editCustMapNotice && <p className="text-[11px] font-bold text-red-600 mt-0.5">{editCustMapNotice}</p>}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">المحافظة</label>
                  <input
                    type="text"
                    value={editCustGovernorate}
                    onChange={(e) => setEditCustGovernorate(e.target.value)}
                    placeholder="المحافظة"
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">المنطقة / خط السير</label>
                  <input
                    type="text"
                    value={editCustArea}
                    onChange={(e) => setEditCustArea(e.target.value)}
                    placeholder="المنطقة / خط السير"
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-semibold"
                  />
                </div>
              </div>

              <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">رقم التليفون الرئيسي *</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="tel"
                      required
                      value={editCustPhone}
                      onChange={(e) => {
                        setEditCustPhone(e.target.value);
                        if (editCustPhoneNotice) setEditCustPhoneNotice(null);
                      }}
                      placeholder="01012345678"
                      className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-mono font-bold bg-white"
                    />
                    {editPhoneValid ? (
                      <a
                        href={`tel:${cleanedEditPhone}`}
                        className="h-8 px-2 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                      >
                        <Phone className="w-3.5 h-3.5 text-[#003589]" />
                        <span>اتصال</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setEditCustPhoneNotice({ type: 'error', text: 'يرجى إدخال رقم هاتف صحيح (7 أرقام على الأقل) أولاً.' })
                        }
                        className="h-8 px-2 rounded-md bg-slate-100 text-slate-600 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>اتصال</span>
                      </button>
                    )}
                  </div>
                  {editCustPhoneNotice && (
                    <p className="text-[10px] font-bold text-red-600 mt-0.5">{editCustPhoneNotice.text}</p>
                  )}
                </div>

                {editCustExtraPhones.length > 0 && (
                  <div className="space-y-1">
                    <label className="block font-bold text-slate-600 text-[10px]">أرقام تليفون إضافية:</label>
                    {editCustExtraPhones.map((extra, idx) => {
                      const cleanEx = extra.phone.replace(/[^\d+]/g, '');
                      const validEx = cleanEx.replace(/\D/g, '').length >= 7;
                      return (
                        <div key={extra.id || idx} className="flex flex-wrap sm:flex-nowrap items-center gap-1">
                          <input
                            type="tel"
                            value={extra.phone}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditCustExtraPhones((prev) => prev.map((row, i) => (i === idx ? { ...row, phone: v } : row)));
                            }}
                            placeholder="رقم إضافي..."
                            className="flex-1 min-w-[110px] h-8 rounded-md border border-slate-300 px-2 font-mono font-bold bg-white"
                          />
                          <select
                            value={extra.label}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditCustExtraPhones((prev) => prev.map((row, i) => (i === idx ? { ...row, label: v } : row)));
                            }}
                            className="h-8 rounded-md border border-slate-300 px-1.5 font-bold bg-white"
                          >
                            <option value="موبايل">موبايل</option>
                            <option value="محل">تليفون المحل</option>
                            <option value="واتساب">واتساب</option>
                            <option value="إضافي">إضافي</option>
                          </select>
                          {validEx && (
                            <a
                              href={`tel:${cleanEx}`}
                              className="h-8 px-2 rounded-md bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5] inline-flex items-center"
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const val = extra.phone.trim();
                              if (!val) return;
                              const prevPrimary = editCustPhone.trim();
                              setEditCustPhone(val);
                              setEditCustExtraPhones((prev) =>
                                prev
                                  .map((row, i) => (i === idx ? { ...row, phone: prevPrimary } : row))
                                  .filter((row) => row.phone.trim() !== '')
                              );
                            }}
                            className="h-8 px-2 rounded-md bg-blue-50 text-blue-900 border border-blue-200 text-[10px] font-bold cursor-pointer shrink-0"
                          >
                            رئيسي
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditCustExtraPhones((prev) => prev.filter((_, i) => i !== idx))}
                            className="h-8 w-8 rounded-md bg-red-50 text-red-600 border border-red-200 inline-flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setEditCustExtraPhones((prev) => [
                      ...prev,
                      { id: `ph-${Date.now()}-${prev.length}`, phone: '', label: 'موبايل' },
                    ])
                  }
                  className="h-7 px-2 rounded-md bg-white hover:bg-blue-50 text-blue-900 border border-blue-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>إضافة رقم تليفون آخر</span>
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 mb-0.5">ملاحظات</label>
                <input
                  type="text"
                  value={editCustNotes}
                  onChange={(e) => setEditCustNotes(e.target.value)}
                  placeholder="ملاحظات عن المحل أو المواعيد (اختياري)"
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />
              </div>

              <button
                type="submit"
                disabled={isSavingEditCustomer || isUploadingEditCustPhoto}
                className="w-full h-9 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSavingEditCustomer ? 'جاري حفظ التعديلات...' : 'حفظ التعديلات'}
              </button>
            </form>
          </div>
        );
      })()}

      {safeDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/65 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[88vh] flex flex-col gap-2 text-xs pb-safe">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <div>
                <h4 className="font-black text-xs text-red-900">حذف العميل الآمن</h4>
                <p className="text-[10px] text-slate-500">
                  يسمح النظام بالحذف فقط للعملاء ذوي الرصيد الصفرى بدون فواتير أو حركات مالية مرتبطة.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSafeDeleteModalOpen(false)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer shrink-0"
              >
                إغلاق
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={safeDeleteSearch}
                onChange={(e) => setSafeDeleteSearch(e.target.value)}
                placeholder="ابحث باسم العميل أو المحل أو الكود..."
                className="w-full h-8 rounded-md border border-slate-300 pr-7 pl-2 font-semibold outline-hidden focus:border-red-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2" />
            </div>

            <UnifiedDataTable<Customer>
              compact
              paginated={false}
              searchable={false}
              maxHeightClassName="max-h-[50vh]"
              data={data.customers.filter((c) => {
                const q = safeDeleteSearch.trim().toLowerCase();
                if (!q) return true;
                return (
                  c.name.toLowerCase().includes(q) ||
                  (c.shopName && c.shopName.toLowerCase().includes(q)) ||
                  c.code.toLowerCase().includes(q) ||
                  c.phone.includes(q)
                );
              })}
              rowKey={(c) => c.id}
              emptyTitle="لا يوجد عملاء مطابقون"
              columns={[
                {
                  key: 'shopName',
                  header: 'العميل',
                  render: (c) => (
                    <div>
                      <span className="font-black text-slate-900 block">{c.shopName || c.name}</span>
                      <span className="text-[10px] text-slate-500">{c.name} · <span className="font-mono">{c.code}</span></span>
                    </div>
                  ),
                },
                {
                  key: 'currentBalance',
                  header: 'الرصيد',
                  align: 'center',
                  render: (c) => {
                    const hasBalance = Math.abs(Number(c.currentBalance || 0)) > 0.009;
                    return (
                      <span className={`font-mono font-bold ${hasBalance ? 'text-red-700' : 'text-emerald-700'}`}>
                        {Number(c.currentBalance || 0).toLocaleString()} {data.settings.currency}
                      </span>
                    );
                  },
                },
                {
                  key: 'actions',
                  header: 'الإجراء',
                  align: 'center',
                  sortable: false,
                  render: (c) => {
                    const hasBalance = Math.abs(Number(c.currentBalance || 0)) > 0.009;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setSafeDeleteModalOpen(false);
                          setDeleteCustomerTarget(c);
                        }}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer ${
                          hasBalance
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-red-600 hover:bg-red-700 text-white'
                        }`}
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{hasBalance ? 'فحص والحذف' : 'حذف'}</span>
                      </button>
                    );
                  },
                },
              ]}
            />
          </div>
        </div>
      )}

      {/* Supplier Account Statement Modal (for Permitted Reps) */}
      {selectedSupplierDetail && (() => {
        const sup = selectedSupplierDetail;
        const stmt = supplierStatement;
        const bal = Number(stmt?.summary?.currentBalance ?? sup.currentBalance ?? 0);
        const dirText =
          bal > 0.009
            ? 'رصيد مستحق للمورد (علينا)'
            : bal < -0.009
            ? 'دفعة مقدمة عند المورد (لنا)'
            : 'الحساب متوازن';
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
            <div className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[88vh] overflow-y-auto space-y-2 text-xs pb-safe">
              <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-1.5">
                <div>
                  <h4 className="font-black text-xs text-slate-900">كشف حساب المورد — {sup.name}</h4>
                  <p className="text-[10px] text-slate-500">
                    {sup.companyName ? `${sup.companyName} · ` : ''}
                    {sup.code}
                    {sup.phone ? ` · ${sup.phone}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSupplierDetail(null)}
                  className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer shrink-0"
                >
                  إغلاق
                </button>
              </div>

              <div className="px-2 py-1 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] font-bold text-[10px]">
                رصيد حساب المورد عام للشركة، والحركات أدناه تخص فواتيرك ومرتجعاتك ودفعاتك فقط.
              </div>

              {isLoadingSupplierStmt ? (
                <div className="p-3 text-center text-slate-500 font-bold">جاري تحميل كشف حساب المورد...</div>
              ) : supStmtError ? (
                <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-700 font-bold">{supStmtError}</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden text-center tabular-nums">
                    <div className="px-2 py-1.5 bg-white">
                      <span className="text-[10px] text-[#003589] block font-bold">مشترياتك</span>
                      <strong className="font-mono text-xs text-[#011E58]">
                        {Number(stmt?.summary?.totalPurchases || 0).toLocaleString()}
                      </strong>
                    </div>
                    <div className="px-2 py-1.5 bg-white">
                      <span className="text-[10px] text-emerald-800 block">سداد/مرتجعك</span>
                      <strong className="font-mono text-xs text-emerald-800">
                        {Number(stmt?.summary?.totalDebit || 0).toLocaleString()}
                      </strong>
                    </div>
                    <div className="px-2 py-1.5 bg-white">
                      <span className="text-[10px] text-rose-800 block">{dirText}</span>
                      <strong className="font-mono text-xs text-rose-900">
                        {Math.abs(bal).toLocaleString()}
                      </strong>
                    </div>
                  </div>

                  <UnifiedDataTable
                    compact
                    paginated={false}
                    searchable={false}
                    maxHeightClassName="max-h-[42vh]"
                    data={stmt?.entries || []}
                    rowKey={(entry) => entry.id}
                    emptyTitle="لا توجد حركات مسجلة لك مع هذا المورد"
                    columns={[
                      {
                        key: 'label',
                        header: 'العملية',
                        render: (entry) => (
                          <div>
                            <span className="font-black text-slate-900 block">{entry.label}</span>
                            <span className="font-mono text-[10px] text-slate-500 block">{entry.docNumber} · {entry.date}</span>
                            {entry.description && <span className="text-[10px] text-slate-500 block">{entry.description}</span>}
                          </div>
                        ),
                      },
                      {
                        key: 'credit',
                        header: 'له (علينا)',
                        align: 'center',
                        render: (entry) => <span className="font-mono text-rose-700">{entry.credit ? entry.credit.toLocaleString() : '-'}</span>,
                      },
                      {
                        key: 'debit',
                        header: 'سداد/مرتجع',
                        align: 'center',
                        render: (entry) => <span className="font-mono text-emerald-700">{entry.debit ? entry.debit.toLocaleString() : '-'}</span>,
                      },
                      {
                        key: 'runningBalance',
                        header: 'الرصيد',
                        align: 'center',
                        render: (entry) => <strong className="font-mono text-[#011E58]">{Math.abs(Number(entry.runningBalance || 0)).toLocaleString()}</strong>,
                      },
                    ]}
                  />
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Purchase Invoice Payment Modal (Only Permitted Rep's Own Confirmed Purchases) */}
      {payingPurchaseTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSubmitPurchasePayment}
            className="w-full max-w-md bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 space-y-2 text-xs pb-safe"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <div>
                <h4 className="font-black text-xs text-slate-900">
                  تسجيل دفعة سداد — {payingPurchaseTarget.invoiceNumber}
                </h4>
                <p className="text-[10px] text-slate-500">
                  {payingPurchaseTarget.supplierName} · المتبقي:{' '}
                  {Math.max(0, Number(payingPurchaseTarget.remainingAmount || 0)).toLocaleString()} {data.settings.currency}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayingPurchaseTarget(null)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer shrink-0"
              >
                إغلاق
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                مبلغ السداد ({data.settings.currency}) *
              </label>
              <input
                type="number"
                required
                min={0.01}
                max={Math.max(0.01, Number(payingPurchaseTarget.remainingAmount || 0))}
                step="0.01"
                value={purPayAmount || ''}
                onChange={(e) => setPurPayAmount(Math.max(0, Number(e.target.value)))}
                className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-black text-center text-[#011E58]"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-700 mb-0.5">طريقة السداد</label>
                <select
                  value={purPayMethod}
                  onChange={(e) => setPurPayMethod(e.target.value as any)}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
                >
                  <option value="cash">نقدي</option>
                  <option value="bank">تحويل بنكي</option>
                  <option value="cheque">شيك</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-700 mb-0.5">التاريخ</label>
                <input
                  type="date"
                  value={purPayDate}
                  onChange={(e) => setPurPayDate(e.target.value)}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono bg-white"
                />
              </div>
            </div>

            <input
              type="text"
              value={purPayNotes}
              onChange={(e) => setPurPayNotes(e.target.value)}
              placeholder="ملاحظات السداد (اختياري)..."
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />

            <button
              type="submit"
              disabled={isSubmittingPurPayment}
              className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isSubmittingPurPayment ? 'جاري التسجيل...' : 'تأكيد تسجيل دفعة السداد'}
            </button>
          </form>
        </div>
      )}

      <CustomerLocationPickerModal
        isOpen={Boolean(locationPickerTarget)}
        onClose={() => setLocationPickerTarget(null)}
        initialLat={locationPickerTarget === 'edit' ? editCustLat : newCustLat}
        initialLng={locationPickerTarget === 'edit' ? editCustLng : newCustLng}
        initialGeoCoordinates={locationPickerTarget === 'edit' ? editCustGeo : newCustGeo}
        initialAddress={locationPickerTarget === 'edit' ? editCustAddress : newCustAddress}
        initialCity={locationPickerTarget === 'edit' ? editCustCity : newCustCity}
        initialArea={locationPickerTarget === 'edit' ? editCustArea : newCustArea}
        initialGovernorate={locationPickerTarget === 'edit' ? editCustGovernorate : newCustGovernorate}
        onConfirm={(picked: PickedCustomerLocation) => {
          if (locationPickerTarget === 'edit') {
            setEditCustGeo(picked.geoCoordinates);
            setEditCustLat(picked.latitude);
            setEditCustLng(picked.longitude);
            setEditCustLocAt(picked.locationCapturedAt);
            if (picked.address) setEditCustAddress(picked.address);
            if (picked.city) setEditCustCity(picked.city);
            if (picked.area) setEditCustArea(picked.area);
            if (picked.governorate) setEditCustGovernorate(picked.governorate);
            setEditCustMapNotice(null);
          } else {
            setNewCustGeo(picked.geoCoordinates);
            setNewCustLat(picked.latitude);
            setNewCustLng(picked.longitude);
            setNewCustLocAt(picked.locationCapturedAt);
            if (picked.address) setNewCustAddress(picked.address);
            if (picked.city) setNewCustCity(picked.city);
            if (picked.area) setNewCustArea(picked.area);
            if (picked.governorate) setNewCustGovernorate(picked.governorate);
            setCustMapNotice(null);
          }
        }}
      />

      <CustomerLocationViewerModal
        isOpen={Boolean(locationViewerData)}
        onClose={() => setLocationViewerData(null)}
        customerName={locationViewerData?.customerName || ''}
        shopName={locationViewerData?.shopName}
        address={locationViewerData?.address}
        city={locationViewerData?.city}
        area={locationViewerData?.area}
        governorate={locationViewerData?.governorate}
        geoCoordinates={locationViewerData?.geoCoordinates}
        latitude={locationViewerData?.latitude}
        longitude={locationViewerData?.longitude}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteCustomerTarget)}
        onClose={() => !isDeletingCustomer && setDeleteCustomerTarget(null)}
        onConfirm={handleConfirmDeleteCustomer}
        isLoading={isDeletingCustomer}
        variant="danger"
        title="تأكيد حذف العميل"
        message={
          deleteCustomerTarget
            ? `هل أنت متأكد من حذف العميل (${deleteCustomerTarget.shopName || deleteCustomerTarget.name})؟ يُسمح بالحذف فقط إذا لم يكن للعميل فواتير أو حركات مالية أو رصيد مفتوح.`
            : ''
        }
        confirmLabel="نعم، حذف العميل"
      />
    </div>
  );
};

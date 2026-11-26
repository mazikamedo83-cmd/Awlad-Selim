import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, FilePlus2, FileText, Truck, Search, Plus,
  Trash2, CheckCircle2, AlertCircle, AlertTriangle, Phone, MapPin,
  History, ShieldAlert, RefreshCw, Share2, FileDown, Boxes, ArrowLeftRight,
  CloudOff, CloudCheck, Camera, ShoppingBag, RotateCcw, ArrowDownCircle,
  ArrowUpCircle, UserPlus, Building2, Receipt, CreditCard, FileSpreadsheet,
  Wallet, Settings, LogOut, ChevronLeft, ChevronRight, Lock, Warehouse as WarehouseIcon,
  Barcode, X, Eye, Calculator, ClipboardCheck, Send, Clock, Edit, Upload, ExternalLink, Store, PackagePlus,
  ArrowRight, ArrowLeft, Printer, Info, Calendar, ChevronDown, ChevronUp, Sun, Moon, Monitor, Globe, BellRing, Volume2
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import {
  formatLocaleDate,
  formatLocaleDateTime,
  formatLocaleNumber,
  formatLocaleTime,
} from '../../../i18n/translator';
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
import { MobileSendReceiveScreen } from './MobileSendReceiveScreen';
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

const REP_ORDER_STATUS_LABELS_EN: Record<string, string> = {
  pending: 'New',
  under_review: 'Under Review',
  approved: 'Approved',
  invoiced: 'Invoiced',
  preparing: 'Preparing',
  rep_assigned: 'Rep Assigned',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  collected: 'Collected',
  closed: 'Closed',
  needs_review: 'Needs Review',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
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
  const { currentUser, representativeProfile, mobileConfig, hasPermission, updatePassword } = useAuth();
  const data = useData();
  const { themePreference, setThemePreference, language, setLanguage, t, dir, isRtl } = usePreferences();
  const isNative = isNativeCapacitor();

  const repNotifStorageKey = `awlad_selim_notif_prefs_${currentUser?.id || 'guest'}`;
  const [repNotifPrefs, setRepNotifPrefs] = useState<{
    soundEnabled: boolean;
    dispatchAlerts: boolean;
    orderAlerts: boolean;
  }>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(repNotifStorageKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          soundEnabled: parsed.soundEnabled !== false,
          dispatchAlerts: parsed.dispatchAlerts !== false,
          orderAlerts: parsed.orderAlerts !== false,
        };
      }
    } catch {
      // ignore
    }
    return { soundEnabled: true, dispatchAlerts: true, orderAlerts: true };
  });

  useEffect(() => {
    const reload = () => {
      try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(repNotifStorageKey) : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          setRepNotifPrefs({
            soundEnabled: parsed.soundEnabled !== false,
            dispatchAlerts: parsed.dispatchAlerts !== false,
            orderAlerts: parsed.orderAlerts !== false,
          });
        }
      } catch {
        // ignore
      }
    };
    reload();
    if (typeof window !== 'undefined') {
      window.addEventListener('awlad-notif-prefs-changed', reload);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('awlad-notif-prefs-changed', reload);
      }
    };
  }, [repNotifStorageKey]);

  const toggleRepNotifPref = (key: 'soundEnabled' | 'dispatchAlerts' | 'orderAlerts') => {
    setRepNotifPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(repNotifStorageKey, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('awlad-notif-prefs-changed'));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const [showRepPwdBox, setShowRepPwdBox] = useState(false);
  const [repCurrPwd, setRepCurrPwd] = useState('');
  const [repNewPwd, setRepNewPwd] = useState('');
  const [repConfirmPwd, setRepConfirmPwd] = useState('');
  const [repSavingPwd, setRepSavingPwd] = useState(false);
  const [repPwdMsg, setRepPwdMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
          setSupStmtError(t('تعذر تحميل كشف حساب المورد.', 'Failed to load supplier statement.'));
        }
      })
      .catch((err: any) => {
        if (active) setSupStmtError(err?.message || t('تعذر تحميل كشف حساب المورد.', 'Failed to load supplier statement.'));
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
          partyName: tx.partyName || t('عميل', 'Customer'),
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
        accountBalanceNote: t(
          'الأرصدة الظاهرة للعملاء والموردين تمثل الرصيد المالي العام على مستوى الشركة بالكامل، بينما إحصائيات وفواتير وتحصيلات التقرير تمثل عمليات هذا المندوب فقط.',
          'Displayed customer and supplier balances represent the company-wide financial balance, while report statistics, invoices, and collections reflect this representative’s operations only.'
        ),
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
        setRepReportError(err?.message || t('تعذر تحميل التقرير من الخادم.', 'Failed to load report from server.'));
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
    const targetUnit = invUnitName || selectedProduct.baseUnit;
    setInvItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.productId === selectedProduct.id && it.unit === targetUnit);
      if (existingIdx >= 0) {
        return prev.map((it, idx) => {
          if (idx !== existingIdx) return it;
          const nextQty = Number((it.quantity + qtyNum).toFixed(4));
          const nextDiscount = Number(((it.discount || 0) + safeDiscount).toFixed(2));
          return {
            ...it,
            quantity: nextQty,
            unitPrice: priceNum,
            discount: nextDiscount,
            total: computeLineTotal(nextQty, priceNum, nextDiscount),
          };
        });
      }
      return [
        ...prev,
        {
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          barcode: selectedProduct.barcode,
          unit: targetUnit,
          unitFactor,
          quantity: qtyNum,
          unitPrice: priceNum,
          purchasePriceAtTime,
          discount: safeDiscount,
          total,
        },
      ];
    });
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
      setFeedback({ type: 'error', text: t('يرجى اختيار العميل أولاً.', 'Please select a customer first.') });
      return;
    }
    if (!invItems.length) {
      setFeedback({ type: 'error', text: t('يرجى إضافة صنف واحد على الأقل للفاتورة.', 'Please add at least one item to the invoice.') });
      return;
    }
    if (!rep) {
      setFeedback({ type: 'error', text: t('حسابك غير مرتبط بملف مندوب نشط.', 'Your account is not linked to an active representative profile.') });
      return;
    }
    if (mode === 'confirmed' && shortageItems.length > 0) {
      setFeedback({
        type: 'error',
        text: t(
          'لا يمكن اعتماد فاتورة بيع بكمية تتجاوز مخزون عهدة السيارة. اطلب تحويل الأصناف أو احفظها كمسودة.',
          'Cannot confirm a sales invoice exceeding van custody stock. Request an item transfer or save as draft.'
        ),
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
      customerName: cust?.name || t('عميل', 'Customer'),
      representativeId: rep.id,
      representativeName: rep.name,
      warehouseId: effectiveVanId,
      warehouseName: wh?.name || `${t('سيارة المندوب', 'Rep Van')} (${rep.name})`,
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
      setFeedback({ type: 'error', text: res.error || t('تعذر حفظ الفاتورة', 'Failed to save invoice') });
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
        targetWarehouseName: wh?.name || `${t('سيارة المندوب', 'Rep Van')} (${rep.name})`,
        items: shortageItems.map((sh) => ({
          productId: sh.productId,
          productName: sh.productName,
          unit: sh.unit,
          requestedQty: sh.shortageQty,
          availableInVanQty: sh.availableInVanQty,
          shortageQty: sh.shortageQty,
        })),
        notes: `${t('طلب تحويل عجز آلي مرتبط بمسودة فاتورة', 'Auto shortage transfer request linked to draft invoice')} ${res.invoice.invoiceNumber}`,
      });
      setIsSubmittingInvoice(false);
      setInvItems([]);
      setInvNotes('');
      setFeedback({
        type: trRes.success ? 'success' : 'warning',
        text: trRes.success
          ? t(
              `تم حفظ الفاتورة كمسودة (${res.invoice.invoiceNumber}) وإرسال طلب التحويل رقم ${trRes.request?.requestNumber || ''} للإدارة.`,
              `Invoice saved as draft (${res.invoice.invoiceNumber}) and transfer request #${trRes.request?.requestNumber || ''} sent to management.`
            )
          : t(
              `تم حفظ الفاتورة كمسودة (${res.invoice.invoiceNumber}) لكن تعذر إرسال طلب التحويل: ${trRes.error}`,
              `Invoice saved as draft (${res.invoice.invoiceNumber}), but failed to send transfer request: ${trRes.error}`
            ),
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
        ? t(
            `تم حفظ الفاتورة محلياً (${res.invoice.invoiceNumber}) في طابور المزامنة بانتظار الإرسال من REFRESH.`,
            `Invoice saved locally (${res.invoice.invoiceNumber}) in sync queue pending send from REFRESH.`
          )
        : forceDraft
        ? t(
            `تم حفظ الفاتورة كمسودة (${res.invoice.invoiceNumber}).`,
            `Invoice saved as draft (${res.invoice.invoiceNumber}).`
          )
        : t(
            `تم اعتماد وإصدار الفاتورة (${res.invoice.invoiceNumber}) فوراً وإدراجها لمراجعة الإدارة.`,
            `Invoice (${res.invoice.invoiceNumber}) confirmed, issued immediately, and listed for management review.`
          ),
    });
    onTabChange('invoices');
  };

  // ==================== PURCHASE INVOICE HANDLERS ====================
  const purSubtotal = useMemo(() => purItems.reduce((s, i) => s + i.total, 0), [purItems]);
  const purTotal = useMemo(() => Math.max(0, purSubtotal - Math.max(0, Number(purDiscount || 0))), [purSubtotal, purDiscount]);

  const getPurchaseDispatchMeta = (inv: Invoice) => {
    if (inv.status === 'cancelled') {
      return { key: 'cancelled', label: t('ملغاة', 'Cancelled'), badgeClass: 'bg-red-50 text-red-700 border border-red-200' };
    }
    if (inv.status === 'confirmed') {
      return { key: 'confirmed', label: t('معتمدة ومرحّلة', 'Confirmed & Posted'), badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-200' };
    }
    switch (inv.dispatchStatus) {
      case 'sent':
        return { key: 'sent', label: t('مرسلة بانتظار الاستلام', 'Sent (Awaiting Receipt)'), badgeClass: 'bg-amber-50 text-amber-900 border border-amber-200' };
      case 'received':
        return { key: 'received', label: t('تم الاستلام (بانتظار الاعتماد)', 'Received (Pending Approval)'), badgeClass: 'bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5]' };
      case 'rejected':
        return { key: 'rejected', label: t('مرفوضة', 'Rejected'), badgeClass: 'bg-rose-50 text-rose-800 border border-rose-200' };
      default:
        return { key: 'draft', label: t('مسودة', 'Draft'), badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200' };
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
      setFeedback({ type: 'error', text: t('يرجى إدخال اسم الصنف الجديد أولاً.', 'Please enter the new product name first.') });
      return;
    }
    const qtyNum = Number(newPurProdQty || 0);
    if (qtyNum <= 0) {
      setFeedback({ type: 'error', text: t('يرجى إدخال كمية الشراء للصنف الجديد أكبر من صفر.', 'Please enter a purchase quantity greater than zero for the new product.') });
      return;
    }
    const buyPrice = Math.max(0, Number(newPurProdBuyPrice || 0));
    const sellPrice = newPurProdSellPrice === '' ? 0 : Math.max(0, Number(newPurProdSellPrice || 0));

    const exact = purDuplicateCheckState.exactMatch;
    if (exact) {
      const effectiveBuy = buyPrice || exact.purchasePrice || 0;
      setPurItems((prev) => {
        const existingIdx = prev.findIndex((it) => it.productId === exact.id && it.unit === exact.baseUnit);
        if (existingIdx >= 0) {
          return prev.map((it, idx) => {
            if (idx !== existingIdx) return it;
            const nextQty = Number((it.quantity + qtyNum).toFixed(4));
            return {
              ...it,
              quantity: nextQty,
              unitPrice: effectiveBuy,
              purchasePriceAtTime: effectiveBuy,
              total: computeLineTotal(nextQty, effectiveBuy, it.discount || 0),
            };
          });
        }
        return [
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
        ];
      });
      setFeedback({
        type: 'success',
        text: t(
          `تم ربط البند بالصنف الموجود (${exact.name}) لمنع التكرار في المخزن.`,
          `Line item linked to existing product (${exact.name}) to prevent inventory duplication.`
        ),
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
        text: t(
          `تمت إضافة الصنف الجديد (${cleanName}) لبنود المسودة؛ سيُدرج بالمخزون عند اعتماد الإدارة.`,
          `New product (${cleanName}) added to draft items; it will be added to inventory upon management approval.`
        ),
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
    const targetUnit = purUnitName || prod.baseUnit;
    const perBaseCost = factor > 0 ? Number((priceNum / factor).toFixed(2)) : priceNum;
    setPurItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.productId === prod.id && it.unit === targetUnit);
      if (existingIdx >= 0) {
        return prev.map((it, idx) => {
          if (idx !== existingIdx) return it;
          const nextQty = Number((it.quantity + qtyNum).toFixed(4));
          return {
            ...it,
            quantity: nextQty,
            unitPrice: priceNum,
            purchasePriceAtTime: perBaseCost,
            total: computeLineTotal(nextQty, priceNum, it.discount || 0),
          };
        });
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          barcode: prod.barcode,
          unit: targetUnit,
          unitFactor: factor,
          quantity: qtyNum,
          unitPrice: priceNum,
          purchasePriceAtTime: perBaseCost,
          discount: 0,
          total: computeLineTotal(qtyNum, priceNum),
        },
      ];
    });
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
      setFeedback({ type: 'error', text: t('يرجى اختيار المورد وإضافة صنف واحد على الأقل.', 'Please select a supplier and add at least one item.') });
      return;
    }
    setFeedback(null);
    setPurReviewOpen(true);
  };

  const handleSubmitPurchaseInvoice = async (sendNow: boolean) => {
    if (!purSupplierId || !purItems.length) {
      setFeedback({ type: 'error', text: t('يرجى اختيار المورد وإضافة صنف واحد على الأقل.', 'Please select a supplier and add at least one item.') });
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
        supplierName: sup?.name || t('مورد', 'Supplier'),
        warehouseId: whId,
        warehouseName: wh?.name || t('المخزن الرئيسي', 'Main Warehouse'),
        discountTotal: Math.max(0, Number(purDiscount || 0)),
        paidAmount: paid,
        paymentType: purPaymentType,
        notes: purNotes.trim() || undefined,
        reason: t('تعديل فاتورة الشراء قبل الإرسال', 'Purchase invoice edited prior to dispatch'),
        items: purItems,
      });
      if (!editRes.success) {
        setIsSubmittingPurchase(false);
        setFeedback({ type: 'error', text: editRes.error || t('تعذر حفظ تعديلات فاتورة الشراء', 'Failed to save purchase invoice changes') });
        return;
      }

      if (sendNow) {
        const sendRes = await data.sendPurchaseInvoice(purEditingInvoiceId, {
          recipientUserId: chosenRecipient?.id || undefined,
          recipientName: chosenRecipient?.fullName || t('الإدارة العامة', 'General Management'),
        });
        setIsSubmittingPurchase(false);
        if (!sendRes.success) {
          setFeedback({ type: 'error', text: sendRes.error || t('تم حفظ التعديل لكن تعذر إرسال الفاتورة للإدارة', 'Changes saved, but failed to send invoice to management') });
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
          ? t('تم تحديث فاتورة الشراء وإرسالها للإدارة بانتظار الاستلام والمراجعة.', 'Purchase invoice updated and sent to management for receipt and review.')
          : t('تم تحديث وحفظ فاتورة الشراء كمسودة دون تعديل أرصدة المخازن.', 'Purchase invoice updated and saved as draft without modifying inventory balances.'),
      });
      onTabChange('purchases-list');
      return;
    }

    const res = await data.createPurchaseInvoice({
      date: new Date().toISOString().split('T')[0],
      supplierId: purSupplierId,
      supplierName: sup?.name || t('مورد', 'Supplier'),
      representativeId: rep?.id,
      representativeName: rep?.name,
      warehouseId: whId,
      warehouseName: wh?.name || t('المخزن الرئيسي', 'Main Warehouse'),
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
      recipientName: sendNow ? (chosenRecipient?.fullName || t('الإدارة العامة', 'General Management')) : undefined,
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
          ? t(
              `تم حفظ فاتورة الشراء كمسودة (${res.invoice?.invoiceNumber || ''}) محلياً للمزامنة عبر REFRESH.`,
              `Purchase invoice saved as draft (${res.invoice?.invoiceNumber || ''}) locally to sync via REFRESH.`
            )
          : sendNow
          ? t(
              `تم إرسال فاتورة الشراء (${res.invoice?.invoiceNumber || ''}) للإدارة بانتظار الاستلام والاعتماد.`,
              `Purchase invoice (${res.invoice?.invoiceNumber || ''}) sent to management for receipt and approval.`
            )
          : t(
              `تم حفظ فاتورة الشراء كمسودة (${res.invoice?.invoiceNumber || ''}) دون ترحيل للمخزون.`,
              `Purchase invoice saved as draft (${res.invoice?.invoiceNumber || ''}) without posting to inventory.`
            ),
      });
      onTabChange('purchases-list');
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر حفظ فاتورة الشراء', 'Failed to save purchase invoice') });
    }
  };

  // ==================== RETURNS HANDLERS ====================
  const sRetTotal = useMemo(() => sRetItems.reduce((s, i) => s + i.total, 0), [sRetItems]);
  const pRetTotal = useMemo(() => pRetItems.reduce((s, i) => s + i.total, 0), [pRetItems]);

  const handleSubmitSalesReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sRetCustomerId || !sRetItems.length) {
      setFeedback({ type: 'error', text: t('يرجى اختيار العميل وإضافة صنف للمرتجع.', 'Please select a customer and add an item to return.') });
      return;
    }
    const cust = data.customers.find((c) => c.id === sRetCustomerId);
    const whId = sRetWarehouseId || effectiveVanId;
    const wh = data.warehouses.find((w) => w.id === whId);
    const inv = data.invoices.find((i) => i.id === sRetInvoiceId);

    if ((isRepRoleAccount || !canCashOps) && (!inv || inv.status !== 'confirmed')) {
      setFeedback({
        type: 'error',
        text: t('يرجى اختيار فاتورة مبيعات أصلية معتمدة أولاً لإتمام المرتجع.', 'Please select a confirmed original sales invoice first to complete the return.'),
      });
      return;
    }

    const requiresSalesRequest = sRetSettlement === 'cash' && (isRepRoleAccount || !canCashOps);
    if (requiresSalesRequest) {
      if (!inv || inv.status !== 'confirmed') {
        setFeedback({ type: 'error', text: t('لرفع طلب مرتجع مبيعات نقدي، يجب اختيار فاتورة مبيعات أصلية معتمدة أولاً.', 'To submit a cash sales return request, select a confirmed original sales invoice first.') });
        return;
      }
      if (!sRetReason.trim()) {
        setFeedback({ type: 'error', text: t('يرجى كتابة سبب طلب مرتجع المبيعات النقدي.', 'Please enter a reason for the cash sales return request.') });
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
            ? t(
                'تم حفظ طلب مرتجع المبيعات النقدي محلياً في طابور المزامنة لمراجعة الخزينة والإدارة — لن يتغير رصيد الخزينة قبل الاعتماد.',
                'Cash sales return request saved locally in sync queue for treasury and management review — cashbox balance will not change until approved.'
              )
            : t(
                `تم رفع طلب مرتجع المبيعات النقدي (${reqRes.request?.requestNumber || ''}) لمراجعة الإدارة والخزينة دون التأثير على الخزينة حتى الاعتماد.`,
                `Cash sales return request (${reqRes.request?.requestNumber || ''}) submitted for management and treasury review without affecting cashbox until approved.`
              ),
        });
        onTabChange('sales-returns-list');
      } else {
        setFeedback({ type: 'error', text: reqRes.error || t('تعذر رفع طلب مرتجع البيع النقدي', 'Failed to submit cash sales return request') });
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
      partyName: cust?.name || t('عميل', 'Customer'),
      warehouseId: whId,
      warehouseName: wh?.name || t('سيارة المندوب', 'Rep Van'),
      items: sRetItems,
      grandTotal: sRetTotal,
      refundType: sRetSettlement === 'cash' && canCashOps && !isRepRoleAccount ? 'cash' : 'balance',
      cashboxId: sRetSettlement === 'cash' && canCashOps && !isRepRoleAccount ? sRetCashboxId : undefined,
      reason: sRetReason.trim() || t('مرتجع مبيعات من المندوب', 'Sales return by representative'),
    });
    setIsSubmittingSRet(false);
    if (res.success) {
      setSRetItems([]);
      setSRetReason('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? t('تم حفظ مرتجع البيع محلياً في طابور المزامنة.', 'Sales return saved locally in sync queue.')
          : t('تم تسجيل مرتجع البيع وتحديث المخزون وحساب العميل.', 'Sales return recorded and inventory and customer balance updated.'),
      });
      onTabChange('sales-returns-list');
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر تسجيل مرتجع البيع', 'Failed to record sales return') });
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
        setFeedback({ type: 'error', text: t('يرجى اختيار فاتورة شراء معتمدة خاصة بك أولاً.', 'Please select one of your confirmed purchase invoices first.') });
        return;
      }
      if (!pRetItems.length) {
        setFeedback({ type: 'error', text: t('يرجى إضافة صنف واحد على الأقل من بنود الفاتورة المحددة.', 'Please add at least one item from the selected invoice.') });
        return;
      }
      if (!pRetReason.trim()) {
        setFeedback({ type: 'error', text: t('يرجى كتابة سبب طلب مرتجع المشتريات (حقل إلزامي).', 'Please enter a reason for the purchase return request (required).') });
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
            ? t(
                'تم حفظ طلب مرتجع المشتريات محلياً في طابور المزامنة — سيتم إرساله للإدارة عند المزامنة ولن يتغير المخزون أو حساب المورد قبل الاعتماد.',
                'Purchase return request saved locally in sync queue — it will be sent upon sync, and stock/supplier balance will not change before approval.'
              )
            : t(
                `تم إرسال طلب مرتجع المشتريات (${res.request?.requestNumber || ''}) للإدارة للمراجعة والاعتماد — لن يتغير المخزون أو حساب المورد قبل اعتماد الإدارة.`,
                `Purchase return request (${res.request?.requestNumber || ''}) sent to management for review — stock and supplier balance will not change until approved.`
              ),
        });
        onTabChange('purchase-returns-list');
      } else {
        setFeedback({ type: 'error', text: res.error || t('تعذر إرسال طلب مرتجع المشتريات.', 'Failed to submit purchase return request.') });
      }
      return;
    }

    if (!pRetSupplierId || !pRetItems.length) {
      setFeedback({ type: 'error', text: t('يرجى اختيار المورد وإضافة صنف لمرتجع الشراء.', 'Please select a supplier and add an item to return.') });
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
      partyName: sup?.name || t('مورد', 'Supplier'),
      warehouseId: whId,
      warehouseName: wh?.name || t('المخزن الرئيسي', 'Main Warehouse'),
      items: pRetItems,
      grandTotal: pRetTotal,
      refundType: pRetSettlement === 'cash' && !isRepRoleAccount && canCashOps ? 'cash' : 'balance',
      cashboxId: pRetSettlement === 'cash' && !isRepRoleAccount && canCashOps ? pRetCashboxId : undefined,
      reason: pRetReason.trim() || t('مرتجع مشتريات للمورد', 'Purchase return to supplier'),
    });
    setIsSubmittingPRet(false);
    if (res.success) {
      setPRetItems([]);
      setPRetReason('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? t('تم حفظ مرتجع الشراء محلياً في طابور المزامنة.', 'Purchase return saved locally in sync queue.')
          : t('تم تسجيل مرتجع المشتريات وتحديث المخزون وحساب المورد.', 'Purchase return recorded and inventory and supplier balance updated.'),
      });
      onTabChange('purchase-returns-list');
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر تسجيل مرتجع الشراء', 'Failed to record purchase return') });
    }
  };

  // ==================== CASH DEPOSIT / WITHDRAWAL HANDLERS ====================
  const handleSubmitCashDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const depNum = Number(depAmount || 0);
    if (depNum <= 0) {
      setFeedback({ type: 'error', text: t('يرجى إدخال مبلغ صحيح أكبر من الصفر.', 'Please enter a valid amount greater than zero.') });
      return;
    }
    if (isRepRoleAccount && depMode === 'cashbox_deposit') {
      setFeedback({
        type: 'error',
        text: t(
          'غير مصرح للمندوب بتنفيذ إيداع مباشر بالخزينة؛ استخدم تحصيل من عميل أو توريد عهدة.',
          'Representatives are not authorized for direct cashbox deposits; use customer collection or custody remittance.'
        ),
      });
      return;
    }
    setIsSubmittingDeposit(true);
    setFeedback(null);
    try {
      if (depMode === 'customer_collection') {
        if (!depCustomerId) {
          setFeedback({ type: 'error', text: t('يرجى اختيار العميل للتحصيل منه.', 'Please select a customer to collect from.') });
          return;
        }
        const res = await data.recordCustomerPayment(
          depCustomerId,
          depNum,
          isRepRoleAccount || !canCashOps ? '' : depCashboxId,
          depNotes.trim() || t('تحصيل نقدي عبر تطبيق المندوب', 'Cash collection via representative app'),
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
              ? t('تم حفظ التحصيل محلياً بانتظار المزامنة.', 'Collection saved locally pending sync.')
              : t('تم تسجيل التحصيل من العميل وتحديث الرصيد.', 'Customer collection recorded and balance updated.'),
          });
        } else {
          setFeedback({ type: 'error', text: res.error || t('تعذر تسجيل التحصيل', 'Failed to record collection') });
        }
      } else {
        const res = await data.executeCashOperation({
          type: 'cash_deposit',
          cashboxId: depCashboxId,
          amount: depNum,
          date: depDate || new Date().toISOString().split('T')[0],
          category: 'إيداع نقدي',
          recipientOrPayer: rep?.name || currentUser?.fullName || t('المندوب', 'Representative'),
          notes: depNotes.trim() || t('إيداع نقدي من الشاشة الرئيسية', 'Cash deposit from main screen'),
        });
        if (res.success) {
          setDepAmount('');
          setDepNotes('');
          setFeedback({
            type: res.queuedOffline ? 'warning' : 'success',
            text: res.queuedOffline
              ? t('تم حفظ الإيداع النقدي محلياً في طابور المزامنة بانتظار الإرسال.', 'Cash deposit saved locally in sync queue pending send.')
              : t('تم تسجيل الإيداع النقدي بالخزينة بنجاح.', 'Cashbox deposit recorded successfully.'),
          });
        } else {
          setFeedback({ type: 'error', text: res.error || t('تعذر تسجيل الإيداع النقدي', 'Failed to record cash deposit') });
        }
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || t('تعذر تسجيل الإيداع النقدي', 'Failed to record cash deposit') });
    } finally {
      setIsSubmittingDeposit(false);
    }
  };

  const handleSubmitCashWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRepRoleAccount || !canCashOps) {
      setFeedback({
        type: 'error',
        text: t(
          'غير مصرح لحساب المندوب بتنفيذ سحب أو مصروف مباشر من الخزينة.',
          'Representative accounts are not authorized for direct cashbox withdrawals or expenses.'
        ),
      });
      return;
    }
    const wdNum = Number(wdAmount || 0);
    if (wdNum <= 0) {
      setFeedback({ type: 'error', text: t('يرجى إدخال مبلغ سحب صحيح أكبر من الصفر.', 'Please enter a valid withdrawal amount greater than zero.') });
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
        notes: wdNotes.trim() || t('سحب نقدي عبر تطبيق المندوب', 'Cash withdrawal via representative app'),
      });
      if (res.success) {
        setWdAmount('');
        setWdCategory('');
        setWdNotes('');
        setFeedback({
          type: res.queuedOffline ? 'warning' : 'success',
          text: res.queuedOffline
            ? t('تم حفظ السحب / المصروف محلياً في طابور المزامنة بانتظار الإرسال.', 'Withdrawal / expense saved locally in sync queue pending send.')
            : t('تم تسجيل السحب / المصروف النقدي بنجاح.', 'Cash withdrawal / expense recorded successfully.'),
        });
      } else {
        setFeedback({ type: 'error', text: res.error || t('تعذر تسجيل السحب النقدي', 'Failed to record cash withdrawal') });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || t('تعذر تسجيل السحب النقدي', 'Failed to record cash withdrawal') });
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
      setFeedback({ type: 'error', text: t('يرجى إدخال مبلغ سداد صحيح أكبر من الصفر.', 'Please enter a valid payment amount greater than zero.') });
      return;
    }
    if (purPayAmount > rem + 0.01) {
      setFeedback({
        type: 'error',
        text: t(
          `مبلغ السداد يتجاوز المتبقي على الفاتورة (${formatLocaleNumber(rem)}).`,
          `Payment amount exceeds the invoice remaining balance (${formatLocaleNumber(rem)}).`
        ),
      });
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
        notes: purPayNotes.trim() || `${t('دفعة سداد فاتورة شراء', 'Purchase invoice payment')} ${payingPurchaseTarget.invoiceNumber}`,
      });
      if (res.success) {
        const paidNum = payingPurchaseTarget.invoiceNumber;
        setPayingPurchaseTarget(null);
        setFeedback({
          type: res.queuedOffline ? 'warning' : 'success',
          text: res.queuedOffline
            ? t(`تم حفظ دفعة السداد للفاتورة ${paidNum} محلياً بانتظار المزامنة.`, `Payment for invoice ${paidNum} saved locally pending sync.`)
            : t(`تم تسجيل دفعة سداد للفاتورة ${paidNum} وتحديث رصيد المورد بنجاح.`, `Payment for invoice ${paidNum} recorded and supplier balance updated.`),
        });
      } else {
        setFeedback({ type: 'error', text: res.error || t('تعذر تسجيل دفعة السداد', 'Failed to record payment') });
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
      setFeedback({ type: 'error', text: err?.message || t('تعذر معالجة صورة المحل', 'Failed to process shop photo') });
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
            setFeedback({ type: 'success', text: t('تم التقاط إحداثيات GPS وجلب العنوان والمحافظة تلقائياً.', 'GPS coordinates captured and address/governorate fetched automatically.') });
            return;
          }
          setCustMapNotice(rev.error);
          setFeedback({ type: 'warning', text: t('تم التقاط إحداثيات GPS، وتعذر جلب العنوان تلقائياً — يمكنك كتابته يدوياً.', 'GPS coordinates captured, but auto address lookup failed — you can enter it manually.') });
          return;
        }
        setFeedback({ type: 'success', text: t('تم التقاط إحداثيات GPS للعميل.', 'Customer GPS coordinates captured.') });
      } else {
        setFeedback({ type: 'error', text: res.error || t('تعذر تحديد الموقع الجغرافي', 'Failed to determine geographic location') });
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
      setFeedback({ type: 'error', text: t('يرجى إدخال اسم العميل ورقم الهاتف الرئيسي.', 'Please enter customer name and primary phone number.') });
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
      setFeedback({ type: 'error', text: t('إحداثيات (0, 0) غير صالحة — يرجى تحديد موقع حقيقي على الخريطة.', 'Coordinates (0, 0) are invalid — please pick a real location on the map.') });
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
      setFeedback({
        type: 'success',
        text: t(
          `تم إضافة العميل (${cust.shopName || cust.name}) بجميع بياناته وصورته بنجاح.`,
          `Customer (${cust.shopName || cust.name}) added with all details and photo successfully.`
        ),
      });
      onTabChange('customers');
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || t('تعذر إضافة العميل', 'Failed to add customer') });
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
      setFeedback({ type: 'error', text: err?.message || t('تعذر معالجة صورة المحل', 'Failed to process shop photo') });
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
            setFeedback({ type: 'success', text: t('تم تحديث إحداثيات GPS وجلب العنوان والمحافظة تلقائياً.', 'GPS coordinates updated and address/governorate fetched automatically.') });
            return;
          }
          setEditCustMapNotice(rev.error);
          setFeedback({ type: 'warning', text: t('تم تحديث إحداثيات GPS، وتعذر جلب العنوان تلقائياً — يمكنك كتابته يدوياً.', 'GPS coordinates updated, but auto address lookup failed — you can enter it manually.') });
          return;
        }
        setFeedback({ type: 'success', text: t('تم تحديث إحداثيات GPS للعميل.', 'Customer GPS coordinates updated.') });
      } else {
        setFeedback({ type: 'error', text: res.error || t('تعذر تحديد الموقع الجغرافي', 'Failed to determine geographic location') });
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
      setFeedback({ type: 'error', text: t('يرجى إدخال اسم العميل ورقم الهاتف الرئيسي.', 'Please enter customer name and primary phone number.') });
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
      setFeedback({ type: 'error', text: t('إحداثيات (0, 0) غير صالحة — يرجى تحديد موقع حقيقي على الخريطة.', 'Coordinates (0, 0) are invalid — please pick a real location on the map.') });
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
          ? t(
              `تم حفظ تعديل بيانات (${nextDetail.shopName || nextDetail.name}) محلياً بانتظار المزامنة.`,
              `Changes for (${nextDetail.shopName || nextDetail.name}) saved locally pending sync.`
            )
          : t(
              `تم تحديث بيانات (${nextDetail.shopName || nextDetail.name}) بنجاح.`,
              `Customer (${nextDetail.shopName || nextDetail.name}) details updated successfully.`
            ),
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || t('تعذر حفظ تعديلات العميل', 'Failed to save customer updates') });
    } finally {
      setIsSavingEditCustomer(false);
    }
  };

  const handleSaveNewSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupName.trim() || !newSupPhone.trim()) {
      setFeedback({ type: 'error', text: t('يرجى إدخال اسم المورد ورقم الهاتف.', 'Please enter supplier name and phone number.') });
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
        notes: newSupCompany.trim() ? `${t('الشركة:', 'Company:')} ${newSupCompany.trim()}` : undefined,
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
        text: t(`تم تسجيل المورد (${sup.name}) بنجاح.`, `Supplier (${sup.name}) registered successfully.`),
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || t('تعذر حفظ المورد', 'Failed to save supplier') });
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
    const targetUnit = quoteUnitName || prod.baseUnit;
    setQuoteItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.productId === prod.id && it.unit === targetUnit);
      if (existingIdx >= 0) {
        return prev.map((it, idx) => {
          if (idx !== existingIdx) return it;
          const nextQty = Number((it.quantity + qQty).toFixed(4));
          return {
            ...it,
            quantity: nextQty,
            unitPrice: qPrice,
            total: computeLineTotal(nextQty, qPrice, it.discount || 0),
          };
        });
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          barcode: prod.barcode,
          unit: targetUnit,
          unitFactor: factor,
          quantity: qQty,
          unitPrice: qPrice,
          purchasePriceAtTime: prod.purchasePrice * factor,
          discount: 0,
          total: computeLineTotal(qQty, qPrice),
        },
      ];
    });
    setQuoteProductId('');
    setQuoteQty('');
    setQuotePrice('');
  };

  const handleCreateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quoteItems.length) {
      setFeedback({ type: 'error', text: t('يرجى إضافة صنف واحد على الأقل لعرض السعر.', 'Please add at least one item to the price quote.') });
      return;
    }
    const cust = data.customers.find((c) => c.id === quoteCustomerId);
    setIsSubmittingQuote(true);
    setFeedback(null);
    const res = await data.createSalesQuote({
      date: new Date().toISOString().split('T')[0],
      customerId: quoteCustomerId || undefined,
      customerName: cust?.name || t('عميل عام', 'Walk-in Customer'),
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
      notes: quoteNotes.trim() || t('عرض سعر بدون تأثير مخزني أو مالي', 'Price quote without stock or financial impact'),
    });
    setIsSubmittingQuote(false);
    if (res.success) {
      setQuoteItems([]);
      setQuoteNotes('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? t(
              `تم حفظ عرض السعر (${res.invoice?.invoiceNumber || ''}) محلياً بانتظار المزامنة.`,
              `Price quote (${res.invoice?.invoiceNumber || ''}) saved locally pending sync.`
            )
          : t(
              `تم إنشاء عرض السعر (${res.invoice?.invoiceNumber || ''}) دون أي تأثير على المخزون أو الحسابات.`,
              `Price quote (${res.invoice?.invoiceNumber || ''}) created with no impact on stock or accounts.`
            ),
      });
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر حفظ عرض السعر', 'Failed to save price quote') });
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
        text: t(
          `تم تحويل عرض السعر إلى فاتورة مبيعات (${res.invoice?.invoiceNumber || ''}) بنجاح.`,
          `Price quote converted to sales invoice (${res.invoice?.invoiceNumber || ''}) successfully.`
        ),
      });
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر تحويل عرض السعر لفاتورة', 'Failed to convert quote to invoice') });
    }
  };

  // ==================== CHEQUES & INSTALLMENTS HANDLERS ====================
  const handleAddCheque = async (e: React.FormEvent) => {
    e.preventDefault();
    const chqNumAmt = Number(chqAmount || 0);
    if (!chqNumber.trim() || !chqPartyName.trim() || chqNumAmt <= 0) {
      setFeedback({ type: 'error', text: t('يرجى استكمال رقم الشيك والجهة والمبلغ.', 'Please complete cheque number, party, and amount.') });
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
        bankName: chqBank.trim() || t('بنك', 'Bank'),
        amount: chqNumAmt,
        dueDate: chqDueDate,
        issueDate: new Date().toISOString().split('T')[0],
        status: 'pending',
      });
      setChqNumber('');
      setChqPartyName('');
      setChqBank('');
      setChqAmount('');
      setFeedback({ type: 'success', text: t('تم تسجيل الشيك بنجاح.', 'Cheque recorded successfully.') });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || t('تعذر حفظ الشيك', 'Failed to save cheque') });
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
      setFeedback({ type: 'error', text: t('يرجى اختيار العميل وإضافة صنف واحد على الأقل.', 'Please select a customer and add at least one item.') });
      return;
    }
    const cust = data.customers.find((c) => c.id === ordCustomerId);
    setIsSubmittingOrder(true);
    setFeedback(null);
    const res = await data.createCustomerItemOrder({
      customerId: ordCustomerId,
      customerName: cust?.name || t('عميل', 'Customer'),
      customerPhone: cust?.phone,
      shopName: cust?.shopName || cust?.name,
      deliveryAddress: cust?.address,
      geoCoordinates: cust?.geoCoordinates,
      requesterType: 'representative',
      items: ordItems,
      totalAmount: ordTotalAmount,
      notes: ordNotes.trim() || t('طلب شراء مرسل من المندوب', 'Purchase order submitted by representative'),
    });
    setIsSubmittingOrder(false);
    if (res.success || res.queuedOffline) {
      setOrdItems([]);
      setOrdNotes('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? t(`تم حفظ الطلب محلياً (${res.order?.requestNumber || ''}) بانتظار المزامنة.`, `Order saved locally (${res.order?.requestNumber || ''}) pending sync.`)
          : t(`تم إرسال الطلب رقم ${res.order?.requestNumber || ''} للإدارة.`, `Order #${res.order?.requestNumber || ''} sent to management.`),
      });
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر إرسال الطلب', 'Failed to send order') });
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
            ? t(`تم تسجيل بدء التوصيل للطلب ${ord.requestNumber} محلياً.`, `Delivery start for order ${ord.requestNumber} saved locally.`)
            : t(`الطلب ${ord.requestNumber} الآن في حالة (جاري التوصيل).`, `Order ${ord.requestNumber} is now Out for Delivery.`),
        });
      } else {
        setFeedback({ type: 'error', text: res.error || t('تعذر تحديث حالة التوصيل', 'Failed to update delivery status') });
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
            ? t(`تم حفظ تأكيد تسليم الطلب ${deliveringOrder.requestNumber} محلياً.`, `Delivery confirmation for order ${deliveringOrder.requestNumber} saved locally.`)
            : t(`تم تسجيل تسليم الطلب ${deliveringOrder.requestNumber} بنجاح.`, `Order ${deliveringOrder.requestNumber} delivery recorded successfully.`),
        });
        setDeliveringOrder(null);
      } else {
        setFeedback({ type: 'error', text: res.error || t('تعذر تأكيد التسليم', 'Failed to confirm delivery') });
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
      return (a.shopName || a.name).localeCompare(b.shopName || b.name, language);
    });
  }, [data.customers, customerSearch, customerFilterMode, customerSortMode, language]);

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
      setFeedback({
        type: 'success',
        text: t(
          `تم حذف العميل (${deleteCustomerTarget.shopName || deleteCustomerTarget.name}) بنجاح.`,
          `Customer (${deleteCustomerTarget.shopName || deleteCustomerTarget.name}) deleted successfully.`
        ),
      });
      if (selectedCustomerDetail?.id === deleteCustomerTarget.id) {
        setSelectedCustomerDetail(null);
      }
      setDeleteCustomerTarget(null);
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر حذف العميل.', 'Failed to delete customer.') });
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
              ? t('تم رفض طلب تحويل الأصناف المرتبط من الإدارة', 'Linked item transfer request was rejected by management')
              : t('بانتظار موافقة وصرف الإدارة لطلب التحويل المرتبط', 'Awaiting management approval and dispatch for linked transfer request'),
        };
      }
    }
    return { ready: true };
  };

  const handleConfirmDraft = async (inv: Invoice) => {
    setFeedback(null);
    const res = await data.confirmDraftInvoice(inv.id);
    if (res.success) {
      setFeedback({
        type: 'success',
        text: t(
          `تم اعتماد الفاتورة ${inv.invoiceNumber} نهائياً وتحديث المخزون والحساب.`,
          `Invoice ${inv.invoiceNumber} confirmed finally and stock/account updated.`
        ),
      });
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر اعتماد المسودة', 'Failed to confirm draft') });
    }
  };

  const handleConfirmItemReceived = async (reqId: string, reqNum: string) => {
    setFeedback(null);
    const res = await data.updateRepItemTransferStatus(reqId, 'received');
    if (res.success) {
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? t(`تم تسجيل استلام ${reqNum} محلياً بانتظار المزامنة.`, `Receipt of ${reqNum} saved locally pending sync.`)
          : t(`تم تأكيد استلام أصناف التحويل ${reqNum} على سيارتك.`, `Transfer items for ${reqNum} confirmed received in your van.`),
      });
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر تأكيد الاستلام', 'Failed to confirm receipt') });
    }
  };

  const handleRecordPartialCustodyDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    const dQty = Number(delivQty || 0);
    if (!delivProdId || dQty <= 0) {
      setFeedback({ type: 'error', text: t('يرجى اختيار الصنف وكمية التسليم الجزئي.', 'Please select product and partial delivery quantity.') });
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
      notes: delivNotes.trim() || t('تسليم عهدة جزئي لعميل من تطبيق المندوب', 'Partial custody delivery to customer from representative app'),
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setDelivProdId('');
      setDelivQty('');
      setDelivNotes('');
      setFeedback({
        type: res.queuedOffline ? 'warning' : 'success',
        text: res.queuedOffline
          ? t('تم تسجيل تسليم العهدة محلياً بانتظار المزامنة.', 'Custody delivery saved locally pending sync.')
          : t('تم تسجيل تسليم العهدة وتحديث المتبقي في سيارة المندوب.', 'Custody delivery recorded and van balance updated.'),
      });
      loadCustodyStatement();
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر تسجيل تسليم العهدة', 'Failed to record custody delivery') });
    }
  };

  const handleRecordCustodyReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    const rQty = Number(retCustodyQty || 0);
    if (!retCustodyProdId || rQty <= 0) {
      setFeedback({ type: 'error', text: t('يرجى اختيار الصنف والكمية المرتجعة للمخزن.', 'Please select product and quantity to return to warehouse.') });
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
        text: t(
          `الكمية المطلوب إرجاعها (${formatLocaleNumber(rQty * factor)} ${prod?.baseUnit || ''}) تتجاوز المتاح في عهدة السيارة (${formatLocaleNumber(vanAvail)}).`,
          `Requested return quantity (${formatLocaleNumber(rQty * factor)} ${prod?.baseUnit || ''}) exceeds available van custody (${formatLocaleNumber(vanAvail)}).`
        ),
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
      notes: retCustodyNotes.trim() || t('إرجاع بضاعة من عهدة المندوب للمخزن الرئيسي', 'Return goods from representative custody to main warehouse'),
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
          ? t('تم حفظ إرجاع العهدة للمخزن محلياً بانتظار المزامنة.', 'Custody return to warehouse saved locally pending sync.')
          : t('تم تسجيل إرجاع العهدة إلى المخزن وتحديث الأرصدة بنجاح.', 'Custody return to warehouse recorded and balances updated.'),
      });
      loadCustodyStatement();
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر إرجاع الصنف للمخزن', 'Failed to return item to warehouse') });
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
      targetWarehouseName: wh?.name || `${t('سيارة المندوب', 'Rep Van')} (${rep.name})`,
      items: reqItems,
      notes: t('طلب تغذية عهدة سيارة من تطبيق المندوب', 'Van custody replenishment request from representative app'),
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setReqItems([]);
      setFeedback({
        type: 'success',
        text: t(
          `تم إرسال طلب التحويل ${res.request?.requestNumber || ''} للإدارة.`,
          `Transfer request ${res.request?.requestNumber || ''} sent to management.`
        ),
      });
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر إرسال طلب التحويل', 'Failed to send transfer request') });
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
      receiverName: t('الفرع الرئيسي (الخزينة)', 'Main Branch (Treasury)'),
      amount: cashAmount,
      cashboxId: data.cashboxes[0]?.id || 'CASH-01',
      notes: cashNotes.trim() || t('توريد تحصيلات من تطبيق المندوب', 'Collections remittance from representative app'),
    });
    setIsSendingTransfer(false);
    if (res.success) {
      setCashAmount(0);
      setCashNotes('');
      setFeedback({
        type: 'success',
        text: t(
          `تم إرسال إشعار التوريد النقدي رقم ${res.transfer?.transferNumber || ''} بانتظار تأكيد الخزينة.`,
          `Cash remittance notice #${res.transfer?.transferNumber || ''} sent pending treasury confirmation.`
        ),
      });
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر إرسال التحويل النقدي', 'Failed to send cash transfer') });
    }
  };

  const handleConfirmOwnerCash = async (transferId: string) => {
    const res = await data.confirmRepTransferReceipt(transferId, t('تم الاستلام الفعلي عبر تطبيق المندوب', 'Actual receipt confirmed via representative app'));
    if (res.success) {
      setFeedback({ type: 'success', text: t('تم تأكيد استلام العهدة النقدية وتحديث رصيدك.', 'Cash custody receipt confirmed and your balance updated.') });
    } else {
      setFeedback({ type: 'error', text: res.error || t('تعذر تأكيد الاستلام', 'Failed to confirm receipt') });
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
      title:
        inv.type === 'quote'
          ? t('عرض سعر', 'Price Quote')
          : inv.type === 'purchase'
          ? t('فاتورة مشتريات', 'Purchase Invoice')
          : inv.status === 'draft'
          ? t('مسودة فاتورة مبيعات', 'Draft Sales Invoice')
          : t('فاتورة مبيعات', 'Sales Invoice'),
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
        { label: inv.type === 'purchase' ? t('المورد', 'Supplier') : t('العميل', 'Customer'), value: inv.supplierName || inv.customerName || '-' },
        { label: t('المخزن', 'Warehouse'), value: inv.warehouseName || '-' },
      ],
      tableHeaders: [t('م', '#'), t('الصنف', 'Product'), t('الوحدة', 'Unit'), t('الكمية', 'Qty'), t('السعر', 'Price'), t('الإجمالي', 'Total')],
      tableRows: (inv.items || []).map((it, idx) => [
        idx + 1,
        it.productName,
        it.unit,
        it.quantity,
        it.unitPrice.toFixed(2),
        it.total.toFixed(2),
      ]),
      summaryPairs: [
        { label: t('الصافي الإجمالي', 'Net Total'), value: `${inv.grandTotal.toFixed(2)} ${t(data.settings.currency)}`, highlight: true },
        ...(inv.type !== 'quote'
          ? [
              { label: t('المدفوع', 'Paid'), value: `${inv.paidAmount.toFixed(2)} ${t(data.settings.currency)}` },
              { label: t('المتبقي', 'Remaining'), value: `${inv.remainingAmount.toFixed(2)} ${t(data.settings.currency)}` },
            ]
          : []),
      ],
      notes: inv.notes,
    });
  };

  if (mobileConfig.enableRepApp === false) {
    return (
      <div dir={dir} className="bg-white rounded-2xl border border-amber-200 p-5 text-center space-y-2.5 shadow-xs">
        <ShieldAlert className="w-12 h-12 text-amber-600 mx-auto" />
        <h3 className="text-base font-black text-slate-900">{t('بوابة المناديب متوقفة مؤقتاً', 'Representatives Portal Temporarily Paused')}</h3>
        <p className="text-xs text-slate-600">
          {t('تم تعطيل وصول تطبيق المناديب مؤقتاً من إعدادات الإدارة. يرجى مراجعة مسؤول النظام.', 'Representatives app access has been temporarily disabled in admin settings. Please contact your system administrator.')}
        </p>
        <button
          type="button"
          onClick={() => data.triggerManualSync()}
          className="min-h-[44px] px-5 rounded-xl bg-blue-900 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>{t('إعادة المحاولة', 'Retry')}</span>
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
      label: t('فاتورة شراء', 'Purchase Invoice'),
      iconNode: <PurchaseInvoiceIcon className="w-11 h-11" />,
      allowed: canCreatePurchase,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'sales-return',
      label: t('مرتجع بيع', 'Sales Return'),
      iconNode: <SalesReturnIcon className="w-11 h-11" />,
      allowed: canSales,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'new-invoice',
      label: t('فاتورة بيع', 'Sales Invoice'),
      iconNode: <SalesInvoiceIcon className="w-11 h-11" />,
      allowed: canSales,
      tone: 'bg-white text-blue-950 border-blue-200 ring-1 ring-blue-100 hover:border-blue-400',
    },
    // Row 2
    {
      key: 'cash-deposit',
      label: isRepRoleAccount ? t('تحصيل من عميل', 'Customer Collection') : t('إيداع نقدي', 'Cash Deposit'),
      iconNode: <ExpensesCashIcon className="w-11 h-11" />,
      allowed: isRepRoleAccount ? (canSales || canAccounts) : (canCashOps || canAccounts || canSales),
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'custody-transfer',
      label: t('تحويل عهدة', 'Custody Transfer'),
      iconNode: <TransferArrowsIcon className="w-11 h-11" />,
      allowed: canTransfers,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'purchase-return',
      label: isRepRoleAccount ? t('طلب مرتجع شراء', 'Purchase Return Req.') : t('مرتجع شراء', 'Purchase Return'),
      iconNode: <PurchaseReturnIcon className="w-11 h-11" />,
      allowed: canCreatePurchase,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    // Row 3
    ...(!isRepRoleAccount
      ? [
          {
            key: 'cash-withdrawal' as RepTabKey,
            label: t('سحب نقدي', 'Cash Withdrawal'),
            iconNode: <WalletCashIcon className="w-11 h-11" />,
            allowed: canCashOps,
            tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
          },
        ]
      : [
          {
            key: 'rep-reports' as RepTabKey,
            label: t('تقارير المندوب', 'Rep Reports'),
            iconNode: <FileSpreadsheet className="w-10 h-10 text-blue-900" />,
            allowed: true,
            tone: 'bg-white text-blue-950 border-blue-200 hover:border-blue-400',
          },
        ]),
    {
      key: 'new-customer',
      label: t('عميل جديد', 'New Customer'),
      iconNode: <CustomerAddIcon className="w-11 h-11" />,
      allowed: canAddCustomer,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    {
      key: 'new-supplier',
      label: t('مورد جديد', 'New Supplier'),
      iconNode: <SupplierAddIcon className="w-11 h-11" />,
      allowed: canCreatePurchase,
      tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
    },
    // Row 4
    {
      key: 'refresh',
      label: t('إرسال واستلام', 'Send & Receive'),
      iconNode: <RefreshCloudIcon className="w-11 h-11" />,
      allowed: true,
      tone: 'bg-white text-slate-900 border-blue-200 hover:border-blue-400',
      badgeCount: data.pendingSendReceiveCount || data.pendingSyncCount,
    },
    ...(!isRepRoleAccount
      ? [
          {
            key: 'cheques-installments' as RepTabKey,
            label: t('شيك وقسط', 'Cheques & Inst.'),
            iconNode: <ChequesIcon className="w-11 h-11" />,
            allowed: canAccounts,
            tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
          },
        ]
      : [
          {
            key: 'suppliers' as RepTabKey,
            label: t('الموردون وكشوفهم', 'Suppliers & Statements'),
            iconNode: <Building2 className="w-10 h-10 text-[#003589]" />,
            allowed: canCreatePurchase,
            tone: 'bg-white text-slate-800 border-slate-200 hover:border-blue-300',
          },
        ]),
    {
      key: 'new-quote',
      label: t('عرض سعر', 'Price Quote'),
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
    () => myItemTransfers.filter((t) => t.status === 'executed' && (!rep || t.senderRepresentativeId !== rep.id)),
    [myItemTransfers, rep]
  );

  const pendingCashReceipts = useMemo(
    () =>
      myCashTransfers.filter(
        (t) =>
          t.status === 'awaiting_receipt' &&
          (!rep || t.senderId !== rep.id) &&
          (t.direction === 'owner_to_rep' || (t.direction === 'rep_to_rep' && (!rep || t.receiverId === rep.id)))
      ),
    [myCashTransfers, rep]
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
    <div dir={dir} className="space-y-2">
      {/* Slim Sub-page Return Bar (Primary tabs are navigated via fixed bottom bar) */}
      {!['home', 'cash', 'more', 'customers', 'new-invoice', 'refresh'].includes(activeTab) && (
        <div className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={() => guardedTabChange('home')}
            className="h-8 px-2.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] font-black inline-flex items-center gap-1 cursor-pointer"
          >
            {isRtl ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
            <span>{t('الرئيسية', 'Home')}</span>
          </button>
          <span className="font-black text-slate-800 truncate">
            {activeTab === 'cash-deposit'
              ? t('تحصيل من العميل', 'Customer Collection')
              : activeTab === 'cash-withdrawal'
              ? t('سحب / مصروف', 'Withdrawal / Expense')
              : activeTab === 'custody-transfer'
              ? t('تحويل عهدة', 'Custody Transfer')
              : activeTab === 'new-purchase'
              ? t('فاتورة شراء', 'Purchase Invoice')
              : activeTab === 'sales-return'
              ? t('مرتجع مبيعات', 'Sales Return')
              : activeTab === 'purchase-return'
              ? t('مرتجع مشتريات', 'Purchase Return')
              : activeTab === 'new-customer'
              ? t('إضافة عميل', 'Add Customer')
              : activeTab === 'new-supplier'
              ? t('إضافة مورد', 'Add Supplier')
              : activeTab === 'new-quote'
              ? t('عرض سعر', 'Price Quote')
              : activeTab === 'orders'
              ? t('الطلبات والتسليمات', 'Orders & Deliveries')
              : activeTab === 'invoices'
              ? t('فواتير المبيعات', 'Sales Invoices')
              : activeTab === 'purchases-list'
              ? t('فواتير الشراء', 'Purchase Invoices')
              : activeTab === 'sales-returns-list'
              ? t('سجل مرتجع البيع', 'Sales Returns Log')
              : activeTab === 'purchase-returns-list'
              ? t('سجل مرتجع الشراء', 'Purchase Returns Log')
              : activeTab === 'custody'
              ? t('مخزون وعهدة السيارة', 'Van Stock & Custody')
              : activeTab === 'suppliers'
              ? t('الموردون', 'Suppliers')
              : activeTab === 'rep-reports'
              ? t('تقارير المندوب', 'Rep Reports')
              : activeTab === 'refresh'
              ? t('إرسال واستلام', 'Send & Receive')
              : activeTab === 'cheques-installments'
              ? t('الشيكات والأقساط', 'Cheques & Installments')
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
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {/* ==================== TAB 1: HOME (4x3 Brand Store Tile Grid) ==================== */}
      {activeTab === 'home' && (
        <div className="space-y-2">
          <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-slate-500">{t('مرحباً، مندوب المبيعات', 'Welcome, Sales Representative')}</p>
                <h2 className="text-sm font-black text-slate-900 truncate">
                  {rep?.name || currentUser?.fullName}
                </h2>
                <p className="text-[11px] text-slate-500 truncate">
                  {vanWarehouse?.name || t('سيارة المندوب', 'Rep Van')} {rep?.vehicleNumber ? `· ${rep.vehicleNumber}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-end px-2.5 py-1 rounded-lg bg-[#EEF3FA] border border-[#DCE6F5]">
                <span className="text-[10px] text-[#003589] block font-bold">{t('العهدة النقدية', 'Cash Custody')}</span>
                <strong className="text-xs sm:text-sm font-black font-mono tabular-nums text-[#011E58]">
                  {formatLocaleNumber(rep?.currentBalance || 0)} {t(data.settings.currency)}
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
                  <span>{t('المهام اليومية المعلقة', 'Pending Daily Tasks')}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {pendingCustodyDispatches.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustodySubTab('items');
                        onTabChange('custody');
                      }}
                      className="px-2 py-1 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-[#DCE6F5]"
                    >
                      <span>{t('عهد بضاعة مرسلة بانتظار تأكيد الاستلام', 'Stock dispatches awaiting receipt')} ({formatLocaleNumber(pendingCustodyDispatches.length)})</span>
                      {isRtl ? <ChevronLeft className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  )}
                  {pendingCashReceipts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('cash')}
                      className="px-2 py-1 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-[#DCE6F5]"
                    >
                      <span>{t('عهد نقدية واردة من الإدارة', 'Incoming cash custody from management')} ({formatLocaleNumber(pendingCashReceipts.length)})</span>
                      {isRtl ? <ChevronLeft className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  )}
                  {activeAssignedOrders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('orders')}
                      className="px-2 py-1 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-[#DCE6F5]"
                    >
                      <span>{t('طلبات توصيل جارية معينة لك', 'Active delivery orders assigned to you')} ({formatLocaleNumber(activeAssignedOrders.length)})</span>
                      {isRtl ? <ChevronLeft className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  )}
                  {draftsReadyToConfirm.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('invoices')}
                      className="px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-950 flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-blue-100"
                    >
                      <span>{t('مسودات فواتير جاهزة للاعتماد', 'Draft invoices ready to confirm')} ({formatLocaleNumber(draftsReadyToConfirm.length)})</span>
                      {isRtl ? <ChevronLeft className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  )}
                  {data.pendingSyncCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onTabChange('refresh')}
                      className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-950 flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer hover:bg-amber-100"
                    >
                      <span>{t('عمليات محلية بانتظار الإرسال', 'Local operations pending sync')} ({formatLocaleNumber(data.pendingSyncCount)})</span>
                      {isRtl ? <ChevronLeft className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Permanent Compact Send & Receive Entry */}
            <div className="pt-1.5 border-t border-slate-100 dark:border-[#21375C] flex flex-wrap items-center justify-between gap-1.5">
              <button
                type="button"
                data-testid="rep-home-refresh-btn"
                onClick={() => onTabChange('refresh')}
                className="flex-1 min-w-[200px] min-h-[38px] px-2.5 py-1.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white text-[11px] font-black flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${data.isMandatorySending ? 'animate-spin' : ''}`} />
                  <span>{t('إرسال واستلام', 'Send & Receive')}</span>
                </span>
                <span className="font-mono text-[10px] bg-white/15 px-1.5 py-0.5 rounded tabular-nums">
                  {t('معلق:', 'Pending:')} {formatLocaleNumber(data.pendingSyncCount)} · {t('استلام:', 'Incoming:')} {formatLocaleNumber(pendingCustodyDispatches.length + pendingCashReceipts.length + data.incomingDispatchCount)}
                  {data.mandatorySendEnabled
                    ? ` · ${String(Math.floor(data.mandatorySendRemainingSeconds / 60)).padStart(2, '0')}:${String(data.mandatorySendRemainingSeconds % 60).padStart(2, '0')}`
                    : ''}
                </span>
              </button>
            </div>
          </div>

          {/* Quick Customers, Purchases, Suppliers & Reports Access Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => onTabChange('customers')}
              className="bg-white rounded-lg border border-slate-200 hover:border-blue-300 px-2 py-1.5 flex items-center gap-2 text-start cursor-pointer"
            >
              <CustomersGroupIcon className="w-7 h-7 shrink-0" />
              <div className="min-w-0">
                <span className="block text-[11px] font-black text-slate-900 truncate">{t('العملاء والحسابات', 'Customers & Accounts')}</span>
                <span className="block text-[10px] text-slate-500 font-semibold truncate">
                  {formatLocaleNumber(data.customers.length)} {t('عميل · متابعة وكشوف', 'customers · statements')}
                </span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onTabChange('rep-reports')}
              className="bg-white rounded-lg border border-blue-200 hover:border-blue-400 px-2 py-1.5 flex items-center gap-2 text-start cursor-pointer"
            >
              <FileSpreadsheet className="w-7 h-7 text-blue-900 shrink-0" />
              <div className="min-w-0">
                <span className="block text-[11px] font-black text-blue-950 truncate">{t('تقارير المندوب', 'Rep Reports')}</span>
                <span className="block text-[10px] text-slate-500 font-semibold truncate">
                  {t('المبيعات والتحصيلات', 'Sales & Collections')}
                </span>
              </div>
            </button>
            {canCreatePurchase && (
              <>
                <button
                  type="button"
                  onClick={() => onTabChange('purchases-list')}
                  className="bg-white rounded-lg border border-slate-200 hover:border-blue-300 px-2 py-1.5 flex items-center gap-2 text-start cursor-pointer"
                >
                  <PurchaseInvoiceIcon className="w-7 h-7 shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-[11px] font-black text-slate-900 truncate">{t('فواتير الشراء', 'Purchase Invoices')}</span>
                    <span className="block text-[10px] text-slate-500 font-semibold truncate">
                      {formatLocaleNumber(myPurchases.length)} {t('فاتورة · سداد', 'invoices · pay')}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onTabChange('suppliers')}
                  className="bg-white rounded-lg border border-slate-200 hover:border-[#0053BE] px-2 py-1.5 flex items-center gap-2 text-start cursor-pointer"
                >
                  <Building2 className="w-7 h-7 text-[#003589] shrink-0" />
                  <div className="min-w-0">
                    <span className="block text-[11px] font-black text-slate-900 truncate">{t('الموردون وكشوفهم', 'Suppliers & Statements')}</span>
                    <span className="block text-[10px] text-slate-500 font-semibold truncate">
                      {formatLocaleNumber(data.suppliers.length)} {t('مورد · كشف الحساب', 'suppliers · statements')}
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
                        text: t(
                          `صلاحيات حسابك لا تسمح بفتح "${tile.label}". راجع المدير لتفعيل الصلاحية.`,
                          `Your account permissions do not allow opening "${tile.label}". Contact admin to enable permission.`
                        ),
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
                    <Lock className="w-3.5 h-3.5 absolute top-1.5 end-1.5 text-slate-400" />
                  )}
                  {tile.badgeCount && tile.badgeCount > 0 ? (
                    <span className="absolute top-1.5 end-1.5 min-w-[18px] h-[18px] px-1 rounded bg-amber-500 text-slate-950 text-[10px] font-black font-mono tabular-nums flex items-center justify-center">
                      {formatLocaleNumber(tile.badgeCount)}
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
                <span>{t('إدارة النقدية والعهدة المالية', 'Cash & Financial Custody Management')}</span>
              </h3>
              <div className="px-2 py-0.5 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] flex items-center gap-1.5">
                <span className="text-[10px] text-[#003589] font-bold">{t('رصيد العهدة:', 'Custody Balance:')}</span>
                <strong className="text-xs font-black font-mono tabular-nums text-[#011E58]">
                  {formatLocaleNumber(rep?.currentBalance || 0)} {t(data.settings.currency)}
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
                {isRepRoleAccount ? t('تحصيل من عميل', 'Customer Collection') : t('إيداع نقدي', 'Cash Deposit')}
              </button>
              {!isRepRoleAccount && (
                <button
                  type="button"
                  disabled={!canCashOps}
                  onClick={() => onTabChange('cash-withdrawal')}
                  className="h-8 rounded-md bg-amber-600 text-white font-black cursor-pointer disabled:opacity-45"
                >
                  {t('سحب نقدي', 'Cash Withdrawal')}
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
                {t('توريد عهدة للفرع', 'Remit Custody to Branch')}
              </button>
            </div>
          </div>

          {/* Cash Drawer Reconciliation Card */}
          <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
            <h4 className="font-black text-slate-900 flex items-center gap-1.5">
              <Calculator className="w-4 h-4 text-blue-900" />
              <span>{t('تقفيل ومطابقة الدرج النقدي اليوم', 'Today Cash Drawer Reconciliation')} ({todayStr})</span>
            </h4>
            <div className="grid grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden text-center tabular-nums">
              <div className="px-2 py-1.5 bg-blue-50/70">
                <span className="text-[10px] text-blue-800 block">{t('مبيعات اليوم المحصلة', 'Today Collected Sales')}</span>
                <strong className="font-mono text-xs text-blue-950">
                  {formatLocaleNumber(cashDrawerSummary.todayRepSalesCash)}
                </strong>
              </div>
              <div className="px-2 py-1.5 bg-emerald-50/70">
                <span className="text-[10px] text-emerald-800 block">{t('تحصيلات / إيداعات', 'Collections / Deposits')}</span>
                <strong className="font-mono text-xs text-emerald-900">
                  {formatLocaleNumber(cashDrawerSummary.todayCashCollections)}
                </strong>
              </div>
              <div className="px-2 py-1.5 bg-amber-50/70">
                <span className="text-[10px] text-amber-800 block">{t('توريدات للفرع اليوم', 'Today Branch Remittances')}</span>
                <strong className="font-mono text-xs text-amber-900">
                  {formatLocaleNumber(cashDrawerSummary.todayRepRemittances)}
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                  {t('الجرد الفعلي للنقدية بالدرج', 'Actual Counted Drawer Cash')} ({t(data.settings.currency)}):
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={actualDrawerCash}
                  onChange={(e) => setActualDrawerCash(e.target.value)}
                  placeholder={t('أدخل النقدية المعدودة فعلياً...', 'Enter actual counted cash...')}
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
                <span>{t('الفارق عن العهدة:', 'Custody Variance:')}</span>
                <strong className="font-mono">
                  {cashDrawerSummary.variance === null
                    ? `${t('الدفتر:', 'Ledger:')} ${formatLocaleNumber(cashDrawerSummary.expectedBalance)}`
                    : Math.abs(cashDrawerSummary.variance) < 0.01
                    ? t('مطابق تماماً (0)', 'Exact Match (0)')
                    : `${cashDrawerSummary.variance > 0 ? t('زيادة +', 'Surplus +') : t('عجز ', 'Shortage ')}${formatLocaleNumber(cashDrawerSummary.variance)} ${t(data.settings.currency)}`}
                </strong>
              </div>
            </div>
          </div>

          <UnifiedDataTable
            compact
            paginated={false}
            searchable={false}
            title={`${t('حركة التحويلات النقدية للمندوب', 'Representative Cash Transfers')} (${formatLocaleNumber(myCashTransfers.length)})`}
            data={myCashTransfers}
            rowKey={(t) => t.id}
            emptyTitle={t('لا توجد تحويلات نقدية مسجلة حالياً', 'No cash transfers recorded yet')}
            emptySubtitle={t('ستظهر هنا التوريدات والعهد النقدية المرتبطة بك', 'Your remittances and incoming cash custody transfers will appear here')}
            columns={[
              {
                key: 'transferNumber',
                header: t('رقم التحويل', 'Transfer #'),
                render: (trItem) => <span className="font-mono font-black text-blue-950">{trItem.transferNumber}</span>,
              },
              {
                key: 'direction',
                header: t('النوع', 'Type'),
                render: (trItem) =>
                  trItem.direction === 'rep_to_owner'
                    ? t('توريد إلى الفرع', 'Remittance to Branch')
                    : t('عهدة واردة من الإدارة', 'Incoming Custody from Admin'),
              },
              {
                key: 'amount',
                header: t('المبلغ', 'Amount'),
                align: 'center',
                sortValue: (trItem) => Number(trItem.amount || 0),
                render: (trItem) => (
                  <strong className="font-mono text-slate-900 tabular-nums">
                    {formatLocaleNumber(trItem.amount)} {t(data.settings.currency)}
                  </strong>
                ),
              },
              {
                key: 'status',
                header: t('الحالة', 'Status'),
                align: 'center',
                render: (trItem) => (
                  <span
                    className={`font-bold ${
                      trItem.status === 'received'
                        ? 'text-emerald-700'
                        : trItem.status === 'awaiting_receipt'
                        ? 'text-amber-700'
                        : 'text-red-700'
                    }`}
                  >
                    {trItem.status === 'received'
                      ? t('تم الاستلام والتسوية', 'Received & Settled')
                      : trItem.status === 'awaiting_receipt'
                      ? t('بانتظار تأكيد الاستلام', 'Awaiting Confirmation')
                      : t('مرفوض', 'Rejected')}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: t('الإجراءات', 'Actions'),
                align: 'center',
                sortable: false,
                render: (trItem) =>
                  trItem.status === 'awaiting_receipt' && trItem.direction === 'owner_to_rep' ? (
                    <button
                      type="button"
                      onClick={() => handleConfirmOwnerCash(trItem.id)}
                      className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black cursor-pointer whitespace-nowrap"
                    >
                      {t('تأكيد استلام العهدة النقدية', 'Confirm Cash Custody Receipt')}
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
        <div className="space-y-2 text-xs">
          <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] overflow-hidden divide-y divide-slate-100 dark:divide-[#1B2F52]">
            {[
              { key: 'rep-reports' as RepTabKey, label: t('تقارير المندوب الشاملة', 'Comprehensive Rep Reports'), Icon: FileSpreadsheet, allowed: true },
              { key: 'purchases-list' as RepTabKey, label: t('فواتير الشراء', 'Purchase Invoices'), Icon: PurchaseInvoicesListIcon, allowed: canCreatePurchase },
              { key: 'suppliers' as RepTabKey, label: t('الموردون وكشف الحساب', 'Suppliers & Statements'), Icon: Building2, allowed: canCreatePurchase },
              { key: 'sales-returns-list' as RepTabKey, label: t('مرتجع البيع', 'Sales Returns'), Icon: SalesReturnIcon, allowed: canSales },
              { key: 'invoices' as RepTabKey, label: t('فواتير البيع', 'Sales Invoices'), Icon: SalesInvoicesListIcon, allowed: canSales },
              { key: 'customers' as RepTabKey, label: t('الحسابات والعملاء', 'Customers & Accounts'), Icon: CustomersGroupIcon, allowed: canAccounts || canSales },
              { key: 'custody' as RepTabKey, label: t('المخزن والعهدة', 'Warehouse & Custody'), Icon: WarehouseBoxesIcon, allowed: canInventory },
              { key: 'purchase-returns-list' as RepTabKey, label: isRepRoleAccount ? t('طلبات ومرتجعات الشراء', 'Purchase Returns & Requests') : t('مرتجع الشراء', 'Purchase Returns'), Icon: PurchaseReturnIcon, allowed: canCreatePurchase },
              { key: 'orders' as RepTabKey, label: t('الطلبات والتسليمات', 'Orders & Deliveries'), Icon: OrdersClipboardIcon, allowed: canSales },
              { key: 'new-quote' as RepTabKey, label: t('عروض الأسعار', 'Price Quotes'), Icon: PriceQuoteIcon, allowed: canSales },
              { key: 'refresh' as RepTabKey, label: t('إرسال واستلام', 'Send & Receive'), Icon: RefreshCloudIcon, allowed: true },
            ].map((item) => {
              const ItemIcon = item.Icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  disabled={!item.allowed}
                  onClick={() => onTabChange(item.key)}
                  className="w-full min-h-[36px] px-2.5 py-1.5 flex items-center justify-between gap-2 text-start font-bold text-slate-800 dark:text-[#EEF4FC] hover:bg-slate-50 dark:hover:bg-[#132544] disabled:opacity-45 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <ItemIcon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </div>
                  {item.allowed ? (
                    isRtl ? <ChevronLeft className="w-4 h-4 text-slate-400 dark:text-[#8CA3C7]" /> : <ChevronRight className="w-4 h-4 text-slate-400 dark:text-[#8CA3C7]" />
                  ) : (
                    <Lock className="w-4 h-4 text-slate-300 dark:text-[#5B749B]" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Inline Theme, Language, Notifications & Account Security Settings */}
          <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-2.5 space-y-2">
            <div className="space-y-1">
              <p className="font-black text-[11px] text-slate-700 dark:text-[#A9BCD9]">{t('مظهر التطبيق', 'App Theme')}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { key: 'light', label: t('نهاري', 'Light'), icon: Sun },
                  { key: 'dark', label: t('داكن', 'Dark'), icon: Moon },
                  { key: 'system', label: t('النظام', 'System'), icon: Monitor },
                ] as const).map((opt) => {
                  const OptIcon = opt.icon;
                  const active = themePreference === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setThemePreference(opt.key)}
                      className={`h-8 rounded-md border text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                        active
                          ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                          : 'bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] hover:bg-slate-100 dark:hover:bg-[#1A3461]'
                      }`}
                    >
                      <OptIcon className="w-3.5 h-3.5" />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-[#1B2F52]">
              <p className="font-black text-[11px] text-slate-700 dark:text-[#A9BCD9] flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
                <span>{t('لغة الواجهة', 'Interface Language')}</span>
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setLanguage('ar')}
                  className={`h-8 rounded-md border font-bold cursor-pointer transition-colors ${
                    language === 'ar'
                      ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                      : 'bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C]'
                  }`}
                >
                  العربية
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`h-8 rounded-md border font-bold cursor-pointer transition-colors ${
                    language === 'en'
                      ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                      : 'bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C]'
                  }`}
                >
                  English
                </button>
              </div>
            </div>

            <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-[#1B2F52]">
              <p className="font-black text-[11px] text-slate-700 dark:text-[#A9BCD9] flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
                <span>{t('تفضيلات التنبيهات', 'Notification Preferences')}</span>
              </p>
              <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] cursor-pointer">
                <span className="flex items-center gap-1.5 font-bold text-[11px] text-slate-700 dark:text-[#DCE6F5]">
                  <Volume2 className="w-3.5 h-3.5 text-slate-500 dark:text-[#8CA3C7]" />
                  <span>{t('أصوات التنبيه والباركود', 'Alert & Barcode Sounds')}</span>
                </span>
                <input
                  type="checkbox"
                  checked={repNotifPrefs.soundEnabled}
                  onChange={() => toggleRepNotifPref('soundEnabled')}
                  className="w-4 h-4 accent-[#003589] dark:accent-[#3B82F6] cursor-pointer"
                />
              </label>
              <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] cursor-pointer">
                <span className="font-bold text-[11px] text-slate-700 dark:text-[#DCE6F5]">{t('تنبيهات الإرسال والاستلام والترحيل', 'Send, Receive & Posting Alerts')}</span>
                <input
                  type="checkbox"
                  checked={repNotifPrefs.dispatchAlerts}
                  onChange={() => toggleRepNotifPref('dispatchAlerts')}
                  className="w-4 h-4 accent-[#003589] dark:accent-[#3B82F6] cursor-pointer"
                />
              </label>
              <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] cursor-pointer">
                <span className="font-bold text-[11px] text-slate-700 dark:text-[#DCE6F5]">{t('تنبيهات الطلبات والموافقات الفورية', 'Instant Order & Approval Alerts')}</span>
                <input
                  type="checkbox"
                  checked={repNotifPrefs.orderAlerts}
                  onChange={() => toggleRepNotifPref('orderAlerts')}
                  className="w-4 h-4 accent-[#003589] dark:accent-[#3B82F6] cursor-pointer"
                />
              </label>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] overflow-hidden divide-y divide-slate-100 dark:divide-[#1B2F52]">
            {onOpenServerModal && (
              <button
                type="button"
                onClick={onOpenServerModal}
                className="w-full min-h-[36px] px-2.5 py-1.5 flex items-center justify-between gap-2 text-start font-bold text-slate-800 dark:text-[#EEF4FC] hover:bg-slate-50 dark:hover:bg-[#132544] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <SettingsTwinGearsIcon className="w-4 h-4 shrink-0" />
                  <span>{t('الإعدادات والربط المركزي', 'Settings & Central Server Connection')}</span>
                </div>
                {isRtl ? <ChevronLeft className="w-4 h-4 text-slate-400 dark:text-[#8CA3C7]" /> : <ChevronRight className="w-4 h-4 text-slate-400 dark:text-[#8CA3C7]" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setShowRepPwdBox((p) => !p);
                setRepPwdMsg(null);
              }}
              className="w-full min-h-[36px] px-2.5 py-1.5 flex items-center justify-between gap-2 text-start font-bold text-slate-800 dark:text-[#EEF4FC] hover:bg-slate-50 dark:hover:bg-[#132544] cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF] shrink-0" />
                <span>{t('تغيير كلمة المرور', 'Change Password')}</span>
              </div>
              {isRtl ? (
                <ChevronLeft className={`w-4 h-4 text-slate-400 dark:text-[#8CA3C7] transition-transform ${showRepPwdBox ? '-rotate-90' : ''}`} />
              ) : (
                <ChevronRight className={`w-4 h-4 text-slate-400 dark:text-[#8CA3C7] transition-transform ${showRepPwdBox ? 'rotate-90' : ''}`} />
              )}
            </button>

            {showRepPwdBox && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setRepPwdMsg(null);
                  if (repNewPwd.length < 4) {
                    setRepPwdMsg({ type: 'error', text: t('كلمة المرور يجب أن تكون 4 أحرف على الأقل.', 'Password must be at least 4 characters.') });
                    return;
                  }
                  if (repNewPwd !== repConfirmPwd) {
                    setRepPwdMsg({ type: 'error', text: t('تأكيد كلمة المرور غير مطابق.', 'Password confirmation does not match.') });
                    return;
                  }
                  setRepSavingPwd(true);
                  const res = await updatePassword(repNewPwd, repCurrPwd || undefined);
                  setRepSavingPwd(false);
                  if (res.success) {
                    setRepCurrPwd('');
                    setRepNewPwd('');
                    setRepConfirmPwd('');
                    setRepPwdMsg({ type: 'success', text: t('تم تحديث كلمة المرور بنجاح.', 'Password updated successfully.') });
                  } else {
                    setRepPwdMsg({ type: 'error', text: res.error || t('تعذر تغيير كلمة المرور.', 'Failed to change password.') });
                  }
                }}
                className="p-2.5 bg-slate-50 dark:bg-[#132544] space-y-1.5"
              >
                {repPwdMsg && (
                  <p className={`text-[11px] font-bold ${repPwdMsg.type === 'success' ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                    {repPwdMsg.text}
                  </p>
                )}
                <input
                  type="password"
                  dir="ltr"
                  required
                  value={repCurrPwd}
                  onChange={(e) => setRepCurrPwd(e.target.value)}
                  placeholder={t('كلمة المرور الحالية', 'Current Password')}
                  className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] px-2 bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-500 dark:placeholder:text-[#8CA3C7] font-mono text-start"
                />
                <input
                  type="password"
                  dir="ltr"
                  required
                  minLength={4}
                  value={repNewPwd}
                  onChange={(e) => setRepNewPwd(e.target.value)}
                  placeholder={t('كلمة المرور الجديدة', 'New Password')}
                  className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] px-2 bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-500 dark:placeholder:text-[#8CA3C7] font-mono text-start"
                />
                <input
                  type="password"
                  dir="ltr"
                  required
                  minLength={4}
                  value={repConfirmPwd}
                  onChange={(e) => setRepConfirmPwd(e.target.value)}
                  placeholder={t('تأكيد كلمة المرور الجديدة', 'Confirm New Password')}
                  className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] px-2 bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-500 dark:placeholder:text-[#8CA3C7] font-mono text-start"
                />
                <button
                  type="submit"
                  disabled={repSavingPwd}
                  className="w-full h-8 rounded-md bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] hover:bg-[var(--awlad-royal-600)] dark:hover:bg-[#1F6BE6] text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {repSavingPwd ? t('جاري التحديث...', 'Updating...') : t('حفظ كلمة المرور', 'Save Password')}
                </button>
              </form>
            )}

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="w-full min-h-[36px] px-2.5 py-1.5 flex items-center justify-between gap-2 text-start font-black text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/35 cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <LogoutDoorIcon className="w-5 h-5 shrink-0" />
                  <span>{t('تسجيل الخروج', 'Logout')}</span>
                </div>
                {isRtl ? <ChevronLeft className="w-4 h-4 text-red-400" /> : <ChevronRight className="w-4 h-4 text-red-400" />}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ==================== MOBILE SEND & RECEIVE SCREEN ==================== */}
      {activeTab === 'refresh' && <MobileSendReceiveScreen onBack={() => onTabChange('home')} />}

      {/* ==================== ALLOWED CUSTOMERS LIST (Compact Actions, Collapsible KPI Strip & Table) ==================== */}
      {activeTab === 'customers' && (
        <div className="space-y-2">
          {/* Header Action Bar */}
          <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <CustomersGroupIcon className="w-6 h-6 shrink-0" />
                <div>
                  <h3 className="text-xs sm:text-sm font-black text-slate-900">{t('العملاء والمحلات والحسابات', 'Customers, Shops & Accounts')}</h3>
                  <p className="text-[10px] text-slate-500">{t('عرض المحلات، المبالغ المتبقية وكشف الحساب التفصيلي', 'View shops, remaining balances & detailed account statements')}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {canViewCustomerAggregateTotals && (
                  <button
                    type="button"
                    onClick={() => setShowCustomerStats((p) => !p)}
                    className="h-8 px-2.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>{t('المؤشرات', 'Metrics')} ({formatLocaleNumber(repCustomersStats.total)})</span>
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
                    <span>{t('عميل جديد', 'New Customer')}</span>
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
                    <span>{t('حذف آمن', 'Safe Delete')}</span>
                  </button>
                )}
              </div>
            </div>

            {canViewCustomerAggregateTotals ? (
              showCustomerStats && (
                <div className="grid grid-cols-3 lg:grid-cols-6 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden text-xs tabular-nums">
                  <div className="px-2 py-1.5 bg-slate-50">
                    <span className="text-[10px] text-slate-500 block">{t('إجمالي العملاء', 'Total Customers')}</span>
                    <strong className="text-sm font-black text-slate-900">{formatLocaleNumber(repCustomersStats.total)}</strong>
                    <span className="block text-[10px] text-slate-500">{t('المطابق:', 'Matched:')} {formatLocaleNumber(filteredCustomers.length)}</span>
                  </div>
                  <div className="px-2 py-1.5 bg-amber-50/70">
                    <span className="text-[10px] text-amber-800 block">{t('عملاء مدينون', 'Debtor Customers')}</span>
                    <strong className="text-sm font-black text-amber-900">{formatLocaleNumber(repCustomersStats.debtorsCount)}</strong>
                    <span className="block text-[10px] text-amber-700">{t('أرصدة مستحقة', 'Due Balances')}</span>
                  </div>
                  <div className="px-2 py-1.5 bg-[#EEF3FA]">
                    <span className="text-[10px] text-[#003589] block font-bold">{t('أرصدة دائنة', 'Credit Balances')}</span>
                    <strong className="text-sm font-black text-[#011E58]">{formatLocaleNumber(repCustomersStats.creditsCount)}</strong>
                    <span className="block text-[10px] text-[#626D80]">{t('دافعي مقدمات', 'Advance Payers')}</span>
                  </div>
                  <div className="px-2 py-1.5 bg-rose-50/70">
                    <span className="text-[10px] text-rose-700 block">{t('المستحق (لنا)', 'Receivable (Due)')}</span>
                    <strong className="text-xs font-black font-mono text-rose-800">
                      {formatLocaleNumber(repCustomersStats.totalDue)} {t(data.settings.currency)}
                    </strong>
                    <span className="block text-[10px] text-rose-700 font-bold">{t('مديونيات', 'Receivables')}</span>
                  </div>
                  <div className="px-2 py-1.5 bg-emerald-50/70">
                    <span className="text-[10px] text-emerald-700 block">{t('الدائن (علينا)', 'Credit (On Us)')}</span>
                    <strong className="text-xs font-black font-mono text-emerald-800">
                      {formatLocaleNumber(repCustomersStats.totalCredit)} {t(data.settings.currency)}
                    </strong>
                    <span className="block text-[10px] text-emerald-700 font-bold">{t('مقدمات مالية', 'Cash Advances')}</span>
                  </div>
                  <div className="px-2 py-1.5 bg-blue-50/70">
                    <span className="text-[10px] text-blue-800 block">{t('نسبة المدينين', 'Debtor Ratio')}</span>
                    <strong className="text-sm font-black font-mono text-blue-950">{formatLocaleNumber(repCustomersStats.debtorPct)}%</strong>
                    <span className="block text-[10px] text-blue-700">{t('من الإجمالي', 'of Total')}</span>
                  </div>
                </div>
              )
            ) : (
              <div className="px-2 py-1 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-[11px] font-bold text-slate-700">
                <span>{t('عدد العملاء:', 'Customers Count:')} <strong className="font-mono text-slate-900">{formatLocaleNumber(repCustomersStats.total)}</strong> ({t('المطابق:', 'Matched:')} {formatLocaleNumber(filteredCustomers.length)})</span>
                <span className="text-slate-500">{t('تظهر مديونية كل عميل داخل بطاقته.', 'Each customer balance appears inside their card.')}</span>
              </div>
            )}

            {/* Search, Filter Chips & Sort */}
            <div className="awlad-filter-row" data-testid="rep-customers-filter-row">
              <div className="relative flex-1 min-w-[165px] shrink-0">
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder={t('ابحث بالاسم أو المحل أو الكود أو الهاتف...', 'Search by name, shop, code or phone...')}
                  className="w-full h-8 rounded-md border border-slate-300 ps-7 pe-2 text-xs font-semibold outline-hidden focus:border-blue-600"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2 top-2" />
              </div>
              <select
                value={customerSortMode}
                onChange={(e) => setCustomerSortMode(e.target.value as any)}
                className="h-8 shrink-0 rounded-md border border-slate-300 px-2 text-xs font-bold bg-white"
              >
                <option value="debt_desc">{t('ترتيب: الأعلى مديونية', 'Sort: Highest Debt')}</option>
                <option value="credit_desc">{t('ترتيب: الأعلى رصيداً دائناً', 'Sort: Highest Credit')}</option>
                <option value="name">{t('ترتيب: أبجدياً', 'Sort: Alphabetical')}</option>
              </select>
              <div className="flex flex-nowrap items-center gap-1 text-[11px] font-bold shrink-0">
                {[
                  { id: 'all', label: `${t('الكل', 'All')} (${formatLocaleNumber(repCustomersStats.total)})` },
                  { id: 'current', label: t('الحاليين', 'Active') },
                  {
                    id: 'debtors',
                    label: canViewCustomerAggregateTotals
                      ? `${t('متبقي', 'Due')} (${formatLocaleNumber(repCustomersStats.debtorsCount)})`
                      : t('عليهم رصيد', 'With Balance'),
                  },
                  {
                    id: 'credits',
                    label: canViewCustomerAggregateTotals
                      ? `${t('دائنة', 'Credits')} (${formatLocaleNumber(repCustomersStats.creditsCount)})`
                      : t('دائنة', 'Credits'),
                  },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCustomerFilterMode(tab.id as any)}
                    className={`h-8 inline-flex items-center px-2 rounded-md border transition-colors cursor-pointer shrink-0 ${
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
            title={`${t('جدول العملاء والمحلات', 'Customers & Shops Table')} (${formatLocaleNumber(filteredCustomers.length)})`}
            data={filteredCustomers}
            rowKey={(c) => c.id}
            emptyTitle={t('لا يوجد عملاء مطابقون لمعايير البحث أو التصفية الحالية', 'No customers match your current search or filter criteria')}
            emptySubtitle={t('جرّب تغيير البحث أو نوع التصفية من الأعلى', 'Try changing your search or filter type above')}
            columns={[
              {
                key: 'shopName',
                header: t('المحل / العميل', 'Shop / Customer'),
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
                        title={t('عرض صورة المحل', 'View Shop Photo')}
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
                      className="text-start min-w-0 cursor-pointer"
                    >
                      <span className="font-black text-slate-900 flex items-center gap-1 whitespace-normal break-words">
                        <span>{c.shopName || c.name}</span>
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
                header: t('المنطقة', 'Area'),
                sortValue: (c) => `${c.governorate || ''} ${c.area || ''}`,
                render: (c) => (
                  <span className="text-[11px] text-slate-600">
                    {[c.governorate, c.area].filter(Boolean).join(' · ') || c.address || '—'}
                  </span>
                ),
              },
              {
                key: 'phone',
                header: t('الهاتف والموقع', 'Phone & Location'),
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
                          dir="ltr"
                          className="px-2 py-0.5 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] font-mono font-bold inline-flex items-center gap-1 text-[11px]"
                        >
                          <Phone className="w-3 h-3 text-[#003589]" />
                          <span>{c.phone}</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setFeedback({
                              type: 'warning',
                              text: t(
                                `رقم هاتف العميل (${c.name}) غير مكتمل أو غير صالح للاتصال.`,
                                `Customer (${c.name}) phone number is incomplete or invalid for calling.`
                              ),
                            })
                          }
                          className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200 font-bold inline-flex items-center gap-1 text-[11px] cursor-pointer"
                        >
                          <Phone className="w-3 h-3" />
                          <span>{c.phone || t('بدون هاتف', 'No Phone')}</span>
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
                          <span>{t('الموقع', 'Location')}</span>
                        </button>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'currentBalance',
                header: t('الرصيد الحالي', 'Current Balance'),
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
                      {formatLocaleNumber(Math.abs(c.currentBalance))} {t(data.settings.currency)}
                    </strong>
                    <span className="text-[10px] text-slate-500">
                      {c.currentBalance > 0.009 ? t('لنا', 'Due to Us') : c.currentBalance < -0.009 ? t('علينا', 'Credit') : t('متوازن', 'Settled')}
                    </span>
                  </div>
                ),
              },
              {
                key: 'actions',
                header: t('الإجراءات', 'Actions'),
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
                      <span>{t('كشف', 'Stmt')}</span>
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
                      <span>{t('تحصيل', 'Collect')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInvCustomerId(c.id);
                        onTabChange('new-invoice');
                      }}
                      className="px-2 py-0.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-bold text-[11px] cursor-pointer"
                    >
                      {t('فاتورة', 'Invoice')}
                    </button>
                    {canEditCustomer && (
                      <button
                        type="button"
                        onClick={() => openEditCustomerSheet(c)}
                        className="px-1.5 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-bold cursor-pointer"
                        title={t('تعديل بيانات العميل', 'Edit Customer Details')}
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                    )}
                    {canDeleteCustomer && (
                      <button
                        type="button"
                        onClick={() => setDeleteCustomerTarget(c)}
                        className="px-1.5 py-0.5 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold cursor-pointer"
                        title={t('حذف العميل', 'Delete Customer')}
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
            <h3 className="text-xs sm:text-sm font-black text-slate-900">{t('إنشاء فاتورة مبيعات (مقيد بمخزون عهدة السيارة)', 'Create Sales Invoice (Van Custody Stock Restricted)')}</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <div>
                <SearchableFilterSelect
                  id="rep-sale-customer"
                  label={t('العميل', 'Customer')}
                  value={invCustomerId}
                  onChange={setInvCustomerId}
                  options={data.customers.map((c) => ({
                    value: c.id,
                    label: c.shopName ? `${c.shopName} (${c.name})` : c.name,
                    subtitle: c.phone || c.address,
                    badge: `${t('رصيد:', 'Bal:')} ${formatLocaleNumber(c.currentBalance)}`,
                    searchText: `${c.name} ${c.shopName || ''} ${c.phone || ''} ${c.code || ''}`,
                  }))}
                  allOptionLabel={t('-- اختر العميل --', '-- Select Customer --')}
                  allOptionValue=""
                  searchPlaceholder={t('ابحث باسم العميل أو المحل أو الهاتف...', 'Search by customer, shop or phone...')}
                  allowClear
                  buttonClassName="h-8 rounded-md"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('مستودع الصرف (السيارة):', 'Issue Warehouse (Van):')}</label>
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
                <label className="font-bold text-slate-800">{t('بحث / باركود وإضافة صنف', 'Search / Barcode & Add Item')} ({formatLocaleNumber(filteredInvoiceProducts.length)}):</label>
                <button
                  type="button"
                  onClick={() => setInvOnlyVanStock((prev) => !prev)}
                  className={`h-7 px-2 rounded-md border text-[11px] font-bold cursor-pointer ${
                    invOnlyVanStock
                      ? 'bg-[#003589] text-white border-[#011E58]'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  {invOnlyVanStock ? t('المتاح بالسيارة فقط ✓', 'Van Available Only ✓') : t('تصفية: المتاح بالسيارة', 'Filter: Available in Van')}
                </button>
              </div>

              <ProductSearchSelect
                products={filteredInvoiceProducts}
                selectedProductId={invProductId}
                warehouseId={effectiveVanId}
                warehouses={data.warehouses}
                priceMode="selling"
                currency={data.settings.currency}
                placeholder={t('ابحث بالاسم أو الكود أو امسح الباركود...', 'Search by name, code or scan barcode...')}
                onSelect={(prod) => handleSelectProduct(prod.id)}
              />

              {selectedProduct && invCustomerId && (
                <div className="p-2 rounded-md bg-white border border-blue-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-blue-950 text-[11px]">
                    <History className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {t('آخر 3 أسعار بيع فعلية لهذا العميل', 'Last 3 actual selling prices for this customer')} ({selectedInvoiceCustomer?.shopName || selectedInvoiceCustomer?.name || ''}) {t('للصنف', 'for item')} ({selectedProduct.name}) — {t('من الأقدم للأحدث:', 'oldest to newest:')}
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
                        const orderTag = idx === 0 ? t('الأقدم', 'Oldest') : idx === selectedProdLastPrices.length - 1 ? t('الأحدث', 'Latest') : t('الوسيط', 'Middle');
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
                            title={t('انقر لتطبيق هذا السعر يدوياً', 'Click to apply this price')}
                            className="px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-950 text-start cursor-pointer"
                          >
                            <span className="font-mono font-bold text-[11px] block">
                              {formatLocaleNumber(priceVal)} {t(data.settings.currency)}
                              {entryUnit ? ` / ${entryUnit}` : ''}
                            </span>
                            <span className="text-[10px] text-slate-600 block">
                              {orderTag}
                              {priceDate ? ` · ${priceDate}` : ''}
                              {typeof entryQty === 'number' && entryQty > 0 ? ` · ${t('كمية:', 'Qty:')} ${formatLocaleNumber(entryQty)}` : ''}
                              {normalizedPerSelectedUnit !== null ? ` · ${t('يعادل', 'Equiv.')} ${formatLocaleNumber(normalizedPerSelectedUnit)} / ${invUnitName}` : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic">{t('لا توجد أسعار بيع سابقة لهذا الصنف مع هذا العميل', 'No previous selling prices for this item with this customer')}</p>
                  )}
                </div>
              )}

              {selectedProduct && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الوحدة', 'Unit')}</label>
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
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الكمية', 'Quantity')}</label>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={invQty}
                      onChange={setInvQty}
                      ariaLabel={t('كمية الصنف', 'Item Quantity')}
                      inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('السعر', 'Price')}</label>
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
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('خصم البند', 'Line Discount')}</label>
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
                  <span>{t('إضافة الصنف للفاتورة', 'Add Item to Invoice')}</span>
                </button>
              )}
            </div>

            {invItems.length > 0 && (
              <UnifiedDataTable
                compact
                paginated={false}
                searchable={false}
                title={`${t('أصناف الفاتورة', 'Invoice Items')} (${formatLocaleNumber(invItems.length)})`}
                data={invItems}
                rowKey={(it, idx) => `${it.productId}-${it.unit}-${idx}`}
                columns={[
                  {
                    key: 'productName',
                    header: t('الصنف', 'Product'),
                    render: (it) => (
                      <div>
                        <span className="font-bold text-slate-900 block">{it.productName}</span>
                        <span className="text-[10px] text-slate-500">
                          {it.unit} · {t('سعر', 'Price')} {formatLocaleNumber(it.unitPrice)}
                          {it.discount > 0 ? ` · ${t('خصم', 'Disc.')} ${formatLocaleNumber(it.discount)}` : ''}
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: 'quantity',
                    header: t('الكمية', 'Qty'),
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
                          ariaLabel={`${t('كمية', 'Quantity')} ${it.productName}`}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'total',
                    header: t('الإجمالي', 'Total'),
                    align: 'center',
                    render: (it) => (
                      <strong className="font-mono text-blue-950 tabular-nums">
                        {formatLocaleNumber(it.total)} {t(data.settings.currency)}
                      </strong>
                    ),
                  },
                  {
                    key: 'actions',
                    header: t('حذف', 'Delete'),
                    align: 'center',
                    sortable: false,
                    render: (_it, idx) => (
                      <button
                        type="button"
                        onClick={() => setInvItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="h-7 w-7 rounded-md hover:bg-red-50 inline-flex items-center justify-center text-red-600 cursor-pointer"
                        aria-label={t('حذف الصنف', 'Remove Item')}
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
                  <span>{t('عجز في مخزون سيارتك لعدد', 'Shortage in van stock for')} ({formatLocaleNumber(shortageItems.length)}) {t('أصناف — لا يمكن الاعتماد المباشر', 'items — cannot confirm directly')}</span>
                </div>
                <div className="space-y-0.5 text-[11px]">
                  {shortageItems.map((sh) => (
                    <div key={sh.productId} className="flex items-center justify-between font-mono">
                      <span className="font-sans font-bold">{sh.productName}</span>
                      <span className="text-red-700">
                        {t('المتاح بالسيارة:', 'In Van:')} {formatLocaleNumber(sh.availableInVanQty)} · {t('العجز:', 'Shortage:')} {formatLocaleNumber(sh.shortageQty)} {sh.unit}
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
                    { key: 'cash' as const, label: t('نقدي', 'Cash') },
                    { key: 'credit' as const, label: t('آجل', 'Credit') },
                    { key: 'partial' as const, label: t('جزئي', 'Partial') },
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
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('المدفوع نقداً الآن', 'Cash Paid Now')}</label>
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
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الخزينة', 'Cashbox')}</label>
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
                  placeholder={t('ملاحظات الفاتورة (اختياري)...', 'Invoice notes (optional)...')}
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />

                <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-1 tabular-nums">
                  <div className="flex items-center justify-between font-black text-xs sm:text-sm text-blue-950">
                    <span>{t('إجمالي الفاتورة:', 'Invoice Total:')}</span>
                    <span className="font-mono">
                      {formatLocaleNumber(invGrandTotal)} {t(data.settings.currency)}
                    </span>
                  </div>
                  {selectedInvoiceCustomer && (
                    <div className="pt-1 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-1 text-[11px] text-slate-700">
                      <div>
                        {t('قبل الفاتورة:', 'Before Invoice:')}{' '}
                        <strong className="font-mono">
                          {formatLocaleNumber(selectedInvoiceCustomer.currentBalance)}
                        </strong>
                      </div>
                      <div>
                        {t('المدفوع:', 'Paid:')}{' '}
                        <strong className="font-mono text-emerald-700">
                          {formatLocaleNumber(effectiveInvPaid)}
                        </strong>
                      </div>
                      <div>
                        {t('المتبقي:', 'Remaining:')}{' '}
                        <strong className="font-mono text-amber-800">
                          {formatLocaleNumber(Math.max(0, invGrandTotal - effectiveInvPaid))}
                        </strong>
                      </div>
                      <div>
                        {t('بعد الفاتورة:', 'After Invoice:')}{' '}
                        <strong className="font-mono text-blue-950">
                          {formatLocaleNumber(
                            Number(selectedInvoiceCustomer.currentBalance || 0) +
                            Math.max(0, invGrandTotal - effectiveInvPaid)
                          )}{' '}
                          {t(data.settings.currency)}
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
                      {isSubmittingInvoice ? t('جاري الحفظ...', 'Saving...') : t('حفظ كمسودة وإرسال طلب تحويل للعجز', 'Save Draft & Send Shortage Transfer Request')}
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('draft')}
                      className="w-full h-8 rounded-md bg-slate-200 text-slate-800 font-bold cursor-pointer"
                    >
                      {t('حفظ كمسودة فقط', 'Save as Draft Only')}
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
                      {t('حفظ كمسودة', 'Save as Draft')}
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingInvoice}
                      onClick={() => handleCreateInvoice('confirmed')}
                      className="h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                    >
                      {isSubmittingInvoice ? t('جاري الإصدار...', 'Issuing...') : t('اعتماد وإصدار', 'Confirm & Issue')}
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
                {purEditingInvoiceId ? t('تعديل فاتورة مشتريات قبل الإرسال', 'Edit Purchase Invoice Before Sending') : t('إنشاء فاتورة مشتريات جديدة', 'Create New Purchase Invoice')}
              </h3>
              <p className="text-[10px] text-slate-500">
                {t('لا يتم تعديل المخزن أو حسابات المورد حتى استلام الإدارة واعتمادها للفاتورة', 'Inventory and supplier accounts are not updated until received and approved by management')}
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
                  {t('إلغاء التعديل', 'Cancel Edit')}
                </button>
              )}
              <button
                type="button"
                onClick={() => onTabChange('new-supplier')}
                className="h-8 px-2.5 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] font-bold cursor-pointer"
              >
                {t('+ مورد جديد', '+ New Supplier')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('المورد:', 'Supplier:')}</label>
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
                allOptionLabel={t('-- اختر المورد --', '-- Select Supplier --')}
                allOptionValue=""
                searchPlaceholder={t('ابحث باسم المورد أو الهاتف...', 'Search by supplier name or phone...')}
                allowClear
                buttonClassName="h-8 rounded-md"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('مخزن الاستلام:', 'Receiving Warehouse:')}</label>
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
              <span className="font-black text-[#011E58]">{t('إضافة أصناف لفاتورة الشراء:', 'Add Items to Purchase Invoice:')}</span>
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
                <span>{showPurInlineNewProduct ? t('إغلاق إنشاء الصنف الجديد', 'Close New Product Form') : t('إنشاء صنف جديد داخل الفاتورة', 'Create New Product Inside Invoice')}</span>
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
                  placeholder={t('ابحث باسم الصنف أو الكود أو الباركود...', 'Search by product name, code or barcode...')}
                  onSelect={(prod) => handleSelectPurProduct(prod.id)}
                />
                {purProductId && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      value={purUnitName}
                      onChange={(e) => handleSelectPurUnit(e.target.value)}
                      className="h-8 rounded-md border border-slate-300 px-2 text-center font-bold bg-white"
                      aria-label={t('وحدة الشراء', 'Purchase Unit')}
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
                      placeholder={t('الكمية', 'Qty')}
                      ariaLabel={t('كمية الشراء', 'Purchase Quantity')}
                      inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      placeholder={t('سعر الشراء', 'Buy Price')}
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
                    {t('إضافة الصنف لفاتورة الشراء', 'Add Item to Purchase Invoice')}
                  </button>
                )}
              </>
            ) : (
              <div className="bg-white p-2 rounded-md border border-[#DCE6F5] space-y-1.5">
                <div className="flex items-center gap-1.5 text-[#011E58] font-black">
                  <ProductAddIcon className="w-4 h-4 shrink-0" />
                  <span>{t('بيانات الصنف الجديد (لا يضاف للمخزن إلا بعد اعتماد الإدارة)', 'New Product Details (added to stock only after management approval)')}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('اسم الصنف الجديد: *', 'New Product Name: *')}</label>
                    <input
                      type="text"
                      value={newPurProdName}
                      onChange={(e) => setNewPurProdName(e.target.value)}
                      placeholder={t('مثال: شاي العروسة 250 جم', 'e.g., El-Arosa Tea 250g')}
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الباركود (اختياري):', 'Barcode (optional):')}</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={newPurProdBarcode}
                      onChange={(e) => setNewPurProdBarcode(e.target.value)}
                      placeholder="622..."
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono bg-white text-start"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الكود (اختياري):', 'Code (optional):')}</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={newPurProdCode}
                      onChange={(e) => setNewPurProdCode(e.target.value)}
                      placeholder="PRD-..."
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono bg-white text-start"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('التصنيف:', 'Category:')}</label>
                    <input
                      type="text"
                      value={newPurProdCategory}
                      onChange={(e) => setNewPurProdCategory(e.target.value)}
                      placeholder={t('التصنيف (اختياري)', 'Category (optional)')}
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الوحدة الأساسية:', 'Base Unit:')}</label>
                    <input
                      type="text"
                      value={newPurProdBaseUnit}
                      onChange={(e) => setNewPurProdBaseUnit(e.target.value)}
                      placeholder={t('قطعة / كرتونة / كجم', 'Piece / Carton / Kg')}
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الكمية المشتراة: *', 'Purchased Qty: *')}</label>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={newPurProdQty}
                      onChange={setNewPurProdQty}
                      placeholder={t('الكمية', 'Qty')}
                      ariaLabel={t('كمية الصنف الجديد', 'New Product Quantity')}
                      inputClassName="w-full h-8 bg-white border border-slate-300 rounded-md text-center font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('سعر الشراء: *', 'Purchase Price: *')}</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      placeholder={t('سعر الشراء', 'Buy Price')}
                      value={newPurProdBuyPrice}
                      onChange={(e) => setNewPurProdBuyPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      className="w-full h-8 border border-slate-300 rounded-md text-center font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('سعر البيع المقترح:', 'Suggested Sell Price:')}</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      placeholder={t('سعر البيع', 'Sell Price')}
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
                        {t('هذا الصنف مسجل مسبقاً', 'This product already exists')} ({purDuplicateCheckState.exactMatch.name} — {purDuplicateCheckState.exactMatch.code})! {t('لن يُنشأ صنف مكرر.', 'No duplicate product will be created.')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUseExistingPurDuplicateProduct(purDuplicateCheckState.exactMatch!)}
                      className="h-7 px-2 rounded-md bg-amber-700 hover:bg-amber-800 text-white text-[11px] font-bold cursor-pointer"
                    >
                      {t('استخدام الصنف الموجود', 'Use Existing Product')}
                    </button>
                  </div>
                )}

                {!purDuplicateCheckState.exactMatch && purDuplicateCheckState.similarMatches.length > 0 && (
                  <div className="p-2 rounded-md border border-blue-200 bg-blue-50/70 text-blue-950 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                      <span>{t('توجد أصناف متشابهة بالاسم (اضغط للاختيار إن كان نفس الصنف):', 'Similar product names found (tap to select if same product):')}</span>
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
                          {Number(sim.purchasePrice || 0) > 0 ? ` — ${formatLocaleNumber(sim.purchasePrice)} ${t(data.settings.currency)}` : ''}
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
                    {t('إلغاء', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddPurInlineNewProduct}
                    className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                  >
                    {purDuplicateCheckState.exactMatch ? t('ربط بالصنف الموجود وإضافته', 'Link to Existing & Add') : t('+ إضافة الصنف للفاتورة', '+ Add Item to Invoice')}
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
              title={`${t('أصناف فاتورة الشراء', 'Purchase Invoice Items')} (${formatLocaleNumber(purItems.length)})`}
              data={purItems}
              rowKey={(it, idx) => `${it.productId}-${it.unit}-${idx}`}
              columns={[
                {
                  key: 'productName',
                  header: t('الصنف', 'Product'),
                  render: (it) => (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-900">{it.productName}</span>
                      {it.newProduct && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                          {t('صنف جديد', 'New Product')}
                        </span>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'quantity',
                  header: t('الكمية', 'Qty'),
                  align: 'center',
                  render: (it) => (
                    <span className="font-mono font-bold">
                      {formatLocaleNumber(it.quantity)} {it.unit}
                    </span>
                  ),
                },
                {
                  key: 'unitPrice',
                  header: t('السعر', 'Price'),
                  align: 'center',
                  render: (it) => <span className="font-mono">{formatLocaleNumber(it.unitPrice)}</span>,
                },
                {
                  key: 'total',
                  header: t('الإجمالي', 'Total'),
                  align: 'center',
                  render: (it) => <strong className="font-mono text-[#011E58]">{formatLocaleNumber(it.total)}</strong>,
                },
                {
                  key: 'actions',
                  header: t('حذف', 'Delete'),
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
              { key: 'cash' as const, label: t('نقدي', 'Cash') },
              { key: 'credit' as const, label: t('آجل', 'Credit') },
              { key: 'partial' as const, label: t('جزئي', 'Partial') },
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
              placeholder={t('المدفوع للمورد الآن', 'Paid to Supplier Now')}
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
              placeholder={`${t('الخصم', 'Discount')} (${t(data.settings.currency)}) - ${t('اختياري', 'Optional')}`}
              className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
            />
            <input
              type="text"
              value={purNotes}
              onChange={(e) => setPurNotes(e.target.value)}
              placeholder={t('ملاحظات فاتورة الشراء...', 'Purchase invoice notes...')}
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />
          </div>

          <div className="px-2.5 py-1.5 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] flex items-center justify-between font-black">
            <span>{t('صافي إجمالي فاتورة الشراء:', 'Purchase Invoice Net Total:')}</span>
            <strong className="font-mono text-[#011E58]">
              {formatLocaleNumber(purTotal)} {t(data.settings.currency)}
            </strong>
          </div>

          <button
            type="submit"
            disabled={isSubmittingPurchase || purItems.length === 0}
            className="w-full h-9 rounded-lg bg-[#011E58] hover:bg-[#003589] text-white font-black disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Eye className="w-4 h-4" />
            <span>{isSubmittingPurchase ? t('جاري المعالجة...', 'Processing...') : t('مراجعة وإرسال الفاتورة', 'Review & Send Invoice')}</span>
          </button>
        </form>
      )}

      {/* ==================== SALES RETURN ==================== */}
      {activeTab === 'sales-return' && (
        <form onSubmit={handleSubmitSalesReturn} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2 text-xs">
          <h3 className="text-xs sm:text-sm font-black text-rose-900">{t('تسجيل مرتجع مبيعات', 'Record Sales Return')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <select
              value={sRetCustomerId}
              onChange={(e) => setSRetCustomerId(e.target.value)}
              className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="">{t('-- اختر العميل --', '-- Select Customer --')}</option>
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
                  ? t('-- اختر فاتورة البيع المعتمدة (إلزامي) --', '-- Select Confirmed Sales Invoice (Required) --')
                  : t('-- ربط بفاتورة بيع معتمدة (اختياري) --', '-- Link to Confirmed Sales Invoice (Optional) --')}
              </option>
              {myInvoices
                .filter((i) => i.status === 'confirmed' && (!sRetCustomerId || i.customerId === sRetCustomerId))
                .map((i) => (
                  <option key={i.id} value={i.id}>{i.invoiceNumber} ({formatLocaleNumber(i.grandTotal)})</option>
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
              <option value="">{t('-- اختر الصنف المرتجع --', '-- Select Return Item --')}</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({t(p.baseUnit)})</option>
              ))}
            </select>
            {sRetProductId && (
              <div className="grid grid-cols-2 gap-1.5">
                <QuantityInput
                  allowDecimals
                  min={0.001}
                  value={sRetQty}
                  onChange={setSRetQty}
                  ariaLabel={t('كمية المرتجع', 'Return quantity')}
                  inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                />
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={sRetPrice}
                  onChange={(e) => setSRetPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                  placeholder={t('السعر', 'Price')}
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
                {t('إضافة لمرتجع البيع', 'Add to Sales Return')}
              </button>
            )}
          </div>

          {sRetItems.length > 0 && (
            <UnifiedDataTable
              compact
              paginated={false}
              searchable={false}
              title={`${t('أصناف مرتجع المبيعات', 'Sales Return Items')} (${formatLocaleNumber(sRetItems.length)})`}
              data={sRetItems}
              rowKey={(it, idx) => `${it.productId}-${idx}`}
              columns={[
                { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold">{it.productName}</span> },
                {
                  key: 'quantity',
                  header: t('الكمية', 'Qty'),
                  align: 'center',
                  render: (it) => <span className="font-mono">{formatLocaleNumber(it.quantity)} {t(it.unit)}</span>,
                },
                {
                  key: 'unitPrice',
                  header: t('السعر', 'Price'),
                  align: 'center',
                  render: (it) => <span className="font-mono">{formatLocaleNumber(it.unitPrice)}</span>,
                },
                {
                  key: 'total',
                  header: t('الإجمالي', 'Total'),
                  align: 'center',
                  render: (it) => <strong className="font-mono text-rose-800">{formatLocaleNumber(it.total)}</strong>,
                },
                {
                  key: 'actions',
                  header: t('حذف', 'Remove'),
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
              <option value="account">{t('خصم من رصيد العميل', 'Deduct from Customer Balance')}</option>
              <option value="cash">
                {isRepRoleAccount || !canCashOps
                  ? t('طلب رد نقدي (باعتماد الخزينة/الإدارة)', 'Cash Refund Request (Treasury/Admin Approval)')
                  : t('صرف نقدي من الخزينة', 'Cash Disbursement from Cashbox')}
              </option>
            </select>
            <select
              value={sRetWarehouseId}
              onChange={(e) => setSRetWarehouseId(e.target.value)}
              className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{t(w.name)}</option>
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
                <option key={cb.id} value={cb.id}>{t(cb.name)}</option>
              ))}
            </select>
          ) : (
            <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
              {t(
                'يُرسل هذا المرتجع النقدي كطلب مراجعة للخزينة والإدارة دون اختيار خزينة، ولا يتأثر رصيد أي خزينة حتى الاعتماد الرسمي.',
                'This cash return is sent as a review request to Treasury & Admin without selecting a cashbox; no cashbox balance changes until formally approved.'
              )}
            </div>
          ))}

          <input
            type="text"
            value={sRetReason}
            onChange={(e) => setSRetReason(e.target.value)}
            required={sRetSettlement === 'cash' && (isRepRoleAccount || !canCashOps)}
            placeholder={
              sRetSettlement === 'cash' && (isRepRoleAccount || !canCashOps)
                ? t('سبب طلب مرتجع المبيعات النقدي (إلزامي)...', 'Reason for cash sales return request (required)...')
                : t('سبب المرتجع...', 'Return reason...')
            }
            className="w-full h-8 rounded-md border border-slate-300 px-2"
          />

          <button
            type="submit"
            disabled={isSubmittingSRet || sRetItems.length === 0}
            className="w-full h-9 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-black disabled:opacity-50 cursor-pointer"
          >
            {isSubmittingSRet
              ? t('جاري التسجيل...', 'Submitting...')
              : sRetSettlement === 'cash' && (isRepRoleAccount || !canCashOps)
              ? t(
                  `إرسال طلب مرتجع بيع نقدي للمراجعة (${formatLocaleNumber(sRetTotal)} ${t(data.settings.currency)})`,
                  `Submit Cash Sales Return Request (${formatLocaleNumber(sRetTotal)} ${t(data.settings.currency)})`
                )
              : t(
                  `اعتماد مرتجع البيع (${formatLocaleNumber(sRetTotal)} ${t(data.settings.currency)})`,
                  `Confirm Sales Return (${formatLocaleNumber(sRetTotal)} ${t(data.settings.currency)})`
                )}
          </button>
        </form>
      )}

      {/* ==================== PURCHASE RETURN / REQUEST ==================== */}
      {activeTab === 'purchase-return' && (
        <form onSubmit={handleSubmitPurchaseReturn} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs sm:text-sm font-black text-[#011E58]">
              {isRepRoleAccount || !canPurchases ? t('طلب مرتجع مشتريات (يعتمد من الإدارة)', 'Purchase Return Request (Admin Approval)') : t('تسجيل مرتجع مشتريات', 'Record Purchase Return')}
            </h3>
            <button
              type="button"
              onClick={() => onTabChange('purchase-returns-list')}
              className="text-[11px] font-bold text-[#003589] underline cursor-pointer"
            >
              {t('عرض الطلبات والمرتجعات', 'View Requests & Returns')}
            </button>
          </div>

          {(isRepRoleAccount || !canPurchases) && (
            <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-950 font-bold text-[11px]">
              {t(
                'المندوب يرفع طلب مرتجع مرتبط بفاتورة شراء معتمدة خاصة به؛ ولا يتم تعديل المخزون أو رصيد المورد أو الخزينة إلا بعد مراجعة واعتماد الإدارة.',
                'The rep submits a return request linked to their own confirmed purchase invoice; inventory, supplier balance, and cashbox remain unchanged until Admin approval.'
              )}
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
              <option value="">{t('-- اختر المورد --', '-- Select Supplier --')}</option>
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
                {isRepRoleAccount || !canPurchases ? t('-- اختر فاتورة الشراء المعتمدة (إلزامي) --', '-- Select Confirmed Purchase Invoice (Required) --') : t('-- ربط بفاتورة شراء (اختياري) --', '-- Link to Purchase Invoice (Optional) --')}
              </option>
              {confirmedOwnPurchases
                .filter((i) => !pRetSupplierId || i.supplierId === pRetSupplierId)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNumber} · {i.supplierName} ({formatLocaleNumber(i.grandTotal)})
                  </option>
                ))}
            </select>
          </div>

          <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] space-y-1.5">
            {isRepRoleAccount || !canPurchases ? (
              !selectedPRetOrigInvoice ? (
                <p className="text-[11px] font-bold text-[#011E58] py-1.5 text-center">
                  {t('اختر أولاً فاتورة شراء معتمدة خاصة بك لعرض الأصناف القابلة للإرجاع منها.', 'Select one of your confirmed purchase invoices first to view returnable items.')}
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
                    <option value="">{t('-- اختر الصنف من بنود الفاتورة --', '-- Select Item from Invoice Lines --')}</option>
                    {pRetReturnableOptions.map((line) => (
                      <option
                        key={`${line.productId}::${line.unit}`}
                        value={`${line.productId}::${line.unit}`}
                        disabled={line.maxReturnableQty <= 0}
                      >
                        {line.productName} ({t(line.unit)}) — {t('متاح للإرجاع:', 'Returnable:')} {formatLocaleNumber(line.maxReturnableQty)} {t('من', 'of')} {formatLocaleNumber(line.quantity)}
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
                              {t('الكمية (الحد الأقصى:', 'Quantity (Max:')} {formatLocaleNumber(selectedLine.maxReturnableQty)})
                            </label>
                            <QuantityInput
                              allowDecimals
                              min={0.001}
                              max={selectedLine.maxReturnableQty}
                              value={pRetQty}
                              onChange={setPRetQty}
                              ariaLabel={t('كمية طلب مرتجع الشراء', 'Purchase return request quantity')}
                              inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-0.5">{t('سعر الوحدة', 'Unit Price')}</label>
                            <input
                              type="number"
                              min={0}
                              step="0.5"
                              value={pRetPrice}
                              onChange={(e) => setPRetPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                              placeholder={t('السعر', 'Price')}
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
                                text: t(
                                  `الكمية المطلوبة (${rq}) تتجاوز المتاح للإرجاع (${selectedLine.maxReturnableQty}).`,
                                  `Requested quantity (${rq}) exceeds returnable limit (${selectedLine.maxReturnableQty}).`
                                ),
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
                          {t('إضافة لطلب مرتجع الشراء', 'Add to Purchase Return Request')}
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
                  <option value="">{t('-- اختر الصنف المرتجع للمورد --', '-- Select Supplier Return Item --')}</option>
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({t(p.baseUnit)})</option>
                  ))}
                </select>
                {pRetProductId && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={pRetQty}
                      onChange={setPRetQty}
                      ariaLabel={t('كمية مرتجع الشراء', 'Purchase return quantity')}
                      inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={pRetPrice}
                      onChange={(e) => setPRetPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      placeholder={t('السعر', 'Price')}
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
                    {t('إضافة لمرتجع الشراء', 'Add to Purchase Return')}
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
              title={`${t('أصناف مرتجع المشتريات', 'Purchase Return Items')} (${formatLocaleNumber(pRetItems.length)})`}
              data={pRetItems}
              rowKey={(it, idx) => `${it.productId}-${idx}`}
              columns={[
                { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold">{it.productName}</span> },
                {
                  key: 'quantity',
                  header: t('الكمية', 'Qty'),
                  align: 'center',
                  render: (it) => <span className="font-mono">{formatLocaleNumber(it.quantity)} {t(it.unit)}</span>,
                },
                {
                  key: 'unitPrice',
                  header: t('السعر', 'Price'),
                  align: 'center',
                  render: (it) => <span className="font-mono">{formatLocaleNumber(it.unitPrice)}</span>,
                },
                {
                  key: 'total',
                  header: t('الإجمالي', 'Total'),
                  align: 'center',
                  render: (it) => <strong className="font-mono text-[#011E58]">{formatLocaleNumber(it.total)}</strong>,
                },
                {
                  key: 'actions',
                  header: t('حذف', 'Remove'),
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
              <option value="account">{t('خصم من رصيد المورد', 'Deduct from Supplier Balance')}</option>
              <option value="cash">{t('استرداد نقدي', 'Cash Refund')}</option>
            </select>
            {!(isRepRoleAccount || !canPurchases) ? (
              <select
                value={pRetWarehouseId}
                onChange={(e) => setPRetWarehouseId(e.target.value)}
                className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
              >
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{t(w.name)}</option>
                ))}
              </select>
            ) : !isRepRoleAccount && canCashOps && pRetSettlement === 'cash' ? (
              <select
                value={pRetCashboxId}
                onChange={(e) => setPRetCashboxId(e.target.value)}
                className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
              >
                {data.cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>{t(cb.name)}</option>
                ))}
              </select>
            ) : (
              <div className="h-8 rounded-md border border-slate-200 px-2 flex items-center text-[11px] font-bold text-slate-600 bg-slate-50">
                {pRetSettlement === 'cash'
                  ? t(
                      `تُحدد الخزينة من الإدارة عند الاعتماد · المخزن: ${selectedPRetOrigInvoice?.warehouseName || 'حسب الفاتورة'}`,
                      `Cashbox is assigned by Admin on approval · Warehouse: ${t(selectedPRetOrigInvoice?.warehouseName || 'Per Invoice')}`
                    )
                  : t(
                      `المخزن: ${selectedPRetOrigInvoice?.warehouseName || 'حسب الفاتورة الأصلية'}`,
                      `Warehouse: ${t(selectedPRetOrigInvoice?.warehouseName || 'Per Original Invoice')}`
                    )}
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
                ? t('سبب طلب مرتجع الشراء (إلزامي)...', 'Purchase return request reason (required)...')
                : t('سبب مرتجع الشراء...', 'Purchase return reason...')
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
              ? t('جاري الإرسال...', 'Submitting...')
              : isRepRoleAccount || !canPurchases
              ? t(
                  `إرسال طلب مرتجع الشراء للإدارة (${formatLocaleNumber(pRetTotal)} ${t(data.settings.currency)})`,
                  `Send Purchase Return Request to Admin (${formatLocaleNumber(pRetTotal)} ${t(data.settings.currency)})`
                )
              : t(
                  `اعتماد مرتجع الشراء (${formatLocaleNumber(pRetTotal)} ${t(data.settings.currency)})`,
                  `Confirm Purchase Return (${formatLocaleNumber(pRetTotal)} ${t(data.settings.currency)})`
                )}
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
        const currency = t(data.settings.currency || 'ج.م');

        return (
          <form onSubmit={handleSubmitCashDeposit} className="bg-white rounded-lg border border-slate-200 overflow-hidden text-xs">
            {/* Brand Navy Collection Header */}
            <div className="awlad-brand-gradient text-white px-2.5 py-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-black shrink-0">
                  {depMode === 'cashbox_deposit' && !isRepRoleAccount ? t('إيداع مباشر بالخزينة', 'Direct Cashbox Deposit') : t('تحصيل من العميل', 'Customer Collection')}
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
                {t('إلغاء', 'Cancel')}
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
                    {t('تحصيل من عميل', 'Collect from Customer')}
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
                    {canCashOps ? t('إيداع مباشر بالخزينة', 'Direct Cashbox Deposit') : t('إيداع بالخزينة (مقيد)', 'Cashbox Deposit (Restricted)')}
                  </button>
                </div>
              )}

              {(depMode === 'customer_collection' || isRepRoleAccount) && (
                <>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('العميل', 'Customer')}</label>
                    <select
                      value={depCustomerId}
                      onChange={(e) => {
                        setDepCustomerId(e.target.value);
                        setDepInvoiceId('');
                      }}
                      className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                    >
                      <option value="">{t('-- اختر العميل --', '-- Select Customer --')}</option>
                      {data.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.shopName || c.name} — {t('رصيد:', 'Balance:')} {formatLocaleNumber(Number(c.currentBalance || 0))} {currency}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* WA0005 3-Col Hairline Balance Summary Strip */}
                  {depCustomer && (
                    <div className="grid grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden tabular-nums">
                      <div className="bg-slate-50 px-2 py-1.5 text-center">
                        <span className="block text-[10px] font-bold text-slate-500">{t('عليه حالياً', 'Current Due')}</span>
                        <strong className="font-mono text-xs font-black text-slate-900">
                          {formatLocaleNumber(currentDueTotal)} {currency}
                        </strong>
                      </div>
                      <div className="bg-white px-2 py-1.5 text-center">
                        <span className="block text-[10px] font-bold text-slate-500">{t('هيدفع دلوقتي', 'Paying Now')}</span>
                        <strong className="font-mono text-xs font-black text-emerald-700">
                          {formatLocaleNumber(payNow)} {currency}
                        </strong>
                      </div>
                      <div className="bg-slate-50 px-2 py-1.5 text-center">
                        <span className="block text-[10px] font-bold text-slate-500">{t('هيتبقى عليه', 'Remaining')}</span>
                        <strong className={`font-mono text-xs font-black ${remainingAfterPay > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {formatLocaleNumber(remainingAfterPay)} {currency}
                        </strong>
                      </div>
                    </div>
                  )}

                  {depCustomer && openCustomerInvoices.length > 0 && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('سداد فاتورة محددة (اختياري)', 'Pay Specific Invoice (Optional)')}</label>
                      <select
                        value={depInvoiceId}
                        onChange={(e) => setDepInvoiceId(e.target.value)}
                        className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                      >
                        <option value="">{t('توزيع تلقائي (الأقدم أولاً FIFO)', 'Auto-Allocate (Oldest First FIFO)')}</option>
                        {openCustomerInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.invoiceNumber} · {formatLocaleDate(inv.date)} — {t('متبقي:', 'Due:')} {formatLocaleNumber(Number(inv.remainingAmount || 0))} {currency}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* Amount Input + Quick Fill */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-bold text-slate-700">{t('المبلغ المدفوع', 'Amount Paid')} ({currency})</label>
                  {(depMode === 'customer_collection' || isRepRoleAccount) && targetDueForQuickFill > 0 && (
                    <button
                      type="button"
                      onClick={() => setDepAmount(targetDueForQuickFill)}
                      className="h-7 px-2 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] text-[11px] font-black cursor-pointer"
                    >
                      {t('ادفع المبلغ كله', 'Pay Full Amount')} ({formatLocaleNumber(targetDueForQuickFill)})
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
                  placeholder={t(`أدخل المبلغ (${currency})`, `Enter amount (${currency})`)}
                  className="w-full h-9 rounded-md border border-slate-300 px-2.5 font-mono text-sm font-black text-center text-[#011E58] bg-white tabular-nums"
                />
              </div>

              <div className={`grid gap-1.5 ${!isRepRoleAccount ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('التاريخ', 'Date')}</label>
                  <input
                    type="date"
                    dir="ltr"
                    value={depDate}
                    onChange={(e) => setDepDate(e.target.value)}
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-bold bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('طريقة السداد', 'Payment Method')}</label>
                  <select
                    value={depMethod}
                    onChange={(e) => setDepMethod(e.target.value as any)}
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                  >
                    <option value="cash">{t('نقدي', 'Cash')}</option>
                    <option value="bank">{t('تحويل بنكي', 'Bank Transfer')}</option>
                    <option value="cheque">{t('شيك', 'Cheque')}</option>
                  </select>
                </div>
                {!isRepRoleAccount && (
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('الخزينة', 'Cashbox')}</label>
                    <select
                      value={depCashboxId}
                      onChange={(e) => setDepCashboxId(e.target.value)}
                      className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                    >
                      {data.cashboxes.map((cb) => (
                        <option key={cb.id} value={cb.id}>{t(cb.name)}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('ملاحظات (اختياري)', 'Notes (Optional)')}</label>
                <input
                  type="text"
                  value={depNotes}
                  onChange={(e) => setDepNotes(e.target.value)}
                  placeholder={t('ملاحظات (اختياري) - تظهر في إيصال الدفع', 'Notes (optional) - shown on payment receipt')}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => onTabChange('customers')}
                  className="h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-black cursor-pointer"
                >
                  {t('إلغاء', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDeposit || Number(depAmount || 0) <= 0}
                  className="col-span-2 h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingDeposit ? t('جاري التسجيل...', 'Submitting...') : t('دفع وتأكيد التحصيل', 'Confirm & Collect Payment')}
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
            <p className="font-black text-red-800">{t('غير مصرح لحساب المندوب بتنفيذ سحب أو مصروف مباشر من الخزائن.', 'Rep account is not authorized to perform direct cashbox withdrawals or expenses.')}</p>
            <button
              type="button"
              onClick={() => onTabChange('home')}
              className="h-8 px-3 rounded-md bg-slate-100 font-bold text-slate-800 cursor-pointer"
            >
              {t('العودة للرئيسية', 'Back to Home')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmitCashWithdrawal} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5 text-xs">
            <h3 className="text-xs sm:text-sm font-black text-amber-900">{t('سحب نقدي / تسجيل مصروف', 'Cash Withdrawal / Expense')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <select
                value={wdCashboxId}
                onChange={(e) => setWdCashboxId(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
              >
                {data.cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {t(cb.name)}
                    {typeof cb.currentBalance === 'number' && !cb.balanceHidden
                      ? ` (${t('رصيد:', 'Balance:')} ${formatLocaleNumber(cb.currentBalance)})`
                      : ''}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={wdCategory}
                onChange={(e) => setWdCategory(e.target.value)}
                placeholder={t('البند / التصنيف (مثال: بنزين / مصروف تشغيل)', 'Category (e.g., Fuel / Operating Expense)')}
                className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold"
              />
              <input
                type="text"
                value={wdBeneficiary}
                onChange={(e) => setWdBeneficiary(e.target.value)}
                placeholder={t('المستفيد (اختياري)', 'Beneficiary (optional)')}
                className="w-full h-8 rounded-md border border-slate-300 px-2"
              />
              <input
                type="number"
                min={1}
                step="0.01"
                value={wdAmount || ''}
                onChange={(e) => setWdAmount(Math.max(0, Number(e.target.value)))}
                placeholder={t(`مبلغ السحب (${t(data.settings.currency)})`, `Withdrawal amount (${t(data.settings.currency)})`)}
                className="w-full h-8 rounded-md border border-slate-300 px-2 font-mono font-black text-center text-red-700"
              />
            </div>
            <input
              type="text"
              value={wdNotes}
              onChange={(e) => setWdNotes(e.target.value)}
              placeholder={t('بيان السحب / المصروف...', 'Withdrawal / expense description...')}
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />
            <button
              type="submit"
              disabled={isSubmittingWithdrawal}
              className="w-full h-9 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isSubmittingWithdrawal ? t('جاري التسجيل...', 'Submitting...') : t('تأكيد السحب النقدي', 'Confirm Cash Withdrawal')}
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
            <h3 className="text-xs sm:text-sm font-black text-slate-900">{t('إضافة عميل / محل جديد', 'Add New Customer / Shop')}</h3>

            {/* 1. Shop Name & 2. Customer Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('اسم المحل', 'Shop Name')}</label>
                <input
                  type="text"
                  value={newCustShop}
                  onChange={(e) => setNewCustShop(e.target.value)}
                  placeholder={t('مثال: سوبرماركت النور', 'e.g., Al-Nour Supermarket')}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('اسم العميل / صاحب المحل *', 'Customer / Owner Name *')}</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder={t('الاسم الكامل للعميل أو صاحب المحل', 'Full name of customer or owner')}
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
                    title={t('عرض الصورة', 'View photo')}
                  >
                    <img src={newCustShopPhoto} alt={t('صورة المحل', 'Shop photo')} className="w-full h-full object-cover" />
                  </button>
                ) : (
                  <Store className="w-4 h-4 text-slate-300" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <span className="block text-[11px] font-black text-slate-800">{t('صورة المحل / الواجهة', 'Shop / Storefront Photo')}</span>
                <div className="flex flex-wrap gap-1.5">
                  <label className="h-7 px-2 rounded-md bg-blue-900 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer">
                    <Camera className="w-3.5 h-3.5" />
                    <span>{newCustShopPhoto ? t('تغيير بالكاميرا', 'Retake Photo') : t('التقاط بالكاميرا', 'Take Photo')}</span>
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
                    <span>{t('من المعرض', 'From Gallery')}</span>
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
                      {t('حذف', 'Delete')}
                    </button>
                  )}
                </div>
                {isUploadingCustPhoto && <p className="text-[10px] font-bold text-blue-900">{t('جاري ضغط وتجهيز الصورة...', 'Compressing and preparing photo...')}</p>}
              </div>
            </div>

            {/* 4. Address + adjacent GPS Icon Button + Maps Preview */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('عنوان المحل الرئيسي', 'Main Shop Address')}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => {
                    setNewCustAddress(e.target.value);
                    if (custMapNotice) setCustMapNotice(null);
                  }}
                  placeholder={t('الشارع، المنطقة، علامة مميزة...', 'Street, area, landmark...')}
                  className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-bold"
                />
                <button
                  type="button"
                  onClick={() => setLocationPickerTarget('new')}
                  className="h-8 px-2 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  title={t('تحديد موقع العميل على خريطة جوجل', 'Pick customer location on Google Maps')}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{t('خريطة', 'Map')}</span>
                </button>
                <button
                  type="button"
                  disabled={isLocatingCust}
                  onClick={handleCaptureCustLocation}
                  className="h-8 px-2 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                  title={t('تحديد الموقع الحالي GPS وجلب العنوان تلقائياً', 'Capture current GPS location and fetch address')}
                >
                  <MapPin className="w-3.5 h-3.5 text-[#003589]" />
                  <span>{isLocatingCust ? t('تحديد...', 'Locating...') : 'GPS'}</span>
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
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('المحافظة', 'Governorate')}</label>
                <input
                  type="text"
                  value={newCustGovernorate}
                  onChange={(e) => setNewCustGovernorate(e.target.value)}
                  placeholder={t('مثال: القاهرة / الجيزة', 'e.g., Cairo / Giza')}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('المنطقة / خط السير', 'Area / Route')}</label>
                <input
                  type="text"
                  value={newCustArea}
                  onChange={(e) => setNewCustArea(e.target.value)}
                  placeholder={t('المنطقة / الحي / خط السير', 'Area / District / Route')}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 font-semibold"
                />
              </div>
            </div>

            {/* 6. Primary Phone + 7. Unlimited Additional Phones */}
            <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">{t('رقم التليفون الرئيسي *', 'Primary Phone Number *')}</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="tel"
                    dir="ltr"
                    required
                    value={newCustPhone}
                    onChange={(e) => {
                      setNewCustPhone(e.target.value);
                      if (custPhoneNotice) setCustPhoneNotice(null);
                    }}
                    placeholder="01012345678"
                    className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-mono font-bold bg-white text-start"
                  />
                  {helper.isPhoneValid ? (
                    <a
                      href={`tel:${helper.cleanedPhone}`}
                      onClick={() =>
                        setCustPhoneNotice({ type: 'info', text: t(`جاري الاتصال بالرقم (${helper.cleanedPhone}).`, `Calling (${helper.cleanedPhone}).`) })
                      }
                      className="h-8 px-2 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                      title={t('اتصال هاتفي مباشر', 'Direct phone call')}
                    >
                      <Phone className="w-3.5 h-3.5 text-[#003589]" />
                      <span>{t('اتصال', 'Call')}</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setCustPhoneNotice({ type: 'error', text: t('يرجى إدخال رقم هاتف صحيح (7 أرقام على الأقل) أولاً.', 'Please enter a valid phone number (at least 7 digits) first.') })
                      }
                      className="h-8 px-2 rounded-md bg-slate-100 text-slate-600 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>{t('اتصال', 'Call')}</span>
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
                  <label className="block font-bold text-slate-600 text-[10px]">{t('أرقام تليفون إضافية:', 'Additional Phone Numbers:')}</label>
                  {newCustExtraPhones.map((extra, idx) => {
                    const cleanEx = extra.phone.replace(/[^\d+]/g, '');
                    const validEx = cleanEx.replace(/\D/g, '').length >= 7;
                    return (
                      <div key={extra.id || idx} className="flex flex-wrap sm:flex-nowrap items-center gap-1">
                        <input
                          type="tel"
                          dir="ltr"
                          value={extra.phone}
                          onChange={(e) => {
                            const v = e.target.value;
                            setNewCustExtraPhones((prev) => prev.map((row, i) => (i === idx ? { ...row, phone: v } : row)));
                          }}
                          placeholder={t('رقم إضافي...', 'Additional number...')}
                          className="flex-1 min-w-[110px] h-8 rounded-md border border-slate-300 px-2 font-mono font-bold bg-white text-start"
                        />
                        <select
                          value={extra.label}
                          onChange={(e) => {
                            const v = e.target.value;
                            setNewCustExtraPhones((prev) => prev.map((row, i) => (i === idx ? { ...row, label: v } : row)));
                          }}
                          className="h-8 rounded-md border border-slate-300 px-1.5 font-bold bg-white"
                        >
                          <option value="موبايل">{t('موبايل', 'Mobile')}</option>
                          <option value="محل">{t('تليفون المحل', 'Shop Phone')}</option>
                          <option value="واتساب">{t('واتساب', 'WhatsApp')}</option>
                          <option value="إضافي">{t('إضافي', 'Other')}</option>
                        </select>
                        {validEx && (
                          <a
                            href={`tel:${cleanEx}`}
                            className="h-8 px-2 rounded-md bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5] inline-flex items-center"
                            title={t('اتصال', 'Call')}
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
                          {t('رئيسي', 'Primary')}
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
                <span>{t('إضافة رقم تليفون آخر', 'Add Another Phone')}</span>
              </button>
            </div>

            {/* 8. Notes & 9. Opening Balance (optional) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <input
                type="text"
                value={newCustNotes}
                onChange={(e) => setNewCustNotes(e.target.value)}
                placeholder={t('ملاحظات عن المحل أو المواعيد (اختياري)', 'Notes about shop or schedule (optional)')}
                className="h-8 rounded-md border border-slate-300 px-2"
              />
              <input
                type="number"
                value={newCustOpening || ''}
                onChange={(e) => setNewCustOpening(Number(e.target.value))}
                placeholder={t(`رصيد افتتاحي (${t(data.settings.currency)}) - اختياري`, `Opening balance (${t(data.settings.currency)}) - optional`)}
                className="h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
              />
            </div>

            {/* 10. Save Customer */}
            <button
              type="submit"
              disabled={isSavingCustomer || isUploadingCustPhoto}
              className="w-full h-9 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isSavingCustomer ? t('جاري الحفظ...', 'Saving...') : t('حفظ العميل الجديد', 'Save New Customer')}
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
            <h3 className="text-xs sm:text-sm font-black text-[#011E58]">{t('إضافة مورد جديد', 'Add New Supplier')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <input
                type="text"
                required
                value={newSupName}
                onChange={(e) => setNewSupName(e.target.value)}
                placeholder={t('اسم المورد *', 'Supplier Name *')}
                className="h-8 rounded-md border border-slate-300 px-2 font-bold"
              />
              <input
                type="text"
                value={newSupCompany}
                onChange={(e) => setNewSupCompany(e.target.value)}
                placeholder={t('اسم الشركة / المصنع', 'Company / Factory Name')}
                className="h-8 rounded-md border border-slate-300 px-2 font-bold"
              />
            </div>

            <div>
              <div className="flex items-center gap-1.5">
                <input
                  type="tel"
                  dir="ltr"
                  required
                  value={newSupPhone}
                  onChange={(e) => {
                    setNewSupPhone(e.target.value);
                    if (supPhoneNotice) setSupPhoneNotice(null);
                  }}
                  placeholder={t('رقم الهاتف *', 'Phone Number *')}
                  className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-mono font-bold text-start"
                />
                {supPhoneValid ? (
                  <a
                    href={`tel:${cleanedSupPhone}`}
                    className="h-8 px-2 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1"
                  >
                    <Phone className="w-3.5 h-3.5 text-[#003589]" />
                    <span>{t('اتصال', 'Call')}</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setSupPhoneNotice({ type: 'error', text: t('يرجى إدخال رقم هاتف المورد (7 أرقام على الأقل).', 'Please enter supplier phone number (at least 7 digits).') })
                    }
                    className="h-8 px-2 rounded-md bg-slate-100 text-slate-600 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>{t('اتصال', 'Call')}</span>
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
                placeholder={t('عنوان المورد', 'Supplier Address')}
                className="h-8 rounded-md border border-slate-300 px-2"
              />
              <input
                type="number"
                value={newSupOpening || ''}
                onChange={(e) => setNewSupOpening(Number(e.target.value))}
                placeholder={t(`رصيد افتتاحي (${t(data.settings.currency)})`, `Opening Balance (${t(data.settings.currency)})`)}
                className="h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
              />
            </div>

            <button
              type="submit"
              disabled={isSavingSupplier}
              className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isSavingSupplier ? t('جاري الحفظ...', 'Saving...') : t('حفظ المورد الجديد', 'Save New Supplier')}
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
              {t('الشيكات', 'Cheques')} ({formatLocaleNumber(data.cheques.length)})
            </button>
            <button
              type="button"
              onClick={() => setChqTab('installments')}
              className={`h-8 rounded-md font-black cursor-pointer ${
                chqTab === 'installments' ? 'bg-[#003589] text-white' : 'text-slate-700'
              }`}
            >
              {t('الأقساط', 'Installments')} ({formatLocaleNumber(data.installments.length)})
            </button>
          </div>

          {chqTab === 'cheques' && (
            <div className="space-y-2">
              <form onSubmit={handleAddCheque} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                <h4 className="text-xs sm:text-sm font-black text-slate-900">{t('تسجيل شيك جديد', 'Record New Cheque')}</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  <select
                    value={chqType}
                    onChange={(e) => setChqType(e.target.value as 'incoming' | 'outgoing')}
                    className="h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
                  >
                    <option value="incoming">{t('شيك وارد (تحصيل)', 'Incoming Cheque (Collection)')}</option>
                    <option value="outgoing">{t('شيك صادر (سداد)', 'Outgoing Cheque (Payment)')}</option>
                  </select>
                  <input
                    type="text"
                    dir="ltr"
                    value={chqNumber}
                    onChange={(e) => setChqNumber(e.target.value)}
                    placeholder={t('رقم الشيك', 'Cheque No.')}
                    className="h-8 rounded-md border border-slate-300 px-2 font-mono font-bold text-start"
                  />
                  <input
                    type="text"
                    value={chqPartyName}
                    onChange={(e) => setChqPartyName(e.target.value)}
                    placeholder={t('اسم العميل / المورد', 'Customer / Supplier Name')}
                    className="h-8 rounded-md border border-slate-300 px-2 font-bold col-span-2 sm:col-span-1"
                  />
                  <input
                    type="text"
                    value={chqBank}
                    onChange={(e) => setChqBank(e.target.value)}
                    placeholder={t('اسم البنك', 'Bank Name')}
                    className="h-8 rounded-md border border-slate-300 px-2"
                  />
                  <input
                    type="number"
                    min={1}
                    value={chqAmount || ''}
                    onChange={(e) => setChqAmount(Number(e.target.value))}
                    placeholder={t('المبلغ', 'Amount')}
                    className="h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
                  />
                  <input
                    type="date"
                    dir="ltr"
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
                  {isSavingCheque ? t('جاري التسجيل...', 'Submitting...') : t('حفظ الشيك', 'Save Cheque')}
                </button>
              </form>

              <UnifiedDataTable
                compact
                title={`${t('الشيكات المسجلة', 'Recorded Cheques')} (${formatLocaleNumber(data.cheques.length)})`}
                data={data.cheques}
                rowKey={(chq) => chq.id}
                emptyTitle={t('لا توجد شيكات مسجلة', 'No cheques recorded')}
                columns={[
                  { key: 'chequeNumber', header: t('رقم الشيك', 'Cheque No.'), render: (chq) => <span className="font-mono font-black text-blue-950">{chq.chequeNumber}</span> },
                  { key: 'partyName', header: t('الطرف / البنك', 'Party / Bank'), render: (chq) => `${chq.partyName} · ${chq.bankName}` },
                  { key: 'dueDate', header: t('الاستحقاق', 'Due Date'), align: 'center', render: (chq) => <span className="font-mono">{formatLocaleDate(chq.dueDate)}</span> },
                  {
                    key: 'amount',
                    header: t('المبلغ', 'Amount'),
                    align: 'center',
                    render: (chq) => (
                      <strong className="font-mono font-black text-slate-900">
                        {formatLocaleNumber(chq.amount)} {t(data.settings.currency)}
                      </strong>
                    ),
                  },
                  {
                    key: 'status',
                    header: t('الحالة', 'Status'),
                    align: 'center',
                    render: (chq) => (
                      <span className="font-bold text-slate-700">
                        {chq.status === 'collected' ? t('محصل', 'Collected') : chq.status === 'rejected' || chq.status === 'returned' ? t('مرتد / مرفوض', 'Returned / Rejected') : t('قيد الانتظار', 'Pending')}
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
                title={`${t('جداول الأقساط', 'Installment Schedules')} (${formatLocaleNumber(data.installments.length)})`}
                data={data.installments}
                rowKey={(sched) => sched.id}
                emptyTitle={t('لا توجد جداول أقساط نشطة حالياً', 'No active installment schedules')}
                columns={[
                  { key: 'scheduleNumber', header: t('رقم الجدول', 'Schedule No.'), render: (sched) => <span className="font-mono font-black text-blue-950">{sched.scheduleNumber}</span> },
                  { key: 'customerName', header: t('العميل', 'Customer'), render: (sched) => <span className="font-bold">{sched.customerName}</span> },
                  {
                    key: 'remainingAmount',
                    header: t('المتبقي', 'Remaining'),
                    align: 'center',
                    render: (sched) => (
                      <strong className="font-mono text-red-700">
                        {formatLocaleNumber(sched.remainingAmount)} {t(data.settings.currency)}
                      </strong>
                    ),
                  },
                  {
                    key: 'actions',
                    header: t('تحصيل القسط المستحق', 'Collect Due Installment'),
                    render: (sched) => {
                      const nextDue = (sched.items || []).filter((it) => it.status !== 'paid').slice(0, 2);
                      if (nextDue.length === 0) return <span className="text-emerald-700 font-bold">{t('مسدد بالكامل', 'Fully Paid')}</span>;
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
                                  setFeedback({ type: 'success', text: t('تم تحصيل القسط وتحديث الجدول.', 'Installment collected and schedule updated.') });
                                }}
                                className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                              >
                                {payingInstKey === key
                                  ? t('جاري التحصيل...', 'Collecting...')
                                  : `${t('تحصيل', 'Collect')} (${formatLocaleNumber(it.amount - it.paidAmount)} · ${formatLocaleDate(it.dueDate)})`}
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
              <h3 className="text-xs sm:text-sm font-black text-blue-950">{t('إنشاء عرض سعر (بدون خصم مخزني أو قيد مالي)', 'Create Price Quote (Zero Stock / Ledger Impact)')}</h3>
              <p className="text-[10px] text-slate-500">{t('يمكن تحويل عرض السعر لاحقاً لفاتورة مبيعات معتمدة بضغطة واحدة.', 'Price quotes can later be converted into a confirmed sales invoice in one click.')}</p>
            </div>
            <select
              value={quoteCustomerId}
              onChange={(e) => setQuoteCustomerId(e.target.value)}
              className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="">{t('-- اختر العميل (أو عميل عام) --', '-- Select Customer (or Walk-in) --')}</option>
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
                <option value="">{t('-- اختر الصنف لعرض السعر --', '-- Select Item for Quote --')}</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({formatLocaleNumber(p.sellingPrice)} {t(data.settings.currency)})</option>
                ))}
              </select>
              {quoteProductId && (
                <div className="grid grid-cols-3 gap-1.5">
                  <QuantityInput
                    allowDecimals
                    min={0.001}
                    value={quoteQty}
                    onChange={setQuoteQty}
                    ariaLabel={t('كمية عرض السعر', 'Quote quantity')}
                    inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={quotePrice}
                    onChange={(e) => setQuotePrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    placeholder={t('السعر', 'Price')}
                    className="h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddQuoteItem}
                    className="h-8 rounded-md bg-blue-900 text-white font-black cursor-pointer"
                  >
                    {t('إضافة', 'Add')}
                  </button>
                </div>
              )}
            </div>

            {quoteItems.length > 0 && (
              <UnifiedDataTable
                compact
                paginated={false}
                searchable={false}
                title={`${t('أصناف عرض السعر', 'Quote Items')} (${formatLocaleNumber(quoteItems.length)})`}
                data={quoteItems}
                rowKey={(it, idx) => `${it.productId}-${idx}`}
                columns={[
                  { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'quantity', header: t('الكمية', 'Qty'), align: 'center', render: (it) => <span className="font-mono">{formatLocaleNumber(it.quantity)}</span> },
                  { key: 'unitPrice', header: t('السعر', 'Price'), align: 'center', render: (it) => <span className="font-mono">{formatLocaleNumber(it.unitPrice)}</span> },
                  { key: 'total', header: t('الإجمالي', 'Total'), align: 'center', render: (it) => <strong className="font-mono text-blue-950">{formatLocaleNumber(it.total)}</strong> },
                ]}
              />
            )}

            <input
              type="text"
              value={quoteNotes}
              onChange={(e) => setQuoteNotes(e.target.value)}
              placeholder={t('صلاحية العرض وملاحظات...', 'Quote validity & notes...')}
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />

            <button
              type="submit"
              disabled={isSubmittingQuote || quoteItems.length === 0}
              className="w-full h-9 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black disabled:opacity-50 cursor-pointer"
            >
              {isSubmittingQuote ? t('جاري الحفظ...', 'Saving...') : `${t('حفظ عرض السعر', 'Save Price Quote')} (${formatLocaleNumber(quoteTotal)} ${t(data.settings.currency)})`}
            </button>
          </form>

          {myQuotes.length > 0 && (
            <UnifiedDataTable
              compact
              title={`${t('عروض الأسعار المسجلة', 'Saved Price Quotes')} (${formatLocaleNumber(myQuotes.length)})`}
              data={myQuotes}
              rowKey={(q) => q.id}
              columns={[
                { key: 'invoiceNumber', header: t('رقم العرض', 'Quote No.'), render: (q) => <span className="font-mono font-black text-blue-950">{q.invoiceNumber}</span> },
                { key: 'customerName', header: t('العميل', 'Customer'), render: (q) => q.customerName || t('عميل عام', 'Walk-in Customer') },
                { key: 'date', header: t('التاريخ', 'Date'), align: 'center', render: (q) => <span className="font-mono">{formatLocaleDate(q.date)}</span> },
                {
                  key: 'grandTotal',
                  header: t('الإجمالي', 'Total'),
                  align: 'center',
                  render: (q) => (
                    <strong className="font-mono font-black text-slate-900">
                      {formatLocaleNumber(q.grandTotal)} {t(data.settings.currency)}
                    </strong>
                  ),
                },
                {
                  key: 'actions',
                  header: t('الإجراءات', 'Actions'),
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
                          {isConverted ? t('تم التحويل', 'Converted') : convertingQuoteId === q.id ? t('جاري التحويل...', 'Converting...') : t('تحويل لفاتورة', 'Convert to Invoice')}
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
          title={`${t('فواتير المبيعات', 'Sales Invoices')} (${formatLocaleNumber(myInvoices.length)})`}
          data={myInvoices}
          rowKey={(inv) => inv.id}
          emptyTitle={t('لا توجد فواتير مبيعات مسجلة حتى الآن', 'No sales invoices recorded yet')}
          columns={[
            {
              key: 'invoiceNumber',
              header: t('رقم الفاتورة', 'Invoice No.'),
              render: (inv) => (
                <div>
                  <span className="font-mono font-black text-blue-950 block">{inv.invoiceNumber}</span>
                  {inv.syncStatus && inv.syncStatus !== 'synced' && (
                    <span className="inline-flex items-center gap-0.5 text-amber-800 font-bold text-[10px]">
                      <CloudOff className="w-3 h-3" />
                      <span>{t('محلي', 'Local')}</span>
                    </span>
                  )}
                </div>
              ),
            },
            { key: 'customerName', header: t('العميل', 'Customer'), render: (inv) => <span className="font-bold">{inv.customerName || t('عميل', 'Customer')}</span> },
            { key: 'date', header: t('التاريخ', 'Date'), align: 'center', render: (inv) => <span className="font-mono">{formatLocaleDate(inv.date)}</span> },
            {
              key: 'grandTotal',
              header: t('الإجمالي', 'Total'),
              align: 'center',
              sortValue: (inv) => Number(inv.grandTotal || 0),
              render: (inv) => (
                <strong className="font-mono text-slate-900 tabular-nums">
                  {formatLocaleNumber(inv.grandTotal)} {t(data.settings.currency)}
                </strong>
              ),
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
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
                      {inv.status === 'confirmed' ? t('معتمدة', 'Confirmed') : inv.status === 'draft' ? t('مسودة', 'Draft') : t('ملغاة', 'Cancelled')}
                    </span>
                    {inv.reviewStatus === 'needs_review' && (
                      <span className="text-amber-700 font-bold text-[10px] block">{t('بانتظار مراجعة الإدارة', 'Pending Admin Review')}</span>
                    )}
                    {inv.reviewStatus === 'reviewed' && (
                      <span className="text-blue-800 font-bold text-[10px] block">{t('تمت المراجعة', 'Reviewed')}</span>
                    )}
                    {inv.status === 'draft' && inv.linkedRepTransferNumber && (
                      <span className="text-[10px] text-blue-900 font-bold block">
                        {t('تحويل:', 'Transfer:')} {inv.linkedRepTransferNumber}
                        {!confirmCheck.ready && confirmCheck.reason ? ` (${t(confirmCheck.reason)})` : ''}
                      </span>
                    )}
                  </div>
                );
              },
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
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
                        {t('اعتماد نهائي', 'Confirm Final')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[11px] font-bold cursor-pointer"
                    >
                      {t('التفاصيل', 'Details')}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportInvoiceDocument(inv)}
                      className="px-2 py-0.5 rounded-md bg-blue-900 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      {isNative ? <Share2 className="w-3 h-3" /> : <FileDown className="w-3 h-3" />}
                      <span>{isNative ? t('مشاركة', 'Share') : 'PDF'}</span>
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
            <h3 className="text-xs sm:text-sm font-black text-slate-900">
              {t(`فواتير الشراء (${filteredPurchases.length})`, `Purchase Invoices (${filteredPurchases.length})`)}
            </h3>
            <button
              type="button"
              onClick={() => {
                setPurEditingInvoiceId(null);
                onTabChange('new-purchase');
              }}
              className="h-8 px-2.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-bold cursor-pointer"
            >
              {t('+ فاتورة شراء', '+ Purchase Invoice')}
            </button>
          </div>

          <div className="awlad-filter-row" data-testid="rep-purchases-filter-row">
            {[
              { id: 'all' as const, label: t('الكل', 'All') },
              { id: 'draft' as const, label: t('مسودة', 'Draft') },
              { id: 'sent' as const, label: t('مرسلة', 'Sent') },
              { id: 'received' as const, label: t('تم الاستلام', 'Received') },
              { id: 'rejected' as const, label: t('مرفوضة', 'Rejected') },
              { id: 'confirmed' as const, label: t('معتمدة', 'Confirmed') },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPurListFilter(tab.id)}
                className={`h-8 inline-flex items-center px-2.5 rounded-md text-xs font-bold border cursor-pointer shrink-0 ${
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
            title={t(`جدول فواتير الشراء (${filteredPurchases.length})`, `Purchase Invoices Table (${filteredPurchases.length})`)}
            data={filteredPurchases}
            rowKey={(inv) => inv.id}
            emptyTitle={t('لا توجد فواتير مشتريات في هذا التصنيف', 'No purchase invoices in this category')}
            columns={[
              {
                key: 'invoiceNumber',
                header: t('رقم الفاتورة', 'Invoice #'),
                render: (inv) => <span className="font-mono font-black text-[#011E58]">{inv.invoiceNumber}</span>,
              },
              {
                key: 'supplierName',
                header: t('المورد / المخزن', 'Supplier / Warehouse'),
                render: (inv) => (
                  <div>
                    <span className="font-bold text-slate-900 block">{inv.supplierName}</span>
                    <span className="text-[10px] text-slate-500">{inv.warehouseName} · {inv.date}</span>
                  </div>
                ),
              },
              {
                key: 'grandTotal',
                header: t('الإجمالي', 'Total'),
                align: 'center',
                sortValue: (inv) => Number(inv.grandTotal || 0),
                render: (inv) => {
                  const remainingVal = Math.max(0, Number(inv.remainingAmount || 0));
                  return (
                    <div className="whitespace-nowrap">
                      <strong className="font-mono text-slate-900 block">
                        {formatLocaleNumber(inv.grandTotal)} {t(data.settings.currency)}
                      </strong>
                      {inv.status === 'confirmed' && (
                        <span className={`text-[10px] font-bold block ${remainingVal > 0.009 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {remainingVal > 0.009
                            ? `${t('متبقي:', 'Remaining:')} ${formatLocaleNumber(remainingVal)}`
                            : t('مسددة بالكامل', 'Fully Paid')}
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'dispatchStatus',
                header: t('الحالة والاستلام', 'Status & Receipt'),
                render: (inv) => {
                  const meta = getPurchaseDispatchMeta(inv);
                  return (
                    <div className="space-y-0.5 text-[11px]">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${meta.badgeClass}`}>
                        {t(meta.label)}
                      </span>
                      {inv.recipientName && (
                        <span className="block text-slate-600">{t('موجهة إلى:', 'Directed to:')} {inv.recipientName}</span>
                      )}
                      {inv.receivedBy && (
                        <span className="block text-[#003589] font-bold">
                          {t('المستلم:', 'Received by:')} {inv.receivedBy}
                        </span>
                      )}
                      {inv.dispatchStatus === 'rejected' && inv.rejectionReason && (
                        <span className="block text-rose-800 font-bold">{t('سبب الرفض:', 'Rejection Reason:')} {inv.rejectionReason}</span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'actions',
                header: t('الإجراءات', 'Actions'),
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
                        <span>{t('التفاصيل', 'Details')}</span>
                      </button>
                      {canRecordPurchasePayment && (
                        <button
                          type="button"
                          onClick={() => openPurchasePaymentModal(inv)}
                          className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <CreditCard className="w-3 h-3" />
                          <span>{t('سداد', 'Pay')}</span>
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
                            <span>{t('إرسال', 'Send')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartEditPurchase(inv)}
                            className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit className="w-3 h-3" />
                            <span>{t('تعديل', 'Edit')}</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setHistoryPurchaseTarget(inv)}
                        className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <History className="w-3 h-3" />
                        <span>{t('السجل', 'History')}</span>
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
                {t(
                  `طلبات ومرتجعات البيع (${mySalesReturnRequests.length} طلب · ${mySalesReturns.length} معتمد)`,
                  `Sales Return Requests & Approved (${mySalesReturnRequests.length} req · ${mySalesReturns.length} approved)`
                )}
              </h3>
              <p className="text-[10px] text-slate-500">
                {t(
                  'طلبات المرتجع النقدي تخضع لمراجعة الإدارة والخزينة قبل صرف أي مبالغ أو تعديل الأرصدة.',
                  'Cash return requests undergo admin and treasury review before payout or balance adjustment.'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onTabChange('sales-return')}
              className="h-8 px-2.5 rounded-md bg-rose-700 text-white font-bold cursor-pointer shrink-0"
            >
              {t('+ مرتجع بيع', '+ Sales Return')}
            </button>
          </div>

          {mySalesReturnRequests.length > 0 && (
            <UnifiedDataTable<SalesReturnRequest>
              compact
              title={t(`طلبات مرتجع المبيعات النقدي (${mySalesReturnRequests.length})`, `Cash Sales Return Requests (${mySalesReturnRequests.length})`)}
              data={mySalesReturnRequests}
              rowKey={(req) => req.id}
              columns={[
                {
                  key: 'requestNumber',
                  header: t('رقم الطلب', 'Request #'),
                  render: (req) => (
                    <div>
                      <span className="font-mono font-black text-rose-900 block">{req.requestNumber}</span>
                      {req.syncStatus === 'pending' && (
                        <span className="text-[10px] font-bold text-slate-600">{t('بانتظار المزامنة', 'Pending Sync')}</span>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'customerName',
                  header: t('العميل / الفاتورة', 'Customer / Invoice'),
                  render: (req) => (
                    <div>
                      <span className="font-bold text-slate-900 block">{req.customerName}</span>
                      <span className="text-[10px] text-slate-500">{t('فاتورة', 'Invoice')} {req.originalInvoiceNumber} · {req.date}</span>
                    </div>
                  ),
                },
                {
                  key: 'grandTotal',
                  header: t('الإجمالي', 'Total'),
                  align: 'center',
                  render: (req) => (
                    <strong className="font-mono text-rose-800">
                      {formatLocaleNumber(Number(req.grandTotal || 0))} {t(data.settings.currency)}
                    </strong>
                  ),
                },
                {
                  key: 'status',
                  header: t('الحالة', 'Status'),
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
                        {req.status === 'approved'
                          ? t('تم الاعتماد والتنفيذ', 'Approved & Executed')
                          : req.status === 'rejected'
                          ? t('مرفوض', 'Rejected')
                          : t('قيد مراجعة الخزينة/الإدارة', 'Pending Treasury/Admin Review')}
                      </span>
                      {req.reason && <span className="block text-slate-500">{req.reason}</span>}
                      {req.status === 'approved' && req.approvedReturnNumber && (
                        <span className="block font-bold text-emerald-800">{t('مرتجع رقم:', 'Return #:')} {req.approvedReturnNumber}</span>
                      )}
                      {req.status === 'rejected' && req.rejectionReason && (
                        <span className="block font-bold text-rose-800">{t('الرفض:', 'Rejection:')} {req.rejectionReason}</span>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}

          <UnifiedDataTable<InvoiceReturn>
            compact
            title={t(`مرتجعات المبيعات المعتمدة (${mySalesReturns.length})`, `Approved Sales Returns (${mySalesReturns.length})`)}
            data={mySalesReturns}
            rowKey={(r) => r.id}
            emptyTitle={t('لا توجد مرتجعات مبيعات معتمدة', 'No approved sales returns')}
            columns={[
              { key: 'returnNumber', header: t('رقم المرتجع', 'Return #'), render: (r) => <span className="font-mono font-black text-rose-900">{r.returnNumber}</span> },
              { key: 'partyName', header: t('العميل', 'Customer'), render: (r) => r.partyName },
              { key: 'date', header: t('التاريخ', 'Date'), align: 'center', render: (r) => <span className="font-mono">{r.date}</span> },
              {
                key: 'grandTotal',
                header: t('الإجمالي', 'Total'),
                align: 'center',
                render: (r) => (
                  <strong className="font-mono text-rose-800">
                    {formatLocaleNumber(r.grandTotal)} {t(data.settings.currency)}
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
                {t(
                  `طلبات ومرتجعات الشراء (${myPurchaseReturnRequests.length} طلب · ${myPurchaseReturns.length} معتمد)`,
                  `Purchase Return Requests & Approved (${myPurchaseReturnRequests.length} req · ${myPurchaseReturns.length} approved)`
                )}
              </h3>
              <p className="text-[10px] text-slate-500">
                {t(
                  'طلبات مرتجع الشراء تخضع لمراجعة واعتماد الإدارة قبل تعديل المخزون أو حساب المورد.',
                  'Purchase return requests require management approval before updating stock or supplier balance.'
                )}
              </p>
            </div>
            {canCreatePurchase && (
              <button
                type="button"
                onClick={() => onTabChange('purchase-return')}
                className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer shrink-0"
              >
                {isRepRoleAccount ? t('+ طلب مرتجع شراء', '+ Purchase Return Request') : t('+ مرتجع شراء', '+ Purchase Return')}
              </button>
            )}
          </div>

          <UnifiedDataTable<PurchaseReturnRequest>
            compact
            title={t(`طلبات مرتجع المشتريات (${myPurchaseReturnRequests.length})`, `Purchase Return Requests (${myPurchaseReturnRequests.length})`)}
            data={myPurchaseReturnRequests}
            rowKey={(req) => req.id}
            emptyTitle={t('لا توجد طلبات مرتجع مشتريات مرسلة حالياً', 'No purchase return requests submitted yet')}
            columns={[
              {
                key: 'requestNumber',
                header: t('رقم الطلب', 'Request #'),
                render: (req) => (
                  <div>
                    <span className="font-mono font-black text-[#011E58] block">{req.requestNumber}</span>
                    {req.syncStatus === 'pending' && (
                      <span className="text-[10px] font-bold text-slate-600">{t('بانتظار المزامنة', 'Pending Sync')}</span>
                    )}
                  </div>
                ),
              },
              {
                key: 'supplierName',
                header: t('المورد / الفاتورة', 'Supplier / Invoice'),
                render: (req) => (
                  <div>
                    <span className="font-bold text-slate-900 block">{req.supplierName}</span>
                    <span className="text-[10px] text-slate-500">{t('فاتورة', 'Invoice')} {req.originalInvoiceNumber} · {req.date}</span>
                  </div>
                ),
              },
              {
                key: 'grandTotal',
                header: t('الإجمالي', 'Total'),
                align: 'center',
                render: (req) => (
                  <strong className="font-mono text-[#011E58]">
                    {formatLocaleNumber(Number(req.grandTotal || 0))} {t(data.settings.currency)}
                  </strong>
                ),
              },
              {
                key: 'status',
                header: t('الحالة', 'Status'),
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
                      {req.status === 'approved'
                        ? t('تم الاعتماد والتنفيذ', 'Approved & Executed')
                        : req.status === 'rejected'
                        ? t('مرفوض', 'Rejected')
                        : t('قيد مراجعة الإدارة', 'Pending Admin Review')}
                    </span>
                    {req.reason && <span className="block text-slate-500">{req.reason}</span>}
                    {req.status === 'approved' && req.approvedReturnNumber && (
                      <span className="block font-bold text-emerald-800">{t('مرتجع رقم:', 'Return #:')} {req.approvedReturnNumber}</span>
                    )}
                    {req.status === 'rejected' && req.rejectionReason && (
                      <span className="block font-bold text-rose-800">{t('الرفض:', 'Rejection:')} {req.rejectionReason}</span>
                    )}
                  </div>
                ),
              },
            ]}
          />

          <UnifiedDataTable<InvoiceReturn>
            compact
            title={t(`مرتجعات المشتريات المعتمدة (${myPurchaseReturns.length})`, `Approved Purchase Returns (${myPurchaseReturns.length})`)}
            data={myPurchaseReturns}
            rowKey={(r) => r.id}
            emptyTitle={t('لا توجد مرتجعات مشتريات معتمدة', 'No approved purchase returns')}
            columns={[
              { key: 'returnNumber', header: t('رقم المرتجع', 'Return #'), render: (r) => <span className="font-mono font-black text-[#011E58]">{r.returnNumber}</span> },
              {
                key: 'partyName',
                header: t('المورد', 'Supplier'),
                render: (r) => (
                  <span>
                    {r.partyName}
                    {r.originalInvoiceNumber ? ` · ${t('فاتورة', 'Invoice')} ${r.originalInvoiceNumber}` : ''}
                  </span>
                ),
              },
              { key: 'date', header: t('التاريخ', 'Date'), align: 'center', render: (r) => <span className="font-mono">{r.date}</span> },
              {
                key: 'grandTotal',
                header: t('الإجمالي', 'Total'),
                align: 'center',
                render: (r) => (
                  <strong className="font-mono text-[#011E58]">
                    {formatLocaleNumber(r.grandTotal)} {t(data.settings.currency)}
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
              { key: 'van' as const, label: t('السيارة', 'Van') },
              { key: 'items' as const, label: t(`تحويل (${myItemTransfers.length})`, `Transfer (${myItemTransfers.length})`) },
              { key: 'deliver' as const, label: t('تسليم', 'Deliver') },
              { key: 'return' as const, label: t('إرجاع مخزن', 'WH Return') },
              { key: 'cash' as const, label: t(`نقدي (${myCashTransfers.length})`, `Cash (${myCashTransfers.length})`) },
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
                <div className="bg-[#011E58] dark:bg-[#0E1C36] border border-transparent dark:border-[#21375C] text-white rounded-lg p-2.5 space-y-1.5 tabular-nums">
                  <div className="flex items-center justify-between">
                    <h4 className="font-black text-xs">{t('كشف عهدة السيارة التراكمي', 'Cumulative Van Custody Statement')}</h4>
                    <button
                      type="button"
                      onClick={loadCustodyStatement}
                      disabled={isLoadingCustodyStmt}
                      className="h-7 px-2 rounded-md bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingCustodyStmt ? 'animate-spin' : ''}`} />
                      <span>{t('تحديث', 'Refresh')}</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-[#002D73] dark:bg-[#21375C] border border-[#003589] dark:border-[#2A436E] rounded-md overflow-hidden text-center">
                    <div className="px-2 py-1.5 bg-[#002463] dark:bg-[#132544]">
                      <span className="text-[10px] text-blue-100 dark:text-[#97AECE] block">{t('إجمالي المستلم', 'Total Received')}</span>
                      <strong className="font-mono text-xs">{formatLocaleNumber(custodyStatement.totals.totalReceivedQty)}</strong>
                    </div>
                    <div className="px-2 py-1.5 bg-[#002463] dark:bg-[#132544]">
                      <span className="text-[10px] text-blue-100 dark:text-[#97AECE] block">{t('المسلم للعملاء', 'Delivered to Customers')}</span>
                      <strong className="font-mono text-xs text-blue-200">{formatLocaleNumber(custodyStatement.totals.totalDeliveredQty)}</strong>
                    </div>
                    <div className="px-2 py-1.5 bg-[#002463] dark:bg-[#132544]">
                      <span className="text-[10px] text-blue-100 dark:text-[#97AECE] block">{t('المرتجع للمخزن', 'Returned to WH')}</span>
                      <strong className="font-mono text-xs text-amber-300">{formatLocaleNumber(custodyStatement.totals.totalReturnedQty)}</strong>
                    </div>
                    <div className="px-2 py-1.5 bg-[#003589] dark:bg-[#1659C8]">
                      <span className="text-[10px] text-[#DCE6F5] block">{t('المتبقي الفعلي', 'Actual Remaining')}</span>
                      <strong className="font-mono text-xs">{formatLocaleNumber(custodyStatement.totals.totalRemainingCustodyQty)}</strong>
                    </div>
                    <div className="px-2 py-1.5 bg-[#002B73] dark:bg-[#172E56] col-span-2 sm:col-span-1">
                      <span className="text-[10px] text-blue-200 dark:text-[#A9BCD9] block">{t('القيمة بالتكلفة', 'Value at Cost')}</span>
                      <strong className="font-mono text-xs">
                        {formatLocaleNumber(custodyStatement.totals.totalCustodyCostValue)} {t(data.settings.currency)}
                      </strong>
                    </div>
                  </div>
                  {custodyStatement.itemsSummary.length > 0 && (
                    <UnifiedDataTable
                      compact
                      paginated={false}
                      searchable={false}
                      title={t('تفاصيل حركة العهدة لكل صنف', 'Custody Movement Per Item')}
                      data={custodyStatement.itemsSummary}
                      rowKey={(item) => item.productId}
                      columns={[
                        { key: 'productName', header: t('الصنف', 'Item'), render: (item) => <span className="font-bold">{item.productName}</span> },
                        { key: 'receivedQty', header: t('مستلم', 'Received'), align: 'center', render: (item) => <span className="font-mono">{formatLocaleNumber(item.receivedQty)}</span> },
                        { key: 'deliveredToCustomersQty', header: t('مباع', 'Sold'), align: 'center', render: (item) => <span className="font-mono text-[#003589]">{formatLocaleNumber(item.deliveredToCustomersQty)}</span> },
                        { key: 'returnedToWarehouseQty', header: t('مرتجع', 'Returned'), align: 'center', render: (item) => <span className="font-mono text-amber-700">{formatLocaleNumber(item.returnedToWarehouseQty)}</span> },
                        { key: 'remainingCustodyQty', header: t('متبقي', 'Remaining'), align: 'center', render: (item) => <strong className="font-mono text-emerald-700">{formatLocaleNumber(item.remainingCustodyQty)}</strong> },
                      ]}
                    />
                  )}
                </div>
              )}

              <UnifiedDataTable
                compact
                title={`${t('أرصدة البضاعة الحالية في:', 'Current Stock Balances in:')} ${vanWarehouse?.name || t('سيارة المندوب', 'Rep Van')}`}
                headerActions={
                  !custodyStatement ? (
                    <button
                      type="button"
                      onClick={loadCustodyStatement}
                      disabled={isLoadingCustodyStmt}
                      className="h-7 px-2.5 rounded-md bg-blue-50 text-blue-900 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCustodyStmt ? 'animate-spin' : ''}`} />
                      <span>{t('كشف العهدة', 'Custody Statement')}</span>
                    </button>
                  ) : undefined
                }
                data={activeProducts.filter((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) > 0)}
                rowKey={(p) => p.id}
                emptyTitle={t('لا توجد بضاعة متوفرة حالياً داخل مستودع السيارة', 'No stock currently available in van warehouse')}
                columns={[
                  { key: 'name', header: t('الصنف', 'Item'), render: (p) => <span className="font-bold text-slate-900">{p.name}</span> },
                  { key: 'category', header: t('التصنيف', 'Category'), render: (p) => <span className="text-slate-500">{t(p.category)}</span> },
                  {
                    key: 'stock',
                    header: t('الكمية المتاحة', 'Available Qty'),
                    align: 'center',
                    sortValue: (p) => Number(p.stockPerWarehouse?.[effectiveVanId] || 0),
                    render: (p) => (
                      <strong className="font-mono text-blue-950 tabular-nums">
                        {formatLocaleNumber(p.stockPerWarehouse?.[effectiveVanId] || 0)} {t(p.baseUnit)}
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
              <h4 className="text-xs sm:text-sm font-black text-slate-900">{t('تسليم جزئي من عهدة السيارة إلى عميل', 'Partial Delivery from Van Custody to Customer')}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <select
                  value={delivCustomerId}
                  onChange={(e) => setDelivCustomerId(e.target.value)}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
                >
                  <option value="">{t('-- اختر العميل المستلم (اختياري) --', '-- Select Receiving Customer (Optional) --')}</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.shopName || c.name}</option>
                  ))}
                </select>
                <select
                  value={delivProdId}
                  onChange={(e) => setDelivProdId(e.target.value)}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
                >
                  <option value="">{t('-- اختر الصنف من العهدة --', '-- Select Item from Custody --')}</option>
                  {activeProducts.filter((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) > 0).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({t('متاح:', 'Avail:')} {formatLocaleNumber(p.stockPerWarehouse?.[effectiveVanId] || 0)} {t(p.baseUnit)})
                    </option>
                  ))}
                </select>
                <QuantityInput
                  allowDecimals
                  min={0.001}
                  value={delivQty}
                  onChange={setDelivQty}
                  ariaLabel={t('الكمية المسلمة', 'Delivered Quantity')}
                  inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                />
                <input
                  type="text"
                  value={delivNotes}
                  onChange={(e) => setDelivNotes(e.target.value)}
                  placeholder={t('ملاحظات التسليم...', 'Delivery notes...')}
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />
              </div>
              <button
                type="submit"
                disabled={isSendingTransfer}
                className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSendingTransfer ? t('جاري التسجيل...', 'Recording...') : t('تأكيد تسليم العهدة', 'Confirm Custody Delivery')}
              </button>
            </form>
          )}

          {custodySubTab === 'return' && (
            <form
              onSubmit={handleRecordCustodyReturn}
              className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5 text-xs"
            >
              <h4 className="text-xs sm:text-sm font-black text-slate-900">{t('إرجاع بضاعة من عهدة السيارة إلى المخزن', 'Return Stock from Van Custody to Warehouse')}</h4>
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
                <option value="">{t('-- اختر الصنف المرتجع من السيارة --', '-- Select Item to Return from Van --')}</option>
                {activeProducts
                  .filter((p) => (p.stockPerWarehouse?.[effectiveVanId] || 0) > 0)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({t('متاح بالسيارة:', 'In Van:')} {formatLocaleNumber(p.stockPerWarehouse?.[effectiveVanId] || 0)} {t(p.baseUnit)})
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
                          <option value={retProd.baseUnit}>{t(retProd.baseUnit)}</option>
                          {retProd.units.map((u) => (
                            <option key={u.id} value={u.name}>
                              {t(u.name)} ({u.conversionFactor})
                            </option>
                          ))}
                        </>
                      ) : (
                        <option value="">{t('الوحدة', 'Unit')}</option>
                      )}
                    </select>
                    <QuantityInput
                      allowDecimals
                      min={0.001}
                      value={retCustodyQty}
                      onChange={setRetCustodyQty}
                      ariaLabel={t('الكمية المرتجعة للمخزن', 'Quantity Returned to Warehouse')}
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
                        {t('إرجاع إلى:', 'Return to:')} {w.name}
                      </option>
                    ))}
                </select>

                <input
                  type="text"
                  value={retCustodyNotes}
                  onChange={(e) => setRetCustodyNotes(e.target.value)}
                  placeholder={t('سبب الإرجاع أو ملاحظات...', 'Return reason or notes...')}
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />
              </div>

              <button
                type="submit"
                disabled={isSendingTransfer || !retCustodyProdId}
                className="w-full h-9 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSendingTransfer ? t('جاري تسجيل الإرجاع...', 'Recording Return...') : t('تأكيد إرجاع البضاعة للمخزن', 'Confirm Return to Warehouse')}
              </button>
            </form>
          )}

          {custodySubTab === 'items' && (
            <div className="space-y-2 text-xs">
              <form
                onSubmit={handleSendDirectItemTransfer}
                className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5"
              >
                <h4 className="text-xs sm:text-sm font-black text-slate-900">{t('طلب تحويل أصناف من المخزن الرئيسي إلى السيارة', 'Request Stock Transfer from Main Warehouse to Van')}</h4>
                <div className="flex gap-1.5">
                  <select
                    value={reqProdId}
                    onChange={(e) => setReqProdId(e.target.value)}
                    className="flex-1 h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
                  >
                    <option value="">{t('-- اختر الصنف --', '-- Select Item --')}</option>
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({t('الرئيسي:', 'Main:')} {formatLocaleNumber(mainWarehouse ? p.stockPerWarehouse?.[mainWarehouse.id] || 0 : 0)})
                      </option>
                    ))}
                  </select>
                  <QuantityInput
                    allowDecimals
                    min={0.001}
                    value={reqQty}
                    onChange={setReqQty}
                    ariaLabel={t('كمية التحويل المطلوبة', 'Requested Transfer Quantity')}
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
                    {t('إضافة', 'Add')}
                  </button>
                </div>

                {reqItems.length > 0 && (
                  <UnifiedDataTable
                    compact
                    paginated={false}
                    searchable={false}
                    title={t(`الأصناف المطلوبة للتحويل (${reqItems.length})`, `Requested Transfer Items (${reqItems.length})`)}
                    data={reqItems}
                    rowKey={(it, idx) => `${it.productId}-${idx}`}
                    columns={[
                      { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold">{it.productName}</span> },
                      {
                        key: 'requestedQty',
                        header: t('الكمية', 'Qty'),
                        align: 'center',
                        render: (it) => <span className="font-mono">{formatLocaleNumber(it.requestedQty)} {t(it.unit)}</span>,
                      },
                      {
                        key: 'actions',
                        header: t('حذف', 'Delete'),
                        align: 'center',
                        sortable: false,
                        render: (_it, idx) => (
                          <button
                            type="button"
                            onClick={() => setReqItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-red-600 font-bold px-2 cursor-pointer"
                          >
                            {t('حذف', 'Delete')}
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
                  {isSendingTransfer ? t('جاري الإرسال...', 'Sending...') : t('إرسال طلب التحويل للإدارة', 'Send Transfer Request to Admin')}
                </button>
              </form>

              <UnifiedDataTable
                compact
                title={t(`طلبات تحويل البضاعة (${myItemTransfers.length})`, `Stock Transfer Requests (${myItemTransfers.length})`)}
                data={myItemTransfers}
                rowKey={(tr) => tr.id}
                emptyTitle={t('لا توجد طلبات تحويل بضاعة مسجلة', 'No stock transfer requests recorded')}
                columns={[
                  { key: 'requestNumber', header: t('رقم الطلب', 'Request #'), render: (tr) => <span className="font-mono font-black text-blue-950">{tr.requestNumber}</span> },
                  {
                    key: 'items',
                    header: t('الأصناف', 'Items'),
                    render: (tr) => (
                      <div className="space-y-0.5 text-[11px] text-slate-700">
                        {tr.items.map((it, i) => (
                          <div key={i}>
                            {it.productName}: <span className="font-mono font-bold">{formatLocaleNumber(it.approvedQty ?? it.requestedQty)} {t(it.unit)}</span>
                          </div>
                        ))}
                      </div>
                    ),
                  },
                  {
                    key: 'status',
                    header: t('الحالة', 'Status'),
                    align: 'center',
                    render: (tr) => (
                      <span className="font-bold text-slate-700">
                        {tr.status === 'pending'
                          ? t('قيد مراجعة الإدارة', 'Pending Admin Review')
                          : tr.status === 'approved'
                          ? t('معتمد — بانتظار الصرف', 'Approved — Awaiting Dispatch')
                          : tr.status === 'executed'
                          ? t('تم الصرف — بانتظار تأكيد استلامك', 'Dispatched — Confirm Receipt')
                          : tr.status === 'received'
                          ? t('تم الاستلام الفعلي', 'Physically Received')
                          : t('مرفوض', 'Rejected')}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: t('الإجراءات', 'Actions'),
                    align: 'center',
                    sortable: false,
                    render: (tr) =>
                      tr.status === 'executed' ? (
                        <button
                          type="button"
                          onClick={() => handleConfirmItemReceived(tr.id, tr.requestNumber)}
                          className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black cursor-pointer whitespace-nowrap"
                        >
                          {t('تأكيد استلام الأصناف فعلياً', 'Confirm Physical Receipt')}
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
                <h4 className="text-xs sm:text-sm font-black text-slate-900">{t('توريد نقدية من المندوب إلى خزينة الفرع', 'Cash Remittance from Rep to Branch Cashbox')}</h4>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={cashAmount || ''}
                    onChange={(e) => setCashAmount(Number(e.target.value))}
                    placeholder={`${t('المبلغ', 'Amount')} (${t(data.settings.currency)})`}
                    className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-mono font-bold"
                  />
                  <button
                    type="submit"
                    disabled={isSendingTransfer || cashAmount <= 0}
                    className="h-8 px-2.5 rounded-md bg-blue-900 text-white font-black disabled:opacity-50 cursor-pointer"
                  >
                    {t('إرسال التوريد', 'Send Remittance')}
                  </button>
                </div>
                <input
                  type="text"
                  value={cashNotes}
                  onChange={(e) => setCashNotes(e.target.value)}
                  placeholder={t('ملاحظات التوريد (اختياري)...', 'Remittance notes (optional)...')}
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />
              </form>

              <UnifiedDataTable
                compact
                title={t(`التحويلات النقدية (${myCashTransfers.length})`, `Cash Transfers (${myCashTransfers.length})`)}
                data={myCashTransfers}
                rowKey={(tr) => tr.id}
                emptyTitle={t('لا توجد تحويلات نقدية مسجلة', 'No cash transfers recorded')}
                columns={[
                  { key: 'transferNumber', header: t('رقم التحويل', 'Transfer #'), render: (tr) => <span className="font-mono font-black text-blue-950">{tr.transferNumber}</span> },
                  {
                    key: 'direction',
                    header: t('النوع', 'Type'),
                    render: (tr) => (tr.direction === 'rep_to_owner' ? t('توريد إلى الفرع', 'Remittance to Branch') : t('عهدة واردة لك من الإدارة', 'Cash Custody from Admin')),
                  },
                  {
                    key: 'amount',
                    header: t('المبلغ', 'Amount'),
                    align: 'center',
                    render: (tr) => (
                      <strong className="font-mono text-slate-900">
                        {formatLocaleNumber(tr.amount)} {t(data.settings.currency)}
                      </strong>
                    ),
                  },
                  {
                    key: 'status',
                    header: t('الحالة', 'Status'),
                    align: 'center',
                    render: (tr) => (
                      <span className="font-bold text-slate-700">
                        {tr.status === 'received'
                          ? t('تم الاستلام والتسوية', 'Received & Settled')
                          : tr.status === 'awaiting_receipt'
                          ? t('بانتظار تأكيد الاستلام', 'Awaiting Receipt Confirmation')
                          : t('مرفوض', 'Rejected')}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: t('الإجراءات', 'Actions'),
                    align: 'center',
                    sortable: false,
                    render: (tr) =>
                      tr.status === 'awaiting_receipt' && tr.direction === 'owner_to_rep' ? (
                        <button
                          type="button"
                          onClick={() => handleConfirmOwnerCash(tr.id)}
                          className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black cursor-pointer whitespace-nowrap"
                        >
                          {t('تأكيد استلام العهدة النقدية', 'Confirm Cash Custody Receipt')}
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
                <span>{t(`طلبات التسليم المعينة لك (${assignedDeliveryOrders.length})`, `Assigned Delivery Orders (${assignedDeliveryOrders.length})`)}</span>
              </h3>
            </div>

            <UnifiedDataTable
              compact
              data={assignedDeliveryOrders}
              rowKey={(ord) => ord.id}
              emptyTitle={t('لا توجد طلبات توصيل معينة لك حالياً', 'No delivery orders currently assigned to you')}
              columns={[
                {
                  key: 'requestNumber',
                  header: t('رقم الطلب', 'Order #'),
                  render: (ord) => <span className="font-mono font-black text-blue-950">{ord.requestNumber}</span>,
                },
                {
                  key: 'customerName',
                  header: t('العميل والعنوان', 'Customer & Address'),
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
                  header: t('المبالغ', 'Amounts'),
                  render: (ord) => {
                    const total = Number(ord.invoiceTotal ?? ord.totalAmount ?? 0);
                    const adv = Number(ord.invoicePaidAmount ?? ord.advancePaidAmount ?? 0);
                    const remainingDue = Math.max(0, Number(ord.invoiceRemainingAmount ?? (total - adv)));
                    return (
                      <div className="font-mono text-[11px] whitespace-nowrap">
                        <div>{t('الإجمالي:', 'Total:')} <strong>{formatLocaleNumber(total)} {t(data.settings.currency)}</strong></div>
                        <div className="text-emerald-700">{t('مدفوع:', 'Paid:')} {formatLocaleNumber(adv)} · <span className="text-blue-950 font-black">{t('متبقي:', 'Rem:')} {formatLocaleNumber(remainingDue)}</span></div>
                      </div>
                    );
                  },
                },
                {
                  key: 'status',
                  header: t('الحالة', 'Status'),
                  align: 'center',
                  render: (ord) => (
                    <span className="font-black text-[#011E58]">{t(REP_ORDER_STATUS_LABELS[ord.status] || ord.status)}</span>
                  ),
                },
                {
                  key: 'actions',
                  header: t('الإجراءات', 'Actions'),
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
                          <span>{t('اتصال', 'Call')}</span>
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
                          <span>{t('الموقع', 'Location')}</span>
                        </button>
                      )}
                      {(ord.status === 'rep_assigned' || ord.status === 'preparing' || ord.status === 'invoiced') && (
                        <button
                          type="button"
                          disabled={isUpdatingDelivery}
                          onClick={() => handleStartDelivery(ord)}
                          className="px-2 py-0.5 rounded-md bg-[#011E58] hover:bg-[#003589] text-white text-[11px] font-black cursor-pointer disabled:opacity-50"
                        >
                          {t('بدء التوصيل', 'Start Delivery')}
                        </button>
                      )}
                      {(ord.status === 'rep_assigned' || ord.status === 'out_for_delivery' || ord.status === 'preparing') && (
                        <button
                          type="button"
                          disabled={isUpdatingDelivery}
                          onClick={() => handleOpenDeliverModal(ord)}
                          className="px-2 py-0.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-black cursor-pointer disabled:opacity-50"
                        >
                          {t('تم التسليم', 'Delivered')}
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
            <h3 className="text-xs sm:text-sm font-black text-slate-900">{t('إرسال طلب شراء للإدارة', 'Submit Purchase Order to Management')}</h3>
            <select
              value={ordCustomerId}
              onChange={(e) => setOrdCustomerId(e.target.value)}
              className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold bg-white"
            >
              <option value="">{t('-- اختر العميل --', '-- Select Customer --')}</option>
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
                <option value="">{t('-- اختر الصنف للطلب --', '-- Select Item for Order --')}</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({t(p.baseUnit)})</option>
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
                      <option key={u.id} value={u.name}>{t(u.name)}</option>
                    ))}
                    <option value={selectedOrderProduct.baseUnit}>{t(selectedOrderProduct.baseUnit)}</option>
                  </select>
                  <QuantityInput
                    allowDecimals
                    min={0.001}
                    value={ordQty}
                    onChange={setOrdQty}
                    ariaLabel={t('كمية الصنف في الطلب', 'Item Quantity in Order')}
                    inputClassName="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    value={ordPrice || ''}
                    onChange={(e) => setOrdPrice(Math.max(0, Number(e.target.value)))}
                    placeholder={t('السعر', 'Price')}
                    className="w-full h-8 rounded-md border border-slate-300 text-center font-mono font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddOrderItem}
                    className="h-8 rounded-md bg-blue-900 text-white font-black flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('إضافة', 'Add')}</span>
                  </button>
                </div>
              )}
            </div>

            {ordItems.length > 0 && (
              <UnifiedDataTable
                compact
                paginated={false}
                searchable={false}
                title={t(`أصناف الطلب (${ordItems.length})`, `Order Items (${ordItems.length})`)}
                data={ordItems}
                rowKey={(it, idx) => `${it.productId}-${it.unit}-${idx}`}
                columns={[
                  { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold text-slate-900">{it.productName}</span> },
                  { key: 'quantity', header: t('الكمية', 'Qty'), align: 'center', render: (it) => <span className="font-mono">{formatLocaleNumber(it.quantity)} {t(it.unit)}</span> },
                  {
                    key: 'actions',
                    header: t('حذف', 'Delete'),
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
              placeholder={t('ملاحظات الطلب...', 'Order notes...')}
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />

            <button
              type="submit"
              disabled={isSubmittingOrder || !ordItems.length}
              className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black disabled:opacity-50 cursor-pointer"
            >
              {isSubmittingOrder ? t('جاري الإرسال...', 'Submitting...') : t('إرسال الطلب للإدارة', 'Submit Order to Admin')}
            </button>
          </form>

          {mySubmittedOrders.length > 0 && (
            <UnifiedDataTable
              compact
              title={t(`طلباتي المرسلة (${mySubmittedOrders.length})`, `My Submitted Orders (${mySubmittedOrders.length})`)}
              data={mySubmittedOrders}
              rowKey={(ord) => ord.id}
              columns={[
                { key: 'requestNumber', header: t('رقم الطلب', 'Order #'), render: (ord) => <span className="font-mono font-black text-blue-950">{ord.requestNumber}</span> },
                { key: 'customerName', header: t('العميل', 'Customer'), render: (ord) => ord.customerName },
                { key: 'itemsCount', header: t('الأصناف', 'Items'), align: 'center', render: (ord) => <span className="font-mono">{ord.items?.length || 0} {t('أصناف', 'items')}</span> },
                {
                  key: 'status',
                  header: t('الحالة', 'Status'),
                  align: 'center',
                  render: (ord) => <span className="font-bold text-[#003589]">{t(REP_ORDER_STATUS_LABELS[ord.status] || ord.status)}</span>,
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
            <p className="font-black text-red-800">{t('صلاحيات حسابك لا تسمح بعرض الموردين أو كشوف حساباتهم.', 'Your account permissions do not allow viewing suppliers or their statements.')}</p>
            <button
              type="button"
              onClick={() => onTabChange('home')}
              className="h-8 px-3 rounded-md bg-slate-100 font-bold text-slate-800 cursor-pointer"
            >
              {t('العودة للرئيسية', 'Back to Home')}
            </button>
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-5 h-5 text-[#003589] shrink-0" />
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-black text-slate-900">
                      {t(`الموردون وكشوف الحسابات (${data.suppliers.length})`, `Suppliers & Statements (${data.suppliers.length})`)}
                    </h3>
                    <p className="text-[10px] text-slate-500 truncate">
                      {t('الرصيد المالي عام للشركة، وكشف الحساب يعرض فواتيرك ومرتجعاتك فقط.', 'Financial balance is company-wide; statements show your invoices and returns only.')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onTabChange('new-supplier')}
                  className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
                >
                  {t('+ مورد جديد', '+ New Supplier')}
                </button>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2 top-2" />
                <input
                  type="text"
                  value={supSearch}
                  onChange={(e) => setSupSearch(e.target.value)}
                  placeholder={t('ابحث باسم المورد أو الشركة أو الكود أو التليفون...', 'Search by supplier name, company, code, or phone...')}
                  className="w-full h-8 rounded-md border border-slate-300 ps-7 pe-2 font-semibold"
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
                  title={t(`جدول الموردين (${filteredSuppliers.length})`, `Suppliers Table (${filteredSuppliers.length})`)}
                  data={filteredSuppliers}
                  rowKey={(sup) => sup.id}
                  emptyTitle={t('لا توجد بيانات موردين مطابقة للبحث', 'No suppliers match your search')}
                  columns={[
                    {
                      key: 'name',
                      header: t('المورد / الشركة', 'Supplier / Company'),
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
                      header: t('الرصيد العام', 'Overall Balance'),
                      align: 'center',
                      sortValue: (sup) => Number(sup.currentBalance || 0),
                      render: (sup) => {
                        const bal = Number(sup.currentBalance || 0);
                        return (
                          <div className="whitespace-nowrap">
                            <strong className={`font-mono tabular-nums block ${bal > 0.009 ? 'text-rose-800' : bal < -0.009 ? 'text-emerald-800' : 'text-slate-700'}`}>
                              {formatLocaleNumber(Math.abs(bal))} {t(data.settings.currency)}
                            </strong>
                            <span className="text-[10px] text-slate-500">
                              {bal > 0.009 ? t('علينا', 'Payable') : bal < -0.009 ? t('لنا', 'Receivable') : t('متوازن', 'Balanced')}
                            </span>
                          </div>
                        );
                      },
                    },
                    {
                      key: 'actions',
                      header: t('الإجراءات', 'Actions'),
                      align: 'center',
                      sortable: false,
                      render: (sup) => (
                        <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedSupplierDetail(sup)}
                            className="px-2 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[11px] font-black cursor-pointer"
                          >
                            {t('كشف حساب', 'Statement')}
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
                            {t('+ فاتورة شراء', '+ Purchase Invoice')}
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
                  <h3 className="text-xs sm:text-sm font-black text-slate-900">{t('تقارير المندوب التفصيلية', 'Detailed Representative Reports')}</h3>
                  <p className="text-[10px] text-slate-500 truncate">
                    {repReportData?.scope?.accountBalanceNote
                      ? t(repReportData.scope.accountBalanceNote)
                      : t('الأرصدة عامة للشركة، وإحصائيات الفواتير والتحصيلات تخص هذا المندوب فقط.', 'Balances are company-wide; invoice and collection metrics belong to this representative only.')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isLoadingRepReport}
                  onClick={loadRepSummaryReport}
                  className="h-8 px-2.5 rounded-md bg-blue-900 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRepReport ? 'animate-spin' : ''}`} />
                  <span>{t('تحديث', 'Refresh')}</span>
                </button>
              </div>
            </div>

            {repReportIsOfflineFallback && (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
                {t('يتم العرض حالياً من البيانات المحفوظة محلياً (وضع عدم الاتصال أو تعذر الوصول للخادم).', 'Currently displaying locally cached data (offline mode or server unreachable).')}
              </div>
            )}
            {repReportError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-700 font-bold text-[11px]">
                {t(repReportError)}
              </div>
            )}

            {/* Single-Row Unified Compact Filters */}
            <div className="pt-1.5 border-t border-slate-200">
              <div className="awlad-filter-row" data-testid="rep-reports-filter-row">
                <label className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-slate-300 bg-white shrink-0">
                  <span className="text-[10.5px] font-bold text-slate-500">{t('من:', 'From:')}</span>
                  <input
                    type="date"
                    dir="ltr"
                    aria-label={t('من تاريخ', 'From Date')}
                    value={rptDateFrom}
                    onChange={(e) => {
                      setRptDateFrom(e.target.value);
                      setRptPage(1);
                    }}
                    className="bg-transparent font-mono text-xs outline-hidden"
                  />
                </label>
                <label className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-slate-300 bg-white shrink-0">
                  <span className="text-[10.5px] font-bold text-slate-500">{t('إلى:', 'To:')}</span>
                  <input
                    type="date"
                    dir="ltr"
                    aria-label={t('إلى تاريخ', 'To Date')}
                    value={rptDateTo}
                    onChange={(e) => {
                      setRptDateTo(e.target.value);
                      setRptPage(1);
                    }}
                    className="bg-transparent font-mono text-xs outline-hidden"
                  />
                </label>
                <input
                  type="text"
                  dir="ltr"
                  aria-label={t('رقم المستند', 'Document Number')}
                  value={rptInvoiceNumber}
                  onChange={(e) => {
                    setRptInvoiceNumber(e.target.value);
                    setRptPage(1);
                  }}
                  placeholder={t('رقم الفاتورة...', 'Invoice #...')}
                  className="w-[125px] shrink-0 h-8 rounded-md border border-slate-300 px-2 font-mono text-xs bg-white outline-hidden focus:border-blue-600 text-start"
                />
                <div className="w-[140px] shrink-0">
                  <SearchableFilterSelect
                    id="rep-rpt-optype"
                    inlinePrefix={t('العملية', 'Operation')}
                    value={rptOpType}
                    onChange={(val) => {
                      setRptOpType((val as any) || 'all');
                      setRptPage(1);
                    }}
                    options={[
                      { value: 'sales', label: t('فواتير البيع', 'Sales Invoices') },
                      ...(canCreatePurchase ? [{ value: 'purchase', label: t('فواتير الشراء', 'Purchase Invoices') }] : []),
                      { value: 'sales_return', label: t('مرتجعات البيع', 'Sales Returns') },
                      ...(canCreatePurchase
                        ? [
                            { value: 'purchase_return', label: t('مرتجعات الشراء', 'Purchase Returns') },
                            { value: 'purchase_return_request', label: t('طلبات مرتجع الشراء', 'Purchase Return Requests') },
                          ]
                        : []),
                    ]}
                    allOptionLabel={t('الكل', 'All')}
                    allOptionValue="all"
                    buttonClassName="h-8 min-h-[32px] rounded-md"
                  />
                </div>
                <div className="w-[165px] shrink-0">
                  <SearchableFilterSelect
                    id="rep-rpt-party"
                    inlinePrefix={canCreatePurchase ? t('العميل/المورد', 'Customer/Supplier') : t('العميل', 'Customer')}
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
                        badge: t('عميل', 'Customer'),
                        groupLabel: t('العملاء', 'Customers'),
                        searchText: `${c.name} ${c.shopName || ''} ${c.phone || ''}`,
                      })),
                      ...(canCreatePurchase
                        ? data.suppliers.map<SearchableFilterOption>((s) => ({
                            value: `supplier:${s.id}`,
                            label: s.name,
                            subtitle: s.phone || s.companyName,
                            badge: t('مورد', 'Supplier'),
                            groupLabel: t('الموردون', 'Suppliers'),
                            searchText: `${s.name} ${s.companyName || ''} ${s.phone || ''}`,
                          }))
                        : []),
                    ]}
                    allOptionLabel={t('الكل', 'All')}
                    allOptionValue="all"
                    searchPlaceholder={t('ابحث باسم العميل أو المحل أو المورد...', 'Search customer, shop, or supplier...')}
                    allowClear
                    buttonClassName="h-8 min-h-[32px] rounded-md"
                  />
                </div>
                <div className="w-[155px] shrink-0">
                  <SearchableFilterSelect
                    id="rep-rpt-product"
                    inlinePrefix={t('الصنف', 'Item')}
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
                    allOptionLabel={t('الكل', 'All')}
                    allOptionValue="all"
                    searchPlaceholder={t('ابحث باسم الصنف أو الكود أو الباركود...', 'Search item name, code, or barcode...')}
                    allowClear
                    buttonClassName="h-8 min-h-[32px] rounded-md"
                  />
                </div>
                <div className="w-[130px] shrink-0">
                  <SearchableFilterSelect
                    id="rep-rpt-payment-status"
                    inlinePrefix={t('السداد', 'Payment')}
                    value={rptPaymentStatus}
                    onChange={(val) => {
                      setRptPaymentStatus((val as any) || 'all');
                      setRptPage(1);
                    }}
                    options={[
                      { value: 'paid', label: t('مسددة بالكامل', 'Fully Paid') },
                      { value: 'partial', label: t('مسددة جزئياً', 'Partially Paid') },
                      { value: 'credit', label: t('آجل بالكامل', 'Full Credit') },
                    ]}
                    allOptionLabel={t('الكل', 'All')}
                    allOptionValue="all"
                    buttonClassName="h-8 min-h-[32px] rounded-md"
                  />
                </div>
                <div className="w-[135px] shrink-0">
                  <SearchableFilterSelect
                    id="rep-rpt-invoice-status"
                    inlinePrefix={t('الحالة', 'Status')}
                    value={rptInvoiceStatus}
                    onChange={(val) => {
                      setRptInvoiceStatus((val as any) || 'all');
                      setRptPage(1);
                    }}
                    options={[
                      { value: 'confirmed', label: t('معتمدة', 'Confirmed') },
                      { value: 'draft', label: t('مسودة / بانتظار المراجعة', 'Draft / Pending Review') },
                      { value: 'cancelled', label: t('ملغاة', 'Cancelled') },
                    ]}
                    allOptionLabel={t('الكل', 'All')}
                    allOptionValue="all"
                    buttonClassName="h-8 min-h-[32px] rounded-md"
                  />
                </div>
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
                  className="h-8 px-2.5 rounded-md border border-slate-300 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 text-slate-700 font-bold text-xs inline-flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t('إعادة ضبط', 'Reset')}</span>
                </button>
              </div>
            </div>
          </div>

          {repReportData && (
            <>
              {/* Hairline-Divided KPI Ledger Strip (Zero Profit / Zero Cost / Zero Cashbox Balances) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden tabular-nums">
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">{t('مبيعات المندوب', 'Rep Sales')} ({repReportData.summary.salesCount})</span>
                  <strong className="font-mono text-xs text-blue-950">
                    {formatLocaleNumber(repReportData.summary.salesTotal)} {t(data.settings.currency)}
                  </strong>
                </div>
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">{t('مرتجعات البيع', 'Sales Returns')} ({repReportData.summary.salesReturnsCount})</span>
                  <strong className="font-mono text-xs text-rose-800">
                    {formatLocaleNumber(repReportData.summary.salesReturnsTotal)} {t(data.settings.currency)}
                  </strong>
                </div>
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">{t('صافي البيع', 'Net Sales')}</span>
                  <strong className="font-mono text-xs text-emerald-800">
                    {formatLocaleNumber(repReportData.summary.netSalesTotal)} {t(data.settings.currency)}
                  </strong>
                </div>
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">{t('المحصل', 'Collected')} ({repReportData.summary.collectionsCount})</span>
                  <strong className="font-mono text-xs text-emerald-900">
                    {formatLocaleNumber(repReportData.summary.collectionsTotal)} {t(data.settings.currency)}
                  </strong>
                </div>
                <div className="bg-white px-2 py-1.5">
                  <span className="text-[10px] text-slate-500 block">{t('الآجل المتبقي', 'Remaining Credit')}</span>
                  <strong className="font-mono text-xs text-amber-800">
                    {formatLocaleNumber(repReportData.summary.salesRemaining)} {t(data.settings.currency)}
                  </strong>
                </div>
                {!isRepRoleAccount && typeof repReportData.summary.totalCustomerReceivables === 'number' && (
                  <div className="bg-white px-2 py-1.5">
                    <span className="text-[10px] text-slate-500 block">{t('أرصدة العملاء (عام)', 'Customer Balances (All)')}</span>
                    <strong className="font-mono text-xs text-slate-900">
                      {formatLocaleNumber(repReportData.summary.totalCustomerReceivables)} {t(data.settings.currency)}
                    </strong>
                  </div>
                )}
                {canCreatePurchase && (
                  <>
                    <div className="bg-white px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">{t('مشتريات المندوب', 'Rep Purchases')} ({repReportData.summary.purchasesCount})</span>
                      <strong className="font-mono text-xs text-[#011E58]">
                        {formatLocaleNumber(repReportData.summary.purchasesTotal)} {t(data.settings.currency)}
                      </strong>
                    </div>
                    <div className="bg-white px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">{t('المدفوع للمشتريات', 'Paid for Purchases')}</span>
                      <strong className="font-mono text-xs text-emerald-800">
                        {formatLocaleNumber(repReportData.summary.purchasesPaid)} {t(data.settings.currency)}
                      </strong>
                    </div>
                    <div className="bg-white px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">{t('متبقي المشتريات', 'Purchases Remaining')}</span>
                      <strong className="font-mono text-xs text-amber-800">
                        {formatLocaleNumber(repReportData.summary.purchasesRemaining)} {t(data.settings.currency)}
                      </strong>
                    </div>
                    <div className="bg-white px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">{t('طلبات مرتجع شراء', 'Purchase Return Req.')}</span>
                      <strong className="font-mono text-xs text-amber-900">
                        {repReportData.summary.purchaseReturnRequestsCount ?? 0} ({repReportData.summary.pendingPurchaseReturnRequestsCount ?? 0} {t('قيد المراجعة', 'pending')})
                      </strong>
                    </div>
                  </>
                )}
              </div>

              {/* Sub-view Switcher */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-white p-1 rounded-lg border border-slate-200">
                {[
                  { id: 'summary' as const, label: t('أرصدة العملاء والموردين', 'Customer & Supplier Balances') },
                  { id: 'invoices' as const, label: t(`الفواتير (${repReportData.invoices.length})`, `Invoices (${repReportData.invoices.length})`) },
                  { id: 'items' as const, label: t(`الأصناف (${repReportData.itemRows.length})`, `Items (${repReportData.itemRows.length})`) },
                  { id: 'collections' as const, label: t(`التحصيلات (${repReportData.collections.length})`, `Collections (${repReportData.collections.length})`) },
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
                    title={t(`ملخص العملاء (${repReportData.customersSummary.length})`, `Customers Summary (${repReportData.customersSummary.length})`)}
                    data={repReportData.customersSummary}
                    rowKey={(cs) => cs.id}
                    emptyTitle={t('لا توجد بيانات عملاء مطابقة', 'No matching customer data')}
                    columns={[
                      {
                        key: 'name',
                        header: t('العميل / المحل', 'Customer / Shop'),
                        render: (cs) => <span className="font-black text-slate-900">{cs.shopName || cs.name}</span>,
                      },
                      {
                        key: 'repSalesTotal',
                        header: t('مبيعاتك', 'Your Sales'),
                        align: 'center',
                        render: (cs) => (
                          <span className="font-mono">
                            {formatLocaleNumber(cs.repSalesTotal)} ({cs.repSalesCount})
                          </span>
                        ),
                      },
                      {
                        key: 'repCollectionsTotal',
                        header: t('تحصيلاتك', 'Your Collections'),
                        align: 'center',
                        render: (cs) => <span className="font-mono text-emerald-700">{formatLocaleNumber(cs.repCollectionsTotal)}</span>,
                      },
                      {
                        key: 'companyBalance',
                        header: t('الرصيد العام', 'General Balance'),
                        align: 'center',
                        render: (cs) => (
                          <span className={`font-mono font-black ${cs.companyBalance > 0.009 ? 'text-red-700' : cs.companyBalance < -0.009 ? 'text-emerald-700' : 'text-slate-600'}`}>
                            {formatLocaleNumber(Math.abs(cs.companyBalance))} ({cs.companyBalance > 0.009 ? t('لنا', 'Receivable') : cs.companyBalance < -0.009 ? t('علينا', 'Payable') : t('متوازن', 'Balanced')})
                          </span>
                        ),
                      },
                      {
                        key: 'actions',
                        header: t('كشف الحساب', 'Statement'),
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
                            {t('كشف الحساب', 'Statement')}
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
                      title={t(`ملخص الموردين (${repReportData.suppliersSummary.length})`, `Suppliers Summary (${repReportData.suppliersSummary.length})`)}
                      data={repReportData.suppliersSummary}
                      rowKey={(ss) => ss.id}
                      emptyTitle={t('لا توجد بيانات موردين مطابقة', 'No matching supplier data')}
                      columns={[
                        { key: 'name', header: t('المورد', 'Supplier'), render: (ss) => <span className="font-black text-slate-900">{ss.name}</span> },
                        {
                          key: 'repPurchasesTotal',
                          header: t('مشترياتك', 'Your Purchases'),
                          align: 'center',
                          render: (ss) => (
                            <span className="font-mono">
                              {formatLocaleNumber(ss.repPurchasesTotal)} ({ss.repPurchasesCount})
                            </span>
                          ),
                        },
                        {
                          key: 'repPaidTotal',
                          header: t('المدفوع', 'Paid'),
                          align: 'center',
                          render: (ss) => <span className="font-mono text-emerald-700">{formatLocaleNumber(ss.repPaidTotal)}</span>,
                        },
                        {
                          key: 'companyBalance',
                          header: t('الرصيد العام', 'General Balance'),
                          align: 'center',
                          render: (ss) => (
                            <span className={`font-mono font-black ${ss.companyBalance > 0.009 ? 'text-rose-700' : ss.companyBalance < -0.009 ? 'text-emerald-700' : 'text-slate-600'}`}>
                              {formatLocaleNumber(Math.abs(ss.companyBalance))} ({ss.companyBalance > 0.009 ? t('علينا', 'Payable') : ss.companyBalance < -0.009 ? t('لنا', 'Receivable') : t('متوازن', 'Balanced')})
                            </span>
                          ),
                        },
                        {
                          key: 'actions',
                          header: t('كشف الحساب', 'Statement'),
                          align: 'center',
                          sortable: false,
                          render: (ss) => (
                            <button
                              type="button"
                              onClick={() => {
                                const sup = data.suppliers.find((s) => s.id === ss.id);
                                if (sup) setSelectedSupplierDetail(sup);
                              }}
                              className="px-2 py-0.5 rounded-md text-[11px] bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] font-bold cursor-pointer whitespace-nowrap"
                            >
                              {t('كشف الحساب', 'Statement')}
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
                  title={t(`الفواتير (${repReportData.invoices.length})`, `Invoices (${repReportData.invoices.length})`)}
                  data={repReportData.invoices}
                  rowKey={(row) => row.id}
                  emptyTitle={t('لا توجد فواتير مطابقة للفلاتر المحددة', 'No invoices match the selected filters')}
                  columns={[
                    { key: 'invoiceNumber', header: t('رقم الفاتورة', 'Invoice #'), render: (row) => <span className="font-mono font-black text-blue-950">{row.invoiceNumber}</span> },
                    {
                      key: 'type',
                      header: t('النوع', 'Type'),
                      align: 'center',
                      render: (row) => (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${row.type === 'purchase' ? 'bg-[#EEF3FA] text-[#011E58]' : row.type === 'quote' ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-900'}`}>
                          {row.type === 'purchase' ? t('فاتورة شراء', 'Purchase Invoice') : row.type === 'quote' ? t('عرض سعر', 'Price Quote') : t('فاتورة بيع', 'Sales Invoice')}
                        </span>
                      ),
                    },
                    {
                      key: 'partyName',
                      header: t('الطرف', 'Party'),
                      render: (row) => (
                        <div>
                          <span className="font-bold text-slate-900 block">{row.partyName}</span>
                          <span className="text-[10px] text-slate-500">{row.date} · {row.itemsCount} {t('أصناف', 'items')}</span>
                        </div>
                      ),
                    },
                    {
                      key: 'grandTotal',
                      header: t('الإجمالي', 'Total'),
                      align: 'center',
                      render: (row) => (
                        <div className="whitespace-nowrap">
                          <strong className="font-mono text-slate-900 block">{formatLocaleNumber(row.grandTotal)} {t(data.settings.currency)}</strong>
                          {row.remainingAmount > 0.009 && (
                            <span className="text-[10px] text-amber-800 font-bold">{t('متبقي:', 'Remaining:')} {formatLocaleNumber(row.remainingAmount)}</span>
                          )}
                        </div>
                      ),
                    },
                    {
                      key: 'paymentStatus',
                      header: t('السداد', 'Payment'),
                      align: 'center',
                      render: (row) => (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${row.paymentStatus === 'paid' ? 'bg-emerald-50 text-emerald-800' : row.paymentStatus === 'partial' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
                          {row.paymentStatus === 'paid' ? t('مدفوعة', 'Paid') : row.paymentStatus === 'partial' ? t('جزئي', 'Partial') : t('آجل', 'Credit')}
                        </span>
                      ),
                    },
                    {
                      key: 'actions',
                      header: t('الإجراءات', 'Actions'),
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
                              <span>{t('تفاصيل', 'Details')}</span>
                            </button>
                            {canCreatePurchase && row.type === 'purchase' && row.status === 'confirmed' && row.remainingAmount > 0.009 && (
                              <button
                                type="button"
                                onClick={() => openPurchasePaymentModal(fallbackInv)}
                                className="px-2 py-0.5 rounded-md text-[11px] bg-emerald-700 text-white font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <CreditCard className="w-3 h-3" />
                                <span>{t('سداد', 'Pay')}</span>
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
                  title={t(`حركة الأصناف (${repReportData.itemRows.length})`, `Item Movements (${repReportData.itemRows.length})`)}
                  data={repReportData.itemRows}
                  rowKey={(it) => it.rowId}
                  emptyTitle={t('لا توجد حركات أصناف مطابقة', 'No matching item movements')}
                  columns={[
                    {
                      key: 'productName',
                      header: t('الصنف', 'Item'),
                      render: (it) => (
                        <div>
                          <span className="font-black text-slate-900 block">
                            {it.productName}
                            {(it.categoryName || it.class1) && (
                              <span className="text-[10px] font-normal text-slate-500 me-1">
                                ({[it.categoryName, it.class1].filter(Boolean).join(' · ')})
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {it.opType === 'sales' ? t('بيع', 'Sale') : it.opType === 'purchase' ? t('شراء', 'Purchase') : it.opType === 'sales_return' ? t('مرتجع بيع', 'Sales Return') : t('مرتجع شراء', 'Purchase Return')}{' '}
                            · <span className="font-mono">{it.invoiceNumber}</span> · {it.date} · {it.partyName}
                          </span>
                        </div>
                      ),
                    },
                    {
                      key: 'quantity',
                      header: t('الكمية', 'Qty'),
                      align: 'center',
                      render: (it) => <span className="font-mono">{formatLocaleNumber(it.quantity)} {t(it.unit)}</span>,
                    },
                    {
                      key: 'unitPrice',
                      header: t('السعر', 'Price'),
                      align: 'center',
                      render: (it) => <span className="font-mono">{formatLocaleNumber(it.unitPrice)}</span>,
                    },
                    {
                      key: 'total',
                      header: t('الإجمالي', 'Total'),
                      align: 'center',
                      render: (it) => (
                        <div>
                          <strong className="font-mono text-slate-900 block">
                            {formatLocaleNumber(it.total)} {t(data.settings.currency)}
                          </strong>
                          {(typeof it.returnedQty === 'number' && it.returnedQty > 0 && (it.opType === 'sales' || it.opType === 'purchase')) && (
                            <span className="text-[10px] font-bold text-rose-700">
                              {t('مرتجع:', 'Returned:')} {formatLocaleNumber(it.returnedQty)} · {t('الصافي:', 'Net:')} {formatLocaleNumber(it.netValue ?? it.total)}
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
                  title={t(`التحصيلات النقدية (${repReportData.collections.length})`, `Cash Collections (${repReportData.collections.length})`)}
                  data={repReportData.collections}
                  rowKey={(col) => col.id}
                  emptyTitle={t('لا توجد تحصيلات نقدية في هذه الفترة', 'No cash collections in this period')}
                  columns={[
                    {
                      key: 'partyName',
                      header: t('العميل', 'Customer'),
                      render: (col) => (
                        <div>
                          <span className="font-black text-slate-900 block">{col.partyName}</span>
                          <span className="text-[10px] text-slate-500">
                            {col.transactionNumber ? `${col.transactionNumber} · ` : ''}{col.date}
                            {col.relatedDocNumber ? ` · ${t('فاتورة', 'Invoice')} ${col.relatedDocNumber}` : ''}
                          </span>
                        </div>
                      ),
                    },
                    {
                      key: 'paymentMethod',
                      header: t('الطريقة', 'Method'),
                      align: 'center',
                      render: (col) => (col.paymentMethod === 'bank' ? t('تحويل بنكي', 'Bank Transfer') : col.paymentMethod === 'cheque' ? t('شيك', 'Cheque') : t('نقدي', 'Cash')),
                    },
                    {
                      key: 'amount',
                      header: t('المبلغ المحصل', 'Collected Amount'),
                      align: 'center',
                      render: (col) => (
                        <div>
                          <strong className="font-mono text-emerald-700 block">
                            {formatLocaleNumber(col.amount)} {t(data.settings.currency)}
                          </strong>
                          {typeof col.remainingAfter === 'number' && col.relatedDocNumber && (
                            <span className="text-[10px] font-bold text-amber-800">
                              {t('متبقي:', 'Remaining:')} {formatLocaleNumber(col.remainingAfter)}
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
                  title={t(`طلبات مرتجع المبيعات (${repReportData.salesReturnRequests?.length ?? 0})`, `Sales Return Requests (${repReportData.salesReturnRequests?.length ?? 0})`)}
                  data={repReportData.salesReturnRequests || []}
                  rowKey={(req) => req.id}
                  columns={[
                    { key: 'requestNumber', header: t('رقم الطلب', 'Request #'), render: (req) => <span className="font-mono font-black text-rose-900">{req.requestNumber}</span> },
                    { key: 'customerName', header: t('العميل / الفاتورة', 'Customer / Invoice'), render: (req) => `${req.customerName} · ${t('فاتورة', 'Invoice')} ${req.originalInvoiceNumber}` },
                    { key: 'date', header: t('التاريخ', 'Date'), align: 'center', render: (req) => <span className="font-mono">{req.date}</span> },
                    { key: 'status', header: t('الحالة', 'Status'), align: 'center', render: (req) => (req.status === 'approved' ? t('معتمد', 'Approved') : req.status === 'rejected' ? t('مرفوض', 'Rejected') : t('قيد الانتظار', 'Pending')) },
                    { key: 'grandTotal', header: t('الإجمالي', 'Total'), align: 'center', render: (req) => <strong className="font-mono text-rose-800">{formatLocaleNumber(Number(req.grandTotal || 0))} {t(data.settings.currency)}</strong> },
                  ]}
                />
              )}

              {canCreatePurchase && (repReportData.purchaseReturnRequests?.length ?? 0) > 0 && (
                <UnifiedDataTable
                  compact
                  paginated={false}
                  searchable={false}
                  title={t(`طلبات مرتجع المشتريات (${repReportData.purchaseReturnRequests?.length ?? 0})`, `Purchase Return Requests (${repReportData.purchaseReturnRequests?.length ?? 0})`)}
                  data={repReportData.purchaseReturnRequests || []}
                  rowKey={(req) => req.id}
                  columns={[
                    { key: 'requestNumber', header: t('رقم الطلب', 'Request #'), render: (req) => <span className="font-mono font-black text-[#011E58]">{req.requestNumber}</span> },
                    { key: 'supplierName', header: t('المورد / الفاتورة', 'Supplier / Invoice'), render: (req) => `${req.supplierName} · ${t('فاتورة', 'Invoice')} ${req.originalInvoiceNumber}` },
                    { key: 'date', header: t('التاريخ', 'Date'), align: 'center', render: (req) => <span className="font-mono">{req.date}</span> },
                    { key: 'status', header: t('الحالة', 'Status'), align: 'center', render: (req) => (req.status === 'approved' ? t('معتمد', 'Approved') : req.status === 'rejected' ? t('مرفوض', 'Rejected') : t('قيد الانتظار', 'Pending')) },
                    { key: 'grandTotal', header: t('الإجمالي', 'Total'), align: 'center', render: (req) => <strong className="font-mono text-[#011E58]">{formatLocaleNumber(Number(req.grandTotal || 0))} {t(data.settings.currency)}</strong> },
                  ]}
                />
              )}

              {/* Pagination Controls */}
              {repReportData.pagination && (repReportData.pagination.totalPages > 1 || repReportData.pagination.totalRows > 25) && (
                <div className="bg-white rounded-lg border border-slate-200 px-2 py-1.5 flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-700">
                    <span>{t('صفحة', 'Page')}</span>
                    <span className="font-mono text-blue-950">{repReportData.pagination.page}</span>
                    <span>{t('من', 'of')}</span>
                    <span className="font-mono text-blue-950">{repReportData.pagination.totalPages}</span>
                    <span className="text-slate-400">({repReportData.pagination.totalRows} {t('سجل', 'records')})</span>
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
                      <option value={25}>25 / {t('صفحة', 'page')}</option>
                      <option value={50}>50 / {t('صفحة', 'page')}</option>
                      <option value={100}>100 / {t('صفحة', 'page')}</option>
                    </select>
                    <button
                      type="button"
                      disabled={!repReportData.pagination.hasPrevPage || isLoadingRepReport}
                      onClick={() => setRptPage((p) => Math.max(1, p - 1))}
                      className="h-7 px-2 rounded-md text-[11px] bg-slate-100 text-slate-800 font-bold disabled:opacity-45 cursor-pointer"
                    >
                      {t('السابق', 'Prev')}
                    </button>
                    <button
                      type="button"
                      disabled={!repReportData.pagination.hasNextPage || isLoadingRepReport}
                      onClick={() => setRptPage((p) => p + 1)}
                      className="h-7 px-2 rounded-md text-[11px] bg-[#003589] text-white font-bold disabled:opacity-45 cursor-pointer"
                    >
                      {t('التالي', 'Next')}
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
                  {t(`تأكيد تسليم الطلب ${deliveringOrder.requestNumber}`, `Confirm Order Delivery ${deliveringOrder.requestNumber}`)}
                </h4>
                <p className="text-[11px] text-slate-500">{deliveringOrder.customerName}</p>
              </div>
              <button
                type="button"
                onClick={() => setDeliveringOrder(null)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                {t('المبلغ المحصل عند التسليم', 'Collected Amount on Delivery')} ({t(data.settings.currency)}):
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={deliveryCollectedAmount || ''}
                onChange={(e) => setDeliveryCollectedAmount(Math.max(0, Number(e.target.value)))}
                placeholder={t('المبلغ المحصل', 'Collected amount')}
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
                  <option value="cash">{t('نقدي', 'Cash')}</option>
                  <option value="bank">{t('تحويل بنكي', 'Bank Transfer')}</option>
                  <option value="cheque">{t('شيك', 'Cheque')}</option>
                </select>
              </div>
            )}

            <input
              type="text"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              placeholder={t('ملاحظات التسليم...', 'Delivery notes...')}
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />

            <label className="h-7 px-2 rounded-md border border-blue-200 bg-blue-50 text-blue-900 font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer">
              <Camera className="w-3.5 h-3.5" />
              <span>{deliveryProof ? t('تم التقاط الصورة (اضغط للتغيير)', 'Photo captured (tap to change)') : t('التقاط إثبات تسليم (اختياري)', 'Capture delivery proof (optional)')}</span>
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
              {isUpdatingDelivery ? t('جاري التسجيل...', 'Submitting...') : t('اعتماد تسليم الطلب', 'Confirm Order Delivery')}
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
          const currency = t(data.settings.currency || 'ج.م');
          exportHtmlToPdf({
            title: t('كشف حساب تفصيلي للعميل', 'Detailed Customer Account Statement'),
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
            dateRangeText: stmtDateFrom || stmtDateTo ? `${stmtDateFrom || '...'} ${t('إلى', 'to')} ${stmtDateTo || '...'}` : undefined,
            meta: [
              { label: t('العميل', 'Customer'), value: c.shopName || c.name },
              ...(c.phone ? [{ label: t('هاتف العميل', 'Customer Phone'), value: c.phone }] : []),
              ...(c.address && c.address !== '-' ? [{ label: t('عنوان العميل', 'Customer Address'), value: c.address }] : []),
            ],
            tableHeaders: [t('العملية', 'Operation'), t('دفع', 'Paid'), t('تاريخ', 'Date'), t('الفاتورة', 'Invoice'), t('باقي', 'Balance')],
            tableRows: filteredStmtEntries.map((entry) => [
              t(entry.label || ''),
              formatLocaleNumber(Number(entry.credit || 0)),
              entry.date || '',
              formatLocaleNumber(Number(entry.debit || 0)),
              formatLocaleNumber(Number(entry.runningBalance ?? 0)),
            ]),
            summaryPairs: [
              { label: t('الإجمالي المتبقي', 'Total Remaining'), value: `${formatLocaleNumber(totalRemainingVal)} ${currency}`, highlight: true },
            ],
          });
        };

        const handleShareCsvStatement = () => {
          const lines = [
            t('العملية,دفع,تاريخ,الفاتورة,باقي,الرقم المرجعي', 'Operation,Paid,Date,Invoice,Balance,Ref No.'),
            ...filteredStmtEntries.map((entry) =>
              `"${t(entry.label || '').replace(/"/g, '""')}",${Number(entry.credit || 0)},${entry.date || ''},${Number(entry.debit || 0)},${Number(entry.runningBalance ?? 0)},"${(entry.docNumber || '').replace(/"/g, '""')}"`
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
                    aria-label={t('رجوع', 'Back')}
                  >
                    {isRtl ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
                  </button>
                  <div className="min-w-0">
                    <h4 className="font-black text-xs truncate">
                      {customerDetailSubTab === 'statement' ? t('عرض تفصيلي لحساب الآجل', 'Detailed Credit Account View') : (c.shopName || c.name)}
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
                    title={customerDetailSubTab === 'statement' ? t('معلومات العميل', 'Customer Info') : t('كشف الحساب', 'Account Statement')}
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintCustomerStatementPdf}
                    className="h-7 px-2 rounded-md text-[11px] bg-white text-[#011E58] font-black inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Printer className="w-3 h-3" />
                    <span>{t('طباعة', 'Print')}</span>
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
                    {t('ملف العميل والملخص', 'Customer Profile & Summary')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerDetailSubTab('statement')}
                    className={`h-8 rounded-md text-[11px] font-black cursor-pointer ${
                      customerDetailSubTab === 'statement' ? 'bg-[#003589] text-white' : 'text-slate-700'
                    }`}
                  >
                    {t('كشف الحساب التفصيلي', 'Detailed Statement')}
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
                          title={t('عرض صورة المحل بالحجم الكامل', 'View full-size shop photo')}
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
                            ? t('رصيد دائن للعميل (علينا)', 'Customer Credit Balance (We Owe)')
                            : c.currentBalance > 0.009
                            ? t('المبلغ المتبقي (لنا)', 'Remaining Balance (Due)')
                            : t('الحساب متوازن', 'Balanced')}
                        </span>
                        <strong
                          className={`font-mono text-xs ${
                            c.currentBalance > 0.009 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatLocaleNumber(Math.abs(c.currentBalance))} {t(data.settings.currency)}
                        </strong>
                      </div>
                      <div className="px-2 py-1.5 bg-white">
                        <span className="text-[10px] text-blue-800 block">{t('إجمالي الفواتير', 'Total Invoices')}</span>
                        <strong className="font-mono text-xs text-blue-950">
                          {formatLocaleNumber(stmtSummary?.totalSales ?? custInvoices.reduce((s, i) => s + Number(i.grandTotal || 0), 0))} {t(data.settings.currency)}
                        </strong>
                      </div>
                      <div className="px-2 py-1.5 bg-white">
                        <span className="text-[10px] text-emerald-800 block">{t('إجمالي المحصل', 'Total Collected')}</span>
                        <strong className="font-mono text-xs text-emerald-950">
                          {formatLocaleNumber(stmtSummary?.totalPaid ?? stmtSummary?.totalCredit ?? 0)} {t(data.settings.currency)}
                        </strong>
                      </div>
                      <div className="px-2 py-1.5 bg-white">
                        <span className="text-[10px] text-slate-500 block">{t('آخر فاتورة', 'Last Invoice')}</span>
                        <strong className="font-mono text-[11px] text-blue-950">
                          {stmtSummary?.lastInvoiceDate
                            ? `${stmtSummary.lastInvoiceDate} (${stmtSummary.lastInvoiceNumber || ''})`
                            : latestInvoice
                            ? `${latestInvoice.date} (${latestInvoice.invoiceNumber})`
                            : t('لا يوجد', 'None')}
                        </strong>
                      </div>
                      <div className="px-2 py-1.5 bg-white col-span-1 sm:col-span-2">
                        <span className="text-[10px] text-slate-500 block">{t('آخر تحصيل / سداد', 'Last Collection / Payment')}</span>
                        <strong className="font-mono text-[11px] text-emerald-900">
                          {stmtSummary?.lastPaymentDate
                            ? stmtSummary.lastPaymentDate
                            : latestPaymentTx
                            ? `${formatLocaleNumber(latestPaymentTx.amount)} (${latestPaymentTx.date})`
                            : t('لا يوجد', 'None')}
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
                            <span dir="ltr">{rawPhone}</span>
                            {ph.label && <span className="font-sans text-[10px]">({t(ph.label)})</span>}
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
                          <span>{t('عرض الموقع على الخريطة', 'View Location on Map')}</span>
                        </button>
                      )}
                    </div>

                    <UnifiedDataTable
                      compact
                      paginated={false}
                      searchable={false}
                      title={`${t('آخر فواتير العميل', 'Recent Customer Invoices')} (${custInvoices.length})`}
                      data={custInvoices}
                      rowKey={(inv) => inv.id}
                      emptyTitle={t('لا توجد فواتير مسجلة لهذا العميل', 'No invoices recorded for this customer')}
                      onRowClick={(inv) =>
                        setStatementPreviewDoc({
                          type: 'invoice',
                          docId: inv.id,
                          title: inv.invoiceNumber,
                        })
                      }
                      columns={[
                        { key: 'invoiceNumber', header: t('رقم الفاتورة', 'Invoice #'), render: (inv) => <span className="font-mono font-bold text-blue-950">{inv.invoiceNumber}</span> },
                        { key: 'date', header: t('التاريخ', 'Date'), align: 'center', render: (inv) => <span className="font-mono text-slate-600">{inv.date}</span> },
                        {
                          key: 'grandTotal',
                          header: t('الإجمالي', 'Total'),
                          align: 'center',
                          render: (inv) => (
                            <strong className="font-mono text-slate-900 tabular-nums">
                              {formatLocaleNumber(inv.grandTotal)} {t(data.settings.currency)}
                            </strong>
                          ),
                        },
                        {
                          key: 'remainingAmount',
                          header: t('المتبقي', 'Remaining'),
                          align: 'center',
                          render: (inv) =>
                            inv.remainingAmount > 0 ? (
                              <span className="font-mono font-bold text-red-700">{formatLocaleNumber(inv.remainingAmount)}</span>
                            ) : (
                              <span className="text-emerald-700 font-bold">{t('مسددة', 'Paid')}</span>
                            ),
                        },
                      ]}
                    />
                  </>
                )}

                {customerDetailSubTab === 'statement' && (
                  <div className="space-y-2">
                    {/* Customer Switcher + Date Range + Search Filter Strip (Single Horizontal Row) */}
                    <div className="bg-white rounded-lg border border-slate-200 p-2">
                      <div className="awlad-filter-row" data-testid="rep-stmt-filter-row">
                        <select
                          value={c.id}
                          onChange={(e) => {
                            const nextC = data.customers.find((x) => x.id === e.target.value);
                            if (nextC) {
                              setSelectedCustomerDetail(nextC);
                              setCustomerDetailSubTab('statement');
                            }
                          }}
                          aria-label={t('تبديل العميل', 'Switch Customer')}
                          className="w-[175px] h-8 rounded-md border border-slate-300 px-2 text-xs font-bold bg-slate-50 shrink-0"
                        >
                          {data.customers.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.shopName || x.name} ({formatLocaleNumber(Number(x.currentBalance || 0))} {t(data.settings.currency)})
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
                          title={t('تحديث كشف الحساب', 'Refresh Statement')}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCustomerStatement ? 'animate-spin' : ''}`} />
                        </button>
                        <label className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-slate-300 bg-slate-50 shrink-0">
                          <span className="text-[10.5px] font-bold text-slate-500">{t('من:', 'From:')}</span>
                          <input
                            type="date"
                            aria-label={t('من تاريخ', 'From Date')}
                            value={stmtDateFrom}
                            onChange={(e) => setStmtDateFrom(e.target.value)}
                            title={t('من تاريخ', 'From Date')}
                            className="bg-transparent font-mono text-xs outline-hidden"
                          />
                        </label>
                        <label className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-slate-300 bg-slate-50 shrink-0">
                          <span className="text-[10.5px] font-bold text-slate-500">{t('إلى:', 'To:')}</span>
                          <input
                            type="date"
                            aria-label={t('إلى تاريخ', 'To Date')}
                            value={stmtDateTo}
                            onChange={(e) => setStmtDateTo(e.target.value)}
                            title={t('إلى تاريخ', 'To Date')}
                            className="bg-transparent font-mono text-xs outline-hidden"
                          />
                        </label>
                        <input
                          type="text"
                          value={stmtSearch}
                          onChange={(e) => setStmtSearch(e.target.value)}
                          placeholder={t('بحث برقم المستند أو العملية...', 'Search by doc # or operation...')}
                          className="flex-1 min-w-[140px] h-8 rounded-md border border-slate-300 px-2 text-xs bg-slate-50 shrink-0"
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
                        {t('دفع', 'Pay')}
                      </button>
                      <div className="h-8 rounded-md bg-white border border-slate-200 px-2 flex flex-col items-center justify-center text-center tabular-nums leading-tight">
                        <span className="text-[9px] text-slate-500 font-bold">{t('إجمالي المتبقي', 'Total Remaining')}</span>
                        <strong className={`font-mono text-[11px] font-black ${totalRemainingVal > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {formatLocaleNumber(totalRemainingVal)} {t(data.settings.currency)}
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
                        {t('تصحيح', 'Edit')}
                      </button>
                    </div>

                    {customerDetailStatement?.scope?.isRepScoped && (
                      <div className="px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-950 font-bold text-[10px]">
                        {t('رصيد حساب العميل عام للشركة، والفواتير والمرتجعات والدفعات أدناه تخص عملياتك معه فقط.', 'Customer account balance is company-wide; invoices, returns, and payments below reflect your own transactions with this customer.')}
                      </div>
                    )}

                    {/* WA0004 5-Column Tabular Ledger Table */}
                    {isLoadingCustomerStatement ? (
                      <p className="text-center py-6 text-slate-500 font-bold">{t('جاري تحميل كشف الحساب التفصيلي...', 'Loading detailed statement...')}</p>
                    ) : (
                      <UnifiedDataTable
                        compact
                        paginated={false}
                        searchable={false}
                        maxHeightClassName="max-h-[42vh]"
                        data={filteredStmtEntries}
                        rowKey={(entry) => entry.id}
                        emptyTitle={t('لا توجد حركات مسجلة مطابقة للبحث', 'No matching transactions found')}
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
                            header: t('العملية', 'Operation'),
                            render: (entry) => (
                              <div>
                                <span className="font-bold text-slate-900 block whitespace-normal break-words">{t(entry.label)}</span>
                                {entry.docNumber && (
                                  <span className="font-mono text-[10px] text-slate-400 block">{entry.docNumber}</span>
                                )}
                              </div>
                            ),
                          },
                          {
                            key: 'credit',
                            header: t('دفع', 'Paid'),
                            align: 'center',
                            render: (entry) => (
                              <span className="font-mono font-bold text-emerald-700">
                                {entry.credit ? formatLocaleNumber(Number(entry.credit)) : '-'}
                              </span>
                            ),
                          },
                          {
                            key: 'date',
                            header: t('تاريخ', 'Date'),
                            align: 'center',
                            render: (entry) => <span className="font-mono text-slate-600">{entry.date}</span>,
                          },
                          {
                            key: 'debit',
                            header: t('الفاتورة', 'Invoice'),
                            align: 'center',
                            render: (entry) => (
                              <span className="font-mono font-bold text-slate-800">
                                {entry.debit ? formatLocaleNumber(Number(entry.debit)) : '-'}
                              </span>
                            ),
                          },
                          {
                            key: 'runningBalance',
                            header: t('باقي', 'Balance'),
                            align: 'center',
                            render: (entry) => {
                              const rb = Number(entry.runningBalance ?? 0);
                              return (
                                <strong className={`font-mono font-black ${rb > 0.009 ? 'text-red-700' : 'text-emerald-700'}`}>
                                  {formatLocaleNumber(rb)}
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
                        <span>{t('مشاركة / CSV', 'Share / CSV')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handlePrintCustomerStatementPdf}
                        className="h-8 rounded-md bg-[#011E58] hover:bg-[#003589] text-white font-black flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>{t('طباعة', 'Print')}</span>
                      </button>
                    </div>
                  </div>
                )}

                {statementPreviewDoc && (
                  <div className="p-2 rounded-md bg-blue-50 border border-blue-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <strong className="text-blue-950 font-black">
                        {t('تفاصيل المستند:', 'Document Details:')} {statementPreviewDoc.title}
                      </strong>
                      <button
                        type="button"
                        onClick={() => setStatementPreviewDoc(null)}
                        className="px-2 py-0.5 rounded-md text-[11px] bg-white text-slate-700 font-bold cursor-pointer"
                      >
                        {t('إغلاق', 'Close')}
                      </button>
                    </div>
                    {previewInvoiceObj ? (
                      <div className="space-y-1 text-[11px]">
                        <div className="flex justify-between font-bold text-slate-700">
                          <span>{t('التاريخ:', 'Date:')} {previewInvoiceObj.date}</span>
                          <span>{t('الإجمالي:', 'Total:')} {formatLocaleNumber(previewInvoiceObj.grandTotal)} {t(data.settings.currency)}</span>
                        </div>
                        <div className="divide-y divide-blue-200/70 bg-white rounded-md p-2">
                          {(previewInvoiceObj.items || []).map((it, idx) => (
                            <div key={idx} className="py-1 flex justify-between">
                              <span>{it.productName} ({it.quantity} {t(it.unit)})</span>
                              <strong className="font-mono">{formatLocaleNumber(it.total)}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : previewPaymentObj ? (
                      <div className="bg-white rounded-md p-2 space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span>{t('التاريخ:', 'Date:')}</span>
                          <strong className="font-mono">{previewPaymentObj.date}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>{t('المبلغ المحصل:', 'Collected Amount:')}</span>
                          <strong className="font-mono text-emerald-700">
                            {formatLocaleNumber(previewPaymentObj.amount)} {t(data.settings.currency)}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span>{t('البيان:', 'Description:')}</span>
                          <span>{previewPaymentObj.notes || '-'}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-600">{t('لا تتوفر تفاصيل إضافية لهذا المستند محلياً.', 'No additional local details available for this document.')}</p>
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
                    {t('+ فاتورة جديدة', '+ New Invoice')}
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
                    {t('+ تحصيل دفعة', '+ Collect Payment')}
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
                      <span>{t('تعديل بيانات العميل', 'Edit Customer Info')}</span>
                    </button>
                  )}
                  {canDeleteCustomer && (
                    <button
                      type="button"
                      onClick={() => setDeleteCustomerTarget(c)}
                      className="h-8 px-2.5 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t('حذف', 'Delete')}</span>
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
          <div role="dialog" aria-modal="true" className="w-full max-w-sm bg-white rounded-lg p-2.5 border border-slate-200 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-black text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{t('توجد أصناف غير محفوظة في الفاتورة', 'Unsaved Items in Invoice')}</span>
            </div>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              {t(
                `لديك (${invItems.length}) أصناف في الفاتورة الحالية ولم يتم حفظها أو اعتمادها بعد. هل تريد المغادرة مع الاحتفاظ بها أم البقاء لإكمال الفاتورة؟`,
                `You have (${invItems.length}) unsaved items in the current invoice. Leave while keeping the draft or stay to finish?`
              )}
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => setPendingLeaveTab(null)}
                className="h-8 rounded-md bg-blue-900 text-white font-black cursor-pointer"
              >
                {t('البقاء في الفاتورة', 'Stay on Invoice')}
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
                {t('الانتقال (مع حفظ المسودة)', 'Leave (Keep Draft)')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Sheet */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[82vh] flex flex-col gap-2 text-xs pb-safe">
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
                {t('إغلاق', 'Close')}
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
                { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold text-slate-900">{it.productName}</span> },
                { key: 'quantity', header: t('الكمية', 'Qty'), align: 'center', render: (it) => <span className="font-mono">{it.quantity} {t(it.unit)}</span> },
                { key: 'unitPrice', header: t('السعر', 'Price'), align: 'center', render: (it) => <span className="font-mono">{formatLocaleNumber(it.unitPrice)}</span> },
                { key: 'total', header: t('الإجمالي', 'Total'), align: 'center', render: (it) => <strong className="font-mono text-blue-950">{formatLocaleNumber(it.total)} {t(data.settings.currency)}</strong> },
              ]}
            />
            <button
              type="button"
              onClick={() => exportInvoiceDocument(selectedInvoice)}
              className="h-8 rounded-md bg-blue-900 text-white font-black flex items-center justify-center gap-1 cursor-pointer"
            >
              {isNative ? <Share2 className="w-3.5 h-3.5" /> : <FileDown className="w-3.5 h-3.5" />}
              <span>{isNative ? t('مشاركة / حفظ الفاتورة', 'Share / Save Invoice') : t('طباعة / PDF', 'Print / PDF')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Purchase Invoice Review & Dispatch Modal */}
      {purReviewOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[88vh] overflow-y-auto space-y-2 text-xs pb-safe">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <h4 className="font-black text-xs text-slate-900">{t('معاينة ومراجعة فاتورة الشراء قبل الإرسال', 'Preview & Review Purchase Invoice Before Sending')}</h4>
              <button
                type="button"
                onClick={() => setPurReviewOpen(false)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                {t('تعديل', 'Edit')}
              </button>
            </div>

            <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-0.5 text-[11px]">
              <p>{t('المورد:', 'Supplier:')} <strong>{data.suppliers.find((s) => s.id === purSupplierId)?.name || t('مورد', 'Supplier')}</strong> · {t('المستودع:', 'Warehouse:')} <strong>{t(data.warehouses.find((w) => w.id === (purWarehouseId || mainWarehouse?.id))?.name || 'المخزن الرئيسي')}</strong></p>
              <p>{t('عدد الأصناف:', 'Items Count:')} <strong>{purItems.length}</strong> · {t('طريقة السداد:', 'Payment Method:')} <strong>{purPaymentType === 'cash' ? t('نقدي', 'Cash') : purPaymentType === 'credit' ? t('آجل', 'Credit') : t('جزئي', 'Partial')}</strong></p>
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
                  header: t('الصنف', 'Item'),
                  render: (it) => (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-bold text-slate-800">{it.productName}</span>
                      {it.newProduct && (
                        <span className="text-emerald-800 text-[10px] font-bold">· {t('جديد', 'New')}</span>
                      )}
                    </div>
                  ),
                },
                { key: 'quantity', header: t('الكمية', 'Qty'), align: 'center', render: (it) => <span className="font-mono">{it.quantity} {t(it.unit)}</span> },
                { key: 'unitPrice', header: t('السعر', 'Price'), align: 'center', render: (it) => <span className="font-mono">{formatLocaleNumber(it.unitPrice)}</span> },
                { key: 'total', header: t('الإجمالي', 'Total'), align: 'center', render: (it) => <strong className="font-mono text-[#011E58]">{formatLocaleNumber(it.total)}</strong> },
              ]}
            />

            <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] space-y-0.5">
              <div className="flex justify-between">
                <span>{t('الإجمالي الفرعي:', 'Subtotal:')}</span>
                <strong className="font-mono">{formatLocaleNumber(purSubtotal)} {t(data.settings.currency)}</strong>
              </div>
              {Number(purDiscount) > 0 && (
                <div className="flex justify-between text-rose-700">
                  <span>{t('الخصم:', 'Discount:')}</span>
                  <strong className="font-mono">-{formatLocaleNumber(Number(purDiscount))} {t(data.settings.currency)}</strong>
                </div>
              )}
              <div className="flex justify-between font-black text-[#011E58] text-xs pt-1 border-t border-[#DCE6F5]">
                <span>{t('صافي الإجمالي:', 'Net Total:')}</span>
                <strong className="font-mono">{formatLocaleNumber(purTotal)} {t(data.settings.currency)}</strong>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('المستلم الموجه إليه (اختياري):', 'Directed Recipient (Optional):')}</label>
              <select
                value={purRecipientUserId}
                onChange={(e) => setPurRecipientUserId(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
              >
                <option value="">{t('الإدارة العامة (جميع المسؤولين المختصين)', 'General Management (All Authorized Staff)')}</option>
                {(data.purchaseReceivers || []).map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName} ({t(r.role)})</option>
                ))}
              </select>
            </div>

            <div className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[10px]">
              {t('لن يتغير رصيد المخزن أو المورد أو الخزينة إلا بعد استلام الفاتورة واعتمادها من الإدارة.', 'Inventory, supplier, and cashbox balances will not update until management receives and confirms this invoice.')}
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                type="button"
                disabled={isSubmittingPurchase}
                onClick={() => handleSubmitPurchaseInvoice(false)}
                className="h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmittingPurchase ? t('جاري الحفظ...', 'Saving...') : t('حفظ كمسودة', 'Save as Draft')}
              </button>
              <button
                type="button"
                disabled={isSubmittingPurchase}
                onClick={() => handleSubmitPurchaseInvoice(true)}
                className="h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmittingPurchase ? t('جاري الإرسال...', 'Sending...') : t('حفظ وإرسال للإدارة', 'Save & Send to Management')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Send Draft Purchase Modal */}
      {sendingPurchaseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-950/60 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm bg-white rounded-lg p-2.5 border border-slate-200 space-y-2 text-xs">
            <h4 className="font-black text-xs text-slate-900">
              {t(`إرسال فاتورة الشراء (${sendingPurchaseTarget.invoiceNumber}) للإدارة`, `Send Purchase Invoice (${sendingPurchaseTarget.invoiceNumber}) to Management`)}
            </h4>
            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('توجيه إلى:', 'Direct To:')}</label>
              <select
                value={sendingRecipientUserId}
                onChange={(e) => setSendingRecipientUserId(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
              >
                <option value="">{t('الإدارة العامة (جميع المسؤولين المختصين)', 'General Management (All Authorized Staff)')}</option>
                {(data.purchaseReceivers || []).map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName} ({t(r.role)})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => setSendingPurchaseTarget(null)}
                className="h-8 rounded-md bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
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
                        ? t(`تم وضع طلب إرسال الفاتورة (${sendingPurchaseTarget.invoiceNumber}) في طابور المزامنة.`, `Invoice (${sendingPurchaseTarget.invoiceNumber}) dispatch queued for sync.`)
                        : t(`تم إرسال الفاتورة (${sendingPurchaseTarget.invoiceNumber}) للإدارة بانتظار الاستلام.`, `Invoice (${sendingPurchaseTarget.invoiceNumber}) sent to management awaiting receipt.`),
                    });
                  } else {
                    setFeedback({ type: 'error', text: res.error ? t(res.error) : t('تعذر إرسال الفاتورة', 'Could not send invoice') });
                  }
                }}
                className="h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSendingPurchase ? t('جاري الإرسال...', 'Sending...') : t('تأكيد الإرسال', 'Confirm Send')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Dispatch History Modal */}
      {historyPurchaseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-950/60 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-lg p-2.5 border border-slate-200 space-y-2 text-xs max-h-[82vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <h4 className="font-black text-xs text-slate-900">
                {t('سجل الإرسال والاستلام', 'Dispatch & Receipt History')} — {historyPurchaseTarget.invoiceNumber}
              </h4>
              <button
                type="button"
                onClick={() => setHistoryPurchaseTarget(null)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
            {(!historyPurchaseTarget.dispatchHistory || historyPurchaseTarget.dispatchHistory.length === 0) ? (
              <p className="text-slate-400 text-center py-4">{t('لا توجد حركات إرسال مسجلة بعد.', 'No dispatch actions recorded yet.')}</p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
                {historyPurchaseTarget.dispatchHistory.map((h, idx) => (
                  <div key={`${h.at}-${idx}`} className="p-2 bg-white flex items-start justify-between gap-2">
                    <div>
                      <strong className="text-slate-900">
                        {h.action === 'created' ? t('إنشاء المسودة', 'Draft Created') :
                         h.action === 'sent' ? t('إرسال للإدارة', 'Sent to Management') :
                         h.action === 'resent' ? t('إعادة إرسال للإدارة', 'Resent to Management') :
                         h.action === 'received' ? t('استلام الفاتورة', 'Invoice Received') :
                         h.action === 'rejected' ? t('رفض الفاتورة', 'Invoice Rejected') :
                         h.action === 'confirmed' ? t('اعتماد وترحيل', 'Confirmed & Posted') : t(h.action)}
                      </strong>
                      {h.by && <span className="text-slate-600 me-1.5">· {h.by}</span>}
                      {h.recipientName && <span className="text-[#003589] me-1.5">→ {t(h.recipientName)}</span>}
                      {(h.notes || h.reason) && <p className="text-slate-600 mt-0.5">{h.notes || h.reason}</p>}
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0" dir="ltr">
                      {h.at ? formatLocaleDateTime(h.at) : ''}
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
          <div role="dialog" aria-modal="true" className="w-full max-w-lg bg-white rounded-lg overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b bg-slate-50 text-xs">
              <strong className="text-slate-900">{t('معاينة صورة المحل', 'Shop Photo Preview')}</strong>
              <button
                type="button"
                onClick={() => setPreviewShopPhoto(null)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-200 font-bold text-slate-800 cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
            <div className="p-2 bg-slate-900 flex items-center justify-center">
              <img src={previewShopPhoto} alt={t('صورة المحل', 'Shop photo')} className="max-h-[75vh] w-auto object-contain rounded-md" />
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
            <div role="dialog" aria-modal="true" className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[88vh] flex flex-col gap-2 text-xs pb-safe">
              <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-1.5">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="font-black text-xs text-slate-900 font-mono">{pur.invoiceNumber}</h4>
                    <span className="text-[11px] font-bold text-slate-600">· {meta.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {pur.supplierName || t('مورد', 'Supplier')} · {pur.date} · {t(pur.warehouseName || 'المخزن الرئيسي')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPurchaseDetail(null)}
                  className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer shrink-0"
                >
                  {t('إغلاق', 'Close')}
                </button>
              </div>

              <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-0.5 text-[11px]">
                <p>
                  {t('السداد:', 'Payment:')} <strong>{pur.paymentType === 'cash' ? t('نقدي', 'Cash') : pur.paymentType === 'credit' ? t('آجل', 'Credit') : t('جزئي', 'Partial')}</strong>
                  {pur.paidAmount > 0 ? ` · ${t('مدفوع:', 'Paid:')} ${formatLocaleNumber(pur.paidAmount)} ${t(data.settings.currency)}` : ''}
                </p>
                {pur.sentAt && (
                  <p>
                    {t('وقت الإرسال:', 'Sent At:')} <strong dir="ltr" className="font-mono">{formatLocaleDateTime(pur.sentAt)}</strong>
                    {pur.recipientName ? ` · ${t('موجهة إلى:', 'Directed To:')} ${t(pur.recipientName)}` : ''}
                  </p>
                )}
                {pur.receivedBy && (
                  <p className="text-[#003589] font-bold">
                    {t('المستلم الفعلي:', 'Received By:')} {pur.receivedBy}
                    {pur.receivedAt ? ` (${formatLocaleDateTime(pur.receivedAt)})` : ''}
                  </p>
                )}
                {pur.dispatchStatus === 'rejected' && pur.rejectionReason && (
                  <p className="text-rose-800 font-bold">
                    {t('سبب الرفض', 'Rejection Reason')} ({pur.rejectedBy || t('الإدارة', 'Management')}): {pur.rejectionReason}
                  </p>
                )}
                {pur.notes && <p className="text-slate-600">{t('ملاحظات:', 'Notes:')} {pur.notes}</p>}
              </div>

              <UnifiedDataTable
                compact
                paginated={false}
                searchable={false}
                maxHeightClassName="max-h-[35vh]"
                data={pur.items || []}
                rowKey={(it, idx) => `${it.productId}-${idx}`}
                columns={[
                  { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold text-slate-900">{it.productName}</span> },
                  { key: 'quantity', header: t('الكمية', 'Qty'), align: 'center', render: (it) => <span className="font-mono">{it.quantity} {t(it.unit)}</span> },
                  {
                    key: 'unitPrice',
                    header: t('السعر', 'Price'),
                    align: 'center',
                    render: (it) => (
                      <span className="font-mono">
                        {formatLocaleNumber(it.unitPrice)}
                        {Number(it.discount || 0) > 0 ? ` (${t('خصم', 'Disc')} ${formatLocaleNumber(it.discount)})` : ''}
                      </span>
                    ),
                  },
                  {
                    key: 'total',
                    header: t('الإجمالي', 'Total'),
                    align: 'center',
                    render: (it) => (
                      <strong className="font-mono text-[#011E58] tabular-nums">
                        {formatLocaleNumber(it.total)} {t(data.settings.currency)}
                      </strong>
                    ),
                  },
                ]}
              />

              <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] space-y-0.5 text-[#011E58] tabular-nums">
                <div className="flex items-center justify-between font-black text-xs">
                  <span>{t('صافي الإجمالي:', 'Net Total:')}</span>
                  <strong className="font-mono">
                    {formatLocaleNumber(pur.grandTotal)} {t(data.settings.currency)}
                  </strong>
                </div>
                {pur.status === 'confirmed' && (
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>{t('المدفوع:', 'Paid:')} {formatLocaleNumber(Number(pur.paidAmount || 0))} {t(data.settings.currency)}</span>
                    <span className={Number(pur.remainingAmount || 0) > 0.009 ? 'text-amber-800' : 'text-emerald-800'}>
                      {t('المتبقي:', 'Remaining:')} {formatLocaleNumber(Math.max(0, Number(pur.remainingAmount || 0)))} {t(data.settings.currency)}
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
                      <span>{t('تسجيل دفعة سداد', 'Record Payment')}</span>
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
                      <span>{t('إرسال للإدارة', 'Send to Management')}</span>
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
                      <span>{t('تعديل', 'Edit')}</span>
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
                  <span>{t('سجل الحالات', 'Status History')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportInvoiceDocument(pur)}
                  className="h-8 px-2.5 rounded-md text-[11px] bg-slate-100 text-slate-800 font-bold cursor-pointer"
                >
                  {t('طباعة / PDF', 'Print / PDF')}
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
                  {t('تعديل بيانات العميل', 'Edit Customer Info')} — {editingCustomerTarget.shopName || editingCustomerTarget.name}
                </h4>
                <button
                  type="button"
                  onClick={() => setEditingCustomerTarget(null)}
                  className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer"
                >
                  {t('إغلاق', 'Close')}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('اسم المحل', 'Shop Name')}</label>
                  <input
                    type="text"
                    value={editCustShop}
                    onChange={(e) => setEditCustShop(e.target.value)}
                    placeholder={t('اسم المحل أو النشاط', 'Shop or business name')}
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('اسم العميل / صاحب المحل *', 'Customer / Owner Name *')}</label>
                  <input
                    type="text"
                    required
                    value={editCustName}
                    onChange={(e) => setEditCustName(e.target.value)}
                    placeholder={t('الاسم الكامل', 'Full name')}
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
                      <img src={editCustShopPhoto} alt={t('صورة المحل', 'Shop photo')} className="w-full h-full object-cover" />
                    </button>
                  ) : (
                    <Store className="w-4 h-4 text-slate-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <span className="block text-[11px] font-black text-slate-800">{t('صورة المحل', 'Shop Photo')}</span>
                  <div className="flex flex-wrap gap-1">
                    <label className="h-7 px-2 rounded-md bg-blue-900 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer">
                      <Camera className="w-3 h-3" />
                      <span>{editCustShopPhoto ? t('تغيير بالكاميرا', 'Retake Photo') : t('التقاط بالكاميرا', 'Take Photo')}</span>
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
                      <span>{t('من المعرض', 'From Gallery')}</span>
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
                        {t('حذف', 'Delete')}
                      </button>
                    )}
                  </div>
                  {isUploadingEditCustPhoto && <p className="text-[10px] font-bold text-blue-900">{t('جاري ضغط وتجهيز الصورة...', 'Compressing and preparing image...')}</p>}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('عنوان المحل الرئيسي', 'Main Shop Address')}</label>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={editCustAddress}
                    onChange={(e) => {
                      setEditCustAddress(e.target.value);
                      if (editCustMapNotice) setEditCustMapNotice(null);
                    }}
                    placeholder={t('الشارع، المنطقة، علامة مميزة...', 'Street, area, landmark...')}
                    className="flex-1 h-8 rounded-md border border-slate-300 px-2 font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => setLocationPickerTarget('edit')}
                    className="h-8 px-2 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                    title={t('تحديد موقع العميل على خريطة جوجل', 'Pick customer location on Google Maps')}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{t('خريطة', 'Map')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isLocatingEditCust}
                    onClick={handleCaptureEditCustLocation}
                    className="h-8 px-2 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                    title={t('تحديد الموقع الحالي GPS وجلب العنوان تلقائياً', 'Capture current GPS location and fetch address automatically')}
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#003589]" />
                    <span>{isLocatingEditCust ? t('تحديد...', 'Locating...') : 'GPS'}</span>
                  </button>
                </div>
                {editCustGeo && (
                  <p className="text-[10px] font-mono text-[#003589] mt-0.5" dir="ltr">
                    GPS: {editCustGeo}
                  </p>
                )}
                {editCustMapNotice && <p className="text-[11px] font-bold text-red-600 mt-0.5">{t(editCustMapNotice)}</p>}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('المحافظة', 'Governorate')}</label>
                  <input
                    type="text"
                    value={editCustGovernorate}
                    onChange={(e) => setEditCustGovernorate(e.target.value)}
                    placeholder={t('المحافظة', 'Governorate')}
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('المنطقة / خط السير', 'Area / Route')}</label>
                  <input
                    type="text"
                    value={editCustArea}
                    onChange={(e) => setEditCustArea(e.target.value)}
                    placeholder={t('المنطقة / خط السير', 'Area / Route')}
                    className="w-full h-8 rounded-md border border-slate-300 px-2 font-semibold"
                  />
                </div>
              </div>

              <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('رقم التليفون الرئيسي *', 'Primary Phone Number *')}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="tel"
                      dir="ltr"
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
                        <span>{t('اتصال', 'Call')}</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setEditCustPhoneNotice({ type: 'error', text: t('يرجى إدخال رقم هاتف صحيح (7 أرقام على الأقل) أولاً.', 'Please enter a valid phone number (at least 7 digits) first.') })
                        }
                        className="h-8 px-2 rounded-md bg-slate-100 text-slate-600 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>{t('اتصال', 'Call')}</span>
                      </button>
                    )}
                  </div>
                  {editCustPhoneNotice && (
                    <p className="text-[10px] font-bold text-red-600 mt-0.5">{editCustPhoneNotice.text}</p>
                  )}
                </div>

                {editCustExtraPhones.length > 0 && (
                  <div className="space-y-1">
                    <label className="block font-bold text-slate-600 text-[10px]">{t('أرقام تليفون إضافية:', 'Additional Phone Numbers:')}</label>
                    {editCustExtraPhones.map((extra, idx) => {
                      const cleanEx = extra.phone.replace(/[^\d+]/g, '');
                      const validEx = cleanEx.replace(/\D/g, '').length >= 7;
                      return (
                        <div key={extra.id || idx} className="flex flex-wrap sm:flex-nowrap items-center gap-1">
                          <input
                            type="tel"
                            dir="ltr"
                            value={extra.phone}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditCustExtraPhones((prev) => prev.map((row, i) => (i === idx ? { ...row, phone: v } : row)));
                            }}
                            placeholder={t('رقم إضافي...', 'Additional number...')}
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
                            <option value="موبايل">{t('موبايل', 'Mobile')}</option>
                            <option value="محل">{t('تليفون المحل', 'Shop Phone')}</option>
                            <option value="واتساب">{t('واتساب', 'WhatsApp')}</option>
                            <option value="إضافي">{t('إضافي', 'Extra')}</option>
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
                            {t('رئيسي', 'Primary')}
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
                  <span>{t('إضافة رقم تليفون آخر', 'Add Another Phone Number')}</span>
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('ملاحظات', 'Notes')}</label>
                <input
                  type="text"
                  value={editCustNotes}
                  onChange={(e) => setEditCustNotes(e.target.value)}
                  placeholder={t('ملاحظات عن المحل أو المواعيد (اختياري)', 'Notes about shop or schedule (optional)')}
                  className="w-full h-8 rounded-md border border-slate-300 px-2"
                />
              </div>

              <button
                type="submit"
                disabled={isSavingEditCustomer || isUploadingEditCustPhoto}
                className="w-full h-9 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSavingEditCustomer ? t('جاري حفظ التعديلات...', 'Saving changes...') : t('حفظ التعديلات', 'Save Changes')}
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
                <h4 className="font-black text-xs text-red-900">{t('حذف العميل الآمن', 'Safe Customer Delete')}</h4>
                <p className="text-[10px] text-slate-500">
                  {t('يسمح النظام بالحذف فقط للعملاء ذوي الرصيد الصفرى بدون فواتير أو حركات مالية مرتبطة.', 'Deletion is allowed only for zero-balance customers with no linked invoices or financial transactions.')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSafeDeleteModalOpen(false)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer shrink-0"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={safeDeleteSearch}
                onChange={(e) => setSafeDeleteSearch(e.target.value)}
                placeholder={t('ابحث باسم العميل أو المحل أو الكود...', 'Search by customer, shop, or code...')}
                className="w-full h-8 rounded-md border border-slate-300 ps-7 pe-2 font-semibold outline-hidden focus:border-red-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2 top-2" />
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
              emptyTitle={t('لا يوجد عملاء مطابقون', 'No matching customers')}
              columns={[
                {
                  key: 'shopName',
                  header: t('العميل', 'Customer'),
                  render: (c) => (
                    <div>
                      <span className="font-black text-slate-900 block">{c.shopName || c.name}</span>
                      <span className="text-[10px] text-slate-500">{c.name} · <span className="font-mono">{c.code}</span></span>
                    </div>
                  ),
                },
                {
                  key: 'currentBalance',
                  header: t('الرصيد', 'Balance'),
                  align: 'center',
                  render: (c) => {
                    const hasBalance = Math.abs(Number(c.currentBalance || 0)) > 0.009;
                    return (
                      <span className={`font-mono font-bold ${hasBalance ? 'text-red-700' : 'text-emerald-700'}`}>
                        {formatLocaleNumber(Number(c.currentBalance || 0))} {t(data.settings.currency)}
                      </span>
                    );
                  },
                },
                {
                  key: 'actions',
                  header: t('الإجراء', 'Action'),
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
                        <span>{hasBalance ? t('فحص والحذف', 'Check & Delete') : t('حذف', 'Delete')}</span>
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
            ? t('رصيد مستحق للمورد (علينا)', 'Due to Supplier (We Owe)')
            : bal < -0.009
            ? t('دفعة مقدمة عند المورد (لنا)', 'Advance at Supplier (Due to Us)')
            : t('الحساب متوازن', 'Balanced');
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
            <div className="w-full max-w-lg bg-white rounded-t-lg sm:rounded-lg p-2.5 border border-slate-200 max-h-[88vh] overflow-y-auto space-y-2 text-xs pb-safe">
              <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-1.5">
                <div>
                  <h4 className="font-black text-xs text-slate-900">{t('كشف حساب المورد', 'Supplier Statement')} — {sup.name}</h4>
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
                  {t('إغلاق', 'Close')}
                </button>
              </div>

              <div className="px-2 py-1 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] font-bold text-[10px]">
                {t('رصيد حساب المورد عام للشركة، والحركات أدناه تخص فواتيرك ومرتجعاتك ودفعاتك فقط.', 'Supplier balance is company-wide; entries below reflect only your invoices, returns, and payments.')}
              </div>

              {isLoadingSupplierStmt ? (
                <div className="p-3 text-center text-slate-500 font-bold">{t('جاري تحميل كشف حساب المورد...', 'Loading supplier statement...')}</div>
              ) : supStmtError ? (
                <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-700 font-bold">{t(supStmtError)}</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden text-center tabular-nums">
                    <div className="px-2 py-1.5 bg-white">
                      <span className="text-[10px] text-[#003589] block font-bold">{t('مشترياتك', 'Your Purchases')}</span>
                      <strong className="font-mono text-xs text-[#011E58]">
                        {formatLocaleNumber(Number(stmt?.summary?.totalPurchases || 0))}
                      </strong>
                    </div>
                    <div className="px-2 py-1.5 bg-white">
                      <span className="text-[10px] text-emerald-800 block">{t('سداد/مرتجعك', 'Your Paid/Returns')}</span>
                      <strong className="font-mono text-xs text-emerald-800">
                        {formatLocaleNumber(Number(stmt?.summary?.totalDebit || 0))}
                      </strong>
                    </div>
                    <div className="px-2 py-1.5 bg-white">
                      <span className="text-[10px] text-rose-800 block">{dirText}</span>
                      <strong className="font-mono text-xs text-rose-900">
                        {formatLocaleNumber(Math.abs(bal))}
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
                    emptyTitle={t('لا توجد حركات مسجلة لك مع هذا المورد', 'No transactions recorded for you with this supplier')}
                    columns={[
                      {
                        key: 'label',
                        header: t('العملية', 'Operation'),
                        render: (entry) => (
                          <div>
                            <span className="font-black text-slate-900 block">{t(entry.label)}</span>
                            <span className="font-mono text-[10px] text-slate-500 block">{entry.docNumber} · {entry.date}</span>
                            {entry.description && <span className="text-[10px] text-slate-500 block">{t(entry.description)}</span>}
                          </div>
                        ),
                      },
                      {
                        key: 'credit',
                        header: t('له (علينا)', 'Credit (We Owe)'),
                        align: 'center',
                        render: (entry) => <span className="font-mono text-rose-700">{entry.credit ? formatLocaleNumber(entry.credit) : '-'}</span>,
                      },
                      {
                        key: 'debit',
                        header: t('سداد/مرتجع', 'Paid/Return'),
                        align: 'center',
                        render: (entry) => <span className="font-mono text-emerald-700">{entry.debit ? formatLocaleNumber(entry.debit) : '-'}</span>,
                      },
                      {
                        key: 'runningBalance',
                        header: t('الرصيد', 'Balance'),
                        align: 'center',
                        render: (entry) => <strong className="font-mono text-[#011E58]">{formatLocaleNumber(Math.abs(Number(entry.runningBalance || 0)))}</strong>,
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
                  {t('تسجيل دفعة سداد', 'Record Payment')} — {payingPurchaseTarget.invoiceNumber}
                </h4>
                <p className="text-[10px] text-slate-500">
                  {payingPurchaseTarget.supplierName} · {t('المتبقي:', 'Remaining:')}{' '}
                  {formatLocaleNumber(Math.max(0, Number(payingPurchaseTarget.remainingAmount || 0)))} {t(data.settings.currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayingPurchaseTarget(null)}
                className="h-7 px-2 rounded-md text-[11px] bg-slate-100 font-bold text-slate-700 cursor-pointer shrink-0"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                {t('مبلغ السداد', 'Payment Amount')} ({t(data.settings.currency)}) *
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
                <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('طريقة السداد', 'Payment Method')}</label>
                <select
                  value={purPayMethod}
                  onChange={(e) => setPurPayMethod(e.target.value as any)}
                  className="w-full h-8 rounded-md border border-slate-300 px-2 bg-white font-bold"
                >
                  <option value="cash">{t('نقدي', 'Cash')}</option>
                  <option value="bank">{t('تحويل بنكي', 'Bank Transfer')}</option>
                  <option value="cheque">{t('شيك', 'Cheque')}</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-700 mb-0.5">{t('التاريخ', 'Date')}</label>
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
              placeholder={t('ملاحظات السداد (اختياري)...', 'Payment notes (optional)...')}
              className="w-full h-8 rounded-md border border-slate-300 px-2"
            />

            <button
              type="submit"
              disabled={isSubmittingPurPayment}
              className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isSubmittingPurPayment ? t('جاري التسجيل...', 'Submitting...') : t('تأكيد تسجيل دفعة السداد', 'Confirm Payment')}
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
        title={t('تأكيد حذف العميل', 'Confirm Customer Deletion')}
        message={
          deleteCustomerTarget
            ? t(
                `هل أنت متأكد من حذف العميل (${deleteCustomerTarget.shopName || deleteCustomerTarget.name})؟ يُسمح بالحذف فقط إذا لم يكن للعميل فواتير أو حركات مالية أو رصيد مفتوح.`,
                `Are you sure you want to delete (${deleteCustomerTarget.shopName || deleteCustomerTarget.name})? Deletion is only allowed if there are no invoices, financial transactions, or open balance.`
              )
            : ''
        }
        confirmLabel={t('نعم، حذف العميل', 'Yes, Delete Customer')}
      />
    </div>
  );
};

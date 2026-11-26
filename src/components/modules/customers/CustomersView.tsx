import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Plus, Phone, MapPin, FileText, 
  ArrowDownLeft, Printer, Download, Eye, Edit, Trash2, CheckCircle2, 
  Store, Camera, Upload, X, ArrowRight, ArrowLeft, 
  Wifi, WifiOff, RefreshCw, ShoppingCart, RotateCcw, 
  Receipt, AlertCircle, ShieldAlert, Sparkles, Link2, Wallet, CloudOff
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { apiRequest } from '../../../services/api';
import { getCurrentLocationSafe, parseLatLngCoords, reverseGeocodeCoords } from '../../../services/native';
import { Customer, CustomerPhoneEntry, Invoice, CustomerItemOrderRequest } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';
import { compressImageFileToDataUrl } from '../../../utils/image';
import { CustomersGroupIcon } from '../../common/AppIcons';
import { CustomerLocationPickerModal, PickedCustomerLocation } from '../../common/CustomerLocationPickerModal';
import { CustomerLocationViewerModal } from '../../common/CustomerLocationViewerModal';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { isZeroZeroLocation } from '../../../utils/storefront';
import type { NavItemKey } from '../../layout/Sidebar';

interface StatementRow {
  id: string;
  date: string;
  docNumber: string;
  type: 'رصيد أول المدة' | 'دفعة مقدمة على طلب' | 'فاتورة مبيعات' | 'سند قبض نقدية' | 'مرتجع مبيعات';
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

interface CustomersViewProps {
  onNavigate?: (page: NavItemKey) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ onNavigate }) => {
  const {
    customers, users, representatives, products = [], invoices, invoiceReturns, financialTransactions,
    cashboxes, settings, networkStatus, customerItemOrders = [], orderAdvancePayments = [], syncQueue = [],
    linkCustomerUser, repairUnlinkedCustomerUsers, toggleCustomerUserStatus,
    addCustomer, updateCustomer, deleteCustomer, recordCustomerPayment,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const { registerHandler, consumePendingAction } = useShortcuts();
  const { t, isRtl, language } = usePreferences();
  const isRepRole = currentUser?.role === 'representative';
  const canViewAggregateCustomerTotals =
    !isRepRole &&
    currentUser?.role !== 'customer' &&
    (currentUser?.role === 'admin' || hasPermission('canManageAccounts') || hasPermission('canViewReports'));

  // Navigation: main list vs dedicated customer page
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');
  const [classificationFilter, setClassificationFilter] = useState<'all' | 'app_and_direct' | 'app_only' | 'regular'>('all');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  // Payment modal state
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
  const [paymentCashboxId, setPaymentCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [isTogglingUserStatus, setIsTogglingUserStatus] = useState(false);
  const [customerBanner, setCustomerBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [phoneActionNotice, setPhoneActionNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [mapActionWarning, setMapActionWarning] = useState<string | null>(null);
  const [isLocatingGeo, setIsLocatingGeo] = useState(false);
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [locationViewerCustomer, setLocationViewerCustomer] = useState<Customer | null>(null);
  const [customerFormError, setCustomerFormError] = useState<string | null>(null);

  // Invoice view modal
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [previewShopPhoto, setPreviewShopPhoto] = useState<string | null>(null);

  // Print modal state
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Customer-User 1:1 Linking & Inline Creation State
  const [linkingCustomer, setLinkingCustomer] = useState<Customer | null>(null);
  const [linkMode, setLinkMode] = useState<'create' | 'existing'>('create');
  const [existingLinkUserId, setExistingLinkUserId] = useState('');
  const [newCustomerUsername, setNewCustomerUsername] = useState('');
  const [newCustomerPassword, setNewCustomerPassword] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [isRepairingUnlinked, setIsRepairingUnlinked] = useState(false);
  const [createPortalLogin, setCreatePortalLogin] = useState(false);
  const [portalUsername, setPortalUsername] = useState('');
  const [portalPassword, setPortalPassword] = useState('');
  const [conflicts, setConflicts] = useState<{ duplicatePhones: any[]; unlinkedCustomerUsers: any[] }>({
    duplicatePhones: [],
    unlinkedCustomerUsers: [],
  });

  useEffect(() => {
    if (cashboxes.length > 0 && (!paymentCashboxId || !cashboxes.some(c => c.id === paymentCashboxId))) {
      setPaymentCashboxId(cashboxes[0].id);
    }
  }, [cashboxes, paymentCashboxId]);

  useEffect(() => {
    if (!hasPermission('canManageUsers')) return;
    apiRequest<{ ok: boolean; duplicatePhones: any[]; unlinkedCustomerUsers: any[] }>('/api/customers/conflicts/check')
      .then((res) => {
        setConflicts({
          duplicatePhones: res.duplicatePhones || [],
          unlinkedCustomerUsers: res.unlinkedCustomerUsers || [],
        });
      })
      .catch(() => {});
  }, [customers.length, users.length, hasPermission]);

  // Form state for Add/Edit
  const [formData, setFormData] = useState<{
    code: string;
    name: string;
    shopName: string;
    phone: string;
    extraPhones: Array<{ id: string; phone: string; label: string }>;
    governorate: string;
    area: string;
    city: string;
    geoCoordinates: string;
    latitude?: number;
    longitude?: number;
    locationCapturedAt?: string;
    address: string;
    photo: string;
    clearShopPhoto: boolean;
    notes: string;
    openingBalance: number | '';
    status: 'active' | 'blocked';
    allowedRepIds: string[];
  }>({
    code: '',
    name: '',
    shopName: '',
    phone: '',
    extraPhones: [],
    governorate: '',
    area: '',
    city: '',
    geoCoordinates: '',
    latitude: undefined,
    longitude: undefined,
    locationCapturedAt: undefined,
    address: '',
    photo: '',
    clearShopPhoto: false,
    notes: '',
    openingBalance: '',
    status: 'active',
    allowedRepIds: [],
  });

  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Dedicated customer tabs
  const [detailTab, setDetailTab] = useState<'statement' | 'invoices' | 'orders' | 'advances' | 'payments' | 'returns' | 'prices'>('statement');

  // Get active selected customer
  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const orderInvoiceIds = useMemo(() => {
    const set = new Set<string>();
    for (const o of customerItemOrders) {
      if (o.invoiceId) set.add(o.invoiceId);
    }
    return set;
  }, [customerItemOrders]);

  const customerClassificationMap = useMemo(() => {
    const map = new Map<
      string,
      { key: 'app_and_direct' | 'app_only' | 'regular'; label: string; badgeClass: string }
    >();
    for (const c of customers) {
      const hasOrders = customerItemOrders.some((o) => o.customerId === c.id);
      const isApp = Boolean(c.userId) || hasOrders;
      const hasDirectSales = invoices.some(
        (inv) =>
          inv.type === 'sales' &&
          inv.status !== 'cancelled' &&
          inv.customerId === c.id &&
          !orderInvoiceIds.has(inv.id)
      );
      if (isApp && hasDirectSales) {
        map.set(c.id, {
          key: 'app_and_direct',
          label: t('عميل تطبيق ومبيعات مباشرة', 'App & Direct Sales Customer'),
          badgeClass: 'bg-[#DCE6F5] text-[#011E58] border border-[#B8CAE8]',
        });
      } else if (isApp) {
        map.set(c.id, {
          key: 'app_only',
          label: t('عميل تطبيق', 'App Customer'),
          badgeClass: 'bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5]',
        });
      } else {
        map.set(c.id, {
          key: 'regular',
          label: t('عميل عادي', 'Regular Customer'),
          badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
        });
      }
    }
    return map;
  }, [customers, customerItemOrders, invoices, orderInvoiceIds, t]);

  const tentativeCustomerIds = useMemo(() => {
    const set = new Set<string>();
    for (const op of syncQueue) {
      if (op.status === 'synced') continue;
      if (op.payload?.customerId) set.add(String(op.payload.customerId));
      if (op.payload?.partyId) set.add(String(op.payload.partyId));
      if (op.localId && op.entityType === 'customer') set.add(String(op.localId));
    }
    return set;
  }, [syncQueue]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const q = searchTerm.toLowerCase();
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.shopName && c.shopName.toLowerCase().includes(q)) ||
        (c.governorate && c.governorate.toLowerCase().includes(q)) ||
        (c.area && c.area.toLowerCase().includes(q)) ||
        c.phone.includes(searchTerm) ||
        (c.secondaryPhone && c.secondaryPhone.includes(searchTerm)) ||
        (Array.isArray(c.phones) && c.phones.some((p) => String(p.phone || p.number || '').includes(searchTerm))) ||
        c.code.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q);
      
      const matchStatus = statusFilter === 'all' || c.status === statusFilter;
      const clsKey = customerClassificationMap.get(c.id)?.key || 'regular';
      const matchClass = classificationFilter === 'all' || clsKey === classificationFilter;
      return matchSearch && matchStatus && matchClass;
    });
  }, [customers, searchTerm, statusFilter, classificationFilter, customerClassificationMap]);

  // Overall metrics (restricted to authorized finance/admin roles — never computed for representatives)
  const totalDebts = useMemo(() => {
    if (!canViewAggregateCustomerTotals) return 0;
    return customers.reduce((sum, c) => sum + (c.currentBalance > 0 ? c.currentBalance : 0), 0);
  }, [customers, canViewAggregateCustomerTotals]);

  const totalCredits = useMemo(() => {
    if (!canViewAggregateCustomerTotals) return 0;
    return customers.reduce((sum, c) => sum + (c.currentBalance < 0 ? Math.abs(c.currentBalance) : 0), 0);
  }, [customers, canViewAggregateCustomerTotals]);

  // Customer transactions for dedicated profile
  const selectedCustomerInvoices = useMemo(() => {
    if (!selectedCustomer) return [];
    return invoices
      .filter(i => i.customerId === selectedCustomer.id && i.type === 'sales')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedCustomer, invoices]);

  const selectedCustomerOrders = useMemo(() => {
    if (!selectedCustomer) return [];
    return customerItemOrders
      .filter((o) => o.customerId === selectedCustomer.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [selectedCustomer, customerItemOrders]);

  const selectedCustomerAdvances = useMemo(() => {
    if (!selectedCustomer) return [];
    return orderAdvancePayments
      .filter((a) => a.customerId === selectedCustomer.id)
      .sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''));
  }, [selectedCustomer, orderAdvancePayments]);

  const selectedCustomerPayments = useMemo(() => {
    if (!selectedCustomer) return [];
    const confirmedSaleIds = new Set(
      selectedCustomerInvoices
        .filter((inv) => inv.status === 'confirmed')
        .map((inv) => inv.id)
    );
    return financialTransactions
      .filter(
        (t) =>
          t.partyId === selectedCustomer.id &&
          t.type === 'customer_payment' &&
          !(t.relatedDocType === 'sales' && t.relatedDocId && confirmedSaleIds.has(t.relatedDocId))
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedCustomer, selectedCustomerInvoices, financialTransactions]);

  const selectedCustomerReturns = useMemo(() => {
    if (!selectedCustomer) return [];
    return invoiceReturns
      .filter(r => r.partyId === selectedCustomer.id && r.type === 'sales_return')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedCustomer, invoiceReturns]);

  // Comprehensive chronological statement calculations
  const chronologicalStatement = useMemo(() => {
    if (!selectedCustomer) return [];

    const events: Array<{
      id: string;
      date: string;
      docNumber: string;
      type: 'رصيد أول المدة' | 'دفعة مقدمة على طلب' | 'فاتورة مبيعات' | 'سند قبض نقدية' | 'مرتجع مبيعات';
      description: string;
      debit: number;
      credit: number;
      timestamp: number;
    }> = [];

    // 1. Opening balance
    if (selectedCustomer.openingBalance !== 0) {
      const isDebit = selectedCustomer.openingBalance > 0;
      events.push({
        id: 'opening-bal',
        date: selectedCustomer.createdAt ? selectedCustomer.createdAt.split('T')[0] : '2026-01-01',
        docNumber: t('افتتاحي', 'Opening'),
        type: 'رصيد أول المدة',
        description: t('الرصيد الافتتاحي المسجل عند تأسيس ملف العميل', 'Opening balance recorded when customer profile was created'),
        debit: isDebit ? selectedCustomer.openingBalance : 0,
        credit: !isDebit ? Math.abs(selectedCustomer.openingBalance) : 0,
        timestamp: new Date(selectedCustomer.createdAt || '2026-01-01').getTime(),
      });
    }

    // 2. Order advance payments (credited immediately on receipt; never double-counted on invoice conversion)
    selectedCustomerAdvances.forEach(adv => {
      if (adv.status !== 'refunded') {
        events.push({
          id: `adv-${adv.id}`,
          date: adv.date || (adv.createdAt ? adv.createdAt.split('T')[0] : ''),
          docNumber: adv.paymentNumber,
          type: 'دفعة مقدمة على طلب',
          description: `${t('دفعة مقدمة على طلب', 'Order advance payment')} (${adv.cashboxName || adv.cashboxId})${adv.notes ? ` — ${adv.notes}` : ''}`,
          debit: 0,
          credit: Number(adv.amount || 0),
          timestamp: new Date(adv.createdAt || adv.date || '2026-01-01').getTime(),
        });
      }
    });

    // 3. Sales invoices (credit ONLY cash paid at invoice time, excluding appliedAdvanceAmount which was already credited)
    selectedCustomerInvoices.forEach(inv => {
      if (inv.status === 'confirmed') {
        const appliedAdv = Number(inv.appliedAdvanceAmount || 0);
        const cashAtInv =
          inv.paidAtInvoice !== undefined
            ? Number(inv.paidAtInvoice)
            : Math.max(0, Number(inv.paidAmount || 0) - appliedAdv);
        events.push({
          id: inv.id,
          date: inv.date,
          docNumber: inv.invoiceNumber,
          type: 'فاتورة مبيعات',
          description: `${t('فاتورة مبيعات', 'Sales invoice')} (${inv.paymentType === 'cash' ? t('نقدي', 'Cash') : inv.paymentType === 'credit' ? t('آجل', 'Credit') : t('سداد جزئي', 'Partial')})${appliedAdv > 0 ? ` [${t('طبّقت دفعة مقدمة', 'Advance applied')} ${formatLocaleNumber(appliedAdv)}]` : ''} - ${inv.warehouseName}`,
          debit: inv.grandTotal,
          credit: cashAtInv > 0 ? cashAtInv : 0,
          timestamp: new Date(inv.createdAt || inv.date).getTime(),
        });
      }
    });

    // 4. Customer payment transactions (collected separately from invoice creation)
    selectedCustomerPayments.forEach(pay => {
      events.push({
        id: pay.id,
        date: pay.date,
        docNumber: pay.transactionNumber,
        type: 'سند قبض نقدية',
        description: `${t('تحصيل نقدي بالخزينة', 'Cash collection to cashbox')} (${pay.cashboxName}) - ${pay.notes || pay.description}`,
        debit: 0,
        credit: pay.amount,
        timestamp: new Date(pay.date).getTime(),
      });
    });

    // 5. Sales returns (credit customer balance ONLY when refundType === 'balance')
    selectedCustomerReturns.forEach(ret => {
      const retAmount = Number((ret as any).totalAmount ?? ret.grandTotal ?? 0);
      const balanceCredit = ret.refundType === 'balance' ? retAmount : 0;
      events.push({
        id: ret.id,
        date: ret.date,
        docNumber: ret.returnNumber,
        type: 'مرتجع مبيعات',
        description: `${t('مرتجع بضائع للفاتورة', 'Sales return for invoice')} (${ret.originalInvoiceNumber}) — ${ret.refundType === 'cash' ? t('رد نقدي من الخزينة بدون أثر على الرصيد', 'Cash refund from cashbox (no balance effect)') : t('خصم من رصيد العميل', 'Deducted from customer balance')} - ${ret.reason}`,
        debit: 0,
        credit: balanceCredit,
        timestamp: new Date(ret.date).getTime(),
      });
    });

    // Sort ascending by date
    events.sort((a, b) => a.timestamp - b.timestamp);

    // Compute running balance
    let current = 0;
    const rows: StatementRow[] = events.map(evt => {
      current = current + evt.debit - evt.credit;
      return {
        id: evt.id,
        date: evt.date,
        docNumber: evt.docNumber,
        type: evt.type,
        description: evt.description,
        debit: evt.debit,
        credit: evt.credit,
        runningBalance: current,
      };
    });

    return rows;
  }, [selectedCustomer, selectedCustomerAdvances, selectedCustomerInvoices, selectedCustomerPayments, selectedCustomerReturns, t]);

  // Open Add modal
  const handleOpenAdd = () => {
    const nextCode = `CUST-${(customers.length + 1001)}`;
    setFormData({
      code: nextCode,
      name: '',
      shopName: '',
      phone: '',
      extraPhones: [],
      governorate: '',
      area: '',
      city: '',
      geoCoordinates: '',
      latitude: undefined,
      longitude: undefined,
      locationCapturedAt: undefined,
      address: '',
      photo: '',
      clearShopPhoto: false,
      notes: '',
      openingBalance: '',
      status: 'active',
      allowedRepIds: [],
    });
    setPhoneActionNotice(null);
    setMapActionWarning(null);
    setCustomerFormError(null);
    setCreatePortalLogin(false);
    setPortalUsername('');
    setPortalPassword('');
    setEditingCustomer(null);
    setIsAddModalOpen(true);
  };

  // Open Edit modal
  const handleOpenEdit = (c: Customer, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPhoneActionNotice(null);
    setMapActionWarning(null);
    setCustomerFormError(null);
    const existingAllowed =
      Array.isArray(c.allowedRepIds) && c.allowedRepIds.length > 0
        ? c.allowedRepIds
        : c.assignedRepId
        ? [c.assignedRepId]
        : [];
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
    if (c.secondaryPhone && String(c.secondaryPhone).trim() !== primaryClean && !extras.some((ex) => ex.phone === String(c.secondaryPhone).trim())) {
      extras.unshift({
        id: 'ph-sec',
        phone: String(c.secondaryPhone).trim(),
        label: 'إضافي',
      });
    }
    setFormData({
      code: c.code,
      name: c.name,
      shopName: c.shopName || '',
      phone: c.phone,
      extraPhones: extras,
      governorate: c.governorate || '',
      area: c.area || '',
      city: c.city || '',
      geoCoordinates: c.geoCoordinates || '',
      latitude: c.latitude,
      longitude: c.longitude,
      locationCapturedAt: c.locationCapturedAt,
      address: c.address,
      photo: c.shopPhoto || c.photo || '',
      clearShopPhoto: false,
      notes: c.notes || '',
      openingBalance: c.openingBalance,
      status: c.status,
      allowedRepIds: existingAllowed,
    });
    setEditingCustomer(c);
    setIsAddModalOpen(true);
  };

  // Keyboard shortcuts registration for CustomersView
  const shortcutHandlersRef = useRef({
    openAdd: () => {},
    openCollection: () => {},
    printStatement: () => {},
  });

  shortcutHandlersRef.current.openAdd = () => {
    handleOpenAdd();
  };

  shortcutHandlersRef.current.openCollection = () => {
    const target = selectedCustomer || filteredCustomers[0] || customers[0] || null;
    if (!target) return;
    setPaymentError(null);
    setPaymentMethod('cash');
    setPaymentCustomer(target);
    setPaymentAmount(target.currentBalance > 0 ? target.currentBalance : '');
    setPaymentNotes('');
  };

  useEffect(() => {
    if (consumePendingAction('action:new_customer')) {
      shortcutHandlersRef.current.openAdd();
    }
    if (consumePendingAction('action:customer_collection')) {
      shortcutHandlersRef.current.openCollection();
    }
    const unregAdd = registerHandler('action:new_customer', () => shortcutHandlersRef.current.openAdd());
    const unregCol = registerHandler('action:customer_collection', () => shortcutHandlersRef.current.openCollection());
    const unregPrint = registerHandler('action:print_document', () => {
      if (selectedCustomer && !isPrintModalOpen) {
        shortcutHandlersRef.current.printStatement();
      }
    });
    return () => {
      unregAdd();
      unregCol();
      unregPrint();
    };
  }, [consumePendingAction, registerHandler, selectedCustomer, isPrintModalOpen]);

  // Handle Photo selection & compression
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setCustomerFormError(null);
      setIsUploadingPhoto(true);
      const base64 = await compressImageFileToDataUrl(file);
      setFormData(prev => ({ ...prev, photo: base64, clearShopPhoto: false }));
    } catch (err: any) {
      setCustomerFormError(err.message || t('حدث خطأ أثناء تحميل ومعالجة صورة المحل', 'Error uploading and processing shop photo'));
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = () => {
    setFormData(prev => ({ ...prev, photo: '', clearShopPhoto: true }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (galleryInputRef.current) {
      galleryInputRef.current.value = '';
    }
  };

  const handleCaptureCustomerGeo = async () => {
    setIsLocatingGeo(true);
    setMapActionWarning(null);
    try {
      const res = await getCurrentLocationSafe();
      if (!res.ok || !res.coords) {
        setMapActionWarning(res.error || t('تعذر الحصول على إحداثيات GPS من الجهاز.', 'Failed to get GPS coordinates from device.'));
        return;
      }
      setFormData((prev) => ({ ...prev, geoCoordinates: res.coords! }));
      const parsed = parseLatLngCoords(res.coords);
      if (parsed) {
        const rev = await reverseGeocodeCoords(parsed.lat, parsed.lng);
        if (rev.ok) {
          setFormData((prev) => ({
            ...prev,
            geoCoordinates: res.coords!,
            address: rev.address,
            area: prev.area.trim() ? prev.area : rev.area || prev.area,
            governorate: prev.governorate.trim() ? prev.governorate : rev.governorate || prev.governorate,
          }));
        } else {
          setMapActionWarning(rev.error);
        }
      }
    } finally {
      setIsLocatingGeo(false);
    }
  };

  // Save Customer (Add or Edit)
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingCustomer) return;
    setCustomerFormError(null);
    if (!formData.name.trim()) {
      setCustomerFormError(t('يرجى إدخال اسم المحل أو العميل', 'Please enter shop or customer name'));
      return;
    }
    if (!formData.phone.trim()) {
      setCustomerFormError(t('يرجى إدخال رقم الموبايل', 'Please enter mobile number'));
      return;
    }
    if (!formData.address.trim()) {
      setCustomerFormError(t('يرجى إدخال عنوان المحل بالتفصيل', 'Please enter detailed shop address'));
      return;
    }
    if (!editingCustomer && createPortalLogin) {
      if (!portalUsername.trim()) {
        setCustomerFormError(t('يرجى إدخال اسم المستخدم لحساب تطبيق العميل', 'Please enter username for customer app account'));
        return;
      }
      if (portalPassword.length < 6) {
        setCustomerFormError(t('كلمة مرور حساب العميل يجب أن تكون 6 أحرف على الأقل', 'Customer password must be at least 6 characters'));
        return;
      }
    }

    setIsSavingCustomer(true);
    try {
      const cleanPrimary = formData.phone.trim();
      const cleanExtras = formData.extraPhones
        .map((p, idx) => ({
          id: p.id || `ph-${idx + 1}`,
          phone: p.phone.trim(),
          label: p.label.trim() || 'إضافي',
          isPrimary: false,
        }))
        .filter((p) => p.phone && p.phone !== cleanPrimary);
      const consolidatedPhones: CustomerPhoneEntry[] = [
        { id: 'ph-primary', phone: cleanPrimary, label: 'رئيسي', isPrimary: true },
        ...cleanExtras,
      ];

      const parsedGeo = parseLatLngCoords(formData.geoCoordinates || '');
      const resolvedLat = formData.latitude ?? parsedGeo?.lat;
      const resolvedLng = formData.longitude ?? parsedGeo?.lng;
      if (isZeroZeroLocation(resolvedLat, resolvedLng)) {
        setCustomerFormError(t('إحداثيات الموقع (0, 0) غير صالحة — يرجى تحديد موقع حقيقي على الخريطة أو مسح الإحداثيات.', 'Location coordinates (0, 0) are invalid — please pick a valid location on map or clear coordinates.'));
        setIsSavingCustomer(false);
        return;
      }

      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, {
          name: formData.name.trim(),
          shopName: formData.shopName.trim() || undefined,
          phone: cleanPrimary,
          secondaryPhone: cleanExtras[0]?.phone || undefined,
          phones: consolidatedPhones,
          governorate: formData.governorate.trim() || undefined,
          area: formData.area.trim() || undefined,
          city: formData.city.trim() || undefined,
          geoCoordinates: formData.geoCoordinates.trim() || undefined,
          latitude: resolvedLat,
          longitude: resolvedLng,
          locationCapturedAt: formData.locationCapturedAt,
          address: formData.address.trim(),
          ...(formData.photo
            ? { photo: formData.photo, shopPhoto: formData.photo }
            : formData.clearShopPhoto
            ? { clearShopPhoto: true }
            : {}),
          notes: formData.notes.trim(),
          status: formData.status,
          allowedRepIds: formData.allowedRepIds,
          assignedRepId: formData.allowedRepIds[0] || undefined,
        });
        setCustomerBanner({ type: 'success', text: `${t('تم تحديث بيانات العميل', 'Updated customer')} (${formData.name.trim()}) ${t('بنجاح.', 'successfully.')}` });
      } else {
        const created = await addCustomer({
          code: formData.code.trim(),
          name: formData.name.trim(),
          shopName: formData.shopName.trim() || undefined,
          phone: cleanPrimary,
          secondaryPhone: cleanExtras[0]?.phone || undefined,
          phones: consolidatedPhones,
          governorate: formData.governorate.trim() || undefined,
          area: formData.area.trim() || undefined,
          city: formData.city.trim() || undefined,
          geoCoordinates: formData.geoCoordinates.trim() || undefined,
          latitude: resolvedLat,
          longitude: resolvedLng,
          locationCapturedAt: formData.locationCapturedAt,
          address: formData.address.trim(),
          photo: formData.photo || undefined,
          shopPhoto: formData.photo || undefined,
          notes: formData.notes.trim(),
          openingBalance: Number(formData.openingBalance) || 0,
          status: formData.status,
          allowedRepIds: formData.allowedRepIds,
          assignedRepId: formData.allowedRepIds[0] || undefined,
        });
        setSelectedCustomerId(created.id);

        if (createPortalLogin) {
          const linkRes = await linkCustomerUser(created.id, {
            createUser: {
              fullName: created.name,
              username: portalUsername.trim(),
              password: portalPassword,
              phone: created.phone,
            },
          });
          if (linkRes.success) {
            setCustomerBanner({
              type: 'success',
              text: `${t('تم تسجيل العميل', 'Registered customer')} (${created.name}) ${t('وإنشاء وربط حساب التطبيق', 'and created & linked app account')} (${portalUsername.trim()}) ${t('تلقائياً بنجاح.', 'successfully.')}`,
            });
          } else {
            setCustomerBanner({
              type: 'error',
              text: `${t('تم تسجيل العميل', 'Registered customer')} (${created.name})، ${t('لكن تعذر إنشاء حساب الدخول:', 'but login creation failed:')} ${linkRes.error || t('خطأ غير متوقع', 'Unexpected error')}`,
            });
          }
        } else {
          setCustomerBanner({ type: 'success', text: `${t('تم تسجيل العميل', 'Registered customer')} (${created.name}) ${t('في المنظومة بنجاح.', 'successfully.')}` });
        }
      }
      setIsAddModalOpen(false);
    } catch (err: any) {
      setCustomerFormError(err?.message || t('حدث خطأ أثناء حفظ بيانات العميل', 'Error saving customer details'));
    } finally {
      setIsSavingCustomer(false);
    }
  };

  // Delete Customer
  const handleDeleteCustomerClick = (cust: Customer, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDeleteErrorMessage(null);
    setCustomerToDelete(cust);
  };

  const handleConfirmDelete = async () => {
    if (!customerToDelete) return;

    const res = await deleteCustomer(customerToDelete.id);
    if (res.success) {
      if (selectedCustomerId === customerToDelete.id) {
        setSelectedCustomerId(null);
      }
      setCustomerToDelete(null);
    } else {
      setDeleteErrorMessage(res.error || t('تعذر حذف العميل لوجود معاملات مالية مرتبطة به.', 'Cannot delete customer with linked financial transactions.'));
    }
  };

  // Quick Payment collection
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentCustomer || isSubmittingPayment) return;
    setPaymentError(null);
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      setPaymentError(t('يرجى إدخال مبلغ تحصيل صحيح أكبر من صفر', 'Please enter a valid collection amount greater than zero'));
      return;
    }
    const numericPayAmt = Number(paymentAmount);
    if (!isRepRole && !paymentCashboxId) {
      setPaymentError(t('يرجى اختيار الخزينة المودع بها المبلغ', 'Please select deposit cashbox'));
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const methodLabel = paymentMethod === 'bank' ? t('تحويل بنكي', 'Bank Transfer') : paymentMethod === 'cheque' ? t('شيك', 'Cheque') : t('نقدي', 'Cash');
      const defaultNote = `${t('تحصيل', 'Collection')} (${methodLabel}) ${t('من الحساب', 'from account')}`;
      const res = await recordCustomerPayment(
        paymentCustomer.id,
        numericPayAmt,
        isRepRole ? '' : paymentCashboxId,
        paymentNotes.trim() || defaultNote,
        paymentMethod
      );

      if (res.success) {
        const nextBalance = paymentCustomer.currentBalance - numericPayAmt;
        setPrintData({
          title: `${t('سند قبض', 'Receipt Voucher')} (${methodLabel}) ${t('من عميل', 'from Customer')}`,
          docNumber: `REC-${Date.now().toString().slice(-6)}`,
          docType: 'سند قبض',
          date: new Date().toISOString().split('T')[0],
          partyName: paymentCustomer.name,
          partyPhone: paymentCustomer.phone,
          partyAddress: paymentCustomer.address,
          grandTotal: numericPayAmt,
          paidAmount: numericPayAmt,
          previousBalance: paymentCustomer.currentBalance,
          currentBalance: nextBalance,
          notes:
            nextBalance < 0
              ? `${paymentNotes.trim() || defaultNote} | ${t('رصيد دائن للعميل (دفعة مقدمة):', 'Customer credit balance (advance):')} ${formatLocaleNumber(Math.abs(nextBalance))} ${t(settings.currency)}`
              : paymentNotes.trim() || t('تم تحصيل المبلغ وإيداعه في الخزينة المعتمدة بنجاح.', 'Amount collected and deposited to cashbox successfully.'),
        });
        setIsPrintModalOpen(true);
        setPaymentError(null);
        setPaymentCustomer(null);
        setPaymentAmount('');
        setPaymentNotes('');
        setPaymentMethod('cash');
        setCustomerBanner({ type: 'success', text: `${t('تم تحصيل مبلغ', 'Collected')} ${formatLocaleNumber(numericPayAmt)} ${t(settings.currency)} ${t('من العميل', 'from customer')} (${paymentCustomer.name}) ${t('بنجاح.', 'successfully.')}` });
      } else {
        setPaymentError(res.error || t('تعذر تسجيل الدفعة', 'Failed to record payment'));
      }
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Print Statement
  const handlePrintStatement = () => {
    if (!selectedCustomer) return;
    setPrintData({
      title: t('كشف حساب عميل مفصل ومعتمد', 'Detailed Verified Customer Statement'),
      docNumber: selectedCustomer.code,
      docType: 'كشف حساب',
      date: new Date().toISOString().split('T')[0],
      partyName: selectedCustomer.name,
      partyPhone: selectedCustomer.phone,
      partyAddress: selectedCustomer.address,
      grandTotal: selectedCustomer.currentBalance,
      currentBalance: selectedCustomer.currentBalance,
      tableHeaders: [t('م', '#'), t('نوع الحركة والبيان', 'Type & Details'), t('التاريخ', 'Date'), t('العدد', 'Qty'), t('مدين (+)', 'Debit (+)'), t('دائن (-)', 'Credit (-)'), t('الرصيد التراكمي', 'Running Balance')],
      notes: `${t('رصيد أول المدة:', 'Opening balance:')} ${formatLocaleNumber(selectedCustomer.openingBalance)} ${t(settings.currency)} | ${t('إجمالي عدد الحركات:', 'Total entries:')} ${chronologicalStatement.length}`,
      items: chronologicalStatement.map(row => ({
        name: `${t(row.type, row.type === 'رصيد أول المدة' ? 'Opening Balance' : row.type === 'دفعة مقدمة على طلب' ? 'Order Advance' : row.type === 'فاتورة مبيعات' ? 'Sales Invoice' : row.type === 'سند قبض نقدية' ? 'Cash Receipt' : 'Sales Return')} (${row.docNumber}) - ${row.description}`,
        unit: row.date,
        quantity: 1,
        price: row.debit > 0 ? row.debit : 0,
        discount: row.credit > 0 ? row.credit : 0,
        total: row.runningBalance,
      })),
    });
    setIsPrintModalOpen(true);
  };
  shortcutHandlersRef.current.printStatement = handlePrintStatement;

  const handlePrintCustomerCard = () => {
    if (!selectedCustomer) return;
    setPrintData({
      title: t('بطاقة بيانات عميل / محل غذائي', 'Customer / Store Profile Card'),
      docNumber: selectedCustomer.code,
      docType: 'كشف حساب',
      date: new Date().toISOString().split('T')[0],
      partyName: selectedCustomer.shopName ? `${selectedCustomer.name} — ${selectedCustomer.shopName}` : selectedCustomer.name,
      partyPhone: [selectedCustomer.phone, selectedCustomer.secondaryPhone].filter(Boolean).join(' / '),
      partyAddress: [selectedCustomer.area, selectedCustomer.address].filter(Boolean).join(' - '),
      previousBalance: selectedCustomer.openingBalance,
      currentBalance: selectedCustomer.currentBalance,
      grandTotal: Math.abs(selectedCustomer.currentBalance),
      tableHeaders: [t('م', '#'), t('بند البيانات', 'Item'), t('القيمة', 'Count'), t('العدد', 'Qty'), t('القيمة الإجمالية', 'Total Value'), t('الخصم', 'Discount'), t('الرصيد', 'Total')],
      items: [
        { name: t('إجمالي فواتير المبيعات', 'Total Sales Invoices'), unit: `${selectedCustomerInvoices.length} ${t('فاتورة', 'invoices')}`, quantity: selectedCustomerInvoices.length, price: 0, discount: 0, total: selectedCustomerInvoices.reduce((a, b) => a + b.grandTotal, 0) },
        { name: t('إجمالي التحصيلات المستلمة', 'Total Receipts Collected'), unit: `${selectedCustomerPayments.length} ${t('سند', 'receipts')}`, quantity: selectedCustomerPayments.length, price: 0, discount: 0, total: selectedCustomerPayments.reduce((a, b) => a + b.amount, 0) },
        { name: t('إجمالي المرتجعات', 'Total Returns'), unit: `${selectedCustomerReturns.length} ${t('مرتجع', 'returns')}`, quantity: selectedCustomerReturns.length, price: 0, discount: 0, total: selectedCustomerReturns.reduce((a, b) => a + b.grandTotal, 0) },
      ],
      notes: selectedCustomer.notes || `${t('حالة العميل:', 'Customer status:')} ${selectedCustomer.status === 'active' ? t('نشط', 'Active') : t('محظور', 'Blocked')}`,
    });
    setIsPrintModalOpen(true);
  };

  // Export Statement to Excel
  const handleExportStatementExcel = () => {
    if (!selectedCustomer) return;
    const headers = [t('التاريخ', 'Date'), t('رقم المستند', 'Doc #'), t('نوع الحركة', 'Type'), t('البيان والتفاصيل', 'Details'), t('مدين (+)', 'Debit (+)'), t('دائن (-)', 'Credit (-)'), t('الرصيد التراكمي', 'Running Balance')];
    const rows = chronologicalStatement.map(r => [
      r.date,
      r.docNumber,
      t(r.type, r.type === 'رصيد أول المدة' ? 'Opening Balance' : r.type === 'دفعة مقدمة على طلب' ? 'Order Advance' : r.type === 'فاتورة مبيعات' ? 'Sales Invoice' : r.type === 'سند قبض نقدية' ? 'Cash Receipt' : 'Sales Return'),
      r.description,
      r.debit,
      r.credit,
      r.runningBalance,
    ]);
    exportToExcel(`${t('كشف_حساب', 'Statement')}_${selectedCustomer.name}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handleExportStatementPdf = () => {
    if (!selectedCustomer) return;
    exportTableToPdf(
      `${t('كشف حساب العميل', 'Customer Statement')} (${selectedCustomer.name})`,
      [t('التاريخ', 'Date'), t('رقم المستند', 'Doc #'), t('نوع الحركة', 'Type'), t('البيان والتفاصيل', 'Details'), t('مدين (+)', 'Debit (+)'), t('دائن (-)', 'Credit (-)'), t('الرصيد التراكمي', 'Running Balance')],
      chronologicalStatement.map(r => [
        r.date,
        r.docNumber,
        t(r.type, r.type === 'رصيد أول المدة' ? 'Opening Balance' : r.type === 'دفعة مقدمة على طلب' ? 'Order Advance' : r.type === 'فاتورة مبيعات' ? 'Sales Invoice' : r.type === 'سند قبض نقدية' ? 'Cash Receipt' : 'Sales Return'),
        r.description,
        r.debit,
        r.credit,
        r.runningBalance,
      ]),
      {
        companyName: settings.companyName,
        docNumber: selectedCustomer.code,
        dateRangeText: new Date().toISOString().split('T')[0],
        meta: [
          { label: t('اسم العميل', 'Customer Name'), value: selectedCustomer.name },
          { label: t('الموبايل', 'Mobile'), value: selectedCustomer.phone },
          { label: t('الرصيد الحالي', 'Current Balance'), value: `${formatLocaleNumber(selectedCustomer.currentBalance)} ${t(settings.currency)}` },
        ],
        notes: `${t('رصيد أول المدة:', 'Opening balance:')} ${formatLocaleNumber(selectedCustomer.openingBalance)} ${t(settings.currency)} | ${t('إجمالي عدد الحركات:', 'Total entries:')} ${chronologicalStatement.length}`,
      }
    );
  };

  // Print Invoice from Customer Profile
  const handlePrintSingleInvoice = (inv: Invoice) => {
    setPrintData({
      title: t('فاتورة مبيعات سلع غذائية', 'Sales Invoice'),
      docNumber: inv.invoiceNumber,
      docType: 'فاتورة مبيعات',
      date: inv.date,
      partyName: inv.customerName,
      partyPhone: selectedCustomer?.phone || '',
      partyAddress: selectedCustomer?.address || '',
      warehouseName: inv.warehouseName,
      representativeName: inv.representativeName,
      paymentType: inv.paymentType === 'cash' ? t('نقدي', 'Cash') : inv.paymentType === 'credit' ? t('آجل', 'Credit') : t('سداد جزئي', 'Partial'),
      items: inv.items.map(item => ({
        name: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        price: item.unitPrice,
        discount: item.discount,
        total: item.total,
      })),
      subtotal: inv.subtotal,
      discountTotal: inv.discountTotal,
      taxTotal: inv.taxTotal,
      grandTotal: inv.grandTotal,
      paidAmount: inv.paidAmount,
      remainingAmount: inv.remainingAmount,
      notes: inv.notes,
    });
    setIsPrintModalOpen(true);
  };

  return (
    <div className="space-y-2">
      {customerBanner && (
        <div
          className={`px-2.5 py-1.5 rounded-md border text-xs font-bold flex items-center justify-between gap-2 ${
            customerBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{customerBanner.text}</span>
          <button type="button" onClick={() => setCustomerBanner(null)} className="underline text-[11px] cursor-pointer">
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {selectedCustomer ? (() => {
        const isDebtor = selectedCustomer.currentBalance > 0;
        const isCreditor = selectedCustomer.currentBalance < 0;
        const linkedUser = selectedCustomer.userId ? users.find((u) => u.id === selectedCustomer.userId) : undefined;

        return (
          <div className="space-y-2 animate-in fade-in duration-200">
        {/* Navigation Breadcrumb Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedCustomerId(null)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all active:scale-95 cursor-pointer"
            >
              {isRtl ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
              <span>{t('العودة لدليل العملاء', 'Back to Customers Directory')}</span>
            </button>
            <span className="text-slate-300">/</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono font-bold text-[#011E58] bg-[#EEF3FA] px-2 py-0.5 rounded border border-[#DCE6F5]">
                {selectedCustomer.code}
              </span>
              <h2 className="text-sm font-black text-slate-900">{selectedCustomer.name}</h2>
            </div>
          </div>

          {/* Offline / Online Network Indicator */}
          <div className="flex items-center gap-2 text-xs font-bold">
            {networkStatus === 'disconnected' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[11px]">
                <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                <span>{t('وضع عدم الاتصال (Offline) - حفظ فوري ومزامنة تلقائية', 'Offline Mode - Instant save & auto sync')}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px]">
                <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                <span>{t('متصل بالإنترنت - البيانات متزامنة محلياً', 'Online - Data synced locally')}</span>
              </span>
            )}
          </div>
        </div>

        {/* Dedicated Store Profile Header Card */}
        <div className="bg-white rounded-lg border border-slate-200 p-2.5 overflow-hidden relative">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5">
            {/* Store Photo & Shop Details */}
            <div className="flex items-start sm:items-center gap-2.5">
              <div className="relative group shrink-0">
                {(selectedCustomer.shopPhoto || selectedCustomer.photo) ? (
                  <button
                    type="button"
                    onClick={() => setPreviewShopPhoto(selectedCustomer.shopPhoto || selectedCustomer.photo || null)}
                    className="cursor-pointer block focus:outline-hidden"
                    title={t('اضغط لعرض صورة المحل بالحجم الكامل', 'Click to view full-size shop photo')}
                  >
                    <img
                      src={selectedCustomer.shopPhoto || selectedCustomer.photo}
                      alt={selectedCustomer.name}
                      className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg object-cover border border-slate-200 bg-slate-50 transition-transform group-hover:scale-105"
                    />
                  </button>
                ) : (
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-[#EEF3FA] border border-dashed border-[#DCE6F5] flex flex-col items-center justify-center text-[#011E58]">
                    <Store className="w-5 h-5 stroke-[1.5]" />
                    <span className="text-[9px] font-bold text-slate-400">{t('بلا صورة', 'No Photo')}</span>
                  </div>
                )}
                <span className={`absolute -bottom-1 -end-1 px-1.5 py-0.5 rounded text-[9px] font-black border ${
                  selectedCustomer.status === 'active' 
                    ? 'bg-emerald-600 text-white border-white' 
                    : 'bg-red-600 text-white border-white'
                }`}>
                  {selectedCustomer.status === 'active' ? t('محل نشط', 'Active Shop') : t('محظور', 'Blocked')}
                </span>
              </div>

              {/* Shop & Contact Meta */}
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                    {selectedCustomer.shopName || selectedCustomer.name}
                  </h1>
                  {selectedCustomer.shopName && selectedCustomer.name && selectedCustomer.shopName !== selectedCustomer.name && (
                    <span className="text-xs font-bold text-slate-500">({selectedCustomer.name})</span>
                  )}
                  <span className="font-mono text-xs font-bold text-[#011E58] bg-[#EEF3FA] px-2 py-0.5 rounded border border-[#DCE6F5]">
                    {selectedCustomer.code}
                  </span>
                  {(selectedCustomer.governorate || selectedCustomer.area) && (
                    <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">
                      {[selectedCustomer.governorate, selectedCustomer.area].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {(() => {
                    const cls = customerClassificationMap.get(selectedCustomer.id);
                    return cls ? (
                      <span className={`text-[11px] font-black px-2 py-0.5 rounded-md ${cls.badgeClass}`}>
                        {cls.label}
                      </span>
                    ) : null;
                  })()}
                  {tentativeCustomerIds.has(selectedCustomer.id) && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300">
                      <CloudOff className="w-3 h-3" />
                      <span>{t('رصيد محلي مبدئي لحين المزامنة', 'Tentative local balance pending sync')}</span>
                    </span>
                  )}
                </div>

                {/* Direct Call (all phones) & Google Maps Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {(() => {
                    const allPhones: CustomerPhoneEntry[] =
                      Array.isArray(selectedCustomer.phones) && selectedCustomer.phones.length > 0
                        ? selectedCustomer.phones
                        : [
                            ...(selectedCustomer.phone
                              ? [{ id: 'p-1', phone: selectedCustomer.phone, label: 'رئيسي', isPrimary: true }]
                              : []),
                            ...(selectedCustomer.secondaryPhone
                              ? [{ id: 'p-2', phone: selectedCustomer.secondaryPhone, label: 'إضافي', isPrimary: false }]
                              : []),
                          ];
                    return allPhones.map((ph, idx) => {
                      const rawPhone = String(ph.phone || ph.number || '').trim();
                      const clean = rawPhone.replace(/[^\d+]/g, '');
                      if (clean.replace(/\D/g, '').length < 5) return null;
                      const phoneLabelDisplay = ph.label ? t(ph.label) : '';
                      return (
                        <a
                          key={ph.id || idx}
                          href={`tel:${clean}`}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono font-black border transition-all active:scale-95 cursor-pointer ${
                            ph.isPrimary || idx === 0
                              ? 'bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border-[#DCE6F5]'
                              : 'bg-slate-50 hover:bg-slate-100 text-[#003589] border-slate-200'
                          }`}
                          title={t(`اتصال مباشر (${phoneLabelDisplay || 'هاتف'})`, `Direct call (${phoneLabelDisplay || 'Phone'})`)}
                        >
                          <Phone className="w-3.5 h-3.5 shrink-0" />
                          <span dir="ltr">{rawPhone}</span>
                          {phoneLabelDisplay && (
                            <span className="font-sans text-[10px] opacity-80">({phoneLabelDisplay})</span>
                          )}
                        </a>
                      );
                    });
                  })()}

                  {/* Read-Only Google Maps Location Viewer Button */}
                  <button
                    type="button"
                    onClick={() => setLocationViewerCustomer(selectedCustomer)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-bold border border-[#DCE6F5] transition-all cursor-pointer text-start"
                    title={t('عرض موقع المحل المسجل على الخريطة', 'View registered shop location on map')}
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#003589] shrink-0" />
                    <span className="whitespace-normal break-words">{selectedCustomer.address || t('عرض الموقع', 'View Location')}</span>
                  </button>
                </div>

                {selectedCustomer.notes && (
                  <p className="text-xs text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-md border border-slate-100 max-w-xl">
                    <span className="font-bold text-slate-700 me-1">{t('ملاحظات:', 'Notes:')}</span>
                    {selectedCustomer.notes}
                  </p>
                )}
              </div>
            </div>

            {/* Quick Actions in Customer Profile */}
            <div className="flex flex-wrap items-center gap-1.5 self-stretch md:self-auto justify-end">
              <button
                onClick={() => {
                  setPaymentError(null);
                  setPaymentMethod('cash');
                  setPaymentNotes('');
                  setPaymentCustomer(selectedCustomer);
                  setPaymentAmount(selectedCustomer.currentBalance > 0 ? selectedCustomer.currentBalance : 0);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black active:scale-95 transition-all cursor-pointer"
              >
                <ArrowDownLeft className="w-3.5 h-3.5" />
                <span>{t('تسجيل تحصيل نقدية', 'Record Cash Collection')}</span>
              </button>

              <button
                onClick={(e) => handleOpenEdit(selectedCustomer, e)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#011E58] hover:bg-[#002160] text-white rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
              >
                <Edit className="w-3.5 h-3.5" />
                <span>{t('تعديل البيانات والصورة', 'Edit Info & Photo')}</span>
              </button>

              {hasPermission('canManageUsers') && (
                <button
                  onClick={() => {
                    setLinkError(null);
                    setLinkMode('create');
                    setExistingLinkUserId('');
                    setNewCustomerUsername('');
                    setNewCustomerPassword('');
                    setLinkingCustomer(selectedCustomer);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer ${
                    selectedCustomer.userId
                      ? 'bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] hover:bg-[#DCE6F5]'
                      : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>{selectedCustomer.userId ? t('تغيير ربط حساب التطبيق', 'Change App Account Link') : t('ربط / إنشاء حساب دخول للعميل', 'Link / Create Customer Login')}</span>
                </button>
              )}

              {selectedCustomer.userId && linkedUser && hasPermission('canManageUsers') && (
                <button
                  type="button"
                  disabled={isTogglingUserStatus}
                  onClick={async () => {
                    setIsTogglingUserStatus(true);
                    try {
                      const nextActive = linkedUser.isActive === false;
                      const res = await toggleCustomerUserStatus(selectedCustomer.id, nextActive);
                      if (res.success) {
                        setCustomerBanner({
                          type: 'success',
                          text: nextActive
                            ? t(`تم تفعيل حساب دخول العميل (${linkedUser.username}) بنجاح.`, `Customer login account (${linkedUser.username}) activated successfully.`)
                            : t(`تم إيقاف حساب دخول العميل (${linkedUser.username}) بنجاح.`, `Customer login account (${linkedUser.username}) suspended successfully.`),
                        });
                      } else {
                        setCustomerBanner({ type: 'error', text: res.error ? t(res.error) : t('تعذر تغيير حالة حساب الدخول', 'Unable to change login account status') });
                      }
                    } finally {
                      setIsTogglingUserStatus(false);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold border cursor-pointer disabled:opacity-50 ${
                    linkedUser.isActive === false
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                  }`}
                  title={t(`حساب الدخول: ${linkedUser.username}`, `Login account: ${linkedUser.username}`)}
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{linkedUser.isActive === false ? t('تفعيل حساب الدخول', 'Activate Login') : t('إيقاف حساب الدخول', 'Suspend Login')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handlePrintCustomerCard}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title={t('طباعة بطاقة العميل', 'Print Customer Card')}
              >
                <Printer className="w-3.5 h-3.5 text-[#003589]" />
                <span>{t('بطاقة العميل', 'Customer Card')}</span>
              </button>

              <button
                type="button"
                onClick={handlePrintStatement}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title={t('طباعة كشف الحساب', 'Print Account Statement')}
              >
                <Printer className="w-3.5 h-3.5 text-slate-600" />
                <span>{t('طباعة', 'Print')}</span>
              </button>

              <button
                type="button"
                onClick={handleExportStatementExcel}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title={t('تصدير كشف الحساب Excel', 'Export Statement to Excel')}
              >
                <Download className="w-3.5 h-3.5 text-[#003589]" />
                <span>Excel</span>
              </button>

              <button
                type="button"
                onClick={handleExportStatementPdf}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title={t('تصدير كشف الحساب PDF', 'Export Statement to PDF')}
              >
                <FileText className="w-3.5 h-3.5 text-[#003589]" />
                <span>PDF</span>
              </button>

              <button
                onClick={(e) => handleDeleteCustomerClick(selectedCustomer, e)}
                className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition-all cursor-pointer"
                title={t('حذف العميل وفق الصلاحيات', 'Delete customer according to permissions')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Financial KPI Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden mt-2 text-xs">
            {/* Current Balance */}
            <div className={`px-2.5 py-1.5 ${
              isDebtor ? 'bg-red-50/70' : isCreditor ? 'bg-emerald-50/70' : 'bg-white'
            }`}>
              <span className="text-[11px] font-bold text-slate-600 block">
                {t('الرصيد الحالي المستحق', 'Current Balance Due')}
                {tentativeCustomerIds.has(selectedCustomer.id) ? t(' (مبدئي)', ' (Tentative)') : ''}
              </span>
              <div className={`text-sm font-black font-mono tabular-nums ${
                isDebtor ? 'text-red-700' : isCreditor ? 'text-emerald-700' : 'text-slate-800'
              }`}>
                {formatLocaleNumber(selectedCustomer.currentBalance)} {t(settings.currency)}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                {isDebtor ? t('(مديونية مستحقة للشركة)', '(Debt owed to company)') : isCreditor ? t('(رصيد دائن مدفوع مقدماً)', '(Prepaid credit balance)') : t('(الحساب خالص ومتوازن)', '(Account settled & balanced)')}
                {tentativeCustomerIds.has(selectedCustomer.id) ? t(' · بانتظار اعتماد المزامنة', ' · Pending sync confirmation') : ''}
              </span>
            </div>

            {/* Total Sales Value */}
            <div className="px-2.5 py-1.5 bg-white">
              <span className="text-[11px] font-bold text-slate-600 block">{t('إجمالي المبيعات والفواتير', 'Total Sales & Invoices')}</span>
              <div className="text-sm font-black font-mono tabular-nums text-blue-950">
                {formatLocaleNumber(selectedCustomerInvoices.reduce((a, b) => a + b.grandTotal, 0))} {t(settings.currency)}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                {t(`عدد ${selectedCustomerInvoices.length} فاتورة مبيعات`, `${selectedCustomerInvoices.length} sales invoices`)}
              </span>
            </div>

            {/* Total Payments Collected */}
            <div className="px-2.5 py-1.5 bg-white">
              <span className="text-[11px] font-bold text-slate-600 block">{t('إجمالي التحصيلات والدفعات المقدمة', 'Total Collections & Advance Payments')}</span>
              <div className="text-sm font-black font-mono tabular-nums text-emerald-800">
                {formatLocaleNumber(
                  selectedCustomerPayments.reduce((a, b) => a + b.amount, 0) +
                  selectedCustomerAdvances.filter(a => a.status !== 'refunded').reduce((a, b) => a + b.amount, 0) +
                  selectedCustomerInvoices.reduce((a, b) => {
                    if (b.status !== 'confirmed') return a;
                    const cashAtInv = b.paidAtInvoice !== undefined ? b.paidAtInvoice : Math.max(0, b.paidAmount - (b.appliedAdvanceAmount || 0));
                    return a + cashAtInv;
                  }, 0)
                )} {t(settings.currency)}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                {t('سندات قبض + دفعات طلبات مقدمة + مدفوع فواتير', 'Receipts + Order advances + Paid on invoices')}
              </span>
            </div>

            {/* Total Returns */}
            <div className="px-2.5 py-1.5 bg-white">
              <span className="text-[11px] font-bold text-slate-600 block">{t('إجمالي المرتجعات', 'Total Returns')}</span>
              <div className="text-sm font-black font-mono tabular-nums text-amber-800">
                {formatLocaleNumber(selectedCustomerReturns.reduce((a, b) => a + b.grandTotal, 0))} {t(settings.currency)}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                {t(`عدد ${selectedCustomerReturns.length} حركة مرتجع`, `${selectedCustomerReturns.length} return transactions`)}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation in Dedicated Profile */}
        <div className="bg-white rounded-lg border border-slate-200 p-1 flex flex-wrap gap-1 text-xs">
          <button
            onClick={() => setDetailTab('statement')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-black transition-all cursor-pointer ${
              detailTab === 'statement'
                ? 'bg-[#011E58] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{t('كشف الحساب المالي المفصل', 'Detailed Account Statement')} ({chronologicalStatement.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('invoices')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-black transition-all cursor-pointer ${
              detailTab === 'invoices'
                ? 'bg-[#011E58] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>{t('فواتير المبيعات', 'Sales Invoices')} ({selectedCustomerInvoices.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('orders')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-black transition-all cursor-pointer ${
              detailTab === 'orders'
                ? 'bg-[#011E58] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>{t('الطلبات', 'Orders')} ({selectedCustomerOrders.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('advances')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-black transition-all cursor-pointer ${
              detailTab === 'advances'
                ? 'bg-[#011E58] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>{t('الدفعات المقدمة', 'Advance Payments')} ({selectedCustomerAdvances.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('payments')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-black transition-all cursor-pointer ${
              detailTab === 'payments'
                ? 'bg-[#011E58] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>{t('سندات القبض والتحصيلات', 'Receipts & Collections')} ({selectedCustomerPayments.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('returns')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-black transition-all cursor-pointer ${
              detailTab === 'returns'
                ? 'bg-[#011E58] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('المرتجعات', 'Returns')} ({selectedCustomerReturns.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('prices')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-black transition-all cursor-pointer ${
              detailTab === 'prices'
                ? 'bg-[#011E58] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('تاريخ أسعار المنتجات المشتراة', 'Purchased Product Price History')}</span>
          </button>
        </div>

        {/* Tab 1: Comprehensive Account Statement */}
        {detailTab === 'statement' && (
          <UnifiedDataTable<StatementRow>
            title={t('دفتر أستاذ كشف الحساب التراكمي (Ledger)', 'Cumulative Account Statement Ledger')}
            subtitle={t('كافة قيود الفواتير والتحصيلات والمرتجعات مرتبة زمنياً لحساب الرصيد المستحق بدقة', 'All invoices, collections, and returns ordered chronologically to calculate due balance accurately')}
            data={chronologicalStatement}
            rowKey={(r) => r.id}
            compact
            searchPlaceholder={t('بحث في كشف الحساب برقم المستند أو البيان...', 'Search statement by doc # or description...')}
            searchFilter={(r, q) =>
              r.docNumber.toLowerCase().includes(q) ||
              r.type.toLowerCase().includes(q) ||
              t(r.type).toLowerCase().includes(q) ||
              r.description.toLowerCase().includes(q) ||
              r.date.includes(q)
            }
            headerActions={
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleExportStatementExcel}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-300 text-xs font-bold hover:bg-slate-50 text-slate-800 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#003589]" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportStatementPdf}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-xs font-bold hover:bg-[#DCE6F5] text-[#011E58] cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-[#003589]" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrintStatement}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#003589] text-white text-xs font-bold hover:bg-[#0049B0] cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{t('طباعة كشف الحساب', 'Print Statement')}</span>
                </button>
              </div>
            }
            columns={[
              {
                key: 'date',
                header: t('التاريخ', 'Date'),
                sortable: true,
                sortValue: (r) => r.date,
                exportValue: (r) => r.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (r) => r.date,
              },
              {
                key: 'docNumber',
                header: t('رقم المستند', 'Doc #'),
                sortable: true,
                sortValue: (r) => r.docNumber,
                exportValue: (r) => r.docNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (r) => r.docNumber,
              },
              {
                key: 'type',
                header: t('نوع الحركة', 'Transaction Type'),
                sortable: true,
                sortValue: (r) => t(r.type),
                exportValue: (r) => t(r.type),
                render: (r) => (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      r.type === 'فاتورة مبيعات'
                        ? 'bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5]'
                        : r.type === 'سند قبض نقدية'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : r.type === 'دفعة مقدمة على طلب'
                        ? 'bg-[#DCE6F5] text-[#003589] border border-[#B8CAE8]'
                        : r.type === 'مرتجع مبيعات'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {t(r.type)}
                  </span>
                ),
              },
              {
                key: 'description',
                header: t('البيان والشرح', 'Description'),
                exportValue: (r) => r.description,
                cellClassName: 'text-slate-700 max-w-xs',
                render: (r) => r.description,
              },
              {
                key: 'debit',
                header: t('مدين (+) [دين جديد]', 'Debit (+) [New Debt]'),
                align: 'center',
                sortable: true,
                sortValue: (r) => r.debit,
                exportValue: (r) => r.debit,
                cellClassName: 'font-mono font-bold text-red-700 tabular-nums',
                render: (r) => (r.debit > 0 ? formatLocaleNumber(r.debit) : '-'),
              },
              {
                key: 'credit',
                header: t('دائن (-) [سداد]', 'Credit (-) [Payment]'),
                align: 'center',
                sortable: true,
                sortValue: (r) => r.credit,
                exportValue: (r) => r.credit,
                cellClassName: 'font-mono font-bold text-emerald-700 tabular-nums',
                render: (r) => (r.credit > 0 ? formatLocaleNumber(r.credit) : '-'),
              },
              {
                key: 'runningBalance',
                header: t('الرصيد التراكمي', 'Running Balance'),
                align: 'center',
                sortable: true,
                sortValue: (r) => r.runningBalance,
                exportValue: (r) => r.runningBalance,
                cellClassName: 'font-mono font-black tabular-nums whitespace-nowrap',
                render: (r) => (
                  <span className={r.runningBalance > 0 ? 'text-red-700' : r.runningBalance < 0 ? 'text-emerald-700' : 'text-slate-800'}>
                    {formatLocaleNumber(r.runningBalance)} {t(settings.currency)}
                  </span>
                ),
              },
            ]}
            footerTotalsRow={
              chronologicalStatement.length > 0 ? (
                <tr className="bg-blue-950/5 font-black text-slate-900 border-t-2 border-blue-900/20">
                  <td colSpan={4} className="p-2.5 text-start">{t(`الإجمالي التراكمي لكشف الحساب (${chronologicalStatement.length} حركة):`, `Cumulative Statement Total (${chronologicalStatement.length} entries):`)}</td>
                  <td className="p-2.5 text-center font-mono text-red-700 tabular-nums">
                    {formatLocaleNumber(chronologicalStatement.reduce((s, r) => s + r.debit, 0))}
                  </td>
                  <td className="p-2.5 text-center font-mono text-emerald-700 tabular-nums">
                    {formatLocaleNumber(chronologicalStatement.reduce((s, r) => s + r.credit, 0))}
                  </td>
                  <td className="p-2.5 text-center font-mono tabular-nums text-blue-950">
                    {formatLocaleNumber(selectedCustomer.currentBalance)} {t(settings.currency)}
                  </td>
                </tr>
              ) : undefined
            }
            emptyTitle={t('لا توجد حركات مالية أو فواتير مسجلة لهذا العميل حتى الآن.', 'No financial entries or invoices recorded for this customer yet.')}
          />
        )}

        {/* Tab 2: Sales Invoices */}
        {detailTab === 'invoices' && (
          <UnifiedDataTable<Invoice>
            title={t('سجل فواتير المبيعات الصادرة للمحل', 'Shop Sales Invoices Log')}
            subtitle={t('جميع الفواتير المرتبطة بهذا العميل وإمكانية استعراضها وطباعتها', 'All invoices linked to this customer with preview & print options')}
            data={selectedCustomerInvoices}
            rowKey={(inv) => inv.id}
            compact
            exportFilename={`${t('فواتير_العميل', 'customer_invoices')}_${selectedCustomer.name}`}
            pdfTitle={t(`فواتير مبيعات العميل (${selectedCustomer.name})`, `Customer Sales Invoices (${selectedCustomer.name})`)}
            searchPlaceholder={t('بحث برقم الفاتورة أو المستودع أو المندوب...', 'Search by invoice #, warehouse, or rep...')}
            searchFilter={(inv, q) =>
              inv.invoiceNumber.toLowerCase().includes(q) ||
              (inv.warehouseName || '').toLowerCase().includes(q) ||
              (inv.representativeName || '').toLowerCase().includes(q) ||
              inv.date.includes(q)
            }
            columns={[
              {
                key: 'invoiceNumber',
                header: t('رقم الفاتورة', 'Invoice #'),
                sortable: true,
                sortValue: (i) => i.invoiceNumber,
                exportValue: (i) => i.invoiceNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (i) => i.invoiceNumber,
              },
              {
                key: 'date',
                header: t('التاريخ', 'Date'),
                sortable: true,
                sortValue: (i) => i.date,
                exportValue: (i) => i.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (i) => i.date,
              },
              {
                key: 'warehouse',
                header: t('المستودع', 'Warehouse'),
                exportValue: (i) => i.warehouseName,
                cellClassName: 'text-slate-700',
                render: (i) => i.warehouseName,
              },
              {
                key: 'rep',
                header: t('المندوب', 'Representative'),
                exportValue: (i) => i.representativeName || '-',
                cellClassName: 'text-slate-600',
                render: (i) => i.representativeName || '-',
              },
              {
                key: 'grandTotal',
                header: t('إجمالي الفاتورة', 'Invoice Total'),
                align: 'center',
                sortable: true,
                sortValue: (i) => i.grandTotal,
                exportValue: (i) => i.grandTotal,
                cellClassName: 'font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap',
                render: (i) => `${formatLocaleNumber(i.grandTotal)} ${t(settings.currency)}`,
              },
              {
                key: 'paidAmount',
                header: t('المدفوع نقداً', 'Paid Cash'),
                align: 'center',
                sortable: true,
                sortValue: (i) => i.paidAmount,
                exportValue: (i) => i.paidAmount,
                cellClassName: 'font-mono font-bold text-emerald-700 tabular-nums',
                render: (i) => formatLocaleNumber(i.paidAmount),
              },
              {
                key: 'remainingAmount',
                header: t('المتبقي (آجل)', 'Remaining (Credit)'),
                align: 'center',
                sortable: true,
                sortValue: (i) => i.remainingAmount,
                exportValue: (i) => i.remainingAmount,
                cellClassName: 'font-mono font-bold text-red-600 tabular-nums',
                render: (i) => formatLocaleNumber(i.remainingAmount),
              },
              {
                key: 'paymentType',
                header: t('طريقة السداد', 'Payment Method'),
                exportValue: (i) => (i.paymentType === 'cash' ? t('نقدي', 'Cash') : i.paymentType === 'credit' ? t('آجل', 'Credit') : t('جزئي', 'Partial')),
                render: (i) => (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      i.paymentType === 'cash'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : i.paymentType === 'credit'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-blue-50 text-blue-800 border border-blue-200'
                    }`}
                  >
                    {i.paymentType === 'cash' ? t('نقدي', 'Cash') : i.paymentType === 'credit' ? t('آجل', 'Credit') : t('جزئي', 'Partial')}
                  </span>
                ),
              },
              {
                key: 'status',
                header: t('الحالة', 'Status'),
                exportValue: (i) => (i.status === 'confirmed' ? t('مؤكدة', 'Confirmed') : t('ملغاة', 'Cancelled')),
                render: (i) => (
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                    {i.status === 'confirmed' ? t('مؤكدة', 'Confirmed') : t('ملغاة', 'Cancelled')}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: t('الإجراءات', 'Actions'),
                align: 'center',
                render: (inv) => (
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewInvoice(inv)}
                      className="p-1.5 text-blue-900 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                      title={t('استعراض الفاتورة', 'Preview Invoice')}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePrintSingleInvoice(inv)}
                      className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                      title={t('طباعة الفاتورة', 'Print Invoice')}
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>
                ),
              },
            ]}
            emptyTitle={t('لا توجد فواتير مبيعات مسجلة لهذا العميل حتى الآن.', 'No sales invoices recorded for this customer yet.')}
          />
        )}

        {/* Tab 3: Payments & Receipts */}
        {detailTab === 'payments' && (
          <UnifiedDataTable
            title={t('سجل سندات القبض والتحصيلات النقدية', 'Cash Receipts & Collections Log')}
            subtitle={t('جميع المبالغ المحصلة نقدياً وتم توريدها إلى الخزينة', 'All cash amounts collected and deposited to cashbox')}
            data={selectedCustomerPayments}
            rowKey={(pay) => pay.id}
            compact
            exportFilename={`${t('تحصيلات', 'collections')}_${selectedCustomer.name}`}
            pdfTitle={t(`سندات قبض العميل (${selectedCustomer.name})`, `Customer Receipts (${selectedCustomer.name})`)}
            searchPlaceholder={t('بحث برقم السند أو الخزينة أو البيان...', 'Search by receipt #, cashbox, or notes...')}
            searchFilter={(pay, q) =>
              pay.transactionNumber.toLowerCase().includes(q) ||
              (pay.cashboxName || '').toLowerCase().includes(q) ||
              (pay.notes || pay.description || '').toLowerCase().includes(q)
            }
            headerActions={
              <button
                type="button"
                onClick={() => {
                  setPaymentCustomer(selectedCustomer);
                  setPaymentAmount(selectedCustomer.currentBalance > 0 ? selectedCustomer.currentBalance : 0);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('تحصيل نقدية جديد', 'New Cash Collection')}</span>
              </button>
            }
            columns={[
              {
                key: 'transactionNumber',
                header: t('رقم السند', 'Receipt #'),
                sortable: true,
                sortValue: (p) => p.transactionNumber,
                exportValue: (p) => p.transactionNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (p) => p.transactionNumber,
              },
              {
                key: 'date',
                header: t('التاريخ', 'Date'),
                sortable: true,
                sortValue: (p) => p.date,
                exportValue: (p) => p.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (p) => p.date,
              },
              {
                key: 'cashboxName',
                header: t('الخزينة المودع بها', 'Deposited Cashbox'),
                exportValue: (p) => p.cashboxName,
                cellClassName: 'font-bold text-slate-800',
                render: (p) => p.cashboxName,
              },
              {
                key: 'amount',
                header: t('المبلغ المحصل', 'Collected Amount'),
                align: 'center',
                sortable: true,
                sortValue: (p) => p.amount,
                exportValue: (p) => p.amount,
                cellClassName: 'font-mono font-black text-emerald-700 tabular-nums whitespace-nowrap',
                render: (p) => `${formatLocaleNumber(p.amount)} ${t(settings.currency)}`,
              },
              {
                key: 'notes',
                header: t('البيان والملاحظات', 'Notes & Description'),
                exportValue: (p) => p.notes || p.description || '',
                cellClassName: 'text-slate-600',
                render: (p) => p.notes || p.description,
              },
              {
                key: 'createdBy',
                header: t('المسؤول عن التسجيل', 'Recorded By'),
                exportValue: (p) => p.createdBy || '',
                cellClassName: 'text-slate-500',
                render: (p) => p.createdBy,
              },
              {
                key: 'print',
                header: t('طباعة الإيصال', 'Print Receipt'),
                align: 'center',
                render: (pay) => (
                  <button
                    type="button"
                    onClick={() => {
                      setPrintData({
                        title: t('سند قبض نقدية من عميل', 'Customer Cash Receipt Voucher'),
                        docNumber: pay.transactionNumber,
                        docType: 'سند قبض',
                        date: pay.date,
                        partyName: selectedCustomer.name,
                        partyPhone: selectedCustomer.phone,
                        partyAddress: selectedCustomer.address,
                        grandTotal: pay.amount,
                        paidAmount: pay.amount,
                        notes: pay.notes || pay.description,
                      });
                      setIsPrintModalOpen(true);
                    }}
                    className="p-1.5 text-blue-900 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                    title={t('إعادة طباعة سند القبض', 'Reprint Receipt')}
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                ),
              },
            ]}
            emptyTitle={t('لا توجد سندات تحصيل نقدية مسجلة لهذا العميل حتى الآن.', 'No cash receipt vouchers recorded for this customer yet.')}
          />
        )}

        {/* Tab 4: Sales Returns */}
        {detailTab === 'returns' && (
          <UnifiedDataTable
            title={t('سجل بضائع المرتجعات لهذا العميل', 'Customer Returns Log')}
            subtitle={t('حركات إرجاع البضائع التالفة أو المسترجعة والتسويات المالية الناتجة عنها', 'Returned/damaged goods transactions and resulting financial settlements')}
            data={selectedCustomerReturns}
            rowKey={(ret) => ret.id}
            compact
            exportFilename={`${t('مرتجعات', 'returns')}_${selectedCustomer.name}`}
            pdfTitle={t(`مرتجعات العميل (${selectedCustomer.name})`, `Customer Returns (${selectedCustomer.name})`)}
            searchPlaceholder={t('بحث برقم المرتجع أو الفاتورة الأصلية...', 'Search by return # or original invoice...')}
            searchFilter={(ret, q) =>
              ret.returnNumber.toLowerCase().includes(q) ||
              (ret.originalInvoiceNumber || '').toLowerCase().includes(q) ||
              (ret.reason || '').toLowerCase().includes(q)
            }
            columns={[
              {
                key: 'returnNumber',
                header: t('رقم إشعار المرتجع', 'Return Notice #'),
                sortable: true,
                sortValue: (r) => r.returnNumber,
                exportValue: (r) => r.returnNumber,
                cellClassName: 'font-mono font-bold text-amber-800 whitespace-nowrap',
                render: (r) => r.returnNumber,
              },
              {
                key: 'date',
                header: t('التاريخ', 'Date'),
                sortable: true,
                sortValue: (r) => r.date,
                exportValue: (r) => r.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (r) => r.date,
              },
              {
                key: 'originalInvoiceNumber',
                header: t('الفاتورة الأصلية', 'Original Invoice'),
                exportValue: (r) => r.originalInvoiceNumber || '',
                cellClassName: 'font-mono text-blue-900 whitespace-nowrap',
                render: (r) => r.originalInvoiceNumber,
              },
              {
                key: 'warehouseName',
                header: t('المستودع المستلم', 'Receiving Warehouse'),
                exportValue: (r) => r.warehouseName,
                cellClassName: 'text-slate-700',
                render: (r) => r.warehouseName,
              },
              {
                key: 'grandTotal',
                header: t('إجمالي قيمة المرتجع', 'Total Return Value'),
                align: 'center',
                sortable: true,
                sortValue: (r) => r.grandTotal,
                exportValue: (r) => r.grandTotal,
                cellClassName: 'font-mono font-black text-amber-800 tabular-nums whitespace-nowrap',
                render: (r) => `${formatLocaleNumber(r.grandTotal)} ${t(settings.currency)}`,
              },
              {
                key: 'refundType',
                header: t('طريقة رد المبلغ', 'Refund Method'),
                exportValue: (r) => (r.refundType === 'cash' ? t('رد نقدي فوري', 'Instant Cash Refund') : t('خصم من مديونية الحساب', 'Deduct from Balance')),
                render: (r) => (
                  <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-[10px]">
                    {r.refundType === 'cash' ? t('رد نقدي فوري', 'Instant Cash Refund') : t('خصم من مديونية الحساب', 'Deduct from Balance')}
                  </span>
                ),
              },
              {
                key: 'reason',
                header: t('سبب الإرجاع', 'Return Reason'),
                exportValue: (r) => r.reason || '',
                cellClassName: 'text-slate-600',
                render: (r) => r.reason,
              },
            ]}
            emptyTitle={t('لا توجد مرتجعات مسجلة لهذا العميل.', 'No returns recorded for this customer.')}
          />
        )}

        {/* Tab 5: Product Price History */}
        {detailTab === 'prices' && (() => {
          const priceRows = Object.entries(selectedCustomer.priceHistory || {}).map(([prodId, prices]) => {
            const prod = products.find((p) => p.id === prodId || p.code === prodId);
            const normalized = (Array.isArray(prices) ? prices : []).map((entry) => ({
              price: typeof entry === 'number' ? entry : Number(entry.price || 0),
              date: typeof entry === 'number' ? '' : (entry.date || ''),
              unit: typeof entry === 'number' ? '' : (entry.unit || ''),
            }));
            return {
              id: prodId,
              code: prod?.code || prodId,
              name: prod?.name || t(`صنف (${prodId})`, `Product (${prodId})`),
              prices: normalized,
              latestPrice: normalized.length > 0 ? normalized[normalized.length - 1].price : 0,
            };
          });
          return (
            <UnifiedDataTable
              title={t('سجل الأسعار التاريخية للمنتجات المشتراة (آخر 3 أسعار)', 'Purchased Products Price History (Last 3 Prices)')}
              subtitle={t('يعرض النظام تلقائياً آخر ثلاثة أسعار فعلية اشترى بها هذا العميل كل صنف للمقارنة عند إصدار الفواتير', 'Automatically shows the last three actual prices paid by this customer per product when issuing invoices')}
              data={priceRows}
              rowKey={(r) => r.id}
              compact
              exportFilename={`${t('اسعار_العميل', 'customer_prices')}_${selectedCustomer.name}`}
              pdfTitle={t(`تاريخ أسعار منتجات العميل (${selectedCustomer.name})`, `Customer Product Price History (${selectedCustomer.name})`)}
              searchPlaceholder={t('بحث باسم الصنف أو الكود...', 'Search by product name or code...')}
              searchFilter={(r, q) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)}
              columns={[
                {
                  key: 'code',
                  header: t('كود الصنف', 'Item Code'),
                  sortable: true,
                  sortValue: (r) => r.code,
                  exportValue: (r) => r.code,
                  cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                  render: (r) => r.code,
                },
                {
                  key: 'name',
                  header: t('اسم الصنف', 'Item Name'),
                  sortable: true,
                  sortValue: (r) => r.name,
                  exportValue: (r) => r.name,
                  cellClassName: 'font-bold text-slate-900',
                  render: (r) => r.name,
                },
                {
                  key: 'history',
                  header: t('آخر 3 أسعار مسجلة (من الأقدم للأحدث)', 'Last 3 Recorded Prices (Oldest to Newest)'),
                  exportValue: (r) => r.prices.map((p) => `${p.price}${p.date ? ` (${p.date})` : ''}`).join(' | '),
                  render: (r) => (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.prices.map((entry, idx) => (
                        <span key={idx} className="font-mono font-bold px-2 py-0.5 rounded bg-slate-50 border border-slate-300 text-slate-800 text-[11px] tabular-nums">
                          {formatLocaleNumber(entry.price)} {t(settings.currency)}
                          {entry.unit ? ` / ${t(entry.unit)}` : ''}
                          {entry.date ? <span className="text-[10px] text-slate-400 ms-1">({entry.date})</span> : null}
                        </span>
                      ))}
                    </div>
                  ),
                },
                {
                  key: 'latest',
                  header: t('آخر سعر بيع', 'Latest Sale Price'),
                  align: 'center',
                  sortable: true,
                  sortValue: (r) => r.latestPrice,
                  exportValue: (r) => r.latestPrice,
                  cellClassName: 'font-mono font-black text-blue-950 tabular-nums whitespace-nowrap',
                  render: (r) => `${formatLocaleNumber(r.latestPrice)} ${t(settings.currency)}`,
                },
              ]}
              emptyTitle={t('لم يتم تسجيل عمليات بيع سابقة لهذا العميل لتكوين سجل الأسعار بعد.', 'No previous sales recorded for this customer to build price history yet.')}
            />
          );
        })()}

        {/* Tab: Customer Orders */}
        {detailTab === 'orders' && (
          <UnifiedDataTable<CustomerItemOrderRequest>
            title={t('طلبات العميل الموحدة', 'Unified Customer Orders')}
            subtitle={t('طلبات الشراء الواردة من تطبيق العميل أو عبر المندوبين وحالتها والدفعات المقدمة عليها', 'Purchase orders received from Customer App or Reps with status and advance payments')}
            data={selectedCustomerOrders}
            rowKey={(ord) => ord.id}
            compact
            exportFilename={`${t('طلبات', 'orders')}_${selectedCustomer.name}`}
            pdfTitle={t(`طلبات العميل (${selectedCustomer.name})`, `Customer Orders (${selectedCustomer.name})`)}
            searchPlaceholder={t('بحث برقم الطلب أو الفاتورة...', 'Search by order # or invoice #...')}
            searchFilter={(ord, q) =>
              ord.requestNumber.toLowerCase().includes(q) ||
              (ord.invoiceNumber || '').toLowerCase().includes(q)
            }
            headerActions={
              onNavigate ? (
                <button
                  type="button"
                  onClick={() => onNavigate('customer-orders')}
                  className="px-3 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold cursor-pointer"
                >
                  {t('فتح قسم الطلبات', 'Open Orders Section')}
                </button>
              ) : undefined
            }
            columns={[
              {
                key: 'requestNumber',
                header: t('رقم الطلب', 'Order #'),
                sortable: true,
                sortValue: (o) => o.requestNumber,
                exportValue: (o) => o.requestNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (o) => o.requestNumber,
              },
              {
                key: 'date',
                header: t('التاريخ', 'Date'),
                sortable: true,
                sortValue: (o) => o.createdAt || '',
                exportValue: (o) => (o.createdAt || '').slice(0, 10),
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (o) => (o.createdAt || '').slice(0, 10),
              },
              {
                key: 'itemsCount',
                header: t('عدد الأصناف', 'Items Count'),
                align: 'center',
                sortable: true,
                sortValue: (o) => o.items?.length || 0,
                exportValue: (o) => o.items?.length || 0,
                cellClassName: 'tabular-nums',
                render: (o) => t(`${o.items?.length || 0} أصناف`, `${o.items?.length || 0} items`),
              },
              {
                key: 'totalAmount',
                header: t('الإجمالي', 'Total'),
                align: 'center',
                sortable: true,
                sortValue: (o) => Number(o.totalAmount || 0),
                exportValue: (o) => Number(o.totalAmount || 0),
                cellClassName: 'font-mono font-bold tabular-nums whitespace-nowrap',
                render: (o) => `${formatLocaleNumber(Number(o.totalAmount || 0))} ${t(settings.currency)}`,
              },
              {
                key: 'advancePaidAmount',
                header: t('الدفعة المقدمة', 'Advance Paid'),
                align: 'center',
                sortable: true,
                sortValue: (o) => Number(o.advancePaidAmount || 0),
                exportValue: (o) => Number(o.advancePaidAmount || 0),
                cellClassName: 'font-mono font-bold text-emerald-700 tabular-nums whitespace-nowrap',
                render: (o) =>
                  Number(o.advancePaidAmount || 0) > 0
                    ? `${formatLocaleNumber(Number(o.advancePaidAmount))} ${t(settings.currency)}`
                    : '—',
              },
              {
                key: 'status',
                header: t('الحالة', 'Status'),
                exportValue: (o) => t(o.status),
                cellClassName: 'font-bold',
                render: (o) => t(o.status),
              },
              {
                key: 'invoiceNumber',
                header: t('الفاتورة', 'Invoice'),
                exportValue: (o) => o.invoiceNumber || '—',
                cellClassName: 'font-mono text-blue-900 whitespace-nowrap',
                render: (o) => o.invoiceNumber || '—',
              },
            ]}
            emptyTitle={t('لا توجد طلبات مسجلة لهذا العميل.', 'No orders recorded for this customer.')}
          />
        )}

        {/* Tab: Customer Advance Payments */}
        {detailTab === 'advances' && (
          <UnifiedDataTable
            title={t('سجل الدفعات المقدمة على الطلبات', 'Order Advance Payments Log')}
            subtitle={t('تُقيد في حساب العميل الدائن والخزينة عند الاستلام وتُطبق تلقائياً عند تحويل الطلب إلى فاتورة دون تكرار', 'Credited to customer account & cashbox upon receipt and auto-applied when converting order to invoice without duplication')}
            data={selectedCustomerAdvances}
            rowKey={(adv) => adv.id}
            compact
            exportFilename={`${t('دفعات_مقدمة', 'advance_payments')}_${selectedCustomer.name}`}
            pdfTitle={t(`الدفعات المقدمة للعميل (${selectedCustomer.name})`, `Customer Advance Payments (${selectedCustomer.name})`)}
            searchPlaceholder={t('بحث برقم الدفعة أو الخزينة أو الملاحظات...', 'Search by payment #, cashbox, or notes...')}
            searchFilter={(adv, q) =>
              adv.paymentNumber.toLowerCase().includes(q) ||
              (adv.cashboxName || '').toLowerCase().includes(q) ||
              (adv.notes || '').toLowerCase().includes(q)
            }
            columns={[
              {
                key: 'paymentNumber',
                header: t('رقم الدفعة', 'Payment #'),
                sortable: true,
                sortValue: (a) => a.paymentNumber,
                exportValue: (a) => a.paymentNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (a) => a.paymentNumber,
              },
              {
                key: 'date',
                header: t('التاريخ', 'Date'),
                sortable: true,
                sortValue: (a) => a.date,
                exportValue: (a) => a.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (a) => a.date,
              },
              {
                key: 'cashboxName',
                header: t('الخزينة', 'Cashbox'),
                exportValue: (a) => a.cashboxName || a.cashboxId,
                cellClassName: 'font-bold',
                render: (a) => a.cashboxName || a.cashboxId,
              },
              {
                key: 'paymentMethod',
                header: t('الوسيلة', 'Method'),
                exportValue: (a) => (a.paymentMethod === 'bank' ? t('تحويل بنكي', 'Bank Transfer') : a.paymentMethod === 'cheque' ? t('شيك', 'Cheque') : t('نقدي', 'Cash')),
                render: (a) => (a.paymentMethod === 'bank' ? t('تحويل بنكي', 'Bank Transfer') : a.paymentMethod === 'cheque' ? t('شيك', 'Cheque') : t('نقدي', 'Cash')),
              },
              {
                key: 'amount',
                header: t('المبلغ', 'Amount'),
                align: 'center',
                sortable: true,
                sortValue: (a) => Number(a.amount),
                exportValue: (a) => Number(a.amount),
                cellClassName: 'font-mono font-black text-emerald-700 tabular-nums whitespace-nowrap',
                render: (a) => `${formatLocaleNumber(Number(a.amount))} ${t(settings.currency)}`,
              },
              {
                key: 'status',
                header: t('الحالة', 'Status'),
                exportValue: (a) => (a.status === 'applied' ? t('مطبقة على فاتورة', 'Applied to Invoice') : t('رصيد دائن متاح', 'Available Credit Balance')),
                render: (a) => (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      a.status === 'applied'
                        ? 'bg-blue-50 text-blue-800 border border-blue-200'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    {a.status === 'applied' ? t('مطبقة على فاتورة', 'Applied to Invoice') : t('رصيد دائن متاح', 'Available Credit Balance')}
                  </span>
                ),
              },
              {
                key: 'notes',
                header: t('ملاحظات', 'Notes'),
                exportValue: (a) => a.notes || '—',
                cellClassName: 'text-slate-600',
                render: (a) => a.notes || '—',
              },
            ]}
            emptyTitle={t('لا توجد دفعات مقدمة مسجلة على طلبات هذا العميل.', 'No advance payments recorded on orders for this customer.')}
          />
        )}
          </div>
        );
      })() : (
        <div className="space-y-2">
      {/* Conflicts warning for admins */}
      {hasPermission('canManageUsers') &&
        (conflicts.duplicatePhones.length > 0 || conflicts.unlinkedCustomerUsers.length > 0) && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950 space-y-1.5">
            <div className="font-black flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>{t('تنبيه تطابق بيانات العملاء وحسابات الدخول', 'Customer Data & Login Account Match Alert')}</span>
            </div>
            {conflicts.duplicatePhones.length > 0 && (
              <p>
                {t(
                  `يوجد أرقام هواتف مكررة لدى أكثر من عميل (${conflicts.duplicatePhones.map((d) => d.phone).join('، ')}). يعتمد النظام الآن على ربط الحساب بالمعرف الثابت 1:1 بدلاً من الهاتف.`,
                  `Duplicate phone numbers found across multiple customers (${conflicts.duplicatePhones.map((d) => d.phone).join(', ')}). The system now uses 1:1 fixed ID linking instead of phone number.`
                )}
              </p>
            )}
            {conflicts.unlinkedCustomerUsers.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <p>
                  {t(
                    `يوجد (${conflicts.unlinkedCustomerUsers.length}) حساب عميل غير مربوط بملف محل حتى الآن.`,
                    `There are (${conflicts.unlinkedCustomerUsers.length}) unlinked customer login accounts.`
                  )}
                </p>
                <button
                  type="button"
                  disabled={isRepairingUnlinked}
                  onClick={async () => {
                    if (isRepairingUnlinked) return;
                    setIsRepairingUnlinked(true);
                    try {
                      const res = await repairUnlinkedCustomerUsers();
                      if (res.success) {
                        setCustomerBanner({
                          type: 'success',
                          text: t(
                            `تم إصلاح وربط (${res.repairedCount ?? 0}) حساب عميل بملفات عملاء 1:1 تلقائياً بنجاح.`,
                            `Successfully repaired and linked (${res.repairedCount ?? 0}) customer accounts 1:1.`
                          ),
                        });
                        const recheck = await apiRequest<{
                          ok: boolean;
                          duplicatePhones: any[];
                          unlinkedCustomerUsers: any[];
                        }>('/api/customers/conflicts/check');
                        setConflicts({
                          duplicatePhones: recheck.duplicatePhones || [],
                          unlinkedCustomerUsers: recheck.unlinkedCustomerUsers || [],
                        });
                      } else {
                        setCustomerBanner({
                          type: 'error',
                          text: res.error ? t(res.error) : t('تعذر إصلاح حسابات العملاء غير المربوطة', 'Unable to repair unlinked customer accounts'),
                        });
                      }
                    } finally {
                      setIsRepairingUnlinked(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded-md bg-amber-700 hover:bg-amber-800 text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {isRepairingUnlinked
                    ? t('جاري الإصلاح والربط...', 'Repairing & linking...')
                    : t('إصلاح وربط الحسابات غير المربوطة تلقائياً', 'Auto-Repair & Link Unlinked Accounts')}
                </button>
              </div>
            )}
          </div>
        )}

      {/* Compact Summary Banner Routing to Dedicated Orders Section */}
      {customerItemOrders.length > 0 && (
        <section className="rounded-lg border border-[#DCE6F5] bg-[#EEF3FA] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-black text-[#011E58]">{t('طلبات العملاء والمندوبين الواردة من الموبايل', 'Mobile Customer & Rep Orders')}</h3>
            <span className="font-bold text-amber-800 tabular-nums">
              {customerItemOrders.filter((o) => o.status === 'pending').length} {t('جديد', 'New')}
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-[#003589] tabular-nums">
              {customerItemOrders.filter((o) => o.status === 'under_review').length} {t('قيد المراجعة', 'Under Review')}
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-emerald-800 tabular-nums">
              {customerItemOrders.filter((o) => o.status === 'approved').length} {t('مقبول', 'Approved')}
            </span>
          </div>

          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('customer-orders')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>{t('فتح قسم الطلبات', 'Open Orders Section')}</span>
            </button>
          )}
        </section>
      )}

      {/* Top Header Strip */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900">
            {t('العملاء والأرصدة', 'Customers & Balances')} <span className="text-xs font-mono tabular-nums text-slate-500">({customers.length})</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            {t('أرصدة وكشوف حسابات العملاء للمبيعات المباشرة وطلبات التطبيق والمندوبين', 'Customer balances & statements for direct sales, app orders, and representatives')}
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-bold transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('إضافة عميل / محل جديد', 'Add Customer / Shop')}</span>
        </button>
      </div>

      {/* Compact Accounting Summary Strip */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className={`grid grid-cols-1 ${canViewAggregateCustomerTotals ? `sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x ${isRtl ? 'sm:divide-x-reverse' : ''} divide-slate-200` : ''}`}>
          <div className="px-2.5 py-1.5">
            <span className="text-[11px] font-bold text-slate-500 block">{t('إجمالي المحلات المسجلة', 'Total Registered Shops')}</span>
            <div className="text-sm font-black text-slate-900 font-mono tabular-nums">
              {formatLocaleNumber(customers.length)} <span className="text-[11px] font-sans font-semibold text-emerald-700">({formatLocaleNumber(customers.filter(c => c.status === 'active').length)} {t('نشط', 'Active')})</span>
            </div>
          </div>

          {canViewAggregateCustomerTotals && (
            <>
              <div className="px-2.5 py-1.5">
                <span className="text-[11px] font-bold text-slate-500 block">{t('إجمالي مديونيات العملاء (لنا)', 'Total Customer Debts (Receivable)')}</span>
                <div className="text-sm font-black text-red-700 font-mono tabular-nums">
                  {formatLocaleNumber(totalDebts)} <span className="text-[11px] text-slate-500 font-normal">{t(settings.currency)}</span>
                </div>
              </div>

              <div className="px-2.5 py-1.5">
                <span className="text-[11px] font-bold text-slate-500 block">{t('أرصدة العملاء الدائنة (دفعات مقدمة)', 'Customer Credit Balances (Advances)')}</span>
                <div className="text-sm font-black text-emerald-700 font-mono tabular-nums">
                  {formatLocaleNumber(totalCredits)} <span className="text-[11px] text-slate-500 font-normal">{t(settings.currency)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <UnifiedDataTable<Customer>
        compact
        title={t('دليل العملاء والمحلات', 'Customers & Shops Directory')}
        subtitle={t('اضغط على أي صف لعرض الملف الشامل وكشف الحساب أو استخدم أدوات الاتصال والخريطة والتحصيل السريع', 'Click any row for full profile & statement or use quick call, map, and collection actions')}
        data={filteredCustomers}
        rowKey={(c) => c.id}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={t('بحث باسم المحل، رقم الموبايل، الكود، أو العنوان...', 'Search by shop name, mobile, code, or address...')}
        exportFilename={t('دليل_العملاء', 'customers_directory')}
        pdfTitle={t('دليل العملاء والأرصدة', 'Customers & Balances Directory')}
        onRowClick={(cust) => setSelectedCustomerId(cust.id)}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-700 outline-hidden focus:border-blue-600"
            >
              <option value="all">{t('جميع الحالات', 'All Statuses')} ({customers.length})</option>
              <option value="active">{t('نشط فقط', 'Active Only')}</option>
              <option value="blocked">{t('محظور فقط', 'Blocked Only')}</option>
            </select>
            <select
              value={classificationFilter}
              onChange={(e) => setClassificationFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-700 outline-hidden focus:border-blue-600"
            >
              <option value="all">{t('جميع التصنيفات', 'All Classifications')}</option>
              <option value="app_and_direct">{t('عميل تطبيق ومبيعات مباشرة', 'App & Direct Sales Customer')}</option>
              <option value="app_only">{t('عميل تطبيق', 'App Customer')}</option>
              <option value="regular">{t('عميل عادي', 'Regular Customer')}</option>
            </select>
          </div>
        }
        emptyTitle={t('لا يوجد عملاء مسجلون حالياً', 'No customers registered yet')}
        emptySubtitle={t('انقر على زر "إضافة عميل / محل جديد" للبدء بتسجيل بيانات المحلات، الصور الميدانية، أرقام الموبايل، والعناوين.', 'Click "Add Customer / Shop" to start recording shop info, photos, phone numbers, and addresses.')}
        columns={[
          {
            key: 'photo',
            header: t('صورة المحل', 'Shop Photo'),
            render: (cust) =>
              cust.shopPhoto || cust.photo ? (
                <img
                  src={cust.shopPhoto || cust.photo}
                  alt={cust.name}
                  className="w-10 h-10 rounded-lg object-cover border border-slate-200 bg-slate-50"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-[#EEF3FA] text-[#011E58] flex items-center justify-center">
                  <Store className="w-4 h-4 stroke-[1.5]" />
                </div>
              ),
          },
          {
            key: 'code',
            header: t('الكود', 'Code'),
            sortable: true,
            sortValue: (c) => c.code,
            exportValue: (c) => c.code,
            cellClassName: 'font-mono font-bold text-[#011E58] whitespace-nowrap',
            render: (c) => c.code,
          },
          {
            key: 'name',
            header: t('اسم المحل / العميل', 'Shop / Customer Name'),
            sortable: true,
            sortValue: (c) => c.shopName || c.name,
            exportValue: (c) => (c.shopName ? `${c.shopName} (${c.name})` : c.name),
            render: (cust) => {
              const cls = customerClassificationMap.get(cust.id);
              return (
                <div className="space-y-0.5 min-w-[170px]">
                  <div className="font-black text-slate-900 whitespace-normal break-words">{cust.shopName || cust.name}</div>
                  {cust.shopName && cust.shopName !== cust.name && (
                    <div className="text-[10px] text-slate-500 whitespace-normal break-words">{cust.name}</div>
                  )}
                  {(cust.governorate || cust.area) && (
                    <div className="text-[10px] text-slate-500 whitespace-normal break-words">
                      {[cust.governorate, cust.area].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1">
                    {cls && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls.badgeClass}`}>
                        {cls.label}
                      </span>
                    )}
                    {tentativeCustomerIds.has(cust.id) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                        <CloudOff className="w-2.5 h-2.5" />
                        <span>{t('مبدئي لحين المزامنة', 'Tentative pending sync')}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            },
          },
          {
            key: 'phone',
            header: t('الاتصال (موبايل)', 'Phone (Mobile)'),
            sortable: true,
            sortValue: (c) => c.phone,
            exportValue: (c) => c.phone,
            render: (cust) => (
              <a
                href={`tel:${cust.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-mono font-bold border border-[#DCE6F5] whitespace-nowrap"
                title={t('اتصال مباشر', 'Direct Call')}
              >
                <Phone className="w-3.5 h-3.5 text-[#003589]" />
                <span dir="ltr">{cust.phone}</span>
              </a>
            ),
          },
          {
            key: 'location',
            header: t('الموقع على الخريطة', 'Map Location'),
            exportValue: (c) => c.address || '',
            render: (cust) => (
              <div onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setLocationViewerCustomer(cust)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-bold border border-[#DCE6F5] min-w-[140px] max-w-[240px] text-start cursor-pointer"
                  title={t('عرض الموقع المسجل', 'View Registered Location')}
                >
                  <MapPin className="w-3 h-3 text-[#003589] shrink-0" />
                  <span className="whitespace-normal break-words">{cust.address || t('عرض الموقع', 'View Location')}</span>
                </button>
              </div>
            ),
          },
          {
            key: 'currentBalance',
            header: t('الرصيد الحالي', 'Current Balance'),
            align: 'center',
            sortable: true,
            sortValue: (c) => c.currentBalance,
            exportValue: (c) => c.currentBalance,
            cellClassName: 'font-mono font-black tabular-nums whitespace-nowrap',
            render: (cust) => (
              <span className={cust.currentBalance > 0 ? 'text-red-700' : cust.currentBalance < 0 ? 'text-emerald-700' : 'text-slate-800'}>
                {formatLocaleNumber(cust.currentBalance)} {t(settings.currency)}
              </span>
            ),
          },
          {
            key: 'status',
            header: t('الحالة', 'Status'),
            align: 'center',
            sortable: true,
            sortValue: (c) => c.status,
            exportValue: (c) => (c.status === 'active' ? t('نشط', 'Active') : t('محظور', 'Blocked')),
            render: (cust) => (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  cust.status === 'active'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {cust.status === 'active' ? t('نشط', 'Active') : t('محظور', 'Blocked')}
              </span>
            ),
          },
          {
            key: 'actions',
            header: t('الإجراءات', 'Actions'),
            align: 'center',
            render: (cust) => (
              <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentError(null);
                    setPaymentMethod('cash');
                    setPaymentNotes('');
                    setPaymentCustomer(cust);
                    setPaymentAmount(cust.currentBalance > 0 ? cust.currentBalance : 0);
                  }}
                  className="p-1.5 bg-[#EEF3FA] text-[#003589] hover:bg-[#DCE6F5] rounded-md cursor-pointer"
                  title={t('تحصيل نقدية', 'Collect Cash')}
                >
                  <ArrowDownLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCustomerId(cust.id)}
                  className="p-1.5 bg-[#EEF3FA] text-[#011E58] hover:bg-[#DCE6F5] rounded-md cursor-pointer"
                  title={t('استعراض الملف الشامل', 'View Full Profile')}
                >
                  <Eye className="w-4 h-4" />
                </button>
                {hasPermission('canManageUsers') && (
                  <button
                    type="button"
                    onClick={() => {
                      setLinkError(null);
                      setLinkMode('create');
                      setExistingLinkUserId('');
                      setNewCustomerUsername('');
                      setNewCustomerPassword('');
                      setLinkingCustomer(cust);
                    }}
                    title={cust.userId ? t('مرتبط بحساب دخول', 'Linked to Login Account') : t('إنشاء أو ربط حساب دخول للتطبيق', 'Create or Link App Login Account')}
                    className={`p-1.5 rounded-md border cursor-pointer ${
                      cust.userId
                        ? 'bg-[#EEF3FA] text-[#011E58] border-[#DCE6F5]'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    <Link2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => handleOpenEdit(cust, e)}
                  className="p-1.5 text-slate-400 hover:text-blue-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                  title={t('تعديل بيانات المحل والصورة', 'Edit Shop Info & Photo')}
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDeleteCustomerClick(cust, e)}
                  className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                  title={t('حذف العميل', 'Delete Customer')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ),
          },
        ]}
      />
        </div>
      )}

      {/* ========================================================= */}
      {/* ADD / EDIT CUSTOMER MODAL (With Store Photo Upload)      */}
      {/* ========================================================= */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingCustomer ? t('تعديل بيانات المحل وصورته', 'Edit Shop Info & Photo') : t('إضافة عميل / محل غذائي جديد', 'Add New Customer / Shop')}
        subtitle={t('يرجى إدخال صورة المحل، اسم المحل، رقم الموبايل، وعنوان المحل بالتفصيل', 'Please enter shop photo, shop name, mobile number, and detailed shop address')}
        maxWidth="2xl"
      >
        <form onSubmit={handleSaveCustomer} className="space-y-2 text-xs">
          {customerFormError && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-2.5 py-1.5 rounded-md font-bold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{customerFormError}</span>
            </div>
          )}
          {/* Store Photo Upload Section */}
          <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
            <label className="block font-black text-slate-900 mb-1.5">
              {t('صورة المحل / المنشأة:', 'Shop / Store Photo:')}
            </label>

            <div className="flex flex-col sm:flex-row items-center gap-2.5">
              {/* Photo Preview */}
              <div className="relative w-16 h-16 rounded-md border border-slate-300 bg-white overflow-hidden flex items-center justify-center shrink-0">
                {formData.photo ? (
                  <img
                    src={formData.photo}
                    alt={t('صورة المحل', 'Shop Photo')}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center text-slate-400 p-1">
                    <Store className="w-6 h-6 mx-auto stroke-[1.5] text-slate-300" />
                    <span className="text-[10px] block mt-0.5">{t('لا توجد صورة', 'No Photo')}</span>
                  </div>
                )}
                {formData.photo && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="absolute top-1 end-1 bg-red-600 text-white rounded-full p-0.5 hover:bg-red-700 cursor-pointer"
                    title={t('حذف الصورة', 'Delete Photo')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Upload Action */}
              <div className="flex-1 space-y-1.5 text-center sm:text-start">
                <p className="text-[11px] text-slate-500">
                  {t('التقط صورة المحل بالكاميرا أو اختر من جهازك (يتم ضغطها تلقائياً للعمل دون إنترنت).', 'Capture shop photo with camera or choose from device (auto-compressed for offline use).')}
                </p>

                <div className="flex flex-wrap items-center gap-1.5 justify-center sm:justify-start">
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#003589] hover:bg-[#0049B0] text-white font-bold rounded-md text-xs cursor-pointer transition-colors">
                    <Camera className="w-3.5 h-3.5" />
                    <span>{formData.photo ? t('التقاط صورة جديدة', 'Capture New Photo') : t('تصوير بالكاميرا', 'Take Camera Photo')}</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>

                  <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold rounded-md text-xs cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{t('اختيار من المعرض', 'Choose from Gallery')}</span>
                    <input
                      ref={galleryInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>

                  {formData.photo && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-md font-bold border border-red-200 cursor-pointer"
                    >
                      {t('حذف الصورة', 'Delete Photo')}
                    </button>
                  )}
                </div>

                {isUploadingPhoto && (
                  <div className="flex items-center gap-1.5 text-blue-900 font-bold text-[11px]">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>{t('جاري معالجة وضغط الصورة...', 'Processing and compressing image...')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Form Inputs Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {t('اسم تاجر الجملة / العميل:', 'Wholesaler / Customer Name:')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {t('اسم المحل أو المنشأة:', 'Shop or Business Name:')}
              </label>
              <input
                type="text"
                value={formData.shopName}
                onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div className="sm:col-span-2 space-y-2 bg-slate-50/70 p-2.5 rounded-lg border border-slate-200">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {t('رقم الهاتف الرئيسي:', 'Primary Phone Number:')} <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="tel"
                    dir="ltr"
                    required
                    value={formData.phone}
                    onChange={(e) => {
                      setFormData({ ...formData, phone: e.target.value });
                      if (phoneActionNotice) setPhoneActionNotice(null);
                    }}
                    className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold focus:border-blue-600 outline-hidden"
                  />
                  {(() => {
                    const cleanedPhone = formData.phone.replace(/[^\d+]/g, '');
                    const isValidPhone = cleanedPhone.replace(/\D/g, '').length >= 7;
                    return isValidPhone ? (
                      <a
                        href={`tel:${cleanedPhone}`}
                        onClick={() =>
                          setPhoneActionNotice({
                            type: 'info',
                            text: t(`جاري فتح الاتصال بالرقم (${cleanedPhone}) عبر تطبيق الهاتف.`, `Opening call to (${cleanedPhone}) via phone app.`),
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] font-bold shrink-0 transition-colors"
                        title={t('اتصال هاتفي بالرقم', 'Call Number')}
                      >
                        <Phone className="w-3.5 h-3.5 text-[#003589]" />
                        <span>{t('اتصال', 'Call')}</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setPhoneActionNotice({
                            type: 'error',
                            text: t('يرجى إدخال رقم هاتف صحيح (7 أرقام على الأقل) لإجراء الاتصال.', 'Please enter a valid phone number (at least 7 digits) to call.'),
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300 font-bold shrink-0 cursor-pointer transition-colors"
                        title={t('اتصال هاتفي', 'Phone Call')}
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>{t('اتصال', 'Call')}</span>
                      </button>
                    );
                  })()}
                </div>
                {phoneActionNotice && (
                  <span
                    className={`text-[11px] font-bold mt-1 block ${
                      phoneActionNotice.type === 'error' ? 'text-red-600' : 'text-emerald-700'
                    }`}
                  >
                    {phoneActionNotice.text}
                  </span>
                )}
              </div>

              {formData.extraPhones.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <label className="block font-bold text-slate-600 text-[11px]">{t('أرقام الهاتف الإضافية:', 'Additional Phone Numbers:')}</label>
                  {formData.extraPhones.map((extra, idx) => {
                    const cleanExtra = extra.phone.replace(/[^\d+]/g, '');
                    const isValidExtra = cleanExtra.replace(/\D/g, '').length >= 7;
                    return (
                      <div key={extra.id || idx} className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                        <input
                          type="tel"
                          dir="ltr"
                          aria-label={t('رقم هاتف إضافي', 'Additional phone')}
                          value={extra.phone}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFormData((prev) => ({
                              ...prev,
                              extraPhones: prev.extraPhones.map((row, i) => (i === idx ? { ...row, phone: val } : row)),
                            }));
                          }}
                          className="flex-1 min-w-[130px] bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-bold"
                        />
                        <select
                          value={extra.label}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFormData((prev) => ({
                              ...prev,
                              extraPhones: prev.extraPhones.map((row, i) => (i === idx ? { ...row, label: val } : row)),
                            }));
                          }}
                          className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-semibold"
                        >
                          <option value="موبايل">{t('موبايل', 'Mobile')}</option>
                          <option value="محل">{t('تليفون المحل', 'Shop Phone')}</option>
                          <option value="واتساب">{t('واتساب', 'WhatsApp')}</option>
                          <option value="إضافي">{t('إضافي', 'Extra')}</option>
                        </select>
                        {isValidExtra && (
                          <a
                            href={`tel:${cleanExtra}`}
                            className="p-1.5 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] hover:bg-[#DCE6F5]"
                            title={t('اتصال بهذا الرقم', 'Call this number')}
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const targetVal = extra.phone.trim();
                            if (!targetVal) return;
                            const oldPrimary = formData.phone.trim();
                            setFormData((prev) => ({
                              ...prev,
                              phone: targetVal,
                              extraPhones: prev.extraPhones
                                .map((row, i) => (i === idx ? { ...row, phone: oldPrimary } : row))
                                .filter((row) => row.phone.trim() !== ''),
                            }));
                          }}
                          className="px-2 py-1.5 rounded-lg bg-blue-50 text-blue-900 border border-blue-200 text-[10px] font-bold hover:bg-blue-100 cursor-pointer shrink-0"
                          title={t('تعيين هذا الرقم كرقم رئيسي', 'Set as primary number')}
                        >
                          {t('تعيين رئيسي', 'Set Primary')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              extraPhones: prev.extraPhones.filter((_, i) => i !== idx),
                            }))
                          }
                          className="p-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 cursor-pointer"
                          title={t('حذف الرقم', 'Remove Number')}
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
                  setFormData((prev) => ({
                    ...prev,
                    extraPhones: [
                      ...prev.extraPhones,
                      { id: `ph-${Date.now()}-${prev.extraPhones.length}`, phone: '', label: 'موبايل' },
                    ],
                  }))
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white hover:bg-blue-50 text-blue-900 border border-blue-200 font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('+ إضافة رقم تليفون آخر', '+ Add Another Phone')}</span>
              </button>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {t('المحافظة:', 'Governorate:')}
              </label>
              <input
                type="text"
                value={formData.governorate}
                onChange={(e) => setFormData({ ...formData, governorate: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-semibold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {t('المنطقة / الحي:', 'Area / District:')}
              </label>
              <input
                type="text"
                value={formData.area}
                onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-semibold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {t('الموقع الجغرافي / إحداثيات GPS (أو رابط خرائط):', 'GPS Coordinates (or Maps Link):')}
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  dir="ltr"
                  value={formData.geoCoordinates}
                  onChange={(e) => {
                    setFormData({ ...formData, geoCoordinates: e.target.value });
                    if (mapActionWarning) setMapActionWarning(null);
                  }}
                  className="flex-1 h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-mono text-xs focus:border-blue-600 outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setIsLocationPickerOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold shrink-0 cursor-pointer transition-colors"
                  title={t('تحديد الموقع على خريطة جوجل', 'Pick location on Google Maps')}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{t('تحديد على الخريطة', 'Pick on Map')}</span>
                </button>
                <button
                  type="button"
                  disabled={isLocatingGeo}
                  onClick={handleCaptureCustomerGeo}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] font-bold shrink-0 cursor-pointer disabled:opacity-50 transition-colors"
                  title={t('تحديد موقعي الحالي عبر GPS وجلب العنوان تلقائياً', 'Detect current location via GPS and fetch address')}
                >
                  <MapPin className="w-3.5 h-3.5 text-[#003589]" />
                  <span>{isLocatingGeo ? t('تحديد...', 'Locating...') : 'GPS'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                {t('عنوان المحل بالتفصيل:', 'Detailed Shop Address:')} <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  required
                  value={formData.address}
                  onChange={(e) => {
                    setFormData({ ...formData, address: e.target.value });
                    if (mapActionWarning) setMapActionWarning(null);
                  }}
                  className="flex-1 h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-semibold focus:border-blue-600 outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setIsLocationPickerOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] font-bold shrink-0 cursor-pointer transition-colors"
                  title={t('تحديد أو تعديل الموقع على خرائط جوجل', 'Set or edit location on Google Maps')}
                >
                  <MapPin className="w-3.5 h-3.5 text-[#003589]" />
                  <span>{t('خريطة', 'Map')}</span>
                </button>
              </div>
              {mapActionWarning ? (
                <span className="text-[11px] font-bold text-red-600 mt-1 block">{mapActionWarning}</span>
              ) : (
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  {t('يستخدم العنوان أو إحداثيات GPS لفتح موقع المحل مباشرة على خرائط Google Maps', 'Uses address or GPS coordinates to open shop location directly on Google Maps')}
                </span>
              )}
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('كود المحل / العميل:', 'Shop / Customer Code:')}</label>
              <input
                type="text"
                dir="ltr"
                required
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="w-full h-8 bg-slate-50 border border-slate-300 rounded-md px-2 py-1 font-mono font-bold text-blue-900"
              />
            </div>
          </div>

          {/* Allowed Representatives Assignment */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="font-black text-slate-800">
                {t('المناديب المسموح لهم بالتعامل مع العميل:', 'Representatives Allowed to Handle Customer:')}
              </label>
              {formData.allowedRepIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, allowedRepIds: [] }))}
                  className="text-[11px] font-bold text-slate-500 hover:text-red-600 cursor-pointer"
                >
                  {t('إلغاء التحديد', 'Clear Selection')}
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              {t('يظهر هذا العميل وتاريخ أسعاره وفواتيره في تطبيق الموبايل للمناديب المحددين فقط. عدم تحديد أي مندوب يقتصر التعامل على الإدارة.', 'This customer, price history, and invoices appear in mobile app only for selected reps. Selecting none restricts access to management.')}
            </p>
            {representatives.length === 0 ? (
              <p className="text-[11px] text-amber-700 font-bold">{t('لا يوجد مناديب مبيعات مسجلون حالياً.', 'No sales representatives registered yet.')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 max-h-36 overflow-y-auto">
                {representatives.map((rep) => {
                  const isChecked = formData.allowedRepIds.includes(rep.id);
                  return (
                    <label
                      key={rep.id}
                      className={`flex items-center gap-2 p-1.5 rounded-lg border cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-blue-50 border-blue-400 text-blue-950 font-bold'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setFormData((prev) => ({
                            ...prev,
                            allowedRepIds: checked
                              ? Array.from(new Set([...prev.allowedRepIds, rep.id]))
                              : prev.allowedRepIds.filter((id) => id !== rep.id),
                          }));
                        }}
                        className="w-4 h-4 accent-blue-900"
                      />
                      <span className="truncate">{rep.name}</span>
                      {rep.vehicleNumber && (
                        <span className="text-[10px] text-slate-400 ms-auto font-mono">{rep.vehicleNumber}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Opening balance and status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {!editingCustomer ? (
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {t('رصيد أول المدة الافتتاحي', 'Opening Balance')} ({t(settings.currency)}):
                </label>
                <input
                  type="number"
                  step="any"
                  value={formData.openingBalance}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      openingBalance: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  {t('موجب (+) = مديونية سابقة على العميل، سالب (-) = رصيد دائن مدفوع مقدماً', 'Positive (+) = previous customer debt, Negative (-) = prepaid credit balance')}
                </span>
              </div>
            ) : (
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('حالة الحساب:', 'Account Status:')}</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold outline-hidden focus:border-blue-600"
                >
                  <option value="active">{t('نشط (مسموح بالبيع وإصدار الفواتير)', 'Active (Sales & invoicing allowed)')}</option>
                  <option value="blocked">{t('محظور (موقوف عن التعامل مؤقتاً)', 'Blocked (Temporarily suspended)')}</option>
                </select>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('ملاحظات إضافية:', 'Additional Notes:')}</label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 outline-hidden focus:border-blue-600"
              />
            </div>
          </div>

          {!editingCustomer && hasPermission('canManageUsers') && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-2 space-y-2">
              <label className="flex items-center gap-2 font-black text-blue-950 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createPortalLogin}
                  onChange={(e) => setCreatePortalLogin(e.target.checked)}
                  className="w-4 h-4 accent-blue-900"
                />
                <span>{t('إنشاء حساب دخول لتطبيق العملاء وربطه تلقائياً (1:1)', 'Create Customer App login account & auto-link (1:1)')}</span>
              </label>

              {createPortalLogin && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      {t('اسم الدخول (Username):', 'Username:')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={portalUsername}
                      onChange={(e) => setPortalUsername(e.target.value)}
                      className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      {t('كلمة المرور (6 أحرف على الأقل):', 'Password (min 6 chars):')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      dir="ltr"
                      value={portalPassword}
                      onChange={(e) => setPortalPassword(e.target.value)}
                      className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSavingCustomer || isUploadingPhoto}
              className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
            >
              {isSavingCustomer ? t('جاري الحفظ...', 'Saving...') : editingCustomer ? t('حفظ التعديلات', 'Save Changes') : t('تسجيل العميل في المنظومة', 'Register Customer')}
            </button>
          </div>
        </form>
      </Modal>

      {/* ========================================================= */}
      {/* QUICK CASH PAYMENT MODAL                                  */}
      {/* ========================================================= */}
      {paymentCustomer && (
        <Modal
          isOpen={!!paymentCustomer}
          onClose={() => setPaymentCustomer(null)}
          title={t(`تسجيل تحصيل نقدية: ${paymentCustomer.name}`, `Record Cash Collection: ${paymentCustomer.name}`)}
          subtitle={t(`المديونية الحالية: ${formatLocaleNumber(paymentCustomer.currentBalance)} ${t(settings.currency)}`, `Current Debt: ${formatLocaleNumber(paymentCustomer.currentBalance)} ${t(settings.currency)}`)}
          maxWidth="md"
        >
          <form onSubmit={handleRecordPayment} className="space-y-2 text-xs">
            {paymentError && (
              <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">
                {paymentError}
              </div>
            )}
            {customers.length > 1 && (
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('العميل / المحل:', 'Customer / Shop:')}</label>
                <select
                  value={paymentCustomer.id}
                  onChange={(e) => {
                    const found = customers.find(c => c.id === e.target.value);
                    if (found) {
                      setPaymentCustomer(found);
                      setPaymentAmount(found.currentBalance > 0 ? found.currentBalance : '');
                    }
                  }}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold outline-hidden focus:border-blue-600"
                >
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code}) — {t('رصيد:', 'Bal:')} {formatLocaleNumber(c.currentBalance)} {t(settings.currency)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {t('المبلغ المحصل', 'Collected Amount')} ({t(settings.currency)}): <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={paymentAmount === '' ? '' : paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full h-9 bg-slate-50 border border-slate-300 rounded-md px-2 py-1 text-sm font-black text-center text-emerald-800 font-mono outline-hidden focus:border-emerald-600"
              />
            </div>

            {Number(paymentAmount || 0) > 0 && (paymentCustomer.currentBalance <= 0 || Number(paymentAmount || 0) > paymentCustomer.currentBalance) && (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold leading-relaxed">
                {t(
                  `تنبيه محاسبي: المبلغ المدخل يتجاوز المديونية القائمة للعميل — سيتم قيد الزيادة كـ "رصيد دائن للعميل / دفعة مقدمة (علينا)" (${formatLocaleNumber(Math.abs(paymentCustomer.currentBalance - Number(paymentAmount || 0)))} ${t(settings.currency)}) دون تصفير الرصيد السالب ولن يُحتسب كإيراد مبيعات.`,
                  `Accounting Notice: Entered amount exceeds customer's current debt — the excess (${formatLocaleNumber(Math.abs(paymentCustomer.currentBalance - Number(paymentAmount || 0)))} ${t(settings.currency)}) will be recorded as Customer Credit / Advance Balance without zeroing negative balance and will not count as sales revenue.`
                )}
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('وسيلة التحصيل:', 'Collection Method:')}</label>
              <div className="grid grid-cols-3 gap-1.5 font-bold">
                {[
                  { id: 'cash' as const, label: t('نقدي', 'Cash') },
                  { id: 'bank' as const, label: t('تحويل بنكي', 'Bank Transfer') },
                  { id: 'cheque' as const, label: t('شيك', 'Cheque') },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id)}
                    className={`h-8 px-2 rounded-md border cursor-pointer ${
                      paymentMethod === m.id
                        ? 'bg-[#011E58] text-white border-[#011E58]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {!isRepRole ? (
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('الخزينة المودع بها المبلغ:', 'Deposited Cashbox:')}</label>
                <select
                  value={paymentCashboxId}
                  onChange={(e) => setPaymentCashboxId(e.target.value)}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold outline-hidden focus:border-[#003589]"
                >
                  {cashboxes.map(cb => (
                    <option key={cb.id} value={cb.id}>
                      {cb.balanceHidden ? `${cb.name} (${t('رصيد محجوب', 'Balance Hidden')})` : `${cb.name} (${t('رصيدها:', 'Bal:')} ${formatLocaleNumber(cb.currentBalance ?? 0)} ${t(settings.currency)})`}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
                {t('يُسجَّل التحصيل على حساب العميل وعهدة/تسوية الإدارة دون اختيار خزائن الشركة.', 'Collection is recorded to customer account and rep/management settlement without selecting company cashboxes.')}
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('البيان والملاحظات:', 'Notes & Description:')}</label>
              <input
                type="text"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 outline-hidden focus:border-[#003589]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setPaymentCustomer(null)}
                className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmittingPayment}
                className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmittingPayment ? t('جاري التسجيل...', 'Recording...') : t('تأكيد التحصيل وطباعة الإيصال', 'Confirm Collection & Print Receipt')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* DELETE CUSTOMER CONFIRMATION MODAL                        */}
      {/* ========================================================= */}
      {customerToDelete && (
        <Modal
          isOpen={!!customerToDelete}
          onClose={() => setCustomerToDelete(null)}
          title={t('تأكيد حذف / أرشفة العميل', 'Confirm Delete / Archive Customer')}
          maxWidth="md"
        >
          <div className="space-y-2 text-xs">
            {deleteErrorMessage ? (
              <div className="p-2.5 bg-red-50 text-red-900 border border-red-200 rounded-lg space-y-2">
                <div className="flex items-center gap-1.5 font-black text-xs text-red-700">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{t('تنبيه أمان وحماية الحسابات', 'Security & Account Protection Alert')}</span>
                </div>
                <p className="leading-relaxed">{deleteErrorMessage}</p>
                <div className="pt-1">
                  <button
                    onClick={async () => {
                      try {
                        await updateCustomer(customerToDelete.id, { status: 'blocked' });
                        setCustomerToDelete(null);
                      } catch (err: any) {
                        setDeleteErrorMessage(err?.message ? t(err.message) : t('تعذر تغيير حالة العميل.', 'Unable to update customer status.'));
                      }
                    }}
                    className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-md cursor-pointer"
                  >
                    {t('تغيير حالة العميل إلى "محظور" بدلاً من الحذف', 'Set Customer Status to "Blocked" Instead')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="p-2.5 bg-amber-50 text-amber-900 rounded-lg border border-amber-200">
                  <p className="font-bold">
                    {t('هل أنت متأكد من حذف العميل:', 'Are you sure you want to delete customer:')} <span className="font-black underline">{customerToDelete.name}</span> ({customerToDelete.code})؟
                  </p>
                  <p className="text-[11px] text-amber-800 mt-1">
                    {t('إذا كان العميل مرتبطاً بأي فواتير أو سندات قبض تاريخية، سيتم منع الحذف لحماية القيود المحاسبية.', 'If the customer is linked to any historical invoices or receipts, deletion will be blocked to protect accounting entries.')}
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    onClick={() => setCustomerToDelete(null)}
                    className="px-2.5 py-1 border rounded-md font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    {t('إلغاء', 'Cancel')}
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-black rounded-md cursor-pointer"
                  >
                    {t('تأكيد الحذف', 'Confirm Delete')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* INVOICE PREVIEW MODAL                                     */}
      {/* ========================================================= */}
      {previewInvoice && (
        <Modal
          isOpen={!!previewInvoice}
          onClose={() => setPreviewInvoice(null)}
          title={t(`تفاصيل فاتورة مبيعات: ${previewInvoice.invoiceNumber}`, `Sales Invoice Details: ${previewInvoice.invoiceNumber}`)}
          subtitle={t(`التاريخ: ${previewInvoice.date} | العميل: ${previewInvoice.customerName}`, `Date: ${previewInvoice.date} | Customer: ${previewInvoice.customerName}`)}
          maxWidth="4xl"
        >
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-2 rounded-md border border-slate-200 font-mono">
              <div>{t('المستودع:', 'Warehouse:')} <strong className="font-sans">{previewInvoice.warehouseName}</strong></div>
              <div>{t('المندوب:', 'Rep:')} <strong className="font-sans">{previewInvoice.representativeName || '-'}</strong></div>
              <div>{t('طريقة السداد:', 'Payment:')} <strong className="font-sans">{previewInvoice.paymentType === 'cash' ? t('نقدي', 'Cash') : previewInvoice.paymentType === 'credit' ? t('آجل', 'Credit') : t('جزئي', 'Partial')}</strong></div>
              <div>{t('الحالة:', 'Status:')} <strong className="text-emerald-700 font-sans">{t('مؤكدة', 'Confirmed')}</strong></div>
            </div>

            <UnifiedDataTable
              data={previewInvoice.items}
              rowKey={(it, idx) => `${it.productId || idx}-${idx}`}
              compact
              searchable={false}
              paginated={false}
              columns={[
                { key: 'name', header: t('الصنف', 'Item'), cellClassName: 'font-bold', render: (it) => it.productName },
                { key: 'unit', header: t('الوحدة', 'Unit'), cellClassName: 'text-slate-600', render: (it) => t(it.unit) },
                { key: 'qty', header: t('الكمية', 'Qty'), align: 'center', cellClassName: 'font-mono font-bold tabular-nums', render: (it) => formatLocaleNumber(it.quantity) },
                { key: 'price', header: t('السعر', 'Price'), align: 'center', cellClassName: 'font-mono tabular-nums', render: (it) => formatLocaleNumber(it.unitPrice) },
                { key: 'total', header: t('الإجمالي', 'Total'), align: 'center', cellClassName: 'font-mono font-bold tabular-nums', render: (it) => formatLocaleNumber(it.total) },
              ]}
            />

            <div className="flex justify-between items-center bg-[#011E58] text-white px-2.5 py-1.5 rounded-md font-bold font-mono">
              <span>{t('إجمالي الفاتورة:', 'Invoice Total:')} {formatLocaleNumber(previewInvoice.grandTotal)} {t(settings.currency)}</span>
              <span>{t('المدفوع:', 'Paid:')} {formatLocaleNumber(previewInvoice.paidAmount)}</span>
              <span>{t('المتبقي:', 'Remaining:')} {formatLocaleNumber(previewInvoice.remainingAmount)}</span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => setPreviewInvoice(null)}
                className="px-2.5 py-1 border rounded-md font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
              <button
                onClick={() => {
                  handlePrintSingleInvoice(previewInvoice);
                  setPreviewInvoice(null);
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{t('طباعة الفاتورة', 'Print Invoice')}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* CUSTOMER-USER 1:1 LINKING MODAL                           */}
      {/* ========================================================= */}
      {linkingCustomer && (
        <Modal
          isOpen={!!linkingCustomer}
          onClose={() => setLinkingCustomer(null)}
          title={t(`ربط حساب تطبيق العملاء: ${linkingCustomer.name}`, `Link Customer App Account: ${linkingCustomer.name}`)}
          subtitle={t('ربط موثوق 1:1 بين ملف المحل وحساب تسجيل الدخول', 'Reliable 1:1 link between shop profile and login account')}
          maxWidth="md"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setLinkError(null);
              setIsLinking(true);
              try {
                const payload =
                  linkMode === 'existing'
                    ? { existingUserId: existingLinkUserId }
                    : {
                        createUser: {
                          fullName: linkingCustomer.name,
                          username: newCustomerUsername.trim(),
                          password: newCustomerPassword,
                          phone: linkingCustomer.phone,
                        },
                      };
                const res = await linkCustomerUser(linkingCustomer.id, payload);
                if (!res.success) {
                  setLinkError(res.error ? t(res.error) : t('تعذر ربط الحساب', 'Unable to link account'));
                  return;
                }
                setCustomerBanner({
                  type: 'success',
                  text: t(`تم ربط العميل (${linkingCustomer.name}) بحساب الدخول بنجاح.`, `Customer (${linkingCustomer.name}) linked to login account successfully.`),
                });
                setLinkingCustomer(null);
              } finally {
                setIsLinking(false);
              }
            }}
            className="space-y-2 text-xs"
          >
            {linkError && (
              <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">
                {linkError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5 font-bold">
              <button
                type="button"
                onClick={() => setLinkMode('create')}
                className={`h-8 px-2 rounded-md border cursor-pointer ${
                  linkMode === 'create' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {t('إنشاء حساب دخول جديد', 'Create New Login Account')}
              </button>
              <button
                type="button"
                onClick={() => setLinkMode('existing')}
                className={`h-8 px-2 rounded-md border cursor-pointer ${
                  linkMode === 'existing' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {t('ربط بحساب موجود مسبقاً', 'Link to Existing Account')}
              </button>
            </div>

            {linkMode === 'create' ? (
              <div className="space-y-2">
                <div>
                  <label className="block font-bold mb-1">{t('اسم المستخدم للدخول (Username):', 'Login Username:')}</label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={newCustomerUsername}
                    onChange={(e) => setNewCustomerUsername(e.target.value)}
                    className="w-full h-8 border rounded-md px-2 py-1 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">{t('كلمة المرور (6 أحرف على الأقل):', 'Password (min 6 chars):')}</label>
                  <input
                    type="password"
                    dir="ltr"
                    required
                    minLength={6}
                    value={newCustomerPassword}
                    onChange={(e) => setNewCustomerPassword(e.target.value)}
                    className="w-full h-8 border rounded-md px-2 py-1 font-mono"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block font-bold mb-1">{t('اختر حساب العميل المسجل:', 'Select Registered Customer Account:')}</label>
                <select
                  required
                  value={existingLinkUserId}
                  onChange={(e) => setExistingLinkUserId(e.target.value)}
                  className="w-full h-8 border rounded-md px-2 py-1 font-bold bg-white"
                >
                  <option value="">{t('-- اختر حساب دخول --', '-- Select Login Account --')}</option>
                  {users
                    .filter((u) => u.role === 'customer')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} ({u.username}) {u.phone ? `— ${u.phone}` : ''}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setLinkingCustomer(null)}
                className="px-2.5 py-1 border rounded-md font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isLinking}
                className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black disabled:opacity-50 cursor-pointer"
              >
                {isLinking ? t('جاري الربط...', 'Linking...') : t('اعتماد وربط الحساب', 'Confirm & Link Account')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* SHOP PHOTO LIGHTBOX PREVIEW MODAL                         */}
      {/* ========================================================= */}
      {previewShopPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-950/80 backdrop-blur-xs"
          onClick={() => setPreviewShopPhoto(null)}
        >
          <div className="relative max-w-2xl w-full bg-white rounded-lg overflow-hidden shadow-xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50">
              <span className="font-black text-xs text-slate-900">{t('معاينة صورة المحل', 'Shop Photo Preview')}</span>
              <button
                type="button"
                onClick={() => setPreviewShopPhoto(null)}
                className="px-2.5 py-1 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
            <div className="p-2 bg-slate-900 flex items-center justify-center">
              <img
                src={previewShopPhoto}
                alt={t('صورة المحل بالحجم الكامل', 'Full-size shop photo')}
                className="max-h-[75vh] w-auto object-contain rounded-md"
              />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* GOOGLE MAPS PICKER & VIEWER MODALS                        */}
      {/* ========================================================= */}
      <CustomerLocationPickerModal
        isOpen={isLocationPickerOpen}
        onClose={() => setIsLocationPickerOpen(false)}
        initialLat={formData.latitude}
        initialLng={formData.longitude}
        initialGeoCoordinates={formData.geoCoordinates}
        initialAddress={formData.address}
        initialCity={formData.city}
        initialArea={formData.area}
        initialGovernorate={formData.governorate}
        onConfirm={(picked: PickedCustomerLocation) => {
          setFormData((prev) => ({
            ...prev,
            geoCoordinates: picked.geoCoordinates,
            latitude: picked.latitude,
            longitude: picked.longitude,
            locationCapturedAt: picked.locationCapturedAt,
            address: picked.address || prev.address,
            area: picked.area || prev.area,
            city: picked.city || prev.city,
            governorate: picked.governorate || prev.governorate,
          }));
          setMapActionWarning(null);
        }}
      />

      <CustomerLocationViewerModal
        isOpen={Boolean(locationViewerCustomer)}
        onClose={() => setLocationViewerCustomer(null)}
        customerName={locationViewerCustomer?.name || ''}
        shopName={locationViewerCustomer?.shopName}
        address={locationViewerCustomer?.address}
        city={locationViewerCustomer?.city}
        area={locationViewerCustomer?.area}
        governorate={locationViewerCustomer?.governorate}
        geoCoordinates={locationViewerCustomer?.geoCoordinates}
        latitude={locationViewerCustomer?.latitude}
        longitude={locationViewerCustomer?.longitude}
      />

      {/* ========================================================= */}
      {/* PRINT DOCUMENT MODAL (Statement, Receipt, Invoice)        */}
      {/* ========================================================= */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />
    </div>
  );
};

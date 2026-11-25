import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Plus, Phone, MapPin, FileText, 
  ArrowDownLeft, Printer, Download, Eye, Edit, Trash2, CheckCircle2, 
  Store, Camera, Upload, X, ArrowRight, 
  Wifi, WifiOff, RefreshCw, ShoppingCart, RotateCcw, 
  Receipt, AlertCircle, ShieldAlert, Sparkles, Link2, Wallet, CloudOff
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
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
          label: 'عميل تطبيق ومبيعات مباشرة',
          badgeClass: 'bg-[#DCE6F5] text-[#011E58] border border-[#B8CAE8]',
        });
      } else if (isApp) {
        map.set(c.id, {
          key: 'app_only',
          label: 'عميل تطبيق',
          badgeClass: 'bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5]',
        });
      } else {
        map.set(c.id, {
          key: 'regular',
          label: 'عميل عادي',
          badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
        });
      }
    }
    return map;
  }, [customers, customerItemOrders, invoices, orderInvoiceIds]);

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
        docNumber: 'افتتاحي',
        type: 'رصيد أول المدة',
        description: 'الرصيد الافتتاحي المسجل عند تأسيس ملف العميل',
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
          description: `دفعة مقدمة على طلب (${adv.cashboxName || adv.cashboxId})${adv.notes ? ` — ${adv.notes}` : ''}`,
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
          description: `فاتورة مبيعات (${inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'credit' ? 'آجل' : 'سداد جزئي'})${appliedAdv > 0 ? ` [طبّقت دفعة مقدمة ${appliedAdv.toLocaleString()}]` : ''} - ${inv.warehouseName}`,
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
        description: `تحصيل نقدي بالخزينة (${pay.cashboxName}) - ${pay.notes || pay.description}`,
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
        description: `مرتجع بضائع للفاتورة (${ret.originalInvoiceNumber}) — ${ret.refundType === 'cash' ? 'رد نقدي من الخزينة بدون أثر على الرصيد' : 'خصم من رصيد العميل'} - ${ret.reason}`,
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
  }, [selectedCustomer, selectedCustomerAdvances, selectedCustomerInvoices, selectedCustomerPayments, selectedCustomerReturns]);

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
      setCustomerFormError(err.message || 'حدث خطأ أثناء تحميل ومعالجة صورة المحل');
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
        setMapActionWarning(res.error || 'تعذر الحصول على إحداثيات GPS من الجهاز.');
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
      setCustomerFormError('يرجى إدخال اسم المحل أو العميل');
      return;
    }
    if (!formData.phone.trim()) {
      setCustomerFormError('يرجى إدخال رقم الموبايل');
      return;
    }
    if (!formData.address.trim()) {
      setCustomerFormError('يرجى إدخال عنوان المحل بالتفصيل');
      return;
    }
    if (!editingCustomer && createPortalLogin) {
      if (!portalUsername.trim()) {
        setCustomerFormError('يرجى إدخال اسم المستخدم لحساب تطبيق العميل');
        return;
      }
      if (portalPassword.length < 6) {
        setCustomerFormError('كلمة مرور حساب العميل يجب أن تكون 6 أحرف على الأقل');
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
        setCustomerFormError('إحداثيات الموقع (0, 0) غير صالحة — يرجى تحديد موقع حقيقي على الخريطة أو مسح الإحداثيات.');
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
        setCustomerBanner({ type: 'success', text: `تم تحديث بيانات العميل (${formData.name.trim()}) بنجاح.` });
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
              text: `تم تسجيل العميل (${created.name}) وإنشاء وربط حساب التطبيق (${portalUsername.trim()}) تلقائياً بنجاح.`,
            });
          } else {
            setCustomerBanner({
              type: 'error',
              text: `تم تسجيل العميل (${created.name})، لكن تعذر إنشاء حساب الدخول: ${linkRes.error || 'خطأ غير متوقع'}`,
            });
          }
        } else {
          setCustomerBanner({ type: 'success', text: `تم تسجيل العميل (${created.name}) في المنظومة بنجاح.` });
        }
      }
      setIsAddModalOpen(false);
    } catch (err: any) {
      setCustomerFormError(err?.message || 'حدث خطأ أثناء حفظ بيانات العميل');
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
      setDeleteErrorMessage(res.error || 'تعذر حذف العميل لوجود معاملات مالية مرتبطة به.');
    }
  };

  // Quick Payment collection
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentCustomer || isSubmittingPayment) return;
    setPaymentError(null);
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      setPaymentError('يرجى إدخال مبلغ تحصيل صحيح أكبر من صفر');
      return;
    }
    const numericPayAmt = Number(paymentAmount);
    if (!isRepRole && !paymentCashboxId) {
      setPaymentError('يرجى اختيار الخزينة المودع بها المبلغ');
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const methodLabel = paymentMethod === 'bank' ? 'تحويل بنكي' : paymentMethod === 'cheque' ? 'شيك' : 'نقدي';
      const defaultNote = `تحصيل (${methodLabel}) من الحساب`;
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
          title: `سند قبض (${methodLabel}) من عميل`,
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
              ? `${paymentNotes.trim() || defaultNote} | رصيد دائن للعميل (دفعة مقدمة): ${Math.abs(nextBalance).toLocaleString()} ${settings.currency}`
              : paymentNotes.trim() || 'تم تحصيل المبلغ وإيداعه في الخزينة المعتمدة بنجاح.',
        });
        setIsPrintModalOpen(true);
        setPaymentError(null);
        setPaymentCustomer(null);
        setPaymentAmount('');
        setPaymentNotes('');
        setPaymentMethod('cash');
        setCustomerBanner({ type: 'success', text: `تم تحصيل مبلغ ${numericPayAmt.toLocaleString()} ${settings.currency} من العميل (${paymentCustomer.name}) بنجاح.` });
      } else {
        setPaymentError(res.error || 'تعذر تسجيل الدفعة');
      }
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Print Statement
  const handlePrintStatement = () => {
    if (!selectedCustomer) return;
    setPrintData({
      title: 'كشف حساب عميل مفصل ومعتمد',
      docNumber: selectedCustomer.code,
      docType: 'كشف حساب',
      date: new Date().toISOString().split('T')[0],
      partyName: selectedCustomer.name,
      partyPhone: selectedCustomer.phone,
      partyAddress: selectedCustomer.address,
      grandTotal: selectedCustomer.currentBalance,
      currentBalance: selectedCustomer.currentBalance,
      tableHeaders: ['م', 'نوع الحركة والبيان', 'التاريخ', 'العدد', 'مدين (+)', 'دائن (-)', 'الرصيد التراكمي'],
      notes: `رصيد أول المدة: ${selectedCustomer.openingBalance.toLocaleString()} ${settings.currency} | إجمالي عدد الحركات: ${chronologicalStatement.length}`,
      items: chronologicalStatement.map(row => ({
        name: `${row.type} (${row.docNumber}) - ${row.description}`,
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
      title: 'بطاقة بيانات عميل / محل غذائي',
      docNumber: selectedCustomer.code,
      docType: 'كشف حساب',
      date: new Date().toISOString().split('T')[0],
      partyName: selectedCustomer.shopName ? `${selectedCustomer.name} — ${selectedCustomer.shopName}` : selectedCustomer.name,
      partyPhone: [selectedCustomer.phone, selectedCustomer.secondaryPhone].filter(Boolean).join(' / '),
      partyAddress: [selectedCustomer.area, selectedCustomer.address].filter(Boolean).join(' - '),
      previousBalance: selectedCustomer.openingBalance,
      currentBalance: selectedCustomer.currentBalance,
      grandTotal: Math.abs(selectedCustomer.currentBalance),
      tableHeaders: ['م', 'بند البيانات', 'القيمة', 'العدد', 'القيمة الإجمالية', 'الخصم', 'الرصيد'],
      items: [
        { name: 'إجمالي فواتير المبيعات', unit: `${selectedCustomerInvoices.length} فاتورة`, quantity: selectedCustomerInvoices.length, price: 0, discount: 0, total: selectedCustomerInvoices.reduce((a, b) => a + b.grandTotal, 0) },
        { name: 'إجمالي التحصيلات المستلمة', unit: `${selectedCustomerPayments.length} سند`, quantity: selectedCustomerPayments.length, price: 0, discount: 0, total: selectedCustomerPayments.reduce((a, b) => a + b.amount, 0) },
        { name: 'إجمالي المرتجعات', unit: `${selectedCustomerReturns.length} مرتجع`, quantity: selectedCustomerReturns.length, price: 0, discount: 0, total: selectedCustomerReturns.reduce((a, b) => a + b.grandTotal, 0) },
      ],
      notes: selectedCustomer.notes || `حالة العميل: ${selectedCustomer.status === 'active' ? 'نشط' : 'محظور'}`,
    });
    setIsPrintModalOpen(true);
  };

  // Export Statement to Excel
  const handleExportStatementExcel = () => {
    if (!selectedCustomer) return;
    const headers = ['التاريخ', 'رقم المستند', 'نوع الحركة', 'البيان والتفاصيل', 'مدين (+)', 'دائن (-)', 'الرصيد التراكمي'];
    const rows = chronologicalStatement.map(r => [
      r.date,
      r.docNumber,
      r.type,
      r.description,
      r.debit,
      r.credit,
      r.runningBalance,
    ]);
    exportToExcel(`كشف_حساب_${selectedCustomer.name}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handleExportStatementPdf = () => {
    if (!selectedCustomer) return;
    exportTableToPdf(
      `كشف حساب العميل (${selectedCustomer.name})`,
      ['التاريخ', 'رقم المستند', 'نوع الحركة', 'البيان والتفاصيل', 'مدين (+)', 'دائن (-)', 'الرصيد التراكمي'],
      chronologicalStatement.map(r => [
        r.date,
        r.docNumber,
        r.type,
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
          { label: 'اسم العميل', value: selectedCustomer.name },
          { label: 'الموبايل', value: selectedCustomer.phone },
          { label: 'الرصيد الحالي', value: `${selectedCustomer.currentBalance.toLocaleString()} ${settings.currency}` },
        ],
        notes: `رصيد أول المدة: ${selectedCustomer.openingBalance.toLocaleString()} ${settings.currency} | إجمالي عدد الحركات: ${chronologicalStatement.length}`,
      }
    );
  };

  // Print Invoice from Customer Profile
  const handlePrintSingleInvoice = (inv: Invoice) => {
    setPrintData({
      title: 'فاتورة مبيعات سلع غذائية',
      docNumber: inv.invoiceNumber,
      docType: 'فاتورة مبيعات',
      date: inv.date,
      partyName: inv.customerName,
      partyPhone: selectedCustomer?.phone || '',
      partyAddress: selectedCustomer?.address || '',
      warehouseName: inv.warehouseName,
      representativeName: inv.representativeName,
      paymentType: inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'credit' ? 'آجل' : 'سداد جزئي',
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
            إغلاق
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
              <ArrowRight className="w-3.5 h-3.5" />
              <span>العودة لدليل العملاء</span>
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
                <span>وضع عدم الاتصال (Offline) - حفظ فوري ومزامنة تلقائية</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px]">
                <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                <span>متصل بالإنترنت - البيانات متزامنة محلياً</span>
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
                    title="اضغط لعرض صورة المحل بالحجم الكامل"
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
                    <span className="text-[9px] font-bold text-slate-400">بلا صورة</span>
                  </div>
                )}
                <span className={`absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded text-[9px] font-black border ${
                  selectedCustomer.status === 'active' 
                    ? 'bg-emerald-600 text-white border-white' 
                    : 'bg-red-600 text-white border-white'
                }`}>
                  {selectedCustomer.status === 'active' ? 'محل نشط' : 'محظور'}
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
                      <span>رصيد محلي مبدئي لحين المزامنة</span>
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
                      return (
                        <a
                          key={ph.id || idx}
                          href={`tel:${clean}`}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono font-black border transition-all active:scale-95 cursor-pointer ${
                            ph.isPrimary || idx === 0
                              ? 'bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border-[#DCE6F5]'
                              : 'bg-slate-50 hover:bg-slate-100 text-[#003589] border-slate-200'
                          }`}
                          title={`اتصال مباشر (${ph.label || 'هاتف'})`}
                        >
                          <Phone className="w-3.5 h-3.5 shrink-0" />
                          <span>{rawPhone}</span>
                          {ph.label && (
                            <span className="font-sans text-[10px] opacity-80">({ph.label})</span>
                          )}
                        </a>
                      );
                    });
                  })()}

                  {/* Read-Only Google Maps Location Viewer Button */}
                  <button
                    type="button"
                    onClick={() => setLocationViewerCustomer(selectedCustomer)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-bold border border-[#DCE6F5] transition-all cursor-pointer text-right"
                    title="عرض موقع المحل المسجل على الخريطة"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#003589] shrink-0" />
                    <span className="whitespace-normal break-words">{selectedCustomer.address || 'عرض الموقع'}</span>
                  </button>
                </div>

                {selectedCustomer.notes && (
                  <p className="text-xs text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-md border border-slate-100 max-w-xl">
                    <span className="font-bold text-slate-700 ml-1">ملاحظات:</span>
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
                <span>تسجيل تحصيل نقدية</span>
              </button>

              <button
                onClick={(e) => handleOpenEdit(selectedCustomer, e)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#011E58] hover:bg-[#002160] text-white rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
              >
                <Edit className="w-3.5 h-3.5" />
                <span>تعديل البيانات والصورة</span>
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
                  <span>{selectedCustomer.userId ? 'تغيير ربط حساب التطبيق' : 'ربط / إنشاء حساب دخول للعميل'}</span>
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
                          text: `تم ${nextActive ? 'تفعيل' : 'إيقاف'} حساب دخول العميل (${linkedUser.username}) بنجاح.`,
                        });
                      } else {
                        setCustomerBanner({ type: 'error', text: res.error || 'تعذر تغيير حالة حساب الدخول' });
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
                  title={`حساب الدخول: ${linkedUser.username}`}
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{linkedUser.isActive === false ? 'تفعيل حساب الدخول' : 'إيقاف حساب الدخول'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handlePrintCustomerCard}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title="طباعة بطاقة العميل"
              >
                <Printer className="w-3.5 h-3.5 text-[#003589]" />
                <span>بطاقة العميل</span>
              </button>

              <button
                type="button"
                onClick={handlePrintStatement}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title="طباعة كشف الحساب"
              >
                <Printer className="w-3.5 h-3.5 text-slate-600" />
                <span>طباعة</span>
              </button>

              <button
                type="button"
                onClick={handleExportStatementExcel}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title="تصدير كشف الحساب Excel"
              >
                <Download className="w-3.5 h-3.5 text-[#003589]" />
                <span>Excel</span>
              </button>

              <button
                type="button"
                onClick={handleExportStatementPdf}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] rounded-md text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title="تصدير كشف الحساب PDF"
              >
                <FileText className="w-3.5 h-3.5 text-[#003589]" />
                <span>PDF</span>
              </button>

              <button
                onClick={(e) => handleDeleteCustomerClick(selectedCustomer, e)}
                className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition-all cursor-pointer"
                title="حذف العميل وفق الصلاحيات"
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
                الرصيد الحالي المستحق
                {tentativeCustomerIds.has(selectedCustomer.id) ? ' (مبدئي)' : ''}
              </span>
              <div className={`text-sm font-black font-mono tabular-nums ${
                isDebtor ? 'text-red-700' : isCreditor ? 'text-emerald-700' : 'text-slate-800'
              }`}>
                {selectedCustomer.currentBalance.toLocaleString()} {settings.currency}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                {isDebtor ? '(مديونية مستحقة للشركة)' : isCreditor ? '(رصيد دائن مدفوع مقدماً)' : '(الحساب خالص ومتوازن)'}
                {tentativeCustomerIds.has(selectedCustomer.id) ? ' · بانتظار اعتماد المزامنة' : ''}
              </span>
            </div>

            {/* Total Sales Value */}
            <div className="px-2.5 py-1.5 bg-white">
              <span className="text-[11px] font-bold text-slate-600 block">إجمالي المبيعات والفواتير</span>
              <div className="text-sm font-black font-mono tabular-nums text-blue-950">
                {selectedCustomerInvoices.reduce((a, b) => a + b.grandTotal, 0).toLocaleString()} {settings.currency}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                عدد {selectedCustomerInvoices.length} فاتورة مبيعات
              </span>
            </div>

            {/* Total Payments Collected */}
            <div className="px-2.5 py-1.5 bg-white">
              <span className="text-[11px] font-bold text-slate-600 block">إجمالي التحصيلات والدفعات المقدمة</span>
              <div className="text-sm font-black font-mono tabular-nums text-emerald-800">
                {(
                  selectedCustomerPayments.reduce((a, b) => a + b.amount, 0) +
                  selectedCustomerAdvances.filter(a => a.status !== 'refunded').reduce((a, b) => a + b.amount, 0) +
                  selectedCustomerInvoices.reduce((a, b) => {
                    if (b.status !== 'confirmed') return a;
                    const cashAtInv = b.paidAtInvoice !== undefined ? b.paidAtInvoice : Math.max(0, b.paidAmount - (b.appliedAdvanceAmount || 0));
                    return a + cashAtInv;
                  }, 0)
                ).toLocaleString()} {settings.currency}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                سندات قبض + دفعات طلبات مقدمة + مدفوع فواتير
              </span>
            </div>

            {/* Total Returns */}
            <div className="px-2.5 py-1.5 bg-white">
              <span className="text-[11px] font-bold text-slate-600 block">إجمالي المرتجعات</span>
              <div className="text-sm font-black font-mono tabular-nums text-amber-800">
                {selectedCustomerReturns.reduce((a, b) => a + b.grandTotal, 0).toLocaleString()} {settings.currency}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                عدد {selectedCustomerReturns.length} حركة مرتجع
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
            <span>كشف الحساب المالي المفصل ({chronologicalStatement.length})</span>
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
            <span>فواتير المبيعات ({selectedCustomerInvoices.length})</span>
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
            <span>الطلبات ({selectedCustomerOrders.length})</span>
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
            <span>الدفعات المقدمة ({selectedCustomerAdvances.length})</span>
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
            <span>سندات القبض والتحصيلات ({selectedCustomerPayments.length})</span>
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
            <span>المرتجعات ({selectedCustomerReturns.length})</span>
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
            <span>تاريخ أسعار المنتجات المشتراة</span>
          </button>
        </div>

        {/* Tab 1: Comprehensive Account Statement */}
        {detailTab === 'statement' && (
          <UnifiedDataTable<StatementRow>
            title="دفتر أستاذ كشف الحساب التراكمي (Ledger)"
            subtitle="كافة قيود الفواتير والتحصيلات والمرتجعات مرتبة زمنياً لحساب الرصيد المستحق بدقة"
            data={chronologicalStatement}
            rowKey={(r) => r.id}
            compact
            searchPlaceholder="بحث في كشف الحساب برقم المستند أو البيان..."
            searchFilter={(r, q) =>
              r.docNumber.toLowerCase().includes(q) ||
              r.type.toLowerCase().includes(q) ||
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
                  <span>طباعة كشف الحساب</span>
                </button>
              </div>
            }
            columns={[
              {
                key: 'date',
                header: 'التاريخ',
                sortable: true,
                sortValue: (r) => r.date,
                exportValue: (r) => r.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (r) => r.date,
              },
              {
                key: 'docNumber',
                header: 'رقم المستند',
                sortable: true,
                sortValue: (r) => r.docNumber,
                exportValue: (r) => r.docNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (r) => r.docNumber,
              },
              {
                key: 'type',
                header: 'نوع الحركة',
                sortable: true,
                sortValue: (r) => r.type,
                exportValue: (r) => r.type,
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
                    {r.type}
                  </span>
                ),
              },
              {
                key: 'description',
                header: 'البيان والشرح',
                exportValue: (r) => r.description,
                cellClassName: 'text-slate-700 max-w-xs',
                render: (r) => r.description,
              },
              {
                key: 'debit',
                header: 'مدين (+) [دين جديد]',
                align: 'center',
                sortable: true,
                sortValue: (r) => r.debit,
                exportValue: (r) => r.debit,
                cellClassName: 'font-mono font-bold text-red-700 tabular-nums',
                render: (r) => (r.debit > 0 ? r.debit.toLocaleString() : '-'),
              },
              {
                key: 'credit',
                header: 'دائن (-) [سداد]',
                align: 'center',
                sortable: true,
                sortValue: (r) => r.credit,
                exportValue: (r) => r.credit,
                cellClassName: 'font-mono font-bold text-emerald-700 tabular-nums',
                render: (r) => (r.credit > 0 ? r.credit.toLocaleString() : '-'),
              },
              {
                key: 'runningBalance',
                header: 'الرصيد التراكمي',
                align: 'center',
                sortable: true,
                sortValue: (r) => r.runningBalance,
                exportValue: (r) => r.runningBalance,
                cellClassName: 'font-mono font-black tabular-nums whitespace-nowrap',
                render: (r) => (
                  <span className={r.runningBalance > 0 ? 'text-red-700' : r.runningBalance < 0 ? 'text-emerald-700' : 'text-slate-800'}>
                    {r.runningBalance.toLocaleString()} {settings.currency}
                  </span>
                ),
              },
            ]}
            footerTotalsRow={
              chronologicalStatement.length > 0 ? (
                <tr className="bg-blue-950/5 font-black text-slate-900 border-t-2 border-blue-900/20">
                  <td colSpan={4} className="p-2.5 text-right">الإجمالي التراكمي لكشف الحساب ({chronologicalStatement.length} حركة):</td>
                  <td className="p-2.5 text-center font-mono text-red-700 tabular-nums">
                    {chronologicalStatement.reduce((s, r) => s + r.debit, 0).toLocaleString()}
                  </td>
                  <td className="p-2.5 text-center font-mono text-emerald-700 tabular-nums">
                    {chronologicalStatement.reduce((s, r) => s + r.credit, 0).toLocaleString()}
                  </td>
                  <td className="p-2.5 text-center font-mono tabular-nums text-blue-950">
                    {selectedCustomer.currentBalance.toLocaleString()} {settings.currency}
                  </td>
                </tr>
              ) : undefined
            }
            emptyTitle="لا توجد حركات مالية أو فواتير مسجلة لهذا العميل حتى الآن."
          />
        )}

        {/* Tab 2: Sales Invoices */}
        {detailTab === 'invoices' && (
          <UnifiedDataTable<Invoice>
            title="سجل فواتير المبيعات الصادرة للمحل"
            subtitle="جميع الفواتير المرتبطة بهذا العميل وإمكانية استعراضها وطباعتها"
            data={selectedCustomerInvoices}
            rowKey={(inv) => inv.id}
            compact
            exportFilename={`فواتير_العميل_${selectedCustomer.name}`}
            pdfTitle={`فواتير مبيعات العميل (${selectedCustomer.name})`}
            searchPlaceholder="بحث برقم الفاتورة أو المستودع أو المندوب..."
            searchFilter={(inv, q) =>
              inv.invoiceNumber.toLowerCase().includes(q) ||
              (inv.warehouseName || '').toLowerCase().includes(q) ||
              (inv.representativeName || '').toLowerCase().includes(q) ||
              inv.date.includes(q)
            }
            columns={[
              {
                key: 'invoiceNumber',
                header: 'رقم الفاتورة',
                sortable: true,
                sortValue: (i) => i.invoiceNumber,
                exportValue: (i) => i.invoiceNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (i) => i.invoiceNumber,
              },
              {
                key: 'date',
                header: 'التاريخ',
                sortable: true,
                sortValue: (i) => i.date,
                exportValue: (i) => i.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (i) => i.date,
              },
              {
                key: 'warehouse',
                header: 'المستودع',
                exportValue: (i) => i.warehouseName,
                cellClassName: 'text-slate-700',
                render: (i) => i.warehouseName,
              },
              {
                key: 'rep',
                header: 'المندوب',
                exportValue: (i) => i.representativeName || '-',
                cellClassName: 'text-slate-600',
                render: (i) => i.representativeName || '-',
              },
              {
                key: 'grandTotal',
                header: 'إجمالي الفاتورة',
                align: 'center',
                sortable: true,
                sortValue: (i) => i.grandTotal,
                exportValue: (i) => i.grandTotal,
                cellClassName: 'font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap',
                render: (i) => `${i.grandTotal.toLocaleString()} ${settings.currency}`,
              },
              {
                key: 'paidAmount',
                header: 'المدفوع نقداً',
                align: 'center',
                sortable: true,
                sortValue: (i) => i.paidAmount,
                exportValue: (i) => i.paidAmount,
                cellClassName: 'font-mono font-bold text-emerald-700 tabular-nums',
                render: (i) => i.paidAmount.toLocaleString(),
              },
              {
                key: 'remainingAmount',
                header: 'المتبقي (آجل)',
                align: 'center',
                sortable: true,
                sortValue: (i) => i.remainingAmount,
                exportValue: (i) => i.remainingAmount,
                cellClassName: 'font-mono font-bold text-red-600 tabular-nums',
                render: (i) => i.remainingAmount.toLocaleString(),
              },
              {
                key: 'paymentType',
                header: 'طريقة السداد',
                exportValue: (i) => (i.paymentType === 'cash' ? 'نقدي' : i.paymentType === 'credit' ? 'آجل' : 'جزئي'),
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
                    {i.paymentType === 'cash' ? 'نقدي' : i.paymentType === 'credit' ? 'آجل' : 'جزئي'}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'الحالة',
                exportValue: (i) => (i.status === 'confirmed' ? 'مؤكدة' : 'ملغاة'),
                render: (i) => (
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                    {i.status === 'confirmed' ? 'مؤكدة' : 'ملغاة'}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: 'الإجراءات',
                align: 'center',
                render: (inv) => (
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewInvoice(inv)}
                      className="p-1.5 text-blue-900 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                      title="استعراض الفاتورة"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePrintSingleInvoice(inv)}
                      className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                      title="طباعة الفاتورة"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>
                ),
              },
            ]}
            emptyTitle="لا توجد فواتير مبيعات مسجلة لهذا العميل حتى الآن."
          />
        )}

        {/* Tab 3: Payments & Receipts */}
        {detailTab === 'payments' && (
          <UnifiedDataTable
            title="سجل سندات القبض والتحصيلات النقدية"
            subtitle="جميع المبالغ المحصلة نقدياً وتم توريدها إلى الخزينة"
            data={selectedCustomerPayments}
            rowKey={(pay) => pay.id}
            compact
            exportFilename={`تحصيلات_${selectedCustomer.name}`}
            pdfTitle={`سندات قبض العميل (${selectedCustomer.name})`}
            searchPlaceholder="بحث برقم السند أو الخزينة أو البيان..."
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
                <span>تحصيل نقدية جديد</span>
              </button>
            }
            columns={[
              {
                key: 'transactionNumber',
                header: 'رقم السند',
                sortable: true,
                sortValue: (p) => p.transactionNumber,
                exportValue: (p) => p.transactionNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (p) => p.transactionNumber,
              },
              {
                key: 'date',
                header: 'التاريخ',
                sortable: true,
                sortValue: (p) => p.date,
                exportValue: (p) => p.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (p) => p.date,
              },
              {
                key: 'cashboxName',
                header: 'الخزينة المودع بها',
                exportValue: (p) => p.cashboxName,
                cellClassName: 'font-bold text-slate-800',
                render: (p) => p.cashboxName,
              },
              {
                key: 'amount',
                header: 'المبلغ المحصل',
                align: 'center',
                sortable: true,
                sortValue: (p) => p.amount,
                exportValue: (p) => p.amount,
                cellClassName: 'font-mono font-black text-emerald-700 tabular-nums whitespace-nowrap',
                render: (p) => `${p.amount.toLocaleString()} ${settings.currency}`,
              },
              {
                key: 'notes',
                header: 'البيان والملاحظات',
                exportValue: (p) => p.notes || p.description || '',
                cellClassName: 'text-slate-600',
                render: (p) => p.notes || p.description,
              },
              {
                key: 'createdBy',
                header: 'المسؤول عن التسجيل',
                exportValue: (p) => p.createdBy || '',
                cellClassName: 'text-slate-500',
                render: (p) => p.createdBy,
              },
              {
                key: 'print',
                header: 'طباعة الإيصال',
                align: 'center',
                render: (pay) => (
                  <button
                    type="button"
                    onClick={() => {
                      setPrintData({
                        title: 'سند قبض نقدية من عميل',
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
                    title="إعادة طباعة سند القبض"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                ),
              },
            ]}
            emptyTitle="لا توجد سندات تحصيل نقدية مسجلة لهذا العميل حتى الآن."
          />
        )}

        {/* Tab 4: Sales Returns */}
        {detailTab === 'returns' && (
          <UnifiedDataTable
            title="سجل بضائع المرتجعات لهذا العميل"
            subtitle="حركات إرجاع البضائع التالفة أو المسترجعة والتسويات المالية الناتجة عنها"
            data={selectedCustomerReturns}
            rowKey={(ret) => ret.id}
            compact
            exportFilename={`مرتجعات_${selectedCustomer.name}`}
            pdfTitle={`مرتجعات العميل (${selectedCustomer.name})`}
            searchPlaceholder="بحث برقم المرتجع أو الفاتورة الأصلية..."
            searchFilter={(ret, q) =>
              ret.returnNumber.toLowerCase().includes(q) ||
              (ret.originalInvoiceNumber || '').toLowerCase().includes(q) ||
              (ret.reason || '').toLowerCase().includes(q)
            }
            columns={[
              {
                key: 'returnNumber',
                header: 'رقم إشعار المرتجع',
                sortable: true,
                sortValue: (r) => r.returnNumber,
                exportValue: (r) => r.returnNumber,
                cellClassName: 'font-mono font-bold text-amber-800 whitespace-nowrap',
                render: (r) => r.returnNumber,
              },
              {
                key: 'date',
                header: 'التاريخ',
                sortable: true,
                sortValue: (r) => r.date,
                exportValue: (r) => r.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (r) => r.date,
              },
              {
                key: 'originalInvoiceNumber',
                header: 'الفاتورة الأصلية',
                exportValue: (r) => r.originalInvoiceNumber || '',
                cellClassName: 'font-mono text-blue-900 whitespace-nowrap',
                render: (r) => r.originalInvoiceNumber,
              },
              {
                key: 'warehouseName',
                header: 'المستودع المستلم',
                exportValue: (r) => r.warehouseName,
                cellClassName: 'text-slate-700',
                render: (r) => r.warehouseName,
              },
              {
                key: 'grandTotal',
                header: 'إجمالي قيمة المرتجع',
                align: 'center',
                sortable: true,
                sortValue: (r) => r.grandTotal,
                exportValue: (r) => r.grandTotal,
                cellClassName: 'font-mono font-black text-amber-800 tabular-nums whitespace-nowrap',
                render: (r) => `${r.grandTotal.toLocaleString()} ${settings.currency}`,
              },
              {
                key: 'refundType',
                header: 'طريقة رد المبلغ',
                exportValue: (r) => (r.refundType === 'cash' ? 'رد نقدي فوري' : 'خصم من مديونية الحساب'),
                render: (r) => (
                  <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-[10px]">
                    {r.refundType === 'cash' ? 'رد نقدي فوري' : 'خصم من مديونية الحساب'}
                  </span>
                ),
              },
              {
                key: 'reason',
                header: 'سبب الإرجاع',
                exportValue: (r) => r.reason || '',
                cellClassName: 'text-slate-600',
                render: (r) => r.reason,
              },
            ]}
            emptyTitle="لا توجد مرتجعات مسجلة لهذا العميل."
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
              name: prod?.name || `صنف (${prodId})`,
              prices: normalized,
              latestPrice: normalized.length > 0 ? normalized[normalized.length - 1].price : 0,
            };
          });
          return (
            <UnifiedDataTable
              title="سجل الأسعار التاريخية للمنتجات المشتراة (آخر 3 أسعار)"
              subtitle="يعرض النظام تلقائياً آخر ثلاثة أسعار فعلية اشترى بها هذا العميل كل صنف للمقارنة عند إصدار الفواتير"
              data={priceRows}
              rowKey={(r) => r.id}
              compact
              exportFilename={`اسعار_العميل_${selectedCustomer.name}`}
              pdfTitle={`تاريخ أسعار منتجات العميل (${selectedCustomer.name})`}
              searchPlaceholder="بحث باسم الصنف أو الكود..."
              searchFilter={(r, q) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)}
              columns={[
                {
                  key: 'code',
                  header: 'كود الصنف',
                  sortable: true,
                  sortValue: (r) => r.code,
                  exportValue: (r) => r.code,
                  cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                  render: (r) => r.code,
                },
                {
                  key: 'name',
                  header: 'اسم الصنف',
                  sortable: true,
                  sortValue: (r) => r.name,
                  exportValue: (r) => r.name,
                  cellClassName: 'font-bold text-slate-900',
                  render: (r) => r.name,
                },
                {
                  key: 'history',
                  header: 'آخر 3 أسعار مسجلة (من الأقدم للأحدث)',
                  exportValue: (r) => r.prices.map((p) => `${p.price}${p.date ? ` (${p.date})` : ''}`).join(' | '),
                  render: (r) => (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.prices.map((entry, idx) => (
                        <span key={idx} className="font-mono font-bold px-2 py-0.5 rounded bg-slate-50 border border-slate-300 text-slate-800 text-[11px] tabular-nums">
                          {entry.price.toLocaleString()} {settings.currency}
                          {entry.unit ? ` / ${entry.unit}` : ''}
                          {entry.date ? <span className="text-[10px] text-slate-400 mr-1">({entry.date})</span> : null}
                        </span>
                      ))}
                    </div>
                  ),
                },
                {
                  key: 'latest',
                  header: 'آخر سعر بيع',
                  align: 'center',
                  sortable: true,
                  sortValue: (r) => r.latestPrice,
                  exportValue: (r) => r.latestPrice,
                  cellClassName: 'font-mono font-black text-blue-950 tabular-nums whitespace-nowrap',
                  render: (r) => `${r.latestPrice.toLocaleString()} ${settings.currency}`,
                },
              ]}
              emptyTitle="لم يتم تسجيل عمليات بيع سابقة لهذا العميل لتكوين سجل الأسعار بعد."
            />
          );
        })()}

        {/* Tab: Customer Orders */}
        {detailTab === 'orders' && (
          <UnifiedDataTable<CustomerItemOrderRequest>
            title="طلبات العميل الموحدة"
            subtitle="طلبات الشراء الواردة من تطبيق العميل أو عبر المندوبين وحالتها والدفعات المقدمة عليها"
            data={selectedCustomerOrders}
            rowKey={(ord) => ord.id}
            compact
            exportFilename={`طلبات_${selectedCustomer.name}`}
            pdfTitle={`طلبات العميل (${selectedCustomer.name})`}
            searchPlaceholder="بحث برقم الطلب أو الفاتورة..."
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
                  فتح قسم الطلبات
                </button>
              ) : undefined
            }
            columns={[
              {
                key: 'requestNumber',
                header: 'رقم الطلب',
                sortable: true,
                sortValue: (o) => o.requestNumber,
                exportValue: (o) => o.requestNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (o) => o.requestNumber,
              },
              {
                key: 'date',
                header: 'التاريخ',
                sortable: true,
                sortValue: (o) => o.createdAt || '',
                exportValue: (o) => (o.createdAt || '').slice(0, 10),
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (o) => (o.createdAt || '').slice(0, 10),
              },
              {
                key: 'itemsCount',
                header: 'عدد الأصناف',
                align: 'center',
                sortable: true,
                sortValue: (o) => o.items?.length || 0,
                exportValue: (o) => o.items?.length || 0,
                cellClassName: 'tabular-nums',
                render: (o) => `${o.items?.length || 0} أصناف`,
              },
              {
                key: 'totalAmount',
                header: 'الإجمالي',
                align: 'center',
                sortable: true,
                sortValue: (o) => Number(o.totalAmount || 0),
                exportValue: (o) => Number(o.totalAmount || 0),
                cellClassName: 'font-mono font-bold tabular-nums whitespace-nowrap',
                render: (o) => `${Number(o.totalAmount || 0).toLocaleString()} ${settings.currency}`,
              },
              {
                key: 'advancePaidAmount',
                header: 'الدفعة المقدمة',
                align: 'center',
                sortable: true,
                sortValue: (o) => Number(o.advancePaidAmount || 0),
                exportValue: (o) => Number(o.advancePaidAmount || 0),
                cellClassName: 'font-mono font-bold text-emerald-700 tabular-nums whitespace-nowrap',
                render: (o) =>
                  Number(o.advancePaidAmount || 0) > 0
                    ? `${Number(o.advancePaidAmount).toLocaleString()} ${settings.currency}`
                    : '—',
              },
              {
                key: 'status',
                header: 'الحالة',
                exportValue: (o) => o.status,
                cellClassName: 'font-bold',
                render: (o) => o.status,
              },
              {
                key: 'invoiceNumber',
                header: 'الفاتورة',
                exportValue: (o) => o.invoiceNumber || '—',
                cellClassName: 'font-mono text-blue-900 whitespace-nowrap',
                render: (o) => o.invoiceNumber || '—',
              },
            ]}
            emptyTitle="لا توجد طلبات مسجلة لهذا العميل."
          />
        )}

        {/* Tab: Customer Advance Payments */}
        {detailTab === 'advances' && (
          <UnifiedDataTable
            title="سجل الدفعات المقدمة على الطلبات"
            subtitle="تُقيد في حساب العميل الدائن والخزينة عند الاستلام وتُطبق تلقائياً عند تحويل الطلب إلى فاتورة دون تكرار"
            data={selectedCustomerAdvances}
            rowKey={(adv) => adv.id}
            compact
            exportFilename={`دفعات_مقدمة_${selectedCustomer.name}`}
            pdfTitle={`الدفعات المقدمة للعميل (${selectedCustomer.name})`}
            searchPlaceholder="بحث برقم الدفعة أو الخزينة أو الملاحظات..."
            searchFilter={(adv, q) =>
              adv.paymentNumber.toLowerCase().includes(q) ||
              (adv.cashboxName || '').toLowerCase().includes(q) ||
              (adv.notes || '').toLowerCase().includes(q)
            }
            columns={[
              {
                key: 'paymentNumber',
                header: 'رقم الدفعة',
                sortable: true,
                sortValue: (a) => a.paymentNumber,
                exportValue: (a) => a.paymentNumber,
                cellClassName: 'font-mono font-bold text-blue-900 whitespace-nowrap',
                render: (a) => a.paymentNumber,
              },
              {
                key: 'date',
                header: 'التاريخ',
                sortable: true,
                sortValue: (a) => a.date,
                exportValue: (a) => a.date,
                cellClassName: 'font-mono text-slate-600 whitespace-nowrap',
                render: (a) => a.date,
              },
              {
                key: 'cashboxName',
                header: 'الخزينة',
                exportValue: (a) => a.cashboxName || a.cashboxId,
                cellClassName: 'font-bold',
                render: (a) => a.cashboxName || a.cashboxId,
              },
              {
                key: 'paymentMethod',
                header: 'الوسيلة',
                exportValue: (a) => (a.paymentMethod === 'bank' ? 'تحويل بنكي' : a.paymentMethod === 'cheque' ? 'شيك' : 'نقدي'),
                render: (a) => (a.paymentMethod === 'bank' ? 'تحويل بنكي' : a.paymentMethod === 'cheque' ? 'شيك' : 'نقدي'),
              },
              {
                key: 'amount',
                header: 'المبلغ',
                align: 'center',
                sortable: true,
                sortValue: (a) => Number(a.amount),
                exportValue: (a) => Number(a.amount),
                cellClassName: 'font-mono font-black text-emerald-700 tabular-nums whitespace-nowrap',
                render: (a) => `${Number(a.amount).toLocaleString()} ${settings.currency}`,
              },
              {
                key: 'status',
                header: 'الحالة',
                exportValue: (a) => (a.status === 'applied' ? 'مطبقة على فاتورة' : 'رصيد دائن متاح'),
                render: (a) => (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      a.status === 'applied'
                        ? 'bg-blue-50 text-blue-800 border border-blue-200'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    {a.status === 'applied' ? 'مطبقة على فاتورة' : 'رصيد دائن متاح'}
                  </span>
                ),
              },
              {
                key: 'notes',
                header: 'ملاحظات',
                exportValue: (a) => a.notes || '—',
                cellClassName: 'text-slate-600',
                render: (a) => a.notes || '—',
              },
            ]}
            emptyTitle="لا توجد دفعات مقدمة مسجلة على طلبات هذا العميل."
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
              <span>تنبيه تطابق بيانات العملاء وحسابات الدخول</span>
            </div>
            {conflicts.duplicatePhones.length > 0 && (
              <p>
                يوجد أرقام هواتف مكررة لدى أكثر من عميل ({conflicts.duplicatePhones.map((d) => d.phone).join('، ')}). يعتمد النظام الآن على ربط الحساب بالمعرف الثابت 1:1 بدلاً من الهاتف.
              </p>
            )}
            {conflicts.unlinkedCustomerUsers.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <p>
                  يوجد ({conflicts.unlinkedCustomerUsers.length}) حساب عميل غير مربوط بملف محل حتى الآن.
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
                          text: `تم إصلاح وربط (${res.repairedCount ?? 0}) حساب عميل بملفات عملاء 1:1 تلقائياً بنجاح.`,
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
                          text: res.error || 'تعذر إصلاح حسابات العملاء غير المربوطة',
                        });
                      }
                    } finally {
                      setIsRepairingUnlinked(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded-md bg-amber-700 hover:bg-amber-800 text-white font-black cursor-pointer disabled:opacity-50"
                >
                  {isRepairingUnlinked
                    ? 'جاري الإصلاح والربط...'
                    : 'إصلاح وربط الحسابات غير المربوطة تلقائياً'}
                </button>
              </div>
            )}
          </div>
        )}

      {/* Compact Summary Banner Routing to Dedicated Orders Section */}
      {customerItemOrders.length > 0 && (
        <section className="rounded-lg border border-[#DCE6F5] bg-[#EEF3FA] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-black text-[#011E58]">طلبات العملاء والمندوبين الواردة من الموبايل</h3>
            <span className="font-bold text-amber-800 tabular-nums">
              {customerItemOrders.filter((o) => o.status === 'pending').length} جديد
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-[#003589] tabular-nums">
              {customerItemOrders.filter((o) => o.status === 'under_review').length} قيد المراجعة
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-emerald-800 tabular-nums">
              {customerItemOrders.filter((o) => o.status === 'approved').length} مقبول
            </span>
          </div>

          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('customer-orders')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>فتح قسم الطلبات</span>
            </button>
          )}
        </section>
      )}

      {/* Top Header Strip */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900">
            العملاء والأرصدة <span className="text-xs font-mono tabular-nums text-slate-500">({customers.length})</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            أرصدة وكشوف حسابات العملاء للمبيعات المباشرة وطلبات التطبيق والمندوبين
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-bold transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>إضافة عميل / محل جديد</span>
        </button>
      </div>

      {/* Compact Accounting Summary Strip */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className={`grid grid-cols-1 ${canViewAggregateCustomerTotals ? 'sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200' : ''}`}>
          <div className="px-2.5 py-1.5">
            <span className="text-[11px] font-bold text-slate-500 block">إجمالي المحلات المسجلة</span>
            <div className="text-sm font-black text-slate-900 font-mono tabular-nums">
              {customers.length} <span className="text-[11px] font-sans font-semibold text-emerald-700">({customers.filter(c => c.status === 'active').length} نشط)</span>
            </div>
          </div>

          {canViewAggregateCustomerTotals && (
            <>
              <div className="px-2.5 py-1.5">
                <span className="text-[11px] font-bold text-slate-500 block">إجمالي مديونيات العملاء (لنا)</span>
                <div className="text-sm font-black text-red-700 font-mono tabular-nums">
                  {totalDebts.toLocaleString()} <span className="text-[11px] text-slate-500 font-normal">{settings.currency}</span>
                </div>
              </div>

              <div className="px-2.5 py-1.5">
                <span className="text-[11px] font-bold text-slate-500 block">أرصدة العملاء الدائنة (دفعات مقدمة)</span>
                <div className="text-sm font-black text-emerald-700 font-mono tabular-nums">
                  {totalCredits.toLocaleString()} <span className="text-[11px] text-slate-500 font-normal">{settings.currency}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <UnifiedDataTable<Customer>
        compact
        title="دليل العملاء والمحلات"
        subtitle="اضغط على أي صف لعرض الملف الشامل وكشف الحساب أو استخدم أدوات الاتصال والخريطة والتحصيل السريع"
        data={filteredCustomers}
        rowKey={(c) => c.id}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="بحث باسم المحل، رقم الموبايل، الكود، أو العنوان..."
        exportFilename="دليل_العملاء"
        pdfTitle="دليل العملاء والأرصدة"
        onRowClick={(cust) => setSelectedCustomerId(cust.id)}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-700 outline-hidden focus:border-blue-600"
            >
              <option value="all">جميع الحالات ({customers.length})</option>
              <option value="active">نشط فقط</option>
              <option value="blocked">محظور فقط</option>
            </select>
            <select
              value={classificationFilter}
              onChange={(e) => setClassificationFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-700 outline-hidden focus:border-blue-600"
            >
              <option value="all">جميع التصنيفات</option>
              <option value="app_and_direct">عميل تطبيق ومبيعات مباشرة</option>
              <option value="app_only">عميل تطبيق</option>
              <option value="regular">عميل عادي</option>
            </select>
          </div>
        }
        emptyTitle="لا يوجد عملاء مسجلون حالياً"
        emptySubtitle='انقر على زر "إضافة عميل / محل جديد" للبدء بتسجيل بيانات المحلات، الصور الميدانية، أرقام الموبايل، والعناوين.'
        columns={[
          {
            key: 'photo',
            header: 'صورة المحل',
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
            header: 'الكود',
            sortable: true,
            sortValue: (c) => c.code,
            exportValue: (c) => c.code,
            cellClassName: 'font-mono font-bold text-[#011E58] whitespace-nowrap',
            render: (c) => c.code,
          },
          {
            key: 'name',
            header: 'اسم المحل / العميل',
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
                        <span>مبدئي لحين المزامنة</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            },
          },
          {
            key: 'phone',
            header: 'الاتصال (موبايل)',
            sortable: true,
            sortValue: (c) => c.phone,
            exportValue: (c) => c.phone,
            render: (cust) => (
              <a
                href={`tel:${cust.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-mono font-bold border border-[#DCE6F5] whitespace-nowrap"
                title="اتصال مباشر"
              >
                <Phone className="w-3.5 h-3.5 text-[#003589]" />
                <span>{cust.phone}</span>
              </a>
            ),
          },
          {
            key: 'location',
            header: 'الموقع على الخريطة',
            exportValue: (c) => c.address || '',
            render: (cust) => (
              <div onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setLocationViewerCustomer(cust)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-bold border border-[#DCE6F5] min-w-[140px] max-w-[240px] text-right cursor-pointer"
                  title="عرض الموقع المسجل"
                >
                  <MapPin className="w-3 h-3 text-[#003589] shrink-0" />
                  <span className="whitespace-normal break-words">{cust.address || 'عرض الموقع'}</span>
                </button>
              </div>
            ),
          },
          {
            key: 'currentBalance',
            header: 'الرصيد الحالي',
            align: 'center',
            sortable: true,
            sortValue: (c) => c.currentBalance,
            exportValue: (c) => c.currentBalance,
            cellClassName: 'font-mono font-black tabular-nums whitespace-nowrap',
            render: (cust) => (
              <span className={cust.currentBalance > 0 ? 'text-red-700' : cust.currentBalance < 0 ? 'text-emerald-700' : 'text-slate-800'}>
                {cust.currentBalance.toLocaleString()} {settings.currency}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'الحالة',
            align: 'center',
            sortable: true,
            sortValue: (c) => c.status,
            exportValue: (c) => (c.status === 'active' ? 'نشط' : 'محظور'),
            render: (cust) => (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  cust.status === 'active'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {cust.status === 'active' ? 'نشط' : 'محظور'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'الإجراءات',
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
                  title="تحصيل نقدية"
                >
                  <ArrowDownLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCustomerId(cust.id)}
                  className="p-1.5 bg-[#EEF3FA] text-[#011E58] hover:bg-[#DCE6F5] rounded-md cursor-pointer"
                  title="استعراض الملف الشامل"
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
                    title={cust.userId ? 'مرتبط بحساب دخول' : 'إنشاء أو ربط حساب دخول للتطبيق'}
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
                  title="تعديل بيانات المحل والصورة"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDeleteCustomerClick(cust, e)}
                  className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                  title="حذف العميل"
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
        title={editingCustomer ? 'تعديل بيانات المحل وصورته' : 'إضافة عميل / محل غذائي جديد'}
        subtitle="يرجى إدخال صورة المحل، اسم المحل، رقم الموبايل، وعنوان المحل بالتفصيل"
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
              صورة المحل / المنشأة:
            </label>

            <div className="flex flex-col sm:flex-row items-center gap-2.5">
              {/* Photo Preview */}
              <div className="relative w-16 h-16 rounded-md border border-slate-300 bg-white overflow-hidden flex items-center justify-center shrink-0">
                {formData.photo ? (
                  <img
                    src={formData.photo}
                    alt="صورة المحل"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center text-slate-400 p-1">
                    <Store className="w-6 h-6 mx-auto stroke-[1.5] text-slate-300" />
                    <span className="text-[10px] block mt-0.5">لا توجد صورة</span>
                  </div>
                )}
                {formData.photo && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="absolute top-1 left-1 bg-red-600 text-white rounded-full p-0.5 hover:bg-red-700 cursor-pointer"
                    title="حذف الصورة"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Upload Action */}
              <div className="flex-1 space-y-1.5 text-center sm:text-right">
                <p className="text-[11px] text-slate-500">
                  التقط صورة المحل بالكاميرا أو اختر من جهازك (يتم ضغطها تلقائياً للعمل دون إنترنت).
                </p>

                <div className="flex flex-wrap items-center gap-1.5 justify-center sm:justify-start">
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#003589] hover:bg-[#0049B0] text-white font-bold rounded-md text-xs cursor-pointer transition-colors">
                    <Camera className="w-3.5 h-3.5" />
                    <span>{formData.photo ? 'التقاط صورة جديدة' : 'تصوير بالكاميرا'}</span>
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
                    <span>اختيار من المعرض</span>
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
                      حذف الصورة
                    </button>
                  )}
                </div>

                {isUploadingPhoto && (
                  <div className="flex items-center gap-1.5 text-blue-900 font-bold text-[11px]">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>جاري معالجة وضغط الصورة...</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Form Inputs Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                اسم تاجر الجملة / العميل: <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="مثال: الحاج طارق سليم"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                اسم المحل أو المنشأة:
              </label>
              <input
                type="text"
                placeholder="مثال: سوبرماركت البركة لتجارة التجزئة"
                value={formData.shopName}
                onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div className="sm:col-span-2 space-y-2 bg-slate-50/70 p-2.5 rounded-lg border border-slate-200">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  رقم الهاتف الرئيسي: <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="tel"
                    required
                    placeholder="مثال: 01012345678"
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
                            text: `جاري فتح الاتصال بالرقم (${cleanedPhone}) عبر تطبيق الهاتف.`,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] font-bold shrink-0 transition-colors"
                        title="اتصال هاتفي بالرقم"
                      >
                        <Phone className="w-3.5 h-3.5 text-[#003589]" />
                        <span>اتصال</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setPhoneActionNotice({
                            type: 'error',
                            text: 'يرجى إدخال رقم هاتف صحيح (7 أرقام على الأقل) لإجراء الاتصال.',
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300 font-bold shrink-0 cursor-pointer transition-colors"
                        title="اتصال هاتفي"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>اتصال</span>
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
                  <label className="block font-bold text-slate-600 text-[11px]">أرقام الهاتف الإضافية:</label>
                  {formData.extraPhones.map((extra, idx) => {
                    const cleanExtra = extra.phone.replace(/[^\d+]/g, '');
                    const isValidExtra = cleanExtra.replace(/\D/g, '').length >= 7;
                    return (
                      <div key={extra.id || idx} className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                        <input
                          type="tel"
                          value={extra.phone}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFormData((prev) => ({
                              ...prev,
                              extraPhones: prev.extraPhones.map((row, i) => (i === idx ? { ...row, phone: val } : row)),
                            }));
                          }}
                          placeholder="رقم هاتف إضافي..."
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
                          <option value="موبايل">موبايل</option>
                          <option value="محل">تليفون المحل</option>
                          <option value="واتساب">واتساب</option>
                          <option value="إضافي">إضافي</option>
                        </select>
                        {isValidExtra && (
                          <a
                            href={`tel:${cleanExtra}`}
                            className="p-1.5 rounded-md bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] hover:bg-[#DCE6F5]"
                            title="اتصال بهذا الرقم"
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
                          title="تعيين هذا الرقم كرقم رئيسي"
                        >
                          تعيين رئيسي
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
                          title="حذف الرقم"
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
                <span>+ إضافة رقم تليفون آخر</span>
              </button>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                المحافظة:
              </label>
              <input
                type="text"
                placeholder="مثال: القاهرة / الجيزة / الغربية"
                value={formData.governorate}
                onChange={(e) => setFormData({ ...formData, governorate: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-semibold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                المنطقة / الحي:
              </label>
              <input
                type="text"
                placeholder="مثال: وسط البلد / العبور / طنطا"
                value={formData.area}
                onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-semibold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                الموقع الجغرافي / إحداثيات GPS (أو رابط خرائط):
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="مثال: 30.0444, 31.2357 أو رابط خرائط"
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
                  title="تحديد الموقع على خريطة جوجل"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>تحديد على الخريطة</span>
                </button>
                <button
                  type="button"
                  disabled={isLocatingGeo}
                  onClick={handleCaptureCustomerGeo}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] font-bold shrink-0 cursor-pointer disabled:opacity-50 transition-colors"
                  title="تحديد موقعي الحالي عبر GPS وجلب العنوان تلقائياً"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#003589]" />
                  <span>{isLocatingGeo ? 'تحديد...' : 'GPS'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                عنوان المحل بالتفصيل: <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  required
                  placeholder="مثال: شارع الجمهورية الرئيسي، بجوار مسجد السلام، طنطا"
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
                  title="تحديد أو تعديل الموقع على خرائط جوجل"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#003589]" />
                  <span>خريطة</span>
                </button>
              </div>
              {mapActionWarning ? (
                <span className="text-[11px] font-bold text-red-600 mt-1 block">{mapActionWarning}</span>
              ) : (
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  يستخدم العنوان أو إحداثيات GPS لفتح موقع المحل مباشرة على خرائط Google Maps
                </span>
              )}
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">كود المحل / العميل:</label>
              <input
                type="text"
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
                المناديب المسموح لهم بالتعامل مع العميل:
              </label>
              {formData.allowedRepIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, allowedRepIds: [] }))}
                  className="text-[11px] font-bold text-slate-500 hover:text-red-600 cursor-pointer"
                >
                  إلغاء التحديد
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              يظهر هذا العميل وتاريخ أسعاره وفواتيره في تطبيق الموبايل للمناديب المحددين فقط. عدم تحديد أي مندوب يقتصر التعامل على الإدارة.
            </p>
            {representatives.length === 0 ? (
              <p className="text-[11px] text-amber-700 font-bold">لا يوجد مناديب مبيعات مسجلون حالياً.</p>
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
                        <span className="text-[10px] text-slate-400 mr-auto font-mono">{rep.vehicleNumber}</span>
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
                  رصيد أول المدة الافتتاحي ({settings.currency}):
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
                  placeholder="0.00"
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  موجب (+) = مديونية سابقة على العميل، سالب (-) = رصيد دائن مدفوع مقدماً
                </span>
              </div>
            ) : (
              <div>
                <label className="block font-bold text-slate-700 mb-1">حالة الحساب:</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold outline-hidden focus:border-blue-600"
                >
                  <option value="active">نشط (مسموح بالبيع وإصدار الفواتير)</option>
                  <option value="blocked">محظور (موقوف عن التعامل مؤقتاً)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">ملاحظات إضافية:</label>
              <input
                type="text"
                placeholder="ملاحظات التسليم، أوقات الفتح، مندوب المنطقة..."
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
                <span>إنشاء حساب دخول لتطبيق العملاء وربطه تلقائياً (1:1)</span>
              </label>

              {createPortalLogin && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      اسم الدخول (Username): <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={portalUsername}
                      onChange={(e) => setPortalUsername(e.target.value)}
                      placeholder="مثال: cust_ahmad"
                      className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      كلمة المرور (6 أحرف على الأقل): <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={portalPassword}
                      onChange={(e) => setPortalPassword(e.target.value)}
                      placeholder="••••••••"
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
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSavingCustomer || isUploadingPhoto}
              className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
            >
              {isSavingCustomer ? 'جاري الحفظ...' : editingCustomer ? 'حفظ التعديلات' : 'تسجيل العميل في المنظومة'}
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
          title={`تسجيل تحصيل نقدية: ${paymentCustomer.name}`}
          subtitle={`المديونية الحالية: ${paymentCustomer.currentBalance.toLocaleString()} ${settings.currency}`}
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
                <label className="block font-bold text-slate-700 mb-1">العميل / المحل:</label>
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
                      {c.name} ({c.code}) — رصيد: {c.currentBalance.toLocaleString()} {settings.currency}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                المبلغ المحصل ({settings.currency}): <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={paymentAmount === '' ? '' : paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="أدخل المبلغ"
                className="w-full h-9 bg-slate-50 border border-slate-300 rounded-md px-2 py-1 text-sm font-black text-center text-emerald-800 font-mono outline-hidden focus:border-emerald-600"
              />
            </div>

            {Number(paymentAmount || 0) > 0 && (paymentCustomer.currentBalance <= 0 || Number(paymentAmount || 0) > paymentCustomer.currentBalance) && (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold leading-relaxed">
                تنبيه محاسبي: المبلغ المدخل يتجاوز المديونية القائمة للعميل — سيتم قيد الزيادة كـ "رصيد دائن للعميل / دفعة مقدمة (علينا)" ({Math.abs(paymentCustomer.currentBalance - Number(paymentAmount || 0)).toLocaleString()} {settings.currency}) دون تصفير الرصيد السالب ولن يُحتسب كإيراد مبيعات.
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">وسيلة التحصيل:</label>
              <div className="grid grid-cols-3 gap-1.5 font-bold">
                {[
                  { id: 'cash' as const, label: 'نقدي' },
                  { id: 'bank' as const, label: 'تحويل بنكي' },
                  { id: 'cheque' as const, label: 'شيك' },
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
                <label className="block font-bold text-slate-700 mb-1">الخزينة المودع بها المبلغ:</label>
                <select
                  value={paymentCashboxId}
                  onChange={(e) => setPaymentCashboxId(e.target.value)}
                  className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 font-bold outline-hidden focus:border-[#003589]"
                >
                  {cashboxes.map(cb => (
                    <option key={cb.id} value={cb.id}>
                      {cb.balanceHidden ? `${cb.name} (رصيد محجوب)` : `${cb.name} (رصيدها: ${(cb.currentBalance ?? 0).toLocaleString()} ${settings.currency})`}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
                يُسجَّل التحصيل على حساب العميل وعهدة/تسوية الإدارة دون اختيار خزائن الشركة.
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">البيان والملاحظات:</label>
              <input
                type="text"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="سداد دفعة من الحساب / تحصيل مبيعات..."
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 py-1 outline-hidden focus:border-[#003589]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setPaymentCustomer(null)}
                className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmittingPayment}
                className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmittingPayment ? 'جاري التسجيل...' : 'تأكيد التحصيل وطباعة الإيصال'}
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
          title="تأكيد حذف / أرشفة العميل"
          maxWidth="md"
        >
          <div className="space-y-2 text-xs">
            {deleteErrorMessage ? (
              <div className="p-2.5 bg-red-50 text-red-900 border border-red-200 rounded-lg space-y-2">
                <div className="flex items-center gap-1.5 font-black text-xs text-red-700">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>تنبيه أمان وحماية الحسابات</span>
                </div>
                <p className="leading-relaxed">{deleteErrorMessage}</p>
                <div className="pt-1">
                  <button
                    onClick={async () => {
                      try {
                        await updateCustomer(customerToDelete.id, { status: 'blocked' });
                        setCustomerToDelete(null);
                      } catch (err: any) {
                        setDeleteErrorMessage(err?.message || 'تعذر تغيير حالة العميل.');
                      }
                    }}
                    className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-md cursor-pointer"
                  >
                    تغيير حالة العميل إلى "محظور" بدلاً من الحذف
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="p-2.5 bg-amber-50 text-amber-900 rounded-lg border border-amber-200">
                  <p className="font-bold">
                    هل أنت متأكد من حذف العميل: <span className="font-black underline">{customerToDelete.name}</span> ({customerToDelete.code})؟
                  </p>
                  <p className="text-[11px] text-amber-800 mt-1">
                    إذا كان العميل مرتبطاً بأي فواتير أو سندات قبض تاريخية، سيتم منع الحذف لحماية القيود المحاسبية.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    onClick={() => setCustomerToDelete(null)}
                    className="px-2.5 py-1 border rounded-md font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-black rounded-md cursor-pointer"
                  >
                    تأكيد الحذف
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
          title={`تفاصيل فاتورة مبيعات: ${previewInvoice.invoiceNumber}`}
          subtitle={`التاريخ: ${previewInvoice.date} | العميل: ${previewInvoice.customerName}`}
          maxWidth="4xl"
        >
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-2 rounded-md border border-slate-200 font-mono">
              <div>المستودع: <strong className="font-sans">{previewInvoice.warehouseName}</strong></div>
              <div>المندوب: <strong className="font-sans">{previewInvoice.representativeName || '-'}</strong></div>
              <div>طريقة السداد: <strong className="font-sans">{previewInvoice.paymentType === 'cash' ? 'نقدي' : previewInvoice.paymentType === 'credit' ? 'آجل' : 'جزئي'}</strong></div>
              <div>الحالة: <strong className="text-emerald-700 font-sans">مؤكدة</strong></div>
            </div>

            <UnifiedDataTable
              data={previewInvoice.items}
              rowKey={(it, idx) => `${it.productId || idx}-${idx}`}
              compact
              searchable={false}
              paginated={false}
              columns={[
                { key: 'name', header: 'الصنف', cellClassName: 'font-bold', render: (it) => it.productName },
                { key: 'unit', header: 'الوحدة', cellClassName: 'text-slate-600', render: (it) => it.unit },
                { key: 'qty', header: 'الكمية', align: 'center', cellClassName: 'font-mono font-bold tabular-nums', render: (it) => it.quantity },
                { key: 'price', header: 'السعر', align: 'center', cellClassName: 'font-mono tabular-nums', render: (it) => it.unitPrice.toLocaleString() },
                { key: 'total', header: 'الإجمالي', align: 'center', cellClassName: 'font-mono font-bold tabular-nums', render: (it) => it.total.toLocaleString() },
              ]}
            />

            <div className="flex justify-between items-center bg-[#011E58] text-white px-2.5 py-1.5 rounded-md font-bold font-mono">
              <span>إجمالي الفاتورة: {previewInvoice.grandTotal.toLocaleString()} {settings.currency}</span>
              <span>المدفوع: {previewInvoice.paidAmount.toLocaleString()}</span>
              <span>المتبقي: {previewInvoice.remainingAmount.toLocaleString()}</span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => setPreviewInvoice(null)}
                className="px-2.5 py-1 border rounded-md font-bold cursor-pointer"
              >
                إغلاق
              </button>
              <button
                onClick={() => {
                  handlePrintSingleInvoice(previewInvoice);
                  setPreviewInvoice(null);
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة الفاتورة</span>
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
          title={`ربط حساب تطبيق العملاء: ${linkingCustomer.name}`}
          subtitle="ربط موثوق 1:1 بين ملف المحل وحساب تسجيل الدخول"
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
                  setLinkError(res.error || 'تعذر ربط الحساب');
                  return;
                }
                setCustomerBanner({
                  type: 'success',
                  text: `تم ربط العميل (${linkingCustomer.name}) بحساب الدخول بنجاح.`,
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
                إنشاء حساب دخول جديد
              </button>
              <button
                type="button"
                onClick={() => setLinkMode('existing')}
                className={`h-8 px-2 rounded-md border cursor-pointer ${
                  linkMode === 'existing' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                ربط بحساب موجود مسبقاً
              </button>
            </div>

            {linkMode === 'create' ? (
              <div className="space-y-2">
                <div>
                  <label className="block font-bold mb-1">اسم المستخدم للدخول (Username):</label>
                  <input
                    type="text"
                    required
                    value={newCustomerUsername}
                    onChange={(e) => setNewCustomerUsername(e.target.value)}
                    placeholder="مثال: shop_baraka"
                    className="w-full h-8 border rounded-md px-2 py-1 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">كلمة المرور (6 أحرف على الأقل):</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newCustomerPassword}
                    onChange={(e) => setNewCustomerPassword(e.target.value)}
                    placeholder="أدخل كلمة مرور قوية للعميل"
                    className="w-full h-8 border rounded-md px-2 py-1 font-mono"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block font-bold mb-1">اختر حساب العميل المسجل:</label>
                <select
                  required
                  value={existingLinkUserId}
                  onChange={(e) => setExistingLinkUserId(e.target.value)}
                  className="w-full h-8 border rounded-md px-2 py-1 font-bold bg-white"
                >
                  <option value="">-- اختر حساب دخول --</option>
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
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isLinking}
                className="px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black disabled:opacity-50 cursor-pointer"
              >
                {isLinking ? 'جاري الربط...' : 'اعتماد وربط الحساب'}
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
              <span className="font-black text-xs text-slate-900">معاينة صورة المحل</span>
              <button
                type="button"
                onClick={() => setPreviewShopPhoto(null)}
                className="px-2.5 py-1 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            <div className="p-2 bg-slate-900 flex items-center justify-center">
              <img
                src={previewShopPhoto}
                alt="صورة المحل بالحجم الكامل"
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

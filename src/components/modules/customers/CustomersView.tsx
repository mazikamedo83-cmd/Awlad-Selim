import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Users, Plus, Search, Phone, MapPin, DollarSign, FileText, 
  ArrowDownLeft, Printer, Download, Eye, Edit, Trash2, CheckCircle2, 
  Store, Camera, Upload, X, ExternalLink, ArrowRight, ArrowLeft, 
  Wifi, WifiOff, RefreshCw, Calendar, ShoppingCart, RotateCcw, 
  Receipt, AlertCircle, Building2, ShieldAlert, Sparkles, Filter, Link2, Check, History
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { apiRequest } from '../../../services/api';
import { Customer, Invoice, CustomerItemOrderRequest } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { NewSaleInvoiceModal } from '../sales/NewSaleInvoiceModal';
import { compressImageFileToDataUrl } from '../../../utils/image';

export const CustomersView: React.FC = () => {
  const {
    customers, users, representatives, invoices, invoiceReturns, financialTransactions,
    cashboxes, settings, networkStatus, customerItemOrders = [],
    approveCustomerItemOrder, rejectCustomerItemOrder, linkCustomerUser,
    addCustomer, updateCustomer, deleteCustomer, recordCustomerPayment,
  } = useData();
  const { hasPermission } = useAuth();
  const { registerHandler, consumePendingAction } = useShortcuts();

  // Navigation: main list vs dedicated customer page
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  // Payment modal state
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentCashboxId, setPaymentCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [phoneActionNotice, setPhoneActionNotice] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [mapActionWarning, setMapActionWarning] = useState<string | null>(null);
  const [customerFormError, setCustomerFormError] = useState<string | null>(null);

  // Invoice view modal
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  // Print modal state
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Customer Orders Management State
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | 'pending' | 'approved' | 'invoiced' | 'rejected'>('all');
  const [rejectingOrder, setRejectingOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [convertingOrder, setConvertingOrder] = useState<CustomerItemOrderRequest | null>(null);
  const [expandedOrderHistoryId, setExpandedOrderHistoryId] = useState<string | null>(null);
  const [orderActionBanner, setOrderActionBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Customer-User 1:1 Linking State
  const [linkingCustomer, setLinkingCustomer] = useState<Customer | null>(null);
  const [linkMode, setLinkMode] = useState<'create' | 'existing'>('create');
  const [existingLinkUserId, setExistingLinkUserId] = useState('');
  const [newCustomerUsername, setNewCustomerUsername] = useState('');
  const [newCustomerPassword, setNewCustomerPassword] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
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
    secondaryPhone: string;
    area: string;
    geoCoordinates: string;
    address: string;
    photo: string;
    notes: string;
    openingBalance: number;
    status: 'active' | 'blocked';
    allowedRepIds: string[];
  }>({
    code: '',
    name: '',
    shopName: '',
    phone: '',
    secondaryPhone: '',
    area: '',
    geoCoordinates: '',
    address: '',
    photo: '',
    notes: '',
    openingBalance: 0,
    status: 'active',
    allowedRepIds: [],
  });

  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dedicated customer tabs
  const [detailTab, setDetailTab] = useState<'statement' | 'invoices' | 'payments' | 'returns' | 'prices'>('statement');

  // Get active selected customer
  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // Filter customers list
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchSearch = 
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.shopName && c.shopName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (c.area && c.area.toLowerCase().includes(searchTerm.toLowerCase())) ||
        c.phone.includes(searchTerm) ||
        (c.secondaryPhone && c.secondaryPhone.includes(searchTerm)) ||
        c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.address.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchStatus = statusFilter === 'all' || c.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [customers, searchTerm, statusFilter]);

  // Overall metrics
  const totalDebts = useMemo(() => {
    return customers.reduce((sum, c) => sum + (c.currentBalance > 0 ? c.currentBalance : 0), 0);
  }, [customers]);

  const totalCredits = useMemo(() => {
    return customers.reduce((sum, c) => sum + (c.currentBalance < 0 ? Math.abs(c.currentBalance) : 0), 0);
  }, [customers]);

  // Customer transactions for dedicated profile
  const selectedCustomerInvoices = useMemo(() => {
    if (!selectedCustomer) return [];
    return invoices
      .filter(i => i.customerId === selectedCustomer.id && i.type === 'sales')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedCustomer, invoices]);

  const selectedCustomerPayments = useMemo(() => {
    if (!selectedCustomer) return [];
    return financialTransactions
      .filter(t => t.partyId === selectedCustomer.id && t.type === 'customer_payment')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedCustomer, financialTransactions]);

  const selectedCustomerReturns = useMemo(() => {
    if (!selectedCustomer) return [];
    return invoiceReturns
      .filter(r => r.partyId === selectedCustomer.id && r.type === 'sales_return')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedCustomer, invoiceReturns]);

  // Comprehensive chronological statement calculations
  interface StatementRow {
    id: string;
    date: string;
    docNumber: string;
    type: 'رصيد أول المدة' | 'فاتورة مبيعات' | 'سند قبض نقدية' | 'مرتجع مبيعات';
    description: string;
    debit: number;   // مدين (يزيد مديونية العميل)
    credit: number;  // دائن (يقلل مديونية العميل)
    runningBalance: number;
  }

  const chronologicalStatement = useMemo(() => {
    if (!selectedCustomer) return [];

    const events: Array<{
      id: string;
      date: string;
      docNumber: string;
      type: 'رصيد أول المدة' | 'فاتورة مبيعات' | 'سند قبض نقدية' | 'مرتجع مبيعات';
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

    // 2. Sales invoices
    selectedCustomerInvoices.forEach(inv => {
      if (inv.status === 'confirmed') {
        events.push({
          id: inv.id,
          date: inv.date,
          docNumber: inv.invoiceNumber,
          type: 'فاتورة مبيعات',
          description: `فاتورة مبيعات سلع غذائية (${inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'credit' ? 'آجل' : 'سداد جزئي'}) - ${inv.warehouseName}`,
          debit: inv.grandTotal,
          credit: inv.paidAmount > 0 ? inv.paidAmount : 0, // المدفوع الفوري يخفض الدين
          timestamp: new Date(inv.date).getTime(),
        });
      }
    });

    // 3. Customer payment transactions (collected separately from invoice creation)
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

    // 4. Sales returns
    selectedCustomerReturns.forEach(ret => {
      events.push({
        id: ret.id,
        date: ret.date,
        docNumber: ret.returnNumber,
        type: 'مرتجع مبيعات',
        description: `مرتجع بضائع غذائية للفاتورة (${ret.originalInvoiceNumber}) - ${ret.reason}`,
        debit: 0,
        credit: ret.grandTotal,
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
  }, [selectedCustomer, selectedCustomerInvoices, selectedCustomerPayments, selectedCustomerReturns]);

  // Open Add modal
  const handleOpenAdd = () => {
    const nextCode = `CUST-${(customers.length + 1001)}`;
    setFormData({
      code: nextCode,
      name: '',
      shopName: '',
      phone: '',
      secondaryPhone: '',
      area: '',
      geoCoordinates: '',
      address: '',
      photo: '',
      notes: '',
      openingBalance: 0,
      status: 'active',
      allowedRepIds: [],
    });
    setPhoneActionNotice(null);
    setMapActionWarning(null);
    setCustomerFormError(null);
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
    setFormData({
      code: c.code,
      name: c.name,
      shopName: c.shopName || '',
      phone: c.phone,
      secondaryPhone: c.secondaryPhone || '',
      area: c.area || '',
      geoCoordinates: c.geoCoordinates || '',
      address: c.address,
      photo: c.photo || '',
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
  });

  shortcutHandlersRef.current.openAdd = () => {
    handleOpenAdd();
  };

  shortcutHandlersRef.current.openCollection = () => {
    const target = selectedCustomer || filteredCustomers[0] || customers[0] || null;
    if (!target) return;
    setPaymentError(null);
    setPaymentCustomer(target);
    setPaymentAmount(target.currentBalance > 0 ? target.currentBalance : 0);
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
    return () => {
      unregAdd();
      unregCol();
    };
  }, [consumePendingAction, registerHandler]);

  // Handle Photo selection & compression
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setCustomerFormError(null);
      setIsUploadingPhoto(true);
      const base64 = await compressImageFileToDataUrl(file);
      setFormData(prev => ({ ...prev, photo: base64 }));
    } catch (err: any) {
      setCustomerFormError(err.message || 'حدث خطأ أثناء تحميل ومعالجة صورة المحل');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = () => {
    setFormData(prev => ({ ...prev, photo: '' }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Save Customer (Add or Edit)
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
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

    if (editingCustomer) {
      await updateCustomer(editingCustomer.id, {
        name: formData.name.trim(),
        shopName: formData.shopName.trim() || undefined,
        phone: formData.phone.trim(),
        secondaryPhone: formData.secondaryPhone.trim() || undefined,
        area: formData.area.trim() || undefined,
        geoCoordinates: formData.geoCoordinates.trim() || undefined,
        address: formData.address.trim(),
        photo: formData.photo,
        notes: formData.notes.trim(),
        status: formData.status,
        allowedRepIds: formData.allowedRepIds,
        assignedRepId: formData.allowedRepIds[0] || undefined,
      });
    } else {
      const created = await addCustomer({
        code: formData.code.trim(),
        name: formData.name.trim(),
        shopName: formData.shopName.trim() || undefined,
        phone: formData.phone.trim(),
        secondaryPhone: formData.secondaryPhone.trim() || undefined,
        area: formData.area.trim() || undefined,
        geoCoordinates: formData.geoCoordinates.trim() || undefined,
        address: formData.address.trim(),
        photo: formData.photo,
        notes: formData.notes.trim(),
        openingBalance: Number(formData.openingBalance) || 0,
        status: formData.status,
        allowedRepIds: formData.allowedRepIds,
        assignedRepId: formData.allowedRepIds[0] || undefined,
      });
      // Optionally open the newly created customer
      setSelectedCustomerId(created.id);
    }
    setIsAddModalOpen(false);
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
    if (!paymentCustomer || paymentAmount <= 0) return;

    const res = await recordCustomerPayment(
      paymentCustomer.id,
      paymentAmount,
      paymentCashboxId,
      paymentNotes || 'تحصيل نقدي من الحساب'
    );

    if (res.success) {
      setPrintData({
        title: 'سند قبض نقدية من عميل',
        docNumber: `REC-${Date.now().toString().slice(-6)}`,
        docType: 'سند قبض',
        date: new Date().toISOString().split('T')[0],
        partyName: paymentCustomer.name,
        partyPhone: paymentCustomer.phone,
        partyAddress: paymentCustomer.address,
        grandTotal: paymentAmount,
        paidAmount: paymentAmount,
        previousBalance: paymentCustomer.currentBalance,
        currentBalance: paymentCustomer.currentBalance - paymentAmount,
        notes: paymentNotes || 'تم تحصيل النقدية وإيداعها في الخزينة المعتمدة بنجاح.',
      });
      setIsPrintModalOpen(true);
      setPaymentError(null);
      setPaymentCustomer(null);
      setPaymentAmount(0);
      setPaymentNotes('');
    } else {
      setPaymentError(res.error || 'تعذر تسجيل الدفعة');
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
      notes: `رصيد أول المدة: ${selectedCustomer.openingBalance.toLocaleString()} ${settings.currency} | إجمالي عدد الحركات: ${chronologicalStatement.length}`,
      items: chronologicalStatement.map(row => ({
        name: `${row.type} (${row.docNumber}) - ${row.description}`,
        unit: 'حركة',
        quantity: 1,
        price: row.debit > 0 ? row.debit : 0,
        discount: row.credit > 0 ? row.credit : 0,
        total: row.runningBalance,
      })),
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

  // ==========================================
  // RENDER DEDICATED CUSTOMER PAGE
  // ==========================================
  if (selectedCustomer) {
    const isDebtor = selectedCustomer.currentBalance > 0;
    const isCreditor = selectedCustomer.currentBalance < 0;

    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        {/* Navigation Breadcrumb Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedCustomerId(null)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all active:scale-95 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>العودة لدليل العملاء</span>
            </button>
            <span className="text-slate-300">/</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                {selectedCustomer.code}
              </span>
              <h2 className="text-base font-black text-slate-900">{selectedCustomer.name}</h2>
            </div>
          </div>

          {/* Offline / Online Network Indicator */}
          <div className="flex items-center gap-2 text-xs font-bold">
            {networkStatus === 'disconnected' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px]">
                <WifiOff className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                <span>وضع عدم الاتصال (Offline) - حفظ فوري ومزامنة تلقائية</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px]">
                <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                <span>متصل بالإنترنت - البيانات متزامنة محلياً</span>
              </span>
            )}
          </div>
        </div>

        {/* Dedicated Store Profile Header Card */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 overflow-hidden relative">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            {/* Store Photo & Shop Details */}
            <div className="flex items-start sm:items-center gap-5">
              {/* Prominent Store Photo with Lightbox preview */}
              <div className="relative group shrink-0">
                {selectedCustomer.photo ? (
                  <img
                    src={selectedCustomer.photo}
                    alt={selectedCustomer.name}
                    className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border-2 border-slate-200 shadow-md bg-slate-50 transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-blue-900/5 border-2 border-dashed border-blue-200 flex flex-col items-center justify-center text-blue-900">
                    <Store className="w-10 h-10 stroke-[1.5]" />
                    <span className="text-[10px] font-bold mt-1 text-slate-400">لا توجد صورة</span>
                  </div>
                )}
                <span className={`absolute -bottom-1 -right-1 px-2 py-0.5 rounded-full text-[10px] font-black border shadow-xs ${
                  selectedCustomer.status === 'active' 
                    ? 'bg-emerald-500 text-white border-white' 
                    : 'bg-red-500 text-white border-white'
                }`}>
                  {selectedCustomer.status === 'active' ? 'محل نشط' : 'محظور'}
                </span>
              </div>

              {/* Shop & Contact Meta */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                    {selectedCustomer.name}
                  </h1>
                  <span className="font-mono text-xs font-bold text-blue-900 bg-blue-100/70 px-2.5 py-0.5 rounded-lg border border-blue-200">
                    {selectedCustomer.code}
                  </span>
                </div>

                {/* Direct Call & Google Maps Buttons */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {/* Direct Phone Call Button */}
                  <a
                    href={`tel:${selectedCustomer.phone}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-mono font-black border border-emerald-200 shadow-xs transition-all active:scale-95 cursor-pointer"
                    title="اتصال هاتفي مباشر بالمحل"
                  >
                    <Phone className="w-4 h-4 text-emerald-600" />
                    <span>{selectedCustomer.phone}</span>
                  </a>

                  {/* Google Maps Location Button */}
                  <a
                    href={selectedCustomer.geoCoordinates?.trim() 
                      ? (selectedCustomer.geoCoordinates.startsWith('http') 
                          ? selectedCustomer.geoCoordinates 
                          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedCustomer.geoCoordinates)}`)
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedCustomer.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 font-semibold border border-blue-200 shadow-xs transition-all active:scale-95 cursor-pointer"
                    title="فتح موقع المحل على خرائط Google Maps"
                  >
                    <MapPin className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="max-w-[280px] truncate">{selectedCustomer.address || selectedCustomer.geoCoordinates || 'موقع الخريطة'}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-blue-700" />
                  </a>
                </div>

                {selectedCustomer.notes && (
                  <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded-xl border border-slate-100 max-w-xl">
                    <span className="font-bold text-slate-700 ml-1">ملاحظات:</span>
                    {selectedCustomer.notes}
                  </p>
                )}
              </div>
            </div>

            {/* Quick Actions in Customer Profile */}
            <div className="flex flex-wrap items-center gap-2 self-stretch md:self-auto justify-end">
              <button
                onClick={() => {
                  setPaymentCustomer(selectedCustomer);
                  setPaymentAmount(selectedCustomer.currentBalance > 0 ? selectedCustomer.currentBalance : 0);
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 active:scale-95 transition-all cursor-pointer"
              >
                <ArrowDownLeft className="w-4 h-4" />
                <span>تسجيل تحصيل نقدية</span>
              </button>

              <button
                onClick={(e) => handleOpenEdit(selectedCustomer, e)}
                className="flex items-center gap-2 px-3.5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-900/20 active:scale-95 transition-all cursor-pointer"
              >
                <Edit className="w-4 h-4" />
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
                  className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold shadow-xs cursor-pointer ${
                    selectedCustomer.userId
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                      : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  <Link2 className="w-4 h-4" />
                  <span>{selectedCustomer.userId ? 'تغيير ربط حساب التطبيق' : 'ربط / إنشاء حساب دخول للعميل'}</span>
                </button>
              )}

              <button
                onClick={handlePrintStatement}
                className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title="طباعة كشف الحساب"
              >
                <Printer className="w-4 h-4 text-slate-600" />
                <span>طباعة</span>
              </button>

              <button
                onClick={handleExportStatementExcel}
                className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-emerald-800 rounded-xl text-xs font-bold active:scale-95 transition-all cursor-pointer"
                title="تصدير كشف الحساب Excel"
              >
                <Download className="w-4 h-4 text-emerald-600" />
                <span>Excel</span>
              </button>

              <button
                onClick={(e) => handleDeleteCustomerClick(selectedCustomer, e)}
                className="p-2.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
                title="حذف العميل وفق الصلاحيات"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Financial KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 mt-6 border-t border-slate-100 text-xs">
            {/* Current Balance */}
            <div className={`p-4 rounded-2xl border ${
              isDebtor ? 'bg-red-50/60 border-red-200' : isCreditor ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200'
            }`}>
              <span className="text-[11px] font-bold text-slate-600 block mb-1">الرصيد الحالي المستحق</span>
              <div className={`text-xl font-black font-mono ${
                isDebtor ? 'text-red-700' : isCreditor ? 'text-emerald-700' : 'text-slate-800'
              }`}>
                {selectedCustomer.currentBalance.toLocaleString()} {settings.currency}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                {isDebtor ? '(مديونية مستحقة للشركة)' : isCreditor ? '(رصيد دائن مدفوع مقدماً)' : '(الحساب خالص ومتوازن)'}
              </span>
            </div>

            {/* Total Sales Value */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-bold text-slate-600 block mb-1">إجمالي المبيعات والفواتير</span>
              <div className="text-xl font-black font-mono text-blue-950">
                {selectedCustomerInvoices.reduce((a, b) => a + b.grandTotal, 0).toLocaleString()} {settings.currency}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                عدد {selectedCustomerInvoices.length} فاتورة مبيعات
              </span>
            </div>

            {/* Total Payments Collected */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-bold text-slate-600 block mb-1">إجمالي التحصيلات المستلمة</span>
              <div className="text-xl font-black font-mono text-emerald-800">
                {(
                  selectedCustomerPayments.reduce((a, b) => a + b.amount, 0) +
                  selectedCustomerInvoices.reduce((a, b) => a + b.paidAmount, 0)
                ).toLocaleString()} {settings.currency}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                سداد نقدي مباشر ومحصل
              </span>
            </div>

            {/* Total Returns */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-bold text-slate-600 block mb-1">إجمالي المرتجعات</span>
              <div className="text-xl font-black font-mono text-amber-800">
                {selectedCustomerReturns.reduce((a, b) => a + b.grandTotal, 0).toLocaleString()} {settings.currency}
              </div>
              <span className="text-[10px] font-semibold text-slate-500">
                عدد {selectedCustomerReturns.length} حركة مرتجع
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation in Dedicated Profile */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-2 flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => setDetailTab('statement')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black transition-all cursor-pointer ${
              detailTab === 'statement'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>كشف الحساب المالي المفصل ({chronologicalStatement.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('invoices')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black transition-all cursor-pointer ${
              detailTab === 'invoices'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>فواتير المبيعات ({selectedCustomerInvoices.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('payments')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black transition-all cursor-pointer ${
              detailTab === 'payments'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>سندات القبض والتحصيلات ({selectedCustomerPayments.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('returns')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black transition-all cursor-pointer ${
              detailTab === 'returns'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            <span>المرتجعات ({selectedCustomerReturns.length})</span>
          </button>

          <button
            onClick={() => setDetailTab('prices')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black transition-all cursor-pointer ${
              detailTab === 'prices'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>تاريخ أسعار المنتجات المشتراة</span>
          </button>
        </div>

        {/* Tab 1: Comprehensive Account Statement */}
        {detailTab === 'statement' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden text-xs">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-black text-slate-900 text-sm">دفتر أستاذ كشف الحساب التراكمي (Ledger)</h3>
                <p className="text-[11px] text-slate-500">
                  كافة قيود الفواتير والتحصيلات والمرتجعات مرتبة زمنياً لحساب الرصيد المستحق بدقة
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportStatementExcel}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-300 font-bold hover:bg-slate-50 text-emerald-800"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                  <span>تصدير كشف الحساب Excel</span>
                </button>
                <button
                  onClick={handlePrintStatement}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-900 text-white font-bold hover:bg-blue-950 shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة كشف الحساب</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px]">
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">رقم المستند</th>
                    <th className="p-3">نوع الحركة</th>
                    <th className="p-3">البيان والشرح</th>
                    <th className="p-3 text-center text-red-700 bg-red-50/50">مدين (+) [دين جديد]</th>
                    <th className="p-3 text-center text-emerald-700 bg-emerald-50/50">دائن (-) [سداد]</th>
                    <th className="p-3 text-center font-black">الرصيد التراكمي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {chronologicalStatement.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400">
                        لا توجد حركات مالية أو فواتير مسجلة لهذا العميل حتى الآن.
                      </td>
                    </tr>
                  ) : (
                    chronologicalStatement.map(row => (
                      <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-mono text-slate-600">{row.date}</td>
                        <td className="p-3 font-mono font-bold text-blue-900">{row.docNumber}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            row.type === 'فاتورة مبيعات' ? 'bg-blue-50 text-blue-800 border border-blue-200' :
                            row.type === 'سند قبض نقدية' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                            row.type === 'مرتجع مبيعات' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                            'bg-slate-100 text-slate-800'
                          }`}>
                            {row.type}
                          </span>
                        </td>
                        <td className="p-3 text-slate-700 max-w-xs">{row.description}</td>
                        <td className="p-3 text-center font-mono font-bold text-red-700 bg-red-50/20">
                          {row.debit > 0 ? row.debit.toLocaleString() : '-'}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-emerald-700 bg-emerald-50/20">
                          {row.credit > 0 ? row.credit.toLocaleString() : '-'}
                        </td>
                        <td className="p-3 text-center font-mono font-black text-slate-900">
                          <span className={row.runningBalance > 0 ? 'text-red-700' : row.runningBalance < 0 ? 'text-emerald-700' : 'text-slate-800'}>
                            {row.runningBalance.toLocaleString()} {settings.currency}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Sales Invoices */}
        {detailTab === 'invoices' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden text-xs">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-900 text-sm">سجل فواتير المبيعات الصادرة للمحل</h3>
                <p className="text-[11px] text-slate-500">
                  جميع الفواتير المرتبطة بهذا العميل وإمكانية استعراضها وطباعتها
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px]">
                    <th className="p-3">رقم الفاتورة</th>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">المستودع</th>
                    <th className="p-3">المندوب</th>
                    <th className="p-3 text-center">إجمالي الفاتورة</th>
                    <th className="p-3 text-center">المدفوع نقداً</th>
                    <th className="p-3 text-center">المتبقي (آجل)</th>
                    <th className="p-3">طريقة السداد</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedCustomerInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-12 text-center text-slate-400">
                        لا توجد فواتير مبيعات مسجلة لهذا العميل حتى الآن.
                      </td>
                    </tr>
                  ) : (
                    selectedCustomerInvoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-mono font-bold text-blue-900">{inv.invoiceNumber}</td>
                        <td className="p-3 font-mono text-slate-600">{inv.date}</td>
                        <td className="p-3 text-slate-700">{inv.warehouseName}</td>
                        <td className="p-3 text-slate-600">{inv.representativeName || '-'}</td>
                        <td className="p-3 text-center font-mono font-bold text-slate-900">
                          {inv.grandTotal.toLocaleString()} {settings.currency}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-emerald-700">
                          {inv.paidAmount.toLocaleString()}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-red-600">
                          {inv.remainingAmount.toLocaleString()}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            inv.paymentType === 'cash' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                            inv.paymentType === 'credit' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                            'bg-blue-50 text-blue-800 border border-blue-200'
                          }`}>
                            {inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'credit' ? 'آجل' : 'جزئي'}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                            {inv.status === 'confirmed' ? 'مؤكدة' : 'ملغاة'}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setPreviewInvoice(inv)}
                              className="p-1.5 text-blue-900 hover:bg-blue-50 rounded-lg transition-colors"
                              title="استعراض الفاتورة"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handlePrintSingleInvoice(inv)}
                              className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="طباعة الفاتورة"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Payments & Receipts */}
        {detailTab === 'payments' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden text-xs">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-900 text-sm">سجل سندات القبض والتحصيلات النقدية</h3>
                <p className="text-[11px] text-slate-500">
                  جميع المبالغ المحصلة نقدياً وتم توريدها إلى الخزينة
                </p>
              </div>
              <button
                onClick={() => {
                  setPaymentCustomer(selectedCustomer);
                  setPaymentAmount(selectedCustomer.currentBalance > 0 ? selectedCustomer.currentBalance : 0);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>تحصيل نقدية جديد</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px]">
                    <th className="p-3">رقم السند</th>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">الخزينة المودع بها</th>
                    <th className="p-3 text-center">المبلغ المحصل</th>
                    <th className="p-3">البيان والملاحظات</th>
                    <th className="p-3">المسؤول عن التسجيل</th>
                    <th className="p-3 text-center">طباعة الإيصال</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedCustomerPayments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400">
                        لا توجد سندات تحصيل نقدية مسجلة لهذا العميل حتى الآن.
                      </td>
                    </tr>
                  ) : (
                    selectedCustomerPayments.map(pay => (
                      <tr key={pay.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-mono font-bold text-blue-900">{pay.transactionNumber}</td>
                        <td className="p-3 font-mono text-slate-600">{pay.date}</td>
                        <td className="p-3 font-bold text-slate-800">{pay.cashboxName}</td>
                        <td className="p-3 text-center font-mono font-black text-emerald-700 text-sm">
                          {pay.amount.toLocaleString()} {settings.currency}
                        </td>
                        <td className="p-3 text-slate-600">{pay.notes || pay.description}</td>
                        <td className="p-3 text-slate-500">{pay.createdBy}</td>
                        <td className="p-3 text-center">
                          <button
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
                            className="p-1.5 text-blue-900 hover:bg-blue-50 rounded-lg transition-colors"
                            title="إعادة طباعة سند القبض"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Sales Returns */}
        {detailTab === 'returns' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden text-xs">
            <div className="p-4 bg-slate-50 border-b border-slate-200">
              <h3 className="font-black text-slate-900 text-sm">سجل بضائع المرتجعات لهذا العميل</h3>
              <p className="text-[11px] text-slate-500">
                حركات إرجاع البضائع التالفة أو المسترجعة والتسويات المالية الناتجة عنها
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px]">
                    <th className="p-3">رقم إشعار المرتجع</th>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">الفاتورة الأصلية</th>
                    <th className="p-3">المستودع المستلم</th>
                    <th className="p-3 text-center">إجمالي قيمة المرتجع</th>
                    <th className="p-3">طريقة رد المبلغ</th>
                    <th className="p-3">سبب الإرجاع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedCustomerReturns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400">
                        لا توجد مرتجعات مسجلة لهذا العميل.
                      </td>
                    </tr>
                  ) : (
                    selectedCustomerReturns.map(ret => (
                      <tr key={ret.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-mono font-bold text-amber-800">{ret.returnNumber}</td>
                        <td className="p-3 font-mono text-slate-600">{ret.date}</td>
                        <td className="p-3 font-mono text-blue-900">{ret.originalInvoiceNumber}</td>
                        <td className="p-3 text-slate-700">{ret.warehouseName}</td>
                        <td className="p-3 text-center font-mono font-black text-amber-800">
                          {ret.grandTotal.toLocaleString()} {settings.currency}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 font-bold text-[10px]">
                            {ret.refundType === 'cash' ? 'رد نقدي فوري' : 'خصم من مديونية الحساب'}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600">{ret.reason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 5: Product Price History */}
        {detailTab === 'prices' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 text-xs space-y-4">
            <div>
              <h3 className="font-black text-slate-900 text-sm">سجل الأسعار التاريخية للمنتجات المشتراة (آخر 3 أسعار)</h3>
              <p className="text-[11px] text-slate-500">
                يعرض النظام تلقائياً آخر ثلاثة أسعار فعلية اشترى بها هذا العميل كل صنف للمقارنة عند إصدار الفواتير
              </p>
            </div>

            {Object.keys(selectedCustomer.priceHistory || {}).length === 0 ? (
              <div className="p-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                لم يتم تسجيل عمليات بيع سابقة لهذا العميل لتكوين سجل الأسعار بعد.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(selectedCustomer.priceHistory).map(([prodId, prices]) => (
                  <div key={prodId} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                    <span className="text-[10px] font-mono font-bold text-blue-900 bg-blue-100 px-2 py-0.5 rounded">
                      كود الصنف: {prodId}
                    </span>
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200">
                      <span className="text-slate-500">الأسعار السابقة (من الأقدم للأحدث):</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {prices.map((entry, idx) => {
                        const val = typeof entry === 'number' ? entry : entry.price;
                        const dt = typeof entry === 'number' ? '' : entry.date;
                        return (
                          <span key={idx} className="font-mono font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-800 text-xs shadow-2xs">
                            {val} {settings.currency}
                            {dt ? <span className="text-[10px] text-slate-400 mr-1">({dt})</span> : null}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER MAIN CUSTOMERS DIRECTORY LIST VIEW
  // ==========================================
  return (
    <div className="space-y-6">
      {/* Conflicts warning for admins */}
      {hasPermission('canManageUsers') &&
        (conflicts.duplicatePhones.length > 0 || conflicts.unlinkedCustomerUsers.length > 0) && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 space-y-1.5">
            <div className="font-black flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>تنبيه تطابق بيانات العملاء وحسابات الدخول</span>
            </div>
            {conflicts.duplicatePhones.length > 0 && (
              <p>
                يوجد أرقام هواتف مكررة لدى أكثر من عميل ({conflicts.duplicatePhones.map((d) => d.phone).join('، ')}). يعتمد النظام الآن على ربط الحساب بالمعرف الثابت 1:1 بدلاً من الهاتف.
              </p>
            )}
            {conflicts.unlinkedCustomerUsers.length > 0 && (
              <p>
                يوجد ({conflicts.unlinkedCustomerUsers.length}) حساب عميل غير مربوط بملف محل حتى الآن — استخدم زر "ربط حساب تطبيق" على بطاقة العميل لإكمال الربط.
              </p>
            )}
          </div>
        )}

      {/* Customer mobile-app item requests: complete lifecycle */}
      {customerItemOrders.length > 0 && (
        <section className="rounded-3xl border border-blue-200 bg-blue-50/50 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-black text-blue-950">طلبات الأصناف الواردة من تطبيق العملاء</h3>
              <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-bold text-white">
                {customerItemOrders.filter((o) => o.status === 'pending').length} جديد
              </span>
              <span className="rounded-full bg-blue-900 px-2.5 py-0.5 text-xs font-bold text-white">
                {customerItemOrders.filter((o) => o.status === 'approved').length} جاهز للفوترة
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
              {[
                { key: 'all', label: `الكل (${customerItemOrders.length})` },
                { key: 'pending', label: 'جديد' },
                { key: 'approved', label: 'مقبول' },
                { key: 'invoiced', label: 'تمت الفوترة' },
                { key: 'rejected', label: 'مرفوض' },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setOrderStatusFilter(t.key as any)}
                  className={`px-3 py-1.5 rounded-xl cursor-pointer transition-all ${
                    orderStatusFilter === t.key
                      ? 'bg-blue-900 text-white shadow-xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {orderActionBanner && (
            <div
              className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between ${
                orderActionBanner.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <span>{orderActionBanner.text}</span>
              <button onClick={() => setOrderActionBanner(null)} className="underline cursor-pointer">
                إغلاق
              </button>
            </div>
          )}

          <div className="space-y-3">
            {customerItemOrders
              .filter((o) => orderStatusFilter === 'all' || o.status === orderStatusFilter)
              .map((order) => {
                const isExpanded = expandedOrderHistoryId === order.id;
                const mapQuery = order.geoCoordinates?.trim() || order.deliveryAddress?.trim() || '';
                const mapHref = mapQuery.startsWith('http')
                  ? mapQuery
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
                return (
                  <div key={order.id} className="rounded-2xl border border-blue-100 bg-white p-4 shadow-xs space-y-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-black text-blue-900 bg-blue-50 px-2.5 py-0.5 rounded-lg border border-blue-200">
                          {order.requestNumber}
                        </span>
                        <strong className="text-sm text-slate-900">{order.customerName}</strong>
                        {order.shopName && (
                          <span className="text-slate-600 font-semibold">({order.shopName})</span>
                        )}
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            order.status === 'pending'
                              ? 'bg-amber-100 text-amber-800'
                              : order.status === 'approved'
                              ? 'bg-blue-100 text-blue-800'
                              : order.status === 'rejected'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {order.status === 'pending'
                            ? 'جديد — بانتظار المراجعة'
                            : order.status === 'approved'
                            ? 'مقبول — جاهز لتحويله لفاتورة'
                            : order.status === 'rejected'
                            ? 'مرفوض'
                            : `تم التحويل لفاتورة (${order.invoiceNumber || ''})`}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        {new Date(order.createdAt).toLocaleString('ar-EG')}
                      </span>
                    </div>

                    {/* Customer Snapshot Info */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                      {order.customerPhone && (
                        <a
                          href={`tel:${order.customerPhone}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 font-mono font-bold border border-emerald-200"
                        >
                          <Phone className="w-3 h-3" />
                          <span>{order.customerPhone}</span>
                        </a>
                      )}
                      {order.deliveryAddress && (
                        <a
                          href={mapHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 text-slate-800 border border-slate-200 hover:bg-blue-50"
                        >
                          <MapPin className="w-3 h-3 text-red-600" />
                          <span>{order.deliveryAddress}</span>
                          <ExternalLink className="w-3 h-3 text-blue-700" />
                        </a>
                      )}
                    </div>

                    {/* Order Items Table */}
                    <div className="bg-slate-50 rounded-xl border border-slate-200 p-2.5 space-y-1">
                      {order.items.map((it, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-900">
                            {idx + 1}. {it.productName}
                          </span>
                          <span className="font-mono text-slate-700">
                            {it.quantity} {it.unit}
                            {it.unitPrice && it.unitPrice > 0 ? ` • سعر استرشادي: ${it.unitPrice} ${settings.currency}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>

                    {order.notes && (
                      <p className="text-slate-600 bg-amber-50/50 p-2 rounded-lg border border-amber-100">
                        <strong>ملاحظات العميل:</strong> {order.notes}
                      </p>
                    )}

                    {order.status === 'rejected' && order.rejectionReason && (
                      <p className="text-red-800 bg-red-50 p-2 rounded-lg border border-red-200 font-bold">
                        سبب الرفض: {order.rejectionReason}
                      </p>
                    )}

                    {/* Action Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {order.status === 'pending' && (
                          <>
                            <button
                              onClick={async () => {
                                const r = await approveCustomerItemOrder(order.id);
                                if (!r.success) {
                                  setOrderActionBanner({ type: 'error', text: r.error || 'تعذر قبول الطلب' });
                                } else {
                                  setOrderActionBanner({ type: 'success', text: `تم قبول الطلب (${order.requestNumber}) بنجاح، ويمكنك الآن تحويله إلى فاتورة بيع.` });
                                }
                              }}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 px-4 py-2 text-xs font-bold text-white cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>قبول الطلب</span>
                            </button>
                            <button
                              onClick={() => {
                                setRejectReason('');
                                setRejectingOrder(order);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 hover:bg-red-800 px-4 py-2 text-xs font-bold text-white cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>رفض الطلب</span>
                            </button>
                          </>
                        )}

                        {order.status === 'approved' && (
                          <button
                            onClick={() => setConvertingOrder(order)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-900 hover:bg-blue-950 px-4 py-2 text-xs font-black text-white shadow-sm cursor-pointer"
                          >
                            <ShoppingCart className="w-3.5 h-3.5" />
                            <span>تحويل إلى فاتورة مبيعات</span>
                          </button>
                        )}
                      </div>

                      {order.statusHistory && order.statusHistory.length > 0 && (
                        <button
                          onClick={() => setExpandedOrderHistoryId(isExpanded ? null : order.id)}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-blue-900 font-bold cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5" />
                          <span>{isExpanded ? 'إخفاء سجل الحالات' : `سجل الحالات (${order.statusHistory.length})`}</span>
                        </button>
                      )}
                    </div>

                    {isExpanded && order.statusHistory && (
                      <div className="pt-2 border-t border-slate-100 space-y-1 text-[11px] text-slate-600">
                        {order.statusHistory.map((h) => (
                          <div key={h.id} className="flex items-center justify-between">
                            <span>
                              <strong>{h.toStatus}</strong> — بواسطة: {h.changedByName}
                              {h.reason ? ` (${h.reason})` : ''}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              {new Date(h.changedAt).toLocaleString('ar-EG')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-slate-900 tracking-tight">دليل العملاء والمحلات الغذائية</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-900 text-xs font-black border border-blue-200">
              {customers.length} محل
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            إدارة بيانات المحلات، الصور الميدانية، أرقام الموبايل، العناوين، التحصيلات، وكشوف الحسابات المستقلة
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          {/* Offline / Online Network Indicator */}
          {networkStatus === 'disconnected' ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold shrink-0">
              <WifiOff className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
              <span>وضع عدم الاتصال (Offline)</span>
            </span>
          ) : (
            <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold shrink-0">
              <Wifi className="w-3.5 h-3.5 text-emerald-600" />
              <span>متصل بالإنترنت</span>
            </span>
          )}

          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-lg shadow-blue-900/20 active:scale-95 transition-all cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة عميل / محل جديد</span>
          </button>
        </div>
      </div>

      {/* Financial Overview Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Customers */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500">إجمالي المحلات المسجلة</span>
            <div className="text-2xl font-black text-slate-900 mt-1 font-mono">
              {customers.length}
            </div>
            <span className="text-[11px] text-emerald-700 font-bold">
              {customers.filter(c => c.status === 'active').length} محل نشط
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-900 flex items-center justify-center">
            <Store className="w-6 h-6" />
          </div>
        </div>

        {/* Total Outstanding Customer Debts */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500">إجمالي مديونيات العملاء (لنا)</span>
            <div className="text-2xl font-black text-red-700 mt-1 font-mono">
              {totalDebts.toLocaleString()} <span className="text-xs text-slate-500 font-normal">{settings.currency}</span>
            </div>
            <span className="text-[11px] text-slate-500">
              مستحقات آجلة قيد التحصيل
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-700 flex items-center justify-center">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        {/* Total Advance Credits */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500">أرصدة العملاء الدائنة (دفعات مقدمة)</span>
            <div className="text-2xl font-black text-emerald-700 mt-1 font-mono">
              {totalCredits.toLocaleString()} <span className="text-xs text-slate-500 font-normal">{settings.currency}</span>
            </div>
            <span className="text-[11px] text-emerald-700 font-bold">
              مبالغ مسددة مقدماً من العملاء
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <ArrowDownLeft className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
        {/* Search Input (ByName & ByPhone & ByCode & ByAddress) */}
        <div className="relative flex-1 w-full">
          <input
            type="text"
            placeholder="بحث فوري باسم المحل، رقم الموبايل، الكود، أو العنوان..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-2xl py-2.5 pr-10 pl-4 text-xs font-semibold focus:bg-white focus:border-blue-600 outline-hidden transition-all"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
        </div>

        {/* Filters and Layout Toggle */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-hidden focus:border-blue-600"
            >
              <option value="all">جميع الحالات ({customers.length})</option>
              <option value="active">نشط فقط</option>
              <option value="blocked">محظور فقط</option>
            </select>
          </div>

          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'cards' ? 'bg-white text-blue-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              بطاقات
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'table' ? 'bg-white text-blue-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              جدول
            </button>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {filteredCustomers.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-900 flex items-center justify-center mx-auto">
            <Store className="w-8 h-8" />
          </div>
          <div>
            <p className="text-base font-black text-slate-700">لا يوجد عملاء مسجلون حالياً</p>
            <p className="text-xs text-slate-400 mt-1">
              انقر على زر "إضافة عميل / محل جديد" للبدء بتسجيل بيانات المحلات، الصور الميدانية، أرقام الموبايل، والعناوين.
            </p>
          </div>
          <button
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black shadow-md shadow-blue-900/20 active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة أول عميل</span>
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredCustomers.map(cust => {
            const isDebtor = cust.currentBalance > 0;
            const isCreditor = cust.currentBalance < 0;

            return (
              <div
                key={cust.id}
                onClick={() => setSelectedCustomerId(cust.id)}
                className="bg-white rounded-3xl border border-slate-200 hover:border-blue-400 shadow-xs hover:shadow-md transition-all p-5 flex flex-col justify-between text-xs space-y-4 cursor-pointer group"
              >
                {/* Header: Store Photo & Shop Name */}
                <div className="flex items-start gap-3.5">
                  {/* Shop Photo Thumbnail */}
                  <div className="relative shrink-0">
                    {cust.photo ? (
                      <img
                        src={cust.photo}
                        alt={cust.name}
                        className="w-14 h-14 rounded-2xl object-cover border border-slate-200 bg-slate-50 shadow-2xs group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-blue-50/70 border border-blue-200 flex items-center justify-center text-blue-900">
                        <Store className="w-6 h-6 stroke-[1.5]" />
                      </div>
                    )}
                    <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white ${
                      cust.status === 'active' ? 'bg-emerald-500' : 'bg-red-500'
                    }`} />
                  </div>

                  {/* Name and Code */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                        {cust.code}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        cust.status === 'active' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                      }`}>
                        {cust.status === 'active' ? 'نشط' : 'محظور'}
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-slate-900 truncate mt-1 group-hover:text-blue-900 transition-colors">
                      {cust.name}
                    </h3>
                  </div>
                </div>

                {/* Contact: Direct Call & Google Maps Buttons */}
                <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
                  {/* Direct Phone Call Button */}
                  <div className="flex items-center justify-between">
                    <a
                      href={`tel:${cust.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-mono font-bold border border-emerald-200 shadow-2xs transition-all active:scale-95 cursor-pointer"
                      title="اتصال مباشر بالهاتف"
                    >
                      <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{cust.phone}</span>
                    </a>
                    <span className="text-[10px] text-slate-400 font-medium">موبايل</span>
                  </div>

                  {/* Google Maps Location Button */}
                  <div className="flex items-center justify-between">
                    <a
                      href={cust.geoCoordinates?.trim()
                        ? (cust.geoCoordinates.startsWith('http')
                            ? cust.geoCoordinates
                            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cust.geoCoordinates)}`)
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cust.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 font-medium border border-blue-200 shadow-2xs transition-all active:scale-95 cursor-pointer max-w-[210px] truncate"
                      title="فتح موقع المحل على خرائط Google Maps"
                    >
                      <MapPin className="w-3.5 h-3.5 text-red-600 shrink-0" />
                      <span className="truncate">{cust.address || cust.geoCoordinates || 'موقع الخريطة'}</span>
                      <ExternalLink className="w-3 h-3 text-blue-700 shrink-0" />
                    </a>
                    <span className="text-[10px] text-slate-400 font-medium">خرائط</span>
                  </div>
                </div>

                {/* Current Balance Box */}
                <div className={`p-3 rounded-2xl border flex items-center justify-between ${
                  isDebtor ? 'bg-red-50/60 border-red-200' : isCreditor ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200'
                }`}>
                  <span className="font-bold text-slate-600">الرصيد:</span>
                  <div className="text-left font-mono">
                    <span className={`text-sm font-black ${
                      isDebtor ? 'text-red-700' : isCreditor ? 'text-emerald-700' : 'text-slate-800'
                    }`}>
                      {cust.currentBalance.toLocaleString()} {settings.currency}
                    </span>
                    <span className="block text-[9px] text-slate-500 font-normal">
                      {isDebtor ? 'مديونية مستحقة' : isCreditor ? 'رصيد دائن' : 'خالص'}
                    </span>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPaymentCustomer(cust);
                      setPaymentAmount(cust.currentBalance > 0 ? cust.currentBalance : 0);
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs active:scale-95 transition-all cursor-pointer"
                  >
                    <ArrowDownLeft className="w-4 h-4" />
                    <span>تحصيل نقدية</span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCustomerId(cust.id);
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-100 hover:bg-blue-50 hover:text-blue-900 text-slate-800 rounded-xl font-bold transition-all cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>الملف الشامل</span>
                  </button>

                  {hasPermission('canManageUsers') && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLinkError(null);
                        setLinkMode('create');
                        setExistingLinkUserId('');
                        setNewCustomerUsername('');
                        setNewCustomerPassword('');
                        setLinkingCustomer(cust);
                      }}
                      title={cust.userId ? 'مرتبط بحساب دخول' : 'إنشاء أو ربط حساب دخول للتطبيق'}
                      className={`p-2 rounded-xl border font-bold cursor-pointer ${
                        cust.userId
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px]">
                  <th className="p-3.5">صورة المحل</th>
                  <th className="p-3.5">الكود</th>
                  <th className="p-3.5">اسم المحل / العميل</th>
                  <th className="p-3.5">الاتصال (موبايل)</th>
                  <th className="p-3.5">الموقع على الخريطة</th>
                  <th className="p-3.5 text-center">الرصيد الحالي</th>
                  <th className="p-3.5 text-center">الحالة</th>
                  <th className="p-3.5 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.map(cust => (
                  <tr
                    key={cust.id}
                    onClick={() => setSelectedCustomerId(cust.id)}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                  >
                    <td className="p-3">
                      {cust.photo ? (
                        <img
                          src={cust.photo}
                          alt={cust.name}
                          className="w-11 h-11 rounded-xl object-cover border border-slate-200 bg-slate-50"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-900 flex items-center justify-center">
                          <Store className="w-5 h-5 stroke-[1.5]" />
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-mono font-bold text-blue-900">{cust.code}</td>
                    <td className="p-3 font-black text-slate-900">{cust.name}</td>
                    <td className="p-3">
                      <a
                        href={`tel:${cust.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-mono font-bold border border-emerald-200"
                        title="اتصال مباشر"
                      >
                        <Phone className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{cust.phone}</span>
                      </a>
                    </td>
                    <td className="p-3">
                      <a
                        href={cust.geoCoordinates?.trim()
                          ? (cust.geoCoordinates.startsWith('http')
                              ? cust.geoCoordinates
                              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cust.geoCoordinates)}`)
                          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cust.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-900 font-medium border border-blue-200 max-w-[180px] truncate"
                        title="فتح خرائط Google"
                      >
                        <MapPin className="w-3 h-3 text-red-600 shrink-0" />
                        <span className="truncate">{cust.address || cust.geoCoordinates || 'موقع الخريطة'}</span>
                      </a>
                    </td>
                    <td className="p-3 text-center font-mono font-black">
                      <span className={cust.currentBalance > 0 ? 'text-red-700' : cust.currentBalance < 0 ? 'text-emerald-700' : 'text-slate-800'}>
                        {cust.currentBalance.toLocaleString()} {settings.currency}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        cust.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        {cust.status === 'active' ? 'نشط' : 'محظور'}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setPaymentCustomer(cust);
                            setPaymentAmount(cust.currentBalance > 0 ? cust.currentBalance : 0);
                          }}
                          className="p-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg"
                          title="تحصيل نقدية"
                        >
                          <ArrowDownLeft className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setSelectedCustomerId(cust.id)}
                          className="p-1.5 bg-blue-50 text-blue-900 hover:bg-blue-100 rounded-lg"
                          title="استعراض الملف الشامل"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => handleOpenEdit(cust, e)}
                          className="p-1.5 text-slate-400 hover:text-blue-900 hover:bg-slate-100 rounded-lg"
                          title="تعديل بيانات المحل والصورة"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteCustomerClick(cust, e)}
                          className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg"
                          title="حذف العميل"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <form onSubmit={handleSaveCustomer} className="space-y-4 text-xs">
          {customerFormError && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2.5 rounded-xl font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{customerFormError}</span>
            </div>
          )}
          {/* Store Photo Upload Section */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <label className="block font-black text-slate-900 mb-2">
              صورة المحل / المنشأة:
            </label>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              {/* Photo Preview */}
              <div className="relative w-24 h-24 rounded-2xl border-2 border-slate-300 bg-white overflow-hidden flex items-center justify-center shrink-0 shadow-xs">
                {formData.photo ? (
                  <img
                    src={formData.photo}
                    alt="صورة المحل"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center text-slate-400 p-2">
                    <Store className="w-8 h-8 mx-auto stroke-[1.5] text-slate-300" />
                    <span className="text-[10px] block mt-1">لا توجد صورة</span>
                  </div>
                )}
                {formData.photo && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="absolute top-1 left-1 bg-red-600 text-white rounded-full p-1 hover:bg-red-700 shadow-md cursor-pointer"
                    title="حذف الصورة"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Upload Action */}
              <div className="flex-1 space-y-2 text-center sm:text-right">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  التقط صورة المحل بكاميرا الهاتف أو اختر صورة من جهازك. يتم ضغط الصورة تلقائياً وحفظها بأمان للعمل دون إنترنت (Offline).
                </p>

                <div className="flex flex-wrap items-center gap-2 justify-center sm:justify-start">
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white font-bold rounded-xl text-xs cursor-pointer shadow-sm active:scale-95 transition-all">
                    <Camera className="w-4 h-4" />
                    <span>{formData.photo ? 'تغيير صورة المحل' : 'رفع / تصوير المحل'}</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>

                  {formData.photo && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-xl font-bold border border-red-200"
                    >
                      إلغاء الصورة
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold focus:border-blue-600 outline-hidden"
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
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                رقم الهاتف الرئيسي: <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  required
                  placeholder="مثال: 01012345678"
                  value={formData.phone}
                  onChange={(e) => {
                    setFormData({ ...formData, phone: e.target.value });
                    if (phoneActionNotice) setPhoneActionNotice(null);
                  }}
                  className="flex-1 bg-white border border-slate-300 rounded-xl p-2.5 font-mono font-bold focus:border-blue-600 outline-hidden"
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
                      className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold shrink-0 transition-colors"
                      title="اتصال هاتفي بالرقم"
                    >
                      <Phone className="w-4 h-4 text-emerald-700" />
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
                      className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300 font-bold shrink-0 cursor-pointer transition-colors"
                      title="اتصال هاتفي"
                    >
                      <Phone className="w-4 h-4" />
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

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                رقم هاتف إضافي:
              </label>
              <input
                type="tel"
                placeholder="مثال: 01123456789"
                value={formData.secondaryPhone}
                onChange={(e) => setFormData({ ...formData, secondaryPhone: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-mono font-bold focus:border-blue-600 outline-hidden"
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
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-semibold focus:border-blue-600 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                الموقع الجغرافي / إحداثيات GPS (أو رابط خرائط):
              </label>
              <input
                type="text"
                placeholder="مثال: 30.0444, 31.2357 أو رابط خرائط"
                value={formData.geoCoordinates}
                onChange={(e) => setFormData({ ...formData, geoCoordinates: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-mono text-xs focus:border-blue-600 outline-hidden"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                عنوان المحل بالتفصيل: <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  required
                  placeholder="مثال: شارع الجمهورية الرئيسي، بجوار مسجد السلام، طنطا"
                  value={formData.address}
                  onChange={(e) => {
                    setFormData({ ...formData, address: e.target.value });
                    if (mapActionWarning) setMapActionWarning(null);
                  }}
                  className="flex-1 bg-white border border-slate-300 rounded-xl p-2.5 font-semibold focus:border-blue-600 outline-hidden"
                />
                {(() => {
                  const rawGeo = (formData.geoCoordinates || '').trim();
                  const addressQuery = [formData.address.trim(), formData.area.trim()].filter(Boolean).join(', ');
                  const hasTarget = Boolean(rawGeo || addressQuery);
                  const mapsUrl = rawGeo.startsWith('http://') || rawGeo.startsWith('https://')
                    ? rawGeo
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rawGeo || addressQuery)}`;
                  return hasTarget ? (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMapActionWarning(null)}
                      className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 font-bold shrink-0 transition-colors"
                      title="عرض الموقع على خرائط جوجل"
                    >
                      <MapPin className="w-4 h-4 text-blue-700" />
                      <span>خريطة</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMapActionWarning('يرجى إدخال عنوان المحل أو إحداثيات GPS أولاً لفتحه على الخريطة.')}
                      className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300 font-bold shrink-0 cursor-pointer transition-colors"
                      title="فتح الموقع على الخرائط"
                    >
                      <MapPin className="w-4 h-4" />
                      <span>خريطة</span>
                    </button>
                  );
                })()}
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
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono font-bold text-blue-900"
              />
            </div>
          </div>

          {/* Allowed Representatives Assignment */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
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
                      className={`flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition-colors ${
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!editingCustomer ? (
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  رصيد أول المدة الافتتاحي ({settings.currency}):
                </label>
                <input
                  type="number"
                  value={formData.openingBalance}
                  onChange={(e) => setFormData({ ...formData, openingBalance: Number(e.target.value) })}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-mono font-bold"
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
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold outline-hidden focus:border-blue-600"
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
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 outline-hidden focus:border-blue-600"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black shadow-md cursor-pointer"
            >
              {editingCustomer ? 'حفظ التعديلات' : 'تسجيل العميل في المنظومة'}
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
          <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
            {paymentError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
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
                      setPaymentAmount(found.currentBalance > 0 ? found.currentBalance : 0);
                    }
                  }}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold outline-hidden focus:border-blue-600"
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
                المبلغ المحصل نقداً ({settings.currency}): <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                value={paymentAmount || ''}
                onChange={(e) => setPaymentAmount(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-lg font-black text-center text-emerald-800 font-mono outline-hidden focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">الخزينة المودع بها المبلغ:</label>
              <select
                value={paymentCashboxId}
                onChange={(e) => setPaymentCashboxId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold outline-hidden focus:border-blue-600"
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>
                    {cb.name} (رصيدها: {cb.currentBalance.toLocaleString()} {settings.currency})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">البيان والملاحظات:</label>
              <input
                type="text"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="سداد دفعة نقدية من الحساب / تحصيل مبيعات..."
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 outline-hidden focus:border-blue-600"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setPaymentCustomer(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black shadow-md cursor-pointer"
              >
                تأكيد التحصيل وطباعة الإيصال
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
          <div className="space-y-4 text-xs">
            {deleteErrorMessage ? (
              <div className="p-4 bg-red-50 text-red-900 border border-red-200 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 font-black text-sm text-red-700">
                  <ShieldAlert className="w-5 h-5 shrink-0" />
                  <span>تنبيه أمان وحماية الحسابات</span>
                </div>
                <p className="leading-relaxed">{deleteErrorMessage}</p>
                <div className="pt-2">
                  <button
                    onClick={() => {
                      updateCustomer(customerToDelete.id, { status: 'blocked' });
                      setCustomerToDelete(null);
                    }}
                    className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl"
                  >
                    تغيير حالة العميل إلى "محظور" بدلاً من الحذف
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-4 bg-amber-50 text-amber-900 rounded-2xl border border-amber-200">
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
                    className="px-4 py-2 border rounded-xl font-bold hover:bg-slate-50"
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl shadow-xs"
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
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 font-mono">
              <div>المستودع: <strong className="font-sans">{previewInvoice.warehouseName}</strong></div>
              <div>المندوب: <strong className="font-sans">{previewInvoice.representativeName || '-'}</strong></div>
              <div>طريقة السداد: <strong className="font-sans">{previewInvoice.paymentType === 'cash' ? 'نقدي' : previewInvoice.paymentType === 'credit' ? 'آجل' : 'جزئي'}</strong></div>
              <div>الحالة: <strong className="text-emerald-700 font-sans">مؤكدة</strong></div>
            </div>

            <table className="w-full text-right border">
              <thead>
                <tr className="bg-slate-100 font-bold border-b text-slate-700">
                  <th className="p-2.5">الصنف</th>
                  <th className="p-2.5">الوحدة</th>
                  <th className="p-2.5 text-center">الكمية</th>
                  <th className="p-2.5 text-center">السعر</th>
                  <th className="p-2.5 text-center">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {previewInvoice.items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="p-2.5 font-bold">{it.productName}</td>
                    <td className="p-2.5 text-slate-600">{it.unit}</td>
                    <td className="p-2.5 text-center font-mono font-bold">{it.quantity}</td>
                    <td className="p-2.5 text-center font-mono">{it.unitPrice.toLocaleString()}</td>
                    <td className="p-2.5 text-center font-mono font-bold">{it.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-between items-center bg-blue-900 text-white p-3.5 rounded-xl font-bold font-mono">
              <span>إجمالي الفاتورة: {previewInvoice.grandTotal.toLocaleString()} {settings.currency}</span>
              <span>المدفوع: {previewInvoice.paidAmount.toLocaleString()}</span>
              <span>المتبقي: {previewInvoice.remainingAmount.toLocaleString()}</span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => setPreviewInvoice(null)}
                className="px-4 py-2 border rounded-xl font-bold"
              >
                إغلاق
              </button>
              <button
                onClick={() => {
                  handlePrintSingleInvoice(previewInvoice);
                  setPreviewInvoice(null);
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 text-white rounded-xl font-bold"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الفاتورة</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* REJECT ORDER WITH MANDATORY REASON MODAL                  */}
      {/* ========================================================= */}
      {rejectingOrder && (
        <Modal
          isOpen={!!rejectingOrder}
          onClose={() => setRejectingOrder(null)}
          title={`رفض طلب العميل: ${rejectingOrder.requestNumber}`}
          subtitle={`العميل: ${rejectingOrder.customerName}`}
          maxWidth="md"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!rejectReason.trim()) return;
              const r = await rejectCustomerItemOrder(rejectingOrder.id, rejectReason.trim());
              if (!r.success) {
                setOrderActionBanner({ type: 'error', text: r.error || 'تعذر رفض الطلب' });
              } else {
                setOrderActionBanner({ type: 'success', text: `تم رفض الطلب (${rejectingOrder.requestNumber}) وتبليغ العميل بالسبب.` });
                setRejectingOrder(null);
              }
            }}
            className="space-y-4 text-xs"
          >
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                سبب رفض الطلب (إلزامي وسيظهر للعميل): <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="مثال: الصنف غير متوفر بالكمية المطلوبة حالياً..."
                className="w-full border border-slate-300 rounded-xl p-2.5 focus:border-red-600 outline-hidden"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setRejectingOrder(null)}
                className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={!rejectReason.trim()}
                className="px-5 py-2 bg-red-700 hover:bg-red-800 text-white rounded-xl font-black disabled:opacity-50 cursor-pointer"
              >
                تأكيد رفض الطلب
              </button>
            </div>
          </form>
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
                setOrderActionBanner({
                  type: 'success',
                  text: `تم ربط العميل (${linkingCustomer.name}) بحساب الدخول بنجاح.`,
                });
                setLinkingCustomer(null);
              } finally {
                setIsLinking(false);
              }
            }}
            className="space-y-4 text-xs"
          >
            {linkError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
                {linkError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 font-bold">
              <button
                type="button"
                onClick={() => setLinkMode('create')}
                className={`p-2 rounded-xl border cursor-pointer ${
                  linkMode === 'create' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                إنشاء حساب دخول جديد
              </button>
              <button
                type="button"
                onClick={() => setLinkMode('existing')}
                className={`p-2 rounded-xl border cursor-pointer ${
                  linkMode === 'existing' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                ربط بحساب موجود مسبقاً
              </button>
            </div>

            {linkMode === 'create' ? (
              <div className="space-y-3">
                <div>
                  <label className="block font-bold mb-1">اسم المستخدم للدخول (Username):</label>
                  <input
                    type="text"
                    required
                    value={newCustomerUsername}
                    onChange={(e) => setNewCustomerUsername(e.target.value)}
                    placeholder="مثال: shop_baraka"
                    className="w-full border rounded-xl p-2.5 font-mono font-bold"
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
                    className="w-full border rounded-xl p-2.5 font-mono"
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
                  className="w-full border rounded-xl p-2.5 font-bold bg-white"
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
                className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isLinking}
                className="px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black disabled:opacity-50 cursor-pointer"
              >
                {isLinking ? 'جاري الربط...' : 'اعتماد وربط الحساب'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* CONVERT APPROVED CUSTOMER ORDER TO SALES INVOICE MODAL    */}
      {/* ========================================================= */}
      <NewSaleInvoiceModal
        isOpen={!!convertingOrder}
        onClose={() => setConvertingOrder(null)}
        sourceOrder={convertingOrder}
        onInvoiceCreated={(inv) => {
          setOrderActionBanner({
            type: 'success',
            text: `تم تحويل طلب العميل إلى الفاتورة (${inv?.invoiceNumber || ''}) بنجاح.`,
          });
          setConvertingOrder(null);
        }}
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

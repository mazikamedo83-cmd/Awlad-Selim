import React, { useState, useMemo } from 'react';
import { 
  ArrowLeftRight, CheckCircle2, XCircle, Clock, AlertCircle, Plus, 
  Search, Filter, ShieldCheck, Printer, History, User, Building2, 
  HelpCircle, Check, Boxes, Package, Truck, Edit, Eye, FileText
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { RepTransfer, RepItemTransferRequest, RepTransferItem, Representative } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';

interface RepTransferViewProps {
  initialTab?: 'cash-transfers' | 'item-transfers' | 'reps-list';
}

export const RepTransferView: React.FC<RepTransferViewProps> = ({ initialTab = 'cash-transfers' }) => {
  const { 
    repTransfers, repItemTransfers = [], representatives, products, warehouses, invoices, cashboxes, settings, 
    createRepTransfer, confirmRepTransferReceipt, rejectRepTransfer,
    createRepItemTransfer, updateRepItemTransferStatus, addRepresentative, updateRepresentative
  } = useData();
  const { currentUser, hasPermission } = useAuth();

  const [activeTab, setActiveTab] = useState<'cash-transfers' | 'item-transfers' | 'reps-list'>(initialTab);

  // Cash Transfers state
  const [isNewCashModalOpen, setIsNewCashModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTransferForAudit, setActiveTransferForAudit] = useState<RepTransfer | null>(null);

  // New cash transfer form state
  const [direction, setDirection] = useState<'owner_to_rep' | 'rep_to_owner'>('rep_to_owner');
  const [selectedRepId, setSelectedRepId] = useState<string>(representatives[0]?.id || '');
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [amount, setAmount] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Print state
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Rep Item Transfers (Custody linked to invoice) state
  const [isNewItemReqModalOpen, setIsNewItemReqModalOpen] = useState(false);
  const [activeItemReqDetail, setActiveItemReqDetail] = useState<RepItemTransferRequest | null>(null);
  const [itemReqRepId, setItemReqRepId] = useState<string>(representatives[0]?.id || '');
  const [itemReqInvoiceId, setItemReqInvoiceId] = useState<string>('');
  const [itemReqSourceWhId, setItemReqSourceWhId] = useState<string>(warehouses[0]?.id || '');
  const [itemReqTargetWhId, setItemReqTargetWhId] = useState<string>(warehouses[1]?.id || warehouses[0]?.id || '');
  const [itemReqNotes, setItemReqNotes] = useState<string>('');
  const [selectedItemsForReq, setSelectedItemsForReq] = useState<Array<{
    productId: string;
    productName: string;
    unit: string;
    requestedQty: number;
    availableInVanQty: number;
    shortageQty: number;
  }>>([]);
  const [tempProdId, setTempProdId] = useState<string>('');
  const [tempQty, setTempQty] = useState<number>(10);
  const [isSubmittingItemReq, setIsSubmittingItemReq] = useState(false);
  const [itemReqError, setItemReqError] = useState<string | null>(null);

  // Add Representative Modal state
  const [isAddRepModalOpen, setIsAddRepModalOpen] = useState(false);
  const [editingRep, setEditingRep] = useState<Representative | null>(null);
  const [repName, setRepName] = useState('');
  const [repPhone, setRepPhone] = useState('');
  const [repVehicle, setRepVehicle] = useState('');
  const [repOpening, setRepOpening] = useState(0);

  // Role constraint: If current user is a representative, default to rep_to_owner and filter to their own transfers
  const isRepUser = currentUser?.role === 'representative';
  const myRepProfile = useMemo(() => {
    return representatives.find(r => r.userId === currentUser?.id || r.name === currentUser?.fullName);
  }, [representatives, currentUser]);

  const filteredTransfers = useMemo(() => {
    return repTransfers.filter(t => {
      if (isRepUser && myRepProfile) {
        if (t.senderId !== myRepProfile.id && t.receiverId !== myRepProfile.id) {
          return false;
        }
      }
      const matchSearch = 
        t.transferNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.senderName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.receiverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.cashboxName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'all' ? true : t.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [repTransfers, searchTerm, statusFilter, isRepUser, myRepProfile]);

  const filteredItemTransfers = useMemo(() => {
    return repItemTransfers.filter(r => {
      if (isRepUser && myRepProfile) {
        if (r.representativeId !== myRepProfile.id) return false;
      }
      return r.requestNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.representativeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.invoiceNumber && r.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()));
    });
  }, [repItemTransfers, searchTerm, isRepUser, myRepProfile]);

  // Handle Submit Cash Transfer
  const handleSubmitCashTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amount <= 0) {
      setError('يرجى تحديد مبلغ صالح أكبر من الصفر');
      return;
    }

    const rep = representatives.find(r => r.id === selectedRepId);
    if (!rep) {
      setError('يرجى اختيار المندوب المعني');
      return;
    }

    const cb = cashboxes.find(c => c.id === selectedCashboxId);
    if (!cb) {
      setError('يرجى تحديد الخزينة');
      return;
    }

    setIsSubmitting(true);

    let senderId = '';
    let senderName = '';
    let receiverId = '';
    let receiverName = '';

    if (direction === 'rep_to_owner') {
      senderId = rep.id;
      senderName = rep.name;
      receiverId = 'OWNER';
      receiverName = 'الفرع الرئيسي (الخزينة)';
    } else {
      senderId = 'OWNER';
      senderName = 'الفرع الرئيسي (الخزينة)';
      receiverId = rep.id;
      receiverName = rep.name;
    }

    const res = await createRepTransfer({
      direction,
      senderId,
      senderName,
      receiverId,
      receiverName,
      amount,
      cashboxId: selectedCashboxId,
      notes,
    });

    setIsSubmitting(false);

    if (res.success) {
      setIsNewCashModalOpen(false);
      setAmount(0);
      setNotes('');
      if (res.transfer) {
        handlePrintTransfer(res.transfer);
      }
    } else {
      setError(res.error || 'تعذر إرسال طلب التحويل');
    }
  };

  const handleConfirmReceipt = async (t: RepTransfer) => {
    if (!window.confirm(`هل أنت متأكد من تأكيد استلام مبلغ (${t.amount.toLocaleString()} ${settings.currency}) الخاص بالتحويل ${t.transferNumber}؟ سيتم تحديث أرصدة الخزينة وحساب المندوب فوراً.`)) {
      return;
    }

    const res = await confirmRepTransferReceipt(t.id, 'تم التأكيد والاستلام الفعلي');
    if (!res.success) {
      setError(res.error || 'فشل تأكيد الاستلام');
    }
  };

  const handleRejectTransfer = async (t: RepTransfer) => {
    const reason = prompt('يرجى إدخال سبب رفض استلام هذا التحويل:');
    if (!reason) return;

    const res = await rejectRepTransfer(t.id, reason);
    if (!res.success) {
      setError(res.error || 'فشل رفض التحويل');
    }
  };

  const handlePrintTransfer = (t: RepTransfer) => {
    setPrintData({
      title: 'إيصال طلب تحويل بالنصف (إشعار تحويل مالي بين المندوب والفرع)',
      docNumber: t.transferNumber,
      docType: 'إيصال استلام',
      date: t.date,
      partyName: t.direction === 'rep_to_owner' ? t.senderName : t.receiverName,
      representativeName: t.direction === 'rep_to_owner' ? t.senderName : t.receiverName,
      grandTotal: t.amount,
      paidAmount: t.amount,
      paymentType: 'تحويل نقدي بالنصف',
      notes: `حالة التحويل: ${t.status === 'received' ? 'تم الاستلام والتأكيد' : 'قيد الاستلام'} | الخزينة: ${t.cashboxName} | ملاحظات: ${t.notes || 'لا يوجد'}`,
    });
    setIsPrintModalOpen(true);
  };

  // Add item to request
  const handleAddItemToReq = () => {
    if (!tempProdId || tempQty <= 0) return;
    const prod = products.find(p => p.id === tempProdId);
    if (!prod) return;

    const sourceStock = prod.stockPerWarehouse[itemReqSourceWhId] || 0;
    const vanStock = prod.stockPerWarehouse[itemReqTargetWhId] || 0;
    const shortage = Math.max(0, tempQty - vanStock);

    setSelectedItemsForReq(prev => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        unit: prod.baseUnit,
        requestedQty: tempQty,
        availableInVanQty: vanStock,
        shortageQty: shortage,
      }
    ]);
    setTempProdId('');
    setTempQty(10);
  };

  const handleRemoveItemFromReq = (idx: number) => {
    setSelectedItemsForReq(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmitItemTransferRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setItemReqError(null);
    if (selectedItemsForReq.length === 0) {
      setItemReqError('يرجى إضافة صنف واحد على الأقل للتحويل');
      return;
    }

    const rep = representatives.find(r => r.id === itemReqRepId);
    if (!rep) {
      setItemReqError('يرجى اختيار المندوب');
      return;
    }

    const sourceWh = warehouses.find(w => w.id === itemReqSourceWhId);
    const targetWh = warehouses.find(w => w.id === itemReqTargetWhId) || warehouses[0];

    const linkedInv = invoices.find(i => i.id === itemReqInvoiceId);

    setIsSubmittingItemReq(true);
    const res = await createRepItemTransfer({
      date: new Date().toISOString().split('T')[0],
      representativeId: rep.id,
      representativeName: rep.name,
      invoiceId: linkedInv?.id,
      invoiceNumber: linkedInv?.invoiceNumber,
      sourceWarehouseId: sourceWh?.id || 'WH-01',
      sourceWarehouseName: sourceWh?.name || 'المستودع الرئيسي',
      targetWarehouseId: targetWh?.id || 'WH-VAN',
      targetWarehouseName: targetWh?.name || `سيارة المندوب (${rep.name})`,
      items: selectedItemsForReq.map(it => ({
        ...it,
        approvedQty: it.requestedQty,
      })),
      notes: itemReqNotes,
    });
    setIsSubmittingItemReq(false);

    if (res.success) {
      setIsNewItemReqModalOpen(false);
      setSelectedItemsForReq([]);
      setItemReqNotes('');
    } else {
      setItemReqError(res.error || 'فشل إرسال طلب التحويل');
    }
  };

  const handleExecuteItemTransfer = async (req: RepItemTransferRequest) => {
    if (!window.confirm(`هل أنت متأكد من اعتماد ونقل بضاعة هذا الطلب (${req.requestNumber}) من ${req.sourceWarehouseName} إلى عهدة سيارة المندوب ${req.representativeName}؟ سيتم خصم المستودع الرئيسي فوراً.`)) {
      return;
    }
    const res = await updateRepItemTransferStatus(req.id, 'executed');
    if (!res.success) {
      alert(res.error || 'فشل تنفيذ تحويل الأصناف');
    } else {
      alert('تم تنفيذ التحويل المخزني بنجاح وتحديث عهدة سيارة المندوب!');
      setActiveItemReqDetail(null);
    }
  };

  const handleRejectItemTransfer = async (req: RepItemTransferRequest) => {
    const reason = prompt('يرجى ذكر سبب رفض طلب تحويل الأصناف:');
    if (!reason) return;
    const res = await updateRepItemTransferStatus(req.id, 'rejected', undefined, reason);
    if (!res.success) {
      alert(res.error || 'فشل رفض الطلب');
    } else {
      setActiveItemReqDetail(null);
    }
  };

  // Add / Edit Representative
  const handleSaveRep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repName.trim()) return;
    if (editingRep) {
      await updateRepresentative(editingRep.id, {
        name: repName,
        phone: repPhone,
        vehicleNumber: repVehicle,
      });
    } else {
      await addRepresentative({
        name: repName,
        phone: repPhone,
        vehicleNumber: repVehicle,
        openingBalance: repOpening,
        status: 'active',
      });
    }
    setIsAddRepModalOpen(false);
    setEditingRep(null);
    setRepName('');
    setRepPhone('');
    setRepVehicle('');
    setRepOpening(0);
  };

  const getStatusBadge = (status: RepTransfer['status']) => {
    switch (status) {
      case 'received':
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>تم الاستلام وتعديل الأرصدة</span>
          </span>
        );
      case 'awaiting_receipt':
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-300 text-xs font-bold animate-pulse">
            <Clock className="w-3.5 h-3.5" />
            <span>في انتظار تأكيد الاستلام</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-bold">
            <XCircle className="w-3.5 h-3.5" />
            <span>مرفوض</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">
            ملغى
          </span>
        );
      default:
        return <span className="text-xs font-bold text-slate-500">جديد</span>;
    }
  };

  const getItemReqStatusBadge = (status: RepItemTransferRequest['status']) => {
    switch (status) {
      case 'executed':
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
            <Check className="w-3 h-3" />
            <span>تم التحويل والخصم المخزني</span>
          </span>
        );
      case 'approved':
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
            <CheckCircle2 className="w-3 h-3" />
            <span>معتمد (بانتظار الصرف)</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
            <XCircle className="w-3 h-3" />
            <span>مرفوض من الإدارة</span>
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300 text-[10px] font-bold animate-pulse">
            <Clock className="w-3 h-3" />
            <span>قيد المراجعة الإدارية</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-black text-slate-900 tracking-tight">إدارة المندوبين والتحويلات والعهد</h2>
            <span className="bg-blue-100 text-blue-800 text-[11px] font-bold px-2 py-0.5 rounded-full border border-blue-200">
              ربط الفواتير والتحصيل
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            متابعة عهدة البضاعة في سيارات المناديب، التحويلات النقدية بالنصف، وطلبات تحويل الأصناف المرتبطة بالفواتير
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'cash-transfers' && (
            <button
              onClick={() => setIsNewCashModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white text-xs font-black rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>طلب تحويل مالي جديد (نصف)</span>
            </button>
          )}

          {activeTab === 'item-transfers' && (
            <button
              onClick={() => setIsNewItemReqModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>طلب تحويل أصناف وعهدة (+)</span>
            </button>
          )}

          {activeTab === 'reps-list' && (
            <button
              onClick={() => {
                setEditingRep(null);
                setRepName('');
                setRepPhone('');
                setRepVehicle('');
                setRepOpening(0);
                setIsAddRepModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white text-xs font-black rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مندوب جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center gap-1.5 p-1.5 bg-slate-200/80 rounded-2xl overflow-x-auto text-xs font-bold no-print">
        <button
          onClick={() => setActiveTab('cash-transfers')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'cash-transfers' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4 text-blue-700" />
          <span>التحويل المالي والنقدي (طلب تحويل بالنصف)</span>
        </button>

        <button
          onClick={() => setActiveTab('item-transfers')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'item-transfers' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Boxes className="w-4 h-4 text-emerald-600" />
          <span>طلبات تحويل الأصناف والعهد (مرتبطة بالفاتورة)</span>
          {repItemTransfers.filter(r => r.status === 'pending').length > 0 && (
            <span className="bg-amber-500 text-white px-1.5 py-0.2 rounded-full text-[10px]">
              {repItemTransfers.filter(r => r.status === 'pending').length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('reps-list')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'reps-list' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <User className="w-4 h-4 text-purple-600" />
          <span>دليل المناديب ومتابعة العهد ({representatives.length})</span>
        </button>
      </div>

      {/* TAB 1: Cash Transfers (Two-way) */}
      {activeTab === 'cash-transfers' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                placeholder="بحث برقم التحويل أو اسم المندوب أو الخزينة..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 focus:outline-hidden"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-bold">الحالة:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="p-2 border rounded-xl bg-white font-bold"
              >
                <option value="all">جميع الحالات</option>
                <option value="awaiting_receipt">في انتظار تأكيد الاستلام</option>
                <option value="received">تم الاستلام وتعديل الأرصدة</option>
                <option value="rejected">مرفوض</option>
              </select>
            </div>
          </div>

          {/* Transfers Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                    <th className="p-3.5">رقم التحويل</th>
                    <th className="p-3.5">التاريخ</th>
                    <th className="p-3.5">اتجاه التحويل</th>
                    <th className="p-3.5">الطرف المرسل</th>
                    <th className="p-3.5">الطرف المستلم</th>
                    <th className="p-3.5">المبلغ المحول</th>
                    <th className="p-3.5">الخزينة المتأثرة</th>
                    <th className="p-3.5">الحالة</th>
                    <th className="p-3.5 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransfers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400">
                        لا توجد طلبات تحويل نقدية مسجلة
                      </td>
                    </tr>
                  ) : (
                    filteredTransfers.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3.5 font-bold font-mono text-blue-900">{t.transferNumber}</td>
                        <td className="p-3.5 font-mono text-slate-600">{t.date}</td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            t.direction === 'rep_to_owner'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-blue-50 text-blue-800 border border-blue-200'
                          }`}>
                            {t.direction === 'rep_to_owner' ? 'توريد تحصيل (من مندوب لفرع)' : 'صرف عهدة (من فرع لمندوب)'}
                          </span>
                        </td>
                        <td className="p-3.5 font-bold text-slate-800">{t.senderName}</td>
                        <td className="p-3.5 font-bold text-slate-800">{t.receiverName}</td>
                        <td className="p-3.5 font-black text-slate-900 font-mono">
                          {t.amount.toLocaleString()} {settings.currency}
                        </td>
                        <td className="p-3.5 text-slate-600">{t.cashboxName}</td>
                        <td className="p-3.5">{getStatusBadge(t.status)}</td>
                        <td className="p-3.5">
                          <div className="flex items-center justify-center gap-1.5">
                            {t.status === 'awaiting_receipt' && (
                              <>
                                <button
                                  onClick={() => handleConfirmReceipt(t)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] shadow-xs cursor-pointer"
                                  title="تأكيد الاستلام الفعلي واعتماد القيد المحاسبي"
                                >
                                  تأكيد الاستلام
                                </button>
                                <button
                                  onClick={() => handleRejectTransfer(t)}
                                  className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-bold text-[11px] cursor-pointer"
                                  title="رفض استلام التحويل"
                                >
                                  رفض
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => handlePrintTransfer(t)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50"
                              title="طباعة إيصال التحويل"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setActiveTransferForAudit(t)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50"
                              title="سجل التتبع والمراجعة (Audit Trail)"
                            >
                              <History className="w-4 h-4" />
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
        </div>
      )}

      {/* TAB 2: Item Transfer Requests Linked to Invoice (Section 16) */}
      {activeTab === 'item-transfers' && (
        <div className="space-y-4">
          <div className="bg-emerald-50/70 border border-emerald-200 p-4 rounded-2xl text-xs text-emerald-950 flex items-start gap-3">
            <Truck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-black text-sm">دورة عمل طلبات تحويل أصناف وعهدة المندوب المعتمدة (Section 16):</h4>
              <p className="mt-1 leading-relaxed text-emerald-900 text-[11px]">
                عند إصدار المندوب فاتورة مبيعات لعميل جملة ويوجد عجز في كميات السيارة، يتم إنشاء طلب تحويل أصناف مرتبط برقم الفاتورة الأصلية.
                <strong> لا يتم خصم المخزن الرئيسي إلا بعد مراجعة الإدارة والموافقة والتنفيذ الفعلي للتحويل.</strong>
              </p>
            </div>
          </div>

          {/* Item Requests Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                    <th className="p-3.5">رقم الطلب</th>
                    <th className="p-3.5">التاريخ</th>
                    <th className="p-3.5">المندوب</th>
                    <th className="p-3.5">الفاتورة المرتبطة</th>
                    <th className="p-3.5">المستودع المصدر</th>
                    <th className="p-3.5">المستودع الوجهة (السيارة)</th>
                    <th className="p-3.5">عدد الأصناف</th>
                    <th className="p-3.5">الحالة</th>
                    <th className="p-3.5 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredItemTransfers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400">
                        لا توجد طلبات تحويل أصناف أو عهدة مسجلة حتى الآن
                      </td>
                    </tr>
                  ) : (
                    filteredItemTransfers.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3.5 font-bold font-mono text-blue-900">{req.requestNumber}</td>
                        <td className="p-3.5 font-mono text-slate-600">{req.date}</td>
                        <td className="p-3.5 font-bold text-slate-800">{req.representativeName}</td>
                        <td className="p-3.5 font-mono font-bold text-blue-800">
                          {req.invoiceNumber ? `فاتورة: ${req.invoiceNumber}` : 'تحويل إداري مباشر'}
                        </td>
                        <td className="p-3.5 text-slate-600">{req.sourceWarehouseName}</td>
                        <td className="p-3.5 text-slate-600">{req.targetWarehouseName}</td>
                        <td className="p-3.5 font-bold text-slate-700">{req.items.length} أصناف</td>
                        <td className="p-3.5">{getItemReqStatusBadge(req.status)}</td>
                        <td className="p-3.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setActiveItemReqDetail(req)}
                              className="px-2.5 py-1 bg-blue-50 text-blue-900 hover:bg-blue-100 rounded-lg font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>فحص الأصناف</span>
                            </button>
                            {req.status === 'pending' && currentUser?.role === 'admin' && (
                              <button
                                onClick={() => handleExecuteItemTransfer(req)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] cursor-pointer"
                                title="موافقة ونقل البضاعة لسيارة المندوب"
                              >
                                اعتماد ونقل
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Representatives Directory & Custody Balances */}
      {activeTab === 'reps-list' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {representatives.map((rep) => (
            <div key={rep.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3 text-xs">
              <div className="flex items-center justify-between border-b pb-2.5">
                <div>
                  <h3 className="font-black text-sm text-slate-900">{rep.name}</h3>
                  <span className="text-[10px] text-slate-500 font-mono">هاتف: {rep.phone}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  rep.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                }`}>
                  {rep.status === 'active' ? 'نشط ميدانياً' : 'موقف'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2.5 bg-slate-50 rounded-xl">
                  <span className="text-[10px] text-slate-500 block">رقم السيارة / العهدة:</span>
                  <strong className="text-slate-800 font-bold">{rep.vehicleNumber || 'سيارة التوزيع 1'}</strong>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-xl">
                  <span className="text-[10px] text-slate-500 block">العهدة المالية الحالية:</span>
                  <strong className="text-emerald-700 font-black font-mono">
                    {rep.currentBalance.toLocaleString()} {settings.currency}
                  </strong>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t text-[11px]">
                <button
                  onClick={() => {
                    setSelectedRepId(rep.id);
                    setDirection('rep_to_owner');
                    setIsNewCashModalOpen(true);
                  }}
                  className="text-blue-900 font-bold hover:underline cursor-pointer"
                >
                  توريد نقدية للمحل
                </button>
                <button
                  onClick={() => {
                    setEditingRep(rep);
                    setRepName(rep.name);
                    setRepPhone(rep.phone);
                    setRepVehicle(rep.vehicleNumber || '');
                    setRepOpening(rep.openingBalance);
                    setIsAddRepModalOpen(true);
                  }}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                  title="تعديل بيانات المندوب"
                >
                  <Edit className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Cash Transfer Modal */}
      {isNewCashModalOpen && (
        <Modal
          isOpen={isNewCashModalOpen}
          onClose={() => setIsNewCashModalOpen(false)}
          title="طلب تحويل مالي بالنصف (توريد تحصيلات أو صرف عهدة)"
        >
          <form onSubmit={handleSubmitCashTransfer} className="space-y-4 text-xs">
            {error && (
              <div className="p-3 bg-red-50 text-red-700 rounded-xl flex items-center gap-2 border border-red-200">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">اتجاه التحويل:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDirection('rep_to_owner')}
                  className={`p-2.5 rounded-xl border text-center font-bold cursor-pointer transition-all ${
                    direction === 'rep_to_owner' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-50 text-slate-700'
                  }`}
                >
                  توريد من مندوب إلى الفرع
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('owner_to_rep')}
                  className={`p-2.5 rounded-xl border text-center font-bold cursor-pointer transition-all ${
                    direction === 'owner_to_rep' ? 'bg-blue-900 text-white shadow-xs' : 'bg-slate-50 text-slate-700'
                  }`}
                >
                  صرف عهدة نقدية للمندوب
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">المندوب المعني:</label>
              <select
                value={selectedRepId}
                onChange={(e) => setSelectedRepId(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
              >
                {representatives.map(r => (
                  <option key={r.id} value={r.id}>{r.name} (رصيد عهدته: {r.currentBalance} {settings.currency})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1">المبلغ المحول ({settings.currency}):</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 font-bold text-sm"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">الخزينة المتأثرة للفرع:</label>
                <select
                  value={selectedCashboxId}
                  onChange={(e) => setSelectedCashboxId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  {cashboxes.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.currentBalance.toLocaleString()} {settings.currency})</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">ملاحظات التحويل:</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="تفاصيل التوريد أو سبب الصرف..."
                className="w-full p-2.5 rounded-xl border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsNewCashModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'جاري الإرسال...' : 'إرسال طلب التحويل'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* New Item Transfer Request Modal (Linked to Invoice) */}
      {isNewItemReqModalOpen && (
        <Modal
          isOpen={isNewItemReqModalOpen}
          onClose={() => setIsNewItemReqModalOpen(false)}
          title="طلب تحويل أصناف وعهدة مخزنية (مرتبط بفاتورة مبيعات)"
        >
          <form onSubmit={handleSubmitItemTransferRequest} className="space-y-4 text-xs">
            {itemReqError && (
              <div className="p-3 bg-red-50 text-red-700 rounded-xl flex items-center gap-2 border border-red-200">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{itemReqError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1">المندوب:</label>
                <select
                  value={itemReqRepId}
                  onChange={(e) => setItemReqRepId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  {representatives.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">الفاتورة المرتبطة (إن وجدت):</label>
                <select
                  value={itemReqInvoiceId}
                  onChange={(e) => setItemReqInvoiceId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  <option value="">-- بدون ربط بفاتورة (تحويل عهدة مباشر) --</option>
                  {invoices.filter(i => i.type === 'sales').map(inv => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} - {inv.customerName} ({inv.grandTotal} {settings.currency})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1">المستودع المصدر (المقر الرئيسي):</label>
                <select
                  value={itemReqSourceWhId}
                  onChange={(e) => setItemReqSourceWhId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">مستودع الوجهة (سيارة المندوب):</label>
                <select
                  value={itemReqTargetWhId}
                  onChange={(e) => setItemReqTargetWhId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Item Selector Box */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <span className="font-bold text-slate-800 block">إضافة أصناف للطلب:</span>
              <div className="flex items-center gap-2">
                <select
                  value={tempProdId}
                  onChange={(e) => setTempProdId(e.target.value)}
                  className="flex-1 p-2 rounded-xl border border-slate-300 bg-white text-xs"
                >
                  <option value="">-- اختر الصنف المطلوب --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} [{p.category}] - المتاح بالرئيسي: {p.stockPerWarehouse[itemReqSourceWhId] || 0} {p.baseUnit}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={tempQty}
                  onChange={(e) => setTempQty(parseFloat(e.target.value) || 1)}
                  className="w-20 p-2 rounded-xl border border-slate-300 text-center font-bold"
                  placeholder="الكمية"
                />
                <button
                  type="button"
                  onClick={handleAddItemToReq}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold cursor-pointer"
                >
                  إضافة +
                </button>
              </div>

              {selectedItemsForReq.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden mt-2 bg-white">
                  <table className="w-full text-right text-[11px]">
                    <thead className="bg-slate-100 border-b">
                      <tr>
                        <th className="p-2">الصنف</th>
                        <th className="p-2 text-center">الكمية المطلوبة</th>
                        <th className="p-2 text-center">المتاح بالسيارة</th>
                        <th className="p-2 text-center">العجز</th>
                        <th className="p-2 text-center">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {selectedItemsForReq.map((it, idx) => (
                        <tr key={idx}>
                          <td className="p-2 font-bold">{it.productName}</td>
                          <td className="p-2 text-center font-bold text-blue-900">{it.requestedQty} {it.unit}</td>
                          <td className="p-2 text-center text-slate-600">{it.availableInVanQty}</td>
                          <td className="p-2 text-center font-bold text-red-600">{it.shortageQty}</td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItemFromReq(idx)}
                              className="text-red-500 hover:text-red-700 font-bold"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <label className="block font-bold mb-1">ملاحظات الطلب:</label>
              <textarea
                rows={2}
                value={itemReqNotes}
                onChange={(e) => setItemReqNotes(e.target.value)}
                placeholder="أسباب طلب العهدة أو مواعيد التسليم..."
                className="w-full p-2.5 rounded-xl border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsNewItemReqModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmittingItemReq || selectedItemsForReq.length === 0}
                className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmittingItemReq ? 'جاري الإرسال...' : 'إرسال طلب التحويل للإدارة'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Item Transfer Request Detail Modal (Approval & Execution) */}
      {activeItemReqDetail && (
        <Modal
          isOpen={!!activeItemReqDetail}
          onClose={() => setActiveItemReqDetail(null)}
          title={`تفاصيل طلب تحويل أصناف رقم: ${activeItemReqDetail.requestNumber}`}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl">
              <div>
                <p className="text-slate-500">المندوب: <strong className="text-slate-800">{activeItemReqDetail.representativeName}</strong></p>
                <p className="text-slate-500">المستودع المصدر: <strong className="text-slate-800">{activeItemReqDetail.sourceWarehouseName}</strong></p>
              </div>
              <div>
                <p className="text-slate-500">التاريخ: <strong className="font-mono text-slate-800">{activeItemReqDetail.date}</strong></p>
                <p className="text-slate-500">الفاتورة المرتبطة: <strong className="text-blue-900">{activeItemReqDetail.invoiceNumber || 'تحويل مباشر'}</strong></p>
              </div>
            </div>

            <div>
              <span className="font-bold text-slate-800 block mb-1.5">الأصناف المطلوبة وحالة العجز:</span>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-100 border-b">
                    <tr>
                      <th className="p-2.5">الصنف</th>
                      <th className="p-2.5 text-center">الوحدة</th>
                      <th className="p-2.5 text-center">الكمية المطلوبة</th>
                      <th className="p-2.5 text-center">المتاح بالسيارة</th>
                      <th className="p-2.5 text-center">العجز</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {activeItemReqDetail.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="p-2.5 font-bold text-slate-800">{item.productName}</td>
                        <td className="p-2.5 text-center text-slate-600">{item.unit}</td>
                        <td className="p-2.5 text-center font-bold text-blue-900">{item.requestedQty}</td>
                        <td className="p-2.5 text-center text-slate-600">{item.availableInVanQty}</td>
                        <td className="p-2.5 text-center font-black text-red-600">{item.shortageQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {activeItemReqDetail.notes && (
              <p className="text-slate-600 italic">ملاحظات: {activeItemReqDetail.notes}</p>
            )}

            <div className="flex justify-between items-center pt-3 border-t">
              <div>{getItemReqStatusBadge(activeItemReqDetail.status)}</div>

              <div className="flex items-center gap-2">
                {activeItemReqDetail.status === 'pending' && currentUser?.role === 'admin' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleRejectItemTransfer(activeItemReqDetail)}
                      className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 font-bold rounded-xl cursor-pointer"
                    >
                      رفض الطلب
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExecuteItemTransfer(activeItemReqDetail)}
                      className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-black rounded-xl shadow-md cursor-pointer"
                    >
                      موافقة وتنفيذ الخصم المخزني
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setActiveItemReqDetail(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Add / Edit Representative Modal */}
      {isAddRepModalOpen && (
        <Modal
          isOpen={isAddRepModalOpen}
          onClose={() => setIsAddRepModalOpen(false)}
          title={editingRep ? 'تعديل بيانات المندوب' : 'إضافة مندوب مبيعات جديد'}
        >
          <form onSubmit={handleSaveRep} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold mb-1">اسم المندوب:</label>
              <input
                type="text"
                required
                value={repName}
                onChange={(e) => setRepName(e.target.value)}
                placeholder="اسم المندوب ثلاثي..."
                className="w-full p-2.5 rounded-xl border border-slate-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1">رقم الهاتف:</label>
                <input
                  type="text"
                  required
                  value={repPhone}
                  onChange={(e) => setRepPhone(e.target.value)}
                  placeholder="010XXXXXXXX"
                  className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">رقم السيارة / رمز العهدة:</label>
                <input
                  type="text"
                  value={repVehicle}
                  onChange={(e) => setRepVehicle(e.target.value)}
                  placeholder="مثال: سيارة توزيع 4 (أ ب ج 123)"
                  className="w-full p-2.5 rounded-xl border border-slate-300"
                />
              </div>
            </div>

            {!editingRep && (
              <div>
                <label className="block font-bold mb-1">رصيد العهدة الافتتاحي ({settings.currency}):</label>
                <input
                  type="number"
                  value={repOpening}
                  onChange={(e) => setRepOpening(parseFloat(e.target.value) || 0)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 font-mono"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsAddRepModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer"
              >
                {editingRep ? 'تحديث المندوب' : 'حفظ المندوب الجديد'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Cash Transfer Audit Trail Modal */}
      {activeTransferForAudit && (
        <Modal
          isOpen={!!activeTransferForAudit}
          onClose={() => setActiveTransferForAudit(null)}
          title={`سجل المراجعة والتأكيد الثنائي للتحويل: ${activeTransferForAudit.transferNumber}`}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border flex items-center justify-between">
              <div>
                <span className="block text-slate-500">المبلغ المحول:</span>
                <span className="text-sm font-black text-blue-950 font-mono">
                  {activeTransferForAudit.amount.toLocaleString()} {settings.currency}
                </span>
              </div>
              <div>{getStatusBadge(activeTransferForAudit.status)}</div>
            </div>

            <div className="space-y-3 relative before:absolute before:top-2 before:bottom-2 before:right-3.5 before:w-0.5 before:bg-slate-200">
              {activeTransferForAudit.auditTrail.map((log, idx) => (
                <div key={idx} className="relative flex items-start gap-3 mr-1">
                  <div className="w-6 h-6 rounded-full bg-blue-900 text-white flex items-center justify-center font-bold text-[10px] shrink-0 z-10">
                    {idx + 1}
                  </div>
                  <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-slate-900">{log.action}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(log.timestamp).toLocaleString('ar-EG')}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      بواسطة: <strong className="text-blue-900">{log.user}</strong>
                    </div>
                    {log.note && (
                      <p className="mt-1 text-[11px] text-slate-500 italic">"{log.note}"</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-3 border-t">
              <button
                onClick={() => setActiveTransferForAudit(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Print Document Modal */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />
    </div>
  );
};

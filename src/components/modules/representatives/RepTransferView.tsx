import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  ArrowLeftRight, CheckCircle2, XCircle, Clock, AlertCircle, Plus, 
  Printer, History, User, Boxes, Truck, Edit, Eye, Check,
  Download, PackageCheck, RotateCcw, AlertTriangle, Wallet, RefreshCw
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { RepTransfer, RepItemTransferRequest, Representative, RepCustodyStatementResponse, UserPermissions } from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { CashTransferIcon, StockTransfersIcon, RepsFleetIcon, AccountsLedgerIcon } from '../../common/AppIcons';

const REP_DEFAULT_PERMISSIONS: UserPermissions = {
  canView: true,
  canAdd: true,
  canEdit: true,
  canDelete: false,
  canPrint: true,
  canExport: false,
  canViewReports: false,
  canManageSales: true,
  canManagePurchases: false,
  canCreatePurchase: true,
  canManageInventory: false,
  canManageWarehouses: false,
  canManageCashboxes: false,
  canManageAccounts: false,
  canManageReps: false,
  canManageTransfers: true,
  canManageEmployees: false,
  canManageSalaries: false,
  canManageUsers: false,
  canManageSettings: false,
  canAllowNegativeInventory: false,
  canApprove: false,
  canSend: true,
  canReceive: true,
  canReviewRepInvoices: false,
  canViewPersonalAccounts: false,
  canCreatePersonalTx: false,
  canEditPersonalTx: false,
  canApprovePersonalAdjustment: false,
  canCreateStockCount: false,
  canApproveStockCount: false,
  canCreateStockTransfer: false,
  canApproveStockTransfer: false,
  canExecuteStockTransfer: false,
  canViewDeletedInvoices: false,
};

interface RepTransferViewProps {
  initialTab?: 'cash-transfers' | 'item-transfers' | 'reps-list' | 'rep-custody-statement';
}

export const RepTransferView: React.FC<RepTransferViewProps> = ({ initialTab = 'cash-transfers' }) => {
  const { 
    repTransfers, repItemTransfers = [], representatives, customers, products, warehouses, invoices, cashboxes, settings, 
    createRepTransfer, confirmRepTransferReceipt, rejectRepTransfer,
    createRepItemTransfer, updateRepItemTransferStatus, addRepresentative, updateRepresentative, addUser,
    getRepCustodyStatement, recordRepCustodyDelivery, recordRepCustodyReturn, recordRepCustodyAdjustment,
  } = useData();
  const { currentUser, hasPermission } = useAuth();

  const [activeTab, setActiveTab] = useState<'cash-transfers' | 'item-transfers' | 'reps-list' | 'rep-custody-statement'>(initialTab);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant: 'danger' | 'warning' | 'info' | 'success';
    requireInput?: boolean;
    inputLabel?: string;
    inputPlaceholder?: string;
    onConfirm: (inputValue?: string) => Promise<void> | void;
  } | null>(null);

  const repProdSearchRef = useRef<HTMLInputElement | null>(null);
  const repProdQtyRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Cash Transfers state
  const [isNewCashModalOpen, setIsNewCashModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTransferForAudit, setActiveTransferForAudit] = useState<RepTransfer | null>(null);

  // New cash transfer form state
  const [direction, setDirection] = useState<'owner_to_rep' | 'rep_to_owner'>('rep_to_owner');
  const [selectedRepId, setSelectedRepId] = useState<string>(representatives[0]?.id || '');
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [amount, setAmount] = useState<number | ''>('');
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
  const [itemReqTransferMode, setItemReqTransferMode] = useState<'transfer' | 'custody_dispatch'>('transfer');
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
  const [tempQty, setTempQty] = useState<number | ''>('');
  const [isSubmittingItemReq, setIsSubmittingItemReq] = useState(false);
  const [itemReqError, setItemReqError] = useState<string | null>(null);

  // Add Representative Modal state
  const [isAddRepModalOpen, setIsAddRepModalOpen] = useState(false);
  const [editingRep, setEditingRep] = useState<Representative | null>(null);
  const [repName, setRepName] = useState('');
  const [repPhone, setRepPhone] = useState('');
  const [repVehicle, setRepVehicle] = useState('');
  const [repOpening, setRepOpening] = useState<number | ''>('');
  const [createRepAccount, setCreateRepAccount] = useState(true);
  const [repUsername, setRepUsername] = useState('');
  const [repPassword, setRepPassword] = useState('');
  const [isSavingRep, setIsSavingRep] = useState(false);
  const [repFormError, setRepFormError] = useState<string | null>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState(false);

  // Rep Custody Statement state
  const [custodyRepId, setCustodyRepId] = useState<string>(representatives[0]?.id || '');
  const [custodyDateFrom, setCustodyDateFrom] = useState<string>('');
  const [custodyDateTo, setCustodyDateTo] = useState<string>('');
  const [custodyStatement, setCustodyStatement] = useState<RepCustodyStatementResponse | null>(null);
  const [isCustodyLoading, setIsCustodyLoading] = useState(false);
  const [custodyError, setCustodyError] = useState<string | null>(null);

  // Custody Action Modals (Delivery / Return / Admin Adjustment)
  const [custodyActionModal, setCustodyActionModal] = useState<'deliver' | 'return' | 'adjust' | null>(null);
  const [custodyOpProductId, setCustodyOpProductId] = useState('');
  const [custodyOpQty, setCustodyOpQty] = useState<number | ''>('');
  const [custodyOpCustomerId, setCustodyOpCustomerId] = useState('');
  const [custodyOpCustomerName, setCustodyOpCustomerName] = useState('');
  const [custodyOpTargetWhId, setCustodyOpTargetWhId] = useState(warehouses[0]?.id || 'wh-main');
  const [custodyOpType, setCustodyOpType] = useState<'custody_damaged' | 'custody_shortage' | 'custody_adjustment'>('custody_damaged');
  const [custodyOpDate, setCustodyOpDate] = useState(new Date().toISOString().split('T')[0]);
  const [custodyOpNotes, setCustodyOpNotes] = useState('');
  const [isSubmittingCustodyOp, setIsSubmittingCustodyOp] = useState(false);

  // Role constraint: If current user is a representative, default to rep_to_owner and filter to their own transfers
  const isRepUser = currentUser?.role === 'representative';
  const myRepProfile = useMemo(() => {
    return (
      representatives.find((r) => r.userId && r.userId === currentUser?.id) ||
      (!isRepUser ? representatives.find((r) => !r.userId && r.name === currentUser?.fullName) : undefined)
    );
  }, [representatives, currentUser, isRepUser]);

  // Sync defaults when async data arrives
  useEffect(() => {
    if (representatives.length > 0) {
      if (!selectedRepId) setSelectedRepId(representatives[0].id);
      if (!itemReqRepId) setItemReqRepId(representatives[0].id);
      if (isRepUser && myRepProfile) {
        setCustodyRepId(myRepProfile.id);
      } else if (!custodyRepId) {
        setCustodyRepId(representatives[0].id);
      }
    }
    if (cashboxes.length > 0 && !selectedCashboxId) {
      setSelectedCashboxId(cashboxes[0].id);
    }
    if (warehouses.length > 0) {
      if (!itemReqSourceWhId) setItemReqSourceWhId(warehouses[0].id);
      if (!itemReqTargetWhId) setItemReqTargetWhId((warehouses[1] || warehouses[0]).id);
      if (!custodyOpTargetWhId) setCustodyOpTargetWhId(warehouses[0].id);
    }
  }, [representatives, cashboxes, warehouses, selectedRepId, itemReqRepId, custodyRepId, selectedCashboxId, itemReqSourceWhId, itemReqTargetWhId, custodyOpTargetWhId, isRepUser, myRepProfile]);

  const loadCustodyStatement = useCallback(async (targetRepId?: string) => {
    const rid = targetRepId || custodyRepId;
    if (!rid) return;
    setIsCustodyLoading(true);
    setCustodyError(null);
    const res = await getRepCustodyStatement(rid, {
      dateFrom: custodyDateFrom || undefined,
      dateTo: custodyDateTo || undefined,
    });
    setIsCustodyLoading(false);
    if (!res.success || !res.statement) {
      setCustodyError(res.error || 'تعذر تحميل كشف حساب وعهدة المندوب');
    } else {
      setCustodyStatement(res.statement);
    }
  }, [custodyRepId, custodyDateFrom, custodyDateTo, getRepCustodyStatement]);

  useEffect(() => {
    if (activeTab === 'rep-custody-statement' && custodyRepId) {
      loadCustodyStatement(custodyRepId);
    }
  }, [activeTab, custodyRepId, loadCustodyStatement]);

  const filteredTransfers = useMemo(() => {
    return repTransfers.filter(t => {
      if (isRepUser && myRepProfile) {
        if (t.senderId !== myRepProfile.id && t.receiverId !== myRepProfile.id) {
          return false;
        }
      }
      return statusFilter === 'all' ? true : t.status === statusFilter;
    });
  }, [repTransfers, statusFilter, isRepUser, myRepProfile]);

  const filteredItemTransfers = useMemo(() => {
    return repItemTransfers.filter(r => {
      if (isRepUser && myRepProfile) {
        if (r.representativeId !== myRepProfile.id) return false;
      }
      return true;
    });
  }, [repItemTransfers, isRepUser, myRepProfile]);

  // Handle Submit Cash Transfer
  const handleSubmitCashTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const numAmt = Number(amount || 0);
    if (numAmt <= 0) {
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
      amount: numAmt,
      cashboxId: selectedCashboxId,
      notes,
    });

    setIsSubmitting(false);

    if (res.success) {
      setIsNewCashModalOpen(false);
      setAmount('');
      setNotes('');
      if (res.transfer) {
        handlePrintTransfer(res.transfer);
      }
    } else {
      setError(res.error || 'تعذر إرسال طلب التحويل');
    }
  };

  const handleConfirmReceipt = (t: RepTransfer) => {
    setConfirmState({
      isOpen: true,
      title: 'تأكيد استلام التحويل النقدي',
      message: `هل أنت متأكد من تأكيد استلام مبلغ (${t.amount.toLocaleString()} ${settings.currency}) الخاص بالتحويل ${t.transferNumber}؟ سيتم تحديث أرصدة الخزينة وحساب المندوب فوراً.`,
      confirmLabel: 'تأكيد الاستلام',
      variant: 'success',
      onConfirm: async () => {
        setConfirmState(null);
        const res = await confirmRepTransferReceipt(t.id, 'تم التأكيد والاستلام الفعلي');
        if (!res.success) {
          setStatusBanner({ type: 'error', text: res.error || 'فشل تأكيد الاستلام' });
        } else {
          setStatusBanner({ type: 'success', text: `تم تأكيد استلام التحويل (${t.transferNumber}) وتحديث الأرصدة.` });
        }
      },
    });
  };

  const handleRejectTransfer = (t: RepTransfer) => {
    setConfirmState({
      isOpen: true,
      title: 'رفض التحويل النقدي',
      message: `رفض التحويل رقم (${t.transferNumber}) بمبلغ (${t.amount.toLocaleString()} ${settings.currency}).`,
      confirmLabel: 'تأكيد الرفض',
      variant: 'danger',
      requireInput: true,
      inputLabel: 'سبب رفض التحويل:',
      inputPlaceholder: 'اكتب سبب رفض التحويل...',
      onConfirm: async (reason) => {
        setConfirmState(null);
        if (!reason) return;
        const res = await rejectRepTransfer(t.id, reason);
        if (!res.success) {
          setStatusBanner({ type: 'error', text: res.error || 'فشل رفض التحويل' });
        } else {
          setStatusBanner({ type: 'success', text: `تم رفض التحويل (${t.transferNumber}).` });
        }
      },
    });
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
    const qtyVal = Number(tempQty || 0);
    if (!tempProdId || qtyVal <= 0) return;
    const prod = products.find(p => p.id === tempProdId);
    if (!prod) return;

    const vanStock = prod.stockPerWarehouse[itemReqTargetWhId] || 0;
    const shortage = Math.max(0, qtyVal - vanStock);

    setSelectedItemsForReq((prev) => {
      const existingIdx = prev.findIndex((it) => it.productId === prod.id && it.unit === prod.baseUnit);
      if (existingIdx >= 0) {
        return prev.map((it, idx) => {
          if (idx !== existingIdx) return it;
          const nextQty = Number((it.requestedQty + qtyVal).toFixed(4));
          return {
            ...it,
            requestedQty: nextQty,
            availableInVanQty: vanStock,
            shortageQty: Math.max(0, nextQty - vanStock),
          };
        });
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          unit: prod.baseUnit,
          requestedQty: qtyVal,
          availableInVanQty: vanStock,
          shortageQty: shortage,
        },
      ];
    });
    setTempProdId('');
    setTempQty('');
    window.setTimeout(() => repProdSearchRef.current?.focus(), 25);
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
      transferMode: itemReqTransferMode,
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
      setItemReqTransferMode('transfer');
      setStatusBanner({
        type: 'success',
        text:
          itemReqTransferMode === 'custody_dispatch'
            ? 'تم صرف العهدة من المخزن الرئيسي — بانتظار تأكيد استلام المندوب.'
            : 'تم إرسال طلب تحويل الأصناف للمراجعة بنجاح.',
      });
    } else {
      setItemReqError(res.error || 'فشل إرسال طلب التحويل');
    }
  };

  const handleConfirmCustodyReceipt = (req: RepItemTransferRequest) => {
    setConfirmState({
      isOpen: true,
      title: 'تأكيد استلام العهدة في سيارة المندوب',
      message: `هل تؤكد استلام الأصناف الفعلية الخاصة بالإذن (${req.requestNumber})؟ لن تُضاف الأصناف لعهدة السيارة إلا بعد تأكيد الاستلام.`,
      confirmLabel: 'تأكيد الاستلام الفعلي',
      variant: 'success',
      onConfirm: async () => {
        setConfirmState(null);
        const res = await updateRepItemTransferStatus(req.id, 'received');
        if (!res.success) {
          setStatusBanner({ type: 'error', text: res.error || 'فشل تأكيد استلام العهدة' });
        } else {
          setStatusBanner({ type: 'success', text: `تم تأكيد استلام العهدة (${req.requestNumber}) وإضافتها لسيارة المندوب.` });
          setActiveItemReqDetail(null);
        }
      },
    });
  };

  const handleSubmitCustodyOp = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyVal = Number(custodyOpQty || 0);
    if (!custodyActionModal || !custodyOpProductId || qtyVal <= 0) return;
    setIsSubmittingCustodyOp(true);
    let res: { success: boolean; error?: string } = { success: false };
    if (custodyActionModal === 'deliver') {
      const cust = customers.find((c) => c.id === custodyOpCustomerId);
      res = await recordRepCustodyDelivery({
        representativeId: custodyRepId,
        customerId: cust?.id,
        customerName: cust?.name || custodyOpCustomerName.trim() || undefined,
        productId: custodyOpProductId,
        quantity: qtyVal,
        date: custodyOpDate,
        notes: custodyOpNotes.trim() || undefined,
      });
    } else if (custodyActionModal === 'return') {
      res = await recordRepCustodyReturn({
        representativeId: custodyRepId,
        targetWarehouseId: custodyOpTargetWhId,
        productId: custodyOpProductId,
        quantity: qtyVal,
        date: custodyOpDate,
        notes: custodyOpNotes.trim() || undefined,
      });
    } else {
      res = await recordRepCustodyAdjustment({
        representativeId: custodyRepId,
        productId: custodyOpProductId,
        operationType: custodyOpType,
        quantity: qtyVal,
        date: custodyOpDate,
        notes: custodyOpNotes.trim() || undefined,
      });
    }
    setIsSubmittingCustodyOp(false);
    if (!res.success) {
      setStatusBanner({ type: 'error', text: res.error || 'تعذر تنفيذ عملية العهدة' });
    } else {
      setCustodyActionModal(null);
      setCustodyOpQty('');
      setCustodyOpNotes('');
      setCustodyOpCustomerName('');
      setStatusBanner({ type: 'success', text: 'تم تسجيل حركة العهدة وتحديث رصيد المندوب بنجاح.' });
      await loadCustodyStatement(custodyRepId);
    }
  };

  const handleExportCustodyExcel = () => {
    if (!custodyStatement) return;
    const headers = [
      'كود الصنف',
      'اسم الصنف',
      'الوحدة',
      'المستلم فعلياً',
      'قيد الاستلام',
      'مسلم للعملاء',
      'مرتجع للمخزن',
      'تسويات/تالف',
      'المتبقي بالعهدة',
      'رصيد السيارة الفعلي',
      'القيمة بالتكلفة',
    ];
    const rows = custodyStatement.itemsSummary.map((it) => [
      it.productCode,
      it.productName,
      it.baseUnit,
      it.receivedQty,
      it.pendingReceiveQty,
      it.deliveredToCustomersQty,
      it.returnedToWarehouseQty,
      it.approvedReductionsQty,
      it.remainingCustodyQty,
      it.vanPhysicalStockQty,
      it.custodyValueAtCost,
    ]);
    exportToExcel(`كشف_عهدة_${custodyStatement.representative.name}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handlePrintCustodyStatement = () => {
    if (!custodyStatement) return;
    setPrintData({
      title: `كشف حساب وعهدة المندوب — ${custodyStatement.representative.name}`,
      docNumber: custodyStatement.representative.id,
      docType: 'كشف حساب',
      date: new Date().toISOString().split('T')[0],
      partyName: custodyStatement.representative.name,
      partyPhone: custodyStatement.representative.phone,
      representativeName: custodyStatement.representative.name,
      tableHeaders: ['م', 'الصنف', 'الوحدة', 'مستلم', 'مسلم للعملاء', 'مرتجع', 'المتبقي بالعهدة'],
      items: custodyStatement.itemsSummary.map((it) => ({
        name: it.productName,
        unit: it.baseUnit,
        quantity: it.receivedQty,
        price: it.deliveredToCustomersQty,
        discount: it.returnedToWarehouseQty,
        total: it.remainingCustodyQty,
      })),
      grandTotal: custodyStatement.totals.totalCustodyCostValue,
      paidAmount: custodyStatement.financialSummary.totalSalesPaidAmount,
      remainingAmount: custodyStatement.financialSummary.currentCashCustodyBalance,
      notes: `إجمالي المبيعات: ${custodyStatement.financialSummary.totalSalesAmount.toLocaleString()} ${settings.currency} | إجمالي المسلم للعملاء: ${custodyStatement.totals.totalDeliveredQty} | المتبقي بالعهدة: ${custodyStatement.totals.totalRemainingCustodyQty}`,
    });
    setIsPrintModalOpen(true);
  };

  const handleExecuteItemTransfer = (req: RepItemTransferRequest) => {
    setConfirmState({
      isOpen: true,
      title: 'اعتماد وتنفيذ صرف العهدة من المخزن الرئيسي',
      message: `سيتم خصم البضاعة من (${req.sourceWarehouseName}) للطلب (${req.requestNumber}). لن تُضاف الكمية إلى سيارة المندوب إلا بعد تأكيد استلام المندوب لها.`,
      confirmLabel: 'اعتماد وصرف من المخزن',
      variant: 'success',
      onConfirm: async () => {
        setConfirmState(null);
        const res = await updateRepItemTransferStatus(req.id, 'executed');
        if (!res.success) {
          setStatusBanner({ type: 'error', text: res.error || 'فشل تنفيذ تحويل الأصناف' });
        } else {
          setStatusBanner({ type: 'success', text: 'تم الصرف من المخزن الرئيسي — بانتظار تأكيد استلام المندوب لإضافتها لعهدة السيارة.' });
          setActiveItemReqDetail(null);
        }
      },
    });
  };

  const handleRejectItemTransfer = (req: RepItemTransferRequest) => {
    setConfirmState({
      isOpen: true,
      title: 'رفض طلب تحويل الأصناف',
      message: `رفض طلب تحويل العهدة رقم (${req.requestNumber}) للمندوب ${req.representativeName}.`,
      confirmLabel: 'تأكيد الرفض',
      variant: 'danger',
      requireInput: true,
      inputLabel: 'سبب رفض طلب تحويل الأصناف:',
      inputPlaceholder: 'اكتب سبب الرفض...',
      onConfirm: async (reason) => {
        setConfirmState(null);
        if (!reason) return;
        const res = await updateRepItemTransferStatus(req.id, 'rejected', undefined, reason);
        if (!res.success) {
          setStatusBanner({ type: 'error', text: res.error || 'فشل رفض الطلب' });
        } else {
          setStatusBanner({ type: 'success', text: `تم رفض الطلب (${req.requestNumber}).` });
          setActiveItemReqDetail(null);
        }
      },
    });
  };

  // Add / Edit Representative
  const handleSaveRep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingRep) return;
    setRepFormError(null);
    if (!repName.trim()) {
      setRepFormError('يرجى إدخال اسم المندوب.');
      return;
    }
    if (!editingRep && createRepAccount) {
      if (repUsername.trim().length < 3) {
        setRepFormError('يرجى إدخال اسم مستخدم للمندوب (3 أحرف على الأقل).');
        return;
      }
      if (repPassword.length < 4) {
        setRepFormError('كلمة مرور حساب المندوب يجب أن لا تقل عن 4 أحرف.');
        return;
      }
    }
    setIsSavingRep(true);
    try {
      if (editingRep) {
        await updateRepresentative(editingRep.id, {
          name: repName.trim(),
          phone: repPhone.trim(),
          vehicleNumber: repVehicle.trim(),
        });
        setStatusBanner({ type: 'success', text: `تم تحديث بيانات المندوب (${repName.trim()}) بنجاح.` });
      } else if (createRepAccount) {
        const userRes = await addUser({
          fullName: repName.trim(),
          username: repUsername.trim(),
          password: repPassword,
          phone: repPhone.trim(),
          role: 'representative',
          jobTitle: 'مندوب مبيعات ميداني',
          department: 'المبيعات الخارجية',
          isActive: true,
          permissions: REP_DEFAULT_PERMISSIONS,
          autoCreateRepProfile: true,
        } as any);
        if (!userRes.success || !userRes.user) {
          setRepFormError(userRes.error || 'تعذر إنشاء حساب الدخول التلقائي للمندوب');
          return;
        }
        if (Number(repOpening) !== 0 || repVehicle.trim()) {
          await addRepresentative({
            userId: userRes.user.id,
            name: repName.trim(),
            phone: repPhone.trim(),
            vehicleNumber: repVehicle.trim(),
            openingBalance: Number(repOpening) || 0,
            status: 'active',
          });
        }
        setStatusBanner({
          type: 'success',
          text: `تم إنشاء ملف المندوب (${repName.trim()}) وحساب الدخول (${repUsername.trim()}) بصلاحيات المندوب الافتراضية تلقائياً.`,
        });
      } else {
        await addRepresentative({
          name: repName.trim(),
          phone: repPhone.trim(),
          vehicleNumber: repVehicle.trim(),
          openingBalance: Number(repOpening) || 0,
          status: 'active',
        });
        setStatusBanner({ type: 'success', text: `تمت إضافة المندوب (${repName.trim()}) بنجاح.` });
      }
      setIsAddRepModalOpen(false);
      setEditingRep(null);
      setRepName('');
      setRepPhone('');
      setRepVehicle('');
      setRepOpening('');
      setRepUsername('');
      setRepPassword('');
    } catch (err: any) {
      setRepFormError(err?.message || 'تعذر حفظ بيانات المندوب');
    } finally {
      setIsSavingRep(false);
    }
  };

  const getStatusBadge = (status: RepTransfer['status']) => {
    switch (status) {
      case 'received':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>تم الاستلام وتعديل الأرصدة</span>
          </span>
        );
      case 'awaiting_receipt':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 text-xs font-bold">
            <Clock className="w-3.5 h-3.5" />
            <span>في انتظار تأكيد الاستلام</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-xs font-bold">
            <XCircle className="w-3.5 h-3.5" />
            <span>مرفوض</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-slate-100 text-slate-700 text-xs font-bold">
            ملغى
          </span>
        );
      default:
        return <span className="text-xs font-bold text-slate-500">جديد</span>;
    }
  };

  const getItemReqStatusBadge = (status: RepItemTransferRequest['status']) => {
    switch (status) {
      case 'received':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 text-[10px] font-bold">
            <CheckCircle2 className="w-3 h-3" />
            <span>تم الاستلام الفعلي في سيارة المندوب</span>
          </span>
        );
      case 'executed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5] text-[10px] font-bold">
            <Check className="w-3 h-3" />
            <span>تم الصرف من المخزن — بانتظار تأكيد استلام المندوب</span>
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
            <CheckCircle2 className="w-3 h-3" />
            <span>معتمد (بانتظار الصرف)</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
            <XCircle className="w-3 h-3" />
            <span>مرفوض من الإدارة</span>
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 text-[10px] font-bold">
            <Clock className="w-3 h-3" />
            <span>قيد المراجعة الإدارية</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-2">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white dark:bg-[#0E1C36] px-2.5 py-2 rounded-lg border border-slate-200 dark:border-[#21375C]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC] tracking-tight">إدارة المندوبين والتحويلات والعهد</h2>
            <span className="bg-blue-50 dark:bg-[#16366B] text-blue-800 dark:text-[#85B8FF] text-[10px] font-bold px-2 py-0.5 rounded border border-blue-200 dark:border-[#2A436E]">
              ربط الفواتير والتحصيل
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-[#97AECE] mt-0.5">
            متابعة عهدة البضاعة في سيارات المناديب، التحويلات النقدية بالنصف، وطلبات تحويل الأصناف المرتبطة بالفواتير
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'cash-transfers' && (
            <button
              onClick={() => setIsNewCashModalOpen(true)}
              className="h-8 flex items-center gap-1.5 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>طلب تحويل مالي جديد (نصف)</span>
            </button>
          )}

          {activeTab === 'item-transfers' && (
            <button
              onClick={() => setIsNewItemReqModalOpen(true)}
              className="h-8 flex items-center gap-1.5 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>طلب تحويل أصناف وعهدة (+)</span>
            </button>
          )}

          {activeTab === 'reps-list' && (
            <button
              onClick={() => {
                setEditingRep(null);
                setRepFormError(null);
                setRepName('');
                setRepPhone('');
                setRepVehicle('');
                setRepOpening('');
                setRepUsername('');
                setRepPassword('');
                setCreateRepAccount(true);
                setIsAddRepModalOpen(true);
              }}
              className="h-8 flex items-center gap-1.5 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة مندوب جديد</span>
            </button>
          )}
        </div>
      </div>

      {statusBanner && (
        <div
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{statusBanner.text}</span>
          <button type="button" onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">
            إغلاق
          </button>
        </div>
      )}

      {/* Tabs Switcher */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/80 dark:bg-[#132544] border border-transparent dark:border-[#21375C] rounded-lg overflow-x-auto text-xs font-bold no-print">
        <button
          onClick={() => setActiveTab('cash-transfers')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'cash-transfers'
              ? 'bg-white dark:bg-[#1659C8] text-blue-950 dark:text-white shadow-xs font-black'
              : 'text-slate-600 dark:text-[#A9BCD9] hover:text-slate-900 dark:hover:text-[#F3F7FC]'
          }`}
        >
          <CashTransferIcon className="w-4 h-4 shrink-0" />
          <span>التحويل المالي والنقدي (طلب تحويل بالنصف)</span>
        </button>

        <button
          onClick={() => setActiveTab('item-transfers')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'item-transfers' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <StockTransfersIcon className="w-4 h-4 shrink-0" />
          <span>طلبات تحويل الأصناف والعهد (مرتبطة بالفاتورة)</span>
          {repItemTransfers.filter(r => r.status === 'pending').length > 0 && (
            <span className="bg-amber-600 text-white px-1.5 py-0.5 rounded text-[10px] tabular-nums">
              {repItemTransfers.filter(r => r.status === 'pending').length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('reps-list')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'reps-list' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <RepsFleetIcon className="w-4 h-4 shrink-0" />
          <span>دليل المناديب ومتابعة العهد ({representatives.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('rep-custody-statement')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'rep-custody-statement' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <AccountsLedgerIcon className="w-4 h-4 shrink-0" />
          <span>كشف حساب وعهدة المندوب</span>
        </button>
      </div>

      {/* TAB 1: Cash Transfers (Two-way) */}
      {activeTab === 'cash-transfers' && (
        <UnifiedDataTable<RepTransfer>
          compact
          title="طلبات التحويل النقدية والعهد المالية"
          subtitle="التحويلات المتبادلة بين المناديب والخزائن (توريد تحصيلات أو صرف عهدة)"
          data={filteredTransfers}
          rowKey={(t) => t.id}
          onRowClick={(t) => setActiveTransferForAudit(t)}
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="بحث برقم التحويل أو اسم المندوب أو الخزينة..."
          searchFilter={(t, q) =>
            t.transferNumber.toLowerCase().includes(q) ||
            t.senderName.toLowerCase().includes(q) ||
            t.receiverName.toLowerCase().includes(q) ||
            t.cashboxName.toLowerCase().includes(q)
          }
          toolbarFilters={
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-bold">الحالة:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-8 px-2 py-1 border border-slate-300 rounded-lg bg-white font-bold text-xs"
              >
                <option value="all">جميع الحالات</option>
                <option value="awaiting_receipt">في انتظار تأكيد الاستلام</option>
                <option value="received">تم الاستلام وتعديل الأرصدة</option>
                <option value="rejected">مرفوض</option>
              </select>
            </div>
          }
          exportFilename="التحويلات_النقدية_للمناديب"
          pdfTitle="سجل التحويلات النقدية والعهد المالية للمناديب"
          emptyTitle="لا توجد طلبات تحويل نقدية مسجلة"
          emptySubtitle="يمكنك إنشاء طلب تحويل مالي جديد من الزر بالأعلى"
          columns={[
            {
              key: 'transferNumber',
              header: 'رقم التحويل',
              sortable: true,
              sortValue: (t) => t.transferNumber,
              exportValue: (t) => t.transferNumber,
              render: (t) => <span className="font-bold font-mono text-blue-900">{t.transferNumber}</span>,
            },
            {
              key: 'date',
              header: 'التاريخ',
              sortable: true,
              sortValue: (t) => t.date,
              exportValue: (t) => t.date,
              render: (t) => <span className="font-mono text-slate-600">{t.date}</span>,
            },
            {
              key: 'direction',
              header: 'اتجاه التحويل',
              sortable: true,
              sortValue: (t) => t.direction,
              exportValue: (t) => (t.direction === 'rep_to_owner' ? 'توريد تحصيل (من مندوب لفرع)' : 'صرف عهدة (من فرع لمندوب)'),
              render: (t) => (
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  t.direction === 'rep_to_owner'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-blue-50 text-blue-800 border border-blue-200'
                }`}>
                  {t.direction === 'rep_to_owner' ? 'توريد تحصيل (من مندوب لفرع)' : 'صرف عهدة (من فرع لمندوب)'}
                </span>
              ),
            },
            {
              key: 'senderName',
              header: 'الطرف المرسل',
              sortable: true,
              sortValue: (t) => t.senderName,
              exportValue: (t) => t.senderName,
              render: (t) => <span className="font-bold text-slate-800">{t.senderName}</span>,
            },
            {
              key: 'receiverName',
              header: 'الطرف المستلم',
              sortable: true,
              sortValue: (t) => t.receiverName,
              exportValue: (t) => t.receiverName,
              render: (t) => <span className="font-bold text-slate-800">{t.receiverName}</span>,
            },
            {
              key: 'amount',
              header: 'المبلغ المحول',
              align: 'center',
              sortable: true,
              sortValue: (t) => t.amount,
              exportValue: (t) => t.amount,
              render: (t) => (
                <span className="font-black text-slate-900 font-mono tabular-nums">
                  {t.amount.toLocaleString()} {settings.currency}
                </span>
              ),
            },
            {
              key: 'cashboxName',
              header: 'الخزينة المتأثرة',
              sortable: true,
              sortValue: (t) => t.cashboxName,
              exportValue: (t) => t.cashboxName,
              render: (t) => <span className="text-slate-600">{t.cashboxName}</span>,
            },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              sortable: true,
              sortValue: (t) => t.status,
              exportValue: (t) => t.status,
              render: (t) => getStatusBadge(t.status),
            },
            {
              key: 'actions',
              header: 'الإجراءات',
              align: 'center',
              render: (t) => (
                <div className="flex items-center justify-center gap-1.5">
                  {t.status === 'awaiting_receipt' && (
                    <>
                      <button
                        onClick={() => handleConfirmReceipt(t)}
                        className="px-2.5 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold text-[11px] cursor-pointer"
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
                    className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 cursor-pointer"
                    title="طباعة إيصال التحويل"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setActiveTransferForAudit(t)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 cursor-pointer"
                    title="سجل التتبع والمراجعة (Audit Trail)"
                  >
                    <History className="w-4 h-4" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* TAB 2: Item Transfer Requests Linked to Invoice (Section 16) */}
      {activeTab === 'item-transfers' && (
        <div className="space-y-2">
          <div className="bg-[#EEF3FA] border border-[#DCE6F5] px-3 py-2 rounded-lg text-xs text-[#011E58] flex items-start gap-2.5">
            <Truck className="w-4 h-4 text-[#003589] shrink-0 mt-0.5" />
            <div>
              <h4 className="font-black text-xs">دورة عمل طلبات تحويل أصناف وعهدة المندوب المعتمدة (Section 16):</h4>
              <p className="mt-0.5 leading-relaxed text-[#002160] text-[11px]">
                عند إصدار المندوب فاتورة مبيعات لعميل جملة ويوجد عجز في كميات السيارة، يتم إنشاء طلب تحويل أصناف مرتبط برقم الفاتورة الأصلية.
                <strong> لا يتم خصم المخزن الرئيسي إلا بعد مراجعة الإدارة والموافقة والتنفيذ الفعلي للتحويل.</strong>
              </p>
            </div>
          </div>

          <UnifiedDataTable<RepItemTransferRequest>
            compact
            title="طلبات تحويل الأصناف وعهدة السيارات"
            subtitle="طلبات سحب البضاعة من المخزن الرئيسي إلى سيارات المناديب وتأكيد الاستلام"
            data={filteredItemTransfers}
            rowKey={(req) => req.id}
            onRowClick={(req) => setActiveItemReqDetail(req)}
            searchPlaceholder="بحث برقم الطلب أو اسم المندوب أو رقم الفاتورة..."
            searchFilter={(r, q) =>
              r.requestNumber.toLowerCase().includes(q) ||
              r.representativeName.toLowerCase().includes(q) ||
              (r.invoiceNumber ? r.invoiceNumber.toLowerCase().includes(q) : false)
            }
            exportFilename="طلبات_تحويل_أصناف_المناديب"
            pdfTitle="سجل طلبات تحويل الأصناف وعهد سيارات المناديب"
            emptyTitle="لا توجد طلبات تحويل أصناف أو عهدة مسجلة حتى الآن"
            columns={[
              {
                key: 'requestNumber',
                header: 'رقم الطلب',
                sortable: true,
                sortValue: (req) => req.requestNumber,
                exportValue: (req) => req.requestNumber,
                render: (req) => (
                  <div className="font-bold font-mono text-[#011E58]">
                    <div>{req.requestNumber}</div>
                    {req.transferMode === 'custody_dispatch' && (
                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-[#DCE6F5] text-[#002160] border border-[#B8CAE8] text-[9px] font-sans font-bold">
                        صرف عهدة مباشر
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: 'date',
                header: 'التاريخ',
                sortable: true,
                sortValue: (req) => req.date,
                exportValue: (req) => req.date,
                render: (req) => <span className="font-mono text-slate-600">{req.date}</span>,
              },
              {
                key: 'representativeName',
                header: 'المندوب',
                sortable: true,
                sortValue: (req) => req.representativeName,
                exportValue: (req) => req.representativeName,
                render: (req) => <span className="font-bold text-slate-800">{req.representativeName}</span>,
              },
              {
                key: 'invoiceNumber',
                header: 'الفاتورة المرتبطة',
                sortable: true,
                sortValue: (req) => req.invoiceNumber || '',
                exportValue: (req) => req.invoiceNumber || 'تحويل إداري مباشر',
                render: (req) => (
                  <span className="font-mono font-bold text-blue-800">
                    {req.invoiceNumber ? `فاتورة: ${req.invoiceNumber}` : 'تحويل إداري مباشر'}
                  </span>
                ),
              },
              {
                key: 'sourceWarehouseName',
                header: 'المستودع المصدر',
                exportValue: (req) => req.sourceWarehouseName,
                render: (req) => <span className="text-slate-600">{req.sourceWarehouseName}</span>,
              },
              {
                key: 'targetWarehouseName',
                header: 'المستودع الوجهة (السيارة)',
                exportValue: (req) => req.targetWarehouseName,
                render: (req) => <span className="text-slate-600">{req.targetWarehouseName}</span>,
              },
              {
                key: 'itemsCount',
                header: 'عدد الأصناف',
                align: 'center',
                sortable: true,
                sortValue: (req) => req.items.length,
                exportValue: (req) => req.items.length,
                render: (req) => <span className="font-bold text-slate-700 tabular-nums">{req.items.length} أصناف</span>,
              },
              {
                key: 'status',
                header: 'الحالة',
                align: 'center',
                sortable: true,
                sortValue: (req) => req.status,
                exportValue: (req) => req.status,
                render: (req) => getItemReqStatusBadge(req.status),
              },
              {
                key: 'actions',
                header: 'الإجراءات',
                align: 'center',
                render: (req) => (
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => setActiveItemReqDetail(req)}
                      className="px-2.5 py-1 bg-blue-50 text-blue-900 hover:bg-blue-100 rounded-lg font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>فحص الأصناف</span>
                    </button>
                    {req.status === 'pending' && (currentUser?.role === 'admin' || hasPermission('canManageTransfers')) && (
                      <button
                        onClick={() => handleExecuteItemTransfer(req)}
                        className="px-2.5 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold text-[11px] cursor-pointer"
                        title="موافقة وصرف البضاعة من المخزن الرئيسي"
                      >
                        اعتماد وصرف
                      </button>
                    )}
                    {req.status === 'executed' && (
                      <button
                        onClick={() => handleConfirmCustodyReceipt(req)}
                        className="px-2.5 py-1 bg-[#011E58] hover:bg-[#003589] text-white rounded-md font-bold text-[11px] cursor-pointer"
                        title="تأكيد استلام المندوب وإضافة البضاعة لعهدة السيارة"
                      >
                        تأكيد استلام المندوب
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* TAB 3: Representatives Directory & Custody Balances */}
      {activeTab === 'reps-list' && (
        <UnifiedDataTable<Representative>
          compact
          title="دليل المناديب ومتابعة العهد المالية"
          subtitle="قائمة مندوبي التوزيع الميدانيين وأرصدة العهد النقدية الحالية"
          data={representatives}
          rowKey={(rep) => rep.id}
          onRowClick={(rep) => {
            setCustodyRepId(rep.id);
            setActiveTab('rep-custody-statement');
          }}
          searchPlaceholder="بحث باسم المندوب أو الهاتف أو رقم السيارة..."
          searchFilter={(rep, q) =>
            rep.name.toLowerCase().includes(q) ||
            (rep.phone || '').includes(q) ||
            (rep.vehicleNumber || '').toLowerCase().includes(q)
          }
          exportFilename="دليل_المناديب"
          pdfTitle="دليل المناديب ومتابعة العهد المالية"
          emptyTitle="لا يوجد مناديب مسجلون حالياً"
          columns={[
            {
              key: 'name',
              header: 'اسم المندوب',
              sortable: true,
              sortValue: (rep) => rep.name,
              exportValue: (rep) => rep.name,
              render: (rep) => <span className="font-black text-slate-900">{rep.name}</span>,
            },
            {
              key: 'phone',
              header: 'رقم الهاتف',
              sortable: true,
              sortValue: (rep) => rep.phone || '',
              exportValue: (rep) => rep.phone || '-',
              render: (rep) => <span className="font-mono text-slate-600">{rep.phone || '-'}</span>,
            },
            {
              key: 'vehicleNumber',
              header: 'رقم السيارة / العهدة',
              sortable: true,
              sortValue: (rep) => rep.vehicleNumber || '',
              exportValue: (rep) => rep.vehicleNumber || 'سيارة التوزيع 1',
              render: (rep) => <span className="font-bold text-slate-800">{rep.vehicleNumber || 'سيارة التوزيع 1'}</span>,
            },
            {
              key: 'currentBalance',
              header: 'العهدة المالية الحالية',
              align: 'center',
              sortable: true,
              sortValue: (rep) => (rep.balanceHidden || rep.currentBalance === undefined ? 0 : rep.currentBalance),
              exportValue: (rep) =>
                rep.balanceHidden || rep.currentBalance === undefined ? 'محجوب' : rep.currentBalance,
              render: (rep) => (
                <span className="text-emerald-700 font-black font-mono tabular-nums">
                  {rep.balanceHidden || rep.currentBalance === undefined
                    ? 'محجوب'
                    : `${rep.currentBalance.toLocaleString()} ${settings.currency}`}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              sortable: true,
              sortValue: (rep) => rep.status,
              exportValue: (rep) => (rep.status === 'active' ? 'نشط ميدانياً' : 'موقف'),
              render: (rep) => (
                <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${
                  rep.status === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}>
                  {rep.status === 'active' ? 'نشط ميدانياً' : 'موقف'}
                </span>
              ),
            },
            {
              key: 'actions',
              header: 'الإجراءات',
              align: 'center',
              render: (rep) => (
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      setSelectedRepId(rep.id);
                      setDirection('rep_to_owner');
                      setIsNewCashModalOpen(true);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-900 hover:bg-blue-100 font-bold text-[11px] cursor-pointer"
                  >
                    توريد نقدية
                  </button>
                  <button
                    onClick={() => {
                      setCustodyRepId(rep.id);
                      setActiveTab('rep-custody-statement');
                    }}
                    className="px-2.5 py-1 rounded-md bg-[#EEF3FA] text-[#011E58] hover:bg-[#DCE6F5] font-bold text-[11px] cursor-pointer"
                  >
                    كشف العهدة
                  </button>
                  <button
                    onClick={() => {
                      setEditingRep(rep);
                      setRepName(rep.name);
                      setRepPhone(rep.phone);
                      setRepVehicle(rep.vehicleNumber || '');
                      setRepOpening(rep.openingBalance ?? 0);
                      setIsAddRepModalOpen(true);
                    }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                    title="تعديل بيانات المندوب"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* TAB 4: Rep Custody & Account Statement */}
      {activeTab === 'rep-custody-statement' && (
        <div className="space-y-3">
          {/* Controls Strip */}
          <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-xs flex flex-wrap items-end justify-between gap-2.5 text-xs">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">المندوب:</label>
                <select
                  value={custodyRepId}
                  disabled={isRepUser}
                  onChange={(e) => setCustodyRepId(e.target.value)}
                  className="h-8 px-2 py-1 rounded-lg border border-slate-300 bg-slate-50 font-bold text-xs min-w-[180px]"
                >
                  {representatives.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">من تاريخ:</label>
                <input
                  type="date"
                  value={custodyDateFrom}
                  onChange={(e) => setCustodyDateFrom(e.target.value)}
                  className="h-8 px-2 py-1 rounded-lg border border-slate-300 font-mono text-xs bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">إلى تاريخ:</label>
                <input
                  type="date"
                  value={custodyDateTo}
                  onChange={(e) => setCustodyDateTo(e.target.value)}
                  className="h-8 px-2 py-1 rounded-lg border border-slate-300 font-mono text-xs bg-slate-50"
                />
              </div>
              <button
                type="button"
                onClick={() => loadCustodyStatement(custodyRepId)}
                disabled={isCustodyLoading}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-bold cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCustodyLoading ? 'animate-spin' : ''}`} />
                <span>تحديث الكشف</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const defaultProd = custodyStatement?.itemsSummary?.[0]?.productId || products[0]?.id || '';
                  setCustodyOpProductId(defaultProd);
                  setCustodyOpQty(1);
                  setCustodyOpCustomerId('');
                  setCustodyOpCustomerName('');
                  setCustodyOpNotes('');
                  setCustodyActionModal('deliver');
                }}
                className="flex items-center gap-1 h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
              >
                <PackageCheck className="w-3.5 h-3.5" />
                <span>تسليم جزئي للعميل</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const defaultProd = custodyStatement?.itemsSummary?.[0]?.productId || products[0]?.id || '';
                  setCustodyOpProductId(defaultProd);
                  setCustodyOpQty(1);
                  setCustodyOpTargetWhId(warehouses.find((w) => !w.id.includes('van'))?.id || warehouses[0]?.id || 'wh-main');
                  setCustodyOpNotes('');
                  setCustodyActionModal('return');
                }}
                className="flex items-center gap-1 h-8 px-2.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#B8CAE8] font-bold cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>إرجاع للمخزن الرئيسي</span>
              </button>
              {(currentUser?.role === 'admin' || hasPermission('canApprove') || hasPermission('canManageReps')) && (
                <button
                  type="button"
                  onClick={() => {
                    const defaultProd = custodyStatement?.itemsSummary?.[0]?.productId || products[0]?.id || '';
                    setCustodyOpProductId(defaultProd);
                    setCustodyOpQty(1);
                    setCustodyOpType('custody_damaged');
                    setCustodyOpNotes('');
                    setCustodyActionModal('adjust');
                  }}
                  className="flex items-center gap-1 h-8 px-2.5 rounded-md bg-slate-800 hover:bg-slate-900 text-white font-bold cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>تسوية / تالف / عجز</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleExportCustodyExcel}
                disabled={!custodyStatement}
                className="flex items-center gap-1 h-8 px-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-[#003589]" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={handlePrintCustodyStatement}
                disabled={!custodyStatement}
                className="flex items-center gap-1 h-8 px-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700 cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5 text-[#011E58]" />
                <span>طباعة</span>
              </button>
            </div>
          </div>

          {custodyError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-800 rounded-lg text-xs font-bold">
              {custodyError}
            </div>
          )}

          {custodyStatement && (
            <>
              {/* Financial Summary Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden text-xs">
                <div className="bg-white px-3 py-2">
                  <span className="text-[11px] text-slate-500 font-bold flex items-center gap-1">
                    <Wallet className="w-3.5 h-3.5 text-[#003589]" /> رصيد العهدة النقدية الحالية
                  </span>
                  <p className="text-base font-black text-[#011E58] font-mono tabular-nums mt-0.5">
                    {custodyStatement.financialSummary.currentCashCustodyBalance.toLocaleString()} {settings.currency}
                  </p>
                </div>
                <div className="bg-white px-3 py-2">
                  <span className="text-[11px] text-slate-500 font-bold">إجمالي مبيعات المندوب</span>
                  <p className="text-base font-black text-slate-900 font-mono tabular-nums mt-0.5">
                    {custodyStatement.financialSummary.totalSalesAmount.toLocaleString()} {settings.currency}
                  </p>
                </div>
                <div className="bg-white px-3 py-2">
                  <span className="text-[11px] text-emerald-700 font-bold">المحصّل من الفواتير</span>
                  <p className="text-base font-black text-emerald-700 font-mono tabular-nums mt-0.5">
                    {custodyStatement.financialSummary.totalSalesPaidAmount.toLocaleString()} {settings.currency}
                  </p>
                </div>
                <div className="bg-white px-3 py-2">
                  <span className="text-[11px] text-amber-700 font-bold">المتبقي بالآجل عند العملاء</span>
                  <p className="text-base font-black text-amber-800 font-mono tabular-nums mt-0.5">
                    {custodyStatement.financialSummary.totalSalesRemainingAmount.toLocaleString()} {settings.currency}
                  </p>
                </div>
              </div>

              {/* Item Custody Totals Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 bg-[#011E58] text-white p-2.5 rounded-lg text-center text-[11px] tabular-nums">
                <div>
                  <span className="text-[#B8CAE8] block">المستلم فعلياً</span>
                  <strong className="text-xs font-mono">{custodyStatement.totals.totalReceivedQty}</strong>
                </div>
                <div>
                  <span className="text-amber-300 block">بانتظار الاستلام</span>
                  <strong className="text-xs font-mono">{custodyStatement.totals.totalPendingReceiveQty}</strong>
                </div>
                <div>
                  <span className="text-emerald-300 block">مسلم للعملاء</span>
                  <strong className="text-xs font-mono">{custodyStatement.totals.totalDeliveredQty}</strong>
                </div>
                <div>
                  <span className="text-[#DCE6F5] block">مرتجع للمخزن</span>
                  <strong className="text-xs font-mono">{custodyStatement.totals.totalReturnedQty}</strong>
                </div>
                <div>
                  <span className="text-rose-300 block">تسويات / تالف</span>
                  <strong className="text-xs font-mono">{custodyStatement.totals.totalReductionsQty}</strong>
                </div>
                <div>
                  <span className="text-[#B8CAE8] block">المتبقي بالعهدة</span>
                  <strong className="text-xs font-mono text-white">{custodyStatement.totals.totalRemainingCustodyQty}</strong>
                </div>
                <div>
                  <span className="text-[#DCE6F5] block">رصيد السيارة الفعلي</span>
                  <strong className="text-xs font-mono">{custodyStatement.totals.totalVanPhysicalQty}</strong>
                </div>
                <div>
                  <span className="text-emerald-200 block">قيمة العهدة بالتكلفة</span>
                  <strong className="text-xs font-mono">{custodyStatement.totals.totalCustodyCostValue.toLocaleString()}</strong>
                </div>
              </div>

              {/* Items Summary Table */}
              <UnifiedDataTable
                compact
                title="ملخص الأصناف في عهدة المندوب"
                subtitle="المتبقي = المستلم − المسلم للعملاء − المرتجع − التسويات"
                data={custodyStatement.itemsSummary}
                rowKey={(it) => it.productId}
                searchPlaceholder="بحث باسم الصنف أو الكود..."
                searchFilter={(it, q) =>
                  it.productName.toLowerCase().includes(q) || (it.productCode || '').toLowerCase().includes(q)
                }
                exportFilename="ملخص_أصناف_عهدة_المندوب"
                pdfTitle="ملخص الأصناف في عهدة المندوب"
                emptyTitle="لا توجد حركات أصناف مسجلة لهذا المندوب في الفترة المحددة"
                columns={[
                  {
                    key: 'productName',
                    header: 'الصنف',
                    sortable: true,
                    sortValue: (it) => it.productName,
                    exportValue: (it) => it.productName,
                    render: (it) => (
                      <div>
                        <div className="font-bold text-slate-900">{it.productName}</div>
                        <div className="text-[10px] font-mono text-slate-400">{it.productCode}</div>
                      </div>
                    ),
                  },
                  { key: 'baseUnit', header: 'الوحدة', align: 'center', exportValue: (it) => it.baseUnit, render: (it) => it.baseUnit },
                  {
                    key: 'receivedQty',
                    header: 'مستلم',
                    align: 'center',
                    sortable: true,
                    sortValue: (it) => it.receivedQty,
                    exportValue: (it) => it.receivedQty,
                    render: (it) => <span className="font-mono font-bold text-blue-900 tabular-nums">{it.receivedQty}</span>,
                  },
                  {
                    key: 'pendingReceiveQty',
                    header: 'معلّق (قيد الاستلام)',
                    align: 'center',
                    exportValue: (it) => it.pendingReceiveQty,
                    render: (it) => <span className="font-mono text-amber-700 tabular-nums">{it.pendingReceiveQty}</span>,
                  },
                  {
                    key: 'deliveredToCustomersQty',
                    header: 'مسلم للعملاء',
                    align: 'center',
                    exportValue: (it) => it.deliveredToCustomersQty,
                    render: (it) => <span className="font-mono font-bold text-emerald-700 tabular-nums">{it.deliveredToCustomersQty}</span>,
                  },
                  {
                    key: 'invoicedSoldQty',
                    header: 'مفوتر',
                    align: 'center',
                    exportValue: (it) => it.invoicedSoldQty,
                    render: (it) => <span className="font-mono text-slate-700 tabular-nums">{it.invoicedSoldQty}</span>,
                  },
                  {
                    key: 'returnedToWarehouseQty',
                    header: 'مرتجع للمخزن',
                    align: 'center',
                    exportValue: (it) => it.returnedToWarehouseQty,
                    render: (it) => <span className="font-mono text-[#003589] tabular-nums">{it.returnedToWarehouseQty}</span>,
                  },
                  {
                    key: 'approvedReductionsQty',
                    header: 'تالف/عجز/تسوية',
                    align: 'center',
                    exportValue: (it) => it.approvedReductionsQty,
                    render: (it) => <span className="font-mono text-rose-700 tabular-nums">{it.approvedReductionsQty}</span>,
                  },
                  {
                    key: 'remainingCustodyQty',
                    header: 'المتبقي بالعهدة',
                    align: 'center',
                    sortable: true,
                    sortValue: (it) => it.remainingCustodyQty,
                    exportValue: (it) => it.remainingCustodyQty,
                    cellClassName: 'bg-blue-50/60',
                    render: (it) => <span className="font-mono font-black text-blue-950 tabular-nums">{it.remainingCustodyQty}</span>,
                  },
                  {
                    key: 'vanPhysicalStockQty',
                    header: 'رصيد السيارة',
                    align: 'center',
                    exportValue: (it) => it.vanPhysicalStockQty,
                    render: (it) => <span className="font-mono font-bold text-slate-800 tabular-nums">{it.vanPhysicalStockQty}</span>,
                  },
                  {
                    key: 'custodyValueAtCost',
                    header: 'القيمة بالتكلفة',
                    align: 'center',
                    sortable: true,
                    sortValue: (it) => it.custodyValueAtCost,
                    exportValue: (it) => it.custodyValueAtCost,
                    render: (it) => (
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {it.custodyValueAtCost.toLocaleString()} {settings.currency}
                      </span>
                    ),
                  },
                ]}
              />

              {/* Chronological Custody Ledger Table */}
              <UnifiedDataTable
                compact
                title={`سجل حركات العهدة التفصيلي (${custodyStatement.ledger.length})`}
                data={custodyStatement.ledger}
                rowKey={(row) => row.id}
                searchPlaceholder="بحث برقم المستند أو الصنف أو العميل..."
                searchFilter={(row, q) =>
                  (row.docNumber || '').toLowerCase().includes(q) ||
                  (row.productName || '').toLowerCase().includes(q) ||
                  (row.customerName || '').toLowerCase().includes(q)
                }
                exportFilename="سجل_حركات_عهدة_المندوب"
                pdfTitle="سجل حركات عهدة المندوب التفصيلي"
                emptyTitle="لا توجد حركات مسجلة في دفتر العهدة"
                columns={[
                  { key: 'date', header: 'التاريخ', sortable: true, sortValue: (r) => r.date, exportValue: (r) => r.date, render: (r) => <span className="font-mono text-slate-600">{r.date}</span> },
                  { key: 'docType', header: 'نوع الحركة', exportValue: (r) => r.docType, render: (r) => <span className="font-bold text-slate-800">{r.docType}</span> },
                  { key: 'docNumber', header: 'رقم المستند', exportValue: (r) => r.docNumber, render: (r) => <span className="font-mono text-blue-900 font-bold">{r.docNumber}</span> },
                  { key: 'productName', header: 'الصنف', exportValue: (r) => r.productName, render: (r) => <span className="font-bold">{r.productName}</span> },
                  { key: 'customerName', header: 'العميل / الجهة', exportValue: (r) => r.customerName || '-', render: (r) => <span className="text-slate-600">{r.customerName || '-'}</span> },
                  {
                    key: 'quantityIn',
                    header: 'وارد للعهدة (+)',
                    align: 'center',
                    exportValue: (r) => r.quantityIn,
                    render: (r) => <span className="font-mono font-bold text-emerald-700 tabular-nums">{r.quantityIn > 0 ? `+${r.quantityIn}` : '-'}</span>,
                  },
                  {
                    key: 'quantityOut',
                    header: 'صادر من العهدة (-)',
                    align: 'center',
                    exportValue: (r) => r.quantityOut,
                    render: (r) => <span className="font-mono font-bold text-rose-700 tabular-nums">{r.quantityOut > 0 ? `-${r.quantityOut}` : '-'}</span>,
                  },
                  { key: 'notes', header: 'ملاحظات', exportValue: (r) => r.notes || '-', render: (r) => <span className="text-slate-500">{r.notes || '-'}</span> },
                ]}
              />
            </>
          )}
        </div>
      )}

      {/* New Cash Transfer Modal */}
      {isNewCashModalOpen && (
        <Modal
          isOpen={isNewCashModalOpen}
          onClose={() => setIsNewCashModalOpen(false)}
          title="طلب تحويل مالي بالنصف (توريد تحصيلات أو صرف عهدة)"
        >
          <form onSubmit={handleSubmitCashTransfer} className="space-y-3 text-xs">
            {error && (
              <div className="px-3 py-2 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 border border-red-200">
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
                  className={`h-8 px-2.5 rounded-md border text-center font-bold cursor-pointer transition-all ${
                    direction === 'rep_to_owner' ? 'bg-[#003589] text-white border-[#003589]' : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  توريد من مندوب إلى الفرع
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('owner_to_rep')}
                  className={`h-8 px-2.5 rounded-md border text-center font-bold cursor-pointer transition-all ${
                    direction === 'owner_to_rep' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-slate-50 text-slate-700 border-slate-300'
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
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              >
                {representatives.map(r => (
                  <option key={r.id} value={r.id}>{r.name} (رصيد عهدته: {r.currentBalance} {settings.currency})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">المبلغ المحول ({settings.currency}):</label>
                <input
                  type="number"
                  required
                  min={1}
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold text-sm"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">الخزينة المتأثرة للفرع:</label>
                <select
                  value={selectedCashboxId}
                  onChange={(e) => setSelectedCashboxId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                >
                  {cashboxes.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.balanceHidden ? `${c.name} (رصيد محجوب)` : `${c.name} (${(c.currentBalance ?? 0).toLocaleString()} ${settings.currency})`}
                    </option>
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
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2.5 border-t">
              <button
                type="button"
                onClick={() => setIsNewCashModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
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
          <form onSubmit={handleSubmitItemTransferRequest} className="space-y-3 text-xs">
            {itemReqError && (
              <div className="px-3 py-2 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 border border-red-200">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{itemReqError}</span>
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">نوع الإذن / المسار:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setItemReqTransferMode('transfer')}
                  className={`h-8 px-2.5 rounded-md border font-bold cursor-pointer ${
                    itemReqTransferMode === 'transfer' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  تحويل عادي / طلب سحب
                </button>
                <button
                  type="button"
                  onClick={() => setItemReqTransferMode('custody_dispatch')}
                  className={`h-8 px-2.5 rounded-md border font-bold cursor-pointer ${
                    itemReqTransferMode === 'custody_dispatch' ? 'bg-[#003589] text-white border-[#003589]' : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  صرف عهدة مباشرة من المخزن للمندوب
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                في وضع صرف العهدة المباشر يُخصم المخزن الرئيسي فوراً ولا تُضاف البضاعة لرصيد سيارة المندوب إلا بعد تأكيد الاستلام.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">المندوب:</label>
                <select
                  value={itemReqRepId}
                  onChange={(e) => setItemReqRepId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
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
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
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

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">المستودع المصدر (المقر الرئيسي):</label>
                <select
                  value={itemReqSourceWhId}
                  onChange={(e) => setItemReqSourceWhId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
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
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                >
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Item Selector Box */}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <span className="font-bold text-slate-800 block">إضافة أصناف للطلب (بحث فوري):</span>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1">
                  <ProductSearchSelect
                    products={products}
                    selectedProductId={tempProdId}
                    onSelect={(prod) => setTempProdId(prod.id)}
                    onAfterSelect={() => repProdQtyRef.current?.focus()}
                    warehouseId={itemReqSourceWhId}
                    warehouses={warehouses}
                    currency={settings.currency}
                    inputRef={repProdSearchRef}
                    placeholder="ابحث باسم الصنف أو الكود أو الباركود..."
                  />
                </div>
                <input
                  ref={repProdQtyRef}
                  type="number"
                  min={1}
                  value={tempQty}
                  onChange={(e) => setTempQty(e.target.value === '' ? '' : parseFloat(e.target.value) || '')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddItemToReq();
                    }
                  }}
                  className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-300 text-center font-bold bg-white"
                  placeholder="الكمية"
                />
                <button
                  type="button"
                  onClick={handleAddItemToReq}
                  className="h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer"
                >
                  إضافة +
                </button>
              </div>

              {selectedItemsForReq.length > 0 && (
                <div className="mt-2">
                  <UnifiedDataTable
                    compact
                    searchable={false}
                    paginated={false}
                    data={selectedItemsForReq.map((it, idx) => ({ ...it, _idx: idx }))}
                    rowKey={(it) => `${it.productId}-${it._idx}`}
                    columns={[
                      { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold">{it.productName}</span> },
                      { key: 'requestedQty', header: 'الكمية المطلوبة', align: 'center', render: (it) => <span className="font-bold text-[#011E58] tabular-nums">{it.requestedQty} {it.unit}</span> },
                      { key: 'availableInVanQty', header: 'المتاح بالسيارة', align: 'center', render: (it) => <span className="text-slate-600 tabular-nums">{it.availableInVanQty}</span> },
                      { key: 'shortageQty', header: 'العجز', align: 'center', render: (it) => <span className="font-bold text-red-600 tabular-nums">{it.shortageQty}</span> },
                      {
                        key: 'remove',
                        header: 'حذف',
                        align: 'center',
                        render: (it) => (
                          <button
                            type="button"
                            onClick={() => handleRemoveItemFromReq(it._idx)}
                            className="text-red-500 hover:text-red-700 font-bold cursor-pointer"
                          >
                            ✕
                          </button>
                        ),
                      },
                    ]}
                  />
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
                className="w-full px-2.5 py-1.5 rounded-md border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2.5 border-t">
              <button
                type="button"
                onClick={() => setIsNewItemReqModalOpen(false)}
                className="h-8 px-3 rounded-md border border-slate-300 text-slate-600 font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmittingItemReq || selectedItemsForReq.length === 0}
                className="h-8 px-3.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
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
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2.5 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
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
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                data={activeItemReqDetail.items.map((item, idx) => ({ ...item, _idx: idx }))}
                rowKey={(item) => `${item.productId}-${item._idx}`}
                columns={[
                  { key: 'productName', header: 'الصنف', render: (item) => <span className="font-bold text-slate-800">{item.productName}</span> },
                  { key: 'unit', header: 'الوحدة', align: 'center', render: (item) => <span className="text-slate-600">{item.unit}</span> },
                  { key: 'requestedQty', header: 'الكمية المطلوبة', align: 'center', render: (item) => <span className="font-bold text-blue-900 tabular-nums">{item.requestedQty}</span> },
                  { key: 'availableInVanQty', header: 'المتاح بالسيارة', align: 'center', render: (item) => <span className="text-slate-600 tabular-nums">{item.availableInVanQty}</span> },
                  { key: 'shortageQty', header: 'العجز', align: 'center', render: (item) => <span className="font-black text-red-600 tabular-nums">{item.shortageQty}</span> },
                ]}
              />
            </div>

            {activeItemReqDetail.notes && (
              <p className="text-slate-600 italic">ملاحظات: {activeItemReqDetail.notes}</p>
            )}

            <div className="flex justify-between items-center pt-2.5 border-t">
              <div>{getItemReqStatusBadge(activeItemReqDetail.status)}</div>

              <div className="flex items-center gap-2">
                {activeItemReqDetail.status === 'pending' && (currentUser?.role === 'admin' || hasPermission('canManageTransfers')) && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleRejectItemTransfer(activeItemReqDetail)}
                      className="px-3.5 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 font-bold rounded-lg cursor-pointer"
                    >
                      رفض الطلب
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExecuteItemTransfer(activeItemReqDetail)}
                      className="h-8 px-3.5 bg-[#003589] hover:bg-[#0049B0] text-white font-black rounded-md cursor-pointer"
                    >
                      اعتماد وصرف من المخزن الرئيسي
                    </button>
                  </>
                )}
                {activeItemReqDetail.status === 'executed' && (
                  <button
                    type="button"
                    onClick={() => handleConfirmCustodyReceipt(activeItemReqDetail)}
                    className="h-8 px-3.5 bg-[#011E58] hover:bg-[#003589] text-white font-black rounded-md cursor-pointer"
                  >
                    تأكيد استلام المندوب
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveItemReqDetail(null)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Custody Operation Modal (Deliver / Return / Adjust) */}
      {custodyActionModal && (
        <Modal
          isOpen={Boolean(custodyActionModal)}
          onClose={() => !isSubmittingCustodyOp && setCustodyActionModal(null)}
          title={
            custodyActionModal === 'deliver'
              ? 'تسجيل تسليم جزئي من العهدة للعميل'
              : custodyActionModal === 'return'
              ? 'تسجيل إرجاع أصناف من العهدة للمخزن الرئيسي'
              : 'تسوية عهدة المندوب (تالف / عجز / تسوية)'
          }
          maxWidth="md"
        >
          <form onSubmit={handleSubmitCustodyOp} className="space-y-3 text-xs">
            <div>
              <label className="block font-bold mb-1">الصنف:</label>
              <select
                required
                value={custodyOpProductId}
                onChange={(e) => setCustodyOpProductId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
              >
                <option value="">-- اختر الصنف --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            {custodyActionModal === 'deliver' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold mb-1">العميل (من الدليل):</label>
                  <select
                    value={custodyOpCustomerId}
                    onChange={(e) => setCustodyOpCustomerId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                  >
                    <option value="">-- عميل نقدي / إدخال يدوي --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">أو اسم العميل:</label>
                  <input
                    type="text"
                    value={custodyOpCustomerName}
                    onChange={(e) => setCustodyOpCustomerName(e.target.value)}
                    placeholder="اسم العميل المستلم..."
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
              </div>
            )}

            {custodyActionModal === 'return' && (
              <div>
                <label className="block font-bold mb-1">المستودع المستلم للمرتجع:</label>
                <select
                  value={custodyOpTargetWhId}
                  onChange={(e) => setCustodyOpTargetWhId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            )}

            {custodyActionModal === 'adjust' && (
              <div>
                <label className="block font-bold mb-1">نوع التسوية:</label>
                <select
                  value={custodyOpType}
                  onChange={(e) => setCustodyOpType(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                >
                  <option value="custody_damaged">تالف عهدة</option>
                  <option value="custody_shortage">عجز عهدة</option>
                  <option value="custody_adjustment">تسوية إدارية للعهدة</option>
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold mb-1">الكمية:</label>
                <input
                  type="number"
                  required
                  min={0.001}
                  step="0.001"
                  placeholder="أدخل الكمية"
                  value={custodyOpQty}
                  onChange={(e) => setCustodyOpQty(e.target.value === '' ? '' : parseFloat(e.target.value) || '')}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">التاريخ:</label>
                <input
                  type="date"
                  required
                  value={custodyOpDate}
                  onChange={(e) => setCustodyOpDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">ملاحظات / سبب:</label>
              <input
                type="text"
                value={custodyOpNotes}
                onChange={(e) => setCustodyOpNotes(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setCustodyActionModal(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmittingCustodyOp || !custodyOpProductId || Number(custodyOpQty || 0) <= 0}
                className="px-4 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmittingCustodyOp ? 'جاري التنفيذ...' : 'حفظ وتنفيذ'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add / Edit Representative Modal */}
      {isAddRepModalOpen && (
        <Modal
          isOpen={isAddRepModalOpen}
          onClose={() => !isSavingRep && setIsAddRepModalOpen(false)}
          title={editingRep ? 'تعديل بيانات المندوب' : 'إضافة مندوب مبيعات جديد'}
        >
          <form onSubmit={handleSaveRep} className="space-y-3 text-xs">
            {repFormError && (
              <div className="px-3 py-2 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 border border-red-200 font-bold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{repFormError}</span>
              </div>
            )}
            <div>
              <label className="block font-bold mb-1">اسم المندوب:</label>
              <input
                type="text"
                required
                value={repName}
                onChange={(e) => setRepName(e.target.value)}
                placeholder="اسم المندوب ثلاثي..."
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">رقم الهاتف:</label>
                <input
                  type="text"
                  required
                  value={repPhone}
                  onChange={(e) => setRepPhone(e.target.value)}
                  placeholder="010XXXXXXXX"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">رقم السيارة / رمز العهدة:</label>
                <input
                  type="text"
                  value={repVehicle}
                  onChange={(e) => setRepVehicle(e.target.value)}
                  placeholder="مثال: سيارة توزيع 4 (أ ب ج 123)"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            {!editingRep && (
              <>
                <div>
                  <label className="block font-bold mb-1">رصيد العهدة الافتتاحي ({settings.currency}):</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={repOpening}
                    onChange={(e) => setRepOpening(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                  />
                </div>

                {(currentUser?.role === 'admin' || hasPermission('canManageUsers')) && (
                  <div className="p-2.5 rounded-lg bg-[#EEF3FA] border border-[#DCE6F5] space-y-2.5">
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={createRepAccount}
                        onChange={(e) => setCreateRepAccount(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded accent-[#003589]"
                      />
                      <div>
                        <span className="font-black text-[#011E58] block">
                          إنشاء حساب دخول تلقائي بصلاحيات المندوب الافتراضية
                        </span>
                        <span className="text-[11px] text-[#003589] block mt-0.5">
                          يفعّل المبيعات والعملاء والتحويلات وإنشاء مسودات الشراء وإرسالها، مع إنشاء مستودع سيارة مربوط 1:1 (يمكن تعديل الصلاحيات لاحقاً من إدارة المستخدمين).
                        </span>
                      </div>
                    </label>

                    {createRepAccount && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">اسم المستخدم للدخول: *</label>
                          <input
                            type="text"
                            required={createRepAccount}
                            value={repUsername}
                            onChange={(e) => setRepUsername(e.target.value)}
                            placeholder="مثال: rep_ahmed"
                            dir="ltr"
                            className="w-full h-8 px-2 rounded-md border border-[#B8CAE8] bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">كلمة المرور: *</label>
                          <input
                            type="password"
                            required={createRepAccount}
                            value={repPassword}
                            onChange={(e) => setRepPassword(e.target.value)}
                            placeholder="4 أحرف على الأقل..."
                            dir="ltr"
                            className="w-full h-8 px-2 rounded-md border border-[#B8CAE8] bg-white font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2.5 border-t">
              <button
                type="button"
                disabled={isSavingRep}
                onClick={() => setIsAddRepModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSavingRep}
                className="px-4 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSavingRep ? 'جاري الحفظ...' : editingRep ? 'تحديث المندوب' : 'حفظ المندوب الجديد'}
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
          <div className="space-y-3 text-xs">
            <div className="p-2.5 bg-slate-50 rounded-lg border flex items-center justify-between">
              <div>
                <span className="block text-slate-500">المبلغ المحول:</span>
                <span className="text-sm font-black text-blue-950 font-mono">
                  {activeTransferForAudit.amount.toLocaleString()} {settings.currency}
                </span>
              </div>
              <div>{getStatusBadge(activeTransferForAudit.status)}</div>
            </div>

            <div className="space-y-2.5 relative before:absolute before:top-2 before:bottom-2 before:right-3.5 before:w-0.5 before:bg-slate-200">
              {activeTransferForAudit.auditTrail.map((log, idx) => (
                <div key={idx} className="relative flex items-start gap-2.5 mr-1">
                  <div className="w-6 h-6 rounded-full bg-blue-900 text-white flex items-center justify-center font-bold text-[10px] shrink-0 z-10">
                    {idx + 1}
                  </div>
                  <div className="flex-1 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs">
                    <div className="flex justify-between items-center mb-0.5">
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

            <div className="flex justify-end pt-2.5 border-t">
              <button
                onClick={() => setActiveTransferForAudit(null)}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer"
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

      {confirmState && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          onClose={() => !isConfirmBusy && setConfirmState(null)}
          onConfirm={async (val) => {
            if (isConfirmBusy) return;
            setIsConfirmBusy(true);
            try {
              await confirmState.onConfirm(val);
            } finally {
              setIsConfirmBusy(false);
            }
          }}
          isLoading={isConfirmBusy}
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          variant={confirmState.variant}
          requireInput={confirmState.requireInput}
          inputLabel={confirmState.inputLabel}
          inputPlaceholder={confirmState.inputPlaceholder}
        />
      )}
    </div>
  );
};

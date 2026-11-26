import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  ArrowLeftRight, CheckCircle2, XCircle, Clock, AlertCircle, Plus, 
  Printer, History, User, Boxes, Truck, Edit, Eye, Check,
  Download, PackageCheck, RotateCcw, AlertTriangle, Wallet, RefreshCw
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime, formatLocaleNumber } from '../../../i18n/translator';
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
  const { t, isRtl } = usePreferences();

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
      setCustodyError(t(res.error || 'تعذر تحميل كشف حساب وعهدة المندوب', res.error || 'Could not load representative custody statement'));
    } else {
      setCustodyStatement(res.statement);
    }
  }, [custodyRepId, custodyDateFrom, custodyDateTo, getRepCustodyStatement, t]);

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
      setError(t('يرجى تحديد مبلغ صالح أكبر من الصفر', 'Please enter a valid amount greater than zero'));
      return;
    }

    const rep = representatives.find(r => r.id === selectedRepId);
    if (!rep) {
      setError(t('يرجى اختيار المندوب المعني', 'Please select the representative'));
      return;
    }

    const cb = cashboxes.find(c => c.id === selectedCashboxId);
    if (!cb) {
      setError(t('يرجى تحديد الخزينة', 'Please select the cashbox'));
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
      setError(t(res.error || 'تعذر إرسال طلب التحويل', res.error || 'Could not submit transfer request'));
    }
  };

  const handleConfirmReceipt = (tr: RepTransfer) => {
    setConfirmState({
      isOpen: true,
      title: t('تأكيد استلام التحويل النقدي', 'Confirm Cash Transfer Receipt'),
      message: t(
        `هل أنت متأكد من تأكيد استلام مبلغ (${formatLocaleNumber(tr.amount)} ${t(settings.currency)}) الخاص بالتحويل ${tr.transferNumber}؟ سيتم تحديث أرصدة الخزينة وحساب المندوب فوراً.`,
        `Confirm receipt of (${formatLocaleNumber(tr.amount)} ${t(settings.currency)}) for transfer ${tr.transferNumber}? Cashbox and representative balances will be updated immediately.`
      ),
      confirmLabel: t('تأكيد الاستلام', 'Confirm Receipt'),
      variant: 'success',
      onConfirm: async () => {
        setConfirmState(null);
        const res = await confirmRepTransferReceipt(tr.id, 'تم التأكيد والاستلام الفعلي');
        if (!res.success) {
          setStatusBanner({ type: 'error', text: t(res.error || 'فشل تأكيد الاستلام', res.error || 'Failed to confirm receipt') });
        } else {
          setStatusBanner({
            type: 'success',
            text: t(`تم تأكيد استلام التحويل (${tr.transferNumber}) وتحديث الأرصدة.`, `Transfer (${tr.transferNumber}) receipt confirmed and balances updated.`),
          });
        }
      },
    });
  };

  const handleRejectTransfer = (tr: RepTransfer) => {
    setConfirmState({
      isOpen: true,
      title: t('رفض التحويل النقدي', 'Reject Cash Transfer'),
      message: t(
        `رفض التحويل رقم (${tr.transferNumber}) بمبلغ (${formatLocaleNumber(tr.amount)} ${t(settings.currency)}).`,
        `Reject transfer #(${tr.transferNumber}) for (${formatLocaleNumber(tr.amount)} ${t(settings.currency)}).`
      ),
      confirmLabel: t('تأكيد الرفض', 'Confirm Rejection'),
      variant: 'danger',
      requireInput: true,
      inputLabel: t('سبب رفض التحويل:', 'Rejection Reason:'),
      inputPlaceholder: t('اكتب سبب رفض التحويل...', 'Enter transfer rejection reason...'),
      onConfirm: async (reason) => {
        setConfirmState(null);
        if (!reason) return;
        const res = await rejectRepTransfer(tr.id, reason);
        if (!res.success) {
          setStatusBanner({ type: 'error', text: t(res.error || 'فشل رفض التحويل', res.error || 'Failed to reject transfer') });
        } else {
          setStatusBanner({ type: 'success', text: t(`تم رفض التحويل (${tr.transferNumber}).`, `Transfer (${tr.transferNumber}) rejected.`) });
        }
      },
    });
  };

  const handlePrintTransfer = (tr: RepTransfer) => {
    setPrintData({
      title: t('إيصال طلب تحويل بالنصف (إشعار تحويل مالي بين المندوب والفرع)', 'Two-Way Cash Transfer Receipt (Representative / Branch Notice)'),
      docNumber: tr.transferNumber,
      docType: t('إيصال استلام', 'Receipt Voucher'),
      date: tr.date,
      partyName: tr.direction === 'rep_to_owner' ? tr.senderName : tr.receiverName,
      representativeName: tr.direction === 'rep_to_owner' ? tr.senderName : tr.receiverName,
      grandTotal: tr.amount,
      paidAmount: tr.amount,
      paymentType: t('تحويل نقدي بالنصف', 'Two-Way Cash Transfer'),
      notes: t(
        `حالة التحويل: ${tr.status === 'received' ? 'تم الاستلام والتأكيد' : 'قيد الاستلام'} | الخزينة: ${t(tr.cashboxName)} | ملاحظات: ${tr.notes || 'لا يوجد'}`,
        `Transfer Status: ${tr.status === 'received' ? 'Received & Confirmed' : 'Awaiting Receipt'} | Cashbox: ${t(tr.cashboxName)} | Notes: ${tr.notes || 'None'}`
      ),
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
      setItemReqError(t('يرجى إضافة صنف واحد على الأقل للتحويل', 'Please add at least one item to transfer'));
      return;
    }

    const rep = representatives.find(r => r.id === itemReqRepId);
    if (!rep) {
      setItemReqError(t('يرجى اختيار المندوب', 'Please select a representative'));
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
            ? t('تم صرف العهدة من المخزن الرئيسي — بانتظار تأكيد استلام المندوب.', 'Custody dispatched from main warehouse — awaiting representative confirmation.')
            : t('تم إرسال طلب تحويل الأصناف للمراجعة بنجاح.', 'Item transfer request submitted for review.'),
      });
    } else {
      setItemReqError(t(res.error || 'فشل إرسال طلب التحويل', res.error || 'Failed to submit transfer request'));
    }
  };

  const handleConfirmCustodyReceipt = (req: RepItemTransferRequest) => {
    setConfirmState({
      isOpen: true,
      title: t('تأكيد استلام العهدة في سيارة المندوب', 'Confirm Custody Receipt in Representative Van'),
      message: t(
        `هل تؤكد استلام الأصناف الفعلية الخاصة بالإذن (${req.requestNumber})؟ لن تُضاف الأصناف لعهدة السيارة إلا بعد تأكيد الاستلام.`,
        `Confirm physical receipt of items for permit (${req.requestNumber})? Items are only added to van custody after confirmation.`
      ),
      confirmLabel: t('تأكيد الاستلام الفعلي', 'Confirm Physical Receipt'),
      variant: 'success',
      onConfirm: async () => {
        setConfirmState(null);
        const res = await updateRepItemTransferStatus(req.id, 'received');
        if (!res.success) {
          setStatusBanner({ type: 'error', text: t(res.error || 'فشل تأكيد استلام العهدة', res.error || 'Failed to confirm custody receipt') });
        } else {
          setStatusBanner({
            type: 'success',
            text: t(`تم تأكيد استلام العهدة (${req.requestNumber}) وإضافتها لسيارة المندوب.`, `Custody (${req.requestNumber}) received and added to representative van.`),
          });
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
      setStatusBanner({ type: 'error', text: t(res.error || 'تعذر تنفيذ عملية العهدة', res.error || 'Could not execute custody operation') });
    } else {
      setCustodyActionModal(null);
      setCustodyOpQty('');
      setCustodyOpNotes('');
      setCustodyOpCustomerName('');
      setStatusBanner({
        type: 'success',
        text: t('تم تسجيل حركة العهدة وتحديث رصيد المندوب بنجاح.', 'Custody movement recorded and representative balance updated.'),
      });
      await loadCustodyStatement(custodyRepId);
    }
  };

  const handleExportCustodyExcel = () => {
    if (!custodyStatement) return;
    const headers = [
      t('كود الصنف', 'Item Code'),
      t('اسم الصنف', 'Item Name'),
      t('الوحدة', 'Unit'),
      t('المستلم فعلياً', 'Received'),
      t('قيد الاستلام', 'Pending Receipt'),
      t('مسلم للعملاء', 'Delivered to Customers'),
      t('مرتجع للمخزن', 'Returned to Warehouse'),
      t('تسويات/تالف', 'Adjustments/Damaged'),
      t('المتبقي بالعهدة', 'Remaining Custody'),
      t('رصيد السيارة الفعلي', 'Van Physical Stock'),
      t('القيمة بالتكلفة', 'Value at Cost'),
    ];
    const rows = custodyStatement.itemsSummary.map((it) => [
      it.productCode,
      it.productName,
      t(it.baseUnit),
      it.receivedQty,
      it.pendingReceiveQty,
      it.deliveredToCustomersQty,
      it.returnedToWarehouseQty,
      it.approvedReductionsQty,
      it.remainingCustodyQty,
      it.vanPhysicalStockQty,
      it.custodyValueAtCost,
    ]);
    exportToExcel(`Custody_${custodyStatement.representative.name}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handlePrintCustodyStatement = () => {
    if (!custodyStatement) return;
    setPrintData({
      title: t(`كشف حساب وعهدة المندوب — ${custodyStatement.representative.name}`, `Representative Account & Custody Statement — ${custodyStatement.representative.name}`),
      docNumber: custodyStatement.representative.id,
      docType: t('كشف حساب', 'Account Statement'),
      date: new Date().toISOString().split('T')[0],
      partyName: custodyStatement.representative.name,
      partyPhone: custodyStatement.representative.phone,
      representativeName: custodyStatement.representative.name,
      tableHeaders: [
        t('م', '#'),
        t('الصنف', 'Item'),
        t('الوحدة', 'Unit'),
        t('مستلم', 'Received'),
        t('مسلم للعملاء', 'Delivered'),
        t('مرتجع', 'Returned'),
        t('المتبقي بالعهدة', 'Remaining'),
      ],
      items: custodyStatement.itemsSummary.map((it) => ({
        name: it.productName,
        unit: t(it.baseUnit),
        quantity: it.receivedQty,
        price: it.deliveredToCustomersQty,
        discount: it.returnedToWarehouseQty,
        total: it.remainingCustodyQty,
      })),
      grandTotal: custodyStatement.totals.totalCustodyCostValue,
      paidAmount: custodyStatement.financialSummary.totalSalesPaidAmount,
      remainingAmount: custodyStatement.financialSummary.currentCashCustodyBalance,
      notes: t(
        `إجمالي المبيعات: ${formatLocaleNumber(custodyStatement.financialSummary.totalSalesAmount)} ${t(settings.currency)} | إجمالي المسلم للعملاء: ${formatLocaleNumber(custodyStatement.totals.totalDeliveredQty)} | المتبقي بالعهدة: ${formatLocaleNumber(custodyStatement.totals.totalRemainingCustodyQty)}`,
        `Total Sales: ${formatLocaleNumber(custodyStatement.financialSummary.totalSalesAmount)} ${t(settings.currency)} | Delivered: ${formatLocaleNumber(custodyStatement.totals.totalDeliveredQty)} | Remaining Custody: ${formatLocaleNumber(custodyStatement.totals.totalRemainingCustodyQty)}`
      ),
    });
    setIsPrintModalOpen(true);
  };

  const handleExecuteItemTransfer = (req: RepItemTransferRequest) => {
    setConfirmState({
      isOpen: true,
      title: t('اعتماد وتنفيذ صرف العهدة من المخزن الرئيسي', 'Approve & Dispatch Custody from Main Warehouse'),
      message: t(
        `سيتم خصم البضاعة من (${t(req.sourceWarehouseName)}) للطلب (${req.requestNumber}). لن تُضاف الكمية إلى سيارة المندوب إلا بعد تأكيد استلام المندوب لها.`,
        `Stock will be deducted from (${t(req.sourceWarehouseName)}) for request (${req.requestNumber}). Quantities will only be added to the van after the representative confirms receipt.`
      ),
      confirmLabel: t('اعتماد وصرف من المخزن', 'Approve & Dispatch'),
      variant: 'success',
      onConfirm: async () => {
        setConfirmState(null);
        const res = await updateRepItemTransferStatus(req.id, 'executed');
        if (!res.success) {
          setStatusBanner({ type: 'error', text: t(res.error || 'فشل تنفيذ تحويل الأصناف', res.error || 'Failed to execute item transfer') });
        } else {
          setStatusBanner({
            type: 'success',
            text: t(
              'تم الصرف من المخزن الرئيسي — بانتظار تأكيد استلام المندوب لإضافتها لعهدة السيارة.',
              'Dispatched from main warehouse — awaiting representative receipt confirmation.'
            ),
          });
          setActiveItemReqDetail(null);
        }
      },
    });
  };

  const handleRejectItemTransfer = (req: RepItemTransferRequest) => {
    setConfirmState({
      isOpen: true,
      title: t('رفض طلب تحويل الأصناف', 'Reject Item Transfer Request'),
      message: t(
        `رفض طلب تحويل العهدة رقم (${req.requestNumber}) للمندوب ${req.representativeName}.`,
        `Reject custody transfer request #(${req.requestNumber}) for representative ${req.representativeName}.`
      ),
      confirmLabel: t('تأكيد الرفض', 'Confirm Rejection'),
      variant: 'danger',
      requireInput: true,
      inputLabel: t('سبب رفض طلب تحويل الأصناف:', 'Rejection Reason:'),
      inputPlaceholder: t('اكتب سبب الرفض...', 'Enter rejection reason...'),
      onConfirm: async (reason) => {
        setConfirmState(null);
        if (!reason) return;
        const res = await updateRepItemTransferStatus(req.id, 'rejected', undefined, reason);
        if (!res.success) {
          setStatusBanner({ type: 'error', text: t(res.error || 'فشل رفض الطلب', res.error || 'Failed to reject request') });
        } else {
          setStatusBanner({ type: 'success', text: t(`تم رفض الطلب (${req.requestNumber}).`, `Request (${req.requestNumber}) rejected.`) });
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
      setRepFormError(t('يرجى إدخال اسم المندوب.', 'Please enter the representative name.'));
      return;
    }
    if (!editingRep && createRepAccount) {
      if (repUsername.trim().length < 3) {
        setRepFormError(t('يرجى إدخال اسم مستخدم للمندوب (3 أحرف على الأقل).', 'Please enter a username (at least 3 characters).'));
        return;
      }
      if (repPassword.length < 4) {
        setRepFormError(t('كلمة مرور حساب المندوب يجب أن لا تقل عن 4 أحرف.', 'Password must be at least 4 characters.'));
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
        setStatusBanner({
          type: 'success',
          text: t(`تم تحديث بيانات المندوب (${repName.trim()}) بنجاح.`, `Representative (${repName.trim()}) updated successfully.`),
        });
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
          setRepFormError(t(userRes.error || 'تعذر إنشاء حساب الدخول التلقائي للمندوب', userRes.error || 'Could not create automatic login account'));
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
          text: t(
            `تم إنشاء ملف المندوب (${repName.trim()}) وحساب الدخول (${repUsername.trim()}) بصلاحيات المندوب الافتراضية تلقائياً.`,
            `Representative (${repName.trim()}) and login account (${repUsername.trim()}) created automatically with default permissions.`
          ),
        });
      } else {
        await addRepresentative({
          name: repName.trim(),
          phone: repPhone.trim(),
          vehicleNumber: repVehicle.trim(),
          openingBalance: Number(repOpening) || 0,
          status: 'active',
        });
        setStatusBanner({
          type: 'success',
          text: t(`تمت إضافة المندوب (${repName.trim()}) بنجاح.`, `Representative (${repName.trim()}) added successfully.`),
        });
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
      setRepFormError(t(err?.message || 'تعذر حفظ بيانات المندوب', err?.message || 'Could not save representative details'));
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
            <span>{t('تم الاستلام وتعديل الأرصدة', 'Received & Balances Updated')}</span>
          </span>
        );
      case 'awaiting_receipt':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 text-xs font-bold">
            <Clock className="w-3.5 h-3.5" />
            <span>{t('في انتظار تأكيد الاستلام', 'Awaiting Receipt')}</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-xs font-bold">
            <XCircle className="w-3.5 h-3.5" />
            <span>{t('مرفوض', 'Rejected')}</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-slate-100 text-slate-700 text-xs font-bold">
            {t('ملغى', 'Cancelled')}
          </span>
        );
      default:
        return <span className="text-xs font-bold text-slate-500">{t('جديد', 'New')}</span>;
    }
  };

  const getItemReqStatusBadge = (status: RepItemTransferRequest['status']) => {
    switch (status) {
      case 'received':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 text-[10px] font-bold">
            <CheckCircle2 className="w-3 h-3" />
            <span>{t('تم الاستلام الفعلي في سيارة المندوب', 'Received in Representative Van')}</span>
          </span>
        );
      case 'executed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5] text-[10px] font-bold">
            <Check className="w-3 h-3" />
            <span>{t('تم الصرف من المخزن — بانتظار تأكيد استلام المندوب', 'Dispatched — Awaiting Rep Receipt')}</span>
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
            <CheckCircle2 className="w-3 h-3" />
            <span>{t('معتمد (بانتظار الصرف)', 'Approved (Awaiting Dispatch)')}</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
            <XCircle className="w-3 h-3" />
            <span>{t('مرفوض من الإدارة', 'Rejected by Management')}</span>
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 text-[10px] font-bold">
            <Clock className="w-3 h-3" />
            <span>{t('قيد المراجعة الإدارية', 'Pending Review')}</span>
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
            <h2 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC] tracking-tight">
              {t('إدارة المندوبين والتحويلات والعهد', 'Representatives, Transfers & Custody Management')}
            </h2>
            <span className="bg-blue-50 dark:bg-[#16366B] text-blue-800 dark:text-[#85B8FF] text-[10px] font-bold px-2 py-0.5 rounded border border-blue-200 dark:border-[#2A436E]">
              {t('ربط الفواتير والتحصيل', 'Invoice & Collection Link')}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-[#97AECE] mt-0.5">
            {t(
              'متابعة عهدة البضاعة في سيارات المناديب، التحويلات النقدية بالنصف، وطلبات تحويل الأصناف المرتبطة بالفواتير',
              'Track van inventory custody, two-way cash transfers, and invoice-linked stock transfer requests'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'cash-transfers' && (
            <button
              onClick={() => setIsNewCashModalOpen(true)}
              className="h-8 flex items-center gap-1.5 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('طلب تحويل مالي جديد (نصف)', 'New Two-Way Cash Transfer')}</span>
            </button>
          )}

          {activeTab === 'item-transfers' && (
            <button
              onClick={() => setIsNewItemReqModalOpen(true)}
              className="h-8 flex items-center gap-1.5 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('طلب تحويل أصناف وعهدة (+)', 'New Item & Custody Transfer (+)')}</span>
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
              <span>{t('إضافة مندوب جديد', 'Add New Representative')}</span>
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
            {t('إغلاق', 'Close')}
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
          <span>{t('التحويل المالي والنقدي (طلب تحويل بالنصف)', 'Cash Transfers (Two-Way)')}</span>
        </button>

        <button
          onClick={() => setActiveTab('item-transfers')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'item-transfers' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <StockTransfersIcon className="w-4 h-4 shrink-0" />
          <span>{t('طلبات تحويل الأصناف والعهد (مرتبطة بالفاتورة)', 'Item & Custody Transfers (Invoice-Linked)')}</span>
          {repItemTransfers.filter(r => r.status === 'pending').length > 0 && (
            <span className="bg-amber-600 text-white px-1.5 py-0.5 rounded text-[10px] tabular-nums">
              {formatLocaleNumber(repItemTransfers.filter(r => r.status === 'pending').length)}
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
          <span>{t(`دليل المناديب ومتابعة العهد (${formatLocaleNumber(representatives.length)})`, `Representatives & Custody (${formatLocaleNumber(representatives.length)})`)}</span>
        </button>

        <button
          onClick={() => setActiveTab('rep-custody-statement')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'rep-custody-statement' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <AccountsLedgerIcon className="w-4 h-4 shrink-0" />
          <span>{t('كشف حساب وعهدة المندوب', 'Rep Account & Custody Statement')}</span>
        </button>
      </div>

      {/* TAB 1: Cash Transfers (Two-way) */}
      {activeTab === 'cash-transfers' && (
        <UnifiedDataTable<RepTransfer>
          compact
          title={t('طلبات التحويل النقدية والعهد المالية', 'Cash Transfers & Rep Custody Requests')}
          subtitle={t('التحويلات المتبادلة بين المناديب والخزائن (توريد تحصيلات أو صرف عهدة)', 'Two-way transfers between reps and cashboxes (collections deposit or custody issue)')}
          data={filteredTransfers}
          rowKey={(tr) => tr.id}
          onRowClick={(tr) => setActiveTransferForAudit(tr)}
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder={t('بحث برقم التحويل أو اسم المندوب أو الخزينة...', 'Search by transfer #, rep name, or cashbox...')}
          searchFilter={(tr, q) =>
            tr.transferNumber.toLowerCase().includes(q) ||
            tr.senderName.toLowerCase().includes(q) ||
            tr.receiverName.toLowerCase().includes(q) ||
            tr.cashboxName.toLowerCase().includes(q)
          }
          toolbarFilters={
            <label className="inline-flex items-center gap-1 h-8 px-2 border border-slate-300 rounded-md bg-white text-xs shrink-0">
              <span className="text-[10.5px] text-slate-500 font-bold">{t('الحالة:', 'Status:')}</span>
              <select
                aria-label={t('حالة التحويل', 'Transfer status')}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent font-bold text-xs outline-hidden"
              >
                <option value="all">{t('جميع الحالات', 'All Statuses')}</option>
                <option value="awaiting_receipt">{t('في انتظار تأكيد الاستلام', 'Awaiting Receipt Confirmation')}</option>
                <option value="received">{t('تم الاستلام وتعديل الأرصدة', 'Received & Balances Updated')}</option>
                <option value="rejected">{t('مرفوض', 'Rejected')}</option>
              </select>
            </label>
          }
          exportFilename={t('التحويلات_النقدية_للمناديب', 'Rep_Cash_Transfers')}
          pdfTitle={t('سجل التحويلات النقدية والعهد المالية للمناديب', 'Rep Cash Transfers & Custody Log')}
          emptyTitle={t('لا توجد طلبات تحويل نقدية مسجلة', 'No cash transfer requests recorded')}
          emptySubtitle={t('يمكنك إنشاء طلب تحويل مالي جديد من الزر بالأعلى', 'You can create a new cash transfer request from the button above')}
          columns={[
            {
              key: 'transferNumber',
              header: t('رقم التحويل', 'Transfer #'),
              sortable: true,
              sortValue: (tr) => tr.transferNumber,
              exportValue: (tr) => tr.transferNumber,
              render: (tr) => <span className="font-bold font-mono text-blue-900">{tr.transferNumber}</span>,
            },
            {
              key: 'date',
              header: t('التاريخ', 'Date'),
              sortable: true,
              sortValue: (tr) => tr.date,
              exportValue: (tr) => tr.date,
              render: (tr) => <span className="font-mono text-slate-600">{tr.date}</span>,
            },
            {
              key: 'direction',
              header: t('اتجاه التحويل', 'Direction'),
              sortable: true,
              sortValue: (tr) => tr.direction,
              exportValue: (tr) =>
                tr.direction === 'rep_to_owner'
                  ? t('توريد تحصيل (من مندوب لفرع)', 'Collection Deposit (Rep to Branch)')
                  : t('صرف عهدة (من فرع لمندوب)', 'Custody Issue (Branch to Rep)'),
              render: (tr) => (
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  tr.direction === 'rep_to_owner'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-blue-50 text-blue-800 border border-blue-200'
                }`}>
                  {tr.direction === 'rep_to_owner'
                    ? t('توريد تحصيل (من مندوب لفرع)', 'Collection Deposit (Rep to Branch)')
                    : t('صرف عهدة (من فرع لمندوب)', 'Custody Issue (Branch to Rep)')}
                </span>
              ),
            },
            {
              key: 'senderName',
              header: t('الطرف المرسل', 'Sender'),
              sortable: true,
              sortValue: (tr) => tr.senderName,
              exportValue: (tr) => tr.senderName,
              render: (tr) => <span className="font-bold text-slate-800">{tr.senderName}</span>,
            },
            {
              key: 'receiverName',
              header: t('الطرف المستلم', 'Receiver'),
              sortable: true,
              sortValue: (tr) => tr.receiverName,
              exportValue: (tr) => tr.receiverName,
              render: (tr) => <span className="font-bold text-slate-800">{tr.receiverName}</span>,
            },
            {
              key: 'amount',
              header: t('المبلغ المحول', 'Transferred Amount'),
              align: 'center',
              sortable: true,
              sortValue: (tr) => tr.amount,
              exportValue: (tr) => tr.amount,
              render: (tr) => (
                <span className="font-black text-slate-900 font-mono tabular-nums">
                  {formatLocaleNumber(tr.amount)} {settings.currency}
                </span>
              ),
            },
            {
              key: 'cashboxName',
              header: t('الخزينة المتأثرة', 'Affected Cashbox'),
              sortable: true,
              sortValue: (tr) => tr.cashboxName,
              exportValue: (tr) => tr.cashboxName,
              render: (tr) => <span className="text-slate-600">{tr.cashboxName}</span>,
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              sortable: true,
              sortValue: (tr) => tr.status,
              exportValue: (tr) => tr.status,
              render: (tr) => getStatusBadge(tr.status),
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
              align: 'center',
              render: (tr) => (
                <div className="flex items-center justify-center gap-1.5">
                  {tr.status === 'awaiting_receipt' && (
                    <>
                      <button
                        onClick={() => handleConfirmReceipt(tr)}
                        className="px-2.5 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold text-[11px] cursor-pointer"
                        title={t('تأكيد الاستلام الفعلي واعتماد القيد المحاسبي', 'Confirm physical receipt and post accounting entry')}
                      >
                        {t('تأكيد الاستلام', 'Confirm Receipt')}
                      </button>
                      <button
                        onClick={() => handleRejectTransfer(tr)}
                        className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-bold text-[11px] cursor-pointer"
                        title={t('رفض استلام التحويل', 'Reject transfer receipt')}
                      >
                        {t('رفض', 'Reject')}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handlePrintTransfer(tr)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 cursor-pointer"
                    title={t('طباعة إيصال التحويل', 'Print transfer receipt')}
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setActiveTransferForAudit(tr)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-blue-50 cursor-pointer"
                    title={t('سجل التتبع والمراجعة (Audit Trail)', 'Audit Trail')}
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
              <h4 className="font-black text-xs">{t('دورة عمل طلبات تحويل أصناف وعهدة المندوب المعتمدة:', 'Approved Rep Item Transfer & Custody Workflow:')}</h4>
              <p className="mt-0.5 leading-relaxed text-[#002160] text-[11px]">
                {t(
                  'عند إصدار المندوب فاتورة مبيعات لعميل جملة ويوجد عجز في كميات السيارة، يتم إنشاء طلب تحويل أصناف مرتبط برقم الفاتورة الأصلية.',
                  'When a rep issues a wholesale invoice with insufficient van stock, an item transfer request linked to the original invoice is created.'
                )}{' '}
                <strong>{t('لا يتم خصم المخزن الرئيسي إلا بعد مراجعة الإدارة والموافقة والتنفيذ الفعلي للتحويل.', 'Main warehouse stock is only deducted after management review, approval, and actual execution.')}</strong>
              </p>
            </div>
          </div>

          <UnifiedDataTable<RepItemTransferRequest>
            compact
            title={t('طلبات تحويل الأصناف وعهدة السيارات', 'Item Transfer & Van Custody Requests')}
            subtitle={t('طلبات سحب البضاعة من المخزن الرئيسي إلى سيارات المناديب وتأكيد الاستلام', 'Requests to dispatch stock from main warehouse to rep vans and confirm receipt')}
            data={filteredItemTransfers}
            rowKey={(req) => req.id}
            onRowClick={(req) => setActiveItemReqDetail(req)}
            searchPlaceholder={t('بحث برقم الطلب أو اسم المندوب أو رقم الفاتورة...', 'Search by request #, rep name, or invoice #...')}
            searchFilter={(r, q) =>
              r.requestNumber.toLowerCase().includes(q) ||
              r.representativeName.toLowerCase().includes(q) ||
              (r.invoiceNumber ? r.invoiceNumber.toLowerCase().includes(q) : false)
            }
            exportFilename={t('طلبات_تحويل_أصناف_المناديب', 'Rep_Item_Transfer_Requests')}
            pdfTitle={t('سجل طلبات تحويل الأصناف وعهد سيارات المناديب', 'Rep Item Transfers & Van Custody Log')}
            emptyTitle={t('لا توجد طلبات تحويل أصناف أو عهدة مسجلة حتى الآن', 'No item transfer or custody requests recorded yet')}
            columns={[
              {
                key: 'requestNumber',
                header: t('رقم الطلب', 'Request #'),
                sortable: true,
                sortValue: (req) => req.requestNumber,
                exportValue: (req) => req.requestNumber,
                render: (req) => (
                  <div className="font-bold font-mono text-[#011E58]">
                    <div>{req.requestNumber}</div>
                    {req.transferMode === 'custody_dispatch' && (
                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-[#DCE6F5] text-[#002160] border border-[#B8CAE8] text-[9px] font-sans font-bold">
                        {t('صرف عهدة مباشر', 'Direct Custody Dispatch')}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: 'date',
                header: t('التاريخ', 'Date'),
                sortable: true,
                sortValue: (req) => req.date,
                exportValue: (req) => req.date,
                render: (req) => <span className="font-mono text-slate-600">{req.date}</span>,
              },
              {
                key: 'representativeName',
                header: t('المندوب', 'Representative'),
                sortable: true,
                sortValue: (req) => req.representativeName,
                exportValue: (req) => req.representativeName,
                render: (req) => <span className="font-bold text-slate-800">{req.representativeName}</span>,
              },
              {
                key: 'invoiceNumber',
                header: t('الفاتورة المرتبطة', 'Linked Invoice'),
                sortable: true,
                sortValue: (req) => req.invoiceNumber || '',
                exportValue: (req) => req.invoiceNumber || t('تحويل إداري مباشر', 'Direct Admin Transfer'),
                render: (req) => (
                  <span className="font-mono font-bold text-blue-800">
                    {req.invoiceNumber ? `${t('فاتورة:', 'Invoice:')} ${req.invoiceNumber}` : t('تحويل إداري مباشر', 'Direct Admin Transfer')}
                  </span>
                ),
              },
              {
                key: 'sourceWarehouseName',
                header: t('المستودع المصدر', 'Source Warehouse'),
                exportValue: (req) => req.sourceWarehouseName,
                render: (req) => <span className="text-slate-600">{req.sourceWarehouseName}</span>,
              },
              {
                key: 'targetWarehouseName',
                header: t('المستودع الوجهة (السيارة)', 'Target Warehouse (Van)'),
                exportValue: (req) => req.targetWarehouseName,
                render: (req) => <span className="text-slate-600">{req.targetWarehouseName}</span>,
              },
              {
                key: 'itemsCount',
                header: t('عدد الأصناف', 'Items Count'),
                align: 'center',
                sortable: true,
                sortValue: (req) => req.items.length,
                exportValue: (req) => req.items.length,
                render: (req) => <span className="font-bold text-slate-700 tabular-nums">{req.items.length} {t('أصناف', 'items')}</span>,
              },
              {
                key: 'status',
                header: t('الحالة', 'Status'),
                align: 'center',
                sortable: true,
                sortValue: (req) => req.status,
                exportValue: (req) => req.status,
                render: (req) => getItemReqStatusBadge(req.status),
              },
              {
                key: 'actions',
                header: t('الإجراءات', 'Actions'),
                align: 'center',
                render: (req) => (
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => setActiveItemReqDetail(req)}
                      className="px-2.5 py-1 bg-blue-50 text-blue-900 hover:bg-blue-100 rounded-lg font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{t('فحص الأصناف', 'Inspect Items')}</span>
                    </button>
                    {req.status === 'pending' && (currentUser?.role === 'admin' || hasPermission('canManageTransfers')) && (
                      <button
                        onClick={() => handleExecuteItemTransfer(req)}
                        className="px-2.5 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold text-[11px] cursor-pointer"
                        title={t('موافقة وصرف البضاعة من المخزن الرئيسي', 'Approve & dispatch goods from main warehouse')}
                      >
                        {t('اعتماد وصرف', 'Approve & Dispatch')}
                      </button>
                    )}
                    {req.status === 'executed' && (
                      <button
                        onClick={() => handleConfirmCustodyReceipt(req)}
                        className="px-2.5 py-1 bg-[#011E58] hover:bg-[#003589] text-white rounded-md font-bold text-[11px] cursor-pointer"
                        title={t('تأكيد استلام المندوب وإضافة البضاعة لعهدة السيارة', 'Confirm rep receipt and add stock to van custody')}
                      >
                        {t('تأكيد استلام المندوب', 'Confirm Rep Receipt')}
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
          title={t('دليل المناديب ومتابعة العهد المالية', 'Representatives Directory & Cash Custody')}
          subtitle={t('قائمة مندوبي التوزيع الميدانيين وأرصدة العهد النقدية الحالية', 'List of field distribution reps and current cash custody balances')}
          data={representatives}
          rowKey={(rep) => rep.id}
          onRowClick={(rep) => {
            setCustodyRepId(rep.id);
            setActiveTab('rep-custody-statement');
          }}
          searchPlaceholder={t('بحث باسم المندوب أو الهاتف أو رقم السيارة...', 'Search by rep name, phone, or vehicle #...')}
          searchFilter={(rep, q) =>
            rep.name.toLowerCase().includes(q) ||
            (rep.phone || '').includes(q) ||
            (rep.vehicleNumber || '').toLowerCase().includes(q)
          }
          exportFilename={t('دليل_المناديب', 'Representatives_Directory')}
          pdfTitle={t('دليل المناديب ومتابعة العهد المالية', 'Representatives Directory & Cash Custody')}
          emptyTitle={t('لا يوجد مناديب مسجلون حالياً', 'No representatives registered yet')}
          columns={[
            {
              key: 'name',
              header: t('اسم المندوب', 'Rep Name'),
              sortable: true,
              sortValue: (rep) => rep.name,
              exportValue: (rep) => rep.name,
              render: (rep) => <span className="font-black text-slate-900">{rep.name}</span>,
            },
            {
              key: 'phone',
              header: t('رقم الهاتف', 'Phone'),
              sortable: true,
              sortValue: (rep) => rep.phone || '',
              exportValue: (rep) => rep.phone || '-',
              render: (rep) => <span className="font-mono text-slate-600">{rep.phone || '-'}</span>,
            },
            {
              key: 'vehicleNumber',
              header: t('رقم السيارة / العهدة', 'Vehicle / Custody #'),
              sortable: true,
              sortValue: (rep) => rep.vehicleNumber || '',
              exportValue: (rep) => rep.vehicleNumber || t('سيارة التوزيع 1', 'Distribution Van 1'),
              render: (rep) => <span className="font-bold text-slate-800">{rep.vehicleNumber || t('سيارة التوزيع 1', 'Distribution Van 1')}</span>,
            },
            {
              key: 'currentBalance',
              header: t('العهدة المالية الحالية', 'Current Cash Custody'),
              align: 'center',
              sortable: true,
              sortValue: (rep) => (rep.balanceHidden || rep.currentBalance === undefined ? 0 : rep.currentBalance),
              exportValue: (rep) =>
                rep.balanceHidden || rep.currentBalance === undefined ? t('محجوب', 'Hidden') : rep.currentBalance,
              render: (rep) => (
                <span className="text-emerald-700 font-black font-mono tabular-nums">
                  {rep.balanceHidden || rep.currentBalance === undefined
                    ? t('محجوب', 'Hidden')
                    : `${formatLocaleNumber(rep.currentBalance)} ${settings.currency}`}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              sortable: true,
              sortValue: (rep) => rep.status,
              exportValue: (rep) => (rep.status === 'active' ? t('نشط ميدانياً', 'Active in Field') : t('موقف', 'Suspended')),
              render: (rep) => (
                <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${
                  rep.status === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}>
                  {rep.status === 'active' ? t('نشط ميدانياً', 'Active in Field') : t('موقف', 'Suspended')}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
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
                    {t('توريد نقدية', 'Deposit Cash')}
                  </button>
                  <button
                    onClick={() => {
                      setCustodyRepId(rep.id);
                      setActiveTab('rep-custody-statement');
                    }}
                    className="px-2.5 py-1 rounded-md bg-[#EEF3FA] text-[#011E58] hover:bg-[#DCE6F5] font-bold text-[11px] cursor-pointer"
                  >
                    {t('كشف العهدة', 'Custody Statement')}
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
                    title={t('تعديل بيانات المندوب', 'Edit Representative')}
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
          <div className="bg-white dark:bg-[#0D1A32] p-2 rounded-lg border border-slate-200 dark:border-[#233961] shadow-xs text-xs">
            <div className="awlad-filter-row justify-between" data-testid="rep-custody-filter-row">
              <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
                <label className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-slate-300 dark:border-[#2A436E] bg-slate-50 dark:bg-[#10203D] shrink-0">
                  <span className="text-[10.5px] font-bold text-slate-500 dark:text-[#9CB0D4]">{t('المندوب:', 'Rep:')}</span>
                  <select
                    aria-label={t('المندوب', 'Representative')}
                    value={custodyRepId}
                    disabled={isRepUser}
                    onChange={(e) => setCustodyRepId(e.target.value)}
                    className="bg-transparent font-bold text-xs min-w-[140px] outline-hidden text-slate-800 dark:text-[#EEF4FC]"
                  >
                    {representatives.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </label>
                <label className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-slate-300 dark:border-[#2A436E] bg-slate-50 dark:bg-[#10203D] shrink-0">
                  <span className="text-[10.5px] font-bold text-slate-500 dark:text-[#9CB0D4]">{t('من:', 'From:')}</span>
                  <input
                    type="date"
                    aria-label={t('من تاريخ', 'From date')}
                    value={custodyDateFrom}
                    onChange={(e) => setCustodyDateFrom(e.target.value)}
                    className="bg-transparent font-mono text-xs outline-hidden text-slate-800 dark:text-[#EEF4FC]"
                  />
                </label>
                <label className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-slate-300 dark:border-[#2A436E] bg-slate-50 dark:bg-[#10203D] shrink-0">
                  <span className="text-[10.5px] font-bold text-slate-500 dark:text-[#9CB0D4]">{t('إلى:', 'To:')}</span>
                  <input
                    type="date"
                    aria-label={t('إلى تاريخ', 'To date')}
                    value={custodyDateTo}
                    onChange={(e) => setCustodyDateTo(e.target.value)}
                    className="bg-transparent font-mono text-xs outline-hidden text-slate-800 dark:text-[#EEF4FC]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => loadCustodyStatement(custodyRepId)}
                  disabled={isCustodyLoading}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-blue-900 hover:bg-blue-950 text-white font-bold cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCustodyLoading ? 'animate-spin' : ''}`} />
                  <span>{t('تحديث الكشف', 'Refresh Statement')}</span>
                </button>
              </div>

              <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
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
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer shrink-0"
                >
                  <PackageCheck className="w-3.5 h-3.5" />
                  <span>{t('تسليم جزئي للعميل', 'Partial Delivery')}</span>
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
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#B8CAE8] font-bold cursor-pointer shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t('إرجاع للمخزن الرئيسي', 'Return to Main Warehouse')}</span>
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
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-slate-800 hover:bg-slate-900 text-white font-bold cursor-pointer shrink-0"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{t('تسوية / تالف / عجز', 'Adjust / Damaged / Shortage')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExportCustodyExcel}
                  disabled={!custodyStatement}
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-[#003589]" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrintCustodyStatement}
                  disabled={!custodyStatement}
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Printer className="w-3.5 h-3.5 text-[#011E58]" />
                  <span>{t('طباعة', 'Print')}</span>
                </button>
              </div>
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
                    <Wallet className="w-3.5 h-3.5 text-[#003589]" /> {t('رصيد العهدة النقدية الحالية', 'Current Cash Custody Balance')}
                  </span>
                  <p className="text-base font-black text-[#011E58] font-mono tabular-nums mt-0.5">
                    {formatLocaleNumber(custodyStatement.financialSummary.currentCashCustodyBalance)} {settings.currency}
                  </p>
                </div>
                <div className="bg-white px-3 py-2">
                  <span className="text-[11px] text-slate-500 font-bold">{t('إجمالي مبيعات المندوب', 'Total Rep Sales')}</span>
                  <p className="text-base font-black text-slate-900 font-mono tabular-nums mt-0.5">
                    {formatLocaleNumber(custodyStatement.financialSummary.totalSalesAmount)} {settings.currency}
                  </p>
                </div>
                <div className="bg-white px-3 py-2">
                  <span className="text-[11px] text-emerald-700 font-bold">{t('المحصّل من الفواتير', 'Collected from Invoices')}</span>
                  <p className="text-base font-black text-emerald-700 font-mono tabular-nums mt-0.5">
                    {formatLocaleNumber(custodyStatement.financialSummary.totalSalesPaidAmount)} {settings.currency}
                  </p>
                </div>
                <div className="bg-white px-3 py-2">
                  <span className="text-[11px] text-amber-700 font-bold">{t('المتبقي بالآجل عند العملاء', 'Credit Due from Customers')}</span>
                  <p className="text-base font-black text-amber-800 font-mono tabular-nums mt-0.5">
                    {formatLocaleNumber(custodyStatement.financialSummary.totalSalesRemainingAmount)} {settings.currency}
                  </p>
                </div>
              </div>

              {/* Item Custody Totals Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 bg-[#011E58] text-white p-2.5 rounded-lg text-center text-[11px] tabular-nums">
                <div>
                  <span className="text-[#B8CAE8] block">{t('المستلم فعلياً', 'Physically Received')}</span>
                  <strong className="text-xs font-mono">{formatLocaleNumber(custodyStatement.totals.totalReceivedQty)}</strong>
                </div>
                <div>
                  <span className="text-amber-300 block">{t('بانتظار الاستلام', 'Pending Receipt')}</span>
                  <strong className="text-xs font-mono">{formatLocaleNumber(custodyStatement.totals.totalPendingReceiveQty)}</strong>
                </div>
                <div>
                  <span className="text-emerald-300 block">{t('مسلم للعملاء', 'Delivered to Customers')}</span>
                  <strong className="text-xs font-mono">{formatLocaleNumber(custodyStatement.totals.totalDeliveredQty)}</strong>
                </div>
                <div>
                  <span className="text-[#DCE6F5] block">{t('مرتجع للمخزن', 'Returned to Warehouse')}</span>
                  <strong className="text-xs font-mono">{formatLocaleNumber(custodyStatement.totals.totalReturnedQty)}</strong>
                </div>
                <div>
                  <span className="text-rose-300 block">{t('تسويات / تالف', 'Adjustments / Damaged')}</span>
                  <strong className="text-xs font-mono">{formatLocaleNumber(custodyStatement.totals.totalReductionsQty)}</strong>
                </div>
                <div>
                  <span className="text-[#B8CAE8] block">{t('المتبقي بالعهدة', 'Remaining Custody')}</span>
                  <strong className="text-xs font-mono text-white">{formatLocaleNumber(custodyStatement.totals.totalRemainingCustodyQty)}</strong>
                </div>
                <div>
                  <span className="text-[#DCE6F5] block">{t('رصيد السيارة الفعلي', 'Actual Van Stock')}</span>
                  <strong className="text-xs font-mono">{formatLocaleNumber(custodyStatement.totals.totalVanPhysicalQty)}</strong>
                </div>
                <div>
                  <span className="text-emerald-200 block">{t('قيمة العهدة بالتكلفة', 'Custody Cost Value')}</span>
                  <strong className="text-xs font-mono">{formatLocaleNumber(custodyStatement.totals.totalCustodyCostValue)}</strong>
                </div>
              </div>

              {/* Items Summary Table */}
              <UnifiedDataTable
                compact
                title={t('ملخص الأصناف في عهدة المندوب', 'Summary of Items in Rep Custody')}
                subtitle={t('المتبقي = المستلم − المسلم للعملاء − المرتجع − التسويات', 'Remaining = Received − Delivered − Returned − Adjustments')}
                data={custodyStatement.itemsSummary}
                rowKey={(it) => it.productId}
                searchPlaceholder={t('بحث باسم الصنف أو الكود...', 'Search by item name or code...')}
                searchFilter={(it, q) =>
                  it.productName.toLowerCase().includes(q) || (it.productCode || '').toLowerCase().includes(q)
                }
                exportFilename={t('ملخص_أصناف_عهدة_المندوب', 'Rep_Custody_Items_Summary')}
                pdfTitle={t('ملخص الأصناف في عهدة المندوب', 'Summary of Items in Rep Custody')}
                emptyTitle={t('لا توجد حركات أصناف مسجلة لهذا المندوب في الفترة المحددة', 'No item movements recorded for this rep in the selected period')}
                columns={[
                  {
                    key: 'productName',
                    header: t('الصنف', 'Item'),
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
                  { key: 'baseUnit', header: t('الوحدة', 'Unit'), align: 'center', exportValue: (it) => it.baseUnit, render: (it) => t(it.baseUnit) },
                  {
                    key: 'receivedQty',
                    header: t('مستلم', 'Received'),
                    align: 'center',
                    sortable: true,
                    sortValue: (it) => it.receivedQty,
                    exportValue: (it) => it.receivedQty,
                    render: (it) => <span className="font-mono font-bold text-blue-900 tabular-nums">{formatLocaleNumber(it.receivedQty)}</span>,
                  },
                  {
                    key: 'pendingReceiveQty',
                    header: t('معلّق (قيد الاستلام)', 'Pending Receipt'),
                    align: 'center',
                    exportValue: (it) => it.pendingReceiveQty,
                    render: (it) => <span className="font-mono text-amber-700 tabular-nums">{formatLocaleNumber(it.pendingReceiveQty)}</span>,
                  },
                  {
                    key: 'deliveredToCustomersQty',
                    header: t('مسلم للعملاء', 'Delivered'),
                    align: 'center',
                    exportValue: (it) => it.deliveredToCustomersQty,
                    render: (it) => <span className="font-mono font-bold text-emerald-700 tabular-nums">{formatLocaleNumber(it.deliveredToCustomersQty)}</span>,
                  },
                  {
                    key: 'invoicedSoldQty',
                    header: t('مفوتر', 'Invoiced'),
                    align: 'center',
                    exportValue: (it) => it.invoicedSoldQty,
                    render: (it) => <span className="font-mono text-slate-700 tabular-nums">{formatLocaleNumber(it.invoicedSoldQty)}</span>,
                  },
                  {
                    key: 'returnedToWarehouseQty',
                    header: t('مرتجع للمخزن', 'Returned'),
                    align: 'center',
                    exportValue: (it) => it.returnedToWarehouseQty,
                    render: (it) => <span className="font-mono text-[#003589] tabular-nums">{formatLocaleNumber(it.returnedToWarehouseQty)}</span>,
                  },
                  {
                    key: 'approvedReductionsQty',
                    header: t('تالف/عجز/تسوية', 'Damaged/Short/Adj'),
                    align: 'center',
                    exportValue: (it) => it.approvedReductionsQty,
                    render: (it) => <span className="font-mono text-rose-700 tabular-nums">{formatLocaleNumber(it.approvedReductionsQty)}</span>,
                  },
                  {
                    key: 'remainingCustodyQty',
                    header: t('المتبقي بالعهدة', 'Remaining Custody'),
                    align: 'center',
                    sortable: true,
                    sortValue: (it) => it.remainingCustodyQty,
                    exportValue: (it) => it.remainingCustodyQty,
                    cellClassName: 'bg-blue-50/60',
                    render: (it) => <span className="font-mono font-black text-blue-950 tabular-nums">{formatLocaleNumber(it.remainingCustodyQty)}</span>,
                  },
                  {
                    key: 'vanPhysicalStockQty',
                    header: t('رصيد السيارة', 'Van Stock'),
                    align: 'center',
                    exportValue: (it) => it.vanPhysicalStockQty,
                    render: (it) => <span className="font-mono font-bold text-slate-800 tabular-nums">{formatLocaleNumber(it.vanPhysicalStockQty)}</span>,
                  },
                  {
                    key: 'custodyValueAtCost',
                    header: t('القيمة بالتكلفة', 'Value at Cost'),
                    align: 'center',
                    sortable: true,
                    sortValue: (it) => it.custodyValueAtCost,
                    exportValue: (it) => it.custodyValueAtCost,
                    render: (it) => (
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {formatLocaleNumber(it.custodyValueAtCost)} {settings.currency}
                      </span>
                    ),
                  },
                ]}
              />

              {/* Chronological Custody Ledger Table */}
              <UnifiedDataTable
                compact
                title={`${t('سجل حركات العهدة التفصيلي', 'Detailed Custody Movements Ledger')} (${custodyStatement.ledger.length})`}
                data={custodyStatement.ledger}
                rowKey={(row) => row.id}
                searchPlaceholder={t('بحث برقم المستند أو الصنف أو العميل...', 'Search by document #, item, or customer...')}
                searchFilter={(row, q) =>
                  (row.docNumber || '').toLowerCase().includes(q) ||
                  (row.productName || '').toLowerCase().includes(q) ||
                  (row.customerName || '').toLowerCase().includes(q)
                }
                exportFilename={t('سجل_حركات_عهدة_المندوب', 'Rep_Custody_Ledger')}
                pdfTitle={t('سجل حركات عهدة المندوب التفصيلي', 'Detailed Rep Custody Ledger')}
                emptyTitle={t('لا توجد حركات مسجلة في دفتر العهدة', 'No movements recorded in custody ledger')}
                columns={[
                  { key: 'date', header: t('التاريخ', 'Date'), sortable: true, sortValue: (r) => r.date, exportValue: (r) => r.date, render: (r) => <span className="font-mono text-slate-600">{r.date}</span> },
                  { key: 'docType', header: t('نوع الحركة', 'Type'), exportValue: (r) => r.docType, render: (r) => <span className="font-bold text-slate-800">{t(r.docType)}</span> },
                  { key: 'docNumber', header: t('رقم المستند', 'Document #'), exportValue: (r) => r.docNumber, render: (r) => <span className="font-mono text-blue-900 font-bold">{r.docNumber}</span> },
                  { key: 'productName', header: t('الصنف', 'Item'), exportValue: (r) => r.productName, render: (r) => <span className="font-bold">{r.productName}</span> },
                  { key: 'customerName', header: t('العميل / الجهة', 'Customer / Party'), exportValue: (r) => r.customerName || '-', render: (r) => <span className="text-slate-600">{r.customerName || '-'}</span> },
                  {
                    key: 'quantityIn',
                    header: t('وارد للعهدة (+)', 'In (+)'),
                    align: 'center',
                    exportValue: (r) => r.quantityIn,
                    render: (r) => <span className="font-mono font-bold text-emerald-700 tabular-nums">{r.quantityIn > 0 ? `+${formatLocaleNumber(r.quantityIn)}` : '-'}</span>,
                  },
                  {
                    key: 'quantityOut',
                    header: t('صادر من العهدة (-)', 'Out (-)'),
                    align: 'center',
                    exportValue: (r) => r.quantityOut,
                    render: (r) => <span className="font-mono font-bold text-rose-700 tabular-nums">{r.quantityOut > 0 ? `-${formatLocaleNumber(r.quantityOut)}` : '-'}</span>,
                  },
                  { key: 'notes', header: t('ملاحظات', 'Notes'), exportValue: (r) => r.notes || '-', render: (r) => <span className="text-slate-500">{r.notes || '-'}</span> },
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
          title={t('طلب تحويل مالي (توريد تحصيلات أو صرف عهدة)', 'Cash Transfer Request (Collections Deposit or Custody Issue)')}
        >
          <form onSubmit={handleSubmitCashTransfer} className="space-y-3 text-xs">
            {error && (
              <div className="px-3 py-2 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 border border-red-200">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">{t('اتجاه التحويل:', 'Transfer Direction:')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDirection('rep_to_owner')}
                  className={`h-8 px-2.5 rounded-md border text-center font-bold cursor-pointer transition-all ${
                    direction === 'rep_to_owner' ? 'bg-[#003589] text-white border-[#003589]' : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  {t('توريد من مندوب إلى الفرع', 'Deposit from Rep to Branch')}
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('owner_to_rep')}
                  className={`h-8 px-2.5 rounded-md border text-center font-bold cursor-pointer transition-all ${
                    direction === 'owner_to_rep' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  {t('صرف عهدة نقدية للمندوب', 'Issue Cash Custody to Rep')}
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">{t('المندوب المعني:', 'Representative:')}</label>
              <select
                value={selectedRepId}
                onChange={(e) => setSelectedRepId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              >
                {representatives.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({t('رصيد عهدته:', 'Custody balance:')} {r.balanceHidden || r.currentBalance === undefined ? t('محجوب', 'Hidden') : `${formatLocaleNumber(r.currentBalance)} ${settings.currency}`})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">{t('المبلغ المحول', 'Transferred Amount')} ({settings.currency}):</label>
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
                <label className="block font-bold mb-1">{t('الخزينة المتأثرة للفرع:', 'Affected Branch Cashbox:')}</label>
                <select
                  value={selectedCashboxId}
                  onChange={(e) => setSelectedCashboxId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                >
                  {cashboxes.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.balanceHidden ? `${c.name} (${t('رصيد محجوب', 'Hidden balance')})` : `${c.name} (${formatLocaleNumber(c.currentBalance ?? 0)} ${settings.currency})`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">{t('ملاحظات التحويل:', 'Transfer Notes:')}</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('تفاصيل التوريد أو سبب الصرف...', 'Deposit details or reason for issue...')}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2.5 border-t">
              <button
                type="button"
                onClick={() => setIsNewCashModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? t('جاري الإرسال...', 'Sending...') : t('إرسال طلب التحويل', 'Submit Transfer Request')}
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
          title={t('طلب تحويل أصناف وعهدة مخزنية (مرتبط بفاتورة مبيعات)', 'Item Transfer & Inventory Custody Request (Linked to Invoice)')}
        >
          <form onSubmit={handleSubmitItemTransferRequest} className="space-y-3 text-xs">
            {itemReqError && (
              <div className="px-3 py-2 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 border border-red-200">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{itemReqError}</span>
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">{t('نوع الإذن / المسار:', 'Request Type / Flow:')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setItemReqTransferMode('transfer')}
                  className={`h-8 px-2.5 rounded-md border font-bold cursor-pointer ${
                    itemReqTransferMode === 'transfer' ? 'bg-[#011E58] text-white border-[#011E58]' : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  {t('تحويل عادي / طلب سحب', 'Standard Transfer / Pull Request')}
                </button>
                <button
                  type="button"
                  onClick={() => setItemReqTransferMode('custody_dispatch')}
                  className={`h-8 px-2.5 rounded-md border font-bold cursor-pointer ${
                    itemReqTransferMode === 'custody_dispatch' ? 'bg-[#003589] text-white border-[#003589]' : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  {t('صرف عهدة مباشرة من المخزن للمندوب', 'Direct Custody Dispatch from Warehouse to Rep')}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                {t(
                  'في وضع صرف العهدة المباشر يُخصم المخزن الرئيسي فوراً ولا تُضاف البضاعة لرصيد سيارة المندوب إلا بعد تأكيد الاستلام.',
                  'In Direct Custody Dispatch mode, main warehouse stock is deducted immediately and van stock is credited only after receipt confirmation.'
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">{t('المندوب:', 'Representative:')}</label>
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
                <label className="block font-bold mb-1">{t('الفاتورة المرتبطة (إن وجدت):', 'Linked Invoice (if any):')}</label>
                <select
                  value={itemReqInvoiceId}
                  onChange={(e) => setItemReqInvoiceId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="">{t('-- بدون ربط بفاتورة (تحويل عهدة مباشر) --', '-- No Linked Invoice (Direct Custody Transfer) --')}</option>
                  {invoices.filter(i => i.type === 'sales').map(inv => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} - {inv.customerName} ({formatLocaleNumber(inv.grandTotal)} {settings.currency})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">{t('المستودع المصدر (المقر الرئيسي):', 'Source Warehouse (Main Branch):')}</label>
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
                <label className="block font-bold mb-1">{t('مستودع الوجهة (سيارة المندوب):', 'Target Warehouse (Rep Van):')}</label>
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
              <span className="font-bold text-slate-800 block">{t('إضافة أصناف للطلب (بحث فوري):', 'Add Items to Request (Quick Search):')}</span>
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
                    placeholder={t('ابحث باسم الصنف أو الكود أو الباركود...', 'Search by item name, code, or barcode...')}
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
                  placeholder={t('الكمية', 'Qty')}
                />
                <button
                  type="button"
                  onClick={handleAddItemToReq}
                  className="h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer"
                >
                  {t('إضافة +', 'Add +')}
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
                      { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold">{it.productName}</span> },
                      { key: 'requestedQty', header: t('الكمية المطلوبة', 'Requested Qty'), align: 'center', render: (it) => <span className="font-bold text-[#011E58] tabular-nums">{formatLocaleNumber(it.requestedQty)} {t(it.unit)}</span> },
                      { key: 'availableInVanQty', header: t('المتاح بالسيارة', 'Available in Van'), align: 'center', render: (it) => <span className="text-slate-600 tabular-nums">{formatLocaleNumber(it.availableInVanQty)}</span> },
                      { key: 'shortageQty', header: t('العجز', 'Shortage'), align: 'center', render: (it) => <span className="font-bold text-red-600 tabular-nums">{formatLocaleNumber(it.shortageQty)}</span> },
                      {
                        key: 'remove',
                        header: t('حذف', 'Remove'),
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
              <label className="block font-bold mb-1">{t('ملاحظات الطلب:', 'Request Notes:')}</label>
              <textarea
                rows={2}
                value={itemReqNotes}
                onChange={(e) => setItemReqNotes(e.target.value)}
                placeholder={t('أسباب طلب العهدة أو مواعيد التسليم...', 'Reasons for custody request or delivery schedule...')}
                className="w-full px-2.5 py-1.5 rounded-md border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2.5 border-t">
              <button
                type="button"
                onClick={() => setIsNewItemReqModalOpen(false)}
                className="h-8 px-3 rounded-md border border-slate-300 text-slate-600 font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmittingItemReq || selectedItemsForReq.length === 0}
                className="h-8 px-3.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmittingItemReq ? t('جاري الإرسال...', 'Submitting...') : t('إرسال طلب التحويل للإدارة', 'Submit Transfer Request')}
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
          title={`${t('تفاصيل طلب تحويل أصناف رقم:', 'Item Transfer Request Details #:')} ${activeItemReqDetail.requestNumber}`}
        >
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2.5 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <p className="text-slate-500">{t('المندوب:', 'Representative:')} <strong className="text-slate-800">{activeItemReqDetail.representativeName}</strong></p>
                <p className="text-slate-500">{t('المستودع المصدر:', 'Source Warehouse:')} <strong className="text-slate-800">{activeItemReqDetail.sourceWarehouseName}</strong></p>
              </div>
              <div>
                <p className="text-slate-500">{t('التاريخ:', 'Date:')} <strong className="font-mono text-slate-800">{activeItemReqDetail.date}</strong></p>
                <p className="text-slate-500">{t('الفاتورة المرتبطة:', 'Linked Invoice:')} <strong className="text-blue-900">{activeItemReqDetail.invoiceNumber || t('تحويل مباشر', 'Direct Transfer')}</strong></p>
              </div>
            </div>

            <div>
              <span className="font-bold text-slate-800 block mb-1.5">{t('الأصناف المطلوبة وحالة العجز:', 'Requested Items & Shortage Status:')}</span>
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                data={activeItemReqDetail.items.map((item, idx) => ({ ...item, _idx: idx }))}
                rowKey={(item) => `${item.productId}-${item._idx}`}
                columns={[
                  { key: 'productName', header: t('الصنف', 'Item'), render: (item) => <span className="font-bold text-slate-800">{item.productName}</span> },
                  { key: 'unit', header: t('الوحدة', 'Unit'), align: 'center', render: (item) => <span className="text-slate-600">{t(item.unit)}</span> },
                  { key: 'requestedQty', header: t('الكمية المطلوبة', 'Requested Qty'), align: 'center', render: (item) => <span className="font-bold text-blue-900 tabular-nums">{formatLocaleNumber(item.requestedQty)}</span> },
                  { key: 'availableInVanQty', header: t('المتاح بالسيارة', 'Available in Van'), align: 'center', render: (item) => <span className="text-slate-600 tabular-nums">{formatLocaleNumber(item.availableInVanQty)}</span> },
                  { key: 'shortageQty', header: t('العجز', 'Shortage'), align: 'center', render: (item) => <span className="font-black text-red-600 tabular-nums">{formatLocaleNumber(item.shortageQty)}</span> },
                ]}
              />
            </div>

            {activeItemReqDetail.notes && (
              <p className="text-slate-600 italic">{t('ملاحظات:', 'Notes:')} {activeItemReqDetail.notes}</p>
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
                      {t('رفض الطلب', 'Reject Request')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExecuteItemTransfer(activeItemReqDetail)}
                      className="h-8 px-3.5 bg-[#003589] hover:bg-[#0049B0] text-white font-black rounded-md cursor-pointer"
                    >
                      {t('اعتماد وصرف من المخزن الرئيسي', 'Approve & Dispatch from Main Warehouse')}
                    </button>
                  </>
                )}
                {activeItemReqDetail.status === 'executed' && (
                  <button
                    type="button"
                    onClick={() => handleConfirmCustodyReceipt(activeItemReqDetail)}
                    className="h-8 px-3.5 bg-[#011E58] hover:bg-[#003589] text-white font-black rounded-md cursor-pointer"
                  >
                    {t('تأكيد استلام المندوب', 'Confirm Rep Receipt')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveItemReqDetail(null)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer"
                >
                  {t('إغلاق', 'Close')}
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
              ? t('تسجيل تسليم جزئي من العهدة للعميل', 'Record Partial Custody Delivery to Customer')
              : custodyActionModal === 'return'
              ? t('تسجيل إرجاع أصناف من العهدة للمخزن الرئيسي', 'Record Custody Return to Main Warehouse')
              : t('تسوية عهدة المندوب (تالف / عجز / تسوية)', 'Adjust Rep Custody (Damaged / Shortage / Adjustment)')
          }
          maxWidth="md"
        >
          <form onSubmit={handleSubmitCustodyOp} className="space-y-3 text-xs">
            <div>
              <label className="block font-bold mb-1">{t('الصنف:', 'Item:')}</label>
              <select
                required
                value={custodyOpProductId}
                onChange={(e) => setCustodyOpProductId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
              >
                <option value="">{t('-- اختر الصنف --', '-- Select Item --')}</option>
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
                  <label className="block font-bold mb-1">{t('العميل (من الدليل):', 'Customer (Directory):')}</label>
                  <select
                    value={custodyOpCustomerId}
                    onChange={(e) => setCustodyOpCustomerId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                  >
                    <option value="">{t('-- عميل نقدي / إدخال يدوي --', '-- Cash Customer / Manual Entry --')}</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">{t('أو اسم العميل:', 'Or Customer Name:')}</label>
                  <input
                    type="text"
                    value={custodyOpCustomerName}
                    onChange={(e) => setCustodyOpCustomerName(e.target.value)}
                    placeholder={t('اسم العميل المستلم...', 'Receiving customer name...')}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
              </div>
            )}

            {custodyActionModal === 'return' && (
              <div>
                <label className="block font-bold mb-1">{t('المستودع المستلم للمرتجع:', 'Receiving Warehouse for Return:')}</label>
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
                <label className="block font-bold mb-1">{t('نوع التسوية:', 'Adjustment Type:')}</label>
                <select
                  value={custodyOpType}
                  onChange={(e) => setCustodyOpType(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                >
                  <option value="custody_damaged">{t('تالف عهدة', 'Damaged Custody')}</option>
                  <option value="custody_shortage">{t('عجز عهدة', 'Custody Shortage')}</option>
                  <option value="custody_adjustment">{t('تسوية إدارية للعهدة', 'Administrative Custody Adjustment')}</option>
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold mb-1">{t('الكمية:', 'Quantity:')}</label>
                <input
                  type="number"
                  required
                  min={0.001}
                  step="0.001"
                  placeholder={t('أدخل الكمية', 'Enter quantity')}
                  value={custodyOpQty}
                  onChange={(e) => setCustodyOpQty(e.target.value === '' ? '' : parseFloat(e.target.value) || '')}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{t('التاريخ:', 'Date:')}</label>
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
              <label className="block font-bold mb-1">{t('ملاحظات / سبب:', 'Notes / Reason:')}</label>
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
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmittingCustodyOp || !custodyOpProductId || Number(custodyOpQty || 0) <= 0}
                className="px-4 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSubmittingCustodyOp ? t('جاري التنفيذ...', 'Executing...') : t('حفظ وتنفيذ', 'Save & Execute')}
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
          title={editingRep ? t('تعديل بيانات المندوب', 'Edit Representative') : t('إضافة مندوب مبيعات جديد', 'Add New Sales Representative')}
        >
          <form onSubmit={handleSaveRep} className="space-y-3 text-xs">
            {repFormError && (
              <div className="px-3 py-2 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 border border-red-200 font-bold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{repFormError}</span>
              </div>
            )}
            <div>
              <label className="block font-bold mb-1">{t('اسم المندوب:', 'Representative Name:')}</label>
              <input
                type="text"
                required
                value={repName}
                onChange={(e) => setRepName(e.target.value)}
                placeholder={t('اسم المندوب ثلاثي...', 'Full representative name...')}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">{t('رقم الهاتف:', 'Phone Number:')}</label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={repPhone}
                  onChange={(e) => setRepPhone(e.target.value)}
                  placeholder="010XXXXXXXX"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">{t('رقم السيارة / رمز العهدة:', 'Vehicle # / Custody Code:')}</label>
                <input
                  type="text"
                  value={repVehicle}
                  onChange={(e) => setRepVehicle(e.target.value)}
                  placeholder={t('مثال: سيارة توزيع 4 (أ ب ج 123)', 'e.g., Distribution Van 4')}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            {!editingRep && (
              <>
                <div>
                  <label className="block font-bold mb-1">{t('رصيد العهدة الافتتاحي', 'Opening Custody Balance')} ({settings.currency}):</label>
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
                          {t('إنشاء حساب دخول تلقائي بصلاحيات المندوب الافتراضية', 'Create automatic login account with default rep permissions')}
                        </span>
                        <span className="text-[11px] text-[#003589] block mt-0.5">
                          {t(
                            'يفعّل المبيعات والعملاء والتحويلات وإنشاء مسودات الشراء وإرسالها، مع إنشاء مستودع سيارة مربوط 1:1 (يمكن تعديل الصلاحيات لاحقاً من إدارة المستخدمين).',
                            'Enables sales, customers, transfers, purchase drafts & messaging, plus a 1:1 linked van warehouse (permissions can be edited later in User Management).'
                          )}
                        </span>
                      </div>
                    </label>

                    {createRepAccount && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">{t('اسم المستخدم للدخول: *', 'Login Username: *')}</label>
                          <input
                            type="text"
                            required={createRepAccount}
                            value={repUsername}
                            onChange={(e) => setRepUsername(e.target.value)}
                            placeholder="rep_ahmed"
                            dir="ltr"
                            className="w-full h-8 px-2 rounded-md border border-[#B8CAE8] bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">{t('كلمة المرور: *', 'Password: *')}</label>
                          <input
                            type="password"
                            required={createRepAccount}
                            value={repPassword}
                            onChange={(e) => setRepPassword(e.target.value)}
                            placeholder={t('4 أحرف على الأقل...', 'At least 4 chars...')}
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
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isSavingRep}
                className="px-4 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
              >
                {isSavingRep ? t('جاري الحفظ...', 'Saving...') : editingRep ? t('تحديث المندوب', 'Update Rep') : t('حفظ المندوب الجديد', 'Save New Rep')}
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
          title={`${t('سجل المراجعة والتأكيد الثنائي للتحويل:', 'Dual-Confirmation Audit Trail for Transfer:')} ${activeTransferForAudit.transferNumber}`}
        >
          <div className="space-y-3 text-xs">
            <div className="p-2.5 bg-slate-50 rounded-lg border flex items-center justify-between">
              <div>
                <span className="block text-slate-500">{t('المبلغ المحول:', 'Transferred Amount:')}</span>
                <span className="text-sm font-black text-blue-950 font-mono">
                  {formatLocaleNumber(activeTransferForAudit.amount)} {settings.currency}
                </span>
              </div>
              <div>{getStatusBadge(activeTransferForAudit.status)}</div>
            </div>

            <div className="space-y-2.5 relative before:absolute before:top-2 before:bottom-2 before:start-3.5 before:w-0.5 before:bg-slate-200">
              {activeTransferForAudit.auditTrail.map((log, idx) => (
                <div key={idx} className="relative flex items-start gap-2.5 ms-1">
                  <div className="w-6 h-6 rounded-full bg-blue-900 text-white flex items-center justify-center font-bold text-[10px] shrink-0 z-10">
                    {idx + 1}
                  </div>
                  <div className="flex-1 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="font-bold text-slate-900">{t(log.action)}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {formatLocaleDateTime(log.timestamp)}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      {t('بواسطة:', 'By:')} <strong className="text-blue-900">{log.user}</strong>
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
                {t('إغلاق', 'Close')}
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

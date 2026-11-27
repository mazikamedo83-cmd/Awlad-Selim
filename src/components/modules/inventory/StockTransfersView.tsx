import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeftRight,
  Plus,
  CheckCircle2,
  XCircle,
  Send,
  Eye,
  Play,
  Download,
  FileDown,
  Printer,
  FileText,
  AlertCircle,
  Truck,
  Warehouse as WarehouseIcon,
  History,
  RotateCcw,
  ClipboardCheck,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import {
  StockTransferRequest,
  RepItemTransferRequest,
  RepCustodyReturnRequest,
  Invoice,
} from '../../../types';
import { Modal } from '../../common/Modal';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import {
  LinkedGroupCategoryFilter,
  filterProductsByGroupCategory,
  resolveGroupCategoryCascade,
} from '../../common/LinkedGroupCategoryFilter';
import { EditableItemGrid } from '../../common/EditableItemGrid';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import {
  OriginalSourceDocumentModal,
  OriginalSourceDocumentTarget,
} from '../../common/OriginalSourceDocumentModal';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

const TRANSFER_STATUS_META: Record<
  StockTransferRequest['status'],
  { labelAr: string; labelEn: string; cls: string }
> = {
  draft: { labelAr: 'مسودة', labelEn: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  submitted: { labelAr: 'بانتظار الاعتماد', labelEn: 'Pending Approval', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved: { labelAr: 'معتمد (جاهز للتنفيذ)', labelEn: 'Approved (Ready)', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  rejected: { labelAr: 'مرفوض', labelEn: 'Rejected', cls: 'bg-red-100 text-red-800 border-red-300' },
  executed: { labelAr: 'منفذ ومُرحّل', labelEn: 'Executed & Posted', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
};

const REP_ORDER_STATUS_META: Record<string, { labelAr: string; labelEn: string; cls: string }> = {
  pending: { labelAr: 'بانتظار الاعتماد', labelEn: 'Pending Approval', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved: { labelAr: 'معتمد بانتظار الإرسال', labelEn: 'Approved (To Dispatch)', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  executed: { labelAr: 'تم الإرسال وبانتظار استلام المندوب', labelEn: 'Dispatched (Awaiting Rep)', cls: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  received: { labelAr: 'تم الاستلام من المندوب', labelEn: 'Received by Rep', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  rejected: { labelAr: 'مرفوض', labelEn: 'Rejected', cls: 'bg-red-100 text-red-800 border-red-300' },
  cancelled: { labelAr: 'ملغي', labelEn: 'Cancelled', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
};

const CUSTODY_RETURN_STATUS_META: Record<string, { labelAr: string; labelEn: string; cls: string }> = {
  pending: { labelAr: 'بانتظار مراجعة الإدارة', labelEn: 'Pending Admin Review', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  partially_approved: { labelAr: 'معتمد جزئياً', labelEn: 'Partially Approved', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  approved: { labelAr: 'معتمد ومُستلم', labelEn: 'Approved & Received', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  rejected: { labelAr: 'مرفوض', labelEn: 'Rejected', cls: 'bg-red-100 text-red-800 border-red-300' },
  cancelled: { labelAr: 'ملغي', labelEn: 'Cancelled', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
};

function formatDateTimeDisplay(iso: string | undefined | null, isLtr: boolean): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString(isLtr ? 'en-US' : 'ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

interface CreateStockTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (info: { kind: 'rep_order' | 'custody_return' | 'warehouse_order'; number: string }) => void;
}

export const CreateStockTransferModal: React.FC<CreateStockTransferModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const {
    warehouses,
    representatives,
    products,
    productGroups = [],
    categories = [],
    settings,
    createStockTransferRequest,
    submitStockTransferRequest,
    createRepItemTransfer,
    createRepCustodyReturnRequest,
  } = useData();
  const { t, isLtr } = usePreferences();
  const fmt = (n: number) => formatLocaleNumber(n);

  const [sourceMode, setSourceMode] = useState<'warehouse' | 'rep'>('warehouse');
  const [targetMode, setTargetMode] = useState<'warehouse' | 'rep'>('rep');
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [targetWarehouseId, setTargetWarehouseId] = useState('');
  const [sourceRepId, setSourceRepId] = useState('');
  const [targetRepId, setTargetRepId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  // Multi-item picker — zero default 'all' or [0] auto-selections
  const [transferGroupFilter, setTransferGroupFilter] = useState('');
  const [transferCatFilter, setTransferCatFilter] = useState('');
  const [pickedProductId, setPickedProductId] = useState('');
  const [pickedUnitName, setPickedUnitName] = useState('');
  const [pickedUnitFactor, setPickedUnitFactor] = useState<number>(1);
  const [pickedQty, setPickedQty] = useState<number | ''>('');
  const [pickedNotes, setPickedNotes] = useState('');
  const [items, setItems] = useState<
    Array<{
      productId: string;
      productName: string;
      unit: string;
      unitFactor: number;
      requestedQty: number;
      available: number;
      notes: string;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const groupTriggerRef = useRef<HTMLButtonElement | null>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.status !== 'suspended' && !w.name.startsWith('سيارة المندوب')),
    [warehouses]
  );
  const activeReps = useMemo(
    () => representatives.filter((r) => r.status === 'active'),
    [representatives]
  );

  useEffect(() => {
    if (isOpen) {
      setSourceMode('warehouse');
      setTargetMode('rep');
      setSourceWarehouseId('');
      setTargetWarehouseId('');
      setSourceRepId('');
      setTargetRepId('');
      setDate(new Date().toISOString().split('T')[0]);
      setReason('');
      setNotes('');
      setItems([]);
      setTransferGroupFilter('');
      setTransferCatFilter('');
      setPickedProductId('');
      setPickedUnitName('');
      setPickedUnitFactor(1);
      setPickedQty('');
      setPickedNotes('');
      setError(null);
      window.setTimeout(() => searchInputRef.current?.focus(), 60);
    }
  }, [isOpen]);

  // Resolve source warehouse id when in rep mode
  const effectiveSourceWarehouseId = useMemo(() => {
    if (sourceMode === 'warehouse') return sourceWarehouseId;
    const rep = representatives.find((r) => r.id === sourceRepId);
    if (!rep) return '';
    const vanWh = warehouses.find(
      (w) => w.name === `سيارة المندوب (${rep.name})` || w.name.includes(rep.name)
    );
    return vanWh?.id || '';
  }, [sourceMode, sourceWarehouseId, sourceRepId, representatives, warehouses]);

  const filteredTransferProducts = useMemo(
    () =>
      filterProductsByGroupCategory(
        products,
        productGroups,
        categories,
        transferGroupFilter,
        transferCatFilter
      ),
    [products, productGroups, categories, transferGroupFilter, transferCatFilter]
  );

  const pickedProduct = useMemo(
    () => products.find((p) => p.id === pickedProductId) || null,
    [products, pickedProductId]
  );

  const availableUnitsForPicked = useMemo(() => {
    if (!pickedProduct) return [];
    return [
      { name: pickedProduct.baseUnit, factor: 1 },
      ...(pickedProduct.units || []).map((u) => ({
        name: u.name,
        factor: Number(u.conversionFactor) || 1,
      })),
    ];
  }, [pickedProduct]);

  const handleSelectProduct = (prod: (typeof products)[number]) => {
    setPickedProductId(prod.id);
    setPickedUnitName(prod.baseUnit);
    setPickedUnitFactor(1);
    setError(null);
  };

  const handleAddItem = () => {
    setError(null);
    const prod = products.find((p) => p.id === pickedProductId);
    if (!prod) {
      setError(t('يرجى البحث واختيار الصنف أولاً', 'Please search and select a product first'));
      searchInputRef.current?.focus();
      return;
    }
    const qtyVal = Number(pickedQty || 0);
    if (qtyVal <= 0) {
      setError(
        t('يرجى إدخال كمية صالحة أكبر من الصفر', 'Please enter a valid quantity greater than zero')
      );
      qtyInputRef.current?.focus();
      return;
    }

    const available = effectiveSourceWarehouseId
      ? Number(prod.stockPerWarehouse?.[effectiveSourceWarehouseId] || 0)
      : 0;
    const factor = Number(pickedUnitFactor) || 1;
    const requestedBaseQty = qtyVal * factor;
    const alreadyRequestedBase = items
      .filter((it) => it.productId === prod.id)
      .reduce((s, it) => s + it.requestedQty * it.unitFactor, 0);

    if (
      !settings.allowNegativeStock &&
      effectiveSourceWarehouseId &&
      requestedBaseQty + alreadyRequestedBase > available
    ) {
      setError(
        isLtr
          ? `Requested quantity (${fmt(requestedBaseQty + alreadyRequestedBase)} ${t(prod.baseUnit)}) exceeds available balance at source (${fmt(available)} ${t(prod.baseUnit)})`
          : `الكمية المطلوبة (${fmt(requestedBaseQty + alreadyRequestedBase)} ${prod.baseUnit}) تتجاوز الرصيد المتاح بالمصدر (${fmt(available)} ${prod.baseUnit})`
      );
      return;
    }

    const targetUnit = pickedUnitName || prod.baseUnit;
    setItems((prev) => {
      const existingIdx = prev.findIndex(
        (it) => it.productId === prod.id && it.unit === targetUnit
      );
      if (existingIdx >= 0) {
        return prev.map((it, idx) =>
          idx === existingIdx
            ? {
                ...it,
                requestedQty: Number((it.requestedQty + qtyVal).toFixed(4)),
                available,
                notes: pickedNotes.trim() || it.notes,
              }
            : it
        );
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          unit: targetUnit,
          unitFactor: factor,
          requestedQty: qtyVal,
          available,
          notes: pickedNotes.trim(),
        },
      ];
    });
    setPickedProductId('');
    setPickedUnitName('');
    setPickedUnitFactor(1);
    setPickedQty('');
    setPickedNotes('');
    window.setTimeout(() => searchInputRef.current?.focus(), 25);
  };

  const handleSubmit = async (submitNow: boolean) => {
    setError(null);
    const sWh = warehouses.find((w) => w.id === sourceWarehouseId);
    const tWh = warehouses.find((w) => w.id === targetWarehouseId);
    const sRep = representatives.find((r) => r.id === sourceRepId);
    const tRep = representatives.find((r) => r.id === targetRepId);

    if (sourceMode === 'warehouse' && !sWh) {
      setError(t('يرجى اختيار المستودع المصدر', 'Please select a source warehouse'));
      return;
    }
    if (sourceMode === 'rep' && !sRep) {
      setError(t('يرجى اختيار المندوب المصدر', 'Please select a source representative'));
      return;
    }
    if (targetMode === 'warehouse' && !tWh) {
      setError(t('يرجى اختيار المستودع الوجهة', 'Please select a destination warehouse'));
      return;
    }
    if (targetMode === 'rep' && !tRep) {
      setError(t('يرجى اختيار المندوب الوجهة', 'Please select a destination representative'));
      return;
    }
    if (sourceMode === 'warehouse' && targetMode === 'warehouse' && sourceWarehouseId === targetWarehouseId) {
      setError(
        t('يرجى اختيار مستودع مصدر ومستودع وجهة مختلفين', 'Please select different source and destination warehouses')
      );
      return;
    }
    if (sourceMode === 'rep' && targetMode === 'rep' && sourceRepId === targetRepId) {
      setError(
        t('لا يمكن التحويل من سيارة المندوب إلى نفس المندوب', 'Cannot transfer from a rep vehicle to the same rep')
      );
      return;
    }
    if (items.length === 0) {
      setError(
        t('يرجى إضافة صنف واحد على الأقل إلى أمر التحويل', 'Please add at least one item to the transfer order')
      );
      return;
    }

    setIsSubmitting(true);
    try {
      // Case 1 (Unified Single Document Identity): To a Rep -> create ONE RepItemTransferRequest ("أمر تحويل")
      if (targetMode === 'rep' && tRep) {
        const targetVanWh = warehouses.find(
          (w) => w.name === `سيارة المندوب (${tRep.name})` || w.name.includes(tRep.name)
        );
        const srcWh =
          sourceMode === 'warehouse'
            ? sWh
            : warehouses.find((w) => w.id === effectiveSourceWarehouseId);

        const combinedNotes = [reason.trim(), notes.trim()].filter(Boolean).join(' — ');
        const res = await createRepItemTransfer({
          date,
          representativeId: tRep.id,
          representativeName: tRep.name,
          senderRepresentativeId: sourceMode === 'rep' ? sRep?.id : undefined,
          senderRepresentativeName: sourceMode === 'rep' ? sRep?.name : undefined,
          sourceWarehouseId: srcWh?.id || '',
          sourceWarehouseName:
            sourceMode === 'rep'
              ? srcWh?.name || `سيارة المندوب (${sRep?.name})`
              : srcWh?.name || '',
          targetWarehouseId: targetVanWh?.id || '',
          targetWarehouseName: targetVanWh?.name || `سيارة المندوب (${tRep.name})`,
          transferMode: sourceMode === 'rep' ? 'rep_to_rep' : 'custody_dispatch',
          autoDispatch: submitNow,
          notes: combinedNotes || undefined,
          items: items.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            unit: it.unit,
            requestedQty: it.requestedQty,
            availableInVanQty: it.available,
            shortageQty: 0,
            notes: it.notes,
          })),
        } as any);

        if (!res.success) {
          setError(res.error ? t(res.error) : t('تعذر إنشاء أمر التحويل', 'Unable to create transfer order'));
          return;
        }
        onCreated?.({
          kind: 'rep_order',
          number: res.request?.requestNumber || 'RTR',
        });
        onClose();
        return;
      }

      // Case 2: Rep -> Warehouse -> create ONE Custody Return Request
      if (sourceMode === 'rep' && targetMode === 'warehouse' && sRep && tWh) {
        const res = await createRepCustodyReturnRequest({
          representativeId: sRep.id,
          targetWarehouseId: tWh.id,
          date,
          notes: [reason.trim(), notes.trim()].filter(Boolean).join(' — ') || undefined,
          items: items.map((it) => ({
            productId: it.productId,
            unit: it.unit,
            unitFactor: it.unitFactor,
            requestedQty: it.requestedQty,
            notes: it.notes,
          })),
        });
        if (!res.success) {
          setError(res.error ? t(res.error) : t('تعذر إنشاء طلب إرجاع البضاعة', 'Unable to create custody return request'));
          return;
        }
        onCreated?.({
          kind: 'custody_return',
          number: res.request?.requestNumber || 'RET',
        });
        onClose();
        return;
      }

      // Case 3: Warehouse -> Warehouse transfer request
      const res = await createStockTransferRequest({
        sourceWarehouseId,
        targetWarehouseId,
        date,
        reason: reason.trim(),
        notes: notes.trim(),
        transferType: 'warehouse_transfer',
        items: items.map((i) => ({
          productId: i.productId,
          unit: i.unit,
          unitFactor: i.unitFactor,
          requestedQty: i.requestedQty,
          notes: i.notes,
        })),
      });

      if (!res.success || !res.transfer) {
        setError(res.error ? t(res.error) : t('تعذر إنشاء أمر التحويل', 'Unable to create transfer order'));
        return;
      }

      let finalTransfer = res.transfer;
      if (submitNow) {
        const subRes = await submitStockTransferRequest(res.transfer.id);
        if (subRes.success && subRes.transfer) finalTransfer = subRes.transfer;
      }
      onCreated?.({
        kind: 'warehouse_order',
        number: finalTransfer.transferNumber,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const warehouseOptions = useMemo(
    () =>
      (activeWarehouses.length ? activeWarehouses : warehouses).map((w) => ({
        value: w.id,
        label: t(w.name),
      })),
    [activeWarehouses, warehouses, t]
  );

  const repOptions = useMemo(
    () =>
      (activeReps.length ? activeReps : representatives).map((r) => ({
        value: r.id,
        label: r.name,
        subtitle: r.phone || r.code,
      })),
    [activeReps, representatives]
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('إنشاء أمر تحويل جديد', 'Create New Transfer Order')}
      subtitle={t(
        'إنشاء مستند «أمر تحويل» واحد بهوية موحدة يظهر في أوامر التحويل ولدى المندوب وسجل الإرسال والاستلام',
        'Creates a single unified Transfer Order visible across Transfer Orders, Rep Incoming, and Send/Receive Log'
      )}
      maxWidth="4xl"
    >
      <div className="space-y-2 text-xs">
        {error && (
          <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200">
          {/* Source Endpoint */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="font-bold text-slate-800 text-[11px]">{t('المصدر (من):', 'Source (From):')}</label>
              <div className="flex rounded-md overflow-hidden border border-slate-300 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setSourceMode('warehouse')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${sourceMode === 'warehouse' ? 'bg-[#011E58] text-white' : 'bg-white text-slate-600'}`}
                >
                  <WarehouseIcon className="w-3 h-3" />
                  <span>{t('مستودع', 'Warehouse')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('rep')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${sourceMode === 'rep' ? 'bg-[#003589] text-white' : 'bg-white text-slate-600'}`}
                >
                  <Truck className="w-3 h-3" />
                  <span>{t('مندوب', 'Rep')}</span>
                </button>
              </div>
            </div>
            {sourceMode === 'warehouse' ? (
              <SearchableFilterSelect
                value={sourceWarehouseId}
                onChange={setSourceWarehouseId}
                options={warehouseOptions}
                includeAllOption={false}
                minSearchChars={2}
                placeholder={t('اختيار المستودع المصدر...', 'Select source warehouse...')}
                searchPlaceholder={t('اكتب حرفين على الأقل...', 'Type at least 2 chars...')}
              />
            ) : (
              <SearchableFilterSelect
                value={sourceRepId}
                onChange={setSourceRepId}
                options={repOptions}
                includeAllOption={false}
                minSearchChars={2}
                placeholder={t('اختيار المندوب المصدر...', 'Select source rep...')}
                searchPlaceholder={t('اكتب حرفين على الأقل...', 'Type at least 2 chars...')}
              />
            )}
          </div>

          {/* Target Endpoint */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="font-bold text-slate-800 text-[11px]">{t('الوجهة (إلى):', 'Destination (To):')}</label>
              <div className="flex rounded-md overflow-hidden border border-slate-300 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setTargetMode('rep')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${targetMode === 'rep' ? 'bg-[#003589] text-white' : 'bg-white text-slate-600'}`}
                >
                  <Truck className="w-3 h-3" />
                  <span>{t('مندوب', 'Rep')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTargetMode('warehouse')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${targetMode === 'warehouse' ? 'bg-[#011E58] text-white' : 'bg-white text-slate-600'}`}
                >
                  <WarehouseIcon className="w-3 h-3" />
                  <span>{t('مستودع', 'Warehouse')}</span>
                </button>
              </div>
            </div>
            {targetMode === 'warehouse' ? (
              <SearchableFilterSelect
                value={targetWarehouseId}
                onChange={setTargetWarehouseId}
                options={warehouseOptions}
                includeAllOption={false}
                minSearchChars={2}
                placeholder={t('اختيار المستودع الوجهة...', 'Select destination warehouse...')}
                searchPlaceholder={t('اكتب حرفين على الأقل...', 'Type at least 2 chars...')}
              />
            ) : (
              <SearchableFilterSelect
                value={targetRepId}
                onChange={setTargetRepId}
                options={repOptions}
                includeAllOption={false}
                minSearchChars={2}
                placeholder={t('اختيار المندوب المستلم...', 'Select destination rep...')}
                searchPlaceholder={t('اكتب حرفين على الأقل...', 'Type at least 2 chars...')}
              />
            )}
          </div>

          {/* Date */}
          <div className="space-y-1">
            <label className="block font-bold text-slate-800 text-[11px] pt-0.5">{t('تاريخ أمر التحويل:', 'Transfer Order Date:')}</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-mono font-bold"
            />
          </div>
        </div>

        {/* Add Items Row with Live ProductSearchSelect */}
        <div className="p-2 rounded-lg bg-[#EEF3FA] border border-[#DCE6F5] space-y-1.5">
          <LinkedGroupCategoryFilter
            productGroups={productGroups}
            categories={categories}
            selectedGroupId={transferGroupFilter}
            selectedCategoryId={transferCatFilter}
            groupTriggerRef={groupTriggerRef}
            categoryTriggerRef={categoryTriggerRef}
            allowAll={false}
            minSearchChars={2}
            autoAdvanceOnSelect
            onCategoryAfterSelect={() => window.setTimeout(() => searchInputRef.current?.focus(), 20)}
            onFilterChange={(nextGroupId, nextCategoryId) => {
              setTransferGroupFilter(nextGroupId);
              setTransferCatFilter(nextCategoryId);
              const { clearSelectedProduct } = resolveGroupCategoryCascade(
                products,
                productGroups,
                categories,
                nextGroupId,
                nextCategoryId,
                pickedProductId
              );
              if (clearSelectedProduct) {
                setPickedProductId('');
                setPickedUnitName('');
                setPickedUnitFactor(1);
                setPickedQty('');
              }
            }}
            compact
          />
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 items-end">
            <div className="sm:col-span-5">
              <label className="block font-bold text-[11px] mb-0.5 text-[#011E58]">{t('البحث الفوري عن الصنف:', 'Quick Item Search:')}</label>
              <ProductSearchSelect
                products={filteredTransferProducts}
                selectedProductId={pickedProductId}
                onSelect={handleSelectProduct}
                onAfterSelect={() => qtyInputRef.current?.focus()}
                warehouseId={effectiveSourceWarehouseId || undefined}
                warehouses={warehouses}
                currency={t(settings.currency)}
                inputRef={searchInputRef}
                minSearchChars={2}
                placeholder={t('اكتب حرفين على الأقل للبحث...', 'Type at least 2 chars to search...')}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-[11px] mb-0.5 text-blue-950">{t('الوحدة:', 'Unit:')}</label>
              <select
                value={pickedUnitName}
                disabled={!pickedProduct}
                onChange={(e) => {
                  const u = availableUnitsForPicked.find((x) => x.name === e.target.value);
                  setPickedUnitName(e.target.value);
                  setPickedUnitFactor(u?.factor || 1);
                }}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-bold disabled:bg-slate-100"
              >
                {!pickedProduct ? (
                  <option value="">--</option>
                ) : (
                  availableUnitsForPicked.map((u) => (
                    <option key={u.name} value={u.name}>
                      {t(u.name)} {u.factor > 1 ? `(${fmt(u.factor)})` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-[11px] mb-0.5 text-blue-950">{t('الكمية:', 'Quantity:')}</label>
              <input
                ref={qtyInputRef}
                type="number"
                min="0.01"
                step="any"
                value={pickedQty}
                onChange={(e) => setPickedQty(e.target.value === '' ? '' : Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddItem();
                  }
                }}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-mono font-black text-center"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-[11px] mb-0.5 text-blue-950">{t('ملاحظة البند:', 'Item Note:')}</label>
              <input
                type="text"
                value={pickedNotes}
                onChange={(e) => setPickedNotes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddItem();
                  }
                }}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2"
              />
            </div>

            <div className="sm:col-span-1">
              <button
                type="button"
                onClick={handleAddItem}
                className="w-full h-8 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer"
              >
                +
              </button>
            </div>
          </div>
          {pickedProduct && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-blue-950 bg-white/80 px-2.5 py-1 rounded-lg border border-blue-100">
              <span>{t('المختار:', 'Selected:')} <strong>{pickedProduct.name}</strong></span>
              <span>• {t('الكود:', 'Code:')} <strong className="font-mono">{pickedProduct.code}</strong></span>
              <span>
                • {t('المتاح بالمصدر:', 'Source Available:')}{' '}
                <strong className="font-mono text-emerald-700">
                  {fmt(effectiveSourceWarehouseId ? Number(pickedProduct.stockPerWarehouse?.[effectiveSourceWarehouseId] || 0) : 0)} {t(pickedProduct.baseUnit)}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* Editable Transfer Items Grid */}
        <EditableItemGrid
          rows={items.map((it, idx) => ({
            rowKey: `${it.productId}-${it.unit}-${idx}`,
            productId: it.productId,
            productName: it.productName,
            unit: it.unit,
            unitFactor: it.unitFactor,
            quantity: it.requestedQty,
            unitPrice: 0,
            total: 0,
            availableStock: it.available,
            secondaryBadge: it.notes || undefined,
          }))}
          products={products}
          warehouses={warehouses}
          currency={settings.currency}
          priceMode="none"
          showPriceColumns={false}
          showStockColumn
          stockColumnLabel={t('المتاح بالمصدر', 'Source Available')}
          qtyColumnLabel={t('الكمية المطلوبة', 'Requested Qty')}
          allowUnitEdit
          allowQtyEdit
          allowPriceEdit={false}
          recalcPriceOnUnitChange={false}
          onUpdateRow={(idx, patch) => {
            setItems((prev) =>
              prev.map((it, i) => {
                if (i !== idx) return it;
                const prod = products.find((p) => p.id === it.productId);
                const avail =
                  effectiveSourceWarehouseId && prod
                    ? Number(prod.stockPerWarehouse?.[effectiveSourceWarehouseId] || 0)
                    : it.available;
                return {
                  ...it,
                  unit: patch.unit ?? it.unit,
                  unitFactor: patch.unitFactor ?? it.unitFactor,
                  requestedQty:
                    patch.quantity !== undefined ? Math.max(0.001, patch.quantity) : it.requestedQty,
                  available: avail,
                };
              })
            );
          }}
          onDuplicateRow={(idx) => {
            const target = items[idx];
            if (!target) return;
            setItems((prev) => {
              const next = [...prev];
              next.splice(idx + 1, 0, { ...target });
              return next;
            });
          }}
          onDeleteRow={(idx) => setItems((prev) => prev.filter((_, i) => i !== idx))}
          onAddNewItem={() => window.setTimeout(() => searchInputRef.current?.focus(), 20)}
          onGridAdvanceOut={() => window.setTimeout(() => searchInputRef.current?.focus(), 20)}
          maxHeightClass="max-h-56"
          emptyStateText={t('أضف صنفاً واحداً أو أكثر لقائمة التحويل.', 'Add one or more items to the transfer list.')}
          compact
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <div>
            <label className="block font-bold text-[11px] mb-0.5">{t('سبب التحويل:', 'Transfer Reason:')}</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2"
            />
          </div>
          <div>
            <label className="block font-bold text-[11px] mb-0.5">{t('ملاحظات عامة:', 'General Notes:')}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2"
            />
          </div>
        </div>

        <div className="flex justify-end gap-1.5 pt-2 border-t">
          <button type="button" onClick={onClose} className="h-8 px-2.5 border border-slate-300 rounded-md font-bold cursor-pointer">
            {t('إلغاء', 'Cancel')}
          </button>
          {targetMode === 'warehouse' && sourceMode === 'warehouse' && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSubmit(false)}
              className="h-8 px-3 bg-slate-700 hover:bg-slate-800 text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
            >
              {t('حفظ كمسودة', 'Save as Draft')}
            </button>
          )}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(true)}
            className="flex items-center gap-1 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {targetMode === 'rep'
                ? t('إصدار وإرسال أمر التحويل', 'Issue & Send Transfer Order')
                : sourceMode === 'rep'
                ? t('إرسال طلب الإرجاع', 'Submit Return Request')
                : t('حفظ وإرسال للاعتماد', 'Save & Submit for Approval')}
            </span>
          </button>
        </div>
      </div>
    </Modal>
  );
};

interface StockTransfersViewProps {
  onNavigate?: (page: any) => void;
}

export const StockTransfersView: React.FC<StockTransfersViewProps> = ({ onNavigate }) => {
  const {
    stockTransferRequests = [],
    repItemTransfers = [],
    repCustodyReturnRequests = [],
    invoices,
    settings,
    submitStockTransferRequest,
    approveStockTransferRequest,
    rejectStockTransferRequest,
    executeStockTransferRequest,
    updateRepItemTransferStatus,
    approveRepCustodyReturnRequest,
    rejectRepCustodyReturnRequest,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const { registerHandler, consumePendingAction } = useShortcuts();
  const { t, isRtl, isLtr } = usePreferences();
  const fmt = (n: number) => formatLocaleNumber(n);

  const getTransferStatusLabel = (status: StockTransferRequest['status']) => {
    const meta = TRANSFER_STATUS_META[status];
    if (!meta) return status;
    return isLtr ? meta.labelEn : meta.labelAr;
  };

  const getRepOrderStatusMeta = (status: string) => {
    const meta = REP_ORDER_STATUS_META[status] || {
      labelAr: status,
      labelEn: status,
      cls: 'bg-slate-100 text-slate-700 border-slate-200',
    };
    return { label: isLtr ? meta.labelEn : meta.labelAr, cls: meta.cls };
  };

  const getCustodyReturnMeta = (status: string) => {
    const meta = CUSTODY_RETURN_STATUS_META[status] || {
      labelAr: status,
      labelEn: status,
      cls: 'bg-slate-100 text-slate-700 border-slate-200',
    };
    return { label: isLtr ? meta.labelEn : meta.labelAr, cls: meta.cls };
  };

  const canCreate = currentUser?.role === 'admin' || hasPermission('canCreateStockTransfer');
  const canApprove = currentUser?.role === 'admin' || hasPermission('canApproveStockTransfer');
  const canExecute = currentUser?.role === 'admin' || hasPermission('canExecuteStockTransfer');
  const canApproveCustody = currentUser?.role === 'admin' || hasPermission('canApproveRepCustody') || canApprove;

  const [activeSubTab, setActiveSubTab] = useState<'rep_orders' | 'custody_returns' | 'warehouse_orders'>('rep_orders');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [repOrderStatusFilter, setRepOrderStatusFilter] = useState<string>('all');
  const [repOrderSearch, setRepOrderSearch] = useState<string>('');
  const [returnStatusFilter, setReturnStatusFilter] = useState<string>('all');
  const [returnSearch, setReturnSearch] = useState<string>('');

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [activeTransfer, setActiveTransfer] = useState<StockTransferRequest | null>(null);
  const [activeReturnReview, setActiveReturnReview] = useState<RepCustodyReturnRequest | null>(null);
  const [returnReviewRows, setReturnReviewRows] = useState<
    Array<{ productId: string; productName: string; unit: string; requestedQty: number; actualReceivedQty: number; approvedQty: number; rejectionReason: string }>
  >([]);
  const [returnReviewNotes, setReturnReviewNotes] = useState('');
  const [returnRejectReason, setReturnRejectReason] = useState('');

  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [sourceDocTarget, setSourceDocTarget] = useState<OriginalSourceDocumentTarget | null>(null);

  useEffect(() => {
    if (canCreate && consumePendingAction('action:new_stock_transfer')) {
      setIsNewModalOpen(true);
    }
    return registerHandler('action:new_stock_transfer', () => {
      if (canCreate) setIsNewModalOpen(true);
    });
  }, [canCreate, consumePendingAction, registerHandler]);

  const filteredRepOrders = useMemo(() => {
    return repItemTransfers.filter((r) => {
      if (repOrderStatusFilter !== 'all' && r.status !== repOrderStatusFilter) return false;
      if (repOrderSearch.trim()) {
        const q = repOrderSearch.trim().toLowerCase();
        return (
          r.requestNumber.toLowerCase().includes(q) ||
          r.representativeName.toLowerCase().includes(q) ||
          (r.sourceWarehouseName || '').toLowerCase().includes(q) ||
          (r.targetWarehouseName || '').toLowerCase().includes(q) ||
          (r.invoiceNumber || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [repItemTransfers, repOrderStatusFilter, repOrderSearch]);

  const filteredReturnRequests = useMemo(() => {
    return repCustodyReturnRequests.filter((r) => {
      if (returnStatusFilter !== 'all' && r.status !== returnStatusFilter) return false;
      if (returnSearch.trim()) {
        const q = returnSearch.trim().toLowerCase();
        return (
          r.requestNumber.toLowerCase().includes(q) ||
          r.representativeName.toLowerCase().includes(q) ||
          (r.targetWarehouseName || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [repCustodyReturnRequests, returnStatusFilter, returnSearch]);

  const filteredRequests = useMemo(() => {
    return stockTransferRequests.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        return (
          r.transferNumber.toLowerCase().includes(q) ||
          r.sourceWarehouseName.toLowerCase().includes(q) ||
          r.targetWarehouseName.toLowerCase().includes(q) ||
          r.createdBy.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [stockTransferRequests, statusFilter, searchTerm]);

  const openReturnReviewModal = (req: RepCustodyReturnRequest) => {
    setActiveReturnReview(req);
    setReturnReviewRows(
      (req.items || []).map((it) => ({
        productId: it.productId,
        productName: it.productName,
        unit: it.unit,
        requestedQty: Number(it.requestedQty || 0),
        actualReceivedQty: Number(it.actualReceivedQty ?? it.requestedQty ?? 0),
        approvedQty: Number(it.approvedQty ?? it.requestedQty ?? 0),
        rejectionReason: '',
      }))
    );
    setReturnReviewNotes(req.reviewNotes || '');
    setReturnRejectReason('');
    setActionError(null);
  };

  const handleConfirmReturnApprove = async () => {
    if (!activeReturnReview || isActionSubmitting) return;
    setActionError(null);
    setIsActionSubmitting(true);
    try {
      const res = await approveRepCustodyReturnRequest(activeReturnReview.id, {
        items: returnReviewRows.map((r) => ({
          productId: r.productId,
          unit: r.unit,
          actualReceivedQty: Number(r.actualReceivedQty || 0),
          approvedQty: Number(r.approvedQty || 0),
          rejectionReason: r.rejectionReason.trim() || undefined,
        })),
        reviewNotes: returnReviewNotes.trim() || undefined,
      });
      if (!res.success) {
        setActionError(res.error ? t(res.error) : t('تعذر اعتماد طلب الإرجاع', 'Failed to approve return request'));
        return;
      }
      setActiveReturnReview(null);
      setBanner({
        type: 'success',
        text: `${t('تمت مراجعة واعتماد الكميات المستلمة لطلب الإرجاع', 'Reviewed & approved return request')} (${activeReturnReview.requestNumber}).`,
      });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleConfirmReturnReject = async () => {
    if (!activeReturnReview || isActionSubmitting) return;
    if (!returnRejectReason.trim()) {
      setActionError(t('يرجى إدخال سبب الرفض', 'Please enter a rejection reason'));
      return;
    }
    setActionError(null);
    setIsActionSubmitting(true);
    try {
      const res = await rejectRepCustodyReturnRequest(activeReturnReview.id, returnRejectReason.trim());
      if (!res.success) {
        setActionError(res.error ? t(res.error) : t('تعذر رفض طلب الإرجاع', 'Failed to reject return request'));
        return;
      }
      setActiveReturnReview(null);
      setBanner({
        type: 'success',
        text: `${t('تم رفض طلب الإرجاع', 'Return request rejected')} (${activeReturnReview.requestNumber}).`,
      });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleRepOrderStatusChange = async (req: RepItemTransferRequest, newStatus: RepItemTransferRequest['status']) => {
    if (isActionSubmitting) return;
    setIsActionSubmitting(true);
    try {
      const res = await updateRepItemTransferStatus(req.id, newStatus);
      if (!res.success) {
        setBanner({ type: 'error', text: res.error ? t(res.error) : t('تعذر تحديث حالة أمر التحويل', 'Failed to update transfer order status') });
        return;
      }
      setBanner({
        type: 'success',
        text: `${t('تم تحديث حالة أمر التحويل', 'Updated transfer order')} (${req.requestNumber}).`,
      });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handlePrintTransfer = (tr: StockTransferRequest) => {
    const arrow = isRtl ? '←' : '→';
    setPrintData({
      title: `${t('أمر تحويل أصناف بين المستودعات', 'Warehouse Stock Transfer Order')} (${tr.transferNumber})`,
      docNumber: tr.transferNumber,
      docType: t('أمر تحويل', 'Transfer Order'),
      date: tr.date,
      partyName: `${t('من:', 'From:')} ${t(tr.sourceWarehouseName)} ${arrow} ${t('إلى:', 'To:')} ${t(tr.targetWarehouseName)}`,
      warehouseName: t(tr.sourceWarehouseName),
      items: tr.items.map((it) => ({
        name: it.productName,
        unit: t(it.unit),
        quantity: it.requestedQty,
        price: 0,
        total: it.requestedQty,
      })),
      grandTotal: tr.items.reduce((s, it) => s + it.requestedQty, 0),
      notes: `${t('الحالة:', 'Status:')} ${getTransferStatusLabel(tr.status)}${tr.reason ? ` | ${t('السبب:', 'Reason:')} ${tr.reason}` : ''}`,
    });
  };

  const handleExportPdf = (tr: StockTransferRequest) => {
    exportTableToPdf(
      `${t('أمر تحويل أصناف', 'Stock Transfer Order')} (${tr.transferNumber})`,
      [t('م', '#'), t('الصنف', 'Item'), t('الوحدة', 'Unit'), t('المتاح عند الطلب', 'Available at Request'), t('الكمية المحولة', 'Transferred Qty'), t('ملاحظات', 'Notes')],
      tr.items.map((it, idx) => [idx + 1, it.productName, t(it.unit), it.availableQtySnapshot, it.requestedQty, it.notes || '-']),
      {
        companyName: settings.companyName,
        docNumber: tr.transferNumber,
        dateRangeText: tr.date,
        meta: [
          { label: t('من مستودع', 'From Warehouse'), value: t(tr.sourceWarehouseName) },
          { label: t('إلى مستودع', 'To Warehouse'), value: t(tr.targetWarehouseName) },
          { label: t('الحالة', 'Status'), value: getTransferStatusLabel(tr.status) },
          { label: t('المنشئ', 'Created By'), value: tr.createdBy },
        ],
        notes: tr.reason || tr.notes,
      }
    );
  };

  const handleExportAllExcel = () => {
    if (activeSubTab === 'rep_orders') {
      const headers = [
        t('رقم أمر التحويل', 'Transfer Order #'),
        t('التاريخ والإنشاء', 'Created At'),
        t('المندوب', 'Representative'),
        t('المصدر', 'Source'),
        t('الوجهة', 'Destination'),
        t('الأصناف', 'Items'),
        t('الحالة', 'Status'),
        t('تاريخ الإرسال', 'Sent At'),
        t('تاريخ الاستلام', 'Received At'),
      ];
      const rows = filteredRepOrders.map((r) => [
        r.requestNumber,
        formatDateTimeDisplay(r.createdAt, isLtr),
        r.representativeName,
        t(r.sourceWarehouseName),
        t(r.targetWarehouseName),
        r.items.map((i) => `${i.productName} (${i.requestedQty} ${t(i.unit)})`).join(' | '),
        getRepOrderStatusMeta(r.status).label,
        formatDateTimeDisplay(r.sentAt || r.dispatchedAt, isLtr),
        formatDateTimeDisplay(r.receivedAt, isLtr),
      ]);
      exportToExcel(`AWLAD_SELIM_TransferOrders_${new Date().toISOString().split('T')[0]}`, headers, rows);
      return;
    }

    const headers = [
      t('رقم الطلب', 'Order No.'),
      t('التاريخ', 'Date'),
      t('من مستودع', 'From Warehouse'),
      t('إلى مستودع', 'To Warehouse'),
      t('عدد الأصناف', 'Items Count'),
      t('الحالة', 'Status'),
      t('بواسطة', 'Created By'),
      t('السبب', 'Reason'),
    ];
    const rows = filteredRequests.map((r) => [
      r.transferNumber,
      r.date,
      t(r.sourceWarehouseName),
      t(r.targetWarehouseName),
      r.items.length,
      getTransferStatusLabel(r.status),
      r.createdBy,
      r.reason || r.notes || '-',
    ]);
    exportToExcel(`AWLAD_SELIM_WarehouseTransfers_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const runWorkflowAction = async (
    action: () => Promise<{ success: boolean; transfer?: StockTransferRequest; error?: string }>,
    successMsg: string
  ) => {
    if (isActionSubmitting) return;
    setActionError(null);
    setIsActionSubmitting(true);
    try {
      const res = await action();
      if (!res.success) {
        setActionError(res.error ? t(res.error) : t('تعذر تنفيذ الإجراء', 'Unable to execute action'));
        return;
      }
      setActiveTransfer(res.transfer || null);
      setBanner({ type: 'success', text: successMsg });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const pendingReturnsCount = useMemo(
    () => repCustodyReturnRequests.filter((r) => r.status === 'pending').length,
    [repCustodyReturnRequests]
  );

  return (
    <div className="space-y-2">
      {/* Unified Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-xs sm:text-sm font-black text-[#011E58] tracking-tight flex items-center gap-1.5">
            <ArrowLeftRight className="w-4 h-4 text-[#003589]" />
            <span>{t('أوامر التحويل', 'Transfer Orders')}</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            {isLtr
              ? 'Manage Rep Transfer Orders (single document identity), track rep receipt confirmations, review custody return requests, and jump to Send & Receive Log'
              : 'متابعة وتنفيذ دورة أوامر التحويل للمندوبين بهوية مستند واحدة، ومراجعة طلبات إرجاع البضاعة واعتماد الكميات المستلمة'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('refresh-sync')}
              className="flex items-center gap-1 h-8 px-2.5 bg-[#EEF3FA] hover:bg-[#DCE6F5] border border-[#B8CAE8] text-[#011E58] rounded-md text-xs font-bold cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-[#003589]" />
              <span>{t('سجل الإرسال والاستلام', 'Send & Receive Log')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExportAllExcel}
            className="flex items-center gap-1 h-8 px-2.5 border border-slate-300 rounded-md text-xs font-bold hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#003589]" />
            <span>{t('تصدير Excel', 'Export Excel')}</span>
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => setIsNewModalOpen(true)}
              className="flex items-center gap-1 h-8 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('إنشاء أمر تحويل جديد', 'Create Transfer Order')}</span>
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="underline text-[11px] cursor-pointer">
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-1.5 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveSubTab('rep_orders')}
          className={`h-8 px-2.5 rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeSubTab === 'rep_orders'
              ? 'bg-[#011E58] text-white border-[#011E58]'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span>{t('أوامر التحويل للمندوبين', 'Rep Transfer Orders')}</span>
          <span className="font-mono text-[11px] opacity-85">({fmt(repItemTransfers.length)})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('custody_returns')}
          className={`h-8 px-2.5 rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeSubTab === 'custody_returns'
              ? 'bg-[#003589] text-white border-[#003589]'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t('طلبات إرجاع البضاعة من المندوبين', 'Rep Custody Return Requests')}</span>
          <span className="font-mono text-[11px] opacity-85">({fmt(repCustodyReturnRequests.length)})</span>
          {pendingReturnsCount > 0 && (
            <span className="px-1.5 py-0.2 rounded bg-amber-400 text-slate-950 font-mono text-[10px] font-black">
              {fmt(pendingReturnsCount)}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('warehouse_orders')}
          className={`h-8 px-2.5 rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeSubTab === 'warehouse_orders'
              ? 'bg-[#011E58] text-white border-[#011E58]'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <WarehouseIcon className="w-3.5 h-3.5" />
          <span>{t('تحويلات بين المستودعات', 'Warehouse Transfers')}</span>
          <span className="font-mono text-[11px] opacity-85">({fmt(stockTransferRequests.length)})</span>
        </button>
      </div>

      {/* TAB 1: Unified Rep Transfer Orders (Single Document Identity: "أمر تحويل") */}
      {activeSubTab === 'rep_orders' && (
        <UnifiedDataTable<RepItemTransferRequest>
          compact
          title={t('أوامر التحويل المرسلة للمندوبين', 'Rep Transfer Orders')}
          subtitle={`${t('إجمالي الأوامر:', 'Total Orders:')} ${fmt(filteredRepOrders.length)}`}
          data={filteredRepOrders}
          rowKey={(r) => r.id}
          searchValue={repOrderSearch}
          onSearchChange={setRepOrderSearch}
          searchPlaceholder={t('بحث برقم أمر التحويل أو اسم المندوب أو المخزن...', 'Search by order #, rep, or warehouse...')}
          exportFilename="AWLAD_SELIM_RepTransferOrders"
          pdfTitle={t('أوامر التحويل للمندوبين', 'Rep Transfer Orders')}
          defaultPageSize={25}
          emptyTitle={t('لا توجد أوامر تحويل للمندوبين مسجلة بعد', 'No rep transfer orders recorded yet')}
          toolbarFilters={
            <select
              value={repOrderStatusFilter}
              onChange={(e) => setRepOrderStatusFilter(e.target.value)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold"
            >
              <option value="all">{t('كل الحالات', 'All Statuses')}</option>
              <option value="pending">{t('بانتظار الاعتماد', 'Pending Approval')}</option>
              <option value="approved">{t('معتمد بانتظار الإرسال', 'Approved')}</option>
              <option value="executed">{t('تم الإرسال وبانتظار استلام المندوب', 'Dispatched')}</option>
              <option value="received">{t('تم الاستلام من المندوب', 'Received by Rep')}</option>
              <option value="rejected">{t('مرفوض', 'Rejected')}</option>
            </select>
          }
          columns={[
            {
              key: 'requestNumber',
              header: t('رقم أمر التحويل', 'Transfer Order #'),
              sortable: true,
              sortValue: (r) => r.requestNumber,
              exportValue: (r) => r.requestNumber,
              render: (r) => (
                <button
                  type="button"
                  onClick={() =>
                    setSourceDocTarget({
                      docType: 'rep_item_transfer',
                      docId: r.id,
                      docNumber: r.requestNumber,
                    })
                  }
                  className="inline-flex items-center gap-1 font-mono font-black text-[#003589] hover:underline cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{r.requestNumber}</span>
                </button>
              ),
            },
            {
              key: 'createdAt',
              header: t('تاريخ الإنشاء', 'Created At'),
              sortable: true,
              sortValue: (r) => r.createdAt,
              exportValue: (r) => formatDateTimeDisplay(r.createdAt, isLtr),
              render: (r) => (
                <span className="font-mono text-[11px] text-slate-600">
                  {formatDateTimeDisplay(r.createdAt, isLtr)}
                </span>
              ),
            },
            {
              key: 'representativeName',
              header: t('المندوب', 'Representative'),
              sortable: true,
              sortValue: (r) => r.representativeName,
              exportValue: (r) => r.representativeName,
              render: (r) => <span className="font-bold text-[#011E58]">{r.representativeName}</span>,
            },
            {
              key: 'route',
              header: t('المسار', 'Route'),
              exportValue: (r) => `${t(r.sourceWarehouseName)} -> ${t(r.targetWarehouseName)}`,
              render: (r) => (
                <span className="text-[11px] font-semibold">
                  {t(r.sourceWarehouseName)} {isRtl ? '←' : '→'} {t(r.targetWarehouseName)}
                </span>
              ),
            },
            {
              key: 'itemsSummary',
              header: t('الأصناف والكميات', 'Items & Quantities'),
              exportValue: (r) =>
                r.items.map((it) => `${it.productName} (${it.approvedQty ?? it.requestedQty} ${t(it.unit)})`).join('، '),
              render: (r) => (
                <div className="max-w-xs truncate text-[11px] text-slate-700" title={r.items.map((it) => `${it.productName}: ${it.approvedQty ?? it.requestedQty} ${t(it.unit)}`).join('\n')}>
                  <strong className="font-mono text-[#003589]">[{fmt(r.items.length)}]</strong>{' '}
                  {r.items.map((it) => `${it.productName} (${fmt(it.approvedQty ?? it.requestedQty)} ${t(it.unit)})`).join(' · ')}
                </div>
              ),
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              sortable: true,
              sortValue: (r) => r.status,
              exportValue: (r) => getRepOrderStatusMeta(r.status).label,
              render: (r) => {
                const st = getRepOrderStatusMeta(r.status);
                return (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${st.cls}`}>
                    {st.label}
                  </span>
                );
              },
            },
            {
              key: 'sentAt',
              header: t('الإرسال والاستلام', 'Sent / Received'),
              exportValue: (r) =>
                `${formatDateTimeDisplay(r.sentAt || r.dispatchedAt, isLtr)} / ${formatDateTimeDisplay(r.receivedAt, isLtr)}`,
              render: (r) => (
                <div className="text-[10px] font-mono space-y-0.5 text-slate-600">
                  <div>{t('إرسال:', 'Sent:')} {formatDateTimeDisplay(r.sentAt || r.dispatchedAt, isLtr)}</div>
                  <div>{t('استلام:', 'Rec:')} {formatDateTimeDisplay(r.receivedAt, isLtr)}</div>
                  {r.confirmationNotes && (
                    <div className="text-emerald-700 font-sans truncate max-w-[160px]" title={r.confirmationNotes}>
                      {r.confirmationNotes}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
              align: 'center',
              exportValue: () => '',
              render: (r) => (
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setSourceDocTarget({
                        docType: 'rep_item_transfer',
                        docId: r.id,
                        docNumber: r.requestNumber,
                      })
                    }
                    className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 text-[#011E58] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    title={t('فتح المستند الأصلي', 'Open Original Document')}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{t('فتح', 'Open')}</span>
                  </button>
                  {r.invoiceNumber && (
                    <button
                      type="button"
                      onClick={() => {
                        const inv = invoices.find((x) => x.id === r.invoiceId || x.invoiceNumber === r.invoiceNumber);
                        if (inv) setPreviewInvoice(inv);
                      }}
                      className="h-7 px-1.5 rounded bg-blue-50 text-blue-900 text-[10px] font-mono font-bold cursor-pointer"
                      title={t('عرض الفاتورة المرتبطة', 'View Linked Invoice')}
                    >
                      {r.invoiceNumber}
                    </button>
                  )}
                  {r.status === 'pending' && canApprove && (
                    <button
                      type="button"
                      disabled={isActionSubmitting}
                      onClick={() => handleRepOrderStatusChange(r, 'executed')}
                      className="h-7 px-2 rounded bg-[#003589] text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                      title={t('اعتماد وإرسال للمندوب', 'Approve & Dispatch to Rep')}
                    >
                      {t('إرسال', 'Send')}
                    </button>
                  )}
                  {r.status === 'approved' && canExecute && (
                    <button
                      type="button"
                      disabled={isActionSubmitting}
                      onClick={() => handleRepOrderStatusChange(r, 'executed')}
                      className="h-7 px-2 rounded bg-[#003589] text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                    >
                      {t('إرسال للمندوب', 'Dispatch')}
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      {/* TAB 2: Rep Custody Return Requests ("طلبات إرجاع البضاعة") */}
      {activeSubTab === 'custody_returns' && (
        <UnifiedDataTable<RepCustodyReturnRequest>
          compact
          title={t('طلبات إرجاع البضاعة من المندوبين', 'Rep Custody Return Requests')}
          subtitle={`${t('إجمالي الطلبات:', 'Total Requests:')} ${fmt(filteredReturnRequests.length)}`}
          data={filteredReturnRequests}
          rowKey={(r) => r.id}
          searchValue={returnSearch}
          onSearchChange={setReturnSearch}
          searchPlaceholder={t('بحث برقم طلب الإرجاع أو المندوب أو المخزن...', 'Search by return #, rep, or warehouse...')}
          exportFilename="AWLAD_SELIM_CustodyReturns"
          pdfTitle={t('طلبات إرجاع البضاعة من المندوبين', 'Rep Custody Return Requests')}
          defaultPageSize={25}
          emptyTitle={t('لا توجد طلبات إرجاع بضاعة من المناديب', 'No rep custody return requests yet')}
          toolbarFilters={
            <select
              value={returnStatusFilter}
              onChange={(e) => setReturnStatusFilter(e.target.value)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold"
            >
              <option value="all">{t('كل الحالات', 'All Statuses')}</option>
              <option value="pending">{t('بانتظار مراجعة الإدارة', 'Pending Review')}</option>
              <option value="partially_approved">{t('معتمد جزئياً', 'Partially Approved')}</option>
              <option value="approved">{t('معتمد ومُستلم', 'Approved')}</option>
              <option value="rejected">{t('مرفوض', 'Rejected')}</option>
            </select>
          }
          columns={[
            {
              key: 'requestNumber',
              header: t('رقم طلب الإرجاع', 'Return Request #'),
              sortable: true,
              sortValue: (r) => r.requestNumber,
              exportValue: (r) => r.requestNumber,
              render: (r) => (
                <button
                  type="button"
                  onClick={() =>
                    setSourceDocTarget({
                      docType: 'custody_return_request',
                      docId: r.id,
                      docNumber: r.requestNumber,
                    })
                  }
                  className="inline-flex items-center gap-1 font-mono font-black text-[#003589] hover:underline cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{r.requestNumber}</span>
                </button>
              ),
            },
            {
              key: 'representativeName',
              header: t('المندوب', 'Representative'),
              sortable: true,
              sortValue: (r) => r.representativeName,
              exportValue: (r) => r.representativeName,
              render: (r) => <span className="font-bold text-[#011E58]">{r.representativeName}</span>,
            },
            {
              key: 'targetWarehouseName',
              header: t('إلى مستودع', 'Target Warehouse'),
              exportValue: (r) => t(r.targetWarehouseName),
              render: (r) => <span className="font-semibold">{t(r.targetWarehouseName)}</span>,
            },
            {
              key: 'quantities',
              header: t('المطلوب / المستلم / المعتمد / المتبقي', 'Req / Rec / App / Rem'),
              exportValue: (r) => {
                const reqSum = (r.items || []).reduce((s, it) => s + Number(it.requestedQty || 0), 0);
                const recSum = (r.items || []).reduce((s, it) => s + Number(it.actualReceivedQty || 0), 0);
                const appSum = (r.items || []).reduce((s, it) => s + Number(it.approvedQty || 0), 0);
                const remSum = (r.items || []).reduce((s, it) => s + Number(it.remainingCustodyQty || 0), 0);
                return `${reqSum} / ${recSum} / ${appSum} / ${remSum}`;
              },
              render: (r) => {
                const reqSum = (r.items || []).reduce((s, it) => s + Number(it.requestedQty || 0), 0);
                const recSum = (r.items || []).reduce((s, it) => s + Number(it.actualReceivedQty || 0), 0);
                const appSum = (r.items || []).reduce((s, it) => s + Number(it.approvedQty || 0), 0);
                const remSum = (r.items || []).reduce((s, it) => s + Number(it.remainingCustodyQty || 0), 0);
                return (
                  <div className="font-mono text-[11px] space-y-0.5">
                    <div>
                      <span className="text-slate-600">{t('مطلوب:', 'Req:')}</span> <strong>{fmt(reqSum)}</strong>
                      {' · '}
                      <span className="text-blue-700">{t('مستلم:', 'Rec:')}</span> <strong>{fmt(recSum)}</strong>
                    </div>
                    <div>
                      <span className="text-emerald-700">{t('معتمد:', 'App:')}</span> <strong>{fmt(appSum)}</strong>
                      {' · '}
                      <span className="text-amber-700">{t('متبقي عهدة:', 'Rem:')}</span> <strong>{fmt(remSum)}</strong>
                    </div>
                  </div>
                );
              },
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              sortable: true,
              sortValue: (r) => r.status,
              exportValue: (r) => getCustodyReturnMeta(r.status).label,
              render: (r) => {
                const st = getCustodyReturnMeta(r.status);
                return (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${st.cls}`}>
                    {st.label}
                  </span>
                );
              },
            },
            {
              key: 'timestamps',
              header: t('التواريخ (إرسال / مراجعة / اعتماد)', 'Sent / Reviewed / Approved'),
              exportValue: (r) => formatDateTimeDisplay(r.sentAt, isLtr),
              render: (r) => (
                <div className="text-[10px] font-mono text-slate-600 space-y-0.5">
                  <div>{t('إرسال:', 'Sent:')} {formatDateTimeDisplay(r.sentAt, isLtr)}</div>
                  {r.reviewedAt && <div>{t('مراجعة:', 'Rev:')} {formatDateTimeDisplay(r.reviewedAt, isLtr)}</div>}
                  {r.approvedAt && <div>{t('اعتماد:', 'App:')} {formatDateTimeDisplay(r.approvedAt, isLtr)}</div>}
                </div>
              ),
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
              align: 'center',
              exportValue: () => '',
              render: (r) => (
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setSourceDocTarget({
                        docType: 'custody_return_request',
                        docId: r.id,
                        docNumber: r.requestNumber,
                      })
                    }
                    className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 text-[#011E58] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{t('فتح', 'Open')}</span>
                  </button>
                  {r.status === 'pending' && canApproveCustody && (
                    <button
                      type="button"
                      onClick={() => openReturnReviewModal(r)}
                      className="h-7 px-2.5 rounded bg-[#003589] hover:bg-[#011E58] text-white text-[11px] font-black flex items-center gap-1 cursor-pointer"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      <span>{t('مراجعة واعتماد', 'Review & Approve')}</span>
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      {/* TAB 3: Warehouse-to-Warehouse Transfers */}
      {activeSubTab === 'warehouse_orders' && (
        <UnifiedDataTable<StockTransferRequest>
          compact
          title={t('تحويلات الأصناف بين المستودعات', 'Warehouse Stock Transfers')}
          subtitle={`${t('إجمالي الأوامر:', 'Total Orders:')} ${fmt(filteredRequests.length)}`}
          data={filteredRequests}
          rowKey={(tr) => tr.id}
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder={t('بحث برقم التحويل أو اسم المستودع أو المنشئ...', 'Search by transfer #, warehouse, or creator...')}
          exportFilename="AWLAD_SELIM_StockTransfers"
          pdfTitle={t('أوامر تحويل الأصناف بين المستودعات', 'Warehouse Stock Transfer Orders')}
          defaultPageSize={25}
          emptyTitle={t('لا توجد أوامر تحويل بين المستودعات مسجلة بعد', 'No warehouse stock transfer orders recorded yet')}
          toolbarFilters={
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold"
            >
              <option value="all">{t('كل حالات التحويل', 'All Transfer Statuses')}</option>
              <option value="draft">{t('مسودة', 'Draft')}</option>
              <option value="submitted">{t('بانتظار الاعتماد', 'Pending Approval')}</option>
              <option value="approved">{t('معتمد', 'Approved')}</option>
              <option value="executed">{t('منفذ', 'Executed')}</option>
              <option value="rejected">{t('مرفوض', 'Rejected')}</option>
            </select>
          }
          columns={[
            {
              key: 'transferNumber',
              header: t('رقم الطلب', 'Order No.'),
              sortable: true,
              sortValue: (tr) => tr.transferNumber,
              exportValue: (tr) => tr.transferNumber,
              render: (tr) => (
                <button
                  type="button"
                  onClick={() =>
                    setSourceDocTarget({
                      docType: 'stock_transfer_request',
                      docId: tr.id,
                      docNumber: tr.transferNumber,
                    })
                  }
                  className="font-mono font-bold text-blue-900 hover:underline cursor-pointer"
                >
                  {tr.transferNumber}
                </button>
              ),
            },
            {
              key: 'date',
              header: t('التاريخ', 'Date'),
              sortable: true,
              sortValue: (tr) => tr.date,
              exportValue: (tr) => tr.date,
              render: (tr) => <span className="font-mono tabular-nums">{tr.date}</span>,
            },
            {
              key: 'sourceWarehouseName',
              header: t('من مستودع', 'From Warehouse'),
              sortable: true,
              sortValue: (tr) => tr.sourceWarehouseName,
              exportValue: (tr) => t(tr.sourceWarehouseName),
              render: (tr) => <span className="font-bold">{t(tr.sourceWarehouseName)}</span>,
            },
            {
              key: 'targetWarehouseName',
              header: t('إلى مستودع', 'To Warehouse'),
              sortable: true,
              sortValue: (tr) => tr.targetWarehouseName,
              exportValue: (tr) => t(tr.targetWarehouseName),
              render: (tr) => <span className="font-bold text-[#011E58]">{t(tr.targetWarehouseName)}</span>,
            },
            {
              key: 'itemsCount',
              header: t('الأصناف', 'Items'),
              align: 'center',
              sortable: true,
              sortValue: (tr) => tr.items.length,
              exportValue: (tr) => tr.items.length,
              render: (tr) => <span className="font-mono font-bold tabular-nums">{fmt(tr.items.length)}</span>,
            },
            {
              key: 'createdBy',
              header: t('المنشئ', 'Created By'),
              sortable: true,
              sortValue: (tr) => tr.createdBy,
              exportValue: (tr) => tr.createdBy,
              render: (tr) => <span>{tr.createdBy}</span>,
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              sortable: true,
              sortValue: (tr) => tr.status,
              exportValue: (tr) => getTransferStatusLabel(tr.status),
              render: (tr) => {
                const badge = TRANSFER_STATUS_META[tr.status] || TRANSFER_STATUS_META.draft;
                return (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badge.cls}`}>
                    {getTransferStatusLabel(tr.status)}
                  </span>
                );
              },
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
              align: 'center',
              exportValue: () => '',
              render: (tr) => (
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTransfer(tr);
                      setActionError(null);
                      setShowRejectBox(false);
                    }}
                    className="p-1.5 rounded-lg text-blue-900 hover:bg-blue-50 cursor-pointer"
                    title={t('مراجعة وتنفيذ', 'Review & Execute')}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrintTransfer(tr)}
                    className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
                    title={t('طباعة', 'Print')}
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportPdf(tr)}
                    className="p-1.5 rounded-lg text-blue-700 hover:bg-blue-50 cursor-pointer"
                    title={t('تصدير PDF', 'Export PDF')}
                  >
                    <FileDown className="w-4 h-4" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <CreateStockTransferModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreated={(info) => {
          if (info.kind === 'rep_order') setActiveSubTab('rep_orders');
          else if (info.kind === 'custody_return') setActiveSubTab('custody_returns');
          else setActiveSubTab('warehouse_orders');
          setBanner({
            type: 'success',
            text: `${t('تم إنشاء المستند', 'Document created')} (${info.number}) ${t('بنجاح.', 'successfully.')}`,
          });
        }}
      />

      {/* Custody Return Review & Approve Modal */}
      {activeReturnReview && (
        <Modal
          isOpen={Boolean(activeReturnReview)}
          onClose={() => setActiveReturnReview(null)}
          title={`${t('مراجعة واعتماد طلب إرجاع البضاعة', 'Review & Approve Custody Return')} (${activeReturnReview.requestNumber})`}
          subtitle={`${t('المندوب:', 'Rep:')} ${activeReturnReview.representativeName} ${isRtl ? '←' : '→'} ${t(activeReturnReview.targetWarehouseName)}`}
          maxWidth="3xl"
        >
          <div className="space-y-3 text-xs">
            {actionError && (
              <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">
                {actionError}
              </div>
            )}

            <div className="rounded-lg border border-slate-200 overflow-x-auto">
              <table className="w-full text-start border-collapse">
                <thead className="bg-slate-100 text-slate-800 text-[11px]">
                  <tr>
                    <th className="p-2 text-start">{t('الصنف', 'Item')}</th>
                    <th className="p-2 text-center">{t('الوحدة', 'Unit')}</th>
                    <th className="p-2 text-center">{t('المطلوب إرجاعه', 'Requested')}</th>
                    <th className="p-2 text-center">{t('المستلم فعلياً', 'Actual Received')}</th>
                    <th className="p-2 text-center">{t('الكمية المعتمدة', 'Approved Qty')}</th>
                    <th className="p-2 text-center">{t('المرفوض / الفرق', 'Rejected / Diff')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returnReviewRows.map((row, idx) => {
                    const rejected = Math.max(0, Number((row.requestedQty - row.approvedQty).toFixed(4)));
                    return (
                      <tr key={`${row.productId}-${idx}`}>
                        <td className="p-2 font-bold text-slate-900">{row.productName}</td>
                        <td className="p-2 text-center">{t(row.unit)}</td>
                        <td className="p-2 text-center font-mono font-bold">{fmt(row.requestedQty)}</td>
                        <td className="p-2 text-center">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={row.actualReceivedQty}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value || 0));
                              setReturnReviewRows((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, actualReceivedQty: val, approvedQty: Math.min(it.approvedQty, val) } : it
                                )
                              );
                            }}
                            className="w-20 h-7 border border-slate-300 rounded px-1.5 text-center font-mono font-bold"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="number"
                            min={0}
                            max={row.actualReceivedQty}
                            step="any"
                            value={row.approvedQty}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(row.actualReceivedQty, Number(e.target.value || 0)));
                              setReturnReviewRows((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, approvedQty: val } : it))
                              );
                            }}
                            className="w-20 h-7 border border-[#003589] rounded px-1.5 text-center font-mono font-black text-[#003589]"
                          />
                        </td>
                        <td className="p-2 text-center font-mono font-bold text-rose-700">
                          {fmt(rejected)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block font-bold text-[11px] mb-0.5">{t('ملاحظات المراجعة والاعتماد:', 'Review & Approval Notes:')}</label>
                <input
                  type="text"
                  value={returnReviewNotes}
                  onChange={(e) => setReturnReviewNotes(e.target.value)}
                  className="w-full h-8 border border-slate-300 rounded-md px-2"
                />
              </div>
              <div>
                <label className="block font-bold text-[11px] mb-0.5 text-rose-800">{t('سبب الرفض (في حالة رفض الطلب بالكامل):', 'Rejection Reason (if rejecting):')}</label>
                <input
                  type="text"
                  value={returnRejectReason}
                  onChange={(e) => setReturnRejectReason(e.target.value)}
                  className="w-full h-8 border border-rose-200 rounded-md px-2"
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setActiveReturnReview(null)}
                className="h-8 px-3 border border-slate-300 rounded-md font-bold cursor-pointer"
              >
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={isActionSubmitting}
                onClick={handleConfirmReturnReject}
                className="h-8 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
              >
                {t('رفض الطلب', 'Reject Request')}
              </button>
              <button
                type="button"
                disabled={isActionSubmitting}
                onClick={handleConfirmReturnApprove}
                className="flex items-center gap-1 h-8 px-3.5 bg-[#003589] hover:bg-[#011E58] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t('اعتماد الكميات المستلمة', 'Approve Received Quantities')}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Warehouse Detail / Workflow Action Modal */}
      {activeTransfer && (
        <Modal
          isOpen={!!activeTransfer}
          onClose={() => setActiveTransfer(null)}
          title={`${t('تفاصيل أمر التحويل', 'Transfer Order Details')} (${activeTransfer.transferNumber})`}
          subtitle={`${t('من', 'From')} ${t(activeTransfer.sourceWarehouseName)} ${isRtl ? '←' : '→'} ${t('إلى', 'To')} ${t(activeTransfer.targetWarehouseName)}`}
          maxWidth="4xl"
        >
          <div className="space-y-2 text-xs">
            {actionError && (
              <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{actionError}</div>
            )}

            <div className="p-2 rounded-lg bg-slate-50 border flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <span>{t('الحالة:', 'Status:')} <strong>{getTransferStatusLabel(activeTransfer.status)}</strong></span>
                <span>• {t('التاريخ:', 'Date:')} <strong className="font-mono">{activeTransfer.date}</strong></span>
                <span>• {t('المنشئ:', 'Created By:')} <strong>{activeTransfer.createdBy}</strong></span>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => handlePrintTransfer(activeTransfer)}
                  className="h-7 px-2 bg-white border rounded-md text-[11px] font-bold cursor-pointer"
                >
                  {t('طباعة', 'Print')}
                </button>
                <button
                  type="button"
                  onClick={() => handleExportPdf(activeTransfer)}
                  className="h-7 px-2 bg-blue-50 border border-blue-200 text-blue-900 rounded-md text-[11px] font-bold cursor-pointer"
                >
                  PDF
                </button>
              </div>
            </div>

            <UnifiedDataTable
              compact
              searchable={false}
              maxHeightClassName="max-h-64"
              data={activeTransfer.items}
              rowKey={(it) => it.id}
              defaultPageSize={100}
              columns={[
                {
                  key: 'index',
                  header: t('م', '#'),
                  align: 'center',
                  exportValue: (_, idx) => (idx ?? 0) + 1,
                  render: (_, idx) => <span className="font-mono tabular-nums">{fmt(idx + 1)}</span>,
                },
                {
                  key: 'productName',
                  header: t('الصنف', 'Item'),
                  exportValue: (it) => it.productName,
                  render: (it) => <span className="font-bold">{it.productName}</span>,
                },
                {
                  key: 'unit',
                  header: t('الوحدة', 'Unit'),
                  align: 'center',
                  exportValue: (it) => t(it.unit),
                  render: (it) => <span>{t(it.unit)}</span>,
                },
                {
                  key: 'availableQtySnapshot',
                  header: t('المتاح عند الإنشاء', 'Available at Creation'),
                  align: 'center',
                  exportValue: (it) => it.availableQtySnapshot,
                  render: (it) => <span className="font-mono tabular-nums">{fmt(it.availableQtySnapshot)}</span>,
                },
                {
                  key: 'requestedQty',
                  header: t('الكمية المطلوبة', 'Requested Qty'),
                  align: 'center',
                  exportValue: (it) => it.requestedQty,
                  render: (it) => <span className="font-mono font-black text-blue-900 tabular-nums">{fmt(it.requestedQty)}</span>,
                },
                {
                  key: 'notes',
                  header: t('ملاحظة', 'Note'),
                  exportValue: (it) => it.notes || '-',
                  render: (it) => <span className="text-slate-600">{it.notes || '-'}</span>,
                },
              ]}
            />

            {showRejectBox && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 space-y-1.5">
                <label className="block font-bold text-red-900">{t('سبب رفض طلب التحويل:', 'Rejection Reason:')}</label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full h-8 border border-red-300 bg-white rounded-md px-2"
                />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setShowRejectBox(false)} className="h-7 px-2.5 border rounded-md cursor-pointer">
                    {t('تراجع', 'Back')}
                  </button>
                  <button
                    type="button"
                    disabled={isActionSubmitting}
                    onClick={() =>
                      runWorkflowAction(
                        () => rejectStockTransferRequest(activeTransfer.id, rejectReason.trim()),
                        t('تم رفض طلب التحويل دون تعديل المخزون.', 'Transfer request rejected without modifying inventory.')
                      )
                    }
                    className="h-7 px-2.5 bg-red-700 text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
                  >
                    {t('تأكيد الرفض', 'Confirm Rejection')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-1.5 pt-2 border-t">
              {activeTransfer.status === 'draft' && canCreate && (
                <button
                  type="button"
                  disabled={isActionSubmitting}
                  onClick={() =>
                    runWorkflowAction(
                      () => submitStockTransferRequest(activeTransfer.id),
                      `${t('تم إرسال طلب التحويل', 'Transfer request')} (${activeTransfer.transferNumber}) ${t('للاعتماد.', 'submitted for approval.')}`
                    )
                  }
                  className="flex items-center gap-1 h-8 px-2.5 bg-[#011E58] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{t('إرسال للاعتماد', 'Submit for Approval')}</span>
                </button>
              )}

              {(activeTransfer.status === 'submitted' || activeTransfer.status === 'draft') && canApprove && (
                <>
                  <button
                    type="button"
                    disabled={isActionSubmitting}
                    onClick={() => setShowRejectBox(true)}
                    className="flex items-center gap-1 h-8 px-2.5 bg-red-50 border border-red-200 text-red-700 rounded-md font-bold cursor-pointer disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{t('رفض', 'Reject')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isActionSubmitting}
                    onClick={() =>
                      runWorkflowAction(
                        () => approveStockTransferRequest(activeTransfer.id),
                        `${t('تم اعتماد أمر التحويل', 'Transfer order')} (${activeTransfer.transferNumber}) ${t('بنجاح.', 'approved.')}`
                      )
                    }
                    className="flex items-center gap-1 h-8 px-2.5 bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{t('اعتماد الطلب', 'Approve Request')}</span>
                  </button>
                </>
              )}

              {activeTransfer.status === 'approved' && canExecute && (
                <button
                  type="button"
                  disabled={isActionSubmitting}
                  onClick={() =>
                    runWorkflowAction(
                      () => executeStockTransferRequest(activeTransfer.id),
                      `${t('تم تنفيذ التحويل المخزني', 'Stock transfer')} (${activeTransfer.transferNumber}) ${t('وتحديث أرصدة المستودعين.', 'executed and warehouse balances updated.')}`
                    )
                  }
                  className="flex items-center gap-1 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isActionSubmitting ? t('جاري التنفيذ...', 'Executing...') : t('تنفيذ التحويل وتعديل الأرصدة', 'Execute Transfer & Update Stock')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTransfer(null)}
                className="h-8 px-2.5 border rounded-md font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Linked Invoice Preview Modal */}
      {previewInvoice && (
        <Modal
          isOpen={!!previewInvoice}
          onClose={() => setPreviewInvoice(null)}
          title={`${t('الفاتورة المرتبطة', 'Linked Invoice')} (${previewInvoice.invoiceNumber})`}
          maxWidth="2xl"
        >
          <div className="space-y-2 text-xs">
            <div className="p-2 bg-slate-50 rounded-md border grid grid-cols-2 gap-1.5">
              <div>{t('العميل:', 'Customer:')} <strong>{previewInvoice.customerName || t('عام', 'General')}</strong></div>
              <div>{t('التاريخ:', 'Date:')} <strong className="font-mono">{previewInvoice.date}</strong></div>
              <div>{t('المستودع:', 'Warehouse:')} <strong>{t(previewInvoice.warehouseName)}</strong></div>
              <div>{t('الإجمالي:', 'Total:')} <strong className="font-mono text-blue-900">{fmt(previewInvoice.grandTotal)} {t(settings.currency)}</strong></div>
            </div>
            <UnifiedDataTable
              compact
              searchable={false}
              data={previewInvoice.items}
              rowKey={(_, idx) => `${previewInvoice.id}-it-${idx}`}
              defaultPageSize={100}
              columns={[
                {
                  key: 'productName',
                  header: t('الصنف', 'Item'),
                  exportValue: (it) => it.productName,
                  render: (it) => <span className="font-bold">{it.productName}</span>,
                },
                {
                  key: 'unit',
                  header: t('الوحدة', 'Unit'),
                  align: 'center',
                  exportValue: (it) => t(it.unit),
                  render: (it) => <span>{t(it.unit)}</span>,
                },
                {
                  key: 'quantity',
                  header: t('الكمية', 'Quantity'),
                  align: 'center',
                  exportValue: (it) => it.quantity,
                  render: (it) => <span className="font-mono tabular-nums">{fmt(it.quantity)}</span>,
                },
                {
                  key: 'total',
                  header: t('الإجمالي', 'Total'),
                  align: 'center',
                  exportValue: (it) => it.total,
                  render: (it) => <span className="font-mono font-bold tabular-nums">{fmt(it.total)}</span>,
                },
              ]}
            />
          </div>
        </Modal>
      )}

      <OriginalSourceDocumentModal target={sourceDocTarget} onClose={() => setSourceDocTarget(null)} />
      <PrintDocumentModal isOpen={!!printData} onClose={() => setPrintData(null)} data={printData} />
    </div>
  );
};

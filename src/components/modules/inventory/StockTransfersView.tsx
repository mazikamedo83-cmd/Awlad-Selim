import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeftRight, Plus, CheckCircle2, XCircle, Send, Eye, Play,
  Trash2, Download, FileDown, Printer, FileText, AlertCircle, Truck, Warehouse as WarehouseIcon
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { StockTransferRequest, Invoice } from '../../../types';
import { Modal } from '../../common/Modal';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { LinkedGroupCategoryFilter, filterProductsByGroupCategory } from '../../common/LinkedGroupCategoryFilter';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

const TRANSFER_STATUS_META: Record<StockTransferRequest['status'], { labelAr: string; labelEn: string; cls: string }> = {
  draft: { labelAr: 'مسودة', labelEn: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  submitted: { labelAr: 'بانتظار الاعتماد', labelEn: 'Pending Approval', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved: { labelAr: 'معتمد (جاهز للتنفيذ)', labelEn: 'Approved (Ready)', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  rejected: { labelAr: 'مرفوض', labelEn: 'Rejected', cls: 'bg-red-100 text-red-800 border-red-300' },
  executed: { labelAr: 'منفذ ومُرحّل', labelEn: 'Executed & Posted', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
};

interface CreateStockTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (transfer: StockTransferRequest) => void;
}

export const CreateStockTransferModal: React.FC<CreateStockTransferModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const { warehouses, representatives, products, productGroups = [], categories = [], settings, createStockTransferRequest, submitStockTransferRequest } = useData();
  const { t, isLtr, locale } = usePreferences();
  const fmt = (n: number) => formatLocaleNumber(n);
  const [sourceMode, setSourceMode] = useState<'warehouse' | 'rep'>('warehouse');
  const [targetMode, setTargetMode] = useState<'warehouse' | 'rep'>('warehouse');
  const [sourceWarehouseId, setSourceWarehouseId] = useState(warehouses[0]?.id || '');
  const [targetWarehouseId, setTargetWarehouseId] = useState(warehouses[1]?.id || warehouses[0]?.id || '');
  const [sourceRepId, setSourceRepId] = useState(representatives[0]?.id || '');
  const [targetRepId, setTargetRepId] = useState(representatives[0]?.id || '');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  // Multi-item picker
  const [transferGroupFilter, setTransferGroupFilter] = useState('all');
  const [transferCatFilter, setTransferCatFilter] = useState('all');
  const [pickedProductId, setPickedProductId] = useState('');
  const [pickedUnitName, setPickedUnitName] = useState('');
  const [pickedUnitFactor, setPickedUnitFactor] = useState<number>(1);
  const [pickedQty, setPickedQty] = useState<number | ''>('');
  const [pickedNotes, setPickedNotes] = useState('');
  const [items, setItems] = useState<Array<{
    productId: string;
    productName: string;
    unit: string;
    unitFactor: number;
    requestedQty: number;
    available: number;
    notes: string;
  }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);

  const activeWarehouses = useMemo(() => warehouses.filter((w) => w.status !== 'suspended'), [warehouses]);
  const activeReps = useMemo(() => representatives.filter((r) => r.status === 'active'), [representatives]);

  useEffect(() => {
    if (isOpen) {
      setSourceMode('warehouse');
      setTargetMode('warehouse');
      setSourceWarehouseId(activeWarehouses[0]?.id || warehouses[0]?.id || '');
      setTargetWarehouseId((activeWarehouses[1] || activeWarehouses[0] || warehouses[0])?.id || '');
      setSourceRepId(activeReps[0]?.id || representatives[0]?.id || '');
      setTargetRepId(activeReps[0]?.id || representatives[0]?.id || '');
      setDate(new Date().toISOString().split('T')[0]);
      setReason('');
      setNotes('');
      setItems([]);
      setTransferGroupFilter('all');
      setTransferCatFilter('all');
      setPickedProductId('');
      setPickedUnitName('');
      setPickedUnitFactor(1);
      setPickedQty('');
      setPickedNotes('');
      setError(null);
      window.setTimeout(() => searchInputRef.current?.focus(), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!sourceWarehouseId && (activeWarehouses[0]?.id || warehouses[0]?.id)) {
      setSourceWarehouseId(activeWarehouses[0]?.id || warehouses[0]?.id || '');
    }
    if (!targetWarehouseId && ((activeWarehouses[1] || activeWarehouses[0] || warehouses[0])?.id)) {
      setTargetWarehouseId((activeWarehouses[1] || activeWarehouses[0] || warehouses[0])?.id || '');
    }
    if (!sourceRepId && (activeReps[0]?.id || representatives[0]?.id)) {
      setSourceRepId(activeReps[0]?.id || representatives[0]?.id || '');
    }
    if (!targetRepId && (activeReps[0]?.id || representatives[0]?.id)) {
      setTargetRepId(activeReps[0]?.id || representatives[0]?.id || '');
    }
  }, [isOpen, sourceWarehouseId, targetWarehouseId, sourceRepId, targetRepId, activeWarehouses, activeReps, warehouses, representatives]);

  // Resolve source warehouse id when in rep mode (if a van warehouse already exists)
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
    () => filterProductsByGroupCategory(products, productGroups, categories, transferGroupFilter, transferCatFilter),
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
      ...(pickedProduct.units || []).map((u) => ({ name: u.name, factor: Number(u.conversionFactor) || 1 })),
    ];
  }, [pickedProduct]);

  const handleSelectProduct = (prod: typeof products[number]) => {
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
      setError(t('يرجى إدخال كمية صالحة أكبر من الصفر', 'Please enter a valid quantity greater than zero'));
      qtyInputRef.current?.focus();
      return;
    }

    const available = effectiveSourceWarehouseId ? Number(prod.stockPerWarehouse?.[effectiveSourceWarehouseId] || 0) : 0;
    const factor = Number(pickedUnitFactor) || 1;
    const requestedBaseQty = qtyVal * factor;
    const alreadyRequestedBase = items
      .filter((it) => it.productId === prod.id)
      .reduce((s, it) => s + it.requestedQty * it.unitFactor, 0);

    if (!settings.allowNegativeStock && effectiveSourceWarehouseId && requestedBaseQty + alreadyRequestedBase > available) {
      setError(
        isLtr
          ? `Requested quantity (${fmt(requestedBaseQty + alreadyRequestedBase)} ${t(prod.baseUnit)}) exceeds available balance at source (${fmt(available)} ${t(prod.baseUnit)})`
          : `الكمية المطلوبة (${fmt(requestedBaseQty + alreadyRequestedBase)} ${prod.baseUnit}) تتجاوز الرصيد المتاح بالمصدر (${fmt(available)} ${prod.baseUnit})`
      );
      return;
    }

    const targetUnit = pickedUnitName || prod.baseUnit;
    setItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.productId === prod.id && it.unit === targetUnit);
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
    const sRep = representatives.find((r) => r.id === sourceRepId);
    const tRep = representatives.find((r) => r.id === targetRepId);

    if (sourceMode === 'warehouse' && !sourceWarehouseId) {
      setError(t('يرجى اختيار المستودع المصدر', 'Please select a source warehouse'));
      return;
    }
    if (sourceMode === 'rep' && !sRep) {
      setError(t('يرجى اختيار المندوب المصدر', 'Please select a source representative'));
      return;
    }
    if (targetMode === 'warehouse' && !targetWarehouseId) {
      setError(t('يرجى اختيار المستودع الوجهة', 'Please select a destination warehouse'));
      return;
    }
    if (targetMode === 'rep' && !tRep) {
      setError(t('يرجى اختيار المندوب الوجهة', 'Please select a destination representative'));
      return;
    }
    if (sourceMode === 'warehouse' && targetMode === 'warehouse' && sourceWarehouseId === targetWarehouseId) {
      setError(t('يرجى اختيار مستودع مصدر ومستودع وجهة مختلفين', 'Please select different source and destination warehouses'));
      return;
    }
    if (sourceMode === 'rep' && targetMode === 'rep' && sourceRepId === targetRepId) {
      setError(t('لا يمكن التحويل من سيارة المندوب إلى نفس المندوب', 'Cannot transfer from a rep vehicle to the same rep'));
      return;
    }
    if (items.length === 0) {
      setError(t('يرجى إضافة صنف واحد على الأقل إلى طلب التحويل', 'Please add at least one item to the transfer request'));
      return;
    }

    const transferType =
      sourceMode === 'rep' || targetMode === 'rep' ? 'rep_van_transfer' : 'warehouse_transfer';

    setIsSubmitting(true);
    const res = await createStockTransferRequest({
      sourceWarehouseId: sourceMode === 'warehouse' ? sourceWarehouseId : undefined,
      targetWarehouseId: targetMode === 'warehouse' ? targetWarehouseId : undefined,
      sourceRepId: sourceMode === 'rep' ? sRep?.id : undefined,
      sourceRepName: sourceMode === 'rep' ? sRep?.name : undefined,
      targetRepId: targetMode === 'rep' ? tRep?.id : undefined,
      targetRepName: targetMode === 'rep' ? tRep?.name : undefined,
      date,
      reason: reason.trim(),
      notes: notes.trim(),
      transferType,
      items: items.map((i) => ({
        productId: i.productId,
        unit: i.unit,
        unitFactor: i.unitFactor,
        requestedQty: i.requestedQty,
        notes: i.notes,
      })),
    });

    if (!res.success || !res.transfer) {
      setIsSubmitting(false);
      setError(res.error ? t(res.error) : t('تعذر إنشاء طلب التحويل', 'Unable to create transfer request'));
      return;
    }

    let finalTransfer = res.transfer;
    if (submitNow) {
      const subRes = await submitStockTransferRequest(res.transfer.id);
      if (subRes.success && subRes.transfer) finalTransfer = subRes.transfer;
    }
    setIsSubmitting(false);
    if (onCreated) onCreated(finalTransfer);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('إنشاء أمر تحويل أصناف متعدد البنود (مستودعات / سيارات المناديب)', 'Create Multi-Item Stock Transfer Order (Warehouses / Rep Vehicles)')}
      subtitle={t('يدعم التحويل بين المستودعات أو إلى/من سيارات المناديب — ولا يتأثر المخزون الفعلي إلا بعد الاعتماد والتنفيذ', 'Supports transfers between warehouses or to/from rep vehicles — inventory updates only upon approval & execution')}
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
                  <span>{t('سيارة مندوب', 'Rep Vehicle')}</span>
                </button>
              </div>
            </div>
            {sourceMode === 'warehouse' ? (
              <select
                value={sourceWarehouseId}
                onChange={(e) => setSourceWarehouseId(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-bold"
              >
                {(activeWarehouses.length ? activeWarehouses : warehouses).map((w) => (
                  <option key={w.id} value={w.id}>{t(w.name)}</option>
                ))}
              </select>
            ) : (
              <select
                value={sourceRepId}
                onChange={(e) => setSourceRepId(e.target.value)}
                className="w-full h-8 bg-white border border-[#B8CAE8] rounded-md px-2 font-bold text-[#011E58]"
              >
                {(activeReps.length ? activeReps : representatives).map((r) => (
                  <option key={r.id} value={r.id}>{t('سيارة المندوب:', 'Rep Vehicle:')} {r.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Target Endpoint */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="font-bold text-slate-800 text-[11px]">{t('الوجهة (إلى):', 'Destination (To):')}</label>
              <div className="flex rounded-md overflow-hidden border border-slate-300 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setTargetMode('warehouse')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${targetMode === 'warehouse' ? 'bg-[#011E58] text-white' : 'bg-white text-slate-600'}`}
                >
                  <WarehouseIcon className="w-3 h-3" />
                  <span>{t('مستودع', 'Warehouse')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTargetMode('rep')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${targetMode === 'rep' ? 'bg-[#003589] text-white' : 'bg-white text-slate-600'}`}
                >
                  <Truck className="w-3 h-3" />
                  <span>{t('سيارة مندوب', 'Rep Vehicle')}</span>
                </button>
              </div>
            </div>
            {targetMode === 'warehouse' ? (
              <select
                value={targetWarehouseId}
                onChange={(e) => setTargetWarehouseId(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-bold"
              >
                {(activeWarehouses.length ? activeWarehouses : warehouses).map((w) => (
                  <option key={w.id} value={w.id}>{t(w.name)}</option>
                ))}
              </select>
            ) : (
              <select
                value={targetRepId}
                onChange={(e) => setTargetRepId(e.target.value)}
                className="w-full h-8 bg-white border border-[#B8CAE8] rounded-md px-2 font-bold text-[#011E58]"
              >
                {(activeReps.length ? activeReps : representatives).map((r) => (
                  <option key={r.id} value={r.id}>{t('سيارة المندوب:', 'Rep Vehicle:')} {r.name}</option>
                ))}
              </select>
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
            onGroupChange={setTransferGroupFilter}
            onCategoryChange={setTransferCatFilter}
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
                placeholder={t('اكتب اسم الصنف أو الكود أو الباركود...', 'Type item name, code, or barcode...')}
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

        {/* Added items table */}
        <div className="border border-slate-200 rounded-lg awlad-table-scroll max-h-56 overflow-y-auto">
          <table className="w-full text-start text-[11px]">
            <thead className="bg-slate-100 text-slate-700 font-bold border-b">
              <tr>
                <th className="p-1.5">{t('م', '#')}</th>
                <th className="p-1.5">{t('الصنف', 'Item')}</th>
                <th className="p-1.5 text-center">{t('المتاح بالمصدر', 'Source Available')}</th>
                <th className="p-1.5 text-center">{t('الكمية المطلوبة', 'Requested Qty')}</th>
                <th className="p-1.5">{t('ملاحظة', 'Note')}</th>
                <th className="p-1.5 text-center">{t('حذف', 'Delete')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-3 text-center text-slate-400">
                    {t('أضف صنفاً واحداً أو أكثر لقائمة التحويل.', 'Add one or more items to the transfer list.')}
                  </td>
                </tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="p-1.5 text-slate-500 font-mono">{fmt(idx + 1)}</td>
                    <td className="p-1.5 font-bold">{it.productName}</td>
                    <td className="p-1.5 text-center font-mono">{fmt(it.available)} {t(it.unit)}</td>
                    <td className="p-1.5 text-center font-mono font-black text-blue-900">{fmt(it.requestedQty)} {t(it.unit)}</td>
                    <td className="p-1.5 text-slate-500">{it.notes || '-'}</td>
                    <td className="p-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-red-600 hover:text-red-800 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

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
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(false)}
            className="h-8 px-3 bg-slate-700 hover:bg-slate-800 text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
          >
            {t('حفظ كمسودة', 'Save as Draft')}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(true)}
            className="flex items-center gap-1 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{t('حفظ وإرسال للاعتماد', 'Save & Submit for Approval')}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};

export const StockTransfersView: React.FC = () => {
  const {
    stockTransferRequests = [],
    repItemTransfers = [],
    invoices,
    settings,
    submitStockTransferRequest,
    approveStockTransferRequest,
    rejectStockTransferRequest,
    executeStockTransferRequest,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const { registerHandler, consumePendingAction } = useShortcuts();
  const { t, isRtl, isLtr, locale } = usePreferences();
  const fmt = (n: number) => formatLocaleNumber(n);
  const getTransferStatusLabel = (status: StockTransferRequest['status']) => {
    const meta = TRANSFER_STATUS_META[status];
    if (!meta) return status;
    return isLtr ? meta.labelEn : meta.labelAr;
  };

  const canCreate = currentUser?.role === 'admin' || hasPermission('canCreateStockTransfer');
  const canApprove = currentUser?.role === 'admin' || hasPermission('canApproveStockTransfer');
  const canExecute = currentUser?.role === 'admin' || hasPermission('canExecuteStockTransfer');

  const [activeSubTab, setActiveSubTab] = useState<'warehouse_orders' | 'rep_invoice_custody'>('warehouse_orders');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [activeTransfer, setActiveTransfer] = useState<StockTransferRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [printData, setPrintData] = useState<PrintData | null>(null);

  useEffect(() => {
    if (canCreate && consumePendingAction('action:new_stock_transfer')) {
      setIsNewModalOpen(true);
    }
    return registerHandler('action:new_stock_transfer', () => {
      if (canCreate) setIsNewModalOpen(true);
    });
  }, [canCreate, consumePendingAction, registerHandler]);

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

  const handlePrintTransfer = (tr: StockTransferRequest) => {
    const arrow = isRtl ? '←' : '→';
    setPrintData({
      title: `${t('أمر تحويل أصناف بين المستودعات', 'Warehouse Stock Transfer Order')} (${tr.transferNumber})`,
      docNumber: tr.transferNumber,
      docType: t('إيصال استلام', 'Receipt'),
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
    exportToExcel(`${t('أوامر_تحويل_الأصناف', 'Stock_Transfers')}_${new Date().toISOString().split('T')[0]}`, headers, rows);
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

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-xs sm:text-sm font-black text-[#011E58] tracking-tight flex items-center gap-1.5">
            <ArrowLeftRight className="w-4 h-4 text-[#003589]" />
            <span>{t('نظام تحويل الأصناف بين المستودعات وعهدة المناديب', 'Stock Transfers Between Warehouses & Rep Custody')}</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            {isLtr
              ? 'Manage multi-item transfer orders (Create → Submit → Approve → Execute), completely separated from invoice-linked rep custody transfers'
              : 'إدارة أوامر التحويل متعددة الأصناف (إنشاء ← إرسال ← اعتماد ← تنفيذ) مع فصل كامل عن تحويلات عهدة المندوب المرتبطة بالفواتير'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
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
              <span>{t('إنشاء أمر تحويل أصناف', 'Create Transfer Order')}</span>
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

      {/* Sub-tabs clearly separating Warehouse Transfers from Rep Invoice Custody */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-1.5 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveSubTab('warehouse_orders')}
          className={`h-8 px-2.5 rounded-md border transition-colors cursor-pointer ${
            activeSubTab === 'warehouse_orders'
              ? 'bg-[#011E58] text-white border-[#011E58]'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {t('تحويلات الأصناف بين المستودعات', 'Warehouse Stock Transfers')} ({fmt(stockTransferRequests.length)})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('rep_invoice_custody')}
          className={`h-8 px-2.5 rounded-md border transition-colors cursor-pointer ${
            activeSubTab === 'rep_invoice_custody'
              ? 'bg-[#003589] text-white border-[#003589]'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {t('تحويلات المندوبين المرتبطة بالفواتير', 'Invoice-Linked Rep Transfers')} ({fmt(repItemTransfers.length)})
        </button>
      </div>

      {activeSubTab === 'warehouse_orders' ? (
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
          emptyTitle={t('لا توجد أوامر تحويل أصناف مسجلة بعد', 'No stock transfer orders recorded yet')}
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
              render: (tr) => <span className="font-mono font-bold text-blue-900">{tr.transferNumber}</span>,
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
      ) : (
        /* Rep Item Transfers clearly linked to Invoices */
        <UnifiedDataTable
          compact
          title={t('تحويلات المندوبين المرتبطة بالفواتير', 'Invoice-Linked Rep Transfers')}
          subtitle={`${t('إجمالي التحويلات:', 'Total Transfers:')} ${fmt(repItemTransfers.length)}`}
          data={repItemTransfers}
          rowKey={(r) => r.id}
          searchPlaceholder={t('بحث برقم الطلب أو المندوب أو الفاتورة...', 'Search by order #, rep, or invoice...')}
          exportFilename="AWLAD_SELIM_RepItemTransfers"
          pdfTitle={t('تحويلات عهدة المندوبين المرتبطة بالفواتير', 'Invoice-Linked Rep Custody Transfers')}
          defaultPageSize={25}
          emptyTitle={t('لا توجد طلبات تحويل عهدة مناديب مرتبطة بالفواتير', 'No invoice-linked rep custody transfer requests')}
          columns={[
            {
              key: 'requestNumber',
              header: t('رقم الطلب', 'Order No.'),
              sortable: true,
              sortValue: (r) => r.requestNumber,
              exportValue: (r) => r.requestNumber,
              render: (r) => <span className="font-mono font-bold text-amber-900">{r.requestNumber}</span>,
            },
            {
              key: 'representativeName',
              header: t('المندوب', 'Representative'),
              sortable: true,
              sortValue: (r) => r.representativeName,
              exportValue: (r) => r.representativeName,
              render: (r) => <span className="font-bold">{r.representativeName}</span>,
            },
            {
              key: 'invoiceNumber',
              header: t('الفاتورة المرتبطة', 'Linked Invoice'),
              sortable: true,
              sortValue: (r) => r.invoiceNumber || '',
              exportValue: (r) => r.invoiceNumber || t('عهدة عامة', 'General Custody'),
              render: (r) => {
                const linkedInv = invoices.find((inv) => inv.id === r.invoiceId || inv.invoiceNumber === r.invoiceNumber);
                return r.invoiceNumber ? (
                  <button
                    type="button"
                    onClick={() => linkedInv && setPreviewInvoice(linkedInv)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 font-mono font-bold hover:bg-blue-100 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{r.invoiceNumber}</span>
                  </button>
                ) : (
                  <span className="text-slate-400">{t('عهدة عامة', 'General Custody')}</span>
                );
              },
            },
            {
              key: 'sourceWarehouseName',
              header: t('من مستودع', 'From Warehouse'),
              sortable: true,
              sortValue: (r) => r.sourceWarehouseName,
              exportValue: (r) => t(r.sourceWarehouseName),
              render: (r) => <span>{t(r.sourceWarehouseName)}</span>,
            },
            {
              key: 'targetWarehouseName',
              header: t('إلى سيارة المندوب', 'To Rep Vehicle'),
              sortable: true,
              sortValue: (r) => r.targetWarehouseName,
              exportValue: (r) => t(r.targetWarehouseName),
              render: (r) => <span className="font-semibold">{t(r.targetWarehouseName)}</span>,
            },
            {
              key: 'itemsCount',
              header: t('الأصناف', 'Items'),
              align: 'center',
              sortable: true,
              sortValue: (r) => r.items.length,
              exportValue: (r) => r.items.length,
              render: (r) => <span className="font-mono font-bold tabular-nums">{fmt(r.items.length)}</span>,
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              sortable: true,
              sortValue: (r) => r.status,
              exportValue: (r) => t(r.status),
              render: (r) => (
                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-bold border border-slate-200">
                  {t(r.status)}
                </span>
              ),
            },
          ]}
        />
      )}

      <CreateStockTransferModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreated={(tr) =>
          setBanner({
            type: 'success',
            text: `${t('تم إنشاء أمر التحويل', 'Transfer order')} (${tr.transferNumber}) ${t('بنجاح.', 'created successfully.')}`,
          })
        }
      />

      {/* Detail / Workflow Action Modal */}
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

      <PrintDocumentModal isOpen={!!printData} onClose={() => setPrintData(null)} data={printData} />
    </div>
  );
};

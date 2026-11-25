import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeftRight, Plus, CheckCircle2, XCircle, Send, Eye, Play,
  Trash2, Download, FileDown, Printer, FileText, AlertCircle, Truck, Warehouse as WarehouseIcon
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { StockTransferRequest, Invoice } from '../../../types';
import { Modal } from '../../common/Modal';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

const TRANSFER_STATUS_META: Record<StockTransferRequest['status'], { label: string; cls: string }> = {
  draft: { label: 'مسودة', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  submitted: { label: 'بانتظار الاعتماد', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved: { label: 'معتمد (جاهز للتنفيذ)', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  rejected: { label: 'مرفوض', cls: 'bg-red-100 text-red-800 border-red-300' },
  executed: { label: 'منفذ ومُرحّل', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
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
  const { warehouses, representatives, products, settings, createStockTransferRequest, submitStockTransferRequest } = useData();
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
      setError('يرجى البحث واختيار الصنف أولاً');
      searchInputRef.current?.focus();
      return;
    }
    const qtyVal = Number(pickedQty || 0);
    if (qtyVal <= 0) {
      setError('يرجى إدخال كمية صالحة أكبر من الصفر');
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
      setError(`الكمية المطلوبة (${requestedBaseQty + alreadyRequestedBase} ${prod.baseUnit}) تتجاوز الرصيد المتاح بالمصدر (${available} ${prod.baseUnit})`);
      return;
    }

    setItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        unit: pickedUnitName || prod.baseUnit,
        unitFactor: factor,
        requestedQty: qtyVal,
        available,
        notes: pickedNotes.trim(),
      },
    ]);
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
      setError('يرجى اختيار المستودع المصدر');
      return;
    }
    if (sourceMode === 'rep' && !sRep) {
      setError('يرجى اختيار المندوب المصدر');
      return;
    }
    if (targetMode === 'warehouse' && !targetWarehouseId) {
      setError('يرجى اختيار المستودع الوجهة');
      return;
    }
    if (targetMode === 'rep' && !tRep) {
      setError('يرجى اختيار المندوب الوجهة');
      return;
    }
    if (sourceMode === 'warehouse' && targetMode === 'warehouse' && sourceWarehouseId === targetWarehouseId) {
      setError('يرجى اختيار مستودع مصدر ومستودع وجهة مختلفين');
      return;
    }
    if (sourceMode === 'rep' && targetMode === 'rep' && sourceRepId === targetRepId) {
      setError('لا يمكن التحويل من سيارة المندوب إلى نفس المندوب');
      return;
    }
    if (items.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل إلى طلب التحويل');
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
      setError(res.error || 'تعذر إنشاء طلب التحويل');
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
      title="إنشاء أمر تحويل أصناف متعدد البنود (مستودعات / سيارات المناديب)"
      subtitle="يدعم التحويل بين المستودعات أو إلى/من سيارات المناديب — ولا يتأثر المخزون الفعلي إلا بعد الاعتماد والتنفيذ"
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
              <label className="font-bold text-slate-800 text-[11px]">المصدر (من):</label>
              <div className="flex rounded-md overflow-hidden border border-slate-300 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setSourceMode('warehouse')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${sourceMode === 'warehouse' ? 'bg-[#011E58] text-white' : 'bg-white text-slate-600'}`}
                >
                  <WarehouseIcon className="w-3 h-3" />
                  <span>مستودع</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('rep')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${sourceMode === 'rep' ? 'bg-[#003589] text-white' : 'bg-white text-slate-600'}`}
                >
                  <Truck className="w-3 h-3" />
                  <span>سيارة مندوب</span>
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
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            ) : (
              <select
                value={sourceRepId}
                onChange={(e) => setSourceRepId(e.target.value)}
                className="w-full h-8 bg-white border border-[#B8CAE8] rounded-md px-2 font-bold text-[#011E58]"
              >
                {(activeReps.length ? activeReps : representatives).map((r) => (
                  <option key={r.id} value={r.id}>سيارة المندوب: {r.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Target Endpoint */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="font-bold text-slate-800 text-[11px]">الوجهة (إلى):</label>
              <div className="flex rounded-md overflow-hidden border border-slate-300 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setTargetMode('warehouse')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${targetMode === 'warehouse' ? 'bg-[#011E58] text-white' : 'bg-white text-slate-600'}`}
                >
                  <WarehouseIcon className="w-3 h-3" />
                  <span>مستودع</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTargetMode('rep')}
                  className={`px-2 py-0.5 flex items-center gap-1 cursor-pointer ${targetMode === 'rep' ? 'bg-[#003589] text-white' : 'bg-white text-slate-600'}`}
                >
                  <Truck className="w-3 h-3" />
                  <span>سيارة مندوب</span>
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
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            ) : (
              <select
                value={targetRepId}
                onChange={(e) => setTargetRepId(e.target.value)}
                className="w-full h-8 bg-white border border-[#B8CAE8] rounded-md px-2 font-bold text-[#011E58]"
              >
                {(activeReps.length ? activeReps : representatives).map((r) => (
                  <option key={r.id} value={r.id}>سيارة المندوب: {r.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Date */}
          <div className="space-y-1">
            <label className="block font-bold text-slate-800 text-[11px] pt-0.5">تاريخ أمر التحويل:</label>
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
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 items-end">
            <div className="sm:col-span-5">
              <label className="block font-bold text-[11px] mb-0.5 text-[#011E58]">البحث الفوري عن الصنف:</label>
              <ProductSearchSelect
                products={products}
                selectedProductId={pickedProductId}
                onSelect={handleSelectProduct}
                onAfterSelect={() => qtyInputRef.current?.focus()}
                warehouseId={effectiveSourceWarehouseId || undefined}
                warehouses={warehouses}
                currency={settings.currency}
                inputRef={searchInputRef}
                placeholder="اكتب اسم الصنف أو الكود أو الباركود..."
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-[11px] mb-0.5 text-blue-950">الوحدة:</label>
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
                      {u.name} {u.factor > 1 ? `(${u.factor})` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-[11px] mb-0.5 text-blue-950">الكمية:</label>
              <input
                ref={qtyInputRef}
                type="number"
                min="0.01"
                step="any"
                placeholder="أدخل الكمية"
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
              <label className="block font-bold text-[11px] mb-0.5 text-blue-950">ملاحظة البند:</label>
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
                placeholder="اختياري"
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
              <span>المختار: <strong>{pickedProduct.name}</strong></span>
              <span>• الكود: <strong className="font-mono">{pickedProduct.code}</strong></span>
              <span>
                • المتاح بالمصدر:{' '}
                <strong className="font-mono text-emerald-700">
                  {effectiveSourceWarehouseId ? Number(pickedProduct.stockPerWarehouse?.[effectiveSourceWarehouseId] || 0) : 0} {pickedProduct.baseUnit}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* Added items table */}
        <div className="border border-slate-200 rounded-lg awlad-table-scroll max-h-56 overflow-y-auto">
          <table className="w-full text-right text-[11px]">
            <thead className="bg-slate-100 text-slate-700 font-bold border-b">
              <tr>
                <th className="p-1.5">م</th>
                <th className="p-1.5">الصنف</th>
                <th className="p-1.5 text-center">المتاح بالمصدر</th>
                <th className="p-1.5 text-center">الكمية المطلوبة</th>
                <th className="p-1.5">ملاحظة</th>
                <th className="p-1.5 text-center">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-3 text-center text-slate-400">
                    أضف صنفاً واحداً أو أكثر لقائمة التحويل.
                  </td>
                </tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="p-1.5 text-slate-500 font-mono">{idx + 1}</td>
                    <td className="p-1.5 font-bold">{it.productName}</td>
                    <td className="p-1.5 text-center font-mono">{it.available} {it.unit}</td>
                    <td className="p-1.5 text-center font-mono font-black text-blue-900">{it.requestedQty} {it.unit}</td>
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
            <label className="block font-bold text-[11px] mb-0.5">سبب التحويل:</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="تغذية فرع / تحميل سيارة مندوب / مرتجع للمخزن..."
              className="w-full h-8 border border-slate-300 rounded-md px-2"
            />
          </div>
          <div>
            <label className="block font-bold text-[11px] mb-0.5">ملاحظات عامة:</label>
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
            إلغاء
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(false)}
            className="h-8 px-3 bg-slate-700 hover:bg-slate-800 text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
          >
            حفظ كمسودة
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(true)}
            className="flex items-center gap-1 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>حفظ وإرسال للاعتماد</span>
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
    setPrintData({
      title: `أمر تحويل أصناف بين المستودعات (${tr.transferNumber})`,
      docNumber: tr.transferNumber,
      docType: 'إيصال استلام',
      date: tr.date,
      partyName: `من: ${tr.sourceWarehouseName} ← إلى: ${tr.targetWarehouseName}`,
      warehouseName: tr.sourceWarehouseName,
      items: tr.items.map((it) => ({
        name: it.productName,
        unit: it.unit,
        quantity: it.requestedQty,
        price: 0,
        total: it.requestedQty,
      })),
      grandTotal: tr.items.reduce((s, it) => s + it.requestedQty, 0),
      notes: `الحالة: ${TRANSFER_STATUS_META[tr.status]?.label || tr.status}${tr.reason ? ` | السبب: ${tr.reason}` : ''}`,
    });
  };

  const handleExportPdf = (tr: StockTransferRequest) => {
    exportTableToPdf(
      `أمر تحويل أصناف (${tr.transferNumber})`,
      ['م', 'الصنف', 'الوحدة', 'المتاح عند الطلب', 'الكمية المحولة', 'ملاحظات'],
      tr.items.map((it, idx) => [idx + 1, it.productName, it.unit, it.availableQtySnapshot, it.requestedQty, it.notes || '-']),
      {
        companyName: settings.companyName,
        docNumber: tr.transferNumber,
        dateRangeText: tr.date,
        meta: [
          { label: 'من مستودع', value: tr.sourceWarehouseName },
          { label: 'إلى مستودع', value: tr.targetWarehouseName },
          { label: 'الحالة', value: TRANSFER_STATUS_META[tr.status]?.label || tr.status },
          { label: 'المنشئ', value: tr.createdBy },
        ],
        notes: tr.reason || tr.notes,
      }
    );
  };

  const handleExportAllExcel = () => {
    const headers = ['رقم الطلب', 'التاريخ', 'من مستودع', 'إلى مستودع', 'عدد الأصناف', 'الحالة', 'بواسطة', 'السبب'];
    const rows = filteredRequests.map((r) => [
      r.transferNumber,
      r.date,
      r.sourceWarehouseName,
      r.targetWarehouseName,
      r.items.length,
      TRANSFER_STATUS_META[r.status]?.label || r.status,
      r.createdBy,
      r.reason || r.notes || '-',
    ]);
    exportToExcel(`أوامر_تحويل_الأصناف_${new Date().toISOString().split('T')[0]}`, headers, rows);
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
        setActionError(res.error || 'تعذر تنفيذ الإجراء');
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
            <span>نظام تحويل الأصناف بين المستودعات وعهدة المناديب</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            إدارة أوامر التحويل متعددة الأصناف (إنشاء ← إرسال ← اعتماد ← تنفيذ) مع فصل كامل عن تحويلات عهدة المندوب المرتبطة بالفواتير
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleExportAllExcel}
            className="flex items-center gap-1 h-8 px-2.5 border border-slate-300 rounded-md text-xs font-bold hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#003589]" />
            <span>تصدير Excel</span>
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => setIsNewModalOpen(true)}
              className="flex items-center gap-1 h-8 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إنشاء أمر تحويل أصناف</span>
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
            إغلاق
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
          تحويلات الأصناف بين المستودعات ({stockTransferRequests.length})
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
          تحويلات المندوبين المرتبطة بالفواتير ({repItemTransfers.length})
        </button>
      </div>

      {activeSubTab === 'warehouse_orders' ? (
        <UnifiedDataTable<StockTransferRequest>
          compact
          title="تحويلات الأصناف بين المستودعات"
          subtitle={`إجمالي الأوامر: ${filteredRequests.length}`}
          data={filteredRequests}
          rowKey={(tr) => tr.id}
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="بحث برقم التحويل أو اسم المستودع أو المنشئ..."
          exportFilename="AWLAD_SELIM_StockTransfers"
          pdfTitle="أوامر تحويل الأصناف بين المستودعات"
          defaultPageSize={25}
          emptyTitle="لا توجد أوامر تحويل أصناف مسجلة بعد"
          toolbarFilters={
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold"
            >
              <option value="all">كل حالات التحويل</option>
              <option value="draft">مسودة</option>
              <option value="submitted">بانتظار الاعتماد</option>
              <option value="approved">معتمد</option>
              <option value="executed">منفذ</option>
              <option value="rejected">مرفوض</option>
            </select>
          }
          columns={[
            {
              key: 'transferNumber',
              header: 'رقم الطلب',
              sortable: true,
              sortValue: (tr) => tr.transferNumber,
              exportValue: (tr) => tr.transferNumber,
              render: (tr) => <span className="font-mono font-bold text-blue-900">{tr.transferNumber}</span>,
            },
            {
              key: 'date',
              header: 'التاريخ',
              sortable: true,
              sortValue: (tr) => tr.date,
              exportValue: (tr) => tr.date,
              render: (tr) => <span className="font-mono tabular-nums">{tr.date}</span>,
            },
            {
              key: 'sourceWarehouseName',
              header: 'من مستودع',
              sortable: true,
              sortValue: (tr) => tr.sourceWarehouseName,
              exportValue: (tr) => tr.sourceWarehouseName,
              render: (tr) => <span className="font-bold">{tr.sourceWarehouseName}</span>,
            },
            {
              key: 'targetWarehouseName',
              header: 'إلى مستودع',
              sortable: true,
              sortValue: (tr) => tr.targetWarehouseName,
              exportValue: (tr) => tr.targetWarehouseName,
              render: (tr) => <span className="font-bold text-[#011E58]">{tr.targetWarehouseName}</span>,
            },
            {
              key: 'itemsCount',
              header: 'الأصناف',
              align: 'center',
              sortable: true,
              sortValue: (tr) => tr.items.length,
              exportValue: (tr) => tr.items.length,
              render: (tr) => <span className="font-mono font-bold tabular-nums">{tr.items.length}</span>,
            },
            {
              key: 'createdBy',
              header: 'المنشئ',
              sortable: true,
              sortValue: (tr) => tr.createdBy,
              exportValue: (tr) => tr.createdBy,
              render: (tr) => <span>{tr.createdBy}</span>,
            },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              sortable: true,
              sortValue: (tr) => tr.status,
              exportValue: (tr) => TRANSFER_STATUS_META[tr.status]?.label || tr.status,
              render: (tr) => {
                const badge = TRANSFER_STATUS_META[tr.status] || TRANSFER_STATUS_META.draft;
                return (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badge.cls}`}>
                    {badge.label}
                  </span>
                );
              },
            },
            {
              key: 'actions',
              header: 'الإجراءات',
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
                    title="مراجعة وتنفيذ"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrintTransfer(tr)}
                    className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
                    title="طباعة"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportPdf(tr)}
                    className="p-1.5 rounded-lg text-blue-700 hover:bg-blue-50 cursor-pointer"
                    title="تصدير PDF"
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
          title="تحويلات المندوبين المرتبطة بالفواتير"
          subtitle={`إجمالي التحويلات: ${repItemTransfers.length}`}
          data={repItemTransfers}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث برقم الطلب أو المندوب أو الفاتورة..."
          exportFilename="AWLAD_SELIM_RepItemTransfers"
          pdfTitle="تحويلات عهدة المندوبين المرتبطة بالفواتير"
          defaultPageSize={25}
          emptyTitle="لا توجد طلبات تحويل عهدة مناديب مرتبطة بالفواتير"
          columns={[
            {
              key: 'requestNumber',
              header: 'رقم الطلب',
              sortable: true,
              sortValue: (r) => r.requestNumber,
              exportValue: (r) => r.requestNumber,
              render: (r) => <span className="font-mono font-bold text-amber-900">{r.requestNumber}</span>,
            },
            {
              key: 'representativeName',
              header: 'المندوب',
              sortable: true,
              sortValue: (r) => r.representativeName,
              exportValue: (r) => r.representativeName,
              render: (r) => <span className="font-bold">{r.representativeName}</span>,
            },
            {
              key: 'invoiceNumber',
              header: 'الفاتورة المرتبطة',
              sortable: true,
              sortValue: (r) => r.invoiceNumber || '',
              exportValue: (r) => r.invoiceNumber || 'عهدة عامة',
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
                  <span className="text-slate-400">عهدة عامة</span>
                );
              },
            },
            {
              key: 'sourceWarehouseName',
              header: 'من مستودع',
              sortable: true,
              sortValue: (r) => r.sourceWarehouseName,
              exportValue: (r) => r.sourceWarehouseName,
              render: (r) => <span>{r.sourceWarehouseName}</span>,
            },
            {
              key: 'targetWarehouseName',
              header: 'إلى سيارة المندوب',
              sortable: true,
              sortValue: (r) => r.targetWarehouseName,
              exportValue: (r) => r.targetWarehouseName,
              render: (r) => <span className="font-semibold">{r.targetWarehouseName}</span>,
            },
            {
              key: 'itemsCount',
              header: 'الأصناف',
              align: 'center',
              sortable: true,
              sortValue: (r) => r.items.length,
              exportValue: (r) => r.items.length,
              render: (r) => <span className="font-mono font-bold tabular-nums">{r.items.length}</span>,
            },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              sortable: true,
              sortValue: (r) => r.status,
              exportValue: (r) => r.status,
              render: (r) => (
                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-bold border border-slate-200">
                  {r.status}
                </span>
              ),
            },
          ]}
        />
      )}

      <CreateStockTransferModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreated={(tr) => setBanner({ type: 'success', text: `تم إنشاء أمر التحويل (${tr.transferNumber}) بنجاح.` })}
      />

      {/* Detail / Workflow Action Modal */}
      {activeTransfer && (
        <Modal
          isOpen={!!activeTransfer}
          onClose={() => setActiveTransfer(null)}
          title={`تفاصيل أمر التحويل (${activeTransfer.transferNumber})`}
          subtitle={`من ${activeTransfer.sourceWarehouseName} ← إلى ${activeTransfer.targetWarehouseName}`}
          maxWidth="4xl"
        >
          <div className="space-y-2 text-xs">
            {actionError && (
              <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{actionError}</div>
            )}

            <div className="p-2 rounded-lg bg-slate-50 border flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <span>الحالة: <strong>{TRANSFER_STATUS_META[activeTransfer.status]?.label}</strong></span>
                <span>• التاريخ: <strong className="font-mono">{activeTransfer.date}</strong></span>
                <span>• المنشئ: <strong>{activeTransfer.createdBy}</strong></span>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => handlePrintTransfer(activeTransfer)}
                  className="h-7 px-2 bg-white border rounded-md text-[11px] font-bold cursor-pointer"
                >
                  طباعة
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
                  header: 'م',
                  align: 'center',
                  exportValue: (_, idx) => (idx ?? 0) + 1,
                  render: (_, idx) => <span className="font-mono tabular-nums">{idx + 1}</span>,
                },
                {
                  key: 'productName',
                  header: 'الصنف',
                  exportValue: (it) => it.productName,
                  render: (it) => <span className="font-bold">{it.productName}</span>,
                },
                {
                  key: 'unit',
                  header: 'الوحدة',
                  align: 'center',
                  exportValue: (it) => it.unit,
                  render: (it) => <span>{it.unit}</span>,
                },
                {
                  key: 'availableQtySnapshot',
                  header: 'المتاح عند الإنشاء',
                  align: 'center',
                  exportValue: (it) => it.availableQtySnapshot,
                  render: (it) => <span className="font-mono tabular-nums">{it.availableQtySnapshot}</span>,
                },
                {
                  key: 'requestedQty',
                  header: 'الكمية المطلوبة',
                  align: 'center',
                  exportValue: (it) => it.requestedQty,
                  render: (it) => <span className="font-mono font-black text-blue-900 tabular-nums">{it.requestedQty}</span>,
                },
                {
                  key: 'notes',
                  header: 'ملاحظة',
                  exportValue: (it) => it.notes || '-',
                  render: (it) => <span className="text-slate-600">{it.notes || '-'}</span>,
                },
              ]}
            />

            {showRejectBox && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 space-y-1.5">
                <label className="block font-bold text-red-900">سبب رفض طلب التحويل:</label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full h-8 border border-red-300 bg-white rounded-md px-2"
                />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setShowRejectBox(false)} className="h-7 px-2.5 border rounded-md cursor-pointer">
                    تراجع
                  </button>
                  <button
                    type="button"
                    disabled={isActionSubmitting}
                    onClick={() =>
                      runWorkflowAction(
                        () => rejectStockTransferRequest(activeTransfer.id, rejectReason.trim()),
                        'تم رفض طلب التحويل دون تعديل المخزون.'
                      )
                    }
                    className="h-7 px-2.5 bg-red-700 text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
                  >
                    تأكيد الرفض
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
                      `تم إرسال طلب التحويل (${activeTransfer.transferNumber}) للاعتماد.`
                    )
                  }
                  className="flex items-center gap-1 h-8 px-2.5 bg-[#011E58] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>إرسال للاعتماد</span>
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
                    <span>رفض</span>
                  </button>
                  <button
                    type="button"
                    disabled={isActionSubmitting}
                    onClick={() =>
                      runWorkflowAction(
                        () => approveStockTransferRequest(activeTransfer.id),
                        `تم اعتماد أمر التحويل (${activeTransfer.transferNumber}).`
                      )
                    }
                    className="flex items-center gap-1 h-8 px-2.5 bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>اعتماد الطلب</span>
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
                      `تم تنفيذ التحويل المخزني (${activeTransfer.transferNumber}) وتحديث أرصدة المستودعين.`
                    )
                  }
                  className="flex items-center gap-1 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isActionSubmitting ? 'جاري التنفيذ...' : 'تنفيذ التحويل وتعديل الأرصدة'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTransfer(null)}
                className="h-8 px-2.5 border rounded-md font-bold cursor-pointer"
              >
                إغلاق
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
          title={`الفاتورة المرتبطة (${previewInvoice.invoiceNumber})`}
          maxWidth="2xl"
        >
          <div className="space-y-2 text-xs">
            <div className="p-2 bg-slate-50 rounded-md border grid grid-cols-2 gap-1.5">
              <div>العميل: <strong>{previewInvoice.customerName || 'عام'}</strong></div>
              <div>التاريخ: <strong className="font-mono">{previewInvoice.date}</strong></div>
              <div>المستودع: <strong>{previewInvoice.warehouseName}</strong></div>
              <div>الإجمالي: <strong className="font-mono text-blue-900">{previewInvoice.grandTotal.toLocaleString()} {settings.currency}</strong></div>
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
                  header: 'الصنف',
                  exportValue: (it) => it.productName,
                  render: (it) => <span className="font-bold">{it.productName}</span>,
                },
                {
                  key: 'unit',
                  header: 'الوحدة',
                  align: 'center',
                  exportValue: (it) => it.unit,
                  render: (it) => <span>{it.unit}</span>,
                },
                {
                  key: 'quantity',
                  header: 'الكمية',
                  align: 'center',
                  exportValue: (it) => it.quantity,
                  render: (it) => <span className="font-mono tabular-nums">{it.quantity}</span>,
                },
                {
                  key: 'total',
                  header: 'الإجمالي',
                  align: 'center',
                  exportValue: (it) => it.total,
                  render: (it) => <span className="font-mono font-bold tabular-nums">{it.total.toLocaleString()}</span>,
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

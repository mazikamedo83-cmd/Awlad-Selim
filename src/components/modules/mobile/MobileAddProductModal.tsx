import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Barcode,
  ChevronDown,
  ChevronUp,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDate, formatLocaleNumber } from '../../../i18n/translator';
import { ProductUnit } from '../../../types';
import { exportHtmlToPdf } from '../../common/PdfExporter';

interface MobileAddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (productName: string) => void;
}

export const MobileAddProductModal: React.FC<MobileAddProductModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const { products, productGroups, categories, warehouses, settings, addProduct, addProductGroup, addCategory } = useData();
  const { t, dir, isRtl } = usePreferences();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [groupId, setGroupId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [category, setCategory] = useState('');
  const [showQuickGroup, setShowQuickGroup] = useState(false);
  const [quickGroupName, setQuickGroupName] = useState('');
  const [showQuickCat, setShowQuickCat] = useState(false);
  const [quickCatName, setQuickCatName] = useState('');
  const [availableQty, setAvailableQty] = useState<number | ''>('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(
    warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || ''
  );

  // Unit 1 (Base Unit - expanded by default)
  const [unit1Open, setUnit1Open] = useState(true);
  const [baseUnit, setBaseUnit] = useState('');
  const [barcode1, setBarcode1] = useState('');
  const [purchasePrice1, setPurchasePrice1] = useState<number | ''>('');
  const [sellingPrice1, setSellingPrice1] = useState<number | ''>('');

  // Unit 2 (Collapsed by default)
  const [unit2Open, setUnit2Open] = useState(false);
  const [unit2Name, setUnit2Name] = useState('');
  const [unit2Factor, setUnit2Factor] = useState<number | ''>('');
  const [barcode2, setBarcode2] = useState('');
  const [purchasePrice2, setPurchasePrice2] = useState<number | ''>('');
  const [sellingPrice2, setSellingPrice2] = useState<number | ''>('');

  // Unit 3 (Collapsed by default)
  const [unit3Open, setUnit3Open] = useState(false);
  const [unit3Name, setUnit3Name] = useState('');
  const [unit3Factor, setUnit3Factor] = useState<number | ''>('');
  const [barcode3, setBarcode3] = useState('');
  const [purchasePrice3, setPurchasePrice3] = useState<number | ''>('');
  const [sellingPrice3, setSellingPrice3] = useState<number | ''>('');

  // Active qty input unit selector ('1' | '2' | '3')
  const [qtyEntryUnit, setQtyEntryUnit] = useState<'1' | '2' | '3'>('1');

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const scopedCategories = useMemo(() => {
    const active = categories.filter((c) => c.status !== 'suspended');
    if (!groupId) return active;
    return active.filter((c) => (c.groupId || '') === groupId);
  }, [categories, groupId]);

  const activeEntryFactor = useMemo(() => {
    if (qtyEntryUnit === '2') return Math.max(1, Number(unit2Factor) || 1);
    if (qtyEntryUnit === '3') return Math.max(1, Number(unit3Factor) || 1);
    return 1;
  }, [qtyEntryUnit, unit2Factor, unit3Factor]);

  const computedBaseQty = useMemo(() => {
    const raw = Number(availableQty) || 0;
    return Math.max(0, raw * activeEntryFactor);
  }, [availableQty, activeEntryFactor]);

  if (!isOpen) return null;

  const generateBarcode = () =>
    `622${Date.now().toString().slice(-7)}${Math.floor(10 + Math.random() * 89)}`;

  const handlePrintBarcode = (codeValue: string, unitLabel: string, priceVal: number | '') => {
    const bc = codeValue.trim() || generateBarcode();
    exportHtmlToPdf({
      title: t('ملصق باركود صنف', 'Item Barcode Label'),
      companyName: settings.companyName,
      companySubtitle: settings.companySubtitle,
      docNumber: bc,
      dateRangeText: formatLocaleDate(new Date()),
      meta: [
        { label: t('الصنف', 'Item'), value: name.trim() || t('صنف جديد', 'New Item') },
        { label: t('الوحدة', 'Unit'), value: unitLabel ? t(unitLabel) : baseUnit.trim() || t('أساسي', 'Base') },
        ...(priceVal !== '' ? [{ label: t('السعر', 'Price'), value: `${formatLocaleNumber(Number(priceVal))} ${t(settings.currency)}` }] : []),
      ],
      tableHeaders: [t('الباركود', 'Barcode'), t('اسم الصنف', 'Item Name'), t('الوحدة', 'Unit')],
      tableRows: [[bc, name.trim() || t('صنف جديد', 'New Item'), unitLabel ? t(unitLabel) : baseUnit.trim() || '-']],
      summaryPairs: [],
    });
  };

  const resetForm = () => {
    setName('');
    setNotes('');
    setGroupId('');
    setCategoryId('');
    setCategory('');
    setShowQuickGroup(false);
    setQuickGroupName('');
    setShowQuickCat(false);
    setQuickCatName('');
    setAvailableQty('');
    setBaseUnit('');
    setBarcode1('');
    setPurchasePrice1('');
    setSellingPrice1('');
    setUnit2Name('');
    setUnit2Factor('');
    setBarcode2('');
    setPurchasePrice2('');
    setSellingPrice2('');
    setUnit3Name('');
    setUnit3Factor('');
    setBarcode3('');
    setPurchasePrice3('');
    setSellingPrice3('');
    setQtyEntryUnit('1');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    if (!name.trim()) {
      setError(t('يرجى إدخال اسم المنتج بالمواصفات التفصيلية.', 'Please enter the product name with detailed specifications.'));
      return;
    }
    if (!baseUnit.trim()) {
      setError(t('يرجى إدخال اسم الوحدة الأساسية (1).', 'Please enter the base unit name (1).'));
      return;
    }
    const p1 = Number(purchasePrice1) || 0;
    const s1 = Number(sellingPrice1) || 0;
    if (p1 < 0 || s1 < 0) {
      setError(t('لا يمكن أن تكون الأسعار سالبة.', 'Prices cannot be negative.'));
      return;
    }

    const extraUnits: ProductUnit[] = [];
    if (unit2Name.trim()) {
      const f2 = Number(unit2Factor) || 0;
      if (f2 <= 0) {
        setError(t('يرجى إدخال معامل تحويل صحيح للوحدة الثانية.', 'Please enter a valid conversion factor for the second unit.'));
        return;
      }
      extraUnits.push({
        id: `u2-${Date.now().toString().slice(-4)}`,
        name: unit2Name.trim(),
        conversionFactor: f2,
        barcode: barcode2.trim() || undefined,
        purchasePrice: Number(purchasePrice2) || 0,
        sellingPrice: Number(sellingPrice2) || 0,
      });
    }
    if (unit3Name.trim()) {
      const f3 = Number(unit3Factor) || 0;
      if (f3 <= 0) {
        setError(t('يرجى إدخال معامل تحويل صحيح للوحدة الثالثة.', 'Please enter a valid conversion factor for the third unit.'));
        return;
      }
      extraUnits.push({
        id: `u3-${Date.now().toString().slice(-4)}`,
        name: unit3Name.trim(),
        conversionFactor: f3,
        barcode: barcode3.trim() || undefined,
        purchasePrice: Number(purchasePrice3) || 0,
        sellingPrice: Number(sellingPrice3) || 0,
      });
    }

    const targetWh =
      selectedWarehouseId ||
      warehouses.find((w) => w.isDefault)?.id ||
      warehouses[0]?.id ||
      '';
    const stockMap: Record<string, number> = {};
    warehouses.forEach((w) => {
      stockMap[w.id] = w.id === targetWh ? computedBaseQty : 0;
    });

    setIsSaving(true);
    try {
      const selectedGroup = productGroups.find((g) => g.id === groupId);
      const selectedCat = categories.find((c) => c.id === categoryId);
      const saved = await addProduct({
        code: `${Date.now().toString().slice(-6)}-${products.length + 1}`,
        barcode: barcode1.trim() || generateBarcode(),
        name: name.trim(),
        groupId: selectedGroup?.id || selectedCat?.groupId || undefined,
        groupName: selectedGroup?.name || selectedCat?.groupName || undefined,
        categoryId: selectedCat?.id || undefined,
        category: selectedCat?.name || category.trim(),
        baseUnit: baseUnit.trim(),
        units: extraUnits,
        purchasePrice: p1,
        sellingPrice: s1,
        minStockLevel: 0,
        stockPerWarehouse: stockMap,
        status: 'active',
        notes: notes.trim(),
      });
      resetForm();
      onSaved?.(saved.name);
      onClose();
    } catch (err: any) {
      setError(err?.message ? t(err.message) : t('تعذر حفظ الصنف', 'Unable to save item'));
    } finally {
      setIsSaving(false);
    }
  };

  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div className="fixed inset-0 z-50 bg-[#f5f7fb] flex flex-col overflow-hidden" dir={dir}>
      {/* Brand Top Bar */}
      <header className="awlad-brand-gradient text-white px-3 py-2 flex items-center justify-between gap-2 pt-safe shrink-0 shadow-sm">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          aria-label={t('رجوع', 'Back')}
        >
          <BackIcon className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-black tracking-tight flex-1 text-center">{t('إضافة صنف جديد', 'Add New Item')}</h2>
        <div className="w-[36px]" aria-hidden="true" />
      </header>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-2 space-y-1.5 text-xs pb-16">
        {error && (
          <div className="p-2 rounded-lg bg-red-50 border border-red-300 text-red-800 font-bold">
            {error}
          </div>
        )}

        {/* Core Product Fields */}
        <div className="bg-white rounded-lg border border-slate-200 p-2 space-y-1.5">
          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('اسم المنتج بالمواصفات تفصيلي *', 'Product Name & Specifications *')}</label>
            <input
              type="text"
              required
              placeholder={t('أدخل اسم المنتج والمواصفات...', 'Enter product name and specifications...')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white focus:outline-hidden focus:border-[#003589]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="font-bold text-slate-700">{t('المجموعة', 'Group')}</label>
                <button
                  type="button"
                  onClick={() => setShowQuickGroup((v) => !v)}
                  className="text-[11px] font-black text-[#003589] cursor-pointer"
                >
                  {showQuickGroup ? t('إلغاء', 'Cancel') : t('+ إضافة مجموعة', '+ Add Group')}
                </button>
              </div>
              <select
                value={groupId}
                onChange={(e) => {
                  const nextGid = e.target.value;
                  setGroupId(nextGid);
                  if (categoryId && !getScopedMatch(nextGid, categoryId)) {
                    setCategoryId('');
                    setCategory('');
                  }
                  function getScopedMatch(gid: string, cid: string) {
                    if (!gid) return true;
                    const found = categories.find((c) => c.id === cid);
                    return found ? (found.groupId || '') === gid : false;
                  }
                }}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white"
              >
                <option value="">{t('-- اختر المجموعة --', '-- Select Group --')}</option>
                {productGroups.filter((g) => g.status !== 'suspended').map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              {showQuickGroup && (
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="text"
                    value={quickGroupName}
                    onChange={(e) => setQuickGroupName(e.target.value)}
                    placeholder={t('اسم المجموعة الجديدة', 'New group name')}
                    className="flex-1 h-7 border border-slate-300 rounded px-2 font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!quickGroupName.trim()) return;
                      const res = await addProductGroup(quickGroupName.trim());
                      if (res.success && res.productGroup) {
                        setGroupId(res.productGroup.id);
                        setCategoryId('');
                        setCategory('');
                        setQuickGroupName('');
                        setShowQuickGroup(false);
                      } else if (res.error) {
                        setError(t(res.error));
                      }
                    }}
                    className="h-7 px-2 bg-[#003589] text-white rounded font-bold cursor-pointer"
                  >
                    {t('حفظ', 'Save')}
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="font-bold text-slate-700">{t('التصنيف', 'Category')}</label>
                <button
                  type="button"
                  onClick={() => setShowQuickCat((v) => !v)}
                  className="text-[11px] font-black text-[#003589] cursor-pointer"
                >
                  {showQuickCat ? t('إلغاء', 'Cancel') : t('+ إضافة تصنيف', '+ Add Category')}
                </button>
              </div>
              <select
                value={categoryId}
                onChange={(e) => {
                  const nextCid = e.target.value;
                  const cat = categories.find((c) => c.id === nextCid);
                  setCategoryId(nextCid);
                  setCategory(cat?.name || '');
                  if (!groupId && cat?.groupId) {
                    setGroupId(cat.groupId);
                  }
                }}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white"
              >
                <option value="">{t('-- اختر التصنيف --', '-- Select Category --')}</option>
                {scopedCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.name)}
                    {!groupId && c.groupName ? ` (${c.groupName})` : ''}
                  </option>
                ))}
              </select>
              {showQuickCat && (
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="text"
                    value={quickCatName}
                    onChange={(e) => setQuickCatName(e.target.value)}
                    placeholder={t('اسم التصنيف الجديد', 'New category name')}
                    className="flex-1 h-7 border border-slate-300 rounded px-2 font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!quickCatName.trim()) return;
                      const res = await addCategory(quickCatName.trim(), '', groupId);
                      if (res.success && res.category) {
                        setCategoryId(res.category.id);
                        setCategory(res.category.name);
                        if (res.category.groupId) setGroupId(res.category.groupId);
                        setQuickCatName('');
                        setShowQuickCat(false);
                      } else if (res.error) {
                        setError(t(res.error));
                      }
                    }}
                    className="h-7 px-2 bg-[#003589] text-white rounded font-bold cursor-pointer"
                  >
                    {t('حفظ', 'Save')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات على المنتج', 'Product Notes')}</label>
            <input
              type="text"
              placeholder={t('ملاحظات اختيارية', 'Optional notes')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white focus:outline-hidden focus:border-[#003589]"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('الكمية المتاحة', 'Available Quantity')}</label>
              <input
                type="number"
                min="0"
                step="any"
                value={availableQty}
                onChange={(e) =>
                  setAvailableQty(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                }
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-bold text-center tabular-nums bg-white focus:outline-hidden focus:border-[#003589]"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('وحدة الإدخال', 'Entry Unit')}</label>
              <select
                value={qtyEntryUnit}
                onChange={(e) => setQtyEntryUnit(e.target.value as '1' | '2' | '3')}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white"
              >
                <option value="1">{baseUnit.trim() || t('الوحدة الأساسية (1)', 'Base Unit (1)')}</option>
                {unit2Name.trim() && <option value="2">{unit2Name.trim()}</option>}
                {unit3Name.trim() && <option value="3">{unit3Name.trim()}</option>}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-[11px]">
            <span className="text-slate-600 font-bold">{t('الكمية بالوحدة الأساسية:', 'Quantity in Base Unit:')}</span>
            <span className="font-mono font-black text-[#011E58] tabular-nums">
              {formatLocaleNumber(computedBaseQty)} {baseUnit.trim() || t('وحدة', 'Unit')}
            </span>
          </div>

          {warehouses.length > 0 && (
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('المستودع', 'Warehouse')}</label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Unit 1 (Base Unit) Collapsible */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setUnit1Open((p) => !p)}
            className="w-full min-h-[34px] px-2.5 py-1 flex items-center justify-between bg-slate-50 border-b border-slate-200 font-black text-slate-900 cursor-pointer"
          >
            <span>{t('الوحدة الأساسية (1) *', 'Base Unit (1) *')}</span>
            {unit1Open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {unit1Open && (
            <div className="p-2 space-y-1.5">
              <div>
                <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('اسم الوحدة الأساسية *', 'Base Unit Name *')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('اسم الوحدة الأساسية', 'Base unit name')}
                  value={baseUnit}
                  onChange={(e) => setBaseUnit(e.target.value)}
                  className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('الباركود', 'Barcode')}</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder={t('أدخل أو ولّد الباركود', 'Enter or generate barcode')}
                    value={barcode1}
                    onChange={(e) => setBarcode1(e.target.value)}
                    className="flex-1 h-8 border border-slate-300 rounded-md px-2 font-mono font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => setBarcode1(generateBarcode())}
                    className="h-8 w-8 rounded-md border border-slate-300 bg-slate-50 flex items-center justify-center text-slate-700 cursor-pointer"
                    title={t('توليد باركود', 'Generate Barcode')}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrintBarcode(barcode1, baseUnit, sellingPrice1)}
                    className="h-8 w-8 rounded-md border border-slate-300 bg-slate-50 flex items-center justify-center text-[#003589] cursor-pointer"
                    title={t('طباعة باركود', 'Print Barcode')}
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('سعر الشراء', 'Purchase Price')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={purchasePrice1}
                    onChange={(e) =>
                      setPurchasePrice1(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('سعر البيع', 'Selling Price')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sellingPrice1}
                    onChange={(e) =>
                      setSellingPrice1(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-black text-[#011E58] tabular-nums"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Unit 2 Collapsible */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setUnit2Open((p) => !p)}
            className="w-full min-h-[34px] px-2.5 py-1 flex items-center justify-between bg-slate-50 border-b border-slate-200 font-black text-slate-800 cursor-pointer"
          >
            <span>{t('الوحدة الثانية (2)', 'Second Unit (2)')}</span>
            {unit2Open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {unit2Open && (
            <div className="p-2 space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('اسم الوحدة', 'Unit Name')}</label>
                  <input
                    type="text"
                    placeholder={t('اسم الوحدة', 'Unit name')}
                    value={unit2Name}
                    onChange={(e) => setUnit2Name(e.target.value)}
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('تحتوي كم أساسي؟', 'Contains Base Units?')}</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={unit2Factor}
                    onChange={(e) =>
                      setUnit2Factor(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-bold tabular-nums"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder={t('باركود الوحدة الثانية', 'Second unit barcode')}
                  value={barcode2}
                  onChange={(e) => setBarcode2(e.target.value)}
                  className="flex-1 h-8 border border-slate-300 rounded-md px-2 font-mono font-bold"
                />
                <button
                  type="button"
                  onClick={() => setBarcode2(generateBarcode())}
                  className="h-8 w-8 rounded-md border border-slate-300 bg-slate-50 flex items-center justify-center text-slate-700 cursor-pointer"
                  title={t('توليد باركود', 'Generate Barcode')}
                >
                  <Barcode className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('سعر الشراء', 'Purchase Price')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={purchasePrice2}
                    onChange={(e) =>
                      setPurchasePrice2(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('سعر البيع', 'Selling Price')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sellingPrice2}
                    onChange={(e) =>
                      setSellingPrice2(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-black text-[#011E58] tabular-nums"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Unit 3 Collapsible */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setUnit3Open((p) => !p)}
            className="w-full min-h-[34px] px-2.5 py-1 flex items-center justify-between bg-slate-50 border-b border-slate-200 font-black text-slate-800 cursor-pointer"
          >
            <span>{t('الوحدة الثالثة (3)', 'Third Unit (3)')}</span>
            {unit3Open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {unit3Open && (
            <div className="p-2 space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('اسم الوحدة', 'Unit Name')}</label>
                  <input
                    type="text"
                    placeholder={t('اسم الوحدة', 'Unit name')}
                    value={unit3Name}
                    onChange={(e) => setUnit3Name(e.target.value)}
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('تحتوي كم أساسي؟', 'Contains Base Units?')}</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={unit3Factor}
                    onChange={(e) =>
                      setUnit3Factor(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-bold tabular-nums"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder={t('باركود الوحدة الثالثة', 'Third unit barcode')}
                  value={barcode3}
                  onChange={(e) => setBarcode3(e.target.value)}
                  className="flex-1 h-8 border border-slate-300 rounded-md px-2 font-mono font-bold"
                />
                <button
                  type="button"
                  onClick={() => setBarcode3(generateBarcode())}
                  className="h-8 w-8 rounded-md border border-slate-300 bg-slate-50 flex items-center justify-center text-slate-700 cursor-pointer"
                  title={t('توليد باركود', 'Generate Barcode')}
                >
                  <Barcode className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('سعر الشراء', 'Purchase Price')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={purchasePrice3}
                    onChange={(e) =>
                      setPurchasePrice3(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 text-[11px]">{t('سعر البيع', 'Selling Price')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sellingPrice3}
                    onChange={(e) =>
                      setSellingPrice3(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-black text-[#011E58] tabular-nums"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Bottom Save Button */}
        <div className="pt-0.5">
          <button
            type="submit"
            disabled={isSaving}
            className="w-full h-9 rounded-lg bg-[#003589] hover:bg-[#011E58] text-white font-black text-xs sm:text-sm disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? t('جاري الحفظ...', 'Saving...') : t('حفظ البيانات', 'Save Data')}
          </button>
        </div>
      </form>
    </div>
  );
};

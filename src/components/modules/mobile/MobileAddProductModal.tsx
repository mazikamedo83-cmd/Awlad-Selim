import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDate, formatLocaleNumber } from '../../../i18n/translator';
import { exportHtmlToPdf } from '../../common/PdfExporter';
import { SearchableTaxonomySelect } from '../../common/SearchableTaxonomySelect';
import { normalizeArabicSearchText } from '../../common/SearchableFilterSelect';

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
  const {
    products,
    productGroups,
    categories,
    productUnits,
    warehouses,
    settings,
    addProduct,
    addProductGroup,
    updateProductGroup,
    addCategory,
    updateCategory,
    addProductUnit,
    updateProductUnit,
  } = useData();
  const { t, dir, isRtl } = usePreferences();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [category, setCategory] = useState('');
  const [unitId, setUnitId] = useState('');
  const [baseUnit, setBaseUnit] = useState('');
  const [availableQty, setAvailableQty] = useState<number | ''>('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [class1, setClass1] = useState('');
  const [class2, setClass2] = useState('');
  const [barcode, setBarcode] = useState('');
  const [purchasePrice, setPurchasePrice] = useState<number | ''>('');
  const [sellingPrice, setSellingPrice] = useState<number | ''>('');

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const scopedCategories = useMemo(() => {
    const active = categories.filter((c) => c.status !== 'suspended');
    if (!groupId) return active;
    return active.filter((c) => (c.groupId || '') === groupId);
  }, [categories, groupId]);

  const activeUnits = useMemo(
    () => (productUnits || []).filter((u) => u.status !== 'suspended' || (unitId && u.id === unitId)),
    [productUnits, unitId]
  );

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
        { label: t('الوحدة', 'Unit'), value: unitLabel ? t(unitLabel) : baseUnit.trim() || t('وحدة', 'Unit') },
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
    setGroupName('');
    setCategoryId('');
    setCategory('');
    setUnitId('');
    setBaseUnit('');
    setAvailableQty('');
    setSelectedWarehouseId('');
    setClass1('');
    setClass2('');
    setBarcode('');
    setPurchasePrice('');
    setSellingPrice('');
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
      setError(t('يرجى اختيار أو إدخال وحدة الصنف.', 'Please select or enter the product unit.'));
      return;
    }
    const pPrice = Number(purchasePrice) || 0;
    const sPrice = Number(sellingPrice) || 0;
    if (pPrice < 0 || sPrice < 0) {
      setError(t('لا يمكن أن تكون الأسعار سالبة.', 'Prices cannot be negative.'));
      return;
    }

    const qtyVal = Math.max(0, Number(availableQty) || 0);
    if (qtyVal > 0 && warehouses.length > 0 && !selectedWarehouseId) {
      setError(t('يرجى اختيار المستودع للرصيد الافتتاحي.', 'Please select a warehouse for the opening quantity.'));
      return;
    }
    const targetWh = selectedWarehouseId;
    const stockMap: Record<string, number> = {};
    warehouses.forEach((w) => {
      stockMap[w.id] = targetWh && w.id === targetWh ? qtyVal : 0;
    });

    setIsSaving(true);
    try {
      const selectedGroup = productGroups.find((g) => g.id === groupId);
      const selectedCat = categories.find((c) => c.id === categoryId);
      const saved = await addProduct({
        code: `${Date.now().toString().slice(-6)}-${products.length + 1}`,
        barcode: barcode.trim() || generateBarcode(),
        name: name.trim(),
        groupId: selectedGroup?.id || selectedCat?.groupId || undefined,
        groupName: selectedGroup?.name || selectedCat?.groupName || groupName || undefined,
        categoryId: selectedCat?.id || undefined,
        category: selectedCat?.name || category.trim(),
        class1: class1.trim() || undefined,
        class2: class2.trim() || undefined,
        unitId: unitId || undefined,
        baseUnit: baseUnit.trim(),
        units: [],
        purchasePrice: pPrice,
        sellingPrice: sPrice,
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

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-2.5 space-y-2 text-xs pb-16">
        {error && (
          <div className="p-2 rounded-lg bg-red-50 border border-red-300 text-red-800 font-bold">
            {error}
          </div>
        )}

        {/* Core Product Fields */}
        <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2">
          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('اسم الصنف: *', 'Item Name: *')}</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white focus:outline-hidden focus:border-[#003589]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <SearchableTaxonomySelect
              compact
              label={t('المجموعة', 'Group')}
              items={productGroups.filter((g) => g.status !== 'suspended')}
              valueId={groupId}
              valueText={groupName}
              allowClear
              emptyDisplayText={t('بدون مجموعة', 'No Group')}
              clearLabel={t('بدون مجموعة', 'No Group')}
              createLabel={t('إضافة مجموعة جديدة', 'Add New Group')}
              searchPlaceholder={t('بحث باسم المجموعة...', 'Search group...')}
              onChange={({ id, name: nextName }) => {
                const nextGid = id || '';
                setGroupId(nextGid);
                setGroupName(nextName);
                if (categoryId) {
                  const found = categories.find((c) => c.id === categoryId);
                  if (nextGid && found && (found.groupId || '') !== nextGid) {
                    setCategoryId('');
                    setCategory('');
                  }
                }
              }}
              onCreate={async (val) => {
                const res = await addProductGroup(val);
                if (res.success && res.productGroup) {
                  return { success: true, item: { id: res.productGroup.id, name: res.productGroup.name } };
                }
                return { success: false, error: res.error ? t(res.error) : t('تعذر إضافة المجموعة', 'Unable to add group') };
              }}
              onRename={async (id, newName) => {
                const res = await updateProductGroup(id, { name: newName });
                if (res.success) {
                  if (groupId === id) setGroupName(newName);
                  return { success: true };
                }
                return { success: false, error: res.error ? t(res.error) : t('تعذر تعديل المجموعة', 'Unable to rename group') };
              }}
            />

            <SearchableTaxonomySelect
              compact
              label={t('التصنيف', 'Category')}
              items={scopedCategories.map((c) => ({
                id: c.id,
                name: c.name,
                subtitle: !groupId && c.groupName ? c.groupName : undefined,
                status: c.status,
              }))}
              valueId={categoryId}
              valueText={category}
              allowClear
              emptyDisplayText={t('اختر التصنيف', 'Select Category')}
              clearLabel={t('بدون تصنيف', 'No Category')}
              createLabel={t('إضافة تصنيف جديد', 'Add New Category')}
              searchPlaceholder={t('بحث باسم التصنيف...', 'Search category...')}
              onChange={({ id, name: nextName }) => {
                const cat = id ? categories.find((c) => c.id === id) : undefined;
                setCategoryId(id || '');
                setCategory(cat?.name || nextName || '');
                if (!groupId && cat?.groupId) {
                  setGroupId(cat.groupId);
                  setGroupName(cat.groupName || '');
                }
              }}
              onCreate={async (val) => {
                const res = await addCategory(val, '', groupId);
                if (res.success && res.category) {
                  const cat = res.category;
                  if (cat.groupId) {
                    setGroupId(cat.groupId);
                    setGroupName(cat.groupName || '');
                  }
                  return { success: true, item: { id: cat.id, name: cat.name } };
                }
                return { success: false, error: res.error ? t(res.error) : t('تعذر إضافة التصنيف', 'Unable to add category') };
              }}
              onRename={async (id, newName) => {
                try {
                  await updateCategory(id, { name: newName });
                  if (categoryId === id) setCategory(newName);
                  return { success: true };
                } catch (err: any) {
                  return { success: false, error: err?.message ? t(err.message) : t('تعذر تعديل التصنيف', 'Unable to rename category') };
                }
              }}
            />

            <SearchableTaxonomySelect
              compact
              required
              label={t('الوحدة', 'Unit')}
              items={activeUnits.map((u) => ({
                id: u.id,
                name: u.name,
                subtitle: u.shortCode || undefined,
                status: u.status,
              }))}
              valueId={unitId}
              valueText={baseUnit}
              allowManualText
              emptyDisplayText={t('اختر أو اكتب الوحدة', 'Select or type unit')}
              createLabel={t('إضافة وحدة جديدة', 'Add New Unit')}
              searchPlaceholder={t('بحث باسم الوحدة أو كتابتها...', 'Search or type unit name...')}
              onChange={({ id, name: nextName }) => {
                setUnitId(id || '');
                setBaseUnit(nextName);
              }}
              onCreate={async (val) => {
                const res = await addProductUnit(val);
                if (res.success && res.productUnit) {
                  return { success: true, item: { id: res.productUnit.id, name: res.productUnit.name } };
                }
                return { success: false, error: res.error ? t(res.error) : t('تعذر إضافة الوحدة', 'Unable to add unit') };
              }}
              onRename={async (id, newName) => {
                const res = await updateProductUnit(id, { name: newName });
                if (res.success) {
                  const oldUnit = activeUnits.find((u) => u.id === id);
                  if (unitId === id || (oldUnit && normalizeArabicSearchText(baseUnit) === normalizeArabicSearchText(oldUnit.name))) {
                    setUnitId(id);
                    setBaseUnit(newName);
                  }
                  return { success: true };
                }
                return { success: false, error: res.error ? t(res.error) : t('تعذر تعديل الوحدة', 'Unable to rename unit') };
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('التصنيف 1 (اختياري)', 'Classification 1 (Optional)')}</label>
              <input
                type="text"
                value={class1}
                onChange={(e) => setClass1(e.target.value)}
                placeholder={t('تصنيف مستقل 1...', 'Independent Class 1...')}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white focus:outline-hidden focus:border-[#003589]"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('التصنيف 2 (اختياري)', 'Classification 2 (Optional)')}</label>
              <input
                type="text"
                value={class2}
                onChange={(e) => setClass2(e.target.value)}
                placeholder={t('تصنيف مستقل 2...', 'Independent Class 2...')}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white focus:outline-hidden focus:border-[#003589]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('سعر شراء الوحدة *', 'Unit Purchase Price *')}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-bold tabular-nums bg-white"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('سعر بيع الوحدة *', 'Unit Selling Price *')}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-black text-[#011E58] tabular-nums bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">{t('الرصيد الافتتاحي', 'Opening Qty')}</label>
              <input
                type="number"
                min="0"
                step="any"
                value={availableQty}
                onChange={(e) => setAvailableQty(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono font-bold text-center tabular-nums bg-white focus:outline-hidden focus:border-[#003589]"
              />
            </div>
            {warehouses.length > 0 && (
              <div>
                <label className="block font-bold text-slate-700 mb-0.5">{t('المستودع', 'Warehouse')}</label>
                <select
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white"
                >
                  <option value="">{t('-- اختر المستودع --', '-- Select Warehouse --')}</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('الباركود (اختياري)', 'Barcode (Optional)')}</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="flex-1 h-8 border border-slate-300 rounded-md px-2 font-mono font-bold bg-white"
              />
              <button
                type="button"
                onClick={() => setBarcode(generateBarcode())}
                className="h-8 w-8 rounded-md border border-slate-300 bg-slate-50 flex items-center justify-center text-slate-700 cursor-pointer"
                title={t('توليد باركود', 'Generate Barcode')}
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handlePrintBarcode(barcode, baseUnit, sellingPrice)}
                className="h-8 w-8 rounded-md border border-slate-300 bg-slate-50 flex items-center justify-center text-[#003589] cursor-pointer"
                title={t('طباعة باركود', 'Print Barcode')}
              >
                <Printer className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-0.5">{t('ملاحظات على المنتج', 'Product Notes')}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white focus:outline-hidden focus:border-[#003589]"
            />
          </div>
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

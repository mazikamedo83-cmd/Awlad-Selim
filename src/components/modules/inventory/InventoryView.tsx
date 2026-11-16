import React, { useState, useMemo, useEffect } from 'react';
import { 
  Boxes, Plus, Search, Filter, ArrowLeftRight, AlertTriangle, 
  Trash2, Edit, Barcode, Layers, Download, Check, RefreshCw,
  Tag, Ruler, ClipboardCheck, AlertCircle, CheckCircle2
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { Product, ProductUnit, UnitCatalogItem } from '../../../types';
import { Modal } from '../../common/Modal';
import { exportToExcel } from '../../common/ExcelExporter';
import { StockCountView } from './StockCountView';
import { StockTransfersView } from './StockTransfersView';

export interface InventoryViewProps {
  initialTab?: 'products' | 'categories' | 'warehouses' | 'transfers' | 'adjustments' | 'damaged' | 'movements' | 'stock-counts' | 'stock-transfers' | 'units' | string;
}

export const InventoryView: React.FC<InventoryViewProps> = ({ initialTab = 'products' }) => {
  const { 
    products, warehouses, categories: categoryList, settings, addProduct, updateProduct, 
    deleteProduct, transferStock, adjustStock, recordDamagedStock,
    addCategory, renameCategoryGlobal, toggleCategoryStatus, updateSettings,
  } = useData();
  const { hasPermission } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [productModalError, setProductModalError] = useState<string | null>(null);
  const [transferModalError, setTransferModalError] = useState<string | null>(null);

  // Category Rename & Add State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');
  const [renamingCategory, setRenamingCategory] = useState<{ id: string; currentName: string } | null>(null);
  const [renameTargetValue, setRenameTargetValue] = useState('');
  const [isRenamingCat, setIsRenamingCat] = useState(false);

  // Units Catalog State
  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitCode, setNewUnitCode] = useState('');
  const [newUnitFactor, setNewUnitFactor] = useState<number>(1);
  const [newUnitNotes, setNewUnitNotes] = useState('');
  const [isSavingUnits, setIsSavingUnits] = useState(false);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferProdId, setTransferProdId] = useState('');
  const [fromWhId, setFromWhId] = useState(warehouses[0]?.id || '');
  const [toWhId, setToWhId] = useState(warehouses[1]?.id || '');
  const [transferQty, setTransferQty] = useState(10);
  const [transferNotes, setTransferNotes] = useState('');

  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [adjustProdId, setAdjustProdId] = useState('');
  const [adjustWhId, setAdjustWhId] = useState(warehouses[0]?.id || '');
  const [adjustNewQty, setAdjustNewQty] = useState(0);
  const [adjustReason, setAdjustReason] = useState('جرد دوري فعلي بالمستودع');

  const [isDamageModalOpen, setIsDamageModalOpen] = useState(false);
  const [damageProdId, setDamageProdId] = useState('');
  const [damageWhId, setDamageWhId] = useState(warehouses[0]?.id || '');
  const [damageQty, setDamageQty] = useState(1);
  const [damageReason, setDamageReason] = useState('تلف في العبوة أثناء النقل أو انتهاء صلاحية');

  // Product form
  const [formData, setFormData] = useState<{
    code: string;
    barcode: string;
    name: string;
    category: string;
    baseUnit: string;
    units: ProductUnit[];
    size?: string;
    color?: string;
    purchasePrice: number;
    sellingPrice: number;
    minStockLevel: number;
    notes: string;
    initialStockPerWarehouse: Record<string, number>;
  }>({
    code: '',
    barcode: '',
    name: '',
    category: 'زيوت وسمن',
    baseUnit: 'قطعة',
    units: [],
    size: '',
    color: '',
    purchasePrice: 0,
    sellingPrice: 0,
    minStockLevel: 50,
    notes: '',
    initialStockPerWarehouse: {},
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => set.add(p.category));
    return ['all', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchSearch = 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.barcode.includes(searchTerm) ||
        p.category.toLowerCase().includes(searchTerm.toLowerCase());

      const matchCat = categoryFilter === 'all' ? true : p.category === categoryFilter;

      return matchSearch && matchCat;
    });
  }, [products, searchTerm, categoryFilter]);

  React.useEffect(() => {
    if (initialTab === 'transfers') {
      setTransferProdId(products[0]?.id || '');
      setIsTransferModalOpen(true);
    } else if (initialTab === 'adjustments') {
      setAdjustProdId(products[0]?.id || '');
      setIsAdjustModalOpen(true);
    } else if (initialTab === 'damaged') {
      setDamageProdId(products[0]?.id || '');
      setIsDamageModalOpen(true);
    }
  }, [initialTab, products]);

  const handleOpenAdd = () => {
    const nextCode = `FOOD-${(products.length + 101)}`;
    const nextBarcode = `622100100${(products.length + 1).toString().padStart(2, '0')}`;
    const initialStocks: Record<string, number> = {};
    warehouses.forEach(w => { initialStocks[w.id] = 100; });

    setFormData({
      code: nextCode,
      barcode: nextBarcode,
      name: '',
      category: 'زيوت وسمن',
      baseUnit: 'قطعة',
      units: [
        { id: 'u1', name: 'كرتونة (12 قطعة)', conversionFactor: 12, sellingPrice: 0, purchasePrice: 0 }
      ],
      size: '',
      color: '',
      purchasePrice: 0,
      sellingPrice: 0,
      minStockLevel: 50,
      notes: '',
      initialStockPerWarehouse: initialStocks,
    });
    setEditingProduct(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (p: Product) => {
    setFormData({
      code: p.code,
      barcode: p.barcode,
      name: p.name,
      category: p.category,
      baseUnit: p.baseUnit,
      units: p.units || [],
      size: p.size || '',
      color: p.color || '',
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      minStockLevel: p.minStockLevel,
      notes: p.notes || '',
      initialStockPerWarehouse: p.stockPerWarehouse,
    });
    setEditingProduct(p);
    setIsAddModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setProductModalError(null);

    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          name: formData.name.trim(),
          code: formData.code.trim(),
          barcode: formData.barcode.trim(),
          category: formData.category,
          baseUnit: formData.baseUnit.trim(),
          units: formData.units,
          size: formData.size?.trim() || undefined,
          color: formData.color?.trim() || undefined,
          purchasePrice: formData.purchasePrice,
          sellingPrice: formData.sellingPrice,
          minStockLevel: formData.minStockLevel,
          notes: formData.notes.trim(),
        });
      } else {
        await addProduct({
          code: formData.code.trim(),
          barcode: formData.barcode.trim(),
          name: formData.name.trim(),
          category: formData.category,
          baseUnit: formData.baseUnit.trim(),
          units: formData.units,
          size: formData.size?.trim() || undefined,
          color: formData.color?.trim() || undefined,
          purchasePrice: formData.purchasePrice,
          sellingPrice: formData.sellingPrice,
          minStockLevel: formData.minStockLevel,
          stockPerWarehouse: formData.initialStockPerWarehouse,
          status: 'active',
          notes: formData.notes.trim(),
        });
      }
      setIsAddModalOpen(false);
      setStatusBanner({ type: 'success', text: editingProduct ? 'تم تحديث بيانات الصنف بنجاح.' : 'تمت إضافة الصنف للمخزن بنجاح.' });
    } catch (err: any) {
      setProductModalError(err.message || 'حدث خطأ أثناء حفظ الصنف');
    }
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferModalError(null);
    const res = await transferStock(transferProdId, fromWhId, toWhId, transferQty, transferNotes || 'تحويل داخلي');
    if (!res.success) {
      setTransferModalError(res.error || 'فشل التحويل المخزني');
    } else {
      setIsTransferModalOpen(false);
      setStatusBanner({ type: 'success', text: 'تم تنفيذ التحويل المخزني بنجاح.' });
    }
  };

  const handleExecuteAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    await adjustStock(adjustProdId, adjustWhId, adjustNewQty, adjustReason);
    setIsAdjustModalOpen(false);
  };

  const handleExecuteDamage = async (e: React.FormEvent) => {
    e.preventDefault();
    await recordDamagedStock(damageProdId, damageWhId, damageQty, damageReason);
    setIsDamageModalOpen(false);
  };

  const handleExportExcel = () => {
    const headers = ['كود الصنف', 'الباركود', 'اسم المنتج الغذائي', 'التصنيف', 'الوحدة الأساسية', 'سعر الشراء', 'سعر البيع', 'إجمالي الرصيد', 'قيمة المخزون'];
    const rows = filteredProducts.map(p => {
      const totalQty = Object.values(p.stockPerWarehouse).reduce((a, b) => a + b, 0);
      return [
        p.code,
        p.barcode,
        p.name,
        p.category,
        p.baseUnit,
        p.purchasePrice,
        p.sellingPrice,
        totalQty,
        totalQty * p.purchasePrice,
      ];
    });
    exportToExcel(`مخزون_أولاد_سليم_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  if (initialTab === 'stock-counts') {
    return <StockCountView />;
  }

  if (initialTab === 'stock-transfers') {
    return <StockTransfersView />;
  }

  const unitsCatalog: UnitCatalogItem[] = settings.extraSettings?.unitsCatalog || [
    { id: 'u-piece', name: 'قطعة', shortCode: 'PCS', defaultConversionFactor: 1, notes: 'الوحدة الصغرى الافتراضية' },
    { id: 'u-carton12', name: 'كرتونة (12 قطعة)', shortCode: 'CTN12', defaultConversionFactor: 12, notes: 'كرتونة قياسية' },
    { id: 'u-sack25', name: 'شيكارة 25 كجم', shortCode: 'BAG25', defaultConversionFactor: 25, notes: 'أصناف الوزن والتعبئة' },
  ];

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    const res = await addCategory(newCategoryName.trim(), newCategoryDesc.trim());
    if (res.success) {
      setNewCategoryName('');
      setNewCategoryDesc('');
      setStatusBanner({ type: 'success', text: `تمت إضافة التصنيف (${res.category?.name}) بنجاح.` });
    } else {
      setStatusBanner({ type: 'error', text: res.error || 'تعذر إضافة التصنيف' });
    }
  };

  const handleConfirmRenameCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingCategory || !renameTargetValue.trim()) return;
    setIsRenamingCat(true);
    const res = await renameCategoryGlobal(renamingCategory.id, renameTargetValue.trim());
    setIsRenamingCat(false);
    if (res.success) {
      setStatusBanner({
        type: 'success',
        text: `تم تغيير اسم التصنيف من (${renamingCategory.currentName}) إلى (${renameTargetValue.trim()}) وتحديث جميع الأصناف المرتبطة به.`,
      });
      setRenamingCategory(null);
      setRenameTargetValue('');
    } else {
      setStatusBanner({ type: 'error', text: res.error || 'فشل تغيير اسم التصنيف' });
    }
  };

  const handleSaveUnitsCatalog = async (updatedList: UnitCatalogItem[], msg: string) => {
    setIsSavingUnits(true);
    try {
      await updateSettings({
        extraSettings: {
          ...(settings.extraSettings || {}),
          unitsCatalog: updatedList,
        },
      });
      setStatusBanner({ type: 'success', text: msg });
    } finally {
      setIsSavingUnits(false);
    }
  };

  const handleAddUnitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnitName.trim()) return;
    const item: UnitCatalogItem = {
      id: `unit-${Date.now().toString().slice(-6)}`,
      name: newUnitName.trim(),
      shortCode: newUnitCode.trim() || undefined,
      defaultConversionFactor: Math.max(1, Number(newUnitFactor) || 1),
      notes: newUnitNotes.trim() || undefined,
    };
    await handleSaveUnitsCatalog([...unitsCatalog, item], `تمت إضافة الوحدة (${item.name}) بنجاح.`);
    setNewUnitName('');
    setNewUnitCode('');
    setNewUnitFactor(1);
    setNewUnitNotes('');
  };

  if (initialTab === 'categories') {
    return (
      <div className="space-y-5">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Tag className="w-5 h-5 text-blue-900" />
              <span>تصنيفات السلع وتغيير اسم التصنيفات الشامل</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              إضافة التصنيفات وتغيير أسمائها مع التحديث التلقائي الشامل لكل المنتجات المرتبطة بها
            </p>
          </div>
        </div>

        {statusBanner && (
          <div className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between ${
            statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">إغلاق</button>
          </div>
        )}

        <form onSubmit={handleAddCategory} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs items-end">
          <div>
            <label className="block font-bold mb-1">اسم التصنيف الجديد: *</label>
            <input
              type="text"
              required
              placeholder="مثال: البقوليات والحبوب"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-2 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">وصف مختصر:</label>
            <input
              type="text"
              placeholder="ملاحظات عن المجموعة السلعية"
              value={newCategoryDesc}
              onChange={(e) => setNewCategoryDesc(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-2"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer">
            + إضافة تصنيف جديد
          </button>
        </form>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 border-b text-slate-700 font-bold">
                <th className="p-3.5">اسم التصنيف</th>
                <th className="p-3.5">الوصف</th>
                <th className="p-3.5 text-center">عدد الأصناف المرتبطة</th>
                <th className="p-3.5 text-center">الحالة</th>
                <th className="p-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categoryList.map(cat => {
                const linkedCount = products.filter(p => p.category === cat.name).length;
                return (
                  <tr key={cat.id} className="hover:bg-slate-50">
                    <td className="p-3.5 font-black text-slate-900">{cat.name}</td>
                    <td className="p-3.5 text-slate-600">{cat.description || '-'}</td>
                    <td className="p-3.5 text-center font-mono font-bold text-blue-900">{linkedCount} صنف</td>
                    <td className="p-3.5 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cat.status !== 'suspended' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-600'}`}>
                        {cat.status !== 'suspended' ? 'نشط' : 'موقوف'}
                      </span>
                    </td>
                    <td className="p-3.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingCategory({ id: cat.id, currentName: cat.name });
                            setRenameTargetValue(cat.name);
                          }}
                          className="px-3 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold border border-blue-200 cursor-pointer"
                        >
                          تغيير الاسم الشامل
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleCategoryStatus(cat.id)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                        >
                          {cat.status !== 'suspended' ? 'إيقاف' : 'تفعيل'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Modal
          isOpen={!!renamingCategory}
          onClose={() => setRenamingCategory(null)}
          title={`تغيير اسم التصنيف: ${renamingCategory?.currentName || ''}`}
          subtitle="سيتم تحديث اسم التصنيف في جميع المنتجات المرتبطة به تلقائياً على الخادم"
          maxWidth="md"
        >
          <form onSubmit={handleConfirmRenameCategory} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold mb-1">الاسم الجديد للتصنيف: *</label>
              <input
                type="text"
                required
                value={renameTargetValue}
                onChange={(e) => setRenameTargetValue(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-2.5 font-bold"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setRenamingCategory(null)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">
                إلغاء
              </button>
              <button type="submit" disabled={isRenamingCat} className="px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer disabled:opacity-50">
                {isRenamingCat ? 'جاري التحديث...' : 'تطبيق التغيير الشامل'}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  if (initialTab === 'units') {
    return (
      <div className="space-y-5">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Ruler className="w-5 h-5 text-blue-900" />
            <span>دليل الوحدات ومعاملات التحويل</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            تجهيز وحدات القياس والتعبئة القياسية (قطعة، دستة، كرتونة، شيكارة، بالة) لاستخدامها السريع في الأصناف
          </p>
        </div>

        {statusBanner && (
          <div className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between ${
            statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">إغلاق</button>
          </div>
        )}

        <form onSubmit={handleAddUnitItem} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs items-end">
          <div>
            <label className="block font-bold mb-1">اسم الوحدة: *</label>
            <input
              type="text"
              required
              placeholder="مثال: كرتونة 24"
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-2 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">الرمز المختصر:</label>
            <input
              type="text"
              placeholder="CTN24"
              value={newUnitCode}
              onChange={(e) => setNewUnitCode(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">معامل التحويل الأساسي:</label>
            <input
              type="number"
              min="1"
              required
              value={newUnitFactor}
              onChange={(e) => setNewUnitFactor(Number(e.target.value))}
              className="w-full border border-slate-300 rounded-xl p-2 font-mono font-bold text-center"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">ملاحظات:</label>
            <input
              type="text"
              value={newUnitNotes}
              onChange={(e) => setNewUnitNotes(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-2"
            />
          </div>
          <button type="submit" disabled={isSavingUnits} className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer disabled:opacity-50">
            + إضافة وحدة
          </button>
        </form>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 border-b text-slate-700 font-bold">
                <th className="p-3.5">اسم الوحدة</th>
                <th className="p-3.5">الرمز</th>
                <th className="p-3.5 text-center">معامل التحويل الافتراضي</th>
                <th className="p-3.5">ملاحظات</th>
                <th className="p-3.5 text-center">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {unitsCatalog.map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="p-3.5 font-black text-slate-900">{u.name}</td>
                  <td className="p-3.5 font-mono text-blue-900 font-bold">{u.shortCode || '-'}</td>
                  <td className="p-3.5 text-center font-mono font-bold">{u.defaultConversionFactor}</td>
                  <td className="p-3.5 text-slate-600">{u.notes || '-'}</td>
                  <td className="p-3.5 text-center">
                    <button
                      type="button"
                      onClick={() => handleSaveUnitsCatalog(unitsCatalog.filter(x => x.id !== u.id), `تم حذف الوحدة (${u.name}).`)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                      title="حذف الوحدة"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إدارة المخازن والمنتجات الغذائية</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            متابعة أرصدة السلع، أسعار الجملة، التحويلات بين المستودعات، والجرد
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 text-slate-700"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>

          <button
            onClick={() => {
              setTransferProdId(products[0]?.id || '');
              setIsTransferModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-colors"
          >
            <ArrowLeftRight className="w-4 h-4 text-indigo-700" />
            <span>تحويل بين المستودعات</span>
          </button>

          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-black shadow-md shadow-blue-900/20 active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة صنف جديد</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between ${
          statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
        }`}>
          <span>{statusBanner.text}</span>
          <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">إغلاق</button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="relative">
          <input
            type="text"
            placeholder="بحث بالاسم أو الباركود أو الكود أو التصنيف..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2 pr-9 pl-3 text-xs focus:bg-white focus:border-blue-600 outline-hidden"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
        </div>

        <div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
          >
            <option value="all">-- جميع التصنيفات الغذائية --</option>
            {categories.filter(c => c !== 'all').map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-end text-xs text-slate-600 font-bold">
          <span>إجمالي الأصناف المعروضة: {filteredProducts.length} صنف</span>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <th className="p-3.5">الكود / الباركود</th>
                <th className="p-3.5">اسم الصنف الغذائي</th>
                <th className="p-3.5">التصنيف</th>
                <th className="p-3.5">الوحدات الإضافية</th>
                <th className="p-3.5 text-center">سعر الشراء</th>
                <th className="p-3.5 text-center">سعر البيع</th>
                <th className="p-3.5 text-center">الرصيد الإجمالي</th>
                <th className="p-3.5 text-center">حالة المخزون</th>
                <th className="p-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    لا توجد أصناف غذائية مسجلة في المخزن بعد. انقر على "+ إضافة صنف جديد" للبدء بإضافة السلع.
                  </td>
                </tr>
              ) : (
                filteredProducts.map(prod => {
                  const totalStock = Object.values(prod.stockPerWarehouse).reduce((a, b) => a + b, 0);
                  const isLow = totalStock <= prod.minStockLevel;

                  return (
                    <tr key={prod.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 font-mono">
                      <div className="font-bold text-blue-950">{prod.code}</div>
                      <div className="text-[10px] text-slate-400">{prod.barcode}</div>
                    </td>
                    <td className="p-3.5">
                      <span className="font-bold text-slate-900 block text-xs">{prod.name}</span>
                      <span className="text-[10px] text-slate-500">الوحدة الأساسية: {prod.baseUnit}</span>
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[10px]">
                        {prod.category}
                      </span>
                    </td>
                    <td className="p-3.5">
                      {prod.units && prod.units.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {prod.units.map(u => (
                            <span key={u.id} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 text-[10px] font-semibold border border-blue-200">
                              {u.name} ({u.sellingPrice} {settings.currency})
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[10px]">أساسية فقط</span>
                      )}
                    </td>
                    <td className="p-3.5 text-center font-mono font-bold text-slate-700">
                      {prod.purchasePrice.toFixed(2)}
                    </td>
                    <td className="p-3.5 text-center font-mono font-black text-blue-900">
                      {prod.sellingPrice.toFixed(2)} {settings.currency}
                    </td>
                    <td className="p-3.5 text-center font-mono font-black text-sm">
                      {totalStock.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">{prod.baseUnit}</span>
                    </td>
                    <td className="p-3.5 text-center">
                      {isLow ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold text-[10px] border border-red-300">
                          نقص مخزون (حد أدنى: {prod.minStockLevel})
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                          متوفر كافي
                        </span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => {
                            setAdjustProdId(prod.id);
                            setAdjustNewQty(totalStock);
                            setIsAdjustModalOpen(true);
                          }}
                          className="p-1 rounded-lg text-slate-500 hover:text-blue-900 hover:bg-slate-100 text-[11px] font-bold"
                          title="تسوية جردية"
                        >
                          تسوية
                        </button>
                        <button
                          onClick={() => {
                            setDamageProdId(prod.id);
                            setIsDamageModalOpen(true);
                          }}
                          className="p-1 rounded-lg text-amber-600 hover:bg-amber-50 text-[11px] font-bold"
                          title="إثبات تالف"
                        >
                          تالف
                        </button>
                        <button
                          onClick={() => handleOpenEdit(prod)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-900 hover:bg-slate-100"
                          title="تعديل"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingProduct ? 'تعديل بيانات المنتج الغذائي' : 'إضافة منتج غذائي جديد للمخزن'}
        maxWidth="4xl"
      >
        <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
          {productModalError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
              {productModalError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">كود الصنف:</label>
              <input
                type="text"
                required
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">الباركود الدولي:</label>
              <input
                type="text"
                required
                value={formData.barcode}
                onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">التصنيف:</label>
              <input
                type="text"
                required
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">المقاس (اختياري عند الحاجة):</label>
              <input
                type="text"
                placeholder="مثال: وسط، كبير، 500 جرام، 1 لتر"
                value={formData.size || ''}
                onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">اللون / النكهة (اختياري عند الحاجة):</label>
              <input
                type="text"
                placeholder="مثال: أحمر، شطة وليمون، جبنة متبلة"
                value={formData.color || ''}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
              />
            </div>
          </div>

          {/* Flexible Packaging Units Configuration (Section 2) */}
          <div className="bg-blue-50/60 p-3.5 rounded-xl border border-blue-200 space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-blue-950 text-xs">وحدات التعبئة الإضافية ومعامل التحويل (مثلاً: الكرتونة = 12 قطعة):</label>
              <button
                type="button"
                onClick={() => {
                  const newUnit: ProductUnit = {
                    id: `u-${Date.now().toString().slice(-4)}`,
                    name: 'كرتونة',
                    conversionFactor: 12,
                    sellingPrice: (formData.sellingPrice || 0) * 12,
                    purchasePrice: (formData.purchasePrice || 0) * 12,
                  };
                  setFormData(prev => ({ ...prev, units: [...prev.units, newUnit] }));
                }}
                className="text-[11px] bg-blue-900 text-white px-2.5 py-1 rounded-lg font-bold hover:bg-blue-950 cursor-pointer"
              >
                + إضافة وحدة تعبئة
              </button>
            </div>

            {formData.units.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">لا توجد وحدات تعبئة إضافية (البيع بالوحدة الصغرى الأساسية فقط)</p>
            ) : (
              <div className="space-y-2">
                {formData.units.map((u, idx) => (
                  <div key={u.id} className="grid grid-cols-1 sm:grid-cols-5 gap-2 bg-white p-2 rounded-lg border border-blue-200 items-center text-xs">
                    <div>
                      <span className="block text-[10px] text-slate-500 font-bold">اسم الوحدة:</span>
                      <input
                        type="text"
                        value={u.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormData(prev => ({
                            ...prev,
                            units: prev.units.map((unit, i) => i === idx ? { ...unit, name: val } : unit),
                          }));
                        }}
                        className="w-full border rounded-md p-1 font-bold text-xs"
                      />
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-500 font-bold">تحتوي كم أساسي؟</span>
                      <input
                        type="number"
                        min="1"
                        value={u.conversionFactor}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 1;
                          setFormData(prev => ({
                            ...prev,
                            units: prev.units.map((unit, i) => i === idx ? { ...unit, conversionFactor: val } : unit),
                          }));
                        }}
                        className="w-full border rounded-md p-1 font-mono font-bold text-center text-xs"
                      />
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-500 font-bold">سعر البيع:</span>
                      <input
                        type="number"
                        step="0.5"
                        value={u.sellingPrice}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setFormData(prev => ({
                            ...prev,
                            units: prev.units.map((unit, i) => i === idx ? { ...unit, sellingPrice: val } : unit),
                          }));
                        }}
                        className="w-full border rounded-md p-1 font-mono font-bold text-blue-900 text-xs"
                      />
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-500 font-bold">سعر الشراء:</span>
                      <input
                        type="number"
                        step="0.5"
                        value={u.purchasePrice}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setFormData(prev => ({
                            ...prev,
                            units: prev.units.map((unit, i) => i === idx ? { ...unit, purchasePrice: val } : unit),
                          }));
                        }}
                        className="w-full border rounded-md p-1 font-mono font-bold text-slate-700 text-xs"
                      />
                    </div>
                    <div className="flex items-end justify-center pt-3 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            units: prev.units.filter((_, i) => i !== idx),
                          }));
                        }}
                        className="text-red-500 hover:text-red-700 p-1 text-[11px] font-bold"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div>
              <label className="block font-bold text-slate-700 mb-1">الوحدة الصغرى الأساسية:</label>
              <input
                type="text"
                required
                placeholder="قطعة، كيس، كيلو، علبة"
                value={formData.baseUnit}
                onChange={(e) => setFormData({ ...formData, baseUnit: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">سعر شراء الوحدة الأساسية:</label>
              <input
                type="number"
                step="0.5"
                required
                value={formData.purchasePrice}
                onChange={(e) => setFormData({ ...formData, purchasePrice: Number(e.target.value) })}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">سعر بيع الوحدة الأساسية:</label>
              <input
                type="number"
                step="0.5"
                required
                value={formData.sellingPrice}
                onChange={(e) => setFormData({ ...formData, sellingPrice: Number(e.target.value) })}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 font-mono font-black text-blue-900"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">حد الطلب الأدنى للتنبيه:</label>
              <input
                type="number"
                required
                value={formData.minStockLevel}
                onChange={(e) => setFormData({ ...formData, minStockLevel: Number(e.target.value) })}
                className="w-full bg-white border border-slate-300 rounded-xl p-2 font-mono font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">ملاحظات الصنف وتواريخ الصلاحية:</label>
            <textarea
              rows={2}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full bg-white border border-slate-300 rounded-xl p-2.5 outline-hidden"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-950 shadow-md"
            >
              حفظ المنتج
            </button>
          </div>
        </form>
      </Modal>

      {/* Inter-Warehouse Stock Transfer Modal */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title="تحويل مخزني بين المستودعات"
        subtitle="نقل كميات بضائع من مستودع لآخر مع توثيق الحركة"
        maxWidth="lg"
      >
        <form onSubmit={handleExecuteTransfer} className="space-y-4 text-xs">
          {transferModalError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
              {transferModalError}
            </div>
          )}
          <div>
            <label className="block font-bold text-slate-700 mb-1">اختر الصنف الغذائي:</label>
            <select
              value={transferProdId}
              onChange={(e) => setTransferProdId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
            >
              {products.length === 0 ? (
                <option value="">-- لا توجد أصناف بالمخزن بعد --</option>
              ) : (
                products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">من مستودع:</label>
              <select
                value={fromWhId}
                onChange={(e) => setFromWhId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">إلى مستودع:</label>
              <select
                value={toWhId}
                onChange={(e) => setToWhId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">الكمية المحولة (بالوحدة الأساسية):</label>
            <input
              type="number"
              min="1"
              required
              value={transferQty}
              onChange={(e) => setTransferQty(Number(e.target.value))}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">بيان وسبب التحويل:</label>
            <input
              type="text"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              placeholder="تغذية فرع العبور / تجهيز سيارة التوزيع..."
              className="w-full bg-white border border-slate-300 rounded-xl p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button
              type="button"
              onClick={() => setIsTransferModalOpen(false)}
              className="px-4 py-2 border rounded-xl font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-indigo-900 text-white rounded-xl font-bold shadow-md hover:bg-indigo-950"
            >
              تنفيذ التحويل المخزني
            </button>
          </div>
        </form>
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal
        isOpen={isAdjustModalOpen}
        onClose={() => setIsAdjustModalOpen(false)}
        title="تسوية جردية للمخزون"
        subtitle="تعديل الرصيد الفعلي بعد الجرد وتوثيق الفروقات"
        maxWidth="md"
      >
        <form onSubmit={handleExecuteAdjust} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">المستودع:</label>
            <select
              value={adjustWhId}
              onChange={(e) => setAdjustWhId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
            >
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">الرصيد الفعلي الجديد بعد الجرد:</label>
            <input
              type="number"
              min="0"
              required
              value={adjustNewQty}
              onChange={(e) => setAdjustNewQty(Number(e.target.value))}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">سبب التسوية:</label>
            <input
              type="text"
              required
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button
              type="button"
              onClick={() => setIsAdjustModalOpen(false)}
              className="px-4 py-2 border rounded-xl font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold"
            >
              اعتماد التسوية الجردية
            </button>
          </div>
        </form>
      </Modal>

      {/* Damaged Goods Modal */}
      <Modal
        isOpen={isDamageModalOpen}
        onClose={() => setIsDamageModalOpen(false)}
        title="إثبات بضاعة تالفة / منتهية الصلاحية"
        subtitle="خصم الكميات التالفة من المستودع مع توثيق الأسباب"
        maxWidth="md"
      >
        <form onSubmit={handleExecuteDamage} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">المستودع:</label>
            <select
              value={damageWhId}
              onChange={(e) => setDamageWhId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
            >
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">الكمية التالفة:</label>
            <input
              type="number"
              min="1"
              required
              value={damageQty}
              onChange={(e) => setDamageQty(Number(e.target.value))}
              className="w-full bg-red-50 border border-red-300 rounded-xl p-2.5 font-mono font-black text-center text-red-900 text-sm"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">سبب التلف:</label>
            <input
              type="text"
              required
              value={damageReason}
              onChange={(e) => setDamageReason(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button
              type="button"
              onClick={() => setIsDamageModalOpen(false)}
              className="px-4 py-2 border rounded-xl font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-md"
            >
              إثبات وخصم التوالف
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

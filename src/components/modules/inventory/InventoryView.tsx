import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Boxes, Plus, Search, ArrowLeftRight,
  Trash2, Edit, Download, RefreshCw,
  Tag, Ruler, Warehouse as WarehouseIcon, History, Image as ImageIcon, Power, X
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { Product, ProductUnit, UnitCatalogItem, Warehouse } from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { exportToExcel } from '../../common/ExcelExporter';
import { compressImageFileToDataUrl } from '../../../utils/image';
import { StockCountView } from './StockCountView';
import { StockTransfersView } from './StockTransfersView';

export interface InventoryViewProps {
  initialTab?: 'products' | 'categories' | 'warehouses' | 'transfers' | 'adjustments' | 'damaged' | 'movements' | 'stock-counts' | 'stock-transfers' | 'units' | string;
}

export const InventoryView: React.FC<InventoryViewProps> = ({ initialTab = 'products' }) => {
  const { 
    products, warehouses, categories: categoryList, stockMovements, settings, addProduct, updateProduct, 
    deleteProduct, toggleProductStatus, transferStock, adjustStock, recordDamagedStock,
    addCategory, renameCategoryGlobal, toggleCategoryStatus, addWarehouse, updateWarehouse, toggleWarehouseStatus, updateSettings,
  } = useData();
  const { hasPermission } = useAuth();
  const { registerHandler, consumePendingAction } = useShortcuts();

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [productModalError, setProductModalError] = useState<string | null>(null);
  const [transferModalError, setTransferModalError] = useState<string | null>(null);
  const [adjustModalError, setAdjustModalError] = useState<string | null>(null);
  const [damageModalError, setDamageModalError] = useState<string | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);
  const [isSubmittingAdjust, setIsSubmittingAdjust] = useState(false);
  const [isSubmittingDamage, setIsSubmittingDamage] = useState(false);
  const [isSavingWh, setIsSavingWh] = useState(false);

  // Warehouses Management & Confirm Dialog State
  const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [whModalError, setWhModalError] = useState<string | null>(null);
  const [whForm, setWhForm] = useState<{
    name: string;
    code: string;
    location: string;
    managerName: string;
    phone: string;
    isDefault: boolean;
  }>({
    name: '',
    code: '',
    location: '',
    managerName: '',
    phone: '',
    isDefault: false,
  });

  // Movements Filter State
  const [movementSearch, setMovementSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState('all');
  const [movementWhFilter, setMovementWhFilter] = useState('all');

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info' | 'success';
    onConfirm: () => Promise<void> | void;
  } | null>(null);

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
  const [toWhId, setToWhId] = useState(warehouses[1]?.id || warehouses[0]?.id || '');
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
    image?: string;
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
    image: '',
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

  useEffect(() => {
    const firstWh = warehouses[0]?.id || '';
    const secondWh = warehouses[1]?.id || firstWh;
    if (!warehouses.some((w) => w.id === fromWhId) && firstWh) setFromWhId(firstWh);
    if (!warehouses.some((w) => w.id === toWhId) && secondWh) setToWhId(secondWh);
    if (!warehouses.some((w) => w.id === adjustWhId) && firstWh) setAdjustWhId(firstWh);
    if (!warehouses.some((w) => w.id === damageWhId) && firstWh) setDamageWhId(firstWh);
  }, [warehouses, fromWhId, toWhId, adjustWhId, damageWhId]);

  React.useEffect(() => {
    if (initialTab === 'transfers') {
      setTransferProdId((prev) => prev || products[0]?.id || '');
      setIsTransferModalOpen(true);
    } else if (initialTab === 'adjustments') {
      setAdjustProdId((prev) => prev || products[0]?.id || '');
      setIsAdjustModalOpen(true);
    } else if (initialTab === 'damaged') {
      setDamageProdId((prev) => prev || products[0]?.id || '');
      setIsDamageModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  useEffect(() => {
    if (isTransferModalOpen && !transferProdId && products[0]?.id) setTransferProdId(products[0].id);
    if (isAdjustModalOpen && !adjustProdId && products[0]?.id) setAdjustProdId(products[0].id);
    if (isDamageModalOpen && !damageProdId && products[0]?.id) setDamageProdId(products[0].id);
  }, [isTransferModalOpen, isAdjustModalOpen, isDamageModalOpen, transferProdId, adjustProdId, damageProdId, products]);

  const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setFormData((prev) => ({ ...prev, image: dataUrl }));
    } catch (err: any) {
      setProductModalError(err?.message || 'تعذر قراءة أو ضغط صورة الصنف');
    }
  };

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
      image: '',
      notes: '',
      initialStockPerWarehouse: initialStocks,
    });
    setProductModalError(null);
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
      image: p.image || '',
      notes: p.notes || '',
      initialStockPerWarehouse: p.stockPerWarehouse,
    });
    setProductModalError(null);
    setEditingProduct(p);
    setIsAddModalOpen(true);
  };

  const openAddRef = useRef(handleOpenAdd);
  openAddRef.current = handleOpenAdd;

  useEffect(() => {
    if (consumePendingAction('action:add_product')) {
      openAddRef.current();
    }
    return registerHandler('action:add_product', () => openAddRef.current());
  }, [consumePendingAction, registerHandler]);

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingProduct) return;
    setProductModalError(null);
    if (!formData.name.trim()) {
      setProductModalError('يرجى إدخال اسم الصنف الغذائي');
      return;
    }
    if (formData.purchasePrice < 0 || formData.sellingPrice < 0) {
      setProductModalError('لا يمكن أن تكون أسعار الشراء أو البيع سالبة');
      return;
    }
    setIsSavingProduct(true);

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
          image: formData.image || '',
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
          image: formData.image || undefined,
          stockPerWarehouse: formData.initialStockPerWarehouse,
          status: 'active',
          notes: formData.notes.trim(),
        });
      }
      setIsAddModalOpen(false);
      setStatusBanner({ type: 'success', text: editingProduct ? 'تم تحديث بيانات الصنف بنجاح.' : 'تمت إضافة الصنف للمخزن بنجاح.' });
    } catch (err: any) {
      setProductModalError(err.message || 'حدث خطأ أثناء حفظ الصنف');
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingTransfer) return;
    setTransferModalError(null);
    setIsSubmittingTransfer(true);
    try {
      const res = await transferStock(transferProdId, fromWhId, toWhId, transferQty, transferNotes || 'تحويل داخلي');
      if (!res.success) {
        setTransferModalError(res.error || 'فشل التحويل المخزني');
      } else {
        setIsTransferModalOpen(false);
        setStatusBanner({ type: 'success', text: 'تم تنفيذ التحويل المخزني بنجاح.' });
      }
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  const handleExecuteAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingAdjust) return;
    setAdjustModalError(null);
    setIsSubmittingAdjust(true);
    try {
      await adjustStock(adjustProdId, adjustWhId, adjustNewQty, adjustReason);
      setIsAdjustModalOpen(false);
      setStatusBanner({ type: 'success', text: 'تم اعتماد التسوية الجردية للمخزون بنجاح.' });
    } catch (err: any) {
      setAdjustModalError(err?.message || 'تعذر اعتماد التسوية الجردية');
    } finally {
      setIsSubmittingAdjust(false);
    }
  };

  const handleExecuteDamage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingDamage) return;
    setDamageModalError(null);
    setIsSubmittingDamage(true);
    try {
      await recordDamagedStock(damageProdId, damageWhId, damageQty, damageReason);
      setIsDamageModalOpen(false);
      setStatusBanner({ type: 'success', text: 'تم تسجيل وخصم التالف من المخزون بنجاح.' });
    } catch (err: any) {
      setDamageModalError(err?.message || 'تعذر تسجيل البضاعة التالفة');
    } finally {
      setIsSubmittingDamage(false);
    }
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

  if (initialTab === 'warehouses') {
    const handleSaveWh = async (e: React.FormEvent) => {
      e.preventDefault();
      if (isSavingWh) return;
      setWhModalError(null);
      if (!whForm.name.trim()) {
        setWhModalError('يرجى إدخال اسم المستودع');
        return;
      }
      setIsSavingWh(true);
      try {
        if (editingWarehouse) {
          await updateWarehouse(editingWarehouse.id, {
            name: whForm.name.trim(),
            code: whForm.code.trim() || editingWarehouse.code,
            location: whForm.location.trim(),
            managerName: whForm.managerName.trim(),
            phone: whForm.phone.trim(),
            isDefault: whForm.isDefault,
          });
          setStatusBanner({ type: 'success', text: `تم تحديث بيانات المستودع (${whForm.name.trim()}) بنجاح.` });
          setIsWarehouseModalOpen(false);
        } else {
          const res = await addWarehouse({
            name: whForm.name.trim(),
            code: whForm.code.trim() || `WH-${(warehouses.length + 1).toString().padStart(2, '0')}`,
            location: whForm.location.trim() || 'الفرع',
            managerName: whForm.managerName.trim(),
            phone: whForm.phone.trim(),
            isDefault: whForm.isDefault,
            status: 'active',
          });
          if (!res.success) {
            setWhModalError(res.error || 'تعذر إضافة المستودع');
            return;
          }
          setStatusBanner({ type: 'success', text: `تمت إضافة المستودع (${whForm.name.trim()}) بنجاح.` });
          setIsWarehouseModalOpen(false);
        }
      } catch (err: any) {
        setWhModalError(err?.message || 'تعذر حفظ بيانات المستودع');
      } finally {
        setIsSavingWh(false);
      }
    };

    return (
      <div className="space-y-5">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <WarehouseIcon className="w-5 h-5 text-blue-900" />
              <span>إدارة المستودعات والمخازن</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              إضافة وتعديل المستودعات ومتابعة إجمالي الكميات والقيمة المخزنية في كل مستودع
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingWarehouse(null);
              setWhForm({
                name: '',
                code: `WH-${(warehouses.length + 1).toString().padStart(2, '0')}`,
                location: '',
                managerName: '',
                phone: '',
                isDefault: false,
              });
              setWhModalError(null);
              setIsWarehouseModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة مستودع جديد</span>
          </button>
        </div>

        {statusBanner && (
          <div className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between ${
            statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">إغلاق</button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {warehouses.map((wh) => {
            const totalUnits = products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0), 0);
            const activeSkuCount = products.filter((p) => Number(p.stockPerWarehouse?.[wh.id] || 0) > 0).length;
            const totalValue = products.reduce(
              (sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0) * Number(p.purchasePrice || 0),
              0
            );
            const isSuspended = wh.status === 'suspended';

            return (
              <div key={wh.id} className={`bg-white p-5 rounded-2xl border shadow-xs space-y-3 text-xs ${isSuspended ? 'border-slate-200 opacity-75' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-2 border-b pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-black text-sm text-slate-900">{wh.name}</h3>
                      {wh.isDefault && (
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[10px] font-black">افتراضي</span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">كود: {wh.code}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isSuspended ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {isSuspended ? 'موقوف' : 'نشط'}
                  </span>
                </div>

                <div className="space-y-1 text-slate-600">
                  <div>الموقع: <strong className="text-slate-900">{wh.location || '-'}</strong></div>
                  <div>أمين المستودع: <strong className="text-slate-900">{wh.managerName || '-'}</strong></div>
                  <div>الهاتف: <strong className="font-mono text-slate-900">{wh.phone || '-'}</strong></div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center">
                  <div className="bg-slate-50 p-2 rounded-xl">
                    <span className="block text-[10px] text-slate-500">أصناف متوفرة</span>
                    <strong className="font-mono text-slate-900">{activeSkuCount}</strong>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-xl">
                    <span className="block text-[10px] text-slate-500">إجمالي الوحدات</span>
                    <strong className="font-mono text-blue-900">{totalUnits.toLocaleString()}</strong>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-xl">
                    <span className="block text-[10px] text-slate-500">القيمة الشرائية</span>
                    <strong className="font-mono text-emerald-700">{Math.round(totalValue).toLocaleString()}</strong>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingWarehouse(wh);
                      setWhForm({
                        name: wh.name,
                        code: wh.code,
                        location: wh.location || '',
                        managerName: wh.managerName || '',
                        phone: wh.phone || '',
                        isDefault: Boolean(wh.isDefault),
                      });
                      setWhModalError(null);
                      setIsWarehouseModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer"
                  >
                    تعديل
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmState({
                        isOpen: true,
                        title: isSuspended ? 'تفعيل المستودع' : 'إيقاف المستودع',
                        message: `هل تريد ${isSuspended ? 'تفعيل' : 'إيقاف'} المستودع (${wh.name})؟`,
                        variant: isSuspended ? 'info' : 'warning',
                        onConfirm: async () => {
                          const res = await toggleWarehouseStatus(wh.id);
                          setConfirmState(null);
                          if (!res.success) {
                            setStatusBanner({ type: 'error', text: res.error || 'تعذر تغيير حالة المستودع' });
                          } else {
                            setStatusBanner({ type: 'success', text: `تم ${isSuspended ? 'تفعيل' : 'إيقاف'} المستودع بنجاح.` });
                          }
                        },
                      });
                    }}
                    className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${isSuspended ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}
                  >
                    {isSuspended ? 'تفعيل' : 'إيقاف'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <Modal
          isOpen={isWarehouseModalOpen}
          onClose={() => setIsWarehouseModalOpen(false)}
          title={editingWarehouse ? `تعديل المستودع: ${editingWarehouse.name}` : 'إضافة مستودع جديد'}
          maxWidth="lg"
        >
          <form onSubmit={handleSaveWh} className="space-y-4 text-xs">
            {whModalError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{whModalError}</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1">اسم المستودع: *</label>
                <input
                  type="text"
                  required
                  value={whForm.name}
                  onChange={(e) => setWhForm({ ...whForm, name: e.target.value })}
                  placeholder="مثال: المخزن الرئيسي - شبرا"
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">كود المستودع:</label>
                <input
                  type="text"
                  value={whForm.code}
                  onChange={(e) => setWhForm({ ...whForm, code: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">العنوان / الموقع:</label>
                <input
                  type="text"
                  value={whForm.location}
                  onChange={(e) => setWhForm({ ...whForm, location: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">أمين المستودع المسؤول:</label>
                <input
                  type="text"
                  value={whForm.managerName}
                  onChange={(e) => setWhForm({ ...whForm, managerName: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">رقم الهاتف:</label>
                <input
                  type="text"
                  value={whForm.phone}
                  onChange={(e) => setWhForm({ ...whForm, phone: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  id="wh-default-check"
                  type="checkbox"
                  checked={whForm.isDefault}
                  onChange={(e) => setWhForm({ ...whForm, isDefault: e.target.checked })}
                />
                <label htmlFor="wh-default-check" className="font-bold cursor-pointer">مستودع افتراضي للفواتير</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <button type="button" onClick={() => setIsWarehouseModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">إلغاء</button>
              <button type="submit" disabled={isSavingWh} className="px-6 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer disabled:opacity-50">
                {isSavingWh ? 'جاري الحفظ...' : 'حفظ المستودع'}
              </button>
            </div>
          </form>
        </Modal>

        {confirmState && (
          <ConfirmDialog
            isOpen={confirmState.isOpen}
            onClose={() => setConfirmState(null)}
            onConfirm={confirmState.onConfirm}
            title={confirmState.title}
            message={confirmState.message}
            variant={confirmState.variant}
          />
        )}
      </div>
    );
  }

  if (initialTab === 'movements') {
    const MOVEMENT_LABELS: Record<string, { label: string; cls: string }> = {
      opening: { label: 'رصيد افتتاحي', cls: 'bg-slate-100 text-slate-700' },
      purchase: { label: 'فاتورة شراء (+)', cls: 'bg-emerald-100 text-emerald-800' },
      sale: { label: 'فاتورة بيع (-)', cls: 'bg-blue-100 text-blue-900' },
      sale_return: { label: 'مرتجع بيع (+)', cls: 'bg-teal-100 text-teal-800' },
      purchase_return: { label: 'مرتجع شراء (-)', cls: 'bg-amber-100 text-amber-800' },
      transfer_in: { label: 'تحويل وارد (+)', cls: 'bg-indigo-100 text-indigo-800' },
      transfer_out: { label: 'تحويل صادر (-)', cls: 'bg-purple-100 text-purple-800' },
      adjustment: { label: 'تسوية جردية', cls: 'bg-sky-100 text-sky-900' },
      damaged: { label: 'إثبات تالف (-)', cls: 'bg-red-100 text-red-800' },
    };

    const q = movementSearch.trim().toLowerCase();
    const filteredMovements = [...stockMovements]
      .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))
      .filter((m) => {
        if (movementTypeFilter !== 'all' && m.type !== movementTypeFilter) return false;
        if (movementWhFilter !== 'all' && m.warehouseId !== movementWhFilter && m.targetWarehouseId !== movementWhFilter) return false;
        if (q) {
          return (
            (m.productName || '').toLowerCase().includes(q) ||
            (m.referenceNumber || '').toLowerCase().includes(q) ||
            (m.notes || '').toLowerCase().includes(q) ||
            (m.warehouseName || '').toLowerCase().includes(q)
          );
        }
        return true;
      });

    return (
      <div className="space-y-5">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-blue-900" />
              <span>سجل حركات المخازن التفصيلي</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تتبع كل حركة دخول وخروج وتحويل وتسوية وجرد وتلف للأصناف عبر جميع المستودعات ({filteredMovements.length} حركة)
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const headers = ['التاريخ', 'نوع الحركة', 'الصنف', 'المستودع', 'الكمية', 'رقم المرجع', 'ملاحظات', 'بواسطة'];
              const rows = filteredMovements.map((m) => [
                m.date,
                MOVEMENT_LABELS[m.type]?.label || m.type,
                m.productName,
                m.warehouseName,
                m.quantity,
                m.referenceNumber || '-',
                m.notes || '-',
                m.createdBy,
              ]);
              exportToExcel(`سجل_حركات_المخازن_${new Date().toISOString().split('T')[0]}`, headers, rows);
            }}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="relative">
            <input
              type="text"
              placeholder="بحث بالصنف أو رقم المرجع أو البيان..."
              value={movementSearch}
              onChange={(e) => setMovementSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2 pr-9 pl-3"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          </div>
          <select
            value={movementTypeFilter}
            onChange={(e) => setMovementTypeFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold"
          >
            <option value="all">-- جميع أنواع الحركات --</option>
            {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            value={movementWhFilter}
            onChange={(e) => setMovementWhFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold"
          >
            <option value="all">-- جميع المستودعات --</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                  <th className="p-3.5">التاريخ</th>
                  <th className="p-3.5">نوع الحركة</th>
                  <th className="p-3.5">الصنف</th>
                  <th className="p-3.5">المستودع</th>
                  <th className="p-3.5 text-center">الكمية</th>
                  <th className="p-3.5">المرجع</th>
                  <th className="p-3.5">ملاحظات</th>
                  <th className="p-3.5">بواسطة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMovements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400">
                      لا توجد حركات مخزنية مطابقة للبحث.
                    </td>
                  </tr>
                ) : (
                  filteredMovements.slice(0, 300).map((m) => {
                    const meta = MOVEMENT_LABELS[m.type] || { label: m.type, cls: 'bg-slate-100 text-slate-700' };
                    return (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-mono text-slate-600">{m.date}</td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>
                        </td>
                        <td className="p-3.5 font-bold text-slate-900">{m.productName}</td>
                        <td className="p-3.5">
                          <span>{m.warehouseName}</span>
                          {m.targetWarehouseName && (
                            <span className="text-[10px] text-indigo-700 block">← {m.targetWarehouseName}</span>
                          )}
                        </td>
                        <td className="p-3.5 text-center font-mono font-black">{Number(m.quantity || 0).toLocaleString()}</td>
                        <td className="p-3.5 font-mono text-blue-900">{m.referenceNumber || '-'}</td>
                        <td className="p-3.5 text-slate-600">{m.notes || '-'}</td>
                        <td className="p-3.5">{m.createdBy}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
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

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden awlad-table-scroll">
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

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden awlad-table-scroll">
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
                      onClick={() => {
                        setConfirmState({
                          isOpen: true,
                          title: 'حذف وحدة القياس',
                          message: `هل تريد حذف الوحدة (${u.name}) من الدليل؟`,
                          variant: 'danger',
                          onConfirm: async () => {
                            setConfirmState(null);
                            await handleSaveUnitsCatalog(
                              unitsCatalog.filter((x) => x.id !== u.id),
                              `تم حذف الوحدة (${u.name}).`
                            );
                          },
                        });
                      }}
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

        {confirmState && (
          <ConfirmDialog
            isOpen={confirmState.isOpen}
            onClose={() => setConfirmState(null)}
            onConfirm={confirmState.onConfirm}
            title={confirmState.title}
            message={confirmState.message}
            variant={confirmState.variant}
          />
        )}
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
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
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

        <div>
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
          >
            <option value="all">-- جميع المستودعات --</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
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
                <th className="p-3.5">الصورة / الكود</th>
                <th className="p-3.5">اسم الصنف الغذائي</th>
                <th className="p-3.5">التصنيف</th>
                <th className="p-3.5">الوحدات الإضافية</th>
                <th className="p-3.5 text-center">سعر الشراء</th>
                <th className="p-3.5 text-center">سعر البيع</th>
                <th className="p-3.5 text-center">{warehouseFilter === 'all' ? 'الرصيد الإجمالي' : 'رصيد المستودع'}</th>
                <th className="p-3.5 text-center">حالة المخزون</th>
                <th className="p-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    لا توجد أصناف غذائية مطابقة للبحث أو لم تتم إضافة أصناف بعد.
                  </td>
                </tr>
              ) : (
                filteredProducts.map(prod => {
                  const totalStock = warehouseFilter === 'all'
                    ? Object.values(prod.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
                    : Number(prod.stockPerWarehouse?.[warehouseFilter] || 0);
                  const isLow = totalStock <= prod.minStockLevel;

                  return (
                    <tr key={prod.id} className={`hover:bg-slate-50/80 transition-colors ${prod.status !== 'active' ? 'opacity-60 bg-slate-50' : ''}`}>
                    <td className="p-3.5 font-mono">
                      <div className="flex items-center gap-2.5">
                        {prod.image ? (
                          <img src={prod.image} alt={prod.name} className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-blue-950">{prod.code}</div>
                          <div className="text-[10px] text-slate-400">{prod.barcode || '-'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span className="font-bold text-slate-900 block text-xs">
                        {prod.name}
                        {prod.status !== 'active' && (
                          <span className="mr-1.5 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[9px]">موقوف</span>
                        )}
                      </span>
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
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setAdjustProdId(prod.id);
                            setAdjustNewQty(Number(prod.stockPerWarehouse?.[adjustWhId] || 0));
                            setAdjustModalError(null);
                            setIsAdjustModalOpen(true);
                          }}
                          className="p-1 rounded-lg text-slate-500 hover:text-blue-900 hover:bg-slate-100 text-[11px] font-bold cursor-pointer"
                          title="تسوية جردية"
                        >
                          تسوية
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDamageProdId(prod.id);
                            setDamageModalError(null);
                            setIsDamageModalOpen(true);
                          }}
                          className="p-1 rounded-lg text-amber-600 hover:bg-amber-50 text-[11px] font-bold cursor-pointer"
                          title="إثبات تالف"
                        >
                          تالف
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(prod)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-900 hover:bg-slate-100 cursor-pointer"
                          title="تعديل"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmState({
                              isOpen: true,
                              title: prod.status === 'active' ? 'إيقاف الصنف' : 'تفعيل الصنف',
                              message: `هل تريد ${prod.status === 'active' ? 'إيقاف' : 'إعادة تفعيل'} الصنف (${prod.name})؟`,
                              variant: 'warning',
                              onConfirm: async () => {
                                setConfirmState(null);
                                const res = await toggleProductStatus(prod.id);
                                if (!res.success) {
                                  setStatusBanner({ type: 'error', text: res.error || 'تعذر تغيير حالة الصنف' });
                                }
                              },
                            });
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50 cursor-pointer"
                          title={prod.status === 'active' ? 'إيقاف مؤقت' : 'تفعيل'}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        {hasPermission('canDelete') && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmState({
                                isOpen: true,
                                title: 'حذف الصنف من قاعدة البيانات',
                                message: `هل أنت متأكد من حذف الصنف (${prod.name}) نهائياً؟ (لن يُسمح بالحذف إذا كان الصنف مرتبطاً بفواتير أو حركات سابقة).`,
                                variant: 'danger',
                                onConfirm: async () => {
                                  setConfirmState(null);
                                  const res = await deleteProduct(prod.id);
                                  if (!res.success) {
                                    setStatusBanner({ type: 'error', text: res.error || 'لا يمكن حذف الصنف لارتباطه بعمليات مسجلة' });
                                  } else {
                                    setStatusBanner({ type: 'success', text: `تم حذف الصنف (${prod.name}) بنجاح.` });
                                  }
                                },
                              });
                            }}
                            className="p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                            title="حذف الصنف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
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
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
              {productModalError}
            </div>
          )}

          {/* Product Name + Image Upload */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
            <div className="sm:col-span-8 space-y-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم الصنف الغذائي: *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: زيت عباد الشمس عافية 1 لتر"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold text-slate-900 focus:border-blue-700 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">كود الصنف: *</label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الباركود (اختياري):</label>
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    placeholder="اتركه فارغاً أو أدخل الباركود"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">التصنيف: *</label>
                  <input
                    type="text"
                    required
                    list="inventory-categories-datalist"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold"
                  />
                  <datalist id="inventory-categories-datalist">
                    {categories.filter((c) => c !== 'all').map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>

            <div className="sm:col-span-4 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 text-center">
              <label className="block font-bold text-slate-700 text-[11px]">صورة الصنف (اختياري):</label>
              {formData.image ? (
                <div className="relative inline-block">
                  <img
                    src={formData.image}
                    alt="صورة الصنف"
                    className="w-24 h-24 rounded-xl object-cover border border-slate-300 mx-auto"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, image: '' }))}
                    className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center shadow cursor-pointer"
                    title="إزالة الصورة"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="w-24 h-24 rounded-xl border border-dashed border-slate-300 bg-white flex flex-col items-center justify-center text-slate-400 mx-auto">
                  <ImageIcon className="w-6 h-6 mb-1" />
                  <span className="text-[10px]">بدون صورة</span>
                </div>
              )}
              <label className="inline-block px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 rounded-lg font-bold cursor-pointer text-[11px]">
                اختيار صورة الصنف
                <input type="file" accept="image/*" onChange={handleProductImageUpload} className="hidden" />
              </label>
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

          {!editingProduct && warehouses.length > 0 && (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
              <label className="block font-bold text-slate-700">الأرصدة الافتتاحية في المستودعات:</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {warehouses.map((w) => (
                  <div key={w.id} className="bg-white p-2 rounded-lg border">
                    <span className="block text-[10px] text-slate-500 font-bold truncate mb-1">{w.name}</span>
                    <input
                      type="number"
                      min="0"
                      value={formData.initialStockPerWarehouse[w.id] ?? 0}
                      onChange={(e) => {
                        const qty = Math.max(0, Number(e.target.value) || 0);
                        setFormData((prev) => ({
                          ...prev,
                          initialStockPerWarehouse: {
                            ...prev.initialStockPerWarehouse,
                            [w.id]: qty,
                          },
                        }));
                      }}
                      className="w-full border border-slate-200 rounded p-1 font-mono font-bold text-center"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

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
              className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSavingProduct}
              className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-950 shadow-md cursor-pointer disabled:opacity-50"
            >
              {isSavingProduct ? 'جاري الحفظ...' : 'حفظ المنتج'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Inter-Warehouse Stock Transfer Modal */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title="تحويل مخزني سريع بين المستودعات"
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
            <ProductSearchSelect
              products={products}
              selectedProductId={transferProdId}
              onSelect={(prod) => setTransferProdId(prod.id)}
              warehouseId={fromWhId}
              warehouses={warehouses}
              currency={settings.currency}
              placeholder="ابحث بالاسم أو الكود أو الباركود..."
            />
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
              className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmittingTransfer}
              className="px-6 py-2 bg-indigo-900 text-white rounded-xl font-bold shadow-md hover:bg-indigo-950 cursor-pointer disabled:opacity-50"
            >
              {isSubmittingTransfer ? 'جاري التحويل...' : 'تنفيذ التحويل المخزني'}
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
          {adjustModalError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
              {adjustModalError}
            </div>
          )}
          <div>
            <label className="block font-bold text-slate-700 mb-1">الصنف:</label>
            <ProductSearchSelect
              products={products}
              selectedProductId={adjustProdId}
              onSelect={(prod) => {
                setAdjustProdId(prod.id);
                setAdjustNewQty(Number(prod.stockPerWarehouse?.[adjustWhId] || 0));
              }}
              warehouseId={adjustWhId}
              warehouses={warehouses}
              currency={settings.currency}
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">المستودع:</label>
            <select
              value={adjustWhId}
              onChange={(e) => {
                const nextWh = e.target.value;
                setAdjustWhId(nextWh);
                const prod = products.find((p) => p.id === adjustProdId);
                if (prod) setAdjustNewQty(Number(prod.stockPerWarehouse?.[nextWh] || 0));
              }}
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
              className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmittingAdjust}
              className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
            >
              {isSubmittingAdjust ? 'جاري الاعتماد...' : 'اعتماد التسوية الجردية'}
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
          {damageModalError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
              {damageModalError}
            </div>
          )}
          <div>
            <label className="block font-bold text-slate-700 mb-1">الصنف:</label>
            <ProductSearchSelect
              products={products}
              selectedProductId={damageProdId}
              onSelect={(prod) => setDamageProdId(prod.id)}
              warehouseId={damageWhId}
              warehouses={warehouses}
              currency={settings.currency}
            />
          </div>

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
              className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmittingDamage}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-md cursor-pointer disabled:opacity-50"
            >
              {isSubmittingDamage ? 'جاري التسجيل...' : 'إثبات وخصم التوالف'}
            </button>
          </div>
        </form>
      </Modal>

      {confirmState && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          onClose={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
          title={confirmState.title}
          message={confirmState.message}
          variant={confirmState.variant}
        />
      )}
    </div>
  );
};

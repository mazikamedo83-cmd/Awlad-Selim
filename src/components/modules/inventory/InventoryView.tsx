import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Boxes, Plus, ArrowLeftRight,
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
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { exportToExcel } from '../../common/ExcelExporter';
import { compressImageFileToDataUrl } from '../../../utils/image';
import { StockCountView } from './StockCountView';
import { StockTransfersView } from './StockTransfersView';

export interface InventoryViewProps {
  initialTab?: 'products' | 'categories' | 'warehouses' | 'transfers' | 'adjustments' | 'damaged' | 'movements' | 'stock-counts' | 'stock-transfers' | 'units' | string;
  onOpenItemMovementReport?: (productId?: string) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({ initialTab = 'products', onOpenItemMovementReport }) => {
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
  const [stockHealthFilter, setStockHealthFilter] = useState<'all' | 'low' | 'ok' | 'inactive'>('all');
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
  const [newUnitFactor, setNewUnitFactor] = useState<number | ''>('');
  const [newUnitNotes, setNewUnitNotes] = useState('');
  const [isSavingUnits, setIsSavingUnits] = useState(false);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferProdId, setTransferProdId] = useState('');
  const [fromWhId, setFromWhId] = useState(warehouses[0]?.id || '');
  const [toWhId, setToWhId] = useState(warehouses[1]?.id || warehouses[0]?.id || '');
  const [transferQty, setTransferQty] = useState<number | ''>('');
  const [transferNotes, setTransferNotes] = useState('');

  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [adjustProdId, setAdjustProdId] = useState('');
  const [adjustWhId, setAdjustWhId] = useState(warehouses[0]?.id || '');
  const [adjustNewQty, setAdjustNewQty] = useState<number | ''>('');
  const [adjustReason, setAdjustReason] = useState('');

  const [isDamageModalOpen, setIsDamageModalOpen] = useState(false);
  const [damageProdId, setDamageProdId] = useState('');
  const [damageWhId, setDamageWhId] = useState(warehouses[0]?.id || '');
  const [damageQty, setDamageQty] = useState<number | ''>('');
  const [damageReason, setDamageReason] = useState('');

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
    purchasePrice: number | '';
    sellingPrice: number | '';
    minStockLevel: number | '';
    image?: string;
    notes: string;
    initialStockPerWarehouse: Record<string, number>;
  }>({
    code: '',
    barcode: '',
    name: '',
    category: '',
    baseUnit: '',
    units: [],
    size: '',
    color: '',
    purchasePrice: '',
    sellingPrice: '',
    minStockLevel: '',
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
    const q = searchTerm.toLowerCase();
    return products.filter((p) => {
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode || '').includes(searchTerm) ||
        p.category.toLowerCase().includes(q);

      const matchCat = categoryFilter === 'all' ? true : p.category === categoryFilter;
      if (!matchSearch || !matchCat) return false;

      if (stockHealthFilter === 'all') return true;
      if (stockHealthFilter === 'inactive') return p.status !== 'active';
      const qty =
        warehouseFilter === 'all'
          ? Object.values(p.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
          : Number(p.stockPerWarehouse?.[warehouseFilter] || 0);
      if (stockHealthFilter === 'low') return p.status === 'active' && qty <= p.minStockLevel;
      if (stockHealthFilter === 'ok') return p.status === 'active' && qty > p.minStockLevel;
      return true;
    });
  }, [products, searchTerm, categoryFilter, warehouseFilter, stockHealthFilter]);

  const inventoryStats = useMemo(() => {
    let activeCount = 0;
    let lowCount = 0;
    let totalCostValue = 0;
    products.forEach((p) => {
      const qty =
        warehouseFilter === 'all'
          ? Object.values(p.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
          : Number(p.stockPerWarehouse?.[warehouseFilter] || 0);
      totalCostValue += qty * p.purchasePrice;
      if (p.status === 'active') {
        activeCount += 1;
        if (qty <= p.minStockLevel) lowCount += 1;
      }
    });
    return { activeCount, lowCount, totalCostValue, warehouseCount: warehouses.length };
  }, [products, warehouses, warehouseFilter]);

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

    setFormData({
      code: nextCode,
      barcode: nextBarcode,
      name: '',
      category: '',
      baseUnit: '',
      units: [],
      size: '',
      color: '',
      purchasePrice: '',
      sellingPrice: '',
      minStockLevel: '',
      image: '',
      notes: '',
      initialStockPerWarehouse: {},
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
    if (!formData.baseUnit.trim()) {
      setProductModalError('يرجى إدخال الوحدة الأساسية للصنف');
      return;
    }
    const purchasePriceVal = Number(formData.purchasePrice || 0);
    const sellingPriceVal = Number(formData.sellingPrice || 0);
    const minStockVal = Number(formData.minStockLevel || 0);
    if (purchasePriceVal < 0 || sellingPriceVal < 0) {
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
          category: formData.category.trim(),
          baseUnit: formData.baseUnit.trim(),
          units: formData.units,
          size: formData.size?.trim() || undefined,
          color: formData.color?.trim() || undefined,
          purchasePrice: purchasePriceVal,
          sellingPrice: sellingPriceVal,
          minStockLevel: minStockVal,
          image: formData.image || '',
          notes: formData.notes.trim(),
        });
      } else {
        await addProduct({
          code: formData.code.trim(),
          barcode: formData.barcode.trim(),
          name: formData.name.trim(),
          category: formData.category.trim(),
          baseUnit: formData.baseUnit.trim(),
          units: formData.units,
          size: formData.size?.trim() || undefined,
          color: formData.color?.trim() || undefined,
          purchasePrice: purchasePriceVal,
          sellingPrice: sellingPriceVal,
          minStockLevel: minStockVal,
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
    const qtyVal = Number(transferQty || 0);
    if (qtyVal <= 0) {
      setTransferModalError('يرجى إدخال كمية محولة أكبر من صفر.');
      return;
    }
    setIsSubmittingTransfer(true);
    try {
      const res = await transferStock(transferProdId, fromWhId, toWhId, qtyVal, transferNotes || 'تحويل داخلي');
      if (!res.success) {
        setTransferModalError(res.error || 'فشل التحويل المخزني');
      } else {
        setIsTransferModalOpen(false);
        setTransferQty('');
        setTransferNotes('');
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
    if (adjustNewQty === '' || Number(adjustNewQty) < 0) {
      setAdjustModalError('يرجى إدخال الرصيد الفعلي الجديد بعد الجرد.');
      return;
    }
    setIsSubmittingAdjust(true);
    try {
      await adjustStock(adjustProdId, adjustWhId, Number(adjustNewQty), adjustReason.trim());
      setIsAdjustModalOpen(false);
      setAdjustNewQty('');
      setAdjustReason('');
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
    const qtyVal = Number(damageQty || 0);
    if (qtyVal <= 0) {
      setDamageModalError('يرجى إدخال الكمية التالفة أكبر من صفر.');
      return;
    }
    setIsSubmittingDamage(true);
    try {
      await recordDamagedStock(damageProdId, damageWhId, qtyVal, damageReason.trim());
      setIsDamageModalOpen(false);
      setDamageQty('');
      setDamageReason('');
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
      <div className="space-y-3">
        <div className="bg-white px-3.5 py-2.5 rounded-lg border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <div>
            <h2 className="text-base font-black text-[#011E58] flex items-center gap-2">
              <WarehouseIcon className="w-4 h-4 text-[#003589]" />
              <span>إدارة المستودعات والمخازن</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
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
            className="flex items-center gap-1.5 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة مستودع جديد</span>
          </button>
        </div>

        {statusBanner && (
          <div className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between ${
            statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">إغلاق</button>
          </div>
        )}

        <UnifiedDataTable<Warehouse>
          title="قائمة المستودعات"
          subtitle="المخازن والفروع المسجلة وإجمالي الوحدات والقيمة الشرائية"
          data={warehouses}
          rowKey={(wh) => wh.id}
          compact
          searchPlaceholder="بحث باسم المستودع أو الكود أو الموقع..."
          searchFilter={(wh, q) =>
            `${wh.name} ${wh.code} ${wh.location || ''} ${wh.managerName || ''} ${wh.phone || ''}`.toLowerCase().includes(q)
          }
          exportFilename="AWLAD_SELIM_Warehouses"
          pdfTitle="قائمة المستودعات"
          emptyTitle="لا توجد مستودعات مسجلة"
          rowClassName={(wh) => wh.status === 'suspended' ? 'opacity-70 bg-slate-50/70' : ''}
          columns={[
            {
              key: 'code',
              header: 'الكود',
              sortable: true,
              sortValue: (wh) => wh.code,
              exportValue: (wh) => wh.code,
              render: (wh) => <span className="font-mono font-bold text-[#011E58]">{wh.code}</span>,
            },
            {
              key: 'name',
              header: 'المستودع',
              sortable: true,
              sortValue: (wh) => wh.name,
              exportValue: (wh) => wh.name,
              render: (wh) => (
                <div className="flex items-center gap-2">
                  <span className="font-black text-slate-900">{wh.name}</span>
                  {wh.isDefault && (
                    <span className="px-2 py-0.5 rounded bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] text-[10px] font-black">افتراضي</span>
                  )}
                </div>
              ),
            },
            {
              key: 'location',
              header: 'الموقع',
              exportValue: (wh) => wh.location || '-',
              render: (wh) => <span className="text-slate-700">{wh.location || '-'}</span>,
            },
            {
              key: 'managerName',
              header: 'أمين المستودع / الهاتف',
              exportValue: (wh) => `${wh.managerName || '-'} ${wh.phone || ''}`,
              render: (wh) => (
                <div>
                  <div className="font-bold text-slate-800">{wh.managerName || '-'}</div>
                  {wh.phone && <div className="font-mono text-[11px] text-slate-500">{wh.phone}</div>}
                </div>
              ),
            },
            {
              key: 'activeSkuCount',
              header: 'أصناف متوفرة',
              align: 'center',
              sortable: true,
              sortValue: (wh) => products.filter((p) => Number(p.stockPerWarehouse?.[wh.id] || 0) > 0).length,
              exportValue: (wh) => products.filter((p) => Number(p.stockPerWarehouse?.[wh.id] || 0) > 0).length,
              render: (wh) => (
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {products.filter((p) => Number(p.stockPerWarehouse?.[wh.id] || 0) > 0).length}
                </span>
              ),
            },
            {
              key: 'totalUnits',
              header: 'إجمالي الوحدات',
              align: 'center',
              sortable: true,
              sortValue: (wh) => products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0), 0),
              exportValue: (wh) => products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0), 0),
              render: (wh) => (
                <span className="font-mono font-black text-[#003589] tabular-nums">
                  {products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0), 0).toLocaleString()}
                </span>
              ),
            },
            {
              key: 'totalValue',
              header: 'القيمة الشرائية',
              align: 'center',
              sortable: true,
              sortValue: (wh) => products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0) * Number(p.purchasePrice || 0), 0),
              exportValue: (wh) => Math.round(products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0) * Number(p.purchasePrice || 0), 0)),
              render: (wh) => (
                <span className="font-mono font-black text-emerald-700 tabular-nums">
                  {Math.round(products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0) * Number(p.purchasePrice || 0), 0)).toLocaleString()} {settings.currency}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              exportValue: (wh) => (wh.status === 'suspended' ? 'موقوف' : 'نشط'),
              render: (wh) => {
                const isSuspended = wh.status === 'suspended';
                return (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isSuspended ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {isSuspended ? 'موقوف' : 'نشط'}
                  </span>
                );
              },
            },
            {
              key: 'actions',
              header: 'الإجراءات',
              align: 'center',
              render: (wh) => {
                const isSuspended = wh.status === 'suspended';
                return (
                  <div className="flex items-center justify-center gap-1.5">
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
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer"
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
                      className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer ${isSuspended ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}
                    >
                      {isSuspended ? 'تفعيل' : 'إيقاف'}
                    </button>
                  </div>
                );
              },
            },
          ]}
        />

        <Modal
          isOpen={isWarehouseModalOpen}
          onClose={() => setIsWarehouseModalOpen(false)}
          title={editingWarehouse ? `تعديل المستودع: ${editingWarehouse.name}` : 'إضافة مستودع جديد'}
          maxWidth="lg"
        >
          <form onSubmit={handleSaveWh} className="space-y-3 text-xs">
            {whModalError && (
              <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">{whModalError}</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">اسم المستودع: *</label>
                <input
                  type="text"
                  required
                  value={whForm.name}
                  onChange={(e) => setWhForm({ ...whForm, name: e.target.value })}
                  placeholder="مثال: المخزن الرئيسي - شبرا"
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">كود المستودع:</label>
                <input
                  type="text"
                  value={whForm.code}
                  onChange={(e) => setWhForm({ ...whForm, code: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">العنوان / الموقع:</label>
                <input
                  type="text"
                  value={whForm.location}
                  onChange={(e) => setWhForm({ ...whForm, location: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">أمين المستودع المسؤول:</label>
                <input
                  type="text"
                  value={whForm.managerName}
                  onChange={(e) => setWhForm({ ...whForm, managerName: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">رقم الهاتف:</label>
                <input
                  type="text"
                  value={whForm.phone}
                  onChange={(e) => setWhForm({ ...whForm, phone: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-4">
                <input
                  id="wh-default-check"
                  type="checkbox"
                  checked={whForm.isDefault}
                  onChange={(e) => setWhForm({ ...whForm, isDefault: e.target.checked })}
                />
                <label htmlFor="wh-default-check" className="font-bold cursor-pointer">مستودع افتراضي للفواتير</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2.5 border-t">
              <button type="button" onClick={() => setIsWarehouseModalOpen(false)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">إلغاء</button>
              <button type="submit" disabled={isSavingWh} className="h-8 px-4 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50">
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
      sale: { label: 'فاتورة بيع (-)', cls: 'bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5]' },
      sale_return: { label: 'مرتجع بيع (+)', cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200' },
      purchase_return: { label: 'مرتجع شراء (-)', cls: 'bg-amber-100 text-amber-800' },
      transfer_in: { label: 'تحويل وارد (+)', cls: 'bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5]' },
      transfer_out: { label: 'تحويل صادر (-)', cls: 'bg-slate-100 text-[#002160] border border-slate-300' },
      adjustment: { label: 'تسوية جردية', cls: 'bg-[#DCE6F5] text-[#011E58]' },
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
      <div className="space-y-2.5">
        <div className="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-black text-[#011E58] flex items-center gap-2">
              <History className="w-4 h-4 text-[#003589]" />
              <span>سجل حركات المخازن التفصيلي</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
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
            className="flex items-center gap-1.5 h-8 px-2.5 border border-slate-300 rounded-md text-xs font-bold hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#003589]" />
            <span>تصدير Excel</span>
          </button>
        </div>

        <UnifiedDataTable
          title="حركات المخازن"
          subtitle="أرصدة الدخول والخروج والتحويل والتسويات"
          data={filteredMovements}
          rowKey={(m, idx) => `${m.id || m.referenceNumber}-${idx}`}
          compact
          searchValue={movementSearch}
          onSearchChange={setMovementSearch}
          searchPlaceholder="بحث بالصنف أو رقم المرجع أو البيان..."
          exportFilename="AWLAD_SELIM_StockMovements"
          pdfTitle="سجل حركات المخازن التفصيلي"
          emptyTitle="لا توجد حركات مخزنية مطابقة للبحث"
          toolbarFilters={
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <div className="min-w-[160px]">
                <SearchableFilterSelect
                  id="inv-mov-type"
                  value={movementTypeFilter}
                  onChange={setMovementTypeFilter}
                  options={Object.entries(MOVEMENT_LABELS).map(([k, v]) => ({
                    value: k,
                    label: v.label,
                  }))}
                  allOptionLabel="جميع أنواع الحركات"
                  allOptionValue="all"
                  allowClear
                  buttonClassName="rounded-lg min-h-[32px]"
                />
              </div>
              <div className="min-w-[160px]">
                <SearchableFilterSelect
                  id="inv-mov-wh"
                  value={movementWhFilter}
                  onChange={setMovementWhFilter}
                  options={warehouses.map((w) => ({
                    value: w.id,
                    label: w.name,
                    subtitle: w.code,
                  }))}
                  allOptionLabel="جميع المستودعات"
                  allOptionValue="all"
                  allowClear
                  buttonClassName="rounded-lg min-h-[32px]"
                />
              </div>
            </div>
          }
          columns={[
            {
              key: 'date',
              header: 'التاريخ',
              sortable: true,
              sortValue: (m) => m.date,
              exportValue: (m) => m.date,
              render: (m) => <span className="font-mono text-slate-600">{m.date}</span>,
            },
            {
              key: 'type',
              header: 'نوع الحركة',
              exportValue: (m) => MOVEMENT_LABELS[m.type]?.label || m.type,
              render: (m) => {
                const meta = MOVEMENT_LABELS[m.type] || { label: m.type, cls: 'bg-slate-100 text-slate-700' };
                return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>;
              },
            },
            {
              key: 'productName',
              header: 'الصنف',
              sortable: true,
              sortValue: (m) => m.productName || '',
              exportValue: (m) => m.productName || '-',
              render: (m) => <span className="font-bold text-slate-900">{m.productName}</span>,
            },
            {
              key: 'warehouseName',
              header: 'المستودع',
              exportValue: (m) => m.targetWarehouseName ? `${m.warehouseName} ← ${m.targetWarehouseName}` : m.warehouseName,
              render: (m) => (
                <div>
                  <span>{m.warehouseName}</span>
                  {m.targetWarehouseName && (
                    <span className="text-[10px] text-[#003589] font-bold block">← {m.targetWarehouseName}</span>
                  )}
                </div>
              ),
            },
            {
              key: 'quantity',
              header: 'الكمية',
              align: 'center',
              sortable: true,
              sortValue: (m) => Number(m.quantity || 0),
              exportValue: (m) => Number(m.quantity || 0),
              render: (m) => <span className="font-mono font-black tabular-nums">{Number(m.quantity || 0).toLocaleString()}</span>,
            },
            {
              key: 'referenceNumber',
              header: 'المرجع',
              exportValue: (m) => m.referenceNumber || '-',
              render: (m) => <span className="font-mono text-[#011E58] font-bold">{m.referenceNumber || '-'}</span>,
            },
            {
              key: 'notes',
              header: 'ملاحظات',
              exportValue: (m) => m.notes || '-',
              render: (m) => <span className="text-slate-600">{m.notes || '-'}</span>,
            },
            {
              key: 'createdBy',
              header: 'بواسطة',
              exportValue: (m) => m.createdBy || '-',
              render: (m) => <span>{m.createdBy}</span>,
            },
          ]}
        />
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
      <div className="space-y-2.5">
        <div className="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-black text-[#011E58] flex items-center gap-2">
              <Tag className="w-4 h-4 text-[#003589]" />
              <span>تصنيفات السلع وتغيير اسم التصنيفات الشامل</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              إضافة التصنيفات وتغيير أسمائها مع التحديث التلقائي الشامل لكل المنتجات المرتبطة بها
            </p>
          </div>
        </div>

        {statusBanner && (
          <div className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between ${
            statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">إغلاق</button>
          </div>
        )}

        <form onSubmit={handleAddCategory} className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs items-end">
          <div>
            <label className="block font-bold mb-1">اسم التصنيف الجديد: *</label>
            <input
              type="text"
              required
              placeholder="مثال: البقوليات والحبوب"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">وصف مختصر:</label>
            <input
              type="text"
              placeholder="ملاحظات عن المجموعة السلعية"
              value={newCategoryDesc}
              onChange={(e) => setNewCategoryDesc(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5"
            />
          </div>
          <button type="submit" className="h-8 px-3.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer">
            + إضافة تصنيف جديد
          </button>
        </form>

        <UnifiedDataTable
          title="التصنيفات الغذائية"
          data={categoryList}
          rowKey={(cat) => cat.id}
          compact
          searchPlaceholder="بحث باسم التصنيف..."
          searchFilter={(cat, q) => `${cat.name} ${cat.description || ''}`.toLowerCase().includes(q)}
          exportFilename="AWLAD_SELIM_Categories"
          pdfTitle="دليل التصنيفات الغذائية"
          columns={[
            {
              key: 'name',
              header: 'اسم التصنيف',
              sortable: true,
              sortValue: (cat) => cat.name,
              exportValue: (cat) => cat.name,
              render: (cat) => <span className="font-black text-slate-900">{cat.name}</span>,
            },
            {
              key: 'description',
              header: 'الوصف',
              exportValue: (cat) => cat.description || '-',
              render: (cat) => <span className="text-slate-600">{cat.description || '-'}</span>,
            },
            {
              key: 'linkedCount',
              header: 'عدد الأصناف المرتبطة',
              align: 'center',
              sortable: true,
              sortValue: (cat) => products.filter(p => p.category === cat.name).length,
              exportValue: (cat) => products.filter(p => p.category === cat.name).length,
              render: (cat) => (
                <span className="font-mono font-bold text-[#011E58] tabular-nums">
                  {products.filter(p => p.category === cat.name).length} صنف
                </span>
              ),
            },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              exportValue: (cat) => (cat.status !== 'suspended' ? 'نشط' : 'موقوف'),
              render: (cat) => (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${cat.status !== 'suspended' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-600'}`}>
                  {cat.status !== 'suspended' ? 'نشط' : 'موقوف'}
                </span>
              ),
            },
            {
              key: 'actions',
              header: 'الإجراءات',
              align: 'center',
              render: (cat) => (
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingCategory({ id: cat.id, currentName: cat.name });
                      setRenameTargetValue(cat.name);
                    }}
                    className="px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-bold border border-[#DCE6F5] cursor-pointer"
                  >
                    تغيير الاسم الشامل
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleCategoryStatus(cat.id)}
                    className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                  >
                    {cat.status !== 'suspended' ? 'إيقاف' : 'تفعيل'}
                  </button>
                </div>
              ),
            },
          ]}
        />

        <Modal
          isOpen={!!renamingCategory}
          onClose={() => setRenamingCategory(null)}
          title={`تغيير اسم التصنيف: ${renamingCategory?.currentName || ''}`}
          subtitle="سيتم تحديث اسم التصنيف في جميع المنتجات المرتبطة به تلقائياً على الخادم"
          maxWidth="md"
        >
          <form onSubmit={handleConfirmRenameCategory} className="space-y-3 text-xs">
            <div>
              <label className="block font-bold mb-1">الاسم الجديد للتصنيف: *</label>
              <input
                type="text"
                required
                value={renameTargetValue}
                onChange={(e) => setRenameTargetValue(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-bold"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setRenamingCategory(null)} className="h-8 px-3.5 border rounded-md font-bold cursor-pointer">
                إلغاء
              </button>
              <button type="submit" disabled={isRenamingCat} className="h-8 px-4 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50">
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
      <div className="space-y-2.5">
        <div className="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs">
          <h2 className="text-base font-black text-[#011E58] flex items-center gap-2">
            <Ruler className="w-4 h-4 text-[#003589]" />
            <span>دليل الوحدات ومعاملات التحويل</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            تجهيز وحدات القياس والتعبئة القياسية (قطعة، دستة، كرتونة، شيكارة، بالة) لاستخدامها السريع في الأصناف
          </p>
        </div>

        {statusBanner && (
          <div className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between ${
            statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">إغلاق</button>
          </div>
        )}

        <form onSubmit={handleAddUnitItem} className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs items-end">
          <div>
            <label className="block font-bold mb-1">اسم الوحدة: *</label>
            <input
              type="text"
              required
              placeholder="مثال: كرتونة 24"
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">الرمز المختصر:</label>
            <input
              type="text"
              placeholder="CTN24"
              value={newUnitCode}
              onChange={(e) => setNewUnitCode(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">معامل التحويل الأساسي:</label>
            <input
              type="number"
              min="1"
              required
              placeholder="1"
              value={newUnitFactor}
              onChange={(e) => setNewUnitFactor(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono font-bold text-center"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">ملاحظات:</label>
            <input
              type="text"
              value={newUnitNotes}
              onChange={(e) => setNewUnitNotes(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5"
            />
          </div>
          <button type="submit" disabled={isSavingUnits} className="h-8 px-3.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50">
            + إضافة وحدة
          </button>
        </form>

        <UnifiedDataTable<UnitCatalogItem>
          title="الوحدات المسجلة"
          data={unitsCatalog}
          rowKey={(u) => u.id}
          compact
          searchPlaceholder="بحث باسم الوحدة أو الرمز..."
          searchFilter={(u, q) => `${u.name} ${u.shortCode || ''} ${u.notes || ''}`.toLowerCase().includes(q)}
          exportFilename="AWLAD_SELIM_Units"
          pdfTitle="دليل وحدات القياس"
          columns={[
            {
              key: 'name',
              header: 'اسم الوحدة',
              sortable: true,
              sortValue: (u) => u.name,
              exportValue: (u) => u.name,
              render: (u) => <span className="font-black text-slate-900">{u.name}</span>,
            },
            {
              key: 'shortCode',
              header: 'الرمز',
              exportValue: (u) => u.shortCode || '-',
              render: (u) => <span className="font-mono text-[#011E58] font-bold">{u.shortCode || '-'}</span>,
            },
            {
              key: 'defaultConversionFactor',
              header: 'معامل التحويل الافتراضي',
              align: 'center',
              sortable: true,
              sortValue: (u) => u.defaultConversionFactor,
              exportValue: (u) => u.defaultConversionFactor,
              render: (u) => <span className="font-mono font-bold tabular-nums">{u.defaultConversionFactor}</span>,
            },
            {
              key: 'notes',
              header: 'ملاحظات',
              exportValue: (u) => u.notes || '-',
              render: (u) => <span className="text-slate-600">{u.notes || '-'}</span>,
            },
            {
              key: 'actions',
              header: 'حذف',
              align: 'center',
              render: (u) => (
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
              ),
            },
          ]}
        />

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
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white dark:bg-[#0E1C36] px-2.5 py-2 rounded-lg border border-slate-200 dark:border-[#21375C]">
        <div>
          <h2 className="text-sm font-black text-[#011E58] dark:text-[#F3F7FC] tracking-tight">إدارة المخازن والمنتجات الغذائية</h2>
          <p className="text-[11px] text-slate-500 dark:text-[#97AECE]">
            متابعة أرصدة السلع، أسعار الجملة، التحويلات بين المستودعات، والجرد
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 h-8 px-2.5 border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#132544] rounded-md text-xs font-bold hover:bg-slate-50 dark:hover:bg-[#1A3461] text-slate-700 dark:text-[#DCE6F5] cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#003589] dark:text-[#85B8FF]" />
            <span>تصدير Excel</span>
          </button>

          <button
            onClick={() => {
              setTransferProdId(products[0]?.id || '');
              setIsTransferModalOpen(true);
            }}
            className="flex items-center gap-1.5 h-8 px-2.5 bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#2A436E] text-[#011E58] dark:text-[#85B8FF] rounded-md text-xs font-bold hover:bg-[#DCE6F5] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-[#003589] dark:text-[#85B8FF]" />
            <span>تحويل بين المستودعات</span>
          </button>

          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black shadow-xs active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة صنف جديد</span>
          </button>
        </div>
      </div>

      {/* Compact Inventory Summary Ledger Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden text-xs">
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">إجمالي الأصناف النشطة</div>
          <div className="text-sm font-black font-mono tabular-nums text-[var(--awlad-navy-950)] dark:text-[#F3F7FC]">
            {inventoryStats.activeCount} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">صنف</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">أصناف عند حد الطلب الأدنى</div>
          <div className="text-sm font-black font-mono tabular-nums text-rose-700 dark:text-rose-400">
            {inventoryStats.lowCount} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">صنف</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">تقييم المخزون (تكلفة)</div>
          <div className="text-sm font-black font-mono tabular-nums text-[var(--awlad-royal-700)] dark:text-[#85B8FF]">
            {inventoryStats.totalCostValue.toLocaleString()} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">المستودعات المسجلة</div>
          <div className="text-sm font-black font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">
            {inventoryStats.warehouseCount} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">مستودع</span>
          </div>
        </div>
      </div>

      {statusBanner && (
        <div className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center justify-between ${
          statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
        }`}>
          <span>{statusBanner.text}</span>
          <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">إغلاق</button>
        </div>
      )}

      {/* Products Table */}
      <UnifiedDataTable<Product>
        title="قائمة الأصناف وأرصدة المخازن"
        subtitle={`إجمالي الأصناف المعروضة: ${filteredProducts.length} صنف`}
        data={filteredProducts}
        rowKey={(prod) => prod.id}
        onRowClick={(prod) => setPreviewProduct(prod)}
        compact
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="بحث بالاسم أو الباركود أو الكود أو التصنيف..."
        exportFilename="AWLAD_SELIM_Products"
        pdfTitle="قائمة الأصناف وأرصدة المخازن"
        emptyTitle="لا توجد أصناف غذائية مطابقة للبحث أو لم تتم إضافة أصناف بعد"
        rowClassName={(prod) => prod.status !== 'active' ? 'opacity-65 bg-slate-50 dark:bg-[#101E38]' : ''}
        toolbarFilters={
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <div className="min-w-[155px]">
              <SearchableFilterSelect
                id="inv-prod-cat"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={categories
                  .filter((c) => c !== 'all')
                  .map((c) => ({ value: c, label: c }))}
                allOptionLabel="جميع التصنيفات"
                allOptionValue="all"
                allowClear
                buttonClassName="rounded-md h-8 min-h-[32px]"
              />
            </div>
            <div className="min-w-[150px]">
              <SearchableFilterSelect
                id="inv-prod-wh"
                value={warehouseFilter}
                onChange={setWarehouseFilter}
                options={warehouses.map((w) => ({
                  value: w.id,
                  label: w.name,
                  subtitle: w.code,
                }))}
                allOptionLabel="جميع المستودعات"
                allOptionValue="all"
                allowClear
                buttonClassName="rounded-md h-8 min-h-[32px]"
              />
            </div>
            <select
              aria-label="تصفية حسب حالة المخزون"
              value={stockHealthFilter}
              onChange={(e) => setStockHealthFilter(e.target.value as any)}
              className="h-8 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC] focus:outline-hidden focus:border-[var(--awlad-royal-700)]"
            >
              <option value="all">كل حالات المخزون</option>
              <option value="low">نقص مخزون (حد أدنى)</option>
              <option value="ok">متوفر كافي</option>
              <option value="inactive">أصناف موقوفة</option>
            </select>
          </div>
        }
        columns={[
          {
            key: 'code',
            header: 'الصورة / الكود',
            sortable: true,
            sortValue: (prod) => prod.code,
            exportValue: (prod) => `${prod.code} ${prod.barcode || ''}`.trim(),
            render: (prod) => (
              <div className="flex items-center gap-2.5 font-mono">
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
            ),
          },
          {
            key: 'name',
            header: 'اسم الصنف الغذائي',
            sortable: true,
            sortValue: (prod) => prod.name,
            exportValue: (prod) => prod.name,
            render: (prod) => (
              <div>
                <span className="font-bold text-slate-900 block text-xs">
                  {prod.name}
                  {prod.status !== 'active' && (
                    <span className="mr-1.5 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[9px]">موقوف</span>
                  )}
                </span>
                <span className="text-[10px] text-slate-500">الوحدة الأساسية: {prod.baseUnit}</span>
              </div>
            ),
          },
          {
            key: 'category',
            header: 'التصنيف',
            sortable: true,
            sortValue: (prod) => prod.category,
            exportValue: (prod) => prod.category,
            render: (prod) => (
              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[10px]">
                {prod.category}
              </span>
            ),
          },
          {
            key: 'units',
            header: 'الوحدات الإضافية',
            exportValue: (prod) => (prod.units || []).map(u => `${u.name} (${u.sellingPrice})`).join(', ') || 'أساسية فقط',
            render: (prod) => (
              prod.units && prod.units.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {prod.units.map(u => (
                    <span key={u.id} className="px-1.5 py-0.5 rounded bg-[#EEF3FA] text-[#011E58] text-[10px] font-semibold border border-[#DCE6F5]">
                      {u.name} ({u.sellingPrice} {settings.currency})
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-slate-400 text-[10px]">أساسية فقط</span>
              )
            ),
          },
          {
            key: 'purchasePrice',
            header: 'سعر الشراء',
            align: 'center',
            sortable: true,
            sortValue: (prod) => prod.purchasePrice,
            exportValue: (prod) => prod.purchasePrice,
            render: (prod) => <span className="font-mono font-bold text-slate-700 tabular-nums">{prod.purchasePrice.toFixed(2)}</span>,
          },
          {
            key: 'sellingPrice',
            header: 'سعر البيع',
            align: 'center',
            sortable: true,
            sortValue: (prod) => prod.sellingPrice,
            exportValue: (prod) => prod.sellingPrice,
            render: (prod) => <span className="font-mono font-black text-[#011E58] tabular-nums">{prod.sellingPrice.toFixed(2)} {settings.currency}</span>,
          },
          {
            key: 'totalStock',
            header: warehouseFilter === 'all' ? 'الرصيد الإجمالي' : 'رصيد المستودع',
            align: 'center',
            sortable: true,
            sortValue: (prod) => warehouseFilter === 'all'
              ? Object.values(prod.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
              : Number(prod.stockPerWarehouse?.[warehouseFilter] || 0),
            exportValue: (prod) => warehouseFilter === 'all'
              ? Object.values(prod.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
              : Number(prod.stockPerWarehouse?.[warehouseFilter] || 0),
            render: (prod) => {
              const totalStock = warehouseFilter === 'all'
                ? Object.values(prod.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
                : Number(prod.stockPerWarehouse?.[warehouseFilter] || 0);
              return (
                <span className="font-mono font-black text-sm tabular-nums">
                  {totalStock.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">{prod.baseUnit}</span>
                </span>
              );
            },
          },
          {
            key: 'stockHealth',
            header: 'حالة المخزون',
            align: 'center',
            exportValue: (prod) => {
              const totalStock = warehouseFilter === 'all'
                ? Object.values(prod.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
                : Number(prod.stockPerWarehouse?.[warehouseFilter] || 0);
              return totalStock <= prod.minStockLevel ? 'نقص مخزون' : 'متوفر كافي';
            },
            render: (prod) => {
              const totalStock = warehouseFilter === 'all'
                ? Object.values(prod.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
                : Number(prod.stockPerWarehouse?.[warehouseFilter] || 0);
              const isLow = totalStock <= prod.minStockLevel;
              return isLow ? (
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[10px] border border-red-300">
                  نقص مخزون (حد أدنى: {prod.minStockLevel})
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                  متوفر كافي
                </span>
              );
            },
          },
          {
            key: 'actions',
            header: 'الإجراءات',
            align: 'center',
            render: (prod) => (
              <div className="flex items-center justify-center gap-1 flex-wrap">
                {onOpenItemMovementReport && (
                  <button
                    type="button"
                    onClick={() => onOpenItemMovementReport(prod.id)}
                    className="px-2 py-1 rounded-md bg-[#EEF3FA] text-[#011E58] hover:bg-[#DCE6F5] border border-[#DCE6F5] text-[11px] font-bold cursor-pointer"
                    title="تقرير حركة الصنف المفصل"
                  >
                    حركة الصنف
                  </button>
                )}
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
            ),
          },
        ]}
      />

      {/* Add / Edit Product Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingProduct ? 'تعديل بيانات المنتج الغذائي' : 'إضافة منتج غذائي جديد للمخزن'}
        maxWidth="4xl"
      >
        <form onSubmit={handleSaveProduct} className="space-y-3 text-xs">
          {productModalError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">
              {productModalError}
            </div>
          )}

          {/* Product Name + Image Upload */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-start">
            <div className="sm:col-span-8 space-y-2.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم الصنف الغذائي: *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: زيت عباد الشمس عافية 1 لتر"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-900 focus:border-blue-700 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">كود الصنف: *</label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الباركود (اختياري):</label>
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    placeholder="اتركه فارغاً أو أدخل الباركود"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
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
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                  />
                  <datalist id="inventory-categories-datalist">
                    {categories.filter((c) => c !== 'all').map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>

            <div className="sm:col-span-4 bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1.5 text-center">
              <label className="block font-bold text-slate-700 text-[11px]">صورة الصنف (اختياري):</label>
              {formData.image ? (
                <div className="relative inline-block">
                  <img
                    src={formData.image}
                    alt="صورة الصنف"
                    className="w-20 h-20 rounded-lg object-cover border border-slate-300 mx-auto"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, image: '' }))}
                    className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center shadow cursor-pointer"
                    title="إزالة الصورة"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-lg border border-dashed border-slate-300 bg-white flex flex-col items-center justify-center text-slate-400 mx-auto">
                  <ImageIcon className="w-5 h-5 mb-0.5" />
                  <span className="text-[10px]">بدون صورة</span>
                </div>
              )}
              <label className="inline-block px-2.5 py-1 bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] rounded-md font-bold cursor-pointer text-[11px]">
                اختيار صورة الصنف
                <input type="file" accept="image/*" onChange={handleProductImageUpload} className="hidden" />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1">المقاس (اختياري عند الحاجة):</label>
              <input
                type="text"
                placeholder="مثال: وسط، كبير، 500 جرام، 1 لتر"
                value={formData.size || ''}
                onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">اللون / النكهة (اختياري عند الحاجة):</label>
              <input
                type="text"
                placeholder="مثال: أحمر، شطة وليمون، جبنة متبلة"
                value={formData.color || ''}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 font-bold"
              />
            </div>
          </div>

          {/* Flexible Packaging Units Configuration (Section 2) */}
          <div className="bg-[#EEF3FA]/70 p-2.5 rounded-lg border border-[#DCE6F5] space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-[#011E58] text-xs">وحدات التعبئة الإضافية ومعامل التحويل (مثلاً: الكرتونة = 12 قطعة):</label>
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
                className="text-[11px] bg-[#003589] text-white px-2.5 py-1 rounded-md font-bold hover:bg-[#0049B0] cursor-pointer"
              >
                + إضافة وحدة تعبئة
              </button>
            </div>

            {formData.units.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">لا توجد وحدات تعبئة إضافية (البيع بالوحدة الصغرى الأساسية فقط)</p>
            ) : (
              <div className="space-y-1.5">
                {formData.units.map((u, idx) => (
                  <div key={u.id} className="grid grid-cols-1 sm:grid-cols-5 gap-2 bg-white p-1.5 rounded-lg border border-[#DCE6F5] items-center text-xs">
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
                        className="w-full border rounded-md p-1 font-mono font-bold text-[#011E58] text-xs"
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
                    <div className="flex items-end justify-center pt-2 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            units: prev.units.filter((_, i) => i !== idx),
                          }));
                        }}
                        className="text-red-500 hover:text-red-700 p-1 text-[11px] font-bold cursor-pointer"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div>
              <label className="block font-bold text-slate-700 mb-1">الوحدة الصغرى الأساسية:</label>
              <input
                type="text"
                required
                placeholder="قطعة، كيس، كيلو، علبة"
                value={formData.baseUnit}
                onChange={(e) => setFormData({ ...formData, baseUnit: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">سعر شراء الوحدة الأساسية:</label>
              <input
                type="number"
                step="0.5"
                required
                placeholder="0.00"
                value={formData.purchasePrice}
                onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">سعر بيع الوحدة الأساسية:</label>
              <input
                type="number"
                step="0.5"
                required
                placeholder="0.00"
                value={formData.sellingPrice}
                onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-mono font-black text-[#011E58]"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">حد الطلب الأدنى للتنبيه:</label>
              <input
                type="number"
                required
                placeholder="0"
                value={formData.minStockLevel}
                onChange={(e) => setFormData({ ...formData, minStockLevel: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-mono font-bold"
              />
            </div>
          </div>

          {!editingProduct && warehouses.length > 0 && (
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5">
              <label className="block font-bold text-slate-700">الأرصدة الافتتاحية في المستودعات:</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {warehouses.map((w) => (
                  <div key={w.id} className="bg-white p-1.5 rounded-lg border">
                    <span className="block text-[10px] text-slate-500 font-bold whitespace-normal break-words mb-1">{w.name}</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={formData.initialStockPerWarehouse[w.id] ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setFormData((prev) => {
                          const next = { ...prev.initialStockPerWarehouse };
                          if (raw === '') {
                            delete next[w.id];
                          } else {
                            next[w.id] = Math.max(0, Number(raw) || 0);
                          }
                          return { ...prev, initialStockPerWarehouse: next };
                        });
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
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 outline-hidden"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2.5 border-t">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="h-8 px-3.5 border border-slate-300 rounded-md text-slate-700 font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSavingProduct}
              className="h-8 px-4 bg-[#003589] text-white rounded-md font-bold hover:bg-[#0049B0] shadow-xs cursor-pointer disabled:opacity-50"
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
        <form onSubmit={handleExecuteTransfer} className="space-y-3 text-xs">
          {transferModalError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">
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

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1">من مستودع:</label>
              <select
                value={fromWhId}
                onChange={(e) => setFromWhId(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 font-bold"
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
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 font-bold"
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
              placeholder="أدخل الكمية"
              value={transferQty}
              onChange={(e) => setTransferQty(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full h-8 bg-slate-50 border border-slate-300 rounded-md px-2.5 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">بيان وسبب التحويل:</label>
            <input
              type="text"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              placeholder="تغذية فرع العبور / تجهيز سيارة التوزيع..."
              className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2.5 border-t">
            <button
              type="button"
              onClick={() => setIsTransferModalOpen(false)}
              className="h-8 px-3.5 border rounded-md font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmittingTransfer}
              className="h-8 px-4 bg-[#003589] text-white rounded-md font-bold shadow-xs hover:bg-[#0049B0] cursor-pointer disabled:opacity-50"
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
        <form onSubmit={handleExecuteAdjust} className="space-y-3 text-xs">
          {adjustModalError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">
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
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
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
              placeholder="0"
              value={adjustNewQty}
              onChange={(e) => setAdjustNewQty(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">سبب التسوية:</label>
            <input
              type="text"
              required
              placeholder="أدخل سبب التسوية (مثال: جرد دوري بالمستودع)"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2.5 border-t">
            <button
              type="button"
              onClick={() => setIsAdjustModalOpen(false)}
              className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmittingAdjust}
              className="h-8 px-4 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
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
        <form onSubmit={handleExecuteDamage} className="space-y-3 text-xs">
          {damageModalError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">
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
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
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
              placeholder="أدخل الكمية التالفة"
              value={damageQty}
              onChange={(e) => setDamageQty(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-red-50 border border-red-300 rounded-lg px-2.5 py-1.5 font-mono font-black text-center text-red-900 text-sm"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">سبب التلف:</label>
            <input
              type="text"
              required
              placeholder="أدخل سبب التلف (مثال: تلف عبوة / انتهاء صلاحية)"
              value={damageReason}
              onChange={(e) => setDamageReason(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2.5 border-t">
            <button
              type="button"
              onClick={() => setIsDamageModalOpen(false)}
              className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmittingDamage}
              className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold shadow-xs cursor-pointer disabled:opacity-50"
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

      {/* Read-only Product Detail Modal */}
      <Modal
        isOpen={!!previewProduct}
        onClose={() => setPreviewProduct(null)}
        title={previewProduct ? `بطاقة الصنف: ${previewProduct.name}` : 'بطاقة الصنف'}
        subtitle={previewProduct ? `${previewProduct.code}${previewProduct.barcode ? ` · باركود: ${previewProduct.barcode}` : ''}` : undefined}
        maxWidth="2xl"
      >
        {previewProduct && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-col sm:flex-row gap-3 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              {previewProduct.image ? (
                <img
                  src={previewProduct.image}
                  alt={previewProduct.name}
                  className="w-20 h-20 rounded-lg object-cover border border-slate-200 dark:border-[#21375C] shrink-0"
                />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] flex items-center justify-center text-slate-400 shrink-0">
                  <ImageIcon className="w-7 h-7" />
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 flex-1">
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">التصنيف</span>
                  <strong className="text-slate-900 dark:text-[#F3F7FC]">{previewProduct.category || 'عام'}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">الوحدة الأساسية</span>
                  <strong className="text-slate-900 dark:text-[#F3F7FC]">{previewProduct.baseUnit}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">سعر البيع الأساسي</span>
                  <strong className="font-mono tabular-nums text-[#003589] dark:text-[#85B8FF]">
                    {Number(previewProduct.sellingPrice || 0).toLocaleString()} {settings.currency}
                  </strong>
                </div>
                {previewProduct.purchasePrice !== undefined && (
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">سعر التكلفة / الشراء</span>
                    <strong className="font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">
                      {Number(previewProduct.purchasePrice || 0).toLocaleString()} {settings.currency}
                    </strong>
                  </div>
                )}
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">حد الطلب</span>
                  <strong className="font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">{previewProduct.minStockLevel ?? 0}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">الحالة</span>
                  <strong className="text-slate-900 dark:text-[#F3F7FC]">
                    {previewProduct.status === 'active' ? 'نشط' : 'موقف'}
                  </strong>
                </div>
              </div>
            </div>

            {Array.isArray(previewProduct.units) && previewProduct.units.length > 0 && (
              <div className="border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
                <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-[#172E56] font-bold text-slate-800 dark:text-[#F3F7FC]">
                  الوحدات والأسعار ({previewProduct.units.length})
                </div>
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#21375C] text-[11px] text-slate-500 dark:text-[#97AECE]">
                      <th className="p-2">الوحدة</th>
                      <th className="p-2 text-center">المعامل</th>
                      <th className="p-2 text-center">الباركود</th>
                      <th className="p-2 text-center">سعر البيع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                    {previewProduct.units.map((u, idx) => (
                      <tr key={u.id || `${u.name}-${idx}`}>
                        <td className="p-2 font-bold">{u.name}</td>
                        <td className="p-2 text-center font-mono tabular-nums">{u.conversionFactor}</td>
                        <td className="p-2 text-center font-mono">{u.barcode || '—'}</td>
                        <td className="p-2 text-center font-mono tabular-nums font-bold">
                          {Number(u.sellingPrice || 0).toLocaleString()} {settings.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
              <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-[#172E56] font-bold text-slate-800 dark:text-[#F3F7FC]">
                الأرصدة التفصيلية بالمستودعات
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5">
                {warehouses.map((w) => (
                  <div key={w.id} className="p-2 rounded border border-slate-200 dark:border-[#21375C] bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#97AECE] truncate">{w.name}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#F3F7FC] tabular-nums">
                      {Number(previewProduct.stockPerWarehouse?.[w.id] || 0).toLocaleString()} {previewProduct.baseUnit}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {previewProduct.notes && (
              <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
                <span className="font-bold text-slate-600 dark:text-[#97AECE]">ملاحظات: </span>
                <span>{previewProduct.notes}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#21375C]">
              {onOpenItemMovementReport && (
                <button
                  type="button"
                  onClick={() => {
                    const id = previewProduct.id;
                    setPreviewProduct(null);
                    onOpenItemMovementReport(id);
                  }}
                  className="h-8 px-3 rounded-md bg-slate-100 dark:bg-[#132544] text-slate-800 dark:text-[#EEF4FC] font-bold cursor-pointer"
                >
                  تقرير حركة الصنف
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const target = previewProduct;
                  setPreviewProduct(null);
                  handleOpenEdit(target);
                }}
                className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer"
              >
                تعديل الصنف
              </button>
              <button
                type="button"
                onClick={() => setPreviewProduct(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

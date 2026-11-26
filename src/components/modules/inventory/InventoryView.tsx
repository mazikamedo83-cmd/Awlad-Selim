import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Boxes, Plus, ArrowLeftRight,
  Trash2, Edit, Download, RefreshCw,
  Tag, Ruler, Warehouse as WarehouseIcon, History, Package, Power
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { Product, ProductUnit, UnitCatalogItem, Warehouse } from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { ProductSearchSelect } from '../../common/ProductSearchSelect';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { exportToExcel } from '../../common/ExcelExporter';
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
  const { t, isRtl, isLtr, locale } = usePreferences();
  const fmt = (n: number) => formatLocaleNumber(n);

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
      setProductModalError(t('يرجى إدخال اسم الصنف الغذائي', 'Please enter the product name'));
      return;
    }
    if (!formData.baseUnit.trim()) {
      setProductModalError(t('يرجى إدخال الوحدة الأساسية للصنف', 'Please enter the product base unit'));
      return;
    }
    const purchasePriceVal = Number(formData.purchasePrice || 0);
    const sellingPriceVal = Number(formData.sellingPrice || 0);
    const minStockVal = Number(formData.minStockLevel || 0);
    if (purchasePriceVal < 0 || sellingPriceVal < 0) {
      setProductModalError(t('لا يمكن أن تكون أسعار الشراء أو البيع سالبة', 'Purchase or selling prices cannot be negative'));
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
          stockPerWarehouse: formData.initialStockPerWarehouse,
          status: 'active',
          notes: formData.notes.trim(),
        });
      }
      setIsAddModalOpen(false);
      setStatusBanner({
        type: 'success',
        text: editingProduct
          ? t('تم تحديث بيانات الصنف بنجاح.', 'Product updated successfully.')
          : t('تمت إضافة الصنف للمخزن بنجاح.', 'Product added to inventory successfully.'),
      });
    } catch (err: any) {
      setProductModalError(err.message ? t(err.message) : t('حدث خطأ أثناء حفظ الصنف', 'Error saving product'));
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
      setTransferModalError(t('يرجى إدخال كمية محولة أكبر من صفر.', 'Please enter a transfer quantity greater than zero.'));
      return;
    }
    setIsSubmittingTransfer(true);
    try {
      const res = await transferStock(transferProdId, fromWhId, toWhId, qtyVal, transferNotes || 'تحويل داخلي');
      if (!res.success) {
        setTransferModalError(res.error ? t(res.error) : t('فشل التحويل المخزني', 'Stock transfer failed'));
      } else {
        setIsTransferModalOpen(false);
        setTransferQty('');
        setTransferNotes('');
        setStatusBanner({ type: 'success', text: t('تم تنفيذ التحويل المخزني بنجاح.', 'Stock transfer executed successfully.') });
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
      setAdjustModalError(t('يرجى إدخال الرصيد الفعلي الجديد بعد الجرد.', 'Please enter the new actual counted balance.'));
      return;
    }
    setIsSubmittingAdjust(true);
    try {
      await adjustStock(adjustProdId, adjustWhId, Number(adjustNewQty), adjustReason.trim());
      setIsAdjustModalOpen(false);
      setAdjustNewQty('');
      setAdjustReason('');
      setStatusBanner({ type: 'success', text: t('تم اعتماد التسوية الجردية للمخزون بنجاح.', 'Stock adjustment approved successfully.') });
    } catch (err: any) {
      setAdjustModalError(err?.message ? t(err.message) : t('تعذر اعتماد التسوية الجردية', 'Unable to approve stock adjustment'));
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
      setDamageModalError(t('يرجى إدخال الكمية التالفة أكبر من صفر.', 'Please enter a damaged quantity greater than zero.'));
      return;
    }
    setIsSubmittingDamage(true);
    try {
      await recordDamagedStock(damageProdId, damageWhId, qtyVal, damageReason.trim());
      setIsDamageModalOpen(false);
      setDamageQty('');
      setDamageReason('');
      setStatusBanner({ type: 'success', text: t('تم تسجيل وخصم التالف من المخزون بنجاح.', 'Damaged goods recorded and deducted successfully.') });
    } catch (err: any) {
      setDamageModalError(err?.message ? t(err.message) : t('تعذر تسجيل البضاعة التالفة', 'Unable to record damaged goods'));
    } finally {
      setIsSubmittingDamage(false);
    }
  };

  const handleExportExcel = () => {
    const headers = [
      t('كود الصنف', 'Item Code'),
      t('الباركود', 'Barcode'),
      t('اسم المنتج الغذائي', 'Product Name'),
      t('التصنيف', 'Category'),
      t('الوحدة الأساسية', 'Base Unit'),
      t('سعر الشراء', 'Purchase Price'),
      t('سعر البيع', 'Selling Price'),
      t('إجمالي الرصيد', 'Total Stock'),
      t('قيمة المخزون', 'Stock Value'),
    ];
    const rows = filteredProducts.map(p => {
      const totalQty = Object.values(p.stockPerWarehouse).reduce((a, b) => a + b, 0);
      return [
        p.code,
        p.barcode,
        p.name,
        p.category ? t(p.category) : '',
        t(p.baseUnit),
        p.purchasePrice,
        p.sellingPrice,
        totalQty,
        totalQty * p.purchasePrice,
      ];
    });
    exportToExcel(`${t('مخزون_أولاد_سليم', 'Awlad_Selim_Inventory')}_${new Date().toISOString().split('T')[0]}`, headers, rows);
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
        setWhModalError(t('يرجى إدخال اسم المستودع', 'Please enter warehouse name'));
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
          setStatusBanner({
            type: 'success',
            text: `${t('تم تحديث بيانات المستودع', 'Warehouse updated:')} (${t(whForm.name.trim())})`,
          });
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
            setWhModalError(res.error ? t(res.error) : t('تعذر إضافة المستودع', 'Unable to add warehouse'));
            return;
          }
          setStatusBanner({
            type: 'success',
            text: `${t('تمت إضافة المستودع', 'Warehouse added:')} (${t(whForm.name.trim())})`,
          });
          setIsWarehouseModalOpen(false);
        }
      } catch (err: any) {
        setWhModalError(err?.message ? t(err.message) : t('تعذر حفظ بيانات المستودع', 'Unable to save warehouse details'));
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
              <span>{t('إدارة المستودعات والمخازن', 'Warehouses & Storage Management')}</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t('إضافة وتعديل المستودعات ومتابعة إجمالي الكميات والقيمة المخزنية في كل مستودع', 'Add/edit warehouses and track total stock quantities and inventory value per warehouse')}
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
            <span>{t('إضافة مستودع جديد', 'Add New Warehouse')}</span>
          </button>
        </div>

        {statusBanner && (
          <div className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between ${
            statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">{t('إغلاق', 'Close')}</button>
          </div>
        )}

        <UnifiedDataTable<Warehouse>
          title={t('قائمة المستودعات', 'Warehouses List')}
          subtitle={t('المخازن والفروع المسجلة وإجمالي الوحدات والقيمة الشرائية', 'Registered warehouses and branches with total units and cost value')}
          data={warehouses}
          rowKey={(wh) => wh.id}
          compact
          searchPlaceholder={t('بحث باسم المستودع أو الكود أو الموقع...', 'Search by warehouse name, code, or location...')}
          searchFilter={(wh, q) =>
            `${wh.name} ${t(wh.name)} ${wh.code} ${wh.location || ''} ${wh.managerName || ''} ${wh.phone || ''}`.toLowerCase().includes(q)
          }
          exportFilename="AWLAD_SELIM_Warehouses"
          pdfTitle={t('قائمة المستودعات', 'Warehouses List')}
          emptyTitle={t('لا توجد مستودعات مسجلة', 'No warehouses registered')}
          rowClassName={(wh) => wh.status === 'suspended' ? 'opacity-70 bg-slate-50/70' : ''}
          columns={[
            {
              key: 'code',
              header: t('الكود', 'Code'),
              sortable: true,
              sortValue: (wh) => wh.code,
              exportValue: (wh) => wh.code,
              render: (wh) => <span className="font-mono font-bold text-[#011E58]">{wh.code}</span>,
            },
            {
              key: 'name',
              header: t('المستودع', 'Warehouse'),
              sortable: true,
              sortValue: (wh) => wh.name,
              exportValue: (wh) => t(wh.name),
              render: (wh) => (
                <div className="flex items-center gap-2">
                  <span className="font-black text-slate-900">{t(wh.name)}</span>
                  {wh.isDefault && (
                    <span className="px-2 py-0.5 rounded bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] text-[10px] font-black">{t('افتراضي', 'Default')}</span>
                  )}
                </div>
              ),
            },
            {
              key: 'location',
              header: t('الموقع', 'Location'),
              exportValue: (wh) => (wh.location ? t(wh.location) : '-'),
              render: (wh) => <span className="text-slate-700">{wh.location ? t(wh.location) : '-'}</span>,
            },
            {
              key: 'managerName',
              header: t('أمين المستودع / الهاتف', 'Manager / Phone'),
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
              header: t('أصناف متوفرة', 'In-Stock Items'),
              align: 'center',
              sortable: true,
              sortValue: (wh) => products.filter((p) => Number(p.stockPerWarehouse?.[wh.id] || 0) > 0).length,
              exportValue: (wh) => products.filter((p) => Number(p.stockPerWarehouse?.[wh.id] || 0) > 0).length,
              render: (wh) => (
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {fmt(products.filter((p) => Number(p.stockPerWarehouse?.[wh.id] || 0) > 0).length)}
                </span>
              ),
            },
            {
              key: 'totalUnits',
              header: t('إجمالي الوحدات', 'Total Units'),
              align: 'center',
              sortable: true,
              sortValue: (wh) => products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0), 0),
              exportValue: (wh) => products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0), 0),
              render: (wh) => (
                <span className="font-mono font-black text-[#003589] tabular-nums">
                  {fmt(products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0), 0))}
                </span>
              ),
            },
            {
              key: 'totalValue',
              header: t('القيمة الشرائية', 'Cost Value'),
              align: 'center',
              sortable: true,
              sortValue: (wh) => products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0) * Number(p.purchasePrice || 0), 0),
              exportValue: (wh) => Math.round(products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0) * Number(p.purchasePrice || 0), 0)),
              render: (wh) => (
                <span className="font-mono font-black text-emerald-700 tabular-nums">
                  {fmt(Math.round(products.reduce((sum, p) => sum + Number(p.stockPerWarehouse?.[wh.id] || 0) * Number(p.purchasePrice || 0), 0)))} {t(settings.currency)}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              exportValue: (wh) => (wh.status === 'suspended' ? t('موقوف', 'Suspended') : t('نشط', 'Active')),
              render: (wh) => {
                const isSuspended = wh.status === 'suspended';
                return (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isSuspended ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {isSuspended ? t('موقوف', 'Suspended') : t('نشط', 'Active')}
                  </span>
                );
              },
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
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
                      {t('تعديل', 'Edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmState({
                          isOpen: true,
                          title: isSuspended ? t('تفعيل المستودع', 'Activate Warehouse') : t('إيقاف المستودع', 'Suspend Warehouse'),
                          message: isLtr
                            ? `Do you want to ${isSuspended ? 'activate' : 'suspend'} warehouse (${t(wh.name)})?`
                            : `هل تريد ${isSuspended ? 'تفعيل' : 'إيقاف'} المستودع (${wh.name})؟`,
                          variant: isSuspended ? 'info' : 'warning',
                          onConfirm: async () => {
                            const res = await toggleWarehouseStatus(wh.id);
                            setConfirmState(null);
                            if (!res.success) {
                              setStatusBanner({ type: 'error', text: res.error ? t(res.error) : t('تعذر تغيير حالة المستودع', 'Unable to update warehouse status') });
                            } else {
                              setStatusBanner({
                                type: 'success',
                                text: isSuspended
                                  ? t('تم تفعيل المستودع بنجاح.', 'Warehouse activated successfully.')
                                  : t('تم إيقاف المستودع بنجاح.', 'Warehouse suspended successfully.'),
                              });
                            }
                          },
                        });
                      }}
                      className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer ${isSuspended ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}
                    >
                      {isSuspended ? t('تفعيل', 'Activate') : t('إيقاف', 'Suspend')}
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
          title={editingWarehouse ? `${t('تعديل المستودع:', 'Edit Warehouse:')} ${t(editingWarehouse.name)}` : t('إضافة مستودع جديد', 'Add New Warehouse')}
          maxWidth="lg"
        >
          <form onSubmit={handleSaveWh} className="space-y-3 text-xs">
            {whModalError && (
              <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">{whModalError}</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">{t('اسم المستودع: *', 'Warehouse Name: *')}</label>
                <input
                  type="text"
                  required
                  value={whForm.name}
                  onChange={(e) => setWhForm({ ...whForm, name: e.target.value })}
                  placeholder={t('مثال: المخزن الرئيسي - شبرا', 'e.g. Main Warehouse - Shubra')}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{t('كود المستودع:', 'Warehouse Code:')}</label>
                <input
                  type="text"
                  value={whForm.code}
                  onChange={(e) => setWhForm({ ...whForm, code: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{t('العنوان / الموقع:', 'Address / Location:')}</label>
                <input
                  type="text"
                  value={whForm.location}
                  onChange={(e) => setWhForm({ ...whForm, location: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{t('أمين المستودع المسؤول:', 'Warehouse Keeper / Manager:')}</label>
                <input
                  type="text"
                  value={whForm.managerName}
                  onChange={(e) => setWhForm({ ...whForm, managerName: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{t('رقم الهاتف:', 'Phone Number:')}</label>
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
                <label htmlFor="wh-default-check" className="font-bold cursor-pointer">{t('مستودع افتراضي للفواتير', 'Default Warehouse for Invoices')}</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2.5 border-t">
              <button type="button" onClick={() => setIsWarehouseModalOpen(false)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">{t('إلغاء', 'Cancel')}</button>
              <button type="submit" disabled={isSavingWh} className="h-8 px-4 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50">
                {isSavingWh ? t('جاري الحفظ...', 'Saving...') : t('حفظ المستودع', 'Save Warehouse')}
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
      opening: { label: t('رصيد افتتاحي', 'Opening Balance'), cls: 'bg-slate-100 text-slate-700' },
      purchase: { label: t('فاتورة شراء (+)', 'Purchase Invoice (+)'), cls: 'bg-emerald-100 text-emerald-800' },
      sale: { label: t('فاتورة بيع (-)', 'Sales Invoice (-)'), cls: 'bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5]' },
      sale_return: { label: t('مرتجع بيع (+)', 'Sales Return (+)'), cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200' },
      purchase_return: { label: t('مرتجع شراء (-)', 'Purchase Return (-)'), cls: 'bg-amber-100 text-amber-800' },
      transfer_in: { label: t('تحويل وارد (+)', 'Transfer In (+)'), cls: 'bg-[#EEF3FA] text-[#003589] border border-[#DCE6F5]' },
      transfer_out: { label: t('تحويل صادر (-)', 'Transfer Out (-)'), cls: 'bg-slate-100 text-[#002160] border border-slate-300' },
      adjustment: { label: t('تسوية جردية', 'Stock Adjustment'), cls: 'bg-[#DCE6F5] text-[#011E58]' },
      damaged: { label: t('إثبات تالف (-)', 'Damaged (-)'), cls: 'bg-red-100 text-red-800' },
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
              <span>{t('سجل حركات المخازن التفصيلي', 'Detailed Stock Movements Log')}</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t('تتبع كل حركة دخول وخروج وتحويل وتسوية وجرد وتلف للأصناف عبر جميع المستودعات', 'Track every stock in/out, transfer, adjustment, count, and damage across all warehouses')} ({fmt(filteredMovements.length)} {t('حركة', 'movements')})
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const headers = [
                t('التاريخ', 'Date'),
                t('نوع الحركة', 'Movement Type'),
                t('الصنف', 'Item'),
                t('المستودع', 'Warehouse'),
                t('الكمية', 'Quantity'),
                t('رقم المرجع', 'Ref. No.'),
                t('ملاحظات', 'Notes'),
                t('بواسطة', 'By'),
              ];
              const rows = filteredMovements.map((m) => [
                m.date,
                MOVEMENT_LABELS[m.type]?.label || m.type,
                m.productName,
                m.warehouseName ? t(m.warehouseName) : '',
                m.quantity,
                m.referenceNumber || '-',
                m.notes || '-',
                m.createdBy,
              ]);
              exportToExcel(`${t('سجل_حركات_المخازن', 'Stock_Movements_Log')}_${new Date().toISOString().split('T')[0]}`, headers, rows);
            }}
            className="flex items-center gap-1.5 h-8 px-2.5 border border-slate-300 rounded-md text-xs font-bold hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#003589]" />
            <span>{t('تصدير Excel', 'Export Excel')}</span>
          </button>
        </div>

        <UnifiedDataTable
          title={t('حركات المخازن', 'Stock Movements')}
          subtitle={t('أرصدة الدخول والخروج والتحويل والتسويات', 'Stock in/out, transfers, and adjustment balances')}
          data={filteredMovements}
          rowKey={(m, idx) => `${m.id || m.referenceNumber}-${idx}`}
          compact
          searchValue={movementSearch}
          onSearchChange={setMovementSearch}
          searchPlaceholder={t('بحث بالصنف أو رقم المرجع أو البيان...', 'Search by item, reference #, or description...')}
          exportFilename="AWLAD_SELIM_StockMovements"
          pdfTitle={t('سجل حركات المخازن التفصيلي', 'Detailed Stock Movements Log')}
          emptyTitle={t('لا توجد حركات مخزنية مطابقة للبحث', 'No matching stock movements found')}
          toolbarFilters={
            <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
              <div className="w-[155px] shrink-0">
                <SearchableFilterSelect
                  id="inv-mov-type"
                  inlinePrefix={t('الحركة', 'Type')}
                  value={movementTypeFilter}
                  onChange={setMovementTypeFilter}
                  options={Object.entries(MOVEMENT_LABELS).map(([k, v]) => ({
                    value: k,
                    label: v.label,
                  }))}
                  allOptionLabel={t('الكل', 'All')}
                  allOptionValue="all"
                  allowClear
                  buttonClassName="rounded-md h-8 min-h-[32px]"
                />
              </div>
              <div className="w-[155px] shrink-0">
                <SearchableFilterSelect
                  id="inv-mov-wh"
                  inlinePrefix={t('المستودع', 'Warehouse')}
                  value={movementWhFilter}
                  onChange={setMovementWhFilter}
                  options={warehouses.map((w) => ({
                    value: w.id,
                    label: t(w.name),
                    subtitle: w.code,
                  }))}
                  allOptionLabel={t('الكل', 'All')}
                  allOptionValue="all"
                  allowClear
                  buttonClassName="rounded-md h-8 min-h-[32px]"
                />
              </div>
            </div>
          }
          columns={[
            {
              key: 'date',
              header: t('التاريخ', 'Date'),
              sortable: true,
              sortValue: (m) => m.date,
              exportValue: (m) => m.date,
              render: (m) => <span className="font-mono text-slate-600">{m.date}</span>,
            },
            {
              key: 'type',
              header: t('نوع الحركة', 'Movement Type'),
              exportValue: (m) => MOVEMENT_LABELS[m.type]?.label || m.type,
              render: (m) => {
                const meta = MOVEMENT_LABELS[m.type] || { label: m.type, cls: 'bg-slate-100 text-slate-700' };
                return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>;
              },
            },
            {
              key: 'productName',
              header: t('الصنف', 'Item'),
              sortable: true,
              sortValue: (m) => m.productName || '',
              exportValue: (m) => m.productName || '-',
              render: (m) => <span className="font-bold text-slate-900">{m.productName}</span>,
            },
            {
              key: 'warehouseName',
              header: t('المستودع', 'Warehouse'),
              exportValue: (m) => m.targetWarehouseName ? `${t(m.warehouseName)} ${isRtl ? '←' : '→'} ${t(m.targetWarehouseName)}` : t(m.warehouseName),
              render: (m) => (
                <div>
                  <span>{t(m.warehouseName)}</span>
                  {m.targetWarehouseName && (
                    <span className="text-[10px] text-[#003589] font-bold block">{isRtl ? '←' : '→'} {t(m.targetWarehouseName)}</span>
                  )}
                </div>
              ),
            },
            {
              key: 'quantity',
              header: t('الكمية', 'Quantity'),
              align: 'center',
              sortable: true,
              sortValue: (m) => Number(m.quantity || 0),
              exportValue: (m) => Number(m.quantity || 0),
              render: (m) => <span className="font-mono font-black tabular-nums">{fmt(Number(m.quantity || 0))}</span>,
            },
            {
              key: 'referenceNumber',
              header: t('المرجع', 'Reference'),
              exportValue: (m) => m.referenceNumber || '-',
              render: (m) => <span className="font-mono text-[#011E58] font-bold">{m.referenceNumber || '-'}</span>,
            },
            {
              key: 'notes',
              header: t('ملاحظات', 'Notes'),
              exportValue: (m) => m.notes || '-',
              render: (m) => <span className="text-slate-600">{m.notes || '-'}</span>,
            },
            {
              key: 'createdBy',
              header: t('بواسطة', 'By'),
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
      setStatusBanner({
        type: 'success',
        text: `${t('تمت إضافة التصنيف', 'Category added:')} (${res.category?.name})`,
      });
    } else {
      setStatusBanner({ type: 'error', text: res.error ? t(res.error) : t('تعذر إضافة التصنيف', 'Unable to add category') });
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
        text: isLtr
          ? `Renamed category from (${renamingCategory.currentName}) to (${renameTargetValue.trim()}) and updated all linked products.`
          : `تم تغيير اسم التصنيف من (${renamingCategory.currentName}) إلى (${renameTargetValue.trim()}) وتحديث جميع الأصناف المرتبطة به.`,
      });
      setRenamingCategory(null);
      setRenameTargetValue('');
    } else {
      setStatusBanner({ type: 'error', text: res.error ? t(res.error) : t('فشل تغيير اسم التصنيف', 'Failed to rename category') });
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
    await handleSaveUnitsCatalog(
      [...unitsCatalog, item],
      `${t('تمت إضافة الوحدة', 'Unit added:')} (${t(item.name)})`
    );
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
              <span>{t('تصنيفات السلع وتغيير اسم التصنيفات الشامل', 'Product Categories & Global Rename')}</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t('إضافة التصنيفات وتغيير أسمائها مع التحديث التلقائي الشامل لكل المنتجات المرتبطة بها', 'Add categories and rename them with automatic global updates across all linked products')}
            </p>
          </div>
        </div>

        {statusBanner && (
          <div className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between ${
            statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">{t('إغلاق', 'Close')}</button>
          </div>
        )}

        <form onSubmit={handleAddCategory} className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs items-end">
          <div>
            <label className="block font-bold mb-1">{t('اسم التصنيف الجديد: *', 'New Category Name: *')}</label>
            <input
              type="text"
              required
              placeholder={t('مثال: البقوليات والحبوب', 'e.g. Grains & Pulses')}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">{t('وصف مختصر:', 'Short Description:')}</label>
            <input
              type="text"
              placeholder={t('ملاحظات عن المجموعة السلعية', 'Notes about this category')}
              value={newCategoryDesc}
              onChange={(e) => setNewCategoryDesc(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5"
            />
          </div>
          <button type="submit" className="h-8 px-3.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer">
            {t('+ إضافة تصنيف جديد', '+ Add New Category')}
          </button>
        </form>

        <UnifiedDataTable
          title={t('التصنيفات الغذائية', 'Product Categories')}
          data={categoryList}
          rowKey={(cat) => cat.id}
          compact
          searchPlaceholder={t('بحث باسم التصنيف...', 'Search by category name...')}
          searchFilter={(cat, q) => `${cat.name} ${t(cat.name)} ${cat.description || ''}`.toLowerCase().includes(q)}
          exportFilename="AWLAD_SELIM_Categories"
          pdfTitle={t('دليل التصنيفات الغذائية', 'Product Categories Directory')}
          columns={[
            {
              key: 'name',
              header: t('اسم التصنيف', 'Category Name'),
              sortable: true,
              sortValue: (cat) => cat.name,
              exportValue: (cat) => t(cat.name),
              render: (cat) => <span className="font-black text-slate-900">{t(cat.name)}</span>,
            },
            {
              key: 'description',
              header: t('الوصف', 'Description'),
              exportValue: (cat) => cat.description || '-',
              render: (cat) => <span className="text-slate-600">{cat.description || '-'}</span>,
            },
            {
              key: 'linkedCount',
              header: t('عدد الأصناف المرتبطة', 'Linked Products'),
              align: 'center',
              sortable: true,
              sortValue: (cat) => products.filter(p => p.category === cat.name).length,
              exportValue: (cat) => products.filter(p => p.category === cat.name).length,
              render: (cat) => (
                <span className="font-mono font-bold text-[#011E58] tabular-nums">
                  {fmt(products.filter(p => p.category === cat.name).length)} {t('صنف', 'items')}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              exportValue: (cat) => (cat.status !== 'suspended' ? t('نشط', 'Active') : t('موقوف', 'Suspended')),
              render: (cat) => (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${cat.status !== 'suspended' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-600'}`}>
                  {cat.status !== 'suspended' ? t('نشط', 'Active') : t('موقوف', 'Suspended')}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
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
                    {t('تغيير الاسم الشامل', 'Global Rename')}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleCategoryStatus(cat.id)}
                    className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                  >
                    {cat.status !== 'suspended' ? t('إيقاف', 'Suspend') : t('تفعيل', 'Activate')}
                  </button>
                </div>
              ),
            },
          ]}
        />

        <Modal
          isOpen={!!renamingCategory}
          onClose={() => setRenamingCategory(null)}
          title={`${t('تغيير اسم التصنيف:', 'Rename Category:')} ${renamingCategory?.currentName ? t(renamingCategory.currentName) : ''}`}
          subtitle={t('سيتم تحديث اسم التصنيف في جميع المنتجات المرتبطة به تلقائياً على الخادم', 'The category name will be automatically updated across all linked products on the server')}
          maxWidth="md"
        >
          <form onSubmit={handleConfirmRenameCategory} className="space-y-3 text-xs">
            <div>
              <label className="block font-bold mb-1">{t('الاسم الجديد للتصنيف: *', 'New Category Name: *')}</label>
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
                {t('إلغاء', 'Cancel')}
              </button>
              <button type="submit" disabled={isRenamingCat} className="h-8 px-4 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50">
                {isRenamingCat ? t('جاري التحديث...', 'Updating...') : t('تطبيق التغيير الشامل', 'Apply Global Rename')}
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
            <span>{t('دليل الوحدات ومعاملات التحويل', 'Units & Conversion Factors Directory')}</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {t('تجهيز وحدات القياس والتعبئة القياسية (قطعة، دستة، كرتونة، شيكارة، بالة) لاستخدامها السريع في الأصناف', 'Configure standard measurement and packaging units (Piece, Dozen, Carton, Sack, Bale) for quick product setup')}
          </p>
        </div>

        {statusBanner && (
          <div className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between ${
            statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">{t('إغلاق', 'Close')}</button>
          </div>
        )}

        <form onSubmit={handleAddUnitItem} className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs items-end">
          <div>
            <label className="block font-bold mb-1">{t('اسم الوحدة: *', 'Unit Name: *')}</label>
            <input
              type="text"
              required
              placeholder={t('مثال: كرتونة 24', 'e.g. Carton 24')}
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">{t('الرمز المختصر:', 'Short Code:')}</label>
            <input
              type="text"
              placeholder="CTN24"
              value={newUnitCode}
              onChange={(e) => setNewUnitCode(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">{t('معامل التحويل الأساسي:', 'Base Conversion Factor:')}</label>
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
            <label className="block font-bold mb-1">{t('ملاحظات:', 'Notes:')}</label>
            <input
              type="text"
              value={newUnitNotes}
              onChange={(e) => setNewUnitNotes(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5"
            />
          </div>
          <button type="submit" disabled={isSavingUnits} className="h-8 px-3.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer disabled:opacity-50">
            {t('+ إضافة وحدة', '+ Add Unit')}
          </button>
        </form>

        <UnifiedDataTable<UnitCatalogItem>
          title={t('الوحدات المسجلة', 'Registered Units')}
          data={unitsCatalog}
          rowKey={(u) => u.id}
          compact
          searchPlaceholder={t('بحث باسم الوحدة أو الرمز...', 'Search by unit name or code...')}
          searchFilter={(u, q) => `${u.name} ${t(u.name)} ${u.shortCode || ''} ${u.notes || ''}`.toLowerCase().includes(q)}
          exportFilename="AWLAD_SELIM_Units"
          pdfTitle={t('دليل وحدات القياس', 'Units Directory')}
          columns={[
            {
              key: 'name',
              header: t('اسم الوحدة', 'Unit Name'),
              sortable: true,
              sortValue: (u) => u.name,
              exportValue: (u) => t(u.name),
              render: (u) => <span className="font-black text-slate-900">{t(u.name)}</span>,
            },
            {
              key: 'shortCode',
              header: t('الرمز', 'Code'),
              exportValue: (u) => u.shortCode || '-',
              render: (u) => <span className="font-mono text-[#011E58] font-bold">{u.shortCode || '-'}</span>,
            },
            {
              key: 'defaultConversionFactor',
              header: t('معامل التحويل الافتراضي', 'Default Factor'),
              align: 'center',
              sortable: true,
              sortValue: (u) => u.defaultConversionFactor,
              exportValue: (u) => u.defaultConversionFactor,
              render: (u) => <span className="font-mono font-bold tabular-nums">{fmt(u.defaultConversionFactor)}</span>,
            },
            {
              key: 'notes',
              header: t('ملاحظات', 'Notes'),
              exportValue: (u) => (u.notes ? t(u.notes) : '-'),
              render: (u) => <span className="text-slate-600">{u.notes ? t(u.notes) : '-'}</span>,
            },
            {
              key: 'actions',
              header: t('حذف', 'Delete'),
              align: 'center',
              render: (u) => (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmState({
                      isOpen: true,
                      title: t('حذف وحدة القياس', 'Delete Unit'),
                      message: isLtr
                        ? `Do you want to delete unit (${t(u.name)}) from the directory?`
                        : `هل تريد حذف الوحدة (${u.name}) من الدليل؟`,
                      variant: 'danger',
                      onConfirm: async () => {
                        setConfirmState(null);
                        await handleSaveUnitsCatalog(
                          unitsCatalog.filter((x) => x.id !== u.id),
                          `${t('تم حذف الوحدة', 'Unit deleted:')} (${t(u.name)})`
                        );
                      },
                    });
                  }}
                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                  title={t('حذف الوحدة', 'Delete Unit')}
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
          <h2 className="text-sm font-black text-[#011E58] dark:text-[#F3F7FC] tracking-tight">{t('إدارة المخازن والمنتجات الغذائية', 'Warehouses & Food Products Management')}</h2>
          <p className="text-[11px] text-slate-500 dark:text-[#97AECE]">
            {t('متابعة أرصدة السلع، أسعار الجملة، التحويلات بين المستودعات، والجرد', 'Monitor stock balances, wholesale prices, inter-warehouse transfers, and stocktaking')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 h-8 px-2.5 border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#132544] rounded-md text-xs font-bold hover:bg-slate-50 dark:hover:bg-[#1A3461] text-slate-700 dark:text-[#DCE6F5] cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#003589] dark:text-[#85B8FF]" />
            <span>{t('تصدير Excel', 'Export Excel')}</span>
          </button>

          <button
            onClick={() => {
              setTransferProdId(products[0]?.id || '');
              setIsTransferModalOpen(true);
            }}
            className="flex items-center gap-1.5 h-8 px-2.5 bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#2A436E] text-[#011E58] dark:text-[#85B8FF] rounded-md text-xs font-bold hover:bg-[#DCE6F5] dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-[#003589] dark:text-[#85B8FF]" />
            <span>{t('تحويل بين المستودعات', 'Warehouse Transfer')}</span>
          </button>

          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black shadow-xs active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('إضافة صنف جديد', 'Add New Product')}</span>
          </button>
        </div>
      </div>

      {/* Compact Inventory Summary Ledger Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden text-xs">
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('إجمالي الأصناف النشطة', 'Total Active Products')}</div>
          <div className="text-sm font-black font-mono tabular-nums text-[var(--awlad-navy-950)] dark:text-[#F3F7FC]">
            {fmt(inventoryStats.activeCount)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t('صنف', 'items')}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('أصناف عند حد الطلب الأدنى', 'Items at Low Stock')}</div>
          <div className="text-sm font-black font-mono tabular-nums text-rose-700 dark:text-rose-400">
            {fmt(inventoryStats.lowCount)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t('صنف', 'items')}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('تقييم المخزون (تكلفة)', 'Inventory Valuation (Cost)')}</div>
          <div className="text-sm font-black font-mono tabular-nums text-[var(--awlad-royal-700)] dark:text-[#85B8FF]">
            {fmt(inventoryStats.totalCostValue)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t(settings.currency)}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">{t('المستودعات المسجلة', 'Registered Warehouses')}</div>
          <div className="text-sm font-black font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">
            {fmt(inventoryStats.warehouseCount)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t('مستودع', 'warehouses')}</span>
          </div>
        </div>
      </div>

      {statusBanner && (
        <div className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center justify-between ${
          statusBanner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
        }`}>
          <span>{statusBanner.text}</span>
          <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">{t('إغلاق', 'Close')}</button>
        </div>
      )}

      {/* Products Table */}
      <UnifiedDataTable<Product>
        title={t('قائمة الأصناف وأرصدة المخازن', 'Products List & Warehouse Stock')}
        subtitle={`${t('إجمالي الأصناف المعروضة:', 'Displayed Products:')} ${fmt(filteredProducts.length)} ${t('صنف', 'items')}`}
        data={filteredProducts}
        rowKey={(prod) => prod.id}
        onRowClick={(prod) => setPreviewProduct(prod)}
        compact
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={t('بحث بالاسم أو الباركود أو الكود أو التصنيف...', 'Search by name, barcode, code, or category...')}
        exportFilename="AWLAD_SELIM_Products"
        pdfTitle={t('قائمة الأصناف وأرصدة المخازن', 'Products List & Warehouse Stock')}
        emptyTitle={t('لا توجد أصناف غذائية مطابقة للبحث أو لم تتم إضافة أصناف بعد', 'No matching food products found or none added yet')}
        rowClassName={(prod) => prod.status !== 'active' ? 'opacity-65 bg-slate-50 dark:bg-[#101E38]' : ''}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
            <div className="w-[150px] shrink-0">
              <SearchableFilterSelect
                id="inv-prod-cat"
                inlinePrefix={t('التصنيف', 'Category')}
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={categories
                  .filter((c) => c !== 'all')
                  .map((c) => ({ value: c, label: t(c) }))}
                allOptionLabel={t('الكل', 'All')}
                allOptionValue="all"
                allowClear
                buttonClassName="rounded-md h-8 min-h-[32px]"
              />
            </div>
            <div className="w-[150px] shrink-0">
              <SearchableFilterSelect
                id="inv-prod-wh"
                inlinePrefix={t('المستودع', 'Warehouse')}
                value={warehouseFilter}
                onChange={setWarehouseFilter}
                options={warehouses.map((w) => ({
                  value: w.id,
                  label: t(w.name),
                  subtitle: w.code,
                }))}
                allOptionLabel={t('الكل', 'All')}
                allOptionValue="all"
                allowClear
                buttonClassName="rounded-md h-8 min-h-[32px]"
              />
            </div>
            <select
              aria-label={t('تصفية حسب حالة المخزون', 'Filter by stock status')}
              value={stockHealthFilter}
              onChange={(e) => setStockHealthFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC] focus:outline-hidden focus:border-[var(--awlad-royal-700)]"
            >
              <option value="all">{t('كل حالات المخزون', 'All Stock Statuses')}</option>
              <option value="low">{t('نقص مخزون (حد أدنى)', 'Low Stock (Min Level)')}</option>
              <option value="ok">{t('متوفر كافي', 'Sufficient Stock')}</option>
              <option value="inactive">{t('أصناف موقوفة', 'Suspended Items')}</option>
            </select>
          </div>
        }
        columns={[
          {
            key: 'code',
            header: t('الكود / الباركود', 'Code / Barcode'),
            sortable: true,
            sortValue: (prod) => prod.code,
            exportValue: (prod) => `${prod.code} ${prod.barcode || ''}`.trim(),
            render: (prod) => (
              <div className="flex items-center gap-2.5 font-mono">
                <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                  <Package className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-blue-950">{prod.code}</div>
                  <div className="text-[10px] text-slate-400">{prod.barcode || '-'}</div>
                </div>
              </div>
            ),
          },
          {
            key: 'name',
            header: t('اسم الصنف الغذائي', 'Product Name'),
            sortable: true,
            sortValue: (prod) => prod.name,
            exportValue: (prod) => prod.name,
            render: (prod) => (
              <div>
                <span className="font-bold text-slate-900 block text-xs">
                  {prod.name}
                  {prod.status !== 'active' && (
                    <span className="ms-1.5 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[9px]">{t('موقوف', 'Suspended')}</span>
                  )}
                </span>
                <span className="text-[10px] text-slate-500">{t('الوحدة الأساسية:', 'Base Unit:')} {t(prod.baseUnit)}</span>
              </div>
            ),
          },
          {
            key: 'category',
            header: t('التصنيف', 'Category'),
            sortable: true,
            sortValue: (prod) => prod.category,
            exportValue: (prod) => t(prod.category),
            render: (prod) => (
              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[10px]">
                {t(prod.category)}
              </span>
            ),
          },
          {
            key: 'units',
            header: t('الوحدات الإضافية', 'Additional Units'),
            exportValue: (prod) => (prod.units || []).map(u => `${t(u.name)} (${u.sellingPrice})`).join(', ') || t('أساسية فقط', 'Base only'),
            render: (prod) => (
              prod.units && prod.units.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {prod.units.map(u => (
                    <span key={u.id} className="px-1.5 py-0.5 rounded bg-[#EEF3FA] text-[#011E58] text-[10px] font-semibold border border-[#DCE6F5]">
                      {t(u.name)} ({fmt(u.sellingPrice)} {t(settings.currency)})
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-slate-400 text-[10px]">{t('أساسية فقط', 'Base only')}</span>
              )
            ),
          },
          {
            key: 'purchasePrice',
            header: t('سعر الشراء', 'Purchase Price'),
            align: 'center',
            sortable: true,
            sortValue: (prod) => prod.purchasePrice,
            exportValue: (prod) => prod.purchasePrice,
            render: (prod) => <span className="font-mono font-bold text-slate-700 tabular-nums">{fmt(Number(prod.purchasePrice.toFixed(2)))}</span>,
          },
          {
            key: 'sellingPrice',
            header: t('سعر البيع', 'Selling Price'),
            align: 'center',
            sortable: true,
            sortValue: (prod) => prod.sellingPrice,
            exportValue: (prod) => prod.sellingPrice,
            render: (prod) => <span className="font-mono font-black text-[#011E58] tabular-nums">{fmt(Number(prod.sellingPrice.toFixed(2)))} {t(settings.currency)}</span>,
          },
          {
            key: 'totalStock',
            header: warehouseFilter === 'all' ? t('الرصيد الإجمالي', 'Total Stock') : t('رصيد المستودع', 'Warehouse Stock'),
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
                  {fmt(totalStock)} <span className="text-[10px] font-normal text-slate-500">{t(prod.baseUnit)}</span>
                </span>
              );
            },
          },
          {
            key: 'stockHealth',
            header: t('حالة المخزون', 'Stock Health'),
            align: 'center',
            exportValue: (prod) => {
              const totalStock = warehouseFilter === 'all'
                ? Object.values(prod.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
                : Number(prod.stockPerWarehouse?.[warehouseFilter] || 0);
              return totalStock <= prod.minStockLevel ? t('نقص مخزون', 'Low Stock') : t('متوفر كافي', 'Sufficient');
            },
            render: (prod) => {
              const totalStock = warehouseFilter === 'all'
                ? Object.values(prod.stockPerWarehouse || {}).reduce((a, b) => a + b, 0)
                : Number(prod.stockPerWarehouse?.[warehouseFilter] || 0);
              const isLow = totalStock <= prod.minStockLevel;
              return isLow ? (
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[10px] border border-red-300">
                  {t('نقص مخزون', 'Low Stock')} ({t('حد أدنى:', 'Min:')} {fmt(prod.minStockLevel)})
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                  {t('متوفر كافي', 'Sufficient')}
                </span>
              );
            },
          },
          {
            key: 'actions',
            header: t('الإجراءات', 'Actions'),
            align: 'center',
            render: (prod) => (
              <div className="flex items-center justify-center gap-1 flex-wrap">
                {onOpenItemMovementReport && (
                  <button
                    type="button"
                    onClick={() => onOpenItemMovementReport(prod.id)}
                    className="px-2 py-1 rounded-md bg-[#EEF3FA] text-[#011E58] hover:bg-[#DCE6F5] border border-[#DCE6F5] text-[11px] font-bold cursor-pointer"
                    title={t('تقرير حركة الصنف المفصل', 'Detailed Item Movement Report')}
                  >
                    {t('حركة الصنف', 'Movement')}
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
                  title={t('تسوية جردية', 'Stock Adjustment')}
                >
                  {t('تسوية', 'Adjust')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDamageProdId(prod.id);
                    setDamageModalError(null);
                    setIsDamageModalOpen(true);
                  }}
                  className="p-1 rounded-lg text-amber-600 hover:bg-amber-50 text-[11px] font-bold cursor-pointer"
                  title={t('إثبات تالف', 'Record Damaged')}
                >
                  {t('تالف', 'Damaged')}
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenEdit(prod)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-900 hover:bg-slate-100 cursor-pointer"
                  title={t('تعديل', 'Edit')}
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmState({
                      isOpen: true,
                      title: prod.status === 'active' ? t('إيقاف الصنف', 'Suspend Product') : t('تفعيل الصنف', 'Activate Product'),
                      message: isLtr
                        ? `Do you want to ${prod.status === 'active' ? 'suspend' : 'reactivate'} product (${prod.name})?`
                        : `هل تريد ${prod.status === 'active' ? 'إيقاف' : 'إعادة تفعيل'} الصنف (${prod.name})؟`,
                      variant: 'warning',
                      onConfirm: async () => {
                        setConfirmState(null);
                        const res = await toggleProductStatus(prod.id);
                        if (!res.success) {
                          setStatusBanner({ type: 'error', text: res.error ? t(res.error) : t('تعذر تغيير حالة الصنف', 'Unable to update product status') });
                        }
                      },
                    });
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50 cursor-pointer"
                  title={prod.status === 'active' ? t('إيقاف مؤقت', 'Suspend') : t('تفعيل', 'Activate')}
                >
                  <Power className="w-4 h-4" />
                </button>
                {hasPermission('canDelete') && (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmState({
                        isOpen: true,
                        title: t('حذف الصنف من قاعدة البيانات', 'Delete Product from Database'),
                        message: isLtr
                          ? `Are you sure you want to permanently delete product (${prod.name})? (Deletion is blocked if linked to previous invoices or movements).`
                          : `هل أنت متأكد من حذف الصنف (${prod.name}) نهائياً؟ (لن يُسمح بالحذف إذا كان الصنف مرتبطاً بفواتير أو حركات سابقة).`,
                        variant: 'danger',
                        onConfirm: async () => {
                          setConfirmState(null);
                          const res = await deleteProduct(prod.id);
                          if (!res.success) {
                            setStatusBanner({ type: 'error', text: res.error ? t(res.error) : t('لا يمكن حذف الصنف لارتباطه بعمليات مسجلة', 'Cannot delete product linked to existing transactions') });
                          } else {
                            setStatusBanner({ type: 'success', text: `${t('تم حذف الصنف', 'Product deleted:')} (${prod.name})` });
                          }
                        },
                      });
                    }}
                    className="p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                    title={t('حذف الصنف', 'Delete Product')}
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
        title={editingProduct ? t('تعديل بيانات المنتج الغذائي', 'Edit Food Product Details') : t('إضافة منتج غذائي جديد للمخزن', 'Add New Food Product to Inventory')}
        maxWidth="4xl"
      >
        <form onSubmit={handleSaveProduct} className="space-y-3 text-xs">
          {productModalError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">
              {productModalError}
            </div>
          )}

          <div className="space-y-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('اسم الصنف الغذائي: *', 'Product Name: *')}</label>
              <input
                type="text"
                required
                placeholder={t('مثال: زيت عباد الشمس عافية 1 لتر', 'e.g. Afia Sunflower Oil 1L')}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-900 focus:border-blue-700 outline-hidden"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('كود الصنف: *', 'Product Code: *')}</label>
                <input
                  type="text"
                  required
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('الباركود (اختياري):', 'Barcode (Optional):')}</label>
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder={t('اتركه فارغاً أو أدخل الباركود', 'Leave blank or enter barcode')}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('التصنيف: *', 'Category: *')}</label>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('المقاس (اختياري عند الحاجة):', 'Size (Optional):')}</label>
              <input
                type="text"
                placeholder={t('مثال: وسط، كبير، 500 جرام، 1 لتر', 'e.g. Medium, Large, 500g, 1L')}
                value={formData.size || ''}
                onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('اللون / النكهة (اختياري عند الحاجة):', 'Color / Flavor (Optional):')}</label>
              <input
                type="text"
                placeholder={t('مثال: أحمر، شطة وليمون، جبنة متبلة', 'e.g. Red, Chili & Lemon, Spiced Cheese')}
                value={formData.color || ''}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 font-bold"
              />
            </div>
          </div>

          {/* Flexible Packaging Units Configuration (Section 2) */}
          <div className="bg-[#EEF3FA]/70 p-2.5 rounded-lg border border-[#DCE6F5] space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-[#011E58] text-xs">{t('وحدات التعبئة الإضافية ومعامل التحويل (مثلاً: الكرتونة = 12 قطعة):', 'Additional Packaging Units & Conversion Factor (e.g. Carton = 12 Pieces):')}</label>
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
                {t('+ إضافة وحدة تعبئة', '+ Add Packaging Unit')}
              </button>
            </div>

            {formData.units.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">{t('لا توجد وحدات تعبئة إضافية (البيع بالوحدة الصغرى الأساسية فقط)', 'No additional packaging units (sold in base unit only)')}</p>
            ) : (
              <div className="space-y-1.5">
                {formData.units.map((u, idx) => (
                  <div key={u.id} className="grid grid-cols-1 sm:grid-cols-5 gap-2 bg-white p-1.5 rounded-lg border border-[#DCE6F5] items-center text-xs">
                    <div>
                      <span className="block text-[10px] text-slate-500 font-bold">{t('اسم الوحدة:', 'Unit Name:')}</span>
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
                      <span className="block text-[10px] text-slate-500 font-bold">{t('تحتوي كم أساسي؟', 'Contains Base Qty?')}</span>
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
                      <span className="block text-[10px] text-slate-500 font-bold">{t('سعر البيع:', 'Selling Price:')}</span>
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
                      <span className="block text-[10px] text-slate-500 font-bold">{t('سعر الشراء:', 'Purchase Price:')}</span>
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
                        {t('حذف', 'Delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('الوحدة الصغرى الأساسية:', 'Base (Smallest) Unit:')}</label>
              <input
                type="text"
                required
                placeholder={t('قطعة، كيس، كيلو، علبة', 'Piece, Bag, Kg, Can')}
                value={formData.baseUnit}
                onChange={(e) => setFormData({ ...formData, baseUnit: e.target.value })}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('سعر شراء الوحدة الأساسية:', 'Base Unit Purchase Price:')}</label>
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
              <label className="block font-bold text-slate-700 mb-1">{t('سعر بيع الوحدة الأساسية:', 'Base Unit Selling Price:')}</label>
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
              <label className="block font-bold text-slate-700 mb-1">{t('حد الطلب الأدنى للتنبيه:', 'Min Stock Alert Level:')}</label>
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
              <label className="block font-bold text-slate-700">{t('الأرصدة الافتتاحية في المستودعات:', 'Opening Stock Balances by Warehouse:')}</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {warehouses.map((w) => (
                  <div key={w.id} className="bg-white p-1.5 rounded-lg border">
                    <span className="block text-[10px] text-slate-500 font-bold whitespace-normal break-words mb-1">{t(w.name)}</span>
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
            <label className="block font-bold text-slate-700 mb-1">{t('ملاحظات الصنف وتواريخ الصلاحية:', 'Product Notes & Expiry Dates:')}</label>
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
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSavingProduct}
              className="h-8 px-4 bg-[#003589] text-white rounded-md font-bold hover:bg-[#0049B0] shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isSavingProduct ? t('جاري الحفظ...', 'Saving...') : t('حفظ المنتج', 'Save Product')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Inter-Warehouse Stock Transfer Modal */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title={t('تحويل مخزني سريع بين المستودعات', 'Quick Inter-Warehouse Stock Transfer')}
        subtitle={t('نقل كميات بضائع من مستودع لآخر مع توثيق الحركة', 'Transfer product quantities from one warehouse to another with movement logging')}
        maxWidth="lg"
      >
        <form onSubmit={handleExecuteTransfer} className="space-y-3 text-xs">
          {transferModalError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">
              {transferModalError}
            </div>
          )}
          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('اختر الصنف الغذائي:', 'Select Food Product:')}</label>
            <ProductSearchSelect
              products={products}
              selectedProductId={transferProdId}
              onSelect={(prod) => setTransferProdId(prod.id)}
              warehouseId={fromWhId}
              warehouses={warehouses}
              currency={t(settings.currency)}
              placeholder={t('ابحث بالاسم أو الكود أو الباركود...', 'Search by name, code, or barcode...')}
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('من مستودع:', 'From Warehouse:')}</label>
              <select
                value={fromWhId}
                onChange={(e) => setFromWhId(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 font-bold"
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{t(w.name)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">{t('إلى مستودع:', 'To Warehouse:')}</label>
              <select
                value={toWhId}
                onChange={(e) => setToWhId(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5 font-bold"
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{t(w.name)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('الكمية المحولة (بالوحدة الأساسية):', 'Transferred Quantity (Base Unit):')}</label>
            <input
              type="number"
              min="1"
              required
              placeholder={t('أدخل الكمية', 'Enter quantity')}
              value={transferQty}
              onChange={(e) => setTransferQty(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full h-8 bg-slate-50 border border-slate-300 rounded-md px-2.5 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('بيان وسبب التحويل:', 'Transfer Description & Reason:')}</label>
            <input
              type="text"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              placeholder={t('تغذية فرع العبور / تجهيز سيارة التوزيع...', 'Obour branch replenishment / Delivery van loading...')}
              className="w-full h-8 bg-white border border-slate-300 rounded-md px-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2.5 border-t">
            <button
              type="button"
              onClick={() => setIsTransferModalOpen(false)}
              className="h-8 px-3.5 border rounded-md font-bold cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmittingTransfer}
              className="h-8 px-4 bg-[#003589] text-white rounded-md font-bold shadow-xs hover:bg-[#0049B0] cursor-pointer disabled:opacity-50"
            >
              {isSubmittingTransfer ? t('جاري التحويل...', 'Transferring...') : t('تنفيذ التحويل المخزني', 'Execute Stock Transfer')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal
        isOpen={isAdjustModalOpen}
        onClose={() => setIsAdjustModalOpen(false)}
        title={t('تسوية جردية للمخزون', 'Inventory Stock Adjustment')}
        subtitle={t('تعديل الرصيد الفعلي بعد الجرد وتوثيق الفروقات', 'Update actual stock balance after counting and log variances')}
        maxWidth="md"
      >
        <form onSubmit={handleExecuteAdjust} className="space-y-3 text-xs">
          {adjustModalError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">
              {adjustModalError}
            </div>
          )}
          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('الصنف:', 'Product:')}</label>
            <ProductSearchSelect
              products={products}
              selectedProductId={adjustProdId}
              onSelect={(prod) => {
                setAdjustProdId(prod.id);
                setAdjustNewQty(Number(prod.stockPerWarehouse?.[adjustWhId] || 0));
              }}
              warehouseId={adjustWhId}
              warehouses={warehouses}
              currency={t(settings.currency)}
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('المستودع:', 'Warehouse:')}</label>
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
                <option key={w.id} value={w.id}>{t(w.name)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('الرصيد الفعلي الجديد بعد الجرد:', 'New Actual Balance After Count:')}</label>
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
            <label className="block font-bold text-slate-700 mb-1">{t('سبب التسوية:', 'Adjustment Reason:')}</label>
            <input
              type="text"
              required
              placeholder={t('أدخل سبب التسوية (مثال: جرد دوري بالمستودع)', 'Enter adjustment reason (e.g. Periodic warehouse count)')}
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
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmittingAdjust}
              className="h-8 px-4 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
            >
              {isSubmittingAdjust ? t('جاري الاعتماد...', 'Approving...') : t('اعتماد التسوية الجردية', 'Approve Adjustment')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Damaged Goods Modal */}
      <Modal
        isOpen={isDamageModalOpen}
        onClose={() => setIsDamageModalOpen(false)}
        title={t('إثبات بضاعة تالفة / منتهية الصلاحية', 'Record Damaged / Expired Goods')}
        subtitle={t('خصم الكميات التالفة من المستودع مع توثيق الأسباب', 'Deduct damaged quantities from warehouse and document reasons')}
        maxWidth="md"
      >
        <form onSubmit={handleExecuteDamage} className="space-y-3 text-xs">
          {damageModalError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold">
              {damageModalError}
            </div>
          )}
          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('الصنف:', 'Product:')}</label>
            <ProductSearchSelect
              products={products}
              selectedProductId={damageProdId}
              onSelect={(prod) => setDamageProdId(prod.id)}
              warehouseId={damageWhId}
              warehouses={warehouses}
              currency={t(settings.currency)}
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('المستودع:', 'Warehouse:')}</label>
            <select
              value={damageWhId}
              onChange={(e) => setDamageWhId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
            >
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{t(w.name)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('الكمية التالفة:', 'Damaged Quantity:')}</label>
            <input
              type="number"
              min="1"
              required
              placeholder={t('أدخل الكمية التالفة', 'Enter damaged quantity')}
              value={damageQty}
              onChange={(e) => setDamageQty(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-red-50 border border-red-300 rounded-lg px-2.5 py-1.5 font-mono font-black text-center text-red-900 text-sm"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">{t('سبب التلف:', 'Damage Reason:')}</label>
            <input
              type="text"
              required
              placeholder={t('أدخل سبب التلف (مثال: تلف عبوة / انتهاء صلاحية)', 'Enter damage reason (e.g. Damaged packaging / Expired)')}
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
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmittingDamage}
              className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isSubmittingDamage ? t('جاري التسجيل...', 'Recording...') : t('إثبات وخصم التوالف', 'Record & Deduct Damaged')}
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
        title={previewProduct ? `${t('بطاقة الصنف:', 'Product Card:')} ${previewProduct.name}` : t('بطاقة الصنف', 'Product Card')}
        subtitle={previewProduct ? `${previewProduct.code}${previewProduct.barcode ? ` · ${t('باركود:', 'Barcode:')} ${previewProduct.barcode}` : ''}` : undefined}
        maxWidth="2xl"
      >
        {previewProduct && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-col sm:flex-row gap-3 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div className="w-16 h-16 rounded-lg bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] flex items-center justify-center text-slate-400 shrink-0">
                <Package className="w-7 h-7" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 flex-1">
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('التصنيف', 'Category')}</span>
                  <strong className="text-slate-900 dark:text-[#F3F7FC]">{previewProduct.category ? t(previewProduct.category) : t('عام', 'General')}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الوحدة الأساسية', 'Base Unit')}</span>
                  <strong className="text-slate-900 dark:text-[#F3F7FC]">{t(previewProduct.baseUnit)}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('سعر البيع الأساسي', 'Base Selling Price')}</span>
                  <strong className="font-mono tabular-nums text-[#003589] dark:text-[#85B8FF]">
                    {fmt(Number(previewProduct.sellingPrice || 0))} {t(settings.currency)}
                  </strong>
                </div>
                {previewProduct.purchasePrice !== undefined && (
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('سعر التكلفة / الشراء', 'Cost / Purchase Price')}</span>
                    <strong className="font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">
                      {fmt(Number(previewProduct.purchasePrice || 0))} {t(settings.currency)}
                    </strong>
                  </div>
                )}
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('حد الطلب', 'Min Stock Level')}</span>
                  <strong className="font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">{fmt(previewProduct.minStockLevel ?? 0)}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الحالة', 'Status')}</span>
                  <strong className="text-slate-900 dark:text-[#F3F7FC]">
                    {previewProduct.status === 'active' ? t('نشط', 'Active') : t('موقف', 'Suspended')}
                  </strong>
                </div>
              </div>
            </div>

            {Array.isArray(previewProduct.units) && previewProduct.units.length > 0 && (
              <div className="border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
                <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-[#172E56] font-bold text-slate-800 dark:text-[#F3F7FC]">
                  {t('الوحدات والأسعار', 'Units & Prices')} ({fmt(previewProduct.units.length)})
                </div>
                <table className="w-full text-start text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#21375C] text-[11px] text-slate-500 dark:text-[#97AECE]">
                      <th className="p-2">{t('الوحدة', 'Unit')}</th>
                      <th className="p-2 text-center">{t('المعامل', 'Factor')}</th>
                      <th className="p-2 text-center">{t('الباركود', 'Barcode')}</th>
                      <th className="p-2 text-center">{t('سعر البيع', 'Selling Price')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                    {previewProduct.units.map((u, idx) => (
                      <tr key={u.id || `${u.name}-${idx}`}>
                        <td className="p-2 font-bold">{t(u.name)}</td>
                        <td className="p-2 text-center font-mono tabular-nums">{fmt(u.conversionFactor)}</td>
                        <td className="p-2 text-center font-mono">{u.barcode || '—'}</td>
                        <td className="p-2 text-center font-mono tabular-nums font-bold">
                          {fmt(Number(u.sellingPrice || 0))} {t(settings.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
              <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-[#172E56] font-bold text-slate-800 dark:text-[#F3F7FC]">
                {t('الأرصدة التفصيلية بالمستودعات', 'Detailed Balances by Warehouse')}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5">
                {warehouses.map((w) => (
                  <div key={w.id} className="p-2 rounded border border-slate-200 dark:border-[#21375C] bg-white dark:bg-[#10203D]">
                    <div className="text-[10px] text-slate-500 dark:text-[#97AECE] truncate">{t(w.name)}</div>
                    <div className="font-mono font-black text-slate-900 dark:text-[#F3F7FC] tabular-nums">
                      {fmt(Number(previewProduct.stockPerWarehouse?.[w.id] || 0))} {t(previewProduct.baseUnit)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {previewProduct.notes && (
              <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
                <span className="font-bold text-slate-600 dark:text-[#97AECE]">{t('ملاحظات:', 'Notes:')} </span>
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
                  {t('تقرير حركة الصنف', 'Item Movement Report')}
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
                {t('تعديل الصنف', 'Edit Product')}
              </button>
              <button
                type="button"
                onClick={() => setPreviewProduct(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

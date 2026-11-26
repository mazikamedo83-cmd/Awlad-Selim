import React, { useState, useMemo } from 'react';
import {
  ClipboardCheck, Plus, Search, CheckCircle2, XCircle, Send, Eye, Edit,
  Download, FileDown, Printer, AlertTriangle, AlertCircle
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { StockCountSession } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { LinkedGroupCategoryFilter, filterProductsByGroupCategory } from '../../common/LinkedGroupCategoryFilter';

const STATUS_BADGE: Record<StockCountSession['status'], { labelAr: string; labelEn: string; cls: string }> = {
  draft: { labelAr: 'مسودة (لا يؤثر على الرصيد)', labelEn: 'Draft (No stock impact)', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  submitted: { labelAr: 'مرسل للاعتماد', labelEn: 'Submitted for Approval', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved: { labelAr: 'معتمد (تمت التسوية)', labelEn: 'Approved (Reconciled)', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  rejected: { labelAr: 'مرفوض', labelEn: 'Rejected', cls: 'bg-red-100 text-red-800 border-red-300' },
};

export const StockCountView: React.FC = () => {
  const {
    stockCounts = [],
    warehouses,
    products,
    productGroups = [],
    categories = [],
    settings,
    createStockCount,
    updateStockCount,
    submitStockCount,
    approveStockCount,
    rejectStockCount,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const { t, isLtr, locale } = usePreferences();
  const fmt = (n: number) => formatLocaleNumber(n);
  const getStatusLabel = (status: StockCountSession['status']) => {
    const meta = STATUS_BADGE[status];
    return meta ? (isLtr ? meta.labelEn : meta.labelAr) : status;
  };

  const canCreate = currentUser?.role === 'admin' || hasPermission('canCreateStockCount');
  const canApprove = currentUser?.role === 'admin' || hasPermission('canApproveStockCount');

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create / Edit Draft Count Modal
  const [isCountModalOpen, setIsCountModalOpen] = useState(false);
  const [editingCount, setEditingCount] = useState<StockCountSession | null>(null);
  const [selectedWhId, setSelectedWhId] = useState<string>(warehouses[0]?.id || '');
  const [countDate, setCountDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [countNotes, setCountNotes] = useState<string>('');
  const [itemSearch, setItemSearch] = useState<string>('');
  const [countGroupFilter, setCountGroupFilter] = useState<string>('all');
  const [countCatFilter, setCountCatFilter] = useState<string>('all');
  const [onlyVarianceFilter, setOnlyVarianceFilter] = useState<boolean>(false);
  const [draftLines, setDraftLines] = useState<Array<{
    productId: string;
    productName: string;
    productCode: string;
    productBarcode: string;
    unit: string;
    systemQty: number;
    actualQty: number;
    reason: string;
  }>>([]);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Inspect / Review Modal
  const [reviewCount, setReviewCount] = useState<StockCountSession | null>(null);
  const [divergenceList, setDivergenceList] = useState<any[] | null>(null);
  const [reconcileMode, setReconcileMode] = useState<'apply_delta' | 'set_actual'>('apply_delta');
  const [approveNotes, setApproveNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [isProcessingReview, setIsProcessingReview] = useState(false);

  // Print
  const [printData, setPrintData] = useState<PrintData | null>(null);

  const filteredCounts = useMemo(() => {
    return stockCounts.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (warehouseFilter !== 'all' && c.warehouseId !== warehouseFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        if (
          !c.countNumber.toLowerCase().includes(q) &&
          !c.warehouseName.toLowerCase().includes(q) &&
          !c.counterName.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [stockCounts, statusFilter, warehouseFilter, searchTerm]);

  const buildLinesForWarehouse = (whId: string) => {
    return products
      .filter((p) => p.status === 'active')
      .map((p) => {
        const sysQty = Number(p.stockPerWarehouse?.[whId] || 0);
        return {
          productId: p.id,
          productName: p.name,
          productCode: p.code,
          productBarcode: p.barcode,
          unit: p.baseUnit,
          systemQty: sysQty,
          actualQty: sysQty,
          reason: '',
        };
      });
  };

  const openNewCountModal = () => {
    const whId = warehouses[0]?.id || '';
    setEditingCount(null);
    setSelectedWhId(whId);
    setCountDate(new Date().toISOString().split('T')[0]);
    setCountNotes('');
    setItemSearch('');
    setCountGroupFilter('all');
    setCountCatFilter('all');
    setOnlyVarianceFilter(false);
    setDraftLines(whId ? buildLinesForWarehouse(whId) : []);
    setModalError(null);
    setIsCountModalOpen(true);
  };

  const openEditDraftModal = (session: StockCountSession) => {
    setEditingCount(session);
    setSelectedWhId(session.warehouseId);
    setCountDate(session.date);
    setCountNotes(session.notes || '');
    setItemSearch('');
    setCountGroupFilter('all');
    setCountCatFilter('all');
    setOnlyVarianceFilter(false);
    setDraftLines(
      session.items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        productCode: it.productCode || '',
        productBarcode: it.productBarcode || '',
        unit: it.unit,
        systemQty: it.systemQty,
        actualQty: it.actualQty,
        reason: it.reason || '',
      }))
    );
    setModalError(null);
    setIsCountModalOpen(true);
  };

  const handleWarehouseSwitch = (nextWhId: string) => {
    setSelectedWhId(nextWhId);
    setDraftLines(buildLinesForWarehouse(nextWhId));
  };

  const handleSaveDraft = async (andSubmit: boolean) => {
    setModalError(null);
    if (!selectedWhId || draftLines.length === 0) {
      setModalError(t('يجب اختيار المستودع وتوفر صنف واحد على الأقل.', 'Please select a warehouse and ensure at least one product exists.'));
      return;
    }
    setIsSaving(true);
    const payload = {
      warehouseId: selectedWhId,
      date: countDate,
      notes: countNotes.trim(),
      items: draftLines.map((l) => ({
        productId: l.productId,
        actualQty: Number(l.actualQty || 0),
        reason: l.reason.trim(),
      })),
    };

    const res = editingCount
      ? await updateStockCount(editingCount.id, payload)
      : await createStockCount(payload);

    if (!res.success || !res.count) {
      setIsSaving(false);
      setModalError(res.error ? t(res.error) : t('تعذر حفظ جلسة الجرد', 'Unable to save stock count session'));
      return;
    }

    if (andSubmit) {
      const subRes = await submitStockCount(res.count.id);
      setIsSaving(false);
      if (!subRes.success) {
        setModalError(subRes.error ? t(subRes.error) : t('تم حفظ المسودة ولكن تعذر إرسالها للاعتماد', 'Draft saved but failed to submit for approval'));
        return;
      }
      setIsCountModalOpen(false);
      setBanner({
        type: 'success',
        text: isLtr
          ? `Stock count (${res.count.countNumber}) saved and submitted for review and approval.`
          : `تم حفظ وإرسال الجرد (${res.count.countNumber}) للمراجعة والاعتماد.`,
      });
    } else {
      setIsSaving(false);
      setIsCountModalOpen(false);
      setBanner({
        type: 'success',
        text: isLtr
          ? `Stock count draft (${res.count.countNumber}) saved without modifying warehouse balances.`
          : `تم حفظ مسودة الجرد (${res.count.countNumber}) دون تعديل أرصدة المخزن.`,
      });
    }
  };

  const openReview = (session: StockCountSession) => {
    setReviewCount(session);
    setDivergenceList(null);
    setReconcileMode('apply_delta');
    setApproveNotes('');
    setRejectReason('');
    setShowRejectBox(false);
    setReviewError(null);
  };

  const handleSubmitDraftFromReview = async (id: string) => {
    setIsProcessingReview(true);
    const res = await submitStockCount(id);
    setIsProcessingReview(false);
    if (!res.success) {
      setReviewError(res.error ? t(res.error) : t('تعذر إرسال الجرد', 'Unable to submit stock count'));
      return;
    }
    setReviewCount(res.count || null);
    setBanner({
      type: 'success',
      text: isLtr ? `Stock count (${res.count?.countNumber}) submitted for approval.` : `تم إرسال الجرد (${res.count?.countNumber}) للاعتماد.`,
    });
  };

  const handleApproveReview = async (forceReconcile = false) => {
    if (!reviewCount) return;
    setReviewError(null);
    setIsProcessingReview(true);
    const res = await approveStockCount(reviewCount.id, {
      reconcileMode: forceReconcile ? reconcileMode : null,
      notes: approveNotes.trim(),
    });
    setIsProcessingReview(false);

    if (!res.success) {
      if (res.code === 'COUNT_STOCK_CHANGED_DURING_COUNT') {
        setDivergenceList(res.diverged || []);
        setReviewError(res.error ? t(res.error) : t('تغير رصيد بعض الأصناف أثناء الجرد. اختر طريقة التسوية للمتابعة.', 'Some item balances changed during the count. Select a reconciliation method to proceed.'));
      } else {
        setReviewError(res.error ? t(res.error) : t('تعذر اعتماد الجرد', 'Unable to approve stock count'));
      }
      return;
    }
    setReviewCount(null);
    setDivergenceList(null);
    setBanner({
      type: 'success',
      text: isLtr
        ? `Stock count (${res.count?.countNumber}) approved and inventory variances reconciled in central ledger.`
        : `تم اعتماد جرد (${res.count?.countNumber}) وتسوية فروقات المخزون في السجل المركزي.`,
    });
  };

  const handleRejectReview = async () => {
    if (!reviewCount) return;
    if (!rejectReason.trim()) {
      setReviewError(t('يرجى إدخال سبب رفض الجرد.', 'Please enter a rejection reason.'));
      return;
    }
    setReviewError(null);
    setIsProcessingReview(true);
    const res = await rejectStockCount(reviewCount.id, rejectReason.trim());
    setIsProcessingReview(false);
    if (!res.success) {
      setReviewError(res.error ? t(res.error) : t('تعذر رفض الجرد', 'Unable to reject stock count'));
      return;
    }
    setReviewCount(null);
    setBanner({
      type: 'success',
      text: isLtr
        ? `Stock count session (${res.count?.countNumber}) rejected without changing inventory balances.`
        : `تم رفض جلسة الجرد (${res.count?.countNumber}) دون تغيير أرصدة المخزون.`,
    });
  };

  const handleExportSessionExcel = (c: StockCountSession) => {
    const headers = [
      t('كود الصنف', 'Product Code'),
      t('اسم الصنف', 'Product Name'),
      t('الوحدة', 'Unit'),
      t('الرصيد الدفتري', 'Book Stock'),
      t('الجرد الفعلي', 'Actual Count'),
      t('الفرق', 'Variance'),
      t('التصنيف', 'Status'),
      t('السبب', 'Reason'),
    ];
    const rows = c.items.map((it) => [
      it.productCode || '',
      it.productName,
      t(it.unit),
      it.systemQty,
      it.actualQty,
      it.varianceQty,
      it.varianceType === 'matched' ? t('مطابق', 'Matched') : it.varianceType === 'shortage' ? t('عجز', 'Shortage') : t('زيادة', 'Surplus'),
      it.reason || '-',
    ]);
    exportToExcel(`${isLtr ? 'StockCount' : 'جرد_مخزن'}_${c.countNumber}`, headers, rows);
  };

  const handleExportSessionPdf = (c: StockCountSession) => {
    exportTableToPdf(
      `${t('محضر جرد مخزن', 'Warehouse Stock Count Sheet')} (${c.countNumber})`,
      [t('م', '#'), t('الصنف', 'Product'), t('الوحدة', 'Unit'), t('الدفتري', 'Book'), t('الفعلي', 'Actual'), t('الفرق', 'Variance'), t('الحالة', 'Status'), t('السبب', 'Reason')],
      c.items.map((it, idx) => [
        idx + 1,
        it.productName,
        t(it.unit),
        it.systemQty,
        it.actualQty,
        it.varianceQty,
        it.varianceType === 'matched' ? t('مطابق', 'Matched') : it.varianceType === 'shortage' ? t('عجز', 'Shortage') : t('زيادة', 'Surplus'),
        it.reason || '-',
      ]),
      {
        companyName: settings.companyName,
        docNumber: c.countNumber,
        dateRangeText: c.date,
        meta: [
          { label: t('المستودع', 'Warehouse'), value: t(c.warehouseName) },
          { label: t('القائم بالجرد', 'Counted By'), value: c.counterName },
          { label: t('الحالة', 'Status'), value: getStatusLabel(c.status) },
          ...(c.approvedByName ? [{ label: t('المعتمد بواسطة', 'Approved By'), value: c.approvedByName }] : []),
        ],
        notes: c.notes,
      }
    );
  };

  const handlePrintSession = (c: StockCountSession) => {
    const varianceItemsCount = c.items.filter((i) => i.varianceQty !== 0).length;
    setPrintData({
      title: `${t('محضر جرد وتسوية مخزن', 'Stock Count & Reconciliation Sheet')} (${c.countNumber})`,
      docNumber: c.countNumber,
      docType: t('كشف حساب', 'Stock Count Sheet'),
      date: c.date,
      partyName: `${t('القائم بالجرد:', 'Counted by:')} ${c.counterName}`,
      warehouseName: t(c.warehouseName),
      items: c.items.map((it) => ({
        name: `${it.productName} (${t('دفتري:', 'Book:')} ${fmt(it.systemQty)} / ${t('فعلي:', 'Actual:')} ${fmt(it.actualQty)})`,
        unit: t(it.unit),
        quantity: it.actualQty,
        price: 0,
        total: it.varianceQty,
      })),
      grandTotal: varianceItemsCount,
      notes: `${t('حالة الجرد:', 'Count Status:')} ${getStatusLabel(c.status)} | ${t('عدد البنود ذات الفارق:', 'Items with variance:')} ${fmt(varianceItemsCount)}`,
    });
  };

  const allowedCountProductIds = useMemo(() => {
    if (countGroupFilter === 'all' && countCatFilter === 'all') return null;
    const matched = filterProductsByGroupCategory(products, productGroups, categories, countGroupFilter, countCatFilter);
    return new Set(matched.map((p) => p.id));
  }, [products, productGroups, categories, countGroupFilter, countCatFilter]);

  const visibleDraftLines = useMemo(() => {
    return draftLines
      .map((line, originalIndex) => ({ ...line, originalIndex }))
      .filter((line) => {
        if (allowedCountProductIds && !allowedCountProductIds.has(line.productId)) return false;
        if (onlyVarianceFilter && line.actualQty === line.systemQty) return false;
        if (itemSearch.trim()) {
          const q = itemSearch.trim().toLowerCase();
          return (
            line.productName.toLowerCase().includes(q) ||
            line.productCode.toLowerCase().includes(q) ||
            line.productBarcode.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [draftLines, allowedCountProductIds, onlyVarianceFilter, itemSearch]);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-xs sm:text-sm font-black text-[#011E58] tracking-tight flex items-center gap-1.5">
            <ClipboardCheck className="w-4 h-4 text-[#003589]" />
            <span>{t('جرد المخزن ومطابقة الأرصدة الفعلية', 'Warehouse Stock Count & Physical Reconciliation')}</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            {t(
              'إنشاء مسودة جرد ومقارنة الكميات الفعلية بالدفتري (عجز / زيادة) مع دورة اعتماد آمنة دون تأثير على المخزن قبل الموافقة',
              'Create draft counts, compare physical vs book stock (shortage/surplus), with safe approval workflow before modifying inventory'
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {canCreate && (
            <button
              type="button"
              onClick={openNewCountModal}
              className="flex items-center gap-1 h-8 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('جلسة جرد مخزن جديدة', 'New Stock Count Session')}</span>
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
          <div className="flex items-center gap-1.5">
            {banner.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            <span>{banner.text}</span>
          </div>
          <button type="button" onClick={() => setBanner(null)} className="underline text-[11px] cursor-pointer">
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {/* Sessions Table */}
      <UnifiedDataTable<StockCountSession>
        title={t('جلسات جرد المخزن', 'Stock Count Sessions')}
        subtitle={`${t('إجمالي الجلسات:', 'Total sessions:')} ${fmt(filteredCounts.length)}`}
        data={filteredCounts}
        rowKey={(c) => c.id}
        compact
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={t('بحث برقم الجرد أو المستودع أو اسم الجارد...', 'Search by count #, warehouse, or counter name...')}
        exportFilename="AWLAD_SELIM_StockCounts"
        pdfTitle={t('سجل جلسات جرد المخزن', 'Stock Count Sessions Log')}
        defaultPageSize={25}
        emptyTitle={t('لا توجد جلسات جرد مخزن مسجلة حتى الآن', 'No stock count sessions recorded yet')}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold"
            >
              <option value="all">{t('كل المستودعات', 'All Warehouses')}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{t(w.name)}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold"
            >
              <option value="all">{t('كل حالات الجرد', 'All Count Statuses')}</option>
              <option value="draft">{t('مسودة', 'Draft')}</option>
              <option value="submitted">{t('مرسل للاعتماد', 'Submitted')}</option>
              <option value="approved">{t('معتمد', 'Approved')}</option>
              <option value="rejected">{t('مرفوض', 'Rejected')}</option>
            </select>
          </div>
        }
        columns={[
          {
            key: 'countNumber',
            header: t('رقم الجرد', 'Count No.'),
            sortable: true,
            sortValue: (c) => c.countNumber,
            exportValue: (c) => c.countNumber,
            render: (c) => <span className="font-mono font-bold text-[#011E58]">{c.countNumber}</span>,
          },
          {
            key: 'date',
            header: t('التاريخ', 'Date'),
            sortable: true,
            sortValue: (c) => c.date,
            exportValue: (c) => c.date,
            render: (c) => <span className="font-mono tabular-nums">{c.date}</span>,
          },
          {
            key: 'warehouseName',
            header: t('المستودع', 'Warehouse'),
            sortable: true,
            sortValue: (c) => c.warehouseName,
            exportValue: (c) => t(c.warehouseName),
            render: (c) => <span className="font-bold text-slate-900">{t(c.warehouseName)}</span>,
          },
          {
            key: 'itemsCount',
            header: t('الأصناف', 'Items'),
            align: 'center',
            sortable: true,
            sortValue: (c) => c.items.length,
            exportValue: (c) => c.items.length,
            render: (c) => <span className="font-mono font-bold tabular-nums">{fmt(c.items.length)}</span>,
          },
          {
            key: 'variances',
            header: t('عجز / زيادة', 'Shortage / Surplus'),
            align: 'center',
            exportValue: (c) => {
              const s = c.items.filter((i) => i.varianceType === 'shortage').length;
              const p = c.items.filter((i) => i.varianceType === 'surplus').length;
              return `${t('عجز:', 'Shortage:')}${s} ${t('زيادة:', 'Surplus:')}${p}`;
            },
            render: (c) => {
              const shortageCount = c.items.filter((i) => i.varianceType === 'shortage').length;
              const surplusCount = c.items.filter((i) => i.varianceType === 'surplus').length;
              return (
                <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold">
                  <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 tabular-nums">{t('عجز:', 'Shortage:')} {fmt(shortageCount)}</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 tabular-nums">{t('زيادة:', 'Surplus:')} {fmt(surplusCount)}</span>
                </div>
              );
            },
          },
          {
            key: 'counterName',
            header: t('القائم بالجرد', 'Counted By'),
            sortable: true,
            sortValue: (c) => c.counterName,
            exportValue: (c) => c.counterName,
            render: (c) => <span className="font-semibold">{c.counterName}</span>,
          },
          {
            key: 'status',
            header: t('الحالة', 'Status'),
            align: 'center',
            sortable: true,
            sortValue: (c) => c.status,
            exportValue: (c) => getStatusLabel(c.status),
            render: (c) => {
              const badge = STATUS_BADGE[c.status] || STATUS_BADGE.draft;
              return (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badge.cls}`}>
                  {getStatusLabel(c.status)}
                </span>
              );
            },
          },
          {
            key: 'actions',
            header: t('الإجراءات', 'Actions'),
            align: 'center',
            exportValue: () => '',
            render: (c) => (
              <div className="flex items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={() => openReview(c)}
                  className="p-1.5 rounded-lg text-[#011E58] hover:bg-[#EEF3FA] cursor-pointer"
                  title={t('عرض ومراجعة / اعتماد', 'View, Review & Approve')}
                >
                  <Eye className="w-4 h-4" />
                </button>
                {c.status === 'draft' && canCreate && (
                  <button
                    type="button"
                    onClick={() => openEditDraftModal(c)}
                    className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-50 cursor-pointer"
                    title={t('تعديل مسودة الجرد', 'Edit Count Draft')}
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleExportSessionExcel(c)}
                  className="p-1.5 rounded-lg text-[#003589] hover:bg-[#EEF3FA] cursor-pointer"
                  title={t('تصدير Excel', 'Export Excel')}
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleExportSessionPdf(c)}
                  className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
                  title={t('تصدير PDF', 'Export PDF')}
                >
                  <FileDown className="w-4 h-4" />
                </button>
              </div>
            ),
          },
        ]}
      />

      {/* Create / Edit Draft Count Modal */}
      <Modal
        isOpen={isCountModalOpen}
        onClose={() => setIsCountModalOpen(false)}
        title={editingCount ? `${t('تعديل مسودة جرد', 'Edit Count Draft')} (${editingCount.countNumber})` : t('جلسة جرد مخزن جديدة', 'New Stock Count Session')}
        subtitle={t('الكمية المحفوظة في المسودة لا تعدل رصيد المخزون إلا بعد الاعتماد النهائي', 'Saved draft quantities do not modify stock until final approval')}
        maxWidth="4xl"
      >
        <div className="space-y-2 text-xs">
          {modalError && (
            <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{modalError}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200">
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('المستودع:', 'Warehouse:')}</label>
              <select
                value={selectedWhId}
                disabled={!!editingCount}
                onChange={(e) => handleWarehouseSwitch(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-bold disabled:bg-slate-100"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{t(w.name)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('تاريخ الجرد:', 'Count Date:')}</label>
              <input
                type="date"
                value={countDate}
                onChange={(e) => setCountDate(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('ملاحظات عامة:', 'General Notes:')}</label>
              <input
                type="text"
                value={countNotes}
                onChange={(e) => setCountNotes(e.target.value)}
                className="w-full h-8 bg-white border border-slate-300 rounded-md px-2"
              />
            </div>
          </div>

          <div className="awlad-filter-row justify-between gap-2" data-testid="stockcount-modal-filter-row">
            <div className="relative flex-1 min-w-[180px] shrink-0">
              <input
                type="text"
                placeholder={t('تصفية الأصناف بالاسم أو الكود أو الباركود...', 'Filter items by name, code, or barcode...')}
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md ps-7 pe-2 text-xs"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2 top-2" />
            </div>
            <LinkedGroupCategoryFilter
              productGroups={productGroups}
              categories={categories}
              selectedGroupId={countGroupFilter}
              selectedCategoryId={countCatFilter}
              onGroupChange={setCountGroupFilter}
              onCategoryChange={setCountCatFilter}
              compact
            />
            <label className="flex items-center gap-1.5 h-8 px-2.5 bg-slate-50 border border-slate-200 rounded-md cursor-pointer font-bold text-xs whitespace-nowrap shrink-0">
              <input
                type="checkbox"
                checked={onlyVarianceFilter}
                onChange={(e) => setOnlyVarianceFilter(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-blue-900"
              />
              <span>{t('إظهار الأصناف ذات الفروقات فقط', 'Show variance items only')}</span>
            </label>
          </div>

          <div className="border border-slate-200 rounded-lg awlad-table-scroll max-h-80 overflow-y-auto">
            <table className="w-full text-start text-[11px]">
              <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b">
                <tr>
                  <th className="p-2">{t('الكود', 'Code')}</th>
                  <th className="p-2">{t('الصنف', 'Product')}</th>
                  <th className="p-2 text-center">{t('الدفتري', 'Book')}</th>
                  <th className="p-2 text-center w-28">{t('الكمية الفعلية', 'Actual Qty')}</th>
                  <th className="p-2 text-center">{t('الفرق', 'Variance')}</th>
                  <th className="p-2">{t('سبب الفارق (اختياري)', 'Variance Reason (Optional)')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleDraftLines.map((line) => {
                  const diff = Number(line.actualQty || 0) - Number(line.systemQty || 0);
                  return (
                    <tr key={line.productId} className={diff !== 0 ? 'bg-amber-50/40' : ''}>
                      <td className="p-1.5 font-mono font-bold text-blue-900">{line.productCode}</td>
                      <td className="p-1.5 font-bold text-slate-900">
                        {line.productName} <span className="text-[10px] text-slate-400">({t(line.unit)})</span>
                      </td>
                      <td className="p-1.5 text-center font-mono font-bold text-slate-700">{fmt(line.systemQty)}</td>
                      <td className="p-1.5 text-center">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.actualQty}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value));
                            setDraftLines((prev) =>
                              prev.map((row, i) => (i === line.originalIndex ? { ...row, actualQty: val } : row))
                            );
                          }}
                          className="w-24 border border-blue-300 rounded-md p-1 text-center font-mono font-black bg-white"
                        />
                      </td>
                      <td className="p-1.5 text-center font-mono font-black">
                        {diff === 0 ? (
                          <span className="text-slate-400">{t('مطابق (0)', 'Matched (0)')}</span>
                        ) : diff < 0 ? (
                          <span className="text-red-700">{t('عجز', 'Shortage')} ({fmt(diff)})</span>
                        ) : (
                          <span className="text-emerald-700">{t('زيادة', 'Surplus')} (+{fmt(diff)})</span>
                        )}
                      </td>
                      <td className="p-1.5">
                        <input
                          type="text"
                          aria-label={t('ملاحظة الفارق', 'Variance note')}
                          value={line.reason}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraftLines((prev) =>
                              prev.map((row, i) => (i === line.originalIndex ? { ...row, reason: val } : row))
                            );
                          }}
                          className="w-full border border-slate-300 rounded-md p-1"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-end gap-1.5 pt-2 border-t">
            <button
              type="button"
              onClick={() => setIsCountModalOpen(false)}
              className="h-8 px-2.5 border border-slate-300 rounded-md font-bold cursor-pointer"
            >
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => handleSaveDraft(false)}
              className="h-8 px-3 bg-slate-700 hover:bg-slate-800 text-white rounded-md font-bold cursor-pointer"
            >
              {t('حفظ كمسودة', 'Save as Draft')}
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => handleSaveDraft(true)}
              className="flex items-center gap-1 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{t('حفظ وإرسال للاعتماد', 'Save & Submit for Approval')}</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Review / Approve / Reject Modal */}
      {reviewCount && (
        <Modal
          isOpen={!!reviewCount}
          onClose={() => setReviewCount(null)}
          title={`${t('تفاصيل جرد المخزن', 'Stock Count Details')} (${reviewCount.countNumber})`}
          subtitle={`${t(reviewCount.warehouseName)} · ${reviewCount.date}`}
          maxWidth="4xl"
        >
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <span>{t('الحالة:', 'Status:')} <strong>{getStatusLabel(reviewCount.status)}</strong></span>
                <span>• {t('القائم بالجرد:', 'Counted by:')} <strong>{reviewCount.counterName}</strong></span>
                {reviewCount.approvedByName && (
                  <span>• {t('المراجع:', 'Reviewed by:')} <strong>{reviewCount.approvedByName}</strong></span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handlePrintSession(reviewCount)}
                  className="h-7 px-2 bg-white border border-slate-300 rounded-md text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3 h-3" /> {t('طباعة', 'Print')}
                </button>
                <button
                  type="button"
                  onClick={() => handleExportSessionPdf(reviewCount)}
                  className="h-7 px-2 bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] rounded-md text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <FileDown className="w-3 h-3" /> PDF
                </button>
              </div>
            </div>

            {reviewError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{reviewError}</span>
              </div>
            )}

            {/* Divergence reconciliation picker when stock changed mid-count */}
            {divergenceList && divergenceList.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 space-y-2">
                <h4 className="font-black text-amber-950">{t('تنبيه: حدثت حركات مخزنية بعد إنشاء المسودة للأصناف التالية:', 'Warning: Stock movements occurred after draft creation for the following items:')}</h4>
                <ul className="list-disc ms-4 space-y-0.5 text-amber-900">
                  {divergenceList.map((d, idx) => (
                    <li key={idx}>
                      {d.productName}: {t('الدفتري وقت الجرد', 'Book at count')} ({fmt(d.snapshotQty)}) {isLtr ? '→' : '←'} {t('الحالي', 'Current')} ({fmt(d.liveQty)}) | {t('الجرد الفعلي', 'Actual')} ({fmt(d.actualQty)})
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <label className={`p-2 rounded-lg border cursor-pointer ${reconcileMode === 'apply_delta' ? 'bg-white border-[#003589]' : 'bg-amber-100/40 border-amber-300'}`}>
                    <input
                      type="radio"
                      name="reconcileMode"
                      checked={reconcileMode === 'apply_delta'}
                      onChange={() => setReconcileMode('apply_delta')}
                      className="me-2"
                    />
                    <strong>{t('تطبيق فارق الجرد على الرصيد الحالي', 'Apply count variance to current balance')}</strong>
                    <span className="block text-[10px] text-slate-600 ms-5">{t('يحافظ على حركات البيع والشراء التي تمت أثناء الجرد', 'Preserves sales/purchase movements made during the count')}</span>
                  </label>
                  <label className={`p-2 rounded-lg border cursor-pointer ${reconcileMode === 'set_actual' ? 'bg-white border-[#003589]' : 'bg-amber-100/40 border-amber-300'}`}>
                    <input
                      type="radio"
                      name="reconcileMode"
                      checked={reconcileMode === 'set_actual'}
                      onChange={() => setReconcileMode('set_actual')}
                      className="me-2"
                    />
                    <strong>{t('تثبيت الكمية الفعلية للجرد كما هي', 'Force actual counted quantity as-is')}</strong>
                    <span className="block text-[10px] text-slate-600 ms-5">{t('يضبط المخزون ليكون مطابقاً لرقم الجرد الفعلي', 'Sets inventory directly to match the actual counted quantity')}</span>
                  </label>
                </div>
                <button
                  type="button"
                  disabled={isProcessingReview}
                  onClick={() => handleApproveReview(true)}
                  className="h-8 px-3.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer"
                >
                  {t('تأكيد الاعتماد بهذه الطريقة', 'Confirm Approval with This Method')}
                </button>
              </div>
            )}

            <UnifiedDataTable
              compact
              searchable={false}
              maxHeightClassName="max-h-72"
              data={reviewCount.items}
              rowKey={(it) => it.id}
              rowClassName={(it) => (it.varianceQty !== 0 ? 'bg-amber-50/30' : '')}
              defaultPageSize={100}
              columns={[
                {
                  key: 'productName',
                  header: t('الصنف', 'Product'),
                  sortable: true,
                  sortValue: (it) => it.productName,
                  exportValue: (it) => it.productName,
                  render: (it) => <span className="font-bold">{it.productName}</span>,
                },
                {
                  key: 'systemQty',
                  header: t('الدفتري', 'Book'),
                  align: 'center',
                  sortable: true,
                  sortValue: (it) => it.systemQty,
                  exportValue: (it) => it.systemQty,
                  render: (it) => <span className="font-mono tabular-nums">{fmt(it.systemQty)}</span>,
                },
                {
                  key: 'actualQty',
                  header: t('الفعلي', 'Actual'),
                  align: 'center',
                  sortable: true,
                  sortValue: (it) => it.actualQty,
                  exportValue: (it) => it.actualQty,
                  render: (it) => <span className="font-mono font-black tabular-nums">{fmt(it.actualQty)}</span>,
                },
                {
                  key: 'varianceQty',
                  header: t('الفارق', 'Variance'),
                  align: 'center',
                  sortable: true,
                  sortValue: (it) => it.varianceQty,
                  exportValue: (it) => it.varianceQty,
                  render: (it) => (
                    <span className="font-mono font-bold tabular-nums">
                      {it.varianceQty > 0 ? `+${fmt(it.varianceQty)}` : fmt(it.varianceQty)}
                    </span>
                  ),
                },
                {
                  key: 'varianceType',
                  header: t('الحالة', 'Status'),
                  align: 'center',
                  sortable: true,
                  sortValue: (it) => it.varianceType,
                  exportValue: (it) => (it.varianceType === 'matched' ? t('مطابق', 'Matched') : it.varianceType === 'shortage' ? t('عجز', 'Shortage') : t('زيادة', 'Surplus')),
                  render: (it) =>
                    it.varianceType === 'matched' ? (
                      <span className="text-slate-500">{t('مطابق', 'Matched')}</span>
                    ) : it.varianceType === 'shortage' ? (
                      <span className="text-red-700 font-bold">{t('عجز', 'Shortage')}</span>
                    ) : (
                      <span className="text-emerald-700 font-bold">{t('زيادة', 'Surplus')}</span>
                    ),
                },
                {
                  key: 'reason',
                  header: t('السبب', 'Reason'),
                  exportValue: (it) => it.reason || '-',
                  render: (it) => <span className="text-slate-600">{it.reason || '-'}</span>,
                },
              ]}
            />

            {reviewCount.rejectionReason && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-900">
                <strong>{t('سبب الرفض:', 'Rejection Reason:')}</strong> {reviewCount.rejectionReason}
              </div>
            )}

            {showRejectBox && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 space-y-1.5">
                <label className="block font-bold text-red-900">{t('سبب رفض جلسة الجرد:', 'Stock count rejection reason:')}</label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full h-8 border border-red-300 bg-white rounded-md px-2"
                />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setShowRejectBox(false)} className="h-7 px-2.5 border border-slate-300 rounded-md cursor-pointer">
                    {t('تراجع', 'Back')}
                  </button>
                  <button type="button" onClick={handleRejectReview} disabled={isProcessingReview} className="h-7 px-2.5 bg-red-700 text-white rounded-md font-bold cursor-pointer">
                    {t('تأكيد الرفض', 'Confirm Rejection')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-between items-center gap-1.5 pt-2 border-t">
              <div>
                {reviewCount.status === 'submitted' && canApprove && (
                  <div className="flex items-center gap-1.5">
                    <label className="font-bold text-slate-700 whitespace-nowrap">{t('ملاحظة الاعتماد (اختياري):', 'Approval Note (Optional):')}</label>
                    <input
                      type="text"
                      value={approveNotes}
                      onChange={(e) => setApproveNotes(e.target.value)}
                      className="h-8 border border-slate-300 rounded-md px-2 text-xs w-56"
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {reviewCount.status === 'draft' && canCreate && (
                  <button
                    type="button"
                    disabled={isProcessingReview}
                    onClick={() => handleSubmitDraftFromReview(reviewCount.id)}
                    className="h-8 px-2.5 bg-[#011E58] text-white rounded-md font-bold cursor-pointer"
                  >
                    {t('إرسال للاعتماد', 'Submit for Approval')}
                  </button>
                )}
                {(reviewCount.status === 'submitted' || reviewCount.status === 'draft') && canApprove && !divergenceList && (
                  <>
                    <button
                      type="button"
                      disabled={isProcessingReview}
                      onClick={() => setShowRejectBox(true)}
                      className="flex items-center gap-1 h-8 px-2.5 bg-red-50 text-red-700 border border-red-200 rounded-md font-bold cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{t('رفض', 'Reject')}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isProcessingReview}
                      onClick={() => handleApproveReview(false)}
                      className="flex items-center gap-1 h-8 px-3 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t('اعتماد وتعديل أرصدة المخزن', 'Approve & Reconcile Stock')}</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setReviewCount(null)}
                  className="h-8 px-2.5 border border-slate-300 rounded-md font-bold cursor-pointer"
                >
                  {t('إغلاق', 'Close')}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      <PrintDocumentModal isOpen={!!printData} onClose={() => setPrintData(null)} data={printData} />
    </div>
  );
};

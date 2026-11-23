import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import {
  Search,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Printer,
  FileSpreadsheet,
  FileText,
  SlidersHorizontal,
  History,
  Table2,
  Receipt,
  Calendar,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { fetchComprehensiveReport, fetchReportSourceDocument } from '../../../services/api';
import { SearchableFilterSelect, type SearchableFilterOption } from '../../common/SearchableFilterSelect';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';
import { PrintDocumentModal, type PrintData } from '../../common/PrintDocument';
import { SourceDocumentModal } from './SourceDocumentModal';
import { ItemLifecycleAndPnlPanel } from './ItemLifecycleAndPnlPanel';
import type {
  ComprehensiveReportOption,
  ComprehensiveReportResponse,
  ComprehensiveReportRow,
  ComprehensiveReportTypeKey,
  ReportMovementTypeKey,
  ReportSourceDocumentResponse,
} from '../../../types';

export interface ReportsViewProps {
  initialTab?: string;
  initialProductId?: string;
}

export const REPORT_TYPE_OPTIONS: ComprehensiveReportOption[] = [
  { key: 'all', label: 'الكل', group: 1 },
  { key: 'sales_items', label: 'أصناف البيع', group: 1 },
  { key: 'sales_invoices', label: 'فواتير بيع', group: 1 },
  { key: 'sales_items_by_unit', label: 'أصناف بيع/ بالوحدة', group: 1 },
  { key: 'sales_items_grouped', label: 'أصناف بيع/مَجمع', group: 1 },
  { key: 'sales_items_grouped_by_customer', label: 'أصناف بيع/مَجمع حسب العميل', group: 1 },
  { key: 'sales_items_grouped_by_category', label: 'أصناف بيع/مَجمع حسب المجموعة', group: 1 },
  { key: 'sales_items_grouped_by_category_class1', label: 'أصناف بيع/مَجمع حسب المجموعة وتصنيف 1', group: 1 },

  { key: 'sales_return_items', label: 'أصناف مرتجع بيع', group: 2 },
  { key: 'sales_return_invoices', label: 'فواتير مرتجع بيع', group: 2 },

  { key: 'purchase_items', label: 'أصناف شراء', group: 3 },
  { key: 'purchase_invoices', label: 'فواتير شراء', group: 3 },

  { key: 'purchase_return_items', label: 'أصناف مرتجع شراء', group: 4 },
  { key: 'purchase_return_invoices', label: 'فواتير مرتجع شراء', group: 4 },

  { key: 'damaged_items', label: 'أصناف تالف', group: 5 },
  { key: 'damaged_invoices', label: 'فواتير تالف', group: 5 },

  { key: 'cash_payment', label: 'سداد نقدى', group: 6 },
  { key: 'cash_payment_customer', label: 'سداد نقدى/عميل', group: 6 },
  { key: 'cash_payment_supplier', label: 'سداد نقدى/مورد', group: 6 },
  { key: 'cash_payment_employee', label: 'سداد نقدى/موظف', group: 6 },

  { key: 'cash_withdrawal', label: 'سحب نقدى', group: 7 },
  { key: 'cash_withdrawal_customer', label: 'سحب نقدى/عميل', group: 7 },
  { key: 'cash_withdrawal_supplier', label: 'سحب نقدى/مورد', group: 7 },
];

type SortColumnKey =
  | 'operationLabel'
  | 'quantity'
  | 'unit'
  | 'priceOrTotal'
  | 'valueOrPaid'
  | 'movementOrRemaining'
  | 'employeeName'
  | 'userName'
  | 'businessDate'
  | 'rawCreatedAt'
  | 'profit'
  | 'barcode'
  | 'displayId'
  | 'invoiceNumber'
  | 'branchName'
  | 'cashboxName'
  | 'notes'
  | 'discount'
  | 'profitPercent';

const TABLE_COLUMNS: Array<{ key: SortColumnKey; label: string; align?: 'right' | 'center' }> = [
  { key: 'operationLabel', label: 'العملية', align: 'right' },
  { key: 'quantity', label: 'الكمية', align: 'center' },
  { key: 'unit', label: 'الوحدة', align: 'center' },
  { key: 'rawCreatedAt', label: 'التاريخ الفعلى', align: 'center' },
  { key: 'priceOrTotal', label: 'السعر', align: 'center' },
  { key: 'valueOrPaid', label: 'القيمة', align: 'center' },
  { key: 'movementOrRemaining', label: 'الحركة', align: 'right' },
  { key: 'employeeName', label: 'الموظف', align: 'center' },
  { key: 'userName', label: 'المستخدم', align: 'center' },
  { key: 'businessDate', label: 'اليومية', align: 'center' },
  { key: 'profit', label: 'الربح', align: 'center' },
  { key: 'barcode', label: 'الباركود', align: 'center' },
  { key: 'displayId', label: 'كود السجل', align: 'center' },
  { key: 'invoiceNumber', label: 'رقم الفاتورة', align: 'center' },
  { key: 'branchName', label: 'الفرع', align: 'center' },
  { key: 'cashboxName', label: 'الخزنة', align: 'center' },
  { key: 'notes', label: 'ملاحظات', align: 'right' },
  { key: 'discount', label: 'الخصم', align: 'center' },
  { key: 'profitPercent', label: 'نسبة الربح', align: 'center' },
];

const fmtMoney = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '0';
  const n = Number(v);
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtNum = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '0';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, delta: number): string {
  const base = ymd ? new Date(`${ymd}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return todayYmd();
  base.setDate(base.getDate() + delta);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const day = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ initialTab, initialProductId }) => {
  const { settings } = useData();
  const { currentUser, hasPermission } = useAuth();
  const isRepRole = currentUser?.role === 'representative';
  const visibleColumns = useMemo(
    () =>
      isRepRole
        ? TABLE_COLUMNS.filter((c) => c.key !== 'profit' && c.key !== 'profitPercent' && c.key !== 'cashboxName')
        : TABLE_COLUMNS,
    [isRepRole]
  );
  const visibleColSpan = visibleColumns.length;
  const currency = settings.currency || 'ج.م';

  const [viewMode, setViewMode] = useState<'unified_grid' | 'item_lifecycle'>(
    initialTab === 'item_movement' ? 'item_lifecycle' : 'unified_grid'
  );
  const [reportType, setReportType] = useState<ComprehensiveReportTypeKey>('all');
  const [periodPreset, setPeriodPreset] = useState<'today' | 'this_month' | 'prev_month' | 'this_year' | 'prev_year' | 'all_time' | 'custom'>(
    initialTab === 'item_movement' ? 'all_time' : 'today'
  );
  const [dateFrom, setDateFrom] = useState<string>(() => (initialTab === 'item_movement' ? '' : todayYmd()));
  const [useDateTo, setUseDateTo] = useState<boolean>(() => initialTab !== 'item_movement');
  const [dateTo, setDateTo] = useState<string>(() => todayYmd());

  const [branchId, setBranchId] = useState('all');
  const [warehouseId, setWarehouseId] = useState('all');
  const [cashboxId, setCashboxId] = useState('all');
  const [productId, setProductId] = useState(initialProductId || 'all');
  const [productSearch, setProductSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const [partyKey, setPartyKey] = useState('all');
  const [movementType, setMovementType] = useState<ReportMovementTypeKey>('all');
  const [employeeId, setEmployeeId] = useState('all');
  const [userId, setUserId] = useState('all');
  const [representativeId, setRepresentativeId] = useState('all');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [recordId, setRecordId] = useState('');
  const [search, setSearch] = useState('');
  const [showMoreFilters, setShowMoreFilters] = useState(true);
  const [inlineTableSearch, setInlineTableSearch] = useState('');

  const [debouncedTextFilters, setDebouncedTextFilters] = useState({
    search: '',
    productSearch: '',
    barcode: '',
    invoiceNumber: '',
    recordId: '',
  });
  const textDebounceTimerRef = useRef<number | null>(null);
  const requestSeqRef = useRef(0);

  const [sortCol, setSortCol] = useState<SortColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [reportData, setReportData] = useState<ComprehensiveReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isReportDropdownOpen, setIsReportDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const reportDropdownBtnRef = useRef<HTMLButtonElement | null>(null);
  const reportDropdownPanelRef = useRef<HTMLDivElement | null>(null);
  const [reportDropdownPos, setReportDropdownPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  }>({ bottom: 60, left: 16, width: 288, maxHeight: 380 });

  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceDoc, setSourceDoc] = useState<ReportSourceDocumentResponse | null>(null);
  const [printModalData, setPrintModalData] = useState<PrintData | null>(null);
  const [exportScope, setExportScope] = useState<'filtered' | 'all'>('filtered');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(0);

  useEffect(() => {
    if (initialProductId) {
      setProductId(initialProductId);
    }
    if (initialTab === 'item_movement') {
      setViewMode('item_lifecycle');
    }
  }, [initialTab, initialProductId]);

  const updateReportDropdownPosition = useCallback(() => {
    const btn = reportDropdownBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const width = Math.min(Math.max(rect.width, 288), vw - margin * 2);
    let left = rect.right - width;
    if (left + width > vw - margin) left = vw - width - margin;
    if (left < margin) left = margin;

    const spaceAbove = rect.top - margin;
    const spaceBelow = vh - rect.bottom - margin;
    const openUpward = spaceAbove >= 220 || spaceAbove >= spaceBelow;
    const available = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(180, Math.min(420, available - 8));

    if (openUpward) {
      setReportDropdownPos({
        bottom: vh - rect.top + 6,
        left,
        width,
        maxHeight,
      });
    } else {
      setReportDropdownPos({
        top: rect.bottom + 6,
        left,
        width,
        maxHeight,
      });
    }
  }, []);

  useEffect(() => {
    if (!isReportDropdownOpen) return;
    updateReportDropdownPosition();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current?.contains(target) ||
        reportDropdownPanelRef.current?.contains(target)
      ) {
        return;
      }
      setIsReportDropdownOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsReportDropdownOpen(false);
        reportDropdownBtnRef.current?.focus();
      }
    };
    const onReposition = () => updateReportDropdownPosition();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [isReportDropdownOpen, updateReportDropdownPosition]);

  useEffect(() => {
    if (textDebounceTimerRef.current !== null) {
      window.clearTimeout(textDebounceTimerRef.current);
    }
    textDebounceTimerRef.current = window.setTimeout(() => {
      textDebounceTimerRef.current = null;
      setDebouncedTextFilters((prev) => {
        if (
          prev.search === search &&
          prev.productSearch === productSearch &&
          prev.barcode === barcode &&
          prev.invoiceNumber === invoiceNumber &&
          prev.recordId === recordId
        ) {
          return prev;
        }
        setPage(1);
        return { search, productSearch, barcode, invoiceNumber, recordId };
      });
    }, 320);
    return () => {
      if (textDebounceTimerRef.current !== null) {
        window.clearTimeout(textDebounceTimerRef.current);
        textDebounceTimerRef.current = null;
      }
    };
  }, [search, productSearch, barcode, invoiceNumber, recordId]);

  const loadReport = useCallback(
    async (
      overrideType?: ComprehensiveReportTypeKey,
      overrideText?: { search: string; productSearch: string; barcode: string; invoiceNumber: string; recordId: string },
      overridePage?: number
    ) => {
      const seq = ++requestSeqRef.current;
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const activeType = overrideType ?? reportType;
        const activeText = overrideText ?? debouncedTextFilters;
        const activePage = overridePage ?? page;
        const selectedCustomerId = partyKey.startsWith('customer:') ? partyKey.slice('customer:'.length) : undefined;
        const selectedSupplierId = partyKey.startsWith('supplier:') ? partyKey.slice('supplier:'.length) : undefined;
        const data = await fetchComprehensiveReport({
          reportType: activeType,
          dateFrom: dateFrom || undefined,
          dateTo: useDateTo && dateTo ? dateTo : undefined,
          branchId,
          warehouseId,
          cashboxId,
          productId,
          productSearch: activeText.productSearch.trim() || undefined,
          barcode: activeText.barcode.trim() || undefined,
          partyKey: partyKey !== 'all' ? partyKey : undefined,
          customerId: selectedCustomerId,
          supplierId: selectedSupplierId,
          movementType: movementType !== 'all' ? movementType : undefined,
          employeeId,
          userId,
          representativeId,
          invoiceNumber: activeText.invoiceNumber.trim() || undefined,
          recordId: activeText.recordId.trim() || undefined,
          search: activeText.search.trim() || undefined,
          ...(pageSize > 0 ? { page: activePage, pageSize } : {}),
        });
        if (seq !== requestSeqRef.current) return;
        setReportData(data);
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        setErrorMsg(err?.message || 'تعذر تحميل بيانات التقرير');
      } finally {
        if (seq === requestSeqRef.current) {
          setIsLoading(false);
        }
      }
    },
    [
      reportType,
      dateFrom,
      useDateTo,
      dateTo,
      branchId,
      warehouseId,
      cashboxId,
      productId,
      partyKey,
      movementType,
      employeeId,
      userId,
      representativeId,
      debouncedTextFilters,
      page,
      pageSize,
    ]
  );

  // Auto-load on mount and whenever reportType or core filters change
  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleApplySearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (textDebounceTimerRef.current !== null) {
      window.clearTimeout(textDebounceTimerRef.current);
      textDebounceTimerRef.current = null;
    }
    const nextText = { search, productSearch, barcode, invoiceNumber, recordId };
    const textChanged =
      debouncedTextFilters.search !== nextText.search ||
      debouncedTextFilters.productSearch !== nextText.productSearch ||
      debouncedTextFilters.barcode !== nextText.barcode ||
      debouncedTextFilters.invoiceNumber !== nextText.invoiceNumber ||
      debouncedTextFilters.recordId !== nextText.recordId;
    if (textChanged || page !== 1) {
      setPage(1);
      setDebouncedTextFilters(nextText);
    } else {
      loadReport(undefined, nextText, 1);
    }
  };

  const applyPeriodPreset = (preset: typeof periodPreset) => {
    setPage(1);
    setPeriodPreset(preset);
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const fmtD = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

    if (preset === 'today') {
      const t = todayYmd();
      setDateFrom(t);
      setUseDateTo(true);
      setDateTo(t);
    } else if (preset === 'this_month') {
      setDateFrom(fmtD(new Date(y, m, 1)));
      setUseDateTo(true);
      setDateTo(fmtD(new Date(y, m + 1, 0)));
    } else if (preset === 'prev_month') {
      setDateFrom(fmtD(new Date(y, m - 1, 1)));
      setUseDateTo(true);
      setDateTo(fmtD(new Date(y, m, 0)));
    } else if (preset === 'this_year') {
      setDateFrom(`${y}-01-01`);
      setUseDateTo(true);
      setDateTo(`${y}-12-31`);
    } else if (preset === 'prev_year') {
      setDateFrom(`${y - 1}-01-01`);
      setUseDateTo(true);
      setDateTo(`${y - 1}-12-31`);
    } else if (preset === 'all_time') {
      setDateFrom('');
      setUseDateTo(false);
    }
  };

  const handleResetFilters = () => {
    if (textDebounceTimerRef.current !== null) {
      window.clearTimeout(textDebounceTimerRef.current);
      textDebounceTimerRef.current = null;
    }
    setPage(1);
    setReportType('all');
    const t = todayYmd();
    setPeriodPreset('today');
    setDateFrom(t);
    setUseDateTo(true);
    setDateTo(t);
    setBranchId('all');
    setWarehouseId('all');
    setCashboxId('all');
    setProductId('all');
    setProductSearch('');
    setBarcode('');
    setPartyKey('all');
    setMovementType('all');
    setEmployeeId('all');
    setUserId('all');
    setRepresentativeId('all');
    setInvoiceNumber('');
    setRecordId('');
    setSearch('');
    setDebouncedTextFilters({
      search: '',
      productSearch: '',
      barcode: '',
      invoiceNumber: '',
      recordId: '',
    });
    setInlineTableSearch('');
  };

  const handleInspectDocument = async (docType: string, docId: string) => {
    if (!docId || docType === 'product_aggregate') return;
    setSourceModalOpen(true);
    setSourceLoading(true);
    setSourceError(null);
    setSourceDoc(null);
    try {
      const res = await fetchReportSourceDocument(docType, docId);
      setSourceDoc(res);
    } catch (err: any) {
      setSourceError(err?.message || 'تعذر فتح تفاصيل المستند الأصلي');
    } finally {
      setSourceLoading(false);
    }
  };

  const handleSort = (col: SortColumnKey) => {
    if (sortCol === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  // Contextual visibility flags for top filters based on selected reportType
  const filterVisibility = useMemo(() => {
    const isSalesOnly = reportType.startsWith('sales');
    const isPurchaseOnly = reportType.startsWith('purchase');
    const isDamaged = reportType.startsWith('damaged');
    const isCashOnly = reportType.startsWith('cash_');
    const isCashCustomer = reportType === 'cash_payment_customer' || reportType === 'cash_withdrawal_customer';
    const isCashSupplier = reportType === 'cash_payment_supplier' || reportType === 'cash_withdrawal_supplier';
    const isCashEmployee = reportType === 'cash_payment_employee';

    const showCustomer = reportType === 'all' || isSalesOnly || isCashCustomer || reportType === 'cash_payment' || reportType === 'cash_withdrawal';
    const showSupplier = !isRepRole
      ? (reportType === 'all' || isPurchaseOnly || isCashSupplier || reportType === 'cash_payment' || reportType === 'cash_withdrawal')
      : ((hasPermission('canCreatePurchase') || hasPermission('canManagePurchases')) && (reportType === 'all' || isPurchaseOnly));

    return {
      showWarehouse: !isCashOnly,
      showCashbox: !isDamaged && !isRepRole,
      showProductFilters: !isCashOnly,
      showCustomer,
      showSupplier,
      showParty: showCustomer || showSupplier,
      showMovementType: true,
      showRepresentative: !isRepRole && (reportType === 'all' || isSalesOnly || isDamaged || (!isCashSupplier && !isCashEmployee)),
      showEmployee: !isRepRole,
      showUser: !isRepRole,
      showInvoiceNumber: !isCashEmployee,
      showRecordId: true,
    };
  }, [reportType, isRepRole, hasPermission]);

  const activeDetailedFiltersCount = useMemo(() => {
    let count = 0;
    if (filterVisibility.showParty && partyKey !== 'all') count++;
    if (movementType !== 'all') count++;
    if (filterVisibility.showRepresentative && representativeId !== 'all') count++;
    if (filterVisibility.showEmployee && employeeId !== 'all') count++;
    if (filterVisibility.showCashbox && cashboxId !== 'all') count++;
    if (filterVisibility.showUser && userId !== 'all') count++;
    if (filterVisibility.showWarehouse && warehouseId !== 'all') count++;
    if (filterVisibility.showProductFilters && productId !== 'all') count++;
    if (filterVisibility.showProductFilters && productSearch.trim()) count++;
    if (filterVisibility.showProductFilters && barcode.trim()) count++;
    if (filterVisibility.showInvoiceNumber && invoiceNumber.trim()) count++;
    if (filterVisibility.showRecordId && recordId.trim()) count++;
    return count;
  }, [
    filterVisibility,
    partyKey,
    movementType,
    representativeId,
    employeeId,
    cashboxId,
    userId,
    warehouseId,
    productId,
    productSearch,
    barcode,
    invoiceNumber,
    recordId,
  ]);

  const mobileDetailedItemClass = showMoreFilters ? '' : 'hidden md:block';

  // Apply optional inline search + sorting within each section
  const processedSections = useMemo(() => {
    const sections = reportData?.sections || [];
    const q = inlineTableSearch.trim().toLowerCase();

    return sections.map((sec) => {
      let rows = sec.rows;
      if (q) {
        rows = rows.filter((r) =>
          [
            r.operationLabel,
            r.movementOrRemaining,
            r.employeeName,
            r.userName,
            r.barcode,
            r.displayId,
            r.invoiceNumber,
            r.branchName,
            r.cashboxName,
            r.notes,
            r.actualDateTime,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q)
        );
      }

      if (sortCol) {
        rows = [...rows].sort((a, b) => {
          const av = a[sortCol];
          const bv = b[sortCol];
          let cmp = 0;
          if (typeof av === 'number' && typeof bv === 'number') {
            cmp = av - bv;
          } else {
            cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'ar');
          }
          return sortDir === 'asc' ? cmp : -cmp;
        });
      }

      const useServerTotals = Boolean(reportData?.pagination?.enabled && !q);
      if (useServerTotals) {
        return {
          ...sec,
          rows,
        };
      }

      const qtySum = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
      const priceSum = sec.isInvoiceLayout ? rows.reduce((s, r) => s + Number(r.priceOrTotal || 0), 0) : null;
      const valueSum = rows.reduce((s, r) => s + Number(r.valueOrPaid || 0), 0);
      const remSum = sec.isInvoiceLayout ? rows.reduce((s, r) => s + Number(r.movementOrRemaining || 0), 0) : null;
      const profitSum = rows.reduce((s, r) => s + Number(r.profit || 0), 0);
      const costSum = rows.reduce((s, r) => s + Number(r.costValue || 0), 0);
      const discSum = rows.reduce((s, r) => s + Number(r.discount || 0), 0);
      const profitPct = costSum > 0 ? Math.round((profitSum / costSum) * 1000) / 10 : profitSum > 0 ? 100 : profitSum < 0 ? -100 : 0;

      return {
        ...sec,
        rows,
        totals: {
          ...sec.totals,
          count: rows.length,
          quantity: qtySum,
          priceOrTotal: priceSum,
          valueOrPaid: valueSum,
          remaining: remSum,
          profit: profitSum,
          costValue: costSum,
          discount: discSum,
          profitPercent: profitPct,
        },
      };
    });
  }, [reportData?.sections, reportData?.pagination?.enabled, inlineTableSearch, sortCol, sortDir]);

  const activeReportOption =
    REPORT_TYPE_OPTIONS.find((t) => t.key === reportType) || REPORT_TYPE_OPTIONS[0];

  const handleExportExcel = async () => {
    const sourceReport =
      exportScope === 'all' && (inlineTableSearch || reportType !== 'all')
        ? await fetchComprehensiveReport({ reportType: 'all' })
        : null;
    const secsToExport = sourceReport ? sourceReport.sections : processedSections;
    const sumToExport = sourceReport ? sourceReport.summary : reportData?.summary;

    const headers = visibleColumns.map((c) => c.label);
    const rows: Array<Array<string | number>> = [];

    // Header info rows for Excel clarity
    rows.push([`AWLAD SELIM - ${settings.companyName}`, `نوع التقرير: ${sourceReport ? 'الكل (شامل)' : activeReportOption.label}`, `الفترة: ${dateFrom || 'البداية'} إلى ${useDateTo ? dateTo : 'الآن'}`, `تاريخ الاستخراج: ${new Date().toLocaleString('ar-EG')}`]);

    for (const sec of secsToExport) {
      rows.push([`=== ${sec.title} (${sec.rows.length}) ===`]);
      if (sec.isInvoiceLayout) {
        rows.push(['', '', '', '', 'اجمالى', 'مدفوع', 'آجل']);
      }
      for (const r of sec.rows) {
        const baseRow: Array<string | number> = [
          r.operationLabel,
          r.quantity,
          r.unit,
          r.actualDateTime,
          r.priceOrTotal,
          r.valueOrPaid,
          r.movementOrRemaining,
          r.employeeName,
          r.userName,
          r.businessDate,
          ...(isRepRole ? [] : [r.profit]),
          r.barcode,
          r.displayId,
          r.invoiceNumber,
          r.branchName,
          ...(isRepRole ? [] : [r.cashboxName]),
          r.notes,
          r.discount,
          ...(isRepRole ? [] : [`${r.profitPercent}%`]),
        ];
        rows.push(baseRow);
      }
      rows.push([
        'الإجمالي',
        sec.totals.quantity,
        '',
        '',
        sec.totals.priceOrTotal ?? '',
        sec.totals.valueOrPaid,
        sec.totals.remaining ?? '',
        '',
        '',
        '',
        ...(isRepRole ? [] : [sec.totals.profit]),
        '',
        '',
        '',
        '',
        ...(isRepRole ? [] : ['']),
        '',
        sec.totals.discount,
        ...(isRepRole ? [] : [`${sec.totals.profitPercent}%`]),
      ]);
    }

    if (sumToExport && !isRepRole) {
      rows.push([]);
      rows.push(['رصيد الدرج', sumToExport.drawerBalance, 'رصيد التقرير', sumToExport.reportBalance, 'مرحل من الأمس', sumToExport.carriedFromYesterday, 'ربح التقرير', sumToExport.reportProfit]);
    }

    exportToExcel(`AWLAD_SELIM_${reportType}_${todayYmd()}`, headers, rows);
  };

  const handleExportPdf = async () => {
    const sourceReport =
      exportScope === 'all' && (inlineTableSearch || reportType !== 'all')
        ? await fetchComprehensiveReport({ reportType: 'all' })
        : null;
    const secsToExport = sourceReport ? sourceReport.sections : processedSections;
    const sumToExport = sourceReport ? sourceReport.summary : reportData?.summary;

    const headers = visibleColumns.map((c) => c.label);
    const rows: Array<Array<string | number>> = [];
    for (const sec of secsToExport) {
      rows.push([
        `[ ${sec.title} (${sec.totals.count}) ]`,
        fmtNum(sec.totals.quantity),
        '',
        '',
        sec.totals.priceOrTotal !== null ? fmtMoney(sec.totals.priceOrTotal) : '-',
        fmtMoney(sec.totals.valueOrPaid),
        sec.totals.remaining !== null ? fmtMoney(sec.totals.remaining) : '-',
        '',
        '',
        '',
        ...(isRepRole ? [] : [fmtMoney(sec.totals.profit)]),
        '',
        '',
        '',
        '',
        ...(isRepRole ? [] : ['']),
        '',
        fmtMoney(sec.totals.discount),
        ...(isRepRole ? [] : [`${sec.totals.profitPercent}%`]),
      ]);
      for (const r of sec.rows) {
        rows.push([
          r.operationLabel,
          fmtNum(r.quantity),
          r.unit,
          r.actualDateTime,
          fmtMoney(r.priceOrTotal),
          fmtMoney(r.valueOrPaid),
          typeof r.movementOrRemaining === 'number' ? fmtMoney(r.movementOrRemaining) : r.movementOrRemaining,
          r.employeeName,
          r.userName,
          r.businessDate,
          ...(isRepRole ? [] : [fmtMoney(r.profit)]),
          r.barcode,
          r.displayId,
          r.invoiceNumber,
          r.branchName,
          ...(isRepRole ? [] : [r.cashboxName]),
          r.notes,
          fmtMoney(r.discount),
          ...(isRepRole ? [] : [`${r.profitPercent}%`]),
        ]);
      }
    }

    exportTableToPdf(`تقرير ${sourceReport ? 'الكل (شامل)' : activeReportOption.label}`, headers, rows, {
      companyName: settings.companyName || 'AWLAD SELIM — أولاد سليم',
      subtitle: 'نظام التقارير الشامل والموحد',
      dateRangeText: `من: ${dateFrom || 'البداية'} إلى: ${useDateTo ? dateTo : 'الآن'}`,
      summaryPairs: sumToExport && !isRepRole
        ? [
            { label: 'رصيد الدرج', value: `${fmtMoney(sumToExport.drawerBalance)} ${currency}` },
            { label: 'رصيد التقرير', value: `${fmtMoney(sumToExport.reportBalance)} ${currency}` },
            { label: 'مرحل من الأمس', value: `${fmtMoney(sumToExport.carriedFromYesterday)} ${currency}` },
            { label: 'ربح التقرير', value: `${fmtMoney(sumToExport.reportProfit)} ${currency}`, highlight: true },
          ]
        : sumToExport
        ? [
            { label: 'صافي المبيعات', value: `${fmtMoney(sumToExport.filteredSalesNet)} ${currency}`, highlight: true },
            { label: 'عدد الحركات', value: String(sumToExport.totalRows ?? 0) },
          ]
        : [],
    });
  };

  const handleOpenThermalOrA4Print = () => {
    const items = processedSections.flatMap((sec) =>
      sec.rows.map((r) => ({
        name: `[${sec.title}] ${r.operationLabel}`,
        unit: r.unit,
        quantity: r.quantity,
        price: r.priceOrTotal,
        discount: r.discount,
        total: r.valueOrPaid,
      }))
    );
    setPrintModalData({
      title: `تقرير ${activeReportOption.label}`,
      docNumber: `RPT-${todayYmd().replace(/-/g, '')}`,
      docType: 'كشف حساب',
      date: `${dateFrom || 'البداية'} → ${useDateTo ? dateTo : 'الآن'}`,
      partyName: `تقرير: ${activeReportOption.label}`,
      items,
      grandTotal: isRepRole ? (reportData?.summary.filteredSalesNet ?? 0) : (reportData?.summary.reportBalance ?? 0),
      paidAmount: isRepRole ? undefined : (reportData?.summary.drawerBalance ?? 0),
      remainingAmount: isRepRole ? undefined : (reportData?.summary.reportProfit ?? 0),
      notes: isRepRole
        ? `صافي المبيعات: ${fmtMoney(reportData?.summary.filteredSalesNet)} ${currency} | عدد الحركات: ${reportData?.summary.totalRows ?? 0}`
        : `مرحل من الأمس: ${fmtMoney(reportData?.summary.carriedFromYesterday)} ${currency} | ربح التقرير: ${fmtMoney(reportData?.summary.reportProfit)} ${currency}`,
      tableHeaders: ['م', 'القسم / العملية', 'الوحدة', 'الكمية', 'السعر', 'الخصم', 'القيمة'],
    });
  };

  const handlePrintSourceDoc = (src: ReportSourceDocumentResponse) => {
    const d = src.document || {};
    setPrintModalData({
      title: src.title,
      docNumber: d.invoiceNumber || d.returnNumber || d.docNumber || d.transactionNumber || '-',
      docType:
        src.docType === 'sales_invoice'
          ? 'فاتورة مبيعات'
          : src.docType === 'purchase_invoice'
          ? 'فاتورة مشتريات'
          : src.docType === 'sales_return'
          ? 'مرتجع مبيعات'
          : src.docType === 'purchase_return'
          ? 'مرتجع مشتريات'
          : 'سند قبض',
      date: d.actualDateTime || d.date || todayYmd(),
      partyName: d.customerName || d.supplierName || d.partyName || d.relatedEntityName,
      warehouseName: d.warehouseName,
      representativeName: d.representativeName,
      items: Array.isArray(d.items)
        ? d.items.map((it: any) => ({
            name: it.productName,
            unit: it.unit,
            quantity: Number(it.quantity || 0),
            price: Number(it.unitPrice || it.unitCost || 0),
            discount: Number(it.discount || 0),
            total: Number(it.total || it.totalLoss || 0),
          }))
        : undefined,
      subtotal: d.subtotal,
      discountTotal: d.discountTotal,
      grandTotal: Number(d.grandTotal ?? d.amount ?? 0),
      paidAmount: d.paidAmount,
      remainingAmount: d.remainingAmount,
      notes: d.notes || d.description || d.reason,
    });
  };

  const canExport = hasPermission('canExport');
  const canPrint = hasPermission('canPrint');
  const filterOpts = reportData?.filterOptions;
  const summary = reportData?.summary;

  const branchOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.branches || []).map((b) => ({
        value: b.id,
        label: b.name,
        subtitle: b.code,
        searchText: `${b.id} ${b.code || ''}`,
      })),
    [filterOpts?.branches]
  );

  const warehouseOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.warehouses || []).map((w) => ({
        value: w.id,
        label: w.name,
        subtitle: w.code,
        searchText: `${w.id} ${w.code || ''}`,
      })),
    [filterOpts?.warehouses]
  );

  const cashboxOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.cashboxes || []).map((cb) => ({
        value: cb.id,
        label: cb.name,
        badge: cb.type === 'bank' ? 'بنك' : 'خزنة',
        searchText: cb.id,
      })),
    [filterOpts?.cashboxes]
  );

  // Strict separation: Employee options contain HR employees only
  const employeeOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.employees || []).map((emp) => ({
        value: emp.id,
        label: emp.name,
        subtitle: emp.jobTitle || 'موظف',
        badge: emp.userId ? 'مرتبط بمستخدم' : 'موظف',
        searchText: `${emp.id} ${emp.jobTitle || ''} ${emp.identityId || ''}`,
      })),
    [filterOpts?.employees]
  );

  // Strict separation: User options contain system user accounts only
  const userOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.users || []).map((u) => ({
        value: u.id,
        label: u.fullName,
        subtitle: `@${u.username}`,
        badge: u.role,
        searchText: `${u.id} ${u.username} ${u.role} ${u.identityId || ''}`,
      })),
    [filterOpts?.users]
  );

  const representativeOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.representatives || []).map((r) => ({
        value: r.id,
        label: r.name,
        badge: r.identityId ? 'مندوب' : undefined,
        searchText: `${r.id} ${r.identityId || ''}`,
      })),
    [filterOpts?.representatives]
  );

  // Unified grouped Customer / Supplier options ("العميل / المورد")
  const partyOptions = useMemo<SearchableFilterOption[]>(() => {
    const list: SearchableFilterOption[] = [];
    if (filterVisibility.showCustomer) {
      for (const c of filterOpts?.customers || []) {
        list.push({
          value: `customer:${c.id}`,
          label: c.name,
          subtitle: c.phone || undefined,
          badge: 'عميل',
          groupLabel: 'العملاء',
          searchText: `${c.id} ${c.phone || ''} عميل`,
        });
      }
    }
    if (filterVisibility.showSupplier) {
      for (const s of filterOpts?.suppliers || []) {
        list.push({
          value: `supplier:${s.id}`,
          label: s.name,
          subtitle: s.phone || undefined,
          badge: 'مورد',
          groupLabel: 'الموردون',
          searchText: `${s.id} ${s.phone || ''} مورد`,
        });
      }
    }
    return list;
  }, [filterOpts?.customers, filterOpts?.suppliers, filterVisibility.showCustomer, filterVisibility.showSupplier]);

  const productOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.products || []).map((p) => ({
        value: p.id,
        label: p.name,
        subtitle: [p.code ? `كود: ${p.code}` : '', p.barcode ? `باركود: ${p.barcode}` : '', p.category]
          .filter(Boolean)
          .join(' • '),
        badge: p.code || undefined,
        searchText: `${p.id} ${p.code || ''} ${p.barcode || ''} ${p.category || ''} ${p.size || ''} ${p.color || ''}`,
      })),
    [filterOpts?.products]
  );

  const movementTypeOptions = useMemo<SearchableFilterOption[]>(() => {
    const canViewPurchases = !isRepRole || hasPermission('canCreatePurchase') || hasPermission('canManagePurchases');
    const items: SearchableFilterOption[] = [
      { value: 'sales', label: 'مبيعات', badge: 'بيع' },
      { value: 'sales_return', label: 'مرتجع بيع', badge: 'مرتجع' },
    ];
    if (canViewPurchases) {
      items.push(
        { value: 'purchase', label: 'مشتريات', badge: 'شراء' },
        { value: 'purchase_return', label: 'مرتجع شراء', badge: 'مرتجع' }
      );
    }
    items.push(
      { value: 'damaged', label: 'تالف وهالك', badge: 'تالف' },
      { value: 'cash_in', label: 'مقبوضات وسداد عملاء', badge: 'وارد' },
      { value: 'cash_out', label: 'مدفوعات ومصروفات وسحب', badge: 'صادر' }
    );
    return items;
  }, [isRepRole, hasPermission]);

  return (
    <div className="flex flex-col text-slate-900 select-none sm:select-text" dir="rtl">
      {/* Slim Top Mode + Quick Period Presets + Export Strip (Brand-Store-compact, no floating white cards) */}
      <div className="bg-[#e8ebef] border border-slate-300 border-b-slate-300/80 rounded-t-md px-2 py-1 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode('unified_grid')}
            className={`flex items-center gap-1 h-6 px-2 rounded-sm text-[11px] font-extrabold transition-colors cursor-pointer ${
              viewMode === 'unified_grid'
                ? 'bg-[#22b14c] text-white'
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />
            <span>نظام التقارير التفصيلية الموحد</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('item_lifecycle')}
            className={`flex items-center gap-1 h-6 px-2 rounded-sm text-[11px] font-extrabold transition-colors cursor-pointer ${
              viewMode === 'item_lifecycle'
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>تاريخ الصنف والأرباح والخسائر</span>
          </button>

          <div className="h-4 w-px bg-slate-300 mx-0.5 hidden sm:block" />

          {/* Quick Period Presets */}
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            {[
              { id: 'today', label: 'تقرير اليوم' },
              { id: 'this_month', label: 'الشهر الحالي' },
              { id: 'prev_month', label: 'الشهر السابق' },
              { id: 'this_year', label: 'السنة الحالية' },
              { id: 'prev_year', label: 'السنة السابقة' },
              { id: 'all_time', label: 'كل الفترات' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPeriodPreset(p.id as any)}
                className={`h-6 px-2 rounded-sm font-bold border transition-colors cursor-pointer ${
                  periodPreset === p.id
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Print, Export & Mobile-Only Filter Toggle */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setShowMoreFilters((p) => !p)}
            aria-expanded={showMoreFilters}
            className={`md:hidden flex items-center gap-1 h-6 px-2 rounded-sm border text-[11px] font-bold cursor-pointer ${
              showMoreFilters
                ? 'bg-blue-900 text-white border-blue-900'
                : 'bg-white text-slate-700 border-slate-300'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>فلاتر{activeDetailedFiltersCount > 0 ? ` (${activeDetailedFiltersCount})` : ''}</span>
          </button>

          <select
            value={exportScope}
            onChange={(e) => setExportScope(e.target.value as 'filtered' | 'all')}
            aria-label="نطاق التصدير"
            className="h-6 px-1.5 text-[11px] font-bold bg-white border border-slate-300 rounded-sm text-slate-700"
          >
            <option value="filtered">تصدير المعروض المفلتر</option>
            <option value="all">تصدير كامل التقرير</option>
          </select>

          {canPrint && (
            <>
              <button
                type="button"
                onClick={handleOpenThermalOrA4Print}
                className="flex items-center gap-1 h-6 px-2 rounded-sm bg-slate-700 hover:bg-slate-800 text-white text-[11px] font-bold cursor-pointer"
                title="طباعة A4 أو حراري 80/58 مم"
              >
                <Printer className="w-3 h-3" />
                <span>طباعة</span>
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="flex items-center gap-1 h-6 px-2 rounded-sm bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-bold cursor-pointer"
              >
                <FileText className="w-3 h-3" />
                <span>PDF</span>
              </button>
            </>
          )}
          {canExport && (
            <button
              type="button"
              onClick={handleExportExcel}
              className="flex items-center gap-1 h-6 px-2 rounded-sm bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold cursor-pointer"
            >
              <FileSpreadsheet className="w-3 h-3" />
              <span>Excel</span>
            </button>
          )}
        </div>
      </div>

      {/* Brand-Store Top Filter Band (Zone 2 & 3 & 4) Connected Directly Above «عرض» */}
      <form
        onSubmit={handleApplySearchSubmit}
        aria-label="فلاتر البحث والتصفية للتقارير"
        className="w-full bg-[#f4f6f8] border-x border-b border-slate-300 px-2.5 py-2 space-y-2 text-xs"
      >
        {/* Zone 2: Structured Selectors & Date Range (No cramping, no clipping, Portal dropdowns) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 items-end">
          {/* الفرع */}
          <div className="min-w-0">
            <SearchableFilterSelect
              id="rpt-filter-branch"
              label="الفرع"
              value={branchId}
              onChange={(val) => {
                setBranchId(val);
                setPage(1);
              }}
              options={branchOptions}
              allOptionLabel="كل الفروع"
              allowClear
            />
          </div>

          {/* التاريخ الموحد (من -/+ و ☑ إلى) */}
          <div className="sm:col-span-2 md:col-span-2 xl:col-span-2 grid grid-cols-2 gap-1.5 min-w-0">
            <div className="min-w-0">
              <label htmlFor="rpt-filter-date-from" className="flex items-center gap-1 text-[11.5px] font-semibold text-slate-700 leading-tight mb-1 whitespace-nowrap">
                <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>من تاريخ</span>
              </label>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setPeriodPreset('custom');
                    setPage(1);
                    setDateFrom((prev) => addDaysYmd(prev || todayYmd(), -1));
                  }}
                  className="h-[34px] w-7 shrink-0 bg-white border border-slate-300 rounded-md hover:bg-slate-100 text-slate-700 font-bold leading-none cursor-pointer"
                  title="يوم سابق"
                  aria-label="يوم سابق"
                >
                  -
                </button>
                <input
                  id="rpt-filter-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setPeriodPreset('custom');
                    setPage(1);
                    setDateFrom(e.target.value);
                  }}
                  className="w-full min-w-0 h-[34px] bg-white border border-slate-300 rounded-md px-2 text-xs font-mono tabular-nums text-slate-800 focus:border-emerald-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPeriodPreset('custom');
                    setPage(1);
                    setDateFrom((prev) => addDaysYmd(prev || todayYmd(), 1));
                  }}
                  className="h-[34px] w-7 shrink-0 bg-white border border-slate-300 rounded-md hover:bg-slate-100 text-slate-700 font-bold leading-none cursor-pointer"
                  title="يوم تالٍ"
                  aria-label="يوم تالٍ"
                >
                  +
                </button>
              </div>
            </div>

            <div className="min-w-0">
              <label htmlFor="rpt-filter-use-date-to" className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-700 leading-tight mb-1 cursor-pointer whitespace-nowrap">
                <input
                  id="rpt-filter-use-date-to"
                  type="checkbox"
                  checked={useDateTo}
                  onChange={(e) => {
                    setPeriodPreset('custom');
                    setPage(1);
                    setUseDateTo(e.target.checked);
                  }}
                  className="accent-emerald-700 w-3.5 h-3.5 shrink-0"
                />
                <span>إلى تاريخ</span>
              </label>
              <input
                id="rpt-filter-date-to"
                type="date"
                disabled={!useDateTo}
                value={dateTo}
                onChange={(e) => {
                  setPeriodPreset('custom');
                  setPage(1);
                  setDateTo(e.target.value);
                }}
                aria-label="إلى تاريخ"
                className="w-full min-w-0 h-[34px] bg-white border border-slate-300 rounded-md px-2 text-xs font-mono tabular-nums text-slate-800 disabled:opacity-45 focus:border-emerald-600 focus:outline-none"
              />
            </div>
          </div>

          {/* العميل / المورد الموحد (مقسم إلى مجموعات داخل القائمة) */}
          {filterVisibility.showParty && (
            <div className={`min-w-0 sm:col-span-2 md:col-span-2 xl:col-span-2 ${mobileDetailedItemClass}`}>
              <SearchableFilterSelect
                id="rpt-filter-party"
                label={filterVisibility.showSupplier ? 'العميل / المورد' : 'العميل'}
                value={partyKey}
                onChange={(val) => {
                  setPartyKey(val);
                  setPage(1);
                }}
                options={partyOptions}
                allOptionLabel="كل العملاء والموردين"
                searchPlaceholder="ابحث باسم العميل أو المورد أو الهاتف..."
                allowClear
                minPanelWidth={280}
              />
            </div>
          )}

          {/* نوع الحركة */}
          {filterVisibility.showMovementType && (
            <div className={`min-w-0 ${mobileDetailedItemClass}`}>
              <SearchableFilterSelect
                id="rpt-filter-movement-type"
                label="نوع الحركة"
                value={movementType}
                onChange={(val) => {
                  setMovementType((val as ReportMovementTypeKey) || 'all');
                  setPage(1);
                }}
                options={movementTypeOptions}
                allOptionLabel="كل الحركات"
                allowClear
              />
            </div>
          )}

          {/* المخزن */}
          {filterVisibility.showWarehouse && (
            <div className={`min-w-0 ${mobileDetailedItemClass}`}>
              <SearchableFilterSelect
                id="rpt-filter-warehouse"
                label="المخزن"
                value={warehouseId}
                onChange={(val) => {
                  setWarehouseId(val);
                  setPage(1);
                }}
                options={warehouseOptions}
                allOptionLabel="كل المخازن"
                allowClear
              />
            </div>
          )}

          {/* الخزنة */}
          {filterVisibility.showCashbox && (
            <div className={`min-w-0 ${mobileDetailedItemClass}`}>
              <SearchableFilterSelect
                id="rpt-filter-cashbox"
                label="الخزنة"
                value={cashboxId}
                onChange={(val) => {
                  setCashboxId(val);
                  setPage(1);
                }}
                options={cashboxOptions}
                allOptionLabel="كل الخزائن"
                allowClear
              />
            </div>
          )}

          {/* المندوب */}
          {filterVisibility.showRepresentative && (
            <div className={`min-w-0 ${mobileDetailedItemClass}`}>
              <SearchableFilterSelect
                id="rpt-filter-rep"
                label="المندوب"
                value={representativeId}
                onChange={(val) => {
                  setRepresentativeId(val);
                  setPage(1);
                }}
                options={representativeOptions}
                allOptionLabel="كل المندوبين"
                allowClear
              />
            </div>
          )}

          {/* الموظف (منفصل تماماً عن المستخدم) */}
          {filterVisibility.showEmployee && (
            <div className={`min-w-0 ${mobileDetailedItemClass}`}>
              <SearchableFilterSelect
                id="rpt-filter-employee"
                label="الموظف"
                value={employeeId}
                onChange={(val) => {
                  setEmployeeId(val);
                  setPage(1);
                }}
                options={employeeOptions}
                allOptionLabel="كل الموظفين"
                searchPlaceholder="بحث في الموظفين..."
                allowClear
              />
            </div>
          )}

          {/* المستخدم (منفصل تماماً عن الموظف) */}
          {filterVisibility.showUser && (
            <div className={`min-w-0 ${mobileDetailedItemClass}`}>
              <SearchableFilterSelect
                id="rpt-filter-user"
                label="المستخدم"
                value={userId}
                onChange={(val) => {
                  setUserId(val);
                  setPage(1);
                }}
                options={userOptions}
                allOptionLabel="كل المستخدمين"
                searchPlaceholder="بحث في حسابات المستخدمين..."
                allowClear
              />
            </div>
          )}

          {/* الصنف */}
          {filterVisibility.showProductFilters && (
            <div className={`min-w-0 sm:col-span-2 md:col-span-2 xl:col-span-2 ${mobileDetailedItemClass}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label htmlFor="rpt-filter-product" className="block text-[11.5px] font-semibold text-slate-700 leading-tight whitespace-nowrap">
                  الصنف
                </label>
                {productId !== 'all' && viewMode === 'unified_grid' && (
                  <button
                    type="button"
                    onClick={() => setViewMode('item_lifecycle')}
                    className="text-[11px] font-bold text-blue-700 hover:underline leading-none shrink-0 cursor-pointer"
                    title="عرض تاريخ وربح الصنف"
                  >
                    عرض تاريخ الصنف
                  </button>
                )}
              </div>
              <SearchableFilterSelect
                id="rpt-filter-product"
                value={productId}
                onChange={(val) => {
                  setProductId(val);
                  setPage(1);
                }}
                options={productOptions}
                allOptionLabel="كل الأصناف"
                searchPlaceholder="ابحث بالاسم أو الكود أو الباركود..."
                allowClear
                minPanelWidth={290}
              />
            </div>
          )}
        </div>

        {/* Zone 3 & Zone 4: Text Search Inputs + Search / Reset Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 items-end pt-1.5 border-t border-slate-200/90">
          {filterVisibility.showProductFilters && (
            <>
              <div className={`min-w-0 ${mobileDetailedItemClass}`}>
                <label htmlFor="rpt-filter-product-search" className="block text-[11.5px] font-semibold text-slate-700 leading-tight mb-1 whitespace-nowrap">
                  اسم الصنف
                </label>
                <input
                  id="rpt-filter-product-search"
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="جزء من اسم الصنف..."
                  className="w-full min-w-0 h-[34px] bg-white border border-slate-300 rounded-md px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <div className={`min-w-0 ${mobileDetailedItemClass}`}>
                <label htmlFor="rpt-filter-barcode" className="block text-[11.5px] font-semibold text-slate-700 leading-tight mb-1 whitespace-nowrap">
                  الباركود
                </label>
                <input
                  id="rpt-filter-barcode"
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="الباركود أو الكود..."
                  className="w-full min-w-0 h-[34px] bg-white border border-slate-300 rounded-md px-2.5 text-xs font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </>
          )}

          {filterVisibility.showInvoiceNumber && (
            <div className={`min-w-0 ${mobileDetailedItemClass}`}>
              <label htmlFor="rpt-filter-invoice-no" className="block text-[11.5px] font-semibold text-slate-700 leading-tight mb-1 whitespace-nowrap">
                رقم الفاتورة
              </label>
              <input
                id="rpt-filter-invoice-no"
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="رقم الفاتورة..."
                className="w-full min-w-0 h-[34px] bg-white border border-slate-300 rounded-md px-2.5 text-xs font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
              />
            </div>
          )}

          {filterVisibility.showRecordId && (
            <div className={`min-w-0 ${mobileDetailedItemClass}`}>
              <label htmlFor="rpt-filter-record-id" className="block text-[11.5px] font-semibold text-slate-700 leading-tight mb-1 whitespace-nowrap">
                كود السجل
              </label>
              <input
                id="rpt-filter-record-id"
                type="text"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
                placeholder="ID السجل..."
                className="w-full min-w-0 h-[34px] bg-white border border-slate-300 rounded-md px-2.5 text-xs font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
              />
            </div>
          )}

          {/* Zone 4: بحث عام + زر البحث الأخضر وإعادة الضبط */}
          <div className="sm:col-span-2 md:col-span-2 xl:col-span-2 min-w-0">
            <label htmlFor="rpt-filter-search" className="block text-[11.5px] font-semibold text-slate-700 leading-tight mb-1 whitespace-nowrap">
              بحث عام
            </label>
            <div className="flex items-center gap-1.5 min-w-0">
              <input
                id="rpt-filter-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث شامل بالاسم أو الملاحظات أو المستند..."
                className="flex-1 min-w-0 h-[34px] bg-white border border-slate-300 rounded-md px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="h-[34px] px-3.5 rounded-md bg-[#22b14c] hover:bg-[#1a963f] disabled:opacity-60 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <Search className="w-3.5 h-3.5 shrink-0" />
                <span>بحث</span>
              </button>
              <button
                type="button"
                onClick={handleResetFilters}
                className="h-[34px] px-2.5 rounded-md bg-white border border-slate-300 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                title="عرض الكل / إعادة ضبط الفلاتر"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>إعادة ضبط</span>
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Error State */}
      {errorMsg && (
        <div className="mt-1 p-2 rounded-sm bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
          {errorMsg}
        </div>
      )}

      {/* MAIN CONTENT: Either Reference 19-Column Unified Table OR Item Lifecycle & P&L Panel */}
      {viewMode === 'item_lifecycle' && reportData ? (
        <div className="mt-1.5">
          <ItemLifecycleAndPnlPanel
            lifecycle={reportData.itemLifecycle}
            selectedPnl={reportData.itemPnl.selectedItem}
            pnlItems={reportData.itemPnl.items}
            portfolioTotals={reportData.itemPnl.portfolioTotals}
            currency={currency}
            onSelectProduct={(pid) => setProductId(pid)}
            onInspectDocument={handleInspectDocument}
          />
        </div>
      ) : (
        <div className="bg-white border border-t-0 border-slate-400 rounded-b-md overflow-hidden shadow-xs">
          {/* Reference Green Header Strip: عرض + in-table search (directly under filters) */}
          <div className="bg-[#22b14c] text-white px-2.5 py-1 flex flex-wrap items-center justify-between gap-2 text-xs font-extrabold">
            <div className="flex items-center gap-3">
              <span>عرض — {activeReportOption.label}</span>
              <span className="bg-white/20 px-2 py-0.5 rounded font-mono text-[11px]">
                {processedSections.reduce((s, sec) => s + sec.rows.length, 0)} حركة
              </span>
              {isLoading && <span className="text-[11px] opacity-90">جاري التحديث...</span>}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inlineTableSearch}
                onChange={(e) => setInlineTableSearch(e.target.value)}
                placeholder="تصفية سريعة داخل الجدول..."
                className="h-6 px-2 rounded bg-white text-slate-900 placeholder-slate-400 text-[11px] font-normal w-44 focus:outline-none"
              />
            </div>
          </div>

          {/* Scrollable 19-Column Table Container */}
          <div className="overflow-auto max-h-[54vh] bg-white">
            <table className="w-full border-collapse text-[11.5px] min-w-[1680px]">
              <thead className="sticky top-0 z-20 bg-[#eef1f4] text-slate-800 border-b-2 border-slate-400">
                <tr>
                  {visibleColumns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`px-2 py-2 border-l border-slate-300 font-extrabold whitespace-nowrap cursor-pointer hover:bg-slate-200/70 transition-colors ${
                        col.align === 'center' ? 'text-center' : 'text-right'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <span>{col.label}</span>
                        <ArrowUpDown className={`w-3 h-3 ${sortCol === col.key ? 'text-emerald-700' : 'text-slate-400'}`} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {processedSections.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={visibleColSpan} className="p-10 text-center text-slate-500 font-bold text-sm">
                      لا توجد حركات مطابقة لمعايير البحث والتصفية الحالية.
                    </td>
                  </tr>
                )}

                {processedSections.map((section) => {
                  const isSlate = section.theme === 'slate';
                  const headerBg = isSlate ? 'bg-[#4f5d6b] text-white' : 'bg-[#8d9973] text-white';

                  return (
                    <React.Fragment key={section.key}>
                      {/* Section Header Banner Row */}
                      <tr className={`${headerBg} font-extrabold text-xs`}>
                        <td colSpan={visibleColSpan} className="px-3 py-1.5 border-y border-slate-400">
                          <div className="flex items-center justify-between">
                            <span>{section.title}</span>
                            <span className="text-[11px] opacity-90 font-mono">({section.rows.length})</span>
                          </div>
                        </td>
                      </tr>

                      {/* Secondary Sub-header for Invoice Sections matching Reference (اجمالى / مدفوع / آجل) */}
                      {section.isInvoiceLayout && (
                        <tr className="bg-[#f1f3f5] text-slate-700 font-bold text-[11px] border-b border-slate-300">
                          <td className="px-2 py-1 border-l border-slate-300" />
                          <td className="px-2 py-1 border-l border-slate-300" />
                          <td className="px-2 py-1 border-l border-slate-300" />
                          <td className="px-2 py-1 border-l border-slate-300" />
                          <td className="px-2 py-1 border-l border-slate-300 text-center bg-slate-200/70">اجمالى</td>
                          <td className="px-2 py-1 border-l border-slate-300 text-center bg-slate-200/70">مدفوع</td>
                          <td className="px-2 py-1 border-l border-slate-300 text-center bg-slate-200/70">آجل</td>
                          <td colSpan={isRepRole ? 9 : 12} className="px-2 py-1" />
                        </tr>
                      )}

                      {/* Data Rows */}
                      {section.rows.length === 0 ? (
                        <tr className="bg-slate-50 text-slate-400">
                          <td colSpan={visibleColSpan} className="px-3 py-3 text-center text-xs">
                            لا توجد سجلات في قسم ({section.title}) ضمن هذه الفترة
                          </td>
                        </tr>
                      ) : (
                        section.rows.map((r) => {
                          const rowBg =
                            r.rowTone === 'invoice_blue'
                              ? 'bg-[#e8eff8] hover:bg-[#d8e5f6]'
                              : r.rowTone === 'warning_rose'
                              ? 'bg-[#fff5f6] hover:bg-[#ffe8eb]'
                              : 'bg-white hover:bg-slate-50';

                          const valueCellHighlight = section.cashHighlightCol
                            ? 'bg-[#dff2d8] font-black text-emerald-900'
                            : 'font-bold text-slate-900';

                          return (
                            <tr
                              key={r.rowId}
                              onClick={() => handleInspectDocument(r.docType, r.docId)}
                              title="اضغط لعرض المستند الأصلي والتدقيق"
                              className={`${rowBg} border-b border-slate-200 transition-colors cursor-pointer`}
                            >
                              {/* 1. العملية */}
                              <td className="px-2 py-1.5 border-l border-slate-200 font-bold text-slate-900 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1">
                                  <Receipt className="w-3 h-3 text-slate-400 shrink-0" />
                                  <span>{r.operationLabel}</span>
                                </span>
                              </td>
                              {/* 2. الكمية */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center font-mono font-bold whitespace-nowrap">
                                {fmtNum(r.quantity)}
                              </td>
                              {/* 3. الوحدة */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center whitespace-nowrap">
                                {r.unit}
                              </td>
                              {/* 4. التاريخ الفعلى */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center font-mono text-[11px] whitespace-nowrap text-slate-700">
                                {r.actualDateTime}
                              </td>
                              {/* 5. السعر / اجمالى */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center font-mono whitespace-nowrap">
                                {fmtMoney(r.priceOrTotal)}
                              </td>
                              {/* 6. القيمة / مدفوع */}
                              <td className={`px-2 py-1.5 border-l border-slate-200 text-center font-mono whitespace-nowrap ${valueCellHighlight}`}>
                                {fmtMoney(r.valueOrPaid)}
                              </td>
                              {/* 7. الحركة / آجل */}
                              <td className="px-2 py-1.5 border-l border-slate-200 whitespace-nowrap text-slate-700">
                                {typeof r.movementOrRemaining === 'number'
                                  ? fmtMoney(r.movementOrRemaining)
                                  : r.movementOrRemaining}
                              </td>
                              {/* 8. الموظف */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center whitespace-nowrap">
                                {r.employeeName || '-'}
                              </td>
                              {/* 9. المستخدم */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center whitespace-nowrap">
                                {r.userName || '-'}
                              </td>
                              {/* 10. اليومية */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center font-mono whitespace-nowrap">
                                {r.businessDate}
                              </td>
                              {/* 11. الربح */}
                              {!isRepRole && (
                                <td
                                  className={`px-2 py-1.5 border-l border-slate-200 text-center font-mono font-bold whitespace-nowrap ${
                                    r.profit > 0
                                      ? 'text-emerald-700'
                                      : r.profit < 0
                                      ? 'text-rose-700'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {fmtMoney(r.profit)}
                                </td>
                              )}
                              {/* 12. الباركود */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center font-mono whitespace-nowrap text-slate-600">
                                {r.barcode || '-'}
                              </td>
                              {/* 13. ID */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center font-mono whitespace-nowrap text-slate-600">
                                {r.displayId}
                              </td>
                              {/* 14. رقم الفاتورة */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center font-mono font-bold text-blue-800 whitespace-nowrap">
                                {r.invoiceNumber || '-'}
                              </td>
                              {/* 15. الفرع */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center whitespace-nowrap">
                                {r.branchName}
                              </td>
                              {/* 16. الخزنة */}
                              {!isRepRole && (
                                <td className="px-2 py-1.5 border-l border-slate-200 text-center whitespace-nowrap">
                                  {r.cashboxName}
                                </td>
                              )}
                              {/* 17. ملاحظات */}
                              <td className="px-2 py-1.5 border-l border-slate-200 whitespace-nowrap text-slate-600">
                                {r.notes || ''}
                              </td>
                              {/* 18. الخصم */}
                              <td className="px-2 py-1.5 border-l border-slate-200 text-center font-mono whitespace-nowrap text-amber-800">
                                {r.discount ? fmtMoney(r.discount) : '0'}
                              </td>
                              {/* 19. نسبة الربح */}
                              {!isRepRole && (
                                <td className="px-2 py-1.5 text-center font-mono whitespace-nowrap font-bold text-slate-700">
                                  {r.profitPercent !== 0 ? `(${r.profitPercent}%)` : '(0%)'}
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}

                      {/* Section Total Row (الإجمالي) */}
                      <tr className="bg-[#e3e7ec] border-y-2 border-slate-400 font-black text-slate-900">
                        <td className="px-2 py-1.5 border-l border-slate-300">الإجمالي ({section.totals.count})</td>
                        <td className="px-2 py-1.5 border-l border-slate-300 text-center font-mono">{fmtNum(section.totals.quantity)}</td>
                        <td className="px-2 py-1.5 border-l border-slate-300" />
                        <td className="px-2 py-1.5 border-l border-slate-300" />
                        <td className="px-2 py-1.5 border-l border-slate-300 text-center font-mono">
                          {section.totals.priceOrTotal !== null ? fmtMoney(section.totals.priceOrTotal) : ''}
                        </td>
                        <td className="px-2 py-1.5 border-l border-slate-300 text-center font-mono bg-[#d4e8cb]">
                          {fmtMoney(section.totals.valueOrPaid)}
                        </td>
                        <td className="px-2 py-1.5 border-l border-slate-300 text-center font-mono">
                          {section.totals.remaining !== null ? fmtMoney(section.totals.remaining) : ''}
                        </td>
                        <td colSpan={3} className="px-2 py-1.5 border-l border-slate-300" />
                        {!isRepRole && (
                          <td className={`px-2 py-1.5 border-l border-slate-300 text-center font-mono ${section.totals.profit >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>
                            {fmtMoney(section.totals.profit)}
                          </td>
                        )}
                        <td colSpan={isRepRole ? 5 : 6} className="px-2 py-1.5 border-l border-slate-300" />
                        <td className="px-2 py-1.5 border-l border-slate-300 text-center font-mono">{fmtMoney(section.totals.discount)}</td>
                        {!isRepRole && (
                          <td className="px-2 py-1.5 text-center font-mono">({section.totals.profitPercent}%)</td>
                        )}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Optional Server-Side Pagination Controls */}
      {viewMode === 'unified_grid' && (reportData?.summary?.totalRows || 0) > 0 && (
        <div className="mt-1.5 bg-white border border-slate-300 rounded-md px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">حجم الصفحة:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="حجم الصفحة"
              className="h-8 bg-slate-50 border border-slate-300 rounded px-2 text-xs font-bold text-slate-800 outline-hidden"
            >
              <option value={0}>الكل ({reportData?.summary?.totalRows ?? 0})</option>
              <option value={50}>50 صف</option>
              <option value={100}>100 صف</option>
              <option value={200}>200 صف</option>
            </select>
          </div>
          {reportData?.pagination?.enabled && (
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-bold">
                صفحة {reportData.pagination.page} من {reportData.pagination.totalPages} (إجمالي: {reportData.pagination.totalRows})
              </span>
              <button
                type="button"
                disabled={!reportData.pagination.hasPrevPage || isLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 font-bold cursor-pointer"
              >
                السابق
              </button>
              <button
                type="button"
                disabled={!reportData.pagination.hasNextPage || isLoading}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 font-bold cursor-pointer"
              >
                التالي
              </button>
            </div>
          )}
        </div>
      )}

      {/* FIXED BOTTOM BAR: Cashbox Balances + Report Selector («نوع التقرير») + عرض التقرير */}
      <div className="mt-1.5 bg-[#eef0f3] border border-slate-400 rounded-md p-2 shadow-xs flex flex-wrap items-center justify-between gap-2">
        {/* 4 Summary Boxes matching Brand Store Reference (hidden financial/profit boxes for rep role) */}
        {!isRepRole ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 min-w-[280px]">
            <div className="bg-white border border-slate-300 rounded px-3 py-1.5 text-center shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-600">رصيد الدرج</span>
              <strong className="text-sm sm:text-base font-black font-mono text-slate-900">
                {fmtMoney(summary?.drawerBalance)}
              </strong>
            </div>

            <div className="bg-white border border-slate-300 rounded px-3 py-1.5 text-center shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-600">رصيد التقرير</span>
              <strong className={`text-sm sm:text-base font-black font-mono ${(summary?.reportBalance ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {fmtMoney(summary?.reportBalance)}
              </strong>
            </div>

            <div className="bg-white border border-slate-300 rounded px-3 py-1.5 text-center shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-600">مرحل من الأمس</span>
              <strong className="text-sm sm:text-base font-black font-mono text-blue-900">
                {fmtMoney(summary?.carriedFromYesterday)}
              </strong>
            </div>

            <div className="bg-white border border-slate-300 rounded px-3 py-1.5 text-center shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-600">ربح التقرير</span>
              <strong className={`text-sm sm:text-base font-black font-mono ${(summary?.reportProfit ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {fmtMoney(summary?.reportProfit)}
                <span className="text-[10px] text-slate-500 mr-1">({summary?.reportProfitPercent ?? 0}%)</span>
              </strong>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 flex-1 min-w-[240px]">
            <div className="bg-white border border-slate-300 rounded px-3 py-1.5 text-center shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-600">صافي المبيعات</span>
              <strong className="text-sm font-black font-mono text-emerald-700">
                {fmtMoney(summary?.filteredSalesNet)}
              </strong>
            </div>
            <div className="bg-white border border-slate-300 rounded px-3 py-1.5 text-center shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-600">عدد الحركات</span>
              <strong className="text-sm font-black font-mono text-blue-900">
                {summary?.totalRows ?? 0}
              </strong>
            </div>
          </div>
        )}

        {/* Single Unified Dropdown «نوع التقرير» with Exact Order & Dividers + عرض التقرير */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 relative" ref={dropdownRef}>
            <span className="text-xs font-extrabold text-slate-800 whitespace-nowrap">نوع التقرير</span>
            <button
              ref={reportDropdownBtnRef}
              type="button"
              onClick={() => setIsReportDropdownOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={isReportDropdownOpen}
              className="h-9 min-w-[230px] sm:min-w-[260px] bg-white border border-slate-400 rounded px-3 text-xs font-extrabold text-slate-900 flex items-center justify-between gap-2 shadow-2xs hover:border-emerald-600 cursor-pointer"
            >
              <span className="truncate">{activeReportOption.label}</span>
              {isReportDropdownOpen ? <ChevronUp className="w-4 h-4 text-slate-600" /> : <ChevronDown className="w-4 h-4 text-slate-600" />}
            </button>

            {isReportDropdownOpen &&
              typeof document !== 'undefined' &&
              ReactDOM.createPortal(
                <div
                  ref={reportDropdownPanelRef}
                  dir="rtl"
                  role="listbox"
                  aria-label="نوع التقرير"
                  style={{
                    position: 'fixed',
                    top: reportDropdownPos.top,
                    bottom: reportDropdownPos.bottom,
                    left: reportDropdownPos.left,
                    width: reportDropdownPos.width,
                    maxHeight: reportDropdownPos.maxHeight,
                    zIndex: 95,
                  }}
                  className="overflow-y-auto bg-white border border-slate-400 rounded-lg shadow-2xl py-1 text-right"
                >
                  {REPORT_TYPE_OPTIONS.map((opt, idx) => {
                    const prevGroup = idx > 0 ? REPORT_TYPE_OPTIONS[idx - 1].group : opt.group;
                    const showDivider = idx > 0 && opt.group !== prevGroup;
                    const isSelected = opt.key === reportType;
                    return (
                      <React.Fragment key={opt.key}>
                        {showDivider && <div className="my-1 border-t border-slate-300" role="separator" />}
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          data-report-type={opt.key}
                          onClick={() => {
                            setReportType(opt.key);
                            setPage(1);
                            setViewMode('unified_grid');
                            setIsReportDropdownOpen(false);
                          }}
                          className={`w-full text-right px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[#22b14c] text-white font-extrabold'
                              : 'text-slate-800 font-semibold hover:bg-emerald-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>,
                document.body
              )}
          </div>

          <button
            type="button"
            onClick={() => {
              setViewMode('unified_grid');
              loadReport();
            }}
            className="h-9 px-4 rounded bg-[#22b14c] hover:bg-[#1a963f] text-white font-black text-xs shadow-xs transition-colors cursor-pointer"
          >
            عرض التقرير
          </button>
        </div>
      </div>

      {/* Source Document Inspection Modal */}
      <SourceDocumentModal
        isOpen={sourceModalOpen}
        isLoading={sourceLoading}
        error={sourceError}
        data={sourceDoc}
        currency={currency}
        onClose={() => setSourceModalOpen(false)}
        onPrint={handlePrintSourceDoc}
      />

      {/* Print Preview Modal (A4 + 80mm + 58mm + PDF) */}
      <PrintDocumentModal
        isOpen={Boolean(printModalData)}
        onClose={() => setPrintModalData(null)}
        data={printModalData}
      />
    </div>
  );
};

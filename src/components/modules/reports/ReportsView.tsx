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
  History,
  Table2,
  Receipt,
  Calendar,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime, formatLocaleNumber } from '../../../i18n/translator';
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

const REPORT_TYPE_EN_LABELS: Record<ComprehensiveReportTypeKey, string> = {
  all: 'All',
  sales_items: 'Sales Items',
  sales_invoices: 'Sales Invoices',
  sales_items_by_unit: 'Sales Items / By Unit',
  sales_items_grouped: 'Sales Items / Grouped',
  sales_items_grouped_by_customer: 'Sales Items / By Customer',
  sales_items_grouped_by_category: 'Sales Items / By Category',
  sales_items_grouped_by_category_class1: 'Sales Items / By Category & Class 1',
  sales_return_items: 'Sales Return Items',
  sales_return_invoices: 'Sales Return Invoices',
  purchase_items: 'Purchase Items',
  purchase_invoices: 'Purchase Invoices',
  purchase_return_items: 'Purchase Return Items',
  purchase_return_invoices: 'Purchase Return Invoices',
  damaged_items: 'Damaged Items',
  damaged_invoices: 'Damaged Invoices',
  cash_payment: 'Cash Payment',
  cash_payment_customer: 'Cash Payment / Customer',
  cash_payment_supplier: 'Cash Payment / Supplier',
  cash_payment_employee: 'Cash Payment / Employee',
  cash_withdrawal: 'Cash Withdrawal',
  cash_withdrawal_customer: 'Cash Withdrawal / Customer',
  cash_withdrawal_supplier: 'Cash Withdrawal / Supplier',
};

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

const TABLE_COLUMNS: Array<{ key: SortColumnKey; label: string; labelEn: string; align?: 'right' | 'center' }> = [
  { key: 'operationLabel', label: 'العملية', labelEn: 'Operation', align: 'right' },
  { key: 'quantity', label: 'الكمية', labelEn: 'Qty', align: 'center' },
  { key: 'unit', label: 'الوحدة', labelEn: 'Unit', align: 'center' },
  { key: 'rawCreatedAt', label: 'التاريخ الفعلي', labelEn: 'Actual Date/Time', align: 'center' },
  { key: 'priceOrTotal', label: 'السعر', labelEn: 'Price', align: 'center' },
  { key: 'valueOrPaid', label: 'القيمة', labelEn: 'Value', align: 'center' },
  { key: 'movementOrRemaining', label: 'الحركة', labelEn: 'Movement / Balance', align: 'right' },
  { key: 'employeeName', label: 'الموظف', labelEn: 'Employee', align: 'center' },
  { key: 'userName', label: 'المستخدم', labelEn: 'User', align: 'center' },
  { key: 'businessDate', label: 'اليومية', labelEn: 'Business Date', align: 'center' },
  { key: 'profit', label: 'الربح', labelEn: 'Profit', align: 'center' },
  { key: 'barcode', label: 'الباركود', labelEn: 'Barcode', align: 'center' },
  { key: 'displayId', label: 'كود السجل', labelEn: 'Record ID', align: 'center' },
  { key: 'invoiceNumber', label: 'رقم الفاتورة', labelEn: 'Invoice #', align: 'center' },
  { key: 'branchName', label: 'الفرع', labelEn: 'Branch', align: 'center' },
  { key: 'cashboxName', label: 'الخزنة', labelEn: 'Cashbox', align: 'center' },
  { key: 'notes', label: 'ملاحظات', labelEn: 'Notes', align: 'right' },
  { key: 'discount', label: 'الخصم', labelEn: 'Discount', align: 'center' },
  { key: 'profitPercent', label: 'نسبة الربح', labelEn: 'Profit %', align: 'center' },
];

const fmtMoney = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '0';
  const n = Number(v);
  return Number.isInteger(n) ? formatLocaleNumber(n) : formatLocaleNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtNum = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '0';
  return formatLocaleNumber(Number(v), { maximumFractionDigits: 3 });
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
  const { t, dir, isRtl, language } = usePreferences();
  const isRepRole = currentUser?.role === 'representative';
  const visibleColumns = useMemo(
    () =>
      isRepRole
        ? TABLE_COLUMNS.filter((c) => c.key !== 'profit' && c.key !== 'profitPercent' && c.key !== 'cashboxName')
        : TABLE_COLUMNS,
    [isRepRole]
  );
  const visibleColSpan = visibleColumns.length;
  const currency = t(settings.currency || 'ج.م');

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
    let left = isRtl ? rect.right - width : rect.left;
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
  }, [isRtl]);

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
        setErrorMsg(err?.message ? t(err.message) : t('تعذر تحميل بيانات التقرير', 'Unable to load report data'));
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
      setSourceError(err?.message ? t(err.message) : t('تعذر فتح تفاصيل المستند الأصلي', 'Unable to open source document details'));
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
            cmp = String(av ?? '').localeCompare(String(bv ?? ''), language);
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
    REPORT_TYPE_OPTIONS.find((opt) => opt.key === reportType) || REPORT_TYPE_OPTIONS[0];
  const getReportOptionLabel = useCallback(
    (opt: ComprehensiveReportOption) => t(opt.label, REPORT_TYPE_EN_LABELS[opt.key]),
    [t]
  );

  const handleExportExcel = async () => {
    const sourceReport =
      exportScope === 'all' && (inlineTableSearch || reportType !== 'all')
        ? await fetchComprehensiveReport({ reportType: 'all' })
        : null;
    const secsToExport = sourceReport ? sourceReport.sections : processedSections;
    const sumToExport = sourceReport ? sourceReport.summary : reportData?.summary;

    const headers = visibleColumns.map((c) => t(c.label, c.labelEn));
    const rows: Array<Array<string | number>> = [];

    // Header info rows for Excel clarity
    rows.push([
      `AWLAD SELIM - ${settings.companyName}`,
      `${t('نوع التقرير:', 'Report Type:')} ${sourceReport ? t('الكل (شامل)', 'All (Comprehensive)') : getReportOptionLabel(activeReportOption)}`,
      `${t('الفترة:', 'Period:')} ${dateFrom || t('البداية', 'Start')} ${t('إلى', 'to')} ${useDateTo ? dateTo : t('الآن', 'Now')}`,
      `${t('تاريخ الاستخراج:', 'Exported At:')} ${formatLocaleDateTime(new Date())}`,
    ]);

    for (const sec of secsToExport) {
      rows.push([`=== ${t(sec.title)} (${sec.rows.length}) ===`]);
      if (sec.isInvoiceLayout) {
        rows.push(['', '', '', '', t('اجمالى', 'Total'), t('مدفوع', 'Paid'), t('آجل', 'Credit')]);
      }
      for (const r of sec.rows) {
        const baseRow: Array<string | number> = [
          t(r.operationLabel),
          r.quantity,
          t(r.unit),
          r.actualDateTime,
          r.priceOrTotal,
          r.valueOrPaid,
          typeof r.movementOrRemaining === 'string' ? t(r.movementOrRemaining) : r.movementOrRemaining,
          r.employeeName,
          r.userName,
          r.businessDate,
          ...(isRepRole ? [] : [r.profit]),
          r.barcode,
          r.displayId,
          r.invoiceNumber,
          t(r.branchName),
          ...(isRepRole ? [] : [t(r.cashboxName)]),
          r.notes,
          r.discount,
          ...(isRepRole ? [] : [`${r.profitPercent}%`]),
        ];
        rows.push(baseRow);
      }
      rows.push([
        t('الإجمالي', 'Total'),
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
      rows.push([
        t('رصيد الدرج', 'Drawer Balance'),
        sumToExport.drawerBalance,
        t('رصيد التقرير', 'Report Balance'),
        sumToExport.reportBalance,
        t('مرحل من الأمس', 'Carried Forward'),
        sumToExport.carriedFromYesterday,
        t('ربح التقرير', 'Report Profit'),
        sumToExport.reportProfit,
      ]);
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

    const headers = visibleColumns.map((c) => t(c.label, c.labelEn));
    const rows: Array<Array<string | number>> = [];
    for (const sec of secsToExport) {
      rows.push([
        `[ ${t(sec.title)} (${sec.totals.count}) ]`,
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
          t(r.operationLabel),
          fmtNum(r.quantity),
          t(r.unit),
          r.actualDateTime,
          fmtMoney(r.priceOrTotal),
          fmtMoney(r.valueOrPaid),
          typeof r.movementOrRemaining === 'number' ? fmtMoney(r.movementOrRemaining) : t(String(r.movementOrRemaining)),
          r.employeeName,
          r.userName,
          r.businessDate,
          ...(isRepRole ? [] : [fmtMoney(r.profit)]),
          r.barcode,
          r.displayId,
          r.invoiceNumber,
          t(r.branchName),
          ...(isRepRole ? [] : [t(r.cashboxName)]),
          r.notes,
          fmtMoney(r.discount),
          ...(isRepRole ? [] : [`${r.profitPercent}%`]),
        ]);
      }
    }

    exportTableToPdf(`${t('تقرير', 'Report')} ${sourceReport ? t('الكل (شامل)', 'All (Comprehensive)') : getReportOptionLabel(activeReportOption)}`, headers, rows, {
      companyName: settings.companyName || 'AWLAD SELIM — أولاد سليم',
      subtitle: t('نظام التقارير الشامل والموحد', 'Unified Comprehensive Reporting System'),
      dateRangeText: `${t('من:', 'From:')} ${dateFrom || t('البداية', 'Start')} ${t('إلى:', 'To:')} ${useDateTo ? dateTo : t('الآن', 'Now')}`,
      summaryPairs: sumToExport && !isRepRole
        ? [
            { label: t('رصيد الدرج', 'Drawer Balance'), value: `${fmtMoney(sumToExport.drawerBalance)} ${currency}` },
            { label: t('رصيد التقرير', 'Report Balance'), value: `${fmtMoney(sumToExport.reportBalance)} ${currency}` },
            { label: t('مرحل من الأمس', 'Carried Forward'), value: `${fmtMoney(sumToExport.carriedFromYesterday)} ${currency}` },
            { label: t('ربح التقرير', 'Report Profit'), value: `${fmtMoney(sumToExport.reportProfit)} ${currency}`, highlight: true },
          ]
        : sumToExport
        ? [
            { label: t('صافي المبيعات', 'Net Sales'), value: `${fmtMoney(sumToExport.filteredSalesNet)} ${currency}`, highlight: true },
            { label: t('عدد الحركات', 'Transactions Count'), value: String(sumToExport.totalRows ?? 0) },
          ]
        : [],
    });
  };

  const handleOpenThermalOrA4Print = () => {
    const items = processedSections.flatMap((sec) =>
      sec.rows.map((r) => ({
        name: `[${t(sec.title)}] ${t(r.operationLabel)}`,
        unit: t(r.unit),
        quantity: r.quantity,
        price: r.priceOrTotal,
        discount: r.discount,
        total: r.valueOrPaid,
      }))
    );
    setPrintModalData({
      title: `${t('تقرير', 'Report')} ${getReportOptionLabel(activeReportOption)}`,
      docNumber: `RPT-${todayYmd().replace(/-/g, '')}`,
      docType: 'كشف حساب',
      date: `${dateFrom || t('البداية', 'Start')} → ${useDateTo ? dateTo : t('الآن', 'Now')}`,
      partyName: `${t('تقرير:', 'Report:')} ${getReportOptionLabel(activeReportOption)}`,
      items,
      grandTotal: isRepRole ? (reportData?.summary.filteredSalesNet ?? 0) : (reportData?.summary.reportBalance ?? 0),
      paidAmount: isRepRole ? undefined : (reportData?.summary.drawerBalance ?? 0),
      remainingAmount: isRepRole ? undefined : (reportData?.summary.reportProfit ?? 0),
      notes: isRepRole
        ? `${t('صافي المبيعات:', 'Net Sales:')} ${fmtMoney(reportData?.summary.filteredSalesNet)} ${currency} | ${t('عدد الحركات:', 'Transactions:')} ${formatLocaleNumber(reportData?.summary.totalRows ?? 0)}`
        : `${t('مرحل من الأمس:', 'Carried Forward:')} ${fmtMoney(reportData?.summary.carriedFromYesterday)} ${currency} | ${t('ربح التقرير:', 'Report Profit:')} ${fmtMoney(reportData?.summary.reportProfit)} ${currency}`,
      tableHeaders: [t('م', '#'), t('القسم / العملية', 'Section / Operation'), t('الوحدة', 'Unit'), t('الكمية', 'Qty'), t('السعر', 'Price'), t('الخصم', 'Discount'), t('القيمة', 'Value')],
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
        badge: cb.type === 'bank' ? t('بنك', 'Bank') : t('خزنة', 'Cashbox'),
        searchText: cb.id,
      })),
    [filterOpts?.cashboxes, t]
  );

  // Strict separation: Employee options contain HR employees only
  const employeeOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.employees || []).map((emp) => ({
        value: emp.id,
        label: emp.name,
        subtitle: emp.jobTitle || t('موظف', 'Employee'),
        badge: emp.userId ? t('مرتبط بمستخدم', 'Linked User') : t('موظف', 'Employee'),
        searchText: `${emp.id} ${emp.jobTitle || ''} ${emp.identityId || ''}`,
      })),
    [filterOpts?.employees, t]
  );

  // Strict separation: User options contain system user accounts only
  const userOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.users || []).map((u) => ({
        value: u.id,
        label: u.fullName,
        subtitle: `@${u.username}`,
        badge: t(u.role),
        searchText: `${u.id} ${u.username} ${u.role} ${u.identityId || ''}`,
      })),
    [filterOpts?.users, t]
  );

  const representativeOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.representatives || []).map((r) => ({
        value: r.id,
        label: r.name,
        badge: r.identityId ? t('مندوب', 'Rep') : undefined,
        searchText: `${r.id} ${r.identityId || ''}`,
      })),
    [filterOpts?.representatives, t]
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
          badge: t('عميل', 'Customer'),
          groupLabel: t('العملاء', 'Customers'),
          searchText: `${c.id} ${c.phone || ''} عميل customer`,
        });
      }
    }
    if (filterVisibility.showSupplier) {
      for (const s of filterOpts?.suppliers || []) {
        list.push({
          value: `supplier:${s.id}`,
          label: s.name,
          subtitle: s.phone || undefined,
          badge: t('مورد', 'Supplier'),
          groupLabel: t('الموردون', 'Suppliers'),
          searchText: `${s.id} ${s.phone || ''} مورد supplier`,
        });
      }
    }
    return list;
  }, [filterOpts?.customers, filterOpts?.suppliers, filterVisibility.showCustomer, filterVisibility.showSupplier, t]);

  const productOptions = useMemo<SearchableFilterOption[]>(
    () =>
      (filterOpts?.products || []).map((p) => ({
        value: p.id,
        label: p.name,
        subtitle: [p.code ? `${t('كود:', 'Code:')} ${p.code}` : '', p.barcode ? `${t('باركود:', 'Barcode:')} ${p.barcode}` : '', p.category ? t(p.category) : '']
          .filter(Boolean)
          .join(' • '),
        badge: p.code || undefined,
        searchText: `${p.id} ${p.code || ''} ${p.barcode || ''} ${p.category || ''} ${p.size || ''} ${p.color || ''}`,
      })),
    [filterOpts?.products, t]
  );

  const movementTypeOptions = useMemo<SearchableFilterOption[]>(() => {
    const canViewPurchases = !isRepRole || hasPermission('canCreatePurchase') || hasPermission('canManagePurchases');
    const items: SearchableFilterOption[] = [
      { value: 'sales', label: t('مبيعات', 'Sales'), badge: t('بيع', 'Sale') },
      { value: 'sales_return', label: t('مرتجع بيع', 'Sales Return'), badge: t('مرتجع', 'Return') },
    ];
    if (canViewPurchases) {
      items.push(
        { value: 'purchase', label: t('مشتريات', 'Purchases'), badge: t('شراء', 'Buy') },
        { value: 'purchase_return', label: t('مرتجع شراء', 'Purchase Return'), badge: t('مرتجع', 'Return') }
      );
    }
    items.push(
      { value: 'damaged', label: t('تالف وهالك', 'Damaged & Waste'), badge: t('تالف', 'Damaged') },
      { value: 'cash_in', label: t('مقبوضات وسداد عملاء', 'Receipts & Customer Payments'), badge: t('وارد', 'In') },
      { value: 'cash_out', label: t('مدفوعات ومصروفات وسحب', 'Payments, Expenses & Withdrawals'), badge: t('صادر', 'Out') }
    );
    return items;
  }, [isRepRole, hasPermission, t]);

  return (
    <div className="flex-1 flex flex-col min-h-0 text-slate-900 dark:text-[#EEF4FC] select-none sm:select-text" dir={dir}>
      {/* Slim Top Mode + Quick Period Presets + Export Strip (Single Horizontal Row) */}
      <div className="bg-[#EEF3FA] dark:bg-[#132544] border border-slate-300 dark:border-[#21375C] border-b-slate-300/80 rounded-t-md px-2 py-1 awlad-filter-row justify-between">
        <div className="flex flex-nowrap items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('unified_grid')}
            className={`flex items-center gap-1 h-7 px-2.5 rounded-sm text-[11px] font-extrabold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              viewMode === 'unified_grid'
                ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white'
                : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] border border-slate-300 dark:border-[#2A436E] hover:bg-slate-100 dark:hover:bg-[#1A3461]'
            }`}
          >
            <Table2 className="w-3.5 h-3.5 shrink-0" />
            <span>{t('نظام التقارير التفصيلية الموحد', 'Unified Detailed Reports System')}</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('item_lifecycle')}
            className={`flex items-center gap-1 h-7 px-2.5 rounded-sm text-[11px] font-extrabold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              viewMode === 'item_lifecycle'
                ? 'bg-[var(--awlad-navy-900)] dark:bg-[#173C7E] text-white'
                : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] border border-slate-300 dark:border-[#2A436E] hover:bg-slate-100 dark:hover:bg-[#1A3461]'
            }`}
          >
            <History className="w-3.5 h-3.5 shrink-0" />
            <span>{t('تاريخ الصنف والأرباح والخسائر', 'Item History & Profit/Loss')}</span>
          </button>

          <div className="h-4 w-px bg-slate-300 dark:bg-[#2A436E] mx-0.5 shrink-0" />

          {/* Quick Period Presets */}
          <div className="flex flex-nowrap items-center gap-1 text-[11px] shrink-0">
            {[
              { id: 'today', label: t('تقرير اليوم', "Today's Report") },
              { id: 'this_month', label: t('الشهر الحالي', 'This Month') },
              { id: 'prev_month', label: t('الشهر السابق', 'Last Month') },
              { id: 'this_year', label: t('السنة الحالية', 'This Year') },
              { id: 'prev_year', label: t('السنة السابقة', 'Last Year') },
              { id: 'all_time', label: t('كل الفترات', 'All Periods') },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPeriodPreset(p.id as any)}
                className={`h-7 px-2 rounded-sm font-bold border whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  periodPreset === p.id
                    ? 'bg-[var(--awlad-navy-900)] dark:bg-[#1659C8] text-white border-[var(--awlad-navy-900)] dark:border-[#3B82F6]'
                    : 'bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] border-slate-300 dark:border-[#2A436E] hover:bg-[#DCE6F5] dark:hover:bg-[#1A3461]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Print & Export Strip */}
        <div className="flex flex-nowrap items-center gap-1 shrink-0">
          <select
            value={exportScope}
            onChange={(e) => setExportScope(e.target.value as 'filtered' | 'all')}
            aria-label={t('نطاق التصدير', 'Export Scope')}
            className="h-7 px-1.5 text-[11px] font-bold bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-sm text-slate-700 dark:text-[#EEF4FC] focus:border-[var(--awlad-royal-700)] focus:outline-none"
          >
            <option value="filtered">{t('تصدير المعروض المفلتر', 'Export Filtered View')}</option>
            <option value="all">{t('تصدير كامل التقرير', 'Export Full Report')}</option>
          </select>

          {canPrint && (
            <>
              <button
                type="button"
                onClick={handleOpenThermalOrA4Print}
                className="flex items-center gap-1 h-7 px-2 rounded-sm bg-[var(--awlad-silver-600)] hover:bg-slate-700 text-white text-[11px] font-bold cursor-pointer"
                title={t('طباعة A4 أو حراري 80/58 مم', 'Print A4 or Thermal 80/58mm')}
              >
                <Printer className="w-3 h-3" />
                <span>{t('طباعة', 'Print')}</span>
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="flex items-center gap-1 h-7 px-2 rounded-sm bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] text-white text-[11px] font-bold cursor-pointer"
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
              className="flex items-center gap-1 h-7 px-2 rounded-sm bg-[var(--awlad-navy-900)] hover:bg-[var(--awlad-navy-950)] text-white text-[11px] font-bold cursor-pointer"
            >
              <FileSpreadsheet className="w-3 h-3" />
              <span>Excel</span>
            </button>
          )}
        </div>
      </div>

      {/* Unified Single-Row Horizontal Filters Strip (All filters in ONE level, zero wrapping) */}
      <form
        onSubmit={handleApplySearchSubmit}
        aria-label={t('فلاتر البحث والتصفية للتقارير', 'Report Search & Filter Controls')}
        className="w-full bg-[#F8FAFC] dark:bg-[#0E1C36] border-x border-b border-slate-300 dark:border-[#21375C] px-2 py-1.5 text-xs"
      >
        <div className="awlad-filter-row pb-0.5" data-testid="reports-single-filter-row">
          {/* بحث عام */}
          <div className="relative w-[165px] shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#8CA3C7] absolute start-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="rpt-filter-search"
              type="text"
              aria-label={t('بحث عام', 'Global Search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('بحث عام (اسم / مستند / ملاحظات)...', 'Search (name / document / notes)...')}
              className="w-full h-8 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md ps-7 pe-2 text-xs text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-400 dark:placeholder:text-[#8CA3C7] focus:border-[var(--awlad-royal-700)] focus:outline-none"
            />
          </div>

          {/* زر بحث + إعادة ضبط */}
          <button
            type="submit"
            disabled={isLoading}
            className="h-8 px-2.5 rounded-md bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] disabled:opacity-60 text-white font-extrabold text-xs flex items-center justify-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span>{t('بحث', 'Search')}</span>
          </button>

          <button
            type="button"
            onClick={handleResetFilters}
            className="h-8 px-2 rounded-md bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300 hover:border-rose-300 text-slate-700 dark:text-[#DCE6F5] font-bold text-xs flex items-center justify-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            title={t('عرض الكل / إعادة ضبط الفلاتر', 'Show All / Reset Filters')}
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>{t('إعادة ضبط', 'Reset')}</span>
          </button>

          {/* من تاريخ (صف واحد موحد الارتفاع h-8) */}
          <div className="h-8 flex items-center gap-0.5 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-1 shrink-0">
            <Calendar className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF] shrink-0" />
            <span className="text-[10.5px] font-bold text-slate-500 dark:text-[#8CA3C7] whitespace-nowrap">{t('من', 'From')}</span>
            <button
              type="button"
              onClick={() => {
                setPeriodPreset('custom');
                setPage(1);
                setDateFrom((prev) => addDaysYmd(prev || todayYmd(), -1));
              }}
              className="h-6 w-5 shrink-0 bg-slate-100 dark:bg-[#132544] rounded hover:bg-[#EEF3FA] dark:hover:bg-[#1A3461] text-slate-700 dark:text-[#DCE6F5] font-bold leading-none cursor-pointer"
              title={t('يوم سابق', 'Previous Day')}
              aria-label={t('يوم سابق', 'Previous Day')}
            >
              -
            </button>
            <input
              id="rpt-filter-date-from"
              type="date"
              aria-label={t('من تاريخ', 'From Date')}
              value={dateFrom}
              onChange={(e) => {
                setPeriodPreset('custom');
                setPage(1);
                setDateFrom(e.target.value);
              }}
              className="h-6 w-[112px] bg-transparent border-0 px-0.5 text-[11px] font-mono tabular-nums text-slate-800 dark:text-[#EEF4FC] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setPeriodPreset('custom');
                setPage(1);
                setDateFrom((prev) => addDaysYmd(prev || todayYmd(), 1));
              }}
              className="h-6 w-5 shrink-0 bg-slate-100 dark:bg-[#132544] rounded hover:bg-[#EEF3FA] dark:hover:bg-[#1A3461] text-slate-700 dark:text-[#DCE6F5] font-bold leading-none cursor-pointer"
              title={t('يوم تالٍ', 'Next Day')}
              aria-label={t('يوم تالٍ', 'Next Day')}
            >
              +
            </button>
          </div>

          {/* إلى تاريخ (صف واحد موحد الارتفاع h-8) */}
          <div className="h-8 flex items-center gap-1 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-1.5 shrink-0">
            <label htmlFor="rpt-filter-use-date-to" className="flex items-center gap-1 text-[10.5px] font-bold text-slate-600 dark:text-[#A9BCD9] cursor-pointer whitespace-nowrap">
              <input
                id="rpt-filter-use-date-to"
                type="checkbox"
                checked={useDateTo}
                onChange={(e) => {
                  setPeriodPreset('custom');
                  setPage(1);
                  setUseDateTo(e.target.checked);
                }}
                className="accent-[var(--awlad-royal-700)] w-3.5 h-3.5 shrink-0"
              />
              <span>{t('إلى', 'To')}</span>
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
              aria-label={t('إلى تاريخ', 'To Date')}
              className="h-6 w-[112px] bg-transparent border-0 px-0.5 text-[11px] font-mono tabular-nums text-slate-800 dark:text-[#EEF4FC] disabled:opacity-45 focus:outline-none"
            />
          </div>

          {/* نوع التقرير ضمن نفس الصف الأفقي */}
          <select
            id="rpt-filter-report-type"
            aria-label={t('نوع التقرير', 'Report Type')}
            value={reportType}
            onChange={(e) => {
              setReportType(e.target.value as ComprehensiveReportTypeKey);
              setPage(1);
              setViewMode('unified_grid');
            }}
            className="h-8 w-[145px] shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-extrabold text-[var(--awlad-navy-950)] dark:text-[#EEF4FC] focus:border-[var(--awlad-royal-700)] focus:outline-none"
          >
            {REPORT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.key === 'all' ? t('نوع التقرير: الكل', 'Report Type: All') : t(opt.label, REPORT_TYPE_EN_LABELS[opt.key] || opt.label)}
              </option>
            ))}
          </select>

          {/* الفرع */}
          <div className="w-[125px] shrink-0">
            <SearchableFilterSelect
              id="rpt-filter-branch"
              inlinePrefix={t('الفرع', 'Branch')}
              value={branchId}
              onChange={(val) => {
                setBranchId(val);
                setPage(1);
              }}
              options={branchOptions}
              allOptionLabel={t('كل الفروع', 'All Branches')}
              allowClear
            />
          </div>

          {/* العميل / المورد */}
          {filterVisibility.showParty && (
            <div className="w-[155px] shrink-0">
              <SearchableFilterSelect
                id="rpt-filter-party"
                inlinePrefix={filterVisibility.showSupplier ? t('الطرف', 'Party') : t('العميل', 'Customer')}
                value={partyKey}
                onChange={(val) => {
                  setPartyKey(val);
                  setPage(1);
                }}
                options={partyOptions}
                allOptionLabel={t('كل العملاء والموردين', 'All Customers & Suppliers')}
                searchPlaceholder={t('ابحث باسم العميل أو المورد أو الهاتف...', 'Search by customer, supplier, or phone...')}
                allowClear
                minPanelWidth={280}
              />
            </div>
          )}

          {/* نوع الحركة */}
          {filterVisibility.showMovementType && (
            <div className="w-[130px] shrink-0">
              <SearchableFilterSelect
                id="rpt-filter-movement-type"
                inlinePrefix={t('الحركة', 'Movement')}
                value={movementType}
                onChange={(val) => {
                  setMovementType((val as ReportMovementTypeKey) || 'all');
                  setPage(1);
                }}
                options={movementTypeOptions}
                allOptionLabel={t('كل الحركات', 'All Movements')}
                allowClear
              />
            </div>
          )}

          {filterVisibility.showWarehouse && (
            <div className="w-[130px] shrink-0">
              <SearchableFilterSelect
                id="rpt-filter-warehouse"
                inlinePrefix={t('المخزن', 'Warehouse')}
                value={warehouseId}
                onChange={(val) => {
                  setWarehouseId(val);
                  setPage(1);
                }}
                options={warehouseOptions}
                allOptionLabel={t('كل المخازن', 'All Warehouses')}
                allowClear
              />
            </div>
          )}

          {filterVisibility.showCashbox && (
            <div className="w-[130px] shrink-0">
              <SearchableFilterSelect
                id="rpt-filter-cashbox"
                inlinePrefix={t('الخزنة', 'Cashbox')}
                value={cashboxId}
                onChange={(val) => {
                  setCashboxId(val);
                  setPage(1);
                }}
                options={cashboxOptions}
                allOptionLabel={t('كل الخزائن', 'All Cashboxes')}
                allowClear
              />
            </div>
          )}

          {filterVisibility.showRepresentative && (
            <div className="w-[130px] shrink-0">
              <SearchableFilterSelect
                id="rpt-filter-rep"
                inlinePrefix={t('المندوب', 'Rep')}
                value={representativeId}
                onChange={(val) => {
                  setRepresentativeId(val);
                  setPage(1);
                }}
                options={representativeOptions}
                allOptionLabel={t('كل المندوبين', 'All Representatives')}
                allowClear
              />
            </div>
          )}

          {filterVisibility.showEmployee && (
            <div className="w-[130px] shrink-0">
              <SearchableFilterSelect
                id="rpt-filter-employee"
                inlinePrefix={t('الموظف', 'Employee')}
                value={employeeId}
                onChange={(val) => {
                  setEmployeeId(val);
                  setPage(1);
                }}
                options={employeeOptions}
                allOptionLabel={t('كل الموظفين', 'All Employees')}
                searchPlaceholder={t('بحث في الموظفين...', 'Search employees...')}
                allowClear
              />
            </div>
          )}

          {filterVisibility.showUser && (
            <div className="w-[135px] shrink-0">
              <SearchableFilterSelect
                id="rpt-filter-user"
                inlinePrefix={t('المستخدم', 'User')}
                value={userId}
                onChange={(val) => {
                  setUserId(val);
                  setPage(1);
                }}
                options={userOptions}
                allOptionLabel={t('كل المستخدمين', 'All Users')}
                searchPlaceholder={t('بحث في حسابات المستخدمين...', 'Search user accounts...')}
                allowClear
              />
            </div>
          )}

          {filterVisibility.showProductFilters && (
            <>
              <div className="w-[140px] shrink-0">
                <SearchableFilterSelect
                  id="rpt-filter-product"
                  inlinePrefix={t('الصنف', 'Product')}
                  value={productId}
                  onChange={(val) => {
                    setProductId(val);
                    setPage(1);
                  }}
                  options={productOptions}
                  allOptionLabel={t('كل الأصناف', 'All Products')}
                  searchPlaceholder={t('ابحث بالاسم أو الكود أو الباركود...', 'Search by name, code, or barcode...')}
                  allowClear
                  minPanelWidth={290}
                />
              </div>

              {productId !== 'all' && viewMode === 'unified_grid' && (
                <button
                  type="button"
                  onClick={() => setViewMode('item_lifecycle')}
                  className="h-8 px-2 rounded-md border border-[#DCE6F5] bg-[#EEF3FA] text-[11px] font-bold text-[var(--awlad-royal-700)] hover:bg-[#DCE6F5] whitespace-nowrap shrink-0 cursor-pointer"
                  title={t('عرض تاريخ وربح الصنف', 'View Item History & Profit')}
                >
                  {t('تاريخ الصنف', 'Item History')}
                </button>
              )}

              <input
                id="rpt-filter-product-search"
                type="text"
                aria-label={t('اسم الصنف', 'Product Name')}
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder={t('اسم الصنف...', 'Product name...')}
                className="w-[110px] shrink-0 h-8 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-400 focus:border-[var(--awlad-royal-700)] focus:outline-none"
              />

              <input
                id="rpt-filter-barcode"
                type="text"
                aria-label={t('الباركود', 'Barcode')}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder={t('الباركود...', 'Barcode...')}
                className="w-[100px] shrink-0 h-8 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-mono tabular-nums text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-400 focus:border-[var(--awlad-royal-700)] focus:outline-none"
              />
            </>
          )}

          {filterVisibility.showInvoiceNumber && (
            <input
              id="rpt-filter-invoice-no"
              type="text"
              aria-label={t('رقم الفاتورة', 'Invoice No.')}
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder={t('رقم الفاتورة...', 'Invoice No...')}
              className="w-[100px] shrink-0 h-8 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-mono tabular-nums text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-400 focus:border-[var(--awlad-royal-700)] focus:outline-none"
            />
          )}

          {filterVisibility.showRecordId && (
            <input
              id="rpt-filter-record-id"
              type="text"
              aria-label={t('كود السجل', 'Record ID')}
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              placeholder={t('كود السجل...', 'Record ID...')}
              className="w-[95px] shrink-0 h-8 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-mono tabular-nums text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-400 focus:border-[var(--awlad-royal-700)] focus:outline-none"
            />
          )}
        </div>
      </form>

      {/* Error State */}
      {errorMsg && (
        <div className="mt-1 p-2 rounded-sm bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
          {errorMsg}
        </div>
      )}

      {/* MAIN CONTENT: Stretches via flex-1 to eliminate bottom viewport whitespace */}
      {viewMode === 'item_lifecycle' && reportData ? (
        <div className="mt-1.5 flex-1 flex flex-col min-h-0">
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
        <div className="flex-1 flex flex-col min-h-[260px] bg-white dark:bg-[#0E1C36] border border-t-0 border-slate-300 dark:border-[#21375C] rounded-b-lg overflow-hidden">
          {/* Unified Logo Navy Header Strip: عرض + in-table search */}
          <div className="bg-[var(--awlad-navy-900)] text-white px-2.5 py-1 flex flex-nowrap items-center justify-between gap-2 text-xs font-extrabold overflow-x-auto">
            <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
              <span>{t('عرض', 'View')} — {t(activeReportOption.label, REPORT_TYPE_EN_LABELS[activeReportOption.key] || activeReportOption.label)}</span>
              <span className="bg-white/15 px-1.5 py-0.5 rounded font-mono text-[11px] tabular-nums">
                {formatLocaleNumber(processedSections.reduce((s, sec) => s + sec.rows.length, 0))} {t('حركة', 'entries')}
              </span>
              {isLoading && <span className="text-[11px] opacity-90">{t('جاري التحديث...', 'Updating...')}</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="text"
                value={inlineTableSearch}
                onChange={(e) => setInlineTableSearch(e.target.value)}
                placeholder={t('تصفية سريعة داخل الجدول...', 'Quick filter in table...')}
                className="h-7 px-2 rounded-md bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] placeholder-slate-400 dark:placeholder-[#849BBF] border border-transparent dark:border-[#2A436E] text-[11px] font-normal w-40 sm:w-48 shrink-0 focus:outline-none"
              />
            </div>
          </div>

          {/* Scrollable 19-Column Table Container (flex-1 eliminates artificial height cap / dead void) */}
          <div className="flex-1 overflow-auto bg-white dark:bg-[#0E1C36]">
            <table className="w-full border-collapse text-[11.5px] min-w-[1680px]">
              <thead className="sticky top-0 z-20 bg-[var(--awlad-navy-950)] text-white border-b border-[var(--awlad-blue-800)]">
                <tr>
                  {visibleColumns.map((col, idx) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`px-2 py-1.5 border-e border-[var(--awlad-blue-800)] font-extrabold whitespace-nowrap cursor-pointer hover:bg-[var(--awlad-navy-900)] transition-colors ${
                        col.align === 'center' ? 'text-center' : 'text-start'
                      } ${idx === 0 ? `sticky ${isRtl ? 'right-0' : 'left-0'} z-30 bg-[var(--awlad-navy-950)]` : ''}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <span>{t(col.label, col.labelEn)}</span>
                        <ArrowUpDown className={`w-3 h-3 ${sortCol === col.key ? 'text-blue-200' : 'text-blue-200/70'}`} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {processedSections.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={visibleColSpan} className="p-6 text-center text-slate-500 font-bold text-xs">
                      {t('لا توجد حركات مطابقة لمعايير البحث والتصفية الحالية.', 'No entries match the current search and filter criteria.')}
                    </td>
                  </tr>
                )}

                {processedSections.map((section) => {
                  const isSlate = section.theme === 'slate';
                  const headerBg = isSlate
                    ? 'bg-[var(--awlad-silver-600)] text-white'
                    : 'bg-[var(--awlad-royal-700)] text-white';

                  return (
                    <React.Fragment key={section.key}>
                      {/* Section Header Banner Row */}
                      <tr className={`${headerBg} font-extrabold text-xs`}>
                        <td colSpan={visibleColSpan} className="px-3 py-1.5 border-y border-slate-300">
                          <div className="flex items-center justify-between">
                            <span>{t(section.title)}</span>
                            <span className="text-[11px] opacity-90 font-mono">({formatLocaleNumber(section.rows.length)})</span>
                          </div>
                        </td>
                      </tr>

                      {/* Secondary Sub-header for Invoice Sections (اجمالى / مدفوع / آجل) */}
                      {section.isInvoiceLayout && (
                        <tr className="bg-[#EEF3FA] dark:bg-[#132544] text-[var(--awlad-navy-950)] dark:text-[#EEF4FC] font-bold text-[11px] border-b border-slate-300 dark:border-[#21375C]">
                          <td className={`sticky ${isRtl ? 'right-0' : 'left-0'} z-10 bg-[#EEF3FA] dark:bg-[#132544] px-2 py-1 border-e border-slate-300 dark:border-[#21375C]`} />
                          <td className="px-2 py-1 border-e border-slate-300 dark:border-[#21375C]" />
                          <td className="px-2 py-1 border-e border-slate-300 dark:border-[#21375C]" />
                          <td className="px-2 py-1 border-e border-slate-300 dark:border-[#21375C]" />
                          <td className="px-2 py-1 border-e border-slate-300 dark:border-[#21375C] text-center bg-[#DCE6F5] dark:bg-[#1A3461]">{t('اجمالى', 'Total')}</td>
                          <td className="px-2 py-1 border-e border-slate-300 dark:border-[#21375C] text-center bg-[#DCE6F5] dark:bg-[#1A3461]">{t('مدفوع', 'Paid')}</td>
                          <td className="px-2 py-1 border-e border-slate-300 dark:border-[#21375C] text-center bg-[#DCE6F5] dark:bg-[#1A3461]">{t('آجل', 'Credit')}</td>
                          <td colSpan={isRepRole ? 9 : 12} className="px-2 py-1" />
                        </tr>
                      )}

                      {/* Data Rows */}
                      {section.rows.length === 0 ? (
                        <tr className="bg-slate-50 dark:bg-[#0E1C36] text-slate-400 dark:text-[#8DA2C5]">
                          <td colSpan={visibleColSpan} className="px-3 py-3 text-center text-xs">
                            {t(`لا توجد سجلات في قسم (${section.title}) ضمن هذه الفترة`, `No records in (${t(section.title)}) for this period`)}
                          </td>
                        </tr>
                      ) : (
                        section.rows.map((r) => {
                          const rowBg =
                            r.rowTone === 'invoice_blue'
                              ? 'bg-[#EEF3FA] hover:bg-[#DCE6F5] dark:bg-[#132544] dark:hover:bg-[#1A3461]'
                              : r.rowTone === 'warning_rose'
                              ? 'bg-[#fff5f6] hover:bg-[#ffe8eb] dark:bg-[#2A1420] dark:hover:bg-[#3A1C2B]'
                              : 'bg-white hover:bg-slate-50 dark:bg-[#0E1C36] dark:hover:bg-[#132544]';
                          const stickyCellBg =
                            r.rowTone === 'invoice_blue'
                              ? 'bg-[#EEF3FA] dark:bg-[#132544]'
                              : r.rowTone === 'warning_rose'
                              ? 'bg-[#fff5f6] dark:bg-[#2A1420]'
                              : 'bg-white dark:bg-[#0E1C36]';

                          const valueCellHighlight = section.cashHighlightCol
                            ? 'bg-[#EEF3FA] dark:bg-[#172E56] font-black text-[var(--awlad-navy-950)] dark:text-[#EEF4FC]'
                            : 'font-bold text-slate-900 dark:text-[#EEF4FC]';

                          return (
                            <tr
                              key={r.rowId}
                              onClick={() => handleInspectDocument(r.docType, r.docId)}
                              title={t('اضغط لعرض المستند الأصلي والتدقيق', 'Click to view original document & audit')}
                              className={`${rowBg} border-b border-slate-200 dark:border-[#21375C] transition-colors cursor-pointer`}
                            >
                              {/* 1. العملية (مثبت أفقياً على الشاشات الصغيرة) */}
                              <td className={`sticky ${isRtl ? 'right-0' : 'left-0'} z-10 ${stickyCellBg} px-2 py-1.5 border-e border-slate-200 dark:border-[#21375C] font-bold text-slate-900 dark:text-[#EEF4FC] whitespace-nowrap`}>
                                <span className="inline-flex items-center gap-1">
                                  <Receipt className="w-3 h-3 text-[var(--awlad-silver-600)] shrink-0" />
                                  <span>{t(r.operationLabel)}</span>
                                </span>
                              </td>
                              {/* 2. الكمية */}
                              <td className="px-2 py-1.5 border-e border-slate-200 dark:border-[#21375C] text-center font-mono font-bold whitespace-nowrap">
                                {fmtNum(r.quantity)}
                              </td>
                              {/* 3. الوحدة */}
                              <td className="px-2 py-1.5 border-e border-slate-200 dark:border-[#21375C] text-center whitespace-nowrap">
                                {r.unit ? t(r.unit) : ''}
                              </td>
                              {/* 4. التاريخ الفعلي */}
                              <td className="px-2 py-1.5 border-e border-slate-200 dark:border-[#21375C] text-center font-mono text-[11px] whitespace-nowrap text-slate-700 dark:text-[#CBD9EE]">
                                {r.actualDateTime}
                              </td>
                              {/* 5. السعر / اجمالى */}
                              <td className="px-2 py-1.5 border-e border-slate-200 text-center font-mono whitespace-nowrap">
                                {fmtMoney(r.priceOrTotal)}
                              </td>
                              {/* 6. القيمة / مدفوع */}
                              <td className={`px-2 py-1.5 border-e border-slate-200 text-center font-mono whitespace-nowrap ${valueCellHighlight}`}>
                                {fmtMoney(r.valueOrPaid)}
                              </td>
                              {/* 7. الحركة / آجل */}
                              <td className="px-2 py-1.5 border-e border-slate-200 whitespace-nowrap text-slate-700">
                                {typeof r.movementOrRemaining === 'number'
                                  ? fmtMoney(r.movementOrRemaining)
                                  : typeof r.movementOrRemaining === 'string'
                                  ? t(r.movementOrRemaining)
                                  : r.movementOrRemaining}
                              </td>
                              {/* 8. الموظف */}
                              <td className="px-2 py-1.5 border-e border-slate-200 text-center whitespace-nowrap">
                                {r.employeeName || '-'}
                              </td>
                              {/* 9. المستخدم */}
                              <td className="px-2 py-1.5 border-e border-slate-200 text-center whitespace-nowrap">
                                {r.userName || '-'}
                              </td>
                              {/* 10. اليومية */}
                              <td className="px-2 py-1.5 border-e border-slate-200 text-center font-mono whitespace-nowrap">
                                {r.businessDate}
                              </td>
                              {/* 11. الربح (لون دلالي للقيمة الموجبة/السايبة) */}
                              {!isRepRole && (
                                <td
                                  className={`px-2 py-1.5 border-e border-slate-200 text-center font-mono font-bold whitespace-nowrap ${
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
                              <td className="px-2 py-1.5 border-e border-slate-200 text-center font-mono whitespace-nowrap text-slate-600">
                                {r.barcode || '-'}
                              </td>
                              {/* 13. ID */}
                              <td className="px-2 py-1.5 border-e border-slate-200 text-center font-mono whitespace-nowrap text-slate-600">
                                {r.displayId}
                              </td>
                              {/* 14. رقم الفاتورة */}
                              <td className="px-2 py-1.5 border-e border-slate-200 text-center font-mono font-bold text-[var(--awlad-royal-700)] whitespace-nowrap">
                                {r.invoiceNumber || '-'}
                              </td>
                              {/* 15. الفرع */}
                              <td className="px-2 py-1.5 border-e border-slate-200 text-center whitespace-nowrap">
                                {r.branchName ? t(r.branchName) : '-'}
                              </td>
                              {/* 16. الخزنة */}
                              {!isRepRole && (
                                <td className="px-2 py-1.5 border-e border-slate-200 text-center whitespace-nowrap">
                                  {r.cashboxName ? t(r.cashboxName) : '-'}
                                </td>
                              )}
                              {/* 17. ملاحظات */}
                              <td className="px-2 py-1.5 border-e border-slate-200 whitespace-nowrap text-slate-600">
                                {r.notes || ''}
                              </td>
                              {/* 18. الخصم */}
                              <td className="px-2 py-1.5 border-e border-slate-200 text-center font-mono whitespace-nowrap text-amber-800">
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
                      <tr className="bg-[#EEF3FA] dark:bg-[#132544] border-y-2 border-slate-300 dark:border-[#2A436E] font-black text-[var(--awlad-navy-950)] dark:text-[#EEF4FC]">
                        <td className={`sticky ${isRtl ? 'right-0' : 'left-0'} z-10 bg-[#EEF3FA] dark:bg-[#132544] px-2 py-1.5 border-e border-slate-300 dark:border-[#2A436E]`}>
                          {t('الإجمالي', 'Total')} ({formatLocaleNumber(section.totals.count)})
                        </td>
                        <td className="px-2 py-1.5 border-e border-slate-300 dark:border-[#2A436E] text-center font-mono">{fmtNum(section.totals.quantity)}</td>
                        <td className="px-2 py-1.5 border-e border-slate-300 dark:border-[#2A436E]" />
                        <td className="px-2 py-1.5 border-e border-slate-300 dark:border-[#2A436E]" />
                        <td className="px-2 py-1.5 border-e border-slate-300 dark:border-[#2A436E] text-center font-mono">
                          {section.totals.priceOrTotal !== null ? fmtMoney(section.totals.priceOrTotal) : ''}
                        </td>
                        <td className="px-2 py-1.5 border-e border-slate-300 dark:border-[#2A436E] text-center font-mono bg-[#DCE6F5] dark:bg-[#1A3461] text-[var(--awlad-navy-950)] dark:text-[#EEF4FC]">
                          {fmtMoney(section.totals.valueOrPaid)}
                        </td>
                        <td className="px-2 py-1.5 border-e border-slate-300 text-center font-mono">
                          {section.totals.remaining !== null ? fmtMoney(section.totals.remaining) : ''}
                        </td>
                        <td colSpan={3} className="px-2 py-1.5 border-e border-slate-300" />
                        {!isRepRole && (
                          <td className={`px-2 py-1.5 border-e border-slate-300 text-center font-mono ${section.totals.profit >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>
                            {fmtMoney(section.totals.profit)}
                          </td>
                        )}
                        <td colSpan={isRepRole ? 5 : 6} className="px-2 py-1.5 border-e border-slate-300" />
                        <td className="px-2 py-1.5 border-e border-slate-300 text-center font-mono">{fmtMoney(section.totals.discount)}</td>
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
            <span className="font-bold text-slate-700">{t('حجم الصفحة:', 'Page Size:')}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label={t('حجم الصفحة', 'Page Size')}
              className="h-8 bg-slate-50 border border-slate-300 rounded px-2 text-xs font-bold text-slate-800 outline-hidden"
            >
              <option value={0}>{t('الكل', 'All')} ({formatLocaleNumber(reportData?.summary?.totalRows ?? 0)})</option>
              <option value={50}>{formatLocaleNumber(50)} {t('صف', 'rows')}</option>
              <option value={100}>{formatLocaleNumber(100)} {t('صف', 'rows')}</option>
              <option value={200}>{formatLocaleNumber(200)} {t('صف', 'rows')}</option>
            </select>
          </div>
          {reportData?.pagination?.enabled && (
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-bold">
                {t('صفحة', 'Page')} {formatLocaleNumber(reportData.pagination.page)} {t('من', 'of')} {formatLocaleNumber(reportData.pagination.totalPages)} ({t('إجمالي:', 'Total:')} {formatLocaleNumber(reportData.pagination.totalRows)})
              </span>
              <button
                type="button"
                disabled={!reportData.pagination.hasPrevPage || isLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 font-bold cursor-pointer"
              >
                {t('السابق', 'Previous')}
              </button>
              <button
                type="button"
                disabled={!reportData.pagination.hasNextPage || isLoading}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 font-bold cursor-pointer"
              >
                {t('التالي', 'Next')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* FIXED BOTTOM BAR: Cashbox Balances + Report Selector («نوع التقرير») + عرض التقرير */}
      <div className="mt-1.5 bg-[#EEF3FA] dark:bg-[#132544] border border-slate-300 dark:border-[#21375C] rounded-md p-1.5 flex flex-wrap items-center justify-between gap-2">
        {/* 4 Summary Boxes */}
        {!isRepRole ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 flex-1 min-w-0 sm:min-w-[280px]">
            <div className="bg-white dark:bg-[#0E1C36] border border-slate-300 dark:border-[#21375C] rounded px-2.5 py-1 text-center">
              <span className="block text-[10px] font-bold text-slate-600 dark:text-[#97AECE]">{t('رصيد الدرج', 'Drawer Balance')}</span>
              <strong className="text-xs sm:text-sm font-black font-mono text-[var(--awlad-navy-950)] dark:text-[#EEF4FC] tabular-nums">
                {fmtMoney(summary?.drawerBalance)}
              </strong>
            </div>

            <div className="bg-white dark:bg-[#0E1C36] border border-slate-300 dark:border-[#21375C] rounded px-2.5 py-1 text-center">
              <span className="block text-[10px] font-bold text-slate-600 dark:text-[#97AECE]">{t('رصيد التقرير', 'Report Balance')}</span>
              <strong className={`text-xs sm:text-sm font-black font-mono tabular-nums ${(summary?.reportBalance ?? 0) >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                {fmtMoney(summary?.reportBalance)}
              </strong>
            </div>

            <div className="bg-white dark:bg-[#0E1C36] border border-slate-300 dark:border-[#21375C] rounded px-2.5 py-1 text-center">
              <span className="block text-[10px] font-bold text-slate-600 dark:text-[#97AECE]">{t('مرحل من الأمس', 'Carried Over')}</span>
              <strong className="text-xs sm:text-sm font-black font-mono text-[var(--awlad-navy-900)] dark:text-[#85B8FF] tabular-nums">
                {fmtMoney(summary?.carriedFromYesterday)}
              </strong>
            </div>

            <div className="bg-white dark:bg-[#0E1C36] border border-slate-300 dark:border-[#21375C] rounded px-2.5 py-1 text-center">
              <span className="block text-[10px] font-bold text-slate-600 dark:text-[#97AECE]">{t('ربح التقرير', 'Report Profit')}</span>
              <strong className={`text-xs sm:text-sm font-black font-mono tabular-nums ${(summary?.reportProfit ?? 0) >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                {fmtMoney(summary?.reportProfit)}
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] ms-1">({summary?.reportProfitPercent ?? 0}%)</span>
              </strong>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 flex-1 min-w-0 sm:min-w-[240px]">
            <div className="bg-white dark:bg-[#0E1C36] border border-slate-300 dark:border-[#21375C] rounded px-2.5 py-1 text-center">
              <span className="block text-[10px] font-bold text-slate-600 dark:text-[#97AECE]">{t('صافي المبيعات', 'Net Sales')}</span>
              <strong className="text-xs sm:text-sm font-black font-mono text-[var(--awlad-royal-700)] dark:text-[#85B8FF] tabular-nums">
                {fmtMoney(summary?.filteredSalesNet)}
              </strong>
            </div>
            <div className="bg-white dark:bg-[#0E1C36] border border-slate-300 dark:border-[#21375C] rounded px-2.5 py-1 text-center">
              <span className="block text-[10px] font-bold text-slate-600 dark:text-[#97AECE]">{t('عدد الحركات', 'Entries Count')}</span>
              <strong className="text-xs sm:text-sm font-black font-mono text-[var(--awlad-navy-900)] dark:text-[#EEF4FC] tabular-nums">
                {formatLocaleNumber(summary?.totalRows ?? 0)}
              </strong>
            </div>
          </div>
        )}

        {/* Single Unified Dropdown «نوع التقرير» + عرض التقرير */}
        <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto">
          <div className="flex items-center gap-1.5 relative flex-1 min-w-0 sm:flex-initial" ref={dropdownRef}>
            <span className="text-xs font-extrabold text-[var(--awlad-navy-950)] dark:text-[#EEF4FC] whitespace-nowrap">{t('نوع التقرير', 'Report Type')}</span>
            <button
              ref={reportDropdownBtnRef}
              type="button"
              onClick={() => setIsReportDropdownOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={isReportDropdownOpen}
              className="h-8 min-w-0 flex-1 sm:min-w-[230px] bg-white dark:bg-[#10203D] border border-slate-400 dark:border-[#2A436E] rounded px-2.5 text-xs font-extrabold text-slate-900 dark:text-[#EEF4FC] flex items-center justify-between gap-2 hover:border-[var(--awlad-royal-700)] cursor-pointer"
            >
              <span className="truncate">{t(activeReportOption.label, REPORT_TYPE_EN_LABELS[activeReportOption.key] || activeReportOption.label)}</span>
              {isReportDropdownOpen ? <ChevronUp className="w-4 h-4 text-slate-600 dark:text-[#97AECE] shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-600 dark:text-[#97AECE] shrink-0" />}
            </button>

            {isReportDropdownOpen &&
              typeof document !== 'undefined' &&
              ReactDOM.createPortal(
                <div
                  ref={reportDropdownPanelRef}
                  dir={dir}
                  role="listbox"
                  aria-label={t('نوع التقرير', 'Report Type')}
                  style={{
                    position: 'fixed',
                    top: reportDropdownPos.top,
                    bottom: reportDropdownPos.bottom,
                    left: reportDropdownPos.left,
                    width: reportDropdownPos.width,
                    maxHeight: reportDropdownPos.maxHeight,
                    zIndex: 95,
                  }}
                  className="overflow-y-auto bg-white dark:bg-[#0E1C36] border border-slate-400 dark:border-[#2A436E] rounded-lg shadow-2xl py-1 text-start"
                >
                  {REPORT_TYPE_OPTIONS.map((opt, idx) => {
                    const prevGroup = idx > 0 ? REPORT_TYPE_OPTIONS[idx - 1].group : opt.group;
                    const showDivider = idx > 0 && opt.group !== prevGroup;
                    const isSelected = opt.key === reportType;
                    return (
                      <React.Fragment key={opt.key}>
                        {showDivider && <div className="my-1 border-t border-slate-300 dark:border-[#21375C]" role="separator" />}
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
                          className={`w-full text-start px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white font-extrabold'
                              : 'text-slate-800 dark:text-[#DCE6F5] font-semibold hover:bg-[#EEF3FA] dark:hover:bg-[#1A3461]'
                          }`}
                        >
                          {t(opt.label, REPORT_TYPE_EN_LABELS[opt.key] || opt.label)}
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
            className="h-8 px-3.5 rounded bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] text-white font-black text-xs transition-colors cursor-pointer shrink-0"
          >
            {t('عرض التقرير', 'View Report')}
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

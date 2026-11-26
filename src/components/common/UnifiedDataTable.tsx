import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  Search,
  Inbox,
} from 'lucide-react';
import { exportToExcel } from './ExcelExporter';
import { exportTableToPdf, PdfExportOptions } from './PdfExporter';
import { usePreferences } from '../../context/PreferencesContext';

export interface UnifiedColumn<T> {
  key: string;
  header: string;
  align?: 'right' | 'center' | 'left' | 'start' | 'end';
  width?: string;
  minWidth?: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  exportValue?: (row: T, index?: number) => string | number | boolean;
  render: (row: T, index: number) => React.ReactNode;
  cellClassName?: string;
  headerClassName?: string;
}

export interface UnifiedDataTableProps<T> {
  title?: string;
  subtitle?: string;
  columns: UnifiedColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  toolbarFilters?: React.ReactNode;
  headerActions?: React.ReactNode;
  summaryStrip?: React.ReactNode;
  footerTotalsRow?: React.ReactNode;
  selectable?: boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  isRowSelectable?: (row: T) => boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  exportFilename?: string;
  pdfTitle?: string;
  pdfExtra?: Partial<PdfExportOptions>;
  emptyTitle?: string;
  emptySubtitle?: string;
  compact?: boolean;
  maxHeightClassName?: string;
  paginated?: boolean;
}

export function UnifiedDataTable<T>({
  title,
  subtitle,
  columns,
  data,
  rowKey,
  searchable = true,
  searchPlaceholder,
  searchFilter,
  searchValue,
  onSearchChange,
  toolbarFilters,
  headerActions,
  summaryStrip,
  footerTotalsRow,
  selectable = false,
  selectedKeys = [],
  onSelectionChange,
  isRowSelectable,
  onRowClick,
  rowClassName,
  pageSizeOptions = [10, 25, 50, 100],
  defaultPageSize = 25,
  exportFilename,
  pdfTitle,
  pdfExtra,
  emptyTitle,
  emptySubtitle,
  compact = false,
  maxHeightClassName = 'max-h-[68vh]',
  paginated = true,
}: UnifiedDataTableProps<T>) {
  const { t, language, dir } = usePreferences();
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('بحث في الجدول...', 'Search table...');
  const resolvedEmptyTitle = emptyTitle ?? t('لا توجد سجلات مطابقة', 'No matching records');
  const resolvedEmptySubtitle = emptySubtitle ?? t('جرّب تغيير الفلاتر أو إضافة سجل جديد', 'Try changing filters or adding a new record');
  const [internalSearch, setInternalSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const lastRowActivateRef = useRef<number>(0);

  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    return Boolean(
      el?.closest('button, a, input, select, textarea, label, [role="button"], [data-no-row-activate]')
    );
  };

  const isCoarseOrCompactViewport = (): boolean => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches || window.innerWidth < 768);
  };

  const triggerRowActivate = (row: T, e: React.MouseEvent) => {
    if (!onRowClick || isInteractiveTarget(e.target)) return;
    const now = Date.now();
    if (now - lastRowActivateRef.current < 260) return;
    lastRowActivateRef.current = now;
    onRowClick(row);
  };

  const effectiveSearch = searchValue !== undefined ? searchValue : internalSearch;
  const handleSearch = (val: string) => {
    setPage(1);
    if (onSearchChange) onSearchChange(val);
    else setInternalSearch(val);
  };

  const filteredData = useMemo(() => {
    const q = effectiveSearch.trim().toLowerCase();
    if (!q) return data;
    if (searchFilter) return data.filter((row) => searchFilter(row, q));
    return data.filter((row) => {
      for (const col of columns) {
        if (col.exportValue) {
          const val = String(col.exportValue(row, 0) ?? '').toLowerCase();
          if (val.includes(q)) return true;
        } else if (col.sortValue) {
          const val = String(col.sortValue(row) ?? '').toLowerCase();
          if (val.includes(q)) return true;
        }
      }
      try {
        return JSON.stringify(row).toLowerCase().includes(q);
      } catch {
        return false;
      }
    });
  }, [data, effectiveSearch, searchFilter, columns]);

  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filteredData;
    const getter = col.sortValue || col.exportValue || ((r: any) => r?.[col.key]);
    const copy = [...filteredData];
    copy.sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va ?? '');
      const sb = String(vb ?? '');
      return sortDir === 'asc' ? sa.localeCompare(sb, language) : sb.localeCompare(sa, language);
    });
    return copy;
  }, [filteredData, sortKey, sortDir, columns, language]);

  const totalRows = sortedData.length;
  const effectivePageSize = paginated ? pageSize : Math.max(1, totalRows);
  const totalPages = paginated ? Math.max(1, Math.ceil(totalRows / effectivePageSize)) : 1;
  const safePage = paginated ? Math.min(page, totalPages) : 1;
  const paginatedRows = useMemo(() => {
    if (!paginated) return sortedData;
    const start = (safePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [paginated, sortedData, safePage, pageSize]);

  const selectablePageKeys = useMemo(() => {
    if (!selectable) return [];
    const offset = paginated ? (safePage - 1) * pageSize : 0;
    return paginatedRows
      .filter((r) => (isRowSelectable ? isRowSelectable(r) : true))
      .map((r, idx) => rowKey(r, offset + idx));
  }, [selectable, paginated, paginatedRows, isRowSelectable, rowKey, safePage, pageSize]);

  const allPageSelected =
    selectable &&
    selectablePageKeys.length > 0 &&
    selectablePageKeys.every((k) => selectedKeys.includes(k));

  const toggleAllPage = () => {
    if (!onSelectionChange) return;
    if (allPageSelected) {
      onSelectionChange(selectedKeys.filter((k) => !selectablePageKeys.includes(k)));
    } else {
      onSelectionChange(Array.from(new Set([...selectedKeys, ...selectablePageKeys])));
    }
  };

  const toggleOne = (key: string) => {
    if (!onSelectionChange) return;
    if (selectedKeys.includes(key)) {
      onSelectionChange(selectedKeys.filter((k) => k !== key));
    } else {
      onSelectionChange([...selectedKeys, key]);
    }
  };

  const toggleSort = (col: UnifiedColumn<T>) => {
    if (col.sortable === false) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir('asc');
    }
  };

  const exportableColumns = useMemo(
    () =>
      columns.filter(
        (c) =>
          Boolean(c.exportValue) ||
          (c.key !== 'actions' && c.header !== 'الإجراءات' && c.header !== 'Actions')
      ),
    [columns]
  );

  const buildExportMatrix = () => {
    const headers = exportableColumns.map((c) => c.header);
    const rows = sortedData.map((row, rowIdx) =>
      exportableColumns.map((c) => {
        if (c.exportValue) return c.exportValue(row, rowIdx);
        if (c.sortValue) return c.sortValue(row);
        const raw = (row as any)?.[c.key];
        return raw === undefined || raw === null ? '' : String(raw);
      })
    );
    return { headers, rows };
  };

  const handleExcelExport = () => {
    const { headers, rows } = buildExportMatrix();
    exportToExcel(exportFilename || title || 'AWLAD_SELIM_TABLE', headers, rows);
  };

  const handlePdfExport = () => {
    const { headers, rows } = buildExportMatrix();
    exportTableToPdf(
      pdfTitle || title || t('تقرير جدول نظام أولاد سليم', 'AWLAD SELIM Table Report'),
      headers,
      rows.map((r) =>
        r.map((cell) => (typeof cell === 'boolean' ? (cell ? t('نعم', 'Yes') : t('لا', 'No')) : cell))
      ),
      pdfExtra
    );
  };

  const padCell = compact ? 'px-1.5 py-1' : 'px-2 py-1.5';

  return (
    <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] overflow-hidden flex flex-col">
      {(title || searchable || toolbarFilters || headerActions || exportFilename || pdfTitle) && (
        <div className={`${compact ? 'p-1.5 sm:p-2' : 'p-2'} border-b border-slate-200 dark:border-[#21375C] bg-[var(--awlad-blue-tint-50)]/45 dark:bg-[#132544] space-y-1.5`}>
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            {(title || subtitle) && (
              <div className="min-w-0">
                {title && <h3 className="text-xs sm:text-sm font-black text-[var(--awlad-navy-900)] dark:text-[#F3F7FC]">{title}</h3>}
                {subtitle && <p className="text-[11px] text-slate-500 dark:text-[#A9BCD9]">{subtitle}</p>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 ms-auto">
              {exportFilename && (
                <button
                  type="button"
                  onClick={handleExcelExport}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#0E1C36] hover:bg-slate-100 dark:hover:bg-[#1A3461] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
                  <span>Excel</span>
                </button>
              )}
              {pdfTitle && (
                <button
                  type="button"
                  onClick={handlePdfExport}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-[var(--awlad-navy-900)] dark:border-[#2E5CA8] bg-[var(--awlad-navy-900)] hover:bg-[var(--awlad-royal-700)] dark:bg-[#173C7E] dark:hover:bg-[#1659C8] text-white text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
              )}
              {headerActions}
            </div>
          </div>

          {(searchable || toolbarFilters) && (
            <div className="awlad-filter-row pb-0.5" data-testid="unified-filter-row">
              {searchable && (
                <div className="relative flex-1 min-w-[165px] shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-500 dark:text-[#8CA3C7] absolute start-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={effectiveSearch}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder={resolvedSearchPlaceholder}
                    className="w-full h-8 ps-7 pe-2 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-xs text-slate-900 dark:text-[#EEF4FC] placeholder:text-slate-500 dark:placeholder:text-[#8CA3C7] focus:outline-none focus:ring-1 focus:ring-[var(--awlad-royal-700)] focus:border-[var(--awlad-royal-700)] dark:focus:border-[#3B82F6] dark:focus:ring-[#3B82F6]/30"
                  />
                </div>
              )}
              {toolbarFilters && (
                <div className="flex flex-nowrap items-center gap-1.5 shrink-0 [&>*]:shrink-0">
                  {toolbarFilters}
                </div>
              )}
            </div>
          )}

          {summaryStrip && <div>{summaryStrip}</div>}
        </div>
      )}

      <div className={`overflow-x-auto overflow-y-auto ${maxHeightClassName}`}>
        <table className="w-full text-xs text-start border-collapse awlad-tabular">
          <thead className="bg-[var(--awlad-navy-900)] dark:bg-[#172E56] text-white dark:text-[#F3F7FC] sticky top-0 z-10">
            <tr>
              {selectable && (
                <th className="w-9 px-2 py-1.5 text-center border-b border-[var(--awlad-royal-700)] dark:border-[#2A436E]">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleAllPage}
                    aria-label={t('تحديد الكل', 'Select All')}
                    className="w-4 h-4 rounded accent-[var(--awlad-royal-700)] dark:accent-[#1659C8] cursor-pointer"
                  />
                </th>
              )}
              {columns.map((col) => {
                const canSort = col.sortable !== false && (Boolean(col.sortValue) || Boolean(col.exportValue));
                const alignCls =
                  col.align === 'center' ? 'text-center' : col.align === 'left' || col.align === 'end' ? 'text-end' : 'text-start';
                return (
                  <th
                    key={col.key}
                    style={{ width: col.width, minWidth: col.minWidth }}
                    onClick={() => canSort && toggleSort(col)}
                    className={`${padCell} font-bold whitespace-nowrap border-b border-[var(--awlad-royal-700)] dark:border-[#2A436E] select-none ${alignCls} ${
                      canSort ? 'cursor-pointer hover:bg-[var(--awlad-royal-700)]/80 dark:hover:bg-[#1F3D70]' : ''
                    } ${col.headerClassName || ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{col.header}</span>
                      {canSort &&
                        (sortKey === col.key ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5 text-blue-200 dark:text-[#85B8FF]" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 text-blue-200 dark:text-[#85B8FF]" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 text-blue-300/60 dark:text-[#849BBF]" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          {paginatedRows.length > 0 && (
            <tbody className="divide-y divide-slate-200 dark:divide-[#1B2F52] bg-white dark:bg-[#0E1C36]">
              {paginatedRows.map((row, idx) => {
                const absIdx = paginated ? (safePage - 1) * pageSize + idx : idx;
                const key = rowKey(row, absIdx);
                const canSelect = selectable && (isRowSelectable ? isRowSelectable(row) : true);
                const isSelected = selectable && selectedKeys.includes(key);
                const customRowCls = rowClassName ? rowClassName(row) : '';
                return (
                  <tr
                    key={key}
                    onClick={(e) => {
                      if (!onRowClick) return;
                      if (isCoarseOrCompactViewport()) {
                        triggerRowActivate(row, e);
                      }
                    }}
                    onDoubleClick={(e) => {
                      if (!onRowClick) return;
                      if (!isCoarseOrCompactViewport()) {
                        triggerRowActivate(row, e);
                      }
                    }}
                    title={onRowClick ? t('نقر مزدوج للتفاصيل (أو نقرة واحدة على الجوال)', 'Double click for details (or single tap on mobile)') : undefined}
                    className={`transition-colors ${
                      onRowClick ? 'cursor-pointer' : ''
                    } ${
                      isSelected
                        ? 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#16366B] hover:bg-[var(--awlad-blue-tint-100)]/70 dark:hover:bg-[#1B4282]'
                        : idx % 2 === 1
                        ? 'bg-slate-50/60 dark:bg-[#12223E] hover:bg-[var(--awlad-blue-tint-50)]/60 dark:hover:bg-[#1A3461]'
                        : 'bg-white dark:bg-[#0E1C36] hover:bg-[var(--awlad-blue-tint-50)]/60 dark:hover:bg-[#1A3461]'
                    } ${customRowCls}`}
                  >
                    {selectable && (
                      <td
                        className="w-9 px-2 py-1 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          disabled={!canSelect}
                          checked={isSelected}
                          onChange={() => toggleOne(key)}
                          className="w-4 h-4 rounded accent-[var(--awlad-royal-700)] dark:accent-[#1659C8] cursor-pointer disabled:opacity-40"
                        />
                      </td>
                    )}
                    {columns.map((col) => {
                      const alignCls =
                        col.align === 'center'
                          ? 'text-center'
                          : col.align === 'left' || col.align === 'end'
                          ? 'text-end'
                          : 'text-start';
                      return (
                        <td
                          key={col.key}
                          className={`${padCell} ${alignCls} text-slate-800 dark:text-[#DCE6F5] align-middle ${col.cellClassName || ''}`}
                        >
                          {col.render(row, absIdx)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          )}

          {footerTotalsRow && (
            <tfoot className="bg-slate-100 dark:bg-[#172E56] border-t-2 border-slate-300 dark:border-[#2A436E] font-bold text-slate-900 dark:text-[#F3F7FC]">
              {footerTotalsRow}
            </tfoot>
          )}
        </table>
      </div>

      {paginatedRows.length === 0 && (
        <div className="px-3 py-6 text-center text-slate-500 dark:text-[#A9BCD9] bg-white dark:bg-[#0E1C36] flex flex-col items-center justify-center gap-1">
          <Inbox className="w-6 h-6 text-slate-300 dark:text-[#4F6B94]" />
          <p className="text-xs font-bold text-slate-700 dark:text-[#DCE6F5]">{resolvedEmptyTitle}</p>
          <p className="text-[11px] text-slate-400 dark:text-[#849BBF] leading-relaxed">{resolvedEmptySubtitle}</p>
        </div>
      )}

      {(paginated || totalRows > 0) && (
        <div className="px-2.5 sm:px-3 py-1.5 border-t border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#132544] flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-slate-600 dark:text-[#A9BCD9]">
          <div className="flex items-center gap-2">
            <span>
              {t('إجمالي السجلات:', 'Total Records:')}{' '}
              <strong className="font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">{totalRows}</strong>
            </span>
            {selectable && selectedKeys.length > 0 && (
              <span className="px-2 py-0.5 rounded bg-[var(--awlad-blue-tint-100)] dark:bg-[#16366B] text-[var(--awlad-navy-900)] dark:text-[#85B8FF] font-bold">
                {t('المحدد:', 'Selected:')}{' '}
                <span className="font-mono tabular-nums">{selectedKeys.length}</span>
              </span>
            )}
          </div>

          {paginated && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <span>{t('عرض:', 'Show:')}</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-2 py-1 rounded border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-800 dark:text-[#EEF4FC] font-bold"
                >
                  {pageSizeOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="p-1 rounded border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] hover:bg-slate-100 dark:hover:bg-[#1A3461] disabled:opacity-40 cursor-pointer"
                  aria-label={t('الصفحة السابقة', 'Previous Page')}
                >
                  {dir === 'ltr' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <span className="px-2 font-mono tabular-nums font-bold text-slate-800 dark:text-[#F3F7FC]">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="p-1 rounded border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#0E1C36] text-slate-700 dark:text-[#DCE6F5] hover:bg-slate-100 dark:hover:bg-[#1A3461] disabled:opacity-40 cursor-pointer"
                  aria-label={t('الصفحة التالية', 'Next Page')}
                >
                  {dir === 'ltr' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

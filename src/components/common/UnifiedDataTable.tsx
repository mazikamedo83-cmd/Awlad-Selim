import React, { useMemo, useState } from 'react';
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
  SlidersHorizontal,
} from 'lucide-react';
import { exportToExcel } from './ExcelExporter';
import { exportTableToPdf, PdfExportOptions } from './PdfExporter';

export interface UnifiedColumn<T> {
  key: string;
  header: string;
  align?: 'right' | 'center' | 'left';
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
  searchPlaceholder = 'بحث في الجدول...',
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
  emptyTitle = 'لا توجد سجلات مطابقة',
  emptySubtitle = 'جرّب تغيير الفلاتر أو إضافة سجل جديد',
  compact = false,
  maxHeightClassName = 'max-h-[68vh]',
  paginated = true,
}: UnifiedDataTableProps<T>) {
  const [internalSearch, setInternalSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

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
      return sortDir === 'asc' ? sa.localeCompare(sb, 'ar') : sb.localeCompare(sa, 'ar');
    });
    return copy;
  }, [filteredData, sortKey, sortDir, columns]);

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
    () => columns.filter((c) => Boolean(c.exportValue) || (c.key !== 'actions' && c.header !== 'الإجراءات')),
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
      pdfTitle || title || 'تقرير جدول نظام أولاد سليم',
      headers,
      rows.map((r) => r.map((cell) => (typeof cell === 'boolean' ? (cell ? 'نعم' : 'لا') : cell))),
      pdfExtra
    );
  };

  const padCell = compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5';

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden flex flex-col">
      {(title || searchable || toolbarFilters || headerActions || exportFilename || pdfTitle) && (
        <div className="p-2 sm:p-2.5 border-b border-slate-200 bg-slate-50/70 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            {(title || subtitle) && (
              <div className="min-w-0">
                {title && <h3 className="text-xs sm:text-sm font-black text-slate-900 truncate">{title}</h3>}
                {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mr-auto">
              {exportFilename && (
                <button
                  type="button"
                  onClick={handleExcelExport}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-blue-800" />
                  <span>Excel</span>
                </button>
              )}
              {pdfTitle && (
                <button
                  type="button"
                  onClick={handlePdfExport}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-blue-900 bg-blue-950 hover:bg-blue-900 text-white text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
              )}
              {headerActions}
            </div>
          </div>

          {(searchable || toolbarFilters) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {searchable && (
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={effectiveSearch}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full pr-8 pl-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-800"
                  />
                </div>
              )}
              {toolbarFilters && searchable && (
                <button
                  type="button"
                  onClick={() => setShowMobileFilters((v) => !v)}
                  className={`sm:hidden inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-bold shrink-0 cursor-pointer ${
                    showMobileFilters
                      ? 'bg-blue-900 text-white border-blue-900'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>فلاتر</span>
                </button>
              )}
              {toolbarFilters && (
                <div
                  className={`${
                    searchable ? (showMobileFilters ? 'flex' : 'hidden sm:flex') : 'flex'
                  } flex-wrap items-center gap-1.5 w-full sm:w-auto`}
                >
                  {toolbarFilters}
                </div>
              )}
            </div>
          )}

          {summaryStrip && <div>{summaryStrip}</div>}
        </div>
      )}

      <div className={`overflow-x-auto overflow-y-auto ${maxHeightClassName}`}>
        <table className="w-full text-xs text-right border-collapse awlad-tabular">
          <thead className="bg-blue-950 text-white sticky top-0 z-10 shadow-sm">
            <tr>
              {selectable && (
                <th className="w-10 px-2.5 py-2.5 text-center border-b border-blue-900">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleAllPage}
                    aria-label="تحديد الكل"
                    className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                  />
                </th>
              )}
              {columns.map((col) => {
                const canSort = col.sortable !== false && (Boolean(col.sortValue) || Boolean(col.exportValue));
                const alignCls =
                  col.align === 'center' ? 'text-center' : col.align === 'left' ? 'text-left' : 'text-right';
                return (
                  <th
                    key={col.key}
                    style={{ width: col.width, minWidth: col.minWidth }}
                    onClick={() => canSort && toggleSort(col)}
                    className={`${padCell} font-bold whitespace-nowrap border-b border-blue-900 select-none ${alignCls} ${
                      canSort ? 'cursor-pointer hover:bg-blue-900/80' : ''
                    } ${col.headerClassName || ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{col.header}</span>
                      {canSort &&
                        (sortKey === col.key ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5 text-blue-200" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 text-blue-200" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 text-blue-300/60" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 bg-white">
            {paginatedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="py-6 text-center text-slate-500"
                >
                  <div className="flex flex-col items-center justify-center gap-1">
                    <Inbox className="w-6 h-6 text-slate-300" />
                    <p className="text-xs font-bold text-slate-700">{emptyTitle}</p>
                    <p className="text-[11px] text-slate-400">{emptySubtitle}</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, idx) => {
                const absIdx = paginated ? (safePage - 1) * pageSize + idx : idx;
                const key = rowKey(row, absIdx);
                const canSelect = selectable && (isRowSelectable ? isRowSelectable(row) : true);
                const isSelected = selectable && selectedKeys.includes(key);
                const customRowCls = rowClassName ? rowClassName(row) : '';
                return (
                  <tr
                    key={key}
                    onClick={() => onRowClick && onRowClick(row)}
                    className={`transition-colors ${
                      onRowClick ? 'cursor-pointer' : ''
                    } ${
                      isSelected
                        ? 'bg-blue-50/90 hover:bg-blue-100/70'
                        : idx % 2 === 1
                        ? 'bg-slate-50/50 hover:bg-blue-50/50'
                        : 'bg-white hover:bg-blue-50/50'
                    } ${customRowCls}`}
                  >
                    {selectable && (
                      <td
                        className="w-10 px-2.5 py-2 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          disabled={!canSelect}
                          checked={isSelected}
                          onChange={() => toggleOne(key)}
                          className="w-4 h-4 rounded accent-blue-800 cursor-pointer disabled:opacity-40"
                        />
                      </td>
                    )}
                    {columns.map((col) => {
                      const alignCls =
                        col.align === 'center'
                          ? 'text-center'
                          : col.align === 'left'
                          ? 'text-left'
                          : 'text-right';
                      return (
                        <td
                          key={col.key}
                          className={`${padCell} ${alignCls} text-slate-800 align-middle ${col.cellClassName || ''}`}
                        >
                          {col.render(row, absIdx)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>

          {footerTotalsRow && (
            <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900">
              {footerTotalsRow}
            </tfoot>
          )}
        </table>
      </div>

      {(paginated || totalRows > 0) && (
        <div className="px-2.5 sm:px-3 py-1.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-slate-600">
          <div className="flex items-center gap-2">
            <span>
              إجمالي السجلات: <strong className="font-mono tabular-nums text-slate-900">{totalRows}</strong>
            </span>
            {selectable && selectedKeys.length > 0 && (
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-bold">
                المحدد: <span className="font-mono tabular-nums">{selectedKeys.length}</span>
              </span>
            )}
          </div>

          {paginated && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <span>عرض:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-800 font-bold"
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
                  className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40"
                  aria-label="الصفحة السابقة"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span className="px-2 font-mono tabular-nums font-bold text-slate-800">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40"
                  aria-label="الصفحة التالية"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

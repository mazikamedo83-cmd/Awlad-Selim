import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import type { Product, Warehouse } from '../../types';
import { usePreferences } from '../../context/PreferencesContext';
import { QuantityInput } from './QuantityInput';
import { computeLineTotal, formatQuantity, normalizeNumericText, roundCurrency } from '../../utils/quantity';

export interface EditableGridRow {
  rowKey: string;
  productId?: string;
  productName: string;
  barcode?: string;
  unit: string;
  unitFactor: number;
  quantity: number;
  maxQuantity?: number;
  unitPrice: number;
  purchasePriceAtTime?: number;
  discount?: number;
  total: number;
  availableStock?: number;
  secondaryBadge?: string;
}

export interface EditableItemGridProps {
  rows: EditableGridRow[];
  products: Product[];
  warehouses?: Warehouse[];
  currency?: string;
  priceMode?: 'selling' | 'purchase' | 'none';
  showPriceColumns?: boolean;
  showDiscountColumn?: boolean;
  showStockColumn?: boolean;
  stockColumnLabel?: string;
  qtyColumnLabel?: string;
  allowUnitEdit?: boolean;
  allowQtyEdit?: boolean;
  allowPriceEdit?: boolean;
  allowDiscountEdit?: boolean;
  minQty?: number;
  canDelete?: boolean;
  canDuplicate?: boolean;
  canAddNew?: boolean;
  hideCostInfo?: boolean;
  recalcPriceOnUnitChange?: boolean;
  maxHeightClass?: string;
  compact?: boolean;
  emptyStateText?: string;
  onUpdateRow: (idx: number, patch: Partial<EditableGridRow>) => void;
  onDeleteRow?: (idx: number) => void;
  onDuplicateRow?: (idx: number) => void;
  onAddNewItem?: () => void;
  onGridAdvanceOut?: () => void;
  onNotify?: (text: string, type?: 'error' | 'info' | 'success' | 'warning') => void;
}

interface UnitOption {
  name: string;
  factor: number;
  sellingPrice: number;
  purchasePrice: number;
}

export const EditableItemGrid: React.FC<EditableItemGridProps> = ({
  rows,
  products,
  currency = 'ج.م',
  priceMode = 'selling',
  showPriceColumns = true,
  showDiscountColumn = false,
  showStockColumn = false,
  stockColumnLabel,
  qtyColumnLabel,
  allowUnitEdit = true,
  allowQtyEdit = true,
  allowPriceEdit = true,
  allowDiscountEdit = false,
  minQty = 0.001,
  canDelete = true,
  canDuplicate = false,
  canAddNew = false,
  hideCostInfo = false,
  recalcPriceOnUnitChange = false,
  maxHeightClass = 'max-h-64',
  compact = false,
  emptyStateText,
  onUpdateRow,
  onDeleteRow,
  onDuplicateRow,
  onAddNewItem,
  onGridAdvanceOut,
  onNotify,
}) => {
  const { t, locale, dir } = usePreferences();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowIndex: number;
  } | null>(null);

  const productsMap = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products || []) {
      map.set(p.id, p);
    }
    return map;
  }, [products]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const fmtMoney = (val: number) =>
    roundCurrency(val).toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const getUnitOptions = (row: EditableGridRow): UnitOption[] => {
    const prod = row.productId ? productsMap.get(row.productId) : undefined;
    const opts: UnitOption[] = [];
    if (prod) {
      opts.push({
        name: prod.baseUnit,
        factor: 1,
        sellingPrice: Number(prod.sellingPrice || 0),
        purchasePrice: Number(prod.purchasePrice || 0),
      });
      for (const u of prod.units || []) {
        if (!u?.name || opts.some((o) => o.name === u.name)) continue;
        const factor = Number(u.conversionFactor || 1) || 1;
        opts.push({
          name: u.name,
          factor,
          sellingPrice: Number(u.sellingPrice ?? prod.sellingPrice * factor),
          purchasePrice: Number(u.purchasePrice ?? prod.purchasePrice * factor),
        });
      }
    }
    if (row.unit && !opts.some((o) => o.name === row.unit)) {
      opts.push({
        name: row.unit,
        factor: Number(row.unitFactor || 1) || 1,
        sellingPrice: Number(row.unitPrice || 0),
        purchasePrice: Number(row.purchasePriceAtTime ?? row.unitPrice ?? 0),
      });
    }
    return opts;
  };

  const handleUnitChange = (idx: number, row: EditableGridRow, nextUnitName: string) => {
    const opts = getUnitOptions(row);
    const chosen = opts.find((o) => o.name === nextUnitName);
    if (!chosen) return;

    const patch: Partial<EditableGridRow> = {
      unit: chosen.name,
      unitFactor: chosen.factor,
    };

    if (recalcPriceOnUnitChange && priceMode !== 'none') {
      const nextUnitPrice =
        priceMode === 'purchase'
          ? roundCurrency(chosen.purchasePrice)
          : roundCurrency(chosen.sellingPrice);
      patch.unitPrice = nextUnitPrice;
      if (!hideCostInfo) {
        patch.purchasePriceAtTime = roundCurrency(chosen.purchasePrice);
      }
      patch.total = computeLineTotal(row.quantity, nextUnitPrice, row.discount || 0);
    }

    onUpdateRow(idx, patch);
    onNotify?.(
      t(`تم تحديث الوحدة إلى ${t(chosen.name)}`, `Unit updated to ${t(chosen.name)}`),
      'info'
    );
  };

  const handlePriceInputChange = (idx: number, row: EditableGridRow, raw: string) => {
    const normalized = normalizeNumericText(raw);
    if (normalized !== '' && !/^\d*(?:\.\d*)?$/.test(normalized)) return;
    const parsed = normalized === '' ? 0 : Math.max(0, roundCurrency(Number(normalized)));
    onUpdateRow(idx, {
      unitPrice: parsed,
      ...(priceMode === 'purchase' && !hideCostInfo
        ? {
            purchasePriceAtTime:
              (row.unitFactor || 1) > 0
                ? roundCurrency(parsed / (row.unitFactor || 1))
                : parsed,
          }
        : {}),
      total: computeLineTotal(row.quantity, parsed, row.discount || 0),
    });
  };

  const handleDiscountInputChange = (idx: number, row: EditableGridRow, raw: string) => {
    const normalized = normalizeNumericText(raw);
    if (normalized !== '' && !/^\d*(?:\.\d*)?$/.test(normalized)) return;
    const parsed = normalized === '' ? 0 : Math.max(0, roundCurrency(Number(normalized)));
    onUpdateRow(idx, {
      discount: parsed,
      total: computeLineTotal(row.quantity, row.unitPrice, parsed),
    });
  };

  const handleLastCellEnter = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && idx === rows.length - 1 && onGridAdvanceOut) {
      e.preventDefault();
      e.stopPropagation();
      onGridAdvanceOut();
    }
  };

  const showActionsCol = (canDuplicate && Boolean(onDuplicateRow)) || (canDelete && Boolean(onDeleteRow));
  const resolvedEmpty =
    emptyStateText ||
    t('لم يتم إضافة أي أصناف بعد', 'No items added yet');

  const padCell = compact ? 'px-1.5 py-1' : 'px-2 py-1.5';
  const inputH = compact ? 'h-7 text-[11px]' : 'h-8 text-xs';

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-[#21375C] bg-slate-50/70 dark:bg-[#0B172D] p-3 text-center space-y-1.5">
        <p className="text-xs font-bold text-slate-500 dark:text-[#A9BCD9]">{resolvedEmpty}</p>
        {canAddNew && onAddNewItem && (
          <button
            type="button"
            onClick={onAddNewItem}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#EEF3FA] dark:bg-[#172E56] text-[#003589] dark:text-[#85B8FF] border border-[#DCE6F5] dark:border-[#2A436E] text-[11px] font-bold hover:opacity-90 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('إضافة صنف', 'Add Item')}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      dir={dir}
      className="relative rounded-lg border border-slate-200 dark:border-[#21375C] bg-white dark:bg-[#0E1C36] overflow-hidden"
    >
      <div className={`overflow-auto ${maxHeightClass}`}>
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-[#EEF3FA] dark:bg-[#172E56] text-[#011E58] dark:text-[#DCE6F5] border-b border-slate-200 dark:border-[#21375C]">
            <tr>
              <th className={`${padCell} text-center font-black w-8`}>#</th>
              <th className={`${padCell} text-start font-black min-w-[140px]`}>
                {t('الصنف', 'Item')}
              </th>
              <th className={`${padCell} text-center font-black min-w-[92px]`}>
                {t('الوحدة', 'Unit')}
              </th>
              {showStockColumn && (
                <th className={`${padCell} text-center font-black min-w-[82px]`}>
                  {stockColumnLabel || t('المتاح', 'Available')}
                </th>
              )}
              <th className={`${padCell} text-center font-black min-w-[96px]`}>
                {qtyColumnLabel || t('الكمية', 'Quantity')}
              </th>
              {showPriceColumns && priceMode !== 'none' && (
                <th className={`${padCell} text-center font-black min-w-[88px]`}>
                  {priceMode === 'purchase'
                    ? t('سعر الشراء', 'Purchase Price')
                    : t('السعر', 'Unit Price')}
                </th>
              )}
              {showPriceColumns && priceMode !== 'none' && showDiscountColumn && (
                <th className={`${padCell} text-center font-black min-w-[78px]`}>
                  {t('الخصم', 'Discount')}
                </th>
              )}
              {showPriceColumns && priceMode !== 'none' && (
                <th className={`${padCell} text-center font-black min-w-[92px]`}>
                  {t('الإجمالي', 'Total')}
                </th>
              )}
              {showActionsCol && (
                <th className={`${padCell} text-center font-black w-16`}>
                  {t('إجراء', 'Actions')}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
            {rows.map((row, idx) => {
              const unitOptions = getUnitOptions(row);
              const isDiscountLast =
                showPriceColumns && priceMode !== 'none' && showDiscountColumn && allowDiscountEdit;
              const isPriceLast =
                showPriceColumns && priceMode !== 'none' && allowPriceEdit && !isDiscountLast;
              const isQtyLast = allowQtyEdit && !isPriceLast && !isDiscountLast;

              return (
                <tr
                  key={row.rowKey}
                  onContextMenu={(e) => {
                    if (!showActionsCol && !(canAddNew && onAddNewItem)) return;
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: idx });
                  }}
                  className="hover:bg-slate-50/80 dark:hover:bg-[#132544]/70 transition-colors"
                >
                  <td className={`${padCell} text-center font-mono text-[11px] font-bold text-slate-500 dark:text-[#849BBF]`}>
                    {idx + 1}
                  </td>

                  <td className={`${padCell} text-start`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-slate-900 dark:text-[#F3F7FC] leading-tight">
                        {row.productName}
                      </span>
                      {row.secondaryBadge && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-[10px] font-bold">
                          {row.secondaryBadge}
                        </span>
                      )}
                    </div>
                    {row.barcode && (
                      <div className="text-[10px] font-mono text-slate-400 dark:text-[#849BBF]">
                        {row.barcode}
                      </div>
                    )}
                  </td>

                  <td className={`${padCell} text-center`}>
                    {allowUnitEdit && unitOptions.length > 0 ? (
                      <select
                        value={row.unit}
                        onChange={(e) => handleUnitChange(idx, row, e.target.value)}
                        aria-label={t('الوحدة', 'Unit')}
                        className={`w-full ${inputH} rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#081326] px-1.5 font-bold text-slate-900 dark:text-[#DCE6F5] outline-hidden focus:border-[#003589]`}
                      >
                        {unitOptions.map((opt) => (
                          <option key={opt.name} value={opt.name}>
                            {t(opt.name)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-[#172E56] font-bold text-slate-700 dark:text-[#DCE6F5]">
                        {t(row.unit)}
                      </span>
                    )}
                  </td>

                  {showStockColumn && (
                    <td className={`${padCell} text-center font-mono font-bold text-slate-700 dark:text-[#A9BCD9]`}>
                      {formatQuantity(row.availableStock ?? 0)}
                    </td>
                  )}

                  <td className={`${padCell} text-center`}>
                    {allowQtyEdit ? (
                      <div className="flex justify-center">
                        <QuantityInput
                          value={row.quantity}
                          min={minQty}
                          max={row.maxQuantity}
                          allowDecimals
                          showSteppers={compact}
                          ariaLabel={qtyColumnLabel || t('الكمية', 'Quantity')}
                          inputClassName={`w-16 ${inputH} rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#081326] px-1.5 text-center font-bold font-mono text-slate-900 dark:text-[#F3F7FC] outline-hidden focus:border-[#003589]`}
                          onChange={(nextQty) => {
                            const clamped =
                              row.maxQuantity !== undefined
                                ? Math.min(row.maxQuantity, Math.max(minQty, nextQty))
                                : Math.max(minQty, nextQty);
                            onUpdateRow(idx, {
                              quantity: clamped,
                              total: computeLineTotal(clamped, row.unitPrice, row.discount || 0),
                            });
                          }}
                          onKeyDown={(e) => {
                            if (isQtyLast) handleLastCellEnter(idx, e);
                          }}
                        />
                      </div>
                    ) : (
                      <span className="font-mono font-bold">{formatQuantity(row.quantity)}</span>
                    )}
                  </td>

                  {showPriceColumns && priceMode !== 'none' && (
                    <td className={`${padCell} text-center`}>
                      {allowPriceEdit ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          dir="ltr"
                          value={row.unitPrice}
                          onChange={(e) => handlePriceInputChange(idx, row, e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => {
                            if (isPriceLast) handleLastCellEnter(idx, e);
                          }}
                          aria-label={t('السعر', 'Unit Price')}
                          className={`w-20 ${inputH} rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#081326] px-1.5 text-center font-mono font-bold text-slate-900 dark:text-[#F3F7FC] outline-hidden focus:border-[#003589]`}
                        />
                      ) : (
                        <span className="font-mono font-bold">{fmtMoney(row.unitPrice)}</span>
                      )}
                    </td>
                  )}

                  {showPriceColumns && priceMode !== 'none' && showDiscountColumn && (
                    <td className={`${padCell} text-center`}>
                      {allowDiscountEdit ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          dir="ltr"
                          value={row.discount || 0}
                          onChange={(e) => handleDiscountInputChange(idx, row, e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => {
                            if (isDiscountLast) handleLastCellEnter(idx, e);
                          }}
                          aria-label={t('الخصم', 'Discount')}
                          className={`w-16 ${inputH} rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#081326] px-1.5 text-center font-mono font-bold text-slate-900 dark:text-[#F3F7FC] outline-hidden focus:border-[#003589]`}
                        />
                      ) : (
                        <span className="font-mono font-bold">{fmtMoney(row.discount || 0)}</span>
                      )}
                    </td>
                  )}

                  {showPriceColumns && priceMode !== 'none' && (
                    <td className={`${padCell} text-center font-mono font-black text-[#011E58] dark:text-[#85B8FF] whitespace-nowrap`}>
                      {fmtMoney(row.total)} <span className="text-[10px] font-bold">{t(currency)}</span>
                    </td>
                  )}

                  {showActionsCol && (
                    <td className={`${padCell} text-center`}>
                      <div className="inline-flex items-center justify-center gap-1">
                        {canDuplicate && onDuplicateRow && (
                          <button
                            type="button"
                            onClick={() => {
                              onDuplicateRow(idx);
                              onNotify?.(t('تم تكرار السطر', 'Row duplicated'), 'info');
                            }}
                            title={t('تكرار السطر', 'Duplicate row')}
                            aria-label={t('تكرار السطر', 'Duplicate row')}
                            className="p-1 rounded border border-slate-200 dark:border-[#2A436E] bg-slate-50 dark:bg-[#132544] text-slate-600 dark:text-[#A9BCD9] hover:text-[#003589] hover:border-[#003589] cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && onDeleteRow && (
                          <button
                            type="button"
                            onClick={() => onDeleteRow(idx)}
                            title={t('حذف السطر', 'Delete row')}
                            aria-label={t('حذف السطر', 'Delete row')}
                            className="p-1 rounded border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 hover:bg-rose-100 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canAddNew && onAddNewItem && (
        <div className="px-2 py-1 border-t border-slate-100 dark:border-[#1B2F52] bg-slate-50/70 dark:bg-[#0B172D] flex items-center justify-between text-[11px]">
          <span className="font-bold text-slate-500 dark:text-[#849BBF]">
            {t(`عدد الأصناف: ${rows.length}`, `Items count: ${rows.length}`)}
          </span>
          <button
            type="button"
            onClick={onAddNewItem}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-[#172E56] border border-[#DCE6F5] dark:border-[#2A436E] text-[#003589] dark:text-[#85B8FF] font-bold hover:bg-[#EEF3FA] cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>{t('إضافة صنف آخر', 'Add another item')}</span>
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: Math.min(contextMenu.y, typeof window !== 'undefined' ? window.innerHeight - 130 : contextMenu.y),
            left: Math.min(contextMenu.x, typeof window !== 'undefined' ? window.innerWidth - 170 : contextMenu.x),
          }}
          onClick={(e) => e.stopPropagation()}
          className="z-50 min-w-[155px] rounded-lg border border-slate-200 dark:border-[#2A436E] bg-white dark:bg-[#0E1C36] shadow-xl py-1 text-xs font-bold"
        >
          {canDuplicate && onDuplicateRow && (
            <button
              type="button"
              onClick={() => {
                onDuplicateRow(contextMenu.rowIndex);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-start flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-[#172E56] text-slate-800 dark:text-[#DCE6F5] cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-blue-700 dark:text-[#85B8FF]" />
              <span>{t('تكرار السطر', 'Duplicate row')}</span>
            </button>
          )}
          {canAddNew && onAddNewItem && (
            <button
              type="button"
              onClick={() => {
                onAddNewItem();
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-start flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-[#172E56] text-slate-800 dark:text-[#DCE6F5] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              <span>{t('إضافة صنف جديد', 'Add new item')}</span>
            </button>
          )}
          {canDelete && onDeleteRow && (
            <button
              type="button"
              onClick={() => {
                onDeleteRow(contextMenu.rowIndex);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-start flex items-center gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-300 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('حذف السطر', 'Delete row')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

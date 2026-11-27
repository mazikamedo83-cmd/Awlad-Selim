import React, { useState, useEffect } from 'react';
import {
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Warehouse as WarehouseIcon,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import type { ItemLifecyclePayload, ItemPnlSummary } from '../../../types';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber, translateSystemEntityName } from '../../../i18n/translator';

interface ItemLifecycleAndPnlPanelProps {
  lifecycle: ItemLifecyclePayload | null;
  selectedPnl: ItemPnlSummary | null;
  pnlItems: ItemPnlSummary[];
  portfolioTotals: {
    totalPurchaseValue: number;
    totalSalesValue: number;
    netSalesValue: number;
    cogs: number;
    totalDiscounts: number;
    salesReturnsValue: number;
    purchaseReturnsValue: number;
    allocatedExpenses: number;
    grossProfit: number;
    netProfit: number;
    totalLoss: number;
    stockValuation: number;
  };
  currency: string;
  onSelectProduct: (productId: string) => void;
  onInspectDocument: (docType: string, docId: string) => void;
}

const fmt = (n: number | undefined | null) => formatLocaleNumber(Number(n || 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n: number | undefined | null) => formatLocaleNumber(Number(n || 0), { maximumFractionDigits: 3 });

export const ItemLifecycleAndPnlPanel: React.FC<ItemLifecycleAndPnlPanelProps> = ({
  lifecycle,
  selectedPnl,
  pnlItems,
  portfolioTotals,
  currency,
  onSelectProduct,
  onInspectDocument,
}) => {
  const { t, dir } = usePreferences();
  const [innerTab, setInnerTab] = useState<'timeline' | 'pnl' | 'portfolio'>(
    lifecycle ? 'timeline' : 'portfolio'
  );
  const [portfolioSearch, setPortfolioSearch] = useState('');

  const lifecycleProductId = lifecycle?.product?.id || null;
  const hasSelectedPnl = Boolean(selectedPnl);

  useEffect(() => {
    if (lifecycleProductId) {
      setInnerTab('timeline');
    } else if (!hasSelectedPnl) {
      setInnerTab('portfolio');
    }
  }, [lifecycleProductId, hasSelectedPnl]);

  const filteredPortfolio = pnlItems.filter((it) => {
    const q = portfolioSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      it.productName.toLowerCase().includes(q) ||
      it.code.toLowerCase().includes(q) ||
      it.barcode.toLowerCase().includes(q) ||
      it.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-2.5" dir={dir}>
      {/* Sub-mode switcher inside the unified Item Analysis view */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg p-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {lifecycle && (
            <button
              type="button"
              onClick={() => setInnerTab('timeline')}
              className={`px-2.5 py-1 rounded-md text-xs font-extrabold transition-colors cursor-pointer ${
                innerTab === 'timeline'
                  ? 'bg-[#011E58] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t('تاريخ الصنف من أول يوم لآخر حركة', 'Full Item History (Day 1 to Latest)')} ({lifecycle.timeline.length})
            </button>
          )}
          {selectedPnl && (
            <button
              type="button"
              onClick={() => setInnerTab('pnl')}
              className={`px-2.5 py-1 rounded-md text-xs font-extrabold transition-colors cursor-pointer ${
                innerTab === 'pnl'
                  ? 'bg-[#003589] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t('تحليل الأرباح والخسائر التفصيلي للصنف', 'Detailed Item Profit & Loss Analysis')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setInnerTab('portfolio')}
            className={`px-2.5 py-1 rounded-md text-xs font-extrabold transition-colors cursor-pointer ${
              innerTab === 'portfolio' || (!lifecycle && !selectedPnl)
                ? 'bg-[#002160] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {t('أرباح وخسائر جميع الأصناف', 'All Items Profit & Loss')} ({pnlItems.length})
          </button>
        </div>

        {lifecycle && (
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
            <span>{t('الصنف:', 'Item:')} <strong className="text-slate-900">{lifecycle.product.name}</strong></span>
            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{t('كود:', 'Code:')} {lifecycle.product.code}</span>
            {lifecycle.product.barcode && (
              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{t('باركود:', 'Barcode:')} {lifecycle.product.barcode}</span>
            )}
          </div>
        )}
      </div>

      {/* 1. Selected Item Full Lifecycle History */}
      {lifecycle && innerTab === 'timeline' && (
        <div className="space-y-2.5">
          {/* Product Header & Warehouse Stock Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-2.5 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#EEF3FA] border border-[#DCE6F5] flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-[#003589]" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 text-sm">{lifecycle.product.name}</h3>
                    <p className="text-[11px] text-slate-500">
                      {t('المجموعة:', 'Category:')} <strong>{lifecycle.product.category}</strong> · {t('تصنيف 1:', 'Class 1:')} <strong>{lifecycle.product.class1 || t('بدون', 'None')}</strong> · {t('الوحدة الأساسية:', 'Base Unit:')} <strong>{t(lifecycle.product.baseUnit)}</strong>
                    </p>
                  </div>
                </div>
                <div className="text-end text-[11px] text-slate-500">
                  <span className="flex items-center gap-1 justify-end">
                    <Calendar className="w-3 h-3" />
                    {t('تاريخ إضافة الصنف:', 'Created Date:')}
                  </span>
                  <strong className="text-slate-800 font-mono">{lifecycle.product.createdAtFormatted || '-'}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden text-xs">
                <div className="px-2.5 py-1.5 bg-slate-50">
                  <span className="text-[11px] text-slate-500 block">{t('الرصيد الحالي الكلي', 'Total Current Stock')}</span>
                  <strong className="text-sm font-black text-slate-900 tabular-nums">{fmtQty(lifecycle.currentStockTotal)} {t(lifecycle.product.baseUnit)}</strong>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-50">
                  <span className="text-[11px] text-slate-500 block">{t('قيمة المخزون بالتكلفة', 'Stock Value at Cost')}</span>
                  <strong className="text-sm font-black text-blue-800 tabular-nums">{fmt(lifecycle.currentStockValueAtCost)} {t(currency)}</strong>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-50">
                  <span className="text-[11px] text-slate-500 block">{t('آخر سعر شراء', 'Last Purchase Price')}</span>
                  <strong className="text-sm font-black text-amber-700 tabular-nums">{fmt(lifecycle.lastPurchasePrice)}</strong>
                  {lifecycle.lastPurchaseDate && <span className="block text-[10px] text-slate-400 font-mono">{lifecycle.lastPurchaseDate}</span>}
                </div>
                <div className="px-2.5 py-1.5 bg-slate-50">
                  <span className="text-[11px] text-slate-500 block">{t('آخر سعر بيع', 'Last Sale Price')}</span>
                  <strong className="text-sm font-black text-emerald-700 tabular-nums">{fmt(lifecycle.lastSalePrice)}</strong>
                  {lifecycle.lastSaleDate && <span className="block text-[10px] text-slate-400 font-mono">{lifecycle.lastSaleDate}</span>}
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800 mb-1.5">
                <WarehouseIcon className="w-3.5 h-3.5 text-blue-700" />
                <span>{t('الرصيد الحالي حسب المخزن والعهد', 'Current Balance by Warehouse & Custody')}</span>
              </div>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-md">
                <table className="w-full text-start text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 text-[10px] sticky top-0">
                    <tr>
                      <th className="px-2 py-1 border-b border-slate-200">{t('المخزن / الفرع', 'Warehouse / Branch')}</th>
                      <th className="px-2 py-1 border-b border-slate-200 text-end">{t('الرصيد', 'Balance')}</th>
                      <th className="px-2 py-1 border-b border-slate-200 text-end">{t('التكلفة', 'Cost')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lifecycle.warehouseBalances.map((wb) => (
                      <tr key={wb.warehouseId} className="hover:bg-slate-50">
                        <td className="px-2 py-1">
                          <strong className="text-slate-800 block">{translateSystemEntityName(wb.warehouseName)}</strong>
                          <span className="text-[10px] text-slate-500">{translateSystemEntityName(wb.branchName)}</span>
                        </td>
                        <td className="px-2 py-1 text-end font-mono tabular-nums">
                          <strong className={wb.quantity > 0 ? 'text-emerald-700' : wb.quantity < 0 ? 'text-rose-700' : 'text-slate-500'}>
                            {fmtQty(wb.quantity)}
                          </strong>
                        </td>
                        <td className="px-2 py-1 text-end font-mono text-[11px] text-slate-500 tabular-nums">
                          {fmt(wb.costValue)} {t(currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Chronological Timeline Table */}
          <UnifiedDataTable
            title={t('السجل التاريخي التسلسلي الكامل للصنف (من لحظة الإضافة حتى آخر حركة)', 'Full Chronological Item History (Creation to Latest Movement)')}
            subtitle={`${t('عدد الأحداث:', 'Events Count:')} ${lifecycle.timeline.length}`}
            compact
            maxHeightClassName="max-h-[52vh]"
            data={lifecycle.timeline}
            rowKey={(ev) => ev.id}
            searchPlaceholder={t('بحث بالمستند أو نوع الحركة أو المخزن أو الطرف...', 'Search by doc, movement type, warehouse, or party...')}
            exportFilename={`AWLAD_SELIM_Lifecycle_${lifecycle.product.code}`}
            pdfTitle={t(`السجل التاريخي للصنف: ${lifecycle.product.name}`, `Item History: ${lifecycle.product.name}`)}
            defaultPageSize={50}
            onRowClick={(ev) => {
              if (ev.docId && ev.docType !== 'product' && ev.docType !== 'audit') {
                onInspectDocument(ev.docType, ev.docId);
              }
            }}
            rowClassName={(ev) => {
              const isPriceChg = ev.eventType === 'price_change' || ev.eventType === 'product_updated';
              const isDamaged = ev.eventType === 'damaged' || ev.eventType === 'custody_damaged';
              const clickable = ev.docType !== 'product' && ev.docType !== 'audit' ? 'cursor-pointer ' : '';
              return `${clickable}${isPriceChg ? 'bg-amber-50/70' : isDamaged ? 'bg-rose-50/70' : ''}`;
            }}
            columns={[
              {
                key: 'date',
                header: t('اليومية', 'Journal Date'),
                sortable: true,
                sortValue: (ev) => ev.date,
                exportValue: (ev) => ev.date.replace(/-/g, '/'),
                render: (ev) => <span className="font-mono whitespace-nowrap tabular-nums">{ev.date.replace(/-/g, '/')}</span>,
              },
              {
                key: 'actualDateTime',
                header: t('التاريخ الفعلي', 'Actual Date/Time'),
                sortable: true,
                sortValue: (ev) => ev.actualDateTime,
                exportValue: (ev) => ev.actualDateTime,
                render: (ev) => <span className="font-mono whitespace-nowrap text-[11px] tabular-nums">{ev.actualDateTime}</span>,
              },
              {
                key: 'eventLabel',
                header: t('نوع الحركة', 'Movement Type'),
                sortable: true,
                sortValue: (ev) => t(ev.eventLabel),
                exportValue: (ev) => t(ev.eventLabel),
                render: (ev) => <span className="font-bold whitespace-nowrap">{t(ev.eventLabel)}</span>,
              },
              {
                key: 'docNumber',
                header: t('رقم المستند', 'Document #'),
                sortable: true,
                sortValue: (ev) => ev.docNumber,
                exportValue: (ev) => ev.docNumber,
                render: (ev) => (
                  <span className="inline-flex items-center gap-1 font-mono whitespace-nowrap text-blue-700">
                    {ev.docNumber}
                    {ev.docType !== 'product' && ev.docType !== 'audit' && <ExternalLink className="w-3 h-3" />}
                  </span>
                ),
              },
              {
                key: 'warehouseName',
                header: t('المخزن / المسار', 'Warehouse / Route'),
                sortable: true,
                sortValue: (ev) => translateSystemEntityName(ev.warehouseName),
                exportValue: (ev) => translateSystemEntityName(ev.warehouseName),
                render: (ev) => <span className="whitespace-nowrap">{translateSystemEntityName(ev.warehouseName)}</span>,
              },
              {
                key: 'partyName',
                header: t('الطرف', 'Party'),
                sortable: true,
                sortValue: (ev) => translateSystemEntityName(ev.partyName),
                exportValue: (ev) => translateSystemEntityName(ev.partyName),
                render: (ev) => <span className="whitespace-nowrap">{translateSystemEntityName(ev.partyName)}</span>,
              },
              {
                key: 'unit',
                header: t('الوحدة', 'Unit'),
                align: 'center',
                exportValue: (ev) => t(ev.unit),
                render: (ev) => <span className="whitespace-nowrap">{t(ev.unit)}</span>,
              },
              {
                key: 'qtyIn',
                header: t('وارد (+)', 'In (+)'),
                align: 'center',
                sortable: true,
                sortValue: (ev) => ev.qtyIn,
                exportValue: (ev) => ev.qtyIn,
                render: (ev) => (
                  <span className="font-mono font-bold text-emerald-700 tabular-nums">
                    {ev.qtyIn > 0 ? `+${fmtQty(ev.qtyIn)}` : '-'}
                  </span>
                ),
              },
              {
                key: 'qtyOut',
                header: t('صادر (-)', 'Out (-)'),
                align: 'center',
                sortable: true,
                sortValue: (ev) => ev.qtyOut,
                exportValue: (ev) => ev.qtyOut,
                render: (ev) => (
                  <span className="font-mono font-bold text-rose-700 tabular-nums">
                    {ev.qtyOut > 0 ? `-${fmtQty(ev.qtyOut)}` : '-'}
                  </span>
                ),
              },
              {
                key: 'runningBalance',
                header: t('الرصيد بعد الحركة', 'Balance After'),
                align: 'center',
                sortable: true,
                sortValue: (ev) => ev.runningBalance,
                exportValue: (ev) => ev.runningBalance,
                cellClassName: 'bg-slate-50 font-mono font-black text-slate-900 tabular-nums',
                render: (ev) => <span>{fmtQty(ev.runningBalance)}</span>,
              },
              {
                key: 'unitPrice',
                header: t('السعر / التكلفة', 'Price / Cost'),
                align: 'center',
                sortable: true,
                sortValue: (ev) => ev.unitPrice,
                exportValue: (ev) => ev.unitPrice,
                render: (ev) => <span className="font-mono tabular-nums">{fmt(ev.unitPrice)}</span>,
              },
              {
                key: 'totalValue',
                header: t('الإجمالي', 'Total'),
                align: 'center',
                sortable: true,
                sortValue: (ev) => ev.totalValue,
                exportValue: (ev) => ev.totalValue,
                render: (ev) => <span className="font-mono font-bold tabular-nums">{fmt(ev.totalValue)}</span>,
              },
              {
                key: 'userName',
                header: t('المستخدم', 'User'),
                sortable: true,
                sortValue: (ev) => ev.userName,
                exportValue: (ev) => ev.userName,
                render: (ev) => <span className="whitespace-nowrap">{ev.userName}</span>,
              },
              {
                key: 'notes',
                header: t('ملاحظات', 'Notes'),
                exportValue: (ev) => ev.notes || '-',
                render: (ev) => <span className="text-slate-600 whitespace-nowrap">{ev.notes || '-'}</span>,
              },
            ]}
          />
        </div>
      )}

      {/* 2. Selected Item Detailed Profit & Loss Analysis */}
      {selectedPnl && innerTab === 'pnl' && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden text-xs">
            <div className="px-2.5 py-2 bg-white">
              <span className="text-[11px] text-slate-500 block">{t('إجمالي المشتريات', 'Total Purchases')}</span>
              <strong className="text-sm font-black text-slate-900 tabular-nums">{fmt(selectedPnl.totalPurchaseValue)} {t(currency)}</strong>
              <span className="text-[10px] text-slate-500 block">{t('الكمية:', 'Qty:')} {fmtQty(selectedPnl.totalPurchaseQty)} {t(selectedPnl.baseUnit)}</span>
            </div>
            <div className="px-2.5 py-2 bg-white">
              <span className="text-[11px] text-slate-500 block">{t('صافي المبيعات', 'Net Sales')}</span>
              <strong className="text-sm font-black text-blue-800 tabular-nums">{fmt(selectedPnl.netSalesValue)} {t(currency)}</strong>
              <span className="text-[10px] text-slate-500 block">{t('صافي الكمية:', 'Net Qty:')} {fmtQty(selectedPnl.netSalesQty)} ({t('خصم:', 'Discount:')} {fmt(selectedPnl.totalDiscounts)})</span>
            </div>
            <div className="px-2.5 py-2 bg-white">
              <span className="text-[11px] text-slate-500 block">{t('تكلفة البضاعة المباعة', 'Cost of Goods Sold')}</span>
              <strong className="text-sm font-black text-amber-800 tabular-nums">{fmt(selectedPnl.cogs)} {t(currency)}</strong>
              <span className="text-[10px] text-slate-500 block">{t('مرتجع بيع:', 'Sales Return:')} {fmt(selectedPnl.salesReturnsValue)}</span>
            </div>
            <div className="px-2.5 py-2 bg-white">
              <span className="text-[11px] text-slate-500 block">{t('مجمل الربح', 'Gross Profit')}</span>
              <strong className={`text-sm font-black tabular-nums ${selectedPnl.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {fmt(selectedPnl.grossProfit)} {t(currency)}
              </strong>
              <span className="text-[10px] text-slate-500 block">{t('مرتجع شراء:', 'Purchase Return:')} {fmt(selectedPnl.purchaseReturnsValue)}</span>
            </div>
            <div className="px-2.5 py-2 bg-emerald-50/40">
              <span className="text-[11px] text-slate-600 block">{t('صافي الربح', 'Net Profit')}</span>
              <strong className={`text-sm font-black flex items-center gap-1 tabular-nums ${selectedPnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {selectedPnl.netProfit >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {fmt(selectedPnl.netProfit)} {t(currency)}
              </strong>
              <span className="text-[10px] text-slate-600 block">{t('نسبة على التكلفة:', 'Markup:')} {selectedPnl.profitPercentOnCost}% | {t('هامش:', 'Margin:')} {selectedPnl.profitMarginOnSales}%</span>
            </div>
            <div className="px-2.5 py-2 bg-rose-50/40">
              <span className="text-[11px] text-slate-600 block">{t('إجمالي الخسائر والتوالف', 'Total Losses & Damages')}</span>
              <strong className="text-sm font-black text-rose-700 tabular-nums">{fmt(selectedPnl.totalLoss)} {t(currency)}</strong>
              <span className="text-[10px] text-slate-500 block">{t('مصاريف/توالف محملة:', 'Allocated Exp/Dmg:')} {fmt(selectedPnl.allocatedExpenses)}</span>
            </div>
            <div className="px-2.5 py-1.5 col-span-2 sm:col-span-4 lg:col-span-6 grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50">
              <div>
                <span className="text-[11px] text-slate-500 block">{t('عدد الوحدات المتبقية', 'Remaining Units')}</span>
                <strong className="text-xs font-black text-slate-900 tabular-nums">{fmtQty(selectedPnl.currentStockQty)} {t(selectedPnl.baseUnit)}</strong>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">{t('قيمة المخزون الحالي', 'Current Stock Value')}</span>
                <strong className="text-xs font-black text-blue-800 tabular-nums">{fmt(selectedPnl.currentStockValue)} {t(currency)}</strong>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">{t('إجمالي المبيعات (قبل المرتجع)', 'Gross Sales (Before Returns)')}</span>
                <strong className="text-xs font-black text-slate-900 tabular-nums">{fmt(selectedPnl.totalSalesValue)} {t(currency)} ({fmtQty(selectedPnl.totalSalesQty)})</strong>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">{t('صافي المشتريات (بعد المرتجع)', 'Net Purchases (After Returns)')}</span>
                <strong className="text-xs font-black text-slate-900 tabular-nums">{fmt(selectedPnl.netPurchaseValue)} {t(currency)} ({fmtQty(selectedPnl.netPurchaseQty)})</strong>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
            <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1.5">
              <h4 className="font-extrabold text-slate-800 border-b border-slate-100 pb-1">{t('تحليل أسعار الشراء', 'Purchase Price Analysis')} ({t(selectedPnl.baseUnit)})</h4>
              <div className="grid grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded overflow-hidden text-center">
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">{t('المتوسط', 'Average')}</span><strong className="font-mono tabular-nums">{fmt(selectedPnl.avgPurchasePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">{t('الأقل', 'Min')}</span><strong className="font-mono text-emerald-700 tabular-nums">{fmt(selectedPnl.minPurchasePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">{t('الأعلى', 'Max')}</span><strong className="font-mono text-rose-700 tabular-nums">{fmt(selectedPnl.maxPurchasePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">{t('الآخر', 'Last')}</span><strong className="font-mono tabular-nums">{fmt(selectedPnl.lastPurchasePrice)}</strong></div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1.5">
              <h4 className="font-extrabold text-slate-800 border-b border-slate-100 pb-1">{t('تحليل أسعار البيع', 'Sale Price Analysis')} ({t(selectedPnl.baseUnit)})</h4>
              <div className="grid grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded overflow-hidden text-center">
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">{t('المتوسط', 'Average')}</span><strong className="font-mono tabular-nums">{fmt(selectedPnl.avgSalePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">{t('الأقل', 'Min')}</span><strong className="font-mono text-rose-700 tabular-nums">{fmt(selectedPnl.minSalePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">{t('الأعلى', 'Max')}</span><strong className="font-mono text-emerald-700 tabular-nums">{fmt(selectedPnl.maxSalePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">{t('الآخر', 'Last')}</span><strong className="font-mono tabular-nums">{fmt(selectedPnl.lastSalePrice)}</strong></div>
              </div>
            </div>
          </div>

          {/* Loss-making sales & damaged breakdown */}
          <UnifiedDataTable
            title={`${t('الحركات الخاسرة والبيع بأقل من التكلفة', 'Loss-Making & Below-Cost Transactions')} (${formatLocaleNumber(selectedPnl.lossTransactions.length)})`}
            subtitle={`${t('إجمالي الخسائر:', 'Total Losses:')} ${fmt(selectedPnl.totalLoss)} ${t(currency)}`}
            compact
            searchable={false}
            data={selectedPnl.lossTransactions}
            rowKey={(lt) => lt.id}
            onRowClick={(lt) => onInspectDocument(lt.docType, lt.docId)}
            rowClassName={() => 'cursor-pointer hover:bg-rose-50/70'}
            exportFilename={`AWLAD_SELIM_LossTransactions_${selectedPnl.code}`}
            pdfTitle={`${t('الحركات الخاسرة للصنف:', 'Loss Transactions for Item:')} ${selectedPnl.productName}`}
            emptyTitle={t('لا توجد أي عمليات بيع خاسرة أو توالف لهذا الصنف ضمن الفترة المحددة', 'No loss-making sales or damaged items found for this product within the selected period')}
            columns={[
              {
                key: 'actualDateTime',
                header: t('التاريخ الفعلي', 'Actual Date & Time'),
                sortable: true,
                sortValue: (lt) => lt.actualDateTime,
                exportValue: (lt) => lt.actualDateTime,
                render: (lt) => <span className="font-mono text-[11px] tabular-nums">{lt.actualDateTime}</span>,
              },
              {
                key: 'docNumber',
                header: t('المستند', 'Document'),
                sortable: true,
                sortValue: (lt) => lt.docNumber,
                exportValue: (lt) => lt.docNumber,
                render: (lt) => <span className="font-mono text-blue-700 font-bold">{lt.docNumber}</span>,
              },
              {
                key: 'partyName',
                header: t('العميل / المخزن', 'Customer / Warehouse'),
                sortable: true,
                sortValue: (lt) => translateSystemEntityName(lt.partyName),
                exportValue: (lt) => translateSystemEntityName(lt.partyName),
                render: (lt) => <span>{translateSystemEntityName(lt.partyName)}</span>,
              },
              {
                key: 'quantity',
                header: t('الكمية', 'Quantity'),
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.quantity,
                exportValue: (lt) => `${lt.quantity} ${t(lt.unit)}`,
                render: (lt) => <span className="font-bold tabular-nums">{fmtQty(lt.quantity)} {t(lt.unit)}</span>,
              },
              {
                key: 'sellingPrice',
                header: t('سعر البيع', 'Sale Price'),
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.sellingPrice,
                exportValue: (lt) => lt.sellingPrice,
                render: (lt) => <span className="font-mono tabular-nums">{fmt(lt.sellingPrice)}</span>,
              },
              {
                key: 'costPrice',
                header: t('التكلفة', 'Cost'),
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.costPrice,
                exportValue: (lt) => lt.costPrice,
                render: (lt) => <span className="font-mono tabular-nums">{fmt(lt.costPrice)}</span>,
              },
              {
                key: 'discount',
                header: t('الخصم', 'Discount'),
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.discount,
                exportValue: (lt) => lt.discount,
                render: (lt) => <span className="font-mono text-amber-700 tabular-nums">{fmt(lt.discount)}</span>,
              },
              {
                key: 'lossAmount',
                header: t('قيمة الخسارة', 'Loss Value'),
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.lossAmount,
                exportValue: (lt) => -lt.lossAmount,
                render: (lt) => <span className="font-mono font-black text-rose-700 tabular-nums">-{fmt(lt.lossAmount)}</span>,
              },
              {
                key: 'reason',
                header: t('السبب التفصيلي', 'Detailed Reason'),
                exportValue: (lt) => lt.reason,
                render: (lt) => <span className="text-rose-900">{t(lt.reason)}</span>,
              },
            ]}
          />
        </div>
      )}

      {/* 3. Portfolio P&L Overview across All Products */}
      {(innerTab === 'portfolio' || (!lifecycle && !selectedPnl)) && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden text-xs">
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">{t('إجمالي المشتريات', 'Total Purchases')}</span><strong className="text-sm font-black tabular-nums">{fmt(portfolioTotals.totalPurchaseValue)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">{t('صافي المبيعات', 'Net Sales')}</span><strong className="text-sm font-black text-blue-800 tabular-nums">{fmt(portfolioTotals.netSalesValue)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">{t('تكلفة البضاعة المباعة', 'Cost of Goods Sold')}</span><strong className="text-sm font-black text-amber-800 tabular-nums">{fmt(portfolioTotals.cogs)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">{t('صافي الربح', 'Net Profit')}</span><strong className={`text-sm font-black tabular-nums ${portfolioTotals.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(portfolioTotals.netProfit)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">{t('إجمالي الخسائر', 'Total Losses')}</span><strong className="text-sm font-black text-rose-700 tabular-nums">{fmt(portfolioTotals.totalLoss)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">{t('قيمة المخزون الحالي', 'Current Stock Value')}</span><strong className="text-sm font-black text-slate-900 tabular-nums">{fmt(portfolioTotals.stockValuation)}</strong></div>
          </div>

          <UnifiedDataTable<ItemPnlSummary>
            title={t('تحليل أرباح وخسائر الأصناف', 'Items Profit & Loss Analysis')}
            subtitle={t('اضغط على أي صنف لفتح تاريخه الكامل من أول يوم', 'Click any item to open its full history from day one')}
            compact
            maxHeightClassName="max-h-[54vh]"
            data={filteredPortfolio}
            rowKey={(item) => item.productId}
            searchValue={portfolioSearch}
            onSearchChange={setPortfolioSearch}
            searchPlaceholder={t('بحث باسم الصنف أو الكود...', 'Search by item name or code...')}
            exportFilename="AWLAD_SELIM_ItemsPnL"
            pdfTitle={t('تحليل أرباح وخسائر جميع الأصناف', 'All Items Profit & Loss Analysis')}
            defaultPageSize={50}
            onRowClick={(item) => {
              onSelectProduct(item.productId);
              setInnerTab('timeline');
            }}
            rowClassName={() => 'cursor-pointer hover:bg-blue-50/70'}
            columns={[
              {
                key: 'productName',
                header: t('الصنف', 'Item'),
                sortable: true,
                sortValue: (it) => it.productName,
                exportValue: (it) => `${it.productName} (${it.code})`,
                render: (it) => (
                  <div>
                    <div className="font-bold text-slate-900">{it.productName}</div>
                    <span className="block text-[10px] text-slate-500 font-mono">{it.code}</span>
                  </div>
                ),
              },
              {
                key: 'category',
                header: t('المجموعة', 'Category'),
                sortable: true,
                sortValue: (it) => it.category,
                exportValue: (it) => it.category,
                render: (it) => <span>{t(it.category)}</span>,
              },
              {
                key: 'totalPurchaseValue',
                header: t('مشتريات', 'Purchases'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.totalPurchaseValue,
                exportValue: (it) => it.totalPurchaseValue,
                render: (it) => <span className="font-mono tabular-nums">{fmt(it.totalPurchaseValue)}</span>,
              },
              {
                key: 'netSalesValue',
                header: t('صافي المبيعات', 'Net Sales'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.netSalesValue,
                exportValue: (it) => it.netSalesValue,
                render: (it) => <span className="font-mono font-bold text-blue-800 tabular-nums">{fmt(it.netSalesValue)}</span>,
              },
              {
                key: 'cogs',
                header: t('تكلفة البضاعة المباعة', 'Cost of Goods Sold'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.cogs,
                exportValue: (it) => it.cogs,
                render: (it) => <span className="font-mono tabular-nums">{fmt(it.cogs)}</span>,
              },
              {
                key: 'totalDiscounts',
                header: t('الخصومات', 'Discounts'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.totalDiscounts,
                exportValue: (it) => it.totalDiscounts,
                render: (it) => <span className="font-mono text-amber-700 tabular-nums">{fmt(it.totalDiscounts)}</span>,
              },
              {
                key: 'salesReturnsValue',
                header: t('مرتجعات بيع', 'Sales Returns'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.salesReturnsValue,
                exportValue: (it) => it.salesReturnsValue,
                render: (it) => <span className="font-mono text-rose-700 tabular-nums">{fmt(it.salesReturnsValue)}</span>,
              },
              {
                key: 'allocatedExpenses',
                header: t('التوالف / المصاريف', 'Damages / Expenses'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.allocatedExpenses,
                exportValue: (it) => it.allocatedExpenses,
                render: (it) => <span className="font-mono text-rose-700 tabular-nums">{fmt(it.allocatedExpenses)}</span>,
              },
              {
                key: 'netProfit',
                header: t('صافي الربح', 'Net Profit'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.netProfit,
                exportValue: (it) => it.netProfit,
                render: (it) => (
                  <span className={`font-mono font-black tabular-nums ${it.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {fmt(it.netProfit)}
                  </span>
                ),
              },
              {
                key: 'profitPercentOnCost',
                header: t('نسبة الربح على التكلفة', 'Profit % on Cost'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.profitPercentOnCost,
                exportValue: (it) => `${it.profitPercentOnCost}%`,
                render: (it) => <span className="font-mono tabular-nums">{formatLocaleNumber(it.profitPercentOnCost)}%</span>,
              },
              {
                key: 'profitMarginOnSales',
                header: t('هامش المبيعات', 'Sales Margin'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.profitMarginOnSales,
                exportValue: (it) => `${it.profitMarginOnSales}%`,
                render: (it) => <span className="font-mono tabular-nums">{formatLocaleNumber(it.profitMarginOnSales)}%</span>,
              },
              {
                key: 'totalLoss',
                header: t('الخسائر', 'Losses'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.totalLoss,
                exportValue: (it) => it.totalLoss,
                render: (it) => (
                  <span className="font-mono text-rose-700 tabular-nums">
                    {it.totalLoss > 0 ? fmt(it.totalLoss) : '-'}
                  </span>
                ),
              },
              {
                key: 'currentStockQty',
                header: t('المخزون الحالي', 'Current Stock'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.currentStockQty,
                exportValue: (it) => `${it.currentStockQty} ${t(it.baseUnit)}`,
                render: (it) => <span className="font-mono font-bold tabular-nums">{fmtQty(it.currentStockQty)} {t(it.baseUnit)}</span>,
              },
              {
                key: 'currentStockValue',
                header: t('قيمة المخزون', 'Stock Value'),
                align: 'center',
                sortable: true,
                sortValue: (it) => it.currentStockValue,
                exportValue: (it) => it.currentStockValue,
                render: (it) => <span className="font-mono tabular-nums">{fmt(it.currentStockValue)}</span>,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
};
